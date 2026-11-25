#!/usr/bin/env bash
# Nightly backup of the LIVE database ("Backup live database" workflow).
#   LIVE_BACKUP_URL    read-only backup login (backup_reader, see docs/GO_LIVE.md)
#   BACKUP_PASSPHRASE  encrypts the copy (AES-256); without it the copy can't be opened
#   RESTORE_URL        an empty scratch Postgres (the workflow's service) for the test restore
# Output: backup/live-<date>.tar.gpg (encrypted dump + row-count manifest).
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/../.."
out=backup; mkdir -p "$out/work"; work="$out/work"
stamp=$(date -u +%Y-%m-%dT%H%MZ)

psql "$LIVE_BACKUP_URL" -v ON_ERROR_STOP=1 -qAt -F $'\t' -f scripts/backup/manifest.sql > "$work/before.tsv"
pg_dump "$LIVE_BACKUP_URL" --format=custom --compress=9 --no-owner --no-privileges \
  --schema=public --schema=ops --file="$work/live.dump"
psql "$LIVE_BACKUP_URL" -v ON_ERROR_STOP=1 -qAt -F $'\t' -f scripts/backup/manifest.sql > "$work/after.tsv"

# Prove the copy opens and is complete before keeping it.
scripts/backup/verify-restore.sh "$work/live.dump" "$work/before.tsv" "$work/after.tsv"

tables=$(wc -l < "$work/after.tsv")
rows=$(awk -F'\t' '{s+=$2} END {print s+0}' "$work/after.tsv")
size=$(stat -c %s "$work/live.dump")
tar -C "$work" -cf "$work/live.tar" live.dump before.tsv after.tsv
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback \
  --passphrase-fd 0 --symmetric --cipher-algo AES256 -o "$out/live-$stamp.tar.gpg" "$work/live.tar"
rm -rf "$work"

psql "$LIVE_BACKUP_URL" -v ON_ERROR_STOP=1 -q -c \
  "insert into ops.backup_runs (size_bytes, tables, rows) values ($size, $tables, $rows)"
echo "Backup OK: $tables tables, $rows rows, $size bytes (encrypted: live-$stamp.tar.gpg)"
