"""create orders table

Revision ID: 0002_create_orders_table
Revises: 0001_create_users_table
Create Date: 2026-09-17

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_create_orders_table"
down_revision: Union[str, Sequence[str], None] = "0001_create_users_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_number", sa.String(length=50), nullable=False),
        sa.Column("picker_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="ASSIGNED"),
        sa.Column("product_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unit_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("picked_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("orders_order_number_idx", "orders", ["order_number"], unique=True)
    op.create_index("orders_picker_id_idx", "orders", ["picker_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("orders_picker_id_idx", table_name="orders")
    op.drop_index("orders_order_number_idx", table_name="orders")
    op.drop_table("orders")
