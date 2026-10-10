-- =====================================================================
-- 04_sample_data_corrected.sql - Sample data for the EV charging demo
-- MySQL 8.0+ recommended. Run schema/procedure scripts before this file.
-- Required existing procedures: sp_generate_slots, sp_book_slot,
-- sp_cancel_booking.
-- NOTE: This is a seed script; run it ONCE against a freshly created schema (01..03 first).
-- Test password for every sample user: Password@123
-- =====================================================================

INSERT INTO users (name, email, phone, password_hash, role) VALUES
 ('Station Admin', 'admin@evcharge.test',  '9000000001', '$2b$10$fF.TXyRvMwn5ZXf4ilCMmOHqBoZtDtY9yPMUomUfGRPGaQzhbK2dC', 'ADMIN'),
 ('Demo User A',   'usera@evcharge.test',  '9000000002', '$2b$10$fF.TXyRvMwn5ZXf4ilCMmOHqBoZtDtY9yPMUomUfGRPGaQzhbK2dC', 'USER'),
 ('Demo User B',   'userb@evcharge.test',  '9000000003', '$2b$10$fF.TXyRvMwn5ZXf4ilCMmOHqBoZtDtY9yPMUomUfGRPGaQzhbK2dC', 'USER'),
 ('Demo User C',   'userc@evcharge.test',  '9000000004', '$2b$10$fF.TXyRvMwn5ZXf4ilCMmOHqBoZtDtY9yPMUomUfGRPGaQzhbK2dC', 'USER');

INSERT INTO charging_station (name, address, latitude, longitude, status) VALUES
 ('Central Delhi EV Hub',    'Connaught Place, New Delhi',        28.631500, 77.216700, 'ACTIVE'),
 ('South Delhi Charge Point','Saket District Centre, New Delhi',  28.528300, 77.219000, 'ACTIVE'),
 ('Dwarka Fast Charge',      'Sector 21, Dwarka, New Delhi',      28.552200, 77.058700, 'ACTIVE'),
 ('Noida Sector 18 Station','Sector 18, Noida, Uttar Pradesh',   28.570400, 77.321100, 'ACTIVE'),
 ('Gurugram Cyber Station',  'Cyber City, Gurugram, Haryana',     28.494900, 77.088700, 'MAINTENANCE');

-- Resolve IDs by stable unique business fields instead of assuming IDs start at 1.
SET @user_a = (SELECT user_id FROM users WHERE email = 'usera@evcharge.test' LIMIT 1);
SET @user_b = (SELECT user_id FROM users WHERE email = 'userb@evcharge.test' LIMIT 1);
SET @user_c = (SELECT user_id FROM users WHERE email = 'userc@evcharge.test' LIMIT 1);

SET @station_1 = (SELECT station_id FROM charging_station WHERE name = 'Central Delhi EV Hub' LIMIT 1);
SET @station_2 = (SELECT station_id FROM charging_station WHERE name = 'South Delhi Charge Point' LIMIT 1);
SET @station_3 = (SELECT station_id FROM charging_station WHERE name = 'Dwarka Fast Charge' LIMIT 1);
SET @station_4 = (SELECT station_id FROM charging_station WHERE name = 'Noida Sector 18 Station' LIMIT 1);
SET @station_5 = (SELECT station_id FROM charging_station WHERE name = 'Gurugram Cyber Station' LIMIT 1);

INSERT INTO charger (station_id, charger_type, power_kw, price_per_kwh, status) VALUES
 (@station_1, 'CCS2',    50.00, 18.00, 'ACTIVE'),
 (@station_1, 'Type2',   22.00, 12.00, 'ACTIVE'),
 (@station_2, 'CCS2',    60.00, 19.00, 'ACTIVE'),
 (@station_2, 'CHAdeMO', 50.00, 17.50, 'ACTIVE'),
 (@station_3, 'CCS2',   120.00, 22.00, 'ACTIVE'),
 (@station_3, 'Type2',   22.00, 12.00, 'ACTIVE'),
 (@station_4, 'Type2',   22.00, 11.50, 'ACTIVE'),
 (@station_4, 'GBT',     30.00, 14.00, 'INACTIVE'),
 (@station_5, 'CCS2',    50.00, 18.00, 'ACTIVE');

