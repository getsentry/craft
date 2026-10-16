/* global require */
// Fail telemetry DNS locally: never send fixture events to Sentry.
const https = require('node:https');
const original = https.request;
https.request = function (options, ...args) {
  if (options?.hostname !== 'o1.ingest.us.sentry.io') {
    throw new Error('Unexpected network request in offline CLI fixture');
  }
  return original.call(
    this,
    {
      ...options,
      lookup(_hostname, _options, callback) {
        callback(
          Object.assign(new Error('Offline telemetry fixture'), {
            code: 'ENOTFOUND',
          }),
        );
      },
    },
    ...args,
  );
};
