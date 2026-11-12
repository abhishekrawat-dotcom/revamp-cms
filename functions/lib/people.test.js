/* node functions/lib/people.test.js — speaker and sponsor pages across ET (lib/people.js, lib/people-match.js,
   lib/people-page.js; the owner, 11 Nov 2026): one person per name and company across every portal, the newest
   details kept; slugs that never change; the public page (only what is public, never an email or a phone); the way
   from an event site; the sitemap; and the console's list, change, join, split and undo, with who may. ET's API is
   not used and Firestore is a stand-in: no network, no real project. Exits 1 on any failure. */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '') + '\n');
}
['log', 'info', 'warn', 'error'].forEach(function (k) { console[k] = function () {}; });

/* ---------- Firestore, as much as these modules use ---------- */
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
var autoId = 0;
function fakeFb() {
  var docs = {};
  function snap(p) { var d = docs[p]; var parts = p.split('/'); return { id: parts[parts.length - 1], exists: !!d, data: function () { return d ? clone(d) : undefined; }, ref: refOf(p) }; }
  function refOf(p) {
    var parts = p.split('/');
    return { id: parts[parts.length - 1], path: p, parent: parts.length > 2 ? { id: parts[parts.length - 2], parent: { id: parts[parts.length - 3] } } : null,
      get: function () { return Promise.resolve(snap(p)); },
      set: function (d, o) { docs[p] = o && o.merge ? Object.assign(clone(docs[p] || {}), clone(d)) : clone(d); return Promise.resolve(); },
      collection: function (n) { return col(p + '/' + n); } };
  }
  function query(p, filters, order, lim) {
    return {
      where: function (f, op, v) { return query(p, filters.concat([[f, op, v]]), order, lim); },
      select: function () { return query(p, filters, order, lim); },
      orderBy: function (f, dir) { return query(p, filters, [f, dir], lim); },
      limit: function (n) { return query(p, filters, order, n); },
      doc: function (id) { return refOf(p + '/' + (id || ('auto' + (++autoId)))); },
      get: function () {
        var l = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        l = l.filter(function (s) {
          var d = s.data();
          return filters.every(function (f) { return f[1] === '==' ? d[f[0]] === f[2] : f[1] === 'array-contains' ? (d[f[0]] || []).indexOf(f[2]) !== -1 : true; });
        });
        if (order) l = l.filter(function (s) { return s.data()[order[0]] != null; }).sort(function (a, b) { var x = a.data()[order[0]], y = b.data()[order[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (order[1] === 'desc' ? -1 : 1); });
        if (lim) l = l.slice(0, lim);
        return Promise.resolve({ docs: l });
      }
    };
  }
  function col(p) { return query(p, [], null, 0); }
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
    runTransaction: function (fn) {
      var tx = { get: function (r) { return r.get(); }, getAll: function () { return Promise.all(Array.prototype.slice.call(arguments).map(function (r) { return r.get(); })); },
        set: function (r, d) { docs[r.path] = clone(d); } };
      return Promise.resolve().then(function () { return fn(tx); });
    }
  };
  return { db: db, docs: docs };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };

var PM = require('./people-match');
var P = require('./people'), T = P._test;
var PAGE = require('./people-page');
var siteChecks = require('./site-checks');

/* ---------- what the routes are given (lib/api.js wires the real ones) ---------- */
var USERS = {
  admin: { email: 'admin@timesinternet.in', role: 'admin', portals: ['*'] },
  ciso: { email: 'asha@timesinternet.in', role: 'editor', portals: ['ciso'] },
  hr: { email: 'ravi@timesinternet.in', role: 'editor', portals: ['hr'] },
  viewer: { email: 'vic@timesinternet.in', role: 'viewer', portals: ['*'] }
};
function respond() {
  var out = { status: 0, headers: {}, body: null, text: '' };
  out.done = new Promise(function (ok) { out.ok = ok; });
  out.res = {
    headersSent: false,
    setHeader: function (k, v) { out.headers[k.toLowerCase()] = v; },
    writeHead: function (s, h) { out.status = s; Object.keys(h || {}).forEach(function (k) { out.headers[k.toLowerCase()] = h[k]; }); out.res.headersSent = true; },
    end: function (b) { out.text = String(b == null ? '' : b); out.ok(); }
  };
  return out;
}
var H = {
  firebase: function () { return FB; },
  isEventId: function (v) { return /^[a-z0-9][a-z0-9-]{0,99}$/.test(String(v || '')); },
  sendHtml: function (req, res, status, html, cache) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache }); res.end(html); },
  messagePage: function (t, m, link) { return '<!DOCTYPE html><meta name="robots" content="noindex"><h1>' + t + '</h1><p>' + m + '</p>' + (link ? '<a href="' + link.href + '">' + link.label + '</a>' : ''); },
  sendText: function (req, res, status, type, text, cache) { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache }); res.end(text); },
  sendJson: function (res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); },
  publicBaseFor: function () { return 'https://sites.test'; },
  requireAdmin: function (req, res, cb) { cb(FB, { email: req.user.email, access: req.user }); },
  withAdminBody: function (req, res, max, cb) { cb(FB, { email: req.user.email, access: req.user }, req.body || {}); },
  looksLikeTest: siteChecks.looksLikeTest
};
P.wire(H);
function call(fn, method, url, user, body) {
  var r = respond();
  fn({ method: method, url: url, headers: {}, user: USERS[user] || USERS.admin, body: body }, r.res);
  return r.done.then(function () { var j = null; try { j = JSON.parse(r.text); } catch (e) { /* html */ } r.body = j; return r; });
}
function page(url) {
  var r = respond(), m = /^\/(speakers|sponsors)\/([^?]+)/.exec(url);
  P.routePublic({ method: 'GET', url: url, headers: {} }, r.res, m[1], m[2]);
  return r.done.then(function () { return r; });
}

