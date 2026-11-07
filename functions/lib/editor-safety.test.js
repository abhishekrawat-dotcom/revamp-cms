// node functions/lib/editor-safety.test.js — the site editor never loses or overwrites work, also while ETB2B AI is busy
// (UX batch B04: UX-072, UX-073, UX-089, UX-090, UX-091, UX-092, UX-093).
// The editor's decisions about keeping work live in one block of editor-template-ui.js, between the two "workSafety"
// marks, that uses nothing else of the editor; this runs that block, as it is, in node:
//   openPlan       which copy opens: the version saved on the server, this browser's copy, or a question (UX-072)
//   olderCopyWords the question when this browser holds changes made on an older version
//   conflictWords  what Save says when a newer version was saved meanwhile, with "Open version N instead"
//   leaveAsk       what is asked before the editor is left (UX-073), and unsavedWork: whether there is anything to ask about
//   cardAsksSave   whether an ETB2B AI change's card still says it is only in this browser (UX-093)
//   busyLine       why Save, Publish changes, Undo and Redo wait while ETB2B AI is busy (UX-089, UX-090)
//   turnStatus     "partly" only when something really happened (UX-091), and planLead for the AI's sentence
//   undoQuestion   the in-app question in place of the browser's confirm (UX-092)
// Then that the editor uses those rules, and the other fixes are in place (read from the source). No network, no
// AI, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
var PAGE = fs.readFileSync(path.join(ROOT, 'custom_editor.html'), 'utf8');
var CANVAS = fs.readFileSync(path.join(ROOT, 'editor-canvas.js'), 'utf8');
var CANVAS_CSS = fs.readFileSync(path.join(ROOT, 'editor-canvas.css'), 'utf8');
var AIMODE = fs.readFileSync(path.join(ROOT, 'editor-ai-mode.js'), 'utf8');
var passed = 0, failed = 0;
function show(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + show(detail) : ''));
}
// a function's whole text, read from the source
function body(name, src) {
  src = src || SRC;
  var i = src.indexOf('function ' + name + '(');
  if (i === -1) return '';
  var open = src.indexOf('{', i), depth = 0;
  for (var j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return '';
}
function noComments(s) { return s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''); }

/* ======================= the block, run on its own ======================= */
var BEGIN = '/* workSafety:begin', END = '/* workSafety:end */';
var at = SRC.indexOf(BEGIN), to = SRC.indexOf(END);
check('0 the rules block is marked once', at !== -1 && to > at && SRC.indexOf(BEGIN, at + 1) === -1 && SRC.indexOf(END, to + 1) === -1, { at: at, to: to });
var BLOCK = SRC.slice(at, to);
// an empty context has no window, document, canvas or editor state, so a use of one would throw
var ctx = vm.createContext({});
vm.runInContext(BLOCK, ctx, { filename: 'editor-template-ui.js#workSafety' });
var W = ctx.workSafety;
check('0 the block defines workSafety', !!W && typeof W.openPlan === 'function');
// (a key of what it answers, such as { baseVersion: … }, is its own)
check('0 the block names nothing of the editor', !/(^|[^.\w$])(window|document|canvas|eventId|undoStack|undoPtr|aiWorking|aiState|siteInfo|savedMark|baseVersion|localStorage|RevampCore|RevampAuth|fetch|setTimeout|showToast|host)\b(?!\s*:)/.test(noComments(BLOCK)));

/* ======================= 1 busyLine ======================= */
check('1 nothing waits while ETB2B AI is ready', W.busyLine('ready') === '' && W.busyLine(undefined) === '');
check('1 applying: "still changing the page"', W.busyLine('working') === 'ETB2B AI is still changing the page — one moment');
check('1 thinking: "still working on your request"', W.busyLine('thinking') === 'ETB2B AI is still working on your request — one moment');

