'use strict';
const router = require('express').Router();
const v = require('../validators');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { AppError } = require('../errors');
const booking = require('../services/bookingService');
const history = require('../services/historyService');

router.use(authenticate);

// POST /api/bookings  { slot_id }   -> FR-06 / FR-07 / FR-08  (one atomic DB transaction)
router.post('/', asyncHandler(async (req, res) => {
  const b = v.body(req);
  const slotId = v.id(b.slot_id, 'slot_id');
  const created = await booking.bookSlot(req.user.id, slotId, b.simulate_failure === true);
  res.status(201).json({ success: true, message: 'Booking confirmed', data: created });
}));

// GET /api/bookings/:id  (own booking; admin can read any)
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await history.bookingById(v.id(req.params.id, 'id'));
  if (!row || (req.user.role !== 'ADMIN' && row.user_id !== req.user.id)) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  res.json({ success: true, data: row });
}));

// POST /api/bookings/:id/cancel   -> FR-09
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const out = await booking.cancelBooking(v.id(req.params.id, 'id'), req.user);
  res.json({ success: true, message: 'Booking cancelled and slot released', data: out });
}));

module.exports = router;
