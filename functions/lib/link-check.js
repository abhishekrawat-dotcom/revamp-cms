/* Whether a page's links and pictures that lead to other sites still answer — the outside part of the check before
   Publish (owner decision #11, part 3.2: ~/.revamp-cms-qa/ai-learning/SPEC.md "Check before Publish").

   WHY: a site went live with a "Download the agenda" button whose PDF had moved and a partner's logo whose address
   answered 404, and nothing said so: the site check (site-checks.js, api.js siteCheckOf) reads the page, and only
   pictures in storage were asked about. Here each outside address is asked about, from the server, bounded:

     - at most MAX_PER_CHECK addresses of each kind (links, pictures) per check, the most visible first (the caller
       orders them); the rest are counted as not checked, never silently dropped;
     - HEAD first (nothing is downloaded); a site that refuses HEAD or answers it with an error is asked once more
       with GET, which reads at most GET_MAX_BYTES of the answer;
     - short timeouts, and a few at a time across the whole server (CONCURRENCY), so one page with slow links does
       not hold up anybody else's;
     - NEVER an address inside our own network: every request goes through safe-fetch.js, which refuses private,
       loopback, link-local (the cloud metadata service) and internal names, for the first address and again for
       every redirect, and connects to exactly the address it vetted. A link that points there is reported as one
       visitors cannot open, and nothing is fetched;
     - remembered per version of the site (key: '<eventId>@<version>'), so the publish window filling in, or the
       review page opened again, asks no site twice; and for a few minutes per address across versions.

   The person waits for none of this: check() answers within waitMs with what is known, and says how many are still
   being asked about (pending); the asking goes on, and the next check of the same version picks the answers up.

     check(list, opts) -> Promise<{ results: [{ url, state, status, why }], pending, skipped }>
       list: [{ url }] in the order to check them (only the first opts.max, MAX_PER_CHECK by default, are checked)
       opts: { key, kind ('link' | 'picture'), waitMs, max, fetch (tests: (url, options) -> Promise like safeFetch),
               fetchOptions (tests: merged into every safeFetch call, e.g. a stub lookup) }
       state: 'ok' | 'broken' (visitors reach nothing) | 'unknown' (could not be checked: the site would not say, or
              took too long) — why says it in words for the owner, '' when ok.
     probe(url, kind, fetch, fetchOptions) -> Promise<{ state, status, why }>   one address, never rejects
   Node 20, CommonJS. Tests: link-check.test.js (no real network). */
'use strict';

var safeFetch = require('./safe-fetch').safeFetch;
var publicAddress = require('./public-address');
var net = require('net');

var MAX_PER_CHECK = 40;
var CONCURRENCY = 12;
var HEAD_TIMEOUT_MS = 4000, GET_TIMEOUT_MS = 5000, GET_MAX_BYTES = 64 * 1024, MAX_REDIRECTS = 5;
var VERSION_TTL_MS = 30 * 60 * 1000, MAX_VERSIONS = 200;
var URL_TTL_MS = 10 * 60 * 1000, MAX_URLS = 5000;

/* What a probe's answer means for a visitor. status: the HTTP status of the last answer; type: its content type. */
function verdict(status, type, kind) {
  if (status >= 200 && status < 400) {
    /* a picture's address that answers with a web page (a sign-in or "not found" page served as 200) shows nothing */
    if (kind === 'picture' && /^text\/html\b/i.test(String(type || ''))) return { state: 'broken', status: status, why: 'it answers with a web page, not a picture' };
    return { state: 'ok', status: status, why: '' };
  }
  if (status === 404 || status === 410) return { state: 'broken', status: status, why: 'that page is not there (' + status + ')' };
  /* 401, 403, 429, LinkedIn's 999, a server error: the site would not answer a check, which says nothing about a
     visitor's browser, so it is "could not be checked", never "broken" */
  if (status >= 500 && status < 600) return { state: 'unknown', status: status, why: 'its site answered with an error (' + status + '); open it to be sure' };
  return { state: 'unknown', status: status, why: 'its site would not let us check it' + (status ? ' (' + status + ')' : '') + '; open it to be sure' };
}

/* An address safe-fetch.js would refuse for a reason that is not the visitor's problem (a port other than the web's
   own, a user name in it): not checked, said so. -> why | '' */
function notCheckable(url) {
  var u;
  try { u = new URL(url); } catch (e) { return ''; }
  if (u.username || u.password) return 'not checked: it has a user name or password in it';
  if (u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))) return 'not checked: it uses port ' + u.port;
  return '';
}

/* An address that names a private, loopback or link-local address, or an internal name, outright: refused before
   anything is asked, whatever fetch is in use (safe-fetch.js refuses it too, and also a name that resolves there). */
function namesInside(url) {
  var host;
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch (e) { return false; }
  return net.isIP(host) ? !publicAddress.isPublicAddress(host) : publicAddress.isInternalHostname(host);
}
var INSIDE = 'it points to a private or internal network address, which visitors cannot open';

