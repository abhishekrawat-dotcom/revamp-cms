// node functions/lib/editor-typing.test.js — the site editor, two launch-check items (13 Nov 2026):
//   ED-059  what Enter, a paste and a drop put into a text being typed in: a paste brings only its words, its line
//           breaks and (where the text can hold one) its links — not the fonts, sizes, colours and spans of Word or
//           Google Docs; Enter in a heading or a label ends the typing (Shift+Enter: a line break in a heading), and
//           is a line break (<br>, never a <div>) anywhere else; a drop puts nothing in.
//   ED-058  a real template's banner picture — an <img> under the banner's words (img.banner-bg-image,
//           data-rv-media="bg-image") that no click reaches — is changed from the banner's menu as its "Background
//           picture", with the same dialog AI-designed sites have, one step that Undo takes back, and keeps what makes
//           it load first.
// The paste rules live in one block of editor-template-ui.js, between the two "typingRules" marks, that uses nothing
// else of the editor; this runs that block, as it is, in node. The rest is read from the source. No browser, no network.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
var CANVAS = fs.readFileSync(path.join(ROOT, 'editor-canvas.js'), 'utf8');
var passed = 0, failed = 0;
function show(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + show(detail) : ''));
}
function body(name, src) {
  src = src || SRC;
  var i = src.indexOf('function ' + name + '(');
  if (i === -1) return '';
  var open = src.indexOf('{', i), depth = 0;
  for (var j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return '';
}
function noComments(s) { return s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''); }

/* ======================= ED-059: the paste rules, run on their own ======================= */
var BEGIN = '/* typingRules:begin */', END = '/* typingRules:end */';
var at = SRC.indexOf(BEGIN), to = SRC.indexOf(END);
check('0 the rules block is marked once', at !== -1 && to > at && SRC.indexOf(BEGIN, at + 1) === -1 && SRC.indexOf(END, to + 1) === -1, { at: at, to: to });
var BLOCK = SRC.slice(at, to);
var ctx = vm.createContext({});
vm.runInContext(BLOCK + '\nthis.pasteParts = pasteParts;', ctx, { filename: 'editor-template-ui.js#typingRules' });
var P = ctx.pasteParts;
check('0 the block defines pasteParts', typeof P === 'function');
check('0 the block names nothing of the editor or the page', !/(^|[^.\w$])(window|document|canvas|editingEl|selectedEl|host|showToast|commitNow)\b/.test(noComments(BLOCK)));
function J(v) { return JSON.stringify(v); }
function run(html, text, o) { return JSON.parse(JSON.stringify(P(html, text, o))); }

/* Google Docs: a <b> around everything, a <p> with inline styles per paragraph, <span>s with fonts and colours, a
   <br> between paragraphs for an empty line */
var GDOCS = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-12ab"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">' +
  '<span style="font-size:11pt;font-family:Arial;color:#ff0000;background-color:transparent;font-weight:700;">Hello</span><span style="font-size:11pt;font-family:Arial;"> world</span></p>' +
  '<br><p dir="ltr" style="line-height:1.38"><span style="font-size:14pt;font-family:Georgia;">Second &amp; last</span></p></b>';
check('1.1 Google Docs: its words and its empty line, nothing of its fonts, sizes, colours or spans',
  J(run(GDOCS, 'Hello world\n\nSecond & last')) === J([{ text: 'Hello world' }, { br: true }, { br: true }, { text: 'Second & last' }]), run(GDOCS, ''));
/* Word: conditional comments, a <style> block, <o:p>, class=MsoNormal paragraphs, the source wrapped over lines */
var WORD = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style><!-- p.MsoNormal{font-family:Calibri} --></style></head><body lang=EN-IN>' +
  '<!--StartFragment--><p class=MsoNormal><span style=\'font-size:14.0pt;color:#C00000\'>Line one is\r\nlong<o:p></o:p></span></p>\r\n' +
  '<p class=MsoNormal><![if !supportLists]><span>·</span><![endif]>Line&nbsp;two&#8217;s <b>bold</b><o:p></o:p></p><!--EndFragment--></body></html>';
