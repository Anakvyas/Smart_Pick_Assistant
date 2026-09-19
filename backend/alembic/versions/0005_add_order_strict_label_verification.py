"""add strict_label_verification to orders

Revision ID: 0005_add_order_strict_label_verification
Revises: 0004_add_order_item_unavailable
Create Date: 2026-09-19

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_add_order_strict_label_verification"
down_revision: Union[str, Sequence[str], None] = "0004_add_order_item_unavailable"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("orders", sa.Column("strict_label_verification", sa.Boolean(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("orders", "strict_label_verification")
