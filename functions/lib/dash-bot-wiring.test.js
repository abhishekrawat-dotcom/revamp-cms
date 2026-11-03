/* node functions/lib/dash-bot-wiring.test.js — how ETB2B AI on the events dashboard is wired into lib/api.js, and the
   shared pieces it is built on (plan ~/.revamp-cms-qa/dash-bot/plan.md, Unit B: §3, K2, K3, K5):
     B.1  the 'dash-bot' model profile, as lib/llm.js hands it to Claude (and CLAUDE_MODEL_DASH_BOT overriding it);
     B.2  POST /api/dash-bot, POST /api/dash-bot/turn and GET /api/dash-bot/history reach lib/dash-bot.js, which is
          handed this file's real helpers (every K3 name) before each call, and is loaded only when used;
     B.3  a bot module that is missing, cannot be wired or lacks a handler costs only its own three routes a 503;
     B.4  GET /api/events answers byte for byte what it answered before liveEventDocs() was taken out of it (the
          two bodies below were captured from lib/api.js at dc1a8e1 on this very fixture), and liveEventDocs()
          gives the same events, in the same order, with the raw counters (audienceV kept) and nothing else;
     B.5  lib/api-audience.js exports insightTotals and conversionOf for the bot.
   lib/dash-bot.js is a stub here (Unit A writes the real one in parallel), and so is Firebase. No network, no AI.
   Exits 1 on any failure. */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
var ROOT = path.resolve(__dirname, '..', '..');
delete process.env.K_SERVICE;
['LLM_PROVIDER', 'CLAUDE_MODEL', 'CLAUDE_MODEL_DASH_BOT'].forEach(function (k) { delete process.env[k]; });
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

/* ---------- Firebase: an in-memory Firestore whose events query keeps select() (a real projection: only the named
   fields come back) and limit(), and records both; values are kept as they are, so a Timestamp keeps its toDate() ---------- */
