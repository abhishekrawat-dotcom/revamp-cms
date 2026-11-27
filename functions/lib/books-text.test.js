// node functions/lib/books-text.test.js — Books Phase 3 (27 Nov 2026): text measured with the real font
// (books-app/src/engines/textEngine.ts on textMeasure.ts). textEngine.ts is bundled with esbuild (books-app's own) into
// memory and run here with a fake monospace measure injected through setMeasure, so every width is known:
// a character is (size ÷ 10) mm wide — 1 mm at 10 pt — and a capital half as wide again.
// Checks: wrapping at spaces (and after a hyphen, around an em dash, as Chrome wraps), columns (and a 0 gap drawn as 5 mm), insets, the paragraph gap (never closer than an
// empty line), line breaks, capitals measured as capitals, letter spacing, a word wider than its column,
// overflowWords, fitTextToFrame's split (word, sentence and paragraph ends; nothing lost), frameCapacityWords, the
// continuation split, the Designer's fixes (shrink, tighten, taller), what the canvas draws for paragraphs, and that
// layouts are remembered (an unchanged book is not measured again) and dropped when the measure changes (a font load).
// No browser, no network.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '') + '\n'); }
var ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'books-app'), ENGINES = path.join(APP, 'src', 'engines');

/* ---------- textEngine.ts, bundled and loaded ---------- */
var esbuild = require(path.join(APP, 'node_modules', 'esbuild'));
var built = esbuild.buildSync({
  stdin: {
    contents: "export * from './textEngine';\nexport { setMeasure, getMeasure, measureGeneration, estimateMeasure, cssFont, useFontsVersion, PT_TO_MM } from './textMeasure';\n",
    resolveDir: ENGINES, sourcefile: 'books-text-entry.ts', loader: 'ts'
  },
  bundle: true, write: false, format: 'cjs', platform: 'neutral', target: 'es2020', external: ['react'], logLevel: 'silent'
});
var mod = { exports: {} };
var REACT = { useSyncExternalStore: function (sub, get) { return get(); } };
vm.runInNewContext(built.outputFiles[0].text, {
  module: mod, exports: mod.exports, require: function (n) { if (n === 'react') return REACT; throw new Error('unexpected require ' + n); },
  setTimeout: setTimeout, clearTimeout: clearTimeout, console: console
}, { filename: 'textEngine.bundle.js' });
var T = mod.exports;
check('0.1 textEngine bundles and loads, with every name the editor and Agent 2 use', ['measureTextOverflow', 'piecesOf', 'splitOverflowTextForContinuation', 'fitTextToFrame', 'frameCapacityWords',
  'computeEditorialAnalytics', 'countWords', 'shrinkTextToFit', 'tightenSpacingToFit', 'growFrameToFit', 'minimumSizePt', 'paragraphsForDrawing', 'paragraphExtraMm',
  'fitTextWithinApprovedLimits', 'tightenParagraphSpacing', 'expandFrameHeightForText', 'setMeasure', 'getMeasure', 'useFontsVersion'].every(function (n) { return typeof T[n] === 'function'; }),
  Object.keys(T));

/* ---------- the fake measure ---------- */
var PT_TO_MM = 25.4 / 72, CALLS = 0;
function mono(text, font) {
  CALLS++;
  var w = 0;
  for (var ch of text) w += (ch >= 'A' && ch <= 'Z') ? 1.5 : 1;
  var n = Array.from(text).length;
  return w * font.sizePt / 10 + (font.letterSpacingEm || 0) * font.sizePt * PT_TO_MM * n;
}
T.setMeasure(mono);
var LH5 = 5 / (10 * PT_TO_MM); // the leading that makes a 10 pt line 5 mm
function style(o) {
  return Object.assign({ fontFamily: 'Mono', fontSizePt: 10, fontWeight: 400, fontStyle: 'normal', color: '#000000', lineHeight: LH5, letterSpacingEm: 0,
    textAlign: 'left', verticalAlign: 'top', paragraphSpacingMm: 0, columns: 1, columnGapMm: 0, insetMm: 0, textTransform: 'none' }, o || {});
}
var N = 0;
function frame(text, w, h, st, extra) {
  return Object.assign({ id: 'f' + (++N), name: 'Body', type: 'text', xMm: 10, yMm: 10, widthMm: w, heightMm: h, rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 1,
    text: text, textStyle: style(st) }, extra || {});
}
function words(n, len) { var out = []; for (var i = 0; i < n; i++) out.push(String.fromCharCode(97 + (i % 26)).repeat(len || 4)); return out.join(' '); }
function ov(el) { return T.measureTextOverflow(el); }

