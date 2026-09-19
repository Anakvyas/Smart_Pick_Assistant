"""add position to order_items

Revision ID: 0007_add_order_item_position
Revises: 0006_add_order_item_gstin
Create Date: 2026-09-19

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_add_order_item_position"
down_revision: Union[str, Sequence[str], None] = "0006_add_order_item_gstin"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("order_items", sa.Column("position", sa.Integer(), nullable=False, server_default="0"))

    # Backfill existing rows with their current created_at/id order, per
    # order — without this every pre-existing order's items would all land
    # on position 0 (the column default) and "first pending" would go back
    # to being an arbitrary tie, exactly the bug this column exists to fix.
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, order_id FROM order_items ORDER BY order_id, created_at, id"
    )).fetchall()
    counters: dict = {}
    for row in rows:
        idx = counters.get(row.order_id, 0)
        bind.execute(
            sa.text("UPDATE order_items SET position = :p WHERE id = :id"),
            {"p": idx, "id": row.id},
        )
        counters[row.order_id] = idx + 1

    op.alter_column("order_items", "position", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("order_items", "position")
