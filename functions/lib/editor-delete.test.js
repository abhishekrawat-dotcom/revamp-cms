/* node functions/lib/editor-delete.test.js — Delete in the site editor works on the cards of every site (the owner, 18 Nov
   2026, on Brand World Summit South 2026: "If I want to remove any element from a section is not possible or not well
   organized"). Delete threw for every element inside a card found by how it is built (an AI-designed or imported site
   has no item configuration: repeatConfigFor answers undefined), so the trash button silently did nothing; and
   deleting the words of a numbered row ("07 Digital teams") would have left its number and rule behind.
   Reads editor-template-ui.js and runs repeatItemLabelled's rule on a small DOM. No network. Exits 1 on any failure. */
'use strict';
var fs = require('fs'), path = require('path');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '') + '\n');
}
var ED = fs.readFileSync(path.join(__dirname, '..', '..', 'editor-template-ui.js'), 'utf8');
check('repeatItemLabelled never reads a configuration that is not there', /if \(cfg && cfg\.label\) return cfg\.label !== ':self'/.test(ED) && !/return cfg\.label && cfg\.label !== ':self'/.test(ED));
check('…an item found by its build is taken whole only when nothing of it but numbering or icons would be left', /return onlyContentOf\(item, el\) \? item : null;/.test(ED) && /function onlyContentOf\(item, el\)/.test(ED));

/* the rule itself, on a small stand-in DOM */
var m = /var NUMBERING = (\/.+\/);\n  function onlyContentOf\(item, el\) \{([\s\S]*?)\n  \}/.exec(ED);
check('the rule can be read', !!m);
if (m) {
  var NUMBERING = eval(m[1]);
  var onlyContentOf = new Function('item', 'el', 'NUMBERING', m[2]);
  function node(tag, kind, text, kids) {
    var n = { tagName: tag, kind: kind, textContent: text || '', kids: kids || [] };
    n.getAttribute = function (a) { return a === 'data-editable' ? n.kind : null; };
    n.contains = function (o) { return o === n || n.kids.some(function (k) { return k.contains(o); }); };
    n.querySelectorAll = function () { var out = []; (function walk(x) { x.kids.forEach(function (k) { if (k.kind) out.push(k); walk(k); }); })(n); return out; };
    return n;
  }
  var num = node('SPAN', 'text', '07'), role = node('SPAN', 'text', 'Digital teams'), row = node('LI', null, '', [num, role]);
  check('"Digital teams" is all there is in its row besides "07": the row goes', onlyContentOf(row, role, NUMBERING) === true);
  check('"07" is not: only the number goes', onlyContentOf(row, num, NUMBERING) === false);
  var big = node('B', 'text', '20+'), label = node('SPAN', 'text', 'Sessions expected'), stat = node('DIV', null, '', [big, label]);
  check('a stat\'s number and label are both content: Delete takes only the one selected', onlyContentOf(stat, big, NUMBERING) === false && onlyContentOf(stat, label, NUMBERING) === false);
  var icon = node('svg', 'image', ''), title = node('H3', 'text', 'Book your 1-on-1s'), pic = node('IMG', 'image', ''), card = node('DIV', null, '', [icon, title, pic]);
  check('a card with a real picture keeps it: the title alone goes', onlyContentOf(card, title, NUMBERING) === false);
  var card2 = node('DIV', null, '', [icon, title]);
  check('a card of an icon and a title: the card goes', onlyContentOf(card2, title, NUMBERING) === true);
}
/* every element: selected, deleted, and the layout closing up (the owner, 18 Nov 2026: "delete option should be available to
   all elements. If I have deleted all the left side of elements, then the right side content should be automatically
   switched to full width") */
check('a click on a plain part of the page selects it (plainBoxOf) before the section', /var plain = sec \? plainBoxOf\(target, sec\) : null;\n      if \(plain\)/.test(ED));
check('…never in ETB2B\'s top bar or footer, the logo, the banner\'s frame or the event\'s records', /function pinnedSection\(sec\)/.test(ED) && /key === 'nav' \|\| key === 'footer'/.test(ED) &&
  /PLAIN_KEEP = '\[data-rv-etnav\], \[data-rv-logo-unit\], \[data-rv-logo\], \[data-rv-repeat-template\], \[data-rv-bound\]/.test(ED) && /hero-root'\)\) return null;/.test(ED));