/* ---------- 1 wrapping ---------- */
var five = 'aaaa bbbb cccc dddd eeee'; // 24 characters: 19 on the first line, the fifth word on the second
check('1.1 words wrap at the column width: two lines in a 20 mm frame', ov(frame(five, 20, 15)).estimatedLines === 2 && !ov(frame(five, 20, 15)).isOverflowing, ov(frame(five, 20, 15)));
var oneLine = ov(frame(five, 20, 5));
check('1.2 …a one-line frame: the fifth word does not fit (+1)', oneLine.isOverflowing && oneLine.overflowWords === 1 && oneLine.maxLines === 1, oneLine);
check('1.3 a line exactly as wide as the frame wraps (measured on the safe side); a character less stays',
  ov(frame('aaaaaaaaa bbbbbbbbbb', 20, 5)).isOverflowing && !ov(frame('aaaaaaaa bbbbbbbbbb', 20, 5)).isOverflowing);
check('1.4 overflowWords counts every word that does not fit: 10 words, 4 on the one line, 6 over', ov(frame(words(10), 20, 5)).overflowWords === 6, ov(frame(words(10), 20, 5)));
check('1.5 spaces are kept as typed (two spaces are two)', ov(frame('aaaaaaaaa  bbbbbbbbb', 20, 5)).isOverflowing && !ov(frame('aaaaaaaaa bbbbbbbbb', 20, 5)).isOverflowing);
var wide = ov(frame('abcdefghijklmnopqrstuvwxyz', 20, 15));
check('1.6 a word wider than its column is cut off at the edge: it does not fit', wide.isOverflowing && wide.overflowWords === 1, wide);
check('1.8 a line may also break after a hyphen inside a word, as the canvas does (two lines, not three)', ov(frame('ccccccccccccc aaaa-bbbbbbbbbbbbbb dddd', 20, 15)).estimatedLines === 2 &&
  !ov(frame('ccccccccccccc aaaa-bbbbbbbbbbbbbb dddd', 20, 15)).isOverflowing, ov(frame('ccccccccccccc aaaa-bbbbbbbbbbbbbb dddd', 20, 15)));
check('1.9 …and before or after an em dash, so a long dashed pair is not cut off', !ov(frame('cccccccccc dddd\u2014eeeeeeeeeeeeeeeee', 20, 15)).isOverflowing &&
  ov(frame('cccccccccc dddd\u2014eeeeeeeeeeeeeeeee', 20, 15)).estimatedLines === 2);
check('1.10 where a word may break: after "well-", around an em dash; never in "2019-2020", "-5", "co--op" or a run of dashes',
  JSON.stringify(T.piecesOf('well-known')) === '["well-","known"]' && JSON.stringify(T.piecesOf('proportion\u2014leaving')) === '["proportion","\u2014","leaving"]' &&
  JSON.stringify(T.piecesOf('2019-2020')) === '["2019-2020"]' && JSON.stringify(T.piecesOf('-5')) === '["-5"]' && JSON.stringify(T.piecesOf('co--op')) === '["co--op"]' &&
  JSON.stringify(T.piecesOf('a\u2014\u2014b')) === '["a","\u2014\u2014","b"]' && JSON.stringify(T.piecesOf('1990\u20132000')) === '["1990\u20132000"]' && JSON.stringify(T.piecesOf('plain')) === '["plain"]');
