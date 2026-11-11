/* The structured data a published page carries for search (schema.org JSON-LD), from the event and the console's
   Settings › URL & SEO, holding only what the page itself shows.

   Search engines require that what is marked up for them is visible to a visitor: a FAQ in a FAQPage must be on the
   page, a review must be readable there, a speaker named as a performer must be one the page shows (Google treats
   anything else as spam and may drop the site's rich results). So every list is checked against the page as it is
   written (pageEvidence): a record the page renders (data-rv-item … data-rv-id, the editor's mark on every Content
   record it put on the page — sites are published with their records in them) or text the page shows to a visitor
   (outside <template>, <script>, <style>, <noscript>, and anything hidden or emptied: hidden, data-rv-empty,
   data-rv-hidden-empty, display:none). A testimonial counts when the page shows its words; a FAQ when the page
   shows its question; a speaker when the page shows the record or the name.

     pageEvidence(tokens, out, kit)   -> EVIDENCE { ids: { speakers: {id: 1}, faq: {id: 1} }, text: ' folded visible text ' }
     evidenceOf(html, kit)            -> the same, from a whole page
     showsSpeaker(ev, s) / showsFaq(ev, f) / showsTestimonial(ev, t)   -> true when the page shows it
     structuredData(o)                -> { event: Event | null, faq: FAQPage | null, report }
        o = { event, seo: the fields for this page (seo-fields.js seoFor), records: { speakers, faqs } that count,
              evidence, name (the page's own og:title, a fallback), description (the page's meta description),
              url, images, organizer: { name, url, logo } | null, logo: the event's logo unit's address }
        report = { performers, faqs, reviews, ratings, rating, notShown: { speakers: [id], faqs: [id], testimonials: [id] },
                   basicOff, advancedOff }   what was put in and what was left out because the page does not show it
   The rules (owner's list, 6 Nov 2026):
     - the Event: only with an exact start date ("to be announced" has none: site-seo.js eventJsonLd), and not when
       the team turned the basic schema off. Its name is the schema title, else the event's name; its description the
       schema description, else the page's meta description; its place the venue with the street and postcode the
       team typed, and the city's state and country from the place list (seo-fields.js placeOf); geo when both
       numbers are given; the attendance mode the team chose, else in person when there is a place.
     - the advanced schema (on unless the team turned it off): performers (the speakers that count AND the page
       shows), reviews (the testimonials the team included AND whose words the page shows) and the rating made from
       those reviews' ratings alone; a FAQPage of the FAQs that count AND the page shows.
     - passes and prices are never marked up: no site shows its passes yet, and search engines need prices shown.
   No network: see seo-schema.test.js. */
'use strict';

var siteSeo = require('./site-seo');
var seoFields = require('./seo-fields');
var places = require('./places');

