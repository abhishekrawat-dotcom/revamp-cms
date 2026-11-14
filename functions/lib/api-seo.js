// The console's Settings › URL & SEO: every SEO field of ET's own event platform, in one section (the owner,
// 6 Nov 2026: "keep everything in one section under settings -> seo" — search and sharing only, never the site's words).
//
//   GET  /api/event/seo?eventId=                          -> SECTION (below)                               (admin)
//   POST /api/event/seo/write { eventId, fields: [..] }   -> { values, before, aiWritten, dropped, updatedAt } (admin, AI)
//        ETB2B AI writes those fields (seo-ai.js) from the event's real details and SAVES them at once — the console's
//        "do it, then undo": Undo saves `before` back. A field whose answer said something the event's details do not
//        is not written (dropped, with the reason). Logged in the activity log; counted in the event's AI usage.
//   POST /api/event/seo/write { eventId, faqs: true }     -> { faqs: [{ question, answer }], dropped }      (admin, AI)
//        drafts FAQs for an event that has none; the console adds them to Content › FAQ through the same route a
//        person uses (POST /api/event/faqs), for the team to check. Nothing is saved here.
//   GET  /api/event/seo/previous?eventId=[&portal=&id=]   -> { previous: PREVIOUS | null, sameVenue, why }  (admin)
//        the previous edition's SEO, FAQs and testimonials from ET's API (seo-previous.js): the one the event records
//        (picked here — settings.seo.previous — else the one Create Event read), or the one named, which must be one of
//        the event's own portal's ET events (owner rule: previous editions come from that portal only).
//
// SECTION = { eventId, seo (the draft), live: { published, publishedAt, fields, at, by, legacy }, changes: [..] (what the
//   next publish changes), pending (a request waiting, and whether it carries the SEO as it is now), approvalRequired,
//   auto: { canonical, indexing, place, attendance, organizer, logo, dates, venue, h1, title, description, image },
//   head: what the next publish writes (title, description, keywords, canonical, ogTitle, ogImage, robots, h1),
//   speakers / faqs: [{ id, name|question, …, counts, shown }], testimonials: { id: { shown } },
//   schema: { event, faq, report, problems }, ready: [{ id, group, label, ok, level, text }], previous: { … } | null }
// What the next publish writes is worked out by running the publish transform itself on the saved site with the SEO
// as it would go live (live mode, never stored): the section shows the very title, description, canonical, H1 and
// structured data the live page will carry, and which speakers, FAQs and testimonials it shows.
//
// lib/api.js hands this module its helpers (wire()) on every call, as it does for share-preview.js.
'use strict';

const { sendJson, rateLimit } = require('./http');
const activity = require('./activity');
const llm = require('./llm');
const etEvents = require('./et-events');
const etFooter = require('./et-footer');
const etNav = require('./et-nav');
const siteChecks = require('./site-checks');
const siteSeo = require('./site-seo');
const seoFields = require('./seo-fields');
const seoSchema = require('./seo-schema');
const seoAi = require('./seo-ai');
const seoPrevious = require('./seo-previous');
const genDesign = require('./gen-design');
const RR = require('../../templates/_shared/rv-records.js');

var H = null;
function wire(helpers) { H = helpers; }

var AI_LIMIT = { max: 20, ms: 10 * 60 * 1000 };
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function str(v) { return typeof v === 'string' ? v : ''; }

