from __future__ import annotations  # for `str | None` below, on Python 3.9

import uuid

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from controllers import order_controller
from core.deps import get_current_user, get_current_user_optional
from db.session import get_db
from models.user import User
from routes import scan
from schemas.mark_unavailable import MarkUnavailableRequest
from schemas.response import SuccessResponse
from schemas.scan_verify import ScanVerifyRequest

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])


@router.get("/me", response_model=SuccessResponse)
def my_orders(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> SuccessResponse:
    return order_controller.list_my_orders(user, db)


@router.get("/{order_id}/scan-token", response_model=SuccessResponse)
def order_scan_token(
    order_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SuccessResponse:
    return order_controller.issue_scan_token(order_id, user, db)


# All three routes below accept EITHER a logged-in picker (the normal
# session cookie) OR a `token` query param minted by /scan-token — the QR
# code a phone scans embeds that token so it never has to log in at all,
# same philosophy as the original /scan and /display pages being open to
# anonymous phones. get_current_user_optional returns None instead of
# raising when there's no cookie, so the controller can fall back to
# checking the token instead of the route itself rejecting the request.
@router.get("/{order_id}", response_model=SuccessResponse)
def order_detail(
    order_id: uuid.UUID,
    token: str | None = None,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> SuccessResponse:
    return order_controller.get_order(order_id, token, user, db)


@router.get("/{order_id}/items", response_model=SuccessResponse)
def order_items(
    order_id: uuid.UUID,
    token: str | None = None,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> SuccessResponse:
    return order_controller.list_order_items(order_id, token, user, db)


@router.post("/{order_id}/verify", response_model=SuccessResponse)
async def verify_order_scan(
    order_id: uuid.UUID,
    body: ScanVerifyRequest,
    token: str | None = None,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> SuccessResponse:
    result = order_controller.verify_scan(order_id, body, token, user, db)
    if result.data.get("matched"):
        # Pushed so a PC watching this order (OrderWatchDialog) updates its
        # checklist the instant a phone (or the PC's own upload) verifies an
        # item, instead of waiting out the poll interval. `item`/`order` are
        # pydantic models, not dicts — jsonable_encoder is what makes their
        # UUID/datetime fields websocket-serializable.
        await scan.broadcast(
            jsonable_encoder({"type": "item_update", "kind": "verify", **result.data}),
            str(order_id), mirror_global=False,
        )
    return result


@router.post("/{order_id}/items/{item_id}/unavailable", response_model=SuccessResponse)
async def mark_order_item_unavailable(
    order_id: uuid.UUID,
    item_id: uuid.UUID,
    body: MarkUnavailableRequest,
    token: str | None = None,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> SuccessResponse:
    result = order_controller.mark_item_unavailable(order_id, item_id, body, token, user, db)
    await scan.broadcast(
        jsonable_encoder({"type": "item_update", "kind": "unavailable", **result.data}),
        str(order_id), mirror_global=False,
    )
    return result