function str(v) { return typeof v === 'string' ? v : ''; }
/* the text a visitor reads, folded: lower case, accents and punctuation gone, one space between words */
function fold(s) { return ' ' + places.fold(String(s || '').replace(/[’‘`]/g, '\'')) + ' '; }
function decode(s) {
  return String(s || '').replace(/&nbsp;|&#160;/g, ' ').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (m, n) { var c = +n; return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; }).replace(/&amp;/g, '&');
}

var SKIP = { template: 1, script: 1, style: 1, noscript: 1, svg: 1 };
function hiddenTag(t, kit) {
  if (kit.attrOf(t, 'hidden') || kit.attrOf(t, 'data-rv-empty') || kit.attrOf(t, 'data-rv-hidden-empty')) return true;
  return /(^|;)\s*display\s*:\s*none\b/i.test(String(kit.attrValue(t, 'style') || ''));
}
function pageEvidence(tokens, out, kit) {
  var ids = { speakers: {}, faq: {} }, text = [];
  var skipTo = -1;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (i <= skipTo || (out && out[i] === '')) continue;
    if (t.t === 'open') {
      if ((SKIP[t.name] && !t.selfClosing) || hiddenTag(t, kit)) { var end = kit.elementEnd(tokens, i); if (end !== -1) skipTo = end; continue; }
      var kind = kit.attrValue(t, 'data-rv-item'), id = kit.attrValue(t, 'data-rv-id');
      if (id && (kind === 'speakers' || kind === 'faq')) ids[kind][id] = 1;
      /* a picture's words are read too (a speaker's photo named for them) */
      var alt = t.name === 'img' ? kit.attrValue(t, 'alt') : null;
      if (alt) text.push(decode(alt));
    } else if (t.t === 'text') text.push(decode(out ? out[i] : ''));
  }
  return { ids: ids, text: fold(text.join(' ')) };
}
function evidenceOf(html, kit) {
  var tokens = kit.tokenizeHtml(String(html || ''));
  return pageEvidence(tokens, tokens.map(function (t) { return String(html).slice(t.s, t.e); }), kit);
}
/* the words of a thing, as the page would have them: enough of them to be its own (a name, a question, the first
   twenty words of a testimonial), folded the same way */
function says(ev, words, max) {
  var f = fold(words).trim();
  if (!ev || f.length < 3) return false;
  if (max) f = f.split(' ').slice(0, max).join(' ');
  return ev.text.indexOf(' ' + f + ' ') !== -1;
}
function showsSpeaker(ev, s) { return !!ev && !!s && (!!ev.ids.speakers[s.id] || says(ev, s.name)); }
function showsFaq(ev, f) { return !!ev && !!f && (!!ev.ids.faq[f.id] || says(ev, f.question)); }
function showsTestimonial(ev, t) { return !!ev && !!t && says(ev, t.text, 20); }

function absolute(u, base) {
  u = str(u).trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
  var m = /^(https?:\/\/[^\/\s"'<>]+)/.exec(str(base));
  return m && /^\/(?!\/)[^\s"'<>]*$/.test(u) ? m[1] + u : '';
}

function structuredData(o) {
  o = o || {};
  var event = o.event || {}, seo = o.seo || {}, records = o.records || {}, ev = o.evidence || null;
  var advanced = seo.advancedSchema !== false, basic = seo.basicSchema !== false;
  var report = { performers: 0, faqs: 0, reviews: 0, ratings: 0, rating: null, notShown: { speakers: [], faqs: [], testimonials: [] }, basicOff: !basic, advancedOff: !advanced };

  var speakers = [], faqs = [], reviews = [];
  if (advanced) {
    (records.speakers || []).forEach(function (s) { if (showsSpeaker(ev, s)) speakers.push(s); else report.notShown.speakers.push(s.id); });
    (records.faqs || []).forEach(function (f) { if (showsFaq(ev, f)) faqs.push(f); else report.notShown.faqs.push(f.id); });
    (Array.isArray(seo.testimonials) ? seo.testimonials : []).forEach(function (t) {
      if (!t || t.off) return;
      if (showsTestimonial(ev, t)) reviews.push({ name: t.name, title: t.title, text: t.text, rating: t.rating });
      else report.notShown.testimonials.push(t.id);
    });
  }

  var ld = null;
  if (basic) {
    var place = seoFields.placeOf(event.city, event.portal);
    var address = { street: str(seo.streetAddress), postalCode: str(seo.postalCode) };
    if (place) { address.locality = place.city; address.region = place.state; address.country = place.countryCode; }
    var geo = typeof seo.latitude === 'number' && typeof seo.longitude === 'number' ? { latitude: seo.latitude, longitude: seo.longitude } : null;
    var images = (o.images || []).slice();
    var logo = absolute(o.logo, o.url);
    if (logo && images.indexOf(logo) === -1 && !/\.svg(\?|#|$)/i.test(logo)) images.push(logo);
    ld = siteSeo.eventJsonLd(event, {
      name: str(seo.schemaTitle) || str(event.name).replace(/\s+/g, ' ').trim() || str(o.name),
      description: str(seo.schemaDescription) || str(o.description),
      url: o.url, images: images, organizer: o.organizer || null,
      attendance: seoFields.attendanceOf(seo, event), address: address, geo: geo,
      performers: speakers, reviews: reviews
    });
  }
  if (ld) {
    report.performers = (ld.performer || []).length;
    report.reviews = (ld.review || []).length;
    report.ratings = ld.aggregateRating ? ld.aggregateRating.ratingCount : 0;
    report.rating = ld.aggregateRating ? ld.aggregateRating.ratingValue : null;
  }
  var faq = advanced ? siteSeo.faqPageJsonLd(faqs) : null;
  report.faqs = faq ? faq.mainEntity.length : 0;
  return { event: ld, faq: faq, report: report };
}

module.exports = { pageEvidence: pageEvidence, evidenceOf: evidenceOf, showsSpeaker: showsSpeaker, showsFaq: showsFaq, showsTestimonial: showsTestimonial,
  structuredData: structuredData, fold: fold };
