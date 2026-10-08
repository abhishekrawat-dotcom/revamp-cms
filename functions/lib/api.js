// The /api/* endpoint logic — the ONE place it's written. Runs identically in two places:
//   - locally, called directly from tools/serve.js's raw http.createServer handler
//   - deployed, called from functions/index.js's Cloud Function (an Express-based request/response)
// Both req/res shapes are close enough (both are/extend Node's http.IncomingMessage / ServerResponse) that
// the same handlers work unmodified — the one real difference is how the request body arrives (see
// readBody below), which is the only place that branches on environment.
//
//   POST /api/suggest-design   create-event.html's "Let AI design it" (step 2)
//   POST /api/chat-edit        custom_editor.html's "Ask AI to edit" chat panel (template mode only)
//   POST /api/extract-brief    AI site-generation pipeline, step 1: uploaded overview doc -> structured brief,
//                               persisted to Firebase (see lib/firebase.js for the schema and setup)
//   POST /api/ingest-source    AI site-generation pipeline, step 2: a previous-edition/current-edition/
//                               competitor URL -> its content sections (AI-summarized, never verbatim) +
//                               colour/font signals (regex, deterministic — not asked of the model, which
//                               can't reliably "see" a palette from text alone)
//   POST /api/generate-content AI site-generation pipeline, step 3: the brief + sources already collected
//                               for an event -> real content in the SAME shape create-event.html's wizard
//                               produces (templates/README.md's "one content model for every template" —
//                               subheading/heading/body/points/cta per section, {t,d} per card), so it can
//                               be fed through the existing editor-fill.js with no new client-side code.
//                               Also handles templateId:'gen-<eventId>' (a fully GENERATED structure, not a
//                               ported template) by building its content.map from the structure plan below
//                               instead of reading a real template.json — see "GENERATED TEMPLATES" further
//                               down, right before this handler.
//   POST /api/plan-structure   GENERATED TEMPLATES pipeline, step A: the brief + sources already collected
//                               for an event -> which of the 10 library/sections/<type> component types this
//                               event's page should use and in what order, plus the theme (colour/fonts,
//                               previousEdition sources only) and a generated hero background image. Saved
//                               on the event's own doc (events/{eventId}: structurePlan, theme) for the two
//                               endpoints below to read.
//   GET  /api/generated-template?eventId=<id>   GENERATED TEMPLATES pipeline, step C: assembles the exact
//                               template.json shape (id, name, fonts, design, body.style, content.map,
//                               layout, sections) for a generated page, from the structure plan + theme
//                               saved by /api/plan-structure. The frontend's template-loader.js consumes
//                               this the same way it reads a real templates/<id>/template.json file, and
//                               resolves each section's markup/CSS directly from templates/_library/sections/
//                               <type>/ (fixed library files, not served by this endpoint).
//
//   -- Event console (edit-event.html and its sibling tabs) — real Firestore data, replacing what used to be
//      window.RevampCore's hardcoded 8-event array + localStorage. See lib/firebase.js's header comment for
//      the full schema. Admin-write routes (everything below except POST /api/register) require a verified
//      Firebase Auth ID token — see requireAdmin().
//   POST/GET/PATCH /api/event                     create / read / update the canonical event
//   GET/POST/PATCH/DELETE /api/event/<resource>    generic CRUD over one of the per-event subcollections —
//                               speakers, speaker-groups, sessions, agenda-groups, partners, partner-tiers,
//                               gallery, faqs, contacts — see subcollectionRoutes()/RESOURCES below.
//   GET  /api/event/registrations                  list this event's real registrations
//   GET  /api/event/dashboard-stats                 real aggregated counts (registrations/confirmed/
//                               waitlist/attendees/revenue) computed server-side from the registrations
//                               subcollection, not pulled client-side
//   POST /api/event/publish                         the real Publish button (editor-template-ui.js) —
//                               stores the editor's final canvas.serialize() output in Storage, public,
//                               and marks the event published. Previously Publish did nothing server-side
//                               at all ("Saved — not yet published" was the literal, honest truth).
//   POST /api/register                              PUBLIC, no auth — the one write path the published
//                               microsite's own "Register Now" CTA calls; writes a registrations doc
const fs = require('fs');
const path = require('path');
const { getFirebase } = require('./firebase');
const { isAllowedUser, deniedMessage } = require('./access');

function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// Firebase Functions (v2 HTTPS) buffers the request body itself before our handler ever runs, and exposes it
// as req.rawBody — reading req.on('data') again at that point gets nothing, the stream is already consumed.
// Locally, under plain http.createServer, there is no rawBody, so we read the stream ourselves as before.
function readBody(req, cb) {
  if (req.rawBody) return cb(req.rawBody.toString('utf8'));
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () { cb(Buffer.concat(chunks).toString('utf8')); });
  req.on('error', function () { cb(''); });
}

/* The real design fields create-event.html applies via canvas.design.set() (editor-canvas.js) on the
   mounted Gen-2 template — real ET CSS variables and rules, not CSS vars grafted onto a generic preview.
   Grouped by validation kind; bgImage/radius are left out entirely (the AI never invents a background photo
   it hasn't seen, and corner radius isn't worth asking an LLM to guess).
   headingColor/textColor/bgColor are deliberately NOT offered: editor-canvas.js applies each as ONE global
   CSS rule across the whole site (every heading, all body text, or <body>'s own background), but a real
   template's sections don't all share a background or inherit it — most of tech500's sections (FAQ, cards,
   stats…) carry their own fixed background from their own section CSS, independent of <body>. A design that
   sets dark heading/text colour for a "dark mode" look stays correct on sections that go along with it, but
   breaks (white-on-white or black-on-black) on any section that doesn't — confirmed live on tech500's FAQ
   panel, whose background never moves off a fixed light grey. themeColor is the one colour kept controllable:
   it's used as an accent (buttons/links/edges via var(--theme-color)), applied in bounded places rather than
   as a whole section's text or backdrop, so it doesn't carry the same contrast risk. */
var DESIGN_COLOR_FIELDS = ['themeColor'];
var DESIGN_FONT_FIELDS = ['headingFont', 'bodyFont'];
var DESIGN_ENUM_FIELDS = {
  divider: ['none', 'line', 'dashed', 'thick'],
  animation: ['none', 'fade', 'rise', 'pulse'],
  headingCase: ['none', 'uppercase', 'lowercase', 'capitalize'],
  /* ET's own sites centre section headings/CTAs by convention (confirmed against the live production
     CSS and several real ET Oneworld event microsites) — 'center' should be the default choice. */
  headingAlign: ['left', 'center', 'right', 'justify']
};
var DESIGN_WEIGHT_FIELDS = ['headingWeight', 'bodyWeight'];
var DESIGN_NUMERIC_FIELDS = { bodySize: [12, 24], headingSize: [20, 64], sectionSpacing: [0, 140], bgOpacity: [0, 100] };
var DESIGN_FIELDS = DESIGN_COLOR_FIELDS.concat(DESIGN_FONT_FIELDS, Object.keys(DESIGN_ENUM_FIELDS), DESIGN_WEIGHT_FIELDS, Object.keys(DESIGN_NUMERIC_FIELDS));

/* The prompt: event basics + the section content already filled in step 1 (so suggestions build on what's
   really there, never invent facts) + the ONE baseline template already in use (its structure is fixed —
   this is a visual redesign, not a different template pick). Section data is passed through once as JSON so
   the model can see each shape's existing keys and return a same-shaped partial patch. */
function buildPrompt(payload) {
  var sections = (payload.sections || []).filter(function (s) { return s.shape !== 'auto' && s.data; });
  var tpl = payload.currentTemplate || {};
  var design = tpl.design || {};
  /* structured design intake (closer to how Wix ADI's own intake works — a short set of style/goal
     questions, not just one free-text box): vibe is a single pick from a fixed list (create-event.html's
     VIBE_OPTIONS), notes is free text for anything a fixed chip can't capture (a brand colour, a reference
     site). Both optional; combined into one instruction line Gemini treats the same way the old
     themePreference field did. */
  var intake = payload.designIntake || {};
  var vibe = String(intake.vibe || '').trim().slice(0, 60);
  var notes = String(intake.notes || '').trim().slice(0, 200);
  var themePref = [vibe, notes].filter(Boolean).join(' — ');
  var reorderable = tpl.reorderableSections || [];
  /* designs already shown this session (create-event.html's S.priorDesigns, both from explicit "Design with
     AI" clicks and the silent auto-personalize fallback) — without this, a repeat click/regeneration had no
     memory of what it already proposed and could easily resurface something near-identical. Wix's own
     "Regenerate Design" is explicitly built to never do that. */
  var priorDesigns = (payload.priorDesigns || []).slice(-6);
  return [
    'You are proposing fresh, trendy VISUAL REDESIGNS of an existing event microsite for ET Oneworld\'s event builder — not a different template. This is the REAL template\'s own markup and CSS, rendered live; you are only changing its real design settings (colour, typography, heading style), and optionally the order of a few sections (see below) — never which sections exist or their own internal layout.',
    '',
    'Event:', JSON.stringify(payload.event || {}, null, 2),
    '',
    'The content already written for this event, by section (libId -> current data):',
    JSON.stringify(sections.map(function (s) { return { libId: s.libId, shape: s.shape, name: s.name, data: s.data }; }), null, 2),
    '',
    'Baseline template (fixed — do not suggest switching it). Its own brand swatches and which elements count as headings/buttons/cards:',
    JSON.stringify({ id: tpl.id, name: tpl.name, swatches: design.swatches || [], headings: design.headings, buttons: design.buttons, cards: design.cards }, null, 2),
    '',
    'ET Oneworld\'s own event sites centre section headings and call-to-action buttons by convention — keep headingAlign as "center" in the large majority of your suggestions; only pick something else for a deliberate, clearly-justified editorial/asymmetric direction.',
    '',
    themePref
      ? 'The event owner asked for this specific look: "' + themePref + '". Every design you propose should clearly read as that direction — treat it as a direct instruction, not loose inspiration.'
      : 'The event owner did not ask for a specific look. This platform builds a unique site per event, not copies of one reference template, so do not default toward the baseline template\'s own listed swatches/fonts — the result needs to feel like its own distinct site, not the same look every other event in this category already has. In that case, ground your directions in what this event actually is — its category, its scale (numbers in its stats/content), its tone (formal boardroom vs. energetic community vs. editorial) — the way an experienced designer would read a brief, not a random palette generator.',
    priorDesigns.length
      ? '\nAlready shown earlier in this same session (do not propose anything this close again — these are rejected or superseded, not a starting point to riff on): ' + JSON.stringify(priorDesigns)
      : '',
    '',
    'Task:',
    '1. Propose 2 or 3 genuinely distinct, modern/trendy design directions for THIS SAME real template (e.g. a bold dark-mode redesign, a warm editorial look, a clean minimalist one) — not timid tweaks, real visual personality shifts. Treat the template\'s own swatches as a loose starting point, not a constraint.',
    '2. Each design needs a short memorable name (2-4 words) and a one-sentence reason that reads like a condensed design brief — name the specific thing about THIS event (its category, scale, content, or the owner\'s stated preference) that this direction serves, not a generic aesthetic description that could apply to any event. Also return a complete `design` object supplying every one of these fields: ' + DESIGN_FIELDS.join(', ') + '.',
    '   - ' + DESIGN_COLOR_FIELDS.join('/') + ': hex colours (e.g. "#1c1c1c") with real contrast against whatever they sit on.',
    '   - ' + DESIGN_FONT_FIELDS.join('/') + ': a real Google Fonts family name (e.g. "Fraunces", "Space Grotesk", "Playfair Display") — these are loaded dynamically, any real family on fonts.google.com works.',
    '   - divider: one of ' + DESIGN_ENUM_FIELDS.divider.join('/') + '. animation: one of ' + DESIGN_ENUM_FIELDS.animation.join('/') + '. headingCase: one of ' + DESIGN_ENUM_FIELDS.headingCase.join('/') + '. headingAlign: one of ' + DESIGN_ENUM_FIELDS.headingAlign.join('/') + ' (see the centring note above).',
    '   - ' + DESIGN_WEIGHT_FIELDS.join('/') + ': a CSS font-weight ("normal", "bold", or "100"-"900" in hundreds).',
    '   - bodySize/headingSize: a pixel size (bodySize ' + DESIGN_NUMERIC_FIELDS.bodySize.join('-') + ', headingSize ' + DESIGN_NUMERIC_FIELDS.headingSize.join('-') + '). sectionSpacing: vertical rhythm between sections in px (' + DESIGN_NUMERIC_FIELDS.sectionSpacing.join('-') + '). bgOpacity: 0-100.',
    '3. Separately, for sections where the existing content is thin, generic, or could read sharper, propose a partial content patch: same keys as that section\'s current `data`, only the fields you are actually improving. Never invent facts (dates, numbers, names, companies) that aren\'t already present or directly implied. This is independent of which design the user picks. Skip a section entirely if you have nothing meaningful to add — do not pad the list. Never patch the hero section\'s `title` field — it mirrors the event\'s own name (already set elsewhere), not content for you to rewrite or shorten.',
    '4. Return `enhancements` as an array of {libId, patchJson} where patchJson is that partial patch encoded as a JSON string.',
    reorderable.length > 1
      ? '5. Section order (optional, applies once — not per design option above): ' + JSON.stringify(reorderable) + ' are this template\'s sections you may resequence; everything else (the hero, Contact/About) is fixed and not listed here. If reading this event\'s actual content suggests a better editorial flow than the template\'s own default order (e.g. a FAQ reading better near the end, an overview before supporting detail), return `sectionOrder` as these same ids in that better order. Vary it meaningfully between events rather than defaulting to the template\'s own listed order every time — but only reorder when it genuinely improves the reading flow for THIS content, and omit `sectionOrder` entirely rather than return a worse or arbitrary order.'
      : ''
  ].filter(Boolean).join('\n');
}

