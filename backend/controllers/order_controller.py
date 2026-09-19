from __future__ import annotations  # for `str | None` etc below, on Python 3.9

import re
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from config import STRICT_LABEL_VERIFICATION
from core.security import create_scan_token, decode_scan_token
from exceptions.app_exceptions import AuthRequiredError, OrderItemNotFoundError, OrderNotFoundError
from models.order_item import OrderItem
from models.user import User
from repositories.order_item_repository import OrderItemRepository
from repositories.order_repository import OrderRepository
from schemas.mark_unavailable import MarkUnavailableRequest
from schemas.order import OrderPublic
from schemas.order_item import OrderItemPublic
from schemas.response import SuccessResponse
from schemas.scan_verify import ScanVerifyRequest

# Both VERIFIED and UNAVAILABLE are terminal — an item only still needs the
# picker's attention while it's PENDING. Used everywhere "is this item done"
# or "is this item still up for grabs to match a scan against" matters, so
# adding a third terminal status later only means updating this one set.
_TERMINAL_STATUSES = {"VERIFIED", "UNAVAILABLE"}


def list_my_orders(user: User, db: Session) -> SuccessResponse[dict]:
    orders = OrderRepository(db).list_for_picker(user.id)
    return SuccessResponse(
        data={"orders": [OrderPublic.model_validate(o) for o in orders]}
    )


def issue_scan_token(order_id: uuid.UUID, user: User, db: Session) -> SuccessResponse[dict]:
    # Only the order's own picker can mint a token for it — this is the one
    # call in the QR flow that still requires a real login, same as every
    # other order endpoint; the token it hands back is what lets the *phone*
    # skip login afterward.
    order = OrderRepository(db).get_for_picker(order_id, user.id)
    if not order:
        raise OrderNotFoundError()
    return SuccessResponse(data={"token": create_scan_token(str(order.id))})


def _resolve_order(order_id: uuid.UUID, token: str | None, user: User | None, db: Session):
    """Either a logged-in picker who owns this order, or a valid scan token
    minted for exactly this order (see issue_scan_token) — the QR-scanned
    phone almost always takes the second path, with no login of its own.
    """
    if user is not None:
        order = OrderRepository(db).get_for_picker(order_id, user.id)
        if not order:
            raise OrderNotFoundError()
        return order
    if token and decode_scan_token(token, str(order_id)):
        order = OrderRepository(db).get_by_id(order_id)
        if not order:
            raise OrderNotFoundError()
        return order
    raise AuthRequiredError()


def get_order(order_id: uuid.UUID, token: str | None, user: User | None, db: Session) -> SuccessResponse[dict]:
    # The anonymous QR-scan phone has no cookie and so can't call /me —
    # this is how it gets the order_number/counts it shows up top, using
    # the same token it already has for /items and /verify.
    order = _resolve_order(order_id, token, user, db)
    return SuccessResponse(data={"order": OrderPublic.model_validate(order)})


def list_order_items(order_id: uuid.UUID, token: str | None, user: User | None, db: Session) -> SuccessResponse[dict]:
    order = _resolve_order(order_id, token, user, db)
    items = OrderItemRepository(db).list_for_order(order.id)
    return SuccessResponse(
        data={"items": [OrderItemPublic.model_validate(i) for i in items]}
    )


def _normalize(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower()) if s else ""


def _name_matches(item: OrderItem, name: str | None) -> bool:
    a, b = _normalize(item.name), _normalize(name)
    # A name-only OCR guess is noisy in both directions (extra words on
    # either side of the real product name), so either string containing
    # the other counts as a match — same leniency the display page's OCR
    # dedup uses, just applied against a known expected name instead of a
    # previously-seen one.
    return bool(a) and bool(b) and (a in b or b in a)