(async function () {
  /* 1. one person: the matching */
  check('1 a name without its title, case or accents', PM.nameKey('Dr. Durgā  Prasad-Dube') === 'durga prasad dube' && PM.nameKey('Lt Gen Dr Rajesh Pant') === 'rajesh pant' && PM.nameKey('Shri Vinod Bhat') === 'vinod bhat');
  function same(a, b) { return PM.sameCompany(PM.companyForm(a), PM.companyForm(b)); }
  check('1 companies as people write them: legal endings, a closing India, one continuing the other, spaces, a plural',
    same('Cadila Pharmaceuticals Limited', 'Cadila Pharmaceuticals') && same('Sandoz India', 'Sandoz') && same('ETAuto & ETManufacturing', 'ETAuto') &&
    same('Home First Finance', 'HomeFirst Finance') && same('Storia Foods & Beverages', 'Storia Food and Beverage') && same('Usha Martin University, Ranchi, Jharkhand', 'Usha Martin University'));
  check('1 …and short forms: given in brackets, or the initials', same('National Stock Exchange of India Ltd. (NSE)', 'NSE') && same('Delhi Metro Rail Corporation', 'DMRC Ltd.') && same('STPI', 'Software Technology Parks of India'));
  check('1 …and different companies stay different', !same('Salesforce', 'ServiceNow') && !same('Tata Steel', 'Tata Motors') && !same('', 'Acme') && !same('Government of India', 'Government of Rajasthan'));
  var g = PM.groupPeople([
    { name: 'Vishant Vora', company: 'Vodafone Idea', designation: 'Chief Technology Officer', at: '2020' },
    { name: 'Vishant Vora', company: '', designation: 'CTO, Vodafone Idea Limited', at: '2019' },
    { name: 'Vishant Vora', company: 'Jio', designation: 'CTO', at: '2024-03-01' }
  ]);
  check('1 a row with no company joins the person its designation names; another company is another person; newest first', g.length === 2 && g[0][0].company === 'Jio' && g[1].length === 2 && g[1][0].at === '2020', g);
  g = PM.groupPeople([{ name: 'Jahid Ahmed', company: 'HDFC Bank', at: '2026' }, { name: 'Jahid Ahmed', company: '', designation: 'Senior Vice President', at: '2023' }]);
  check('1 …a row that says nothing joins the only person of that name', g.length === 1 && g[0].length === 2);
  g = PM.groupPeople([{ name: 'A K', company: 'X Bank', at: '2026' }, { name: 'A K', company: 'Y Bank', at: '2025' }, { name: 'A K', company: '', designation: 'Speaker', at: '2024' }, { name: 'A K', company: '', designation: 'Guest', at: '2023' }]);
  check('1 …with two people of that name, it waits apart (one "unknown" person)', g.length === 3 && g[2].length === 2, g.map(function (x) { return x.length; }));
  var sp = PM.sponsorsOf([{ name: 'Google', at: '2026' }, { name: 'Google Cloud', at: '2025' }, { name: 'Sandoz India Pvt Ltd', at: '2024' }, { name: 'Sandoz', at: '2023' }, { name: 'Tata Consultancy Services (TCS)', at: '2022' }, { name: 'TCS', at: '2021' }]);
  check('1 sponsors: the same name, a short form in brackets; one name continuing another is not enough', sp.length === 4 && sp.some(function (x) { return x.length === 2 && /Sandoz/.test(x[0].name); }) &&
    sp.some(function (x) { return x.length === 2 && /TCS/.test(x[0].name + x[1].name); }), sp.map(function (x) { return x.map(function (r) { return r.name; }); }));
  /* one person by a LinkedIn that is surely theirs (the owner, 12 Nov 2026) */
  check('1 a LinkedIn profile\'s handle, and never a company page, a bare address or "me"', PM.linkedinHandle('https://www.linkedin.com/in/Vinod-Bhat-1a2b/') === 'vinod-bhat-1a2b' &&
    PM.linkedinHandle('in.linkedin.com/pub/x-y/1/2') === 'x-y' && PM.linkedinHandle('https://www.linkedin.com/company/acme') === '' && PM.linkedinHandle('https://linkedin.com') === '' && PM.linkedinHandle('linkedin.com/in/me') === '');
  var LR = [{ name: 'Vinkesh Gulati', company: 'A', linkedin: 'linkedin.com/in/vinkesh-gulati-b3024824' }, { name: 'Mudit Dobhal', company: 'B', linkedin: 'https://www.linkedin.com/in/vinkesh-gulati-b3024824' },
    { name: 'Arun Subramanian', linkedin: 'linkedin.com/in/arunsubra' }, { name: 'Manoj Jain', linkedin: 'linkedin.com/in/arunsubra' }, { name: 'Rahul Ghosh', linkedin: 'linkedin.com/in/arunsubra' },
    { name: 'Krishnan Sadagopan', company: 'Ashok Leyland', designation: 'Head of R&D', linkedin: 'https://www.linkedin.com/in/krishnan-sadagopan-123', at: '2024' },
    { name: 'Krishnan Sadagopan', company: 'Indian Oil Corporation', designation: 'Independent Director', linkedin: 'https://in.linkedin.com/in/krishnan-sadagopan-123/', at: '2026' },
    { name: 'S K', company: 'X', linkedin: 'linkedin.com/in/abc123' }, { name: 'S K', company: 'Y', linkedin: 'linkedin.com/in/abc123' },
    { name: 'Asha Rao', company: 'P', linkedin: 'linkedin.com/in/zz-other-person' }, { name: 'Bina Shah', company: 'Q', linkedin: 'linkedin.com/in/zz-other-person' }];
  var LT = PM.linkTrust(LR);
  check('1 a link on several people is theirs only whose name is in it; on no one, when none\'s or more than one\'s is',
    PM.linkOf(LR[0], LT) === 'vinkesh-gulati-b3024824' && PM.linkOf(LR[1], LT) === '' && PM.linkOf(LR[2], LT) === 'arunsubra' && PM.linkOf(LR[3], LT) === '' && PM.linkOf(LR[4], LT) === '' &&
    PM.linkOf(LR[9], LT) === '' && PM.linkOf(LR[10], LT) === '', LT);
  check('1 …a link only one person has, without their name in it: shown as theirs, never a reason to join', PM.linkOf(LR[7], LT) === 'abc123' && !LT.join.abc123 && PM.peopleOf(LR.slice(7, 9), { trust: LT }).length === 2);
  check('1 the same name and a LinkedIn surely theirs: one person, whatever the company (newest first); without it, two',
    PM.peopleOf(LR.slice(5, 7), { trust: LT }).length === 1 && PM.peopleOf(LR.slice(5, 7), { trust: LT })[0][0].company === 'Indian Oil Corporation' && PM.peopleOf(LR.slice(5, 7)).length === 2);
  check('1 …and a team-typed link no record has is theirs; one pasted on others is no one\'s', PM.linkOf({ name: 'New Person', src: 'own', linkedin: 'linkedin.com/in/new-person-9' }, LT) === 'new-person-9' &&
    PM.linkOf({ name: 'Manoj Jain', src: 'own', linkedin: 'linkedin.com/in/arunsubra' }, LT) === '');
  var idxL = { people: { 'krishnan-sadagopan': { n: 'Krishnan Sadagopan', k: ['e~auto~a'] }, 'krishnan-sadagopan-indian-oil': { n: 'Krishnan Sadagopan', k: ['e~energy~b'] } }, alias: {} };
  var rowsL = [Object.assign({ key: 'e~auto~a', portal: 'auto', src: 'et', x: { e: [0] } }, LR[5]), Object.assign({ key: 'e~energy~b', portal: 'energy', src: 'et', x: { e: [0] } }, LR[6])];
  T.place('speakers', idxL, PM.peopleOf(rowsL, { trust: LT }), { portals: { auto: true, energy: true }, own: true, trust: LT });
  check('1 two pages the LinkedIn shows are one: joined, the other address leads there; its LinkedIn kept', Object.keys(idxL.people).length === 1 && Object.keys(idxL.alias).length === 1 &&
    idxL.people[Object.keys(idxL.people)[0]].li === 'krishnan-sadagopan-123' && idxL.people[Object.keys(idxL.people)[0]].l === 1, idxL);
  var KP = PAGE.render({ kind: 'speakers', slug: 'krishnan-sadagopan', name: 'Krishnan Sadagopan', designation: 'Independent Director', company: 'Indian Oil Corporation',
    journey: [{ key: 'et:1', title: 'ETAuto Tech 2024', year: '2024', date: '2024-03-01', company: 'Ashok Leyland', designation: 'Head of R&D', sessions: [] }, { key: 'et:2', title: 'ETEnergy Summit 2026', year: '2026', date: '2026-02-01', company: 'Indian Oil Corporation', designation: 'Independent Director', sessions: [] }],
    stats: { events: 2 }, sections: [], links: [] }, { base: 'https://sites.test', today: '2026-11-12' });
  check('1 …the page tells the journey: who they were at each edition with another company', /Then Head of R&amp;D at Ashok Leyland/.test(KP) && (KP.match(/class="was"/g) || []).length === 1);
  check('1 a slug', PM.slugify('Dr. Kiran Bedi') === 'dr-kiran-bedi' && PM.slugify('  ') === '' && PM.slugify('L&T Finance') === 'l-and-t-finance');

  /* 2. the index: slugs that never change */
  function row(key, name, company, at, extra) { return Object.assign({ key: key, name: name, company: company || '', designation: '', at: at || '2025', portal: key.split('~')[1], src: 'et', x: { e: [0] } }, extra || {}); }
  var idx = { people: {}, alias: {} };
  var rowsA = [row('e~ciso~naven singh|acme bank', 'Naven Singh', 'Acme Bank', '2026-03-10'), row('e~cio~naven singh|acme bank ltd', 'Naven Singh', 'Acme Bank Ltd', '2025-12-01'),
    row('e~ciso~naven singh|globex', 'Naven Singh', 'Globex', '2024'), row('e~hr~shweta singh|bharti axa', 'Shweta Singh', 'Bharti AXA', '2025')];
  var st = T.place('speakers', idx, PM.peopleOf(rowsA), { portals: { ciso: true, cio: true, hr: true }, own: true });
  check('2 one page per person across portals; the person with the most rows has the plain slug, the other the name and company',
    Object.keys(idx.people).sort().join(',') === 'naven-singh,naven-singh-globex,shweta-singh' && idx.people['naven-singh'].k.length === 2 && st.made === 3, idx.people);
  check('2 …the summary: newest name and company, portals, editions', idx.people['naven-singh'].c === 'Acme Bank' && idx.people['naven-singh'].p.join() === 'ciso,cio' && idx.people['naven-singh'].ev === 2 && idx.people['naven-singh'].y === '2026-03-10', idx.people['naven-singh']);
  var before = JSON.stringify(idx);
  T.place('speakers', idx, PM.peopleOf(rowsA), { portals: { ciso: true, cio: true, hr: true }, own: true });
  check('2 placing the same rows again changes nothing', JSON.stringify(idx) === before);
  var rowsB = rowsA.concat([row('o~ev-a~s1', 'Naven Singh', 'Acme Bank', '2027-03-11', { src: 'own', portal: 'ciso' })]);
  T.place('speakers', idx, PM.peopleOf(rowsB), { portals: { ciso: true, cio: true, hr: true }, own: true });
  check('2 a new row joins its person; the slugs stay', idx.people['naven-singh'].k.indexOf('o~ev-a~s1') !== -1 && Object.keys(idx.people).length === 3);
  /* a person split in two before (another spelling the matching did not know): joined now, the other address leads here */
  var idx2 = { people: { 'r-k-vishnoi': { n: 'R K Vishnoi', k: ['e~energy~r k vishnoi|thdc india limited'] }, 'r-k-vishnoi-thdcil': { n: 'R K Vishnoi', k: ['e~power~r k vishnoi|thdcil'] } }, alias: {} };
  var rowsC = [row('e~energy~r k vishnoi|thdc india limited', 'R K Vishnoi', 'THDC India Limited', '2025'), row('e~power~r k vishnoi|thdc india ltd', 'R K Vishnoi', 'THDC India Ltd', '2024'), row('e~power~r k vishnoi|thdcil', 'R K Vishnoi', 'THDC India Ltd (THDCIL)', '2024')];
  T.place('speakers', idx2, PM.peopleOf(rowsC), { portals: { energy: true, power: true }, own: true });
  check('2 two pages the matching now finds one person: joined, the other slug redirects', Object.keys(idx2.people).join() === 'r-k-vishnoi' && idx2.alias['r-k-vishnoi-thdcil'] === 'r-k-vishnoi' && idx2.people['r-k-vishnoi'].k.length === 3, idx2);
  idx2 = { people: { 'r-k-vishnoi': { n: 'R K Vishnoi', k: ['e~energy~r k vishnoi|thdc india limited'], m: true }, 'r-k-vishnoi-thdcil': { n: 'R K Vishnoi', k: ['e~power~r k vishnoi|thdcil'], m: true } }, alias: {} };
  T.place('speakers', idx2, PM.peopleOf(rowsC), { portals: { energy: true, power: true }, own: true });
  check('2 …never two the team split by hand', Object.keys(idx2.people).length === 2 && !Object.keys(idx2.alias).length);
  T.place('speakers', idx, PM.peopleOf(rowsA.slice(0, 3)), { portals: { ciso: true, cio: true }, own: false });
  check('2 a row no longer there leaves its page only when its source was read this time', idx.people['shweta-singh'].k.length === 1 && idx.people['naven-singh'].k.indexOf('o~ev-a~s1') !== -1);
  T.place('speakers', idx, PM.peopleOf(rowsA.slice(0, 3)), { portals: { ciso: true, cio: true, hr: true }, own: true });
  check('2 …and goes when it was; its person keeps the slug', idx.people['shweta-singh'] && idx.people['shweta-singh'].k.length === 0 && idx.people['naven-singh'].k.indexOf('o~ev-a~s1') === -1);
  check('2 a shard per slug, always the same', T.shardOf('speakers', 'naven-singh') === T.shardOf('speakers', 'naven-singh') && T.shardOf('speakers', 'naven-singh') < 16);

  /* 3. what the team adds */
  var c = T.cleanPage('speakers', { set: { name: '  Naven  Singh ', linkedin: 'linkedin.com/in/naven', photo: 'data:image/jpeg;base64,AAAA', x: '' }, about: 'Line one.\r\n\r\n\r\n\r\nLine two.', sections: [{ heading: 'Awards', text: 'CISO of the year' }, { heading: '', text: '' }],
    links: [{ label: '', url: 'https://www.youtube.com/watch?v=1' }], hideEvents: ['et:900', 'bogus', 'et:900'] });
  check('3 a page cleaned: spaces, https added, empty parts left out, a link named by its site', c.page && c.page.set.name === 'Naven Singh' && c.page.set.linkedin === 'https://linkedin.com/in/naven' && !('x' in c.page.set) &&
    c.page.about === 'Line one.\n\nLine two.' && c.page.sections.length === 1 && c.page.links[0].label === 'youtube.com' && c.page.hideEvents.join() === 'et:900', c);
  check('3 a LinkedIn that is not LinkedIn, a picture that is not https or uploaded, a link that is not one: refused',
    !!T.cleanPage('speakers', { set: { linkedin: 'https://evil.test/in/x' } }).error && !!T.cleanPage('speakers', { set: { photo: 'javascript:alert(1)' } }).error && !!T.cleanPage('speakers', { links: [{ label: 'x', url: 'javascript:alert(1)' }] }).error);

  /* 4. the pages, from a stand-in library and EventSphere's own events */
  FB.docs['etLibrary/ciso'] = { portal: 'ciso', portalName: 'ETCISO', builtAt: new Date().toISOString(),
    events: [{ id: '900', title: 'ETCISO Annual Conclave 2026', year: '2026', start: '2026-03-10', link: 'https://ciso.economictimes.indiatimes.com/conclave' }, { id: '800', title: 'ETCISO Decrypt 2025', year: '2025', start: '2025-08-01', link: 'https://ciso.economictimes.indiatimes.com/decrypt' },
      { id: '5000', kind: 'award', title: 'ETCISO Awards 2024', year: '2024', start: '2024-11-01', link: 'https://ciso.economictimes.indiatimes.com/awards' }],
    speakers: [{ n: 'Naven Singh', d: 'Group CISO', c: 'Acme Bank', p: 'https://img.etb2bimg.com/files/cp/naven.jpg', l: 'https://linkedin.com/in/naven', b: 'Security leader.', e: [0, 1, 2], rs: ['Keynote Address', '', 'Grand Jury'] },
      { n: 'Naven Singh', d: 'CISO', c: 'Globex', p: '', e: [1] }],
    sponsors: [{ n: 'SailPoint', g: 'https://img.etb2bimg.com/files/cp/sailpoint.png', u: 'https://sailpoint.com', t: 'Gold Partners', e: [0, 1], ts: ['Gold Partners', 'Platinum Partner'] }], counts: { events: 2, speakers: 2, sponsors: 1 } };
  FB.docs['etLibrary/cio'] = { portal: 'cio', portalName: 'ETCIO', builtAt: new Date().toISOString(),
    events: [{ id: '700', title: 'ETCIO Annual 2025', year: '2025', start: '2025-12-01', link: 'https://cio.economictimes.indiatimes.com/annual' }],
    speakers: [{ n: 'Naven Singh', d: 'CISO & CTO', c: 'Acme Bank Ltd', p: 'https://img.etb2bimg.com/files/cp/naven-cio.jpg', e: [0] }], sponsors: [{ n: 'SailPoint Technologies', g: 'https://img.etb2bimg.com/files/cp/sp2.png', e: [0] }], counts: { events: 1, speakers: 1, sponsors: 1 } };
  FB.docs['etLibraryAgenda/ciso'] = { portal: 'ciso', events: [{ i: 0, id: '900', s: [{ t: 'Zero trust in BFSI', a: '2026-03-10 11:30:00', z: '', d: 'How banks verify every request.', k: ['naven singh|acme bank', 'naven singh|globex'] }, { t: 'Someone else’s talk', a: '2026-03-10 12:00:00', k: ['x|y'] }] }],
    bios: { 'naven singh|acme bank': 'Security leader. ' + Array(40).join('He has led security programmes at three banks. ') } };
  FB.docs['events/ciso-secufest-summit-2027'] = { name: 'CISO Secufest Summit 2027', portal: 'ciso', category: 'ip', createdAt: '2026-10-01T00:00:00Z', start: '2027-03-11T09:00', published: true };
  FB.docs['events/ciso-secufest-summit-2027/speakers/s1'] = { name: 'Naven Singh', desig: 'Group CISO & DPO', comp: 'Acme Bank', status: 'confirmed', email: 'naven.private@acme.test', phone: '+91 99999 00000' };
  FB.docs['events/ciso-secufest-summit-2027/sessions/x1'] = { title: 'Keynote: Cyber resilience', start: '10:30', speakerIds: ['s1'] };
  FB.docs['events/ciso-secufest-summit-2027/partners/p1'] = { name: 'SailPoint', status: 'confirmed', tierId: 't1', email: 'deals@sailpoint.test' };
  FB.docs['events/ciso-secufest-summit-2027/partnerTiers/t1'] = { name: 'Associate Partner' };
  FB.docs['events/national-data-center-symposium'] = { name: 'National Data Center Symposium', portal: 'ciso', createdAt: '2026-10-01T00:00:00Z', start: '2027-12-09T09:30', published: true };
  FB.docs['events/national-data-center-symposium/speakers/d1'] = { name: 'Naven Singh', desig: 'Group CISO', comp: 'Acme Bank', status: 'confirmed' };
  FB.docs['events/digiplus-awards-2027'] = { name: 'Digiplus Awards 2027', portal: 'brandequity', category: 'awards', createdAt: '2026-10-01T00:00:00Z', published: true };
  FB.docs['events/digiplus-awards-2027/speakers/j1'] = { name: 'Naven Singh', desig: 'Juror', comp: 'Acme Bank', status: 'confirmed' };
  FB.docs['events/draft-x'] = { name: 'Draft Summit', portal: 'hr', createdAt: '2026-10-01T00:00:00Z', published: false };
  FB.docs['events/draft-x/speakers/h1'] = { name: 'Priya Nair', desig: 'CHRO', comp: 'Initech', status: 'confirmed' };
  var made = await P.reconcileAll(FB);
  check('4 the index built from ET and EventSphere: people and sponsors', made.speakers.people === 3 && made.sponsors.people === 1, made);
  var ix = await T.readIndex(FB, 'speakers', true);
  check('4 …the jury of an awards event is not a speaker', !Object.keys(ix.byRow).some(function (k) { return /digiplus/.test(k); }) && !!ix.byRow['o~national-data-center-symposium~d1']);
  var r = await page('/speakers/naven-singh?from=ciso-secufest-summit-2027');
  var html = r.text;
  check('4 GET /speakers/<slug>: 200, the newest details (the team\'s record on a live event), ET\'s photo', r.status === 200 && /<h1 id="h-name">Naven Singh<\/h1>/.test(html) && /Group CISO &amp; DPO/.test(html) && /naven\.jpg|naven-cio\.jpg/.test(html), html.slice(0, 400));
  check('4 …the journey: the live event first ("Speaking next"), each ET edition by year, sessions under each, the CIO portal\'s edition too',
    /Speaking next/.test(html) && /CISO Secufest Summit 2027/.test(html) && /Keynote: Cyber resilience/.test(html) && /ETCISO Annual Conclave 2026/.test(html) && /Zero trust in BFSI/.test(html) && /11:30 am/.test(html) &&
    /ETCIO Annual 2025/.test(html) && /ETCISO Decrypt 2025/.test(html) && !/Someone else/.test(html), html);
  check('4 …never a dummy event, an awards jury, an email or a phone', !/National Data Center/.test(html) && !/Digiplus/.test(html) && !/naven\.private|99999/.test(html));
  check('4 …the way back to the event, the canonical address, the person\'s structured data, no script but that',
    /<a class="back" href="\/e\/ciso-secufest-summit-2027">/.test(html) && /<link rel="canonical" href="https:\/\/sites\.test\/speakers\/naven-singh">/.test(html) && /"@type":"ProfilePage"/.test(html) && /"@type":"Person"/.test(html) &&
    (html.match(/<script/g) || []).length === 1 && /<script type="application\/ld\+json">/.test(html));
  check('4 …counts: events, sessions, award juries, the first year, the portals', /<b>4<\/b>ETB2B events/.test(html) && /<b>2<\/b>sessions/.test(html) && /<b>1<\/b>award jury/.test(html) && /<b>2024<\/b>first with ETB2B/.test(html), (html.match(/<ul class="stats"[\s\S]*?<\/ul>/) || [''])[0]);
  check('4 …their role at each edition, the award they judged, a session\'s description, who shared it (a link to their page), the whole bio',
    /<span class="tier">Keynote Address<\/span>/.test(html) && /ETCISO Awards 2024/.test(html) && /<span class="tier">Grand Jury<\/span>/.test(html) && /How banks verify every request\./.test(html) &&
    /With <a href="\/speakers\/naven-singh-globex">Naven Singh<\/a>/.test(html) && /three banks\. He has led/.test(html), (html.match(/Journey with[\s\S]{0,1600}/) || [''])[0]);
  check('4 …never a bare "ET" in what a visitor reads (ETB2B, The Economic Times Business Verticals)', !/\bET\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')) && /The Economic Times Business Verticals/.test(html));
  r = await page('/speakers/naven-singh?from=draft-x');
  check('4 …no way back to an event that is not live', r.status === 200 && !/class="back"/.test(r.text));
  r = await page('/speakers/priya-nair');
  check('4 a person whose only event is not live has no page yet', r.status === 404 && /noindex/.test(r.text));
  r = await page('/speakers/no-such-person');
  check('4 an address that is no one: 404', r.status === 404);
  r = await page('/sponsors/sailpoint');
  check('4 GET /sponsors/<slug>: the tier at each edition, the live event\'s tier, the website, no email', r.status === 200 && /Gold Partner\b/.test(r.text) && /Platinum Partner/.test(r.text) && /Associate Partner/.test(r.text) &&
    /https:\/\/sailpoint\.com/.test(r.text) && /Partnerships with ETB2B/.test(r.text) && !/deals@/.test(r.text) && /"@type":"Organization"/.test(r.text), r.text.slice(0, 300));

  /* 5. from an event site */
  r = await page('/speakers/go?e=ciso-secufest-summit-2027&r=s1&n=Naven%20Singh&c=Acme%20Bank');
  check('5 /speakers/go by the record: 302 to the page, with the way back', r.status === 302 && r.headers.location === '/speakers/naven-singh?from=ciso-secufest-summit-2027', r.headers);
  r = await page('/speakers/go?e=ciso-secufest-summit-2027&n=Naven%20Singh&c=Globex');
  check('5 …by name and company (a previous edition\'s card)', r.status === 302 && /^\/speakers\/naven-singh-globex\?/.test(r.headers.location), r.headers);
  r = await page('/speakers/go?e=ciso-secufest-summit-2027&n=Naven%20Singh&c=Initech');
  check('5 …a name with another company is not guessed: a page back to the event', r.status === 404 && /href="\/e\/ciso-secufest-summit-2027"/.test(r.text));
  r = await page('/sponsors/go?e=ciso-secufest-summit-2027&n=SailPoint');
  check('5 /sponsors/go by name', r.status === 302 && /^\/sponsors\/sailpoint\?from=/.test(r.headers.location), r.headers);

  /* 6. the console */
  var L = await call(P.handleList, 'GET', '/api/people/speakers?q=naven', 'viewer');
  check('6 the list: found by name, one per person', L.status === 200 && L.body.items.length === 2 && L.body.items[0].slug === 'naven-singh' && L.body.count === 3, L.body);
  L = await call(P.handleList, 'GET', '/api/people/speakers?per=25&page=1', 'viewer');
  check('6 the list: everyone, most events first, a page at a time, with the total and the portals to filter by', L.status === 200 && L.body.total === 3 && L.body.pages === 1 && L.body.per === 25 &&
    L.body.items[0].slug === 'naven-singh' && L.body.items[0].editions >= L.body.items[1].editions && L.body.portals.some(function (x) { return x.slug === 'ciso' && x.count >= 2; }), L.body);
  check('6 …each row says its designation, sessions, juries and what the page lacks', L.body.items[0].designation && L.body.items[0].sessions >= 1 && L.body.items[0].juries === 1 &&
    Array.isArray(L.body.items[0].missing), L.body.items[0]);
  var L2 = await call(P.handleList, 'GET', '/api/people/speakers?per=25&company=globex', 'viewer');
  var L3 = await call(P.handleList, 'GET', '/api/people/speakers?designation=group%20ciso&jury=1', 'viewer');
  var L4 = await call(P.handleList, 'GET', '/api/people/speakers?profile=no-photo', 'viewer');
  var L5 = await call(P.handleList, 'GET', '/api/people/speakers?portal=cio', 'viewer');
  var L6 = await call(P.handleList, 'GET', '/api/people/speakers?sort=name&per=25&page=9', 'viewer');
  check('6 …filters: company, designation and jury, a profile lacking a photo, a portal; a page past the last is the last',
    L2.body.total === 1 && L2.body.items[0].slug === 'naven-singh-globex' && L3.body.total === 1 && L3.body.items[0].slug === 'naven-singh' &&
    L4.body.items.every(function (x) { return x.missing.indexOf('photo') !== -1; }) && L4.body.items.some(function (x) { return x.slug === 'naven-singh-globex'; }) && !L4.body.items.some(function (x) { return x.slug === 'naven-singh'; }) &&
    L5.body.items.length === 1 && L5.body.items[0].slug === 'naven-singh' && L6.body.page === 1 && L6.body.items[0].name <= L6.body.items[L6.body.items.length - 1].name,
    [L2.body.total, L3.body.total, L4.body.items.map(function (x) { return x.slug; }), L5.body.items.map(function (x) { return x.slug; }), L6.body.page]);
  var C1 = await call(P.handleList, 'GET', '/api/people/speakers?has=linkedin,photo', 'viewer');
  var C2 = await call(P.handleList, 'GET', '/api/people/speakers?has=company&lacks=photo,linkedin', 'viewer');
  var C3 = await call(P.handleList, 'GET', '/api/people/speakers?complete=100', 'viewer');
  var C4 = await call(P.handleList, 'GET', '/api/people/speakers?sort=complete-asc', 'viewer');
  var C5 = await call(P.handleList, 'GET', '/api/people/speakers?profile=no-photo', 'viewer');
  check('6 fields combined: with LinkedIn and a photo; with a company but no photo and no LinkedIn; 100% complete; least complete first; an older address still works',
    C1.body.items.every(function (x) { return x.missing.indexOf('linkedin') === -1 && x.missing.indexOf('photo') === -1; }) && C1.body.items.some(function (x) { return x.slug === 'naven-singh'; }) &&
    C2.body.items.length >= 1 && C2.body.items.every(function (x) { return x.missing.indexOf('photo') !== -1 && x.missing.indexOf('linkedin') !== -1 && x.missing.indexOf('company') === -1; }) &&
    C3.body.items.every(function (x) { return x.complete === 100; }) &&
    C4.body.items.every(function (x, i, a) { return i === 0 || a[i - 1].complete <= x.complete; }) && C4.body.items.length === C5.body.items.length + (C4.body.items.length - C5.body.items.length) &&
    C5.body.items.every(function (x) { return x.missing.indexOf('photo') !== -1; }),
    [C1.body.items.map(function (x) { return x.slug + ':' + x.complete; }), C2.body.items.map(function (x) { return x.slug; }), C3.body.items.length, C4.body.items.map(function (x) { return x.complete; })]);
  check('6 …each row and each page says how complete it is (20% a field: photo, designation, company, bio, LinkedIn)', C1.body.items.every(function (x) { return x.complete === 100 - 20 * x.missing.length; }));
  L = await call(P.handleList, 'GET', '/api/people/speakers?filter=same-name', 'viewer');
  check('6 …Same name: the pages to look at', L.status === 200 && L.body.items.map(function (x) { return x.slug; }).sort().join() === 'naven-singh,naven-singh-globex', L.body.items);
  var one = await call(P.handleOne, 'GET', '/api/people/speakers/one?slug=naven-singh', 'viewer');
  check('6 one page says how complete it is, and what it lacks', typeof one.body.complete === 'number' && Array.isArray(one.body.missing) && one.body.complete === 100 - 20 * one.body.missing.length && one.body.fields.length === 5, [one.body.complete, one.body.missing]);
  check('6 one page: what it is made of, what is not shown and why, the other page of that name; a viewer only reads', one.status === 200 && one.body.canChange === false &&
    one.body.person.rows.length === 4 && one.body.person.journey.some(function (j) { return j.why === 'a dummy event'; }) && one.body.sameName.length === 1 && one.body.sameName[0].slug === 'naven-singh-globex', one.body);
  var put = await call(P.handleOne, 'PUT', '/api/people/speakers/one', 'hr', { slug: 'naven-singh', base: 0, page: { about: 'x' } });
  check('6 an editor of another portal cannot change it', put.status === 403);
  put = await call(P.handleOne, 'PUT', '/api/people/speakers/one', 'ciso', { slug: 'naven-singh', base: 0, page: { set: { designation: 'Chief Information Security Officer' }, about: 'Naven leads security at Acme Bank.',
    sections: [{ heading: 'Recognition', text: 'CISO of the Year 2025' }], links: [{ label: 'Keynote video', url: 'https://youtube.com/watch?v=1' }], hideEvents: ['et:800'] } });
  check('6 an editor of the portal changes it; it is logged', put.status === 200 && put.body.version === 1 && put.body.log[0].action === 'edit' && put.body.page.set.designation === 'Chief Information Security Officer', put.body);
  r = await page('/speakers/naven-singh');
  check('6 …and the page shows it at once: the team\'s designation, About, section, link; an event left off', /Chief Information Security Officer/.test(r.text) && /Naven leads security/.test(r.text) && /CISO of the Year 2025/.test(r.text) &&
    /Keynote video/.test(r.text) && !/ETCISO Decrypt 2025/.test(r.text));
  put = await call(P.handleOne, 'PUT', '/api/people/speakers/one', 'ciso', { slug: 'naven-singh', base: 0, page: { about: 'stale' } });
  check('6 a change made on an old copy is refused (someone changed it since)', put.status === 409);
  put = await call(P.handleOne, 'PUT', '/api/people/speakers/one', 'ciso', { slug: 'naven-singh', base: 1, hidden: true });
  r = await page('/speakers/naven-singh');
  var ixh = await T.readIndex(FB, 'speakers', true);
  check('6 hidden: the address answers not available; the index knows', put.status === 200 && put.body.hidden === true && r.status === 404 && ixh.people['naven-singh'].h === true);
  var un = await call(P.handleUndo, 'POST', '/api/people/speakers/undo', 'ciso', { slug: 'naven-singh' });
  r = await page('/speakers/naven-singh');
  check('6 Undo: shown again', un.status === 200 && un.body.hidden === false && r.status === 200, un.body);
  un = await call(P.handleUndo, 'POST', '/api/people/speakers/undo', 'ciso', { slug: 'naven-singh' });
  r = await page('/speakers/naven-singh');
  check('6 …Undo again: the edit is undone too', un.status === 200 && !/Naven leads security/.test(r.text) && /ETCISO Decrypt 2025/.test(r.text));
  var mg = await call(P.handleMerge, 'POST', '/api/people/speakers/merge', 'ciso', { slug: 'naven-singh', other: 'naven-singh-globex' });
  r = await page('/speakers/naven-singh-globex');
  check('6 join: the other page\'s records come here, its address redirects (301)', mg.status === 200 && mg.body.person.rows.length === 5 && r.status === 301 && r.headers.location === '/speakers/naven-singh', [mg.status, r.status, r.headers]);
  var sl = await call(P.handleSplit, 'POST', '/api/people/speakers/split', 'ciso', { slug: 'naven-singh', rows: ['e~ciso~naven singh|globex'] });
  check('6 split: those records become a page of their own', sl.status === 200 && !!sl.body.made && sl.body.person.rows.length === 4, sl.body);
  var again = await P.reconcileAll(FB);
  ixh = await T.readIndex(FB, 'speakers', true);
  check('6 …and the matching never joins them back', ixh.people[sl.body.made] && ixh.people[sl.body.made].k.length === 1 && ixh.people['naven-singh'].k.length === 4, again);

  /* 7. the sitemap */
  var sm = respond();
  P.handleSitemap({ method: 'GET', url: '/sitemap-people.xml', headers: {} }, sm.res);
  await sm.done;
  check('7 the sitemap: people with a public row, never one whose only event is not live', sm.status === 200 && /<loc>https:\/\/sites\.test\/speakers\/naven-singh<\/loc>/.test(sm.text) && /\/sponsors\/sailpoint</.test(sm.text) && !/priya-nair/.test(sm.text), sm.text);

  /* 8. the page, on its own */
  var odd = PAGE.render({ kind: 'speakers', slug: 'x', name: '<img src=x onerror=alert(1)>', designation: '"quote"', company: '', photo: 'javascript:alert(1)', linkedin: 'javascript:alert(1)', journey: [{ key: 'et:1', title: '<b>T</b>', link: 'javascript:x', year: '2025', sessions: [] }], stats: { events: 1 }, sections: [], links: [{ label: 'x', url: 'javascript:y' }] }, { base: 'https://sites.test', today: '2026-11-11' });
  check('8 everything escaped; a link or a picture that is not http(s) is dropped', !/<img src=x/.test(odd) && !/javascript:/.test(odd) && /&lt;b&gt;T&lt;\/b&gt;/.test(odd));
  var RL = PAGE._test.roleLabel;
  check('8 a role typed in capitals reads in sentence case; a short word and a mixed-case role stay as typed', RL('GUEST OF HONOUR') === 'Guest of Honour' && RL('GRAND JURY') === 'Grand Jury' &&
    RL('CXO PANEL') === 'CXO Panel' && RL('Keynote Address') === 'Keynote Address' && RL('CEO OF THE YEAR JURY') === 'CEO of the Year Jury' && RL('NEXT-GEN LEADERS') === 'Next-Gen Leaders', [RL('GUEST OF HONOUR'), RL('CXO PANEL'), RL('CEO OF THE YEAR JURY'), RL('NEXT-GEN LEADERS')]);
  check('8 dates and times read as people say them', PAGE._test.dayLabel('2025-11-20') === '20 Nov 2025' && PAGE._test.timeLabel('2025-11-20T14:05:00') === '2:05 pm' && PAGE._test.timeLabel('10:30') === '10:30 am' && PAGE._test.timeLabel('2025-11-20 00:00:00') === '');

  /* 9. ETB2B AI writes the About: a draft from the page's facts, never saved by it */
  var llm = require('./llm'), realCall = llm.callJson, asked = null;
  llm.callJson = function (prompt, schema, opts) { asked = { prompt: prompt, opts: opts }; return Promise.resolve({ parsed: { about: '"Naven Singh is Group CISO at Acme Bank. He has spoken at ET events and ET\'s awards since 2024; he speaks with ETCISO often."' }, provider: 'claude' }); };
  var before9 = JSON.stringify(FB.docs['speakerPages/naven-singh'] || null);
  var ab = await call(P.handleAbout, 'POST', '/api/people/speakers/about', 'ciso', { slug: 'naven-singh', note: 'stress the jury work' });
  check('9 the About: written from the page\'s facts (events, roles, sessions), the rules and the team\'s note; "ET" alone never (ETCISO kept); nothing saved',
    ab.status === 200 && /Group CISO at Acme Bank/.test(ab.body.about) && /ETB2B events and ETB2B's awards/.test(ab.body.about) && /ETCISO/.test(ab.body.about) && !/^"/.test(ab.body.about) &&
    asked.opts.route === 'people-about' && /"role":"Grand Jury"/.test(asked.prompt) && /Zero trust in BFSI/.test(asked.prompt) && /stress the jury work/.test(asked.prompt) &&
    /never "ET" on its own/.test(asked.prompt) && /Never add an achievement/.test(asked.prompt) && JSON.stringify(FB.docs['speakerPages/naven-singh'] || null) === before9, [ab.status, ab.body, asked && asked.prompt.slice(0, 300)]);
  check('9 …never an email or a phone in what the model is given', !/naven\.private|99999/.test(asked.prompt));
  var ab2 = await call(P.handleAbout, 'POST', '/api/people/speakers/about', 'hr', { slug: 'naven-singh' });
  check('9 …only someone who may change the page asks for it', ab2.status === 403);
  llm.callJson = realCall;

  /* 10. Wikipedia: only when it names their company */
  var W = require('./people-wiki');
  function wikiFetch(url) {
    if (/wbsearchentities/.test(url)) return Promise.resolve({ search: [{ id: 'Q1', label: 'Naven Singh', description: 'Indian banker' }, { id: 'Q2', label: 'Naven Singh', description: 'Indian cricketer' }, { id: 'Q3', label: 'Navendra Singh' }] });
    if (/wbgetentities/.test(url) && /ids=Q1%7CQ2/.test(url)) return Promise.resolve({ entities: {
      Q1: { labels: { en: { value: 'Naven Singh' } }, descriptions: { en: { value: 'Indian banker' } }, sitelinks: { enwiki: { title: 'Naven Singh (banker)' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P108: [{ mainsnak: { datavalue: { value: { id: 'Q900' } } } }] } },
      Q2: { labels: { en: { value: 'Naven Singh' } }, descriptions: { en: { value: 'Indian cricketer' } }, sitelinks: { enwiki: { title: 'Naven Singh (cricketer)' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } } } });
    if (/wbgetentities/.test(url)) return Promise.resolve({ entities: { Q900: { labels: { en: { value: 'Acme Bank Limited' } } } } });
    if (/page\/summary\/Naven_Singh_\(banker\)/.test(url)) return Promise.resolve({ title: 'Naven Singh (banker)', extract: 'Naven Singh is an Indian banker who leads security at Acme Bank.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Naven_Singh_(banker)' } },
      thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Naven.jpg/320px-Naven.jpg' }, originalimage: { source: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Naven.jpg' } });
    return Promise.resolve(null);
  }
  var found = await W.find({ kind: 'speakers', name: 'Naven Singh', companies: ['Acme Bank'] }, { fetchJson: wikiFetch });
  check('10 two entries of the name: the one whose employer is their company is them; the namesake is not; another name is not asked', found.match && found.match.qid === 'Q1' && /employer: Acme Bank Limited/.test(found.match.why) &&
    found.candidates.length === 2 && !found.candidates[1].match, found);
  var none = await W.find({ kind: 'speakers', name: 'Naven Singh', companies: ['Globex'] }, { fetchJson: wikiFetch });
  check('10 …a person of another company: no match at all', !none.match && none.candidates.every(function (c) { return !c.match; }));
  var ix10 = await T.readIndex(FB, 'speakers', true);
  var person10 = await T.personOf(FB, 'speakers', 'naven-singh', ix10.people['naven-singh'], null, { idx: ix10 });
  var looked = await P.wikiLookup(FB, 'speakers', 'naven-singh', person10, 'asha@timesinternet.in', { fetchJson: wikiFetch });
  r = await page('/speakers/naven-singh');
  check('10 a match is shown on the page: the summary, a link, the licence\'s credit, and in the structured data', looked.status === 'matched' && /From Wikipedia/.test(r.text) && /leads security at Acme Bank/.test(r.text) &&
    /CC BY-SA 4\.0/.test(r.text) && /https:\/\/en\.wikipedia\.org\/wiki\/Naven_Singh_\(banker\)/.test(r.text) && /"sameAs":\[[^\]]*wikipedia/.test(r.text), r.text.slice(0, 200));
  check('10 …its picture is not used where the page has a photo', !/upload\.wikimedia\.org/.test((r.text.match(/<figure class="ph">[\s\S]*?<\/figure>/) || [''])[0]));
  var off = await call(P.handleWiki, 'POST', '/api/people/speakers/wiki', 'ciso', { slug: 'naven-singh', action: 'off' });
  r = await page('/speakers/naven-singh');
  check('10 the team turns it off: gone from the page', off.status === 200 && off.body.person.wiki === null && !/From Wikipedia/.test(r.text));
  var spf = await W.find({ kind: 'sponsors', name: 'SailPoint', website: 'https://www.sailpoint.com' }, { fetchJson: function (url) {
    if (/wbsearchentities/.test(url)) return Promise.resolve({ search: [{ id: 'Q7', label: 'SailPoint' }] });
    if (/wbgetentities/.test(url)) return Promise.resolve({ entities: { Q7: { labels: { en: { value: 'SailPoint' } }, sitelinks: { enwiki: { title: 'SailPoint' } }, claims: { P856: [{ mainsnak: { datavalue: { value: 'https://sailpoint.com/' } } }] } } } });
    return Promise.resolve(null);
  } });
  check('10 a sponsor: the entry whose website is theirs', spf.match && spf.match.qid === 'Q7' && /website: sailpoint\.com/.test(spf.match.why), spf);
  check('10 an article about them only: their name (a bracket aside), never their company\'s article', W.aboutThem('speakers', 'Naven Singh (banker)', 'Dr. Naven Singh') &&
    !W.aboutThem('speakers', 'Omega Seiki Mobility', 'Uday Narang') && W.aboutThem('sponsors', 'SailPoint Technologies', 'SailPoint') && !W.aboutThem('sponsors', 'Google Cloud', 'Google'));
  var redirectFetch = function (url) {
    if (/page\/summary\//.test(url)) return Promise.resolve({ title: 'Acme Bank', extract: 'Acme Bank is an Indian bank.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Acme_Bank' } } });
    return wikiFetch(url);
  };
  var notHim = await P.wikiLookup(FB, 'speakers', 'naven-singh', person10, 'asha@timesinternet.in', { fetchJson: redirectFetch });
  check('10 …a person whose entry leads to their company\'s article: not used, and said why', notHim.status === 'none' && notHim.candidates.some(function (c) { return /not about them/.test(c.why); }), notHim);
  check('10 what is kept of Wikipedia: https on its own hosts only', W.clean({ url: 'https://evil.test/x', extract: 'x' }) === null && W.clean({ url: 'https://en.wikipedia.org/wiki/X', extract: 'Y', image: 'https://evil.test/a.jpg', imagePage: 'https://commons.wikimedia.org/wiki/File:a.jpg' }).image === '');

  process.stdout.write('people: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stderr.write('CRASH ' + (e && e.stack || e) + '\n'); process.exit(1); });
