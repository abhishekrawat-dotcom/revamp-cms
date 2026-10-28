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
/* a link that opens one of the award's own pages (the site's page runtime reads data-rv-page-link) — only on a
   site that has its internal pages (o.pages); a one-page site has nowhere for it to go */
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
/* The model of ONE juror drawn from the event's Speakers records — an award's jury (the owner, 28 Oct 2026: "the
   speaker module can be used as jury for awards"). The editor fills it from the records (editor-template-ui.js
   applyGenericRepeat), with each juror's profile for the pop-up; the classes are personCard's. */
function boundPersonCard(c) {
  return '<article class="' + c + '-card" data-rv-repeat-template="speakers">' +
    '<div class="' + c + '-ph"><img data-rv-field="photo" alt="" loading="lazy"></div>' +
    '<h3 class="' + c + '-name" data-rv-field="n">Juror name</h3>' +
    '<p class="' + c + '-role" data-rv-field="r">Designation</p>' +
    '<p class="' + c + '-co" data-rv-field="c">Company</p></article>';
}
function people(group) { return list(group && group.people).filter(function (p) { return p && str(p.name); }); }
function juryGroups(jury) {
  return list(jury).map(function (g) { return { group: str(g && g.group), people: people(g) }; }).filter(function (g) { return g.people.length; });
}

/* ================= the home page ================= */

var CHECK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/* ---------- ET's award design (read from seven of ET's own award sites, 28 Oct 2026) ----------
   Dark and premium, the brand colour lighting the page: key dates as numbered date cards with the current stage
   lit; the categories under a big count ("10 Master Categories · 85+ sub-categories") as icon cards; the Grand
   Jury as a grid of portraits on the brand colour; "How our awards work" as three principles and three stages;
   two wide calls to act (enter; the ceremony); five questions on the home page and the rest on their own page; a
   band of the category names moving under the hero. Every word is an element's own, so the editor can change it. */

/* a category's icon, from what its name says (a trophy when nothing fits) */
var ICONS = [
  [/\b(ai|artificial|tech|digital|data|cloud|software|it\b|cyber|analytics|automation)/i, '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/><rect x="9" y="9" width="6" height="6"/>'],
  [/\b(leader|ceo|cxo|chro|cfo|cio|cmo|officer|of the year|individual|professional|woman|women|young|champion|visionary)/i, '<circle cx="12" cy="7" r="4"/><path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'],
  [/\b(team|talent|people|hr|culture|employ|workplace|diversity|inclusion|learning)/i, '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M15 14.5c3.3 0 6 2.7 6 6"/>'],
  [/\b(sustain|esg|green|climate|environment|carbon|water|circular)/i, '<path d="M20 4C9 4 4 10 4 17c0 1 .1 2 .3 3C6 13 11 10 16 9c-4 2-7 5-9 10 9 0 13-7 13-15z"/>'],
  [/\b(health|care|wellness|hospital|pharma|medic|clinic|nutrition|fertility)/i, '<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/>'],
  [/\b(retail|commerce|brand|consumer|store|shop|d2c|fmcg)/i, '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6.2"/><circle cx="10" cy="20.5" r="1.3"/><circle cx="17" cy="20.5" r="1.3"/>'],
  [/\b(market|campaign|media|content|advert|communic|pr\b|creative|story|social)/i, '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 8a5 5 0 0 1 0 8M20 5a9 9 0 0 1 0 14"/>'],
  [/\b(financ|bank|fintech|insur|invest|payment|lending|nbfc|wealth)/i, '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>'],
  [/\b(startup|innovat|disrupt|new|emerging|launch|rising)/i, '<path d="M12 2c3 2 5 6 5 10l-2 4H9l-2-4c0-4 2-8 5-10zM9 16l-3 4M15 16l3 4M12 9.5v.01"/>'],
  [/\b(auto|ev\b|electric|mobility|vehicle|car|transport|logistic|supply)/i, '<path d="M5 17h14M3 17v-4l2.5-5h13L21 13v4"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="16.5" cy="17.5" r="2"/>'],
  [/\b(energy|power|solar|oil|gas|renewable|grid)/i, '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'],
  [/\b(organi[sz]ation|company|enterprise|corporate|business|employer|government|public|institution)/i, '<path d="M4 21V5l8-3v19M12 21h8V9l-8-2M8 8v.01M8 12v.01M8 16v.01M16 12v.01M16 16v.01"/>']
];
var TROPHY = '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>';
function iconFor(name) {
  var hit = ICONS.filter(function (x) { return x[0].test(String(name || '')); })[0];
  return '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (hit ? hit[1] : TROPHY) + '</svg>';
}
/* the brand colour lighting a dark card from one corner */
var GLOW = 'radial-gradient(120% 90% at 0% 0%, color-mix(in srgb,var(--theme-color) 22%, transparent), transparent 60%)';

