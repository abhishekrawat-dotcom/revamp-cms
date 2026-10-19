// Local static server for the repo — templates load their section files with fetch(), which browsers block on file://.
//   node tools/serve.js [port]      then open http://localhost:8080/templates/preview.html?t=tech500
//
// The /api/*, /e/* and /preview/* routes themselves live in functions/lib/api.js, so the EXACT same code runs
// here (for local dev) and in production (server.js on App Hosting). This file only adds static file serving
// and loading tools/.env.local for local secrets (GEMINI_API_KEY, the Firebase service account —
// functions/lib/firebase.js reads the same variable names either way, see its header comment).
//
// It listens on 127.0.0.1 only and serves only what production serves (isServableFile in
// functions/lib/access.js). It used to listen on every interface and send any file under the repository to
// anyone who asked — including tools/.env.local, with the real keys in it, to the whole office network.
const http = require('http'), fs = require('fs'), path = require('path');
const { handleApi } = require('../functions/lib/api');
const { gate, isServableFile } = require('../functions/lib/access');

const root = path.resolve(__dirname, '..');
const port = +process.argv[2] || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8'
};

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

// Same @timesinternet.in sign-in gate as server.js (functions/lib/access.js); REVAMP_AUTH_DISABLED=1 in
// tools/.env.local turns it off for local work without a network or a company Google account.
const passThrough = (req, res, next) => next();
const guard = process.env.REVAMP_AUTH_DISABLED === '1' ? passThrough : gate;

function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Not found'); }

function serve(req, res) {
  const url = req.url.split('?')[0];
  if (/^\/(api|e|preview)\//.test(url)) return handleApi(req, res);
  if (url === '/robots.txt' || url === '/sitemap.xml') return handleApi(req, res);   // for search engines (lib/site-seo.js)
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }

  // a path that does not decode ("%E0%A4%A") or carries a NUL would throw below, and an exception nobody
  // catches ends this process; both are simply not files
  let rel;
  try { rel = decodeURIComponent(url); } catch (e) { return notFound(res); }
  if (rel.indexOf('\0') !== -1) return notFound(res);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) return notFound(res);
  if (rel === '/favicon.ico') file = path.join(root, 'assets', 'et-b2b-logo.svg');     // as server.js does
  else if (!isServableFile(path.relative(root, file).split(path.sep).join('/'))) return notFound(res);
  fs.readFile(file, (err, buf) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

// One bad request must not end the dev server (see server.js for the full reasoning).
process.on('uncaughtException', err => console.error('uncaughtException (still serving): ' + (err && err.stack || err)));
process.on('unhandledRejection', err => console.error('unhandledRejection (still serving): ' + (err && err.stack || err)));

http.createServer((req, res) => {
  try { guard(req, res, () => { try { serve(req, res); } catch (err) { console.error(err); if (!res.headersSent) { res.writeHead(500); } res.end(); } }); }
  catch (err) { console.error(err); if (!res.headersSent) { res.writeHead(500); } res.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root}\n  http://localhost:${port}/templates/preview.html?t=tech500`));
