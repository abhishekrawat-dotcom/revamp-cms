/* What ETB2B AI wrote on an AI-designed site that nothing this event supplied supports (BE-043).

   WHY. The owner's standing rule: never invent dates, venues, numbers, prices, ratings, testimonials or contacts. The
   prompts say so (lib/api.js buildSectionCodePrompt: "never write an e-mail address, phone number, web address, street
   address, price, deadline or statistic that is not in the material above"), but a prompt is a request, not a check:
   nothing read what came back. This file reads it. A fact counts as supplied when the event's own material has it —
   its record (Basics, the owner's notes and brief), the brief read from its document, its own previous or current
   edition (never a competitor's: their figures and contacts are not this event's), its Content records, and, for a
   section ETB2B AI rewrote, the section as it stood before. Dates and the place are checked elsewhere
   (site-advisory.js dateFindings, venueFindings); this is everything else a visitor would take as a fact:

     email     an e-mail address                         removed: becomes name@example.com
     phone     a phone number                            removed: becomes +00 00000 00000
     web       a web address, written out or linked to another site
     figure    a statistic ("500+ CXOs", "40%", "3x", "10 lakh")
     money     an amount of money (a price, a market size)
     award     an award, a ranking or a "largest / first / only" claim
     partner   a company named as partner, sponsor or presenter ("powered by …")
     address   a street address or a PIN code

   An e-mail or phone number nobody supplied is never left for a visitor to write to or ring: it becomes the
   unmistakable placeholder ETB2B AI is told to use, which the check before publishing holds back
   (site-checks.js placeholderHits) until the event's own is written in. The rest is never cut out of a sentence — that
   would leave broken copy — but flagged: logged when the site is made, and listed in the console's site check as
   facts to check while they are still on the page. A placeholder, a record drawn from Content (data-rv-repeat-template,
   data-rv-item, data-rv-field) and what the server builds from the event's record (the banner, the top bar, the
   footer, the sections made from the previous edition's records) are never read.

     groundOf(a, b, …) -> ground            everything supplied, from any mix of strings, arrays and objects
     previousFacts(previous) -> [values]     a previous edition's records (a source's "previous"), with how many of each
     check(html, ground, kit, opts) -> { html, removed: [{ kind, text, section }], flagged: [{ kind, text, section }] }
        opts.fix            true: e-mails and phone numbers nobody supplied become the placeholders (html changes)
        opts.skipSections   section ids not read (default: hero, nav, footer); "award-*" names every id so starting
     checkSections(sections, ground, kit, opts) -> { sections, removed, flagged }   check() over [{ id, html, … }]
        (ids in opts.skipSections are left as they are); returns new section objects, the input is not changed
     findings(html, ground, kit, opts) -> [{ kind, label, text, count, sections, places: [{ key, section }] }]
        what is on the page now, grouped, for lib/api.js siteCheckOf
     summary(result) -> 'removed 1 e-mail address; flagged 2 figures, 1 claim'   for the log

   kit: lib/api.js's tokenizer (TOKEN_KIT), as site-checks.js takes it. No network, no Firebase: see
   invented-facts.test.js. */
'use strict';

var siteChecks = require('./site-checks');

var PLACEHOLDER_EMAIL = 'name@example.com';
var PLACEHOLDER_PHONE = '+00 00000 00000';
var LABELS = { email: 'e-mail address', phone: 'phone number', web: 'web address', figure: 'figure', money: 'amount',
  award: 'claim', partner: 'partner', address: 'address' };
var DEFAULT_SKIP = ['hero', 'nav', 'footer'];

