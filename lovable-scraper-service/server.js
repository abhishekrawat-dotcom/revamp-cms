// Minimal HTTP service that does exactly one thing: launch headless Chrome, render a URL, and hand back
// the rendered HTML. It exists because this repo's main backend (Firebase App Hosting, see
// ../apphosting.yaml) builds its container with Google's automatic buildpacks -- there is no Dockerfile
// for that service, so there is no way to apt-get install the system libraries (libnss3 and friends)
// headless Chrome needs. This service is deployed separately, straight to Cloud Run with a real
// Dockerfile (see Dockerfile in this directory), so it CAN install whatever Chrome needs. The main
// backend (functions/lib/api.js's scrapeLovableUrl()) calls this service over plain HTTP instead of
// launching Chrome itself. See README.md in this directory for the full picture and deploy instructions.
//
// Endpoint: POST /scrape  body {url}  ->  200 {html}  |  4xx/5xx {error}
//
// Auth: every request must carry the shared secret configured on BOTH this service (env SCRAPER_SECRET)
// and the main backend (env LOVABLE_SCRAPER_SECRET) in the X-Scraper-Secret header. This is a simple
// shared secret, not GCP IAM auth -- wiring real service-to-service IAM auth from Firebase App Hosting
// would need more plumbing than this one feature justifies. It exists purely to stop this service's own
// public Cloud Run URL being abused as an open "render any URL through headless Chrome" proxy by anyone
// who finds it.
//
// SSRF guard: this service is the thing that actually fetches an attacker-reachable URL, so it
// re-implements the exact same validateImportUrl()/isPrivateOrLoopbackIp() logic functions/lib/api.js
// already applies on the main backend before a request ever reaches here (scheme allow-list + a real
// DNS-resolved rejection of loopback/private/link-local/cloud-metadata addresses -- see that file for the
// original). This matters doubly here: this container has its own 169.254.169.254 metadata endpoint that
// must stay unreachable from a URL this service is asked to render.

var http = require('http');
var dns = require('dns');

var PORT = process.env.PORT || 8080;
var SECRET = process.env.SCRAPER_SECRET || '';

// Same two timeouts and reasoning as the (now-removed) in-process version of this logic in
// functions/lib/api.js: NAV_TIMEOUT_MS is page.goto()'s own ceiling for reaching network-idle,
// TOTAL_TIMEOUT_MS is the hard ceiling on the whole render (Chrome launch included) so one slow/hung
// site can never tie up this process (and its headless Chrome) forever.
var NAV_TIMEOUT_MS = 30000;
var TOTAL_TIMEOUT_MS = 105000;   // the page is walked through before capture (carousels, accordions): see settlePage

// ---------- SSRF guard (ported from functions/lib/api.js's isPrivateOrLoopbackIp/validateImportUrl) ----------

function isPrivateOrLoopbackIp(ip) {
  if (/^127\./.test(ip)) return true;                                    // IPv4 loopback
  if (/^10\./.test(ip)) return true;                                     // RFC1918
  if (/^192\.168\./.test(ip)) return true;                               // RFC1918
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;                // RFC1918
  if (/^169\.254\./.test(ip)) return true;                               // link-local / cloud metadata
  if (ip === '0.0.0.0') return true;
  if (ip === '::1') return true;                                         // IPv6 loopback
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;                       // IPv6 unique-local (fc00::/7)
  if (/^fe80:/i.test(ip)) return true;                                   // IPv6 link-local
  return false;
}

