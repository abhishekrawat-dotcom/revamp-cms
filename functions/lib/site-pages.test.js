/* node functions/lib/site-pages.test.js — a site's internal pages (lib/site-pages.js on the server,
   templates/_shared/rv-pages.js in the browser): the page list, selecting one page of the document, the page
   links, the CSS that shows one page, the publish transform's part, and the routes /e/<id>/<slug> and
   /preview/<id>/<slug> run through the real router (lib/api.js handleApi) against an in-memory Firestore and
   Storage. No network, no real project. Exits 1 on any failure. */
'use strict';

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function count(text, needle) { return String(text).split(needle).length - 1; }

/* ---------- an in-memory Firestore + Storage, just enough for these routes ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {}, files = {}, updated = {};
  function snap(p) {
    var d = docs[p];
    return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } };
  }
  function write(p, data, merge) {
    if (!merge || !docs[p]) docs[p] = docs[p] && merge ? docs[p] : {};
    Object.keys(data).forEach(function (k) { if (isDelete(data[k])) delete docs[p][k]; else docs[p][k] = clone(data[k]); });
  }
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, data, o && o.merge); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, data, true); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); }
    };
  }
  function colRef(p) {
    var q = {
      path: p,
      doc: function (id) { return docRef(p + '/' + id); },
      add: function (data) { var r = docRef(p + '/auto' + Object.keys(docs).length); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) {
        var base = q.get;
        var w = Object.assign({}, q, { get: function () { return base().then(function (r) { var list = r.docs.filter(function (d) { return (d.data() || {})[field] === value; }); return { docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } }; }); } });
        return w;
      },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      }
    };
    return q;
  }
  var db = {
    collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = {
        get: function (r) { return r.get(); },
        set: function (r, d, o) { write(r.path, d, o && o.merge); return tx; },
        update: function (r, d) { write(r.path, d, true); return tx; },
        delete: function (r) { delete docs[r.path]; return tx; }
      };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, d, o && o.merge); }); }, update: function (r, d) { ops.push(function () { write(r.path, d, true); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); }, commit: function () { ops.forEach(function (f) { f(); }); return Promise.resolve(); } };
    }
  };
  var tick = 0;
  var bucket = {
    name: 'test-bucket',
    file: function (p) {
      return {
        name: p,
        save: function (buf) { files[p] = Buffer.from(buf); updated[p] = new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString(); return Promise.resolve(); },
        delete: function () { delete files[p]; return Promise.resolve(); },
        exists: function () { return Promise.resolve([!!files[p]]); },
        download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
        getMetadata: function () { return files[p] ? Promise.resolve([{ size: files[p].length, updated: updated[p] }]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
        setMetadata: function () { return Promise.resolve(); }
      };
    }
  };
  var auth = { verifyIdToken: function (t) {
    return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
  } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

const SP = require('./site-pages');
const RP = require('../../templates/_shared/rv-pages.js');
const api = require('./api');
const hooks = api._testHooks;
const KIT = hooks.TOKEN_KIT;

/* ---------- the documents ---------- */
var PAGES_JSON = '[{"slug":"award-categories","title":"Award Categories","description":"Every category of the ET Awards 2026."},{"slug":"jury","title":"The Jury"}]';
function multiPage(extraHead) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>ET Awards 2026</title>\n' +
    "<meta name=\"rv-pages\" content='" + PAGES_JSON + "'>\n" + (extraHead || '') +
    '</head>\n<body data-rv-template-id="gen-et-awards" data-rv-event-id="et-awards">\n' +
    '<div id="content"><div class="col-md-12 no-padding">\n' +
    '<header data-rv-section="nav" data-rv-page="*" data-rv-key="nav"><nav><a data-rv-page-link="home" href="#">Home</a> <a data-rv-page-link="award-categories" href="#">Categories</a> <a data-rv-page-link="jury" href="#">Jury</a> <a data-rv-page-link="nowhere" href="#x">Nowhere</a> <a href="#speakers">Speakers</a></nav></header>\n' +
    '<section data-rv-section="hero" id="hero" data-rv-key="hero"><h1>The ET Awards</h1></section>\n' +
    '<section data-rv-section="speakers" id="speakers" data-rv-key="speakers"><h2>Speakers</h2></section>\n' +
    '<section data-rv-section="categories" id="categories" data-rv-page="award-categories" data-rv-key="categories"><h2>Award categories</h2></section>\n' +
    '<section data-rv-section="jury" id="jury" data-rv-page="jury" data-rv-key="jury"><h2>The jury</h2></section>\n' +
    '<footer data-rv-section="footer" data-rv-key="footer"><p>Footer</p></footer>\n' +
    '</div></div>\n</body>\n</html>\n';
}
var ONE_PAGE = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Tech500</title>\n</head>\n<body data-rv-template-id="tech500">\n' +
  '<section data-rv-section="banner"><h1>Tech500</h1><a href="#overview">Overview</a></section>\n<section data-rv-section="overview" id="overview"><p>Hi</p></section>\n</body>\n</html>\n';

