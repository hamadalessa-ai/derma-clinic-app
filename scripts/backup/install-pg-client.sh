#!/usr/bin/env bash
# PostgreSQL 17 client tools (pg_dump must be at least the server's version) from the official
# PostgreSQL apt repository.
set -euo pipefail
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" |
  sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq postgresql-client-17 > /dev/null
echo "/usr/lib/postgresql/17/bin" >> "${GITHUB_PATH:-/dev/null}"
/usr/lib/postgresql/17/bin/pg_dump --version
