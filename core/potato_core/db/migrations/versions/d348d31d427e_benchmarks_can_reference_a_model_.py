"""benchmarks can reference a model artifact directly

Revision ID: d348d31d427e
Revises: 1083fbe1178c
Create Date: 2026-08-28 18:20:24.545495

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd348d31d427e'
down_revision: Union[str, None] = '1083fbe1178c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite has no ADD CONSTRAINT — batch mode recreates the table under
    # the hood instead. Plain op.create_foreign_key (what autogenerate
    # produced) fails at runtime the same way it did for InferenceSession's
    # equivalent migration (see 939a8ee73ab3).
    with op.batch_alter_table('benchmarks') as batch_op:
        batch_op.add_column(sa.Column('model_artifact_id', sa.String(), nullable=True))
        batch_op.create_foreign_key('fk_benchmarks_model_artifact_id', 'model_artifacts', ['model_artifact_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('benchmarks') as batch_op:
        batch_op.drop_constraint('fk_benchmarks_model_artifact_id', type_='foreignkey')
        batch_op.drop_column('model_artifact_id')