/* ---------- 1. the page list ---------- */
var pages = SP.readPages(multiPage(), KIT);
ok(pages.length === 2 && pages[0].slug === 'award-categories' && pages[0].title === 'Award Categories' && pages[1].slug === 'jury', 'the page list is read from <meta name="rv-pages">', JSON.stringify(pages));
ok(pages[0].description === 'Every category of the ET Awards 2026.' && !pages[1].description, 'a page keeps its own description; one without has none');
ok(SP.readPages(ONE_PAGE, KIT).length === 0, 'a one-page site has no pages');
var escaped = '<html><head><meta name="rv-pages" content="' + PAGES_JSON.replace(/"/g, '&quot;') + '"></head><body></body></html>';
ok(SP.readPages(escaped, KIT).length === 2, 'a double-quoted list with &quot; is read the same');
var asScript = '<html><head></head><body><script type="application/json" id="rv-pages">' + PAGES_JSON + '</script></body></html>';
ok(SP.readPages(asScript, KIT).length === 2, 'the <script id="rv-pages"> form is read too');
ok(SP.readPages('<html><head><meta name="rv-pages" content="not json"></head></html>', KIT).length === 0, 'a list that is not JSON is no list');
var cleaned = RP.cleanPages([{ slug: 'Jury', title: 'x' }, { slug: 'home', title: 'Home' }, { slug: 'a b' }, { slug: 'ok-1', title: '  Two   words ' }, { slug: 'ok-1', title: 'again' }, { slug: 'x'.repeat(41) }, null, { slug: 'no-title' }]);
ok(cleaned.length === 2 && cleaned[0].slug === 'ok-1' && cleaned[0].title === 'Two words' && cleaned[1].title === 'No title',
  'only valid slugs, each once, never "home"; titles plain and filled in', JSON.stringify(cleaned));
ok(SP.pagesMeta([{ slug: 'jury', title: 'The "Jury" <b>' }]) === '<meta name="rv-pages" content="[{&quot;slug&quot;:&quot;jury&quot;,&quot;title&quot;:&quot;The \\&quot;Jury\\&quot; &lt;b&gt;&quot;}]">',
  'pagesMeta() writes a safe meta tag', SP.pagesMeta([{ slug: 'jury', title: 'The "Jury" <b>' }]));
ok(SP.readPages(SP.pagesMeta([{ slug: 'jury', title: 'The "Jury" <b>' }]), KIT)[0].title === 'The "Jury" <b>', 'and what it writes reads back as it was');
ok(SP.pagesMeta([]) === '', 'no pages: no meta tag');

/* ---------- 2. selecting a page ---------- */
var doc = multiPage('<meta name="description" content="The awards.">\n<link rel="canonical" href="https://cms.example/e/et-awards">\n<meta property="og:title" content="ET Awards 2026">\n<meta property="og:url" content="https://cms.example/e/et-awards/">\n<meta property="og:description" content="The awards.">\n');
var home = SP.selectPage(doc, '', KIT);
ok(home.found && home.html === doc && !home.page, 'the home page (no slug) is the document unchanged');
var miss = SP.selectPage(doc, 'nope', KIT);
ok(!miss.found && miss.html === doc, 'a slug the document has no page for is not found');
ok(!SP.selectPage(doc, 'home', KIT).found, '"/home" is no page (the home page has no slug)');
ok(!SP.selectPage(ONE_PAGE, 'jury', KIT).found, 'a one-page site has no internal page');
var cat = SP.selectPage(doc, 'award-categories', KIT);
ok(cat.found && cat.page.slug === 'award-categories', 'a page of the document is found');
ok(/<html lang="en" data-rv-current-page="award-categories">/.test(cat.html), '<html> says which page is shown', cat.html.slice(0, 80));
ok(count(cat.html, '<title>Award Categories | ET Awards 2026</title>') === 1, 'the title is the page\'s, then the site\'s');
ok(/<meta property="og:title" content="Award Categories \| ET Awards 2026">/.test(cat.html), 'so is the sharing title');
ok(/<meta name="description" content="Every category of the ET Awards 2026.">/.test(cat.html) && /<meta property="og:description" content="Every category of the ET Awards 2026.">/.test(cat.html), 'a page with its own description gets it');
ok(/<link rel="canonical" href="https:\/\/cms.example\/e\/et-awards\/award-categories">/.test(cat.html), 'the canonical address is the page\'s');
ok(/<meta property="og:url" content="https:\/\/cms.example\/e\/et-awards\/award-categories">/.test(cat.html), 'and so is og:url (a trailing slash is not doubled)');
var jury = SP.selectPage(doc, 'jury', KIT);
ok(/<meta name="description" content="The awards.">/.test(jury.html), 'a page without its own description keeps the site\'s');
/* nothing else of the document changes */
function strip(h) { return h.replace(/<html[^>]*>/, '').replace(/<title>[^<]*<\/title>/, '').replace(/<meta (?:name|property)="(?:description|og:[a-z]+)"[^>]*>/g, '').replace(/<link rel="canonical"[^>]*>/, ''); }
ok(strip(cat.html) === strip(doc), 'every other byte of the document is as it was');
var noTitle = SP.selectPage(multiPage().replace(/<title>[^<]*<\/title>\n/, ''), 'jury', KIT);
ok(/<title>The Jury<\/title>\n<\/head>/.test(noTitle.html), 'a document without a title gets the page\'s');
var described = SP.selectPage(multiPage(), 'award-categories', KIT);
ok(/<meta name="description" content="Every category of the ET Awards 2026.">\n<\/head>/.test(described.html) && !/<meta name="description"/.test(SP.selectPage(multiPage(), 'jury', KIT).html),
  'a page with its own description gets one even where the site has none; a page without gets none');
var entity = SP.selectPage(multiPage().replace('<title>ET Awards 2026</title>', '<title>R&amp;D Awards</title>'), 'jury', KIT);
ok(/<title>The Jury \| R&amp;D Awards<\/title>/.test(entity.html), 'an escaped site title stays escaped once', entity.html.match(/<title>[^<]*<\/title>/)[0]);

/* ---------- 3. page links ---------- */
var linked = SP.setPageLinks(doc, '/e/et-awards', KIT);
ok(/<a data-rv-page-link="home" href="\/e\/et-awards">/.test(linked) && /<a data-rv-page-link="award-categories" href="\/e\/et-awards\/award-categories">/.test(linked) && /<a data-rv-page-link="jury" href="\/e\/et-awards\/jury">/.test(linked),
  'each page link gets its page\'s address');
ok(/<a data-rv-page-link="nowhere" href="#x">/.test(linked), 'a link to a page the site does not have is left alone');
ok(SP.setPageLinks(linked, '/e/et-awards', KIT) === linked, 'and doing it again changes nothing');
ok(SP.setPageLinks(ONE_PAGE, '/e/x', KIT) === ONE_PAGE, 'a one-page site is untouched');

/* ---------- 4. the CSS ---------- */
var css = SP.pagesCss(pages);
ok(css === RP.css(pages) && /\{display:none!important\}\n$/.test(css), 'one rule, the same on the server and in the browser');
ok(css.indexOf('html[data-rv-current-page="jury"] [data-rv-page]:not([data-rv-page="*"]):not([data-rv-page="jury"])') !== -1, 'a page hides every other page\'s sections');
ok(css.indexOf('html:not([data-rv-current-page]) [data-rv-page]:not([data-rv-page="*"]):not([data-rv-page="home"])') !== -1, 'the home page hides every internal page\'s sections');
ok(/html\[data-rv-current-page\]:not\(\[data-rv-current-page="home"\]\) \[data-rv-section\]:not\(\[data-rv-page\]\)(:not\([^)]*\))+/.test(css) && css.indexOf(':not([data-rv-section="footer"])') !== -1 && css.indexOf(':not(footer)') !== -1,
  'an internal page hides the home page\'s sections, never an unmarked top bar or footer');
