// node functions/lib/assistant-pages.test.js — where the one ETB2B AI is put on a page (ai-everywhere plan §3b, §4b,
// §10 U5, §11a). The owner (2026-11-05): "keep consistency in the AI Bot … keep it across and place it in the bottom
// right corner". So every page a signed-in team member works on carries the same mount, the kit's stylesheet and the
// same scripts in the same order, and no other page in the repository carries any of them: not a published site, a
// preview, a shared link, a framed studio, the sign-in page or a redirect stub.
//
// The pages are read as files. Their markup is walked the way a browser's parser would see it (comments dropped, the
// insides of <script> and <style> skipped), so a string in a page's code or a comment naming a file never counts as a
// mount or a script tag. Every script a page loads is parsed, and the shell (etb2b-assistant.js) is run in a vm with
// stand-ins for the window, the kit and sign-in, so a shell that cannot run fails here, not on ten pages at once.
// No network, no browser, no AI.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var access = require('./access');

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function exists(f) { return fs.existsSync(path.join(ROOT, f)); }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function count(s, needle) { return s.split(needle).length - 1; }

/* ---------- the contract (plan §3b) ---------- */
/* Each page, its place name (the mount's data-rv-assistant, which the shell reads), the mount's id and what the
   launcher keeps clear of (data-keep-clear; null = no attribute). The dashboard keeps its old mount id, rv-dash-bot,
   because tests on other branches pin it and its toasts follow it. */
var PAGES = [
  { file: 'Event_Listing.html', page: 'dashboard', id: 'rv-dash-bot', keep: null },
  { file: 'edit-event.html', page: 'console', id: 'rv-assistant', keep: '.savebar.on' },
  { file: 'create-event.html', page: 'create-event', id: 'rv-assistant', keep: '#wiz-foot' },
  { file: 'marketing.html', page: 'promotions', id: 'rv-assistant', keep: null },
  { file: 'review.html', page: 'review', id: 'rv-assistant', keep: '.decide' },
  { file: 'activity-log.html', page: 'activity-log', id: 'rv-assistant', keep: null },
  { file: 'audience-registrations.html', page: 'registrations', id: 'rv-assistant', keep: null },
  { file: 'mailer-performance.html', page: 'mailer-performance', id: 'rv-assistant', keep: null },
  { file: 'portal-review.html', page: 'portal-review', id: 'rv-assistant', keep: '.pr-actions' }
];
/* The site editor is built by its own unit (U4); its mount follows the same contract, with a fourth script after the
   three (its place adapter) and the floating toolbars to keep clear of. Its exact selector text is U4's to measure,
   so only the three toolbars it must name are pinned. */
var EDITOR = { file: 'custom_editor.html', page: 'editor', id: 'rv-assistant', keepNames: ['.tpl-sel-toolbar', '.tpl-sec-toolbar', '.tpl-pop'] };
var KIT = ['etb2b-chat.js', 'dash-bot-client.js', 'etb2b-assistant.js'];
var EDITOR_KIT = KIT.concat(['editor-chat-client.js']);
var CSS = 'etb2b-chat.css';
var ALLOWED = PAGES.map(function (p) { return p.file; }).concat([EDITOR.file]);
var PLACES = ['dashboard', 'console', 'create-event', 'editor', 'promotions', 'review', 'activity-log', 'registrations', 'mailer-performance', 'portal-review'];

/* ---------- reading markup ---------- */
/* The page with every comment, and the inside of every <script> and <style>, turned into spaces of the same length
   (new lines kept), so offsets still point into the file. One left-to-right pass, so whichever starts first wins:
   a "<script>" written inside a comment, or a "<!--" inside a script's string, cannot fool it. */
