// Minimal HTTP service that does exactly one thing: launch headless Chrome, render a URL, and hand back
// the rendered HTML. It exists because this repo's main backend (Firebase App Hosting, see
// ../apphosting.yaml) builds its container with Google's automatic buildpacks -- there is no Dockerfile
// for that service, so there is no way to apt-get install the system libraries (libnss3 and friends)
// headless Chrome needs. This service is deployed separately, straight to Cloud Run with a real
// Dockerfile (see Dockerfile in this directory), so it CAN install whatever Chrome needs. The main
// backend (functions/lib/api.js's scrapeLovableUrl()) calls this service over plain HTTP instead of
// launching Chrome itself. See README.md in this directory for the full picture and deploy instructions.
//
// Endpoints:
//   POST /scrape  body {url}  ->  200 {html}  |  4xx/5xx {error, code}      (codes: see ERRORS below)
//   GET  /health              ->  200 {ok: true}  (no secret; says nothing else. /healthz answers the same, but Cloud
//                                 Run's front end keeps that path for itself, so use /health from outside)
//
// HOW IT IS KEPT FROM BEING USED AGAINST US (BE-047). This service opens, in a real browser, an address someone
// typed, on a public Cloud Run URL, inside a container that has the cloud's metadata service at 169.254.169.254:
//   - Who may call it: every POST carries the shared secret set on BOTH this service (env SCRAPER_SECRET) and the
//     main backend (env LOVABLE_SCRAPER_SECRET) in the X-Scraper-Secret header, compared in constant time
//     (secretMatches). Deploying with IAM-only invocation (--no-allow-unauthenticated) is the stronger option; the
//     README says what it needs.
//   - What a call may ask: a body of at most 4 KB (413 beyond), JSON {url}; the url http(s), on the standard
//     port, with no user name or password, whose host is a public address (checkUrl, with the same address rules
//     as the main backend: public-address.js is an identical copy of functions/lib/public-address.js).
//   - What the page may reach: EVERY connection the browser makes — the page, its redirects, its pictures,
//     scripts, fetches, workers and web sockets — goes through a small proxy inside this process (startGuard),
//     which resolves each host once, refuses any that is not a public address (or on another port), and then
//     connects to exactly the address it checked, so a name cannot be pointed somewhere else between the check
//     and the connection. It also caps what one render may download. WebRTC is kept off the network, downloads
//     are refused and service workers are bypassed.
//   - How much at once: one render at a time per instance, at most MAX_WAITING more waiting their turn, each
//     only as long as it can still finish inside the caller's own time limit; beyond that 429 {code:'busy'}.
//     Each render has a hard time limit, and a browser that will not close is killed.
//   - What comes back: only a page that is one (BE-048): an address that answers an HTTP error, cannot be
//     reached, shows nothing, or shows a host's "no site here" page is answered as such, with a code, never as
//     a capture; markup over MAX_HTML_BYTES is refused.
//   - The container runs as a non-root user (Dockerfile USER node).

var http = require('http');
var net = require('net');
var dns = require('dns');
var crypto = require('crypto');
var addressRules = require('./public-address');
var isPublicAddress = addressRules.isPublicAddress;
var isInternalHostname = addressRules.isInternalHostname;

var PORT = process.env.PORT || 8080;

// Same two timeouts and reasoning as the (now-removed) in-process version of this logic in
// functions/lib/api.js: NAV_TIMEOUT_MS is page.goto()'s own ceiling for reaching network-idle,
// TOTAL_TIMEOUT_MS is the hard ceiling on the whole render (Chrome launch included) so one slow/hung
// site can never tie up this process (and its headless Chrome) forever.
var NAV_TIMEOUT_MS = 30000;
var TOTAL_TIMEOUT_MS = 105000;   // the page is walked through before capture (carousels, accordions): see settlePage

var MAX_BODY_BYTES = 4 * 1024;                  // a request is {url}: nothing bigger is one
var MAX_HTML_BYTES = 6 * 1024 * 1024;           // the captured markup handed back
var MAX_RENDER_BYTES = 80 * 1024 * 1024;        // everything one render may download, through the guard
var REQUEST_BUDGET_MS = 110000;                 // a whole call, waiting included: under the caller's 115 s (api.js)
var MIN_RENDER_MS = 45000;                      // a render that would get less than this is not started (busy)
var MAX_WAITING = 3;                            // calls waiting for the one render running
var CLOSE_TIMEOUT_MS = 10000;                   // a browser that has not closed by then is killed
var TUNNEL_IDLE_MS = 30000;                     // a connection through the guard with nothing on it for this long ends

/* What a call can be answered, by code: the HTTP status and the words. The main backend (functions/lib/
   import-check.js) words each code for the person importing; these are for the log and for a direct caller. */
var ERRORS = {
  'not-found': [404, 'Not found.'],
  'not-configured': [503, 'This service has no SCRAPER_SECRET configured yet.'],
  'unauthorized': [401, 'Missing or incorrect X-Scraper-Secret header.'],
  'too-large': [413, 'The request is too large.'],
  'bad-request': [400, 'The body must be JSON: {"url": "..."}.'],
  'bad-url': [400, 'That is not an address that can be opened.'],
  'blocked-address': [400, 'That address is not a public one, so it is not opened.'],
  'busy': [429, 'A page is being rendered already. Try again in a minute.'],
  'unreachable': [422, 'That address could not be reached.'],
  'source-http-error': [422, 'That address answered with an error.'],
  'empty-page': [422, 'That page shows nothing to import.'],
  'not-a-site': [422, 'That address shows an error page, not a site.'],
  'capture-too-large': [422, 'That page is too large to import.'],
  'timeout': [504, 'Rendering this page took too long.'],
  'render-failed': [500, 'The page could not be rendered.']
};
function captureError(code, extra) {
  var e = new Error((ERRORS[code] || ERRORS['render-failed'])[1]);
  e.code = ERRORS[code] ? code : 'render-failed';
  e.status = (ERRORS[e.code])[0];
  return Object.assign(e, extra || {});
}

// ---------- which addresses may be opened ----------

/* The checks that need no lookup: -> { host, port } or { code, reason }. */
function parseTarget(rawUrl) {
  var u;
  try { u = new URL(String(rawUrl == null ? '' : rawUrl).trim()); } catch (e) { return { code: 'bad-url', reason: 'That doesn\'t look like a valid URL.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { code: 'bad-url', reason: 'Only http:// and https:// URLs are allowed.' };
  if (u.username || u.password) return { code: 'bad-url', reason: 'An address with a user name or password in it is not opened.' };
  if (u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))) {
    return { code: 'bad-url', reason: 'Only addresses on the standard web ports are opened.' };
  }
  var host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { code: 'bad-url', reason: 'That doesn\'t look like a valid URL.' };
  if (net.isIP(host) ? !isPublicAddress(host) : isInternalHostname(host)) return { code: 'blocked-address', reason: 'That host isn\'t allowed.' };
  return { host: host, port: u.protocol === 'https:' ? 443 : 80 };
}

/* -> Promise<null | { code, reason }>: null when the address may be opened. Every answer the name resolves to must
   be public (one private answer is enough to refuse). `lookup` is dns.lookup unless a test passes its own. */
function checkUrl(rawUrl, lookup) {
  var t = parseTarget(rawUrl);
  if (t.code) return Promise.resolve(t);
  if (net.isIP(t.host)) return Promise.resolve(null);
  return new Promise(function (resolve) {
    (lookup || dns.lookup)(t.host, { all: true, verbatim: true }, function (err, addrs) {
      if (err || !addrs || !addrs.length) return resolve({ code: 'unreachable', reason: 'Could not resolve that host.' });
      var list = addrs.map(function (a) { return typeof a === 'string' ? a : a.address; });
      resolve(list.every(isPublicAddress) ? null : { code: 'blocked-address', reason: 'That host resolves to a private address and isn\'t allowed.' });
    });
  });
}
/* The same, as one sentence or null (what tools/reimport-lovable.js reads). */
function validateUrl(rawUrl) {
  return checkUrl(rawUrl).then(function (bad) { return bad ? bad.reason : null; });
}

