-- =====================================================================
-- 05_queries.sql  -  Important SQL queries for the report / viva
-- (run after 04_sample_data.sql)
-- =====================================================================

-- Q1  Station search by name / address (runnable example for Delhi)
-- For an application prepared statement, replace '%Delhi%' with CONCAT('%', ?, '%')
SELECT station_id, name, address, status
  FROM charging_station
 WHERE status = 'ACTIVE'
   AND (name LIKE '%Delhi%' OR address LIKE '%Delhi%')
 ORDER BY name;

-- Q2  Nearby active stations: Haversine distance in km (Connaught Place, radius 15 km)
-- Clamp the cosine value to [-1, 1] to avoid ACOS errors from floating-point rounding.
SELECT station_id, name, distance_km
  FROM (
        SELECT station_id, name,
               ROUND(
                 6371 * ACOS(
                   GREATEST(-1, LEAST(1,
                     COS(RADIANS(28.6315)) * COS(RADIANS(latitude)) *
                     COS(RADIANS(longitude) - RADIANS(77.2167)) +
                     SIN(RADIANS(28.6315)) * SIN(RADIANS(latitude))
                   ))
                 ), 2
               ) AS distance_km
          FROM charging_station
         WHERE status = 'ACTIVE'
           AND latitude IS NOT NULL
           AND longitude IS NOT NULL
       ) AS nearby_stations
 WHERE distance_km <= 15
 ORDER BY distance_km;

-- Q3  Available slots (view) for one station, tomorrow
SELECT station_name, charger_id, charger_type, power_kw, price_per_kwh, slot_id, start_time, end_time
  FROM Available_Slots_View
 WHERE station_id = 1 AND DATE(start_time) = CURDATE() + INTERVAL 1 DAY
 ORDER BY start_time, charger_id
 LIMIT 10;

-- Q4  JOIN across station -> charger -> slot (all slot states for one station, tomorrow)
SELECT st.name AS station, c.charger_id, c.charger_type, s.slot_id, s.start_time, s.status
  FROM charging_station st
  JOIN charger c       ON c.station_id = st.station_id
  JOIN charging_slot s ON s.charger_id = c.charger_id
 WHERE st.station_id = 1 AND DATE(s.start_time) = CURDATE() + INTERVAL 1 DAY
 ORDER BY c.charger_id, s.start_time
 LIMIT 12;

-- Q5  A user's booking history (view)
SELECT booking_id, booking_status, station_name, slot_start, slot_end, energy_kwh, cost, payment_status
  FROM User_Booking_History_View
 WHERE user_id = 2
 ORDER BY booked_at DESC;

-- Q6  Aggregate: station utilisation (GROUP BY / COUNT / SUM)
SELECT * FROM Station_Utilization_View ORDER BY total_revenue DESC;

-- Q7  Aggregate: peak hours by number of bookings
SELECT HOUR(s.start_time) AS hour_of_day, COUNT(*) AS bookings
  FROM booking b JOIN charging_slot s ON s.slot_id = b.slot_id
 WHERE b.status <> 'CANCELLED'
 GROUP BY HOUR(s.start_time)
 ORDER BY bookings DESC, hour_of_day;

-- Q8  Station-wise availability (view)
SELECT station_name, total_chargers, active_chargers, free_slots, booked_slots, blocked_slots
  FROM Station_Availability_View;

-- Q9  Charging session summary (view)
SELECT session_id, user_name, station_name, duration_minutes, energy_kwh, cost, effective_rate_per_kwh
  FROM Charging_Session_Summary_View;

-- Q10 Audit trail of one booking
SELECT * FROM booking_audit WHERE booking_id = 3 ORDER BY audit_id;

-- Q11 Integrity check: slots flagged BOOKED but with no active booking (must return 0 rows)
SELECT s.slot_id FROM charging_slot s
 WHERE s.status = 'BOOKED'
   AND NOT EXISTS (SELECT 1 FROM booking b WHERE b.slot_id = s.slot_id AND b.status IN ('CONFIRMED','IN_PROGRESS'));

-- Q12 Integrity check: slots with MORE than one active booking (must return 0 rows)
SELECT slot_id, COUNT(*) AS active_bookings FROM booking
 WHERE status IN ('CONFIRMED','IN_PROGRESS') GROUP BY slot_id HAVING COUNT(*) > 1;
