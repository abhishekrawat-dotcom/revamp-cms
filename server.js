// Production server for Firebase App Hosting (backend "revamp-cms", built from GitHub on every push to main).
// App Hosting runs `npm start` and sends traffic to process.env.PORT. What it answers, and how, is
// functions/lib/web-server.js — the same code the local dev server (tools/serve.js) runs: the static pages, and
// /api/*, /e/* (published event sites), /preview/*, /t/* (a mailer's open pixel and click links), /s/* (a
// shareable preview link), /img/* (a picture of the storage bucket, from our own address so the hosting's CDN
// keeps it), the speaker and sponsor pages and the search engines' files handed to functions/lib/api.js. Env vars
// come from apphosting.yaml (FIREBASE_STORAGE_BUCKET, GEMINI_API_KEY, MAILER_TRACK_BASE, …); credentials are
// App Hosting's own service identity.
// Local: `npm install`, then `npm start` → http://localhost:8080 (tools/serve.js stays the dev server).
const http = require('http'), path = require('path');
const { handleApi } = require('./functions/lib/api');
// gate: the sign-in (lib/access-control.js's access list) for pages and /api/*
const { gate } = require('./functions/lib/access');
const web = require('./functions/lib/web-server');
// how long one request may run: the platform's limit (App Hosting's Cloud Run, 300 s) and Node's own, above it (BE-061)
const { SERVER_REQUEST_TIMEOUT_MS } = require('./functions/lib/http');

const port = +process.env.PORT || 8080;

/* One request must never be able to take the server down (web-server.js fail() and keepServing()). */
web.keepServing();

/* Cloud Run sends SIGTERM and allows 10 s before it stops the instance: mailer open and click counts still
   held in memory (lib/promo-track.js) are written first. Only when that module was loaded at all. */
process.on('SIGTERM', function () {
  var p = path.join(__dirname, 'functions', 'lib', 'promo-track.js'), m = require.cache[p];
  var flush = m && m.exports && typeof m.exports.flushAll === 'function' ? m.exports.flushAll(8000) : Promise.resolve();
  flush.then(function () { process.exit(0); }, function () { process.exit(0); });
});

const server = http.createServer(web.handler({ root: __dirname, guard: gate, handleApi: handleApi }));
/* Node's own limit for receiving a request (300 s by default) is set above the platform's, so a slow upload is
   ended by the platform with its 504, never by Node first with a 408 nobody expects */
server.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;
server.listen(port, function(){ console.log('Revamp listening on port ' + port); });
