#!/usr/bin/env bash
# Usage: scripts/install_db.sh [db_name] [mysql args...]
#   e.g. scripts/install_db.sh ev_charging -u root -p
set -euo pipefail
DB="${1:-ev_charging}"; shift || true
HERE="$(cd "$(dirname "$0")/.." && pwd)/database"
MYSQL=(mysql "$@")
"${MYSQL[@]}" -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
for f in 01_schema.sql 02_procedures.sql 03_views.sql 04_sample_data.sql; do
  echo "-> $f"
  "${MYSQL[@]}" "$DB" < "$HERE/$f"
done
echo "Database '$DB' is ready."