function validateUrl(rawUrl) {
  var u;
  try { u = new URL(rawUrl); } catch (e) { return Promise.resolve('That doesn\'t look like a valid URL.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return Promise.resolve('Only http:// and https:// URLs are allowed.');
  var host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateOrLoopbackIp(host)) {
    return Promise.resolve('That host isn\'t allowed.');
  }
  return new Promise(function (resolve) {
    dns.lookup(host, { all: true }, function (err, addrs) {
      if (err) return resolve('Could not resolve that host.');
      var bad = (addrs || []).some(function (a) { return isPrivateOrLoopbackIp(a.address); });
      resolve(bad ? 'That host resolves to a private address and isn\'t allowed.' : null);
    });
  });
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

async function settlePage(page) {
  var deadline = Date.now() + SETTLE_BUDGET_MS;

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

// Renders `url` in an open tab and returns its markup as captured (settlePage, finishPage). Exported, with
// those two, so the capture can be run from a script with a Chrome of its own (tools/reimport-lovable.js).
async function capturePage(page, url) {
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(motionRecorder);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  } catch (err) {
    // A site with e.g. continuous analytics pings may never truly go network-idle -- don't fail the
    // whole render over that; capture whatever has rendered by now instead.
    console.error('scrape: navigation to "' + url + '" did not fully settle (' + err.message + ') -- capturing whatever rendered so far.');
  }
  await new Promise(function (resolve) { setTimeout(resolve, 3500); }); // let an intro animation play out
  try { await settlePage(page); } catch (err) {
    // best effort: a page this cannot walk through is still captured as it stands
    console.error('scrape: could not settle "' + url + '" before capture (' + err.message + ').');
  }
  return page.evaluate(finishPage);
}

// Launches headless Chrome, navigates to `url`, waits briefly for any late mount/animation, and returns
// the final rendered outerHTML. Closes the browser on every path -- success, navigation timeout, launch
// failure, or the overall TOTAL_TIMEOUT_MS firing -- so a failed/slow request never leaks a Chrome
// process. If the hard timeout fires before Chrome has even finished launching, this waits for that
// launch attempt to actually settle (success or failure) before trying to close it, so a browser that
// finishes launching just after the timeout still gets closed instead of orphaned.
async function scrapeUrl(url) {
  var browser = null;

  async function closeBrowser() {
    if (!browser) return;
    var b = browser;
    browser = null;
    try { await b.close(); } catch (e) { console.error('scrape: error closing headless Chrome: ' + e.message); }
  }

  var work = (async function () {
    browser = await require('puppeteer').launch({
      headless: true,
      // --disable-dev-shm-usage: Cloud Run's default /dev/shm is tiny; without this, Chrome can crash
      // outright on real pages. --no-sandbox/--disable-setuid-sandbox: Chrome's own sandbox needs kernel
      // privileges this container doesn't grant -- the standard, well-documented flags for running
      // headless Chrome inside a Docker container (see README.md).
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    var page = await browser.newPage();
    return capturePage(page, url);
  })();

  var timer;
  var timeoutPromise = new Promise(function (_resolve, reject) {
    timer = setTimeout(function () {
      reject(Object.assign(new Error('Rendering this page took too long (over ' + Math.round(TOTAL_TIMEOUT_MS / 1000) + 's).'), { status: 504 }));
    }, TOTAL_TIMEOUT_MS);
  });

  try {
    var html = await Promise.race([work, timeoutPromise]);
    clearTimeout(timer);
    await closeBrowser();
    return html;
  } catch (err) {
    clearTimeout(timer);
    await work.catch(function () {}); // let a still-in-flight launch/goto settle so `browser` is really set
    await closeBrowser();
    throw err;
  }
}

// ---------- plain HTTP plumbing ----------

function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, cb) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () { cb(Buffer.concat(chunks).toString('utf8')); });
  req.on('error', function () { cb(''); });
}

function serve() {
var server = http.createServer(function (req, res) {
  if (req.method === 'GET' && req.url === '/healthz') return sendJson(res, 200, { ok: true });

  if (req.method !== 'POST' || req.url !== '/scrape') {
    return sendJson(res, 404, { error: 'Not found. POST /scrape with {url}.' });
  }

  if (!SECRET) {
    console.error('scrape: SCRAPER_SECRET is not set on this service -- refusing all requests until it is.');
    return sendJson(res, 500, { error: 'This service has no SCRAPER_SECRET configured yet.' });
  }
  var provided = req.headers['x-scraper-secret'];
  if (!provided || provided !== SECRET) {
    return sendJson(res, 401, { error: 'Missing or incorrect X-Scraper-Secret header.' });
  }

  readBody(req, function (raw) {
    var body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
    var url = body && body.url ? String(body.url).trim() : '';
    if (!url) return sendJson(res, 400, { error: 'url is required.' });

    validateUrl(url).then(function (badReason) {
      if (badReason) return sendJson(res, 400, { error: badReason });
      return scrapeUrl(url).then(function (html) {
        sendJson(res, 200, { html: html });
      }).catch(function (err) {
        console.error('scrape: failed to render "' + url + '": ' + err.message);
        sendJson(res, err.status || 500, { error: err.message || 'Failed to render that URL.' });
      });
    });
  });
});

server.listen(PORT, function () { console.log('lovable-scraper-service listening on :' + PORT); });
}

module.exports = { capturePage: capturePage, settlePage: settlePage, finishPage: finishPage, motionRecorder: motionRecorder, validateUrl: validateUrl };
if (require.main === module) serve();
