/* tools/refresh-dummy-dates.js on an in-memory Firestore + Storage: the three AI-designed dummy sites get their
   Basics dates drawn in and go live as a new version; CIO Awards' own 2026 dates move to 2027; an event with newer
   saved work, or a request waiting for approval, is left alone. */
'use strict';
var fs = require('fs'), path = require('path');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 500) : '')); }

/* ---------- an in-memory Firestore + Storage (as logo-note-gate.test.js) ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {}, files = {}, autoN = 100000;
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } }; }
  function write(p, data, merge) {
    if (!merge || !docs[p]) docs[p] = docs[p] && merge ? docs[p] : {};
    Object.keys(data).forEach(function (k) { if (isDelete(data[k])) delete docs[p][k]; else docs[p][k] = typeof data[k] === 'object' && data[k] && /Increment|FieldTransform/i.test((data[k].constructor && data[k].constructor.name) || '') ? 'inc' : clone(data[k]); });
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, data, o && o.merge); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, data, true); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p) {
    var q = { path: p, doc: function (id) { return docRef(p + '/' + (id || 'auto' + (++autoN))); },
      add: function (data) { var r = docRef(p + '/auto' + (++autoN)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) {
        var base = q.get;
        return Object.assign({}, q, { get: function () { return base().then(function (r) { var list = r.docs.filter(function (d) { var v = (d.data() || {})[field]; return op === '>' ? v > value : v === value; }); return { docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } }; }); } });
      },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      } };
    return q;
  }
  var db = { collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = { get: function (r) { return r.get(); }, set: function (r, d, o) { write(r.path, d, o && o.merge); return tx; },
        update: function (r, d) { write(r.path, d, true); return tx; }, delete: function (r) { delete docs[r.path]; return tx; } };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, d, o && o.merge); }); }, update: function (r, d) { ops.push(function () { write(r.path, d, true); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); }, commit: function () { ops.forEach(function (f) { f(); }); return Promise.resolve(); } };
    } };
  var bucket = { name: 'test-bucket', file: function (p) {
    return { name: p,
      save: function (buf) { files[p] = Buffer.from(buf); return Promise.resolve(); }, delete: function () { delete files[p]; return Promise.resolve(); },
      exists: function () { return Promise.resolve([!!files[p]]); },
      download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      getMetadata: function () { return files[p] ? Promise.resolve([{ size: files[p].length, updated: '2026-01-01T00:00:00.000Z' }]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      setMetadata: function () { return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } };
  } };
  var auth = { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files };
}
var FB = fakeFb();
function stub(name, exports) { var id = require.resolve(name); require.cache[id] = { id: id, filename: id, loaded: true, exports: exports }; }
stub('./firebase', { getFirebase: function () { return FB; } });
var realLlm = require('./llm');
stub('./llm', Object.assign({}, realLlm, { callJson: function () { return Promise.reject(new Error('no model in this test')); } }));
var realSafe = require('./safe-fetch');
stub('./safe-fetch', Object.assign({}, realSafe, { safeFetch: function () { return Promise.resolve({ status: 404, body: Buffer.from('') }); } }));
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var api = require('./api');
var hooks = api._testHooks;
var logActivity = require('./activity').logActivity;
var tool = require('../../tools/refresh-dummy-dates.js');

var TBA = 'Date to be announced';
function genPage(name, extra) {
  return '<!DOCTYPE html><html><head><title>' + name + '</title></head><body class="microsite rv-generated">' +
    '<nav data-rv-section="nav"><div class="rv-etnav-event"><a class="rv-etnav-name" href="#hero">' + name + '</a>' +
    '<p class="rv-etnav-sub"><span class="rv-etnav-date">' + TBA + '</span><span class="rv-etnav-place">Mumbai</span></p></div></nav>' +
    '<section data-rv-section="hero"><h1>' + name + '</h1><div class="hero-facts"><span class="hero-fact"><svg><rect x="3"></rect></svg><span>' + TBA + '</span></span>' +
    '<span class="hero-fact"><svg><circle r="3"></circle></svg><span>Mumbai</span></span></div></section>' + (extra || '') +
    '<footer data-rv-section="footer"><p class="etf-event-name">' + name + '</p><p class="etf-event-meta">' + TBA + ' <span aria-hidden="true">·</span> Mumbai</p></footer>' +
    '</body></html>';
}
var CIO_PAGE = '<!DOCTYPE html><html><head><title>CIO Awards</title></head><body><main>' +
  '<section data-rv-section="hero"><h1>The Economic Times Awards for Enterprise Tech Excellence 2026</h1>' +
  '<span class="text-[clamp(1.5rem,7.6vw,3.4rem)]">2026</span><p>27 November 2026 · Grand Hyatt, Mumbai</p></section>' +
  '<section data-rv-section="timeline"><p>15 August 2026</p><p>Nomination Starts</p><p>Open now</p><p>30 October 2026</p><p>Nomination Deadline</p><p>Closing soon</p>' +
  '<p>31 October 2026</p><p>Shortlist Announcement</p><p>Upcoming</p><p>17 November 2026</p><p>27 November 2026</p></section>' +
  '<section data-rv-section="faq"><h3>What are the ET Awards for Enterprise Tech Excellence 2026?</h3><p>Submit before the deadline, 30 October 2026.</p></section>' +
  '</main><footer><span>© 2026 The Economic Times. All rights reserved</span></footer><div data-award="etcio-awards-2026"></div></body></html>';

function seed(id, ev, page) {
  FB.docs['events/' + id] = Object.assign({ name: id, createdAt: '2026-10-01T00:00:00.000Z', portal: 'cio', city: 'Mumbai', published: true, publishedVersion: 3, publishedBy: 'someone@timesinternet.in',
    site: { version: 3, templateId: ev.templateId || null } }, ev);
  delete FB.docs['events/' + id].templateId;
  FB.files['events/' + id + '/site/page.html'] = Buffer.from(page);
  FB.files['events/' + id + '/site/versions/3.html'] = Buffer.from(page);
  FB.files['events/' + id + '/published/index.html'] = Buffer.from(page);
}
seed('agentic-summit-2027', { name: 'Agentic Summit 2027', start: '2027-11-18', end: '2027-11-19', templateId: 'gen-agentic-summit-2027' }, genPage('Agentic Summit 2027'));
seed('cyber-premier-league', { name: 'Cyber Premier League', start: '2027-12-02', end: '2027-12-03', templateId: 'gen-cyber-premier-league' },
  genPage('Cyber Premier League', '<section data-rv-section="closing-cta"><p class="closing-cta-date">' + TBA + '</p></section>'));
/* newer saved work than the live version: left alone */
seed('national-data-center-symposium', { name: 'National Data Center Symposium', start: '2027-12-09', end: '2027-12-09', templateId: 'gen-national-data-center-symposium' }, genPage('National Data Center Symposium'));
FB.docs['events/national-data-center-symposium'].site.version = 4;
seed('cio-awards', { name: 'CIO Awards', start: '2027-11-26', end: '2027-11-26', templateId: 'imported-imp-x' }, CIO_PAGE);
/* CIO Awards was published before sites had versions: one live page, no saved site */
delete FB.docs['events/cio-awards'].publishedVersion; delete FB.docs['events/cio-awards'].site;
FB.docs['events/cio-awards'].publishedUrl = 'https://storage.googleapis.com/x/cio-awards/index.html';
delete FB.files['events/cio-awards/site/page.html']; delete FB.files['events/cio-awards/site/versions/3.html'];

