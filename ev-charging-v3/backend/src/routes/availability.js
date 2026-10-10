'use strict';
// Read-only availability endpoints backed by the SQL VIEWS (FR-12). Public: no login needed.
const router = require('express').Router();
const { query } = require('../db');
const v = require('../validators');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/availability/stations  -> Station_Availability_View
router.get('/stations', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await query('SELECT * FROM Station_Availability_View ORDER BY station_id') });
}));

// GET /api/availability/slots?station_id=&charger_id=&charger_type=&date=YYYY-MM-DD
router.get('/slots', asyncHandler(async (req, res) => {
  const where = []; const p = [];
  const stationId = v.optionalId(req.query.station_id, 'station_id');
  const chargerId = v.optionalId(req.query.charger_id, 'charger_id');
  if (stationId) { where.push('station_id = ?'); p.push(stationId); }
  if (chargerId) { where.push('charger_id = ?'); p.push(chargerId); }
  if (req.query.charger_type !== undefined) {
    where.push('charger_type = ?'); p.push(v.oneOf(req.query.charger_type, 'charger_type', ['CCS2', 'CHAdeMO', 'Type2', 'GBT', 'AC001']));
  }
  if (req.query.date !== undefined) { where.push('DATE(start_time) = ?'); p.push(v.date(req.query.date, 'date')); }
  const { limit, offset } = v.pagination(req.query);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(`SELECT * FROM Available_Slots_View ${w} ORDER BY start_time, charger_id LIMIT ? OFFSET ?`, [...p, limit, offset]);
  res.json({ success: true, data: rows });
}));

module.exports = router;
