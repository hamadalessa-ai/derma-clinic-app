#!/usr/bin/env bash
# Downloads the newest backup from the "Backup live database" workflow, decrypts it and
# restores + checks it in RESTORE_URL (verify-restore.sh). Needs GH_TOKEN (actions: read).
set -euo pipefail
cd "$(dirname "$0")/../.."
run=$(gh run list --workflow backup-live-database.yml --status success --limit 20 \
  --json databaseId --jq '.[].databaseId' | while read -r id; do
    if gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id/artifacts" --jq '.artifacts[] | select(.name=="live-backup" and (.expired|not)) | .id' | grep -q .; then
      echo "$id"; break
    fi
  done)
if [[ -z "$run" ]]; then echo "No backup found. Run \"Backup live database\" first."; exit 1; fi
rm -rf restore && mkdir -p restore
gh run download "$run" --name live-backup --dir restore
file=$(ls restore/*.tar.gpg | tail -1)
echo "Using $(basename "$file") (run $run)"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt -o restore/live.tar "$file"
tar -C restore -xf restore/live.tar
scripts/backup/verify-restore.sh restore/live.dump restore/before.tsv restore/after.tsv
