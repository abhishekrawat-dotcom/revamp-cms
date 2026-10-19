/* node functions/lib/gen-markup.test.js — exits 1 on the first failure it lists. */

const { scopeSectionCss, sectionRootInfo, rootIsStyled, mobileSafeCss } = require('./gen-markup');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function flat(css) { return String(css).replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/([a-z-]):\s+/gi, '$1:').trim(); }
function has(css, needle, label) { ok(flat(css).indexOf(flat(needle)) !== -1, label, 'looked for  ' + flat(needle) + '\n      in  ' + flat(css)); }
function lacks(css, needle, label) { ok(flat(css).indexOf(flat(needle)) === -1, label, 'found  ' + flat(needle) + '\n      in  ' + flat(css)); }
function stable(css, id, info, label) {
  var once = scopeSectionCss(css, id, info), twice = scopeSectionCss(once, id, info);
  ok(once === twice, label + ': scoping twice gives the same sheet', '1: ' + flat(once) + '\n      2: ' + flat(twice));
  return once;
}

var S = '[data-rv-section="hero"]';
var CONTAIN = S + '{position:relative;isolation:isolate;overflow-x:clip}';

/* the case from the audit: the model scoped its own rules under the attribute, so none could match the root */
var out = stable('[data-rv-section="hero"] .h{position:relative} .h__bg{position:absolute;inset:0} @media (max-width:600px){.h{padding:8px}} body{margin:0}', 'hero', null, 'audit case');
ok(flat(out).indexOf(flat(CONTAIN)) === 0, 'the containment rule comes first', flat(out).slice(0, 120));
has(out, S + ' .h,' + S + '.h{position:relative}', 'a rule the model put under the scope now also matches the root');
has(out, S + ' .h__bg,' + S + '.h__bg{position:absolute;inset:0}', 'an unscoped rule is confined to the section');
has(out, '@media (max-width:600px){' + S + ' .h,' + S + '.h{padding:8px}}', 'rules inside @media are scoped too');
has(out, S + '{margin:0}', 'body becomes the section root');
lacks(out, 'body{', 'nothing is left that styles the page body');
ok((out.match(/isolation:isolate/g) || []).length === 1, 'the containment rule appears once');

/* with the root known, the compound form is only written where it can apply */
var info = sectionRootInfo('<header class="h h--dark" id="hero"><div class="h__bg"></div><h1>Title</h1></header>');
ok(info && info.tag === 'header' && info.id === 'hero' && info.classes.join(' ') === 'h h--dark', 'sectionRootInfo reads the root element', JSON.stringify(info));
out = stable('.h{color:red} .h__bg{inset:0} header{padding:0} header.h--dark h1{color:#fff} h1{margin:0} #hero{top:0} .other{x:y}', 'hero', info, 'with root info');
has(out, S + ' .h,' + S + '.h{color:red}', 'root class: both forms');
has(out, S + ' .h__bg{inset:0}', 'a class the root does not have: descendant form only');
lacks(out, S + '.h__bg', 'no compound form for a class the root does not have');
has(out, S + ' header,header' + S + '{padding:0}', 'the root tag: the type selector stays in front of the attribute');
has(out, S + ' header.h--dark h1,header' + S + '.h--dark h1{color:#fff}', 'tag + class compound followed by a descendant');
has(out, S + ' h1{margin:0}', 'another tag: descendant form only');
has(out, S + ' #hero,' + S + '#hero{top:0}', 'the root id');
ok(rootIsStyled(out, 'hero', info) === true, 'rootIsStyled: true when a rule applies to the root');
ok(rootIsStyled(scopeSectionCss('.h__bg{inset:0} h1{margin:0}', 'hero', info), 'hero', info) === false, 'rootIsStyled: false when only descendants are styled (the containment rule does not count)');
ok(rootIsStyled(scopeSectionCss('[data-rv-section="hero"] .h{color:red}', 'hero', info), 'hero', info) === true, 'rootIsStyled: true for the audit\'s shape once scoped');

