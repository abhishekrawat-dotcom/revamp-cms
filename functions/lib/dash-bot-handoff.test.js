// node functions/lib/dash-bot-handoff.test.js — ETB2B AI on the events dashboard hands work over to two pages
// (dash-bot plan §10, Unit E):
//   E.1 create-event-prefill.js: take / decide / apply / describe / summary — the details read once from
//       localStorage, checked again with the server's field rules, and put into a blank Create Event draft
//   E.2 create-event.html: the script tag, init()'s paths (pinned as they were with no new parameter), the
//       unfinished-draft question with a prefill waiting, the note over step 1 and its Undo
//   E.3 marketing.html: &template= into the Social posts frame, &post= into Site-look posts' ctx.open, and the
//       "mailer is waiting" line
//   E.4 promo-studio/oneworld-social.js: the post asked for opens in the editor, or a toast says why not
//   E.5 promo-posts.js: ctx.open opens the editor, or the preview that says what is missing
// No network, no Firebase, no AI. The pages' scripts run in vm over small stand-in DOMs; the two studios' DOMs are
// the ones their own tests build (read from those files, by their section markers).
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var htmlparser2 = require('htmlparser2');
var access = require('./access');

var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function count(s, sub) { return s.split(sub).length - 1; }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
function until(cond, ms) {
  var end = Date.now() + (ms || 3000);
  return new Promise(function (resolve) {
    (function again() { if (cond() || Date.now() > end) { resolve(!!cond()); return; } setTimeout(again, 10); })();
  });
}

var PREFILL_SRC = read('create-event-prefill.js');
var FIELDS_SRC = read('portal-fields.js');
var CE = read('create-event.html');
var MK = read('marketing.html');
var SOCIAL = read('promo-studio/oneworld-social.js');
var POSTS = read('promo-posts.js');
var Prefill = require('../../create-event-prefill.js');

