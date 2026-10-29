// node functions/lib/promotions-page.test.js — Promotions (marketing.html and promo.css): the shell's three tabs
// (Social posts, the platform's studio in a frame; Site-look posts, promo-posts.js in the page; Mailers, the
// platform's mailer studio in a frame), what the two frames tell the page (full window, height, toasts, the mail's
// banner), and the posts gallery's larger, example-marked previews. Reads the files; the page's own script runs in
// a vm over a small fake DOM, with RevampCore, RevampPromo, RevampPromoPosts and RevampPromoBanner stubbed. No
// network, no Firebase, no browser.
var fs = require('fs'), path = require('path'), vm = require('vm');
var access = require('./access');

var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function count(s, sub) { return s.split(sub).length - 1; }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var page = read('marketing.html');
var css = read('promo.css');

/* ---------- marketing.html, as a file ---------- */
var title = (/<title>([\s\S]*?)<\/title>/.exec(page) || [])[1];
check('the title says Oneworld 2.0', title && title.replace(/&mdash;/g, '—') === 'Promotions — Oneworld 2.0', title);
check('the file\'s comment says Oneworld 2.0', /^<!doctype html>\s*<!-- Oneworld 2\.0 : one event's Promotions/.test(page), page.slice(0, 160));
check('no "Revamp CMS" left on the page', page.indexOf('Revamp CMS') === -1);

var tags = page.match(/<script\b[^>]*>/g) || [];
function tagAt(src) { return tags.indexOf('<script src="' + src + '">'); }
check('promo-posts.js and promo-banner.js load once each', count(page, '<script src="promo-posts.js"></script>') === 1 && count(page, '<script src="promo-banner.js"></script>') === 1);
check('promo-banner.js loads right after promo-posts.js (it draws with RevampPromoPosts.banner)', tagAt('promo-posts.js') !== -1 &&
  tagAt('promo-banner.js') === tagAt('promo-posts.js') + 1, tags);
var inline = (page.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); });
var shell = inline.filter(function (s) { return s.indexOf('var TABS = [') !== -1; })[0] || '';
check('the shell\'s script comes after promo-banner.js (RevampPromoBanner is there when a tab is shown)', !!shell &&
  page.indexOf(shell) > page.indexOf('<script src="promo-banner.js">'));
