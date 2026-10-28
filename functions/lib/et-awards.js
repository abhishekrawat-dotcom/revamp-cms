/* An ET award's own content, for an award microsite: what the award is, its categories and their fees, its
   jury, its partners, its FAQ — read from ET's public event API (the host et-events.js and et-previous.js read)
   asked with the portal as a header — and the plain text of the previous site's internal pages (its entry
   guidelines, judging criteria, terms, FAQ), which is INPUT for an AI rewrite later and never shown as-is.

   An award has TWO ids that are NOT interchangeable (et-events.js compactAward):
     awardId       the award itself (the award listing's entity_id; award/details and award/categories take it)
     micrositeId   the microsite that holds its content (the listing's event_id; microsite/details and the
                   speaker and sponsor lists take it). The previous-edition picker stores this one.
   microsite/details?digital_month_id=<awardId> answers with an unrelated event (the two id spaces overlap), so
   the pair is confirmed before anything is read by it: the microsite's own award_id, and the award listing's
   row for the microsite, must agree with each other and with an awardId the caller gave. Any disagreement,
   or neither able to speak, and the award is not identified (null).

   What ET's API gives (asked in October 2026 of ETCIO's and ET BrandEquity's awards):
     /v1/microsite/details?digital_month_id=<micrositeId>
        company_name, award_id, portal, event_start_date (the ceremony), event_venue, url_text, branding_url,
        company_description, faq [{ question, answer, status }], who_should_attend and why_join_us (JSON text
        of a list; ["NA"] is none), about_us { title, description } or null, seo { title, description },
        template_settings (JSON text: edition_txt "4th Edition", colours, fonts)
     /v1/award-listing?page=N   the portal's awards (et-events.js reads it too); a row carries what nothing
        else does reliably — nomination_start_date, nomination_end_date, complete_date, link
     /v1/award/details?award_id=<awardId>
        CAUTION: this ignores award_id and always answers with one award of the portal (ETCIO: 233, whatever
        is asked). It is used only when its id is the award's own.
     /v1/award/categories?award_id=<awardId>
        data.awardCategories { <slug>: { name, subcategory: { <slug>: { name, seoname, description, award_id,
        portal, status, weightage, is_new, price_type (1 paid, 0 not), price_type_label ('Paid', 'No Charges',
        'Derivative'), baseprice ('27000'), currency ('INR' or '') } } } }. Each subcategory names its award;
        one naming another award is left out (a later edition's list is often a copy of the last one's).
        A category itself has only a name: its description is '' and its fee is its subcategories' common fee.
     /v1/activity/speaker|sponsor/list?entity_id=<micrositeId>&activity=microsite&page=&per_page=500
        speakers in groups ('Grand Jury', 'Assessment Jury', 'Jury Members', 'Guest of Honour'…), ordered
        by speaker_weightage; sponsors in groups ('Knowledge Partner', 'Supporting Partners', 'Official
        Tabulator'…), ordered by weightage. status 0 is one the site does not show: left out here too.
     /v1/award/winners-list needs an ET sign-in: never asked.

   The internal pages, at <award link>/<page>: award-guidelines (or entry-guidelines), judging-criteria,
   award-tnc, award-faq (or faqs), award-category (or award-categories). ET's microsite engine draws each as
   a header section (<section id="page-hdr"> holding the page's <h2>, "Entry Guidelines", "Award T&C"…)
   followed by the content sections, up to the "back to top" button (floating-point-section-scrollTop);
   after it come the scripts, the forms' markup and the global footer with its "What's Happening" news, none
   of which is read. A page the site does not have still answers 200, with no header section: nothing is
   read from it. A page that blocks the reader (a 419-byte page) likewise yields nothing.

     readAward({ portal, awardId?, micrositeId }, { fetchJson, fetchText }) -> Promise<AWARD | null>
        fetchJson(url, headers) -> Promise<json>   may reject, or resolve null, for a bad answer
        fetchText(url, headers) -> Promise<string> the page's HTML (the caller bounds its time and size);
                                  optional: without it every page is null. Asked with a desktop Chrome
                                  User-Agent in headers: ET's pages block unknown readers on some portals.
     compactCategories(raw, awardId, portal) -> [CATEGORY]
     groupPeople(items)          -> { jury: [GROUP], guests: [GROUP] }
     groupPartners(items)        -> [{ group, items: [{ name, logo, url }] }]
     textPageFrom(html, heading) -> TEXTPAGE | null    heading: RegExp the page's own <h2> must match
     faqFromPage(textpage)       -> [{ q, a }] | null
     faqOf(list)                 -> [{ q, a }]         the microsite's own FAQ (details.faq)
     listOf(v)                   -> [string]           a JSON-text list as ET keeps it, "NA" dropped
     editionOf(templateSettings) -> '4th Edition' | ''
     siteBase(link)              -> 'https://cio.economictimes.indiatimes.com/enterprise-tech-award2025' | ''
     cleanText(v, max), decodeEntities(s), feeOf(sub), findListingRow(portal, fetchJson, micrositeId)

   AWARD = { portal, awardId, micrositeId, name, link, edition, venue, about,
             dates: { nominationOpen, nominationClose, ceremony }        'YYYY-MM-DD HH:MM:SS' or ''
             categories: [CATEGORY], jury: [GROUP], guests: [GROUP],
             partners: [{ group, items: [{ name, logo, url }] }],
             faq: [{ q, a }], whoShouldEnter: [string], whyEnter: [string], glimpses: [url] (the edition's photos),
             aboutVertical: { title, text }, seo: { title, description },
             pages: { guidelines: TEXTPAGE|null, judging: TEXTPAGE|null, tnc: TEXTPAGE|null,
                      faq: [{ q, a }]|null, categoriesNote: TEXTPAGE|null } }
   CATEGORY = { name, slug, description, isNew, fee: FEE, subcategories: [{ name, slug, description, isNew, fee }] }
   FEE      = { paid, amount, currency, label }   amount a number (0 when not paid; a category whose
              subcategories' fees differ is { paid: any paid, amount: 0, currency: '', label: 'Varies' })
   GROUP    = { group: 'Grand Jury', people: [{ name, title, company, photo, bio, linkedin }] }
   TEXTPAGE = { title, blocks: [{ heading, paragraphs: [string], bullets: [string] }] }

   Every string is plain text: tags stripped, entities decoded, whitespace collapsed, cut to a bound; e-mail
   addresses and phone numbers in free text become "[email]" / "[phone]" (a staffer's contact on the old site
   is not carried into a new one). Every address is https (http is upgraded), anything else is ''. Nothing a
   caller gives reaches ET's header or an address unchecked: the portal must be on et-events' roster and the
   ids digits; the pages are read only on an ET microsite host, by a slug of plain characters.
   Nothing here throws for a part that cannot be read: that part is empty (or null for a page). */

