// node functions/lib/ai-picture-panel.test.js — ETB2B AI's new pictures, the chat panel's half (editor-template-ui.js).
// The panel's decisions about a new picture live in one block of that file, between the two "aiPictureRules" marks,
// that uses nothing else of the editor; this runs that block, as it is, in node:
//   checkAsk         whether the AI's answer about a new picture can be used before anything is paid for;
//   askUntilAnswered phase 2 asked once more on no answer (never a second paid picture: the server answers the one
//                    it made), and again every few seconds while it is still being made, for a limited time;
//   outcome          phase 2's answer as the new picture's address, or the reason in plain words;
//   failedLine       "nothing changed" said only when that is true of the whole message;
//   shows            whether a reworked section really draws the new picture (the model may leave it out);
//   offerAgain       when a picture read back with the conversation gets "Use this picture".
// Then that runAiTurn, requestPicture and the conversation's history use those rules, and do not decide otherwise
// (read from the source). No network, no AI, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
var passed = 0, failed = 0;
function show(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + show(detail) : ''));
}

/* ======================= the block, run on its own ======================= */
var BEGIN = '/* aiPictureRules:begin', END = '/* aiPictureRules:end */';
var at = SRC.indexOf(BEGIN), to = SRC.indexOf(END);
check('D.0 the rules block is marked once', at !== -1 && to > at && SRC.indexOf(BEGIN, at + 1) === -1 && SRC.indexOf(END, to + 1) === -1, { at: at, to: to });
var BLOCK = SRC.slice(at, to);
// nothing of the editor: an empty context has no window, document, canvas or event, so a use of one would throw
var ctx = vm.createContext({});
vm.runInContext(BLOCK, ctx, { filename: 'editor-template-ui.js#aiPictureRules' });
var R = ctx.aiPictureRules;
check('D.0 the block defines aiPictureRules', !!R && typeof R.checkAsk === 'function');
// (a property of what it is given, such as c.eventId, is its own)
check('D.0 the block names nothing of the editor', !/(^|[^.\w$])(window|document|canvas|eventId|turnId|RevampAuth|RevampAiPicture|fetch|localStorage|setTimeout|madePic|offerPicture)\b/.test(BLOCK.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
check('D.0 the panel uses the block\'s words for where a picture goes', /var AI_PICTURE_WHERE = aiPictureRules\.WHERE;/.test(SRC));

var EVENT = 'qa-aipic-1';
var GEN = 'https://storage.googleapis.com/b/events/' + EVENT + '/generated/1730600000000-chat-place-AbCd1234.png';
function madeHere(url) { return String(url).indexOf('https://storage.googleapis.com/b/events/' + EVENT + '/generated/') === 0; }

/* ======================= D.1 checkAsk ======================= */
(function () {
  function ctxOf(over) {
    return Object.assign({ loaded: true, eventId: EVENT, turnId: 'TurnAbc1234', attached: [], known: function (id) { return id === 'hero-1' || id === 'agenda-1'; }, edits: [] }, over || {});
  }
  var swap = { n: 1, sectionId: 'hero-1', placement: 'hero', slot: 0, apply: 'swap', kind: 'place', alt: 'Mumbai skyline at dusk', subject: 'The Mumbai skyline at dusk, calm sea' };
  var ok = R.checkAsk(swap, ctxOf());
  check('D.1 a well-formed swap is used', ok.ask && !ok.note && ok.ask.n === 1 && ok.ask.sectionId === 'hero-1' && ok.ask.placement === 'hero' && ok.ask.apply === 'swap', ok);
  check('D.1 it carries only its own fields (no label: the panel names the section)', ok.ask && Object.keys(ok.ask).sort().join() === 'alt,apply,kind,n,placement,sectionId,slot,subject', ok.ask && Object.keys(ok.ask));

  var notLoaded = R.checkAsk(swap, ctxOf({ loaded: false }));
  check('D.1 the placing part not loaded: said, nothing made', !notLoaded.ask && /could not load the part that puts pictures in/.test(notLoaded.note), notLoaded);
  var noTurn = R.checkAsk(swap, ctxOf({ turnId: '' }));
  check('D.1 no turn to make it for: said', !noTurn.ask && /could not be started/.test(noTurn.note), noTurn);
  var noEvent = R.checkAsk(swap, ctxOf({ eventId: '' }));
  check('D.1 no event: said', !noEvent.ask && /could not be started/.test(noEvent.note), noEvent);
  check('D.1 not loaded is said first, even for an answer that is not usable', /could not load/.test(R.checkAsk({ n: 0 }, ctxOf({ loaded: false })).note));

  [0, 8, -1, 'x', null, 2.5].forEach(function (n) {
    var r = R.checkAsk(Object.assign({}, swap, { n: n }), ctxOf());
    check('D.1 number ' + show(n) + ' is not usable', n === 2.5 ? !!r.ask && r.ask.n === 2 : !r.ask && /could not be used/.test(r.note), r);
  });
  check('D.1 number 7 (after six attached pictures) is used', !!R.checkAsk(Object.assign({}, swap, { n: 7 }), ctxOf({ attached: ['a', 'b', 'c', 'd', 'e', 'f'] })).ask);
  var clash = R.checkAsk(swap, ctxOf({ attached: ['https://storage.googleapis.com/b/events/' + EVENT + '/chat/1.png'] }));
  check('D.1 a number an attached picture already has is not usable', !clash.ask && /could not be used/.test(clash.note), clash);
  check('D.1 the number after the attached ones is used', !!R.checkAsk(Object.assign({}, swap, { n: 2 }), ctxOf({ attached: ['u1'] })).ask);

  ['nav', 'footer', '', 'hasOwnProperty', 'toString', null, 3].forEach(function (p) {
    var r = R.checkAsk(Object.assign({}, swap, { placement: p }), ctxOf());
    check('D.1 placement ' + show(p) + ' is not usable', !r.ask && /could not be used/.test(r.note), r);
  });
  ['background', 'picture'].forEach(function (p) {
    check('D.1 placement ' + p + ' is used', !!R.checkAsk(Object.assign({}, swap, { placement: p, sectionId: 'agenda-1' }), ctxOf()).ask);
  });
  ['', 'replace', null].forEach(function (a) {
    var r = R.checkAsk(Object.assign({}, swap, { apply: a }), ctxOf());
    check('D.1 apply ' + show(a) + ' is not usable', !r.ask && /could not be used/.test(r.note), r);
  });
  ['a string', 42, true].forEach(function (x) {
    check('D.1 an answer that is not an object (' + show(x) + ') is not usable', /could not be used/.test(R.checkAsk(x, ctxOf()).note || ''));
  });
  var gone = R.checkAsk(Object.assign({}, swap, { sectionId: 'speakers-1' }), ctxOf());
  check('D.1 a section no longer on the page: said', !gone.ask && /no longer on the page/.test(gone.note), gone);

  var rework = { n: 1, sectionId: 'agenda-1', placement: 'background', slot: 0, apply: 'rework', kind: 'place', alt: 'a hall', subject: 'a quiet hall' };
  var noJob = R.checkAsk(rework, ctxOf());
  check('D.1 a rework with no section rework that names it: not used (it would be paid for and never placed)', !noJob.ask && /could not be used/.test(noJob.note), noJob);
  var otherJob = R.checkAsk(rework, ctxOf({ edits: [{ sectionId: 'agenda-1', instruction: 'x', pictures: [2] }] }));
  check('D.1 a rework whose section rework names another picture: not used', !otherJob.ask, otherJob);
  var withJob = R.checkAsk(rework, ctxOf({ edits: [{ sectionId: 'agenda-1', instruction: 'x', pictures: [1] }] }));
  check('D.1 a rework with the section rework that names it: used', !!withJob.ask && withJob.ask.apply === 'rework', withJob);

  var long = R.checkAsk(Object.assign({}, swap, { alt: '  a  ' + new Array(200).join('b'), subject: 'x\n\n' + new Array(200).join('y'), slot: -3 }), ctxOf());
  check('D.1 alt in one line, at most 150 characters', long.ask && long.ask.alt.length === 150 && /^a b/.test(long.ask.alt), long.ask && long.ask.alt.length);
  check('D.1 subject in one line, at most 140 characters', long.ask && long.ask.subject.length === 140 && /^x y/.test(long.ask.subject), long.ask && long.ask.subject.length);
  check('D.1 a negative slot is 0 (not named)', long.ask && long.ask.slot === 0);
  check('D.1 a slot given as text is a number', R.checkAsk(Object.assign({}, swap, { slot: '2' }), ctxOf()).ask.slot === 2);

  check('D.1 usesPicture: the entry that names the number', R.usesPicture({ pictures: [1, 3] }, 3) === true);
  check('D.1 usesPicture: not another number, nor none', R.usesPicture({ pictures: [1] }, 3) === false && R.usesPicture({}, 1) === false && R.usesPicture({ pictures: '3' }, 3) === false && R.usesPicture({ pictures: [0] }, 0) === false && R.usesPicture(null, 1) === false);
})();

/* ======================= D.2 phase 2 asked again: when, and how often ======================= */
(function () {
  var W = 150000;
  function next(r, retried, waited) { return R.nextRequest(r, { retried: !!retried, waited: waited || 0, waitMs: W }); }
  check('D.2 no answer: asked once more', next(null) === 'retry');
  check('D.2 no answer after the second ask: stops', next(null, true) === 'stop');
  check('D.2 an error page in front of the API (5xx, not JSON): asked once more', next({ ok: false, status: 502, body: null }) === 'retry');
  check('D.2 ... but only once', next({ ok: false, status: 503, body: null }, true) === 'stop');
  check('D.2 the server\'s own failure (JSON body): stands — it was paid and counted', next({ ok: false, status: 502, body: { error: 'x', code: 'chat-picture-store' } }) === 'stop');
  check('D.2 the stale sentence (504 with a body): stands', next({ ok: false, status: 504, body: { error: 'x' } }) === 'stop');
  check('D.2 the day\'s limit (429): stands', next({ ok: false, status: 429, body: { error: 'x' } }) === 'stop');
  check('D.2 a 4xx without a body is not asked again', next({ ok: false, status: 404, body: null }) === 'stop');
  check('D.2 still being made (409): waited for', next({ ok: false, status: 409, body: { error: 'busy' } }, false, 1000) === 'wait');
  check('D.2 ... also after the retry', next({ ok: false, status: 409, body: null }, true, 1000) === 'wait');
  check('D.2 ... until the wait is used up', next({ ok: false, status: 409, body: { error: 'busy' } }, false, W) === 'stop');
  check('D.2 a picture: stands', next({ ok: true, status: 200, body: { url: GEN } }) === 'stop');

  // the loop itself, over a scripted server and a clock that moves only when it waits
  function run(answers, waitMs, pollMs) {
    var calls = 0, clock = 0, waits = 0;
    function once() { var r = answers.length ? answers.shift() : { ok: false, status: 409, body: { error: 'busy' } }; calls++; return Promise.resolve(r); }
    function wait(ms) { waits++; clock += ms; return Promise.resolve(); }
    return R.askUntilAnswered(once, wait, function () { return clock; }, waitMs || W, pollMs || 5000).then(function (r) { return { r: r, calls: calls, waits: waits, clock: clock }; });
  }
  var made = { ok: true, status: 200, body: { url: GEN } };
  return Promise.all([
    run([made]).then(function (o) { check('D.2 a picture at once: one call', o.calls === 1 && o.r === made, o); }),
    run([null, made]).then(function (o) { check('D.2 dropped, then the picture (the server answers the one it made): two calls, the picture', o.calls === 2 && o.r === made, o); }),
    run([null, null, made]).then(function (o) { check('D.2 dropped twice: two calls, never a third — the owner is told', o.calls === 2 && o.r === null, o); }),
    run([{ ok: false, status: 502, body: null }, { ok: false, status: 502, body: null }]).then(function (o) { check('D.2 two error pages: two calls', o.calls === 2 && o.r.status === 502, o); }),
    run([{ ok: false, status: 502, body: { error: 'saved failed', code: 'chat-picture-store' } }, made]).then(function (o) { check('D.2 a failure the server stated: one call, it stands', o.calls === 1 && o.r.status === 502, o); }),
    run([null, { ok: false, status: 409, body: { error: 'busy' } }, { ok: false, status: 409, body: { error: 'busy' } }, made]).then(function (o) {
      check('D.2 dropped, then still being made, then made: waited for, every 5 s, no paid call more', o.calls === 4 && o.waits === 2 && o.r === made && o.clock === 10000, o);
    }),
    run([], 150000, 5000).then(function (o) {
      check('D.2 still being made for good: asked every 5 s for 150 s, then it stops', o.calls === 31 && o.waits === 30 && o.r.status === 409, o);
    }),
    run([{ ok: false, status: 409, body: null }, null, made]).then(function (o) {
      check('D.2 a wait does not use up the one retry', o.calls === 3 && o.r === made, o);
    })
  ]);
})().then(function () {

/* ======================= D.3 phase 2's answer ======================= */
(function () {
  var got = R.outcome({ ok: true, status: 200, body: { url: GEN, n: 1 } }, madeHere);
  check('D.3 a picture of this event\'s own generated ones is used', got.url === GEN && !got.why, got);
  var foreign = R.outcome({ ok: true, status: 200, body: { url: 'https://storage.googleapis.com/b/events/other-event/generated/x.png' } }, madeHere);
  check('D.3 an address that is not this event\'s own is not used [C14]', !foreign.url && /not this event’s own/.test(foreign.why) && /Nothing on your site changed/.test(foreign.why), foreign);
  var upload = R.outcome({ ok: true, status: 200, body: { url: 'https://storage.googleapis.com/b/events/' + EVENT + '/chat/x.png' } }, madeHere);
  check('D.3 the event\'s own address outside generated/ is not used', !upload.url, upload);
  var odd = R.outcome({ ok: true, status: 200, body: { url: { toString: function () { return GEN; } } } }, madeHere);
  check('D.3 an address that is not text is not used', !odd.url && /error 200/.test(odd.why), odd);
  var stated = R.outcome({ ok: false, status: 422, body: { error: 'The picture model would not make this picture. Nothing on your site changed — try describing a different scene.', code: 'ai-blocked' } }, madeHere);
  check('D.3 the server\'s sentence is said as it is', /would not make this picture/.test(stated.why), stated);
  var page = R.outcome({ ok: false, status: 502, body: null }, madeHere);
  check('D.3 an error page: its number, and that nothing changed', /error 502/.test(page.why) && /Nothing on your site changed/.test(page.why), page);
  var none = R.outcome(null, madeHere);
  check('D.3 no answer: could not be reached, nothing changed', /could not be reached/.test(none.why) && /Nothing on your site changed/.test(none.why), none);
  var okButError = R.outcome({ ok: false, status: 200, body: { url: GEN } }, madeHere);
  check('D.3 only an ok answer gives a picture', !okButError.url, okButError);
  check('D.3 a picture that is not held is not marked held', got.held === undefined, got);
  /* the lead's rule after QA follow-up 2: a picture whose check found what its place takes none of, twice, is made but
     kept off the page — it goes to the tray, and the server's sentence says why */
  var heldWhy = 'I made the new picture twice, and the second one still had people in it, but this place shows no people, so I did not put it on the page.';
  var held = R.outcome({ ok: true, status: 200, body: { url: GEN, n: 1, held: true, heldWhy: heldWhy } }, madeHere);
  check('D.3 a picture kept off the page by its check: its address, held, and the server\'s sentence', held.url === GEN && held.held === true && held.why === heldWhy, held);
  var heldBare = R.outcome({ ok: true, status: 200, body: { url: GEN, n: 1, held: true } }, madeHere);
  check('D.3 … with no sentence from the server, a plain one of its own', heldBare.held === true && /did not pass its check, so I did not put it on the page/.test(heldBare.why), heldBare);
  var heldForeign = R.outcome({ ok: true, status: 200, body: { url: 'https://storage.googleapis.com/b/events/other-event/generated/x.png', held: true, heldWhy: heldWhy } }, madeHere);
  check('D.3 … and only from this event\'s own generated pictures', !heldForeign.url && /not this event’s own/.test(heldForeign.why), heldForeign);
  check('D.3 "held" only when the server says true', R.outcome({ ok: true, status: 200, body: { url: GEN, held: 'yes' } }, madeHere).held === undefined);
})();

/* ======================= D.4 a picture that could not be made: what is said ======================= */
(function () {
  var why = 'The picture model answered without a picture. Nothing on your site changed — ask again.';
  check('D.4 the picture alone: nothing changed, as the server says', R.failedLine(why, 1, 0) === why);
  check('D.4 the picture and the rework that only puts it in: still nothing changed', R.failedLine(why, 2, 1) === why);
  check('D.4 the picture and a wording change: no picture was changed', R.failedLine(why, 2, 0) === 'The picture model answered without a picture. No picture was changed — ask again.', R.failedLine(why, 2, 0));
  check('D.4 the picture, its rework and a design change: no picture was changed', /No picture was changed/.test(R.failedLine(why, 3, 1)) && !/Nothing on/.test(R.failedLine(why, 3, 1)));
  check('D.4 the editor\'s own sentences are reworded too', /No picture was changed/.test(R.failedLine(R.outcome(null, madeHere).why, 2, 0)) && /No picture was changed/.test(R.failedLine(R.outcome({ ok: false, status: 502, body: null }, madeHere).why, 2, 0)));
  // every failure the server can answer phase 2 with says the site did not change, so the rewording finds it
  var S = require('./chat-picture').SENTENCES;
  ['limit', 'failLimit', 'ai-blocked', 'ai-timeout', 'chat-picture-stale', 'ai-bad-output', 'ai-quota', 'ai-unavailable', 'ai-config', 'ai-rejected',
    'chat-picture-store', 'chat-picture-state', 'chat-picture-limit'].forEach(function (k) {
    var line = R.failedLine(S[k], 2, 0);
    check('D.4 server sentence "' + k + '" with other changes: no picture was changed', typeof S[k] === 'string' && /No picture was changed/.test(line) && !/Nothing on your site changed/.test(line), line);
  });
})();

/* ======================= D.5 does a reworked section draw the new picture? ======================= */
(function () {
  var U = GEN, Q = '&quot;';
  var yes = {
    'an <img> src': '<section data-rv-section="agenda"><img src="' + U + '" alt="A quiet hall"></section>',
    'a <source> srcset of one': '<picture><source srcset="' + U + '"><img src="old.jpg"></picture>',
    'a srcset among others': '<img src="old.jpg" srcset="old.jpg 1x, ' + U + ' 2x">',
    'an inline background, as the browser writes it': '<div class="bg" style="background-image: url(' + Q + U + Q + ');"></div>',
    'an inline background in single quotes': '<div style="background:url(\'' + U + '\') center/cover"></div>',
    'a stylesheet url("…")': '[data-rv-section="agenda"] .bg { background: linear-gradient(rgba(0,0,0,.5), rgba(0,0,0,.5)), url("' + U + '") center / cover; }',
    'a stylesheet url(…) without quotes': '.bg{background-image:url(' + U + ')}',
    'a <style> inside the section': '<section><style data-rv-custom-css="">.x{background:url("' + U + '")}</style><div class="x"></div></section>',
    'an svg <image>': '<svg><image href="' + U + '" width="10" height="10"></image></svg>',
    'a video poster': '<video poster="' + U + '"></video>',
    'its address with ?v=': '<img src="' + U + '?v=1730600000">',
    'its WebP copy': '<img src="' + U + '.rv-0a1b2c3d.1600x900.w800.webp">'
  };
  Object.keys(yes).forEach(function (k) { check('D.5 drawn: ' + k, R.shows(yes[k], U) === true, yes[k]); });
  var no = {
    'the old picture only': '<section><img src="https://storage.googleapis.com/b/events/' + EVENT + '/generated/old.png" alt="old"></section>',
    'named in an alt text': '<img src="old.jpg" alt="' + U + '">',
    'a lazy data-src the page never reads': '<img data-src="' + U + '" src="old.jpg">',
    'a link to it': '<a href="' + U + '">the picture</a>',
    'a longer address that starts the same': '<img src="' + U + 'x">',
    'a stylesheet url() of a longer address': '.bg{background:url("' + U + '2")}',
    'its dots taken as any character': '<img src="' + U.replace('storage.googleapis.com', 'storageXgoogleapis.com') + '">',
    'a comment': '<!-- ' + U + ' --><div></div>',
    'nothing': ''
  };
  Object.keys(no).forEach(function (k) { check('D.5 not drawn: ' + k, R.shows(no[k], U) === false, no[k]); });
  check('D.5 no address: false', R.shows('<img src="x">', '') === false);
})();

/* ======================= D.6 a picture read back with the conversation ======================= */
(function () {
  check('D.6 applied: put in, no button', R.offerAgain('applied', null) === false && R.offerAgain('applied', false) === false);
  check('D.6 undone: taken back on purpose, no button', R.offerAgain('undone', false) === false);
  check('D.6 partly, and the page shows it: no button', R.offerAgain('partly', true) === false);
  check('D.6 partly, and the page does not show it (left out, sent to the tray a reload emptied): the button', R.offerAgain('partly', false) === true);
  check('D.6 partly, and the page cannot be read: the button (never lost)', R.offerAgain('partly', null) === true);
  check('D.6 not done, or closed while it was made: the button', R.offerAgain('failed', null) === true && R.offerAgain('applying', null) === true && R.offerAgain('', null) === true);
})();

/* ======================= D.7 the panel uses the rules (read from the source) ======================= */
(function () {
  function body(name) {
    var i = SRC.indexOf('function ' + name + '(');
    if (i === -1) return '';
    var open = SRC.indexOf('{', i), depth = 0;
    for (var j = open; j < SRC.length; j++) {
      if (SRC[j] === '{') depth++;
      else if (SRC[j] === '}' && --depth === 0) return SRC.slice(i, j + 1);
    }
    return '';
  }
  var req = body('requestPicture'), turn = body('runAiTurn'), hist = body('drawHistoryPicture'), keep = body('keepMadePicture');
  check('D.7 requestPicture asks through askUntilAnswered, with the panel\'s wait and poll', /aiPictureRules\.askUntilAnswered\(once, pause, function \(\) \{ return Date\.now\(\); \}, AI_PICTURE_WAIT_MS, AI_PICTURE_POLL_MS\)/.test(req), req.slice(-300));
  check('D.7 requestPicture sends only the event, the step and the turn (no prompt from the browser)', /JSON\.stringify\(\{ eventId: eventId, step: 'picture', turnId: turnId \}\)/.test(req));
  check('D.7 runAiTurn checks the answer with checkAsk, before anything is paid for', /aiPictureRules\.checkAsk\(result\.newPicture, \{ loaded: !!P, eventId: eventId, turnId: turnId, attached: attached, known: known, edits: edits \}\)/.test(turn));
  check('D.7 checkAsk runs before the turn\'s checkpoint and before phase 2', turn.indexOf('aiPictureRules.checkAsk') !== -1 && turn.indexOf('aiPictureRules.checkAsk') < turn.indexOf('t.before = canvas.snapshot()') &&
    turn.indexOf('t.before = canvas.snapshot()') < turn.indexOf('var pictureMade = np ? makeNewPicture()'));
  check('D.7 phase 2\'s answer is read with outcome (this event\'s own generated pictures only)', /aiPictureRules\.outcome\(r, madeHere\)/.test(turn));
  check('D.7 a failure is worded with failedLine over the planned items', /aiPictureRules\.failedLine\(why, items\.length, edits\.filter\(usesNew\)\.length\)/.test(turn));
  check('D.7 the picture is placed after the page\'s other changes and before the undo step', turn.indexOf('placeNewPicture(changedEls, done, said)') !== -1 &&
    turn.indexOf('placeNewPicture(changedEls, done, said)') < turn.indexOf('commitNow()'));
  check('D.7 one undo step for the whole change, recorded only when something took effect', /var changed = done\.length \? commitNow\(\) : false;/.test(turn) && (turn.match(/commitNow\(\)/g) || []).length === 1);
  // the rework that puts the new picture in
  check('D.7 a rework counts the picture as put in only when the rewritten section draws it',
    /var picShown = withPic && aiPictureRules\.shows\(fresh\.outerHTML \+ '\\n' \+ \(code\.cssIsOwn && canvas\.sectionCss \? canvas\.sectionCss\(fresh\) : ''\), madePic\.url\);/.test(turn) &&
    /if \(picShown\) madePic\.placed = true;/.test(turn) && !/if \(withPic\) madePic\.placed = true/.test(turn));
  check('D.7 ... and says "with the new picture" only then', /'reworked' \+ \(picShown \? ' with the new picture' : ''\)/.test(turn) && !/'reworked' \+ \(withPic/.test(turn));
  check('D.7 ... a rework that left it out: said, and the picture kept', /var unused = withPic && !picShown \? keepMadePicture\('It'\) : '';/.test(turn) &&
    /said\.push\('“' \+ job\.label \+ '” was reworked, but the new picture was not used in it\. ' \+ unused\);/.test(turn));
  check('D.7 the Undo note names the picture only when it was put in', /if \(madePic && madePic\.placed && t\.status !== 'failed'\) \{\s*card\.note\(/.test(turn));
  check('D.7 the logo unit is compared before and after the swap and the rework', (turn.match(/sameLogoUnit\(unitBefore, P\.unitState\(canvas\.doc\)\)/g) || []).length === 2);
  check('D.7 a made picture not on the page is kept: the tray, quietly, else "Use this picture"', /offerPicture\(madePic\.url, true\)/.test(keep) && /drawUsePicture\(bubble, madePic\.url\)/.test(keep) && /if \(!madePic \|\| madePic\.placed\) return '';/.test(keep));
  check('D.7 every place a made picture may be left out keeps it', (turn.match(/keepMadePicture\('(It|The new picture)'\)/g) || []).length >= 4 && !/offerPicture\(madePic\.url\)(?!, true)/.test(turn));
  check('D.7 the history offers "Use this picture" by offerAgain, reading the page for a "partly" change', /aiPictureRules\.offerAgain\(h\.status, onPage\)/.test(hist) && /aiPictureRules\.shows\(canvas\.doc\.documentElement\.outerHTML, pic\.url\)/.test(hist));
  check('D.7 the history draws only a made picture of this event', /pic\.state !== 'made' \|\| !madeHere\(pic\.url\)/.test(hist));
  /* QA 3 Nov 2026 (browser): after "give the Agenda a background picture" the Edit with AI live view kept the rework
     as sent back — one session, no day tabs — because the records were drawn in after the live view was told */
  check('D.7 the live view is told again once a reworked section\'s records are drawn in', /if \(redraw\) drawRecords\(false\)\.then\(function \(\) \{ pageChanged\(\); \}\);/.test(turn) && !/if \(redraw\) drawRecords\(false\);/.test(turn));
  /* The lead's decision of 3 Nov 2026 (QA follow-up, finding B): a records section with no background may get one
     through a rework, kept only if every record comes out unchanged; otherwise the section is put back, the picture
     goes to the tray and the owner is told plainly */
  var fill = body('fillRecords'), draw = body('drawRecords'), loader = body('aiPictures');
  check('D.7 the records are read before the rework', /var recordsBefore = withPic \? P\.recordsState\(job\.sec\) : '';/.test(turn) &&
    turn.indexOf('var recordsBefore = withPic') < turn.indexOf('var fresh = applySectionCode(job.sec, code);'));
  check('D.7 … and again once the records are drawn into the rewrite (fillRecords), a failed drawing counting as changed',
    /var recordsKept = !recordsBefore \? Promise\.resolve\(true\) : fillRecords\(false\)\.then\(null, function \(\) \{ return false; \}\)\.then\(function \(\) \{\s*return isLive\(fresh\) && P\.recordsState\(fresh\) === recordsBefore;\s*\}\);/.test(turn));
  check('D.7 … a rework that changed a record is put back, section and CSS, before anything counts it as done',
    /if \(!same\) putBack\(aiPictureRules\.RECORDS_CHANGED\);/.test(turn) && /function putBack\(why\) \{\s*if \(isLive\(fresh\)\) canvas\.replaceSection\(fresh, oldHtml, oldCss\);/.test(turn) &&
    turn.indexOf('if (!same) putBack(aiPictureRules.RECORDS_CHANGED);') < turn.indexOf('changedEls.push(fresh);') && turn.indexOf('if (!same) putBack') < turn.indexOf('var picShown = withPic'));
  check('D.7 … and the picture made for it waits in the tray, said in the reply', /\}\)\.then\(null, function \(err\) \{[^]*var kept = withPic \? keepMadePicture\('The new picture'\) : '';[^]*said\.push\('“' \+ job\.label \+ '” was not ' \+ \(job\.edit \? 'changed' : 'added'\) \+ ': ' \+ why/.test(turn));
  check('D.7 fillRecords draws the records and leaves the undo history alone; drawRecords is it and then the baseline',
    fill && !/undoStack|persist\(/.test(fill) && /return changed;/.test(fill) && /return fillRecords\(sectionsAdded(?:, unread)?\)\.then\(function \(changed\) \{/.test(draw) && /undoStack\[undoPtr\] = snap;/.test(draw));
  check('D.7 the editor uses its picture part only when it can read records', /typeof P\.recordsState === 'function'/.test(loader));
  /* QA follow-up 2, F3: a rework put back to protect the records, with nothing else changed, ended on "Nothing on the
     page changed." alone, though the picture had gone to the tray. The card's last line now says where it is. */
  var finish = body('finishAiCard');
  check('D.7 F3: runAiTurn ends the card with where a made picture that is not on the page is, unless a step says it already',
    /finishAiCard\(t, madePic && !madePic\.told \? keepMadePicture\('The new picture'\) : ''\);/.test(turn) && (turn.match(/finishAiCard\(/g) || []).length === 1 &&
    (turn.match(/madePic\.told = true;/g) || []).length === 2 && /step\.set\('fail', line\);\s*madePic\.told = true;/.test(turn), turn.slice(turn.indexOf('t.status = !changed'), turn.indexOf('t.status = !changed') + 400));
  (function () {
    var notes = [], made = [];
    function cardFor() { return { status: function () {}, note: function (x) { notes.push(x); }, foot: { textContent: '', hidden: true, appendChild: function (el) { made.push(el); } } }; }
    var fx = vm.createContext({
      document: { createElement: function (tag) { return { tag: tag, addEventListener: function () {}, appendChild: function () {} }; } },
      undoAiTurn: function () {}, markUndone: function () {}, Date: Date, Math: Math
    });
    vm.runInContext(finish + '\nthis.finishAiCard = finishAiCard;', fx);
    var KEPT = 'The new picture is in the tray above the message box: tell me where it goes.';
    fx.finishAiCard({ card: cardFor(), status: 'failed' }, KEPT);
    check('D.7 F3: a turn that changed nothing, its picture kept: "Nothing on the page changed." and where the picture is', notes[notes.length - 1] === 'Nothing on the page changed. ' + KEPT, notes);
    fx.finishAiCard({ card: cardFor(), status: 'failed' }, '');
    check('D.7 F3: with no picture kept, only that nothing changed', notes[notes.length - 1] === 'Nothing on the page changed.', notes);
    var n0 = notes.length;
    fx.finishAiCard({ card: cardFor(), status: 'partly', startedAt: Date.now() }, KEPT);
    check('D.7 F3: a turn that changed something else, its picture kept: Undo, and where the picture is', notes.slice(n0).indexOf(KEPT) !== -1 && made.some(function (el) { return el.tag === 'button'; }), notes.slice(n0));
    n0 = notes.length;
    fx.finishAiCard({ card: cardFor(), status: 'applied', startedAt: Date.now() });
    check('D.7 F3: a turn read back from the server (no picture said) writes no line about one', notes.length === n0, notes.slice(n0));
  })();
  /* a picture kept off the page by its check */
  check('D.7 a held picture is kept in madePic for the tray, and nothing is put in with it', /if \(got\.url && got\.held\) \{\s*madePic = \{ url: got\.url, placed: false, offered: false \};\s*return pictureHeld\(got\.why\);\s*\}/.test(turn) &&
    turn.indexOf('if (got.url && got.held)') < turn.indexOf('attached[np.n - 1] = madePic.url'), turn.slice(turn.indexOf('function makeNewPicture'), turn.indexOf('function makeNewPicture') + 900));
  var heldFn = body('pictureHeld'), without = body('withoutNewPicture');
  check('D.7 … its step says why, and every step that needed it is not done', /S\.picMake\.set\('fail', why\);/.test(heldFn) && /notDone\.push\(why\);/.test(heldFn) && /withoutNewPicture\('the new picture was kept off the page'\);/.test(heldFn) &&
    /S\.picPlace\.set\('fail', 'not done — ' \+ because\)/.test(without) && /edits\.splice\(i, 1\);/.test(without) && /jobSteps\.splice\(i, 1\);/.test(without), heldFn + without);
  /* the server may make a second picture after a failed check (chat-picture.js DEADLINE_MS) and then store it */
  var waitMs = +((/var AI_PICTURE_WAIT_MS = (\d+);/.exec(SRC) || [])[1] || 0);
  check('D.7 the editor waits as long as the server may take for a picture, a second one included', waitMs >= require('./chat-picture').DEADLINE_MS + 20000, waitMs);
  var plain = body('plainPictureInfo');
  check('D.7 the section\'s "wide" (a wide place takes a 16:9 picture) is sent to the server', /wide: p\.wide === true,/.test(plain), plain);
  check('D.7 what the owner is told: left as it was, because it would have changed what it shows from Content',
    /^left as it was — putting the new picture in would have changed what it shows from Content \(a name, a role, a photo, a logo or a link\)$/.test(R.RECORDS_CHANGED), R.RECORDS_CHANGED);
})();

/* ======================= D.8 ES5 ======================= */
(function () {
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still run */ }
  check('D.8 esbuild is there to check ES5', !!esbuild);
  if (esbuild) {
    var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('D.8 editor-template-ui.js is ES5 by esbuild', es5 === true, es5);
  }
})();

}).then(function () {
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error('FAIL the test itself stopped: ' + (err && err.stack || err));
  process.exit(1);
});
