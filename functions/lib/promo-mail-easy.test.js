// node functions/lib/promo-mail-easy.test.js — Promotions → Mailers made easy (batch B18, UX-123, and the Mailers parts
// of UX-128, UX-131 and UX-132; the agreed design is ~/.revamp-cms-qa/promo-easy-edit/DESIGN.md section 2 and 5).
// The engine's side: the block names, groups, hints and card words in plain words, and the picture handles of the
// studio's render. No network.
'use strict';
var path = require('path');
var engine = require('./vendor/promo-engine');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

/* ---- the block palette: plain names, one group each ---- */
var pal = engine.blockPalette();
var GROUPS = ['text', 'pictures', 'people', 'event', 'footer', 'more', 'advanced'];
check('every block is offered under one of the groups', pal.every(function (b) { return GROUPS.indexOf(b.group) !== -1; }),
  pal.filter(function (b) { return GROUPS.indexOf(b.group) === -1; }).map(function (b) { return b.type; }));
['text', 'pictures', 'people', 'event', 'footer', 'more'].forEach(function (g) {
  check('the "' + g + '" group has blocks', pal.some(function (b) { return b.group === g; }));
});
check('Custom HTML is the advanced one, and the only one', pal.filter(function (b) { return b.group === 'advanced'; }).map(function (b) { return b.type; }).join() === 'html');
var byType = {}; pal.forEach(function (b) { byType[b.type] = b; });
var NAMES = { banner: 'Banner picture', logobar: 'Logo at the top', hero: 'Title band', bullets: 'List of points', meta: 'Date and venue',
  stats: 'Headline numbers', speakers: 'Speakers', speaker: 'One speaker, large', sponsors: 'Partners', sessions: 'Agenda',
  lozenges: 'Big statement lines', pricing: 'Ticket prices', navbar: 'Row of links', mosaic: 'Photo collage', social: 'Social media links',
  quote: 'Quote', image: 'Picture', features: 'Points with icons', resources: 'Cards with links', circles: 'Points in circles',
  ribbon: 'Edition label', contacts: 'Contact people', divider: 'Line', spacer: 'Space' };
Object.keys(NAMES).forEach(function (t) { check(t + ' reads "' + NAMES[t] + '"', byType[t] && byType[t].label === NAMES[t], byType[t] && byType[t].label); });
var TRADE = /Hero band|Statement lines|Circle callouts|Edition flag|Nav bar|Stat tiles|Speaker grid|Partner logos|Inline image|Pull quote|Icon tiles|Resource cards|Contact rows|Photo mosaic|Social row|Price tiers/;
check('no trade name is left in the palette', !pal.some(function (b) { return TRADE.test(b.label); }));
/* every label, option and hint a sender reads */
var words = [];
pal.forEach(function (b) {
  words.push(b.label);
  (b.fields || []).forEach(function (f) {
    words.push(f.label, f.hint || '');
    (f.options || []).forEach(function (o) { words.push(o.label); });
    (f.itemFields || []).forEach(function (x) { words.push(x.label); });
  });
});
var JARGON = /\bAPIs?\b|endpoint|\bhex\b|\bAA\b|\bESP\b|MAILER_ASSET_BASE|markdown|\*\*bold\*\*|href=|\bURL\b|Eyebrow|reference mailers|house (mailers|default|icon)|masthead/i;
var jargon = words.filter(function (w) { return JARGON.test(w || ''); });
check('no developer word in any block name, field, option or hint', jargon.length === 0, jargon);
function opts(type, key) { var f = (byType[type].fields || []).filter(function (x) { return x.key === key; })[0]; return f ? f.options.map(function (o) { return o.label; }).join('/') : ''; }
check('a paragraph\'s colour is Body / Strong / Accent', opts('text', 'tone') === 'Body/Strong/Accent', opts('text', 'tone'));
check('a heading\'s colour is Body / Strong / Accent', opts('heading', 'tone') === 'Body/Strong/Accent', opts('heading', 'tone'));
var toneHints = ['text', 'heading'].map(function (t) { return (byType[t].fields.filter(function (x) { return x.key === 'tone'; })[0] || {}).hint; });
check('the colour choice carries no contrast talk (the check runs without a word)', toneHints.every(function (h) { return !h; }), toneHints);
check('the paragraph\'s words field has no formatting code hint', (byType.text.fields[0].hint || '').indexOf('**') === -1 && byType.text.fields[0].label === 'Words');
check('the tone values themselves are unchanged (saved mailers render as before)',
  byType.text.fields.filter(function (x) { return x.key === 'tone'; })[0].options.map(function (o) { return o.value; }).sort().join() === 'accent,body,ink' &&
  byType.heading.fields.filter(function (x) { return x.key === 'tone'; })[0].default === 'ink');

