'use strict';
const config = require('./config');
const { createApp } = require('./app');

createApp().listen(config.port, () => {
  console.log(`EV Charging backend (Raushan: FR-08..FR-15) listening on http://localhost:${config.port}`);
  if (config.allowDevAuth) console.warn('WARNING: ALLOW_DEV_AUTH is on - X-User-Id header login is enabled (development only).');
  if (config.enableTestHooks) console.warn('WARNING: ENABLE_TEST_HOOKS is on - simulate_failure is honoured (testing only).');
});
