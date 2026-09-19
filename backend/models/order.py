import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import DateTime

from db.base import Base


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    picker_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="ASSIGNED")

    product_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    picked_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Optional[...], not `datetime | None` — see models/user.py's last_login_at
    # for why (SQLAlchemy's Mapped[] resolves a stringified annotation with a
    # plain eval() that doesn't understand the `|` union syntax on this
    # project's Python 3.9).
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # None (default) = follow config.STRICT_LABEL_VERIFICATION; True/False
    # overrides that global default for just this order — set from the admin
    # order builder so a barcode-only order (no labels expected) doesn't
    # have to flip the env var for everyone. See _effective_strict_label in
    # controllers/order_controller.py for how the two combine.
    strict_label_verification: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
