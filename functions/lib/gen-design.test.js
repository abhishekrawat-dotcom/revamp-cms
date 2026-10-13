/* node functions/lib/gen-design.test.js — exits 1 on the first failure it lists. No network, no Firebase. */
const g = require('./gen-design');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

/* ---- markupSkeleton ---- */
var page = '<html><head><style>.a{color:red}</style></head><body class="home"><script>var x = "<div>";</script>' +
  '<header class="site-header"><img alt="Logo" src="l.png"><nav><a href="#a">Speakers</a></nav></header>' +
  '<section class="hero full" style="background-image:url(h.jpg)"><h1>A very long headline that goes on and on for quite a while indeed</h1></section>' +
  '<section id="speakers" class="grid cols-4"><div class="card"><svg><path d="M0 0"/></svg><p>Jane</p></div></section></body></html>';
var sk = g.markupSkeleton(page);
ok(sk.indexOf('var x') === -1 && sk.indexOf('color:red') === -1, 'skeleton drops scripts and styles', sk);
ok(sk.indexOf('<section class="hero full" has-background-image>') !== -1, 'skeleton keeps classes and notes a background picture', sk);
ok(sk.indexOf('<section id="speakers" class="grid cols-4">') !== -1, 'skeleton keeps ids', sk);
ok(sk.indexOf('quite a while') === -1 && sk.indexOf('A very long headline') !== -1, 'skeleton cuts long text', sk);
ok(sk.indexOf('src=') === -1 && sk.indexOf('href=') === -1 && sk.indexOf('path') === -1, 'skeleton carries no addresses or svg paths', sk);
ok(g.markupSkeleton('<body>' + new Array(5000).join('<p class="x">text</p>') + '</body>', 2000).length <= 2000, 'skeleton is bounded');
ok(g.markupSkeleton('') === '', 'skeleton of nothing is nothing');

/* ---- fontFamilies ---- */
var fam = g.fontFamilies(['var(--font-display)', 'Inter', 'inter', 'sans-serif', '"Playfair Display"', 'Font Awesome 6 Free', '-apple-system', 'Montserrat']);
ok(fam.join('|') === 'Inter|Playfair Display|Montserrat', 'only real families, once each', fam.join('|'));

/* ---- pageTone ---- */
ok(g.pageTone('body{margin:0;background:#0b1020;color:#fff}', '') === 'dark', 'dark body background');
ok(g.pageTone('html,body{background-color:#fff}', '') === 'light', 'light body background');
ok(g.pageTone('.x{background:#000}', '<body style="background:#fafafa">') === 'light', 'background from the body tag');
ok(g.pageTone('.x{background:#000}', '<body>') === '', 'no declared page background -> unknown');
ok(g.pageTone('body{background:rgb(10, 12, 20)}', '') === 'dark', 'rgb() background');

/* ---- artDirectionFor ---- */
ok(g.artDirectionFor('etcio-awards-2027').id === g.artDirectionFor('etcio-awards-2027').id, 'art direction is fixed per event');
var seen = {};
['a-summit', 'b-awards', 'c-forum', 'd-conclave', 'e-expo', 'f-meet', 'g-week', 'h-day', 'i-live', 'j-con', 'k-fest', 'l-talks'].forEach(function (id) { seen[g.artDirectionFor(id).id] = 1; });
ok(Object.keys(seen).length >= 4, 'different events get different art directions', Object.keys(seen).join(','));

/* ---- palette ---- */
var dark = g.palette({ mode: 'light', backgroundColor: '#ffffff', textColor: '#111111' }, 'dark');
ok(dark.mode === 'dark' && g.luminance(dark.backgroundColor) < 0.2, 'asked for dark: the background is dark whatever the model said', JSON.stringify(dark));
ok(g.contrast(dark.textColor, dark.backgroundColor) >= 7, 'asked for dark: text is readable', JSON.stringify(dark));
var light = g.palette({ mode: 'dark', backgroundColor: '#0b1329', textColor: '#f0f0f0' }, 'light');
ok(light.mode === 'light' && g.luminance(light.backgroundColor) > 0.5, 'asked for light: the background is light', JSON.stringify(light));
ok(g.contrast(light.textColor, light.backgroundColor) >= 7, 'asked for light: text is readable');
var auto = g.palette({ mode: 'dark', backgroundColor: '#0b1329', surfaceColor: '#141d3a', textColor: '#f4f4f6', mutedColor: '#b7bdcc' }, 'auto');
ok(auto.mode === 'dark' && auto.backgroundColor === '#0b1329' && auto.surfaceColor === '#141d3a', 'auto keeps a sound design as designed', JSON.stringify(auto));
var weak = g.palette({ mode: 'light', backgroundColor: '#ffffff', textColor: '#bbbbbb', mutedColor: '#eeeeee' }, 'auto');
ok(g.contrast(weak.textColor, weak.backgroundColor) >= 7 && g.contrast(weak.mutedColor, weak.backgroundColor) >= 4.5, 'unreadable text colours are replaced', JSON.stringify(weak));
var old = g.palette({ themeColor: '#0b2239' }, 'auto');
ok(old.mode === 'light' && old.backgroundColor === '#ffffff', 'a design with no page colours is a light page', JSON.stringify(old));
ok(g.normaliseMode('DARK') === 'dark' && g.normaliseMode('x') === 'auto' && g.normaliseMode() === 'auto', 'normaliseMode');

