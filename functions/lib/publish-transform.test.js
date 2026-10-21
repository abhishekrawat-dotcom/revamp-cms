/* node functions/lib/publish-transform.test.js — exits 1 on the first failure it lists.
   The publish transform (lib/api.js) on a page as the editor saves it: what a live page must keep, what
   must never reach it, and what is written exactly once. No network, no Firebase. */

const { publishTransform } = require('./api')._testHooks;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function count(text, needle) { return text.split(needle).length - 1; }

var ORIGIN = 'http://localhost:8123';
var PAGE = [
  '<!DOCTYPE html>',
  '<html lang="en" data-rv-editing style="--theme-color:#123456;--heading-font-family:Lora">',
  '<head><meta charset="utf-8"><title>tech500 template</title>',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@400;700&display=swap">',
  '<link rel="stylesheet" href="' + ORIGIN + '/templates/_shared/et-global.css">',
  '<link rel="stylesheet" href="' + ORIGIN + '/templates/_shared/rv-sections.css">',
  '<link rel="stylesheet" href="' + ORIGIN + '/templates/_shared/rv-live.css">',
  '<style data-rv-design>h1{color:var(--theme-color)}</style>',
  '<style data-rv-style="hero">[data-rv-section="hero"]{padding:10px}</style>',
  '<link rel="icon" href="' + ORIGIN + '/old.ico">',
  '<script id="rv-site-config" type="application/json">{"eventId":"someone-else","mode":"live"}</script>',
  '</head>',
  '<body style="background:#fafafa" data-rv-event-id="another-event" class="show-ai-markers home">',
  '<div class="rv-slot-header" data-rv-locked="header" style="position:fixed">Shared header — design to come</div>',
  '<div class="rv-slot-header" data-rv-locked="header" style="position:fixed"></div>',
  '<div data-rv-locked="footer">Edited by the owner</div>',
  '<section id="hero" data-rv-section="hero" data-rv-key="k1" data-editable="1" contenteditable="true" class="hero ed-selected" data-ai-generated="1" data-ai-review="pending">',
  '<h1 data-rv-bind="event.name" data-text-original="x">Summit</h1><p data-rv-unbound="event.date">Soon</p>',
  '<img data-rv-bind="event.logo" data-rv-from-data src="' + ORIGIN + '/assets/logo.png" alt="">',
  '<a href="#speakers" data-register-cta target="_blank" rel="noopener">Register now</a>',
  '<span class="ai-prov-badge">AI</span><span data-rv-bind-hint data-rv-editor>Add the date in Basics</span>',
  '</section>',
  '<section id="speakers" data-rv-section="speakers" data-rv-bound="speakers">',
  '<div class="grid" data-rv-list="speakers" data-rv-list-at="1"><h2>Speakers</h2>',
  '<article data-rv-item="speakers" data-rv-id="abc"><b data-rv-field="n">Asha</b><i data-rv-field="r" data-rv-hidden-empty="1" hidden></i><img data-rv-replaced="1" src="https://storage.googleapis.com/b/a.png"></article>',
  '</div>',
  '<template data-rv-pristine="speakers"><article data-rv-repeat-template="speakers" data-editable="1" contenteditable="true"><b data-rv-field="n" data-sec-name="x">Name</b></article></template>',
  '<template data-rv-model="x"><i>m</i></template>',
  '</section>',
  '<section id="faq" data-rv-section="faq" data-rv-empty="faq" data-rv-sample="1"><div data-rv-empty-state="faq" data-rv-editor data-ed="none">No FAQs yet — add them in Content › FAQ</div></section>',
  '<section id="film" data-rv-section="film" data-rv-video-off="1"><video src="x.mp4"></video><p>Our film</p></section>',
  '<div data-rv-editor>toolbar</div><!-- a note for developers -->',
  '<script src="' + ORIGIN + '/templates/_shared/et-runtime.js"></script>',
  '<script src="' + ORIGIN + '/templates/_shared/rv-live.js"></script>',
  '</body></html>'
].join('\n');

var EVENT = { name: 'QA <Summit> & Co', dateLabel: '14th March, 2027', venue: 'Taj', city: 'Mumbai',
  logoUrl: 'https://storage.googleapis.com/bucket/events/x/logo/abc-logo.png' };
var out = publishTransform(PAGE, { eventId: 'qa-fixture', event: EVENT, mode: 'live', templateId: 'tech500', origins: [ORIGIN], publicBase: 'https://cms.example' });