check('1.2 Word: the fragment only, its words, one line each; no style block, no <o:p>, no conditional comments',
  J(run(WORD, '')) === J([{ text: 'Line one is long' }, { br: true }, { text: '·Line two’s bold' }]), run(WORD, ''));
check('1.3 plain text (no markup on the clipboard): lines kept, runs of spaces and tabs as one, at most one empty line',
  J(run('', '  First\tline  \r\n\r\n\r\n\nSecond line\n')) === J([{ text: 'First line' }, { br: true }, { br: true }, { text: 'Second line' }]), run('', '  First\tline  \r\n\r\n\r\n\nSecond line\n'));
check('1.4 a label (oneLine): its breaks are spaces, one run of words',
  J(run('<p>Register</p><p>now</p>', '', { oneLine: true })) === J([{ text: 'Register now' }]) &&
  J(run('', 'Book\nyour\n\nseat', { oneLine: true })) === J([{ text: 'Book your seat' }]), run('', 'Book\nyour\n\nseat', { oneLine: true }));
check('1.5 a heading (maxBreaks 1): a line break, never an empty line',
  J(run('<p>Decoding Opportunities</p><br><p>for Next Decade</p>', '', { maxBreaks: 1 })) === J([{ text: 'Decoding Opportunities' }, { br: true }, { text: 'for Next Decade' }]));
var LINKED = '<p>Read <a href="https://example.org/a?b=1&amp;c=2" style="color:blue">the report</a> or <a href="javascript:alert(1)">this</a>, mail <a href=mailto:team@example.org>us</a>.</p>';
check('1.6 links where links are allowed: web and mail addresses only (a javascript: one is its words)',
  J(run(LINKED, '', { links: true })) === J([{ text: 'Read ' }, { text: 'the report', href: 'https://example.org/a?b=1&c=2' }, { text: ' or this, mail ' }, { text: 'us', href: 'mailto:team@example.org' }, { text: '.' }]), run(LINKED, '', { links: true }));
check('1.7 …and where they are not, only their words', J(run(LINKED, '')) === J([{ text: 'Read the report or this, mail us.' }]), run(LINKED, ''));
check('1.8 a link address with spaces or quotes hidden in it is not a link', J(run('<a href="java\nscript:x">a</a> <a href="https://x.test/&quot;onmouseover=1">b</a>', '', { links: true })) === J([{ text: 'a b' }]),
  run('<a href="java\nscript:x">a</a> <a href="https://x.test/&quot;onmouseover=1">b</a>', '', { links: true }));
check('1.9 markup written as text stays text (decoded once, never parsed again)', J(run('<p>&lt;b&gt;bold&lt;/b&gt; &amp;amp; 5 &lt; 6</p>', '')) === J([{ text: '<b>bold</b> &amp; 5 < 6' }]), run('<p>&lt;b&gt;bold&lt;/b&gt; &amp;amp; 5 &lt; 6</p>', ''));
check('1.10 scripts, styles and pictures bring nothing', J(run('<script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)><svg><text>drawn</text></svg>Words', '')) === J([{ text: 'Words' }]));
check('1.11 the browser\'s own copy: a <br> that ends a block shows nothing; one alone in a block is an empty line',
  J(run('<div>One<br></div><div>Two</div><div><br></div><div>Three</div>', '')) === J([{ text: 'One' }, { br: true }, { text: 'Two' }, { br: true }, { br: true }, { text: 'Three' }]),
  run('<div>One<br></div><div>Two</div><div><br></div><div>Three</div>', ''));
check('1.12 a table: its cells apart, its rows on lines of their own', J(run('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>', '')) === J([{ text: 'A B' }, { br: true }, { text: 'C' }]),
  run('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>', ''));
check('1.13 nothing but space, nothing at all', J(run('<p> </p><br>', ' \n ')) === '[]' && J(run('', '')) === '[]');
check('1.14 entities: named, numeric and a character beyond the first plane', J(run('<p>&ldquo;Q&rdquo; &#x2014; &#128512; &mdash;&nbsp;x &unknown;</p>', '')) === J([{ text: '“Q” — 😀 — x &unknown;' }]),
  run('<p>&ldquo;Q&rdquo; &#x2014; &#128512; &mdash;&nbsp;x &unknown;</p>', ''));
