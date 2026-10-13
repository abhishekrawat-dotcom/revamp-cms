/* node functions/lib/gemini.test.js — exits 1 on the first failure it lists.
   A local server stands in for the provider (GEMINI_API_BASE); nothing here reaches Google or costs money. */

const http = require('http');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

var script = [], seen = [];
function answerWith(text, finishReason, usage) {
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: text }] }, finishReason: finishReason || 'STOP' }], usageMetadata: usage || { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 } } };
}
var stub = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    seen.push({ url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
    var step = script.shift() || { status: 500, body: { error: { message: 'script exhausted' } } };
    if (step.hang) return;                                   // never answers
    if (step.drop) return req.socket.destroy();              // connection lost before any answer
    res.writeHead(step.status, { 'Content-Type': 'application/json' });
    res.end(typeof step.body === 'string' ? step.body : JSON.stringify(step.body));
  });
});

var logged = [];
var realLog = console.log, realError = console.error;
function captureLogs() { console.log = console.error = function (line) { logged.push(String(line)); }; }
function releaseLogs() { console.log = realLog; console.error = realError; }

var SCHEMA = { type: 'OBJECT', properties: { a: { type: 'STRING' } } };
var LEAKS = /Gemini API error|RESOURCE_EXHAUSTED|GEMINI_API_KEY|firebase functions:secrets|test-key-123|generativelanguage/;

