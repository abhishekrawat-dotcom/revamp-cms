/* node functions/lib/seo-flow.test.js — Settings › URL & SEO from end to end, through the real routes (lib/api.js,
   lib/api-seo.js) against an in-memory Firestore and Storage, with the model and ET's API stubbed (no network, no cost):
     - saving the fields (PATCH /api/event settings.seo), the Indian postcode rule, the activity line field by field;
     - the section (GET /api/event/seo): what the next publish writes, what changed since the live version, which
       speakers, FAQs and testimonials the site shows, the checklist;
     - ETB2B AI (POST /api/event/seo/write): writes and saves the fields at once, marks them as its own, says what was
       there before (for Undo), leaves out a field that says something the event's details do not (a made-up "2000+",
       last year's year), logs the action and counts it in the event's AI usage; FAQ drafts are returned, not saved;
     - the previous edition (GET /api/event/seo/previous): the one recorded by Create Event, its testimonials and its
       address when the venue is the same; another portal's refused;
     - going live: the live page reads the PUBLISHED copy — a change in the console does not reach /e/<id> until the
       next publish (direct) or approval; an approval of search settings alone; what the approver saw is what goes live;
       a republish of what is live keeps its copy. */
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

/* ---------- the model, stubbed: what it is asked, and what it answers ---------- */
var ASKED = [], ANSWER = null;
var realLlm = require('./llm');
stub('./llm', Object.assign({}, realLlm, { callJson: function (prompt, schema, opts) {
  ASKED.push({ prompt: prompt, schema: schema, opts: opts });
  if (opts && typeof opts.onUsage === 'function') opts.onUsage({ provider: 'claude', inputTokens: 1200, outputTokens: 300, usd: 0.006 });
  return Promise.resolve(typeof ANSWER === 'function' ? ANSWER(prompt, schema) : { parsed: ANSWER, provider: 'claude', model: 'stub' });
} }));
/* ---------- ET's API, stubbed with the answers saved from it ---------- */
function fixture(n) { return fs.readFileSync(path.join(__dirname, 'fixtures', 'seo-previous', n), 'utf8'); }
var ET_ASKED = [];
var realSafe = require('./safe-fetch');
stub('./safe-fetch', Object.assign({}, realSafe, { safeFetch: function (u, o) {
  ET_ASKED.push({ u: u, h: o && o.headers });
  var body = null;
  if (/microsite\/details\?digital_month_id=3543$/.test(u)) body = fixture('ms-hr-3543.json');
  else if (/testimonial\/list\?entity_id=3543&/.test(u)) body = fixture('testimonials-hr-3543.json');
  else if (/\/v1\/event-listing/.test(u) && o.headers.portal === 'hr') body = JSON.stringify({ status: true, data: { active: [], upcoming: [], past: { items: [{ entity_id: 3543, title: 'ET Nextech 2026', ownership_type: 1, event_start_date: '2026-02-18 08:00:00', event_end_date: '2026-02-19 23:59:00', link: 'https://hr.economictimes.indiatimes.com/nextech2026', is_past: 1 }], total_pages: 1, cur_page: 1, is_last_page: true } } });
  return Promise.resolve(body == null ? { status: 404, body: Buffer.from('') } : { status: 200, body: Buffer.from(body) });
} }));
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var api = require('./api');
var hooks = api._testHooks;

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
      end: function (b) { var t = b ? (Buffer.isBuffer(b) ? b.toString('utf8') : String(b)) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, text: t, body: j, headers: res.headers }); } };
    api.handleApi(req, res);
  });
}
function lds(html) {
  var out = [], re = /<script type="application\/ld\+json" data-rv-seo>([\s\S]*?)<\/script>/g, m;
  while ((m = re.exec(html))) out.push(JSON.parse(m[1]));
  return out;
}
function title(html) { var m = /<title[^>]*>([^<]*)<\/title>/.exec(html || ''); return m ? m[1] : null; }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function activityOf(id, action) { return Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + id + '/activity/') === 0 && FB.docs[k].action === action; }).map(function (k) { return FB.docs[k]; }); }