var local = (page.match(/(?:src|href)="[^"]+"/g) || []).map(function (a) { return a.replace(/^(?:src|href)="|"$/g, ''); })
  .filter(function (u) { return !/^(https?:)?\/\/|^#|^data:/.test(u); });
local.push('promo-social-studio.html', 'promo-mailer-studio.html');
var unserved = local.filter(function (u) { return !access.isServableFile(u.split('?')[0]); });
check('every file the page and its frames load is one the server sends', local.indexOf('promo-banner.js') !== -1 && !unserved.length, unserved);

/* the shell's script is ES5, as the console's pages are */
var code = shell.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
check('the shell\'s script parses', (function () { try { new vm.Script(shell); return true; } catch (e) { return false; } })());
check('the shell\'s script is ES5: no let, const or arrow functions', !/\blet\s/.test(code) && !/\bconst\s/.test(code) && code.indexOf('=>') === -1);

/* TABS and tabFrom, read from the script itself */
var tabsSrc = (/var TABS = (\[[\s\S]*?\]);/.exec(shell) || [])[1];
var TABS = tabsSrc ? vm.runInNewContext('(' + tabsSrc + ')') : null;
check('three tabs: Social posts, Site-look posts, Mailers', JSON.stringify(TABS) === JSON.stringify([
  { id: 'posts', label: 'Social posts', root: 'promo-social-root' },
  { id: 'site-posts', label: 'Site-look posts', root: 'promo-posts-root' },
  { id: 'mailers', label: 'Mailers', root: 'promo-mailers-root' }]), TABS);
var tabFromSrc = (/function tabFrom\(v\)\{[^\n]*\}/.exec(shell) || [])[0];
var tabFrom = tabFromSrc ? vm.runInNewContext('(' + tabFromSrc + ')') : function () { return null; };
[['mailers', 'mailers'], ['site-posts', 'site-posts'], ['posts', 'posts'], [null, 'posts'], ['', 'posts'], ['social', 'posts'],
  ['ads', 'posts'], ['Mailers', 'posts'], ['site_posts', 'posts'], ['__proto__', 'posts']].forEach(function (c) {
  check('tabFrom(' + JSON.stringify(c[0]) + ') → ' + c[1], tabFrom(c[0]) === c[1], tabFrom(c[0]));
});
var SOCIAL_FRAME = '<iframe class="promo-social-frame" id="promo-social-frame" title="Social posts" src="promo-social-studio.html?event=\' +\n        encodeURIComponent(eventId) + \'"></iframe>';
check('the Social posts frame: its class, id, title and address', count(shell, SOCIAL_FRAME) === 1);

/* ---------- the page's script in a vm ---------- */
var ORIGIN = 'https://oneworld.test';
function classList(initial) {
  var set = {};
  String(initial || '').split(/\s+/).filter(Boolean).forEach(function (c) { set[c] = true; });
  return {
    add: function (c) { set[c] = true; }, remove: function (c) { delete set[c]; }, contains: function (c) { return !!set[c]; },
    toggle: function (c, force) { var on = force === undefined ? !set[c] : !!force; if (on) set[c] = true; else delete set[c]; return on; },
    list: function () { return Object.keys(set).sort(); }
  };
}
function makeWin(name) {
  var w = { name: name, got: [], listeners: {} };
  w.postMessage = function (msg, origin) { w.got.push({ msg: JSON.parse(JSON.stringify(msg)), origin: origin }); };
  w.addEventListener = function (t, fn) { (w.listeners[t] = w.listeners[t] || []).push(fn); };
  w.fire = function (t) { (w.listeners[t] || []).forEach(function (fn) { fn({}); }); };
  return w;
}

/* o: { search, kit, ev, banner(id, opts) -> promise, noBanner, noPosts } */
function load(o) {
  o = o || {};
  var els = {}, toasts = [], urls = [], calls = { mount: [], shown: 0, ensure: [], scroll: [], use: [] };
  var html = { classList: classList() };
  function inside(el, host) { for (var p = el.parentNode; p; p = p.parentNode) if (p === host) return true; return false; }
  function attrsOf(s) { var a = {}, m, re = /([\w-]+)="([^"]*)"/g; while ((m = re.exec(s))) a[m[1]] = m[2]; return a; }
  function el(id, tag, attrs, parent) {
    attrs = attrs || {};
    var e = { id: id, tagName: tag.toUpperCase(), attrs: attrs, parentNode: parent || null, hidden: /\shidden(\s|$|>)/.test(attrs.__raw || ''),
      style: {}, listeners: {}, tabIndex: 0, textContent: '', _html: '', _tablist: null, classList: classList(attrs.class) };
    e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
    e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
    e.addEventListener = function (t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); };
    e.fire = function (t, ev) { (e.listeners[t] || []).forEach(function (fn) { fn(ev || {}); }); };
    e.focus = function () { calls.focused = e.id; };
    e.querySelector = function (sel) { return sel === '[role="tablist"]' ? e._tablist : null; };
    Object.defineProperty(e, 'innerHTML', {
      get: function () { return e._html; },
      set: function (v) {
        e._html = String(v);
        Object.keys(els).forEach(function (k) { if (inside(els[k], e)) delete els[k]; });
        e._tablist = null;
        /* the elements nest as written, so a frame inside a hidden pane measures 0, as it does in a browser */
        var m, re = /<(\/?)(\w+)\b([^>]*)>/g, open = [e];
        while ((m = re.exec(e._html))) {
          if (m[1]) { if (open.length > 1) open.pop(); continue; }
          var a = attrsOf(m[3]); a.__raw = m[3];
          var c = el(a.id || '', m[2], a, open[open.length - 1]);
          if (!/^(br|hr|img|input|meta|link)$/i.test(m[2]) && !/\/\s*$/.test(m[3])) open.push(c);
          if (a.role === 'tablist') e._tablist = c;
          if (!a.id) continue;
          if (m[2] === 'iframe') {
            c.contentWindow = makeWin(a.id);
            Object.defineProperty(c, 'offsetHeight', { get: function () {
              for (var p = this.parentNode; p; p = p.parentNode) if (p.hidden) return 0;
              return parseInt(this.style.height, 10) || 680;
            } });
          }
          els[a.id] = c;
        }
      }
    });
    return e;
  }
  ['ev-name', 'ev-meta', 'rail', 'view'].forEach(function (id) { els[id] = el(id, 'div'); });
  var doc = { documentElement: html, title: '', getElementById: function (id) { return els[id] || null; } };
  var winListeners = {};
  var C = {
    $: function (id) { return doc.getElementById(id); },
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    svg: function () { return '<svg></svg>'; }, IC: { info: 'i' }, PORTALS: { etgov: 'ETGovernment' }, TYPES: {},
    fmtDT: function () { return '12 Nov 2026'; }, emptyState: function (ic, t) { return '<div class="empty">' + t + '</div>'; },
    toast: function (m, opts) { toasts.push({ m: m, opts: opts }); },
    fetchEvent: function () { return Promise.resolve(o.ev || { name: 'Agentic AI Summit', portal: 'etgov', start: '2026-11-12' }); },
    previewUrl: function (id) { return '/preview/' + id; }
  };
  var sb = {
    document: doc, console: { log: function () {}, error: function () { calls.errors = (calls.errors || 0) + 1; } },
    URLSearchParams: URLSearchParams, setTimeout: setTimeout, clearTimeout: clearTimeout,
    location: { search: o.search || '?event=ev-1', origin: ORIGIN, pathname: '/marketing.html', hash: '' },
    history: { replaceState: function (s, t, u) { urls.push(u); } },
    pageYOffset: 0,
    scrollTo: function (x, y) { calls.scroll.push([x, y]); sb.pageYOffset = y; },
    addEventListener: function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    RevampCore: C,
    RevampPromo: { use: function (id) { calls.use.push(id); }, load: function () { return Promise.resolve(o.kit || { brand: {}, content: {} }); } },
    renderEventRail: function () {}
  };
  sb.window = sb;
  if (!o.noPosts) sb.RevampPromoPosts = { mount: function (host, ctx) { calls.mount.push({ host: host.id, ctx: ctx }); }, shown: function () { calls.shown++; } };
  if (!o.noBanner) sb.RevampPromoBanner = { ensure: function (id, opts) {
    calls.ensure.push([id, JSON.parse(JSON.stringify(opts))]);
    return o.banner ? o.banner(id, opts) : Promise.resolve({ ok: true, url: 'https://storage.googleapis.com/b/events/ev-1/promo-banner/x.jpg' });
  } };
  vm.runInNewContext(shell, sb, { filename: 'marketing.html' });
  function message(data, from, origin) {
    (winListeners.message || []).forEach(function (fn) { fn({ data: data, source: from, origin: origin === undefined ? ORIGIN : origin }); });
  }
  function click(tabId) { els.view._tablist.fire('click', { target: { closest: function () { return { getAttribute: function () { return tabId; } }; } } }); }
  function key(k) { var e = { key: k, prevented: false, preventDefault: function () { e.prevented = true; } }; els.view._tablist.fire('keydown', e); return e; }
  return { sb: sb, els: els, doc: doc, html: html, C: C, toasts: toasts, urls: urls, calls: calls, message: message, click: click, key: key,
    frame: function (id) { return els[id] || null; } };
}
function settle() { return new Promise(function (r) { setTimeout(r, 0); }).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); }); }
function selected(p) { var m = /aria-selected="true"[^>]*data-tab="([\w-]+)"/.exec(p.els.view.innerHTML); return m && m[1]; }