/* selector shapes */
out = stable([
  'html{scroll-behavior:smooth}', ':root{--brand:#f00}', 'html body .x{a:b}', 'body.dark .y{a:b}', '*{box-sizing:border-box}',
  '*,*::before,*::after{margin:0}', '.a > .b + .c ~ .d{a:b}', '[data-rv-section="hero"]{background:#000}',
  '[data-rv-section="hero"] > .k{a:b}', 'section[data-rv-section="hero"].z .q{a:b}', '[data-rv-section="other"] .m{a:b}',
  '.btn:hover,.btn:focus-visible{a:b}', '.card:not(.is-off):nth-child(2n)::after{content:"x,y"}', 'a[href^="http"]{a:b}',
  '::selection{color:red}', '.n .n__a{a:b}'
].join('\n'), 'hero', null, 'selector shapes');
has(out, S + '{scroll-behavior:smooth}', 'html -> the section root');
has(out, S + '{--brand:#f00}', ':root -> the section root');
has(out, S + ' .x,' + S + '.x{a:b}', 'html body .x -> .x in the section');
has(out, S + ' .y,' + S + '.y{a:b}', 'body.dark .y -> .y in the section');
has(out, S + ' *,' + S + '{box-sizing:border-box}', '* -> everything in the section and the root');
has(out, S + ' *::before,' + S + '::before', 'pseudo-elements keep working');
has(scopeSectionCss('[data-rv-section="hero"]::before{content:""}', 'hero'), '}' + S + '::before{content:""}', 'the root\'s own ::before stays the root\'s own');
has(out, S + ' .a > .b + .c ~ .d,' + S + '.a > .b + .c ~ .d{a:b}', 'combinators are kept');
has(out, S + '{background:#000}', 'the bare scope stays the root');
has(out, S + ' > .k{a:b}', 'scope > child keeps its meaning');
has(out, 'section' + S + '.z .q{a:b}', 'a scope written inside a compound already names the root and stays on it');
lacks(out, S + ' section.z', 'and is not widened to descendants');
has(out, S + ' .m,' + S + '.m{a:b}', 'a scope written for another section id is replaced by this one');
lacks(out, 'data-rv-section="other"', 'no other section\'s scope survives');
has(out, S + ' .btn:hover,' + S + '.btn:hover,' + S + ' .btn:focus-visible,' + S + '.btn:focus-visible{a:b}', 'selector lists are scoped part by part');
has(out, S + ' .card:not(.is-off):nth-child(2n)::after,' + S + '.card:not(.is-off):nth-child(2n)::after{content:"x,y"}', 'pseudo-classes with arguments and strings with commas survive');
has(out, S + ' a[href^="http"]', 'attribute selectors survive');
has(out, S + ' *::selection,' + S + '::selection{color:red}', 'a bare pseudo-element means any element in the section, and the root');
ok(flat(out).split('}').filter(function (r) { return r && r.indexOf('{') !== -1; }).every(function (r) {
  return r.split('{')[0].split(',').every(function (sel) { return sel.indexOf('data-rv-section="hero"') !== -1; });
}), 'every selector of every rule carries the section scope', flat(out));

/* at-rules */
out = stable('@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}} .s{animation:spin 1s linear infinite} .t{animation-name:spin,fade} @-webkit-keyframes fade{0%{opacity:0}100%{opacity:1}}' +
  ' @font-face{font-family:"Brand Sans";src:url(https://x.example/b.woff2)} .u{font-family:"Brand Sans",Arial,sans-serif} .v{font:700 16px/1.2 "Brand Sans",serif}' +
  ' @supports (display:grid){.g{display:grid}} @media print{.p{display:none}}', 'hero', null, 'at-rules');
