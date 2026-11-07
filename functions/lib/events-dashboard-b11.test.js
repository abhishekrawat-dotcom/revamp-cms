/* node functions/lib/events-dashboard-b11.test.js — batch B11: the events dashboard and the pages around it.
     UX-005  one name for each event category on every page (RevampCore.TYPES): IP Event, Client Event, Awards; the
             console offers only those three; the dashboard's Event type filter lists a category only while some
             loaded event has it; the server's tables (Promotions, ETB2B AI) say the same names;
     UX-014  the dashboard, the Activity log and Mailer performance use the console's ET red and warm neutrals; the
             Figma import page follows the app's theme switch, not only the computer's;
     UX-015  both activity logs read the same: one table of words (activity-words.js) for actions, people, fields and
             sections; one filter order (Event · Person · Area · From · To · Search, Event left out of one event's
             log); no action codes on screen (kept in the CSV); Basics edits filed under Content;
     UX-023  the app's logo, local, in a light and a dark copy that differ only in the lettering (the red ET square
             exactly as drawn), swapped by the theme on every page, no white chips; Latest Activity totals in --text;
     UX-024  (done by the dashboard's ETB2B AI, checked here that it is still mounted);
     UX-028  Help in the top bar, no floating pill; its window keeps what was typed, never says it was sent, and
             offers "Open in email app" and "Copy message";
     UX-032  the QR picker lists every published event of the portal, grouped by status; the code is drawn in the
             page (no api.qrserver.com) with Download PNG and Download SVG;
     UX-038  sign-in on phones: the marketing panel hides, the card comes first, the theme switch is in a corner;
     UX-040  a second detail beside every event name: the QR picker and the Activity log's Event list say the date
             and state (and the address where that alone tells two apart); dashboard rows and log rows show the
             event's address.
   Part 1 reads the files; part 2 runs the dashboard's own script in node's vm over fixtures/mini-dom.js with the real
   edit-event-core.js, event-lifecycle.js and the vendored QR library, and the Activity log's helpers. No network, no
   production, no AI. Exits 1 on any failure. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var makeDom = require('./fixtures/mini-dom').makeDom;

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var PAGE = read('Event_Listing.html');
var CORE = read('edit-event-core.js');
var LIFE = read('event-lifecycle.js');
var QRLIB = read('assets/vendor/qrcode-generator.js');
var START = PAGE.indexOf('<script>\n(function(){');
var INLINE = START === -1 ? '' : PAGE.slice(START + '<script>'.length, PAGE.indexOf('</script>', START));
var CODE = INLINE.replace(/\/\*[\s\S]*?\*\//g, '');
var CSS = PAGE.slice(PAGE.indexOf('<style>'), PAGE.indexOf('</style>'));
var BODY = PAGE.slice(PAGE.indexOf('<header class="main-nav">'), PAGE.indexOf('<script src="theme-toggle.js">'));
var CONSOLE = read('edit-event.html');
var CREATE = read('create-event.html');
var SIGNIN = read('index.html');
var ALOG = read('activity-log.html');
var MPERF = read('mailer-performance.html');
var FIGMA = read('import-figma-design/index.html');
var ROSTER = require('./et-events').portalList();

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function flush(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 20); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }
function response(status, json) {
  var t = json === undefined ? '' : JSON.stringify(json);
  return { status: status, ok: status >= 200 && status < 300, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(json === undefined ? {} : JSON.parse(t)); } };
}
/* a function's source by name, from a script */
function fnSource(src, name) {
  var at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('no function ' + name);
  var i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(at, i + 1);
}
/* the declarations of one CSS block, by its selector text, e.g. ':root{' */
function block(css, opener) {
  var at = css.indexOf(opener);
  return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
}

/* ======================================================================================================
   1. the files
   ====================================================================================================== */

/* ---- UX-005 one name per category ---- */
var coreCtx = { window: {} };
vm.createContext(coreCtx);
vm.runInContext('var window = this.window;\n' + /\n  var TYPES = \{[\s\S]*?\};/.exec(CORE)[0] + '\n' + /\n  var CATEGORY_KEYS = [^\n]*;/.exec(CORE)[0] + '\n' + fnSource(CORE, 'typeLabel') + '\nthis.T = { TYPES: TYPES, CATEGORY_KEYS: CATEGORY_KEYS, typeLabel: typeLabel };', coreCtx);
var T = coreCtx.T;
check('UX-005 the three categories Create Event makes, in its order', same(T.CATEGORY_KEYS, ['ip', 'client', 'awards']));
check('UX-005 one name each: IP Event, Client Event, Awards', T.TYPES.ip === 'IP Event' && T.TYPES.client === 'Client Event' && T.TYPES.awards === 'Awards');
check('UX-005 typeLabel: a key in any case, none, and one the table does not know', T.typeLabel('IP') === 'IP Event' && T.typeLabel(' client ') === 'Client Event' && T.typeLabel('') === '' && T.typeLabel(null) === '' && T.typeLabel('summit') === 'summit');
check('UX-005 RevampCore exports CATEGORY_KEYS and typeLabel', /TYPES: TYPES, CATEGORY_KEYS: CATEGORY_KEYS, typeLabel: typeLabel,/.test(CORE));
var catLabels = {};
['IP', 'Client', 'Awards'].forEach(function (k) { var m = new RegExp('\\n    ' + k + ': \\{\\n      label: \'([^\']+)\'').exec(CREATE); catLabels[k] = m ? m[1] : null; });
check('UX-005 Create Event\'s cards use the same names (no "IP & Residential Event", no "Custom Events")', catLabels.IP === T.TYPES.ip && catLabels.Client === T.TYPES.client && catLabels.Awards === T.TYPES.awards &&
  CREATE.indexOf("label: 'IP & Residential Event'") === -1 && CREATE.indexOf("label: 'Custom Events'") === -1, catLabels);
check('UX-005 the console\'s Category list offers only the three (an event\'s older category kept as its own option, by name)',
  CONSOLE.indexOf('var catOptions = C.CATEGORY_KEYS.map(function(k){') !== -1 && CONSOLE.indexOf("else if (C.CATEGORY_KEYS.indexOf(cat) === -1) catOptions = '<option value=\"' + esc(cat) + '\" selected>' + esc(C.typeLabel(cat)) + '</option>' + catOptions;") !== -1);
