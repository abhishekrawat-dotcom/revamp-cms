/* node functions/lib/et-library.test.js — the speaker and sponsor library (lib/et-library.js; the owner, 11 Nov 2026:
   "store all speakers data from ETAPI to your database … same for sponsors"): ET's records read per portal and kept,
   a person who spoke at several editions kept once, searched by name with EventSphere's own records first, only
   events the person may open, the build one at a time and within its time budget, and the routes. ET's API and
   Firestore are stand-ins: no network, no real project. Exits 1 on any failure. */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : '') + '\n');
}
['log', 'info', 'warn', 'error'].forEach(function (k) { console[k] = function () {}; });

/* ---------- ET's API ---------- */
var etEvents = require('./et-events');
var EVENTS = {
  ciso: [
    { id: '900', title: 'ETCISO Annual Conclave 2026', start: '2026-03-10T09:00:00', link: 'https://ciso.economictimes.indiatimes.com/conclave', speakers: 3, past: true, upcoming: false },
    { id: '800', title: 'ETCISO Decrypt 2025', start: '2025-08-01T09:00:00', link: 'https://ciso.economictimes.indiatimes.com/decrypt', speakers: 2, past: true, upcoming: false },
    { id: '950', title: 'ETCISO Secufest 2027', start: '2027-02-01T09:00:00', link: '', speakers: 0, past: false, upcoming: true }
  ],
  cio: [{ id: '700', title: 'ETCIO Annual 2025', start: '2025-12-01T09:00:00', link: 'https://cio.economictimes.indiatimes.com/annual', speakers: 1, past: true, upcoming: false }]
};
var LISTS = {
  'speaker/900': [{ speaker_name: 'Naven Singh', speaker_desig: 'Group CISO', speaker_company: 'Acme Bank', speaker_picture: 'cp/naven-2026.jpg', linkedin_url: 'linkedin.com/in/naven' },
    { speaker_name: 'Bruce Schneier', speaker_desig: 'Security Technologist', speaker_company: '', speaker_picture: 'cp/bruce.jpg' },
    { speaker_name: 'Hidden Person', status: '0' }],
  'speaker/800': [{ speaker_name: 'Naven  Singh', speaker_desig: 'CISO', speaker_company: 'Acme Bank', speaker_picture: 'cp/naven-2025.jpg', speaker_info: '<p>Security leader.</p>' },
    { speaker_name: 'Naven Singh', speaker_desig: 'CISO', speaker_company: 'Globex', speaker_picture: 'cp/naven-globex.jpg' }],
  'sponsor/900': [{ sponsor_title: 'SailPoint', sponsor_logo: 'sailpoint.png', group: { group_name: 'Gold Partners' }, url: 'https://sailpoint.com' }],
  'sponsor/800': [{ sponsor_title: 'SailPoint', sponsor_logo: 'sailpoint-old.png', group: { group_name: 'Platinum Partner' } }, { sponsor_title: 'Thales', sponsor_logo: 'thales.png' }],
  'speaker/700': [{ speaker_name: 'Shweta Singh', speaker_desig: 'SVP AI', speaker_company: 'Bharti AXA', speaker_picture: 'cp/shweta.jpg' }],
  'sponsor/700': []
};
var asked = [];
function fetchJson(url) {
  asked.push(url);
  var m = /\/v1\/activity\/(speaker|sponsor)\/list\?entity_id=(\d+)/.exec(url);
  var items = m ? LISTS[m[1] + '/' + m[2]] || [] : [];
  return Promise.resolve({ status: true, data: { items: items, is_last_page: true, total_pages: 1 } });
}
etEvents.listIpEvents = function (portal) { return Promise.resolve(EVENTS[portal] || []); };

/* ---------- Firestore ---------- */
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {};
  function snap(p) { var d = docs[p]; var parts = p.split('/'); return { id: parts[parts.length - 1], exists: !!d, data: function () { return d ? clone(d) : undefined; }, ref: refOf(p) }; }
  function refOf(p) {
    var parts = p.split('/');
    return { id: parts[parts.length - 1], path: p, parent: parts.length > 2 ? { id: parts[parts.length - 2], parent: { id: parts[parts.length - 3] } } : null,
      get: function () { return Promise.resolve(snap(p)); }, set: function (d) { docs[p] = clone(d); return Promise.resolve(); },
      collection: function (n) { return col(p + '/' + n); } };
  }
  function col(p) {
    var q = { doc: function (id) { return refOf(p + '/' + id); }, select: function () { return q; },
      get: function () { var l = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap); return Promise.resolve({ docs: l }); } };
    return q;
  }
  var db = {
    collection: col,
    collectionGroup: function (n) {
      var q = { select: function () { return q; }, get: function () {
        var l = Object.keys(docs).filter(function (k) { var parts = k.split('/'); return parts.length === 4 && parts[2] === n; }).map(snap);
        return Promise.resolve({ docs: l });
      } };
      return q;
    },
    getAll: function () { return Promise.all(Array.prototype.slice.call(arguments).map(function (r) { return r.get(); })); },
    runTransaction: function (fn) { var tx = { get: function (r) { return r.get(); }, set: function (r, d) { docs[r.path] = clone(d); } }; return Promise.resolve().then(function () { return fn(tx); }); }
  };
  var auth = { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } };
  return { db: db, docs: docs, auth: auth };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
