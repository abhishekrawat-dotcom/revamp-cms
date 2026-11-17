/* edition-brief.js: "Describe the event" from ETB2B's own records of the previous edition (owner, 17 Nov 2026).
   Run: node functions/lib/edition-brief.test.js */
var eb = require('./edition-brief');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else { failed++; console.log('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }
}

/* the fields as ETB2B's microsite/details sent them for Brand World Summit South 2026 (17 Nov 2026), shortened */
var DETAILS = {
  company_id: 4708, company_name: 'Brand World Summit South 2026', url_text: 'brand-world-summit-south',
  company_description: 'The Economic Times BrandEquity returns with the second edition of Brand World Summit South 2026. It brings brand leaders together.',
  synopsis: 'The Biggest Congregation of Marketers in South India',
  who_should_attend: '["CEOs, CMOs, CCOs, CIOs","Brand\\/Marketing Heads","Media Planners"]',
  why_join_us: '["Hear the brand leaders of the South","Meet &amp; network with 300+ marketers"]',
  key_discussion_points: '["31% of India’s GDP"]',
  total_registrations: 365, is_dark_light_theme: 'light', forced_theme: 'light',
  template_settings: '{"font_family":"Inter","primary_font_size":"52"}',
  faq: [{ q: 'x' }], about_us: { title: 'About ETBrandEquity.com' }
};
var L = eb.linesOf(DETAILS, { title: 'Brand World Summit South 2026', speakers: 28, action: 'Register Now' }, { kind: 'event', portal: 'brandequity', partners: 12 });
check('look: no theme, the type alone', eb.linesOf({ template_settings: '{"font_family":"Plus Jakarta Sans"}' }, {}, {}).look === 'Last edition: set in Plus Jakarta Sans');
check('why attend: a reason\'s own full stop is not doubled', eb.linesOf({ why_join_us: '["Learn from the best.","Meet CMOs."]' }, {}, {}).why === 'Learn from the best; Meet CMOs');
check('scale: thousands written the Indian way', eb.linesOf({ total_registrations: 2404 }, { speakers: 148 }, { partners: 32 }).scale === 'Last edition: about 2,404 registrations, 148 speakers, 32 partners');
check('tagline: the synopsis', L.tagline === 'The Biggest Congregation of Marketers in South India', L.tagline);
check('why attend: why_join_us, as plain text', L.why === 'Hear the brand leaders of the South; Meet & network with 300+ marketers', L.why);
check('audience: who_should_attend', L.audience === 'CEOs, CMOs, CCOs, CIOs, Brand/Marketing Heads, Media Planners', L.audience);
check('industry: the portal\'s', L.industry === 'Marketing, advertising and media');
check('level: "South" in the name is regional', L.level === 'regional');
check('main action: Register Now is register', L.action === 'register');
check('scale: said as last edition\'s', L.scale === 'Last edition: about 365 registrations, 28 speakers, 12 partners', L.scale);
check('look: the site\'s theme and type', L.look === 'Last edition: a light site, set in Inter', L.look);
check('no bare "ET" in any line it writes itself', ['industry', 'level', 'action', 'scale', 'look'].every(function (k) { return !/\bET\b/.test(L[k]); }));

var A = eb.linesOf({ company_name: 'ETHRWorld Future Skills Awards 2026' }, { title: 'x' }, { kind: 'award', portal: 'hr', partners: 0 });
check('an award\'s main action is nominate', A.action === 'nominate');
check('nothing known stays empty: tagline, why, audience, level, scale, look', !A.tagline && !A.why && !A.audience && !A.level && !A.scale && !A.look, A);
var T = eb.linesOf({ company_name: 'CX Annual Symposium 2026', company_description: 'Customers today do not experience an organisation in departments. They experience the product.', key_discussion_points: '["The AI agent at the counter"]' }, { action: 'Request an Invite' }, { kind: 'event', portal: 'zzz' });
check('no synopsis: the description\'s first sentence', T.tagline === 'Customers today do not experience an organisation in departments.', T.tagline);
check('no reasons: the discussion points', T.why === 'The AI agent at the counter');
check('Request an Invite', T.action === 'request an invite');
check('a portal with no industry on file: empty', T.industry === '');
check('a list that is not JSON is one item; a bad one nothing', eb.listOf('Just one line').join() === 'Just one line' && eb.listOf(null).length === 0 && eb.listOf('[]').length === 0);
check('Brand World Summit is not "global"', eb.linesOf({ company_name: 'Brand World Summit 2025' }, {}, {}).level === '');

/* the read: ETB2B's record and its partner list, never anything else */
var asked = [];
function fake(map) {
  return function (url, headers) { asked.push({ url: url, portal: headers && headers.portal }); for (var k in map) if (url.indexOf(k) !== -1) return Promise.resolve(map[k]); return Promise.resolve(null); };
}
eb.readEditionBrief('brandequity', '4708', 'event', fake({
  '/v1/microsite/details?digital_month_id=4708': { status: true, data: DETAILS },
  '/v1/activity/sponsor/list?entity_id=4708': { status: true, data: { items: [{ status: 1 }, { status: 1 }, { status: 0 }], is_last_page: true } }
}), { speakers: 28, action: 'Register Now' }).then(function (lines) {
  check('read: the lines, partners counted (a hidden one left out)', lines && lines.scale === 'Last edition: about 365 registrations, 28 speakers, 2 partners', lines);
  check('read: only ETB2B\'s API, with the portal as its header', asked.every(function (a) { return a.url.indexOf('https://api.economictimes.indiatimes.com/v1/') === 0 && a.portal === 'brandequity'; }), asked);
  return eb.readEditionBrief('brandequity', '1', 'event', fake({}), {});
}).then(function (none) {
  check('read: no record is null (the route says it could not be read)', none === null);
  return eb.readEditionBrief('brandequity', '2', 'event', function () { return Promise.reject(new Error('down')); }, {});
}).then(function (down) {
  check('read: ETB2B down is null, never a throw', down === null);
}).then(function () {
  console.log(failed ? 'edition-brief: ' + failed + ' of ' + (passed + failed) + ' checks FAILED' : 'edition-brief: all ' + passed + ' checks passed');
  process.exit(failed ? 1 : 0);
}, function (e) { console.log('FAIL crashed ' + (e && e.stack)); process.exit(1); });
