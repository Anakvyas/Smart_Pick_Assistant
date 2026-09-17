"""Seeds the auth database with dummy data so the app has something to log
into and look at *today* — one picker account, a few dummy orders, and each
order's expected product lines (so a scan has something real to verify
against — see /api/v1/orders/{id}/items and /verify in routes/orders.py).
Replace this with a real data feed later; nothing else in the app depends
on this script having been run (the scanner works with zero database at
all, and auth's signup/login work fine against an empty database too).

Run once: `python dummy.py` (from backend/, with the venv active and
DATABASE_URL in .env pointing at a real Postgres instance — see
.env.example). Safe to re-run: it skips anything already seeded rather
than duplicating it.

    Login as the dummy picker:
        email:    picker@example.com
        password: 12345

Note: auth here is email-based, not username-based (LoginRequest requires
a valid email shape) — "picker" alone isn't a valid login by itself, only
picker@example.com is.

Each order's line items use real barcodes from demo/products.json (the
same catalog the /demo gallery renders as barcode images) — open /demo on
one screen and scan its barcode images with the picker's phone to produce
a genuine match against these seeded expectations, no physical products
needed.
"""
import json
import os
import uuid

from core.security import hash_password
from db.base import Base
from db.session import SessionLocal, engine
from models.order import Order
from models.order_item import OrderItem
from models.user import User

PICKER_EMAIL = "picker@example.com"
PICKER_PASSWORD = "12345"
PICKER_NAME = "Demo Picker"

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "demo", "products.json")) as f:
    _CATALOG = {p["id"]: p for p in json.load(f)}


def _line(product_id, qty=1, verified=0):
    p = _CATALOG[product_id]
    return dict(name=p["name"], barcode=p["barcode"], quantity_expected=qty, quantity_verified=verified)


DUMMY_ORDERS = [
    dict(
        order=dict(order_number="ORD-1001", status="IN_PROGRESS", product_count=3, unit_count=4, picked_count=1),
        items=[
            _line("parle-g", qty=2, verified=1),
            _line("maggi-noodles", qty=1),
            _line("amul-taaza-milk", qty=1),
        ],
    ),
    dict(
        order=dict(order_number="ORD-1002", status="ASSIGNED", product_count=5, unit_count=8, picked_count=0),
        items=[
            _line("lays-magic-masala", qty=2),
            _line("britannia-good-day", qty=2),
            _line("kurkure-masala-munch", qty=2),
            _line("tata-salt", qty=1),
            _line("maggi-noodles", qty=1),
        ],
    ),
    dict(
        order=dict(order_number="ORD-1003", status="COMPLETED", product_count=2, unit_count=2, picked_count=2),
        items=[
            _line("parle-g", qty=1, verified=1),
            _line("tata-salt", qty=1, verified=1),
        ],
    ),
]


def get_or_create_picker(db) -> User:
    existing = db.query(User).filter(User.email == PICKER_EMAIL).one_or_none()
    if existing:
        print(f"picker already exists ({PICKER_EMAIL}), reusing it")
        return existing

    user = User(
        id=uuid.uuid4(),
        name=PICKER_NAME,
        email=PICKER_EMAIL,
        password_hash=hash_password(PICKER_PASSWORD),
        role="PICKER",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    print(f"created picker: {PICKER_EMAIL} / {PICKER_PASSWORD}")
    return user


def seed_orders(db, picker: User) -> None:
    existing_numbers = {
        o.order_number for o in db.query(Order).filter(Order.picker_id == picker.id).all()
    }
    created = 0
    for spec in DUMMY_ORDERS:
        order_spec = spec["order"]
        if order_spec["order_number"] in existing_numbers:
            continue
        order = Order(id=uuid.uuid4(), picker_id=picker.id, **order_spec)
        db.add(order)
        db.flush()  # assigns order.id's FK target before OrderItem rows reference it

        for item_spec in spec["items"]:
            verified = item_spec["quantity_verified"]
            expected = item_spec["quantity_expected"]
            db.add(OrderItem(
                id=uuid.uuid4(),
                order_id=order.id,
                status="VERIFIED" if verified >= expected else "PENDING",
                **item_spec,
            ))
        created += 1
    db.commit()
    print(f"seeded {created} new order(s) ({len(DUMMY_ORDERS) - created} already existed)")


def main():
    print(f"connecting to {engine.url!r}")
    Base.metadata.create_all(bind=engine)  # works whether or not `alembic upgrade head` was ever run
    print("tables ready")

    db = SessionLocal()
    try:
        picker = get_or_create_picker(db)
        seed_orders(db, picker)
    finally:
        db.close()

    print("\ndone — log in at /login with:")
    print(f"  email:    {PICKER_EMAIL}")
    print(f"  password: {PICKER_PASSWORD}")


if __name__ == "__main__":
    main()