/* ---- clampFontSizes ---- */
var css = '.a{font-size:11px}.b{font-size: 0.75rem;color:red}.c{font-size:18px}.d{font-size:clamp(0.7rem, 2vw, 1rem)}.e{font-size:.8em}.f{font-size:12px!important}.g{font-size:clamp(2rem,4vw,3rem)}';
var out = g.clampFontSizes(css);
ok(out.indexOf('.a{font-size:14px}') !== -1, '11px -> 14px', out);
ok(out.indexOf('.b{font-size: 0.875rem;color:red}') !== -1, '0.75rem -> 0.875rem', out);
ok(out.indexOf('.c{font-size:18px}') !== -1, '18px untouched', out);
ok(out.indexOf('.d{font-size:clamp(0.875rem, 2vw, 1rem)}') !== -1, 'the minimum of a clamp is raised', out);
ok(out.indexOf('.e{font-size:.8em}') !== -1, 'em left alone', out);
ok(out.indexOf('.f{font-size:14px!important}') !== -1, '!important kept', out);
ok(out.indexOf('.g{font-size:clamp(2rem,4vw,3rem)}') !== -1, 'a large clamp untouched', out);
ok(g.clampFontSizes('') === '' && g.clampFontSizes(null) === '', 'empty css');

/* ---- ensureLogo ---- */
var URL_ = 'https://storage.googleapis.com/b/events/x/logo/l.png';
var nav = '<nav id="nav" class="nav"><div class="nav-inner"><span class="brand">My Event</span><a href="#a">A</a></div></nav>';
var withLogo = g.ensureLogo(nav, URL_, 'My "Event"');
ok(withLogo.indexOf('<div class="nav-inner"><a href="#top" data-rv-logo-link><img data-rv-logo') !== -1, 'a missing logo goes first inside the bar', withLogo);
ok(withLogo.indexOf('alt="My &quot;Event&quot;"') !== -1, 'the name is escaped', withLogo);
var has = '<nav><a href="#hero"><img class="l" src="' + URL_ + '" alt=""></a></nav>';
var kept = g.ensureLogo(has, URL_, 'E');
ok((kept.match(/<img/g) || []).length === 1 && kept.indexOf('<img data-rv-logo class="l"') !== -1, 'a logo already there is kept, and marked', kept);
ok(g.ensureLogo(nav, '', 'E') === nav, 'no logo, no change');

/* ---- imagePrompt ---- */
var ip = g.imagePrompt('server halls', { mode: 'dark', themeColor: '#123456', accentColor: '#abcdef', imageStyle: 'long exposure' }, { hero: true });
ok(/never a clear, recognisable face/.test(ip) && /No readable text/.test(ip) && /16:9/.test(ip) && /Scene: server halls/.test(ip) && /long exposure/.test(ip), 'image prompt carries the scene, the style and the rules', ip);
ok(!/no people/i.test(ip) && /anonymously/.test(ip), 'people may be shown, never as anyone in particular', ip);
var ipAbout = g.imagePrompt('a panel on stage', {}, { about: 'MarTech Summit 2027, marketing technology, Gurugram' });
ok(/The event: MarTech Summit 2027, marketing technology, Gurugram\./.test(ipAbout) && /4:3/.test(ipAbout), 'a picture is told which event it belongs to', ipAbout);

/* ---- the logo unit as one picture ---- */
var lu = g.logoUnitImageHtml({ url: 'https://storage.googleapis.com/b/events/e/generated/1-logo-unit.svg', alt: 'A & B "Summit" 2027', width: 404.4, height: 308, mode: 'dark' });
ok(/^<div class="rv-lu rv-lu-pic rv-lu-on-dark" data-rv-logo-unit><img class="rv-lu-img" src="https:\/\/storage[^"]+\.svg" alt="A &amp; B &quot;Summit&quot; 2027" width="404" height="308" decoding="async"><\/div>$/.test(lu), 'the unit is one picture, sized, with the name as its alt text', lu);
ok(g.logoUnitImageHtml({ url: '' }) === '' && g.logoUnitImageHtml({}) === '' && g.logoUnitImageHtml() === '', 'no picture, no unit: the caller sets it in type');
ok(g.logoUnitImageHtml({ url: 'javascript:alert(1)' }) === '' && g.logoUnitImageHtml({ url: 'http://x.example/a.png' }) === '' && g.logoUnitImageHtml({ url: '/templates/x.svg' }) === '', 'only an https address is a picture');
var noted = g.logoUnitImageHtml({ url: 'https://x.example/u.png', mode: 'light', plate: 'dark', note: 'It still shows 2026 "as drawn" <b>' });
ok(noted.indexOf('data-rv-logo-note="It still shows 2026 &quot;as drawn&quot; &lt;b&gt;"') !== -1 && noted.indexOf('<span class="rv-lu-plate rv-lu-plate-dark"><img') !== -1 && noted.indexOf('rv-lu-on-light') !== -1 && !/width=/.test(noted), 'the note travels on the unit, escaped; a plate when asked; no size when none is known', noted);
ok(g.logoUnitImageHtml({ url: 'https://x.example/u.png', plate: 'purple' }).indexOf('rv-lu-plate') === -1, 'an unknown plate is no plate');

if (failures.length) {
  console.log(failures.length + ' of ' + checks + ' checks FAILED:\n\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('gen-design: all ' + checks + ' checks passed');
