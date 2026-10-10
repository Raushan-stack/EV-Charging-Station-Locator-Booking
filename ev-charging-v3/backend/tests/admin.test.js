'use strict';
// FR-13 Admin dashboard + role checks | Test T16
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let admin; let user;
before(async () => { await h.start(); admin = await h.makeUser('ADMIN'); user = await h.makeUser(); });
after(h.stop);

test('role-based access: anonymous 401, normal user 403, admin 200', async () => {
  assert.equal((await h.api('GET', '/api/admin/dashboard')).status, 401);
  assert.equal((await h.api('GET', '/api/admin/dashboard', { token: user.token })).status, 403);
  assert.equal((await h.api('GET', '/api/admin/dashboard', { token: admin.token })).status, 200);
  assert.equal((await h.api('POST', '/api/admin/stations', { token: user.token, body: {} })).status, 403);
  assert.equal((await h.api('GET', '/api/admin/dashboard', { token: 'garbage.token.value' })).status, 401);
});

test('role is read from the database, not trusted from the token', async () => {
  const u = await h.makeUser();
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ user_id: u.id, role: 'ADMIN' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  assert.equal((await h.api('GET', '/api/admin/dashboard', { token: forged })).status, 403);
  const wrongSecret = jwt.sign({ user_id: admin.id }, 'another-secret', { algorithm: 'HS256' });
  assert.equal((await h.api('GET', '/api/admin/dashboard', { token: wrongSecret })).status, 401);
});

test('T16 station -> charger -> slots lifecycle, changes are reflected in availability', async () => {
  const name = `Admin Test Station ${h.uniq()}`;
  const st = await h.api('POST', '/api/admin/stations', { token: admin.token, body: { name, address: '1 Test Rd', latitude: 28.61, longitude: 77.21 } });
  assert.equal(st.status, 201);
  const sid = st.body.data.station_id;
  assert.equal((await h.api('POST', '/api/admin/stations', { token: admin.token, body: { name, address: 'dup', latitude: 1, longitude: 1 } })).status, 409);

  const ch = await h.api('POST', `/api/admin/stations/${sid}/chargers`, { token: admin.token, body: { charger_type: 'CCS2', power_kw: 60, price_per_kwh: 15 } });
  assert.equal(ch.status, 201);
  const cid = ch.body.data.charger_id;

  const day = (await h.one("SELECT DATE_FORMAT(CURDATE() + INTERVAL 5 DAY, '%Y-%m-%d') d")).d;
  const gen = await h.api('POST', `/api/admin/chargers/${cid}/slots/generate`, { token: admin.token, body: { date: day, start_hour: 9, end_hour: 12, slot_minutes: 60 } });
  assert.equal(gen.status, 201); assert.equal(gen.body.data.slots_created, 3);
  const gen2 = await h.api('POST', `/api/admin/chargers/${cid}/slots/generate`, { token: admin.token, body: { date: day, start_hour: 9, end_hour: 12, slot_minutes: 60 } });
  assert.equal(gen2.body.data.slots_created, 0, 're-running is idempotent');

  const av = await h.api('GET', `/api/availability/slots?station_id=${sid}`);
  assert.equal(av.body.data.length, 3);

  const slots = (await h.api('GET', `/api/admin/chargers/${cid}/slots?date=${day}`, { token: admin.token })).body.data;
  const [s1, s2] = slots;
  assert.equal((await h.api('PATCH', `/api/admin/slots/${s1.slot_id}/status`, { token: admin.token, body: { status: 'BLOCKED' } })).status, 200);
  assert.equal((await h.api('GET', `/api/availability/slots?station_id=${sid}`)).body.data.length, 2, 'blocked slot hidden');
  assert.equal((await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: s1.slot_id } })).status, 409);
  assert.equal((await h.api('PATCH', `/api/admin/slots/${s1.slot_id}/status`, { token: admin.token, body: { status: 'AVAILABLE' } })).status, 200);

  // booked slot: cannot be blocked or deleted
  const bk = await h.api('POST', '/api/bookings', { token: user.token, body: { slot_id: s2.slot_id } });
  assert.equal(bk.status, 201);
  assert.equal((await h.api('PATCH', `/api/admin/slots/${s2.slot_id}/status`, { token: admin.token, body: { status: 'BLOCKED' } })).status, 409);
  assert.equal((await h.api('DELETE', `/api/admin/slots/${s2.slot_id}`, { token: admin.token })).status, 409);
  assert.equal((await h.api('PATCH', `/api/admin/slots/${s2.slot_id}/status`, { token: admin.token, body: { status: 'BOOKED' } })).status, 400);

  // monitoring + audit
  const mon = await h.api('GET', `/api/admin/bookings?station_id=${sid}`, { token: admin.token });
  assert.equal(mon.body.meta.total, 1);
  const audit = await h.api('GET', `/api/admin/bookings/${bk.body.data.booking_id}/audit`, { token: admin.token });
  assert.equal(audit.body.data.length, 1);

  // charger maintenance hides slots from availability
  assert.equal((await h.api('PUT', `/api/admin/chargers/${cid}`, { token: admin.token, body: { charger_type: 'CCS2', power_kw: 60, price_per_kwh: 15, status: 'MAINTENANCE' } })).status, 200);
  assert.equal((await h.api('GET', `/api/availability/slots?station_id=${sid}`)).body.data.length, 0);

  // delete protection (FK RESTRICT)
  assert.equal((await h.api('DELETE', `/api/admin/chargers/${cid}`, { token: admin.token })).status, 409);
  assert.equal((await h.api('DELETE', `/api/admin/stations/${sid}`, { token: admin.token })).status, 409);

  // an unused station can be deleted
  const tmp = await h.api('POST', '/api/admin/stations', { token: admin.token, body: { name: `Tmp ${h.uniq()}`, address: 'x', latitude: 10, longitude: 10 } });
  assert.equal((await h.api('DELETE', `/api/admin/stations/${tmp.body.data.station_id}`, { token: admin.token })).status, 200);
  assert.equal((await h.api('GET', `/api/admin/stations/${tmp.body.data.station_id}`, { token: admin.token })).status, 404);
});