function keyDates(award, o) {
  var d = (award && award.dates) || {}, now = o.now == null ? Date.now() : +o.now;
  var defs = [
    { key: 'nominationOpen', name: 'Nominations Open' },
    { key: 'earlyBird', name: 'Early Bird Deadline', optional: true },
    { key: 'nominationClose', name: 'Nomination Deadline' },
    { key: 'jury', name: 'Jury Meet' },
    { key: 'ceremony', name: 'Awards Night' }
  ];
  var steps = defs.map(function (s) {
    var w = when(d[s.key] != null ? d[s.key] : s.key === 'jury' ? d.juryRound : null, o.dateLabel);
    return { name: s.name, w: w, optional: s.optional };
  }).filter(function (s) { return s.w || !s.optional; });
  /* done: its moment has passed — and every step before a done one is done too */
  var lastDone = -1;
  steps.forEach(function (s, i) { if (s.w && s.w.at < now) lastDone = i; });
  var c = 'aw-kd', id = 'key-dates';
  var items = steps.map(function (s, i) {
    var done = i <= lastDone, next = i === lastDone + 1;
    var m = s.w ? /^(\d{1,2})\s+(.+)$/.exec(s.w.label) : null;
    var big = m ? m[1] : s.w ? '' : '';
    var small = m ? m[2] : s.w ? s.w.label : 'Coming soon';
    return '<li class="' + c + '-step' + (done ? ' is-done' : '') + (next ? ' is-next' : '') + (s.w ? '' : ' is-tba') + '"' + (next ? ' aria-current="step"' : '') + ' data-rv-reveal>' +
      '<p class="' + c + '-no">' + (i < 9 ? '0' : '') + (i + 1) + '</p>' +
      (big ? '<p class="' + c + '-day">' + esc(big) + '</p>' : '<p class="' + c + '-day ' + c + '-day-tba" aria-hidden="true">—</p>') +
      '<p class="' + c + '-when">' + esc(small) + '</p>' +
      '<h3 class="' + c + '-name">' + esc(s.name) + '</h3>' +
      (done ? '<p class="' + c + '-state">' + CHECK + 'Completed</p>' : next ? '<p class="' + c + '-state">Up next</p>' : '') +
      '</li>';
  }).join('');
  var html = root(id, c, '') + '<div class="' + c + '-in">' + head(c, id, o.edition, 'Key Dates') +
    '<ol class="' + c + '-list">' + items + '</ol></div></section>';
  var css = baseCss(c) +
    '.' + c + '-list{list-style:none;margin:0 auto;padding:0;max-width:1200px;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:16px}' +
    '.' + c + '-step{position:relative;display:flex;flex-direction:column;min-width:0;padding:22px 20px 24px;border-radius:var(--rv-radius,12px);background:var(--rv-surface);background-image:' + GLOW + ';border:1px solid ' + LINE + ';overflow:hidden;transition:transform .3s ease}' +
    '.' + c + '-step:hover{transform:translateY(-4px)}' +
    /* the current stage is lit in the brand colour */
    '.' + c + '-step.is-next{background:' + FILL + ';background-image:none;border-color:transparent;color:' + ON_FILL + ';box-shadow:0 18px 40px -18px color-mix(in srgb,var(--theme-color) 70%,transparent)}' +
    '.' + c + '-no{margin:0 0 18px;font-size:0.8125rem;font-weight:700;letter-spacing:.16em;color:' + INK + '}' +
    '.' + c + '-step.is-next .' + c + '-no,.' + c + '-step.is-next .' + c + '-day,.' + c + '-step.is-next .' + c + '-when,.' + c + '-step.is-next .' + c + '-name,.' + c + '-step.is-next .' + c + '-state{color:' + ON_FILL + '}' +
    '.' + c + '-day{margin:0;font-family:var(--heading-font-family);font-size:clamp(2.75rem,5vw,3.75rem);font-weight:700;line-height:1;color:var(--rv-text)}' +
    '.' + c + '-day-tba{color:var(--rv-muted)}' +
    '.' + c + '-when{margin:8px 0 0;font-size:0.9375rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--rv-muted)}' +
    '.' + c + '-name{margin:auto 0 0;padding:22px 0 0;font-family:var(--body-font-family);font-size:1rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1.35;color:var(--rv-text)}' +
    '.' + c + '-state{display:flex;align-items:center;gap:6px;margin:10px 0 0;font-size:0.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--rv-muted)}' +
    '.' + c + '-state svg{width:14px;height:14px}' +
    '.' + c + '-step.is-done{opacity:.72}' +
    '@media (max-width:900px){.' + c + '-list{grid-auto-flow:row;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-columns:auto}}' +
    '@media (max-width:520px){.' + c + '-list{grid-template-columns:minmax(0,1fr)}.' + c + '-step{padding:18px}}';
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
      '<div class="' + c + '-top"><span class="' + c + '-ic">' + iconFor(x.name) + '</span>' + (x.isNew ? newBadge(c + '-new') : '<span class="' + c + '-num">' + (i < 9 ? '0' : '') + (i + 1) + '</span>') + '</div>' +
      '<h3 class="' + c + '-name">' + esc(str(x.name)) + '</h3>' +
      (n ? '<p class="' + c + '-count">' + n + ' ' + (n === 1 ? 'category' : 'categories') + '</p>' : '') + '</article>';
  }).join('');
  /* ET's big count over the grid: "10 Master Categories", the sub-categories in the brand colour */
  var count = '<div class="' + c + '-head" data-rv-reveal>' +
    (o.edition ? '<p class="' + c + '-eyebrow">' + esc(o.edition) + '</p>' : '') +
    '<h2 class="' + c + '-big" id="' + id + '-title"><span class="' + c + '-n">' + cats.length + '</span> Master ' + (cats.length === 1 ? 'Category' : 'Categories') + '</h2>' +
    (subs ? '<p class="' + c + '-subs">' + subs + '+ Sub-Categories</p>' : '') + '</div>';
  var html = root(id, c, '') + '<div class="' + c + '-in">' + count +
    '<div class="' + c + '-grid">' + cards + '</div>' + (o && o.pages ? pageLink(c, 'award-category', 'View all categories') : '') + '</div></section>';
  var css = baseCss(c, '--rv-surface') + buttonCss(c) +
    '.' + c + '-big{margin:0;font-family:var(--heading-font-family);font-size:clamp(2rem,4.4vw,3.25rem);font-weight:700;line-height:1.08;letter-spacing:.02em;text-transform:uppercase;color:var(--rv-text)}' +
    '.' + c + '-n{color:' + INK + '}' +
    '.' + c + '-subs{margin:12px 0 0;font-size:1.0625rem;font-weight:700;letter-spacing:.06em;color:' + INK + '}' +
    /* a short last row stands in the middle, not at the left */
    '.' + c + '-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:16px}' +
    '.' + c + '-card{flex:0 1 calc((100% - 64px) / 5);min-width:200px;display:flex;flex-direction:column;background:var(--rv-bg);background-image:' + GLOW + ';border:1px solid ' + LINE + ';border-radius:var(--rv-radius,12px);padding:20px 18px 22px;transition:transform .3s ease,border-color .3s ease}' +
    '.' + c + '-card:hover{transform:translateY(-4px);border-color:var(--theme-color)}' +
    '.' + c + '-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 18px}' +
    '.' + c + '-ic{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:color-mix(in srgb,var(--theme-color) 16%,transparent);color:' + INK + '}' +
    '.' + c + '-num{font-size:0.8125rem;font-weight:700;letter-spacing:.14em;color:var(--rv-muted)}' +
    badgeCss('.' + c + '-new') +
    '.' + c + '-name{margin:0;font-family:var(--body-font-family);font-size:0.9375rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;line-height:1.4;color:var(--rv-text)}' +
    '.' + c + '-count{margin:auto 0 0;padding:14px 0 0;font-size:0.875rem;font-weight:600;color:' + INK + '}' +
    '@media (max-width:640px){.' + c + '-grid{gap:12px}.' + c + '-card{flex:1 1 calc(50% - 6px);min-width:0;padding:16px 14px 18px}}';
  return { html: html, css: css, lead: lead };
}

