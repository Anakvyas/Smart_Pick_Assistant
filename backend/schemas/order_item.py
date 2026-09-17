import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class OrderItemPublic(BaseModel):
    id: uuid.UUID
    name: str
    barcode: Optional[str] = None
    quantity_expected: int
    quantity_verified: int
    status: str
    verified_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