var etEvents = require('./et-events');
var etPrevious = require('./et-previous');

var API = etEvents.API;
var IMG = 'https://img.etb2bimg.com/files/';
var CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
var MAX = {
  categories: 40, subcategories: 80, allSubcategories: 400,
  groups: 12, people: 80, allPeople: 160, partners: 60,
  faq: 40, list: 24, listingPages: 40, listingConcurrency: 4, itemPages: 4,
  html: 2 * 1024 * 1024, region: 400000, blocks: 40, paragraphs: 40, bullets: 60, pageChars: 40000
};
var LEN = { name: 200, slug: 120, title: 300, company: 200, bio: 1200, description: 1200, q: 300, a: 3000,
  item: 160, heading: 200, paragraph: 2000, bullet: 800, group: 80, label: 40, edition: 40, about: 2000, seo: 400, venue: 200 };

/* ---------- plain text ---------- */
function str(v) { return v == null ? '' : typeof v === 'object' ? '' : String(v); }

var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sbquo: '‚', bdquo: '„', ndash: '–', mdash: '—', hellip: '…',
  bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»', times: '×', deg: '°',
  euro: '€', pound: '£', rarr: '→', larr: '←', shy: '', zwj: '', zwnj: '' };
/* every entity in one pass (so "&amp;lt;" is "&lt;", never "<"); an unknown name is left as written */
function decodeEntities(s) {
  return str(s).replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,9});/g, function (m, e) {
    if (e.charAt(0) === '#') {
      var n = /^#[xX]/.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(n > 0) || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF) || (n < 32 && n !== 9 && n !== 10) || (n >= 0x7F && n < 0xA0)) return ' ';
      return String.fromCodePoint(n);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : Object.prototype.hasOwnProperty.call(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : m;
  });
}
/* cut at a word near max, with an ellipsis */
function cut(s, max) {
  if (!max || s.length <= max) return s;
  var head = s.slice(0, max), at = head.lastIndexOf(' ');
  return (at > max * 0.6 ? head.slice(0, at) : head).replace(/[\s,;:.\-–—]+$/, '') + '…';
}
var DROP_BLOCKS = /<(script|style|noscript|svg|template|iframe|select|textarea|button|form)\b[\s\S]*?<\/\1\s*>/gi;
/* tags out: an inline one (a link, bold…) leaves nothing ("the <a>form</a>." is "the form."), any other a space */
var INLINE_TAG = /<\/?(?:a|abbr|b|code|del|em|font|i|ins|mark|s|small|span|strike|strong|sub|sup|u)\b[^>]*>/gi;
function untag(s) { return s.replace(INLINE_TAG, '').replace(/<[^>]*>/g, ' '); }
/* control characters, and the invisible ones (zero-width space, line and paragraph separators, BOM) */
var INVISIBLE = new RegExp('[\\x00-\\x08\\x0B-\\x1F\\x7F-\\x9F' + String.fromCharCode(0x200B, 0x2028, 0x2029, 0xFEFF) + ']', 'g');
/* one line of plain text: no tags (before and after decoding: "&lt;b&gt;" is not let through as a tag), no
   control characters, whitespace collapsed */
