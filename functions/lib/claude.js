/* The one client for Anthropic's Claude (the Messages API), for text that must come back as JSON.

     callClaudeJson(prompt, schema, opts)  ->  Promise<{ parsed, provider: 'claude', model } | failure>
     failure = { error, status, code, retryable, timeoutMs?, provider: 'claude' }       (this never rejects)
     claudeConfigured()                    ->  true when a key is set on this server
     toJsonSchema(schema)                  ->  the schema our prompts are written with (Gemini's dialect:
                                               OBJECT / STRING / …) as the JSON Schema this provider takes

   opts: { model = CLAUDE_SONNET, effort = 'low' | 'medium' | 'high', inlineFile: { mimeType, data (base64) },
           images: [{ mimeType, data (base64) }], timeoutMs = 120000, retry = true, deadlineAt (ms epoch),
           maxOutputTokens = 16000, route, eventId, user }     — route / eventId / user only label the log line.

   The failures are gemini.js's own (same codes, statuses and sentences, built by its failure()), so a page
   cannot tell which provider failed and llm.js can hand a request from one to the other.

   The answer is read as a stream: a long answer keeps the connection alive for minutes, and a plain
   request that long is cut by the proxies in between. The timeout covers the WHOLE CALL, from the first
   connection to the last byte of the last attempt: the retry and the plain attempt below are given what is
   left of it, never a fresh one. An answer is finished when its stop_reason arrives; nothing after that
   (an error, a connection that stays open) can take it away.

   Every call costs money, so a failure is repeated at most once and only when the provider cannot have
   done the work: the connection failed before any answer, or it answered 500 / 503 / 529 — and only while
   at least half of the call's time is still left. A timeout, a quota or key error, a refusal or an
   unusable answer is never sent a second time.

   PLAIN MODE. The structured-output and thinking parameters could not be verified against the live API
   when this was written (there was no key to try them with). A refusal of them must not cost the request,
   so a strict request answered with HTTP 400 is sent ONCE more without them, the schema written into the
   prompt instead, and that answer is read leniently (taken as it is when it is JSON already; otherwise a
   code fence or a sentence around the object is cut away). A 400 for any other reason costs one more
   refused request, which is not billed.

   What the provider said is written to the server log and never returned. Each call logs one line with
   its route, event, model, mode, outcome, duration, prompt size and token counts (and, in plain mode, what
   the refusal of the strict request said). The key is never logged: it is cut out of anything the
   provider said BEFORE that text is shortened, so no part of it survives at the cut. */

const { failure, RETRY_PAUSE_MS, IMAGE_TYPES, MAX_IMAGES } = require('./gemini');

var CLAUDE_API_BASE = 'https://api.anthropic.com';
var CLAUDE_API_VERSION = '2023-06-01';
var CLAUDE_OPUS = 'claude-opus-5-5';
var CLAUDE_SONNET = 'claude-sonnet-5-5';
var CLAUDE_HAIKU = 'claude-haiku-5-5';

/* List prices in US dollars per million tokens (platform.claude.com/docs/en/about-claude/pricing, read
   2026-10-14): base input, output, cache write (5 minutes), cache read. Thinking is billed as output.
   Haiku 5.5 costs more once a prompt passes 100,000 tokens (`over`). Used only to REPORT what a call
   cost — never to decide anything — so a price change makes a report stale, not a request wrong. */
var PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01, over: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 } }
};
/* -> what tokens of that model cost, in dollars; null for a model with no price here */
function costUsd(model, usage) {
  var price = PRICES[model];
  if (!price || !usage) return null;
  var prompt = (usage.input || 0) + (usage.cacheWrite || 0) + (usage.cacheRead || 0);
  if (price.over && prompt > 100000) price = price.over;
  var usd = ((usage.input || 0) * price.input + (usage.output || 0) * price.output +
    (usage.cacheWrite || 0) * price.cacheWrite + (usage.cacheRead || 0) * price.cacheRead) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

var DEFAULT_TIMEOUT_MS = 120000;
var DEFAULT_MAX_OUTPUT_TOKENS = 16000;
var RETRY_JITTER_MS = 500;
var INLINE_FILE_TYPES = ['application/pdf', 'text/plain'];
var EFFORTS = ['low', 'medium', 'high'];
/* what Gemini's schema dialect allows and this provider's structured output refuses */
var SCHEMA_DROP = ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'format', 'nullable', 'propertyOrdering'];
var PLAIN_ASK = '\n\nReply with ONE JSON object only — no prose, no code fence — that matches this JSON Schema exactly:\n';