/* ---------- what the next publish writes, read off the transformed page ---------- */
function attr(tag, name) {
  var m = new RegExp('\\s' + name + '="([^"]*)"', 'i').exec(tag);
  return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
}
function readHead(html) {
  var out = { title: '', description: '', keywords: '', canonical: '', ogTitle: '', ogDescription: '', ogImage: '', robots: '', h1: '', h1Hidden: false, jsonLd: [] };
  html = String(html || '');
  var head = html.split(/<body\b/i)[0];
  var t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (t) out.title = t[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  (head.match(/<meta\b[^>]*>/gi) || []).forEach(function (m) {
    var n = attr(m, 'name').toLowerCase(), p = attr(m, 'property').toLowerCase(), c = attr(m, 'content');
    if (n === 'description') out.description = c;
    if (n === 'keywords') out.keywords = c;
    if (n === 'robots') out.robots = c;
    if (p === 'og:title') out.ogTitle = c;
    if (p === 'og:description') out.ogDescription = c;
    if (p === 'og:image' && !out.ogImage) out.ogImage = c;
  });
  var can = /<link\b[^>]*rel="canonical"[^>]*>/i.exec(head);
  if (can) out.canonical = attr(can[0], 'href');
  var re = /<script type="application\/ld\+json" data-rv-seo>([\s\S]*?)<\/script>/g, m2;
  while ((m2 = re.exec(html))) { try { out.jsonLd.push(JSON.parse(m2[1])); } catch (e) { /* not ours to read */ } }
  /* the page's first h1 outside a <template>: its own, or the hidden one the page pass writes (data-rv-a11y) */
  var body = html.replace(/<template\b[\s\S]*?<\/template>/gi, '');
  var h = /<h1\b([^>]*)>([\s\S]*?)<\/h1>/i.exec(body);
  if (h) { out.h1 = h[2].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); out.h1Hidden = /data-rv-a11y/.test(h[1]); }
  return out;
}

/* ---------- the checklist: what is complete for search and what is missing ---------- */
function readiness(x) {
  var items = [], seo = x.seo || {}, head = x.head || {}, auto = x.auto || {}, sd = x.schema || {};
  function add(group, id, label, level, text) { items.push({ group: group, id: id, label: label, ok: level === 'ok', level: level, text: text }); }
  var tl = (seo.title || '').length;
  add('search', 'title', 'SEO title', seo.title ? (tl <= 60 ? 'ok' : 'warn') : 'warn',
    seo.title ? (tl <= 60 ? tl + ' characters' : tl + ' characters: a search result shows about 60') : 'None yet: the event’s name is used. Write one (about 60 characters).');
  var dl = (head.description || '').length;
  add('search', 'description', 'Meta description', !seo.description ? 'warn' : dl >= 70 && dl <= 160 ? 'ok' : 'warn',
    !seo.description ? (head.description ? 'None yet: the short description from Basics is used.' : 'None yet, and Basics has no short description: search engines pick words from the page.')
      : dl > 160 ? 'Cut to 160 characters in results' : dl < 70 ? dl + ' characters: 120 to 160 reads best' : dl + ' characters');
  var kn = (seo.keywords || []).length;
  add('search', 'keywords', 'Keywords', kn >= 8 && kn <= 12 ? 'ok' : 'warn', kn ? kn + (kn === 1 ? ' search word' : ' search words') + (kn < 8 ? ': 8 to 12 works best' : kn > 12 ? ': 8 to 12 works best' : '') : 'None yet');
  add('search', 'h1', 'H1 heading', seo.h1 || (auto.h1 && auto.h1.own) ? 'ok' : 'warn',
    auto.h1 && auto.h1.own ? 'The site’s own main heading: “' + auto.h1.own.slice(0, 80) + '”' : seo.h1 ? 'Set' : 'None yet: the event’s name is used.');
  add('search', 'indexing', 'Indexing', auto.indexing && auto.indexing.on ? 'ok' : 'warn', auto.indexing ? auto.indexing.text : '');
  add('sharing', 'image', 'Share picture', head.ogImage ? 'ok' : 'warn', head.ogImage ? (seo.shareImageUrl ? 'Your own picture' : 'Made automatically') : 'None: a shared link shows the title and description only.');
  var dates = auto.dates || {};
  if (seo.basicSchema === false) add('schema', 'basic', 'Event schema', 'warn', 'Turned off: search engines are not told the event’s date and place.');
  else if (!dates.exact) add('schema', 'basic', 'Event schema', 'warn', 'Not given while the date is to be announced: set exact dates in Basics.');
  else add('schema', 'basic', 'Event schema', sd.event ? 'ok' : 'warn', sd.event ? 'Given: ' + (dates.label || 'the dates') : 'Not given yet');
  if (sd.event) {
    var mode = seoFields.attendanceOf(seo, x.event || {});
    if (mode !== 'online') {
      add('schema', 'venue', 'Venue', auto.venue ? 'ok' : 'warn', auto.venue ? auto.venue : 'No venue in Basics');
      add('schema', 'address', 'Street address and postcode', seo.streetAddress && seo.postalCode ? 'ok' : 'warn',
        seo.streetAddress && seo.postalCode ? seo.streetAddress + ', ' + seo.postalCode : 'Missing: ' + [seo.streetAddress ? '' : 'street address', seo.postalCode ? '' : 'postcode'].filter(Boolean).join(' and '));
      add('schema', 'place', 'City, state, country', auto.place ? 'ok' : 'warn', auto.place ? auto.place.label : (x.event && x.event.city ? '“' + x.event.city + '” is not in the place list: the city is given as typed' : 'No city in Basics'));
    }
    add('schema', 'organizer', 'Organiser', auto.organizer && auto.organizer.portal ? 'ok' : 'warn', auto.organizer ? auto.organizer.name + (auto.organizer.portal ? '' : ' (the event has no portal yet)') : '');
  }
  var rep = sd.report || {};
  if (seo.advancedSchema === false) add('rich', 'advanced', 'Rich results', 'warn', 'Turned off: no speakers, FAQs or reviews are given.');
  else {
    var sp = (x.speakers || []).filter(function (s) { return s.counts; });
    add('rich', 'speakers', 'Speakers', rep.performers ? 'ok' : 'warn', rep.performers ? rep.performers + ' shown on the site' + (rep.notShown && rep.notShown.speakers.length ? ', ' + rep.notShown.speakers.length + ' not on it' : '') : sp.length ? 'None of the ones picked is on the site yet' : 'None in Content › Speakers');
    var fq = (x.faqs || []).filter(function (f) { return f.counts; });
    add('rich', 'faqs', 'FAQs', rep.faqs ? 'ok' : 'warn', rep.faqs ? rep.faqs + ' shown on the site' + (rep.notShown && rep.notShown.faqs.length ? ', ' + rep.notShown.faqs.length + ' not on it' : '') : fq.length ? 'None of the ones picked is on the site yet' : 'None in Content › FAQ');
    var tm = (seo.testimonials || []).filter(function (t) { return !t.off; });
    add('rich', 'reviews', 'Testimonials', rep.reviews ? 'ok' : 'warn', rep.reviews ? rep.reviews + ' shown on the site' : tm.length ? 'Not shown on the site: add a testimonials section in the editor to show them' : 'None yet');
    add('rich', 'rating', 'Rating', rep.rating ? 'ok' : 'warn', rep.rating ? rep.rating + ' from ' + rep.ratings + (rep.ratings === 1 ? ' rating' : ' ratings') : 'None: it is worked out from the ratings of the testimonials the site shows');
  }
  add('rich', 'offers', 'Passes and prices', 'info', 'Not included: search engines need prices shown on the page, and this site shows no passes yet.');
  (sd.problems || []).forEach(function (p, n) { add('schema', 'problem-' + n, 'Structured data', 'warn', p); });
  return items;
}

