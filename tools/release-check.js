/* node tools/release-check.js [unit] [syntax] [smoke --url <deployed origin> [--event <published event id>] [--scraper <scraper origin>]]
                               [--jobs <n>] [--only <text>]

   The checks the release checklist runs (BE-064). With no step named, it runs `unit` and `syntax` — the two that
   need nothing but this checkout. Exit 0 when every check of every step passed, 1 otherwise (each failure listed).

     unit     every functions/lib/*.test.js, each in its own node process (--jobs at a time, 3 by default; --only
              keeps the files whose name holds that text), with a time limit each. A test that needs Chrome and
              finds none says so and passes. Nothing here reaches Firebase or the network.
     syntax   every browser file this server would actually send (functions/lib/access.js isServableFile): each
              .js, and each inline <script> of each .html, must parse — a script that does not parse breaks its
              page for every visitor. Module scripts are checked as modules. JSON and template blocks are skipped.
     smoke    a deployed copy, signed out, read-only: nothing is written (the visit counter is asked with a body it
              ignores, the QR code with HEAD, which is never counted).
                --url      the deployed origin (https://revamp-cms--revamp-cms.us-east4.hosted.app); required
                --event    a published event: its live page loads, is cached publicly, carries the registration
                           runtime and the visit counter; its QR address redirects to it, tagged, never cached
                --scraper  lovable-scraper-service's origin: /health answers, and /scrape refuses a call with no
                           secret
              Behind a company proxy, run it with NODE_EXTRA_CA_CERTS pointing at the proxy's certificate.

   THE RELEASE CHECKLIST (the steps outside the repository without which some fixes are not live; each ticked
   with who did it, when, and the command's output):
     1. `node tools/release-check.js` on the commit to be released: unit and syntax pass.
     2. `firebase functions:list --project revamp-cms`: no legacy "api" Cloud Function is deployed (BE-059);
        delete it if one is, and rotate GEMINI_API_KEY if it had one.
     3. lovable-scraper-service, when its code changed (BE-047, BE-048):
        `cd lovable-scraper-service && gcloud run deploy lovable-scraper-service --source . --project revamp-cms
         --region us-east4 --quiet` — WITHOUT --set-env-vars (that would replace SCRAPER_SECRET).
        Then `node tools/release-check.js smoke --url <app> --scraper <scraper URL>`: /health answers.
     4. `firebase deploy --only firestore,storage --project revamp-cms` when firestore.rules, storage.rules or
        firestore.indexes.json changed (BE-062).
     5. Push to main: App Hosting deploys the app. apphosting.yaml is the owner's (sizing: BE-060).
     6. One-off scripts named in the release notes, each with --dry-run first, on a qa- event, then for real.
     7. `node tools/release-check.js smoke --url <app> --event <a published event>` against production, and by
        hand in a signed-out browser: /e/<event> loads, a registration goes through and appears in the console.
   ETB2B EventSphere. Node 20, no dependencies beyond this repository's own. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'functions', 'lib');
const UNIT_TIMEOUT_MS = 6 * 60 * 1000;

/* ---------- arguments ---------- */
const argv = process.argv.slice(2);
function opt(name) { var i = argv.indexOf(name); return i !== -1 && argv[i + 1] && argv[i + 1].indexOf('--') !== 0 ? argv[i + 1] : ''; }
const STEPS = ['unit', 'syntax', 'smoke'].filter(function (s) { return argv.indexOf(s) !== -1; });
if (!STEPS.length) STEPS.push('unit', 'syntax');
const JOBS = Math.max(1, Math.min(8, parseInt(opt('--jobs'), 10) || 3));
const ONLY = opt('--only');
const failures = [];
let passed = 0;
function pass(label) { passed++; console.log('  ok    ' + label); }
function fail(label, detail) { failures.push(label); console.log('  FAIL  ' + label + (detail ? '\n          ' + String(detail).split('\n').join('\n          ') : '')); }
function check(cond, label, detail) { if (cond) pass(label); else fail(label, detail); }