function probe(url, kind, fetch, fetchOptions) {
  fetch = fetch || safeFetch;
  if (namesInside(url)) return Promise.resolve({ state: 'broken', status: 0, why: INSIDE });
  var skip = notCheckable(url);
  if (skip) return Promise.resolve({ state: 'unknown', status: 0, why: skip });
  function ask(method) {
    var o = Object.assign({ method: method, timeoutMs: method === 'HEAD' ? HEAD_TIMEOUT_MS : GET_TIMEOUT_MS, maxBytes: method === 'HEAD' ? 1 : GET_MAX_BYTES,
      maxRedirects: MAX_REDIRECTS, headers: { Accept: kind === 'picture' ? 'image/*,*/*;q=0.5' : 'text/html,*/*;q=0.5' } }, fetchOptions || {});
    return Promise.resolve().then(function () { return fetch(url, o); }).then(function (r) {
      return { status: (r && r.status) || 0, type: r && r.headers ? r.headers['content-type'] : '' };
    }, function (err) { return { error: (err && err.code) || 'unreachable' }; });
  }
  function fromError(code) {
    if (code === 'blocked-address') return { state: 'broken', status: 0, why: INSIDE };
    if (code === 'bad-url') return { state: 'broken', status: 0, why: 'it is not a web address a browser can open' };
    if (code === 'too-large') return { state: 'ok', status: 200, why: '' };           // it answered, with plenty
    if (code === 'timeout') return { state: 'unknown', status: 0, why: 'its site took too long to answer; open it to be sure' };
    return { state: 'broken', status: 0, why: 'its site could not be reached' };
  }
  return ask('HEAD').then(function (h) {
    if (!h.error && h.status >= 200 && h.status < 400) return verdict(h.status, h.type, kind);
    /* the address itself is refused (private, not a web address): asking again changes nothing */
    if (h.error === 'blocked-address' || h.error === 'bad-url') return fromError(h.error);
    /* many sites answer HEAD with 403, 404, 405 or nothing at all, and GET properly: GET decides */
    return ask('GET').then(function (g) { return g.error ? fromError(g.error) : verdict(g.status, g.type, kind); });
  }).then(null, function () { return { state: 'unknown', status: 0, why: 'it could not be checked just now' }; });
}

/* ---- a few at a time, across every check this server runs ---- */
var active = 0, waiting = [];
function limited(fn) {
  return new Promise(function (resolve) {
    function run() {
      active++;
      Promise.resolve().then(fn).then(function (v) { active--; next(); resolve(v); }, function () { active--; next(); resolve({ state: 'unknown', status: 0, why: 'it could not be checked just now' }); });
    }
    function next() { if (waiting.length && active < CONCURRENCY) waiting.shift()(); }
    if (active < CONCURRENCY) run(); else waiting.push(run);
  });
}

/* ---- what is known: per version of a site, and per address for a few minutes ---- */
var VERSIONS = new Map();      // key -> { at, results: Map(url -> result), running: Map(url -> Promise) }
var RECENT = new Map();        // kind + ' ' + url -> { at, result }
function versionEntry(key) {
  var now = Date.now(), e = VERSIONS.get(key);
  if (e && now - e.at < VERSION_TTL_MS) return e;
  if (VERSIONS.size >= MAX_VERSIONS) {
    VERSIONS.forEach(function (v, k) { if (now - v.at >= VERSION_TTL_MS) VERSIONS.delete(k); });
    while (VERSIONS.size >= MAX_VERSIONS) VERSIONS.delete(VERSIONS.keys().next().value);
  }
  e = { at: now, results: new Map(), running: new Map() };
  VERSIONS.set(key, e);
  return e;
}
function recent(kind, url) {
  var hit = RECENT.get(kind + ' ' + url);
  return hit && Date.now() - hit.at < URL_TTL_MS ? hit.result : null;
}
function remember(kind, url, result) {
  if (RECENT.size >= MAX_URLS) RECENT.clear();
  RECENT.set(kind + ' ' + url, { at: Date.now(), result: result });
}

function check(list, opts) {
  opts = opts || {};
  var kind = opts.kind === 'picture' ? 'picture' : 'link';
  var max = opts.max > 0 ? opts.max : MAX_PER_CHECK;
  var urls = [], seen = {};
  (list || []).forEach(function (x) { var u = String((x && x.url) || x || ''); if (u && !seen[u]) { seen[u] = 1; urls.push(u); } });
  var asked = urls.slice(0, max), skipped = urls.length - asked.length;
  var entry = versionEntry(kind + '|' + String(opts.key || ''));
  var waits = [];
  asked.forEach(function (url) {
    if (entry.results.has(url)) return;
    var known = recent(kind, url);
    if (known) { entry.results.set(url, known); return; }
    var p = entry.running.get(url);
    if (!p) {
      p = limited(function () { return probe(url, kind, opts.fetch, opts.fetchOptions); }).then(function (r) {
        entry.results.set(url, r);
        entry.running.delete(url);
        remember(kind, url, r);
        return r;
      });
      entry.running.set(url, p);
    }
    waits.push(p);
  });
  var waitMs = Math.max(0, Math.min(+opts.waitMs || 0, 20000));
  var done = waits.length ? Promise.race([Promise.all(waits), new Promise(function (r) { setTimeout(r, waitMs); })]) : Promise.resolve();
  return done.then(function () {
    var results = [], pending = 0;
    asked.forEach(function (url) {
      var r = entry.results.get(url);
      if (r) results.push({ url: url, state: r.state, status: r.status, why: r.why });
      else pending++;
    });
    return { results: results, pending: pending, skipped: skipped };
  });
}

/* tests only: forget everything (each test starts from nothing) */
function _reset() { VERSIONS.clear(); RECENT.clear(); }

module.exports = { check: check, probe: probe, verdict: verdict, MAX_PER_CHECK: MAX_PER_CHECK, _reset: _reset, _state: function () { return { active: active, waiting: waiting.length }; } };
