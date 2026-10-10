'use strict';
// FR-10 Charging session | Tests T12, T13
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let c;
before(async () => { await h.start(); c = await h.makeCharger({ power: 50, price: 12.5 }); });
after(h.stop);

async function bookedNow(user, startOffset = -5, duration = 60, charger) {
  charger = charger || await h.makeCharger({ power: 50, price: 12.5 }); // fresh charger: slot start times are unique per charger
  const slot = await h.makeSlot(charger.chargerId, startOffset, duration);
  const r = await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: slot } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { slot, bookingId: r.body.data.booking_id };
}

test('T12+T13 full session: start -> end stores time, energy, cost, payment and releases resource', async () => {
  const u = await h.makeUser();
  const { slot, bookingId } = await bookedNow(u);
  const st = await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: bookingId } });
  assert.equal(st.status, 201);
  const sid = st.body.data.session_id;
  assert.equal((await h.one('SELECT status FROM booking WHERE booking_id = ?', [bookingId])).status, 'IN_PROGRESS');
  const active = await h.one('SELECT * FROM charging_session WHERE session_id = ?', [sid]);
  assert.equal(active.status, 'ACTIVE'); assert.equal(active.end_time, null);

  const end = await h.api('POST', `/api/sessions/${sid}/end`, { token: u.token, body: { energy_kwh: 20.4 } });
  assert.equal(end.status, 200);
  assert.equal(end.body.data.cost, 255); // 20.4 * 12.5
  const done = await h.one('SELECT * FROM charging_session WHERE session_id = ?', [sid]);
  assert.equal(done.status, 'COMPLETED');
  assert.ok(done.end_time && done.end_time >= done.start_time);
  assert.equal(done.energy_kwh, 20.4);
  assert.equal(done.cost, 255);
  assert.equal((await h.one('SELECT status FROM booking WHERE booking_id = ?', [bookingId])).status, 'COMPLETED');
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [slot])).status, 'AVAILABLE');
  const pay = await h.one('SELECT * FROM payment WHERE booking_id = ?', [bookingId]);
  assert.equal(pay.amount, 255); assert.equal(pay.status, 'PAID');
  const view = await h.one('SELECT * FROM Charging_Session_Summary_View WHERE session_id = ?', [sid]);
  assert.equal(view.energy_kwh, 20.4); assert.equal(view.session_status, 'COMPLETED');
  const audit = await h.db.query('SELECT new_status FROM booking_audit WHERE booking_id = ? ORDER BY audit_id', [bookingId]);
  assert.deepEqual(audit.map((a) => a.new_status), ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED']);
});

test('session cannot start for a CANCELLED booking', async () => {
  const u = await h.makeUser();
  const { bookingId } = await bookedNow(u, 300); // far future so owner can cancel
  await h.api('POST', `/api/bookings/${bookingId}/cancel`, { token: u.token });
  const r = await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: bookingId } });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'INVALID_BOOKING_STATE');
  assert.equal((await h.one('SELECT COUNT(*) n FROM charging_session WHERE booking_id = ?', [bookingId])).n, 0);
});

test('session cannot start too early (window opens 15 min before slot)', async () => {
  const u = await h.makeUser();
  const { bookingId } = await bookedNow(u, 120);
  const r = await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: bookingId } });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'SESSION_TOO_EARLY');
});

test('session may start in the 15-minute early window', async () => {
  const u = await h.makeUser();
  const { bookingId } = await bookedNow(u, 10);
  assert.equal((await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: bookingId } })).status, 201);
});

test('session cannot start after the slot has ended', async () => {
  const u = await h.makeUser();
  const slot = await h.makeSlot(c.chargerId, -50, 60);
  const b = await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: slot } });
  assert.equal(b.status, 201);
  await h.db.query('UPDATE charging_slot SET end_time = NOW() - INTERVAL 1 MINUTE WHERE slot_id = ?', [slot]);
  const r = await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: b.body.data.booking_id } });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'SLOT_EXPIRED');
});

test('only the booking owner can start / end; double start and double end rejected', async () => {
  const u = await h.makeUser(); const other = await h.makeUser();
  const { bookingId } = await bookedNow(u);
  assert.equal((await h.api('POST', '/api/sessions/start', { token: other.token, body: { booking_id: bookingId } })).status, 403);
  const st = await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: bookingId } });
  const sid = st.body.data.session_id;
  const dup = await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: bookingId } });
  assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'SESSION_ALREADY_STARTED');
  assert.equal((await h.api('POST', `/api/sessions/${sid}/end`, { token: other.token, body: { energy_kwh: 1 } })).status, 403);
  assert.equal((await h.api('POST', `/api/sessions/${sid}/end`, { token: u.token, body: { energy_kwh: 1 } })).status, 200);
  const again = await h.api('POST', `/api/sessions/${sid}/end`, { token: u.token, body: { energy_kwh: 1 } });
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'SESSION_NOT_ACTIVE');
  assert.equal((await h.one('SELECT COUNT(*) n FROM payment WHERE booking_id = ?', [bookingId])).n, 1, 'exactly one payment');
});

test('invalid energy values are rejected and the session stays ACTIVE', async () => {
  const u = await h.makeUser();
  const { bookingId } = await bookedNow(u);
  const sid = (await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: bookingId } })).body.data.session_id;
  for (const bad of [-1, 'abc', null, undefined, 51]) { // 50 kW charger x 1 h slot = 50 kWh max
    const r = await h.api('POST', `/api/sessions/${sid}/end`, { token: u.token, body: bad === undefined ? {} : { energy_kwh: bad } });
    assert.equal(r.status, 400, `energy ${bad}`);
  }
  const s = await h.one('SELECT status, energy_kwh FROM charging_session WHERE session_id = ?', [sid]);
  assert.equal(s.status, 'ACTIVE'); assert.equal(s.energy_kwh, null);
  assert.equal((await h.api('POST', `/api/sessions/${sid}/end`, { token: u.token, body: { energy_kwh: 0 } })).status, 200);
});

test('unknown session / booking ids', async () => {
  const u = await h.makeUser();
  assert.equal((await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: 2147483000 } })).status, 404);
  assert.equal((await h.api('POST', '/api/sessions/2147483000/end', { token: u.token, body: { energy_kwh: 1 } })).status, 404);
  assert.equal((await h.api('POST', '/api/sessions/start', { token: u.token, body: {} })).status, 400);
});

test('session cannot start while charger is under maintenance', async () => {
  const u = await h.makeUser();
  const ch = await h.makeCharger();
  const { bookingId } = await bookedNow(u, -5, 60, ch);
  await h.db.query("UPDATE charger SET status = 'MAINTENANCE' WHERE charger_id = ?", [ch.chargerId]);
  const r = await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: bookingId } });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'CHARGER_UNAVAILABLE');
});
