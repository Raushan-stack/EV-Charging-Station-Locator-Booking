'use strict';
const mysql = require('mysql2/promise');
const config = require('./config');

// Values are always passed as placeholders (?) - never concatenated into SQL.
// dateStrings keeps DATETIME as 'YYYY-MM-DD HH:MM:SS' (DB server local time),
// avoiding any JS timezone conversion bugs.
const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  queueLimit: 0,
  dateStrings: true,
  decimalNumbers: true,
  multipleStatements: false,
});

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Runs fn(conn) inside a transaction: COMMIT on success, ROLLBACK on any error.
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

// Calls a stored procedure whose last statement is a SELECT returning one row.
async function callProc(name, params) {
  const placeholders = params.map(() => '?').join(',');
  const [result] = await pool.query(`CALL ${name}(${placeholders})`, params);
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0][0] : result;
}

// Deadlock (1213) / lock wait timeout (1205) are transient: retry a few times.
async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (err) {
      const transient = err && (err.errno === 1213 || err.errno === 1205);
      if (!transient || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 25 * i));
    }
  }
}

module.exports = { pool, query, withTransaction, callProc, withRetry };
