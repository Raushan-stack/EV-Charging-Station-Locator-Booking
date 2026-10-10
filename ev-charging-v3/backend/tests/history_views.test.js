'use strict';
// FR-11 History, FR-12 Views | Test T14
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let u; let other; let c;
before(async () => {
  await h.start();
  u = await h.makeUser(); other = await h.makeUser();
  c = await h.makeCharger({ power: 22, price: 10 });
  // u: 1 completed (with session), 1 cancelled, 1 confirmed ; other: 1 confirmed
  const s1 = await h.makeSlot(c.chargerId, -5, 60);
  const b1 = (await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: s1 } })).body.data.booking_id;
  const sid = (await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: b1 } })).body.data.session_id;
  await h.api('POST', `/api/sessions/${sid}/end`, { token: u.token, body: { energy_kwh: 7.25 } });
  const s2 = await h.makeSlot(c.chargerId, 400, 60);
  const b2 = (await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: s2 } })).body.data.booking_id;
  await h.api('POST', `/api/bookings/${b2}/cancel`, { token: u.token });
  const s3 = await h.makeSlot(c.chargerId, 500, 60);
  await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: s3 } });
  const s4 = await h.makeSlot(c.chargerId, 600, 60);
  await h.api('POST', '/api/bookings', { token: other.token, body: { slot_id: s4 } });
});
after(h.stop);

test('T14 booking history returns only the caller\'s bookings with station/slot/session/cost info', async () => {
  const r = await h.api('GET', '/api/history/bookings', { token: u.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.meta.total, 3);
  assert.ok(r.body.data.every((b) => b.user_id === u.id));
  const done = r.body.data.find((b) => b.booking_status === 'COMPLETED');
  assert.equal(done.energy_kwh, 7.25); assert.equal(done.cost, 72.5); assert.equal(done.payment_status, 'PAID');
  assert.ok(done.station_name && done.slot_start && done.slot_end && done.session_start && done.session_end);
});

test('history filters: status, active, pagination', async () => {
  assert.equal((await h.api('GET', '/api/history/bookings?status=CANCELLED', { token: u.token })).body.data.length, 1);
  assert.equal((await h.api('GET', '/api/history/bookings?active=true', { token: u.token })).body.data.length, 1);
  const p = await h.api('GET', '/api/history/bookings?limit=2&offset=0', { token: u.token });
  assert.equal(p.body.data.length, 2); assert.equal(p.body.meta.total, 3);
  assert.equal((await h.api('GET', '/api/history/bookings?limit=2&offset=2', { token: u.token })).body.data.length, 1);
  assert.equal((await h.api('GET', '/api/history/bookings?status=BOGUS', { token: u.token })).status, 400);
  assert.equal((await h.api('GET', '/api/history/bookings?limit=1000', { token: u.token })).status, 400);
});

test('session history + totals', async () => {
  const r = await h.api('GET', '/api/history/sessions', { token: u.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.meta.summary.completed_sessions, 1);
  assert.equal(r.body.meta.summary.total_energy_kwh, 7.25);
  assert.equal(r.body.meta.summary.total_cost, 72.5);
  assert.equal((await h.api('GET', '/api/history/sessions', { token: other.token })).body.data.length, 0);
});

test('history requires login; users cannot read another user\'s booking by id', async () => {
  assert.equal((await h.api('GET', '/api/history/bookings')).status, 401);
  const mine = (await h.api('GET', '/api/history/bookings', { token: u.token })).body.data[0].booking_id;
  assert.equal((await h.api('GET', `/api/bookings/${mine}`, { token: other.token })).status, 404);
  assert.equal((await h.api('GET', `/api/bookings/${mine}`, { token: u.token })).status, 200);
});

test('FR-12 views agree with the base tables', async () => {
  const v1 = await h.one(`SELECT COUNT(*) n FROM Available_Slots_View WHERE charger_id = ?`, [c.chargerId]);
  const t1 = await h.one(`SELECT COUNT(*) n FROM charging_slot WHERE charger_id = ? AND status='AVAILABLE' AND end_time > NOW()`, [c.chargerId]);
  assert.equal(v1.n, t1.n);

  const sav = await h.one('SELECT * FROM Station_Availability_View WHERE station_id = ?', [c.stationId]);
  const base = await h.one(`SELECT SUM(status='BOOKED' AND end_time > NOW()) booked, SUM(status='AVAILABLE' AND end_time > NOW()) free
                            FROM charging_slot WHERE charger_id = ?`, [c.chargerId]);
  assert.equal(Number(sav.booked_slots), Number(base.booked));
  assert.equal(Number(sav.free_slots), Number(base.free));
  assert.equal(sav.total_chargers, 1);

  const util = await h.one('SELECT * FROM Station_Utilization_View WHERE station_id = ?', [c.stationId]);
  assert.equal(util.total_bookings, 4); assert.equal(util.cancelled_bookings, 1);
  assert.equal(util.completed_bookings, 1); assert.equal(util.total_revenue, 72.5);

  const hv = await h.one('SELECT COUNT(*) n FROM User_Booking_History_View WHERE user_id = ?', [u.id]);
  assert.equal(hv.n, 3);
});

test('availability API (backed by views) is public and filterable', async () => {
  const r = await h.api('GET', `/api/availability/slots?station_id=${c.stationId}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.data.every((s) => s.station_id === c.stationId && s.slot_id));
  assert.equal((await h.api('GET', '/api/availability/slots?charger_type=CCS2&limit=5')).body.data.length <= 5, true);
  assert.equal((await h.api('GET', '/api/availability/slots?charger_type=BAD')).status, 400);
  const st = await h.api('GET', '/api/availability/stations');
  assert.equal(st.status, 200);
  assert.ok(st.body.data.find((s) => s.station_id === c.stationId));
});
