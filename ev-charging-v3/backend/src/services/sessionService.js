'use strict';
const { callProc, withRetry, query } = require('../db');

// FR-10
async function startSession(bookingId, actor) {
  return withRetry(() => callProc('sp_start_session', [bookingId, actor.id, actor.role === 'ADMIN' ? 1 : 0]));
}

async function endSession(sessionId, actor, energyKwh) {
  return withRetry(() => callProc('sp_end_session', [sessionId, actor.id, actor.role === 'ADMIN' ? 1 : 0, energyKwh]));
}

async function getSession(sessionId) {
  const rows = await query('SELECT * FROM Charging_Session_Summary_View WHERE session_id = ?', [sessionId]);
  return rows[0];
}

module.exports = { startSession, endSession, getSession };