/* ---------- reading JavaScript out of a page: one balanced { … }, past strings, comments and regex literals ---------- */
function regexStarts(src, i) {
  for (var j = i - 1; j >= 0 && /\s/.test(src[j]); j--);
  if (j < 0) return true;
  if ('(,=:[!&|?{};+-*%<>~^'.indexOf(src[j]) !== -1) return true;
  return /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(src.slice(Math.max(0, j - 7), j + 1));
}
function balanced(src, open) {
  var depth = 0, st = null, cls = false;
  for (var i = open; i < src.length; i++) {
    var c = src[i], n = src[i + 1];
    if (st === '//') { if (c === '\n') st = null; continue; }
    if (st === '/*') { if (c === '*' && n === '/') { st = null; i++; } continue; }
    if (st === 're') {
      if (c === '\\') { i++; continue; }
      if (cls) { if (c === ']') cls = false; continue; }
      if (c === '[') { cls = true; continue; }
      if (c === '/') st = null;
      continue;
    }
    if (st) { if (c === '\\') { i++; continue; } if (c === st) st = null; continue; }
    if (c === '/' && n === '/') { st = '//'; i++; continue; }
    if (c === '/' && n === '*') { st = '/*'; i++; continue; }
    if (c === '/' && regexStarts(src, i)) { st = 're'; cls = false; continue; }
    if (c === '"' || c === "'" || c === '`') { st = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}
function fnSrc(src, name) {
  var at = src.indexOf('function ' + name + '(');
  if (at === -1) return null;
  var body = balanced(src, src.indexOf('{', src.indexOf(')', at)));
  return body ? src.slice(at, src.indexOf('{', src.indexOf(')', at))) + body : null;
}
function literal(src, decl) {
  var at = src.indexOf(decl);
  return at === -1 ? null : balanced(src, src.indexOf('{', at));
}
function stripComments(code) { return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1'); }
function es5(name, src) {
  var code = stripComments(src);
  check(name + ': no let / const', !/\blet\s/.test(code) && !/\bconst\s/.test(code));
  check(name + ': no arrow functions', code.indexOf('=>') === -1);
  check(name + ': no async / await or classes', !/\basync\s+function\b|\bawait\s/.test(code) && !/\bclass\s+[A-Z]/.test(code));
  check(name + ': no template strings', code.indexOf('`') === -1);
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the regex checks above still run */ }
  if (esbuild) {
    var r = (function () { try { esbuild.transformSync(src, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check(name + ': ES5 by esbuild', r === true, r);
  }
}
var CE_INLINE = (CE.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); })
  .filter(function (s) { return s.indexOf('var CATS = {') !== -1; })[0] || '';
var CATS_SRC = literal(CE_INLINE, '  var CATS = {'), S_SRC = literal(CE_INLINE, '  var S = {');
function freshCats() { return vm.runInNewContext('(' + CATS_SRC + ')'); }
function freshS() { return vm.runInNewContext('(' + S_SRC + ')'); }
var SLUGIFY = vm.runInNewContext('var SLUG_MAX = 48;\n' + fnSrc(CE_INLINE, 'slugify') + '\nslugify');

/* ---------- a localStorage ---------- */
function fakeStorage(init) {
  var m = {};
  Object.keys(init || {}).forEach(function (k) { m[k] = String(init[k]); });
  var st = {
    _m: m, refuse: false,
    key: function (i) { return Object.keys(m)[i] || null; },
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; }
  };
  Object.defineProperty(st, 'length', { get: function () { return Object.keys(m).length; } });
  return st;
}
var PFX = 'revamp.createEvent.prefill.v1.';
var NOW = Date.UTC(2026, 10, 3, 6, 35);   // Tue 3 Nov 2026, 12:05 IST
var ID = 'Tq3x9Kd2mP8vW1zR';
function stored(over, id) {
  var p = { v: 1, from: 'etb2b-ai', at: NOW - 60000, turnId: id || ID, prefillId: id || ID, category: 'IP', method: '', portal: '',
    basics: { name: 'Retail Leadership Summit', client: '', dateMode: 'exact', start: '2027-02-12', end: '', month: '', quarter: '', year: '',
      venue: 'Jio World Centre', city: 'Mumbai' }, brief: { text: '', current: '', previous: '' } };
  over = over || {};
  Object.keys(over).forEach(function (k) {
    if ((k === 'basics' || k === 'brief') && over[k] && typeof over[k] === 'object') Object.keys(over[k]).forEach(function (j) { p[k][j] = over[k][j]; });
    else p[k] = over[k];
  });
  return p;
}
function takeOne(p, id, now) {
  var s = fakeStorage();
  s.setItem(PFX + (id || ID), typeof p === 'string' ? p : JSON.stringify(p));
  return { got: Prefill.take(s, id || ID, now || NOW), storage: s };
}

/* =============================================================================== E.1 create-event-prefill.js */
(function e1() {
  check('E.1 loads in node as module.exports', Prefill && typeof Prefill.take === 'function' && typeof Prefill.decide === 'function' &&
    typeof Prefill.apply === 'function' && typeof Prefill.describe === 'function' && typeof Prefill.summary === 'function');
  var win = { window: null }; win.window = win;
  vm.runInNewContext(PREFILL_SRC, win);
  check('E.1 loads in a browser as window.RevampPrefill, and nothing else', !!win.RevampPrefill && typeof win.RevampPrefill.take === 'function' &&
    Object.keys(win).sort().join() === 'RevampPrefill,window', Object.keys(win));
  es5('E.1 create-event-prefill.js', PREFILL_SRC);
  check('E.1 the page may load it (the server serves it)', access.isServableFile('create-event-prefill.js') === true);
  check('E.1 the code never sets the discard parameter', stripComments(PREFILL_SRC).indexOf('discard=1') === -1);
  check('E.1 the key prefix', Prefill.PREFIX === PFX);

  /* the copy of each type's date formats equals the page's CATS */
  var CATS = freshCats();
  ['IP', 'Client', 'Awards'].forEach(function (k) {
    check('E.1 ' + k + ': date formats as the page has them', JSON.stringify(Prefill.DATE_MODES[k]) === JSON.stringify(CATS[k].dateModes), [Prefill.DATE_MODES[k], CATS[k].dateModes]);
    check('E.1 ' + k + ': default date format as the page has it', Prefill.DEFAULT_DATE_MODE[k] === CATS[k].defaultDateMode);
  });
  check('E.1 the page has exactly these three types', Object.keys(CATS).join() === 'IP,Client,Awards', Object.keys(CATS));

  /* ---- take: read once, removed; refused in every broken case ---- */
  var t = takeOne(stored());
  check('E.1 take: a good prefill is returned', !!t.got && t.got.basics.name === 'Retail Leadership Summit' && t.got.category === 'IP' && t.got.prefillId === ID, t.got);
  check('E.1 take: … and its key is removed (read once)', t.storage.getItem(PFX + ID) === null);
  check('E.1 take: … and a second take finds nothing', Prefill.take(t.storage, ID, NOW) === null);
  /* hero: ETB2B AI's hero picture request (plan §18), null when none came */
  check('E.1 take: the cleaned shape', t.got && JSON.stringify(Object.keys(t.got).sort()) === JSON.stringify(['at', 'basics', 'brief', 'category', 'dropped', 'from', 'hero', 'method', 'portal', 'prefillId', 'turnId', 'v']) &&
    JSON.stringify(Object.keys(t.got.basics).sort()) === JSON.stringify(['city', 'client', 'dateMode', 'end', 'month', 'name', 'quarter', 'start', 'venue', 'year']) &&
    JSON.stringify(Object.keys(t.got.brief).sort()) === JSON.stringify(['current', 'previous', 'text']), t.got);
  check('E.1 take: a good prefill drops nothing', t.got && JSON.stringify(t.got.dropped) === '[]', t.got && t.got.dropped);
  [['a bad id (too short)', 'abc', null], ['a bad id (symbols)', 'Tq3x9Kd2mP8vW1z!', null], ['a bad id (41 characters)', new Array(42).join('a'), null]].forEach(function (c) {
    var s = fakeStorage(); s.setItem(PFX + c[1], JSON.stringify(stored({ prefillId: c[1] })));
    check('E.1 take refuses ' + c[0], Prefill.take(s, c[1], NOW) === null);
  });
  check('E.1 take refuses an id that is not a string', Prefill.take(fakeStorage(), 1234567890123, NOW) === null && Prefill.take(fakeStorage(), null, NOW) === null);
  var bad = takeOne('{not json');
  check('E.1 take refuses bad JSON, and still removes it', bad.got === null && bad.storage.getItem(PFX + ID) === null);
  [['v:2', stored({ v: 2 })], ['the wrong from', stored({ from: 'someone-else' })], ['a prefillId other than the id', stored({ prefillId: 'Zz9Zz9Zz9Zz9Zz9' })],
    ['one older than 10 minutes', stored({ at: NOW - 10 * 60000 - 1 })], ['one dated well ahead of now', stored({ at: NOW + 5 * 60000 })],
    ['no time at all', stored({ at: 'yesterday' })], ['an array', [stored()]], ['null', null], ['a string', 'hello']].forEach(function (c) {
    var r = takeOne(c[1]);
    check('E.1 take refuses ' + c[0] + ', and removes it', r.got === null && r.storage.getItem(PFX + ID) === null, r.got);
  });
  check('E.1 take: exactly 10 minutes old is still good', !!takeOne(stored({ at: NOW - 10 * 60000 })).got);
  check('E.1 take: no storage (blocked) → null, no throw', Prefill.take(null, ID, NOW) === null);
  var throwing = { length: 1, key: function () { throw new Error('blocked'); }, getItem: function () { throw new Error('blocked'); }, removeItem: function () { throw new Error('blocked'); } };
  check('E.1 take: storage that throws → null, no throw', (function () { try { return Prefill.take(throwing, ID, NOW) === null; } catch (e) { return false; } })());

  /* the sweep: other keys of this kind that are old or unreadable go; fresh ones and every other key stay */
  var sw = fakeStorage();
  sw.setItem(PFX + ID, JSON.stringify(stored()));
  sw.setItem(PFX + 'OldOldOldOld01', JSON.stringify(stored({ at: NOW - 11 * 60000 }, 'OldOldOldOld01')));
  sw.setItem(PFX + 'FreshFresh0001', JSON.stringify(stored({ at: NOW - 2 * 60000 }, 'FreshFresh0001')));
  sw.setItem(PFX + 'BrokenBroken01', '{oops');
  sw.setItem('revamp.createEvent.draft.v1', '{"draftId":"d1"}');
  sw.setItem('revamp-theme', 'dark');
  Prefill.take(sw, ID, NOW);
  check('E.1 take sweeps an expired prefill of another id', sw.getItem(PFX + 'OldOldOldOld01') === null);
  check('E.1 take sweeps an unreadable prefill', sw.getItem(PFX + 'BrokenBroken01') === null);
  check('E.1 take leaves a fresh prefill of another id (another tab may be on its way to it)', sw.getItem(PFX + 'FreshFresh0001') !== null);
  check('E.1 take leaves the draft and every other key alone', sw.getItem('revamp.createEvent.draft.v1') === '{"draftId":"d1"}' && sw.getItem('revamp-theme') === 'dark');
  var sw2 = fakeStorage(); sw2.setItem(PFX + 'OldOldOldOld01', JSON.stringify(stored({ at: NOW - 11 * 60000 }, 'OldOldOldOld01')));
  Prefill.take(sw2, 'bad!', NOW);
  check('E.1 take sweeps even when its own id is bad', sw2.getItem(PFX + 'OldOldOldOld01') === null);

  /* ---- the field rules (as the server's cleanCreate, A.12) ---- */
  function got(over) { return takeOne(stored(over)).got; }
  var g = got({ category: 'Client', basics: { dateMode: 'quarter', start: '', quarter: 'Q2', year: '2027' } });
  check('E.1 Client with a quarter → Client\'s default format (exact), and the quarter is not carried', g.basics.dateMode === 'exact' && g.basics.quarter === '' && g.basics.year === '', g.basics);
  g = got({ category: 'Awards', basics: { dateMode: 'none', start: '' } });
  check('E.1 Awards with "no date" → Awards\' default (month)', g.basics.dateMode === 'month', g.basics);
  g = got({ category: 'IP', basics: { dateMode: 'sometime' } });
  check('E.1 an unknown date format with a start → exact', g.basics.dateMode === 'exact' && g.basics.start === '2027-02-12', g.basics);
  g = got({ category: '', basics: { dateMode: '', start: '', month: '2027-03' } });
  check('E.1 no format but a month → month', g.basics.dateMode === 'month' && g.basics.month === '2027-03' && g.basics.start === '', g.basics);
  g = got({ basics: { dateMode: 'month', month: '2027-03', start: '2027-02-12' } });
  check('E.1 only the values the format shows are kept (month: no start)', g.basics.month === '2027-03' && g.basics.start === '' && g.basics.end === '', g.basics);
  g = got({ basics: { start: '2027-02-30' } });
  check('E.1 an impossible date is dropped', g.basics.start === '', g.basics);
  g = got({ basics: { start: '2027-02-12', end: '2027-02-10' } });
  check('E.1 an end before the start is dropped', g.basics.start === '2027-02-12' && g.basics.end === '', g.basics);
  g = got({ basics: { start: '2027-02-12', end: '2027-02-13' } });
  check('E.1 a two-day event keeps both days', g.basics.start === '2027-02-12' && g.basics.end === '2027-02-13', g.basics);
  g = got({ basics: { start: '2027-02-12', end: '2027-02-12' } });
  check('E.1 a one-day event (end = start) keeps its end', g.basics.end === '2027-02-12', g.basics);
  g = got({ basics: { start: '2027-02-12T10:00', end: '2027-02-12T09:00' } });
  check('E.1 an end time before the start time on the same day is dropped', g.basics.start === '2027-02-12T10:00' && g.basics.end === '', g.basics);
  g = got({ basics: { start: '1999-12-31' } });
  check('E.1 a year before 2000 is dropped', g.basics.start === '', g.basics);
  g = got({ basics: { start: '2101-01-01' } });
  check('E.1 a year after 2100 is dropped', g.basics.start === '', g.basics);
  g = got({ basics: { dateMode: 'month', month: '2027-13' } });
  check('E.1 an impossible month is dropped', g.basics.month === '', g.basics);
  g = got({ basics: { dateMode: 'quarter', quarter: 'Q5', year: 2027 } });
  check('E.1 Q5 is dropped, a numeric year is kept as text', g.basics.quarter === '' && g.basics.year === '2027', g.basics);
  g = got({ basics: { dateMode: 'quarter', quarter: ['Q3'], year: '2027' } });
  check('E.1 a quarter that is not text (["Q3"]) is never carried into the draft', g.basics.quarter === '' && g.basics.year === '2027', g.basics);
  g = got({ basics: { dateMode: 'quarter', quarter: 'Q3', year: '1999' } });
  check('E.1 a quarter year out of range is dropped', g.basics.quarter === 'Q3' && g.basics.year === '', g.basics);
  var long = new Array(300).join('x');
  g = got({ basics: { name: long, venue: long, city: long, client: long } });
  check('E.1 name, venue, city and client are cut to 120 characters', g.basics.name.length === 120 && g.basics.venue.length === 120 && g.basics.city.length === 120 && g.basics.client.length === 120);
  g = got({ basics: { name: 'Retail\nLeadership\u2028Summit\u0007 ', venue: '  Jio\tWorld   Centre ' } });
  check('E.1 line breaks and control characters in a name become spaces', g.basics.name === 'Retail Leadership Summit' && g.basics.venue === 'Jio World Centre', g.basics);
  g = got({ basics: { name: 42, venue: { a: 1 }, city: ['Mumbai'] } });
  check('E.1 a value that is not text is empty', g.basics.name === '' && g.basics.venue === '' && g.basics.city === '', g.basics);
  g = got({ basics: { venue: '', city: '' } });
  check('E.1 nothing is invented: no venue in → no venue out', g.basics.venue === '' && g.basics.city === '');
  g = got({ method: 'brief', brief: { text: 'A one-day forum for retail CXOs.', current: 'http://example.com/2027', previous: 'https://et.example.com/2026' } });
  check('E.1 an http: link is dropped, an https: one kept', g.brief.current === '' && g.brief.previous === 'https://et.example.com/2026', g.brief);
  check('E.1 … and the dropped link is named (dropped: current)', JSON.stringify(g.dropped) === '["current"]', g.dropped);
  ['javascript:alert(1)', 'http://example.com/2027', 'ftp://files.example.com/x', 'https://', 'https:// space.com', 'https://exa mple.com/x', 'https://' + long + '.com/' + long].forEach(function (u) {
    var r = got({ method: 'brief', brief: { text: 'x', current: u } });
    check('E.1 the link ' + JSON.stringify(u.slice(0, 40)) + ' is dropped, and named', r.brief.current === '' && r.dropped.indexOf('current') !== -1, [r.brief.current, r.dropped]);
  });
  /* the server's rule (dash-bot.js cleanUrl): https: in any case, read by the URL parser, kept word for word */
  ['Https://retail.economictimes.indiatimes.com/summit-2026', 'https://example.com/women\'s-forum', 'https://et_retail.example.com/x', 'HTTPS://EXAMPLE.COM/A',
    'https://example.com/a?b=1#c'].forEach(function (u) {
    var r = got({ method: 'brief', brief: { text: '', current: u, previous: u } });
    check('E.1 the link ' + JSON.stringify(u) + ' is kept word for word, on the brief path', r.brief.current === u && r.brief.previous === u && r.method === 'brief' && !r.dropped.length, r);
  });

  /* ---- what the server keeps, take() keeps: dash-bot.js cleanCreate's own output, stored as the dashboard stores it ---- */
  var serverT = require('./dash-bot')._test;
  function viaServer(raw, message) {
    var made = serverT.cleanCreate(raw, { message: message, today: '2026-11-03', view: null });
    var record = clone(made.prefill);                        // dash-bot-client.js runCreate: the prefill, and who it is from
    record.v = 1; record.from = 'etb2b-ai'; record.at = NOW - 1000; record.turnId = ID; record.prefillId = ID;
    return { server: made.prefill, got: takeOne(record).got };
  }
  [['Https://retail.economictimes.indiatimes.com/summit-2026', 'Make our site from Https://retail.economictimes.indiatimes.com/summit-2026'],
    ['https://example.com/women\'s-forum', 'Generate a site from this brief: https://example.com/women\'s-forum'],
    ['https://et_retail.example.com/x', 'Last year\'s site was https://et_retail.example.com/x, make this year\'s']].forEach(function (c) {
    var v = viaServer({ method: 'brief', currentUrl: c[0], previousUrl: c[0] }, c[1]);
    check('E.1 server → take(): the server keeps ' + JSON.stringify(c[0]), v.server.brief.current === c[0] && v.server.brief.previous === c[0], v.server.brief);
    check('E.1 server → take(): … and so does Create Event, on the brief path', !!v.got && v.got.brief.current === c[0] && v.got.brief.previous === c[0] && v.got.method === 'brief' &&
      !v.got.dropped.length, v.got);
    var r = Prefill.apply(freshS(), freshCats(), v.got, { slugify: SLUGIFY });
    check('E.1 server → take() → apply(): the links are filled, and the summary names them', r.fields.indexOf('current') !== -1 && r.fields.indexOf('previous') !== -1 && !r.unused.length &&
      r.values.links === 2 && /from your message: your two links\./.test(Prefill.summary(r)), [r, Prefill.summary(r)]);
  });
  /* QA F7: Create Event opens on the method screen, which shows none of the values, so the note says them, as the
     dashboard's card did, and that the web address was made from the name (the person never typed one) */
  var f7 = viaServer({ category: 'IP', name: 'QA Dashbot Expo', venue: 'Jio World Centre', city: 'Mumbai', dateMode: 'exact', start: '2027-02-12' },
    'Create an IP event called QA Dashbot Expo on 12 Feb 2027 at Jio World Centre, Mumbai');
  var f7r = Prefill.apply(freshS(), freshCats(), f7.got, { slugify: SLUGIFY });
  check('E.1 F7: the note names the values: "IP event · QA Dashbot Expo · 12 Feb 2027 · Jio World Centre, Mumbai"', f7r.phase === 'method' &&
    Prefill.summary(f7r).indexOf('Filled in by ETB2B AI from your message: IP event · QA Dashbot Expo · 12 Feb 2027 · Jio World Centre, Mumbai. ') === 0, Prefill.summary(f7r));
  check('E.1 F7: … says the web address was made from the name', Prefill.summary(f7r).indexOf(' Its web address, qa-dashbot-expo, was made from the name. ') !== -1, Prefill.summary(f7r));
  check('E.1 F7: … and where to check them from the method screen', Prefill.summary(f7r).indexOf(' Choose how to build your site, then check them on the details form. ') !== -1, Prefill.summary(f7r));
  var f7b = viaServer({ category: 'Client', name: 'QA Roundtable', client: 'Acme', city: 'Pune', dateMode: 'month', month: '2027-03' }, 'Create a client roundtable called QA Roundtable for Acme in Pune in March 2027');
  var f7br = Prefill.apply(freshS(), freshCats(), f7b.got, { slugify: SLUGIFY });
  check('E.1 F7: a month, a city alone and a client read as the dashboard card wrote them', Prefill.summary(f7br).indexOf('from your message: Client event · QA Roundtable · March 2027 · Pune · for Acme.') !== -1, Prefill.summary(f7br));
  var f7c = viaServer({ category: 'Awards', name: 'QA Awards', dateMode: 'quarter', quarter: 'Q1', year: '2027' }, 'Create the QA Awards in Q1 2027');
  check('E.1 F7: a quarter', Prefill.summary(Prefill.apply(freshS(), freshCats(), f7c.got, { slugify: SLUGIFY })).indexOf('from your message: Awards · QA Awards · Q1 2027.') !== -1,
    Prefill.summary(Prefill.apply(freshS(), freshCats(), f7c.got, { slugify: SLUGIFY })));
  check('E.1 F7: a caller with no values still gets the fields named', /from your message: name and date\./.test(Prefill.summary({ fields: ['name', 'dates'], notes: [], phase: 'details' })));
  /* QA follow-up 2 F4: the person asked for ETCIO while working in ETHRWorld, and the method screen it opens on shows no
     portal, so the note's values line names it with the type */
  var NAMES = { cio: 'ETCIO', hr: 'ETHRWorld' };
  function nameOf(slug) { return NAMES[slug] || ''; }
  var f4 = viaServer({ category: 'IP', name: 'QA Dashbot CIO Expo', venue: 'Jio World Centre', city: 'Mumbai', dateMode: 'exact', start: '2027-02-12', portal: 'cio' },
    'Create an IP event on ETCIO called QA Dashbot CIO Expo on 12 Feb 2027 at Jio World Centre, Mumbai');
  var f4r = Prefill.apply(freshS(), freshCats(), f4.got, { slugify: SLUGIFY, portalName: nameOf });
  check('E.1 F4: the note names the portal with the type: "IP event on ETCIO · …"', f4.got.portal === 'cio' && f4r.values.portal === 'ETCIO' &&
    Prefill.summary(f4r).indexOf('Filled in by ETB2B AI from your message: IP event on ETCIO · QA Dashbot CIO Expo · 12 Feb 2027 · Jio World Centre, Mumbai. ') === 0, Prefill.summary(f4r));
  var f4n = Prefill.apply(freshS(), freshCats(), takeOne(stored({ category: '', portal: 'hr' })).got, { slugify: SLUGIFY, portalName: nameOf });
  check('E.1 F4: … with the type still to choose: "Event on ETHRWorld · …"', Prefill.summary(f4n).indexOf('from your message: Event on ETHRWorld · Retail Leadership Summit · ') !== -1, Prefill.summary(f4n));
  var f4u = Prefill.apply(freshS(), freshCats(), f4.got, { slugify: SLUGIFY, portalName: function () { return ''; } });
  check('E.1 F4: a portal whose name is not known yet is not named (never its bare slug)', f4u.values.portal === '' &&
    Prefill.summary(f4u).indexOf('from your message: IP event · QA Dashbot CIO Expo · ') !== -1 && Prefill.summary(f4u).indexOf('cio ·') === -1, Prefill.summary(f4u));
  var f4t = Prefill.apply(freshS(), freshCats(), f4.got, { slugify: SLUGIFY, portalName: function () { throw new Error('x'); } });
  check('E.1 F4: … nor when the page\'s name lookup fails', f4t.values.portal === '' && /from your message: IP event · /.test(Prefill.summary(f4t)));
  check('E.1 F4: a caller that passes no portalName gets the values line as before', /from your message: IP event · QA Dashbot CIO Expo · /.test(Prefill.summary(Prefill.apply(freshS(), freshCats(), f4.got, { slugify: SLUGIFY }))));
  var f4x = Prefill.apply(freshS(), freshCats(), f4.got, { slugify: SLUGIFY, portalName: function () { return 'ET<b>CIO</b>\n2'; } });
  check('E.1 F4: the name is one line of text', f4x.values.portal === 'ET<b>CIO</b> 2', f4x.values.portal);
  [[{ category: 'IP', name: 'QA Expo', venue: 'jio world centre', city: 'Mumbai', dateMode: 'exact', start: '2027-02-12' }, 'Create an IP event called QA Expo on 12 Feb 2027 at Jio World Centre, Mumbai'],
    [{ category: 'Client', name: 'QA Roundtable', client: 'Acme', city: 'Pune', dateMode: 'month', month: '2027-03' }, 'Create a client roundtable called QA Roundtable for Acme in Pune in March 2027'],
    [{ category: 'Awards', name: 'QA Awards', dateMode: 'quarter', quarter: 'Q1', year: '2027' }, 'Create the QA Awards in Q1 2027'],
    [{ category: 'IP', name: 'QA Forum', dateMode: 'tbd' }, 'Create an IP event called QA Forum, date to be announced'],
    [{ method: 'brief', briefFromMessage: true, previousUrl: 'https://et.example.com/2026' }, 'Generate a site from this brief: QA Retail Forum, a one-day forum. Last year: https://et.example.com/2026']
  ].forEach(function (c) {
    var v = viaServer(c[0], c[1]);
    check('E.1 server → take(): every field the server kept arrives unchanged — ' + c[1].slice(0, 48), !!v.got && v.got.category === v.server.category && v.got.method === v.server.method &&
      JSON.stringify(v.got.basics) === JSON.stringify(v.server.basics) && JSON.stringify(v.got.brief) === JSON.stringify(v.server.brief) && !v.got.dropped.length, [v.server, v.got]);
  });
  g = got({ method: 'brief', brief: { text: '', current: '', previous: '' } });
  check('E.1 "brief" with no text and no link → no method', g.method === '', g.method);
  g = got({ method: '', brief: { text: 'Our brief' } });
  check('E.1 a brief with no method → the brief path', g.method === 'brief' && g.brief.text === 'Our brief', g);
  g = got({ method: 'template', brief: { text: 'Our brief', previous: 'https://x.example.com/' } });
  check('E.1 the template path carries no brief', g.method === 'template' && g.brief.text === '' && g.brief.previous === '', g.brief);
  g = got({ method: 'brief', brief: { text: new Array(5000).join('b') + '\r\nend\u0000' } });
  check('E.1 a brief is cut to 4,000 characters; its control characters go', g.brief.text.length === 4000 && g.brief.text.indexOf('\u0000') === -1, g.brief.text.length);
  g = got({ method: 'brief', brief: { text: 'Line one\r\n\tLine two' } });
  check('E.1 a brief keeps its lines and tabs', g.brief.text === 'Line one\n\tLine two', g.brief.text);
  g = got({ method: 'publish' });
  check('E.1 an unknown method → none', g.method === '');
  g = got({ category: 'Webinar' });
  check('E.1 an unknown category → none', g.category === '');
  g = got({ portal: 'etretail' });
  check('E.1 a portal slug is kept', g.portal === 'etretail');
  g = got({ portal: 'ET Retail<script>' });
  check('E.1 a portal that is not a slug is dropped', g.portal === '');
  g = got({ turnId: 'bad id' });
  check('E.1 a turn id that is not one is dropped', g.turnId === '' && g.prefillId === ID);

  /* ---- decide: never a silent replace ---- */
  var bools = [false, true], seen = {};
  bools.forEach(function (startNew) { bools.forEach(function (st) { bools.forEach(function (input) { bools.forEach(function (discard) { [null, { v: 1 }].forEach(function (p) {
    var r = Prefill.decide({ startNew: startNew, prefill: p, stored: st, hasInput: input, discard: discard });
    seen[r] = true;
    var want = !p ? 'start' : (st && input) ? 'ask' : 'apply';
    check('E.1 decide ' + JSON.stringify({ startNew: startNew, stored: st, hasInput: input, discard: discard, prefill: !!p }) + ' → ' + want, r === want, r);
  }); }); }); }); });
  check('E.1 decide only ever answers start, apply or ask', Object.keys(seen).sort().join() === 'apply,ask,start', Object.keys(seen));
  check('E.1 decide with nothing → start', Prefill.decide() === 'start' && Prefill.decide({}) === 'start');

  /* ---- apply: on a copy of the page's own blank draft and CATS ---- */
  function run(p, prep) {
    var S = freshS(), C = freshCats();
    if (prep) prep(S);
    var r = Prefill.apply(S, C, p, { slugify: SLUGIFY });
    return { S: S, r: r };
  }
  function cleaned(over) { return takeOne(stored(over)).got; }

  var a = run(cleaned());
  check('E.1 apply: category + nothing else chosen → the method screen', a.r.phase === 'method' && a.S.step1Phase === 'method' && a.S.creationMethod === null && a.S.catReturnPhase === null, a.r);
  check('E.1 apply: the category, name and place are filled', a.S.basics.category === 'IP' && a.S.basics.name === 'Retail Leadership Summit' && a.S.basics.venue === 'Jio World Centre, Mumbai', a.S.basics);
  check('E.1 apply: the address follows the name, as when typed (slugTouched stays false)', a.S.basics.slug === 'retail-leadership-summit' && a.S.basics.slugTouched === false, a.S.basics);
  check('E.1 apply: the logo is never touched', a.S.basics.logo === false && a.S.basics.logoName === '');
  check('E.1 apply: an exact date fits the page\'s datetime boxes (9:00 am to 6:00 pm that day)', a.S.basics.dateMode === 'exact' && a.S.basics.start === '2027-02-12T09:00' && a.S.basics.end === '2027-02-12T18:00', a.S.basics);
  check('E.1 apply: … and that is said (times and end assumed)', a.r.notes.indexOf('times-assumed') !== -1 && a.r.notes.indexOf('end-assumed') !== -1, a.r.notes);
  check('E.1 apply: the city goes in the one "Venue & city" box; the hidden city field stays empty', a.S.basics.city === '', a.S.basics.city);
  check('E.1 apply: fields name what was filled', JSON.stringify(a.r.fields) === JSON.stringify(['category', 'name', 'slug', 'dates', 'venue', 'city']), a.r.fields);
  check('E.1 apply: no client for an IP event', a.S.basics.client === '');
  check('E.1 apply: category + no brief → thenDetails false, nothing unused', a.r.thenDetails === false && JSON.stringify(a.r.unused) === '[]', a.r);

  a = run(cleaned({ basics: { start: '2027-02-12', end: '2027-02-13' } }));
  check('E.1 apply: a two-day event runs 9:00 am on the first to 6:00 pm on the last', a.S.basics.start === '2027-02-12T09:00' && a.S.basics.end === '2027-02-13T18:00' &&
    a.r.notes.join() === 'times-assumed', [a.S.basics.start, a.S.basics.end, a.r.notes]);
  a = run(cleaned({ basics: { start: '2027-02-12T10:30', end: '2027-02-12T16:00' } }));
  check('E.1 apply: times given are kept, nothing assumed', a.S.basics.start === '2027-02-12T10:30' && a.S.basics.end === '2027-02-12T16:00' && !a.r.notes.length, a.r.notes);
  a = run(cleaned({ basics: { start: '2027-02-12T19:00', end: '' } }));
  check('E.1 apply: an evening start with no end never ends before it starts', a.S.basics.end >= a.S.basics.start, [a.S.basics.start, a.S.basics.end]);

  a = run(cleaned({ category: 'Client', method: 'brief', basics: { client: 'Acme', city: 'Bengaluru', venue: '' }, brief: { text: 'A one-day forum.', current: 'https://x.example.com/2027' } }));
  check('E.1 apply: category + brief → the brief form (details)', a.r.phase === 'details' && a.S.creationMethod === 'brief' && a.S.catReturnPhase === null, a.r);
  check('E.1 apply: the brief and its link are filled', a.S.brief.text === 'A one-day forum.' && a.S.brief.current === 'https://x.example.com/2027' && a.S.brief.previous === '', a.S.brief);
  check('E.1 apply: no client on the brief form, where it is hidden', a.S.basics.client === '' && a.r.fields.indexOf('client') === -1);
  check('E.1 apply: … and that client is named as not used', JSON.stringify(a.r.unused) === '["client"]' && /Not used from your message: client\.$/.test(Prefill.summary(a.r)), [a.r.unused, Prefill.summary(a.r)]);
  check('E.1 apply: a city alone fills the place box', a.S.basics.venue === 'Bengaluru' && a.r.fields.indexOf('city') !== -1 && a.r.fields.indexOf('venue') === -1, a.r.fields);

  a = run(cleaned({ category: 'Client', method: 'template', basics: { client: 'Acme' } }));
  check('E.1 apply: a Client event on the template path takes its client', a.S.basics.client === 'Acme' && a.r.fields.indexOf('client') !== -1 && a.r.phase === 'method');

  a = run(cleaned({ category: '', method: 'brief', brief: { text: 'Brief text', previous: 'https://et.example.com/2026' } }), function (S) { S.brief.etEvent = { link: 'x' }; });
  check('E.1 apply: no category + brief → the type picker, which goes on to the brief form (thenDetails)', a.r.phase === 'category' && a.r.thenDetails === true && a.S.creationMethod === 'brief', a.r);
  check('E.1 apply: … as a first choice: no type is made to look chosen (catReturnPhase stays null)', a.S.catReturnPhase === null, a.S.catReturnPhase);
  check('E.1 apply: … the summary says the type comes first', Prefill.summary(a.r).indexOf('Filled in by ETB2B AI from your message: Retail Leadership Summit · 12 Feb 2027 · ' +
    'Jio World Centre, Mumbai · your brief · your link. Its web address, retail-leadership-summit, was made from the name. ' +
    'Choose the event type, and your brief opens with them. Your message gave no end or times') === 0, Prefill.summary(a.r));
  check('E.1 apply: a previous-edition link typed in is not an event picked from ET\'s list', a.S.brief.previous === 'https://et.example.com/2026' && a.S.brief.etEvent === null);

  a = run(cleaned({ category: '', method: '', basics: { name: '', dateMode: '', start: '', venue: '', city: '' } }));
  check('E.1 apply: nothing → the type picker, and nothing filled', a.r.phase === 'category' && a.S.catReturnPhase === null && a.S.creationMethod === null && !a.r.fields.length &&
    a.r.thenDetails === false && !a.r.unused.length, a.r);
  check('E.1 apply: nothing → the draft is the blank draft (but for the phase)', (function () {
    var blank = freshS(); blank.step1Phase = a.S.step1Phase; blank.catReturnPhase = a.S.catReturnPhase; return JSON.stringify(blank) === JSON.stringify(a.S);
  })());

  a = run(cleaned({ category: 'Client', basics: { dateMode: '', start: '' } }), function (S) { S.basics.dateMode = 'quarter'; });
  check('E.1 apply: the date format is fixed for the type, as pickCategory does', a.S.basics.dateMode === 'exact', a.S.basics.dateMode);
  a = run(cleaned({ category: 'Awards', basics: { dateMode: 'month', start: '', month: '2027-03' } }));
  check('E.1 apply: Awards in a month', a.S.basics.dateMode === 'month' && a.S.basics.month === '2027-03' && a.r.fields.indexOf('dates') !== -1);
  a = run(cleaned({ category: 'IP', basics: { dateMode: 'quarter', start: '', quarter: 'Q2', year: '2027' } }));
  check('E.1 apply: IP in a quarter', a.S.basics.dateMode === 'quarter' && a.S.basics.quarter === 'Q2' && a.S.basics.year === '2027');
  a = run(cleaned({ category: 'Client', basics: { dateMode: 'none', start: '' } }));
  check('E.1 apply: "no date" said is a date choice filled', a.S.basics.dateMode === 'none' && a.r.fields.indexOf('dates') !== -1);
  a = run(cleaned({ category: 'IP', basics: { dateMode: 'exact', start: '' } }));
  check('E.1 apply: an exact format with no date is not "filled"', a.r.fields.indexOf('dates') === -1 && a.S.basics.start === '');
  a = run(cleaned({ basics: { venue: 'Jio World Centre, Mumbai', city: 'mumbai' } }));
  check('E.1 apply: a city the venue already names is not added twice', a.S.basics.venue === 'Jio World Centre, Mumbai' && a.r.fields.indexOf('city') === -1, a.S.basics.venue);
  /* the page's draft has a portal box since the portals change (S.basics.portal); a draft without one is kept below,
     with the box taken out, so the rule for it stays held */
  a = run(cleaned({ portal: 'etretail' }), function (S) { delete S.basics.portal; });
  check('E.1 apply: a draft with no portal box (before the portals change): ignored', !('portal' in a.S.basics) && a.r.fields.indexOf('portal') === -1 && a.r.unused.indexOf('portal') === -1);
  check('E.1 the page\'s new draft has the portal box, empty', freshS().basics.portal === '');
  a = run(cleaned({ portal: 'retail' }));
  check('E.1 apply: the portal ETB2B AI brought fills the portal box and is named as filled (the page checks it against ET\'s roster: portalArrived)',
    a.S.basics.portal === 'retail' && a.r.fields.indexOf('portal') !== -1 && a.r.unused.indexOf('portal') === -1, a.r);
  a = run(cleaned({ portal: '' }));
  check('E.1 apply: no portal brought: the box stays empty (the page then asks, or uses the working portal)', a.S.basics.portal === '' && a.r.fields.indexOf('portal') === -1);

  /* ---- what arrived and was not used is named ---- */
  a = run(cleaned({ category: 'IP', basics: { client: 'Acme' } }));
  check('E.1 apply: a client on an IP event (no client box) is named as not used', a.S.basics.client === '' && a.r.unused.indexOf('client') !== -1, a.r);
  a = run(cleaned({ category: 'Client', basics: { dateMode: 'quarter', start: '', quarter: 'Q2', year: '2027' } }));
  check('E.1 apply: a quarter for a Client event (no quarter format) is named: the date', a.r.fields.indexOf('dates') === -1 && a.r.unused.indexOf('dates') !== -1, a.r);
  a = run(cleaned({ category: '', basics: { dateMode: 'none', start: '' } }));
  check('E.1 apply: "no date" with no type yet (the page\'s default type has no such choice) is named: the date', a.r.unused.indexOf('dates') !== -1, a.r);
  a = run(cleaned({ category: 'Webinar' }));
  check('E.1 apply: a type the page does not have is named', a.r.unused.indexOf('category') !== -1 && a.r.fields.indexOf('category') === -1, a.r);
  a = run(cleaned({ method: 'brief', brief: { text: 'x', current: 'http://example.com/2027' } }));
  check('E.1 apply: a link take() dropped is named in the summary', a.r.unused.indexOf('current') !== -1 &&
    /Not used from your message: this edition’s link\.$/.test(Prefill.summary(a.r)), Prefill.summary(a.r));
  a = run(cleaned({ method: 'template', brief: { text: 'Our brief', previous: 'https://x.example.com/' } }));
  check('E.1 apply: a brief and link on the template path are named as not used', a.r.unused.indexOf('brief') !== -1 && a.r.unused.indexOf('previous') !== -1, a.r.unused);
  a = run(cleaned({ category: '', basics: { name: '', dateMode: '', start: '', venue: '', city: '', client: 'Acme' } }));
  check('E.1 apply: nothing filled but something unused: both said', /^ETB2B AI started a new event for you, but nothing in your message could be filled in\. Choose its type to begin\. Not used from your message: client\.$/.test(Prefill.summary(a.r)), Prefill.summary(a.r));
  a = run(cleaned({ portal: 'etretail' }), function (S) { S.basics.portal = ''; });
  check('E.1 apply: with a portal box, the portal is filled', a.S.basics.portal === 'etretail' && a.r.fields.indexOf('portal') !== -1);
  a = run(cleaned(), function (S) { S.createdEventId = 'existing-1'; S.basics.slug = 'existing-1'; });
  check('E.1 apply: an existing event\'s address is never changed', a.S.basics.slug === 'existing-1');
  a = run(cleaned(), function (S) { S.basics.slugTouched = true; S.basics.slug = 'my-own'; });
  check('E.1 apply: an address the person set is kept', a.S.basics.slug === 'my-own');
  a = run(cleaned(), function (S) { S.basics.logo = true; S.basics.logoName = 'logo.png'; });
  check('E.1 apply: a logo already there stays', a.S.basics.logo === true && a.S.basics.logoName === 'logo.png');
  check('E.1 apply: nothing to fill (no S) → no throw', (function () { try { Prefill.apply(null, freshCats(), cleaned()); return true; } catch (e) { return false; } })());

  /* ---- what the person reads ---- */
  check('E.1 describe: one', Prefill.describe(['name']) === 'name');
  check('E.1 describe: two', Prefill.describe(['name', 'venue']) === 'name and venue');
  check('E.1 describe: several, each once, unknown ones left out', Prefill.describe(['category', 'name', 'slug', 'dates', 'nope', 'venue', 'city']) === 'event type, name, web address, date, venue and city',
    Prefill.describe(['category', 'name', 'slug', 'dates', 'nope', 'venue', 'city']));
  var sum = Prefill.summary(run(cleaned()).r);
  check('E.1 summary: what was filled, and the times it assumed', sum === 'Filled in by ETB2B AI from your message: IP event · Retail Leadership Summit · 12 Feb 2027 · Jio World Centre, Mumbai. ' +
    'Its web address, retail-leadership-summit, was made from the name. Choose how to build your site, then check them on the details form. ' +
    'Your message gave no end or times, so it is set for that one day, 9:00 am to 6:00 pm: change them if needed.', sum);
  check('E.1 summary: nothing filled says so', /nothing in your message could be filled in/.test(Prefill.summary({ fields: [], notes: [] })));
  check('E.1 summary: times only', /gave no times, so it starts at 9:00 am and ends at 6:00 pm/.test(Prefill.summary({ fields: ['dates'], notes: ['times-assumed'] })));
  check('E.1 the words say ETB2B AI and never Revamp', !/Revamp CMS|\bRevamp\b(?!Prefill)/.test(PREFILL_SRC.replace(/RevampPrefill/g, '')));
})();

/* =============================================================================== E.2 create-event.html */
var CE_FNS = ['esc', 'slugify', 'init', 'keepOrAsk', 'takePrefill', 'prefillName', 'draftLabel', 'askResumeOrDiscard', 'startWithPrefill', 'applyAiPrefill',
  'aiDraftKey', 'renderAiPrefillNote', 'undoAiPrefill', 'clearAiPrefill', 'knownPortalName', 'nameAiNotePortal', 'isRosterPortal'];
function noteEl() {
  var els = {};
  function el(id) {
    var e = { id: id, attrs: {}, hidden: true, _html: '', onclick: null };
    e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
    e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
    Object.defineProperty(e, 'innerHTML', { get: function () { return e._html; }, set: function (v) {
      e._html = String(v);
      var m, re = /\sid="([^"]+)"/g;
      while ((m = re.exec(e._html))) els[m[1]] = el(m[1]);
    } });
    return e;
  }
  els['ai-prefill-note'] = el('ai-prefill-note');
  return els;
}
/* o: { search, stored, store (localStorage contents), noModule, resumed, noNote, roster ({ slug: name } as ET's roster
   came, {} while it has not), cachedName (what RevampPortals.nameOf knows before it: the remembered working portal),
   inAccount (the stored draft is safe in the person's account, or can be put there now: ensureInAccount, UX-048) } */
function page(o) {
  o = o || {};
  var log = { calls: [], modals: [] };
  var storage = fakeStorage(o.store || {});
  var ctx = {
    console: { log: function () {}, warn: function () {}, error: function () {} },
    URLSearchParams: URLSearchParams, URL: URL, Promise: Promise, JSON: JSON, Date: Date, Object: Object, String: String, Math: Math, isNaN: isNaN,
    location: { search: o.search || '', pathname: '/create-event.html', replace: function (u) { log.calls.push(['location.replace', u]); } },
    history: { replaceState: function (a, b, u) { log.calls.push(['replaceState', u]); } },
    localStorage: storage, CALLS: log.calls, MODALS: log.modals, STORED: o.stored || null, RESUMED: !!o.resumed, IN_ACCOUNT: !!o.inAccount,
    ELS: o.noNote ? {} : noteEl(), ROSTER: o.roster || {},
    RevampPortals: { nameOf: function (slug) { return o.cachedName && o.cachedName[slug] || ''; } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (!o.noModule) vm.runInContext(PREFILL_SRC, ctx, { filename: 'create-event-prefill.js' });
  var src = [
    'var S = ' + S_SRC + ';', 'var CATS = ' + CATS_SRC + ';', 'var SLUG_MAX = 48;', 'var BRIEF_TEMPLATE = "Tagline / theme: ";',
    'var aiPrefill = null, aiNote = null, busy = null, draftClosed = false, leavingUnsaved = false;',
    'var portalNames = ROSTER;',
    'var IC = { info: "<i></i>", spark: "<s></s>" };',
    'function $(id){ return ELS[id] || null; }',
    'function readStoredDraft(){ return STORED; }',
    'function draftHasInput(d){ return !!(d && d.hasInput); }',
    'function discardStoredDraft(d){ CALLS.push(["discard", d && d.draftId]); return Promise.resolve([]); }',
    /* UX-048: the draft in the person's account. The real ones ask the server (create-event-saves.test.js covers them) */
    'function migrateLegacyDraft(){ CALLS.push(["migrate"]); }',
    'function ensureInAccount(d){ CALLS.push(["ensure", d && d.draftId]); return Promise.resolve(IN_ACCOUNT); }',
    'function openDraft(id, local, fromAccount){ CALLS.push(["open", id, !!fromAccount]); start(local); }',
    /* the real start() restores the draft, then fills it (applyAiPrefill), then draws the form: here, the middle */
    'function start(){ CALLS.push(["start", aiPrefill ? aiPrefill.prefillId : null, aiNote ? aiNote.kind : null]); if (aiPrefill) applyAiPrefill(RESUMED); if (aiNote && aiNote.kind === "filled") aiNote.snap = aiDraftKey(); renderAiPrefillNote(); }',
    'function openModal(o){ MODALS.push(o); }',
    'function save(){ CALLS.push(["save"]); return true; }'
  ].concat(CE_FNS.map(function (n) { return fnSrc(CE_INLINE, n); })).join('\n');
  vm.runInContext(src, ctx, { filename: 'create-event.html (extracted)' });
  return { ctx: ctx, log: log, storage: storage, modal: function () { return log.modals[log.modals.length - 1]; },
    starts: function () { return log.calls.filter(function (c) { return c[0] === 'start'; }); },
    discards: function () { return log.calls.filter(function (c) { return c[0] === 'discard'; }); },
    replaced: function () { return log.calls.filter(function (c) { return c[0] === 'replaceState'; }).map(function (c) { return c[1]; }); } };
}
function storeWith(p, id) { var s = {}; s[PFX + (id || ID)] = JSON.stringify(p || stored({ at: Date.now() - 1000 })); return s; }
/* the type picker and the footer bar, from the page, over P's draft: what the person sees on the category screen.
   Since the portals change the same screen asks the portal first: the page's own portal rules come with it (the
   roster as ET's, two of its portals here), and only the drawing of the Portal box is left out. */
var PICKER_FNS = ['renderCatPicker', 'pickCategory', 'changeCategory', 'cancelChangeCategory', 'renderFoot',
  'isRosterPortal', 'portalName', 'portalLocked', 'commitPortal', 'showPortalError'];
function withPicker(P) {
  function plainEl(id) { return { id: id, hidden: false, disabled: false, textContent: '', innerHTML: '', attrs: {}, querySelectorAll: function () { return []; },
    setAttribute: function (k, v) { this.attrs[k] = String(v); }, removeAttribute: function (k) { delete this.attrs[k]; }, focus: function () {} }; }
  ['cat-grid', 'btn-back', 'btn-next', 'foot-note', 'cat-portal', 'cat-portal-error'].forEach(function (id) { P.ctx.ELS[id] = plainEl(id); });
  vm.runInContext([
    'var CAT_ICON = { IP: "", Client: "", Awards: "" };',
    'function svg(){ return "<svg></svg>"; }',
    'var BACK_LABEL = "Back";',
    'function toast(m){ CALLS.push(["toast", m]); }',
    /* the real one redraws the step; here, where it goes is what matters */
    'function setStep1Phase(ph){ S.step1Phase = ph; CALLS.push(["phase", ph]); }',
    'function renderAiEntry(){}', 'function renderAiHeroLine(){}', 'function placeToasts(){}', 'function setTimeout(){}',
    /* the roster has come (portalArrived); startPortal() puts the draft's own portal in the box */
    'var portalNames = { retail: "ETRetail", cio: "ETCIO" }, portalRosterLoading = null;',
    'var stepPortal = S.basics.portal || "", stepPortalFrom = "", stepPortalTouched = false;',
    'var etPick = { slug: "", showPickers: false };',
    'function renderPortalStep(){ CALLS.push(["portal-step", stepPortal]); }',
    'function sameLink(a, b){ return String(a || "") === String(b || ""); }'
  ].concat(PICKER_FNS.map(function (n) { return fnSrc(CE_INLINE, n); })).join('\n'), P.ctx, { filename: 'create-event.html (picker, extracted)' });
  return {
    /* the person picks a portal in the box, as its onPick does */
    choosePortal: function (slug) { P.ctx.stepPortal = slug; P.ctx.stepPortalFrom = ''; P.ctx.stepPortalTouched = true; },
    grid: function () { P.ctx.renderCatPicker(); return P.ctx.ELS['cat-grid'].innerHTML; },
    foot: function () { P.ctx.renderFoot(); return { back: P.ctx.ELS['btn-back'], note: P.ctx.ELS['foot-note'].textContent }; },
    phases: function () { return P.log.calls.filter(function (c) { return c[0] === 'phase'; }).map(function (c) { return c[1]; }); },
    toasts: function () { return P.log.calls.filter(function (c) { return c[0] === 'toast'; }).map(function (c) { return c[1]; }); }
  };
}

(async function e2() {
  /* ---- static: the file ---- */
  var tags = CE.match(/<script\b[^>]*>/g) || [];
  var at = tags.indexOf('<script src="create-event-prefill.js">'), inlineAt = tags.indexOf('<script>');
  check('E.2 create-event-prefill.js loads once, before the page\'s own script', count(CE, '<script src="create-event-prefill.js"></script>') === 1 && at !== -1 && at < inlineAt &&
    CE.indexOf('<script src="create-event-prefill.js">') < CE.indexOf(CE_INLINE), [at, inlineAt]);
  check('E.2 every extracted function is there', CE_FNS.every(function (n) { return !!fnSrc(CE_INLINE, n); }), CE_FNS.filter(function (n) { return !fnSrc(CE_INLINE, n); }));
  var init = fnSrc(CE_INLINE, 'init') || '';
  check('E.2 init() reads ?prefill= before history.replaceState strips the address', init.indexOf("params.get('prefill')") !== -1 &&
    init.indexOf("params.get('prefill')") < init.indexOf('history.replaceState'));
  check('E.2 the string discard=1 is not added anywhere (only the old comment has it)', count(CE, 'discard=1') === 1, count(CE, 'discard=1'));
  check('E.2 the discard parameter is still read in one place only for a page with no prefill', count(init, "params.get('discard') === '1' || !draftHasInput(stored)") === 1);
  var startFn = fnSrc(CE_INLINE, 'start') || '';
  check('E.2 start(): the details fill the draft after restore() and before the form is drawn', /var resumed = restore\(d\);[\s\S]*if \(aiPrefill\) applyAiPrefill\(resumed\);[\s\S]*initStep1\(\);/.test(startFn) &&
    startFn.indexOf('applyAiPrefill(resumed)') < startFn.indexOf('initStep1();'));
  check('E.2 start(): Undo\'s comparison is taken once the form is drawn', /goStep\(1\);\s*\/\*[^*]*\*\/\s*if \(aiNote && aiNote\.kind === 'filled'\) aiNote\.snap = aiDraftKey\(\);\s*\}$/.test(startFn));
  var renderFoot = fnSrc(CE_INLINE, 'renderFoot') || '';
  check('E.2 renderFoot() keeps the note in step (step left, a job running)', /^function renderFoot\(\)\{\s*var back[^\n]*\n\s*renderAiPrefillNote\(\);/.test(renderFoot));
  var prefillCode = ['takePrefill', 'askResumeOrDiscard', 'startWithPrefill', 'applyAiPrefill', 'renderAiPrefillNote', 'undoAiPrefill', 'clearAiPrefill', 'init']
    .map(function (n) { return fnSrc(CE_INLINE, n) || ''; }).join('\n');
  check('E.2 the prefill code never presses Generate or Continue', !/startGenerateFromBrief|onNext\(|btn-next|\.click\(\)/.test(prefillCode));
  var stepAt = CE.indexOf('<section class="step-wrap full" id="step-1" hidden>');
  var noteMarkup = '<div class="callout" id="ai-prefill-note" role="status" hidden></div>';
  check('E.2 #ai-prefill-note: a status callout at the top of step 1, above the three phases', count(CE, noteMarkup) === 1 && stepAt !== -1 &&
    CE.indexOf(noteMarkup) > stepAt && CE.indexOf(noteMarkup) < CE.indexOf('id="cat-picker"'));
  check('E.2 the note has its own spacing rule', /#ai-prefill-note\{ margin-bottom: 16px; \}/.test(CE));
  check('E.2 Undo asks first when the person typed since: "Undo also clears what you typed since"', (fnSrc(CE_INLINE, 'undoAiPrefill') || '').indexOf('Undo also clears what you typed since.') !== -1);
  es5('E.2 create-event.html\'s script', CE_INLINE);
  /* QA follow-up 2: Chrome runs a cross-page transition only when both pages ask for one. Create Event alone asked,
     so every move to the editor threw "InvalidStateError: Transition was aborted because of invalid state.
     ViewTransition opt-in disabled". No page asks now; one that does must be matched by every page it opens. */
  var asking = fs.readdirSync(ROOT).filter(function (f) { return /\.html$/.test(f); }).filter(function (f) {
    var css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    return /@view-transition\s*\{[^}]*navigation\s*:\s*auto/i.test(css);
  });
  check('E.2 no page asks for a cross-page transition alone (Create Event did, and every move to the editor threw)', asking.length === 0, asking);
  check('E.2 Create Event loads the portal field table before its own script (the hero line\'s field)', (function () {
    var t = CE.match(/<script\b[^>]*>/g) || [];
    var f = t.indexOf('<script src="portal-fields.js">');
    return count(CE, '<script src="portal-fields.js"></script>') === 1 && f !== -1 && f < t.indexOf('<script>') && access.isServableFile('portal-fields.js');
  })());
  check('E.2 what the prefill code says names ETB2B AI, never Revamp', /ETB2B AI/.test(prefillCode) && !/Revamp(?!Prefill)/.test(prefillCode.replace(/RevampPrefill/g, '')));

  /* ---- init(): the paths as they were, with no new parameter ---- */
  var P = page({ search: '', stored: { draftId: 'd1', hasInput: true } });
  P.ctx.init(); await wait();
  check('E.2 no parameter, a draft with input → it is resumed (start), nothing asked, the address kept', P.starts().length === 1 && !P.log.modals.length && !P.replaced().length && !P.discards().length, P.log.calls);
  P = page({ search: '' });
  P.ctx.init(); await wait();
  check('E.2 no parameter, no draft → start', P.starts().length === 1 && !P.log.modals.length && !P.replaced().length);
  P = page({ search: '?new=1' });
  P.ctx.init(); await wait();
  check('E.2 ?new=1, no draft → the address is tidied and a new event starts', P.starts().length === 1 && JSON.stringify(P.replaced()) === '["/create-event.html"]' && !P.discards().length, P.log.calls);
  P = page({ search: '?new=1', stored: { draftId: 'd1', hasInput: false } });
  P.ctx.init(); await wait();
  check('E.2 ?new=1, an empty draft → discarded, then start', JSON.stringify(P.discards()) === '[["discard","d1"]]' && P.starts().length === 1 && !P.log.modals.length, P.log.calls);
  P = page({ search: '?new=1&discard=1', stored: { draftId: 'd1', hasInput: true } });
  P.ctx.init(); await wait();
  check('E.2 ?new=1&discard=1, a draft with input → discarded without asking (a caller that already asked)', P.discards().length === 1 && P.starts().length === 1 && !P.log.modals.length);
  P = page({ search: '?new=1', stored: { draftId: 'd1', hasInput: true, basics: { name: 'Old Forum' } } });
  P.ctx.init(); await wait();
  var m = P.modal();
  check('E.2 ?new=1, a draft with input → "You have an unfinished event", as before', P.log.modals.length === 1 && m.title === 'You have an unfinished event' && m.confirm === 'Continue this draft' &&
    m.cancelLabel === 'Discard and start new' && !P.starts().length && m.body.indexOf('ETB2B AI') === -1, m);
  check('E.2 … Continue and closing it are the page\'s own start (unchanged)', m.onConfirm === P.ctx.start && m.onDismiss === P.ctx.start);
  m.onCancel();
  var d = P.modal();
  check('E.2 … Discard and start new asks "Discard “Old Forum”?"', d.title === 'Discard “Old Forum”?' && d.confirm === 'Discard draft' && d.cancelLabel === 'Keep it', d.title);
  d.onCancel();
  check('E.2 … Keep it asks the first question again', P.log.modals.length === 3 && P.modal().title === 'You have an unfinished event');
  P.modal().onCancel(); P.modal().onDismiss();
  check('E.2 … closing the discard question asks the first one again', P.modal().title === 'You have an unfinished event');
  P.modal().onCancel(); P.modal().onConfirm(); await wait();
  check('E.2 … Discard draft discards, then starts a new event', P.discards().length === 1 && P.starts().length === 1 && P.starts()[0][1] === null, P.log.calls);
  check('E.2 … the question says why it is asked: the draft is not in the account', m.body.indexOf('This draft is only in this browser: it could not be saved to your account just now, so it is not in your Drafts.') !== -1, m.body);

  /* ---- UX-048: drafts in the person's account ---- */
  P = page({ search: '?new=1', stored: { draftId: 'd1', hasInput: true, basics: { name: 'Old Forum' } }, inAccount: true });
  P.ctx.init(); await wait();
  check('UX-048 ?new=1, a draft with input that is safe in the account → a new event starts at once: nothing asked, nothing discarded',
    P.starts().length === 1 && !P.log.modals.length && !P.discards().length && P.log.calls.some(function (c) { return c[0] === 'ensure' && c[1] === 'd1'; }), P.log.calls);
  P = page({ search: '?draft=draft-abc-123' });
  P.ctx.init(); await wait();
  check('UX-048 ?draft=<id> (Resume on the dashboard) opens that draft', P.log.calls.some(function (c) { return c[0] === 'open' && c[1] === 'draft-abc-123' && c[2] === false; }) && P.starts().length === 1, P.log.calls);
  P = page({ search: '?draft=draft-abc-123&from=account' });
  P.ctx.init(); await wait();
  check('UX-048 ?draft=<id>&from=account ("Open the newer one") opens the account\'s copy', P.log.calls.some(function (c) { return c[0] === 'open' && c[2] === true; }));
  P = page({ search: '', stored: { draftId: 'd1', hasInput: true } });
  P.ctx.init(); await wait();
  check('UX-048 the bare page opens the draft this browser worked on last, checked against the account', P.log.calls.some(function (c) { return c[0] === 'open' && c[1] === 'd1'; }) && P.log.calls[0][0] === 'migrate');

  /* ---- init() with ETB2B AI's details ---- */
  var good = stored({ at: Date.now() - 1000 });
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good) });
  P.ctx.init(); await wait();
  check('E.2 a prefill, no draft → the address is tidied and the new draft is filled', JSON.stringify(P.replaced()) === '["/create-event.html"]' && P.starts().length === 1 &&
    P.starts()[0][1] === ID && P.ctx.S.basics.name === 'Retail Leadership Summit' && P.ctx.S.step1Phase === 'method', P.log.calls);
  check('E.2 … read once: its key is gone from localStorage', P.storage.getItem(PFX + ID) === null);
  check('E.2 … saved, with a record of where it came from', P.log.calls.some(function (c) { return c[0] === 'save'; }) && P.ctx.S.aiPrefill && P.ctx.S.aiPrefill.turnId === ID &&
    P.ctx.S.aiPrefill.fields.indexOf('name') !== -1 && typeof P.ctx.S.aiPrefill.at === 'number' && P.ctx.S.aiPrefill.thenDetails === false, P.ctx.S.aiPrefill);
  check('E.2 … the prefill is used once (not held for a later start)', P.ctx.aiPrefill === null);
  var note = P.ctx.ELS['ai-prefill-note'];
  check('E.2 … the note says what was filled, with Undo', P.ctx.aiNote.kind === 'filled' && note.hidden === false &&
    note.innerHTML.indexOf('Filled in by ETB2B AI from your message: IP event · Retail Leadership Summit · 12 Feb 2027 · Jio World Centre, Mumbai. ' +
      'Its web address, retail-leadership-summit, was made from the name. Choose how to build your site, then check them on the details form.') !== -1 &&
    note.innerHTML.indexOf('id="ai-prefill-undo">Undo</button>') !== -1 && typeof P.ctx.ELS['ai-prefill-undo'].onclick === 'function', note.innerHTML);

  /* Undo: nothing typed since → blank new event at once; typed since → asked first */
  P.ctx.ELS['ai-prefill-undo'].onclick(); await wait();
  check('E.2 Undo with nothing typed since: the draft is discarded and the page opens on a blank new event', P.log.calls.some(function (c) { return c[0] === 'discard'; }) &&
    P.log.calls.some(function (c) { return c[0] === 'location.replace' && c[1] === '/create-event.html?new=1'; }) && !P.log.modals.length, P.log.calls.slice(-3));
  check('E.2 … nothing may write the draft back, the browser does not ask about leaving, and the note is gone',
    P.ctx.draftClosed === true && P.ctx.leavingUnsaved === true && P.ctx.aiNote === null && note.hidden === true);
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good) });
  P.ctx.init(); await wait();
  P.ctx.S.basics.name = 'Retail Leadership Summit 2027';
  P.ctx.ELS['ai-prefill-undo'].onclick(); await wait();
  m = P.modal();
  check('E.2 Undo after typing: asked first, with "Undo also clears what you typed since."', !!m && m.sub.indexOf('Undo also clears what you typed since.') === 0 && m.confirm === 'Undo' &&
    !P.log.calls.some(function (c) { return c[0] === 'location.replace'; }), m);
  m.onConfirm(); await wait();
  check('E.2 … and Undo there clears it', P.log.calls.some(function (c) { return c[0] === 'location.replace' && c[1] === '/create-event.html?new=1'; }));
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good) });
  P.ctx.init(); await wait();
  P.ctx.S.step1Phase = 'details'; P.ctx.S.step = 1; P.ctx.S.brief.text = 'Tagline / theme: ';
  P.ctx.ELS['ai-prefill-undo'].onclick(); await wait();
  check('E.2 moving between phases, or the brief\'s empty headings appearing, is not typing: no question', !P.log.modals.length &&
    P.log.calls.some(function (c) { return c[0] === 'location.replace'; }));

  /* QA follow-up 2 F4: the note names the portal the event is on, as soon as ET's roster gives its name */
  var onCio = stored({ at: Date.now() - 1000, portal: 'cio' });
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(onCio), roster: { cio: 'ETCIO', hr: 'ETHRWorld' } });
  P.ctx.init(); await wait();
  check('E.2 F4: the roster is in: "IP event on ETCIO · …"', P.ctx.S.basics.portal === 'cio' &&
    P.ctx.ELS['ai-prefill-note'].innerHTML.indexOf('Filled in by ETB2B AI from your message: IP event on ETCIO · Retail Leadership Summit · 12 Feb 2027 · Jio World Centre, Mumbai. ') !== -1,
    P.ctx.ELS['ai-prefill-note'].innerHTML);
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(onCio) });
  P.ctx.init(); await wait();
  note = P.ctx.ELS['ai-prefill-note'];
  check('E.2 F4: the roster still on its way: the portal is not named yet, and never as its bare slug', note.innerHTML.indexOf('from your message: IP event · Retail Leadership Summit · ') !== -1 &&
    note.innerHTML.indexOf('cio') === -1, note.innerHTML);
  P.ctx.portalNames = { cio: 'ETCIO' };
  P.ctx.nameAiNotePortal();
  check('E.2 F4: …then the roster comes (portalArrived): the note is drawn again with it', note.innerHTML.indexOf('from your message: IP event on ETCIO · Retail Leadership Summit · ') !== -1 &&
    P.ctx.aiNote.kind === 'filled', note.innerHTML);
  check('E.2 F4: the page names the portal when its roster arrives', /nameAiNotePortal\(\);/.test(fnSrc(CE_INLINE, 'portalArrived') || ''));
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(onCio), cachedName: { cio: 'ETCIO' } });
  P.ctx.init(); await wait();
  check('E.2 F4: the remembered working portal\'s name is used before the roster comes', P.ctx.ELS['ai-prefill-note'].innerHTML.indexOf('IP event on ETCIO · ') !== -1);
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(onCio) });
  P.ctx.init(); await wait();
  P.ctx.S.basics.portal = 'hr'; P.ctx.portalNames = { cio: 'ETCIO', hr: 'ETHRWorld' };
  P.ctx.nameAiNotePortal();
  check('E.2 F4: a portal changed meanwhile is not named as the one ETB2B AI filled in', P.ctx.ELS['ai-prefill-note'].innerHTML.indexOf(' on ETCIO') === -1 &&
    P.ctx.ELS['ai-prefill-note'].innerHTML.indexOf(' on ETHRWorld') === -1);
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(onCio) });
  P.ctx.init(); await wait();
  P.ctx.portalNames = { hr: 'ETHRWorld' };
  P.ctx.nameAiNotePortal();
  check('E.2 F4: a portal off ET\'s roster is never named', P.ctx.ELS['ai-prefill-note'].innerHTML.indexOf('IP event on') === -1 && P.ctx.ELS['ai-prefill-note'].innerHTML.indexOf('IP event · ') !== -1);

  /* the note follows the page */
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good) });
  P.ctx.init(); await wait();
  note = P.ctx.ELS['ai-prefill-note'];
  var html = note.innerHTML;
  P.ctx.renderAiPrefillNote();
  check('E.2 the note is not redrawn when nothing changed (the keyboard stays on its button)', note.innerHTML === html && note.hidden === false);
  P.ctx.busy = { kind: 'brief' }; P.ctx.renderAiPrefillNote();
  check('E.2 the note hides while a job holds the screen', note.hidden === true && P.ctx.aiNote !== null);
  P.ctx.busy = null; P.ctx.renderAiPrefillNote();
  check('E.2 … and is back after it', note.hidden === false);
  P.ctx.undoAiPrefill.call(null);
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good) });
  P.ctx.init(); await wait();
  P.ctx.busy = { kind: 'brief' }; P.ctx.undoAiPrefill(); await wait();
  check('E.2 Undo does nothing while a job runs', !P.log.calls.some(function (c) { return c[0] === 'location.replace' || c[0] === 'discard'; }) && !P.log.modals.length);
  P.ctx.busy = null;
  P.ctx.S.step = 4; P.ctx.renderAiPrefillNote();
  check('E.2 the note is gone for good once step 1 is left', P.ctx.aiNote === null && P.ctx.ELS['ai-prefill-note'].hidden === true);
  P.ctx.S.step = 1; P.ctx.renderAiPrefillNote();
  check('E.2 … and does not come back on step 1', P.ctx.ELS['ai-prefill-note'].hidden === true);
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good) });
  P.ctx.init(); await wait();
  P.ctx.S.createdEventId = 'retail-leadership-summit'; P.ctx.renderAiPrefillNote();
  check('E.2 once the draft\'s event exists on the server, Undo to a blank event is no longer offered', P.ctx.aiNote === null && P.ctx.ELS['ai-prefill-note'].hidden === true);

  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(stored({ at: Date.now() - 1000, basics: { name: '<img src=x onerror=alert(1)>' } })) });
  P.ctx.init(); await wait();
  check('E.2 the note\'s words are shown as text', P.ctx.ELS['ai-prefill-note'].innerHTML.indexOf('<img') === -1);

  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good), stored: { draftId: 'd1', hasInput: false } });
  P.ctx.init(); await wait();
  check('E.2 a prefill, an empty draft → the empty draft is discarded first, then filled', JSON.stringify(P.discards()) === '[["discard","d1"]]' && P.starts().length === 1 && P.starts()[0][1] === ID &&
    P.log.calls.indexOf(P.discards()[0]) < P.log.calls.indexOf(P.starts()[0]), P.log.calls);

  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good), stored: { draftId: 'd1', hasInput: true, basics: { name: 'Old Forum' } } });
  P.ctx.init(); await wait();
  m = P.modal();
  check('E.2 a prefill and an unfinished draft → asked first, never replaced', P.log.modals.length === 1 && m.title === 'You have an unfinished event' && !P.starts().length && !P.discards().length);
  check('E.2 … the question says ETB2B AI\'s details are waiting', m.body.indexOf('ETB2B AI has the details of “Retail Leadership Summit” ready: they are used only if you start a new event.') !== -1, m.body);
  m.onConfirm(); await wait();
  check('E.2 … Continue keeps the draft; the details are not used, and the note says so', P.starts().length === 1 && P.starts()[0][1] === null && P.ctx.aiNote.kind === 'unused' &&
    P.ctx.aiNote.text === 'Your unfinished event is open. ETB2B AI’s details for “Retail Leadership Summit” were not used: finish or discard this one, then ask again.' &&
    P.ctx.S.basics.name === '' && !P.discards().length, [P.starts(), P.ctx.aiNote]);
  check('E.2 … that note has Dismiss, not Undo', /id="ai-prefill-dismiss">Dismiss</.test(P.ctx.ELS['ai-prefill-note'].innerHTML) && !P.ctx.ELS['ai-prefill-undo']);
  P.ctx.ELS['ai-prefill-dismiss'].onclick();
  check('E.2 … Dismiss hides it', P.ctx.aiNote === null && P.ctx.ELS['ai-prefill-note'].hidden === true);

  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good), stored: { draftId: 'd1', hasInput: true } });
  P.ctx.init(); await wait();
  P.modal().onDismiss(); await wait();
  check('E.2 … closing the question is Continue: the details are not used', P.starts().length === 1 && P.starts()[0][1] === null && P.ctx.aiNote.kind === 'unused');

  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good), stored: { draftId: 'd1', hasInput: true } });
  P.ctx.init(); await wait();
  P.modal().onCancel();
  P.modal().onCancel();
  check('E.2 … Keep it asks again, with the details still waiting', P.log.modals.length === 3 && P.modal().body.indexOf('ETB2B AI has the details') !== -1);
  P.modal().onCancel(); P.modal().onDismiss();
  check('E.2 … closing the discard question asks again, details still waiting', P.modal().title === 'You have an unfinished event' && P.modal().body.indexOf('ETB2B AI has the details') !== -1);
  P.modal().onCancel(); P.modal().onConfirm(); await wait();
  check('E.2 … Discard and start new, confirmed: discarded, then the new draft is filled', P.discards().length === 1 && P.starts().length === 1 && P.starts()[0][1] === ID &&
    P.ctx.S.basics.name === 'Retail Leadership Summit' && P.ctx.aiNote.kind === 'filled', P.log.calls);

  P = page({ search: '?new=1&discard=1&prefill=' + ID, store: storeWith(good), stored: { draftId: 'd1', hasInput: true } });
  P.ctx.init(); await wait();
  check('E.2 the discard parameter never skips the question for a prefill', P.log.modals.length === 1 && !P.discards().length && !P.starts().length);
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good), stored: { draftId: 'd1', hasInput: true, basics: { name: 'Old Forum' } }, inAccount: true });
  P.ctx.init(); await wait();
  check('UX-048 a prefill and an unfinished draft that is safe in the account → the new draft is filled at once, the old one kept (nothing asked, nothing discarded)',
    !P.log.modals.length && !P.discards().length && P.starts().length === 1 && P.starts()[0][1] === ID && P.ctx.S.basics.name === 'Retail Leadership Summit' && P.ctx.aiNote.kind === 'filled', P.log.calls);

  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good), resumed: true });
  P.ctx.init(); await wait();
  check('E.2 a draft that turned up meanwhile (another tab) is never written over: not used, and said', P.ctx.aiNote.kind === 'unused' && P.ctx.S.basics.name === '' &&
    !P.log.calls.some(function (c) { return c[0] === 'save'; }));

  P = page({ search: '?new=1&prefill=' + ID });
  P.ctx.init(); await wait();
  check('E.2 a prefill that is not there (used, expired) → a new event, and a note saying to ask again', P.starts().length === 1 && P.starts()[0][1] === null &&
    P.ctx.aiNote.kind === 'missing' && /not found\. They are kept for 10 minutes after you ask: ask again on the events dashboard\./.test(P.ctx.aiNote.text) &&
    JSON.stringify(P.replaced()) === '["/create-event.html"]');
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(stored({ at: Date.now() - 11 * 60000 })) });
  P.ctx.init(); await wait();
  check('E.2 an expired prefill → the same note, and it is removed', P.ctx.aiNote.kind === 'missing' && P.storage.getItem(PFX + ID) === null);
  P = page({ search: '?new=1&prefill=bad!', store: storeWith(good) });
  P.ctx.init(); await wait();
  check('E.2 a malformed id → the note, and nothing is read', P.ctx.aiNote.kind === 'missing' && P.ctx.S.basics.name === '');
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good), noModule: true });
  P.ctx.init(); await wait();
  check('E.2 create-event-prefill.js did not load → the page still starts, and says the details were not found', P.starts().length === 1 && P.ctx.aiNote.kind === 'missing');
  P = page({ search: '?prefill=' + ID, store: storeWith(good) });
  P.ctx.init(); await wait();
  check('E.2 ?prefill= without ?new=1 is still a new event (and the address is tidied)', P.starts().length === 1 && P.starts()[0][1] === ID && JSON.stringify(P.replaced()) === '["/create-event.html"]');
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(good), stored: { draftId: 'd1', hasInput: true } });
  P.ctx.init(); await wait();
  P.modal().onConfirm(); await wait();
  check('E.2 the prefill is gone from storage even when it was not used', P.storage.getItem(PFX + ID) === null);
  var noName = stored({ at: Date.now() - 1000, basics: { name: '' } });
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(noName), stored: { draftId: 'd1', hasInput: true } });
  P.ctx.init(); await wait();
  check('E.2 with no name, the question says "your new event"', P.modal().body.indexOf('ETB2B AI has the details of your new event ready') !== -1);

  /* ---- the brief path on the real page shapes ---- */
  var briefP = stored({ at: Date.now() - 1000, category: 'IP', method: 'brief', basics: { dateMode: 'month', start: '', month: '2027-03', venue: '', city: 'Bengaluru' },
    brief: { text: 'Generate a site from this brief: a one-day forum for retail CXOs in Bengaluru in March 2027.' } });
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(briefP) });
  P.ctx.init(); await wait();
  check('E.2 a brief → the brief details form, filled, and Generate is left to the person', P.ctx.S.step1Phase === 'details' && P.ctx.S.creationMethod === 'brief' &&
    P.ctx.S.basics.dateMode === 'month' && P.ctx.S.basics.month === '2027-03' && P.ctx.S.basics.venue === 'Bengaluru' && P.ctx.S.brief.text.indexOf('a one-day forum') !== -1, P.ctx.S.basics);

  /* ---- a brief with no type: the type picker is a first choice, then the brief form ---- */
  var LINK = 'Https://retail.economictimes.indiatimes.com/summit-2026';
  var noType = stored({ at: Date.now() - 1000, category: '', method: 'brief', basics: { name: '', dateMode: '', start: '', venue: '', city: '' },
    brief: { text: 'A one-day forum for retail CXOs.', current: LINK } });
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(noType) });
  P.ctx.init(); await wait();
  var K = withPicker(P);
  check('E.2 no type + brief: the type picker opens, and the brief and the link (as typed, "Https://") are in the draft', P.ctx.S.step1Phase === 'category' && P.ctx.S.creationMethod === 'brief' &&
    P.ctx.S.brief.text === 'A one-day forum for retail CXOs.' && P.ctx.S.brief.current === LINK && P.ctx.S.aiPrefill.thenDetails === true, [P.ctx.S.step1Phase, P.ctx.S.brief, P.ctx.S.aiPrefill]);
  check('E.2 … nothing pretends a type was chosen: catReturnPhase is null', P.ctx.S.catReturnPhase === null, P.ctx.S.catReturnPhase);
  var grid = K.grid();
  check('E.2 … the picker shows no type as "Current" (no badge, no aria-current)', grid.indexOf('category-current') === -1 && grid.indexOf('aria-current') === -1 && grid.indexOf('data-cat="IP"') !== -1, grid);
  var foot = K.foot();
  check('E.2 … the footer has no Cancel, and asks for the portal and a type (not "cancel to keep IP")', foot.back.hidden === true && foot.note === 'Choose the portal and a microsite type to continue.', [foot.back.hidden, foot.note]);
  check('E.2 … the note over step 1 says the type comes first, then the brief', P.ctx.ELS['ai-prefill-note'].innerHTML.indexOf('Choose the event type, and your brief opens with them.') !== -1 &&
    P.ctx.ELS['ai-prefill-note'].innerHTML.indexOf('from your message: your brief · your link.') !== -1, P.ctx.ELS['ai-prefill-note'].innerHTML);
  /* the prefill brought no portal (none was said, and the person works in All portals): a type is not taken without one */
  check('E.2 … no portal came with it: the Portal box is empty', P.ctx.S.basics.portal === '' && P.ctx.stepPortal === '');
  P.ctx.pickCategory('Client');
  check('E.2 … a type picked with no portal is not taken: the box asks for one, and the brief\'s way on is kept', JSON.stringify(K.phases()) === '[]' &&
    P.ctx.ELS['cat-portal-error'].textContent === 'Choose the portal first.' && P.ctx.ELS['cat-portal-error'].hidden === false && P.ctx.S.basics.category !== 'Client' &&
    P.ctx.S.aiPrefill.thenDetails === true, [K.phases(), P.ctx.ELS['cat-portal-error'].textContent]);
  K.choosePortal('retail');
  P.ctx.pickCategory('Client');
  check('E.2 … picking a type opens the brief form with it', JSON.stringify(K.phases()) === '["details"]' && P.ctx.S.basics.category === 'Client' && P.ctx.S.creationMethod === 'brief' &&
    P.ctx.S.catReturnPhase === null && P.ctx.S.brief.current === LINK, [K.phases(), P.ctx.S.basics.category]);
  check('E.2 … with the portal it is on: ETRetail', P.ctx.S.basics.portal === 'retail' && P.ctx.ELS['cat-portal-error'].hidden === true, P.ctx.S.basics.portal);
  check('E.2 … with a plain "selected" toast (no form was on screen to be "updated"), naming the portal chosen', JSON.stringify(K.toasts()) === '["ETRetail · Custom Events selected"]', K.toasts());
  check('E.2 … and the way to the brief form is used once', P.ctx.S.aiPrefill.thenDetails === false);
  /* afterwards the page works as it always did: Back to the method screen, change the type there → back to the method screen */
  P.ctx.S.step1Phase = 'method'; P.ctx.changeCategory();
  grid = K.grid(); foot = K.foot();
  check('E.2 … later, changing the type: now the chosen type is "Current", with Cancel', grid.indexOf('aria-current="true" data-cat="Client"') !== -1 && grid.indexOf('category-current') !== -1 &&
    foot.back.hidden === false && foot.back.textContent === 'Cancel' && foot.note === 'Pick a type, or cancel to keep ETRetail · Custom Events.', [foot.note]);
  P.ctx.pickCategory('Awards');
  check('E.2 … and that pick goes back to the method screen, as before', K.phases().slice(-1)[0] === 'method' && P.ctx.S.basics.category === 'Awards', K.phases());
  P.ctx.S.step1Phase = 'details'; P.ctx.changeCategory(); P.ctx.pickCategory('IP');
  check('E.2 … and from the form, back to the form', K.phases().slice(-1)[0] === 'details' && P.ctx.S.catReturnPhase === null, K.phases());

  /* the page with no prefill: a draft whose method is "brief", on the picker as a first choice, goes to the method screen as it always did */
  P = page({ search: '' });
  P.ctx.init(); await wait();
  K = withPicker(P);
  P.ctx.S.creationMethod = 'brief'; P.ctx.S.step1Phase = 'category';
  K.choosePortal('cio');
  P.ctx.pickCategory('IP');
  check('E.2 without ETB2B AI, a first pick goes to the method screen (unchanged)', JSON.stringify(K.phases()) === '["method"]' && P.ctx.S.basics.portal === 'cio', K.phases());

  /* the usual case: ETB2B AI brings the portal the person works in (or one they named), and the box opens on it */
  var withPortal = stored({ at: Date.now() - 1000, category: '', method: 'brief', portal: 'retail', basics: { name: '', dateMode: '', start: '', venue: '', city: '' },
    brief: { text: 'A one-day forum for retail CXOs.', current: '' } });
  P = page({ search: '?new=1&prefill=' + ID, store: storeWith(withPortal) });
  P.ctx.init(); await wait();
  K = withPicker(P);
  check('E.2 a prefill with a portal: the draft and the box hold it', P.ctx.S.basics.portal === 'retail' && P.ctx.stepPortal === 'retail' && P.ctx.S.aiPrefill.fields.indexOf('portal') !== -1, P.ctx.S.aiPrefill);
  P.ctx.pickCategory('IP');
  check('E.2 … a type picked goes straight on to the brief form, the portal unchanged (no portal in the toast)', JSON.stringify(K.phases()) === '["details"]' && P.ctx.S.basics.portal === 'retail' &&
    JSON.stringify(K.toasts()) === JSON.stringify([freshCats().IP.label + ' selected']), [K.phases(), K.toasts()]);
  var pickSrc = fnSrc(CE_INLINE, 'pickCategory') || '';
  check('E.2 pickCategory reads the brief\'s way on from S.aiPrefill.thenDetails, never from catReturnPhase alone', pickSrc.indexOf('S.aiPrefill.thenDetails') !== -1 &&
    /S\.aiPrefill\.thenDetails = false/.test(pickSrc));

  /* =============================================================================== E.3 marketing.html */
  await e3();
  await e4();
  await e5();
  await e6();
  await e7();
  console.log('dash-bot-handoff: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });

/* ---- marketing.html's own script in a vm, over a small fake DOM (the shape promotions-page.test.js uses) ---- */
var SHELL = (MK.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); })
  .filter(function (s) { return s.indexOf('var TABS = [') !== -1; })[0] || '';
