'use strict';
// FR-07 Concurrency / double-booking protection  | Test T09
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);

test('T09 two users request the same slot at the same moment: exactly one wins', async () => {
  const c = await h.makeCharger();
  const slot = await h.makeSlot(c.chargerId, 700);
  const a = await h.makeUser(); const b = await h.makeUser();

  const [ra, rb] = await Promise.all([
    h.api('POST', '/api/bookings', { token: a.token, body: { slot_id: slot } }),
    h.api('POST', '/api/bookings', { token: b.token, body: { slot_id: slot } }),
  ]);
  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [201, 409], `got ${JSON.stringify([ra.body, rb.body])}`);
  const loser = ra.status === 409 ? ra : rb;
  assert.equal(loser.body.error.code, 'SLOT_UNAVAILABLE');

  assert.equal((await h.one("SELECT COUNT(*) n FROM booking WHERE slot_id = ? AND status IN ('CONFIRMED','IN_PROGRESS')", [slot])).n, 1);
  assert.equal((await h.one('SELECT COUNT(*) n FROM booking WHERE slot_id = ?', [slot])).n, 1, 'loser left no row behind');
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [slot])).status, 'BOOKED');
});

test('T09b stress: 25 users x same slot -> exactly 1 success, 24 clean rejections, 0 server errors', async () => {
  const c = await h.makeCharger();
  const slot = await h.makeSlot(c.chargerId, 720);
  const users = await Promise.all(Array.from({ length: 25 }, () => h.makeUser()));
  const results = await Promise.all(users.map((u) => h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: slot } })));
  const ok = results.filter((r) => r.status === 201);
  const conflict = results.filter((r) => r.status === 409 && r.body.error.code === 'SLOT_UNAVAILABLE');
  assert.equal(ok.length, 1);
  assert.equal(conflict.length, 24, JSON.stringify(results.filter((r) => ![201, 409].includes(r.status)).map((r) => r.body)));
  assert.equal((await h.one('SELECT COUNT(*) n FROM booking WHERE slot_id = ?', [slot])).n, 1);
});

test('T09c same user, two different overlapping slots at once: only one succeeds (user-row lock)', async () => {
  const c1 = await h.makeCharger(); const c2 = await h.makeCharger();
  const s1 = await h.makeSlot(c1.chargerId, 760, 60);
  const s2 = await h.makeSlot(c2.chargerId, 770, 60);
  const u = await h.makeUser();
  const rs = await Promise.all([s1, s2].map((s) => h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: s } })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await h.one("SELECT COUNT(*) n FROM booking WHERE user_id = ?", [u.id])).n, 1);
});

test('T09d booking racing a cancellation of the same slot never leaves two active bookings', async () => {
  const c = await h.makeCharger();
  const slot = await h.makeSlot(c.chargerId, 800);
  const owner = await h.makeUser();
  const first = await h.api('POST', '/api/bookings', { token: owner.token, body: { slot_id: slot } });
  const bookingId = first.body.data.booking_id;
  const rivals = await Promise.all(Array.from({ length: 8 }, () => h.makeUser()));
  const results = await Promise.all([
    h.api('POST', `/api/bookings/${bookingId}/cancel`, { token: owner.token }),
    ...rivals.map((u) => h.api('POST', '/api/bookings', { token: u.token, body: { slot_id: slot } })),
  ]);
  assert.equal(results[0].status, 200);
  assert.ok(results.every((r) => [200, 201, 409].includes(r.status)), JSON.stringify(results.map((r) => r.status)));
  assert.ok((await h.one("SELECT COUNT(*) n FROM booking WHERE slot_id = ? AND status IN ('CONFIRMED','IN_PROGRESS')", [slot])).n <= 1);
  const active = (await h.one("SELECT COUNT(*) n FROM booking WHERE slot_id = ? AND status = 'CONFIRMED'", [slot])).n;
  assert.equal((await h.one('SELECT status FROM charging_slot WHERE slot_id = ?', [slot])).status, active === 1 ? 'BOOKED' : 'AVAILABLE');
});
