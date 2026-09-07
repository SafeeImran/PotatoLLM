"""add mmproj columns for vision models

Revision ID: 2545406e52b1
Revises: 616757e08640
Create Date: 2026-09-01 03:40:01.345561

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '2545406e52b1'
down_revision: Union[str, None] = '616757e08640'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("model_artifacts", sa.Column("mmproj_path", sa.String(), nullable=True))
    # server_default is required: existing rows need a value for a NOT NULL
    # column, and SQLite cannot add one without it.
    op.add_column(
        "models",
        sa.Column("mmproj_download_url", sa.String(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("models", "mmproj_download_url")
    op.drop_column("model_artifacts", "mmproj_path")
