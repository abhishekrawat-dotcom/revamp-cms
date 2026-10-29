// node functions/lib/promo-engine-banner.test.js — the mail banner slot (owner C) in the vendored engine
// (promo-engine/src/mailers, built into vendor/promo-engine.js): EventEntity.bannerUrl, the event's composed mail
// banner, becomes the default picture of every mailer's top banner, and with no bannerUrl all 18 mailers are the
// e04fa17 engine's, byte for byte. No network, no Firebase: the engine is pure.
//
// The pinned hashes were recorded from the e04fa17 engine before any mailer file was changed:
//   node functions/lib/promo-engine-banner.test.js --record <path to e04fa17's vendor/promo-engine.js>
// prints them (that mode runs no check). Record again only when a mailer is changed on purpose, and say why.
var crypto = require('crypto'), path = require('path');

/* the test owns its environment: dates read in UTC, mastheads from one fixed address, and "now" pinned, because the
   Reminder counts days to go and is greyed out once its event is past */
process.env.TZ = 'UTC';
process.env.MAILER_ASSET_BASE = 'https://assets.oneworld.example';
var NOW = Date.UTC(2026, 9, 1, 6, 0, 0);
Date.now = function () { return NOW; };

var RECORD = process.argv[2] === '--record' ? path.resolve(process.argv[3] || '') : '';
var engine = require(RECORD || './vendor/promo-engine');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function sha(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'); }

/* ---- fixtures, in the shape lib/promo-mailer.js entityOf hands the engine (string ids, site order) ---- */
var HERO = 'https://img.etb2bimg.com/files/cp/agentic-hero-1600x700.jpg';
var MARK = 'https://img.etb2bimg.com/files/cp/agentic-mark-512.png';
var BANNER = 'https://storage.googleapis.com/revamp-test.appspot.com/events/qa-rich/promo-banner/0123456789abcdef-mh3k2x-a1b2c3d4e5f60718.jpg';
function speaker(i, name, designation, company, group, photo) {
  return { id: 's' + i, name: name, designation: designation, company: company,
    photoUrl: photo === false ? undefined : 'https://img.etb2bimg.com/files/cp/speaker-' + i + '.jpg', group: group, weightage: i };
}
var SPEAKERS = [
  speaker(1, 'Asha Rao', 'Chief Executive Officer', 'City Hospital', 'Keynote Speakers'),
  speaker(2, 'अनन्या शर्मा', 'मुख्य तकनीकी अधिकारी', 'भारत डिजिटल', 'Keynote Speakers'),
  speaker(3, 'Rohan Mehta', 'Chief Information Officer', 'Northwind Retail', 'Keynote Speakers'),
  speaker(4, 'O\'Brien "QA" <b>', 'Head of <i>Testing</i> & QA', 'Quote "Co"', 'Speakers'),
  speaker(5, 'Kavya Iyer', 'VP Engineering', 'Tarqen Systems', 'Speakers', false),
  speaker(6, 'Vikram Singh', 'Director, Data', 'Helio Bank', 'Speakers'),
  speaker(7, 'Meera Kulkarni', 'Head of AI', 'Lumen Insurance', 'Speakers'),
  speaker(8, 'Arjun Nair', 'CTO', 'Saffron Logistics', 'Speakers')
];
function sponsor(i, title, tier, logo) {
  return { id: 'p' + i, title: title, logoUrl: logo === false ? undefined : 'https://img.etb2bimg.com/files/cp/partner-' + i + '.png',
    tier: tier, url: 'https://partner' + i + '.example.com', weightage: i };
}
var RICH = {
  portal: 'cio', entityId: 0, oneworldId: 'qa-rich',
  name: 'ET Agentic AI Summit 2026', edition: 9, tagline: 'Where enterprise AI gets real.',
  description: 'The ninth edition brings together the CIOs and CTOs turning agentic AI into working systems. Two days of keynotes, case studies and closed-door roundtables.',
  hashtag: '#AgenticAiSummit26',
  startDate: '2026-11-20', endDate: '2026-11-21', dateLabel: '20-21 November, 2026', totalDays: 2,
  venue: 'Taj Lands End', city: 'Mumbai',
  ctaLabel: 'Register Now', ctaUrl: 'https://agentic.example.com/register',
  logoUrl: MARK, keyVisualUrl: HERO, keyVisualMode: 'hero', micrositeUrl: 'https://agentic.example.com',
  siteAccent: '#e4002b', siteTheme: 'dark',
  whoShouldAttend: ['CIOs and CTOs', 'Heads of AI', 'Chief Data Officers', 'Enterprise architects', 'Founders <b>x</b>', 'Digital transformation leads'],
  keyPoints: ['Agents in production', 'Governance that ships', 'The data foundation', 'Cost of inference', 'Talent and teams'],
  whyJoin: ['Meet 80+ speakers', 'Closed-door roundtables', 'Live demos', 'Peer networking'],
  stats: [{ label: 'Speakers', value: '80+' }, { label: 'Attendees', value: '1,500+' }, { label: 'Sessions', value: '40' }, { label: 'Partners', value: '25' }],
  speakers: SPEAKERS,
  sponsorTiers: [
    { tier: 'Presenting Partner', sponsors: [sponsor(1, 'Northwind Analytics', 'Presenting Partner')] },
    { tier: 'Gold Partners', sponsors: [sponsor(2, 'Helio Cloud', 'Gold Partners'), sponsor(3, 'Tarqen Systems', 'Gold Partners', false)] },
    { tier: 'Associate Partners', sponsors: [sponsor(4, 'Saffron Data', 'Associate Partners'), sponsor(5, 'Lumen AI', 'Associate Partners'), sponsor(6, 'Kestrel Labs', 'Associate Partners')] }
  ],
  sessions: [
    { id: 'x1', title: 'Keynote: agents at work', start: '2026-11-20T10:00:00', end: '2026-11-20T10:45:00', speakers: [SPEAKERS[0], SPEAKERS[1]] },
    { id: 'x2', title: 'Panel: governance that ships', start: '2026-11-20T11:00:00', end: '2026-11-20T11:45:00', speakers: [SPEAKERS[3]] },
    { id: 'x3', title: 'Case study: inference costs', start: '2026-11-21T10:00:00', end: '2026-11-21T10:30:00', speakers: [SPEAKERS[5]] },
    { id: 'x4', title: 'Roundtable: talent', start: '2026-11-21T12:00:00', speakers: [] }
  ],
  award: undefined
};
var SPARSE = {
  portal: 'hr', entityId: 0, oneworldId: 'qa-sparse',
  name: 'ET HR Leaders Meet', hashtag: '',
  startDate: '2026-12-05', dateLabel: '5 December, 2026',
  ctaLabel: 'Register Now', keyVisualMode: 'hero', siteTheme: 'light',
  whoShouldAttend: [], keyPoints: [], whyJoin: [], stats: [], speakers: [], sponsorTiers: [], sessions: []
};
/* an award event (the rich one with a nomination window and a ceremony), so the five award mailers are real */
var AWARD = Object.assign(clone(RICH), {
  oneworldId: 'qa-award', name: 'ET CIO Awards 2026', ctaLabel: 'Nominate Now',
  award: { awardId: 0, phase: 'live', awardUrl: 'https://awards.example.com', ceremonyDate: '2026-12-10', ceremonyDateLabel: '10 December, 2026',
    nominationsOpen: true, nominationsOpenDate: '2026-09-01', nominationsCloseDate: '2026-11-15', nominationsCloseLabel: '15 November, 2026',
    nominateUrl: 'https://awards.example.com/nominate', winnersUrl: 'https://awards.example.com/winners', editions: 5, winners: 120, categories: 30 }
});
var FIXTURES = { rich: RICH, sparse: SPARSE, award: AWARD };

/* every mailer, built with its own defaults and rendered as it is sent (no editor hooks) */
function renderedAll(ev) {
  var out = {};
  engine.ALL_MAILERS.forEach(function (m) {
    var html;
    try { html = engine.renderDoc(engine.buildDoc(m, clone(ev)), clone(ev)); } catch (err) { html = 'THROWS ' + (err && err.message); }
    out[m.id] = html;
  });
  return out;
}
function hashesOf(fixtures) {
  var out = {};
  Object.keys(fixtures).forEach(function (k) {
    var r = renderedAll(fixtures[k]);
    Object.keys(r).forEach(function (id) { out[k + ':' + id] = sha(r[id]); });
  });
  return out;
}

if (RECORD) {
  console.log(JSON.stringify(hashesOf(FIXTURES), null, 2));
  process.exit(0);
}

/* recorded from the e04fa17 engine (sha256 of the vendor file 5874746032a7…), before any mailer file changed */
var BASE_HASHES = {
  'rich:mailer.announcement': '60a1c7d65659aac47cf27bfda849a2bd874891e9488861da834e48c56e6d7ea4',
  'rich:mailer.discussion': '24e2b416ebcc5e381463159a26dd9377d408910faf3a365b0352bb2027ab66c6',
  'rich:mailer.speakers': 'ee390f70a6480b8f675b74842abb1d61b5312b8ca4b21bb9f5835868295eb072',
  'rich:mailer.speaker-spotlight': 'de0e42ba9eafffc5203c7eaff14c8d22159be4451426aef5ff7597a736f11f43',
  'rich:mailer.partners': 'a961506a9c654fd3121fb2d724881d72dbdcd7de34654dc748e9b48e2b50f47f',
  'rich:mailer.partner-spotlight': '9353b90e6c299fa7eb5edf88f44469a4a6d8742bdda8b3212d45c9bc0461b586',
  'rich:mailer.agenda': '46928550b3779f5cf505932a5efade55916a793017140e25005f19d7954c9456',
  'rich:mailer.reminder': '571f20b09bc8268376925ca7a9eb1f43ed602916bdaaa3425f4e497747b7f078',
  'rich:mailer.resilience': '3a18e296459b64deb10ffd28c8fd555f6386252720b14c168ceb7fe4b5d90d91',
  'rich:mailer.decrypt': '9b615f4243a1684978d25be24c53ef52e5df330d5582685c5522c41be0652d14',
  'rich:mailer.award-nominations': '60405ebe1b187072c0b94fc1e27b9f782136ecd4b13a7ae7d0ed78a39fd9102a',
  'rich:mailer.award-deadline': 'aeb0a3bdbd616b3fab4113f20ff9901c7444a112e661c66842958ba90892cba2',
  'rich:mailer.award-jury': '912dbf82751af11be84775600b29267e3edfa6306367a8cc368d9a380235351d',
  'rich:mailer.award-ceremony': '8a930c33bc11a206055d940a5e83107e1ab1b0eadba50057a9507c7afffe0be0',
  'rich:mailer.award-winners': 'c4b854e5927dbe0dc7489928dbd210f370ac31dd3fa703626b2ee0924670d711',
  'rich:mailer.conference': 'c31ca7aaed1e5cb250d578ae74dc2d7ce4bf12a429e68f2ab4c65d680920d8f8',
  'rich:mailer.all-in-one': 'ca51dff10c309166f8da6f5d81c9e6da6c6bbf6145e08cea2f3f72d853e9485c',
  'rich:mailer.blank': '83004d2333fdc72da7cec9247fb62b598c83a04492e3214112250563c418369f',
  'sparse:mailer.announcement': '1585b5830328299e29a2f590359736bd71d66e6c38778d01dfb80ef0cb36ecb7',
  'sparse:mailer.discussion': '37ab6fdef0d5b3019eb754a4ffdae63e63fb48961c27f611f5b1eb0f3627e253',
  'sparse:mailer.speakers': 'b16b9dbaf32ee3e570031f9486ee57c4201abe908c75ffd9c037ba151c31e805',
  'sparse:mailer.speaker-spotlight': '0cac59b933a3cc91e549806cac6e5e2cdb7b689f21521cbc266039e74bc80055',
  'sparse:mailer.partners': 'fafbc8efeb8585192e5bed1d8638f68926453bd268121c278cab3df50c66cea0',
  'sparse:mailer.partner-spotlight': '72ace6f2d43add5892b348ddb8875e0d2acb48f605532a1dfeebf8314fea1fc5',
  'sparse:mailer.agenda': '536198b38199827fd2308af247b3afdc48193b7fe657a0bd26f74fe6bd19b90d',
  'sparse:mailer.reminder': '53b83413faac9946ca2791a51cbf4d176235fb0bab74873c0630330e870df865',
  'sparse:mailer.resilience': '107bb1e46824c8b8b497ecf6f8782b70dbec60049010b4007024f4548c737302',
  'sparse:mailer.decrypt': '99b6b25af2c03078a73807d2caceadada4493e32be4f95c2a701a88cc3592a8b',
  'sparse:mailer.award-nominations': '40751dd5ff8869b045dce7726763b9c7f04ede9b16ac05a47ed802b2f93ec743',
  'sparse:mailer.award-deadline': 'd3da0b9d4b57741212d0d568e0cc6430ac8dc21d1afdfc243d6a46cd8ce9af4a',
  'sparse:mailer.award-jury': 'bc11f6e1269a813f869b822e2069584fbbb3f102c2893a67a155df341db66bcd',
  'sparse:mailer.award-ceremony': '9bd11c390fb9eed4d438fe8c6062c2601aefe5973f7da1e08dc6bd02bb290f1f',
  'sparse:mailer.award-winners': '742d8a9a87bfa7bcc721023d32c92fc0c9e1da55884a320a40ce464bd5dfbc2d',
  'sparse:mailer.conference': 'f078b7929bdf184402d8dfc74ff6da5327a671e1b61505530dab657925c8a8e9',
  'sparse:mailer.all-in-one': '6e250ce316e791321566e4b40a8534d1a61b198722a557250a7eca31588df4e6',
  'sparse:mailer.blank': 'f5fe9524c8f20bef2a7db9fdcf707363c1fb80a3c644c2e1070ac38e816413ba',
  'award:mailer.announcement': '76a557e9a6a02387e91bbb8349c9d19556e6784332573b3cdf894aea7dbe9035',
  'award:mailer.discussion': '479d5539605155580c9077157bb713dc9a13a21575c9dbaa1cc5c59530297e12',
  'award:mailer.speakers': 'e0fd9bc2f8fe8e272d0600471be3a2b153b007c7bd0961d4c629be3b883771f1',
  'award:mailer.speaker-spotlight': 'f6aafb4af74e6201c3f0a28ddd9a6a9aa70a2d676b954dd6376fd3ca695d6b18',
  'award:mailer.partners': 'b3fb6828b8a5cf26f7d71f8d004814fc6719775bd2ef11a51881de44e061ba47',
  'award:mailer.partner-spotlight': '96200a66f8ff604361ce91f42f5cce749b8e662e1fbdaa03763de8b29e5caa90',
  'award:mailer.agenda': '91f15e45cc810aaf74c0cd28a07bb793f52cb41df12ac75583b2968a772a7a65',
  'award:mailer.reminder': 'f2d7c0429087533a613c4a3e1c5bbceb39c8d72134a897079e14c5ec003ba077',
  'award:mailer.resilience': 'bcd662e8f44352411cb0bc7dd242cdec7f18631a6c02cb1d77205c4e70383dbc',
  'award:mailer.decrypt': 'c5cb8581d6b5c079571ee38a1212fe03d38d404763bdc96e6d9209b75316fd46',
  'award:mailer.award-nominations': 'f57096a62b944aa68d58538ee35a153e124763d4da7b66c10ce3227539215cb2',
  'award:mailer.award-deadline': '6eacbc83605fe9cd72b9a0742c599aa054d4161332b9f7c60606ecd17194e042',
  'award:mailer.award-jury': 'aa58dfabbe74f7b507cabe16a46e5a3e4177b9939ad1ae0bf44b7effb3e21251',
  'award:mailer.award-ceremony': 'e2ea340d7e786da2aa8103722c3f585d863139efd8f6954cec0ac8d89e089cb0',
  'award:mailer.award-winners': '18fb70419d1e95a085f14cee4ba039a6e7412c33a72acff6a259e7e1ec895fd5',
  'award:mailer.conference': 'f864e35eef043d9ff46fed0626a1a904d2b8f15500d8aa151c40ee3cf1148a09',
  'award:mailer.all-in-one': '514a4bfe078b65499f9bbaec28bc43ba88b614ff08e2d2748c2f747d34ff3a47',
  'award:mailer.blank': '5d4f2aa61c8e4d169c4076ad3c244937e12d9c62e0724a3fd2e066dcff36ccf2'
};

/* ---- A.10 with no bannerUrl, all 18 mailers are the e04fa17 engine's, byte for byte ---- */
check('the engine still has 18 mailers', engine.ALL_MAILERS.length === 18, engine.ALL_MAILERS.length);
var now = hashesOf(FIXTURES);
check('the pinned hashes cover 18 mailers × 3 fixtures', Object.keys(BASE_HASHES).length === 54, Object.keys(BASE_HASHES).length);
Object.keys(BASE_HASHES).forEach(function (k) {
  check('no bannerUrl: ' + k + ' renders as the e04fa17 engine did', now[k] === BASE_HASHES[k]);
});

/* ---- helpers over built docs ---- */
function withBanner(ev) { var e = clone(ev); e.bannerUrl = BANNER; return e; }
function docOf(id, ev, params) { return engine.buildDoc(engine.getMailer(id), clone(ev), params || {}); }
function typesOf(doc) { return doc.blocks.map(function (b) { return b.type; }); }
function bannersOf(doc) { return doc.blocks.filter(function (b) { return b.type === 'banner'; }); }
/* blocks without their ids (a fresh id per build), so two builds compare by what they show */
function shape(blocks) { return JSON.stringify(blocks.map(function (b) { return { type: b.type, props: b.props }; })); }
function without(blocks, fn) { return blocks.filter(function (b) { return !fn(b); }); }
function count(s, sub) { return s.split(sub).length - 1; }
var isBanner = function (b) { return b.type === 'banner'; };
var CUSTOM = 'https://img.etb2bimg.com/files/cp/the-owners-own-banner.jpg';
var SLOT_MAILERS = ['mailer.announcement', 'mailer.discussion', 'mailer.speakers', 'mailer.partners', 'mailer.agenda',
  'mailer.all-in-one', 'mailer.resilience', 'mailer.decrypt', 'mailer.conference'];
var BAND_MAILERS = ['mailer.speaker-spotlight', 'mailer.partner-spotlight', 'mailer.reminder'];
var AWARD_MAILERS = ['mailer.award-nominations', 'mailer.award-deadline', 'mailer.award-jury', 'mailer.award-ceremony', 'mailer.award-winners'];
check('the three lists name 17 mailers, all real, and Blank is the 18th',
  SLOT_MAILERS.concat(BAND_MAILERS, AWARD_MAILERS).filter(function (id) { return engine.getMailer(id); }).length === 17 && !!engine.getMailer('mailer.blank'));

/* ---- A.10 with bannerUrl: the nine mailers that already open on the event's picture take the composed banner ---- */
['rich', 'award'].forEach(function (k) {
  var ev = FIXTURES[k], evB = withBanner(ev);
  SLOT_MAILERS.forEach(function (id) {
    var plain = docOf(id, ev), banner = docOf(id, evB), bs = bannersOf(banner);
    check(k + ' ' + id + ': one banner block, holding bannerUrl', bs.length === 1 && bs[0].props.url === BANNER, bs.map(function (b) { return b.props.url; }));
    check(k + ' ' + id + ': not the bare key visual', bs.every(function (b) { return b.props.url !== HERO; }));
    check(k + ' ' + id + ': the banner keeps its link and alt text', bs.length === 1 && bs[0].props.alt === ev.name &&
      bs[0].props.href === bannersOf(plain)[0].props.href, bs[0] && bs[0].props);
    /* nothing else in the mail moves: the same blocks, with only the banner's picture swapped */
    var swapped = plain.blocks.map(function (b) { return b.type === 'banner' ? { type: b.type, props: Object.assign({}, b.props, { url: BANNER }) } : b; });
    check(k + ' ' + id + ': only the banner\'s picture changed', shape(banner.blocks) === shape(swapped));
    var html = engine.renderDoc(banner, evB);
    check(k + ' ' + id + ': the sent mail shows the composed banner', html.indexOf('src="' + BANNER + '"') !== -1);
  });
});

/* every mailer but Blank leads with it (O3 = b), once, near the top; Blank is untouched */
['rich', 'award'].forEach(function (k) {
  var evB = withBanner(FIXTURES[k]);
  engine.ALL_MAILERS.forEach(function (m) {
    var doc = docOf(m.id, evB), at = typesOf(doc).indexOf('banner');
    if (m.id === 'mailer.blank') {
      check(k + ' Blank: no banner, and the mail is as it was', at === -1 &&
        sha(engine.renderDoc(doc, evB)) === BASE_HASHES[k + ':mailer.blank']);
      return;
    }
    check(k + ' ' + m.id + ': leads with the composed banner (within the first three blocks)', at !== -1 && at <= 2, typesOf(doc));
    check(k + ' ' + m.id + ': the composed banner appears once in the whole mail', count(JSON.stringify(doc.blocks), BANNER) === 1);
  });
});

/* ---- A.11 the owner can still replace it or drop it ---- */
['mailer.announcement', 'mailer.resilience', 'mailer.decrypt'].forEach(function (id) {
  var custom = bannersOf(docOf(id, withBanner(RICH), { bannerUrl: CUSTOM }));
  check(id + ': a "Custom banner URL" still wins over bannerUrl', custom.length === 1 && custom[0].props.url === CUSTOM, custom.length && custom[0].props.url);
  var none = docOf(id, withBanner(RICH), { banner: 'none' });
  check(id + ': "No banner" still drops it', bannersOf(none).length === 0 && JSON.stringify(none.blocks).indexOf(BANNER) === -1);
});
check('Announcement with "No banner" falls back to the colour band, as the platform does', typesOf(docOf('mailer.announcement', withBanner(RICH), { banner: 'none' }))[1] === 'hero');
BAND_MAILERS.concat(AWARD_MAILERS).forEach(function (id) {
  var ev = id.indexOf('award') !== -1 ? AWARD : RICH;
  var custom = bannersOf(docOf(id, withBanner(ev), { bannerUrl: CUSTOM }));
  check(id + ': a custom banner URL wins here too', custom.length === 1 && custom[0].props.url === CUSTOM);
  var none = docOf(id, withBanner(ev), { banner: 'none' });
  check(id + ': "No banner" gives the platform\'s mail back', shape(none.blocks) === shape(docOf(id, ev, { banner: 'none' }).blocks) &&
    bannersOf(none).length === 0);
});
check('a Banner block added in the studio starts on bannerUrl', engine.makeBlock('banner', withBanner(RICH)).props.url === BANNER);
check('… on the key visual when there is no composed banner, as before', engine.makeBlock('banner', RICH).props.url === HERO);
check('… and empty when the event has neither', engine.makeBlock('banner', SPARSE).props.url === '');
var replaced = docOf('mailer.announcement', withBanner(RICH));
replaced.blocks.forEach(function (b) { if (b.type === 'banner') b.props.url = CUSTOM; });
var replacedHtml = engine.renderDoc(replaced, withBanner(RICH));
check('a banner picture the owner replaced in the studio is the one that is sent', replacedHtml.indexOf('src="' + CUSTOM + '"') !== -1 && replacedHtml.indexOf(BANNER) === -1);

/* ---- A.12 O3 = b: the mailers that open with a colour band or the award's mark ---- */
['mailer.speaker-spotlight', 'mailer.partner-spotlight'].forEach(function (id) {
  var plain = docOf(id, RICH), banner = docOf(id, withBanner(RICH));
  check(id + ': without a composed banner it opens on the colour band', typesOf(plain).slice(0, 2).join() === 'logobar,hero');
  check(id + ': with one, it leads with the banner instead of the band', typesOf(banner).slice(0, 2).join() === 'logobar,banner' &&
    typesOf(banner).indexOf('hero') === -1 && bannersOf(banner)[0].props.url === BANNER, typesOf(banner));
  check(id + ': and the rest of the mail is unchanged', shape(without(banner.blocks, isBanner)) ===
    shape(without(plain.blocks, function (b) { return b.type === 'hero'; })));
});
(function () {
  var plain = docOf('mailer.reminder', RICH), banner = docOf('mailer.reminder', withBanner(RICH));
  check('Reminder: the banner sits right under the logo bar, above the countdown band', typesOf(banner).slice(0, 3).join() === 'logobar,banner,hero', typesOf(banner));
  check('Reminder: the countdown band and everything else stay', shape(without(banner.blocks, isBanner)) === shape(plain.blocks));
})();
AWARD_MAILERS.forEach(function (id) {
  var plain = docOf(id, AWARD), banner = docOf(id, withBanner(AWARD));
  var isMark = function (b) { return b.type === 'image' && b.props.url === MARK; };
  check(id + ': without a composed banner it shows the square mark', plain.blocks.filter(isMark).length === 1 && typesOf(plain)[1] === 'image');
  check(id + ': with one, the banner takes the mark\'s place', typesOf(banner)[1] === 'banner' && banner.blocks.filter(isMark).length === 0, typesOf(banner));
  check(id + ': the band and its button stay', shape(without(banner.blocks, isBanner)) === shape(without(plain.blocks, isMark)) &&
    typesOf(banner).indexOf('button') !== -1);
});
check('the jury, ceremony and winners sends keep their colour band with its live button', ['mailer.award-nominations', 'mailer.award-jury', 'mailer.award-ceremony', 'mailer.award-winners'].every(function (id) {
  return typesOf(docOf(id, withBanner(AWARD))).indexOf('hero') !== -1;
}));
/* the square slots never take the wide banner */
(function () {
  var evB = withBanner(RICH);
  delete evB.logoUrl;
  var mark = engine.getMailer('mailer.award-nominations').params(evB).filter(function (p) { return p.key === 'mark'; })[0];
  check('the award mark still seeds from the logo or key visual, never bannerUrl', mark && mark.default === HERO, mark && mark.default);
  var band = engine.getMailer('mailer.decrypt').params(evB).filter(function (p) { return p.key === 'bandPhoto'; })[0];
  check('the decrypt band photo still seeds from the logo or key visual, never bannerUrl', band && band.default === HERO, band && band.default);
  var noMark = withBanner(AWARD);
  var hidden = docOf('mailer.award-jury', noMark, { banner: 'none' });
  check('with "No banner" the award mark comes back, as the platform draws it', hidden.blocks.some(function (b) { return b.type === 'image' && b.props.url === MARK; }));
})();

/* ---- the field itself ---- */
check('a sparse event with no picture and no composed banner opens on the band, as before', typesOf(docOf('mailer.announcement', SPARSE))[1] === 'hero');
check('bannerUrl is read, never written: building a mail leaves the event as it was', (function () {
  var evB = withBanner(RICH), before = JSON.stringify(evB);
  engine.ALL_MAILERS.forEach(function (m) { engine.buildDoc(m, evB, {}); });
  return JSON.stringify(evB) === before;
})());

console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