/* the event's previous edition: the one picked in this section, else the one Create Event read (events/<id>/sources) */
function recordedPrevious(fb, eventId, data) {
  var seo = (data.settings && data.settings.seo) || {};
  if (isObj(seo.previous) && seo.previous.portal && seo.previous.id) return Promise.resolve(Object.assign({ from: 'seo' }, seo.previous));
  return H.eventDocRef(fb, eventId).collection('sources').where('type', '==', 'previousEdition').get().then(function (snap) {
    var hit = null;
    snap.docs.some(function (d) {
      var p = (d.data() || {}).previous;
      if (p && p.portal && /^[0-9]{1,12}$/.test(String(p.id || ''))) { hit = { from: 'create', portal: String(p.portal), id: String(p.id), name: str(p.name), link: str(p.url) }; return true; }
      return false;
    });
    return hit;
  }, function () { return null; });
}

/* ---------- GET /api/event/seo ---------- */
function handleSeoGet(req, res) {
  H.withAdmin(req, res, function (fb) {
    var eventId = H.eventIdOr400(res, H.queryOf(req).get('eventId'));
    if (!eventId) return;
    H.loadLiveEvent(fb, eventId).then(function (data) {
      var ref = H.eventDocRef(fb, eventId);
      var version = H.siteVersionOf(data);
      return Promise.all([
        version ? H.readObject(fb, H.sitePath(eventId, 'page.html')) : Promise.resolve(null),
        ref.collection('speakers').get(), ref.collection('faqs').get(),
        H.approvalsConfig(fb).then(null, function () { return { required: true }; }),
        data.approval && data.approval.id ? ref.collection('approvals').doc(data.approval.id).get().then(null, function () { return null; }) : Promise.resolve(null),
        recordedPrevious(fb, eventId, data)
      ]).then(function (r) {
        sendJson(res, 200, section(req, eventId, data, { page: r[0], speakers: rows(r[1]), faqs: rows(r[2]), cfg: r[3], pending: r[4], previous: r[5] }));
      });
    }).catch(function (err) { H.sendFailure(res, 'seo get', err, 'The search and sharing settings could not be loaded. Please try again.'); });
  });
}
function rows(snap) { return snap.docs.map(function (d) { return Object.assign({}, d.data(), { id: d.id }); }); }

