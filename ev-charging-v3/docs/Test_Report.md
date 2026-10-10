# Test Report (FR-15)

Environment: MariaDB 10.11, Node 22, database rebuilt from scratch by `scripts/run_all_tests.sh`.
Raw outputs: `docs/evidence/`. Latest run (merged project): **API/DBMS tests 64/64, SQL tests 10/10, Aarya smoke test 30/30, real-browser test 26/26 — all pass.**
Extra evidence: `evidence/07_ui_browser_test.txt`, `evidence/08_aarya_smoke_test.txt`, `screenshots/` (17 images from the real app).

## A. Checklist test cases (from the project checklist) — Raushan's scope
| ID | Test case | Expected | Automated test | Status |
|---|---|---|---|---|
| T02 | Duplicate email | Rejected by constraint | `validation.test.js` "T02 duplicate email…" | ✅ |
| T07 | View availability | Correct free/occupied slots | "FR-12 views agree with the base tables", "availability API…" | ✅ |
| T08 | Valid booking | Booking committed | `booking_transaction` "T08…" | ✅ |
| T09 | Same-slot booking | Only one succeeds | `concurrency` T09 (2 users), T09b (25 users), T09c, T09d | ✅ |
| T10 | Cancellation | Cancelled + resource released | `cancellation` "T10…" | ✅ |
| T11 | Invalid cancellation | Rejected per rules | `cancellation` T11a–e | ✅ |
| T12 | Start session | Valid booking starts session | `session` "T12+T13…", too-early / early-window tests | ✅ |
| T13 | End session | End time/energy/cost stored | `session` "T12+T13…" | ✅ |
| T14 | History | Correct records shown | `history_views` T14 + 3 more | ✅ |
| T15 | DB failure during booking | Rollback, no partial data | `booking_transaction` "T15…"; SQL test S3 | ✅ |
| T16 | Admin update | Station/slot changes reflected | `admin` "T16…" + 5 more | ✅ |
| T01 | Valid registration | Account created | `auth_stations.test.js`, browser test | ✅ |
| T03, T04 | Valid / invalid login | Opens app / clear error | `auth_stations.test.js`, browser test | ✅ |
| T05 | Station search | Matching stations | `auth_stations.test.js`, browser test | ✅ |
| T06 | Geolocation | Nearby stations + distances | `auth_stations.test.js` (distance maths), browser test with fake GPS | ✅ |

## B. Additional tests written
| Area | Tests |
|---|---|
| Booking rules | past slot, blocked slot, unknown slot, charger in maintenance, overlapping bookings by one user, deactivated user |
| Database-level | UNIQUE blocks 2nd active booking even when bypassing the procedure; CHECK constraints (time order, power, latitude) |
| Concurrency | 2 users, 25 users, same user/2 slots, booking vs cancellation race |
| Sessions | cancelled booking, too early, after slot end, not owner, double start, double end, bad energy values (−1, text, null, missing, over physical limit), maintenance |
| Security / validation | 10 invalid `slot_id` variants, malformed JSON, SQL-injection strings, forged admin token, token signed with wrong secret, no SQL text in error responses, direct procedure input guards |
| Admin | role checks 401/403, station→charger→slot lifecycle, idempotent slot generation, overlap refusal, block/unblock, delete protection (FK RESTRICT), dashboard |

## C. Pure-SQL tests (`database/tests/sql_tests.sql`)
S1 booking commit · S2 second user rejected · S3 rollback after failure · S4 cancel releases slot · S5 double cancel rejected · S6 UNIQUE blocks duplicate · S7 session cost/payment · S8 impossible energy rejected · S9 no slot with >1 active booking · S10 view returns rows → **10/10 PASS**.

## D. How to repeat
```bash
scripts/run_all_tests.sh <mysql-user> <mysql-password>
```
Take screenshots of `docs/evidence/04_sql_tests.txt`, `05_api_test_results.txt` and `06_concurrency_demo.txt` for the report.