function ts(iso) { var d = new Date(iso); return { toDate: function () { return new Date(d.getTime()); }, _seconds: Math.floor(d.getTime() / 1000), _nanoseconds: 0 }; }
var EVENTS = {
  /* live, published, an AI-era event: every listed field, raw counters with audienceV, and a whole generated site
     the list must never download */
  'autotech-2026': { name: 'Autotech Summit 2026', category: 'IP', status: 'draft', start: '2026-11-20T04:30:00.000Z', end: '2026-11-21T12:30:00.000Z',
    dateLabel: '20–21 Nov 2026', dateMode: 'exact', venue: 'Jio World Centre', city: 'Mumbai', client: '', templateId: 'tech500',
    logoUrl: 'https://cdn.example/autotech.png', createdAt: '2026-10-01T10:00:00.000Z', createdBy: 'asha@timesinternet.in',
    updatedAt: '2026-11-02T09:00:00.000Z', updatedBy: 'asha@timesinternet.in', published: true, publishedAt: ts('2026-10-20T06:00:00.000Z'),
    publishedVersion: 3, counters: { registrations: 42, views: 900, audienceV: 2, uniques: 300, mobile: 120, desktop: 180 },
    site: { version: 4, templateId: 'tech500', updatedAt: '2026-11-02T09:00:00.000Z', updatedBy: 'asha@timesinternet.in', snapshotVersion: 9 },
    generatedSections: { hero: { html: '<section>' + 'x'.repeat(2000) + '</section>' } }, siteLock: { token: 'secret', at: 1 }, slug: 'ignored' },
  /* live, never published, an older event: no audienceV, a Timestamp for updatedAt, a logo address that is not one,
     a generated site but no saved one, a non-numeric counter */
  'legacy-forum': { name: 'Legacy Forum', category: 'Client', status: 'live', start: '2025-03-01', end: null, dateLabel: '', dateMode: 'exact',
    venue: 'Taj Lands End', city: 'Mumbai', client: 'Acme', templateId: '', logoUrl: 'javascript:alert(1)',
    createdAt: ts('2025-01-05T05:00:00.000Z'), createdBy: 'bob@timesinternet.in', updatedAt: ts('2026-10-30T08:00:00.000Z'),
    published: false, counters: { views: 310, registrations: 'many' }, generatedAt: '2025-01-06T00:00:00.000Z' },
  /* live with no updatedAt at all: sorted by its createdAt (here in the raw { _seconds } form, 20 Oct), so it sits between
     the events changed on 30 Oct and on 15 Oct, no counters, no status,
     a site path logo, numbers where strings belong */
  'no-updated': { name: 'No Updated Yet', category: 'Awards', createdAt: { _seconds: 1792454400, _nanoseconds: 0 }, logoUrl: '/assets/a.png',
    venue: 42, city: null, site: { version: 0 }, published: 'true', publishedVersion: '2' },
  /* two events changed at the same moment: the id decides */
  'tie-b': { name: 'Tie B', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', logoUrl: '//evil.example/x.png' },
  'tie-a': { name: 'Tie A', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', counters: [1, 2] },
  /* deleted: only in ?deleted=1, newest-DELETED first (Gone Older was changed later but deleted earlier); a Date and a string */
  'gone': { name: 'Gone Event', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z', published: true,
    deletedAt: '2026-10-21T00:00:00.000Z', deletedBy: 'bob@timesinternet.in', counters: { registrations: 5, views: 7 } },
  'gone-older': { name: 'Gone Older', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z', deletedAt: new Date('2026-09-01T00:00:00.000Z'), deletedBy: 'asha@timesinternet.in' },
  'gone-nameless': { name: '', createdAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-10-25T00:00:00.000Z' },
  /* never listed: a shell (no createdAt), an import's staging record, a draft being discarded, nameless and non-string names */
  'shell-doc': { name: 'Shell', updatedAt: '2026-11-03T00:00:00.000Z', designPlan: { x: 1 } },
  'import-abc123': { name: 'Imported page', status: 'importing', updatedAt: '2026-11-03T00:00:00.000Z' },
  'discarding': { name: 'Being Discarded', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-03T01:00:00.000Z', discardingAt: '2026-11-03T01:00:00.000Z' },
  'nameless': { name: '   ', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-03T02:00:00.000Z' },
  'number-name': { name: 2026, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-03T03:00:00.000Z' }
};
var queries = [];
function eventsQuery(fields, lim) {
  return {
    select: function () { return eventsQuery(Array.prototype.slice.call(arguments), lim); },
    limit: function (n) { return eventsQuery(fields, n); },
    get: function () {
      queries.push({ fields: fields, limit: lim });
      var ids = Object.keys(EVENTS);
      if (lim) ids = ids.slice(0, lim);
      return Promise.resolve({ docs: ids.map(function (id) {
        var all = EVENTS[id], data = {};
        Object.keys(all).forEach(function (k) { if (!fields || fields.indexOf(k) !== -1) data[k] = all[k]; });
        return { id: id, exists: true, data: function () { return Object.assign({}, data); }, get: function (k) { return data[k]; } };
      }) });
    }
  };
}
var CONFIG = {};
var FB = { db: { collection: function (name) {
  if (name === 'events') return eventsQuery(null, 0);
  return { doc: function (id) { return { get: function () { var d = CONFIG[name + '/' + id]; return Promise.resolve({ id: id, exists: !!d, data: function () { return d; } }); } }; } };
} }, bucket: { name: 'test-bucket' },
  auth: { verifyIdToken: function (t) {
    if (t === 'expired') return Promise.reject(new Error('expired'));
    return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, name: t === 'asha' ? 'Asha Rao' : '', email_verified: true, firebase: { sign_in_provider: 'google.com' } });
  } } };

/* GET /api/events at dc1a8e1 on the fixture above, captured from that commit's lib/api.js before the refactor: the
   list's answer must not change by one byte. (When the portals branch adds portal / portalName to each item, these
   copies gain those two fields and nothing else.) */
var EXPECTED_LIVE = { items: [
  {"id":"autotech-2026","eventId":"autotech-2026","slug":"autotech-2026","name":"Autotech Summit 2026","category":"IP","status":"draft","start":"2026-11-20T04:30:00.000Z","end":"2026-11-21T12:30:00.000Z","dateLabel":"20–21 Nov 2026","dateMode":"exact","venue":"Jio World Centre","city":"Mumbai","client":"","templateId":"tech500","logoUrl":"https://cdn.example/autotech.png","createdAt":"2026-10-01T10:00:00.000Z","createdBy":"asha@timesinternet.in","updatedAt":"2026-11-02T09:00:00.000Z","updatedBy":"asha@timesinternet.in","published":true,"publishedAt":"2026-10-20T06:00:00.000Z","publishedPath":"/e/autotech-2026","publishedVersion":3,"counters":{"registrations":42,"views":900},"site":{"version":4,"templateId":"tech500","updatedAt":"2026-11-02T09:00:00.000Z","updatedBy":"asha@timesinternet.in"},"hasGeneratedSite":false,"payment":{"type":"free"},"hasSite":true},
  {"id":"legacy-forum","eventId":"legacy-forum","slug":"legacy-forum","name":"Legacy Forum","category":"Client","status":"live","start":"2025-03-01","end":null,"dateLabel":"","dateMode":"exact","venue":"Taj Lands End","city":"Mumbai","client":"Acme","templateId":null,"logoUrl":"","createdAt":"2025-01-05T05:00:00.000Z","createdBy":"bob@timesinternet.in","updatedAt":"2026-10-30T08:00:00.000Z","updatedBy":"","published":false,"publishedAt":null,"publishedPath":null,"publishedVersion":0,"counters":{"registrations":0,"views":310},"site":null,"hasGeneratedSite":true,"payment":{"type":"free"},"hasSite":true},
  {"id":"no-updated","eventId":"no-updated","slug":"no-updated","name":"No Updated Yet","category":"Awards","status":"draft","start":null,"end":null,"dateLabel":"","dateMode":"","venue":"","city":"","client":"","templateId":null,"logoUrl":"/assets/a.png","createdAt":"2026-10-20T00:00:00.000Z","createdBy":"","updatedAt":"2026-10-20T00:00:00.000Z","updatedBy":"","published":false,"publishedAt":null,"publishedPath":null,"publishedVersion":2,"counters":{"registrations":0,"views":0},"site":{"version":0,"templateId":null,"updatedAt":null,"updatedBy":null},"hasGeneratedSite":false,"payment":{"type":"free"},"hasSite":false},
  {"id":"tie-a","eventId":"tie-a","slug":"tie-a","name":"Tie A","category":"","status":"draft","start":null,"end":null,"dateLabel":"","dateMode":"","venue":"","city":"","client":"","templateId":null,"logoUrl":"","createdAt":"2026-09-01T00:00:00.000Z","createdBy":"","updatedAt":"2026-10-15T00:00:00.000Z","updatedBy":"","published":false,"publishedAt":null,"publishedPath":null,"publishedVersion":0,"counters":{"registrations":0,"views":0},"site":null,"hasGeneratedSite":false,"payment":{"type":"free"},"hasSite":false},
  {"id":"tie-b","eventId":"tie-b","slug":"tie-b","name":"Tie B","category":"","status":"draft","start":null,"end":null,"dateLabel":"","dateMode":"","venue":"","city":"","client":"","templateId":null,"logoUrl":"","createdAt":"2026-09-01T00:00:00.000Z","createdBy":"","updatedAt":"2026-10-15T00:00:00.000Z","updatedBy":"","published":false,"publishedAt":null,"publishedPath":null,"publishedVersion":0,"counters":{"registrations":0,"views":0},"site":null,"hasGeneratedSite":false,"payment":{"type":"free"},"hasSite":false}
] };
var EXPECTED_DELETED = { items: [
  {"id":"gone","eventId":"gone","slug":"gone","name":"Gone Event","category":"","status":"draft","start":null,"end":null,"dateLabel":"","dateMode":"","venue":"","city":"","client":"","templateId":null,"logoUrl":"","createdAt":"2026-01-01T00:00:00.000Z","createdBy":"","updatedAt":"2026-10-21T00:00:00.000Z","updatedBy":"","published":true,"publishedAt":null,"publishedPath":null,"publishedVersion":0,"counters":{"registrations":5,"views":7},"site":null,"hasGeneratedSite":false,"payment":{"type":"free"},"hasSite":false,"deletedAt":"2026-10-21T00:00:00.000Z","deletedBy":"bob@timesinternet.in"},
  {"id":"gone-older","eventId":"gone-older","slug":"gone-older","name":"Gone Older","category":"","status":"draft","start":null,"end":null,"dateLabel":"","dateMode":"","venue":"","city":"","client":"","templateId":null,"logoUrl":"","createdAt":"2026-01-01T00:00:00.000Z","createdBy":"","updatedAt":"2026-10-30T00:00:00.000Z","updatedBy":"","published":false,"publishedAt":null,"publishedPath":null,"publishedVersion":0,"counters":{"registrations":0,"views":0},"site":null,"hasGeneratedSite":false,"payment":{"type":"free"},"hasSite":false,"deletedAt":"2026-09-01T00:00:00.000Z","deletedBy":"asha@timesinternet.in"}
] };

/* the fields the list reads at dc1a8e1, in that order: a projection, so a whole generated site is never downloaded */
var LIST_FIELDS_AT_DC1A8E1 = ['name', 'category', 'status', 'start', 'end', 'dateLabel', 'dateMode', 'venue', 'city', 'client',
  'templateId', 'logoUrl', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'published', 'publishedAt',
  'publishedVersion', 'counters', 'site', 'generatedAt', 'deletedAt', 'deletedBy', 'discardingAt'];

require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true,
  exports: { getFirebase: function () { return FB; } } };

/* ---------- Claude, recorded in place of the real call (lib/llm.js takes these two at load, so they are set first) ---------- */
var claude = require('./claude');
var claudeSeen = [];
claude.claudeConfigured = function () { return true; };
claude.callClaudeJson = function (prompt, schema, opts) { claudeSeen.push(opts); return Promise.resolve({ parsed: { kind: 'reply', text: 'stub' }, provider: 'claude', model: opts.model }); };

/* ---------- lib/dash-bot.js: a recorder with the contract's exports (K4), resolved in place of the real file ---------- */
var K3 = ['withAdmin', 'withAdminBody', 'sendJson', 'sendFailure', 'sendAiFailure', 'httpError', 'BODY_LIMITS', 'chatRateOk', 'chatUid',
  'chatName', 'approvalsConfig', 'liveEventDocs', 'eventListItem', 'isEventId'];
var FAIL_LOAD = false, WIRE_THROWS = false, resolves = 0, calls = [], H = null;
function stubBot() {
  return {
    wire: function (h) { calls.push({ fn: 'wire', helpers: h }); if (WIRE_THROWS) throw new Error('stub: wire failed'); H = h; },
    /* each handler answers through the helpers it was handed, so a wrong or missing helper shows here */
    handleChat: function (req, res) {
      calls.push({ fn: 'handleChat', method: req.method, url: req.url });
      H.withAdminBody(req, res, H.BODY_LIMITS.small, function (fb, decoded, body) {
        calls.push({ fn: 'handleChat:in' });
        H.sendJson(res, 200, { fn: 'handleChat', uid: H.chatUid(decoded), name: H.chatName(decoded), body: body, sameFb: fb === FB });
      });
    },
    handleTurn: function (req, res) {
      calls.push({ fn: 'handleTurn', method: req.method, url: req.url });
      H.withAdminBody(req, res, H.BODY_LIMITS.tiny, function (fb, decoded, body) {
        calls.push({ fn: 'handleTurn:in' });
        H.sendJson(res, 200, { fn: 'handleTurn', uid: H.chatUid(decoded), body: body });
      });
    },
    handleHistory: function (req, res) {
      calls.push({ fn: 'handleHistory', method: req.method, url: req.url });
      H.withAdmin(req, res, function (fb, decoded) {
        calls.push({ fn: 'handleHistory:in' });
        H.sendJson(res, 200, { fn: 'handleHistory', url: req.url, uid: H.chatUid(decoded) });
      });
    },
    _test: {}
  };
}
var STUB = path.join(__dirname, '__stub-dash-bot.js'), realResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === './dash-bot') { resolves++; if (FAIL_LOAD) throw new Error('stub: cannot load lib/dash-bot.js'); return STUB; }
  return realResolve.apply(this, arguments);
};
function setBot(exportsObj) { require.cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: exportsObj }; }
setBot(stubBot());

const http = require('./http');
const access = require('./access');
const llm = require('./llm');
const api = require('./api');

/* one request through api.handleApi; resolves { status, headers, text, body (parsed JSON or null) } */
function call(method, url, body, who, raw) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (who !== null) headers.authorization = 'Bearer ' + (who || 'asha');
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: raw || Buffer.from(body === undefined ? '' : JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k] = v; }, getHeader: function (k) { return res.headers[k]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b === undefined ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, text: t, body: j }); } };
    api.handleApi(req, res);
  });
}
function names() { return calls.map(function (c) { return c.fn; }).join(','); }
/* console.error, held for one step (an expected failure is logged; the test's own output stays readable) */
var realError = console.error, logged = [];
function quiet() { logged = []; console.error = function () { logged.push(Array.prototype.join.call(arguments, ' ')); }; }
function loud() { console.error = realError; }
function fakeRes() {
  var r = { statusCode: 0, headers: {}, headersSent: false, text: '',
    writeHead: function (s, h) { r.statusCode = s; Object.assign(r.headers, h || {}); r.headersSent = true; return r; },
    setHeader: function () {}, end: function (b) { r.text = b === undefined ? '' : String(b); } };
  return r;
}

