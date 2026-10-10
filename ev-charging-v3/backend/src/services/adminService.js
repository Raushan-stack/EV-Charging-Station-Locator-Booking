'use strict';
const { query, withTransaction, callProc } = require('../db');
const { AppError } = require('../errors');

const one = (rows, what) => { if (!rows.length) throw new AppError(404, 'NOT_FOUND', `${what} not found`); return rows[0]; };

// ---------------- dashboard ----------------
async function dashboard() {
  const [stations] = await query(`SELECT COUNT(*) total, SUM(status='ACTIVE') active FROM charging_station`);
  const [chargers] = await query(`SELECT COUNT(*) total, SUM(status='ACTIVE') active FROM charger`);
  const slots = await query(`SELECT status, COUNT(*) n FROM charging_slot WHERE end_time > NOW() GROUP BY status`);
  const bookings = await query(`SELECT status, COUNT(*) n FROM booking GROUP BY status`);
  const [sessions] = await query(
    `SELECT COUNT(*) total, SUM(status='ACTIVE') active, COALESCE(SUM(energy_kwh),0) energy_kwh, COALESCE(SUM(cost),0) revenue
       FROM charging_session`);
  const utilization = await query('SELECT * FROM Station_Utilization_View ORDER BY total_revenue DESC, station_id');
  return {
    stations, chargers,
    upcoming_slots: Object.fromEntries(slots.map((r) => [r.status, r.n])),
    bookings: Object.fromEntries(bookings.map((r) => [r.status, r.n])),
    sessions, utilization,
  };
}

// ---------------- stations ----------------
async function listStations() { return query('SELECT * FROM charging_station ORDER BY station_id'); }
async function getStation(id) { return one(await query('SELECT * FROM charging_station WHERE station_id = ?', [id]), 'Station'); }
async function createStation(s) {
  const r = await query('INSERT INTO charging_station (name, address, latitude, longitude, status) VALUES (?,?,?,?,?)',
    [s.name, s.address, s.latitude, s.longitude, s.status]);
  return getStation(r.insertId);
}
async function updateStation(id, s) {
  await getStation(id);
  await query('UPDATE charging_station SET name=?, address=?, latitude=?, longitude=?, status=? WHERE station_id=?',
    [s.name, s.address, s.latitude, s.longitude, s.status, id]);
  return getStation(id);
}
async function deleteStation(id) {
  await getStation(id);
  await query('DELETE FROM charging_station WHERE station_id = ?', [id]); // FK RESTRICT -> IN_USE if chargers exist
}

// ---------------- chargers ----------------
async function listChargers(stationId) {
  return stationId
    ? query('SELECT * FROM charger WHERE station_id = ? ORDER BY charger_id', [stationId])
    : query('SELECT * FROM charger ORDER BY charger_id');
}
async function getCharger(id) { return one(await query('SELECT * FROM charger WHERE charger_id = ?', [id]), 'Charger'); }
async function createCharger(stationId, c) {
  await getStation(stationId);
  const r = await query('INSERT INTO charger (station_id, charger_type, power_kw, price_per_kwh, status) VALUES (?,?,?,?,?)',
    [stationId, c.charger_type, c.power_kw, c.price_per_kwh, c.status]);
  return getCharger(r.insertId);
}
async function updateCharger(id, c) {
  await getCharger(id);
  await query('UPDATE charger SET charger_type=?, power_kw=?, price_per_kwh=?, status=? WHERE charger_id=?',
    [c.charger_type, c.power_kw, c.price_per_kwh, c.status, id]);
  return getCharger(id);
}
async function deleteCharger(id) {
  await getCharger(id);
  await query('DELETE FROM charger WHERE charger_id = ?', [id]);
}

// ---------------- slots ----------------
async function listSlots(chargerId, date) {
  await getCharger(chargerId);
  return date
    ? query('SELECT * FROM charging_slot WHERE charger_id = ? AND DATE(start_time) = ? ORDER BY start_time', [chargerId, date])
    : query('SELECT * FROM charging_slot WHERE charger_id = ? AND end_time > NOW() ORDER BY start_time LIMIT 500', [chargerId]);
}