function live(id) { var f = FB.files['events/' + id + '/published/index.html']; return f ? f.toString('utf8') : ''; }

(async function () {
  var plans = await tool.plan(FB, hooks);
  var by = {}; plans.forEach(function (p) { by[p.id] = p; });
  ok(by['agentic-summit-2027'].ok, 'Agentic: planned', JSON.stringify(by['agentic-summit-2027'].report));
  ok(by['cyber-premier-league'].ok, 'CPL: planned (its own date line too)', JSON.stringify(by['cyber-premier-league'].report));
  ok(!by['national-data-center-symposium'].ok && /not the live one/.test(by['national-data-center-symposium'].line), 'NDCS: newer saved work is never put live', by['national-data-center-symposium'].line);
  ok(by['cio-awards'].ok, 'CIO: planned', JSON.stringify(by['cio-awards'].report));
  ok(live('agentic-summit-2027').indexOf(TBA) !== -1, 'the plan writes nothing');

  var done = await tool.apply(FB, hooks, logActivity, 'https://cms.example', plans);
  var lines = {}; done.forEach(function (d) { lines[d.id] = d.line; });
  ok(/its live page changed/.test(lines['cio-awards']), 'CIO: its one live page is changed', lines['cio-awards']);
  ok(FB.files['events/cio-awards/published/before-2026-11-14.html'] && FB.files['events/cio-awards/published/before-2026-11-14.html'].toString().indexOf('27 November 2026') !== -1, 'CIO: the page before is kept beside it');
  ok(!FB.docs['events/cio-awards'].publishedVersion && !FB.docs['events/cio-awards'].site, 'CIO: still published the way it was (no versions made up)');
  ['agentic-summit-2027', 'cyber-premier-league'].forEach(function (id) {
    ok(/version 4 saved and live/.test(lines[id]), id + ': version 4 saved and put live', lines[id]);
    var e = FB.docs['events/' + id];
    ok(e.publishedVersion === 4 && e.site.version === 4, id + ': the event records version 4 as saved and live', JSON.stringify({ p: e.publishedVersion, s: e.site && e.site.version }));
  });
  ok(/^skipped/.test(lines['national-data-center-symposium']) && FB.docs['events/national-data-center-symposium'].publishedVersion === 3, 'NDCS: skipped, still version 3', lines['national-data-center-symposium']);

  var a = live('agentic-summit-2027');
  ok(a.indexOf(TBA) === -1, 'Agentic live: no "Date to be announced" left', a.slice(0, 2000));
  ok(/rv-etnav-date[^>]*>18–19 Nov 2027</.test(a), 'Agentic live: the top bar says 18–19 Nov 2027', (a.match(/rv-etnav-date[^<]*<[^<]*/) || [''])[0]);
  ok(a.indexOf('18–19 November 2027') !== -1, 'Agentic live: the banner and footer say 18–19 November 2027');
  var c = live('cyber-premier-league');
  ok(c.indexOf(TBA) === -1 && /closing-cta-date">2–3 December 2027</.test(c), 'CPL live: its own date line says 2–3 December 2027', (c.match(/closing-cta-date[^<]*/) || [''])[0]);

  var cio = live('cio-awards');
  ['15 August 2027', '30 October 2027', '31 October 2027', '17 November 2027', '26 November 2027', 'Excellence 2027'].forEach(function (w) { ok(cio.indexOf(w) !== -1, 'CIO live: ' + w); });
  ok(!/\b(August|October|November) 2026\b|Excellence 2026|>2026</.test(cio), 'CIO live: no 2026 date or banner year left', cio);
  ok(cio.indexOf('© 2026') !== -1 && cio.indexOf('etcio-awards-2026') !== -1, 'CIO live: the copyright line and the awards\' own id are kept');
  ok(cio.indexOf('Open now') === -1 && cio.indexOf('Closing soon') === -1, 'CIO live: the timeline no longer says nominations are open');

  var hist = Object.keys(FB.docs).filter(function (k) { return /^events\/agentic-summit-2027\/activity\//.test(k); }).map(function (k) { return FB.docs[k]; });
  ok(hist.some(function (h) { return /owner's instruction/.test(JSON.stringify(h)); }), 'Agentic: the history says it was put live on the owner\'s instruction', JSON.stringify(hist).slice(0, 600));

  /* run again: nothing left to change, nothing published twice */
  var again = await tool.plan(FB, hooks);
  ok(again.every(function (p) { return !p.ok; }), 'a second run finds nothing to do', JSON.stringify(again.map(function (p) { return p.id + ': ' + p.line; })));

  if (failures.length) { console.log('refresh-dummy-dates: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('refresh-dummy-dates: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.log('refresh-dummy-dates: crashed — ' + (err && err.stack)); process.exit(1); });
