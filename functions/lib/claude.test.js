/* node functions/lib/claude.test.js — exits 1 on the first failure it lists.
   A local server stands in for the provider (ANTHROPIC_API_BASE) and speaks its event stream, cut into
   awkward pieces; nothing here reaches Anthropic or costs money. */

const http = require('http');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

function sse(events) {
  return events.map(function (e) { return 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n'; }).join('');
}
/* a whole answer the way the provider streams it: thinking first, then the text in three deltas */
function answerWith(text, stopReason) {
  var a = Math.floor(text.length / 3), b = Math.floor(2 * text.length / 3);
  return { status: 200, events: [
    { type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [], usage: { input_tokens: 21, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '{"a":"WRONG, this is a thought"}' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'c2lnbmF0dXJl' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'ping' },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(0, a) } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(a, b) } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"not":"the answer"}' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(b) } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: stopReason || 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } },
    { type: 'message_stop' }
  ] };
}

var script = [], seen = [], held = [];
var stub = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    seen.push({ url: req.url, method: req.method, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || '{}'), at: Date.now() });
    var step = script.shift() || { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'script exhausted' } } };
    if (step.hang) { held.push(res); return; }               // never answers
    if (step.drop) return req.socket.destroy();              // connection lost before any answer
    if (step.body !== undefined) {
      return setTimeout(function () {                        // `delay`: an answer that takes its time
        res.writeHead(step.status, { 'Content-Type': 'application/json' });
        res.end(typeof step.body === 'string' ? step.body : JSON.stringify(step.body));
      }, step.delay || 0);
    }
    var events = step.events || [];
    if (step.midStreamError) {
      events = answerWith('{"a":"b"}').events.slice(0, 8).concat([{ type: 'error', error: step.midStreamError }]);
    }
    /* the stream, a few bytes at a time: events, lines and even letters are cut in the middle */
    var bytes = Buffer.from(step.raw !== undefined ? step.raw : sse(events));
    var size = step.chunk || 7, at = 0;
    res.writeHead(step.status || 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    (function next() {
      if (at >= bytes.length) { if (step.stall) held.push(res); else if (step.cut) req.socket.destroy(); else res.end(); return; }
      res.write(bytes.subarray(at, at + size)); at += size;
      setImmediate(next);
    })();
  });
});

var logged = [];
var realLog = console.log, realError = console.error;
function captureLogs() { console.log = console.error = function (line) { logged.push(String(line)); }; }
function releaseLogs() { console.log = realLog; console.error = realError; }

var SCHEMA = { type: 'OBJECT', properties: { a: { type: 'STRING', description: 'a word', minLength: 1, maxLength: 80 } }, required: ['a'], propertyOrdering: ['a'] };
var KEY = 'sk-test-key-456';
/* the result goes to the browser: no provider name, host, key, env var or raw provider wording in it
   (the lower-case provider / model labels are ours and are meant to be there) */
var LEAKS = /[Aa]nthropic|ANTHROPIC|Claude|sk-test-key-456|x-api-key|127\.0\.0\.1|overloaded|rate_limit|invalid_request|credit balance|script exhausted/;