/* ---------- unit ---------- */
function runUnit() {
  const files = fs.readdirSync(LIB).filter(function (f) { return /\.test\.js$/.test(f) && (!ONLY || f.indexOf(ONLY) !== -1); }).sort();
  console.log('\nunit: ' + files.length + ' test files, ' + JOBS + ' at a time');
  let next = 0;
  function one(file) {
    return new Promise(function (resolve) {
      const started = Date.now();
      const child = spawn(process.execPath, [path.join(LIB, file)], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      function keep(chunk) { out += chunk; if (out.length > 200000) out = out.slice(-100000); }
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      const timer = setTimeout(function () { out += '\n(stopped after ' + Math.round(UNIT_TIMEOUT_MS / 1000) + ' s)'; child.kill('SIGKILL'); }, UNIT_TIMEOUT_MS);
      child.on('close', function (code, signal) {
        clearTimeout(timer);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        const last = out.trim().split('\n').filter(Boolean);
        if (code === 0) pass(file + ' (' + secs + ' s)' + (last.length ? ' — ' + last[last.length - 1].slice(0, 120) : ''));
        else fail(file + ' (exit ' + (code === null ? signal : code) + ', ' + secs + ' s)', last.slice(-25).join('\n'));
        resolve();
      });
    });
  }
  function worker() { return next < files.length ? one(files[next++]).then(worker) : Promise.resolve(); }
  const workers = [];
  for (let i = 0; i < Math.min(JOBS, files.length); i++) workers.push(worker());
  return Promise.all(workers);
}

/* ---------- syntax ---------- */
function moduleParses(src) {
  /* a module is checked by node itself (vm can only parse one with an experimental flag) */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-syntax-'));
  const file = path.join(dir, 'm.mjs');
  try {
    fs.writeFileSync(file, src);
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    return r.status === 0 ? '' : String(r.stderr || 'does not parse').split('\n').filter(function (l) { return /Error/.test(l); })[0] || 'does not parse';
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left in the temp folder */ } }
}
function scriptProblem(src, label, asModule) {
  if (asModule) return moduleParses(src);
  try { new vm.Script(src, { filename: label }); return ''; } catch (e) {
    /* a file written as a module (import/export at the top) */
    if (/Cannot use import statement|Unexpected token 'export'|import\.meta/.test(e.message)) return moduleParses(src);
    return e.message;
  }
}
function runSyntax() {
  const access = require(path.join(LIB, 'access.js'));
  const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'functions', 'tools', 'lovable-scraper-service', 'docs']);
  let files = 0, scripts = 0;
  console.log('\nsyntax: the browser files this server sends');
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      if (e.name.charAt(0) === '.') return;
      const p = path.join(dir, e.name), rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); return; }
      if (!/\.(js|html)$/i.test(e.name) || !access.isServableFile(rel)) return;
      files++;
      const text = fs.readFileSync(p, 'utf8');
      if (/\.js$/i.test(e.name)) {
        scripts++;
        const problem = scriptProblem(text, rel, false);
        if (problem) fail(rel + ' does not parse', problem);
        return;
      }
      /* an HTML comment is passed over whole: a "<script>" written inside one (a note about scripts) is not a script */
      const re = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
      let m, n = 0;
      while ((m = re.exec(text))) {
        if (m[0].indexOf('<!--') === 0) continue;
        const attrs = m[1];
        if (/\bsrc\s*=/i.test(attrs) || !m[2].trim()) continue;
        const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || '';
        if (type && !/^(text\/javascript|application\/javascript|module)$/i.test(type)) continue;       // JSON, templates
        n++; scripts++;
        const line = text.slice(0, m.index).split('\n').length;
        const problem = scriptProblem(m[2], rel + ' <script #' + n + '>', /^module$/i.test(type));
        if (problem) fail(rel + ' <script> #' + n + ' (line ' + line + ') does not parse', problem);
      }
    });
  })(ROOT);
  check(files > 50 && scripts > 50, 'syntax: ' + scripts + ' scripts in ' + files + ' served files read', 'too few files found — is this the repository root?');
}