function apiBase() { return (process.env.ANTHROPIC_API_BASE || CLAUDE_API_BASE).replace(/\/+$/, ''); }
function claudeConfigured() { return !!process.env.ANTHROPIC_API_KEY; }

function lowerType(t) { return typeof t === 'string' ? t.toLowerCase() : Array.isArray(t) ? t.map(lowerType) : t; }

/* A deep copy, never the caller's object: type names lower-cased, the unsupported limits dropped, and
   every object that lists its properties closed (additionalProperties: false), which this provider
   requires. An object with no `properties` is free-form to Gemini and is left open: closed, it would
   allow only {}. (If the provider refuses it open, that is a 400 and the request goes out in plain mode.) */
function toJsonSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  var out = {};
  Object.keys(schema).forEach(function (key) {
    var value = schema[key];
    if (SCHEMA_DROP.indexOf(key) !== -1) return;
    if (key === 'type') out.type = lowerType(value);
    else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = {};
      Object.keys(value).forEach(function (name) { out.properties[name] = toJsonSchema(value[name]); });
    }
    else if (key === 'items' || key === 'anyOf') out[key] = toJsonSchema(value);
    else out[key] = (value && typeof value === 'object') ? JSON.parse(JSON.stringify(value)) : value;   // required, enum, description
  });
  if (out.properties) out.additionalProperties = false;
  return out;
}

function failureForStatus(status) {
  if (status === 429) return 'ai-quota';
  if (status === 401 || status === 403) return 'ai-config';
  if (status === 400 || status === 404 || status === 413) return 'ai-rejected';
  return 'ai-unavailable';
}

/* an error that arrives inside a stream that began with 200 */
function failureForErrorType(type) {
  if (type === 'rate_limit_error') return 'ai-quota';
  if (type === 'invalid_request_error' || type === 'request_too_large' || type === 'not_found_error') return 'ai-rejected';
  if (type === 'authentication_error' || type === 'permission_error') return 'ai-config';
  return 'ai-unavailable';                                   // overloaded_error, api_error, anything new
}

/* a provider may quote the request back; the key must not reach the log that way. Always BEFORE a cut. */
function scrub(text, apiKey) { return apiKey ? String(text).split(apiKey).join('[key]') : String(text); }

/* What the user's turn is made of: the file, the pictures, then the words LAST (the provider reads a
   document best when the question follows it). A wrong type is a caller's mistake and throws. */
function contentBlocks(promptText, opts) {
  var blocks = [];
  if (opts.inlineFile) {
    var type = String(opts.inlineFile.mimeType || '').split(';')[0].trim().toLowerCase();
    if (INLINE_FILE_TYPES.indexOf(type) === -1) throw new Error('callClaudeJson: inlineFile must be a PDF or plain text, not "' + type + '".');
    if (type === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: type, data: opts.inlineFile.data } });
    else blocks.push({ type: 'text', text: '<document>\n' + Buffer.from(String(opts.inlineFile.data || ''), 'base64').toString('utf8') + '\n</document>' });
  }
  if (opts.images && opts.images.length) {
    if (opts.images.length > MAX_IMAGES) throw new Error('callClaudeJson: at most ' + MAX_IMAGES + ' pictures, not ' + opts.images.length + '.');
    opts.images.forEach(function (image) {
      var type = String((image && image.mimeType) || '').split(';')[0].trim().toLowerCase();
      if (IMAGE_TYPES.indexOf(type) === -1) throw new Error('callClaudeJson: a picture must be PNG, JPEG, WebP or GIF, not "' + type + '".');
      if (!image.data || typeof image.data !== 'string') throw new Error('callClaudeJson: a picture needs its base64 data.');
      blocks.push({ type: 'image', source: { type: 'base64', media_type: type, data: image.data } });
    });
  }
  blocks.push({ type: 'text', text: promptText });
  return blocks;
}

/* Reads the event stream to its end. -> { text, stopReason, usage } or { code, upstreamStatus, detail, usage }.
   An event is the lines up to a blank line; its `data:` lines, joined, are one JSON object whose `type`
   says what it is. Events arrive cut anywhere, so nothing is read until its blank line has come.
   The answer is finished at the message_delta that carries stop_reason (the final token counts come with
   it): reading stops there, so a message_stop that never comes or an error after it changes nothing. */
/* `usage` is the caller's: an answer cut off (out of time, the connection dropped) has still been billed
   for what had been counted when it stopped, and the caller reports that */
