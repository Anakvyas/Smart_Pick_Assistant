import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import DateTime

from db.base import Base


class OrderItem(Base):
    """One expected product line on an order — what the picker's scan gets
    checked against. `barcode` is the strongest match signal when the
    product's own barcode is set (exact match); `name` is the fallback for
    items OCR has to identify by label text alone. See
    controllers/order_controller.py's `_find_match` for how the two are
    used together.
    """

    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id"), nullable=False)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    barcode: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    quantity_expected: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    quantity_verified: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # PENDING | VERIFIED | UNAVAILABLE — mirrors Order.status's plain-
    # string-enum style. Both VERIFIED and UNAVAILABLE are terminal: an
    # order is complete once every item is in one or the other (see
    # controllers/order_controller.py's _order_is_complete). A rejected
    # scan attempt is deliberately NOT a status here at all — it's just a
    # scan that didn't match, the item stays PENDING and can be
    # scanned/uploaded again immediately (see verify_scan).
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")

    # Only set when status == "UNAVAILABLE" — a short picker-supplied reason
    # (out of stock / damaged / missing from shelf / other), free text
    # rather than an enum since the business reasons aren't fixed yet.
    unavailable_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    unavailable_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
