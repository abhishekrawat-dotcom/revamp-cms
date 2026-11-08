/* node functions/lib/readable-text.test.js — UX-004 (batch B02): readable text in light and dark.
     - every page family's colour tokens (each token block of each page and shared stylesheet) give 4.5:1 or more
       for text: the faint and muted text on every surface of their theme, each status colour on its own tint,
       and the words on a filled button (white on ET red, dark words on the dark theme's light red and green);
     - nothing under 11px in the CMS's own styles, the console's miniatures of the site (Live preview, Social preview)
       included: they are words a person reads (a template's own section styles in the editor's page are the site's
       design; the platform's copied studio stylesheet is raised after it, in promo-studio/oneworld.css);
     - no text faded with opacity below its colour's 4.5:1 (the sub-tab counts, the miniatures' small capitals);
     - the avatar colours behind white initials are readable.
   The browser re-measure (every page, both themes) is ~/.revamp-cms-qa/ux-final/work-b02-a/contrast.js.
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

function rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
function lum(h) { return rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0); }
function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
check('the ratio is WCAG\'s', Math.abs(ratio('#FFFFFF', '#000000') - 21) < 0.01 && Math.abs(ratio('#A0908C', '#FFFFFF') - 3.06) < 0.01);

/* the console's surfaces, the ones every family shares (edit-event.css) */
var SURFACES = { light: ['#FFFFFF', '#FAF7F6', '#F3EEED', '#E9E2E0'], dark: ['#201C1B', '#171514', '#2A2422', '#352D2B'] };

/* every block of custom properties in a file: { tokens: { name: '#hex' }, at } */
function blocks(text) {
  var out = [], re = /\{([^{}]*)\}/g, m;
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  while ((m = re.exec(text))) {
    var t = {}, d = /--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})\b/g, x, n = 0;
    while ((x = d.exec(m[1]))) { t[x[1]] = x[2].toUpperCase(); n++; }
    if (n >= 2) out.push({ tokens: t, at: text.slice(0, m.index).split('\n').length });
  }
  return out;
}
function themeOf(t) {
  var ground = t.surface || t.bg || t['rvc-surface'];
  if (ground) return lum(ground) > 0.4 ? 'light' : 'dark';
  var txt = t['text-muted'] || t.muted || t['text-faint'] || t.soft || t['rvc-text-muted'];
  return txt && lum(txt) > 0.2 ? 'dark' : 'light';
}

var FILES = ['edit-event.css', 'create-event.html', 'custom_editor.html', 'index.html', 'Event_Listing.html', 'activity-log.html', 'ai-report.html',
  'mailer-performance.html', 'import-figma-design/index.html', 'review.html', 'etb2b-chat.css', 'promo-studio/oneworld.css'];
var TEXT_TOKENS = ['text-faint', 'text-muted', 'muted', 'rvc-text-faint', 'rvc-text-muted', 'faint', 'soft'];
var PAIRS = [['ok', 'ok-soft'], ['warn', 'warn-soft'], ['info', 'info-soft'], ['review', 'review-soft'], ['crit', 'crit-soft'], ['bad', 'bad-soft'],
  ['draft', 'draft-soft'], ['tag-teal', 'tag-teal-soft'], ['tag-amber', 'tag-amber-soft'], ['tag-blue', 'tag-blue-soft'], ['tag-violet', 'tag-violet-soft'],
  ['tag-cyan', 'tag-cyan-soft'], ['tag-rose', 'tag-rose-soft'], ['accent-strong', 'accent-soft']];
var low = [], seen = 0;
FILES.forEach(function (f) {
  blocks(read(f)).forEach(function (b) {
    var t = b.tokens, theme = themeOf(t), grounds = SURFACES[theme].slice();
    ['surface', 'surface-2', 'surface-3', 'bg'].forEach(function (k) { if (t[k] && grounds.indexOf(t[k]) === -1) grounds.push(t[k]); });
    TEXT_TOKENS.forEach(function (k) {
      if (!t[k]) return;
      seen++;
      grounds.forEach(function (g) { var r = ratio(t[k], g); if (r < 4.5) low.push(f + ':' + b.at + ' ' + theme + ' --' + k + ' ' + t[k] + ' on ' + g + ' = ' + r.toFixed(2)); });
    });
    PAIRS.forEach(function (p) {
      if (!t[p[0]] || !t[p[1]]) return;
      seen++;
      var r = ratio(t[p[0]], t[p[1]]);
      if (r < 4.5) low.push(f + ':' + b.at + ' ' + theme + ' --' + p[0] + ' ' + t[p[0]] + ' on --' + p[1] + ' ' + t[p[1]] + ' = ' + r.toFixed(2));
    });
    /* a filled button: its words (accent-contrast) on its fill (accent) */
    if (t.accent) {
      seen++;
      var on = t['accent-contrast'] || t['accent-ink'] || '#FFFFFF', r2 = ratio(on, t.accent);
      if (r2 < 4.5) low.push(f + ':' + b.at + ' ' + theme + ' words ' + on + ' on --accent ' + t.accent + ' = ' + r2.toFixed(2));
    }
  });
});
check('the sweep read the token blocks of every family', seen > 100, seen);
check('every text colour token, status colour and button fill reads at 4.5:1 or more, in light and dark', !low.length, low);

