"""Backs the /admin order builder: search the product catalog, list every
order in the system, and create a new one from a picked set of products —
the API-driven replacement for hand-editing create_order.py per demo.
"""
from __future__ import annotations

import json
import os
import re
import uuid

from sqlalchemy.orm import Session

from config import DEMO_DIR
from exceptions.app_exceptions import ValidationAppError
from models.order import Order
from models.order_item import OrderItem
from models.user import User
from repositories.order_repository import OrderRepository
from schemas.admin import CreateOrderRequest, ProductPublic
from schemas.order import OrderPublic
from schemas.response import SuccessResponse

_ORDER_NUMBER_RE = re.compile(r"^ORD-(\d+)$")


def _load_catalog() -> list[dict]:
    path = os.path.join(DEMO_DIR, "products.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return json.load(f)


def search_products(query: str | None) -> SuccessResponse[dict]:
    catalog = _load_catalog()
    if query:
        q = query.strip().lower()
        catalog = [
            p for p in catalog
            if q in p["name"].lower() or q in (p.get("barcode") or "").lower() or q in (p.get("company") or "").lower()
        ]
    return SuccessResponse(data={"products": [ProductPublic.model_validate(p) for p in catalog]})


def list_all_orders(db: Session) -> SuccessResponse[dict]:
    orders = OrderRepository(db).list_all()
    return SuccessResponse(data={"orders": [OrderPublic.model_validate(o) for o in orders]})


def _next_order_number(db: Session) -> str:
    # Continues the same ORD-#### sequence dummy.py's seed orders use
    # (ORD-1001..1004), rather than a disjoint numbering scheme — picks
    # max(existing) + 1 so admin-built orders never collide with seeded ones
    # even as more seed orders get added later.
    numbers = [
        int(m.group(1)) for o in OrderRepository(db).list_all()
        if (m := _ORDER_NUMBER_RE.match(o.order_number))
    ]
    return f"ORD-{(max(numbers) + 1) if numbers else 1001}"


def create_order(req: CreateOrderRequest, user: User, db: Session) -> SuccessResponse[dict]:
    if not req.items:
        raise ValidationAppError("Add at least one product before creating the order.")

    catalog_by_id = {p["id"]: p for p in _load_catalog()}
    for line in req.items:
        if not line.product_id and not line.name:
            raise ValidationAppError("Each line needs either a catalog product or a name.")
        if line.product_id and line.product_id not in catalog_by_id:
            raise ValidationAppError(f"Unknown product: {line.product_id!r}.")

    order_number = req.order_number or _next_order_number(db)
    order = Order(
        id=uuid.uuid4(),
        picker_id=user.id,
        order_number=order_number,
        status="ASSIGNED",
        strict_label_verification=req.strict_label_verification,
    )
    db.add(order)
    db.flush()  # assigns order.id's FK target before the OrderItem rows below reference it

    unit_count = 0
    for position, line in enumerate(req.items):
        product = catalog_by_id.get(line.product_id) if line.product_id else None
        name = product["name"] if product else line.name
        barcode = product.get("barcode") if product else None
        gstin = product.get("gstin") if product else None
        db.add(OrderItem(
            id=uuid.uuid4(), order_id=order.id, position=position, name=name, barcode=barcode, gstin=gstin,
            quantity_expected=line.quantity, status="PENDING",
        ))
        unit_count += line.quantity

    order.product_count = len(req.items)
    order.unit_count = unit_count

    db.commit()
    db.refresh(order)
    return SuccessResponse(data={"order": OrderPublic.model_validate(order)})
