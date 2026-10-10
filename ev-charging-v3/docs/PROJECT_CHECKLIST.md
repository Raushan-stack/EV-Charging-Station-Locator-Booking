# Project checklist — status of every item in the "Complete Checklist" PDF

Legend: ✅ done and verified here · 🟡 done with a limitation (read the note) · ⬜ not done / only you can do it

## 1. Planning
- ✅ Project title and problem statement — `docs/` and the Detailed Solution PDF
- ✅ Aarya / Raushan responsibilities — `README.md` FR table (FR-01–07 Aarya, FR-08–15 Raushan, per the Exclusive Division PDF)
- ✅ FR-01 to FR-15 scope
- ✅ Frontend technology — plain HTML/CSS/JavaScript (`frontend/`)
- ✅ Backend technology — Node.js + Express + mysql2
- 🟡 MySQL version — written for MySQL 8.0.16+; **tested on MariaDB 10.11 only** ⬜ run `SELECT VERSION();` on your PC and run the tests there
- ⬜ Git repository — run `git init`, commit, push (`.gitignore` already excludes `.env` and `node_modules`)
- ✅ Sample station/charger/slot data — `database/04_sample_data.sql`

## 2. Database design
- ✅ Entities: User, ChargingStation, Charger, ChargingSlot, Booking, ChargingSession, Payment (+ BookingAudit, AppSetting)
- ✅ Attributes + data types, PK, FK, cardinalities — `docs/DB_Design.md`
- ✅ ER diagram — `docs/ER_diagram.png` (generated from the live schema)
- ✅ Relational schema — `docs/DB_Design.md` §2
- ✅ 1NF / 2NF / 3NF — `docs/DB_Design.md` §4
- ✅ NOT NULL / UNIQUE / CHECK constraints — `database/01_schema.sql`
- ✅ Indexes — `docs/DB_Design.md` §5

## 3. SQL implementation
- ✅ CREATE DATABASE / TABLE — `00_install_all_in_one.sql`, `01_schema.sql`
- ✅ Sample users, stations, chargers, slots, test bookings — `04_sample_data.sql`
- ✅ Station search, available-slot, join, history, utilization queries — `database/05_queries.sql` (output in `docs/evidence/03_important_queries_output.txt`)
- ✅ Availability VIEW, booking/history VIEW (+3 more) — `03_views.sql`
- ✅ Test all constraints — `docs/evidence/04_sql_tests.txt`, API tests

## 4. Transaction & concurrency (critical)
- ✅ Transaction boundary, re-check inside transaction, row locking, insert after protected check — `sp_book_slot` (`02_procedures.sql`)
- ✅ Commit / rollback — SQL test S3, API test T15
- ✅ Database-level duplicate prevention — `UNIQUE(booking.active_slot_id)`
- ✅ Two test users, same slot, exactly one succeeds, second rejected — `docs/evidence/06_concurrency_demo.txt`, UI demo screenshot `docs/screenshots/10_double_booking_demo.png`, 25-user stress test
- ⬜ Screenshots of the **MySQL terminal** demo for the viva — follow `docs/Demo_Script.md` §3, §5, §6 and take them on your own screen

## 5. Backend
- ✅ Project, DB connection, User API, login API, Station API, Charger API, Slot/Availability API, Booking API, Cancellation API, Session API, History API, Admin APIs, validation, error handling — `docs/API_Reference.md`
- ✅ Test APIs independently — `npm test` (64 tests), `npm run test:aarya` (30 checks)

## 6. Frontend
- ✅ Login/Register · ✅ search · ✅ location permission handling (denied / unavailable messages) · ✅ nearby list with distance
- 🟡 Nearby **map** — list + "view on map" link to OpenStreetMap, no embedded map
- ✅ Station details · ✅ charger/slot availability grid · ✅ booking + confirmation dialog · ✅ booking history · ✅ cancellation
- ✅ Charging-session screen (Start / End charging in *My bookings*) · ✅ session history with kWh and cost
- 🟡 "User dashboard" — station search is the home page, *My bookings* is the personal page (no separate dashboard)
- ✅ Admin dashboard (overview, stations & chargers, bookings, sessions, slots)
- ✅ Error/success messages · ✅ responsive (no sideways scrolling at 390 px — browser test)