/* ---------- the event ---------- */
var PAGE = [
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head>',
  '<body class="microsite rv-generated" data-rv-template-id="gen-seo-a" id="gen"><div class="col-md-12 no-padding">',
  '<section data-rv-section="hero" id="hero"><div class="rv-lu rv-lu-pic"><img class="rv-lu-img" src="https://x/logo-unit.png" alt="ET Nextech 2027"></div><p>Where HR meets technology</p></section>',
  '<section data-rv-section="speakers" id="speakers"><h2>Speakers</h2><div data-rv-list="speakers"><article data-rv-item="speakers" data-rv-id="sp1"><h3>Asha Rao</h3><p>CHRO, Acme</p></article></div></section>',
  '<section data-rv-section="faqs" id="faqs"><h2>FAQs</h2><div data-rv-list="faq"><details data-rv-item="faq" data-rv-id="fq1"><summary>Who should attend?</summary><p>HR leaders.</p></details></div></section>',
  '<section data-rv-section="voices" id="voices"><h2>Voices</h2><blockquote>I thoroughly enjoyed my time at Nextech. The panel discussion I was part of focused on the intersection of employee and customer experiences as the workplace turns more and more digital.</blockquote></section>',
  '<footer data-rv-section="footer" id="footer" data-rv-et-footer="hr"><p>f</p></footer>',
  '</div></body></html>'
].join('\n');
var NOW = '2026-11-01T00:00:00.000Z';
var ID = 'seo-a';
FB.docs['config/approvals'] = { required: false };
FB.docs['events/' + ID] = { name: 'ET Nextech 2027', createdAt: NOW, start: '2027-02-18T09:00', end: '2027-02-19T18:00', dateMode: 'exact', venue: 'The Leela Ambience, Gurugram', city: 'Gurugram',
  portal: 'hr', category: 'ip', description: 'Two days for HR leaders on the future of work.', site: { version: 1, templateId: 'gen-seo-a' }, templateId: 'gen-seo-a' };
FB.docs['events/' + ID + '/speakers/sp1'] = { name: 'Asha Rao', desig: 'CHRO', comp: 'Acme', order: 1 };
FB.docs['events/' + ID + '/speakers/sp2'] = { name: 'Not Yet On Page', order: 2 };
FB.docs['events/' + ID + '/faqs/fq1'] = { question: 'Who should attend?', answer: 'HR leaders.', order: 1 };
/* the previous edition Create Event read for it */
FB.docs['events/' + ID + '/sources/src1'] = { type: 'previousEdition', url: 'https://hr.economictimes.indiatimes.com/nextech2026', previous: { portal: 'hr', id: '3543', name: 'ET Nextech 2026', url: 'https://hr.economictimes.indiatimes.com/nextech2026' } };
FB.files['events/' + ID + '/site/page.html'] = Buffer.from(PAGE);
FB.files['events/' + ID + '/site/versions/1/page.html'] = Buffer.from(PAGE);
function livePage() { return FB.files['events/' + ID + '/published/index.html'] ? String(FB.files['events/' + ID + '/published/index.html']) : null; }
function served() { hooks.forgetCachedPage(ID); return call('GET', '/e/' + ID); }