/* the Grand Jury: the group so named, else the first */
function grandJury(jury) {
  var groups = juryGroups(jury);
  return groups.filter(function (g) { return /grand/i.test(g.group); })[0] || groups[0] || null;
}
var JURY_ON_HOME = 10;
/* o.bound: the jurors are the event's Speakers records (boundPersonCard), the first ten on the home page — the
   section stands when the award has a jury on record or the event has records of its own (o.hasJury) */
function juryHome(award, o) {
  o = o || {};
  var g = grandJury(award && award.jury);
  if (!g && !(o.bound && o.hasJury)) return null;
  var c = 'aw-jury', id = 'award-jury', title = (g && g.group) || 'Jury';
  /* ET's grid of portraits, five to a row; the rest of the jury on its own page */
  var shown = !g ? [] : o.pages ? g.people.slice(0, JURY_ON_HOME) : g.people;
  var cards = o.bound ? boundPersonCard(c) : shown.map(function (p) { return personCard(c, p); }).join('');
  var more = o.bound ? 'Meet the jury' : g.people.length > shown.length ? 'Meet the full jury' : 'Meet the jury';
  var html = root(id, c, '', ' data-rv-profiles') + '<div class="' + c + '-in">' + head(c, id, o.edition, title) +
    '<div class="' + c + '-grid">' + cards + '</div>' +
    (o.pages ? pageLink(c, 'award-jury', more) : '') + '</div></section>';
  var css = baseCss(c) + buttonCss(c) + personCss(c, 'auto') +
    (o.bound && o.pages ? '.' + c + '-grid > .' + c + '-card:nth-child(n+' + (JURY_ON_HOME + 1) + ' of .' + c + '-card){display:none}' : '') +
    '.' + c + '-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:20px;max-width:1120px;margin:0 auto}' +
    /* ET's portraits stand on the brand colour */
    '.' + c + '-card{padding:0 0 18px;overflow:hidden;text-align:center}' +
    '.' + c + '-ph{border-radius:0;margin:0 0 14px;background:linear-gradient(180deg,color-mix(in srgb,var(--theme-color) 70%,var(--rv-bg)) 0%,var(--theme-color) 100%)}' +
    '.' + c + '-name,.' + c + '-role,.' + c + '-co{padding:0 12px}' +
    '@media (max-width:1000px){.' + c + '-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
    '@media (max-width:640px){.' + c + '-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.' + c + '-name{font-size:1rem}}';
  return { html: html, css: css, title: title, count: g ? g.people.length : 0 };
}

