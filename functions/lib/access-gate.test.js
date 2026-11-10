/* node functions/lib/access-gate.test.js — the sign-in gate of every CMS page and /api/* route (lib/access.js gate)
   follows Settings › Access (lib/access-control.js): a blocked company account is sent to sign-in with
   ?denied=blocked, an uninvited Google account with ?denied=1, an invited one is let in, and an API call is
   answered 403 { code: 'no-access' } in words. Without a database (a local server with no credentials) it falls
   back to the rule before Access: company accounts only. firebase-admin and lib/firebase.js are stand-ins here:
   no network, no real project. Exits 1 on any failure. */
'use strict';

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 500) : '') + '\n');
}
['log', 'info', 'warn', 'error'].forEach(function (k) { console[k] = function () {}; });

/* tokens: "<name>" is <name>@timesinternet.in, one with an @ is that address, "bad" does not verify */
function verify(t) {
  if (t === 'bad') return Promise.reject(new Error('expired'));
  var email = t.indexOf('@') !== -1 ? t : t + '@timesinternet.in';
  return Promise.resolve({ email: email, uid: 'u', email_verified: true, firebase: { sign_in_provider: 'google.com' } });
}
var fakeAdmin = { apps: [], initializeApp: function (o, name) { var app = { name: name, auth: function () { return { verifyIdToken: verify }; } }; fakeAdmin.apps.push(app); return app; } };
require.cache[require.resolve('firebase-admin')] = { id: require.resolve('firebase-admin'), filename: require.resolve('firebase-admin'), loaded: true, exports: fakeAdmin };

var DOCS = {}, noDb = false;
function snap(p) { var d = DOCS[p]; return { exists: !!d, data: function () { return d ? JSON.parse(JSON.stringify(d)) : undefined; } }; }
var FB = { db: { collection: function (c) { return { doc: function (id) { return { get: function () { return Promise.resolve(snap(c + '/' + id)); } }; } }; } } };
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true,
  exports: { getFirebase: function () { return noDb ? { error: 'no credentials' } : FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
delete process.env.ACCESS_CONFIG_DOC;
var access = require('./access');
var AC = require('./access-control');

function run(url, token, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = {};
    if (token && opts.bearer) headers.authorization = 'Bearer ' + token;
    else if (token) headers.cookie = 'theme=dark; __session=' + encodeURIComponent(token);
    var req = { url: url, method: 'GET', headers: headers };
    var res = { headersSent: false, status: 0, headers: {},
      writeHead: function (s, h) { res.status = s; res.headers = h || {}; res.headersSent = true; },
      end: function (b) { resolve({ status: res.status, headers: res.headers, body: b ? String(b) : '', req: req }); } };
    access.gate(req, res, function () { resolve({ next: true, req: req }); });
  });
}

(async function () {
  DOCS['config/access'] = { stored: true, defaultRole: 'editor', members: {
    'sachitanand.rai@timesinternet.in': { role: 'admin', portals: ['*'] }, 'gone@timesinternet.in': { role: 'blocked', portals: ['*'] },
    'guest@gmail.com': { role: 'viewer', portals: ['cio'] } } };
  AC.forget();
  var r = await run('/Event_Listing.html', 'member');
  check('a company account goes through, with its access on req.user', r.next === true && r.req.user.access.role === 'editor' && r.req.user.access.portals[0] === '*', r);
  r = await run('/Event_Listing.html', 'guest@gmail.com');
  check('an invited Google account goes through, as invited', r.next === true && r.req.user.access.role === 'viewer' && r.req.user.access.portals[0] === 'cio', r);
  r = await run('/Event_Listing.html?x=1', 'gone');
  check('a blocked company account: sent to sign-in with ?denied=blocked, and where it was going', r.status === 302 && r.headers.Location === '/?denied=blocked&next=' + encodeURIComponent('/Event_Listing.html?x=1'), r);
  r = await run('/Event_Listing.html', 'stranger@gmail.com');
  check('an uninvited Google account: ?denied=1', r.status === 302 && /^\/\?denied=1&next=/.test(r.headers.Location), r);
  r = await run('/Event_Listing.html', 'bad');
  check('an expired sign-in: back to sign-in, no denied', r.status === 302 && /^\/\?next=/.test(r.headers.Location), r);
  r = await run('/Event_Listing.html', '');
  check('no sign-in at all: sign-in', r.status === 302 && /^\/\?next=/.test(r.headers.Location), r);
  r = await run('/api/events', 'gone', { bearer: true });
  var body = {}; try { body = JSON.parse(r.body); } catch (e) { /* not JSON */ }
  check('an API call from a blocked account: 403 no-access, in words', r.status === 403 && body.code === 'no-access' && /no longer has access to ETB2B EventSphere/.test(body.error), r);
  r = await run('/api/events', 'stranger@gmail.com', { bearer: true });
  try { body = JSON.parse(r.body); } catch (e) { body = {}; }
  check('…from an uninvited one: 403, told to ask for an invitation', r.status === 403 && /has not been given access/.test(body.error), r);
  r = await run('/api/events', '', { bearer: true });
  check('…signed out: 401', r.status === 401, r);
  r = await run('/e/some-event', '');
  check('a published site stays public', r.next === true);

  noDb = true; AC.forget();
  r = await run('/Event_Listing.html', 'member');
  check('no database at all: a company account still goes through (the rule before Access)', r.next === true && r.req.user.access.role === 'editor', r);
  r = await run('/Event_Listing.html', 'guest@gmail.com');
  check('…and nobody from outside', r.status === 302 && /denied=1/.test(r.headers.Location), r);
  noDb = false;

  process.stdout.write('access-gate: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stderr.write('CRASH ' + (e && e.stack || e) + '\n'); process.exit(1); });