has(out, '@keyframes rv-hero-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}', '@keyframes is renamed and its steps are left alone');
has(out, 'animation:rv-hero-spin 1s linear infinite', 'animation shorthand follows the rename');
has(out, 'animation-name:rv-hero-spin,rv-hero-fade', 'animation-name follows the rename');
has(out, '@-webkit-keyframes rv-hero-fade', 'vendor keyframes are renamed');
lacks(out, 'rv-hero-rv-hero-', 'names are prefixed once');
has(out, '@font-face{font-family:"rv-hero-Brand Sans"', '@font-face family is renamed');
has(out, 'font-family:"rv-hero-Brand Sans", Arial, sans-serif', 'font-family follows the rename');
has(out, '"rv-hero-Brand Sans", serif', 'the font shorthand follows the rename');
has(out, '@supports (display:grid){' + S + ' .g,' + S + '.g{display:grid}}', '@supports contents are scoped');
has(out, '@media print{' + S + ' .p,' + S + '.p{display:none}}', '@media print contents are scoped');

/* the navigation is positioned above the sections after it and is not clipped */
out = stable('.nav{position:sticky;top:0}', 'nav', null, 'nav');
ok(flat(out).indexOf('[data-rv-section="nav"]{position:relative;z-index:50;isolation:isolate}') === 0, 'nav containment keeps it above later sections', flat(out).slice(0, 100));
has(out, '[data-rv-section="nav"] .nav,[data-rv-section="nav"].nav{position:sticky;top:0}', 'the section\'s own positioning rule follows and therefore wins');

/* odd input */
ok(scopeSectionCss('', 'hero') === CONTAIN, 'an empty sheet is just the containment rule');
ok(scopeSectionCss(null, 'hero') === CONTAIN && scopeSectionCss(undefined, 'hero') === CONTAIN, 'null / undefined do not throw');
ok(scopeSectionCss('.a{color:red}', '') === '' && scopeSectionCss('.a{color:red}', '"]{}') === '', 'no usable section id: nothing is returned');
out = scopeSectionCss('.a{color:red} .b{color:blue', 'hero');
has(out, S + ' .b,' + S + '.b{color:blue}', 'a sheet cut off inside a block is closed and scoped');
ok(scopeSectionCss('}}}} {{{{ ;;; <<<', 'hero').indexOf(flat(CONTAIN)) === 0, 'an unreadable sheet does not throw');
out = scopeSectionCss('.a{color:red}', 'my-section_2');
has(out, '[data-rv-section="my-section_2"] .a,[data-rv-section="my-section_2"].a{color:red}', 'ids with hyphens and underscores');
ok(sectionRootInfo('') === null && sectionRootInfo('just text') === null && sectionRootInfo(null) === null, 'sectionRootInfo: no element, no info');
ok(sectionRootInfo('<!-- c -->\n <SECTION CLASS="a  b">x</SECTION><div></div>').tag === 'section', 'sectionRootInfo: the first element, whatever comes before it');

/* ---- mobileSafeCss: a section held to a phone's width ---- */
var AV = '[data-rv-section="about"]';
var SHEET = AV + ' .wrap,' + AV + '.wrap{display:grid;grid-template-columns:2fr 1fr;gap:56px}' +
  AV + ' .card{width:420px;min-width:320px;flex:0 0 360px}' + AV + ' .icon{width:40px;flex:0 0 40px}' +
  '@media (max-width:820px){' + AV + ' .wrap{grid-template-columns:1fr}' + AV + ' .list{display:inline-grid}}' +
  AV + ' .row{display:flex;width:100%}@keyframes rv-about-x{from{width:600px}to{width:0}}';
