-- =====================================================================
-- EV Charging Station Locator & Booking System
-- 01_schema.sql  -  Tables, constraints, indexes, audit triggers
-- Owner: Raushan (database foundation for FR-08 .. FR-15)
-- Target: MySQL 8.0.16+ (CHECK constraints are enforced from 8.0.16).
-- MariaDB compatibility depends on the installed version and SQL mode.
-- WARNING: This script DROPS and recreates these tables; existing data is lost.
-- It does NOT create or select a database: select one first, or use
-- scripts/install_db.sh or database/00_install_all_in_one.sql, which do it for you.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS booking_audit;
DROP TABLE IF EXISTS payment;
DROP TABLE IF EXISTS charging_session;
DROP TABLE IF EXISTS booking;
DROP TABLE IF EXISTS charging_slot;
DROP TABLE IF EXISTS charger;
DROP TABLE IF EXISTS charging_station;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS app_setting;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- Business-rule settings (kept in a table so rules are data, not code)
-- ---------------------------------------------------------------------
CREATE TABLE app_setting (
    setting_key   VARCHAR(50) PRIMARY KEY,
    setting_value INT         NOT NULL,
    description   VARCHAR(200)
) ENGINE=InnoDB;

INSERT INTO app_setting VALUES
 ('cancel_cutoff_minutes',   60, 'A booking can be cancelled by its owner only if the slot starts more than this many minutes from now'),
 ('session_early_minutes',   15, 'A charging session may be started at most this many minutes before the slot start time');

