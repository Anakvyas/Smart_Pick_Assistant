from __future__ import annotations  # for `str | None` below, on Python 3.9

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from controllers import admin_controller
from core.deps import get_current_user
from db.session import get_db
from models.user import User
from schemas.admin import CreateOrderRequest
from schemas.response import SuccessResponse

# No separate ADMIN role yet — every route here is gated by the same
# get_current_user login as the picker dashboard (see core/deps.py). The
# app has exactly one account today, so "logged in" already means "admin".
router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/products", response_model=SuccessResponse)
def search_products(
    q: str | None = None,
    _user: User = Depends(get_current_user),
) -> SuccessResponse:
    return admin_controller.search_products(q)


@router.get("/orders", response_model=SuccessResponse)
def list_orders(
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SuccessResponse:
    return admin_controller.list_all_orders(db)


@router.post("/orders", response_model=SuccessResponse)
def create_order(
    body: CreateOrderRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SuccessResponse:
    return admin_controller.create_order(body, user, db)
