/* node functions/lib/chat-docs-keep.test.js — the photos taken out of a document attached to ETB2B AI are kept 30 days,
   and the ones put on the page are kept (owner, 16 Nov 2026; lib/chat-docs-keep.js, builder C): the Custom-Time every
   stored one carries, the placed ones found in a saved page (this event's own only) and moved far ahead with their WebP
   copies, once per server, never failing the save; and the bucket rule and its owner-run step. No network: Storage is
   stood in for. */
'use strict';
var fs = require('fs');
var path = require('path');
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail) : '')); }
var keep = require('./chat-docs-keep');

var BUCKET = 'test-bucket', EV = 'qa-paic-keep';
var OWN = 'https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/';
var P1 = 'chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p3.jpg', P2 = 'chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p7.jpg';

function fakeFb(objects, failOn) {
  var calls = { list: [], set: [] };
  return { calls: calls, bucket: { name: BUCKET, getFiles: function (o) {
    calls.list.push(o.prefix);
    if (failOn && o.prefix.indexOf(failOn) !== -1) return Promise.reject(new Error('UNAVAILABLE'));
    var files = Object.keys(objects).filter(function (k) { return k.indexOf(o.prefix) === 0; }).map(function (k) {
      return { name: k, setMetadata: function (m) { calls.set.push(k); objects[k] = Object.assign({}, objects[k], m); return Promise.resolve([objects[k]]); } };
    });
    return Promise.resolve([files]);
  } } };
}