/* ---------- the guard: every connection the browser makes goes through here ----------
   An HTTP proxy on 127.0.0.1, one per render, that the browser is started with (--proxy-server, with loopback
   NOT bypassed). HTTPS and web sockets arrive as CONNECT host:port, plain http as "GET http://host/path". Each
   host is resolved once per render; if any answer is not a public address, or the port is not 80/443, the
   connection is refused (403) and the host noted. Otherwise the connection is made to exactly the address that
   was checked. Everything that comes back is counted; past maxBytes every connection is cut and no new one is
   made.
     opts: { maxBytes, lookup (tests), _connectTo(address, port) -> { host, port } (tests) }
     -> Promise<{ port, close(), refusedHost(url) -> bool, stats() -> { bytes, refused: [host], over } }> */
function startGuard(opts) {
  opts = opts || {};
  var lookup = opts.lookup || dns.lookup, maxBytes = opts.maxBytes > 0 ? opts.maxBytes : MAX_RENDER_BYTES;
  var verdicts = new Map(), sockets = new Set(), refused = [], bytes = 0, over = false;

  function track(s) { sockets.add(s); s.on('close', function () { sockets.delete(s); }); return s; }
  function count(n) {
    bytes += n;
    if (bytes > maxBytes && !over) {
      over = true;
      console.error('scrape: the page asked for more than ' + Math.round(maxBytes / 1048576) + ' MB — its other downloads are cut');
      sockets.forEach(function (s) { s.destroy(); });
    }
  }
  function refuse(host) { if (refused.indexOf(host) === -1 && refused.length < 200) refused.push(host); return { ok: false }; }
  /* -> Promise<{ ok, address }> */
  function judge(host, port) {
    host = String(host || '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (over) return Promise.resolve({ ok: false });
    if (port !== 80 && port !== 443) return Promise.resolve(refuse(host + ':' + port));      // the name itself may be fine on its own port
    if (net.isIP(host)) return Promise.resolve(isPublicAddress(host) ? { ok: true, address: host } : refuse(host));
    if (!host || isInternalHostname(host)) return Promise.resolve(refuse(host));
    if (!verdicts.has(host)) {
      verdicts.set(host, new Promise(function (resolve) {
        lookup(host, { all: true, verbatim: true }, function (err, addrs) {
          if (err || !addrs || !addrs.length) return resolve({ ok: false });
          var list = addrs.map(function (a) { return typeof a === 'string' ? a : a.address; });
          resolve(list.every(isPublicAddress) ? { ok: true, address: list[0] } : refuse(host));
        });
      }));
    }
    return verdicts.get(host);
  }
  function target(address, port) { return opts._connectTo ? opts._connectTo(address, port) : { host: address, port: port }; }

  var server = http.createServer();
  server.on('connect', function (req, client, head) {
    track(client);
    client.on('error', function () { client.destroy(); });
    var m = /^\[?([^\]]*?)\]?:(\d{1,5})$/.exec(String(req.url || ''));
    var host = m ? m[1] : '', port = m ? +m[2] : 0;
    judge(host, port).then(function (v) {
      if (!v.ok || over || client.destroyed) { client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return; }
      var to = target(v.address, port);
      var up = track(net.connect(to.port, to.host));
      up.setTimeout(TUNNEL_IDLE_MS, function () { up.destroy(); });
      up.on('connect', function () {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) up.write(head);
        up.on('data', function (d) { count(d.length); });
        up.pipe(client);
        client.pipe(up);
      });
      up.on('error', function () { if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); });
      up.on('close', function () { client.destroy(); });
      client.on('close', function () { up.destroy(); });
    });
  });
  server.on('request', function (req, res) {
    function no(status) { if (!res.headersSent) res.writeHead(status, { 'Content-Length': 0, Connection: 'close' }); res.end(); }
    var u;
    try { u = new URL(String(req.url || '')); } catch (e) { return no(400); }
    if (u.protocol !== 'http:' || u.username || u.password) return no(403);
    var port = u.port ? +u.port : 80;
    judge(u.hostname, port).then(function (v) {
      if (!v.ok || over) return no(403);
      var headers = Object.assign({}, req.headers);
      delete headers['proxy-connection']; delete headers['proxy-authorization'];
      headers.host = u.host;
      var to = target(v.address, port);
      var up = http.request({ host: to.host, port: to.port, method: req.method, path: u.pathname + u.search, headers: headers, agent: false }, function (r) {
        res.writeHead(r.statusCode || 502, r.headers);
        r.on('data', function (d) { count(d.length); });
        r.on('error', function () { res.destroy(); });
        r.pipe(res);
      });
      up.setTimeout(TUNNEL_IDLE_MS, function () { up.destroy(); });
      up.on('error', function () { no(502); });
      req.pipe(up);
    });
  });
  /* a web socket asked of the proxy in plain form (a browser tunnels it with CONNECT): not served */
  server.on('upgrade', function (req, socket) { socket.destroy(); });
  server.on('connection', function (s) { track(s); });

  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve({
        port: server.address().port,
        close: function () {
          sockets.forEach(function (s) { s.destroy(); });
          return new Promise(function (done) { server.close(function () { done(); }); });
        },
        refusedHost: function (url) {
          var h = '';
          try { h = new URL(url).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase(); } catch (e) { return false; }
          return refused.indexOf(h) !== -1;
        },
        stats: function () { return { bytes: bytes, refused: refused.slice(), over: over }; }
      });
    });
  });
}

/* ---------- is the capture a site at all (BE-048) ----------
   What the open page shows: its visible text, and how many things are on it besides text (pictures, headings,
   paragraphs…). Nothing worth importing: under 200 characters and fewer than 3 such things. A host's own "there is
   no site here" page (a Lovable address with no project behind it answers one): its words, on a page with little
   else. functions/lib/import-check.js applies the same rule to the markup on the main backend's side.
   -> '' | 'empty-page' | 'not-a-site' */
var NOT_A_SITE = /no lovable project found|project not found|site not found|page not found|this site can.?t be reached|deployment (?:not found|has failed|failed)|404[\s:.—-]+not found|there.?s nothing here|domain is not configured/i;
function captureVerdict(facts) {
  facts = facts || {};
  var text = +facts.text || 0, content = +facts.content || 0;
  if (text < 600 && content < 12 && NOT_A_SITE.test(String(facts.sample || ''))) return 'not-a-site';
  if (text < 200 && content < 3) return 'empty-page';
  return '';
}
/* runs in the page */
function pageFacts() {
  var b = document.body, text = b ? String(b.innerText || '').replace(/\s+/g, ' ').trim() : '';
  return { text: text.length, sample: text.slice(0, 600),
    content: document.querySelectorAll('img, svg, video, picture, canvas, h1, h2, h3, h4, h5, h6, p, li').length };
}

/* ---------- one render at a time ----------
   enter(maxWaitMs) -> Promise<release()>: at once when nothing runs and nobody waits; otherwise in turn, for at
   most maxWaitMs; rejects 'busy' when MAX_WAITING already wait or the wait runs out. */
function createGate(maxActive, maxWaiting) {
  var active = 0, queue = [];
  function release() {
    var used = false;
    return function () { if (used) return; used = true; active--; next(); };
  }
  function next() {
    while (active < maxActive && queue.length) {
      var w = queue.shift();
      clearTimeout(w.timer);
      active++;
      w.resolve(release());
    }
  }
  return {
    enter: function (maxWaitMs) {
      if (active < maxActive && !queue.length) { active++; return Promise.resolve(release()); }
      if (queue.length >= maxWaiting || !(maxWaitMs > 0)) return Promise.reject(captureError('busy'));
      return new Promise(function (resolve, reject) {
        var w = { resolve: resolve };
        w.timer = setTimeout(function () {
          var i = queue.indexOf(w);
          if (i !== -1) queue.splice(i, 1);
          reject(captureError('busy'));
        }, maxWaitMs);
        queue.push(w);
      });
    },
    stats: function () { return { active: active, waiting: queue.length }; }
  };
}

// ---------- the actual render ----------