var RESPONSE_SCHEMA_BASE = {
  type: 'OBJECT',
  properties: {
    designs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: Object.assign(
          { name: { type: 'STRING' }, reason: { type: 'STRING' } },
          { design: { type: 'OBJECT', properties: {}, required: DESIGN_FIELDS } }
        ),
        required: ['name', 'reason', 'design']
      }
    },
    enhancements: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          libId: { type: 'STRING' },
          patchJson: { type: 'STRING', description: 'A JSON object string: a partial patch of this section\'s existing data fields, enhanced copy only.' }
        },
        required: ['libId', 'patchJson']
      }
    },
    sectionOrder: {
      type: 'ARRAY',
      description: 'Either empty (the template\'s own order already reads best) or every one of the reorderable section ids, in a better editorial order for this event.',
      items: { type: 'STRING' }
    }
  },
  required: ['designs', 'enhancements', 'sectionOrder']
};
(function () {
  var props = RESPONSE_SCHEMA_BASE.properties.designs.items.properties.design.properties;
  DESIGN_COLOR_FIELDS.concat(DESIGN_FONT_FIELDS, DESIGN_WEIGHT_FIELDS).forEach(function (f) { props[f] = { type: 'STRING' }; });
  Object.keys(DESIGN_ENUM_FIELDS).forEach(function (f) { props[f] = { type: 'STRING', enum: DESIGN_ENUM_FIELDS[f] }; });
  Object.keys(DESIGN_NUMERIC_FIELDS).forEach(function (f) {
    props[f] = { type: 'INTEGER', minimum: DESIGN_NUMERIC_FIELDS[f][0], maximum: DESIGN_NUMERIC_FIELDS[f][1] };
  });
})();

/* enum-constrains libId to the real sections in this request — free-text ids would need fragile
   fuzzy-matching on the client. Design values that can't be schema-enum-constrained (colours/fonts) are
   sanitized instead, see sanitizeDesignField() below. */
function responseSchemaFor(payload) {
  var schema = JSON.parse(JSON.stringify(RESPONSE_SCHEMA_BASE));
  var libIds = (payload.sections || []).map(function (s) { return s.libId; });
  if (libIds.length) schema.properties.enhancements.items.properties.libId.enum = libIds;
  var reorderableIds = ((payload.currentTemplate || {}).reorderableSections || []).map(function (s) { return s.id; });
  if (reorderableIds.length) schema.properties.sectionOrder.items.enum = reorderableIds;
  return schema;
}

/* per-field validation — a field that fails is OMITTED (not defaulted): the client only ever calls
   canvas.design.set() for keys actually present in the sanitized response, so a dropped field just leaves
   that one knob untouched rather than risking a guessed/garbage value reaching the live preview. */
function sanitizeDesignField(key, v) {
  if (DESIGN_COLOR_FIELDS.indexOf(key) !== -1) {
    return (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) ? v : undefined;
  }
  if (DESIGN_FONT_FIELDS.indexOf(key) !== -1) {
    if (typeof v !== 'string') return undefined;
    var f = v.replace(/["'<>]/g, '').trim().slice(0, 60);
    return f || undefined;
  }
  if (DESIGN_ENUM_FIELDS[key]) {
    return DESIGN_ENUM_FIELDS[key].indexOf(v) !== -1 ? v : undefined;
  }
  if (DESIGN_WEIGHT_FIELDS.indexOf(key) !== -1) {
    return (typeof v === 'string' && /^(normal|bold|[1-9]00)$/.test(v)) ? v : undefined;
  }
  if (DESIGN_NUMERIC_FIELDS[key]) {
    /* canvas.design's setters for these take a bare number and append their own unit (px, or none for
       bgOpacity) — never pre-suffix it here, or e.g. bodySize would end up set to "18pxpx". */
    var n = Math.round(Number(v));
    if (!Number.isFinite(n)) return undefined;
    var range = DESIGN_NUMERIC_FIELDS[key];
    return Math.min(range[1], Math.max(range[0], n));
  }
  return undefined;
}

/* Shared Gemini call: prompt + schema in, the model's parsed JSON object out (or a {error, status} to proxy
   straight back to the browser). Used by /api/suggest-design, /api/chat-edit and /api/extract-brief.
   `inlineFile` is optional — {mimeType, data (base64)} — appended as a second part so the model can read an
   uploaded document directly (Gemini accepts PDF/text inline the same way it accepts images). GEMINI_API_KEY
   itself comes from tools/.env.local locally, or from Firebase Secret Manager when deployed (bound in
   functions/index.js) — either way it lands in process.env the same way, so this code doesn't need to care. */
// Worst-case latency for ONE callGeminiJson call, including its one retry (see below): 60s timeout on the
// first attempt + 60s timeout on the retry = ~120000ms (~120s) in the worst case. create-event.html's
// "Generate from a brief" checklist keys its own "still writing, hasn't stalled" reassurance line (shown
// once the `generate` step has been running longer than this) off this exact number — if this changes,
// that must change with it (see GEMINI_WORST_CASE_MS in create-event.html, right next to GENERATE_TEMPLATES).
var GEMINI_WORST_CASE_MS = 120000;

function callGeminiJson(prompt, schema, inlineFile) {
  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Promise.resolve({ error: 'GEMINI_API_KEY is not set. Add it to tools/.env.local (GEMINI_API_KEY=...) locally, or `firebase functions:secrets:set GEMINI_API_KEY` when deployed.', status: 503 });
  }
  /* gemini-2.0-flash was retired by Google after this was first written; the API's own 404 names the
     replacement. If this breaks again later, the error message from Gemini itself says what to use next. */
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=' + encodeURIComponent(apiKey);
  var parts = [{ text: prompt }];
  if (inlineFile) parts.push({ inlineData: { mimeType: inlineFile.mimeType, data: inlineFile.data } });
  var body = {
    contents: [{ parts: parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema }
  };

  /* One attempt at the actual call. Nothing here used to bound how long a call could take — a genuinely
     slow or hung response from Google left the browser's "Thinking…" indicator spinning forever with no
     way to know anything had gone wrong. 60s is generous for a structured-JSON generateContent call; past
     that, fail loudly instead of silently. Pulled out into its own function so the retry below can just
     call it again rather than duplicating the request/timeout plumbing. */
  function attempt() {
    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, 60000);
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
      .then(function (geminiRes) {
        return geminiRes.text().then(function (text) { return { ok: geminiRes.ok, status: geminiRes.status, text: text }; });
      })
      .then(function (r) {
        if (!r.ok) return { error: 'Gemini API error ' + r.status + ': ' + r.text.slice(0, 400), status: 502 };
        var data;
        try { data = JSON.parse(r.text); } catch (e) { return { error: 'Gemini returned a response that was not valid JSON.', status: 502 }; }
        var modelText = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
          data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
        if (!modelText) return { error: 'Gemini response had no content (it may have been blocked by safety filters).', status: 502 };
        try { return { parsed: JSON.parse(modelText) }; } catch (e) { return { error: 'Could not parse the AI suggestion as JSON.', status: 502 }; }
      })
      .catch(function (err) {
        if (timedOut) return { error: 'Gemini took too long to respond (over 60s) — please try again.', status: 504 };
        return { error: 'Could not reach Gemini: ' + err.message, status: 502 };
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* Retry exactly once on a timeout (504) or any 5xx-class failure (502/503) — Google's own infrastructure
     having a bad moment, or this one request happening to time out, is exactly what a single retry can
     paper over. A 4xx would mean WE sent something Gemini rejected outright (never actually returned by
     this function today, but the check is here on principle) — retrying an identical request wouldn't
     change that, so it isn't retried. */
  return attempt().then(function (r) {
    if (r.error && r.status >= 500 && r.status <= 599) return attempt();
    return r;
  });
}

function handleSuggestDesign(req, res) {
  readBody(req, function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    callGeminiJson(buildPrompt(payload), responseSchemaFor(payload)).then(function (r) {
      if (r.error) return sendJson(res, r.status, { error: r.error });
      var parsed = r.parsed;

      var enhancements = {};
      (parsed.enhancements || []).forEach(function (item) {
        if (!item || !item.libId || typeof item.patchJson !== 'string') return;
        try { enhancements[item.libId] = JSON.parse(item.patchJson); } catch (e) { /* skip an unparseable patch, don't fail the whole response */ }
      });

      var designs = (parsed.designs || []).map(function (d) {
        if (!d || !d.design) return null;
        var design = {};
        DESIGN_FIELDS.forEach(function (f) {
          var v = sanitizeDesignField(f, d.design[f]);
          if (v !== undefined) design[f] = v;
        });
        if (!Object.keys(design).length) return null;
        return { name: String(d.name || 'Untitled design').slice(0, 60), reason: String(d.reason || '').slice(0, 300), design: design };
      }).filter(Boolean);

      if (!designs.length) return sendJson(res, 502, { error: 'Gemini did not return any usable designs.' });

      /* valid only if it's a genuine permutation of the reorderable ids — a partial/garbled list reads as a
         model mistake, not a deliberate edit, so it's dropped entirely rather than passed on half-formed
         (the client's loader would defensively patch in anything missing, but better to just not apply it) */
      var reorderableIds = ((payload.currentTemplate || {}).reorderableSections || []).map(function (s) { return s.id; });
      var proposedOrder = Array.isArray(parsed.sectionOrder) ? parsed.sectionOrder.filter(function (id) { return reorderableIds.indexOf(id) !== -1; }) : [];
      var sectionOrder = (reorderableIds.length && proposedOrder.length === reorderableIds.length && new Set(proposedOrder).size === reorderableIds.length) ? proposedOrder : null;

      sendJson(res, 200, { designs: designs, enhancements: enhancements, sectionOrder: sectionOrder });
    });
  });
}

/* ---------- POST /api/chat-edit — custom_editor.html's "Ask AI to edit" chat panel (template mode) ----------
   A free-text instruction, interpreted against the REAL mounted template: a partial `design` patch (the same
   canvas.design field vocabulary as /api/suggest-design, reused as-is) plus, optionally, a few grounded text
   edits ({sectionId, find, replace} — find must be a short exact substring of that section's OWN current
   text, sent as context below, so the model can't invent a replacement for text that was never there). Nothing
   is applied server-side; the browser shows the proposal and only calls canvas.design.set()/does the text
   replacement once the user confirms (see editor-template-ui.js's wireChatPanel). */
function buildChatPrompt(payload) {
  var sections = (payload.sections || []).filter(function (s) { return s.texts && s.texts.length; });
  var history = (payload.history || []).slice(-16);
  return [
    'You are a real conversation partner helping someone edit their already-built event microsite for ET Oneworld, directly on its own real template — never a different template, never inventing new sections. This is a CHAT, not a one-shot command box: read the conversation so far, understand what the latest message means in that context ("make it a bit darker" refers to whatever was just discussed), and respond naturally.',
    '',
    (history.length ? 'Conversation so far (oldest first):\n' + history.map(function (h) { return (h.role === 'user' ? 'User: ' : 'You: ') + String(h.text || '').slice(0, 400); }).join('\n') + '\n' : ''),
    'The user\'s latest message:', '"' + String(payload.instruction || '').slice(0, 500) + '"',
    '',
    'The site\'s current design settings:',
    JSON.stringify(payload.design || {}, null, 2),
    '',
    'The site\'s real sections right now (sectionId -> its own current text, verbatim):',
    JSON.stringify(sections.map(function (s) { return { sectionId: s.id, name: s.name, texts: s.texts }; }), null, 2),
    '',
    'Task:',
    '1. First decide `kind`: "edit" if the latest message (read in context of the conversation) asks for a real change to the site, "reply" if it\'s a question, small talk, or anything else that doesn\'t call for one — e.g. "what can you change here?", "why didn\'t that work?", "thanks". Don\'t force an edit out of a message that\'s just a question.',
    '2. If `kind` is "reply": leave `design` empty and `textEdits` empty, and put a natural, helpful, conversational answer in `summary` — reference the actual sections/design above if relevant, don\'t make things up.',
    '3. If `kind` is "edit": if it asks for a visual/design change (colour, font, spacing, heading style…), return a partial `design` object — ONLY the fields the instruction actually calls for, using these field names: ' + DESIGN_FIELDS.join(', ') + '. Leave out any field it didn\'t ask to change. A colour field MUST be a hex code ("#1c1c1c") — if it names a colour in words ("orange", "navy blue"), translate it to the closest real hex value yourself; never write the colour word into a colour field, it will be rejected. If it asks to change text, return `textEdits`: an array of {sectionId, find, replace}, where `find` is copied VERBATIM (exact substring, same spelling/punctuation) from that section\'s own text shown above — never invent or paraphrase the original. Never invent facts (dates, numbers, names) that aren\'t already present. A follow-up like "make it bigger instead" that refines a design mentioned earlier in the conversation should produce a fresh, complete replacement for the fields it\'s changing, not an incremental tweak instruction.',
    '4. Write `summary` LAST, after deciding the above. For an edit, it must describe ONLY what `design`/`textEdits` actually contain, nothing more — never mention a change that isn\'t also a real field in `design` or a real entry in `textEdits`, the user sees both side by side so any mismatch is a bug.'
  ].join('\n');
}

function chatResponseSchema(payload) {
  var sectionIds = (payload.sections || []).map(function (s) { return s.id; });
  var designProps = {};
  DESIGN_FIELDS.forEach(function (f) { designProps[f] = { type: 'STRING' }; });
  Object.keys(DESIGN_ENUM_FIELDS).forEach(function (f) { designProps[f] = { type: 'STRING', enum: DESIGN_ENUM_FIELDS[f] }; });
  Object.keys(DESIGN_NUMERIC_FIELDS).forEach(function (f) { designProps[f] = { type: 'INTEGER', minimum: DESIGN_NUMERIC_FIELDS[f][0], maximum: DESIGN_NUMERIC_FIELDS[f][1] }; });
  var schema = {
    type: 'OBJECT',
    properties: {
      kind: { type: 'STRING', enum: ['edit', 'reply'] },
      summary: { type: 'STRING' },
      design: { type: 'OBJECT', properties: designProps },   // no `required` — a partial patch, any subset
      textEdits: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            sectionId: { type: 'STRING' },
            find: { type: 'STRING' },
            replace: { type: 'STRING' }
          },
          required: ['sectionId', 'find', 'replace']
        }
      }
    },
    required: ['kind', 'summary', 'design', 'textEdits']
  };
  if (sectionIds.length) schema.properties.textEdits.items.properties.sectionId.enum = sectionIds;
  return schema;
}

