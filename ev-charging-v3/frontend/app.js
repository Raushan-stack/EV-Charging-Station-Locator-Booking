/* VoltSlot front-end (plain JavaScript) - Aarya's part, talks to Raushan's API.
   FR-01 login | FR-03 search | FR-04 geolocation | FR-05 availability | FR-06 booking | FR-07 concurrency demo
   Also: bookings/history, charging session buttons and a small admin page. */
'use strict';

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $modal = document.getElementById('modal');

const TYPE_LABEL = { CCS2: 'DC CCS2', CHAdeMO: 'DC CHAdeMO', Type2: 'AC Type 2', GBT: 'GB/T', AC001: 'AC001' };
const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  coords: null            // { lat, lng } once the browser location is allowed
};

/* ---------- helpers ---------- */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '-' : '\u20B9' + Number(n).toFixed(2));
const fmtDT = (s) => (s ? s.slice(0, 16).replace('T', ' ') : '-');
const hhmm = (s) => s.slice(11, 16);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const chargerName = (type, id) => `${TYPE_LABEL[type] || type} #${id}`;

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// Raushan's API answers { success, data, meta } or { success:false, error:{code,message} }
async function rawApi(path, method = 'GET', body, token = state.token) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = {};
  try { json = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok || json.success === false) {
    const err = new Error((json.error && json.error.message) || 'Request failed');
    err.status = res.status;
    err.code = json.error && json.error.code;
    throw err;
  }
  return json;
}
async function api(path, method, body) {
  try { return (await rawApi(path, method, body)).data; }
  catch (e) { if (e.status === 401 && state.token && e.code !== 'INVALID_CREDENTIALS') logout(true); throw e; }
}

function modal(html) {
  return new Promise((resolve) => {
    $modal.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
    $modal.hidden = false;
    const close = (v) => { $modal.hidden = true; document.removeEventListener('keydown', esc_); resolve(v); };
    const esc_ = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', esc_);
    const read = () => { const i = $modal.querySelector('input'); return i ? i.value : undefined; };
    $modal.querySelector('[data-ok]').onclick = () => { const val = read(); close(val === undefined ? true : val); };
    $modal.querySelector('[data-cancel]').onclick = () => close(false);
    const input = $modal.querySelector('input');
    if (input) { input.focus(); input.onkeydown = (e) => { if (e.key === 'Enter') { const val = read(); close(val); } }; }
  });
}
const confirmBox = (title, text, okText = 'Confirm') =>
  modal(`<h2>${esc(title)}</h2><p>${text}</p><div class="actions"><button class="btn ghost" data-cancel>Back</button><button class="btn" data-ok>${esc(okText)}</button></div>`);

function logout(silent) {
  state.token = null; state.user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  if (!silent) toast('Logged out');
  location.hash = '#/login';
  renderNav();
}
function saveLogin(data) {
  state.token = data.token; state.user = data.user;
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
}

/* ---------- navigation + router ---------- */
function renderNav() {
  const hash = location.hash || '#/';
  const link = (href, text) => `<a href="${href}" class="${hash === href || (href !== '#/' && hash.startsWith(href)) ? 'on' : ''}">${text}</a>`;
  if (!state.user) { $nav.innerHTML = link('#/login', 'Log in'); return; }
  $nav.innerHTML =
    link('#/', 'Find stations') + link('#/bookings', 'My bookings') + link('#/demo', 'Double-booking demo') +
    (state.user.role === 'ADMIN' ? link('#/admin', 'Admin') : '') + link('#/profile', esc(state.user.name)) +
    '<button id="logout">Log out</button>';
  document.getElementById('logout').onclick = () => logout();
}

