/* What makes an AI-designed AWARD site an ET award site (analysed from 24 live ET award sites and ET's award
   API, 23 Oct 2026): ET's home-page order, and the words of its internal pages written for this edition.

   The home page, in ET's order (AWARD_SECTIONS): overview, key dates, why enter, the categories, how the
   awards work (scrutiny by a tabulator -> review -> grand jury), the jury, the recognition winners get, the
   awards night, who should enter, the partners, past editions' glimpses, FAQs, contact, about the vertical.
   The sections built from records (award-sections.js: key dates, categories, jury, partners) are not written
   by a model; the rest are, in the site's own design, like any generated section.

   The internal pages' words (Entry Guidelines, Judging Criteria, Terms & Conditions, FAQs — and the
   categories when ET has none on record, as for an award made from a brief alone) are written by one reading
   (buildPagesPrompt / PAGES_SCHEMA / sanitizePages): rewritten for this edition from the previous edition's
   own pages when there are any (its year and dates brought up to date, nothing copied as it stood — the
   owner's rule: a previous edition inspires, its records alone are taken over), else written from the brief
   and what ET award sites say in general. All of it is the owner's to edit afterwards.

     AWARD_SECTIONS                       [{ id, name, kind, prebuilt?, also, purpose }]
     awardSectionFor(id)                  the AWARD_SECTIONS entry an id stands for, or null
     buildPagesPrompt(o)                  o: { event: { name, edition, dates:{ nominationOpen, nominationClose,
                                          ceremony }, venue, description }, brief, previousPages: { guidelines,
                                          judging, tnc, faq }, needCategories: bool }
     PAGES_SCHEMA
     sanitizePages(parsed, needCategories) -> { guidelines, judging, tnc: TEXTPAGE|null, faq: [{ q, a, group }],
                                          categories: [{ name, description, isNew:false, fee: null,
                                          subcategories:[...] }] }  (no fee is known for a proposed one)
   TEXTPAGE = { title, intro, blocks: [{ heading, paragraphs: [..], bullets: [..] }] } (award-sections.js) */
'use strict';

/* ET's home page for an award, in its order. `prebuilt` sections are built by the server from records
   (award-sections.js homeSections); with no record behind them they are left out. */
var AWARD_SECTIONS = [
  { id: 'overview', name: 'Overview', kind: 'custom', also: /overview|about (the )?awards?|introduc|celebrating/,
    purpose: 'What these awards are, what they recognise, who is behind them and why they matter this year.' },
  { id: 'key-dates', name: 'Key Dates', kind: 'custom', prebuilt: 'award-key-dates', also: /key[- ]dates|timeline|milestones|important dates/ },
  { id: 'why-enter', name: 'Why Enter', kind: 'custom', also: /why[- ](enter|nominate|participate|join)|reasons|benefit/,
    purpose: 'Why an organisation or a professional should enter: the recognition, credibility, visibility and business it brings.' },
  { id: 'award-categories', name: 'Award Categories', kind: 'custom', prebuilt: 'award-categories', also: /categor/ },
  { id: 'how-it-works', name: 'How Our Awards Work', kind: 'custom', also: /how[- ](our[- ])?awards?[- ]work|process|judging|evaluation|methodology/,
    purpose: 'How entries are judged, as on every ET award: scrutiny by an expert tabulator, a thorough multi-stage review, then the grand jury — with the principles of fairness, integrity and confidentiality.' },
  { id: 'award-jury', name: 'Jury', kind: 'custom', prebuilt: 'award-jury', also: /jury|judges/ },
  { id: 'recognition', name: 'The Recognition', kind: 'custom', also: /recognition|winners get|what you win|rewards/,
    purpose: 'What the winners get: the trophy on stage, the certificate, the coverage across ET, the right to use the winner\'s logo.' },
  { id: 'awards-night', name: 'Awards Night', kind: 'custom', also: /awards?[- ]night|ceremony|gala|evening/,
    purpose: 'The grand award ceremony: when and where it takes place, who gathers there, and how to be in the room.' },
  { id: 'who-should-enter', name: 'Who Should Enter', kind: 'custom', also: /who[- ](should|can)[- ](enter|nominate|apply)|eligib|who should attend/,
    purpose: 'Who can enter: the kinds of organisations and professionals the categories are open to.' },
  { id: 'award-partners', name: 'Partners', kind: 'partners', prebuilt: 'award-partners', also: /partner|sponsor|supported by/ },
  { id: 'past-edition-glimpses', name: 'Past Edition Glimpses', kind: 'glimpses', also: /glimpse|gallery|past edition|previous edition|highlights|moments/ },
  { id: 'faqs', name: 'FAQs', kind: 'faq', also: /faq|frequently asked|questions/ },
  { id: 'contact-us', name: 'Contact Us', kind: 'contact', also: /contact|get in touch|reach us|enquir/ },
  { id: 'about-vertical', name: 'About Vertical', kind: 'custom', also: /about (et|the economic times|us|the organi[sz]er|the vertical)|about et[a-z]+|organi[sz]ed by/,
    purpose: 'About the ET vertical that runs these awards: its readership and standing in the industry.' }
];

