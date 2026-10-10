'use strict';
// FR-01 (Aarya): register / login / profile.
// Issues the JWT that middleware/auth.js verifies: HS256, payload { user_id }.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const v = require('../validators');
const { AppError } = require('../errors');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const sign = (userId) => jwt.sign({ user_id: userId }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '8h' });
const publicUser = (u) => ({ user_id: u.user_id, name: u.name, email: u.email, phone: u.phone, role: u.role });

// POST /api/auth/register { name, email, phone, password }
router.post('/register', asyncHandler(async (req, res) => {
  const b = v.body(req);
  const name = v.string(b.name, 'name', { min: 2, max: 100 });
  const email = v.string(b.email, 'email', { max: 150 }).toLowerCase();
  const phone = v.string(b.phone, 'phone', { min: 7, max: 15 });
  const password = v.string(b.password, 'password', { min: 8, max: 100 });
  if (name.includes('@')) v.fail('name', 'must not contain @ (the name is also used as a login id)');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) v.fail('email', 'is not a valid email address');
  if (!/^[0-9+]{7,15}$/.test(phone)) v.fail('phone', 'must be 7-15 digits');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) v.fail('password', 'needs at least one letter and one number');

  // the name doubles as a login id, so it must be unique (case-insensitive)
  const same = await query('SELECT user_id FROM users WHERE LOWER(name) = LOWER(?)', [name]);
  if (same.length) throw new AppError(409, 'DUPLICATE_ENTRY', 'This name is already taken. Please choose another one');

  const hash = await bcrypt.hash(password, 10);                  // never store plain passwords
  const r = await query(`INSERT INTO users (name, email, phone, password_hash, role) VALUES (?,?,?,?,'USER')`, [name, email, phone, hash]);
  const user = { user_id: r.insertId, name, email, phone, role: 'USER' };
  res.status(201).json({ success: true, data: { token: sign(user.user_id), user } });
}));

// POST /api/auth/login { login, password }   login = email OR name (e.g. HARRY)
router.post('/login', asyncHandler(async (req, res) => {
  const b = v.body(req);
  const login = v.string(b.login ?? b.email, 'login', { max: 150 });
  const password = v.string(b.password, 'password', { max: 100 });
  const rows = login.includes('@')
    ? await query('SELECT * FROM users WHERE email = ?', [login.toLowerCase()])
    : await query('SELECT * FROM users WHERE LOWER(name) = LOWER(?)', [login]);
  // same message for "no such user" and "wrong password"
  const bad = new AppError(401, 'INVALID_CREDENTIALS', 'Invalid login or password');
  if (rows.length !== 1 || !rows[0].is_active) throw bad;
  if (!(await bcrypt.compare(password, rows[0].password_hash))) throw bad;
  res.json({ success: true, data: { token: sign(rows[0].user_id), user: publicUser(rows[0]) } });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const rows = await query('SELECT user_id, name, email, phone, role, created_at FROM users WHERE user_id = ?', [req.user.id]);
  res.json({ success: true, data: rows[0] });
}));

// PUT /api/auth/me { name, phone }
router.put('/me', authenticate, asyncHandler(async (req, res) => {
  const b = v.body(req);
  const name = v.string(b.name, 'name', { min: 2, max: 100 });
  const phone = v.string(b.phone, 'phone', { min: 7, max: 15 });
  if (name.includes('@')) v.fail('name', 'must not contain @ (the name is also used as a login id)');
  if (!/^[0-9+]{7,15}$/.test(phone)) v.fail('phone', 'must be 7-15 digits');
  const same = await query('SELECT user_id FROM users WHERE LOWER(name) = LOWER(?) AND user_id <> ?', [name, req.user.id]);
  if (same.length) throw new AppError(409, 'DUPLICATE_ENTRY', 'This name is already taken');
  await query('UPDATE users SET name = ?, phone = ? WHERE user_id = ?', [name, phone, req.user.id]);
  res.json({ success: true, message: 'Profile updated', data: { name, phone } });
}));

module.exports = router;
