/* What would be wrong to put live, read off a page — and the repairs every live page gets on its way out.

   WHY (the UX sweep of 3 Nov 2026, UX-140 to UX-145). Six sites were live. One was a template nobody had filled in
   ("Event name goes here", "Question goes here?") that took registrations and was in the sitemap; one was a test
   ("test event 5"). Most "Register Now" buttons of the older AI sites jumped to a section instead of opening the
   form, and "Join as Partner" pointed at a section that was hidden, so nothing happened. The imported award sites
   sent "Nominate" to /nominate on this host (the CMS sign-in page), and kept a menu button, a film and a chat
   bubble that could not work outside Lovable. A picture's address had a typo, an award ceremony's button said
   "Get Tickets" with no tickets to sell, and the older sites' header and footer showed last year's boxed logo.
   Nothing told the owner or the approver. This file reads a page for all of that; lib/api.js uses it

     - before anything goes live (publishing, asking for approval, approving): what blocks, what to know;
     - on every live page as it is served and published (repair): the buttons put right, the dead ones hidden,
       what an import brought that cannot work taken out — the saved page is never changed by this;
     - for search engines: a test, a template still unfilled, or a site its owner keeps out (settings.seo.noindex)
       is never listed (noindexReason, robots), while it stays live for anyone with the link.

   kit: lib/api.js's tokenizer (TOKEN_KIT: tokenizeHtml, attrOf, attrValue, classListOf, writeTag, setAttr,
   dropAttr) — the same rules as the publish transform: whole tags it has matched, text it writes itself, every
   other byte as it was. Everything here is idempotent: running it on its own output changes nothing.

     inspect(html, kit)                 -> { placeholders, links, payment, logos, etNav, etFooter, generated, imported }
     placeholderHits(html, kit)         -> [{ text, count, sections, places, strong }]   template text a visitor would read
                                          (places: [{ key, section }], the sections it is in, for a link to each)
     recordPlaceholders(siteData)       -> [{ kind, label, items: [text] }]        sample entries in Content
     looksLikeTest(event)               -> bool   an event named as a test ("test event 5", "… (test)")
     noindexReason(event, html, kit)    -> 'owner' | 'test' | 'template' | ''
     robots(html, kit, noindex)         -> html   the live page's robots meta, noindex when told so
     repair(html, kit, opts)            -> { html, changes: [{ what, label, section, how }] }
        opts = { eventId, homeHref ('/e/<id>'; false leaves a home link alone), portal (an et-footer slug or ''),
                 forms (the public forms payload, when known), imported (true for a page's body at import) }
     samplesOf(html, kit)               -> { texts, srcs }   what a template marks as a sample of its design (data-rv-sample:
                                          another event's quotes, people, logos), its quotes and its pictures (never a
                                          role or a company, which the owner's own cards can share)
     sampleHits(html, kit, samples)     -> [{ text, picture, count, sections, places }]   those still shown on a page, by content: a
                                          card the owner rewrote no longer counts
     storageRefs(html)                  -> [{ url, bucket, path }]   every picture of storage.googleapis.com
     nearBucket(a, b)                   -> bool   a bucket name one or two letters away from ours (a typo)
     yearsIn(text)                      -> [2026, …]
     sectionName(id)                    -> 'Key discussion points'
   No network, no Firebase: see site-checks.test.js. */
'use strict';

var etFooter = require('./et-footer');
var forms = require('./forms');

/* ---------- the words a button says ---------- */
/* opens the registration form */
var REGISTER_RE = /^(?:register|registration|sign\s*up|express\s+(?:your\s+)?interest|book\s+(?:your\s+|a\s+)?(?:seat|pass|place|spot)s?|reserve\s+(?:your\s+|a\s+)?(?:seat|spot|place)s?|request\s+(?:an?\s+)?invit(?:e|ation))\b/i;
/* a nomination of an award (an imported award site's "Nominate", "Start a Nomination") */
var NOMINATE_RE = /^(?:nominate|start\s+(?:a|your)\s+nomination|submit\s+(?:a|your)\s+nomination|apply\s+now|enter\s+now)\b/i;
/* a partner or sponsor enquiry ("Join as Partner", "Become a sponsor", "Partner with us") — never a way to the
   sponsors list ("Our Partners", "View sponsors") */
var PARTNER_RE = /^(?:(?:join|become|partner|sponsor|exhibit|apply)\b[\w\s]*\b(?:partner|sponsor|exhibitor)s?|(?:partner|sponsor|exhibit)\s+with\s+us|(?:partnership|sponsorship)(?:\s+(?:enquir\w*|inquir\w*|opportunit\w*))?|(?:enquire|inquire)\s+(?:about\s+)?(?:partnering|partnership|sponsorship))$/i;
/* what a site that takes no payment must not promise (payment is not part of this release) */
var PAYMENT_RE = /\b(?:tickets?|buy|purchase|pay(?:ment)?|checkout|book\s+(?:now|tickets?))\b/i;
var LEGAL = [
  { re: /^privacy(?:\s+policy)?$/i, key: 'privacy' },
  { re: /^terms(?:\s+(?:of\s+(?:use|entry|service)|(?:&|and)\s+conditions))?$|^t\s*&\s*c$/i, key: 'terms' },
  { re: /^cookie(?:s)?(?:\s+(?:policy|preferences|settings))?$/i, key: 'cookies' }
];
var SOCIAL_RE = /\b(linkedin|twitter|x\.com|facebook|youtube|instagram)\b|^x$/i;

/* The forms' own words for the three kinds of enquiry a button can open (rv-forms.js reads them off the button
   that opened the form: data-rv-form-title, data-rv-form-note, data-rv-form-source). They live with the forms
   (lib/forms.js ENQUIRIES), where POST /api/register reads the source back: such a response is recorded as a
   request for the ET team, never as a registration, and the visitor is thanked for what they asked. */
var ENQUIRY = forms.ENQUIRIES;

/* ---------- template text ----------
   The words the templates and the AI write where the owner's own go (templates/_library/sections, the award
   pages' FAQ model, the AI's "unmistakable placeholders" — lib/api.js's section prompt). Matched on a whole piece
   of text, so "Section heading" in a sentence is not one. strong: the page is still the template itself. */
var PLACEHOLDER_TEXTS = {
  'event name goes here': 1,
  'a short line that sums up why this event matters.': 1,
  '© event name. all rights reserved.': 1,
  'section heading': 1,
  'city, venue': 0,
  'question goes here?': 0,
  'question goes here': 0,
  'answer goes here.': 0,
  'a short answer explaining the detail behind this question.': 0,
  'session title goes here': 0,
  'card title': 0,
  'chip title': 0,
  'a line or two of supporting copy for this point.': 0,
  'one short line on why this belongs here.': 0,
  'a short paragraph of supporting copy that explains what this section is about, written so it reads naturally at any length.': 0,
  'a short closing line that makes the case for one last click.': 0,
  'speaker name': 0,
  'role / title': 0,
  'role, company': 0,
  'partner name': 0,
  'sponsor name': 0,
  'contact name': 0,
  '00:00 am': 0,
  '00:00 pm': 0,
  '00:00': 0
};
var PLACEHOLDER_RES = [
  /\bgoes here\b/i,
  /^(?:sponsor|partner)\s*\d{1,2}$/i,
  /\blorem ipsum\b/i,
  /\bname@example\.com\b/i,
  /\+00 00000 00000/
];
function placeholderOf(text) {
  var k = text.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PLACEHOLDER_TEXTS, k)) return { strong: PLACEHOLDER_TEXTS[k] === 1 };
  for (var i = 0; i < PLACEHOLDER_RES.length; i++) if (PLACEHOLDER_RES[i].test(text)) return { strong: false };
  return null;
}

/* ---------- reading the page ---------- */
var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
/* nothing a visitor reads as the page's words */
var SKIP = { head: 1, script: 1, style: 1, template: 1, noscript: 1, title: 1, textarea: 1, svg: 1, select: 1, iframe: 1, object: 1 };
/* the marks of something not shown on a live page (rv-live.css, the editor's own, a hidden attribute) */
var HIDDEN_MARKS = ['hidden', 'data-rv-empty', 'data-rv-hidden-empty', 'data-rv-bind-empty', 'data-rv-nav-empty', 'data-rv-editor',
  'data-rv-empty-state', 'data-rv-preview-ribbon', 'data-rv-removed'];
var SHOWN_AT_SOME_WIDTH = /^(?:sm|md|lg|xl|2xl):(?:block|flex|grid|inline|inline-block|inline-flex|table|contents|flow-root)$/;

function decode(s) {
  return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|rarr|larr|times|copy|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo);/gi, function (m, e) {
    var k = e.toLowerCase();
    var named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', rarr: '→', larr: '←', times: '×', copy: '©', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
    if (named[k] != null) return named[k];
    var n = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; } catch (err) { return m; }
  });
}
function clean(s) { return decode(s).replace(/[\s ]+/g, ' ').trim(); }
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function isHiddenTag(t, kit) {
  for (var i = 0; i < HIDDEN_MARKS.length; i++) if (kit.attrOf(t, HIDDEN_MARKS[i])) return true;
  var style = String(kit.attrValue(t, 'style') || '');
  if (/(?:^|;)\s*display\s*:\s*none\b/i.test(decode(style))) return true;
  var cls = kit.classListOf(t);
  if (cls.indexOf('is-hidden-sec') !== -1) return true;
  /* Tailwind's "hidden" (an imported page) hides it everywhere unless another class shows it at some width */
  if (cls.indexOf('hidden') !== -1 && !cls.some(function (c) { return SHOWN_AT_SOME_WIDTH.test(c); })) return true;
  if (kit.attrValue(t, 'id') === 'revamp-register-modal') return true;     // the old library footer's own pop-up, shut
  return false;
}