/* ---- kept ---- */
[['the Google Fonts stylesheet', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@400;700&display=swap">'],
 ['the inline style on <html>', 'style="--theme-color:#123456;--heading-font-family:Lora"'],
 ['the inline style on <body>', 'style="background:#fafafa"'],
 ['<style data-rv-design>', '<style data-rv-design>h1{color:var(--theme-color)}</style>'],
 ['<style data-rv-style>', '<style data-rv-style="hero">'],
 ['data-register-cta with its href, target and rel', '<a href="#speakers" data-register-cta target="_blank" rel="noopener">Register now</a>'],
 ['data-rv-key and data-rv-section', 'data-rv-section="hero" data-rv-key="k1"'],
 ['data-rv-bind', 'data-rv-bind="event.name"'], ['data-rv-unbound', 'data-rv-unbound="event.date"'],
 ['data-rv-from-data', 'data-rv-from-data'], ['data-rv-bound', 'data-rv-bound="speakers"'],
 ['data-rv-list and data-rv-list-at', 'data-rv-list="speakers" data-rv-list-at="1"'],
 ['data-rv-item and data-rv-id', 'data-rv-item="speakers" data-rv-id="abc"'],
 ['data-rv-field', 'data-rv-field="n"'], ['data-rv-hidden-empty and hidden', 'data-rv-hidden-empty="1" hidden'],
 ['data-rv-replaced', 'data-rv-replaced="1"'],
 ['<template data-rv-pristine> with its model', '<template data-rv-pristine="speakers"><article data-rv-repeat-template="speakers">'],
 ['<template data-rv-model>', '<template data-rv-model="x"><i>m</i></template>'],
 ['data-rv-empty on the section (not the notice)', 'data-rv-empty="faq"'],
 ['data-rv-sample', 'data-rv-sample="1"'],
 ['the section id', '<section id="hero"'], ['the viewport meta as written', 'content="width=device-width, initial-scale=1"']
].forEach(function (c) { ok(out.indexOf(c[1]) !== -1, 'keeps ' + c[0], 'looked for  ' + c[1]); });

/* ---- removed ---- */
[['the header strip with its placeholder text', 'design to come'], ['any header / footer strip element', 'rv-slot-header'],
 ['every data-rv-locked element', 'data-rv-locked'], ['a footer strip whose text was edited', 'Edited by the owner'],
 ['the editor empty-state notice', 'No FAQs yet'], ['data-rv-empty-state', 'data-rv-empty-state'],
 ['the bind hint', 'Add the date in Basics'], ['a section switched off for its video', 'Our film'],
 ['AI badges', 'ai-prov-badge'], ['data-ai-* attributes (known and new)', 'data-ai-'], ['show-ai-markers', 'show-ai-markers'],
 ['editor attributes, inside <template> too', 'contenteditable'], ['data-editable', 'data-editable'], ['data-sec-name', 'data-sec-name'],
 ['data-text-original', 'data-text-original'], ['data-rv-editing', 'data-rv-editing'], ['editor chrome', 'toolbar'],
 ['ed-selected', 'ed-selected'], ['HTML comments', 'a note for developers'], ['the saving origin', ORIGIN],
 ['another event\'s id', 'another-event'], ['an older config block', 'someone-else'], ['the old favicon', 'old.ico'],
 ['user-scalable=0', 'user-scalable']
].forEach(function (c) { ok(out.toLowerCase().indexOf(c[1].toLowerCase()) === -1, 'removes ' + c[0], 'found  ' + c[1]); });

/* ---- written exactly once ---- */
ok(count(out, 'id="rv-site-config"') === 1, 'exactly one rv-site-config');
/* the visitor-side script is linked only once it exists in the repo — a page must never link a file that 404s */
var LIVE_RUNTIME = require('fs').existsSync(require('path').join(__dirname, '..', '..', 'templates', '_shared', 'rv-live.js'));
ok(count(out, '/templates/_shared/rv-live.js"') === (LIVE_RUNTIME ? 1 : 0), LIVE_RUNTIME ? 'exactly one rv-live.js' : 'no rv-live.js while the file does not exist', String(count(out, 'rv-live.js')));
ok(count(out, '/templates/_shared/rv-live.css"') === 1, 'exactly one rv-live.css');
ok(count(out, '/templates/_shared/rv-data.js"') === 1, 'exactly one rv-data.js');
ok(count(out, '/templates/_shared/rv-popups.js"') === 1 && require('fs').existsSync(require('path').join(__dirname, '..', '..', 'templates', '_shared', 'rv-popups.js')), 'exactly one rv-popups.js (speaker profiles and photo pop-ups), and the file exists');
ok(out.indexOf('href="/templates/_shared/rv-sections.css"') !== -1 && out.indexOf('href="/templates/_shared/et-global.css"') !== -1, 'shared stylesheets are root-relative');
ok(out.indexOf('src="/templates/_shared/et-runtime.js"') !== -1 && out.indexOf('src="/assets/logo.png"') !== -1, 'scripts and images of the saving origin are root-relative');
var cfg = JSON.parse(/<script id="rv-site-config"[^>]*>([\s\S]*?)<\/script>/.exec(out)[1]);
ok(cfg.eventId === 'qa-fixture' && cfg.mode === 'live' && cfg.templateId === 'tech500', 'the config names this event, live mode and the template', JSON.stringify(cfg).slice(0, 120));
var realMap = require('../../templates/tech500/template.json').content.map;
ok(Array.isArray(cfg.contentMap) && cfg.contentMap.length === realMap.length && cfg.contentMap.length > 0, 'contentMap is the template\'s own content.map', String(cfg.contentMap && cfg.contentMap.length));
ok(out.indexOf('data-rv-event-id="qa-fixture"') !== -1, 'the body carries this event\'s id');
ok(out.indexOf('<title>QA &lt;Summit&gt; &amp; Co</title>') !== -1, 'the title is the event name, escaped');
ok(count(out, 'rel="icon"') === 1 && out.indexOf('<link rel="icon" href="https://storage.googleapis.com/bucket/events/x/logo/abc-logo.png"') !== -1, 'the tab icon is the event logo');
ok(out.indexOf('<link rel="canonical" href="https://cms.example/e/qa-fixture"') !== -1, 'canonical is the public address');
ok(publishTransform(out, { eventId: 'qa-fixture', event: EVENT, mode: 'live', templateId: 'tech500', origins: [ORIGIN], publicBase: 'https://cms.example' }) === out, 'running it again changes nothing');

/* ---- variations ---- */
var gen = publishTransform(PAGE, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: 'gen-qa-fixture', origins: [ORIGIN] });
var gcfg = JSON.parse(/<script id="rv-site-config"[^>]*>([\s\S]*?)<\/script>/.exec(gen)[1]);
ok(Array.isArray(gcfg.contentMap) && gcfg.contentMap.length === 0 && gcfg.mode === 'preview', 'an AI-designed site gets an empty contentMap; preview mode is stated');
ok(gen.indexOf('href="/assets/et-b2b-logo.svg"') !== -1 && count(gen, 'rel="icon"') === 1, 'no logo: the default icon');
ok(gen.indexOf('data-rv-preview-ribbon') !== -1 && gen.indexOf('noindex') !== -1, 'a preview has the ribbon and is not indexed');
['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', '//evil.example/x.png', '/x" onerror="y'].forEach(function (bad) {
  var o = publishTransform(PAGE, { eventId: 'qa-fixture', event: { name: 'G', logoUrl: bad }, mode: 'live', templateId: 'tech500', origins: [ORIGIN] });
  ok(o.indexOf('href="/assets/et-b2b-logo.svg"') !== -1 && o.indexOf('onerror="y"') === -1 && o.indexOf('evil.example') === -1, 'a logo that is not an uploaded picture is not used as the icon: ' + bad);
});

