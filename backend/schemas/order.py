import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class OrderPublic(BaseModel):
    id: uuid.UUID
    order_number: str
    status: str
    product_count: int
    unit_count: int
    picked_count: int
    assigned_at: datetime
    completed_at: Optional[datetime] = None
    # None = following config.STRICT_LABEL_VERIFICATION; True/False = this
    # order overrides that default (see models/order.py).
    strict_label_verification: Optional[bool] = None

    model_config = {"from_attributes": True}
