/* ETB2B AI for the console's Settings › URL & SEO: the SEO title, meta description, keywords, H1 heading, schema
   title and schema description — and, when the event has none, FAQs for Content › FAQ — written from the event's real
   details only.

   WHAT THE MODEL IS GIVEN (facts): the event's name, dates, venue and city, its short description, its portal and
   category, and the words of its own site (its headings and the first lines of its sections). The previous edition's
   SEO (from ET's API, seo-previous.js) is given apart, as a REFERENCE for the kind of words ET uses: never to copy,
   and any year in it is the previous edition's.

   WHAT IS NEVER LET THROUGH. The model may not invent a fact: no date, venue, number ("2000+ attendees"), price,
   speaker or sponsor the event's details do not hold. The prompt says so, and every answer is checked after
   (unbacked): a number, a year, a month, a price, or a well-known city named in a field that the facts do not
   contain makes that field go unwritten, with the reason — the team sees "left out: it said 2000+, which the event's
   details do not say" and can write it again or type it. The previous edition's words are not facts: a number found
   only there is still refused (so last year's year cannot slip in).

     FIELDS                       the fields written here (seo-fields.js AI_FIELDS)
     buildFacts(o)                -> { lines: [string], text }   o = { event, portalName, categoryName, site: siteWords() }
     siteWords(html, kit)         -> { headings: [string], text }   the site's own words, as a visitor reads them
     buildPrompt(o)               -> the prompt: o = { facts, fields, previous (seo-previous.js PREVIOUS | null), year, faqs: bool, existingFaqs }
     schemaFor(fields) / FAQ_SCHEMA   the answer's shape (small: strict mode takes it)
     clean(field, value)          -> the value tidied to its limits ('' or [] when unusable)
     unbacked(text, facts)        -> [what it says that the facts do not]
     apply(parsed, fields, facts) -> { values: { field: value }, dropped: [{ field, why }] }
     applyFaqs(parsed, facts)     -> { faqs: [{ question, answer }], dropped: [{ field: 'faq', why }] }
   No network, no model: see seo-ai.test.js (a stubbed model). */
'use strict';

var seoFields = require('./seo-fields');
var places = require('./places');
var genDesign = require('./gen-design');

var FIELDS = seoFields.AI_FIELDS.slice();
var CATEGORY = { ip: 'IP event (ETB2B\'s own conference)', client: 'Client event', editorial: 'Editorial event', leadgen: 'Lead-gen microsite', roundtable: 'Round table', awards: 'Awards' };
var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function str(v) { return typeof v === 'string' ? v : ''; }
function line(v) { return seoFields.line(v); }

/* ---------- the facts ---------- */
function siteWords(html, kit) {
  var out = { headings: [], text: '' };
  if (!html || !kit) return out;
  var tokens = kit.tokenizeHtml(String(html)), words = [], heading = null, skipTo = -1;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (i <= skipTo) continue;
    if (t.t === 'open') {
      var hidden = kit.attrOf(t, 'hidden') || kit.attrOf(t, 'data-rv-empty') || kit.attrOf(t, 'data-rv-editor') || /display\s*:\s*none/i.test(String(kit.attrValue(t, 'style') || ''));
      if ((/^(template|script|style|noscript|svg|header|footer|nav)$/.test(t.name) && !t.selfClosing) || hidden ||
          /^(nav|footer)$/.test(String(kit.attrValue(t, 'data-rv-section') || ''))) {
        var end = kit.elementEnd(tokens, i); if (end !== -1) skipTo = end; continue;
      }
      if (/^h[1-3]$/.test(t.name)) heading = [];
    } else if (t.t === 'close' && /^h[1-3]$/.test(t.name) && heading) {
      var h = line(heading.join(' '));
      if (h && out.headings.indexOf(h) === -1 && out.headings.length < 30) out.headings.push(h.slice(0, 160));
      heading = null;
    } else if (t.t === 'text') {
      var w = String(html).slice(t.s, t.e).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      if (heading) heading.push(w);
      words.push(w);
    }
  }
  out.text = line(words.join(' ')).slice(0, 3000);
  return out;
}

