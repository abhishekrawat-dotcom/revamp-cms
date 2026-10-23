/* The sections of an award microsite (an ET awards edition: ETCIO Awards, ET HR World Awards …), built by the
   server from the award's real records (et-awards.js) and, for the long-form pages, from text written for
   this edition — never a model's markup, so no category, fee, juror or partner is ever made up here.

     homeSections(award, o)          -> [{ id, name, kind: 'custom', prebuilt, purpose, layout, image: '', html, css }]
         award: { dates, categories, jury, partners }      o: { edition: 'ETCIO Awards 2027', dateLabel?, now? }
         one per list the award has, in this order:
           'key-dates'          prebuilt 'award-key-dates'   Nominations open → (Early bird) → Nomination deadline
                                                             → Jury evaluation → Awards night
           'award-categories'   prebuilt 'award-categories'  a summary: the master categories as cards, each with
                                                             its count of sub-categories, and a link to the
                                                             Award Categories page
           'award-jury'         prebuilt 'award-jury'        the Grand Jury (a moving row when many), and a link
                                                             to the Jury page
           'award-partners'     prebuilt 'award-partners'    partners by group (Knowledge Partner, Supporting …)
     pageSections(kind, content, o)  -> [{ id, name, html, css }]   the sections of one internal page, or [] when
                                                                    there is nothing to put on it
         kind: one of PAGE_KINDS[].kind      o: { edition, title? }
           'award-category'          content: categories   every master category, its sub-categories with their
                                                           description, a "New" badge and the nomination fee, and
                                                           an index of the master categories that stays in view
           'award-jury'              content: jury groups  each group under its heading, a card per juror that
                                                           opens their profile
           'award-guidelines' | 'award-judging-criteria' | 'award-tnc'
                                     content: { title, intro?, blocks: [{ heading, paragraphs, bullets }] }
                                                           a reading column; a block that lists steps is numbered
           'award-faq'               content: [{ q, a, group? }]   questions that open in place (<details>, so
                                                           they work without a script), grouped when grouped
         The first section of every page is its header ('<kind>-header'): the page's title and the event's name.
     PAGE_KINDS   [{ kind, slug, title }] in the order the pages are offered

   Data shapes (et-awards.js):
     dates      { nominationOpen, nominationClose, ceremony, earlyBird?, jury? }  'YYYY-MM-DD HH:MM:SS', '' or a
                label such as 'February 2027' / '15 October 2026'
     categories [{ name, slug, description, isNew, fee: { paid, amount, currency }, subcategories: [same, no subs] }]
     jury       [{ group, people: [{ name, title, company, photo, bio, linkedin }] }]
     partners   [{ group, items: [{ name, logo, url }] }]

   The conventions are those of prev-sections.js. Every colour and font is one of the page's variables
   (--rv-bg, --rv-surface, --rv-text, --rv-muted, --theme-color, --heading-font-family, --body-font-family,
   --rv-radius, and the readable brand pair --rv-theme-fill / --rv-on-theme, --rv-theme-ink, with the plain
   variable behind each), so the sections take the site's theme and one tone: a section stands on --rv-bg or
   --rv-surface, never the other way up. The one exception is a partner's logo, which is drawn for white and
   so sits on a white plate whatever the theme (as the previous edition's sponsors do). Motion is the page
   runtime's (templates/_shared/et-runtime.js: data-rv-carousel="auto", data-rv-reveal), pop-ups are
   templates/_shared/rv-popups.js's (a juror's card holding <template data-rv-profile> opens their profile).
   Every text is an element's own text, so the editor can change it; none is in an attribute or in CSS.
   Each section root is <section id="<id>" data-rv-section-id="<id>">; an internal page's carry
   data-rv-page="<kind>" too. Phone rules (640px and under) are in each section's own CSS. */

/* the section heading's size: the generated site's own type scale (templates/_shared/rv-type.js) */
var SECTION_HEADING = require('../../templates/_shared/rv-type.js').SECTION_HEADING.replace(/,\s+/g, ',');

var PAGE_KINDS = [
  { kind: 'award-category', slug: 'award-category', title: 'Award Categories' },
  { kind: 'award-guidelines', slug: 'award-guidelines', title: 'Entry Guidelines' },
  { kind: 'award-judging-criteria', slug: 'award-judging-criteria', title: 'Judging Criteria' },
  { kind: 'award-jury', slug: 'award-jury', title: 'Jury' },
  { kind: 'award-faq', slug: 'award-faq', title: 'FAQs' },
  { kind: 'award-tnc', slug: 'award-tnc', title: 'Terms & Conditions' }
];
var TEXT_KINDS = { 'award-guidelines': 1, 'award-judging-criteria': 1, 'award-tnc': 1 };

/* the brand pair, readable together (rv-theme.js derivedVars), with the plain variable behind each */
var FILL = 'var(--rv-theme-fill,var(--theme-color))';
var ON_FILL = 'var(--rv-on-theme,var(--rv-bg))';
var INK = 'var(--rv-theme-ink,var(--theme-color))';
var LINE = 'color-mix(in srgb,var(--rv-text) 14%,transparent)';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function httpsUrl(u) { u = String(u || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
function str(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
function list(v) { return Array.isArray(v) ? v : []; }
function slugify(s) { return str(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
/* a set of ids, each made once */
function idMaker(prefix) {
  var seen = Object.create(null);
  return function (s, n) {
    var base = prefix + (slugify(s) || String(n)), id = base, i = 2;
    while (seen[id]) id = base + '-' + i++;
    seen[id] = true;
    return id;
  };
}

/* ---------- dates ---------- */
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthIndex(name) {
  var n = String(name || '').toLowerCase().replace(/\.$/, '');
  if (n === 'sept') n = 'sep';
  for (var i = 0; i < 12; i++) { var m = MONTHS[i].toLowerCase(); if (n === m || (n.length >= 3 && n === m.slice(0, 3))) return i; }
  return -1;
}
var IST = 330 * 60000;   // ET's dates are India's
/* one date as { label, at } — at: the moment it is over (ms), NaN when that cannot be known; null when empty */
function when(v, dateLabel) {
  var s = str(v), m, label = '', at = NaN;
  if (!s || /^0{4}-0{2}-0{2}/.test(s)) return null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s))) {
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (!MONTHS[mo] || !d || d > 31) return null;
    label = d + ' ' + MONTHS[mo] + ' ' + y;
    /* a time of day other than midnight is the moment; otherwise the day is over at its end */
    at = m[4] && (+m[4] || +m[5]) ? Date.UTC(y, mo, d, +m[4], +m[5]) - IST : Date.UTC(y, mo, d + 1) - IST;
  } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+\.?),?\s+(\d{4})$/.exec(s)) && monthIndex(m[2]) !== -1) {
    label = +m[1] + ' ' + MONTHS[monthIndex(m[2])] + ' ' + m[3];
    at = Date.UTC(+m[3], monthIndex(m[2]), +m[1] + 1) - IST;
  } else if ((m = /^([A-Za-z]+\.?),?\s+(\d{4})$/.exec(s)) && monthIndex(m[1]) !== -1) {
    label = MONTHS[monthIndex(m[1])] + ' ' + m[2];
    at = Date.UTC(+m[2], monthIndex(m[1]) + 1, 1) - IST;
  } else {
    label = s.slice(0, 60);   // a label of the owner's ("Third week of January"): shown as written
  }
  if (typeof dateLabel === 'function') {
    var own = '';
    try { own = str(dateLabel(v)); } catch (e) { own = ''; }
    if (own) label = own;
  }
  return { label: label, at: at };
}