def _effective_strict_label(order) -> bool:
    """Order.strict_label_verification overrides config.STRICT_LABEL_VERIFICATION
    when set (see models/order.py); None means "use the global default".
    """
    return STRICT_LABEL_VERIFICATION if order.strict_label_verification is None else order.strict_label_verification


def _code_matches(item: OrderItem, req: ScanVerifyRequest) -> bool:
    """A barcode-scanner read (req.barcode) and the label's OCR-read GSTIN
    (req.gstin) aren't the same kind of number, but either one landing on
    either of the item's own barcode or gstin is equally good evidence of
    which physical product this is — a barcode misread can still leave a
    clean GSTIN read, and vice versa.
    """
    scanned = {c for c in (req.barcode, req.gstin) if c}
    expected = {c for c in (item.barcode, item.gstin) if c}
    return bool(scanned & expected)


def _current_expected_item(items: list[OrderItem]) -> OrderItem | None:
    """The one item a scan is actually checked against — line-wise, not
    "any pending item on the order": the lowest-position item still
    PENDING, i.e. exactly what the picker's screen is showing as "scan
    this next". See models/order_item.py's `position` for why that column
    (not created_at) is what defines the line order.
    """
    pending = sorted((i for i in items if i.status == "PENDING"), key=lambda i: i.position)
    return pending[0] if pending else None


def _identifies(item: OrderItem, req: ScanVerifyRequest) -> bool:
    """Looser than the verification check above — no label corroboration
    required — used only to name the right product in an "out of order"
    rejection message, not to decide whether anything actually verifies.
    A code match is enough on its own; otherwise falls back to name (not
    an elif — a scanned code that isn't this item's own, e.g. a name-only
    custom item, shouldn't block recognizing it by label).
    """
    if (req.barcode or req.gstin) and _code_matches(item, req):
        return True
    return bool(req.name and _name_matches(item, req.name))


def _find_match(
    items: list[OrderItem], req: ScanVerifyRequest, strict_label: bool,
) -> tuple[OrderItem | None, str | None]:
    """Returns (matched_item_or_None, rejection_reason_or_None) — a reason
    is only ever set alongside None, so callers can tell "no match at all"
    apart from "matched the current item's code but couldn't confirm it"
    without re-deriving the same checks.

    Line-wise: only the current expected item (_current_expected_item) is
    ever eligible to verify, not just any pending item on the order — a
    scan of a *later* line, however clean a read it is, doesn't jump the
    queue. A rejected scan is deliberately not persisted as any kind of
    item state at all, so the current item stays PENDING and eligible for
    another attempt right away.
    """
    current = _current_expected_item(items)
    if not current:
        return None, "This order has nothing left to scan."

    if (req.barcode or req.gstin) and _code_matches(current, req):
        # A code match alone is not trusted as proof of the correct
        # product — a misread, a swapped/adjacent label, or a relabeled
        # item can all still produce a "correct" code read on the wrong
        # physical item. The scan's own label/name has to corroborate it
        # before it counts as verified; a bare code with no name (or a
        # name that points somewhere else) is rejected rather than trusted
        # on the code alone. strict_label=False (global
        # STRICT_LABEL_VERIFICATION, or this order's own override — see
        # _effective_strict_label) skips that corroboration and trusts the
        # barcode/GSTIN by itself.
        if not strict_label:
            return current, None
        if req.name and _name_matches(current, req.name):
            return current, None
        if req.name:
            return None, (
                f"Code matched {current.name!r}, but the label read {req.name!r} — "
                "that doesn't look like the same product."
            )
        return None, (
            f"Barcode/GSTIN matched {current.name!r}, but there's no label/name yet to "
            "confirm it — rescan with the name or label visible too."
        )

    # No code match against *this* item — either nothing was read, or the
    # scan's barcode/GSTIN simply isn't one current has on file at all
    # (e.g. a name-only custom item added via the admin builder, which was
    # always meant to be identified by label alone; see admin_controller.py
    # / create_order.py). Falls back to a plain name check rather than
    # treating "a barcode was read" as disqualifying on its own — a real
    # product's real barcode reading fine doesn't mean anything when the
    # order line it's being checked against never had one to compare.
    if req.name and _name_matches(current, req.name):
        return current, None

    # Doesn't match the current line — but does it match something *else*
    # still pending further down the order? Worth calling that out by name
    # rather than a flat "no match", since it's a different failure than a
    # genuinely unrecognized product: the picker just needs to come back to
    # it once they've worked through what's ahead of it.
    other = next(
        (i for i in items if i.status == "PENDING" and i.id != current.id and _identifies(i, req)),
        None,
    )
    if other:
        return None, f"Scan {current.name!r} next — that's what this order expects right now, not {other.name!r}."
    return None, f"That scan doesn't match {current.name!r}, the item this order expects next."