function classList(initial) {
  var set = {};
  String(initial || '').split(/\s+/).filter(Boolean).forEach(function (c) { set[c] = true; });
  return { add: function (c) { set[c] = true; }, remove: function (c) { delete set[c]; }, contains: function (c) { return !!set[c]; },
    toggle: function (c, force) { var on = force === undefined ? !set[c] : !!force; if (on) set[c] = true; else delete set[c]; return on; } };
}
function loadShell(search) {
  var els = {}, urls = [], calls = { mount: [], ensure: [], focused: null };
  function attrsOf(s) { var a = {}, m, re = /([\w-]+)="([^"]*)"/g; while ((m = re.exec(s))) a[m[1]] = m[2]; return a; }
  function el(id, tag, attrs, parent) {
    attrs = attrs || {};
    var e = { id: id, tagName: tag.toUpperCase(), attrs: attrs, parentNode: parent || null, hidden: /\shidden(\s|$|>)/.test(attrs.__raw || ''),
      style: {}, listeners: {}, tabIndex: 0, textContent: '', _html: '', _tablist: null, classList: classList(attrs.class) };
    e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
    e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
    e.addEventListener = function (t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); };
    e.fire = function (t, ev) { (e.listeners[t] || []).forEach(function (fn) { fn(ev || {}); }); };
    e.focus = function () { calls.focused = e.id; };
    e.querySelector = function (sel) { return sel === '[role="tablist"]' ? e._tablist : null; };
    Object.defineProperty(e, 'innerHTML', { get: function () { return e._html; }, set: function (v) {
      e._html = String(v);
      var m, re = /<(\/?)(\w+)\b([^>]*)>/g, open = [e];
      while ((m = re.exec(e._html))) {
        if (m[1]) { if (open.length > 1) open.pop(); continue; }
        var a = attrsOf(m[3]); a.__raw = m[3];
        var c = el(a.id || '', m[2], a, open[open.length - 1]);
        if (!/^(br|hr|img|input|meta|link)$/i.test(m[2]) && !/\/\s*$/.test(m[3])) open.push(c);
        if (a.role === 'tablist') e._tablist = c;
        if (!a.id) continue;
        if (m[2] === 'iframe') c.contentWindow = { postMessage: function () {}, addEventListener: function () {} };
        els[a.id] = c;
      }
    } });
    return e;
  }
  ['ev-name', 'ev-meta', 'rail', 'view'].forEach(function (id) { els[id] = el(id, 'div'); });
  var doc = { documentElement: { classList: classList() }, title: '', getElementById: function (id) { return els[id] || null; } };
  var C = {
    $: function (id) { return doc.getElementById(id); },
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    svg: function () { return '<svg></svg>'; }, IC: { info: 'i' }, PORTALS: {}, TYPES: {},
    fmtDT: function () { return '12 Nov 2026'; }, emptyState: function (ic, t) { return '<div class="empty">' + t + '</div>'; },
    toast: function () {}, fetchEvent: function () { return Promise.resolve({ name: 'Agentic AI Summit' }); }, previewUrl: function (id) { return '/preview/' + id; }
  };
  var sb = {
    document: doc, console: { log: function () {}, error: function () {} }, URLSearchParams: URLSearchParams, setTimeout: setTimeout, clearTimeout: clearTimeout,
    location: { search: search, origin: 'https://oneworld.test', pathname: '/marketing.html', hash: '' },
    history: { replaceState: function (s, t, u) { urls.push(u); } }, pageYOffset: 0, scrollTo: function () {}, addEventListener: function () {},
    RevampCore: C,
    RevampPromo: { use: function () {}, load: function () { return Promise.resolve({ brand: {}, content: {} }); } },
    renderEventRail: function () {},
    RevampPromoPosts: { mount: function (host, ctx) { calls.mount.push({ host: host.id, ctx: ctx }); }, shown: function () {} },
    RevampPromoBanner: { ensure: function (id) { calls.ensure.push(id); return Promise.resolve({ ok: true }); } }
  };
  sb.window = sb;
  vm.runInNewContext(SHELL, sb, { filename: 'marketing.html' });
  function click(tabId) { els.view._tablist.fire('click', { target: { closest: function () { return { getAttribute: function () { return tabId; } }; } } }); }
  return { els: els, urls: urls, calls: calls, click: click, frame: function (id) { return els[id] || null; } };
}
function settle() { return wait(0).then(function () { return wait(0); }); }