/* the token that ends each element: one pass with a stack (a browser-serialised page closes every element) */
function matchEnds(tokens) {
  var ends = new Array(tokens.length), stack = [];
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t === 'open') {
      if (VOID[t.name] || t.selfClosing) ends[i] = i;
      else stack.push(i);
    } else if (t.t === 'close') {
      var k = stack.length - 1;
      while (k >= 0 && tokens[stack[k]].name !== t.name) k--;
      if (k < 0) continue;                                  // a stray end tag
      while (stack.length > k) ends[stack.pop()] = i;       // and whatever was left open inside it ends here too
    }
  }
  while (stack.length) ends[stack.pop()] = tokens.length - 1;
  return ends;
}

/* every token with what it stands in: { hidden, skip, section, key, chrome ('nav' | 'footer' | ''), end } */
function scan(html, kit) {
  var tokens = kit.tokenizeHtml(html), ends = matchEnds(tokens), A = kit.attrValue;
  var root = { hidden: false, skip: false, section: '', key: '', chrome: '', end: tokens.length, form: false };
  var ctx = new Array(tokens.length), stack = [root], ids = {};
  for (var i = 0; i < tokens.length; i++) {
    while (stack.length > 1 && i > stack[stack.length - 1].end) stack.pop();
    var cur = stack[stack.length - 1], t = tokens[i];
    if (t.t !== 'open') { ctx[i] = cur; continue; }
    /* a section: its data-rv-section, or on a page saved before those marks, the id of a top-level block */
    var sec = A(t, 'data-rv-section') || (!cur.section && /^(?:section|header|footer)$/.test(t.name) ? A(t, 'id') : null);
    var chrome = cur.chrome;
    if (!chrome && (t.name === 'footer' || sec === 'footer')) chrome = 'footer';
    else if (!chrome && (t.name === 'header' || t.name === 'nav' || sec === 'nav')) chrome = 'nav';
    var node = {
      hidden: cur.hidden || isHiddenTag(t, kit), skip: cur.skip || !!SKIP[t.name],
      section: sec || cur.section, chrome: chrome, end: ends[i], page: cur.page || A(t, 'data-rv-page') != null,
      /* the name the site editor finds the section by (its data-rv-key, else its id): a link to fix something there */
      key: sec ? String(A(t, 'data-rv-key') || sec) : cur.key,
      form: cur.form || t.name === 'form'
    };
    ctx[i] = node;
    var id = A(t, 'id');
    if (id && !node.skip && !Object.prototype.hasOwnProperty.call(ids, id)) ids[id] = { i: i, node: node };
    if (ends[i] > i) stack.push(node);
  }
  return { tokens: tokens, ends: ends, ctx: ctx, ids: ids, html: html };
}

/* the words inside an element (its text, else its label, else a picture's alt) */
function labelOf(s, i, kit) {
  var parts = [], t = s.tokens[i], skipTo = -1;
  for (var k = i + 1; k < s.ends[i]; k++) {
    if (k <= skipTo) continue;
    var x = s.tokens[k];
    if (x.t === 'open' && (SKIP[x.name] || isHiddenTag(x, kit))) { skipTo = s.ends[k]; continue; }
    if (x.t === 'text') parts.push(s.html.slice(x.s, x.e));
  }
  var text = clean(parts.join(' '));
  if (text) return text;
  text = clean(kit.attrValue(t, 'aria-label') || kit.attrValue(t, 'title') || '');
  if (text) return text;
  for (k = i + 1; k < s.ends[i]; k++) {
    if (s.tokens[k].t === 'open' && s.tokens[k].name === 'img') { text = clean(kit.attrValue(s.tokens[k], 'alt') || ''); if (text) return text; }
  }
  return '';
}

/* where something is, for the owner: its section's name, else the header or footer it is in (an imported page
   has no sections of its own: all of it is "Page") */
function placeOf(c) {
  var name = sectionName(c.section);
  return name === 'Page' && c.chrome ? (c.chrome === 'footer' ? 'Footer' : 'Header') : name;
}

function sectionName(id) {
  id = String(id || '');
  if (!id) return 'Page';
  if (id === 'nav') return 'Header';
  if (id === 'footer') return 'Footer';
  if (id === 'hero') return 'Banner';
  if (id === 'imported') return 'Page';
  var s = id.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* a link that looks like a button (its class says so), as opposed to words linked inside a sentence */
function buttonish(t, kit) {
  return t.name === 'button' || kit.attrOf(t, 'role') && kit.attrValue(t, 'role') === 'button' ||
    kit.classListOf(t).some(function (c) { return /btn|button|cta/i.test(c); });
}

/* where a link leads: 'form' (opens a form), 'ok', 'missing' / 'hidden' (an in-page target that is not there or
   not shown), 'empty' ("#", "", javascript:), 'path' (an address on this host that is no page of the site) */
var OWN_PATHS = /^\/(?:e|preview|templates|assets|api\/public)\//;
function stateOf(s, i, kit) {
  var t = s.tokens[i], A = kit.attrValue;
  if (kit.attrOf(t, 'data-register-cta') || kit.attrOf(t, 'data-rv-form') || kit.attrOf(t, 'data-rv-page-link') || kit.attrOf(t, 'data-rv-award-cta')) return { state: 'form' };
  if (t.name !== 'a') return { state: 'ok' };
  var href = decode(A(t, 'href') == null ? '' : A(t, 'href')).trim();
  if (A(t, 'href') == null) return { state: 'none', href: '' };
  if (href === '' || href === '#' || /^javascript:/i.test(href)) return { state: 'empty', href: href };
  if (href.charAt(0) === '#') {
    var id = href.slice(1);
    try { id = decodeURIComponent(id); } catch (e) { /* as written */ }
    /* what the forms runtime opens, and the top of the page the browser goes to */
    if (id === 'register' || /^rv-form-[a-z][a-z0-9-]{0,39}$/.test(id)) return { state: 'form', href: href };
    if (id === 'top') return { state: 'ok', href: href };
    var hit = Object.prototype.hasOwnProperty.call(s.ids, id) ? s.ids[id] : null;
    if (!hit) return { state: 'missing', href: href, target: id };
    if (hit.node.page) return { state: 'ok', href: href, target: id };       // an internal page's section (rv-pages.js)
    if (hit.node.hidden) return { state: 'hidden', href: href, target: id, targetI: hit.i };
    return { state: 'ok', href: href, target: id, targetI: hit.i };
  }
  if (href.charAt(0) === '/' && href.charAt(1) !== '/' && !OWN_PATHS.test(href) && href !== '/') return { state: 'path', href: href };
  if (href === '/') return { state: 'path', href: href };
  return { state: 'ok', href: href };
}

function kindOf(label) {
  if (REGISTER_RE.test(label)) return 'register';
  if (NOMINATE_RE.test(label)) return 'nominate';
  if (PARTNER_RE.test(label)) return 'partner';
  for (var i = 0; i < LEGAL.length; i++) if (LEGAL[i].re.test(label)) return 'legal:' + LEGAL[i].key;
  if (SOCIAL_RE.test(label)) return 'social';
  return 'other';
}

/* the visible links and buttons of a page, each with what it says and where it leads */
function linksOf(s, kit) {
  var out = [];
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i];
    if (t.t !== 'open' || (t.name !== 'a' && t.name !== 'button')) continue;
    var c = s.ctx[i];
    /* not shown, or a page's own form's buttons (its submit is that form's) */
    if (c.skip || c.hidden || c.form) continue;
    var label = labelOf(s, i, kit);
    var st = stateOf(s, i, kit);
    out.push({ i: i, tag: t.name, label: label, kind: kindOf(label), state: st.state, href: st.href || '', target: st.target || '', targetI: st.targetI,
      section: c.section, key: c.key, chrome: c.chrome, buttonish: buttonish(t, kit) });
  }
  return out;
}

/* the sections something was found in, for a link to each in the site editor: [{ key, section }] once each */
function addPlace(list, key, name) {
  if (key && !list.some(function (p) { return p.key === key; })) list.push({ key: key, section: name });
}

/* ---------- placeholders on the page ---------- */
function placeholderHits(html, kit) {
  var s = typeof html === 'string' ? scan(html, kit) : html;
  var found = {}, order = [];
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i];
    if (t.t !== 'text') continue;
    var c = s.ctx[i];
    if (c.skip || c.hidden) continue;
    var text = clean(s.html.slice(t.s, t.e));
    if (!text || text.length > 160) continue;
    var hit = placeholderOf(text);
    if (!hit) continue;
    var key = text.toLowerCase();
    if (!found[key]) { found[key] = { text: text, count: 0, sections: [], places: [], strong: hit.strong }; order.push(key); }
    found[key].count++;
    var name = sectionName(c.section);
    if (found[key].sections.indexOf(name) === -1) found[key].sections.push(name);
    addPlace(found[key].places, c.key, name);
  }
  return order.map(function (k) { return found[k]; });
}

/* ---------- a template's samples of its design (data-rv-sample) ----------
   What a sample is known by: its quote (the words of a <p>, <blockquote> or <q> of it, outside the caption that
   names the person) and its picture. Never the person's role or company: "Chief Marketing Officer", "Executive
   Director" or "Tata AIA Life Insurance" are as likely on the owner's own cards, which the wizard fills from the
   event's insights, and a real CMO's quote held a whole site back (3 Nov 2026). Nor the name alone: the same person
   can speak again, with new words. */
