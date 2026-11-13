/* node functions/lib/launch-polish-console-signin.test.js — launch-check polish items on the event console
   (edit-event.html / edit-event.css) and the sign-in page (index.html), 13 Nov 2026:
     CON-013  a failed logo or share-picture upload is the red message that stays (notifyError, errText's words),
              never a green tick over the server's own text;
     CON-070  FAQ rows are dragged by their grip (the grip did nothing); a contact desk is removed from its dialog
              only, as FAQ and Sponsors are (the row's own bin is gone);
     CON-071  the Basics countdown counts calendar days: an event an hour away is today, "1 days" is gone;
     CON-075  a link drawn as a button (.btn) is not underlined;
     LST-048  /?signout=1 (and ?denied, ?reauth) is taken out of the address once the sign-out is done, ?next= kept.
   The countdown and the sign-in script are run in node's vm (a fixed clock; a stand-in RevampAuth and DOM); the rest
   is read from the files. No network, no browser. Exits 1 on any failure. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var CON = read('edit-event.html'), CSS = read('edit-event.css'), SIGNIN = read('index.html');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function fnSource(src, head) {
  var at = src.indexOf(head);
  if (at === -1) throw new Error('not found: ' + head);
  var i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(at, i + 1);
}

/* ======== CON-013 failures are errors ======== */
check('CON-013 no console message puts err.message after a success tick', !/notify\([^;]*\+ \(\(err && err\.message\)/.test(CON));
check('CON-013 the logo upload failure is notifyError with "The logo was not uploaded."', CON.indexOf("notifyError(err, { what: 'The logo was not uploaded.' });") !== -1);
check('CON-013 the share picture failures are notifyError', CON.indexOf("notifyError(err, { what: 'The share picture was not saved.' });") !== -1 &&
  CON.indexOf("notifyError(err, { what: 'The share picture setting was not saved.' });") !== -1);
check('CON-013 a refused file type for the share picture is an error message too', /if \(!\/\^image\\\/\(jpeg\|png\)\$\/\.test\(file\.type\)\)\{ notifyError\('Use a JPG or PNG picture/.test(CON));
check('CON-013 the logo tile says why the logo could not be put in the site in errText\'s words', /logoState\('The logo was saved, but it could not be put into the site\. ' \+ errText\(err\) \+ /.test(CON));
check('CON-013 notifyError is the red sticky core message', /function notifyError\(errOrMsg, opts\)\{[\s\S]{0,300}C\.toast\(\(opts\.what \? opts\.what \+ ' ' : ''\) \+ errText\(errOrMsg\), \{ kind: 'error'/.test(CON));

/* ======== CON-070 FAQ grip, Contact bin ======== */
var faqView = fnSource(CON, 'function viewFAQ(){');
check('CON-070 a FAQ row carries its id and a draggable grip', /'<div class="sec-row" data-faq="' \+ esc\(f\.id\) \+ '"/.test(faqView) && /'<span class="grip" draggable="true" title="Drag to reorder"/.test(faqView));
var drag = fnSource(CON, 'function faqDragDrop(){');
check('CON-070 only the grip starts a drag; a drop reorders and saves the order like the arrows', /grip\.addEventListener\('dragstart'/.test(drag) && !/row\.addEventListener\('dragstart'/.test(drag) &&
  /row\.addEventListener\('drop'/.test(drag) && /persistFaqOrder\(\);/.test(drag) && /render\(\);/.test(drag));
check('CON-070 the FAQ tab wires the dragging', /faqDragDrop\(\);\n  \}/.test(fnSource(CON, 'function wireFaq(){')));
check('CON-070 the dragged row and where it lands are drawn', /\.sec-row\.drag\{ opacity:\.4; \}/.test(CSS) && /\.sec-row\.over-top\{/.test(CSS) && /\.sec-row\.over-bot\{/.test(CSS));
var ctView = fnSource(CON, 'function viewContact(){');
check('CON-070 a contact desk row has Edit only; Remove is in its dialog', ctView.indexOf('data-ctdel') === -1 && ctView.indexOf('data-ctedit') !== -1 &&
  CON.indexOf('function ctRemove(') === -1 && CON.indexOf('data-ctdel') === -1 && /'<button class="btn btn-danger" type="button" id="ctdel">Remove<\/button>'/.test(CON));

/* ======== CON-071 the countdown, on a fixed clock ======== */
var whenSrc = fnSource(CON, 'function dayCount(a, b){') + '\n' + fnSource(CON, 'function countdown(a, b){');
function at(nowArgs) {
  var RealDate = Date, now = new (Function.prototype.bind.apply(RealDate, [null].concat(nowArgs)))();
  function FakeDate() {
    if (!arguments.length) return new RealDate(now.getTime());
    return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
  }
  FakeDate.now = function () { return now.getTime(); };
  FakeDate.prototype = RealDate.prototype;
  var ctx = { Date: FakeDate, Math: Math };
  vm.createContext(ctx);
  vm.runInContext(whenSrc, ctx);
  return function (a, b) { var r = ctx.countdown(a, b || null); return r.txt.replace(/<\/?b>/g, '') + (r.cls ? ' [' + r.cls + ']' : ''); };
}
var cd = at([2026, 10, 13, 10, 0]);            // 13 Nov 2026, 10:00 local
function d(day, h, m) { return new Date(2026, 10, day, h || 0, m || 0); }
check('CON-071 an event an hour away is today, not tomorrow', cd(d(13, 11)) === 'Happening today [good]', cd(d(13, 11)));
check('CON-071 one that began this morning is today', cd(d(13, 8)) === 'Happening today [good]', cd(d(13, 8)));
check('CON-071 tomorrow morning, even under 24 hours away, is tomorrow', cd(d(14, 9)) === 'Opens tomorrow' && cd(d(14, 23, 30)) === 'Opens tomorrow', [cd(d(14, 9)), cd(d(14, 23, 30))]);
check('CON-071 a week on: "Opens in 7 days"', cd(d(20, 9)) === 'Opens in 7 days', cd(d(20, 9)));
check('CON-071 yesterday: "Ran yesterday", never "1 days"', cd(d(12, 18)) === 'Ran yesterday', cd(d(12, 18)));
check('CON-071 three days ago: "Ran 3 days ago"', cd(d(10, 9)) === 'Ran 3 days ago', cd(d(10, 9)));
check('CON-071 an event that began before today and ends today or later is on today', cd(d(12, 9), d(13, 18)) === 'Happening today [good]' && cd(d(11, 9), d(15, 18)) === 'Happening today [good]');
check('CON-071 a multi-day event that is over counts from its last day', cd(d(8, 9), d(12, 18)) === 'Ran yesterday' && cd(d(1, 9), d(3, 18)) === 'Ran 10 days ago', [cd(d(8, 9), d(12, 18)), cd(d(1, 9), d(3, 18))]);
var late = at([2026, 10, 13, 23, 30]);         // half past eleven at night
check('CON-071 late at night, an event at 00:30 is tomorrow', late(d(14, 0, 30)) === 'Opens tomorrow', late(d(14, 0, 30)));
check('CON-071 Basics passes the end along', /var c = countdown\(s\.a, s\.b\);/.test(CON));

/* ======== CON-075 link buttons ======== */
var btnRule = /\n  \.btn\{([^}]*)\}/.exec(CSS);
check('CON-075 .btn sets text-decoration:none', !!btnRule && /text-decoration:\s*none;/.test(btnRule[1]), btnRule && btnRule[1]);

/* ======== LST-048 the sign-in page cleans its address after a sign-out ======== */
var SCRIPT = SIGNIN.slice(SIGNIN.indexOf('<script>\n  (function(){') + '<script>'.length, SIGNIN.lastIndexOf('</script>'));
function signin(search, hash, signOut) {
  var replaced = [], els = {};
  function el(id) {
    if (!els[id]) els[id] = { id: id, hidden: false, disabled: false, textContent: id === 'sso-label' ? 'Continue with Google' : '', setAttribute: function () {}, removeAttribute: function () {}, addEventListener: function () {} };
    return els[id];
  }
  var settle;
  var out = new Promise(function (r) { settle = r; });
  var ctx = {
    document: { getElementById: el },
    location: { search: search, hash: hash || '', origin: 'https://eventsphere.example', replace: function () {} },
    history: { replaceState: function (s, t, url) { replaced.push(url); } },
    URLSearchParams: URLSearchParams, URL: URL, setTimeout: function () { return 0; }, clearTimeout: function () {},
    console: { warn: function () {}, error: function () {} },
    RevampAuth: {
      allowedDomain: 'timesinternet.in',
      recentlySentToSignIn: function () { return false; },
      signOutUser: function () { var p = signOut === 'fail' ? Promise.reject(new Error('offline')) : Promise.resolve(); p.then(function () {}, function () {}).then(function () { setImmediate(settle); }); return p; },
      whenResolved: function () { return Promise.resolve(); }, onAuthChange: function () {}, ensureSession: function () { return Promise.resolve(); }, signInWithGoogle: function () { return Promise.resolve(); }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  var before = replaced.slice();
  return out.then(function () { return { before: before, replaced: replaced, error: el('login-error') }; });
}

async function main() {
  var a = await signin('?signout=1', '');
  check('LST-048 ?signout=1: nothing is changed until the sign-out is done', a.before.length === 0);
  check('LST-048 …then the address is plain "/"', JSON.stringify(a.replaced) === JSON.stringify(['/']), a.replaced);
  var b = await signin('?denied=1&next=%2Fedit-event.html%3Fevent%3Dqa-x', '#tab=upcoming');
  check('LST-048 ?denied=1: the message stays, the address keeps only ?next= (and the #fragment)', b.error.hidden === false && /has not been given access to ETB2B EventSphere/.test(b.error.textContent) &&
    JSON.stringify(b.replaced) === JSON.stringify(['/?next=%2Fedit-event.html%3Fevent%3Dqa-x#tab=upcoming']), [b.replaced, b.error.textContent]);
  var c = await signin('?reauth=1&next=https%3A%2F%2Fevil.example%2F', '');
  check('LST-048 a ?next= that is not a page of this site is not kept', JSON.stringify(c.replaced) === JSON.stringify(['/']), c.replaced);
  var e = await signin('?signout=1', '', 'fail');
  check('LST-048 a sign-out that failed keeps the address, so a reload tries again', e.replaced.length === 0 && /Could not finish signing out/.test(e.error.textContent), [e.replaced, e.error.textContent]);
  var f = await signin('?denied=blocked', '');
  check('LST-048 ?denied=blocked is cleaned too', JSON.stringify(f.replaced) === JSON.stringify(['/']) && /no longer has access/.test(f.error.textContent), f.replaced);

  console.log('launch-polish-console-signin: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}
main().catch(function (err) { console.error(err); process.exit(1); });