var hy = T.fitTextToFrame(frame('', 20, 5), 'ccccccccccccc aaaa-bbbbbbbbbbbbbb dddd');
check('1.11 …but text is only ever split for the next frame at a space: a word broken at its hyphen moves on whole', hy.fittingText === 'ccccccccccccc' && hy.rest === 'aaaa-bbbbbbbbbbbbbb dddd', hy);
check('1.7 no words, or no style: nothing overflows', !ov(frame('   ', 20, 5)).isOverflowing && !ov(Object.assign(frame('x y z', 20, 5), { textStyle: undefined })).isOverflowing);

/* ---------- 2 columns and insets ---------- */
var two = words(10); // 4 words a line: three lines
check('2.1 two columns of 20 mm (45 wide, 5 mm gap) hold two one-line columns', !ov(frame(words(8), 45, 5, { columns: 2, columnGapMm: 5 })).isOverflowing &&
  ov(frame(two, 45, 5, { columns: 2, columnGapMm: 5 })).overflowWords === 2, ov(frame(two, 45, 5, { columns: 2, columnGapMm: 5 })));
check('2.2 …a column gap of 0 is drawn as 5 mm, and measured so', ov(frame(two, 45, 5, { columns: 2, columnGapMm: 0 })).overflowWords === 2 &&
  ov(frame(two, 40, 5, { columns: 2, columnGapMm: 0 })).overflowWords > 2);
check('2.3 maxLines is lines per column × columns', ov(frame(two, 45, 10, { columns: 2, columnGapMm: 5 })).maxLines === 4);
check('2.4 the inset comes off every side: 24 × 19 with 2 mm insets is 20 × 15', JSON.stringify(ov(frame(words(14), 24, 19, { insetMm: 2 }))) === JSON.stringify(ov(frame(words(14), 20, 15))) &&
  ov(frame(words(14), 24, 19, { insetMm: 2 })).overflowWords === 2, ov(frame(words(14), 24, 19, { insetMm: 2 })));

/* ---------- 3 paragraphs and line breaks ---------- */
var paras = 'aaaa\n\nbbbb';
check('3.1 a new paragraph is an empty line: three lines', ov(frame(paras, 20, 15)).estimatedLines === 3 && !ov(frame(paras, 20, 15)).isOverflowing, ov(frame(paras, 20, 15)));
check('3.2 a paragraph gap smaller than a line changes nothing (paragraphs are an empty line apart)', !ov(frame(paras, 20, 15, { paragraphSpacingMm: 4 })).isOverflowing &&
  T.paragraphExtraMm(style({ paragraphSpacingMm: 4 })) === 0);
var gap7 = ov(frame(paras, 20, 15, { paragraphSpacingMm: 7 }));
check('3.3 a gap of 7 mm adds 2 mm beyond the empty line: the second paragraph no longer fits', gap7.isOverflowing && gap7.overflowWords === 1 && Math.abs(T.paragraphExtraMm(style({ paragraphSpacingMm: 7 })) - 2) < 1e-9, gap7);
check('3.4 …and with room for it, it fits', !ov(frame(paras, 20, 17.5, { paragraphSpacingMm: 7 })).isOverflowing);
var breaks = ov(frame('a\nb\nc\nd', 20, 15));
check('3.5 each return is a line: four lines, the fourth does not fit', breaks.estimatedLines === 4 && breaks.isOverflowing && breaks.overflowWords === 1, breaks);
check('3.6 empty lines before the first words are drawn, so they count', ov(frame('\n\n\na', 20, 15)).isOverflowing && !ov(frame('\n\na', 20, 15)).isOverflowing);
check('3.7 two returns with spaces between are still one empty line', ov(frame('aaaa\n   \nbbbb', 20, 15)).estimatedLines === 3);
check('3.8 the canvas draws the paragraphs it measures: blocks keep their empty lines, the leading ones stay with the first',
  JSON.stringify(T.paragraphsForDrawing('a\n\nb\n\n\nc')) === JSON.stringify(['a', '\nb', '\n\nc']) &&
  JSON.stringify(T.paragraphsForDrawing('\n\na\n\nb')) === JSON.stringify(['\n\na', '\nb']) &&
  JSON.stringify(T.paragraphsForDrawing('a\n\n')) === JSON.stringify(['a']) && JSON.stringify(T.paragraphsForDrawing('a\nb')) === JSON.stringify(['a\nb']),
  [T.paragraphsForDrawing('a\n\nb\n\n\nc'), T.paragraphsForDrawing('\n\na\n\nb')]);

