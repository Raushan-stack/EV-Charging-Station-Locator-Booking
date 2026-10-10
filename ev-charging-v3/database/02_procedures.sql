-- =====================================================================
-- 02_procedures.sql  -  Transactional stored procedures
--   FR-08 Database Transactions   -> sp_book_slot (+ every procedure below is atomic)
--   FR-09 Booking Cancellation    -> sp_cancel_booking
--   FR-10 Charging Session        -> sp_start_session, sp_end_session
--   FR-13 Admin (bulk slots)      -> sp_generate_slots
--   FR-14 Validation / Errors     -> SIGNAL with custom error numbers (table below)
--
-- Custom error numbers (SQLSTATE 45000). The backend maps them to HTTP codes.
--   50001 USER_NOT_FOUND          50010 SESSION_NOT_FOUND
--   50002 SLOT_NOT_FOUND          50011 INVALID_ENERGY
--   50003 SLOT_UNAVAILABLE        50012 SESSION_ALREADY_STARTED
--   50004 SLOT_EXPIRED            50013 BOOKING_OVERLAP
--   50005 BOOKING_NOT_FOUND       50014 INVALID_INPUT
--   50006 INVALID_BOOKING_STATE   50015 NOT_OWNER
--   50008 CANCEL_TOO_LATE         50016 CHARGER_UNAVAILABLE
--   50009 SESSION_TOO_EARLY       50017 SESSION_NOT_ACTIVE
--   50099 SIMULATED_FAILURE (test hook only)
--
-- Locking order used EVERYWHERE (prevents deadlocks):
--   users row (booking only)  ->  charging_slot row  ->  booking row  ->  session row
-- =====================================================================

DROP PROCEDURE IF EXISTS sp_book_slot;
DROP PROCEDURE IF EXISTS sp_cancel_booking;
DROP PROCEDURE IF EXISTS sp_start_session;
DROP PROCEDURE IF EXISTS sp_end_session;
DROP PROCEDURE IF EXISTS sp_generate_slots;

DELIMITER $$