function handleChatEdit(req, res) {
  readBody(req, function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
    if (!String(payload.instruction || '').trim()) return sendJson(res, 400, { error: 'No instruction given.' });

    callGeminiJson(buildChatPrompt(payload), chatResponseSchema(payload)).then(function (r) {
      if (r.error) return sendJson(res, r.status, { error: r.error });
      var parsed = r.parsed;

      /* the prompt tells the model to only describe in `summary` what design/textEdits actually contain, but
         that's not enforceable — this tracks anything the model TRIED to set that got dropped by validation
         (e.g. a colour word instead of hex), so the client can flag the gap instead of silently under-
         delivering what the summary promised. */
      var skipped = [];
      var design = {};
      DESIGN_FIELDS.forEach(function (f) {
        var raw = parsed.design && parsed.design[f];
        var v = sanitizeDesignField(f, raw);
        if (v !== undefined) design[f] = v;
        else if (raw !== undefined && raw !== null && raw !== '') skipped.push(f + ' ("' + String(raw).slice(0, 40) + '")');
      });

      var knownSectionIds = (payload.sections || []).map(function (s) { return s.id; });
      var textEdits = (parsed.textEdits || []).map(function (t) {
        if (!t) return null;
        if (knownSectionIds.indexOf(t.sectionId) === -1) { skipped.push('a text edit for an unknown section'); return null; }
        var find = String(t.find || '').trim().slice(0, 300);
        var replace = String(t.replace || '').slice(0, 300);
        if (!find) return null;
        return { sectionId: t.sectionId, find: find, replace: replace };
      }).filter(Boolean);

      var summary = String(parsed.summary || '').slice(0, 300);
      if (!summary && !Object.keys(design).length && !textEdits.length) {
        return sendJson(res, 502, { error: 'Gemini did not return a usable change for that instruction.' });
      }
      var kind = parsed.kind === 'reply' ? 'reply' : 'edit';
      sendJson(res, 200, { kind: kind, summary: summary || 'A change is ready to review.', design: design, textEdits: textEdits, skipped: skipped });
    });
  });
}

/* ---------- POST /api/extract-brief — AI site-generation pipeline, step 1 ----------
   Takes an uploaded overview doc (base64 in the JSON body — simplest thing that needs no multipart parser,
   fine at pilot scale) plus the event's basic facts, stores the doc in Firebase Storage, asks Gemini to pull
   out ONLY what the doc actually says (never invents tracks/speakers/sponsors that aren't mentioned), and
   persists both the event record and the extracted brief to Firestore. Returns the extracted brief so the
   client can show it before the later research/synthesis steps run. */
var BRIEF_SCHEMA = {
  type: 'OBJECT',
  properties: {
    theme: { type: 'STRING', description: 'The event\'s core theme/positioning, in one or two sentences, grounded in the document.' },
    audience: { type: 'STRING', description: 'Who this event is for, as the document describes or implies it.' },
    tone: { type: 'STRING', description: 'e.g. formal boardroom, energetic community, editorial — read from the document\'s own language.' },
    tracks: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Named tracks, sessions or themes the document mentions.' },
    speakerHints: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Any speaker names/roles/companies the document mentions, verbatim.' },
    sponsorHints: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Any sponsor/partner names or tiers the document mentions, verbatim.' },
    keyMessages: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Up to 5 key points or selling points the document wants communicated.' },
    /* used by create-event.html to warn the user before generating into a template built for a different
       industry (see openTemplateMismatchModal there) — same grounding discipline as every other field here:
       read from the document's own actual subject matter, never a guess dressed up as one. A short free-text
       label ("enterprise AI leadership", "retail / e-commerce"), not a fixed enum — the set of real-world
       event industries isn't closed, and forcing one here would mean inventing a category the document never
       actually supports. */
    inferredCategory: { type: 'STRING', description: 'A short (2-4 word) industry/category label this document genuinely reads as, e.g. "enterprise AI leadership" or "retail / e-commerce" — empty string if the document gives no real signal, never a guess.' }
  },
  required: ['theme', 'audience', 'tone', 'tracks', 'speakerHints', 'sponsorHints', 'keyMessages', 'inferredCategory']
};

function buildExtractBriefPrompt(eventMeta) {
  return [
    'You are extracting a structured brief from an event overview document, for ET Oneworld\'s event microsite builder.',
    '',
    'Event basics (already known, given here only for context — do not repeat them back as extracted content):',
    JSON.stringify(eventMeta || {}, null, 2),
    '',
    'The document is attached. Read it and extract ONLY what it actually says or clearly implies. Never invent a',
    'track, speaker, sponsor or claim that isn\'t in the document — an empty array/field is correct when the',
    'document simply doesn\'t cover that, better than a plausible-sounding guess.',
    '',
    'inferredCategory specifically: name the short industry/category this event genuinely reads as (e.g.',
    '"enterprise AI leadership", "CIO technology leadership", "retail / e-commerce") — base it only on real',
    'signal in the document (its subject matter, audience, themes), never on the event basics above, and never',
    'invent one if the document itself gives no real signal to go on — an empty string is the correct answer then.'
  ].join('\n');
}

// 15MB cap on the decoded file — generous for a brief overview doc, small enough to keep one request fast
// and well under Cloud Functions' own request size ceiling.
var MAX_BRIEF_BYTES = 15 * 1024 * 1024;

function handleExtractBrief(req, res) {
  readBody(req, function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    var eventId = String(payload.eventId || '').trim();
    var fileName = String(payload.fileName || '').trim();
    var mimeType = String(payload.mimeType || '').trim();
    var docBase64 = String(payload.docBase64 || '');
    if (!eventId || !fileName || !mimeType || !docBase64) {
      return sendJson(res, 400, { error: 'eventId, fileName, mimeType and docBase64 are all required.' });
    }

    var buffer;
    try { buffer = Buffer.from(docBase64, 'base64'); } catch (e) { return sendJson(res, 400, { error: 'docBase64 is not valid base64.' }); }
    if (buffer.length === 0) return sendJson(res, 400, { error: 'The uploaded document is empty.' });
    if (buffer.length > MAX_BRIEF_BYTES) return sendJson(res, 413, { error: 'The uploaded document is larger than the 15MB pilot limit.' });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    var eventMeta = payload.eventMeta || {};
    var storagePath = 'events/' + eventId + '/briefs/' + fileName;

    fb.bucket.file(storagePath).save(buffer, { metadata: { contentType: mimeType } })
      .then(function () {
        return callGeminiJson(buildExtractBriefPrompt(eventMeta), BRIEF_SCHEMA, { mimeType: mimeType, data: docBase64 });
      })
      .then(function (r) {
        if (r.error) return sendJson(res, r.status, { error: r.error });
        var extracted = {
          theme: String(r.parsed.theme || '').slice(0, 500),
          audience: String(r.parsed.audience || '').slice(0, 300),
          tone: String(r.parsed.tone || '').slice(0, 200),
          tracks: (r.parsed.tracks || []).slice(0, 20).map(function (s) { return String(s).slice(0, 200); }),
          speakerHints: (r.parsed.speakerHints || []).slice(0, 30).map(function (s) { return String(s).slice(0, 200); }),
          sponsorHints: (r.parsed.sponsorHints || []).slice(0, 30).map(function (s) { return String(s).slice(0, 200); }),
          keyMessages: (r.parsed.keyMessages || []).slice(0, 5).map(function (s) { return String(s).slice(0, 300); }),
          inferredCategory: String(r.parsed.inferredCategory || '').trim().slice(0, 60)
        };

        var now = new Date().toISOString();
        var eventRef = fb.db.collection('events').doc(eventId);
        return eventRef.set(Object.assign({}, eventMeta, { updatedAt: now }), { merge: true })
          .then(function () { return eventRef.collection('briefs').add({
            sourceFileName: fileName, mimeType: mimeType, storagePath: storagePath,
            extracted: extracted, model: 'gemini-3.8-flash', createdAt: now
          }); })
          .then(function (briefRef) { sendJson(res, 200, { eventId: eventId, briefId: briefRef.id, extracted: extracted }); });
      })
      .catch(function (err) { sendJson(res, 500, { error: 'extract-brief failed: ' + err.message }); });
  });
}

/* ---------- POST /api/ingest-source — AI site-generation pipeline, step 2 ----------
   Fetches a previous-edition or competitor event page server-side (the browser can't — CORS), and extracts
   two independent kinds of signal from it:
     - colour/font signals: plain regex over the raw HTML/CSS — deterministic and free, and more trustworthy
       than asking an LLM to infer a palette from flattened text, which it can't actually see.
     - content sections: the page's own text, stripped of markup/scripts/styles and bounded in size, handed to
       Gemini to extract as {heading, body} pairs — body is a short SUMMARY, never a verbatim copy, so this
       never stores or reproduces a competitor's exact copy. */
var MAX_SOURCE_TEXT_CHARS = 50000;

function extractColorSignals(html) {
  var counts = {};
  var m, re = /#[0-9a-fA-F]{6}\b/g;
  while ((m = re.exec(html))) {
    var hex = m[0].toLowerCase();
    counts[hex] = (counts[hex] || 0) + 1;
  }
  var entries = Object.keys(counts).map(function (hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return { hex: hex, count: counts[hex], chroma: Math.max(r, g, b) - Math.min(r, g, b) };
  });
  // Favour saturated (brand/accent) colours over greys/near-white/near-black, which dominate by raw frequency
  // but say nothing about an event's actual theme — keep exactly one neutral, for a background/text reference.
  var colorful = entries.filter(function (e) { return e.chroma >= 20; }).sort(function (a, b) { return b.count - a.count; });
  var neutral = entries.filter(function (e) { return e.chroma < 20; }).sort(function (a, b) { return b.count - a.count; });
  var picked = colorful.slice(0, 7);
  if (!picked.length) picked = neutral.slice(0, 3);
  else if (neutral.length) picked.push(neutral[0]);
  return picked.slice(0, 8).map(function (e) { return e.hex; });
}

