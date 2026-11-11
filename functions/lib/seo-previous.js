/* A previous edition's search settings, FAQs and testimonials, read from ET's own event platform — what the console's
   Settings › URL & SEO offers to "Bring in from the previous edition".

   ET's public event API, asked with the edition's portal as a header (the same host et-previous.js reads an edition's
   speakers and agenda from):
     /v1/microsite/details?digital_month_id=<id>    data.seo { title, description, keywords (a JSON list as text),
                                                    h1_tag, schema_title, schema_description, venue, address, city,
                                                    state, country, zip, latitude, longitude, attendance_mode, … },
                                                    data.faq [{ question, answer, status }], data.page_title / page_description
                                                    / page_keywords ("a$#$b") for an edition with no seo record
     /v1/activity/testimonial/list?entity_id=<id>&activity=microsite&page=1&per_page=50
                                                    data.items [{ id, title, description, user_name ("Atma Godara, VP"),
                                                    company, img, rating, status }]
   An AWARD's microsite id is its event_id (et-events.js compactAward), which is the id asked for here too.

   What is used, and how (owner rules, 6 Nov 2026):
     - keywords, title, description: a REFERENCE for ETB2B AI, never copied (the year is this edition's);
     - the street address and postcode: offered only when the previous edition was at the same venue;
     - testimonials: ET's real list, each kept as it was written, marked as from the previous edition. ET's
       rating_schema (its "4.8 from 225 ratings") is never read: no list backs it;
     - offers (passes and prices) are never read: no EventSphere site shows its passes yet.

     parseDetails(json)            -> DETAILS | null      the edition's details answer, read
     parseTestimonials(json)       -> [TESTIMONIAL]       the testimonial list answer, read (status 1 only)
     readPreviousSeo(pick, o)      -> Promise<PREVIOUS | null>   pick = { portal, id }; o = { fetchJson(url, headers) }
     sameVenue(a, b)               -> true when two venue names are the same place ("The Leela Ambience, Gurugram" and
                                      "The Leela Ambience Gurugram")
   DETAILS = { id, name, link, venue, start, end, seo: { title, description, keywords, h1, schemaTitle, schemaDescription,
               streetAddress, city, state, country, postalCode, latitude, longitude, attendanceMode }, faqs: [{ question, answer }] }
   PREVIOUS = DETAILS + { portal, testimonials: [TESTIMONIAL] }
   TESTIMONIAL = { prevId, name, role, company, title, text, rating (1-5 | null), photoUrl }
   Nothing is invented: what ET has nothing for is '' (or null, or []). No Firebase: see seo-previous.test.js. */
'use strict';

var API = 'https://api.economictimes.indiatimes.com';
var IMG = 'https://img.etb2bimg.com/files/';

