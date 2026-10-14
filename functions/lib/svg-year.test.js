// node functions/lib/svg-year.test.js — the year of a lock-up drawn as outlines, on a real ET lock-up.
const fs = require('fs'), path = require('path');
const sy = require('./svg-year');
const logoUnit = require('./logo-unit');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

/* pathBox */
var b = sy.pathBox('M10 20 L30 20 L30 50 Z');
check('pathBox: absolute lines', b && b.x === 10 && b.y === 20 && b.width === 20 && b.height === 30, JSON.stringify(b));
b = sy.pathBox('m10 20 h20 v30 h-20z');
check('pathBox: relative h/v', b && b.x === 10 && b.y === 20 && b.width === 20 && b.height === 30, JSON.stringify(b));
b = sy.pathBox('M0 0 C10 -5 20 5 30 0');
check('pathBox: curve control points count', b && b.y === -5 && b.height === 10 && b.width === 30, JSON.stringify(b));
b = sy.pathBox('M5 5 10 10 15 0');
check('pathBox: implicit line-tos after a move', b && b.width === 10 && b.height === 10, JSON.stringify(b));
check('pathBox: nothing in, nothing out', sy.pathBox('') === null && sy.pathBox('Q') === null);

/* the real lock-up: "SUMMIT '2026" drawn as outlines */
var svg = fs.readFileSync(path.join(__dirname, 'fixtures', 'svg-year', 'agentic-summit-2026.svg'), 'utf8');
check('viewBox read', JSON.stringify(sy.viewBoxOf(svg)) === JSON.stringify({ x: 0, y: 0, width: 471, height: 241 }));
var shapes = sy.shapesIn(svg);
check('every path found, none transformed', shapes.length === 62 && shapes.every(function (s) { return !s.transformed; }), shapes.length);

// the box a reader gives for the four digits (a little loose)
var found = sy.yearShapes(svg, { x: 280, y: 190, width: 145, height: 52 });
check('the four digits, and only they, are the year', found && found.shapes.length === 4 && Math.round(found.box.x) === 283 && Math.round(found.box.x + found.box.width) === 421, found && JSON.stringify(found.box));
check('the digits\' colour', found && found.fill.toLowerCase() === '#9fcdff');
check('a box over "SUMMIT" is not a year (one row of six letters is too wide a run to be refused only by ratio, but the apostrophe and digits are left out)',
  (function () { var f = sy.yearShapes(svg, { x: 40, y: 190, width: 225, height: 52 }); return !f || f.shapes.every(function (s) { return s.box.x < 270; }); })());
check('a box over the whole drawing is refused', sy.yearShapes(svg, { x: 0, y: 0, width: 471, height: 241 }) === null);
check('an empty box is refused', sy.yearShapes(svg, { x: 0, y: 0, width: 0, height: 0 }) === null);

var moved = sy.replaceYear(svg, found, { toYear: '2027', font: null });
check('the year is set as text', /<text[^>]*>2027<\/text><\/svg>\s*$/.test(moved));
check('the old digits are gone and everything else stays', sy.shapesIn(moved).length === 58 && moved.indexOf(svg.slice(0, 200)) === 0);
check('the result is a safe SVG', !logoUnit.svgIsActive(moved));
check('the next edition is a text change', logoUnit.svgReplaceYear(moved, '2027', '2028').changed === 1);
check('text is escaped', sy.replaceYear(svg, found, { toYear: '<b>' }).indexOf('&lt;b&gt;') !== -1);

/* a transformed digit is never chosen */
var moving = '<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><g transform="translate(10 0)"><path d="M10 10h10v20h-10z" fill="#fff"/><path d="M25 10h10v20h-10z" fill="#fff"/><path d="M40 10h10v20h-10z" fill="#fff"/><path d="M55 10h10v20h-10z" fill="#fff"/></g></svg>';
check('shapes moved by a transform are never chosen', sy.yearShapes(moving, { x: 10, y: 8, width: 56, height: 24 }) === null);
var defs = '<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c"><path d="M0 0h100v40H0z"/></clipPath></defs><path d="M10 10h10v20h-10z" fill="#fff"/></svg>';
check('paths inside defs / clipPath are not drawing', sy.shapesIn(defs).length === 1);

/* ---- what the review of this file found: each of these must leave the drawing alone (null), never take
   out the wrong shapes ---- */
