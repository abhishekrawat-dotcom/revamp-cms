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

if (failed) { console.error('svg-year: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('svg-year: all ' + passed + ' checks passed');
