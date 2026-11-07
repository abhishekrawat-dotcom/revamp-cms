// node functions/lib/publish-flow.test.js — one Publish for the console and the site editor (batch B06: UX-102, UX-103,
// UX-104, UX-105, UX-111, UX-112, UX-113). The readings of publish-flow.js run in a vm; how each page uses it is
// checked in its source, as the other editor and console tests do. No network, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); };
const FLOW = read('publish-flow.js');
const CONSOLE = read('edit-event.html');
const EDITOR = read('editor-template-ui.js');
const PAGE = read('custom_editor.html');
const CANVAS = read('editor-canvas.js');
const LIST = read('Event_Listing.html');
const REVIEW = read('review.html');

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}

const core = {};
const ctx = vm.createContext({ window: { RevampCore: core }, document: {}, console: console });
vm.runInContext(FLOW, ctx, { filename: 'publish-flow.js' });
const F = ctx.window.RevampPublishFlow;
const T = F._test;
check('0 it loads, and RevampCore.openPublishFlow is the flow', !!F && typeof core.openPublishFlow === 'function' && core.openPublishFlow === F.open);

/* ======================= 1 what Publish does (UX-105) ======================= */
function A(o) { return Object.assign({ savedVersion: 0, published: false, publishedVersion: 0, request: null, required: true }, o || {}); }
const pending = function (v) { return { status: 'pending', id: 'req1', toVersion: v, requestedBy: 'priya@x.in' }; };
check('1 never saved: "save the site first" (with the way to the editor), not an error', T.planOf(A()).kind === 'not-saved');
check('1 the live site already shows the last save: nothing new', T.planOf(A({ savedVersion: 6, published: true, publishedVersion: 6 })).kind === 'nothing-new');
check('1 a request already holds the newest save: it is shown, not sent again', T.planOf(A({ savedVersion: 7, published: true, publishedVersion: 6, request: pending(7) })).kind === 'waiting');
var upd = T.planOf(A({ savedVersion: 8, published: true, publishedVersion: 6, request: pending(7) }));
check('1 saved again after sending: the request is updated (UX-111)', upd.kind === 'ask' && upd.updates === 7 && upd.version === 8, upd);
check('1 something new, approval on: ask', T.planOf(A({ savedVersion: 3 })).kind === 'ask' && T.planOf(A({ savedVersion: 3 })).updates === 0);
check('1 approval switched off: publish (after one question)', T.planOf(A({ savedVersion: 3, required: false })).kind === 'direct');
check('1 approval switched off with an old request lying about: still publish', T.planOf(A({ savedVersion: 3, required: false, request: pending(3) })).kind === 'direct');
var ai = T.planOf(A({ savedVersion: 3 }), { aiUnchecked: 4 });
check('1 AI-written sections nobody checked (the console): to the editor\'s check first', ai.kind === 'ai-unchecked' && ai.count === 4, ai);
check('1 ...but only when there is something to send', T.planOf(A({ savedVersion: 6, published: true, publishedVersion: 6 }), { aiUnchecked: 4 }).kind === 'nothing-new');

/* ======================= 2 the button before the click (UX-105) ======================= */
var b = T.buttonState(A({ savedVersion: 6, published: true, publishedVersion: 6 }));
check('2 nothing new: "Live", quiet, and its title says why', b.label === 'Live' && b.quiet === true && /nothing new to publish/.test(b.title), b);
b = T.buttonState(A({ savedVersion: 6, published: true, publishedVersion: 6 }), { dirty: true });
check('2 unsaved changes are always something to send', b.label === 'Send for approval…' && !b.quiet && /Saves your changes first/.test(b.title), b);
b = T.buttonState(A({ savedVersion: 7, request: pending(7) }));
check('2 waiting: "Sent for approval", and a press shows the link', b.label === 'Sent for approval' && b.quiet && /link and who approves/.test(b.title), b);
check('2 approval needed: "Send for approval…"; switched off: "Publish…"', T.buttonState(A({ savedVersion: 2 })).label === 'Send for approval…' && T.buttonState(A({ savedVersion: 2, required: false })).label === 'Publish…');
check('2 not saved: the title says to save in the site editor', /Save the site in the site editor first/.test(T.buttonState(A()).title));
check('2 not known yet: the plain label', T.buttonState(null).label === 'Send for approval…');
check('2 AI sections unchecked: said in its title', /2 sections the AI wrote have not been checked/.test(T.buttonState(A({ savedVersion: 2 }), { aiUnchecked: 2 }).title));