async function run() {
  await new Promise(function (r) { stub.listen(0, '127.0.0.1', r); });
  process.env.GEMINI_API_BASE = 'http://127.0.0.1:' + stub.address().port;
  process.env.GEMINI_API_KEY = 'test-key-123';
  const { callGeminiJson, callGeminiImage, GEMINI_TEXT_MODEL, GEMINI_IMAGE_MODEL } = require('./gemini');

  async function scenario(label, steps, opts, expect) {
    script = steps.slice(); seen = []; logged = [];
    captureLogs();
    var started = Date.now(), r;
    try { r = await callGeminiJson('prompt text', SCHEMA, Object.assign({ route: 'test-route', eventId: 'qa-x', user: 'u@example.com' }, opts || {})); }
    finally { releaseLogs(); }
    var ms = Date.now() - started;
    ok(seen.length === expect.requests, label + ': ' + expect.requests + ' upstream request(s)', 'saw ' + seen.length);
    if (expect.code) {
      ok(r.code === expect.code && r.status === expect.status && typeof r.error === 'string' && r.error.length > 10 && !r.parsed, label + ': answers ' + expect.status + ' ' + expect.code, JSON.stringify(r));
      ok(r.retryable === expect.retryable, label + ': retryable is ' + expect.retryable, JSON.stringify(r));
    } else {
      ok(r.parsed && r.parsed.a === 'b' && !r.error, label + ': succeeds', JSON.stringify(r));
    }
    ok(!LEAKS.test(JSON.stringify(r)), label + ': nothing of the provider or the key in the result', JSON.stringify(r));
    var lines = logged.filter(function (l) { return /"at":"gemini"/.test(l); });
    ok(lines.length === 1, label + ': one log line', logged.join(' || '));
    var line = lines.length ? JSON.parse(lines[0]) : {};
    ok(line.route === 'test-route' && line.eventId === 'qa-x' && line.user === 'u@example.com' && line.code === (expect.code || 'ok') && typeof line.ms === 'number' && line.promptChars === 11,
      label + ': the log line names route, event, user, outcome, duration and prompt size', lines[0]);
    ok(logged.join('').indexOf('test-key-123') === -1, label + ': the key is not logged');
    return { r: r, ms: ms, line: line };
  }

  var s;
  s = await scenario('success', [answerWith('{"a":"b"}')], null, { requests: 1 });
  ok(s.line.promptTokens === 11 && s.line.outputTokens === 7 && s.line.totalTokens === 18, 'success: token counts are logged', JSON.stringify(s.line));
  ok(seen[0].key === 'test-key-123' && seen[0].url.indexOf('key=') === -1 && seen[0].url.indexOf('test-key-123') === -1, 'the key travels in the x-goog-api-key header, not the URL', seen[0].url);
  ok(seen[0].url === '/v1beta/models/' + GEMINI_TEXT_MODEL + ':generateContent', 'the text model constant is used', seen[0].url);
  ok(seen[0].body.generationConfig.responseMimeType === 'application/json' && seen[0].body.generationConfig.maxOutputTokens === undefined, 'no maxOutputTokens unless asked');

  await scenario('quota (429)', [{ status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } } }], null, { requests: 1, status: 429, code: 'ai-quota', retryable: true });
  await scenario('bad request (400)', [{ status: 400, body: { error: { message: 'Invalid JSON payload' } } }], null, { requests: 1, status: 502, code: 'ai-rejected', retryable: false });
  await scenario('retired model (404)', [{ status: 404, body: { error: { message: 'models/x is not found' } } }], null, { requests: 1, status: 502, code: 'ai-rejected', retryable: false });
  await scenario('bad key (403)', [{ status: 403, body: { error: { message: 'API key not valid' } } }], null, { requests: 1, status: 503, code: 'ai-config', retryable: false });
  await scenario('bad key (401)', [{ status: 401, body: '{}' }], null, { requests: 1, status: 503, code: 'ai-config', retryable: false });
  await scenario('safety block (promptFeedback)', [{ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }], null, { requests: 1, status: 422, code: 'ai-blocked', retryable: false });
  await scenario('safety block (finishReason)', [answerWith('', 'SAFETY')], null, { requests: 1, status: 422, code: 'ai-blocked', retryable: false });
  await scenario('recitation', [answerWith('{"a":', 'RECITATION')], null, { requests: 1, status: 422, code: 'ai-blocked', retryable: false });
  await scenario('cut off (MAX_TOKENS)', [answerWith('{"a":"b', 'MAX_TOKENS')], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('text that is not JSON', [answerWith('Sure! Here is your JSON')], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('empty candidate', [{ status: 200, body: { candidates: [] } }], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('a body that is not JSON', [{ status: 200, body: '<html>gateway</html>' }], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('bad gateway (502)', [{ status: 502, body: 'bad gateway' }], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });

  s = await scenario('hung response', [{ hang: true }], { timeoutMs: 1200 }, { requests: 1, status: 504, code: 'ai-timeout', retryable: true });
  ok(s.r.timeoutMs === 1200, 'hung response: the answer carries timeoutMs', JSON.stringify(s.r));
  ok(s.ms >= 1150 && s.ms < 2300, 'hung response: ends at the timeout, not at double (' + s.ms + ' ms)');

  s = await scenario('503 then 200', [{ status: 503, body: { error: { message: 'overloaded' } } }, answerWith('{"a":"b"}')], null, { requests: 2 });
  ok(s.ms >= 1400, '503 then 200: paused before the second request (' + s.ms + ' ms)');
  ok(s.line.attempts === 2, '503 then 200: the log says two attempts', JSON.stringify(s.line));
  await scenario('500 then 200', [{ status: 500, body: '{}' }, answerWith('{"a":"b"}')], null, { requests: 2 });
  await scenario('dropped connection then 200', [{ drop: true }, answerWith('{"a":"b"}')], null, { requests: 2 });
  await scenario('503 twice', [{ status: 503, body: '{}' }, { status: 503, body: '{}' }], null, { requests: 2, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('503 with retry: false', [{ status: 503, body: '{}' }, answerWith('{"a":"b"}')], { retry: false }, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('503 with no room before the deadline', [{ status: 503, body: '{}' }, answerWith('{"a":"b"}')], { timeoutMs: 5000, deadlineAt: Date.now() + 5500 }, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('deadline already passed', [answerWith('{"a":"b"}')], { deadlineAt: Date.now() + 200 }, { requests: 0, status: 504, code: 'ai-timeout', retryable: true });

  script = [answerWith('{"a":"b"}')]; seen = []; captureLogs();
  try { await callGeminiJson('p', SCHEMA, { maxOutputTokens: 4096, inlineFile: { mimeType: 'application/pdf', data: 'JVBERg==' } }); } finally { releaseLogs(); }
  ok(seen[0].body.generationConfig.maxOutputTokens === 4096, 'maxOutputTokens is sent when given');
  ok(seen[0].body.contents[0].parts.length === 2 && seen[0].body.contents[0].parts[1].inlineData.mimeType === 'application/pdf', 'a PDF travels as a second part');
  script = [answerWith('{"a":"b"}')]; seen = []; captureLogs();
  try { await callGeminiJson('p', SCHEMA, { inlineFile: { mimeType: 'text/plain; charset=utf-8', data: 'aGk=' } }); } finally { releaseLogs(); }
  ok(seen.length === 1 && seen[0].body.contents[0].parts[1].inlineData.mimeType === 'text/plain', 'plain text is accepted, parameters stripped');
  ['image/png', 'image/jpeg', 'application/zip', ''].forEach(function (type) {
    var threw = false; seen = [];
    try { callGeminiJson('p', SCHEMA, { inlineFile: { mimeType: type, data: 'AAAA' } }); } catch (e) { threw = true; }
    ok(threw && seen.length === 0, 'an inline file of type "' + type + '" is refused before any request');
  });

  /* image */
  script = [{ status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }] }, finishReason: 'STOP' }] } }]; seen = []; captureLogs();
  var img; try { img = await callGeminiImage('a background', { route: 'plan-structure' }); } finally { releaseLogs(); }
  ok(img.base64 === 'iVBORw0KGgo=' && img.mimeType === 'image/png' && seen[0].url === '/v1beta/models/' + GEMINI_IMAGE_MODEL + ':generateContent', 'image: returns the picture from the image model', JSON.stringify(img).slice(0, 120));
  script = [{ status: 429, body: '{}' }]; seen = []; captureLogs();
  try { img = await callGeminiImage('a background'); } finally { releaseLogs(); }
  ok(img.code === 'ai-quota' && img.status === 429 && seen.length === 1, 'image: quota is one request and ai-quota', JSON.stringify(img));
  script = [{ status: 200, body: { candidates: [{ content: { parts: [{ text: 'no image for you' }] }, finishReason: 'STOP' }] } }]; seen = []; captureLogs();
  try { img = await callGeminiImage('a background'); } finally { releaseLogs(); }
  ok(img.code === 'ai-bad-output' && seen.length === 1, 'image: an answer without a picture is ai-bad-output', JSON.stringify(img));

  /* pictures for the text model, a picture to edit, and who answered */
  script = [answerWith('{"a":"b"}')]; seen = []; captureLogs();
  var withPics; try { withPics = await callGeminiJson('p', SCHEMA, { inlineFile: { mimeType: 'application/pdf', data: 'JVBERg==' }, images: [{ mimeType: 'image/png', data: 'iVBORw0KGgo=' }, { mimeType: 'IMAGE/JPEG; q=1', data: '/9j/4AAQ' }] }); } finally { releaseLogs(); }
  var sentParts = seen[0].body.contents[0].parts;
  ok(sentParts.length === 4 && sentParts[0].text === 'p' && sentParts[1].inlineData.mimeType === 'application/pdf' && sentParts[2].inlineData.mimeType === 'image/png' && sentParts[2].inlineData.data === 'iVBORw0KGgo=' && sentParts[3].inlineData.mimeType === 'image/jpeg',
    'pictures travel as inlineData parts after the text and the file', JSON.stringify(sentParts));
  ok(withPics.parsed.a === 'b' && withPics.provider === 'gemini' && withPics.model === GEMINI_TEXT_MODEL, 'a text answer says which provider and model gave it', JSON.stringify(withPics));
  [[{ mimeType: 'image/svg+xml', data: 'AAAA' }], [{ mimeType: 'application/pdf', data: 'AAAA' }], [{ mimeType: 'image/png' }],
    [1, 2, 3, 4, 5, 6, 7].map(function () { return { mimeType: 'image/png', data: 'AAAA' }; })].forEach(function (images, i) {
    var threw = false; seen = [];
    try { callGeminiJson('p', SCHEMA, { images: images }); } catch (e) { threw = true; }
    ok(threw && seen.length === 0, 'pictures: bad set ' + (i + 1) + ' is refused before any request');
  });
  script = [answerWith('{"a":"b"}')]; seen = []; captureLogs();
  try { await callGeminiJson('p', SCHEMA, { images: [1, 2, 3, 4, 5, 6].map(function () { return { mimeType: 'image/webp', data: 'AAAA' }; }) }); } finally { releaseLogs(); }
  ok(seen.length === 1 && seen[0].body.contents[0].parts.length === 7, 'six pictures are allowed');

  script = [{ status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZWRpdGVk' } }] }, finishReason: 'STOP' }] } }]; seen = []; captureLogs();
  try { img = await callGeminiImage('make the sky darker', { image: { mimeType: 'image/jpeg', data: '/9j/4AAQ' } }); } finally { releaseLogs(); }
  var editParts = seen[0].body.contents[0].parts;
  ok(editParts.length === 2 && editParts[0].text === 'make the sky darker' && editParts[1].inlineData.mimeType === 'image/jpeg' && editParts[1].inlineData.data === '/9j/4AAQ',
    'image: a picture to edit travels next to the words', JSON.stringify(editParts));
  ok(img.base64 === 'ZWRpdGVk' && img.mimeType === 'image/png' && img.provider === 'gemini' && img.model === GEMINI_IMAGE_MODEL, 'image: same answer shape, with provider and model', JSON.stringify(img));
  var threwEdit = false; seen = [];
  try { callGeminiImage('p', { image: { mimeType: 'application/pdf', data: 'AAAA' } }); } catch (e) { threwEdit = true; }
  ok(threwEdit && seen.length === 0, 'image: a file that is not a picture is refused before any request');
  script = [{ status: 429, body: '{}' }]; seen = []; captureLogs();
  var failed; try { failed = await callGeminiJson('p', SCHEMA, {}); } finally { releaseLogs(); }
  ok(failed.code === 'ai-quota' && failed.provider === 'gemini' && !failed.model, 'a failure says which provider failed', JSON.stringify(failed));

  /* no key */
  delete process.env.GEMINI_API_KEY; seen = []; captureLogs();
  var nokey; try { nokey = await callGeminiJson('p', SCHEMA, {}); } finally { releaseLogs(); }
  ok(nokey.status === 503 && nokey.code === 'ai-config' && seen.length === 0 && !LEAKS.test(nokey.error) && /not set up on this server/.test(nokey.error), 'without a key: 503 ai-config, a plain sentence, no request', JSON.stringify(nokey));

  ok(require('./gemini').DEFAULT_TIMEOUT_MS === 60000, 'the default timeout is exported (llm.js asks whether a fallback still fits)');

  stub.closeAllConnections && stub.closeAllConnections();
  stub.close();
  if (failures.length) {
    console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
    failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
    process.exit(1);
  }
  console.log('gemini: all ' + checks + ' checks passed');
  process.exit(0);
}
run().catch(function (e) { releaseLogs(); console.error('gemini test crashed: ' + (e && e.stack || e)); process.exit(1); });