function extractFontSignals(html) {
  var families = {};
  function add(name, weight) {
    name = name.replace(/!important/gi, '').trim();
    if (name && !/^(inherit|initial|unset)$/i.test(name)) families[name] = (families[name] || 0) + weight;
  }
  var m, re1 = /fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi;
  while ((m = re1.exec(html))) {
    // an explicit Google Fonts <link> is the strongest signal of intent — weighted well above an inline rule
    decodeURIComponent(m[1]).split('|').forEach(function (part) { add(part.split(':')[0].replace(/\+/g, ' '), 5); });
  }
  var re2 = /font-family\s*:\s*([^;"'}]+)/gi;
  while ((m = re2.exec(html))) add(m[1].split(',')[0].replace(/['"]/g, ''), 1);
  return Object.keys(families).sort(function (a, b) { return families[b] - families[a]; }).slice(0, 5);
}

// Collapses a full page down to its visible text, inserting a newline at block-level boundaries so Gemini can
// still tell where one section's text ends and the next begins, without needing the markup itself.
function stripToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(h1|h2|h3|h4|h5|h6|p|li|div|section|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

var SOURCE_SECTIONS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          heading: { type: 'STRING', description: 'The section\'s own heading if the text has one, else a short label you give it (e.g. "Hero", "Speakers", "Why Attend").' },
          body: { type: 'STRING', description: 'A short SUMMARY (1-3 sentences) of what this section says — never copy its sentences verbatim.' }
        },
        required: ['heading', 'body']
      }
    }
  },
  required: ['sections']
};

var SOURCE_TYPE_LABELS = {
  previousEdition: 'this same event\'s previous edition',
  currentEdition: 'this same event\'s current edition (the live page this generation will replace)',
  competitor: 'a competitor\'s event'
};

function buildIngestSourcePrompt(url, type, text) {
  return [
    'Below is the visible text of a real event microsite (' + SOURCE_TYPE_LABELS[type] + '), ' + url + '. The markup has been stripped; only text remains.',
    '',
    'Extract its main CONTENT sections, in the order they appear on the page (e.g. hero/intro, about, agenda highlights, speaker/why-attend, stats, sponsors, FAQ — whatever this page actually has). Skip navigation links, footer boilerplate, cookie/legal notices, and ad/widget text.',
    '',
    'For each section, summarize its own text in your own words (1-3 sentences) — never quote or closely paraphrase its sentences, this is for structural inspiration only, not content to reuse.',
    '',
    'Page text:', text
  ].join('\n');
}

function handleIngestSource(req, res) {
  readBody(req, function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    var eventId = String(payload.eventId || '').trim();
    var url = String(payload.url || '').trim();
    var type = Object.prototype.hasOwnProperty.call(SOURCE_TYPE_LABELS, payload.type) ? payload.type : 'previousEdition';
    if (!eventId || !url) return sendJson(res, 400, { error: 'eventId and url are required.' });
    if (!/^https?:\/\//i.test(url)) return sendJson(res, 400, { error: 'url must start with http:// or https://.' });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, 20000);

    fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RevampCMS-Pilot/1.0)' } })
      .then(function (r) { if (!r.ok) throw new Error('page returned HTTP ' + r.status); return r.text(); })
      .then(function (html) {
        clearTimeout(timer);
        var colorSignals = extractColorSignals(html);
        var fontSignals = extractFontSignals(html);
        var text = stripToText(html).slice(0, MAX_SOURCE_TEXT_CHARS);
        return callGeminiJson(buildIngestSourcePrompt(url, type, text), SOURCE_SECTIONS_SCHEMA).then(function (r) {
          if (r.error) return sendJson(res, r.status, { error: r.error });
          var sections = (r.parsed.sections || []).slice(0, 25).map(function (s) {
            return { heading: String(s.heading || '').slice(0, 120), body: String(s.body || '').slice(0, 500) };
          });
          var now = new Date().toISOString();
          return fb.db.collection('events').doc(eventId).collection('sources').add({
            type: type, url: url, extractedSections: sections, colorSignals: colorSignals, fontSignals: fontSignals, fetchedAt: now
          }).then(function (sourceRef) {
            sendJson(res, 200, { eventId: eventId, sourceId: sourceRef.id, type: type, url: url, extractedSections: sections, colorSignals: colorSignals, fontSignals: fontSignals });
          });
        });
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (timedOut) return sendJson(res, 504, { error: 'Fetching ' + url + ' took too long (over 20s).' });
        sendJson(res, 502, { error: 'Could not ingest ' + url + ': ' + err.message });
      });
  });
}

/* ---------- GENERATED TEMPLATES — structure planning, theme extraction, hero image ----------
   A "generated" template (id 'gen-<eventId>') has no templates/<id>/ folder at all — its page is assembled
   live from the fixed library at templates/_library/sections/<type>/, per section type chosen here. This
   block is shared by POST /api/plan-structure (below), by handleGenerateContent's 'gen-' branch (content.map
   construction), and by GET /api/generated-template (the final template.json-shaped assembly). */

// The 10 library types, in library order. nav/hero/footer are never Gemini's decision (see
// buildPlanStructurePrompt) — STRUCTURE_MIDDLE_TYPES is everything Gemini actually chooses from.
var LIBRARY_SECTION_TYPES = ['nav', 'hero', 'overview', 'stats-strip', 'cards-grid-icon', 'cards-grid-chips', 'speaker-grid', 'faq-accordion', 'cta-band', 'footer'];
var STRUCTURE_MIDDLE_TYPES = LIBRARY_SECTION_TYPES.filter(function (t) { return t !== 'nav' && t !== 'hero' && t !== 'footer'; });
var SECTION_TYPE_LABELS = {
  nav: 'Navigation', hero: 'Hero', overview: 'Overview', 'stats-strip': 'Stats strip',
  'cards-grid-icon': 'Cards grid (icon)', 'cards-grid-chips': 'Cards grid (chips)',
  'speaker-grid': 'Speaker grid', 'faq-accordion': 'FAQ accordion', 'cta-band': 'CTA band', footer: 'Footer'
};

var LIBRARY_SECTIONS_DIR = path.join(__dirname, '..', '..', 'templates', '_library', 'sections');

// Reads one library section type's own map.json (its content.map fragment) straight off disk — these are
// real files the web designer shipped, not generated. '_comment' is documentation only, left out of the
// real content.map entry.
function readLibrarySectionMap(type) {
  var raw = JSON.parse(fs.readFileSync(path.join(LIBRARY_SECTIONS_DIR, type, 'map.json'), 'utf8'));
  var entry = { from: raw.from, section: raw.section };
  if (raw.intro) entry.intro = raw.intro;
  if (raw.fill) entry.fill = raw.fill;
  if (raw.aiSkipMedia) entry.aiSkipMedia = raw.aiSkipMedia;
  return entry;
}

// The combined content.map for a generated page: one content.map entry per chosen section type, in the
// planned order — exactly the shape a real template.json's content.map array has, just assembled from N
// library map.json fragments instead of hand-written for one template. Used by both the 'gen-' branch of
// handleGenerateContent (to classify/generate against) and GET /api/generated-template (to return as-is).
//
// `heroImageGenerated`: each library section's own map.json is shared verbatim by every page that uses that
// section type — including hero's "aiSkipMedia": "img.hero-bg-image", written for the common case (a PORTED
// template, where that photo is permanently the original captured event's own asset, never AI's to touch).
// A GENERATED page is different: when its one hero-image generation call actually succeeded, that image
// genuinely IS AI-written content, and leaving aiSkipMedia in would wrongly badge it "not generated — replace
// manually" in the editor. Strip it from just the hero entry in that one case; every other section's
// aiSkipMedia (none currently use it) and hero's own fallback case (generation failed/skipped — the grey
// placeholder really is un-replaced) are untouched.
function buildCombinedLibraryMap(sectionTypes, heroImageGenerated) {
  return (sectionTypes || []).map(function (type) {
    var entry = readLibrarySectionMap(type);
    if (type === 'hero' && heroImageGenerated && entry.aiSkipMedia) delete entry.aiSkipMedia;
    return entry;
  });
}

/* ---- Theme extraction: previousEdition sources ONLY ----
   Hard product requirement: a generated page's colour/fonts come from the event's OWN previous edition,
   never from its current edition (the page being replaced) or a competitor (whose branding has nothing to
   do with this event). currentEdition/competitor colorSignals/fontSignals are read for other purposes
   elsewhere (buildIngestSourcePrompt's content extraction) but never for theme.
   Fallback (no previousEdition source at all, or one with no real signals — not every event has a previous
   edition on file): a neutral blue (matches this library's own hero.css --theme-color fallback, #186bf9)
   and a sensible, unrelated-to-any-brand font pair, Plus Jakarta Sans (heading) / Inter (body). */
var THEME_FALLBACK = { themeColor: '#186bf9', headingFont: 'Plus Jakarta Sans', bodyFont: 'Inter' };

function extractThemeFromPreviousEditionSources(sourceDocs) {
  var prev = (sourceDocs || []).filter(function (s) { return s && s.type === 'previousEdition'; });

  // extractColorSignals (see /api/ingest-source above) already orders each source's own colorSignals
  // most-saturated/frequent first — the first previousEdition source that has any is the pick.
  var themeColor = null;
  prev.some(function (s) {
    var signals = s.colorSignals || [];
    if (signals.length) { themeColor = signals[0]; return true; }
    return false;
  });

  // Fonts: tally every previousEdition source's own fontSignals (also already ranked per-source), weighting
  // each by its rank within that source, then pick the two most-frequent DISTINCT families across all of
  // them as heading/body.
  var tally = {};
  prev.forEach(function (s) {
    var signals = s.fontSignals || [];
    signals.forEach(function (family, idx) { tally[family] = (tally[family] || 0) + (signals.length - idx); });
  });
  var ranked = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; });
  var headingFont = ranked[0] || THEME_FALLBACK.headingFont;
  var bodyFont = (ranked[1] && ranked[1] !== headingFont) ? ranked[1] : (ranked.length ? THEME_FALLBACK.bodyFont : THEME_FALLBACK.bodyFont);

  return {
    themeColor: themeColor || THEME_FALLBACK.themeColor,
    headingFont: headingFont,
    bodyFont: bodyFont,
    usedFallback: { color: !themeColor, font: !ranked.length, noPreviousEditionSource: !prev.length }
  };
}

function googleFontUrl(family) {
  return 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':wght@300;400;500;600;700;800&display=swap';
}

/* ---- Hero background image: Gemini's image-generation endpoint ----
   Model/endpoint researched at the time this was written (Oct 2026) but NOT verified against a live key in
   this environment — Google's image-model names have moved fast. gemini-2.5-flash-image ("Nano Banana") is
   the one this code targets, called the same way callGeminiJson calls its text model (v1beta/models/
   <model>:generateContent, generationConfig.responseModalities), which is the pattern most consistently
   corroborated across sources seen during research. Some documentation seen during research already points
   at newer gemini-3.x-image model names and a separate, non-generateContent "Interactions" endpoint instead
   — this code deliberately does NOT adopt that unverified shape. Exactly like callGeminiJson's own
   gemini-3.8-flash retirement comment: if this model name is wrong or retired, Gemini's 404 names its
   replacement, caught below and logged — never thrown, never allowed to block or crash structure planning.
   Hero image generation is pure enhancement; its failure must always degrade to "no hero background image"
   (hero/style.css's own fallback — see the gap noted in this function's caller, buildHeroImage, below). */
function callGeminiImage(prompt) {
  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Promise.resolve({ error: 'GEMINI_API_KEY is not set.' });
  var model = 'gemini-2.5-flash-image';
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);
  var body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } };

  var controller = new AbortController();
  var timedOut = false;
  var timer = setTimeout(function () { timedOut = true; controller.abort(); }, 60000);
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
    .then(function (geminiRes) { return geminiRes.text().then(function (text) { return { ok: geminiRes.ok, status: geminiRes.status, text: text }; }); })
    .then(function (r) {
      if (!r.ok) return { error: 'Gemini image API error ' + r.status + ': ' + r.text.slice(0, 400) };
      var data;
      try { data = JSON.parse(r.text); } catch (e) { return { error: 'Gemini image response was not valid JSON.' }; }
      var parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      var imagePart = (parts || []).filter(function (p) { return p && p.inlineData && p.inlineData.data; })[0];
      if (!imagePart) return { error: 'Gemini image response had no image data (it may have been blocked by safety filters or the model/endpoint is wrong/retired).' };
      return { mimeType: imagePart.inlineData.mimeType || 'image/png', base64: imagePart.inlineData.data };
    })
    .catch(function (err) {
      if (timedOut) return { error: 'Gemini image generation took too long (over 60s).' };
      return { error: 'Could not reach Gemini for image generation: ' + err.message };
    })
    .finally(function () { clearTimeout(timer); });
}