/* ---- an AI-designed site: section headings held to the type scale, the hero's own type kept ---- */
var HERO_CSS = '[data-rv-section="hero"] .hero-tagline{font-size:clamp(2.6rem,6.5vw,5rem)}';
var OVERVIEW_CSS = '[data-rv-section="overview"] .overview-title{font-size:clamp(2rem,4.2vw,3.25rem);line-height:1.1}[data-rv-section="overview"] .overview-num{font-size:4rem}';
var GEN_PAGE = '<!DOCTYPE html><html><head><title>x</title><style data-rv-style="hero">' + HERO_CSS + '</style><style data-rv-style="overview">' + OVERVIEW_CSS + '</style><style data-rv-design>h2{color:red}</style></head>' +
  '<body id="gen" data-rv-template-id="gen-qa-fixture" class="microsite rv-generated"><section data-rv-section="hero"><h1 class="hero-tagline">T</h1></section>' +
  '<section data-rv-section="overview"><h2 class="overview-title">About</h2><b class="overview-num">40+</b></section></body></html>';
var genOut = publishTransform(GEN_PAGE, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: 'gen-qa-fixture' });
ok(genOut.indexOf('.overview-title{font-size:clamp(1.75rem, 3.069vw, 2.375rem);line-height:1.1}') !== -1, 'an AI-designed page: a section heading saved loud is calm', genOut.slice(0, 600));
ok(genOut.indexOf(HERO_CSS) !== -1, 'the hero keeps its own type');
ok(genOut.indexOf('.overview-num{font-size:4rem}') !== -1, 'stat numerals are left alone');
ok(publishTransform(GEN_PAGE, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: null }).indexOf('.overview-title{font-size:clamp(1.75rem, 3.069vw, 2.375rem)') !== -1, 'known as AI-designed by its own body when no template id is given');
ok(publishTransform(genOut, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: 'gen-qa-fixture' }) === genOut, 'running it again changes nothing');
/* ---- an AI-designed site held to a phone's width: a grid's cells may shrink, no fixed width wider than its place ---- */
var WIDE_CSS = '[data-rv-section="about"] .about-wrap{display:grid;grid-template-columns:2fr 1fr}[data-rv-section="about"] .about-card{width:480px}';
var WIDE_PAGE = GEN_PAGE.replace('<style data-rv-design>', '<style data-rv-style="about">' + WIDE_CSS + '</style><style data-rv-design>');
var wideOut = publishTransform(WIDE_PAGE, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: 'gen-qa-fixture' });
ok(wideOut.indexOf(':where([data-rv-section="about"] .about-wrap) > *') !== -1 && wideOut.indexOf('.about-card{width:min(480px, 100%)}') !== -1, 'an AI-designed page: its sections are held to a phone\'s width', wideOut.slice(0, 900));
ok(publishTransform(wideOut, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: 'gen-qa-fixture' }) === wideOut, 'and running it again changes nothing');
ok(publishTransform(WIDE_PAGE.replace(' data-rv-template-id="gen-qa-fixture" class="microsite rv-generated"', ' class="home"'), { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'live', templateId: 'tech500' }).indexOf(WIDE_CSS) !== -1, 'a ported template\'s widths are not touched');
/* ---- the editor's mode signal, the "Edit with AI" button and the editor's live view ---- */
var EDITING = PAGE.replace('<html lang="en" data-rv-editing', '<html lang="en" data-rv-editing data-rv-editor-mode="manual"');
var liveOut = publishTransform(EDITING, { eventId: 'qa-fixture', event: EVENT, mode: 'live', templateId: 'tech500', origins: [ORIGIN] });
ok(liveOut.indexOf('data-rv-editor-mode') === -1 && liveOut.indexOf('rv-preview-edit.js') === -1, 'a published page carries no editor mode and no "Edit with AI" button');
ok(publishTransform(EDITING, { eventId: 'qa-fixture', event: EVENT, mode: 'live', templateId: 'tech500', origins: [ORIGIN], editButton: true }).indexOf('rv-preview-edit.js') === -1, 'the button is never put on a published page, even when asked for');
var withEdit = publishTransform(EDITING, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: 'gen-qa-fixture', origins: [ORIGIN], editButton: true });
ok(count(withEdit, '/templates/_shared/rv-preview-edit.js') === 1 && withEdit.indexOf('data-rv-editor-mode') === -1, 'a preview gets the "Edit with AI" button once, and no editor mode');
ok(publishTransform(withEdit, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: 'gen-qa-fixture', origins: [ORIGIN], editButton: true }) === withEdit, 'running it again changes nothing (button)');
ok(publishTransform(EDITING, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: 'gen-qa-fixture', origins: [ORIGIN] }).indexOf('rv-preview-edit.js') === -1, 'no button unless asked for (a saved version opened for review)');
var lv = publishTransform(EDITING, { eventId: 'qa-fixture', event: { name: 'G', designPlan: { design: { colours: {} } } }, mode: 'preview', templateId: 'gen-qa-fixture', origins: [ORIGIN], liveView: true, editButton: true });
ok(/<html lang="en"[^>]*\sdata-rv-editor-mode="ai"/.test(lv) && count(lv, 'data-rv-editor-mode') === 1, 'the live view\'s <html> says "ai", once', /<html[^>]*>/.exec(lv)[0]);
ok(lv.indexOf('data-rv-editing') === -1, 'the live view is not the editing canvas (the runtime runs as on the preview)');
ok(lv.indexOf('data-rv-preview-ribbon') === -1 && lv.indexOf('rv-preview-edit.js') === -1 && lv.indexOf('rv-theme-switcher.js') === -1, 'the live view has none of the preview\'s own controls');
ok(lv.indexOf('/templates/_shared/rv-data.js') !== -1 && lv.indexOf('"mode":"preview"') !== -1 && lv.indexOf(ORIGIN) === -1, 'the live view is otherwise the preview: runtime, preview mode, root-relative');
ok(publishTransform(lv, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'preview', templateId: 'gen-qa-fixture', liveView: true }) === lv, 'running it again changes nothing (live view)');

