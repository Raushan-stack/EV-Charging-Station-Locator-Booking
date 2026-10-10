'use strict';
// Test environment: set BEFORE the app is loaded.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-for-production';
process.env.ENABLE_TEST_HOOKS = 'true';
process.env.ALLOW_DEV_AUTH = 'false';
process.env.DB_NAME = process.env.DB_NAME || 'ev_charging_test';
process.env.DB_POOL_SIZE = '30';

const jwt = require('jsonwebtoken');
const http = require('http');
const { createApp } = require('../src/app');
const db = require('../src/db');

let server; let base;

async function start() {
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
async function stop() {
  await new Promise((r) => server.close(r));
  await db.pool.end();
}

async function api(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined) });
  let json = null;
  try { json = await res.json(); } catch (_) { /* no body */ }
  return { status: res.status, body: json };
}

const tokenFor = (userId) => jwt.sign({ user_id: userId }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeUser(role = 'USER') {
  const r = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role) VALUES (?,?,?,?,?)',
    [`Test ${role} ${uniq()}`, `t_${uniq()}@test.local`, '9999999999', 'x'.repeat(60), role]);
  return { id: r.insertId, token: tokenFor(r.insertId) };
}

async function makeCharger({ power = 50, price = 10, chargerStatus = 'ACTIVE', stationStatus = 'ACTIVE' } = {}) {
  const s = await db.query('INSERT INTO charging_station (name, address, latitude, longitude, status) VALUES (?,?,?,?,?)',
    [`Test Station ${uniq()}`, 'Test Road', 28.6, 77.2, stationStatus]);
  const c = await db.query('INSERT INTO charger (station_id, charger_type, power_kw, price_per_kwh, status) VALUES (?,?,?,?,?)',
    [s.insertId, 'CCS2', power, price, chargerStatus]);
  return { stationId: s.insertId, chargerId: c.insertId };
}

// minutes are relative to the DATABASE clock (avoids JS/DB timezone mismatch)
async function makeSlot(chargerId, startOffsetMin, durationMin = 60, status = 'AVAILABLE') {
  const r = await db.query(
    `INSERT INTO charging_slot (charger_id, start_time, end_time, status)
     VALUES (?, NOW() + INTERVAL ? MINUTE, NOW() + INTERVAL ? MINUTE, ?)`,
    [chargerId, startOffsetMin, startOffsetMin + durationMin, status]);
  return r.insertId;
}

const one = async (sql, params) => (await db.query(sql, params))[0];

module.exports = { start, stop, api, tokenFor, makeUser, makeCharger, makeSlot, one, db, uniq };
