#!/usr/bin/env bash
# Rebuilds the test database from scratch, runs every SQL + API test and saves the output
# into docs/evidence/ (use these text files / screenshots of them in the report & viva).
#   usage: scripts/run_all_tests.sh <mysql-user> <mysql-password> [db_name]
set -euo pipefail
U="${1:-root}"; P="${2:-}"; DB="${3:-ev_charging_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; EV="$ROOT/docs/evidence"; mkdir -p "$EV"
MYSQL=(mysql -u"$U"); [ -n "$P" ] && MYSQL+=(-p"$P")

echo "== 1/5 Install database ($DB)"
"$ROOT/scripts/install_db.sh" "$DB" "${MYSQL[@]:1}" > "$EV/01_install_output.txt" 2>&1; tail -1 "$EV/01_install_output.txt"

echo "== 2/5 Constraint / view / query evidence"
{
  echo "### Unique constraint blocks a second ACTIVE booking for the same slot (database-level protection)"
  "${MYSQL[@]}" "$DB" -e "SELECT booking_id,user_id,slot_id,status,active_slot_id FROM booking WHERE slot_id=3;"
  "${MYSQL[@]}" "$DB" -e "INSERT INTO booking(user_id,slot_id,status) VALUES (4,3,'CONFIRMED');" 2>&1 || true
  echo; echo "### Views"
  "${MYSQL[@]}" "$DB" -t -e "SELECT * FROM Station_Availability_View;
    SELECT booking_id,user_name,booking_status,station_name,slot_start,energy_kwh,cost,payment_status FROM User_Booking_History_View;
    SELECT session_id,user_name,station_name,duration_minutes,energy_kwh,cost FROM Charging_Session_Summary_View;
    SELECT * FROM Station_Utilization_View;
    SELECT station_name,charger_type,slot_id,start_time FROM Available_Slots_View LIMIT 5;
    SELECT * FROM booking_audit;"
} > "$EV/02_constraints_and_views.txt" 2>&1
"${MYSQL[@]}" "$DB" -t < "$ROOT/database/05_queries.sql" > "$EV/03_important_queries_output.txt" 2>&1
echo "   saved"

echo "== 3/5 Pure-SQL transaction tests"
"${MYSQL[@]}" "$DB" -t < "$ROOT/database/tests/sql_tests.sql" 2>&1 | grep -v -E "^\+|session_id|booking_id" > "$EV/04_sql_tests.txt" || true
cat "$EV/04_sql_tests.txt" | tail -14

echo "== 4/5 API + DBMS tests (node:test)"
cd "$ROOT/backend"
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null
export DB_USER="$U" DB_PASSWORD="$P" DB_NAME="$DB"
node --test --test-concurrency=1 tests/*.test.js > "$EV/05_api_test_results.txt" 2>&1 || true
grep -E "^(not )?ok|^# (tests|pass|fail)" "$EV/05_api_test_results.txt"

echo "== 5/5 Concurrency demo"
node tests/demo_concurrency.js > "$EV/06_concurrency_demo.txt" 2>&1 || true
cat "$EV/06_concurrency_demo.txt"