function section(req, eventId, data, x) {
  var draft = (data.settings && data.settings.seo) || {};
  var picked = seoFields.pickRecords(draft, x.speakers, x.faqs);
  var simulated = Object.assign({}, data, { publishedSeo: seoFields.snapshot(draft, picked, '') });
  var base = H.publicBaseFor(req, '');
  var ownUrl = base + H.publicPathOf(eventId);
  var templateId = (data.site && data.site.templateId) || data.templateId;
  /* the page the next publish writes, never stored: its head, its h1, its structured data */
  var nextPage = null, head = readHead(''), ev = null, report = null;
  if (x.page) {
    try {
      var tr = {};
      nextPage = H.publishTransform(x.page, { eventId: eventId, event: simulated, mode: 'live', publicBase: base, templateId: templateId, report: tr });
      head = readHead(nextPage);
      ev = seoSchema.evidenceOf(nextPage, H.TOKEN_KIT);
    } catch (e) { console.error('api-seo: the next page of ' + eventId + ' could not be worked out — ' + (e && e.message)); }
  }
  var evLd = head.jsonLd.filter(function (j) { return j && j['@type'] === 'Event'; })[0] || null;
  var faqLd = head.jsonLd.filter(function (j) { return j && j['@type'] === 'FAQPage'; })[0] || null;
  /* what the page pass found: rebuilt here from the same values to have the report (what was left out and why) */
  var sd = seoSchema.structuredData({ event: data, seo: draft, records: picked, evidence: ev, url: head.canonical || ownUrl });
  report = sd.report;
  var problems = [];
  if (evLd) problems = problems.concat(siteSeo.checkJsonLd(evLd));
  if (faqLd) problems = problems.concat(siteSeo.checkJsonLd(faqLd).map(function (p) { return 'FAQs: ' + p; }));

  var portal = etFooter.isKnown && etFooter.isKnown(data.portal) ? etFooter.info(data.portal) : null;
  var why = siteChecks.noindexReason(Object.assign({ id: eventId }, simulated), nextPage, H.TOKEN_KIT);
  var indexing = { on: !why && data.published === true, reason: why || (data.published === true ? '' : 'not-live'),
    text: why === 'owner' ? 'Off: the team keeps this site out of search engines.' : why === 'test' ? 'Off: its name says it is a test, so search engines are asked not to list it.'
      : why === 'template' ? 'Off: the site still shows template text, so search engines are asked not to list it until it is filled in.'
      : data.published === true ? 'On: search engines may list it.' : 'On once the site is live (nothing is listed before).' };
  var luLogo = '';
  if (x.page) { var lm = /<img\b[^>]*class="[^"]*\brv-lu-img\b[^"]*"[^>]*>/i.exec(x.page); if (lm) luLogo = attr(lm[0], 'src'); }
  var place = seoFields.placeOf(data.city, data.portal);
  var auto = {
    url: ownUrl, canonical: head.canonical || str(draft.canonicalUrl) || ownUrl, indexing: indexing,
    place: place, attendance: seoFields.attendanceOf(draft, data), attendanceAuto: seoFields.attendanceOf({}, data),
    organizer: portal ? { name: portal.site, url: portal.home, portal: data.portal, logo: etNav.logoOf(data.portal, 'light').onLight } : { name: siteSeo.ET.name, url: siteSeo.ET.url, portal: '' },
    logo: luLogo ? { url: luLogo, from: 'logo unit' } : (data.logoUrl ? { url: data.logoUrl, from: 'event logo' } : null),
    dates: { exact: seoFields.datesExact(data), label: seoFields.datesExact(data) ? genDesign.dateLabel(data.start, data.end) : str(data.dateLabel), start: str(data.start), end: str(data.end), mode: str(data.dateMode) },
    venue: str(data.venue).trim(), city: str(data.city).trim(),
    h1: { own: head.h1 && !head.h1Hidden ? head.h1 : '', used: head.h1 || '' },
    title: str(data.name).trim()
  };
  var spOff = draft.speakersOff || [], fqOff = draft.faqsOff || [];
  var speakers = x.speakers.slice().sort(function (a, b) { return (+a.order || 0) - (+b.order || 0); }).map(function (s) {
    var confirmed = RR.isOnSite(s);
    return { id: s.id, name: str(s.name), role: str(s.desig), company: str(s.comp), photo: str(s.photoUrl), confirmed: confirmed,
      off: spOff.indexOf(s.id) !== -1, counts: confirmed && spOff.indexOf(s.id) === -1 && !!str(s.name).trim(), shown: seoSchema.showsSpeaker(ev, { id: s.id, name: s.name }) };
  });
  var faqs = x.faqs.slice().sort(function (a, b) { return (+a.order || 0) - (+b.order || 0); }).map(function (f) {
    return { id: f.id, question: str(f.question), answer: str(f.answer), off: fqOff.indexOf(f.id) !== -1,
      counts: fqOff.indexOf(f.id) === -1 && !!str(f.question).trim() && !!str(f.answer).trim(), shown: seoSchema.showsFaq(ev, { id: f.id, question: f.question }) };
  });
  var testimonials = {};
  (draft.testimonials || []).forEach(function (t) { testimonials[t.id] = { shown: seoSchema.showsTestimonial(ev, t) }; });

  var liveFields = seoFields.seoFor(data, 'live');
  var changes = seoFields.changes(draft, liveFields).concat(seoFields.recordChanges(picked, seoFields.recordsFor(data)));
  var pending = null;
  if (x.pending && x.pending.exists) {
    var pr = x.pending.data() || {};
    if (pr.status === 'pending') pending = { id: x.pending.id, requestedAt: pr.requestedAt || null, requestedBy: pr.requestedBy || '', seoOnly: pr.seoOnly === true,
      seoSame: isObj(pr.seo) ? JSON.stringify(seoFields.changes(draft, pr.seo)) === '[]' : false, reviewPath: '/review.html?event=' + encodeURIComponent(eventId) + '&request=' + encodeURIComponent(x.pending.id) };
  }
  var out = {
    eventId: eventId, seo: draft, aiWritten: Array.isArray(draft.aiWritten) ? draft.aiWritten : [],
    live: { published: data.published === true, publishedAt: data.publishedAt || null, fields: liveFields,
      at: isObj(data.publishedSeo) ? data.publishedSeo.at || null : null, by: isObj(data.publishedSeo) ? data.publishedSeo.by || '' : '', legacy: !isObj(data.publishedSeo) },
    changes: changes, pending: pending, approvalRequired: x.cfg ? x.cfg.required !== false : true,
    page: { saved: !!x.page, version: H.siteVersionOf(data) },
    auto: auto, head: { title: head.title, description: head.description, keywords: head.keywords, canonical: head.canonical, ogTitle: head.ogTitle,
      ogDescription: head.ogDescription, ogImage: head.ogImage, robots: head.robots, h1: head.h1, h1Hidden: head.h1Hidden },
    speakers: speakers, faqs: faqs, testimonials: testimonials,
    schema: { event: evLd, faq: faqLd, report: report, problems: problems },
    previous: x.previous || null
  };
  out.ready = readiness({ seo: draft, head: head, auto: auto, schema: { event: evLd, faq: faqLd, report: report, problems: problems }, speakers: speakers, faqs: faqs, event: data });
  return out;
}