(async function () {
  var r;
  /* ---------- 1. saving the fields ---------- */
  r = await call('PATCH', '/api/event', { token: 'owner', body: { eventId: ID, settings: { seo: { title: 'ET Nextech 2027 | HR Tech Summit', postalCode: '12201' } } } });
  ok(r.status === 400 && r.body.field === 'settings.seo.postalCode' && /6 digits/.test(r.body.error), 'an Indian postcode of 5 digits is refused, by field', r.status + ' ' + r.text);
  ok(!(FB.docs['events/' + ID].settings), 'and nothing was saved');
  r = await call('PATCH', '/api/event', { token: 'owner', body: { eventId: ID, settings: { seo: { title: 'ET Nextech 2027 | HR Tech Summit', keywords: ['HR Tech Summit', 'HR events in India'], postalCode: '122010',
    streetAddress: 'National Highway 8, Ambience Island', testimonials: [{ id: 't1', name: 'Pramod Bhasin', role: 'Founder', company: 'Genpact', text: 'I thoroughly enjoyed my time at Nextech. The panel discussion I was part of focused on the intersection of employee and customer experiences as the workplace turns more and more digital.', rating: 5, from: 'previous', prevId: '264' },
      { id: 't2', name: 'Elsewhere', text: 'These words are not on the site.', rating: 2 }] } } } });
  ok(r.status === 200, 'the fields are saved', r.status + ' ' + r.text);
  var seo = FB.docs['events/' + ID].settings.seo;
  ok(seo.title === 'ET Nextech 2027 | HR Tech Summit' && seo.postalCode === '122010' && seo.testimonials.length === 2, 'as typed');
  var line = activityOf(ID, 'settings-changed')[0];
  ok(line && line.area === 'settings' && /SEO › SEO title/.test(line.detail) && line.fields.some(function (f) { return f.field === 'SEO › Postcode' && f.after === '122010'; }), 'the activity log says which fields, by their names', line && JSON.stringify(line).slice(0, 400));

  /* ---------- 2. the section ---------- */
  r = await call('GET', '/api/event/seo?eventId=' + ID, { token: 'owner' });
  var S = r.body || {};
  ok(r.status === 200 && S.head && S.head.title === 'ET Nextech 2027 | HR Tech Summit' && S.head.keywords === 'HR Tech Summit, HR events in India', 'the section: the title and keywords the next publish writes', r.status + ' ' + JSON.stringify(S.head));
  ok(S.auto && S.auto.place && S.auto.place.label === 'Gurugram, Haryana, India' && S.auto.organizer.name === 'ETHRWorld.com' && S.auto.logo && S.auto.logo.url === 'https://x/logo-unit.png' && S.auto.dates.exact === true,
    'what is worked out: the place, the organiser, the logo unit, the dates', JSON.stringify(S.auto).slice(0, 500));
  ok(S.auto.canonical === require('./public-base').publicSiteBase() + '/e/' + ID && S.auto.indexing.reason === 'not-live', 'the canonical address (the one public address setting); not listed until it is live', JSON.stringify(S.auto.indexing));
  var sp = (S.speakers || []).reduce(function (a, s) { a[s.id] = s; return a; }, {});
  ok(sp.sp1 && sp.sp1.shown === true && sp.sp2 && sp.sp2.shown === false && S.faqs[0].shown === true, 'which speakers and FAQs the site shows', JSON.stringify(S.speakers));
  ok(S.testimonials.t1.shown === true && S.testimonials.t2.shown === false, 'which testimonials the site shows');
  var E = S.schema.event;
  ok(E && E.location.address.postalCode === '122010' && E.performer.length === 1 && E.review.length === 1 && E.aggregateRating.ratingValue === 5 && S.schema.faq.mainEntity.length === 1 && S.schema.problems.length === 0,
    'the structured data the next publish writes: only what the site shows, valid', JSON.stringify(E).slice(0, 400) + ' ' + JSON.stringify(S.schema.problems));
  ok(S.schema.report.notShown.speakers.indexOf('sp2') !== -1 && S.schema.report.notShown.testimonials.indexOf('t2') !== -1, 'and what it leaves out because the site does not show it');
  var ready = (S.ready || []).reduce(function (a, x) { a[x.id] = x; return a; }, {});
  ok(ready.title.ok && !ready.description.ok && ready.address.ok && ready.reviews.ok && ready.offers.level === 'info' && /no passes/.test(ready.offers.text), 'the checklist: done, missing, and passes left out', JSON.stringify(S.ready).slice(0, 600));
  ok(S.changes.some(function (c) { return c.field === 'title'; }) && S.live.published === false, 'what changed since the live version (nothing is live yet)');

  /* ---------- 3. ETB2B AI ---------- */
  ASKED = [];
  ANSWER = { title: 'ET Nextech 2027: HR Tech Summit in Gurugram', description: 'Join 2000+ HR leaders at ET Nextech 2027 in Gurugram.', keywords: ['HR Tech Summit', 'HR summit 2026', 'Nextech 2027', 'HR events Gurugram', 'Future of work'],
    h1: 'ET Nextech 2027: HR Tech Summit', schemaTitle: 'ET Nextech 2027 HR Tech Summit', schemaDescription: 'Two days on 18–19 February 2027 for HR leaders on the future of work, at The Leela Ambience, Gurugram.' };
  r = await call('POST', '/api/event/seo/write', { token: 'owner', body: { eventId: ID, fields: ['title', 'description', 'keywords', 'h1', 'schemaTitle', 'schemaDescription'] } });
  ok(r.status === 200, 'ETB2B AI answers', r.status + ' ' + r.text.slice(0, 300));
  var P = ASKED[0] && ASKED[0].prompt;
  ok(P && /NEVER INVENT A FACT/.test(P) && /Event name: ET Nextech 2027/.test(P) && /Dates: 18–19 February 2027/.test(P) && /Venue: The Leela Ambience, Gurugram/.test(P) && /Portal \(the ETB2B publication that runs it\): ETHRWorld/.test(P),
    'it is given the event\'s real details', P && P.slice(0, 600));
  ok(P && /The site's headings: Speakers · Asha Rao · FAQs · Voices/.test(P) && /Where HR meets technology/.test(P), 'and the site\'s own words', P && P.slice(P.indexOf('The site'), P.indexOf('The site') + 300));
  ok(P && /PREVIOUS EDITION'S SEARCH TEXT/.test(P) && /Never copy it/.test(P) && /HR Summit 2026/.test(P), 'and the previous edition\'s SEO from ET, as a reference only');
  ok(ASKED[0].opts.route === 'seo-write' && ASKED[0].schema.properties.keywords.type === 'ARRAY', 'its own route and a small strict schema');
  var W = r.body || {};
  ok(W.values && W.values.title === ANSWER.title && W.values.h1 === ANSWER.h1 && !('description' in W.values), 'the fields are written, but not the description that made up "2000+"', JSON.stringify(W.values));
  ok(W.values.keywords && W.values.keywords.indexOf('HR summit 2026') === -1 && W.values.keywords.length === 4, 'a keyword with last year\'s year is left out, the rest kept', JSON.stringify(W.values.keywords));
  ok((W.dropped || []).some(function (d) { return d.field === 'description' && /2000\+/.test(d.why); }), 'and the team is told why', JSON.stringify(W.dropped));
  seo = FB.docs['events/' + ID].settings.seo;
  ok(seo.title === ANSWER.title && seo.schemaDescription === ANSWER.schemaDescription && seo.postalCode === '122010' && seo.testimonials.length === 2, 'saved at once, the team\'s other fields kept');
  ok(JSON.stringify(seo.aiWritten.slice().sort()) === JSON.stringify(['h1', 'keywords', 'schemaDescription', 'schemaTitle', 'title']) && W.before.title === 'ET Nextech 2027 | HR Tech Summit' && W.before.h1 === '', 'marked as ETB2B AI\'s; what was there before is given for Undo', JSON.stringify(seo.aiWritten) + ' ' + JSON.stringify(W.before));
  var aiLine = activityOf(ID, 'seo-written')[0];
  ok(aiLine && aiLine.area === 'settings' && /ETB2B AI wrote SEO title/.test(aiLine.detail) && /previous edition as a reference/.test(aiLine.detail) && aiLine.fields.length >= 4, 'logged in the activity log', aiLine && JSON.stringify(aiLine).slice(0, 300));
  ok(FB.docs['events/' + ID]['aiUsage.byRoute.seo-write.calls'] === 'inc', 'counted in the event\'s AI usage, under its own step');
  /* Undo: what was before, saved back */
  r = await call('PATCH', '/api/event', { token: 'owner', body: { eventId: ID, settings: { seo: Object.assign({}, W.before, { aiWritten: W.aiWrittenBefore }) } } });
  seo = FB.docs['events/' + ID].settings.seo;
  ok(r.status === 200 && seo.title === 'ET Nextech 2027 | HR Tech Summit' && seo.h1 === '' && seo.aiWritten.length === 0, 'Undo puts back what was there', JSON.stringify(seo).slice(0, 300));
  r = await call('POST', '/api/event/seo/write', { token: 'owner', body: { eventId: ID, fields: ['title', 'testimonials'] } });
  ok(r.status === 400 && r.body.code === 'bad-field', 'ETB2B AI never writes a testimonial', r.text);
  /* the date to be announced: no dates for the model, and none let through */
  FB.docs['events/seo-tba'] = { name: 'ET HR Awards', createdAt: NOW, dateMode: 'tbd', dateLabel: 'Early 2027', portal: 'hr', category: 'awards' };
  ASKED = []; ANSWER = { title: 'ET HR Awards on 12 March 2027', h1: 'ET HR Awards 2027' };
  r = await call('POST', '/api/event/seo/write', { token: 'owner', body: { eventId: 'seo-tba', fields: ['title', 'h1'] } });
  ok(r.status === 200 && /Dates: to be announced/.test(ASKED[0].prompt) && !r.body.values.title && r.body.dropped.some(function (d) { return d.field === 'title'; }), 'a date the event does not have is never written', r.text.slice(0, 300));
  /* FAQs drafted, not saved */
  ANSWER = { faqs: [{ question: 'Who should attend ET Nextech 2027?', answer: 'HR leaders and people who run HR technology.' }, { question: 'How much is a pass?', answer: 'Passes are ₹8,999.' }, { question: 'Where is it?', answer: 'At The Leela Ambience, Gurugram.' }] };
  var faqsBefore = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + ID + '/faqs/') === 0; }).length;
  r = await call('POST', '/api/event/seo/write', { token: 'owner', body: { eventId: ID, faqs: true } });
  ok(r.status === 200 && r.body.faqs.length === 2 && r.body.dropped.length === 1 && /a price|8999|8,999/.test(r.body.dropped[0].why), 'FAQ drafts: a made-up price is left out', r.text.slice(0, 400));
  ok(Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + ID + '/faqs/') === 0; }).length === faqsBefore, 'and nothing is saved by the draft (the console adds them through Content › FAQ)');

  /* ---------- 4. the previous edition ---------- */
  ET_ASKED = [];
  r = await call('GET', '/api/event/seo/previous?eventId=' + ID, { token: 'owner' });
  var PV = r.body || {};
  ok(r.status === 200 && PV.previous && PV.previous.id === '3543' && PV.previous.from === 'create' && PV.previous.testimonials.length === 3, 'the previous edition Create Event read, with ET\'s three testimonials', r.text.slice(0, 300));
  ok(PV.sameVenue === true && PV.previous.seo.streetAddress === 'National Highway 8, Ambience Island, DLF Phase 3, Sector 24' && PV.previous.seo.postalCode === '122010', 'the same venue: its address is offered');
  ok(ET_ASKED.every(function (a) { return a.h.portal === 'hr'; }), 'asked of ET with the portal header');
  r = await call('GET', '/api/event/seo/previous?eventId=' + ID + '&portal=cio&id=3543', { token: 'owner' });
  ok(r.status === 400 && r.body.code === 'other-portal', 'a previous edition from another portal is refused (owner rule)', r.text);
  r = await call('GET', '/api/event/seo/previous?eventId=' + ID + '&portal=hr&id=3543', { token: 'owner' });
  ok(r.status === 200 && r.body.previous && r.body.previous.from === 'picked', 'one of the portal\'s own ET events may be picked', r.text.slice(0, 200));
  r = await call('GET', '/api/event/seo/previous?eventId=' + ID + '&portal=hr&id=9999', { token: 'owner' });
  ok(r.status === 400 && r.body.code === 'not-on-portal', 'but not an id that is not one of them', r.text);

  /* ---------- 5. going live (approval off): the published copy ---------- */
  r = await call('POST', '/api/event/publish', { token: 'owner', body: { eventId: ID } });
  ok(r.status === 200 && FB.docs['events/' + ID].published === true, 'published', r.status + ' ' + r.text.slice(0, 200));
  var pub = FB.docs['events/' + ID].publishedSeo;
  ok(pub && pub.fields.title === 'ET Nextech 2027 | HR Tech Summit' && pub.records.speakers.length === 2 && pub.records.faqs.length === 1 && !('aiWritten' in pub.fields) && pub.by === 'owner@timesinternet.in', 'the SEO values went live with it, as a copy', JSON.stringify(pub).slice(0, 300));
  r = await served();
  ok(r.status === 200 && title(r.text) === 'ET Nextech 2027 | HR Tech Summit', '/e/: the published title', title(r.text));
  var L = lds(r.text), LE = L.filter(function (x) { return x['@type'] === 'Event'; })[0];
  ok(LE && LE.location.address.streetAddress === 'National Highway 8, Ambience Island' && LE.performer.length === 1 && LE.review.length === 1 && L.some(function (x) { return x['@type'] === 'FAQPage'; }), '/e/: the Event, its performer and review, the FAQPage', JSON.stringify(LE).slice(0, 300));
  /* a change in the console: the live page does not change */
  r = await call('PATCH', '/api/event', { token: 'owner', body: { eventId: ID, settings: { seo: { title: 'A title not yet published', streetAddress: 'Somewhere else', noindex: true, testimonials: [] } } } });
  ok(r.status === 200, 'a later change is saved');
  r = await served();
  ok(title(r.text) === 'ET Nextech 2027 | HR Tech Summit' && r.text.indexOf('A title not yet published') === -1 && r.text.indexOf('Somewhere else') === -1, '/e/ does not change until the next publish', title(r.text));
  ok(/<meta name="robots" content="index, follow/.test(r.text) && !r.headers['x-robots-tag'], 'nor does keeping it out of search (it goes live with the next publish)');
  var again = hooks.sitePagePass(livePage(), { mode: 'live', event: FB.docs['events/' + ID], templateId: 'gen-seo-a' });
  ok(again === livePage() || lds(again).filter(function (x) { return x['@type'] === 'Event'; })[0].review.length === 1, 'the page pass on every serve reads the published copy, not the draft');
  r = await call('GET', '/api/event/seo?eventId=' + ID, { token: 'owner' });
  ok(r.body.changes.some(function (c) { return c.field === 'title' && c.before === 'ET Nextech 2027 | HR Tech Summit' && c.after === 'A title not yet published'; }) && r.body.changes.some(function (c) { return c.field === 'noindex'; }),
    'the section lists what changed since the live version', JSON.stringify(r.body.changes).slice(0, 400));

  /* ---------- 6. going live through an approval of search settings alone ---------- */
  FB.docs['config/approvals'] = { required: true, approvers: ['approver@timesinternet.in'], allowSelf: false };
  r = await call('POST', '/api/event/approval/request', { token: 'owner', body: { eventId: ID } });
  ok(r.status === 200 && r.body.toVersion === 1 && r.body.fromVersion === 1 && /search and sharing: \d+ changes/.test(r.body.summary), 'the live version with new search settings can be sent for approval', r.status + ' ' + r.text.slice(0, 300));
  var reqId = r.body.id, request = FB.docs['events/' + ID + '/approvals/' + reqId];
  ok(request && request.seoOnly === true && request.seo.title === 'A title not yet published' && request.items.every(function (i) { return i.type === 'seo'; }) && request.items.some(function (i) { return i.name === 'SEO title'; }),
    'the request lists the search changes alone and carries the settings as they were asked for', JSON.stringify(request && request.items).slice(0, 300));
  /* changed again after asking: not what the approver saw, so not what goes live */
  await call('PATCH', '/api/event', { token: 'owner', body: { eventId: ID, settings: { seo: { title: 'Typed after the request' } } } });
  r = await call('GET', '/api/event/approval?eventId=' + ID, { token: 'approver' });
  ok(r.status === 200 && r.body.request && r.body.request.seoOnly === true, 'the approver\'s view knows it is search settings only');
  r = await call('POST', '/api/event/approval/decide', { token: 'approver', body: { eventId: ID, id: reqId, decision: 'approve' } });
  ok(r.status === 200, 'approved', r.status + ' ' + r.text.slice(0, 200));
  pub = FB.docs['events/' + ID].publishedSeo;
  ok(pub.fields.title === 'A title not yet published' && pub.fields.noindex === true, 'what the approver saw is what went live, not what was typed after', JSON.stringify(pub.fields).slice(0, 200));
  r = await served();
  ok(title(r.text) === 'A title not yet published' && /noindex/.test(r.text) && r.headers['x-robots-tag'] === 'noindex, nofollow', '/e/: the approved title, and now kept out of search', title(r.text) + ' ' + r.headers['x-robots-tag']);
  ok(lds(r.text).filter(function (x) { return x['@type'] === 'Event'; })[0].review === undefined, 'no reviews once the testimonials are gone');
  /* nothing new: nothing to ask */
  await call('PATCH', '/api/event', { token: 'owner', body: { eventId: ID, settings: { seo: { title: 'A title not yet published' } } } });
  r = await call('POST', '/api/event/approval/request', { token: 'owner', body: { eventId: ID } });
  ok(r.status === 409 && r.body.code === 'nothing-to-publish' && /search and sharing settings are already live/.test(r.body.error), 'nothing new: nothing to send', r.text);

  /* ---------- 7. a republish of what is live keeps its copy ---------- */
  await call('PATCH', '/api/event', { token: 'owner', body: { eventId: ID, settings: { seo: { title: 'Draft during an ops republish' } } } });
  var out = await hooks.publishVersion(FB, { headers: { host: 'localhost' } }, ID, 1, 'platform', '');
  ok(out && out.publishedVersion === 1 && FB.docs['events/' + ID].publishedSeo.fields.title === 'A title not yet published' && title(livePage()) === 'A title not yet published', 'tools/republish-current.js puts live what is live, its SEO too');
  /* a site published before the copy existed: its four old settings, and nothing new until its next publish */
  delete FB.docs['events/' + ID].publishedSeo;
  r = await call('GET', '/api/event/seo?eventId=' + ID, { token: 'owner' });
  ok(r.body.live.legacy === true && r.body.changes.some(function (c) { return c.field === 'title'; }), 'a site live before the copy: everything new is a change for its next publish');

  if (failures.length) { console.error('seo-flow: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('seo-flow: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (e) { console.error('seo-flow: the checks did not run — ' + (e && e.stack)); process.exit(1); });
