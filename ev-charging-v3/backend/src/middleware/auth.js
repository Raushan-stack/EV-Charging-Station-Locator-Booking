'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const { AppError } = require('../errors');

/**
 * Contract with Aarya's login (FR-01):
 *   Authorization: Bearer <JWT signed with JWT_SECRET (HS256)>
 *   payload must contain  user_id  (or  sub)  - the users.user_id.
 * The ROLE is never trusted from the token; it is re-read from the database on every request.
 */
async function authenticate(req, _res, next) {
  try {
    let userId;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      let payload;
      try {
        payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ['HS256'] });
      } catch (_) {
        throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token');
      }
      userId = Number(payload.user_id ?? payload.sub);
    } else if (config.allowDevAuth && req.headers['x-user-id']) {
      userId = Number(req.headers['x-user-id']);
    } else {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    if (!Number.isInteger(userId) || userId < 1) throw new AppError(401, 'INVALID_TOKEN', 'Token has no valid user id');

    const rows = await query('SELECT user_id, name, role, is_active FROM users WHERE user_id = ?', [userId]);
    if (!rows.length || !rows[0].is_active) throw new AppError(401, 'UNAUTHENTICATED', 'User not found or deactivated');
    req.user = { id: rows[0].user_id, name: rows[0].name, role: rows[0].role };
    next();
  } catch (e) { next(e); }
}

function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return next(new AppError(403, 'FORBIDDEN', 'Admin access required'));
  }
  next();
}

module.exports = { authenticate, requireAdmin };
