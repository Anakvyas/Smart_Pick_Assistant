from sqlalchemy import select
from sqlalchemy.orm import Session

from models.order import Order


class OrderRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_for_picker(self, picker_id):
        stmt = (
            select(Order)
            .where(Order.picker_id == picker_id)
            .order_by(Order.assigned_at.desc())
        )
        return self.db.execute(stmt).scalars().all()

    def list_all(self):
        # Unscoped by picker — the admin order list shows every order in the
        # system, not just the current login's own (see admin_controller.py).
        stmt = select(Order).order_by(Order.assigned_at.desc())
        return self.db.execute(stmt).scalars().all()

    def get_for_picker(self, order_id, picker_id):
        stmt = select(Order).where(Order.id == order_id, Order.picker_id == picker_id)
        return self.db.execute(stmt).scalars().one_or_none()

    def get_by_id(self, order_id):
        # Unscoped by picker — only used for the QR scan-token path (see
        # controllers/order_controller.py's _resolve_order), where the
        # token itself (not a logged-in user) is what proves access to this
        # one order.
        stmt = select(Order).where(Order.id == order_id)
        return self.db.execute(stmt).scalars().one_or_none()