check('1.15 a stray "<" in the words is kept', J(run('<p>a < b and <3</p>', '')) === J([{ text: 'a < b and <3' }]), run('<p>a < b and <3</p>', ''));

/* ======================= ED-059: the editor uses those rules ======================= */
var wire = body('wireCanvasEvents');
check('2.1 the canvas listens for Enter, input, paste and drop while a text is typed in (capture)',
  /addEventListener\('keydown', onTypingKey, true\)/.test(wire) && /addEventListener\('beforeinput', onTypingInput, true\)/.test(wire) &&
  /addEventListener\('paste', onTypingPaste, true\)/.test(wire) && /addEventListener\('drop', onTypingDrop, true\)/.test(wire));
var key = noComments(body('onTypingKey'));
check('2.2 Enter: never during an input method\'s composing; inside the text being typed only; the browser\'s own (a <div>) never',
  /e\.isComposing/.test(key) && /keyCode === 229/.test(key) && /editingAt\(e\)/.test(key) && /e\.preventDefault\(\)/.test(key));
check('2.3 …a label, or a heading without Shift, ends the typing; anything else is a line break',
  /if \(oneLineText\(el\) \|\| \(headingText\(el\) && !e\.shiftKey\)\) finishTyping\(el\);\s*else lineBreakAtCaret\(el\);/.test(key), key);
