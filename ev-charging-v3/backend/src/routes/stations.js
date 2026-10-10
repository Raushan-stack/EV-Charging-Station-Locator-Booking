'use strict';
// FR-03 search, FR-04 geolocation, FR-05 availability grid (Aarya). Read-only; public.
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const v = require('../validators');
const { AppError } = require('../errors');
const { asyncHandler } = require('../middleware/errorHandler');

const TYPES = ['CCS2', 'CHAdeMO', 'Type2', 'GBT', 'AC001'];

// GET /api/stations?q=&type=&only_available=true&lat=&lng=&radius_km=
router.get('/', asyncHandler(async (req, res) => {
  const { q, type, only_available: onlyAvail, lat, lng, radius_km: radius } = req.query;
  const params = [];
  const hasLoc = lat !== undefined && lat !== '' && lng !== undefined && lng !== '';
  let dist = 'NULL';
  if (hasLoc) {
    const la = v.number(lat, 'lat', { min: -90, max: 90 });
    const lo = v.number(lng, 'lng', { min: -180, max: 180 });
    // Haversine formula: great-circle distance in km
    dist = `ROUND(6371 * ACOS(LEAST(1, COS(RADIANS(?)) * COS(RADIANS(sv.latitude)) *
            COS(RADIANS(sv.longitude) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(sv.latitude)))), 2)`;
    params.push(la, lo, la);
  }
  let sql = `SELECT sv.station_id, sv.station_name AS name, sv.address, sv.latitude, sv.longitude,
                    sv.total_chargers, sv.free_slots, ${dist} AS distance_km,
                    (SELECT GROUP_CONCAT(DISTINCT c.charger_type ORDER BY c.charger_type)
                       FROM charger c WHERE c.station_id = sv.station_id AND c.status = 'ACTIVE') AS charger_types
               FROM Station_Availability_View sv
              WHERE sv.station_status = 'ACTIVE'`;
  if (q !== undefined && String(q).trim() !== '') {
    const like = `%${v.string(String(q), 'q', { max: 100 })}%`;
    sql += ' AND (sv.station_name LIKE ? OR sv.address LIKE ?)';
    params.push(like, like);
  }
  if (type !== undefined && type !== '' && type !== 'ALL') {
    sql += ` AND EXISTS (SELECT 1 FROM charger c2 WHERE c2.station_id = sv.station_id AND c2.status = 'ACTIVE' AND c2.charger_type = ?)`;
    params.push(v.oneOf(type, 'type', TYPES));
  }
  if (onlyAvail === 'true' || onlyAvail === '1') sql += ' AND sv.free_slots > 0';
  if (hasLoc && radius !== undefined && radius !== '') {
    sql += ' HAVING distance_km <= ?';
    params.push(v.number(radius, 'radius_km', { min: 0, exclusiveMin: true, max: 20000 }));
  }
  sql += hasLoc ? ' ORDER BY distance_km ASC' : ' ORDER BY sv.station_name ASC';
  const rows = await query(sql, params);
  res.json({ success: true, data: rows.map((r) => ({ ...r, charger_types: r.charger_types ? r.charger_types.split(',') : [] })) });
}));

// GET /api/stations/:id  -> station + chargers
router.get('/:id', asyncHandler(async (req, res) => {
  const id = v.id(req.params.id, 'id');
  const st = await query('SELECT * FROM charging_station WHERE station_id = ?', [id]);
  if (!st.length) throw new AppError(404, 'STATION_NOT_FOUND', 'Station not found');
  const chargers = await query(
    'SELECT charger_id, charger_type, power_kw, price_per_kwh, status FROM charger WHERE station_id = ? ORDER BY charger_id', [id]);
  res.json({ success: true, data: { ...st[0], chargers } });
}));

// GET /api/stations/:id/slots?date=YYYY-MM-DD  -> every slot of the day (free, booked, blocked) for the grid
router.get('/:id/slots', asyncHandler(async (req, res) => {
  const id = v.id(req.params.id, 'id');
  const date = req.query.date === undefined ? null : v.date(req.query.date, 'date');
  let userId = 0;                                   // optional login: lets the grid mark "your booking"
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { userId = Number(jwt.verify(h.slice(7), config.jwtSecret, { algorithms: ['HS256'] }).user_id) || 0; } catch (_) { /* guest */ }
  }
  const slots = await query(
    `SELECT s.slot_id, s.charger_id, s.start_time, s.end_time, s.status,
            (s.end_time <= NOW()) AS is_past, b.booking_id AS my_booking_id
       FROM charging_slot s
       JOIN charger c ON c.charger_id = s.charger_id
       LEFT JOIN booking b ON b.slot_id = s.slot_id AND b.active_slot_id IS NOT NULL AND b.user_id = ?
      WHERE c.station_id = ? AND DATE(s.start_time) = COALESCE(?, CURDATE())
      ORDER BY s.charger_id, s.start_time`, [userId, id, date]);
  const [t] = await query('SELECT NOW() AS now');
  res.json({ success: true, data: { server_time: t.now, date: date || t.now.slice(0, 10), slots } });
}));

module.exports = router;