function buildFacts(o) {
  o = o || {};
  var e = o.event || {}, lines = [];
  function add(label, v) { v = line(v); if (v) lines.push(label + ': ' + v); }
  add('Event name', e.name);
  var exact = seoFields.datesExact(e);
  if (exact) add('Dates', genDesign.dateLabel(e.start, e.end));
  else add('Dates', 'to be announced' + (line(e.dateLabel) ? ' (' + line(e.dateLabel) + ')' : ''));
  add('Venue', e.venue);
  add('City', e.city);
  var place = seoFields.placeOf(e.city, e.portal);
  if (place) add('Place', place.label);
  add('Short description', e.description);
  add('Portal (the ETB2B publication that runs it)', o.portalName);
  add('Kind of event', CATEGORY[str(e.category)] || e.category);
  var site = o.site || {};
  if (site.headings && site.headings.length) lines.push('The site\'s headings: ' + site.headings.join(' · '));
  if (site.text) lines.push('The site\'s own words (first part): ' + site.text);
  return { lines: lines, text: lines.join('\n') };
}

/* ---------- the prompt ---------- */
var RULES = {
  title: 'title: the page\'s title in search results, at most 60 characters. The event\'s name first, then what it is and for whom (e.g. "HR Tech Summit"), and the portal if it fits. No "|" chains of keywords, no year unless the event\'s dates give it.',
  description: 'description: the meta description, 140 to 160 characters, one or two sentences: what the event is, for whom, when and where (only as the facts give them), ending with a plain call to register. No quotation marks.',
  keywords: 'keywords: 8 to 12 search phrases people would type to find this event (each 2 to 5 words, at most 60 characters): the event\'s name, its subject, its audience, its city when known, the kind of event. No duplicates.',
  h1: 'h1: the page\'s main heading for search engines, at most 70 characters: the event\'s name and what it is.',
  schemaTitle: 'schemaTitle: the event\'s name as search engines list it as an event, at most 90 characters: the event\'s name, plus what it is if that is not in the name.',
  schemaDescription: 'schemaDescription: two or three sentences, at most 300 characters, describing the event for an event listing: what happens, who it is for, why attend — from the facts.'
};
function buildPrompt(o) {
  o = o || {};
  var facts = o.facts || { lines: [] }, prev = o.previous;
  var parts = [
    'You write search-engine text for one event of The Economic Times\' B2B portals (ETB2B EventSphere). Write in plain, professional Indian English.',
    '',
    'THE EVENT — these are the ONLY facts you may use:',
    facts.lines.join('\n') || '(nothing more is known)',
    '',
    require('./name-rule').NAME_RULE,
    'NEVER INVENT A FACT. Do not state any number (attendees, speakers, editions, years of running, sessions — no "2000+", no "50 speakers"), date, month, year, venue, city, price, fee, speaker, sponsor, partner or award that is not written in the facts above. When the dates are to be announced, say nothing about when. Do not call it free, the biggest, the first or the leading unless the facts say so. Never name a person.'
  ];
  if (prev && prev.seo) {
    var p = prev.seo;
    parts.push('', 'THE PREVIOUS EDITION\'S SEARCH TEXT on ETB2B\'s site, ' + line(prev.name) + ' — a REFERENCE for the kind of phrases ETB2B uses for this event. Never copy it; any year, number or place in it is the PREVIOUS edition\'s and must not be used unless the facts above say it too:');
    if (p.title) parts.push('  title: ' + p.title);
    if (p.description) parts.push('  description: ' + p.description);
    if (p.keywords && p.keywords.length) parts.push('  keywords: ' + p.keywords.join('; '));
    if (p.schemaTitle) parts.push('  schema title: ' + p.schemaTitle);
  }
  if (o.faqs) {
    parts.push('', 'WRITE 5 TO 6 FAQs a visitor of this event\'s site would ask (what it is, who it is for, when and where — only as known, how to take part, what they get from it), each answer 1 to 3 sentences from the facts alone. When a fact is not known (the date, the venue, a fee), the answer says it will be announced on this site — never a guess.');
    if (o.existingFaqs && o.existingFaqs.length) parts.push('The site already answers: ' + o.existingFaqs.join(' · ') + '. Do not ask these again.');
    parts.push('', 'Answer as JSON: { "faqs": [ { "question": "...", "answer": "..." } ] }.');
  } else {
    var fields = (o.fields || FIELDS).filter(function (f) { return RULES[f]; });
    parts.push('', 'WRITE these fields:');
    fields.forEach(function (f) { parts.push('- ' + RULES[f]); });
    parts.push('', 'Answer as JSON with exactly these keys: ' + fields.join(', ') + ' (keywords is a list of strings, the others are strings).');
  }
  return parts.join('\n');
}

