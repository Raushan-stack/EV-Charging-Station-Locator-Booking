'use strict';
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { query } = require('./db');
const { notFound, errorHandler, asyncHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', asyncHandler(async (_req, res) => {
    await query('SELECT 1');
    res.json({ success: true, status: 'ok' });
  }));

  app.use('/api/auth', require('./routes/auth'));                 // FR-01 (Aarya)
  app.use('/api/stations', require('./routes/stations'));         // FR-03/04/05 (Aarya)
  app.use('/api/availability', require('./routes/availability'));
  app.use('/api/bookings', require('./routes/bookings'));
  app.use('/api/sessions', require('./routes/sessions'));
  app.use('/api/history', require('./routes/history'));
  app.use('/api/admin', require('./routes/admin'));

  // Aarya's web app (frontend/) is served by the same server: http://localhost:3000
  app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