async function route() {
  renderNav();
  const hash = location.hash || '#/';
  if (!state.user && hash !== '#/login') { location.hash = '#/login'; return; }
  try {
    if (hash === '#/login') return pageLogin();
    if (hash === '#/') return await pageStations();
    if (hash.startsWith('#/station/')) return await pageStation(hash.split('/')[2]);
    if (hash === '#/bookings') return await pageBookings();
    if (hash === '#/demo') return await pageDemo();
    if (hash === '#/profile') return await pageProfile();
    if (hash === '#/admin') return await pageAdmin();
    $app.innerHTML = '<div class="panel"><h2>Page not found</h2><a href="#/">Back to stations</a></div>';
  } catch (e) {
    $app.innerHTML = `<div class="panel"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', route);

/* ---------- FR-01: login / register ---------- */
function pageLogin() {
  if (state.user) { location.hash = '#/'; return; }
  let mode = 'login';
  const draw = () => {
    $app.innerHTML = `
      <div class="panel auth">
        <h1>VoltSlot</h1>
        <p class="muted">Find a charger near you and reserve a time slot.</p>
        <div class="tabs">
          <button data-m="login" class="${mode === 'login' ? 'on' : ''}">Log in</button>
          <button data-m="register" class="${mode === 'register' ? 'on' : ''}">Create account</button>
        </div>
        <form id="f" novalidate>
          ${mode === 'register' ? `<div class="field"><label for="name">Name (also your login id)</label><input id="name" autocomplete="name"></div>
          <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email"></div>
          <div class="field"><label for="phone">Phone (7-15 digits)</label><input id="phone" inputmode="numeric" autocomplete="tel"></div>` :
          `<div class="field"><label for="login">Login id or email</label><input id="login" autocomplete="username"></div>`}
          <div class="field"><label for="password">Password${mode === 'register' ? ' (8+ characters, letters and numbers)' : ''}</label>
            <input id="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
          <button class="btn" type="submit">${mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
      </div>`;
    $app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const v = (id) => (document.getElementById(id) || {}).value || '';
      try {
        const data = (await rawApi(mode === 'login' ? '/auth/login' : '/auth/register', 'POST',
          mode === 'login' ? { login: v('login'), password: v('password') }
            : { name: v('name'), email: v('email'), phone: v('phone'), password: v('password') }, null)).data;
        saveLogin(data);
        toast('Welcome, ' + data.user.name, 'success');
        location.hash = '#/';
      } catch (err) { toast(err.message, 'error'); }
    };
  };
  draw();
}

/* ---------- FR-03 / FR-04: search + geolocation ---------- */
async function pageStations() {
  $app.innerHTML = `
    <h1>Find a charging station</h1>
    <p class="muted">Search by name or area, filter by connector, or use your location to see what is closest.</p>
    <form class="panel row" id="sf">
      <div class="grow"><label for="q">Name or area</label><input id="q" placeholder="e.g. Saket, Noida, Dwarka"></div>
      <div><label for="type">Charger type</label>
        <select id="type"><option value="ALL">Any</option>${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div><label for="radius">Within (km)</label>
        <select id="radius"><option value="">Any distance</option><option>2</option><option>5</option><option>10</option><option>25</option></select></div>
      <div class="check"><input type="checkbox" id="avail"><label for="avail">Only with free slots</label></div>
      <button class="btn" type="submit">Search</button>
      <button class="btn ghost" type="button" id="loc">Use my location</button>
    </form>
    <p id="locmsg" class="small muted"></p>
    <div id="list" class="cards"></div>`;

  const load = async () => {
    const p = new URLSearchParams();
    const q = document.getElementById('q').value.trim();
    if (q) p.set('q', q);
    p.set('type', document.getElementById('type').value);
    if (document.getElementById('avail').checked) p.set('only_available', 'true');
    if (state.coords) {
      p.set('lat', state.coords.lat); p.set('lng', state.coords.lng);
      const r = document.getElementById('radius').value; if (r) p.set('radius_km', r);
    }
    const list = document.getElementById('list');
    try {
      const rows = await api('/stations?' + p.toString());
      list.innerHTML = rows.length ? rows.map(stationCard).join('') : '<div class="panel"><p>No stations match your search.</p></div>';
    } catch (e) { list.innerHTML = ''; toast(e.message, 'error'); }
  };

  document.getElementById('sf').onsubmit = (e) => { e.preventDefault(); load(); };
  document.getElementById('loc').onclick = () => {
    const msg = document.getElementById('locmsg');
    if (!navigator.geolocation) { msg.textContent = 'Your browser does not support location. You can still search by name.'; return; }
    msg.textContent = 'Asking for your location...';
    navigator.geolocation.getCurrentPosition(
      (pos) => { state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; msg.textContent = 'Showing the nearest stations first.'; load(); },
      (err) => {
        msg.textContent = err.code === 1
          ? 'Location permission was denied. You can still search by name or area.'
          : 'Your location is not available right now. You can still search by name or area.';
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };
  await load();
}

function stationCard(s) {
  return `<a class="station" href="#/station/${s.station_id}">
    <div class="spread"><h3>${esc(s.name)}</h3>${s.distance_km != null ? `<span class="badge">${s.distance_km} km</span>` : ''}</div>
    <p class="muted small">${esc(s.address)}</p>
    <div class="meta">${s.charger_types.map((t) => `<span class="badge">${esc(TYPE_LABEL[t] || t)}</span>`).join('')}</div>
    <div class="spread"><span class="muted small">${s.total_chargers} charger${s.total_chargers === 1 ? '' : 's'}</span>
      <span><span class="free">${s.free_slots}</span> <span class="muted small">free slots</span></span></div>
  </a>`;
}

/* ---------- FR-05 / FR-06: station details, availability, booking ---------- */
async function pageStation(id, date) {
  const st = await api('/stations/' + id);
  const av = await api(`/stations/${id}/slots` + (date ? `?date=${date}` : ''));
  const today = av.server_time.slice(0, 10);
  const day = av.date.slice(0, 10);
  const days = [0, 1, 2, 3].map((n) => addDays(today, n));

  const chargerBlock = (c) => {
    const slots = av.slots.filter((s) => s.charger_id === c.charger_id);
    return `<div class="charger">
      <div class="charger-head"><h3>${esc(chargerName(c.charger_type, c.charger_id))}</h3>
        <span class="muted small">${c.power_kw} kW &middot; ${money(c.price_per_kwh)} per kWh</span>
        ${c.status === 'ACTIVE' ? '' : `<span class="badge warn">${esc(c.status.toLowerCase())}</span>`}</div>
      ${slots.length === 0 ? '<p class="muted small">No slots published for this day.</p>' :
        `<div class="strip">${slots.map((s) => {
          let cls = '', note = 'Free - click to book';
          if (s.my_booking_id) { cls = 'mine'; note = 'Your booking'; }
          else if (s.is_past) { cls = 'past'; note = 'Over'; }
          else if (s.status === 'BOOKED') { cls = 'booked'; note = 'Booked'; }
          else if (s.status === 'BLOCKED') { cls = 'blocked'; note = 'Blocked'; }
          else if (c.status !== 'ACTIVE') { cls = 'blocked'; note = 'Charger not in service'; }
          return `<button class="slot ${cls}" data-slot="${s.slot_id}" data-c="${esc(chargerName(c.charger_type, c.charger_id))}"
                    data-t="${hhmm(s.start_time)}-${hhmm(s.end_time)}" data-k="${cls || 'free'}" title="${note}"
                    aria-label="${hhmm(s.start_time)} ${note}">${hhmm(s.start_time)}</button>`;
        }).join('')}</div>`}
    </div>`;
  };

  $app.innerHTML = `
    <p><a href="#/">&larr; All stations</a></p>
    <div class="panel">
      <h1>${esc(st.name)} ${st.status === 'ACTIVE' ? '' : `<span class="badge warn">${esc(st.status.toLowerCase())}</span>`}</h1>
      <p class="muted">${esc(st.address)} &middot; <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${st.latitude}&mlon=${st.longitude}#map=16/${st.latitude}/${st.longitude}">view on map</a></p>
      <div class="tabs" role="tablist">${days.map((d, i) => `<button data-d="${d}" class="${d === day ? 'on' : ''}">${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d} <span class="muted small">${d}</span></button>`).join('')}</div>
      <div class="legend" style="margin-bottom:.75rem">
        <span><i style="border-color:var(--teal);background:#fff"></i>Free</span>
        <span><i style="border-color:var(--amber);background:#f6dfa6"></i>Booked</span>
        <span><i style="border-color:var(--green);background:var(--green)"></i>Your booking</span>
        <span><i style="border-color:#9aa8af;background:#cfd8dc"></i>Blocked</span></div>
      ${st.chargers.length ? st.chargers.map(chargerBlock).join('') : '<p>This station has no chargers yet.</p>'}
    </div>`;

  $app.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => pageStation(id, b.dataset.d)));
  $app.querySelectorAll('.slot').forEach((b) => (b.onclick = async () => {
    if (b.dataset.k !== 'free') { toast(b.title); return; }
    const ok = await confirmBox('Confirm booking', `<b>${esc(st.name)}</b><br>${esc(b.dataset.c)} &middot; ${esc(day)} &middot; ${esc(b.dataset.t)}`, 'Book this slot');
    if (!ok) return;
    try {
      const r = await api('/bookings', 'POST', { slot_id: Number(b.dataset.slot) });
      toast(`Booking #${r.booking_id} confirmed`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    pageStation(id, day);           // always reload: the grid must show the real database state
  }));
}

