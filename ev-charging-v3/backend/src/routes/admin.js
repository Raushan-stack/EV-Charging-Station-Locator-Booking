'use strict';
const router = require('express').Router();
const v = require('../validators');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const admin = require('../services/adminService');
const booking = require('../services/bookingService');
const sessions = require('../services/sessionService');
const history = require('../services/historyService');

// Every admin route: must be logged in AND have role ADMIN (checked against the DB).
router.use(authenticate, requireAdmin);

const STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'];
const TYPES = ['CCS2', 'CHAdeMO', 'Type2', 'GBT', 'AC001'];
const ok = (res, data, status = 200, extra = {}) => res.status(status).json({ success: true, data, ...extra });

function stationInput(b) {
  return {
    name: v.string(b.name, 'name', { max: 120 }),
    address: v.string(b.address, 'address', { max: 255 }),
    latitude: v.number(b.latitude, 'latitude', { min: -90, max: 90 }),
    longitude: v.number(b.longitude, 'longitude', { min: -180, max: 180 }),
    status: b.status === undefined ? 'ACTIVE' : v.oneOf(b.status, 'status', STATUSES),
  };
}
function chargerInput(b) {
  return {
    charger_type: v.oneOf(b.charger_type, 'charger_type', TYPES),
    power_kw: v.number(b.power_kw, 'power_kw', { min: 0, exclusiveMin: true, max: 1000 }),
    price_per_kwh: v.number(b.price_per_kwh, 'price_per_kwh', { min: 0, max: 100000 }),
    status: b.status === undefined ? 'ACTIVE' : v.oneOf(b.status, 'status', STATUSES),
  };
}

router.get('/dashboard', asyncHandler(async (_req, res) => ok(res, await admin.dashboard())));

// ----- stations -----
router.get('/stations', asyncHandler(async (_req, res) => ok(res, await admin.listStations())));
router.get('/stations/:id', asyncHandler(async (req, res) => ok(res, await admin.getStation(v.id(req.params.id, 'id')))));
router.post('/stations', asyncHandler(async (req, res) => ok(res, await admin.createStation(stationInput(v.body(req))), 201)));
router.put('/stations/:id', asyncHandler(async (req, res) =>
  ok(res, await admin.updateStation(v.id(req.params.id, 'id'), stationInput(v.body(req))))));
router.delete('/stations/:id', asyncHandler(async (req, res) => {
  await admin.deleteStation(v.id(req.params.id, 'id'));
  ok(res, { deleted: true });
}));

// ----- chargers -----
router.get('/chargers', asyncHandler(async (req, res) =>
  ok(res, await admin.listChargers(v.optionalId(req.query.station_id, 'station_id')))));
router.post('/stations/:id/chargers', asyncHandler(async (req, res) =>
  ok(res, await admin.createCharger(v.id(req.params.id, 'id'), chargerInput(v.body(req))), 201)));
router.put('/chargers/:id', asyncHandler(async (req, res) =>
  ok(res, await admin.updateCharger(v.id(req.params.id, 'id'), chargerInput(v.body(req))))));
router.delete('/chargers/:id', asyncHandler(async (req, res) => {
  await admin.deleteCharger(v.id(req.params.id, 'id'));
  ok(res, { deleted: true });
}));

// ----- slots -----
router.get('/chargers/:id/slots', asyncHandler(async (req, res) =>
  ok(res, await admin.listSlots(v.id(req.params.id, 'id'), req.query.date === undefined ? undefined : v.date(req.query.date, 'date')))));

router.post('/chargers/:id/slots', asyncHandler(async (req, res) => {
  const b = v.body(req);
  const start = v.datetime(b.start_time, 'start_time');
  const end = v.datetime(b.end_time, 'end_time');
  if (end <= start) v.fail('end_time', 'must be after start_time');
  ok(res, await admin.createSlot(v.id(req.params.id, 'id'), start, end), 201);
}));

router.post('/chargers/:id/slots/generate', asyncHandler(async (req, res) => {
  const b = v.body(req);
  const out = await admin.generateSlots(
    v.id(req.params.id, 'id'), v.date(b.date, 'date'),
    v.integer(b.start_hour, 'start_hour', { min: 0, max: 23 }),
    v.integer(b.end_hour, 'end_hour', { min: 1, max: 24 }),
    v.integer(b.slot_minutes ?? 60, 'slot_minutes', { min: 15, max: 480 }));
  ok(res, out, 201);
}));

router.patch('/slots/:id/status', asyncHandler(async (req, res) =>
  ok(res, await admin.setSlotStatus(v.id(req.params.id, 'id'), v.oneOf(v.body(req).status, 'status', ['AVAILABLE', 'BLOCKED'])))));
router.delete('/slots/:id', asyncHandler(async (req, res) => {
  await admin.deleteSlot(v.id(req.params.id, 'id'));
  ok(res, { deleted: true });
}));

// ----- monitoring -----
router.get('/bookings', asyncHandler(async (req, res) => {
  const { limit, offset } = v.pagination(req.query);
  const { rows, total } = await admin.monitorBookings({
    status: req.query.status === undefined ? undefined : v.oneOf(req.query.status, 'status', history.BOOKING_STATUSES),
    stationId: v.optionalId(req.query.station_id, 'station_id'),
    date: req.query.date === undefined ? undefined : v.date(req.query.date, 'date'),
    limit, offset,
  });
  ok(res, rows, 200, { meta: { total, limit, offset } });
}));
router.get('/bookings/:id/audit', asyncHandler(async (req, res) => ok(res, await admin.bookingAudit(v.id(req.params.id, 'id')))));
router.post('/bookings/:id/cancel', asyncHandler(async (req, res) =>
  ok(res, await booking.cancelBooking(v.id(req.params.id, 'id'), req.user))));

router.get('/sessions', asyncHandler(async (req, res) => {
  const { limit, offset } = v.pagination(req.query);
  const { rows, total } = await admin.monitorSessions({
    status: req.query.status === undefined ? undefined : v.oneOf(req.query.status, 'status', ['ACTIVE', 'COMPLETED']),
    stationId: v.optionalId(req.query.station_id, 'station_id'),
    limit, offset,
  });
  ok(res, rows, 200, { meta: { total, limit, offset } });
}));
router.post('/sessions/:id/end', asyncHandler(async (req, res) =>
  ok(res, await sessions.endSession(v.id(req.params.id, 'id'), req.user,
    v.number(v.body(req).energy_kwh, 'energy_kwh', { min: 0, max: 100000 })))));

module.exports = router;