/* ---------- smoke ---------- */
function origin(v, name) {
  const m = /^(https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?)\/?$/.exec(String(v || '').trim());
  if (!m) { fail('smoke: ' + name + ' must be a bare origin such as https://example.com', v || '(missing)'); return ''; }
  return m[1];
}
async function ask(url, opts) {
  opts = Object.assign({ redirect: 'manual', headers: {} }, opts || {});
  opts.headers = Object.assign({ 'User-Agent': 'Mozilla/5.0 (release-check; ETB2B EventSphere) Chrome/126.0' }, opts.headers);
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 30000);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
    const text = opts.method === 'HEAD' ? '' : await r.text();
    return { status: r.status, headers: r.headers, text: text };
  } catch (e) {
    return { status: 0, headers: new Headers(), text: '', error: e && (e.cause && e.cause.code || e.message) };
  } finally { clearTimeout(timer); }
}
async function runSmoke() {
  const base = origin(opt('--url'), '--url');
  const event = opt('--event');
  const scraper = opt('--scraper') ? origin(opt('--scraper'), '--scraper') : '';
  if (!base) return;
  console.log('\nsmoke: ' + base + (event ? ' (event ' + event + ')' : '') + (scraper ? ', scraper ' + scraper : ''));
  let r;

  r = await ask(base + '/');
  check(r.status === 200 || r.status === 302, 'GET / answers (200, or 302 to sign-in)', r.status + ' ' + (r.error || ''));

  r = await ask(base + '/api/events');
  check(r.status === 401, 'GET /api/events signed out: 401', r.status + ' ' + r.text.slice(0, 120));

  r = await ask(base + '/Event_Listing.html');
  check(r.status !== 200 || !/QR Codes/.test(r.text), 'the events list is not shown signed out', r.status);

  r = await ask(base + '/e/release-check-no-such-event-0');
  check(r.status === 404, 'GET /e/<an id that is no event>: 404', r.status);

  r = await ask(base + '/robots.txt');
  check(r.status === 200 && /User-agent/i.test(r.text), 'GET /robots.txt: 200', r.status);

  r = await ask(base + '/templates/_shared/rv-visit.js');
  check(r.status === 200 && /javascript/.test(r.headers.get('content-type') || '') && /\/api\/track/.test(r.text), 'the visit counter is served (TPL-039)', r.status + ' ' + r.headers.get('content-type'));

  /* a body naming no event: answered 204 and nothing is written */
  r = await ask(base + '/api/track', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } });
  check(r.status === 204, 'POST /api/track with nothing to count: 204', r.status);

  if (event) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(event)) fail('smoke: --event is not an event id', event);
    else {
      r = await ask(base + '/e/' + event);
      const cc = r.headers.get('cache-control') || '';
      check(r.status === 200 && /<html/i.test(r.text), 'GET /e/' + event + ': 200, a page', r.status);
      check(/public/.test(cc) && /max-age=\d+/.test(cc), 'the live page may be kept by the CDN (public, max-age)', cc);
      check(/id="rv-site-config"/.test(r.text) && /rv-forms/.test(r.text), 'the live page carries its settings and the forms runtime', '');
      // (the event id goes into the pattern: a regular expression literal cannot take it)
      check(new RegExp('/templates/_shared/rv-visit\\.js[^"]*"[^>]*data-rv-visit="' + event + '"').test(r.text) || new RegExp('data-rv-visit="' + event + '"[^>]*src="[^"]*rv-visit\\.js').test(r.text),
        'the live page carries the visit counter for this event (TPL-039)', '');
      r = await ask(base + '/e/' + event + '?qr=release-check', { method: 'HEAD' });
      const loc = r.headers.get('location') || '';
      check(r.status === 302 && loc.indexOf('/e/' + event + '?') === 0 && /utm_source=release-check/.test(loc) && /utm_medium=qr/.test(loc),
        'a QR code address is sent on to the page, tagged (LST-038; HEAD is not counted)', r.status + ' ' + loc);
      check(/no-store/.test(r.headers.get('cache-control') || ''), 'the QR redirect is never cached, so every scan is counted', r.headers.get('cache-control'));
      r = await ask(base + '/preview/' + event);
      check(r.status !== 200 || !/id="rv-site-config"/.test(r.text), 'the team preview is not shown signed out', r.status);
    }
  }

  if (scraper) {
    r = await ask(scraper + '/health');
    check(r.status === 200 && /"ok"\s*:\s*true/.test(r.text), 'scraper GET /health: 200 {ok:true}', r.status + ' ' + r.text.slice(0, 80));
    r = await ask(scraper + '/scrape', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/' }), headers: { 'Content-Type': 'application/json' } });
    check(r.status === 401 || r.status === 403, 'scraper POST /scrape without the secret is refused', r.status + ' ' + r.text.slice(0, 80));
  }
}

/* ---------- run ---------- */
(async function main() {
  const started = Date.now();
  if (STEPS.indexOf('unit') !== -1) await runUnit();
  if (STEPS.indexOf('syntax') !== -1) runSyntax();
  if (STEPS.indexOf('smoke') !== -1) await runSmoke();
  console.log('\nrelease-check (' + STEPS.join(', ') + '): ' + passed + ' passed, ' + failures.length + ' failed, ' + Math.round((Date.now() - started) / 1000) + ' s');
  if (failures.length) console.log('failed:\n  - ' + failures.join('\n  - '));
  process.exit(failures.length ? 1 : 0);
})().catch(function (err) { console.error('release-check: stopped — ' + (err && err.stack || err)); process.exit(1); });
