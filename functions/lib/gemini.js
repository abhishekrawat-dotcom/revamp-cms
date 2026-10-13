/* The one client for Google's Gemini API.

     callGeminiJson(prompt, schema, opts)  ->  Promise<{ parsed } | failure>
     callGeminiImage(prompt, opts)         ->  Promise<{ mimeType, base64 } | failure>
     failure = { error, status, code, retryable, timeoutMs? }       (these never reject)

   opts: { inlineFile: { mimeType, data (base64) }, timeoutMs = 60000, retry = true, deadlineAt (ms epoch),
           maxOutputTokens, route, eventId, user }      — route / eventId / user only label the log line.

   `error` is a sentence fit to show an event owner; `status` is what the route should answer with; `code`
   tells the page which failure it was, so it never has to guess from the wording:
     ai-quota 429 · ai-config 503 · ai-rejected 502 · ai-unavailable 502 · ai-timeout 504 (with timeoutMs)
     ai-blocked 422 · ai-bad-output 502
   `retryable` says whether the same request may succeed if the person tries again later.

   Every call costs money, so a failure is repeated at most once and only when the provider cannot have
   done the work: the connection failed before any answer, or it answered 500 / 503. A timeout, a quota or
   key error, a refusal, a safety block or an unusable answer is never sent a second time.

   What the provider said is written to the server log and never returned. Each call logs one line with
   its route, event, outcome, duration, prompt size and token counts. */

var GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';
var GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
var GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

var DEFAULT_TIMEOUT_MS = 60000;
var RETRY_PAUSE_MS = 1500;
var INLINE_FILE_TYPES = ['application/pdf', 'text/plain'];

var FAILURES = {
  'ai-quota': { status: 429, retryable: true, error: 'The AI service is at its limit right now. Try again in a few minutes.' },
  'ai-config': { status: 503, retryable: false, error: 'AI features are not set up on this server. Tell the Revamp team.' },
  'ai-rejected': { status: 502, retryable: false, error: 'The AI service could not take this request. Tell the Revamp team.' },
  'ai-unavailable': { status: 502, retryable: true, error: 'The AI service is not answering right now. Try again in a minute.' },
  'ai-timeout': { status: 504, retryable: true, error: 'This took too long and was stopped - nothing was changed. Try again.' },
  'ai-blocked': { status: 422, retryable: false, error: 'The AI could not work with this content. Try rewording the brief.' },
  'ai-bad-output': { status: 502, retryable: true, error: 'The AI gave an answer we could not use. Try again.' }
};

function failure(code, extra) {
  var f = FAILURES[code];
  return Object.assign({ error: f.error, status: f.status, code: code, retryable: f.retryable }, extra || {});
}

function apiBase() { return (process.env.GEMINI_API_BASE || GEMINI_API_BASE).replace(/\/+$/, ''); }

function failureForStatus(status) {
  if (status === 429) return 'ai-quota';
  if (status === 401 || status === 403) return 'ai-config';
  if (status === 400 || status === 404) return 'ai-rejected';
  return 'ai-unavailable';
}

/* One HTTP exchange. -> { data, usage } on a 200 with a JSON body, otherwise { code, upstreamStatus, detail, before } —
   `before` is true when nothing came back at all (so the provider did no billable work). */
function post(model, body, apiKey, timeoutMs) {
  var controller = new AbortController();
  var timedOut = false, answered = false;
  var timer = setTimeout(function () { timedOut = true; controller.abort(); }, timeoutMs);
  return fetch(apiBase() + '/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: controller.signal
  }).then(function (res) {
    answered = true;
    return res.text().then(function (text) {
      if (!res.ok) return { code: failureForStatus(res.status), upstreamStatus: res.status, detail: text.slice(0, 600) };
      var data;
      try { data = JSON.parse(text); } catch (e) { return { code: 'ai-bad-output', upstreamStatus: res.status, detail: 'the response body was not JSON' }; }
      return { data: data, usage: (data && data.usageMetadata) || null };
    });
  }).catch(function (err) {
    if (timedOut) return { code: 'ai-timeout', detail: 'no complete answer within ' + timeoutMs + ' ms' };
    return { code: 'ai-unavailable', before: !answered, detail: String((err && err.cause && err.cause.code) || (err && err.message) || err).slice(0, 200) };
  }).finally(function () { clearTimeout(timer); });
}

function mayRetry(result, opts, timeoutMs) {
  if (opts.retry === false) return false;
  var providerHiccup = result.upstreamStatus === 500 || result.upstreamStatus === 503;
  if (!(providerHiccup || (result.code === 'ai-unavailable' && result.before))) return false;
  if (opts.deadlineAt && Date.now() + RETRY_PAUSE_MS + timeoutMs > opts.deadlineAt) return false;
  return true;
}

function logCall(kind, opts, started, attempts, promptChars, outcome) {
  var usage = outcome.usage || {};
  var line = {
    at: 'gemini', kind: kind, route: opts.route || '', eventId: opts.eventId || '', user: opts.user || '',
    code: outcome.code || 'ok', ms: Date.now() - started, attempts: attempts, promptChars: promptChars,
    promptTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0,
    thoughtTokens: usage.thoughtsTokenCount || 0, totalTokens: usage.totalTokenCount || 0
  };
  if (outcome.code) {
    if (outcome.upstreamStatus) line.upstreamStatus = outcome.upstreamStatus;
    if (outcome.detail) line.detail = outcome.detail;
    console.error(JSON.stringify(line));
  } else {
    console.log(JSON.stringify(line));
  }
}

