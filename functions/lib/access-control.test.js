/* node functions/lib/access-control.test.js — Settings › Access (the owner, 10 Nov 2026: "Create a access management
   section for this project where I can give access to other users"; company accounts plus invited ones, four roles,
   chosen portals, first admin sachitanand.rai@timesinternet.in), against an in-memory Firestore through the real
   router (lib/api.js handleApi):
     1. the rule (lib/access-control.js): who is let in and as what, what a request needs, which events are theirs;
     2. the list's changes: admins only, the last admin kept, nobody demoting or removing themselves, every change
        logged, nothing written by reading;
     3. through the router: a Viewer reads and changes nothing, an Editor in chosen portals sees and opens only
        those portals' events (the list, one event, a body that names one, a new event's portal, the preview page,
        the ET portal list), a blocked company account and an uninvited Google account are refused, an invited one
        is let in; the approvers are the Approvers and Admins;
     4. GET/POST /api/access;
     5. the pages: sign-in asks the server, no company-only hint, the denied messages, Settings › Access.
   No network, no real project. Exits 1 on any failure. */
'use strict';

var fs = require('fs');
var path = require('path');
var EventEmitter = require('events');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '') + '\n');
}
['log', 'info', 'warn', 'error'].forEach(function (k) { console[k] = function () {}; });
var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

/* ---------- an in-memory Firestore, just enough ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {}, seq = 0, failReads = false;
  function snap(p) {
    var d = docs[p];
    return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } };
  }
  function write(p, kind, data, o) {
    if (kind === 'set' && !(o && o.merge)) docs[p] = {};
    if (!docs[p]) docs[p] = {};
    Object.keys(data).forEach(function (k) { if (isDelete(data[k])) delete docs[p][k]; else docs[p][k] = clone(data[k]); });
  }
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return failReads && /^config\/access$/.test(p) ? Promise.reject(new Error('UNAVAILABLE')) : Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, 'set', data, o); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, 'update', data); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); }
    };
  }
  function colRef(p, filters) {
    filters = filters || [];
    var q = {
      path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(4, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(4, '0')); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) { return colRef(p, filters.concat([{ field: field, value: value }])); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; })
          .filter(function (k) { return filters.every(function (f) { return docs[k][f.field] === f.value; }); }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      }
    };
    return q;
  }
  var db = {
    collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = {
        get: function (r) { return r.get(); },
        set: function (r, d, o) { write(r.path, 'set', d, o); return tx; },
        update: function (r, d) { write(r.path, 'update', d); return tx; },
        delete: function (r) { delete docs[r.path]; return tx; }
      };
      return Promise.resolve().then(function () { return fn(tx); });
    }
  };
  /* "Bearer <name>" signs in as <name>@timesinternet.in; a token with an @ is that address; "pw:<name>" is an
     email/password sign-in; "unverified:<name>" an address Google has not verified */
  var auth = { verifyIdToken: function (t) {
    if (t === 'bad') return Promise.reject(new Error('bad token'));
    var provider = /^pw:/.test(t) ? 'password' : 'google.com', verified = !/^unverified:/.test(t);
    var name = t.replace(/^(pw|unverified):/, '');
    var email = name.indexOf('@') !== -1 ? name : name + '@timesinternet.in';
    return Promise.resolve({ email: email, uid: 'u-' + name.replace(/[^a-z0-9]/gi, ''), email_verified: verified, firebase: { sign_in_provider: provider } });
  } };
  return { db: db, auth: auth, docs: docs, bucket: { name: 'b', file: function () { return { download: function () { return Promise.reject(Object.assign(new Error('none'), { code: 404 })); }, save: function () { return Promise.resolve(); } }; } },
    failReads: function (on) { failReads = on; } };
}

var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
delete process.env.ACCESS_CONFIG_DOC;
var AC = require('./access-control');
var api = require('./api');
var access = require('./access');