var LIB = require('./et-library'), T = LIB._test;

function call(handler, method, url, token, body) {
  return new Promise(function (resolve) {
    var text = body ? JSON.stringify(body) : '';
    var req = { method: method, url: url, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, rawBody: Buffer.from(text) };
    req.on = function () { return req; };
    var res = { headersSent: false, writeHead: function (s) { res.status = s; res.headersSent = true; }, setHeader: function () {},
      end: function (b) { var j = null; try { j = JSON.parse(String(b)); } catch (e) { /* not JSON */ } resolve({ status: res.status, body: j }); } };
    handler(req, res);
  });
}

(async function () {
  /* 1. names */
  check('1 a name compared without case, accents or punctuation', T.normal(' Dr. Durgā  Prasad-Dube ') === 'dr durga prasad dube');
  check('1 every word typed begins a word of the name, in any order', T.scoreOf('sing nav', 'Naven Singh') > 0 && T.scoreOf('naven x', 'Naven Singh') === 0 && T.scoreOf('ven', 'Naven Singh') === 0);
  check('1 the whole name scores highest', T.scoreOf('naven singh', 'Naven Singh') > T.scoreOf('naven', 'Naven Singh'));

  /* 2. one portal read from ET */
  var doc = await T.buildPortal('ciso', fetchJson);
  check('2 only events that took place, newest first; the one to come is not read', JSON.stringify(doc.events.map(function (e) { return e.id + ':' + e.year; })) === '["900:2026","800:2025"]' &&
    !asked.some(function (u) { return /entity_id=950/.test(u); }), doc.events);
  var naven = doc.speakers.filter(function (s) { return s.n === 'Naven Singh' && s.c === 'Acme Bank'; });
  check('2 a person at two editions with the same company is one entry, the newest designation and photo, both events', naven.length === 1 && naven[0].d === 'Group CISO' &&
    /naven-2026\.jpg$/.test(naven[0].p) && JSON.stringify(naven[0].e) === '[0,1]' && naven[0].b === 'Security leader.' && naven[0].l === 'https://linkedin.com/in/naven', naven);
  check('2 the same name at another company is another entry', doc.speakers.some(function (s) { return s.c === 'Globex'; }));
  check('2 a speaker the edition does not show is left out', !doc.speakers.some(function (s) { return /Hidden/.test(s.n); }));
  var sail = doc.sponsors.filter(function (s) { return s.n === 'SailPoint'; });
  check('2 a sponsor at two editions is one entry with the newest logo and tier', sail.length === 1 && /sailpoint\.png$/.test(sail[0].g) && sail[0].t === 'Gold Partners' && sail[0].u === 'https://sailpoint.com' && sail[0].e.length === 2, sail);
  check('2 the counts', doc.counts.events === 2 && doc.counts.speakers === 3 && doc.counts.sponsors === 2, doc.counts);

  /* 3. searching */
  var cio = await T.buildPortal('cio', fetchJson);
  var own = [{ eventId: 'ev-a', id: 's1', event: { id: 'ev-a', name: 'CISO Secufest 2027', portal: 'ciso', createdAt: '2026-10-01' }, v: { name: 'Naven Singh', desig: 'Group CISO & DPO', comp: 'Acme Bank', status: 'confirmed' } },
    { eventId: 'ev-h', id: 's2', event: { id: 'ev-h', name: 'HR Summit', portal: 'hr', createdAt: '2026-10-01' }, v: { name: 'Naveen Singhal', desig: 'CHRO', comp: 'Globex', status: 'confirmed' } }];
  var hits = T.search('speakers', 'naven singh', { et: [doc, cio], own: own }, { portal: 'ciso' });
  check('3 the exact name first; EventSphere\'s own record merged with ET\'s: the team\'s designation, ET\'s photo, both sources',
    hits[0].name === 'Naven Singh' && hits[0].company === 'Acme Bank' && hits[0].designation === 'Group CISO & DPO' && /naven-2026/.test(hits[0].photo) &&
    hits[0].from.length === 2 && hits[0].from[0].kind === 'event' && hits[0].from[1].label === 'ET CISO · ETCISO Annual Conclave 2026'.replace('ET CISO', etEvents.PORTALS.ciso), hits[0]);
  check('3 the same name at another company is listed apart', hits.some(function (h) { return h.company === 'Globex' && h.name === 'Naven Singh'; }));
  check('3 two letters at least', T.search('speakers', 'n', { et: [doc] }).length === 0 && T.search('speakers', 'na', { et: [doc] }).length > 0);
  var scoped = T.search('speakers', 'singh', { et: [], own: own }, { access: { email: 'x@timesinternet.in', role: 'editor', portals: ['ciso'] } });
  check('3 EventSphere\'s own records only from events the person may open (Settings › Access)', scoped.length === 1 && scoped[0].name === 'Naven Singh', scoped.map(function (h) { return h.name; }));
  var sp = T.search('sponsors', 'sail', { et: [doc] }, {});
  check('3 sponsors: name, logo, website and tier', sp.length === 1 && sp[0].tier === 'Gold Partners' && /sailpoint\.png$/.test(sp[0].logo) && sp[0].url === 'https://sailpoint.com', sp);
  var bonus = T.search('speakers', 'singh', { et: [cio, doc] }, { portal: 'cio' });
  check('3 the event\'s own portal ranks first among equals', bonus[0].name === 'Shweta Singh', bonus.map(function (h) { return h.name; }));

  /* 4. building into the database */
  var built = await T.build(FB, { fetchJson: fetchJson, first: 'cio' });
  check('4 every portal read and stored, the event\'s own among the first read (three at a time)', built.built.slice(0, 3).indexOf('cio') !== -1 && !!FB.docs['etLibrary/ciso'] && !!FB.docs['etLibrary/cio'] && built.left === 0 && built.busy === false, built.built.slice(0, 4));
  check('4 coverage: portals, speakers, sponsors', built.coverage.speakers === 4 && built.coverage.sponsors === 2 && built.coverage.built === Object.keys(etEvents.PORTALS).length && built.coverage.stale === false, built.coverage);
  asked = [];
  var again = await T.build(FB, { fetchJson: fetchJson });
  check('4 a fresh library is not read again', again.built.length === 0 && asked.length === 0, again);
  FB.docs['etLibrary/_lock'] = { until: Date.now() + 60000 };
  var busy = await T.build(FB, { fetchJson: fetchJson });
  check('4 one builder at a time', busy.busy === true && busy.built.length === 0);
  FB.docs['etLibrary/_lock'] = { until: 0 };
  Object.keys(FB.docs).forEach(function (k) { if (/^etLibrary\/(?!_lock)/.test(k)) FB.docs[k].builtAt = '2020-01-01T00:00:00.000Z'; });
  var quick = etEvents.listIpEvents;
  etEvents.listIpEvents = function (portal) { return new Promise(function (r) { setTimeout(function () { r(EVENTS[portal] || []); }, 20); }); };
  var slow = await T.build(FB, { fetchJson: fetchJson, budgetMs: 30 });
  etEvents.listIpEvents = quick;
  check('4 within its time budget: what is left is said, and read by the next build', slow.left > 0 && slow.built.length < Object.keys(etEvents.PORTALS).length, { built: slow.built.length, left: slow.left });

  /* 5. the routes */
  T.forget();
  FB.docs['events/ev-a'] = { name: 'CISO Secufest 2027', portal: 'ciso', createdAt: '2026-10-01T00:00:00Z' };
  FB.docs['events/ev-a/speakers/s1'] = { name: 'Naven Singh', desig: 'Group CISO & DPO', comp: 'Acme Bank', status: 'confirmed', photoUrl: 'data:image/jpeg;base64,AAAA' };
  FB.docs['events/ev-a/speakers/s9'] = { name: 'Naven Singh', desig: 'Invited only', comp: 'Initech', status: 'invited' };
  var r = await call(LIB.handleSpeakers, 'GET', '/api/library/speakers?q=naven&eventId=ev-a', 'member');
  check('5 GET /api/library/speakers: results and coverage', r.status === 200 && r.body.items.length >= 2 && r.body.coverage && r.body.coverage.speakers === 4, r.body);
  check('5 …an own record\'s small photo is read for it; a speaker not confirmed is not in the library', r.body.items.some(function (h) { return h.photo === 'data:image/jpeg;base64,AAAA' || /naven-2026/.test(h.photo); }) &&
    !r.body.items.some(function (h) { return h.company === 'Initech'; }), r.body.items.map(function (h) { return [h.name, h.company, String(h.photo).slice(0, 30)]; }));
  check('5 …record ids are not sent', r.body.items.every(function (h) { return h.from.every(function (f) { return f.recordId === undefined; }); }));
  r = await call(LIB.handleSponsors, 'GET', '/api/library/sponsors?q=thal', 'member');
  check('5 GET /api/library/sponsors', r.status === 200 && r.body.items.length === 1 && r.body.items[0].name === 'Thales', r.body);
  r = await call(LIB.handleSpeakers, 'GET', '/api/library/speakers?q=naven', 'bad');
  var r2 = await call(LIB.handleBuild, 'POST', '/api/library/build', 'member', { eventId: 'ev-a' });
  check('5 POST /api/library/build answers with what was read and what is left', r2.status === 200 && Array.isArray(r2.body.built) && typeof r2.body.left === 'number', r2.body);

  process.stdout.write('et-library: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stderr.write('CRASH ' + (e && e.stack || e) + '\n'); process.exit(1); });