/* ---------- money ---------- */
function indianDigits(n) {
  var s = String(Math.floor(n)), last = s.slice(-3), rest = s.slice(0, -3);
  return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last;
}
function westernDigits(n) { return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
var SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
function money(amount, currency) {
  var cur = str(currency).toUpperCase().replace(/[^A-Z₹$€£]/g, '') || 'INR';
  if (cur === '₹' || cur === 'RS' || cur === 'INR') cur = 'INR';
  var cents = Math.round(amount * 100) % 100;
  var whole = cur === 'INR' ? indianDigits(amount) : westernDigits(amount);
  var num = whole + (cents ? '.' + (cents < 10 ? '0' : '') + cents : '');
  return SYMBOL[cur] ? SYMBOL[cur] + num : cur + ' ' + num;
}
/* the fee line: "Nomination fee: ₹2,000", "No nomination fee", or '' when nothing is known */
function feeText(fee) {
  if (!fee || typeof fee !== 'object') return '';
  var amount = Number(String(fee.amount == null ? '' : fee.amount).replace(/[^\d.]/g, ''));
  var hasAmount = isFinite(amount) && amount > 0;
  if (fee.paid === false || fee.paid === 0 || fee.paid === 'false') return 'No nomination fee';
  if (hasAmount) return 'Nomination fee: ' + money(amount, fee.currency);
  if (fee.paid) return 'Nomination fee applies';
  if (fee.amount === 0 || fee.amount === '0') return 'No nomination fee';
  return '';
}

/* ---------- shared pieces ---------- */
function root(id, cls, kind, extra) {
  return '<section id="' + esc(id) + '" data-rv-section-id="' + esc(id) + '"' + (kind ? ' data-rv-page="' + esc(kind) + '"' : '') +
    ' class="' + cls + '" aria-labelledby="' + esc(id) + '-title"' + (extra || '') + '>';
}
/* the head of a home section: an eyebrow with the edition, the heading, an optional line under it */
function head(cls, id, edition, title, lead) {
  return '<div class="' + cls + '-head" data-rv-reveal>' +
    (edition ? '<p class="' + cls + '-eyebrow">' + esc(edition) + '</p>' : '') +
    '<h2 class="' + cls + '-title" id="' + esc(id) + '-title">' + esc(title) + '</h2>' +
    (lead ? '<p class="' + cls + '-lead">' + esc(lead) + '</p>' : '') + '</div>';
}
function baseCss(c, ground) {
  return '.' + c + '{background:var(' + (ground || '--rv-bg') + ');color:var(--rv-text);padding:clamp(64px,8vw,112px) 0;font-family:var(--body-font-family)}' +
    '.' + c + '-in{max-width:1200px;margin:0 auto;padding:0 24px}' +
    '.' + c + '-head{text-align:center;margin:0 0 44px}' +
    '.' + c + '-eyebrow{margin:0 0 10px;font-size:0.875rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:' + INK + '}' +
    '.' + c + '-title{margin:0;font-family:var(--heading-font-family);font-size:' + SECTION_HEADING + ';line-height:1.15;color:var(--rv-text)}' +
    '.' + c + '-lead{margin:12px auto 0;max-width:640px;font-size:1.0625rem;line-height:1.6;color:var(--rv-muted)}' +
    '@media (max-width:640px){.' + c + '-in{padding:0 16px}.' + c + '-head{margin:0 0 32px}}';
}
/* the "New" badge beside a category's name */
function newBadge(cls) { return '<span class="' + cls + '">New</span>'; }
function badgeCss(sel) {
  return sel + '{display:inline-block;flex:0 0 auto;padding:3px 9px;border-radius:999px;background:' + FILL + ';color:' + ON_FILL + ';font-size:0.6875rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;line-height:1.4}';
}
/* a link that opens one of the award's own pages (the site's page runtime reads data-rv-page-link) */
function pageLink(cls, kind, label) {
  return '<div class="' + cls + '-more"><a class="' + cls + '-btn" data-rv-page-link="' + esc(kind) + '" href="' + esc(kind) + '">' + esc(label) + '</a></div>';
}
function buttonCss(c) {
  return '.' + c + '-more{margin:44px 0 0;text-align:center}' +
    '.' + c + '-btn{display:inline-flex;align-items:center;justify-content:center;padding:15px 30px;border-radius:var(--rv-radius,8px);background:' + FILL + ';color:' + ON_FILL + ';font-family:var(--body-font-family);font-size:1rem;font-weight:600;line-height:1.2;text-decoration:none;transition:transform .25s ease,filter .25s ease}' +
    '.' + c + '-btn:hover{transform:translateY(-2px);filter:brightness(1.06)}' +
    '.' + c + '-btn:focus-visible{outline:3px solid var(--theme-color);outline-offset:3px}' +
    '@media (max-width:640px){.' + c + '-more{margin-top:32px}.' + c + '-btn{display:flex;width:100%;min-height:48px;text-align:center}}';
}

/* ---------- a juror's card ---------- */
function initialsOf(name) { return str(name).split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
/* what a visitor sees on clicking the card (rv-popups.js): the text and the LinkedIn profile, kept in a
   <template> (never drawn, still plain markup). A juror with neither has no <template>, and the card does not open. */
function profileOf(p) {
  var li = httpsUrl(p.linkedin), bio = str(p.bio);
  if (!bio && !li) return '';
  return '<template data-rv-profile><span data-rv-profile-for hidden>' + esc(p.name) + '</span>' +
    (bio ? '<p data-rv-profile-bio>' + esc(bio) + '</p>' : '') +
    (li ? '<a data-rv-profile-li href="' + esc(li) + '" target="_blank" rel="noopener">LinkedIn</a>' : '') + '</template>';
}
function personCard(c, p) {
  var photo = httpsUrl(p.photo), name = str(p.name), role = str(p.title), co = str(p.company);
  return '<article class="' + c + '-card">' +
    '<div class="' + c + '-ph">' + (photo ? '<img src="' + esc(photo) + '" alt="' + esc(name) + '" loading="lazy">' : '<span aria-hidden="true">' + esc(initialsOf(name)) + '</span>') + '</div>' +
    '<h3 class="' + c + '-name" data-rv-profile-name>' + esc(name) + '</h3>' +
    (role ? '<p class="' + c + '-role" data-rv-profile-role>' + esc(role) + '</p>' : '') +
    (co ? '<p class="' + c + '-co" data-rv-profile-co>' + esc(co) + '</p>' : '') + profileOf(p) + '</article>';
}
function personCss(c, width) {
  return '.' + c + '-card{width:' + width + ';background:var(--rv-surface);border:1px solid ' + LINE + ';border-radius:var(--rv-radius,12px);padding:16px 16px 20px;transition:transform .3s ease,border-color .3s ease}' +
    '.' + c + '-card:hover{transform:translateY(-4px);border-color:var(--theme-color)}' +
    '.' + c + '-ph{aspect-ratio:1/1;border-radius:calc(var(--rv-radius,12px) * .8);overflow:hidden;background:var(--rv-bg);display:grid;place-items:center;margin:0 0 14px}' +
    '.' + c + '-ph img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}' +
    '.' + c + '-ph span{font-family:var(--heading-font-family);font-size:2.4rem;font-weight:700;color:' + INK + '}' +
    '.' + c + '-name{margin:0;font-family:var(--heading-font-family);font-size:1.125rem;line-height:1.3;color:var(--rv-text)}' +
    '.' + c + '-role{margin:6px 0 0;font-size:0.9rem;line-height:1.45;color:var(--rv-muted)}' +
    '.' + c + '-co{margin:4px 0 0;font-size:0.9rem;line-height:1.45;font-weight:600;color:var(--rv-text)}';
}
function people(group) { return list(group && group.people).filter(function (p) { return p && str(p.name); }); }
function juryGroups(jury) {
  return list(jury).map(function (g) { return { group: str(g && g.group), people: people(g) }; }).filter(function (g) { return g.people.length; });
}

/* ================= the home page ================= */

var CHECK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function keyDates(award, o) {
  var d = (award && award.dates) || {}, now = o.now == null ? Date.now() : +o.now;
  var defs = [
    { key: 'nominationOpen', name: 'Nominations open' },
    { key: 'earlyBird', name: 'Early bird deadline', optional: true },
    { key: 'nominationClose', name: 'Nomination deadline' },
    { key: 'jury', name: 'Jury evaluation' },
    { key: 'ceremony', name: 'Awards night' }
  ];
  var known = 0;
  var steps = defs.map(function (s) {
    var w = when(d[s.key] != null ? d[s.key] : s.key === 'jury' ? d.juryRound : null, o.dateLabel);
    if (w && s.key !== 'jury') known++;
    return { name: s.name, w: w, optional: s.optional };
  }).filter(function (s) { return s.w || !s.optional; });
  if (!known) return null;
  /* done: its moment has passed — and every step before a done one is done too */
  var lastDone = -1;
  steps.forEach(function (s, i) { if (s.w && s.w.at < now) lastDone = i; });
  var c = 'aw-kd', id = 'key-dates';
  var items = steps.map(function (s, i) {
    var done = i <= lastDone, next = i === lastDone + 1;
    var date = s.w ? s.w.label : done ? 'Completed' : 'To be announced';
    return '<li class="' + c + '-step' + (done ? ' is-done' : '') + (next ? ' is-next' : '') + (s.w ? '' : ' is-tba') + '"' + (next ? ' aria-current="step"' : '') + ' data-rv-reveal>' +
      '<span class="' + c + '-dot" aria-hidden="true">' + (done ? CHECK : '') + '</span>' +
      '<div class="' + c + '-card">' +
      '<h3 class="' + c + '-name">' + esc(s.name) + '</h3>' +
      '<p class="' + c + '-date">' + esc(date) + '</p>' +
      (done && s.w ? '<p class="' + c + '-state">Completed</p>' : next ? '<p class="' + c + '-state">Up next</p>' : '') +
      '</div></li>';
  }).join('');
  var html = root(id, c, '') + '<div class="' + c + '-in">' + head(c, id, o.edition, 'Key Dates') +
    '<ol class="' + c + '-list">' + items + '</ol></div></section>';
  var css = baseCss(c) +
    '.' + c + '-list{list-style:none;margin:0 auto;padding:0;max-width:1120px;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:20px;counter-reset:aw-kd}' +
    '.' + c + '-step{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;counter-increment:aw-kd;min-width:0}' +
    /* the line to the next step, behind the dots */
    '.' + c + '-step:not(:last-child)::after{content:"";position:absolute;top:23px;left:calc(50% + 30px);width:calc(100% - 40px);height:2px;background:' + LINE + '}' +
    '.' + c + '-step.is-done:not(:last-child)::after{background:var(--theme-color)}' +
    '.' + c + '-dot{position:relative;z-index:1;display:grid;place-items:center;width:48px;height:48px;border-radius:50%;border:2px solid ' + LINE + ';background:var(--rv-bg);color:var(--rv-muted);font-family:var(--heading-font-family);font-weight:700;font-size:1rem;margin:0 0 18px;flex:0 0 auto}' +
    '.' + c + '-dot:empty::before{content:counter(aw-kd)}' +
    '.' + c + '-step.is-done .' + c + '-dot{background:' + FILL + ';border-color:' + FILL + ';color:' + ON_FILL + '}' +
    '.' + c + '-step.is-next .' + c + '-dot{border-color:var(--theme-color);color:' + INK + ';box-shadow:0 0 0 6px color-mix(in srgb,var(--theme-color) 18%,transparent)}' +
    '.' + c + '-card{width:100%;background:var(--rv-surface);border:1px solid ' + LINE + ';border-radius:var(--rv-radius,12px);padding:18px 16px 20px;flex:1 1 auto}' +
    '.' + c + '-step.is-next .' + c + '-card{border-color:var(--theme-color)}' +
    '.' + c + '-name{margin:0;font-family:var(--heading-font-family);font-size:1.0625rem;line-height:1.3;color:var(--rv-text)}' +
    '.' + c + '-date{margin:8px 0 0;font-size:1rem;font-weight:700;line-height:1.4;color:' + INK + '}' +
    '.' + c + '-step.is-tba .' + c + '-date{font-weight:600;color:var(--rv-muted)}' +
    '.' + c + '-step.is-done .' + c + '-date{color:var(--rv-muted)}' +
    '.' + c + '-state{margin:10px 0 0;font-size:0.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--rv-muted)}' +
    '.' + c + '-step.is-next .' + c + '-state{color:' + INK + '}' +
    /* tablets and phones: one under another, the line down the left */
    '@media (max-width:900px){.' + c + '-list{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:minmax(0,1fr);gap:16px;max-width:560px}' +
      '.' + c + '-step{flex-direction:row;align-items:stretch;text-align:left;gap:16px}' +
      '.' + c + '-step:not(:last-child)::after{top:52px;left:23px;width:2px;height:calc(100% - 40px)}' +
      '.' + c + '-dot{margin:0}' +
      '.' + c + '-card{padding:14px 16px 16px}}';
  return { html: html, css: css };
}

function categoriesSummary(award, o) {
  var cats = list(award && award.categories).filter(function (x) { return x && str(x.name); });
  if (!cats.length) return null;
  var c = 'aw-cat', id = 'award-categories';
  var subs = cats.reduce(function (n, x) { return n + list(x.subcategories).filter(function (s) { return s && str(s.name); }).length; }, 0);
  var lead = cats.length + ' master ' + (cats.length === 1 ? 'category' : 'categories') + (subs ? ' · ' + subs + ' sub-' + (subs === 1 ? 'category' : 'categories') : '');
  var cards = cats.map(function (x, i) {
    var n = list(x.subcategories).filter(function (s) { return s && str(s.name); }).length;
    return '<article class="' + c + '-card" data-rv-reveal>' +
      '<div class="' + c + '-top"><p class="' + c + '-num">' + (i < 9 ? '0' : '') + (i + 1) + '</p>' + (x.isNew ? newBadge(c + '-new') : '') + '</div>' +
      '<h3 class="' + c + '-name">' + esc(str(x.name)) + '</h3>' +
      (str(x.description) ? '<p class="' + c + '-desc">' + esc(str(x.description)) + '</p>' : '') +
      (n ? '<p class="' + c + '-count">' + n + ' sub-' + (n === 1 ? 'category' : 'categories') + '</p>' : '') + '</article>';
  }).join('');
  var html = root(id, c, '') + '<div class="' + c + '-in">' + head(c, id, o.edition, 'Award Categories', lead) +
    '<div class="' + c + '-grid">' + cards + '</div>' + pageLink(c, 'award-category', 'View all categories') + '</div></section>';
  var css = baseCss(c, '--rv-surface') + buttonCss(c) +
    /* a short last row stands in the middle, not at the left */
    '.' + c + '-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:20px}' +
    '.' + c + '-card{flex:0 1 calc((100% - 60px) / 4);min-width:250px;display:flex;flex-direction:column;background:var(--rv-bg);border:1px solid ' + LINE + ';border-top:3px solid var(--theme-color);border-radius:var(--rv-radius,12px);padding:22px 22px 20px;transition:transform .3s ease}' +
    '.' + c + '-card:hover{transform:translateY(-4px)}' +
    '.' + c + '-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}' +
    '.' + c + '-num{margin:0;font-family:var(--heading-font-family);font-size:0.875rem;font-weight:700;letter-spacing:.12em;color:' + INK + '}' +
    badgeCss('.' + c + '-new') +
    '.' + c + '-name{margin:0;font-family:var(--heading-font-family);font-size:1.1875rem;line-height:1.3;color:var(--rv-text)}' +
    '.' + c + '-desc{margin:10px 0 0;font-size:0.95rem;line-height:1.55;color:var(--rv-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}' +
    '.' + c + '-count{margin:auto 0 0;padding:16px 0 0;font-size:0.875rem;font-weight:700;color:var(--rv-text)}' +
    '@media (max-width:640px){.' + c + '-grid{gap:14px}.' + c + '-card{flex:1 1 100%;min-width:0;padding:18px}}';
  return { html: html, css: css, lead: lead };
}

/* the Grand Jury: the group so named, else the first */
function grandJury(jury) {
  var groups = juryGroups(jury);
  return groups.filter(function (g) { return /grand/i.test(g.group); })[0] || groups[0] || null;
}
function juryHome(award, o) {
  var g = grandJury(award && award.jury);
  if (!g) return null;
  var c = 'aw-jury', id = 'award-jury', many = g.people.length > 4;
  var cards = g.people.map(function (p) { return personCard(c, p); }).join('');
  var row = many
    ? '<div class="' + c + '-row" data-rv-carousel="auto"><div class="' + c + '-track" data-rv-carousel-track>' + cards + '</div></div>'
    : '<div class="' + c + '-grid">' + cards + '</div>';
  var html = root(id, c, '', ' data-rv-profiles') + '<div class="' + c + '-in">' + head(c, id, o.edition, g.group || 'Jury') + row +
    pageLink(c, 'award-jury', 'Meet the jury') + '</div></section>';
  var css = baseCss(c) + buttonCss(c) + personCss(c, '236px') +
    '.' + c + '-row{position:relative}.' + c + '-track{gap:24px;padding:4px 2px 12px}' +
    '.' + c + '-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:24px}' +
    '@media (max-width:820px){.' + c + '-card{width:200px}}' +
    '@media (max-width:640px){.' + c + '-row .' + c + '-card{width:72%;max-width:260px}.' + c + '-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.' + c + '-grid .' + c + '-card{width:auto;padding:10px 10px 14px}.' + c + '-grid .' + c + '-name{font-size:1rem}}';
  return { html: html, css: css, title: g.group || 'Jury', count: g.people.length };
}

function partnerGroups(partners) {
  return list(partners).map(function (g) {
    return { group: str(g && g.group), items: list(g && g.items).filter(function (x) { return x && (httpsUrl(x.logo) || str(x.name)); }) };
  }).filter(function (g) { return g.items.length; });
}
function partnersHome(award, o) {
  var groups = partnerGroups(award && award.partners);
  if (!groups.length) return null;
  var c = 'aw-prt', id = 'award-partners';
  var body = groups.map(function (g) {
    return '<div class="' + c + '-group" data-rv-reveal>' + (g.group ? '<h3 class="' + c + '-label">' + esc(g.group) + '</h3>' : '') +
      '<div class="' + c + '-tiles">' + g.items.map(function (x) {
        var logo = httpsUrl(x.logo), href = httpsUrl(x.url), name = str(x.name);
        var img = logo ? '<img src="' + esc(logo) + '" alt="' + esc(name || g.group || 'Partner') + '" loading="lazy">' : '<span>' + esc(name) + '</span>';
        return '<div class="' + c + '-logo">' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + img + '</a>' : img) + '</div>';
      }).join('') + '</div></div>';
  }).join('');
  var html = root(id, c, '') + '<div class="' + c + '-in">' + head(c, id, o.edition, 'Partners') + '<div class="' + c + '-groups">' + body + '</div></div></section>';
  var css = baseCss(c, '--rv-surface') +
    '.' + c + '-groups{display:flex;flex-wrap:wrap;justify-content:center;gap:40px 56px}' +
    '.' + c + '-group{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:100%}' +
    '.' + c + '-label{margin:0;font-family:var(--body-font-family);font-size:0.8125rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;line-height:1.4;text-align:center;color:var(--rv-muted)}' +
    '.' + c + '-tiles{display:flex;flex-wrap:wrap;justify-content:center;gap:16px;max-width:100%}' +
    /* logos are drawn for white: they sit on white plates whatever the theme (as prev-sections.js's sponsors) */
    '.' + c + '-logo{--rv-keep:1;width:200px;height:110px;background:#ffffff;border-radius:var(--rv-radius,12px);display:grid;place-items:center;padding:16px 20px;border:1px solid ' + LINE + ';transition:transform .3s ease}' +
    '.' + c + '-logo:hover{transform:translateY(-3px)}' +
    '.' + c + '-logo a{display:grid;place-items:center;width:100%;height:100%}' +
    '.' + c + '-logo img{max-width:100%;max-height:72px;width:auto;height:auto;object-fit:contain;display:block}' +
    '.' + c + '-logo span{font-weight:700;color:#1b1d22;text-align:center;line-height:1.3}' +
    '@media (max-width:640px){.' + c + '-groups{gap:32px}.' + c + '-tiles{gap:12px}.' + c + '-logo{width:calc(50vw - 30px);max-width:180px;height:92px;padding:12px 14px}.' + c + '-logo img{max-height:60px}}';
  return { html: html, css: css };
}

function homeSections(award, o) {
  o = o || {};
  award = award || {};
  var out = [];
  var kd = keyDates(award, o);
  if (kd) out.push({ id: 'key-dates', name: 'Key Dates', kind: 'custom', prebuilt: 'award-key-dates', image: '',
    purpose: 'Key Dates — when nominations open and close, the jury evaluates and the awards night is held, from the award’s own dates. Built by the server.',
    layout: 'a timeline of steps, the ones past marked done', html: kd.html, css: kd.css });
  var cs = categoriesSummary(award, o);
  if (cs) out.push({ id: 'award-categories', name: 'Award Categories', kind: 'custom', prebuilt: 'award-categories', image: '',
    purpose: 'Award Categories — the master categories (' + cs.lead + ') and a link to the full list. Built by the server from the award’s records.',
    layout: 'a grid of cards, one per master category, and a button', html: cs.html, css: cs.css });
  var jh = juryHome(award, o);
  if (jh) out.push({ id: 'award-jury', name: 'Jury', kind: 'custom', prebuilt: 'award-jury', image: '',
    purpose: 'The ' + jh.title + ' — the real jurors of this edition (' + jh.count + '), each opening their profile, and a link to the Jury page. Built by the server.',
    layout: jh.count > 4 ? 'an auto-advancing carousel of juror cards and a button' : 'a row of juror cards and a button', html: jh.html, css: jh.css });
  var pt = partnersHome(award, o);
  if (pt) out.push({ id: 'award-partners', name: 'Partners', kind: 'custom', prebuilt: 'award-partners', image: '',
    purpose: 'Partners — the award’s real partners by group (Knowledge Partner, Supporting Partners …). Built by the server.',
    layout: 'logos on plates, under each group’s name', html: pt.html, css: pt.css });
  return out;
}

/* ================= the internal pages ================= */

function pageHeader(kind, title, edition) {
  var c = 'aw-ph', id = kind + '-header';
  var html = root(id, c, kind) + '<div class="' + c + '-in" data-rv-reveal>' +
    (edition ? '<p class="' + c + '-eyebrow">' + esc(edition) + '</p>' : '') +
    '<h1 class="' + c + '-title" id="' + esc(id) + '-title">' + esc(title) + '</h1></div></section>';
  var css = '.' + c + '{background:var(--rv-surface);color:var(--rv-text);padding:clamp(56px,7vw,96px) 0 clamp(40px,5vw,64px);font-family:var(--body-font-family);border-bottom:1px solid ' + LINE + '}' +
    '.' + c + '-in{max-width:1200px;margin:0 auto;padding:0 24px;text-align:center}' +
    '.' + c + '-eyebrow{margin:0 0 12px;font-size:0.875rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:' + INK + '}' +
    '.' + c + '-title{margin:0;font-family:var(--heading-font-family);font-size:' + SECTION_HEADING + ';line-height:1.15;color:var(--rv-text)}' +
    '.' + c + '-title::after{content:"";display:block;width:56px;height:3px;margin:18px auto 0;border-radius:3px;background:var(--theme-color)}' +
    '@media (max-width:640px){.' + c + '-in{padding:0 16px}}';
  return { id: id, name: title + ' — page header', html: html, css: css };
}

function categoryPage(kind, content, o) {
  var cats = list(content).filter(function (x) { return x && str(x.name); });
  if (!cats.length) return [];
  var c = 'aw-cl', id = 'award-category-list', anchor = idMaker('award-cat-');
  var subTotal = 0;
  var masters = cats.map(function (x, i) {
    var subs = list(x.subcategories).filter(function (s) { return s && str(s.name); });
    subTotal += subs.length;
    return { x: x, subs: subs, anchor: anchor(x.slug || x.name, i + 1) };
  });
  var index = masters.length > 1
    ? '<nav class="' + c + '-index" aria-label="Master categories"><p class="' + c + '-index-title">Master categories</p><ol class="' + c + '-index-list">' +
      masters.map(function (m) { return '<li><a href="#' + esc(m.anchor) + '">' + esc(str(m.x.name)) + '</a></li>'; }).join('') + '</ol></nav>'
    : '';
  var body = masters.map(function (m, i) {
    var x = m.x, own = feeText(x.fee);
    return '<article class="' + c + '-master" id="' + esc(m.anchor) + '" data-rv-reveal>' +
      '<p class="' + c + '-num">Category ' + (i < 9 ? '0' : '') + (i + 1) + '</p>' +
      '<div class="' + c + '-mhead"><h2 class="' + c + '-mname">' + esc(str(x.name)) + '</h2>' + (x.isNew ? newBadge(c + '-new') : '') + '</div>' +
      (str(x.description) ? '<p class="' + c + '-mdesc">' + esc(str(x.description)) + '</p>' : '') +
      (!m.subs.length && own ? '<p class="' + c + '-fee">' + esc(own) + '</p>' : '') +
      (m.subs.length ? '<ul class="' + c + '-subs">' + m.subs.map(function (s) {
        var fee = feeText(s.fee) || own;
        return '<li class="' + c + '-sub"><div class="' + c + '-shead"><h3 class="' + c + '-sname">' + esc(str(s.name)) + '</h3>' + (s.isNew ? newBadge(c + '-new') : '') + '</div>' +
          (str(s.description) ? '<p class="' + c + '-sdesc">' + esc(str(s.description)) + '</p>' : '') +
          (fee ? '<p class="' + c + '-fee">' + esc(fee) + '</p>' : '') + '</li>';
      }).join('') + '</ul>' : '') + '</article>';
  }).join('');
  var lead = cats.length + ' master ' + (cats.length === 1 ? 'category' : 'categories') + (subTotal ? ' · ' + subTotal + ' sub-' + (subTotal === 1 ? 'category' : 'categories') : '');
  var html = root(id, c, kind) + '<div class="' + c + '-in">' +
    '<h2 class="' + c + '-sr" id="' + id + '-title">Categories</h2><p class="' + c + '-lead">' + esc(lead) + '</p>' +
    '<div class="' + c + '-layout' + (index ? '' : ' is-single') + '">' + index + '<div class="' + c + '-body">' + body + '</div></div></div></section>';
  var css = '.' + c + '{background:var(--rv-bg);color:var(--rv-text);padding:clamp(40px,6vw,80px) 0 clamp(64px,8vw,112px);font-family:var(--body-font-family)}' +
    '.' + c + '-in{max-width:1200px;margin:0 auto;padding:0 24px}' +
    /* the list's heading is for screen readers: the page header above says it */
    '.' + c + '-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    '.' + c + '-lead{margin:0 0 32px;font-size:1rem;font-weight:600;color:var(--rv-muted)}' +
    '.' + c + '-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:48px;align-items:start}' +
    '.' + c + '-layout.is-single{grid-template-columns:minmax(0,1fr)}' +
    '.' + c + '-index{position:sticky;top:96px;max-height:calc(100vh - 120px);overflow:auto;background:var(--rv-surface);border:1px solid ' + LINE + ';border-radius:var(--rv-radius,12px);padding:18px 14px}' +
    '.' + c + '-index-title{margin:0 0 10px;padding:0 8px;font-size:0.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--rv-muted)}' +
    '.' + c + '-index-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}' +
    '.' + c + '-index-list a{display:block;padding:8px;border-radius:calc(var(--rv-radius,12px) * .6);font-size:0.9375rem;line-height:1.35;color:var(--rv-text);text-decoration:none}' +
    '.' + c + '-index-list a:hover,.' + c + '-index-list a:focus-visible{background:color-mix(in srgb,var(--theme-color) 12%,transparent);color:' + INK + '}' +
    '.' + c + '-index-list a:focus-visible{outline:2px solid var(--theme-color);outline-offset:1px}' +
    '.' + c + '-body{display:flex;flex-direction:column;gap:56px;min-width:0}' +
    '.' + c + '-master{scroll-margin-top:96px}' +
    '.' + c + '-num{margin:0 0 8px;font-size:0.8125rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:' + INK + '}' +
    '.' + c + '-mhead,.' + c + '-shead{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px}' +
    '.' + c + '-mname{margin:0;font-family:var(--heading-font-family);font-size:clamp(1.375rem,2.2vw,1.625rem);line-height:1.25;color:var(--rv-text)}' +
    badgeCss('.' + c + '-new') +
    '.' + c + '-mdesc{margin:10px 0 0;max-width:760px;font-size:1.0625rem;line-height:1.65;color:var(--rv-muted)}' +
    '.' + c + '-subs{list-style:none;margin:24px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}' +
    '.' + c + '-sub{display:flex;flex-direction:column;background:var(--rv-surface);border:1px solid ' + LINE + ';border-radius:var(--rv-radius,12px);padding:20px}' +
    '.' + c + '-sname{margin:0;font-family:var(--heading-font-family);font-size:1.125rem;line-height:1.35;color:var(--rv-text)}' +
    '.' + c + '-sdesc{margin:8px 0 0;font-size:0.95rem;line-height:1.6;color:var(--rv-muted)}' +
    '.' + c + '-fee{margin:16px 0 0;padding:12px 0 0;border-top:1px solid ' + LINE + ';font-size:0.9rem;font-weight:700;color:var(--rv-text)}' +
    /* the fee line at the foot of every card, so that a row's fee lines are level */
    '.' + c + '-sub .' + c + '-fee{margin-top:auto}' +
    '.' + c + '-sub > :has(+ .' + c + '-fee){margin-bottom:16px}' +
    /* a master category with no sub-categories: its fee as a chip under its description */
    '.' + c + '-master > .' + c + '-fee{display:inline-block;margin:18px 0 0;padding:9px 16px;border:1px solid ' + LINE + ';border-radius:999px;background:var(--rv-surface)}' +
    '@media (max-width:900px){.' + c + '-layout{grid-template-columns:minmax(0,1fr);gap:32px}' +
      '.' + c + '-index{position:static;max-height:none;padding:14px}' +
      '.' + c + '-index-list{flex-direction:row;flex-wrap:wrap;gap:8px}' +
      '.' + c + '-index-list a{padding:7px 12px;border:1px solid ' + LINE + ';border-radius:999px;font-size:0.875rem}}' +
    '@media (max-width:640px){.' + c + '-in{padding:0 16px}.' + c + '-body{gap:44px}.' + c + '-subs{grid-template-columns:minmax(0,1fr);gap:12px}.' + c + '-sub{padding:16px}}';
  return [{ id: id, name: 'Category list', html: html, css: css }];
}

function juryPage(kind, content, o) {
  var groups = juryGroups(content);
  if (!groups.length) return [];
  var c = 'aw-jp', id = 'award-jury-groups';
  var named = groups.length > 1 || groups[0].group;
  var body = groups.map(function (g, i) {
    return '<div class="' + c + '-group">' +
      (named ? '<h2 class="' + c + '-gname"' + (i === 0 ? ' id="' + id + '-title"' : '') + ' data-rv-reveal>' + esc(g.group || 'Jury') + '</h2>' : '') +
      '<div class="' + c + '-grid">' + g.people.map(function (p) { return personCard(c, p); }).join('') + '</div></div>';
  }).join('');
  var html = root(id, c, kind, ' data-rv-profiles') + '<div class="' + c + '-in">' +
    (named ? '' : '<h2 class="' + c + '-sr" id="' + id + '-title">Jury members</h2>') + body + '</div></section>';
  var css = '.' + c + '{background:var(--rv-bg);color:var(--rv-text);padding:clamp(48px,6vw,88px) 0 clamp(64px,8vw,112px);font-family:var(--body-font-family)}' +
    '.' + c + '-in{max-width:1200px;margin:0 auto;padding:0 24px;display:flex;flex-direction:column;gap:64px}' +
    '.' + c + '-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    '.' + c + '-gname{margin:0 0 28px;text-align:center;font-family:var(--heading-font-family);font-size:clamp(1.5rem,2.4vw,1.875rem);line-height:1.2;color:var(--rv-text)}' +
    '.' + c + '-gname::after{content:"";display:block;width:44px;height:3px;margin:14px auto 0;border-radius:3px;background:var(--theme-color)}' +
    /* centred rows under the centred heading: a short last row stands in the middle */
    '.' + c + '-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:24px}' +
    personCss(c, '260px') +
    '@media (max-width:900px){.' + c + '-card{width:220px}}' +
    '@media (max-width:640px){.' + c + '-in{padding:0 16px;gap:48px}.' + c + '-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.' + c + '-card{width:auto;padding:10px 10px 14px}.' + c + '-name{font-size:1rem}.' + c + '-role,.' + c + '-co{font-size:0.8125rem}}';
  return [{ id: id, name: 'Jury members', html: html, css: css }];
}

/* a block reads as steps when its heading says so, or each of its points starts with its own number */
var NUMBERED = /^\s*(?:step\s*)?\d{1,2}\s*[.):\-–]\s*/i;
function looksLikeSteps(b) {
  var bullets = b.bullets;
  if (bullets.length < 2) return false;
  if (bullets.every(function (x) { return NUMBERED.test(x); })) return true;
  return /\b(steps?|how to|process|procedure|stages?)\b/i.test(b.heading);
}
function textPage(kind, content, o) {
  content = content || {};
  var intro = str(content.intro);
  var blocks = list(content.blocks).map(function (b) {
    b = b || {};
    return {
      heading: str(b.heading),
      paragraphs: list(b.paragraphs).map(str).filter(Boolean),
      bullets: list(b.bullets).map(str).filter(Boolean)
    };
  }).filter(function (b) { return b.heading || b.paragraphs.length || b.bullets.length; });
  if (!intro && !blocks.length) return [];
  var c = 'aw-tx', id = kind + '-body', titled = false;
  var body = blocks.map(function (b) {
    var steps = looksLikeSteps(b);
    var h = '';
    if (b.heading) { h = '<h2 class="' + c + '-h"' + (titled ? '' : ' id="' + id + '-title"') + '>' + esc(b.heading) + '</h2>'; titled = true; }
    return '<div class="' + c + '-block" data-rv-reveal>' + h +
      b.paragraphs.map(function (p) { return '<p class="' + c + '-p">' + esc(p) + '</p>'; }).join('') +
      (b.bullets.length ? (steps
        ? '<ol class="' + c + '-steps">' + b.bullets.map(function (x) { return '<li>' + esc(x.replace(NUMBERED, '') || x) + '</li>'; }).join('') + '</ol>'
        : '<ul class="' + c + '-bullets">' + b.bullets.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>') : '') + '</div>';
  }).join('');
  var html = root(id, c, kind) + '<div class="' + c + '-in">' +
    (titled ? '' : '<h2 class="' + c + '-sr" id="' + id + '-title">' + esc(str(content.title) || titleOf(kind)) + '</h2>') +
    (intro ? '<p class="' + c + '-lead" data-rv-reveal>' + esc(intro) + '</p>' : '') + body + '</div></section>';
  var css = '.' + c + '{background:var(--rv-bg);color:var(--rv-text);padding:clamp(48px,6vw,88px) 0 clamp(64px,8vw,112px);font-family:var(--body-font-family)}' +
    '.' + c + '-in{max-width:808px;margin:0 auto;padding:0 24px}' +
    '.' + c + '-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    '.' + c + '-lead{margin:0 0 40px;font-size:1.1875rem;line-height:1.7;color:var(--rv-text)}' +
    '.' + c + '-block{padding:0 0 36px;margin:0 0 36px;border-bottom:1px solid ' + LINE + '}' +
    '.' + c + '-block:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}' +
    '.' + c + '-h{margin:0 0 14px;font-family:var(--heading-font-family);font-size:clamp(1.25rem,2vw,1.5rem);line-height:1.3;color:var(--rv-text)}' +
    '.' + c + '-p{margin:0 0 14px;font-size:1.0625rem;line-height:1.75;color:var(--rv-text)}' +
    '.' + c + '-p:last-child{margin-bottom:0}' +
    '.' + c + '-bullets,.' + c + '-steps{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:12px}' +
    '.' + c + '-bullets li,.' + c + '-steps li{position:relative;font-size:1.0625rem;line-height:1.7;color:var(--rv-text)}' +
    '.' + c + '-bullets li{padding-left:28px}' +
    '.' + c + '-bullets li::before{content:"";position:absolute;left:4px;top:.68em;width:8px;height:8px;border-radius:50%;background:var(--theme-color)}' +
    '.' + c + '-steps{counter-reset:aw-tx;gap:14px}' +
    '.' + c + '-steps li{counter-increment:aw-tx;padding:14px 18px 14px 64px;min-height:56px;background:var(--rv-surface);border:1px solid ' + LINE + ';border-radius:var(--rv-radius,12px)}' +
    '.' + c + '-steps li::before{content:counter(aw-tx);position:absolute;left:16px;top:14px;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:' + FILL + ';color:' + ON_FILL + ';font-family:var(--heading-font-family);font-size:0.9375rem;font-weight:700;line-height:1}' +
    '@media (max-width:640px){.' + c + '-in{padding:0 16px}.' + c + '-lead{font-size:1.0625rem}.' + c + '-p,.' + c + '-bullets li,.' + c + '-steps li{font-size:1rem}.' + c + '-steps li{padding:12px 14px 12px 56px}.' + c + '-steps li::before{left:12px;top:12px}}';
  return [{ id: id, name: (str(content.title) || titleOf(kind)) + ' text', html: html, css: css }];
}

var CHEVRON = '<svg class="aw-faq-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
function faqPage(kind, content, o) {
  var items = list(content).map(function (x) { return { q: str(x && x.q), a: String((x && x.a) == null ? '' : x.a).trim(), group: str(x && x.group) }; })
    .filter(function (x) { return x.q && x.a; });
  if (!items.length) return [];
  var grouped = items.some(function (x) { return x.group; });
  var order = [], by = Object.create(null);
  items.forEach(function (x) {
    var g = grouped ? (x.group || 'General') : '';
    if (!by[g]) { by[g] = []; order.push(g); }
    by[g].push(x);
  });
  var c = 'aw-faq', id = 'award-faq-list';
  var body = order.map(function (g, gi) {
    return '<div class="' + c + '-group">' +
      (g ? '<h2 class="' + c + '-gname"' + (gi === 0 ? ' id="' + id + '-title"' : '') + '>' + esc(g) + '</h2>' : '') +
      '<div class="' + c + '-items">' + by[g].map(function (x) {
        var paras = x.a.split(/\n\s*\n|\r\n\s*\r\n/).map(str).filter(Boolean);
        /* a native <details>: the editor opens it around the answer being edited (editor-canvas.js itemAround) */
        return '<details class="' + c + '-item"><summary class="' + c + '-q"><span class="' + c + '-qtext">' + esc(x.q) + '</span>' + CHEVRON + '</summary>' +
          '<div class="' + c + '-a">' + paras.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div></details>';
      }).join('') + '</div></div>';
  }).join('');
  var html = root(id, c, kind) + '<div class="' + c + '-in">' +
    (grouped ? '' : '<h2 class="' + c + '-sr" id="' + id + '-title">Frequently asked questions</h2>') + body + '</div></section>';
  var css = '.' + c + '{background:var(--rv-bg);color:var(--rv-text);padding:clamp(48px,6vw,88px) 0 clamp(64px,8vw,112px);font-family:var(--body-font-family)}' +
    '.' + c + '-in{max-width:860px;margin:0 auto;padding:0 24px;display:flex;flex-direction:column;gap:48px}' +
    '.' + c + '-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    '.' + c + '-gname{margin:0 0 18px;font-family:var(--heading-font-family);font-size:clamp(1.25rem,2vw,1.5rem);line-height:1.3;color:var(--rv-text)}' +
    '.' + c + '-items{display:flex;flex-direction:column;gap:12px}' +
    '.' + c + '-item{background:var(--rv-surface);border:1px solid ' + LINE + ';border-radius:var(--rv-radius,12px);overflow:hidden;transition:border-color .25s ease}' +
    '.' + c + '-item[open]{border-color:var(--theme-color)}' +
    '.' + c + '-q{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;cursor:pointer;list-style:none;font-family:var(--heading-font-family);font-size:1.0625rem;font-weight:600;line-height:1.45;color:var(--rv-text)}' +
    '.' + c + '-q::-webkit-details-marker{display:none}' +
    '.' + c + '-q:hover .' + c + '-qtext{color:' + INK + '}' +
    '.' + c + '-q:focus-visible{outline:3px solid var(--theme-color);outline-offset:-3px}' +
    '.' + c + '-icon{flex:0 0 auto;color:' + INK + ';transition:transform .25s ease}' +
    '.' + c + '-item[open] .' + c + '-icon{transform:rotate(180deg)}' +
    '.' + c + '-a{padding:0 20px 20px;display:flex;flex-direction:column;gap:12px}' +
    '.' + c + '-a p{margin:0;font-size:1rem;line-height:1.7;color:var(--rv-muted)}' +
    '@media (prefers-reduced-motion:reduce){.' + c + '-icon{transition:none}}' +
    '@media (max-width:640px){.' + c + '-in{padding:0 16px;gap:40px}.' + c + '-q{padding:16px;font-size:1rem}.' + c + '-a{padding:0 16px 16px}}';
  return [{ id: id, name: 'Questions', html: html, css: css }];
}

function titleOf(kind) { var k = PAGE_KINDS.filter(function (p) { return p.kind === kind; })[0]; return k ? k.title : ''; }

function pageSections(kind, content, o) {
  o = o || {};
  if (!titleOf(kind)) return [];
  var body = kind === 'award-category' ? categoryPage(kind, content, o)
    : kind === 'award-jury' ? juryPage(kind, content, o)
    : kind === 'award-faq' ? faqPage(kind, content, o)
    : TEXT_KINDS[kind] ? textPage(kind, content, o) : [];
  if (!body.length) return [];
  var title = str(o.title) || (TEXT_KINDS[kind] && content && str(content.title)) || titleOf(kind);
  return [pageHeader(kind, title, str(o.edition))].concat(body);
}

module.exports = { homeSections: homeSections, pageSections: pageSections, PAGE_KINDS: PAGE_KINDS, feeText: feeText, dateOf: when };
