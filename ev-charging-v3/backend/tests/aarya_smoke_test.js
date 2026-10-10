'use strict';
// Smoke test for Aarya's FR-01..FR-07 against a RUNNING server (npm start) and a seeded database.
//   npm run seed:harry && npm start     (in another terminal)   then:   npm run test:aarya
// Optional: BASE_URL=http://localhost:3000
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

async function call(path, method = 'GET', body, token) {
  const res = await fetch(BASE + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json, data: json.data, code: json.error && json.error.code };
}

(async () => {
  try {
    console.log('FR-01 login / register');
    const harry = await call('/auth/login', 'POST', { login: 'HARRY', password: 'harry@123' });
    check('T03 login with HARRY / harry@123', harry.status === 200 && harry.data && harry.data.token, JSON.stringify(harry.json));
    const mail = await call('/auth/login', 'POST', { login: 'harry@example.com', password: 'harry@123' });
    check('login also works with the email', mail.status === 200);
    const bad = await call('/auth/login', 'POST', { login: 'HARRY', password: 'wrong' });
    check('T04 wrong password -> 401', bad.status === 401 && bad.code === 'INVALID_CREDENTIALS');
    const uniq = 'Tester' + Date.now().toString().slice(-6);
    const reg = await call('/auth/register', 'POST', { name: uniq, email: uniq.toLowerCase() + '@example.com', phone: '9111111111', password: 'Test@1234' });
    check('T01 valid registration -> 201', reg.status === 201 && reg.data.token, JSON.stringify(reg.json));
    const dup = await call('/auth/register', 'POST', { name: uniq, email: 'other' + Date.now() + '@example.com', phone: '9111111111', password: 'Test@1234' });
    check('T02 duplicate name -> 409', dup.status === 409);
    const dupMail = await call('/auth/register', 'POST', { name: uniq + 'x', email: uniq.toLowerCase() + '@example.com', phone: '9111111111', password: 'Test@1234' });
    check('T02 duplicate email -> 409', dupMail.status === 409);
    const weak = await call('/auth/register', 'POST', { name: uniq + 'w', email: 'w' + Date.now() + '@example.com', phone: '9111111111', password: 'abc' });
    check('T18 weak password -> 400', weak.status === 400);
    const noAuth = await call('/bookings', 'POST', { slot_id: 1 });
    check('booking without login -> 401', noAuth.status === 401);
    const tok = harry.data.token;

    console.log('FR-03 / FR-04 search and geolocation');
    const all = await call('/stations');
    check('T05 station list is not empty', all.status === 200 && all.data.length > 0, JSON.stringify(all.json).slice(0, 200));
    const saket = await call('/stations?q=Saket');
    check('T05 search "Saket" returns only matching stations', saket.status === 200 && saket.data.length > 0 && saket.data.every((s) => /saket/i.test(s.name + s.address)));
    const none = await call('/stations?q=zzzznotaplace');
    check('search with no match returns empty list', none.status === 200 && none.data.length === 0);
    const typed = await call('/stations?type=CCS2');
    check('filter by charger type', typed.status === 200 && typed.data.every((s) => s.charger_types.includes('CCS2')));
    const near = await call('/stations?lat=28.6315&lng=77.2167');
    const d = near.data ? near.data.map((s) => s.distance_km) : [];
    check('T06 nearby search gives distances sorted nearest first', near.status === 200 && d.length > 0 && d.every((x, i) => i === 0 || x >= d[i - 1]), JSON.stringify(d));
    const radius = await call('/stations?lat=28.6315&lng=77.2167&radius_km=0.5');
    check('radius filter excludes far stations', radius.status === 200 && radius.data.every((s) => s.distance_km <= 0.5));
    const badLat = await call('/stations?lat=999&lng=77');
    check('invalid latitude -> 400', badLat.status === 400);

    console.log('FR-05 availability grid');
    const sid = all.data[0].station_id;
    const detail = await call('/stations/' + sid);
    check('station details include chargers', detail.status === 200 && Array.isArray(detail.data.chargers));
    const today = await call(`/stations/${sid}/slots`);
    check('slot endpoint returns server_time', today.status === 200 && !!today.data.server_time);
    const tomorrow = new Date(today.data.server_time.slice(0, 10) + 'T00:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tmr = tomorrow.toISOString().slice(0, 10);
    const grid = await call(`/stations/${sid}/slots?date=${tmr}`);
    check('T07 tomorrow has slots for the station', grid.status === 200 && grid.data.slots.length > 0);
    const noStation = await call('/stations/999999');
    check('unknown station -> 404', noStation.status === 404);

    console.log('FR-06 / FR-07 booking and double booking');
    const free = await call(`/availability/slots?date=${tmr}&limit=100`);
    const pool = (free.data || []).filter((s) => s.start_time.slice(0, 10) >= tmr);   // far enough ahead to cancel afterwards
    check('free slots exist for testing', pool.length >= 2, 'run the database install script again to get fresh slots');
    if (pool.length >= 2) {
      const first = pool[0];
      // slot B must NOT overlap slot A in time, otherwise the same user is (correctly) refused with BOOKING_OVERLAP
      const second = pool.find((s) => s.start_time >= first.end_time);
      check('a non-overlapping second slot exists', !!second);
      const slotA = first.slot_id, slotB = (second || pool[1]).slot_id;
      const b1 = await call('/bookings', 'POST', { slot_id: slotA }, tok);
      check('T08 valid booking -> 201', b1.status === 201 && b1.data && b1.data.booking_id, JSON.stringify(b1.json));
      const userB = await call('/auth/login', 'POST', { login: 'userb@evcharge.test', password: 'Password@123' });
      check('second driver (userb) can log in', userB.status === 200, JSON.stringify(userB.json));
      const again = await call('/bookings', 'POST', { slot_id: slotA }, userB.data && userB.data.token);
      check('same slot by another user -> 409', again.status === 409, JSON.stringify(again.json));
      const mine = await call(`/stations/${pool[0].station_id}/slots?date=${pool[0].start_time.slice(0, 10)}`, 'GET', null, tok);
      check('grid marks the slot as my booking', mine.data.slots.some((s) => s.slot_id === slotA && s.my_booking_id));
      const hist = await call('/history/bookings?limit=50', 'GET', null, tok);
      check('T14 booking appears in my history', hist.status === 200 && hist.data.some((b) => b.booking_id === b1.data.booking_id));

      const race = await Promise.all([call('/bookings', 'POST', { slot_id: slotB }, tok), call('/bookings', 'POST', { slot_id: slotB }, userB.data.token)]);
      const wins = race.filter((r) => r.status === 201).length;
      check('T09 race for the same slot: exactly ONE succeeds', wins === 1, race.map((r) => r.status).join(','));
      check('the loser gets 409 SLOT_UNAVAILABLE', race.some((r) => r.status === 409 && r.code === 'SLOT_UNAVAILABLE'), JSON.stringify(race.map((r) => r.json)));

      console.log('cleanup (FR-09 cancel)');
      const c1 = await call(`/bookings/${b1.data.booking_id}/cancel`, 'POST', null, tok);
      check('T10 cancel booking -> 200', c1.status === 200, JSON.stringify(c1.json));
      const c2 = await call(`/bookings/${b1.data.booking_id}/cancel`, 'POST', null, tok);
      check('T11 cancelling again is rejected', c2.status >= 400 && c2.status < 500);
      const winner = race.find((r) => r.status === 201);
      const winTok = race[0].status === 201 ? tok : userB.data.token;
      await call(`/bookings/${winner.data.booking_id}/cancel`, 'POST', null, winTok);
    }
  } catch (e) {
    fail++; console.log('  FAIL  test crashed:', e.message, '- is the server running (npm start) on', BASE, '?');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
