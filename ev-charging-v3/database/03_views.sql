-- =====================================================================
-- 03_views_corrected.sql - FR-12 Database Views
-- Compatible with MySQL 8+ / MariaDB versions supporting CREATE OR REPLACE VIEW
-- =====================================================================

-- 1) Upcoming slots that are actually available to book.
CREATE OR REPLACE VIEW Available_Slots_View AS
SELECT
    st.station_id,
    st.name AS station_name,
    st.address,
    st.latitude,
    st.longitude,
    c.charger_id,
    c.charger_type,
    c.power_kw,
    c.price_per_kwh,
    s.slot_id,
    s.start_time,
    s.end_time
FROM charging_slot AS s
JOIN charger AS c
    ON c.charger_id = s.charger_id
JOIN charging_station AS st
    ON st.station_id = c.station_id
WHERE s.status = 'AVAILABLE'
  AND s.end_time > NOW()
  AND c.status = 'ACTIVE'
  AND st.status = 'ACTIVE';


-- 2) Station-wise charger and slot counts.
-- free_slots counts only slots at active chargers in active stations.
CREATE OR REPLACE VIEW Station_Availability_View AS
SELECT
    st.station_id,
    st.name AS station_name,
    st.address,
    st.latitude,
    st.longitude,
    st.status AS station_status,
    COUNT(DISTINCT c.charger_id) AS total_chargers,
    COUNT(DISTINCT CASE
        WHEN c.status = 'ACTIVE' THEN c.charger_id
    END) AS active_chargers,
    COUNT(CASE
        WHEN s.end_time > NOW() THEN s.slot_id
    END) AS upcoming_slots,
    COUNT(CASE
        WHEN s.end_time > NOW()
         AND s.status = 'AVAILABLE'
         AND c.status = 'ACTIVE'
         AND st.status = 'ACTIVE'
        THEN s.slot_id
    END) AS free_slots,
    COUNT(CASE
        WHEN s.end_time > NOW()
         AND s.status = 'BOOKED'
        THEN s.slot_id
    END) AS booked_slots,
    COUNT(CASE
        WHEN s.end_time > NOW()
         AND s.status = 'BLOCKED'
        THEN s.slot_id
    END) AS blocked_slots
FROM charging_station AS st
LEFT JOIN charger AS c
    ON c.station_id = st.station_id
LEFT JOIN charging_slot AS s
    ON s.charger_id = c.charger_id
GROUP BY
    st.station_id,
    st.name,
    st.address,
    st.latitude,
    st.longitude,
    st.status;


-- 3) Booking history, with optional session and payment details.
CREATE OR REPLACE VIEW User_Booking_History_View AS
SELECT
    b.booking_id,
    b.user_id,
    u.name AS user_name,
    b.status AS booking_status,
    b.booked_at,
    b.cancelled_at,
    s.slot_id,
    s.start_time AS slot_start,
    s.end_time AS slot_end,
    c.charger_id,
    c.charger_type,
    c.power_kw,
    c.price_per_kwh,
    st.station_id,
    st.name AS station_name,
    st.address AS station_address,
    cs.session_id,
    cs.status AS session_status,
    cs.start_time AS session_start,
    cs.end_time AS session_end,
    cs.energy_kwh,
    cs.cost,
    p.status AS payment_status,
    p.transaction_ref
FROM booking AS b
JOIN users AS u
    ON u.user_id = b.user_id
JOIN charging_slot AS s
    ON s.slot_id = b.slot_id
JOIN charger AS c
    ON c.charger_id = s.charger_id
JOIN charging_station AS st
    ON st.station_id = c.station_id
LEFT JOIN charging_session AS cs
    ON cs.booking_id = b.booking_id
LEFT JOIN payment AS p
    ON p.booking_id = b.booking_id;


-- 4) One row per charging session, including duration and effective rate.
CREATE OR REPLACE VIEW Charging_Session_Summary_View AS
SELECT
    cs.session_id,
    cs.booking_id,
    b.user_id,
    u.name AS user_name,
    st.station_id,
    st.name AS station_name,
    c.charger_id,
    c.charger_type,
    cs.status AS session_status,
    cs.start_time,
    cs.end_time,
    CASE
        WHEN cs.end_time IS NULL THEN NULL
        ELSE GREATEST(
            0,
            TIMESTAMPDIFF(MINUTE, cs.start_time, cs.end_time)
        )
    END AS duration_minutes,
    cs.energy_kwh,
    c.price_per_kwh,
    cs.cost,
    CASE
        WHEN cs.energy_kwh > 0 THEN ROUND(cs.cost / cs.energy_kwh, 2)
        ELSE NULL
    END AS effective_rate_per_kwh
FROM charging_session AS cs
JOIN booking AS b
    ON b.booking_id = cs.booking_id
JOIN users AS u
    ON u.user_id = b.user_id
JOIN charging_slot AS s
    ON s.slot_id = b.slot_id
JOIN charger AS c
    ON c.charger_id = s.charger_id
JOIN charging_station AS st
    ON st.station_id = c.station_id;


-- 5) Station-level booking, energy and session-cost reporting.
-- Aggregate bookings and sessions separately to prevent join multiplication
-- from inflating counts, energy, or cost if a booking has multiple sessions.
CREATE OR REPLACE VIEW Station_Utilization_View AS
SELECT
    st.station_id,
    st.name AS station_name,
    COALESCE(booking_totals.total_bookings, 0) AS total_bookings,
    COALESCE(booking_totals.cancelled_bookings, 0) AS cancelled_bookings,
    COALESCE(booking_totals.completed_bookings, 0) AS completed_bookings,
    COALESCE(session_totals.total_energy_kwh, 0) AS total_energy_kwh,
    COALESCE(session_totals.total_revenue, 0) AS total_revenue
FROM charging_station AS st
LEFT JOIN (
    SELECT
        c.station_id,
        COUNT(DISTINCT b.booking_id) AS total_bookings,
        COUNT(DISTINCT CASE
            WHEN b.status = 'CANCELLED' THEN b.booking_id
        END) AS cancelled_bookings,
        COUNT(DISTINCT CASE
            WHEN b.status = 'COMPLETED' THEN b.booking_id
        END) AS completed_bookings
    FROM charger AS c
    JOIN charging_slot AS s
        ON s.charger_id = c.charger_id
    JOIN booking AS b
        ON b.slot_id = s.slot_id
    GROUP BY c.station_id
) AS booking_totals
    ON booking_totals.station_id = st.station_id
LEFT JOIN (
    SELECT
        c.station_id,
        COALESCE(SUM(cs.energy_kwh), 0) AS total_energy_kwh,
        COALESCE(SUM(cs.cost), 0) AS total_revenue
    FROM charger AS c
    JOIN charging_slot AS s
        ON s.charger_id = c.charger_id
    JOIN booking AS b
        ON b.slot_id = s.slot_id
    JOIN charging_session AS cs
        ON cs.booking_id = b.booking_id
    GROUP BY c.station_id
) AS session_totals
    ON session_totals.station_id = st.station_id;
