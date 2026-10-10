'use strict';
// FR-09 Booking cancellation | Tests T10, T11
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let c; let admin;
before(async () => { await h.start(); c = await h.makeCharger(); admin = await h.makeUser('ADMIN'); });
after(h.stop);

async function book(user, offset) {
  const slot = await h.makeSlot(c.chargerId, offset);
  const r = await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: slot } });
  assert.equal(r.status, 201);
  return { slot, bookingId: r.body.data.booking_id };
}

test('T10 valid cancellation: booking CANCELLED, slot released, slot bookable again', async () => {
  const u = await h.makeUser(); const u2 = await h.makeUser();
  const { slot, bookingId } = await book(u, 600);
  const r = await h.api('POST', `/api/bookings/${bookingId}/cancel`, { token: u.token });
  assert.equal(r.status, 200);
  assert.equal((await h.one('SELECT status, cancelled_at FROM booking WHERE booking_id = ?', [bookingId])).status, 'CANCELLED');
  assert.notEqual((await h.one('SELECT cancelled_at FROM booking WHERE booking_id = ?', [bookingId])).cancelled_at, null);
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [slot])).status, 'AVAILABLE');
  assert.equal((await h.db.query('SELECT 1 FROM Available_Slots_View WHERE slot_id = ?', [slot])).length, 1);
  // released resource can be booked by someone else; the cancelled row stays as history
  assert.equal((await h.api('POST', '/api/bookings', { token: u2.token, body: { slot_id: slot } })).status, 201);
  assert.equal((await h.one('SELECT COUNT(*) n FROM booking WHERE slot_id = ?', [slot])).n, 2);
  const audit = await h.db.query('SELECT new_status FROM booking_audit WHERE booking_id = ? ORDER BY audit_id', [bookingId]);
  assert.deepEqual(audit.map((a) => a.new_status), ['CONFIRMED', 'CANCELLED']);
});

test('T11a cancelling twice is rejected (INVALID_BOOKING_STATE)', async () => {
  const u = await h.makeUser();
  const { bookingId } = await book(u, 640);
  await h.api('POST', `/api/bookings/${bookingId}/cancel`, { token: u.token });
  const r = await h.api('POST', `/api/bookings/${bookingId}/cancel`, { token: u.token });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INVALID_BOOKING_STATE');
});

test('T11b cancelling someone else\'s booking is forbidden and changes nothing', async () => {
  const owner = await h.makeUser(); const other = await h.makeUser();
  const { slot, bookingId } = await book(owner, 680);
  const r = await h.api('POST', `/api/bookings/${bookingId}/cancel`, { token: other.token });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'NOT_OWNER');
  assert.equal((await h.one('SELECT status FROM booking WHERE booking_id = ?', [bookingId])).status, 'CONFIRMED');
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [slot])).status, 'BOOKED');
});

test('T11c cancelling inside the cut-off window (slot starts in 30 min) is rejected; admin may override', async () => {
  const u = await h.makeUser();
  const { slot, bookingId } = await book(u, 30);
  const r = await h.api('POST', `/api/bookings/${bookingId}/cancel`, { token: u.token });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'CANCEL_TOO_LATE');
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [slot])).status, 'BOOKED');
  const a = await h.api('POST', `/api/admin/bookings/${bookingId}/cancel`, { token: admin.token });
  assert.equal(a.status, 200);
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [slot])).status, 'AVAILABLE');
});

test('T11d cancelling a booking whose session is in progress / completed is rejected', async () => {
  const u = await h.makeUser();
  const slot = await h.makeSlot(c.chargerId, -5, 60); // window is open now
  const b = await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: slot } });
  const bookingId = b.body.data.booking_id;
  const s = await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: bookingId } });
  assert.equal(s.status, 201);
  const r = await h.api('POST', `/api/bookings/${bookingId}/cancel`, { token: u.token });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INVALID_BOOKING_STATE');
  await h.api('POST', `/api/sessions/${s.body.data.session_id}/end`, { token: u.token, body: { energy_kwh: 5 } });
  const r2 = await h.api('POST', `/api/bookings/${bookingId}/cancel`, { token: u.token });
  assert.equal(r2.status, 409);
});

test('T11e unknown booking id -> 404, malformed id -> 400', async () => {
  const u = await h.makeUser();
  assert.equal((await h.api('POST', '/api/bookings/2147483000/cancel', { token: u.token })).status, 404);
  assert.equal((await h.api('POST', '/api/bookings/abc/cancel', { token: u.token })).status, 400);
  assert.equal((await h.api('POST', '/api/bookings/-4/cancel', { token: u.token })).status, 400);
});