async function createSlot(chargerId, start, end) {
  return withTransaction(async (conn) => {
    const [c] = await conn.query('SELECT charger_id FROM charger WHERE charger_id = ? FOR UPDATE', [chargerId]);
    if (!c.length) throw new AppError(404, 'NOT_FOUND', 'Charger not found');
    const [ov] = await conn.query(
      'SELECT COUNT(*) n FROM charging_slot WHERE charger_id = ? AND start_time < ? AND end_time > ?', [chargerId, end, start]);
    if (ov[0].n > 0) throw new AppError(409, 'SLOT_OVERLAP', 'This charger already has a slot overlapping that time');
    const [r] = await conn.query('INSERT INTO charging_slot (charger_id, start_time, end_time) VALUES (?,?,?)', [chargerId, start, end]);
    const [rows] = await conn.query('SELECT * FROM charging_slot WHERE slot_id = ?', [r.insertId]);
    return rows[0];
  });
}

async function generateSlots(chargerId, date, startHour, endHour, slotMinutes) {
  return callProc('sp_generate_slots', [chargerId, date, startHour, endHour, slotMinutes]);
}

// Admin may only block a free slot and unblock a blocked one. BOOKED is only ever set by the booking procedures.
async function setSlotStatus(slotId, newStatus) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT slot_id, status FROM charging_slot WHERE slot_id = ? FOR UPDATE', [slotId]);
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Slot not found');
    const cur = rows[0].status;
    const ok = (cur === 'AVAILABLE' && newStatus === 'BLOCKED') || (cur === 'BLOCKED' && newStatus === 'AVAILABLE') || cur === newStatus;
    if (!ok) throw new AppError(409, 'INVALID_SLOT_STATE', `Cannot change slot from ${cur} to ${newStatus}` +
      (cur === 'BOOKED' ? ' (cancel the booking first)' : ''));
    await conn.query('UPDATE charging_slot SET status = ? WHERE slot_id = ?', [newStatus, slotId]);
    const [out] = await conn.query('SELECT * FROM charging_slot WHERE slot_id = ?', [slotId]);
    return out[0];
  });
}

async function deleteSlot(slotId) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT status FROM charging_slot WHERE slot_id = ? FOR UPDATE', [slotId]);
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Slot not found');
    const [b] = await conn.query('SELECT COUNT(*) n FROM booking WHERE slot_id = ?', [slotId]);
    if (b[0].n > 0) throw new AppError(409, 'IN_USE', 'Slot has booking history and cannot be deleted (block it instead)');
    await conn.query('DELETE FROM charging_slot WHERE slot_id = ?', [slotId]);
  });
}

// ---------------- monitoring ----------------
async function monitorBookings({ status, stationId, date, limit, offset }) {
  const where = []; const p = [];
  if (status) { where.push('booking_status = ?'); p.push(status); }
  if (stationId) { where.push('station_id = ?'); p.push(stationId); }
  if (date) { where.push('DATE(slot_start) = ?'); p.push(date); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(`SELECT * FROM User_Booking_History_View ${w} ORDER BY booked_at DESC, booking_id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
  const [{ total }] = await query(`SELECT COUNT(*) total FROM User_Booking_History_View ${w}`, p);
  return { rows, total };
}

async function monitorSessions({ status, stationId, limit, offset }) {
  const where = []; const p = [];
  if (status) { where.push('session_status = ?'); p.push(status); }
  if (stationId) { where.push('station_id = ?'); p.push(stationId); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(`SELECT * FROM Charging_Session_Summary_View ${w} ORDER BY start_time DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
  const [{ total }] = await query(`SELECT COUNT(*) total FROM Charging_Session_Summary_View ${w}`, p);
  return { rows, total };
}

async function bookingAudit(bookingId) {
  return query('SELECT audit_id, old_status, new_status, changed_at FROM booking_audit WHERE booking_id = ? ORDER BY audit_id', [bookingId]);
}

module.exports = {
  dashboard, listStations, getStation, createStation, updateStation, deleteStation,
  listChargers, getCharger, createCharger, updateCharger, deleteCharger,
  listSlots, createSlot, generateSlots, setSlotStatus, deleteSlot,
  monitorBookings, monitorSessions, bookingAudit,
};