/* ---------- POST /api/event/seo/write — ETB2B AI ---------- */
function readPrev(pick) {
  if (!pick) return Promise.resolve(null);
  var late = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 15000); });
  return Promise.race([seoPrevious.readPreviousSeo(pick, { fetchJson: H.etJson }), late]).then(null, function () { return null; });
}
function handleSeoWrite(req, res) {
  H.withAdminBody(req, res, H.BODY_LIMITS.small, function (fb, decoded, body) {
    var eventId = H.eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var faqMode = body.faqs === true;
    var fields = faqMode ? [] : (Array.isArray(body.fields) && body.fields.length ? body.fields : seoAi.FIELDS);
    var bad = fields.filter(function (f) { return seoAi.FIELDS.indexOf(f) === -1; })[0];
    if (bad) return sendJson(res, 400, { error: '"' + String(bad).slice(0, 40) + '" is not a field ETB2B AI writes. It writes: ' + seoAi.FIELDS.join(', ') + '.', code: 'bad-field' });
    if (!rateLimit('seo-write|' + activity.actorOf(decoded), AI_LIMIT.max, AI_LIMIT.ms)) return sendJson(res, 429, { error: 'ETB2B AI has written a lot for you in the last few minutes. Please wait a little and try again.', code: 'rate-limited' });
    var started = Date.now();
    H.loadLiveEvent(fb, eventId).then(function (data) {
      var ref = H.eventDocRef(fb, eventId);
      var version = H.siteVersionOf(data);
      return Promise.all([
        version ? H.readObject(fb, H.sitePath(eventId, 'page.html')).then(null, function () { return null; }) : Promise.resolve(null),
        recordedPrevious(fb, eventId, data).then(readPrev),
        faqMode ? ref.collection('faqs').get().then(rows, function () { return []; }) : Promise.resolve([])
      ]).then(function (r) {
        var site = seoAi.siteWords(r[0], H.TOKEN_KIT);
        var facts = seoAi.buildFacts({ event: data, portalName: H.portalNameOf(data.portal), site: site });
        var prompt = seoAi.buildPrompt({ facts: facts, fields: fields, previous: r[1], faqs: faqMode, existingFaqs: r[2].map(function (f) { return str(f.question); }).filter(Boolean) });
        return llm.callJson(prompt, faqMode ? seoAi.FAQ_SCHEMA : seoAi.schemaFor(fields), {
          route: 'seo-write', eventId: eventId, user: activity.actorOf(decoded), deadlineAt: started + 100000,
          onUsage: H.aiUsageRecorder(fb, eventId, 'seo-write')
        }).then(function (ai) {
          if (ai.error) return H.sendAiFailure(res, ai);
          if (faqMode) {
            var got = seoAi.applyFaqs(ai.parsed, facts);
            activity.logActivity(fb, eventId, decoded, 'seo-written', 'ETB2B AI drafted ' + got.faqs.length + (got.faqs.length === 1 ? ' FAQ' : ' FAQs') + ' for Content › FAQ', { area: 'content' });
            return sendJson(res, 200, { faqs: got.faqs, dropped: got.dropped, provider: ai.provider || '' });
          }
          var got2 = seoAi.apply(ai.parsed, fields, facts);
          return saveWritten(fb, decoded, eventId, got2.values).then(function (saved) {
            var names = Object.keys(got2.values).map(function (f) { return seoFields.LABELS[f] || f; });
            if (names.length) {
              activity.logActivity(fb, eventId, decoded, 'seo-written', 'ETB2B AI wrote ' + names.join(', ') + (r[1] ? ' (the previous edition as a reference)' : ''), {
                area: 'settings', fields: saved.changes.map(function (c) { return { field: 'SEO › ' + c.label, before: c.before, after: c.after }; })
              });
            }
            sendJson(res, 200, { values: got2.values, before: saved.before, aiWritten: saved.aiWritten, aiWrittenBefore: saved.aiWrittenBefore, dropped: got2.dropped,
              updatedAt: saved.updatedAt, provider: ai.provider || '', previous: r[1] ? { name: r[1].name, link: r[1].link } : null });
          });
        });
      });
    }).catch(function (err) { H.sendFailure(res, 'seo write', err, 'ETB2B AI could not write these just now. Nothing was changed. Please try again.'); });
  });
}
/* The fields written, saved over the draft in one transaction (another person's change made meanwhile is kept), each
   marked as ETB2B AI's until somebody edits it. -> { before, aiWritten, aiWrittenBefore, changes, updatedAt } */
