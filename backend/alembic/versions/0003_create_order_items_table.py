"""create order_items table

Revision ID: 0003_create_order_items_table
Revises: 0002_create_orders_table
Create Date: 2026-09-18

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_create_order_items_table"
down_revision: Union[str, Sequence[str], None] = "0002_create_orders_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "order_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("quantity_expected", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("quantity_verified", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("order_items_order_id_idx", "order_items", ["order_id"])
    op.create_index("order_items_barcode_idx", "order_items", ["barcode"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("order_items_barcode_idx", table_name="order_items")
    op.drop_index("order_items_order_id_idx", table_name="order_items")
    op.drop_table("order_items")
