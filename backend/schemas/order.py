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

    model_config = {"from_attributes": True}
