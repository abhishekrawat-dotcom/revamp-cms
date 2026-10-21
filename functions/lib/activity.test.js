/* node functions/lib/activity.test.js — the activity log's writing side (lib/activity.js) and the routes that
   write to it, run through the real router (lib/api.js handleApi) against an in-memory Firestore and Storage:
   each edit writes one line with who did it, the action and the area; contact details are masked; a failed
   write never fails the edit. No network, no real project. Exits 1 on any failure. */
const path = require('path');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

/* ---------- an in-memory Firestore + Storage, just enough for these routes ---------- */
function isDelete(v) { return v && typeof v === 'object' && /Delete/i.test((v.constructor && v.constructor.name) || '') || (v && v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function setPath(obj, dotted, value) {
  var keys = dotted.split('.'), o = obj;
  for (var i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  if (isDelete(value)) delete o[keys[keys.length - 1]]; else o[keys[keys.length - 1]] = clone(value);
}
function fakeFb() {
  var docs = {}, files = {}, seq = 0;
  function snap(p) {
    var d = docs[p];
    return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; }, updateTime: 't' };
  }
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p, _doc: true,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, 'set', data, o); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, 'update', data); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); },
      create: function (data) { if (docs[p]) return Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })); docs[p] = clone(data); return Promise.resolve(); }
    };
  }
  function write(p, kind, data, o) {
    if (kind === 'set' && !(o && o.merge)) docs[p] = {};
    if (!docs[p]) docs[p] = {};
    Object.keys(data).forEach(function (k) {
      if (kind === 'update') setPath(docs[p], k, data[k]);
      else if (isDelete(data[k])) delete docs[p][k];
      else docs[p][k] = clone(data[k]);
    });
  }
  function colRef(p) {
    var q = {
      path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + (++seq)))); },
      add: function (data) { var r = docRef(p + '/auto' + (++seq)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, where: function () { return q; }, select: function () { return q; },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      }
    };
    return q;
  }
  var db = {
    collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = {
        get: function (r) { return r._doc ? r.get() : r.get(); },
        set: function (r, d, o) { write(r.path, 'set', d, o); return tx; },
        update: function (r, d) { write(r.path, 'update', d); return tx; },
        delete: function (r) { delete docs[r.path]; return tx; }
      };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    getAll: function () { return Promise.all([].slice.call(arguments).map(function (r) { return r.get(); })); },
    batch: function () {
      var ops = [];
      return {
        set: function (r, d, o) { ops.push(function () { write(r.path, 'set', d, o); }); },
        update: function (r, d) { ops.push(function () { write(r.path, 'update', d); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); },
        commit: function () { ops.forEach(function (f) { f(); }); return Promise.resolve(); }
      };
    }
  };
  var bucket = {
    name: 'test-bucket',
    file: function (p) {
      return {
        name: p,
        save: function (buf) { files[p] = buf; return Promise.resolve(); },
        makePublic: function () { return Promise.resolve(); },
        delete: function () { delete files[p]; return Promise.resolve(); },
        exists: function () { return Promise.resolve([!!files[p]]); },
        download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
        getMetadata: function () { return Promise.resolve([{ size: files[p] ? files[p].length : 0 }]); },
        setMetadata: function () { return Promise.resolve(); }
      };
    }
  };
  var auth = { verifyIdToken: function (t) {
    return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
  } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files };
}

/* every require below sees this Firebase */
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

const activity = require('./activity');
const api = require('./api');

function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var req = { method: method, url: url, headers: { authorization: 'Bearer ' + (who || 'editor'), host: 'localhost' }, socket: {}, rawBody: Buffer.from(body ? JSON.stringify(body) : '') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* not json */ } resolve({ status: res.statusCode, body: j, text: t }); }
    };
    api.handleApi(req, res);
  });
}
/* the activity lines of an event, oldest first, once the fire-and-forget writes have landed */
function lines(eventId) {
  return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
    var pre = 'events/' + eventId + '/activity/';
    return Object.keys(FB.docs).filter(function (k) { return k.indexOf(pre) === 0; })
      .map(function (k) { return FB.docs[k]; }).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  });
}
function clearLines(eventId) { Object.keys(FB.docs).forEach(function (k) { if (k.indexOf('events/' + eventId + '/activity/') === 0) delete FB.docs[k]; }); }
function last(list, action) { return list.filter(function (l) { return l.action === action; }).pop(); }

