/* node functions/lib/product-name.test.js — UX-003 (batch B02, with UX-149's code half): the product's name and its
   tab icon.
     - the product is ETB2B EventSphere (owner decision #6), "EventSphere" alone where space is tight: a browser tab
       reads "<Page> — EventSphere", and "<Page> · <Event> — EventSphere" with an event open;
     - no served page or browser script, and no message the server sends, says "Revamp CMS", "Revamp", "Oneworld 2.0"
       or "Oneworld" to a person (comments, code names, the header logo's own alt text and the AI's instructions are
       not words a person reads), so the old names cannot come back;
     - every page names the same tab icon, the red ET square cut from the ET B2B logo unchanged (assets/favicon.svg),
       and so do /favicon.ico and the published sites;
     - a preview's tab starts "Preview · ", so it is not taken for the live site's;
     - robots.txt and the calendar file name the product.
   No network, no production, no AI. Exits 1 on any failure. */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log('FAIL ' + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ---------- 1. the tab icon: the logo's red square, unchanged ---------- */
var LOGO = read('assets/et-b2b-logo.svg'), ICON = read('assets/favicon.svg');
var iconPaths = ICON.match(/<path [^>]*\/>/g) || [];
var red = '<path d="M36.6069 37.2103V0.896484H0V37.2103H36.6069Z" fill="#ED1A3B"/>';
check('the icon is the logo\'s red square and its white ET, path for path, nothing else drawn', iconPaths.length === 2 &&
  iconPaths.every(function (p) { return LOGO.indexOf(p) !== -1; }) && iconPaths[0] === red && /fill="white"\/>$/.test(iconPaths[1]), iconPaths.length);
check('its colours are the logo\'s own (the red ET square never changes)', (ICON.match(/fill="[^"]*"/g) || []).join(' ') === 'fill="#ED1A3B" fill="white"');
check('its view is the square itself', /viewBox="0 0\.896484 36\.6069 36\.313816"/.test(ICON) && !/<(rect|circle|g|style|image)\b/.test(ICON));
check('/favicon.ico is that icon (server.js and the dev server)', /path\.join\(root, 'assets', 'favicon\.svg'\)/.test(read('server.js')) &&
  /rel === '\/favicon\.ico'\) file = path\.join\(root, 'assets', 'favicon\.svg'\)/.test(read('tools/serve.js')));
var API = read('functions/lib/api.js');
check('the published sites name it too (SITE_FAVICON)', /var SITE_FAVICON = '\/assets\/favicon\.svg';/.test(API));

/* ---------- 2. every page: its tab title and its icon ---------- */
var access = require('./access');
var listed = require('child_process').execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(function (f) {
  return f && access.isServableFile(f);
});
/* a page: a served .html that is not one section of a template (those are pieces of a page) and is not empty */
var pages = listed.filter(function (f) {
  return /\.html$/i.test(f) && !/^templates\/[^/]+\/sections\//.test(f) && fs.statSync(path.join(ROOT, f)).size > 0;
});
/* the <head> opening of these three is batch B02-b's (doctype, viewport, title and icon line): until it has merged,
   their title still carries the old name and they have no icon line, so only their body is checked here */
var HEAD_BY_B02B = { 'custom_editor.html': 1, 'create-event.html': 1, 'edit-event.html': 1 };
function pendingHead(f, title) { return !!HEAD_BY_B02B[f] && /Revamp|Oneworld/.test(title); }
var ICON_LINK = '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">';
/* a tab is where space is tight: "EventSphere" alone (owner decision #6), the one form on every page, so the static
   titles agree with the ones the pages set once they have loaded ("Edit · <event> — EventSphere"). A tab that reads
   "— ETB2B EventSphere" (B02-b's heads of Create Event, the site editor and the console, before this merged) is the
   other form, and is caught here: drop "ETB2B " from that <title>. */
var TAB_TITLE = /^[^—&]+ (?:—|&mdash;) EventSphere$/;
var badTitle = [], noIcon = [], pending = [];
pages.forEach(function (f) {
  var html = read(f), m = /^([ \t]*)<title>([^<]*)<\/title>[ \t]*\r?\n([^\n]*)/m.exec(html);
  var title = m ? m[2] : '';
  if (pendingHead(f, title)) { pending.push(f); return; }
  if (!m || !TAB_TITLE.test(title)) badTitle.push(f + ': ' + title);
  if (!m || m[3].trim() !== ICON_LINK) noIcon.push(f);
});
check('the sweep found the pages', pages.length >= 18 && pages.indexOf('index.html') !== -1 && pages.indexOf('promo-social-studio.html') !== -1, pages);
check('the tab form is "<Page> — EventSphere" and only that', TAB_TITLE.test('Events — EventSphere') && TAB_TITLE.test('Create Event &mdash; EventSphere') &&
  !TAB_TITLE.test('Create Event &mdash; ETB2B EventSphere') && !TAB_TITLE.test('Site editor — ETB2B EventSphere') && !TAB_TITLE.test('EventSphere'));
check('every page\'s tab reads "<Page> — EventSphere"', !badTitle.length, badTitle);
check('every page names the ET square as its tab icon, on the line after its title', !noIcon.length, noIcon);
check('only B02-b\'s three pages wait for its merge', pending.every(function (f) { return HEAD_BY_B02B[f]; }), pending);

/* the titles a page sets once it knows the event */
function has(rel, re) { return re.test(read(rel)); }
check('console: "Edit · <event> — EventSphere"', has('edit-event.html', /document\.title = 'Edit · ' \+ name \+ ' — EventSphere';/) &&
  has('edit-event.html', /document\.title = 'Edit event — EventSphere';/));
check('Registrations: "Registrations · <event> — EventSphere"', has('audience-registrations.html', /document\.title = 'Registrations' \+ \(ev \? ' · ' \+ /));
check('Promotions: "Promotions · <event> — EventSphere"', has('marketing.html', /document\.title = 'Promotions · ' \+ name \+ ' — EventSphere';/));
check('site editor: "Site editor · <event> — EventSphere" once it has loaded', has('editor-template-ui.js', /document\.title = 'Site editor' \+ \(name \? ' \\u00b7 ' \+ name : ''\) \+ ' \\u2014 EventSphere';/));
check('the Promotions studios are titled through their extract scripts', /<title>Mailers — EventSphere<\/title>\n<link rel="icon"/.test(read('tools/extract-promo-studio.py')) &&
  /<title>Social posts — EventSphere<\/title>\n<link rel="icon"/.test(read('tools/extract-promo-social.py')));

/* ---------- 3. no old name in any word a person reads ---------- */
/* comments are notes for developers; a regular expression is code (one finds the old names to keep them out) */
function wordsOf(text, file) {
  var t = text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  t = t.replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
  t = t.replace(/([=(,:!&|?]\s*|\.(?:replace|test|match|exec)\(\s*)\/(?:\\.|[^\/\n\\])+\/[gimsuy]*/g, '$1/RE/');
  /* the header logo pictures still read "ET Oneworld"; their alt says what the picture shows (the owner is
     choosing the new logo) */
  t = t.replace(/alt="ET Oneworld"/g, 'alt=""');
  /* the AI's own instructions (functions/lib) name ET's former event builder, ET Oneworld, as context for the
     model: they are not shown to anyone */
  if (/^functions\/lib\//.test(file)) t = t.replace(/ET Oneworld/g, 'ET');
  return t;
}
var OLD = /Revamp CMS|Oneworld|\bRevamp\b/;
var swept = listed.filter(function (f) { return /\.(html|js)$/i.test(f); });
fs.readdirSync(__dirname).forEach(function (f) {
  if (/\.js$/.test(f) && !/\.test\.js$/.test(f)) swept.push('functions/lib/' + f);
});
fs.readdirSync(path.join(__dirname, 'vendor')).forEach(function (f) { if (/\.js$/.test(f)) swept.push('functions/lib/vendor/' + f); });
var hits = [];
swept.forEach(function (f) {
  var words;
  try { words = wordsOf(read(f), f); } catch (e) { return; }
  /* B02-b's three pages: their title line is B02-b's to set (above) */
  if (pending.indexOf(f) !== -1) words = words.replace(/<title>[^<]*<\/title>/, '<title></title>');
  words.split('\n').forEach(function (line, i) {
    var m = OLD.exec(line);
    if (m) hits.push(f + ': ' + line.trim().slice(Math.max(0, line.trim().indexOf(m[0]) - 40), line.trim().indexOf(m[0]) + 60));
  });
});
check('the sweep read every served page and browser script and the server\'s messages', swept.length > 200 && swept.indexOf('functions/lib/api.js') !== -1 && swept.indexOf('auth.js') !== -1, swept.length);
check('no served page, browser script or server message says "Revamp CMS", "Revamp", "Oneworld 2.0" or "Oneworld"', !hits.length, hits.slice(0, 40));
/* the sweep itself sees what it is for */
check('the sweep would catch an old name in a title, a message or markup', OLD.test(wordsOf("<title>Events — Revamp CMS</title>", 'x.html')) &&
  OLD.test(wordsOf("throw bad('not one Oneworld can keep');", 'functions/lib/x.js')) && OLD.test(wordsOf('<h2>Sign in to Revamp</h2>', 'x.html')) &&
  !OLD.test(wordsOf('/* Oneworld 2.0 */ var RevampCore = 1; // Revamp CMS', 'x.js')));

/* the sentences that named it */
check('sign-in: "Sign in to ETB2B EventSphere", and the wrong-account and denied messages name it', has('index.html', /<h2>Sign in to ETB2B EventSphere<\/h2>/) &&
  has('auth.js', /can’t sign in to ETB2B EventSphere\./) && /has not been given access to ETB2B EventSphere\./.test(require('./access').deniedMessage()) &&
  /no longer has access to ETB2B EventSphere\./.test(require('./access').deniedMessage('blocked')));
var gemini = read('functions/lib/gemini.js');
check('"Tell the ETB2B EventSphere team" when AI is not set up', (gemini.match(/Tell the ETB2B EventSphere team\./g) || []).length === 2 &&
  require('./chat-picture').SENTENCES['ai-config'].indexOf('Tell the ETB2B EventSphere team.') !== -1);

/* ---------- 4. robots.txt, the calendar file, the preview's tab ---------- */
var seo = require('./site-seo');
check('robots.txt names the product (UX-149\'s code half; no domain is attached here)', /^# ETB2B EventSphere: published event sites are public/.test(seo.robotsTxt('https://x.example')));
var ics = seo.calendarIcs({ name: 'X Summit', start: '2027-02-10' }, { id: 'x', url: 'https://x.example/e/x' });
check('the calendar file\'s PRODID names it', /\r?\nPRODID:-\/\/ET B2B\/\/ETB2B EventSphere\/\/EN\r?\n/.test(ics), ics.slice(0, 120));

var hooks = require('./api')._testHooks;
var PAGE = '<!doctype html><html><head><title>Old</title></head><body><main><h1>x</h1></main></body></html>';
var live = hooks.publishTransform(PAGE, { eventId: 'qa-x', event: { name: 'QA Summit' }, mode: 'live', templateId: 'gen-qa-x', publicBase: 'https://sites.example' });
var prev = hooks.publishTransform(PAGE, { eventId: 'qa-x', event: { name: 'QA Summit' }, mode: 'preview', templateId: 'gen-qa-x', publicBase: '' });
check('the live site\'s tab is the event\'s name', /<title>QA Summit<\/title>/.test(live));
check('a preview\'s tab starts "Preview · ", so the two tabs differ; its link preview keeps the name', /<title>Preview · QA Summit<\/title>/.test(prev) &&
  /<meta property="og:title" content="QA Summit"/.test(prev), (/<title>[^<]*<\/title>/.exec(prev) || [''])[0]);
check('both name the ET square as their icon when the event has no logo', live.indexOf('href="/assets/favicon.svg"') !== -1 && prev.indexOf('href="/assets/favicon.svg"') !== -1);

/* ---------- never "ET" on its own in what a person reads (the owner, 11 Nov 2026: "Wherever you are writing ET,
   please don't it will be ETB2B or The Economic Times Business Verticals") ----------
   Every served page and browser script, and every message the server's own modules send, outside comments: a
   portal's own name (ET BrandEquity, ETCIO…) and a code name are not this. */
function codeOnly(src) {
  var out = '', i = 0, n = src.length, state = 'code';
  while (i < n) {
    if (state === 'code') {
      if (src.substr(i, 2) === '/*') { state = 'block'; i += 2; continue; }
      if (src.substr(i, 4) === '<!--') { state = 'html'; i += 4; continue; }
      if (src.substr(i, 2) === '//' && (i === 0 || ' \t\n;{}(),'.indexOf(src.charAt(i - 1)) !== -1)) { state = 'line'; i += 2; continue; }
      out += src.charAt(i); i++; continue;
    }
    if (state === 'block') { if (src.substr(i, 2) === '*/') { state = 'code'; i += 2; } else i++; continue; }
    if (state === 'html') { if (src.substr(i, 3) === '-->') { state = 'code'; i += 3; } else i++; continue; }
    if (src.charAt(i) === '\n') { state = 'code'; out += '\n'; }
    i++;
  }
  return out;
}
var BARE = /\bET(?:\\'s|’s|\\u2019s|'s)?\s+(?:portal|portals|bar|footer|sections|record|link|page|login|templates|team|logo and menu)\b|\bET(?:\\'|’|\\u2019|')s\b|\bon ET\.|alt="ET(?: Oneworld)?"/;
var where = [];
fs.readdirSync(ROOT).filter(function (f) { return /\.(html|js)$/.test(f) && !/bundle|backup|dummy|server\.js$/.test(f); }).forEach(function (f) {
  codeOnly(read(f)).split('\n').forEach(function (l, k) { if (BARE.test(l) && !/oneworld-logo\.svg/.test(l)) where.push(f + ':' + (k + 1) + ' ' + l.trim().slice(0, 90)); });
});
['forms.js', 'site-advisory.js', 'api-seo.js', 'seo-fields.js', 'award-sections.js', 'prev-sections.js', 'promo.js', 'promo-social.js', 'people-page.js', 'event-portal.js'].forEach(function (f) {
  codeOnly(read('functions/lib/' + f)).split('\n').forEach(function (l, k) { if (BARE.test(l)) where.push(f + ':' + (k + 1) + ' ' + l.trim().slice(0, 90)); });
});
check('no page, browser script or server message says "ET" on its own (ETB2B; The Economic Times Business Verticals)', where.length === 0, where.slice(0, 8));
check('the models that write what a person reads are told so (lib/name-rule.js)', ['api.js', 'dash-bot.js', 'seo-ai.js', 'event-description.js', 'award-site.js'].every(function (f) { return /NAME_RULE/.test(read('functions/lib/' + f)); }) &&
  /never write "ET" on its own/.test(require('./name-rule').NAME_RULE));

console.log('product-name: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