check('2.4 a heading is the text in h1–h6 (or role=heading); a label is a button or a link\'s',
  /h1, h2, h3, h4, h5, h6, \[role="heading"\]/.test(body('headingText')) && /data-editable'\) === 'button' \|\| !!el\.closest\('a, button'\)/.test(body('oneLineText')));
check('2.5 finishing keeps the text selected (exitEdit, not deselect) and gives the keyboard back to the page\'s stop',
  /exitEdit\(el\)/.test(body('finishTyping')) && !/deselect\(/.test(body('finishTyping')) && /canvasStop\(\)/.test(body('finishTyping')));
check('2.6 a line break is the browser\'s own <br> (insertLineBreak, never insertParagraph) where the caret is, else one put there and held open at the end of the text; recorded as typing',
  /execCommand\('insertLineBreak'\)/.test(body('lineBreakAtCaret')) && !/insertParagraph/.test(body('lineBreakAtCaret')) &&
  /createElement\('br'\)/.test(body('lineBreakAtCaret')) && /onCanvasInput\(\)/.test(body('lineBreakAtCaret')) &&
  /last\.nodeName === 'BR'/.test(body('putAtCaret')) && /el\.appendChild\(canvas\.doc\.createElement\('br'\)\)/.test(body('putAtCaret')));
var inp = noComments(body('onTypingInput'));
check('2.7 a phone keyboard\'s "new paragraph" follows the same rules; a drop or a paste as a quotation puts nothing in',
  /insertParagraph/.test(inp) && /insertFromDrop/.test(inp) && /insertFromPasteAsQuotation/.test(inp) && /finishTyping\(el\)/.test(inp) && /lineBreakAtCaret\(el\)/.test(inp));
var paste = noComments(body('onTypingPaste'));
check('2.8 a paste: the browser\'s own is stopped, and the clipboard\'s markup and words go through pasteParts',
  /e\.preventDefault\(\)/.test(paste) && /getData\('text\/html'\)/.test(paste) && /getData\('text\/plain'\)/.test(paste) && /pasteParts\(/.test(paste));
check('2.9 …links only where the text can hold one: canLink, a text (not a label), not inside a link already',
  /links: canLink\(el\) && el\.getAttribute\('data-editable'\) === 'text' && !el\.closest\('a, button'\) && !inLink/.test(paste) &&
  /oneLine: oneLineText\(el\)/.test(paste) && /maxBreaks: headingText\(el\) \? 1 : 2/.test(paste), paste);
check('2.10 …made of text nodes, <br> and <a href> only (never innerHTML), put at the caret, recorded as typing',
  /createTextNode\(p\.text\)/.test(paste) && /createElement\('br'\)/.test(paste) && /createElement\('a'\)/.test(paste) && /a\.textContent = p\.text/.test(paste) &&
  !/innerHTML|insertHTML|execCommand/.test(paste) && /putAtCaret\(el, nodes\)/.test(paste) && /onCanvasInput\(\)/.test(paste));
check('2.11 a drop into a text being typed in is stopped', /closest\('\[contenteditable="true"\]'\)\) e\.preventDefault\(\)/.test(body('onTypingDrop')));

/* ======================= ED-058: a real template's banner picture ======================= */
var bgImg = body('backgroundImg', CANVAS);
check('3.1 canvas.backgroundImg: the banner\'s <img data-rv-media="bg-image"> (or img.banner-bg-image), its own, not the editor\'s',
  /img\[data-rv-media="bg-image"\], img\.banner-bg-image/.test(bgImg) && /\[data-rv-editor\]/.test(bgImg) && /closest\('\[data-rv-section\]'\) === sec/.test(bgImg) &&
  /backgroundImg: backgroundImg,/.test(CANVAS));
/* run it over a small DOM: the banner's picture, one inside a nested section, and one the editor drew */
var mk = function (attrs, inSec, editor) {
  return { attrs: attrs, closest: function (sel) { if (sel === '[data-rv-editor]') return editor ? {} : null; if (sel === '[data-rv-section]') return inSec; return null; } };
};
var sec = { querySelectorAll: function () { return this.list; } };
var nested = {};
var own = mk({ class: 'banner-bg-image' }, sec, false);
var make = new Function(bgImg + '\nreturn backgroundImg;');
var BI = make();
sec.list = [mk({}, sec, true), mk({}, nested, false), own];
check('3.2 …the section\'s own picture is found, the editor\'s and a nested section\'s are not', BI(sec) === own);
sec.list = [];
check('3.3 …none: null, and a missing section is null', BI(sec) === null && BI(null) === null);
var tb = body('buildSecToolbar');
check('3.4 the banner\'s menu offers "Background picture" for that picture too', /canvas\.backgroundHost\(sec\) \|\| bannerImg\(sec\) \? '<button data-action="section-background"/.test(tb), tb.slice(0, 300));
var click = body('onSecToolbarClick');
check('3.5 …which opens the picture dialog for it (a CSS background still goes the way it went)',
  /action === 'section-background' && !canvas\.backgroundHost\(sec\) && bannerImg\(sec\)\) \{\s*replaceBannerPicture\(bannerImg\(sec\)\);/.test(click) &&
  /action === 'section-background'\) \{\s*var bgEl = canvas\.backgroundHost\(sec\);/.test(click));
var rb = noComments(body('replaceBannerPicture'));
check('3.6 the same dialog AI-designed sites have (upload or address), with the picture it shows now',
  /openPictureDialog\('Background picture', canvas\.pictureOf\(img\),/.test(rb));
check('3.7 one step with Undo: the picture set, the "replace manually" note gone, recorded, Undo offered; the dialog says nothing of its own',
  /canvas\.setPicture\(img, url\)/.test(rb) && /removeAttribute\('data-ai-media-skipped'\)/.test(rb) && /\.ai-media-skip-badge/.test(rb) &&
  /commitNow\(\)/.test(rb) && /offerUndo\('Banner picture replaced\.'\)/.test(rb) && /\}, false\);\s*\}$/.test(rb.trim()));
var sp = body('setPicture', CANVAS);
check('3.8 only its src changes: srcset and sizes go, so it is the one loaded; fetchpriority, loading and its class are not touched',
  /el\.setAttribute\('src', url\);\s*el\.removeAttribute\('srcset'\);\s*el\.removeAttribute\('sizes'\);/.test(sp) && !/fetchpriority|loading|className/.test(noComments(sp)));
var tpl = fs.readFileSync(path.join(ROOT, 'templates/tech500/sections/banner/index.html'), 'utf8');
check('3.9 the real templates\' banner picture is what canvas.backgroundImg finds, loaded first', ['tech500', 'retail-leadership-summit', 'cx-leaders-forum', 'making-ai-work'].every(function (id) {
  var h = fs.readFileSync(path.join(ROOT, 'templates', id, 'sections/banner/index.html'), 'utf8');
  return /<img [^>]*class="banner-bg-image" data-rv-media="bg-image" fetchpriority="high" loading="eager">/.test(h);
}) && tpl.length > 0);

console.log('editor-typing: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