function schemaFor(fields) {
  var props = {}, req = [];
  (fields || FIELDS).forEach(function (f) {
    if (FIELDS.indexOf(f) === -1) return;
    props[f] = f === 'keywords' ? { type: 'ARRAY', items: { type: 'STRING' } } : { type: 'STRING' };
    req.push(f);
  });
  return { type: 'OBJECT', properties: props, required: req };
}
var FAQ_SCHEMA = { type: 'OBJECT', properties: { faqs: { type: 'ARRAY', items: { type: 'OBJECT', properties: { question: { type: 'STRING' }, answer: { type: 'STRING' } }, required: ['question', 'answer'] } } }, required: ['faqs'] };

/* ---------- the answer ---------- */
/* at most n characters, cut at the last whole word (never mid-word), with no dangling punctuation and no small word
   left hanging at the end ("…for HR leaders, in") */
var HANGING = /(?:[\s,;:|–—-]+|\s+(?:in|on|at|for|and|or|of|the|a|an|to|with|by|from|&))+$/i;
function fit(t, n) {
  t = line(t).replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
  if (t.length <= n) return t;
  var cut = t.slice(0, n + 1).replace(/\s+\S*$/, ''), was;
  do { was = cut; cut = cut.replace(HANGING, ''); } while (cut !== was);
  return cut;
}
/* a text of whole sentences cut to at most n characters: up to the last sentence end that still fits, when that
   keeps at least half of n (a description that stops mid-sentence reads as broken); else at a word, as fit does.
   A sentence end is . ! or ? followed by a capital (so "e.g. the" is not one) or by the end of the text. */
