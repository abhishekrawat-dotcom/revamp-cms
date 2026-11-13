/* The event's search and sharing settings (events/<id>.settings.seo): every SEO field ET's own event platform keeps for
   an event, in one place (the console's Settings › URL & SEO), and the copy of them that is live.

   The owner (6 Nov 2026): every SEO field ET's API has for its events must exist for EventSphere events too, written
   by ETB2B AI wherever it can be, "and keep everything in one section under settings -> seo" — search and sharing
   only, never the site's own words.

   WHAT IS STORED (settings.seo, validated by cleanSeo; anything else is refused by name):
     search listing   title (<= 70), description (<= 320), keywords [<= 15 x <= 60], h1 (<= 120),
                      canonicalUrl (an http(s) address, '' = the site's own), noindex (true keeps it out of search)
     sharing          shareImageUrl (the team's own picture; '' = automatic)
     event schema     basicSchema (false turns the schema.org Event off; on by default), schemaTitle (<= 120),
                      schemaDescription (<= 500), attendanceMode ('' = automatic | 'offline' | 'online' | 'mixed'),
                      streetAddress (<= 200), postalCode (6 digits in India, else <= 12), latitude (-90..90) and
                      longitude (-180..180) or null
     rich results     advancedSchema (false turns speakers, FAQs and reviews off; on by default), speakersOff and
                      faqsOff (the ids the team took out; everyone else counts, so a speaker added later counts),
                      testimonials [<= 30: { id, name, role, company, title, text (<= 1500), rating 1-5 | null,
                      photoUrl, from: 'team' | 'previous', prevId, off }]
     bookkeeping      aiWritten [the fields ETB2B AI wrote that nobody has edited since], previous (the previous
                      edition picked here: { portal, id, name, link })
   A testimonial is never written by AI: there is no AI route that writes one, and the field list ETB2B AI may
   write (AI_FIELDS) does not include it.

   WHAT IS LIVE. A live page shows the SEO values as they were PUBLISHED, never the draft above (owner rule: nothing
   in the console changes a live site without a publish or an approval). Each publish and each approval writes
   events/<id>.publishedSeo = { fields: <settings.seo as it went live>, records: { speakers, faqs }, at, by }
   (lib/api.js withPublishedSeo, snapshot below), and the live page's head, its hidden h1, its structured data, its
   robots line and the sitemap read that copy (seoFor(event, 'live')). A site published before the copy existed
   reads the four settings it had then (canonicalUrl, description, shareImageUrl, noindex) from settings.seo, as it
   always did, and none of the new ones until it is next published.

     AI_FIELDS                       the fields ETB2B AI may write
     LABELS                          field -> the name the console and the approver see
     cleanSeo(s)                     -> { value } | { error, field }   (cleanSettings' settings.seo)
     checkWithEvent(seo, event)      -> '' | the sentence: rules that need the event (an Indian postcode has 6 digits)
     seoFor(event, mode)             -> the fields a page in that mode reads: 'live' the published copy, else the draft
     recordsFor(event)               -> { speakers, faqs } of the published copy (empty lists before the first)
     changes(draft, live)            -> [{ field, label, before, after }] what the next publish changes
     recordChanges(now, live)        -> [{ field, label, before, after }] the speakers and FAQs that count, by name
     snapshot(fields, records, by)   -> the publishedSeo object (copied, trimmed)
     pickRecords(seo, speakers, faqs)-> { speakers, faqs } the records that count: shown on the site (confirmed),
                                        not taken out by the team, in the site's order
     placeOf(city, portal)           -> { city, state, country, countryCode, label } | null   (places.js, GeoNames)
     attendanceOf(seo, event)        -> 'offline' | 'online' | 'mixed' | ''   the mode the Event says
     datesExact(event)               -> true when the event has an exact start date (the Event schema needs one)
   No network, no Firebase: see seo-fields.test.js. */
'use strict';

var places = require('./places');
/* which speakers are on the site: the site's own rule (Confirmed, or no status) */
var RR = require('../../templates/_shared/rv-records.js');

