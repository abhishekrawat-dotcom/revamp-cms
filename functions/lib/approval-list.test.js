// node functions/lib/approval-list.test.js — what GET /api/events says is waiting for approval (UX-102), and how many
// AI-written sections nobody has checked in a saved editor state (UX-104/UX-105). No network, no Firebase.
'use strict';
const L = require('./approval-list');

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}

/* ---- listApproval ---- */
const waiting = L.listApproval('ev-1', { approval: { id: 'abc123', toVersion: 7, requestedBy: 'priya@timesinternet.in', requestedAt: '2026-11-07T06:00:00.000Z', updatedAt: 'x' } });
check('1 a waiting request: its id, version, who and when, and the review page', waiting && waiting.id === 'abc123' && waiting.toVersion === 7 &&
  waiting.requestedBy === 'priya@timesinternet.in' && waiting.requestedAt === '2026-11-07T06:00:00.000Z' &&
  waiting.reviewPath === '/review.html?event=ev-1&request=abc123', waiting);
check('1 only those fields (nothing else of the event doc goes to the list)', Object.keys(waiting).join() === 'id,toVersion,requestedBy,requestedAt,reviewPath', Object.keys(waiting));
check('1 nothing waiting: null', L.listApproval('ev-1', {}) === null && L.listApproval('ev-1', { approval: null }) === null);
check('1 a request without an id is no request', L.listApproval('ev-1', { approval: { toVersion: 3 } }) === null);
check('1 a deleted event waits for nobody', L.listApproval('ev-1', { deletedAt: '2026-11-01T00:00:00Z', approval: { id: 'abc123', toVersion: 2 } }) === null);
check('1 a value of the wrong shape is none', L.listApproval('ev-1', { approval: 'abc' }) === null && L.listApproval('ev-1', { approval: ['abc'] }) === null);
check('1 the event id is escaped in the link', L.listApproval('a b&c', { approval: { id: 'z9z9z9' } }).reviewPath === '/review.html?event=a%20b%26c&request=z9z9z9');
check('1 a version that is not a number is 0, a missing name is ""', (function () { var x = L.listApproval('e', { approval: { id: 'q1w2e3', toVersion: 'x' } }); return x.toVersion === 0 && x.requestedBy === '' && x.requestedAt === null; })());

/* ---- aiUncheckedOf ---- */
function snap(nodes) { return { v: 1, nodes: nodes }; }
const S = function (attrs, inner) { return '<section data-rv-section="s"' + attrs + '>' + (inner || '<h2>Hi</h2>') + '</section>'; };
check('2 counts the sections still marked as written by the AI', L.aiUncheckedOf(snap([S(' data-ai-generated="true"'), S(''), S(' data-rv-key="b" data-ai-generated="true"'), '<style data-rv-style="s"></style>'])) === 2);
check('2 a hidden section does not go live: not counted', L.aiUncheckedOf(snap([S(' class="x is-hidden-sec" data-ai-generated="true"'), S(" class='is-hidden-sec' data-ai-generated")])) === 0);
check('2 only the section\'s own tag counts: a mark further in, or in its text, is not one', L.aiUncheckedOf(snap([S('', '<div data-ai-generated="true">x</div><p>data-ai-generated</p>')])) === 0);
check('2 a style node or a header is never a section', L.aiUncheckedOf(snap(['<style data-ai-generated>x</style>', '<header data-ai-generated="true"></header>'])) === 0);
check('2 the attribute name must be whole (data-ai-generated-x is another)', L.aiUncheckedOf(snap([S(' data-ai-generated-x="1"')])) === 0);
check('2 a value with ">" inside quotes does not cut the tag short', L.aiUncheckedOf(snap(['<section data-rv-section="s" title="a > b" data-ai-generated="true"><h2>x</h2></section>'])) === 1);
check('2 no snapshot, or one of the wrong shape: 0', L.aiUncheckedOf(null) === 0 && L.aiUncheckedOf({}) === 0 && L.aiUncheckedOf({ nodes: 'x' }) === 0 && L.aiUncheckedOf(snap([null, 3])) === 0);

/* ---- the server uses them ---- */
const fs = require('fs'), path = require('path');
const API = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
check('3 GET /api/events reads the approval field and lists it on every event', /'portal', 'approval'\];/.test(API) && /approval: approvalList\.listApproval\(id, d\),/.test(API));
check('3 a save keeps how many AI sections are unchecked, a new version and a kept state alike',
  (API.match(/aiUnchecked: approvalList\.aiUncheckedOf\(body\.snapshot\)/g) || []).length === 2);
check('3 GET /api/event/approval says it, and when and by whom the site was saved',
  /aiUnchecked: data\.site && typeof data\.site\.aiUnchecked === 'number' \? data\.site\.aiUnchecked : null,/.test(API) && /savedAt: \(data\.site && data\.site\.updatedAt\) \|\| null, savedBy:/.test(API));
check('3 the requests list carries each decision\'s reason (UX-103)', /decidedAt: v\.decidedAt \|\| null, decisionNote: v\.decisionNote \|\| '' \}/.test(API));

console.log(failed ? 'approval-list: ' + failed + ' FAILED, ' + passed + ' passed' : 'approval-list: all ' + passed + ' checks passed');
process.exitCode = failed ? 1 : 0;