// The capture keeps the page's markup and drops its scripts, so whatever a script would have done later
// for a visitor has to have happened before the capture:
//   - content revealed when it scrolls into view, and lazy pictures: the page is scrolled through once,
//     top to bottom, and put back at the top;
//   - the page's own motion (entrances, loops, motion tied to the scroll): recorded on that walk and written
//     on each element as data-rv-motion (motionRecorder, below), for et-runtime.js to play again;
//   - a top bar that changes once the visitor scrolls (a transparent bar turning into a floating, frosted
//     one): the classes of the bar and of everything in it are read with the page scrolled, and each element
//     whose classes differ there carries them as data-rv-scrolled-class (et-runtime.js swaps them);
//   - tabs ([role=tablist] / [role=tab]) whose script keeps only the chosen tab's content in the page: each
//     tab is chosen in turn and what it shows is kept — the panel it names (aria-controls), else everything
//     after the tab list in its box — with the rows in it opened (below). The other tabs' panels are put in
//     the page hidden (data-rv-tabpanel), the tabs marked data-rv-tab, every element around them whose
//     classes change with the tab (the tab's own underline, a background picture faded in, a progress bar)
//     carries its classes for each tab (data-rv-tab-classes), and a set that moves on by itself (a progress
//     bar's animation) gets data-rv-tab-auto="<ms>". The page is put back on the tab it opened on;
//   - rows that open on a click (button[aria-expanded]) whose panel only exists while open: each closed row
//     is opened once, its panel (the one it names with aria-controls, else the one after it) copied, and the
//     copies put back closed (height 0) where the page had put them, so the imported page has every panel to
//     open (templates/_shared/et-runtime.js does the opening).
// Bounded: at most SETTLE_MAX_ROWS rows, SETTLE_MAX_SCROLL_STEPS scroll steps, SETTLE_MAX_TABLISTS tab lists
// of SETTLE_MAX_TABS tabs, and all of it within SETTLE_BUDGET_MS (what is left undone is captured as it is).
var SETTLE_MAX_ROWS = 40;
var SETTLE_MAX_SCROLL_STEPS = 80;
var SETTLE_MAX_TABLISTS = 8;
var SETTLE_MAX_TABS = 8;
var SETTLE_BUDGET_MS = 60000;
/* what has not moved in by the end of the walk is brought into view one at a time, at most this many */
var SETTLE_MAX_LATE_REVEALS = 40;

/* ---------- the page's own motion ----------
   The capture keeps the page's look but not its script, and the motion lives in the script: words rising into
   place, pictures uncovered, cards settling in as the visitor scrolls, a banner drifting as the page moves.
   motionRecorder runs in the page before the page's own script (page.evaluateOnNewDocument, capturePage) and
   notes, while the page opens and is walked through once (settlePage):
     - each animation the page starts with element.animate() — how framer-motion and the Web Animations API run
       theirs: its keyframes, length, easing and delay as it really played (a delay can be given as a later start,
       which shows only once the browser has scheduled it); played as the page opened ("load") or as the element
       came into view ("view"); one that repeats is kept as a loop;
     - each style the page's script rewrites as the visitor scrolls (a parallax, a zoom tied to the scroll), and
       each animation run by the scroll itself (a scroll or view timeline): its value at each point of the
       element's way through the window (by how far the page has scrolled past the element's top), told apart
       from an entrance timed by the clock by having about one value at each place.
   window.__rvMotion.write() then puts each element's motion on it as data-rv-motion — which
   templates/_shared/et-runtime.js plays again — and leaves the element as its entrance ends, so the page reads
   right with no script at all (the editor, a search engine, a visitor who asked for less motion). */