async function e3() {
  check('E.3 the shell\'s script is found', !!SHELL);
  es5('E.3 marketing.html\'s script', SHELL);
  check('E.3 tabFrom is unchanged', SHELL.indexOf("function tabFrom(v){ return v === 'mailers' ? 'mailers' : v === 'site-posts' ? 'site-posts' : 'posts'; }") !== -1);
  check('E.3 MAILER_DEEP is unchanged', SHELL.indexOf("var MAILER_DEEP = (function(){\n    var q = new URLSearchParams(location.search), m = q.get('mailer'), v = q.get('version');\n" +
    "    return m ? '&mailer=' + encodeURIComponent(m) + (v ? '&version=' + encodeURIComponent(v) : '') : '';\n  })();") !== -1);
  check('E.3 the template and post names go through their patterns', SHELL.indexOf("/^[a-z]+\\.[a-z-]+$/.test(DEEP.get('template') || '')") !== -1 &&
    SHELL.indexOf("/^[a-z-]+$/.test(DEEP.get('post') || '')") !== -1);

  var M = loadShell('?event=ev-1&tab=posts&template=generic.announcement'); await settle();
  var f = M.frame('promo-social-frame');
  check('E.3 &template= reaches the Social posts frame', !!f && f.attrs.src === 'promo-social-studio.html?event=ev-1&template=generic.announcement', f && f.attrs.src);
  M = loadShell('?event=ev-1&template=speaker.individual'); await settle();
  check('E.3 … also when Social posts opens by default', M.frame('promo-social-frame').attrs.src === 'promo-social-studio.html?event=ev-1&template=speaker.individual');
  ['Generic.Announcement', 'generic.announcement"><script>x</script>', 'generic.announcement&x=1', 'generic.', '.announcement', 'generic.announce_1', 'a.b.c'].forEach(function (t) {
    var B = loadShell('?event=ev-1&tab=posts&template=' + encodeURIComponent(t));
    return settle().then(function () {
      check('E.3 a template name off its pattern is left out: ' + JSON.stringify(t), B.frame('promo-social-frame').attrs.src === 'promo-social-studio.html?event=ev-1', B.frame('promo-social-frame').attrs.src);
    });
  });
  await settle();
  M = loadShell('?event=ev-1&tab=mailers&template=generic.announcement'); await settle();
  M.click('posts');
  check('E.3 &template= counts only on the tab the page opens on', M.frame('promo-social-frame').attrs.src === 'promo-social-studio.html?event=ev-1');
  M = loadShell('?event=ev-1&tab=posts'); await settle();
  check('E.3 no template: the frame as before', M.frame('promo-social-frame').attrs.src === 'promo-social-studio.html?event=ev-1');

  M = loadShell('?event=ev-1&tab=site-posts&post=announce'); await settle();
  check('E.3 &post= is passed to Site-look posts as ctx.open', M.calls.mount.length === 1 && M.calls.mount[0].ctx.open === 'announce' && M.calls.mount[0].ctx.eventId === 'ev-1', M.calls.mount);
  ['Announce', 'a_b', '<x>', 'announce.x', ''].forEach(function (p) {
    var B = loadShell('?event=ev-1&tab=site-posts&post=' + encodeURIComponent(p));
    return settle().then(function () {
      check('E.3 a post name off its pattern is left out: ' + JSON.stringify(p), B.calls.mount.length === 1 && !('open' in B.calls.mount[0].ctx), B.calls.mount[0] && B.calls.mount[0].ctx);
    });
  });
  await settle();
  M = loadShell('?event=ev-1&tab=posts&post=announce'); await settle();
  M.click('site-posts');
  check('E.3 &post= counts only on the tab the page opens on', M.calls.mount.length === 1 && !('open' in M.calls.mount[0].ctx));
  M = loadShell('?event=ev-1&tab=site-posts'); await settle();
  check('E.3 no post: ctx as before (eventId, kit, toast only)', Object.keys(M.calls.mount[0].ctx).sort().join() === 'eventId,kit,toast', Object.keys(M.calls.mount[0].ctx));

  /* the mailer waiting on its tab */
  M = loadShell('?event=ev-1&tab=posts&template=generic.announcement&mailer=mailer.announcement'); await settle();
  var n = M.els['promo-mailer-waiting'];
  check('E.3 a mailer named while Social posts opens: a line under the tabs says it waits on Mailers', !!n && !n.hidden && n.attrs.role === 'status' &&
    M.els.view._html.indexOf('ETB2B AI also opened a mailer for you. It is ready on the Mailers tab.</span>') !== -1 && !!M.els['promo-mailer-open'] &&
    M.els['promo-mailer-open'].parentNode === n, M.els.view._html.slice(0, 900));
  check('E.3 … the line sits between the tabs and the panes', (function () { var v = M.els.view._html; return v.indexOf('role="tablist"') < v.indexOf('promo-mailer-waiting') && v.indexOf('promo-mailer-waiting') < v.indexOf('id="pane-posts"'); })());
  check('E.3 … the mailer frame is not made yet', !M.frame('promo-mailer-frame'));
  M.els['promo-mailer-open'].onclick();
  var mf = M.frame('promo-mailer-frame');
  check('E.3 Open Mailers: the Mailers tab, focused, with the mailer deep link', /tab=mailers$/.test(M.urls[M.urls.length - 1]) && M.calls.focused === 'tab-mailers' &&
    !!mf && mf.attrs.src === 'promo-mailer-studio.html?event=ev-1&mailer=mailer.announcement', [M.urls, M.calls.focused, mf && mf.attrs.src]);
  check('E.3 … and the line is gone', n.hidden === true && n._html === '');
  M.click('posts');
  check('E.3 … for good', n.hidden === true);
  M = loadShell('?event=ev-1&tab=site-posts&mailer=mailer.reminder'); await settle();
  n = M.els['promo-mailer-waiting'];
  check('E.3 the line shows on Site-look posts too', !!n && !n.hidden);
  M.click('mailers');
  check('E.3 showing Mailers by its tab removes the line', n.hidden === true && M.frame('promo-mailer-frame').attrs.src === 'promo-mailer-studio.html?event=ev-1&mailer=mailer.reminder');
  M = loadShell('?event=ev-1&tab=mailers&mailer=mailer.announcement'); await settle();
  check('E.3 a mailer on the Mailers tab itself: no line', !M.els['promo-mailer-waiting']);
  M = loadShell('?event=ev-1&tab=posts&template=generic.announcement'); await settle();
  check('E.3 no mailer: never a line', !M.els['promo-mailer-waiting'] && M.els.view._html.indexOf('ETB2B AI') === -1);
  check('E.3 the line has its own layout rule (wraps on a phone)', /\.promo-deep-note\{ margin-top:12px; align-items:center; flex-wrap:wrap; \}/.test(MK) &&
    /\.promo-deep-note > span\{ flex:1 1 220px; min-width:0; \}/.test(MK));
}

