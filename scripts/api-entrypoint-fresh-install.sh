#!/bin/sh
# API entrypoint for registry images with legacy Alembic revisions on fresh Postgres.
# Waits for Postgres, applies host-mounted migration patches, then starts Supervisor.
set -e

echo "Waiting for PostgreSQL..."
DATABASE_URL="${DATABASE_URL:-postgresql://elt:changeme@postgres:5432/dtorc_metadata}"
i=0
last_err=""
while [ "$i" -lt 60 ]; do
  err_file="/tmp/pg_wait_err_$$"
  if python -c "
import os, sys
from sqlalchemy import create_engine, text
url = os.environ.get('DATABASE_URL', '').replace('+asyncpg', '')
if not url:
    sys.exit(1)
engine = create_engine(url, pool_pre_ping=True)
with engine.connect() as conn:
    conn.execute(text('SELECT 1'))
" 2>"$err_file"; then
    rm -f "$err_file"
    echo "PostgreSQL is ready."
    break
  fi
  last_err=$(cat "$err_file" 2>/dev/null || true)
  rm -f "$err_file"
  i=$((i + 1))
  sleep 2
done
if [ "$i" -ge 60 ]; then
  echo "ERROR: PostgreSQL not reachable after 120s — API cannot start."
  if [ -n "$last_err" ]; then
    echo "Last error: $last_err"
  fi
  exit 1
fi

if [ -f /opt/migrate-fix/fix-fresh-migrate.sh ]; then
  echo "Applying fresh-install migration patches..."
  sh /opt/migrate-fix/fix-fresh-migrate.sh
else
  echo "Running migrations (API instance init)..."
  alembic upgrade head
fi

echo "Starting Supervisor..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