/* ---------- text ---------- */
var NAMED = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', hellip: '…', rupee: '₹', pound: '£', euro: '€', times: '×', copy: '©' };
function decode(s) {
  return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
    var k = e.toLowerCase();
    if (NAMED[k] != null) return NAMED[k];
    if (k.charAt(0) !== '#') return m;
    var n = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; } catch (err) { return m; }
  });
}
function squash(s) { return String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim(); }
/* how the material and the page are compared: lower case, one kind of apostrophe and dash, single spaces */
function norm(s) { return squash(decode(s)).toLowerCase().replace(/[’‘`]/g, "'").replace(/[–—]/g, '-'); }

/* ---------- what is looked for ---------- */
var EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
var PLACEHOLDER_EMAIL_RE = /@example\.(?:com|org|net)$|^(?:name|email|you|your\.?name|contact)@(?:company|domain|email)\.com$/i;
/* a run of 8 to 15 digits, in groups, with an optional +country code and (area code) */
var PHONE_RE = /(?:\+\s?\d{1,3}[\s.\-]?)?(?:\(\s?\d{1,5}\s?\)[\s.\-]?)?\d{2,5}(?:[\s.\-]?\d{2,6}){1,4}/g;
var TLDS = 'com|in|org|net|co|io|ai|biz|info|events|event|tech|app|live|online|site|xyz|global|world|asia|us|uk|news';
var DOMAIN_RE = new RegExp('(?:https?:\\/\\/)?(?:www\\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:' + TLDS + ')(?:\\.[a-z]{2})?(?![a-z0-9-])(?:\\/[^\\s<>"\')]*)?', 'gi');
/* ET's own addresses and the platforms a site is built on: never a claim */
var OWN_HOSTS = /(?:^|\.)(?:indiatimes\.com|economictimes\.com|etb2bimg\.com|timesinternet\.in|etb2b\.com|googleapis\.com|gstatic\.com|google\.com|googleusercontent\.com)$/i;
/* a profile on these is someone's, not the host's: only the whole address counts as supplied */
var SHARED_HOSTS = /(?:^|\.)(?:linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|youtu\.be|vimeo\.com|wa\.me|whatsapp\.com|t\.me)$/i;
var MULTIPLIER = { k: 1e3, thousand: 1e3, lakh: 1e5, lac: 1e5, lakhs: 1e5, mn: 1e6, million: 1e6, cr: 1e7, crore: 1e7, crores: 1e7,
  bn: 1e9, billion: 1e9, trillion: 1e12, tn: 1e12 };
var CURRENCY = '[₹$€£]|\\b(?:rs\\.?|inr|usd|us\\$|eur|gbp)';
/* a number with what makes it a statistic: a currency before it, or %, +, x or a multiplier after it */
var FIGURE_RE = new RegExp('(' + CURRENCY + ')?\\s?(?<![\\w,]|\\d\\.)(\\d{1,3}(?:,\\d{2,3})+|\\d+)(?:\\.(\\d+))?(?:\\s?(%|\\+|x(?![a-z])|k(?![a-z])|thousand|lakhs?|lac|mn|million|cr(?![a-z])|crores?|bn|billion|tn|trillion))?(\\+)?(?:\\s+(?:of\\s+)?([a-z][a-z\'’-]*))?', 'gi');
/* what a number before it counts, for a bare number to be a statistic ("50 speakers") */
var COUNTED = new RegExp('^(?:' + [
  'speakers?', 'delegates?', 'attendees?', 'participants?', 'leaders?', 'cxos?', 'ceos?', 'cios?', 'cisos?', 'ctos?', 'cmos?', 'cfos?', 'chros?',
  'executives?', 'decision-makers?', 'professionals?', 'experts?', 'innovators?', 'founders?', 'investors?', 'policymakers?', 'visitors?',
  'members?', 'companies', 'company', 'brands?', 'enterprises?', 'organi[sz]ations?', 'startups?', 'start-ups?', 'unicorns?', 'exhibitors?',
  'partners?', 'sponsors?', 'sessions?', 'panels?', 'keynotes?', 'tracks?', 'workshops?', 'masterclass(?:es)?', 'roundtables?', 'conversations?',
  'discussions?', 'awards?', 'categories', 'nominations?', 'entries', 'jurors?', 'judges?', 'countries', 'cities', 'states', 'editions?',
  'years?', 'days?', 'hours?', 'minutes?', 'mins?', 'booths?', 'stalls?', 'industries', 'sectors?', 'verticals?', 'meetings?', 'stages?',
  'halls?', 'nations?', 'markets?', 'stores?', 'outlets?', 'malls?', 'deals?', 'customers?', 'users?', 'employees?', 'people'
].join('|') + ')$', 'i');
var CLAIM_RE = /\b(?:award[- ]winning|winners? of (?:the )?[a-z][^.,;:!?]{2,50}|ranked\s+(?:no\.?\s*|number\s+|#\s*)\d+|number\s+one\b|(?:india|asia|the world|apac|asia-pacific|south asia)['’]s\s+(?:largest|biggest|leading|premier|first|only|top|most\s+[a-z]+)\b|(?:the\s+)?(?:largest|biggest)\s+(?:gathering|conference|summit|event|congregation|forum|platform|meet|show|expo|exhibition|awards?)\b|first[- ]ever\b|the\s+only\s+(?:event|summit|conference|forum|platform|awards?)\b|(?:most|highly)\s+(?:prestigious|awarded|acclaimed)\b)/gi;
var PARTNER_LEAD = ['in partnership with', 'in association with', 'in collaboration with', 'partnered with', 'powered by', 'supported by',
  'sponsored by', 'presented by', 'co-presented by', 'backed by', 'endorsed by', 'hosted by', 'organised by', 'organized by'];
/* the words that name a partner in either case; the name itself starts with a capital */
var PARTNER_RE = new RegExp('\\b(?:' + PARTNER_LEAD.map(function (w) { return '[' + w.charAt(0).toUpperCase() + w.charAt(0) + ']' + w.slice(1).replace(/ /g, '\\s+'); }).join('|') +
  ')\\s*:?\\s+((?:the\\s+)?[A-Z][\\w&\'’-]*(?:\\s+(?:of|and|&|for|[A-Z][\\w&\'’-]*)){0,6})', 'g');
/* ETB2B and its portals: the publisher, named on every site */
var OWN_NAMES = /^(?:the\s+)?(?:economic times|et\b|etb2b|et[a-z]+\b|times (?:internet|group)|the times)/i;
var PIN_RE = /(?:\b(?:pin(?:\s?code)?)\s*:?\s*|[,\-–]\s*)([1-9]\d{2}\s?\d{3})(?!\d)/gi;
var STREET_RE = /\b\d{1,4}[a-z]?\s*,?\s+(?:[A-Z][\w.'’-]*\s+){0,4}(?:Road|Rd\.?|Marg|Street|St\.|Avenue|Ave\.?|Lane|Highway|Nagar|Floor|Tower|Complex|Estate|Chowk|Bagh)\b/g;

/* ---------- numbers ---------- */
function numberValue(digits, decimals, mult) {
  var n = parseFloat(String(digits).replace(/,/g, '') + (decimals ? '.' + decimals : ''));
  if (!isFinite(n)) return null;
  var m = mult ? MULTIPLIER[String(mult).toLowerCase()] : 1;
  return m ? n * m : n;
}
function numKey(n) { return n == null ? '' : String(Math.round(n * 1000) / 1000); }

/* ---------- what the event supplied ---------- */
function collect(v, out, depth) {
  if (v == null || depth > 8) return;
  if (typeof v === 'string') { if (v.trim()) out.push(v); return; }
  if (typeof v === 'number') { out.push(String(v)); return; }
  if (Array.isArray(v)) { v.forEach(function (x) { collect(x, out, depth + 1); }); return; }
  if (typeof v === 'object') {
    if (typeof v.toDate === 'function') return;                               // a Firestore time: dates are checked elsewhere
    Object.keys(v).forEach(function (k) { collect(v[k], out, depth + 1); });
  }
}
function hostOf(url) {
  var m = /^(?:https?:\/\/)?(?:www\.)?([^\/\s?#:]+)/i.exec(String(url || '').trim());
  return m ? m[1].toLowerCase().replace(/\.$/, '') : '';
}
function urlKey(url) { return String(url || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/?#]+$/, ''); }
function phoneKey(text) { var d = String(text).replace(/\D/g, ''); return d.length >= 8 ? d.slice(-10) : ''; }

function groundOf() {
  var strings = [];
  collect(Array.prototype.slice.call(arguments), strings, 0);
  var raw = strings.map(decode).join('\n');
  var g = { text: norm(raw), emails: {}, phones: {}, numbers: {}, hosts: {}, urls: {} };
  (raw.match(EMAIL_RE) || []).forEach(function (e) { g.emails[e.toLowerCase()] = 1; });
  (raw.match(PHONE_RE) || []).forEach(function (p) { var k = phoneKey(p); if (k) g.phones[k] = 1; });
  (raw.match(DOMAIN_RE) || []).forEach(function (u) { if (/@/.test(u)) return; g.hosts[hostOf(u)] = 1; g.urls[urlKey(u)] = 1; });
  strings.forEach(function (s) {
    s = decode(s);
    var m, re = new RegExp(FIGURE_RE.source, 'gi');
    while ((m = re.exec(s))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      g.numbers[numKey(numberValue(m[2], m[3]))] = 1;
      if (m[4] && MULTIPLIER[m[4].toLowerCase()]) g.numbers[numKey(numberValue(m[2], m[3], m[4]))] = 1;
    }
  });
  return g;
}

/* What a previous edition's records (prev-sections.js: speakers, agenda, sponsors, glimpses) give as facts: everything
   they say, and how many of each there were — the figures the numbers band is told to use (lib/api.js
   plan-structure). -> [values] for groundOf */
function previousFacts(previous) {
  if (!previous || typeof previous !== 'object') return [];
  var days = {};
  (previous.agenda || []).forEach(function (a) { var d = String((a && a.start) || '').slice(0, 10); if (d) days[d] = 1; });
  var counts = [];
  if (Object.keys(days).length) counts.push(Object.keys(days).length + ' days');
  if ((previous.speakers || []).length) counts.push(previous.speakers.length + ' speakers');
  if ((previous.agenda || []).length) counts.push(previous.agenda.length + ' sessions');
  if ((previous.sponsors || []).length) counts.push(previous.sponsors.length + ' partners');
  return [counts.join(', '), previous];
}

/* ---------- reading a page ---------- */
var INLINE = { a: 1, abbr: 1, b: 1, bdi: 1, bdo: 1, br: 1, cite: 1, code: 1, data: 1, dfn: 1, em: 1, i: 1, kbd: 1, mark: 1, q: 1, s: 1,
  samp: 1, small: 1, span: 1, strong: 1, sub: 1, sup: 1, time: 1, u: 1, var: 1, wbr: 1, clr: 1, font: 1, label: 1, img: 1 };
var RECORD_MARKS = ['data-rv-repeat-template', 'data-rv-item', 'data-rv-field', 'data-rv-from-data', 'data-rv-empty-state', 'data-rv-editor'];

/* the page's text in runs a visitor reads together (a paragraph, a card's title), with the text tokens of each, and
   its links; what is not read is left out */
function readPage(html, kit, skip) {
  var s = siteChecks.read(html, kit), runs = [], links = [], cur = null, skipTo = -1;
  function flush() { if (cur && cur.parts.length) runs.push(cur); cur = null; }
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i], c = s.ctx[i];
    if (i <= skipTo) continue;
    if (c.skip || c.hidden || skip.has(c.section)) { if (t.t === 'open') { flush(); skipTo = s.ends[i]; } continue; }
    if (t.t === 'open') {
      if (RECORD_MARKS.some(function (a) { return kit.attrOf(t, a); })) { flush(); skipTo = s.ends[i]; continue; }
      if (t.name === 'a') links.push({ i: i, tag: t, section: c.section, key: c.key });
      if (!INLINE[t.name]) flush();
      else if (t.name === 'br' && cur) cur.parts.push({ i: -1, text: ' ' });
      continue;
    }
    if (t.t === 'close') { if (!INLINE[t.name]) flush(); continue; }
    if (t.t !== 'text') continue;
    if (!cur) cur = { parts: [], section: c.section, key: c.key };
    cur.parts.push({ i: i, text: html.slice(t.s, t.e) });
  }
  flush();
  runs.forEach(function (r) { r.text = squash(decode(r.parts.map(function (p) { return p.text; }).join(''))); });
  return { s: s, runs: runs, links: links };
}

/* ---------- is it supplied ---------- */
function emailOk(e, g) { e = e.toLowerCase(); return PLACEHOLDER_EMAIL_RE.test(e) || !!g.emails[e] || g.text.indexOf(e) !== -1; }
function phoneOk(p, g) { var k = phoneKey(p); return !k || /^0+$/.test(k) || !!g.phones[k]; }
function looksLikePhone(p) {
  var digits = p.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return false;
  if (/^0+$/.test(digits)) return false;
  var t = p.trim();
  /* years, a span of years, a date, a time or a plain big number are not phone numbers */
  if (/^(?:19|20)\d\d\s*[\-–]\s*(?:19|20)?\d\d$/.test(t)) return false;
  if (/^\d{1,2}[.\-\/]\d{1,2}[.\-\/](?:19|20)?\d\d$/.test(t)) return false;
  if (/^(?:19|20)\d\d[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/.test(t)) return false;
  return t.charAt(0) === '+' || digits.length >= 10;
}
function webOk(u, g) {
  var host = hostOf(u);
  if (!host || OWN_HOSTS.test(host)) return true;
  if (g.urls[urlKey(u)]) return true;
  if (SHARED_HOSTS.test(host)) return false;
  return !!g.hosts[host] || g.text.indexOf(host) !== -1;
}
function numberOk(n, g) { return n != null && !!g.numbers[numKey(n)]; }
/* "60+" is what the previous edition's 64 speakers are written as: a figure with a + is supplied by any figure from
   it up to half again (never a smaller one) */
function atLeastOk(n, g) {
  if (n == null || !(n > 0)) return false;
  return Object.keys(g.numbers).some(function (k) { var v = +k; return v >= n && v <= n * 1.5; });
}
function phraseOk(text, g) {
  var words = norm(text).replace(/[^a-z0-9' -]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return g.text.indexOf(words.slice(0, Math.min(2, words.length)).join(' ')) !== -1;
}
/* a name, or each of several ("Microsoft and Google"), the trailing small words left off */
function nameOk(name, g) {
  return norm(name).replace(/[.,;:]+$/, '').replace(/(?:\s+(?:of|and|&|for))+$/, '').split(/\s+(?:and|&)\s+|,\s*/).every(function (n) {
    n = n.replace(/^the\s+/, '').trim();
    return !n || OWN_NAMES.test(n) || g.text.indexOf(n) !== -1;
  });
}

/* the claims in one run of text -> [{ kind, text }] */
function claimsOfText(text, g) {
  var out = [], m, re;
  function add(kind, t) { t = squash(t); if (t && !out.some(function (x) { return x.kind === kind && x.text === t; })) out.push({ kind: kind, text: t }); }
  re = new RegExp(EMAIL_RE.source, 'gi');
  while ((m = re.exec(text))) if (!emailOk(m[0], g)) add('email', m[0]);
  var noMail = text.replace(EMAIL_RE, ' ');
  re = new RegExp(PHONE_RE.source, 'g');
  var phones = [];
  while ((m = re.exec(noMail))) if (looksLikePhone(m[0])) { phones.push(m[0]); if (!phoneOk(m[0], g)) add('phone', m[0]); }
  var plain = phones.reduce(function (acc, p) { return acc.split(p).join(' '); }, noMail);
  re = new RegExp(DOMAIN_RE.source, 'gi');
  while ((m = re.exec(plain))) if (!webOk(m[0], g)) add('web', m[0].replace(/[.,;:]+$/, ''));
  var words = plain.replace(DOMAIN_RE, ' ');
  re = new RegExp(FIGURE_RE.source, 'gi');
  while ((m = re.exec(words))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    var cur = m[1], digits = m[2], suffix = m[4], plus = m[5], noun = m[6] || '';
    var value = numberValue(digits, m[3]);
    var isYear = !cur && !suffix && !plus && value >= 1900 && value <= 2100 && !/,/.test(digits);
    if (isYear) continue;
    var counted = COUNTED.test(noun);
    var stat = !!(cur || suffix || plus || (counted && value >= 2));
    if (!stat) continue;
    var shown = squash(m[0].replace(/\s+(?:of\s+)?[a-z][a-z'’-]*$/i, function (tail) { return counted ? tail : ''; }));
    var withMult = suffix && MULTIPLIER[suffix.toLowerCase()] ? numberValue(digits, m[3], suffix) : null;
    if (numberOk(value, g) || numberOk(withMult, g)) continue;
    if ((plus || suffix === '+') && (atLeastOk(value, g) || atLeastOk(withMult, g))) continue;
    add(cur ? 'money' : 'figure', shown);
  }
  re = new RegExp(CLAIM_RE.source, 'gi');
  while ((m = re.exec(words))) if (!phraseOk(m[0], g)) add('award', m[0]);
  re = new RegExp(PARTNER_RE.source, 'g');
  while ((m = re.exec(words))) if (!nameOk(m[1], g)) add('partner', m[1]);
  re = new RegExp(PIN_RE.source, 'gi');
  while ((m = re.exec(words))) if (!numberOk(numberValue(m[1].replace(/\s/g, '')), g)) add('address', m[1]);
  re = new RegExp(STREET_RE.source, 'g');
  while ((m = re.exec(words))) if (g.text.indexOf(norm(m[0])) === -1) add('address', m[0]);
  return out;
}

/* ---------- the check ---------- */
/* the sections not read: their ids, or "award-*" for every id that starts so */
function skipSet(opts) {
  var exact = {}, prefixes = [];
  (opts && opts.skipSections ? opts.skipSections : DEFAULT_SKIP).forEach(function (id) {
    id = String(id);
    if (id.charAt(id.length - 1) === '*') prefixes.push(id.slice(0, -1)); else exact[id] = 1;
  });
  return { has: function (id) { id = String(id || ''); return !!exact[id] || prefixes.some(function (p) { return id && id.indexOf(p) === 0; }); } };
}

function check(html, ground, kit, opts) {
  opts = opts || {};
  html = String(html == null ? '' : html);
  var g = ground || groundOf();
  var page = readPage(html, kit, skipSet(opts));
  var removed = [], flagged = [], edits = [];
  function note(list, kind, text, section) {
    if (!list.some(function (x) { return x.kind === kind && x.text === text && x.section === section; })) list.push({ kind: kind, text: text, section: section || '' });
  }
  page.runs.forEach(function (run) {
    claimsOfText(run.text, g).forEach(function (cl) {
      var fixable = opts.fix && (cl.kind === 'email' || cl.kind === 'phone');
      note(fixable ? removed : flagged, cl.kind, cl.text, run.section);
    });
    if (!opts.fix) return;
    /* the fix, in each piece of text as written (an address is never split between two tags) */
    run.parts.forEach(function (p) {
      if (p.i < 0) return;
      var raw = p.text, out = raw;
      out = out.replace(new RegExp(EMAIL_RE.source, 'gi'), function (e) { return emailOk(decode(e), g) ? e : PLACEHOLDER_EMAIL; });
      out = out.replace(new RegExp(PHONE_RE.source, 'g'), function (ph) { return looksLikePhone(decode(ph)) && !phoneOk(decode(ph), g) ? PLACEHOLDER_PHONE : ph; });
      if (out !== raw) { var t = page.s.tokens[p.i]; edits.push({ s: t.s, e: t.e, text: out }); }
    });
  });
  /* where links lead: another site nobody named, an e-mail or a phone number nobody supplied */
  page.links.forEach(function (l) {
    var href = decode(kit.attrValue(l.tag, 'href') || '').trim();
    var m;
    if ((m = /^mailto:([^?]+)/i.exec(href))) {
      var mail = m[1].trim();
      if (emailOk(mail, g)) return;
      note(opts.fix ? removed : flagged, 'email', mail, l.section);
      if (opts.fix) { kit.setAttr(l.tag, 'href', 'mailto:' + PLACEHOLDER_EMAIL); edits.push({ s: l.tag.s, e: l.tag.e, text: kit.writeTag(l.tag) }); }
      return;
    }
    if ((m = /^tel:(.+)$/i.exec(href))) {
      var tel = m[1].trim();
      if (phoneOk(tel, g)) return;
      note(opts.fix ? removed : flagged, 'phone', tel, l.section);
      if (opts.fix) { kit.setAttr(l.tag, 'href', 'tel:' + PLACEHOLDER_PHONE.replace(/\s/g, '')); edits.push({ s: l.tag.s, e: l.tag.e, text: kit.writeTag(l.tag) }); }
      return;
    }
    if (/^(?:https?:)?\/\//i.test(href) && !webOk(href.replace(/^\/\//, 'https://'), g)) note(flagged, 'web', href, l.section);
  });
  if (edits.length) {
    edits.sort(function (a, b) { return b.s - a.s; });
    var last = Infinity;
    edits.forEach(function (ed) {
      if (ed.e > last) return;                            // never two edits over one piece of the page
      html = html.slice(0, ed.s) + ed.text + html.slice(ed.e);
      last = ed.s;
    });
  }
  return { html: html, removed: removed, flagged: flagged };
}

function checkSections(sections, ground, kit, opts) {
  opts = opts || {};
  var skip = skipSet(opts), removed = [], flagged = [];
  var out = (sections || []).map(function (sec) {
    if (!sec || skip.has(sec.id)) return sec;
    /* a section's html is read as its own page, its id the section's */
    var r = check('<div data-rv-section="' + String(sec.id).replace(/"/g, '') + '">' + String(sec.html || '') + '</div>', ground, kit,
      { fix: opts.fix, skipSections: [] });
    r.removed.forEach(function (x) { removed.push(x); });
    r.flagged.forEach(function (x) { flagged.push(x); });
    var inner = r.html.replace(/^<div data-rv-section="[^"]*">/, '').replace(/<\/div>$/, '');
    return inner === String(sec.html || '') ? sec : Object.assign({}, sec, { html: inner });
  });
  return { sections: out, removed: removed, flagged: flagged };
}

function findings(html, ground, kit, opts) {
  var r = check(html, ground, kit, { skipSections: opts && opts.skipSections });
  var found = {}, order = [];
  r.flagged.concat(r.removed).forEach(function (x) {
    var key = x.kind + '|' + x.text.toLowerCase();
    if (!found[key]) { found[key] = { kind: x.kind, label: LABELS[x.kind] || x.kind, text: x.text, count: 0, sections: [], places: [] }; order.push(key); }
    var f = found[key], name = siteChecks.sectionName(x.section, kit && kit.names);
    f.count++;
    if (f.sections.indexOf(name) === -1) f.sections.push(name);
    if (x.section && !f.places.some(function (p) { return p.key === x.section; })) f.places.push({ key: x.section, section: name });
  });
  return order.map(function (k) { return found[k]; });
}

var PLURAL = { email: 'e-mail addresses', phone: 'phone numbers', web: 'web addresses', figure: 'figures', money: 'amounts',
  award: 'claims', partner: 'partners', address: 'addresses' };
function summary(r) {
  function part(list) {
    var by = {}, order = [];
    (list || []).forEach(function (x) { if (!by[x.kind]) order.push(x.kind); by[x.kind] = (by[x.kind] || 0) + 1; });
    return order.map(function (k) { return by[k] + ' ' + (by[k] === 1 ? LABELS[k] || k : PLURAL[k] || k); }).join(', ');
  }
  var a = part(r && r.removed), b = part(r && r.flagged);
  return [a ? 'removed ' + a : '', b ? 'flagged ' + b : ''].filter(Boolean).join('; ');
}

module.exports = {
  groundOf: groundOf, previousFacts: previousFacts, check: check, checkSections: checkSections, findings: findings, summary: summary,
  LABELS: LABELS, PLACEHOLDER_EMAIL: PLACEHOLDER_EMAIL, PLACEHOLDER_PHONE: PLACEHOLDER_PHONE
};
