// Deployed Cloud Function behind Firebase Hosting's /api/** rewrite (see firebase.json). All the actual
// endpoint logic lives in lib/api.js, shared verbatim with the local dev server (tools/serve.js) — this file
// only adds what's specific to running on Firebase: binding the GEMINI_API_KEY secret, and the timeout/memory
// generous enough for a Gemini call plus (for /api/ingest-source) an outbound page fetch in the same request.
const { onRequest } = require('firebase-functions/v2/https');
const { handleApi } = require('./lib/api');

exports.api = onRequest(
  { secrets: ['GEMINI_API_KEY'], timeoutSeconds: 120, memory: '512MiB' },
  handleApi
);