function slug(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
function awardSectionFor(id) {
  var k = slug(id);
  if (!k) return null;
  var exact = AWARD_SECTIONS.filter(function (s) { return s.id === k; })[0];
  if (exact) return exact;
  var words = k.replace(/-/g, ' ');
  return AWARD_SECTIONS.filter(function (s) { return s.also.test(words); })[0] || null;
}

/* ---------- the internal pages' words ---------- */
var TEXTPAGE = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    intro: { type: 'STRING', description: 'one or two sentences under the title; may be empty' },
    blocks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          heading: { type: 'STRING' },
          paragraphs: { type: 'ARRAY', items: { type: 'STRING' } },
          bullets: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['heading', 'paragraphs', 'bullets']
      }
    }
  },
  required: ['title', 'intro', 'blocks']
};
var CATEGORY = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    description: { type: 'STRING' },
    subcategories: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, description: { type: 'STRING' } }, required: ['name', 'description'] } }
  },
  required: ['name', 'description', 'subcategories']
};
var PAGES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    guidelines: TEXTPAGE,
    judging: TEXTPAGE,
    tnc: TEXTPAGE,
    faq: { type: 'ARRAY', items: { type: 'OBJECT', properties: { group: { type: 'STRING' }, q: { type: 'STRING' }, a: { type: 'STRING' } }, required: ['group', 'q', 'a'] } },
    categories: { type: 'ARRAY', description: 'ONLY when asked for: the master categories, each with its sub-categories. Otherwise an empty array.', items: CATEGORY }
  },
  required: ['guidelines', 'judging', 'tnc', 'faq', 'categories']
};

