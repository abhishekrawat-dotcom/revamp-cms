// node functions/lib/logo-stacked.test.js — a previous edition's lock-up stacked with its sponsors, and
// never a silent fallback.
//
// ETCIO Annual Conclave 2027 (created 21 Oct 2026) got its name drawn in place of the 2026 edition's lock-up,
// with no word to the owner. That lock-up (fixtures/logo-crop/etcio-annual-conclave-2026.svg, 251 x 400,
// drawn as outlines) has "kyndryl / PRESENTS" above the event's own lock-up and seven partners in four rows
// with their captions below it; it was refused for being taller than wide before it was ever looked at, and
// the refusal left no note. Here: it is taken, cut down to the event's own lock-up and its tagline (PRESENTS,
// which shares its lines with the emblem, emptied), and every path that ends without it tells the owner why.
// No network: the model's readings are the ones it gave on 21 Oct 2026 (…readings.json), replayed.
const fs = require('fs'), path = require('path');

/* replayed readings and downloads: api.js takes callGeminiJson and safeFetch when it is loaded */
const gemini = require('./gemini');
var answers = null, asked = 0;
gemini.callGeminiJson = function (prompt, schema, opts) {
  asked++;
  var shown = require('./png-lite').decode(Buffer.from(opts.images[0].data, 'base64'));
  var answer = answers && answers(shown, asked);
  if (answer && answer.code) return Promise.resolve({ error: 'stubbed failure', code: answer.code });
  return Promise.resolve(answer ? { parsed: answer } : { error: 'no reading', code: 'ai-config' });
};
const safeFetchModule = require('./safe-fetch');
var downloads = {}, fetchDelayMs = 0;
safeFetchModule.safeFetch = function (url) {
  var d = downloads[url];
  return new Promise(function (resolve) { setTimeout(resolve, fetchDelayMs); }).then(function () {
    if (d instanceof Error) throw d;
    return d ? { status: 200, body: d } : { status: 404, body: Buffer.alloc(0) };
  });
};
const hooks = require('./api.js')._testHooks;
const png = require('./png-lite');
const sy = require('./svg-year');
const lu = require('./logo-unit');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

var FIX = path.join(__dirname, 'fixtures', 'logo-crop');
var LOCKUP = fs.readFileSync(path.join(FIX, 'etcio-annual-conclave-2026.svg'), 'utf8');
var READINGS = JSON.parse(fs.readFileSync(path.join(FIX, 'etcio-annual-conclave-2026.readings.json'), 'utf8'));
var LOGO_URL = 'https://img.etb2bimg.com/files/retail_files/file_17779592403936_Logo_15_1_.svg';
var STUDIOS_URL = 'https://img.etb2bimg.com/files/cp/e1d1320fbb6d090eda0a.png';
/* the page's own two candidates, as ingest-source kept them */
var SOURCE = { type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/annual-conclave-2026', fetchedAt: '2026-10-21T07:22:05.226Z',
  editionHints: { years: ['2026'] },
  logoCandidates: [{ url: LOGO_URL, kind: 'img', score: 210, cls: 'logo', alt: '' }, { url: STUDIOS_URL, kind: 'img', score: 11, cls: '', alt: 'ETCIO Studios' }] };
/* a 32 x 32 PNG, as the "ETCIO Studios" candidate is */
var TINY = png.encode({ width: 32, height: 32, data: Buffer.alloc(32 * 32 * 4, 255) });

/* in the drawing's units (1333 wide; the readings' pictures are 1000 px wide, 0.75 px a unit): kyndryl ends at
   ~173, PRESENTS stands at 232-263 beside the emblem's top (235), the rule under the tagline ends at ~905,
   "CO-PRESENTED BY" starts at ~965 */
var U = 1333 / 1000;