-- ---------------------------------------------------------------------
-- users  (FR-01 is Aarya's; this table is the shared foundation)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(150) NOT NULL,
    phone         VARCHAR(15),
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(10)  NOT NULL DEFAULT 'USER',
    is_active     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT uq_users_name  UNIQUE (name),   -- the name doubles as a login id (case-insensitive collation)
    CONSTRAINT chk_users_role CHECK (role IN ('USER','ADMIN')),
    CONSTRAINT chk_users_phone CHECK (phone IS NULL OR phone REGEXP '^[0-9+]{7,15}$')
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- charging_station
-- ---------------------------------------------------------------------
CREATE TABLE charging_station (
    station_id INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(120)  NOT NULL,
    address    VARCHAR(255)  NOT NULL,
    latitude   DECIMAL(9,6)  NOT NULL,
    longitude  DECIMAL(9,6)  NOT NULL,
    status     VARCHAR(15)   NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_station_name UNIQUE (name),
    CONSTRAINT chk_station_lat    CHECK (latitude  BETWEEN -90  AND 90),
    CONSTRAINT chk_station_lng    CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT chk_station_status CHECK (status IN ('ACTIVE','INACTIVE','MAINTENANCE')),
    INDEX ix_station_location (latitude, longitude),
    INDEX ix_station_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- charger (a physical charging point at a station)
-- ---------------------------------------------------------------------
CREATE TABLE charger (
    charger_id    INT AUTO_INCREMENT PRIMARY KEY,
    station_id    INT           NOT NULL,
    charger_type  VARCHAR(20)   NOT NULL,
    power_kw      DECIMAL(6,2)  NOT NULL,
    price_per_kwh DECIMAL(8,2)  NOT NULL,
    status        VARCHAR(15)   NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT fk_charger_station FOREIGN KEY (station_id)
        REFERENCES charging_station (station_id) ON DELETE RESTRICT,
    CONSTRAINT chk_charger_type   CHECK (charger_type IN ('CCS2','CHAdeMO','Type2','GBT','AC001')),
    CONSTRAINT chk_charger_power  CHECK (power_kw > 0),
    CONSTRAINT chk_charger_price  CHECK (price_per_kwh >= 0),
    CONSTRAINT chk_charger_status CHECK (status IN ('ACTIVE','INACTIVE','MAINTENANCE')),
    INDEX ix_charger_station (station_id),
    INDEX ix_charger_type (charger_type)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- charging_slot (a bookable time window on one charger)
-- ---------------------------------------------------------------------
CREATE TABLE charging_slot (
    slot_id    INT AUTO_INCREMENT PRIMARY KEY,
    charger_id INT         NOT NULL,
    start_time DATETIME    NOT NULL,
    end_time   DATETIME    NOT NULL,
    status     VARCHAR(15) NOT NULL DEFAULT 'AVAILABLE',
    CONSTRAINT fk_slot_charger FOREIGN KEY (charger_id)
        REFERENCES charger (charger_id) ON DELETE RESTRICT,
    CONSTRAINT uq_slot_charger_start UNIQUE (charger_id, start_time),
    CONSTRAINT chk_slot_time   CHECK (end_time > start_time),
    CONSTRAINT chk_slot_status CHECK (status IN ('AVAILABLE','BOOKED','BLOCKED')),
    INDEX ix_slot_status_start (status, start_time),
    INDEX ix_slot_start (start_time)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- booking
-- active_slot_id is a STORED generated column: it equals slot_id while the
-- booking is "active" (CONFIRMED / IN_PROGRESS) and NULL otherwise.
-- UNIQUE(active_slot_id) therefore means: a slot can have AT MOST ONE active
-- booking, enforced by the database itself. NULLs are not considered equal in a
-- UNIQUE index, so any number of CANCELLED/COMPLETED rows may exist.
-- This is the last line of defence against double booking, even if the
-- application / stored procedure had a bug.
-- ---------------------------------------------------------------------
CREATE TABLE booking (
    booking_id     INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT         NOT NULL,
    slot_id        INT         NOT NULL,
    status         VARCHAR(15) NOT NULL DEFAULT 'CONFIRMED',
    booked_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cancelled_at   DATETIME    NULL,
    active_slot_id INT GENERATED ALWAYS AS
        (CASE WHEN status IN ('CONFIRMED','IN_PROGRESS') THEN slot_id ELSE NULL END) STORED,
    CONSTRAINT fk_booking_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_booking_slot FOREIGN KEY (slot_id) REFERENCES charging_slot (slot_id) ON DELETE RESTRICT,
    CONSTRAINT chk_booking_status CHECK (status IN ('CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED')),
    CONSTRAINT uq_active_slot UNIQUE (active_slot_id),
    INDEX ix_booking_user (user_id, booked_at),
    INDEX ix_booking_slot (slot_id),
    INDEX ix_booking_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- charging_session  (0 or 1 per booking)
-- ---------------------------------------------------------------------
CREATE TABLE charging_session (
    session_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT           NOT NULL,
    start_time DATETIME      NOT NULL,
    end_time   DATETIME      NULL,
    energy_kwh DECIMAL(8,3)  NULL,
    cost       DECIMAL(10,2) NULL,
    status     VARCHAR(15)   NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT fk_session_booking FOREIGN KEY (booking_id)
        REFERENCES booking (booking_id) ON DELETE RESTRICT,
    CONSTRAINT uq_session_booking UNIQUE (booking_id),
    CONSTRAINT chk_session_status CHECK (status IN ('ACTIVE','COMPLETED')),
    CONSTRAINT chk_session_energy CHECK (energy_kwh IS NULL OR energy_kwh >= 0),
    CONSTRAINT chk_session_cost   CHECK (cost IS NULL OR cost >= 0),
    CONSTRAINT chk_session_time   CHECK (end_time IS NULL OR end_time >= start_time),
    INDEX ix_session_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- payment (optional scope: one payment record per booking)
-- ---------------------------------------------------------------------
CREATE TABLE payment (
    payment_id      INT AUTO_INCREMENT PRIMARY KEY,
    booking_id      INT           NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    status          VARCHAR(15)   NOT NULL DEFAULT 'PENDING',
    transaction_ref VARCHAR(50)   NOT NULL,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payment_booking FOREIGN KEY (booking_id)
        REFERENCES booking (booking_id) ON DELETE RESTRICT,
    CONSTRAINT uq_payment_booking UNIQUE (booking_id),
    CONSTRAINT uq_payment_ref UNIQUE (transaction_ref),
    CONSTRAINT chk_payment_amount CHECK (amount >= 0),
    CONSTRAINT chk_payment_status CHECK (status IN ('PENDING','PAID','REFUNDED','FAILED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- booking_audit: every booking state change is recorded (auditable DB).
-- No foreign key on purpose: audit rows must survive any later clean-up.
-- ---------------------------------------------------------------------
CREATE TABLE booking_audit (
    audit_id   INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT         NOT NULL,
    old_status VARCHAR(15) NULL,
    new_status VARCHAR(15) NOT NULL,
    changed_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_audit_booking (booking_id)
) ENGINE=InnoDB;

DROP TRIGGER IF EXISTS trg_booking_ai;
DROP TRIGGER IF EXISTS trg_booking_au;

DELIMITER $$
CREATE TRIGGER trg_booking_ai AFTER INSERT ON booking
FOR EACH ROW
BEGIN
    INSERT INTO booking_audit (booking_id, old_status, new_status)
    VALUES (NEW.booking_id, NULL, NEW.status);
END$$

CREATE TRIGGER trg_booking_au AFTER UPDATE ON booking
FOR EACH ROW
BEGIN
    IF NOT (OLD.status <=> NEW.status) THEN
        INSERT INTO booking_audit (booking_id, old_status, new_status)
        VALUES (NEW.booking_id, OLD.status, NEW.status);
    END IF;
END$$
DELIMITER ;
