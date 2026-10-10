-- =====================================================================
-- database/tests/sql_tests.sql  -  pure-SQL tests for FR-08/09/10/12/14
-- Run on a freshly installed database (scripts/install_db.sh).
-- Prints one PASS/FAIL line per test. No application code involved.
-- =====================================================================
DROP TEMPORARY TABLE IF EXISTS t_results;
CREATE TEMPORARY TABLE t_results (id INT AUTO_INCREMENT PRIMARY KEY, test_name VARCHAR(120), result VARCHAR(4));

DROP PROCEDURE IF EXISTS sp_sqltests;
DELIMITER $$
CREATE PROCEDURE sp_sqltests()
BEGIN
  DECLARE v_slot INT; DECLARE v_slot2 INT; DECLARE v_bk INT; DECLARE v_n INT; DECLARE v_err INT; DECLARE v_s VARCHAR(20);
  DECLARE v_sess INT; DECLARE v_cost DECIMAL(10,2);

  -- fresh test fixtures (users 3,4 are sample users B and C)
  INSERT INTO charging_station (name,address,latitude,longitude) VALUES (CONCAT('SQLTEST ',UUID()),'x',10,10);
  INSERT INTO charger (station_id,charger_type,power_kw,price_per_kwh) VALUES (LAST_INSERT_ID(),'CCS2',50,10);
  SET @ch = LAST_INSERT_ID();
  INSERT INTO charging_slot (charger_id,start_time,end_time) VALUES (@ch, NOW() + INTERVAL 5 HOUR, NOW() + INTERVAL 6 HOUR);
  SET v_slot = LAST_INSERT_ID();
  INSERT INTO charging_slot (charger_id,start_time,end_time) VALUES (@ch, NOW() + INTERVAL 7 HOUR, NOW() + INTERVAL 8 HOUR);
  SET v_slot2 = LAST_INSERT_ID();

  -- S1 valid booking commits
  CALL sp_book_slot(3, v_slot, 0);
  SELECT booking_id INTO v_bk FROM booking WHERE slot_id = v_slot;
  SELECT status INTO v_s FROM charging_slot WHERE slot_id = v_slot;
  INSERT INTO t_results (test_name,result) VALUES ('S1 booking committed and slot BOOKED', IF(v_bk IS NOT NULL AND v_s='BOOKED','PASS','FAIL'));

  -- S2 second user, same slot -> error 50003, still exactly 1 booking
  BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MYSQL_ERRNO;
    SET v_err = 0;
    CALL sp_book_slot(4, v_slot, 0);
  END;
  SELECT COUNT(*) INTO v_n FROM booking WHERE slot_id = v_slot;
  INSERT INTO t_results (test_name,result) VALUES ('S2 same slot by 2nd user rejected (50003), 1 booking row', IF(v_err=50003 AND v_n=1,'PASS','FAIL'));

  -- S3 simulated failure after INSERT+UPDATE -> everything rolled back
  BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MYSQL_ERRNO;
    SET v_err = 0;
    CALL sp_book_slot(4, v_slot2, 1);
  END;
  SELECT COUNT(*) INTO v_n FROM booking WHERE slot_id = v_slot2;
  SELECT status INTO v_s FROM charging_slot WHERE slot_id = v_slot2;
  INSERT INTO t_results (test_name,result) VALUES ('S3 failure mid-transaction -> ROLLBACK (0 rows, slot AVAILABLE)', IF(v_err=50099 AND v_n=0 AND v_s='AVAILABLE','PASS','FAIL'));

  -- S4 cancellation outside the cut-off window is allowed (slot starts in 5h, beyond the 60-minute cutoff):
  CALL sp_cancel_booking(v_bk, 3, 0);
  SELECT status INTO v_s FROM charging_slot WHERE slot_id = v_slot;
  INSERT INTO t_results (test_name,result) VALUES ('S4 cancellation releases slot', IF(v_s='AVAILABLE' AND (SELECT status FROM booking WHERE booking_id=v_bk)='CANCELLED','PASS','FAIL'));

  -- S5 cancelling again is rejected (50006)
  BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MYSQL_ERRNO;
    SET v_err = 0;
    CALL sp_cancel_booking(v_bk, 3, 0);
  END;
  INSERT INTO t_results (test_name,result) VALUES ('S5 double cancellation rejected (50006)', IF(v_err=50006,'PASS','FAIL'));

  -- S6 unique index blocks a 2nd active booking written directly (bypassing the procedure)
  INSERT INTO booking (user_id,slot_id,status) VALUES (3, v_slot2, 'CONFIRMED');
  BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MYSQL_ERRNO;
    SET v_err = 0;
    INSERT INTO booking (user_id,slot_id,status) VALUES (4, v_slot2, 'CONFIRMED');
  END;
  INSERT INTO t_results (test_name,result) VALUES ('S6 UNIQUE(active_slot_id) rejects duplicate active booking (1062)', IF(v_err=1062,'PASS','FAIL'));
  DELETE FROM booking WHERE slot_id = v_slot2;

  -- S7 session flow on a slot whose window is open; backdate session start for deterministic energy-limit testing
  INSERT INTO charging_slot (charger_id,start_time,end_time) VALUES (@ch, NOW() - INTERVAL 5 MINUTE, NOW() + INTERVAL 55 MINUTE);
  SET v_slot = LAST_INSERT_ID();
  CALL sp_book_slot(4, v_slot, 0);
  SELECT booking_id INTO v_bk FROM booking WHERE slot_id = v_slot;
  CALL sp_start_session(v_bk, 4, 0);
  SELECT session_id INTO v_sess FROM charging_session WHERE booking_id = v_bk;

  -- Simulate 15 minutes of elapsed charging deterministically. At 50 kW,
  -- 15 minutes permits up to 12.5 kWh (50 * 15 / 60).
  -- This avoids relying on real-time waiting during the test.
  UPDATE charging_session
     SET start_time = NOW() - INTERVAL 15 MINUTE
   WHERE session_id = v_sess;

  CALL sp_end_session(v_sess, 4, 0, 12.500);
  SELECT cost INTO v_cost FROM charging_session WHERE session_id = v_sess;
  INSERT INTO t_results (test_name,result) VALUES ('S7 session end stores energy 12.5 kWh, cost 125.00, payment PAID, booking COMPLETED',
     IF(v_cost=125.00 AND (SELECT status FROM payment WHERE booking_id=v_bk)='PAID' AND (SELECT status FROM booking WHERE booking_id=v_bk)='COMPLETED','PASS','FAIL'));

  -- S8 energy above physical limit rejected, input guards
  INSERT INTO charging_slot (charger_id,start_time,end_time) VALUES (@ch, NOW() - INTERVAL 3 MINUTE, NOW() + INTERVAL 57 MINUTE);
  SET v_slot = LAST_INSERT_ID();
  CALL sp_book_slot(3, v_slot, 0);
  SELECT booking_id INTO v_bk FROM booking WHERE slot_id = v_slot;
  CALL sp_start_session(v_bk, 3, 0);
  SELECT session_id INTO v_sess FROM charging_session WHERE booking_id = v_bk;
  BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MYSQL_ERRNO;
    SET v_err = 0;
    CALL sp_end_session(v_sess, 3, 0, 9999);
  END;
  INSERT INTO t_results (test_name,result) VALUES ('S8 impossible energy rejected (50011), session still ACTIVE',
     IF(v_err=50011 AND (SELECT status FROM charging_session WHERE session_id=v_sess)='ACTIVE','PASS','FAIL'));

  -- S9 integrity queries return nothing
  SELECT COUNT(*) INTO v_n FROM (SELECT slot_id FROM booking WHERE status IN ('CONFIRMED','IN_PROGRESS') GROUP BY slot_id HAVING COUNT(*)>1) x;
  INSERT INTO t_results (test_name,result) VALUES ('S9 no slot has more than one active booking', IF(v_n=0,'PASS','FAIL'));

  -- S10 views respond
  SELECT COUNT(*) INTO v_n FROM Available_Slots_View;
  INSERT INTO t_results (test_name,result) VALUES ('S10 Available_Slots_View returns rows', IF(v_n>0,'PASS','FAIL'));
END$$
DELIMITER ;

CALL sp_sqltests();
DROP PROCEDURE sp_sqltests;
SELECT id, test_name, result FROM t_results ORDER BY id;
SELECT CONCAT(SUM(result='PASS'), ' passed, ', SUM(result='FAIL'), ' failed') AS summary FROM t_results;