/* ---------- a band of the category names, moving under the hero ---------- */
function categoryBand(award) {
  var names = [];
  list(award && award.categories).forEach(function (x) {
    if (!x || !str(x.name)) return;
    names.push(str(x.name));
    list(x.subcategories).slice(0, 3).forEach(function (s) { if (s && str(s.name)) names.push(str(s.name)); });
  });
  names = names.filter(function (n, i) { return names.indexOf(n) === i; }).slice(0, 24);
  if (names.length < 3) return null;
  var c = 'aw-band', id = 'award-band';
  var run = function (hidden) {
    return '<ul class="' + c + '-run"' + (hidden ? ' aria-hidden="true"' : '') + '>' + names.map(function (n) { return '<li class="' + c + '-item">' + esc(n) + '</li>'; }).join('') + '</ul>';
  };
  var html = '<section id="' + id + '" data-rv-section-id="' + id + '" class="' + c + '" aria-label="Award categories">' +
    '<div class="' + c + '-track">' + run(false) + run(true) + '</div></section>';
  var css = '.' + c + '{background:' + FILL + ';color:' + ON_FILL + ';overflow:hidden;padding:0;font-family:var(--body-font-family)}' +
    '.' + c + '-track{display:flex;width:max-content;animation:aw-band-move 60s linear infinite}' +
    '.' + c + ':hover .' + c + '-track{animation-play-state:paused}' +
    '.' + c + '-run{display:flex;list-style:none;margin:0;padding:0}' +
    '.' + c + '-item{display:flex;align-items:center;gap:22px;padding:16px 0 16px 22px;font-size:0.875rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;color:' + ON_FILL + '}' +
    '.' + c + '-item::after{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.7}' +
    '@keyframes aw-band-move{from{transform:translateX(0)}to{transform:translateX(-50%)}}' +
    '@media (prefers-reduced-motion:reduce){.' + c + '-track{animation:none;width:auto;flex-wrap:wrap;justify-content:center}.' + c + '-run[aria-hidden]{display:none}.' + c + '-run{flex-wrap:wrap;justify-content:center}}';
  return { id: id, html: html, css: css };
}

/* ---------- how our awards work: ET's principles and its three stages ---------- */
function processHome(o) {
  var c = 'aw-how', id = 'how-it-works', photos = list(o.photos).map(httpsUrl).filter(Boolean);
  var principles = [
    ['Judging Criteria', 'Entries are assessed on clear, published criteria: the results achieved, the originality of the work and the impact it has made.'],
    ['Persistent Fairness & Integrity', 'Every juror follows a strict code of conduct, and no juror assesses an entry where there is a conflict of interest.'],
    ['Confidentiality', 'Everything an entrant submits is kept confidential to the jury and used only to assess the entry.']
  ];
  var stages = [
    ['Scrutiny by Expert Tabulator', 'An independent expert tabulator checks every entry for eligibility and completeness, so the jury sees only valid entries.'],
    ['Thorough Review Process', 'A multi-stage review of each entry against the judging criteria shortlists the strongest in every category.'],
    ['Grand Jury', 'A grand jury of industry leaders deliberates on the shortlist and decides the winners.']
  ];
  var ICON = ['<path d="M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    '<path d="M12 3v18M5 7h14M7 7l-4 7a4 4 0 0 0 8 0L7 7zM17 7l-4 7a4 4 0 0 0 8 0l-4-7z"/>',
    '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'];
  var cards = principles.map(function (p, i) {
    return '<article class="' + c + '-card" data-rv-reveal><span class="' + c + '-ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[i] + '</svg></span>' +
      '<h3 class="' + c + '-name">' + esc(p[0]) + '</h3><p class="' + c + '-text">' + esc(p[1]) + '</p></article>';
  }).join('');
  /* a stage with no photo of the last edition carries its own icon in the top corner, large and faint behind it too:
     the panel is never a blank block (the owner, 28 Oct 2026) — the tabulator's checklist, the review, the jury's gavel */
  var STAGE_ICON = ['<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    '<rect x="3" y="3" width="12" height="15" rx="2"/><path d="M7 7.5h5M7 11h3.5"/><circle cx="16" cy="16" r="4"/><path d="m19 19 2.5 2.5"/>',
    '<path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>'];
  function stageIcon(i, cls, size) {
    return '<svg class="' + cls + '" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + STAGE_ICON[i] + '</svg>';
  }
  var panels = stages.map(function (s, i) {
    var ph = photos[i];
    return '<article class="' + c + '-stage' + (ph ? '' : ' ' + c + '-stage-plain') + '" data-rv-reveal>' +
      (ph ? '<img class="' + c + '-ph" src="' + esc(ph) + '" alt="" loading="lazy">' : stageIcon(i, c + '-mark', 220) + '<span class="' + c + '-sic">' + stageIcon(i, '', 30) + '</span>') +
      '<div class="' + c + '-veil" aria-hidden="true"></div>' +
      '<div class="' + c + '-body"><p class="' + c + '-no">0' + (i + 1) + '</p><h3 class="' + c + '-sname">' + esc(s[0]) + '</h3><p class="' + c + '-stext">' + esc(s[1]) + '</p></div></article>';
  }).join('');
  var html = root(id, c, '') + '<div class="' + c + '-in">' + head(c, id, o.edition, 'How Our Awards Work') +
    '<div class="' + c + '-cards">' + cards + '</div><div class="' + c + '-stages">' + panels + '</div></div></section>';
  var css = baseCss(c, '--rv-surface') +
    '.' + c + '-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:0 0 28px}' +
    '.' + c + '-card{background:var(--rv-bg);background-image:' + GLOW + ';border:1px solid ' + LINE + ';border-radius:var(--rv-radius,12px);padding:26px 24px 28px}' +
    '.' + c + '-ic{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:' + FILL + ';color:' + ON_FILL + ';margin:0 0 18px}' +
    '.' + c + '-name{margin:0 0 10px;font-family:var(--heading-font-family);font-size:1.25rem;line-height:1.3;color:var(--rv-text)}' +
    '.' + c + '-text{margin:0;font-size:1rem;line-height:1.65;color:var(--rv-muted)}' +
    '.' + c + '-stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}' +
    '.' + c + '-stage{position:relative;min-height:380px;border-radius:var(--rv-radius,12px);overflow:hidden;display:flex;align-items:flex-end;background:var(--rv-bg);background-image:radial-gradient(120% 90% at 100% 0%, color-mix(in srgb,var(--theme-color) 40%, transparent), transparent 70%)}' +
    '.' + c + '-ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 30%;display:block;transition:transform .6s ease}' +
    '.' + c + '-stage:hover .' + c + '-ph{transform:scale(1.04)}' +
    '.' + c + '-veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,.82) 70%)}' +
    '.' + c + '-stage-plain .' + c + '-veil{background:none}' +
    '.' + c + '-body{position:relative;padding:26px 24px 28px;color:#ffffff}' +
    '.' + c + '-stage-plain .' + c + '-body{color:var(--rv-text)}' +
    '.' + c + '-sic{position:absolute;top:24px;right:24px;display:grid;place-items:center;width:68px;height:68px;border-radius:18px;background:color-mix(in srgb,var(--theme-color) 18%,transparent);border:1px solid color-mix(in srgb,var(--theme-color) 40%,transparent);color:' + INK + ';transition:transform .4s ease,background-color .4s ease}' +
    '.' + c + '-stage:hover .' + c + '-sic{transform:translateY(-3px) rotate(-4deg);background:color-mix(in srgb,var(--theme-color) 30%,transparent)}' +
    '.' + c + '-mark{position:absolute;top:-28px;right:-34px;color:var(--theme-color);opacity:.09;pointer-events:none;transition:opacity .4s ease}' +
    '.' + c + '-stage:hover .' + c + '-mark{opacity:.16}' +
    '.' + c + '-no{margin:0 0 8px;font-family:var(--heading-font-family);font-size:2.25rem;font-weight:700;line-height:1;color:var(--theme-color)}' +
    '.' + c + '-sname{margin:0 0 8px;font-family:var(--heading-font-family);font-size:1.375rem;line-height:1.25;color:inherit}' +
    '.' + c + '-stext{margin:0;font-size:0.9875rem;line-height:1.6;color:inherit;opacity:.88}' +
    '@media (max-width:900px){.' + c + '-cards,.' + c + '-stages{grid-template-columns:minmax(0,1fr)}.' + c + '-stage{min-height:300px}}';
  return { html: html, css: css };
}

