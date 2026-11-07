/* node functions/lib/events-dashboard-standards.test.js — the events dashboard (Event_Listing.html) in standards mode
   (QA F3, UX-002).

   The page had no doctype, charset or viewport line, so a real phone laid it out 980 px wide in quirks mode and none of
   its phone rules (or ETB2B AI's phone sheet) ever applied. It now starts with all three, and the few rules that
   quirks mode had been quietly bending (a table's line height, a line holding only an icon or a tag) are written out,
   so the page looks exactly as it was drawn. This test holds both halves:
     1. the file: doctype first, charset, viewport, lang, the tags closed, and those rules;
     2. a real browser (headless Chrome, when this machine has it): the page in standards mode is laid out exactly as
        the same page in quirks mode at 1440, 1280, 900 and 390 px, and on an emulated iPhone (isMobile, touch,
        3x) it is 390 px wide with its phone layout and ETB2B AI's round launcher and full-screen sheet.
   The browser part serves the worktree's own files and answers every /api route the page reads from fixtures, on a
   made-up origin: nothing reaches the network or production. Without Chrome and puppeteer-core (CHROME_PATH /
   RV_PUPPETEER, else the usual places) it says so and checks the file only. Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var PAGE = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 600) : '')); }
function finish() {
  if (failures.length) { console.error('events-dashboard-standards: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('events-dashboard-standards: all ' + checks + ' checks passed');
  process.exit(0);
}

/* ---------- 1. the file ---------- */
ok(/^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n/.test(PAGE),
  'the page starts with the doctype, <html lang="en">, <head>, the charset and the viewport', PAGE.slice(0, 200));
ok((PAGE.match(/<!doctype/gi) || []).length === 1 && (PAGE.match(/<meta name="viewport"/g) || []).length === 1 && (PAGE.match(/<meta charset/g) || []).length === 1, 'each of them once');
ok(PAGE.indexOf('</style>\n</head>\n<body>\n') !== -1 && PAGE.indexOf('</head>') < PAGE.indexOf('<header class="main-nav">'), 'the head closes after the styles, and the body holds the page');
ok(/<script src="etb2b-assistant\.js"><\/script>\n<\/body>\n<\/html>\n$/.test(PAGE), 'the body and the document are closed after the last script');
ok(/\n  table\{ line-height:normal; \}\n/.test(PAGE), 'tables keep the line height they were drawn with (quirks mode did not pass the page\'s on)');
ok(/\.kpi-card \.kpi-icon\{[^}]*display:flex;/.test(PAGE) && /\.live-tag\{ display:flex; width:fit-content;/.test(PAGE) &&
  /\.ev-name-main \.ev-link\{[^}]*display:block; width:fit-content; max-width:100%;/.test(PAGE) && /textarea\.finput\{ display:block;/.test(PAGE),
  'an icon, the "Live now" tag, the event\'s name and the help form\'s box no longer sit on a text line of their own');

/* ---------- 2. a real browser ---------- */
function driver() {
  var tries = [process.env.RV_PUPPETEER, 'puppeteer-core', path.join(process.env.HOME || '', '.revamp-cms-qa', 'node_modules', 'puppeteer-core')].filter(Boolean);
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]); } catch (e) { /* next */ } }
  return null;
}
var CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
var puppeteer = driver();
if (!puppeteer || !CHROME) { console.log('events-dashboard-standards: the browser part skipped — no Chrome / puppeteer-core here (set CHROME_PATH and RV_PUPPETEER)'); finish(); }

var ORIGIN = 'http://dashboard.test';
/* the same page with no doctype: quirks mode, as every browser drew it before */
var QUIRKS = PAGE.replace(/^<!doctype html>\n/, '');
var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
/* a signed-in stand-in for auth.js */
var AUTH = '(function(){var u={uid:"qa",email:"qa-agent@timesinternet.in",displayName:"QA Agent",getIdToken:function(){return Promise.resolve("t");}};' +
  'function t(){return Promise.resolve("t");}window.RevampAuth={getIdToken:t,currentUser:function(){return u;},onAuthChange:function(cb){setTimeout(function(){cb(u);},0);return function(){};},' +
  'whenResolved:function(){return Promise.resolve(u);},authedFetch:function(url,o){o=o||{};var h={};for(var k in (o.headers||{}))h[k]=o.headers[k];h.Authorization="Bearer t";o.headers=h;return fetch(url,o);},' +
  'redirectToSignIn:function(){},mountAccountMenu:function(){},ensureSession:t};})();';