function motionRecorder() {
  if (window.__rvMotion) return;
  var MAX_ELEMENTS = 600, MAX_SAMPLES = 40, MAX_ATTR = 6000;
  var PROPS = ['opacity', 'transform', 'clip-path', 'filter', 'translate', 'scale', 'rotate'];
  var M = window.__rvMotion = { on: true, walk: 0, first: 0, els: [], data: new Map() };

  function place(el) {
    var top = 0;
    for (var e = el; e; e = e.offsetParent) top += e.offsetTop || 0;
    return { top: top, h: el.offsetHeight || 0 };
  }
  /* how far the page has scrolled past the element's top, in pixels (negative till its top reaches the top of
     the window): the same on a phone as on a desktop at the top of the page, where a motion tied to the scroll
     is seen first */
  function progress(el) {
    return window.pageYOffset - place(el).top;
  }
  function rec(el) {
    var d = M.data.get(el);
    if (!d && M.els.length < MAX_ELEMENTS * 4) { d = { runs: [], seen: {} }; M.data.set(el, d); M.els.push(el); }
    return d;
  }
  /* drawn: read from what the browser draws (an animation run by the scroll), not from the style attribute */
  function see(d, k, v, p, drawn) {
    if (!v || typeof p !== 'number' || !isFinite(p)) return;
    (d.seen[k] = d.seen[k] || []).push({ p: p, v: String(v), drawn: !!drawn });
  }
  function cssName(k) { return k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }

  var animate = Element.prototype.animate;
  Element.prototype.animate = function () {
    var a = animate.apply(this, arguments);
    try {
      var d = M.on && rec(this);
      if (d) {
        var run = { a: a, t: performance.now(), scrolled: !!M.walk };
        if (!M.first) M.first = run.t;
        d.runs.push(run);
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          try {
            run.start = a.startTime;
            run.timing = a.effect.getComputedTiming();
            run.easing = a.effect.getTiming().easing;
            run.kf = a.effect.getKeyframes();
            run.scroll = !!a.timeline && a.timeline !== document.timeline;
          } catch (e) { /* not kept */ }
        }); });
      }
    } catch (e) { /* the page's own animation runs regardless */ }
    return a;
  };

  /* what the page watches for coming into view, and how far in it must be (the margin and share an
     IntersectionObserver is made with — how framer-motion's whileInView decides): the import watches the same */
  var Watcher = window.IntersectionObserver;
  if (Watcher) {
    var Watching = function (callback, options) {
      var io = new Watcher(callback, options), observe = io.observe;
      var t = options && options.threshold, how = { m: (options && options.rootMargin) || '', t: +(Array.isArray(t) ? t[0] : t) || 0 };
      io.observe = function (el) {
        try { var d = M.on && el && el.nodeType === 1 && rec(el); if (d) d.io = how; } catch (e) { /* watched regardless */ }
        return observe.apply(io, arguments);
      };
      return io;
    };
    Watching.prototype = Watcher.prototype;
    window.IntersectionObserver = Watching;
  }

  new MutationObserver(function (list) {
    if (!M.on || !M.walk) return;
    list.forEach(function (m) {
      var el = m.target;
      if (el.nodeType !== 1 || !el.style) return;
      var d = rec(el);
      if (!d) return;
      var p = progress(el);
      PROPS.forEach(function (k) { see(d, k, el.style.getPropertyValue(k), p); });
    });
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] });

  /* an animation run by the scroll changes no style: its values are read from what is drawn, at each step of
     the walk and through each such element's own way across the window (M.tied, recordMotion) */
  M.sample = function () {
    M.els.forEach(function (el) {
      var d = M.data.get(el), cs = null;
      d.runs.forEach(function (r) {
        if (!r.scroll || !r.kf) return;
        cs = cs || getComputedStyle(el);
        var p = progress(el);
        Object.keys(r.kf[0] || {}).forEach(function (k) {
          var css = cssName(k);
          if (PROPS.indexOf(css) !== -1) see(d, css, cs.getPropertyValue(css), p, true);
        });
      });
    });
  };
  M.tied = function () {
    return M.els.filter(function (el) { return el.isConnected && M.data.get(el).runs.some(function (r) { return r.scroll; }); }).map(place);
  };

  /* elements that look as if they were still to move in (hidden, uncovered by a clip, moved aside) and have not */
  M.waiting = function () {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('[style*="opacity"], [style*="clip-path"], [style*="transform"]'), function (el) {
      var d = M.data.get(el);
      if (d && (d.runs.length || Object.keys(d.seen).length)) return;
      var s = el.getAttribute('style') || '';
      if (/opacity:\s*0(?![.\d])|clip-path|translate/.test(s) && el.getClientRects().length) out.push(el);
    });
    return out;
  };

  function keyframes(list) {
    return (list || []).map(function (f) {
      var o = {};
      Object.keys(f).forEach(function (k) {
        if (k === 'offset' || k === 'computedOffset' || k === 'composite') return;
        if (k === 'easing') { if (f.easing && f.easing !== 'linear') o.easing = f.easing; return; }
        o[k] = typeof f[k] === 'number' ? f[k] : String(f[k]).trim();
      });
      if (typeof f.computedOffset === 'number') o.offset = Math.round(f.computedOffset * 1000) / 1000;
      return o;
    });
  }
  function samples(list) {
    var byP = {};
    list.forEach(function (x) { byP[Math.round(x.p)] = x.v; });
    var ps = Object.keys(byP).map(Number).sort(function (a, b) { return a - b; });
    if (ps.length > MAX_SAMPLES) {
      var keep = [];
      for (var i = 0; i < MAX_SAMPLES; i++) keep.push(ps[Math.round(i * (ps.length - 1) / (MAX_SAMPLES - 1))]);
      ps = keep;
    }
    return ps.map(function (p) { return [p, byP[p]]; });
  }

  M.write = function () {
    M.on = false;
    var written = 0;
    M.els.forEach(function (el) {
      if (written >= MAX_ELEMENTS || !el.isConnected) return;
      var d = M.data.get(el), m = {}, enter = [], loops = [], scroll = {}, moved = {};
      var done = d.runs.filter(function (r) { return r.timing && !r.scroll && r.kf && r.kf.length >= 2; });
      var once = done.filter(function (r) { return !(r.timing.iterations > 1); });
      /* an entrance's delay counts from what set it off: the page opening, or the element coming into view */
      var trigger = once.length && once[0].scrolled ? once[0].t : M.first;
      done.forEach(function (r) {
        var x = { k: keyframes(r.kf), d: Math.round(r.timing.duration) || 0 };
        if (r.easing && r.easing !== 'linear') x.e = r.easing.length > 600 ? 'ease-out' : r.easing;
        var n = r.timing.iterations;
        if (n === Infinity || n > 1) {
          if (r.timing.delay > 0) x.w = Math.min(Math.round(r.timing.delay), 5000);
          x.i = n === Infinity ? 'inf' : n;
          if (r.timing.direction && r.timing.direction !== 'normal') x.r = r.timing.direction;
          loops.push(x);
          return;
        }
        var w = Math.round((typeof r.start === 'number' ? r.start : r.t) + (r.timing.delay || 0) - trigger);
        if (w > 0) x.w = Math.min(w, 5000);
        enter.push(x);
        Object.keys(x.k[0]).forEach(function (k) { if (k !== 'offset' && k !== 'easing') moved[cssName(k)] = 1; });
      });
      /* a value an animation run by the scroll draws is read only from the drawing: the page's script may hold
         another in the style attribute all along */
      var drawn = {};
      d.runs.forEach(function (r) { if (r.scroll && r.kf && r.kf[0]) Object.keys(r.kf[0]).forEach(function (k) { drawn[cssName(k)] = 1; }); });
      /* tied to the scroll: read at three places or more, with more than one value, and about one value to a
         place — an entrance timed by the clock runs through many values at each place it passes */
      Object.keys(d.seen).forEach(function (k) {
        var all = drawn[k] ? d.seen[k].filter(function (x) { return x.drawn; }) : d.seen[k], places = {}, pairs = {}, values = {};
        all.forEach(function (x) { var at = Math.round(x.p); places[at] = 1; pairs[at + ' ' + x.v] = 1; values[x.v] = 1; });
        var nPlaces = Object.keys(places).length;
        if (moved[k] || nPlaces < 3 || Object.keys(values).length < 2 || Object.keys(pairs).length > nPlaces * 3) return;
        scroll[k] = samples(all);
      });
      if (enter.length) {
        m.on = once[0].scrolled ? 'view' : 'load';
        /* set off by the element itself coming into view, or by the nearest container the page watched */
        if (m.on === 'view') {
          for (var w = el, up = 0; w && up <= 6; w = w.parentElement, up++) {
            var dw = M.data.get(w);
            if (dw && dw.io) { m.v = { m: dw.io.m, t: dw.io.t }; if (up) m.v.u = up; break; }
          }
        }
        m.a = enter;
      }
      if (loops.length) m.l = loops;
      if (Object.keys(scroll).length) m.s = scroll;
      if (!m.a && !m.l && !m.s) return;
      var json = JSON.stringify(m);
      if (json.length > MAX_ATTR) return;
      /* the element as its entrance leaves it */
      (m.a || []).forEach(function (x) {
        var last = x.k[x.k.length - 1];
        Object.keys(last).forEach(function (k) { if (k !== 'offset' && k !== 'easing') el.style[k] = last[k]; });
      });
      el.setAttribute('data-rv-motion', json);
      written++;
    });
    return written;
  };
}

/* The end of the walk (settlePage): what is late brought into view, the page put back at the top, the entrances
   left to finish, and each element's motion written on it (motionRecorder). A page opened without the
   recorder is only put back at the top. */