/* ---------- FR-09 / FR-10 / FR-11: bookings, cancel, session, history ---------- */
async function pageBookings() {
  const rows = await api('/history/bookings?limit=100');
  const badge = (s) => `<span class="badge ${s === 'CONFIRMED' || s === 'IN_PROGRESS' ? 'ok' : s === 'CANCELLED' ? 'bad' : ''}">${s.toLowerCase().replace('_', ' ')}</span>`;
  const item = (b) => {
    let actions = '', detail = '';
    if (b.booking_status === 'CONFIRMED') {
      actions = `<button class="btn sm" data-start="${b.booking_id}">Start charging</button><button class="btn sm ghost" data-cancel="${b.booking_id}">Cancel</button>`;
    } else if (b.booking_status === 'IN_PROGRESS' && b.session_id) {
      actions = `<button class="btn sm" data-end="${b.session_id}">End charging</button>`;
      detail = `<span class="badge warn">charging since ${fmtDT(b.session_start)}</span>`;
    } else if (b.session_status === 'COMPLETED') {
      detail = `<span class="small">${fmtDT(b.session_start)} to ${hhmm(b.session_end)} &middot; <b>${b.energy_kwh} kWh</b> &middot; <b>${money(b.cost)}</b>${b.payment_status ? ' &middot; payment ' + esc(b.payment_status.toLowerCase()) : ''}</span>`;
    }
    return `<div class="booking"><div>
      <h3>${esc(b.station_name)} <span class="muted small">(${esc(chargerName(b.charger_type, b.charger_id))})</span></h3>
      <p class="small">${fmtDT(b.slot_start)} &ndash; ${hhmm(b.slot_end)} &nbsp; ${badge(b.booking_status)} ${detail}</p>
      <p class="small muted">Booking #${b.booking_id}${b.cancelled_at ? ' &middot; cancelled ' + fmtDT(b.cancelled_at) : ''}</p></div>
      <div class="actions">${actions}</div></div>`;
  };
  const active = rows.filter((b) => b.booking_status === 'CONFIRMED' || b.booking_status === 'IN_PROGRESS');
  const past = rows.filter((b) => !active.includes(b));
  $app.innerHTML = `<h1>My bookings</h1>
    <div class="panel"><h2>Active</h2>${active.length ? active.map(item).join('') : '<p class="muted">No active bookings. <a href="#/">Find a station</a></p>'}</div>
    <div class="panel"><h2>History</h2>${past.length ? past.map(item).join('') : '<p class="muted">Nothing here yet.</p>'}</div>`;

  const run = async (fn, okMsg) => { try { const r = await fn(); toast(okMsg || 'Done', 'success'); return r; } catch (e) { toast(e.message, 'error'); } finally { pageBookings(); } };
  $app.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (await confirmBox('Cancel booking', 'The slot will be released for other drivers.', 'Cancel booking'))
      run(() => api(`/bookings/${b.dataset.cancel}/cancel`, 'POST'), 'Booking cancelled, slot released');
  }));
  $app.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () =>
    run(() => api('/sessions/start', 'POST', { booking_id: Number(b.dataset.start) }), 'Charging started')));
  $app.querySelectorAll('[data-end]').forEach((b) => (b.onclick = async () => {
    const kwh = await modal(`<h2>End charging</h2><p>Enter the energy delivered according to the charger meter.</p>
      <label for="kwh">Energy (kWh)</label><input id="kwh" type="number" min="0.1" step="0.1" placeholder="e.g. 12.5">
      <div class="actions"><button class="btn ghost" data-cancel>Back</button><button class="btn" data-ok>End and pay</button></div>`);
    if (kwh === false) return;
    if (!kwh || Number(kwh) <= 0) { toast('Please enter the energy in kWh', 'error'); return; }
    run(() => api(`/sessions/${b.dataset.end}/end`, 'POST', { energy_kwh: Number(kwh) }), 'Charging completed');
  }));
}