/* ---- the Social posts studio (social-studio.js + oneworld-social.js) on promo-social-adapter.test.js's DOM ---- */
function section(file, from, to) {
  var src = read(file), a = src.indexOf(from), b = src.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error(file + ': the section between "' + from + '" and "' + to + '" was not found; its stand-in DOM moved');
  return src.slice(a, b);
}
async function e4() {
  es5('E.4 oneworld-social.js', SOCIAL);
  var harness;
  try {
    harness = new Function('vm', 'htmlparser2', 'STUDIO', 'ADAPTER', 'PAGE',
      section('functions/lib/promo-social-adapter.test.js', '/* ================= a small DOM ================= */', 'function respJson(r)') +
      '\nreturn { boot: boot };')(vm, htmlparser2, read('promo-studio/social-studio.js'), SOCIAL, read('promo-social-studio.html'));
  } catch (e) { check('E.4 the studio\'s stand-in DOM loads', false, String(e && e.message)); return; }
  function bootWith(search, o) {
    o = o || {};
    o.search = search;
    var B = harness.boot(o), opened = [];
    var orig = B.ctx.openEditor;
    B.ctx.openEditor = function (id) { opened.push(id); return orig.apply(this, arguments); };
    B.opened = opened;
    return B;
  }
  function deepToasts(B) { return B.toasts.filter(function (t) { return /^That post/.test(t[0]); }); }

  var B = bootWith('?event=qa-1&template=generic.announcement');
  check('E.4 loads with no error', !B.loadErr, B.loadErr && String(B.loadErr));
  await until(function () { return B.opened.length > 0; }, 2000); await wait(50);
  check('E.4 an available template opens in the editor, once', JSON.stringify(B.opened) === '["generic.announcement"]', B.opened);
  check('E.4 … the editor is on, on that template', B.$('editor').classList.contains('on') && B.$('edTpl').value === 'generic.announcement', B.$('edTpl') && B.$('edTpl').value);
  check('E.4 … and the console is told the studio fills the window', B.posted.some(function (p) { return p.m && p.m.rvSocialStudio === 'open'; }));
  check('E.4 … no toast about it', !deepToasts(B).length, deepToasts(B));
  B.run('owBoot()');
  await wait(150);
  check('E.4 booting again (Try again) does not open it a second time', B.opened.length === 1, B.opened);

  B = bootWith('?event=qa-1&template=speaker.individual');
  B.message({ rvSocialTall: true });
  await until(function () { return deepToasts(B).length > 0; }, 2500);
  var t = deepToasts(B)[0] || [];
  check('E.4 a template the event cannot make yet: no editor, and a toast that says what it needs', !B.opened.length && t[0] === 'That post isn\'t available for this event yet: it needs speakers.' && t[1] === 6000, t);
  check('E.4 … shown by the console, since the frame is tall', B.posted.some(function (p) { return p.m && p.m.rvToast && p.m.rvToast.m === t[0] && p.m.rvToast.ms === 6000; }), B.posted.slice(-3));

  B = bootWith('?event=qa-1&template=generic.who-should-attend');
  var t0 = Date.now();
  await until(function () { return deepToasts(B).length > 0; }, 3500);
  t = deepToasts(B)[0] || [];
  check('E.4 not grown yet: the toast waits a moment for the frame, then shows in it', t[0] === 'That post isn\'t available for this event yet: it needs who should attend.' &&
    Date.now() - t0 >= 1500 && B.$('toast').textContent === t[0], [t, Date.now() - t0]);

  B = bootWith('?event=qa-1&template=generic.nope');
  B.message({ rvSocialTall: true });
  await until(function () { return deepToasts(B).length > 0; }, 2500);
  check('E.4 an unknown template: its toast, no editor', !B.opened.length && (deepToasts(B)[0] || [])[0] === 'That post template doesn\'t exist.', deepToasts(B));
  B = bootWith('?event=qa-1&template=' + encodeURIComponent('Generic.Announcement<b>'));
  B.message({ rvSocialTall: true });
  await until(function () { return deepToasts(B).length > 0; }, 2500);
  check('E.4 a name off the pattern is unknown too', !B.opened.length && (deepToasts(B)[0] || [])[0] === 'That post template doesn\'t exist.');

  B = bootWith('?event=qa-1');
  await wait(400);
  check('E.4 no parameter: no editor, no toast', !B.opened.length && !deepToasts(B).length && !B.$('editor').classList.contains('on'));

  B = bootWith('?event=qa-1&template=generic.announcement', { routes: { 'GET /api/promo/social/catalog': function () {
    return new Response(JSON.stringify({ error: 'That event does not exist.' }), { status: 404, headers: { 'content-type': 'application/json' } });
  } } });
  await wait(400);
  check('E.4 an event that is not found: nothing opened, no toast', !B.opened.length && !deepToasts(B).length);
}

