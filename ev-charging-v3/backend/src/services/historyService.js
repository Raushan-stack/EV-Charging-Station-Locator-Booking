'use strict';
const { query } = require('../db');

const BOOKING_STATUSES = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

// FR-11: always filtered by the logged-in user_id (users can never read others' history).
async function bookingHistory(userId, { status, active, limit, offset }) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (status) { where.push('booking_status = ?'); params.push(status); }
  if (active) where.push("booking_status IN ('CONFIRMED','IN_PROGRESS')");
  const sql = `SELECT * FROM User_Booking_History_View WHERE ${where.join(' AND ')}
               ORDER BY booked_at DESC, booking_id DESC LIMIT ? OFFSET ?`;
  const rows = await query(sql, [...params, limit, offset]);
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM User_Booking_History_View WHERE ${where.join(' AND ')}`, params);
  return { rows, total };
}

async function sessionHistory(userId, { limit, offset }) {
  const rows = await query(
    `SELECT * FROM Charging_Session_Summary_View WHERE user_id = ?
     ORDER BY start_time DESC, session_id DESC LIMIT ? OFFSET ?`, [userId, limit, offset]);
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM Charging_Session_Summary_View WHERE user_id = ?', [userId]);
  const [summary] = await query(
    `SELECT COUNT(*) AS completed_sessions, COALESCE(SUM(energy_kwh),0) AS total_energy_kwh, COALESCE(SUM(cost),0) AS total_cost
       FROM Charging_Session_Summary_View WHERE user_id = ? AND session_status = 'COMPLETED'`, [userId]);
  return { rows, total, summary };
}

async function bookingById(bookingId) {
  const rows = await query('SELECT * FROM User_Booking_History_View WHERE booking_id = ?', [bookingId]);
  return rows[0];
}

module.exports = { BOOKING_STATUSES, bookingHistory, sessionHistory, bookingById };