/* ======================= 2 openPlan (UX-072) ======================= */
(function () {
  function hash(s) { return JSON.stringify(s); }
  var S7 = { h1: 'Headline from laptop A2 (newest, saved)' }, S5 = { h1: 'Headline saved as version 5' };
  var GEN = { h1: 'The Biggest Congregation of Marketers in South India' }, B = { h1: 'Headline typed on laptop B' };
  function site(over) { return Object.assign({ version: 7, snapshot: S7, templateId: 'gen-abc', updatedAt: '2026-11-05T06:36:00Z', updatedBy: 'priya@timesinternet.in', eventCreatedAt: '2026-11-01T00:00:00Z' }, over || {}); }
  function plan(o) { return W.openPlan(Object.assign({ templateId: 'gen-abc', hash: hash, newRun: false, generationNewer: false }, o)); }

  var p = plan({ site: site(), local: undefined, mark: null });
  check('2 ED-01: a fresh browser opens the latest saved version, on that version', p.take === 'server' && p.baseVersion === 7 && p.why === 'fresh', p);
  p = plan({ site: site(), local: { snapshot: GEN, savedAt: 1, baseVersion: 0, edited: false }, mark: null });
  check('2 RP-05: an old copy with nothing of the person\'s own (the generation as it opened) gives way to the saved version', p.take === 'server' && p.baseVersion === 7, p);
  p = plan({ site: site(), local: { snapshot: S5, savedAt: 1, baseVersion: 5, edited: true }, mark: { version: 5, hash: hash(S5) } });
  check('2 a copy that is what this browser saved as version 5 gives way to version 7, and says it is newer', p.take === 'server' && p.baseVersion === 7 && p.why === 'newer', p);
  p = plan({ site: site(), local: { snapshot: S7, savedAt: 1 }, mark: null });
  check('2 a copy the same as the saved version: the saved version, nothing unsaved', p.take === 'server' && p.why === 'same', p);
  p = plan({ site: site(), local: { snapshot: B, savedAt: 1, baseVersion: 7, edited: true }, mark: { version: 7, hash: hash(S7) } });
  check('2 changes of the person\'s own made on version 7: this browser\'s copy opens, unsaved, made on 7', p.take === 'browser' && p.baseVersion === 7 && p.why === 'unsaved', p);
  p = plan({ site: site(), local: { snapshot: B, savedAt: 1, baseVersion: 5, edited: true }, mark: { version: 5, hash: hash(S5) } });
  check('2 ED-01 laptop B: changes made on version 5 while 7 was saved: the person is asked, and the copy stays on 5', p.take === 'ask' && p.baseVersion === 5 && p.why === 'older-changes', p);
  p = plan({ site: site(), local: { snapshot: B, savedAt: 1 }, mark: null });
  check('2 a copy from before baseVersion was kept, never saved here: asked, made on no version', p.take === 'ask' && p.baseVersion === 0, p);
  p = plan({ site: site(), local: { snapshot: B, savedAt: 1 }, mark: { version: 7, hash: hash(S7) } });
  check('2 a copy from before baseVersion was kept, edited after this browser saved 7: its own changes on 7', p.take === 'browser' && p.baseVersion === 7, p);
  p = plan({ site: site(), local: { snapshot: B, savedAt: 1, baseVersion: 7, edited: true, eventCreatedAt: '2025-01-01T00:00:00Z' }, mark: null });
  check('2 a copy kept for an earlier event at the same address is not opened', p.take === 'server' && p.why === 'fresh', p);
  p = plan({ site: site(), local: { snapshot: B, savedAt: 1, baseVersion: 7, edited: true }, mark: null, newRun: true });
  check('2 a new Create Event result is what was asked for: this browser\'s rules, saved over version 7 without a question', p.take === 'browser' && p.baseVersion === 7 && p.why === 'new-run', p);
  p = plan({ site: site(), local: undefined, mark: null, generationNewer: true });
  check('2 a site generated again after its last save: the generation, as before', p.take === 'browser' && p.why === 'new-run', p);
  p = plan({ site: null, local: { snapshot: B, savedAt: 1 }, mark: null });
  check('2 a site never saved: this browser\'s copy, and the first save is version 1', p.take === 'browser' && p.baseVersion === 0 && p.why === 'never-saved', p);
  p = plan({ site: undefined, local: { snapshot: B, savedAt: 1, baseVersion: 6 }, mark: { version: 4, hash: 'x' } });
  check('2 the saved site could not be read: this browser\'s copy, still made on its own version (a newer save is asked about)', p.take === 'browser' && p.baseVersion === 6 && p.why === 'unreadable', p);
  p = plan({ site: undefined, local: { snapshot: B, savedAt: 1 }, mark: { version: 4, hash: 'x' } });
  check('2 … a copy from before baseVersion was kept: the version this browser last saved', p.baseVersion === 4, p);
  p = plan({ site: site({ snapshot: null }), local: { snapshot: B, savedAt: 1, baseVersion: 6 }, mark: null });
  check('2 a saved page with no snapshot (an editor of the previous release): not reopened, and a save is still asked about', p.take === 'browser' && p.baseVersion === 6 && p.why === 'not-reopenable', p);
  p = plan({ site: site({ templateId: 'tech500' }), local: undefined, mark: null });
  check('2 a saved site of another template is not put on this one', p.take === 'browser' && p.why === 'not-reopenable', p);
  p = plan({ site: site({ version: 0 }), local: undefined, mark: null });
  check('2 version 0 is "never saved"', p.take === 'browser' && p.why === 'never-saved', p);
})();

/* ======================= 3 the words (UX-072) ======================= */
(function () {
  var w = W.olderCopyWords({ base: 5, localAt: '3 Nov, 10:05', version: 7, by: 'priya@timesinternet.in', at: '5 Nov, 12:06' });
  check('3 the question names the copy\'s version, the newer one, who and when', w.text === 'This browser has changes to this site from 3 Nov, 10:05, made on version 5, that were not saved. Since then, version 7 was saved by priya@timesinternet.in on 5 Nov, 12:06.', w.text);
  check('3 … and offers to open version 7 or keep the changes', w.open === 'Open version 7' && w.keep === 'Keep my changes' && /Undo in the top bar brings this browser’s changes back/.test(w.more), w);
  w = W.olderCopyWords({ base: 0, localAt: '', version: 3, by: '', at: '' });
  check('3 a copy never saved says so', w.text === 'This browser has its own copy of this site, which was never saved. Since then, version 3 was saved.', w.text);
  var c = W.conflictWords({ version: 7, updatedBy: 'priya@timesinternet.in' }, 'asha@timesinternet.in', '5 Nov, 12:06');
  check('3 Save over a colleague\'s newer version: who, when, and that theirs is kept', c.text === 'priya@timesinternet.in saved version 7 on 5 Nov, 12:06 while you were editing. Replace it with yours? Theirs is kept in the history.', c.text);
  check('3 … with "Open version 7 instead"', c.open === 'Open version 7 instead' && c.replace === 'Replace with mine', c);
  c = W.conflictWords({ version: 5, updatedBy: 'asha@timesinternet.in' }, 'asha@timesinternet.in', '');
  check('3 the same person elsewhere is not called someone else', /^You saved version 5 in another tab or browser while this editor was open\./.test(c.text) && c.replace === 'Replace it', c);
  check('3 no name known: "Someone"', /^Someone saved version 2 /.test(W.conflictWords({ version: 2 }, '', '').text));
})();

