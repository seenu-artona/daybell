#!/usr/bin/env bash
# Runs the pgTAP database tests against a plain local Postgres (no Docker needed).
# CI runs the same tests against the real Supabase stack with `supabase test db`.
# Usage: DATABASE_URL=postgres://postgres@localhost:54329/postgres pnpm --filter @daybell/db test:local
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Set DATABASE_URL to a disposable Postgres server}"
db="daybell_test_$$"
admin="${DATABASE_URL%/*}/postgres"
psql "$admin" -qc "create database $db" >/dev/null
trap 'psql "$admin" -qc "drop database if exists $db" >/dev/null' EXIT
url="${DATABASE_URL%/*}/$db"
psql "$url" -q -v ON_ERROR_STOP=1 -f test/supabase-stubs.sql >/dev/null
for m in supabase/migrations/*.sql; do psql "$url" -q -v ON_ERROR_STOP=1 -f "$m" >/dev/null; done
failed=0
for t in supabase/tests/database/*.test.sql; do
  out=$(psql "$url" -qtA -v ON_ERROR_STOP=1 -f "$t" 2>&1) || { echo "$out"; failed=1; continue; }
  echo "# $(basename "$t")"
  echo "$out" | grep -E '^(ok|not ok|#)' || true
  if echo "$out" | grep -qE '^not ok|Looks like'; then failed=1; fi
done
exit $failed