var safe = mobileSafeCss(SHEET);
has(safe, AV + ' .card{width:min(420px, 100%);min-width:min(320px, 100%);flex:0 0 min(360px, 100%)}', 'a fixed width over 240px may not be wider than its place');
has(safe, AV + ' .icon{width:40px;flex:0 0 40px}', 'a small fixed width is left alone');
has(safe, ':where(' + AV + ' .wrap,' + AV + '.wrap) > *{min-width:0}', 'the cells of a grid may shrink below their widest word');
has(safe, '@media (max-width:820px){' + AV + ' .wrap{grid-template-columns:1fr}' + AV + ' .list{display:inline-grid}/* rv-grid-cells */:where(' + AV + ' .list) > *{min-width:0}}', 'a grid made inside @media gets its rule in that @media');
has(safe, 'from{width:600px}', 'keyframes are not touched');
lacks(safe, ':where(' + AV + ' .row)', 'a flex row is not a grid');
ok(mobileSafeCss(safe) === safe, 'mobileSafeCss is idempotent', flat(mobileSafeCss(safe)));
ok(mobileSafeCss('.a{color:red}') === '.a{color:red}', 'a sheet with nothing to change comes back byte for byte');
ok(mobileSafeCss('') === '' && mobileSafeCss(null) === '' && mobileSafeCss('}}} {{{ <<<') === '}}} {{{ <<<', 'empty and unreadable sheets come back as they were');
has(mobileSafeCss('.a::before{display:grid}.b{width:min(500px,100%)}'), '.a::before{display:grid}.b{width:min(500px,100%)}', 'a pseudo-element grid and a width already in min() are left alone');
lacks(mobileSafeCss('.a::before{display:grid}'), ':where(', 'no cell rule for a pseudo-element');
var NW = '[data-rv-section="p"] .note{white-space:nowrap;letter-spacing:.08em}[data-rv-section="p"] .row{display:flex;white-space:nowrap}' +
  '[data-rv-section="p"] .scroll{overflow-x:auto;white-space:nowrap}[data-rv-section="nav"] .links{white-space:nowrap}[data-rv-section="p"] .ell{white-space:nowrap;text-overflow:ellipsis}';
var nw = mobileSafeCss(NW);
has(nw, '/* rv-phone-wrap */@media (max-width:640px){[data-rv-section="p"] .note{white-space:normal}}', 'one-line text wraps on a phone');
ok(flat(nw).indexOf(flat(NW)) === 0, 'the section\'s own rules are kept as they were');
ok(mobileSafeCss(nw) === nw, 'the wrap rule is added once');
lacks(nw, '.row{white-space:normal', 'a flex row is spared');
lacks(nw, '.scroll{white-space:normal', 'a box that scrolls its own line is spared');
lacks(nw, '.links{white-space:normal', 'the top bar is spared');
lacks(nw, '.ell{white-space:normal', 'text cut with an ellipsis is spared');
/* out of the flow: a decorative glow keeps its shape */
var GLOW = AV + ' .glow{position:absolute;width:520px;height:520px;border-radius:50%}' + AV + ' .x::before{content:"";width:600px}' + AV + ' .bar{position:fixed;width:400px}';
ok(mobileSafeCss(GLOW) === GLOW, 'a box placed out of the flow keeps its width', mobileSafeCss(GLOW));
/* a sheet re-scoped after the AI was shown it (with or without the marks) still carries each added rule once */
var RS_HTML = '<section class="ov-root"><div class="ov-grid"></div></section>';
var RS = mobileSafeCss(scopeSectionCss('.ov-root{padding:10px}.ov-grid{display:grid;grid-template-columns:1fr 1fr}.ov-t{white-space:nowrap}.ov-c{width:400px}', 'ov', sectionRootInfo(RS_HTML)));
var rs = RS;
for (var rsi = 0; rsi < 3; rsi++) rs = mobileSafeCss(scopeSectionCss(rs, 'ov', sectionRootInfo(RS_HTML)));
ok(rs === RS, 're-scoped three times: the same sheet', flat(rs));
var unmarked = mobileSafeCss(scopeSectionCss(RS.replace(/\/\* rv-[a-z-]+ \*\//g, ''), 'ov', sectionRootInfo(RS_HTML)));
ok((unmarked.match(/min-width:0/g) || []).length === 1 && (unmarked.match(/white-space:normal/g) || []).length === 1, 'marks lost: each added rule still once', flat(unmarked));
/* a rule of the section's own that looks like one of these is kept when it is not made again */
var OWN = '.row{display:flex;white-space:nowrap}@media (max-width:640px){.row{white-space:normal}}:where(.row) > *{min-width:0}';
ok(mobileSafeCss(OWN) === OWN, 'the section\'s own phone rule and cell rule are kept', mobileSafeCss(OWN));

if (failures.length) {
  console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
  failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
  process.exit(1);
}
console.log('gen-markup: all ' + checks + ' checks passed');