## 7. Functional tests
| ID | Test | Status | Where |
|---|---|---|---|
| T01 | Valid registration | ✅ | `auth_stations.test.js`, browser test |
| T02 | Duplicate email (and name) | ✅ | same + DB constraint test |
| T03 | Valid login | ✅ | same |
| T04 | Invalid login | ✅ | same |
| T05 | Station search | ✅ | `auth_stations.test.js`, browser |
| T06 | Geolocation | ✅ | distance maths checked (≈1.11 km per 0.01°), browser with fake GPS |
| T07 | View availability | ✅ | slot-grid test, browser |
| T08 | Valid booking | ✅ | `booking_transaction.test.js`, browser |
| T09 | Same-slot booking | ✅ | `concurrency.test.js` (2 and 25 users), browser demo |
| T10 | Cancellation | ✅ | `cancellation.test.js`, browser |
| T11 | Invalid cancellation | ✅ | `cancellation.test.js` (5 cases) |
| T12 | Start session | ✅ | `session.test.js`, browser |
| T13 | End session | ✅ | same |
| T14 | History | ✅ | `history_views.test.js`, browser |
| T15 | DB failure during booking → rollback | ✅ | `booking_transaction.test.js`, `sql_tests.sql` S3 |
| T16 | Admin update | ✅ | `admin.test.js`, browser |
- ⬜ Fill the **Status** column in your own copy of the PDF/report table and add screenshots from `docs/screenshots/`.

## 8. FR completion tracker (owner per the Exclusive Division PDF)
| FR | Owner | Code | Tested |
|---|---|---|---|
| 01 Registration/Login | Aarya | ✅ | ✅ |
| 02 Station management | Aarya | ✅ (view + admin screens) | ✅ |
| 03 Search | Aarya | ✅ | ✅ |
| 04 Geolocation | Aarya | ✅ | ✅ |
| 05 Availability | Aarya | ✅ | ✅ |
| 06 Booking | Aarya | ✅ | ✅ |
| 07 Concurrency demo | Aarya | ✅ | ✅ |
| 08–15 | Raushan | ✅ | ✅ |
- ⬜ The checklist PDF's tracker lists different owners (e.g. FR-05/06/07 Raushan, FR-09–11 Aarya, FR-14/15 "Both"). Ask your teacher which table counts and make the PDF consistent.

## 9. Final integration
- ✅ Frontend calls backend · ✅ backend reads/writes DB · ✅ views correct · ✅ booking updates availability · ✅ cancellation releases slot · ✅ session linked to booking · ✅ no duplicate booking under concurrency · ✅ understandable error messages · ✅ clean sample data
- ✅ No secrets hard-coded: `.env` is git-ignored; JWT secret is required from the environment. 🟡 Demo logins (`harry@123`, `Password@123`) appear in the README and sample data — fine for a demo, change before making a repo public.

## 10. Documentation (report) — **not written yet; material is ready**
- ⬜ Cover page · ⬜ certificate/acknowledgement · ⬜ abstract · ⬜ problem statement · ⬜ objectives · ⬜ existing problem · ⬜ proposed solution · ⬜ conclusion · ⬜ future scope · ⬜ SDG 7 connection
- ✅ material to paste: functional requirements (`FR_Mapping.md`), ER diagram, relational schema, normalization (`DB_Design.md`), important SQL (`05_queries.sql`), views (`03_views.sql`), transactions/concurrency (`DBMS_Viva_Notes.md`), testing table (`Test_Report.md`), limitations (`COMPLETENESS_AUDIT.md`), **screenshots (`docs/screenshots/`, 17 images)**

## 11. PPT — **not made yet**
- ⬜ All 12 slides in the checklist (title, problem, solution, workflow, ER, DBMS concepts, concurrency slide, screenshots, testing, SDG 7, future scope, conclusion). Use `ER_diagram.png`, `screenshots/10_double_booking_demo.png`, `evidence/05_api_test_results.txt`.

## 12. Live demo script (all steps work without manual database fixes)
1. ✅ Reset: `scripts/reset_demo_db.sh root <pw>` then `cd backend && npm start`; open http://localhost:3000, login `HARRY` / `harry@123`
2. ✅ Search "Saket" or press *Use my location* · 3. ✅ open station · 4. ✅ show free slot · 5. ✅ book
6. ✅ *My bookings* shows it · 7./8. ✅ *Double-booking demo* page → one Booked, one Rejected (explain `sp_book_slot` + row lock + UNIQUE constraint)
9. ✅ cancel (slot must start > 60 min away) → station page shows it free again
10. ✅ book the slot of the *current hour* → *My bookings* → Start charging → End charging (enter kWh)
11. ✅ `mysql` → `SELECT * FROM Charging_Session_Summary_View;` · 12. conclude with DBMS concepts + SDG 7
- ⬜ Rehearse it twice on **your** laptop (browser location prompt, MySQL password, port 3000 free).

## 13. Final submission gate
| Gate | Status |
|---|---|
| Database | ✅ |
| Backend | ✅ |
| Frontend | ✅ (browser-tested, 26 checks) |
| Concurrency | ✅ |
| Testing | ✅ here · ⬜ repeat once on your MySQL |
| Documentation | ⬜ report/PPT/certificate not written |
| Demo | 🟡 works end-to-end here; ⬜ rehearse on your machine |