/* stream: true sends the body as a stream (no rawBody), the way a plain Node server receives it */
function call(method, url, token, body, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'x-forwarded-for': '10.8.0.' + Math.floor(Math.random() * 250) };
    if (token) headers.authorization = 'Bearer ' + token;
    var text = body ? JSON.stringify(body) : '';
    if (text) headers['content-type'] = 'application/json';
    var req;
    if (opts.stream) {
      req = new EventEmitter();
      req.method = method; req.url = url; req.headers = headers; req.socket = {}; req.resume = function () {};
      setImmediate(function () { if (text) req.emit('data', Buffer.from(text)); req.emit('end'); });
    } else {
      req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(text) };
      req.on = function () { return req; }; req.resume = function () {};
    }
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: t, headers: res.headers }); }
    };
    api.handleApi(req, res);
  });
}
var CREATED = '2026-10-01T09:00:00.000Z';
function makeEvent(id, extra) {
  FB.docs['events/' + id] = Object.assign({ name: 'Event ' + id, createdAt: CREATED, createdBy: 'someone@timesinternet.in', updatedAt: CREATED, status: 'draft' }, extra || {});
}
function setList(members, defaultRole) {
  FB.docs['config/access'] = { defaultRole: defaultRole || 'editor', members: members, stored: true };
  AC.forget();
}
function M(role, portals) { return { role: role, portals: portals || ['*'] }; }
function ids(items) { return (items || []).map(function (e) { return e.id; }).sort().join(','); }
function g(email, extra) { return Object.assign({ email: email, email_verified: true, firebase: { sign_in_provider: 'google.com' } }, extra || {}); }