(async function () {
  var now = new Date().toISOString();
  check(keep.storeOpts(now).customTime === now && Object.keys(keep.storeOpts(now)).join() === 'customTime' && keep.KEEP_DAYS === 30, 'a stored document picture carries its Custom-Time, nothing else');
  check(Date.parse(keep.KEEP_UNTIL) > Date.parse('2100-01-01') , 'a placed picture is kept far beyond the 30 days');

  var html = '<section><img src="' + OWN + P1 + '" alt="x"><div style="background-image:url(&quot;' + OWN + P2 + '?v=3&quot;)"></div><img src="' + OWN + P1 + '">' +
    '<img src="https://storage.googleapis.com/' + BUCKET + '/events/qa-other/' + P1 + '"><img src="https://storage.googleapis.com/other-bucket/events/' + EV + '/' + P1 + '">' +
    '<img src="' + OWN + 'generated/a.png"><img src="' + OWN + 'chat-docs/../x/mw1-0123456789ab-p3.jpg"></section>';
  var found = keep.pathsInPage(html, BUCKET, EV);
  check(JSON.stringify(found) === JSON.stringify(['events/' + EV + '/' + P1, 'events/' + EV + '/' + P2]),
    'the page\'s document pictures: this event\'s own, each once; never another event\'s, another bucket\'s, a made picture or a bad path', found);
  check(keep.pathsInPage('<p>no pictures</p>', BUCKET, EV).length === 0 && keep.pathsInPage(html, BUCKET, '../x').length === 0 && keep.pathsInPage(null, BUCKET, EV).length === 0, 'none, a bad event id, no page: nothing');

  var objects = {};
  objects['events/' + EV + '/' + P1] = { customTime: now };
  objects['events/' + EV + '/' + P1 + '.rv-abc.1600x900.w800.webp'] = { customTime: now };
  objects['events/' + EV + '/' + P2] = { customTime: now };
  objects['events/' + EV + '/chat-docs/20261116120000-a1b2c3/mw1-fedcba987654-p3-small.jpg'] = { customTime: now };
  var FB = fakeFb(objects);
  keep.forget();
  var r = await keep.keepInPage(FB, EV, html);
  check(r.kept === 2 && r.failed === 0 && objects['events/' + EV + '/' + P1].customTime === keep.KEEP_UNTIL && objects['events/' + EV + '/' + P1 + '.rv-abc.1600x900.w800.webp'].customTime === keep.KEEP_UNTIL &&
    objects['events/' + EV + '/' + P2].customTime === keep.KEEP_UNTIL && objects['events/' + EV + '/chat-docs/20261116120000-a1b2c3/mw1-fedcba987654-p3-small.jpg'].customTime === now,
    'saved with the page: each placed picture and its WebP copies kept; a picture not on the page (its small copy) still goes in 30 days', objects);
  var listed = FB.calls.list.length;
  r = await keep.keepInPage(FB, EV, html);
  check(r.kept === 0 && FB.calls.list.length === listed, 'saved again: Storage is not asked again on this server');
  keep.forget();
  var F2 = fakeFb(objects, 'p7');
  var logged = [], realError = console.error;
  console.error = function (l) { logged.push(String(l)); };
  try { r = await keep.keepInPage(F2, EV, html); } finally { console.error = realError; }
  check(r.kept === 1 && r.failed === 1 && logged.some(function (l) { return /could not be marked to keep/.test(l); }), 'one that cannot be marked is logged, the others kept; it never throws', { r: r, logged: logged });
  r = await keep.keepInPage(F2, EV, html);
  check(F2.calls.list.filter(function (p) { return /p7/.test(p); }).length === 2, '… and is tried again at the next save');
  r = await keep.keepInPage(null, EV, html);
  check(r.kept === 0, 'no Storage: nothing, no throw');

  /* the save calls it; the rule and its owner-run step are written down */
  var ROOT = path.join(__dirname, '..', '..');
  var api = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
  var put = api.slice(api.indexOf('function handleSitePut('), api.indexOf('THE PUBLISH TRANSFORM'));
  check(/if \(!stored\) return;[\s\S]{0,300}require\('\.\/chat-docs-keep'\)\.keepInPage\(fb, eventId, pageHtml\);/.test(put), 'a site save keeps the document pictures its page shows, never waited on');
  var rule = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'storage-lifecycle-chat-docs.json'), 'utf8'));
  check(rule.rule.length === 1 && rule.rule[0].action.type === 'Delete' && JSON.stringify(rule.rule[0].condition) === '{"daysSinceCustomTime":30}', 'the bucket rule: delete 30 days after an object\'s Custom-Time, nothing else', rule);
  var rc = fs.readFileSync(path.join(ROOT, 'tools', 'release-check.js'), 'utf8');
  check(/\n {5}8\. Once, by the owner[\s\S]*storage-lifecycle-chat-docs\.json[\s\S]*Dry run[\s\S]*REPLACES[\s\S]*custom_time[\s\S]*--lifecycle-file=tools\/storage-lifecycle-chat-docs\.json/.test(rc),
    'the release checklist has the owner-run step, its dry run first');
  var dp = fs.readFileSync(path.join(__dirname, 'doc-pictures.js'), 'utf8');
  check(/storeImageFile\(fb, folder, p\.full, 'image\/jpeg', 'p' \+ p\.page, actor, keep\)/.test(dp) && /Object\.assign\(\{ variants: false \}, keep\)/.test(dp), 'every picture storeBatch writes is given the Custom-Time');
  var ev = fs.readFileSync(path.join(__dirname, 'api-events.js'), 'utf8'), pics = fs.readFileSync(path.join(__dirname, 'pictures.js'), 'utf8');
  check(/opts\.customTime \? \{ customTime: String\(opts\.customTime\) \} : \{\}/.test(ev) && /customTime: opts\.customTime/.test(ev) && /opts\.customTime \? \{ customTime: String\(opts\.customTime\) \} : \{\}/.test(pics),
    '… and its WebP copies too, so they go with it');

  if (failures.length) { console.error('chat-docs-keep: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('chat-docs-keep: all ' + checks + ' checks passed');
})().catch(function (e) { console.error('chat-docs-keep: the test itself stopped — ' + (e && e.stack || e)); process.exit(1); });