ok(SP.pagesCss([]) === '', 'no pages: no rule');

/* ---------- 5. rv-pages.js: which page an element is on, addresses ---------- */
/* a stand-in element: enough of closest()/matches() for the selectors rv-pages.js uses */
function el(tag, attrs, parent) {
  var e = { tagName: tag.toUpperCase(), attrs: attrs || {}, parentElement: parent || null };
  e.getAttribute = function (n) { return Object.prototype.hasOwnProperty.call(e.attrs, n) ? e.attrs[n] : null; };
  e.hasAttribute = function (n) { return Object.prototype.hasOwnProperty.call(e.attrs, n); };
  e.matches = function (sel) {
    var m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (m) return e.hasAttribute(m[1]) && (m[2] == null || e.getAttribute(m[1]) === m[2]);
    return e.tagName === sel.toUpperCase();
  };
  e.closest = function (sel) { for (var x = e; x; x = x.parentElement) if (x.matches(sel)) return x; return null; };
  return e;
}
var nav = el('header', { 'data-rv-section': 'nav' }), navLink = el('a', {}, nav);
var markedNav = el('div', { 'data-rv-section': 'topbar', 'data-rv-page': '*' });
var hero = el('section', { 'data-rv-section': 'hero' }), heroText = el('p', {}, hero);
var catSec = el('section', { 'data-rv-section': 'categories', 'data-rv-page': 'award-categories' }), catText = el('h2', {}, catSec);
var etFooter = el('footer', { 'data-rv-et-footer': 'et', 'data-rv-section': 'footer' });
var popup = el('div', { role: 'dialog' });
ok(RP.pageOfElement(navLink) === '*' && RP.pageOfElement(markedNav) === '*' && RP.pageOfElement(etFooter) === '*', 'the top bar and the footer are on every page, marked or not');
ok(RP.pageOfElement(heroText) === 'home', 'an unmarked section is the home page\'s');
ok(RP.pageOfElement(catText) === 'award-categories', 'a marked one is its page\'s');
ok(RP.pageOfElement(popup) === '*', 'what is not in a section is on every page');
ok(RP.shownOn(hero, 'home') && !RP.shownOn(hero, 'jury') && RP.shownOn(catSec, 'award-categories') && !RP.shownOn(catSec, 'home') && RP.shownOn(nav, 'jury'), 'shownOn() follows');
ok(RP.pageFromPath('/e/et-awards/jury', pages) === 'jury' && RP.pageFromPath('/preview/et-awards/jury/', pages) === 'jury' && RP.pageFromPath('/e/et-awards', pages) === 'home' &&
  RP.pageFromPath('/e/et-awards/unknown', pages) === 'home', 'the page an address is for');
