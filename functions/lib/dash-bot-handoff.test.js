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
  check('E.1 take: the cleaned shape', t.got && JSON.stringify(Object.keys(t.got).sort()) === JSON.stringify(['at', 'basics', 'brief', 'category', 'dropped', 'from', 'method', 'portal', 'prefillId', 'turnId', 'v']) &&
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
var CE_FNS = ['esc', 'slugify', 'init', 'takePrefill', 'prefillName', 'draftLabel', 'askResumeOrDiscard', 'startWithPrefill', 'applyAiPrefill',
  'aiDraftKey', 'renderAiPrefillNote', 'undoAiPrefill', 'clearAiPrefill'];
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
/* o: { search, stored, store (localStorage contents), noModule, resumed, noNote } */
function page(o) {
  o = o || {};
  var log = { calls: [], modals: [] };
  var storage = fakeStorage(o.store || {});
  var ctx = {
    console: { log: function () {}, warn: function () {}, error: function () {} },
    URLSearchParams: URLSearchParams, URL: URL, Promise: Promise, JSON: JSON, Date: Date, Object: Object, String: String, Math: Math, isNaN: isNaN,
    location: { search: o.search || '', pathname: '/create-event.html', replace: function (u) { log.calls.push(['location.replace', u]); } },
    history: { replaceState: function (a, b, u) { log.calls.push(['replaceState', u]); } },
    localStorage: storage, CALLS: log.calls, MODALS: log.modals, STORED: o.stored || null, RESUMED: !!o.resumed,
    ELS: o.noNote ? {} : noteEl()
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (!o.noModule) vm.runInContext(PREFILL_SRC, ctx, { filename: 'create-event-prefill.js' });
  var src = [
    'var S = ' + S_SRC + ';', 'var CATS = ' + CATS_SRC + ';', 'var SLUG_MAX = 48;', 'var BRIEF_TEMPLATE = "Tagline / theme: ";',
    'var aiPrefill = null, aiNote = null, busy = null, draftClosed = false, leavingUnsaved = false;',
    'var IC = { info: "<i></i>", spark: "<s></s>" };',
    'function $(id){ return ELS[id] || null; }',
    'function readStoredDraft(){ return STORED; }',
    'function draftHasInput(d){ return !!(d && d.hasInput); }',
    'function discardStoredDraft(d){ CALLS.push(["discard", d && d.draftId]); return Promise.resolve([]); }',
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
    'function renderAiEntry(){}', 'function placeToasts(){}', 'function setTimeout(){}',
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
  check('E.2 start(): the details fill the draft after restore() and before the form is drawn', /var resumed = restore\(\);[\s\S]*if \(aiPrefill\) applyAiPrefill\(resumed\);[\s\S]*initStep1\(\);/.test(startFn) &&
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