SET @charger_1 = (SELECT charger_id FROM charger WHERE station_id = @station_1 AND charger_type = 'CCS2' LIMIT 1);
SET @charger_2 = (SELECT charger_id FROM charger WHERE station_id = @station_1 AND charger_type = 'Type2' LIMIT 1);
SET @charger_3 = (SELECT charger_id FROM charger WHERE station_id = @station_2 AND charger_type = 'CCS2' LIMIT 1);
SET @charger_4 = (SELECT charger_id FROM charger WHERE station_id = @station_2 AND charger_type = 'CHAdeMO' LIMIT 1);
SET @charger_5 = (SELECT charger_id FROM charger WHERE station_id = @station_3 AND charger_type = 'CCS2' LIMIT 1);
SET @charger_6 = (SELECT charger_id FROM charger WHERE station_id = @station_3 AND charger_type = 'Type2' LIMIT 1);
SET @charger_7 = (SELECT charger_id FROM charger WHERE station_id = @station_4 AND charger_type = 'Type2' LIMIT 1);
SET @charger_8 = (SELECT charger_id FROM charger WHERE station_id = @station_4 AND charger_type = 'GBT' LIMIT 1);
SET @charger_9 = (SELECT charger_id FROM charger WHERE station_id = @station_5 AND charger_type = 'CCS2' LIMIT 1);

-- Generate hourly slots (00:00-24:00, stations are open all day) for every charger for today and the next 3 days,
-- so a booking / charging-session demo works at any time of day.
-- A cursor avoids assuming charger IDs are consecutive or start at 1.
DROP PROCEDURE IF EXISTS sp_seed_slots;
DELIMITER $$
CREATE PROCEDURE sp_seed_slots()
BEGIN
    DECLARE v_charger_id INT;
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_day INT DEFAULT 0;
    DECLARE cur_chargers CURSOR FOR SELECT charger_id FROM charger;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    OPEN cur_chargers;
    charger_loop: LOOP
        FETCH cur_chargers INTO v_charger_id;
        IF v_done = 1 THEN
            LEAVE charger_loop;
        END IF;

        SET v_day = 0;                 -- 0 = today (so a charging-session demo works), 1..3 = next days
        WHILE v_day <= 3 DO
            CALL sp_generate_slots(v_charger_id, CURDATE() + INTERVAL v_day DAY, 0, 24, 60);
            SET v_day = v_day + 1;
        END WHILE;
    END LOOP;
    CLOSE cur_chargers;
END$$
DELIMITER ;

CALL sp_seed_slots();
DROP PROCEDURE sp_seed_slots;

-- Resolve the required slots by charger ID and exact start time.
SET @slot_a = (SELECT slot_id FROM charging_slot WHERE charger_id = @charger_1 AND start_time = TIMESTAMP(CURDATE() + INTERVAL 1 DAY, '10:00:00') LIMIT 1);
SET @slot_b = (SELECT slot_id FROM charging_slot WHERE charger_id = @charger_1 AND start_time = TIMESTAMP(CURDATE() + INTERVAL 1 DAY, '11:00:00') LIMIT 1);
SET @slot_c = (SELECT slot_id FROM charging_slot WHERE charger_id = @charger_3 AND start_time = TIMESTAMP(CURDATE() + INTERVAL 1 DAY, '09:00:00') LIMIT 1);

-- If these are NULL, check that sp_generate_slots creates these times.
CALL sp_book_slot(@user_a, @slot_a, 0);
CALL sp_book_slot(@user_b, @slot_b, 0);
CALL sp_book_slot(@user_a, @slot_c, 0);

SET @bk_c = (SELECT booking_id FROM booking WHERE slot_id = @slot_c ORDER BY booking_id DESC LIMIT 1);
CALL sp_cancel_booking(@bk_c, @user_a, 0);

-- One completed historical booking, session, and payment.
INSERT INTO charging_slot (charger_id, start_time, end_time, status)
VALUES (@charger_2,
        TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '10:00:00'),
        TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '11:00:00'),
        'AVAILABLE');
SET @hist_slot = LAST_INSERT_ID();

INSERT INTO booking (user_id, slot_id, status, booked_at)
VALUES (@user_c, @hist_slot, 'COMPLETED', NOW() - INTERVAL 2 DAY);
SET @hist_booking = LAST_INSERT_ID();

INSERT INTO charging_session (booking_id, start_time, end_time, energy_kwh, cost, status)
VALUES (@hist_booking,
        TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '10:02:00'),
        TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '10:52:00'),
        14.500, ROUND(14.5 * 12.00, 2), 'COMPLETED');

INSERT INTO payment (booking_id, amount, status, transaction_ref)
VALUES (@hist_booking, ROUND(14.5 * 12.00, 2), 'PAID',
        CONCAT('TXN-SEED-', LPAD(@hist_booking, 6, '0')));