/* ---------- 1. lib/activity.js on its own ---------- */
ok(activity.areaOf({ action: 'form-created' }) === 'forms', 'an old line is placed by its action (form-created -> forms)');
ok(activity.areaOf({ action: 'site-saved', area: 'design' }) === 'design', 'a line\'s own area wins over its action\'s');
ok(activity.areaOf({ action: 'site-saved', area: 'nonsense' }) === 'site', 'an unknown area falls back to the action\'s');
ok(activity.areaOf({ action: 'never-heard-of' }) === 'event', 'an unknown action is "event"');
ok(activity.ACTIONS.every(function (a) { return activity.AREA_OF[a]; }), 'every action has an area');
ok(activity.ACTIONS.every(function (a) { return activity.AREAS.indexOf(activity.AREA_OF[a]) !== -1; }), 'every mapped area is one of the nine');
ok(activity.maskEmail('Asha x — asha.rao@gmail.com') === 'Asha x — a***@gmail.com', 'an email is masked to its first letter and domain', activity.maskEmail('Asha x — asha.rao@gmail.com'));
ok(activity.maskPhone('+91 98765 43210') === '***10', 'a phone number keeps its last two digits only');
var mf = activity.maskFields([{ field: 'email', before: 'old@x.com', after: 'new@y.org' }, { field: 'phone', before: '', after: '9876543210' }, { field: 'name', before: 'A', after: 'B' }]);
ok(mf[0].before === 'o***@x.com' && mf[0].after === 'n***@y.org' && mf[1].after === '***10' && mf[2].after === 'B', 'record fields: email and phone masked, others kept', JSON.stringify(mf));
ok(activity.sectionNames([{ name: 'Hero' }, { name: 'Hero' }, { section: 'faq' }, { name: 'Speakers' }]) === 'Hero, faq, Speakers', 'section names: each once, in order');
ok(/\+2$/.test(activity.sectionNames([1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return { name: 'S' + i }; }))), 'more than six sections are counted, not listed');