/* ---------- the two wide calls to act: enter, and the ceremony ---------- */
function recognitionHome(o) {
  /* a photo of the last edition no other section shows; never the banner's picture again (no picture twice on a page) */
  var c = 'aw-rec', id = 'recognition', photo = httpsUrl(list(o.photos)[3]);
  var html = root(id, c, '') + '<div class="' + c + '-in"><div class="' + c + '-card" data-rv-reveal>' +
    '<div class="' + c + '-art' + (photo ? '' : ' ' + c + '-scene') + '"' + (photo ? '' : ' aria-hidden="true"') + '>' + (photo ? '<img src="' + esc(photo) + '" alt="" loading="lazy">' : trophyScene(c)) + '</div>' +
    '<div class="' + c + '-body">' +
      '<p class="' + c + '-eyebrow">' + esc(o.edition ? o.edition + ' · Nominations' : 'Nominations') + '</p>' +
      '<h2 class="' + c + '-title" id="' + id + '-title">Get the Recognition You and Your Team Deserve</h2>' +
      '<p class="' + c + '-text">Put your work before a jury of the industry’s leaders, and take the stage on awards night.</p>' +
      '<p class="' + c + '-cta"><a class="' + c + '-btn" href="#hero" data-register-cta>Nominate Now</a></p>' +
    '</div></div></div></section>';
  var css = baseCss(c) + buttonCss(c) +
    '.' + c + '-card{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);border-radius:calc(var(--rv-radius,12px) * 1.5);overflow:hidden;background:var(--rv-surface);background-image:radial-gradient(90% 120% at 100% 100%, color-mix(in srgb,var(--theme-color) 34%, transparent), transparent 70%);border:1px solid ' + LINE + '}' +
    '.' + c + '-art{position:relative;min-height:340px}' +
    '.' + c + '-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}' +
    trophySceneCss(c) +
    '.' + c + '-body{padding:clamp(32px,5vw,64px);display:flex;flex-direction:column;justify-content:center}' +
    '.' + c + '-eyebrow{margin:0 0 12px;font-size:0.8125rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:' + INK + '}' +
    '.' + c + '-title{margin:0;font-family:var(--heading-font-family);font-size:' + SECTION_HEADING + ';line-height:1.15;color:var(--rv-text)}' +
    '.' + c + '-text{margin:16px 0 0;font-size:1.0625rem;line-height:1.65;color:var(--rv-muted)}' +
    '.' + c + '-cta{margin:28px 0 0}' +
    '@media (max-width:820px){.' + c + '-card{grid-template-columns:minmax(0,1fr)}.' + c + '-art{min-height:220px}}';
  return { html: html, css: css };
}
/* With no photo of the last edition for it, the call to enter has a scene of its own: a trophy on a lit stage, in
   the award's colour, with turning light rays, a glow and sparkles; the card lifts it when the pointer is over it
   (the owner, 28 Oct 2026: a flat block with a small trophy icon was "not on the satisfactory level"). Still for a
   visitor who asks for less motion. */
