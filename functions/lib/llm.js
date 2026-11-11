/* The one door to a text model. Routes ask here; which provider answers is this file's business.

     callJson(prompt, schema, opts)  ->  Promise<{ parsed, provider, model } | failure>      (never rejects)
     activeProvider()                ->  'claude' | 'gemini'      who is asked first, read per call
     describeModels()                ->  { text, provider }       a label for tools that print the model
     PROFILES                        ->  per route: which Claude model, how much effort, how long, how much
     LIMITS                          ->  { budgetMs, fallbackNeedsMs }: how long one call may take in all

   Claude is asked first when its key is set (and LLM_PROVIDER is not 'gemini'); Gemini is the fallback.
   Without the key, or with LLM_PROVIDER=gemini, this is callGeminiJson and nothing else.

   opts are exactly what callGeminiJson takes (inlineFile, inlineFiles, images, timeoutMs, retry, deadlineAt,
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
  /* plain: the chat's answer schema is too big for Claude's strict mode (refused as "compiled grammar too large"),
     so every message cost a refused strict request first; it starts in plain mode, read leniently (claude.js) */
  'chat-edit': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 75000, maxOutputTokens: 12000, plain: true },
  'suggest-design': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 75000, maxOutputTokens: 12000 },
  /* reading a brief or a page is extraction, not design: Haiku, at a twentieth of Sonnet's price */
  'extract-brief': { model: CLAUDE_HAIKU, effort: 'low', timeoutMs: 90000, maxOutputTokens: 12000 },
  'ingest-source': { model: CLAUDE_HAIKU, effort: 'low', timeoutMs: 75000, maxOutputTokens: 12000 },
  'logo-unit': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 45000, maxOutputTokens: 6000 },
  /* the check of a picture ETB2B AI made (lib/chat-picture.js): three yes/no answers about one picture — are there
     people, words, a logo in it — is looking, not writing: Haiku, a fraction of a cent a picture */
  'picture-check': { model: CLAUDE_HAIKU, effort: 'low', timeoutMs: 30000, maxOutputTokens: 2000 },
  /* a caption, five subject lines, a paragraph: short copy from a fact sheet (lib/promo.js) */
  'promo-write': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 60000, maxOutputTokens: 6000 },
  /* ETB2B AI in the post and mailer editors (lib/promo-ai.js): reads a request against one post or mail and writes
     its few changed words, a subject line or a caption from a fact sheet — the same work as promo-write */
  'promo-edit': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 55000, maxOutputTokens: 6000 },
  /* the mailer studio's AI (lib/promo-mailer.js, the promotional platform's four tools): subject lines, a field
     rewritten in a tone and a whole-mail polish on Haiku, as the platform runs them; "Enhance whole mailer"
     — the one call that restructures a mail — on Opus at high effort, as the platform runs it */
  'promo-ai-fast': { model: CLAUDE_HAIKU, effort: 'low', timeoutMs: 60000, maxOutputTokens: 12000 },
  'promo-ai-deep': { model: CLAUDE_OPUS, effort: 'high', timeoutMs: 150000, maxOutputTokens: 32000 },
  /* the event's two- or three-sentence description, written again for an event made before the plan wrote it
     (tools/repair-description.js, lib/event-description.js) */
  'event-description': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 60000, maxOutputTokens: 4000 },
  /* ETB2B AI on the events dashboard (lib/dash-bot.js): one short JSON answer per message that picks one action
     and names events by id. Every number, date and list in it is filled in by the server, never written by the
     model, so this is reading a request, not writing: Haiku, at about $0.003 a message against Sonnet's $0.05.
     The plan's QA gate moves it to CLAUDE_SONNET if Haiku misreads the asks (CLAUDE_MODEL_DASH_BOT overrides it
     without a deploy). 45 s sits inside the route's own 55 s deadline, so a slow answer is still answered in
     time, and a Claude call that fails fast leaves Gemini the rest. */
  'dash-bot': { model: CLAUDE_HAIKU, effort: 'low', timeoutMs: 45000, maxOutputTokens: 6000 },
  /* the site check's repair of a repeated heading (lib/api.js writeSectionHeadings): a few words per section, from
     that section's own words, in the page's voice */
  'site-heading': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 45000, maxOutputTokens: 3000 },
  /* Settings › URL & SEO (lib/api-seo.js, seo-ai.js): six short fields, or five FAQs, from a fact sheet — short copy, as
     promo-write is. The schema is small enough for strict mode. */
  'seo-write': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 60000, maxOutputTokens: 6000 },
  /* where each speaker's photo is on a brochure's pages (lib/speaker-photos.js): marking places on a picture is what
     Gemini is trained for, so it is asked first and Claude after it (prefer) */
  'photo-find': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 70000, maxOutputTokens: 6000, prefer: 'gemini' },
  'people-about': { model: CLAUDE_SONNET, effort: 'low', timeoutMs: 45000, maxOutputTokens: 3000 },
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
  /* a route Gemini answers better (profile.prefer): Gemini first, Claude when it cannot */
  if (profile.prefer === 'gemini') {
    return callGeminiJson(prompt, schema, Object.assign({}, opts, { deadlineAt: deadlineAt })).then(function (first) {
      report(opts, first);
      if (!first.code || deadlineAt - Date.now() < LIMITS.fallbackNeedsMs) return first;
      return callClaudeJson(prompt, schema, { model: profile.model, effort: profile.effort, timeoutMs: profile.timeoutMs, maxOutputTokens: profile.maxOutputTokens,
        inlineFile: opts.inlineFile, inlineFiles: opts.inlineFiles, images: opts.images, deadlineAt: deadlineAt, route: opts.route, eventId: opts.eventId, user: opts.user, plain: profile.plain === true
      }).then(function (second) {
        report(opts, second);
        console.log(JSON.stringify({ at: 'llm', route: opts.route || '', eventId: opts.eventId || '', provider: 'claude', fellBack: true, firstCode: first.code, code: second.code || 'ok' }));
        return Object.assign(second, { fellBack: true, firstCode: first.code });
      });
    });
  }
  return callClaudeJson(prompt, schema, {
    model: profile.model, effort: profile.effort, timeoutMs: profile.timeoutMs, maxOutputTokens: profile.maxOutputTokens,
    inlineFile: opts.inlineFile, inlineFiles: opts.inlineFiles, images: opts.images, deadlineAt: deadlineAt,
    route: opts.route, eventId: opts.eventId, user: opts.user, plain: profile.plain === true
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