/* ---- the mailer cards: plain words, and what a mailer needs ---- */
var catalog = engine.buildMailerCatalog();
var CARD_JARGON = /\bsend\b|\bCTA\b|top-N|hard CTA|Urgency|line-up send/i;
var bad = catalog.mailers.filter(function (m) { return CARD_JARGON.test(m.description); }).map(function (m) { return m.id + ': ' + m.description; });
check('no card says "send", "CTA", "top-N" or "Urgency"', bad.length === 0, bad);
var bare = { name: 'QA Forum', speakers: [{ name: 'A' }], sponsorTiers: [], sessions: [], portal: 'cio', whoShouldAttend: [], keyPoints: [], whyAttend: [], stats: [] };
function needs(id) { try { return engine.getMailer(id).requires(bare).missing; } catch (e) { return ['threw: ' + e.message]; } }
check('the speaker mailer needs "at least 2 speakers" (not "speakers (2+)")', needs('mailer.speakers').join() === 'at least 2 speakers', needs('mailer.speakers'));
check('the partner mailer needs "partners" (not "sponsors")', needs('mailer.partners').join() === 'partners', needs('mailer.partners'));
/* the needs as written in the engine's code (a mailer that reads more of the event than this bare one has is read here too) */
var src = require('fs').readFileSync(path.join(__dirname, 'vendor', 'promo-engine.js'), 'utf8');
var miss = (src.match(/missing: [^\n]*?\[\s*"[^"]*"/g) || []).map(function (x) { return x.replace(/^[\s\S]*"([^"]*)"$/, '$1'); });
check('the needs are read from the engine', miss.length >= 8, miss);
check('no "need" is written with a slash or "(2+)"', !miss.some(function (x) { return /\(2\+\)| \/ /.test(x); }), miss);
check('every catalog block carries its group', catalog.blocks.every(function (b) { return GROUPS.indexOf(b.group) !== -1; }));

/* ---- the picture handles of the studio's render ---- */
var ev = { name: 'QA Forum', speakers: [], sponsorTiers: [], sessions: [], portal: 'cio' };
var doc = { subject: 's', theme: 'light', blocks: [
  { id: 'b1', type: 'banner', props: { url: 'https://img.etb2bimg.com/files/cp/a.jpg?x=1&y=2', href: 'https://x.example' } },
  { id: 'b2', type: 'speakers', props: { items: [{ name: 'Ananya Rao', photo: 'https://img.etb2bimg.com/files/sp/1.jpg' }, { name: 'Meera Iyer', photo: 'https://storage.googleapis.com/b/2.png' }, { name: 'No Photo' }] } },
  { id: 'b3', type: 'sponsors', props: { items: [{ title: 'Kaveri Digital', logo: 'https://storage.googleapis.com/b/l.png', url: 'https://kaveri.example' }] } },
  { id: 'b4', type: 'logobar', props: { logo: 'https://cdn.example/logo.png' } },
  { id: 'b5', type: 'heading', props: { text: 'Hello' } },
  { id: 'b6', type: 'image', props: { url: 'https://cdn.example/pic.jpg' } }
] };
var ed = engine.renderDoc(doc, ev, { editor: true });
var tags = (ed.match(/data-img="[^"]*"/g) || []).map(function (t) { return t.slice(10, -1); });
check('each picture names the prop it shows', JSON.stringify(tags) === JSON.stringify(['b1|url', 'b2|items.0.photo', 'b2|items.1.photo', 'b3|items.0.logo', 'b4|logo', 'b6|url']), tags);
check('an ET photo through the resizing service is still found (its file is the same)', ed.indexOf('/imgv2/') !== -1 && tags.indexOf('b2|items.0.photo') !== -1);
check('a speaker without a photo has no picture to swap', tags.filter(function (t) { return /^b2\|items\.2/.test(t); }).length === 0);
check('the partner\'s website link is not taken for its picture', tags.indexOf('b3|items.0.url') === -1);
var plain = engine.renderDoc(doc, ev, {});
check('the download carries no picture handle', plain.indexOf('data-img') === -1 && plain.indexOf('data-ed') === -1);
check('a block with no picture is left exactly as it was', engine.tagPictures('<td>x</td>', { id: 'z', props: { text: 'x' } }) === '<td>x</td>');
check('a picture already tagged is not tagged twice', engine.tagPictures('<img data-img="z|url" src="https://a/b.png">', { id: 'z', props: { url: 'https://a/b.png' } }) === '<img data-img="z|url" src="https://a/b.png">');
check('the house icons are left alone (an icon is chosen in the settings)', engine.tagPictures('<img src="https://h/assets/icons/mic-dark.png">', { id: 'z', props: { items: [{ icon: 'https://h/assets/icons/mic-dark.png' }] } }).indexOf('data-img') === -1);
check('pictureKey: the resized ET file and the stored one are the same picture',
  engine.pictureKey('https://img.etb2bimg.com/imgv2/width-200,height-200,resize_mode-2/files/sp/1.jpg') === engine.pictureKey('https://img.etb2bimg.com/files/sp/1.jpg'));
check('pictureKey: an escaped address is the address', engine.pictureKey('https://a/b.png?x=1&amp;y=2') === 'https://a/b.png?x=1&y=2');
check('a quote in a picture address cannot break out of its handle', engine.tagPictures('<img src="https://a/b.png">', { id: 'q"x', props: { url: 'https://a/b.png' } }).indexOf('data-img="q&quot;x|url"') !== -1);

/* ---- POST /api/promo/mailer/picture: a picture swapped into the mail ---- */
var Module = require('module'), EventEmitter = require('events');
var LLM = require.resolve('./llm'), PROMO = require.resolve('./promo');
require.cache[LLM] = require.cache[LLM] || { id: LLM, filename: LLM, loaded: true, children: [], paths: [], exports: { callJson: function () { return Promise.reject(new Error('no model here')); } } };
require.cache[PROMO] = require.cache[PROMO] || { id: PROMO, filename: PROMO, loaded: true, children: [], paths: [], exports: { wire: function () {}, buildKit: function () { return Promise.reject(new Error('no kit here')); } } };
var mailer = require('./promo-mailer');
var STORED = [], LIVE = { ok: true }, FAULTS = [];
var FB = { bucket: { name: 'qa-bucket', file: function (p) {
  return { save: function (data, o) { STORED.push({ path: p, bytes: data.length, type: o.metadata.contentType, data: data }); return Promise.resolve(); },
    makePublic: function () { return Promise.resolve(); } };
} }, db: { collection: function () { return { doc: function () { return { collection: function () { return { add: function () { return Promise.resolve(); } }; }, set: function () { return Promise.resolve(); } }; }, add: function () { return Promise.resolve(); } }; } } };
var sendJsonReal = require('./http').sendJson;
mailer.wire({
  withAdmin: function (req, res, cb) { cb(FB, { email: 'qa-agent@timesinternet.in' }); },
  eventIdOr400: function (res, v) { var s = String(v || ''); if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(s)) { sendJsonReal(res, 400, { error: 'eventId required' }); return null; } return s; },
  loadLiveEvent: function () { if (LIVE.ok) return Promise.resolve({}); var e = new Error('gone'); e.status = 404; e.body = { error: 'This event has been deleted.' }; return Promise.reject(e); },
  sendFailure: function (res, what, err, msg) { if (err && err.status && err.body) return sendJsonReal(res, err.status, err.body); FAULTS.push(String(err && err.stack || err)); sendJsonReal(res, 500, { error: msg }); }
});
function upload(url, bytes) {
  return new Promise(function (resolve) {
    var req = new EventEmitter(); req.url = url; req.method = 'POST'; req.headers = {}; req.destroy = function () {};
    var res = { headersSent: false, status: 0, writeHead: function (st) { res.status = st; res.headersSent = true; }, end: function (b) { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.status, json: j }); } };
    mailer.handlePicture(req, res);
    setImmediate(function () {
      for (var i = 0; i < bytes.length; i += 65536) req.emit('data', bytes.subarray(i, i + 65536));
      req.emit('end');
    });
  });
}
var sharp = require('sharp');
var tests = [];
tests.push(sharp({ create: { width: 3200, height: 1800, channels: 3, background: '#c0392b' } }).png().toBuffer().then(function (photo) {
  return upload('/api/promo/mailer/picture?eventId=qa-ux-b18-mail-t', photo).then(function (r) {
    check('a photo comes back as a public address in the event\'s own folder', r.status === 200 && /^https:\/\/storage\.googleapis\.com\/qa-bucket\/events\/qa-ux-b18-mail-t\/promo-mail\/picture-[a-z0-9]+-[0-9a-f]{12}\.jpg$/.test(r.json.url), r);
    var kept = STORED.filter(function (x) { return r.json && r.json.url.slice(-x.path.length) === x.path; })[0];
    check('… at most 1600 px on its long edge, as a JPEG an inbox can show', r.json.width === 1600 && r.json.height === 900 && kept && kept.type === 'image/jpeg', [r.json, kept && kept.type]);
  });
}));
tests.push(sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer().then(function (logo) {
  return upload('/api/promo/mailer/picture?eventId=qa-ux-b18-mail-l', logo).then(function (r) {
    check('a logo with see-through parts stays a PNG, at its own size (never enlarged)', r.status === 200 && /\.png$/.test(r.json.url) && r.json.width === 400, r);
  });
}));
tests.push(upload('/api/promo/mailer/picture?eventId=qa-ux-b18-mail-e', Buffer.alloc(0)).then(function (r) {
  check('an empty upload is refused in words', r.status === 400 && r.json.error === 'Choose a picture to upload.', r);
}));
tests.push(upload('/api/promo/mailer/picture?eventId=qa-ux-b18-mail-x', Buffer.from('this is not a picture at all')).then(function (r) {
  check('a file that is not a picture is refused in words a sender can act on', r.status === 400 && /not a picture we can read/.test(r.json.error), r);
}));
tests.push(upload('/api/promo/mailer/picture?eventId=qa-ux-b18-mail-b', Buffer.alloc(mailer._test.MAIL_PICTURE_MAX + 10, 1)).then(function (r) {
  check('a picture over 8 MB is refused, said in MB', r.status === 413 && r.json.error === 'That picture is larger than 8 MB. Choose a smaller one.', r);
}));
tests.push(upload('/api/promo/mailer/picture?eventId=Bad%20Id', Buffer.from('x')).then(function (r) {
  check('an event id that is not one is refused', r.status === 400, r);
}));
tests.push(upload('/api/promo/mailer/picture?eventId=qa-ux-b18-mail-svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="/assets/promo-examples/p1.png"/></svg>')).then(function (r) {
  check('a picture made of text that carries example content is refused like every example', r.status === 422, r);
}));
/* last, once the others are done: it turns the event's liveness off for the whole module */
var lastTest = function () { return sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } }).png().toBuffer().then(function (px) {
  LIVE.ok = false;
  return upload('/api/promo/mailer/picture?eventId=qa-ux-b18-mail-gone', px).then(function (r) {
    LIVE.ok = true;
    check('a deleted event takes no picture', r.status === 404, r);
  });
}); };
check('the route is in the API\'s table', /'POST \/api\/promo\/mailer\/picture': promoMailer\('handlePicture'\)/.test(require('fs').readFileSync(path.join(__dirname, 'api.js'), 'utf8')));

module.exports = { check: check, counts: function () { return { passed: passed, failed: failed }; } };
function done() {
  check('no request ended in a server fault', FAULTS.length === 0, FAULTS);
  if (failed) { console.error('promo-mail-easy: ' + failed + ' of ' + (passed + failed) + ' checks failed'); process.exit(1); }
  console.log('promo-mail-easy: all ' + passed + ' checks passed');
}
if (require.main === module) Promise.all(tests).then(lastTest).then(done, function (e) { console.error('FAIL a check threw — ' + (e && e.stack || e)); process.exit(1); });
