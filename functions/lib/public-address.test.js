/* node functions/lib/public-address.test.js — UX-001 (batch B02): one real address for an event's site.
     - the server builds every public address from ONE setting (lib/public-base.js: PUBLIC_BASE_URL, else the hosted
       address, owner decision #2), whatever host a request came in on; previews and the review page stay on the
       CMS's own address, where the person is signed in;
     - every /api/ answer names it (X-Public-Base) and RevampCore.publicUrl builds the address from it, so the pages
       show and copy the same address everywhere (console Basics + Copy + its Search and Social previews, Settings ›
       URL & SEO, Create Event's address field, the dashboard's Copy event link and QR codes, Publish, Review);
     - the dashboard's Agenda and Speakers QR codes (/e/<id>/agenda, /speakers) open the section on a one-page site;
     - no made-up domain (etoneworld.com, events.economictimes.indiatimes.com) is in any served page or script.
   No network, no production, no AI. Exits 1 on any failure. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..', '..');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log('FAIL ' + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ---------- 1. the one setting ---------- */
var HOSTED = 'https://revamp-cms--revamp-cms.us-east4.hosted.app';
delete process.env.PUBLIC_BASE_URL;
var PB = require('./public-base');
check('the default is the address the sites really answer at (owner decision #2)', PB.DEFAULT_PUBLIC_BASE === HOSTED && PB.publicSiteBase() === HOSTED);
process.env.PUBLIC_BASE_URL = 'https://events.example.com/';
check('PUBLIC_BASE_URL wins, as a bare origin (a final domain is this one change)', PB.publicSiteBase() === 'https://events.example.com');
process.env.PUBLIC_BASE_URL = 'https://events.example.com/e/x';
check('a PUBLIC_BASE_URL that is not a bare origin is not used', PB.publicSiteBase() === HOSTED);
process.env.PUBLIC_BASE_URL = 'javascript:alert(1)';
check('nor one that is not http(s)', PB.publicSiteBase() === HOSTED);
delete process.env.PUBLIC_BASE_URL;
check('the CMS\'s own hosted address is kept apart from the public base (a saved page\'s absolute addresses are on it)', PB.HOSTED_ORIGIN === HOSTED);
var REPUB = read('tools/republish-current.js');
check('tools/republish-current.js rewrites a saved page with the CMS\'s own address, not the public base (it would stop once a domain is set)',
  /const ORIGIN = require\('\.\.\/functions\/lib\/public-base'\)\.HOSTED_ORIGIN;/.test(REPUB) && REPUB.replace(/\/\*[\s\S]*?\*\//g, '').indexOf('publicSiteBase') === -1);

var api = require('./api');
var H = api._testHooks;
var localReq = { headers: { host: 'localhost:8255' }, socket: {} };
check('publicBaseFor is the one setting, not the host the request came in on', H.publicBaseFor(localReq, 'http://localhost:8255') === HOSTED, H.publicBaseFor(localReq, 'http://localhost:8255'));
process.env.PUBLIC_BASE_URL = 'https://events.example.com';
check('publicBaseFor follows PUBLIC_BASE_URL', H.publicBaseFor(localReq, '') === 'https://events.example.com');
check('a preview or review link stays on the CMS address the page is using (its sign-in lives there)',
  H.cmsOriginFor(localReq, 'http://localhost:8255') === 'http://localhost:8255' && H.cmsOriginFor({ headers: { host: 'cms.example', 'x-forwarded-proto': 'https' } }, '') === 'https://cms.example');
delete process.env.PUBLIC_BASE_URL;

/* every /api/ answer says where the sites are */
function route(url) {
  return new Promise(function (resolve) {
    var got = { status: 0, headers: {}, set: {} };
    var res = { headersSent: false, setHeader: function (k, v) { got.set[String(k).toLowerCase()] = v; },
      writeHead: function (st, h) { got.status = st; got.headers = h || {}; this.headersSent = true; },
      end: function () { resolve(got); } };
    H.routeApi({ method: 'GET', url: url, headers: { host: 'localhost:8255' }, socket: {} }, res);
  });
}

/* lib/api.js and the route modules moved out of it as they were (BE-017): the AI site generation, the editor's chat, the Lovable import */
var SRC = ['api.js', 'api-generate.js', 'api-chat.js', 'api-import.js'].map(function (f) { return read('functions/lib/' + f); }).join('\n');
check('the stage answer (a preview link) and an approval request\'s review link use the CMS address',
  /stagingUrl: cmsOriginFor\(req, body\.origin\)/.test(SRC) && /reviewUrl: cmsOriginFor\(req, body\.origin\)/.test(SRC));
check('no route builds a public address from PUBLIC_BASE_URL on its own (only lib/public-base.js reads it)',
  SRC.replace(/\/\*[\s\S]*?\*\//g, '').indexOf('process.env.PUBLIC_BASE_URL') === -1);

/* ---------- 2. QR codes for the agenda and the speakers ---------- */
var PAGE = '<nav><a href="#agenda">Agenda</a></nav><section id="hero"></section><section id=\'previous-speakers\'></section>' +
  '<section id="agenda-2026"></section><section id="agenda"></section>';
check('/agenda finds the section whose id is "agenda" first', H.sectionAnchorFor(PAGE, 'agenda') === 'agenda');
check('/speakers finds a section whose id holds "speaker"', H.sectionAnchorFor(PAGE, 'speakers') === 'previous-speakers');
check('no section: no anchor (the honest "no such page" is answered)', H.sectionAnchorFor('<section id="hero"></section>', 'agenda') === '');
check('only the QR codes\' two names are looked for', H.sectionAnchorFor(PAGE, 'hero') === '' && H.sectionAnchorFor(PAGE, '__proto__') === '');
var pubFn = SRC.slice(SRC.indexOf('function handlePublicPage('), SRC.indexOf('function handlePublicPage(') + 4000);
check('a live site sends /e/<id>/agenda to its home page at that section, keeping ?ag=, before saying "no such page"',
  /var anchor = !chosen\.found \? sectionAnchorFor\(entry\.source, slug\) : ''/.test(pubFn) &&
  pubFn.indexOf("res.writeHead(302, { Location: publicPathOf(eventId) + (query ? '?' + query : '') + '#'") !== -1 &&
  pubFn.indexOf('if (anchor)') < pubFn.indexOf('if (!chosen.found) return sendNoSuchPage'));

/* ---------- 3. the pages: RevampCore.publicUrl from the server's base ---------- */
function loadCore(stored) {
  var store = {}, fired = [];
  if (stored) store['rv-public-base'] = stored;
  var win = {
    location: { origin: 'http://localhost:8255', href: 'http://localhost:8255/x' },
    localStorage: { getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
    dispatchEvent: function (e) { fired.push(e.type); }, addEventListener: function () {},
    CustomEvent: function (type, o) { this.type = type; this.detail = o && o.detail; },
    document: { getElementById: function () { return null; }, addEventListener: function () {}, querySelectorAll: function () { return []; }, createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function () {} }; }, head: { appendChild: function () {} }, body: { appendChild: function () {} } },
    navigator: {}, setTimeout: setTimeout, clearTimeout: clearTimeout, console: console
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read('edit-event-core.js'), win, { filename: 'edit-event-core.js' });
  return { C: win.RevampCore, store: store, fired: fired };
}
var core = loadCore('');
check('before any answer, an address is on this page\'s own host (which serves the sites too)', core.C.publicUrl({ id: 'qa-x' }) === 'http://localhost:8255/e/qa-x');
core.C.notePublicBase({ headers: { get: function (k) { return /^x-public-base$/i.test(k) ? HOSTED : null; } } });
check('an answer\'s X-Public-Base is what every address is built from', core.C.publicUrl({ id: 'qa-x' }) === HOSTED + '/e/qa-x' && core.C.publicBase() === HOSTED);
check('…the event\'s published path when it has one', core.C.publicUrl({ id: 'qa-x', publishedPath: '/e/qa-x' }) === HOSTED + '/e/qa-x' && core.C.publicUrl('qa-y') === HOSTED + '/e/qa-y');
check('…kept in this browser for the next page, and announced to a page that drew an address before it came',
  core.store['rv-public-base'] === HOSTED && core.fired.indexOf('revamp:publicbase') !== -1);
var again = loadCore(HOSTED);
check('the next page has it from its first paint', again.C.publicUrl({ id: 'qa-x' }) === HOSTED + '/e/qa-x');
again.C.notePublicBase({ headers: { get: function () { return 'https://x.example/e/evil'; } } });
check('a header that is not a bare origin is ignored', again.C.publicBase() === HOSTED);
/* a page whose calls all go through RevampAuth.authedFetch (Create Event: portals, working portal, drafts) reads it
   too: in a fresh browser its address field was this page's own host */
var AUTH = read('auth.js');
check('every authedFetch answer is read for it (the first one and the one after a refreshed token)',
  /if \(res\.status !== 401\) return notePublicBase\(res\);/.test(AUTH) && /if \(again\.status !== 401\) return notePublicBase\(again\);/.test(AUTH));
var authNote = AUTH.slice(AUTH.indexOf('function notePublicBase(res) {'), AUTH.indexOf('function authedFetch('));
var fresh = loadCore('');
var authCtx = { window: { RevampCore: fresh.C } };
vm.createContext(authCtx);
vm.runInContext(authNote + '\nthis.note = notePublicBase;', authCtx);
var handed = { headers: { get: function (k) { return /^x-public-base$/i.test(k) ? HOSTED : null; } } };
check('…so a fresh browser whose first page is Create Event builds the address from the answer, and keeps it',
  authCtx.note(handed) === handed && fresh.C.publicUrl('your-event') === HOSTED + '/e/your-event' && fresh.store['rv-public-base'] === HOSTED &&
  fresh.fired.indexOf('revamp:publicbase') !== -1, fresh.C.publicUrl('your-event'));
var bare = { window: {} };
vm.createContext(bare);
vm.runInContext(authNote + '\nthis.note = notePublicBase;', bare);
check('…and a page without RevampCore still gets its answer', bare.note(handed) === handed);
var coreSrc = read('edit-event-core.js');
check('every RevampCore answer is read for it (readJsonResponse)', /function readJsonResponse\(res\)\{\s*notePublicBase\(res\);/.test(coreSrc));
check('a preview stays on this page\'s host', /return eventId \? location\.origin \+ '\/preview\/'/.test(coreSrc));

/* the console */
var ED = read('edit-event.html');
check('console Basics shows the whole address from RevampCore.publicUrl, with no made-up prefix',
  /id="b-slug" value="' \+ esc\(C\.publicUrl\(e\)\) \+ '"/.test(ED) && ED.indexOf('<span class="pre">etoneworld') === -1);
check('its Copy copies the same address, and says so when the browser refuses instead of claiming it copied',
  /var full = C\.publicUrl\(EV\);/.test(ED) && /writeText\(full\)\.then\(done, refused\)/.test(ED) && /Could not copy here/.test(ED));
check('…as a plain message, not a green tick (nothing was copied)',
  /C\.toast\('Could not copy here\. The address is selected: press Ctrl\+C \(⌘C on a Mac\) — ' \+ full, \{ kind: 'info' \}\);/.test(ED) &&
  !/notify\('Could not copy here/.test(ED));
check('its Search and Social previews name the public base\'s host', /function publicHost\(\)\{ return C\.publicBase\(\)/.test(ED) &&
  (ED.match(/esc\(publicHost\(\)\)/g) || []).length === 2);
check('the contact e-mail placeholder is name@company.com', ED.indexOf('placeholder="name@company.com"') !== -1);
/* Settings › URL & SEO (edit-event-seo.js) shows the address the server works out from the same one setting
   (lib/api-seo.js: publicBaseFor, i.e. public-base.js publicSiteBase) */
var SEOJS = read('edit-event-seo.js'), APISEO = read('functions/lib/api-seo.js');
check('Settings › URL & SEO uses the same setting', /var base = H\.publicBaseFor\(req, ''\);\s*var ownUrl = base \+ H\.publicPathOf\(eventId\);/.test(APISEO) &&
  /'<span class="num">' \+ esc\(a\.url\) \+ '<\/span>/.test(SEOJS) && !/etoneworld|economictimes\.indiatimes\.com\/e\//.test(SEOJS));

/* Create Event */
var CE = read('create-event.html');
check('Create Event\'s address field is the real base + /e/ from RevampCore.publicUrl, drawn again when the base arrives',
  /return RevampCore\.publicUrl\(slug\)/.test(CE) && /addEventListener\('revamp:publicbase'/.test(CE));

/* the dashboard */
var EL = read('Event_Listing.html');
check('the dashboard reads the base from its own event-list answer', /RevampCore\.notePublicBase\(res\)/.test(EL));
check('Copy event link and the QR codes use RevampCore.publicUrl (the event\'s published path), not a slug of its name',
  /var base = C && typeof C\.publicUrl === 'function' \? C\.publicUrl\(e\)/.test(EL) && /var url = eventPublicUrl\(e\);/.test(EL) && /var baseUrl = eventPublicUrl\(e, /.test(EL));
check('each row shows its address\'s own part (/e/<id>) and the whole address on hover, from the same helper',
  /var full = eventPublicUrl\(e\), own = full\.replace\(/.test(EL) && /esc\(\(e\.published \? 'The site\\'s address: ' : 'The site\\'s address once it is published: '\) \+ full\)/.test(EL));
check('Copy event link is offered only for a live site (a draft or an offline site has no link that opens)',
  /if \(e\.published && e\.publishedPath\) items\.push\(\['copylink'/.test(EL));

/* Publish and Review */
var PF = read('publish-flow.js'), RV = read('review.html');
check('Publish names and hands back the same address', /var url = C\.publicUrl\(eventId\);/.test(PF) && /out\.publishedUrl \|\| C\.publicUrl\(\{ id: eventId, publishedPath: out\.publishedPath \}\)/.test(PF));
check('Review\'s "put the previous version back" names the same address', /url = C\.publicUrl\(\{ id: eventId, publishedPath: data\.publishedPath \}\)/.test(RV));

/* ---------- 4. no made-up domain in anything served ---------- */
var access = require('./access');
var files = require('child_process').execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(function (f) {
  return f && /\.(html|js|css|json|svg|txt)$/i.test(f) && access.isServableFile(f);
});
/* the words a person can meet: comments are notes for developers (one says what the old address was) */
function withoutComments(text, file) {
  var t = text.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\.(js|html)$/i.test(file)) t = t.replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
  return t;
}
var FAKE = /etoneworld\.com|events\.economictimes\.indiatimes\.com/i, found = [];
files.forEach(function (f) {
  var text;
  try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return; }
  if (FAKE.test(withoutComments(text, f))) found.push(f);
});
check('the sweep read the served pages and scripts', files.length > 100 && files.indexOf('edit-event.html') !== -1 && files.indexOf('Event_Listing.html') !== -1, files.length);
check('no served page or script carries etoneworld.com or events.economictimes.indiatimes.com', !found.length, found);

route('/api/no-such-thing').then(function (got) {
  check('every /api/ answer carries X-Public-Base, the one setting', got.set['x-public-base'] === HOSTED && got.status === 404, got.set);
  console.log('public-address: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) { console.error('CRASH ' + (e && e.stack || e)); process.exit(1); });