/* white on ET red: the light themes' filled buttons */
check('the light themes\' ET red fill is #D3141B (white on it 5.4:1; #ED1C24 was 4.38:1)', /--accent:\s*#D3141B;/.test(read('edit-event.css')) &&
  Math.abs(ratio('#FFFFFF', '#D3141B') - 5.4) < 0.05);
var RV = read('review.html');
check('the review page\'s Approve: white on the light green, dark words on the dark theme\'s', /\.btn\.primary\{ background:var\(--ok\); border-color:var\(--ok\); color:var\(--on-ok\); \}/.test(RV) &&
  /--on-ok:#fff;/.test(RV) && /--on-ok:#10251A;/.test(RV) && ratio('#10251A', '#4FAE7A') >= 4.5 && ratio('#FFFFFF', '#1F6E43') >= 4.5);
check('the editor\'s danger button follows the theme\'s words on red', /\.btn\.btn-danger\{ background: var\(--crit\); border-color: var\(--crit\); color: var\(--accent-contrast\); \}/.test(read('custom_editor.html')));
var AV = /var AV\s*=\s*\[([^\]]+)\]/.exec(read('edit-event-core.js'))[1].match(/#[0-9A-Fa-f]{6}/g);
check('white initials on every avatar colour at 4.5:1 or more', AV.length === 8 && AV.every(function (c) { return ratio('#FFFFFF', c) >= 4.5; }), AV.map(function (c) { return c + ' ' + ratio('#FFFFFF', c).toFixed(2); }));

/* ---------- nothing under 11px ---------- */
var listed = require('child_process').execFileSync('git', ['ls-files', '*.html', '*.css', '*.js'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
var SKIP = /^(templates\/|payment\/|functions\/|promo-engine\/|template-previews\/|lovable-scraper-service\/|tools\/|assets\/vendor\/|promo-studio\/(mailer|social)-studio\.)|\.test\.js$/;
/* a template's own section styles in the editor's page are the site's design. The console's miniatures (.mock-*) are
   not exempt: a person reads them as they do the rest (Create Event's old .prev-* miniature styled no markup and is
   gone) */
var EXEMPT = /\.s-discussion-points|\.track-card|\.editorial-topic/;
var tiny = [];
listed.filter(function (f) { return !SKIP.test(f); }).forEach(function (f) {
  read(f).split('\n').forEach(function (line, i) {
    if (EXEMPT.test(line)) return;
    var m = /font-size\s*:\s*((?:[0-9]|10)(?:\.[0-9]+)?)px/.exec(line);
    if (m) tiny.push(f + ':' + (i + 1) + ' ' + m[1] + 'px');
  });
});
check('no text under 11px in the CMS\'s own styles', !tiny.length, tiny);
check('the sweep reads the console\'s miniatures too (the old 9.5px Live preview line would be caught)',
  !EXEMPT.test('.mock-hero .mp{ font-size:9.5px; }') && listed.indexOf('edit-event.css') !== -1 && !SKIP.test('edit-event.css'));

/* ---------- text faded below its colour's contrast ----------
   opacity multiplies into the colour: the sub-tab counts' .7 made --text-muted 3.25:1 in light, 4.29:1 in dark and
   3.91:1 on the open tab's red; the miniatures' .88 made white on red 4.41:1 */
var EE = read('edit-event.css').replace(/\/\*[\s\S]*?\*\//g, '');
function ruleOf(css, sel) { var i = css.indexOf(sel + '{'); return i === -1 ? null : css.slice(i, css.indexOf('}', i) + 1); }
var faded = ['.subtabs .cnt', '.mock-hero .mp', '.mock-og .img .mp', '.mock-og .img .md'].filter(function (sel) {
  var r = ruleOf(EE, sel); return !r || /opacity\s*:/.test(r) || !/font-size:11px/.test(r);
});
check('the sub-tab counts and the miniatures\' small words are at full strength, 11px or more', !faded.length, faded);
check('white on the miniatures\' red reaches 4.5:1 at its lightest stop', ratio('#FFFFFF', '#D3141B') >= 4.5 &&
  /\.mock-hero\{[^}]*linear-gradient\(135deg, #D3141B 0%, #B3151B 100%\)/.test(EE) && /\.mock-og \.img\{[^}]*linear-gradient\(140deg, #D3141B 0%, #B3151B 68%, #5E0A0E 100%\)/.test(EE));
var studioCss = read('promo-studio/mailer-studio.css').replace(/\/\*[\s\S]*?\*\//g, ''), ow = read('promo-studio/oneworld.css');
var lifted = ow.slice(ow.indexOf('READABLE TEXT (UX-004)'));
var small = [], r3 = /([^{}]+)\{([^{}]*)\}/g, b3;
while ((b3 = r3.exec(studioCss))) if (/font-size\s*:\s*(?:[0-9]|10)(?:\.[0-9]+)?px/.test(b3[2])) small.push(b3[1].trim());
var missing = small.filter(function (s) { return lifted.indexOf(s + ',') === -1 && lifted.indexOf(s + '{') === -1; });
check('every size under 11px in the platform\'s studio stylesheet is raised to 11px after it (oneworld.css)', small.length > 20 && !missing.length && /\{font-size:11px\}/.test(lifted), missing);
check('the studio page loads oneworld.css after the platform\'s stylesheet', (function () {
  var p = read('promo-mailer-studio.html'); return p.indexOf('promo-studio/mailer-studio.css') !== -1 && p.indexOf('promo-studio/mailer-studio.css') < p.indexOf('promo-studio/oneworld.css');
})());

console.log('readable-text: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