/* ---------- 4 capitals and letter spacing ---------- */
var caps = 'abcdefg abcdefg'; // 15 mm; in capitals 22 mm
check('4.1 capitals are measured as capitals (text-transform: uppercase)', !ov(frame(caps, 20, 5)).isOverflowing && ov(frame(caps, 20, 5, { textTransform: 'uppercase' })).overflowWords === 1);
check('4.2 lowercase and Capitalised are measured as drawn', !ov(frame('ABCDEFG ABCDEFG', 20, 5, { textTransform: 'lowercase' })).isOverflowing &&
  ov(frame('ABCDEFG ABCDEFG', 20, 5)).isOverflowing && !ov(frame('abcdefg abcdefg', 20, 5, { textTransform: 'capitalize' })).isOverflowing);
check('4.3 letter spacing widens every character: 0.1 em pushes a 19-character line over', !ov(frame('aaaa bbbb cccc dddd', 20, 5)).isOverflowing &&
  ov(frame('aaaa bbbb cccc dddd', 20, 5, { letterSpacingEm: 0.1 })).isOverflowing);
check('4.4 the font sent to the measure is the frame\'s (family, size, weight, italic, letter spacing)', (function () {
  var seen = null; T.setMeasure(function (t, f) { seen = f; return mono(t, f); });
  ov(frame('Quiet words', 30, 9, { fontFamily: 'Lora', fontSizePt: 11.5, fontWeight: 600, fontStyle: 'italic', letterSpacingEm: 0.02 }));
  T.setMeasure(mono);
  return seen && seen.family === 'Lora' && seen.sizePt === 11.5 && seen.weight === 600 && seen.italic === true && seen.letterSpacingEm === 0.02;
})());
check('4.5 the browser measure draws with the canvas\'s CSS font', T.cssFont({ family: 'Playfair Display', weight: 700, italic: true }, 64) === 'italic 700 64px "Playfair Display", serif' &&
  T.cssFont({ family: 'Bad"Name', weight: 400, italic: false }, 64) === '400 64px "BadName", serif');

/* ---------- 5 fitTextToFrame ---------- */
function joins(fit, text) {
  if (fit.rest === '') return fit.fittingText === text;
  var between = text.slice(fit.fittingText.length, text.length - fit.rest.length);
  return text.indexOf(fit.fittingText) === 0 && text.slice(text.length - fit.rest.length) === fit.rest && (fit.fittingText ? /^\s+$/ : /^\s*$/).test(between);
}
var ten = words(10), f5 = T.fitTextToFrame(frame('', 20, 5), ten);
check('5.1 at a word boundary: the four words that fit, the six that do not', !f5.fits && f5.fittingText === 'aaaa bbbb cccc dddd' && f5.rest === 'eeee ffff gggg hhhh iiii jjjj' && f5.overflowWords === 6 && joins(f5, ten), f5);
var all = T.fitTextToFrame(frame('', 20, 15), five);
check('5.2 text that fits: all of it, nothing left, fits', all.fits && all.fittingText === five && all.rest === '' && all.overflowWords === 0, all);
var threes = []; for (var i = 1; i <= 20; i++) threes.push(i === 13 ? 'zz.' : 'w' + String(i).padStart(2, '0'));
var sentence = threes.join(' '), fs1 = T.fitTextToFrame(frame('', 20, 15), sentence); // five 3-letter words a line, three lines: 15 fit
check('5.3 a sentence end within the last few words is preferred: the cut is after "zz."', /zz\.$/.test(fs1.fittingText) && fs1.rest.indexOf('w14') === 0 && fs1.overflowWords === 7 && joins(fs1, sentence), fs1);
var paraText = threes.slice(0, 12).join(' ') + '\n\n' + threes.slice(12).join(' ');
var fp = T.fitTextToFrame(frame('', 20, 20), paraText); // 4 lines: w01–w12 take two and a bit, the empty line, then "zz. w14 …"
check('5.4 a paragraph end is preferred over a sentence end', fp.fittingText === threes.slice(0, 12).join(' ') && fp.rest.indexOf('zz.') === 0 && joins(fp, paraText) &&
  paraText.slice(fp.fittingText.length, paraText.length - fp.rest.length) === '\n\n', fp);