var SAMPLE_WORDS_MIN = 30;
function samplesOf(html, kit) {
  var s = typeof html === 'string' ? scan(html, kit) : html, texts = [], srcs = [];
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i];
    if (t.t !== 'open' || !kit.attrOf(t, 'data-rv-sample')) continue;
    for (var k = i; k <= s.ends[i]; k++) {
      var x = s.tokens[k];
      if (x.t === 'open' && (x.name === 'figcaption' || x.name === 'cite')) { k = s.ends[k]; continue; }
      if (x.t === 'open' && /^(?:p|blockquote|q)$/.test(x.name)) {
        var words = labelOf(s, k, kit);
        if (words.length >= SAMPLE_WORDS_MIN && texts.indexOf(words) === -1) texts.push(words);
        k = s.ends[k];
        continue;
      }
      if (x.t === 'open' && x.name === 'img') { var src = decode(kit.attrValue(x, 'src') || '').trim(); if (src && srcs.indexOf(src) === -1) srcs.push(src); }
    }
    i = s.ends[i];
  }
  return { texts: texts, srcs: srcs };
}
function sampleHits(html, kit, samples) {
  if (!samples || (!samples.texts.length && !samples.srcs.length)) return [];
  var s = typeof html === 'string' ? scan(html, kit) : html, found = {}, order = [];
  function add(key, text, section, picture, sectionKey) {
    if (!found[key]) { found[key] = { text: text, picture: !!picture, count: 0, sections: [], places: [] }; order.push(key); }
    found[key].count++;
    var name = sectionName(section);
    if (found[key].sections.indexOf(name) === -1) found[key].sections.push(name);
    addPlace(found[key].places, sectionKey, name);
  }
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i], c = s.ctx[i];
    if (c.skip || c.hidden) continue;
    /* a quote, read whole as samplesOf reads it */
    if (t.t === 'open' && /^(?:p|blockquote|q)$/.test(t.name)) {
      var words = labelOf(s, i, kit);
      if (words.length >= SAMPLE_WORDS_MIN && samples.texts.indexOf(words) !== -1) { add('t:' + words, words, c.section, false, c.key); i = s.ends[i]; }
    } else if (t.t === 'open' && t.name === 'img') {
      var src = decode(kit.attrValue(t, 'src') || '').trim();
      if (src && samples.srcs.indexOf(src) !== -1) add('p:' + src, src.replace(/[?#].*$/, '').split('/').pop(), c.section, true, c.key);
    }
  }
  return order.map(function (k) { return found[k]; });
}

/* ---------- sample entries in the event's records (Content › Sponsors, Speakers, FAQ, Agenda) ---------- */
var RECORD_KINDS = [
  { key: 'partners', label: 'Content › Sponsors', field: function (r) { return r.name; } },
  { key: 'speakers', label: 'Content › Speakers', field: function (r) { return r.name; } },
  { key: 'faqs', label: 'Content › FAQ', field: function (r) { return r.question || r.q || r.t; } },
  { key: 'sessions', label: 'Content › Agenda', field: function (r) { return r.title; } },
  { key: 'contacts', label: 'Content › Contact', field: function (r) { return [r.name, r.email, r.phone].filter(Boolean).join(' '); } }
];
function recordPlaceholders(siteData) {
  var out = [];
  RECORD_KINDS.forEach(function (k) {
    var items = [];
    (Array.isArray(siteData && siteData[k.key]) ? siteData[k.key] : []).forEach(function (r) {
      var text = clean(r && k.field(r) || '');
      if (text && (placeholderOf(text) || /\bname@example\.com\b|\+00 00000 00000/i.test(text))) items.push(text);
    });
    if (items.length) out.push({ kind: k.key, label: k.label, items: items });
  });
  return out;
}

/* ---------- search engines ---------- */
/* A name that is only a test's label ("test event 5", "Test", "QA run 3", "demo site") or says it is one ("Agentic
   Summit (test)", "… test copy"). Not any name that starts with such a word: "QA Summit", "Demo Day" and "Testing
   Leaders Forum" can be real events. */
var TEST_LABEL = /^(?:test|testing|qa|demo|dummy|sample|trial)(?:[\s_-]+(?:event|site|page|run|copy|microsite))?(?:[\s_#-]*\d+)?$/i;
var TEST_SAID = /[(\[]\s*(?:test|testing|dummy|qa)\s*[)\]]|\btest\s+(?:event|site|copy|page)\b|[-–—]\s*test$/i;
function looksLikeTest(event) {
  var name = clean(event && event.name || '');
  return !!name && (TEST_LABEL.test(name) || TEST_SAID.test(name));
}
function noindexReason(event, html, kit) {
  var seo = event && event.settings && event.settings.seo;
  if (seo && seo.noindex === true) return 'owner';
  if (looksLikeTest(event)) return 'test';
  if (html && placeholderHits(html, kit).some(function (h) { return h.strong; })) return 'template';
  return '';
}
/* the robots meta of a live page (site-a11y.js writes "index, follow, max-image-preview:large", data-rv-seo) set to
   noindex — and back, when told so; nothing else is touched */
var NOINDEX = 'noindex, nofollow';
function robots(html, kit, noindex) {
  var tokens = kit.tokenizeHtml(html), out = null;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t !== 'open' || t.name !== 'meta' || String(kit.attrValue(t, 'name') || '').toLowerCase() !== 'robots' || !kit.attrOf(t, 'data-rv-seo')) continue;
    var now = String(kit.attrValue(t, 'content') || '');
    var want = noindex ? NOINDEX : (kit.attrOf(t, 'data-rv-noindex') ? 'index, follow, max-image-preview:large' : now);
    if (want === now && !!kit.attrOf(t, 'data-rv-noindex') === !!noindex) continue;
    kit.setAttr(t, 'content', want);
    if (noindex) kit.setAttr(t, 'data-rv-noindex', ''); else kit.dropAttr(t, 'data-rv-noindex');
    out = out || tokens.map(function (x) { return html.slice(x.s, x.e); });
    out[i] = kit.writeTag(t);
  }
  return out ? out.join('') : html;
}
function isNoindexPage(html) { return /<meta\b[^>]*\bname="robots"[^>]*\bcontent="noindex\b/i.test(String(html || '')); }

/* ---------- pictures ---------- */
function storageRefs(html) {
  /* a style attribute writes its url()'s quotes as &quot; */
  var text = String(html || '').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'");
  var out = [], seen = {}, re = /(?:https?:)?\/\/storage\.googleapis\.com\/([a-z0-9][a-z0-9._-]{1,220})\/([^"'\s)<>?#]+)/gi, m;
  while ((m = re.exec(text))) {
    var url = m[0].replace(/^\/\//, 'https://');
    if (seen[url]) continue;
    seen[url] = 1;
    var path = m[2];
    try { path = decodeURIComponent(path); } catch (e) { /* as written */ }
    out.push({ url: url, bucket: m[1].toLowerCase(), path: path });
  }
  return out;
}
/* A bucket name that reads as a mistyping of ours: a few letters apart (Levenshtein, at most 3), or ours with its
   ending garbled ("revamp-cms.firebaneapp" for "revamp-cms.firebasestorage.app": the project's name is the same).
   Only the wording of a picture already found broken: whether it is broken is asked of storage itself. */
function nearBucket(a, b) {
  a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase();
  if (!a || !b || a === b) return false;
  if (a.split('.')[0] === b.split('.')[0]) return true;
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= 3;
}

/* ---------- years ---------- */
function yearsIn(text) {
  var out = [], re = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/g, m;
  while ((m = re.exec(String(text || '')))) { var y = +m[1]; if (out.indexOf(y) === -1) out.push(y); }
  return out;
}

/* ---------- everything a check needs, in one reading ---------- */
function inspect(html, kit) {
  var s = scan(String(html == null ? '' : html), kit), A = kit.attrValue;
  var bodyTag = null;
  for (var i = 0; i < s.tokens.length; i++) if (s.tokens[i].t === 'open' && s.tokens[i].name === 'body') { bodyTag = s.tokens[i]; break; }
  var template = bodyTag ? String(A(bodyTag, 'data-rv-template-id') || '') : '';
  var links = linksOf(s, kit);
  var logos = [], etNav = false, etFooterOn = false, hasNav = false, hasFooter = false;
  for (i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i];
    if (t.t !== 'open') continue;
    var sec = A(t, 'data-rv-section');
    if (sec === 'nav') { hasNav = true; if (kit.attrOf(t, 'data-rv-etnav')) etNav = true; }
    if (sec === 'footer') { hasFooter = true; if (kit.attrOf(t, 'data-rv-et-footer')) etFooterOn = true; }
    var c = s.ctx[i];
    if (t.name === 'img' && c.chrome && !c.skip && kit.attrOf(t, 'data-rv-logo')) {
      logos.push({ where: c.chrome, src: decode(A(t, 'src') || ''), alt: clean(A(t, 'alt') || '') });
    }
  }
  return {
    generated: /^gen-/.test(template) || !!(bodyTag && kit.classListOf(bodyTag).indexOf('rv-generated') !== -1),
    imported: /^imported-/.test(template) || !!(bodyTag && A(bodyTag, 'id') === 'imported'),
    placeholders: placeholderHits(s, kit),
    links: links,
    payment: links.filter(function (l) { return l.state === 'form' || l.buttonish ? PAYMENT_RE.test(l.label) && l.label.length <= 40 : false; })
      .map(function (l) { return { label: l.label, section: sectionName(l.section), key: l.key }; }),
    logos: logos, hasNav: hasNav, hasFooter: hasFooter, etNav: etNav, etFooter: etFooterOn
  };
}

/* =====================================================================================================
   BEFORE PUBLISH — what is good to put right, read off the page (owner decision #11, part 3.2: the check
   before Publish, ~/.revamp-cms-qa/ai-learning/SPEC.md). Advisory: none of this holds a version back.
   lib/site-advisory.js words it for the person publishing and the approver, with a link to the place.
     outsideLinks(html, kit)            -> [{ url, label, section, key, chrome, count }]  links to other sites, the
                                          ones a visitor sees most first (buttons, then words, header, footer)
     pageLinks(html, kit, slugs)        -> [{ label, page, section, key }]   links to an internal page the site does
                                          not have (rv-pages.js; slugs: its page list)
     pictureRefs(html, kit)             -> [{ url, kind: 'outside' | 'own', section, key }]   the pictures a visitor
                                          sees that are not in storage (storage's own: api.js pictureProblems)
     emptySections(html, kit)           -> [{ section, key, heading }]   a section shown with nothing in it
     dateFindings(html, kit, event)     -> [{ text, section, key }]   a date the page states that is not the event's
     venueFindings(html, kit, event)    -> [{ text, section, key }]   a place the page states that is not the event's
     formButtons(html, kit)             -> [{ label, forms: [id], section, key, embed }]   what opens or shows a form
     bannerLogo(html, kit)              -> { shown, src, key }   the banner's logo unit (or bound event logo) as shown; key: the banner's section
     etLogoRecoloured(html, kit)        -> [{ section, key, how }]   an ET logo with a colour filter on it
   Each takes the page's text, or read(html, kit) of it.
   ===================================================================================================== */

function scanOf(html, kit) { return typeof html === 'string' || html == null ? scan(String(html == null ? '' : html), kit) : html; }

/* ---------- outside links ---------- */
function outsideLinks(html, kit) {
  var s = scanOf(html, kit), seen = {}, out = [];
  linksOf(s, kit).forEach(function (l, n) {
    if (l.tag !== 'a' || l.state !== 'ok' || !/^https?:\/\/[^\s]+$/i.test(l.href)) return;
    var url = l.href.replace(/#.*$/, '');
    if (seen[url]) { seen[url].count++; return; }
    seen[url] = { url: url, label: l.label, section: placeOf(l), key: l.key, chrome: l.chrome, count: 1, rank: l.chrome === 'footer' ? 3 : l.chrome ? 2 : l.buttonish ? 0 : 1, n: n };
    out.push(seen[url]);
  });
  out.sort(function (a, b) { return a.rank - b.rank || a.n - b.n; });
  return out.map(function (x) { return { url: x.url, label: x.label, section: x.section, key: x.key, chrome: x.chrome, count: x.count }; });
}

/* ---------- links to an internal page (rv-pages.js: data-rv-page-link="<slug>") the site does not have ---------- */
function pageLinks(html, kit, slugs) {
  var s = scanOf(html, kit), out = [], have = {};
  (slugs || []).forEach(function (p) { have[String(p && p.slug != null ? p.slug : p)] = 1; });
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i], c = s.ctx[i];
    if (t.t !== 'open' || c.skip || c.hidden || !kit.attrOf(t, 'data-rv-page-link')) continue;
    var to = String(kit.attrValue(t, 'data-rv-page-link') || '').trim();
    if (!to || to === 'home' || have[to]) continue;
    out.push({ label: labelOf(s, i, kit), page: to, section: placeOf(c), key: c.key });
  }
  return out;
}

/* ---------- pictures not in storage ---------- */
var STORAGE_HOST = /^https?:\/\/storage\.googleapis\.com\//i;
var OWN_FILES = /^\/(?:templates|assets)\/[^?#]+/;
function pictureUrlOf(raw) {
  var u = decode(raw == null ? '' : raw).trim();
  if (!u || /^(?:data|blob|about|javascript):/i.test(u) || u.charAt(0) === '#') return null;
  if (u.indexOf('//') === 0) u = 'https:' + u;
  if (/^https?:\/\//i.test(u)) return STORAGE_HOST.test(u) ? null : { url: u, kind: 'outside' };
  if (OWN_FILES.test(u)) return { url: u.replace(/[?#].*$/, ''), kind: 'own' };
  return null;                       // another address of this host (its builder's paths are dropped on the way out)
}
function pictureRefs(html, kit) {
  var s = scanOf(html, kit), out = [], seen = {};
  function add(raw, c) {
    var p = pictureUrlOf(raw);
    if (!p || seen[p.url]) return;
    seen[p.url] = 1;
    out.push({ url: p.url, kind: p.kind, section: placeOf(c), key: c.key });
  }
  function firstOf(set) { return String(set || '').split(',')[0].trim().split(/\s+/)[0]; }
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i], c = s.ctx[i];
    if (t.t !== 'open' || c.skip || c.hidden) continue;
    if (t.name === 'img') {
      /* the first picture a srcset offers stands for the others: they are copies of one picture */
      if (kit.attrValue(t, 'src')) add(kit.attrValue(t, 'src'), c);
      else add(firstOf(decode(kit.attrValue(t, 'srcset') || '')), c);
    } else if (t.name === 'source' && kit.attrValue(t, 'srcset') && /^image\//i.test(String(kit.attrValue(t, 'type') || 'image/'))) {
      add(firstOf(decode(kit.attrValue(t, 'srcset'))), c);
    }
    var style = decode(kit.attrValue(t, 'style') || '');
    if (style.indexOf('url(') !== -1) {
      var re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, m;
      while ((m = re.exec(style))) add(m[2], c);
    }
  }
  return out;
}

/* ---------- empty sections ----------
   A section a visitor sees with nothing in it: no picture, drawing, film, form, link or button, no list, no figure,
   and no words beyond its heading and a short label (EMPTY_WORDS_MAX letters). Only the FIRST heading is the
   section's own: a later one is what the section shows (a card's title, a question, "500+" over "Delegates"), and a
   banner's heading is the event's name, which is what a banner is for. A number in the words ("60+", a date) is a
   fact, never a label. (The browser check of 8 Nov 2026 found a stats section, a list of key topics, cards with h4
   titles, an FAQ with one short answer, an SVG-only section and a banner with its title and date all called "only
   its heading" when every heading was skipped.) A section the page hides (data-rv-empty, hidden by the owner) is
   not shown, so it is not empty; nor is one the page's runtime fills (a form, the hero film). */
var EMPTY_WORDS_MAX = 30;
/* svg, iframe, object, select and textarea are read past (SKIP), but a visitor sees them: they count first */
var SUBSTANCE = /^(?:img|picture|video|audio|iframe|object|embed|canvas|svg|form|input|select|textarea|table|a|button|details|summary)$/;
var LISTED = /^(?:li|dt|dd)$/;
var FILLED_BY_RUNTIME = ['data-rv-form-embed', 'data-rv-hv', 'data-rv-award-cta', 'data-register-cta', 'data-nominate-form', 'data-interest-form', 'data-rv-countdown'];
function emptySections(html, kit) {
  var s = scanOf(html, kit), out = [];
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i], c = s.ctx[i];
    if (t.t !== 'open' || c.skip || c.hidden || c.chrome) continue;
    var id = kit.attrValue(t, 'data-rv-section');
    if (!id || id === 'nav' || id === 'footer') continue;
    var substance = /url\(/i.test(decode(kit.attrValue(t, 'style') || '')), words = 0, heading = '', banner = isBanner(id);
    for (var k = i + 1; k < s.ends[i] && !substance; k++) {
      var x = s.tokens[k], xc = s.ctx[k];
      if (x.t === 'open') {
        if (xc.hidden) { k = s.ends[k]; continue; }
        if (SUBSTANCE.test(x.name) || /url\(/i.test(decode(kit.attrValue(x, 'style') || ''))) { substance = true; break; }
        if (xc.skip) { k = s.ends[k]; continue; }
        if (FILLED_BY_RUNTIME.some(function (a) { return kit.attrOf(x, a); })) { substance = true; break; }
        if (/^h[1-6]$/.test(x.name)) {
          var said = labelOf(s, k, kit);
          if (said && (heading || banner)) { substance = true; break; }
          if (!heading) heading = said;
          k = s.ends[k];
          continue;
        }
        if (LISTED.test(x.name) && labelOf(s, k, kit)) { substance = true; break; }
        continue;
      }
      if (x.t === 'text' && !xc.skip && !xc.hidden) {
        var w = clean(s.html.slice(x.s, x.e));
        if (/\d/.test(w)) { substance = true; break; }
        words += w.length;
      }
      if (words > EMPTY_WORDS_MAX) substance = true;
    }
    if (!substance) out.push({ section: sectionName(id), key: c.key || id, heading: heading });
    i = s.ends[i];                       // a section inside a section is part of it
  }
  return out;
}

/* ---------- the event's dates and place, as the page states them ----------
   The page is what the editor last saved: nothing on a live page draws the event's details again (rv-live.js is not
   part of this release), so a date or venue changed in Content › Basics after the site was saved still shows the old
   one — on the banner, in the header (et-nav.js writes them in), in an FAQ answer. Read are: the elements that say
   the date or the place (data-rv-bind="event.date" / "event.venue" / "event.city", a class or id that ends in
   date / venue / location / place), and the dates written anywhere in a section's words. Never the footer (ET's
   footer lists its other events, with their dates and places), and never a date the words around it say is another
   moment (a deadline, nominations, last year's edition…) or that stands in a section about other dates. */
var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
var MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
var DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
var TO = '\\s*(?:[-–—]|to|&|and)\\s*';
var YEAR = '(?:,?\\s+((?:19|20)\\d{2}))?';
var DATE_DMY = new RegExp('(?:^|[^\\w])(' + DAY + '(?:' + TO + DAY + ')?\\s+' + MON + '\\.?(?![a-z])' + YEAR + ')(?![\\w])', 'gi');
var DATE_MDY = new RegExp('(?:^|[^\\w])(' + MON + '\\.?\\s+' + DAY + '(?:' + TO + DAY + ')?' + YEAR + ')(?![\\w])', 'gi');
var DATE_MY = new RegExp('(?:^|[^\\w])(' + MON + '\\.?,?\\s+((?:19|20)\\d{2}))(?![\\w])', 'gi');
/* the words before a date that make it another moment than the event */
var OTHER_MOMENT = /\b(?:deadline|clos(?:e|es|ed|ing)|last\s+date|due|until|till|before|since|after|nominat\w*|submi\w*|entr(?:y|ies)|appl(?:y|ication)s?|previous|past|last\s+(?:year|edition)|held\s+on|was\s+held|took\s+place|founded|launched|established|early[\s-]?bird|opens?|published|updated|posted|announc\w*|shortlist\w*|jury|result\w*)\b[^.!?]*$/i;
var OTHER_MOMENT_AFTER = /^[^.!?]{0,24}\b(?:deadline|last\s+date|closes?|onwards)\b/i;
/* sections about other dates than the event's */
var OTHER_DATES_SECTION = /timeline|key-?dates|important-?dates|deadline|nominat|jury|process|past|previous|prev-|glimpse|gallery|testimonial|news|blog|press|media|archive|history|winners|edition|journey|milestone|legacy|categor/i;
var DATE_MARK = /(?:^|[-_])(?:date|dates|when)$/i;
var FACT_LABEL = /^(?:the\s+)?(?:venue|location|place|where|city|date|dates|when)\s*[:?]?$/i;
var PLACE_MARK = /(?:^|[-_])(?:venue|location|place|where|city)$/i;

/* the dates in a text -> [{ text, at, y (0: none written), m, d1, d2, monthOnly }] */
function datesIn(text) {
  text = String(text || '');
  var out = [], taken = [];
  function free(a, b) { return !taken.some(function (r) { return a < r[1] && b > r[0]; }); }
  function month(word) {
    /* "may" is a word too: only "May" (or "MAY") is the month */
    if (/^may$/i.test(word) && word !== 'May' && word !== 'MAY') return 0;
    return MONTHS[word.slice(0, 3).toLowerCase()] || 0;
  }
  function push(m, parts) {
    var whole = m[1], start = m.index + m[0].indexOf(whole);
    if (!free(start, start + whole.length)) return;
    var mo = month(parts.mon);
    if (!mo) return;
    var d1 = +parts.d1 || 0, d2 = +parts.d2 || d1;
    if (!parts.monthOnly && (d1 < 1 || d1 > 31 || d2 < d1 || d2 > 31)) return;
    taken.push([start, start + whole.length]);
    out.push({ text: whole.trim(), at: start, y: +parts.y || 0, m: mo, d1: d1, d2: d2, monthOnly: !!parts.monthOnly });
  }
  var m;
  DATE_DMY.lastIndex = 0;
  while ((m = DATE_DMY.exec(text))) push(m, { d1: m[2], d2: m[3], mon: m[4], y: m[5] });
  DATE_MDY.lastIndex = 0;
  while ((m = DATE_MDY.exec(text))) push(m, { mon: m[2], d1: m[3], d2: m[4], y: m[5] });
  DATE_MY.lastIndex = 0;
  while ((m = DATE_MY.exec(text))) push(m, { mon: m[2], y: m[3], monthOnly: true });
  out.sort(function (a, b) { return a.at - b.at; });
  return out;
}
/* the event's own days: { a: yyyymmdd, b: yyyymmdd, years: [y…] }, or null when it has no exact dates */
function eventDays(event) {
  event = event || {};
  if (event.dateMode && event.dateMode !== 'exact') return null;
  function ymd(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : 0; }
  var a = ymd(event.start), b = ymd(event.end) || a;
  if (!a) return null;
  if (b < a) b = a;
  var years = [];
  for (var y = Math.floor(a / 10000); y <= Math.floor(b / 10000); y++) years.push(y);
  return { a: a, b: b, years: years };
}
/* whether a date the page states is (within) the event's days */
function withinEvent(d, days) {
  if (d.monthOnly) {
    var ym = d.y * 100 + d.m;
    return ym >= Math.floor(days.a / 100) && ym <= Math.floor(days.b / 100);
  }
  var years = d.y ? [d.y] : days.years;
  return years.some(function (y) {
    for (var day = d.d1; day <= d.d2; day++) { var v = y * 10000 + d.m * 100 + day; if (v < days.a || v > days.b) return false; }
    return true;
  });
}
function classTokens(t, kit) { return kit.classListOf(t).concat([String(kit.attrValue(t, 'id') || '')]).filter(Boolean); }
/* the visible words of each section (not the footer), and the elements that state the date or the place */
function eventFacts(s, kit) {
  var bySection = {}, order = [], marks = [];
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i], c = s.ctx[i];
    if (c.skip || c.hidden || c.chrome === 'footer') continue;
    if (t.t === 'open') {
      var bind = String(kit.attrValue(t, 'data-rv-bind') || '');
      var toks = classTokens(t, kit);
      var what = bind === 'event.date' || toks.some(function (x) { return DATE_MARK.test(x); }) ? 'date'
        : bind === 'event.venue' || bind === 'event.city' || toks.some(function (x) { return PLACE_MARK.test(x); }) ? 'place' : '';
      /* a whole section named so ("venue") is a section about the place, not the place itself */
      if (what && !kit.attrValue(t, 'data-rv-section') && t.name !== 'section' && !VOID[t.name] && s.ends[i] > i) {
        marks.push({ what: what, text: labelOf(s, i, kit), section: placeOf(c), key: c.key, sec: c.section });
        i = s.ends[i];
      }
      continue;
    }
    if (t.t !== 'text') continue;
    var words = clean(s.html.slice(t.s, t.e));
    if (!words) continue;
    var k = c.chrome ? 'chrome:' + c.chrome : c.key || c.section || '';
    if (!bySection[k]) { bySection[k] = { words: [], section: placeOf(c), key: c.key, sec: c.section, chrome: c.chrome }; order.push(k); }
    bySection[k].words.push(words);
  }
  return { sections: order.map(function (k) { var x = bySection[k]; x.text = x.words.join(' '); return x; }), marks: marks };
}
function isBanner(sec) { return /^(?:hero|banner)$/i.test(String(sec || '')); }
function dateFindings(html, kit, event) {
  var days = eventDays(event);
  if (!days) return [];
  var s = scanOf(html, kit), facts = eventFacts(s, kit), out = [], seen = {};
  function add(text, where) {
    var k = where.section + '|' + text;
    if (seen[k]) return;
    seen[k] = 1;
    out.push({ text: text, section: where.section, key: where.key });
  }
  /* an element that states the date: every date in it is the event's — unless it stands in a section about other
     dates (a previous edition's agenda gives its own days) */
  facts.marks.forEach(function (mk) {
    if (mk.what !== 'date' || OTHER_DATES_SECTION.test(String(mk.sec || '') + ' ' + String(mk.key || ''))) return;
    datesIn(mk.text).forEach(function (d) { if (!withinEvent(d, days)) add(d.text, mk); });
  });
  facts.sections.forEach(function (x) {
    if (OTHER_DATES_SECTION.test(String(x.sec || '') + ' ' + String(x.key || ''))) return;
    var prominent = isBanner(x.sec) || x.chrome === 'nav';
    datesIn(x.text).forEach(function (d) {
      if (withinEvent(d, days)) return;
      /* a date of another year, outside the banner and the header, is history ("in March 2024 we began") */
      if (d.y && days.years.indexOf(d.y) === -1 && !prominent) return;
      var before = x.text.slice(Math.max(0, d.at - 60), d.at), after = x.text.slice(d.at + d.text.length);
      if (OTHER_MOMENT.test(before) || OTHER_MOMENT_AFTER.test(after)) return;
      add(d.text, x);
    });
  });
  return out;
}
/* places a visitor reads as a city, with the names they go by */
var CITIES = [['mumbai', 'bombay', 'navi mumbai'], ['delhi', 'new delhi', 'delhi ncr'], ['bengaluru', 'bangalore'], ['chennai', 'madras'], ['hyderabad'],
  ['kolkata', 'calcutta'], ['pune'], ['gurugram', 'gurgaon'], ['noida', 'greater noida'], ['goa'], ['ahmedabad'], ['jaipur'], ['kochi', 'cochin'],
  ['chandigarh'], ['lucknow'], ['indore'], ['bhubaneswar'], ['coimbatore'], ['visakhapatnam', 'vizag'], ['dubai'], ['abu dhabi'], ['singapore'],
  ['london'], ['new york'], ['riyadh'], ['doha']];
/* words of a venue's name that say what kind of place it is, not which one */
var PLACE_GENERIC = ['hotel', 'hotels', 'resort', 'centre', 'center', 'convention', 'exhibition', 'international', 'expo', 'hall', 'auditorium',
  'grand', 'the', 'and', 'venue', 'india', 'campus', 'tower', 'towers', 'road', 'marg', 'complex'];
function plainLower(text) { return ' ' + String(text || '').toLowerCase().replace(/[^a-z]+/g, ' ') + ' '; }
function cityNamesIn(text) {
  var t = plainLower(text), out = [];
  CITIES.forEach(function (names, g) {
    var hit = names.filter(function (n) { return t.indexOf(' ' + n + ' ') !== -1; })[0];
    if (hit) out.push({ group: g, name: hit });
  });
  return out;
}
function venueFindings(html, kit, event) {
  event = event || {};
  var place = [event.venue, event.city].map(function (v) { return clean(v || ''); }).filter(Boolean).join(', ');
  if (!place) return [];
  var own = cityNamesIn(place).map(function (c) { return c.group; });
  function wordsOf(v) { return plainLower(v).trim().split(' ').filter(function (w) { return w.length >= 4 && PLACE_GENERIC.indexOf(w) === -1; }); }
  var venueWords = wordsOf(event.venue), cityWords = wordsOf(event.city);
  var s = scanOf(html, kit), facts = eventFacts(s, kit), out = [], seen = {};
  function add(text, where) {
    var k = where.section + '|' + text;
    if (seen[k]) return;
    seen[k] = 1;
    out.push({ text: text.length > 90 ? text.slice(0, 89) + '…' : text, section: where.section, key: where.key });
  }
  function others(text) { return cityNamesIn(text).filter(function (c) { return own.indexOf(c.group) === -1; }); }
  /* an element that states the place: it names the event's venue (or, with no venue known, its city), or only its
     city — never another venue in the same city ("Taj Lands End, Mumbai" once the event moved to the JW Marriott) —
     and no other city */
  facts.marks.forEach(function (mk) {
    /* a label ("Venue", "Location:") over the place is not a place */
    if (mk.what !== 'place' || !mk.text || placeholderOf(mk.text) || FACT_LABEL.test(mk.text)) return;
    var low = plainLower(mk.text);
    function has(w) { return low.indexOf(' ' + w + ' ') !== -1; }
    var cities = cityNamesIn(mk.text);
    var ownCity = cities.some(function (c) { return own.indexOf(c.group) !== -1; }) || (cityWords.length > 0 && cityWords.every(has));
    var rest = low;
    cities.forEach(function (c) { rest = rest.split(' ' + c.name + ' ').join(' '); });
    cityWords.forEach(function (w) { rest = rest.split(' ' + w + ' ').join(' '); });
    var onlyCity = rest.replace(/[^a-z]/g, '').length < 3;
    var right = venueWords.length ? venueWords.some(has) || (ownCity && onlyCity) : ownCity;
    if (!right || others(mk.text).length) add(mk.text, mk);
  });
  /* the banner's and the header's words: a city that is not the event's (when the event's is a city known here) */
  if (own.length) facts.sections.forEach(function (x) {
    if (!(isBanner(x.sec) || x.chrome === 'nav')) return;
    others(x.text).forEach(function (c) { add(c.name.replace(/\b[a-z]/g, function (ch) { return ch.toUpperCase(); }), x); });
  });
  return out;
}

/* ---------- forms: what on the page opens or shows one ----------
   The forms runtime (templates/_shared/rv-forms.js) opens the event's main form for data-register-cta and #register,
   a named one for data-rv-form="<id>" and #rv-form-<id>, draws one in place for data-rv-form-embed="<id>"; an award
   site's lifecycle button opens one of two (rv-award-cta.js). forms: [] means the event's main form. */
function formButtons(html, kit) {
  var s = scanOf(html, kit), out = [], A = kit.attrValue;
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i], c = s.ctx[i];
    if (t.t !== 'open' || c.skip || c.hidden) continue;
    var ids = [], embed = false;
    if (kit.attrOf(t, 'data-rv-form-embed')) { ids.push(String(A(t, 'data-rv-form-embed') || '')); embed = true; }
    else if (kit.attrOf(t, 'data-nominate-form') || kit.attrOf(t, 'data-interest-form')) {
      ['data-nominate-form', 'data-interest-form'].forEach(function (a) { var v = String(A(t, a) || ''); if (v) ids.push(v); });
    } else if (A(t, 'data-rv-form')) ids.push(String(A(t, 'data-rv-form')));
    else if (t.name === 'a' || t.name === 'button') {
      var href = decode(A(t, 'href') || '').trim(), m = /^#rv-form-([a-z][a-z0-9-]{0,39})$/.exec(href);
      if (m) ids.push(m[1]);
      else if (!kit.attrOf(t, 'data-register-cta') && href !== '#register') continue;
    } else if (!kit.attrOf(t, 'data-register-cta')) continue;
    if (c.form && !embed) continue;                              // a form's own buttons
    out.push({ label: embed ? '' : labelOf(s, i, kit), forms: ids.filter(Boolean), section: placeOf(c), key: c.key, embed: embed });
    if (embed) i = s.ends[i];
  }
  return out;
}

/* ---------- the banner's logo ---------- */
function bannerLogo(html, kit) {
  /* key: the banner section's, so "put it right" opens the editor on it ("banner" on tech500, "hero" elsewhere) */
  var s = scanOf(html, kit), unitEnd = -1, key = '';
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i], c = s.ctx[i];
    if (t.t !== 'open' || c.skip || c.hidden) continue;
    if (!key && isBanner(c.section)) key = c.key;
    if (kit.attrOf(t, 'data-rv-logo-unit')) { unitEnd = s.ends[i]; continue; }
    if (t.name !== 'img') continue;
    var src = decode(kit.attrValue(t, 'src') || '').trim();
    if (!src) continue;
    if (i < unitEnd || kit.attrValue(t, 'data-rv-bind') === 'event.logo' || (kit.attrOf(t, 'data-rv-logo') && isBanner(c.section))) return { shown: true, src: src, key: key };
  }
  return { shown: false, src: '', key: key };
}

