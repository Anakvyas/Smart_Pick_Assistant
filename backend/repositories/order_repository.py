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

    def get_for_picker(self, order_id, picker_id):
        stmt = select(Order).where(Order.id == order_id, Order.picker_id == picker_id)
        return self.db.execute(stmt).scalars().one_or_none()