function str(v) { return v == null ? '' : String(v); }
/* text as a visitor reads it: tags gone, entities read, one space between words */
function text(v) {
  return str(v).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;|&lsquo;|&apos;/g, '’')
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function picture(p) {
  p = str(p).trim();
  if (!p) return '';
  if (/^https:\/\//i.test(p)) return p;
  if (/^http:\/\//i.test(p)) return 'https://' + p.slice(7);
  return IMG + p.replace(/^\/+/, '');
}
function coord(v, lim) {
  var n = parseFloat(str(v));
  return str(v).trim() && isFinite(n) && Math.abs(n) <= lim ? n : null;
}
/* "[\"HR Events\",\"HR Events\\t2026\"]" (the seo record), or "HR Events$#$HR Summit" (the page's own) -> a clean list */
function keywordList(v) {
  var list = [];
  var s = str(v).trim();
  if (!s) return [];
  if (s.charAt(0) === '[') { try { var j = JSON.parse(s); if (Array.isArray(j)) list = j; } catch (e) { list = []; } }
  if (!list.length) list = s.split(/\$#\$|,|\|/);
  var seen = {}, out = [];
  list.forEach(function (k) {
    var t = text(k).slice(0, 60);
    var key = t.toLowerCase();
    if (t && !seen[key]) { seen[key] = 1; out.push(t); }
  });
  return out.slice(0, 30);
}
var MODES = { offline: 'offline', online: 'online', mixed: 'mixed', hybrid: 'mixed' };

function parseDetails(json) {
  var d = json && json.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  var seo = d.seo && typeof d.seo === 'object' ? d.seo : {};
  var out = {
    id: str(d.company_id || d.id || seo.entity_id),
    name: text(d.company_name || d.branding_title || d.url_text),
    link: /^https?:\/\//i.test(str(d.branding_url)) ? str(d.branding_url) : '',
    venue: text(seo.venue || d.event_venue),
    start: str(seo.event_start_date || d.event_start_date).replace(/^0000.*$/, ''),
    end: str(seo.event_end_date || d.event_end_date).replace(/^0000.*$/, ''),
    seo: {
      title: text(seo.title || seo.meta_title || d.page_title),
      description: text(seo.description || seo.meta_description || d.page_description),
      keywords: keywordList(seo.keywords || seo.meta_keywords || d.page_keywords),
      h1: text(seo.h1_tag),
      schemaTitle: text(seo.schema_title),
      schemaDescription: text(seo.schema_description),
      /* ET's address often ends with a comma, its city given apart */
      streetAddress: text(seo.address).replace(/[\s,;]+$/, ''),
      city: text(seo.city), state: text(seo.state), country: text(seo.country),
      postalCode: text(seo.zip).replace(/\s+/g, ''),
      latitude: coord(seo.latitude, 90), longitude: coord(seo.longitude, 180),
      attendanceMode: MODES[text(seo.attendance_mode).toLowerCase()] || ''
    },
    faqs: (Array.isArray(d.faq) ? d.faq : []).filter(function (f) { return f && (f.status == null || +f.status === 1) && text(f.question) && text(f.answer); })
      .slice(0, 30).map(function (f) { return { question: text(f.question).slice(0, 300), answer: text(f.answer).slice(0, 1500) }; })
  };
  return out;
}

/* "Atma Godara, VP" -> { name: "Atma Godara", role: "VP" }: ET writes the person and their role in one field */
function splitName(v) {
  var t = text(v), at = t.indexOf(',');
  return at > 0 ? { name: t.slice(0, at).trim(), role: t.slice(at + 1).trim() } : { name: t, role: '' };
}
function parseTestimonials(json) {
  var d = json && json.data;
  var items = d && Array.isArray(d.items) ? d.items : Array.isArray(d) ? d : [];
  return items.filter(function (t) { return t && (t.status == null || +t.status === 1) && text(t.description) && text(t.user_name); }).slice(0, 30).map(function (t) {
    var who = splitName(t.user_name);
    var r = parseInt(t.rating, 10);
    return { prevId: str(t.id).replace(/\D/g, '').slice(0, 12), name: who.name.slice(0, 120), role: who.role.slice(0, 120), company: text(t.company).slice(0, 120),
      title: text(t.title).slice(0, 200), text: text(t.description).slice(0, 1500), rating: r >= 1 && r <= 5 ? r : null, photoUrl: picture(t.img) };
  });
}

function readPreviousSeo(pick, o) {
  o = o || {};
  var portal = str(pick && pick.portal), id = str(pick && pick.id);
  if (!/^[a-z0-9-]{1,40}$/.test(portal) || !/^[0-9]{1,12}$/.test(id) || typeof o.fetchJson !== 'function') return Promise.resolve(null);
  var headers = { portal: portal };
  var details = Promise.resolve(o.fetchJson(API + '/v1/microsite/details?digital_month_id=' + id, headers)).then(parseDetails, function () { return null; });
  var testimonials = Promise.resolve(o.fetchJson(API + '/v1/activity/testimonial/list?entity_id=' + id + '&activity=microsite&page=1&per_page=50', headers))
    .then(parseTestimonials, function () { return []; });
  return Promise.all([details, testimonials]).then(function (r) {
    if (!r[0]) return null;
    return Object.assign(r[0], { portal: portal, id: id, testimonials: r[1] });
  });
}

/* two venue names that are the same place: their words, less the city and the punctuation, match */
function venueKey(v) {
  return text(v).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|hotel|and|resort|convention|centre|center)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function sameVenue(a, b) {
  var x = venueKey(a), y = venueKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  /* one name says more than the other ("The Leela Ambience Gurugram" / "Leela Ambience"; "Taj Wellington, Chennai" /
     "Taj Wellington Mews Chennai"): every word of the shorter is in the longer, it has two words at least, and both
     start alike — never one word ("Leela") and never another city's ("JW Marriott Pune" / "JW Marriott Mumbai") */
  var xs = x.split(' '), ys = y.split(' ');
  var short = xs.length <= ys.length ? xs : ys, long = short === xs ? ys : xs;
  return short.length >= 2 && short[0] === long[0] && short.every(function (w) { return long.indexOf(w) !== -1; });
}

module.exports = { API: API, parseDetails: parseDetails, parseTestimonials: parseTestimonials, readPreviousSeo: readPreviousSeo, sameVenue: sameVenue, keywordList: keywordList };
