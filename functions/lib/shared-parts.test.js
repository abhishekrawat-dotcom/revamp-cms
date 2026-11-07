/* node functions/lib/shared-parts.test.js — the parts every page shares (UX batch B12): one message (RevampCore.toast,
   UX-006), one top bar's back link, account menu and theme switch (UX-007), one "could not load" state
   (RevampCore.renderLoadError, UX-008), phones (UX-009), one way of writing a date (RevampCore.fmtDate, UX-010), one
   save pattern and a "what is saved" chip in the console (UX-011), the rail's full height and the theme switch as an
   icon button (UX-012), and a refused session that keeps the page (UX-013).
   edit-event-core.js and theme-toggle.js run as they are over fixtures/mini-dom.js; the pages' own functions are run
   where they have logic, and read as files where the change is markup or style. No network, no production, no AI.
   Exits 1 on any failure. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var makeDom = require('./fixtures/mini-dom').makeDom;

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var CORE = read('edit-event-core.js');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '')); }
function count(s, needle) { return s.split(needle).length - 1; }
function fnSrc(src, name) {
  var m = new RegExp('\\n  function ' + name + '\\([^)]*\\)\\s?\\{[\\s\\S]*?\\n  \\}\\n').exec(src);
  return m ? m[0] : '';
}
function inline(page, marker) {
  return (page.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); })
    .filter(function (s) { return s.indexOf(marker) !== -1; })[0] || '';
}
function es5Clean(code) {
  var c = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  return !/\blet\s/.test(c) && !/\bconst\s/.test(c) && c.indexOf('=>') === -1 && c.indexOf('`') === -1 &&
    !/\bclass\s/.test(c) && !/\basync\b|\bawait\b/.test(c) && c.indexOf('...') === -1;
}

/* RevampCore over a small DOM; timers are held so a test can run them */
function core(o) {
  o = o || {};
  var dom = makeDom(), timers = [];
  var ctx = { document: dom.document, console: { log: function () {}, warn: function () {}, error: function () {} },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, clearTimeout: function (id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    requestAnimationFrame: function (fn) { fn(); } };
  ctx.window = ctx;
  if (o.region) { var r = dom.document.createElement('div'); r.setAttribute('id', 'toast-region'); r.setAttribute('role', 'status'); dom.document.body.appendChild(r); }
  vm.runInNewContext(CORE, ctx, { filename: 'edit-event-core.js' });
  return { C: ctx.RevampCore, dom: dom, doc: dom.document, timers: timers,
    run: function () { var t = timers.slice(); timers.length = 0; t.forEach(function (x) { if (x.fn) x.fn(); }); },
    host: function () { return dom.document.getElementById('rv-toasts') || dom.document.getElementById('toast-region'); },
    toasts: function () { var h = this.host(); return h ? h.querySelectorAll('.rv-toast').filter(function (t) { return !t.hasAttribute('data-gone'); }) : []; },
    click: function (el) { dom.fire(el, 'click'); } };
}

/* the parts B12 wrote (the dates, the shared look, errText, the load-error state, the toast) */
var B12CORE = CORE.slice(CORE.indexOf('  function readDate(v){'), CORE.indexOf('  function money(n){')) +
  CORE.slice(CORE.indexOf('  var SHARED_CSS = ['), CORE.indexOf('  /* ----------------------------------------------------------------\n     The bundle every section view receives.'));
check('edit-event-core.js: the shared parts are ES5 (every page runs them as they are)', B12CORE.length > 8000 && es5Clean(B12CORE), B12CORE.length);
check('theme-toggle.js is ES5', es5Clean(read('theme-toggle.js')));

/* ======================= UX-010 one way of writing a date ======================= */
(function () {
  var C = core().C;
  check('UX-010 a calendar day: "5 Dec 2026", never shifted or timed', C.fmtDate('2026-12-05') === '5 Dec 2026' && C.fmtDate('2026-12-05', { time: true }) === '5 Dec 2026');
  check('UX-010 a typed date and time: "5 Dec 2026, 10:41 am" (no leading zero, am/pm in small letters)',
    C.fmtDate('2026-12-05T10:41', { time: true }) === '5 Dec 2026, 10:41 am' && C.fmtDate('2026-12-05T22:05', { time: true }) === '5 Dec 2026, 10:05 pm' &&
    C.fmtDate('2026-12-05T00:00', { time: true }) === '5 Dec 2026, 12:00 am' && C.fmtDate('2026-12-05T12:30', { time: true }) === '5 Dec 2026, 12:30 pm');
  check('UX-010 with the weekday, for the words under a date field: "Sat 5 Dec 2026, 10:41 am"', C.fmtDate('2026-12-05T10:41', { time: true, day: true }) === 'Sat 5 Dec 2026, 10:41 am');
  /* a stamp the server made is written as India time wherever this runs (the activity log and Registrations say IST) */
  check('UX-010 a server stamp as India time: 07:00 UTC is 12:30 pm', C.fmtDate('2026-11-03T07:00:00.000Z', { time: true, ist: true }) === '3 Nov 2026, 12:30 pm');
  check('UX-010 … late in the evening UTC is the next day in India', C.fmtDate('2026-11-03T20:00:00Z', { time: true, ist: true }) === '4 Nov 2026, 1:30 am');
  check('UX-010 … a typed date carries no zone and is never shifted', C.fmtDate('2026-11-03T20:00', { time: true, ist: true }) === '3 Nov 2026, 8:00 pm');
  check('UX-010 a time alone: "10:41 am"; none for a calendar day', C.fmtTime('2026-12-05T10:41') === '10:41 am' && C.fmtTime('2026-12-05') === '' && C.fmtTime('2026-11-03T07:00:00Z', { ist: true }) === '12:30 pm');
  check('UX-010 fmtDT: the date and its time when it has one; the words when there is none',
    C.fmtDT('2026-12-05T10:41') === '5 Dec 2026, 10:41 am' && C.fmtDT('2026-12-05') === '5 Dec 2026' && C.fmtDT('') === 'Date to be announced' && C.fmtDT(null) === 'Date to be announced');
  check('UX-010 a range: "5–7 Dec 2026", "30 Nov – 2 Dec 2026", across years in full, one day alone',
    C.fmtRange('2026-12-05', '2026-12-07') === '5–7 Dec 2026' && C.fmtRange('2026-11-30T09:00', '2026-12-02T18:00') === '30 Nov – 2 Dec 2026' &&
    C.fmtRange('2026-12-30', '2027-01-02') === '30 Dec 2026 – 2 Jan 2027' && C.fmtRange('2026-12-05T09:00', '2026-12-05T18:00') === '5 Dec 2026' && C.fmtRange('', '2026-12-05') === '');
  check('UX-010 nothing readable: "—"', C.fmtDate('not a date') === '—' && C.fmtDate('2026-02-30') === '—' && C.fmtDate(undefined) === '—');
  check('UX-010 a number (milliseconds) and a Date are moments', C.fmtDate(Date.UTC(2026, 10, 3, 7, 0), { time: true, ist: true }) === '3 Nov 2026, 12:30 pm' &&
    C.fmtDate(new Date(2026, 11, 5, 9, 5), { time: true }) === '5 Dec 2026, 9:05 am');
  check('UX-010 section views get fmtTime too', typeof C.makeCtx({}).fmtTime === 'function');
})();

/* where each page writes its dates now */
var CONSOLE = read('edit-event.html'), CSS = read('edit-event.css'), LISTING = read('Event_Listing.html'), ALOG = read('activity-log.html');
var REG = read('audience-registrations.html'), REVIEW = read('review.html'), EDUI = read('editor-template-ui.js');
check('UX-010 the console: Activity times through fmtDate (India time), Basics\' days as a range, the date fields in words',
  /function histWhen\(iso\)\{ return fmtDate\(iso, \{ time: true, ist: true \}\); \}/.test(CONSOLE) &&
  CONSOLE.indexOf("'<b>' + d + ' days</b> · ' + C.fmtRange(localIso(s.a), localIso(s.b))") !== -1 && CONSOLE.indexOf("' to ' + fmtDate(localIso(s.b))") === -1 &&
  /id="b-start-words"/.test(CONSOLE) && /id="b-end-words"/.test(CONSOLE) && CONSOLE.indexOf("fmtDate(localIso(s.a), { time: true, day: true })") !== -1);
check('UX-010 the console\'s date line and feed times are in the page\'s font, not monospace',
  /\.ev-title \.meta\{[^}]*\}/.test(CSS) && !/font-mono/.test(/\.ev-title \.meta\{([^}]*)\}/.exec(CSS)[1]) && /\.feed-when\{ font-size:11px; color: var\(--text-faint\); \}/.test(CSS));