/* ---------- FR-07: double-booking demonstration ---------- */
async function pageDemo() {
  const slots = await api('/availability/slots?limit=40');
  $app.innerHTML = `<h1>Double-booking demonstration</h1>
    <p class="muted">You and a second driver request <b>the same slot at the same moment</b>. The database lets exactly one booking through.</p>
    <div class="panel">
      <div class="row">
        <div class="grow"><label for="ds">Choose a free slot</label>
          <select id="ds">${slots.map((s) => `<option value="${s.slot_id}">${esc(s.station_name)} - ${esc(chargerName(s.charger_type, s.charger_id))} - ${fmtDT(s.start_time)}</option>`).join('')}</select></div>
      </div>
      <div class="row" style="margin-top:.75rem">
        <div class="grow"><label for="u2">Second driver (login id)</label><input id="u2" value="userb@evcharge.test"></div>
        <div class="grow"><label for="p2">Second driver password</label><input id="p2" type="password" value="Password@123"></div>
        <button class="btn" id="go" ${slots.length ? '' : 'disabled'}>Run the race</button>
      </div>
      <p class="small muted">The second driver is one of the sample users created with the database. Pick a slot that neither driver has already booked at that time: a driver who already holds an overlapping booking is refused with <code>BOOKING_OVERLAP</code> instead of <code>SLOT_UNAVAILABLE</code>.</p>
    </div>
    <div id="out"></div>
    <div class="panel"><h2>What is happening</h2>
      <p class="small">Both requests call the booking procedure <code>sp_book_slot</code>, which runs as one transaction and locks the slot row. The first one to get the lock books the slot and commits. The second one finds the slot already booked and is rolled back with <code>SLOT_UNAVAILABLE</code>. If the code ever had a bug, the <code>UNIQUE(active_slot_id)</code> constraint would still stop a duplicate.</p>
      <p class="small muted">To repeat the demo with the same slot, cancel the winning booking (it belongs to you or to the second driver).</p></div>`;
  document.getElementById('go').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const slotId = Number(document.getElementById('ds').value);
      const second = (await rawApi('/auth/login', 'POST', { login: document.getElementById('u2').value, password: document.getElementById('p2').value }, null)).data;
      if (second.user.user_id === state.user.user_id) throw new Error('Choose a second driver who is not you');
      const attempt = async (token, who) => {
        const t0 = performance.now();
        try { const r = await rawApi('/bookings', 'POST', { slot_id: slotId }, token); return { who, ok: true, message: 'Booking confirmed (#' + r.data.booking_id + ')', ms: Math.round(performance.now() - t0) }; }
        catch (err) { return { who, ok: false, message: err.message, code: err.code, ms: Math.round(performance.now() - t0) }; }
      };
      // both requests are fired at the same moment
      const results = await Promise.all([attempt(state.token, state.user.name), attempt(second.token, second.user.name)]);
      const wins = results.filter((r) => r.ok).length;
      document.getElementById('out').innerHTML = `<div class="race">${results.map((x) => `
        <div class="result ${x.ok ? 'win' : 'lose'}"><b class="big">${x.ok ? 'Booked' : 'Rejected'}</b>
          <p><b>${esc(x.who)}</b></p><p class="small">${esc(x.message)}${x.code ? ' (' + esc(x.code) + ')' : ''}</p>
          <p class="small muted">answered after ${x.ms} ms</p></div>`).join('')}</div>
        <div class="panel" style="margin-top:1rem"><b>Bookings that succeeded for this slot: ${wins} of 2</b></div>`;
    } catch (err) { toast(err.message, 'error'); }
    e.target.disabled = false;
  };
}