check('"Box around it" steps from any selection to the card or column it sits in', /data-action="select-parent"/.test(ED) && /action === 'select-parent'/.test(ED) && /function parentBoxOf\(el\)/.test(ED));
check('a delete closes up: empty boxes go, and the last column takes the whole row, words included', /closeUpAfter\(box, sec, wasColumn\);/.test(ED) &&
  /box\.style\.gridTemplateColumns = 'minmax\(0, 1fr\)'/.test(ED) && /only\.style\.flex = '1 1 100%'/.test(ED) && /d\.style\.maxWidth = 'none'/.test(ED));
var CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'editor-canvas.css'), 'utf8');
check('a plain selection is outlined (dashed)', /\.ed-selected:not\(\[data-editable\]\):not\(\[data-rv-item\]\):not\(\[data-rv-repeat-template\]\)\{ outline:2px dashed #ED1C24/.test(CSS));
/* alignment of anything (the owner, 18 Nov 2026: "if i want to align this logo unit or the entire center elements to left
   right, currently I can't") */
check('pictures (the logo unit), buttons and plain boxes have left, centre and right too', /alignButtons\('picture'\)/.test(ED) && /alignButtons\('button'\)/.test(ED) && /alignButtons\('box'\)/.test(ED));
check('a picture moves with the frame of its own size around it (alignTarget), by the layout that holds it (placeIn)', /placeIn\(alignTarget\(el\), side\)/.test(ED) &&
  /if \(column\) \{ el\.style\.alignSelf = ALIGN_FLEX\[side\]; return; \}/.test(ED) && /if \(grid\) \{ el\.style\.justifySelf = ALIGN_GRID\[side\]; return; \}/.test(ED));
check('a picture fitted whole in a wider frame is drawn at the same side (object-position), and both logo-unit pictures (light and dark) move together',
  /img\.style\.objectPosition = side === 'center' \? '' : side \+ ' center'/.test(ED) && /lu\.querySelectorAll\('\.rv-lu-img'\)/.test(ED) &&
  /if \(lu\) alignLogoUnit\(lu, side\); else fitSide\(el, side\);/.test(ED) && /forEach\(function \(lu\) \{ alignLogoUnit\(lu, side\); \}\)/.test(ED));
check('a box moves itself and lines up all it holds; a narrow text moves itself as well as its words', /alignContents\(el, side\);\n    placeIn\(el, side\);/.test(ED) &&
  /el\.getBoundingClientRect\(\)\.width < p\.getBoundingClientRect\(\)\.width - 8\) placeIn\(el, side\)/.test(ED) && /alignSelection\(selectedEl, action\.slice\(6\)\)/.test(ED));
check('a button beside other buttons moves with its row (the row is only as wide as they are)', /var row = buttonRowOf\(el\);\n      if \(row\) \{ row\.style\.justifyContent = ALIGN_FLEX\[side\]; placeIn\(alignTarget\(row\), side\); return; \}/.test(ED) &&
  /function buttonRowOf\(el\)/.test(ED));
/* several things at once (the owner, 19 Nov 2026: "can we enable multiple selection by pressing shift/cmd + Select that item?") */
check('Shift, Cmd or Ctrl-click adds a thing to the selection or takes it out, but not inside the text being typed in',
  /if \(\(e\.shiftKey \|\| e\.metaKey \|\| e\.ctrlKey\) && !\(editingEl && editingEl\.contains\(target\)\)\)/.test(ED) && /if \(pick\) toggleInGroup\(pick\);/.test(ED) &&
  /if \(at !== -1\) all\.splice\(at, 1\); else all\.push\(el\);/.test(ED));
check('a plain click, Escape, Undo or a fresh canvas lets go of the whole group', /if \(selectedEl !== el \|\| groupSel\.length\) clearElementSelection\(\);/.test(ED) &&
  /groupSel\.forEach\(function \(n\) \{ unmark\(n, 'ed-selected'\); \}\);\n    groupSel = \[\];/.test(ED) && /currentItem = null; groupSel = \[\];/.test(ED));
check('with two or more, the toolbar aligns, duplicates and deletes them all as ONE undo step', /if \(groupSel\.length && action !== 'deselect'\) \{ onGroupAction\(action\); return; \}/.test(ED) &&
  /roots\.forEach\(function \(n\) \{ alignSelection\(n, action\.slice\(6\)\); clearAiGenerated\(n\); \}\);\n      commitNow\(\);/.test(ED) &&
  /var gone = roots\.filter\(function \(n\) \{ return !!removeFromPage\(n\); \}\)\.length;\n      if \(!gone\) return;\n      commitNow\(\);/.test(ED) &&
  /function removeRepeatItem\(sec, item, later\)/.test(ED) && /if \(!later\) commitNow\(\);/.test(ED));
check('…what sits inside another selected thing goes with it, not twice', /o !== n && o\.contains\(n\)/.test(ED));
process.stdout.write('editor-delete: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