var promoLabels = (new Function('return ' + /var CATEGORY_LABELS = (\{[^\n]*\});/.exec(read('functions/lib/promo.js'))[1]))();
check('UX-005 Promotions\' table is the core\'s, name for name', same(promoLabels, T.TYPES), [promoLabels, T.TYPES]);
var botLabels = require('./dash-bot')._test.TYPE_LABELS;
check('UX-005 ETB2B AI names the three as every page does', botLabels.ip === T.TYPES.ip && botLabels.client === T.TYPES.client && botLabels.awards === T.TYPES.awards, botLabels);
check('UX-005 the dashboard keeps no table of its own', /\n  var EVENT_TYPES = \(window\.RevampCore && window\.RevampCore\.TYPES\) \|\| \{\};/.test(INLINE) && CODE.indexOf('Intellectual Property') === -1 && CODE.indexOf("'Virtual Events'") === -1);

/* ---- UX-014 one red, warm neutrals, one theme switch ---- */
[['Event_Listing.html', PAGE], ['activity-log.html', ALOG], ['mailer-performance.html', MPERF]].forEach(function (f) {
  var css = f[1].slice(f[1].indexOf('<style>'), f[1].indexOf('</style>'));
  var light = block(css, ':root{'), sysDark = block(css, ':root:not([data-theme="light"]){'), dark = block(css, ':root[data-theme="dark"]{');
  check('UX-014 ' + f[0] + ': ET red #ED1C24 and the console\'s warm ground in light', /--accent:\s*#ED1C24;/.test(light) && /--bg:\s*#FAF7F6;/.test(light) && /--text:\s*#241B1A;/.test(light), light.slice(0, 300));
  check('UX-014 ' + f[0] + ': #FF6B70 and the warm dark ground, for the computer\'s dark and for the switch\'s', /--accent:\s*#FF6B70;/.test(sysDark) && /--accent:\s*#FF6B70;/.test(dark) && /--bg:\s*#171514;/.test(dark) && /--bg:\s*#171514;/.test(sysDark));
  check('UX-014 ' + f[0] + ': no #FF0035 / #FF4D6D red and no cool greys left', !/#FF0035|#FF4D6D|#F7F7F4|#1B1A16|#141310/i.test(f[1]));
});
check('UX-014 the Figma import page reads the app\'s choice before it paints, and has the switch', FIGMA.indexOf('localStorage.getItem("revamp-theme")') !== -1 &&
  FIGMA.indexOf('<script src="../theme-toggle.js"></script>') !== -1 && FIGMA.indexOf('<span data-theme-toggle-target') !== -1);
check('UX-014 …and its dark palette answers the switch (:root[data-theme="dark"]), not only the computer', /:root\[data-theme="dark"\]\{\n    --bg:#171514;[\s\S]*?--accent:#FF6B70;/.test(FIGMA));

/* ---- UX-023 the logo ---- */
var LOGO_PAGES = [['Event_Listing.html', PAGE], ['index.html', SIGNIN], ['create-event.html', CREATE], ['activity-log.html', ALOG], ['mailer-performance.html', MPERF]];
LOGO_PAGES.forEach(function (f) {
  var html = f[1];
  check('UX-023 ' + f[0] + ' shows the local logo, a light and a dark copy, and links app-logo.css', html.indexOf('src="assets/app-logo.png"') !== -1 && html.indexOf('src="assets/app-logo-dark.png"') !== -1 &&
    /class="[^"]*app-logo-light"/.test(html) && /class="[^"]*app-logo-dark"/.test(html) && html.indexOf('<link rel="stylesheet" href="app-logo.css">') !== -1);
  check('UX-023 ' + f[0] + ': no logo from another site, no white chip or plate behind it', html.indexOf('oneworld-logo.svg') === -1 && !/background:\s*#(fff|FFFFFF)\b[^}]*\}[^\n]*\n?/.test(html.slice(0, html.indexOf('</style>')).split('\n').filter(function (l) { return /brand|nav-brand img/.test(l); }).join('\n')));
});
check('UX-023 Create Event no longer carries the logo as 12 KB of base64', CREATE.indexOf('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZkAAABD') === -1);
var LOGO_CSS = read('app-logo.css');
check('UX-023 app-logo.css: the dark copy hidden by default, shown on the switch\'s dark and on the computer\'s dark when the switch has not said light',
  /\.app-logo-dark\{ display:none !important; \}/.test(LOGO_CSS) && /:root\[data-theme="dark"\] \.app-logo-light\{ display:none !important; \}/.test(LOGO_CSS) &&
  /:root\[data-theme="dark"\] \.app-logo-dark\{ display:block !important; \}/.test(LOGO_CSS) && /:root:not\(\[data-theme="light"\]\) \.app-logo-dark\{ display:block !important; \}/.test(LOGO_CSS));
check('UX-023 no filter, inversion or blend on a logo (ET\'s rule: only the lettering may change, by a copy)', !/filter:|mix-blend|invert\(/.test(LOGO_CSS));
var access = require('./access');
check('UX-023 the server sends the two pictures and the stylesheet, signed out too (the sign-in page shows the logo)', ['assets/app-logo.png', 'assets/app-logo-dark.png', 'app-logo.css', 'activity-words.js'].every(function (f) { return access.isServableFile(f); }) &&
  access.isPublic({ method: 'GET' }, '/assets/app-logo-dark.png') && access.isPublic({ method: 'GET' }, '/app-logo.css'));
check('UX-023 Latest Activity\'s totals use the theme\'s text colour (they were black on the dark card)', /\.activity-row-total\{[^}]*color:var\(--text\);/.test(CSS));

/* ---- UX-040 the meta line's dot (see the run below) ---- */
check('UX-040 the meta line clips a dot that would start a line: the row reaches 17px left, each part sits 17px in, the dot fills that 17px', /\.ev-meta-line\{[^}]*overflow:hidden;/.test(CSS) &&
  /\.ev-meta-row\{ display:flex; align-items:center; flex-wrap:wrap; row-gap:4px; margin-left:-17px; \}/.test(CSS) && /\.ev-meta-row > \*\{ margin-left:17px; min-width:0; \}/.test(CSS) &&
  /\.ev-meta-next::before\{ content:'\\00B7'; content:'\\00B7' \/ ''; display:inline-block; width:17px; margin-left:-17px;/.test(CSS) && CSS.indexOf('.dotsep') === -1);

/* ---- UX-024 ETB2B AI is on the dashboard ---- */
check('UX-024 the dashboard mounts ETB2B AI (its kit, its client, its mount point)', PAGE.indexOf('<script src="etb2b-chat.js"></script>') !== -1 && PAGE.indexOf('<script src="dash-bot-client.js"></script>') !== -1 &&
  PAGE.indexOf('<div id="rv-dash-bot"></div>') !== -1 && PAGE.indexOf('<link rel="stylesheet" href="etb2b-chat.css">') !== -1);

/* ---- UX-028 Help ---- */
check('UX-028 Help is a top-bar button beside the theme switch; the floating pill is gone', /<button class="nav-help-btn" id="btn-help" type="button" aria-label="Help" aria-haspopup="dialog">/.test(PAGE) &&
  PAGE.indexOf('help-fab') === -1 && !/position:fixed;[^}]*left:22px/.test(CSS));
check('UX-028 on a phone it is a 40 px icon button (its word hidden)', /@media \(max-width: 640px\)\{\n    \.nav-help-btn\{ width:40px; height:40px;[^}]*\}\n    \.nav-help-label\{ display:none; \}/.test(CSS));

/* ---- UX-038 sign-in on phones ---- */
var SCSS = SIGNIN.slice(SIGNIN.indexOf('<style>'), SIGNIN.indexOf('</style>'));
var artRule = SCSS.indexOf('  .login-art{\n'), phoneRule = SCSS.indexOf('@media (max-width: 860px){');
check('UX-038 the phone rule that hides the panel comes after the panel\'s own rule (it used to lose to it)', artRule !== -1 && phoneRule > artRule && /@media \(max-width: 860px\)\{[\s\S]*?\.login-art\{ display: none; \}/.test(SCSS));
check('UX-038 the page has a doctype and a viewport line (a phone laid it out 980 px wide in quirks mode, where no phone rule applies)',
  /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">/.test(SIGNIN) && /<\/head>\n<body>/.test(SIGNIN) && /<\/body>\n<\/html>\n$/.test(SIGNIN));
check('UX-038 one phone rule (no second one earlier)', SCSS.split('@media (max-width: 860px)').length === 2);
check('UX-038 on phones the card sits near the top with the logo over it', /\.login-form-wrap\{ align-items: flex-start; padding: 72px 20px 32px; \}/.test(SCSS) && /\.login-brand-phone\{ display: block; \}/.test(SCSS) &&
  /<div class="login-brand-phone">[\s\S]*?app-logo-light[\s\S]*?app-logo-dark/.test(SIGNIN));
check('UX-038 the theme switch is in the page\'s top-right corner, not under the button', /\.login-theme\{ position: absolute; top: 16px; right: 16px;/.test(SCSS) &&
  SIGNIN.indexOf('<div class="login-theme"><span data-theme-toggle-target') !== -1 && SIGNIN.indexOf('login-foot') === -1);

/* ---- UX-015 the two activity logs ---- */
var AWORDS = require('../../activity-words.js');
check('UX-015 actions in words, an unknown one turned into words, never its code', AWORDS.actionLabel('content-added') === 'Content added' && AWORDS.actionLabel('site-saved') === 'Site saved' &&
  AWORDS.actionLabel('ai-chat') === 'ETB2B AI' && AWORDS.actionLabel('approval-requested') === 'Sent for approval' && AWORDS.actionLabel('shiny-new-thing') === 'Shiny new thing' && AWORDS.actionLabel('') === 'Change');
check('UX-015 the AI description\'s and a Basics edit\'s "updated" are not called an event being changed; a bare "created" is the event\'s', AWORDS.actionLabel('updated', 'event') === 'Description written' &&
  AWORDS.actionLabel('updated', 'content') === 'Basic details changed' && AWORDS.actionLabel('created') === 'Event created' && AWORDS.actionLabel('deleted') === 'Event deleted');
/* Promotions' two parts share the verbs, so each entry is said from its detail: these are the details
   lib/promo-mailer.js and lib/promo-social.js really write (the verifier's shot read "Mailer deleted — Post layout
   reset: Square · 1:1" and "Mailer changed — Post art: Logo uploaded") */
var PROMO_SAID = [
  ['created', 'Mailer “Launch invite” (Invite) saved as a new version', 'Mailer saved'],
  ['updated', 'Mailer “Launch invite” (Invite) saved', 'Mailer changed'],
  ['updated', 'Mailer “Launch invite” renamed to “Final invite”', 'Mailer changed'],
  ['deleted', 'Mailer “Launch invite” (Invite) deleted', 'Mailer deleted'],
  ['deleted', '2 versions of the Invite mailer deleted', 'Mailer deleted'],
  ['updated', 'Post art: Logo uploaded', 'Social post art added'],
  ['updated', 'Post art: Logo from the PSD uploaded', 'Social post art added'],
  ['deleted', 'Post art: Background 2 removed', 'Social post art removed'],
  ['deleted', 'Post art: PSD background cleared by a new PSD', 'Social post art removed'],
  ['updated', 'Post picture uploaded', 'Social post picture added'],
  ['updated', 'Post layout saved: Square · 1:1', 'Social post layout saved'],
  ['deleted', 'Post layout reset: Square · 1:1', 'Social post layout reset']
];
var promoWrong = PROMO_SAID.filter(function (c) { return AWORDS.actionLabel(c[0], 'promotions', c[1]) !== c[2]; }).map(function (c) { return [c[1], AWORDS.actionLabel(c[0], 'promotions', c[1])]; });
check('UX-015 Promotions: a mailer\'s entry says Mailer…, a social post\'s says Social post… (never "Mailer deleted" for a post layout reset)', promoWrong.length === 0, promoWrong);
check('UX-015 …a Promotions entry that names neither is Promotions\', not a mailer\'s; another verb is said by the general table', AWORDS.actionLabel('updated', 'promotions', '') === 'Changed in Promotions' &&
  AWORDS.actionLabel('deleted', 'promotions') === 'Removed from Promotions' && AWORDS.actionLabel('file-uploaded', 'promotions', 'Post art: Logo uploaded') === 'File uploaded');
/* and every entry the two Promotions writers make today is one of the shapes above: each logActivity(…, { area:
   'promotions' }) call's detail begins "Post art: ", "Post picture" or "Post layout" (social posts) or names the
   mailer (mailers). A new kind of entry written with other words fails here, so its words are added above first. */
function promoCalls(file) {
  return read(file).split('\n').filter(function (l) { return l.indexOf('logActivity(') !== -1 && l.indexOf("area: 'promotions'") !== -1; }).map(function (l) {
    var tail = l.slice(l.indexOf('logActivity('));
    var verb = /decoded, (?:[a-z]+ \? '[a-z]+' : )?'([a-z]+)', /.exec(tail);
    return { verb: verb && verb[1], detail: verb ? tail.slice(verb.index + verb[0].length).replace(/^'/, '') : '' };
  });
}
var postCalls = promoCalls('functions/lib/promo-social.js'), mailerCalls = promoCalls('functions/lib/promo-mailer.js');
check('UX-015 lib/promo-social.js\'s six Promotions entries are each said as a social post\'s', postCalls.length === 6 && postCalls.every(function (c) {
  return /^Post (art: |picture|layout)/.test(c.detail) && /^Social post (art|picture|layout) /.test(AWORDS.actionLabel(c.verb, 'promotions', c.detail));
}), postCalls.map(function (c) { return [c.verb, c.detail.slice(0, 40), AWORDS.actionLabel(c.verb, 'promotions', c.detail)]; }));
check('UX-015 lib/promo-mailer.js\'s four Promotions entries are each said as a mailer\'s', mailerCalls.length === 4 && mailerCalls.every(function (c) {
  return /^Mailer /.test(AWORDS.actionLabel(c.verb, 'promotions', c.detail));
}), mailerCalls.map(function (c) { return [c.verb, c.detail.slice(0, 40), AWORDS.actionLabel(c.verb, 'promotions', c.detail)]; }));
check('UX-015 a person by name from their address; the platform as the platform; a non-address as it is', AWORDS.personName('sachitanand.rai@timesinternet.in') === 'Sachitanand Rai' &&
  AWORDS.personName('ASHA_RAO@timesinternet.in') === 'Asha Rao' && AWORDS.personName('platform') === 'Platform (automated)' && AWORDS.personName('') === 'Platform (automated)' && AWORDS.personName('system') === 'Platform (automated)' &&
  AWORDS.personName('qa-agent') === 'qa-agent' && AWORDS.personName('12@x.in') === '12@x.in');
check('UX-015 fields by label: templateId, logoUrl, photoUrl, registrationLimit, seoTitle', AWORDS.fieldLabel('templateId') === 'Template' && AWORDS.fieldLabel('logoUrl') === 'Logo' &&
  AWORDS.fieldLabel('photoUrl') === 'Photo' && AWORDS.fieldLabel('registrationLimit') === 'Registration limit' && AWORDS.fieldLabel('seoTitle') === 'SEO title' && AWORDS.fieldLabel('section edges') === 'Section edges' &&
  AWORDS.fieldLabel('url') === 'Url' && AWORDS.fieldLabel('') === '');
check('UX-015 sections by name: faqs is FAQs', AWORDS.sectionLabel('faqs') === 'FAQs' && AWORDS.sectionLabel('speakers') === 'Speakers' && AWORDS.sectionLabel('awardCategory') === 'Award Category' && AWORDS.sectionLabel('') === '');
check('UX-015 a Basics edit\'s detail says its fields by label', AWORDS.detailText({ action: 'updated', detail: 'name, templateId', fields: [{ field: 'name' }, { field: 'templateId' }] }) === 'Name, Template');
check('UX-015 …a Content change\'s tail too; any other detail as written', AWORDS.detailText({ action: 'content-changed', detail: 'speaker “Asha” — name, photoUrl', fields: [{ field: 'name' }, { field: 'photoUrl' }] }) === 'speaker “Asha” — Name, Photo' &&
  AWORDS.detailText({ action: 'site-saved', detail: 'version 4 — 2 changes', fields: [{ field: 'x' }] }) === 'version 4 — 2 changes' && AWORDS.detailText({ action: 'updated', detail: 'Mailer “A” renamed' }) === 'Mailer “A” renamed');
check('UX-015 the areas in one order, the same nine', same(AWORDS.AREAS.map(function (a) { return a[0]; }), require('./activity').AREAS));
var activity = require('./activity'), aq = require('./activity-query'), apiAct = require('./api-activity');
check('UX-015 a Basics edit is written under Content', activity.AREA_OF.updated === 'content' && activity.areaOf({ action: 'updated' }) === 'content');
check('UX-015 …and one stored as Settings before is read as Content, by all three readers', activity.areaOf({ action: 'updated', area: 'settings' }) === 'content' &&
  aq.areaOf({ action: 'updated', area: 'settings' }) === 'content' && apiAct.areaOf({ action: 'updated', area: 'settings' }) === 'content' && aq.entryOf('x', { action: 'updated', area: 'settings', at: '2026-11-01T00:00:00Z' }).area === 'content');
check('UX-015 …while Promotions\' and the description\'s own areas, and real settings, stay', activity.areaOf({ action: 'updated', area: 'promotions' }) === 'promotions' &&
  aq.areaOf({ action: 'updated', area: 'event' }) === 'event' && apiAct.areaOf({ action: 'settings-changed', area: 'settings' }) === 'settings' && activity.areaOf({ action: 'status-changed' }) === 'settings');
/* …and both logs hand the entry's detail to those words: a row of each, drawn by the page's own function (the
   console's escaping is the shared kit's, so the Activity log's same-shaped one stands in for it) */
var alogRowCtx = { AW: AWORDS, AREA_LABEL: { promotions: 'Promotions' }, when: function () { return '7 Nov 2026, 11:05 am'; }, encodeURIComponent: encodeURIComponent };
vm.createContext(alogRowCtx);
var alogSrc = ALOG.slice(ALOG.lastIndexOf('<script>'), ALOG.lastIndexOf('</script>'));
vm.runInContext([fnSource(alogSrc, 'esc'), fnSource(alogSrc, 'eventHref'), fnSource(alogSrc, 'rowHtml'), 'this.rowHtml = rowHtml;'].join('\n'), alogRowCtx);
var conRowCtx = { AW: AWORDS, EV: { id: 'qa-ev' }, LOG_AREA_BADGE: { promotions: 'b-accent' }, histLines: function () { return []; }, histWhen: function () { return '7 Nov 2026, 11:05 am'; }, histApprovedBy: function () { return ''; }, encodeURIComponent: encodeURIComponent };
vm.createContext(conRowCtx);
vm.runInContext([fnSource(alogSrc, 'esc'), fnSource(CONSOLE, 'actionLabel'), fnSource(CONSOLE, 'areaLabel'), fnSource(CONSOLE, 'isPlatform'), fnSource(CONSOLE, 'whoLabel'), fnSource(CONSOLE, 'logRow'), 'this.logRow = logRow;'].join('\n'), conRowCtx);
var postReset = { at: '2026-11-07T05:35:00Z', by: 'qa.agent@timesinternet.in', area: 'promotions', action: 'deleted', detail: 'Post layout reset: Square · 1:1', eventId: 'qa-ev', eventName: 'QA event' };
var aRow = alogRowCtx.rowHtml(postReset), cRow = conRowCtx.logRow(postReset);
check('UX-015 the all-events log draws a social post\'s layout reset as one, not as a mailer deleted', aRow.indexOf('<div class="what-act">Social post layout reset</div>') !== -1 && aRow.indexOf('Mailer') === -1, aRow);
check('UX-015 …and so does the console\'s', cRow.indexOf('<div class="alog-act">Social post layout reset</div>') !== -1 && cRow.indexOf('Mailer') === -1, cRow);
var mailerRow = conRowCtx.logRow({ at: '2026-11-07T05:35:00Z', by: 'qa.agent@timesinternet.in', area: 'promotions', action: 'deleted', detail: 'Mailer “Launch invite” (Invite) deleted' });
check('UX-015 …while a mailer\'s deletion still reads Mailer deleted', mailerRow.indexOf('<div class="alog-act">Mailer deleted</div>') !== -1, mailerRow);
check('UX-015 both CSVs and the all-events search say the same words (each call hands over the detail)', (ALOG.match(/AW\.actionLabel\(it\.action, it\.area, it\.detail\)/g) || []).length === 3 &&
  ALOG.indexOf('AW.actionLabel(it.action, it.area)') === -1 && CONSOLE.indexOf('actionLabel(h.action, h.area, h.detail)') !== -1 && !/actionLabel\(h\.action, (h\.)?area\)/.test(CONSOLE));
check('UX-015 activity-words.js names the tests that check it (there is no activity-words.test.js)', read('activity-words.js').indexOf('functions/lib/activity-words.test.js') === -1 &&
  read('activity-words.js').indexOf('functions/lib/events-dashboard-b11.test.js') !== -1 && !fs.existsSync(path.join(__dirname, 'activity-words.test.js')));
var alogFilters = (/<form class="filters"[\s\S]*?<\/form>/.exec(ALOG) || [''])[0];
var alogOrder = (alogFilters.match(/<label for="f-[a-z]+">[^<]+<\/label>/g) || []).map(function (l) { return l.replace(/<[^>]+>/g, ''); });
check('UX-015 the all-events log\'s filters: Event · Person · Area · From · To · Search', same(alogOrder, ['Event', 'Person', 'Area', 'From', 'To', 'Search']), alogOrder);
var conToolbar = fnSource(CONSOLE, 'logToolbar');
var conOrder = (conToolbar.match(/<label class="alog-f[^"]*"><span>[^<]+<\/span>/g) || []).map(function (l) { return l.replace(/<[^>]+>/g, ''); });
check('UX-015 the console\'s filters: the same order and words, without Event', same(conOrder, ['Person', 'Area', 'From', 'To', 'Search']), conOrder);
check('UX-015 both lists head their columns When (IST) · Person …', ALOG.indexOf('<th>When (IST)</th><th>Person</th><th>Event</th><th>Area</th><th>What changed</th>') !== -1 &&
  CONSOLE.indexOf('<div>When (IST)</div><div>Person</div><div>Area</div><div>What changed</div>') !== -1);
check('UX-015 both pages load activity-words.js and read their words from it', ALOG.indexOf('<script src="activity-words.js"></script>') !== -1 && CONSOLE.indexOf('<script src="activity-words.js"></script>') !== -1 &&
  /var AW = window\.RevampActivityWords;/.test(ALOG) && /var AW = window\.RevampActivityWords \|\| null;/.test(CONSOLE) && CONSOLE.indexOf('var HIST_AREA') === -1);
check('UX-015 the all-events log no longer prints the action\'s code under the sentence (the CSV keeps it)', ALOG.indexOf('what-action mono') === -1 && /'Action code'/.test(ALOG) && /'Action code'/.test(CONSOLE) &&
  /'Person email'/.test(ALOG) && /'Person email'/.test(CONSOLE));

/* ES5 (no build step serves these): the shared words, the Activity log's script, the dashboard's */
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the word check still runs */ }
[['activity-words.js', read('activity-words.js')], ['activity-log.html (inline)', ALOG.slice(ALOG.lastIndexOf('<script>') + 8, ALOG.lastIndexOf('</script>'))], ['Event_Listing.html (inline)', INLINE]].forEach(function (f) {
  var code = f[1].replace(/\/\*[\s\S]*?\*\//g, '');
  check(f[0] + ' is ES5 by its words (no let, const, arrows, template strings)', !/\blet\s|\bconst\s/.test(code) && code.indexOf('=>') === -1 && code.indexOf('`') === -1);
  if (esbuild) { var r = (function () { try { esbuild.transformSync(f[1], { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n')[0]; } })(); check(f[0] + ' is ES5 by esbuild', r === true, r); }
});

/* ---- UX-040 the Activity log's Event list ---- */
var alogScript = ALOG.slice(ALOG.lastIndexOf('<script>'), ALOG.lastIndexOf('</script>'));
var alogCtx = {};
vm.createContext(alogCtx);
vm.runInContext(/\n  var MON = [^\n]*;/.exec(alogScript)[0] + '\n' + fnSource(alogScript, 'eventDate') + '\n' + fnSource(alogScript, 'eventChoices') + '\nthis.eventDate = eventDate; this.eventChoices = eventChoices;', alogCtx);
check('UX-040 an event\'s date as entered: a day (India time for a stamp with a zone), else its words, else "Date not set"', alogCtx.eventDate({ start: '2026-12-05T10:41' }) === '5 Dec 2026' &&
  alogCtx.eventDate({ start: '2026-12-04T20:00:00.000Z' }) === '5 Dec 2026' && alogCtx.eventDate({ start: '2027-01-09' }) === '9 Jan 2027' && alogCtx.eventDate({ dateLabel: 'June 2027' }) === 'June 2027' && alogCtx.eventDate({}) === 'Date not set');
var choices = alogCtx.eventChoices([
  { id: 'autotech-2027', name: 'AutoTech Summit 2027', start: '2027-02-10T09:00', published: true },
  { id: 'autotech-2027-copy', name: 'AutoTech Summit 2027', start: '2027-02-10T09:00', published: true },
  { id: 'autotech-2027-draft', name: 'AutoTech Summit 2027', start: '2027-02-10T09:00', published: false },
  { id: 'bws-2026', name: 'Brand World Summit 2026', dateLabel: 'Q4 2026' }
], [{ id: 'bws-old', name: 'Brand World Summit 2026', start: '2026-03-01' }]);
check('UX-040 the Event list: name · date · state, the address only where that still reads the same, the deleted last', same(JSON.parse(JSON.stringify(choices)), [
  { id: 'autotech-2027', label: 'AutoTech Summit 2027 · 10 Feb 2027 · Published · /e/autotech-2027' },
  { id: 'autotech-2027-copy', label: 'AutoTech Summit 2027 · 10 Feb 2027 · Published · /e/autotech-2027-copy' },
  { id: 'autotech-2027-draft', label: 'AutoTech Summit 2027 · 10 Feb 2027 · Draft' },
  { id: 'bws-2026', label: 'Brand World Summit 2026 · Q4 2026 · Draft' },
  { id: 'bws-old', label: 'Brand World Summit 2026 · 1 Mar 2026 · Deleted' }
]), choices);

/* ======================================================================================================
   2. the dashboard, run
   ====================================================================================================== */
var NOW = Date.now(), DAY = 86400000;
function iso(ms) { return new Date(ms).toISOString(); }
function wall(n, hhmm) { return new Date(NOW + 330 * 60000 + n * DAY).toISOString().slice(0, 10) + 'T' + (hhmm || '09:00'); }
function baseItems() {
  return [
    { id: 'live-summit', name: 'Live Summit', category: 'ip', published: true, start: wall(-1), end: wall(1, '18:00'), portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW - 9 * DAY) },
    { id: 'up-near', name: 'Twin Forum', category: 'client', published: true, start: wall(3, '10:00'), end: wall(3, '18:00'), portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW - 4 * DAY) },
    { id: 'up-near-copy', name: 'Twin Forum', category: 'client', published: true, start: wall(3, '10:00'), end: wall(3, '18:00'), portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW - 4 * DAY) },
    { id: 'draft-new', name: 'Draft New', category: 'IP', published: false, portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW - DAY) },
    { id: 'done-one', name: 'Done One', category: 'ip', published: true, start: wall(-20), end: wall(-19), portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW - 15 * DAY) },
    { id: 'hr-live', name: 'On ETHRWorld', category: 'ip', published: true, start: wall(9), end: wall(9), portal: 'hr', portalName: 'ETHRWorld', counters: {}, updatedAt: iso(NOW - 6 * DAY) }
  ];
}
function page(o) {
  o = o || {};
  var live = (o.items || baseItems()).map(function (x) { return JSON.parse(JSON.stringify(x)); });
  var nav = [], timers = [], clip = [], anchors = [];
  var dom = makeDom(), d = dom.document;
  d.body.innerHTML = BODY;
  function store(mem) { return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } }; }
  var ctx = {
    document: d, console: { log: function () {}, warn: function () {}, error: function () {} },
    navigator: { onLine: true, clipboard: o.noClipboard ? undefined : { writeText: function (t) { clip.push(t); return Promise.resolve(); } } },
    location: { hash: '', pathname: '/Event_Listing.html', origin: 'http://localhost', reload: function () {} },
    history: { replaceState: function () {} },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, clearTimeout: function () {},
    requestAnimationFrame: function (fn) { fn(); return 0; }, scrollTo: function () {}, open: function () {},
    matchMedia: function (q) { return { matches: /hover: hover/.test(q) }; },
    addEventListener: function (t, fn) { (dom.winListeners[t] = dom.winListeners[t] || []).push(fn); },
    innerWidth: 1440, innerHeight: 900,
    URL: { createObjectURL: function () { return 'blob:qa'; }, revokeObjectURL: function () {} },
    Blob: function (parts, opts) { this.parts = parts; this.type = opts && opts.type; },
    fetch: function (url) {
      if (url === '/api/events') return Promise.resolve(response(200, { items: live }));
      if (url === '/api/events?deleted=1') return Promise.resolve(response(200, { items: [] }));
      if (url === '/api/settings/approvals') return Promise.resolve(response(200, { approvers: [], allowSelf: false, required: true }));
      if (/^\/api\/insights\?/.test(url)) return Promise.resolve(response(200, { byDay: [], events: [] }));
      if (/^\/api\/activity\/all\?/.test(url)) return Promise.resolve(response(200, { items: [], next: null }));
      if (url === '/api/promo/analytics/all') return Promise.resolve(response(200, { available: false, backend: 'none', series: [], totals: {} }));
      return Promise.resolve(response(404, { error: 'not here' }));
    },
    RevampAuth: { getIdToken: function () { return Promise.resolve('t'); }, currentUser: function () { return { uid: 'u', email: 'asha.rao@timesinternet.in', displayName: 'Asha Rao' }; }, authedFetch: function () { return Promise.resolve(response(404, {})); }, redirectToSignIn: function () {} },
    RevampPortals: {
      list: function () { return Promise.resolve(ROSTER.map(function (p) { return { slug: p.slug, name: p.name }; })); },
      working: function () { return Promise.resolve('cio'); }, cachedWorking: function () { return 'cio'; }, setWorking: function (v) { return Promise.resolve(v); },
      nameOf: function (slug) { var p = ROSTER.filter(function (r) { return r.slug === slug; })[0]; return p ? p.name : ''; },
      chipHtml: function () { return ''; }, openSetPortal: function () {}
    }
  };
  ctx.localStorage = store({}); ctx.sessionStorage = store({});
  ctx.window = ctx;
  Object.defineProperty(ctx.location, 'href', { get: function () { return 'http://localhost/Event_Listing.html'; }, set: function (v) { nav.push(v); } });
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx, { filename: 'edit-event-core.js' });
  vm.runInContext(LIFE, ctx, { filename: 'event-lifecycle.js' });
  if (!o.noQr) vm.runInContext(QRLIB, ctx, { filename: 'qrcode-generator.js' });
  /* a download is an <a download> the page clicks: record it */
  var make = d.createElement.bind(d);
  d.createElement = function (tag) {
    var el = make(tag);
    if (String(tag).toLowerCase() === 'a') el.click = function () { anchors.push({ href: el.href, download: el.download }); };
    if (String(tag).toLowerCase() === 'canvas') { el.getContext = function () { return { fillRect: function () {}, set fillStyle(v) {} }; }; el.toDataURL = function () { return 'data:image/png;base64,QA'; }; }
    return el;
  };
  vm.runInContext(INLINE, ctx, { filename: 'Event_Listing.html (inline)' });
  function $(id) { return d.getElementById(id); }
  return {
    ctx: ctx, dom: dom, doc: d, $: $, nav: nav, clip: clip, anchors: anchors,
    tab: function (name) { $('status-tabs').querySelector('[data-tab="' + name + '"]').click(); },
    type: function (el, v) { el.value = v; dom.fire(el, 'input'); },
    table: function () { return $('table-body').textContent.replace(/\s+/g, ' ').trim(); }
  };
}

async function main() {
  /* ---- UX-005 the Event type filter offers what exists ---- */
  var S = page();
  await flush();
  S.$('btn-type').click();
  var offered = S.$('type-popover').querySelectorAll('[data-type]').map(function (b) { return b.getAttribute('data-type'); });
  check('UX-005 the Event type filter offers only categories some event has (an "IP" one counts as IP)', same(offered, ['ip', 'client']), offered);
  check('UX-005 …by the one name each', S.$('type-popover').textContent.indexOf('IP Event') !== -1 && S.$('type-popover').textContent.indexOf('Client Event') !== -1 && S.$('type-popover').textContent.indexOf('Editorial') === -1);
  S.tab('draft');
  check('UX-005 a row\'s chip says "IP Event" (it was "Intellectual Property")', /IP Event/.test(S.table()) && S.table().indexOf('Intellectual') === -1, S.table());
  S = page({ items: [] });
  await flush();
  S.$('btn-type').click();
  check('UX-005 with no events the filter says so instead of offering seven empty categories', /No events to filter yet\./.test(S.$('type-popover').textContent) && S.$('type-popover').querySelectorAll('[data-type]').length === 0);

  /* ---- UX-040 the row's address ---- */
  S = page();
  await flush();
  S.tab('upcoming');
  check('UX-040 two rows of one name are told apart by their addresses', /\/e\/up-near(?!-)/.test(S.table()) && S.table().indexOf('/e/up-near-copy') !== -1, S.table());
  /* the dot between the type and the address belongs to the address (drawn before it by the stylesheet), so a long
     address that moves to its own line on a phone card does not leave the dot alone at the end of the line above */
  var rowsHtml = String(S.$('table-body').innerHTML) + String(S.$('card-list').innerHTML);
  check('UX-040 the type and the address are one row, the dot is the address\'s, no lone separator (rows and cards)', (rowsHtml.match(/<div class="ev-meta-line"><span class="ev-meta-row"><span class="ev-tag [^"]+">[^<]+<\/span><span class="ev-meta-next ev-addr" title="[^"]+">\/e\/up-near<\/span><\/span><\/div>/g) || []).length === 2 &&
    rowsHtml.indexOf('dotsep') === -1 && rowsHtml.indexOf('&middot;') === -1, rowsHtml.slice(0, 600));

  /* ---- UX-032 the QR picker and the code ---- */
  S.tab('draft');
  S.$('btn-qr-toolbar').click();
  var sel = S.$('qr-event-select');
  var groups = sel ? sel.querySelectorAll('optgroup').map(function (g) { return g.getAttribute('label'); }) : [];
  var opts = sel ? sel.querySelectorAll('option').map(function (op) { return op.getAttribute('value'); }) : [];
  check('UX-032 on the Drafts tab the picker still lists every published event of the portal, grouped Active, Upcoming, Completed', same(groups, ['Active', 'Upcoming', 'Completed']) &&
    same(opts, ['live-summit', 'up-near', 'up-near-copy', 'done-one']), [groups, opts]);
  check('UX-032 …no draft (it has no site for a code to open) and no event of another portal', opts.indexOf('draft-new') === -1 && opts.indexOf('hr-live') === -1);
  var optText = sel.querySelectorAll('option').map(function (op) { return op.textContent; });
  check('UX-040 each option says its date beside its name; the twins also their addresses', /^Live Summit · [0-9][^·]* [A-Z][a-z]{2} 20[0-9]{2}$/.test(optText[0]) && optText[0].indexOf(' am') === -1 && /^Twin Forum · .* · \/e\/up-near$/.test(optText[1]) && /^Twin Forum · .* · \/e\/up-near-copy$/.test(optText[2]), optText);
  S.$('qr-continue').click();
  S.$('qr-sec-website').click();
  var img = S.$('qr-img');
  check('UX-032 the code is drawn in the page, an SVG of the event\'s real address (no api.qrserver.com)', img.getAttribute('data-qr-text') === 'http://localhost/e/live-summit' && /^data:image\/svg\+xml;charset=utf-8,/.test(img.src) &&
    decodeURIComponent(img.src).indexOf('<path d="M') !== -1 && CODE.indexOf('qrserver') === -1 && PAGE.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').indexOf('qrserver') === -1 && S.$('qr-fail').hidden === true, [img.getAttribute('data-qr-text'), String(img.src).slice(0, 60)]);
  S.type(S.$('qr-ag-code'), 'Mailer Nov');
  check('UX-032 an AG code goes into the link and the code at once', S.$('qr-link-text').textContent === 'http://localhost/e/live-summit?ag=Mailer%20Nov' && S.$('qr-img').getAttribute('data-qr-text') === 'http://localhost/e/live-summit?ag=Mailer%20Nov');
  S.$('qr-dl-svg').click();
  S.$('qr-dl-png').click();
  check('UX-032 Download SVG and Download PNG save the code, named for the event, the code and the AG code', same(S.anchors, [{ href: 'blob:qa', download: 'live-summit-website-mailer-nov-qr.svg' }, { href: 'data:image/png;base64,QA', download: 'live-summit-website-mailer-nov-qr.png' }]), S.anchors);
  S.$('qr-done').click();
  /* the module drawing: a real code for a real address, with the quiet zone */
  var Q = { };
  Q.window = Q;
  vm.createContext(Q);
  vm.runInContext(QRLIB + '\n' + ['qrModules', 'qrSvg', 'qrFileName'].map(function (n) { return fnSource(INLINE, n); }).join('\n'), Q);
  var m = vm.runInContext('qrModules("https://revamp-cms--revamp-cms.us-east4.hosted.app/e/brand-world-summit-2026")', Q);
  var svgOut = m ? vm.runInContext('qrSvg(qrModules("https://revamp-cms--revamp-cms.us-east4.hosted.app/e/brand-world-summit-2026"), 1024)', Q) : '';
  check('UX-032 the code: a version the address fits, finder squares where they belong, a 4-module quiet zone, black on white', m && m.n >= 25 && m.dark(0, 0) && m.dark(6, 6) && !m.dark(7, 7) &&
    new RegExp('viewBox="0 0 ' + (m.n + 8) + ' ' + (m.n + 8) + '" width="1024" height="1024"').test(svgOut) && svgOut.indexOf('<rect width="' + (m.n + 8) + '" height="' + (m.n + 8) + '" fill="#ffffff"/>') !== -1 && svgOut.indexOf('M4 4h1v1h-1z') !== -1, m && m.n);
  check('UX-032 file names keep only letters and numbers from the AG code', vm.runInContext('qrFileName({ id: "bws-2026" }, "agenda", " LinkedIn/Paid #3 ", "png")', Q) === 'bws-2026-agenda-linkedin-paid-3-qr.png' &&
    vm.runInContext('qrFileName({ id: "bws-2026" }, "website", "", "svg")', Q) === 'bws-2026-website-qr.svg');
  S = page({ noQr: true });
  await flush();
  S.$('btn-qr-toolbar').click();
  S.$('qr-continue').click();
  S.$('qr-sec-agenda').click();
  check('UX-032 if the QR library did not load, it says so and offers the link; the downloads are off', S.$('qr-fail').hidden === false && S.$('qr-img').hidden === true && S.$('qr-dl-png').disabled === true && S.$('qr-dl-svg').disabled === true && /\/e\/live-summit\/agenda/.test(S.$('qr-link-text').textContent));
  S = page({ items: baseItems().filter(function (e) { return !e.published; }) });
  await flush();
  S.$('btn-qr-toolbar').click();
  check('UX-032 with nothing published it says why there is nothing to pick', /No published events on this portal yet\. A QR code opens an event's live site/.test(S.$('sheet-root').textContent) && !S.$('qr-continue'));

  /* ---- UX-028 the help window ---- */
  S = page();
  await flush();
  var help = S.$('btn-help');
  help.focus(); help.click();
  check('UX-028 the window offers "Open in email app" and "Copy message", and Close (not Cancel: nothing is thrown away)', /Open in email app/.test(S.$('help-send').textContent) && /Copy message/.test(S.$('help-copy').textContent) && S.$('help-cancel').textContent === 'Close');
  check('UX-028 it does not promise to send anything itself', S.$('sheet-root').textContent.indexOf('straight to our team') === -1 && /send it from your own email/.test(S.$('sheet-root').textContent));
  S.$('help-send').click();
  check('UX-028 with no question yet, it asks for one and opens nothing', S.nav.length === 0 && /Write your question first/.test(S.$('help-note').textContent) && S.$('help-note').hidden === false);
  S.type(S.$('help-message'), 'The Agenda page shows last year\'s speakers & dates.');
  S.type(S.$('help-subject'), 'Agenda wrong on BWS');
  S.$('help-send').click();
  check('UX-028 Open in email app hands the message to the email app (mailto with subject and text)', S.nav.length === 1 &&
    S.nav[0] === 'mailto:customercare@economictimesb2b.com?subject=' + encodeURIComponent('Agenda wrong on BWS') + '&body=' + encodeURIComponent('The Agenda page shows last year\'s speakers & dates.'), S.nav);
  check('UX-028 …and the window stays open, saying nothing is sent until they send it, and how to use Gmail instead', !!S.$('help-note') && /sent only when you press Send there/.test(S.$('help-note').textContent) &&
    /Copy message/.test(S.$('help-note').textContent) && /Gmail/.test(S.$('help-note').textContent) && S.$('help-message').value === 'The Agenda page shows last year\'s speakers & dates.');
  S.$('help-copy').click();
  await flush();
  check('UX-028 Copy message copies who it is for, the subject and the text, and says where to paste it', S.clip[S.clip.length - 1] === 'To: customercare@economictimesb2b.com\nSubject: Agenda wrong on BWS\n\nThe Agenda page shows last year\'s speakers & dates.' &&
    /Message copied\./.test(S.$('help-note').textContent) && /Nothing is sent until you send it there/.test(S.$('help-note').textContent), S.clip);
  S.dom.key(S.$('help-message'), 'Escape');
  check('UX-028 Escape closes it and the focus goes back to Help', S.$('sheet-root').innerHTML === '' && S.doc.activeElement === help);
  help.click();
  check('UX-028 opened again, what was typed is still there', S.$('help-message').value === 'The Agenda page shows last year\'s speakers & dates.' && S.$('help-subject').value === 'Agenda wrong on BWS');
  S.$('help-cancel').click();
  S = page({ noClipboard: true });
  await flush();
  S.$('btn-help').click();
  S.type(S.$('help-message'), 'Help please');
  S.$('help-copy').click();
  await flush();
  check('UX-028 a browser that will not copy is told how to copy by hand, the message kept', /would not copy it/.test(S.$('help-note').textContent) && S.$('help-message').value === 'Help please');

  console.log('events-dashboard-b11: ' + (failed ? failed + ' of ' + (passed + failed) + ' checks FAILED' : 'all ' + passed + ' checks passed'));
}

/* the two logo pictures: only the lettering may differ (tools/build-app-logo.js's own check) */
async function logo() {
  var tool = require('../../tools/build-app-logo.js');
  var a = await tool.pixels(tool.LIGHT), b = await tool.pixels(tool.DARK);
  check('UX-023 the dark logo differs from the light one only in its neutral lettering: the red ET square and the blue arrow exactly as drawn', tool.firstBreak(a, b) === null, tool.firstBreak(a, b));
  var changed = 0;
  for (var i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) changed++;
  check('UX-023 …and the lettering did change (it is light on a dark ground)', changed > 1000, changed);
  var lettering = 0, light = 0;
  for (var j = 0; j < a.data.length; j += 4) {
    if (a.data[j + 3] > 200 && a.data[j] < 40 && a.data[j + 1] < 40 && a.data[j + 2] < 40) { lettering++; if (b.data[j] > 215 && b.data[j + 1] > 215 && b.data[j + 2] > 215) light++; }
  }
  check('UX-023 every solid black pixel of the lettering is light in the dark copy', lettering > 1000 && light === lettering, [lettering, light]);
}

logo().then(main).then(function () { process.exit(failed ? 1 : 0); }, function (err) { console.error('CRASH ' + (err && err.stack || err)); process.exit(1); });