function stubFb(failSave) {
  var stored = {};
  return { stored: stored, fb: { bucket: { name: 'b', file: function (p) { return {
    save: function (buf) { if (failSave) return Promise.reject(new Error('storage is down')); stored[p] = buf; return Promise.resolve(); },
    makePublic: function () { return Promise.resolve(); } }; } } } };
}
function build(o) {
  o = o || {};
  var s = stubFb(o.failSave);
  asked = 0;
  var opts = Object.assign({ eventMeta: { name: 'ETCIO Annual Conclave 2027', start: '2027-05-21T10:00' }, ownerLogoUrl: '', briefTexts: [],
    design: { mode: 'light', headingFont: 'Inter', themeColor: '#5b2a86' }, stamp: 't', sourceDocs: [SOURCE] }, o.opts || {});
  return (o.inTime ? hooks.logoUnitInTime : hooks.buildLogoUnit)(s.fb, 'etcio-annual-conclave-2027', opts).then(function (unit) {
    return { unit: unit, svg: unit.storagePath && s.stored[unit.storagePath] ? s.stored[unit.storagePath].toString('utf8') : '' };
  });
}
var NOTE = /^The previous edition's logo could not be used: .+\. Upload this year's logo under Event logo in the event's Basics, or select this and use Replace image\.$/;