var pending = [];

/* ---- the page as it opens: the heading, the tabs, the title ---- */
var P = load({ search: '?event=ev-1' });
pending.push(settle().then(function () {
  var view = P.els.view.innerHTML;
  check('the heading line says what each tab makes', view.indexOf('<div class="sub">Social posts in the ET portal’s look, posts in this site’s own look, and mailers — all from this event’s real speakers, partners and agenda.</div>') !== -1, view.slice(0, 400));
  check('the window\'s title names the event and Oneworld 2.0', P.doc.title === 'Promotions — Agentic AI Summit — Oneworld 2.0', P.doc.title);
  check('three tab buttons in order', (view.match(/data-tab="([\w-]+)"/g) || []).join() === 'data-tab="posts",data-tab="site-posts",data-tab="mailers"');
  check('three panes, each with its root', ['promo-social-root', 'promo-posts-root', 'promo-mailers-root'].every(function (r) { return !!P.els[r]; }));
  check('no tab in the address: Social posts', selected(P) === 'posts' && !P.els['pane-posts'].hidden && P.els['pane-site-posts'].hidden && P.els['pane-mailers'].hidden);
  var f = P.frame('promo-social-frame');
  check('Social posts is the platform\'s studio, framed on this event', !!f && f.attrs.src === 'promo-social-studio.html?event=ev-1' &&
    f.attrs.title === 'Social posts' && f.classList.contains('promo-social-frame') && f.parentNode === P.els['promo-social-root'], f && f.attrs);
  check('… and nothing else is mounted yet: no site-look studio, no mailer frame, no banner', !P.calls.mount.length && !P.frame('promo-mailer-frame') && !P.calls.ensure.length);

  /* switching tabs: each studio mounted once, kept; Site-look posts told when shown again; the banner started once */
  P.click('site-posts');
  check('Site-look posts: promo-posts.js mounted in its root with the event and its Kit', P.calls.mount.length === 1 && P.calls.mount[0].host === 'promo-posts-root' &&
    P.calls.mount[0].ctx.eventId === 'ev-1' && !!P.calls.mount[0].ctx.kit && typeof P.calls.mount[0].ctx.toast === 'function', P.calls.mount);
  check('the address follows the tab', P.urls[P.urls.length - 1] === 'marketing.html?event=ev-1&tab=site-posts', P.urls);
  check('the panes follow the tab', P.els['pane-posts'].hidden && !P.els['pane-site-posts'].hidden);
  P.click('posts');
  check('back to Social posts: the same frame, not a new one, and no shown() for it', P.frame('promo-social-frame') === f && P.calls.shown === 0);
  P.click('site-posts');
  check('Site-look posts shown again: shown(), not a second mount', P.calls.mount.length === 1 && P.calls.shown === 1, P.calls);
  P.click('mailers');
  var mf = P.frame('promo-mailer-frame');
  check('Mailers: the mailer studio framed on this event', !!mf && mf.attrs.src === 'promo-mailer-studio.html?event=ev-1' && mf.classList.contains('promo-mailer-frame'), mf && mf.attrs);
  check('the first time Mailers is shown, the mail banner is started for this event', JSON.stringify(P.calls.ensure) === JSON.stringify([['ev-1', { fresh: false }]]), P.calls.ensure);
  P.click('posts'); P.click('mailers');
  check('… and not again when Mailers is shown again', P.calls.ensure.length === 1 && P.frame('promo-mailer-frame') === mf, P.calls.ensure);

  /* the arrow keys move between the three tabs */
  P.click('posts');
  var k = P.key('ArrowRight');
  check('ArrowRight from Social posts → Site-look posts', k.prevented && /tab=site-posts$/.test(P.urls[P.urls.length - 1]), P.urls.slice(-1));
  P.key('End');
  check('End → Mailers', /tab=mailers$/.test(P.urls[P.urls.length - 1]), P.urls.slice(-1));
  P.key('ArrowRight');
  check('ArrowRight from Mailers wraps to Social posts', /tab=posts$/.test(P.urls[P.urls.length - 1]), P.urls.slice(-1));
  P.key('ArrowLeft');
  check('ArrowLeft from Social posts wraps to Mailers', /tab=mailers$/.test(P.urls[P.urls.length - 1]), P.urls.slice(-1));
  P.key('Home');
  check('Home → Social posts, focused', /tab=posts$/.test(P.urls[P.urls.length - 1]) && P.calls.focused === 'tab-posts', [P.urls.slice(-1), P.calls.focused]);
}));

