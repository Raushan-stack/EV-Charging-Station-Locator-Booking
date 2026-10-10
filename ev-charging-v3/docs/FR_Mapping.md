# FR Mapping — Raushan (FR-08 to FR-15)

| FR | Requirement | Implemented in | Proven by |
|---|---|---|---|
| **FR-08** | Database transactions: atomic booking, commit, rollback, no partial data | `database/02_procedures.sql` → `sp_book_slot` (START TRANSACTION … COMMIT, `EXIT HANDLER` → ROLLBACK). Every other procedure follows the same pattern. `backend/src/services/bookingService.js` | API test T08, **T15** (`simulate_failure` rolls back an already-executed INSERT + UPDATE + trigger audit row); SQL tests S1, S3; evidence `04_sql_tests.txt`, `05_api_test_results.txt` |
| **FR-09** | Cancellation: validate, update status, release slot | `sp_cancel_booking`; route `POST /api/bookings/:id/cancel` | T10, T11a–e (twice, not owner, cut-off, in-progress/completed, unknown id); SQL S4, S5 |
| **FR-10** | Charging session: eligible booking only, start/end time, energy, cost, close | `sp_start_session`, `sp_end_session`; routes `/api/sessions/*`; creates `payment` row | T12, T13 + 6 more session tests; SQL S7, S8 |
| **FR-11** | Booking & charging history queries/API | `User_Booking_History_View`, `Charging_Session_Summary_View`; `GET /api/history/bookings`, `/sessions` (filters, pagination, totals) | T14 + 3 history tests |
| **FR-12** | SQL views | `database/03_views.sql`: `Available_Slots_View`, `Station_Availability_View`, `User_Booking_History_View`, `Charging_Session_Summary_View`, `Station_Utilization_View` | "views agree with base tables" test; `02_constraints_and_views.txt`; `03_important_queries_output.txt` |
| **FR-13** | Admin backend: stations, chargers, slots, monitoring, role checks | `backend/src/routes/admin.js`, `services/adminService.js`, `middleware/auth.js` (`requireAdmin`, role re-read from DB) | T16, role tests (401/403/forged token) |
| **FR-14** | Validation & error handling | `backend/src/validators.js`, `errors.js`, `middleware/errorHandler.js`; `SIGNAL` errors 50001–50099 inside procedures; CHECK/UNIQUE/FK constraints | `validation.test.js` (8 tests): bad IDs, malformed JSON, SQL-injection strings, no SQL leakage |
| **FR-15** | Tests + DBMS demonstration | `backend/tests/`, `database/tests/sql_tests.sql`, `scripts/run_all_tests.sh`, `docs/evidence/`, `docs/DBMS_Viva_Notes.md`, `docs/Demo_Script.md` | 51 + 10 tests, all passing |

Also delivered as the "database foundation" in your development order: full schema (7 tables + audit + settings), constraints, indexes, sample data, ER diagram and normalization (`DB_Design.md`).

## Where Raushan's code touches Aarya's FRs (integration only — ownership unchanged)
* FR-05 availability UI reads `GET /api/availability/slots` and `/stations` (backed by my views).
* FR-06 booking UI calls `POST /api/bookings`.
* FR-07 concurrent demo UI shows the `409 SLOT_UNAVAILABLE` response; the protection itself is in `sp_book_slot` + `uq_active_slot`.
* FR-01 login must issue the JWT my `auth.js` verifies (contract in `API_Reference.md`).

## Inconsistency in your three project PDFs
The *FR Exclusive Task Division* PDF (FR-01–07 Aarya, FR-08–15 Raushan) conflicts with the owner column in the *Checklist* "FR Completion Tracker" (e.g. FR-02, FR-05, FR-06, FR-07 listed as Raushan; FR-09–11 as Aarya; FR-14/15 "Both"). I followed the **exclusive division PDF**, since it states the rule explicitly. Please confirm with Aarya and update the tracker.
