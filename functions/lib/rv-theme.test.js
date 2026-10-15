// node functions/lib/rv-theme.test.js — a generated site's themes (templates/_shared/rv-theme.js).
const T = require('../../templates/_shared/rv-theme.js');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

var dark = { mode: 'dark', themeColor: '#ed1c24', accentColor: '#ffb020', backgroundColor: '#0c0c10', surfaceColor: '#18181f', textColor: '#f4f4f6', mutedColor: '#a9a9b6', headingFont: 'Montserrat', bodyFont: 'Inter', cornerRadius: '6' };
var light = { mode: 'light', themeColor: '#0a3d91', accentColor: '#f5a623', backgroundColor: '#ffffff', headingFont: 'Inter', bodyFont: 'Inter' };
var td = T.themesFor(dark), tl = T.themesFor(light);
check('three themes: the design, its opposite mode, a third format', td.map(function (t) { return t.id; }).join() === 'original,light,editorial' && tl.map(function (t) { return t.id; }).join() === 'original,dark,brand');
check('the original is the design as it is', td[0].colours.bg === '#0c0c10' && td[0].colours.theme === '#ed1c24' && td[0].headingFont === 'Montserrat');
check('a theme is more than colour: type and corners change too', td[2].headingFont === 'Playfair Display' && td[2].radius === '0' && tl[2].radius === '4');
[td, tl, T.themesFor({ mode: 'light', themeColor: '#f5c518' }), T.themesFor({ mode: 'light', themeColor: '#111111' })].forEach(function (list, li) {
  list.forEach(function (t) {
    var c = t.colours;
    check('set ' + li + ' ' + t.id + ': text reads on the ground (7:1) and on the panels', T.contrast(c.text, c.bg) >= 7 && T.contrast(c.text, c.surface) >= 4.5, JSON.stringify(c));
    check('set ' + li + ' ' + t.id + ': quiet text reads (4.5:1)', T.contrast(c.muted, c.bg) >= 4.5, JSON.stringify(c));
    if (t.id !== 'original') check('set ' + li + ' ' + t.id + ': the brand colour stands out as a button (2.6:1)', T.contrast(c.theme, c.bg) >= 2.6, JSON.stringify(c));
  });
});
var v = T.varsOf(td[1]);
check('a theme is the page variables', v['--rv-bg'] === td[1].colours.bg && /Montserrat/.test(v['--heading-font-family']) && v['--rv-radius'] === '6px' && v['background-color'] === td[1].colours.bg);

var css = '.nav{background:rgba(12,12,16,.94);border-bottom:1px solid rgba(255,255,255,.08)}.btn{background:#ED1C24;color:#fff}.btn2{background:var(--theme-color);color:#ffffff}' +
  '.card{background:#18181f;color:#f4f4f6;box-shadow:0 10px 24px rgba(0,0,0,.4)}.q:hover{color:#a9a9b6}@media (max-width:820px){.y{color:#fff;border-color:#ed1c24}}.p{background:url("https://x/a.png") center/cover}.o{color:#00ff00}';
var out = T.themableCss(css, dark);
check('a fixed ground becomes its variable, with its transparency', /\.nav\{background:color-mix\(in srgb, var\(--rv-bg\) 94%, transparent\)/.test(out), out);
check('a faint line of the text colour stays faint and follows the text', /color-mix\(in srgb, var\(--rv-text\) 8%, transparent\)/.test(out));
check('the brand colour becomes the variable', /\.btn\{background:var\(--theme-color\)/.test(out));
check('white words on a brand button stay white', /\.btn\{[^}]*color:#fff\}/.test(out) && /\.btn2\{[^}]*color:#ffffff\}/.test(out));
check('panels and text become theirs', /\.card\{background:var\(--rv-surface\);color:var\(--rv-text\)/.test(out) && /\.q:hover\{color:var\(--rv-muted\)\}/.test(out));
check('shadows, pictures and colours outside the palette are left alone', /rgba\(0,0,0,\.4\)/.test(out) && /url\("https:\/\/x\/a\.png"\)/.test(out) && /\.o\{color:#00ff00\}/.test(out));
check('inside @media too', /@media \(max-width:820px\)\{\.y\{color:var\(--rv-text\);border-color:var\(--theme-color\)\}\}/.test(out), out);
check('converting twice changes nothing', T.themableCss(out, dark) === out);
check('fonts: a Google Fonts stylesheet', T.fontUrl('Playfair Display') === 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&display=swap' && T.fontUrl('<x>') === 'https://fonts.googleapis.com/css2?family=x:wght@400;500;600;700;800&display=swap');

check('a rule marked --rv-keep (a logo plate) keeps its colours', /\.plate\{--rv-keep:1;background:#ffffff\}/.test(T.themableCss('.plate{--rv-keep:1;background:#ffffff}', { colors: { bg: '#ffffff', surface: '#f4f4f4', text: '#111111', theme: '#e21b22' } })));
if (failed) { console.error('rv-theme: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('rv-theme: all ' + passed + ' checks passed');
