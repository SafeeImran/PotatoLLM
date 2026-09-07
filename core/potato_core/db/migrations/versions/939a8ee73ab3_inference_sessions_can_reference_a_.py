"""inference sessions can reference a model artifact directly

Revision ID: 939a8ee73ab3
Revises: b7c6076896f4
Create Date: 2026-08-23 21:58:07.185499

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '939a8ee73ab3'
down_revision: Union[str, None] = 'b7c6076896f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite has no ALTER COLUMN / ADD CONSTRAINT — batch mode recreates the
    # table under the hood instead. Plain op.alter_column/create_foreign_key
    # (what autogenerate produced) fails with "near ALTER: syntax error".
    with op.batch_alter_table('inference_sessions') as batch_op:
        batch_op.add_column(sa.Column('model_artifact_id', sa.String(), nullable=True))
        batch_op.alter_column('build_id', existing_type=sa.VARCHAR(), nullable=True)
        batch_op.create_foreign_key('fk_inference_sessions_model_artifact_id', 'model_artifacts', ['model_artifact_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('inference_sessions') as batch_op:
        batch_op.drop_constraint('fk_inference_sessions_model_artifact_id', type_='foreignkey')
        batch_op.alter_column('build_id', existing_type=sa.VARCHAR(), nullable=False)
        batch_op.drop_column('model_artifact_id')