var abbr = threes.slice(0, 12).concat(['Dr.']).concat(threes.slice(13)).join(' ');
check('5.5 "Dr." is not a sentence end', !/Dr\.$/.test(T.fitTextToFrame(frame('', 20, 15), abbr).fittingText));
var none = T.fitTextToFrame(frame('', 20, 2), 'aaaa bbbb');
check('5.6 a frame too small for one line: nothing fits, nothing is lost', !none.fits && none.fittingText === '' && none.rest === 'aaaa bbbb' && none.overflowWords === 2, none);
var cut = T.fitTextToFrame(frame('', 20, 15), 'short abcdefghijklmnopqrstuvwxyz');
check('5.7 a word wider than the frame: not a fit, though nothing is left over', !cut.fits && cut.rest === '' && cut.overflowWords === 1, cut);
/* nothing lost, on many texts */
var seed = 7; function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
var lost = [];
for (var n = 0; n < 300; n++) {
  var parts = [], count = 1 + Math.floor(rnd() * 60);
  for (var k = 0; k < count; k++) {
    var len = 1 + Math.floor(rnd() * 9), w = '';
    for (var c = 0; c < len; c++) w += String.fromCharCode(97 + Math.floor(rnd() * 26));
    if (rnd() < 0.15) w += '.';
    parts.push(w);
    var r = rnd();
    parts.push(r < 0.08 ? '\n\n' : r < 0.14 ? '\n' : r < 0.18 ? '  ' : ' ');
  }
  var text = parts.join('').trim();
  var fr = frame('', 10 + Math.floor(rnd() * 40), 3 + Math.floor(rnd() * 30), { columns: 1 + Math.floor(rnd() * 2), columnGapMm: 4, insetMm: Math.floor(rnd() * 3), paragraphSpacingMm: Math.floor(rnd() * 9) });
  var fit = T.fitTextToFrame(fr, text);
  var restWords = fit.rest ? fit.rest.trim().split(/\s+/).length : 0, keptWords = fit.fittingText ? fit.fittingText.trim().split(/\s+/).length : 0;
  if (!joins(fit, text) || keptWords + restWords !== text.split(/\s+/).length) lost.push({ text: text, fit: fit });
  else if (fit.fittingText && T.fitTextToFrame(fr, fit.fittingText).rest !== '') lost.push({ notFitting: fit.fittingText, frame: [fr.widthMm, fr.heightMm] });
}
check('5.8 300 random texts and frames: fittingText + the whitespace + rest is the text, and what is kept fits', lost.length === 0, lost.slice(0, 2));

/* ---------- 6 frameCapacityWords ---------- */
var cap1 = T.frameCapacityWords(frame('', 20, 15)), capTall = T.frameCapacityWords(frame('', 20, 30)), cap2 = T.frameCapacityWords(frame('', 45, 15, { columns: 2, columnGapMm: 5 }));
check('6.1 a 20 × 15 mm frame (three 20-character lines) holds about 10 words of everyday copy', cap1 >= 7 && cap1 <= 13, cap1);
check('6.2 twice as tall holds about twice as many; two columns about twice as many', capTall >= cap1 * 2 - 2 && capTall <= cap1 * 2 + 2 && cap2 >= cap1 * 2 - 2 && cap2 <= cap1 * 2 + 2, [cap1, capTall, cap2]);
check('6.3 a frame with no room holds none; a big frame is measured whole (more than the first guess)', T.frameCapacityWords(frame('', 20, 2)) === 0 &&
  T.frameCapacityWords(frame('', 180, 260, { fontSizePt: 6, lineHeight: 1.1, columns: 3, columnGapMm: 4 })) > 2000);
