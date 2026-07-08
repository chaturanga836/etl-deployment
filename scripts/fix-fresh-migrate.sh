#!/bin/sh
# Patch v1.0.1 API image migrations for fresh PostgreSQL installs, then alembic upgrade head.
set -e

ALEMBIC_DIR=/app/alembic
VERSIONS="$ALEMBIC_DIR/versions"

cat > "$ALEMBIC_DIR/migration_helpers.py" << 'PYEOF'
from __future__ import annotations
import sqlalchemy as sa
from alembic import op

def table_exists(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)
PYEOF

grep -q 'sys.path.insert(0, os.path.dirname(__file__))' "$ALEMBIC_DIR/env.py" || \
  sed -i "/sys.path.insert(0, os.path.abspath/a sys.path.insert(0, os.path.dirname(__file__))" "$ALEMBIC_DIR/env.py"

cat > "$VERSIONS/2026_03_17_1616-7fc24d0b3234_new_schemas_for_tomorrow_d_type.py" << 'PYEOF'
revision = '7fc24d0b3234'
down_revision = '68890bde842d'
branch_labels = None
depends_on = None

def upgrade():
    pass

def downgrade():
    pass
PYEOF

sed -i "s/op.drop_constraint('unique_tenant_source', 'watermark_states', type_='unique')/op.execute('ALTER TABLE watermark_states DROP CONSTRAINT IF EXISTS unique_tenant_source')/" \
  "$VERSIONS/2026_04_06_1452-4c6d14055ffa_pipeline_table.py"

cat > "$VERSIONS/2026_05_04_1625-9b7555e60448_pipetable_update.py" << 'PYEOF'
revision = '9b7555e60448'
down_revision = 'bfc989303aed'
branch_labels = None
depends_on = None

def upgrade():
    pass

def downgrade():
    pass
PYEOF

cat > "$VERSIONS/2026_05_08_1937-7af7833915ce_pipetable_update.py" << 'PYEOF'
"""pipetable_update - fresh-install safe."""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from migration_helpers import table_exists

revision: str = '7af7833915ce'
down_revision: Union[str, None] = '325dee71bdef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    if table_exists("pipeline_logic"):
        op.add_column("pipeline_logic", sa.Column("logic_type", sa.String(length=20), nullable=True))
        op.drop_index("ix_pipeline_logic_code_hash", table_name="pipeline_logic")
        op.create_index("idx_logic_hash", "pipeline_logic", ["code_hash"], unique=False)
        op.create_index("idx_logic_pipeline_lookup", "pipeline_logic", ["pipeline_id"], unique=False)
        op.create_unique_constraint(None, "pipeline_logic", ["code_hash"])
    op.add_column("pipeline_tasks", sa.Column("logic_id", sa.Integer(), nullable=True))
    op.drop_column("pipeline_tasks", "script_code")
    op.add_column("pipelines", sa.Column("canvas_structure", sa.JSON(), nullable=True))
    op.alter_column("pipelines", "pipeline_uuid", existing_type=sa.VARCHAR(length=50), type_=sa.String(length=100), nullable=True)
    op.alter_column("pipelines", "name", existing_type=sa.VARCHAR(), nullable=True)
    op.alter_column("pipelines", "version", existing_type=sa.INTEGER(), nullable=True)
    op.drop_index("ix_pipelines_pipeline_uuid", table_name="pipelines")
    op.create_index(op.f("ix_pipelines_pipeline_uuid"), "pipelines", ["pipeline_uuid"], unique=True)
    op.drop_column("pipelines", "created_at")
    op.drop_column("pipelines", "org_id")
    op.drop_column("pipelines", "workspace_id")

def downgrade() -> None:
    pass
PYEOF

cat > "$VERSIONS/2026_05_09_1510-3d3e18224817_pipetable_update.py" << 'PYEOF'
"""pipetable_update - fresh-install safe."""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from migration_helpers import table_exists

revision: str = '3d3e18224817'
down_revision: Union[str, None] = '7af7833915ce'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    if table_exists("pipeline_logic"):
        op.add_column("pipeline_logic", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True))
        op.add_column("pipeline_logic", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True))
    op.add_column("pipeline_tasks", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True))
    op.add_column("pipeline_tasks", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True))
    op.add_column("pipelines", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True))
    op.add_column("pipelines", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True))

def downgrade() -> None:
    pass
PYEOF

sed -i "s/op.drop_table('pipeline_logic')/op.execute('DROP TABLE IF EXISTS pipeline_logic CASCADE')/" \
  "$VERSIONS/2026_05_17_1103-7c1ff7df67cf_drop_pipe_task_table_and_logic_tables.py"
sed -i "s/op.drop_table('pipeline_tasks')/op.execute('DROP TABLE IF EXISTS pipeline_tasks CASCADE')/" \
  "$VERSIONS/2026_05_17_1103-7c1ff7df67cf_drop_pipe_task_table_and_logic_tables.py"

python3 << 'PYEOF'
from pathlib import Path

versions = Path("/app/alembic/versions")