test('single slot creation validates input and refuses overlaps', async () => {
  const c = await h.makeCharger();
  const day = (await h.one("SELECT DATE_FORMAT(CURDATE() + INTERVAL 6 DAY, '%Y-%m-%d') d")).d;
  const ok = await h.api('POST', `/api/admin/chargers/${c.chargerId}/slots`, { token: admin.token, body: { start_time: `${day} 10:00`, end_time: `${day} 11:00` } });
  assert.equal(ok.status, 201);
  const ov = await h.api('POST', `/api/admin/chargers/${c.chargerId}/slots`, { token: admin.token, body: { start_time: `${day} 10:30`, end_time: `${day} 11:30` } });
  assert.equal(ov.status, 409); assert.equal(ov.body.error.code, 'SLOT_OVERLAP');
  assert.equal((await h.api('POST', `/api/admin/chargers/${c.chargerId}/slots`, { token: admin.token, body: { start_time: `${day} 12:00`, end_time: `${day} 11:00` } })).status, 400);
  assert.equal((await h.api('POST', `/api/admin/chargers/${c.chargerId}/slots`, { token: admin.token, body: { start_time: 'tomorrow', end_time: 'later' } })).status, 400);
  assert.equal((await h.api('POST', `/api/admin/chargers/${c.chargerId}/slots`, { token: admin.token, body: { start_time: `${day} 25:00`, end_time: `${day} 26:00` } })).status, 400);
  assert.equal((await h.api('POST', '/api/admin/chargers/2147483000/slots', { token: admin.token, body: { start_time: `${day} 10:00`, end_time: `${day} 11:00` } })).status, 404);
});

test('dashboard returns totals and per-station utilization', async () => {
  const r = await h.api('GET', '/api/admin/dashboard', { token: admin.token });
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.ok(d.stations.total >= 1 && d.chargers.total >= 1);
  assert.ok(Array.isArray(d.utilization));
  assert.ok('bookings' in d && 'sessions' in d && 'upcoming_slots' in d);
});

test('admin can end a stuck session on behalf of a user', async () => {
  const u = await h.makeUser(); const c = await h.makeCharger();
  const slot = await h.makeSlot(c.chargerId, -5, 60);
  const b = (await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: slot } })).body.data.booking_id;
  const sid = (await h.api('POST', '/api/sessions/start', { token: u.token, body: { booking_id: b } })).body.data.session_id;
  const r = await h.api('POST', `/api/admin/sessions/${sid}/end`, { token: admin.token, body: { energy_kwh: 3 } });
  assert.equal(r.status, 200);
  assert.equal((await h.api('GET', '/api/admin/sessions?status=COMPLETED', { token: admin.token })).status, 200);
});
