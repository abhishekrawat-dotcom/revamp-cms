/* node functions/lib/speaker-photos.test.js — speakers' photos found in a brochure (lib/speaker-photos.js) and the
   console's Paste a list and Add photos (edit-event-speaker-tools.js; the owner, 11 Nov 2026): what of ETB2B AI's
   answer is kept, the route's checks with a stand-in model, a pasted sheet read into rows, and a photo's file name
   matched to its speaker. No network, no model, no browser. Exits 1 on any failure. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 500) : '') + '\n');
}
['log', 'info', 'warn', 'error'].forEach(function (k) { console[k] = function () {}; });

var llm = require('./llm');
var P = require('./speaker-photos'), T = P._test;
var NAMES = ['Naven Singh', 'Bruce Schneier', 'Jaya Kishori'];
var PAGES = [{ w: 1000, h: 1400 }, { w: 1000, h: 1400 }];

/* 1. what is kept */
var r = T.cleanFound({ found: [
  { name: 'naven  SINGH', page: 1, box: [100, 100, 300, 260] },
  { name: 'Someone Else', page: 1, box: [100, 400, 300, 560] },
  { name: 'Bruce Schneier', page: 3, box: [100, 100, 300, 260] },
  { name: 'Jaya Kishori', page: 2, box: [0, 0, 1000, 1000] }
] }, NAMES, PAGES);
check('1 a listed name (any case or spacing) on a page sent, with a photo-sized box, is kept as fractions of the page', r.found.length === 1 && r.found[0].name === 'Naven Singh' && r.found[0].page === 1 &&
  r.found[0].box.x0 === 0.1 && r.found[0].box.y0 === 0.1 && r.found[0].box.x1 === 0.26 && r.found[0].box.y1 === 0.3, r.found);
check('1 a name not sent, a page not sent and the whole page are left out, each with why', r.dropped.map(function (d) { return d.why; }).join('|') === 'not a speaker of this event|no such page|too large to be one person\'s photo', r.dropped);
r = T.cleanFound({ found: [{ name: 'Naven Singh', page: 1, box: [100, 100, 104, 104] }, { name: 'Bruce Schneier', page: 1, box: [100, 100, 900, 120] }, { name: 'Jaya Kishori', page: 1, box: [5, 5, 'x', 9] }] }, NAMES, PAGES);
check('1 a dot, a thin strip and a box that is not one are left out', r.found.length === 0 && r.dropped.map(function (d) { return d.why; }).join('|') === 'too small to be a photo|not the shape of a photo|no box', r.dropped);
r = T.cleanFound({ found: [{ name: 'Naven Singh', page: 1, box: [100, 100, 300, 260] }, { name: 'Bruce Schneier', page: 1, box: [105, 102, 302, 262] }, { name: 'Jaya Kishori', page: 2, box: [400, 400, 600, 560] }] }, NAMES, PAGES);
check('1 one photo given for two names: both left out (whose it is was not known); the rest kept', r.found.length === 1 && r.found[0].name === 'Jaya Kishori' &&
  r.dropped.filter(function (d) { return /another speaker/.test(d.why); }).length === 2, r);
r = T.cleanFound({ found: [{ name: 'Naven Singh', page: 1, box: [100, 100, 300, 260] }, { name: 'Naven Singh', page: 2, box: [100, 100, 300, 260] }] }, NAMES, PAGES);
check('1 one photo per name: the first', r.found.length === 1 && r.found[0].page === 1);
check('1 an answer that is not one: nothing', T.cleanFound(null, NAMES, PAGES).found.length === 0 && T.cleanFound({ found: 'x' }, NAMES, PAGES).found.length === 0);
var prompt = T.promptFor(NAMES, 2, 'CISO Secufest 2027');
check('1 the prompt: the names as data, the box\'s form, never a guess, never a logo or a crowd', /1\. Naven Singh\n2\. Bruce Schneier/.test(prompt) && /\[ymin, xmin, ymax, xmax\], each from 0 to 1000/.test(prompt) &&
  /Never guess/.test(prompt) && /never a logo, an icon, a group photo, a crowd/.test(prompt) && /"CISO Secufest 2027"/.test(prompt));
check('1 the answer\'s schema needs name, page and box', JSON.stringify(T.SCHEMA.properties.found.items.required) === '["name","page","box"]');
check('1 Gemini is asked first for this route (it marks places on a picture), Claude after it', llm.PROFILES['photo-find'] && llm.PROFILES['photo-find'].prefer === 'gemini');

