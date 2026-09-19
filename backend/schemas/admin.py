from __future__ import annotations  # for `str | None` etc below, on Python 3.9

from typing import Optional

from pydantic import BaseModel, Field


class ProductPublic(BaseModel):
    """One entry from demo/products.json, as offered to the admin order
    builder's product search — the same catalog dummy.py seeds barcodes
    from.
    """

    id: str
    name: str
    barcode: Optional[str] = None
    gstin: Optional[str] = None
    company: Optional[str] = None
    weight: Optional[str] = None
    mrp: Optional[str] = None
    image: Optional[str] = None

    model_config = {"from_attributes": True}


class CreateOrderItemRequest(BaseModel):
    # product_id references demo/products.json (barcode + name both come
    # from the catalog); name is for a one-off item with no catalog entry
    # (matched on label text only, same as create_order.py's custom items).
    # Exactly one of the two is expected per line.
    product_id: Optional[str] = None
    name: Optional[str] = None
    quantity: int = Field(default=1, ge=1)


class CreateOrderRequest(BaseModel):
    items: list[CreateOrderItemRequest]
    order_number: Optional[str] = None
    # None = use config.STRICT_LABEL_VERIFICATION for this order; True/False
    # pins it regardless of the global setting (see models/order.py).
    strict_label_verification: Optional[bool] = None
