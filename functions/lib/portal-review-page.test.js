// node functions/lib/portal-review-page.test.js — "Fill in portals" (portal-review.html): the evidence report
// (GET /api/events/portal-evidence) shown as rows a person judges, and the one approver-only button that sends exactly
// the ticked (event, portal) pairs to POST /api/events/portal-backfill. Reads the page as a file, then runs its own
// script in a vm over a small fake DOM, with RevampAuth (the server) and RevampPortals (ET's roster, from the real
// et-events.js) stubbed. No network, no Firebase, no browser, no AI.
var fs = require('fs'), path = require('path'), vm = require('vm');
var access = require('./access');
var etEvents = require('./et-events');

var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function count(s, sub) { return s.split(sub).length - 1; }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var page = read('portal-review.html');
var css = read('edit-event.css');

/* ======== 1. the page as a file ======== */
var title = (/<title>([\s\S]*?)<\/title>/.exec(page) || [])[1];
check('the title says Oneworld 2.0', title === 'Fill in portals — Oneworld 2.0', title);
check('no "Revamp CMS" on the page', page.indexOf('Revamp CMS') === -1);
check('the server sends the page', access.isServableFile('portal-review.html') === true);
check('the page needs sign-in', access.isPublic({ method: 'GET', headers: {} }, '/portal-review.html') === false);
var local = (page.match(/(?:src|href)="[^"]+"/g) || []).map(function (a) { return a.replace(/^(?:src|href)="|"$/g, ''); })
  .filter(function (u) { return !/^(https?:)?\/\/|^#|^data:/.test(u); });
var unserved = local.filter(function (u) { return !access.isServableFile(u.split('?')[0]); });
check('every file the page loads or links to is one the server sends', local.length >= 5 && !unserved.length, unserved);
check('the viewport is set for phones', page.indexOf('<meta name="viewport" content="width=device-width, initial-scale=1">') !== -1);

/* K13: theme-toggle.js, auth.js, portal-picker.js and edit-event.css */
var tags = page.match(/<script\b[^>]*>/g) || [];
check('scripts: the theme bootstrap, theme-toggle.js, auth.js, portal-picker.js, then the page\'s own — in that order',
  tags.length === 5 && tags[0] === '<script>' && tags[1] === '<script src="theme-toggle.js">' && tags[2] === '<script src="auth.js">' &&
  tags[3] === '<script src="portal-picker.js">' && tags[4] === '<script>', tags);
check('the console\'s stylesheet, once, in the head', count(page, '<link rel="stylesheet" href="edit-event.css">') === 1 &&
  page.indexOf('href="edit-event.css"') < page.indexOf('</head>'));
check('the theme bootstrap runs in the head', page.indexOf('<script>try{var t=localStorage.getItem("revamp-theme")') < page.indexOf('</head>'));
check('the theme switch and the account menu in the top bar', /<span class="topbar-acts">\s*<span data-theme-toggle-target[^>]*><\/span>\s*<span data-rv-account><\/span>\s*<\/span>/.test(page));
check('back to the events listing, named for screen readers when its words are hidden on a phone',
  /<a class="back-btn" href="Event_Listing.html" aria-label="Back to events">/.test(page));

/* the look: only the console's tokens, so light and dark both follow the switch */
var style = (/<style>([\s\S]*?)<\/style>/.exec(page) || [])[1] || '';
var scripts = (page.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); });
var SRC = scripts[scripts.length - 1] || '';
check('no hex colour anywhere on the page', !/#[0-9a-fA-F]{3,8}\b(?![\w-])/.test(style) && !/#[0-9a-fA-F]{3,8}\b(?![\w-])/.test(SRC.replace(/&#\d+;/g, '')),
  (style + SRC).match(/#[0-9a-fA-F]{3,8}\b/g));
check('no rgb() or hsl() colour either', !/\b(rgba?|hsla?)\(/.test(style + SRC));
check('no token of its own: the page defines no :root colours', !/:root/.test(style));
var used = uniq((style + SRC).match(/var\(--[\w-]+\)/g) || []).map(function (v) { return v.slice(4, -1); });
var missing = used.filter(function (t) { return css.indexOf(t + ':') === -1; });
check('every colour it uses is a console token defined in edit-event.css (light and dark)', used.length >= 8 && !missing.length, missing);
check('the tokens it uses are defined again for the dark theme', used.filter(function (t) { return /^--(accent|text|surface|border|warn|ok|bg)/.test(t); })
  .every(function (t) { return /:root\[data-theme="dark"\]\{[\s\S]*?\}/.exec(css)[0].indexOf(t + ':') !== -1; }));
check('phones: a 16px side gutter, and the console\'s top bar keeps 16px too', /@media \(max-width: 760px\)\{[\s\S]*?\.pr-main\{ padding:16px 16px 70px; \}/.test(style) &&
  /@media \(max-width: 480px\)\{[\s\S]*?\.topbar\{ padding:0 16px; \}/.test(style));
check('phones: a row\'s buttons drop under its words instead of squeezing them', /\.pr-row\{ flex-wrap:wrap;/.test(style) && /\.pr-side\{ width:100%;/.test(style));
check('long names wrap rather than widen the page', /\.pr-name\{[^}]*overflow-wrap:anywhere/.test(style));
function uniq(a) { var o = []; a.forEach(function (x) { if (o.indexOf(x) === -1) o.push(x); }); return o; }

/* ES5, as every Oneworld-authored browser script */
var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
check('ES5: no let', !/\blet\s/.test(code));
check('ES5: no const', !/\bconst\s/.test(code));
check('ES5: no arrow functions', code.indexOf('=>') === -1);
check('ES5: no async / await', !/\basync\b|\bawait\b/.test(code));
check('ES5: no class', !/\bclass\s+\w/.test(code));
check('ES5: no template strings', code.indexOf('`') === -1);
check('ES5: no spread or rest', code.indexOf('...') === -1);
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the regex checks above still run */ }
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
  check('ES5 by esbuild', es5 === true, es5);
}
check('the script parses', (function () { try { new vm.Script(SRC); return true; } catch (e) { return e.message; } })() === true);
check('it calls only the two portal routes, and the roster', /'\/api\/events\/portal-evidence'/.test(SRC) && /'\/api\/events\/portal-backfill'/.test(SRC) &&
  (SRC.match(/'\/api\/[\w/-]+'/g) || []).every(function (u) { return ['\'/api/events/portal-evidence\'', '\'/api/events/portal-backfill\'', '\'/api/et/portals\''].indexOf(u) !== -1; }));
check('calls of at most 200 pairs', /var CHUNK = 200;/.test(SRC));

/* ======== a small fake DOM ======== */
function decode(s) { return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function makeDom() {
  var reg = Object.create(null);
  var doc = { activeElement: null, title: '' };
  var VOID = /^(input|br|img|meta|link|hr)$/i;
  function el(tag, attrs, parent) {
    var e = { tagName: tag.toUpperCase(), attrs: attrs || {}, parentNode: parent || null, listeners: {}, style: {}, _html: '', _desc: [], _text: '' };
    e.id = e.attrs.id || '';
    e.checked = Object.prototype.hasOwnProperty.call(e.attrs, 'checked');
    e.disabled = Object.prototype.hasOwnProperty.call(e.attrs, 'disabled');
    e.open = Object.prototype.hasOwnProperty.call(e.attrs, 'open');
    e.indeterminate = false;
    e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
    e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
    e.removeAttribute = function (k) { delete e.attrs[k]; };
    e.addEventListener = function (t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); };
    e.focus = function () { doc.activeElement = e; };
    Object.defineProperty(e, 'textContent', { get: function () { return e._text; }, set: function (v) { e._text = String(v); } });
    Object.defineProperty(e, 'innerHTML', {
      get: function () { return e._html; },
      set: function (v) {
        e._html = String(v);
        e._desc.forEach(function (d) { if (d.id && reg[d.id] === d) delete reg[d.id]; if (doc.activeElement === d) doc.activeElement = null; });
        e._desc = [];
        var m, re = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g, open = [e];
        while ((m = re.exec(e._html))) {
          if (m[1]) { if (open.length > 1) open.pop(); continue; }
          var a = {}, am, are = /([\w:-]+)(?:="([^"]*)")?/g;
          while ((am = are.exec(m[3]))) a[am[1]] = am[2] === undefined ? '' : decode(am[2]);
          var c = el(m[2], a, open[open.length - 1]);
          e._desc.push(c);
          if (c.id) reg[c.id] = c;
          if (!VOID.test(m[2]) && !/\/\s*$/.test(m[3])) open.push(c);
        }
      }
    });
    return e;
  }
  doc.getElementById = function (id) { return reg[id] || null; };
  ['pr-top', 'pr-main', 'pr-heading', 'pr-status', 'pr-body', 'pr-live', 'toast-host', 'modal-host'].forEach(function (id) { reg[id] = el('div', { id: id }); });
  reg['pr-status'].parentNode = reg['pr-main']; reg['pr-body'].parentNode = reg['pr-main'];
  function dispatch(target, type, extra) {
    var ev = { type: type, target: target, defaultPrevented: false, preventDefault: function () { ev.defaultPrevented = true; } };
    Object.keys(extra || {}).forEach(function (k) { ev[k] = extra[k]; });
    for (var n = target; n; n = n.parentNode) (n.listeners[type] || []).slice().forEach(function (fn) { fn(ev); });
    return ev;
  }
  return { doc: doc, reg: reg, el: el, dispatch: dispatch };
}
check('the page has the containers the fake DOM gives it', ['pr-top', 'pr-main', 'pr-heading', 'pr-status', 'pr-body', 'pr-live', 'toast-host', 'modal-host']
  .every(function (id) { return count(page, 'id="' + id + '"') === 1; }));

/* ======== the page's script in a vm ======== */
function respond(status, data) { return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(data); } }; }
/* o: { report | reports[] | reportFail, backfill(items, n) -> {status, data}, roster, rosterFail, noPortals } */
function load(o) {
  o = o || {};
  var dom = makeDom(), calls = { get: 0, posts: [], opened: [], redirect: 0, timers: 0 };
  var auth = {
    authedFetch: function (url, opts) {
      if (url === '/api/events/portal-evidence') {
        calls.get++;
        if (o.reportFail) { var f = o.reportFail(calls.get); if (f) return f.reject ? Promise.reject(f.reject) : Promise.resolve(respond(f.status, f.data)); }
        var rep = o.reports ? o.reports[Math.min(calls.get, o.reports.length) - 1] : o.report;
        return Promise.resolve(respond(200, JSON.parse(JSON.stringify(rep))));
      }
      if (url === '/api/et/portals') {
        calls.roster = (calls.roster || 0) + 1;
        return Promise.resolve(respond(200, { portals: etEvents.portalList() }));
      }
      if (url === '/api/events/portal-backfill') {
        var body = JSON.parse(opts.body);
        calls.posts.push({ method: opts.method, items: body.items });
        var out = o.backfill ? o.backfill(body.items, calls.posts.length) : { status: 200, data: { results: body.items.map(function (p) { return { eventId: p.eventId, status: 'set', portal: p.portal }; }) } };
        return Promise.resolve(respond(out.status, out.data));
      }
      return Promise.reject(new Error('unexpected call ' + url));
    },
    redirectToSignIn: function () { calls.redirect++; }
  };
  var portals = {
    list: function () { return o.rosterFail ? Promise.reject(new Error('The portal list could not be loaded.')) : Promise.resolve(o.roster || etEvents.portalList()); },
    nameOf: function (s) { return etEvents.PORTALS[s] || ''; },
    openSetPortal: function (opts) { calls.opened.push(opts); }
  };
  var sb = {
    document: dom.doc, console: { log: function () {}, error: function () {} }, Intl: Intl,
    setTimeout: function () { calls.timers++; return calls.timers; }, clearTimeout: function () {},
    RevampAuth: auth
  };
  if (!o.noPortals) sb.RevampPortals = portals;
  sb.window = sb;
  vm.runInNewContext(SRC, sb, { filename: 'portal-review.html' });
  function $(id) { return dom.reg[id] || null; }
  function section(id) {
    var h = $('pr-body').innerHTML, at = h.indexOf('aria-labelledby="pr-h-' + id + '"');
    if (id === 'set') at = h.indexOf('id="pr-set"');
    if (at === -1) return null;
    at = h.lastIndexOf('<', at);      // from the start of its tag, so no half tag is read as words
    var end = h.indexOf(id === 'set' ? '</details>' : '</section>', at);
    return h.slice(at, end);
  }
  function rows(id) { var s = section(id); return s ? s.split('<li class="pr-row">').slice(1) : []; }
  return { dom: dom, sb: sb, calls: calls, $: $, section: section, rows: rows,
    click: function (id) { return dom.dispatch($(id), 'click'); },
    key: function (id, k, shift) { return dom.dispatch($(id), 'keydown', { key: k, shiftKey: !!shift }); },
    tick: function (id, on) { var e = $(id); e.checked = on; return dom.dispatch(e, 'change'); } };
}
function settle() {
  var p = Promise.resolve();
  for (var i = 0; i < 12; i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); });
  return p;
}
/* the words a person sees: tags removed, entities read */
function words(html) { return decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }

/* a report in the shape of plan §2c */
function item(id, name, x) {
  var it = { eventId: id, name: name, published: false, hasGeneratedSite: false, portal: '', portalFrom: '', certain: '', certainName: '', from: '',
    evidence: [], conflict: [], disagrees: [], blockers: [], hints: [] };
  Object.keys(x || {}).forEach(function (k) { it[k] = x[k]; });
  return it;
}
var ITEMS = [
  item('brand-world-summit-2026', 'Brand World Summit 2026', { published: true, hasGeneratedSite: true, certain: 'brandequity', certainName: 'ET BrandEquity', from: 'et-record',
    evidence: [{ kind: 'et-record', portal: 'brandequity', where: 'its previous edition\'s ET record' }, { kind: 'et-link', portal: 'brandequity', where: 'the ET link of its previous edition' }] }),
  item('nexttech-summit', 'NextTech Summit', { certain: 'hr', certainName: 'ETHRWorld', from: 'et-link',
    evidence: [{ kind: 'et-link', portal: 'hr', where: 'the ET link of this edition\'s own ET page' }], hints: ['link-only'] }),
  item('qa-clone', 'Cloned Summit', { certain: 'brandequity', certainName: 'ET BrandEquity', from: 'design-reference',
    evidence: [{ kind: 'design-reference', portal: 'brandequity', where: 'the ET page its design was modelled on' }], hints: ['design-only'] }),
  // "certain" as a boolean, and evidence with no words of its own: the page holds either way, in its own words
  item('etcio-annual-conclave-2027', 'ETCIO Annual Conclave 2027', { certain: true, certainName: 'ETCIO', from: 'et-record',
    evidence: [{ kind: 'et-record', portal: 'cio' }] }),
  item('cio', 'Cio', { evidence: [{ kind: 'et-link', portal: 'hr', where: 'the ET link of this edition\'s own ET page' }], blockers: ['name-mentions:cio'], hints: ['link-only'] }),
  item('conflict-conclave', 'Conflict Conclave', { evidence: [{ kind: 'et-record', portal: 'hr', where: 'this edition\'s own ET record' }, { kind: 'design-reference', portal: 'cio', where: 'the ET page its design was modelled on' }],
    conflict: ['cio', 'hr'] }),
  item('retail-site', 'Retail Site Summit', { hasGeneratedSite: true, evidence: [{ kind: 'site-bar', portal: 'retail', where: 'the ET bar its site was generated with' },
    { kind: 'site-footer', portal: 'retail', where: 'the ET footer its site was generated with' }], blockers: ['site-only'] }),
  item('bad-stored', 'Old Stored Value', { portal: 'hrworld' }),
  item('lovable-import', 'Lovable Import', {}),
  item('auto-expo', 'Auto Expo', { portal: 'auto', portalFrom: 'set', disagrees: ['hr'], evidence: [{ kind: 'et-record', portal: 'hr', where: 'its previous edition\'s ET record' }] })
];
var REPORT = { generatedAt: '2026-11-03T08:35:00.000Z', canFill: true, approvers: ['owner@timesinternet.in'],
  counts: { live: 10, withPortal: 2, certain: 4, blocked: 2, conflict: 1, none: 1 }, items: ITEMS };

var CODES = ['name-mentions', 'site-only', 'link-only', 'design-only', 'et-record', 'et-link', 'design-reference', 'logo-unit-page', 'site-bar', 'site-footer',
  'changed-since-review', 'not-certain', 'has-portal', 'not-live', 'not-found', 'not-an-approver', 'hrworld', 'portalFrom', 'undefined', 'null', 'NaN', '[object'];
function noCodes(text) {
  var bad = CODES.filter(function (c) { return text.indexOf(c) !== -1; });
  var slugs = text.match(/\b(hr|cio|retail|brandequity|auto)\b/g);     // a slug, as a word, in lower case
  return bad.concat(slugs || []);
}

async function main() {
  /* ======== 2. the report as rows ======== */
  var P = load({ report: REPORT });
  check('first paint says the records are being read', /Reading every event's records/.test(words(P.$('pr-body').innerHTML)));
  await settle();
  var ready = P.rows('ready'), person = P.rows('person'), none = P.rows('none'), set = P.rows('set');
  check('G.1 four ready rows, three need a person plus the off-roster one, one with no evidence, one already set',
    ready.length === 4 && person.length === 4 && none.length === 1 && set.length === 1, [ready.length, person.length, none.length, set.length]);
  check('G.1 every ready row is ticked, with the portal it shows', ready.every(function (r) { return /<input type="checkbox" id="pr-cb-\d+" data-pick="[^"]+" data-portal="[a-z]+" checked>/.test(r); }) &&
    ready.map(function (r) { return /data-portal="([a-z]+)"/.exec(r)[1]; }).join() === 'brandequity,hr,brandequity,cio');
  check('G.1 a ready row shows the portal\'s name (from ET\'s roster)', words(ready[0]).indexOf('Brand World Summit 2026 → gets ET BrandEquity Published') === 0 &&
    words(ready[3]).indexOf('ETCIO Annual Conclave 2027 → gets ETCIO') === 0, [words(ready[0]), words(ready[3])]);
  check('G.1 the evidence in words', words(ready[0]).indexOf('From its previous edition\'s ET record and the ET link of its previous edition.') !== -1 &&
    words(ready[1]).indexOf('From the ET link of this edition\'s own ET page.') !== -1 && words(ready[2]).indexOf('From the ET page its design was modelled on.') !== -1,
    [words(ready[0]), words(ready[1]), words(ready[2])]);
  check('evidence with no words of its own is said in the page\'s words', words(ready[3]).indexOf('From its previous edition\'s ET record.') !== -1, words(ready[3]));
  check('G.1 the hints as sentences', words(ready[1]).indexOf('Only a typed ET link says so.') !== -1 && words(ready[2]).indexOf('Only the design it was copied from says so.') !== -1);
  check('G.1 a "Published" tag only on the published event', /<span class="pr-tag">Published<\/span>/.test(ready[0]) && ready.slice(1).every(function (r) { return r.indexOf('pr-tag') === -1; }));
  check('G.1 no tick box outside the ready rows', [person, none, set].every(function (g) { return g.every(function (r) { return r.indexOf('type="checkbox"') === -1; }); }));
  check('G.1 blocked, conflicting and no-evidence rows each carry Set portal', person.concat(none).every(function (r) { return /data-set-portal="[^"]+"[^>]*>Set portal/.test(r); }));
  check('G.1 the already-set rows have nothing to press', set.every(function (r) { return r.indexOf('<button') === -1 && r.indexOf('<a ') === -1 && r.indexOf('<input') === -1; }));
  var pw = person.map(words);
  check('G.1 a name that says another portal, in words', pw[0].indexOf('Its name says ETCIO; its link says ETHRWorld.') !== -1, pw[0]);
  check('G.1 a conflict, in words, with where each portal was found', pw[1].indexOf('Its sources disagree: ETCIO, ETHRWorld.') !== -1 &&
    pw[1].indexOf('ETCIO from the ET page its design was modelled on; ETHRWorld from this edition\'s own ET record.') !== -1, pw[1]);
  check('G.1 only the generated site, in words', pw[2].indexOf('Only its site\'s generated bar and footer say ETRetail.') !== -1, pw[2]);
  check('G.1 a stored value that is not an ET portal needs a person', pw[3].indexOf('It holds a portal Oneworld does not list. Set the right one.') !== -1, pw[3]);
  check('G.1 already set: folded, with what its sources also mention', /<details class="panel pr-fold" id="pr-set">/.test(P.$('pr-body').innerHTML) &&
    words(set[0]).indexOf('Auto Expo · ETAuto') === 0 && words(set[0]).indexOf('Set by a person.') !== -1 && words(set[0]).indexOf('Its sources also mention ETHRWorld.') !== -1, words(set[0]));
  var visible = words(P.$('pr-body').innerHTML + ' ' + P.$('pr-status').innerHTML);
  check('G.1 reasons are in words: no code and no slug is shown', !noCodes(visible).length, noCodes(visible));
  check('the summary counts the groups', words(P.$('pr-status').innerHTML).indexOf('10 live events · 4 ready to fill in · 4 need a person · 1 with no evidence · 1 already has a portal') === 0,
    words(P.$('pr-status').innerHTML));
  check('an approver sees no approver sentence', !P.$('pr-gate'));
  check('G.2 the button counts the ticked rows', /id="pr-fill">Fill in 4 portals</.test(P.$('pr-body').innerHTML) && !P.$('pr-fill').disabled);
  check('each row opens its event in the console, in a new tab', /href="edit-event.html\?event=nexttech-summit" target="_blank" rel="noopener"/.test(ready[1]));

  /* unticking, and a tick that cannot be */
  P.tick('pr-cb-2', false);
  check('G.2 unticking a row: "Fill in 3 portals"', /id="pr-fill">Fill in 3 portals</.test(P.$('pr-body').innerHTML) && P.$('pr-cb-2') && !P.$('pr-cb-2').checked);
  check('… and "Tick all" shows some but not all', P.$('pr-all') && P.$('pr-all').indeterminate === true && !P.$('pr-all').checked);
  check('… and focus stays on the box', P.dom.doc.activeElement === P.$('pr-cb-2'));
  var fake = P.dom.el('input', { 'data-pick': 'cio', 'data-portal': 'hr', type: 'checkbox' }, P.$('pr-body'));
  fake.checked = true; P.dom.dispatch(fake, 'change');
  check('G.2 a blocked event can never be ticked, even by a forged box', /id="pr-fill">Fill in 3 portals</.test(P.$('pr-body').innerHTML));

  /* the confirm: Escape sends nothing */
  P.click('pr-fill');
  var modal = P.$('pr-modal');
  check('G.2 a confirm opens: a labelled modal dialog', !!modal && modal.getAttribute('role') === 'dialog' && modal.getAttribute('aria-modal') === 'true' &&
    modal.getAttribute('aria-labelledby') === 'pr-modal-title' && words(P.$('modal-host').innerHTML).indexOf('Fill in 3 portals?') === 0);
  check('G.2 the confirm\'s words', words(P.$('modal-host').innerHTML).indexOf('3 events get the portal shown beside them. This is logged on each event and can be changed later in its Basics.') !== -1);
  check('… with the site and published-form notes, since a ticked event has both', words(P.$('modal-host').innerHTML).indexOf('A site that already exists keeps its ET bar and footer until it is generated again.') !== -1 &&
    words(P.$('modal-host').innerHTML).indexOf('A published registration form keeps its privacy links until it is published again.') !== -1);
  check('… the page behind it is inert, and focus is on its button', P.$('pr-main').getAttribute('inert') === '' && P.$('pr-top').getAttribute('inert') === '' &&
    P.dom.doc.activeElement === P.$('pr-modal-ok'));
  P.key('pr-modal', 'Tab');
  check('… Tab stays inside the dialog', P.dom.doc.activeElement === P.$('pr-modal-cancel'));
  P.key('pr-modal', 'Tab', true);
  check('… Shift+Tab too', P.dom.doc.activeElement === P.$('pr-modal-ok'));
  P.key('pr-modal', 'Escape');
  await settle();
  check('Escape closes it, sends nothing, and gives focus back to the button', !P.$('pr-modal') && P.calls.posts.length === 0 && P.dom.doc.activeElement === P.$('pr-fill') &&
    P.$('pr-main').getAttribute('inert') === null);
  P.click('pr-fill'); P.click('pr-modal-cancel');
  check('Cancel sends nothing either', !P.$('pr-modal') && P.calls.posts.length === 0);

  /* the press: exactly the ticked pairs, the portal shown; the server's answers in words; then the report again */
  var AFTER = JSON.parse(JSON.stringify(REPORT));
  AFTER.generatedAt = '2026-11-03T08:40:00.000Z';
  AFTER.items.forEach(function (it) {
    if (it.eventId === 'brand-world-summit-2026') { it.portal = 'brandequity'; it.portalFrom = 'backfill'; }
    if (it.eventId === 'etcio-annual-conclave-2027') { it.portal = 'cio'; it.portalFrom = 'backfill'; }
  });
  var Q = load({ reports: [REPORT, AFTER], backfill: function (items) {
    return { status: 200, data: { results: items.map(function (p) {
      return p.eventId === 'nexttech-summit' ? { eventId: p.eventId, status: 'skipped', reason: 'changed-since-review' } : { eventId: p.eventId, status: 'set', portal: p.portal };
    }) } };
  } });
  await settle();
  Q.tick('pr-cb-2', false);
  Q.click('pr-fill');
  Q.click('pr-modal-ok');
  check('while it is sent: the button says so, and nothing can be ticked or pressed', /id="pr-fill" disabled>Filling in…</.test(Q.$('pr-body').innerHTML) &&
    !/<input type="checkbox"(?![^>]*disabled)/.test(Q.section('ready')) && Q.dom.doc.activeElement === Q.$('pr-h-run'));
  await settle();
  check('G.2 one call with exactly the ticked pairs, each with the portal shown', Q.calls.posts.length === 1 && Q.calls.posts[0].method === 'POST' &&
    JSON.stringify(Q.calls.posts[0].items) === JSON.stringify([{ eventId: 'brand-world-summit-2026', portal: 'brandequity' }, { eventId: 'nexttech-summit', portal: 'hr' },
      { eventId: 'etcio-annual-conclave-2027', portal: 'cio' }]), Q.calls.posts[0]);
  check('G.2 then the report is read again', Q.calls.get === 2);
  var run = Q.rows('run').map(words);
  check('G.2 each result in words', run.length === 3 && run[0].indexOf('Set to ET BrandEquity.') !== -1 &&
    run[1].indexOf('Skipped: its records changed after this page read them. Check it again before filling it in.') !== -1 && run[2].indexOf('Set to ETCIO.') !== -1, run);
  check('… and in one line, in a toast', words(Q.$('toast-host').innerHTML) === 'Filled in 2 portals. 1 event was skipped; each says why.' &&
    /role="status"/.test(Q.$('toast-host').innerHTML), words(Q.$('toast-host').innerHTML));
  check('… and the run panel says the same', words(Q.section('run')).indexOf('What the last press did 3 Filled in 2 portals. 1 event was skipped; each says why.') === 0, words(Q.section('run')).slice(0, 120));
  var r2 = Q.rows('ready');
  check('after reading again: the two set ones have left the ready list', r2.length === 2 && words(r2[0]).indexOf('NextTech Summit') === 0 && words(r2[1]).indexOf('Cloned Summit') === 0);
  check('… the skipped one says why, and starts unticked so it is looked at again', words(r2[0]).indexOf('Skipped: its records changed after this page read them.') !== -1 &&
    / data-pick="nexttech-summit"[^>]*>/.test(r2[0]) && !/ data-pick="nexttech-summit"[^>]* checked/.test(r2[0]));
  check('… the row the person unticked stays unticked', !/ data-pick="qa-clone"[^>]* checked/.test(r2[1]));
  check('… nothing is ticked, so the button cannot be pressed', /id="pr-fill" disabled>Fill in 0 portals</.test(Q.$('pr-body').innerHTML));
  check('… the set ones are under "Already set", marked as just filled in', words(Q.section('set')).indexOf('Filled in just now.') !== -1 &&
    count(Q.section('set'), 'Filled in just now.') === 2 && words(Q.section('set')).indexOf('Filled in from its records.') !== -1);
  check('… and focus is on what the press did', Q.dom.doc.activeElement === Q.$('pr-h-run'));
  var vis2 = words(Q.$('pr-body').innerHTML);
  check('after the press: still no code or slug shown', !noCodes(vis2).length, noCodes(vis2));

  /* G.2 calls of at most 200 */
  var MANY = { generatedAt: REPORT.generatedAt, canFill: true, approvers: [], items: [] };
  for (var i = 0; i < 205; i++) MANY.items.push(item('ev-' + i, 'Event ' + i, { certain: i % 2 ? 'hr' : 'cio', evidence: [{ kind: 'et-record', portal: i % 2 ? 'hr' : 'cio' }] }));
  var M = load({ report: MANY });
  await settle();
  check('205 certain events: "Fill in 205 portals", all ticked, "Tick all" checked', /id="pr-fill">Fill in 205 portals</.test(M.$('pr-body').innerHTML) && M.$('pr-all').checked);
  M.click('pr-fill'); M.click('pr-modal-ok');
  await settle();
  var sent = [].concat.apply([], M.calls.posts.map(function (p) { return p.items; }));
  check('G.2 sent in calls of at most 200: 200, then 5', M.calls.posts.map(function (p) { return p.items.length; }).join() === '200,5', M.calls.posts.map(function (p) { return p.items.length; }));
  check('… each pair once, in order, with its own portal', sent.length === 205 && sent.every(function (p, k) { return p.eventId === 'ev-' + k && p.portal === (k % 2 ? 'hr' : 'cio'); }));
  var M2 = load({ report: MANY });
  await settle();
  M2.tick('pr-all', false);
  check('"Tick all" off unticks every row', /id="pr-fill" disabled>Fill in 0 portals</.test(M2.$('pr-body').innerHTML) && !/ checked/.test(M2.section('ready')));
  M2.tick('pr-cb-7', true);
  M2.click('pr-fill'); M2.click('pr-modal-ok');
  await settle();
  check('… then one ticked row sends that one pair alone, with the singular words', M2.calls.posts.length === 1 &&
    JSON.stringify(M2.calls.posts[0].items) === JSON.stringify([{ eventId: 'ev-7', portal: 'hr' }]));

  /* a call that fails part-way: what was done is kept, the rest is said in words, and the report is read again */
  var F = load({ report: MANY, backfill: function (items, n) {
    return n === 1 ? { status: 200, data: { results: items.map(function (p) { return { eventId: p.eventId, status: 'set', portal: p.portal }; }) } } :
      { status: 403, data: { error: 'Only an approver (owner@timesinternet.in) can fill in portals.', code: 'not-an-approver' } };
  } });
  await settle();
  F.click('pr-fill'); F.click('pr-modal-ok');
  await settle();
  var frun = F.section('run');
  check('a refused second call: the server\'s sentence, and the stop said in words', words(frun).indexOf('The fill-in stopped: Only an approver (owner@timesinternet.in) can fill in portals.') !== -1 &&
    count(frun, 'Set to ') === 200 && count(frun, 'Not filled in: the fill-in stopped before this one was done.') === 5, words(frun).slice(0, 300));
  check('… an error toast says it, and the report is read again', /toast-error/.test(F.$('toast-host').innerHTML) && F.calls.get === 2 &&
    words(F.$('toast-host').innerHTML).indexOf('Filled in 200 portals. 5 events were not filled in. The fill-in stopped: Only an approver') === 0, words(F.$('toast-host').innerHTML));

  /* the server stopped part-way through one call (500 backfill-stopped): what it did is kept, the rest said */
  var three = JSON.parse(JSON.stringify(REPORT));
  var PS = load({ report: three, backfill: function (items) {
    return { status: 500, data: { error: 'Filling in stopped after 1 of 4 events. Load the report again to see where each one stands.', code: 'backfill-stopped',
      results: [{ eventId: items[0].eventId, status: 'set', portal: items[0].portal }] } };
  } });
  await settle();
  PS.click('pr-fill'); PS.click('pr-modal-ok');
  await settle();
  var prun = PS.rows('run').map(words);
  check('a call that stopped part-way: the one it did is "Set", the others are not filled in, and the server\'s sentence shows',
    prun.length === 4 && prun[0].indexOf('Set to ET BrandEquity.') !== -1 && prun.slice(1).every(function (r) { return r.indexOf('Not filled in: the fill-in stopped before this one was done.') !== -1; }) &&
    words(PS.section('run')).indexOf('The fill-in stopped: Filling in stopped after 1 of 4 events. Load the report again to see where each one stands.') !== -1, prun);
  check('… and every one not filled in starts unticked when the list is read again', PS.calls.get === 2 &&
    PS.rows('ready').slice(1).every(function (r) { return !/ checked/.test(r); }));

  /* the page reads the real evidence module's verdicts (lib/event-portal.js, Unit B) as they come */
  var ep = null;
  try { ep = require('./event-portal'); } catch (e) { console.log('portal-review-page: lib/event-portal.js is not here yet; its verdict checks are left out'); }
  if (ep) {
    var REAL = [
      ['digiplus-awards-2027', 'Digiplus Awards 2027', {}, [{ type: 'previousEdition', previous: { portal: 'brandequity' }, award: { portal: 'brandequity' } }]],
      ['qa-cloned', 'Cloned QA', { designPlan: { reference: { type: 'previousEdition', url: 'https://brandequity.economictimes.indiatimes.com/events/x' } } }, []],
      ['cio', 'Cio', {}, [{ type: 'currentEdition', url: 'https://hr.economictimes.indiatimes.com/nextech2026', previous: null }]],
      ['retail-leadership-summit', 'Retail Leadership Summit', {}, [{ type: 'currentEdition', previous: { portal: 'hr' } }]],
      ['conflicted', 'Conflicted Summit', { designPlan: { reference: { type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/x' } } }, [{ type: 'previousEdition', previous: { portal: 'hr' } }]],
      ['site-only-real', 'Site Only Summit', { generatedAt: '2026-10-01', generatedSections: [{ id: 'nav', html: '<img src="/templates/_shared/img/portals/retail.png"><img src="/templates/_shared/img/portals/retail-light.png">' },
        { id: 'footer', html: '<footer data-rv-et-footer="retail"></footer>' }] }, []],
      ['competitor-only', 'Trendies Award 2027', {}, [{ type: 'competitor', url: 'https://brandequity.economictimes.indiatimes.com/y' }]]
    ].map(function (r) {
      var ev = Object.assign({ name: r[1] }, r[2]), v = ep.evidenceOf(ev, r[3]);
      return { eventId: r[0], name: r[1], published: false, hasGeneratedSite: !!ev.generatedAt, portal: '', portalName: '', portalFrom: '',
        certain: v.portal, certainName: ep.nameOf(v.portal), from: v.from, evidence: v.evidence, conflict: v.conflict, disagrees: v.disagrees, blockers: v.blockers, hints: v.hints };
    });
    var B = load({ report: { generatedAt: REPORT.generatedAt, canFill: true, approvers: [], items: REAL } });
    await settle();
    var br = B.rows('ready').map(words), bp = B.rows('person').map(words), bn = B.rows('none').map(words);
    check('real verdicts: two ready, ticked', br.length === 2 && br[0].indexOf('Digiplus Awards 2027 → gets ET BrandEquity') === 0 &&
      br[0].indexOf('From its previous edition\'s ET record.') !== -1 && br[1].indexOf('Only the design it was copied from says so.') !== -1 && B.rows('ready').every(function (r) { return / checked/.test(r); }), br);
    check('real verdicts: the name blocks, in words', bp.some(function (r) { return r.indexOf('Cio') === 0 && r.indexOf('Its name says ETCIO; its link says ETHRWorld.') !== -1; }) &&
      bp.some(function (r) { return r.indexOf('Retail Leadership Summit') === 0 && r.indexOf('Its name says ETRetail; this edition\'s own ET record says ETHRWorld.') !== -1; }), bp);
    check('real verdicts: a conflict and a site-only one need a person', bp.some(function (r) { return r.indexOf('Its sources disagree: ETCIO, ETHRWorld.') !== -1; }) &&
      bp.some(function (r) { return r.indexOf('Only its site\'s generated bar and footer say ETRetail.') !== -1; }), bp);
    check('real verdicts: a competitor\'s page is no evidence', bn.length === 1 && bn[0].indexOf('Trendies Award 2027') === 0, bn);
    var bv = words(B.$('pr-body').innerHTML);
    check('real verdicts: no code or slug shown', !noCodes(bv).length, noCodes(bv));
  }

  /* G.2 canFill false: read only, with the approver sentence */
  var RO = JSON.parse(JSON.stringify(REPORT));
  RO.canFill = false; RO.approvers = ['owner@timesinternet.in', 'lead@timesinternet.in'];
  var R = load({ report: RO });
  await settle();
  check('G.2 canFill false: no button, and no tick box anywhere', !R.$('pr-fill') && R.$('pr-body').innerHTML.indexOf('type="checkbox"') === -1 && !R.$('pr-all'));
  check('G.2 … and the approver sentence, naming them', R.$('pr-gate') && words(R.$('pr-status').innerHTML).indexOf('Only an approver (owner@timesinternet.in, lead@timesinternet.in) can fill in portals. You can still set each event\'s portal yourself with Set portal.') !== -1,
    words(R.$('pr-status').innerHTML));
  check('… where every row, the ready ones too, has Set portal', R.rows('ready').concat(R.rows('person'), R.rows('none')).every(function (r) { return r.indexOf('data-set-portal=') !== -1; }));

  /* Set portal: the person chooses; nothing is pre-selected; the page reads the report again */
  R.click('pr-sp-person-0');
  var op = R.calls.opened[0] || {};
  check('Set portal opens the shared dialog for that event, with nothing pre-selected', R.calls.opened.length === 1 && op.eventId === 'cio' && op.eventName === 'Cio' &&
    op.current === '' && op.hasGeneratedSite === false && op.published === false && typeof op.onDone === 'function' && op.returnFocus === R.$('pr-sp-person-0'), Object.keys(op));
  R.click('pr-sp-person-2');
  check('… and tells the dialog about a generated site, for its note', R.calls.opened[1] && R.calls.opened[1].hasGeneratedSite === true && R.calls.opened[1].eventId === 'retail-site');
  R.calls.opened[0].onDone('cio', 'ETCIO');
  await settle();
  check('after it is set: a toast in words, and the report read again', words(R.$('toast-host').innerHTML) === '“Cio” is now on ETCIO.' && R.calls.get === 2);
  check('… and focus goes to the next event\'s Set portal', R.dom.doc.activeElement === R.$('pr-sp-person-0'));

  /* a Set portal after a press never changes what the press is reported to have done: the run panel keeps its own
     answers, and only the row's own line goes (the panel once read "Waiting…" and "not filled in" for a finished run) */
  var AB = { generatedAt: REPORT.generatedAt, canFill: true, approvers: [], items: [
    item('alpha', 'Alpha Summit', { certain: 'cio', evidence: [{ kind: 'et-record', portal: 'cio' }] }),
    item('beta', 'Beta Summit', { certain: 'cio', evidence: [{ kind: 'et-record', portal: 'cio' }] })] };
  var AB2 = JSON.parse(JSON.stringify(AB));      // after the press: Alpha is set; Beta's records now disagree
  AB2.items[0].portal = 'cio'; AB2.items[0].portalFrom = 'backfill';
  AB2.items[1].certain = ''; AB2.items[1].conflict = ['cio', 'hr'];
  AB2.items[1].evidence.push({ kind: 'design-reference', portal: 'hr' });
  var AB3 = JSON.parse(JSON.stringify(AB2));     // after Set portal on Beta
  AB3.items[1].portal = 'cio'; AB3.items[1].portalFrom = 'set';
  var W = load({ reports: [AB, AB2, AB2, AB3], backfill: function (items) {
    return { status: 200, data: { results: items.map(function (p) {
      return p.eventId === 'beta' ? { eventId: p.eventId, status: 'skipped', reason: 'conflict' } : { eventId: p.eventId, status: 'set', portal: p.portal };
    }) } };
  } });
  await settle();
  W.click('pr-fill'); W.click('pr-modal-ok');
  await settle();
  var SKIP = 'Skipped: its records now name more than one portal.', SUM = 'What the last press did 2 Filled in 1 portal. 1 event was skipped; each says why.';
  function runOk(R) {
    var rr = R.rows('run').map(words), all = words(R.section('run'));
    return all.indexOf(SUM) === 0 && rr.length === 2 && rr[0].indexOf('Alpha Summit') === 0 && rr[0].indexOf('Set to ETCIO.') !== -1 &&
      rr[1].indexOf('Beta Summit') === 0 && rr[1].indexOf(SKIP) !== -1 && all.indexOf('Waiting') === -1 && all.indexOf('not filled in') === -1 && all.indexOf('Not filled in') === -1;
  }
  check('a press that skips one: the run panel says so, and the skipped row says why under "Needs a person"', runOk(W) && W.calls.get === 2 &&
    W.rows('person').length === 1 && words(W.rows('person')[0]).indexOf(SKIP) !== -1, [words(W.section('run')), W.rows('person').map(words)]);
  W.click('pr-sp-person-0');
  check('… Set portal opens for the skipped event', W.calls.opened.length === 1 && W.calls.opened[0].eventId === 'beta');
  W.calls.opened[0].onDone('cio', 'ETCIO');      // the next read still has it under "Needs a person"
  await settle();
  check('… after Set portal the run panel still says what the press did: Beta skipped, nothing waiting, nothing failed', runOk(W) && W.calls.get === 3,
    words(W.section('run')));
  check('… and only the row\'s own line went', W.rows('person').length === 1 && words(W.rows('person')[0]).indexOf('Skipped:') === -1, W.rows('person').map(words));
  W.click('pr-sp-person-0');
  W.calls.opened[1].onDone('cio', 'ETCIO');      // and once the read shows it set by the person
  await settle();
  var wset = W.rows('set').map(words);
  check('… once it is under "Already set", the run panel still has not changed', runOk(W) && W.calls.get === 4, words(W.section('run')));
  check('… Alpha is marked as just filled in; Beta, set by a person, is not', wset.length === 2 && wset[0].indexOf('Filled in just now.') !== -1 &&
    wset[1].indexOf('Set by a person.') !== -1 && wset[1].indexOf('Filled in just now.') === -1 && wset[1].indexOf('Skipped') === -1, wset);

  /* G.3 signed out, a failed report, a roster that cannot load: the error, with Retry */
  var E = load({ report: REPORT, reportFail: function (n) { return n === 1 ? { status: 500, data: { error: 'The events could not be read right now.', code: 'internal' } } : null; } });
  await settle();
  check('G.3 a failed report: its sentence, as an alert, with Retry', /<div class="pr-banner err" role="alert">/.test(E.$('pr-status').innerHTML) &&
    words(E.$('pr-status').innerHTML) === 'The events could not be read right now. Retry' && !!E.$('pr-retry') && !E.$('pr-signin'));
  check('… and no rows', E.$('pr-body').innerHTML.indexOf('pr-row') === -1);
  E.click('pr-retry');
  await settle();
  check('G.3 Retry reads it again, and the rows come', E.calls.get === 2 && E.rows('ready').length === 4 && !E.$('pr-retry'));
  var O = load({ report: REPORT, reportFail: function () { var e = new Error('You are signed out. Sign in again to continue.'); e.status = 401; e.code = 'revamp/signed-out'; return { reject: e }; } });
  await settle();
  check('G.3 signed out: the sentence, Retry, and a way to sign in again', words(O.$('pr-status').innerHTML) === 'You are signed out. Sign in again to continue. Sign in again Retry' &&
    !!O.$('pr-retry') && !!O.$('pr-signin'));
  O.click('pr-signin');
  check('… which goes to sign-in', O.calls.redirect === 1);
  var N = load({ report: REPORT, rosterFail: true });
  await settle();
  check('G.3 ET\'s portal list cannot load: the error with Retry, and no row shows a portal it cannot name', words(N.$('pr-status').innerHTML) === 'The portal list could not be loaded. Retry' &&
    N.$('pr-body').innerHTML.indexOf('pr-row') === -1);
  var U = load({ report: REPORT, reportFail: function () { return { status: 502, data: 'not json' }; } });
  await settle();
  check('a failure with no sentence of its own still says something', words(U.$('pr-status').innerHTML) === 'The events could not be read. (502) Retry', words(U.$('pr-status').innerHTML));
  var X = load({ report: REPORT, noPortals: true });
  await settle();
  check('without portal-picker.js the page reads ET\'s roster from the server itself, and shows the rows', X.calls.roster === 1 && X.rows('ready').length === 4 &&
    words(X.rows('ready')[1]).indexOf('NextTech Summit → gets ETHRWorld') === 0);
  X.click('pr-sp-person-0');
  check('… and Set portal says it cannot open, rather than doing nothing', /toast-error/.test(X.$('toast-host').innerHTML) &&
    words(X.$('toast-host').innerHTML) === 'Set portal could not be opened. Reload the page and try again.');

  /* no live events */
  var Z = load({ report: { generatedAt: REPORT.generatedAt, canFill: true, approvers: [], items: [] } });
  await settle();
  check('no live events: one sentence, no button', words(Z.$('pr-body').innerHTML) === 'There are no live events yet.' && !Z.$('pr-fill'));
  /* nothing ready */
  var NR = JSON.parse(JSON.stringify(REPORT));
  NR.items = NR.items.filter(function (it) { return !it.certain; });
  var Y = load({ report: NR });
  await settle();
  check('nothing ready: it says so, and there is no button', words(Y.section('ready')).indexOf('Nothing is ready to fill in. Each event left needs a person to choose its portal.') !== -1 && !Y.$('pr-fill'));

  if (failed) { console.error('portal-review-page: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('portal-review-page: all ' + passed + ' checks passed');
}
main().catch(function (e) { console.error('portal-review-page: crashed — ' + (e && e.stack || e)); process.exit(1); });