ok(RP.hrefFor('jury', { pathname: '/e/et-awards', search: '?utm_source=x' }, pages) === '/e/et-awards/jury', 'a live page link: /e/<id>/<slug>, nothing carried over');
ok(RP.hrefFor('home', { pathname: '/e/et-awards/jury', search: '' }, pages) === '/e/et-awards', 'home from an internal page: /e/<id>');
ok(RP.hrefFor('jury', { pathname: '/preview/et-awards/award-categories', search: '?draft=1&x=2' }, pages) === '/preview/et-awards/jury?draft=1', 'a preview keeps ?draft=1');
ok(RP.hrefFor('home', { pathname: '/preview/et-awards/jury', search: '?staged=1' }, pages) === '/preview/et-awards?staged=1', 'and ?staged=1');
ok(RP.hrefFor('jury', { pathname: '/awards/', search: '' }, pages) === '/awards/jury' && RP.hrefFor('home', { pathname: '/awards/jury', search: '' }, pages) === '/awards', 'served at another address, the pages follow it');
ok(RP.titleFor({ slug: 'jury', title: 'The Jury' }, 'ET Awards') === 'The Jury | ET Awards' && RP.titleFor(null, 'ET Awards') === 'ET Awards' && RP.titleFor({ title: 'X' }, '') === 'X', 'the title of a page');

