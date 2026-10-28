#!/bin/bash
# Fresh DB, stubs, then every migration in order. Stops at the first error.
H=/tmp/pgtest; P=5499
psql -h $H -p $P -U postgres -q -c "drop database if exists t" -c "create database t" >/dev/null
psql -h $H -p $P -U postgres -d t -q -v ON_ERROR_STOP=1 -f "$(dirname "$0")/stubs.sql" >/dev/null || exit 1
for f in /home/claude/schools-social/supabase/migrations/*.sql; do
  sed -e 's/^create extension if not exists pg_cron;//' -e 's/^create extension if not exists pg_net;//' "$f" > /tmp/pgtest/m.sql
  psql -h $H -p $P -U postgres -d t -q -v ON_ERROR_STOP=1 -f /tmp/pgtest/m.sql >/dev/null 2>/tmp/pgtest/err || { echo "FAIL $f"; cat /tmp/pgtest/err; exit 1; }
done
echo "all migrations OK"