async function recordMotion(page) {
  return page.evaluate(async function (maxLate) {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    var M = window.__rvMotion;
    if (!M) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      await wait(900);
      return 0;
    }
    function frame() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
    var late = M.waiting().slice(0, maxLate);
    for (var i = 0; i < late.length; i++) {
      if (!late[i].isConnected) continue;
      late[i].scrollIntoView({ block: 'center', behavior: 'instant' });
      await wait(160);
      M.sample();
    }
    /* an animation run by the scroll, read in fine steps across the element's way through the window */
    var vh = window.innerHeight;
    var tied = M.tied().slice(0, 12);
    for (var j = 0; j < tied.length; j++) {
      for (var s = 0; s <= 24; s++) {
        window.scrollTo({ top: Math.max(0, tied[j].top - vh + (s / 24) * (vh + tied[j].h)), behavior: 'instant' });
        await frame();
        M.sample();
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    await wait(300);
    M.sample();
    var running = document.getAnimations().filter(function (a) {
      try { return a.playState === 'running' && a.timeline === document.timeline && isFinite(a.effect.getComputedTiming().endTime); } catch (e) { return false; }
    });
    await Promise.race([Promise.all(running.map(function (a) { return a.finished.catch(function () {}); })), wait(4000)]);
    M.sample();
    return M.write();
  }, SETTLE_MAX_LATE_REVEALS);
}

/* opts.budgetMs: less than SETTLE_BUDGET_MS when the render as a whole has less time left (capturePage) */
async function settlePage(page, opts) {
  var budget = opts && opts.budgetMs > 0 ? Math.min(opts.budgetMs, SETTLE_BUDGET_MS) : SETTLE_BUDGET_MS;
  var deadline = Date.now() + budget;

  /* which tab each tab list opens on, before anything moves (a set that moves on by itself has drifted by the
     time the page has been walked through) */
  await page.evaluate(function () {
    window.__rvTabStart = Array.prototype.map.call(document.querySelectorAll('[role="tablist"]'), function (l) {
      var tabs = Array.prototype.slice.call(l.querySelectorAll('[role="tab"]'));
      for (var i = 0; i < tabs.length; i++) if (tabs[i].getAttribute('aria-selected') === 'true') return i;
      return -1;
    });
  });

  /* half a window at a time, long enough at each step for what comes into view to start moving (and for a
     motion tied to the scroll to be read there) */
  await page.evaluate(async function (maxSteps) {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    var M = window.__rvMotion;
    if (M) M.walk = performance.now();
    var step = Math.max(300, Math.round(window.innerHeight * 0.5));
    /* at once, whatever the page's scroll-behavior: each step is read where it was meant to be */
    for (var i = 0, y = 0; i < maxSteps && y < document.documentElement.scrollHeight; i++, y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await wait(180);
      if (M) M.sample();
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await wait(300);
    if (M) M.sample();
  }, SETTLE_MAX_SCROLL_STEPS);
  try { await recordMotion(page); } catch (err) {
    console.error('scrape: the page\'s motion could not be recorded (' + err.message + ').');
    await page.evaluate(function () { window.scrollTo({ top: 0, behavior: 'instant' }); });
  }

  /* The top bar, at the top of the page and scrolled: the classes of the bar and everything in it, in both. */
  await page.evaluate(async function () {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function bar() {
      var hs = document.querySelectorAll('header, nav, [role="banner"]');
      for (var i = 0; i < hs.length; i++) {
        var top = null;
        for (var el = hs[i]; el && el !== document.body; el = el.parentElement) {
          var p = getComputedStyle(el).position;
          if (p === 'fixed' || p === 'sticky') top = el;
        }
        if (!top) continue;
        var r = top.getBoundingClientRect();
        if (r.top <= 40 && r.height > 0 && r.height < window.innerHeight / 2) return top;
      }
      return null;
    }
    function classes(el) {
      return [el].concat(Array.prototype.slice.call(el.querySelectorAll('*'))).map(function (e) { return e.getAttribute('class') || ''; });
    }
    var atTop = bar();
    if (!atTop) return;
    var first = classes(atTop);
    var room = document.documentElement.scrollHeight - window.innerHeight;
    if (room < 200) return;
    /* scrolled down in a few steps, as a visitor would, and given up to 3 s to change (a page's script may
       wait for a frame, a timer or a transition before it does) */
    var target = Math.min(window.innerHeight * 2, room), scrolled = null;
    for (var s = 1; s <= 4; s++) { window.scrollTo(0, Math.round(target * s / 4)); await wait(150); }
    for (var t = 0; t < 12 && !scrolled; t++) {
      await wait(250);
      if (bar() !== atTop) continue;
      var now = classes(atTop);
      if (now.length === first.length && now.some(function (c, i) { return c !== first[i]; })) scrolled = now;
    }
    window.scrollTo(0, 0);
    await wait(700);
    if (!scrolled || scrolled.length !== first.length) return;
    if (!scrolled.some(function (c, i) { return c !== first[i]; })) return;
    window.__rvBar = { el: atTop, scrolled: scrolled };
  });

  /* Tabs: each tab chosen in turn, and what it shows kept. */
  await page.evaluate(async function (o) {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function late() { return Date.now() > o.deadline; }
    function arr(list) { return Array.prototype.slice.call(list); }
    function scopeOf(list) { return list.closest('section, article, [aria-roledescription="carousel"]') || list.parentElement; }
    function tabsOf(list) { return arr(list.querySelectorAll('[role="tab"]')).slice(0, o.maxTabs); }
    /* the panel the tabs name, else everything after the tab list in its box */
    function region(list, scope) {
      var id = tabsOf(list)[0].getAttribute('aria-controls'), p = id && document.getElementById(id);
      if (p && !p.contains(list) && scope.contains(p)) return [p];
      var nodes = [];
      for (var s = list.nextElementSibling; s; s = s.nextElementSibling) if (!/^(SCRIPT|STYLE|TEMPLATE)$/.test(s.tagName)) nodes.push(s);
      return nodes;
    }
    function inside(nodes, el) { return nodes.some(function (n) { return n === el || n.contains(el); }); }
    /* Everything around the panel, by where it stands (its place among its parent's children, the panel left
       out, and its tag): { key: [class, parent key, place, markup] }. An element a tab has and another has not
       (a progress bar drawn in the chosen tab only) keeps everything else where it was. */
    function outside(scope, nodes) {
      var out = {};
      (function walk(el, key) {
        var place = 0;
        arr(el.children).forEach(function (c) {
          if (inside(nodes, c)) return;
          var k = key + '/' + (place++) + c.tagName;
          out[k] = [c.getAttribute('class') || '', key, place - 1, c.outerHTML];
          walk(c, k);
        });
      })(scope, '');
      return out;
    }
    function pathOf(root, el) {
      var p = [];
      for (; el && el !== root; el = el.parentElement) p.unshift(Array.prototype.indexOf.call(el.parentElement.children, el));
      return el === root ? p : null;
    }
    function atPath(root, p) {
      var el = root;
      for (var i = 0; i < p.length && el; i++) el = el.children[p[i]];
      return el;
    }
    function subtree(el) { return [el].concat(arr(el.querySelectorAll('*'))); }
    /* a row's button and what is in it: the classes of each element, and the text of each that holds only text */
    function looks(b) {
      return subtree(b).map(function (e) { return [e.getAttribute('class') || '', e.children.length ? null : e.textContent]; });
    }
    /* what changes once the row is open (its sign turned, "+" become "×"): [place, classes or null, text or null] */
    function openLook(closed, b) {
      var now = looks(b);
      if (now.length !== closed.length) return [];
      var out = [];
      now.forEach(function (x, i) {
        var cls = x[0] !== closed[i][0] ? x[0] : null, text = x[1] !== closed[i][1] ? x[1] : null;
        if (cls !== null || text !== null) out.push([i, cls, text]);
      });
      return out;
    }
    /* The rows in a panel whose own panels only exist while open: opened and closed again, and where their
       panel went noted (after the element it followed), with how the button looks open. The page's script
       may draw the rows again on every click: they are found again by their place each time. */
    async function openRows(getNodes) {
      var out = [];
      function btns() {
        var all = [];
        getNodes().forEach(function (n) { all = all.concat(arr(n.querySelectorAll('button[aria-expanded]'))); });
        return all.filter(function (b) { return !b.hasAttribute('aria-haspopup'); }).slice(0, 24);
      }
      var total = btns().length;
      for (var i = 0; i < total && !late(); i++) {
        var b = btns()[i];
        if (!b || b.getAttribute('aria-expanded') === 'true') continue;
        var ctrl = b.getAttribute('aria-controls');
        if (ctrl ? document.getElementById(ctrl) : b.nextElementSibling) continue;   // its panel is in the page already
        var closed = looks(b);
        b.click();
        await wait(450);
        b = btns()[i];
        var panel = b && (ctrl ? document.getElementById(ctrl) : b.nextElementSibling);
        var after = panel && panel.previousElementSibling, rec = null;
        if (b && b.getAttribute('aria-expanded') === 'true' && panel && after && !/^(BUTTON|A)$/.test(panel.tagName)) {
          var nodes = getNodes();
          for (var n = 0; n < nodes.length && !rec; n++) {
            var p = nodes[n] === after ? null : pathOf(nodes[n], after);
            var bp = nodes[n] === b ? [] : pathOf(nodes[n], b);
            if (p && bp) rec = { node: n, path: p, html: panel.outerHTML, button: bp, look: openLook(closed, b) };
          }
        }
        if (b && b.getAttribute('aria-expanded') === 'true') { b.click(); await wait(300); }
        if (rec) out.push(rec);
      }
      return out;
    }
    function snapshot(nodes, rows) {
      var clones = nodes.map(function (n) { return n.cloneNode(true); });
      var at = rows.map(function (r) { return atPath(clones[r.node], r.path); });
      var btn = rows.map(function (r) { return atPath(clones[r.node], r.button); });
      rows.forEach(function (r, i) {
        if (btn[i]) {
          var els = subtree(btn[i]);
          r.look.forEach(function (x) {
            if (!els[x[0]]) return;
            if (x[1] !== null) els[x[0]].setAttribute('data-rv-open-class', x[1]);
            if (x[2] !== null) els[x[0]].setAttribute('data-rv-open-text', x[2]);
          });
        }
        if (!at[i]) return;
        at[i].insertAdjacentHTML('afterend', r.html);
        var p = at[i].nextElementSibling;
        p.style.height = '0px'; p.style.opacity = '0'; p.style.overflow = 'hidden';
      });
      return clones.map(function (c) { return c.outerHTML; });
    }
    function autoMs(list, scope) {
      var ms = 0;
      [list].concat(arr(list.querySelectorAll('*'))).forEach(function (el) {
        var cs = getComputedStyle(el);
        if (!cs.animationName || cs.animationName === 'none' || cs.animationIterationCount === 'infinite') return;
        var d = parseFloat(cs.animationDuration) * (/ms$/.test(cs.animationDuration) ? 1 : 1000);
        if (d >= 2000 && d <= 60000) ms = Math.max(ms, Math.round(d));
      });
      return ms;
    }

    var start = window.__rvTabStart || [];
    var lists = arr(document.querySelectorAll('[role="tablist"]'));
    var groups = [];
    for (var li = 0; li < lists.length && groups.length < o.maxLists && !late(); li++) {
      var list = lists[li];
      if (list.closest('header, nav')) continue;
      var tabs = tabsOf(list);
      if (tabs.length < 2) continue;
      var scope = scopeOf(list);
      /* each tab naming a panel of its own that is already in the page: nothing to capture */
      var own = tabs.map(function (t) { return t.getAttribute('aria-controls'); });
      if (own.every(function (id, i) { return id && own.indexOf(id) === i && document.getElementById(id); })) continue;
      var startK = start[li] >= 0 && start[li] < tabs.length ? start[li] : 0;
      var states = [];
      for (var k = 0; k < tabs.length && !late(); k++) {
        tabsOf(list)[k].click();
        await wait(650);
        if (tabsOf(list)[k].getAttribute('aria-selected') !== 'true') { tabsOf(list)[k].click(); await wait(650); }
        if (tabsOf(list)[k].getAttribute('aria-selected') !== 'true') break;
        var nodes = region(list, scope);
        if (!nodes.length) break;
        var rows = await openRows(function () { return region(list, scope); });
        nodes = region(list, scope);
        states.push({ html: snapshot(nodes, rows), classes: outside(scope, nodes) });
      }
      tabsOf(list)[startK].click();
      await wait(650);
      if (states.length !== tabs.length) continue;      // not every tab could be read: the page keeps the one on show
      groups.push({ list: list, n: tabs.length, startK: startK, states: states, auto: autoMs(list, scope) });
    }
    window.__rvTabs = groups;
    window.scrollTo(0, 0);
  }, { deadline: deadline, maxLists: SETTLE_MAX_TABLISTS, maxTabs: SETTLE_MAX_TABS });

  /* Carousels that keep only the cards on show in the page: a previous and a next button near a region
     holding one row (in the same box, or a few boxes up: the buttons can sit in the section's heading). Next
     is pressed until no new card turns up, and the row is rebuilt with every card in it, as a strip that
     scrolls sideways (data-rv-carousel / -track / -prev / -next: et-runtime.js moves it on the live page, and
     the editor shows the whole strip). */
  await page.evaluate(async function (o) {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    var found = [];
    var nexts = Array.prototype.slice.call(document.querySelectorAll('button[aria-label]')).filter(function (b) {
      var bar = b.closest('header, nav');      // the site's bar, not a section's own heading
      return /^next\b/i.test(b.getAttribute('aria-label')) && !(bar && !bar.closest('section, article'));
    }).slice(0, 12);
    for (var n = 0; n < nexts.length && Date.now() < o.deadline; n++) {
      var next = nexts[n], box = next.parentElement, holder = null;
      for (var up = 0; box && up < 4; box = box.parentElement, up++) {
        holder = box.querySelector('[role="region"], [aria-roledescription="carousel"]');
        if (holder || /^(SECTION|ARTICLE|MAIN|BODY)$/.test(box.tagName)) break;
      }
      if (!holder) continue;
      var row = function () { return holder.querySelector('[data-carousel-layer="current"]') || holder.querySelector('[data-carousel-layer]') || holder.firstElementChild; };
      if (!row() || !row().children.length) continue;
      var first = row().firstElementChild.getBoundingClientRect().width;
      var gap = parseFloat(getComputedStyle(row()).columnGap) || 16;
      var cards = [], seen = {}, stale = 0, onShow = row().children.length;
      for (var i = 0; i < o.maxPages && stale < 2 && Date.now() < o.deadline; i++) {
        var fresh = 0;
        Array.prototype.forEach.call(row().children, function (card) {
          var key = (card.textContent || '').replace(/\s+/g, ' ').trim() || card.outerHTML;
          if (seen[key]) return;
          seen[key] = true; cards.push(card.outerHTML); fresh++;
        });
        stale = fresh ? 0 : stale + 1;
        next.click();
        await wait(600);
      }
      if (cards.length <= onShow || !first) continue;          // everything was in the page already
      found.push({ next: next, box: box, holder: holder, cards: cards, first: Math.round(first), gap: gap });
    }
    /* The rows are rebuilt at the very last moment, in the same step that reads the page (finishPage): the
       page's own script draws a row again whenever it likes (a timer, another click), and would put its
       few cards back over ours. */
    window.__rvCarousels = found;
    window.scrollTo(0, 0);
  }, { maxPages: 40, deadline: deadline });

  await page.evaluate(async function (o) {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    /* the tabs' panels were read with their rows open, tab by tab (above) */
    var tabbed = (window.__rvTabs || []).map(function (g) { return g.list.closest('section, article, [aria-roledescription="carousel"]') || g.list.parentElement; });
    var rows = Array.prototype.slice.call(document.querySelectorAll('button[aria-expanded]')).filter(function (b) {
      return !b.closest('header, nav, [role="tabpanel"]') && !b.hasAttribute('aria-haspopup') &&
        !tabbed.some(function (s) { return s.contains(b); });
    }).slice(0, o.maxRows);
    if (!rows.length) return;
    var wasOpen = rows.filter(function (b) { return b.getAttribute('aria-expanded') === 'true'; });
    var copies = [];
    function panelOf(b) { var c = b.getAttribute('aria-controls'); return c ? document.getElementById(c) : b.nextElementSibling; }
    function subtree(el) { return [el].concat(Array.prototype.slice.call(el.querySelectorAll('*'))); }
    function looks(b) { return subtree(b).map(function (e) { return [e.getAttribute('class') || '', e.children.length ? null : e.textContent]; }); }
    for (var i = 0; i < rows.length && Date.now() < o.deadline; i++) {
      var b = rows[i];
      if (b.getAttribute('aria-expanded') === 'true' || panelOf(b)) continue;   // its panel is in the page already
      var closed = looks(b);
      b.click();
      await wait(650);
      var panel = panelOf(b), after = panel && panel.previousElementSibling;
      if (b.getAttribute('aria-expanded') === 'true' && panel && after && !/^(BUTTON|A)$/.test(panel.tagName)) {
        /* how the button looks open (its sign turned), for et-runtime.js to give it */
        var look = looks(b);
        copies.push({ row: b, after: after, html: panel.outerHTML, look: look.length === closed.length ? look.map(function (x, k) { return [x[0] !== closed[k][0] ? x[0] : null, x[1] !== closed[k][1] ? x[1] : null]; }) : [] });
      }
    }
    // back to how the page opens
    for (var j = 0; j < rows.length; j++) {
      var open = rows[j].getAttribute('aria-expanded') === 'true';
      if (open !== (wasOpen.indexOf(rows[j]) !== -1)) { rows[j].click(); await wait(650); }
    }
    copies.forEach(function (c) {
      if (!c.after.isConnected || panelOf(c.row) || c.row.getAttribute('aria-expanded') === 'true') return;
      c.after.insertAdjacentHTML('afterend', c.html);
      var p = c.after.nextElementSibling;
      p.style.height = '0px'; p.style.opacity = '0'; p.style.overflow = 'hidden';
      var els = subtree(c.row);
      if (els.length === c.look.length) c.look.forEach(function (x, k) {
        if (x[0] !== null) els[k].setAttribute('data-rv-open-class', x[0]);
        if (x[1] !== null) els[k].setAttribute('data-rv-open-text', x[1]);
      });
    });
    window.scrollTo(0, 0);
    await wait(300);
  }, { maxRows: SETTLE_MAX_ROWS, deadline: deadline });
}

/* Runs in the page, in one go: what settlePage prepared is put into the markup and the markup is read, with
   no moment in between for the page's own script to redraw anything. */
function finishPage() {
  try {
    (window.__rvCarousels || []).forEach(function (c) {
      if (!c.holder.isConnected) return;
      var keep = c.holder.querySelector('[data-carousel-layer="current"]') || c.holder.querySelector('[data-carousel-layer]') || c.holder.firstElementChild;
      if (!keep) return;
      Array.prototype.slice.call(c.holder.children).forEach(function (n) { if (n !== keep) n.remove(); });
      keep.innerHTML = c.cards.join('');
      Array.prototype.forEach.call(keep.children, function (card) { card.style.flex = '0 0 ' + c.first + 'px'; card.style.scrollSnapAlign = 'start'; });
      keep.style.cssText = 'display:flex;gap:' + c.gap + 'px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;width:100%';
      keep.setAttribute('data-rv-carousel-track', '');
      c.box.setAttribute('data-rv-carousel', '');
      c.next.setAttribute('data-rv-carousel-next', '');
      Array.prototype.forEach.call(c.box.querySelectorAll('button[aria-label]'), function (b) {
        if (/^previous\b/i.test(b.getAttribute('aria-label'))) b.setAttribute('data-rv-carousel-prev', '');
      });
    });
  } catch (e) { /* the page is read as it stands */ }
  try {
    var bar = window.__rvBar;
    if (bar && bar.el.isConnected) {
      var els = [bar.el].concat(Array.prototype.slice.call(bar.el.querySelectorAll('*')));
      if (els.length === bar.scrolled.length) {
        els.forEach(function (el, i) {
          if ((el.getAttribute('class') || '') !== bar.scrolled[i]) el.setAttribute('data-rv-scrolled-class', bar.scrolled[i]);
        });
      }
    }
  } catch (e) { /* the bar stays as it is at the top of the page */ }
  (window.__rvTabs || []).forEach(function (g, gi) {
    try {
      var list = g.list;
      if (!list.isConnected) return;
      var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]')).slice(0, g.n);
      if (tabs.length !== g.n) return;
      var scope = list.closest('section, article, [aria-roledescription="carousel"]') || list.parentElement;
      var id = tabs[0].getAttribute('aria-controls'), named = id && document.getElementById(id), nodes = [];
      if (named && !named.contains(list) && scope.contains(named)) nodes = [named];
      else for (var s = list.nextElementSibling; s; s = s.nextElementSibling) if (!/^(SCRIPT|STYLE|TEMPLATE)$/.test(s.tagName)) nodes.push(s);
      if (!nodes.length) return;
      var key = String(gi), made = [], frag = document.createDocumentFragment(), tpl = document.createElement('template');
      g.states.forEach(function (st, k) {
        st.html.forEach(function (h) {
          tpl.innerHTML = h;
          var el = tpl.content.firstElementChild;
          if (!el) return;
          el.setAttribute('data-rv-tabpanel', key + ':' + k);
          if (k !== g.startK) { el.setAttribute('hidden', ''); el.removeAttribute('id'); }
          frag.appendChild(el);
          made.push(el);
        });
      });
      nodes[0].parentNode.insertBefore(frag, nodes[0]);
      nodes.forEach(function (n) { n.remove(); });
      tabs.forEach(function (t, k) {
        t.setAttribute('data-rv-tab', key + ':' + k);
        t.setAttribute('aria-selected', k === g.startK ? 'true' : 'false');
      });
      list.setAttribute('data-rv-tablist', key);
      if (g.auto) list.setAttribute('data-rv-tab-auto', String(g.auto));
      /* around the panels: the page as it is now (the opening tab), by the same keys as when each tab was read */
      var now = {};
      (function walk(el, k0) {
        var place = 0;
        Array.prototype.forEach.call(el.children, function (c) {
          if (made.some(function (m) { return m === c || m.contains(c); })) return;
          var k = k0 + '/' + (place++) + c.tagName;
          now[k] = c;
          walk(c, k);
        });
      })(scope, '');
      var keys = {};
      g.states.forEach(function (st) { Object.keys(st.classes).forEach(function (k) { keys[k] = 1; }); });
      var adds = [];
      Object.keys(keys).forEach(function (k) {
        var per = g.states.map(function (st) { return st.classes[k]; });
        var has = [];
        per.forEach(function (x, i) { if (x) has.push(i); });
        if (has.length === g.n) {
          var cls = per.map(function (x) { return x[0]; });
          if (now[k] && cls.some(function (c) { return c !== cls[0]; })) {
            now[k].setAttribute('data-rv-tab-classes', JSON.stringify({ g: key, c: cls }));
            now[k].setAttribute('class', cls[g.startK]);
          }
          return;
        }
        /* only some tabs have it: shown with those */
        var only = JSON.stringify({ g: key, k: has });
        if (now[k]) { now[k].setAttribute('data-rv-tab-only', only); return; }
        var first = per[has[0]];
        if (now[first[1]] || first[1] === '') adds.push({ parent: first[1] === '' ? scope : now[first[1]], place: first[2], html: first[3], only: only });
      });
      adds.forEach(function (x) {
        if (!x.parent) return;
        tpl.innerHTML = x.html;
        var el = tpl.content.firstElementChild;
        if (!el) return;
        el.setAttribute('data-rv-tab-only', x.only);
        el.setAttribute('hidden', '');
        var kids = Array.prototype.filter.call(x.parent.children, function (c) { return !made.some(function (m) { return m === c; }); });
        x.parent.insertBefore(el, kids[x.place] || null);
      });
    } catch (e) { /* this tab set is read as it stands */ }
  });
  return document.documentElement.outerHTML;
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

// Renders `url` in an open tab and returns its markup as captured (settlePage, finishPage). Exported, with
// those two, so the capture can be run from a script with a Chrome of its own (tools/reimport-lovable.js).
// It refuses (rejects with .code, see ERRORS) what is not a site: an address that could not be reached or answered
// an HTTP error (.httpStatus), a page with nothing on it or a host's "no site here" page, markup too large.
//   opts: { deadlineAt: the time the whole render must be done by (the walk-through is shortened to fit),
//           refused(url) -> true when the guard refused that address (it is then 'blocked-address') }
async function capturePage(page, url, opts) {
  opts = opts || {};
  await page.setViewport({ width: 1440, height: 900 });
  /* a page's service worker could answer for the network; a download is never what is wanted */
  try { await page.setBypassServiceWorker(true); } catch (e) { /* an older puppeteer: the guard still applies */ }
  try { await (await page.createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'deny' }); } catch (e) { /* not supported here */ }
  await page.evaluateOnNewDocument(motionRecorder);
  /* the status of the page itself, after its redirects — kept even when goto() gives up waiting for the network
     to go quiet (a site with continuous analytics pings never does) */
  var main = { status: 0 };
  page.on('response', function (r) {
    try {
      if (r.frame() !== page.mainFrame() || !r.request().isNavigationRequest()) return;
      var s = r.status();
      if (s >= 300 && s < 400) return;
      main.status = s;
    } catch (e) { /* a response of a frame already gone */ }
  });
  var response = null;
  try {
    response = await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  } catch (err) {
    // A site that never truly goes network-idle is still captured as it stands — but only when its page did come
    // (main.status below): a name that does not resolve, a refused address or a dead host is not a capture.
    console.error('scrape: navigation to "' + url + '" did not fully settle (' + err.message + ').');
  }
  if (response) { try { main.status = response.status() || main.status; } catch (e) { /* kept as seen */ } }
  /* the page itself, or where it redirected, refused by the guard (a plain-http refusal comes back as the guard's
     own 403, which must not be taken for the site's answer) */
  var landed = '';
  try { landed = page.url(); } catch (e) { landed = ''; }
  if (opts.refused && (opts.refused(url) || (landed && opts.refused(landed)))) throw captureError('blocked-address');
  if (!main.status) throw captureError('unreachable');
  if (main.status >= 400) throw captureError('source-http-error', { httpStatus: main.status });
  await sleep(3500); // let an intro animation play out
  var verdict = captureVerdict(await page.evaluate(pageFacts));
  if (verdict) throw captureError(verdict);
  var left = opts.deadlineAt ? opts.deadlineAt - Date.now() - 8000 : 0;
  try { await settlePage(page, { budgetMs: left > 0 ? left : 0 }); } catch (err) {
    // best effort: a page this cannot walk through is still captured as it stands
    console.error('scrape: could not settle "' + url + '" before capture (' + err.message + ').');
  }
  var html = await page.evaluate(finishPage);
  if (Buffer.byteLength(String(html || ''), 'utf8') > MAX_HTML_BYTES) throw captureError('capture-too-large');
  return html;
}

// Launches headless Chrome behind the guard (startGuard), renders `url` and returns the captured markup.
// Closes the browser on every path — success, a refusal, launch failure, the time limit, the caller leaving — and
// kills it if it will not close; the guard is closed with it. If the time limit fires before Chrome has even
// finished launching, this waits for that launch attempt to settle before closing it, so a browser that finishes
// launching just after the limit is still closed instead of orphaned.
//   opts: { deadlineAt, aborted: a Promise that rejects when the caller has gone, lookup (tests) }
async function scrapeUrl(url, opts) {
  opts = opts || {};
  var limitMs = Math.max(1000, Math.min(TOTAL_TIMEOUT_MS, opts.deadlineAt ? opts.deadlineAt - Date.now() : TOTAL_TIMEOUT_MS));
  var deadlineAt = Date.now() + limitMs;
  var guard = await startGuard({ maxBytes: MAX_RENDER_BYTES, lookup: opts.lookup });
  var browser = null;

  async function closeBrowser() {
    if (!browser) return;
    var b = browser, proc = null;
    browser = null;
    try { proc = b.process(); } catch (e) { proc = null; }
    var closed = await Promise.race([b.close().then(function () { return true; }, function (e) {
      console.error('scrape: error closing headless Chrome: ' + e.message);
      return false;
    }), sleep(CLOSE_TIMEOUT_MS).then(function () { return false; })]);
    if (!closed && proc && !proc.killed) { try { proc.kill('SIGKILL'); } catch (e) { /* already gone */ } }
  }

  var work = (async function () {
    browser = await require('puppeteer').launch({
      headless: true,
      // --disable-dev-shm-usage: Cloud Run's default /dev/shm is tiny; without this, Chrome can crash
      // outright on real pages. --no-sandbox/--disable-setuid-sandbox: Chrome's own sandbox needs kernel
      // privileges this container doesn't grant -- the standard, well-documented flags for running
      // headless Chrome inside a Docker container (see README.md); the process runs as a non-root user.
      // --proxy-server / --proxy-bypass-list=<-loopback>: every connection, loopback included, goes through the
      // guard. WebRTC may not use UDP outside the proxy.
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--proxy-server=http://127.0.0.1:' + guard.port, '--proxy-bypass-list=<-loopback>',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--no-first-run']
    });
    var page = await browser.newPage();
    return capturePage(page, url, { deadlineAt: deadlineAt, refused: guard.refusedHost });
  })();

  var timer;
  var timeoutPromise = new Promise(function (_resolve, reject) {
    timer = setTimeout(function () { reject(captureError('timeout')); }, limitMs);
  });
  var racers = [work, timeoutPromise];
  if (opts.aborted) racers.push(opts.aborted);

  try {
    return await Promise.race(racers);
  } finally {
    clearTimeout(timer);
    await Promise.race([work.catch(function () {}), sleep(CLOSE_TIMEOUT_MS)]); // let a still-in-flight launch settle so `browser` is set
    await closeBrowser();
    var st = guard.stats();
    if (st.refused.length) console.error('scrape: refused for "' + url + '": ' + st.refused.slice(0, 20).join(', '));
    await guard.close();
  }
}

// ---------- plain HTTP plumbing ----------

function sendJson(res, status, obj) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* gone */ } return; }
  var body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function sendError(res, err) {
  var code = err && ERRORS[err.code] ? err.code : 'render-failed';
  var out = { error: ERRORS[code][1], code: code };
  if (err && err.httpStatus) out.httpStatus = err.httpStatus;
  sendJson(res, ERRORS[code][0], out);
}

