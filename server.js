// Production server for Firebase App Hosting (backend "revamp-cms", built from GitHub on every push to main).
// App Hosting runs `npm start` and sends traffic to process.env.PORT. It serves the static pages and hands
// /api/*, /e/* (published event sites) and /preview/* to functions/lib/api.js — the same handler the local dev
// server (tools/serve.js) uses, so the endpoints behave identically everywhere. Env vars come from apphosting.yaml
// (FIREBASE_STORAGE_BUCKET, GEMINI_API_KEY); credentials are App Hosting's own service identity.
// Local: `npm install`, then `npm start` → http://localhost:8080 (tools/serve.js stays the dev server).
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { handleApi } = require('./functions/lib/api');
// gate: @timesinternet.in Google sign-in for pages and /api/*; isServableFile: which files are served at all
const { gate, isServableFile } = require('./functions/lib/access');

const root = __dirname;
const port = +process.env.PORT || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8'
};
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;

/* Which files are served is decided by isServableFile() in functions/lib/access.js — an allow-list shared
   with tools/serve.js and with the gate, so "is this public" and "is this served" cannot disagree. Anything
   it does not list (the server and its config, the backend source, tooling, the scraper service, internal
   documents, backups, dotfiles) answers 404 here, exactly like a file that does not exist. */

/* The pages ask for /favicon.ico on every load and the repository has no such file; the ET mark answers
   for it. (Published event sites name the same file in their own <link rel="icon">.) */
const FAVICON = { path: path.join(root, 'assets', 'et-b2b-logo.svg'), type: 'image/svg+xml' };

function cacheFor(ext){
  if (ext === '.html') return 'no-store';                          // signed-in only (gate): never cached, so Back after sign-out asks the gate again
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
  const api = String(req.url).indexOf('/api/') === 0;
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
  if (/^\/(api|e|preview)\//.test(url)) return handleApi(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  if (url === '/favicon.ico'){
    return fs.readFile(FAVICON.path, function(err, buf){
      if (err) return notFound(req, res);
      send(req, res, 200, { 'Content-Type': FAVICON.type, 'Cache-Control': 'public, max-age=86400' }, buf);
    });
  }

  let rel;
  try { rel = decodeURIComponent(url); } catch (e) { return notFound(req, res); }
  // a NUL byte (/x%00.js) makes fs.stat() throw synchronously, before its callback exists — see the listener below
  if (rel.indexOf('\0') !== -1) return notFound(req, res);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) || !isServableFile(path.relative(root, file).split(path.sep).join('/'))) return notFound(req, res);

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
