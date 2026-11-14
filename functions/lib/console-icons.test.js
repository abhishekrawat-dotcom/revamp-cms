/* Every icon a console page draws by name exists: an IC_<NAME> used in a page's scripts is defined in that page, and
   every IC.<name> is one of edit-event-core.js's icons. The console's site bar drew svg(IC_ALERT) after the constant
   went with the old load-error banner (7 Nov 2026), so each warning or error bar threw and never showed. */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var failures = [], checks = 0;
function check(label, ok, detail) { checks++; if (!ok) failures.push(label + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }

var core = fs.readFileSync(path.join(ROOT, 'edit-event-core.js'), 'utf8');
var icBody = (/var IC = \{([\s\S]*?)\n  \};/.exec(core) || [])[1] || '';
var icNames = (icBody.match(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm) || []).map(function (m) { return m.replace(/[\s:]/g, ''); });
check('edit-event-core.js has its icon table', icNames.length > 20, icNames.length);

['edit-event.html', 'edit-event-core.js', 'edit-event-dashboard.js', 'edit-event-seo.js', 'edit-event-site-check.js', 'edit-event-site-notes.js'].forEach(function (file) {
  var p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return;
  var text = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  var used = {}, defined = {};
  (text.match(/\bIC_[A-Z0-9_]+\b/g) || []).forEach(function (n) { used[n] = 1; });
  (text.match(/\bvar\s+(IC_[A-Z0-9_]+)\s*=/g) || []).forEach(function (m) { defined[m.replace(/^var\s+|\s*=$/g, '')] = 1; });
  var missing = Object.keys(used).filter(function (n) { return !defined[n]; });
  check(file + ': every IC_ constant it draws is defined in it', missing.length === 0, missing);
  var dotted = {};
  (text.match(/\bIC\.([a-zA-Z][a-zA-Z0-9]*)\b/g) || []).forEach(function (m) { dotted[m.slice(3)] = 1; });
  var unknown = Object.keys(dotted).filter(function (n) { return icNames.indexOf(n) === -1; });
  check(file + ': every IC.<name> it draws is in edit-event-core.js\'s icon table', unknown.length === 0, unknown);
});

if (failures.length) { console.log('console-icons: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('console-icons: all ' + checks + ' checks passed');
