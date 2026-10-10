'use strict';
require('dotenv').config();

const env = process.env;
if (!env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set it (no secrets are hard-coded).');
}

module.exports = {
  port: Number(env.PORT || 3000),
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'ev_charging',
    connectionLimit: Number(env.DB_POOL_SIZE || 20),
  },
  jwtSecret: env.JWT_SECRET,
  // Dev convenience: lets Postman/curl act as a user with the X-User-Id header.
  // MUST stay false in any real deployment.
  allowDevAuth: env.ALLOW_DEV_AUTH === 'true',
  // Enables the "simulate_failure" flag used to demonstrate rollback (FR-15).
  enableTestHooks: env.ENABLE_TEST_HOOKS === 'true',
  corsOrigin: env.CORS_ORIGIN || '*',
};