/* ---------- 6. the publish transform ---------- */
var ev = { name: 'ET Awards 2026', createdAt: '2026-01-01T00:00:00Z' };
var liveMulti = hooks.publishTransform(multiPage(), { eventId: 'et-awards', event: ev, mode: 'live', publicBase: 'https://cms.example' });
ok(count(liveMulti, '<style id="rv-pages-css" data-rv-runtime>') === 1 && liveMulti.indexOf(RP.css(pages).replace(/\n$/, '')) !== -1, 'a site with pages gets the rule in its <head>');
ok(liveMulti.indexOf('<style id="rv-pages-css"') < liveMulti.indexOf('</head>'), '…in the head, so the right page shows at once');
ok(count(liveMulti, '<script src="/templates/_shared/rv-pages.js" data-rv-runtime></script>') === 1, 'and the pages runtime, once');
ok(/data-rv-page-link="jury" href="\/e\/et-awards\/jury"/.test(liveMulti), 'its page links carry the live addresses');
ok(hooks.publishTransform(liveMulti, { eventId: 'et-awards', event: ev, mode: 'live', publicBase: 'https://cms.example' }) === liveMulti, 'the transform run again changes nothing');
var prevMulti = hooks.publishTransform(multiPage(), { eventId: 'et-awards', event: ev, mode: 'preview', publicBase: '' });
ok(/data-rv-page-link="jury" href="\/preview\/et-awards\/jury"/.test(prevMulti), 'on a preview, the preview addresses');
var stale = multiPage().replace('<html lang="en">', '<html lang="en" data-rv-current-page="jury">');
ok(!/<html[^>]*data-rv-current-page/.test(hooks.publishTransform(stale, { eventId: 'et-awards', event: ev, mode: 'live' })), 'a stored page never says which page is shown');
var liveOne = hooks.publishTransform(ONE_PAGE, { eventId: 'tech-one', event: ev, mode: 'live', publicBase: 'https://cms.example' });
ok(liveOne.indexOf('rv-pages') === -1 && liveOne.indexOf('data-rv-current-page') === -1, 'a one-page site gets nothing of it');

/* ---------- 7. the routes ---------- */
function call(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    var body = opts.body ? JSON.stringify(opts.body) : '';
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body) };
    if (body) headers['content-type'] = 'application/json';
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, text: t, body: j, headers: res.headers }); }
    };
    api.handleApi(req, res);
  });
}

var NOW = '2026-02-01T00:00:00.000Z';
FB.docs['config/approvals'] = { required: false };
FB.docs['events/et-awards'] = { name: 'ET Awards 2026', createdAt: NOW, site: { version: 1, templateId: 'gen-et-awards' } };
FB.docs['events/tech-one'] = { name: 'Tech500', createdAt: NOW, site: { version: 1, templateId: 'tech500' } };