var fixed = GEN_PAGE.replace(' data-rv-template-id="gen-qa-fixture" class="microsite rv-generated"', ' class="home"');
ok(publishTransform(fixed, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'live', templateId: 'tech500' }).indexOf(OVERVIEW_CSS) !== -1, 'a ported template\'s CSS is not touched');

/* ET's common footer's copyright year is this year's on every publish; an edited one is left alone */
var YEAR_PAGE = GEN_PAGE.replace('</body>', '<footer data-rv-section="footer"><p class="etf-copy">Copyright © <span data-rv-year>2026</span> ETCIO.com. All Rights Reserved.</p><p><span data-rv-year>since 2019, proudly</span></p></footer></body>');
var yearOut = publishTransform(YEAR_PAGE, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'live', templateId: 'gen-qa-fixture', year: 2027 });
ok(yearOut.indexOf('Copyright © <span data-rv-year>2027</span> ETCIO.com.') !== -1, 'the footer\'s copyright year is the year it is published', yearOut.slice(yearOut.indexOf('<footer'), yearOut.indexOf('<footer') + 200));
ok(yearOut.indexOf('<span data-rv-year>since 2019, proudly</span>') !== -1, 'a year the owner rewrote as text is kept');
ok(publishTransform(YEAR_PAGE, { eventId: 'qa-fixture', event: { name: 'G' }, mode: 'live', templateId: 'gen-qa-fixture' }).indexOf('<span data-rv-year>' + new Date().getFullYear() + '</span>') !== -1, 'this year by default');