-- ---------------------------------------------------------------------
-- FR-08 / FR-06 / FR-07 : atomic "check-and-book"
-- p_simulate_failure = 1 forces an error AFTER the INSERT/UPDATE so the
-- rollback can be demonstrated (FR-15). Normal callers pass 0.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_book_slot(IN p_user_id INT, IN p_slot_id INT, IN p_simulate_failure TINYINT)
BEGIN
    DECLARE v_user_active    TINYINT     DEFAULT NULL;
    DECLARE v_slot_status    VARCHAR(15) DEFAULT NULL;
    DECLARE v_start          DATETIME    DEFAULT NULL;
    DECLARE v_end            DATETIME    DEFAULT NULL;
    DECLARE v_charger_id     INT         DEFAULT NULL;
    DECLARE v_charger_status VARCHAR(15) DEFAULT NULL;
    DECLARE v_station_status VARCHAR(15) DEFAULT NULL;
    DECLARE v_overlap        INT         DEFAULT 0;
    DECLARE v_booking_id     INT         DEFAULT NULL;

    -- Any error: undo EVERYTHING done in this transaction, then re-raise it.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_user_id IS NULL OR p_slot_id IS NULL OR p_user_id < 1 OR p_slot_id < 1 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50014, MESSAGE_TEXT = 'user_id and slot_id must be positive integers';
    END IF;

    -- READ COMMITTED: locking reads see the latest committed data and take fewer gap locks.
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    START TRANSACTION;

    -- 1) Lock the user row: serialises concurrent bookings of the SAME user so the
    --    overlap rule below cannot be bypassed by two parallel requests.
    SELECT is_active INTO v_user_active FROM users WHERE user_id = p_user_id FOR UPDATE;
    IF v_user_active IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50001, MESSAGE_TEXT = 'User not found';
    END IF;
    IF v_user_active = 0 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50001, MESSAGE_TEXT = 'User account is deactivated';
    END IF;

    -- 2) Lock the slot row. A second transaction for the same slot BLOCKS here until
    --    we COMMIT/ROLLBACK, then re-reads the committed status below.
    SELECT status, start_time, end_time, charger_id
      INTO v_slot_status, v_start, v_end, v_charger_id
      FROM charging_slot WHERE slot_id = p_slot_id FOR UPDATE;
    IF v_slot_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50002, MESSAGE_TEXT = 'Slot not found';
    END IF;

    -- 3) Re-check availability INSIDE the lock (the protected check).
    IF v_slot_status <> 'AVAILABLE' THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50003,
               MESSAGE_TEXT = 'Slot is not available (already booked or blocked)';
    END IF;
    IF v_end <= NOW() THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50004, MESSAGE_TEXT = 'Slot time has already passed';
    END IF;

    SELECT c.status, st.status INTO v_charger_status, v_station_status
      FROM charger c JOIN charging_station st ON st.station_id = c.station_id
     WHERE c.charger_id = v_charger_id;
    IF v_charger_status <> 'ACTIVE' OR v_station_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50016, MESSAGE_TEXT = 'Charger or station is not operational';
    END IF;

    -- 4) Business rule: one user cannot hold two overlapping active bookings.
    SELECT COUNT(*) INTO v_overlap
      FROM booking b JOIN charging_slot s ON s.slot_id = b.slot_id
     WHERE b.user_id = p_user_id
       AND b.status IN ('CONFIRMED','IN_PROGRESS')
       AND s.start_time < v_end AND s.end_time > v_start;
    IF v_overlap > 0 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50013,
               MESSAGE_TEXT = 'You already have an active booking that overlaps this time';
    END IF;

    -- 5) Insert booking + mark slot BOOKED (both or neither).
    INSERT INTO booking (user_id, slot_id, status) VALUES (p_user_id, p_slot_id, 'CONFIRMED');
    SET v_booking_id = LAST_INSERT_ID();
    UPDATE charging_slot SET status = 'BOOKED' WHERE slot_id = p_slot_id;

    IF p_simulate_failure = 1 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50099,
               MESSAGE_TEXT = 'Simulated database failure after INSERT (test hook)';
    END IF;

    COMMIT;
    SELECT v_booking_id AS booking_id, p_slot_id AS slot_id, 'CONFIRMED' AS status;
END$$

