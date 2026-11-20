// node functions/lib/embed-code.test.js — the Developer zone copy's common CSS & JS when it is too big for ETB2B's global
// section (the owner, 20 Nov 2026, on ETB2B DAVOS Immersions: "the global css and JS that I have added are being cropped
// due to exceeding the content limit in ETB2B Global JS CSS Section"). That section keeps 65,535 bytes of CSS and JS
// together; the owner's page held the whole CSS (60,367) and the script up to "!sec.__rvS" (5,167 of 8,214).
// Checks: the size is counted as the CMS stores it; what is moved out (the script first, then the CSS); the boxes that
// load the files, and that the script one adds its file once, marks the page while it comes and unmarks it should the
// file not come; POST /api/event/embed-code stores the code once by what it holds, public and kept a year, and refuses
// what is not the code of an existing event; the route belongs to Design in Settings › Access; the editor uses it all.
// Firestore and Storage are in-memory stubs; nothing is written anywhere. No network. Exits 1 on failure.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : '')); }
['log', 'info', 'warn'].forEach(function (k) { console[k] = function () {}; });

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'editor-dev-export.js'), 'utf8');
var UI = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
var win = {};
vm.runInNewContext(SRC, { window: win, URL: URL, JSON: JSON, Math: Math, RegExp: RegExp, String: String, Array: Array, Object: Object, Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout });
var X = win.RevampDevExport, T = X._test;

/* ---------- 1 the size, as the CMS keeps it ---------- */
check('1.1 the limit is the 65,535 bytes ETB2B keeps', X.GLOBAL_LIMIT === 65535);
check('1.2 ASCII is a byte each', T.boxBytes('abc') === 3);
check('1.3 a line end counts two (a CMS may store CR LF)', T.boxBytes('a\nb') === 4);
check('1.4 UTF-8: ’ is three bytes, é two, an emoji four', T.boxBytes('’') === 3 && T.boxBytes('é') === 2 && T.boxBytes('😀') === 4);

function pad(n) { return new Array(n + 1).join('a'); }
var small = X.globalPlan('<style>' + pad(1000) + '</style>', '<script>' + pad(1000) + '</script>');
check('1.5 a common part that fits stays as it is', small.fits === true && small.host.length === 0 && small.bytes === 2032, small);
var davos = X.globalPlan(pad(60367), pad(8214));
check('1.6 ETB2B DAVOS Immersions (60,367 + 8,214): the script is moved out, the CSS stays on the page', davos.fits === false && davos.host.join() === 'js' && davos.bytes === 68581, davos);
var bigCss = X.globalPlan(pad(70000), pad(8214));
check('1.7 a CSS too big even alone: the CSS is moved out, the script stays', bigCss.host.join() === 'css', bigCss);
var both = X.globalPlan(pad(70000), pad(70000));
check('1.8 both too big: both are moved out', both.host.join() === 'js,css', both);
check('1.9 no script and a CSS too big: the CSS only', X.globalPlan(pad(70000), '').host.join() === 'css');
check('1.10 just under the room left for what the CMS adds: fits; at the limit: does not', X.globalPlan(pad(64511), '').fits === true && X.globalPlan(pad(64512), '').fits === false);

/* ---------- 2 the boxes that load the files ---------- */
var CSS_URL = 'https://storage.googleapis.com/b/events/x/embed/common-' + pad(32) + '.css';
var JS_URL = 'https://storage.googleapis.com/b/events/x/embed/common-' + pad(32) + '.js';
var boxes = X.hostedBoxes({ js: JS_URL }, { css: '<style>\nkeep\n</style>', js: '<script>\nold\n</script>' });
check('2.1 the CSS kept on the page is left as it was', boxes.css === '<style>\nkeep\n</style>');
check('2.2 the script box loads the file', boxes.js.indexOf("})(document, '" + JS_URL + "');") !== -1 && /^<script>\n[\s\S]*\n<\/script>$/.test(boxes.js) && boxes.js.indexOf('old') === -1, boxes.js);
var both2 = X.hostedBoxes({ js: JS_URL, css: CSS_URL }, { css: '<style>\nkeep\n</style>', js: '<script>\nold\n</script>' });
check('2.3 a CSS moved out is a <style> with one @import (a <style> the CMS takes like the CSS)', both2.css === "<style>\n@import url('" + CSS_URL + "');\n</style>", both2.css);
check('2.4 the boxes are small: well inside the limit', X.globalPlan(both2.css, both2.js).bytes < 1200 && X.globalPlan(pad(60367), boxes.js).fits, X.globalPlan(both2.css, both2.js));
check('2.5 an address with a quote, a bracket or a space is never written into a box', !T.hostedUrlOk("https://a/b'c") && !T.hostedUrlOk('https://a/b)c') && !T.hostedUrlOk('https://a/b c') &&
  !T.hostedUrlOk('http://a/b') && !T.hostedUrlOk('javascript:alert(1)') && T.hostedUrlOk(JS_URL));