var capBig = T.frameCapacityWords(frame('', 20, 15, { fontSizePt: 12 }));
check('6.4 a larger type size holds fewer words', capBig < cap1, [capBig, cap1]);

/* ---------- 7 the continuation split ---------- */
var cont = T.splitOverflowTextForContinuation(frame(ten, 20, 5));
check('7.1 Continue on the next page: what fits stays, the rest goes on, nothing lost', cont.fittingText === 'aaaa bbbb cccc dddd' && cont.continuationText === 'eeee ffff gggg hhhh iiii jjjj', cont);
check('7.2 …text that fits is not split; two words are never split', T.splitOverflowTextForContinuation(frame(five, 20, 15)).continuationText === '' &&
  T.splitOverflowTextForContinuation(frame('aaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbb', 20, 5)).continuationText === '');
var tiny = T.splitOverflowTextForContinuation(frame('aaaa bbbb cccc', 20, 2));
check('7.3 …a frame that holds nothing keeps its first word, so it is not left empty', tiny.fittingText === 'aaaa' && tiny.continuationText === 'bbbb cccc', tiny);

/* ---------- 8 the Designer's fixes ---------- */
var sixteen = words(16); // four 4-letter words a line at 10 pt: four lines in a three-line frame
var big = frame(sixteen, 20, 15);
var sh = T.shrinkTextToFit(big, 7.5);
check('8.1 Shrink to fit: the largest half point that fits (7.5 pt)', sh.changed && sh.fits && sh.element.textStyle.fontSizePt === 7.5 && !ov(sh.element).isOverflowing && big.textStyle.fontSizePt === 10, sh);
var shNo = T.shrinkTextToFit(big, 8);
check('8.2 …never below the approved minimum for body text: at 8 pt it still does not fit, so nothing changes and it says so', !shNo.changed && !shNo.fits && shNo.atLimit && shNo.minimumPt === 8 &&
  shNo.element === big && shNo.overflowWords >= 1, shNo);
check('8.3 the smallest size per kind of text: body and quotes the approved minimum, captions 6 pt, headings not below 60 % (nor the minimum)',
  T.minimumSizePt(frame('x', 20, 5, { fontSizePt: 10 }), 9) === 9 && T.minimumSizePt(frame('x', 20, 5, { fontSizePt: 10 }, { textRole: 'quote' }), 9) === 9 &&
  T.minimumSizePt(frame('x', 20, 5, { fontSizePt: 8 }, { textRole: 'caption' }), 9) === 6 && T.minimumSizePt(frame('x', 20, 5, { fontSizePt: 24 }, { textRole: 'heading' }), 9) === 14.5 &&
  T.minimumSizePt(frame('x', 20, 5, { fontSizePt: 8 }), 9) === 8);
var gapped = frame('aaaa\n\nbbbb', 20, 15, { paragraphSpacingMm: 8 });
var tg = T.tightenSpacingToFit(gapped);
check('8.4 Tighten spacing: the paragraph gap first (leading kept)', tg.changed && tg.fits && tg.element.textStyle.lineHeight === LH5 && tg.element.textStyle.paragraphSpacingMm < 8 && !ov(tg.element).isOverflowing, tg.element.textStyle);
var tl = T.tightenSpacingToFit(frame(sixteen, 20, 18));
check('8.5 …then the leading, as little as needed (1.25)', tl.fits && tl.element.textStyle.lineHeight === 1.25 && !ov(tl.element).isOverflowing, tl.element.textStyle);
var tLimit = T.tightenSpacingToFit(big);
check('8.6 …never below 1.15 for body text: when that is not enough it goes there and says the words still do not fit', tLimit.changed && !tLimit.fits && tLimit.atLimit &&
  tLimit.element.textStyle.lineHeight === 1.15 && tLimit.overflowWords >= 1, tLimit.element.textStyle);
