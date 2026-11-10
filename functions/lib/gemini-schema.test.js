/* Gemini refuses an empty string among a field's choices; the routes' schemas use one for "none". gemini.js sends it
   as "(none)" and turns it back into '' in the answer (owner, 10 Nov 2026: the site editor's fallback to Gemini was
   refused every time — "response_schema.properties[goTo].enum[6]: cannot be empty"). Plain node. */
'use strict';
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_API_BASE = 'https://gemini.invalid';
var G = require('./gemini');
var passed = 0, failed = 0;
function check(name, ok, info) { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (info !== undefined ? ' — ' + JSON.stringify(info).slice(0, 400) : '')); } }
function enumsOf(s, out) {
  out = out || [];
  if (Array.isArray(s)) s.forEach(function (x) { enumsOf(x, out); });
  else if (s && typeof s === 'object') Object.keys(s).forEach(function (k) { if (k === 'enum') out.push(s.enum); else enumsOf(s[k], out); });
  return out;
}
var SCHEMA = { type: 'OBJECT', properties: { goTo: { type: 'STRING', enum: ['content:speakers', 'forms', ''] }, list: { type: 'ARRAY', items: { type: 'OBJECT', properties: { dir: { type: 'STRING', enum: ['asc', 'desc', ''] } }, required: ['dir'] } }, name: { type: 'STRING' } }, required: ['goTo', 'list', 'name'] };
var g = G.forGemini(SCHEMA);
check('every empty choice is sent as "(none)", nested ones too; the rest unchanged', JSON.stringify(g.properties.goTo.enum) === '["content:speakers","forms","(none)"]' &&
  JSON.stringify(g.properties.list.items.properties.dir.enum) === '["asc","desc","(none)"]' && JSON.stringify(g.required) === '["goTo","list","name"]' && g.properties.name.type === 'STRING', g);
check('the schema given is left as it was (a copy is sent)', SCHEMA.properties.goTo.enum[2] === '');
var back = G.fromGemini({ goTo: '(none)', list: [{ dir: '(none)' }, { dir: 'asc' }], name: 'x' });
check('"(none)" in the answer is "" again, wherever it is', back.goTo === '' && back.list[0].dir === '' && back.list[1].dir === 'asc' && back.name === 'x', back);

/* the real request and its answer */
var seen = null, realFetch = global.fetch;
global.fetch = function (url, init) {
  seen = JSON.parse(init.body);
  var body = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ goTo: '(none)', list: [], name: 'ok' }) }] }, finishReason: 'STOP' }], usageMetadata: {} });
  return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return null; } }, text: function () { return Promise.resolve(body); }, json: function () { return Promise.resolve(JSON.parse(body)); } });
};
(async function () {
  try {
    var r = await G.callGeminiJson('p', SCHEMA, { retry: false, timeoutMs: 2000 });
    check('Gemini is sent no empty choice', seen && enumsOf(seen.generationConfig.responseSchema).every(function (e) { return e.indexOf('') === -1; }), seen && seen.generationConfig);
    check('…and its "(none)" comes back as ""', r && r.parsed && r.parsed.goTo === '' && r.parsed.name === 'ok', r);
  } finally { global.fetch = realFetch; }
  /* the routes' own schemas: the site editor's and the events side's hold empty choices, and none reaches Gemini */
  var api = require('./api'), bot = require('./dash-bot');
  var editSchema = api._testHooks && api._testHooks.chatResponseSchema ? api._testHooks.chatResponseSchema({ sections: [{ id: 'hero' }], canMakePictures: true }) : null;
  var botSchema = bot._test && bot._test.SCHEMA;
  [['the site editor', editSchema], ['the events side', botSchema]].forEach(function (c) {
    if (!c[1]) { check(c[0] + '\'s schema is reachable from the test', false); return; }
    var had = enumsOf(c[1]).some(function (e) { return e.indexOf('') !== -1; });
    var sent = enumsOf(G.forGemini(c[1])).every(function (e) { return e.indexOf('') === -1; });
    check(c[0] + ': its schema has empty choices, and none is sent to Gemini', had && sent, { had: had, sent: sent });
  });
  console.log('gemini-schema: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