/* 2. the route */
var JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(60, 7)]).toString('base64');
var sent = null, said = null, usage = 0;
var realCall = llm.callJson;
llm.callJson = function (prompt, schema, opts) { sent = { prompt: prompt, opts: opts }; return Promise.resolve({ parsed: { found: [{ name: 'Bruce Schneier', page: 2, box: [200, 100, 400, 260] }] }, provider: 'gemini' }); };
function res() { var r0 = { status: 0, body: null, done: null }; r0.done = new Promise(function (ok) { r0.ok = ok; }); return r0; }
function send(r0) { return function (resObj, status, body) { r0.status = status; r0.body = body; r0.ok(); }; }
function run(body) {
  var r0 = res();
  require('./http').sendJson = send(r0);
  P.wire({
    withAdminBody: function (req, rs, max, cb) { cb({ db: {} }, { email: 'asha@timesinternet.in' }, body); },
    eventIdOr400: function (rs, v) { return /^[a-z0-9-]+$/.test(String(v || '')) ? v : (send(r0)(rs, 400, { error: 'Invalid eventId.' }), null); },
    loadLiveEvent: function () { return Promise.resolve({ name: 'QA Summit' }); },
    aiUsageRecorder: function () { return function () { usage++; }; },
    sendAiFailure: function (rs, ai) { send(r0)(rs, 502, { error: 'ai' }); },
    sendFailure: function (rs) { send(r0)(rs, 500, { error: 'x' }); }
  });
  P.handleFind({}, {});
  return r0.done.then(function () { return r0; });
}
(async function () {
  var r2 = await run({ eventId: 'qa-x', names: NAMES, pages: [{ data: JPEG, w: 1000, h: 1400 }, { data: 'data:image/jpeg;base64,' + JPEG, w: 1000, h: 1400 }] });
  check('2 the pages go to the model as pictures, with the names and the event\'s name, on route photo-find', r2.status === 200 && sent.opts.route === 'photo-find' && sent.opts.images.length === 2 &&
    sent.opts.images[0].mimeType === 'image/jpeg' && /QA Summit/.test(sent.prompt) && /Jaya Kishori/.test(sent.prompt), r2);
  check('2 …the answer as kept', r2.body.found.length === 1 && r2.body.found[0].name === 'Bruce Schneier' && r2.body.found[0].page === 2 && r2.body.provider === 'gemini', r2.body);
  var r3 = await run({ eventId: 'qa-x', names: NAMES, pages: [1, 2, 3, 4, 5, 6, 7].map(function () { return { data: JPEG, w: 10, h: 10 }; }) });
  check('2 seven pages at once: refused', r3.status === 400 && r3.body.code === 'bad-pages');
  var r4 = await run({ eventId: 'qa-x', names: NAMES, pages: [{ data: Buffer.from('<svg/>').toString('base64'), w: 1, h: 1 }] });
  check('2 a page that is not a JPEG: refused', r4.status === 400 && r4.body.code === 'bad-page');
  var r5 = await run({ eventId: 'qa-x', names: [], pages: [{ data: JPEG }] });
  check('2 no names: refused', r5.status === 400 && r5.body.code === 'no-names');
  llm.callJson = realCall;

  /* 3. the console's tools (edit-event-speaker-tools.js) */
  var SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event-speaker-tools.js'), 'utf8');
  var win = { document: {} };
  vm.runInNewContext(SRC, { window: win, URL: {}, Image: function () {}, Promise: Promise });
  var ST = win.EditEventSpeakerTools._test;
  var rows = ST.parseList('Name\tDesignation\tCompany\tTrack\nNaven Singh\tGroup CISO\tAcme Bank\tKeynote\nBruce Schneier\tSecurity Technologist\t\t\n\n');
  check('3 rows from a sheet: a heading row read as headings, tabs as columns, an empty company kept empty', rows.length === 2 && rows[0].name === 'Naven Singh' && rows[0].designation === 'Group CISO' &&
    rows[0].company === 'Acme Bank' && rows[0].group === 'Keynote' && rows[1].company === '', rows);
  rows = ST.parseList('Company\tFull name\tTitle\nAcme Bank\tNaven Singh\tCISO');
  check('3 headings in any order', rows.length === 1 && rows[0].name === 'Naven Singh' && rows[0].company === 'Acme Bank' && rows[0].designation === 'CISO', rows);
  rows = ST.parseList('Jaya Kishore Reddy, CTO, Co-founder, Yellow.ai\nRobin Uthappa\nKalki, Speaker');
  check('3 typed rows: the first comma ends the name, the last begins the company (a designation may hold commas)', rows.length === 3 && rows[0].designation === 'CTO, Co-founder' && rows[0].company === 'Yellow.ai' &&
    rows[1].name === 'Robin Uthappa' && rows[1].designation === '' && rows[2].designation === 'Speaker', rows);
  var SP = [{ id: 'a', name: 'Dr. Naven Kumar Singh' }, { id: 'b', name: 'Jaya Kishori' }, { id: 'c', name: 'Naven Sharma' }, { id: 'd', name: 'Brett Lee' }];
  function m(f) { var s = ST.matchFile(f, SP); return s ? s.id : null; }
  check('3 a photo\'s file name finds its speaker: any case, dashes or spaces, a title, a number or a word like "photo"',
    m('naven-kumar-singh.jpg') === 'a' && m('Naven Singh.png') === 'a' && m('jaya_kishori_photo 2.jpeg') === 'b' && m('BrettLee.jpg') === 'd' && m('dr-naven-kumar-singh-headshot.webp') === 'a');
  check('3 …only where exactly one speaker fits', m('naven.jpg') === null && m('kishori.jpg') === null && m('IMG_2031.jpg') === null, [m('naven.jpg'), m('kishori.jpg'), m('IMG_2031.jpg')]);

  process.stdout.write('speaker-photos: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stderr.write('CRASH ' + (e && e.stack || e) + '\n'); process.exit(1); });