/* a phone's top bar (B06 fix): "Send for approval…" pushed the console 30-100 px sideways at 360-600 px, so the button
   has a short word the CSS shows up to 600 px, and its name stays the full label */
check('2 a short word for the long labels only', T.buttonState(A({ savedVersion: 2 })).short === 'Send…' && T.buttonState(null).short === 'Send…' &&
  T.buttonState(A({ savedVersion: 6, published: true, publishedVersion: 6 }), { dirty: true }).short === 'Send…' &&
  T.buttonState(A({ savedVersion: 7, request: pending(7) })).short === 'Sent' &&
  T.buttonState(A({ savedVersion: 6, published: true, publishedVersion: 6 })).short === '' && T.buttonState(A({ savedVersion: 2, required: false })).short === '');
check('2 every short word is shorter than "Publish" (main\'s label, which fitted at 390 px)', ['Send…', 'Sent'].every(function (w) { return w.length < 'Publish'.length; }));
function fakeButton(text) {
  var attrs = {};
  return { textContent: text, title: '', disabled: false,
    setAttribute: function (k, v) { attrs[k] = String(v); }, getAttribute: function (k) { return attrs.hasOwnProperty(k) ? attrs[k] : null; },
    hasAttribute: function (k) { return attrs.hasOwnProperty(k); }, removeAttribute: function (k) { delete attrs[k]; }, attrs: attrs };
}
var styles = [];
var dctx = vm.createContext({ window: { RevampCore: {} }, console: console, document: {
  getElementById: function (id) { return styles.filter(function (st) { return st.id === id; })[0] || null; },
  createElement: function () { return {}; }, head: { appendChild: function (st) { styles.push(st); } } } });
