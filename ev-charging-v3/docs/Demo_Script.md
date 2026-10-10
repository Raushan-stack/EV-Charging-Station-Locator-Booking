# Live Demo Script — Raushan's part (DBMS evidence)

Prepare: `scripts/install_db.sh ev_charging -u root -p`, start backend with `ENABLE_TEST_HOOKS=true` (only for the rollback step).

## 1. Show the design (2 min)
Open `docs/DB_Design.md` ER diagram → point at `booking.active_slot_id` UNIQUE.

## 2. Views (1 min) — `mysql ev_charging`
```sql
SELECT * FROM Available_Slots_View LIMIT 5;
SELECT * FROM Station_Availability_View;
SELECT * FROM User_Booking_History_View;
SELECT * FROM Charging_Session_Summary_View;
```

## 3. Double booking, in the database (3 min) — two mysql terminals
```sql
-- Terminal 1                                   -- Terminal 2
SET @slot=(SELECT slot_id FROM Available_Slots_View LIMIT 1);   -- use the same number in both
START TRANSACTION;
SELECT status FROM charging_slot WHERE slot_id=@slot FOR UPDATE;
                                                START TRANSACTION;
                                                SELECT status FROM charging_slot WHERE slot_id=@slot FOR UPDATE;  -- hangs: lock wait
INSERT INTO booking(user_id,slot_id) VALUES (2,@slot);
UPDATE charging_slot SET status='BOOKED' WHERE slot_id=@slot;
COMMIT;                                         -- Terminal 2 now returns status = BOOKED -> it must ROLLBACK;
                                                ROLLBACK;
```
Explain: the second transaction waited, then saw the committed `BOOKED`.

## 4. Double booking, through the API (1 min)
```bash
cd backend && DB_USER=root DB_PASSWORD=... DB_NAME=ev_charging_test JWT_SECRET=x npm run demo:concurrency
```
Shows User A → 201, User B → 409 `SLOT_UNAVAILABLE`, and the DB rows (exactly one active booking).

## 5. Constraint as the last line of defence (1 min)
```sql
INSERT INTO booking(user_id,slot_id,status) VALUES (3, <a booked slot id>, 'CONFIRMED');
-- ERROR 1062 Duplicate entry ... for key 'uq_active_slot'
```

## 6. Rollback (2 min)
```sql
CALL sp_book_slot(2, <free slot id>, 1);     -- 1 = simulate failure after the INSERT/UPDATE
SELECT COUNT(*) FROM booking WHERE slot_id=<free slot id>;   -- 0
SELECT status FROM charging_slot WHERE slot_id=<free slot id>; -- AVAILABLE
```

## 7. Cancellation & session (2 min)
```sql
CALL sp_cancel_booking(<booking id>, <owner id>, 0);   SELECT * FROM booking_audit WHERE booking_id=<booking id>;
```
Then start/end a session via the API (`POST /api/sessions/start`, `/:id/end`) or show `sql_tests.sql` S7.

## 8. Test evidence (1 min)
`scripts/run_all_tests.sh` or open `docs/evidence/05_api_test_results.txt` → 51 pass, 0 fail.
