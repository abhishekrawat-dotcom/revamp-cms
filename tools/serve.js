// Local static server for the repo — templates load their section files with fetch(), which browsers block on file://.
//   node tools/serve.js [port]      then open http://localhost:8080/templates/preview.html?t=tech500
//
// The /api/* endpoints themselves live in functions/lib/api.js, so the EXACT same code runs here (for local
// dev) and as the deployed Firebase Function (functions/index.js, behind Hosting's /api/** rewrite — see
// firebase.json). This file only adds what a deployed Function doesn't need: static file serving, and loading
// tools/.env.local for local secrets (GEMINI_API_KEY, Firebase service account — functions/lib/firebase.js
// reads the same two variable names either way, see its header comment).
const http = require('http'), fs = require('fs'), path = require('path');
const { handleApi } = require('../functions/lib/api');

const root = path.resolve(__dirname, '..');
const port = +process.argv[2] || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
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

http.createServer((req, res) => {
  if (req.url.indexOf('/api/') === 0) return handleApi(req, res);

  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found: ' + rel); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(port, () => console.log(`Serving ${root}\n  http://localhost:${port}/templates/preview.html?t=tech500`));
