// Deployed Cloud Function behind Firebase Hosting's /api/** rewrite (see firebase.json). All the actual
// endpoint logic lives in lib/api.js, shared verbatim with the local dev server (tools/serve.js) — this file
// only adds what's specific to running on Firebase: binding the GEMINI_API_KEY secret, and the timeout/memory
// generous enough for a Gemini call plus (for /api/ingest-source) an outbound page fetch in the same request.
const { onRequest } = require('firebase-functions/v2/https');
const { handleApi } = require('./lib/api');

// timeoutSeconds: 240 — the AI-designed "Generate from a brief" pipeline's per-section HTML/CSS
// generation call (functions/lib/api.js's callGeminiJson, passed a 100000ms timeoutMs) can legitimately
// run close to 100s writing bespoke markup/CSS for 6-8 sections in one response; 120s left too little
// margin for normal network/Firestore overhead on top of that. Every other endpoint still returns in a
// fraction of this — it's a ceiling, not a forced wait.
exports.api = onRequest(
  { secrets: ['GEMINI_API_KEY'], timeoutSeconds: 240, memory: '512MiB' },
  handleApi
);
