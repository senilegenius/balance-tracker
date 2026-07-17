#!/bin/sh
# Create (if needed) and reset the dedicated test database.
# Tests NEVER run against balance_tracker — only balance_tracker_test.
set -e

DB_NAME="${TEST_DB_NAME:-balance_tracker_test}"

psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || createdb "${DB_NAME}"

psql -q -d "${DB_NAME}" -f db/schema.sql
