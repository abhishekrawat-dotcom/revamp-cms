// node functions/lib/owner-logo.test.js — the hero's logo unit: the logo the owner uploaded wins, and every
// lock-up (the owner's and the previous edition's) is examined the same way: its year, written short or in
// full, moved on to the event's in the same form and checked by a second reading; another edition's marks
// cropped out, the event's own tagline kept; never boxed, never redrawn. Written for AutoTech Summit 2027,
// whose owner's '27 logo was passed over for the 2026 edition's '26 lock-up, shipped with its year unmoved.
// Uses the two real lock-ups (fixtures/logo-unit/autotech-summit-*). No network: the model's readings are
// given here, and Google Fonts answers from a fixture (Lexend 500, digits only).
'use strict';
const fs = require('fs'), path = require('path');
function fixture(name) { return fs.readFileSync(path.join(__dirname, 'fixtures', 'logo-unit', name)); }
const FONT = fixture('lexend-500-digits-subset.ttf');
const PREV = fixture('autotech-summit-2026-lockup.png');         // the 2026 page's lock-up: summit '26 + its own tagline
const OWNER = fixture('autotech-summit-2027-owner.svg');           // the owner's upload: one PNG in an SVG, summit '27

/* the network, replayed: api.js takes these from their modules when it is loaded, so they are replaced first */
const files = {};
require('./safe-fetch').safeFetch = function (url) {
  url = String(url);
  if (/^https:\/\/fonts\.googleapis\.com\//.test(url)) return Promise.resolve({ status: 200, headers: {}, body: Buffer.from("@font-face { src: url(https://fonts.gstatic.com/s/test/lexend.ttf) format('truetype'); }") });
  if (/^https:\/\/fonts\.gstatic\.com\//.test(url)) return Promise.resolve({ status: 200, headers: {}, body: FONT });
  if (files[url]) return Promise.resolve({ status: 200, headers: {}, body: files[url] });
  return Promise.resolve({ status: 404, headers: {}, body: Buffer.alloc(0) });
};
const png = require('./png-lite');
let answer = null, asked = [];
require('./gemini').callGeminiJson = function (prompt, schema, opts) {
  const shown = png.decode(Buffer.from(opts.images[0].data, 'base64'));
  asked.push({ prompt: prompt, width: shown.width, height: shown.height });
  const a = answer && answer(shown, asked.length);
  return Promise.resolve(a ? { parsed: a } : { error: { code: 'ai-config' } });
};
const hooks = require('./api.js')._testHooks;
const lu = require('./logo-unit');
const gd = require('./gen-design');

let passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }

/* a reading as the model gives it */
function reading(o) {
  return Object.assign({ allText: '', year: '', yearFull: '', yearBox: [], yearFont: 'sans-serif', yearWeight: 'regular', yearFontFamily: 'Lexend', yearFontWeight: '500',
    tagline: '', extras: '', extraBoxes: [], ownBox: [] }, o);
}
const TAG = 'DEFINING INDIA\'S DECADE IN AUTO TECHNOLOGY';
/* the 2026 lock-up (417 x 209): "'26" stands at x 294-388, y 99-154 */
const READ_26 = reading({ allText: 'ET Autotech summit \'26 ' + TAG, year: '\'26', yearFull: '2026', yearBox: [470, 698, 745, 937], tagline: TAG });
const READ_27 = reading({ allText: 'ET Autotech summit \'27 ' + TAG, year: '\'27', yearFull: '2027', yearBox: [470, 698, 745, 937], tagline: TAG });

function fakeFb() {
  const stored = {};
  return {
    stored: stored,
    bucket: {
      name: 'b',
      file: function (p) {
        return {
          save: function (buf) { stored[p] = buf; return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); },
          download: function () { return stored[p] ? Promise.resolve([stored[p]]) : Promise.reject(new Error('No such object: ' + p)); }
        };
      }
    }
  };
}
const OWNER_URL = 'https://storage.googleapis.com/b/events/autotech-summit-2027/logo/owner.svg';
function build(fb, o) {
  return hooks.buildLogoUnit(fb, 'autotech-summit-2027', Object.assign({
    eventMeta: { name: 'AutoTech Summit 2027', start: null }, design: { mode: 'light', headingFont: 'Inter', themeColor: '#e4002b' }, stamp: 't', briefTexts: []
  }, o));
}
const PREV_URL = 'https://img.etb2bimg.com/files/retail_files/frame.webp';
files[PREV_URL] = PREV;
const PREV_SOURCE = [{ type: 'previousEdition', url: 'https://auto.economictimes.indiatimes.com/auto-tech-summit2026', editionHints: { years: ['2026'] }, logoCandidates: [{ kind: 'img', url: PREV_URL }] }];

