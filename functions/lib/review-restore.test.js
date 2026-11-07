/* node functions/lib/review-restore.test.js — batch B13 (the review page, take-down, restore and previews):
     UX-065  a preview with no saved site leads to the site editor (the server's page, the console, the dashboard)
     UX-106  the review page on a phone: the title on its own line, the page before Approve, at the phone's width
     UX-107  an approver puts the version that was live before back live (POST /api/event/restore-version)
     UX-108  the approval rule lives in Settings, is refused when nobody answers for it, every change is recorded;
             a request a newer live version has overtaken is closed and can never put an older version back
     UX-109  a change can be shown in the pages; panes say they are loading; no editor tools on a version under review
     UX-110  labels and the preview ribbon say what is true now (live / previously live / not live yet)
     UX-115  preview-draft.html (a developer bridge) is not served
     UX-116  a request not found is said so; notes are labelled; a rejection is said plainly
   The routes run in-process against an in-memory Firestore and Storage (the harness of takedown-approvers.test.js);
   the pages are read as files and their functions run in a vm. No network, no browser. Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 500) : '')); }

/* ---------- an in-memory Firestore + Storage ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {}, files = {}, seq = 0;
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } }; }
  function write(p, data, merge) {
    if (!merge || !docs[p]) docs[p] = docs[p] && merge ? docs[p] : {};
    Object.keys(data).forEach(function (k) { if (isDelete(data[k])) delete docs[p][k]; else docs[p][k] = clone(data[k]); });
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, data, o && o.merge); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, data, true); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p, filters) {
    filters = filters || [];
    var q = { path: p, doc: function (id) { return docRef(p + '/' + (id || 'auto' + (++seq))); },
      add: function (data) { var r = docRef(p + '/auto' + (++seq)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) { return colRef(p, filters.concat([[field, op, value]])); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap)
          .filter(function (d) { return filters.every(function (f) { var v = (d.data() || {})[f[0]]; return f[1] === '>' ? v > f[2] : v === f[2]; }); });
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (fn) { list.forEach(fn); } });
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
  var stamp = 0;
  var bucket = { name: 'test-bucket', file: function (p) {
    return { name: p,
      save: function (buf) { files[p] = { body: Buffer.from(buf), updated: new Date(Date.UTC(2026, 0, 1, 0, 0, ++stamp)).toISOString() }; return Promise.resolve(); },
      delete: function () { delete files[p]; return Promise.resolve(); },
      exists: function () { return Promise.resolve([!!files[p]]); },
      download: function () { return files[p] ? Promise.resolve([files[p].body]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      getMetadata: function () { return files[p] ? Promise.resolve([{ size: files[p].body.length, updated: files[p].updated }]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      setMetadata: function () { return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } };
  } };
  var auth = { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var api = require('./api');
var access = require('./access');

function call(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    var body = opts.body ? JSON.stringify(opts.body) : '';
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body) };
    if (body) headers['content-type'] = 'application/json';
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) {
        var t = '';
        if (b) { t = Buffer.isBuffer(b) && /gzip|br/.test(res.headers['content-encoding'] || '') ? (res.headers['content-encoding'] === 'br' ? require('zlib').brotliDecompressSync(b) : require('zlib').gunzipSync(b)).toString('utf8') : String(b); }
        var j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, text: t, body: j, headers: res.headers });
      } };
    api.handleApi(req, res);
  });
}
var T1 = '2026-02-01T10:00:00.000Z', T2 = '2026-02-02T10:00:00.000Z', NOW = '2026-02-01T00:00:00.000Z';
function page(marker) { return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><section data-rv-section="about"><h2>About the summit</h2><p>' + marker + ' is a gathering of leaders.</p></section></body></html>'; }
function save(p, text) { return FB.bucket.file(p).save(text); }
function liveText(id) { var f = FB.files['events/' + id + '/published/index.html']; return f ? String(f.body) : ''; }
function ribbonOf(t) { var m = /<div data-rv-preview-ribbon[^>]*>([^<]*)<\/div>/.exec(String(t)); return m ? m[1] : null; }
function sub(prefix) { return Object.keys(FB.docs).filter(function (k) { return k.indexOf(prefix) === 0; }).map(function (k) { return FB.docs[k]; }); }
function settle() { return new Promise(function (r) { setTimeout(r, 15); }); }

(async function () {
  var r;
  /* ================= UX-065 / UX-110: the preview's ribbon, tools and empty state ================= */
  FB.docs['config/approvals'] = { approvers: ['boss@timesinternet.in'], required: true };
  FB.docs['events/pv-none'] = { name: 'Never saved', createdAt: NOW, templateId: 'tech500' };
  r = await call('GET', '/preview/pv-none', { token: 'member' });
  ok(r.status === 404 && /Nothing to preview yet/.test(r.text) && /<a href="\/custom_editor\.html\?event=pv-none&amp;template=tech500">Open the site editor<\/a>/.test(r.text),
    'UX-065 a site never saved: "Nothing to preview yet" with the way on, the site editor on its template', r.status + ' ' + r.text.slice(-600));
  r = await call('GET', '/preview/pv-none?draft=1', { token: 'member' });
  ok(r.status === 404 && /Open the site editor/.test(r.text), 'UX-065 …the same from ?draft=1 (the console\'s and the dashboard\'s Preview)', r.status);

  FB.docs['events/pv-same'] = { name: 'Same', createdAt: NOW, site: { version: 3, templateId: 'tech500' }, published: true, publishedVersion: 3, publishedAt: NOW };
  await save('events/pv-same/site/page.html', page('SAVED-SAME'));
  await save('events/pv-same/site/versions/3/page.html', page('V3-SAME'));
  await save('events/pv-same/site/versions/2/page.html', page('V2-SAME'));
  r = await call('GET', '/preview/pv-same?draft=1', { token: 'member' });
  ok(r.status === 200 && ribbonOf(r.text) === 'Preview — same as the live site', 'UX-110 a live site with nothing new: "Preview — same as the live site"', ribbonOf(r.text));
  ok(/rv-theme-switcher\.js/.test(r.text) || /rv-preview-edit\.js/.test(r.text), 'the team preview keeps its tools', r.text.slice(-400));
  r = await call('GET', '/preview/pv-same?version=3', { token: 'member' });
  ok(r.status === 200 && ribbonOf(r.text) === 'Version 3 — this version is live' && /V3-SAME/.test(r.text), 'UX-110 ?version=N of the live version: "this version is live"', ribbonOf(r.text));
  ok(!/rv-theme-switcher\.js/.test(r.text) && !/rv-preview-edit\.js/.test(r.text) && !/id="rv-themes"/.test(r.text), 'UX-109 a version under review: no theme switcher, no Edit with AI', r.text.slice(-500));
  r = await call('GET', '/preview/pv-same?version=2', { token: 'member' });
  ok(ribbonOf(r.text) === 'Version 2 — not the live version', 'UX-110 an older version: "not the live version"', ribbonOf(r.text));
  r = await call('GET', '/preview/pv-same?version=2&frame=1', { token: 'member' });
  ok(r.status === 200 && ribbonOf(r.text) === null && /V2-SAME/.test(r.text), 'UX-109 a review pane (?frame=1): no ribbon over the page', ribbonOf(r.text));

  FB.docs['events/pv-newer'] = { name: 'Newer', createdAt: NOW, site: { version: 4, templateId: 'tech500' }, published: true, publishedVersion: 3, publishedAt: NOW };
  await save('events/pv-newer/site/page.html', page('SAVED-NEWER'));
  r = await call('GET', '/preview/pv-newer', { token: 'member' });
  ok(ribbonOf(r.text) === 'Preview — changes not live yet', 'UX-110 a live site with newer saves: "changes not live yet"', ribbonOf(r.text));
  FB.docs['events/pv-draft'] = { name: 'Draft', createdAt: NOW, site: { version: 1, templateId: 'tech500' } };
  await save('events/pv-draft/site/page.html', page('SAVED-DRAFT'));
  r = await call('GET', '/preview/pv-draft?draft=1', { token: 'member' });
  ok(ribbonOf(r.text) === 'Preview — not published', 'a site never published: "not published"', ribbonOf(r.text));
  await save('events/pv-same/site/drafts/u-member.html', page('OWN-DRAFT'));
  r = await call('GET', '/preview/pv-same?draft=1', { token: 'member' });
  ok(/OWN-DRAFT/.test(r.text) && ribbonOf(r.text) === 'Preview — changes not live yet', 'a person\'s own newer preview is never called the live site', ribbonOf(r.text));

  /* ================= UX-107: putting the previous version back ================= */
  FB.docs['events/rs-one'] = { name: 'Restore one', createdAt: NOW, site: { version: 7, templateId: 'tech500' }, published: true, publishedVersion: 7, publishedAt: T2, publishedPath: '/e/rs-one' };
  FB.docs['events/rs-one/approvals/reqA'] = { status: 'approved', fromVersion: 6, toVersion: 7, requestedAt: T1, decidedAt: T2, requestedBy: 'member@timesinternet.in', decidedBy: 'boss@timesinternet.in' };
  await save('events/rs-one/site/versions/6/page.html', page('V6-ONE'));
  await save('events/rs-one/site/versions/7/page.html', page('V7-ONE'));
  await save('events/rs-one/site/versions/5/page.html', page('V5-ONE'));
  await save('events/rs-one/published/index.html', page('V7-ONE'));
  r = await call('GET', '/api/event/approval?eventId=rs-one&id=reqA', { token: 'member' });
  ok(r.status === 200 && r.body.previousLive && r.body.previousLive.version === 6 && r.body.mayTakeDown === false, 'the approval view names the version live before (6), and a member may not put it back', r.text.slice(0, 400));
  ok(r.body.previousLive.at === null, 'when version 6 went live is not recorded: no date is made up', JSON.stringify(r.body.previousLive));
  r = await call('GET', '/api/event/approval?eventId=rs-one&id=reqA', { token: 'boss' });
  ok(r.body.mayTakeDown === true && r.body.previousLive.version === 6, '…an approver may', JSON.stringify(r.body.previousLive));

  r = await call('POST', '/api/event/restore-version', { token: 'member', body: { eventId: 'rs-one', version: 6 } });
  ok(r.status === 403 && r.body.code === 'not-an-approver' && /Only an approver \(boss@timesinternet\.in\)/.test(r.body.error), 'a member is refused, with who can', r.status + ' ' + r.text);
  ok(FB.docs['events/rs-one'].publishedVersion === 7 && /V7-ONE/.test(liveText('rs-one')), '…and version 7 stays live');
  r = await call('POST', '/api/event/restore-version', { token: 'boss', body: { eventId: 'rs-one', version: 5 } });
  ok(r.status === 409 && r.body.code === 'never-live', 'a version never live cannot be put back that way', r.status + ' ' + r.text);
  r = await call('POST', '/api/event/restore-version', { token: 'boss', body: { eventId: 'rs-one', version: 7 } });
  ok(r.status === 409 && r.body.code === 'already-live', 'the live version is already live', r.status + ' ' + r.text);
  r = await call('POST', '/api/event/restore-version', { token: 'boss', body: { eventId: 'rs-one', version: 0 } });
  ok(r.status === 400, 'no version: 400', r.status);
  r = await call('POST', '/api/event/restore-version', { token: 'boss', body: { eventId: 'rs-one', version: 6 } });
  ok(r.status === 200 && r.body.restoredVersion === 6 && r.body.replacedVersion === 7 && r.body.publishedVersion === 6 && r.body.publishedPath === '/e/rs-one', 'an approver puts version 6 back', r.status + ' ' + r.text);
  var ev = FB.docs['events/rs-one'];
  ok(ev.published === true && ev.publishedVersion === 6 && ev.publishedBy === 'boss@timesinternet.in' && /V6-ONE/.test(liveText('rs-one')) && !/V7-ONE/.test(liveText('rs-one')), 'version 6 is the live page, recorded as the approver\'s', JSON.stringify(ev));
  ok(ev.site.version === 7, 'the saved site is left as it was (version 7 can be sent again)', JSON.stringify(ev.site));
  await settle();
  var pubs = sub('events/rs-one/publishes/');
  ok(pubs.length === 1 && pubs[0].version === 6 && pubs[0].how === 'restored' && pubs[0].replaced === 7 && pubs[0].by === 'boss@timesinternet.in', 'the publish is noted (publishes)', JSON.stringify(pubs));
  var acts = sub('events/rs-one/activity/').filter(function (a) { return a.action === 'published'; });
  ok(acts.length === 1 && acts[0].detail === 'version 6 put back in place of version 7' && acts[0].version === 6 && acts[0].area === 'publishing', 'the History says so', JSON.stringify(acts));
  r = await call('GET', '/api/event/approval?eventId=rs-one', { token: 'boss' });
  ok(r.body.publishedVersion === 6 && r.body.previousLive && r.body.previousLive.version === 7 && r.body.previousLive.at === T2, 'now the version live before is 7 (it went live when it was approved): the restore can itself be undone', JSON.stringify(r.body.previousLive));

  /* a version no longer kept is not offered; a site not live has nothing to replace */
  FB.docs['events/rs-gone'] = { name: 'Gone', createdAt: NOW, site: { version: 3 }, published: true, publishedVersion: 3, publishedAt: T2 };
  FB.docs['events/rs-gone/approvals/reqG'] = { status: 'approved', fromVersion: 2, toVersion: 3, requestedAt: T1, decidedAt: T2, requestedBy: 'member@timesinternet.in' };
  await save('events/rs-gone/site/versions/3/page.html', page('V3-GONE'));
  r = await call('GET', '/api/event/approval?eventId=rs-gone', { token: 'boss' });
  ok(r.status === 200 && r.body.previousLive === null, 'a version no longer stored is not offered', JSON.stringify(r.body.previousLive));
  FB.docs['events/rs-off'] = { name: 'Off', createdAt: NOW, site: { version: 3 }, published: false, publishedVersion: 3, unpublishedAt: T2 };
  r = await call('POST', '/api/event/restore-version', { token: 'boss', body: { eventId: 'rs-off', version: 2 } });
  ok(r.status === 409 && r.body.code === 'not-live', 'a site that is not live: 409 not-live', r.status + ' ' + r.text);
  /* with nobody named, everyone approves, so anyone may */
  FB.docs['config/approvals'] = { approvers: [], required: true };
  r = await call('POST', '/api/event/restore-version', { token: 'member', body: { eventId: 'rs-one', version: 7 } });
  ok(r.status === 200 && FB.docs['events/rs-one'].publishedVersion === 7, 'no approvers named: a member may (the take-down rule\'s own reading)', r.status + ' ' + r.text);
  FB.docs['config/approvals'] = { approvers: ['boss@timesinternet.in'], required: true };

  /* ================= UX-108: a request a newer live version has overtaken ================= */
  FB.docs['events/st-old'] = { name: 'Stale', createdAt: NOW, site: { version: 9 }, published: true, publishedVersion: 9, publishedAt: T2,
    approval: { id: 'reqOld01', toVersion: 8, requestedBy: 'member@timesinternet.in', requestedAt: T1 } };
  FB.docs['events/st-old/approvals/reqOld01'] = { status: 'pending', fromVersion: 7, toVersion: 8, requestedAt: T1, requestedBy: 'member@timesinternet.in', items: [], saves: [] };
  await save('events/st-old/site/versions/8/page.html', page('V8-STALE'));
  await save('events/st-old/published/index.html', page('V9-STALE'));
  r = await call('GET', '/api/event/approval?eventId=st-old', { token: 'boss' });
  ok(r.status === 200 && r.body.stale === true && r.body.canDecide === false && /Version 9 is live now, which is newer than this request \(version 8\)/.test(r.body.whyNot), 'an overtaken request: cannot be decided, and why', r.text.slice(0, 500));
  r = await call('POST', '/api/event/approval/decide', { token: 'boss', body: { eventId: 'st-old', id: 'reqOld01', decision: 'approve' } });
  ok(r.status === 409 && r.body.code === 'request-stale', 'approving it is refused (409 request-stale)', r.status + ' ' + r.text);
  ok(FB.docs['events/st-old'].publishedVersion === 9 && /V9-STALE/.test(liveText('st-old')), '…version 9 stays live: no roll-back to 8');
  ok(FB.docs['events/st-old/approvals/reqOld01'].status === 'superseded' && FB.docs['events/st-old/approvals/reqOld01'].decidedBy === 'boss@timesinternet.in' && !FB.docs['events/st-old'].approval,
    '…and it is closed (superseded), the event no longer says it is waiting', JSON.stringify(FB.docs['events/st-old']));
  r = await call('POST', '/api/event/approval/decide', { token: 'boss', body: { eventId: 'st-old', id: 'reqOld01', decision: 'approve' } });
  ok(r.status === 409 && /A newer version went live after this request was sent/.test(r.body.error), 'a closed request says why, in words', r.text);

  /* a direct publish (approval switched off) overtakes the request waiting for that version */
  FB.docs['config/approvals'] = { approvers: ['boss@timesinternet.in'], required: false };
  FB.docs['events/st-direct'] = { name: 'Direct', createdAt: NOW, site: { version: 5 }, published: true, publishedVersion: 4, publishedAt: T1,
    approval: { id: 'reqDir01', toVersion: 5, requestedBy: 'member@timesinternet.in', requestedAt: T1 } };
  FB.docs['events/st-direct/approvals/reqDir01'] = { status: 'pending', fromVersion: 4, toVersion: 5, requestedAt: T1, requestedBy: 'member@timesinternet.in', items: [], saves: [] };
  await save('events/st-direct/site/page.html', page('V5-DIRECT'));
  r = await call('POST', '/api/event/publish', { token: 'member', body: { eventId: 'st-direct' } });
  ok(r.status === 200 && FB.docs['events/st-direct'].publishedVersion === 5, 'approval off: Publish puts version 5 live', r.status + ' ' + r.text.slice(0, 300));
  await settle();
  ok(!FB.docs['events/st-direct'].approval && FB.docs['events/st-direct/approvals/reqDir01'].status === 'superseded' && /published directly/.test(FB.docs['events/st-direct/approvals/reqDir01'].decisionNote),
    '…and the request waiting for it is closed with why', JSON.stringify(FB.docs['events/st-direct/approvals/reqDir01']));
  var dp = sub('events/st-direct/publishes/');
  ok(dp.length === 1 && dp[0].how === 'direct' && dp[0].version === 5 && dp[0].replaced === 4, 'the direct publish is noted too', JSON.stringify(dp));
  FB.docs['config/approvals'] = { approvers: ['boss@timesinternet.in'], required: true };

  /* a restore that puts a version live closes the request waiting for that version (UX-108: putting version 8 back
     left the request for version 8 waiting, and the dashboard still offered Review for it) */
  FB.docs['events/rs-close'] = { name: 'Restore closes', createdAt: NOW, site: { version: 8 }, published: true, publishedVersion: 7, publishedAt: T2,
    approval: { id: 'reqB8x01', toVersion: 8, requestedBy: 'member@timesinternet.in', requestedAt: T2 } };
  FB.docs['events/rs-close/approvals/reqA8x01'] = { status: 'approved', fromVersion: 7, toVersion: 8, requestedAt: T1, decidedAt: T1, requestedBy: 'member@timesinternet.in', decidedBy: 'boss@timesinternet.in' };
  FB.docs['events/rs-close/approvals/reqB8x01'] = { status: 'pending', fromVersion: 7, toVersion: 8, requestedAt: T2, requestedBy: 'member@timesinternet.in', items: [], saves: [] };
  await save('events/rs-close/site/versions/7/page.html', page('V7-CLOSE'));
  await save('events/rs-close/site/versions/8/page.html', page('V8-CLOSE'));
  await save('events/rs-close/published/index.html', page('V7-CLOSE'));
  r = await call('POST', '/api/event/restore-version', { token: 'boss', body: { eventId: 'rs-close', version: 8 } });
  ok(r.status === 200 && FB.docs['events/rs-close'].publishedVersion === 8 && /V8-CLOSE/.test(liveText('rs-close')), 'UX-108 putting version 8 back puts it live', r.status + ' ' + r.text.slice(0, 300));
  var closedReq = FB.docs['events/rs-close/approvals/reqB8x01'];
  ok(closedReq.status === 'superseded' && closedReq.decidedBy === 'boss@timesinternet.in' && closedReq.decisionNote === 'Version 8 was put back live, so this request was closed.',
    'UX-108 …and the request waiting for version 8 is closed with why, before the answer comes back', JSON.stringify(closedReq));
  ok(!FB.docs['events/rs-close'].approval, 'UX-108 …and the event no longer says it is waiting', JSON.stringify(FB.docs['events/rs-close']));
  ok(require('./approval-list').listApproval('rs-close', FB.docs['events/rs-close']) === null, 'UX-108 …so the dashboard does not list it as waiting');
  ok(FB.docs['events/rs-close/approvals/reqA8x01'].status === 'approved', 'UX-108 an earlier decided request is left as it was', JSON.stringify(FB.docs['events/rs-close/approvals/reqA8x01']));
  /* putting back a version OLDER than the one waiting leaves the request waiting: it is still something to decide */
  FB.docs['events/rs-keep'] = { name: 'Restore keeps', createdAt: NOW, site: { version: 9 }, published: true, publishedVersion: 8, publishedAt: T2,
    approval: { id: 'reqK9x01', toVersion: 9, requestedBy: 'member@timesinternet.in', requestedAt: T2 } };
  FB.docs['events/rs-keep/approvals/reqK8x01'] = { status: 'approved', fromVersion: 7, toVersion: 8, requestedAt: T1, decidedAt: T1, requestedBy: 'member@timesinternet.in', decidedBy: 'boss@timesinternet.in' };
  FB.docs['events/rs-keep/approvals/reqK9x01'] = { status: 'pending', fromVersion: 8, toVersion: 9, requestedAt: T2, requestedBy: 'member@timesinternet.in', items: [], saves: [] };
  await save('events/rs-keep/site/versions/7/page.html', page('V7-KEEP'));
  await save('events/rs-keep/site/versions/8/page.html', page('V8-KEEP'));
  await save('events/rs-keep/published/index.html', page('V8-KEEP'));
  r = await call('POST', '/api/event/restore-version', { token: 'boss', body: { eventId: 'rs-keep', version: 7 } });
  ok(r.status === 200 && FB.docs['events/rs-keep'].publishedVersion === 7, 'UX-108 putting version 7 back (a request waits for version 9)', r.status + ' ' + r.text.slice(0, 300));
  ok(FB.docs['events/rs-keep/approvals/reqK9x01'].status === 'pending' && FB.docs['events/rs-keep'].approval && FB.docs['events/rs-keep'].approval.id === 'reqK9x01',
    'UX-108 …leaves the request for the newer version 9 waiting', JSON.stringify(FB.docs['events/rs-keep']));
  ok(require('./approval-list').listApproval('rs-keep', FB.docs['events/rs-keep']).id === 'reqK9x01', 'UX-108 …and the dashboard still lists it');

  /* an approval notes its publish, so the version before it can be put back later */
  FB.docs['events/ap-ok'] = { name: 'Approve', createdAt: NOW, site: { version: 2 }, published: true, publishedVersion: 1, publishedAt: T1,
    approval: { id: 'reqOk001', toVersion: 2, requestedBy: 'member@timesinternet.in', requestedAt: T1 } };
  FB.docs['events/ap-ok/approvals/reqOk001'] = { status: 'pending', fromVersion: 1, toVersion: 2, requestedAt: T1, requestedBy: 'member@timesinternet.in', items: [], saves: [] };
  await save('events/ap-ok/site/versions/2/page.html', page('V2-OK'));
  await save('events/ap-ok/site/versions/1/page.html', page('V1-OK'));
  r = await call('POST', '/api/event/approval/decide', { token: 'boss', body: { eventId: 'ap-ok', id: 'reqOk001', decision: 'approve' } });
  ok(r.status === 200 && FB.docs['events/ap-ok'].publishedVersion === 2, 'a fresh request is approved as before', r.status + ' ' + r.text.slice(0, 300));
  await settle();
  var ap = sub('events/ap-ok/publishes/');
  ok(ap.length === 1 && ap[0].how === 'approved' && ap[0].version === 2 && ap[0].replaced === 1, 'the approval is noted', JSON.stringify(ap));
  r = await call('GET', '/api/event/approval?eventId=ap-ok&id=reqOk001', { token: 'boss' });
  ok(r.body.previousLive && r.body.previousLive.version === 1, 'and version 1 can be put back', JSON.stringify(r.body.previousLive));

  /* ================= UX-108: the approval rule ================= */
  delete FB.docs['config/approvals'];
  r = await call('PUT', '/api/settings/approvals', { token: 'member', body: { approvers: '', required: false } });
  ok(r.status === 400 && r.body.code === 'approvers-needed', 'nobody named: approval cannot be switched off', r.status + ' ' + r.text);
  r = await call('PUT', '/api/settings/approvals', { token: 'member', body: { approvers: '', allowSelf: true, required: true } });
  ok(r.status === 400 && r.body.code === 'approvers-needed', 'nobody named: self-approval cannot be allowed', r.status + ' ' + r.text);
  ok(!FB.docs['config/approvals'], '…and nothing was written');
  r = await call('PUT', '/api/settings/approvals', { token: 'member', body: { approvers: 'Boss@timesinternet.in', required: true } });
  ok(r.status === 200 && JSON.stringify(r.body.approvers) === '["boss@timesinternet.in"]', 'nobody named: anyone may name the first approver', r.status + ' ' + r.text);
  await settle();
  var log = sub('config/approvals/log/');
  ok(log.length === 1 && log[0].by === 'member@timesinternet.in' && JSON.stringify(log[0].before.approvers) === '[]' && JSON.stringify(log[0].after.approvers) === '["boss@timesinternet.in"]',
    'the change is recorded, before and after', JSON.stringify(log));
  r = await call('PUT', '/api/settings/approvals', { token: 'member', body: { approvers: 'member@timesinternet.in', required: true } });
  ok(r.status === 403 && r.body.code === 'not-an-approver' && /Only an approver \(boss@timesinternet\.in\) can change these settings\./.test(r.body.error), 'named: a member is refused', r.status + ' ' + r.text);
  r = await call('PUT', '/api/settings/approvals', { token: 'boss', body: { approvers: 'boss@timesinternet.in', required: false } });
  ok(r.status === 200 && r.body.required === false, 'an approver may switch approval off', r.status + ' ' + r.text);
  r = await call('PUT', '/api/settings/approvals', { token: 'boss', body: { approvers: 'boss@timesinternet.in', required: false } });
  await settle();
  log = sub('config/approvals/log/');
  ok(log.length === 2 && log.some(function (l) { return l.before.required === true && l.after.required === false && l.by === 'boss@timesinternet.in'; }), 'switching it off is recorded; saving the same again is not', JSON.stringify(log));
  r = await call('GET', '/api/settings/approvals', { token: 'member' });
  ok(r.status === 200 && r.body.canEdit === false && /Only an approver/.test(r.body.whyNot) && r.body.history.length === 2 && r.body.me === 'member@timesinternet.in', 'GET: read-only for a member, with the history', r.text.slice(0, 400));
  r = await call('GET', '/api/settings/approvals', { token: 'boss' });
  ok(r.body.canEdit === true && r.body.whyNot === '' && Array.isArray(r.body.approvers), 'GET: an approver may change it', r.text.slice(0, 300));

  /* ================= UX-115: the developer bridge is not served ================= */
  ok(access.isServableFile('preview-draft.html') === false && access.isServableFile('PREVIEW-DRAFT.HTML') === false, 'preview-draft.html is not served (any case)');
  ok(access.isServableFile('review.html') && access.isServableFile('settings.html') && access.isServableFile('settings.js'), 'the review page and Settings are');

  pages();
  if (failures.length) { console.error('review-restore: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('review-restore: all ' + checks + ' checks passed');
})().catch(function (e) { console.error(e); process.exit(1); });

