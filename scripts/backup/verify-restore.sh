#!/usr/bin/env bash
# Restores a backup into an EMPTY scratch database (RESTORE_URL) and checks it:
#   every table's row count lies between the counts taken before and after the dump,
#   and every clinic table still has row-level security ENABLED + FORCED.
# Usage: verify-restore.sh <live.dump> <before.tsv> <after.tsv>
set -euo pipefail
export LC_ALL=C
dump=$1 before=$2 after=$3
: "${RESTORE_URL:?RESTORE_URL (empty scratch database) is required}"

psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
set client_min_messages = warning;
drop schema if exists public cascade;
drop schema if exists ops cascade;
create schema public;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
do $$ begin
  if not exists (select from pg_roles where rolname = 'clinic_app') then
    create role clinic_app nologin;
  end if;
end $$;
SQL
# "public" already exists in the scratch database; pg_restore's own "create schema public" is skipped.
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_URL" \
  --use-list=<(pg_restore --list "$dump" | grep -v ' SCHEMA - public ') "$dump"

psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -qAt -F $'\t' -f scripts/backup/manifest.sql > restored.tsv
# Tables that change every minute (sign-in sessions, rate-limit counters) are not compared.
skip='^public\.(sessions|verifications|global_rate_hits|rate_limit_hits)$'
bad=$(join -t $'\t' <(sort "$before") <(sort "$after") | join -t $'\t' - <(sort restored.tsv) |
  awk -F'\t' -v skip="$skip" '$1 !~ skip {lo=($2<$3)?$2:$3; hi=($2>$3)?$2:$3; if ($4<lo || $4>hi) print $1": "$4" (expected "lo"-"hi")"}')
missing=$(comm -23 <(cut -f1 "$after" | sort) <(cut -f1 restored.tsv | sort))
rm -f restored.tsv
if [[ -n "$bad$missing" ]]; then
  echo "RESTORE CHECK FAILED"; echo "$bad"; [[ -n "$missing" ]] && echo "missing tables: $missing"
  exit 1
fi
weak=$(psql "$RESTORE_URL" -qAt -c "
  select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attname = 'tenant_id'
     and not (c.relrowsecurity and c.relforcerowsecurity)")
if [[ -n "$weak" ]]; then echo "RLS not forced after restore on: $weak"; exit 1; fi
echo "Restore check OK: $(wc -l < "$after") tables match."