/* ---------- profile ---------- */
async function pageProfile() {
  const me = await api('/auth/me');
  $app.innerHTML = `<h1>My profile</h1><form class="panel auth" id="pf" style="margin:0" novalidate>
    <div class="field"><label>Email</label><input value="${esc(me.email)}" disabled></div>
    <div class="field"><label for="n">Name (login id)</label><input id="n" value="${esc(me.name)}"></div>
    <div class="field"><label for="p">Phone</label><input id="p" value="${esc(me.phone)}"></div>
    <button class="btn">Save</button></form>`;
  document.getElementById('pf').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/me', 'PUT', { name: document.getElementById('n').value, phone: document.getElementById('p').value });
      state.user.name = r.name; localStorage.setItem('user', JSON.stringify(state.user));
      renderNav(); toast('Profile updated', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ---------- admin page (uses Raushan's /api/admin/* endpoints) ---------- */
let adminTab = 'overview';
async function pageAdmin() {
  if (state.user.role !== 'ADMIN') { $app.innerHTML = '<div class="panel">Admin access only. Log in as admin@evcharge.test.</div>'; return; }
  const tabs = [['overview', 'Overview'], ['stations', 'Stations & chargers'], ['bookings', 'Bookings'], ['sessions', 'Sessions'], ['slots', 'Slots']];
  $app.innerHTML = `<h1>Admin dashboard</h1><div class="tabs">${tabs.map(([k, v]) => `<button data-t="${k}" class="${adminTab === k ? 'on' : ''}">${v}</button>`).join('')}</div><div id="tab"></div>`;
  $app.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { adminTab = b.dataset.t; pageAdmin(); }));
  const box = document.getElementById('tab');
  const table = (cols, rows) => `<div class="tablewrap"><table><thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(typeof c[1] === 'function' ? c[1](r) : r[c[1]])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="muted">No records</td></tr>`}</tbody></table></div>`;
  try {
    if (adminTab === 'overview') {
      const d = await api('/admin/dashboard');
      const stat = (l, n) => `<div class="stat"><div class="muted small">${l}</div><div class="n">${n}</div></div>`;
      box.innerHTML = `<div class="stats">${stat('Stations', d.stations.total) + stat('Chargers', d.chargers.total) +
        stat('Free upcoming slots', d.upcoming_slots.AVAILABLE || 0) + stat('Booked upcoming slots', d.upcoming_slots.BOOKED || 0) +
        stat('Live sessions', d.sessions.active || 0) + stat('Revenue', money(d.sessions.revenue))}</div>
        <div class="panel"><h2>Utilisation by station (database view)</h2>${table([['Station', 'station_name'], ['Bookings', 'total_bookings'], ['Cancelled', 'cancelled_bookings'],
          ['Completed', 'completed_bookings'], ['Energy kWh', 'total_energy_kwh'], ['Revenue', (r) => money(r.total_revenue)]], d.utilization)}</div>`;
    } else if (adminTab === 'bookings') {
      const rows = await api('/admin/bookings?limit=100');
      box.innerHTML = `<div class="panel">${table([['#', 'booking_id'], ['User', 'user_name'], ['Station', 'station_name'], ['Slot', (r) => fmtDT(r.slot_start)], ['Status', 'booking_status'], ['Session', (r) => r.session_status || '-']], rows)}</div>`;
    } else if (adminTab === 'sessions') {
      const rows = await api('/admin/sessions?limit=100');
      box.innerHTML = `<div class="panel">${table([['#', 'session_id'], ['User', 'user_name'], ['Station', 'station_name'], ['Start', (r) => fmtDT(r.start_time)], ['Minutes', 'duration_minutes'], ['kWh', 'energy_kwh'], ['Cost', (r) => money(r.cost)], ['Status', 'session_status']], rows)}</div>`;
    } else if (adminTab === 'stations') {
      const [stations, chargers] = await Promise.all([api('/admin/stations'), api('/admin/chargers')]);
      const opt = (cur) => ['ACTIVE', 'INACTIVE', 'MAINTENANCE'].map((x) => `<option ${x === cur ? 'selected' : ''}>${x}</option>`).join('');
      box.innerHTML = `<div class="panel"><h2>Stations</h2>${table([['#', 'station_id'], ['Name', 'name'], ['Address', 'address'], ['Lat', 'latitude'], ['Lng', 'longitude'], ['Status', 'status']], stations)}
        <h3 style="margin-top:1rem">Add or edit a station</h3>
        <form class="row" id="sform"><input type="hidden" name="id">
          <div class="grow"><label>Name</label><input name="name" required></div>
          <div class="grow"><label>Address</label><input name="address" required></div>
          <div><label>Latitude</label><input name="latitude" type="number" step="any" style="width:110px" required></div>
          <div><label>Longitude</label><input name="longitude" type="number" step="any" style="width:110px" required></div>
          <div><label>Status</label><select name="status">${opt('ACTIVE')}</select></div>
          <button class="btn">Save station</button></form>
        <p class="small muted">To edit a station, type its # here: <input id="editid" type="number" min="1" style="width:80px"> <button class="btn sm ghost" id="loadst">Load into form</button></p></div>
        <div class="panel"><h2>Chargers</h2>${table([['#', 'charger_id'], ['Station #', 'station_id'], ['Type', 'charger_type'], ['kW', 'power_kw'], ['Price/kWh', (r) => money(r.price_per_kwh)], ['Status', 'status']], chargers)}
        <h3 style="margin-top:1rem">Add a charger, or change a charger (fill its # to update)</h3>
        <form class="row" id="cform">
          <div><label>Charger # (blank = new)</label><input name="cid" type="number" min="1" style="width:110px"></div>
          <div><label>Station #</label><input name="sid" type="number" min="1" style="width:90px"></div>
          <div><label>Type</label><select name="charger_type">${Object.keys(TYPE_LABEL).map((k) => `<option>${k}</option>`).join('')}</select></div>
          <div><label>Power kW</label><input name="power_kw" type="number" step="any" min="1" style="width:90px" required></div>
          <div><label>Price / kWh</label><input name="price_per_kwh" type="number" step="any" min="0" style="width:90px" required></div>
          <div><label>Status</label><select name="status">${opt('ACTIVE')}</select></div>
          <button class="btn">Save charger</button></form></div>`;
      document.getElementById('loadst').onclick = () => {
        const st = stations.find((x) => x.station_id === Number(document.getElementById('editid').value));
        if (!st) { toast('No station with that number', 'error'); return; }
        const f = document.getElementById('sform');
        ['name', 'address', 'latitude', 'longitude', 'status'].forEach((k) => { f.elements[k].value = st[k]; });
        f.elements.id.value = st.station_id;
      };
      document.getElementById('sform').onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const body = { name: f.name, address: f.address, latitude: Number(f.latitude), longitude: Number(f.longitude), status: f.status };
        try {
          if (f.id) await api('/admin/stations/' + f.id, 'PUT', body); else await api('/admin/stations', 'POST', body);
          toast(f.id ? 'Station updated' : 'Station created', 'success'); pageAdmin();
        } catch (err) { toast(err.message, 'error'); }
      };
      document.getElementById('cform').onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const body = { charger_type: f.charger_type, power_kw: Number(f.power_kw), price_per_kwh: Number(f.price_per_kwh), status: f.status };
        try {
          if (f.cid) await api('/admin/chargers/' + f.cid, 'PUT', body);
          else { if (!f.sid) throw new Error('Enter the station # for a new charger'); await api(`/admin/stations/${f.sid}/chargers`, 'POST', body); }
          toast(f.cid ? 'Charger updated' : 'Charger created', 'success'); pageAdmin();
        } catch (err) { toast(err.message, 'error'); }
      };
    } else {
      const chargers = await api('/admin/chargers');
      box.innerHTML = `<div class="panel"><h2>Generate slots for one charger</h2>
        <p class="small muted">Tip for the charging-session demo: generate slots for <b>today</b> including the current hour.</p>
        <form class="row" id="gen">
        <div class="grow"><label>Charger</label><select name="cid">${chargers.map((c) => `<option value="${c.charger_id}">Station ${c.station_id} - ${esc(chargerName(c.charger_type, c.charger_id))}</option>`).join('')}</select></div>
        <div><label>Date</label><input type="date" name="date" required></div>
        <div><label>From hour</label><input type="number" name="start_hour" min="0" max="23" value="0" style="width:90px"></div>
        <div><label>To hour</label><input type="number" name="end_hour" min="1" max="24" value="24" style="width:90px"></div>
        <button class="btn">Generate</button></form></div>`;
      document.getElementById('gen').onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try {
          const r = await api(`/admin/chargers/${f.cid}/slots/generate`, 'POST',
            { date: f.date, start_hour: Number(f.start_hour), end_hour: Number(f.end_hour), slot_minutes: 60 });
          toast(`${r.slots_created} slot(s) created`, 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
      box.innerHTML += `<div class="panel"><h2>Block / unblock slots</h2>
        <form class="row" id="lst"><div class="grow"><label>Charger</label><select name="cid">${chargers.map((c) => `<option value="${c.charger_id}">Station ${c.station_id} - ${esc(chargerName(c.charger_type, c.charger_id))}</option>`).join('')}</select></div>
        <div><label>Date</label><input type="date" name="date" required></div><button class="btn">Show slots</button></form>
        <div id="slotlist" class="strip" style="margin-top:.75rem"></div>
        <p class="small muted">A booked slot cannot be blocked: cancel the booking first (Bookings tab). Blocked slots cannot be booked.</p></div>`;
      document.getElementById('lst').onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const draw = async () => {
          try {
            const slots = await api(`/admin/chargers/${f.cid}/slots?date=${f.date}`);
            const el = document.getElementById('slotlist');
            el.innerHTML = slots.length ? slots.map((x) => `<button class="slot ${x.status === 'BOOKED' ? 'booked' : x.status === 'BLOCKED' ? 'blocked' : ''}" data-id="${x.slot_id}" data-st="${x.status}" title="${x.status}">${hhmm(x.start_time)}<br><small>${x.status.toLowerCase()}</small></button>`).join('') : '<span class="muted small">No slots that day.</span>';
            el.querySelectorAll('[data-id]').forEach((b) => (b.onclick = async () => {
              if (b.dataset.st === 'BOOKED') { toast('This slot is booked. Cancel the booking first.', 'error'); return; }
              try { await api(`/admin/slots/${b.dataset.id}/status`, 'PATCH', { status: b.dataset.st === 'BLOCKED' ? 'AVAILABLE' : 'BLOCKED' }); toast('Slot updated', 'success'); draw(); }
              catch (err) { toast(err.message, 'error'); }
            }));
          } catch (err) { toast(err.message, 'error'); }
        };
        draw();
      };
    }
  } catch (e) { box.innerHTML = `<div class="panel">${esc(e.message)}</div>`; }
}

route();
