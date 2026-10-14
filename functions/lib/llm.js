/* The one door to a text model. Routes ask here; which provider answers is this file's business.

     callJson(prompt, schema, opts)  ->  Promise<{ parsed, provider, model } | failure>      (never rejects)
     activeProvider()                ->  'claude' | 'gemini'      who is asked first, read per call
     describeModels()                ->  { text, provider }       a label for tools that print the model
     PROFILES                        ->  per route: which Claude model, how much effort, how long, how much
     LIMITS                          ->  { budgetMs, fallbackNeedsMs }: how long one call may take in all

   Claude is asked first when its key is set (and LLM_PROVIDER is not 'gemini'); Gemini is the fallback.
   Without the key, or with LLM_PROVIDER=gemini, this is callGeminiJson and nothing else.

   opts are exactly what callGeminiJson takes (inlineFile, images, timeoutMs, retry, deadlineAt,
   maxOutputTokens, route, eventId, user). timeoutMs / maxOutputTokens / retry are GEMINI's numbers and go
   to Gemini untouched; Claude gets the route's PROFILE instead, because the two models take different
   times and count tokens differently. The file, the pictures, deadlineAt and the log labels go to both.

   ONE DEADLINE FOR BOTH. The function that runs a route is stopped at 240 s (functions/index.js), and a
   request stopped there never gets its failure sentence. So a call that names no deadlineAt is given one
   here — LIMITS.budgetMs from the moment it starts — and both providers work inside it: Claude's timeout
   and Gemini's are each cut to what is left. The budget is counted from the start of THIS call; a route
   that works for long before it, or asks more than once in a row, must pass its own deadlineAt.

   When Claude fails, the same request goes to Gemini, and what Gemini says (an answer or its own failure)
   is returned with fellBack: true and firstCode: <why Claude failed>. Two exceptions, where Claude's
   failure is returned as it is:
     - under 5 seconds are left before the deadline: no time for a second model;
     - Claude TIMED OUT and Gemini's own timeout (opts.timeoutMs, else its default) no longer fits before
       the deadline: the time is spent, and a second model cut short would be paid for and lost as well.

   Env, read per call:  LLM_PROVIDER=gemini  ·  CLAUDE_MODEL (all routes)  ·  CLAUDE_MODEL_<ROUTE>, e.g.
   CLAUDE_MODEL_PLAN_STRUCTURE (one route; it wins over CLAUDE_MODEL). */

const { callGeminiJson, GEMINI_TEXT_MODEL, DEFAULT_TIMEOUT_MS: GEMINI_DEFAULT_TIMEOUT_MS } = require('./gemini');
const { callClaudeJson, claudeConfigured, CLAUDE_OPUS, CLAUDE_SONNET, CLAUDE_HAIKU } = require('./claude');

/* budgetMs: 15 s under the function's 240 s, for what the route does before and after. An object, so a
   test can shorten it (as with PROFILES). */
var LIMITS = { budgetMs: 225000, fallbackNeedsMs: 5000 };

var PROFILES = {
/* The times leave room for Gemini's own timeout inside the budget (plan 60 s, section code 100 s, redesign
   90 s), so that a Claude call that runs out of time can still be answered by the fallback. The output
   allowances include the model's own thinking, which cannot be switched off: none of them is small. */
  'plan-structure': { model: CLAUDE_OPUS, effort: 'medium', timeoutMs: 120000, maxOutputTokens: 20000 },
  /* effort 'low': the section code is most of what a site costs, and most of that was Opus thinking */
  'generate-content': { model: CLAUDE_OPUS, effort: 'low', timeoutMs: 120000, maxOutputTokens: 28000 },
  'redesign-section': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 120000, maxOutputTokens: 28000 },
  'chat-edit': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 75000, maxOutputTokens: 12000 },
  'suggest-design': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 75000, maxOutputTokens: 12000 },
  /* reading a brief or a page is extraction, not design: Haiku, at a twentieth of Sonnet's price */
  'extract-brief': { model: CLAUDE_HAIKU, effort: 'low', timeoutMs: 90000, maxOutputTokens: 12000 },
  'ingest-source': { model: CLAUDE_HAIKU, effort: 'low', timeoutMs: 75000, maxOutputTokens: 12000 },
  'logo-unit': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 45000, maxOutputTokens: 6000 },
  /* a caption, five subject lines, a paragraph: short copy from a fact sheet (lib/promo.js) */
  'promo-write': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 60000, maxOutputTokens: 6000 },
  'default': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 75000, maxOutputTokens: 12000 }
};