var SPARKS = [['14%', '24%', '0s'], ['80%', '18%', '.9s'], ['24%', '64%', '1.7s'], ['72%', '58%', '.4s'], ['50%', '12%', '2.3s'], ['88%', '78%', '1.3s'], ['9%', '84%', '2.8s']];
function trophyScene(c) {
  return '<span class="' + c + '-rays"></span><span class="' + c + '-halo"></span><span class="' + c + '-stage"></span>' +
    SPARKS.map(function (p) { return '<span class="' + c + '-spark" style="--x:' + p[0] + ';--y:' + p[1] + ';--d:' + p[2] + '"></span>'; }).join('') +
    '<span class="' + c + '-lift"><svg class="' + c + '-trophy" viewBox="0 0 200 240" focusable="false">' +
      '<defs><linearGradient id="' + c + '-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c2"/><stop offset=".35" stop-color="#f2c662"/><stop offset=".7" stop-color="#c8902c"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>' +
      '<linearGradient id="' + c + '-base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f4b"/><stop offset="1" stop-color="#11141b"/></linearGradient></defs>' +
      '<path d="M50 46H30c-9 0-11 11-8 20 4 18 18 28 32 31M150 46h20c9 0 11 11 8 20-4 18-18 28-32 31" fill="none" stroke="url(#' + c + '-gold)" stroke-width="8" stroke-linecap="round"/>' +
      '<path d="M48 28h104v42c0 40-25 66-52 69-27-3-52-29-52-69z" fill="url(#' + c + '-gold)"/>' +
      '<path d="M64 40c-2 32 6 62 24 84" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M100 62l5.3 10.8 11.9 1.7-8.6 8.4 2 11.8L100 89.1l-10.6 5.6 2-11.8-8.6-8.4 11.9-1.7z" fill="currentColor"/>' +
      '<rect x="91" y="137" width="18" height="30" fill="#b07a20"/><ellipse cx="100" cy="168" rx="24" ry="7" fill="url(#' + c + '-gold)"/>' +
      '<path d="M62 176h76l9 30H53z" fill="url(#' + c + '-base)"/><rect x="78" y="186" width="44" height="11" rx="2" fill="url(#' + c + '-gold)"/>' +
      '<rect x="44" y="206" width="112" height="16" rx="4" fill="url(#' + c + '-base)"/>' +
    '</svg></span>';
}
/* the scene is artwork, as a photograph is: its gold and its dark stage keep their colours in every theme (--rv-keep,
   rv-theme.js); the award's own colour comes in through var(--theme-color) */
function trophySceneCss(c) {
  var C = '.' + c;
  return C + '-scene{--rv-keep:1;display:grid;place-items:center;overflow:hidden;isolation:isolate;background:radial-gradient(70% 62% at 50% 64%, color-mix(in srgb,var(--theme-color) 58%,#0b0d14) 0%, color-mix(in srgb,var(--theme-color) 22%,#07080c) 62%, #06070b 100%)}' +
    C + '-rays{--rv-keep:1;position:absolute;left:50%;top:60%;width:180%;aspect-ratio:1/1;transform:translate(-50%,-50%);z-index:-1;opacity:.75;transition:opacity .5s ease;' +
      'background:repeating-conic-gradient(from 0deg,rgba(255,232,180,.16) 0deg 5deg,transparent 5deg 22deg);-webkit-mask:radial-gradient(circle,#000 0,#000 16%,transparent 60%);mask:radial-gradient(circle,#000 0,#000 16%,transparent 60%);animation:aw-rec-spin 50s linear infinite}' +
    C + '-halo{--rv-keep:1;position:absolute;left:50%;top:52%;width:64%;aspect-ratio:1/1;transform:translate(-50%,-50%);z-index:-1;border-radius:50%;background:radial-gradient(circle,rgba(255,214,120,.55) 0%,color-mix(in srgb,var(--theme-color) 35%,transparent) 45%,transparent 70%);animation:aw-rec-pulse 5s ease-in-out infinite}' +
    C + '-stage{--rv-keep:1;position:absolute;left:50%;bottom:12%;width:60%;height:26px;transform:translateX(-50%);z-index:-1;border-radius:50%;background:radial-gradient(closest-side,rgba(255,214,120,.5),transparent)}' +
    C + '-spark{--rv-keep:1;position:absolute;left:var(--x);top:var(--y);width:11px;height:11px;background:#ffe3a3;clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);opacity:0;animation:aw-rec-twinkle 3.6s ease-in-out infinite;animation-delay:var(--d)}' +
    C + '-lift{display:block;width:min(46%,210px);transition:transform .6s cubic-bezier(.2,.8,.2,1)}' +
    C + '-card:hover ' + C + '-lift{transform:translateY(-8px) scale(1.05) rotate(-2deg)}' +
    C + '-card:hover ' + C + '-rays{opacity:1}' +
    C + '-trophy{--rv-keep:1;display:block;width:100%;height:auto;color:var(--theme-color);filter:drop-shadow(0 18px 28px rgba(0,0,0,.55));animation:aw-rec-float 6s ease-in-out infinite}' +
    '@keyframes aw-rec-spin{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}' +
    '@keyframes aw-rec-pulse{0%,100%{opacity:.75;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}}' +
    '@keyframes aw-rec-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}' +
    '@keyframes aw-rec-twinkle{0%,100%{opacity:0;transform:scale(.4) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}' +
    '@media (prefers-reduced-motion:reduce){' + C + '-rays,' + C + '-halo,' + C + '-trophy,' + C + '-spark{animation:none}' + C + '-spark{opacity:.8}' + C + '-lift{transition:none}}';
}