/* The secret, in constant time: both sides are hashed first, so neither its length nor where it differs shows. */
function secretMatches(provided, secret) {
  if (typeof provided !== 'string' || !provided || !secret) return false;
  var a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  var b = crypto.createHash('sha256').update(String(secret), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/* cb(text) or cb(null) once more than max bytes have arrived (the rest is not read) */
function readBody(req, max, cb) {
  var chunks = [], size = 0, done = false;
  function finish(v) { if (!done) { done = true; cb(v); } }
  if (+req.headers['content-length'] > max) { req.resume(); return finish(null); }
  req.on('data', function (c) {
    if (done) return;
    size += c.length;
    if (size > max) { req.resume(); return finish(null); }
    chunks.push(c);
  });
  req.on('end', function () { finish(Buffer.concat(chunks).toString('utf8')); });
  req.on('error', function () { finish(''); });
}

/* The service. opts (tests): { secret, render(url, { deadlineAt, aborted }), check(url) -> Promise<null|{code}>,
   maxWaiting, requestBudgetMs, minRenderMs } */
function createService(opts) {
  opts = opts || {};
  var secret = opts.secret != null ? opts.secret : (process.env.SCRAPER_SECRET || '');
  var render = opts.render || scrapeUrl;
  var check = opts.check || checkUrl;
  var budgetMs = opts.requestBudgetMs || REQUEST_BUDGET_MS, minRenderMs = opts.minRenderMs || MIN_RENDER_MS;
  var gate = createGate(1, opts.maxWaiting != null ? opts.maxWaiting : MAX_WAITING);

  var server = http.createServer(function (req, res) {
    var started = Date.now(), path = String(req.url || '').split('?')[0];
    if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/health' || path === '/healthz')) return sendJson(res, 200, { ok: true });
    if (req.method !== 'POST' || path !== '/scrape') return sendError(res, { code: 'not-found' });
    if (!secret) {
      console.error('scrape: SCRAPER_SECRET is not set on this service -- refusing all requests until it is.');
      return sendError(res, { code: 'not-configured' });
    }
    if (!secretMatches(req.headers['x-scraper-secret'], secret)) { req.resume(); return sendError(res, { code: 'unauthorized' }); }

    readBody(req, MAX_BODY_BYTES, function (raw) {
      if (raw === null) return sendError(res, { code: 'too-large' });
      var body;
      try { body = JSON.parse(raw || '{}'); } catch (e) { return sendError(res, { code: 'bad-request' }); }
      var url = body && typeof body.url === 'string' ? body.url.trim() : '';
      if (!url || url.length > 2048) return sendError(res, { code: 'bad-request' });

      /* the caller gone (it gave up waiting): the render stops */
      var leave, aborted = new Promise(function (_r, reject) { leave = reject; });
      aborted.catch(function () {});
      res.on('close', function () { if (!res.writableFinished) leave(captureError('render-failed')); });

      var release = null;
      Promise.resolve(check(url)).then(function (bad) {
        if (bad) throw captureError(bad.code || 'blocked-address');
        return gate.enter(budgetMs - minRenderMs - (Date.now() - started));
      }).then(function (rel) {
        release = rel;
        if (res.destroyed) throw captureError('render-failed');
        return render(url, { deadlineAt: started + budgetMs, aborted: aborted });
      }).then(function (html) {
        sendJson(res, 200, { html: html });
      }).catch(function (err) {
        if (!err || !err.code || !ERRORS[err.code] || err.code === 'render-failed') console.error('scrape: failed to render "' + url + '": ' + (err && (err.stack || err.message)));
        else console.error('scrape: "' + url + '" — ' + err.code + (err.httpStatus ? ' ' + err.httpStatus : ''));
        sendError(res, err);
      }).then(function () { if (release) release(); });
    });
  });
  server.gate = gate;
  return server;
}

function serve() {
  var server = createService();
  /* a request that sends nothing for a long time ends; a render's own limit is kept by scrapeUrl */
  server.headersTimeout = 20000;
  server.requestTimeout = REQUEST_BUDGET_MS + 10000;
  server.listen(PORT, function () { console.log('lovable-scraper-service listening on :' + PORT); });
}

module.exports = {
  capturePage: capturePage, settlePage: settlePage, finishPage: finishPage, motionRecorder: motionRecorder, validateUrl: validateUrl,
  /* for the tests (functions/lib/scraper-service.test.js) */
  checkUrl: checkUrl, startGuard: startGuard, captureVerdict: captureVerdict, createGate: createGate, createService: createService,
  secretMatches: secretMatches, ERRORS: ERRORS, LIMITS: { MAX_BODY_BYTES: MAX_BODY_BYTES, MAX_HTML_BYTES: MAX_HTML_BYTES, MAX_RENDER_BYTES: MAX_RENDER_BYTES }
};
if (require.main === module) serve();