/* ======================= 4 leaveAsk (UX-073) ======================= */
(function () {
  check('4 nothing unsaved, nothing running: leave at once', W.leaveAsk({ ai: 'ready', saving: false, dirty: false }) === null);
  var q = W.leaveAsk({ ai: 'ready', saving: false, dirty: true });
  check('4 unsaved changes: asked, in the words of the checklist', q && q.kind === 'unsaved' && q.text === 'You have changes that are not saved. They stay only in this browser until you save.', q);
  check('4 a save on its way: it finishes first', W.leaveAsk({ ai: 'ready', saving: true, dirty: true }).kind === 'wait');
  q = W.leaveAsk({ ai: 'working', saving: false, dirty: false });
  check('4 EA-M2: ETB2B AI still applying: "Leave anyway? This change will be lost."', q.kind === 'ai' && q.title === 'ETB2B AI is still changing the page' && q.text === 'Leave anyway? This change will be lost.', q);
  q = W.leaveAsk({ ai: 'working', saving: false, dirty: true });
  check('4 … and the other unsaved changes are said too', /Your other changes stay only in this browser until you save\.$/.test(q.text), q);
  q = W.leaveAsk({ ai: 'thinking', saving: true, dirty: false });
  check('4 ETB2B AI still thinking: asked before a save is waited for', q.kind === 'ai' && /will not be made/.test(q.text), q);
})();

/* ======================= 4b unsavedWork (UX-073, B04 verify) ======================= */
(function () {
  check('4b B04 verify: a site never saved, opened and left untouched: nothing to ask about', W.unsavedWork({ dirty: true, savedVersion: 0, edited: false }) === false);
  check('4b … the page as it opened is not saved either way: still nothing (no version known yet)', W.unsavedWork({ dirty: true, savedVersion: undefined, edited: false }) === false);
  check('4b a site never saved with an edit, an ETB2B AI change or a Create Event hand-off: asked', W.unsavedWork({ dirty: true, savedVersion: 0, edited: true }) === true);
  check('4b a saved site with unsaved changes: asked, also when the editor made them by itself', W.unsavedWork({ dirty: true, savedVersion: 3, edited: false }) === true && W.unsavedWork({ dirty: true, savedVersion: 3, edited: true }) === true);
  check('4b the saved version as it is: nothing to ask about', W.unsavedWork({ dirty: false, savedVersion: 3, edited: true }) === false && W.unsavedWork({ dirty: false, savedVersion: 0, edited: true }) === false);
})();

/* ======================= 4c cardAsksSave (UX-093, B04 verify) ======================= */
(function () {
  function card(o) { var c = { status: 'applied', pageChanged: true, ptr: 3, savedPtr: -1 }; for (var k in o) c[k] = o[k]; return c; }
  check('4c a change made and not saved, the page unsaved: "In this browser only until you Save"', W.cardAsksSave(card({}), true) === true);
  check('4c … and a change made in part', W.cardAsksSave(card({ status: 'partly' }), true) === true);
  check('4c the page saved: not said', W.cardAsksSave(card({}), false) === false);
  check('4c B04 verify: the change saved (card Save), then Why now typed in: not said again', W.cardAsksSave(card({ savedPtr: 3 }), true) === false && W.cardAsksSave(card({ savedPtr: 5 }), true) === false);
  check('4c a save made before the change does not count for it', W.cardAsksSave(card({ savedPtr: 2 }), true) === true);
  check('4c Undo past the change, Save, then Redo: the change is unsaved again, and said', W.cardAsksSave(card({ ptr: 3, savedPtr: 2 }), true) === true);
  check('4c a change undone or not made: not said', W.cardAsksSave(card({ status: 'undone' }), true) === false && W.cardAsksSave(card({ status: 'failed' }), true) === false && W.cardAsksSave(card({ status: 'applying' }), true) === false);
  check('4c a change that only made forms (on the server already): not said', W.cardAsksSave(card({ pageChanged: false }), true) === false);
})();