async function run() {
  await new Promise(function (r) { stub.listen(0, '127.0.0.1', r); });
  process.env.ANTHROPIC_API_BASE = 'http://127.0.0.1:' + stub.address().port + '/';
  process.env.ANTHROPIC_API_KEY = KEY;
  const { callClaudeJson, claudeConfigured, toJsonSchema, CLAUDE_OPUS, CLAUDE_SONNET } = require('./claude');

  ok(CLAUDE_OPUS === 'claude-opus-5-5' && CLAUDE_SONNET === 'claude-sonnet-5-5', 'the two model ids');
  ok(claudeConfigured() === true, 'configured when a key is set');

  async function scenario(label, steps, opts, expect) {
    script = steps.slice(); seen = []; logged = [];
    captureLogs();
    var started = Date.now(), r;
    try { r = await callClaudeJson('prompt text', SCHEMA, Object.assign({ route: 'test-route', eventId: 'qa-x', user: 'u@example.com' }, opts || {})); }
    finally { releaseLogs(); }
    var ms = Date.now() - started;
    ok(seen.length === expect.requests, label + ': ' + expect.requests + ' upstream request(s)', 'saw ' + seen.length);
    if (expect.code) {
      ok(r.code === expect.code && r.status === expect.status && typeof r.error === 'string' && r.error.length > 10 && !r.parsed, label + ': answers ' + expect.status + ' ' + expect.code, JSON.stringify(r));
      ok(r.retryable === expect.retryable, label + ': retryable is ' + expect.retryable, JSON.stringify(r));
      ok(r.provider === 'claude' && r.upstreamStatus === undefined && r.detail === undefined && r.model === undefined, label + ': the failure names the provider and carries nothing the provider said', JSON.stringify(r));
      ok(!LEAKS.test(JSON.stringify(r)), label + ': nothing of the provider or the key in the result', JSON.stringify(r));
    } else {
      ok(r.parsed && r.parsed.a === 'b' && !r.error && !r.code, label + ': succeeds', JSON.stringify(r));
      ok(r.provider === 'claude' && r.model === (expect.model || CLAUDE_SONNET) && Object.keys(r).sort().join() === 'model,parsed,provider', label + ': the answer is { parsed, provider, model }', JSON.stringify(r));
    }
    var lines = logged.filter(function (l) { return /"at":"claude"/.test(l); });
    ok(lines.length === 1 && logged.length === 1, label + ': one log line', logged.join(' || '));
    var line = lines.length ? JSON.parse(lines[0]) : {};
    ok(line.kind === 'json' && line.route === 'test-route' && line.eventId === 'qa-x' && line.user === 'u@example.com' && line.code === (expect.code || 'ok') && typeof line.ms === 'number' && line.promptChars === 11
      && line.model === (expect.model || CLAUDE_SONNET) && line.mode === (expect.mode || 'strict') && line.attempts === (expect.attempts === undefined ? expect.requests : expect.attempts),
    label + ': the log line names route, event, user, model, mode, outcome, duration, attempts and prompt size', lines[0]);
    ok(logged.join('').indexOf(KEY) === -1, label + ': the key is not logged');
    return { r: r, ms: ms, line: line };
  }

  var s;
  /* happy path and the shape of the request */
  s = await scenario('success', [answerWith('{"a":"b"}')], null, { requests: 1 });
  ok(s.line.promptTokens === 21 && s.line.outputTokens === 9, 'success: token counts are logged', JSON.stringify(s.line));
  var q = seen[0];
  ok(q.method === 'POST' && q.url === '/v1/messages', 'the request is POST /v1/messages (a trailing slash on the base is dropped)', q.method + ' ' + q.url);
  ok(q.headers['x-api-key'] === KEY && q.headers['anthropic-version'] === '2023-06-01' && /^application\/json/.test(q.headers['content-type']) && q.url.indexOf(KEY) === -1, 'the key, the API version and the content type travel as headers');
  ok(q.body.model === CLAUDE_SONNET && q.body.stream === true && q.body.max_tokens === 16000, 'default model, streaming, default max_tokens', JSON.stringify(q.body).slice(0, 200));
  ok(q.body.thinking && q.body.thinking.type === 'adaptive' && Object.keys(q.body.thinking).length === 1 && q.body.output_config.effort === 'low', 'adaptive thinking and low effort by default', JSON.stringify(q.body.output_config));
  var format = q.body.output_config.format;
  ok(format.type === 'json_schema' && JSON.stringify(format.schema) === JSON.stringify({ type: 'object', properties: { a: { type: 'string', description: 'a word' } }, required: ['a'], additionalProperties: false }),
    'the schema is sent as closed, lower-cased JSON Schema', JSON.stringify(format));
  ok(q.body.messages.length === 1 && q.body.messages[0].role === 'user' && q.body.messages[0].content.length === 1 && q.body.messages[0].content[0].type === 'text' && q.body.messages[0].content[0].text === 'prompt text',
    'one user turn holding the prompt', JSON.stringify(q.body.messages));
  ok(q.body.temperature === undefined && q.body.top_p === undefined && q.body.tools === undefined && q.body.system === undefined, 'nothing else is sent');

  /* the file, the pictures, then the words; model, effort and size as asked */
  s = await scenario('pdf + pictures', [answerWith('{"a":"b"}')],
    { model: CLAUDE_OPUS, effort: 'medium', maxOutputTokens: 20000, inlineFile: { mimeType: 'application/pdf', data: 'JVBERg==' }, images: [{ mimeType: 'image/png', data: 'iVBORw0KGgo=' }, { mimeType: 'IMAGE/JPEG', data: '/9j/4AAQ' }] },
    { requests: 1, model: CLAUDE_OPUS });
  var blocks = seen[0].body.messages[0].content;
  ok(blocks.length === 4 && blocks[0].type === 'document' && blocks[0].source.type === 'base64' && blocks[0].source.media_type === 'application/pdf' && blocks[0].source.data === 'JVBERg=='
    && blocks[1].type === 'image' && blocks[1].source.type === 'base64' && blocks[1].source.media_type === 'image/png' && blocks[1].source.data === 'iVBORw0KGgo=' && blocks[2].source.media_type === 'image/jpeg'
    && blocks[3].type === 'text' && blocks[3].text === 'prompt text', 'document, pictures, then the prompt last', JSON.stringify(blocks));
  ok(seen[0].body.model === CLAUDE_OPUS && seen[0].body.output_config.effort === 'medium' && seen[0].body.max_tokens === 20000, 'model, effort and max_tokens as asked');
  await scenario('plain-text file', [answerWith('{"a":"b"}')], { inlineFile: { mimeType: 'text/plain; charset=utf-8', data: Buffer.from('Brief: café at 9').toString('base64') } }, { requests: 1 });
  blocks = seen[0].body.messages[0].content;
  ok(blocks.length === 2 && blocks[0].type === 'text' && blocks[0].text === '<document>\nBrief: café at 9\n</document>' && blocks[1].text === 'prompt text', 'plain text is decoded and wrapped in <document>', JSON.stringify(blocks));
  await scenario('an unknown effort', [answerWith('{"a":"b"}')], { effort: 'ludicrous' }, { requests: 1 });
  ok(seen[0].body.output_config.effort === 'low', 'an effort we do not know is sent as low');
  [{ inlineFile: { mimeType: 'image/png', data: 'AAAA' } }, { inlineFile: { mimeType: '', data: 'AAAA' } }, { images: [{ mimeType: 'image/svg+xml', data: 'AAAA' }] }, { images: [{ mimeType: 'image/png' }] },
    { images: [1, 2, 3, 4, 5, 6, 7].map(function () { return { mimeType: 'image/png', data: 'AAAA' }; }) }].forEach(function (bad, i) {
    var threw = false; seen = [];
    try { callClaudeJson('p', SCHEMA, bad); } catch (e) { threw = true; }
    ok(threw && seen.length === 0, 'a caller\'s mistake (' + (i + 1) + ') throws before any request');
  });

  /* how the stream is cut must not matter */
  for (var size of [1, 3, 64, 100000]) {
    await scenario('stream in ' + size + '-byte pieces', [Object.assign(answerWith('{"a":"b"}'), { chunk: size })], null, { requests: 1 });
  }
  script = [Object.assign(answerWith('{"a":"b","note":"naïve — ₹5 \\"quoted\\"\\nline"}'), { chunk: 1 })]; seen = []; captureLogs();
  var uni; try { uni = await callClaudeJson('p', SCHEMA, {}); } finally { releaseLogs(); }
  ok(uni.parsed && uni.parsed.note === 'naïve — ₹5 "quoted"\nline', 'letters of more than one byte survive being cut in half', JSON.stringify(uni));
  var crlf = ': a comment the provider may send\r\n\r\n'
    + 'event: message_start\r\ndata: {"type":"message_start",\r\ndata: "message":{"usage":{"input_tokens":5}}}\r\n\r\n'
    + 'event: content_block_delta\r\ndata:{"type":"content_block_delta","index":0,\r\ndata:"delta":{"type":"text_delta","text":"{\\"a\\":"}}\r\n\r\n'
    + 'event: something_new\r\ndata: {"type":"something_new","x":1}\r\n\r\n'
    + 'event: broken\r\ndata: {not json\r\n\r\n'
    + 'event: content_block_delta\r\nid: 7\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\\"b\\"}"}}\r\n\r\n'
    + 'event: message_delta\r\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\r\n\r\n'
    + 'event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n';
  s = await scenario('CRLF lines, data on several lines, unknown events', [{ status: 200, raw: crlf, chunk: 5 }], null, { requests: 1 });
  ok(s.line.promptTokens === 5 && s.line.outputTokens === 4, 'CRLF stream: token counts are read', JSON.stringify(s.line));
  await scenario('no blank line after the last event', [{ status: 200, raw: sse(answerWith('{"a":"b"}').events).replace(/\n\n$/, ''), chunk: 9 }], null, { requests: 1 });
  await scenario('a 200 that is one JSON body, not a stream', [{ status: 200, body: { type: 'message', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: '{"a":"b"}' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } } }], null, { requests: 1 });

  /* every refusal by status */
  function err(type, message) { return { type: 'error', error: { type: type, message: message || 'Anthropic says no: ' + type } }; }
  await scenario('quota (429)', [{ status: 429, body: err('rate_limit_error') }], null, { requests: 1, status: 429, code: 'ai-quota', retryable: true });
  await scenario('bad key (401)', [{ status: 401, body: err('authentication_error', 'invalid x-api-key') }], null, { requests: 1, status: 503, code: 'ai-config', retryable: false });
  await scenario('no access (403)', [{ status: 403, body: err('permission_error') }], null, { requests: 1, status: 503, code: 'ai-config', retryable: false });
  await scenario('retired model (404)', [{ status: 404, body: err('not_found_error', 'model: claude-x') }], null, { requests: 1, status: 502, code: 'ai-rejected', retryable: false });
  await scenario('too large (413)', [{ status: 413, body: err('request_too_large') }], null, { requests: 1, status: 502, code: 'ai-rejected', retryable: false });
  await scenario('bad gateway (502)', [{ status: 502, body: '<html>bad gateway</html>' }], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('gateway timeout (504)', [{ status: 504, body: err('timeout_error') }], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('conflict (409)', [{ status: 409, body: err('conflict_error') }], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  s = await scenario('quota: what the provider said', [{ status: 429, body: err('rate_limit_error', 'Your credit balance is too low ' + KEY) }], null, { requests: 1, status: 429, code: 'ai-quota', retryable: true });
  ok(s.line.upstreamStatus === 429 && /credit balance/.test(s.line.detail) && s.line.detail.length <= 600, 'a failure logs the upstream status and what was said', JSON.stringify(s.line));

  /* an error inside a stream that began with 200 */
  await scenario('overloaded mid-stream', [{ midStreamError: { type: 'overloaded_error', message: 'Overloaded' } }], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('api error mid-stream', [{ midStreamError: { type: 'api_error', message: 'Internal' } }], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('rate limit mid-stream', [{ midStreamError: { type: 'rate_limit_error', message: 'slow down' } }], null, { requests: 1, status: 429, code: 'ai-quota', retryable: true });
  s = await scenario('invalid request mid-stream', [{ midStreamError: { type: 'invalid_request_error', message: 'nope' } }], null, { requests: 1, status: 502, code: 'ai-rejected', retryable: false });
  ok(/invalid_request_error nope/.test(s.line.detail), 'mid-stream error: the log says which', JSON.stringify(s.line));
  await scenario('stream cut off half way', [{ status: 200, events: answerWith('{"a":"b"}').events.slice(0, 9), cut: true }], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('stream that ends without finishing', [{ status: 200, events: answerWith('{"a":"b"}').events.slice(0, 9) }], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });

  /* a 200 with nothing usable */
  await scenario('refusal', [answerWith('I cannot help with that.', 'refusal')], null, { requests: 1, status: 422, code: 'ai-blocked', retryable: false });
  await scenario('cut off (max_tokens)', [answerWith('{"a":"b', 'max_tokens')], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('text that is not JSON', [answerWith('Sure! Here is your JSON')], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('strict mode is not lenient', [answerWith('```json\n{"a":"b"}\n```')], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('an array, not an object', [answerWith('[{"a":"b"}]')], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('JSON that is not an object', [answerWith('"just a string"')], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('only thinking, no text', [{ status: 200, events: answerWith('').events }], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });

  /* time */
  s = await scenario('hung response', [{ hang: true }], { timeoutMs: 1200 }, { requests: 1, status: 504, code: 'ai-timeout', retryable: true });
  ok(s.r.timeoutMs === 1200, 'hung response: the answer carries timeoutMs', JSON.stringify(s.r));
  ok(s.ms >= 1150 && s.ms < 2300, 'hung response: ends at the timeout, not at double (' + s.ms + ' ms)');
  s = await scenario('stream that stalls half way', [{ status: 200, events: answerWith('{"a":"b"}').events.slice(0, 9), stall: true }], { timeoutMs: 1200 }, { requests: 1, status: 504, code: 'ai-timeout', retryable: true });
  ok(s.ms >= 1150 && s.ms < 2300, 'stalled stream: the timeout covers the whole exchange (' + s.ms + ' ms)');
  s = await scenario('deadline sooner than the timeout', [{ hang: true }], { timeoutMs: 60000, deadlineAt: Date.now() + 1300 }, { requests: 1, status: 504, code: 'ai-timeout', retryable: true });
  ok(s.ms >= 1200 && s.ms < 2400, 'deadline: the exchange ends at the deadline (' + s.ms + ' ms)');
  s = await scenario('deadline already passed', [answerWith('{"a":"b"}')], { deadlineAt: Date.now() + 200 }, { requests: 0, status: 504, code: 'ai-timeout', retryable: true });
  ok(s.r.timeoutMs === 120000, 'deadline already passed: timeoutMs is the default', JSON.stringify(s.r));

  /* the one retry */
  s = await scenario('529 then 200', [{ status: 529, body: err('overloaded_error') }, answerWith('{"a":"b"}')], null, { requests: 2 });
  ok(seen[1].at - seen[0].at >= 1450, '529 then 200: paused before the second request (' + (seen[1].at - seen[0].at) + ' ms)');
  ok(JSON.stringify(seen[0].body) === JSON.stringify(seen[1].body), '529 then 200: the same request is sent again');
  await scenario('500 then 200', [{ status: 500, body: err('api_error') }, answerWith('{"a":"b"}')], null, { requests: 2 });
  await scenario('503 then 200', [{ status: 503, body: '{}' }, answerWith('{"a":"b"}')], null, { requests: 2 });
  await scenario('dropped connection then 200', [{ drop: true }, answerWith('{"a":"b"}')], null, { requests: 2 });
  await scenario('529 twice', [{ status: 529, body: '{}' }, { status: 529, body: '{}' }, answerWith('{"a":"b"}')], null, { requests: 2, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('529 with retry: false', [{ status: 529, body: '{}' }, answerWith('{"a":"b"}')], { retry: false }, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('529 with no room before the deadline', [{ status: 529, body: '{}' }, answerWith('{"a":"b"}')], { timeoutMs: 5000, deadlineAt: Date.now() + 5500 }, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('429 is not retried', [{ status: 429, body: '{}' }, answerWith('{"a":"b"}')], null, { requests: 1, status: 429, code: 'ai-quota', retryable: true });
  await scenario('a mid-stream overload is not retried', [{ midStreamError: { type: 'overloaded_error', message: 'Overloaded' } }, answerWith('{"a":"b"}')], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('a timeout is not retried', [{ hang: true }, answerWith('{"a":"b"}')], { timeoutMs: 1100 }, { requests: 1, status: 504, code: 'ai-timeout', retryable: true });

  /* strict refused -> plain */
  var refused = { status: 400, body: err('invalid_request_error', 'output_config.format: Extra inputs are not permitted') };
  s = await scenario('strict 400 then plain', [refused, answerWith('Here you go:\n```json\n{"a":"b"}\n```\nAnything else?')],
    { inlineFile: { mimeType: 'application/pdf', data: 'JVBERg==' }, images: [{ mimeType: 'image/webp', data: 'UklGRg==' }], model: CLAUDE_OPUS, maxOutputTokens: 5000 },
    { requests: 2, mode: 'plain', model: CLAUDE_OPUS });
  var strict = seen[0].body, plain = seen[1].body;
  ok(strict.thinking && strict.output_config && plain.thinking === undefined && plain.output_config === undefined, 'plain: no thinking and no output_config in the second request', JSON.stringify(Object.keys(plain)));
  ok(plain.model === CLAUDE_OPUS && plain.stream === true && plain.max_tokens === 5000, 'plain: same model, still a stream, same max_tokens');
  var wanted = 'prompt text\n\nReply with ONE JSON object only — no prose, no code fence — that matches this JSON Schema exactly:\n' + JSON.stringify(toJsonSchema(SCHEMA));
  ok(plain.messages[0].content.length === 3 && plain.messages[0].content[0].type === 'document' && plain.messages[0].content[1].type === 'image' && plain.messages[0].content[2].text === wanted,
    'plain: the same file and picture, and the schema written into the prompt', JSON.stringify(plain.messages[0].content[2]));
  ok(seen[1].at - seen[0].at < 1000, 'plain: no pause before it (' + (seen[1].at - seen[0].at) + ' ms)');
  ok(/Extra inputs/.test(s.line.strictRefusal || ''), 'plain: the log keeps what the refusal of the strict request said', JSON.stringify(s.line));
  await scenario('plain: prose around the object', [refused, answerWith('Sure. {"a":"b"} Hope that helps.')], null, { requests: 2, mode: 'plain' });
  await scenario('plain: bare JSON', [refused, answerWith('{"a":"b"}')], null, { requests: 2, mode: 'plain' });
  await scenario('strict 400 then plain 400', [refused, { status: 400, body: err('invalid_request_error', 'prompt is too long') }, answerWith('{"a":"b"}')], null, { requests: 2, mode: 'plain', status: 502, code: 'ai-rejected', retryable: false });
  await scenario('strict 400 then plain not JSON', [refused, answerWith('I am not able to produce that.')], null, { requests: 2, mode: 'plain', status: 502, code: 'ai-bad-output', retryable: true });
  await scenario('strict 400 then plain 529 (plain is tried once)', [refused, { status: 529, body: '{}' }, answerWith('{"a":"b"}')], null, { requests: 2, mode: 'plain', status: 502, code: 'ai-unavailable', retryable: true });
  await scenario('529, then strict 400, then plain', [{ status: 529, body: '{}' }, refused, answerWith('{"a":"b"}')], null, { requests: 3, mode: 'plain' });
  await scenario('strict 400 with no time left for plain', [Object.assign({ delay: 700 }, refused), answerWith('{"a":"b"}')], { deadlineAt: Date.now() + 1500 }, { requests: 1, status: 502, code: 'ai-rejected', retryable: false });
  await scenario('404 is not a reason for plain', [{ status: 404, body: err('not_found_error') }, answerWith('{"a":"b"}')], null, { requests: 1, status: 502, code: 'ai-rejected', retryable: false });

  /* one budget for the whole call: the retry and the plain attempt get what is left of it, not a fresh timeout */
  s = await scenario('a late 500 leaves no time for a retry', [{ status: 500, body: err('api_error'), delay: 1800 }, { hang: true }], { timeoutMs: 2000 }, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  ok(s.ms < 2300, 'late 500: the call ends inside its timeout (' + s.ms + ' ms)');
  s = await scenario('500, then a retry that hangs', [{ status: 500, body: err('api_error'), delay: 100 }, { hang: true }], { timeoutMs: 4500 }, { requests: 2, status: 504, code: 'ai-timeout', retryable: true });
  ok(s.ms >= 4400 && s.ms < 5200, 'retry that hangs: both attempts end inside the ONE timeout (' + s.ms + ' ms)');
  ok(s.r.timeoutMs === 4500, 'retry that hangs: timeoutMs is the whole call\'s', JSON.stringify(s.r));
  s = await scenario('a late strict 400 leaves no time for plain', [Object.assign({ delay: 700 }, refused), { hang: true }], { timeoutMs: 1500 }, { requests: 1, status: 502, code: 'ai-rejected', retryable: false });
  s = await scenario('strict 400, then a plain attempt that hangs', [Object.assign({ delay: 300 }, refused), { hang: true }], { timeoutMs: 2000 }, { requests: 2, mode: 'plain', status: 504, code: 'ai-timeout', retryable: true });
  ok(s.ms >= 1900 && s.ms < 2600, 'plain that hangs: ends inside the one timeout (' + s.ms + ' ms)');

  /* plain mode: an answer that is JSON already is taken as it is, whatever its strings hold */
  var withFence = JSON.stringify({ a: 'b', note: 'Use it like:\n```html\n<div>x</div>\n```\ndone' });
  for (var shape of [['valid JSON whose string holds a code fence', withFence], ['a fenced answer whose string holds a fence', '```json\n' + withFence + '\n```'],
    ['a fence named javascript', '```javascript\n{"a":"b"}\n```'], ['a bare fence', '  ```\n{"a":"b"}\n```  \n'], ['prose, a fence, and a fence inside a string', 'Here you go:\n```json\n' + withFence + '\n```\nAnything else?'],
    ['an array holding the object', '[{"a":"b"}]']]) {
    s = await scenario('plain: ' + shape[0], [refused, answerWith(shape[1])], null, { requests: 2, mode: 'plain' });
    if (shape[1].indexOf('<div>') !== -1) ok(s.r.parsed && s.r.parsed.note === 'Use it like:\n```html\n<div>x</div>\n```\ndone', 'plain: ' + shape[0] + ' — the string is whole', JSON.stringify(s.r));
  }
  await scenario('plain: a string, not an object', [refused, answerWith('"just a string"')], null, { requests: 2, mode: 'plain', status: 502, code: 'ai-bad-output', retryable: true });

  /* the key is cut out BEFORE the text is shortened, so no part of it is left at the cut */
  s = await scenario('a refusal that quotes the key at the cut', [{ status: 401, body: new Array(591).join('x') + KEY }], null, { requests: 1, status: 503, code: 'ai-config', retryable: false });
  ok(s.line.detail.length <= 600 && s.line.detail.indexOf('sk-') === -1 && /\[key\]$/.test(s.line.detail), 'key at the cut: no part of the key in the log', s.line.detail.slice(-40));
  s = await scenario('a mid-stream error that quotes the key at the cut', [{ midStreamError: { type: 'api_error', message: new Array(566).join('y') + KEY } }], null, { requests: 1, status: 502, code: 'ai-unavailable', retryable: true });
  ok(s.line.detail.length <= 600 && s.line.detail.indexOf('sk-') === -1 && s.line.detail.indexOf('[key]') !== -1, 'key at the cut, mid-stream: no part of the key in the log', s.line.detail.slice(-40));
  s = await scenario('a strict refusal that quotes the key at the cut', [{ status: 400, body: new Array(291).join('z') + KEY }, answerWith('{"a":"b"}')], null, { requests: 2, mode: 'plain' });
  ok(s.line.strictRefusal.length <= 300 && s.line.strictRefusal.indexOf('sk-') === -1, 'key at the cut, strict refusal: no part of the key in the log', s.line.strictRefusal.slice(-40));

  /* an answer that is finished is kept, whatever follows it (or does not) */
  var finished = answerWith('{"a":"b"}').events.slice(0, 13);                // up to the message_delta that carries stop_reason
  s = await scenario('finished, but message_stop never comes', [{ status: 200, events: finished, stall: true }], { timeoutMs: 1500 }, { requests: 1 });
  ok(s.ms < 1000, 'no message_stop: the answer is returned at once (' + s.ms + ' ms)');
  ok(s.line.outputTokens === 9, 'no message_stop: the token count that came with stop_reason is logged', JSON.stringify(s.line));
  await scenario('finished, and the stream just ends', [{ status: 200, events: finished }], null, { requests: 1 });
  await scenario('finished, then an error', [{ status: 200, events: finished.concat([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, { type: 'message_stop' }]), chunk: 100000 }], null, { requests: 1 });
  await scenario('finished as a refusal, no message_stop', [{ status: 200, events: answerWith('No.', 'refusal').events.slice(0, 13), stall: true }], { timeoutMs: 1500 }, { requests: 1, status: 422, code: 'ai-blocked', retryable: false });

  /* a 200 JSON body whose content is not a list of blocks */
  s = await scenario('a JSON body with content that is not a list', [{ status: 200, body: { content: 'hello', stop_reason: 'end_turn' } }], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });
  ok(!/is not a function/.test(s.line.detail || ''), 'content not a list: read, not crashed on', JSON.stringify(s.line));
  await scenario('a JSON body with no content', [{ status: 200, body: { stop_reason: 'end_turn' } }], null, { requests: 1, status: 502, code: 'ai-bad-output', retryable: true });

  /* toJsonSchema */
  var given = { type: 'OBJECT', description: 'top', nullable: true, propertyOrdering: ['list', 'n'], required: ['list'], properties: {
    list: { type: 'ARRAY', minItems: 1, maxItems: 9, items: { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: ['A', 'B'], format: 'enum', pattern: '^[AB]$' }, on: { type: 'BOOLEAN' } }, required: ['kind'] } },
    n: { type: 'INTEGER', minimum: 0, maximum: 5 }, x: { type: 'NUMBER', description: 'a number' }, type: { type: 'STRING', minLength: 2, maxLength: 3 } } };
  var before = JSON.stringify(given);
  var made = toJsonSchema(given);
  ok(JSON.stringify(given) === before, 'toJsonSchema does not change what it is given');
  ok(JSON.stringify(made) === JSON.stringify({ type: 'object', description: 'top', required: ['list'], properties: {
    list: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['A', 'B'] }, on: { type: 'boolean' } }, required: ['kind'], additionalProperties: false } },
    n: { type: 'integer' }, x: { type: 'number', description: 'a number' }, type: { type: 'string' } }, additionalProperties: false }),
  'toJsonSchema: lower-cased types, limits dropped, every object closed, a property NAMED type or format kept', JSON.stringify(made));
  made.required.push('zz'); made.properties.list.items.properties.kind.enum.push('C');
  ok(JSON.stringify(given) === before, 'toJsonSchema: the copy shares nothing with the original');
  ok(toJsonSchema(null) === null && toJsonSchema(undefined) === undefined && JSON.stringify(toJsonSchema({ type: 'object', properties: { format: { type: 'string' } } })) === '{"type":"object","properties":{"format":{"type":"string"}},"additionalProperties":false}',
    'toJsonSchema: nothing in, nothing out; a schema already in JSON Schema passes through');

  ok(JSON.stringify(toJsonSchema({ type: 'OBJECT' })) === '{"type":"object"}' && JSON.stringify(toJsonSchema({ type: 'OBJECT', properties: { any: { type: 'OBJECT', description: 'free' }, none: { type: 'OBJECT', properties: {} } } }))
    === '{"type":"object","properties":{"any":{"type":"object","description":"free"},"none":{"type":"object","properties":{},"additionalProperties":false}},"additionalProperties":false}',
  'toJsonSchema: an object with no properties stays free-form (closing it would allow only {})', JSON.stringify(toJsonSchema({ type: 'OBJECT' })));

  /* no key */
  delete process.env.ANTHROPIC_API_KEY; seen = []; logged = []; captureLogs();
  var nokey; try { nokey = await callClaudeJson('p', SCHEMA, {}); } finally { releaseLogs(); }
  ok(nokey.status === 503 && nokey.code === 'ai-config' && nokey.provider === 'claude' && seen.length === 0 && !LEAKS.test(JSON.stringify(nokey)) && /not set up on this server/.test(nokey.error), 'without a key: 503 ai-config, a plain sentence, no request', JSON.stringify(nokey));
  ok(logged.length === 1 && JSON.parse(logged[0]).attempts === 0, 'without a key: one log line, no attempts', logged.join(' || '));
  ok(claudeConfigured() === false, 'not configured without a key');

  held.forEach(function (res) { try { res.destroy(); } catch (e) {} });
  stub.closeAllConnections && stub.closeAllConnections();
  stub.close();
  if (failures.length) {
    console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
    failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
    process.exit(1);
  }
  console.log('claude: all ' + checks + ' checks passed');
  process.exit(0);
}
run().catch(function (e) { releaseLogs(); console.error('claude test crashed: ' + (e && e.stack || e)); process.exit(1); });
