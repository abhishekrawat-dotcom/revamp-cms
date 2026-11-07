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

module.exports = { check: check, counts: function () { return { passed: passed, failed: failed }; } };
if (require.main === module) {
  if (failed) { console.error('promo-mail-easy: ' + failed + ' of ' + (passed + failed) + ' checks failed'); process.exit(1); }
  console.log('promo-mail-easy: all ' + passed + ' checks passed');
}