(async function () {
  /* ================= 1. the rule ================= */
  var cfg0 = AC._test.startingPoint(['Boss@TimesInternet.in', 'not an address']);
  check('1 the starting point: the first admin and the approvers named before, as Approvers', cfg0.members['sachitanand.rai@timesinternet.in'].role === 'admin' &&
    cfg0.members['boss@timesinternet.in'].role === 'approver' && Object.keys(cfg0.members).length === 2 && cfg0.defaultRole === 'editor', cfg0);
  check('1 …its approvers: the Approvers and Admins, sorted', JSON.stringify(AC.approverEmails(cfg0)) === '["boss@timesinternet.in","sachitanand.rai@timesinternet.in"]');
  var cfg1 = AC._test.normalise({ defaultRole: 'viewer', members: {
    'Ext@Gmail.com': M('editor', ['cio', 'nonsense', 'cio']), 'gone@timesinternet.in': M('blocked'), 'bad@x': M('editor'),
    'who@timesinternet.in': { role: 'superuser' }, 'v@timesinternet.in': M('viewer', ['hr']), 'a@timesinternet.in': M('admin', ['cio']) } });
  check('1 a stored list is read safely: addresses in lower case, unknown roles and portals dropped, an admin on every portal',
    JSON.stringify(Object.keys(cfg1.members).sort()) === '["a@timesinternet.in","ext@gmail.com","gone@timesinternet.in","v@timesinternet.in"]' &&
    JSON.stringify(cfg1.members['ext@gmail.com'].portals) === '["cio"]' && JSON.stringify(cfg1.members['a@timesinternet.in'].portals) === '["*"]' && cfg1.defaultRole === 'viewer', cfg1.members);
  var a;
  a = AC.accessOf(cfg1, g('new@timesinternet.in'));
  check('1 a company account not on the list: the default role (here Viewer), every portal', a.role === 'viewer' && a.portals[0] === '*' && a.member === false, a);
  a = AC.accessOf(cfg0, g('new@TimesInternet.in'));
  check('1 …Editor by default, as before Access existed', a.role === 'editor' && a.email === 'new@timesinternet.in', a);
  a = AC.accessOf(cfg1, g('ext@gmail.com'));
  check('1 an invited Google account on another domain: let in, as invited', a.role === 'editor' && JSON.stringify(a.portals) === '["cio"]' && a.member === true, a);
  check('1 an uninvited one: outside', AC.accessOf(cfg1, g('stranger@gmail.com')).denied === 'outside');
  check('1 a blocked company account: blocked', AC.accessOf(cfg1, g('gone@timesinternet.in')).denied === 'blocked');
  check('1 not a verified Google sign-in: signin', AC.accessOf(cfg1, g('new@timesinternet.in', { email_verified: false })).denied === 'signin' &&
    AC.accessOf(cfg1, g('new@timesinternet.in', { firebase: { sign_in_provider: 'password' } })).denied === 'signin' && AC.accessOf(cfg1, null).denied === 'signin');
  check('1 can(): Viewer < Editor < Approver < Admin', AC.can({ role: 'approver' }, 'editor') && !AC.can({ role: 'editor' }, 'approver') && AC.can({ role: 'viewer' }, 'viewer') &&
    !AC.can({ role: 'viewer' }, 'editor') && AC.can({ role: 'admin' }, 'admin') && !AC.can({ denied: 'blocked' }, 'viewer'));
  check('1 needFor: reading needs Viewer, changing needs Editor', AC.needFor('GET', '/api/events') === 'viewer' && AC.needFor('PATCH', '/api/event') === 'editor' &&
    AC.needFor('POST', '/api/event/publish') === 'editor' && AC.needFor('DELETE', '/api/event') === 'editor');
  check('1 …a Viewer may still talk to ETB2B AI on the dashboard, keep a working portal and open mailers', ['POST /api/dash-bot', 'POST /api/dash-bot/turn', 'PUT /api/me/working-portal',
    'POST /api/promo/mailer/doc', 'POST /api/promo/mailer/render', 'POST /api/promo/social/html'].every(function (r) { var p = r.split(' '); return AC.needFor(p[0], p[1]) === 'viewer'; }));
  check('1 …the access list\'s changes need Admin, reading it Viewer', AC.needFor('POST', '/api/access/member') === 'admin' && AC.needFor('POST', '/api/access/default') === 'admin' &&
    AC.needFor('GET', '/api/access') === 'viewer' && AC.needFor('GET', '/api/access/me?x=1') === 'viewer');
  var cio = { email: 'e@timesinternet.in', role: 'editor', portals: ['cio'] }, all = { email: 'x@timesinternet.in', role: 'editor', portals: ['*'] };
  check('1 eventOk: on every portal, any event', AC.eventOk(all, { portal: 'hr', createdAt: CREATED }));
  check('1 …in chosen portals: their portals\' events only', AC.eventOk(cio, { portal: 'cio', createdAt: CREATED }) && !AC.eventOk(cio, { portal: 'hr', createdAt: CREATED }));
  check('1 …an event with no portal yet: only one they made', AC.eventOk(cio, { createdAt: CREATED, createdBy: 'E@timesinternet.in' }) && !AC.eventOk(cio, { createdAt: CREATED, createdBy: 'other@timesinternet.in' }));
  check('1 …one that does not exist yet, or is still being made: not refused here', AC.eventOk(cio, null) && AC.eventOk(cio, { portal: 'hr' }));
  check('1 …an admin works on every portal, whatever is stored', AC.eventOk({ role: 'admin', portals: ['cio'] }, { portal: 'hr', createdAt: CREATED }));
  check('1 the sentences name the product, the portal and who to ask', /ETB2B EventSphere/.test(AC.deniedSentence('outside')) && /invite/.test(AC.deniedSentence('outside')) &&
    /no longer has access/.test(AC.deniedSentence('blocked')) && /ETHRWorld, which is not one of your portals \(ETCIO\)/.test(AC.outsideSentence(cio, 'hr')) &&
    /view-only access \(Viewer\)/.test(AC.refusedSentence({ role: 'viewer' }, 'editor')) && /Only an admin/.test(AC.refusedSentence({ role: 'editor' }, 'admin')));

  /* reading never writes; a list that cannot be read keeps the last one, or the rule before Access */
  AC.forget();
  var r0 = await AC.readConfig(FB);
  check('1 nothing saved: the starting point, and nothing is written by reading', r0.stored === false && r0.members['sachitanand.rai@timesinternet.in'].role === 'admin' && !FB.docs['config/access']);
  setList({ 'sachitanand.rai@timesinternet.in': M('admin'), 'v@timesinternet.in': M('viewer') });
  r0 = await AC.readConfig(FB);
  FB.failReads(true); AC.forget();
  var r1 = await AC.readConfig(FB);
  check('1 a read that fails keeps the last list read', r1.stored === true && r1.members['v@timesinternet.in'].role === 'viewer', r1);
  FB.failReads(false); AC.forget();

  /* ================= 2. changing the list ================= */
  delete FB.docs['config/access'];
  FB.docs['config/approvals'] = { approvers: ['boss@timesinternet.in'], required: true };
  AC.forget();
  var err = null;
  try { await AC.setMember(FB, 'boss@timesinternet.in', { email: 'x@gmail.com', role: 'editor', portals: ['*'] }); } catch (e) { err = e; }
  check('2 an Approver is not an admin: refused, nothing written', err && err.code === 'not-admin' && err.status === 403 && !FB.docs['config/access'], err && err.message);
  var cfg = await AC.setMember(FB, 'sachitanand.rai@timesinternet.in', { email: ' Guest@Gmail.com ', name: 'Guest Speaker', role: 'editor', portals: ['cio', 'ciso', 'nope'] });
  var stored = FB.docs['config/access'];
  check('2 the first admin invites someone: stored, from the starting point (the approvers named before kept)', stored && stored.stored === true && stored.members['guest@gmail.com'].role === 'editor' &&
    JSON.stringify(stored.members['guest@gmail.com'].portals) === '["cio","ciso"]' && stored.members['boss@timesinternet.in'].role === 'approver' &&
    stored.members['sachitanand.rai@timesinternet.in'].role === 'admin' && stored.members['guest@gmail.com'].name === 'Guest Speaker' && stored.members['guest@gmail.com'].addedBy === 'sachitanand.rai@timesinternet.in', stored);
  check('2 …the answer is the list as it now is', cfg.stored === true && cfg.members['guest@gmail.com'].role === 'editor');
  var logs = Object.keys(FB.docs).filter(function (k) { return k.indexOf('config/access/log/') === 0; }).map(function (k) { return FB.docs[k]; });
  check('2 …and logged, with who and what', logs.length === 1 && logs[0].action === 'added' && logs[0].email === 'guest@gmail.com' && logs[0].by === 'sachitanand.rai@timesinternet.in' &&
    logs[0].before === null && logs[0].after.role === 'editor', logs);
  await AC.setMember(FB, 'sachitanand.rai@timesinternet.in', { email: 'guest@gmail.com', role: 'editor', portals: ['cio', 'ciso'] });
  logs = Object.keys(FB.docs).filter(function (k) { return k.indexOf('config/access/log/') === 0; });
  check('2 saving the same again changes and logs nothing', logs.length === 1);
  var bad = [];
  for (var t of [{ email: 'nope', role: 'editor', portals: ['*'] }, { email: 'a@b.co', role: 'owner', portals: ['*'] }, { email: 'a@b.co', role: 'editor', portals: ['nope'] }]) {
    try { await AC.setMember(FB, 'sachitanand.rai@timesinternet.in', t); bad.push('accepted'); } catch (e) { bad.push(e.code); }
  }
  check('2 a bad address, role or portal list is refused in words', bad.join() === 'bad-email,bad-role,no-portals', bad);
  err = null;
  try { await AC.setMember(FB, 'sachitanand.rai@timesinternet.in', { email: 'sachitanand.rai@timesinternet.in', role: 'editor', portals: ['*'] }); } catch (e) { err = e; }
  check('2 an admin cannot take away their own admin access', err && err.code === 'self', err && err.message);
  await AC.setMember(FB, 'sachitanand.rai@timesinternet.in', { email: 'second@timesinternet.in', role: 'admin', portals: ['cio'] });
  check('2 a second admin: stored on every portal', JSON.stringify(FB.docs['config/access'].members['second@timesinternet.in'].portals) === '["*"]');
  await AC.setMember(FB, 'second@timesinternet.in', { email: 'sachitanand.rai@timesinternet.in', role: 'approver', portals: ['*'] });
  check('2 …who may change the first admin', FB.docs['config/access'].members['sachitanand.rai@timesinternet.in'].role === 'approver');
  err = null;
  try { await AC.setMember(FB, 'sachitanand.rai@timesinternet.in', { email: 'second@timesinternet.in', role: 'viewer', portals: ['*'] }); } catch (e) { err = e; }
  check('2 …who is then no admin any more: refused', err && err.code === 'not-admin');
  err = null;
  try { await AC.removeMember(FB, 'second@timesinternet.in', 'second@timesinternet.in'); } catch (e) { err = e; }
  check('2 an admin cannot remove themselves', err && err.code === 'self');
  await AC.setMember(FB, 'second@timesinternet.in', { email: 'sachitanand.rai@timesinternet.in', role: 'admin', portals: ['*'] });
  /* the last admin: forcing the only other admin's demotion through a list with one admin left */
  await AC.setMember(FB, 'sachitanand.rai@timesinternet.in', { email: 'second@timesinternet.in', role: 'editor', portals: ['*'] });
  err = null;
  try { await AC.setMember(FB, 'sachitanand.rai@timesinternet.in', { email: 'sachitanand.rai@timesinternet.in', role: 'blocked' }); } catch (e) { err = e; }
  check('2 the last admin cannot be demoted (by themselves: refused as self)', err && (err.code === 'self' || err.code === 'last-admin'));
  await AC.setMember(FB, 'sachitanand.rai@timesinternet.in', { email: 'gone@timesinternet.in', role: 'blocked', portals: ['cio'] });
  check('2 a colleague can be blocked (stored as No access, every portal)', FB.docs['config/access'].members['gone@timesinternet.in'].role === 'blocked');
  await AC.removeMember(FB, 'sachitanand.rai@timesinternet.in', 'guest@gmail.com');
  logs = Object.keys(FB.docs).filter(function (k) { return k.indexOf('config/access/log/') === 0; }).map(function (k) { return FB.docs[k]; });
  var last = logs[logs.length - 1];
  check('2 taking someone off the list: gone, logged with what they were (an invited account: no access after)', !FB.docs['config/access'].members['guest@gmail.com'] && last.action === 'removed' &&
    last.before.role === 'editor' && last.after === null, last);
  await AC.removeMember(FB, 'sachitanand.rai@timesinternet.in', 'second@timesinternet.in');
  last = Object.keys(FB.docs).filter(function (k) { return k.indexOf('config/access/log/') === 0; }).map(function (k) { return FB.docs[k]; }).pop();
  check('2 …a company account: back to the company default, said so', last.after && last.after.role === 'editor' && last.after.note === 'company default', last);
  await AC.setDefaultRole(FB, 'sachitanand.rai@timesinternet.in', 'viewer');
  check('2 the default for company accounts: Viewer', FB.docs['config/access'].defaultRole === 'viewer');
  err = null;
  try { await AC.setDefaultRole(FB, 'sachitanand.rai@timesinternet.in', 'admin'); } catch (e) { err = e; }
  check('2 …only Editor or Viewer', err && err.code === 'bad-role');
  await AC.setDefaultRole(FB, 'sachitanand.rai@timesinternet.in', 'editor');
  var lg = await AC.readLog(FB, 50);
  check('2 readLog gives the changes in words for the page', lg.length >= 6 && lg.every(function (l) { return l.at && l.by && l.action; }), lg.length);

  /* ================= 3. through the router ================= */
  makeEvent('ac-cio-1', { name: 'CIO Summit', portal: 'cio' });
  makeEvent('ac-hr-1', { name: 'HR Summit', portal: 'hr' });
  makeEvent('ac-none-mine', { name: 'Mine, no portal', createdBy: 'scoped@timesinternet.in' });
  makeEvent('ac-none-other', { name: 'Theirs, no portal', createdBy: 'other@timesinternet.in' });
  setList({
    'sachitanand.rai@timesinternet.in': M('admin'), 'scoped@timesinternet.in': M('editor', ['cio']), 'look@timesinternet.in': M('viewer'),
    'gone@timesinternet.in': M('blocked'), 'guest@gmail.com': M('editor', ['cio']), 'appr@timesinternet.in': M('approver', ['*'])
  });
  var r = await call('GET', '/api/events', 'scoped');
  check('3 an Editor on ETCIO lists ETCIO\'s events and the ones without a portal they made', r.status === 200 && ids(r.body.items) === 'ac-cio-1,ac-none-mine', r.body && ids(r.body.items));
  r = await call('GET', '/api/events', 'anyone');
  check('3 a company account not on the list (Editor, every portal) lists them all', r.status === 200 && ['ac-cio-1', 'ac-hr-1', 'ac-none-mine', 'ac-none-other'].every(function (id) { return ids(r.body.items).indexOf(id) !== -1; }));
  r = await call('GET', '/api/event?eventId=ac-hr-1', 'scoped');
  check('3 …opening another portal\'s event: 403 not-your-portal, in words', r.status === 403 && r.body.code === 'not-your-portal' && /ETHRWorld, which is not one of your portals \(ETCIO\)/.test(r.body.error), r.text);
  r = await call('GET', '/api/event?eventId=ac-cio-1', 'scoped');
  check('3 …their own portal\'s: 200', r.status === 200 && r.body.name === 'CIO Summit', r.text.slice(0, 200));
  var before = JSON.stringify(FB.docs['events/ac-hr-1']);
  r = await call('PATCH', '/api/event', 'scoped', { eventId: 'ac-hr-1', name: 'Taken over' }, { stream: true });
  check('3 a body that names another portal\'s event (read from the stream): 403, nothing written', r.status === 403 && r.body.code === 'not-your-portal' && JSON.stringify(FB.docs['events/ac-hr-1']) === before, r.text);
  r = await call('PATCH', '/api/event', 'scoped', { eventId: 'ac-cio-1', name: 'CIO Summit 2027' }, { stream: true });
  check('3 …their own (the route reads the body the check already read): 200, saved', r.status === 200 && FB.docs['events/ac-cio-1'].name === 'CIO Summit 2027', r.text);
  r = await call('PATCH', '/api/event', 'scoped', { eventId: 'ac-cio-1', portal: 'hr' }, { stream: true });
  check('3 …moving it to a portal not theirs: 403', r.status === 403 && r.body.code === 'not-your-portal' && FB.docs['events/ac-cio-1'].portal === 'cio', r.text);
  r = await call('POST', '/api/event', 'scoped', { eventId: 'ac-new-hr', name: 'New HR', portal: 'hr' });
  check('3 creating an event on a portal not theirs: 403, nothing created', r.status === 403 && !FB.docs['events/ac-new-hr'], r.text);
  r = await call('POST', '/api/event/clone', 'scoped', { sourceEventId: 'ac-hr-1', eventId: 'ac-copy' }, { stream: true });
  check('3 copying another portal\'s event: 403', r.status === 403 && r.body.code === 'not-your-portal', r.text);
  r = await call('GET', '/api/et/portals', 'scoped');
  check('3 the ET portal list (Create Event, previous editions) offers only theirs', r.status === 200 && JSON.stringify(r.body.portals.map(function (p) { return p.slug; })) === '["cio"]', r.body);
  r = await call('GET', '/api/et/portals', 'anyone');
  check('3 …everyone else gets all of them', r.status === 200 && r.body.portals.length > 5);
  r = await call('PUT', '/api/me/working-portal', 'scoped', { workingPortal: 'hr' });
  check('3 the dashboard\'s working portal: not one that is not theirs', r.status === 403 && r.body.code === 'not-your-portal' && /^That is ETHRWorld, which is not one of your portals/.test(r.body.error), r.text);
  r = await call('PUT', '/api/me/working-portal', 'scoped', { workingPortal: 'cio' });
  var r2 = await call('PUT', '/api/me/working-portal', 'scoped', { workingPortal: 'all' });
  check('3 …their own, or All portals (which lists only theirs)', r.status === 200 && r2.status === 200, [r.text, r2.text]);
  r = await call('GET', '/api/events/portal-evidence', 'scoped');
  check('3 a report over every portal (Fill in portals): refused to someone in chosen portals', r.status === 403 && r.body.code === 'not-your-portal', r.text);
  r = await call('GET', '/preview/ac-hr-1', 'scoped');
  check('3 the preview of another portal\'s event: a 403 page that says so', r.status === 403 && /This event is not in your portals/.test(r.text), r.status);

  r = await call('GET', '/api/events', 'look');
  check('3 a Viewer reads', r.status === 200 && r.body.items.length >= 4);
  before = JSON.stringify(FB.docs['events/ac-cio-1']);
  r = await call('PATCH', '/api/event', 'look', { eventId: 'ac-cio-1', name: 'Changed by a viewer' });
  check('3 …and changes nothing: 403 view-only, in words', r.status === 403 && r.body.code === 'view-only' && /view-only access \(Viewer\)/.test(r.body.error) && JSON.stringify(FB.docs['events/ac-cio-1']) === before, r.text);
  r = await call('DELETE', '/api/event?eventId=ac-cio-1', 'look');
  check('3 …deleting neither', r.status === 403 && r.body.code === 'view-only' && !FB.docs['events/ac-cio-1'].deletedAt);
  r = await call('PUT', '/api/me/working-portal', 'look', { workingPortal: 'cio' });
  check('3 …but may keep their own working portal', r.status === 200, r.text);

  r = await call('GET', '/api/events', 'gone');
  check('3 a blocked company account: 403 no-access, in words', r.status === 403 && r.body.code === 'no-access' && /no longer has access/.test(r.body.error), r.text);
  r = await call('GET', '/api/events', 'stranger@gmail.com');
  check('3 an uninvited Google account: 403 no-access', r.status === 403 && r.body.code === 'no-access' && /has not been given access/.test(r.body.error), r.text);
  r = await call('GET', '/api/events', 'guest@gmail.com');
  check('3 an invited Google account: let in, to its portals', r.status === 200 && ids(r.body.items) === 'ac-cio-1', r.body && ids(r.body.items));
  r = await call('GET', '/api/events', 'pw:anyone');
  check('3 not a Google sign-in: refused', r.status === 403, r.status);

  r = await call('GET', '/api/settings/approvals', 'anyone');
  check('3 the approvers are the Approvers and Admins of the access list', r.status === 200 && JSON.stringify(r.body.approvers) === '["appr@timesinternet.in","sachitanand.rai@timesinternet.in"]' && r.body.approversFrom === 'access', r.body);
  r = await call('DELETE', '/api/event?eventId=ac-hr-1', 'anyone');
  check('3 …so an Editor cannot delete an event', r.status === 403 && r.body.code === 'not-an-approver', r.text);
  r = await call('DELETE', '/api/event?eventId=ac-hr-1', 'appr');
  check('3 …an Approver can', r.status === 200 && !!FB.docs['events/ac-hr-1'].deletedAt, r.text);

  /* ================= 4. GET / POST /api/access ================= */
  r = await call('GET', '/api/access/me', 'scoped');
  check('4 /api/access/me: their role, portals and the roster, no list', r.status === 200 && r.body.you.role === 'editor' && JSON.stringify(r.body.you.portals) === '["cio"]' &&
    r.body.canManage === false && !r.body.members && r.body.portals.length > 5 && JSON.stringify(r.body.admins) === '["sachitanand.rai@timesinternet.in"]', r.body);
  r = await call('GET', '/api/access', 'look');
  check('4 GET /api/access for someone not an admin: their own access only', r.status === 200 && r.body.you.role === 'viewer' && !r.body.members && !r.body.log);
  r = await call('GET', '/api/access', 'sachitanand.rai');
  check('4 …for an admin: everyone on the list, admins first, and the changes', r.status === 200 && r.body.canManage === true && r.body.members[0].role === 'admin' &&
    r.body.members.some(function (m) { return m.email === 'guest@gmail.com' && m.company === false; }) && Array.isArray(r.body.log) && r.body.defaultRole === 'editor', r.body);
  r = await call('POST', '/api/access/member', 'appr', { email: 'x@gmail.com', role: 'admin' });
  check('4 an Approver cannot change the list: 403 not-admin', r.status === 403 && r.body.code === 'not-admin' && !FB.docs['config/access'].members['x@gmail.com'], r.text);
  r = await call('POST', '/api/access/member', 'look', { email: 'x@gmail.com', role: 'admin' });
  check('4 …nor a Viewer', r.status === 403 && r.body.code === 'not-admin');
  r = await call('POST', '/api/access/member', 'sachitanand.rai', { email: 'Partner@Agency.co', role: 'viewer', portals: ['ciso'], name: 'Agency' });
  check('4 an admin invites someone: 200, the list as it now is', r.status === 200 && r.body.members.some(function (m) { return m.email === 'partner@agency.co' && m.role === 'viewer' && m.portals[0] === 'ciso'; }) &&
    r.body.log[0] && r.body.log.some(function (l) { return l.email === 'partner@agency.co'; }), r.text.slice(0, 300));
  r = await call('GET', '/api/events', 'partner@agency.co');
  check('4 …who can then sign in, to ETCISO only (nothing there yet)', r.status === 200 && r.body.items.length === 0, r.text.slice(0, 200));
  r = await call('POST', '/api/access/member', 'sachitanand.rai', { email: 'sachitanand.rai@timesinternet.in', role: 'viewer', portals: ['*'] });
  check('4 the admin demoting themselves: 400 self, in words', r.status === 400 && r.body.code === 'self' && /your own admin access/.test(r.body.error), r.text);
  r = await call('POST', '/api/access/remove', 'sachitanand.rai', { email: 'partner@agency.co' });
  check('4 taking them off: 200', r.status === 200 && !r.body.members.some(function (m) { return m.email === 'partner@agency.co'; }));
  r = await call('GET', '/api/events', 'partner@agency.co');
  check('4 …and they are refused at once (the cache dropped by the change)', r.status === 403 && r.body.code === 'no-access', r.text);
  r = await call('POST', '/api/access/default', 'sachitanand.rai', { role: 'viewer' });
  check('4 the company default set to Viewer: 200', r.status === 200 && r.body.defaultRole === 'viewer');
  r = await call('PATCH', '/api/event', 'anyone', { eventId: 'ac-cio-1', name: 'x' });
  check('4 …a company account not on the list now reads only', r.status === 403 && r.body.code === 'view-only', r.text);
  await call('POST', '/api/access/default', 'sachitanand.rai', { role: 'editor' });
  r = await call('POST', '/api/access/member', 'sachitanand.rai', { email: 'nobody', role: 'editor', portals: ['*'] });
  check('4 a bad address: 400 bad-email', r.status === 400 && r.body.code === 'bad-email', r.text);
  r = await call('GET', '/api/access', 'bad');
  check('4 an expired sign-in: 401', r.status === 401);

  /* ================= 5. the pages ================= */
  var AUTH = read('auth.js'), INDEX = read('index.html'), SET = read('settings.html'), SA = read('settings-access.js');
  check('5 sign-in no longer hints Google to company accounts only', !/hd:\s*ALLOWED_DOMAIN/.test(AUTH) && /prompt: 'select_account'/.test(AUTH));
  check('5 …and asks the server right after the popup, signing out an account it refuses', /fetch\('\/api\/access\/me'/.test(AUTH) && /r\.status !== 403/.test(AUTH) && /revamp\/domain-not-allowed/.test(AUTH));
  check('5 …a remembered sign-in on another domain is no longer signed out by the page (the server decides)', !/if \(user && !isAllowedEmail\(user\.email\)\)/.test(AUTH));
  check('5 the sign-in page names invited accounts and says why an account was refused', /or the Google account you were invited with/.test(INDEX) && /denied === 'blocked'/.test(INDEX) &&
    /no longer has access to ETB2B EventSphere/.test(INDEX) && /has not been given access to ETB2B EventSphere/.test(INDEX));
  check('5 a Viewer is told on every page (RevampAuth.access, data-rv-role)', /data-rv-role/.test(AUTH) && /View only — you can look at everything here, but not change it\./.test(AUTH) && /access: access,/.test(AUTH));
  check('5 the account menu shows the role and leads to Access & settings', /Access & settings/.test(AUTH) && /settings\.href = '\/settings\.html'/.test(AUTH));
  check('5 Settings has Access first, then Publishing approvals', SET.indexOf('id="ac-body"') !== -1 && SET.indexOf('id="ac-body"') < SET.indexOf('id="pa-body"') &&
    SET.indexOf('settings-access.js') !== -1 && SET.indexOf('settings-access.js') < SET.indexOf('settings.js"') && SET.indexOf('Revamp CMS') === -1);
  check('5 settings-access.js: the four roles and No access, each in words; portals; the default; the log', ['admin', 'approver', 'editor', 'viewer', 'blocked'].every(function (r) { return new RegExp('\\b' + r + ': \'').test(SA); }) &&
    /ORDER = \['admin', 'approver', 'editor', 'viewer', 'blocked'\]/.test(SA) && /All portals/.test(SA) && /Company accounts not on the list below/.test(SA) && /Changes to access/.test(SA) &&
    /C\.saveAccessMember/.test(SA) && /C\.removeAccessMember/.test(SA) && /C\.saveAccessDefault/.test(SA) && /el\('ac-keep'\)\.focus\(\)/.test(SA));
  var esbuild = path.join(ROOT, 'node_modules', '.bin', 'esbuild');
  if (fs.existsSync(esbuild)) {
    var cp = require('child_process');
    ['settings-access.js', 'auth.js', 'settings.js'].forEach(function (f) {
      var out = cp.spawnSync(esbuild, ['--target=es5', '--log-level=error', path.join(ROOT, f)], { encoding: 'utf8' });
      check('5 ' + f + ' is ES5', out.status === 0, out.stderr);
    });
  }
  check('5 the old page rule (access.js) keeps one source of the sentences', /no longer has access/.test(access.deniedMessage('blocked')) && typeof access.accessFor === 'function');

  process.stdout.write('access-control: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stderr.write('CRASH ' + (e && e.stack || e) + '\n'); process.exit(1); });