function buildHeroImagePrompt(brief, themeColor) {
  return [
    'Generate an abstract, editorial background image for a professional event website\'s hero banner.',
    'Mood/theme to evoke: ' + (brief && brief.theme ? brief.theme : 'a professional conference') + '.',
    'Tone: ' + (brief && brief.tone ? brief.tone : 'formal, modern, polished') + '.',
    'Work the colour ' + themeColor + ' subtly into the composition as an accent.',
    'Abstract/geometric/gradient/light-and-depth composition only, suitable to sit behind white text and buttons.',
    'STRICT: no people, no faces, no crowds, no attendees, no venue photography, no recognizable real place, no text, no logos, no watermarks — this is an illustrative background, never a photo of an event that never happened.'
  ].join(' ');
}

// Generates the one hero background image, stores it (Firebase Storage, same pattern handleExtractBrief
// uses) and returns it as a base64 data URL too — ends up at content.map's existing, UNCHANGED
// hero.psdBanner.compositeImageData fill rule (templates/_library/sections/hero/map.json), the same slot a
// human-uploaded PSD banner composite already fills for ported templates, so no new fill logic is needed.
// GAP for the web designer (not fixed here, per instructions): templates/_library/sections/hero/style.css
// has no theme-coloured gradient fallback on #hero itself when hero-bg-image fails/stays the placeholder —
// only the dark overlay gradient ON TOP of whatever image is there. On image-generation failure, the hero
// still renders (the placeholder grey rect + dark overlay), just without a theme-coloured look.
function buildHeroImage(fb, eventId, brief, themeColor) {
  return callGeminiImage(buildHeroImagePrompt(brief, themeColor)).then(function (r) {
    if (r.error) {
      console.error('plan-structure: hero image generation failed, degrading to no hero image — ' + r.error);
      return { heroImageUrl: null, heroImageStoragePath: null, heroImageError: r.error };
    }
    var buffer = Buffer.from(r.base64, 'base64');
    var storagePath = 'events/' + eventId + '/generated/hero-bg.png';
    var file = fb.bucket.file(storagePath);
    /* The raw base64 (often several hundred KB-plus) must never go into Firestore directly — a single
       document is capped at 1MiB total, and an inline data: URI that size blew right through it the first
       time this ran ("Property theme contains an invalid nested entity"). The image already lives in
       Storage; Firestore only needs a real URL to it, same as any other image reference in this app. */
    return file.save(buffer, { metadata: { contentType: r.mimeType } })
      .then(function () { return file.makePublic(); })
      .then(function () {
        var heroImageUrl = 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath;
        return { heroImageUrl: heroImageUrl, heroImageStoragePath: storagePath, heroImageError: null };
      })
      .catch(function (err) {
        console.error('plan-structure: hero image generated but Storage save/publish failed, degrading to no hero image — ' + err.message);
        return { heroImageUrl: null, heroImageStoragePath: null, heroImageError: 'Storage save/publish failed: ' + err.message };
      });
  }).catch(function (err) {
    console.error('plan-structure: hero image generation threw unexpectedly, degrading to no hero image — ' + err.message);
    return { heroImageUrl: null, heroImageStoragePath: null, heroImageError: err.message };
  });
}

/* ---------- POST /api/plan-structure — GENERATED TEMPLATES pipeline, step A ----------
   Reads the event's latest brief + all its sources (same read as handleGenerateContent), asks Gemini which
   of the 7 "middle" library section types this event's real material actually supports and in what order
   (nav/hero/footer are fixed, never Gemini's call), extracts the previousEdition-only theme, generates the
   one hero background image, and persists {structurePlan, theme} onto the event's own doc — a doc, not a
   subcollection, latest plan/theme wins (see the handler below). */
var STRUCTURE_PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reasoning: { type: 'STRING', description: 'Internal only, never shown on the site. Name the specific content evidence behind each section you included or deliberately left out (e.g. "brief names 6 confirmed speakers -> speaker-grid", "no real FAQ material -> faq-accordion omitted").' },
    sections: {
      type: 'ARRAY',
      description: 'A subset of the 7 given middle section types, in the best reading order, no duplicates. Never include nav, hero or footer here — those are added automatically, not your decision.',
      items: { type: 'STRING', enum: STRUCTURE_MIDDLE_TYPES }
    }
  },
  required: ['reasoning', 'sections']
};

function buildPlanStructurePrompt(payload) {
  var lines = [
    'You are planning the SECTION STRUCTURE of a generated event microsite for ET Oneworld\'s event builder, choosing only from a fixed library of 10 generic, reusable section types. Ground every choice in real content-shape evidence from the material below — never include a section type that has nothing real to put in it, and never omit one the material clearly supports. A thin site with 3 well-grounded sections beats a padded one with 7 that have nothing real to say.',
    '',
    'The 10 library section types:',
    '- nav: top navigation. Always included, first — not your decision.',
    '- hero: banner (title/tagline/date/location/CTAs). Always included, pinned right after nav — not your decision.',
    '- overview: a generic rich-text block (subheading/heading/body + optional image). Include when there\'s a clear "about this event" narrative to tell.',
    '- stats-strip: 3-5 numeric callouts (e.g. "500+ Attendees"). Include only if the material has real numbers worth calling out.',
    '- cards-grid-icon: 3-column icon+title+line cards (e.g. key discussion points, why join). Include for ONE genuinely distinct card-list need.',
    '- cards-grid-chips: denser, icon-free chip cards (e.g. who should attend, industries in the room). Include only for a SECOND, genuinely DIFFERENT card-list need from cards-grid-icon\'s — never both for the same underlying list, and don\'t force a second one that isn\'t really there.',
    '- speaker-grid: speaker photo/name/role/company grid. Include only if the material implies a real, sizeable speaker roster — a passing name-drop or two isn\'t enough on its own.',
    '- faq-accordion: expandable Q&A. Include only if the material has (or clearly implies) a real, specific set of audience questions worth answering — not just because every event site has an FAQ.',
    '- cta-band: closing call-to-action band. Include when there\'s one clear closing pitch (register / partner / attend) worth a dedicated closing band.',
    '- footer: always included, last — not your decision.',
    '',
    'Event (already known):', JSON.stringify(payload.eventMeta || {}, null, 2)
  ];
  if (payload.brief) lines.push('', 'Extracted brief:', JSON.stringify(payload.brief, null, 2));
  if (payload.sources && payload.sources.length) {
    lines.push('', 'Collected sources (previous/current edition, competitors):');
    payload.sources.forEach(function (s) { lines.push('--- ' + s.type + ' (' + s.url + ') ---', JSON.stringify(s.extractedSections, null, 2)); });
  }
  lines.push('', 'Task: choose which of the 7 middle section types this event\'s real material actually supports, and the best reading order for them.');
  return lines.join('\n');
}

function sanitizeStructurePlan(parsed) {
  var seen = {};
  var middle = (Array.isArray(parsed.sections) ? parsed.sections : []).filter(function (t) {
    if (STRUCTURE_MIDDLE_TYPES.indexOf(t) === -1 || seen[t]) return false;
    seen[t] = true;
    return true;
  });
  return ['nav', 'hero'].concat(middle, ['footer']);
}

