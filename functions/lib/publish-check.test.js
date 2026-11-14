// node functions/lib/publish-check.test.js — the check before Publish in the browser (owner decision #11, part 3.2):
// the send and publish dialogs of publish-flow.js list what the site check finds, with links to put it right, and never
// wait for it or stop on it; the site editor shows a section in place; the review page shows the approver the same list
// and fills it in. publish-flow.js runs in a vm with a small stand-in for the page; the pages' wiring is read in their
// source, as publish-flow.test.js does. No network, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); };
const FLOW = read('publish-flow.js');
const EDITOR = read('editor-template-ui.js');
const REVIEW = read('review.html');

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : ''));
}

const ctx = vm.createContext({ window: { RevampCore: {} }, document: {}, console: console });
vm.runInContext(FLOW, ctx, { filename: 'publish-flow.js' });
const T = ctx.window.RevampPublishFlow._test;

/* ---------- 1. the list's words ---------- */
var fixE = { where: 'editor', key: 'about-2', label: '“About” in the site editor', href: '/custom_editor.html?event=e&section=about-2' };
var fixC = { where: 'console', route: 'content/basics', label: 'Content › Basics', href: '/edit-event.html?event=e#content/basics' };
var R = { found: true, pending: 0, items: [
  { code: 'placeholders', level: 'block', title: 'Template text is still on the page', lines: ['“Question goes here?” — FAQ'], hint: 'Write the event’s own words.', fix: [fixE] },
  { code: 'links', level: 'warn', advisory: true, title: '2 links lead nowhere', lines: ['a', 'b', 'c', 'd', 'e', 'f'], hint: 'Visitors reach nothing.', fix: [fixE] },
  { code: 'dates', level: 'warn', advisory: true, title: 'A date on the page is not the event’s', lines: ['“12 Mar 2026” — <Header>'], fix: [fixE, fixC] },
  { code: 'links-unchecked', level: 'info', advisory: true, title: '1 link could not be checked', lines: [] }
] };
var v = T.checksView(R, false);
check('1 a block is said first, as what must be put right; the rest counted', v.state === '1 thing must be put right before it can go live, and 2 more to look at.', v.state);
check('1 each item: its level, title, lines (4 shown, the rest counted), hint and where to put it right', /Holds it back/.test(v.html) && /Good to know/.test(v.html) && /…and 2 more/.test(v.html) && /Put it right: <a class="rvpf-qa-fix"/.test(v.html), v.html.slice(0, 400));
check('1 every fix link is a real link (a new tab), numbered for the click', v.fixes.length === 4 && /href="\/edit-event\.html\?event=e#content\/basics" target="_blank" rel="noopener" data-rvpf-fix="3"/.test(v.html), v.fixes);
check('1 what the page says is escaped', /&lt;Header&gt;/.test(v.html) && !/<Header>/.test(v.html));
var w = T.checksView({ found: true, pending: 3, items: [R.items[1]] }, false);
check('1 only advice: it says it does not stop sending, and what is still being checked', w.state === '1 thing to look at. It does not stop you sending it. Still checking 3 links on other sites…', w.state);
check('1 with approval switched off: "publishing it"', /stop you publishing it/.test(T.checksView({ found: true, items: [R.items[1], R.items[2]] }, true).state));
check('1 nothing found: says what was checked', /Nothing to fix found: the links, pictures, sections, dates, place, logo and forms were all checked\./.test(T.checksView({ found: true, items: [] }).state));
check('1 could not be checked: says so, and that it can still go on', /could not be checked just now\. You can still go on: the approver’s page checks it again\./.test(T.checksView(null, false).state) && T.checksView(null, false).html === '');
check('1 the box: a heading and a polite status line', /<h3 id="rvpf-qa-h">Before it goes live<\/h3>/.test(T.checksBox()) && /role="status" aria-live="polite"/.test(T.checksBox()));

