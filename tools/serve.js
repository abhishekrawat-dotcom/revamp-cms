// The local development server: production's own serving code on this computer, so what QA sees is what users get.
//   node tools/serve.js [port]      (npm run dev)   then open http://localhost:8080/
//
// Everything a request meets is functions/lib/web-server.js, exactly as server.js runs it on App Hosting: the
// /api/*, /e/*, /preview/*, /t/*, /s/*, /img/* routes and the speaker and sponsor pages (functions/lib/api.js),
// which files are served at all (isServableFile in functions/lib/access.js), their caching, compression, ?v=
// stamping and the app pages' headers. This file adds only what is local:
//   - it listens on 127.0.0.1 only (it used to listen on every interface and send any file under the repository
//     to anyone who asked — including tools/.env.local, with the real keys in it, to the whole office network);
//   - it loads tools/.env.local for local secrets (GEMINI_API_KEY, the Firebase service account —
//     functions/lib/firebase.js reads the same variable names either way, see its header comment);
//   - REVAMP_AUTH_DISABLED=1 (in tools/.env.local or the shell) lets the PAGES open without a sign-in, for layout
//     work offline. The API is not opened by it: every /api/ route that is not public checks the caller itself
//     (lib/http.js requireAdmin / requireMember), so a page that reads or changes data still needs a real sign-in.
//     It says which at start-up.
const http = require('http'), fs = require('fs'), path = require('path');
const { handleApi } = require('../functions/lib/api');
const { gate } = require('../functions/lib/access');
const web = require('../functions/lib/web-server');
const { SERVER_REQUEST_TIMEOUT_MS } = require('../functions/lib/http');

const root = path.resolve(__dirname, '..');
const port = +process.argv[2] || 8080;

// A minimal KEY=VALUE loader for tools/.env.local, so `node tools/serve.js` keeps working unchanged whether the
// key is set in the shell or dropped in that (gitignored) file.
function loadEnvFile() {
  var envPath = path.join(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(function (line) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}
loadEnvFile();

// The same sign-in gate as server.js (functions/lib/access.js), unless REVAMP_AUTH_DISABLED=1 opens the pages.
const authDisabled = process.env.REVAMP_AUTH_DISABLED === '1';
const passThrough = (req, res, next) => next();
const guard = authDisabled ? passThrough : gate;

// One bad request must not end the dev server (web-server.js fail() and keepServing(), as in production).
web.keepServing();

const server = http.createServer(web.handler({ root: root, guard: guard, handleApi: handleApi }));
server.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;
server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${root}\n  http://localhost:${port}/`);
  console.log(authDisabled
    ? 'REVAMP_AUTH_DISABLED=1: pages open here without a sign-in, but every API route that is not public still checks the caller — anything that reads or changes event data needs a real sign-in.'
    : 'Sign-in required, as in production (REVAMP_AUTH_DISABLED=1 would open the pages without one, never the API).');
});