function saveWritten(fb, decoded, eventId, values) {
  var ref = H.eventDocRef(fb, eventId), now = new Date().toISOString(), out = { before: {}, aiWritten: [], aiWrittenBefore: [], changes: [], updatedAt: now };
  var keys = Object.keys(values);
  if (!keys.length) return Promise.resolve(out);
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var stored = snap.data() || {};
      if (!snap.exists || stored.deletedAt || !stored.createdAt) throw H.httpError(404, 'This event no longer exists.', { code: 'event-not-found' });
      var settings = isObj(stored.settings) ? stored.settings : {}, seo = Object.assign({}, isObj(settings.seo) ? settings.seo : {});
      out.before = {}; out.aiWrittenBefore = Array.isArray(seo.aiWritten) ? seo.aiWritten.slice() : [];
      var was = Object.assign({}, seo);
      keys.forEach(function (f) { out.before[f] = seo[f] === undefined ? (f === 'keywords' ? [] : '') : seo[f]; seo[f] = values[f]; });
      seo.aiWritten = out.aiWrittenBefore.concat(keys).filter(function (f, i, a) { return a.indexOf(f) === i; });
      var clean = seoFields.cleanSeo(seo);
      if (clean.error) throw H.httpError(500, 'ETB2B AI wrote something that could not be saved. Nothing was changed.', { code: 'ai-unusable' });
      out.aiWritten = clean.value.aiWritten;
      out.changes = seoFields.changes(clean.value, was);
      tx.update(ref, { settings: Object.assign({}, settings, { seo: clean.value }), updatedAt: now, detailsUpdatedAt: now, updatedBy: activity.actorOf(decoded) });
    });
  }).then(function () { return out; });
}

