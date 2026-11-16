/* node functions/lib/picture-facts.test.js — the card's last line for a message of several pictures (picture-facts.js,
   W4, builder A, 16 Nov 2026): every mix of outcomes gives one true sentence; a held picture is never called placed;
   plain words, no bare "ET"; ES5; loaded by the editor and served. */
'use strict';
var fs = require('fs'), path = require('path');
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail) : '')); }
var ROOT = path.join(__dirname, '..', '..');
var F = require('../../picture-facts.js');

var OUT = ['placed', 'held', 'kept', 'option', 'failed', 'stopped'];
var all = [];
OUT.forEach(function (a) { OUT.forEach(function (b) { all.push([a, b]); }); });
all.forEach(function (mix) {
  var jobs = mix.map(function (o, i) { return { label: ['What Awaits You', 'Why Join Us'][i], outcome: o, why: o === 'held' ? 'Two people walk down the street, and this place takes nobody.' : o === 'failed' ? 'The picture service is not answering right now.' : '', where: o === 'held' || o === 'kept' ? 'It is in the tray above the message box.' : '', line: o === 'placed' ? 'I removed a small sign.' : '' }; });
  var s = F.closingLine(jobs, { status: mix.indexOf('placed') !== -1 ? 'applied' : 'failed' });
  var placedN = mix.filter(function (m) { return m === 'placed'; }).length;
  check(/[.]$/.test(s) && s.split('. ').length <= 2 && !/\bET\b/.test(s), 'one sentence, plain: ' + mix.join('+'), s);
  check(mix.every(function (m, i) { var name = '“' + jobs[i].label + '”'; return m !== 'held' || (s.indexOf(name + ' kept off the page') !== -1 && s.indexOf(name + ' placed') === -1); }), 'a held picture is never called placed: ' + mix.join('+'), s);
  check(placedN ? !/^Nothing on the page changed/.test(s) : /^Nothing on the page changed for the new pictures/.test(s), 'it says the page changed only when a picture was placed: ' + mix.join('+'), s);
});
var three = F.closingLine([{ label: 'What Awaits You', outcome: 'placed' }, { label: 'The Swiss Arc', outcome: 'placed', line: 'I removed two small figures.' },
  { label: 'Why Join Us', outcome: 'held', why: 'A sign with letters on it.', where: 'It is in the tray above the message box: tell me where it goes.' }], { status: 'partly' });
check(three === '2 of the 3 new pictures are on the page: “What Awaits You” placed; “The Swiss Arc” placed (I removed two small figures); “Why Join Us” kept off the page — a sign with letters on it; it is in the tray above the message box: tell me where it goes.',
  'the plan\'s example, word for word ("I" kept)', three);
check(F.closingLine([{ label: 'A', outcome: 'placed' }, { label: 'B', outcome: 'placed' }], {}) === 'All 2 new pictures are on the page: “A” placed; “B” placed.', 'all placed');
check(F.closingLine([{ label: 'A', outcome: 'placed' }, { label: 'A', outcome: 'option', where: 'Use this picture under my message puts it in the tray' }], {}) === 'The new picture is on the page: “A” placed; another option for “A” — use this picture under my message puts it in the tray.', 'an option waiting is not counted as made', F.closingLine([{ label: 'A', outcome: 'placed' }, { label: 'A', outcome: 'option', where: 'Use this picture under my message puts it in the tray' }], {}));
check(F.closingLine([], {}) === '' && F.closingLine(null) === '', 'no jobs: no line');

/* ES5, loaded by the editor before editor-template-ui.js, and served */
var src = fs.readFileSync(path.join(ROOT, 'picture-facts.js'), 'utf8');
var esbuild = null; try { esbuild = require('esbuild'); } catch (e) { /* checked below */ }
check(!!esbuild, 'esbuild is there to check ES5');
if (esbuild) { var es5 = true; try { esbuild.transformSync(src, { loader: 'js', target: 'es5' }); } catch (e) { es5 = String(e.message).slice(0, 200); } check(es5 === true, 'picture-facts.js is ES5', es5); }
var page = fs.readFileSync(path.join(ROOT, 'custom_editor.html'), 'utf8');
var at = page.indexOf('<script src="picture-facts.js"></script>'), ui = page.indexOf('<script src="editor-template-ui.js"></script>');
check(at !== -1 && at < ui && page.split('src="picture-facts.js"').length === 2, 'custom_editor.html loads it once, before editor-template-ui.js');
check(require('./access').isServableFile('picture-facts.js') === true, 'the server sends it');

if (failures.length) { console.log('picture-facts: ' + failures.length + ' of ' + checks + ' checks FAILED'); failures.forEach(function (f) { console.log('  - ' + f); }); process.exit(1); }
console.log('picture-facts: all ' + checks + ' checks passed');