/* ---- Site-look posts (promo-kit.js + promo-posts.js) on promo-posts.test.js's DOM ---- */
async function e5() {
  es5('E.5 promo-posts.js', POSTS);
  var H;
  try {
    H = new Function('vm', 'htmlparser2', 'KIT_SRC', 'POSTS_SRC', 'clone', 'until', 'tick',
      section('functions/lib/promo-posts.test.js', '/* ===================================================================== a stand-in DOM */',
        '/* ===================================================================== the checks */') +
      '\nreturn { makeEnv: makeEnv, richKit: richKit, noDateKit: noDateKit, sparseKit: sparseKit, E: E };')(vm, htmlparser2, read('promo-kit.js'), POSTS, clone, until,
      function (n) { var p = Promise.resolve(); for (var i = 0; i < (n || 20); i++) p = p.then(function () { return new Promise(function (ok) { setImmediate(ok); }); }); return p; });
  } catch (e) { check('E.5 the posts\' stand-in DOM loads', false, String(e && e.message)); return; }
  /* that DOM's tests never open the editor, so its fields have no value; a browser's do */
  if (!Object.getOwnPropertyDescriptor(H.E, 'value')) Object.defineProperty(H.E, 'value', { configurable: true,
    get: function () {
      if (this._value != null) return this._value;
      if (this.localName === 'textarea') return this.textContent;
      if (this.localName === 'select') {
        var opts = this.querySelectorAll('option'), o = opts.filter ? opts.filter(function (x) { return x.hasAttribute('selected'); })[0] || opts[0] : opts[0];
        return o ? (o.getAttribute('value') != null ? o.getAttribute('value') : o.textContent) : '';
      }
      var a = this.getAttribute('value'); return a == null ? '' : a;
    },
    set: function (v) { this._value = String(v == null ? '' : v); } });
  function mountWith(kit, open) {
    var env = H.makeEnv();
    var root = env.doc.body.appendChild(env.doc.createElement('div'));
    var ctx = { eventId: 'qa-posts', kit: kit, toast: function () {} };
    if (open !== undefined) ctx.open = open;
    env.posts.mount(root, ctx);
    return { env: env, root: root };
  }
  var R = mountWith(H.richKit(), 'announce');
  await until(function () { return !!R.root.querySelector('.ps-ed-title h3'); }, 3000);
  var h3 = R.root.querySelector('.ps-ed-title h3');
  check('E.5 ctx.open, met: the editor opens on that post', !!h3 && h3.textContent === 'Save the date' && !!R.root.querySelector('#ps-back') && !R.env.doc.body.querySelector('.ps-lb'), h3 && h3.textContent);
  var save = R.root.querySelector('#ps-save');
  check('E.5 … a new post, as a gallery click makes it (newCfg: not a saved one)', !R.root.querySelector('.ps-grid') && !!save && save.textContent === 'Save', save && save.textContent);

  R = mountWith(H.noDateKit(), 'announce');
  await until(function () { return !!R.env.doc.body.querySelector('.ps-lb'); }, 3000);
  var lb = R.env.doc.body.querySelector('.ps-lb');
  check('E.5 ctx.open, not met: the full-size preview, which says why and where to fix it', !!lb && lb.querySelector('#ps-lb-h').textContent === 'Save the date' &&
    /The event has no date or venue yet\./.test(lb.querySelector('.ps-ex-note').textContent) && !!lb.querySelector('.ps-ex-note a'), lb && lb.querySelector('.ps-ex-note').textContent);
  check('E.5 … over the gallery, not the editor', !!R.root.querySelector('.ps-grid') && !R.root.querySelector('.ps-ed-title'));

  ['nope', '__proto__', 'constructor', 'toString'].forEach(function (name) {
    var U = mountWith(H.richKit(), name);
    return until(function () { return !!U.root.querySelector('.ps-grid'); }, 3000).then(function () {
      check('E.5 an unknown post ' + JSON.stringify(name) + ': the gallery only', !!U.root.querySelector('.ps-grid') && !U.root.querySelector('.ps-ed-title') && !U.env.doc.body.querySelector('.ps-lb'));
    });
  });
  await wait(300);
  R = mountWith(H.richKit());
  await until(function () { return !!R.root.querySelector('.ps-grid'); }, 3000);
  await wait(50);
  check('E.5 no ctx.open: the gallery, as before', !!R.root.querySelector('.ps-grid') && !R.root.querySelector('.ps-ed-title') && !R.env.doc.body.querySelector('.ps-lb'));

  /* mounted again before the fonts were in: the later mount decides */
  var env = H.makeEnv();
  var r1 = env.doc.body.appendChild(env.doc.createElement('div')), r2 = env.doc.body.appendChild(env.doc.createElement('div'));
  env.posts.mount(r1, { eventId: 'qa-posts', kit: H.richKit(), toast: function () {}, open: 'announce' });
  env.posts.mount(r2, { eventId: 'qa-posts', kit: H.richKit(), toast: function () {} });
  await until(function () { return !!r2.querySelector('.ps-grid'); }, 3000);
  await wait(100);
  check('E.5 a mount that has been replaced opens nothing', !r2.querySelector('.ps-ed-title') && !r1.querySelector('.ps-ed-title'));
}

/* =============================================================================== E.6 Create Event: ETB2B AI's hero picture (plan §18)
   The request through the prefill, the line over step 1 with Change and Remove (and why none is made), and the
   hand-off's row that asks for the picture only once the event exists, never failing the hand-off. */
