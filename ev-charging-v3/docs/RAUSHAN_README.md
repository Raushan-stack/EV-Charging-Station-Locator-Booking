# EV Charging Station Locator & Booking — Raushan's Part (FR-08 to FR-15)

Database + backend integrity layer: **transactions, cancellation, charging sessions, history, SQL views,
admin backend, validation/error handling, tests and DBMS evidence.**

Everything here was built and tested against a real database (MariaDB 10.11):
**51 API/DBMS tests + 10 pure-SQL tests pass**, and the evidence output is in `docs/evidence/`.

## Folder layout

```
database/
  01_schema.sql        tables, PK/FK, UNIQUE/CHECK, indexes, audit triggers
  02_procedures.sql    sp_book_slot, sp_cancel_booking, sp_start_session, sp_end_session, sp_generate_slots
  03_views.sql         5 SQL views (FR-12)
  04_sample_data.sql   4 users, 5 stations, 9 chargers, ~320 slots, sample bookings/session
  05_queries.sql       12 important queries for report/viva
  tests/sql_tests.sql  pure-SQL transaction/rollback/constraint tests
backend/               Node.js + Express + mysql2 API
  src/ (routes, services, middleware, validators, errors)
  tests/               51 automated tests + concurrency demo
scripts/
  install_db.sh        build the database
  run_all_tests.sh     rebuild DB, run every test, write docs/evidence/*
docs/
  FR_Mapping.md        every FR -> files -> how it is proven
  DB_Design.md         ER diagram, relational schema, normalization, indexes
  API_Reference.md     all endpoints + integration contract for Aarya
  DBMS_Viva_Notes.md   explanations + likely viva questions
  Test_Report.md       test-case table (T01-T16 + extras)
  Demo_Script.md       step-by-step live demo
  evidence/            real output of the test runs
```

## Quick start

Requirements: MySQL 8+ (or MariaDB 10.5+), Node.js 18+.

```bash
# 1. database
scripts/install_db.sh ev_charging -u root -p          # creates DB, tables, procedures, views, sample data

# 2. backend
cd backend
cp .env.example .env        # set DB_PASSWORD and JWT_SECRET
npm install
npm start                   # http://localhost:3000/api/health

# 3. tests (rebuilds a separate ev_charging_test database)
cd ..
scripts/run_all_tests.sh root <your-mysql-password>
```

Sample logins (all passwords `Password@123`): `admin@evcharge.test`, `usera@evcharge.test`,
`userb@evcharge.test`, `userc@evcharge.test`.

Slots in the sample data are generated relative to **today** (today + 3 days, 24 h). Re-run
`scripts/reset_demo_db.sh` before a demo if the data is more than a couple of days old.

## What Aarya needs from this (integration)

See `docs/API_Reference.md`, section "Integration contract". In short:
1. Use the same `JWT_SECRET`; sign tokens (HS256) with `{ "user_id": <users.user_id> }`.
2. Send `Authorization: Bearer <token>` on every call except `/api/availability/*`.
3. Booking = `POST /api/bookings {slot_id}`; a second user gets `409 SLOT_UNAVAILABLE` — show that message.

## Notes / honest limitations

* Verified on **MariaDB 10.11**. The SQL uses only features common to MySQL 8.0 (generated columns, CHECK, stored procedures, triggers), but I could not run it on MySQL 8 itself here — run `scripts/run_all_tests.sh` once on your MySQL to confirm.
* Screenshots are not included (they must come from your own screen). `docs/evidence/` has the raw text output you can screenshot, plus `Demo_Script.md` for the live demo.
* Payments are a simple record created when a session ends (no real gateway) — listed as future scope in the project doc.
* `simulate_failure` (rollback demo) only works when `ENABLE_TEST_HOOKS=true`; `X-User-Id` login only when `ALLOW_DEV_AUTH=true`. Keep both off outside development.