function readStream(res, apiKey, usage) {
  var reader = res.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '', text = '', stopReason = '', stopped = false, error = null;
  usage = usage || { input: 0, output: 0 };

  function take(block) {
    var data = [];
    block.split(/\r\n|\r|\n/).forEach(function (line) {
      if (line.slice(0, 5) === 'data:') data.push(line.slice(5).replace(/^ /, ''));   // `event:`, `id:` and `:comment` lines carry nothing we need
    });
    if (!data.length) return;
    var event;
    try { event = JSON.parse(data.join('\n')); } catch (e) { return; }
    if (!event || typeof event !== 'object') return;
    if (event.type === 'message_start') {
      var first = event.message && event.message.usage;
      if (first && first.input_tokens > 0) usage.input = first.input_tokens;
      if (first && first.output_tokens > 0) usage.output = first.output_tokens;
      if (first && first.cache_creation_input_tokens > 0) usage.cacheWrite = first.cache_creation_input_tokens;
      if (first && first.cache_read_input_tokens > 0) usage.cacheRead = first.cache_read_input_tokens;
    } else if (event.type === 'content_block_delta') {
      /* only the answer's own words: thinking, its signature and any other kind of block are not the answer */
      if (event.delta && event.delta.type === 'text_delta' && typeof event.delta.text === 'string') text += event.delta.text;
    } else if (event.type === 'message_delta') {
      if (event.usage && event.usage.input_tokens > 0) usage.input = event.usage.input_tokens;
      if (event.usage && event.usage.output_tokens > 0) usage.output = event.usage.output_tokens;
      if (event.delta && event.delta.stop_reason) { stopReason = String(event.delta.stop_reason); stopped = true; }
    } else if (event.type === 'message_stop') {
      stopped = true;
    } else if (event.type === 'error') {
      var type = String((event.error && event.error.type) || '');
      error = { code: failureForErrorType(type), detail: scrub('in the stream: ' + type + ' ' + String((event.error && event.error.message) || ''), apiKey).slice(0, 600) };
    }
  }
  function drain(last) {
    var cut;
    while (!stopped && !error && (cut = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
      take(buffer.slice(0, cut.index));
      buffer = buffer.slice(cut.index + cut[0].length);
    }
    if (last && !stopped && !error && buffer.trim()) { take(buffer); buffer = ''; }
  }
  function result() {
    if (error) return Object.assign({ upstreamStatus: res.status, usage: usage }, error);
    if (!stopped) return { code: 'ai-unavailable', upstreamStatus: res.status, detail: 'the stream ended before the answer was finished (' + text.length + ' characters in)', usage: usage };
    return { text: text, stopReason: stopReason, usage: usage };
  }
  function pump() {
    return reader.read().then(function (step) {
      buffer += step.done ? decoder.decode() : decoder.decode(step.value, { stream: true });
      drain(step.done);
      if (step.done) return result();
      if (stopped || error) { reader.cancel().catch(function () {}); return result(); }
      return pump();
    });
  }
  return pump();
}

/* a 200 that is not a stream (a proxy that ignored `stream`): the whole message in one JSON body */
function readWhole(res) {
  return res.text().then(function (body) {
    var message;
    try { message = JSON.parse(body); } catch (e) { return { code: 'ai-bad-output', upstreamStatus: res.status, detail: 'the response body was neither a stream nor JSON' }; }
    var u = (message && message.usage) || {};
    var usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0 };
    var text = (message && Array.isArray(message.content) ? message.content : []).filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
      .map(function (b) { return b.text; }).join('');
    return { text: text, stopReason: String((message && message.stop_reason) || ''), usage: usage };
  });
}

/* One HTTP exchange, timed from connecting to the last byte. -> { text, stopReason, usage } on a 200,
   otherwise { code, upstreamStatus, detail, before } — `before` is true when nothing came back at all
   (so the provider did no billable work). */
function post(body, apiKey, timeoutMs) {
  var controller = new AbortController();
  var timedOut = false, answered = false, streamUsage = null;
  var timer = setTimeout(function () { timedOut = true; controller.abort(); }, timeoutMs);
  return fetch(apiBase() + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': CLAUDE_API_VERSION },
    body: JSON.stringify(body),
    signal: controller.signal
  }).then(function (res) {
    answered = true;
    if (!res.ok) {
      return res.text().then(function (text) { return { code: failureForStatus(res.status), upstreamStatus: res.status, detail: scrub(text, apiKey).slice(0, 600) }; });
    }
    var type = String(res.headers.get('content-type') || '');
    return (/json/i.test(type) || !res.body) ? readWhole(res) : readStream(res, apiKey, streamUsage = { input: 0, output: 0 });
  }).catch(function (err) {
    if (timedOut) return { code: 'ai-timeout', detail: 'no complete answer within ' + timeoutMs + ' ms', usage: streamUsage || undefined };
    return { code: 'ai-unavailable', before: !answered, detail: scrub((err && err.cause && err.cause.code) || (err && err.message) || err, apiKey).slice(0, 200), usage: streamUsage || undefined };
  }).finally(function () { clearTimeout(timer); });
}