var threw = false;
try { X.hostedBoxes({ js: "https://a/'+alert(1)+'" }, { css: '', js: '' }); } catch (e) { threw = true; }
check('2.6 …hostedBoxes refuses one', threw);
check('2.7 no attribute of the boxes holds a double quote (ETB2B turns &quot; back into ")', !/<[a-z]+[^>]*="/i.test(both2.css + both2.js.replace(/<script>[\s\S]*<\/script>/, '<script>')));

/* the script box run in a stand-in page */
function fakeDoc() {
  var cls = {}, added = [];
  var root = { classList: { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; }, contains: function (c) { return !!cls[c]; } } };
  var head = { appendChild: function (el) { added.push(el); } };
  return {
    cls: cls, added: added, documentElement: root, head: head,
    createElement: function (tag) { var a = {}; return { tag: tag, setAttribute: function (k, v) { a[k] = v; }, getAttribute: function (k) { return a[k]; } }; },
    querySelector: function (sel) {
      var m = /^script\[data-rv-common="(.*)"\]$/.exec(sel);
      return m ? added.filter(function (el) { return el.getAttribute('data-rv-common') === m[1]; })[0] || null : null;
    }
  };
}
var code = boxes.js.replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
var d = fakeDoc();
vm.runInNewContext(code, { document: d });
check('2.8 it adds the file as a script', d.added.length === 1 && d.added[0].tag === 'script' && d.added[0].src === JS_URL, d.added);
check('2.9 …and marks the page while it comes (rv-anim, as the common script does)', d.cls['rv-anim'] === 1);
vm.runInNewContext(code, { document: d });
check('2.10 pasted twice, the file is added once', d.added.length === 1);
d.added[0].onerror();
check('2.11 should the file not come, the mark goes again (the sections still show)', !d.cls['rv-anim']);
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the other checks still run */ }
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(code, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n')[0]; } })();
  check('2.12 the script box is ES5 (another website may be old)', es5 === true, es5);
}