function handlePlanStructure(req, res) {
  readBody(req, function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    var eventId = String(payload.eventId || '').trim();
    if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
    if (!/^[a-z0-9-]+$/.test(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    var eventRef = fb.db.collection('events').doc(eventId);
    Promise.all([
      eventRef.get(),
      eventRef.collection('briefs').orderBy('createdAt', 'desc').limit(1).get(),
      eventRef.collection('sources').get()
    ]).then(function (results) {
      var eventSnap = results[0], briefSnap = results[1], sourcesSnap = results[2];
      var eventMeta = eventSnap.exists ? eventSnap.data() : {};
      var brief = briefSnap.empty ? null : briefSnap.docs[0].data().extracted;
      var sourceDocs = sourcesSnap.docs.map(function (d) { return d.data(); });
      var sources = sourceDocs.map(function (v) { return { type: v.type, url: v.url, extractedSections: v.extractedSections }; });

      var themeInfo = extractThemeFromPreviousEditionSources(sourceDocs);

      return callGeminiJson(buildPlanStructurePrompt({ eventMeta: eventMeta, brief: brief, sources: sources }), STRUCTURE_PLAN_SCHEMA).then(function (r) {
        if (r.error) return sendJson(res, r.status, { error: r.error });
        var sections = sanitizeStructurePlan(r.parsed);
        var now = new Date().toISOString();

        return buildHeroImage(fb, eventId, brief, themeInfo.themeColor).then(function (heroImage) {
          var structurePlan = { sections: sections, generatedAt: now };
          var theme = {
            themeColor: themeInfo.themeColor, headingFont: themeInfo.headingFont, bodyFont: themeInfo.bodyFont,
            usedFallback: themeInfo.usedFallback,
            heroImageUrl: heroImage.heroImageUrl, heroImageStoragePath: heroImage.heroImageStoragePath, heroImageError: heroImage.heroImageError,
            generatedAt: now
          };
          return eventRef.set({ structurePlan: structurePlan, theme: theme }, { merge: true })
            .then(function () { sendJson(res, 200, { eventId: eventId, structurePlan: structurePlan, theme: theme }); });
        });
      });
    }).catch(function (err) { sendJson(res, 500, { error: 'plan-structure failed: ' + err.message }); });
  });
}

/* ---------- POST /api/generate-content — AI site-generation pipeline, step 3 ----------
   Reads the event's latest brief + all its sources (already collected by extract-brief/ingest-source),
   reads the TARGET TEMPLATE's own content.map to work out exactly which Create Event library ids it can
   use and in what shape, asks Gemini to fill them grounded in that research, and saves the result as a
   draft. The output is deliberately shaped exactly like what create-event.html's wizard would have
   produced (templates/README.md's "one content model for every template"), so it's a drop-in for
   editor-fill.js — no new client-side fill logic needed.

   What's generated vs. deliberately left alone, and why (mirrors choices already made in the ported
   templates themselves — see e.g. templates/making-ai-work/template.json's own content.notes):
   - event / hero: name, date, location, title, tagline, CTAs — grounded, left blank rather than guessed.
   - any content.map entry with an `intro` and/or a {t,d} card list (about, priorities, whyjoin, attend, a
     template's own custom library ids like "keyquestions", …): generated, since this is real structural
     content the research can ground.
   - `speakers`: NEVER generated — a real name needs a real person behind it, and the research here is
     page summaries, not a verified speaker roster. Inventing one would be exactly the kind of fabricated
     fact this whole pipeline is built to avoid.
   - `contact` / `glimpses`: never generated — no real emails/phone numbers exist to fill `contact` with,
     and `glimpses` is a photo-count toggle (see the template's own notes on why Create Event can't fill it
     either). Both keep the template's own default content, same as an un-filled wizard section would. */

// Library ids classifyLibraryNeeds deliberately never generates for (see the handler's header comment for
// why) — named here instead of just inlined in the `if` below, so handleGenerateContent can report this
// EXACT list back to the client (see deliberatelySkippedLibraries right below). C2/C3: editor-fill.js's
// AI-provenance skip-marking used to re-derive "what's AI's territory" from content.map presence alone,
// which can't tell "deliberately excluded from generation" (this list) apart from "genuinely generated" —
// speakers/contact/glimpses DO have real content.map entries, they're just never asked to generate into.
// That mismatch meant those sections got neither the "AI-generated" nor the "not generated" badge. Pulling
// the one real exclusion list out here, and threading it through to the client (handleGenerateContent ->
// the stored draft -> handleGetDraft -> the handoff payload -> editor-fill.js), lets the client use the
// SAME list the server actually used instead of guessing.
var GENERATION_EXCLUDED_LIBRARIES = ['speakers', 'contact', 'glimpses'];

// Figures out, from a template's own content.map, which library ids this generation step can safely fill
// and in what shape — generic (intro-driven: subheading/heading/body/cta) and/or a card list (items:{t,d}).
// GENERATION_EXCLUDED_LIBRARIES/`event` are hardcoded skips: see the handler's header comment for why.
function classifyLibraryNeeds(map) {
  var needs = {};
  (map || []).forEach(function (entry) {
    var from = entry.from;
    if (!from || from === 'event' || GENERATION_EXCLUDED_LIBRARIES.indexOf(from) !== -1) return;
    if (needs[from]) return; // a library can feed more than one section of the same template; classify once
    var hasList = (entry.fill || []).some(function (r) {
      return r && r.list && typeof r.items === 'string' && /\.items$/.test(r.items) &&
        typeof r.require === 'string' && r.require.indexOf('{t}') !== -1 && r.require.indexOf('{d}') !== -1;
    });
    var hasIntro = !!entry.intro;
    if (!hasIntro && !hasList) return; // nothing this step knows how to generate for it
    needs[from] = { hasIntro: hasIntro, hasList: hasList };
  });
  return needs;
}

// The subset of GENERATION_EXCLUDED_LIBRARIES this particular template's content.map actually targets
// (e.g. a template with no `contact` section at all has nothing to report for "contact"). This is what
// actually rides through to the client — see the comment on GENERATION_EXCLUDED_LIBRARIES above.
function deliberatelySkippedLibraries(map) {
  var found = {};
  (map || []).forEach(function (entry) {
    if (entry.from && GENERATION_EXCLUDED_LIBRARIES.indexOf(entry.from) !== -1) found[entry.from] = 1;
  });
  return Object.keys(found);
}

function buildGenerateSchema(needs) {
  var props = {
    positioningNotes: { type: 'STRING', description: 'Internal only, never shown on the site — see the prompt for what this must name concretely.' },
    event: { type: 'OBJECT', properties: { name: { type: 'STRING' }, date: { type: 'STRING' }, location: { type: 'STRING' } }, required: ['name', 'date', 'location'] },
    hero: { type: 'OBJECT', properties: { title: { type: 'STRING' }, tagline: { type: 'STRING' }, cta1: { type: 'STRING' }, cta2: { type: 'STRING' } }, required: ['title', 'tagline', 'cta1', 'cta2'] }
  };
  var required = ['positioningNotes', 'event', 'hero'];
  Object.keys(needs).forEach(function (from) {
    var need = needs[from];
    var p = {};
    if (need.hasIntro) { p.subheading = { type: 'STRING' }; p.heading = { type: 'STRING' }; p.body = { type: 'STRING' }; p.ctaLabel = { type: 'STRING' }; }
    if (need.hasList) { p.items = { type: 'ARRAY', items: { type: 'OBJECT', properties: { t: { type: 'STRING' }, d: { type: 'STRING' } }, required: ['t', 'd'] } }; }
    props[from] = { type: 'OBJECT', properties: p, required: Object.keys(p) };
    required.push(from);
  });
  return { type: 'OBJECT', properties: props, required: required };
}

function buildGenerateContentPrompt(payload) {
  var ownHistory = (payload.sources || []).filter(function (s) { return s.type !== 'competitor'; });
  var competitors = (payload.sources || []).filter(function (s) { return s.type === 'competitor'; });

  var lines = [
    'You are generating REAL content for an event microsite, for ET Oneworld\'s event builder. Ground every fact below — never invent a date, number, named person or company that isn\'t clearly present in the material. An empty string/array is the correct answer when nothing grounded supports a field; never pad with generic filler just to fill it in.',
    '',
    'Event (already known — fill in event.name/date/location below only if the material confirms or refines this):',
    JSON.stringify(payload.eventMeta || {}, null, 2)
  ];
  if (payload.brief) {
    lines.push('', 'Extracted brief from the event\'s own overview document:', JSON.stringify(payload.brief, null, 2));
  }
  if (payload.futureEdition) {
    lines.push('', 'IMPORTANT: this is a FUTURE edition that has not happened yet and has no logistics decided — the "own history" sources below are PAST editions, not this one. Project the THEME forward sensibly from how it has evolved across those past editions (what moved from edition to edition — don\'t just repeat the most recent one\'s angle), but never invent a specific date, venue, speaker or sponsor for this edition — those aren\'t known yet. event.date/location must stay blank unless the eventMeta given above already states them.');
  }
  if (ownHistory.length) {
    lines.push('', 'This event\'s OWN history (previous/current edition) — your primary source of real facts and theme, but do not simply restate or lightly reword it. The job is a genuine improvement, not a refresh.');
    ownHistory.forEach(function (s) { lines.push('--- ' + s.type + ' (' + s.url + ') ---', JSON.stringify(s.extractedSections, null, 2)); });
  }
  if (competitors.length) {
    lines.push('', 'COMPETITOR events running something similar — read these specifically to find what they do that this event\'s own history above does NOT: a sharper audience framing, a track or angle missing from this event, a stronger hook, a format this event lacks. You must identify at least one such gap and actively close it in your output (in this event\'s own voice, never their wording) — this is not optional background reading.');
    competitors.forEach(function (s) { lines.push('--- ' + s.type + ' (' + s.url + ') ---', JSON.stringify(s.extractedSections, null, 2)); });
  }
  lines.push(
    '',
    'Task — produce:',
    '- positioningNotes: 1-2 sentences, for internal review only (never shown on the site) — name the ONE specific thing you adapted FROM a competitor (or state "no competitor material was given" if none was provided) and the ONE specific thing you deliberately did NOT just carry over from this event\'s own previous edition. Be concrete (name the competitor/section), not generic.',
    '- event.name/date/location: only if clearly and consistently stated above; prefer this event\'s own current-edition/brief facts over a competitor\'s.',
    '- hero.title/tagline: a strong, specific headline and one-line tagline for THIS event\'s real theme — not generic conference copy, not a near-paraphrase of the previous edition\'s own headline, and never just the event\'s own name restated (that\'s what event.name is for).',
    '- hero.cta1/cta2: short button labels (e.g. "Register Now", "Partner With Us") only if a real call to action is implied; else leave blank.'
  );
  Object.keys(payload.needs).forEach(function (from) {
    var need = payload.needs[from];
    var bits = [];
    if (need.hasIntro) bits.push('a short section intro: subheading/heading/body/ctaLabel');
    if (need.hasList) bits.push('items: 3-5 cards, each {t: short heading, d: one-sentence body}, grounded in real points from the material');
    lines.push('- ' + from + ': ' + bits.join(' + '));
  });
  return lines.join('\n');
}

function sanitizeGeneratedLibrary(parsed, needs) {
  function str(v, max) { return String(v || '').trim().slice(0, max || 300); }
  var out = {
    event: { name: str(parsed.event && parsed.event.name, 120), date: str(parsed.event && parsed.event.date, 60), location: str(parsed.event && parsed.event.location, 120) },
    hero: { title: str(parsed.hero && parsed.hero.title, 150), tagline: str(parsed.hero && parsed.hero.tagline, 200), cta1: str(parsed.hero && parsed.hero.cta1, 40), cta2: str(parsed.hero && parsed.hero.cta2, 40) }
  };
  Object.keys(needs).forEach(function (from) {
    var need = needs[from], src = (parsed[from] || {}), entry = {};
    if (need.hasIntro) {
      entry.subheading = str(src.subheading, 80); entry.heading = str(src.heading, 150); entry.body = str(src.body, 500);
      if (src.ctaLabel) entry.cta = { label: str(src.ctaLabel, 40) };
    }
    if (need.hasList) {
      entry.items = (Array.isArray(src.items) ? src.items : []).slice(0, 6)
        .map(function (it) { return { t: str(it.t, 100), d: str(it.d, 300) }; })
        .filter(function (it) { return it.t || it.d; });
    }
    out[from] = entry;
  });
  return out;
}

// The shared tail of handleGenerateContent, UNCHANGED from before the 'gen-' branch existed — reads
// brief/sources for sourceEventId, builds the schema/prompt from `needs`, calls Gemini, sanitizes, saves the
// draft under eventId. Fed either a real template's content.map (ported-template path) or a combined
// library content.map (generated-template path, see handleGenerateContent below) — this function itself
// doesn't know or care which. `genTheme` is non-null ONLY on the generated-template path, so its hero image
// (if any) can be spliced into the sanitized library's hero.psdBanner — the existing, unchanged
// hero.psdBanner.compositeImageData fill rule (templates/_library/sections/hero/map.json) then picks it up
// with zero new fill logic, same slot a human-uploaded PSD banner composite already fills for ported
// templates.
function runGenerateContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, contentMap, skippedLibraries, genTheme) {
  var needs = classifyLibraryNeeds(contentMap);
  if (!Object.keys(needs).length) return sendJson(res, 400, { error: 'This template has no content.map entries this step knows how to generate for.' });

  var draftRef = fb.db.collection('events').doc(eventId);
  var sourceRef = fb.db.collection('events').doc(sourceEventId);
  Promise.all([
    sourceRef.get(),
    sourceRef.collection('briefs').orderBy('createdAt', 'desc').limit(1).get(),
    sourceRef.collection('sources').get()
  ]).then(function (results) {
    var eventSnap = results[0], briefSnap = results[1], sourcesSnap = results[2];
    // eventMeta.* from the request (e.g. {name:"ET Making AI Work 2027", date:"2027"}) wins over whatever
    // is stored for sourceEventId — that stored data describes the PAST edition being read for research,
    // not necessarily the one actually being generated.
    var eventMeta = Object.assign({}, eventSnap.exists ? eventSnap.data() : {}, payload.eventMeta || {});
    var brief = briefSnap.empty ? null : briefSnap.docs[0].data().extracted;
    var sources = sourcesSnap.docs.map(function (d) {
      var v = d.data();
      return { type: v.type, url: v.url, extractedSections: v.extractedSections };
    });

    var schema = buildGenerateSchema(needs);
    var prompt = buildGenerateContentPrompt({ eventMeta: eventMeta, brief: brief, sources: sources, needs: needs, futureEdition: futureEdition });

    return callGeminiJson(prompt, schema).then(function (r) {
      if (r.error) return sendJson(res, r.status, { error: r.error });
      var library = sanitizeGeneratedLibrary(r.parsed, needs);
      if (genTheme && genTheme.heroImageUrl && library.hero) {
        library.hero.psdBanner = { compositeImageData: genTheme.heroImageUrl };
      }
      var positioningNotes = String(r.parsed.positioningNotes || '').trim().slice(0, 500);
      var now = new Date().toISOString();
      return draftRef.collection('drafts').add({ templateId: templateId, sourceEventId: sourceEventId, library: library, positioningNotes: positioningNotes, model: 'gemini-3.8-flash', generatedAt: now, skippedLibraries: skippedLibraries })
        .then(function (docRef) { sendJson(res, 200, { eventId: eventId, templateId: templateId, draftId: docRef.id, positioningNotes: positioningNotes, library: library }); });
    });
  }).catch(function (err) { sendJson(res, 500, { error: 'generate-content failed: ' + err.message }); });
}

function handleGenerateContent(req, res) {
  readBody(req, function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    var eventId = String(payload.eventId || '').trim();
    var templateId = String(payload.templateId || '').trim();
    // sourceEventId: where to read the brief/sources FROM — defaults to eventId, but a not-yet-run future
    // edition (e.g. "making-ai-work-2027") has no sources of its own yet; it reads the same event series'
    // already-collected research (e.g. "making-ai-work", whose 2025/2026 editions are real past history)
    // and writes its own draft under its own eventId, so it never collides with that series' current draft.
    var sourceEventId = String(payload.sourceEventId || eventId).trim();
    var futureEdition = !!payload.futureEdition;
    if (!eventId || !templateId) return sendJson(res, 400, { error: 'eventId and templateId are required.' });
    if (!/^[a-z0-9-]+$/.test(templateId)) return sendJson(res, 400, { error: 'Invalid templateId.' });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    // GENERATED TEMPLATES: templateId:'gen-<eventId>' has no templates/<id>/template.json on disk at all —
    // its content.map is instead the combined library map.json fragments for whatever /api/plan-structure
    // already chose and saved on events/{genEventId} (structurePlan/theme). Everything from here down
    // (classifyLibraryNeeds -> buildGenerateSchema -> buildGenerateContentPrompt -> Gemini -> sanitize) is
    // the exact same pipeline the ported-template path below uses, via runGenerateContent — this branch's
    // ONLY new logic is building `contentMap`/`skippedLibraries`/`genTheme` from Firestore instead of from
    // a real template.json.
    if (/^gen-/.test(templateId)) {
      var genEventId = templateId.slice(4);
      if (!genEventId || !/^[a-z0-9-]+$/.test(genEventId)) return sendJson(res, 400, { error: 'Invalid templateId.' });
      return fb.db.collection('events').doc(genEventId).get().then(function (snap) {
        var data = snap.exists ? snap.data() : {};
        var plan = data.structurePlan;
        if (!plan || !Array.isArray(plan.sections) || !plan.sections.length) {
          return sendJson(res, 400, { error: 'No structure plan found for "' + genEventId + '" — run /api/plan-structure first.' });
        }
        var contentMap = buildCombinedLibraryMap(plan.sections, !!(data.theme && data.theme.heroImageUrl));
        var skippedLibraries = deliberatelySkippedLibraries(contentMap);
        runGenerateContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, contentMap, skippedLibraries, data.theme || null);
      }).catch(function (err) { sendJson(res, 500, { error: 'generate-content failed: ' + err.message }); });
    }

    var templatePath = path.join(__dirname, '..', '..', 'templates', templateId, 'template.json');
    var templateJson;
    try { templateJson = JSON.parse(fs.readFileSync(templatePath, 'utf8')); }
    catch (e) { return sendJson(res, 400, { error: 'Could not read template "' + templateId + '": ' + e.message }); }

    // A2/E2: create-event.html's own picker UI (TEMPLATES[].briefReady) already keeps templates with known
    // wrong-event bleed-through out of the "Generate from a brief" dropdown, but that's a client-side nicety
    // only — nothing stopped POSTing straight to this endpoint with e.g. templateId:'cx-leaders-forum' and
    // generating real content into a template whose banner still shows a DIFFERENT real event's branding.
    // This is the actual gate: template.json (the stated source of truth for template metadata) must itself
    // say briefReady:true, checked here server-side, every time, regardless of what called this endpoint.
    if (templateJson.briefReady !== true) {
      return sendJson(res, 400, {
        error: 'Template "' + templateId + '" is not ready for brief-based generation' +
          (templateJson.briefReadyNote ? ' (' + templateJson.briefReadyNote + ')' : '') + '.'
      });
    }

    // C2/C3: the real "deliberately excluded from generation" list (speakers/contact/glimpses, when this
    // template actually has them) — saved on the draft and threaded through to the client (see
    // libraryToHandoffDraft/handleGetDraft below) so editor-fill.js's AI-provenance skip-marking can use the
    // exact same list this request used, instead of re-deriving an incomplete one from content.map alone.
    // (classifyLibraryNeeds itself — and its "nothing to generate for" check — now live inside
    // runGenerateContent, shared with the 'gen-' branch above.)
    var skippedLibraries = deliberatelySkippedLibraries((templateJson.content || {}).map);

    runGenerateContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, (templateJson.content || {}).map, skippedLibraries, null);
  });
}

