// node functions/lib/logo-on-dark.test.js — a lock-up drawn for a light ground made again for a dark one (api.js
// onDarkCopy), by ET's logo rule: only black lettering changes, to white; nothing light and nothing coloured changes
// (the red ET square with its white "ET" above all), and lettering printed on the lock-up's own plate stays black.
// Written for Trendies Awards 2027, whose copy turned its cream tagline labels black and its white "ET" dark.
'use strict';
const hooks = require('./api.js')._testHooks;
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var W = 60, H = 20;
function picture(paint) {
  var data = Buffer.alloc(W * H * 4);                                           // all see-through
  paint(function (x0, y0, x1, y1, rgba) {
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var o = (y * W + x) * 4; data[o] = rgba[0]; data[o + 1] = rgba[1]; data[o + 2] = rgba[2]; data[o + 3] = rgba[3]; }
  });
  return { width: W, height: H, data: data };
}
function px(img, x, y) { var o = (y * W + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]; }
function same(a, b) { return a.every(function (v, i) { return v === b[i]; }); }

var BLACK = [20, 20, 20, 255], CREAM = [245, 236, 214, 255], RED = [237, 28, 36, 255], WHITE = [255, 255, 255, 255], PURPLE = [120, 40, 160, 255];
var lockup = picture(function (fill) {
  fill(2, 4, 22, 16, BLACK);                                                    // the name, black, on the see-through ground
  fill(26, 2, 44, 18, CREAM); fill(30, 8, 40, 12, BLACK);                       // a cream label with black words on it
  fill(48, 2, 58, 12, RED); fill(50, 5, 56, 9, WHITE);                          // the ET square, its white "ET"
  fill(48, 14, 58, 18, PURPLE);                                                 // a colour of its own
});
var copy = hooks.onDarkCopy(lockup);
check('a copy is made', !!copy);
check('the lettering on the see-through ground turns white', copy && px(copy, 10, 10)[0] > 220 && px(copy, 10, 10)[3] === 255, copy && px(copy, 10, 10));
check('the label keeps its cream, and its words stay black', copy && same(px(copy, 27, 3), CREAM) && same(px(copy, 35, 10), BLACK), copy && [px(copy, 27, 3), px(copy, 35, 10)]);
check('the red ET square and its white "ET" never change', copy && same(px(copy, 49, 3), RED) && same(px(copy, 53, 7), WHITE));
check('a colour of its own stays', copy && same(px(copy, 50, 15), PURPLE));
check('the see-through ground stays see-through', copy && px(copy, 0, 0)[3] === 0 && px(copy, 24, 10)[3] === 0);
check('the original is not touched', same(px(lockup, 10, 10), BLACK));

var onlyLabel = picture(function (fill) { fill(26, 2, 44, 18, CREAM); fill(30, 8, 40, 12, BLACK); });
check('lettering only on its own plate: no copy (it reads on any ground as it is)', hooks.onDarkCopy(onlyLabel) === null);
var white = picture(function (fill) { fill(2, 4, 22, 16, WHITE); });
check('a lock-up already drawn in white: no copy', hooks.onDarkCopy(white) === null);

if (failed) { console.error('logo-on-dark: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('logo-on-dark: all ' + passed + ' checks passed');