/* ---- each tab from the address ---- */
[['?event=ev-1&tab=site-posts', 'site-posts'], ['?event=ev-1&tab=mailers', 'mailers'], ['?event=ev-1&tab=posts', 'posts'],
  ['?event=ev-1&tab=social', 'posts'], ['?event=ev-1&tab=whatsapp', 'posts']].forEach(function (c) {
  var p = load({ search: c[0] });
  pending.push(settle().then(function () {
    var mounted = { posts: !!p.frame('promo-social-frame'), 'site-posts': p.calls.mount.length === 1, mailers: !!p.frame('promo-mailer-frame') };
    var only = Object.keys(mounted).filter(function (k) { return mounted[k]; });
    check(c[0] + ' opens ' + c[1] + ' and mounts only it', selected(p) === c[1] && only.join() === c[1], [selected(p), only]);
  }));
});
var deep = load({ search: '?event=ev%201&tab=mailers&mailer=mailer.a&version=s%202' });
pending.push(settle().then(function () {
  var mf = deep.frame('promo-mailer-frame');
  check('a deep link to a mailer version reaches the mailer frame', !!mf && mf.attrs.src === 'promo-mailer-studio.html?event=ev%201&mailer=mailer.a&version=s%202', mf && mf.attrs.src);
  check('the banner is started for that event', deep.calls.ensure.length === 1 && deep.calls.ensure[0][0] === 'ev 1', deep.calls.ensure);
}));
var noPosts = load({ search: '?event=ev-1&tab=site-posts', noPosts: true });
pending.push(settle().then(function () {
  check('Site-look posts that did not load: a plain message, not a broken tab', /The posts studio did not load\. Reload the page\./.test(noPosts.els['promo-posts-root'].innerHTML));
}));