var AI_FIELDS = ['title', 'description', 'keywords', 'h1', 'schemaTitle', 'schemaDescription'];
var LEGACY = ['canonicalUrl', 'description', 'shareImageUrl', 'noindex'];
var KEYS = ['title', 'description', 'keywords', 'h1', 'canonicalUrl', 'noindex', 'shareImageUrl', 'basicSchema', 'schemaTitle',
  'schemaDescription', 'attendanceMode', 'streetAddress', 'postalCode', 'latitude', 'longitude', 'advancedSchema', 'speakersOff',
  'faqsOff', 'testimonials', 'aiWritten', 'previous'];
var LABELS = {
  title: 'SEO title', description: 'Meta description', keywords: 'Keywords', h1: 'H1 heading', canonicalUrl: 'Canonical address',
  noindex: 'Indexing', shareImageUrl: 'Share picture', basicSchema: 'Basic schema', schemaTitle: 'Schema title',
  schemaDescription: 'Schema description', attendanceMode: 'Attendance mode', streetAddress: 'Street address', postalCode: 'Postcode',
  latitude: 'Latitude', longitude: 'Longitude', advancedSchema: 'Advanced schema', speakersOff: 'Speakers taken out',
  faqsOff: 'FAQs taken out', testimonials: 'Testimonials', speakers: 'Speakers in search results', faqs: 'FAQs in search results'
};
var LIMITS = { title: 70, description: 320, keyword: 60, keywords: 15, h1: 120, schemaTitle: 120, schemaDescription: 500,
  streetAddress: 200, testimonials: 30, testimonialText: 1500, ids: 300 };
var MODES = ['offline', 'online', 'mixed'];

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function str(v) { return typeof v === 'string' ? v : ''; }
/* one line of text: what a search result or a schema field holds has no line breaks */
function line(v) { return str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function textError(label, v, max) {
  if (v == null) return '';
  if (typeof v !== 'string') return label + ' must be text.';
  if (v.length > max) return label + ' is too long (the limit is ' + max + ' characters).';
  return '';
}
/* a picture the team uploaded (an address on this site or a web address), never one pasted in as data */
function pictureError(label, v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || v.length > 1000 || /\s/.test(v.trim()) || !/^(https:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/i.test(v.trim())) {
    return label + ' must be the address of an uploaded picture (https).';
  }
  return '';
}
function httpError(label, v, max) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || v.length > max || !/^https?:\/\/[^\s"'<>]+$/i.test(v.trim())) return label + ' must be a web address starting with https://.';
  return '';
}
function idList(label, v) {
  if (v == null) return '';
  if (!Array.isArray(v) || v.length > LIMITS.ids || !v.every(function (x) { return typeof x === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(x); })) return label + ' must be a list of record ids.';
  return '';
}
function number(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi; }

/* The keywords as the team typed them: one each, trimmed, the same one once (case aside), none empty. */
function cleanKeywords(list) {
  var seen = {}, out = [];
  list.forEach(function (k) {
    var t = line(k);
    var key = t.toLowerCase();
    if (t && !seen[key]) { seen[key] = 1; out.push(t); }
  });
  return out;
}

/* A postcode: 6 digits in India; elsewhere letters, digits, spaces and hyphens, up to 12 (checkWithEvent decides
   which, from the event's city). */
function postcodeError(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(v.trim())) return 'The postcode can have letters, digits, spaces and hyphens, up to 12.';
  return '';
}

