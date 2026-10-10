'use strict';
const router = require('express').Router();
const v = require('../validators');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const history = require('../services/historyService');

router.use(authenticate);

// GET /api/history/bookings?status=&active=true&limit=&offset=     -> FR-11
router.get('/bookings', asyncHandler(async (req, res) => {
  const { limit, offset } = v.pagination(req.query);
  const status = req.query.status === undefined ? undefined : v.oneOf(req.query.status, 'status', history.BOOKING_STATUSES);
  const active = req.query.active === 'true';
  const { rows, total } = await history.bookingHistory(req.user.id, { status, active, limit, offset });
  res.json({ success: true, data: rows, meta: { total, limit, offset } });
}));

// GET /api/history/sessions?limit=&offset=
router.get('/sessions', asyncHandler(async (req, res) => {
  const { limit, offset } = v.pagination(req.query);
  const { rows, total, summary } = await history.sessionHistory(req.user.id, { limit, offset });
  res.json({ success: true, data: rows, meta: { total, limit, offset, summary } });
}));

module.exports = router;