/* ---- the listener: what the frames tell the page ---- */
var L = load({ search: '?event=ev-1&tab=mailers' });
pending.push(settle().then(function () {
  L.click('posts');
  var sf = L.frame('promo-social-frame'), mf = L.frame('promo-mailer-frame'), sw = sf.contentWindow, mw = mf.contentWindow;
  var stranger = { postMessage: function () { throw new Error('never answered'); } };

  L.message({ rvSocialStudio: 'open' }, sw, 'https://elsewhere.test');
  L.message({ rvSocialStudio: 'open' }, stranger);
  L.message({ rvSocialStudio: 'open' }, null);
  L.message({ rvMailerStudio: 'open' }, sw);
  L.message({ rvSocialHeight: 2400 }, sw, 'null');
  L.message({ rvToast: { m: 'From elsewhere' } }, stranger);
  L.message({ rvToast: { m: 'From elsewhere' } }, sw, 'https://elsewhere.test');
  L.message('rvSocialStudio', sw);
  check('another origin, another window, or a frame speaking for the other one: ignored', !sf.classList.contains('is-studio') && !mf.classList.contains('is-studio') &&
    !L.html.classList.contains('promo-studio-open') && !sf.style.height && !sw.got.length && !L.toasts.length, [sf.classList.list(), mf.classList.list(), sf.style, L.toasts]);

  /* heights */
  L.message({ rvSocialHeight: 300 }, sw);
  check('a short page: the frame keeps the studio\'s 620 px minimum', sf.style.height === '620px', sf.style.height);
  check('the first height is answered rvSocialTall, to that frame only, on this origin', JSON.stringify(sw.got) === JSON.stringify([{ msg: { rvSocialTall: true }, origin: ORIGIN }]) &&
    !mw.got.length, [sw.got, mw.got]);
  L.message({ rvSocialHeight: 2400.4 }, sw);
  check('the frame grows to its content (whole pixels, rounded up)', sf.style.height === '2401px', sf.style.height);
  check('rvSocialTall is said once', sw.got.length === 1, sw.got);
  ['abc', -5, 0, Infinity, NaN, {}].forEach(function (h) { L.message({ rvSocialHeight: h }, sw); });
  check('a height that is not a positive number is ignored', sf.style.height === '2401px', sf.style.height);
  L.message({ rvMailerHeight: 5200 }, mw);
  check('the mailer frame grows on its own report and is told rvMailerTall', mf.style.height === '5200px' && JSON.stringify(mw.got) === JSON.stringify([{ msg: { rvMailerTall: true }, origin: ORIGIN }]) &&
    sf.style.height === '2401px' && sw.got.length === 1, [mf.style.height, mw.got]);
  L.message({ rvMailerHeight: 900 }, sw);
  check('the social frame cannot set the mailer frame\'s height', mf.style.height === '5200px');

  /* the studio takes the whole window and gives it back where the page was */
  L.sb.pageYOffset = 1300;
  L.message({ rvSocialStudio: 'open' }, sw);
  check('open: the frame is full-window and the page is locked', sf.classList.contains('is-studio') && L.html.classList.contains('promo-studio-open'), [sf.classList.list(), L.html.classList.list()]);
  check('open: the host keeps the frame\'s height, so the page keeps its length', L.els['promo-social-root'].style.minHeight === '2401px', L.els['promo-social-root'].style);
  check('open: the reported height is set aside, so the full-window rule applies', sf.style.height === '', sf.style.height);
  L.message({ rvSocialHeight: 9999 }, sw);
  check('no height is taken while the studio fills the window', sf.style.height === '', sf.style.height);
  L.sb.pageYOffset = 0;
  L.message({ rvSocialStudio: 'open' }, sw);
  check('a second open does not measure again', L.els['promo-social-root'].style.minHeight === '2401px');
  check('the other frame is untouched', !mf.classList.contains('is-studio') && mf.style.height === '5200px');
  L.message({ rvSocialStudio: 'close' }, sw);
  check('close: back in the page at its height, the host let go, the page unlocked', !sf.classList.contains('is-studio') && sf.style.height === '2401px' &&
    L.els['promo-social-root'].style.minHeight === '' && !L.html.classList.contains('promo-studio-open'), [sf.classList.list(), sf.style, L.html.classList.list()]);
  check('close: the scroll is put back where it was', JSON.stringify(L.calls.scroll[L.calls.scroll.length - 1]) === '[0,1300]', L.calls.scroll);
  var scrolls = L.calls.scroll.length;
  L.message({ rvSocialStudio: 'close' }, sw);
  check('a close with nothing open does nothing', L.calls.scroll.length === scrolls && !L.html.classList.contains('promo-studio-open'));
  L.click('mailers');
  L.message({ rvMailerStudio: 'open' }, mw);
  check('the mailer studio opens on its own message', mf.classList.contains('is-studio') && L.html.classList.contains('promo-studio-open') &&
    L.els['promo-mailers-root'].style.minHeight === '5200px' && !sf.classList.contains('is-studio'));
  L.message({ rvMailerStudio: 'close' }, mw);
  check('… and closes on it', !mf.classList.contains('is-studio') && !L.html.classList.contains('promo-studio-open') && mf.style.height === '5200px');
  L.click('posts');

  /* toasts from a tall frame are the console's */
  L.message({ rvToast: { m: '✓ Saved — your edits will reload next time', ms: 2200 } }, sw);
  var long = new Array(41).join('0123456789');
  L.message({ rvToast: { m: long, ms: 6000 } }, mw);
  L.message({ rvToast: { m: '   ' } }, sw);
  L.message({ rvToast: 'no object' }, sw);
  check('rvToast is shown by the console, at most 300 characters', L.toasts.length === 2 && L.toasts[0].m === '✓ Saved — your edits will reload next time' &&
    L.toasts[1].m === long.slice(0, 300), L.toasts.map(function (t) { return t.m.length; }));
  check('a usual toast is plain (the platform\'s words carry their own ✓); a long one (6 s) is shown as a refusal, kept up as long',
    L.toasts[0].opts && L.toasts[0].opts.kind === 'info' && L.toasts[1].opts && L.toasts[1].opts.kind === 'error', L.toasts.map(function (t) { return t.opts; }));
  var markup = '<img src=x onerror=alert(1)>';
  L.message({ rvToast: { m: markup } }, sw);
  var last = L.toasts[L.toasts.length - 1];
  check('a toast with markup in it reaches the console\'s toast() as the same words, a string, untouched here', L.toasts.length === 3 &&
    typeof last.m === 'string' && last.m === markup, last);

  /* the mail banner, asked by the mailer frame */
  L.calls.ensure.length = 0;
  L.message({ rvBanner: 'ensure', id: 'b1' }, sw);
  check('the social frame cannot ask for the banner', !L.calls.ensure.length);
  L.message({ rvBanner: 'ensure', id: 'b2' }, mw);
  L.message({ rvBanner: 'ensure', id: 'b3', fresh: true }, mw);
  return settle().then(function () {
    check('the mailer frame\'s asks reach RevampPromoBanner.ensure for this event, fresh when it says so',
      JSON.stringify(L.calls.ensure) === JSON.stringify([['ev-1', { fresh: false }], ['ev-1', { fresh: true }]]), L.calls.ensure);
    var answers = mw.got.filter(function (g) { return g.msg.rvBannerReady; });
    check('each is answered rvBannerReady with its id, to the mailer frame on this origin', JSON.stringify(answers) === JSON.stringify([
      { msg: { rvBannerReady: { id: 'b2', ok: true } }, origin: ORIGIN }, { msg: { rvBannerReady: { id: 'b3', ok: true } }, origin: ORIGIN }]), answers);
    check('the social frame hears nothing of it', !sw.got.some(function (g) { return g.msg.rvBannerReady; }), sw.got);
  });
}));

