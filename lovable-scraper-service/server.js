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

  await page.evaluate(async function (maxSteps) {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    var step = Math.max(300, Math.round(window.innerHeight * 0.7));
    for (var i = 0, y = 0; i < maxSteps && y < document.documentElement.scrollHeight; i++, y += step) {
      window.scrollTo(0, y);
      await wait(140);
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await wait(300);
    window.scrollTo(0, 0);
    await wait(900);
  }, SETTLE_MAX_SCROLL_STEPS);

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

module.exports = { capturePage: capturePage, settlePage: settlePage, finishPage: finishPage, validateUrl: validateUrl };
if (require.main === module) serve();