/* ---------- the ET logo rule: only its black or grey lettering may change colour; the red square never does ----------
   A colour filter on the picture of an ET logo (inline, or Tailwind's own classes) changes the red square too. */
var ET_LOGO_SRC = /(?:^|[\/_-])(?:et[-_]?b2b|etb2b|et[-_]logo|economic[-_]?times)[^\/]*\.(?:svg|png|webp|jpe?g)(?:[?#]|$)/i;
var FILTER_STYLE = /(?:^|;)\s*(?:-webkit-)?filter\s*:\s*[^;]*\b(?:invert|hue-rotate|grayscale|sepia|saturate|brightness\(\s*0)/i;
var FILTER_CLASS = /^(?:invert|grayscale|sepia|saturate-0|brightness-0|hue-rotate-\d+|dark:invert|dark:brightness-0)$/;
function etLogoRecoloured(html, kit) {
  var s = scanOf(html, kit), out = [];
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i], c = s.ctx[i];
    if (t.t !== 'open' || t.name !== 'img' || c.skip || c.hidden) continue;
    var src = decode(kit.attrValue(t, 'src') || ''), alt = clean(kit.attrValue(t, 'alt') || '');
    if (!ET_LOGO_SRC.test(src) && !/^(?:ET|ETB2B|The Economic Times)\b/.test(alt)) continue;
    var cls = kit.classListOf(t).filter(function (x) { return FILTER_CLASS.test(x); })[0];
    var how = FILTER_STYLE.test(decode(kit.attrValue(t, 'style') || '')) ? 'a colour filter' : cls ? 'the class “' + cls + '”' : '';
    if (how) out.push({ section: placeOf(c), key: c.key, how: how });
  }
  return out;
}

/* =====================================================================================================
   REPAIR — what a live page gets on its way out (publish, preview, and every page already live as it is
   served). Never the saved page: the owner's page stays as they left it, and the editor shows it so.
     1. a button that says Register (Express interest, Book your seat…) and does not open a form, opens the
        registration form (data-register-cta);
     2. a partner or sponsor button that leads nowhere — a hidden or missing section, the sponsors list —
        opens a "Partner with us" enquiry; an award's "Nominate" that leads off the site opens the
        nomination form (a form of the event named so) or a "Start a nomination" enquiry;
     3. any other link to a section that is not on the page or not shown is hidden (a button) or loses its
        address (words in a sentence);
     4. an imported page's addresses on this host (/about, /faq — the CMS's own sign-in answers them) lead to
        the section of the page they stand for, or are hidden when there is none; its home link to the site;
        its "#" privacy and terms links to the ET portal's pages, its "#" social links to the portal's,
        and what cannot work outside the original (a menu button with no menu, a film with nothing this site
        can play — and the section around it when the film was all it showed —, a chat launcher) is taken out
        first, so that a link to what went with it is seen to lead nowhere;
     5. the award ceremony's "Get Tickets" (there are no tickets to sell) says "Request an invitation", and its
        form says seats are confirmed by the ET team, with no online payment;
     6. a list of links left with none of them shown (a footer column whose every link led to a page the site
        does not have) is hidden too, with the heading over it.
   ===================================================================================================== */
function repair(html, kit, opts) {
  html = String(html == null ? '' : html);
  opts = opts || {};
  var s = scan(html, kit), A = kit.attrValue;
  var changes = [], touched = false;
  /* opts.imported: a page's body at import, before it has a <body> to say so */
  var imported = opts.imported === true || inspectKind(s, kit) === 'imported';
  /* 4. what an imported page brought that cannot work outside the original, taken out before its links are read */
  if (imported) {
    var left = widgets(s, kit, changes);
    if (left !== null) { html = left; s = scan(html, kit); touched = true; }
  }
  var out = s.tokens.map(function (t) { return html.slice(t.s, t.e); });
  var gone = {};                                  // the links hidden here, by token: a list of nothing else goes too (6)
  var portal = etFooter.info(etFooter.isKnown(opts.portal) ? opts.portal : '');
  var forms = (opts.forms && Array.isArray(opts.forms.forms)) ? opts.forms.forms : [];
  var nominateForm = forms.filter(function (f) { return f && /nominat/i.test(String(f.name || '') + ' ' + String(f.title || '')); })[0];

  /* key: the section the site editor finds it by, so the check can link there (site-advisory.js sectionFixes) */
  function note(what, link, how) { changes.push({ what: what, label: link.label, section: placeOf(link), key: link.key, how: how }); }
  function rewrite(i) { out[i] = kit.writeTag(s.tokens[i]); touched = true; }
  function opensForm(link, enquiry) {
    var t = s.tokens[link.i];
    kit.setAttr(t, 'data-register-cta', '');
    if (enquiry) {
      kit.setAttr(t, 'data-rv-form-title', enquiry.title);
      kit.setAttr(t, 'data-rv-form-note', enquiry.note);
      kit.setAttr(t, 'data-rv-form-source', enquiry.source);
    }
    if (t.name === 'a') kit.setAttr(t, 'href', '#register');
    rewrite(link.i);
  }
  /* hidden on the live page (rv-live.css hides data-rv-nav-empty; data-rv-removed says why it is not shown) */
  function hide(link) {
    var t = s.tokens[link.i];
    kit.setAttr(t, 'data-rv-nav-empty', '');
    kit.setAttr(t, 'data-rv-removed', 'leads-nowhere');
    rewrite(link.i);
    gone[link.i] = true;
  }
  function unlink(link) { kit.dropAttr(s.tokens[link.i], 'href'); rewrite(link.i); }
  function relabel(link, words) {
    var done = false;
    for (var k = link.i + 1; k < s.ends[link.i]; k++) {
      var x = s.tokens[k];
      if (x.t !== 'text' || !clean(out[k])) continue;
      if (done) { out[k] = ''; continue; }
      var lead = /^\s*/.exec(out[k])[0], tail = /\s*$/.exec(out[k])[0];
      out[k] = lead + escText(words) + tail;
      done = true;
    }
    if (done) touched = true;
    return done;
  }
  /* the section an imported page's address stands for: "/about#entry-guidelines" -> #entry-guidelines,
     "/categories" -> #award-categories, "/faq" -> #faqs; '' when the page has none */
  function anchorFor(path) {
    var m = /^\/([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/.exec(path);
    if (!m) return '';
    function shown(id) { var h = Object.prototype.hasOwnProperty.call(s.ids, id) ? s.ids[id] : null; return h && !h.node.hidden ? id : ''; }
    if (m[2] && shown(m[2])) return m[2];
    var segs = m[1].split('/').filter(Boolean);
    for (var n = segs.length - 1; n >= 0; n--) {
      var seg = segs[n].toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!seg) continue;
      var stems = [seg, seg.replace(/s$/, ''), seg + 's'];
      for (var k = 0; k < stems.length; k++) if (shown(stems[k])) return stems[k];
      var ids = Object.keys(s.ids);
      for (k = 0; k < ids.length; k++) {
        var parts = ids[k].toLowerCase().split(/[-_]/);
        if (stems.some(function (x) { return parts.indexOf(x) !== -1; }) && shown(ids[k])) return ids[k];
      }
    }
    return '';
  }

  var links = linksOf(s, kit);
  links.forEach(function (link) {
    var t = s.tokens[link.i];
    var formish = link.state === 'form';
    /* 5. the award ceremony's button */
    if (formish && /^(?:get|buy|book)\s+tickets?$/i.test(link.label) && (link.section === 'awards-night' || kit.classListOf(t).indexOf('aw-cer-btn') !== -1)) {
      if (relabel(link, ENQUIRY.ceremony.title)) {
        kit.setAttr(t, 'data-rv-form-title', ENQUIRY.ceremony.title);
        kit.setAttr(t, 'data-rv-form-note', ENQUIRY.ceremony.note);
        kit.setAttr(t, 'data-rv-form-source', ENQUIRY.ceremony.source);
        rewrite(link.i);
        note('ceremony', link, 'now says “' + ENQUIRY.ceremony.title + '” and asks for an invitation: there are no tickets to sell');
      }
      return;
    }
    if (formish) return;
    var external = link.state === 'ok' && /^(?:https?:|mailto:|tel:)/i.test(link.href);
    if (external) return;
    var path = link.state === 'path';

    /* 1. Register */
    if (link.kind === 'register' && (link.tag === 'button' || link.state !== 'ok' || link.href.charAt(0) === '#')) {
      /* a button that already leads to a form drawn in the page is right as it is */
      if (link.state === 'ok' && link.targetI != null && targetHasForm(s, link.targetI, kit)) return;
      opensForm(link, null);
      note('register', link, 'opens the registration form');
      return;
    }
    /* 2. Nominate, on a page that sends it off the site */
    if (link.kind === 'nominate' && (path || link.state === 'missing' || link.state === 'hidden' || link.state === 'empty')) {
      if (nominateForm) {
        kit.setAttr(t, 'data-rv-form', nominateForm.id);
        if (t.name === 'a') kit.setAttr(t, 'href', '#rv-form-' + nominateForm.id);
        rewrite(link.i);
        note('nominate', link, 'opens the “' + clean(nominateForm.name || nominateForm.title || 'nomination') + '” form');
      } else {
        opensForm(link, ENQUIRY.nominate);
        note('nominate', link, 'opens a nomination enquiry');
      }
      return;
    }
    /* 2. a partner button: hidden or missing target, nowhere, or the sponsors list itself */
    if (link.kind === 'partner' && link.buttonish && !link.chrome &&
        (link.state === 'missing' || link.state === 'hidden' || link.state === 'empty' || path || isSponsorsTarget(s, link, kit))) {
      opensForm(link, ENQUIRY.partner);
      note('partner', link, 'opens a “' + ENQUIRY.partner.title + '” enquiry');
      return;
    }
    /* 4. an address on this host that is no page of the site (an imported page's /about, /faq — the CMS's own
       sign-in answers them), and an imported page's "#" links */
    if (path) {
      if (link.href === '/' || /^\/(?:home|index(?:\.html?)?)?$/i.test(link.href)) {
        if (opts.homeHref === false) return;                // at import: the live page sets it, once the address is known
        if (opts.homeHref) { kit.setAttr(t, 'href', opts.homeHref); rewrite(link.i); note('home', link, 'leads to the top of this site'); }
        else { unlink(link); note('home', link, 'is no longer a link'); }
        return;
      }
      var anchor = anchorFor(link.href);
      if (anchor) { kit.setAttr(t, 'href', '#' + anchor); rewrite(link.i); note('path', link, 'leads to the “' + sectionName(anchor) + '” part of the page'); return; }
      hide(link);
      note('path', link, 'is hidden: it led to ' + link.href + ', a page this site does not have');
      return;
    }
    if (imported && link.state === 'empty') {
      if (link.kind.indexOf('legal:') === 0) {
        var key = link.kind.slice(6), dest = legalHref(portal, key);
        if (dest) { kit.setAttr(t, 'href', dest); setNewTab(t, kit); rewrite(link.i); note('legal', link, 'leads to ' + portal.site + '’s ' + (key === 'terms' ? 'terms' : 'privacy policy')); }
        else { hide(link); note('legal', link, 'is hidden: there is no such page to link to'); }
        return;
      }
      if (link.kind === 'social') {
        var social = socialHref(portal, link.label);
        if (social) { kit.setAttr(t, 'href', social); setNewTab(t, kit); rewrite(link.i); note('social', link, 'leads to ' + portal.site + '’s page'); }
        else { hide(link); note('social', link, 'is hidden: it led nowhere'); }
        return;
      }
    }
    /* 3. a link to a section that is not there, or not shown */
    if (link.state === 'missing' || link.state === 'hidden' || (imported && link.state === 'empty' && link.label)) {
      if (link.chrome && !link.buttonish) { hide(link); note('nav', link, 'is hidden: ' + whyDead(link)); }
      else if (link.chrome || link.buttonish || link.tag === 'button') { hide(link); note('dead', link, 'is hidden: ' + whyDead(link)); }
      else { unlink(link); note('dead', link, 'is no longer a link: ' + whyDead(link)); }
    }
  });

  /* 6. a list of links with none of them left to show, and the heading over it: a heading with nothing under it
     reads as something missing (the imported award sites' footer column "Attend", whose two links led to /about) */
  for (var li = 0; li < s.tokens.length; li++) {
    var lt = s.tokens[li];
    if (lt.t !== 'open' || (lt.name !== 'ul' && lt.name !== 'ol') || s.ctx[li].hidden || s.ctx[li].skip || !noLinkLeft(s, li, kit, gone)) continue;
    var col = columnOf(s, li, kit);
    kit.setAttr(s.tokens[col.i], 'data-rv-nav-empty', '');
    kit.setAttr(s.tokens[col.i], 'data-rv-removed', 'leads-nowhere');
    rewrite(col.i);
    changes.push({ what: 'nav', label: col.heading || 'Links', section: placeOf(s.ctx[li]), how: 'is hidden: none of its links lead anywhere' });
    li = s.ends[col.i];
  }

  return { html: touched ? out.join('') : html, changes: changes };
}

/* Whether every link of a list is hidden — as saved, or by this pass (gone) — and the list says nothing besides */
function noLinkLeft(s, i, kit, gone) {
  var links = 0;
  for (var k = i + 1; k < s.ends[i]; k++) {
    var x = s.tokens[k];
    if (x.t === 'open' && (x.name === 'a' || x.name === 'button')) {
      links++;
      if (!s.ctx[k].hidden && !gone[k]) return false;
      k = s.ends[k];
      continue;
    }
    if (x.t === 'open' && (SKIP[x.name] || s.ctx[k].hidden)) { k = s.ends[k]; continue; }
    if (x.t === 'text' && clean(s.html.slice(x.s, x.e))) return false;
  }
  return links > 0;
}
/* The list's column: the element around it when all else it holds is a short heading ("Attend"), else the list
   itself. -> { i, heading } */
function columnOf(s, i, kit) {
  var p = enclosingAny(s, i);
  if (p === -1) return { i: i, heading: '' };
  var t = s.tokens[p];
  if (/^(?:section|main|body|html|header|footer|nav|article)$/.test(t.name) || kit.attrValue(t, 'data-rv-section') != null) return { i: i, heading: '' };
  var words = [];
  for (var k = p + 1; k < s.ends[p]; k++) {
    if (k === i) { k = s.ends[i]; continue; }
    var x = s.tokens[k];
    if (x.t === 'open' && /^(?:a|button|img|picture|video|iframe|form|ul|ol|table|input|select|textarea)$/.test(x.name)) return { i: i, heading: '' };
    if (x.t === 'open' && SKIP[x.name]) { k = s.ends[k]; continue; }
    if (x.t === 'text') { var w = clean(s.html.slice(x.s, x.e)); if (w) words.push(w); }
  }
  var heading = words.join(' ');
  return heading.length <= 60 ? { i: p, heading: heading } : { i: i, heading: '' };
}
function enclosingAny(s, k) {
  for (var p = k - 1; p >= 0; p--) if (s.tokens[p].t === 'open' && s.ends[p] >= s.ends[k] && s.ends[p] !== p) return p;
  return -1;
}

function inspectKind(s, kit) {
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i];
    if (t.t !== 'open' || t.name !== 'body') continue;
    var tpl = String(kit.attrValue(t, 'data-rv-template-id') || '');
    if (/^imported-/.test(tpl) || kit.attrValue(t, 'id') === 'imported') return 'imported';
    return /^gen-/.test(tpl) ? 'generated' : 'template';
  }
  return '';
}
function whyDead(link) { return link.state === 'hidden' ? 'its section is not shown' : link.state === 'missing' ? 'its section is not on the page' : 'it led nowhere'; }
function targetHasForm(s, i, kit) {
  for (var k = i; k <= s.ends[i]; k++) {
    var t = s.tokens[k];
    if (t.t === 'open' && (kit.attrOf(t, 'data-rv-form-embed') || t.name === 'form')) return true;
  }
  return false;
}
function isSponsorsTarget(s, link, kit) {
  if (link.targetI == null) return false;
  var t = s.tokens[link.targetI];
  var id = String(kit.attrValue(t, 'id') || '') + ' ' + String(kit.attrValue(t, 'data-rv-section') || '');
  return /sponsor|partner/i.test(id) || kit.attrValue(t, 'data-rv-bound') === 'partners';
}
function legalHref(portal, key) {
  var want = key === 'terms' ? /terms/i : key === 'privacy' ? /privacy/i : null;
  if (!want) return '';
  var found = '';
  (portal.links || []).forEach(function (col) { col.forEach(function (l) { if (!found && want.test(l[0])) found = l[1]; }); });
  return found;
}
function socialHref(portal, label) {
  var m = SOCIAL_RE.exec(label);
  if (!m) return '';
  var kind = (m[1] || 'x').toLowerCase();
  if (kind === 'twitter' || kind === 'x.com') kind = 'x';
  var hit = (portal.social || []).filter(function (x) { return x.kind === kind; })[0];
  return hit ? hit.href : '';
}
function setNewTab(t, kit) {
  kit.setAttr(t, 'target', '_blank');
  kit.setAttr(t, 'rel', 'noopener');
}