function cleanTestimonial(t, n) {
  var where = 'Testimonial ' + (n + 1);
  if (!isObj(t)) return { error: where + ' must be an object.' };
  var allowed = ['id', 'name', 'role', 'company', 'title', 'text', 'rating', 'photoUrl', 'from', 'prevId', 'off'];
  var bad = Object.keys(t).filter(function (k) { return allowed.indexOf(k) === -1; })[0];
  if (bad) return { error: '"settings.seo.testimonials.' + n + '.' + bad + '" is not a testimonial field.' };
  if (typeof t.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(t.id)) return { error: where + ' needs an id.' };
  var e = textError(where + ': the name', t.name, 120) || textError(where + ': the role', t.role, 120) || textError(where + ': the company', t.company, 120) ||
    textError(where + ': the title', t.title, 200) || textError(where + ': the text', t.text, LIMITS.testimonialText) || pictureError(where + ': the photo', t.photoUrl);
  if (e) return { error: e };
  if (!line(t.name)) return { error: where + ' needs the person\'s name.' };
  if (!line(t.text)) return { error: where + ' needs what they said.' };
  if (t.rating != null && !(typeof t.rating === 'number' && Math.floor(t.rating) === t.rating && t.rating >= 1 && t.rating <= 5)) return { error: where + ': the rating is 1 to 5 stars, or none.' };
  if (t.from != null && t.from !== 'team' && t.from !== 'previous') return { error: where + ': "from" is team or previous.' };
  if (t.prevId != null && !(typeof t.prevId === 'string' && /^[0-9]{1,12}$/.test(t.prevId))) return { error: where + ': the previous edition\'s id is not valid.' };
  if (t.off != null && typeof t.off !== 'boolean') return { error: where + ': "off" must be true or false.' };
  var out = { id: t.id, name: line(t.name), role: line(t.role), company: line(t.company), title: line(t.title),
    text: str(t.text).replace(/\r\n?/g, '\n').trim(), rating: t.rating == null ? null : t.rating, photoUrl: str(t.photoUrl).trim(), from: t.from === 'previous' ? 'previous' : 'team' };
  if (out.from === 'previous' && t.prevId) out.prevId = t.prevId;
  if (t.off === true) out.off = true;
  return { value: out };
}