var tAgain = T.tightenSpacingToFit(tLimit.element);
check('8.7 …and again: nothing changes, at its limit', !tAgain.changed && tAgain.atLimit && tAgain.element === tLimit.element);
var gr = T.growFrameToFit(big, 100);
check('8.8 Make the frame taller: the smallest half millimetre that fits (20 mm for four 5 mm lines)', gr.changed && gr.fits && gr.element.heightMm === 20 && gr.element.yMm === 10 && gr.element.widthMm === 20, gr.element);
var grLim = T.growFrameToFit(big, 27);
check('8.9 …never past the bottom margin: it stops there and says the words still do not fit', grLim.changed && !grLim.fits && grLim.atLimit && grLim.element.heightMm === 17, grLim);
check('8.10 …a frame already at the margin is left alone', !T.growFrameToFit(frame(sixteen, 20, 15), 25).changed);
check('8.11 text that fits is never touched by a fix', T.shrinkTextToFit(frame(five, 20, 15), 8).changed === false && T.tightenSpacingToFit(frame(five, 20, 15)).changed === false &&
  T.growFrameToFit(frame(five, 20, 15), 100).changed === false);

/* ---------- 9 remembered, and measured again when the font changes ---------- */
/* every page its own words (different texts, as a real book has), 200-word essays in two columns, a heading, a caption */
function prose(n, salt) {
  var out = [];
  for (var i = 0; i < n; i++) { var len = 2 + ((i * 7 + salt * 13) % 8), w = ''; for (var c = 0; c < len; c++) w += String.fromCharCode(97 + ((i * 31 + c * 17 + salt * 5) % 26)); out.push(w + (i % 17 === 16 ? '.' : '')); }
  return out.join(' ').replace(/\. (\w)/g, function (m, a, at) { return at % 3 ? '. ' + a : '.\n\n' + a; });
}
var pages = [];
for (var p = 0; p < 300; p++) pages.push({ id: 'p' + p, orderIndex: p, label: 'P' + p, role: 'editorial_text', backgroundColor: '#fff',
  elements: [frame(prose(200, p), 120, 160, { columns: 2, columnGapMm: 5 }), frame(prose(12, p + 1000), 120, 12), frame(prose(20, p + 2000), 60, 10)] });
var book = { id: 'b', pages: pages, chapters: [], contentSections: [] };
CALLS = 0;
var t0 = Date.now(), first = T.computeEditorialAnalytics(book), ms1 = Date.now() - t0, calls1 = CALLS;
CALLS = 0;
var t1 = Date.now(), second = T.computeEditorialAnalytics(book), ms2 = Date.now() - t1;
check('9.1 a 300-page book: the second count measures nothing (each frame remembered) and is quick', CALLS === 0 && ms2 < 200 && JSON.stringify(first.overflowFrames) === JSON.stringify(second.overflowFrames), { ms1: ms1, ms2: ms2, calls1: calls1, calls2: CALLS });
check('9.2 …and the first is quick too (under 1.5 s here)', ms1 < 1500, ms1);
var el9 = frame('aaaa bbbb cccc dddd', 20, 5);
var before = ov(el9).isOverflowing;
T.setMeasure(function (t, f) { return mono(t, f) * 1.2; }); // a wider font arrived
var after = ov(el9).isOverflowing;
T.setMeasure(mono);
check('9.3 a layout measured before a font arrived does not stick: a new measure measures again', before === false && after === true && ov(el9).isOverflowing === false);
check('9.4 …the capacity too', (function () { var a = T.frameCapacityWords(frame('', 20, 15)); T.setMeasure(function (t, f) { return mono(t, f) * 2; }); var b = T.frameCapacityWords(frame('', 20, 15)); T.setMeasure(mono); return b < a; })());
T.setMeasure(null);
check('9.5 without a browser, the plain estimate is used and nothing breaks', T.getMeasure() === T.estimateMeasure && typeof ov(frame(ten, 20, 5)).overflowWords === 'number');
T.setMeasure(mono);
check('9.6 old names still work (Phase 1 callers): the fixes on the new measure', T.fitTextWithinApprovedLimits(big, 7.5).textStyle.fontSizePt === 7.5 &&
  T.expandFrameHeightForText(big, 108).heightMm === 20 && T.tightenParagraphSpacing(gapped).textStyle.paragraphSpacingMm < 8);