/* ================= the pages ================= */
function es5(name, code) {
  var c = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  ok(!/\blet\s/.test(c) && !/\bconst\s/.test(c) && c.indexOf('=>') === -1 && c.indexOf('`') === -1 && c.indexOf('...') === -1, name + ' is ES5');
}
/* a function of a page's script, two-space indent (as the pages write them) */
function fnSrc(src, name) {
  var one = new RegExp('\\n  function ' + name + '\\([^)]*\\)\\s*\\{[^\\n]*\\}\\n').exec(src);
  if (one) return one[0];
  var m = new RegExp('\\n  function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}\\n').exec(src);
  return m ? m[0] : '';
}
function pages() {
  var REVIEW = read('review.html');
  var script = (REVIEW.match(/<script>\n\(function\(\)\{[\s\S]*?\n\}\)\(\);\n<\/script>/) || [''])[0];
  ok(script.length > 10000, 'review.html: its script was found');
  es5('review.html', script);
  /* UX-106: the phone layout */
  ok(/@media \(max-width: 700px\)\{[\s\S]*?header \.grow\{ flex-basis:100%; order:3; \}[\s\S]*?#status\{ order:2;/.test(REVIEW), 'UX-106 at 700 px the title takes its own line, the badge beside Back');
  ok(/@media \(max-width: 900px\)\{[\s\S]*?\.decide\{ position:sticky; bottom:0;/.test(REVIEW) && /main > \.decide\{ grid-column:1; grid-row:2; \}/.test(REVIEW), 'UX-106 Approve / Reject is its own cell, a bar at the foot on a phone');
  ok(/<\/iframe><\/div><\/div><\/div><\/div>' \+\s*decideHtml\(\);/.test(script) && script.indexOf("settingsHtml() + decideHtml()") === -1, 'UX-106 Approve / Reject comes after the pages, not inside the list above them');
  ok(/\.tabs \[data-view="both"\], \.tabs \.sync\{ display:none; \}/.test(REVIEW) && /var one = !hasBefore \|\| narrow\(\);/.test(script), 'UX-106 a phone opens on the proposed page alone, no side-by-side');
  ok(/widthMode = narrow\(\) \? 'actual' : 'desktop'/.test(script) && /data-width="actual"/.test(script) && /data-width="desktop"/.test(script), 'UX-106/109 Actual size / Desktop: the phone at its own width, full size');
  ok(script.indexOf('See it on the right') === -1 && /shown ' \+ \(narrow\(\) \? 'below' : 'on the right'\)/.test(script), 'UX-106 "See it on the right" says where it really is');
  /* UX-109 */
  ok(/data-section="' \+ esc\(it\.section\)/.test(script) && /s\.scrollIntoView\(\{ block: 'center' \}\)/.test(script) && /s\.style\.outline = '3px solid #ED1C24'/.test(script) && /\}, 2000\);/.test(script), 'UX-109 a change shows its section: scrolled to the middle, outlined for 2 s');
  ok(/<div class="box-load" role="status">Loading the page…<\/div>/.test(script) && /f\.addEventListener\('load', function\(\)\{ var l = f\.parentNode\.querySelector\('\.box-load'\)/.test(script), 'UX-109 each pane says it is loading until its page has come');
  ok(/framed\(proposed\)/.test(script) && /'frame=1'/.test(script), 'UX-109/110 the panes ask for the page without its ribbon');
  /* UX-109: a change in a copied section (key "speakers-2") is found by its key, then by its type for an older page */
  var SI = null;
  try { SI = vm.runInNewContext(fnSrc(script, 'sectionIn') + '; sectionIn', {}); } catch (e) { /* said below */ }
  ok(typeof SI === 'function', 'UX-109 sectionIn was found');
  if (typeof SI !== 'function') SI = function () { return undefined; };
  function fakeDoc(map) { var asked = []; return { asked: asked, querySelector: function (q) { asked.push(q); return map[q] || null; } }; }
  var copyDoc = fakeDoc({ '[data-rv-section][data-rv-key="speakers-2"]': 'JURY', '[data-rv-section="speakers"]': 'SPEAKERS' });
  ok(SI(copyDoc, 'speakers-2') === 'JURY' && copyDoc.asked[0] === '[data-rv-section][data-rv-key="speakers-2"]', 'UX-109 a second copy of a section type is found by its key', JSON.stringify(copyDoc.asked));
  var oldDoc = fakeDoc({ '[data-rv-section="speakers"]': 'SPEAKERS' });
  ok(SI(oldDoc, 'speakers') === 'SPEAKERS' && oldDoc.asked.length === 2, 'UX-109 a page with no keys: found by its type', JSON.stringify(oldDoc.asked));
  ok(SI(fakeDoc({}), 'gone') === null, 'UX-109 a section on neither: none (the miss is said)');
  var quoteDoc = fakeDoc({});
  SI(quoteDoc, 'a"b');
  ok(quoteDoc.asked[0] === '[data-rv-section][data-rv-key="a\\"b"]', 'UX-109 a quote in a key cannot break the selector', JSON.stringify(quoteDoc.asked));
  ok(/s = d && sectionIn\(d, key\);/.test(script) && script.indexOf("sel = '[data-rv-section=\"'") === -1, 'UX-109 jumpTo looks a section up with sectionIn');
  /* UX-110: the labels, run */
  var W = vm.runInNewContext('var data; ' + fnSrc(script, 'liveVersion') + fnSrc(script, 'paneWords') + fnSrc(script, 'versionsWords') +
    '; ({ set: function (d) { data = d; }, pane: paneWords, versions: versionsWords })', {});
  ok(!!W && typeof W.pane === 'function', 'UX-110 paneWords and versionsWords were found');
  W.set({ published: true, publishedVersion: 7 });
  var a = W.pane({ status: 'approved', fromVersion: 6, toVersion: 7 });
  ok(a.after === 'Live now · version 7' && a.before === 'Previously live · version 6' && a.afterTab === 'Live now' && a.beforeTab === 'Previously live', 'UX-110 approved and live: "Live now · version 7", "Previously live · version 6"', JSON.stringify(a));
  ok(W.versions({ status: 'approved', fromVersion: 6, toVersion: 7 }) === 'version 6 → version 7 (live)', 'UX-110 the Versions row says (live)', W.versions({ status: 'approved', fromVersion: 6, toVersion: 7 }));
  W.set({ published: true, publishedVersion: 8 });
  a = W.pane({ status: 'approved', fromVersion: 6, toVersion: 7 });
  ok(a.after === 'Published · version 7 · version 8 is live now' && a.afterTab === 'Published', 'UX-110 approved, since replaced: "Published", and which is live now', JSON.stringify(a));
  a = W.pane({ status: 'pending', fromVersion: 7, toVersion: 9 });
  ok(a.before === 'Live now · version 8' && a.after === 'Proposed · version 9', 'UX-110 waiting: the live pane names the version live now, not the one live when it was sent', JSON.stringify(a));
  W.set({ published: false });
  ok(W.versions({ status: 'approved', firstPublish: true, fromVersion: 0, toVersion: 3 }) === 'not live before → version 3', 'UX-110 a first publication, taken offline since', W.versions({ status: 'approved', firstPublish: true, toVersion: 3 }));
  ok(W.pane({ status: 'rejected', fromVersion: 2, toVersion: 3 }).after === 'Rejected · version 3', 'UX-110 rejected: "Rejected · version 3", never "Proposed"');
  W.set({ published: true, publishedVersion: 8 });
  a = W.pane({ status: 'superseded', fromVersion: 7, toVersion: 8 });
  ok(a.after === 'Closed · version 8 · live now' && W.versions({ status: 'superseded', fromVersion: 7, toVersion: 8 }) === 'version 7 → version 8 (closed, live now)',
    'UX-108/110 a request closed because its version was put back live says that version is live now', JSON.stringify(a));
  W.set({ published: true, publishedVersion: 9 });
  ok(W.pane({ status: 'superseded', fromVersion: 7, toVersion: 8 }).after === 'Closed · version 8' && W.versions({ status: 'superseded', fromVersion: 7, toVersion: 8 }) === 'version 7 → version 8 (closed)',
    'UX-108/110 a request overtaken by a newer version is only "Closed"');
  /* UX-116 */
  ok(/This request was not found — it may have been replaced by a newer one\./.test(script) && /var missing = !!askedFor;/.test(script), 'UX-116 (a) a request not found is said so');
  ok(/'<div class="note"><b>Note from ' \+ esc\(whoText\(r\.requestedBy\)\) \+ ':<\/b> '/.test(script), 'UX-116 (b) the requester\'s note is labelled');
  ok(/placeholder="Note \(needed when rejecting: what should be fixed\)">' \+ \(approvable \? '' : esc\(String\(data\.whyNot/.test(script), 'UX-116 (c) when only Reject is possible, the reason is already in the note');
  ok(/note\('plain', first \? 'Rejected\. Nothing was published\.' : 'Rejected\. The live site is unchanged\.'\)/.test(script) && /\.msg\.plain\{/.test(REVIEW), 'UX-116 (d) a rejection is said plainly, and right for a first publication');
  ok(/AW\.personName\(email\)/.test(script) && /<script src="activity-words\.js"><\/script>/.test(REVIEW), 'UX-116 (e) people by name (activity-words.js personName)');
  /* UX-108, UX-107 on the page */
  ok(script.indexOf('saveApprovalSettings') === -1 && script.indexOf('s-required') === -1 && /See or change this in Settings<\/a>/.test(script) && /\/settings\.html\?event=/.test(script), 'UX-108 the review page shows the rule read-only, with the way to Settings');
  ok(/C\.restoreVersion\(eventId, p\.version\)/.test(script) && /Put version ' \+ esc\(p\.version\) \+ ' back…/.test(script) && /document\.getElementById\('rs-keep'\)\.focus\(\)/.test(script) && /if \(!data\.mayTakeDown\)/.test(script), 'UX-107 Put version N back…: asked first, the safe answer focused, approvers only');

  /* Settings › Publishing approvals */
  var SET = read('settings.html'), SJS = read('settings.js');
  ok(SET.length < 4000 && SET.indexOf('location.replace(') !== -1 && /if \(!id \|\| tab === 'approvals'\) return;/.test(SET), 'settings.html: still sends old event links on, else the approval rule');
  ok(SET.indexOf('Revamp CMS') === -1 && SET.indexOf('Oneworld') === -1 && /<title>Publishing approvals &mdash; EventSphere<\/title>/.test(SET), 'settings.html: the product\'s name');
  es5('settings.js', SJS);
  ok(/Turn off approval for every event\? Publish will then go live immediately/.test(SJS) && /if \(data\.required && !next\.required\) return ask\(next\);/.test(SJS) && /getElementById\('pa-keep'\)\.focus\(\)/.test(SJS), 'settings.js: switching approval off asks first, the safe answer focused');
  ok(/d\.canEdit\s*\?/.test(SJS) && /esc\(d\.whyNot \|\| 'Only an approver can change this\.'\)/.test(SJS), 'settings.js: read-only for a non-approver, with why');
  var S = vm.runInNewContext(fnSrc(SJS, 'list') + fnSrc(SJS, 'changeWords') + '; ({ words: changeWords })', {});
  ok(S.words({ approvers: [], required: true, allowSelf: false }, { approvers: ['boss@x.in'], required: true, allowSelf: false }) === 'approvers anyone on the team → boss@x.in', 'settings.js: a change in words (approvers)', S.words({ approvers: [] }, { approvers: ['boss@x.in'] }));
  ok(S.words({ approvers: ['a@x.in'], required: true }, { approvers: ['a@x.in'], required: false }) === 'approval switched off', 'settings.js: a change in words (switched off)');
  ok(read('publish-flow.js').indexOf('(Settings › Publishing approvals)') !== -1 && read('publish-flow.js').indexOf('review page › Who approves') === -1, 'the publish window points to Settings for adding an approver');

  /* the console */
  var CON = read('edit-event.html');
  ok(/if \(may\) acts\.splice\(acts\.length - 1, 0, '<button class="btn btn-secondary" type="button" id="vis-restore">Put version ' \+ esc\(prev\.version\) \+ ' back…<\/button>'\);/.test(CON) &&
    /if \(back\) back\.onclick = restorePrevious;/.test(CON) && /C\.restoreVersion\(EV\.id, p\.version\)/.test(CON) && /initialFocus: '#rs-keep'/.test(CON), 'UX-107 Visibility: Put version N back… for approvers, before Take the site offline…, asked first');
  ok(/if \(!siteSaved\(\)\) \{ location\.href = editorUrl\(\); return; \}/.test(CON) && /pvLabel\.textContent = pvSaved \? 'Preview' : 'Design the site';/.test(CON), 'UX-065 the console\'s Preview is "Design the site" until the site is saved');
  /* the dashboard */
  var DASH = read('Event_Listing.html');
  ok(/var previewIcon = e\.siteSaved \? quickActionIcon\('view', IC\.eye, 'Preview'/.test(DASH) && /'Design the site', e\.id, 'qa-view'\);/.test(DASH) && /case 'design':\s*\n[^\n]*\n\s*window\.location\.href = '\/custom_editor\.html\?event='/.test(DASH) && /siteSaved: !!\(ev\.site && \+ev\.site\.version > 0\),/.test(DASH),
    'UX-065 the dashboard\'s eye is "Design the site" for a site never saved, and opens the editor');
  /* the editor's chip: live before waiting */
  var ED = read('editor-template-ui.js'), rs = ED.slice(ED.indexOf('  function renderSiteState() {'), ED.indexOf('  function scheduleServerSave() {'));
  ok(rs.indexOf("text = 'Live'") !== -1 && rs.indexOf("text = 'Live'") < rs.indexOf("text = 'Waiting for approval'"), 'UX-108 the editor says Live before it says Waiting for approval');
  ok(read('preview-draft.html').indexOf('NOT SERVED (UX-115)') !== -1, 'UX-115 preview-draft.html says why it is not served');
}