def _apply_order_completion(order, items: list[OrderItem]) -> None:
    """Shared by verify_scan and mark_item_unavailable — both are ways an
    item can reach a terminal state, and either one can be the last item
    an order was waiting on. picked_count only counts *verified* units
    (an unavailable item was never actually picked), but completion counts
    both terminal states, per the picking workflow's own rule that a
    picker can't get stuck forever on a genuinely out-of-stock item.
    """
    order.picked_count = sum(i.quantity_verified for i in items)
    if all(i.status in _TERMINAL_STATUSES for i in items):
        order.status = "COMPLETED"
        order.completed_at = datetime.now(timezone.utc)
    elif order.status == "ASSIGNED":
        order.status = "IN_PROGRESS"


def verify_scan(
    order_id: uuid.UUID, req: ScanVerifyRequest, token: str | None, user: User | None, db: Session,
) -> SuccessResponse[dict]:
    order = _resolve_order(order_id, token, user, db)
    items = OrderItemRepository(db).list_for_order(order.id)

    match, reason = _find_match(items, req, _effective_strict_label(order))
    if not match:
        # Deliberately not written to the database — a rejected scan is a
        # failed *attempt*, not a state transition (see _find_match). The
        # item is still exactly PENDING and the very next scan can match
        # it, whether that's a retry of the same product or a different
        # one entirely.
        return SuccessResponse(data={
            "matched": False,
            "item": None,
            "order": OrderPublic.model_validate(order),
            "reason": reason,
        })

    match.quantity_verified = min(match.quantity_verified + 1, match.quantity_expected)
    if match.quantity_verified >= match.quantity_expected:
        match.status = "VERIFIED"
        match.verified_at = datetime.now(timezone.utc)

    _apply_order_completion(order, items)

    db.commit()
    db.refresh(match)
    db.refresh(order)

    return SuccessResponse(data={
        "matched": True,
        "item": OrderItemPublic.model_validate(match),
        "order": OrderPublic.model_validate(order),
        "reason": None,
    })


def mark_item_unavailable(
    order_id: uuid.UUID, item_id: uuid.UUID, req: MarkUnavailableRequest,
    token: str | None, user: User | None, db: Session,
) -> SuccessResponse[dict]:
    order = _resolve_order(order_id, token, user, db)
    items = OrderItemRepository(db).list_for_order(order.id)
    item = next((i for i in items if i.id == item_id), None)
    if not item:
        raise OrderItemNotFoundError()

    # Idempotent rather than an error — a picker double-tapping "confirm"
    # (or a retried request) shouldn't fail just because the item was
    # already marked; it's already in the state they were asking for.
    if item.status != "UNAVAILABLE":
        item.status = "UNAVAILABLE"
        item.unavailable_reason = req.reason
        item.unavailable_at = datetime.now(timezone.utc)
        _apply_order_completion(order, items)
        db.commit()
        db.refresh(item)
        db.refresh(order)

    return SuccessResponse(data={
        "item": OrderItemPublic.model_validate(item),
        "order": OrderPublic.model_validate(order),
    })
