"""add gstin to order_items

Revision ID: 0006_add_order_item_gstin
Revises: 0005_add_order_strict_label_verification
Create Date: 2026-09-19

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_add_order_item_gstin"
down_revision: Union[str, Sequence[str], None] = "0005_add_order_strict_label_verification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("order_items", sa.Column("gstin", sa.String(length=20), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("order_items", "gstin")