/* ---------- 3 POST /api/event/embed-code ---------- */
delete process.env.K_SERVICE;
delete process.env.ACCESS_CONFIG_DOC;
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var DOCS = {}, FILES = {};
function snapOf(p) { var dd = DOCS[p]; return { id: p.split('/').pop(), exists: !!dd, data: function () { return dd ? JSON.parse(JSON.stringify(dd)) : undefined; }, get: function (k) { return dd ? dd[k] : undefined; } }; }
function refOf(p) { return { id: p.split('/').pop(), path: p, get: function () { return Promise.resolve(snapOf(p)); }, collection: function (n) { return colOf(p + '/' + n); } }; }
function colOf(p) { return { doc: function (id) { return refOf(p + '/' + id); } }; }
var FB = {
  db: {
    collection: function (n) { return colOf(n); },
    getAll: function () { var a = [].slice.call(arguments); return Promise.resolve(a.map(function (r) { return snapOf(r.path); })); }
  },
  bucket: {
    name: 'qa-bucket',
    file: function (p) {
      return {
        exists: function () { return Promise.resolve([!!FILES[p]]); },
        save: function (buf, opts) { FILES[p] = { body: Buffer.from(buf).toString('utf8'), opts: opts, public: false, saves: ((FILES[p] && FILES[p].saves) || 0) + 1 }; return Promise.resolve(); },
        makePublic: function () { FILES[p].public = true; return Promise.resolve(); },
        delete: function () { delete FILES[p]; return Promise.resolve(); }
      };
    }
  },
  auth: { verifyIdToken: function (t) { return Promise.resolve({ uid: t, email: t + '@timesinternet.in', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };
var api = require('./api');
function post(body) {
  return new Promise(function (resolve) {
    var raw = Buffer.from(JSON.stringify(body));
    var req = { method: 'POST', url: '/api/event/embed-code', headers: { host: 'cms.example', authorization: 'Bearer maker', 'content-type': 'application/json' }, socket: {}, rawBody: raw };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s) { res.statusCode = s; res.headersSent = true; return res; }, write: function () { return true; },
      end: function (b) { var j = null; try { j = JSON.parse(String(b)); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json: j }); } };
    api.handleApi(req, res);
  });
}

(async function () {
  DOCS['events/qa-embed'] = { name: 'QA embed', createdAt: '2026-11-20T00:00:00.000Z' };
  DOCS['events/qa-gone'] = { name: 'QA gone', createdAt: '2026-11-20T00:00:00.000Z', deletedAt: '2026-11-20T01:00:00.000Z' };
  var js = '(function embedLoader(CONFIG) { var w = window; })({"page":"https://x/e/qa-embed"});';
  var r = await post({ eventId: 'qa-embed', kind: 'js', text: js });
  var p = r.json && r.json.path;
  check('3.1 the script is kept with the event, named by what it holds', r.status === 200 && /^events\/qa-embed\/embed\/common-[0-9a-f]{32}\.js$/.test(p || '') && r.json.stored === true, r);
  check('3.2 …at its public address', r.json && r.json.url === 'https://storage.googleapis.com/qa-bucket/' + p);
  var f = FILES[p] || { opts: { metadata: {} } };
  check('3.3 …public, as a script, kept a year, sent compressed', f.public === true && f.body === js && f.opts.metadata.contentType === 'text/javascript; charset=utf-8' &&
    f.opts.metadata.cacheControl === 'public, max-age=31536000, immutable' && f.opts.gzip === true, f.opts);
  var again = await post({ eventId: 'qa-embed', kind: 'js', text: js });
  check('3.4 the same code again is the same file, not stored again', again.status === 200 && again.json.path === p && again.json.stored === false && FILES[p].saves === 1, again.json);
  var other = await post({ eventId: 'qa-embed', kind: 'js', text: js + ' ' });
  check('3.5 changed code is a new file (a page that loads the old one keeps it)', other.status === 200 && other.json.path !== p && !!FILES[p], other.json);
  var css = await post({ eventId: 'qa-embed', kind: 'css', text: '.rv-embed:not(#_#_#_#_) { color: red !important; }' });
  check('3.6 the CSS: a stylesheet file', css.status === 200 && /\.css$/.test(css.json.path) && FILES[css.json.path].opts.metadata.contentType === 'text/css; charset=utf-8', css.json);
  check('3.7 a kind other than css or js is refused', (await post({ eventId: 'qa-embed', kind: 'html', text: 'x' })).status === 400 &&
    (await post({ eventId: 'qa-embed', kind: 'constructor', text: 'x' })).status === 400);
  check('3.8 a box with its tags is refused (the box is written by the copy)', (await post({ eventId: 'qa-embed', kind: 'js', text: '<script>alert(1)</script>' })).status === 400 &&
    (await post({ eventId: 'qa-embed', kind: 'css', text: '  <style>a{}</style>' })).status === 400);
  check('3.9 no code is refused', (await post({ eventId: 'qa-embed', kind: 'css', text: '   ' })).status === 400);
  check('3.10 an event that does not exist, or is deleted: 404, nothing stored', (await post({ eventId: 'qa-none', kind: 'css', text: 'a{}' })).status === 404 &&
    (await post({ eventId: 'qa-gone', kind: 'css', text: 'a{}' })).status === 404 && !Object.keys(FILES).some(function (k) { return /qa-(none|gone)/.test(k); }));
  check('3.11 an address that is not an event id is refused', (await post({ eventId: '../x', kind: 'css', text: 'a{}' })).status === 400 &&
    (await post({ eventId: 'import-abc', kind: 'css', text: 'a{}' })).status === 400);
  var big = await post({ eventId: 'qa-embed', kind: 'css', text: pad(4 * 1024 * 1024 + 1) });
  check('3.12 over 4 MB is refused', big.status === 413, big.status);

  /* ---------- 4 access, and the editor ---------- */
  var AC = require('./access-control');
  check('4.1 the route belongs to Design in Settings › Access', JSON.stringify(AC._sectionsFor ? AC._sectionsFor('POST', '/api/event/embed-code') : (AC.sectionsFor && AC.sectionsFor('POST', '/api/event/embed-code'))) === '["design"]');
  check('4.2 the copy measures the common part against the limit', /plan: RevampDevExport\.globalPlan \? RevampDevExport\.globalPlan\(c\.css, c\.js\) : null/.test(UI) && /text: c\.text,/.test(UI));
  check('4.3 …keeps what is too big with the event and shows the boxes that load it', /RevampAuth\.authedFetch\('\/api\/event\/embed-code'/.test(UI) && /RevampDevExport\.hostedBoxes\(by, \{ css: x\.css, js: x\.js \}\)/.test(UI) &&
    /if \(exported\.isCommon && exported\.plan && exported\.plan\.host\.length\) \{/.test(UI));
  check('4.4 …and says so, with the size, and what to do when it could not be kept', /box\.textContent = commonNote\(exported\);/.test(UI) && /more than the ' \+ room \+ ' ETB2B’s global section holds, so ' \+ what/.test(UI) &&
    /it could not be kept with the event just now/.test(UI) && /' Size: ' \+ kbOf\(p\.bytes\) \+ ' of the '/.test(UI));
  check('4.5 buildCommon hands the code without its tags for the files', /text: \{ css: bareCss\(String\(css \|\| ''\)\), js: js \}/.test(SRC));

  process.stdout.write('embed-code: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