/* ---- registration forms: the runtime once, the definitions when given (lib/forms.js, spec section 1.4) ---- */
var H = require('./api')._testHooks;
var FORMS_SRC = '/templates/_shared/rv-forms.js?v=' + H.FORMS_RUNTIME_V;
var FORMS = { v: 1, eventId: 'qa-fixture', open: true, defaultFormId: 'register', waitlist: false,
  forms: [{ id: 'register', name: 'Register now', title: 'Say </script><b>hi</b>', intro: 'Line two', purpose: 'register', fields: [], submitLabel: 'Register', open: true, counts: true, rev: 1 }] };
var withForms = publishTransform(PAGE, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN], forms: FORMS });
ok(count(out, '/templates/_shared/rv-forms.js') === 1 && out.indexOf('<script src="' + FORMS_SRC + '" data-rv-runtime></script>') !== -1, 'exactly one rv-forms.js, versioned, without forms given');
ok(out.indexOf('id="rv-forms"') === -1, 'no #rv-forms block when no forms are given');
ok(out.indexOf('rv-popups.js') < out.indexOf('rv-forms.js'), 'rv-forms.js comes after rv-popups.js');
ok(count(withForms, '/templates/_shared/rv-forms.js') === 1 && count(withForms, 'id="rv-forms"') === 1, 'with forms: one runtime, one #rv-forms block');
var formsBlock = /<script id="rv-forms" type="application\/json" data-rv-runtime>([\s\S]*?)<\/script>/.exec(withForms);
ok(!!formsBlock && formsBlock[1].indexOf('</script') === -1 && formsBlock[1].indexOf('<') === -1 && formsBlock[1].indexOf(' ') === -1, 'the block escapes "<" and U+2028 as rv-site-config does');
ok(!!formsBlock && JSON.stringify(JSON.parse(formsBlock[1])) === JSON.stringify(FORMS), 'the block is the definitions, exactly');
ok(withForms.indexOf('id="rv-site-config"') < withForms.indexOf('id="rv-forms"') && withForms.indexOf('id="rv-forms"') < withForms.indexOf('rv-data.js'), '#rv-forms right after rv-site-config');
ok(publishTransform(withForms, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN], forms: FORMS }) === withForms, 'running it again with forms changes nothing');
var noForms = publishTransform(PAGE, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN] });
ok(publishTransform(noForms, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN] }) === noForms, 'running it again without forms changes nothing');
var FORMS2 = JSON.parse(JSON.stringify(FORMS)); FORMS2.forms[0].rev = 2;
var replaced = publishTransform(withForms, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN], forms: FORMS2 });
ok(count(replaced, 'id="rv-forms"') === 1 && replaced.indexOf('"rev":2') !== -1 && replaced.indexOf('"rev":1') === -1, 'a page with an older #rv-forms gets the new one in its place');
var dropped = publishTransform(withForms, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN] });
ok(dropped.indexOf('id="rv-forms"') === -1, 'transformed again without forms: the old block goes (the runtime fetches)');
var untagged = PAGE.replace('</body>', '<script id="rv-forms" type="application/json">{"v":0}</script><script src="' + ORIGIN + '/templates/_shared/rv-forms.js?v=0"></script></body>');
var cleaned = publishTransform(untagged, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN] });
ok(cleaned.indexOf('{"v":0}') === -1 && count(cleaned, 'rv-forms.js') === 1 && cleaned.indexOf('rv-forms.js?v=0') === -1, 'an untagged older copy of the block and the script are replaced');
ok(count(withForms, '/templates/_shared/rv-live.js"') === (LIVE_RUNTIME ? 1 : 0), 'the rv-live.js rule is unchanged with forms');
var previewForms = publishTransform(PAGE, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'preview', templateId: 'tech500', origins: [ORIGIN], forms: FORMS });
ok(count(previewForms, 'id="rv-forms"') === 1 && count(previewForms, 'rv-forms.js') === 1, 'the preview gets the definitions and the runtime too');
var embedPage = PAGE.replace('</section>', '<div class="rv-block-form" data-rv-form-embed="register" data-rv-form-title="hide"><p class="rv-form-fallback" data-rv-form-fallback>This form needs JavaScript.</p>' +
  '<div data-rv-form-preview data-rv-editor data-ed="none"><form>preview</form></div></div><a href="#rv-form-vip" data-rv-form="vip" data-register-cta>VIP</a></section>');