async function e6() {
  /* ---- the prefill ---- */
  var t = takeOne(stored({ hero: { subject: '  a modern retail\nstore at night ' } }));
  check('E.6 take: the hero request is kept, its subject one line of the person\'s words', !!t.got && JSON.stringify(t.got.hero) === JSON.stringify({ subject: 'a modern retail store at night' }), t.got && t.got.hero);
  t = takeOne(stored({ hero: { subject: '' } }));
  check('E.6 take: an empty subject is "the event\'s field and place"', !!t.got && JSON.stringify(t.got.hero) === JSON.stringify({ subject: '' }));
  t = takeOne(stored({ method: 'brief', brief: { text: 'A one-day forum.' }, hero: { subject: 'x' } }));
  check('E.6 take: none on the brief path (it makes its own pictures)', !!t.got && t.got.method === 'brief' && t.got.hero === null, t.got && t.got.hero);
  t = takeOne(stored({ hero: 'make one' }));
  check('E.6 take: a request that is not one is none', !!t.got && t.got.hero === null);
  t = takeOne(stored({ hero: { subject: 'y'.repeat(300) } }));
  check('E.6 take: the subject is at most 200 characters', !!t.got && t.got.hero.subject.length === 200);
  var S = freshS(), C = freshCats();
  check('E.6 the page\'s draft has an empty slot for it', S.aiHero === null && Object.prototype.hasOwnProperty.call(S, 'aiHero'));
  var r = Prefill.apply(S, C, takeOne(stored({ hero: { subject: 'a modern retail store at night' } })).got, { slugify: SLUGIFY });
  check('E.6 apply: the request goes into the draft, not made, not removed, with its turn', !!S.aiHero && S.aiHero.subject === 'a modern retail store at night' && S.aiHero.removed === false &&
    S.aiHero.made === null && S.aiHero.note === '' && S.aiHero.turnId === ID && r.fields.indexOf('hero') !== -1, S.aiHero);
  var S2 = freshS(); delete S2.aiHero;
  Prefill.apply(S2, C, takeOne(stored({ hero: { subject: '' } })).got, { slugify: SLUGIFY });
  check('E.6 apply: a page without the slot ignores it', !('aiHero' in S2));
  var S3 = freshS();
  Prefill.apply(S3, C, takeOne(stored({})).got, { slugify: SLUGIFY });
  check('E.6 apply: no request, nothing in the slot', S3.aiHero === null);

  /* ---- what the line says ---- */
  var H = Prefill.heroLine;
  /* QA follow-up 2 F1/F3: the picture is of the event's field (its portal's) and place, never its name, and the line
     says so */
  var auto = 'retail, Jio World Centre, Mumbai';
  var L = H({ hero: { subject: '' }, method: 'template', subject: auto, from: { portal: true, place: true } });
  check('E.6 line: the field and place, said to be from the portal and place, and that nothing is made until the event is created', !!L && L.can === 'change' &&
    L.text === 'ETB2B AI will make a hero picture: retail, Jio World Centre, Mumbai (from the event’s portal and place). Nothing is made until your event is created.', L);
  check('E.6 line: …its portal alone, its place alone, or neither, said as such',
    H({ hero: { subject: '' }, method: 'template', subject: 'retail', from: { portal: true, place: false } }).text.indexOf('retail (from the event’s portal).') !== -1 &&
    H({ hero: { subject: '' }, method: 'template', subject: 'business and industry, Pune', from: { portal: false, place: true } }).text.indexOf('business and industry, Pune (from the event’s place: it has no portal yet).') !== -1 &&
    H({ hero: { subject: '' }, method: 'template', subject: 'business and industry', from: {} }).text.indexOf('business and industry (it has no portal or place yet).') !== -1);
  L = H({ hero: { subject: 'a modern retail store at night' }, method: null, subject: auto });
  check('E.6 line: the person\'s own words', L.text === 'ETB2B AI will make a hero picture: a modern retail store at night. Nothing is made until your event is created.' && L.can === 'change', L);
  L = H({ hero: { subject: '' }, method: 'template', subject: '' });
  check('E.6 line: no subject to show (the page could not word one)', /from the event’s portal and place, once you have chosen them\./.test(L.text), L.text);
  check('E.6 line: the event\'s name is never said to be what the picture shows', [H({ hero: { subject: '' }, method: 'template', subject: auto, from: { portal: true, place: true } }),
    H({ hero: { subject: '' }, method: 'template', subject: '' })].every(function (x) { return x.text.indexOf('name') === -1; }));
  check('E.6 line: removed → "won\'t", with Make one after all', H({ hero: { subject: '', removed: true }, method: 'template' }).can === 'restore' &&
    H({ hero: { subject: '', removed: true } }).text === 'ETB2B AI won’t make a hero picture for this event.');
  check('E.6 line: Generate from a brief → why none', H({ hero: { subject: '' }, method: 'brief' }).text === 'Generate from a brief makes the site’s pictures itself, so ETB2B AI won’t make a separate hero picture.' &&
    H({ hero: { subject: '' }, method: 'brief' }).can === '');
  check('E.6 line: an imported design → why none', /imported design keeps its own pictures/.test(H({ hero: { subject: '' }, method: 'imported' }).text));
  check('E.6 line: the person\'s own banner → why none', H({ hero: { subject: '' }, method: 'template', ownBanner: true }).text === 'You added your own banner picture, so ETB2B AI won’t make one.');
  check('E.6 line: a design with no hero → why none', /This design has no hero picture/.test(H({ hero: { subject: '' }, method: 'template', noSlot: true }).text));
  check('E.6 line: made → said, with where it is and that Undo there puts the design\'s own back', H({ hero: { subject: '', made: { url: 'https://storage.googleapis.com/b/x.png', subject: 'Q' } } }).text ===
    'ETB2B AI made this event’s hero picture: Q. It is in the editor, where Undo puts the design’s own picture back.');
  check('E.6 line: no request, no line', H({ hero: null }) === null && H({}) === null);

  /* ---- the page ---- */
  var FNS = ['cleanAiHero', 'aiHeroAutoSubject', 'aiHeroAutoFrom', 'aiHeroNoSlot', 'aiHeroState', 'wantsAiHero', 'renderAiHeroLine', 'setAiHeroRemoved', 'changeAiHero',
    'handoffSteps', 'aiHeroFailure', 'makeAiHero', 'aiHeroForHandoff'];
  check('E.6 every hero function is on the page', FNS.every(function (n) { return !!fnSrc(CE_INLINE, n); }), FNS.filter(function (n) { return !fnSrc(CE_INLINE, n); }));
  es5('E.6 the page\'s hero code', FNS.map(function (n) { return fnSrc(CE_INLINE, n); }).join('\n'));
  function stage(o) {
    o = o || {};
    var els = {};
    function el(id) {
      var e = { id: id, attrs: {}, hidden: true, _html: '', onclick: null, value: '', focused: 0 };
      e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
      e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
      e.focus = function () { e.focused++; };
      Object.defineProperty(e, 'innerHTML', { get: function () { return e._html; }, set: function (v) {
        e._html = String(v);
        var m, re = /\sid="([^"]+)"/g;
        while ((m = re.exec(e._html))) els[m[1]] = el(m[1]);
      } });
      return e;
    }
    els['ai-hero-line'] = el('ai-hero-line');
    var log = { fetches: [], saves: 0, modals: [] };
    var ctx = { console: console, JSON: JSON, Promise: Promise, Object: Object, String: String, Math: Math, Array: Array, Error: Error, ELS: els, LOG: log, OPT: o };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(PREFILL_SRC, ctx, { filename: 'create-event-prefill.js' });
    if (!o.noFields) vm.runInContext(FIELDS_SRC, ctx, { filename: 'portal-fields.js' });
    ctx.RevampCore = { authedFetch: function (url, opts) {
      log.fetches.push({ url: url, method: opts.method, body: JSON.parse(opts.body) });
      var a = o.answer || { status: 200, body: { url: 'https://storage.googleapis.com/b/events/retail-2027/generated/x-ai-hero.png', subject: 'retail, Jio World Centre, Mumbai', made: true } };
      return Promise.resolve({ ok: a.status < 300, status: a.status, json: function () { return Promise.resolve(a.body); } });
    } };
    vm.runInContext([
      'var S = ' + S_SRC + ';', 'var busy = null;',
      'var IC = { img: "<i></i>" };',
      'function $(id){ return ELS[id] || null; }',
      fnSrc(CE_INLINE, 'esc'),
      'function save(){ LOG.saves++; return true; }',
      'function draftCaps(){ return OPT.caps === undefined ? null : OPT.caps; }',
      'function excludedOn(){ return OPT.excluded || {}; }',
      'function activeBannerUrl(){ return OPT.ownBanner ? "blob:x" : ""; }',
      'function openModal(m){ LOG.modals.push(m); }',
      'function isCurrent(run){ return run === "RUN"; }',
      'function createEventRecord(){ return Promise.resolve(); }', 'function openInEditor(){ return Promise.resolve(); }',
      /* the pictures and records rows have their own test (create-event-saves.test.js): this draft has neither */
      'function pictureCount(){ return { all: 0 }; }', 'function recordKinds(){ return []; }',
      'function staleRecordSources(){ return []; }', 'function recordPlan(){ return []; }', 'function pendingAddress(){ return ""; }',
      fnSrc(CE_INLINE, 'httpError'), fnSrc(CE_INLINE, 'readJson')
    ].concat(FNS.map(function (n) { return fnSrc(CE_INLINE, n); })).join('\n'), ctx, { filename: 'create-event.html (hero, extracted)' });
    ctx.S.basics.name = 'Retail Leadership Summit'; ctx.S.basics.venue = 'Jio World Centre, Mumbai'; ctx.S.basics.portal = 'retail';
    return { ctx: ctx, els: els, log: log, line: function () { ctx.renderAiHeroLine(); return els['ai-hero-line']; } };
  }
  var P = stage();
  check('E.6 page: no request, no line', P.line().hidden === true && P.line().innerHTML === '');
  P.ctx.S.aiHero = P.ctx.cleanAiHero({ subject: '', removed: false, made: null, note: '', turnId: ID, at: 1 });
  P.ctx.S.creationMethod = 'template'; P.ctx.S.step = 1;
  var line = P.line();
  check('E.6 page: the line says it plainly, with Change and Remove', line.hidden === false && line.getAttribute('role') === null &&
    line.innerHTML.indexOf('ETB2B AI will make a hero picture: retail, Jio World Centre, Mumbai (from the event’s portal and place). Nothing is made until your event is created.') !== -1 &&
    !!P.els['ai-hero-change'] && !!P.els['ai-hero-remove'], line.innerHTML);
  check('E.6 page: the event\'s name is not in the line (the picture is never of it)', line.innerHTML.indexOf('Retail Leadership Summit') === -1, line.innerHTML);
  /* the field follows the portal chosen on step 1, from the one table the server reads too (portal-fields.js) */
  P.ctx.S.basics.portal = 'hr';
  check('E.6 page: another portal, another field: ETHRWorld → people and workplaces', P.line().innerHTML.indexOf('ETB2B AI will make a hero picture: people and workplaces, Jio World Centre, Mumbai (from the event’s portal and place).') !== -1,
    P.els['ai-hero-line'].innerHTML);
  P.ctx.S.basics.portal = '';
  check('E.6 page: no portal yet: the neutral field, and said why', P.line().innerHTML.indexOf('ETB2B AI will make a hero picture: business and industry, Jio World Centre, Mumbai (from the event’s place: it has no portal yet).') !== -1,
    P.els['ai-hero-line'].innerHTML);
  P.ctx.S.basics.portal = 'retail';
  P.line();
  var before = line.innerHTML;
  P.line();
  check('E.6 page: drawn again only when what it says changes (its buttons keep the keyboard)', P.els['ai-hero-line'].innerHTML === before && P.els['ai-hero-line'].getAttribute('data-line').indexOf('change:') === 0);
  P.ctx.S.basics.venue = 'Jio <b>World</b> Centre, Mumbai';
  check('E.6 page: the place is shown as text, never as markup', P.line().innerHTML.indexOf('Jio &lt;b&gt;World&lt;/b&gt; Centre') !== -1);
  P.ctx.S.basics.venue = 'Jio World Centre, Mumbai';
  P.line();
  P.els['ai-hero-change'].onclick();
  var m = P.log.modals[0];
  check('E.6 Change: asks what the picture should show, with the field and place as the empty answer', !!m && m.title === 'What should the hero picture show?' &&
    m.body.indexOf('id="ai-hero-subject"') !== -1 && m.body.indexOf('maxlength="200"') !== -1 && m.body.indexOf('placeholder="retail, Jio World Centre, Mumbai"') !== -1 && /field \(set by its portal\) and its place/.test(m.sub), m);
  P.els['ai-hero-subject'] = { value: '  a modern retail\nstore at night ' };
  m.onConfirm();
  check('E.6 Change: the person\'s words, one line, kept in the draft and shown', P.ctx.S.aiHero.subject === 'a modern retail store at night' && P.log.saves === 1 &&
    P.els['ai-hero-line'].innerHTML.indexOf('ETB2B AI will make a hero picture: a modern retail store at night.') !== -1, P.ctx.S.aiHero);
  P.els['ai-hero-remove'].onclick();
  check('E.6 Remove: none will be made, said so, with the way back', P.ctx.S.aiHero.removed === true && P.els['ai-hero-line'].innerHTML.indexOf('ETB2B AI won’t make a hero picture for this event.') !== -1 &&
    !!P.els['ai-hero-restore'] && P.els['ai-hero-restore'].focused === 1 && P.ctx.wantsAiHero() === false);
  var steps = P.ctx.handoffSteps().map(function (x) { return x.key; });
  check('E.6 Remove: the hand-off asks for no picture', JSON.stringify(steps) === '["create","open"]', steps);
  P.els['ai-hero-restore'].onclick();
  check('E.6 Make one after all: back as it was (the subject kept)', P.ctx.S.aiHero.removed === false && P.ctx.S.aiHero.subject === 'a modern retail store at night' && P.ctx.wantsAiHero() === true);
  steps = P.ctx.handoffSteps();
  check('E.6 the hand-off: its row comes right after the event is created, before the editor opens', JSON.stringify(steps.map(function (x) { return x.key; })) === '["create","hero","open"]' &&
    steps[1].label === 'ETB2B AI is making a hero picture', steps.map(function (x) { return x.key + ':' + x.label; }));

  /* why none is made, for each path */
  P.ctx.S.creationMethod = 'brief';
  check('E.6 brief path: the line says why, and no picture is asked for', P.line().innerHTML.indexOf('Generate from a brief makes the site’s pictures itself') !== -1 && P.ctx.wantsAiHero() === false && !P.els['ai-hero-line'].innerHTML.match(/ai-hero-change"/));
  P.ctx.S.creationMethod = 'imported';
  check('E.6 an imported design: no picture asked for', P.ctx.wantsAiHero() === false);
  var Pb = stage({ ownBanner: true });
  Pb.ctx.S.aiHero = Pb.ctx.cleanAiHero({ subject: '' }); Pb.ctx.S.creationMethod = 'template'; Pb.ctx.S.step = 1;
  check('E.6 the person\'s own banner: said, and no picture asked for', Pb.line().innerHTML.indexOf('You added your own banner picture') !== -1 && Pb.ctx.wantsAiHero() === false);
  var Pn = stage({ caps: { byLib: {} } });
  Pn.ctx.S.aiHero = Pn.ctx.cleanAiHero({ subject: '' }); Pn.ctx.S.creationMethod = 'template'; Pn.ctx.S.template = 'x'; Pn.ctx.S.step = 1;
  check('E.6 a design with no hero section: said, and none asked for', Pn.line().innerHTML.indexOf('This design has no hero picture') !== -1 && Pn.ctx.wantsAiHero() === false);
  var Px = stage({ caps: { byLib: { hero: { sectionId: 'banner' } } }, excluded: { banner: true } });
  Px.ctx.S.aiHero = Px.ctx.cleanAiHero({ subject: '' }); Px.ctx.S.creationMethod = 'template'; Px.ctx.S.template = 'x'; Px.ctx.S.step = 1;
  check('E.6 …or with its hero switched off', Px.ctx.wantsAiHero() === false);
  P.ctx.S.creationMethod = 'template'; P.ctx.S.step = 4;
  check('E.6 the line is only over step 1', P.line().hidden === true);

  /* ---- the picture is asked for only once the event exists, and never fails the hand-off ---- */
  P.ctx.S.step = 1;
  var row = { key: 'hero', label: 'ETB2B AI is making a hero picture' };
  await P.ctx.makeAiHero('RUN', row);
  check('E.6 no event yet: nothing is asked for', P.log.fetches.length === 0);
  P.ctx.S.createdEventId = 'retail-2027';
  await P.ctx.makeAiHero('RUN', row);
  check('E.6 the event exists: one request, for it, with the subject and the turn', P.log.fetches.length === 1 && P.log.fetches[0].url === '/api/event/ai-hero' && P.log.fetches[0].method === 'POST' &&
    JSON.stringify(P.log.fetches[0].body) === JSON.stringify({ eventId: 'retail-2027', subject: 'a modern retail store at night', turnId: ID }), P.log.fetches);
  check('E.6 made: kept in the draft, the row says so, and the editor gets it', !!P.ctx.S.aiHero.made && P.ctx.S.aiHero.made.url === 'https://storage.googleapis.com/b/events/retail-2027/generated/x-ai-hero.png' &&
    row.label === 'ETB2B AI made a hero picture' && JSON.stringify(P.ctx.aiHeroForHandoff()) === JSON.stringify({ url: 'https://storage.googleapis.com/b/events/retail-2027/generated/x-ai-hero.png', subject: 'retail, Jio World Centre, Mumbai' }),
    [P.ctx.S.aiHero, row.label]);
  check('E.6 a hand-off run again (a retry) never asks for a second picture', P.ctx.wantsAiHero() === false && JSON.stringify(P.ctx.handoffSteps().map(function (x) { return x.key; })) === '["create","open"]');
  await P.ctx.makeAiHero('RUN', row);
  check('E.6 …even if its row ran again', P.log.fetches.length === 1);
  check('E.6 the line then says it was made', P.line().innerHTML.indexOf('ETB2B AI made this event’s hero picture') !== -1);

  var Pf = stage({ answer: { status: 429, body: { error: 'You have used today’s ETB2B AI pictures. They reset at midnight (India time).', code: 'ai-hero-daily' } } });
  Pf.ctx.S.aiHero = Pf.ctx.cleanAiHero({ subject: '' }); Pf.ctx.S.creationMethod = 'template'; Pf.ctx.S.createdEventId = 'retail-2027';
  var frow = { key: 'hero', label: 'ETB2B AI is making a hero picture' }, threw = false;
  await Pf.ctx.makeAiHero('RUN', frow).then(null, function () { threw = true; });
  check('E.6 a failure never fails the hand-off: the row resolves, and says the picture was not made', threw === false && frow.label === 'Hero picture not made: the design’s own picture is kept', frow.label);
  check('E.6 …the editor is told why, in the server\'s words', JSON.stringify(Pf.ctx.aiHeroForHandoff()) === JSON.stringify({ note: 'ETB2B AI could not make the hero picture: You have used today’s ETB2B AI pictures. They reset at midnight (India time). The design’s own picture is in place: you can change it in the editor.' }),
    Pf.ctx.aiHeroForHandoff());
  /* the picture did not pass its check (functions/lib/ai-hero.js 422 hero-held): the event stands, the row and the
     editor say plainly that no hero picture was made, and why */
  var HELD_SAID = 'No hero picture was made: ETB2B AI made it twice, and the second picture still had words or letters in it. A hero picture carries no words or logos.';
  var Ph = stage({ answer: { status: 422, body: { error: HELD_SAID, code: 'hero-held', found: ['text'], subject: 'retail, Jio World Centre, Mumbai' } } });
  Ph.ctx.S.aiHero = Ph.ctx.cleanAiHero({ subject: '' }); Ph.ctx.S.creationMethod = 'template'; Ph.ctx.S.createdEventId = 'retail-2027';
  var hrow = { key: 'hero', label: 'ETB2B AI is making a hero picture' }; threw = false;
  await Ph.ctx.makeAiHero('RUN', hrow).then(null, function () { threw = true; });
  check('E.6 held (the picture did not pass its check): the hand-off goes on, and the row says that none was made and why', threw === false && !Ph.ctx.S.aiHero.made &&
    hrow.label === 'No hero picture was made: ETB2B AI made it twice, and the second picture still had words or letters in it.', hrow.label);
  check('E.6 …the editor is told it in the server\'s words, with what the person can do instead', JSON.stringify(Ph.ctx.aiHeroForHandoff()) === JSON.stringify({ note: HELD_SAID +
    ' The design’s own picture is in place: you can change it in the editor, or ask ETB2B AI there for a new one.' }), Ph.ctx.aiHeroForHandoff());
  check('E.6 …and the note survives the draft being read back (cleanAiHero keeps up to 400 characters)', Ph.ctx.cleanAiHero(Ph.ctx.S.aiHero).note === Ph.ctx.S.aiHero.note &&
    Ph.ctx.cleanAiHero({ note: 'x'.repeat(500) }).note.length === 400);
  var Ph2 = stage({ answer: { status: 422, body: { error: '', code: 'hero-held' } } });
  Ph2.ctx.S.aiHero = Ph2.ctx.cleanAiHero({ subject: '' }); Ph2.ctx.S.createdEventId = 'retail-2027';
  var hrow2 = { label: '' };
  await Ph2.ctx.makeAiHero('RUN', hrow2);
  check('E.6 …a held answer with no words of its own: the plain failure row and note', hrow2.label === 'Hero picture not made: the design’s own picture is kept' && /could not make the hero picture/.test(Ph2.ctx.S.aiHero.note), [hrow2.label, Ph2.ctx.S.aiHero.note]);
  var Po = stage({ answer: { status: 200, body: { url: 'https://evil.example/x.png' } } });
  Po.ctx.S.aiHero = Po.ctx.cleanAiHero({ subject: '' }); Po.ctx.S.createdEventId = 'retail-2027';
  await Po.ctx.makeAiHero('RUN', { label: '' });
  check('E.6 an answer that is not a stored picture of ours is not used', !Po.ctx.S.aiHero.made && /could not make the hero picture/.test(Po.ctx.S.aiHero.note));
  var Pc = stage();
  Pc.ctx.S.aiHero = Pc.ctx.cleanAiHero({ subject: '' }); Pc.ctx.S.createdEventId = 'retail-2027';
  await Pc.ctx.makeAiHero('CANCELLED', { label: '' });
  check('E.6 a hand-off cancelled meanwhile records nothing', !Pc.ctx.S.aiHero.made && Pc.ctx.S.aiHero.note === '');
  check('E.6 cleanAiHero: odd stored values are no request, and a "made" picture only of ours', P.ctx.cleanAiHero('x') === null && P.ctx.cleanAiHero([]) === null &&
    P.ctx.cleanAiHero({ made: { url: 'https://evil.example/x.png' } }).made === null && P.ctx.cleanAiHero({ subject: 7, removed: 'yes' }).removed === false);

  /* ---- a picture made on an earlier run, when the draft has gone another way since ---- */
  var MADE = { url: 'https://storage.googleapis.com/b/events/retail-2027/generated/x-ai-hero.png', subject: 'Q' };
  var Pm = stage({ ownBanner: true });
  Pm.ctx.S.aiHero = Pm.ctx.cleanAiHero({ subject: '', made: MADE }); Pm.ctx.S.creationMethod = 'template'; Pm.ctx.S.step = 1;
  check('E.6 made, then the person added their own banner: the editor is not given the picture, and the line says theirs is used',
    Pm.ctx.aiHeroForHandoff() === null && Pm.line().innerHTML.indexOf('You added your own banner picture, so it is used instead of the hero picture ETB2B AI made.') !== -1 &&
    Pm.ctx.wantsAiHero() === false, [Pm.ctx.aiHeroForHandoff(), Pm.els['ai-hero-line'].innerHTML]);
  var Pi = stage();
  Pi.ctx.S.aiHero = Pi.ctx.cleanAiHero({ subject: '', made: MADE }); Pi.ctx.S.creationMethod = 'imported';
  check('E.6 made, then the draft moved to an imported design: the editor is not given the picture', Pi.ctx.aiHeroForHandoff() === null);
  Pi.ctx.S.creationMethod = 'template';
  check('E.6 …and back on the template path with no banner of their own, it is', JSON.stringify(Pi.ctx.aiHeroForHandoff()) === JSON.stringify(MADE));

  /* ---- static ---- */
  var markup = (CE.match(/<div class="callout plain" id="ai-hero-line"[^>]*>/) || [''])[0];
  check('E.6 the line\'s place: right under the note over step 1, a status', markup.indexOf('role="status"') !== -1 && CE.indexOf('id="ai-hero-line"') > CE.indexOf('id="ai-prefill-note"') &&
    CE.indexOf('id="ai-hero-line"') < CE.indexOf('id="cat-picker"'));
  check('E.6 renderFoot() keeps the line in step', /renderAiPrefillNote\(\);\s*renderAiHeroLine\(\);/.test(fnSrc(CE_INLINE, 'renderFoot') || ''));
  check('E.6 restore() reads a stored request back through cleanAiHero', /S\.aiHero = cleanAiHero\(S\.aiHero\);/.test(fnSrc(CE_INLINE, 'restore') || ''));
  check('E.6 a changed or removed request counts as a change since ETB2B AI filled the draft (its Undo asks first)', /S\.createdEventId, S\.aiHero\]\);/.test(fnSrc(CE_INLINE, 'aiDraftKey') || ''));
  check('E.6 the editor\'s hand-off carries it, for the draft\'s own design only', /aiHero: own \? aiHeroForHandoff\(\) : null,/.test(fnSrc(CE_INLINE, 'buildEditorPayload') || ''));
  /* the brief path's own runner must exist for this to say anything, and must not reach the picture in any way */
  var briefRun = fnSrc(CE_INLINE, 'startGenerateFromBrief');
  check('E.6 the hand-off code never generates on the brief path (its own runner list has no hero row)', !!briefRun &&
    ['ai-hero', 'makeAiHero', 'handoffSteps', 'aiHeroForHandoff'].every(function (w) { return briefRun.indexOf(w) === -1; }));
}