function ceremonyHome(o) {
  var c = 'aw-cer', id = 'awards-night', photo = httpsUrl(list(o.photos)[4]);
  var facts = [o.dateLabel, o.place].map(str).filter(Boolean);
  var html = root(id, c, '') + '<div class="' + c + '-in"><div class="' + c + '-card' + (photo ? '' : ' ' + c + '-plain') + '" data-rv-reveal>' +
    (photo ? '<img class="' + c + '-ph" src="' + esc(photo) + '" alt="" loading="lazy">' : '') + '<div class="' + c + '-veil" aria-hidden="true"></div>' +
    '<div class="' + c + '-body">' +
      '<p class="' + c + '-eyebrow">Awards Night</p>' +
      '<h2 class="' + c + '-title" id="' + id + '-title">Join Us at the Grand Award Ceremony</h2>' +
      '<p class="' + c + '-text">An evening with the industry’s leaders, as this edition’s winners are named on stage.</p>' +
      (facts.length ? '<p class="' + c + '-facts">' + facts.map(function (f) { return '<span>' + esc(f) + '</span>'; }).join('') + '</p>' : '') +
      '<p class="' + c + '-cta"><a class="' + c + '-btn" href="#hero" data-register-cta>Get Tickets</a></p>' +
    '</div></div></div></section>';
  var css = baseCss(c) + buttonCss(c) +
    '.' + c + '-card{position:relative;border-radius:calc(var(--rv-radius,12px) * 1.5);overflow:hidden;min-height:420px;display:flex;align-items:center;justify-content:center;text-align:center;background:var(--rv-surface);background-image:radial-gradient(100% 100% at 50% 0%, color-mix(in srgb,var(--theme-color) 45%, transparent), transparent 70%)}' +
    '.' + c + '-ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}' +
    '.' + c + '-veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,.8))}' +
    '.' + c + '-plain .' + c + '-veil{background:none}' +
    '.' + c + '-body{position:relative;max-width:720px;padding:clamp(40px,6vw,72px) 24px;color:#ffffff}' +
    '.' + c + '-plain .' + c + '-body{color:var(--rv-text)}' +
    '.' + c + '-eyebrow{margin:0 0 12px;font-size:0.8125rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--theme-color)}' +
    '.' + c + '-title{margin:0;font-family:var(--heading-font-family);font-size:' + SECTION_HEADING + ';line-height:1.15;color:inherit}' +
    '.' + c + '-text{margin:16px auto 0;max-width:560px;font-size:1.0625rem;line-height:1.65;color:inherit;opacity:.9}' +
    '.' + c + '-facts{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 22px;margin:20px 0 0;font-size:0.9375rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase}' +
    '.' + c + '-cta{margin:28px 0 0}';
  return { html: html, css: css };
}

/* ---------- the home page's questions: the first five of the event's FAQ records, the rest on their page ----------
   The list is the FAQ records (Content › FAQ; data-rv-repeat-template="faq": t the question, d the answer), so it
   follows them wherever the page is shown. Only the first five are shown, and "View all FAQs" only when there are
   more — by CSS, whoever fills the list (the editor, the page's own runtime). */