var embedOut = publishTransform(embedPage, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN] });
ok(embedOut.indexOf('<div class="rv-block-form" data-rv-form-embed="register" data-rv-form-title="hide"><p class="rv-form-fallback" data-rv-form-fallback>This form needs JavaScript.</p></div>') !== -1,
  'an embedded form keeps its markup and fallback; the editor\'s preview inside it is removed', embedOut.slice(embedOut.indexOf('rv-block-form') - 12, embedOut.indexOf('rv-block-form') + 300));
ok(embedOut.indexOf('<a href="#rv-form-vip" data-rv-form="vip" data-register-cta>VIP</a>') !== -1, 'a button that opens a form keeps its marks');

/* a page published before forms: the runtime goes in when it is served, once */
var EF = H.ensureFormsRuntime;
var oldPage = '<html><body><a data-register-cta href="#register">Register</a></body></html>';
var served = EF(oldPage);
ok(served === '<html><body><a data-register-cta href="#register">Register</a><script src="' + FORMS_SRC + '" data-rv-runtime></script>\n</body></html>', 'the runtime goes in before </body>', served);
ok(EF(served) === served, 'and only once');
ok(EF(withForms) === withForms, 'a page published with forms is left as it is');
ok(EF('<p>no body</p>') === '<p>no body</p><script src="' + FORMS_SRC + '" data-rv-runtime></script>\n', 'a page without </body>: at the end');
ok(EF('<body>a</body><!-- </BODY> -->x</BODY>').indexOf('a</body><!-- </BODY> -->x<script') !== -1, 'the LAST </body>, whatever its case');
ok(publishTransform(served, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live' }).split('rv-forms.js').length === 2, 'a served page transformed again still has one runtime');

/* pictures: the WebP copies the caller looked up (lib/pictures.js), written into the page once */
var PIC = require('./pictures');
var md5 = Buffer.from('a1b2c3d4'.padEnd(32, '0'), 'hex').toString('base64');
var PICS = PIC.indexFromListing('b', [{ name: 'events/qa-fixture/generated/1-x.png', md5Hash: md5 }, { name: PIC.variantName('events/qa-fixture/generated/1-x.png', 'a1b2c3d4', 1024, 768, 1024) }]);
var picPage = PAGE.replace('<section id="faq"', '<section id="pics"><img src="https://storage.googleapis.com/b/events/qa-fixture/generated/1-x.png" alt="x"></section><section id="faq"');
var picOut = publishTransform(picPage, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN], pictures: PICS });
ok(picOut.indexOf('<img src="https://storage.googleapis.com/b/events/qa-fixture/generated/1-x.png" alt="x" srcset="https://storage.googleapis.com/b/events/qa-fixture/generated/1-x.png.rv-a1b2c3d4.1024x768.w1024.webp 1x" width="1024" height="768" data-rv-sized>') !== -1,
  'a picture with a WebP copy gets it, and its size');
