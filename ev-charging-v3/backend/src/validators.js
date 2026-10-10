'use strict';
const { AppError } = require('./errors');

const MAX_INT = 2147483647;

function fail(field, msg) {
  throw new AppError(400, 'VALIDATION_ERROR', `${field}: ${msg}`, [{ field, message: msg }]);
}

function id(value, field) {
  const s = String(value);
  if (!/^[0-9]+$/.test(s)) fail(field, 'must be a positive integer');
  const n = Number(s);
  if (n < 1 || n > MAX_INT) fail(field, 'must be a positive integer');
  return n;
}

function optionalId(value, field) {
  return value === undefined || value === null || value === '' ? undefined : id(value, field);
}

function number(value, field, { min = -Infinity, max = Infinity, exclusiveMin = false } = {}) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') fail(field, 'is required');
  const n = Number(value);
  if (!Number.isFinite(n)) fail(field, 'must be a number');
  if (exclusiveMin ? n <= min : n < min) fail(field, `must be ${exclusiveMin ? '>' : '>='} ${min}`);
  if (n > max) fail(field, `must be <= ${max}`);
  return n;
}

function integer(value, field, opts = {}) {
  const n = number(value, field, opts);
  if (!Number.isInteger(n)) fail(field, 'must be a whole number');
  return n;
}

function string(value, field, { min = 1, max = 255 } = {}) {
  if (typeof value !== 'string') fail(field, 'must be a string');
  const s = value.trim();
  if (s.length < min) fail(field, `must be at least ${min} character(s)`);
  if (s.length > max) fail(field, `must be at most ${max} characters`);
  return s;
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) fail(field, `must be one of: ${allowed.join(', ')}`);
  return value;
}

// Accepts 'YYYY-MM-DD HH:MM[:SS]' or 'YYYY-MM-DDTHH:MM[:SS]' (no timezone; DB server local time).
function datetime(value, field) {
  if (typeof value !== 'string') fail(field, 'must be a string like "2026-10-10 14:00:00"');
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) fail(field, 'must look like "YYYY-MM-DD HH:MM[:SS]"');
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    fail(field, 'is not a valid date/time');
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
}

function date(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(field, 'must look like "YYYY-MM-DD"');
  return datetime(`${value} 00:00:00`, field).slice(0, 10);
}

function pagination(query) {
  const limit = query.limit === undefined ? 20 : integer(query.limit, 'limit', { min: 1, max: 100 });
  const offset = query.offset === undefined ? 0 : integer(query.offset, 'offset', { min: 0, max: 1000000 });
  return { limit, offset };
}

function body(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }
  return req.body;
}

module.exports = { fail, id, optionalId, number, integer, string, oneOf, datetime, date, pagination, body };
