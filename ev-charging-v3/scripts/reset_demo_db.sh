#!/usr/bin/env bash
# Rebuild the ev_charging database + create the HARRY login (a reinstall wipes the users table).
#   usage: scripts/reset_demo_db.sh <mysql-user> <mysql-password>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MYSQL=(mysql -u"${1:-root}"); [ -n "${2:-}" ] && MYSQL+=(-p"$2")
"${MYSQL[@]}" < "$ROOT/database/00_install_all_in_one.sql" > /dev/null
(cd "$ROOT/backend" && npm run seed:harry --silent)