/* The shared exchange: the key, the timeout that leaves room before deadlineAt, the one permitted retry,
   the log line. `read(data)` turns a 200 into the caller's result or a { code, detail }. */
function call(kind, model, body, promptChars, opts, read) {
  var started = Date.now();
  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logCall(kind, opts, started, 0, promptChars, { code: 'ai-config', detail: 'GEMINI_API_KEY is not set' });
    return Promise.resolve(failure('ai-config'));
  }
  var timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  if (opts.deadlineAt) timeoutMs = Math.min(timeoutMs, opts.deadlineAt - Date.now());
  if (timeoutMs < 1000) {
    logCall(kind, opts, started, 0, promptChars, { code: 'ai-timeout', detail: 'no time left before the deadline' });
    return Promise.resolve(failure('ai-timeout', { timeoutMs: opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS }));
  }

  function attempt(n) {
    return post(model, body, apiKey, timeoutMs).then(function (result) {
      if (result.code && n === 1 && mayRetry(result, opts, timeoutMs)) {
        return new Promise(function (resolve) { setTimeout(resolve, RETRY_PAUSE_MS + Math.floor(Math.random() * 500)); })
          .then(function () { return attempt(2); });
      }
      var outcome = result.code ? result : read(result.data);
      if (outcome.code) {
        logCall(kind, opts, started, n, promptChars, Object.assign({ usage: result.usage }, outcome));
        return failure(outcome.code, outcome.code === 'ai-timeout' ? { timeoutMs: timeoutMs } : null);
      }
      logCall(kind, opts, started, n, promptChars, { usage: result.usage });
      return outcome;
    });
  }
  return attempt(1);
}

/* Why a 200 carries nothing usable, or "" when it carries a candidate that finished normally. */
function unusableReason(data) {
  var feedback = data && data.promptFeedback;
  if (feedback && feedback.blockReason) return { code: 'ai-blocked', detail: 'promptFeedback.blockReason ' + feedback.blockReason };
  var candidate = data && data.candidates && data.candidates[0];
  if (!candidate) return { code: 'ai-bad-output', detail: 'no candidate in the response' };
  var reason = String(candidate.finishReason || '');
  if (/^(SAFETY|RECITATION|PROHIBITED_CONTENT|BLOCKLIST|SPII|IMAGE_SAFETY)$/.test(reason)) return { code: 'ai-blocked', detail: 'finishReason ' + reason };
  if (reason === 'MAX_TOKENS') return { code: 'ai-bad-output', detail: 'finishReason MAX_TOKENS (the answer was cut off)' };
  return null;
}

function callGeminiJson(prompt, schema, opts) {
  opts = opts || {};
  var parts = [{ text: String(prompt) }];
  if (opts.inlineFile) {
    var type = String(opts.inlineFile.mimeType || '').split(';')[0].trim().toLowerCase();
    /* a caller's mistake, not a user's: images and other binaries are never sent to the model */
    if (INLINE_FILE_TYPES.indexOf(type) === -1) throw new Error('callGeminiJson: inlineFile must be a PDF or plain text, not "' + type + '".');
    parts.push({ inlineData: { mimeType: type, data: opts.inlineFile.data } });
  }
  var generationConfig = { responseMimeType: 'application/json', responseSchema: schema };
  if (opts.maxOutputTokens > 0) generationConfig.maxOutputTokens = opts.maxOutputTokens;

  return call('json', GEMINI_TEXT_MODEL, { contents: [{ parts: parts }], generationConfig: generationConfig }, String(prompt).length, opts, function (data) {
    var bad = unusableReason(data);
    if (bad) return bad;
    var content = data.candidates[0].content;
    var text = ((content && content.parts) || []).filter(function (p) { return p && typeof p.text === 'string' && !p.thought; })
      .map(function (p) { return p.text; }).join('');
    if (!text.trim()) return { code: 'ai-bad-output', detail: 'the candidate had no text' };
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { code: 'ai-bad-output', detail: 'the model text was not JSON (' + text.length + ' characters)' }; }
    if (!parsed || typeof parsed !== 'object') return { code: 'ai-bad-output', detail: 'the model text was JSON but not an object' };
    return { parsed: parsed };
  });
}

function callGeminiImage(prompt, opts) {
  opts = opts || {};
  var body = { contents: [{ parts: [{ text: String(prompt) }] }], generationConfig: { responseModalities: ['IMAGE'] } };
  return call('image', GEMINI_IMAGE_MODEL, body, String(prompt).length, opts, function (data) {
    var bad = unusableReason(data);
    if (bad) return bad;
    var content = data.candidates[0].content;
    var image = ((content && content.parts) || []).filter(function (p) { return p && p.inlineData && p.inlineData.data; })[0];
    if (!image) return { code: 'ai-bad-output', detail: 'the candidate had no image' };
    return { mimeType: image.inlineData.mimeType || 'image/png', base64: image.inlineData.data };
  });
}

module.exports = { callGeminiJson, callGeminiImage, GEMINI_TEXT_MODEL, GEMINI_IMAGE_MODEL };
