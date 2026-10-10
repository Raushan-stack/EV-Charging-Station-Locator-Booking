'use strict';
// Creates (or resets) the login  HARRY / harry@123   ->  npm run seed:harry
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

(async () => {
  try {
    const hash = await bcrypt.hash('harry@123', 10);
    await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role) VALUES ('Harry', 'harry@example.com', '9000000010', ?, 'USER')
       ON DUPLICATE KEY UPDATE name = 'Harry', password_hash = VALUES(password_hash), is_active = 1`, [hash]);
    console.log('Login ready ->  user: HARRY   password: harry@123   (or email harry@example.com)');
  } catch (e) {
    console.error('Could not create Harry:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