/* `budgetMs` is the whole call's time and `leftMs` what remains of it. The retry is worth its pause only
   while at least half is left: a provider's hiccup comes at once, one that came late leaves no room. */
function mayRetry(result, opts, budgetMs, leftMs) {
  if (opts.retry === false) return false;
  var providerHiccup = result.upstreamStatus === 500 || result.upstreamStatus === 503 || result.upstreamStatus === 529;
  if (!(providerHiccup || (result.code === 'ai-unavailable' && result.before))) return false;
  if (opts.deadlineAt && Date.now() + RETRY_PAUSE_MS + budgetMs > opts.deadlineAt) return false;
  if (leftMs - RETRY_PAUSE_MS - RETRY_JITTER_MS < budgetMs / 2) return false;
  return true;
}

/* The answer's text as the caller's object, or why it cannot be one. Lenient only in plain mode, where
   nothing held the model to JSON. The text is tried AS IT IS first — an answer that is JSON already may
   hold a code fence or braces inside its strings (our answers carry HTML and CSS) and must not be cut.
   Only then: a fence that wraps the whole answer, a fence somewhere in it, the first { to the last }. */
function readAnswer(result, plain) {
  if (result.stopReason === 'refusal') return { code: 'ai-blocked', detail: 'stop_reason refusal' };
  if (result.stopReason === 'max_tokens') return { code: 'ai-bad-output', detail: 'stop_reason max_tokens (the answer was cut off)' };
  var text = String(result.text || '');
  if (!text.trim()) return { code: 'ai-bad-output', detail: 'the answer had no text' + (result.stopReason ? ' (stop_reason ' + result.stopReason + ')' : '') };
  var tries = [text];
  if (plain) {
    var wrapped = /^\s*```[a-z]*[ \t]*\r?\n([\s\S]*)\r?\n[ \t]*```\s*$/i.exec(text);
    var inside = /```[a-z]*\s*([\s\S]*?)```/i.exec(text);
    var open = text.indexOf('{'), close = text.lastIndexOf('}');
    tries = [text.trim()];
    if (wrapped) tries.push(wrapped[1]);
    if (open !== -1 && close > open) tries.push(text.slice(open, close + 1));
    if (inside) tries.push(inside[1]);
  }
  var wasJson = false;
  for (var i = 0; i < tries.length; i++) {
    var parsed;
    try { parsed = JSON.parse(tries[i]); } catch (e) { continue; }
    wasJson = true;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { parsed: parsed };
  }
  if (wasJson) return { code: 'ai-bad-output', detail: 'the model text was JSON but not an object' };
  return { code: 'ai-bad-output', detail: 'the model text was not JSON (' + text.length + ' characters)' };
}

function logCall(opts, model, mode, started, attempts, promptChars, outcome, apiKey) {
  var usage = outcome.usage || {};
  var line = {
    at: 'claude', kind: 'json', route: opts.route || '', eventId: opts.eventId || '', user: opts.user || '',
    model: model, mode: mode, code: outcome.code || 'ok', ms: Date.now() - started, attempts: attempts, promptChars: promptChars,
    promptTokens: usage.input || 0, outputTokens: usage.output || 0, costUsd: costUsd(model, usage)
  };
  function safe(detail, max) { return scrub(detail, apiKey).slice(0, max); }
  /* plain mode only: what the provider said when it refused the strict request, so the parameter at fault can be fixed */
  if (outcome.strictRefusal) line.strictRefusal = safe(outcome.strictRefusal, 300);
  if (outcome.code) {
    if (outcome.upstreamStatus) line.upstreamStatus = outcome.upstreamStatus;
    if (outcome.detail) line.detail = safe(outcome.detail, 600);
    console.error(JSON.stringify(line));
  } else {
    console.log(JSON.stringify(line));
  }
}

