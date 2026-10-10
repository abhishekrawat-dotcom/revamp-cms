// Production server for Firebase App Hosting (backend "revamp-cms", built from GitHub on every push to main).
// App Hosting runs `npm start` and sends traffic to process.env.PORT. It serves the static pages and hands
// /api/* to functions/lib/api.js — the same handler the Cloud Function (functions/index.js) and the local dev
// server (tools/serve.js) use, so the endpoints behave identically everywhere. Env vars come from apphosting.yaml
// (FIREBASE_STORAGE_BUCKET, GEMINI_API_KEY); credentials are App Hosting's own service identity.
// Local: `npm install`, then `npm start` → http://localhost:8080 (tools/serve.js stays the dev server).
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { handleApi } = require('./functions/lib/api');
const { gate } = require('./functions/lib/access');   // @timesinternet.in Google sign-in for pages and /api/*

const root = __dirname;
const port = +process.env.PORT || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8'
};
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;

/* never served: the server and its config, Firebase config and rules, the Cloud Function source, tooling,
   internal docs (the same set firebase.json's hosting.ignore keeps off classic Hosting), and dotfiles */
const PRIVATE_TOP = new Set(['server.js', 'package.json', 'package-lock.json', 'firebase.json', 'firestore.rules',
  'firestore.indexes.json', 'storage.rules', 'functions', 'tools', 'node_modules', 'memory.md', 'PRD.md', 'Design.md',
  'architecture.md']);
function isPrivate(rel){
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.some(function(p){ return p.startsWith('.'); })) return true;
  if (PRIVATE_TOP.has(parts[0]) || /^apphosting(\..+)?\.yaml$/.test(parts[0])) return true;
  if (parts.indexOf('node_modules') >= 0) return true;
  return /\.docx$/i.test(rel);
}

function cacheFor(ext){
  if (ext === '.html') return 'private, no-cache';                 // signed-in only (gate), so never in a shared cache
  if (ext === '.js' || ext === '.css' || ext === '.json') return 'public, max-age=300';   // file names aren't hashed
  return 'public, max-age=86400';
}

function send(req, res, status, headers, body){
  const type = headers['Content-Type'] || '';
  if (body.length > 1024 && COMPRESSIBLE.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')){
    body = zlib.gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Vary'] = 'Accept-Encoding';
  headers['Content-Length'] = body.length;
  headers['X-Content-Type-Options'] = 'nosniff';
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function notFound(req, res){
  send(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }, Buffer.from('Not found'));
}

/* One request must never be able to take the server down. In a plain Node http server an exception nobody
   catches ends the process, and on App Hosting that drops every request in flight on the instance — another
   user's 100-second AI generation, a publish upload — then cold-starts. Three signed-out requests used to do
   exactly that (a malformed __session cookie, a %00 in a static path, POST /api/register with the body
   `null`); each is fixed where it threw, and these two layers make sure the next one nobody has thought of
   costs a single request rather than the service:
     - fail(): a synchronous throw while gating or serving answers 500 for that request;
     - the process-level handlers: a throw inside a later stream or promise callback is logged and the
       server keeps serving (that one request gets no reply and times out — the lesser harm). */
function fail(req, res, err){
  console.error('request failed: ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err));
  if (res.headersSent){ try { res.end(); } catch (e) { /* socket already gone */ } return; }
  const api = req.url.indexOf('/api/') === 0;
  send(req, res, 500, { 'Content-Type': api ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    Buffer.from(api ? JSON.stringify({ error: 'Something went wrong on the server. Please try again.' }) : 'Something went wrong. Please try again.'));
}
process.on('uncaughtException', function(err){ console.error('uncaughtException (still serving): ' + (err && err.stack || err)); });
process.on('unhandledRejection', function(err){ console.error('unhandledRejection (still serving): ' + (err && err.stack || err)); });

http.createServer(function(req, res){
  try { gate(req, res, function(){ try { serve(req, res); } catch (err) { fail(req, res, err); } }); }
  catch (err) { fail(req, res, err); }
}).listen(port, function(){ console.log('Revamp listening on port ' + port); });

function serve(req, res){
  const url = req.url.split('?')[0];
  if (url.indexOf('/api/') === 0) return handleApi(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }

  let rel;
  try { rel = decodeURIComponent(url); } catch (e) { return notFound(req, res); }
  // a NUL byte (/x%00.js) makes fs.stat() throw synchronously, before its callback exists — see the listener below
  if (rel.indexOf('\0') !== -1) return notFound(req, res);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) || isPrivate(path.relative(root, file).split(path.sep).join('/'))) return notFound(req, res);

  fs.stat(file, function(err, st){
    if (err) return notFound(req, res);
    if (st.isDirectory()){                                          // /templates → /templates/
      res.writeHead(301, { Location: url + '/' });
      return res.end();
    }
    fs.readFile(file, function(err2, buf){
      if (err2) return notFound(req, res);
      const ext = path.extname(file).toLowerCase();
      send(req, res, 200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': cacheFor(ext) }, buf);
    });
  });
}
