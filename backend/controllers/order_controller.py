from __future__ import annotations  # for `str | None` etc below, on Python 3.9

import re
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from exceptions.app_exceptions import OrderNotFoundError
from models.order_item import OrderItem
from models.user import User
from repositories.order_item_repository import OrderItemRepository
from repositories.order_repository import OrderRepository
from schemas.order import OrderPublic
from schemas.order_item import OrderItemPublic
from schemas.response import SuccessResponse
from schemas.scan_verify import ScanVerifyRequest


def list_my_orders(user: User, db: Session) -> SuccessResponse[dict]:
    orders = OrderRepository(db).list_for_picker(user.id)
    return SuccessResponse(
        data={"orders": [OrderPublic.model_validate(o) for o in orders]}
    )


def _get_owned_order(order_id: uuid.UUID, user: User, db: Session):
    order = OrderRepository(db).get_for_picker(order_id, user.id)
    if not order:
        raise OrderNotFoundError()
    return order


def list_order_items(order_id: uuid.UUID, user: User, db: Session) -> SuccessResponse[dict]:
    order = _get_owned_order(order_id, user, db)
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


def _find_match(items: list[OrderItem], req: ScanVerifyRequest) -> OrderItem | None:
    pending = [i for i in items if i.status != "VERIFIED"]
    if req.barcode:
        exact = next((i for i in pending if i.barcode and i.barcode == req.barcode), None)
        if exact:
            return exact
    if req.name:
        return next((i for i in pending if _name_matches(i, req.name)), None)
    return None


def verify_scan(order_id: uuid.UUID, req: ScanVerifyRequest, user: User, db: Session) -> SuccessResponse[dict]:
    order = _get_owned_order(order_id, user, db)
    items = OrderItemRepository(db).list_for_order(order.id)

    match = _find_match(items, req)
    if not match:
        return SuccessResponse(data={
            "matched": False,
            "item": None,
            "order": OrderPublic.model_validate(order),
            "reason": "That scan doesn't match any item still pending on this order.",
        })

    match.quantity_verified = min(match.quantity_verified + 1, match.quantity_expected)
    if match.quantity_verified >= match.quantity_expected:
        match.status = "VERIFIED"
        match.verified_at = datetime.now(timezone.utc)

    order.picked_count = sum(i.quantity_verified for i in items)
    if all(i.status == "VERIFIED" for i in items):
        order.status = "COMPLETED"
        order.completed_at = datetime.now(timezone.utc)
    elif order.status == "ASSIGNED":
        order.status = "IN_PROGRESS"

    db.commit()
    db.refresh(match)
    db.refresh(order)

    return SuccessResponse(data={
        "matched": True,
        "item": OrderItemPublic.model_validate(match),
        "order": OrderPublic.model_validate(order),
        "reason": None,
    })