function cleanSeo(s) {
  if (!isObj(s)) return { error: '"settings.seo" must be an object.' };
  var bad = Object.keys(s).filter(function (k) { return KEYS.indexOf(k) === -1; })[0];
  if (bad) return { error: '"settings.seo.' + bad + '" is not a setting.' };
  var out = {}, e;
  function fail(msg, field) { return { error: msg, field: 'settings.seo.' + field }; }

  /* the four the console had before (their sentences unchanged) */
  if (has(s, 'noindex')) { if (typeof s.noindex !== 'boolean') return fail('"settings.seo.noindex" must be true or false.', 'noindex'); out.noindex = s.noindex; }
  if (has(s, 'canonicalUrl')) { if ((e = httpError('The canonical address', s.canonicalUrl, 500))) return fail(e, 'canonicalUrl'); out.canonicalUrl = str(s.canonicalUrl).trim(); }
  if (has(s, 'description')) {
    if ((e = textError('The search description', s.description, LIMITS.description))) return fail(e, 'description');
    out.description = line(s.description);
  }
  if (has(s, 'shareImageUrl')) {
    if (s.shareImageUrl != null && s.shareImageUrl !== '' && (typeof s.shareImageUrl !== 'string' || !/^(https?:\/\/|\/(?!\/))/i.test(s.shareImageUrl.trim()) || /\s/.test(s.shareImageUrl.trim()) || s.shareImageUrl.length > 1000)) {
      return fail('The share image must be the address of an uploaded image.', 'shareImageUrl');
    }
    out.shareImageUrl = str(s.shareImageUrl).trim();
  }

  /* search listing */
  if (has(s, 'title')) { if ((e = textError('The SEO title', s.title, LIMITS.title))) return fail(e, 'title'); out.title = line(s.title); }
  if (has(s, 'h1')) { if ((e = textError('The H1 heading', s.h1, LIMITS.h1))) return fail(e, 'h1'); out.h1 = line(s.h1); }
  if (has(s, 'keywords')) {
    if (s.keywords != null && !Array.isArray(s.keywords)) return fail('The keywords must be a list.', 'keywords');
    var kw = Array.isArray(s.keywords) ? s.keywords : [];
    if (kw.length > LIMITS.keywords) return fail('Up to ' + LIMITS.keywords + ' keywords (8 to 12 works best).', 'keywords');
    for (var k = 0; k < kw.length; k++) {
      if (typeof kw[k] !== 'string') return fail('Each keyword must be text.', 'keywords');
      if (kw[k].length > LIMITS.keyword) return fail('A keyword is too long (the limit is ' + LIMITS.keyword + ' characters): “' + kw[k].slice(0, 40) + '…”.', 'keywords');
    }
    out.keywords = cleanKeywords(kw);
  }

  /* event schema */
  ['basicSchema', 'advancedSchema'].forEach(function (k) {
    if (e || !has(s, k)) return;
    if (typeof s[k] !== 'boolean') { e = fail('"settings.seo.' + k + '" must be true or false.', k); return; }
    out[k] = s[k];
  });
  if (e) return e;
  if (has(s, 'schemaTitle')) { if ((e = textError('The schema title', s.schemaTitle, LIMITS.schemaTitle))) return fail(e, 'schemaTitle'); out.schemaTitle = line(s.schemaTitle); }
  if (has(s, 'schemaDescription')) { if ((e = textError('The schema description', s.schemaDescription, LIMITS.schemaDescription))) return fail(e, 'schemaDescription'); out.schemaDescription = line(s.schemaDescription); }
  if (has(s, 'attendanceMode')) {
    if (s.attendanceMode != null && s.attendanceMode !== '' && MODES.indexOf(s.attendanceMode) === -1) return fail('The attendance mode is in person, online or both.', 'attendanceMode');
    out.attendanceMode = s.attendanceMode || '';
  }
  if (has(s, 'streetAddress')) { if ((e = textError('The street address', s.streetAddress, LIMITS.streetAddress))) return fail(e, 'streetAddress'); out.streetAddress = line(s.streetAddress); }
  if (has(s, 'postalCode')) { if ((e = postcodeError(s.postalCode))) return fail(e, 'postalCode'); out.postalCode = str(s.postalCode).trim().replace(/\s+/g, ' ').toUpperCase(); }
  if (has(s, 'latitude')) { if (s.latitude != null && !number(s.latitude, -90, 90)) return fail('The latitude is a number from -90 to 90.', 'latitude'); out.latitude = s.latitude == null ? null : s.latitude; }
  if (has(s, 'longitude')) { if (s.longitude != null && !number(s.longitude, -180, 180)) return fail('The longitude is a number from -180 to 180.', 'longitude'); out.longitude = s.longitude == null ? null : s.longitude; }

  /* rich results */
  if (has(s, 'speakersOff')) { if ((e = idList('The speakers taken out', s.speakersOff))) return fail(e, 'speakersOff'); out.speakersOff = (s.speakersOff || []).slice(); }
  if (has(s, 'faqsOff')) { if ((e = idList('The FAQs taken out', s.faqsOff))) return fail(e, 'faqsOff'); out.faqsOff = (s.faqsOff || []).slice(); }
  if (has(s, 'testimonials')) {
    if (s.testimonials != null && !Array.isArray(s.testimonials)) return fail('The testimonials must be a list.', 'testimonials');
    var list = s.testimonials || [];
    if (list.length > LIMITS.testimonials) return fail('Up to ' + LIMITS.testimonials + ' testimonials.', 'testimonials');
    var tl = [], ids = {};
    for (var n = 0; n < list.length; n++) {
      var t = cleanTestimonial(list[n], n);
      if (t.error) return fail(t.error, 'testimonials');
      if (ids[t.value.id]) return fail('Two testimonials have the same id.', 'testimonials');
      ids[t.value.id] = 1;
      tl.push(t.value);
    }
    out.testimonials = tl;
  }

  /* bookkeeping */
  if (has(s, 'aiWritten')) {
    if (!Array.isArray(s.aiWritten) || !s.aiWritten.every(function (f) { return AI_FIELDS.indexOf(f) !== -1; })) return fail('"settings.seo.aiWritten" lists the fields ETB2B AI wrote: ' + AI_FIELDS.join(', ') + '.', 'aiWritten');
    out.aiWritten = s.aiWritten.filter(function (f, i, a) { return a.indexOf(f) === i; });
  }
  if (has(s, 'previous')) {
    var p = s.previous;
    if (p != null) {
      if (!isObj(p) || typeof p.portal !== 'string' || !/^[a-z0-9-]{1,40}$/.test(p.portal) || typeof p.id !== 'string' || !/^[0-9]{1,12}$/.test(p.id)) return fail('The previous edition is a portal and an ETB2B event id.', 'previous');
      if ((e = textError('The previous edition\'s name', p.name, 300) || httpError('The previous edition\'s address', p.link, 500))) return fail(e, 'previous');
      out.previous = { portal: p.portal, id: p.id, name: line(p.name), link: str(p.link).trim() };
    } else out.previous = null;
  }
  return { value: out };
}

