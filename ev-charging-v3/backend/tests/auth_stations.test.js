'use strict';
// FR-01 (login/register/profile) and FR-02..05 (stations, search, geolocation, availability grid) - Aarya's part
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);

const reg = (o = {}) => h.api('POST', '/api/auth/register', { body: {
  name: `Reg ${h.uniq()}`, email: `r_${h.uniq()}@test.local`, phone: '9876543210', password: 'Passw0rdX', ...o } });

test('T01 valid registration returns token + user (no password hash leaked)', async () => {
  const r = await reg();
  assert.equal(r.status, 201);
  assert.ok(r.body.data.token);
  assert.equal(r.body.data.user.role, 'USER');
  assert.ok(!JSON.stringify(r.body).includes('password_hash'));
});

test('T02 duplicate email and duplicate name (any letter case) are rejected with 409', async () => {
  const a = await reg();
  const email = `dup_${h.uniq()}@test.local`;
  assert.equal((await reg({ email })).status, 201);
  assert.equal((await reg({ email })).status, 409);
  const name = `Same ${h.uniq()}`;
  assert.equal((await reg({ name })).status, 201);
  assert.equal((await reg({ name: name.toUpperCase() })).status, 409);
  assert.equal(a.status, 201);
});

test('database also enforces unique names (uq_users_name), not just the API', async () => {
  const name = `DbUniq ${h.uniq()}`;
  await h.db.query("INSERT INTO users (name,email,password_hash) VALUES (?,?, 'x')", [name, `a_${h.uniq()}@t.local`]);
  await assert.rejects(h.db.query("INSERT INTO users (name,email,password_hash) VALUES (?,?, 'x')", [name.toLowerCase(), `b_${h.uniq()}@t.local`]),
    (e) => e.errno === 1062 && /uq_users_name/.test(e.sqlMessage));
});

test('registration validation: weak password, bad email, bad phone, @ in name, missing fields', async () => {
  for (const bad of [{ password: 'short1' }, { password: 'onlyletters' }, { password: '12345678' }, { email: 'not-an-email' },
    { phone: 'abc' }, { phone: '123' }, { name: 'a@b' }, { name: '' }, { name: 'x'.repeat(200) }]) {
    const r = await reg(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal((await h.api('POST', '/api/auth/register', { body: {} })).status, 400);
});

test('T03/T04 login by email or by name; wrong password / unknown user give the SAME 401 message', async () => {
  const name = `Login ${h.uniq()}`; const email = `l_${h.uniq()}@test.local`;
  assert.equal((await reg({ name, email })).status, 201);
  assert.equal((await h.api('POST', '/api/auth/login', { body: { login: email.toUpperCase(), password: 'Passw0rdX' } })).status, 200);
  const byName = await h.api('POST', '/api/auth/login', { body: { login: name.toLowerCase(), password: 'Passw0rdX' } });
  assert.equal(byName.status, 200);
  const wrong = await h.api('POST', '/api/auth/login', { body: { login: email, password: 'WrongPass1' } });
  const none = await h.api('POST', '/api/auth/login', { body: { login: 'nobody@nowhere.test', password: 'WrongPass1' } });
  assert.equal(wrong.status, 401); assert.equal(none.status, 401);
  assert.equal(wrong.body.error.message, none.body.error.message);
  // token from login works on a protected route
  assert.equal((await h.api('GET', '/api/auth/me', { token: byName.body.data.token })).status, 200);
});

test('deactivated account cannot log in', async () => {
  const email = `d_${h.uniq()}@test.local`;
  await reg({ email });
  await h.db.query('UPDATE users SET is_active = 0 WHERE email = ?', [email]);
  assert.equal((await h.api('POST', '/api/auth/login', { body: { login: email, password: 'Passw0rdX' } })).status, 401);
});

test('profile update validates input and keeps names unique', async () => {
  const a = await reg(); const b = await reg();
  assert.equal((await h.api('PUT', '/api/auth/me', { token: a.body.data.token, body: { name: b.body.data.user.name, phone: '9123456780' } })).status, 409);
  assert.equal((await h.api('PUT', '/api/auth/me', { token: a.body.data.token, body: { name: `New ${h.uniq()}`, phone: 'bad' } })).status, 400);
  assert.equal((await h.api('PUT', '/api/auth/me', { token: a.body.data.token, body: { name: `New ${h.uniq()}`, phone: '9123456780' } })).status, 200);
  assert.equal((await h.api('GET', '/api/auth/me')).status, 401);
});

test('passwords are stored as bcrypt hashes, never plain text', async () => {
  const email = `p_${h.uniq()}@test.local`;
  await reg({ email, password: 'PlainText99' });
  const row = await h.one('SELECT password_hash FROM users WHERE email = ?', [email]);
  assert.match(row.password_hash, /^\$2[aby]\$10\$/);
  assert.ok(!row.password_hash.includes('PlainText99'));
});

// ---------------- stations ----------------
test('T05 search by name/address, charger type and free slots', async () => {
  const c = await h.makeCharger({ price: 9 });           // creates "Test Station <uniq>" with a CCS2 charger
  await h.makeSlot(c.chargerId, 300);
  const st = await h.one('SELECT name FROM charging_station WHERE station_id = ?', [c.stationId]);
  const r = await h.api('GET', `/api/stations?q=${encodeURIComponent(st.name)}`);
  assert.equal(r.status, 200); assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].station_id, c.stationId);
  assert.deepEqual(r.body.data[0].charger_types, ['CCS2']);
  assert.equal(r.body.data[0].free_slots, 1);
  assert.equal((await h.api('GET', `/api/stations?q=${encodeURIComponent(st.name)}&type=GBT`)).body.data.length, 0);
  assert.equal((await h.api('GET', `/api/stations?q=${encodeURIComponent(st.name)}&type=CCS2&only_available=true`)).body.data.length, 1);
  assert.equal((await h.api('GET', '/api/stations?type=BOGUS')).status, 400);
  const injected = await h.api('GET', `/api/stations?q=${encodeURIComponent("' OR '1'='1")}`);
  assert.equal(injected.status, 200); assert.equal(injected.body.data.length, 0);
});

