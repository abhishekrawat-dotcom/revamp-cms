/* node functions/lib/request-limit.test.js — every route finishes inside the platform's request limit (BE-061).
   lib/http.js PLATFORM_REQUEST_LIMIT_MS is App Hosting's limit (Cloud Run's 300 s default, taken from the
   documentation, not measured); Node's own limit is set above it, the AI calls' budget is derived from it, and
   every deadline a route writes as a number stays under it with room for the route's own work. No network. */
'use strict';
var fs = require('fs'), path = require('path');
var fails = 0, n = 0;
function check(label, cond, detail) {
  n++;
  if (cond) return;
  fails++;
  console.log('FAIL ' + label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 400) : ''));
}

var H = require('./http');
var LIMIT = H.PLATFORM_REQUEST_LIMIT_MS;
check('1 the platform limit is recorded once, in lib/http.js: 300 s', LIMIT === 300000, LIMIT);
check('1 …with where it comes from, and that it was not measured', /TAKEN FROM DOCUMENTATION, NOT MEASURED/.test(fs.readFileSync(path.join(__dirname, 'http.js'), 'utf8')));
check('2 Node\'s own limit is above it, so the platform is always the one that ends a request', H.SERVER_REQUEST_TIMEOUT_MS > LIMIT, H.SERVER_REQUEST_TIMEOUT_MS);
['server.js', path.join('tools', 'serve.js')].forEach(function (f) {
  var src = fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  check('2 ' + f + ' sets server.requestTimeout from it', /server\.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;/.test(src) && /SERVER_REQUEST_TIMEOUT_MS \} = require\('\.\.?\/functions\/lib\/http'\)/.test(src));
});

var llm = require('./llm');
check('3 one AI call\'s budget is derived from the limit, three quarters of it', llm.LIMITS.budgetMs === Math.round(LIMIT * 0.75), llm.LIMITS);
check('3 …which leaves a fifth of the limit or more for the route around the call', llm.LIMITS.budgetMs <= LIMIT * 0.8);
var over = Object.keys(llm.PROFILES).filter(function (r) { return !(llm.PROFILES[r].timeoutMs < llm.LIMITS.budgetMs); });
check('3 every route\'s Claude timeout fits inside that budget', over.length === 0, over);

/* the deadlines a route writes as a number of milliseconds from now, or as a constant */
var DEADLINE = /(?:deadlineAt\s*=\s*Date\.now\(\)\s*\+\s*|DEADLINE_MS\s*=\s*|deadlineMs:\s*)(\d{4,})\b/g;
var seen = [];
fs.readdirSync(__dirname).filter(function (f) { return /\.js$/.test(f) && !/\.test\.js$/.test(f); }).forEach(function (f) {
  var src = fs.readFileSync(path.join(__dirname, f), 'utf8'), m;
  while ((m = DEADLINE.exec(src))) seen.push({ file: f, ms: +m[1] });
});
check('4 the scan finds the routes\' own deadlines (ingest-source, the picture chat, ETB2B AI on the dashboard)', seen.length >= 3, seen);
var late = seen.filter(function (d) { return d.ms > LIMIT - 20000; });
check('4 every one of them ends at least 20 s before the platform does', late.length === 0, late);

/* the stale figures are gone: nothing names the old Cloud Function's 240 s any more */
var stale = fs.readdirSync(__dirname).filter(function (f) { return /\.js$/.test(f) && !/\.test\.js$/.test(f); })
  .filter(function (f) { return /function's 240 s|240 s \(functions\/index\.js\)/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')); });
check('5 no module still budgets against the old 240 s', stale.length === 0, stale);

console.log(fails ? 'request-limit: ' + fails + ' of ' + n + ' checks FAILED' : 'request-limit: all ' + n + ' checks passed');
process.exit(fails ? 1 : 0);