function clip(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
function pageText(p) {
  if (!p || !Array.isArray(p.blocks)) return '';
  return p.blocks.slice(0, 40).map(function (b) {
    return '## ' + clip(b.heading, 160) + '\n' + (b.paragraphs || []).slice(0, 8).map(function (x) { return clip(x, 900); }).join('\n') +
      ((b.bullets || []).length ? '\n' + b.bullets.slice(0, 20).map(function (x) { return '- ' + clip(x, 400); }).join('\n') : '');
  }).join('\n\n').slice(0, 9000);
}

function buildPagesPrompt(o) {
  o = o || {};
  var ev = o.event || {}, d = ev.dates || {}, prev = o.previousPages || {};
  var dates = [['nominations open', d.nominationOpen], ['nominations close', d.nominationClose], ['the awards night', d.ceremony]]
    .map(function (x) { return x[0] + ': ' + (x[1] ? String(x[1]).slice(0, 10) : 'to be announced'); }).join('; ');
  var had = ['guidelines', 'judging', 'tnc'].filter(function (k) { return pageText(prev[k]); });
  var lines = [
    'You are writing the internal pages of an ET (The Economic Times) award website: "' + clip(ev.name, 160) + '"' + (ev.edition ? ' (' + clip(ev.edition, 40) + ')' : '') + '.',
    'Its dates — ' + dates + '.' + (ev.venue ? ' The awards night is at ' + clip(ev.venue, 160) + '.' : ''),
    ev.description ? 'What the awards are: ' + clip(ev.description, 1500) : '',
    o.brief ? 'The brief: ' + clip(JSON.stringify(o.brief), 4000) : '',
    '',
    'Write, for THIS edition:',
    '- "guidelines" (title "Entry Guidelines"): how to enter, as numbered steps (create your account or log in, select your categories, start your entries, save, submit), then guidelines for the entry write-up, then important points (eligibility period, one entry per category, documents, deadlines).',
    '- "judging" (title "Judging Criteria"): the eligibility criteria, the criteria the jury weighs (with weightage where the previous edition gives it), and the process (scrutiny by an expert tabulator, a multi-stage review, the grand jury), with fairness, integrity and confidentiality.',
    '- "tnc" (title "Terms & Conditions"): the terms of entry — eligibility, the organiser\'s rights, use of submitted material, jury decisions being final, confidentiality, withdrawal, disqualification, the use of the winner\'s logo, and changes to dates.',
    '- "faq": 10 to 16 questions and answers, grouped as "General Information", "Qualification" and "Judging Process".',
    o.needCategories
      ? '- "categories": no categories are on record for this edition: propose 3 to 6 master categories, each with 3 to 8 sub-categories that suit this award\'s field, each with a one-sentence description.'
      : '- "categories": an empty array (this edition\'s categories are on record).',
    '',
    had.length || (prev.faq || []).length
      ? 'The PREVIOUS EDITION\'s own pages are below. Write this edition\'s pages from them — keep what still holds (its steps, criteria, rules and their substance), bring every year and date up to this edition\'s, and put it in your own words; never copy its sentences as they stood. Where a previous page is missing, write that page from what ET award sites say in general.'
      : 'There is no previous edition to go on: write the pages from the brief and what ET award sites say in general.',
    had.indexOf('guidelines') !== -1 ? '\n=== Previous edition: Entry Guidelines ===\n' + pageText(prev.guidelines) : '',
    had.indexOf('judging') !== -1 ? '\n=== Previous edition: Judging Criteria ===\n' + pageText(prev.judging) : '',
    had.indexOf('tnc') !== -1 ? '\n=== Previous edition: Terms & Conditions ===\n' + pageText(prev.tnc) : '',
    (prev.faq || []).length ? '\n=== Previous edition: FAQs ===\n' + prev.faq.slice(0, 30).map(function (f) { return 'Q: ' + clip(f.q, 300) + '\nA: ' + clip(f.a, 900); }).join('\n') : '',
    '',
    'HOW ENTRIES ARE MADE ON THIS SITE: through the nomination form on this website (choose a category, give the nominee\'s and the organisation\'s details, an entry title and a summary, with a supporting link if any). There is no account to create, no log-in and no document upload — never describe those, whatever the previous edition said. Where a category has a nomination fee it is listed with the category; how it is paid will be announced, so never describe a payment step.',
    'Rules: plain sentences only (no markdown, no HTML); no dates other than this edition\'s (say "to be announced" for one not known); never invent a fee, a prize amount, a person\'s name or a partner; British/Indian English.'
  ];
  return lines.filter(function (l) { return l !== ''; }).join('\n');
}

function cleanPage(p, title) {
  if (!p || typeof p !== 'object') return null;
  var blocks = (Array.isArray(p.blocks) ? p.blocks : []).slice(0, 40).map(function (b) {
    return {
      heading: clip(b && b.heading, 160),
      paragraphs: (Array.isArray(b && b.paragraphs) ? b.paragraphs : []).map(function (x) { return clip(x, 1200); }).filter(Boolean).slice(0, 10),
      bullets: (Array.isArray(b && b.bullets) ? b.bullets : []).map(function (x) { return clip(x, 500); }).filter(Boolean).slice(0, 24)
    };
  }).filter(function (b) { return b.heading || b.paragraphs.length || b.bullets.length; });
  if (!blocks.length) return null;
  return { title: clip(p.title, 120) || title, intro: clip(p.intro, 600), blocks: blocks };
}
function sanitizePages(parsed, needCategories) {
  parsed = parsed || {};
  var faq = (Array.isArray(parsed.faq) ? parsed.faq : []).slice(0, 30).map(function (f) {
    return { group: clip(f && f.group, 60), q: clip(f && f.q, 300), a: clip(f && f.a, 1500) };
  }).filter(function (f) { return f.q && f.a; });
  var categories = !needCategories ? [] : (Array.isArray(parsed.categories) ? parsed.categories : []).slice(0, 12).map(function (c) {
    /* no fee is known for a proposed category: none is shown (never "no fee", which would be a claim) */
    var free = null;
    return {
      name: clip(c && c.name, 140), slug: slug(c && c.name), description: clip(c && c.description, 600), isNew: false, fee: free,
      subcategories: (Array.isArray(c && c.subcategories) ? c.subcategories : []).slice(0, 20).map(function (s) {
        return { name: clip(s && s.name, 160), slug: slug(s && s.name), description: clip(s && s.description, 600), isNew: false, fee: free };
      }).filter(function (s) { return s.name; })
    };
  }).filter(function (c) { return c.name; });
  return {
    guidelines: cleanPage(parsed.guidelines, 'Entry Guidelines'),
    judging: cleanPage(parsed.judging, 'Judging Criteria'),
    tnc: cleanPage(parsed.tnc, 'Terms & Conditions'),
    faq: faq,
    categories: categories
  };
}

module.exports = { AWARD_SECTIONS: AWARD_SECTIONS, awardSectionFor: awardSectionFor, buildPagesPrompt: buildPagesPrompt, PAGES_SCHEMA: PAGES_SCHEMA, sanitizePages: sanitizePages };