def patch(path: str, old: str, new: str) -> None:
    p = versions / path
    text = p.read_text()
    if old not in text:
        if new.split("\n", 1)[0] in text:
            return
        print(f"skip patch (already updated or different tree): {path}")
        return
    p.write_text(text.replace(old, new, 1))

def ensure_import(path: str) -> None:
    p = versions / path
    text = p.read_text()
    if "from migration_helpers import table_exists" in text:
        return
    text = text.replace(
        "from alembic import op\n",
        "from alembic import op\n\nfrom migration_helpers import table_exists\n",
        1,
    )
    p.write_text(text)

patch(
    "2026_05_25_1300-d4e5f6a7b8c9_add_graph_structure_columns.py",
    """def upgrade() -> None:
    op.add_column("pipelines", sa.Column("graph_structure", sa.JSON(), nullable=True))
    op.add_column("workflows", sa.Column("graph_structure", sa.JSON(), nullable=True))
    op.add_column("pipeline_runs", sa.Column("graph_snapshot", sa.JSON(), nullable=True))
    op.add_column("workflow_runs", sa.Column("graph_snapshot", sa.JSON(), nullable=True))""",
    """def upgrade() -> None:
    op.add_column("pipelines", sa.Column("graph_structure", sa.JSON(), nullable=True))
    op.add_column("workflows", sa.Column("graph_structure", sa.JSON(), nullable=True))
    if table_exists("pipeline_runs"):
        op.add_column("pipeline_runs", sa.Column("graph_snapshot", sa.JSON(), nullable=True))
    if table_exists("workflow_runs"):
        op.add_column("workflow_runs", sa.Column("graph_snapshot", sa.JSON(), nullable=True))""",
)
ensure_import("2026_05_25_1300-d4e5f6a7b8c9_add_graph_structure_columns.py")

patch(
    "2026_05_28_1200-a7b8c9d0e1f2_plugin_platform.py",
    """    op.add_column("pipeline_runs", sa.Column("input_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("workflow_runs", sa.Column("input_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True))""",
    """    if table_exists("pipeline_runs"):
        op.add_column("pipeline_runs", sa.Column("input_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    if table_exists("workflow_runs"):
        op.add_column("workflow_runs", sa.Column("input_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True))""",
)
ensure_import("2026_05_28_1200-a7b8c9d0e1f2_plugin_platform.py")

patch(
    "2026_06_08_1200-c1d2e3f4a5b6_run_context_checkpoints.py",
    """def upgrade() -> None:
    op.add_column("pipeline_runs", sa.Column("run_context", sa.JSON(), nullable=True))
    op.add_column(
        "pipeline_runs",
        sa.Column("current_step_index", sa.Integer(), nullable=True),
    )
    op.add_column("pipeline_runs", sa.Column("parent_workflow_run_id", sa.Integer(), nullable=True))
    op.add_column(
        "pipeline_runs",
        sa.Column("parent_workflow_node_uuid", sa.String(length=64), nullable=True),
    )
    op.add_column("workflow_runs", sa.Column("run_context", sa.JSON(), nullable=True))
    op.add_column("workflow_runs", sa.Column("current_step_index", sa.Integer(), nullable=True))
    op.add_column(
        "workflow_runs",
        sa.Column("current_node_uuid", sa.String(length=64), nullable=True),
    )""",
    """def upgrade() -> None:
    if table_exists("pipeline_runs"):
        op.add_column("pipeline_runs", sa.Column("run_context", sa.JSON(), nullable=True))
        op.add_column(
            "pipeline_runs",
            sa.Column("current_step_index", sa.Integer(), nullable=True),
        )
        op.add_column("pipeline_runs", sa.Column("parent_workflow_run_id", sa.Integer(), nullable=True))
        op.add_column(
            "pipeline_runs",
            sa.Column("parent_workflow_node_uuid", sa.String(length=64), nullable=True),
        )
    if table_exists("workflow_runs"):
        op.add_column("workflow_runs", sa.Column("run_context", sa.JSON(), nullable=True))
        op.add_column("workflow_runs", sa.Column("current_step_index", sa.Integer(), nullable=True))
        op.add_column(
            "workflow_runs",
            sa.Column("current_node_uuid", sa.String(length=64), nullable=True),
        )""",
)
ensure_import("2026_06_08_1200-c1d2e3f4a5b6_run_context_checkpoints.py")

patch(
    "2026_06_09_1200-d2e3f4a5b6c7_pipeline_backfill_batch.py",
    """def upgrade() -> None:
    op.add_column(
        "pipeline_runs",
        sa.Column("backfill_batch_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_pipeline_runs_backfill_batch_id",
        "pipeline_runs",
        ["backfill_batch_id"],
        unique=False,
    )""",
    """def upgrade() -> None:
    if not table_exists("pipeline_runs"):
        return
    op.add_column(
        "pipeline_runs",
        sa.Column("backfill_batch_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_pipeline_runs_backfill_batch_id",
        "pipeline_runs",
        ["backfill_batch_id"],
        unique=False,
    )""",
)
ensure_import("2026_06_09_1200-d2e3f4a5b6c7_pipeline_backfill_batch.py")
PYEOF

echo "Running alembic upgrade head..."
alembic upgrade head
echo "Migrations complete."