function fitSentences(t, n) {
  t = line(t).replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
  if (t.length <= n) return t;
  var head = t.slice(0, n + 1), end = -1, re = /[.!?](?=\s+["“‘']?[A-Z0-9]|$)/g, m;
  while ((m = re.exec(head))) if (m.index < n) end = m.index;
  if (end + 1 >= n / 2) return head.slice(0, end + 1);
  return fit(t, n);
}
var MAX = { title: 70, description: 320, h1: 120, schemaTitle: 120, schemaDescription: 500 };
/* what ETB2B AI's text is cut to: the lengths the prompt asks for and the console counts against (edit-event-seo.js
   IDEAL), so a field the AI wrote never shows as over its length the moment it is written */
var IDEAL = { title: 60, description: 160, h1: 70, schemaTitle: 90, schemaDescription: 300 };
var PROSE = { description: 1, schemaDescription: 1 };
function clean(field, value) {
  if (field === 'keywords') {
    var list = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/);
    var seen = {}, out = [];
    list.forEach(function (k) {
      var t = fit(String(k || '').replace(/^#/, ''), 60);
      var key = t.toLowerCase();
      if (t && t.length >= 3 && !seen[key] && out.length < 12) { seen[key] = 1; out.push(t); }
    });
    return out.length >= 3 ? out : [];
  }
  if (!MAX[field]) return '';
  var t = PROSE[field] ? fitSentences(value, IDEAL[field]) : fit(value, IDEAL[field]);
  return t.length >= 10 ? t : '';
}

/* What a field says that the facts do not: numbers (a year, "2000+", "50"), months, prices, and the well-known
   cities (300,000 people or more in India, a million abroad) — each only if the facts do not say it too. */
function folded(s) { return ' ' + places.fold(s) + ' '; }
function unbacked(text, facts) {
  var said = String(text || ''), f = String((facts && facts.text) || facts || '');
  var fNum = f.replace(/(\d),(?=\d{2,3}\b)/g, '$1'), fFold = folded(f), out = [];
  (said.replace(/(\d),(?=\d{2,3}\b)/g, '$1').match(/\d+(?:\.\d+)?\s*(?:\+|%|k\b|lakh|crore)?/gi) || []).forEach(function (n) {
    var core = n.replace(/[^\d.]/g, '');
    if (!new RegExp('(^|[^\\d.])' + core.replace('.', '\\.') + '([^\\d]|$)').test(fNum) && out.indexOf(n.trim()) === -1) out.push(n.trim());
  });
  if (/[₹$€£]|\b(?:rs\.?|inr|usd)\s*\d/i.test(said) && !/[₹$€£]|\b(?:rs\.?|inr|usd)\s*\d/i.test(f)) out.push('a price');
  var sFold = folded(said);
  MONTHS.forEach(function (m) {
    var short = m.slice(0, 3);
    var inSaid = sFold.indexOf(' ' + m + ' ') !== -1 || (m !== 'may' && sFold.indexOf(' ' + short + ' ') !== -1);
    var inFacts = fFold.indexOf(' ' + m + ' ') !== -1 || fFold.indexOf(' ' + short + ' ') !== -1;
    if (inSaid && !inFacts) out.push(m.charAt(0).toUpperCase() + m.slice(1));
  });
  /* places: a word or two of capitals that is a large city, not in the facts */
  var caps = said.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) || [];
  caps.forEach(function (c) {
    var words = c.split(/\s+/);
    [c].concat(words).forEach(function (w) {
      if (fFold.indexOf(folded(w)) !== -1) return;
      var p = places.cityOf(w, { country: 'IN', abroadMin: 1000000, minPeople: 300000 });
      if (p && out.indexOf(w) === -1) out.push(w);
    });
  });
  return out;
}

function why(field, list) { return 'left out: it said ' + list.slice(0, 3).map(function (x) { return '“' + x + '”'; }).join(', ') + ', which the event\'s details do not say'; }
function apply(parsed, fields, facts) {
  var values = {}, dropped = [];
  parsed = parsed && typeof parsed === 'object' ? parsed : {};
  (fields || FIELDS).forEach(function (f) {
    if (FIELDS.indexOf(f) === -1) return;
    var v = clean(f, parsed[f]);
    if (f === 'keywords') {
      /* a keyword that says something unbacked goes alone; the rest stay */
      var bad = [], kept = (v || []).filter(function (k) { var u = unbacked(k, facts); if (u.length) bad = bad.concat(u); return !u.length; });
      if (kept.length >= 3) { values[f] = kept; if (bad.length) dropped.push({ field: f, why: 'some keywords ' + why(f, bad) }); }
      else dropped.push({ field: f, why: bad.length ? why(f, bad) : 'left out: ETB2B AI gave too few usable keywords' });
      return;
    }
    if (!v) { dropped.push({ field: f, why: 'left out: ETB2B AI gave nothing usable for it' }); return; }
    var u = unbacked(v, facts);
    if (u.length) { dropped.push({ field: f, why: why(f, u) }); return; }
    values[f] = v;
  });
  return { values: values, dropped: dropped };
}
function applyFaqs(parsed, facts) {
  var list = parsed && Array.isArray(parsed.faqs) ? parsed.faqs : [], faqs = [], dropped = [];
  list.slice(0, 8).forEach(function (f) {
    var q = fit(f && f.question, 200), a = fit(f && f.answer, 700);
    if (q.length < 8 || a.length < 15) return;
    var u = unbacked(q + ' ' + a, facts);
    if (u.length) { dropped.push({ field: 'faq', why: '“' + q + '” ' + why('faq', u) }); return; }
    faqs.push({ question: /\?$/.test(q) ? q : q + '?', answer: a });
  });
  return { faqs: faqs, dropped: dropped };
}

module.exports = { FIELDS: FIELDS, RULES: RULES, buildFacts: buildFacts, siteWords: siteWords, buildPrompt: buildPrompt, schemaFor: schemaFor, FAQ_SCHEMA: FAQ_SCHEMA,
  clean: clean, unbacked: unbacked, apply: apply, applyFaqs: applyFaqs };