(async function () {
  /* logActivity: shape, area, masking; a failing write resolves false */
  var w = fakeFb();
  var okWrite = await activity.logActivity(w, 'ev', { email: 'a@timesinternet.in' }, 'theme-changed', 'Ocean → Dusk', { fields: [{ field: 'contactEmail', before: 'p@q.com', after: '' }] });
  var e = w.docs[Object.keys(w.docs)[0]];
  ok(okWrite === true && e.by === 'a@timesinternet.in' && e.action === 'theme-changed' && e.area === 'design' && /T/.test(e.at), 'logActivity writes at/by/action/area', JSON.stringify(e));
  ok(e.fields[0].before === 'p***@q.com', 'logActivity masks an email field');
  var plat = fakeFb(); await activity.logActivity(plat, 'ev', 'platform', 'repaired', 'x', { area: 'forms' });
  ok(plat.docs[Object.keys(plat.docs)[0]].by === 'platform' && plat.docs[Object.keys(plat.docs)[0]].area === 'forms', 'a script logs as "platform" with its own area');
  var broken = { db: { collection: function () { return { doc: function () { return { collection: function () { return { add: function () { return Promise.reject(new Error('quota')); } }; } }; } }; } } };
  var origErr = console.error; console.error = function () {};
  var r = await activity.logActivity(broken, 'ev', 'x', 'updated', 'y');
  var r2 = await activity.logActivity({}, 'ev', 'x', 'updated', 'y');
  console.error = origErr;
  ok(r === false && r2 === false, 'a failed or impossible write resolves false, never rejects');

  /* ---------- 2. the routes ---------- */
  var EV = 'qa-activity-test', now = new Date().toISOString();
  FB.docs['events/' + EV] = { name: 'QA activity', createdAt: now, updatedAt: now, status: 'draft',
    designPlan: { design: { mode: 'light', primary: '#123456', accent: '#ff8800', bg: '#ffffff', text: '#111111', headingFont: 'Inter', bodyFont: 'Inter' }, sections: [] } };

  /* theme */
  var themes = require('../../templates/_shared/rv-theme.js').themesFor(Object.assign({}, FB.docs['events/' + EV].designPlan.design, require('./gen-design').palette(FB.docs['events/' + EV].designPlan.design, 'auto')));
  var other = themes.filter(function (t) { return t.id !== 'original'; })[0];
  var t = await call('POST', '/api/event/theme', { eventId: EV, themeId: other.id });
  var l = last(await lines(EV), 'theme-changed');
  ok(t.status === 200 && l && l.by === 'editor@timesinternet.in' && l.area === 'design' && l.detail.indexOf(other.label) !== -1, 'POST /api/event/theme logs theme-changed / design with the theme names', JSON.stringify(t.body) + ' ' + JSON.stringify(l));
  clearLines(EV);
  await call('POST', '/api/event/theme', { eventId: EV, themeId: other.id });
  ok(!last(await lines(EV), 'theme-changed'), 'choosing the theme already in use writes no line');

  /* section edges: validated, kept with the theme, logged; an imported site has no such choice */
  clearLines(EV);
  var se = await call('POST', '/api/event/section-edges', { eventId: EV, sectionEdges: 'smooth' });
  var sl = last(await lines(EV), 'theme-changed');
  ok(se.status === 200 && se.body.sectionEdges === 'smooth' && FB.docs['events/' + EV].designPlan.design.sectionEdges === 'smooth', 'POST /api/event/section-edges stores designPlan.design.sectionEdges', JSON.stringify(se.body));
  ok(FB.docs['events/' + EV].designPlan.design.headingFont === 'Inter' && FB.docs['events/' + EV].designPlan.themeId === other.id, 'saving the edges keeps the rest of the design and the theme');
  ok(sl && sl.area === 'design' && sl.detail === 'Section edges: Smooth' && sl.fields[0].before === 'Sharp' && sl.fields[0].after === 'Smooth', 'section edges log "Section edges: Smooth" under Design, with before and after', JSON.stringify(sl));
  clearLines(EV);
  await call('POST', '/api/event/section-edges', { eventId: EV, sectionEdges: 'smooth' });
  ok(!last(await lines(EV), 'theme-changed'), 'choosing the edges already in use writes no line');
  var bad = await call('POST', '/api/event/section-edges', { eventId: EV, sectionEdges: 'wavy' });
  var none = await call('POST', '/api/event/section-edges', { eventId: EV });
  ok(bad.status === 400 && none.status === 400 && FB.docs['events/' + EV].designPlan.design.sectionEdges === 'smooth', 'anything but sharp or smooth is refused and changes nothing', bad.status + ' ' + none.status);
  var badId = await call('POST', '/api/event/section-edges', { eventId: '../x', sectionEdges: 'sharp' });
  var missing = await call('POST', '/api/event/section-edges', { eventId: 'qa-no-such-event', sectionEdges: 'sharp' });
  ok(badId.status === 400 && missing.status === 404 && !FB.docs['events/qa-no-such-event'], 'a bad id is 400, an event that does not exist is 404 and is not created', badId.status + ' ' + missing.status);
  var back = await call('POST', '/api/event/section-edges', { eventId: EV, sectionEdges: 'SHARP' });
  ok(back.status === 200 && FB.docs['events/' + EV].designPlan.design.sectionEdges === 'sharp', 'back to sharp (case does not matter)');
  /* a ported template's site (no AI design) keeps the choice too */
  FB.docs['events/qa-edges-ported'] = { name: 'QA ported', createdAt: now, updatedAt: now, status: 'draft', templateId: 'tech500' };
  var ported = await call('POST', '/api/event/section-edges', { eventId: 'qa-edges-ported', sectionEdges: 'smooth' });
  ok(ported.status === 200 && FB.docs['events/qa-edges-ported'].designPlan.design.sectionEdges === 'smooth', 'a ported template\'s site stores it as well', JSON.stringify(ported.body));
  /* ...and still has no themes: its section edges alone do not make it AI-designed */
  var portedTheme = await call('POST', '/api/event/theme', { eventId: 'qa-edges-ported', themeId: 'dark' });
  ok(portedTheme.status === 404 && !FB.docs['events/qa-edges-ported'].designPlan.themeId, 'a ported site that saved its section edges still has no themes (404)', JSON.stringify(portedTheme.body));
  FB.docs['events/qa-edges-imported'] = { name: 'QA imported', createdAt: now, updatedAt: now, status: 'draft', site: { templateId: 'imported-abc123' } };
  var imp = await call('POST', '/api/event/section-edges', { eventId: 'qa-edges-imported', sectionEdges: 'smooth' });
  ok(imp.status === 400 && imp.body.code === 'imported-site' && !FB.docs['events/qa-edges-imported'].designPlan, 'an imported site is refused and keeps sharp', JSON.stringify(imp.body));

  /* forms: create from a template, duplicate, reorder */
  var c1 = await call('POST', '/api/event/forms', { eventId: EV, template: 'register' });
  var lf = await lines(EV);
  var created = last(lf, 'form-created');
  ok(c1.status === 201 && created && created.area === 'forms' && /template/.test(created.detail) && created.by === 'editor@timesinternet.in', 'form from a template: form-created / forms, names the template', JSON.stringify(c1.body) + ' ' + JSON.stringify(created));
  var listed = await call('GET', '/api/event/forms?eventId=' + EV);
  var formIds = ((listed.body && listed.body.forms) || []).map(function (f) { return f.id; });
  var dup = await call('POST', '/api/event/forms', { eventId: EV, duplicateOf: formIds[formIds.length - 1] });
  var dl = (await lines(EV)).filter(function (x) { return x.action === 'form-created'; }).pop();
  ok(dup.status === 201 && /a copy of/.test(dl.detail), 'a duplicated form says what it is a copy of', dl && dl.detail);
  listed = await call('GET', '/api/event/forms?eventId=' + EV);
  formIds = listed.body.forms.map(function (f) { return f.id; });
  clearLines(EV);
  var ord = await call('POST', '/api/event/forms/order', { eventId: EV, ids: formIds.slice().reverse() });
  var lo = last(await lines(EV), 'forms-reordered');
  ok(ord.status === 200 && lo && lo.area === 'forms' && /new order/.test(lo.detail), 'POST /api/event/forms/order logs forms-reordered / forms', JSON.stringify(ord.body) + ' ' + JSON.stringify(lo));
  clearLines(EV);
  await call('POST', '/api/event/forms/order', { eventId: EV, ids: formIds.slice().reverse() });
  ok(!last(await lines(EV), 'forms-reordered'), 'the same order again writes no line');

  /* upload: a live event's upload is logged, a wizard draft's is not */
  var png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  var up = await call('POST', '/api/event/upload', { eventId: EV, kind: 'logo', fileName: 'logo.png', mimeType: 'image/png', dataBase64: png.toString('base64') });
  var lu = last(await lines(EV), 'file-uploaded');
  ok(up.status === 200 && lu && lu.area === 'design' && /Logo uploaded: logo\.png/.test(lu.detail), 'POST /api/event/upload (logo) logs file-uploaded / design', JSON.stringify(up.body) + ' ' + JSON.stringify(lu));
  await call('POST', '/api/event/upload', { eventId: 'qa-not-created-yet', kind: 'speakers', fileName: 's.png', mimeType: 'image/png', dataBase64: png.toString('base64') });
  ok(!(await lines('qa-not-created-yet')).length, 'an upload for an event not created yet (the wizard) writes no line');

  /* hero video: removing it */
  FB.docs['events/' + EV].heroVideo = { url: 'https://storage.googleapis.com/test-bucket/events/' + EV + '/media/v.mp4', path: 'events/' + EV + '/media/v.mp4', enabled: true };
  var hv = await call('DELETE', '/api/event/hero-video?eventId=' + EV);
  var lh = last(await lines(EV), 'banner-video-changed');
  ok(hv.status === 200 && lh && lh.area === 'design' && /removed/.test(lh.detail), 'DELETE /api/event/hero-video logs banner-video-changed / design', JSON.stringify(hv.body) + ' ' + JSON.stringify(lh));

  /* leads: one added (registrations area, contact masked), then a bulk change */
  var lead = await call('POST', '/api/event/leads', { eventId: EV, name: 'Asha Rao', email: 'asha.rao@gmail.com', phone: '+91 98765 43210' });
  var la = last(await lines(EV), 'content-added');
  var emailField = la && (la.fields || []).filter(function (f) { return f.field === 'email'; })[0];
  ok(lead.status === 200 && la && la.area === 'registrations' && emailField && emailField.after === 'a***@gmail.com', 'a lead added: content-added / registrations, its email masked', JSON.stringify(lead.body) + ' ' + JSON.stringify(la));
  ok(JSON.stringify(la).indexOf('asha.rao@') === -1 && JSON.stringify(la).indexOf('43210') === -1, 'the lead\'s full email and phone are nowhere in the line');
  var bulk = await call('PATCH', '/api/event/leads/bulk', { eventId: EV, ids: [lead.body.id], patch: { stage: 'contacted' } });
  var lb = last(await lines(EV), 'leads-updated');
  ok(bulk.status === 200 && lb && lb.area === 'registrations' && /1 lead/.test(lb.detail), 'PATCH /api/event/leads/bulk logs leads-updated / registrations', JSON.stringify(bulk.body) + ' ' + JSON.stringify(lb));

  /* a speaker (content area) */
  var sp = await call('POST', '/api/event/speakers', { eventId: EV, name: 'Meera Iyer' });
  var ls = last(await lines(EV), 'content-added');
  ok(sp.status === 200 && ls && ls.area === 'content' && /Meera Iyer/.test(ls.detail), 'a speaker added: content-added / content');

  /* registrations: a registrant known only by email is masked */
  FB.docs['events/' + EV + '/registrations/r1'] = { email: 'vikram.s@gmail.com', status: 'pending', createdAt: now, formId: 'register' };
  var del = await call('DELETE', '/api/event/registrations?eventId=' + EV + '&id=r1');
  var lr = last(await lines(EV), 'registration-deleted');
  ok(lr && lr.area === 'registrations' && lr.detail === 'v***@gmail.com', 'a registration deleted: registrations area, email masked', del.status + ' ' + JSON.stringify(del.body) + ' ' + JSON.stringify(lr));

  /* a lead changed one at a time: the change, before and after, contact masked */
  var lu2 = await call('PATCH', '/api/event/leads', { eventId: EV, id: lead.body.id, email: 'asha@newco.in', appendNote: { kind: 'call', text: 'Spoke today' } });
  var lc = last(await lines(EV), 'content-changed');
  var ef = lc && (lc.fields || []).filter(function (f) { return f.field === 'email'; })[0];
  ok(lu2.status === 200 && lc && lc.area === 'registrations' && /call logged/.test(lc.detail) && ef && ef.before === 'a***@gmail.com' && ef.after === 'a***@newco.in',
    'a lead changed: content-changed / registrations, email before/after masked, the call named', lu2.status + ' ' + JSON.stringify(lc));

  /* every line written so far has the shared shape */
  var all = await lines(EV);
  ok(all.length && all.every(function (x) { return typeof x.at === 'string' && x.by && x.action && typeof x.detail === 'string' && activity.AREAS.indexOf(x.area) !== -1; }), 'every line has at, by, action, detail and a known area');

  console.log(checks + ' checks, ' + failures.length + ' failed');
  if (failures.length) { failures.forEach(function (f) { console.log('  FAIL ' + f); }); process.exit(1); }
  process.exit(0);
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