/* ======================= 5 turnStatus and planLead (UX-091) ======================= */
(function () {
  var five = ['“Hero” was not changed: timeout', '“Overview” was not changed: timeout', '“Why Join Us” was not changed: timeout', '“FAQs” was not changed: timeout', '“Footer” was not changed: timeout'];
  check('5 EA-02: five reworks failed, nothing done: not "partly" but failed', W.turnStatus([], five, false, 0) === 'failed');
  check('5 nothing done even though the page changed (incidental marks): failed', W.turnStatus([], five, true, 0) === 'failed');
  check('5 something done and something not: partly', W.turnStatus(['Overview reworked'], ['“FAQs” was not changed'], true, 0) === 'partly');
  check('5 everything done: applied', W.turnStatus(['Overview reworked'], [], true, 0) === 'applied');
  check('5 a form made and nothing else on the page: applied', W.turnStatus(['Form “VIP” created'], [], false, 1) === 'applied');
  check('5 done listed but the page did not change: failed', W.turnStatus(['Theme color'], [], false, 0) === 'failed');
  check('5 the AI\'s sentence over a change that did not happen: "What I tried:"', W.planLead('failed') === 'What I tried: ');
  check('5 … over one that happened in part: "What I planned:"', W.planLead('partly') === 'What I planned: ');
  check('5 … over one that happened: nothing', W.planLead('applied') === '' && W.planLead('undone') === '');
})();

/* ======================= 6 undoQuestion and UNDO_GONE (UX-092, UX-093) ======================= */
(function () {
  var q = W.undoQuestion(0, 1);
  check('6 the in-app question names the edit that goes too and how to bring it back', q.text === 'The page goes back to how it was before this change, so the edit you made since will be undone too. Undo in the top bar brings it all back.', q.text);
  q = W.undoQuestion(2, 3);
  check('6 … later AI changes and several edits', /so the 2 changes ETB2B AI made after it and the 3 edits you made since will be undone too/.test(q.text), q.text);
  check('6 … nothing after it', W.undoQuestion(0, 0).text === 'The page goes back to how it was before this change. Undo in the top bar brings it all back.');
  check('6 UX-093: a card whose Undo is gone says how to get back, and points at no disabled button or History restore that does not exist',
    /Ask ETB2B AI to change it back, or change it yourself on the page\.$/.test(W.UNDO_GONE) && !/top bar|History/.test(W.UNDO_GONE), W.UNDO_GONE);
})();

