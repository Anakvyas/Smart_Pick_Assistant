"""add unavailable_reason/unavailable_at to order_items

Revision ID: 0004_add_order_item_unavailable
Revises: 0003_create_order_items_table
Create Date: 2026-09-18

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_add_order_item_unavailable"
down_revision: Union[str, Sequence[str], None] = "0003_create_order_items_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("order_items", sa.Column("unavailable_reason", sa.String(length=200), nullable=True))
    op.add_column("order_items", sa.Column("unavailable_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("order_items", "unavailable_at")
    op.drop_column("order_items", "unavailable_reason")