/* The rules that need the event: an Indian event's postcode has 6 digits (its city is in India by the place list, or
   it has no city we can place: ET's events are Indian unless they say otherwise). -> '' | the sentence */
function checkWithEvent(seo, event) {
  var pc = seo && str(seo.postalCode);
  if (!pc) return '';
  var place = placeOf(event && event.city, event && event.portal);
  var indian = !place || place.countryCode === 'IN';
  if (indian && !/^[1-9][0-9]{5}$/.test(pc)) return 'An Indian postcode has 6 digits (for example 122010).';
  return '';
}

/* The fields a page in this mode reads. 'live': the published copy; before the first publish with it, the four
   settings a live page read before (from settings.seo, as it always did). Anything else: the draft. */
function seoFor(event, mode) {
  var draft = event && isObj(event.settings) && isObj(event.settings.seo) ? event.settings.seo : {};
  if (mode !== 'live') return draft;
  var pub = event && isObj(event.publishedSeo) && isObj(event.publishedSeo.fields) ? event.publishedSeo.fields : null;
  if (pub) return pub;
  var out = {};
  LEGACY.forEach(function (k) { if (has(draft, k)) out[k] = draft[k]; });
  return out;
}
function recordsFor(event) {
  var r = event && isObj(event.publishedSeo) && isObj(event.publishedSeo.records) ? event.publishedSeo.records : {};
  return { speakers: Array.isArray(r.speakers) ? r.speakers : [], faqs: Array.isArray(r.faqs) ? r.faqs : [] };
}

