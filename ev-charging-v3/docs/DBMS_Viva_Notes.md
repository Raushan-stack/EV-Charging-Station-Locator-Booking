# DBMS Viva Notes — Raushan (FR-08 to FR-15)

## 1. The core problem in one minute
Two users press "Book" for the same slot at the same instant. A naive app does `SELECT` (slot free? yes) then `INSERT booking`.
Both SELECTs run before either INSERT, both see "free", both INSERT → **double booking** (a *check-then-act race condition*).

## 2. Our three layers of protection
| Layer | What | Where |
|---|---|---|
| 1. Transaction + row lock | `sp_book_slot` does `START TRANSACTION → SELECT … FOR UPDATE on the slot row → re-check status → INSERT booking → UPDATE slot → COMMIT` | `database/02_procedures.sql` |
| 2. Database constraint | `booking.active_slot_id` (generated: slot_id while CONFIRMED/IN_PROGRESS, else NULL) with `UNIQUE`. A 2nd active booking for a slot violates it (error 1062) even if all application code were wrong | `database/01_schema.sql` |
| 3. Backend | Never trusts the UI's availability; maps DB errors to clean `409 SLOT_UNAVAILABLE`; retries deadlock/lock-timeout | `backend/src/` |

### Timeline of the concurrent demo
```
User A                                   User B
BEGIN                                    BEGIN
SELECT slot FOR UPDATE   → gets lock
                                         SELECT slot FOR UPDATE → BLOCKS (waits)
status = AVAILABLE ✔
INSERT booking, slot = BOOKED
COMMIT  → lock released
                                         … lock acquired, reads the COMMITTED row
                                         status = BOOKED ✘ → SIGNAL 50003 → ROLLBACK
```
Result: exactly one booking; B gets `409 SLOT_UNAVAILABLE`; B left no rows (proved by tests T09/T09b with 25 simultaneous users).

## 3. ACID mapped to this project
* **Atomicity** – booking = INSERT booking + UPDATE slot (+ trigger audit row). Either all happen or none (T15 forces a failure *after* the writes and shows everything vanishes).
* **Consistency** – constraints (PK/FK/UNIQUE/CHECK) + business rules in procedures (no overlap, valid state transitions) keep the DB valid; integrity queries Q11/Q12 return 0 rows.
* **Isolation** – row locks (`FOR UPDATE`) + `READ COMMITTED`; concurrent bookings behave as if run one after another for the same slot.
* **Durability** – InnoDB redo log: after `COMMIT` the booking survives a crash.

## 4. Why these specific choices
* **`SELECT … FOR UPDATE` (pessimistic locking)** – conflicts on a hot slot are *likely*, so waiting is cheaper than failing and retrying. Optimistic alternatives: version column / unique constraint only. We use the unique constraint as a safety net, not as the main mechanism.
* **`READ COMMITTED` instead of the default REPEATABLE READ** – the locking read always sees the latest committed row, and InnoDB takes fewer gap locks → fewer deadlocks. Set per transaction (`SET TRANSACTION ISOLATION LEVEL …` before `START TRANSACTION`), so nothing leaks to other work.
* **Lock the user row first in booking** – serialises one user's parallel requests so the "no overlapping bookings per user" rule cannot be bypassed (test T09c).
* **One fixed lock order** – `users → charging_slot → booking → charging_session` in *every* procedure. Deadlocks need a cycle in lock waits; a global order removes cycles. If MySQL still reports 1213/1205 the backend retries (up to 3×).
* **Stored procedures** – the transaction boundary lives in the database, so no client (web, Postman, a second app) can bypass the rules; also one network round-trip.
* **Generated column + UNIQUE** – NULLs are never equal in a UNIQUE index, so unlimited CANCELLED/COMPLETED rows are allowed per slot but only one active row.
* **`ON DELETE RESTRICT`** – history (bookings, sessions, payments) can't be wiped by deleting a parent.
* **Audit triggers** – every booking state change is logged automatically; rolled-back changes disappear with the transaction (a trigger runs inside the same transaction).

## 5. Rollback demonstration (FR-08 / T15)
`sp_book_slot(user, slot, 1)` — the last argument `1` raises an error *after* `INSERT booking` and `UPDATE slot` ran.
The `EXIT HANDLER FOR SQLEXCEPTION` executes `ROLLBACK`, so: booking row count unchanged, slot still `AVAILABLE`, no audit row. (`sql_tests.sql` S3, API test T15.) Over HTTP this needs `ENABLE_TEST_HOOKS=true` and body `{"slot_id":N,"simulate_failure":true}`.

## 6. State machines
```
Booking : CONFIRMED ──start session──► IN_PROGRESS ──end session──► COMPLETED
              └──cancel (owner ≥60 min before / admin any time)──► CANCELLED
Slot    : AVAILABLE ⇄ BOOKED  (only via booking procedures)      AVAILABLE ⇄ BLOCKED (admin only)
Session : ACTIVE ──end──► COMPLETED
```
Invalid transitions (cancel a completed booking, start a session twice, end twice…) are rejected inside the procedure *after locking*, so two simultaneous requests can't both pass the state check.

## 7. Likely viva questions
1. **What is a race condition / double booking and how do you stop it?** → §1–2.
2. **Difference between a transaction and a lock?** A transaction groups statements atomically; a lock stops others from touching rows meanwhile. The transaction decides *when* locks are released (at COMMIT/ROLLBACK).
3. **What happens to the second user?** Blocks on the row lock until A commits, then sees `BOOKED` and gets error 50003 → HTTP 409; transaction rolled back.
4. **What if the application has a bug and skips the check?** The `UNIQUE(active_slot_id)` constraint still rejects the 2nd insert (shown in tests and `02_constraints_and_views.txt`).
5. **Isolation levels?** READ UNCOMMITTED (dirty reads) < READ COMMITTED < REPEATABLE READ (InnoDB default; no non-repeatable reads) < SERIALIZABLE. We use READ COMMITTED + explicit row locks.
6. **What is a deadlock and how do you avoid it?** Two transactions each hold a lock the other needs. Avoid with a fixed lock order (§4); InnoDB detects and kills one victim (error 1213) → we retry.
7. **Why views?** Reusable, tested JOINs; the API reads the views; hide complexity; one place to change a definition. Views here: Available_Slots, Station_Availability, User_Booking_History, Charging_Session_Summary, Station_Utilization.
8. **Why is `cost` stored if it can be computed?** It records the price *at charging time*; prices may change later (historical fact, not derived redundancy).
9. **Normalization?** `DB_Design.md` §4 — 3NF; deliberate, documented redundancy only in `charging_slot.status` (kept consistent by the same transaction).
10. **How do you protect against SQL injection?** Values are always bound parameters (`?`); user input never concatenated; status/type values are whitelisted; test `SQL-injection style input…`.
11. **How are passwords/secrets handled?** Only bcrypt hashes in DB; secrets in `.env` (git-ignored); role re-read from DB, not from the token.
12. **What would you add with more time?** Payment gateway, waitlist, dynamic pricing, IoT status, scheduled job to auto-expire stale CONFIRMED bookings / ACTIVE sessions (see Limitations).

## 8. Known limitations (say these before the examiner finds them)
* No background job: a CONFIRMED booking whose slot passed stays CONFIRMED (harmless — it can't start a session, and the slot is excluded from availability) and an ACTIVE session is not auto-closed (admin can end it).
* Energy value is supplied by the caller (no real charger hardware); the server only checks it against `power_kw × slot length`.
* Payment is a record, not a real transaction.
* Time zone: all times are the DB server's local time.
