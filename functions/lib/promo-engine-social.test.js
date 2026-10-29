// node functions/lib/promo-engine-social.test.js — the platform's 9 social-post templates as the vendored engine
// carries them (promo-engine/src/templates, built into vendor/promo-engine.js): their order, formats and catalog,
// each one's HTML and caption, Oneworld's QR tile (only when there is a QR, so a post without one is the platform's
// byte for byte) and the Testimonial that never invents a quote. No network: the engine is pure.
//
// SOURCE pins the platform's own output. It was recorded by running the platform's unchanged template files
// (~/Downloads/Social Post Generator/app/src/templates, bundled with esbuild outside the repo, with
// registry.ts's resolveParams beside them) over this file's fixtures:
//   node functions/lib/promo-engine-social.test.js --record <that bundle>
// (that mode runs no check). Record again only if the platform's templates are vendored again.
var crypto = require('crypto'), path = require('path');

/* dates read in UTC (Prediction vs Outcome labels its cards by year) */
process.env.TZ = 'UTC';
var RECORD = process.argv[2] === '--record' ? path.resolve(process.argv[3] || '') : '';
var engine = require(RECORD || './vendor/promo-engine');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
function sha(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'); }
function count(s, sub) { return String(s).split(sub).length - 1; }
/* the templates' own escaper (base.ts esc), for building expected strings */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ---- fixtures: a rich event and a sparse one, as lib/promo-mailer.js entityOf hands them to the engine ---- */
function speaker(i, name, designation, company, group, photo) {
  return { id: 's' + i, name: name, designation: designation, company: company,
    photoUrl: photo === false ? undefined : 'https://img.etb2bimg.com/files/cp/speaker-' + i + '.jpg', group: group, weightage: i };
}
function sponsor(i, title, tier, logo) {
  return { id: 'p' + i, title: title, logoUrl: logo === false ? undefined : 'https://img.etb2bimg.com/files/cp/partner-' + i + '.png',
    tier: tier, url: 'https://partner' + i + '.example.com', weightage: i };
}
var DEVANAGARI = 'अनन्या शर्मा';
var ODD = 'O\'Brien "QA" <b>';
var RICH = {
  portal: 'cio', entityId: 0, oneworldId: 'qa-rich',
  name: 'ET Agentic AI Summit 2026', edition: 9, tagline: 'Where enterprise AI gets real.',
  description: 'The ninth edition brings together the CIOs and CTOs turning agentic AI into working systems.',
  hashtag: '#AgenticAiSummit26',
  startDate: '2026-11-20', endDate: '2026-11-21', dateLabel: '20-21 November, 2026', totalDays: 2,
  venue: 'Taj Lands End', city: 'Mumbai', presenter: 'Northwind Analytics',
  ctaLabel: 'Register Now', ctaUrl: 'https://agentic.example.com/register',
  logoUrl: 'https://img.etb2bimg.com/files/cp/agentic-mark-512.png', keyVisualUrl: 'https://img.etb2bimg.com/files/cp/agentic-hero-1600x700.jpg',
  keyVisualMode: 'hero', micrositeUrl: 'https://agentic.example.com', siteAccent: '#e4002b', siteTheme: 'dark',
  whoShouldAttend: ['CIOs and CTOs', 'Heads of AI', 'Chief Data Officers', 'Enterprise architects', 'Founders <b>x</b>', 'Digital transformation leads'],
  keyPoints: ['Agents in production', 'Governance that ships'], whyJoin: ['Meet 80+ speakers'],
  stats: [{ label: 'Speakers', value: '80+' }, { label: 'Attendees', value: '1,500+' }, { label: 'Sessions', value: '40' }, { label: 'Partners', value: '25' }],
  speakers: [
    speaker(1, 'Asha Rao', 'Chief Executive Officer', 'City Hospital', 'Keynote Speakers'),
    speaker(2, DEVANAGARI, 'मुख्य तकनीकी अधिकारी', 'भारत डिजिटल', 'Keynote Speakers'),
    speaker(3, 'Rohan Mehta', 'Chief Information Officer', 'Northwind Retail', 'Keynote Speakers'),
    speaker(4, ODD, 'Head of <i>Testing</i> & QA', 'Quote "Co"', 'Speakers'),
    speaker(5, 'Kavya Iyer', 'VP Engineering', 'Tarqen Systems', 'Speakers', false),
    speaker(6, 'Vikram Singh', 'Director, Data', 'Helio Bank', 'Speakers'),
    speaker(7, 'Meera Kulkarni', 'Head of AI', 'Lumen Insurance', 'Speakers'),
    speaker(8, 'Arjun Nair', 'CTO', 'Saffron Logistics', 'Speakers')
  ],
  sponsorTiers: [
    { tier: 'Presenting Partner', sponsors: [sponsor(1, 'Northwind Analytics', 'Presenting Partner')] },
    { tier: 'Gold Partners', sponsors: [sponsor(2, 'Helio Cloud', 'Gold Partners'), sponsor(3, 'Tarqen Systems', 'Gold Partners', false)] },
    { tier: 'Associate Partners', sponsors: [sponsor(4, 'Saffron Data', 'Associate Partners'), sponsor(5, 'Lumen AI', 'Associate Partners'), sponsor(6, 'Kestrel Labs', 'Associate Partners')] }
  ],
  sessions: [{ id: 'x1', title: 'Keynote: agents at work', start: '2026-11-20T10:00:00', speakers: [] }]
};
var SPARSE = {
  portal: 'hr', entityId: 0, oneworldId: 'qa-sparse',
  name: 'ET HR Leaders Meet', hashtag: '', startDate: '2026-12-05', dateLabel: '5 December, 2026',
  ctaLabel: 'Register Now', keyVisualMode: 'hero', siteTheme: 'light',
  whoShouldAttend: [], keyPoints: [], whyJoin: [], stats: [], speakers: [], sponsorTiers: [], sessions: []
};
var ART = { backgroundUrl: 'https://storage.googleapis.com/revamp-test.appspot.com/events/qa-rich/promo-art/bg1-mh3k2x-0123456789abcdef.png',
  logoUnitUrl: 'https://storage.googleapis.com/revamp-test.appspot.com/events/qa-rich/promo-art/logoUnit-mh3k2x-fedcba9876543210.png' };
var QUOTE = 'Two days that changed how our team ships AI — sharp, practical and "honest" <really>.';
var IDS = ['generic.announcement', 'generic.who-should-attend', 'generic.summit-highlights', 'generic.prediction-outcome', 'generic.testimonial',
  'partner.tier-ladder', 'partner.presenting-spotlight', 'speaker.individual', 'speaker.combined'];
var FMTS = ['ig_square', 'ig_portrait', 'landscape', 'story'];
var RATIO = { ig_square: '1:1', ig_portrait: '4:5', landscape: '16:9', story: '9:16' };
/* the templates that end on the shared footer bar (all but the Announcement, which has its own button) */
var FOOTER_IDS = IDS.filter(function (id) { return id !== 'generic.announcement'; });

/* The cases the platform's own output is pinned for. The Testimonial is given a quote in each, because without one
   Oneworld draws it differently on purpose (checked on its own below). */
var PICKS = {
  'generic.announcement': { kicker: 'Mark your <calendar>', stats: [{ value: '9th', label: 'Edition' }, { value: '<b>x</b>', label: 'Odd "label"' }] },
  'generic.who-should-attend': { limit: 3, title: 'Built for <you>' },
  'generic.summit-highlights': { title: 'By the numbers', stats: [1, 2, 3, 4, 5, 6, 7].map(function (n) { return { value: n + '0+', label: 'Tile ' + n }; }) },
  'generic.prediction-outcome': { headline: 'Then & now', prediction: 'Agents were a demo <i>', outcome: 'Agents are a line item', predictionLabel: 'Then', outcomeLabel: 'Now' },
  'generic.testimonial': { quote: QUOTE, speakerId: 's5', authorTitle: 'Override "title"' },
  'partner.tier-ladder': { sponsorIds: ['p5', 'p1'], title: 'With thanks' },
  'partner.presenting-spotlight': { tier: 'Gold Partners' },
  'speaker.individual': { speakerId: 's4', roleLabel: '' },
  'speaker.combined': { speakerIds: 's2,s4,s1', title: 'Line-up' }
};
var CASES = {
  rich: { ev: RICH, params: function (id) { return id === 'generic.testimonial' ? { quote: QUOTE } : {}; } },
  'rich-light-art': { ev: RICH, assets: ART, params: function (id) { return id === 'generic.testimonial' ? { theme: 'light', quote: QUOTE } : { theme: 'light' }; } },
  picks: { ev: RICH, params: function (id) { return PICKS[id]; } },
  sparse: { ev: SPARSE, params: function (id) { return id === 'generic.testimonial' ? { quote: QUOTE } : {}; } }
};

/* one post, built as lib/promo-social.js builds it (§5f): the template's defaults under the sent options */
function renderWith(eng, id, fmt, ev, params, assets) {
  var tpl = eng.getTemplate(id);
  var ctx = { event: clone(ev), brand: eng.getBrand(ev.portal), format: eng.FORMATS[fmt], params: eng.resolveParams(tpl, clone(params || {})), assets: clone(assets) };
  return { html: tpl.render(ctx), caption: tpl.caption(ctx) };
}
function render(id, fmt, ev, params, assets) { return renderWith(engine, id, fmt, ev, params, assets); }
/* every case × template: one hash over the four formats' HTML, and the caption (the same in every format) */
function outputsOf(eng) {
  var out = { html: {}, caption: {} };
  Object.keys(CASES).forEach(function (c) {
    var k = CASES[c];
    IDS.forEach(function (id) {
      if (!eng.getTemplate(id).requires(clone(k.ev)).ok) return;
      var r = FMTS.map(function (f) { return renderWith(eng, id, f, k.ev, k.params(id), k.assets); });
      out.html[c + ':' + id] = sha(r.map(function (x) { return x.html; }).join('\n\u0000\n'));
      out.caption[c + ':' + id] = r[0].caption;
    });
  });
  return out;
}

if (RECORD) {
  console.log(JSON.stringify(outputsOf(engine), null, 2));
  process.exit(0);
}

/* the platform's own output for CASES, recorded as the header says (html: sha256 over the 4 formats) */
var SOURCE = {
  "html": {
    "rich:generic.announcement": "6ccd8d772935e543e8159ff573f55091958622dc6a7ae88a59721be312bd1c88",
    "rich:generic.who-should-attend": "e42ac9229af5dbf1a237ae2e364d95e398c92080c4bec2c79cfeb8ca45b4e87c",
    "rich:generic.summit-highlights": "b8740c9a7e665caf5247c269400c845361b50911eeb4f07dc7fb1040b8cc1afa",
    "rich:generic.prediction-outcome": "a8cbd77a96f2f8388e05fbb2774d84e4783f72e7f4776624505dc098570575ef",
    "rich:generic.testimonial": "24d311c95c552dac179e6e461b8a3c899aadccb09d03e8966685ebf05ce08b7d",
    "rich:partner.tier-ladder": "3b64ede410ea51d52b071cd1b9cf44df7fdeb7c162293d19283c93d683bbd2df",
    "rich:partner.presenting-spotlight": "163b5f4eb3677a99152a375a72d318a6546e618990e521a201b9987a055d8a2e",
    "rich:speaker.individual": "ef92ea1d1c7659442caf815c590f00a4da59ecff4362cbe3e8e73339790370cc",
    "rich:speaker.combined": "6523eb936dc0eeb42b753235c0312d40e8eb27eba492fe1feb603d2ffd3c2c7f",
    "rich-light-art:generic.announcement": "917be2d590b7c0af445e8995d18b95dd3336fbf08d28a0e5d6353ab131cb7746",
    "rich-light-art:generic.who-should-attend": "4fe2870e50d5e353f29f7a1b80618aba50368291cd0cf8e5ce8bb305ec712959",
    "rich-light-art:generic.summit-highlights": "0fbced8ccf42b36e250604853148742183a2931fc814c50b8eaacae215140f7c",
    "rich-light-art:generic.prediction-outcome": "c9ffc2b4f437c89ea39b6ee8a192d58fd6898cd679f9fcaef949733b9f37a125",
    "rich-light-art:generic.testimonial": "09319174371c002b5e62877e73092c205b53c885a810c7a47c6f1004d89a65f6",
    "rich-light-art:partner.tier-ladder": "8f16bd991dd48bf36aba3053d71e1317aa70ef4e31a35b4e7d0182815234d6c9",
    "rich-light-art:partner.presenting-spotlight": "db2fab7809918c27f268935176601e8f9bac747fa75fae5df3f3689ab38114f2",
    "rich-light-art:speaker.individual": "f9e215f785d8a7df0c3c866a088b803b570ccd5cf620616b169cb72a7052a8ef",
    "rich-light-art:speaker.combined": "15a6d58a16b9d5c9a6b327f69a0531c47777136b3c72d3bafbbb922787f027e3",
    "picks:generic.announcement": "3cd723ec65c50c0dfa43c8dcc87c11b43fc359ebd08968a56a5d6b2358c4b27d",
    "picks:generic.who-should-attend": "f79d0d0b6175bd08585a9b62d7fb63c8881abd0d9375c1561b4094abf23f0009",
    "picks:generic.summit-highlights": "92ea57def0b7fd465d1b0f9f88010a89587515621703202fd18d79057d513381",
    "picks:generic.prediction-outcome": "bae9a255e9802c5e6dd29c951760364e6ccb9a8afad3d9cdab0568b2293b8f01",
    "picks:generic.testimonial": "ace84d3d74338d88095dd78117cde59b190b1fd597a3995700d916875e7729dd",
    "picks:partner.tier-ladder": "962f2fad97151bb61d3d6ecfd9dc4978bbe7ead36e2a1f4c8a38fe67a7fe0753",
    "picks:partner.presenting-spotlight": "f3511cdfcc4d5aca717b41dd1b01c44db672b656e17ee4a4bed4f82f957e48d4",
    "picks:speaker.individual": "4d24777d3c0cfd516016bb31a6c80e4e68ddf86baa043e0bc8fd707a50ec9367",
    "picks:speaker.combined": "c5e63ab214397b8b1bc4b48dbb59165364fbeb74f8a557c4130788e825996199",
    "sparse:generic.announcement": "ad3a890e5531a021a8096277b16b4e6c2e4e6f188ea716446b8be859c62ecd19",
    "sparse:generic.prediction-outcome": "2b841303a2385f2403c4d928156f95874c86731b732516ffd2eee118e987856f",
    "sparse:generic.testimonial": "9bd06de9051c83d3f4b1841cc115a6b33088c08a91de35022b7ff9739b9bbbcc"
  },
  "caption": {
    "rich:generic.announcement": "Save the date! ET Agentic AI Summit 2026 — Where enterprise AI gets real.. 20-21 November, 2026 · Taj Lands End. #AgenticAiSummit26",
    "rich:generic.who-should-attend": "Is ET Agentic AI Summit 2026 for you? CIOs and CTOs, Heads of AI, Chief Data Officers, Enterprise architects and more should attend. #AgenticAiSummit26",
    "rich:generic.summit-highlights": "ET Agentic AI Summit 2026 by the numbers — 80+ Speakers, 1,500+ Attendees, 40 Sessions, 25 Partners and more. #AgenticAiSummit26",
    "rich:generic.prediction-outcome": "From last year's signals to this year's action — see what's next at ET Agentic AI Summit 2026. #AgenticAiSummit26",
    "rich:generic.testimonial": "\"Two days that changed how our team ships AI — sharp, practical and \"honest\" <really>.\" — Asha Rao, Chief Executive Officer, City Hospital #AgenticAiSummit26",
    "rich:partner.tier-ladder": "Proud to be powered by our partners at ET Agentic AI Summit 2026 — Presenting Partner, Gold Partners, Associate Partners and more. #AgenticAiSummit26",
    "rich:partner.presenting-spotlight": "We're delighted to welcome Northwind Analytics as Presenting Partner at ET Agentic AI Summit 2026. #AgenticAiSummit26",
    "rich:speaker.individual": "Meet Asha Rao, Chief Executive Officer at City Hospital, joining us at ET Agentic AI Summit 2026. 20-21 November, 2026 · Taj Lands End. #AgenticAiSummit26",
    "rich:speaker.combined": "Presenting 8 speakers at ET Agentic AI Summit 2026 — Asha Rao, अनन्या शर्मा, Rohan Mehta, O'Brien \"QA\" <b>, Kavya Iyer and more. #AgenticAiSummit26",
    "rich-light-art:generic.announcement": "Save the date! ET Agentic AI Summit 2026 — Where enterprise AI gets real.. 20-21 November, 2026 · Taj Lands End. #AgenticAiSummit26",
    "rich-light-art:generic.who-should-attend": "Is ET Agentic AI Summit 2026 for you? CIOs and CTOs, Heads of AI, Chief Data Officers, Enterprise architects and more should attend. #AgenticAiSummit26",
    "rich-light-art:generic.summit-highlights": "ET Agentic AI Summit 2026 by the numbers — 80+ Speakers, 1,500+ Attendees, 40 Sessions, 25 Partners and more. #AgenticAiSummit26",
    "rich-light-art:generic.prediction-outcome": "From last year's signals to this year's action — see what's next at ET Agentic AI Summit 2026. #AgenticAiSummit26",
    "rich-light-art:generic.testimonial": "\"Two days that changed how our team ships AI — sharp, practical and \"honest\" <really>.\" — Asha Rao, Chief Executive Officer, City Hospital #AgenticAiSummit26",
    "rich-light-art:partner.tier-ladder": "Proud to be powered by our partners at ET Agentic AI Summit 2026 — Presenting Partner, Gold Partners, Associate Partners and more. #AgenticAiSummit26",
    "rich-light-art:partner.presenting-spotlight": "We're delighted to welcome Northwind Analytics as Presenting Partner at ET Agentic AI Summit 2026. #AgenticAiSummit26",
    "rich-light-art:speaker.individual": "Meet Asha Rao, Chief Executive Officer at City Hospital, joining us at ET Agentic AI Summit 2026. 20-21 November, 2026 · Taj Lands End. #AgenticAiSummit26",
    "rich-light-art:speaker.combined": "Presenting 8 speakers at ET Agentic AI Summit 2026 — Asha Rao, अनन्या शर्मा, Rohan Mehta, O'Brien \"QA\" <b>, Kavya Iyer and more. #AgenticAiSummit26",
    "picks:generic.announcement": "Save the date! ET Agentic AI Summit 2026 — Where enterprise AI gets real.. 20-21 November, 2026 · Taj Lands End. #AgenticAiSummit26",
    "picks:generic.who-should-attend": "Is ET Agentic AI Summit 2026 for you? CIOs and CTOs, Heads of AI, Chief Data Officers, Enterprise architects and more should attend. #AgenticAiSummit26",
    "picks:generic.summit-highlights": "ET Agentic AI Summit 2026 by the numbers — 10+ Tile 1, 20+ Tile 2, 30+ Tile 3, 40+ Tile 4 and more. #AgenticAiSummit26",
    "picks:generic.prediction-outcome": "From last year's signals to this year's action — see what's next at ET Agentic AI Summit 2026. #AgenticAiSummit26",
    "picks:generic.testimonial": "\"Two days that changed how our team ships AI — sharp, practical and \"honest\" <really>.\" — Kavya Iyer, Override \"title\" #AgenticAiSummit26",
    "picks:partner.tier-ladder": "Proud to be powered by our partners at ET Agentic AI Summit 2026 — Presenting Partner, Associate Partners and more. #AgenticAiSummit26",
    "picks:partner.presenting-spotlight": "We're delighted to welcome Helio Cloud as Gold Partners at ET Agentic AI Summit 2026. #AgenticAiSummit26",
    "picks:speaker.individual": "Meet O'Brien \"QA\" <b>, Head of <i>Testing</i> & QA at Quote \"Co\", joining us at ET Agentic AI Summit 2026. 20-21 November, 2026 · Taj Lands End. #AgenticAiSummit26",
    "picks:speaker.combined": "Presenting 3 speakers at ET Agentic AI Summit 2026 — अनन्या शर्मा, O'Brien \"QA\" <b>, Asha Rao. #AgenticAiSummit26",
    "sparse:generic.announcement": "Save the date! ET HR Leaders Meet. 5 December, 2026. ",
    "sparse:generic.prediction-outcome": "From last year's signals to this year's action — see what's next at ET HR Leaders Meet. ",
    "sparse:generic.testimonial": "\"Two days that changed how our team ships AI — sharp, practical and \"honest\" <really>.\" "
  }
};

/* ---- A.1 the 9 templates in the platform's order, and its formats ---- */
check('ALL_TEMPLATES: the platform\'s 9, in its order (registry.ts:16-26)', JSON.stringify(engine.ALL_TEMPLATES.map(function (t) { return t.id; })) === JSON.stringify(IDS),
  engine.ALL_TEMPLATES.map(function (t) { return t.id; }));
check('getTemplate finds each by id', IDS.every(function (id) { return engine.getTemplate(id) && engine.getTemplate(id).id === id; }));
check('getTemplate answers nothing for an unknown id or an inherited name', engine.getTemplate('nope') === undefined && engine.getTemplate('constructor') === undefined);
check('FORMATS is the platform\'s table (formats.ts:15-48)', JSON.stringify(engine.FORMATS) === JSON.stringify({
  ig_square: { id: 'ig_square', label: 'Square 1:1', width: 1080, height: 1080, ratio: '1:1', platforms: ['Instagram', 'LinkedIn', 'X'] },
  ig_portrait: { id: 'ig_portrait', label: 'Portrait 4:5', width: 1080, height: 1350, ratio: '4:5', platforms: ['Instagram', 'LinkedIn'] },
  landscape: { id: 'landscape', label: 'Landscape 16:9', width: 1200, height: 675, ratio: '16:9', platforms: ['LinkedIn', 'X'] },
  story: { id: 'story', label: 'Story 9:16', width: 1080, height: 1920, ratio: '9:16', platforms: ['Instagram Stories/Reels', 'LinkedIn'] }
}), engine.FORMATS);
check('DEFAULT_FORMATS (formats.ts:51)', JSON.stringify(engine.DEFAULT_FORMATS) === JSON.stringify(FMTS), engine.DEFAULT_FORMATS);
check('every template takes the 4 formats', engine.ALL_TEMPLATES.every(function (t) { return JSON.stringify(t.formats) === JSON.stringify(FMTS); }));
check('resolveParams puts defaults under what was sent', JSON.stringify(engine.resolveParams(engine.getTemplate('speaker.combined'), { limit: 3 })) ===
  JSON.stringify({ limit: 3, title: 'Meet Our Speakers' }), engine.resolveParams(engine.getTemplate('speaker.combined'), { limit: 3 }));
check('the engine still carries the mailers', engine.ALL_MAILERS.length === 18 && typeof engine.renderDoc === 'function');

/* ---- A.4 every template × format for the rich event ---- */
IDS.forEach(function (id) {
  FMTS.forEach(function (f) {
    var html = render(id, f, RICH, CASES.rich.params(id)).html;
    var tag = id + ' ' + f;
    check(tag + ': a whole page', /^<!doctype html>\n<html><head><meta charset="utf-8">/.test(html) && /<\/body><\/html>$/.test(html));
    check(tag + ': <body data-ratio> is the format\'s', count(html, '<body data-ratio="' + RATIO[f] + '">') === 1);
    check(tag + ': no undefined or NaN', html.indexOf('undefined') === -1 && html.indexOf('NaN') === -1);
    check(tag + ': no markup from the data gets through', html.indexOf('<b>') === -1 && html.indexOf('<i>') === -1 && html.indexOf('<you>') === -1);
  });
});
check('who-should-attend escapes a persona\'s markup', render('generic.who-should-attend', 'ig_square', RICH, {}).html.indexOf('Founders &lt;b&gt;x&lt;/b&gt;') !== -1);
var combinedHtml = render('speaker.combined', 'ig_portrait', RICH, {}).html;
check('combined shows the Devanagari name intact', combinedHtml.indexOf(DEVANAGARI) !== -1);
check('combined shows O\'Brien "QA" <b> as text', combinedHtml.indexOf(esc(ODD)) !== -1);
check('individual shows the Devanagari speaker when picked', render('speaker.individual', 'story', RICH, { speakerId: 's2' }).html.indexOf('<div class="spk-name">' + DEVANAGARI + '</div>') !== -1);
check('individual escapes O\'Brien and his title', (function (h) { return h.indexOf('<div class="spk-name">' + esc(ODD) + '</div>') !== -1 && h.indexOf(esc('Head of <i>Testing</i> & QA')) !== -1; })(render('speaker.individual', 'landscape', RICH, { speakerId: 's4' }).html));
check('art: the uploaded background goes behind the content, and the logo unit into the lockup', (function (h) {
  return h.indexOf('<div class="bg" style="background-image:url(\'' + ART.backgroundUrl + '\')"></div><div class="scrim"></div>') !== -1 &&
    h.indexOf('<img class="lockup-img" src="' + ART.logoUnitUrl + '" alt="">') !== -1;
})(render('generic.who-should-attend', 'ig_square', RICH, {}, ART).html));

/* ---- A.5 no QR, no change: the platform's output, byte for byte ---- */
var mine = outputsOf(engine);
check('SOURCE pins 30 cases (rich, rich with art in light, picked options: 9 each; sparse: its 3 available)',
  Object.keys(SOURCE.html || {}).length === 30 && Object.keys(SOURCE.caption || {}).length === 30, Object.keys(SOURCE.html || {}).length);
check('the same cases are available as on the platform', JSON.stringify(Object.keys(mine.html)) === JSON.stringify(Object.keys(SOURCE.html || {})), Object.keys(mine.html));
Object.keys(SOURCE.html || {}).forEach(function (k) {
  check('no QR: ' + k + ' is the platform\'s HTML in all 4 formats, byte for byte', mine.html[k] === SOURCE.html[k]);
  check('no QR: ' + k + ' caption is the platform\'s, untrimmed', mine.caption[k] === SOURCE.caption[k], [mine.caption[k], SOURCE.caption[k]]);
});
Object.keys(CASES).forEach(function (c) {
  var k = CASES[c];
  IDS.forEach(function (id) {
    if (!engine.getTemplate(id).requires(clone(k.ev)).ok) return;
    FMTS.forEach(function (f) {
      var html = render(id, f, k.ev, k.params(id), k.assets).html;
      check(c + ' ' + id + ' ' + f + ': no QR tile and no button row', html.indexOf('ow-qr') === -1 && html.indexOf('an-acts') === -1);
    });
  });
});
/* the platform's footerBar (base.ts:59-68), copied, whitespace included */
function sourceFooter(ev) {
  var where = [ev.venue || ev.city].filter(Boolean).join('');
  var dateVenue = [ev.dateLabel, where].filter(Boolean).join('  ·  ');
  return '\n    <div class="footer">\n      <div class="footer-when">' + esc(dateVenue) + '</div>\n      <div class="cta">' + esc(ev.ctaLabel) + '</div>\n    </div>';
}
[RICH, SPARSE].forEach(function (ev) {
  FOOTER_IDS.forEach(function (id) {
    if (!engine.getTemplate(id).requires(clone(ev)).ok) return;
    var html = render(id, 'ig_square', ev, id === 'generic.testimonial' ? { quote: QUOTE } : {}).html;
    check(ev.oneworldId + ' ' + id + ': the footer bar is the platform\'s string', count(html, sourceFooter(ev)) === 1);
  });
});
check('qrTile is exported', typeof engine.qrTile === 'function');
[undefined, {}, { qrUrl: '' }, { qrLabel: 'Scan to register' }, { backgroundUrl: ART.backgroundUrl }].forEach(function (assets) {
  check('qrTile is empty without a QR: ' + JSON.stringify(assets), engine.qrTile({ event: clone(RICH), format: engine.FORMATS.ig_square, params: {}, assets: assets }) === '');
});

/* ---- A.6 with a QR: Oneworld's tile, sized per format ---- */
var QR = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
var LABEL = 'Scan <to> "register" & go';
var SIZE = {
  ig_square: { px: 150, pad: '8px', radius: '12px', shadow: '0 4px 18px', font: '17px' },
  ig_portrait: { px: 150, pad: '8px', radius: '12px', shadow: '0 4px 18px', font: '17px' },
  landscape: { px: 104, pad: '6.4px', radius: '9.6px', shadow: '0 3.2px 14.4px', font: '13.6px' },
  story: { px: 201, pad: '8.48px', radius: '12.72px', shadow: '0 4.24px 19.08px', font: '18.02px' }
};
/* in 16:9 only: the footer's tile puts its caption beside the code and reaches into the footer's empty top padding
   and the canvas margin, so the footer keeps the button's height (a stacked tile cut the bodies' text and logos);
   a long caption wraps beside the code rather than squeezing the date line */
var FOOTER_16_9 = '.footer>.ow-qr{flex-direction:row;margin:-1.6cqw 0 -2.6cqw}' +
  '.footer>.ow-qr .ow-qr-t{white-space:normal;overflow-wrap:anywhere;max-width:152px}';
/* in 16:9 only, the Partner Spotlight's tile is pinned to the canvas instead: its body never shrinks, so with a logo
   unit it pushes the footer to the canvas's bottom edge and a tile that followed the footer hung 25 px off it. The
   pinned tile is Oneworld's stacked one, its caption wrapping within the code's tile (104 + 2 × 6.4 px), 18 px above
   the edge, and the date line steps right by that width and the footer's gap */
var FOOTER_16_9_PINNED = '.footer>.ow-qr{position:absolute;bottom:18px}' +
  '.footer>.ow-qr .ow-qr-t{white-space:normal;overflow-wrap:anywhere;max-width:116.8px;text-align:center}' +
  '.footer:has(>.ow-qr) .footer-when{margin-left:calc(116.8px + 3cqw)}';
/* in 16:9 only, Who Should Attend tightens its chips while there is a QR: the platform's six personas spill a row out
   of the panel and under the tile; tighter, they stay in the panel, in the same two columns */
var WSA_16_9 = '.wsa-grid{row-gap:1.2cqw}.wsa-item{padding-top:1cqw;padding-bottom:1cqw}';
/* in 16:9 only, the Testimonial with no photo closes up its column while there is a QR: the attribution under the
   card spilled into the footer's top padding, onto the tile's top edge */
var TST_16_9 = '.tst-main:has(>.tst-attr){gap:1.2cqw}.tst-attr{margin-top:.6cqw}';
var QR_CSS_16_9 = { 'generic.who-should-attend': WSA_16_9, 'generic.testimonial': TST_16_9 };
function tileOf(f, id) {
  var s = SIZE[f];
  var wide = f === 'landscape';
  return '<style>.ow-qr{display:flex;flex-direction:column;align-items:center;gap:' + s.pad + ';flex:none}' +
    '.ow-qr-code{display:block;width:' + s.px + 'px;height:' + s.px + 'px;background:#fff;padding:' + s.pad + ';border-radius:' + s.radius + ';' +
    'box-shadow:' + s.shadow + ' rgba(0,0,0,.18);box-sizing:content-box}' +
    '.ow-qr-t{font-size:' + s.font + ';font-weight:600;letter-spacing:.03em;white-space:nowrap}' +
    '.footer:has(.ow-qr) .footer-when{flex:1}' +
    (wide ? (id === 'partner.presenting-spotlight' ? FOOTER_16_9_PINNED : FOOTER_16_9) : '') +
    (wide && QR_CSS_16_9[id] || '');
}
var AN_ACTS = '.an-acts{display:flex;align-items:center;justify-content:space-between;gap:2cqw;margin-top:1.5cqw}.an-acts .an-cta{margin-top:0;align-self:center}';
/* in 16:9 only: the Announcement's panel is a two-column grid with the code beside the line above the button and the
   button, so the panel is no taller than without a QR (a row as tall as the code pushed both off the canvas); a long
   caption wraps under the code within 240 px, so the code's column never squeezes the stats */
var AN_ACTS_16_9 = '.an-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-auto-flow:row dense;column-gap:3cqw}' +
  '.an-panel>*{grid-column:1/-1}.an-panel>:has(+.an-acts),.an-acts>.an-cta{grid-column:1}' +
  '.an-acts{display:contents}.an-acts>.an-cta{margin-top:1.5cqw;align-self:start;justify-self:start}' +
  '.an-acts>.ow-qr{grid-column:2;grid-row:span 2;align-self:center}' +
  '.an-acts>.ow-qr .ow-qr-t{white-space:normal;overflow-wrap:anywhere;max-width:240px;text-align:center}';
var TILE_BODY = '<div class="ow-qr"><img class="ow-qr-code" src="' + QR + '" alt="QR code"><div class="ow-qr-t">' + esc(LABEL) + '</div></div>';
Object.keys(CASES).forEach(function (c) {
  var k = CASES[c];
  IDS.forEach(function (id) {
    if (!engine.getTemplate(id).requires(clone(k.ev)).ok) return;
    FMTS.forEach(function (f) {
      var tag = c + ' ' + id + ' ' + f + ' with a QR: ';
      var assets = Object.assign({}, k.assets || {}, { qrUrl: QR, qrLabel: LABEL });
      var plain = render(id, f, k.ev, k.params(id), k.assets).html;
      var html = render(id, f, k.ev, k.params(id), assets).html;
      check(tag + 'one tile', count(html, 'class="ow-qr"') === 1 && count(html, 'class="ow-qr-code"') === 1 && count(html, 'class="ow-qr-t"') === 1);
      if (id === 'generic.announcement') {
        var cta = '<div class="an-cta">' + esc(k.ev.ctaLabel) + '</div>';
        var row = '<div class="an-acts">' + cta + tileOf(f, id) + AN_ACTS + (f === 'landscape' ? AN_ACTS_16_9 : '') + '</style>' + TILE_BODY + '</div>';
        check(tag + 'the button and the code share one row', count(html, row) === 1);
        check(tag + 'and nothing else changed', html.replace(row, cta) === plain);
      } else {
        var tile = tileOf(f, id) + '</style>' + TILE_BODY;
        check(tag + 'the tile leads the footer', count(html, '<div class="footer">\n      ' + tile + '<div class="footer-when">') === 1);
        check(tag + 'no button-row CSS outside the Announcement', html.indexOf('an-acts') === -1);
        check(tag + 'and nothing else changed', html.replace(tile, '') === plain);
      }
    });
  });
});
check('the tile\'s code is a sized picture (150 / 150 / 104 / 201 px)', FMTS.every(function (f) {
  return render('partner.tier-ladder', f, RICH, {}, { qrUrl: QR, qrLabel: 'x' }).html.indexOf('width:' + SIZE[f].px + 'px;height:' + SIZE[f].px + 'px') !== -1;
}));
check('the code\'s address is escaped', render('speaker.combined', 'ig_square', RICH, {}, { qrUrl: 'data:image/svg+xml;base64,AA"onerror="x', qrLabel: 'y' }).html
  .indexOf('src="data:image/svg+xml;base64,AA&quot;onerror=&quot;x"') !== -1);
check('an empty caption still writes the caption line the contract fixes (.ow-qr > img.ow-qr-code + .ow-qr-t), empty', [undefined, ''].every(function (l) {
  var h = render('generic.summit-highlights', 'story', RICH, {}, { qrUrl: QR, qrLabel: l }).html;
  return count(h, 'class="ow-qr"') === 1 && count(h, '<img class="ow-qr-code" src="' + QR + '" alt="QR code"><div class="ow-qr-t"></div></div>') === 1;
}));
check('the 16:9 footer rule and the Announcement\'s 16:9 grid ship only in 16:9', FMTS.every(function (f) {
  var foot = render('speaker.combined', f, RICH, {}, { qrUrl: QR, qrLabel: 'x' }).html;
  var an = render('generic.announcement', f, RICH, {}, { qrUrl: QR, qrLabel: 'x' }).html;
  var wide = f === 'landscape';
  return (foot.indexOf(FOOTER_16_9) !== -1) === wide && (an.indexOf(AN_ACTS_16_9) !== -1) === wide && foot.indexOf('an-panel') === -1;
}));
/* The 16:9 tile reaches into space the platform's layout keeps empty, and no further: above it, the footer's top
   padding (base.ts .footer padding-top:3cqw); below it, the canvas margin (16:9 .content padding 4cqw, read against
   the 1200 px canvas, while the tile's cqw are .content's 1080 px). What it leaves clear is checked here; that the
   footer then keeps the button's height and the bodies lose nothing needs a browser, so it is measured in Chrome
   (plan §9a P4), not here. */
(function () {
  var css = render('speaker.combined', 'landscape', RICH, {}, { qrUrl: QR, qrLabel: 'x' }).html;
  var m = /\.footer>\.ow-qr\{flex-direction:row;margin:-([\d.]+)cqw 0 -([\d.]+)cqw\}/.exec(css);
  var footPad = /\.footer \{[^}]*padding-top:([\d.]+)cqw;/.exec(css), contentPad = /body\[data-ratio="16:9"\] \.content \{ padding:([\d.]+)cqw /.exec(css);
  var W = engine.FORMATS.landscape.width, inner = W - 2 * 5 * W / 100;
  var up = m && +m[1] * inner / 100, down = m && +m[2] * inner / 100;
  check('16:9: the tile stays at least 12 px clear of the body above it', !!(m && footPad && footPad[1] * inner / 100 - up >= 12), [m && m[1], footPad && footPad[1]]);
  check('16:9: the tile stays at least 16 px clear of the canvas edge below it', !!(m && contentPad && contentPad[1] * W / 100 - down >= 16), [m && m[2], contentPad && contentPad[1]]);
})();
check('in 16:9 only, the Partner Spotlight pins its tile and Who Should Attend and the Testimonial close up their bodies; every other footer keeps the footer rule', FMTS.every(function (f) {
  var wide = f === 'landscape';
  return FOOTER_IDS.every(function (id) {
    var h = render(id, f, RICH, CASES.rich.params(id), { qrUrl: QR, qrLabel: 'x' }).html;
    var pinned = wide && id === 'partner.presenting-spotlight';
    return (h.indexOf(FOOTER_16_9_PINNED) !== -1) === pinned && (h.indexOf(FOOTER_16_9) !== -1) === (wide && !pinned) &&
      (h.indexOf(WSA_16_9) !== -1) === (wide && id === 'generic.who-should-attend') &&
      (h.indexOf(TST_16_9) !== -1) === (wide && id === 'generic.testimonial') && (h.indexOf('.ow-qr{position:absolute') !== -1) === pinned;
  });
}));
/* The pinned tile (Partner Spotlight, 16:9) stands on the canvas whatever its footer does: its shadow (0 3.2px 14.4px)
   stays above the canvas's edge, and the date line steps right by exactly the white tile's width (the code and its
   padding, the widest the stacked tile gets, as its caption wraps within it) plus the footer's own gap, so it never
   runs under the tile. Where the tile then lands is measured in Chrome (plan §9a P4). */
(function () {
  var css = render('partner.presenting-spotlight', 'landscape', RICH, {}, { qrUrl: QR, qrLabel: 'x' }).html;
  var b = /\.footer>\.ow-qr\{position:absolute;bottom:([\d.]+)px\}/.exec(css), sh = /^0 ([\d.]+)px ([\d.]+)px$/.exec(SIZE.landscape.shadow);
  var tileW = (SIZE.landscape.px + 2 * parseFloat(SIZE.landscape.pad)) + 'px', gap = /\.footer \{[^}]*gap:([\d.]+cqw);/.exec(css);
  check('16:9 pinned: the tile and its shadow stay on the canvas, at least 16 px above its edge', !!(b && sh && +b[1] >= 16 && +b[1] >= +sh[1] + +sh[2]), b && b[1]);
  check('16:9 pinned: the caption wraps within the white tile, and the date line steps right by its width and the footer\'s gap',
    !!gap && css.indexOf('max-width:' + tileW + ';text-align:center}') !== -1 && css.indexOf('.footer-when{margin-left:calc(' + tileW + ' + ' + gap[1] + ')}') !== -1, [tileW, gap && gap[1]]);
})();
check('a QR never changes a caption', IDS.every(function (id) {
  var p = CASES.rich.params(id);
  return render(id, 'ig_square', RICH, p, { qrUrl: QR, qrLabel: LABEL }).caption === render(id, 'ig_square', RICH, p).caption;
}));

/* ---- A.7 the Testimonial: a real quote, or no voice at all ---- */
var tst = engine.getTemplate('generic.testimonial');
check('the quote option starts empty', tst.params.filter(function (p) { return p.key === 'quote'; })[0].default === '' && engine.resolveParams(tst, {}).quote === '');
check('the kicker is still the platform\'s', engine.resolveParams(tst, {}).kicker === 'Voices of Last Edition');
[{}, { quote: '   ' }, { author: 'Someone Else', authorTitle: 'Somewhere' }, { speakerId: 's2' }].forEach(function (p) {
  FMTS.forEach(function (f) {
    var r = render('generic.testimonial', f, RICH, p), h = r.html, tag = 'Testimonial ' + f + ' ' + JSON.stringify(p) + ', no quote: ';
    check(tag + 'the card shows its quotation mark only', count(h, 'class="tst-card"') === 1 && count(h, 'class="tst-quotemark"') === 1 && h.indexOf('class="tst-quote"') === -1);
    check(tag + 'no voice photo and no attribution', h.indexOf('class="tst-photo"') === -1 && h.indexOf('class="tst-attr') === -1 && h.indexOf('class="tst-plate"') === -1);
    check(tag + 'no person named or pictured', ['Asha Rao', DEVANAGARI, 'Someone Else', 'Somewhere', 'speaker-1.jpg', 'speaker-2.jpg'].every(function (s) { return h.indexOf(s) === -1; }));
    check(tag + 'no invented words', h.indexOf('unmissable') === -1 && h.indexOf('sharpest minds') === -1);
    check(tag + 'the caption is empty', r.caption === '', r.caption);
  });
});
(function () {
  var r = render('generic.testimonial', 'ig_portrait', RICH, { quote: QUOTE });
  check('with a quote: the quote, escaped', count(r.html, '<div class="tst-quote">' + esc(QUOTE) + '</div>') === 1);
  check('with a quote: the first speaker\'s photo with the name plate', r.html.indexOf('<img src="https://img.etb2bimg.com/files/cp/speaker-1.jpg" alt="">') !== -1 &&
    r.html.indexOf('<div class="tst-plate"><div class="tst-attr-name">Asha Rao</div><div class="tst-attr-title">Chief Executive Officer, City Hospital</div></div>') !== -1);
  check('with a quote: the platform\'s caption formula', r.caption === '"' + QUOTE + '" — Asha Rao, Chief Executive Officer, City Hospital #AgenticAiSummit26', r.caption);
  var noPhoto = render('generic.testimonial', 'landscape', RICH, { quote: '  ' + QUOTE + '  ', speakerId: 's5' });
  check('with a quote and a speaker with no photo: the attribution sits under the card', noPhoto.html.indexOf('<div class="tst-attr"><div class="tst-attr-name">Kavya Iyer</div>') !== -1 &&
    noPhoto.html.indexOf('class="tst-photo"') === -1);
  check('the quote is trimmed, as the platform trims it', noPhoto.caption === '"' + QUOTE + '" — Kavya Iyer, VP Engineering, Tarqen Systems #AgenticAiSummit26', noPhoto.caption);
  var sparse = render('generic.testimonial', 'story', SPARSE, { quote: QUOTE });
  check('with a quote on an event with no speakers: the quote alone', sparse.html.indexOf('class="tst-attr') === -1 && sparse.html.indexOf('class="tst-photo"') === -1 &&
    sparse.caption === '"' + QUOTE + '" ', sparse.caption);
})();

/* ---- A.8 every other caption is the platform's formula (map-render §7), untrimmed ---- */
var CAPTIONS = {
  'generic.announcement': 'Save the date! ET Agentic AI Summit 2026 — Where enterprise AI gets real.. 20-21 November, 2026 · Taj Lands End. #AgenticAiSummit26',
  'generic.who-should-attend': 'Is ET Agentic AI Summit 2026 for you? CIOs and CTOs, Heads of AI, Chief Data Officers, Enterprise architects and more should attend. #AgenticAiSummit26',
  'generic.summit-highlights': 'ET Agentic AI Summit 2026 by the numbers — 80+ Speakers, 1,500+ Attendees, 40 Sessions, 25 Partners and more. #AgenticAiSummit26',
  'generic.prediction-outcome': 'From last year\'s signals to this year\'s action — see what\'s next at ET Agentic AI Summit 2026. #AgenticAiSummit26',
  'partner.tier-ladder': 'Proud to be powered by our partners at ET Agentic AI Summit 2026 — Presenting Partner, Gold Partners, Associate Partners and more. #AgenticAiSummit26',
  'partner.presenting-spotlight': 'We\'re delighted to welcome Northwind Analytics as Presenting Partner at ET Agentic AI Summit 2026. #AgenticAiSummit26',
  'speaker.individual': 'Meet Asha Rao, Chief Executive Officer at City Hospital, joining us at ET Agentic AI Summit 2026. 20-21 November, 2026 · Taj Lands End. #AgenticAiSummit26',
  'speaker.combined': 'Presenting 8 speakers at ET Agentic AI Summit 2026 — Asha Rao, ' + DEVANAGARI + ', Rohan Mehta, ' + ODD + ', Kavya Iyer and more. #AgenticAiSummit26'
};
Object.keys(CAPTIONS).forEach(function (id) {
  FMTS.forEach(function (f) {
    var got = render(id, f, RICH, {}).caption;
    check(id + ' ' + f + ': caption formula', got === CAPTIONS[id], got);
  });
});
check('the Announcement caption keeps the platform\'s ".." after a tagline that ends in a full stop', CAPTIONS['generic.announcement'].indexOf('real.. ') !== -1);
check('an event with no hashtag keeps the trailing space (captions are not trimmed)',
  render('generic.announcement', 'ig_square', SPARSE, {}).caption === 'Save the date! ET HR Leaders Meet. 5 December, 2026. ', render('generic.announcement', 'ig_square', SPARSE, {}).caption);
check('picked options shape the captions as on the platform', render('speaker.combined', 'ig_square', RICH, PICKS['speaker.combined']).caption ===
  'Presenting 3 speakers at ET Agentic AI Summit 2026 — ' + DEVANAGARI + ', ' + ODD + ', Asha Rao. #AgenticAiSummit26' &&
  render('partner.presenting-spotlight', 'ig_square', RICH, PICKS['partner.presenting-spotlight']).caption ===
  'We\'re delighted to welcome Helio Cloud as Gold Partners at ET Agentic AI Summit 2026. #AgenticAiSummit26');

/* ---- A.2 / A.3 the catalog (async: buildCatalog keeps the platform's signature) ---- */
function entryOf(cat, id) { var e = null; cat.categories.forEach(function (c) { c.templates.forEach(function (t) { if (t.id === id) e = t; }); }); return e; }
function paramOf(entry, key) { return entry && entry.params.filter(function (p) { return p.key === key; })[0]; }
function labels(p) { return p && p.options ? p.options.map(function (o) { return o.label; }) : null; }
Promise.all([engine.buildCatalog(clone(RICH)), engine.buildCatalog(clone(SPARSE)), engine.buildCatalog()]).then(function (r) {
  var rich = r[0], sparse = r[1], raw = r[2];
  check('catalog: Generic, Partner, Speaker, in that order', JSON.stringify(rich.categories.map(function (c) { return [c.key, c.label]; })) ===
    JSON.stringify([['generic', 'Generic'], ['partner', 'Partner'], ['speaker', 'Speaker']]));
  check('catalog: 5 / 2 / 2 templates by category', JSON.stringify(rich.categories.map(function (c) { return c.templates.length; })) === '[5,2,2]');
  check('catalog: the templates in the platform\'s order', JSON.stringify([].concat.apply([], rich.categories.map(function (c) { return c.templates.map(function (t) { return t.id; }); }))) === JSON.stringify(IDS));
  check('catalog: no PSD frame', [rich, sparse, raw].every(function (cat) { return cat.categories.every(function (c) { return c.templates.every(function (t) { return t.kind === 'code' && t.subtype !== 'psd' && t.isNew === false; }); }); }));
  check('catalog: each entry has the 4 formats with their labels and ratios', rich.categories.every(function (c) { return c.templates.every(function (t) {
    return JSON.stringify(t.formats) === JSON.stringify(FMTS.map(function (f) { return { id: f, label: engine.FORMATS[f].label, ratio: RATIO[f] }; }));
  }); }));
  check('catalog: Theme leads every template\'s options', rich.categories.every(function (c) { return c.templates.every(function (t) { return t.params[0].key === 'theme' && t.params[0].default === 'dark'; }); }));
  check('catalog: every template is available on the rich event', rich.categories.every(function (c) { return c.templates.every(function (t) { return t.available && t.missing.length === 0; }); }));
  var spk = paramOf(entryOf(rich, 'speaker.individual'), 'speakerId');
  check('catalog: speakers listed "Name — Company"', JSON.stringify(labels(spk)) === JSON.stringify(RICH.speakers.map(function (s) { return s.name + ' — ' + s.company; })) &&
    spk.options[0].value === 's1', labels(spk));
  check('catalog: speaker groups listed once each', JSON.stringify(paramOf(entryOf(rich, 'speaker.combined'), 'group').options) ===
    JSON.stringify([{ value: 'Keynote Speakers', label: 'Keynote Speakers' }, { value: 'Speakers', label: 'Speakers' }]));
  check('catalog: partners listed "Title — Tier"', JSON.stringify(labels(paramOf(entryOf(rich, 'partner.tier-ladder'), 'sponsorIds'))) === JSON.stringify([
    'Northwind Analytics — Presenting Partner', 'Helio Cloud — Gold Partners', 'Tarqen Systems — Gold Partners',
    'Saffron Data — Associate Partners', 'Lumen AI — Associate Partners', 'Kestrel Labs — Associate Partners']));
  check('catalog: tiers listed "Tier (n)"', JSON.stringify(labels(paramOf(entryOf(rich, 'partner.presenting-spotlight'), 'tier'))) ===
    JSON.stringify(['Presenting Partner (1)', 'Gold Partners (2)', 'Associate Partners (3)']));
  check('catalog: the stats editor starts from the event\'s stats', JSON.stringify(paramOf(entryOf(rich, 'generic.announcement'), 'stats').default) === JSON.stringify(RICH.stats));
  check('catalog: the Testimonial\'s quote starts empty', paramOf(entryOf(rich, 'generic.testimonial'), 'quote').default === '');

  var want = {
    'generic.announcement': [], 'generic.who-should-attend': ['who_should_attend'], 'generic.summit-highlights': ['stats'],
    'generic.prediction-outcome': [], 'generic.testimonial': [], 'partner.tier-ladder': ['sponsors'], 'partner.presenting-spotlight': ['sponsors'],
    'speaker.individual': ['speakers'], 'speaker.combined': ['speakers (>=2)']
  };
  IDS.forEach(function (id) {
    var e = entryOf(sparse, id);
    check('sparse catalog: ' + id + ' ' + (want[id].length ? 'needs ' + want[id].join(', ') : 'is available'),
      e && e.available === !want[id].length && JSON.stringify(e.missing) === JSON.stringify(want[id]), e && [e.available, e.missing]);
  });
  check('sparse catalog: data-bound options are empty lists, not missing', JSON.stringify(paramOf(entryOf(sparse, 'speaker.individual'), 'speakerId').options) === '[]');
  check('raw catalog (no event): everything available, options unresolved', raw.categories.every(function (c) { return c.templates.every(function (t) { return t.available; }); }) &&
    paramOf(entryOf(raw, 'speaker.individual'), 'speakerId').options === undefined);
  /* the gates themselves (map-render §7) */
  var an = engine.getTemplate('generic.announcement');
  check('Announcement: a venue alone is enough', an.requires(Object.assign(clone(SPARSE), { dateLabel: undefined, venue: 'NSCI Dome' })).ok === true);
  check('Announcement: a city alone is not (as on the platform)', JSON.stringify(an.requires(Object.assign(clone(SPARSE), { dateLabel: undefined, city: 'Pune' }))) ===
    JSON.stringify({ ok: false, missing: ['event date/venue'] }));
  check('Combined: one speaker is not a set', engine.getTemplate('speaker.combined').requires(Object.assign(clone(SPARSE), { speakers: [RICH.speakers[0]] })).ok === false);
}).catch(function (err) {
  check('the catalog builds', false, String(err && err.stack || err));
}).then(function () {
  console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
