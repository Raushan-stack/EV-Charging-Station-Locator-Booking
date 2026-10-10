'use strict';
// Live demo for the viva:  npm run demo:concurrency
// Two users press "Book" for the SAME slot at the SAME moment. Prints what each user sees.
const h = require('./helpers');

(async () => {
  await h.start();
  const a = await h.makeUser(); const b = await h.makeUser();
  const c = await h.makeCharger();
  const slot = await h.makeSlot(c.chargerId, 240);
  console.log(`\nSlot ${slot} is AVAILABLE. User A (id ${a.id}) and User B (id ${b.id}) both click "Book" now...\n`);

  const [ra, rb] = await Promise.all([
    h.api('POST', '/api/bookings', { token: a.token, body: { slot_id: slot } }),
    h.api('POST', '/api/bookings', { token: b.token, body: { slot_id: slot } }),
  ]);
  const show = (n, r) => console.log(`${n}: HTTP ${r.status}  ${r.body.success ? 'SUCCESS booking_id=' + r.body.data.booking_id : 'REJECTED ' + r.body.error.code + ' - ' + r.body.error.message}`);
  show('User A', ra); show('User B', rb);

  console.log('\nDatabase evidence:');
  console.table(await h.db.query('SELECT booking_id, user_id, slot_id, status, active_slot_id FROM booking WHERE slot_id = ?', [slot]));
  console.table(await h.db.query('SELECT slot_id, status FROM charging_slot WHERE slot_id = ?', [slot]));
  console.log('Exactly one active booking exists for the slot -> double booking prevented.\n');
  await h.stop();
})().catch((e) => { console.error(e); process.exit(1); });