/* ---------- GET /api/draft — fetches the latest generated draft, pre-shaped for the editor ----------
   Turns a stored draft's `library` (what /api/generate-content produced and saved) into the exact
   `revamp.editor.handoff.v1` shape the real wizard hand-off uses: {event, sections:[{libId,name,data}], …}.
   Used by preview-draft.html so a generated draft can be opened from a plain URL — no manual payload
   wiring per event, and it works the same locally and once deployed. */
function libraryToHandoffDraft(library, eventId, skippedLibraries) {
  library = library || {};
  var ev = library.event || {};
  var sections = Object.keys(library)
    .filter(function (k) { return k !== 'event'; })
    .map(function (libId) { return { libId: libId, name: libId, data: library[libId] }; });
  return {
    event: {
      name: ev.name || '', slug: eventId, date: ev.date ? { mode: 'tbd', note: ev.date } : null,
      dateLabel: ev.date || '',   // editor-template-ui.js's showTopbar() reads this string separately from the date object above
      location: ev.location || '', hasVenue: !!ev.location
    },
    sections: sections, excluded: [], sectionOrder: null,
    // C2/C3: the real library ids classifyLibraryNeeds deliberately never generated for on THIS draft's
    // template (speakers/contact/glimpses, whichever this template actually has) — see
    // GENERATION_EXCLUDED_LIBRARIES/deliberatelySkippedLibraries above. editor-fill.js's apply() uses this
    // to mark those sections data-ai-skipped even though they DO carry a real content.map entry (just
    // never invoked), instead of re-deriving "what's AI's territory" from content.map presence alone.
    aiSkippedLibraries: skippedLibraries || []
  };
}

function handleGetDraft(req, res) {
  var qs = new URLSearchParams(req.url.split('?')[1] || '');
  var eventId = String(qs.get('eventId') || '').trim();
  if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  fb.db.collection('events').doc(eventId).collection('drafts').orderBy('generatedAt', 'desc').limit(1).get()
    .then(function (snap) {
      if (snap.empty) return sendJson(res, 404, { error: 'No generated draft found for "' + eventId + '" — run /api/generate-content first.' });
      var draftId = snap.docs[0].id, draft = snap.docs[0].data();
      sendJson(res, 200, { eventId: eventId, templateId: draft.templateId, draftId: draftId, handoff: libraryToHandoffDraft(draft.library, eventId, draft.skippedLibraries) });
    })
    .catch(function (err) { sendJson(res, 500, { error: 'get-draft failed: ' + err.message }); });
}

/* ---------- GET /api/generated-template?eventId=<id> — GENERATED TEMPLATES pipeline, step C ----------
   Assembles the exact template.json shape (see the top-of-file comment and the contract shared with the
   frontend's template-loader.js) from the structurePlan + theme /api/plan-structure already saved on
   events/{eventId}. No "theme" key: every theme/colour value goes straight into body.style as inline CSS
   custom properties, computed fresh on every request — no Storage round-trip, no separate theme.css file. */
function buildGeneratedDesign(theme) {
  return {
    headingFontVar: '--heading-font-family',
    headings: 'h1, h2, h3',
    buttons: '.btn-primary, .btn-secondary, .hero-cta-primary, .hero-cta-secondary, .cta-band-btn',
    cards: '.stat-item, .cards-icon-card, .chip-card, .speaker-card, .faq-item',
    swatches: [theme.themeColor]
  };
}

function fontStack(family) { return '"' + family + '", Arial, sans-serif'; }

function handleGeneratedTemplate(req, res) {
  var qs = new URLSearchParams(req.url.split('?')[1] || '');
  var eventId = String(qs.get('eventId') || '').trim();
  if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
  if (!/^[a-z0-9-]+$/.test(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  fb.db.collection('events').doc(eventId).get().then(function (snap) {
    if (!snap.exists) return sendJson(res, 404, { error: 'No event found for "' + eventId + '".' });
    var data = snap.data();
    var plan = data.structurePlan;
    if (!plan || !Array.isArray(plan.sections) || !plan.sections.length) {
      return sendJson(res, 404, { error: 'No structure plan found for "' + eventId + '" — run /api/plan-structure first.' });
    }
    var theme = Object.assign({}, THEME_FALLBACK, data.theme || {});
    var name = String(data.name || eventId);
    var fonts = [googleFontUrl(theme.headingFont), googleFontUrl(theme.bodyFont)]
      .filter(function (url, i, arr) { return arr.indexOf(url) === i; });

    var template = {
      id: 'gen-' + eventId,
      name: name,
      title: name,
      shared: ['et-global.css', 'et-animate.css', 'et-platform.css'],
      fonts: fonts,
      design: buildGeneratedDesign(theme),
      body: {
        id: 'gen',
        class: 'microsite product_microsite',
        // picked up by footer/script.js at runtime (document.body.dataset.rvEventId) so the real
        // registration POST knows which event it's for — a plain DOM attribute, so it rides through
        // canvas.serialize() into the actually-published static page the same as any other markup.
        eventId: eventId,
        style: {
          '--theme-color': theme.themeColor,
          '--heading-font-family': fontStack(theme.headingFont),
          '--body-font-family': fontStack(theme.bodyFont),
          '--default-color': 'rgb(25 27 31)',
          '--body-color': 'rgba(0, 0, 0, 1)'
        }
      },
      content: { map: buildCombinedLibraryMap(plan.sections, !!theme.heroImageUrl) },
      layout: { pinStart: ['hero'], pinEnd: ['footer'] },
      // `script: true` when this library section type ships its own script.js (templates/_shared/
      // template-loader.js only ever fetches/inlines one when this flag is set) — previously never set
      // here at all, so EVERY generated page silently never loaded ANY section script, including
      // faq-accordion's own open/close interactivity (a real, separate bug: its accordion has been inert
      // on every generated page). fs.existsSync keeps this correct automatically as section types gain
      // their own script.js later, rather than a hardcoded list that would silently drift out of sync.
      sections: plan.sections.map(function (type) {
        var hasScript = fs.existsSync(path.join(LIBRARY_SECTIONS_DIR, type, 'script.js'));
        return { id: type, name: SECTION_TYPE_LABELS[type] || type, etId: null, script: hasScript };
      })
    };
    sendJson(res, 200, template);
  }).catch(function (err) { sendJson(res, 500, { error: 'generated-template failed: ' + err.message }); });
}

/* =====================================================================================================
   EVENT CONSOLE — real Firestore data for edit-event.html and its sibling tabs, replacing the hardcoded
   window.RevampCore.EVENTS[] array + localStorage every tab used before. See lib/firebase.js's header
   comment for the full schema this section implements.
   ===================================================================================================== */

/* ---------- auth gate ----------
   Every admin-write/read route below (everything except the public POST /api/register) requires a
   verified Firebase Auth ID token in `Authorization: Bearer <token>` — this is the first auth check
   anywhere in this file; every endpoint above this point remains exactly as unauthenticated as it always
   was (a known, separately-tracked gap, not something this change silently expands or narrows).
   `cb(fb, decoded)` only runs once the token is confirmed real; `decoded.email`/`decoded.uid` is what gets
   stamped as `createdBy` on anything this session creates. */
function requireAdmin(req, res, cb) {
  var header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  var m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return sendJson(res, 401, { error: 'Sign in required — missing Authorization: Bearer <token> header.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  fb.auth.verifyIdToken(m[1]).then(function (decoded) {
    // a real sign-in isn't enough: only Google accounts on the company domain (access.js)
    if (!isAllowedUser(decoded)) return sendJson(res, 403, { error: deniedMessage() });
    cb(fb, decoded);
  }).catch(function () {
    sendJson(res, 401, { error: 'Your sign-in has expired or is invalid — please log in again.' });
  });
}

function parseJsonBody(req, res, cb) {
  readBody(req, function (raw) {
    var body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
    cb(body);
  });
}

/* ---------- generic per-event subcollection CRUD ----------
   Nine of the console's tabs (speakers/speaker-groups/sessions/agenda-groups/partners/partner-tiers/
   gallery/faqs/contacts) are structurally identical: a flat list of records under events/{eventId}/<name>,
   each with a server-assigned id, created/updated by an admin, read back as a plain array. Rather than
   hand-write the same list/create/update/remove four times over for each of the 9 (36 near-identical
   handlers), this factory builds all four from just the collection name + its allowed field list — every
   resource below is one line registering its own shape, not its own copy of this logic. `fields` is a
   strict allow-list: only named fields are ever read off the request body, so a client can't smuggle an
   arbitrary field (e.g. `createdBy`) into a write by just including it in the JSON. */
function subcollectionRoutes(name, fields) {
  function sanitize(body) {
    var out = {};
    fields.forEach(function (f) {
      if (Object.prototype.hasOwnProperty.call(body, f)) out[f] = body[f];
    });
    return out;
  }
  function col(fb, eventId) { return fb.db.collection('events').doc(eventId).collection(name); }

  function list(req, res) {
    requireAdmin(req, res, function (fb) {
      var qs = new URLSearchParams(req.url.split('?')[1] || '');
      var eventId = String(qs.get('eventId') || '').trim();
      if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
      col(fb, eventId).get()
        .then(function (snap) {
          var items = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          items.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
          sendJson(res, 200, { items: items });
        })
        .catch(function (err) { sendJson(res, 500, { error: name + ' list failed: ' + err.message }); });
    });
  }
  function create(req, res) {
    requireAdmin(req, res, function (fb, decoded) {
      parseJsonBody(req, res, function (body) {
        var eventId = String(body.eventId || '').trim();
        if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
        var data = sanitize(body);
        var now = new Date().toISOString();
        data.createdAt = now; data.updatedAt = now; data.createdBy = decoded.email || decoded.uid;
        col(fb, eventId).add(data)
          .then(function (ref) { sendJson(res, 200, { id: ref.id }); })
          .catch(function (err) { sendJson(res, 500, { error: name + ' create failed: ' + err.message }); });
      });
    });
  }
  function update(req, res) {
    requireAdmin(req, res, function (fb) {
      parseJsonBody(req, res, function (body) {
        var eventId = String(body.eventId || '').trim();
        var id = String(body.id || '').trim();
        if (!eventId || !id) return sendJson(res, 400, { error: 'eventId and id are required.' });
        var data = sanitize(body);
        data.updatedAt = new Date().toISOString();
        col(fb, eventId).doc(id).set(data, { merge: true })
          .then(function () { sendJson(res, 200, { ok: true }); })
          .catch(function (err) { sendJson(res, 500, { error: name + ' update failed: ' + err.message }); });
      });
    });
  }
  function remove(req, res) {
    requireAdmin(req, res, function (fb) {
      var qs = new URLSearchParams(req.url.split('?')[1] || '');
      var eventId = String(qs.get('eventId') || '').trim();
      var id = String(qs.get('id') || '').trim();
      if (!eventId || !id) return sendJson(res, 400, { error: 'eventId and id are required.' });
      col(fb, eventId).doc(id).delete()
        .then(function () { sendJson(res, 200, { ok: true }); })
        .catch(function (err) { sendJson(res, 500, { error: name + ' delete failed: ' + err.message }); });
    });
  }
  return { list: list, create: create, update: update, remove: remove };
}

// Field shapes taken directly from edit-event.html's own existing in-memory objects (S.speakers[]/
// S.sessions[]/S.partners[] etc.) — the console UI itself barely changes, only its load/save calls move
// from localStorage to these endpoints.
var RESOURCES = {
  'speakers': subcollectionRoutes('speakers', ['name', 'desig', 'comp', 'photoUrl', 'logoUrl', 'colour', 'weight', 'status', 'email', 'phone', 'li', 'bio', 'groupId', 'order']),
  'speaker-groups': subcollectionRoutes('speakerGroups', ['name', 'order']),
  'sessions': subcollectionRoutes('sessions', ['title', 'start', 'end', 'kind', 'speakerIds', 'desc', 'room', 'weight', 'groupId', 'order']),
  'agenda-groups': subcollectionRoutes('agendaGroups', ['name', 'date', 'order']),
  'partners': subcollectionRoutes('partners', ['name', 'url', 'logoUrl', 'weight', 'status', 'email', 'phone', 'contact', 'note', 'tierId', 'order']),
  'partner-tiers': subcollectionRoutes('partnerTiers', ['name', 'weight', 'order']),
  'gallery': subcollectionRoutes('gallery', ['imageUrl', 'caption', 'order']),
  'faqs': subcollectionRoutes('faqs', ['question', 'answer', 'order']),
  'contacts': subcollectionRoutes('contacts', ['label', 'name', 'email', 'phone', 'order'])
};

/* ---------- canonical Event: POST/GET/PATCH /api/event ----------
   Formalizes events/{eventId} — previously only ever touched as a side effect of the AI brief/structure
   pipeline (handleExtractBrief/handlePlanStructure's merge:true writes) — into a real, directly
   create/read/update-able record. Both of create-event.html's creation paths (manual wizard and
   Generate-from-Brief) call POST here now; before this, the manual path created no Firestore doc at all. */
// Deliberately NOT 'theme': that field name is already owned by the GENERATED TEMPLATES pipeline
// (handlePlanStructure writes {themeColor, headingFont, bodyFont, heroImageUrl, ...} there) — the
// console's own Theme tab is an unrelated, simpler concept (one of 4 named colour presets, a plain
// string). Letting the console PATCH 'theme' would silently overwrite/corrupt a generated event's real
// theme object the next time someone opened that tab, breaking its actual rendered page. 'paletteTheme'
// keeps the two completely separate until/unless they're deliberately unified.
var EVENT_FIELDS = ['name', 'slug', 'category', 'status', 'start', 'end', 'venue', 'city', 'description',
  'payment', 'sections', 'nav', 'templateId', 'checklist', 'published', 'paletteTheme'];

function handleEventCreate(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    parseJsonBody(req, res, function (body) {
      var eventId = String(body.eventId || body.slug || '').trim();
      if (!eventId || !/^[a-z0-9-]+$/.test(eventId)) {
        return sendJson(res, 400, { error: 'A valid eventId/slug (lowercase letters, digits, hyphens) is required.' });
      }
      var data = {};
      EVENT_FIELDS.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(body, f)) data[f] = body[f]; });
      var now = new Date().toISOString();
      data.createdAt = now; data.updatedAt = now; data.createdBy = decoded.email || decoded.uid;
      if (data.status === undefined) data.status = 'draft';
      if (data.published === undefined) data.published = false;
      fb.db.collection('events').doc(eventId).set(data, { merge: true })
        .then(function () { sendJson(res, 200, { eventId: eventId }); })
        .catch(function (err) { sendJson(res, 500, { error: 'event create failed: ' + err.message }); });
    });
  });
}

