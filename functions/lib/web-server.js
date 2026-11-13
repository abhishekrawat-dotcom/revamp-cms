/* The app's own web server: which addresses go to the API, which files are sent and how (their type, caching,
   compression, the app pages' headers), and what one failed request costs. ONE copy, used by both servers, so
   what QA sees on a laptop is what users get (BE-063):
     server.js        production — Firebase App Hosting (backend "revamp-cms") runs `npm start`
     tools/serve.js   the local development server, on 127.0.0.1 only
   What differs between the two stays in those files: the port, where credentials come from (App Hosting's own
   service identity; tools/.env.local locally), the sign-in gate (tools/serve.js can switch it off for pages with
   REVAMP_AUTH_DISABLED=1) and production's SIGTERM handling.

     handler({ guard, handleApi, root? }) -> function (req, res)   the request listener: guard(req, res, next) first
                                          (lib/access.js gate, or a pass-through), then an API route or a file
     cacheFor(ext, versioned)             -> the Cache-Control a file is sent with
     send(req, res, status, headers, body, packKey)   an answer, compressed when it is worth it, with the page headers
     fail(req, res, err)                  a request that threw: logged, answered 500
     keepServing()                        a throw nobody caught is logged and the server keeps serving
     TYPES, APP_PAGE_HEADERS
   Node 20, CommonJS. Nothing here reaches Firebase. */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
// isServableFile: which files are served at all (the same allow-list the gate uses)
const { isServableFile } = require('./access');
// assetVersion: the content hash a page's ?v= names for one of these files (lib/delivery.js)
const { assetVersion, versionPageAssets } = require('./delivery');
// redactUrl: a request address for the log, without the token of a shareable preview link (/s/<token>)
const { redactUrl } = require('./share-token');

/* the repository: the deployment and the files served are the same tree */
const ROOT = path.join(__dirname, '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8'
};
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;

/* Which files are served is decided by isServableFile() in lib/access.js — an allow-list shared with the gate, so
   "is this public" and "is this served" cannot disagree. Anything it does not list (the server and its config, the
   backend source, tooling, the scraper service, internal documents, backups, dotfiles) answers 404 here, exactly
   like a file that does not exist. */

/* versioned: the request names the file's current content hash (?v=…, written by lib/delivery.js into every page
   it serves) — that address can never mean other bytes, so it is kept for a year. */
function cacheFor(ext, versioned){
  if (ext === '.html') return 'no-store';                          // signed-in only (gate): never cached, so Back after sign-out asks the gate again
  if (versioned) return 'public, max-age=31536000, immutable';
  if (ext === '.js' || ext === '.css' || ext === '.json') return 'public, max-age=300';   // an unversioned name may change on the next deploy
  return 'public, max-age=86400';
}

/* Compressed copies of the files served lately (brotli and gzip), made once per file version instead of on
   every request. Bounded by size; a file that changes on disk is compressed again. */
const PACKED = new Map(); let packedBytes = 0;
const PACKED_MAX_BYTES = 24 * 1024 * 1024;
function packedBody(key, body, encoding){
  const k = key + '|' + encoding;
  const hit = PACKED.get(k);
  if (hit) return hit;
  const out = encoding === 'br'
    ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
    : zlib.gzipSync(body, { level: 9 });
  if (packedBytes + out.length > PACKED_MAX_BYTES){ PACKED.clear(); packedBytes = 0; }
  PACKED.set(k, out); packedBytes += out.length;
  return out;
}
function acceptedEncoding(req){
  const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
  const ok = function(name){
    const m = new RegExp('(?:^|,)\\s*' + name + '\\s*(?:;\\s*q\\s*=\\s*([0-9.]+))?\\s*(?=,|$)').exec(ae);
    return !!m && !(m[1] != null && +m[1] === 0);
  };
  return ok('br') ? 'br' : ok('gzip') ? 'gzip' : '';
}

/* The app's own pages (every one of them signed-in, and the sign-in page) may be shown in a frame only by the app
   itself — the site editor's canvas, the review page's panes, Promotions inside the console — never by another site,
   which could otherwise lay its own page over Publish or Delete (clickjacking, BE-057). X-Frame-Options says the same
   to an older browser. Referrer-Policy: a request a page makes to another site carries this origin only, never the
   page's address. The published sites (/e/, /s/, the speaker and sponsor pages) are not answered here: they come
   from lib/api.js with their own headers. */
const APP_PAGE_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