/* A menu button whose menu was not captured, a film with nothing to play (and its play button), a chat launcher:
   taken out of an imported page. A menu button stays when the page has the menu it opens (aria-controls names an
   element on the page). A section that showed nothing but the film under its title goes with it ("Gallery" of the
   imported award sites: its title over an empty grey box). -> the page without them, or null when nothing went */
function widgets(s, kit, changes) {
  var A = kit.attrValue, out = s.tokens.map(function (t) { return s.html.slice(t.s, t.e); }), removed = false;
  function remove(i) { for (var k = i; k <= s.ends[i]; k++) out[k] = ''; removed = true; }
  for (var i = 0; i < s.tokens.length; i++) {
    var t = s.tokens[i];
    if (t.t !== 'open' || out[i] === '') continue;
    var c = s.ctx[i];
    if (c.skip) continue;
    if (t.name === 'video') {
      if (playable(s, i, kit)) continue;
      /* the film's frame: the nearest element around it that holds nothing else but its play button and
         decoration — the grey box goes with it */
      var box = frameOf(s, i, kit);
      remove(box);
      /* and the caption that names it, just after it */
      var next = nextElement(s, s.ends[box]);
      if (next !== -1 && (s.tokens[next].name === 'figcaption' || s.tokens[next].name === 'p') && /\b(?:film|video)\b/i.test(labelOf(s, next, kit))) {
        remove(next);
        box = next;
      }
      changes.push({ what: 'widget', label: 'Film', section: sectionName(c.section), how: 'taken out: it had no film this site can play' });
      var sec = sectionAround(s, i, kit);
      if (sec !== -1 && onlyTitleLeft(s, sec, out, kit)) {
        remove(sec);
        var secId = A(s.tokens[sec], 'data-rv-section') || A(s.tokens[sec], 'id');
        changes.push({ what: 'widget', label: secId ? sectionName(secId) : 'Its section', section: sectionName(c.section), how: 'taken out: the film was all it showed' });
        box = sec;
      }
      i = s.ends[box];
      continue;
    }
    if (t.name !== 'button') continue;
    var label = labelOf(s, i, kit);
    var cls = kit.classListOf(t), style = decode(A(t, 'style') || '');
    var fixed = cls.indexOf('fixed') !== -1 || /position\s*:\s*fixed/i.test(style);
    if (/^(?:menu|open menu|toggle (?:menu|navigation)|navigation)$/i.test(label)) {
      var controls = A(t, 'aria-controls');
      if (controls && Object.prototype.hasOwnProperty.call(s.ids, controls)) continue;
      remove(i);
      changes.push({ what: 'widget', label: label, section: sectionName(c.section), how: 'taken out: the menu it opened was not part of the import' });
      continue;
    }
    if (fixed && /\b(?:chat|assistant|need help|ask us|help desk|support)\b/i.test(label)) {
      remove(i);
      changes.push({ what: 'widget', label: label.length > 60 ? label.slice(0, 57) + '…' : label, section: sectionName(c.section), how: 'taken out: a chat that cannot answer outside the original site' });
    }
  }
  return removed ? out.join('') : null;
}
/* the first element after token k, when only white space stands between them; -1 otherwise */
function nextElement(s, k) {
  for (var n = k + 1; n < s.tokens.length; n++) {
    var t = s.tokens[n];
    if (t.t === 'text' && !/\S/.test(s.html.slice(t.s, t.e))) continue;
    return t.t === 'open' ? n : -1;
  }
  return -1;
}
/* Whether a film has something to play: its own src, or a <source>'s, that is not an address of this host that can
   never answer — an imported page's own builder paths (/__l5e/assets-v1/…/jury-film.mp4), which the import does
   not bring over and lib/delivery.js drops from the page a visitor gets (its step 6, the same rule): such a film
   is an empty grey box whose play button plays nothing. */
