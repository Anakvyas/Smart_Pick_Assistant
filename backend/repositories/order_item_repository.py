from sqlalchemy import select
from sqlalchemy.orm import Session

from models.order_item import OrderItem


class OrderItemRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_for_order(self, order_id):
        stmt = (
            select(OrderItem)
            .where(OrderItem.order_id == order_id)
            .order_by(OrderItem.created_at.asc())
        )
        return self.db.execute(stmt).scalars().all()