function lockup(digits, extra) {
  // "SUMMIT" as four blocks, then a year of four digit-sized shapes at x 200, 240, 280, 320 (30 x 60 each)
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">' +
    '<path d="M20 100h25v60h-25z" fill="#ffffff"/><path d="M55 100h25v60h-25z" fill="#ffffff"/><path d="M90 100h25v60h-25z" fill="#ffffff"/><path d="M125 100h25v60h-25z" fill="#ffffff"/>' +
    digits + (extra || '') + '</svg>';
}
function digit(x, fill) { return '<path fill-rule="evenodd" d="M' + x + ' 100h30v60h-30z M' + (x + 8) + ' 110h14v40h-14z" fill="' + (fill || '#9fcdff') + '"/>'; }
var YEAR = { x: 200, y: 100, width: 150, height: 60 };
var plain = lockup(digit(200) + digit(240) + digit(280) + digit(320));
var f0 = sy.yearShapes(plain, YEAR);
check('control: four plain digits are the year', f0 && f0.shapes.length === 4);

b = sy.pathBox('M315 100a15 30 0 1 1 0 60a15 30 0 1 1 0-60z');
check('pathBox: a digit drawn as arcs has its full width', b && Math.round(b.x) === 300 && Math.round(b.width) === 30 && Math.round(b.height) === 60, JSON.stringify(b));
b = sy.pathBox('M1e1 2e1L3e1 5e1L1e1 5e1z');
check('pathBox: numbers written with exponents', b && b.x === 10 && b.y === 20 && b.width === 20 && b.height === 30, JSON.stringify(b));
b = sy.pathBox('M10 10a20 30 0 1160 0');
check('pathBox: arc flags packed together (svgo)', b && Math.round(b.width) === 60 && Math.round(b.height) === 45, JSON.stringify(b));
b = sy.pathBox('M0 0Q10 -15 20 0T40 0');
check('pathBox: a smooth curve reaches its reflected control point', b && b.y <= -11.25 && b.y + b.height >= 11.25, JSON.stringify(b));
var arcZero = lockup(digit(200) + '<path d="M255 100a15 30 0 1 1 0 60a15 30 0 1 1 0-60z" fill="#9fcdff"/>' + digit(280) + digit(320));
var fa = sy.yearShapes(arcZero, YEAR);
check('a "0" drawn as arcs is one of the digits taken out', fa && fa.shapes.length === 4, fa && fa.shapes.length);

check('a digit that is a <polygon> (not a path) leaves an end of the year uncovered: refused',
  sy.yearShapes(lockup(digit(200) + digit(240) + digit(280) + '<polygon points="320,100 350,100 350,160 320,160" fill="#9fcdff"/>'), YEAR) === null);
check('a digit drawn in one path with the letter before it: refused',
  sy.yearShapes(lockup('<path d="M160 100h25v60h-25z M200 100h30v60h-30z" fill="#9fcdff"/>' + digit(240) + digit(280) + digit(320)), YEAR) === null);
check('a year cut out of a badge (one shape round the box): refused',
  sy.yearShapes(lockup('<path fill-rule="evenodd" d="M192 90h166v80h-166z M200 100h30v60h-30z M240 100h30v60h-30z M280 100h30v60h-30z M320 100h30v60h-30z" fill="#e4002b"/>'), YEAR) === null);
var spaced = lockup(digit(200) + digit(240) + digit(280) + '<path fill="#9fcdff" d="M320 100h30v60h-30z"></path >', '<circle cx="380" cy="40" r="10" fill="#f00"/><path d="M0 190h400v10H0z" fill="#f00"></path>');
var fs1 = sy.yearShapes(spaced, YEAR);
check('a path closed as </path > is found whole, and nothing after it is swallowed',
  fs1 && fs1.shapes.length === 4 && /<circle/.test(sy.cutShapes(spaced, fs1)) && /M0 190h400v10H0z/.test(sy.cutShapes(spaced, fs1)));
check('a path with something inside it cannot be taken out on its own: refused',
  sy.yearShapes(lockup(digit(200) + digit(240) + digit(280) + '<path d="M320 100h30v60h-30z" fill="#9fcdff"><title>x</title></path>'), YEAR) === null);
check('digits drawn only as outlines (fill none): refused',
  sy.yearShapes(lockup(['200', '240', '280', '320'].map(function (x) { return '<path d="M' + x + ' 100h30v60h-30z" fill="none" stroke="#9fcdff"/>'; }).join('')), YEAR) === null);