function blank(s) { return s.replace(/[^\n]/g, ' '); }
function markupOf(src) {
  return src.replace(/<!--[\s\S]*?-->|(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)|(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    function (m, so, sbody, sc, to, tbody, tc) {
      if (so) return so + blank(sbody) + sc;
      if (to) return to + blank(tbody) + tc;
      return blank(m);
    });
}
function attrsOf(s) {
  var out = {}, re = /([^\s=\/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g, m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
  return out;
}
function tagsOf(markup) {
  var out = [], re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, m;
  while ((m = re.exec(markup))) out.push({ close: m[1] === '/', name: m[2].toLowerCase(), raw: m[3], attrs: attrsOf(m[3]), index: m.index, end: m.index + m[0].length });
  return out;
}
var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
/* the elements still open where a tag starts (html, head and body left out): [] means a direct child of <body>.
   A closing tag closes everything opened after its own opening tag, as the parser does for a <p> left open. */
function openAt(tags, at) {
  var stack = [];
  for (var i = 0; i < tags.length && tags[i].index < at; i++) {
    var t = tags[i];
    if (VOID[t.name] || /\/\s*$/.test(t.raw)) continue;
    if (!t.close) { stack.push(t.name); continue; }
    var k = stack.lastIndexOf(t.name);
    if (k !== -1) stack.length = k;
  }
  return stack.filter(function (n) { return n !== 'html' && n !== 'head' && n !== 'body'; });
}
/* where <head> ends: at </head>, or (pages written without it) at the first tag that can only be in <body> */
var HEADISH = { html: 1, head: 1, meta: 1, title: 1, link: 1, style: 1, script: 1, noscript: 1, base: 1 };
function headEnd(tags) {
  for (var i = 0; i < tags.length; i++) {
    if (tags[i].close && tags[i].name === 'head') return tags[i].index;
    if (!tags[i].close && !HEADISH[tags[i].name]) return tags[i].index;
  }
  return -1;
}
function scriptsOf(tags) { return tags.filter(function (t) { return !t.close && t.name === 'script'; }); }
function srcOf(t) { return t.attrs.src === undefined ? '' : t.attrs.src; }

/* ---------- 1. every page the team works on ---------- */
var VALUES = [];
PAGES.concat([EDITOR]).forEach(function (P) {
  var isEditor = P === EDITOR;
  var L = P.file + ': ';
  if (!exists(P.file)) { check(L + 'the page exists', false); return; }
  var src = read(P.file), markup = markupOf(src), tags = tagsOf(markup);

  /* the page is behind sign-in: the assistant never sits on a page anyone can open */
  check(L + 'the page needs sign-in', access.isServableFile(P.file) === true && access.isPublic({ method: 'GET', headers: {} }, '/' + P.file) === false);

  /* the mount: one, with this page's place name, nothing else on it, empty, and a direct child of <body> (a position:
     fixed launcher inside a transformed or clipped box would not sit in the window's corner) */
  var mounts = tags.filter(function (t) { return !t.close && t.attrs['data-rv-assistant'] !== undefined; });
  check(L + 'exactly one data-rv-assistant in the markup', mounts.length === 1, mounts.length);
  check(L + '…and none written anywhere else in the file (no second mount drawn by a script)', (src.match(/data-rv-assistant=/g) || []).length === 1,
    (src.match(/data-rv-assistant=/g) || []).length);
  var M = mounts[0];
  if (!M) return;
  VALUES.push(M.attrs['data-rv-assistant']);
  check(L + 'the mount is a <div id="' + P.id + '">', M.name === 'div' && M.attrs.id === P.id, [M.name, M.attrs.id]);
  check(L + 'its place is "' + P.page + '"', M.attrs['data-rv-assistant'] === P.page, M.attrs['data-rv-assistant']);
  if (isEditor) {
    var kc = M.attrs['data-keep-clear'] || '';
    check(L + 'it keeps clear of the floating toolbars (' + P.keepNames.join(', ') + ')', P.keepNames.every(function (n) {
      return kc.split(',').some(function (part) { return part.trim().indexOf(n) === 0 && !/[\w-]/.test(part.trim().charAt(n.length)); });
    }), kc);
  } else if (P.keep === null) {
    check(L + 'nothing to keep clear: no data-keep-clear', M.attrs['data-keep-clear'] === undefined, M.attrs['data-keep-clear']);
  } else {
    check(L + 'it keeps clear of ' + P.keep, M.attrs['data-keep-clear'] === P.keep, M.attrs['data-keep-clear']);
  }
  var known = { id: 1, 'data-rv-assistant': 1, 'data-keep-clear': 1 };
  check(L + 'no other attribute on the mount (no class or style of the page\'s positions it)', Object.keys(M.attrs).every(function (k) { return known[k]; }), Object.keys(M.attrs));
  check(L + 'the mount is empty (the kit draws inside it)', /^<\/div\s*>/.test(markup.slice(M.end)));
  check(L + 'the mount is a direct child of <body>', same(openAt(tags, M.index), []), openAt(tags, M.index));
  if (M.attrs['data-keep-clear'] !== undefined) {
    /* one CSS selector list of plain classes and ids, the editor's ":not([hidden])" allowed: the shell hands it to
       querySelectorAll, which throws on anything it cannot read */
    check(L + 'data-keep-clear is a plain selector list', M.attrs['data-keep-clear'].split(',').every(function (part) {
      return /^(?:[.#][A-Za-z_][\w-]*)+(?::not\(\[hidden\]\))?$/.test(part.trim());
    }), M.attrs['data-keep-clear']);
  }

  /* the kit's stylesheet: once, in <head> */
  var links = tags.filter(function (t) { return !t.close && t.name === 'link' && t.attrs.href === CSS; });
  var hEnd = headEnd(tags);
  check(L + CSS + ' is linked exactly once', links.length === 1 && src.split('href="' + CSS + '"').length - 1 === 1, links.length);
  check(L + '…as a stylesheet, in <head>', links.length === 1 && links[0].attrs.rel === 'stylesheet' && hEnd !== -1 && links[0].index < hEnd, [links[0] && links[0].attrs, hEnd]);

  /* the scripts: each once, in the shell's order (plan §4b), together, plain (no async or defer: the order is the
     contract), after auth.js (the shell waits for RevampAuth before it mounts) */
  var scripts = scriptsOf(tags), srcs = scripts.map(srcOf);
  var want = isEditor ? EDITOR_KIT : KIT;
  want.forEach(function (f) {
    check(L + f + ' loads exactly once', srcs.filter(function (s) { return s === f; }).length === 1, srcs.filter(function (s) { return s === f; }).length);
  });
  var first = srcs.indexOf(want[0]);
  check(L + 'the scripts come together, in order: ' + want.join(', '), first !== -1 && same(srcs.slice(first, first + want.length), want), srcs.slice(first, first + want.length));
  check(L + '…as plain <script src> tags (no async, defer, type or module)', want.every(function (f) {
    var t = scripts[srcs.indexOf(f)];
    return t && same(Object.keys(t.attrs), ['src']);
  }));
  check(L + '…after auth.js', srcs.indexOf('auth.js') !== -1 && srcs.indexOf('auth.js') < first, [srcs.indexOf('auth.js'), first]);
  check(L + 'the mount comes before the scripts that mount into it', M.index < scripts[first].index);

  if (!isEditor) {
    /* after the page's own scripts: the page has drawn itself (and, on the dashboard, made window.RvListing) before
       the assistant starts, and nothing of the page's runs after it */
    check(L + 'they are the last scripts on the page', first === srcs.length - KIT.length, [first, srcs.length]);
    var lastKit = scripts[scripts.length - 1];
    var rest = markup.slice(markup.indexOf('</script>', lastKit.end) + '</script>'.length);
    check(L + 'nothing but the end of the document follows them', /^\s*(<\/body>\s*)?(<\/html>\s*)?$/.test(rest), rest.slice(0, 80));
    if (P.page === 'dashboard') {
      /* the dashboard's mount keeps its old place, just before the toasts' region (D.2 in events-dashboard-page.test.js) */
      var next = tags.filter(function (t) { return t.index > M.index && !(t.close && t.name === 'div' && t.index === M.end); })[0];
      check(L + 'the mount sits right before #toast-region', next && next.name === 'div' && next.attrs.id === 'toast-region', next && next.attrs);
    } else {
      var own = scripts.slice(0, first);
      var lastOwn = own[own.length - 1];
      check(L + 'the mount comes after the page\'s own last script', lastOwn && M.index > lastOwn.end, lastOwn && srcOf(lastOwn));
      check(L + '…and right before the scripts (nothing else in between)', /^<\/div\s*>\s*$/.test(markup.slice(M.end, scripts[first].index)));
    }
  }
});

/* ---------- 2. the place names ---------- */
check('every place name is used once, and they are exactly the plan\'s set', same(VALUES.slice().sort(), PLACES.slice().sort()), VALUES);
/* The shell (U2) owns the allowed set. It is run here, not searched as text: the names it really accepts
   (RevampAssistant.PAGES) must be the plan's set, both ways, so a typo on either side shows here rather than as a
   page with no assistant. */
function noop() {}
var SHELL_LOADED = (function () {
  if (!exists('etb2b-assistant.js')) return null;
  var ctx = { console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout: function () { return 0; }, clearTimeout: noop,
    location: { pathname: '/Event_Listing.html', search: '', hash: '' }, addEventListener: noop,
    document: { readyState: 'complete', querySelector: function () { return null; }, addEventListener: noop } };
  ctx.window = ctx; ctx.top = ctx;
  try { vm.createContext(ctx); vm.runInContext(read('etb2b-assistant.js'), ctx, { filename: 'etb2b-assistant.js' }); } catch (e) { return { error: String(e && e.message) }; }
  return { A: ctx.RevampAssistant };
})();
check('etb2b-assistant.js exists and runs (the shell every page loads)', !!SHELL_LOADED && !SHELL_LOADED.error && !!SHELL_LOADED.A, SHELL_LOADED && SHELL_LOADED.error);
var SHELL_PAGES = SHELL_LOADED && SHELL_LOADED.A && Object.prototype.toString.call(SHELL_LOADED.A.PAGES) === '[object Array]' ? SHELL_LOADED.A.PAGES : [];
PLACES.forEach(function (v) { check('the shell accepts the place "' + v + '"', SHELL_PAGES.indexOf(v) !== -1, SHELL_PAGES); });
SHELL_PAGES.forEach(function (v) { check('the place "' + v + '" the shell accepts is one a page uses', PLACES.indexOf(v) !== -1, v); });
check('…and the shell names each place once', SHELL_PAGES.length === PLACES.length, SHELL_PAGES);

/* ---------- 2b. every script these pages load can run ---------- */
/* Parsed as the browser would (a literal U+2028 inside a regex, a stray brace): a file that cannot be parsed stops
   everything after it on the page. The files the pages load, and the pages' own inline scripts. */
var PARSED = {}, INLINE_SEEN = [];
PAGES.concat([EDITOR]).forEach(function (P) {
  if (!exists(P.file)) return;
  var src = read(P.file);
  scriptsOf(tagsOf(markupOf(src))).forEach(function (t) {
    var s = srcOf(t);
    if (!s) return;
    if (/^(?:[a-z]+:)?\/\//i.test(s)) return;                    // a script from another site is not this repository's
    var f = s.replace(/^\//, '').split(/[?#]/)[0];
    if (PARSED[f] !== undefined) return;
    if (!exists(f)) { PARSED[f] = 'missing'; check(P.file + ' loads ' + f + ', which exists', false); return; }
    try { new vm.Script(read(f), { filename: f }); PARSED[f] = true; } catch (e) { PARSED[f] = String(e && e.message); }
    check(f + ' (loaded by ' + P.file + ') parses', PARSED[f] === true, PARSED[f]);
  });
  /* the inline ones, read from the file itself (the markup walk blanks them) */
  var re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, m, n = 0;
  var bare = markupOf(src);
  while ((m = re.exec(src))) {
    var a = attrsOf(m[1]);
    if (a.src !== undefined) continue;
    if (a.type !== undefined && !/^(?:text|application)\/javascript$/i.test(a.type)) continue;
    if (bare.slice(m.index, m.index + 7).toLowerCase() !== '<script') continue;   // inside a comment: never run
    n++;
    var err = null;
    try { new vm.Script(m[2], { filename: P.file + ' (inline script ' + n + ')' }); } catch (e) { err = String(e && e.message); }
    check(P.file + ': its inline script ' + n + ' parses', err === null, err);
  }
  if (n) INLINE_SEEN.push(P.file);
});
KIT.concat(['editor-chat-client.js', 'auth.js']).forEach(function (f) { check('the scan parsed ' + f, PARSED[f] === true, PARSED[f]); });
check('the scan parsed the pages\' inline scripts too (at least one on each page)', INLINE_SEEN.length === PAGES.length + 1, INLINE_SEEN);

/* ---------- 3. the files the pages load exist, and the server sends them ---------- */
EDITOR_KIT.concat([CSS]).forEach(function (f) {
  check(f + ' exists', exists(f));
  check('the server sends ' + f, access.isServableFile(f) === true);
});

/* ---------- 4. what each page keeps clear of is really there ---------- */
/* each selector names a bar the page really draws and styles; a renamed bar would leave the launcher over its buttons */
var BARS = [
  { sel: '.savebar.on', where: 'edit-event.css', css: /\.savebar\.on\s*\{/, made: ['edit-event.html', /bar\.classList\.toggle\('on'/] },
  { sel: '#wiz-foot', where: 'create-event.html', css: /<footer class="wiz-foot" id="wiz-foot">/, made: ['create-event.html', /\.wiz-foot\s*\{[^}]*position:\s*sticky/] },
  { sel: '.decide', where: 'review.html', css: /\.decide\s*\{\s*position:sticky/, made: ['review.html', /class="decide"/] },
  { sel: '.pr-actions', where: 'portal-review.html', css: /\.pr-actions\s*\{\s*position:sticky/, made: ['portal-review.html', /class="pr-actions"/] }
];
BARS.forEach(function (b) {
  check(b.sel + ' is styled where the page gets its rules (' + b.where + ')', b.css.test(read(b.where)));
  check(b.sel + ' is drawn by ' + b.made[0], b.made[1].test(read(b.made[0])));
});
['tpl-sel-toolbar', 'tpl-sec-toolbar', 'tpl-pop'].forEach(function (c) {
  check('the editor draws .' + c, read('editor-template-ui.js').indexOf("className = '" + c + "'") !== -1);
});

/* ---------- 5. Promotions: a studio opened full-window hides the assistant ---------- */
var MK = read('marketing.html');
var mkHead = MK.slice(0, MK.indexOf('</head>'));
var mkStyles = (mkHead.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
check('Promotions: html.promo-studio-open .rvc{ visibility:hidden; } is in a <style> in its head',
  /(^|\n)\s*html\.promo-studio-open \.rvc\{ visibility:hidden; \}/.test(mkStyles));
check('Promotions: …and it is the page\'s only rule about the assistant', (MK.match(/\.rvc\b/g) || []).length === 1);
check('Promotions: the page sets that class on <html> while a studio is full-window',
  MK.indexOf("document.documentElement.classList.toggle('promo-studio-open', open);") !== -1);
check('Promotions: .rvc is the kit\'s own wrap (etb2b-chat.css styles it)', /(^|\n)\.rvc\s*\{/.test(read(CSS)));
check('Promotions: the studio covers the page above the assistant (z-index 1000)', /\.is-studio\{[^}]*z-index:1000;/.test(read('promo.css')));

/* ---------- 6. nowhere else ---------- */
/* Every other HTML file in the repository: sign-in, the redirect stubs, the framed studios, the draft preview, the
   templates every published site, preview and shared link is built from, payment and the design importer. None may
   name the mount, the kit or the assistant's scripts, even in a comment, so a copy-paste of one page's tail cannot
   slip it onto a site. */
var NEEDLES = ['data-rv-assistant', 'etb2b-assistant', 'etb2b-chat.js', 'etb2b-chat.css', 'dash-bot-client', 'editor-chat-client', 'RevampAssistant', 'RevampChat'];
function walk(dir, out) {
  fs.readdirSync(path.join(ROOT, dir)).forEach(function (n) {
    if (n.charAt(0) === '.' || n === 'node_modules') return;
    var rel = dir ? dir + '/' + n : n, st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out); else out.push(rel);
  });
  return out;
}
var ALL = walk('', []);
var HTML = ALL.filter(function (f) { return /\.html?$/i.test(f); });
var OTHERS = HTML.filter(function (f) { return ALLOWED.indexOf(f) === -1; });
OTHERS.forEach(function (f) {
  var s = read(f), hit = NEEDLES.filter(function (n) { return s.indexOf(n) !== -1; });
  check(f + ' carries no assistant', hit.length === 0, hit);
});
/* the scan is not empty by accident: the pages the plan names as "never" are all there and were all read */
['index.html', 'preview-draft.html', 'promo-social-studio.html', 'promo-mailer-studio.html', 'edit-event-marketing.html', 'banner.html',
  'settings.html', 'dashboard.html', 'edit-event-dashboard.html'].forEach(function (f) {
  check('the scan read ' + f, OTHERS.indexOf(f) !== -1);
});
['templates/', 'payment/', 'import-figma-design/'].forEach(function (d) {
  check('the scan read the HTML under ' + d, OTHERS.some(function (f) { return f.indexOf(d) === 0; }), d);
});
check('the scan read at least 80 other HTML files', OTHERS.length >= 80, OTHERS.length);
/* the three redirect stubs only send people on (to the console or the dashboard, which carry the assistant) */
['settings.html', 'dashboard.html', 'edit-event-dashboard.html'].forEach(function (f) {
  check(f + ' is a redirect stub', read(f).indexOf('location.replace(') !== -1 && read(f).length < 4000);
});
/* Code that writes pages for people outside the console (the templates' runtime, the mailer and social studios, the
   server's site builders) never writes a tag that would load the assistant or a mount for it. A comment naming a
   file is fine here: this is about tags. */
var LOADER = /(?:src|href)\s*=\s*\\?["'][^"'\\]*(?:etb2b-assistant\.js|etb2b-chat\.(?:js|css)|dash-bot-client\.js|editor-chat-client\.js)|data-rv-assistant\s*=/;
var BUILDERS = ALL.filter(function (f) {
  if (/\.test\.js$/.test(f) || /^functions\/lib\/fixtures\//.test(f)) return false;
  if (/^(templates|promo-studio|promo-engine)\//.test(f)) return /\.(js|mjs|cjs|html?)$/.test(f);
  return /^functions\/lib\/[^/]+\.js$/.test(f) || f === 'server.js' || f === 'functions/index.js';
});
check('the builders scan found the server\'s site code', BUILDERS.indexOf('functions/lib/delivery.js') !== -1 && BUILDERS.indexOf('server.js') !== -1 &&
  BUILDERS.some(function (f) { return f.indexOf('templates/_shared/') === 0; }), BUILDERS.length);
BUILDERS.forEach(function (f) {
  check(f + ' writes no tag that loads the assistant', !LOADER.test(read(f)));
});

/* ---------- 7. a page's own windows stay above the assistant ---------- */
var ZCHECKS = [];   // checks that need the kit's layers as the shell mounts it (run in 8)
/* Create Event: its dialogs (openModal, in #modal-root) have a scrim at z 60, under the launcher (65) and the panel
   (69), and the mount is outside .wiz, the part openModal makes inert. So while a dialog is open the assistant is out
   of sight (and out of Tab's reach): one CSS line, keyed on #modal-root holding a dialog. */
(function () {
  var CE = read('create-event.html'), tags = tagsOf(markupOf(CE)), hEnd = headEnd(tags);
  var RULE = '#modal-root:not(:empty) ~ #rv-assistant .rvc{ visibility:hidden; }';
  var at = CE.indexOf('<style>' + RULE + '</style>');
  check('Create Event: ' + RULE + ' is in a <style> of its own in <head>', count(CE, RULE) === 1 && at !== -1 && at < hEnd, [count(CE, RULE), at, hEnd]);
  check('Create Event: …and it is the page\'s only rule about the assistant', (CE.match(/\.rvc\b/g) || []).length === 1);
  var root = tags.filter(function (t) { return !t.close && t.attrs.id === 'modal-root'; });
  var mount = tags.filter(function (t) { return !t.close && t.attrs['data-rv-assistant'] !== undefined; })[0];
  check('Create Event: #modal-root is one empty <div>, a direct child of <body>, before the mount (the rule\'s "~" needs that)',
    root.length === 1 && root[0].name === 'div' && /^<\/div\s*>/.test(markupOf(CE).slice(root[0].end)) && same(openAt(tags, root[0].index), []) &&
    !!mount && mount.attrs.id === 'rv-assistant' && root[0].index < mount.index);
  var om = CE.indexOf('function openModal(opts){');
  var omBody = om === -1 ? '' : CE.slice(om, CE.indexOf('\n  }\n', CE.indexOf('function close(){', om)));
  check('Create Event: openModal draws into #modal-root and empties it again on close (so :empty is true with no dialog)',
    omBody.indexOf("var root = $('modal-root')") !== -1 && omBody.indexOf("root.innerHTML = '';") !== -1);
})();
/* the events dashboard: a row's ⋯ menu is pinned to the screen from <body> (placeRowMenu) and can reach the
   bottom-right corner, so it opens above the launcher and the panel, under the dialogs */
(function () {
  var EL = read('Event_Listing.html');
  var RULE = 'body > .popover.row-menu{ z-index:70; }';
  var styleEnd = EL.indexOf('</style>');
  check('the dashboard: ' + RULE + ' is in its <style>', count(EL, RULE) === 1 && EL.indexOf(RULE) < styleEnd);
  var prm = EL.indexOf('function placeRowMenu(panel, btn){');
  var prmBody = prm === -1 ? '' : EL.slice(prm, EL.indexOf('\n  }\n', prm));
  check('the dashboard: placeRowMenu still moves the open menu to <body> and pins it there (the rule\'s "body >")',
    prmBody.indexOf('document.body.appendChild(panel);') !== -1 && prmBody.indexOf("panel.style.position = 'fixed';") !== -1);
  check('the dashboard: its menus are class="popover row-menu"', EL.indexOf('\'<div class="popover row-menu" id="\' + menuId + \'" hidden>\'') !== -1);
  var modalZ = /\.modal-scrim\{[^}]*z-index:(\d+);/.exec(EL);
  check('the dashboard: 70 is under its dialogs (.modal-scrim)', !!modalZ && +modalZ[1] > 70, modalZ && modalZ[1]);
  ZCHECKS.push(function (z) { check('the dashboard: 70 is above the assistant\'s launcher and panel', z && +z.launcher < 70 && +z.panel < 70, z); });
})();

/* ---------- 8. the event of a page is the one the panel came up for ---------- */
/* The Activity log's Event filter (and its Reset) rewrite ?event= in place (history.replaceState, no reload). The
   panel's scope line, its conversation and its attachment rules were set when it mounted, so a message sent after
   that must still be about the same event, or about none: never another event's conversation or History. The
   shell and the real dash brain run in a vm; what the brain posts to /api/dash-bot is read back. */
function shellOn(o) {
  var posts = [], kit = { opts: null };
  kit.mount = function (host, opts) {
    var chat = { scopes: [], open: noop, close: noop, isOpen: function () { return false; }, focusInput: noop, setBusy: noop, fold: noop, markUndone: noop,
      setScope: function (t) { chat.scopes.push(t); }, setContext: noop, divider: noop, user: function () { return {}; },
      ai: function () { return { note: noop, link: function () { return null; }, list: noop, undo: function () { return {}; } }; } };
    kit.opts = opts; kit.chat = chat;
    return chat;
  };
  function storage() { var m = {}; return { getItem: function (k) { return m.hasOwnProperty(k) ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; }, key: function () { return null; }, length: 0 }; }
  function node(tag) { return { tagName: tag, style: {}, attrs: {}, setAttribute: noop, appendChild: function (c) { return c; }, removeChild: function (c) { return c; }, addEventListener: noop }; }
  var mount = node('DIV');
  mount.getAttribute = function (k) { return k === 'data-rv-assistant' ? o.page : null; };
  var doc = { readyState: 'complete', activeElement: null, body: node('BODY'), head: node('HEAD'), documentElement: node('HTML'),
    querySelector: function (sel) { return sel === '[data-rv-assistant]' ? mount : null; }, getElementById: function () { return null; },
    createElement: function (t) { return node(String(t).toUpperCase()); }, addEventListener: noop };
  doc.body.classList = { contains: function () { return false; } };
  var ctx = { document: doc, console: { log: noop, warn: noop, error: noop, info: noop },
    location: { pathname: o.path, search: o.search || '', hash: o.hash || '', assign: noop },
    navigator: { onLine: true }, sessionStorage: storage(), localStorage: storage(),
    setTimeout: function () { return 0; }, clearTimeout: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: function () { return true; },
    matchMedia: function () { return { matches: false, addListener: noop, addEventListener: noop }; },
    RevampChat: kit,
    RevampAuth: {
      whenResolved: function () { return Promise.resolve(); },
      currentUser: function () { return { displayName: 'QA Tester', email: 'qa@example.com' }; },
      authedFetch: function (url, opts) {
        if (opts && opts.method === 'POST') posts.push({ url: url, body: opts.body ? JSON.parse(opts.body) : null });
        return Promise.resolve({ ok: false, status: 503, text: function () { return Promise.resolve('{"error":"not here","code":"test"}'); } });
      }
    } };
  ctx.window = ctx; ctx.top = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('dash-bot-client.js'), ctx, { filename: 'dash-bot-client.js' });
  vm.runInContext(read('etb2b-assistant.js'), ctx, { filename: 'etb2b-assistant.js' });
  return ctx.RevampAssistant.ready().then(function (chat) {
    return { ctx: ctx, A: ctx.RevampAssistant, kit: kit, chat: chat, posts: posts,
      ask: function (text) { var n = posts.length; return Promise.resolve(kit.opts.send(text, { attachments: [] })).then(noop, noop).then(function () { return posts[n] || null; }); } };
  });
}
function placeOf(post) { return post && post.body && post.body.place ? post.body.place : null; }
var SHELL_RUNS = !SHELL_LOADED || SHELL_LOADED.error || !exists('dash-bot-client.js') ? Promise.resolve() : Promise.resolve()
  .then(function () { return shellOn({ page: 'activity-log', path: '/activity-log.html', search: '' }); })
  .then(function (S) {
    var L = 'the Activity log opened with no event: ';
    check(L + 'the panel mounts, reading "Your events", with the dashboard\'s conversation and attachment rules', !!S.chat && S.kit.opts.scope === 'Your events' &&
      S.kit.opts.attach && S.kit.opts.attach.label === S.A.policyFor({ page: 'activity-log', eventId: '' }).label, S.kit.opts && S.kit.opts.scope);
    ZCHECKS.forEach(function (fn) { fn(S.kit.opts.zIndex); });
    S.ctx.location.search = '?event=qa-b';                            // the Event filter, as writeUrl() does it
    check(L + 'after the filter picks an event, place() still has none', same(S.A.place(), { page: 'activity-log', eventId: '', tab: '' }), S.A.place());
    return S.ask('how many registrations here?').then(function (post) {
      check(L + '…and the message is sent with no event (the conversation on screen, no other event\'s History)', !!post && post.url === '/api/dash-bot' &&
        same(placeOf(post), { page: 'activity-log', eventId: '', tab: '' }), placeOf(post));
    });
  })
  .then(function () { return shellOn({ page: 'activity-log', path: '/activity-log.html', search: '?event=qa-a' }); })
  .then(function (S) {
    var L = 'the Activity log opened with ?event=qa-a: ';
    check(L + 'the panel reads "This event", with that event\'s conversation and attachment rules', !!S.chat && S.kit.opts.scope === 'This event' &&
      S.kit.opts.attach && S.kit.opts.attach.label === S.A.policyFor({ page: 'activity-log', eventId: 'qa-a' }).label, S.kit.opts && S.kit.opts.scope);
    S.ctx.location.search = '?event=qa-b&area=content';               // another event picked in the filter
    return S.ask('how many registrations here?').then(function (post) {
      check(L + 'a message after the filter picks qa-b is still about qa-a', same(placeOf(post), { page: 'activity-log', eventId: 'qa-a', tab: '' }), placeOf(post));
      S.ctx.location.search = '';                                     // Reset
      return S.ask('how many registrations here?');
    }).then(function (post) {
      check(L + '…and after Reset too', same(placeOf(post), { page: 'activity-log', eventId: 'qa-a', tab: '' }), placeOf(post));
    });
  })
  .then(function () { return shellOn({ page: 'console', path: '/edit-event.html', search: '?event=qa-a', hash: '#content/speakers' }); })
  .then(function (S) {
    S.ctx.location.hash = '#settings/seo';
    check('the console: its section still follows the address after the mount (only the event is fixed)', same(S.A.place(), { page: 'console', eventId: 'qa-a', tab: 'settings/seo' }), S.A.place());
  })
  .then(function () { return shellOn({ page: 'promotions', path: '/marketing.html', search: '?event=qa-a&tab=posts' }); })
  .then(function (S) {
    S.ctx.location.search = '?event=qa-a&tab=mailers';
    check('Promotions: its tab still follows the address after the mount', same(S.A.place(), { page: 'promotions', eventId: 'qa-a', tab: 'mailers' }), S.A.place());
  })
  .then(null, function (e) { check('the shell runs on the Activity log, the console and Promotions in a vm', false, String(e && e.stack || e)); });

SHELL_RUNS.then(function () {
  console.log('assistant-pages: ' + (failed ? failed + ' of ' + (passed + failed) + ' checks FAILED' : 'all ' + passed + ' checks passed'));
  process.exit(failed ? 1 : 0);
});