ok(count(picOut, '<style data-rv-pictures>') === 1 && picOut.indexOf('<style data-rv-pictures>') < picOut.indexOf('</head>'), 'the rule for sized pictures, once, in the head');
ok(publishTransform(picOut, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN], pictures: PICS }) === picOut, 'running it again changes nothing (pictures)');
ok(publishTransform(picPage, { eventId: 'qa-fixture', event: { name: 'Summit' }, mode: 'live', templateId: 'tech500', origins: [ORIGIN] }).indexOf('.rv-a1b2c3d4.') === -1, 'without pictures looked up, pictures are as they were');

/* section edges: designPlan.design.sectionEdges -> <html data-rv-edges>, and the blend runtime where it is needed */
var SMOOTH = { name: 'S', designPlan: { design: { sectionEdges: 'smooth' } } };
var BLEND = 'templates/_shared/rv-blend.js';
var smoothLive = publishTransform(PAGE, { eventId: 'qa-fixture', event: SMOOTH, mode: 'live', templateId: 'gen-qa-fixture' });
ok(/<html[^>]* data-rv-edges="smooth"/.test(smoothLive) && count(smoothLive, BLEND) === 1, 'a smooth site: data-rv-edges="smooth" on <html> and the blend runtime once');
ok(publishTransform(smoothLive, { eventId: 'qa-fixture', event: SMOOTH, mode: 'live', templateId: 'gen-qa-fixture' }) === smoothLive, 'running it again changes nothing (section edges)');
var sharpLive = publishTransform(PAGE, { eventId: 'qa-fixture', event: { name: 'S' }, mode: 'live', templateId: 'gen-qa-fixture' });
ok(/<html[^>]* data-rv-edges="sharp"/.test(sharpLive) && sharpLive.indexOf(BLEND) === -1, 'a site with no choice is sharp, and its published page does not load the blend runtime');
ok(publishTransform(smoothLive, { eventId: 'qa-fixture', event: { name: 'S' }, mode: 'live', templateId: 'gen-qa-fixture' }) === sharpLive, 'switching back to sharp leaves exactly the sharp page');
var sharpPreview = publishTransform(PAGE, { eventId: 'qa-fixture', event: { name: 'S' }, mode: 'preview', templateId: 'gen-qa-fixture' });
ok(/<html[^>]* data-rv-edges="sharp"/.test(sharpPreview) && count(sharpPreview, BLEND) === 1, 'a preview always has the blend runtime, so the choice can be tried there');
var imported = publishTransform(PAGE, { eventId: 'qa-fixture', event: SMOOTH, mode: 'preview', templateId: 'imported-imp-abc' });
ok(/<html[^>]* data-rv-edges="sharp"/.test(imported) && imported.indexOf(BLEND) === -1, 'an imported site is always sharp, with no blend runtime');
ok(publishTransform(PAGE.replace('<section id="hero"', '<section data-rv-edge-host="pos" id="hero"').replace('</body>', '<div data-rv-edge="top" data-rv-runtime aria-hidden="true"></div></body>'),
  { eventId: 'qa-fixture', event: { name: 'S' }, mode: 'live', templateId: 'gen-qa-fixture' }) === sharpLive, 'a fade and its mark saved from a live page never reach a published one');

if (failures.length) {
  console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
  failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
  process.exit(1);
}
console.log('publish-transform: all ' + checks + ' checks passed');
