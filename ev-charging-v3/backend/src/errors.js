'use strict';

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Custom MySQL error numbers raised by SIGNAL in database/02_procedures.sql
const PROC_ERRORS = {
  50001: [404, 'USER_NOT_FOUND'],
  50002: [404, 'SLOT_NOT_FOUND'],
  50003: [409, 'SLOT_UNAVAILABLE'],
  50004: [409, 'SLOT_EXPIRED'],
  50005: [404, 'BOOKING_NOT_FOUND'],
  50006: [409, 'INVALID_BOOKING_STATE'],
  50008: [409, 'CANCEL_TOO_LATE'],
  50009: [409, 'SESSION_TOO_EARLY'],
  50010: [404, 'SESSION_NOT_FOUND'],
  50011: [400, 'INVALID_ENERGY'],
  50012: [409, 'SESSION_ALREADY_STARTED'],
  50013: [409, 'BOOKING_OVERLAP'],
  50014: [400, 'INVALID_INPUT'],
  50015: [403, 'NOT_OWNER'],
  50016: [409, 'CHARGER_UNAVAILABLE'],
  50017: [409, 'SESSION_NOT_ACTIVE'],
  50099: [500, 'SIMULATED_FAILURE'],
};

// Translate any thrown error into { status, code, message }.
function toHttpError(err) {
  if (err instanceof AppError) return err;
  const no = err && err.errno;

  if (PROC_ERRORS[no]) {
    const [status, code] = PROC_ERRORS[no];
    return new AppError(status, code, err.sqlMessage || err.message);
  }
  if (no === 1062) {
    const m = String(err.sqlMessage || '');
    if (m.includes('uq_active_slot')) {
      return new AppError(409, 'SLOT_UNAVAILABLE', 'Slot is not available (already booked)');
    }
    if (m.includes('uq_users_email')) return new AppError(409, 'DUPLICATE_ENTRY', 'Email already registered');
    if (m.includes('uq_users_name')) return new AppError(409, 'DUPLICATE_ENTRY', 'This name is already taken. Please choose another one');
    return new AppError(409, 'DUPLICATE_ENTRY', 'A record with the same unique value already exists');
  }
  if (no === 1452) return new AppError(400, 'INVALID_REFERENCE', 'Referenced record does not exist');
  if (no === 1451) return new AppError(409, 'IN_USE', 'Record is in use by other records and cannot be deleted');
  if (no === 3819 || no === 4025 || no === 1264 || no === 1366 || no === 1292) {
    return new AppError(400, 'CONSTRAINT_VIOLATION', 'A value violates a database constraint or is out of range');
  }
  if (no === 1213 || no === 1205) {
    return new AppError(503, 'DB_BUSY', 'The database is busy, please retry');
  }
  if (err && err.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  return null;
}

module.exports = { AppError, toHttpError };