(async function () {
  /* ---- it is a picture to look at, not one to refuse ---- */
  var info = lu.imageInfo(Buffer.from(LOCKUP));
  check('the 2026 lock-up is 251 x 400: taller than wide', info.type === 'svg' && info.width === 251 && info.height === 400 && lu.plausibleUnit(info) === 'taller than it is wide', JSON.stringify(info));
  check('stackedUnit: it is only too tall — a lock-up stacked with its sponsors', lu.stackedUnit(info) === true);
  check('stackedUnit: a plausible unit is not stacked, nor a sliver five times as tall as wide, nor a small square',
    !lu.stackedUnit({ type: 'svg', width: 600, height: 200 }) && !lu.stackedUnit({ type: 'png', width: 200, height: 1000, alpha: true }) && !lu.stackedUnit({ type: 'png', width: 100, height: 100, alpha: true }));

  /* ---- the cut, with each of the two readings the model gave ---- */
  var clear = png.decode((await hooks.rasterise(LOCKUP, { clear: true })).png);
  var grey = await hooks.rasterise(LOCKUP);
  for (var i = 0; i < READINGS.first.length; i++) {
    answers = function () { return READINGS.first[i]; };
    var read = await hooks.readLogoPicture('x', { bytes: grey.png, info: { type: 'png', mime: 'image/png', width: grey.width, height: grey.height } }, null, 0, 'ETCIO Annual Conclave 2027');
    var label = 'reading ' + (i + 1) + ': ';
    check(label + 'the tagline is the event\'s own, not an extra', read.tagline === 'LEAD THE SHIFT : FROM RESILIENCE TO REINVENTION' && read.extraBoxes.length === 5);
    var keep = hooks.ownUnitBox(clear, read);
    check(label + 'cut below kyndryl and above the emblem, and between the rule under the tagline and the first partners\' row',
      keep && keep.y > 130 && keep.y < 176 && keep.y + keep.height > 679 && keep.y + keep.height < 724, JSON.stringify(keep));
    check(label + 'PRESENTS, beside the emblem\'s top, is emptied (and nothing else)', keep && keep.erase && keep.erase.length >= 1 &&
      keep.erase.every(function (b) { return b.x >= 405 && b.x + b.width <= 595 && b.y >= 170 && b.y + b.height <= 202; }), JSON.stringify(keep && keep.erase));
    var cut = await hooks.cropSvgToOwnUnit(LOCKUP, read);
    var vb = cut && sy.viewBoxOf(cut);
    check(label + 'the drawing is cut by its viewBox to the lock-up and its tagline', vb && vb.y > 173 && vb.y < 235 && vb.y + vb.height > 905 && vb.y + vb.height < 965 && vb.x < 1 && vb.width > 1330, JSON.stringify(vb));
    var shapes = cut ? sy.shapesIn(cut) : [];
    check(label + 'PRESENTS\'s shapes are gone from the file, the emblem\'s are not', cut &&
      !shapes.some(function (s) { return s.box && s.box.x >= 410 * U && s.box.x + s.box.width <= 590 * U && s.box.y >= 170 * U && s.box.y + s.box.height <= 202 * U; }) &&
      shapes.some(function (s) { return s.box && s.box.y < 200 * U && s.box.x < 300 * U; }));
    check(label + 'what is left is a plausible logo unit, a quarter of the height it was', cut && lu.plausibleUnit(lu.imageInfo(Buffer.from(cut))) === '' && lu.imageInfo(Buffer.from(cut)).height < 150, cut && JSON.stringify(lu.imageInfo(Buffer.from(cut))));
    var drawn = cut && png.decode((await hooks.rasterise(cut, { clear: true })).png);
    var rows = drawn ? png.inkRuns(png.inkProfile(drawn, 'y', null)) : [];
    check(label + 'drawn again: the emblem with the name, the rule, the tagline, the rule — four rows of lettering, nothing below', rows.length === 4, JSON.stringify(rows));
  }

  /* ---- end to end: buildLogoUnit with the real page's candidates ---- */
  downloads = {}; downloads[LOGO_URL] = Buffer.from(LOCKUP); downloads[STUDIOS_URL] = TINY;
  var SECOND = READINGS.second;
  answers = function (shown) { return shown.height > 1000 ? READINGS.first[1] : SECOND; };
  var e2e = await build();
  check('end to end: read twice (the whole stacked lock-up, then the cut)', asked === 2, asked);
  check('end to end: the previous edition\'s unit, cut to its own lock-up', e2e.unit.source === 'previous-edition' && e2e.unit.from === SOURCE.url && Math.round(e2e.unit.width) === 251 && e2e.unit.height > 120 && e2e.unit.height < 150, JSON.stringify(e2e.unit));
  check('end to end: the owner is told the partners were cropped out', /kyndryl PRESENTS.*belonged to the previous edition and was cropped out/.test(e2e.unit.note), e2e.unit.note);
  check('end to end: stored as the cut drawing, still outlines and gradients, nothing boxed', /<svg\b[^>]*viewBox="[-\d.]+ 2\d\d\.\d+ 13\d\d/.test(e2e.svg) && /linearGradient/.test(e2e.svg) && !/<rect\b/.test(e2e.svg.slice(0, 2000)), (/<svg\b[^>]*>/.exec(e2e.svg) || [''])[0]);

  /* ---- every way it can fail ends with the owner told ---- */
  answers = function () { return READINGS.first[0]; };            // the cut, read again, still "has" extras
  var notClean = await build();
  check('a cut the second reading still finds extras in: the name is drawn, and the owner is told why (it was silent)',
    notClean.unit.source === 'generated' && NOTE.test(notClean.unit.note) && /stacked with its sponsors' marks, and they could not be cropped out cleanly/.test(notClean.unit.note), JSON.stringify(notClean.unit));

  answers = function (shown) { return shown.height > 1000 ? READINGS.first[1] : Object.assign({}, SECOND, { allText: 'ET CIO annual', tagline: '' }); };
  var lostTagline = await build();
  check('a cut that lost the event\'s own tagline is not kept: the owner is told', lostTagline.unit.source === 'generated' && NOTE.test(lostTagline.unit.note), lostTagline.unit.note);

  answers = function () { return Object.assign({}, READINGS.first[0], { extras: '', extraBoxes: [], ownBox: [] }); };
  var nothingToCut = await build();
  check('a tall picture read as having no extras is not used whole either: the owner is told', nothingToCut.unit.source === 'generated' && NOTE.test(nothingToCut.unit.note) && /taller than it is wide \(251 × 400\)/.test(nothingToCut.unit.note), nothingToCut.unit.note);

  answers = function () { return null; };
  var unread = await build();
  check('no reading to be had: the stacked lock-up is never used whole, and the owner is told why', unread.unit.source === 'generated' && NOTE.test(unread.unit.note) && /could not be read in time/.test(unread.unit.note), unread.unit.note);

  answers = function (shown, n) { return n === 1 ? { code: 'ai-timeout' } : shown.height > 1000 ? READINGS.first[1] : SECOND; };
  var retried = await build();
  check('a reading that ran out of time is asked once more, and the unit made', asked === 3 && retried.unit.source === 'previous-edition', asked + ' ' + JSON.stringify(retried.unit));

  answers = function () { return { code: 'ai-timeout' }; };
  var timedOut = await build();
  check('…asked up to three times only: three timeouts and the owner is told', asked === 3 && timedOut.unit.source === 'generated' && NOTE.test(timedOut.unit.note), asked + ' ' + timedOut.unit.note);

  downloads = {};
  var gone = await build();
  check('its picture could not be downloaded: the owner is told, with the answer', gone.unit.source === 'generated' && NOTE.test(gone.unit.note) && /could not be downloaded \(the site answered 404\)/.test(gone.unit.note), gone.unit.note);

  downloads = {}; downloads[LOGO_URL] = new Error('socket hang up');
  var broken = await build();
  check('its download failed: the owner is told', broken.unit.source === 'generated' && NOTE.test(broken.unit.note) && /socket hang up/.test(broken.unit.note), broken.unit.note);

  downloads = {}; downloads[STUDIOS_URL] = TINY;
  var tiny = await build({ opts: { sourceDocs: [Object.assign({}, SOURCE, { logoCandidates: [SOURCE.logoCandidates[1]] })] } });
  check('only a picture that is no logo unit (32 px): the owner is told what it was', tiny.unit.source === 'generated' && NOTE.test(tiny.unit.note) && /too small to be a logo unit \(32 px wide\)/.test(tiny.unit.note), tiny.unit.note);

  var wide = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 100" width="2000" height="100"><path d="M0 0h2000v100H0z" fill="#000"/></svg>';
  downloads = {}; downloads[LOGO_URL] = Buffer.from(wide);
  var strip = await build();
  check('a strip, far wider than a unit: the owner is told', strip.unit.source === 'generated' && /a strip, far wider than a logo unit/.test(strip.unit.note), strip.unit.note);

  var active = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="600" height="200" onload="alert(1)"><path d="M0 0h600v200H0z"/></svg>';
  downloads = {}; downloads[LOGO_URL] = Buffer.from(active);
  var runs = await build();
  check('an SVG that could run code: the owner is told', runs.unit.source === 'generated' && /contains scripts or embedded content/.test(runs.unit.note), runs.unit.note);

  var inline = await build({ opts: { sourceDocs: [Object.assign({}, SOURCE, { logoCandidates: [{ kind: 'inline-svg', svg: '<svg viewBox="0 0 600 200"><use href="#elsewhere"/></svg>' }] })] } });
  check('an inline SVG that leans on its page: the owner is told', inline.unit.source === 'generated' && /drawn into the page and cannot be shown on its own/.test(inline.unit.note), inline.unit.note);

  downloads = {}; downloads[LOGO_URL] = Buffer.from(LOCKUP);
  answers = function (shown) { return shown.height > 1000 ? READINGS.first[1] : SECOND; };
  var storeFails = await build({ failSave: true });
  check('something going wrong while it is examined (storage down): the owner is told, not left with nothing',
    storeFails.unit.source === '' && NOTE.test(storeFails.unit.note) && /something went wrong while it was examined \(storage is down\)/.test(storeFails.unit.note), JSON.stringify(storeFails.unit));

  var nothingSaid = await build({ opts: { found: Promise.resolve({ unit: null, note: '' }) } });
  check('the last guard: a previous edition\'s logo named, the name drawn, no reason recorded — a note all the same', nothingSaid.unit.source === 'generated' && NOTE.test(nothingSaid.unit.note), nothingSaid.unit.note);

  var noEdition = await build({ opts: { sourceDocs: [] } });
  check('no previous edition named: the name drawn, and nothing to say about one', noEdition.unit.source === 'generated' && noEdition.unit.note === '', noEdition.unit.note);

  fetchDelayMs = 3000;
  var late = await build({ inTime: true, opts: { deadlineAt: Date.now() + 9000 } });
  fetchDelayMs = 0;
  check('not ready before the plan\'s deadline: the hero sets the name in type, and the owner is told why', late.unit.source === '' && NOTE.test(late.unit.note) && /not enough time/.test(late.unit.note), JSON.stringify(late.unit));
  /* what was still running when the deadline was met ends on its own */
  await new Promise(function (r) { setTimeout(r, 3500); });

  var refusedOwner = await build({ opts: { ownerLogoUrl: 'https://storage.googleapis.com/b/events/x/logo/missing.png', sourceDocs: [Object.assign({}, SOURCE, { logoCandidates: [SOURCE.logoCandidates[1]] })] } });
  check('an upload that could not be used and a previous logo that could not either: both said', /Your uploaded logo could not be used/.test(refusedOwner.unit.note) && /The previous edition's logo could not be used/.test(refusedOwner.unit.note), refusedOwner.unit.note);

  /* ---- ETCISO Annual Conclave 2026: the same stacked shape, drawn as outlines that carry three small
     pictures (the Chrome Enterprise sponsor's ball, 51 x 56 each). Only that piece was read — it read as
     nothing — so the sponsors were never seen: the stacked lock-up was refused, a plain one would have kept
     them. The whole drawing is read now. Readings: the model's, 21 Oct 2026. ---- */
  var CISO = fs.readFileSync(path.join(FIX, 'etciso-annual-conclave-2026.svg'), 'utf8');
  var CISO_READ = JSON.parse(fs.readFileSync(path.join(FIX, 'etciso-annual-conclave-2026.readings.json'), 'utf8'));
  var shownSizes = [];
  downloads = {}; downloads[CISO_READ.logo] = Buffer.from(CISO);
  answers = function (shown) { shownSizes.push(shown.width + 'x' + shown.height); return shown.height > shown.width ? CISO_READ.first : CISO_READ.second; };
  var ciso = await build({ opts: { eventMeta: { name: 'ETCISO Annual Conclave 2027', start: '2027-05-21T10:00' },
    sourceDocs: [{ type: 'previousEdition', url: CISO_READ.source, fetchedAt: '2026-10-21T00:00:00Z', editionHints: {}, logoCandidates: [{ url: CISO_READ.logo, kind: 'img', score: 165, cls: 'logo' }] }] } });
  check('ETCISO: the whole drawing is read, not the small picture inside it', shownSizes.length === 2 && +shownSizes[0].split('x')[0] >= 500, shownSizes.join(' '));
  check('ETCISO: the previous edition\'s unit, cut to its lock-up and tagline', ciso.unit.source === 'previous-edition' && ciso.unit.width > 200 && ciso.unit.height > 100 && ciso.unit.height < 140, JSON.stringify(ciso.unit));
  var cisoDrawn = ciso.svg && png.decode((await hooks.rasterise(ciso.svg, { clear: true })).png);
  var cisoRows = cisoDrawn ? png.inkRuns(png.inkProfile(cisoDrawn, 'y', null)) : [];
  check('ETCISO: drawn again, nothing below the tagline (the rule, then the tagline, last)', cisoRows.length >= 2 && cisoDrawn.height - cisoRows[cisoRows.length - 1].to < cisoDrawn.height * 0.06, JSON.stringify(cisoRows));
  check('ETCISO: a long list of partners is cut at a word in the note, never inside one', /^“chrome enterprise Presents .* …” belonged to the previous edition and was cropped out/.test(ciso.unit.note) && !/ W”/.test(ciso.unit.note), ciso.unit.note);

  /* ---- plan-structure starts it while the plan is written ---- */
  var api = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
  var plan = api.slice(api.indexOf('var logoFound = foundLogoUnit('), api.indexOf('var unitJob = logoUnitInTime('));
  check('plan-structure: the logo unit is looked for before the plan is asked for, and the plan\'s run is given it', plan.indexOf('llm.callJson(prompt, DESIGN_PLAN_SCHEMA') !== -1 && /found: logoFound/.test(api.slice(api.indexOf('var unitJob = logoUnitInTime('), api.indexOf('var unitJob = logoUnitInTime(') + 200)));
  finish();
})().catch(function (e) { check('the checks ran', false, e.stack); finish(); });

function finish() {
  if (failed) { console.error('logo-stacked: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('logo-stacked: all ' + passed + ' checks passed');
  process.exit(0);
}