/* ---------- 2. in the dialogs, never in the way ---------- */
var askFn = FLOW.slice(FLOW.indexOf('  function ask(eventId'), FLOW.indexOf('  function direct('));
var directFn = FLOW.slice(FLOW.indexOf('  function direct('), FLOW.indexOf('WHAT BECAME OF THE LAST REQUEST'));
check('2 the send dialog and the publish dialog both carry the list, filled once they are open', /checksBox\(\)/.test(askFn) && /watchChecks\(eventId, d, false, opts, gate\)/.test(askFn) && /checksBox\(\)/.test(directFn) && /watchChecks\(eventId, d, true, opts, gate\)/.test(directFn));
check('2 no second dialog: the list is part of the one that sends (the flow still opens its six)', (FLOW.match(/dialog\(\{/g) || []).length === 6 && !/dialog\(\{[^]{0,200}Before it goes live/.test(FLOW), (FLOW.match(/dialog\(\{/g) || []).length);
var watch = FLOW.slice(FLOW.indexOf('  function openFix('), FLOW.indexOf('  function ask(eventId'));
check('2 it asks the saved site\'s check with the advice, and again while other sites are answering (bounded)', /\/api\/event\/site-check\?eventId=' \+ encodeURIComponent\(eventId\) \+ '&of=saved&advisory=1&wait='/.test(watch) && /asked < QA_POLLS/.test(watch) && /QA_POLLS = 6/.test(FLOW));
check('2 Send and Publish never wait for it: nothing in the send or publish step reads it', !/checksView|watchChecks|rvpf-qa/.test(askFn.slice(askFn.indexOf("d.on('send'"))) && !/checksView|rvpf-qa/.test(directFn.slice(directFn.indexOf("d.on('publish'"))));
check('2 a fix link shows the place: the editor\'s section in place, the console\'s tab by its route; else a new tab', /f\.where === 'editor' && opts\.from === 'editor' && typeof opts\.showSection === 'function'/.test(watch) && /location\.hash = f\.route/.test(watch) && /d\.close\(true\)/.test(watch));
check('2 it stops once the dialog has gone', /function alive\(\) \{ return document\.body\.contains\(d\.box\); \}/.test(watch) && /if \(!alive\(\)\) return;/.test(watch));
check('2 ES5 only (what is added here)', !/=>|\blet\s|\bconst\s|`/.test(FLOW.slice(FLOW.indexOf('  var QA_LEVEL'), FLOW.indexOf('  /* ============================================================\n     THE LOOK')) + watch));
check('2 never the old product names', !/Oneworld|Revamp CMS/.test(FLOW.replace(/\/\*[\s\S]*?\*\//g, '')));

/* a dialog in a stand-in page: the list fills from the server's answer, and a fix link in the editor selects the section */
(function () {
  var calls = [], shown = [];
  function El(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = ''; this._html = '';
  }
  El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
  El.prototype.addEventListener = function (k, fn) { this.listeners[k] = fn; };
  var state = new El('p'), body = new El('div'), qa = new El('section');
  qa.querySelector = function (sel) { return sel === '.rvpf-qa-state' ? state : sel === '.rvpf-qa-body' ? body : null; };
  Object.defineProperty(body, 'innerHTML', { set: function (h) { body._html = h; }, get: function () { return body._html; } });
  var box = new El('div');
  box.querySelector = function (sel) { return sel === '.rvpf-qa' ? qa : null; };
  var closed = false, dlg = { box: box, close: function () { closed = true; } };
  var answers = [
    { found: true, pending: 1, items: [R.items[1], { code: 'links-pending', level: 'info', title: 'Still checking 1 link or picture on other sites', lines: [] }] },
    { found: true, pending: 0, items: [R.items[1]] }
  ];
  var C = { authedFetch: function (url) { calls.push(url); var a = answers.shift(); return Promise.resolve({ ok: true, json: function () { return Promise.resolve(a); } }); } };
  var c2 = vm.createContext({ window: { RevampCore: C }, console: console, location: { hash: '' }, document: { body: { contains: function () { return !closed; } } } });
  vm.runInContext(FLOW, c2, { filename: 'publish-flow.js' });
  var src = FLOW.slice(FLOW.indexOf('  var QA_POLLS'), FLOW.indexOf('  function ask(eventId'));
  /* the watcher itself, run against the stand-in */
  var run = vm.runInContext('(function(){ var num=function(v){return +v||0;}; var esc=' + 'function(s){return String(s);}' + ';' +
    FLOW.slice(FLOW.indexOf('  var QA_LEVEL'), FLOW.indexOf('  /* the box the dialogs keep for it')) + src + ' return watchChecks; })()', c2);
  run('qa-e', dlg, false, { from: 'editor', showSection: function (k) { shown.push(k); return true; } });
  setTimeout(function () {
    check('3 the list fills from the server, then fills in while other sites answer (the second ask waits on the server)', calls.length === 2 && /wait=2500$/.test(calls[0]) && /wait=6000$/.test(calls[1]) && /2 links lead nowhere/.test(body._html) && !/Still checking/.test(state.textContent), { calls: calls, state: state.textContent });
    var link = { getAttribute: function () { return '0'; } };
    var prevented = false;
    qa.listeners.click({ target: { closest: function () { return link; } }, preventDefault: function () { prevented = true; } });
    check('3 in the site editor, a fix link closes the dialog and selects the section there', prevented && closed && shown[0] === 'about-2', { prevented: prevented, closed: closed, shown: shown });
    finish();
  }, 50);
})();

/* ---------- 4. the site editor and the review page ---------- */
var pub = EDITOR.slice(EDITOR.indexOf('  function publish(o) {'), EDITOR.indexOf('  function publishPlan() {'));
check('4 the editor gives Publish the way to select a section by its key or id', /showSection: function \(key\) \{/.test(pub) && /el\.getAttribute\('data-rv-key'\) === key \|\| el\.getAttribute\('data-rv-section'\) === key/.test(pub) && /selectSection\(sec\)/.test(pub));
var chk = REVIEW.slice(REVIEW.indexOf('  function checksHtml(r){'), REVIEW.indexOf("  if (!eventId){ C.renderLoadError"));
check('4 the review page shows each item\'s places to put it right, in a new tab', /Put it right: /.test(chk) && /target="_blank" rel="noopener"/.test(chk) && /esc\(f\.href\)/.test(chk) && /esc\(f\.label\)/.test(chk));
check('4 and what is still being checked, asked again with the server waiting (bounded)', /Still checking ' \+ still/.test(chk) && /CHECK_POLLS = 6/.test(REVIEW) && /&wait=6000/.test(REVIEW) && /checkPolls < CHECK_POLLS\) loadChecks\(true\)/.test(REVIEW));
check('4 a later ask that fails keeps the list', /if \(again && Array\.isArray\(data\.checks\)\) data\.checksPending = 0; else data\.checks = false;/.test(REVIEW));

/* ---------- 5. NU-010: what the server would refuse greys Send out, with the way to put it right ---------- */
var BLOCKED = { found: true, items: [
  { code: 'samples', level: 'block', title: 'Samples from the template are still on the page', lines: ['“If AI…” — Overview'],
    fix: [{ where: 'editor', key: 'overview', label: '“Overview” in the site editor', href: '/custom_editor.html?event=e&section=overview' }] },
  R.items[1]] };
var g = T.gateOf(BLOCKED, false);
var longList = T.checksView({ found: true, items: [{ code: 'samples', level: 'block', title: 'S', lines: ['a', 'b', 'c', 'd', 'e', '…and 18 more'] }] }, false);
check('5 a long list says how many more there really are (the server\'s own "…and 18 more" counted in)', /…and 19 more/.test(longList.html), longList.html);
check('5 NU-010 a block holds Send back, says why, and names the first place to put it right', g.blocked && g.count === 1 && g.first && g.first.key === 'overview' &&
  g.why === '1 thing must be put right before it can be sent: see the list at the top.', g);
check('5 NU-010 … "published" when approval is switched off', /before it can be published/.test(T.gateOf(BLOCKED, true).why));
check('5 NU-010 advice alone never holds it back (owner decision #11: advisory, always)', !T.gateOf({ found: true, items: [R.items[1], R.items[2]] }, false).blocked);
check('5 NU-010 a check that could not be read holds nothing back (the server checks again as it is sent)', !T.gateOf(null, false).blocked && !T.gateOf({ found: false }, false).blocked);
check('5 NU-010 the send and publish dialogs carry "Put it right first", hidden until the check says something blocks',
  /\{ key: 'fix-first', label: 'Put it right first', kind: 'primary', hidden: true \}/.test(askFn) && /\{ key: 'fix-first', label: 'Put it right first', kind: 'primary', hidden: true \}/.test(directFn) &&
  /gateDialog\(d, 'send', false, opts\)/.test(askFn) && /gateDialog\(d, 'publish', true, opts\)/.test(directFn));
var gateFn = FLOW.slice(FLOW.indexOf('  function gateDialog('), FLOW.indexOf('  function ask(eventId'));
check('5 NU-010 the greyed button stays greyed after a send that failed, and the list goes to the top', /btn\.setAttribute\('data-rvpf-blocked', ''\)/.test(gateFn) && /btn\.disabled = true/.test(gateFn) &&
  /b\.disabled = busy \|\| b\.hasAttribute\('data-rvpf-blocked'\)/.test(FLOW) && /body\.insertBefore\(qa, body\.firstChild\.nextSibling\)/.test(gateFn) && /aria-describedby', 'rvpf-why'/.test(gateFn));
check('5 NU-010 a refusal is said at the top of the dialog, and scrolled to', /'<div class="rvpf-body"><p class="rvpf-err" role="alert"><\/p>' \+ spec\.body/.test(FLOW) && /box\.querySelector\('\.rvpf-body'\)\.scrollTop = 0/.test(FLOW));
check('5 NU-010 a refusal for what the check holds back shows its list', /if \(err && Array\.isArray\(err\.checks\) && err\.checks\.length\) repaint\(\{ items: err\.checks, found: true \}\);/.test(askFn));

/* ---------- 6. NEW-7: Send is greyed out and says "Checking the site…" until the check's first answer ---------- */
(function () {
  function Btn(label, cls) {
    this.textContent = label; this.className = cls; this.disabled = false; this.hidden = false; this.attrs = {};
  }
  Btn.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  Btn.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
  Btn.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); };
  Btn.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
  Btn.prototype.focus = function () {};
  function dialogWith() {
    var send = new Btn('Send for approval', 'btn btn-primary'), fix = new Btn('Put it right first', 'btn btn-primary'), why = new Btn('', '');
    fix.hidden = true; why.hidden = true;
    var box = { attrs: {}, getAttribute: function () { return null; },
      querySelector: function (sel) { return sel === '[data-rvpf="send"]' ? send : sel === '[data-rvpf="fix-first"]' ? fix : sel === '.rvpf-why' ? why : null; } };
    return { send: send, fix: fix, why: why, d: { box: box, on: function () {} } };
  }
  var timers = [];
  var c3 = vm.createContext({ window: { RevampCore: {} }, console: console, location: { hash: '' },
    document: { activeElement: null, body: { contains: function () { return true; } } },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, clearTimeout: function (n) { if (timers[n - 1]) timers[n - 1].fn = null; } });
  vm.runInContext(FLOW, c3, { filename: 'publish-flow.js' });
  var gateSrc = FLOW.slice(FLOW.indexOf('  var CHECK_HOLD_MS'), FLOW.indexOf('  function ask(eventId'));
  var gate = vm.runInContext('(function(){ var openFix = function(){ return true; };' + FLOW.slice(FLOW.indexOf('  function gateOf('), FLOW.indexOf('  /* the box the dialogs keep for it')) + gateSrc + ' return gateDialog; })()', c3);

  var t = dialogWith(), apply = gate(t.d, 'send', false, {});
  check('6 NEW-7 while the check runs, Send is greyed out and says what is happening', t.send.disabled === true && t.send.textContent === 'Checking the site…' && t.send.hasAttribute('data-rvpf-blocked'), t.send);
  check('6 NEW-7 … a press then sends nothing: the send step refuses a held button, and busy() keeps it greyed', /if \(d\.box\.querySelector\('\[data-rvpf="send"\]\[data-rvpf-blocked\]'\)\) return;/.test(askFn) && /b\.disabled = busy \|\| b\.hasAttribute\('data-rvpf-blocked'\)/.test(FLOW));
  apply({ found: true, items: [R.items[1]] });
  check('6 NEW-7 the check answers with advice only: Send, red and pressable, with its own words', t.send.disabled === false && t.send.textContent === 'Send for approval' && t.send.className === 'btn btn-primary' && !t.send.hasAttribute('data-rvpf-blocked') && t.fix.hidden, t.send);
  apply({ found: true, pending: 2, items: [R.items[1]] });
  check('6 NEW-7 later answers (links on other sites) never hold it again', t.send.disabled === false && t.send.textContent === 'Send for approval');

  t = dialogWith(); apply = gate(t.d, 'send', false, {});
  apply(BLOCKED);
  check('6 NEW-7 the check answers with a block: Send stays greyed (its own words back), "Put it right first" shows', t.send.disabled === true && t.send.textContent === 'Send for approval' && t.send.className === 'btn btn-secondary' && !t.fix.hidden && !t.why.hidden, { send: t.send, fix: t.fix.hidden });

  t = dialogWith(); apply = gate(t.d, 'send', false, {});
  apply(null);
  check('6 NEW-7 a check that could not be read holds nothing back', t.send.disabled === false && t.send.textContent === 'Send for approval');

  t = dialogWith(); timers = [];
  apply = gate(t.d, 'send', false, {});
  var hold = timers.filter(function (x) { return x.ms === 15000; })[0];
  check('6 NEW-7 a check that never answers holds Send back for 15 seconds at most', !!hold && t.send.disabled === true, timers.map(function (x) { return x.ms; }));
  hold.fn();
  check('6 NEW-7 … then Send comes back (the server checks again as it is sent)', t.send.disabled === false && t.send.textContent === 'Send for approval');
  apply(BLOCKED);
  check('6 NEW-7 … and an answer that comes later still holds it back', t.send.disabled === true && !t.fix.hidden);
  check('6 NEW-7 the publish dialog (approval switched off) is held the same way', /gateDialog\(d, 'publish', true, opts\)/.test(directFn) && /holdWhileChecking\(d\.box\.querySelector\('\[data-rvpf="' \+ key \+ '"\]'\)\)/.test(gateSrc));
  check('6 NEW-7 ES5 only', !/=>|\blet\s|\bconst\s|`/.test(gateSrc));
})();

function finish() {
  if (failed) { console.error('publish-check: ' + failed + ' of ' + (failed + passed) + ' checks FAILED'); process.exit(1); }
  console.log('publish-check: all ' + passed + ' checks passed');
}