test('stations under maintenance are not listed in search', async () => {
  const c = await h.makeCharger({ stationStatus: 'MAINTENANCE' });
  const st = await h.one('SELECT name FROM charging_station WHERE station_id = ?', [c.stationId]);
  assert.equal((await h.api('GET', `/api/stations?q=${encodeURIComponent(st.name)}`)).body.data.length, 0);
  assert.equal((await h.api('GET', `/api/stations/${c.stationId}`)).status, 200);   // details still reachable
});

test('T06 geolocation: distances are right, sorted nearest first, radius filter and validation', async () => {
  const mk = async (lat, lng) => {
    const s = await h.db.query('INSERT INTO charging_station (name,address,latitude,longitude) VALUES (?,?,?,?)', [`Geo ${h.uniq()}`, 'x', lat, lng]);
    return s.insertId;
  };
  // 0 km, ~1.11 km (0.01 degree of latitude) and ~111 km (1 degree) from (10, 10)
  const a = await mk(10, 10); const b = await mk(10.01, 10); const c = await mk(11, 10);
  const r = await h.api('GET', '/api/stations?lat=10&lng=10&radius_km=200');
  const mine = r.body.data.filter((x) => [a, b, c].includes(x.station_id));
  assert.deepEqual(mine.map((x) => x.station_id), [a, b, c]);
  assert.equal(mine[0].distance_km, 0);
  assert.ok(Math.abs(mine[1].distance_km - 1.11) < 0.02, String(mine[1].distance_km));
  assert.ok(Math.abs(mine[2].distance_km - 111.19) < 0.5, String(mine[2].distance_km));
  const near = await h.api('GET', '/api/stations?lat=10&lng=10&radius_km=5');
  assert.deepEqual(near.body.data.filter((x) => [a, b, c].includes(x.station_id)).map((x) => x.station_id), [a, b]);
  assert.equal((await h.api('GET', '/api/stations?lat=95&lng=10')).status, 400);
  assert.equal((await h.api('GET', '/api/stations?lat=abc&lng=10')).status, 400);
  assert.equal((await h.api('GET', '/api/stations?lat=10&lng=10&radius_km=-5')).status, 400);
});

test('station details + 404 / bad id', async () => {
  const c = await h.makeCharger();
  const r = await h.api('GET', `/api/stations/${c.stationId}`);
  assert.equal(r.status, 200); assert.equal(r.body.data.chargers.length, 1);
  assert.equal((await h.api('GET', '/api/stations/2147483000')).status, 404);
  assert.equal((await h.api('GET', '/api/stations/abc')).status, 400);
});

test('T07 availability grid: shows free / booked / blocked / past and marks my own booking', async () => {
  const c = await h.makeCharger(); const me = await h.makeUser(); const other = await h.makeUser();
  const free = await h.makeSlot(c.chargerId, 600);
  const mine = await h.makeSlot(c.chargerId, 700);
  const taken = await h.makeSlot(c.chargerId, 800);
  const blocked = await h.makeSlot(c.chargerId, 900, 60, 'BLOCKED');
  assert.equal((await h.api('POST', '/api/bookings', { token: me.token, body: { slot_id: mine } })).status, 201);
  assert.equal((await h.api('POST', '/api/bookings', { token: other.token, body: { slot_id: taken } })).status, 201);
  const day = (await h.one("SELECT DATE_FORMAT(NOW() + INTERVAL 600 MINUTE, '%Y-%m-%d') d")).d;
  const find = (rows, id) => rows.find((s) => s.slot_id === id);
  const asMe = (await h.api('GET', `/api/stations/${c.stationId}/slots?date=${day}`, { token: me.token })).body.data.slots;
  assert.equal(find(asMe, free).status, 'AVAILABLE'); assert.ok(!find(asMe, free).my_booking_id);
  assert.ok(find(asMe, mine).my_booking_id);
  assert.equal(find(asMe, taken).status, 'BOOKED'); assert.ok(!find(asMe, taken).my_booking_id);
  assert.equal(find(asMe, blocked).status, 'BLOCKED');
  const guest = (await h.api('GET', `/api/stations/${c.stationId}/slots?date=${day}`)).body.data;
  assert.ok(guest.server_time); assert.ok(!find(guest.slots, mine).my_booking_id, 'guest sees no personal marks');
  // after a booking is cancelled the grid shows it free again (refresh requirement of FR-05)
  const bid = (await h.db.query('SELECT booking_id FROM booking WHERE slot_id = ?', [mine]))[0].booking_id;
  assert.equal((await h.api('POST', `/api/bookings/${bid}/cancel`, { token: me.token })).status, 200);
  const after = (await h.api('GET', `/api/stations/${c.stationId}/slots?date=${day}`, { token: me.token })).body.data.slots;
  assert.equal(find(after, mine).status, 'AVAILABLE'); assert.ok(!find(after, mine).my_booking_id);
  assert.equal((await h.api('GET', `/api/stations/${c.stationId}/slots?date=2026-02-30`)).status, 400);
});