(async function () {
  /* ---------- 1. a year as a lock-up writes it ---------- */
  const forms = { '2026': '2027', '\'26': '\'27', '’26': '’27', '‘26': '‘27', '26': '27', 'FY26': 'FY27', 'FY 26': 'FY 27', 'FY2026': 'FY2027', '2026-27': '2027-28', '2026–27': '2027–28', '2026-2027': '2027-2028' };
  Object.keys(forms).forEach(function (w) {
    const y = lu.shownYear(w);
    check('shownYear("' + w + '") is 2026', y && y.full === '2026' && y.written === w, y);
    check('yearAs("' + w + '", 2027) is "' + forms[w] + '"', lu.yearAs(w, '2027') === forms[w], lu.yearAs(w, '2027'));
  });
  check('not a year: "2026-28", "summit", "@2047", "", "126"', ['2026-28', 'summit', '@2047', '', '126', null].every(function (w) { return lu.shownYear(w) === null; }));
  const seen = function (t) { return lu.yearsShownIn(t).map(function (y) { return y.written; }).join('|'); };
  check('yearsShownIn: the short forms a lock-up writes', seen('ET Autotech summit \'26 DEFINING') === '\'26' && seen('summit ’26') === '’26' && seen('Summit FY26 and 2026-27') === 'FY26|2026-27', seen('Summit FY26 and 2026-27'));
  check('yearsShownIn: not a date\'s day, a slogan, a founding or copyright year', seen('26 March, Viksit Bharat @2047, Since 2015, Est. 2019, © 2024') === '', seen('26 March, Viksit Bharat @2047, Since 2015, Est. 2019, © 2024'));
  check('event year: from its name when it has no date (AutoTech Summit 2027)', lu.eventYear({ eventName: 'AutoTech Summit 2027', start: null }) === '2027');
  check('event year: a name written short ("Summit \'27")', lu.eventYear({ eventName: 'Auto Summit \'27' }) === '2027');
  check('event year: else its start', lu.eventYear({ eventName: 'AutoTech Summit', start: '2027-02-10T09:00' }) === '2027');
  check('event year: else the year its brief names most', lu.eventYear({ eventName: 'AutoTech Summit', start: '', briefTexts: ['The 2027 edition of the summit', 'Back in 2027 with more', 'after 2026'] }) === '2027');
  check('event year: never today\'s date', lu.eventYear({ eventName: 'AutoTech Summit' }) === '' && lu.eventYear() === '');
  check('edition years for this event: 2026 -> 2027', JSON.stringify(lu.editionYears({ eventName: 'AutoTech Summit 2027', start: null, hints: { years: ['2026'] }, pageUrl: PREV_SOURCE[0].url })) === '{"from":"2026","to":"2027"}');

  /* ---------- 2. a year written as text in an SVG, in any form ---------- */
  function svgWith(t) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>' + t + '</text></svg>'; }
  [['summit \'26', 'summit \'27'], ['summit ’26', 'summit ’27'], ['summit &#8217;26', 'summit &#8217;27'], ['summit &#x2019;26', 'summit &#x2019;27'], ['summit &apos;26', 'summit &apos;27']].forEach(function (c) {
    const r = lu.svgReplaceYear(svgWith(c[0]), lu.shownYear(c[0].replace(/^summit /, '').replace(/&#8217;|&#x2019;/, '’').replace('&apos;', '\'')).written, '2027');
    check('svgReplaceYear: "' + c[0] + '" -> "' + c[1] + '"', r.changed === 1 && r.svg === svgWith(c[1]), r.svg);
  });
  check('svgReplaceYear: FY26 -> FY27, 2026-27 -> 2027-28', lu.svgReplaceYear(svgWith('FY26'), 'FY26', '2027').svg === svgWith('FY27') && lu.svgReplaceYear(svgWith('Season 2026-27'), '2026-27', '2027').svg === svgWith('Season 2027-28'));
  check('svgReplaceYear: two digits alone are never looked for in a file', lu.svgReplaceYear(svgWith('26 March'), '26', '2027').changed === 0);
  check('svgReplaceYear: "\'26" does not touch 2026 or 126', lu.svgReplaceYear(svgWith('2026 126 \'26'), '\'26', '2027').svg === svgWith('2026 126 \'27'));

  /* a lock-up drawn as outlines, its year written "'26": the two digits are the year's shapes, the apostrophe stays */
  const sy = require('./svg-year');
  const outlined = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><path d="M10 30h250v50h-250z" fill="#e91b3b"/>' +
    '<path d="M280 30h8v14h-8z" fill="#e91b3b"/><path d="M296 30h36v50h-36z" fill="#e91b3b"/><path d="M340 30h36v50h-36z" fill="#e91b3b"/></svg>';
  const found = sy.yearShapes(outlined, { x: 278, y: 28, width: 100, height: 54 }, { digits: 2, lead: true });
  check('outlined \'26: the two digits are found, the apostrophe is not one of them', found && found.shapes.length === 2 && Math.round(found.box.x) === 296 && Math.round(found.box.width) === 80, found && found.box);
  check('outlined \'26: asked for four digits, it is not taken for a year', sy.yearShapes(outlined, { x: 278, y: 28, width: 100, height: 54 }) === null);

  /* ---------- 3. the reading: the year as written, the event's own tagline never an extra ---------- */
  const prevPic = { bytes: PREV, info: lu.imageInfo(PREV) }, prevDecoded = png.decode(PREV);
  answer = function () { return READ_26; }; asked = [];
  let r = await hooks.readLogoPicture('', prevPic, prevDecoded, 0, 'AutoTech Summit 2027');
  check('reading "\'26": the year as written and as four digits, and where it is', r && r.year === '\'26' && r.full === '2026' && r.box && Math.round(r.box.x) === 291 && r.tagline === TAG, r);
  check('the reading is told which event it is', /AutoTech Summit 2027/.test(asked[0].prompt));
  answer = function () { return reading({ allText: 'ET Autotech summit \'26', year: '2026', yearBox: [470, 698, 745, 937] }); };
  r = await hooks.readLogoPicture('', prevPic, prevDecoded, 0, '');
  check('a reading that wrote the year in four digits is taken at the form the picture shows (\'26)', r && r.year === '\'26' && r.full === '2026', r);
  answer = function () { return reading({ allText: 'ET Autotech summit \'26', year: '' }); };
  r = await hooks.readLogoPicture('', prevPic, prevDecoded, 0, '');
  check('a reading that named no year still reports the one in its words (the old silent failure)', r && r.year === '' && r.shown.map(function (y) { return y.written; }).join() === '\'26', r);
  answer = function () { return reading({ allText: READ_26.allText, year: '\'26', tagline: TAG, extras: TAG, extraBoxes: [{ text: TAG, box: [880, 0, 960, 1000] }], ownBox: [0, 0, 760, 1000] }); };
  r = await hooks.readLogoPicture('', prevPic, prevDecoded, 0, '');
  check('the event\'s own tagline, put with the extras by the model, is not an extra', r && r.extras === '' && r.extraBoxes.length === 0, r);
  answer = function () { return reading({ allText: READ_26.allText + ' Powered by Acme', tagline: TAG, extras: TAG + ' Powered by Acme', extraBoxes: [{ text: TAG, box: [880, 0, 960, 1000] }, { text: 'Powered by Acme', box: [960, 300, 1000, 700] }], ownBox: [0, 0, 760, 1000] }); };
  r = await hooks.readLogoPicture('', prevPic, prevDecoded, 0, '');
  check('… while a sponsor\'s line beside it still is', r && r.extras === 'Powered by Acme' && r.extraBoxes.length === 1, r);
  check('the reading asks for the year as written, as four digits, and for the tagline apart from the extras',
    /'26/.test(hooks.LOGO_READ_SCHEMA.properties.year.description) && hooks.LOGO_READ_SCHEMA.properties.yearFull && hooks.LOGO_READ_SCHEMA.properties.tagline &&
    /NOT an extra/.test(hooks.LOGO_READ_SCHEMA.properties.tagline.description) && !/theme line/.test(hooks.LOGO_READ_SCHEMA.properties.extras.description));

  /* ---------- 4. moving "'26" on in the picture itself ---------- */
  const read26 = { year: '\'26', full: '2026', box: { x: 292, y: 97, width: 98, height: 59 }, serif: false, bold: false, fontFamily: 'Lexend', fontWeight: 500 };
  const moved = await hooks.moveYearInPng(prevDecoded, read26, '2027', 'AutoTech Summit 2027', PREV.length);
  const movedSvg = moved ? moved.bytes.toString('utf8') : '';
  const texts = (movedSvg.match(/<text\b[^>]*>[^<]*<\/text>/g) || []);
  check('\'26 -> \'27: only the 6 is set again, as a 7 — the apostrophe and the 2 stay the artwork\'s own', moved && moved.from === '\'26' && moved.to === '\'27' && texts.length === 1 && />7<\/text>$/.test(texts[0]), texts);
  check('… in the font the reading named, embedded, in the digit\'s own colour', /@font-face\{font-family:'rvyear'/.test(movedSvg) && /fill="#e[0-9a-f]1b3[0-9a-f]"|fill="#e9/.test(texts[0] || ''), texts[0]);
  check('… the picture keeps its size and stays a see-through picture (no box behind it)', moved && moved.info.width === 417 && moved.info.height === 209 && !/<rect/.test(movedSvg));
  const drawn = moved && await hooks.rasterise(movedSvg, { clear: true, width: 417, font: moved.font });
  const before = png.decode(PREV), after = drawn && png.decode(drawn.png);
  function inkIn(img, x0, x1) { return png.inkCount(img, { x: x0, y: 97, width: x1 - x0, height: 60 }, null); }
  check('drawn: the apostrophe and the 2 are where they were, a digit stands where the 6 was', after && Math.abs(inkIn(after, 290, 350) - inkIn(before, 290, 350)) < inkIn(before, 290, 350) * 0.08 && inkIn(after, 352, 392) > 200,
    after && [inkIn(after, 290, 350), inkIn(before, 290, 350), inkIn(after, 352, 392)]);
  check('drawn: everything above the year row is untouched', after && png.inkCount(after, { x: 0, y: 0, width: 417, height: 80 }, null) === png.inkCount(before, { x: 0, y: 0, width: 417, height: 80 }, null));
  const astray = await hooks.moveYearInPng(prevDecoded, Object.assign({}, read26, { box: { x: 4, y: 97, width: 270, height: 59 } }), '2027', '', PREV.length);
  check('a box round something that is not a year ("summit") is not acted on', astray === null);
  /* the new digit fitted to the 2 that stays (its ink: x 311-347, y 99-154), not to the font's capitals */
  const seven = after && png.inkBounds(after, { x: 350, y: 80, width: 67, height: 95 }, null);
  check('drawn: the 7 stands as tall as the 2, on its foot, no wider than it, clear of it', seven && Math.abs(seven.height - 55) <= 2 && Math.abs(seven.y + seven.height - 154) <= 1.5 &&
    seven.width <= 36 * 1.15 && seven.x >= 349, seven);
  /* A reading whose box was a little loose took in the end of "summit"'s t; the year was then left at '26
     (AutoTech Summit 2027, made on 22 Oct 2026). The t is outside the year's look now. */
  const loose = await hooks.moveYearInPng(prevDecoded, Object.assign({}, read26, { box: { x: 282.309, y: 95.513, width: 106.335, height: 57.684 } }), '2027', '', PREV.length);
  check('a box a little loose (taking in the t of "summit") still moves the year, the t untouched', loose && loose.to === '\'27', loose && loose.to);
  const looseDrawn = loose && await hooks.rasterise(loose.bytes.toString('utf8'), { clear: true, width: 417, font: loose.font });
  const looseAfter = looseDrawn && png.decode(looseDrawn.png);
  check('… everything left of the apostrophe is as it was', looseAfter && png.inkCount(looseAfter, { x: 0, y: 80, width: 290, height: 80 }, null) === png.inkCount(before, { x: 0, y: 80, width: 290, height: 80 }, null));

  /* ---------- 5. the previous edition's unit, end to end ---------- */
  function verifying(after) { return function (shown) { return shown.width === 1000 ? after : READ_26; }; }
  let fb = fakeFb();
  answer = verifying(READ_27); asked = [];
  let unit = await build(fb, { sourceDocs: PREV_SOURCE });
  let svg = fb.stored[unit.storagePath] ? fb.stored[unit.storagePath].toString('utf8') : '';
  check('previous edition: \'26 becomes \'27, read twice (the lock-up, then the moved year)', unit.source === 'previous-edition' && asked.length === 2 && /changed from '26 to '27/.test(unit.note) && /<text\b[^>]*>7<\/text>/.test(svg), [unit.note, asked.length]);
  check('previous edition: its own tagline stays (the picture is not cropped)', unit.width === 417 && unit.height === 209 && !/cropped/.test(unit.note), unit);
  fb = fakeFb(); answer = function (shown) { return shown.width === 1000 ? READ_26 : reading(Object.assign({}, READ_26, { extras: TAG, extraBoxes: [{ text: TAG, box: [880, 0, 960, 1000] }], ownBox: [0, 0, 760, 1000] })); }; asked = [];
  unit = await build(fb, { sourceDocs: PREV_SOURCE });
  check('previous edition: a second reading that still sees \'26 -> never used: the event\'s name in its place, and the owner told', unit.source === 'generated' && /shows '26 and could not be updated to '27/.test(unit.note) && /Upload this year's logo/.test(unit.note), unit);
  check('… and the tagline the model put with the extras was not cut (no third reading)', asked.length === 2, asked.length);
  fb = fakeFb(); answer = function () { return Object.assign({}, READ_26, { yearBox: [] }); };
  unit = await build(fb, { sourceDocs: PREV_SOURCE });
  check('previous edition: a year read but not placed cannot be moved -> the name, with the note', unit.source === 'generated' && /could not be updated to '27/.test(unit.note), unit);
  fb = fakeFb(); answer = function () { return reading({ allText: 'ET Autotech summit \'26 ' + TAG, tagline: TAG }); };
  unit = await build(fb, { sourceDocs: PREV_SOURCE });
  check('previous edition: a reading that named no year but shows \'26 in its words is not let through silently', unit.source === 'generated' && /shows '26/.test(unit.note), unit);
  fb = fakeFb(); answer = null;
  unit = await build(fb, { sourceDocs: PREV_SOURCE });
  check('previous edition: no reading at all -> used, with a note that its year could not be checked', unit.source === 'previous-edition' && /could not be read to check its year/.test(unit.note) && /2026/.test(unit.note), unit);
  fb = fakeFb(); answer = verifying(READ_27);
  unit = await build(fb, { sourceDocs: PREV_SOURCE, eventMeta: { name: 'AutoTech Summit', start: '2027-03-04T09:00' } });
  check('previous edition: the event\'s year from its start when its name has none', /to '27/.test(unit.note), unit.note);

  /* ---------- 6. the owner's own logo wins, and is examined ---------- */
  fb = fakeFb(); fb.stored['events/autotech-summit-2027/logo/owner.svg'] = OWNER;
  const READ_OWNER = reading({ allText: 'ET Autotech summit ’27 ' + TAG, year: '’27', yearFull: '2027', yearBox: [450, 740, 760, 930], tagline: TAG });
  answer = function () { return READ_OWNER; }; asked = [];
  unit = await build(fb, { ownerLogoUrl: OWNER_URL, sourceDocs: PREV_SOURCE });
  check('owner: the uploaded \'27 logo is the unit, exactly as uploaded (its own address, its own size)', unit.source === 'owner' && unit.url === OWNER_URL && unit.width === 562 && unit.height === 280 && Object.keys(fb.stored).length === 1, unit);
  check('owner: it was examined (one reading, of the picture inside the SVG), and the note says what was found', asked.length === 1 && asked[0].width === 525 && /checked: it shows ’27, this edition's year/.test(unit.note) && /exactly as you uploaded it/.test(unit.note), [asked, unit.note]);
  check('owner: the previous edition\'s lock-up was not even fetched', !Object.keys(fb.stored).some(function (k) { return /generated/.test(k); }));
  check('owner: the hero it makes is the picture, never boxed', /<img class="rv-lu-img" src="https:\/\/storage\.googleapis\.com\/b\/events\/autotech-summit-2027\/logo\/owner\.svg"[^>]* width="562" height="280"/.test(gd.logoUnitImageHtml({ url: unit.url, width: unit.width, height: unit.height, mode: 'light' })) && !/plate/.test(unit.plate));

  fb = fakeFb(); fb.stored['events/x/logo/old.png'] = PREV;
  answer = verifying(READ_27); asked = [];
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/old.png' });
  svg = fb.stored[unit.storagePath] ? fb.stored[unit.storagePath].toString('utf8') : '';
  check('owner: an uploaded logo showing an earlier year gets the event\'s, in the same form (\'26 -> \'27), checked by a second reading', unit.source === 'owner' && /changed from '26 to '27/.test(unit.note) && asked.length === 2 && /<text\b[^>]*>7<\/text>/.test(svg) && unit.from === 'https://storage.googleapis.com/b/events/x/logo/old.png', unit);
  check('owner: … its own tagline kept', unit.height === 209);

  fb = fakeFb(); fb.stored['events/x/logo/old.png'] = PREV;
  answer = verifying(Object.assign({}, READ_26, { allText: 'ET Autotech summit \'25 ' + TAG, year: '\'25', yearFull: '2025' })); asked = [];
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/old.png', eventMeta: { name: 'AutoTech Summit 2025', start: null } });
  check('owner: a logo made for a later edition (\'26 on a 2025 event) is brought to the event\'s year too (\'25)', /changed from '26 to '25/.test(unit.note), unit.note);

  /* an owner's logo with a sponsor's line under its own lock-up and tagline: the line is cropped out */
  const W = 600, H = 300;
  let art = { width: W, height: H, data: Buffer.alloc(W * H * 4) };
  art = png.fillBox(art, { x: 40, y: 20, width: 520, height: 110 }, [228, 0, 43]);        // the lock-up
  art = png.fillBox(art, { x: 60, y: 150, width: 480, height: 16 }, [20, 20, 20]);         // its own tagline
  art = png.fillBox(art, { x: 180, y: 240, width: 240, height: 30 }, [0, 90, 200]);        // "Powered by Acme"
  const artBytes = png.encode(art);
  fb = fakeFb(); fb.stored['events/x/logo/sponsor.png'] = artBytes;
  answer = function (shown) {
    if (shown.height === H) return reading({ allText: 'SUMMIT 2027 OUR OWN LINE Powered by Acme', year: '2027', tagline: 'OUR OWN LINE', extras: 'Powered by Acme', extraBoxes: [{ text: 'Powered by Acme', box: [780, 280, 920, 720] }], ownBox: [50, 50, 570, 950] });
    return reading({ allText: 'SUMMIT 2027 OUR OWN LINE', year: '2027', tagline: 'OUR OWN LINE' });
  }; asked = [];
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/sponsor.png' });
  check('owner: a sponsor\'s line is cropped out of the uploaded logo, its own tagline kept', unit.source === 'owner' && unit.height < 230 && unit.height > 166 && /Powered by Acme/.test(unit.note) && /cropped out of your logo/.test(unit.note), unit);

  fb = fakeFb(); fb.stored['events/x/logo/old.png'] = PREV;
  answer = function () { return Object.assign({}, READ_26, { yearBox: [] }); };
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/old.png', sourceDocs: PREV_SOURCE });
  check('owner: a year that cannot be moved — the owner\'s logo still wins, as uploaded, and the owner is told', unit.source === 'owner' && unit.url === 'https://storage.googleapis.com/b/events/x/logo/old.png' && /shows '26, not '27/.test(unit.note), unit);
  fb = fakeFb(); fb.stored['events/x/logo/owner.svg'] = OWNER; answer = null;
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/owner.svg' });
  check('owner: no reading to be had — used as uploaded, and said so', unit.source === 'owner' && /could not be read/.test(unit.note) && unit.width === 562, unit);
  fb = fakeFb();
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/missing.png', sourceDocs: PREV_SOURCE });
  check('owner: an upload that cannot be had leaves the previous edition\'s unit to be examined — and the owner is told why their logo is not there', (unit.source === 'previous-edition' || unit.source === 'generated') && /Your uploaded logo could not be used here \(the file could not be read\)/.test(unit.note), unit);

  /* an owner's SVG that wraps a picture showing an earlier year: the picture inside is moved on */
  const wrapped26 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 417 209" width="417" height="209"><defs><image width="417" height="209" id="i" href="data:image/png;base64,' + PREV.toString('base64') + '"/></defs><use href="#i"/></svg>';
  fb = fakeFb(); fb.stored['events/x/logo/wrapped.svg'] = Buffer.from(wrapped26);
  answer = verifying(READ_27); asked = [];
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/wrapped.svg' });
  check('owner: an SVG wrapping a \'26 picture — the picture inside is moved on to \'27', unit.source === 'owner' && /changed from '26 to '27/.test(unit.note) && unit.width === 417 && /\.svg$/.test(unit.storagePath), unit);

  /* ---------- 7. the hero, the console and the editor ---------- */
  const typeUnit = gd.logoUnitHtml({ before: 'AutoTech', keyword: 'Summit', after: '' }, 'light', 'a note');
  check('the hero set in type carries the note the owner must see', /data-rv-logo-note="a note"/.test(typeUnit));
  const heroHtml = gd.heroHtml({ unit: typeUnit, tagline: 'Line', mode: 'light' });
  const pic = gd.logoUnitImageHtml({ url: OWNER_URL, width: 562, height: 280, mode: 'light' });
  const swapped = hooks.swapHeroUnit(heroHtml, pic);
  check('swapHeroUnit: the whole unit block (with the div inside it) is replaced, nothing else', swapped && swapped.indexOf(pic) !== -1 && swapped.indexOf('rv-lu-name') === -1 && /<h1 class="hero-tagline">Line<\/h1>/.test(swapped) && swapped.split('<div').length === heroHtml.split('<div').length - 1, swapped);
  check('swapHeroUnit: no unit, no change', hooks.swapHeroUnit('<section id="hero"></section>', pic) === null);
  const st = hooks.ownerLogoState({ logoUrl: OWNER_URL, designPlan: { design: { logoUnitSource: 'previous-edition', logoUnitUrl: 'https://x/generated/1-logo-unit.png' } }, site: { version: 3 } });
  check('ownerLogoState: an uploaded logo and a previous-edition unit need the repair; a saved site is seen', st.needsOwnerUnit && st.savedSite && st.aiDesigned);
  check('ownerLogoState: the owner\'s own unit, or no upload, or no AI design, do not',
    !hooks.ownerLogoState({ logoUrl: OWNER_URL, designPlan: { design: { logoUnitSource: 'owner', logoUnitUrl: OWNER_URL } } }).needsOwnerUnit &&
    !hooks.ownerLogoState({ designPlan: { design: { logoUnitSource: 'previous-edition' } } }).needsOwnerUnit && !hooks.ownerLogoState({ logoUrl: OWNER_URL }).needsOwnerUnit);
  /* a ported site (tech500) that only saved its section edges is not AI-designed: no logo unit is made for it */
  const edgesOnly = hooks.ownerLogoState({ logoUrl: OWNER_URL, designPlan: { design: { sectionEdges: 'smooth' } }, site: { version: 2 } });
  check('ownerLogoState: a design holding only the section edges is not an AI design', !edgesOnly.aiDesigned && !edgesOnly.needsOwnerUnit);
  check('aiDesignOf: edges alone -> null; a real design -> the design', hooks.aiDesignOf({ design: { sectionEdges: 'smooth' } }) === null &&
    !!hooks.aiDesignOf({ design: { sectionEdges: 'smooth', themeColor: '#123456' } }) && hooks.aiDesignOf(null) === null && hooks.aiDesignOf({}) === null);

  /* saveOwnerUnit: the design and the generated hero, in one transaction; never the saved site */
  const doc = { createdAt: 'x', name: 'AutoTech Summit 2027', logoUrl: OWNER_URL, site: { version: 3 }, designPlan: { design: { mode: 'light', logoUnitSource: 'previous-edition' } },
    generatedSections: [{ id: 'nav', html: '<nav></nav>' }, { id: 'hero', html: gd.heroHtml({ unit: gd.logoUnitImageHtml({ url: 'https://s/generated/1-logo-unit.png', width: 417, height: 165, note: 'old note', mode: 'light' }), mode: 'light' }) }] };
  let written = null;
  const dbFb = { db: { collection: function () { return { doc: function () { return {}; } }; },
    runTransaction: function (fn) { return fn({ get: function () { return Promise.resolve({ exists: true, data: function () { return doc; } }); }, update: function (ref, patch) { written = patch; } }); } } };
  const res = await hooks.saveOwnerUnit(dbFb, 'autotech-summit-2027', { url: OWNER_URL, width: 562, height: 280, source: 'owner', from: OWNER_URL, note: 'checked', heroMode: 'light' }, { heroNote: false });
  const newHero = written && written.generatedSections && written.generatedSections[1].html;
  check('saveOwnerUnit: the design\'s unit is the owner\'s', written && written['designPlan.design.logoUnitUrl'] === OWNER_URL && written['designPlan.design.logoUnitSource'] === 'owner' && written['designPlan.design.logoUnitNote'] === 'checked' && written['designPlan.design.logoUnitWidth'] === 562, written);
  check('saveOwnerUnit: the generated hero shows it (src, width, height) and no note', res.heroUpdated && res.savedSite && /src="https:\/\/storage\.googleapis\.com\/b\/events\/autotech-summit-2027\/logo\/owner\.svg" alt="AutoTech Summit 2027" width="562" height="280"/.test(newHero) && !/data-rv-logo-note/.test(newHero), newHero);
  check('saveOwnerUnit: nothing but the design and the generated sections is written (never the saved site)', written && Object.keys(written).every(function (k) { return /^designPlan\.design\.logoUnit|^generatedSections$|^updatedAt$/.test(k); }), Object.keys(written || {}));

  /* ---------- 8. review: the owner's logo is never passed over silently, and never collapses ---------- */
  /* an SVG that could run code is not used; the owner is told, on whatever stands in its place */
  fb = fakeFb(); fb.stored['events/x/logo/active.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><script>alert(1)</script><text>Summit 2027</text></svg>');
  answer = null;
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/active.svg' });
  check('owner: an SVG that could run code is never the unit, and the note says why', unit.source !== 'owner' && unit.url !== 'https://storage.googleapis.com/b/events/x/logo/active.svg' && /contains scripts or embedded content/.test(unit.note), unit);

  /* a logo over 3 MB (an upload may be 8 MB): used as uploaded, unexamined, and said so — not dropped for the previous edition's */
  const BW = 1100, BH = 1000, big = { width: BW, height: BH, data: require('crypto').randomBytes(BW * BH * 4) };
  const bigBytes = png.encode(big);
  fb = fakeFb(); fb.stored['events/x/logo/big.png'] = bigBytes; answer = function () { return READ_27; }; asked = [];
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/big.png', sourceDocs: PREV_SOURCE });
  check('owner: a ' + (bigBytes.length / 1048576).toFixed(1) + ' MB logo still wins, as uploaded, at its own size, with a note', bigBytes.length > 3 * 1048576 && unit.source === 'owner' && unit.url === 'https://storage.googleapis.com/b/events/x/logo/big.png' && unit.width === BW && unit.height === BH && /too large a file/.test(unit.note) && asked.length === 0, [unit.source, unit.note, asked.length]);

  /* an SVG with a viewBox and no size of its own: stored once with its size written in, nothing else changed */
  const unsized = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text x="10" y="100" fill="#e4002b">Summit</text></svg>';
  fb = fakeFb(); fb.stored['events/x/logo/unsized.svg'] = Buffer.from(unsized);
  answer = function () { return reading({ allText: 'Summit' }); };
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/unsized.svg' });
  const sizedOut = fb.stored[unit.storagePath] ? fb.stored[unit.storagePath].toString('utf8') : '';
  check('owner: an unsized SVG is given its own size (it would collapse in the hero), its drawing untouched', unit.source === 'owner' && /generated\/t-logo-unit\.svg$/.test(unit.storagePath) && /<svg [^>]*width="400" height="200"/.test(sizedOut) && sizedOut.indexOf('<text x="10" y="100" fill="#e4002b">Summit</text>') !== -1 && unit.width === 400, [unit.storagePath, sizedOut.slice(0, 120)]);

  /* the note says what was found, not "this edition's year" for any year */
  fb = fakeFb(); fb.stored['events/x/logo/old.png'] = PREV;
  answer = function () { return Object.assign({}, READ_26, { allText: 'ET Autotech summit \'19 ' + TAG, year: '\'19', yearFull: '2019' }); };
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/old.png' });
  check('owner: a year that is not a recent edition\'s is left, and not called this edition\'s', unit.url === 'https://storage.googleapis.com/b/events/x/logo/old.png' && /shows '19, which was left as it is/.test(unit.note) && !/this edition's year/.test(unit.note), unit.note);
  fb = fakeFb(); fb.stored['events/x/logo/old.png'] = PREV; answer = function () { return READ_26; };
  unit = await build(fb, { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/old.png', eventMeta: { name: 'AutoTech Summit', start: null } });
  check('owner: no event year to compare with — left as it is, and said so', unit.url === 'https://storage.googleapis.com/b/events/x/logo/old.png' && /event's own year could not be told/.test(unit.note), unit.note);

  /* the generated hero is not given a logo drawn for the other ground (it would vanish); a retried transaction reports its last run */
  const darkHeroDoc = JSON.parse(JSON.stringify(doc)); written = null;
  let runs = 0;
  const retryFb = { db: { collection: function () { return { doc: function () { return {}; } }; },
    runTransaction: function (fn) {
      const tx = { get: function () { return Promise.resolve({ exists: true, data: function () { return runs === 1 ? darkHeroDoc : Object.assign({}, darkHeroDoc, { generatedSections: [{ id: 'nav', html: '' }] }); } }); }, update: function (ref, patch) { written = patch; } };
      runs++;
      return fn(tx).then(function () { runs++; return fn(tx); });
    } } };
  const clashRes = await hooks.saveOwnerUnit(retryFb, 'autotech-summit-2027', { url: OWNER_URL, width: 562, height: 280, source: 'owner', from: OWNER_URL, note: '', heroMode: 'dark' }, { heroNote: false });
  const runsSeen = runs;
  runs = 0; written = null;
  const clashFb = { db: { collection: function () { return { doc: function () { return {}; } }; },
    runTransaction: function (fn) { return fn({ get: function () { return Promise.resolve({ exists: true, data: function () { return darkHeroDoc; } }); }, update: function (ref, patch) { written = patch; } }); } } };
  const clash = await hooks.saveOwnerUnit(clashFb, 'autotech-summit-2027', { url: OWNER_URL, width: 562, height: 280, source: 'owner', from: OWNER_URL, note: '', heroMode: 'dark' }, { heroNote: false });
  check('saveOwnerUnit: tone clash — design written, generated hero left, toneClash "dark"', clash.toneClash === 'dark' && !clash.heroUpdated && written && !written.generatedSections && written['designPlan.design.logoUnitHeroMode'] === 'dark', [clash, Object.keys(written || {})]);
  check('saveOwnerUnit: a transaction run twice reports only its last run (the first saw a clash, the second no hero)', runsSeen === 2 && clashRes.heroUpdated === false && clashRes.toneClash === '', clashRes);

  finish();
})().catch(function (e) { check('the checks ran', false, e && e.stack); finish(); });

function finish() {
  if (failed) { console.error('owner-logo: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('owner-logo: all ' + passed + ' checks passed');
}