function line(v) {
  return decodeEntities(untag(str(v).replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(DROP_BLOCKS, ' ')))
    .replace(/<\/?[a-zA-Z!][^<>]*>/g, ' ').replace(INVISIBLE, ' ')
    .replace(/-->|<!--/g, ' ').replace(/\s+/g, ' ').replace(/ ([,;])/g, '$1').trim();
}
function cleanText(v, max) { return cut(line(v), max || LEN.paragraph); }
/* text that keeps its paragraphs, one a line (an FAQ answer, a biography) */
function cleanLines(v, max) {
  var t = str(v).slice(0, (max || LEN.a) * 8).replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(DROP_BLOCKS, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr)\s*>|<li\b[^>]*>/gi, '\n')
    .split(/\r?\n|\r/).map(line).filter(Boolean).join('\n');
  return cut(t, max || LEN.a);
}
/* a contact on the old site is never carried along: e-mail addresses, and runs of 10+ digits */
function redact(s) {
  return str(s).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\(?\d[\d\s().-]{8,}\d/g, function (m) { return (m.match(/\d/g) || []).length >= 10 ? '[phone]' : m; });
}

function https(u) {
  var s = str(u).trim();
  if (/^http:\/\//i.test(s)) s = 'https://' + s.slice(7);
  return /^https:\/\/[a-z0-9.-]+(?::\d{2,5})?(?:[\/?#][^\s"'<>\\]*)?$/i.test(s) && s.length <= 1000 ? s : '';
}
function idOf(v) { var s = str(v).trim(); return /^\d{1,9}$/.test(s) && +s > 0 ? String(+s) : ''; }
/* ET's dates: 'YYYY-MM-DD HH:MM:SS'; "0000-00-00" (and anything else) is no date */
function stamp(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(str(v).trim());
  if (!m || +m[1] < 1990 || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return '';
  return m[1] + '-' + m[2] + '-' + m[3] + ' ' + (m[4] || '00') + ':' + (m[5] || '00') + ':' + (m[6] || '00');
}
function slugOf(v) { return str(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LEN.slug); }
/* a file on ET's image host: an address, or a path under files/ (a sponsor's logo under files/retail_files/) */
function picture(path, sponsor) {
  var p = str(path).trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return https(p);
  p = p.replace(/^\/+/, '');
  if (!/^[A-Za-z0-9._\/ ()-]{1,300}$/.test(p) || /(^|\/)\.\.(\/|$)/.test(p)) return '';
  return IMG + (sponsor ? 'retail_files/' : '') + encodeURI(p);
}
function json(v, max) {
  if (v && typeof v === 'object') return v;
  var s = str(v);
  if (!s || s.length > (max || 100000)) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

/* a list as ET keeps it (an array, or the JSON text of one); ["NA"] is none */
function listOf(v) {
  var a = json(v, 50000), seen = {}, out = [];
  (Array.isArray(a) ? a : []).forEach(function (x) {
    var t = cleanText(x, LEN.item), k = t.toLowerCase();
    if (!t || /^(n\/?a|none|nil|-+|\.+)$/i.test(t) || seen[k] || out.length >= MAX.list) return;
    seen[k] = 1; out.push(t);
  });
  return out;
}
function editionOf(settings) {
  var s = json(settings, 50000);
  return s && typeof s === 'object' ? cleanText(s.edition_txt, LEN.edition) : '';
}
/* the microsite's own FAQ: shown questions with an answer, once each */
function faqOf(list) {
  var seen = {}, out = [];
  (Array.isArray(list) ? list : []).forEach(function (f) {
    if (!f || typeof f !== 'object' || str(f.status) === '0' || out.length >= MAX.faq) return;
    var q = cleanText(f.question, LEN.q), a = redact(cleanLines(f.answer, LEN.a));
    if (!q || !a || seen[q.toLowerCase()]) return;
    seen[q.toLowerCase()] = 1; out.push({ q: q, a: a });
  });
  return out;
}

/* ---------- categories ---------- */
function feeOf(s) {
  s = s || {};
  var amount = parseFloat(str(s.baseprice).replace(/[,\s]/g, ''));
  amount = isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
  var paid = str(s.price_type).trim() === '1' && amount > 0;
  var currency = str(s.currency).trim().toUpperCase();
  return { paid: paid, amount: paid ? amount : 0, currency: paid && /^[A-Z]{3}$/.test(currency) ? currency : '', label: cleanText(s.price_type_label, LEN.label) };
}
function sameFee(a, b) { return a.paid === b.paid && a.amount === b.amount && a.currency === b.currency; }
/* an object of { slug: entry } (or an array of entries) -> [{ key, v }], in ET's order; never mutated */
function entries(o) {
  var list = Array.isArray(o) ? o.map(function (v) { return { key: '', v: v }; })
    : o && typeof o === 'object' ? Object.keys(o).map(function (k) { return { key: k, v: o[k] }; }) : [];
  return list.filter(function (x) { return x.v && typeof x.v === 'object' && !Array.isArray(x.v); });
}
/* a category name as ET writes it, "Influencer Marketing(Industry Awards)", spaced */
function catName(v) { return cleanText(v, LEN.name).replace(/(\w)\(/g, '$1 ('); }
function weightOf(v) { var n = parseFloat(str(v)); return isFinite(n) ? n : 1e9; }

/* award/categories' data.awardCategories -> [CATEGORY]. awardId / portal given: a subcategory naming another
   award or portal is left out. A category none of whose subcategories is left is left out too. */
function compactCategories(raw, awardId, portal) {
  var total = 0, out = [];
  entries(raw && raw.awardCategories ? raw.awardCategories : raw).forEach(function (cx) {
    if (out.length >= MAX.categories) return;
    var c = cx.v, name = catName(c.name);
    var subs = entries(c.subcategory || c.subcategories).map(function (x, i) { return { s: x.v, key: x.key, i: i }; }).filter(function (x) {
      var s = x.s;
      if (str(s.status).trim() === '0') return false;
      if (awardId && s.award_id != null && str(s.award_id).trim() !== '' && idOf(s.award_id) !== String(awardId)) return false;
      if (portal && s.portal != null && str(s.portal).trim() !== '' && str(s.portal).trim().toLowerCase() !== portal) return false;
      return !!catName(s.name);
    }).sort(function (a, b) { return weightOf(a.s.weightage) - weightOf(b.s.weightage) || a.i - b.i; }).map(function (x) {
      var s = x.s;
      return { name: catName(s.name), slug: slugOf(s.seoname || x.key || s.name), description: redact(cleanText(s.description, LEN.description)),
        isNew: str(s.is_new).trim() === '1', fee: feeOf(s) };
    });
    subs = subs.slice(0, Math.min(MAX.subcategories, MAX.allSubcategories - total));
    if (!subs.length || !name) return;
    total += subs.length;
    var fee = subs.every(function (s) { return sameFee(s.fee, subs[0].fee); }) ? Object.assign({}, subs[0].fee, { label: subs[0].fee.label })
      : { paid: subs.some(function (s) { return s.fee.paid; }), amount: 0, currency: '', label: 'Varies' };
    out.push({ name: name, slug: slugOf(cx.key || c.name), description: redact(cleanText(c.description, LEN.description)),
      isNew: subs.every(function (s) { return s.isNew; }), fee: fee, subcategories: subs });
  });
  return out;
}

/* ---------- jury, guests, partners ---------- */
var JURY = /\bjur(?:y|ies|or|ors)\b|\bjudg/i;
var LINKEDIN_HOST = /^(?:[a-z]{2}\.)?linkedin\.com$/i;
/* a LinkedIn profile, without the tracking query ET's editors paste along (?lipi=urn…) */
function linkedinOf(v) { return etPrevious.profileLink(v, LINKEDIN_HOST).replace(/[?#].*$/, ''); }
function photoOf(s) {
  var p = picture(s.speaker_picture);
  if (p) return p;
  /* the large picture is usually the social-media post made of the speaker, not a portrait */
  return /social_post/i.test(str(s.speaker_picture_large)) ? '' : picture(s.speaker_picture_large);
}
/* speaker list items -> { jury, guests }: the shown ones, in weightage order, in their groups (in the order the
   groups first come); a group whose name says jury (Grand Jury, Assessment Jury, Jury Members) is jury */
function groupPeople(items) {
  var groups = [], by = {}, count = 0;
  (Array.isArray(items) ? items : []).map(function (s, i) { return { s: s, i: i }; }).filter(function (x) {
    return x.s && typeof x.s === 'object' && str(x.s.status).trim() !== '0' && cleanText(x.s.speaker_name, LEN.name);
  }).sort(function (a, b) { return weightOf(a.s.speaker_weightage) - weightOf(b.s.speaker_weightage) || a.i - b.i; }).forEach(function (x) {
    var s = x.s, gname = cleanText(s.group && s.group.group_name, LEN.group) || 'Speakers', key = gname.toLowerCase();
    var g = by[key];
    if (!g) {
      if (groups.length >= MAX.groups) return;
      g = by[key] = { group: gname, people: [], seen: {} };
      groups.push(g);
    }
    var name = cleanText(s.speaker_name, LEN.name);
    if (g.seen[name.toLowerCase()] || g.people.length >= MAX.people || count >= MAX.allPeople) return;
    g.seen[name.toLowerCase()] = 1; count++;
    g.people.push({ name: name, title: cleanText(s.speaker_desig, LEN.title), company: cleanText(s.speaker_company, LEN.company),
      photo: photoOf(s), bio: redact(cleanLines(s.speaker_info, LEN.bio)), linkedin: linkedinOf(s.linkedin_url) });
  });
  var out = { jury: [], guests: [] };
  groups.forEach(function (g) { (JURY.test(g.group) ? out.jury : out.guests).push({ group: g.group, people: g.people }); });
  return out;
}
/* sponsor list items -> [{ group, items }]: the shown ones with a logo or a name, in weightage order */
function groupPartners(items) {
  var groups = [], by = {}, count = 0;
  (Array.isArray(items) ? items : []).map(function (s, i) { return { s: s, i: i }; }).filter(function (x) {
    return x.s && typeof x.s === 'object' && str(x.s.status).trim() !== '0';
  }).sort(function (a, b) { return weightOf(a.s.weightage) - weightOf(b.s.weightage) || a.i - b.i; }).forEach(function (x) {
    var s = x.s, name = cleanText(s.sponsor_title, LEN.name), logo = picture(s.sponsor_logo || s.sponsor_log_png, true);
    if ((!name && !logo) || count >= MAX.partners) return;
    var gname = cleanText(s.group && s.group.group_name, LEN.group) || 'Partners', key = gname.toLowerCase();
    var g = by[key];
    if (!g) {
      if (groups.length >= MAX.groups) return;
      g = by[key] = { group: gname, items: [] };
      groups.push(g);
    }
    count++;
    g.items.push({ name: name, logo: logo, url: https(s.url) });
  });
  return groups;
}

/* ---------- an internal page's text ---------- */
var REGION_END = /floating-point-section-scrollTop|<footer\b|\bid\s*=\s*["']footer|What(?:&#0?39;|&rsquo;|'|’)s Happening|ms-formheading/i;
var HEADER = /<section\b[^>]*\bid\s*=\s*["']page-hdr["'][^>]*>/i;
/* The page's main content as blocks: each heading (h1–h6, or a table row of one cell) opens a block; list
   items are its bullets; every other run of text (a paragraph, a table row with its cells joined by " | ") is
   a paragraph. A line that is only a number ("Q1.", "2.") is the list's numbering: dropped. */
function blocksOf(region) {
  var h = region.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(DROP_BLOCKS, ' ').replace(/<(nav|header|aside)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<img\b[^>]*>/gi, ' ').replace(/-->|<!--/g, ' ')
    /* a line break in the source is only a space: the markup says where a line ends */
    .replace(/\s+/g, ' ');
  /* table rows first: a row of one cell is a heading, a row of more a paragraph */
  h = h.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, function (m, row) {
    var cells = [], re = /<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|$)/gi, c;
    while ((c = re.exec(row))) { var t = line(c[1]); if (t) cells.push(t); }
    if (!cells.length) return '\n';
    return cells.length === 1 ? '\n\u0001H' + cells[0] + '\n' : '\n' + cells.join(' | ') + '\n';
  });
  h = h.replace(/<h[1-6]\b[^>]*>/gi, '\n\u0001H').replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n\u0001L').replace(/<\/li\s*>/gi, '\n')
    .replace(/<br\s*\/?>|<\/?(?:p|div|section|ul|ol|dl|dt|dd|table|tbody|thead|blockquote)\b[^>]*>/gi, '\n');
  /* every other tag goes before the text is split into lines */
  h = untag(h);
  var blocks = [], cur = null, chars = 0;
  function block(heading) {
    if (blocks.length >= MAX.blocks) { cur = null; return; }
    cur = { heading: heading, paragraphs: [], bullets: [] };
    blocks.push(cur);
  }
  h.split('\n').forEach(function (raw) {
    var kind = raw.charAt(0) === '\u0001' ? raw.charAt(1) : '';
    var t = redact(line(kind ? raw.slice(2) : raw));
    if (!t || /^(?:Q|A|Step|S\.?\s?No)?\s*\d{0,3}\s*[.):]?$/i.test(t) || chars >= MAX.pageChars) return;
    if (kind === 'H') block(cut(t, LEN.heading));
    else {
      /* text before the first heading opens a block of its own; past MAX.blocks nothing more is kept */
      if (!cur) { if (blocks.length) return; block(''); }
      if (kind === 'L') { if (cur.bullets.length < MAX.bullets) cur.bullets.push(cut(t, LEN.bullet)); else return; }
      else if (cur.paragraphs.length < MAX.paragraphs) cur.paragraphs.push(cut(t, LEN.paragraph));
      else return;
    }
    chars += t.length;
  });
  /* a heading with nothing under it at the very end is a stray label */
  while (blocks.length && !blocks[blocks.length - 1].paragraphs.length && !blocks[blocks.length - 1].bullets.length) blocks.pop();
  return blocks;
}
/* html of one internal page -> TEXTPAGE, or null when it is not one: no header section (a page the site does
   not have, a block page), a header whose <h2> does not match heading, the home page, or no text under it */
function textPageFrom(html, heading) {
  var h = str(html).slice(0, MAX.html);
  if (/\bmicrosite_page_index\s*=\s*["']home["']/.test(h)) return null;
  var m = HEADER.exec(h);
  if (!m) return null;
  var close = h.indexOf('</section>', m.index);
  if (close === -1) return null;
  var head = h.slice(m.index, close), t = /<h[12]\b[^>]*>([\s\S]*?)<\/h[12]\s*>/i.exec(head);
  var title = t ? cut(line(t[1]), LEN.heading) : '';
  if (!title || (heading instanceof RegExp && !heading.test(title))) return null;
  var rest = h.slice(close + 10, close + 10 + MAX.region), end = rest.search(REGION_END);
  var region = end === -1 ? rest : rest.slice(0, end);
  /* the marker sits inside a tag (<div class="floating-point-…">): that tag's opening is not text */
  if (region.lastIndexOf('<') > region.lastIndexOf('>')) region = region.slice(0, region.lastIndexOf('<'));
  var blocks = blocksOf(region);
  return blocks.length ? { title: title, blocks: blocks } : null;
}
/* an FAQ page's blocks -> [{ q, a }]: each heading with text under it is a question ("Q1." taken off) */
function faqFromPage(page) {
  if (!page || !Array.isArray(page.blocks)) return null;
  var seen = {}, out = [];
  page.blocks.forEach(function (b) {
    var q = str(b.heading).replace(/^\s*Q(?:uestion)?\s*\d{0,3}\s*[.):-]\s*/i, '').trim();
    var a = b.paragraphs.concat(b.bullets.map(function (x) { return '• ' + x; })).join('\n')
      .replace(/^\s*A(?:ns(?:wer)?)?\s*[.):-]\s*/i, '');
    if (!q || !a || seen[q.toLowerCase()] || out.length >= MAX.faq) return;
    seen[q.toLowerCase()] = 1; out.push({ q: cut(q, LEN.q), a: cut(a, LEN.a) });
  });
  return out.length ? out : null;
}

/* The award's site, as the base of its internal pages: an ET microsite host (never www, api, img…) and one
   path segment of plain characters — anything else is '' and no page is read. */
function siteBase(link) {
  var u = https(link);
  var m = /^https:\/\/([a-z0-9-]{1,40}\.economictimes\.indiatimes\.com)\/([A-Za-z0-9][A-Za-z0-9_-]{0,150})\/?(?:[?#].*)?$/i.exec(u);
  if (!m || !etPrevious.portalOf(u)) return '';
  return 'https://' + m[1].toLowerCase() + '/' + m[2];
}
var PAGES = [
  { key: 'guidelines', paths: ['award-guidelines', 'entry-guidelines'], heading: /guideline|how to (?:enter|apply|nominate)/i },
  { key: 'judging', paths: ['judging-criteria'], heading: /judg|criteri|evaluat/i },
  { key: 'tnc', paths: ['award-tnc'], heading: /t\s*&\s*c|terms|condition/i },
  { key: 'faq', paths: ['award-faq', 'faqs'], heading: /faq|frequently/i, faq: true },
  { key: 'categoriesNote', paths: ['award-category', 'award-categories'], heading: /categor/i }
];
/* -> Promise<{ guidelines, judging, tnc, faq, categoriesNote }> (each null when it cannot be had) and the
   pages found, as .found = { key: path } */
function readPages(base, fetchText) {
  var out = { guidelines: null, judging: null, tnc: null, faq: null, categoriesNote: null };
  if (!base || typeof fetchText !== 'function') return Promise.resolve(out);
  return Promise.all(PAGES.map(function (p) {
    var i = 0;
    function next() {
      if (i >= p.paths.length) return null;
      var path = p.paths[i++];
      return Promise.resolve().then(function () { return fetchText(base + '/' + path, { 'user-agent': CHROME_UA, accept: 'text/html' }); })
        .then(function (html) {
          var page = typeof html === 'string' ? textPageFrom(html, p.heading) : null;
          var value = page && p.faq ? faqFromPage(page) : page;
          if (value) { out[p.key] = value; return null; }
          return next();
        }, function () { return next(); });
    }
    return next();
  })).then(function () { return out; });
}

/* ---------- ET's API ---------- */
function headersOf(portal) { return { portal: portal, accept: 'application/json' }; }
function dataOf(j) { return j && typeof j === 'object' && j.status !== false && j.data && typeof j.data === 'object' ? j.data : null; }
function ask(fetchJson, url, portal) {
  return Promise.resolve().then(function () { return fetchJson(url, headersOf(portal)); }).then(dataOf, function () { return null; });
}
/* every page of one activity list (500 to a page; never more than MAX.itemPages) */
function allItems(fetchJson, kind, id, portal) {
  var out = [];
  function page(n) {
    return ask(fetchJson, API + '/v1/activity/' + kind + '/list?entity_id=' + id + '&activity=microsite&page=' + n + '&per_page=500', portal).then(function (d) {
      if (!d) return out;
      out = out.concat(Array.isArray(d.items) ? d.items : []);
      return d.is_last_page || n >= (parseInt(d.total_pages, 10) || 1) || n >= MAX.itemPages ? out : page(n + 1);
    });
  }
  return page(1).then(null, function () { return out; });
}
/* The award listing's raw row for a microsite (it alone carries the nomination dates), with et-events'
   compact form of it (which vouches for its ids) — or null. Page 1 holds what is on and coming whole; the
   past is read a few pages at a time, newest first, up to MAX.listingPages, stopping once the row is found. */
function findListingRow(portal, fetchJson, micrositeId) {
  if (!etEvents.isPortal(portal) || typeof fetchJson !== 'function' || !idOf(micrositeId)) return Promise.resolve(null);
  var id = idOf(micrositeId);
  function look(rows, past) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], e = etEvents.compactAward(r, past);
      if (e && e.id === id) return { row: r, event: e };
    }
    return null;
  }
  function page(n) { return ask(fetchJson, API + '/v1/award-listing?page=' + n, portal); }
  return page(1).then(function (d) {
    if (!d) return null;
    var past = d.past && typeof d.past === 'object' ? d.past : {};
    var hit = look((Array.isArray(d.active) ? d.active : []).concat(Array.isArray(d.upcoming) ? d.upcoming : []), false)
      || look(Array.isArray(past.items) ? past.items : [], true);
    if (hit || past.is_last_page) return hit;
    var last = Math.min(MAX.listingPages, Math.max(1, parseInt(past.total_pages, 10) || 1)), n = 2;
    function batch() {
      if (n > last) return null;
      var todo = [];
      for (var k = 0; k < MAX.listingConcurrency && n <= last; k++) todo.push(page(n++));
      return Promise.all(todo).then(function (ds) {
        for (var j = 0; j < ds.length; j++) {
          var p = ds[j] && ds[j].past, found = p && Array.isArray(p.items) ? look(p.items, true) : null;
          if (found) return found;
        }
        return batch();
      });
    }
    return batch();
  }).then(null, function () { return null; });
}

/* ---------- the award ---------- */
function readAward(input, deps) {
  input = input || {}; deps = deps || {};
  var fetchJson = deps.fetchJson, fetchText = deps.fetchText;
  var portal = typeof input.portal === 'string' ? input.portal.trim() : '';
  var micrositeId = idOf(input.micrositeId);
  /* an awardId given must be one (digits); one not given is found */
  var hasGiven = input.awardId != null && input.awardId !== '', given = hasGiven ? idOf(input.awardId) : '';
  if (!etEvents.isPortal(portal) || !micrositeId || (hasGiven && !given) || typeof fetchJson !== 'function') return Promise.resolve(null);

  return Promise.all([
    ask(fetchJson, API + '/v1/microsite/details?digital_month_id=' + micrositeId, portal),
    findListingRow(portal, fetchJson, micrositeId)
  ]).then(function (r) {
    var d = r[0], listed = r[1], row = listed ? listed.row : null;
    /* the microsite must be this portal's (the API answers for other portals' too) and its own */
    if (d && ((d.portal && str(d.portal).trim().toLowerCase() !== portal) || (d.company_id != null && idOf(d.company_id) && idOf(d.company_id) !== micrositeId))) return null;
    /* the award: every source that speaks must agree, and one of the microsite and the listing must speak */
    var said = [];
    if (d && idOf(d.award_id)) said.push(idOf(d.award_id));
    if (listed) said.push(listed.event.awardId);
    if (!said.length) return null;
    if (given) said.push(given);
    var awardId = said[0];
    if (said.some(function (x) { return x !== awardId; })) return null;
    d = d || {};
    row = row || {};

    var link = https(row.link) || https(d.branding_url);
    var details = ask(fetchJson, API + '/v1/award/details?award_id=' + awardId, portal).then(function (a) {
      /* award/details answers with one award of the portal whatever is asked: only its own is used */
      return a && idOf(a.id) === awardId ? a : null;
    });
    var base = siteBase(link);
    var pages = (base ? Promise.resolve(base) : details.then(function (a) { link = link || https(a && a.url); return siteBase(link); }))
      .then(function (b) { return readPages(b, fetchText); }).then(null, function () { return readPages('', null); });

    return Promise.all([
      details,
      ask(fetchJson, API + '/v1/award/categories?award_id=' + awardId, portal),
      allItems(fetchJson, 'speaker', micrositeId, portal),
      allItems(fetchJson, 'sponsor', micrositeId, portal),
      pages,
      /* the edition's photo gallery (as an event's: et-previous.js photosOf) — the award site's stage panels and
         calls to act stand on these real photos */
      allItems(fetchJson, 'image', micrositeId, portal)
    ]).then(function (all) {
      var a = all[0] || {}, people = groupPeople(all[2]);
      var about = d.about_us && typeof d.about_us === 'object' ? d.about_us : {};
      var seo = d.seo && typeof d.seo === 'object' ? d.seo : {};
      return {
        portal: portal, awardId: awardId, micrositeId: micrositeId,
        name: cleanText(row.title || a.name || d.company_name, LEN.name),
        link: link || https(a.url),
        edition: editionOf(d.template_settings),
        venue: cleanText(d.event_venue || row.address, LEN.venue),
        about: redact(cleanLines(d.company_description || d.synopsis || row.desc, LEN.about)),
        dates: {
          nominationOpen: stamp(row.nomination_start_date) || stamp(a.nomination_date),
          nominationClose: stamp(row.nomination_end_date) || stamp(row.last_submission_datetime) || stamp(a.nomination_end_date),
          ceremony: stamp(d.event_start_date) || stamp(a.start_date) || stamp(row.complete_date)
        },
        categories: compactCategories(all[1], awardId, portal),
        jury: people.jury, guests: people.guests,
        partners: groupPartners(all[3]),
        faq: faqOf(d.faq),
        whoShouldEnter: listOf(d.who_should_attend),
        whyEnter: listOf(d.why_join_us),
        aboutVertical: { title: cleanText(about.title, LEN.name), text: redact(cleanLines(about.description, LEN.about)) },
        seo: { title: cleanText(seo.title || d.page_title, LEN.seo), description: cleanText(seo.description || d.page_description, LEN.seo * 2) },
        pages: all[4],
        glimpses: etPrevious.photosOf(all[5])
      };
    });
  }).then(null, function () { return null; });
}

module.exports = {
  readAward, compactCategories, groupPeople, groupPartners, textPageFrom, faqFromPage, faqOf, listOf, editionOf,
  siteBase, cleanText, decodeEntities, feeOf, findListingRow, readPages, PAGES, API, CHROME_UA, MAX
};