/* ======================= 7 the editor uses the rules (read from the source) ======================= */
(function () {
  var resolve = body('resolveInitialContent'), fetchSaved = body('fetchSavedSite');
  check('7 UX-072: opening reads the saved site from the server (RevampCore.fetchSite) beside this browser\'s copy', /RevampCore\.fetchSite\(eventId\)/.test(fetchSaved) && /Promise\.all\(\[localGet\(storeKey\), fetchSavedSite\(\)\]\)/.test(resolve));
  check('7 UX-072: … and decides by workSafety.openPlan, keeping its base version', /workSafety\.openPlan\(/.test(resolve) && /baseVersion = plan\.baseVersion;/.test(resolve) &&
    /plan\.take === 'server'\) return takeSavedSite/.test(resolve) && /plan\.take === 'ask'\) return askAboutOlderCopy/.test(resolve) && /return resolveFromBrowser\(saved\);/.test(resolve));
  var take = body('takeSavedSite'), onSaved = body('onSavedVersion');
  check('7 UX-072: the saved version opens as the first step, and the browser\'s mark is that version (so "v7 · saved to staging", not "Unsaved changes")',
    /canvas\.restore\(site\.snapshot, restoreOpts\(\)\)/.test(take) && /undoStack = \[canvas\.snapshot\(site\.snapshot\)\]; undoPtr = 0;/.test(take) && /onSavedVersion\(site\.version\)/.test(take) &&
    /baseVersion = version;/.test(onSaved) && /writeMark\(\{ version: version, hash: snapHash\(undoStack\[undoPtr\]\) \}\)/.test(onSaved) && /localEdited = false;/.test(onSaved));
  var older = body('askAboutOlderCopy');
  check('7 UX-072: changes made on an older version: asked in the editor\'s dialog, "Open version N" a step Undo takes back',
    /workSafety\.olderCopyWords\(/.test(older) && /ask\(\{/.test(older) && /undoStack = \[mine, canvas\.snapshot\(site\.snapshot\)\]; undoPtr = 1;/.test(older));
  var rec = body('localRecord');
  check('7 UX-072: this browser\'s copy keeps its base version, whether it holds the person\'s own changes, and its event', /baseVersion: baseVersion/.test(rec) && /edited: localEdited/.test(rec) && /eventCreatedAt:/.test(rec));
  var record = body('record');
  check('7 UX-072: a step is the person\'s own unless the editor made it by itself as the page opened', /if \(!automatic \|\| editingEl\) localEdited = true;/.test(record));
  check('7 UX-072: Undo or Redo to a page that is not the saved one is the person\'s own (Undo after "Open version N"), unless it differs only by the opening\'s own updates (UX-076)',
    /localEdited = !savedMark \|\| \(savedMark\.hash !== snapHash\(undoStack\[undoPtr\]\) && !autoOnly\(\)\);/.test(body('step')));
  /* B05 (UX-076): the opening's updates are part of the page as it opened (bakeAuto); once the person has changed
     something they are a step of the editor's own, never the person's (commitAutomatic) */
  check('7 UX-072: the opening\'s own updates are recorded as automatic', /if \(putRight\.length\) bakeAuto\(putRight\);/.test(SRC) && /syncEtLogos\(\)\) bakeAuto\(\['the ET logo and menu'\]\);/.test(SRC) &&
    /if \(undoPtr !== openPtr \|\| editingEl\) \{ commitAutoStep\(names\); return; \}/.test(body('bakeAuto')) && /if \(!commitAutomatic\(\)\) return false;/.test(body('commitAutoStep')) &&
    /record\(false, true\)/.test(body('commitAutomatic')));

  var save = body('saveToStaging');
  check('7 UX-072: Save is made on the version this editor opened (not only this browser\'s mark)', /baseVersion: force \? 0 : baseVersion/.test(save) && !/savedMark && savedMark\.version/.test(save));
  check('7 UX-072: the old "Save over version N?" dialog is gone', !/Save over version/.test(SRC) && !/Save as version ' \+/.test(SRC));
  check('7 UX-072: a real conflict asks in the editor\'s words, with Replace and Open version N instead',
    /workSafety\.conflictWords\(cur, siteInfo && siteInfo\.me, when\(cur\.updatedAt\)\)/.test(save) && /if \(answer === 'replace'\) return send\(true\);/.test(save) && /openSavedVersion\(\)/.test(save));
  check('7 UX-072: after a save the copy is on the saved version', /baseVersion = out\.version;/.test(save) && /if \(undoStack\[undoPtr\] === snap\) localEdited = false;/.test(save));
  check('7 UX-072: the approval GET\'s "me" is kept, so "You saved version N" is told apart', /me: a\.me \|\| ''/.test(body('loadSiteInfo')));

  check('7 UX-089: Save returns early while ETB2B AI is busy, saying why', /var busy = workSafety\.busyLine\(aiState\);\s*if \(busy\) \{ showToast\(busy \+ '\.'\); return Promise\.reject\(cancelled\(\)\); \}/.test(save) &&
    save.indexOf('workSafety.busyLine(aiState)') < save.indexOf('flush();'));
  check('7 UX-089: the page saved is the snapshot saved (a difference is recorded first)', /if \(!canvas\.sameSnapshot\(canvas\.snapshot\(undoStack\[undoPtr\]\), undoStack\[undoPtr\]\)\) commitNow\(\);\s*var snap = undoStack\[undoPtr\], hash = snapHash\(snap\), html = canvas\.serialize\(\);/.test(save));
  var pub = body('publish');
  check('7 UX-089: Publish changes returns early while ETB2B AI is busy', /var busy = workSafety\.busyLine\(aiState\);\s*if \(busy\) \{ showToast\(busy \+ '\.'\); return; \}/.test(pub) && pub.indexOf('busyLine') < pub.indexOf('saveToStaging'));
  var state = body('renderSiteState');
  check('7 UX-089: the Save button is disabled with the reason as its title', /save\.disabled = saving \|\| !dirty \|\| !!busy;/.test(state) && /save\.title = busy \|\| save\.getAttribute\('data-title'\);/.test(state));
  var sync = body('syncBusyControls');
  check('7 UX-089: Publish changes too, and every change of ETB2B AI\'s state reaches them', /pub\.disabled = !!line/.test(sync) && /renderSiteState\(\);/.test(sync) && /updateHistoryButtons\(\);/.test(sync) &&
    /aiState = state === 'thinking' \|\| state === 'working' \? state : 'ready';\s*syncBusyControls\(\);/.test(body('setChatStatus')));
  check('7 UX-089: Ctrl/Cmd+S says why it waits (page and live view)', /window\.RevampTemplateUI\.busyLine\(\)\) window\.RevampTemplateUI\.save\(\)/.test(PAGE) && /UI\.busyLine && UI\.busyLine\(\)\) UI\.save\(\)/.test(AIMODE));

  var step = body('step');
  check('7 UX-090: Undo and Redo return early while ETB2B AI applies a change', /if \(aiWorking\) \{ busyToast\(\); return; \}/.test(step) && step.indexOf('aiWorking') < step.indexOf('deselect()'));
  var hist = body('updateHistoryButtons');
  check('7 UX-090: … and their buttons are disabled then, with the reason', /var busy = aiWorking \? workSafety\.busyLine\('working'\) : '';/.test(hist) && /b\.disabled = !!busy \|\| pair\[1\];/.test(hist));
  check('7 UX-090: nothing else records a step while ETB2B AI applies a change (flush, the slider timer, the opening\'s updates)',
    /if \(!canvas \|\| remounting \|\| aiWorking\) return;/.test(body('flush')) && /if \(!aiWorking\) commitNow\(\);/.test(body('commit')) && /aiWorking \? false : record\(false, true\)/.test(body('commitAutomatic')));
  var wire = body('wireCanvasEvents');
  check('7 UX-090/092: a click on the canvas does nothing but say so while ETB2B AI applies a change', /if \(aiWorking\) \{ busyToast\(\); return; \}/.test(wire) && wire.indexOf('if (aiWorking)') < wire.indexOf('enterEdit(editable)'));
  var guarded = ['setHidden', 'moveSection', 'duplicateSection', 'deleteSection', 'renameSection', 'insertSection', 'addBlock', 'addRepeatItem', 'removeRepeatItem', 'setDesign', 'styleSelected', 'applyTheme', 'applySectionEdges', 'placeFormSection', 'openDevZone'];
  var missing = guarded.filter(function (n) { return !new RegExp(n + ': whenPageFree\\(' + n + '\\)').test(SRC); });
  check('7 UX-090: the side panels\' page changes wait too (whenPageFree)', !missing.length && /if \(aiWorking\) \{ busyToast\(\); return false; \}/.test(body('whenPageFree')), missing);
  /* B04 verify: Layers → a section's name brought up the section's pill while ETB2B AI was applying a change, and Hide
     there recorded a step holding half of the change */
  check('7 UX-090 (B04 verify): the section pill\'s tools wait while ETB2B AI applies a change (Hide, Duplicate, Delete, + Item, </>, Redesign, Background)',
    /if \(!btn \|\| !activeSectionEl\) return;\s*(\/\*[\s\S]*?\*\/\s*)?if \(aiWorking\) \{ busyToast\(\); return; \}/.test(body('onSecToolbarClick')) &&
    body('onSecToolbarClick').indexOf('aiWorking') < body('onSecToolbarClick').indexOf("action === 'duplicate-section'"));
  check('7 UX-090 (B04 verify): … and the element pill\'s tools', /if \(!btn \|\| !selectedEl\) return;\s*(\/\/[^\n]*\s*)?if \(aiWorking\) \{ busyToast\(\); return; \}/.test(body('onToolbarClick')));
  check('7 UX-090 (B04 verify): selecting from the side panels waits too (Layers → a name, Forms → Show on page, the live view)',
    /selectSection: whenPageFree\(selectSection\)/.test(SRC) && /revealElement: whenPageFree\(revealElement\)/.test(SRC) && !/selectSection: selectSection[,\s]/.test(SRC));
  var pos = body('positionToolbars');
  check('7 UX-090 (B04 verify): neither pill shows while ETB2B AI applies a change, and they come back after', /if \(aiWorking\) \{ selToolbar\.hidden = true; secToolbar\.hidden = true; return; \}/.test(pos) &&
    pos.indexOf('if (aiWorking)') < pos.indexOf('selToolbar.hidden = false') && pos.indexOf('if (aiWorking)') < pos.indexOf('secToolbar.hidden = false') && /if \(!on\) repositionToolbars\(\);/.test(body('setAiWorking')));
  var del = body('confirmDeleteSection');
  check('7 UX-090 (B04 verify): Delete and Hide instead, asked while ETB2B AI was still thinking, wait in their dialog once it applies the change',
    (del.match(/if \(aiWorking\) \{ busyToast\(\); return false; \}\s*if \(!sec\.isConnected\) return;/g) || []).length === 2);
  var pic = body('openPictureDialog');
  check('7 UX-090 (B04 verify): a picture chosen while ETB2B AI applies a change waits in its dialog, an upload kept as its address',
    /if \(aiWorking\) \{\s*urlBox\.value = url;/.test(pic) && pic.indexOf('if (aiWorking)') < pic.indexOf('apply(url)') && /uploadBtn\.disabled = false;/.test(pic.slice(pic.indexOf('if (aiWorking)'))));
  var dev = body('openDevZone');
  check('7 UX-090 (B04 verify): the developer zone\'s Apply waits too, keeping the code', /if \(aiWorking\) return fail\(workSafety\.busyLine\('working'\) \+ '\. Apply again when it is done\.'\);/.test(dev) &&
    dev.indexOf("busyLine('working') + '. Apply again") < dev.indexOf('canvas.replaceSection('));
  var redesign = body('openRedesignDialog');
  check('7 UX-090 (B04 verify): a section redesign answered while ETB2B AI applies a change goes on the page after it, as its own step',
    /whenAiIdle\(function \(\) \{\s*open = document\.contains\(ask\);\s*if \(!isLive\(sec\)\)/.test(redesign) && redesign.indexOf('whenAiIdle(') < redesign.indexOf('canvas.replaceSection('));
  var FORMS = fs.readFileSync(path.join(ROOT, 'editor-forms.js'), 'utf8');
  check('7 UX-090 (B04 verify): a form deleted while ETB2B AI applies a change is let go of after it, and the delete waits for that',
    /unlinkForm: function \(formId\) \{\s*(\/\/[^\n]*\s*)?if \(aiWorking\) showToast\('The form is deleted once ETB2B AI has finished changing the page\.'\);\s*return new Promise\(function \(done, fail\) \{ whenAiIdle\(function \(\) \{ try \{ done\(unlinkForm\(formId\)\); \} catch \(err\) \{ fail\(err\); \} \}\); \}\);/.test(SRC) &&
    /if \(ui && ui\.unlinkForm\) return ui\.unlinkForm\(form\.id\);/.test(FORMS));
  check('7 UX-090: a server answer that changes the page waits until the change is on the page (the logo\'s dark copy)', /whenAiIdle\(function \(\) \{\s*delete darkPending\[src\];/.test(SRC) && /afterAiQueue\.splice\(0\)\.forEach/.test(body('setAiWorking')));

  var turn = body('runAiTurn');
  check('7 UX-090: the design is read back before it is called done', /designSet\[k\] = canvas\.design\.get\(k\)/.test(turn) && /var slipped = Object\.keys\(designSet\)\.filter\(function \(k\) \{ return canvas\.design\.get\(k\) !== designSet\[k\]; \}\);/.test(turn) &&
    turn.indexOf('var slipped') < turn.indexOf('var changed = done.length ? commitNow() : false;'));
  check('7 UX-091: the status comes from what really happened (turnStatus)', /t\.status = workSafety\.turnStatus\(done, notAll, changed, formIds\.length\);/.test(turn) && !/t\.status = !changed && !formIds\.length/.test(turn));
  /* with ETB2B AI everywhere (B15): a change stopped before anything took effect is put back the same way, and its
     card says "Stopped. Nothing on the page changed." */
  check('7 UX-091: a change where nothing took effect puts the page back exactly, with no Undo', /if \(\(t\.status === 'failed' \|\| t\.status === 'stopped'\) && !changed && t\.before\) \{ canvas\.restore\(t\.before, restoreOpts\(\)\);/.test(turn) &&
    /if \(t\.status === 'failed' \|\| t\.status === 'stopped'\) \{\s*card\.note\(\(t\.status === 'stopped' \? 'Stopped\. ' : ''\) \+ 'Nothing on the page changed\.'/.test(body('finishAiCard')));
  check('7 UX-091: the AI\'s sentence over a change that did not happen is marked (markPlan)', /if \(t\.bubble\) markPlan\(t\.bubble, t\.status\);/.test(body('finishAiCard')) && /workSafety\.planLead\(status\)/.test(body('markPlan')) && /bubble: bubble, live: true/.test(turn));

  check('7 UX-092: a section being rewritten is locked after its request is made and let go of either way',
    /var asked = requestSectionCode\(job\.sec,/.test(turn) && /var wordsBefore = sectionWords\(job\.sec\);\s*lockSection\(job\.sec, true\);\s*return untilStopped\(asked\)\.then\(function \(code\) \{\s*lockSection\(job\.sec, false\);/.test(turn) &&
    /\}\)\.then\(null, function \(err\) \{\s*lockSection\(job\.sec, false\);/.test(turn));
  check('7 UX-092: an answer is not put over words edited meanwhile', /if \(sectionWords\(job\.sec\) !== wordsBefore\) throw new Error\('you edited it meanwhile, so it was left as you had it'\);/.test(turn) &&
    turn.indexOf('sectionWords(job.sec) !== wordsBefore') < turn.indexOf('var fresh = applySectionCode(job.sec, code);'));
  check('7 UX-092: the lock is the editor\'s own (never in a snapshot or a saved page)', /\[data-rv-ai-busy\]';/.test(CANVAS) && /m\.removeAttribute\('data-rv-ai-busy'\);/.test(CANVAS) && /'data-ai-media-skipped', 'data-rv-ai-busy'\]/.test(CANVAS) &&
    /\[data-rv-section\]\[data-rv-ai-busy\] > \*\{ opacity:\.45; pointer-events:none !important; \}/.test(CANVAS_CSS) && /'data-rv-filled', 'data-rv-ai-busy'\]/.test(SRC));
  check('7 UX-092: the caption over it says what is happening', /pill\.textContent = 'ETB2B AI is rewriting this section…';/.test(body('lockSection')) && /\.tpl-ai-busy\{/.test(PAGE) && /positionBusyPills\(\);/.test(body('positionToolbars')));
  var undo = body('undoAiTurn');
  check('7 UX-092: no browser confirm: the editor\'s own question, with "Keep my edits"', !/window\.confirm/.test(undo) && /workSafety\.undoQuestion\(later\.length, own\)/.test(undo) && /label: 'Keep my edits'/.test(undo));
  check('7 UX-092: a change of settings and wording only is undone on its own, keeping later edits', /var alone = later\.length \? null : undoByInverse\(t\);/.test(undo) &&
    /t\.inverse = changed && onlyWords \?/.test(turn) && /applyTextEdit\(te, textChanges\)/.test(turn) && /inverse: t\.inverse \|\| null/.test(body('keepCheckpoint')));
  var inv = body('undoByInverse');
  check('7 UX-092: … each text back only where it still reads as the change left it, the settings only if untouched since',
    /n\.nodeValue === c\.after/.test(inv) && /node\.nodeValue = c\.before;/.test(inv) && /cur\.design !== t\.after\.design\)\) return null;/.test(inv) && /back\.design = t\.before\.design;/.test(inv));

  var card = body('drawCardSave');
  check('7 UX-093: a change made in this session says "In this browser only until you Save", with Save beside Undo', /note\.textContent = 'In this browser only until you Save\.';/.test(card) && /b\.textContent = 'Save';/.test(card) && /saveToStaging\(\)/.test(card) &&
    /else if \(t\.live\) drawCardSave\(t\);/.test(body('finishAiCard')));
  check('7 UX-093: … shown only while the change is not saved (workSafety.cardAsksSave)', /var show = workSafety\.cardAsksSave\(\{ status: c\.t\.status, pageChanged: c\.t\.pageChanged, ptr: c\.t\.ptr, savedPtr: savedPtr \}, !!dirty\);/.test(body('syncCardSaves')) && /syncCardSaves\(dirty\);/.test(state));
  check('7 UX-093 (B04 verify): a save records the step it kept, before the cards are drawn again', /var keptPtr = undoPtr;/.test(save) && save.indexOf('var keptPtr = undoPtr;') > save.indexOf('var snap = undoStack[undoPtr]') &&
    /savedPtr = keptPtr;\s*renderSiteState\(\);/.test(save) && /var savedPtr = -1;/.test(SRC) && /t\.ptr = undoPtr;/.test(turn));
  // the read-back of one turn is replayTurn since ETB2B AI everywhere (B15): loadChatHistory hands each turn to it
  var history = body('replayTurn');
  check('7 UX-093: a read-back card whose Undo is gone says how to get back', /t\.button\.title = workSafety\.UNDO_GONE;/.test(history) && /t\.card\.note\(workSafety\.UNDO_GONE\);/.test(history) && !/Use Undo in the top bar\.'; \}/.test(history));
  /* the panel's two ways of "undo that" (the server's undo answer, and the one said without asking the AI) give the
     same reasons (undoWhyLine, B15) */
  check('7 UX-093: "undo that" explains in plain words instead of "I left it as it is."', /why === 'gone' \? workSafety\.UNDO_GONE\.replace\('Ask ETB2B AI to change it back', 'Ask me to change it back'\)/.test(body('undoWhyLine')) &&
    /no\.textContent = undoWhyLine\(last\);/.test(body('chatSend')) && /why: undoWhyLine\(last\)/.test(body('chatUndoLast')) &&
    !/if \(!ok\) reply\.textContent = 'I left it as it is\.';/.test(SRC));
  // the editor's welcome is ETB2B AI's panel's (editor-chat-client.js) since ETB2B AI everywhere (B15)
  check('7 UX-093: the welcome says to press Save', /Every change has an Undo\. Press Save to keep your changes; nothing goes live until you publish\./.test(fs.readFileSync(path.join(ROOT, 'editor-chat-client.js'), 'utf8')));

  var leave = body('leave');
  check('7 UX-073: leaving asks by workSafety.leaveAsk: Save and leave, Leave without saving, Stay', /workSafety\.leaveAsk\(\{ ai: aiState, saving: saving, dirty: !!eventId && !!canvas && hasUnsavedWork\(\) \}\)/.test(leave) &&
    /label: 'Save and leave'/.test(leave) && /label: 'Leave without saving'/.test(leave) && /label: 'Stay'/.test(leave) && /saveToStaging\(\{ quiet: true \}\)\.then\(go, function \(\) \{\}\)/.test(leave));
  check('7 UX-073 (B04 verify): what leaving asks about is the person\'s own work (hasUnsavedWork), while Save still sees a site never saved as unsaved',
    /workSafety\.unsavedWork\(\{ dirty: isDirty\(\) && !autoOnly\(\), savedVersion: siteInfo \? siteInfo\.savedVersion : baseVersion, edited: localEdited \}\)/.test(body('hasUnsavedWork')) &&
    /if \(!savedMark \|\| !siteInfo \|\| !siteInfo\.savedVersion\) return true;/.test(body('isDirty')) && /var dirty = isDirty\(\)/.test(state));
  check('7 UX-073: a save on its way is waited for, so this browser records the version', /\(savingNow \|\| Promise\.resolve\(\)\)\.then\(again, again\);/.test(leave));
  check('7 UX-073: leaving while ETB2B AI applies a change records the turn as not finished first', /stopAiTurn\(false\)\.then\(go, go\);/.test(leave) && /reportTurn\(t\.turnId, 'failed', \[\], \[STOPPED_LINE\], keepalive\)/.test(body('stopAiTurn')));
  var leaving = body('wireLeaving');
  check('7 UX-073: closing or reloading the tab is asked by the browser while work is unsaved, a save runs or ETB2B AI is busy',
    /addEventListener\('beforeunload'/.test(leaving) && /if \(aiState === 'ready' && !saving && !hasUnsavedWork\(\)\) return;/.test(leaving) && /e\.preventDefault\(\);/.test(leaving) && /if \(leavingNow/.test(leaving));
  check('7 UX-073: once reported as not finished, the change records and reports nothing more (requests cut off by leaving)',
    /t\.stopped = true;/.test(body('stopAiTurn')) && (body('runAiTurn').match(/if \(t\.stopped\) return t;/g) || []).length === 2);
  check('7 UX-073: … and a tab closed while ETB2B AI applies a change reports it (keepalive), recording nothing half-made', /if \(aiWorking\) \{ stopAiTurn\(true\); return; \}/.test(leaving));
  check('7 UX-073: the rail and Back to events go through leave()', /window\.RevampTemplateUI\.leave\(window\.RevampRail\.href\(section, editorEventId\)\)/.test(PAGE) && /window\.RevampTemplateUI\.leave\(this\.getAttribute\('href'\)\)/.test(PAGE));
  check('7 UX-073: reportTurn can be sent as the page goes', /if \(keepalive\) opts\.keepalive = true;/.test(body('reportTurn')));
})();

/* ======================= 8 ES5 ======================= */
(function () {
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still run */ }
  check('8 esbuild is there to check ES5', !!esbuild);
  if (!esbuild) return;
  [['editor-template-ui.js', SRC], ['editor-canvas.js', CANVAS], ['editor-ai-mode.js', AIMODE], ['editor-forms.js', fs.readFileSync(path.join(ROOT, 'editor-forms.js'), 'utf8')]].forEach(function (f) {
    var es5 = (function () { try { esbuild.transformSync(f[1], { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('8 ' + f[0] + ' is ES5 by esbuild', es5 === true, es5);
  });
})();

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