check('UX-010 the events list: its dates and times, the activity times and a range\'s dash are RevampCore\'s',
  LISTING.indexOf("function fmtDate(iso){ return window.RevampCore.fmtDate(iso, { ist: true }); }") !== -1 &&
  LISTING.indexOf("function fmtTime(iso){ return window.RevampCore.fmtTime(iso, { ist: true }); }") !== -1 &&
  LISTING.indexOf("function whenIst(iso){ return window.RevampCore.fmtDate(iso, { time: true, ist: true }); }") !== -1 &&
  LISTING.indexOf("return a.d + '–' + full(b);") !== -1 && LISTING.indexOf("toLocaleDateString('en-IN'") === -1);
check('UX-010 the activity log loads edit-event-core.js and writes its times with it',
  ALOG.indexOf('<script src="edit-event-core.js"></script>') !== -1 && ALOG.indexOf('<script src="edit-event-core.js"></script>') < ALOG.indexOf('<script src="auth.js"></script>') &&
  ALOG.indexOf("function when(iso){ return window.RevampCore.fmtDate(iso, { time: true, ist: true }); }") !== -1 && ALOG.indexOf('Intl.DateTimeFormat') === -1 &&
  ALOG.indexOf('<td class="when mono">') === -1 && ALOG.indexOf("'<td class=\"when\">' + esc(when(it.at))") !== -1);
check('UX-010 the console Dashboard\'s "Updated" time and the Basics preview\'s date: the one style, the page\'s font',
  read('edit-event-dashboard.js').indexOf("ctx.fmtTime ? ctx.fmtTime(new Date(mine.at))") !== -1 && !/\.mock-meta\{[^}]*font-mono/.test(CSS));