/* ---------- GET /api/event/seo/previous ---------- */
function handleSeoPrevious(req, res) {
  H.withAdmin(req, res, function (fb) {
    var qs = H.queryOf(req), eventId = H.eventIdOr400(res, qs.get('eventId'));
    if (!eventId) return;
    var portal = String(qs.get('portal') || '').trim(), id = String(qs.get('id') || '').trim();
    if ((portal || id) && (!etEvents.isPortal(portal) || !/^[0-9]{1,12}$/.test(id))) return sendJson(res, 400, { error: 'Name the previous edition by its portal and its ETB2B event id.', code: 'bad-pick' });
    H.loadLiveEvent(fb, eventId).then(function (data) {
      var named = portal ? Promise.resolve(null).then(function () {
        /* owner rule: a previous edition comes from the event's own portal, and is one of that portal's ET events */
        if (!etEvents.isPortal(data.portal) || portal !== data.portal) throw H.httpError(400, 'Pick a previous edition from ' + (H.portalNameOf(data.portal) || 'this event’s portal') + '’s own events.', { code: 'other-portal' });
        var award = String(data.category || '') === 'awards';
        return (award ? etEvents.listAwards : etEvents.listIpEvents)(portal, H.etJson).then(function (list) {
          var ev = list.filter(function (e) { return String(e.id) === id; })[0];
          if (!ev) throw H.httpError(400, 'That is not one of ' + H.portalNameOf(portal) + '’s ' + (award ? 'awards' : 'events') + ' on ETB2B.', { code: 'not-on-portal' });
          return { from: 'picked', portal: portal, id: id, name: ev.title || '', link: ev.link || '' };
        }, function () { throw H.httpError(502, 'ETB2B’s event list could not be read right now. Please try again in a few minutes.', { code: 'et-down' }); });
      }) : recordedPrevious(fb, eventId, data);
      return named.then(function (pick) {
        if (!pick) return sendJson(res, 200, { previous: null, why: 'none-recorded' });
        return readPrev(pick).then(function (prev) {
          if (!prev) return sendJson(res, 200, { previous: null, pick: pick, why: 'et-down' });
          prev.from = pick.from; if (!prev.link) prev.link = pick.link; if (!prev.name) prev.name = pick.name;
          var venueThen = prev.venue || (prev.seo && prev.seo.venue) || '';
          sendJson(res, 200, { previous: prev, sameVenue: seoPrevious.sameVenue(venueThen, data.venue), venueNow: str(data.venue), venueThen: venueThen });
        });
      });
    }).catch(function (err) { H.sendFailure(res, 'seo previous', err, 'The previous edition could not be read just now. Please try again.'); });
  });
}

module.exports = { wire: wire, handleSeoGet: handleSeoGet, handleSeoWrite: handleSeoWrite, handleSeoPrevious: handleSeoPrevious,
  readHead: readHead, readiness: readiness, section: section, saveWritten: saveWritten };