function callClaudeJson(prompt, schema, opts) {
  opts = opts || {};
  var promptText = String(prompt);
  var jsonSchema = toJsonSchema(schema);
  var model = opts.model || CLAUDE_SONNET;
  var effort = EFFORTS.indexOf(opts.effort) !== -1 ? opts.effort : 'low';
  var maxTokens = opts.maxOutputTokens > 0 ? opts.maxOutputTokens : DEFAULT_MAX_OUTPUT_TOKENS;
  var strictBlocks = contentBlocks(promptText, opts);               // throws on a caller's mistake, before anything is sent

  function bodyFor(mode) {
    if (mode === 'plain') {
      return { model: model, max_tokens: maxTokens, stream: true,
        messages: [{ role: 'user', content: contentBlocks(promptText + PLAIN_ASK + JSON.stringify(jsonSchema), opts) }] };
    }
    return { model: model, max_tokens: maxTokens, stream: true, thinking: { type: 'adaptive' },
      output_config: { effort: effort, format: { type: 'json_schema', schema: jsonSchema } },
      messages: [{ role: 'user', content: strictBlocks }] };
  }

  var started = Date.now();
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logCall(opts, model, 'strict', started, 0, promptText.length, { code: 'ai-config', detail: 'ANTHROPIC_API_KEY is not set' });
    return Promise.resolve(failure('ai-config', { provider: 'claude' }));
  }
  var fullTimeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  /* one budget for the whole call, counted from now: every attempt gets what is left of it */
  var budgetMs = opts.deadlineAt ? Math.min(fullTimeoutMs, opts.deadlineAt - started) : fullTimeoutMs;
  function timeLeft() { return started + budgetMs - Date.now(); }
  if (budgetMs < 1000) {
    logCall(opts, model, 'strict', started, 0, promptText.length, { code: 'ai-timeout', detail: 'no time left before the deadline' });
    return Promise.resolve(failure('ai-timeout', { timeoutMs: fullTimeoutMs, provider: 'claude' }));
  }

  var attempts = 0, strictRefusal = '';
  /* every attempt is billed, the refused and the retried ones too: what this call cost is their sum */
  var spent = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  function bill() {
    return { provider: 'claude', model: model, inputTokens: spent.input + spent.cacheWrite + spent.cacheRead, outputTokens: spent.output, usd: costUsd(model, spent) };
  }
  function attempt(mode, first) {
    var timeoutMs = timeLeft();
    attempts++;
    return post(bodyFor(mode), apiKey, timeoutMs).then(function (result) {
      var u = result.usage || {};
      spent.input += u.input || 0; spent.output += u.output || 0; spent.cacheWrite += u.cacheWrite || 0; spent.cacheRead += u.cacheRead || 0;
      if (result.code && first && mayRetry(result, opts, budgetMs, timeLeft())) {
        return new Promise(function (resolve) { setTimeout(resolve, RETRY_PAUSE_MS + Math.floor(Math.random() * RETRY_JITTER_MS)); })
          .then(function () { return attempt(mode, false); });
      }
      /* the strict request itself was refused: once more without the parameters that may be the reason */
      if (mode === 'strict' && result.upstreamStatus === 400 && timeLeft() >= 1000) {
        strictRefusal = String(result.detail || 'HTTP 400').slice(0, 300);     // the key is out of it already (post)
        return attempt('plain', false);
      }
      var outcome = result.code ? result : readAnswer(result, mode === 'plain');
      if (outcome.code) {
        logCall(opts, model, mode, started, attempts, promptText.length, Object.assign({ usage: spent, strictRefusal: strictRefusal }, outcome), apiKey);
        return failure(outcome.code, outcome.code === 'ai-timeout' ? { timeoutMs: budgetMs, provider: 'claude', usage: bill() } : { provider: 'claude', usage: bill() });
      }
      logCall(opts, model, mode, started, attempts, promptText.length, { usage: spent, strictRefusal: strictRefusal }, apiKey);
      return { parsed: outcome.parsed, provider: 'claude', model: model, usage: bill() };
    });
  }
  return attempt('strict', true).catch(function (err) {
    /* nothing above should throw; if it does, the caller still gets an answer it can show */
    logCall(opts, model, 'strict', started, attempts, promptText.length, { code: 'ai-unavailable', detail: 'client error: ' + String((err && err.message) || err), usage: spent }, apiKey);
    return failure('ai-unavailable', { provider: 'claude', usage: bill() });
  });
}

module.exports = { callClaudeJson, claudeConfigured, toJsonSchema, costUsd, PRICES, CLAUDE_OPUS, CLAUDE_SONNET, CLAUDE_HAIKU };
