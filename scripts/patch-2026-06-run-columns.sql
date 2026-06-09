-- Emergency patch: pipeline/workflow run columns (Phase A + backfill)
-- Safe to re-run (IF NOT EXISTS). Prefer: docker exec elt-api alembic upgrade head
--
-- Apply (from etl-deployment host):
--   docker exec -i elt-postgres psql -U elt -d elt_metadata < scripts/patch-2026-06-run-columns.sql

-- pipeline_runs
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS run_context JSON;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS current_step_index INTEGER;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS parent_workflow_run_id INTEGER;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS parent_workflow_node_uuid VARCHAR(64);
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS backfill_batch_id VARCHAR(36);

CREATE INDEX IF NOT EXISTS ix_pipeline_runs_backfill_batch_id
    ON pipeline_runs (backfill_batch_id);

-- workflow_runs
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS run_context JSON;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS current_step_index INTEGER;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS current_node_uuid VARCHAR(64);