function activeProvider() {
  return claudeConfigured() && process.env.LLM_PROVIDER !== 'gemini' ? 'claude' : 'gemini';
}

/* the route's profile, with the model the environment asks for (one route beats all routes) */
function profileFor(route) {
  var known = route && route !== 'default' && Object.prototype.hasOwnProperty.call(PROFILES, route);
  var profile = Object.assign({}, known ? PROFILES[route] : PROFILES['default']);
  var forRoute = route ? process.env['CLAUDE_MODEL_' + String(route).toUpperCase().replace(/[^A-Z0-9]+/g, '_')] : '';
  profile.model = forRoute || process.env.CLAUDE_MODEL || profile.model;
  return profile;
}

function describeModels() {
  if (activeProvider() === 'gemini') return { text: 'Gemini (' + GEMINI_TEXT_MODEL + ')', provider: 'gemini' };
  var models = [];
  Object.keys(PROFILES).forEach(function (route) {
    var model = profileFor(route).model;
    if (models.indexOf(model) === -1) models.push(model);
  });
  return { text: 'Claude (' + models.join(', ') + '), with Gemini (' + GEMINI_TEXT_MODEL + ') as the fallback', provider: 'claude' };
}

/* opts.onUsage(usage), when given, is told what each provider asked was used — Claude's attempt and
   Gemini's fallback each once — so a route can add it to the event's AI usage. It is never the reason a
   call fails. */
function report(opts, result) {
  if (typeof opts.onUsage !== 'function' || !result || !result.usage) return;
  try { opts.onUsage(result.usage); } catch (e) { console.error('llm: the usage could not be recorded — ' + (e && e.message)); }
}

function callJson(prompt, schema, opts) {
  opts = opts || {};
  if (activeProvider() === 'gemini') return callGeminiJson(prompt, schema, opts).then(function (r) { report(opts, r); return r; });

  var profile = profileFor(opts.route);
  var deadlineAt = opts.deadlineAt > 0 ? opts.deadlineAt : Date.now() + LIMITS.budgetMs;
  return callClaudeJson(prompt, schema, {
    model: profile.model, effort: profile.effort, timeoutMs: profile.timeoutMs, maxOutputTokens: profile.maxOutputTokens,
    inlineFile: opts.inlineFile, images: opts.images, deadlineAt: deadlineAt,
    route: opts.route, eventId: opts.eventId, user: opts.user
  }).then(function (first) {
    report(opts, first);
    if (!first.code) return first;
    var left = deadlineAt - Date.now();
    if (left < LIMITS.fallbackNeedsMs) return first;
    if (first.code === 'ai-timeout' && left < (opts.timeoutMs > 0 ? opts.timeoutMs : GEMINI_DEFAULT_TIMEOUT_MS)) return first;
    return callGeminiJson(prompt, schema, Object.assign({}, opts, { deadlineAt: deadlineAt })).then(function (second) {
      report(opts, second);
      console.log(JSON.stringify({ at: 'llm', route: opts.route || '', eventId: opts.eventId || '', provider: 'gemini', fellBack: true, firstCode: first.code, code: second.code || 'ok' }));
      return Object.assign(second, { fellBack: true, firstCode: first.code });
    });
  });
}

module.exports = { callJson, activeProvider, describeModels, PROFILES, LIMITS };