(async function () {
  /* ======== B.1 the model profile, as Claude is asked ======== */
  var P = llm.PROFILES['dash-bot'];
  ok(P && P.model === claude.CLAUDE_HAIKU && P.effort === 'low' && P.timeoutMs === 45000 && P.maxOutputTokens === 6000,
    'B.1 PROFILES[\'dash-bot\'] is Haiku, effort low, 45 s, 6,000 output tokens', P);
  var deadline = Date.now() + 55000;
  var r1 = await llm.callJson('prompt', { type: 'OBJECT', properties: { kind: { type: 'STRING' } } }, { route: 'dash-bot', deadlineAt: deadline, timeoutMs: 40000, maxOutputTokens: 6000 });
  var seen = claudeSeen[0] || {};
  ok(r1.provider === 'claude' && seen.model === claude.CLAUDE_HAIKU && seen.effort === 'low' && seen.timeoutMs === 45000 && seen.maxOutputTokens === 6000 && seen.deadlineAt === deadline && seen.route === 'dash-bot',
    'B.1 a dash-bot call reaches Claude on that profile, inside the route\'s own deadline', seen);
  process.env.CLAUDE_MODEL_DASH_BOT = claude.CLAUDE_SONNET;
  await llm.callJson('prompt', { type: 'OBJECT', properties: {} }, { route: 'dash-bot', deadlineAt: Date.now() + 55000 });
  ok((claudeSeen[1] || {}).model === claude.CLAUDE_SONNET, 'B.1 CLAUDE_MODEL_DASH_BOT moves the route to another model without a deploy (the QA gate\'s switch)', claudeSeen[1]);
  delete process.env.CLAUDE_MODEL_DASH_BOT;
  ok(llm.describeModels().text.indexOf(claude.CLAUDE_HAIKU) !== -1, 'B.1 the models the tools print include Haiku');

  /* ======== B.2 the three routes reach lib/dash-bot.js, wired first with the real helpers ======== */
  ok(resolves === 0 && calls.length === 0, 'B.2 loading lib/api.js does not load lib/dash-bot.js (it is loaded on use, never at the top)', resolves);

  calls = [];
  var c = await call('POST', '/api/dash-bot', { message: 'Show drafts from last week', view: { tab: 'active' } });
  ok(c.status === 200 && c.body && c.body.fn === 'handleChat' && names() === 'wire,handleChat,handleChat:in',
    'B.2 POST /api/dash-bot reaches handleChat, after wire()', c.status + ' ' + names());
  ok(c.body && c.body.uid === 'u-asha' && c.body.name === 'Asha Rao' && c.body.body.message === 'Show drafts from last week' && c.body.sameFb === true,
    'B.2 … signed in through withAdminBody: the person (chatUid / chatName), the body and the same Firebase', c.body);
  ok(c.headers['Cache-Control'] === 'no-store' && /application\/json/.test(c.headers['Content-Type']), 'B.2 … answered as JSON, never cached', c.headers);

  var h = calls[0] && calls[0].helpers;
  ok(!!h && Object.keys(h).sort().join() === K3.slice().sort().join(), 'B.2 wire() is handed exactly the K3 helpers', h && Object.keys(h));
  ok(!!h && K3.every(function (k) { return k === 'BODY_LIMITS' ? h[k] && typeof h[k] === 'object' : typeof h[k] === 'function'; }), 'B.2 … each a function (BODY_LIMITS an object)');
  ok(!!h && h.BODY_LIMITS.small === 256 * 1024 && h.BODY_LIMITS.tiny === 16 * 1024, 'B.2 BODY_LIMITS: small 256 KB (a message and a view), tiny 16 KB (a turn report)', h && h.BODY_LIMITS);
  ok(!!h && h.sendJson === http.sendJson && h.isEventId === http.isEventId, 'B.2 sendJson and isEventId are lib/http.js\'s own');
  ok(!!h && h.chatRateOk === api._testHooks.chatRateOk, 'B.2 chatRateOk is the editor chat\'s own: one rate bucket for both chats');
  /* each helper is the real one: a missing or broken one fails its own check here instead of crashing the run */
  function safe(fn) { try { return fn(); } catch (e) { return 'threw: ' + e.message; } }
  h = h || {};
  ok(safe(function () { return h.isEventId('autotech-2026') === true && h.isEventId('a/b') === false; }) === true, 'B.2 isEventId tells an event id from a path');
  ok(safe(function () { return h.chatUid({ uid: 'u-1', email: 'a@timesinternet.in' }) === 'u-1' && h.chatUid({ email: 'a@timesinternet.in' }) === 'a@timesinternet.in' && h.chatUid(null) === 'anon'; }) === true,
    'B.2 chatUid: the uid, else the email');
  ok(safe(function () { return h.chatName({ name: 'Asha Rao', email: 'a@x' }) === 'Asha Rao' && h.chatName({ email: 'a@x' }) === 'a@x' && h.chatName({}) === 'Someone'; }) === true, 'B.2 chatName: the Google name, else the email');
  var e429 = safe(function () { return h.httpError(429, 'Too many.', { code: 'dash-bot-daily' }); });
  ok(!!e429 && e429.status === 429 && e429.body.error === 'Too many.' && e429.body.code === 'dash-bot-daily', 'B.2 httpError carries its status and body', e429 && (e429.body || e429));
  var fr = fakeRes();
  safe(function () { h.sendFailure(fr, 'dash bot', e429); });
  ok(fr.statusCode === 429 && safe(function () { return JSON.parse(fr.text).code; }) === 'dash-bot-daily', 'B.2 sendFailure answers an httpError as written', fr.text);
  fr = fakeRes();
  safe(function () { h.sendAiFailure(fr, { status: 504, error: 'ETB2B AI took too long.', code: 'ai-timeout', retryable: true, timeoutMs: 45000 }); });
  ok(fr.statusCode === 504 && fr.text === JSON.stringify({ error: 'ETB2B AI took too long.', code: 'ai-timeout', retryable: true, timeoutMs: 45000 }), 'B.2 sendAiFailure answers { error, code, retryable, timeoutMs }', fr.text);
  async function approvers() { try { return (await h.approvalsConfig(FB)).approvers; } catch (e) { return 'threw: ' + e.message; } }
  CONFIG['config/approvals'] = { approvers: ['Lead@TimesInternet.in', 'not an email', ''], allowSelf: false };
  var cfg = await approvers();
  ok(JSON.stringify(cfg) === '["lead@timesinternet.in"]', 'B.2 approvalsConfig reads config/approvals (who may read everyone\'s chats)', cfg);
  delete CONFIG['config/approvals'];
  cfg = await approvers();
  ok(Array.isArray(cfg) && cfg.length === 0, 'B.2 … no approvers named: an empty list (so ?all=1 is refused to everybody)', cfg);

  calls = [];
  c = await call('POST', '/api/dash-bot/turn', { turnId: 'abcdefghij12', status: 'undone' });
  ok(c.status === 200 && c.body && c.body.fn === 'handleTurn' && c.body.body.status === 'undone' && names() === 'wire,handleTurn,handleTurn:in',
    'B.2 POST /api/dash-bot/turn reaches handleTurn, after wire()', c.status + ' ' + names());
  ok(!!calls[0] && !!calls[0].helpers && calls[0].helpers !== h && Object.keys(calls[0].helpers).join() === Object.keys(h).join(), 'B.2 … handed a fresh helpers object on every call');

  calls = [];
  c = await call('GET', '/api/dash-bot/history?all=1&uid=u-bob', undefined, 'bob');
  ok(c.status === 200 && c.body && c.body.fn === 'handleHistory' && c.body.url === '/api/dash-bot/history?all=1&uid=u-bob' && c.body.uid === 'u-bob' && names() === 'wire,handleHistory,handleHistory:in',
    'B.2 GET /api/dash-bot/history reaches handleHistory with its query intact, after wire()', c.status + ' ' + names() + ' ' + (c.body && c.body.url));

  /* the sign-in is the helpers' own: signed out, expired, or another company's account never gets past it */
  calls = [];
  c = await call('POST', '/api/dash-bot', { message: 'hi' }, null);
  ok(c.status === 401 && names() === 'wire,handleChat', 'B.2 signed out: 401 from withAdminBody, and the handler\'s body never runs', c.status + ' ' + names());
  calls = [];
  c = await call('GET', '/api/dash-bot/history', undefined, 'expired');
  ok(c.status === 401 && names() === 'wire,handleHistory', 'B.2 an expired sign-in: 401', c.status + ' ' + names());
  var realVerify = FB.auth.verifyIdToken;
  FB.auth.verifyIdToken = function () { return Promise.resolve({ email: 'x@gmail.com', uid: 'u-x', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); };
  calls = [];
  c = await call('POST', '/api/dash-bot/turn', { turnId: 'abcdefghij12', status: 'done' });
  FB.auth.verifyIdToken = realVerify;
  ok(c.status === 403 && names() === 'wire,handleTurn', 'B.2 an account outside the company: 403', c.status + ' ' + names());
  calls = [];
  c = await call('POST', '/api/dash-bot', undefined, 'asha', Buffer.alloc(256 * 1024 + 1, 32));
  ok(c.status === 413 && names() === 'wire,handleChat', 'B.2 a body over 256 KB: 413 before anything is read', c.status + ' ' + names());

  /* only the three: other methods and nearby paths are not routes */
  calls = []; resolves = 0;
  var wrong = [['GET', '/api/dash-bot'], ['PUT', '/api/dash-bot/turn'], ['POST', '/api/dash-bot/history'], ['DELETE', '/api/dash-bot'], ['POST', '/api/dash-bot/'], ['POST', '/api/dash-bot/chat']];
  for (var i = 0; i < wrong.length; i++) {
    c = await call(wrong[i][0], wrong[i][1], {});
    ok(c.status === 404 && /No such endpoint/.test(c.body && c.body.error), 'B.2 ' + wrong[i].join(' ') + ' is not a route (404)', c.status);
  }
  ok(calls.length === 0 && resolves === 0, 'B.2 … and none of them loads the bot', names());
  ['/api/dash-bot', '/api/dash-bot/turn', '/api/dash-bot/history'].forEach(function (p) {
    ok(access.isPublic({ method: 'POST' }, p) === false, 'B.2 ' + p + ' is behind the sign-in gate (lib/access.js)');
  });

  /* ======== B.3 a bot that cannot run costs only its own routes a 503 ======== */
  var ROUTES3 = [['POST', '/api/dash-bot', { message: 'hi' }], ['POST', '/api/dash-bot/turn', { turnId: 'abcdefghij12', status: 'done' }], ['GET', '/api/dash-bot/history', undefined]];
  async function all503(label) {
    for (var j = 0; j < ROUTES3.length; j++) {
      calls = [];
      quiet();
      var x = await call(ROUTES3[j][0], ROUTES3[j][1], ROUTES3[j][2]);
      loud();
      ok(x.status === 503 && x.body && x.body.code === 'module-unavailable' && /not available right now/.test(x.body.error) && !calls.some(function (k) { return /^handle/.test(k.fn); }),
        'B.3 ' + label + ': ' + ROUTES3[j][0] + ' ' + ROUTES3[j][1] + ' -> 503 module-unavailable, no handler run', x.status + ' ' + names());
      ok(logged.some(function (l) { return /lib\/dash-bot\.js/.test(l); }), 'B.3 ' + label + ': … and the reason is logged for us', logged);
    }
  }
  FAIL_LOAD = true;
  await all503('the module cannot be loaded');
  c = await call('GET', '/api/events');
  ok(c.status === 200 && Array.isArray(c.body && c.body.items), 'B.3 … while every other route keeps working (GET /api/events)', c.status);
  FAIL_LOAD = false;
  WIRE_THROWS = true;
  await all503('wire() throws');
  WIRE_THROWS = false;
  var noWire = stubBot(); delete noWire.wire; setBot(noWire);
  await all503('the module has no wire()');
  var noTurn = stubBot(); delete noTurn.handleTurn; setBot(noTurn);
  calls = []; quiet();
  c = await call('POST', '/api/dash-bot/turn', { turnId: 'abcdefghij12', status: 'done' });
  loud();
  ok(c.status === 503 && c.body.code === 'module-unavailable' && logged.some(function (l) { return /has no handleTurn/.test(l); }), 'B.3 a module without handleTurn(): that route 503', c.status + ' ' + logged.join(' | '));
  c = await call('POST', '/api/dash-bot', { message: 'hi' });
  ok(c.status === 200 && c.body.fn === 'handleChat', 'B.3 … while its other routes still answer');
  setBot(stubBot());
  calls = [];
  c = await call('POST', '/api/dash-bot', { message: 'again' });
  ok(c.status === 200 && names() === 'wire,handleChat,handleChat:in', 'B.3 once the module is back, the next request is answered (a failed load is not remembered)', c.status + ' ' + names());

  /* ======== B.4 GET /api/events is unchanged, and liveEventDocs is the same list ======== */
  queries = [];
  var live = await call('GET', '/api/events');
  ok(live.status === 200 && live.text === JSON.stringify(EXPECTED_LIVE), 'B.4 GET /api/events answers byte for byte what it answered at dc1a8e1', live.text);
  ok(live.headers['Cache-Control'] === 'no-store' && live.headers['Content-Type'] === 'application/json; charset=utf-8', 'B.4 … with the same headers', live.headers);
  var del = await call('GET', '/api/events?deleted=1');
  ok(del.status === 200 && del.text === JSON.stringify(EXPECTED_DELETED), 'B.4 GET /api/events?deleted=1 likewise', del.text);
  ok(queries.length === 2 && queries.every(function (q) { return JSON.stringify(q.fields) === JSON.stringify(LIST_FIELDS_AT_DC1A8E1) && q.limit === 1000; }),
    'B.4 … each one query that reads only the list\'s fields, at most 1,000 events', queries);
  var other = await call('GET', '/api/events?deleted=0'), other2 = await call('GET', '/api/events?deleted=true');
  ok(other.text === live.text && other2.text === live.text, 'B.4 deleted=0 or anything but 1 is the live list, as before');
  c = await call('GET', '/api/events', undefined, null);
  ok(c.status === 401, 'B.4 signed out: 401', c.status);

  var decoded = { uid: 'u-asha', email: 'asha@timesinternet.in', name: 'Asha Rao' };
  /* the helpers as the bot is handed them (a missing one fails the checks below instead of crashing the run) */
  var HB = H || {};
  var LED = typeof HB.liveEventDocs === 'function' ? HB.liveEventDocs : function () { return Promise.resolve([]); };
  var ELI = typeof HB.eventListItem === 'function' ? HB.eventListItem : function () { return null; };
  ok(typeof HB.liveEventDocs === 'function' && typeof HB.eventListItem === 'function', 'B.4 the bot is handed liveEventDocs and eventListItem');
  var docs = await LED(FB, decoded, 'live');
  ok(Array.isArray(docs) && docs.every(function (d) { return Object.keys(d).join() === 'id,data'; }), 'B.4 liveEventDocs gives [{ id, data }]', docs && docs.map(function (d) { return Object.keys(d); }));
  ok(docs.map(function (d) { return d.id; }).join() === EXPECTED_LIVE.items.map(function (i) { return i.id; }).join(), 'B.4 … the same live events, in the same order, as GET /api/events',
    docs.map(function (d) { return d.id; }));
  ok(JSON.stringify({ items: docs.map(function (d) { return ELI(d.id, d.data); }) }) === live.text, 'B.4 … and eventListItem() on each is exactly the list\'s body');
  var auto = docs.filter(function (d) { return d.id === 'autotech-2026'; })[0];
  ok(auto && JSON.stringify(auto.data.counters) === JSON.stringify({ registrations: 42, views: 900, audienceV: 2, uniques: 300, mobile: 120, desktop: 180 }),
    'B.4 … with the raw counters (audienceV, uniques, mobile, desktop kept) for insightTotals, so no event is read twice', auto && auto.data.counters);
  ok(auto && auto.data.generatedSections === undefined && auto.data.siteLock === undefined && auto.data.slug === undefined &&
    docs.every(function (d) { return Object.keys(d.data).every(function (k) { return LIST_FIELDS_AT_DC1A8E1.indexOf(k) !== -1; }); }),
    'B.4 … and only the list\'s fields: no site markup, no site lock', auto && Object.keys(auto.data));
  var legacy = docs.filter(function (d) { return d.id === 'legacy-forum'; })[0];
  ok(legacy && legacy.data.counters.audienceV === undefined && legacy.data.counters.views === 310 && typeof legacy.data.updatedAt.toDate === 'function',
    'B.4 … an older event\'s counters (no audienceV) and Timestamps come through as stored', legacy && legacy.data.counters);
  var gone = await LED(FB, decoded, 'deleted');
  ok(gone.map(function (d) { return d.id; }).join() === 'gone,gone-older', 'B.4 liveEventDocs(…, \'deleted\'): the deleted events, newest-deleted first, as ?deleted=1', gone.map(function (d) { return d.id; }));
  ok(JSON.stringify({ items: gone.map(function (d) { return ELI(d.id, d.data); }) }) === del.text, 'B.4 … whose items are exactly ?deleted=1\'s body');
  var dflt = await LED(FB, decoded), weird = await LED(FB, null, 'all');
  ok(dflt.map(function (d) { return d.id; }).join() === docs.map(function (d) { return d.id; }).join() && weird.map(function (d) { return d.id; }).join() === docs.map(function (d) { return d.id; }).join(),
    'B.4 … anything but \'deleted\' is the live list (never the deleted ones by mistake)');
  ok(!docs.concat(gone).some(function (d) { return ['shell-doc', 'import-abc123', 'discarding', 'nameless', 'number-name', 'gone-nameless'].indexOf(d.id) !== -1; }),
    'B.4 … and never a shell, an import record, a draft being discarded or a nameless event');
  /* a failed read rejects (it never throws at the caller), and the list answers its sentence */
  var realCollection = FB.db.collection;
  FB.db.collection = function () { return { select: function () { return { limit: function () { return { get: function () { return Promise.reject(new Error('DEADLINE_EXCEEDED internal path events/x')); } }; } }; } }; };
  var rejected = await LED(FB, decoded, 'live').then(function () { return false; }, function (e) { return /DEADLINE_EXCEEDED/.test(e.message); });
  quiet();
  c = await call('GET', '/api/events');
  loud();
  ok(rejected === true, 'B.4 liveEventDocs rejects when the read fails');
  ok(c.status === 500 && c.body.error === 'Could not load your events. Please try again.' && c.text.indexOf('DEADLINE') === -1, 'B.4 … and GET /api/events still answers its one plain sentence', c.text);
  FB.db.collection = function () { throw new Error('stub: no Firestore'); };
  var rejected2 = await (function () { try { return LED(FB, decoded, 'live').then(function () { return 'resolved'; }, function () { return 'rejected'; }); } catch (e) { return Promise.resolve('threw'); } })();
  ok(rejected2 === 'rejected', 'B.4 liveEventDocs turns a synchronous failure into a rejection (a Promise.all beside it is not broken)', rejected2);
  FB.db.collection = realCollection;
  var src = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
  ok(/function handleEventsList\(req, res\) \{\s*withAdmin\(req, res, function \(fb, decoded\) \{[\s\S]{0,200}liveEventDocs\(fb, decoded, which\)/.test(src),
    'B.4 GET /api/events reads through liveEventDocs, passing the person (a later per-person rule then binds the bot too)');
  ok(/lib\/dash-bot\.js\s+ETB2B AI on the events dashboard: POST \/api\/dash-bot/.test(src), 'B.2 the header of lib/api.js names the bot\'s module and routes');

  /* ======== B.5 lib/api-audience.js gives the bot the Insights totals ======== */
  var audience = require('./api-audience');
  ok(typeof audience.insightTotals === 'function' && typeof audience.conversionOf === 'function', 'B.5 api-audience exports insightTotals and conversionOf');
  ok(audience.conversionOf(42, 900) === 4.7 && audience.conversionOf(0, 900) === 0 && audience.conversionOf(5, 0) === 0 && audience.conversionOf(300, 100) === 100,
    'B.5 conversionOf is the Insights percentage (one decimal, 0 with no visits, never over 100)');
  ok(['handleInsights', 'handleDashboardStats', 'handleRegister', 'scanAudience', 'hasAudienceCounters'].every(function (k) { return typeof audience[k] === 'function'; }) &&
    typeof audience._shared === 'object' && typeof audience._shared.scanAudience === 'function', 'B.5 … and its other exports are as they were');

  if (failures.length) {
    realError('dash-bot-wiring.test.js: ' + failures.length + ' of ' + checks + ' checks FAILED');
    failures.forEach(function (f) { realError('  - ' + f); });
    process.exit(1);
  }
  console.log('dash-bot-wiring.test.js: all ' + checks + ' checks passed');
})().catch(function (err) { console.error = realError; realError('dash-bot-wiring.test.js crashed: ' + (err && err.stack || err)); process.exit(1); });
