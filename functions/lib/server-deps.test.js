/* node functions/lib/server-deps.test.js — every package the server's code requires is one the deploy installs.
   Firebase App Hosting builds from the repository root: it installs what the root package.json and
   package-lock.json declare, and nothing else. A package that is only there because another one depends on it
   (domhandler under htmlparser2, say) can move or change with that package, so requiring it directly may work on
   a laptop and fail in the deploy (B05 verify: site-records.js required domhandler). This checks server.js and
   every module in functions/lib (tests aside): each require() of a package names a Node built-in or a dependency
   of the root package.json, and the lock file's own copy of those dependencies is the same, so `npm ci` takes it.
   No network. Exits 1 listing every failure. */
'use strict';

var fs = require('fs'), path = require('path');
var builtins = require('module').builtinModules;
var ROOT = path.join(__dirname, '..', '..');

var failures = [], checks = 0;
function check(label, cond, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 600) : '')); }

var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
var lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
var deps = pkg.dependencies || {};

/* the package a require() names: "@scope/name" or "name", without a path inside it */
function packageOf(spec) {
  var parts = spec.split('/');
  return spec.charAt(0) === '@' ? parts.slice(0, 2).join('/') : parts[0];
}

var files = fs.readdirSync(__dirname).filter(function (f) { return /\.js$/.test(f) && !/\.test\.js$/.test(f); })
  .map(function (f) { return path.join(__dirname, f); }).concat([path.join(ROOT, 'server.js')]);
var undeclared = [];
files.forEach(function (file) {
  /* comments are left out: a require() mentioned in a sentence is not one */
  var src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  var re = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g, m;
  while ((m = re.exec(src))) {
    var spec = m[2];
    if (/^[./]/.test(spec) || /^node:/.test(spec)) continue;
    var name = packageOf(spec);
    if (builtins.indexOf(name) !== -1) continue;
    if (!Object.prototype.hasOwnProperty.call(deps, name)) undeclared.push(path.relative(ROOT, file) + ': ' + spec);
  }
});
check('1 every package the server requires is a dependency of the root package.json', !undeclared.length, undeclared);
check('2 site-records.js takes its text nodes from htmlparser2 itself while domhandler is not declared',
  !!deps.domhandler || !/require\(\s*['"]domhandler['"]\s*\)/.test(fs.readFileSync(path.join(__dirname, 'site-records.js'), 'utf8')));
var lockRoot = (lock.packages && lock.packages['']) || {};
check('3 the lock file declares the same dependencies as package.json (npm ci installs from it)',
  JSON.stringify(lockRoot.dependencies || {}) === JSON.stringify(deps), { lock: lockRoot.dependencies, pkg: deps });
var missing = Object.keys(deps).filter(function (name) { return !(lock.packages && lock.packages['node_modules/' + name]); });
check('4 each of them is in the lock file', !missing.length, missing);

if (failures.length) { console.error('server-deps: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('server-deps: all ' + checks + ' checks passed');