/* ---------- 10 the editor uses it ---------- */
function src(rel) { return fs.readFileSync(path.join(APP, 'src', rel), 'utf8'); }
var CANVAS = src('components/BookCanvas.tsx'), RIGHT = src('components/RightPropertiesPanel.tsx'), PRE = src('engines/preflightEngine.ts'), AFE = src('engines/autoFlowEngine.ts'),
  AIS = src('services/aiService.ts'), MEAS = src('engines/textMeasure.ts');
check('10.1 the canvas measures again when fonts load, draws the paragraph gap it measures, and keeps the outline and label (never in preview)',
  /useFontsVersion\(\);/.test(CANVAS) && /paragraphsForDrawing\(shown\)/.test(CANVAS) && /paragraphExtraMm\(el\.textStyle\)/.test(CANVAS) &&
  /!previewMode && ov\?\.isOverflowing \? 'outline-2 outline-dashed outline-offset-1 outline-\[#D94F3D\]' : ''/.test(CANVAS) && /\+\{ov\.overflowWords\} words don't fit/.test(CANVAS));
check('10.2 the browser measure: a canvas never on the page, widths kept per font and word, fonts watched (loadingdone, ready)',
  /document\.createElement\('canvas'\)\.getContext\('2d'\)/.test(MEAS) && /addEventListener\('loadingdone', refreshSoon\)/.test(MEAS) && /fonts\.ready\.then\(refreshSoon/.test(MEAS) &&
  /EM_WIDTHS\.clear\(\);/.test(MEAS) && /fonts\.check\(font\)/.test(MEAS));
check('10.3 the pre-export check and Auto-Flow use the new measure', /measureTextOverflow\(el\)/.test(PRE) && /frameCapacityWords\(el\)/.test(AFE) && !/0\.52/.test(AFE + src('engines/textEngine.ts')));
check('10.4 the overflow box: the Designer\'s three fixes only for a Designer; Continue, Shorten with ETB2B AI and Edit myself for both',
  /\{canDesign && \(\n\s*<>\n\s*<button type="button" onClick=\{shrinkToFit\}/.test(RIGHT) && /onClick=\{tightenSpacing\}/.test(RIGHT) && /onClick=\{makeTaller\}/.test(RIGHT) &&
  /<\/>\n\s*\)\}\n\s*<button type="button" onClick=\{continueOnNextPage\}/.test(RIGHT) && /Shorten with ETB2B AI/.test(RIGHT) && /onClick=\{editMyself\}/.test(RIGHT));
check('10.5 "Edit with AI | Edit myself": manual is the default; the AI\'s answer is a suggestion with Apply and Discard; Apply goes through the undoable update',
  /useState<'manual' \| 'ai'>\('manual'\)/.test(RIGHT) && /role="radiogroup"/.test(RIGHT) && /'Edit with AI'/.test(RIGHT) && /'Edit myself'/.test(RIGHT) &&
  /onUpdateElement\(activePage\.id, el\.id, \{ text: ai\.suggestion \}\)/.test(RIGHT) && />Apply</.test(RIGHT) && />Discard</.test(RIGHT) &&
  ['Shorten to fit', 'Fix grammar and spelling', 'Make it clearer', 'Ask for a change'].every(function (t) { return RIGHT.indexOf(t) !== -1; }) &&
  /apiSend<[^>]*>\('POST', '\/ai\/edit-text', payload\)/.test(AIS));
check('10.6 a Content editor\'s continuation only fills an empty text frame (content); a new frame is the Designer\'s',
  /if \(next && frame\) \{[\s\S]{0,300}onUpdateElement\(next\.id, frame\.id, \{ text: split\.continuationText \}\);\n\s*onUpdateElement\(activePage\.id, el\.id, \{ text: split\.fittingText \}\);/.test(RIGHT) &&
  /if \(canDesign\) \{\n\s*onContinueOverflowToNextPage\(activePage\.id, el\.id\);/.test(RIGHT));
check('10.7 no bare "ET" in what the panel says', !/[^A-Za-z]ET[^A-Za-z0-9]/.test(RIGHT.replace(/ETB2B/g, '')));

process.stdout.write('books-text: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
