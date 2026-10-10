'use strict';
const router = require('express').Router();
const v = require('../validators');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { AppError } = require('../errors');
const sessions = require('../services/sessionService');

router.use(authenticate);

// POST /api/sessions/start  { booking_id }     -> FR-10
router.post('/start', asyncHandler(async (req, res) => {
  const bookingId = v.id(v.body(req).booking_id, 'booking_id');
  const out = await sessions.startSession(bookingId, req.user);
  res.status(201).json({ success: true, message: 'Charging session started', data: out });
}));

// POST /api/sessions/:id/end  { energy_kwh }
router.post('/:id/end', asyncHandler(async (req, res) => {
  const sessionId = v.id(req.params.id, 'id');
  const energy = v.number(v.body(req).energy_kwh, 'energy_kwh', { min: 0, max: 100000 });
  const out = await sessions.endSession(sessionId, req.user, energy);
  res.json({ success: true, message: 'Charging session completed', data: out });
}));

// GET /api/sessions/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await sessions.getSession(v.id(req.params.id, 'id'));
  if (!row || (req.user.role !== 'ADMIN' && row.user_id !== req.user.id)) throw new AppError(404, 'SESSION_NOT_FOUND', 'Charging session not found');
  res.json({ success: true, data: row });
}));

module.exports = router;