-- ---------------------------------------------------------------------
-- FR-09 : cancellation + slot release
-- Rules: only CONFIRMED bookings; owner (or admin); owner must cancel at least
-- cancel_cutoff_minutes before the slot start (admin bypasses owner/cutoff).
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_cancel_booking(IN p_booking_id INT, IN p_actor_id INT, IN p_is_admin TINYINT)
BEGIN
    DECLARE v_slot_id INT         DEFAULT NULL;
    DECLARE v_start   DATETIME    DEFAULT NULL;
    DECLARE v_owner   INT         DEFAULT NULL;
    DECLARE v_status  VARCHAR(15) DEFAULT NULL;
    DECLARE v_cutoff  INT         DEFAULT 60;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_booking_id IS NULL OR p_booking_id < 1
       OR p_actor_id IS NULL OR p_actor_id < 1
       OR p_is_admin IS NULL OR p_is_admin NOT IN (0, 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50014,
               MESSAGE_TEXT = 'Invalid booking_id, actor_id, or admin flag';
    END IF;

    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    START TRANSACTION;

    SELECT slot_id INTO v_slot_id FROM booking WHERE booking_id = p_booking_id;
    IF v_slot_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50005, MESSAGE_TEXT = 'Booking not found';
    END IF;

    SELECT COALESCE((SELECT setting_value FROM app_setting WHERE setting_key = 'cancel_cutoff_minutes'), 60)
      INTO v_cutoff;

    -- lock order: slot -> booking
    SELECT start_time INTO v_start FROM charging_slot WHERE slot_id = v_slot_id FOR UPDATE;
    SELECT user_id, status INTO v_owner, v_status FROM booking WHERE booking_id = p_booking_id FOR UPDATE;

    IF p_is_admin = 0 AND v_owner <> p_actor_id THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50015, MESSAGE_TEXT = 'You can only cancel your own bookings';
    END IF;
    IF v_status <> 'CONFIRMED' THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50006,
               MESSAGE_TEXT = 'Only CONFIRMED bookings can be cancelled (this booking is not in that state)';
    END IF;
    IF p_is_admin = 0 AND v_start < NOW() + INTERVAL v_cutoff MINUTE THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50008,
               MESSAGE_TEXT = 'Too late to cancel: cancellation cut-off has passed for this slot';
    END IF;

    UPDATE booking SET status = 'CANCELLED', cancelled_at = NOW() WHERE booking_id = p_booking_id;
    UPDATE charging_slot SET status = 'AVAILABLE' WHERE slot_id = v_slot_id AND status = 'BOOKED';

    COMMIT;
    SELECT p_booking_id AS booking_id, v_slot_id AS slot_id, 'CANCELLED' AS status;
END$$

-- ---------------------------------------------------------------------
-- FR-10 : start a charging session (eligible booking only)
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_start_session(IN p_booking_id INT, IN p_actor_id INT, IN p_is_admin TINYINT)
BEGIN
    DECLARE v_slot_id        INT         DEFAULT NULL;
    DECLARE v_start          DATETIME    DEFAULT NULL;
    DECLARE v_end            DATETIME    DEFAULT NULL;
    DECLARE v_charger_id     INT         DEFAULT NULL;
    DECLARE v_owner          INT         DEFAULT NULL;
    DECLARE v_status         VARCHAR(15) DEFAULT NULL;
    DECLARE v_charger_status VARCHAR(15) DEFAULT NULL;
    DECLARE v_station_status VARCHAR(15) DEFAULT NULL;
    DECLARE v_early          INT         DEFAULT 15;
    DECLARE v_session_id     INT         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_booking_id IS NULL OR p_booking_id < 1
       OR p_actor_id IS NULL OR p_actor_id < 1
       OR p_is_admin IS NULL OR p_is_admin NOT IN (0, 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50014,
               MESSAGE_TEXT = 'Invalid booking_id, actor_id, or admin flag';
    END IF;

    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    START TRANSACTION;

    SELECT slot_id INTO v_slot_id FROM booking WHERE booking_id = p_booking_id;
    IF v_slot_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50005, MESSAGE_TEXT = 'Booking not found';
    END IF;

    SELECT COALESCE((SELECT setting_value FROM app_setting WHERE setting_key = 'session_early_minutes'), 15)
      INTO v_early;

    SELECT start_time, end_time, charger_id INTO v_start, v_end, v_charger_id
      FROM charging_slot WHERE slot_id = v_slot_id FOR UPDATE;
    SELECT user_id, status INTO v_owner, v_status FROM booking WHERE booking_id = p_booking_id FOR UPDATE;

    IF p_is_admin = 0 AND v_owner <> p_actor_id THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50015, MESSAGE_TEXT = 'You can only start a session for your own booking';
    END IF;
    IF v_status = 'IN_PROGRESS' THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50012, MESSAGE_TEXT = 'A charging session is already active for this booking';
    END IF;
    IF v_status <> 'CONFIRMED' THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50006,
               MESSAGE_TEXT = 'Only CONFIRMED bookings can start a session (this booking is not in that state)';
    END IF;
    IF NOW() < v_start - INTERVAL v_early MINUTE THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50009, MESSAGE_TEXT = 'Too early: the session window has not opened yet';
    END IF;
    IF NOW() >= v_end THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50004, MESSAGE_TEXT = 'The booked slot has already ended';
    END IF;

    SELECT c.status, st.status INTO v_charger_status, v_station_status
      FROM charger c JOIN charging_station st ON st.station_id = c.station_id
     WHERE c.charger_id = v_charger_id;
    IF v_charger_status <> 'ACTIVE' OR v_station_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50016, MESSAGE_TEXT = 'Charger or station is not operational';
    END IF;

    INSERT INTO charging_session (booking_id, start_time, status) VALUES (p_booking_id, NOW(), 'ACTIVE');
    SET v_session_id = LAST_INSERT_ID();
    UPDATE booking SET status = 'IN_PROGRESS' WHERE booking_id = p_booking_id;

    COMMIT;
    SELECT v_session_id AS session_id, p_booking_id AS booking_id, 'ACTIVE' AS status;
END$$

-- ---------------------------------------------------------------------
-- FR-10 : end a charging session -> energy, cost, payment, release resource
-- cost = ROUND(energy_kwh * charger.price_per_kwh, 2)
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_end_session(IN p_session_id INT, IN p_actor_id INT, IN p_is_admin TINYINT, IN p_energy_kwh DECIMAL(8,3))
BEGIN
    DECLARE v_booking_id INT           DEFAULT NULL;
    DECLARE v_slot_id    INT           DEFAULT NULL;
    DECLARE v_owner      INT           DEFAULT NULL;
    DECLARE v_b_status   VARCHAR(15)   DEFAULT NULL;
    DECLARE v_s_status   VARCHAR(15)   DEFAULT NULL;
    DECLARE v_s_start    DATETIME      DEFAULT NULL;
    DECLARE v_slot_start DATETIME      DEFAULT NULL;
    DECLARE v_slot_end   DATETIME      DEFAULT NULL;
    DECLARE v_power      DECIMAL(6,2)  DEFAULT NULL;
    DECLARE v_price      DECIMAL(8,2)  DEFAULT NULL;
    DECLARE v_max_energy DECIMAL(12,3) DEFAULT NULL;
    DECLARE v_cost       DECIMAL(10,2) DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_session_id IS NULL OR p_session_id < 1
       OR p_actor_id IS NULL OR p_actor_id < 1
       OR p_is_admin IS NULL OR p_is_admin NOT IN (0, 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50014,
               MESSAGE_TEXT = 'Invalid session_id, actor_id, or admin flag';
    END IF;
    IF p_energy_kwh IS NULL OR p_energy_kwh < 0 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50011, MESSAGE_TEXT = 'energy_kwh must be a number >= 0';
    END IF;

    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    START TRANSACTION;

    SELECT booking_id INTO v_booking_id FROM charging_session WHERE session_id = p_session_id;
    IF v_booking_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50010, MESSAGE_TEXT = 'Charging session not found';
    END IF;
    SELECT slot_id INTO v_slot_id FROM booking WHERE booking_id = v_booking_id;

    SELECT start_time, end_time INTO v_slot_start, v_slot_end
      FROM charging_slot WHERE slot_id = v_slot_id FOR UPDATE;
    SELECT user_id, status INTO v_owner, v_b_status
      FROM booking WHERE booking_id = v_booking_id FOR UPDATE;
    SELECT status, start_time INTO v_s_status, v_s_start
      FROM charging_session WHERE session_id = p_session_id FOR UPDATE;

    IF p_is_admin = 0 AND v_owner <> p_actor_id THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50015, MESSAGE_TEXT = 'You can only end your own charging session';
    END IF;
    IF v_s_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50017, MESSAGE_TEXT = 'This charging session is not active (already completed)';
    END IF;
    IF v_b_status <> 'IN_PROGRESS' THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50006,
               MESSAGE_TEXT = 'The booking is not IN_PROGRESS';
    END IF;

    SELECT c.power_kw, c.price_per_kwh INTO v_power, v_price
      FROM charging_slot s JOIN charger c ON c.charger_id = s.charger_id
     WHERE s.slot_id = v_slot_id;

    -- Physical sanity limit: the charger cannot deliver more than its rated power from the
    -- moment the session started until the end of the booked slot. (Counting only the time that
    -- has really elapsed so far would make every quick demo / automated test fail.)
    SET v_max_energy = v_power *
        (GREATEST(0, TIMESTAMPDIFF(SECOND, v_s_start, v_slot_end)) / 3600);
    IF p_energy_kwh > v_max_energy THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50011,
               MESSAGE_TEXT = 'energy_kwh exceeds what this charger can deliver in the booked slot';
    END IF;

    SET v_cost = ROUND(p_energy_kwh * v_price, 2);

    UPDATE charging_session
       SET end_time = NOW(), energy_kwh = p_energy_kwh, cost = v_cost, status = 'COMPLETED'
     WHERE session_id = p_session_id;
    UPDATE booking SET status = 'COMPLETED' WHERE booking_id = v_booking_id;
    UPDATE charging_slot SET status = 'AVAILABLE' WHERE slot_id = v_slot_id AND status = 'BOOKED';

    INSERT INTO payment (booking_id, amount, status, transaction_ref)
    VALUES (v_booking_id, v_cost, 'PAID',
            CONCAT('TXN-', DATE_FORMAT(NOW(), '%Y%m%d%H%i%s'), '-', LPAD(v_booking_id, 6, '0')));

    COMMIT;
    SELECT p_session_id AS session_id, v_booking_id AS booking_id, 'COMPLETED' AS status,
           p_energy_kwh AS energy_kwh, v_cost AS cost,
           TIMESTAMPDIFF(MINUTE, v_s_start, NOW()) AS duration_minutes;
END$$

-- ---------------------------------------------------------------------
-- FR-13 : generate consecutive slots for one charger on one date.
-- Existing/overlapping slots are skipped, so it is safe to re-run.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_generate_slots(IN p_charger_id INT, IN p_date DATE, IN p_start_hour INT,
                                   IN p_end_hour INT, IN p_slot_minutes INT)
BEGIN
    DECLARE v_exists  INT      DEFAULT NULL;
    DECLARE v_cur     DATETIME;
    DECLARE v_limit   DATETIME;
    DECLARE v_next    DATETIME;
    DECLARE v_created INT      DEFAULT 0;
    DECLARE v_overlap INT      DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_charger_id IS NULL OR p_charger_id < 1
       OR p_date IS NULL OR p_start_hour IS NULL OR p_end_hour IS NULL
       OR p_slot_minutes IS NULL OR p_start_hour < 0 OR p_start_hour > 23
       OR p_end_hour < 1 OR p_end_hour > 24 OR p_start_hour >= p_end_hour
       OR p_slot_minutes < 15 OR p_slot_minutes > 480 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50014,
               MESSAGE_TEXT = 'Invalid slot generation parameters (hours 0-24, start < end, slot 15-480 min)';
    END IF;

    START TRANSACTION;
    -- lock the charger so two generators cannot create overlapping slots at once
    SELECT charger_id INTO v_exists FROM charger WHERE charger_id = p_charger_id FOR UPDATE;
    IF v_exists IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 50014, MESSAGE_TEXT = 'Charger not found';
    END IF;

    SET v_cur   = CAST(p_date AS DATETIME) + INTERVAL p_start_hour HOUR;
    SET v_limit = CAST(p_date AS DATETIME) + INTERVAL p_end_hour HOUR;

    WHILE v_cur + INTERVAL p_slot_minutes MINUTE <= v_limit DO
        SET v_next = v_cur + INTERVAL p_slot_minutes MINUTE;
        SELECT COUNT(*) INTO v_overlap FROM charging_slot
         WHERE charger_id = p_charger_id AND start_time < v_next AND end_time > v_cur;
        IF v_overlap = 0 THEN
            INSERT INTO charging_slot (charger_id, start_time, end_time, status)
            VALUES (p_charger_id, v_cur, v_next, 'AVAILABLE');
            SET v_created = v_created + 1;
        END IF;
        SET v_cur = v_next;
    END WHILE;

    COMMIT;
    SELECT v_created AS slots_created;
END$$

DELIMITER ;