function save(path, text) { return FB.bucket.file(path).save(text); }
Promise.all([
  save('events/et-awards/site/page.html', multiPage()),
  save('events/tech-one/site/page.html', ONE_PAGE)
]).then(function () {
  return Promise.all([
    call('GET', '/preview/et-awards', { token: 'editor' }),
    call('GET', '/preview/et-awards/jury', { token: 'editor' }),
    call('GET', '/preview/et-awards/jury/?draft=1', { token: 'editor' }),
    call('GET', '/preview/et-awards/nope', { token: 'editor' }),
    call('GET', '/preview/et-awards/jury'),
    call('GET', '/preview/tech-one', { token: 'editor' }),
    call('GET', '/preview/tech-one/jury', { token: 'editor' })
  ]);
}).then(function (r) {
  ok(r[0].status === 200 && !/<html[^>]*data-rv-current-page/.test(r[0].text) && /<title>ET Awards 2026<\/title>/.test(r[0].text), '/preview/<id> is the home page', r[0].status + ' ' + r[0].text.slice(0, 200));
  ok(r[1].status === 200 && /<html lang="en"[^>]* data-rv-current-page="jury"/.test(r[1].text) && /<title>The Jury \| ET Awards 2026<\/title>/.test(r[1].text), '/preview/<id>/<slug> is that page', r[1].status + ' ' + r[1].text.slice(0, 300));
  ok(r[1].text.indexOf('<style id="rv-pages-css"') !== -1 && /data-rv-page-link="jury" href="\/preview\/et-awards\/jury"/.test(r[1].text), 'with the rule and the preview\'s page links');
  ok(r[2].status === 200 && /data-rv-current-page="jury"/.test(r[2].text), 'a trailing slash and ?draft=1 are the same page', String(r[2].status));
  ok(r[3].status === 404 && /not part of the site/.test(r[3].text), 'an unknown page of a preview is a 404', r[3].status + ' ' + r[3].text.slice(0, 120));
  ok(r[4].status === 302 && /^\/\?next=%2Fpreview%2Fet-awards%2Fjury/.test(r[4].headers.location || ''), 'a signed-out visitor is sent to sign in, and back to the page', r[4].status + ' ' + r[4].headers.location);
  ok(r[5].status === 200 && r[5].text.indexOf('rv-pages') === -1, 'a one-page site\'s preview has nothing of it');
  ok(r[6].status === 404, 'a one-page site has no internal page');
  /* publish: the pages are recorded for the sitemap */
  return call('POST', '/api/event/publish', { token: 'editor', body: { eventId: 'et-awards' } }).then(function (p) {
    ok(p.status === 200, 'the multi-page site publishes', p.status + ' ' + p.text.slice(0, 200));
    var d = FB.docs['events/et-awards'];
    ok(Array.isArray(d.publishedPages) && d.publishedPages.length === 2 && d.publishedPages[1].slug === 'jury' && d.publishedPages[1].title === 'The Jury', 'the publish records its pages', JSON.stringify(d.publishedPages));
    return call('POST', '/api/event/publish', { token: 'editor', body: { eventId: 'tech-one' } });
  });
}).then(function (p) {
  ok(p.status === 200 && !('publishedPages' in FB.docs['events/tech-one']), 'a one-page site records none', p.status + ' ' + JSON.stringify(FB.docs['events/tech-one']));
  var live = String(FB.files['events/et-awards/published/index.html'] || '');
  ok(/data-rv-page-link="jury" href="\/e\/et-awards\/jury"/.test(live) && !/<html[^>]*data-rv-current-page/.test(live), 'the published page links its pages and selects none');
  return Promise.all([
    call('GET', '/e/et-awards'),
    call('GET', '/e/et-awards/award-categories'),
    call('GET', '/e/et-awards/award-categories'),
    call('GET', '/e/et-awards/nope'),
    call('GET', '/e/et-awards/Bad_Slug'),
    call('GET', '/e/et-awards/jury/extra'),
    call('POST', '/e/et-awards/jury'),
    call('GET', '/e/tech-one'),
    call('GET', '/e/tech-one/jury'),
    call('HEAD', '/e/et-awards/jury'),
    call('GET', '/sitemap.xml')
  ]);
}).then(function (r) {
  ok(r[0].status === 200 && !/<html[^>]*data-rv-current-page/.test(r[0].text), '/e/<id> is the home page', String(r[0].status));
  ok(r[1].status === 200 && /data-rv-current-page="award-categories"/.test(r[1].text) && /<title>Award Categories \| ET Awards 2026<\/title>/.test(r[1].text), '/e/<id>/<slug> is that page', r[1].status + ' ' + r[1].text.slice(0, 200));
  ok(/<link rel="canonical" href="http:\/\/localhost\/e\/et-awards\/award-categories"/.test(r[1].text), '…with its own canonical address', (r[1].text.match(/<link rel="canonical"[^>]*>/) || [''])[0]);
  ok(/public, max-age=60/.test(r[1].headers['cache-control'] || ''), '…cached like the home page', r[1].headers['cache-control']);
  ok(r[2].status === 200 && r[2].text === r[1].text, 'the second visit is the same page (from the cache)');
  ok(!/<html[^>]*data-rv-current-page/.test(r[0].text), 'and the cached home page is not the internal page');
  ok(r[3].status === 404 && /not available/.test(r[3].text), 'an unknown page is the plain 404', String(r[3].status));
  ok(r[4].status === 404 && r[5].status === 404, 'a malformed slug, or a path below a page, is a 404', r[4].status + ' ' + r[5].status);
  ok(r[6].status === 405, 'only GET and HEAD', String(r[6].status));
  ok(r[7].status === 200 && r[7].text.indexOf('rv-pages') === -1, 'a published one-page site has nothing of it');
  ok(r[8].status === 404, 'and no internal page');
  ok(r[9].status === 200 && r[9].text === '', 'HEAD of a page answers without a body');
  ok(r[10].status === 200 && r[10].text.indexOf('<loc>http://localhost/e/et-awards</loc>') !== -1 && r[10].text.indexOf('<loc>http://localhost/e/et-awards/award-categories</loc>') !== -1 &&
    r[10].text.indexOf('<loc>http://localhost/e/et-awards/jury</loc>') !== -1 && r[10].text.indexOf('tech-one/') === -1, 'the sitemap lists the internal pages of a live site', r[10].text);
}).then(function () {
  /* the sign-in gate: an internal page of a published site is as public as the site */
  var access = require('./access');
  ok(access.isPublic({}, '/e/et-awards/jury') && access.isPublic({}, '/e/et-awards/jury/') && !access.isPublic({}, '/preview/et-awards/jury'), 'the sign-in gate lets /e/<id>/<slug> through as /e/<id>, and not a preview');
}).catch(function (err) {
  failures.push('threw: ' + (err && err.stack || err));
}).then(function () {
  if (failures.length) {
    console.error('site-pages: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('site-pages: all ' + checks + ' checks passed');
  process.exit(0);
});