check('UX-010 Registrations, the review page and the site editor\'s save dialog: the same',
  REG.indexOf("function ist(iso){ return C.fmtDate(iso, { time: true, ist: true }); }") !== -1 && REG.indexOf('IST_FMT') === -1 &&
  REVIEW.indexOf("function when(iso){ return C.fmtDate(iso, { time: true }); }") !== -1 && REVIEW.indexOf('toLocaleString') === -1 &&
  /function when\(iso\) \{ return window\.RevampCore && RevampCore\.fmtDate && iso \? RevampCore\.fmtDate\(iso, \{ time: true \}\)/.test(EDUI));

/* ======================= UX-006 one message ======================= */
(function () {
  var t = core();
  var close = t.C.toast('Basics saved');
  var host = t.host();
  check('UX-006 one place for messages, made on the page: bottom centre, a live region, in front of everything', !!host && host.className.indexOf('rv-toasts') !== -1 &&
    host.getAttribute('aria-live') === 'polite' && /\.rv-toasts\{position:fixed;left:50%;bottom:max\(var\(--rv-toast-bottom,24px\),var\(--rv-toast-clear,0px\)\);transform:translateX\(-50%\)/.test(CORE));
  var el = t.toasts()[0];
  check('UX-006 a confirmation: a tick, role status, the words', !!el && el.getAttribute('role') === 'status' && el.className.indexOf('rv-toast-success') !== -1 &&
    !!el.querySelector('svg') && el.textContent === 'Basics saved' && el.classList.contains('on'));
  check('UX-006 … it goes by itself (at least 3 s, longer for more words) and returns its close', typeof close === 'function' && typeof close.dismiss === 'function' &&
    t.timers.some(function (x) { return x.ms === 3000; }));
  t.run(); t.run();
  check('UX-006 … and is gone after its time', t.toasts().length === 0 && t.host().querySelectorAll('.rv-toast').length === 0);

  t.C.toast('Could not save — Something went wrong on our side. Please try again.', { kind: 'error' });
  var err = t.toasts()[0];
  check('UX-006 a failure: one red, a warning mark, read out at once (role alert), and a Dismiss button', !!err && err.getAttribute('role') === 'alert' &&
    err.className.indexOf('rv-toast-error') !== -1 && /\.rv-toast-error\{background:#B3151B;color:#FFFFFF\}/.test(CORE) &&
    !!err.querySelector('.rv-toast-x') && err.querySelector('.rv-toast-x').getAttribute('aria-label') === 'Dismiss this message');
  check('UX-006 … it stays until dismissed (no timer to close it)', t.timers.filter(function (x) { return x.fn && x.ms >= 3000; }).length === 0);
  t.C.toast('Could not save — Something went wrong on our side. Please try again.', { kind: 'error' });
  check('UX-006 … the same failure twice is one message', t.toasts().length === 1);
  t.click(err.querySelector('.rv-toast-x')); t.run();
  check('UX-006 … Dismiss takes it away', t.toasts().length === 0);

  var retried = 0;
  t.C.toast('Basics were not saved.', { kind: 'error', retry: function () { retried++; } });
  var r = t.toasts()[0];
  t.click(r.querySelector('.rv-toast-act'));
  check('UX-006 retry: a "Try again" button that runs it and closes the message', r.querySelector('.rv-toast-act').textContent === 'Try again' && retried === 1 && t.toasts().length === 0);

  var undone = 0;
  t.C.toast('“Gone One” moved to Deleted Events.', { action: { label: 'Undo', onClick: function () { undone++; } } });
  var a = t.toasts()[0];
  check('UX-006 an action: its button, a Dismiss, and eight seconds at least', a.querySelector('.rv-toast-act').textContent === 'Undo' && !!a.querySelector('.rv-toast-x') &&
    t.timers.some(function (x) { return x.fn && x.ms === 8000; }));
  t.click(a.querySelector('.rv-toast-act'));
  check('UX-006 … the button runs it once and closes the message', undone === 1 && t.toasts().length === 0);

  t.C.toast('Saving your picture…', { kind: 'info', sticky: true });
  check('UX-006 info: no mark; sticky: it stays', !t.toasts()[0].querySelector('.rv-toast-ico') && t.toasts()[0].hasAttribute('data-sticky'));
  t.toasts()[0]._rvClose(); t.run();
  t.C.toast('<img src=x onerror=alert(1)>');
  check('UX-006 the words are text, never markup', t.host().querySelectorAll('img').length === 0 && t.toasts()[0].textContent === '<img src=x onerror=alert(1)>');
  for (var i = 0; i < 6; i++) t.C.toast('Saved ' + i);
  check('UX-006 a run of quick messages keeps at most four', t.toasts().length === 4 && t.toasts()[0].textContent === 'Saved 2', t.toasts().map(function (x) { return x.textContent; }));
  check('UX-006 the string form: toast(msg, "error")', (function () { var u = core(); u.C.toast('Nope', 'error'); return u.toasts()[0].getAttribute('role') === 'alert'; })());
})();
(function () {
  var t = core({ region: true });
  t.C.toast('Link copied');
  var region = t.doc.getElementById('toast-region');
  check('UX-006 the events list\'s #toast-region becomes the one place (its own role goes, the live region is the core\'s)',
    !t.doc.getElementById('rv-toasts') && region.classList.contains('rv-toasts') && region.getAttribute('role') === null && region.getAttribute('aria-live') === 'polite' &&
    region.querySelectorAll('.rv-toast').length === 1);
})();
(function () {
  var K = core().C.toastKind;
  check('UX-006 kind "auto" reads the words: failures, things done, the rest',
    K('Download failed') === 'error' && K('Could not build this mailer') === 'error' && K('Clipboard blocked by the browser') === 'error' &&
    K('The link was not added: the mail was redrawn meanwhile.') === 'error' && K('That post isn\'t available for this event yet: it needs speakers.') === 'error' &&
    K('Saved “Launch mailer”') === 'success' && K('Version deleted') === 'success' && K('Downloaded mailer.html — opens and clicks will show on your dashboard once it\'s sent.') === 'success' &&
    K('Select the words to link first') === 'info' && K('Drawing all sizes… 2 of 5 ready.') === 'info');
})();

/* each page's own toast is now RevampCore's */
var EDITOR = read('custom_editor.html'), WIZ = read('create-event.html'), PROMO = read('marketing.html');
check('UX-006 the console: notify and notifyError are RevampCore.toast (a failure in red, with Try again)',
  /function notify\(msg, ms\)\{\s*C\.toast\(msg, typeof ms === 'number' && ms > 0 \? \{ duration: ms \} : null\);/.test(CONSOLE) &&
  /C\.toast\(\(opts\.what \? opts\.what \+ ' ' : ''\) \+ errText\(errOrMsg\), \{ kind: 'error', retry: opts\.retry \}\);/.test(CONSOLE) &&
  CONSOLE.indexOf('id="toast-host"') === -1 && CONSOLE.indexOf('function dismissToast') === -1);
check('UX-006 on a screen up to 880px wide the messages start above ETB2B AI\'s launcher in the bottom-left corner, which a failure (kept until dismissed) covered',
  CORE.indexOf("bottom:max(var(--rv-toast-bottom,24px),var(--rv-toast-clear,0px))") !== -1 &&
  CORE.indexOf("'@media (max-width:880px){body:has(.rvc-launcher){--rv-toast-clear:calc(80px + env(safe-area-inset-bottom,0px))}}'") !== -1 &&
  /@media \(max-width:600px\)\{\n  \.rvc-launcher\{ left:16px; bottom:calc\(16px \+ env\(safe-area-inset-bottom, 0px\)\); width:52px; height:52px;/.test(read('etb2b-chat.css')));
check('UX-006 the console lifts the messages clear of its Save bar', /body:has\(\.savebar\.on\)\{ --rv-toast-bottom:124px; \}/.test(CSS));
check('UX-006 the site editor: showToast is RevampCore.toast and still returns { dismiss }',
  /var close = window\.RevampCore\.toast\(msg, \{ kind: kind, action: opts\.action, sticky: opts\.sticky, duration: opts\.duration \}\);\s*return \{ dismiss: close \};/.test(EDITOR) &&
  EDITOR.indexOf('id="toast-region"') === -1 && EDITOR.indexOf('#toast-region{') === -1 && EDITOR.indexOf('#3A1B18') === -1);
check('UX-006 Create Event: toast is RevampCore.toast, lifted above its footer by --rv-toast-bottom',
  /return RevampCore\.toast\(msg, \{ kind: opts\.type \|\| 'info', action: opts\.action, sticky: opts\.sticky, duration: opts\.duration \}\);/.test(WIZ) &&
  /st\.setProperty\('--rv-toast-bottom'/.test(WIZ) && WIZ.indexOf('id="toast-region"') === -1 && WIZ.indexOf('.toast-error{') === -1);
check('UX-006 the events list: toast and toastAction are RevampCore.toast, and its refusals and failures are errors',
  LISTING.indexOf("window.RevampCore.toast(msg, { kind: kind || 'success' });") !== -1 && LISTING.indexOf("window.RevampCore.toast(msg, { action: { label: label, onClick: run } });") !== -1 &&
  !/toast\('[^']*(could not|did not load|must be|Pick both)[^']*'\);/.test(LISTING) && count(LISTING, "could not start. Reload the page and try again.', 'error')") === 4 &&
  /if \(!mayRemove\(\)\)\{ toast\(whoMayRemove\(\), 'error'\); break; \}/.test(LISTING) && LISTING.indexOf('.toast-btn{') === -1);
check('UX-006 Registrations and Promotions no longer keep a host of their own', REG.indexOf('id="toast-host"') === -1 && PROMO.indexOf('id="toast-host"') === -1);
var OW = read('promo-studio/oneworld.js'), OWS = read('promo-studio/oneworld-social.js');
check('UX-006 the mailer and social studios in Promotions hand every message to the page around them (RevampCore.toast), with its kind',
  OW.indexOf("toast = function (m, ms, kind) {\n  if (owFramed() && owTall()) { owPost({ rvToast: { m: String(m), ms: ms, k: kind } }); return; }") !== -1 &&
  OWS.indexOf("function toast(m, ms, kind) {\n  if (owTall() && owFramed()) { owTell({ rvToast: { m: String(m == null ? '' : m), ms: ms, k: kind } }); return; }") !== -1);
(function () {
  /* the page's relay, run: the studio's kind is used as it is; only a message without one is read from its words */
  var src = (/\n  function relayToast\(t\)\{[\s\S]*?\n  \}\n/.exec(PROMO) || [''])[0];
  var said = [], sb = { toast: function (m, o) { said.push([m, o.kind, o.duration]); } };
  vm.runInNewContext(src + '; this.relayToast = relayToast;', sb);
  sb.relayToast({ m: 'Uploading pictures did not load. Reload the page and try again.', ms: 9000, k: 'error' });
  sb.relayToast({ m: 'The QR code was left out: the site is not published.', ms: 9000, k: 'info' });
  sb.relayToast({ m: '✓ Downloaded ZIP', k: 'success' });
  sb.relayToast({ m: 'Download failed' });
  sb.relayToast({ m: 'Section moved', k: 'shout' });
  check('UX-006 Promotions draws a studio message as the kind it was sent with, and reads the words only when none came',
    !!src && JSON.stringify(said) === JSON.stringify([['Uploading pictures did not load. Reload the page and try again.', 'error', 9000],
      ['The QR code was left out: the site is not published.', 'info', 9000], ['Downloaded ZIP', 'success', undefined], ['Download failed', 'auto', undefined], ['Section moved', 'auto', undefined]]), said);
})();
(function () {
  /* the frames' toast, run: in Promotions the kind goes up with the message */
  var src = (/\nfunction toast\(m, ms, kind\) \{[\s\S]*?\n\}\n/.exec(OWS) || [''])[0];
  var told = [], sb = { owTall: function () { return true; }, owFramed: function () { return true; }, owTell: function (d) { told.push(d.rvToast); }, $: function () { return null; } };
  vm.runInNewContext(src + '; this.toast = toast;', sb);
  sb.toast('The picture was uploaded, but the element it was for is no longer on the canvas.', 9000, 'error');
  check('UX-006 … the posts\' frame sends it', !!src && JSON.stringify(told) === JSON.stringify([{ m: 'The picture was uploaded, but the element it was for is no longer on the canvas.', ms: 9000, k: 'error' }]), told);
})();
/* Oneworld's own messages in the studios all say what kind they are, so none is left to a guess from its words (which
   took "The picture was uploaded, but …" for a success and "… did not load" for a passing note) */
(function () {
  var CAP = read('promo-studio/oneworld-social-caption.js');
  function untold(src, fn) {
    return src.split('\n').filter(function (line) {
      var l = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\/\/.*$/, '');
      if (l.indexOf(fn + '(') === -1 || /function (toast|say|owDeepToast)\(/.test(l) || /owToast/.test(l)) return false;
      if (fn === 'toast' && /owDeepToast\(/.test(l) && !/[^p]toast\(/.test(l.replace(/owDeepToast\(/g, ''))) return false;
      return !/, (?:'(?:success|error|info)'|L\.unsure \? 'error' : 'info')\);/.test(l);
    });
  }
  var left = untold(OW, 'toast').concat(untold(OWS, 'toast'), untold(CAP, 'say'));
  check('UX-006 every Oneworld message in the studios gives its kind', left.length === 0, left);
  check('UX-006 … the three that were misread: "did not load" and "… no longer on the canvas" are failures, the QR note is a note',
    OWS.indexOf("toast('Uploading pictures did not load. Reload the page and try again.', OW_LONG, 'error');") !== -1 &&
    OWS.indexOf("toast('The picture was uploaded, but the element it was for is no longer on the canvas.', OW_LONG, 'error');") !== -1 &&
    OWS.indexOf("if (q.dropped) toast(OW_MSG.qr, OW_LONG, 'info');") !== -1 && OWS.indexOf("toast(said, OW_LONG, L.unsure ? 'error' : 'info');") !== -1);
  var MS = read('promo-studio/mailer-studio.js');
  check('UX-006 … and the platform\'s, where its words are the server\'s own sentence, say "error"',
    count(MS, 'catch(err){ toast(String(err.message||err),undefined,"error"); }') === 2 && MS.indexOf('toast(msg,5000,"error"); return null; }') !== -1 &&
    MS.indexOf('.error||"Save failed",undefined,"error"); return false; }') !== -1 && MS.indexOf('toast(j.error||"Could not change the layout",undefined,"error");') !== -1 &&
    MS.indexOf('toast(j.error||"Could not read that file",undefined,"error");') !== -1 && count(MS, 'toast("This draft has not been saved yet",undefined,"info");') === 2);
  var K = core().C.toastKind;
  check('UX-006 … and the words read better for the platform\'s messages that come with none',
    K('Uploading pictures did not load.') === 'error' && K('The banner didn’t load') === 'error' && K('Cut 2 element(s)') === 'success' && K('Pasted 2 element(s)') === 'success' &&
    K('Reset to the original template') === 'success' && K('Reset failed') === 'error' && K('Open an event first') === 'info');
})();

/* ======================= UX-008 one "could not load" state ======================= */
(function () {
  var C = core().C;
  var gone = C.loadErrorText({ status: 404, message: 'No event found for "qa-ux-cross-cutting-missing".' });
  check('UX-008 a missing event: a plain headline and reason, no Try again, no server words or id',
    gone.title === 'Event not found' && gone.text === 'This event doesn’t exist or was deleted. Use Back to events to open another one.' && gone.retry === false && gone.missing === true);
  var none = C.loadErrorText(null, { kind: 'none', none: 'the event you want to edit' });
  check('UX-008 no event in the address', none.title === 'No event selected' && none.text === 'Use Back to events and open the event you want to edit.' && none.retry === false);
  check('UX-008 no answer: the connection; a server fault: our words; both can be tried again',
    C.loadErrorText({ status: 0 }).text === 'The event could not be loaded. Check your connection and try again.' && C.loadErrorText({ status: 0 }).retry === true &&
    C.loadErrorText({ status: 503, message: 'Internal error: Firestore DEADLINE_EXCEEDED' }).text === 'Something went wrong on our side. Please try again in a moment.');
  check('UX-008 no access is not "try again"', C.loadErrorText({ status: 403 }).retry === false && C.loadErrorText({ status: 403 }).title === 'You can’t open this event');
})();
(function () {
  var t = core(), d = t.doc;
  ['view', 'ev-name', 'btn-preview', 'rail'].forEach(function (id) { var e = d.createElement('div'); e.setAttribute('id', id); d.body.appendChild(e); });
  d.getElementById('ev-name').textContent = 'Loading…';
  var tries = 0;
  t.C.renderLoadError('view', { status: 404, message: 'No event found for "x".' }, { title: 'ev-name', hide: ['btn-preview', d.getElementById('rail')], onRetry: function () { tries++; } });
  var v = d.getElementById('view');
  check('UX-008 painted: role alert, the headline in the heading too, Preview and the rail put away', !!v.querySelector('.rv-load-error') && v.querySelector('.rv-load-error').getAttribute('role') === 'alert' &&
    v.querySelector('h2').textContent === 'Event not found' && d.getElementById('ev-name').textContent === 'Event not found' &&
    d.getElementById('btn-preview').hidden === true && d.getElementById('rail').hidden === true);
  check('UX-008 … one way back: Back to events, and no Try again for an event that is gone', !v.querySelector('[data-rv-retry]') &&
    v.querySelectorAll('a').length === 1 && v.querySelector('a').getAttribute('href') === '/Event_Listing.html' && v.querySelector('a').textContent === 'Back to events' &&
    v.textContent.indexOf('No event found') === -1);
  t.C.renderLoadError('view', { status: 0 }, { onRetry: function () { tries++; } });
  t.click(v.querySelector('[data-rv-retry]'));
  check('UX-008 a failed connection: Try again first (it runs the page\'s load), then Back to events', tries === 1 && v.querySelector('[data-rv-retry]').textContent === 'Try again' &&
    v.querySelector('a').textContent === 'Back to events');
  check('UX-008 its look is drawn by the core on any page', !!d.getElementById('rv-core-css') && d.getElementById('rv-core-css').textContent.indexOf('.rv-load-error{') !== -1);
})();
(function () {
  var C = core().C;
  check('UX-008 errText: a server fault and a lost connection in our words, a refusal as the server says it',
    C.errText({ status: 500, message: 'Internal error: Firestore DEADLINE_EXCEEDED' }) === 'Something went wrong on our side. Please try again.' &&
    C.errText({ status: 0, message: 'Failed to fetch' }) === 'We couldn’t reach the server. Check your connection and try again.' &&
    C.errText({ status: 400, message: 'The capacity must be a number.' }) === 'The capacity must be a number.' && C.errText('As it is') === 'As it is');
  check('UX-013 errText: a refused session keeps what was typed and says to sign in and try again',
    C.errText({ status: 401, code: 'revamp/signed-out', message: 'You are signed out. Sign in again to continue.' }) === 'You were signed out. Sign in again, then try once more: what you typed is still here.');
})();
/* the pages that use it */
check('UX-008 the console and Promotions paint RevampCore\'s state, with their chrome put away',
  /C\.renderLoadError\(\$\('view'\), err, \{ kind: kind, none: 'the event you want to edit', title: 'ev-name', onRetry: init \}\);/.test(CONSOLE) &&
  /C\.renderLoadError\(\$\('view'\), err, \{ kind: kind, none: 'the event whose promotions you want to make', title: 'ev-name', hide: \['btn-preview'\], onRetry: init \}\);/.test(PROMO) &&
  /\$\('rail'\)\.hidden = true;\s*C\.renderLoadError/.test(PROMO) && /\$\('rail'\)\.hidden = false;\s*renderEventRail\('rail', \{ activeSection: 'marketing'/.test(PROMO));
check('UX-008 Registrations: the same state (no "Try again" for a deleted event), its rail and Preview put away, put back on a retry',
  REG.indexOf("C.renderLoadError(page, eventId ? S.loadErr : null, { kind: eventId ? undefined : 'none'") !== -1 && REG.indexOf("hide: ['rail', 'btn-preview'], onRetry: start") !== -1 &&
  REG.indexOf("S.error = C.errText(S.loadErr);") !== -1 && /\$\('rail'\)\.hidden = false;\s*if \(eventId\) \$\('btn-preview'\)\.hidden = false;/.test(REG) &&
  REG.indexOf('Choose an event in the picker above') === -1 && REG.indexOf('Couldn’t load the registrations') === -1);
var reviewLoad = fnSrc(REVIEW, 'load');
check('UX-008 the review page: the same state, never the server\'s sentence',
  reviewLoad.indexOf("C.renderLoadError(main, err, { onRetry: load });") !== -1 && REVIEW.indexOf("C.renderLoadError(main, null, { kind: 'none'") !== -1 &&
  reviewLoad.indexOf('err.message') === -1 && REVIEW.indexOf('The request could not be loaded.') === -1, reviewLoad);
check('UX-008 the site editor: the same words for a missing event, and no Preview, Publish or rail then',
  /var said = window\.RevampCore && RevampCore\.loadErrorText \? RevampCore\.loadErrorText\(\{ status: status \}\) : null;/.test(EDUI) && /noEvent: true/.test(EDUI) &&
  /document\.body\.classList\.toggle\('ed-no-event', !!spec\.noEvent\);/.test(EDUI) &&
  EDITOR.indexOf('body.ed-no-event #btn-preview, body.ed-no-event #btn-publish, body.ed-no-event .ed-workspace > .rail{ display:none; }') !== -1 &&
  EDUI.indexOf('We could not find this event') === -1);
(function () {
  var src = fnSrc(EDUI, 'whyNot');
  var said = [];
  var sb = { window: { RevampCore: core().C, console: { error: function () { said.push('logged'); } } } };
  sb.RevampCore = sb.window.RevampCore; sb.console = sb.window.console;
  vm.runInNewContext(src + '; this.whyNot = whyNot;', sb);
  check('UX-008 the editor\'s save, publish and approval failures: our words for a server fault (logged), the page\'s own as they are',
    !!src && sb.whyNot({ status: 500, message: 'Internal error: Firestore DEADLINE_EXCEEDED' }) === 'Something went wrong on our side. Please try again.' && said.length === 1 &&
    sb.whyNot({ status: 0 }) === 'We couldn’t reach the server. Check your connection and try again.' && sb.whyNot(new Error('The page has a block that cannot be saved.')) === 'The page has a block that cannot be saved.' &&
    sb.whyNot({ code: 'revamp/signed-out', status: 401 }).indexOf('You were signed out.') === 0 && sb.whyNot(null) === 'please try again.');
  check('UX-008 … and Save uses it', EDUI.indexOf("showToast('Could not save — ' + whyNot(err), { kind: 'error' });") !== -1 &&
    EDUI.indexOf("showToast('Could not publish — ' + whyNot(err), { kind: 'error' });") !== -1 && EDUI.indexOf("'Could not save — ' + (err && err.message") === -1);
})();
var MP = read('mailer-performance.html');
check('UX-008 Mailer performance with ?event=: that event\'s Mailers in Promotions (which says Event not found), not every event\'s quietly',
  MP.indexOf('if(id)location.replace("marketing.html?event="+encodeURIComponent(id)+"&tab=mailers");') !== -1);

/* ======================= UX-007 one top bar ======================= */
var BACK = /<span class="nav-back-long">Back to events<\/span><span class="nav-back-short">Events<\/span>/;
check('UX-007 Registrations: an account menu to sign out, and no event switcher',
  /<span class="topbar-acts">\s*<button class="btn btn-secondary" type="button" id="btn-preview"/.test(REG) &&
  REG.indexOf('event-select') === -1 && REG.indexOf('fillPicker') === -1 && REG.indexOf('.event-picker') === -1);
/* One top bar: on every page with an account (the sign-in page has none, and keeps its switch in the corner), the
   light/dark switch and the account menu sit side by side, one of each, and end the bar: after the page's own
   actions (Preview, Share preview, Save, Publish). Only Create Event's close button comes after them, as the builder's
   way out. The site editor's switch was inside its account menu, and the console, Promotions and Registrations put
   the pair before Preview: the editor, the events list and the logs put it last. */
var PAIR = '<span data-theme-toggle-target style="display:inline-flex;align-items:center;"></span>\\s*(?:<!--[^>]*-->\\s*)?<span data-rv-account></span>';
var HEADERS = { 'edit-event.html': CONSOLE, 'custom_editor.html': EDITOR, 'marketing.html': PROMO, 'audience-registrations.html': REG,
  'activity-log.html': ALOG, 'mailer-performance.html': MP, 'review.html': REVIEW, 'Event_Listing.html': LISTING, 'create-event.html': WIZ, 'portal-review.html': read('portal-review.html') };
var badEnd = Object.keys(HEADERS).filter(function (f) {
  var page = HEADERS[f];
  var after = f === 'create-event.html' ? '\\s*<button class="icon-btn" id="btn-close"' : '\\s*(?:</span>|</div>)?\\s*(?:</div>\\s*)?</header>';
  return count(page, 'data-theme-toggle-target') !== 1 || count(page, '<span data-rv-account') !== 1 || !new RegExp(PAIR + after).test(page);
});
check('UX-007 every page with an account: the light/dark switch and the account menu side by side, one of each, at the end of the top bar', badEnd.length === 0, badEnd);
check('UX-007 … so the site editor\'s switch is in its top bar like every other page\'s, not inside its account menu',
  EDITOR.indexOf('data-rv-account-theme></span>') === -1);
check('UX-007 … and the console, Promotions and Registrations have Preview, Share preview and Publish before the pair, as the editor has',
  new RegExp('id="btn-publish">Publish</button>\\s*(?:<!--[^>]*-->\\s*)?' + PAIR + '\\s*</span>\\s*</header>').test(CONSOLE) &&
  new RegExp('<span>Preview</span>\\s*</button>\\s*(?:<!--[^>]*-->\\s*)?' + PAIR + '\\s*</span>\\s*</header>').test(PROMO) &&
  new RegExp('<span>Preview</span>\\s*</button>\\s*(?:<!--[^>]*-->\\s*)?' + PAIR + '\\s*</span>\\s*</header>').test(REG));
var backs = Object.keys(HEADERS).filter(function (f) { return f !== 'create-event.html' && HEADERS[f].indexOf('Back to events') === -1; });
check('UX-007 … and every one of them but Create Event (Save & exit and Close, the builder\'s own ways out) says "Back to events"', backs.length === 0, backs);
check('UX-007 the activity log: "Back to events" (Events on a phone) in the console\'s button look',
  BACK.test(ALOG) && /\.nav-back\{[^}]*border:1px solid var\(--border\); background:var\(--surface-2\); font-size:13px; font-weight:700; color:var\(--text\);/.test(ALOG) &&
  ALOG.indexOf('\n      Events\n    </a>') === -1);
check('UX-007 Mailer performance: the same button look', /\.nav-back\{[^}]*border:1px solid var\(--border\); background:var\(--surface-2\); font-size:13px; font-weight:700; color:var\(--text\);/.test(MP));
check('UX-007 the review page: the console\'s font, "Back to events" (then "Back to the event"), and the theme switch beside the account menu',
  REVIEW.indexOf('family=Inter:') !== -1 && REVIEW.indexOf('Manrope') === -1 && /<a class="back-btn" id="back" href="\/Event_Listing\.html"><svg[^>]*>[\s\S]*?<\/svg><span>Back to events<\/span><\/a>/.test(REVIEW) &&
  REVIEW.indexOf('&larr;') === -1 && REVIEW.indexOf('<span>Back to the event</span>') !== -1 &&
  /<span data-theme-toggle-target[^>]*><\/span>\s*<span data-rv-account><\/span>\s*<\/header>/.test(REVIEW));
var SIGNIN = read('index.html');
/* done by B11 (UX-038) on main: the switch's own box in the top-right corner */
check('UX-007 sign-in: the theme switch sits in the page\'s corner, not under the sign-in button', /\.login-theme\{ position: absolute; top: 16px; right: 16px;/.test(SIGNIN) &&
  /<div class="login-theme"><span data-theme-toggle-target/.test(SIGNIN) && SIGNIN.indexOf('login-foot') === -1);

/* ======================= UX-012 the rail and the theme switch ======================= */
check('UX-012 the rail runs the window\'s height below the top bar (it stopped under Settings), and still stays put',
  /\.rail\{[^}]*position: sticky; top: var\(--topbar-h\);[^}]*height: calc\(100vh - var\(--topbar-h\)\); box-sizing:border-box;/.test(CSS));
(function () {
  var dom = makeDom(), d = dom.document, store = {};
  d.querySelectorAll = function (sel) { return d.documentElement.querySelectorAll(sel); };
  d.readyState = 'complete';
  var target = d.createElement('span'); target.setAttribute('data-theme-toggle-target', ''); d.body.appendChild(target);
  var sb = { document: d, localStorage: { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = v; } },
    matchMedia: function () { return { matches: false }; } };
  sb.window = sb;
  vm.runInNewContext(read('theme-toggle.js'), sb, { filename: 'theme-toggle.js' });
  var btn = target.querySelector('[data-theme-toggle]');
  check('UX-012 the theme switch is a plain icon button: a moon to go dark, named for what it does, not pressed/unpressed',
    !!btn && btn.className === 'theme-toggle-btn' && btn.getAttribute('aria-label') === 'Switch to dark mode' && btn.getAttribute('aria-pressed') === null &&
    !!btn.querySelector('.tgl-moon') && !!btn.querySelector('.tgl-sun') && !btn.querySelector('.tgl-track'));
  dom.fire(btn, 'click');
  check('UX-012 … pressing it turns the page dark and names the way back', d.documentElement.getAttribute('data-theme') === 'dark' && store['revamp-theme'] === 'dark' &&
    btn.getAttribute('aria-label') === 'Switch to light mode' && btn.title === 'Switch to light mode');
  var css = d.getElementById('revamp-theme-toggle-css').textContent;
  check('UX-012 … 32 px, no red track; the sun shows in the dark theme', /width:32px;height:32px/.test(css) && css.indexOf('tgl-track') === -1 &&
    css.indexOf('[data-theme="dark"] .theme-toggle-btn .tgl-sun{display:block;}') !== -1);
})();

/* ======================= UX-009 phones ======================= */
var phone = (/@media \(max-width: 640px\)\{([\s\S]*?)\n  \}/.exec(CSS) || [])[1] || '';
check('UX-009 at phone width the rail folds into a row under the top bar that scrolls sideways (console, Promotions, Registrations)',
  /\.shell > \.rail, \.reg-page > \.rail\{[^}]*height:auto; max-height:none; flex-direction:row;[^}]*overflow-x:auto;/.test(phone));
check('UX-009 … the console tabs stay one row and scroll; the name may take two lines and the date line gives way',
  /\.subtabs\{ flex-wrap:nowrap; overflow-x:auto;/.test(phone) && /\.ev-title:not\(\.with-state\) h1\{ white-space:normal;[^}]*-webkit-line-clamp:2;/.test(phone) && /\.ev-title:not\(\.with-state\) \.meta\{ display:none; \}/.test(phone) &&
  /\.shell, \.reg-page\{ flex-direction:column; align-items:stretch; \}/.test(phone));
check('UX-009 the Dashboard tiles: no inline four-column rule (already fixed: they stack by the stylesheet)', read('edit-event-dashboard.js').indexOf('repeat(4,1fr)') === -1 &&
  /@media \(max-width:520px\)\{ \.stat-grid\.dash-tiles\{ grid-template-columns: 1fr; \} \}/.test(CSS));
var OWCSS = read('promo-studio/oneworld.css'), OWSCSS = read('promo-studio/oneworld-social.css');
check('UX-009 the mail editor and the layout editor say they need a larger screen below 700 px, keeping Back',
  /@media \(max-width:699px\)\{\s*#mailer\.on \.ed-top \.ed-pick, #mailer\.on \.ed-top \.acts, #mailer\.on \.ed-top \.sp, #mailer\.on \.ml-body, #mailer\.on \.ml-pop\{display:none\}\s*#mailer\.on::after\{content:"The mail editor needs a larger screen\./.test(OWCSS) &&
  /@media \(max-width:699px\)\{\s*#editor\.on \.ed-top \.ed-pick, #editor\.on \.ed-top \.acts, #editor\.on \.ed-top \.sp, #editor\.on \.ed-body\{display:none\}\s*#editor\.on::after\{content:"The layout editor needs a larger screen\./.test(OWSCSS));
check('UX-009 the hashtag chip wraps inside its card', OWCSS.indexOf('.hchip{max-width:100%;overflow-wrap:anywhere}') !== -1);

/* ======================= UX-011 one save pattern; what is saved ======================= */
check('UX-011 Settings › Registration saves with the console\'s save bar (Discard · Save changes), as Basics does',
  /'<div class="savebar" id="rg-savebar">' \+\s*'<span class="sb-txt"><b id="rg-state" role="status"><\/b><span id="rg-what"><\/span><\/span>' \+\s*'<button class="sb-ghost" type="button" id="rg-discard" disabled>Discard<\/button>' \+\s*'<button class="btn btn-primary btn-sm" type="button" id="rg-save" disabled>Save changes<\/button>'/.test(CONSOLE) &&
  CONSOLE.indexOf("q('rg-savebar').classList.toggle('on', d || saving);") !== -1);
(function () {
  var src = (/\n    function paintDirty\(\)\{[\s\S]*?\n    \}\n/.exec(CONSOLE) || [''])[0];
  function el() { return { textContent: '', attrs: {}, classList: { on: {}, toggle: function (c, v) { this.on[c] = !!v; } }, setAttribute: function (k, v) { this.attrs[k] = v; } }; }
  var els = { 'b-savebar': el(), 'b-sbtxt': el(), 'b-sbhead': el(), 'b-sbwhat': el(), 'b-save': el(), 'b-discard': el() };
  var sb = { n: 2, failed: '', saving: false, $: function (id) { return els[id]; } };
  vm.runInNewContext('function changedKeys(){ return new Array(n); }\n' + src + '; this.paintDirty = paintDirty;', sb);
  sb.paintDirty();
  var before = [els['b-sbhead'].textContent, els['b-sbwhat'].textContent];
  sb.n = 0; sb.paintDirty();
  check('UX-011 after a save Basics\' bar slides away with its words: never "Unsaved changes, 0 fields edited"', !!src &&
    before.join('|') === 'Unsaved changes|2 fields edited' && els['b-sbwhat'].textContent === '2 fields edited' && els['b-savebar'].classList.on.on === false);
})();
(function () {
  var src = fnSrc(CONSOLE, 'paintSaveState');
  var chip = { hidden: true, attrs: {}, className: '', textContent: '', title: '', getAttribute: function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }, setAttribute: function (k, v) { this.attrs[k] = String(v); } };
  var sb = { EV: { id: 'qa' }, busy: false, dirty: false, MODAL: null, $: function (id) { return id === 'ev-save' ? chip : { hidden: false }; } };
  vm.runInNewContext('var LEAVE = { dirty: function(){ return dirty; } }; function writesOut(){ return busy; }\n' + src + '; this.paintSaveState = paintSaveState;', sb);
  sb.paintSaveState();
  var a = chip.textContent + '|' + chip.className;
  sb.dirty = true; sb.paintSaveState();
  var b = chip.textContent + '|' + chip.className;
  sb.busy = true; sb.paintSaveState();
  var c = chip.textContent + '|' + chip.className;
  check('UX-011 the console\'s top bar says what is saved: All changes saved / Unsaved changes / Saving…', !!src && chip.hidden === false &&
    a === 'All changes saved|save-state ok' && b === 'Unsaved changes|save-state warn' && c === 'Saving…|save-state wait', [a, b, c]);
  check('UX-011 … in the top bar, put away with Preview and Publish when there is no event, and following typing',
    /<span class="save-state" id="ev-save" role="status" hidden><\/span>/.test(CONSOLE) && CONSOLE.indexOf("if (!ready) $('ev-save').hidden = true;") !== -1 &&
    CONSOLE.indexOf("['input', 'change'].forEach(function(t){ document.addEventListener(t, function(){ setTimeout(paintSaveState, 0); }, true); });") !== -1);
})();

/* ======================= UX-013 a refused session keeps the page ======================= */
var AUTH = read('auth.js');
var second = (/\.then\(function \(again\) \{([\s\S]*?)\n        \}\);/.exec(AUTH) || [])[1] || '';
check('UX-013 a second 401 keeps the page under the "signed out" box instead of leaving for sign-in, and says revamp/signed-out',
  !!second && second.indexOf('showSignedOutOverlay();') !== -1 && second.indexOf('redirectToSignIn') === -1 && second.indexOf('throw signedOutError();') !== -1);
check('UX-013 … signing in again in the box (the same person) closes it, so Save can be pressed again',
  AUTH.indexOf('signInWithGoogle().then(function () { hideSignedOutOverlay(); }, function (err) {') !== -1);
check('UX-013 … the console and the editor say so in words (RevampCore.errText)', /function errText\(err\)\{ return C\.errText\(err\); \}/.test(CONSOLE) && /RevampCore\.errText\(err\)/.test(EDUI));

if (failed) { console.error('shared-parts: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('shared-parts: all ' + passed + ' checks passed');
