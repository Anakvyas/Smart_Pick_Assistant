from sqlalchemy import select
from sqlalchemy.orm import Session

from models.order_item import OrderItem


class OrderItemRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_for_order(self, order_id):
        # position is the real line order (see models/order_item.py);
        # created_at is only a tiebreaker for rows that somehow share one.
        stmt = (
            select(OrderItem)
            .where(OrderItem.order_id == order_id)
            .order_by(OrderItem.position.asc(), OrderItem.created_at.asc())
        )
        return self.db.execute(stmt).scalars().all()

    def get_for_order(self, item_id, order_id):
        stmt = select(OrderItem).where(OrderItem.id == item_id, OrderItem.order_id == order_id)
        return self.db.execute(stmt).scalars().one_or_none()