/* the banner's answers when it could not be made */
function bannerCase(name, o, expect) {
  var B = load(Object.assign({ search: '?event=ev-1&tab=mailers' }, o));
  pending.push(settle().then(function () {
    var w = B.frame('promo-mailer-frame').contentWindow;
    B.message({ rvBanner: 'ensure', id: 7 }, w);
    return settle().then(function () {
      var a = w.got.filter(function (g) { return g.msg.rvBannerReady; }).map(function (g) { return g.msg.rvBannerReady; });
      check(name, a.length === 1 && a[0].id === 7 && a[0].ok === false && expect(a[0].error), a);
    });
  }));
}
bannerCase('a banner that could not be drawn: ok false with its reason', { banner: function () { return Promise.resolve({ ok: false, error: 'The banner could not be drawn.' }); } },
  function (e) { return e === 'The banner could not be drawn.'; });
bannerCase('a banner run that rejects (it should not): still answered, ok false', { banner: function () { return Promise.reject(new Error('boom')); } },
  function (e) { return e === 'boom'; });
bannerCase('a banner run that throws: still answered, ok false', { banner: function () { throw new Error('thrown'); } },
  function (e) { return e === 'thrown'; });
bannerCase('no banner script on the page: answered at once, ok false, never left waiting', { noBanner: true },
  function (e) { return /did not load/.test(e); });

/* a frame whose own page is reloaded starts again */
var R = load({ search: '?event=ev-1' });
pending.push(settle().then(function () {
  var f = R.frame('promo-social-frame'), w = f.contentWindow;
  R.message({ rvSocialHeight: 1800 }, w);
  R.sb.pageYOffset = 400;
  R.message({ rvSocialStudio: 'open' }, w);
  f.fire('load');
  w.fire('pagehide');
  check('its page reloaded while open: the frame is back in the page, unlocked, scroll put back', !f.classList.contains('is-studio') &&
    !R.html.classList.contains('promo-studio-open') && f.style.height === '1800px' && JSON.stringify(R.calls.scroll.slice(-1)) === '[[0,400]]', [f.classList.list(), R.calls.scroll]);
  var told = w.got.length;
  R.message({ rvSocialHeight: 1900 }, w);
  check('… and its new page is told rvSocialTall again on its first height', w.got.length === told + 1 && w.got[told].msg.rvSocialTall === true, w.got);
}));

/* a studio that goes full-window in a hidden tab (a deep-linked mailer opens after its previews load, which can be
   after the user has moved on): nothing on screen is covered, so the tab that is shown keeps scrolling */
var H = load({ search: '?event=ev-1&tab=mailers&mailer=mailer.a' });
pending.push(settle().then(function () {
  var mf = H.frame('promo-mailer-frame'), mw = mf.contentWindow;
  function locked() { return H.html.classList.contains('promo-studio-open'); }
  function lastScroll() { return JSON.stringify(H.calls.scroll[H.calls.scroll.length - 1] || null); }
  H.message({ rvMailerHeight: 3000 }, mw);
  H.click('posts');
  var sf = H.frame('promo-social-frame'), sw = sf.contentWindow;
  H.message({ rvSocialHeight: 2000 }, sw);
  H.sb.pageYOffset = 250;
  H.message({ rvMailerStudio: 'open' }, mw);
  check('a studio opening in a hidden tab: its frame is full-window, but the tab on screen is not locked', mf.classList.contains('is-studio') && !locked(),
    [mf.classList.list(), H.html.classList.list()]);
  check('… and its host keeps the height the frame reported (a frame in a hidden tab measures 0)', H.els['promo-mailers-root'].style.minHeight === '3000px',
    H.els['promo-mailers-root'].style);
  H.click('site-posts');
  check('… nor any other tab without a studio open', !locked());
  H.sb.pageYOffset = 900;
  H.click('mailers');
  check('its tab shown: the studio covers it, and the page is locked', locked());
  H.click('posts');
  check('away again: unlocked', !locked());
  H.click('mailers');
  H.message({ rvMailerStudio: 'close' }, mw);
  check('closed on screen: unlocked, back in the page at its height, the host let go', !locked() && !mf.classList.contains('is-studio') &&
    mf.style.height === '3000px' && H.els['promo-mailers-root'].style.minHeight === '', [H.html.classList.list(), mf.style]);
  check('… and the page put back where it was when the studio covered it (its tab shown at 900, not the other tab\'s 250)', lastScroll() === '[0,900]', H.calls.scroll);

  /* open on screen, then the tabs are moved with the keyboard (focus can reach the tab list behind the frame) */
  H.sb.pageYOffset = 400;
  H.message({ rvMailerStudio: 'open' }, mw);
  check('open on screen: locked', locked() && H.els['promo-mailers-root'].style.minHeight === '3000px');
  H.key('ArrowRight');
  check('the arrow key to Social posts: that tab is shown and scrolls', /tab=posts$/.test(H.urls[H.urls.length - 1]) && !locked(), [H.urls.slice(-1), H.html.classList.list()]);
  H.sb.pageYOffset = 1500;
  var n = H.calls.scroll.length;
  H.message({ rvMailerStudio: 'close' }, mw);
  check('a close from the hidden tab: back in its page, and the tab on screen does not move', !mf.classList.contains('is-studio') && mf.style.height === '3000px' &&
    !locked() && H.calls.scroll.length === n, H.calls.scroll.slice(n));

  /* both: the studio on screen keeps the lock whatever the hidden one does */
  H.sb.pageYOffset = 600;
  H.message({ rvSocialStudio: 'open' }, sw);
  H.message({ rvMailerStudio: 'open' }, mw);
  check('the social studio on screen, the mailer one hidden: locked', locked() && sf.classList.contains('is-studio') && mf.classList.contains('is-studio'));
  n = H.calls.scroll.length;
  H.message({ rvMailerStudio: 'close' }, mw);
  check('the hidden one closes: still locked by the one on screen, and nothing scrolled', locked() && H.calls.scroll.length === n);
  H.message({ rvSocialStudio: 'close' }, sw);
  check('the one on screen closes: unlocked and put back', !locked() && lastScroll() === '[0,600]', H.calls.scroll.slice(-1));
}));