function handleEventGet(req, res) {
  requireAdmin(req, res, function (fb) {
    var qs = new URLSearchParams(req.url.split('?')[1] || '');
    var eventId = String(qs.get('eventId') || '').trim();
    if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
    fb.db.collection('events').doc(eventId).get().then(function (snap) {
      if (!snap.exists) return sendJson(res, 404, { error: 'No event found for "' + eventId + '".' });
      sendJson(res, 200, Object.assign({ eventId: eventId }, snap.data()));
    }).catch(function (err) { sendJson(res, 500, { error: 'event get failed: ' + err.message }); });
  });
}

function handleEventUpdate(req, res) {
  requireAdmin(req, res, function (fb) {
    parseJsonBody(req, res, function (body) {
      var eventId = String(body.eventId || '').trim();
      if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
      var data = {};
      EVENT_FIELDS.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(body, f)) data[f] = body[f]; });
      data.updatedAt = new Date().toISOString();
      fb.db.collection('events').doc(eventId).set(data, { merge: true })
        .then(function () { sendJson(res, 200, { ok: true }); })
        .catch(function (err) { sendJson(res, 500, { error: 'event update failed: ' + err.message }); });
    });
  });
}

/* ---------- GET /api/event/registrations, GET /api/event/dashboard-stats ----------
   dashboard-stats is a server-side aggregation (not a full-list pull the client reduces itself) — the
   Dashboard tab's 4 stat tiles need exactly these numbers, nothing more, and an event with thousands of
   registrations shouldn't ship its entire list to the browser just to show a count. */
function handleEventRegistrationsList(req, res) {
  requireAdmin(req, res, function (fb) {
    var qs = new URLSearchParams(req.url.split('?')[1] || '');
    var eventId = String(qs.get('eventId') || '').trim();
    if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
    fb.db.collection('events').doc(eventId).collection('registrations').orderBy('createdAt', 'desc').limit(1000).get()
      .then(function (snap) { sendJson(res, 200, { items: snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }) }); })
      .catch(function (err) { sendJson(res, 500, { error: 'registrations list failed: ' + err.message }); });
  });
}

function handleEventDashboardStats(req, res) {
  requireAdmin(req, res, function (fb) {
    var qs = new URLSearchParams(req.url.split('?')[1] || '');
    var eventId = String(qs.get('eventId') || '').trim();
    if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
    fb.db.collection('events').doc(eventId).collection('registrations').get()
      .then(function (snap) {
        var regs = snap.docs.map(function (d) { return d.data(); });
        sendJson(res, 200, {
          registrations: regs.length,
          confirmed: regs.filter(function (r) { return r.status === 'confirmed'; }).length,
          waitlist: regs.filter(function (r) { return r.status === 'waitlist'; }).length,
          attendees: regs.filter(function (r) { return !!r.checkedInAt; }).length,
          revenue: regs.reduce(function (sum, r) { return sum + ((r.payment && r.payment.status === 'paid') ? (r.payment.amount || 0) : 0); }, 0)
        });
      })
      .catch(function (err) { sendJson(res, 500, { error: 'dashboard-stats failed: ' + err.message }); });
  });
}

/* ---------- POST /api/register — PUBLIC, no auth ----------
   The one write path a published event microsite itself calls — this is what "Register Now" finally does
   for real (previously a dead href="#" on every template). Deliberately open: a real visitor registering
   for a real event isn't signed in as an admin, there is no public-visitor identity system in this app at
   all. Paid events are captured with payment.status:'pending' — there is no payment gateway wired up yet
   (see the plan's deferred-scope note); this endpoint only ever records intent to pay, never a real charge. */
function handleRegister(req, res) {
  parseJsonBody(req, res, function (body) {
    var eventId = String(body.eventId || '').trim();
    var name = String(body.name || '').trim();
    var email = String(body.email || '').trim();
    if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
    if (!name) return sendJson(res, 400, { error: 'name is required.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJson(res, 400, { error: 'A valid email is required.' });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    var eventRef = fb.db.collection('events').doc(eventId);
    eventRef.get().then(function (snap) {
      if (!snap.exists) return sendJson(res, 404, { error: 'No such event.' });
      var ev = snap.data();
      var paymentType = (ev.payment && ev.payment.type) || 'free';
      var data = {
        name: name.slice(0, 120), email: email.slice(0, 200),
        phone: String(body.phone || '').slice(0, 40), company: String(body.company || '').slice(0, 120),
        designation: String(body.designation || '').slice(0, 120), city: String(body.city || '').slice(0, 80),
        source: String(body.source || 'website').slice(0, 60),
        status: 'confirmed',
        payment: paymentType === 'paid'
          ? { required: true, status: 'pending', amount: (ev.payment && ev.payment.amount) || 0, txnId: null }
          : { required: false, status: 'n/a', amount: 0, txnId: null },
        createdAt: new Date().toISOString(), checkedInAt: null
      };
      return eventRef.collection('registrations').add(data).then(function (ref) {
        sendJson(res, 200, { id: ref.id, status: data.status, payment: data.payment });
      });
    }).catch(function (err) { sendJson(res, 500, { error: 'register failed: ' + err.message }); });
  });
}

/* ---------- POST /api/event/publish — admin-gated ----------
   custom_editor.html's Publish button used to be purely cosmetic (a setTimeout + a modal literally titled
   "Saved — not yet published", by its own code comment) — nothing the user edits in the canvas was ever
   sent anywhere outside their own browser's IndexedDB (editor-store.js's RevampStore), so there was
   genuinely nothing to serve from a real URL even if one existed. This makes Publish real: the browser
   sends canvas.serialize()'s own final HTML (the exact same string the Preview button already opens in a
   new tab — no new serialization logic needed), stored in Firebase Storage (never inline in Firestore —
   a serialized page is easily well over the 1MiB document cap; same reasoning as buildHeroImage's own
   Storage-not-Firestore fix) and made public, same pattern as every other generated asset in this file. */
var MAX_PUBLISHED_HTML_BYTES = 10 * 1024 * 1024;

function handleEventPublish(req, res) {
  requireAdmin(req, res, function (fb) {
    parseJsonBody(req, res, function (body) {
      var eventId = String(body.eventId || '').trim();
      var html = String(body.html || '');
      if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
      if (!html.trim()) return sendJson(res, 400, { error: 'html is required.' });
      if (Buffer.byteLength(html, 'utf8') > MAX_PUBLISHED_HTML_BYTES) {
        return sendJson(res, 413, { error: 'This page is larger than the publish size limit.' });
      }
      var storagePath = 'events/' + eventId + '/published/index.html';
      var file = fb.bucket.file(storagePath);
      file.save(Buffer.from(html, 'utf8'), { metadata: { contentType: 'text/html; charset=utf-8' } })
        .then(function () { return file.makePublic(); })
        .then(function () {
          var publishedUrl = 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath;
          var now = new Date().toISOString();
          return fb.db.collection('events').doc(eventId)
            .set({ published: true, publishedUrl: publishedUrl, publishedAt: now }, { merge: true })
            .then(function () { sendJson(res, 200, { publishedUrl: publishedUrl, publishedAt: now }); });
        })
        .catch(function (err) { sendJson(res, 500, { error: 'publish failed: ' + err.message }); });
    });
  });
}

// Single entry point both tools/serve.js (local) and index.js (deployed) call into.
function handleApi(req, res) {
  var urlPath = req.url.split('?')[0];

  if (req.method === 'POST' && urlPath === '/api/suggest-design') return handleSuggestDesign(req, res);
  if (req.method === 'POST' && urlPath === '/api/chat-edit') return handleChatEdit(req, res);
  if (req.method === 'POST' && urlPath === '/api/extract-brief') return handleExtractBrief(req, res);
  if (req.method === 'POST' && urlPath === '/api/ingest-source') return handleIngestSource(req, res);
  if (req.method === 'POST' && urlPath === '/api/plan-structure') return handlePlanStructure(req, res);
  if (req.method === 'POST' && urlPath === '/api/generate-content') return handleGenerateContent(req, res);
  if (req.method === 'GET' && urlPath === '/api/draft') return handleGetDraft(req, res);
  if (req.method === 'GET' && urlPath === '/api/generated-template') return handleGeneratedTemplate(req, res);

  if (req.method === 'POST' && urlPath === '/api/event') return handleEventCreate(req, res);
  if (req.method === 'GET' && urlPath === '/api/event') return handleEventGet(req, res);
  if (req.method === 'PATCH' && urlPath === '/api/event') return handleEventUpdate(req, res);
  if (req.method === 'GET' && urlPath === '/api/event/registrations') return handleEventRegistrationsList(req, res);
  if (req.method === 'GET' && urlPath === '/api/event/dashboard-stats') return handleEventDashboardStats(req, res);
  if (req.method === 'POST' && urlPath === '/api/event/publish') return handleEventPublish(req, res);
  if (req.method === 'POST' && urlPath === '/api/register') return handleRegister(req, res);

  var resourceMatch = /^\/api\/event\/([a-z-]+)$/.exec(urlPath);
  if (resourceMatch && RESOURCES[resourceMatch[1]]) {
    var R = RESOURCES[resourceMatch[1]];
    if (req.method === 'GET') return R.list(req, res);
    if (req.method === 'POST') return R.create(req, res);
    if (req.method === 'PATCH') return R.update(req, res);
    if (req.method === 'DELETE') return R.remove(req, res);
  }

  sendJson(res, 404, { error: 'No such endpoint: ' + req.method + ' ' + req.url });
}

module.exports = { handleApi };
