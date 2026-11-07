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

/* ---- the studio as copied: the B18 patches are in it ---- */
var fs = require('fs'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function count(s, sub) { return s.split(sub).length - 1; }
var studio = read('promo-studio/mailer-studio.js'), page = read('promo-mailer-studio.html'), easySrc = read('promo-studio/oneworld-mail-easy.js');
var easyCss = read('promo-studio/oneworld-mail-easy.css'), py = read('tools/extract-promo-studio.py');
check('words typed in the mail go through the one door (owMailEdit)', count(studio, 'owMailEdit({kind:"words",path:ed,value:txt});') === 1 &&
  studio.indexOf('mlSetProp(ed,txt); MD.dirty=true; mlProps(); mlRender(0);') === -1);
check('an empty list says where to add its people, never "in the API"', studio.indexOf(' in the API.') === -1 && count(studio, 'owRosterNone(spk?"speakers":ses?"sessions":"partners")') === 1);
check('no "raise Max above" left', studio.indexOf('raise Max above') === -1 && count(studio, 'owLimitNote(max)') === 2);
check('a draft not changed and not saved shows no state pill beside "New draft"', count(studio, 'pill.style.display=(MD.dirty||MD.saved)?"":"none";') === 1);
check('the cards open a design with "Edit" (UX-132)', studio.indexOf('Open in studio →') === -1 && studio.indexOf('>Continue “') === -1 && count(studio, '>Edit “${escapeHtml(saves[0].name)}” →</button>') === 1);
check('a card\'s need reads "Needs …"', count(studio, '<div class="warn">Needs ${m.missing.map(escapeHtml).join(", ")}</div>') === 1);
check('saved work is listed under "Saved" (UX-132)', studio.indexOf('Recently updated</div>') === -1 && count(studio, '<div class="sec-h">Saved</div>') === 1);
check('the bar says "Unsaved changes" / "Saved" / "Not saved yet", never "generated"', studio.indexOf('"generated"') === -1 && count(studio, '"Unsaved changes":(MD.saved?"Saved":"Not saved yet")') === 1);
check('UX-123 (6): the first Save names the version in the studio\'s own dialog, prefilled with the subject', studio.indexOf('prompt("Name this version"') === -1 &&
  count(studio, 'await uiPrompt("Name this version",{value:mlDefaultName(),') === 1 && /const mlDefaultName=\(\)=>String\(\(MD\.doc&&MD\.doc\.subject\)\|\|""\)\.trim\(\)/.test(studio) &&
  /async function mlSave\(\)\{\n  if\(!MD\.doc\)return;\n  if\(!MD\.saveId\)\{ await mlSaveAs\(\); return; \}/.test(studio));
/* the page */
check('the back button reads "← Back to mailers" (UX-131)', page.indexOf('<button class="back" type="button" onclick="closeMailer()">← Back to mailers</button>') !== -1 && page.indexOf('title="Back">←</button>') === -1);
check('the editor\'s name is for screen readers only, and "Mailer studio" is gone', page.indexOf('<h1 class="ttl ow-sr">Mailer editor</h1>') !== -1 && page.indexOf('Mailer studio') === -1);
check('the bar: Save, Save as new, Download', page.indexOf('>Save</button>') !== -1 && page.indexOf('>Save as new</button>') !== -1 && /onclick="mlDownload\(\)"[^>]*>Download<\/button>/.test(page) && page.indexOf('Download to send') === -1);
check('the always-open rail of blocks is gone', page.indexOf('class="ml-rail"') === -1 && page.indexOf('id="mlRailPal"') === -1 && page.indexOf('Search blocks') === -1);
check('the list of sections to add is "Add a section"', page.indexOf('<div class="ml-pop" id="mlPop" role="dialog" aria-label="Add a section">') !== -1 && page.indexOf('Add a block') === -1);
check('the easy layout\'s stylesheet and script are on the page, the script last', page.indexOf('href="promo-studio/oneworld-mail-easy.css"') > page.indexOf('href="promo-studio/oneworld.css"') &&
  page.indexOf('src="promo-studio/oneworld-mail-easy.js"') > page.indexOf('src="promo-studio/oneworld.js"'));
check('the export sizes are named with their pixels and use (UX-132)', page.indexOf('Save as picture · desktop, 800 px wide') !== -1 && page.indexOf('Save as picture · phone, 390 px wide') !== -1);
/* the markup patches are the copier's, counted as its code patches are */
check('the copier patches the markup, each counted', /MARKUP_PATCHES = \[/.test(py) && /for n, \(old, new, want, why\) in enumerate\(MARKUP_PATCHES, 1\):/.test(py) && /MARKUP = MARKUP\.replace\(old, new\)/.test(py));
check('the copier writes the easy layer into the page', py.indexOf('<script src="promo-studio/oneworld-mail-easy.js"></script>') !== -1 && py.indexOf('promo-studio/oneworld-mail-easy.css') !== -1);

/* ---- oneworld-mail-easy.js is ES5 and uses only the console's tokens ---- */
var easyCode = easySrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
check('oneworld-mail-easy.js: no let, const, arrow function or template string', !/\blet\s|\bconst\s|=>|`/.test(easyCode));
check('oneworld-mail-easy.js parses', (function () { try { new vm.Script(easySrc); return true; } catch (e) { return false; } })());
var cssRules = easyCss.replace(/\/\*[\s\S]*?\*\//g, '');
check('the stylesheet writes no colour of its own (both themes follow the tokens)', !/#[0-9a-f]{3,6}\b|rgba?\(/i.test(cssRules), (cssRules.match(/#[0-9a-f]{3,6}\b|rgba?\([^)]*\)/gi) || []));
check('the new words never say Oneworld or Revamp CMS', !/Oneworld 2\.0|Revamp CMS/.test(easySrc.replace(/\/\*[\s\S]*?\*\//g, '')) &&
  !/'[^']*Oneworld[^']*'/.test(easyCode.replace(/Oneworld's/g, '')));

/* ---- oneworld-mail-easy.js in a vm, over the platform's own history and colour helpers ---- */
function slice(from, to) { var a = studio.indexOf(from), b = studio.indexOf(to, a); if (a === -1 || b === -1) throw new Error('not found: ' + from); return studio.slice(a, b + to.length); }
function sandbox() {
  var calls = { setProp: [], props: 0, status: 0, render: [], add: [], del: [], toast: [], palette: [], popClose: 0, editAt: [] };
  var els = {};
  function el(id) { return els[id] || (els[id] = { id: id, innerHTML: '', style: {}, classList: { contains: function () { return false; }, add: function () {}, remove: function () {} }, querySelector: function () { return null; }, querySelectorAll: function () { return []; } }); }
  var sb = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, JSON: JSON, Math: Math, String: String, Number: Number, Array: Array, Object: Object, Promise: Promise, RegExp: RegExp, Error: Error,
    window: { innerWidth: 1440, innerHeight: 900, RichText: {}, RevampAuth: {} }, document: { activeElement: null, createElement: function () { return el('x' + Math.random()); }, querySelector: function () { return null; } },
    EVENT_ID: 'qa-ux-b18-mail-t', $: el,
    escapeHtml: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); },
    MD: null, BS: {}, MLA: { loaded: true, speakers: [] }, MAILERS: { blocks: engine.blockPalette(), tracking: true, event: {} },
    blockIndex: function (id) { return (sb.MD.doc.blocks || []).findIndex(function (b) { return b.id === id; }); },
    mlSetProp: function (p, v) { calls.setProp.push([p, v]); var parts = p.split('|'), b = sb.MD.doc.blocks.filter(function (x) { return x.id === parts[0]; })[0]; if (b) b.props[parts[1]] = v; sb.MD.dirty = true; },
    mlProps: function () { calls.props++; sb.mlHistPush(); }, mlStatus: function () { calls.status++; sb.mlHistPush(); }, mlRender: function (d) { calls.render.push(d); },
    mlAdd: function (type, at) { calls.add.push([type, at]); sb.MD.doc.blocks.splice(at == null ? sb.MD.doc.blocks.length : at, 0, { id: 'bnew', type: type, props: {} }); return Promise.resolve(); },
    mlDel: function (id) { calls.del.push(id); var i = sb.blockIndex(id); if (i >= 0) sb.MD.doc.blocks.splice(i, 1); },
    mlDup: function () {}, mlSelect: function () {}, mlFields: function () {}, mlSwatches: function () {}, mlSetBg: function () {}, mlDefaultBg: function () { return '#ffffff'; },
    mlGetProp: function (p) { var parts = p.split('|'), b = sb.MD.doc.blocks.filter(function (x) { return x.id === parts[0]; })[0]; return b ? String(b.props[parts[1]] || '') : ''; },
    toast: function (m, ms, k) { calls.toast.push([m, k]); },
    mlPalette: function (at, e) { calls.palette.push([at, e]); }, mlPopClose: function () { calls.popClose++; },
    mlEditAt: function (x, y) { calls.editAt.push([x, y]); return false; },
    fldInput: function () { return el('fld'); }, fldColor: function () { return el('clr'); }, fldMultipick: function () { return el('mp'); },
    richOk: function () { return false; }, owStageScale: function () { return 1; }, owStudioOpen: function () { return true; },
    ICP: { el: null }, uiOpen: function () { return Promise.resolve(null); }, uiClose: function () {}
  };
  vm.createContext(sb);
  /* the platform's own undo history and contrast helpers, exactly as the studio runs them */
  vm.runInContext([slice('const hexNorm=', ' : ""; };'), slice('const relLum=', '+.0722*v[2]; };'), slice('const ratio=', '\n'), slice('function derivedInk(bg){', '\n}'),
    slice('const MLH={stack:[],at:-1,t:null,busy:false}, MLH_MAX=60;', 'const mlUndo=()=>mlHistGo(-1), mlRedo=()=>mlHistGo(1);'),
    'this.MLH=MLH;this.mlHistReset=mlHistReset;this.mlHistPush=mlHistPush;this.mlHistGo=mlHistGo;this.mlUndo=mlUndo;this.hexNorm=hexNorm;this.ratio=ratio;this.relLum=relLum;this.derivedInk=derivedInk;'].join('\n'), sb);
  var propsStub = sb.mlProps;
  vm.runInContext(easySrc, sb, { filename: 'oneworld-mail-easy.js' });
  /* the panel it draws is checked in the browser; here the door's calls into it are counted */
  sb.owPanel = sb.mlProps; sb.mlProps = propsStub;
  sb.calls = calls;
  return sb;
}
var E = sandbox();
/* + Add a section: the groups */
var groups = E.owAddGroups(engine.blockPalette());
check('the groups in order: Text, Pictures, People, Event details, Footer, More', groups.map(function (g) { return g.name; }).join(' · ') === 'Text · Pictures · People · Event details · Footer · More', groups.map(function (g) { return g.name; }));
var moreG = groups[groups.length - 1].blocks.map(function (b) { return b.type; });
check('More holds the rare ones, Custom HTML last', moreG[moreG.length - 1] === 'html' && moreG.indexOf('lozenges') !== -1 && moreG.indexOf('heading') === -1, moreG);
check('within a group, the usual ones first: Heading, Paragraph, List of points … Title band last', groups[0].blocks.map(function (b) { return b.type; }).join() === 'heading,text,bullets,button,quote,hero', groups[0].blocks.map(function (b) { return b.type; }));
check('a block that cannot be added is not offered', E.owAddGroups([{ type: 'a', label: 'A', group: 'text', addable: false }]).length === 0);
check('a block in no known group goes under More', E.owAddGroups([{ type: 'a', label: 'A', group: 'weird', addable: true }])[0].name === 'More');
var addHtml = E.owAddHtml(groups, false);
check('More is folded until asked for, and says so to a screen reader', /aria-expanded="false" aria-controls="owAddMore">▸ More sections<\/button><div class="ow-addl" id="owAddMore" hidden>/.test(addHtml));
check('Custom HTML is marked advanced', /data-type="html">Custom HTML <span class="ow-adv-tag">advanced<\/span>/.test(addHtml));
check('every choice is a real button with its type', count(addHtml, '<button type="button" class="ow-addb" data-type="') === groups.reduce(function (n, g) { return n + g.blocks.length; }, 0));

/* the one door for changes */
function freshDoc() {
  return { subject: 'Old subject', preheader: 'Old preview', theme: 'site', blocks: [
    { id: 'b1', type: 'banner', props: { url: 'https://a.example/old.jpg' } },
    { id: 'b2', type: 'speakers', props: { items: [{ name: 'Ananya Rao', photo: 'https://a.example/a.jpg' }] } },
    { id: 'b3', type: 'speaker', props: { name: 'Meera Iyer' } },
    { id: 'bf', type: 'footer', props: {} }] };
}
E.MD = { id: 'mailer.announcement', doc: freshDoc(), sel: null, dirty: false, insertAt: null };
E.mlHistReset();
var steps0 = E.MLH.stack.length;
var tests2 = [];
tests2.push(E.owMailEdit({ kind: 'picture', path: 'b1|url', value: 'https://storage.googleapis.com/x/new.jpg' }).then(function (ok) {
  check('a picture: written with the studio\'s own mlSetProp, the mail drawn again, the panel too', ok === true && JSON.stringify(E.calls.setProp[0]) === JSON.stringify(['b1|url', 'https://storage.googleapis.com/x/new.jpg']) &&
    E.calls.render.indexOf(0) !== -1 && E.calls.props >= 1 && E.MD.dirty === true, [ok, E.calls.setProp, E.calls.render, E.calls.props, E.MD.dirty]);
  check('… and it is one Undo step, recorded at once', E.MLH.stack.length === steps0 + 1 && E.MLH.at === E.MLH.stack.length - 1, [steps0, E.MLH.stack.length]);
  E.mlUndo();
  check('Undo brings the old picture back', E.MD.doc.blocks[0].props.url === 'https://a.example/old.jpg', E.MD.doc.blocks[0].props.url);
  E.MLH.busy = false;
  return E.owMailEdit({ kind: 'subject', value: 'New subj', typing: true });
}).then(function () {
  check('typing the subject: written, the mail drawn after a pause, the panel left alone under the cursor', E.MD.doc.subject === 'New subj' && E.calls.render[E.calls.render.length - 1] === 700);
  var before = E.MLH.at;
  return E.owMailEdit({ kind: 'people', block: 'b2', items: [{ name: 'Kavya Menon' }, { name: 'Rohit Subramanian' }] }).then(function () {
    check('a tick: the section\'s people replaced', E.MD.doc.blocks[1].props.items.map(function (x) { return x.name; }).join() === 'Kavya Menon,Rohit Subramanian');
    check('… the typing just before it is its own step, and the tick another (a new change after Undo drops what Redo had)', E.MLH.at === before + 2 && E.MLH.at === E.MLH.stack.length - 1, [before, E.MLH.at, E.MLH.stack.length]);
  });
}).then(function () {
  return E.owMailEdit({ kind: 'person', block: 'b3', person: { name: 'Rohit Subramanian', role: 'CEO', company: 'Kaveri Digital', photo: 'https://a.example/r.jpg' } });
}).then(function () {
  var p = E.MD.doc.blocks[2].props;
  check('the speaker in focus: name, role, company and photo swapped in place', p.name === 'Rohit Subramanian' && p.role === 'CEO' && p.company === 'Kaveri Digital' && p.photo === 'https://a.example/r.jpg');
  return E.owMailEdit({ kind: 'add', type: 'heading' });
}).then(function () {
  check('a section added with nothing selected goes above the footer', JSON.stringify(E.calls.add[0]) === JSON.stringify(['heading', 3]) && E.MD.doc.blocks[3].type === 'heading' && E.MD.doc.blocks[4].type === 'footer', E.calls.add);
  return E.owMailEdit({ kind: 'remove', block: 'bnew' });
}).then(function (ok) {
  check('a section removed through the same door', ok === true && E.calls.del[0] === 'bnew');
  return Promise.all([E.owMailEdit({ kind: 'words', path: 'nope|text', value: 'x' }), E.owMailEdit({ kind: 'words', path: 'no-bar', value: 'x' }), E.owMailEdit({ kind: 'teleport' }), E.owMailEdit(null)]);
}).then(function (r) {
  check('a change to no section, or of no known kind, changes nothing', r.every(function (x) { return x === false; }), r);
}));
var studioTests = Promise.all(tests2);
/* the checks below run while the ones above are still answering: they get a sandbox of their own */
var F = sandbox();
/* plain words */
check('an empty list links to where its people are added', F.owRosterNone('speakers') === 'This event has no speakers yet. <a href="/edit-event.html?event=qa-ux-b18-mail-t#content/speakers" target="_top">Add them in Content › Speakers</a>.' &&
  F.owRosterNone('partners').indexOf('#content/sponsors') !== -1 && F.owRosterNone('sessions').indexOf('Content › Agenda') !== -1);
check('a full list says how to swap without "Max"', F.owLimitNote(6) === 'All 6 places are taken. Untick one to swap someone in, or show more in this section’s settings.');
/* the contrast check is silent unless it fails */
check('a readable text colour says nothing', F.owContrastWarning({ key: 'color' }, '#333333', '#ffffff') === '');
check('a pale text colour on white warns, and says which way to go', /^Hard to read: .*\(1\.\d to 1; it needs 4\.5\)\. Pick a darker one\.$/.test(F.owContrastWarning({ key: 'color' }, '#eeeeee', '#ffffff')), F.owContrastWarning({ key: 'color' }, '#eeeeee', '#ffffff'));
check('… a dark one on a dark mail: lighter', /Pick a lighter one\.$/.test(F.owContrastWarning({ key: 'ink' }, '#222222', '#101427')));
check('a button colour whose words can be made readable says nothing', F.owContrastWarning({ key: 'bg' }, '#ffff00', '#ffffff') === '' && F.owContrastWarning({ key: 'bg' }, '#2563eb', '#ffffff') === '');
check('… a mid grey, where neither white nor black words reach 4.5 to 1, warns', /^Hard to read: words on this colour/.test(F.owContrastWarning({ key: 'bg' }, '#777777', '#ffffff')));
check('a colour left empty is the mail\'s own: nothing to say', F.owContrastWarning({ key: 'color' }, '', '#ffffff') === '');
/* which settings fold under Advanced */
check('an exact colour is advanced; a colour asked for by "Custom…" stays by its choice; a menu is not', F.owIsAdvancedField({ type: 'color', key: 'color' }) && !F.owIsAdvancedField({ type: 'color', key: 'tintColor', showWhen: { tint: ['custom'] } }) && !F.owIsAdvancedField({ type: 'select', key: 'tone' }));
/* the section list */
F.BS = {}; engine.blockPalette().forEach(function (b) { F.BS[b.type] = b; });
var rows = F.owSectionsHtml([{ id: 'h1', type: 'heading', props: { text: '**Why** attend [now](https://x)' } }, { id: 's1', type: 'speakers', props: { items: [{ name: 'Ananya Rao' }, { name: 'B' }, { name: 'C' }] } }], 's1');
check('each section is a button with its plain name and its first words, markers taken out', rows.indexOf('<button type="button" class="ow-row" data-id="h1"><b>Heading</b><span>Why attend now</span></button>') !== -1, rows);
check('… a list shows its first entry and how many more', rows.indexOf('<span>Ananya Rao and 2 more</span>') !== -1);
check('… and the selected one is marked for screen readers', rows.indexOf('data-id="s1" aria-current="true"') !== -1);
check('… a tile shows its label and value', F.owSnippet({ props: { items: [{ label: 'When', value: '10 December, 2026' }, { label: 'Where', value: 'Mumbai' }] } }) === 'When: 10 December, 2026 and 1 more');
check('a mail with no sections says so', F.owSectionsHtml([], null).indexOf('This mail has no sections yet.') !== -1);
check('a long first line is cut on a word, with an ellipsis', /…$/.test(F.owSnippet({ props: { text: new Array(20).join('word ') } })) && F.owSnippet({ props: { text: new Array(20).join('word ') } }).length <= 47);
/* the people and pictures */
F.MD = { doc: { blocks: [{ id: 'b2', type: 'speakers', props: { items: [{ name: 'Ananya Rao', photo: 'https://a/a.jpg' }] } }, { id: 'b4', type: 'logobar', props: { logo: 'https://a/l.png' } }, { id: 'b1', type: 'banner', props: {} }, { id: 'b5', type: 'sessions', props: {} }, { id: 'b6', type: 'speaker', props: { name: 'Meera Iyer' } }] } };
check('Speakers & partners lists the speakers and partners sections and the speaker in focus (not the agenda)', F.owPeopleBlocks(F.MD.doc.blocks).map(function (b) { return b.id; }).join() === 'b2,b6');
check('a picture is named for whom it shows', F.owPictureName('b2|items.0.photo') === 'Ananya Rao’s photo' && F.owPictureName('b4|logo') === 'the logo' && F.owPictureName('b1|url') === 'the picture' && F.owPictureName('b6|photo') === 'Meera Iyer’s photo');
/* the platform's functions it stands in front of */
F.mlEditAt(10, 20);
check('a click on words still edits them in place (the platform\'s mlEditAt), when no picture is under it', JSON.stringify(F.calls.editAt[0]) === '[10,20]');

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
var tests = [studioTests];
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
