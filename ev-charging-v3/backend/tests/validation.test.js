'use strict';
// FR-14 Validation & error handling
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let u; let admin;
before(async () => { await h.start(); u = await h.makeUser(); admin = await h.makeUser('ADMIN'); });
after(h.stop);

test('invalid slot_id values -> 400 VALIDATION_ERROR (and nothing is written)', async () => {
  const before = (await h.one('SELECT COUNT(*) n FROM booking')).n;
  for (const bad of [0, -1, 'abc', '1; DROP TABLE booking', 1.5, null, 99999999999, [], {}, true]) {
    const r = await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: bad } });
    assert.equal(r.status, 400, `slot_id=${JSON.stringify(bad)} -> ${r.status}`);
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await h.api('POST', '/api/bookings', { token: u.token, body: {} })).status, 400);
  assert.equal((await h.one('SELECT COUNT(*) n FROM booking')).n, before);
});

test('malformed JSON and non-object bodies -> 400, not 500', async () => {
  const r = await h.api('POST', '/api/bookings', { token: u.token, raw: '{bad json', body: {} });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'INVALID_JSON');
  const r2 = await h.api('POST', '/api/bookings', { token: u.token, raw: '[1,2]', body: {} });
  assert.equal(r2.status, 400);
});

test('SQL-injection style input is treated as plain data (parameterised queries)', async () => {
  const r = await h.api('GET', `/api/availability/slots?date=${encodeURIComponent("2026-01-01' OR '1'='1")}`);
  assert.equal(r.status, 400);
  const r2 = await h.api('GET', `/api/history/bookings?status=${encodeURIComponent("CONFIRMED' OR 1=1 --")}`, { token: u.token });
  assert.equal(r2.status, 400);
  const name = `Robert'); DROP TABLE users;-- ${h.uniq()}`;
  const st = await h.api('POST', '/api/admin/stations', { token: admin.token, body: { name, address: 'x', latitude: 1, longitude: 1 } });
  assert.equal(st.status, 201);
  assert.equal(st.body.data.name, name);
  assert.ok((await h.one('SELECT COUNT(*) n FROM users')).n > 0, 'users table still exists');
});

test('invalid admin payloads are rejected with field-level messages', async () => {
  const bads = [
    { name: '', address: 'a', latitude: 1, longitude: 1 },
    { name: 'n', address: 'a', latitude: 120, longitude: 1 },
    { name: 'n', address: 'a', latitude: 1, longitude: 'x' },
    { name: 'n', address: 'a', latitude: 1, longitude: 1, status: 'BROKEN' },
    { name: 'x'.repeat(500), address: 'a', latitude: 1, longitude: 1 },
  ];
  for (const b of bads) {
    const r = await h.api('POST', '/api/admin/stations', { token: admin.token, body: b });
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 60));
    assert.ok(r.body.error.message.length > 0);
  }
  const c = await h.makeCharger();
  for (const b of [{ charger_type: 'TESLA', power_kw: 10, price_per_kwh: 1 }, { charger_type: 'CCS2', power_kw: 0, price_per_kwh: 1 }, { charger_type: 'CCS2', power_kw: 10, price_per_kwh: -1 }]) {
    assert.equal((await h.api('POST', `/api/admin/stations/${c.stationId}/chargers`, { token: admin.token, body: b })).status, 400);
  }
  assert.equal((await h.api('POST', '/api/admin/stations/2147483000/chargers', { token: admin.token, body: { charger_type: 'CCS2', power_kw: 10, price_per_kwh: 1 } })).status, 404);
  assert.equal((await h.api('POST', `/api/admin/chargers/${c.chargerId}/slots/generate`, { token: admin.token, body: { date: '2026-13-45', start_hour: 9, end_hour: 12 } })).status, 400);
  assert.equal((await h.api('POST', `/api/admin/chargers/${c.chargerId}/slots/generate`, { token: admin.token, body: { date: '2026-12-01', start_hour: 12, end_hour: 9 } })).status, 400);
});

test('unknown routes -> 404 JSON; missing/invalid auth -> 401', async () => {
  const r = await h.api('GET', '/api/does-not-exist');
  assert.equal(r.status, 404); assert.equal(r.body.error.code, 'NOT_FOUND');
  assert.equal((await h.api('POST', '/api/bookings', { body: { slot_id: 1 } })).status, 401);
  assert.equal((await h.api('GET', '/api/health')).status, 200);
});

test('errors never leak SQL text or stack traces', async () => {
  const r = await h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: 2147483000 } });
  const text = JSON.stringify(r.body);
  assert.ok(!/SELECT|INSERT|stack|ER_|sqlMessage/i.test(text), text);
});

test('procedure input guards (called directly) also reject bad IDs', async () => {
  await assert.rejects(h.db.query('CALL sp_book_slot(?,?,0)', [0, 1]), (e) => e.errno === 50014);
  await assert.rejects(h.db.query('CALL sp_cancel_booking(?,?,0)', [-3, 1]), (e) => e.errno === 50014);
  await assert.rejects(h.db.query('CALL sp_end_session(?,?,0,?)', [1, 1, -5]), (e) => e.errno === 50011);
});

test('T02 duplicate email is rejected by the UNIQUE constraint', async () => {
  const email = `dup_${h.uniq()}@test.local`;
  await h.db.query("INSERT INTO users (name,email,password_hash) VALUES ('a',?,'x')", [email]);
  await assert.rejects(h.db.query("INSERT INTO users (name,email,password_hash) VALUES ('b',?,'x')", [email]),
    (e) => e.errno === 1062 && /uq_users_email/.test(e.sqlMessage));
  await assert.rejects(h.db.query("INSERT INTO users (name,email,password_hash,role) VALUES ('c','r@x.com','x','SUPERUSER')"));
});