vm.runInContext(FLOW, dctx, { filename: 'publish-flow.js' });
var DF = dctx.window.RevampPublishFlow;
var pb = fakeButton('Publish');
DF.paintButton(pb, DF.buttonState(A({ savedVersion: 2 })));
check('2 painted: the full label is its text and its name, the short word waits for a narrow bar', pb.textContent === 'Send for approval…' && pb.attrs['data-rvpf-short'] === 'Send…' && pb.attrs['aria-label'] === 'Send for approval…', pb.attrs);
check('2 ...and the rule that shows it comes with the first paint, before any press', styles.length === 1 && /@media \(max-width:600px\)\{\.btn\[data-rvpf-short\]:not\(\[aria-busy\]\)\{font-size:0/.test(styles[0].textContent) && /content:attr\(data-rvpf-short\)/.test(styles[0].textContent));
DF._test.setBusy({ opener: pb }, true);
check('2 busy: "Checking…" is what it says and what it is called, and the narrow bar shows it too (aria-busy)', pb.textContent === 'Checking…' && pb.attrs['aria-label'] === 'Checking…' && pb.attrs['aria-busy'] === 'true' && pb.disabled);
DF._test.setBusy({ opener: pb }, false);
check('2 done: back to the full label', pb.textContent === 'Send for approval…' && pb.attrs['aria-label'] === 'Send for approval…' && !pb.hasAttribute('aria-busy') && !pb.disabled);
DF.paintButton(pb, DF.buttonState(A({ savedVersion: 6, published: true, publishedVersion: 6 })));
check('2 a short label ("Live") has no short word and no extra name', pb.textContent === 'Live' && !pb.hasAttribute('data-rvpf-short') && !pb.hasAttribute('aria-label') && pb.attrs['aria-disabled'] === 'true');
check('2 the editor\'s own "Checking…" drops the full-label name too', /pub\.textContent = 'Checking…'; pub\.setAttribute\('aria-busy', 'true'\); pub\.removeAttribute\('aria-label'\);/.test(EDITOR));

/* ======================= 3 who to send it to (UX-102) ======================= */
var w = T.approverWords({ me: 'raj@x.in', approvers: ['Sachitanand.Rai@timesinternet.in'] });
check('3 the one approver is named', w.to === 'sachitanand.rai@timesinternet.in' && /^Send the link to sachitanand\.rai@timesinternet\.in: they approve changes\.$/.test(w.line), w);
w = T.approverWords({ me: 'a@x.in', approvers: ['a@x.in', 'b@x.in', 'c@x.in'] });
check('3 never yourself (nobody approves their own changes)', w.to === 'b@x.in, c@x.in' && /b@x\.in or c@x\.in: any of them/.test(w.line), w);
w = T.approverWords({ me: 'a@x.in', approvers: ['a@x.in'] });
check('3 the only approver asking: told that another one is needed', w.alone === true && w.to === '' && /only approver/.test(w.line), w);
check('3 allowSelf: yourself too', T.approverWords({ me: 'a@x.in', approvers: ['a@x.in'], allowSelf: true }).to === 'a@x.in');
check('3 nobody named: anyone on the team (other than you)', /other than you/.test(T.approverWords({ me: 'a@x.in', approvers: [] }).line) && /^Anyone on the team can/.test(T.approverWords({ approvers: [], allowSelf: true }).line));
check('3 "Copy message" is ready to paste', T.copyMessage('Tech500 2026', 7, 'https://h/review.html?x') === 'Please review the changes to Tech500 2026 (version 7) before they go live: https://h/review.html?x');
check('3 the dialogs say EventSphere sends no e-mail, and never the old product names', /EventSphere does not e-mail approvers/.test(FLOW) && !/Oneworld|Revamp CMS/.test(FLOW.replace(/\/\*[\s\S]*?\*\//g, '')));

/* ======================= 4 the person who asked is told (UX-103) ======================= */
const NOW = Date.parse('2026-11-07T10:00:00Z');
function R(o) { return Object.assign({ id: 'r9', status: 'rejected', toVersion: 5, decidedBy: 'priya@x.in', decidedAt: '2026-11-06T10:00:00Z', decisionNote: 'Fix the date' }, o || {}); }
var n = T.decisionNotice({ me: 'raj@x.in', requests: [R()], published: true, publishedVersion: 4 }, { eventId: 'ev', now: NOW });
check('4 a rejection: who, which version, the reason, and what to do', n && n.tone === 'bad' && n.title === 'priya@x.in rejected version 5:' && /“Fix the date” Change what is asked, save, and send it for approval again\./.test(n.text) &&
  n.href === '/review.html?event=ev&request=r9' && n.link === 'Open the review', n);
check('4 never to the person who decided', T.decisionNotice({ me: 'PRIYA@x.in', requests: [R()] }, { now: NOW }) === null);
check('4 once dismissed, gone', T.decisionNotice({ me: 'raj@x.in', requests: [R()] }, { now: NOW, seen: function (id) { return id === 'r9'; } }) === null);
check('4 a request waiting is newer news: nothing', T.decisionNotice({ me: 'raj@x.in', request: { status: 'pending' }, requests: [R()] }, { now: NOW }) === null);
check('4 the live site has moved past the rejected version: nothing', T.decisionNotice({ me: 'raj@x.in', requests: [R()], published: true, publishedVersion: 5 }, { now: NOW }) === null);
n = T.decisionNotice({ me: 'raj@x.in', requests: [R({ status: 'approved', decisionNote: '' })], published: true, publishedVersion: 5 }, { eventId: 'ev', now: NOW });
check('4 an approval: "approved version 5. It is live now."', n && n.tone === 'ok' && n.title === 'priya@x.in approved version 5.' && n.text === 'It is live now.' && n.href === '/e/ev', n);
check('4 an approval older than a week is old news', T.decisionNotice({ me: 'r@x.in', requests: [R({ status: 'approved', decidedAt: '2026-10-20T10:00:00Z' })], published: true, publishedVersion: 5 }, { now: NOW }) === null);
check('4 an approval the live site has moved past: nothing', T.decisionNotice({ me: 'r@x.in', requests: [R({ status: 'approved' })], published: true, publishedVersion: 6 }, { now: NOW }) === null);
check('4 a rejection without a reason still says what to do', /^Change what is asked/.test(T.decisionNotice({ me: 'r@x.in', requests: [R({ decisionNote: '' })] }, { now: NOW }).text));
check('4 no requests: nothing', T.decisionNotice({}, {}) === null && T.decisionNotice(null, {}) === null);

/* ======================= 5 the AI count matches the server's ======================= */
const L = require('./approval-list');
const cases = [
  { nodes: ['<section data-rv-section="a" data-ai-generated="true"></section>', '<section data-rv-section="b"></section>'] },
  { nodes: ['<section class="is-hidden-sec" data-rv-section="a" data-ai-generated="true"></section>'] },
  { nodes: ['<section data-rv-section="a" title="x > y" data-ai-generated></section>', '<style data-ai-generated></style>'] },
  { nodes: ['<section data-rv-section="a"><div data-ai-generated="true"></div></section>'] }, null, {}
];
check('5 the console counts unchecked AI sections exactly as the server does', cases.every(function (c) { return T.aiUncheckedOf(c) === L.aiUncheckedOf(c); }), cases.map(function (c) { return [T.aiUncheckedOf(c), L.aiUncheckedOf(c)]; }));
check('5 server refusals: nothing-new and not-saved are states, approval-required asks', T.errorPlan({ code: 'nothing-to-publish' }) === 'nothing-new' && T.errorPlan({ code: 'site-not-saved' }) === 'not-saved' &&
  T.errorPlan({ code: 'approval-required' }) === 'ask' && T.errorPlan({ code: 'x' }) === 'show' && T.errorPlan(null) === 'show');
check('5 when and who before the number (UX-112)', /^The site as saved on \d+ \w+, \d+:\d\d [ap]m by p@x\.in \(version 4\)$/.test(T.savedLine({ savedAt: '2026-11-03T06:54:00Z', savedBy: 'p@x.in' }, 4)), T.savedLine({ savedAt: '2026-11-03T06:54:00Z', savedBy: 'p@x.in' }, 4));

/* a failed request in the dialogs is said the console's way (UX-008): never a server fault's own sentence */
core.errText = function (err) { return err.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'core:' + err.message; };
check('5 a server fault in a dialog: the console\'s words, not the server\'s', T.errText({ status: 500, message: 'Internal error: DEADLINE_EXCEEDED' }) === 'Something went wrong on our side. Please try again.');
check('5 a refusal with a status (and a refused session) goes through RevampCore.errText', T.errText({ status: 409, message: 'Taken' }) === 'core:Taken' && T.errText({ code: 'revamp/signed-out', status: 0, message: 'x' }) === 'core:x');
check('5 a refusal made in the page (no status) is said as it is', T.errText(new Error('The publish window could not load.')) === 'The publish window could not load.' && T.errText(null) === 'Please try again.');
delete core.errText;
check('5 without RevampCore.errText the message itself', T.errText({ status: 500, message: 'Saved but not sent' }) === 'Saved but not sent');

/* ======================= 6 the dialogs are real dialogs (UX-113) ======================= */
check('6 role=dialog, aria-modal, a labelled title', /role="dialog" aria-modal="true" aria-labelledby="rvpf-title"/.test(FLOW));
check('6 Escape closes (not while the server works), Tab stays inside, focus goes back', /e\.key === 'Escape'\) \{ if \(!busy\) close\(\);/.test(FLOW) && /f\[f\.length - 1\]\.focus\(\)/.test(FLOW) && /opener\.focus\(\)/.test(FLOW));
check('6 the result has Done, Copy link and Copy message, and the link is one calm line', /label: 'Done', kind: 'primary'/.test(FLOW) && /data-rvpf="copy-link">Copy link/.test(FLOW) && /label: 'Copy message'/.test(FLOW) &&
  /\.rvpf-link input\{[^}]*color:var\(--text\)[^}]*font-weight:500/.test(FLOW) && !/font-mono|monospace/.test(T.CSS));
check('6 sending shows it is busy, and the button cannot be pressed twice', /d\.busy\(true, 'send', 'Sending…'\)/.test(FLOW) && /if \(RUNNING\) return RUNNING;/.test(FLOW));
check('6 nothing navigates away', !/location\.href\s*=/.test(FLOW));

/* ======================= 7 the console uses it (UX-105) ======================= */
const dp = CONSOLE.slice(CONSOLE.indexOf('  function doPublish(){'), CONSOLE.indexOf('  function paintPublishButton(){'));
check('7 console Publish is the shared flow, with the editor as the way to save or check the AI', /C\.openPublishFlow\(EV\.id, \{\s*from: 'console'/.test(dp) && /editorUrl: editorUrl\(\)/.test(dp));
check('7 ...and no longer jumps to the review page', !/location\.href = r\.reviewPath/.test(CONSOLE) && !/Opening the review page/.test(CONSOLE));
check('7 the header, Visibility and the Content bar all reach it', /\$\('btn-publish'\)\.onclick = doPublish;/.test(CONSOLE) && /if \(pub\) pub\.onclick = doPublish;/.test(CONSOLE) && /=== 'publish'\) doPublish\(\);/.test(CONSOLE));
check('7 the header button is painted from the state, before any press', /F\.paintButton\(btn, F\.buttonState\(a,/.test(CONSOLE) && /paintPublishButton\(\);\s*\/\* what became of the last request/.test(CONSOLE));
check('7 the decision line under the header (UX-103)', /<div id="ev-decision" hidden><\/div><div id="view"><\/div>/.test(CONSOLE) && /RevampPublishFlow\.paintDecision\(\$\('ev-decision'\), APPROVAL/.test(CONSOLE));
check('7 the script loads after edit-event-core.js on both pages', /edit-event-core\.js"><\/script>\s*<!--[^>]*-->\s*<script src="publish-flow\.js">/.test(CONSOLE) && /edit-event-core\.js"><\/script>\s*<!--[^>]*-->\s*<script src="publish-flow\.js">/.test(PAGE));
check('7 Visibility says Send for approval… like the header', /\(asks \? 'Send for approval…' : 'Publish…'\)/.test(CONSOLE));

/* ======================= 8 the editor uses it ======================= */
function body(src, name) {
  var at = src.indexOf('  function ' + name + '(');
  if (at === -1) return '';
  var end = src.indexOf('\n  }\n', at);
  return src.slice(at, end + 4);
}
const pub = body(EDITOR, 'publish');
check('8 the editor saves, then goes through the same flow', /saveToStaging\(\{ quiet: true \}\)/.test(pub) && /RevampCore\.openPublishFlow\(eventId, \{/.test(pub) && /from: 'editor'/.test(pub));
check('8 the logo unit\'s refusal still brings up the notice', /onError: function \(err\) \{ if \(err && err\.code === 'logo-unit-unanswered'\) \{ logoNoteRefused\(err\); return true; \}/.test(pub));
check('8 the old dialogs are gone (no focus, no Escape, red link)', !/function askApproval\(|function showPublished\(|function modal\(/.test(EDITOR) && !/\.modal-body \.url|\.apv-modal/.test(PAGE));
check('8 the busy state shows while it saves and asks', /publishBusy = true; renderSiteState\(\);/.test(pub) && /if \(publishBusy\) \{ pub\.textContent = 'Checking…';/.test(EDITOR));
const state = body(EDITOR, 'renderSiteState');
check('8 chip: plain words — Saved · not live yet, Live, Waiting for approval (UX-112)', /text = 'Saved · not live yet'/.test(state) && /text = 'Live'/.test(state) && /text = 'Waiting for approval'/.test(state) && !/staging/i.test(state.replace(/staged=1/g, '')));
check('8 chip: a newer save beside the request waiting, and that it is not in it (UX-111)', /pend && pend\.toVersion < v\) \{ kind = 'wait'; text = 'v' \+ v \+ ' saved · v' \+ pend\.toVersion \+ ' waiting'/.test(state) && /is not in the request yet: Send for approval adds it/.test(state));
check('8 chip: "Changes rejected", with the reason in its title (UX-103)', /kind = 'bad'; text = 'Changes rejected'/.test(state) && /last\.decisionNote/.test(state) && /\.site-state\.bad\{/.test(PAGE));
const save = body(EDITOR, 'saveToStaging');
check('8 a save while an older version waits offers "Add this save" (UX-111)', /if \(pend && pend\.toVersion < out\.version\)/.test(save) && /label: 'Add this save', onClick: function \(\) \{ publish\(\); \}/.test(save) && /still holds version/.test(save));
check('8 the save toast says "Saved (version N)" and "Open the saved site", not staging (UX-112)', /'Saved \(version ' \+ out\.version \+ '\)'/.test(save) && /label: 'Open the saved site'/.test(save) && !/Saved to staging|Open staging|staging already/.test(EDITOR));
check('8 the decision line under the editor\'s top bar (UX-103)', /<div id="pf-decision" hidden><\/div>/.test(PAGE) && /RevampPublishFlow\.paintDecision\(document\.getElementById\('pf-decision'\)/.test(EDITOR));

/* ======================= 9 the AI check asks only about what is new (UX-104) ======================= */
const handler = PAGE.slice(PAGE.indexOf("document.getElementById('btn-publish').addEventListener('click'"), PAGE.indexOf('  function publishOn(){'));
check('9 nothing new / already waiting is said before any list to tick', /publishPlan\(\)/.test(handler) && handler.indexOf('publishPlan') < handler.indexOf('logoUnitGate') && handler.indexOf('publishPlan') < handler.indexOf('placeholderGate'));
const gate = PAGE.slice(PAGE.indexOf('  function openAiPublishGate(onConfirmPublish){'), PAGE.indexOf('  /* ---------- save to staging ---------- */'));
check('9 the ticked sections are marked checked, so they are not asked about again', /UI\.markAiChecked\(checks\.map\(function\(c\)\{ return c\.getAttribute\('data-id'\); \}\)\);\s*onConfirmPublish\(\);/.test(gate));
check('9 Tick all, and Show beside each section', /id="ai-gate-all">Tick all</.test(gate) && /data-ai-gate-show="/.test(gate) && /UI\.showAiSection\(/.test(gate));
check('9 the words match the flow: "Check what the AI wrote", "Continue to send for approval"; no "goes live" promise', /Check what the AI wrote/.test(gate) && /'Continue to send for approval' : 'Continue to publish'/.test(gate) &&
  !/Publish site|keep editing after you go live|This draft was generated from your brief/.test(PAGE));
check('9 a real dialog: role, focus, Tab kept inside, Escape (UX-113)', /role="dialog" aria-modal="true" aria-labelledby="ai-gate-title"/.test(gate) && /e\.key === 'Escape'/.test(gate) && /e\.key !== 'Tab'/.test(gate) && /\(checks\[0\] \|\| confirmBtn\)\.focus\(\);/.test(gate));
const mark = body(EDITOR, 'markAiChecked');
check('9 marking checked is the person\'s own step, which Publish saves (so every browser and the console know)', /sec\.removeAttribute\('data-ai-generated'\)/.test(mark) && /if \(n\) commitNow\(\);/.test(mark));
check('9 a hidden section is not asked about', /return !sec\.classList\.contains\('is-hidden-sec'\);/.test(body(EDITOR, 'aiProvenanceSections')));
check('9 the AI switch draws the pills, and they are never saved or recorded', /if \(aiMarkersOn\) renderAiProvenanceBadges\(\);/.test(body(EDITOR, 'setAiMarkers')) &&
  /if \(aiMarkersOn\) renderAiProvenanceBadges\(\);/.test(body(EDITOR, 'pageChanged')) &&
  (body(EDITOR, 'renderAiProvenanceBadges').match(/data-rv-ai-mark/g) || []).length >= 3 && /var FORM_PREVIEW = '\[data-rv-form-preview\], \[data-rv-hv-preview\], \[data-rv-ai-mark\]';/.test(CANVAS));

/* ======================= 10 the approver sees what is waiting (UX-102) ======================= */
check('10 the dashboard keeps each event\'s waiting request', /approval: ev\.approval && typeof ev\.approval === 'object' && ev\.approval\.id \? ev\.approval : null,/.test(LIST));
check('10 a list of what is waiting, above the tabs, for approvers as theirs', /<section class="apv-waiting" id="apv-waiting"/.test(LIST) && /'Waiting for your approval' : 'Waiting for approval'/.test(LIST) && /renderWaiting\(\);/.test(LIST));
check('10 each such row and card says so, with Review', (LIST.match(/'<\/div>' \+ approvalBadgeHTML\(e\) \+ '<\/div>/g) || []).length === 2 && /Waiting for approval · Review<\/a>/.test(LIST));
check('10 a deleted event waits for nobody', /e\.approval && e\.status !== 'deleted'/.test(LIST));

/* ======================= 11 plain words on the review page (UX-112) ======================= */
check('11 no "staging" and no "first publication" on the review page', !/on staging|first publication/.test(REVIEW) && /First time live \(version/.test(REVIEW));

/* ======================= 12 changes named as a reader sees them (UX-112) ======================= */
const D = require('./page-diff');
function pg(body, style) { return '<!DOCTYPE html><html><body' + (style ? ' style="' + style + '"' : '') + '>' + body + '</body></html>'; }
var items = D.diffPages(pg('<section data-rv-section="previous-agenda"><p>a</p></section><section data-rv-section="hero" data-rv-key="hero-2"><h1>x</h1></section>'),
  pg('<section data-rv-section="previous-agenda"><p>b</p></section><section data-rv-section="hero" data-rv-key="hero-2"><h1>y</h1></section>'));
check('12 a section is named in words, not by its key', items.map(function (i) { return i.name; }).join('|') === 'Previous agenda|Hero 2', items);
var colours = D.diffPages(pg('<section data-rv-section="a"><p>x</p></section>', '--rv-theme-fill:#111111'), pg('<section data-rv-section="a"><p>x</p></section>', '--rv-theme-fill:#e02751'));
check('12 a colour kept in a CSS variable: "Site colours", "Theme fill colour", not the variable', colours.length === 1 && colours[0].name === 'Site colours' && colours[0].before === 'Theme fill colour: #111111' && colours[0].after === 'Theme fill colour: #e02751' && !/--rv/.test(JSON.stringify(colours)), colours);
var mixed = D.diffPages(pg('<section data-rv-section="a"><p>x</p></section>', '--theme-color:#111111'), pg('<section data-rv-section="a"><p>x</p></section>', '--theme-color:#222222;--rv-gap-size:12px'));
check('12 colours and other settings together: "Site design"', mixed[0].name === 'Site design' && /Gap size: 12px/.test(mixed[0].after), mixed);

/* ======================= 13 the editor's reading is out of date (B06 fix) ======================= */
/* siteInfo is read as the editor opens; a press that went round the sample-words and AI questions because it said
   "nothing new" or "waiting" must not send when the server has something to send after all */
check('13 the editor\'s press goes round its questions only with recheck, once', /function startPublish\(again\)\{/.test(handler) &&
  /if \(plan !== 'send'\)\{ window\.RevampTemplateUI\.publish\(again \? null : \{ recheck: function\(\)\{ startPublish\(true\); \} \}\); return; \}/.test(handler) &&
  /addEventListener\('click', function\(\)\{ startPublish\(false\); \}\);/.test(handler));
const pub2 = body(EDITOR, 'publish');
check('13 the editor hands recheck to the flow, takes the fresh reading and starts the press again', /recheck: typeof o\.recheck === 'function'/.test(pub2) &&
  /if \(out && out\.kind === 'recheck'\) \{ takeApproval\(out\.approval\); renderSiteState\(\); o\.recheck\(\); \}/.test(pub2));
check('13 one reading of fetchApproval for the editor (opening and recheck)', /return asked\.then\(takeApproval,/.test(EDITOR) && /function takeApproval\(a\) \{\s*siteInfo = \{/.test(EDITOR));

function flowWith(answer) {
  var calls = { request: 0, publish: 0, toasts: [] };
  var C = { fetchApproval: function () { return Promise.resolve(answer); }, fetchSite: function () { return Promise.resolve({}); },
    requestApproval: function () { calls.request++; return Promise.resolve({}); }, publishEvent: function () { calls.publish++; return Promise.resolve({}); } };
  var sty = [];
  var c = vm.createContext({ window: { RevampCore: C }, console: console, location: { origin: 'https://x' }, document: {
    getElementById: function (id) { return sty.filter(function (st) { return st.id === id; })[0] || null; },
    createElement: function () { return {}; }, head: { appendChild: function (st) { sty.push(st); } } } });
  vm.runInContext(FLOW, c, { filename: 'publish-flow.js' });
  return { open: c.window.RevampPublishFlow.open, calls: calls };
}
var asyncChecks = [];
(function () {
  var f = flowWith(A({ savedVersion: 3 }));
  asyncChecks.push(f.open('qa-ev', { from: 'editor', recheck: true, busy: function () {}, toast: function (t) { f.calls.toasts.push(t); } }).then(function (out) {
    check('13 something to send after all: the flow sends nothing and hands back the fresh reading', out.kind === 'recheck' && out.approval.savedVersion === 3 && f.calls.request === 0 && f.calls.publish === 0, out);
  }));
})();
(function () {
  var f = flowWith(A({ savedVersion: 3, required: false }));
  asyncChecks.push(f.open('qa-ev', { from: 'editor', recheck: true, busy: function () {} }).then(function (out) {
    check('13 ...with approval switched off too: nothing is published round the questions', out.kind === 'recheck' && f.calls.publish === 0, out);
  }));
})();
(function () {
  var f = flowWith(A({ savedVersion: 6, published: true, publishedVersion: 6 }));
  asyncChecks.push(f.open('qa-ev', { from: 'editor', recheck: true, busy: function () {}, toast: function (t) { f.calls.toasts.push(t); } }).then(function (out) {
    check('13 still nothing new: said as before, recheck changes nothing', out.kind === 'nothing-new' && /Nothing new to publish/.test(f.calls.toasts[0] || ''), out);
  }));
})();

Promise.all(asyncChecks).then(function () {
  console.log(failed ? 'publish-flow: ' + failed + ' FAILED, ' + passed + ' passed' : 'publish-flow: all ' + passed + ' checks passed');
  process.exitCode = failed ? 1 : 0;
}, function (err) { console.error('FAIL async checks threw', err); process.exitCode = 1; });
