'use strict';
const { toHttpError } = require('../errors');

function notFound(req, res) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const mapped = toHttpError(err);
  if (mapped) {
    return res.status(mapped.status).json({
      success: false,
      error: { code: mapped.code, message: mapped.message, ...(mapped.details ? { details: mapped.details } : {}) },
    });
  }
  // Unknown / unexpected failure: log details server-side, return a generic message.
  console.error('[unhandled]', err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. No data was changed.' } });
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { notFound, errorHandler, asyncHandler };
