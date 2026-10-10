'use strict';
// FR-08 Database Transactions, FR-06 booking, FR-14 validation (booking paths)  | Tests T08, T15
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let user; let user2; let admin; let c;
before(async () => {
  await h.start();
  user = await h.makeUser(); user2 = await h.makeUser(); admin = await h.makeUser('ADMIN');
  c = await h.makeCharger();
});
after(h.stop);

test('T08 valid booking commits: booking row + slot BOOKED + audit row', async () => {
  const slot = await h.makeSlot(c.chargerId, 300);
  const r = await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: slot } });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.status, 'CONFIRMED');
  const b = await h.one('SELECT * FROM booking WHERE booking_id = ?', [r.body.data.booking_id]);
  assert.equal(b.user_id, user.id);
  assert.equal(b.slot_id, slot);
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [slot])).status, 'BOOKED');
  const audit = await h.db.query('SELECT old_status, new_status FROM booking_audit WHERE booking_id = ?', [b.booking_id]);
  assert.deepEqual(audit.map((a) => a.new_status), ['CONFIRMED']);
});

test('booked slot disappears from Available_Slots_View', async () => {
  const u = await h.makeUser();
  const slot = await h.makeSlot(c.chargerId, 320);
  assert.equal((await h.db.query('SELECT 1 FROM Available_Slots_View WHERE slot_id = ?', [slot])).length, 1);
  assert.equal((await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: slot } })).status, 201);
  assert.equal((await h.db.query('SELECT 1 FROM Available_Slots_View WHERE slot_id = ?', [slot])).length, 0);
});

test('T15 failure in the middle of a booking rolls back everything (no partial data)', async () => {
  const u = await h.makeUser();
  const slot = await h.makeSlot(c.chargerId, 340);
  const before = await h.one('SELECT COUNT(*) n FROM booking');
  const auditBefore = await h.one('SELECT COUNT(*) n FROM booking_audit');
  const r = await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: slot, simulate_failure: true } });
  assert.equal(r.status, 500);
  assert.equal(r.body.error.code, 'SIMULATED_FAILURE');
  // INSERT booking and UPDATE slot had already executed inside the transaction -> must be undone
  assert.equal((await h.one('SELECT COUNT(*) n FROM booking WHERE slot_id = ?', [slot])).n, 0);
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [slot])).status, 'AVAILABLE');
  assert.equal((await h.one('SELECT COUNT(*) n FROM booking')).n, before.n);
  assert.equal((await h.one('SELECT COUNT(*) n FROM booking_audit')).n, auditBefore.n, 'trigger-written audit row was rolled back too');
  // and the slot is still bookable afterwards
  const again = await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: slot } });
  assert.equal(again.status, 201);
});

test('already booked slot is rejected with 409 SLOT_UNAVAILABLE', async () => {
  const slot = await h.makeSlot(c.chargerId, 360);
  assert.equal((await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: slot } })).status, 201);
  const r = await h.api('POST', '/api/bookings', { token: user2.token, body: { slot_id: slot } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'SLOT_UNAVAILABLE');
});

test('blocked slot cannot be booked', async () => {
  const slot = await h.makeSlot(c.chargerId, 380, 60, 'BLOCKED');
  const r = await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: slot } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'SLOT_UNAVAILABLE');
});

test('slot in the past (already ended) is rejected', async () => {
  const slot = await h.makeSlot(c.chargerId, -180, 60);
  const r = await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: slot } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'SLOT_EXPIRED');
});

test('non-existent slot -> 404 SLOT_NOT_FOUND', async () => {
  const r = await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: 2147483000 } });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'SLOT_NOT_FOUND');
});

test('charger under maintenance / inactive station cannot be booked', async () => {
  const m = await h.makeCharger({ chargerStatus: 'MAINTENANCE' });
  const slot = await h.makeSlot(m.chargerId, 400);
  const r = await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: slot } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'CHARGER_UNAVAILABLE');
  assert.equal((await h.one('SELECT COUNT(*) n FROM booking WHERE slot_id = ?', [slot])).n, 0);
});

test('one user cannot hold two overlapping active bookings', async () => {
  const u = await h.makeUser();
  const c2 = await h.makeCharger();
  const s1 = await h.makeSlot(c.chargerId, 500, 60);
  const s2 = await h.makeSlot(c2.chargerId, 530, 60); // overlaps s1 by 30 min, different charger
  assert.equal((await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: s1 } })).status, 201);
  const r = await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: s2 } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'BOOKING_OVERLAP');
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [s2])).status, 'AVAILABLE');
});

test('deactivated user cannot book (auth layer rejects)', async () => {
  const u = await h.makeUser();
  await h.db.query('UPDATE users SET is_active = 0 WHERE user_id = ?', [u.id]);
  const slot = await h.makeSlot(c.chargerId, 560);
  const r = await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: slot } });
  assert.equal(r.status, 401);
});

test('database constraint alone blocks a 2nd active booking even if a bug bypassed the procedure', async () => {
  const slot = await h.makeSlot(c.chargerId, 600);
  await h.db.query("INSERT INTO booking (user_id, slot_id, status) VALUES (?,?,'CONFIRMED')", [user.id, slot]);
  await assert.rejects(
    h.db.query("INSERT INTO booking (user_id, slot_id, status) VALUES (?,?,'CONFIRMED')", [user2.id, slot]),
    (e) => e.errno === 1062 && /uq_active_slot/.test(e.sqlMessage));
  // but a CANCELLED row for the same slot is fine (history is kept)
  await h.db.query("INSERT INTO booking (user_id, slot_id, status) VALUES (?,?,'CANCELLED')", [user2.id, slot]);
});

test('check constraints reject bad data at the database level', async () => {
  await assert.rejects(h.db.query("INSERT INTO charging_slot (charger_id,start_time,end_time) VALUES (?, NOW(), NOW() - INTERVAL 1 HOUR)", [c.chargerId]));
  await assert.rejects(h.db.query("INSERT INTO charger (station_id,charger_type,power_kw,price_per_kwh) VALUES (?, 'CCS2', -5, 10)", [c.stationId]));
  await assert.rejects(h.db.query("INSERT INTO charging_station (name,address,latitude,longitude) VALUES ('x','y',123,10)"));
});