/* packKey: a key naming this exact body (path + mtime + size) when it may be kept compressed */
function send(req, res, status, headers, body, packKey){
  const type = headers['Content-Type'] || '';
  if (/^text\/html/i.test(type)) Object.keys(APP_PAGE_HEADERS).forEach(function(k){ headers[k] = APP_PAGE_HEADERS[k]; });
  const encoding = body.length > 1024 && COMPRESSIBLE.test(type) ? acceptedEncoding(req) : '';
  if (encoding){
    body = packKey ? packedBody(packKey, body, encoding) : (encoding === 'br' ? zlib.brotliCompressSync(body) : zlib.gzipSync(body));
    headers['Content-Encoding'] = encoding;
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
     - keepServing(), the process-level handlers: a throw inside a later stream or promise callback is logged and
       the server keeps serving (that one request gets no reply and times out — the lesser harm). */
function fail(req, res, err){
  console.error('request failed: ' + req.method + ' ' + redactUrl(req.url) + ' — ' + (err && err.stack || err));
  if (res.headersSent){ try { res.end(); } catch (e) { /* socket already gone */ } return; }
  const api = String(req.url).indexOf('/api/') === 0;
  send(req, res, 500, { 'Content-Type': api ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    Buffer.from(api ? JSON.stringify({ error: 'Something went wrong on the server. Please try again.' }) : 'Something went wrong. Please try again.'));
}
function keepServing(){
  process.on('uncaughtException', function(err){ console.error('uncaughtException (still serving): ' + (err && err.stack || err)); });
  process.on('unhandledRejection', function(err){ console.error('unhandledRejection (still serving): ' + (err && err.stack || err)); });
}

/* o: { guard(req, res, next), handleApi(req, res), root (the repository, by default) } -> the request listener */
function handler(o){
  const root = o.root || ROOT, guard = o.guard, handleApi = o.handleApi;
  if (typeof guard !== 'function' || typeof handleApi !== 'function') throw new Error('web-server: handler() needs a guard and handleApi');

  /* A browser asks for /favicon.ico on its own; the red ETB2B square answers for it (assets/favicon.svg, cut from the
     ETB2B logo unchanged), the same icon every page and every published site names in its <link rel="icon">. */
  const FAVICON = { path: path.join(root, 'assets', 'favicon.svg'), type: 'image/svg+xml' };

  function serve(req, res){
    const url = req.url.split('?')[0];
    if (/^\/(api|e|preview|t)\//.test(url) || url.indexOf('/s/') === 0) return handleApi(req, res);   // /s/: a shared preview link
    if (url === '/robots.txt' || url === '/sitemap.xml' || url === '/sitemap-people.xml') return handleApi(req, res);   // for search engines (lib/site-seo.js, lib/people.js)
    if (/^\/(speakers|sponsors)\//.test(url)) return handleApi(req, res);   // a speaker's or a sponsor's page across ETB2B (lib/people.js)
    if (url.indexOf('/img/') === 0) return handleApi(req, res);   // a picture of the storage bucket, from our own address for the CDN (lib/picture-cdn.js)
    if (req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    if (url === '/favicon.ico'){
      return fs.readFile(FAVICON.path, function(err, buf){
        if (err) return notFound(req, res);
        send(req, res, 200, { 'Content-Type': FAVICON.type, 'Cache-Control': 'public, max-age=86400' }, buf);
      });
    }

    let rel;
    try { rel = decodeURIComponent(url); } catch (e) { return notFound(req, res); }
    // a NUL byte (/x%00.js) makes fs.stat() throw synchronously, before its callback exists — see fail() above
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
        const v = /(?:^|&)v=([A-Za-z0-9._-]+)(?:&|#|$)/.exec(req.url.split('?')[1] || '');
        const versioned = !!v && ext !== '.html' && v[1] === assetVersion(url);
        /* a page names each of its own stylesheets and scripts by content hash (lib/delivery.js versionPageAssets), so a
           release never pairs a new page with a file the browser kept from before; the compressed copy is keyed by what
           is sent, which changes whenever one of those files does */
        let body = buf, key = file + '|' + st.mtimeMs + '|' + st.size;
        if (ext === '.html'){
          const text = versionPageAssets(buf.toString('utf8'), url);
          body = Buffer.from(text, 'utf8');
          key += '|' + require('crypto').createHash('sha1').update(body).digest('hex').slice(0, 12);
        }
        send(req, res, 200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cacheFor(ext, versioned) }, body, key);
      });
    });
  }

  return function(req, res){
    try { guard(req, res, function(){ try { serve(req, res); } catch (err) { fail(req, res, err); } }); }
    catch (err) { fail(req, res, err); }
  };
}

module.exports = { handler, cacheFor, send, fail, keepServing, TYPES, APP_PAGE_HEADERS, ROOT };
