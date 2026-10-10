'use strict';
const { callProc, withRetry } = require('../db');
const config = require('../config');

// FR-08/06/07: every call is ONE database transaction (stored procedure sp_book_slot).
async function bookSlot(userId, slotId, simulateFailure = false) {
  const flag = simulateFailure && config.enableTestHooks ? 1 : 0;
  return withRetry(() => callProc('sp_book_slot', [userId, slotId, flag]));
}

// FR-09
async function cancelBooking(bookingId, actor) {
  return withRetry(() => callProc('sp_cancel_booking', [bookingId, actor.id, actor.role === 'ADMIN' ? 1 : 0]));
}

module.exports = { bookSlot, cancelBooking };