check('cutShapes takes out exactly the digits', sy.shapesIn(sy.cutShapes(plain, f0)).length === 4);
check('replaceYear sets the year in the colour it is given', /fill="#123456"/.test(sy.replaceYear(plain, f0, { toYear: '2027', fill: '#123456' })));

/* ---- the drawn check (api.js: rasterise + yearCutColour), on real pictures ---- */
var hooks = require('./api.js')._testHooks;
function pxBox(vbW, bx) { var k = 1000 / vbW; return { x: bx.x * k, y: bx.y * k, width: bx.width * k, height: bx.height * k }; }
async function drawn(svgText, found, vbW, bx) {
  var before = await hooks.rasterise(svgText), after = await hooks.rasterise(sy.cutShapes(svgText, found));
  return hooks.yearCutColour(before, after, pxBox(vbW, bx), pxBox(vbW, found.box));
}
(async function () {
  var r = await hooks.rasterise(plain);
  if (!r) { check('resvg draws an SVG here', false); return finish(); }
  check('rasterise: a lock-up is drawn at 1000px wide, with its pixels', r.width === 1000 && r.height === 500 && r.pixels.length === 1000 * 500 * 4);
  check('rasterise: a drawing hundreds of times taller than wide is not drawn',
    (await hooks.rasterise('<svg xmlns="http://www.w3.org/2000/svg" width="1pt" height="60pt"><path d="M0 0h1v60H0z"/></svg>')) === null);
  check('rasterise: a drawing far too wide is not drawn',
    (await hooks.rasterise('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="10"><path d="M0 0h10v10H0z"/></svg>')) === null);

  check('drawn check: exactly the year went — its colour is the digits\'', (await drawn(plain, f0, 400, YEAR)) === '#9fcdff');
  var classed = plain.replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><style>.y{fill:#ffcc00}</style>').replace(/ fill="#9fcdff"/g, ' class="y"');
  var fc = sy.yearShapes(classed, YEAR);
  check('drawn check: digits coloured by a stylesheet class get that colour, not black', fc && (await drawn(classed, fc, 400, YEAR)) === '#ffcc00');
  var two = plain.replace(/(<path fill-rule="evenodd" d="M2[04]0[^"]*") fill="#9fcdff"/g, '$1 class="r"').replace(/ fill="#9fcdff"/g, ' class="b"')
    .replace('viewBox="0 0 400 200">', 'viewBox="0 0 400 200"><style>.r{fill:#ff0000}.b{fill:#9fcdff}</style>');
  var ft = sy.yearShapes(two, YEAR);
  check('two-colour digits by class pass the shape test (their colours are unknown to it)…', ft && ft.shapes.length === 4);
  check('…and the drawn check refuses them', ft && (await drawn(two, ft, 400, YEAR)) === '');
  var short = { shapes: f0.shapes.slice(0, 3), box: f0.box, fill: f0.fill };
  check('drawn check: a digit left behind is refused', (await drawn(plain, short, 400, YEAR)) === '');
  var tooMuch = { shapes: f0.shapes.concat(sy.shapesIn(plain).slice(0, 1)), box: f0.box, fill: f0.fill };
  check('drawn check: anything else taken out with the year is refused', (await drawn(plain, tooMuch, 400, YEAR)) === '');

  /* the real lock-up, end to end */
  var realFound = sy.yearShapes(svg, { x: 280, y: 190, width: 145, height: 52 });
  var realColour = await drawn(svg, realFound, 471, { x: 280, y: 190, width: 145, height: 52 });
  check('drawn check on the real lock-up: kept, in its light blue', /^#[0-9a-f]{6}$/.test(realColour) && Math.abs(parseInt(realColour.slice(1, 3), 16) - 0x9f) < 24 && Math.abs(parseInt(realColour.slice(5, 7), 16) - 0xff) < 24, realColour);
  /* a reader's box that takes in the apostrophe before the year: the apostrophe stays, and that is no leftover */
  var wide = { x: 267, y: 190, width: 158, height: 52 };   // the apostrophe is at x 269.7–276.7
  var wideFound = sy.yearShapes(svg, wide);
  check('the apostrophe is not one of the digits', wideFound && wideFound.shapes.length === 4, wideFound && wideFound.shapes.length);
  check('drawn check with the apostrophe in the box: still kept', wideFound && /^#[0-9a-f]{6}$/.test(await drawn(svg, wideFound, 471, wide)));
  finish();
})().catch(function (e) { check('drawn checks ran', false, e.stack); finish(); });

function finish() {
  if (failed) { console.error('svg-year: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('svg-year: all ' + passed + ' checks passed');
}
