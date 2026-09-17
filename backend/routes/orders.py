import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from controllers import order_controller
from core.deps import get_current_user
from db.session import get_db
from models.user import User
from schemas.response import SuccessResponse
from schemas.scan_verify import ScanVerifyRequest

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])


@router.get("/me", response_model=SuccessResponse)
def my_orders(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> SuccessResponse:
    return order_controller.list_my_orders(user, db)


@router.get("/{order_id}/items", response_model=SuccessResponse)
def order_items(
    order_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SuccessResponse:
    return order_controller.list_order_items(order_id, user, db)


@router.post("/{order_id}/verify", response_model=SuccessResponse)
def verify_order_scan(
    order_id: uuid.UUID,
    body: ScanVerifyRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SuccessResponse:
    return order_controller.verify_scan(order_id, body, user, db)