function playable(s, i, kit) {
  if (liveSrc(kit.attrValue(s.tokens[i], 'src'))) return true;
  for (var k = i + 1; k < s.ends[i]; k++) {
    var t = s.tokens[k];
    if (t.t === 'open' && t.name === 'source' && liveSrc(kit.attrValue(t, 'src'))) return true;
  }
  return false;
}
function liveSrc(src) {
  src = decode(src == null ? '' : src).trim();
  return !!src && !require('./delivery').deadLocalPath(src);
}
/* the section a token stands in: the nearest <section> or data-rv-section around it; -1 when none */
function sectionAround(s, k, kit) {
  for (var p = k - 1; p >= 0; p--) {
    var t = s.tokens[p];
    if (t.t !== 'open' || s.ends[p] < s.ends[k] || s.ends[p] === p) continue;
    if (t.name === 'section' || kit.attrValue(t, 'data-rv-section') != null) return p;
    if (/^(?:main|body|html|header|footer)$/.test(t.name)) return -1;
  }
  return -1;
}
/* What is left of a section once the film is out (out: '' for what went) is its title and no more: headings, a
   short label such as "Gallery" over them, and nothing to see, follow or fill in. */
function onlyTitleLeft(s, sec, out, kit) {
  var loose = 0, headingEnd = -1;
  for (var k = sec + 1; k < s.ends[sec]; k++) {
    if (out[k] === '') continue;
    var x = s.tokens[k];
    if (x.t === 'open') {
      if (SKIP[x.name] || isHiddenTag(x, kit)) { k = s.ends[k]; continue; }
      if (/^(?:img|picture|video|audio|iframe|object|embed|canvas|a|button|form|input|select|textarea|table|ul|ol|dl|blockquote)$/.test(x.name)) return false;
      if (/^h[1-6]$/.test(x.name) && s.ends[k] > headingEnd) headingEnd = s.ends[k];
    } else if (x.t === 'text' && k > headingEnd) {
      loose += clean(s.html.slice(x.s, x.e)).length;
      if (loose > 40) return false;
    }
  }
  return true;
}
/* the video, or the nearest element around it with nothing to read in it but the video's play button */
function frameOf(s, i, kit) {
  var best = i;
  for (var p = i - 1; p >= 0; p--) {
    var t = s.tokens[p];
    if (t.t !== 'open' || s.ends[p] < s.ends[i] || s.ends[p] === p) continue;
    if (/^(?:section|main|body|html|header|footer|article)$/.test(t.name) || kit.attrValue(t, 'data-rv-section') != null) break;
    if (!onlyFilm(s, p, i, kit)) break;
    best = p;
  }
  return best;
}
function onlyFilm(s, p, videoI, kit) {
  for (var k = p + 1; k < s.ends[p]; k++) {
    if (k >= videoI && k <= s.ends[videoI]) continue;
    var t = s.tokens[k];
    if (t.t === 'text' && clean(s.html.slice(t.s, t.e))) {
      var b = enclosing(s, k, 'button');
      if (b === -1 || !/^(?:play|watch)\b/i.test(labelOf(s, b, kit))) return false;
    }
    if (t.t === 'open' && (t.name === 'img' || t.name === 'picture' || t.name === 'iframe' || t.name === 'a' || t.name === 'h2' || t.name === 'h3')) return false;
    if (t.t === 'open' && t.name === 'button' && !/^(?:play|watch)\b/i.test(labelOf(s, k, kit))) return false;
  }
  return true;
}
function enclosing(s, k, name) {
  for (var p = k - 1; p >= 0; p--) if (s.tokens[p].t === 'open' && s.tokens[p].name === name && s.ends[p] >= k) return p;
  return -1;
}

module.exports = {
  inspect: inspect, placeholderHits: placeholderHits, recordPlaceholders: recordPlaceholders, looksLikeTest: looksLikeTest,
  samplesOf: samplesOf, sampleHits: sampleHits,
  noindexReason: noindexReason, robots: robots, isNoindexPage: isNoindexPage, repair: repair, storageRefs: storageRefs,
  nearBucket: nearBucket, yearsIn: yearsIn, sectionName: sectionName, ENQUIRY: ENQUIRY, REGISTER_RE: REGISTER_RE,
  PARTNER_RE: PARTNER_RE, PAYMENT_RE: PAYMENT_RE,
  /* before Publish (advisory): lib/site-advisory.js. read(html, kit): one reading of a page that each of these
     takes in place of the page's text, so a page is tokenized once for all of them */
  read: function (html, kit) { return scan(String(html == null ? '' : html), kit); },
  outsideLinks: outsideLinks, pageLinks: pageLinks, pictureRefs: pictureRefs, emptySections: emptySections,
  dateFindings: dateFindings, venueFindings: venueFindings, formButtons: formButtons, bannerLogo: bannerLogo,
  etLogoRecoloured: etLogoRecoloured, datesIn: datesIn, eventDays: eventDays
};