var FAQ_ON_HOME = 5;
var CHEVRON = '<svg class="aw-faq-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
function faqItem(c) {
  /* a native <details>: the editor opens it around the answer being edited (editor-canvas.js itemAround) */
  return '<details class="' + c + '-item" data-rv-repeat-template="faq"><summary class="' + c + '-q"><span class="' + c + '-qtext" data-rv-field="t">Question goes here</span>' + CHEVRON + '</summary>' +
    '<div class="' + c + '-a"><p data-rv-field="d">Answer goes here.</p></div></details>';
}
function faqCss(c) {
  return '.' + c + '-items{display:flex;flex-direction:column;gap:12px;max-width:860px;margin:0 auto}' +
    '.' + c + '-item{background:var(--rv-surface);border:1px solid ' + LINE + ';border-radius:var(--rv-radius,12px);overflow:hidden;transition:border-color .25s ease}' +
    '.' + c + '-item[open]{border-color:var(--theme-color)}' +
    '.' + c + '-q{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;cursor:pointer;list-style:none;font-family:var(--heading-font-family);font-size:1.0625rem;font-weight:600;line-height:1.45;color:var(--rv-text)}' +
    '.' + c + '-q::-webkit-details-marker{display:none}' +
    '.' + c + '-q:hover .' + c + '-qtext{color:' + INK + '}' +
    '.' + c + '-q:focus-visible{outline:3px solid var(--theme-color);outline-offset:-3px}' +
    '.aw-faq-icon{flex:0 0 auto;color:' + INK + ';transition:transform .25s ease}' +
    '.' + c + '-item[open] .aw-faq-icon{transform:rotate(180deg)}' +
    '.' + c + '-a{padding:0 20px 20px}' +
    '.' + c + '-a p{margin:0;font-size:1rem;line-height:1.7;color:var(--rv-muted);white-space:pre-line}' +
    '@media (prefers-reduced-motion:reduce){.aw-faq-icon{transition:none}}' +
    '@media (max-width:640px){.' + c + '-q{padding:16px;font-size:1rem}.' + c + '-a{padding:0 16px 16px}}';
}
function faqHome(o) {
  var c = 'aw-fq', id = 'faqs';
  var html = root(id, c, '') + '<div class="' + c + '-in">' + head(c, id, o.edition, 'Frequently Asked Questions') +
    '<div class="' + c + '-items">' + faqItem(c) + '</div>' +
    (o && o.pages ? pageLink(c, 'award-faq', 'View all FAQs') : '') + '</div></section>';
  var css = baseCss(c) + buttonCss(c) + faqCss(c) +
    '.' + c + '-items > .' + c + '-item:nth-child(n+' + (FAQ_ON_HOME + 1) + ' of .' + c + '-item){display:none}' +
    '.' + c + '-more{display:none}' +
    '.' + c + ':has(.' + c + '-items > .' + c + '-item:nth-child(' + (FAQ_ON_HOME + 1) + ' of .' + c + '-item)) .' + c + '-more{display:block}';
  return { html: html, css: css };
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
  function add(id, name, prebuilt, purpose, layout, built) {
    if (built) out.push({ id: id, name: name, kind: 'custom', prebuilt: prebuilt, image: '', purpose: purpose, layout: layout, html: built.html, css: built.css });
  }
  var band = categoryBand(award);
  add('award-band', 'Categories band', 'award-band', 'A band of the award’s category names moving under the hero. Built by the server from the award’s records.', 'a moving band in the brand colour', band);
  add('key-dates', 'Key Dates', 'award-key-dates', 'Key Dates — when nominations open and close, the jury meets and the awards night is held (Coming soon until set). Built by the server.',
    'numbered date cards, the current stage lit', keyDates(award, o));
  var cs = categoriesSummary(award, o);
  add('award-categories', 'Award Categories', 'award-categories', cs ? 'Award Categories — the master categories (' + cs.lead + ') and a link to the full list. Built by the server from the award’s records.' : '',
    'the count of categories over icon cards, and a button', cs);
  add('how-it-works', 'How Our Awards Work', 'award-process', 'How Our Awards Work — ET’s principles (judging criteria, fairness and integrity, confidentiality) and its three stages (expert tabulator, review, grand jury). Built by the server.',
    'three principle cards over three photo panels', processHome(o));
  var jh = juryHome(award, o);
  add('award-jury', 'Jury', 'award-jury', jh ? 'The ' + jh.title + ' — the real jurors of this edition (' + jh.count + '), each opening their profile, and a link to the Jury page. Built by the server.' : '',
    'a grid of portraits, five to a row, and a button', jh);
  add('recognition', 'The Recognition', 'award-recognition', 'Get the recognition you deserve — a wide call to enter, with the main button. Built by the server.', 'a wide card: a picture beside the call and its button', recognitionHome(o));
  add('awards-night', 'Awards Night', 'award-ceremony', 'The awards night — a wide call to be in the room, with its date and venue. Built by the server.', 'a wide picture under a veil, the call and its button', ceremonyHome(o));
  var pt = partnersHome(award, o);
  add('award-partners', 'Partners', 'award-partners', 'Partners — the award’s real partners by group (Knowledge Partner, Supporting Partners …). Built by the server.', 'logos on plates, under each group’s name', pt);
  add('faqs', 'FAQs', 'award-faqs', 'FAQs — the first five of the event’s FAQ records, and a link to the FAQ page with all of them. Built by the server.', 'questions that open in place, and a button', faqHome(o));
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
  o = o || {};
  var groups = juryGroups(content);
  if (!groups.length && !(o.bound && o.hasJury)) return [];
  var c = 'aw-jp', id = 'award-jury-groups';
  /* bound: every juror of the event's Speakers records, in their order, in one grid */
  if (o.bound) groups = [{ group: '', people: [] }];
  var named = !o.bound && (groups.length > 1 || groups[0].group);
  var body = o.bound ? '<div class="' + c + '-group"><div class="' + c + '-grid">' + boundPersonCard(c) + '</div></div>' : groups.map(function (g, i) {
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

function faqPage(kind, content, o) {
  /* every FAQ record of the event (Content › FAQ), as the home page's first five are — so the page follows the records */
  var c = 'aw-faq', id = 'award-faq-list';
  var html = root(id, c, kind) + '<div class="' + c + '-in"><h2 class="' + c + '-sr" id="' + id + '-title">Frequently asked questions</h2>' +
    '<div class="' + c + '-items">' + faqItem(c) + '</div></div></section>';
  var css = '.' + c + '{background:var(--rv-bg);color:var(--rv-text);padding:clamp(48px,6vw,88px) 0 clamp(64px,8vw,112px);font-family:var(--body-font-family)}' +
    '.' + c + '-in{max-width:860px;margin:0 auto;padding:0 24px}' +
    '.' + c + '-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    faqCss(c) + '@media (max-width:640px){.' + c + '-in{padding:0 16px}}';
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