/* =============================================================================== E.7 the editor: the picture as one undoable change */
async function e7() {
  var ED = read('editor-template-ui.js');
  var FNS = ['applyAiHero', 'heroPictureEls'];
  check('E.7 the editor has applyAiHero and heroPictureEls', FNS.every(function (n) { return !!fnSrc(ED, n); }));
  es5('E.7 the editor\'s hero code', FNS.map(function (n) { return fnSrc(ED, n); }).join('\n'));
  var TECH = JSON.parse(read('templates/tech500/template.json'));
  function stage(o) {
    o = o || {};
    function img(cls, src) { return { cls: cls, src: src }; }
    var bannerImg = img('banner-bg-image', 'assets/banner.jpg'), logoImg = img('logo', 'assets/logo.png');
    var section = { querySelectorAll: function (sel) { return sel === 'img.banner-bg-image' ? [bannerImg] : sel === 'img.logo' ? [logoImg] : []; } };
    var log = { toasts: [], undo: [], steps: [], set: [] };
    var ctx = { console: console, Array: Array, String: String, LOG: log };
    ctx.canvas = { template: { content: { map: o.map || TECH.content.map } },
      doc: { querySelectorAll: function (sel) { return sel === '[data-rv-section="banner"]' ? [section] : []; } },
      setPicture: function (el, url) { log.set.push([el.cls, url]); el.src = url; } };
    /* the undo stack, as the editor keeps it: a step holds the page as it was */
    var stack = [bannerImg.src], ptr = 0;
    ctx.commitNow = function () { if (o.noChange) return false; stack = stack.slice(0, ptr + 1).concat([bannerImg.src]); ptr = stack.length - 1; log.steps.push(bannerImg.src); return true; };
    ctx.offerUndo = function (msg) { log.undo.push(msg); };
    ctx.showToast = function (msg) { log.toasts.push(msg); };
    ctx.eventId = 'retail-2027';
    vm.createContext(ctx);
    vm.runInContext(FNS.map(function (n) { return fnSrc(ED, n); }).join('\n'), ctx, { filename: 'editor-template-ui.js (hero, extracted)' });
    return { ctx: ctx, log: log, banner: bannerImg, logo: logoImg, undo: function () { if (ptr > 0) { ptr--; bannerImg.src = stack[ptr]; } } };
  }
  var URL = 'https://storage.googleapis.com/test-bucket/events/retail-2027/generated/abc-ai-hero.png';
  var E = stage();
  var done = E.ctx.applyAiHero({ aiHero: { url: URL, subject: 'a modern retail store at night' } });
  check('E.7 the picture goes into the hero\'s own picture (the template\'s {hero.bannerUrl} rule), and nothing else', done === true &&
    JSON.stringify(E.log.set) === JSON.stringify([['banner-bg-image', URL]]) && E.logo.src === 'assets/logo.png', E.log.set);
  check('E.7 …as one step of its own, with Undo offered in plain words', E.log.steps.length === 1 && E.log.undo.length === 1 &&
    E.log.undo[0] === 'ETB2B AI made this hero picture: a modern retail store at night. Undo puts the design’s own picture back.', E.log.undo);
  E.undo();
  check('E.7 Undo brings the design\'s own picture back', E.banner.src === 'assets/banner.jpg', E.banner.src);
  E = stage();
  check('E.7 only this event\'s own generated picture is ever put in', E.ctx.applyAiHero({ aiHero: { url: 'https://storage.googleapis.com/test-bucket/events/other-event/generated/x.png' } }) === false &&
    E.ctx.applyAiHero({ aiHero: { url: 'https://evil.example/events/retail-2027/generated/x.png' } }) === false &&
    E.ctx.applyAiHero({ aiHero: { url: URL + '" onerror="x' } }) === false && E.log.set.length === 0 && E.log.steps.length === 0);
  E = stage();
  check('E.7 a note (no picture made) is said, and nothing changes', E.ctx.applyAiHero({ aiHero: { note: 'ETB2B AI could not make the hero picture.' } }) === false &&
    JSON.stringify(E.log.toasts) === JSON.stringify(['ETB2B AI could not make the hero picture.']) && E.log.set.length === 0);
  E = stage({ map: [{ from: 'event', section: 'x', fill: [] }] });
  check('E.7 a design with no place for it: said, nothing changes', E.ctx.applyAiHero({ aiHero: { url: URL } }) === false && /no place for one/.test(E.log.toasts[0] || ''), E.log.toasts);
  E = stage({ noChange: true });
  check('E.7 nothing changed (the same picture already there): no Undo offered', E.ctx.applyAiHero({ aiHero: { url: URL } }) === false && E.log.undo.length === 0);
  check('E.7 no hand-off picture, nothing', stage().ctx.applyAiHero({}) === false && stage().ctx.applyAiHero(null) === false);
  E = stage({ map: [{ from: 'hero', section: 'banner', fill: [{ attr: 'img.banner-bg-image', name: 'src', value: '{hero.psdBanner.compositeImageData}' }] }] });
  check('E.7 a generated design\'s hero rule ({hero.psdBanner.compositeImageData}) is found too', E.ctx.applyAiHero({ aiHero: { url: URL } }) === true && E.log.set.length === 1);

  /* when it runs: after the first step, once the records' overlay is part of it */
  var start = fnSrc(ED, 'boot') || '', handoff = fnSrc(ED, 'applyHandoffDraft') || '';
  check('E.7 the hand-off holds the picture until the boot is done (its first step is the design\'s own picture)', /if \(kept\) forgetHandoff\(\);\s*pendingAiHero = draft;/.test(handoff));
  check('E.7 the boot puts it in last, after the records are drawn into the first step', start.indexOf('applySubcollectionOverlay()') !== -1 &&
    start.indexOf('applyAiHero(heroDraft)') > start.indexOf('applySubcollectionOverlay()') && start.indexOf('applyAiHero(heroDraft)') > start.indexOf('logoUnitNotice();'));
  check('E.7 a hand-off with no sections still brings the picture', /return seedSnapshot\(null\)\.then\(function \(\) \{ pendingAiHero = draft \|\| aiHeroFromEvent\(\); \}\);/.test(ED));

  /* QA follow-up 2: the editor opened in ANOTHER browser (no copy of the site, no hand-off) before the site was ever
     saved puts in ETB2B AI's picture from the event's own record, as the hand-off does: one step of its own, which
     Undo takes back to the design's own picture */
  check('E.7 the editor has aiHeroFromEvent', !!fnSrc(ED, 'aiHeroFromEvent'));
  es5('E.7 the editor\'s opening code', [fnSrc(ED, 'aiHeroFromEvent'), fnSrc(ED, 'resolveInitialContent')].join('\n'));
  var MADE_URL = 'https://storage.googleapis.com/test-bucket/events/retail-2027/generated/abc-ai-hero.png';
  /* o: { local (a copy of the site in this browser), handoff (this browser's hand-off), arriving (?from=create),
          event (the record GET /api/event gave), template } -> what resolveInitialContent() did, and the picture it
          left for the end of the boot */
  async function opening(o) {
    o = o || {};
    var log = [];
    var ctx = { console: console, Promise: Promise, JSON: JSON, String: String, URLSearchParams: URLSearchParams, LOG: log, OPT: o,
      location: { search: o.arriving ? '?event=retail-2027&from=create' : '?event=retail-2027' } };
    vm.createContext(ctx);
    vm.runInContext([
      'var eventId = "retail-2027", storeKey = "site:retail-2027:tech500", templateId = OPT.template || "tech500", FILL_LOGIC_VERSION = 2;',
      'var currentEvent = OPT.event || null, pendingAiHero = null, sourceDraftId = null, undoStack = [], undoPtr = -1;',
      'var canvas = { restore: function(){ LOG.push("restore"); }, snapshot: function(s){ return s || { page: 1 }; } };',
      'function restoreOpts(){ return {}; }',
      'function localGet(){ return Promise.resolve(OPT.local ? { snapshot: { page: 2 }, savedAt: 1, fillVersion: 2 } : undefined); }',
      'function fromCreate(){ return !!OPT.arriving; }',
      'function readHandoffDraft(){ return OPT.handoff || null; }',
      'function applyHandoffDraft(d){ LOG.push("handoff"); pendingAiHero = d; return Promise.resolve(); }',
      'function seedSnapshot(){ LOG.push("seed"); return Promise.resolve(true); }',
      'function fetchServerDraft(){ LOG.push("server"); return Promise.resolve(null); }',
      'function newerOnServer(){ return false; }', 'function takeServerVersion(){ return Promise.resolve(); }', 'function adoptGeneration(){}',
      fnSrc(ED, 'aiHeroFromEvent'), fnSrc(ED, 'resolveInitialContent')
    ].join('\n'), ctx, { filename: 'editor-template-ui.js (opening, extracted)' });
    await ctx.resolveInitialContent();
    return { log: log, pending: ctx.pendingAiHero };
  }
  var REC = { eventId: 'retail-2027', templateId: 'tech500', aiHero: { status: 'made', url: MADE_URL, subject: 'retail, Jio World Centre, Mumbai', by: 'asha@timesinternet.in' } };
  var o1 = await opening({ event: REC });
  check('E.7 another browser, no site saved yet: the design is seeded, then the event\'s picture waits for the end of the boot',
    JSON.stringify(o1.log) === '["seed"]' && JSON.stringify(o1.pending) === JSON.stringify({ aiHero: { url: MADE_URL, subject: 'retail, Jio World Centre, Mumbai' } }), o1);
  var E2 = stage();
  check('E.7 …and it goes in exactly as the hand-off\'s: one step, Undo offered, Undo brings the design\'s picture back',
    E2.ctx.applyAiHero(o1.pending) === true && E2.log.steps.length === 1 && E2.banner.src === MADE_URL &&
    E2.log.undo[0] === 'ETB2B AI made this hero picture: retail, Jio World Centre, Mumbai. Undo puts the design’s own picture back.' && (E2.undo(), E2.banner.src === 'assets/banner.jpg'), E2.log);
  var o2 = await opening({ event: REC, arriving: true });
  check('E.7 ?from=create in a browser with no hand-off (the link opened elsewhere): the event\'s picture too', JSON.stringify(o2.pending) === JSON.stringify(o1.pending), o2);
  var o3 = await opening({ event: REC, local: true });
  check('E.7 this browser has a copy of the site: it is restored as it was, nothing put in again', JSON.stringify(o3.log) === '["restore"]' && o3.pending === null, o3);
  var o4 = await opening({ event: Object.assign({}, REC, { site: { version: 2, templateId: 'tech500' } }) });
  check('E.7 a site that was saved: what the person saved stands, no picture put in', o4.pending === null, o4);
  /* only a record marked made counts, even one that carries an address (a picture made but not stored is "failed") */
  var o5 = await opening({ event: Object.assign({}, REC, { aiHero: { status: 'failed', error: 'not-stored', url: MADE_URL } }) });
  var o6 = await opening({ event: Object.assign({}, REC, { aiHero: { status: 'making', at: '2026-11-03T06:35:00.000Z', url: MADE_URL } }) });
  var o7 = await opening({ event: { eventId: 'retail-2027', templateId: 'tech500' } });
  /* a picture that did not pass its check was never stored: another browser before the site is saved says so, once,
     in the server's words, and puts nothing in */
  var WHY = 'No hero picture was made: ETB2B AI made it twice, and the second picture still had words or letters in it. A hero picture carries no words or logos.';
  var oh = await opening({ event: Object.assign({}, REC, { aiHero: { status: 'held', heldFor: 'twice', why: WHY, url: MADE_URL } }) });
  check('E.7 held (did not pass its check): another browser is told plainly that none was made and why, and nothing is put in',
    JSON.stringify(oh.pending) === JSON.stringify({ aiHero: { note: WHY + ' The design’s own picture is in place: you can change it here, or ask ETB2B AI for a new one.' } }), oh);
  var Eh = stage();
  check('E.7 …the note is said and nothing changes', Eh.ctx.applyAiHero(oh.pending) === false && Eh.log.toasts.length === 1 && Eh.log.toasts[0].indexOf('No hero picture was made') === 0 &&
    Eh.log.set.length === 0 && Eh.log.steps.length === 0, Eh.log);
  var ohs = await opening({ event: Object.assign({}, REC, { site: { version: 1, templateId: 'tech500' }, aiHero: { status: 'held', why: WHY } }) });
  var ohx = await opening({ event: Object.assign({}, REC, { aiHero: { status: 'held', why: 'Click here: evil' } }) });
  check('E.7 …not once a site is saved, and only the server\'s own sentence is said', ohs.pending === null && ohx.pending === null, [ohs, ohx]);
  var o7b = await opening({ event: Object.assign({}, REC, { aiHero: { status: 'made', url: '' } }) });
  check('E.7 no picture made (failed, still being made, never asked for, no address): nothing put in', o5.pending === null && o6.pending === null && o7.pending === null && o7b.pending === null, [o5, o6, o7, o7b]);
  var HAND = { event: { name: 'Retail Leadership Summit' }, aiHero: null };
  var o8 = await opening({ event: REC, arriving: true, handoff: HAND });
  check('E.7 the browser that created it: its hand-off decides (it gave no picture: the person\'s own banner), not the record', o8.pending === HAND, o8);
  var o9 = await opening({ event: REC, template: 'gen-retail-2027' });
  check('E.7 a generated site (which made its own pictures) is not given one', o9.pending === null, o9);
  var E3 = stage();
  check('E.7 a record\'s picture of another event is never put in (applyAiHero\'s own check)',
    E3.ctx.applyAiHero({ aiHero: { url: 'https://storage.googleapis.com/test-bucket/events/other-event/generated/x.png' } }) === false && E3.log.set.length === 0);
}