/* what each field reads as, for "what changed since the live version" and the approver's list */
function shown(field, v) {
  if (v == null || v === '') return '';
  if (field === 'keywords') return Array.isArray(v) ? v.join(', ') : '';
  if (field === 'testimonials') return Array.isArray(v) ? v.filter(function (t) { return !t.off; }).map(function (t) { return t.name + (t.rating ? ' (' + t.rating + '★)' : ''); }).join(', ') : '';
  if (field === 'noindex') return v === true ? 'Kept out of search engines' : 'Search engines may list it';
  if (field === 'basicSchema' || field === 'advancedSchema') return v === false ? 'Off' : 'On';
  if (field === 'attendanceMode') return { offline: 'In person', online: 'Online', mixed: 'In person and online' }[v] || 'Automatic';
  if (field === 'speakersOff' || field === 'faqsOff') return Array.isArray(v) && v.length ? v.length + ' taken out' : '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
/* defaults count as the value they stand for: no basicSchema is "on", no noindex is "may list it" */
function norm(field, v) {
  if (field === 'basicSchema' || field === 'advancedSchema') return v === false ? false : true;
  if (field === 'noindex') return v === true;
  if (field === 'keywords' || field === 'speakersOff' || field === 'faqsOff') return Array.isArray(v) ? v.slice().sort() : [];
  if (field === 'testimonials') return Array.isArray(v) ? v : [];
  if (field === 'latitude' || field === 'longitude') return typeof v === 'number' ? v : null;
  return v == null ? '' : v;
}
var COMPARED = KEYS.filter(function (k) { return k !== 'aiWritten' && k !== 'previous'; });
function changes(draft, live) {
  draft = isObj(draft) ? draft : {}; live = isObj(live) ? live : {};
  var out = [];
  COMPARED.forEach(function (f) {
    var a = norm(f, live[f]), b = norm(f, draft[f]);
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    out.push({ field: f, label: LABELS[f] || f, before: shown(f, live[f]).slice(0, 400), after: shown(f, draft[f]).slice(0, 400) });
  });
  return out;
}
function recordChanges(now, live) {
  var out = [];
  [['speakers', function (r) { return r.name; }], ['faqs', function (r) { return r.question; }]].forEach(function (k) {
    var a = (live && live[k[0]]) || [], b = (now && now[k[0]]) || [];
    var before = a.map(function (r) { return JSON.stringify(r); }).join('\n'), after = b.map(function (r) { return JSON.stringify(r); }).join('\n');
    if (before === after) return;
    out.push({ field: k[0], label: LABELS[k[0]], before: a.map(k[1]).join(', ').slice(0, 400), after: b.map(k[1]).join(', ').slice(0, 400) });
  });
  return out;
}

/* The records that count for search: a speaker the site shows (a confirmed one, as Content › Speakers has it), a
   FAQ with an answer — less the ones the team took out — in the site's own order, each with only what the
   structured data uses. */
function byOrder(a, b) { return (+a.order || 0) - (+b.order || 0); }
function pickRecords(seo, speakers, faqs) {
  seo = seo || {};
  var spOff = Array.isArray(seo.speakersOff) ? seo.speakersOff : [], fqOff = Array.isArray(seo.faqsOff) ? seo.faqsOff : [];
  var sp = (speakers || []).filter(function (s) { return s && s.id && line(s.name) && RR.isOnSite(s) && spOff.indexOf(s.id) === -1; })
    .slice().sort(byOrder).slice(0, 60).map(function (s) {
      var o = { id: s.id, name: line(s.name).slice(0, 120) };
      if (line(s.desig)) o.role = line(s.desig).slice(0, 120);
      if (line(s.comp)) o.company = line(s.comp).slice(0, 120);
      if (/^https:\/\/[^\s"'<>]+$/i.test(str(s.photoUrl))) o.photo = s.photoUrl;
      return o;
    });
  var fq = (faqs || []).filter(function (f) { return f && f.id && line(f.question) && line(f.answer) && fqOff.indexOf(f.id) === -1; })
    .slice().sort(byOrder).slice(0, 30).map(function (f) { return { id: f.id, question: line(f.question).slice(0, 300), answer: str(f.answer).replace(/\s+/g, ' ').trim().slice(0, 1500) }; });
  return { speakers: sp, faqs: fq };
}

function snapshot(fields, records, by) {
  var f = JSON.parse(JSON.stringify(isObj(fields) ? fields : {}));
  delete f.aiWritten;
  return { fields: f, records: { speakers: (records && records.speakers) || [], faqs: (records && records.faqs) || [] }, at: new Date().toISOString(), by: str(by) };
}

/* The place of a city, from the place list (GeoNames): "Gurugram" (or "Gurgaon") -> Gurugram, Haryana, India.
   "City, State, Country" typed in full is taken as it is; otherwise the name must be a city's own name or a name it
   is also known by, typed in full (places.js cityOf). ET's events are held in India, so a place in India comes
   first, and one abroad is taken only when it is a city of a million people or more (Dubai, Singapore, London):
   the largest town of a name abroad is not a guess worth making ("Goa" is a Philippine town in the list, and
   India's Goa a state; "Dubai" is also a village in Uttar Pradesh). An event on one of ET's portals abroad (…sea,
   …me, …mea) is placed abroad as readily as at home. -> parts | null */
var ABROAD = /(?:sea|me|mea)$/;
var ABROAD_MIN = 1000000;
function placeOf(city, portal) {
  var name = line(city);
  if (!name) return null;
  var full = places.lookup(name);
  if (full) return full;
  var abroad = ABROAD.test(str(portal));
  return places.cityOf(name.replace(/,.*$/, ''), abroad ? {} : { country: 'IN', abroadMin: ABROAD_MIN });
}

/* the mode the Event says: the team's choice, else in person when the event has a place, else none said */
function attendanceOf(seo, event) {
  var m = seo && str(seo.attendanceMode);
  if (MODES.indexOf(m) !== -1) return m;
  return event && (line(event.venue) || line(event.city) || line(event.location)) ? 'offline' : '';
}
function datesExact(event) {
  var mode = event && str(event.dateMode);
  if (mode && mode !== 'exact') return false;
  return /^\d{4}-\d{2}-\d{2}/.test(str(event && event.start));
}

module.exports = { AI_FIELDS: AI_FIELDS, LEGACY: LEGACY, KEYS: KEYS, LABELS: LABELS, LIMITS: LIMITS, MODES: MODES,
  cleanSeo: cleanSeo, checkWithEvent: checkWithEvent, seoFor: seoFor, recordsFor: recordsFor, changes: changes, recordChanges: recordChanges,
  snapshot: snapshot, pickRecords: pickRecords, placeOf: placeOf, attendanceOf: attendanceOf, datesExact: datesExact, line: line };