var LOGO = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="28" viewBox="0 0 120 28"><rect width="28" height="28" fill="#ED1C24"/></svg>';
var NOW = Date.now();
function day(n) { return new Date(NOW + 330 * 60000 + n * 86400000).toISOString().slice(0, 10); }
/* ET's portals (the portals change): the roster as GET /api/et/portals gives it, and the person's working portal
   (none chosen first: All portals, with its Portal column, the first-visit callout and "No portal yet" chips; then
   ETCIO, one portal on its own). Events on two portals and three with none, so every portal part is drawn. */
var ROSTER = require('./et-events').portalList();
var WORKING = null;
var EVENTS = [
  { id: 'qa-std-1', portal: 'cio', portalName: 'ETCIO', name: 'QA Standards CX Leaders Forum', category: 'ip', published: true, start: day(-4) + 'T09:00', end: day(2) + 'T18:00', venue: 'ITC Maratha', city: 'Mumbai', createdAt: '2026-03-01T10:00:00.000Z', createdBy: 'qa-agent@timesinternet.in', counters: { registrations: 77, views: 800, audienceV: 2 } },
  { id: 'qa-std-2', portal: 'hr', portalName: 'ETHRWorld', name: 'QA Standards Retail Leadership Summit with a name long enough to wrap onto a second line', category: 'ip', published: true, start: day(-2) + 'T09:00', end: day(3) + 'T18:00', venue: 'The Leela Palace', city: 'Bengaluru', createdAt: '2026-07-01T10:00:00.000Z', createdBy: 'bob@timesinternet.in', counters: { registrations: 1234, views: 5678, audienceV: 2 } },
  /* qa-std-3 ends tomorrow evening, not today at 22:00: ending today made it leave the Active tab whenever the suite ran after 22:00 IST */
  { id: 'qa-std-3', name: 'QA Standards CX Awards', category: 'awards', published: true, start: day(-3) + 'T18:00', end: day(1) + 'T22:00', city: 'Delhi', createdAt: '2026-05-01T10:00:00.000Z', createdBy: 'qa-agent@timesinternet.in', counters: { registrations: 10, views: 100, audienceV: 2 } },
  { id: 'qa-std-4', portal: 'cio', portalName: 'ETCIO', name: 'QA Standards Making AI Work', category: 'client', published: true, start: day(20) + 'T09:00', end: day(21) + 'T18:00', city: 'Pune', createdAt: '2026-06-01T10:00:00.000Z', createdBy: 'qa-agent@timesinternet.in', counters: { registrations: 5, views: 60, audienceV: 2 } },
  { id: 'qa-std-5', name: 'QA Standards Draft', category: 'ip', published: false, createdAt: new Date(NOW - 6 * 86400000).toISOString(), createdBy: 'qa-agent@timesinternet.in', counters: {} }
];
function api(u) {
  if (u.pathname === '/api/events') return { items: EVENTS };
  if (u.pathname === '/api/et/portals') return { portals: ROSTER };
  if (u.pathname === '/api/me/working-portal') return { workingPortal: WORKING };
  if (u.pathname === '/api/insights') {
    var from = u.searchParams.get('from'), to = u.searchParams.get('to'), byDay = [];
    for (var d = from; d <= to; d = new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) byDay.push({ date: d, views: 30, uniques: 20, registrations: 3 });
    return { byDay: byDay, events: EVENTS.map(function (e, i) { return { eventId: e.id, name: e.name, window: { registrations: i, views: i * 10, uniques: 0, lastRegistration: i ? to : null, lastView: i ? to : null } }; }) };
  }
  if (u.pathname === '/api/promo/analytics/all') return { available: false, backend: 'none', series: [], totals: { sends: 0, opens: 0, clicks: 0 } };
  if (u.pathname === '/api/activity/all') return { items: [{ id: 'a', eventId: 'qa-std-1', eventName: 'QA Standards CX Leaders Forum', at: new Date(NOW - 600000).toISOString(), byLabel: 'qa-agent@timesinternet.in', detail: 'Published the site' }], next: null };
  if (u.pathname === '/api/dash-bot/history') return { turns: [] };
  return null;
}
function serve(r) {
  var u = new URL(r.url());
  if (u.origin !== ORIGIN) {
    if (/oneworld-logo\.svg$/.test(u.pathname)) return r.respond({ status: 200, contentType: 'image/svg+xml', body: LOGO });
    return r.abort();                                         // fonts and anything else outside: never fetched
  }
  if (u.pathname === '/quirks/Event_Listing.html') return r.respond({ status: 200, contentType: TYPES['.html'], body: QUIRKS });
  var p = u.pathname.replace(/^\/quirks\//, '/');
  if (p === '/auth.js') return r.respond({ status: 200, contentType: TYPES['.js'], body: AUTH });
  if (/^\/api\//.test(p)) {
    var body = api(u);
    return r.respond({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body || { error: 'not here' }) });
  }
  var file = path.join(ROOT, decodeURIComponent(p));
  if (file.indexOf(ROOT + path.sep) !== 0 || !fs.existsSync(file)) return r.respond({ status: 404, body: 'not found' });
  return r.respond({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* What decides the look: the mode and width, the page's height, and the size of every part that quirks mode bent */
var PARTS = ['#table-body tr', 'thead tr', '.kpi-card', '.kpi-top', '.ev-card', '.ev-name-main', '.ev-meta-line', '.ev-date-cell', '.activity-row', '#activity-card', '.main-nav', '.section-bar',
  /* the portals change's own parts: the switcher, the notices above the list, the Portal column and the cards' portal line */
  '#btn-portals-nav', '#portal-notice', '.portal-notice', 'td.col-portal', '.ev-card-portal', '.rvp-chip', '.ev-portal-name'];
function measure(PARTS) {
  var out = { compat: document.compatMode, innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, parts: {} };
  PARTS.forEach(function (sel) {
    out.parts[sel] = Array.prototype.map.call(document.querySelectorAll(sel), function (el) {
      var r = el.getBoundingClientRect();
      return r.width || r.height ? Math.round(r.width) + 'x' + Math.round(r.height * 2) / 2 : '';
    }).filter(Boolean).join(' ');
  });
  return out;
}

(async function () {
  var browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });
  async function open(url, size) {
    var page = await browser.newPage();
    var errors = [];
    page.on('pageerror', function (e) { errors.push(String(e.message)); });
    await page.setRequestInterception(true);
    page.on('request', serve);
    if (size.device) await page.emulate(puppeteer.KnownDevices[size.device]);
    else await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 });
    await page.goto(ORIGIN + url, { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(400);
    page.errors = errors;
    return page;
  }
  try {
    var SIZES = [{ w: 1440, h: 900 }, { w: 1280, h: 720 }, { w: 900, h: 1000 }, { w: 390, h: 844 }];
    var phoneWindow = null;
    for (var i = 0; i < SIZES.length; i++) {
      var s = SIZES[i];
      var q = await open('/quirks/Event_Listing.html', s), st = await open('/Event_Listing.html', s);
      var a = await q.evaluate(measure, PARTS), b = await st.evaluate(measure, PARTS);
      ok(a.compat === 'BackCompat' && b.compat === 'CSS1Compat', s.w + ' px: the page is in standards mode now (the copy without a doctype is not)', [a.compat, b.compat]);
      ok(b.innerWidth === s.w && b.scrollWidth <= s.w, s.w + ' px: laid out at the window\'s width, no sideways scroll', [b.innerWidth, b.scrollWidth]);
      ok(b.height === a.height, s.w + ' px: the page is exactly as tall as it was drawn (' + a.height + ')', [a.height, b.height]);
      var differ = PARTS.filter(function (p) { return a.parts[p] !== b.parts[p]; });
      ok(differ.length === 0, s.w + ' px: every row, card, tag and panel keeps its size', differ.map(function (p) { return p + ': ' + a.parts[p] + ' -> ' + b.parts[p]; }));
      ok(!st.errors.length, s.w + ' px: no page error', st.errors);
      if (s.w === 390) phoneWindow = b;
      await q.close(); await st.close();
    }

    /* a real phone: the device's own width, its phone layout, and ETB2B AI's phone sheet */
    var phone = await open('/Event_Listing.html', { device: 'iPhone 13' });
    var m = await phone.evaluate(measure, PARTS);
    var env = await phone.evaluate(function () {
      var l = document.getElementById('dash-chat-launcher'), r = l ? l.getBoundingClientRect() : null;
      return { dpr: window.devicePixelRatio, touch: 'ontouchstart' in window, table: getComputedStyle(document.getElementById('table-wrap')).display,
        cards: document.querySelectorAll('.ev-card').length, filters: getComputedStyle(document.getElementById('btn-mobile-filters')).display,
        launcher: r ? [Math.round(r.width), Math.round(r.height), getComputedStyle(l).borderRadius] : null };
    });
    ok(m.compat === 'CSS1Compat' && m.innerWidth === 390 && m.scrollWidth <= 390, 'iPhone: laid out at 390 px in standards mode (it was 980 px in quirks mode), no sideways scroll', m);
    ok(env.dpr === 3 && env.touch === true, 'iPhone: the emulation is a real phone\'s (3x, touch)', env);
    /* the Active tab: the three events running now (qa-std-1, 2 and 3), as cards */
    ok(env.table === 'none' && env.cards === 3 && env.filters !== 'none', 'iPhone: the phone layout (cards, the Filters button), not the desktop table', env);
    ok(!!phoneWindow && m.height === phoneWindow.height && PARTS.every(function (p) { return m.parts[p] === phoneWindow.parts[p]; }), 'iPhone: exactly the layout a 390 px window gets',
      phoneWindow && PARTS.filter(function (p) { return m.parts[p] !== phoneWindow.parts[p]; }));
    ok(!!env.launcher && env.launcher[0] === 52 && env.launcher[1] === 52 && env.launcher[2] === '50%', 'iPhone: ETB2B AI\'s launcher is the round 52 px phone one', env.launcher);
    await phone.tap('#dash-chat-launcher');
    await sleep(600);
    var sheet = await phone.evaluate(function () {
      var p = document.querySelector('[aria-modal="true"]'), r = p ? p.getBoundingClientRect() : null;
      var box = p ? p.querySelector('textarea') : null, br = box ? box.getBoundingClientRect() : null;
      return { rect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null, vh: window.innerHeight,
        box: br ? Math.round(br.bottom) : null, locked: getComputedStyle(document.body).overflow, scrollWidth: document.documentElement.scrollWidth };
    });
    ok(!!sheet.rect && sheet.rect[0] === 0 && sheet.rect[1] === 0 && sheet.rect[2] === 390 && sheet.rect[3] === sheet.vh, 'iPhone: ETB2B AI opens as a full-screen sheet (aria-modal)', sheet);
    ok(sheet.box !== null && sheet.box <= sheet.vh && sheet.locked === 'hidden' && sheet.scrollWidth <= 390, 'iPhone: its message box is in view and the page behind it is locked', sheet);
    ok(!phone.errors.length, 'iPhone: no page error', phone.errors);
    await phone.close();

    /* All portals drew every portal part above; did the pages show them? Then one portal on its own (ETCIO) */
    var allSeen = await open('/Event_Listing.html', SIZES[0]);
    var drawn = await allSeen.evaluate(function () {
      function n(sel) { return document.querySelectorAll(sel).length; }
      return { notices: n('.portal-notice'), callout: n('.portal-callout'), cells: n('td.col-portal'), chips: n('#table-body .rvp-chip'), named: n('#table-body .ev-portal-name'),
        column: getComputedStyle(document.querySelector('thead .col-portal')).display, nav: document.getElementById('btn-portals-nav').textContent.trim() };
    });
    ok(drawn.notices === 2 && drawn.callout === 1 && drawn.cells === 3 && drawn.chips === 1 && drawn.named === 2 && drawn.column === 'table-cell' && drawn.nav === 'All portals',
      'All portals: the callout, the "no portal yet" notice, the Portal column with names and a chip were all measured', drawn);
    await allSeen.close();
    WORKING = 'cio';
    for (var j = 0; j < SIZES.length; j += 3) {
      var sz = SIZES[j];
      var q2 = await open('/quirks/Event_Listing.html', sz), st2 = await open('/Event_Listing.html', sz);
      var a2 = await q2.evaluate(measure, PARTS), b2 = await st2.evaluate(measure, PARTS);
      var one = await st2.evaluate(function () { return { nav: document.getElementById('btn-portals-nav').textContent.trim(), line: document.getElementById('result-line').textContent }; });
      ok(one.nav === 'ETCIO' && /on ETCIO$/.test(one.line), sz.w + ' px, ETCIO: the list is on one portal', one);
      ok(b2.compat === 'CSS1Compat' && b2.scrollWidth <= sz.w && b2.height === a2.height, sz.w + ' px, ETCIO: no sideways scroll, and exactly as tall as quirks mode drew it', [a2.height, b2.height, b2.scrollWidth]);
      var differ2 = PARTS.filter(function (p) { return a2.parts[p] !== b2.parts[p]; });
      ok(differ2.length === 0, sz.w + ' px, ETCIO: every part keeps its size', differ2.map(function (p) { return p + ': ' + a2.parts[p] + ' -> ' + b2.parts[p]; }));
      ok(!st2.errors.length, sz.w + ' px, ETCIO: no page error', st2.errors);
      await q2.close(); await st2.close();
    }
  } catch (e) {
    ok(false, 'the browser part ran to the end', String(e && e.stack || e));
  } finally {
    await browser.close();
  }
  finish();
})();