/* the console's toast() is what keeps a relayed toast from being markup: it writes the words through esc() */
var core = read('edit-event-core.js');
var toastSrc = (/\n  function toast\(msg, kind\)\{([\s\S]*?)\n  \}\n/.exec(core) || [])[1] || '';
check('the console\'s toast() uses its words only escaped', !!toastSrc && count(toastSrc, 'esc(msg)') === 1 &&
  count(toastSrc.replace(/\besc\(msg\)/g, ''), 'msg') === 0, toastSrc.slice(0, 200));
var escSrc = (/\n  function esc\(s\)\{[\s\S]*?\n  \}\n/.exec(core) || [])[0];
var coreEsc = escSrc ? vm.runInNewContext('(' + escSrc.trim() + ')') : function () { return null; };
check('… and its esc() turns markup into text', coreEsc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;' &&
  coreEsc('"\'&') === '&quot;&#39;&amp;', coreEsc('<img src=x onerror=alert(1)>'));

/* ---------- promo.css ---------- */
var rules = [], rm, rre = /([^{}]+)\{([^{}]*)\}/g, cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
while ((rm = rre.exec(cssCode))) {
  var decl = {};
  rm[2].split(';').forEach(function (d) { var i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  rules.push({ sel: rm[1].trim().split(',').map(function (s) { return s.trim(); }), decl: decl, text: rm[2] });
}
function ruleOf(sel) { return rules.filter(function (r) { return r.sel.indexOf(sel) !== -1; }); }
function only(sel) { var r = ruleOf(sel); return r.length === 1 ? r[0] : null; }

var frameRule = only('.promo-mailer-frame'), studioRule = only('.promo-mailer-frame.is-studio');
check('.promo-social-frame shares the frame rule with .promo-mailer-frame', !!frameRule && frameRule.sel.join() === '.promo-mailer-frame,.promo-social-frame' &&
  frameRule.decl.height === 'calc(100vh - 220px)' && frameRule.decl['min-height'] === '620px', frameRule);
check('… and the full-window rule', !!studioRule && studioRule.sel.join() === '.promo-mailer-frame.is-studio,.promo-social-frame.is-studio' &&
  studioRule.decl.position === 'fixed' && studioRule.decl.height === '100vh' && studioRule.decl['z-index'] === '1000', studioRule);
check('no other rule for either frame', ruleOf('.promo-social-frame').length === 1 && ruleOf('.promo-social-frame.is-studio').length === 1);
check('the page is locked while a studio is open', !!only('html.promo-studio-open') && only('html.promo-studio-open').decl.overflow === 'hidden');
/* the 620 px minimum is the same in the rule and in the script that grows the frame */
check('the script\'s minimum height is the rule\'s', shell.indexOf('Math.max(620, h)') !== -1);

var grid = only('.ps-grid');
check('the posts gallery\'s cards are about 360 px or wider, one column on a phone', !!grid && grid.decl['grid-template-columns'] === 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', grid && grid.decl);
var offThumb = only('.ps-card.off .ps-thumb');
check('an unavailable card\'s preview is in full colour', !!offThumb && offThumb.decl.opacity === '1' && offThumb.decl.filter === 'none', offThumb && offThumb.decl);
check('no rule fades a post preview (the lock icon of a card with no preview at all is not one)', !rules.some(function (r) { return r.sel.some(function (s) { return /\.ps-thumb(?!-)|ps-scale|\.pp\b/.test(s); }) && r.decl.opacity && r.decl.opacity !== '1'; }));
['.ps-ex', '.ps-ex-note', '.ps-chip', '.ps-lb', '.ps-lb-bar', '.ps-lb-col', '.ps-lb-x'].forEach(function (s) { check('a rule for ' + s, !!only(s)); });
check('[data-example-thumb] and [data-example] have their rules', ruleOf('.ps-card.off [data-example-thumb]').length === 1 && ruleOf('.pp[data-example]::after').length === 1);
check('a hidden full-size view stays hidden (its display:flex would beat [hidden])', !!only('.ps-lb[hidden]') && only('.ps-lb[hidden]').decl.display === 'none');
var lb = only('.ps-lb');
check('the full-size view covers the window above the console, below its toasts', !!lb && lb.decl.position === 'fixed' && lb.decl.inset === '0' &&
  +lb.decl['z-index'] > 40 && +lb.decl['z-index'] < 99 && lb.decl.overflow === 'auto', lb && lb.decl);
check('the full-size view is a column of the post\'s width, never wider than the window', !!only('.ps-lb-col') && only('.ps-lb-col').decl['max-width'] === '100%');
check('its bar stays in view', !!only('.ps-lb-bar') && only('.ps-lb-bar').decl.position === 'sticky' && only('.ps-lb-bar').decl.top === '0');
/* the badge and the chip sit on the picture, on their own ground; the mark inside the post is drawn in post pixels */
check('on the picture: badge and chip at its top left, the note at its foot', !!only('.ps-thumb .ps-ex') && only('.ps-thumb .ps-ex').decl.position === 'absolute' &&
  !!only('.ps-thumb .ps-ex-note') && only('.ps-thumb .ps-ex-note').decl.bottom === '0');
var mark = only('.pp[data-example]::after');
check('the mark inside an example post reads EXAMPLE and scales with the post', !!mark && mark.decl.content === "'EXAMPLE'" && /var\(--k\)/.test(mark.decl['font-size'] || '') &&
  mark.decl['pointer-events'] === 'none', mark && mark.decl);

/* the new rules are on the console's tokens (edit-event.css), so they follow its light and dark */
var NEW = ['.ps-ex', '.ps-ex-note', '.ps-ex-note a', '.ps-chip', '.ps-thumb .ps-ex-note', '.ps-lb-bar', '.ps-lb-x', '.ps-lb-x:hover'];
NEW.forEach(function (s) {
  var r = only(s);
  check(s + ': colours from the console\'s tokens only', !!r && !/#[0-9a-f]{3,8}\b|rgba?\(/i.test(r.text), r && r.text);
});
var ee = read('edit-event.css').replace(/\/\*[\s\S]*?\*\//g, '');
function tokens(sel) {
  var at = ee.indexOf(sel + '{');
  if (at === -1) return null;
  var body = ee.slice(at + sel.length + 1, ee.indexOf('}', at)), out = {}, m, re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  while ((m = re.exec(body))) out[m[1]] = m[2].trim();
  return out;
}
var LIGHT = tokens(':root'), DARK = tokens(':root[data-theme="dark"]');
check('edit-event.css has the console\'s light and dark tokens', !!LIGHT && !!DARK && !!LIGHT['--text'] && !!DARK['--text']);
function lum(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { var c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
  .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0); }
function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function resolve(v, T) { var m = /^var\((--[\w-]+)\)$/.exec(String(v || '').trim()); return m ? T[m[1]] : null; }
/* each new colour pair: the words' colour and the ground they sit on (the rule's own background, else the one
   it is drawn on: a card or the bar, --surface) */
[['.ps-ex', null, 'the Example badge'], ['.ps-ex-note', 'var(--surface)', 'the example note on a card or the bar'],
 ['.ps-ex-note a', 'var(--surface)', 'the note\'s link'], ['.ps-thumb .ps-ex-note', null, 'the note along a picture\'s foot'],
 ['.ps-chip', null, 'the state chip'], ['.ps-lb-bar', null, 'the full-size view\'s bar'], ['.ps-lb-x', null, 'its ✕'],
 ['.ps-lb-x:hover', 'var(--surface-2)', 'its ✕ under the pointer']].forEach(function (p) {
  var r = only(p[0]);
  [['light', LIGHT || {}], ['dark', DARK || {}]].forEach(function (t) {
    var fg = r && resolve(r.decl.color, t[1]), bg = resolve(p[1] || (r && r.decl.background), t[1]);
    var k = fg && bg ? ratio(fg, bg) : 0;
    check('AA, ' + t[0] + ': ' + p[2] + ' (' + k.toFixed(2) + ':1)', k >= 4.5, [p[0], fg, bg]);
  });
});
/* the mark inside the post is white on a dark band whatever the post's colours: over white, its lightest case */
var band = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(mark ? mark.decl.background : '');
var over = band ? '#' + [1, 2, 3].map(function (i) { return ('0' + Math.round(+band[i] * +band[4] + 255 * (1 - +band[4])).toString(16)).slice(-2); }).join('') : '#ffffff';
check('AA: the EXAMPLE mark inside the post, on its band over a white post (' + ratio('#ffffff', over).toFixed(2) + ':1)', !!mark && mark.decl.color === '#ffffff' && ratio('#ffffff', over) >= 4.5, over);
check('the badge is set apart from any post under it', !!only('.ps-ex') && /var\(--surface\)/.test(only('.ps-ex').decl['box-shadow'] || ''));

Promise.all(pending).then(function () {
  if (failed) { console.error('promotions-page: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promotions-page: all ' + passed + ' checks passed');
}, function (err) { console.error('promotions-page: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
