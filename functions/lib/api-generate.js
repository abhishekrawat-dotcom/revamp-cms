// The AI site-generation pipeline and the AI steps around it — Create Event's "Let AI design it" and "Generate my
// site", and the editor's section redesign:
//
//   POST /api/suggest-design   create-event.html's "Let AI design it" (step 2)
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
//                               Also handles templateId:'gen-<eventId>' (a fully AI-DESIGNED site, not a
//                               ported template) by writing bespoke per-section HTML+CSS instead of filling
//                               a real template.json's content.map — see "AI-DESIGNED GENERATED TEMPLATES
//                               PIPELINE, step 2" further down, right before this handler.
//   POST /api/plan-structure   AI-DESIGNED GENERATED TEMPLATES PIPELINE, step 1: the brief + sources already
//                               collected for an event -> Gemini independently designs this event's own
//                               section list (ids/kinds/purposes, no fixed library) AND its creative
//                               direction (mood/themeColor/accentColor/headingFont/bodyFont), grounded only
//                               in that event's own real material (previousEdition colour/font signals are
//                               fed in as a weighable signal, never copied mechanically) — plus a generated
//                               hero background image. Within a generation (runId: Create Event sends one
//                               with every step) the plan is kept with that run (events/{eventId}/generations/
//                               {runId}) and becomes the event's designPlan only when the run's site is written
//                               (lib/generated-site.js); without a run it is saved on the event's own doc.
//   GET  /api/generated-template?eventId=<id>   AI-DESIGNED GENERATED TEMPLATES PIPELINE, step 3: assembles
//                               the exact template.json shape (id, name, fonts, design, body.style,
//                               content.map, layout, sections) for a generated page, from the designPlan and
//                               the site's sections saved by /api/plan-structure and /api/generate-content
//                               (lib/generated-site.js: the run's own documents, or, for a site generated before
//                               13 Nov 2026, events/{eventId}.generatedSections).
//                               The frontend's template-loader.js consumes this the same way it reads a real
//                               templates/<id>/template.json file; each section's real markup/CSS (fully
//                               Gemini's own per-event design, not a fixed library component) is resolved
//                               via GET /api/generated-section right below.
//   GET  /api/generated-section?eventId=<id>&id=<sectionId>   signed in (routeApi's caller check) — one
//                               section's real, model-written {html, css}, read where the site keeps it
//                               (lib/generated-site.js) and sanitised again on the way out (sanitize.js). The 5 data-bound kinds (speakers/faq/partners/contact/
//                               glimpses) carry a data-rv-repeat-template/data-rv-field convention in that
//                               markup for a client-side mechanism (built separately) to fill with real
//                               per-event Firestore records. The css is confined to its own section on
//                               the way out (lib/gen-markup.js).
//   GET  /api/generate/status?eventId=&runId=   where a run of "Generate my site" is (BE-033)
//   POST /api/generate/cancel { eventId, runId }  Create Event's Cancel generation (BE-033)
//   POST /api/redesign-section one section of an AI-designed site, designed again
//   GET  /api/draft            the latest generated draft, pre-shaped for the editor
//   Every model call above goes through lib/gemini.js. When one fails the route answers
//   { error, code, retryable } — code is ai-quota (429) | ai-config (503) | ai-rejected | ai-unavailable |
//   ai-bad-output (502) | ai-timeout (504, with timeoutMs) | ai-blocked (422) — and error is a sentence
//   that can be shown as it is. Before any model call (BE-018, BE-021, BE-026): a person's paid steps are limited per
//   route (429 rate-limited, lib/http.js AI_RATE); suggest-design without the event's name or its template answers
//   400 need-event-details, plan-structure with nothing to work from 400 need-input; ingest-source reads a public
//   web page only (400 bad-url, 415 not-a-page, 413 too-large, 502/504 unreachable-url) and refuses a page with too
//   little text to read (422 unreadable).
//
// Moved out of lib/api.js as it was (BE-017): from the line after the wire() block below to module.exports, the code
// and its comments are lib/api.js's own, in their order there, unchanged — so where a comment below says "this file",
// "above" or "below" of something that is not in this file, it means lib/api.js, where the rest of that code still is.
// lib/api.js routes the requests here (ROUTES, loaded on first use through inModule()) and hands this file, on every
// call, the helpers and settings that its own routes use too (wire(), as for lib/dash-bot.js): requiring that file from
// here would be a require cycle. Loading this file reads nothing, writes nothing and needs no environment.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getFirebase } = require('./firebase');
const { sendJson, readBody, parseJsonObject, isEventId } = require('./http');
const { logActivity, actorOf } = require('./activity');
const { callGeminiJson, callGeminiImage, GEMINI_TEXT_MODEL } = require('./gemini');
/* every text call goes through llm.js: Claude first when its key is set, Gemini as the fallback */
const llm = require('./llm');
const logoUnit = require('./logo-unit');
const pngLite = require('./png-lite');
const ownerBrief = require('./owner-brief');
const eventDescription = require('./event-description');
const etPrevious = require('./et-previous');
const etEvents = require('./et-events');
const googleFonts = require('./google-fonts');
/* The one sanitiser for markup this server did not write itself (a model's sections, a page copied from another
   site): an allow-list on a real parser, applied when such markup is stored and again when it is served. */
const sanitize = require('./sanitize');
const sectionPictures = require('./section-pictures');
const etAwards = require('./et-awards');
const awardSite = require('./award-site');
const awardSections = require('./award-sections');
const prevSections = require('./prev-sections');
const sectionOrder = require('./section-order');
/* an AI-designed site's generations (runs) and where its sections are kept (BE-029, BE-032) */
const generatedSite = require('./generated-site');
const etNav = require('./et-nav');
const etFooter = require('./et-footer');
const pictures = require('./pictures');
const editionLook = require('./edition-look');
const rvTheme = require('../../templates/_shared/rv-theme.js');
const { scopeSectionCss, sectionRootInfo, mobileSafeCss } = require('./gen-markup');
const genDesign = require('./gen-design');
const { safeFetch } = require('./safe-fetch');
const sitePages = require('./site-pages');
/* what ETB2B AI wrote that nothing the event supplied supports (BE-043) */
const inventedFacts = require('./invented-facts');

/* What lib/api.js hands this file on every call (wire(); see generateHelpers() there): the helpers and settings
   that its own routes use too. Each is kept here under its own name, so the code below reads exactly as it did there.
   Run without them it would have no sign-in check or answer to call, so a wiring with parts missing is refused. */
var NEEDS = [
  'AI_OUTPUT_TOKENS', 'AWARD_TAB_LABELS', 'BODY_LIMITS', 'DESIGN_COLOR_FIELDS', 'DESIGN_ENUM_FIELDS',
  'DESIGN_FIELDS', 'DESIGN_FONT_FIELDS', 'DESIGN_NUMERIC_FIELDS', 'DESIGN_WEIGHT_FIELDS', 'ET_LOGO_COLOUR_RULE',
  'EVENT_FIELD_CHECKS', 'LOGO_UNIT_MAX_BYTES', 'NAME_RULE', 'RESPONSE_SCHEMA_BASE', 'TOKEN_KIT', 'aiUsageRecorder',
  'briefYearTexts', 'darkCopyNote', 'etJson', 'eventDocRef', 'eventFacts', 'eventStateOf', 'examineUnit',
  'extractStylesheetLinks', 'fetchUnitFont', 'fieldDelete', 'footerEvents', 'googleFontUrl', 'headingText',
  'headingWords', 'heroModeOf', 'httpError', 'isPlainObject', 'loadLiveEvent', 'notLiveError', 'ownerLogoUnit',
  'portalNameOf', 'queryOf', 'safeGeneratedSection', 'sanitizeDesignField', 'scrapeLovableUrl', 'sendAiFailure',
  'sendFailure', 'sendStepFailure', 'siteFooter', 'sitePortalOf', 'sizedSvg', 'storagePathOf', 'storeLogoUnit',
  'storeOnDarkUnit', 'storePublicPicture', 'stripAllScriptTags', 'svgCouldRun', 'tidyGeneratedSectionCss',
  'tidyGeneratedSectionHtml'
];
var AI_OUTPUT_TOKENS, AWARD_TAB_LABELS, BODY_LIMITS, DESIGN_COLOR_FIELDS, DESIGN_ENUM_FIELDS, DESIGN_FIELDS,
  DESIGN_FONT_FIELDS, DESIGN_NUMERIC_FIELDS, DESIGN_WEIGHT_FIELDS, ET_LOGO_COLOUR_RULE, EVENT_FIELD_CHECKS,
  LOGO_UNIT_MAX_BYTES, NAME_RULE, RESPONSE_SCHEMA_BASE, TOKEN_KIT, aiUsageRecorder, briefYearTexts, darkCopyNote,
  etJson, eventDocRef, eventFacts, eventStateOf, examineUnit, extractStylesheetLinks, fetchUnitFont, fieldDelete,
  footerEvents, googleFontUrl, headingText, headingWords, heroModeOf, httpError, isPlainObject, loadLiveEvent,
  notLiveError, ownerLogoUnit, portalNameOf, queryOf, safeGeneratedSection, sanitizeDesignField, scrapeLovableUrl,
  sendAiFailure, sendFailure, sendStepFailure, siteFooter, sitePortalOf, sizedSvg, storagePathOf, storeLogoUnit,
  storeOnDarkUnit, storePublicPicture, stripAllScriptTags, svgCouldRun, tidyGeneratedSectionCss,
  tidyGeneratedSectionHtml;
function wire(helpers) {
  var missing = NEEDS.filter(function (k) { return !helpers || helpers[k] == null; });
  if (missing.length) throw new Error('lib/api-generate.js needs ' + missing.join(', ') + ' from lib/api.js');
  ({
    AI_OUTPUT_TOKENS, AWARD_TAB_LABELS, BODY_LIMITS, DESIGN_COLOR_FIELDS, DESIGN_ENUM_FIELDS, DESIGN_FIELDS,
    DESIGN_FONT_FIELDS, DESIGN_NUMERIC_FIELDS, DESIGN_WEIGHT_FIELDS, ET_LOGO_COLOUR_RULE, EVENT_FIELD_CHECKS,
    LOGO_UNIT_MAX_BYTES, NAME_RULE, RESPONSE_SCHEMA_BASE, TOKEN_KIT, aiUsageRecorder, briefYearTexts, darkCopyNote,
    etJson, eventDocRef, eventFacts, eventStateOf, examineUnit, extractStylesheetLinks, fetchUnitFont, fieldDelete,
    footerEvents, googleFontUrl, headingText, headingWords, heroModeOf, httpError, isPlainObject, loadLiveEvent,
    notLiveError, ownerLogoUnit, portalNameOf, queryOf, safeGeneratedSection, sanitizeDesignField, scrapeLovableUrl,
    sendAiFailure, sendFailure, sendStepFailure, siteFooter, sitePortalOf, sizedSvg, storagePathOf, storeLogoUnit,
    storeOnDarkUnit, storePublicPicture, stripAllScriptTags, svgCouldRun, tidyGeneratedSectionCss,
    tidyGeneratedSectionHtml
  } = helpers);
}


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
    'You are proposing fresh, trendy VISUAL REDESIGNS of an existing event microsite for ETB2B EventSphere\'s event builder — not a different template. This is the REAL template\'s own markup and CSS, rendered live; you are only changing its real design settings (colour, typography, heading style), and optionally the order of a few sections (see below) — never which sections exist or their own internal layout.',
    '',
    'Event:', JSON.stringify(payload.event || {}, null, 2),
    '',
    'The content already written for this event, by section (libId -> current data):',
    JSON.stringify(sections.map(function (s) { return { libId: s.libId, shape: s.shape, name: s.name, data: s.data }; }), null, 2),
    '',
    'Baseline template (fixed — do not suggest switching it). Its own brand swatches and which elements count as headings/buttons/cards:',
    JSON.stringify({ id: tpl.id, name: tpl.name, swatches: design.swatches || [], headings: design.headings, buttons: design.buttons, cards: design.cards }, null, 2),
    '',
    'ETB2B EventSphere\'s own event sites centre section headings and call-to-action buttons by convention — keep headingAlign as "center" in the large majority of your suggestions; only pick something else for a deliberate, clearly-justified editorial/asymmetric direction.',
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

/* What a redesign needs before the model is asked (BE-021): the event's name, and the template being redesigned
   (Create Event sends both once its details form is filled). -> '' or the sentence to answer 400 with. */
function suggestDesignMissing(payload) {
  var ev = isPlainObject(payload.event) ? payload.event : {};
  if (!String(ev.name == null ? '' : ev.name).trim()) return 'Fill in the event’s details first, then ask for a redesign.';
  var tpl = isPlainObject(payload.currentTemplate) ? payload.currentTemplate : {};
  if (!String(tpl.id == null ? '' : tpl.id).trim()) return 'Choose a template first, then ask for a redesign.';
  return '';
}

function handleSuggestDesign(req, res) {
  readBody(req, res, function (raw) {
    var payload;
    try { payload = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
    /* nothing to design from: answered before anything is paid for */
    var missing = suggestDesignMissing(payload);
    if (missing) return sendJson(res, 400, { error: missing, code: 'need-event-details' });

    llm.callJson(buildPrompt(payload), responseSchemaFor(payload), { route: 'suggest-design', maxOutputTokens: AI_OUTPUT_TOKENS.small, onUsage: aiUsageRecorder(null, payload.eventId, 'suggest-design') }).then(function (r) {
      if (r.error) return sendAiFailure(res, r);
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

      if (!designs.length) return sendJson(res, 502, { error: 'The AI gave an answer we could not use. Try again.', code: 'ai-bad-output', retryable: true });

      /* valid only if it's a genuine permutation of the reorderable ids — a partial/garbled list reads as a
         model mistake, not a deliberate edit, so it's dropped entirely rather than passed on half-formed
         (the client's loader would defensively patch in anything missing, but better to just not apply it) */
      var reorderableIds = ((payload.currentTemplate || {}).reorderableSections || []).map(function (s) { return s.id; });
      var proposedOrder = Array.isArray(parsed.sectionOrder) ? parsed.sectionOrder.filter(function (id) { return reorderableIds.indexOf(id) !== -1; }) : [];
      var sectionOrder = (reorderableIds.length && proposedOrder.length === reorderableIds.length && new Set(proposedOrder).size === reorderableIds.length) ? proposedOrder : null;

      sendJson(res, 200, { designs: designs, enhancements: enhancements, sectionOrder: sectionOrder });
    }).catch(function (err) { sendFailure(res, 'suggest-design', err, 'The design proposals could not be made just now. Please try again.'); });
  }, BODY_LIMITS.ai);
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
    inferredCategory: { type: 'STRING', description: 'A short (2-4 word) industry/category label this document genuinely reads as, e.g. "enterprise AI leadership" or "retail / e-commerce" — empty string if the document gives no real signal, never a guess.' },
    /* A DESIGNED PRESENTATION carries its own look (a brand deck, a concept note laid out as slides). Only
       then is it read for that look and for its own sections — and only then do they shape the site; a plain
       document leaves the design to the AI as before. designed: 'yes' is the switch. */
    visualIdentity: {
      type: 'OBJECT',
      description: 'The document\'s own visual identity — ONLY when it is a designed presentation or brand deck with a consistent, deliberate look (set colours, type, imagery across its pages). For a plain text document, a memo or an unstyled PDF: designed "no" and everything else empty.',
      properties: {
        designed: { type: 'STRING', enum: ['yes', 'no'], description: '"yes" only when the pages share a deliberate brand look.' },
        colours: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
          hex: { type: 'STRING', description: '#rrggbb as it appears on the pages' },
          role: { type: 'STRING', enum: ['primary', 'accent', 'background', 'surface', 'text', 'highlight'] }
        }, required: ['hex', 'role'] }, description: 'The 2-6 colours the deck is built on, each with its role: primary = the dominant brand colour (big panels, headings), accent = the second brand colour used for emphasis, background = the page colour, text = the main text colour.' },
        mode: { type: 'STRING', enum: ['light', 'dark', 'mixed', ''], description: 'Whether most pages are light or dark.' },
        headingStyle: { type: 'STRING', description: 'How headings are set, in plain words (e.g. "bold geometric sans, tight, two-tone with the last words in gold").' },
        bodyStyle: { type: 'STRING', description: 'How body text is set (e.g. "clean neutral sans").' },
        imagery: { type: 'STRING', description: 'What its pictures show and how (e.g. "sunset city skylines, a glowing rising arrow, warm golden light").' },
        motifs: { type: 'STRING', description: 'Recurring graphic devices (e.g. "navy rounded panels, thin gold rules, circular icon badges, number tabs").' },
        ipName: { type: 'STRING', description: 'The name the deck brands the property with, if it shows one as a logo/lock-up (e.g. "ET Next Billion Blueprint"), else empty.' },
        ipTagline: { type: 'STRING', description: 'The line set with that name (e.g. "New markets. New models. New growth."), else empty.' }
      },
      required: ['designed', 'colours', 'mode', 'headingStyle', 'bodyStyle', 'imagery', 'motifs', 'ipName', 'ipTagline']
    },
    deckSections: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      title: { type: 'STRING' }, items: { type: 'ARRAY', items: { type: 'STRING' } }
    }, required: ['title', 'items'] }, description: 'ONLY for a designed presentation: its content pages in order, each with its own title and its points as written (short, verbatim where possible). Leave out cover, thank-you and pure-logo pages, and any page that only lists prospective sponsors. Empty list for a plain document.' },
    /* The ten points of Create Event's "Describe the event" (owner-brief.js), as the material STATES them.
       The owner's own filled-in headings are read on the server, word for word, and win over these. */
    ownerPoints: {
      type: 'OBJECT',
      description: 'Ten points the site is built to, ONLY as the material explicitly states each one — copied in its own words. An empty string for every point it does not state: never infer or guess one.',
      properties: {
        tagline: { type: 'STRING', description: 'The event\'s own tagline or edition theme line, verbatim.' },
        usp: { type: 'STRING', description: 'What it says sets this event apart, or why to attend it rather than another.' },
        audience: { type: 'STRING', description: 'Who it says the event is for (titles, seniority).' },
        industry: { type: 'STRING', description: 'The industries it names.' },
        level: { type: 'STRING', description: 'Pan-India, global or regional — only if stated.' },
        format: { type: 'STRING', description: 'In person, virtual or hybrid, with the city — only if stated.' },
        mainAction: { type: 'STRING', description: 'What visitors are asked to do: register, request an invite, apply, nominate, become a sponsor — only if stated.' },
        scale: { type: 'STRING', description: 'Expected numbers of delegates, speakers or partners for THIS edition, exactly as stated.' },
        look: { type: 'STRING', description: 'Any stated wish for photographs or graphics, and for the tone (boardroom, energetic, editorial).' },
        mustAvoid: { type: 'STRING', description: 'Anything it says must not appear: names, claims, words.' }
      },
      required: ['tagline', 'usp', 'audience', 'industry', 'level', 'format', 'mainAction', 'scale', 'look', 'mustAvoid']
    }
  },
  required: ['theme', 'audience', 'tone', 'tracks', 'speakerHints', 'sponsorHints', 'keyMessages', 'inferredCategory', 'visualIdentity', 'deckSections', 'ownerPoints']
};

/* The visual identity of a brief, or null. It counts only when the brief is a PDF (a typed description
   has no look), the model judged it a designed presentation, and at least two of its colours are real hex
   codes with a primary among them. Anything less and the design stays the AI's to decide. */
var DECK_ROLES = ['primary', 'accent', 'background', 'surface', 'text', 'highlight'];
function deckIdentity(mimeType, v) {
  if (mimeType !== 'application/pdf' || !v || v.designed !== 'yes') return null;
  var colours = [];
  (Array.isArray(v.colours) ? v.colours : []).forEach(function (c) {
    var hex = String((c && c.hex) || '').trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(hex)) hex = '#' + hex.slice(1).replace(/./g, function (x) { return x + x; });
    if (!/^#[0-9a-f]{6}$/.test(hex) || DECK_ROLES.indexOf(c.role) === -1) return;
    if (!colours.some(function (o) { return o.hex === hex; })) colours.push({ hex: hex, role: c.role });
  });
  if (colours.length < 2 || !colours.some(function (c) { return c.role === 'primary'; })) return null;
  function line(x, n) { return String(x || '').replace(/\s+/g, ' ').trim().slice(0, n); }
  return {
    designed: 'yes', colours: colours.slice(0, 6), mode: ['light', 'dark', 'mixed'].indexOf(v.mode) !== -1 ? v.mode : '',
    headingStyle: line(v.headingStyle, 200), bodyStyle: line(v.bodyStyle, 200), imagery: line(v.imagery, 300),
    motifs: line(v.motifs, 300), ipName: line(v.ipName, 80), ipTagline: line(v.ipTagline, 120)
  };
}
/* the deck's colour for a role, or '' */
function deckColour(look, role) {
  var c = look && (look.colours || []).filter(function (x) { return x.role === role; })[0];
  return c ? c.hex : '';
}

function buildExtractBriefPrompt(eventMeta, ownerText) {
  var meta = Object.assign({}, eventMeta || {});
  if (ownerText) delete meta.description;                         // given below, as material
  return [
    'You are extracting a structured brief from an event overview document, for ETB2B EventSphere\'s event microsite builder.',
    '',
    'Event basics (already known, given here only for context — do not repeat them back as extracted content):',
    JSON.stringify(meta, null, 2),
    '',
    ownerText ? 'THE OWNER\'S OWN DESCRIPTION, typed beside the attached document — it is part of the material, and where it and the document differ, the owner\'s description is right:\n---\n' + ownerText + '\n---\n' : null,
    'The document is attached. Read it and extract ONLY what it actually says or clearly implies. Never invent a',
    'track, speaker, sponsor or claim that isn\'t in the document — an empty array/field is correct when the',
    'document simply doesn\'t cover that, better than a plausible-sounding guess.',
    '',
    'inferredCategory specifically: name the short industry/category this event genuinely reads as (e.g.',
    '"enterprise AI leadership", "CIO technology leadership", "retail / e-commerce") — base it only on real',
    'signal in the document (its subject matter, audience, themes), never on the event basics above, and never',
    'invent one if the document itself gives no real signal to go on — an empty string is the correct answer then.',
    '',
    'tracks: every named track, theme, pillar, question or industry the document lists — all of them, not a selection.',
    '',
    'visualIdentity and deckSections: LOOK at the pages. Only when the document is a designed presentation with',
    'its own deliberate look, set designed "yes", read its colours as hex codes from the pages with their roles,',
    'and describe its type, imagery and graphic motifs; and list its content pages as deckSections. A plain or',
    'unstyled document is designed "no" with empty colours and an empty deckSections list. Sponsor names shown as',
    'a "potential" or "prospective" list are prospects, not partners: never put them in sponsorHints as confirmed.',
    '',
    'ownerPoints: each one only as the material states it, in its own words; an empty string for any it does not state. Read them from everything you were given — the document as well as the owner\'s description: a heading the owner left blank (e.g. "Industry:" with nothing after it) is not a statement, so take that point from the document when the document states it.'
  ].filter(function (l) { return l !== null; }).join('\n');
}

// 15MB cap on the decoded file — generous for a brief overview doc, small enough to keep one request fast
// and well under the 32 MB App Hosting takes in one request (lib/http.js DEFAULT_MAX_BODY).
var MAX_BRIEF_BYTES = 15 * 1024 * 1024;

function handleExtractBrief(req, res) {
  readBody(req, res, function (raw) {
    var payload;
    try { payload = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    var eventId = String(payload.eventId || '').trim();
    var fileName = String(payload.fileName || '').trim();
    var mimeType = String(payload.mimeType || '').trim();
    var docBase64 = String(payload.docBase64 || '');
    if (!eventId || !fileName || !mimeType || !docBase64) {
      return sendJson(res, 400, { error: 'eventId, fileName, mimeType and docBase64 are all required.' });
    }
    if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });
    /* the generation this brief is read for (WZ-034): only that run's later steps read it (generated-site.js) */
    var runId = runIdOf(payload);
    if (runId === null) return sendJson(res, 400, { error: RUN_ID_ERROR });
    /* the model is only ever given a document to read as a PDF or as plain text */
    mimeType = mimeType.split(';')[0].trim().toLowerCase();
    if (mimeType !== 'application/pdf' && mimeType !== 'text/plain') {
      return sendJson(res, 415, { error: 'Upload the brief as a PDF, or type the description instead.', code: 'unsupported-file' });
    }

    var buffer;
    try { buffer = Buffer.from(docBase64, 'base64'); } catch (e) { return sendJson(res, 400, { error: 'docBase64 is not valid base64.' }); }
    if (buffer.length === 0) return sendJson(res, 400, { error: 'The uploaded document is empty.' });
    if (buffer.length > MAX_BRIEF_BYTES) return sendJson(res, 413, { error: 'The uploaded document is larger than the 15MB pilot limit.' });
    /* a PDF says so in its first bytes (a few may come before the mark) */
    if (mimeType === 'application/pdf' && buffer.slice(0, 1024).indexOf('%PDF-') === -1) {
      return sendJson(res, 415, { error: 'That file is not a PDF. Upload the brief as a PDF, or type the description instead.', code: 'unsupported-file' });
    }

    /* The event's facts this step may store (BE-022): name, dates, venue and city, each checked as PATCH
       /api/event checks it — nothing else the request carries (the event's portal, its publishing, its deletion,
       its design are each changed by their own route and rule). A fact that does not pass is refused here,
       before anything is paid for or stored. */
    var eventMeta = isPlainObject(payload.eventMeta) ? payload.eventMeta : {};
    var facts = briefFacts(eventMeta);
    if (facts.error) return sendJson(res, 400, { error: facts.error, field: facts.field });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    /* stored under a name this server chooses (the brief's own id): the name the file came with is only shown */
    var shownName = fileName.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200) || 'brief';
    var briefRef = fb.db.collection('events').doc(eventId).collection('briefs').doc();
    var storagePath = 'events/' + eventId + '/briefs/' + briefRef.id + (mimeType === 'application/pdf' ? '.pdf' : '.txt');
    var stored = false;
    /* what the owner typed in "Describe the event": the document itself when there is no other, else sent
       beside it (briefText). Its filled-in headings are the owner's brief (owner-brief.js). */
    var ownerText = String(payload.briefText || (mimeType === 'text/plain' ? buffer.toString('utf8') : '') || eventMeta.description || '').slice(0, 8000);

    var watch = null;
    /* the event must exist (BE-021): watchEvent refuses one that does not with 404 before the model is asked */
    watchEvent(fb, eventId)
      .then(function (w) {
        watch = w;
        return llm.callJson(buildExtractBriefPrompt(eventMeta, mimeType === 'application/pdf' ? ownerText : ''), BRIEF_SCHEMA, { inlineFile: { mimeType: mimeType, data: docBase64 }, route: 'extract-brief', eventId: eventId, onUsage: aiUsageRecorder(fb, eventId, 'extract-brief'), maxOutputTokens: AI_OUTPUT_TOKENS.small });
      })
      .then(function (r) {
        /* nothing is stored for a brief that could not be read */
        if (r.error) return sendAiFailure(res, r);
        var extracted = {
          theme: String(r.parsed.theme || '').slice(0, 500),
          audience: String(r.parsed.audience || '').slice(0, 300),
          tone: String(r.parsed.tone || '').slice(0, 200),
          tracks: (r.parsed.tracks || []).slice(0, 40).map(function (s) { return String(s).slice(0, 200); }),
          speakerHints: (r.parsed.speakerHints || []).slice(0, 30).map(function (s) { return String(s).slice(0, 200); }),
          sponsorHints: (r.parsed.sponsorHints || []).slice(0, 30).map(function (s) { return String(s).slice(0, 200); }),
          keyMessages: (r.parsed.keyMessages || []).slice(0, 5).map(function (s) { return String(s).slice(0, 300); }),
          inferredCategory: String(r.parsed.inferredCategory || '').trim().slice(0, 60)
        };
        /* the owner's brief: their own headings first, then what the material states */
        var owner = ownerBrief.merge(ownerBrief.fromText(ownerText), r.parsed.ownerPoints);
        if (owner) {
          if (mimeType === 'text/plain') Object.keys(owner.from).forEach(function (k) { owner.from[k] = 'description'; });
          extracted.owner = owner;
        }
        /* the deck's look and its own sections, kept only when it really is a designed presentation */
        var look = deckIdentity(mimeType, r.parsed.visualIdentity);
        if (look) {
          extracted.visualIdentity = look;
          extracted.deckSections = (Array.isArray(r.parsed.deckSections) ? r.parsed.deckSections : []).slice(0, 16).map(function (d) {
            return { title: String((d && d.title) || '').replace(/\s+/g, ' ').trim().slice(0, 120), items: (d && Array.isArray(d.items) ? d.items : []).slice(0, 12).map(function (t) { return String(t).replace(/\s+/g, ' ').trim().slice(0, 240); }).filter(Boolean) };
          }).filter(function (d) { return d.title && d.items.length; });
        }

        var now = new Date().toISOString();
        /* the document, once the model has read it */
        return fb.bucket.file(storagePath).save(buffer, { metadata: { contentType: mimeType } })
          .then(function () {
            stored = true;
            /* the event's facts as the form gave them, checked above — never its description: what the owner typed
               is the brief (kept with the brief below), and the description is written from it at design time
               (event-description.js). update(), not a merge: it never makes a document that is not there. */
            return watch.update(Object.assign({}, facts.value, { updatedAt: now, updatedBy: actorOf(req.user) }));
          })
          .then(function () {
            var brief = { sourceFileName: shownName, mimeType: mimeType, storagePath: storagePath,
              extracted: extracted, model: r.model || GEMINI_TEXT_MODEL, createdAt: now, createdBy: actorOf(req.user) };
            if (runId) brief.runId = runId;
            return briefRef.set(brief);
          })
          .then(function () {
            sendJson(res, 200, { eventId: eventId, briefId: briefRef.id, extracted: extracted });
            if (watch.live) logActivity(fb, eventId, req.user, 'brief-updated', 'brief read from “' + shownName.slice(0, 120) + '”', { area: 'content' });
          });
      })
      .catch(function (err) {
        /* a document stored for a brief that was then not kept (the event went meanwhile, or the brief could not be
           written) must not be left behind */
        if (stored) fb.bucket.file(storagePath).delete().catch(function () { /* already removed with the event */ });
        sendStepFailure(res, err, 500, 'The brief could not be read just now. Please try again.', 'extract-brief');
      });
  }, BODY_LIMITS.brief);
}

/* The generation a step belongs to (Create Event names each press of "Generate my site" and sends the name with
   every step: lib/generated-site.js). -> the name, '' when none was sent, null when what was sent is not one */
var RUN_ID_ERROR = 'runId must be letters, digits, "-" or "_" (at most 64).';
/* a step of a run the person stopped (WZ-055): it changes nothing */
var RUN_STOPPED = 'This run was stopped, so nothing it made was saved.';
/* BE-024: what a caller is told when a step comes before the one it needs — an owner's sentence and a code, never a
   route to call */
var NOT_PLANNED = 'This site has not been designed yet. Design it first, then write its pages.';
var NOT_GENERATED = 'This event has no site made by ETB2B AI yet.';
function runIdOf(payload) {
  var v = payload && payload.runId;
  if (v == null || v === '') return '';
  return generatedSite.isRunId(v) ? v : null;
}

/* The facts of an event a brief step may store on it, from the form's eventMeta: name, start, end, venue and city,
   each one only when it is sent, checked by EVENT_FIELD_CHECKS (event-description.js BRIEF_FACT_FIELDS names
   them). -> { value } or { error, field } */
function briefFacts(eventMeta) {
  var picked = eventDescription.storedFacts(eventMeta), value = {};
  var fields = Object.keys(picked);
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i], v = picked[f];
    if (v === undefined) continue;
    /* an empty name is no name sent (the form always has one: the event was made with it) */
    if (f === 'name' && (v == null || String(v).trim() === '')) continue;
    var problem = EVENT_FIELD_CHECKS[f](v);
    if (problem) return { error: problem, field: f };
    value[f] = typeof v === 'string' ? v.trim() : v;
  }
  if (value.start && value.end && Date.parse(value.end) < Date.parse(value.start)) return { error: 'The end date is before the start date.', field: 'end' };
  return { value: value };
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
    design: {
      type: 'OBJECT',
      description: 'How this page is DESIGNED, read from its markup skeleton: observations a designer could rebuild its look and structure from. Describe what is there; never guess at what the skeleton does not show.',
      properties: {
        layoutStyle: { type: 'STRING', description: '1-2 sentences: the overall layout character (e.g. "full-width colour bands with centred headings and 3-column card grids", "editorial two-column spreads").' },
        heroStyle: { type: 'STRING', description: 'One sentence: how the top banner is built (full-bleed picture or video with text over it, split picture/text, text only on colour, a slider…) and what it carries (logo lock-up, date, venue, buttons, countdown).' },
        sectionPattern: { type: 'ARRAY', items: { type: 'STRING' }, description: 'The page top to bottom, one entry per section: "<what it is> — <how it is laid out>", e.g. "Speakers — 4-column grid of round photos with name and role", "Stats — one dark band of 4 large numbers".' },
        imageryStyle: { type: 'STRING', description: 'One sentence: how much imagery the page uses and of what kind (large photographs, icons, illustrations, logos only, almost none).' },
        typography: { type: 'STRING', description: 'One sentence: heading and text character (serif/sans, heavy/light, uppercase labels, very large display type…).' },
        density: { type: 'STRING', description: '"airy", "balanced" or "dense".' }
      },
      required: ['layoutStyle', 'heroStyle', 'sectionPattern', 'imageryStyle', 'typography', 'density']
    },
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
  required: ['design', 'sections']
};

var SOURCE_TYPE_LABELS = {
  previousEdition: 'this same event\'s previous edition',
  currentEdition: 'this same event\'s current edition (the live page this generation will replace)',
  competitor: 'a competitor\'s event'
};

/* With the edition's banner picture attached (keyVisualOf), the model also says, in words, what it shows and
   how it is made: the new edition's pictures are INSPIRED BY it (plan-structure gives this description to the
   plan and to the hero's picture). The picture itself is never shown on, or edited into, the new site. */
var KEY_VISUAL_SCHEMA = {
  type: 'OBJECT',
  description: 'About the ONE PICTURE attached: the artwork the page\'s top banner is built on.',
  properties: {
    description: { type: 'STRING', description: 'One or two sentences a designer could brief a picture in the same spirit from: what kind of scene or composition it is, how it is made (photograph, illustration, 3D render, collage), its palette and its light. Name no city, region or landmark here (that goes in "place").' },
    place: { type: 'STRING', description: 'The city or region it shows, when it is recognisable (the city or region and what in the picture shows it), else an empty string.' }
  },
  required: ['description', 'place']
};
function ingestSchemaFor(withPicture) {
  if (!withPicture) return SOURCE_SECTIONS_SCHEMA;
  var schema = JSON.parse(JSON.stringify(SOURCE_SECTIONS_SCHEMA));
  schema.properties.keyVisual = KEY_VISUAL_SCHEMA;
  schema.required = schema.required.concat(['keyVisual']);
  return schema;
}

function buildIngestSourcePrompt(url, type, text, skeleton, withPicture) {
  return [
    'Below are two views of a real event microsite (' + SOURCE_TYPE_LABELS[type] + '), ' + url + ': first its visible text with the markup stripped, then its markup skeleton (tags and class names, the text cut to a few words).' +
      (withPicture ? ' The picture attached is the artwork its top banner is built on: describe it in "keyVisual".' : ''),
    '',
    'From the SKELETON, fill in "design": how the page is laid out and styled, section by section, so that a designer who never saw the page could rebuild its structure and visual character. If the skeleton is empty or shows almost nothing (a page drawn by script), say so in layoutStyle and leave sectionPattern empty rather than inventing a layout.',
    '',
    'From the TEXT, fill in "sections" as follows.',
    'Extract its main CONTENT sections, in the order they appear on the page (e.g. hero/intro, about, agenda highlights, speaker/why-attend, stats, sponsors, FAQ — whatever this page actually has). Skip navigation links, footer boilerplate, cookie/legal notices, and ad/widget text.',
    '',
    'For each section, summarize its own text in your own words (1-3 sentences) — never quote or closely paraphrase its sentences, this is for structural inspiration only, not content to reuse.',
    '',
    'Page text:', text,
    '',
    'Markup skeleton:', skeleton || '(none)'
  ].join('\n');
}

/* The page's own stylesheets, for what regular expressions can read from them (colours, fonts, the page
   background): the first few only, each bounded, none of them able to fail the step. */
var SOURCE_CSS_MAX_FILES = 4;
var SOURCE_CSS_MAX_BYTES = 600 * 1024;
function fetchSourceCss(pageUrl, html) {
  var hrefs = extractStylesheetLinks(html).cssHrefs.slice(0, SOURCE_CSS_MAX_FILES);
  return Promise.all(hrefs.map(function (href) {
    var abs;
    try { abs = new URL(String(href).replace(/&amp;/g, '&'), pageUrl).href; } catch (e) { return ''; }
    return safeFetch(abs, { timeoutMs: 6000, maxBytes: SOURCE_CSS_MAX_BYTES })
      .then(function (r) { return r.status === 200 ? r.body.toString('utf8') : ''; })
      .catch(function () { return ''; });
  })).then(function (texts) { return texts.join('\n'); });
}

function sanitizeSourceDesign(d) {
  d = d || {};
  function line(v, max) { return String(v || '').trim().slice(0, max); }
  return {
    layoutStyle: line(d.layoutStyle, 400), heroStyle: line(d.heroStyle, 300),
    sectionPattern: (Array.isArray(d.sectionPattern) ? d.sectionPattern : []).slice(0, 20).map(function (x) { return line(x, 200); }).filter(Boolean),
    imageryStyle: line(d.imageryStyle, 300), typography: line(d.typography, 300), density: line(d.density, 20)
  };
}

/* A previous edition's records from ET's event API. The page fetched for the summary may have lost its own
   id (a page read by the rendering service has its scripts taken out, and `var siteId` with them), so it is
   fetched again as a browser would when it does not name it; the copy that names more ids is used.
   pick { portal, id }: an edition chosen from ET's own list (confirmEtPick below) — its records are read for
   exactly that portal and id. -> Promise<PREVIOUS | null>, never rejecting */
function readEtPrevious(url, html, pick) {
  function fetchJson(u, headers) {
    return safeFetch(u, { timeoutMs: 15000, maxBytes: 6 * 1024 * 1024, headers: Object.assign({ accept: 'application/json' }, headers || {}) })
      .then(function (r) { return r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null; });
  }
  function namesItself(h) { return etPrevious.candidatesIn(h).some(function (c) { return c.from.indexOf('siteId') !== -1; }); }
  var page = namesItself(html) ? Promise.resolve(html)
    : safeFetch(url, { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36' } })
        .then(function (r) {
          var again = r.status === 200 ? r.body.toString('utf8') : '';
          return again && etPrevious.idsIn(again).length >= etPrevious.idsIn(html).length ? again : html;
        }, function () { return html; });
  return page.then(function (h) { return etPrevious.readPrevious(url, h, { fetchJson: fetchJson, portal: pick ? pick.portal : '', id: pick ? pick.id : '' }); })
    .then(null, function (err) { console.error('ingest-source: previous edition records not read — ' + (err && err.message)); return null; });
}

/* A pick is taken only when it is one of that portal's own (IP) events in ET's list (et-events.js, cached) and its
   page is the address being read — otherwise the address alone decides, as for a pasted link.
   -> Promise<{ portal, id } | null>, never rejecting */
function pageKey(u) {
  var m = /^https?:\/\/([^\/?#]+)([^?#]*)/i.exec(String(u || '').trim());
  return m ? m[1].toLowerCase().replace(/^www\./, '') + m[2].replace(/\/+$/, '').toLowerCase() : '';
}
/* instead: what is done when the pick is not confirmed, for the log line ('read by its address' unless said) */
function confirmEtPick(pick, url, instead) {
  if (!pick) return Promise.resolve(null);
  var award = pick.kind === 'award';
  return (award ? etEvents.listAwards : etEvents.listIpEvents)(pick.portal, etJson).then(function (events) {
    var ev = events.filter(function (e) { return String(e.id) === pick.id; })[0];
    if (ev && pageKey(ev.link) && pageKey(ev.link) === pageKey(url)) return pick;
    console.warn('ingest-source: etEvent ' + pick.portal + '/' + pick.id + (ev ? ' is not ' + url : award ? ' is not an award of that portal' : ' is not an IP event of that portal') + ' — ' + (instead || 'read by its address'));
    return null;
  }, function () { return null; });
}

/* payload.etEvent { portal, id, kind? } -> { portal, id, kind } | null when absent | false when it is not a real
   pick (a portal off the roster, an id that is not digits, a kind other than 'event' or 'award'): neither ever
   reaches ET's header or address. An award's id is its microsite's (et-events.js compactAward). */
function etPickOf(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return false;
  var portal = String(v.portal || '').trim(), id = String(v.id == null ? '' : v.id).trim(), kind = v.kind == null ? 'event' : String(v.kind);
  return etEvents.isPortal(portal) && /^\d{1,9}$/.test(id) && (kind === 'event' || kind === 'award') ? { portal: portal, id: id, kind: kind } : false;
}

/* The roster portal whose ET address serves a portal's site: its own, except where ET runs one site under two
   names. startup.economictimes.indiatimes.com is ET Entrepreneur's site under another name (et-footer.js gives
   'startup' the entrepreneur.economictimes… home), yet 'startup' and 'entrepreneur' are both on the roster, so an
   address on either host is the same site to both. Read from et-footer.js's homes, so the pair is kept in one
   place; a portal it does not know, or whose home is not an ET portal address (techmonk: techgig.com), is its own. */
function siteOfPortal(slug) {
  var home = etFooter.isKnown(slug) ? etPrevious.portalOf(etFooter.info(slug).home) : '';
  return etEvents.isPortal(home) ? home : slug;
}

/* An event's own editions come from its own portal: Create Event's picker lists only that portal's editions, and
   generation reads what is read here (sources) for the site's records, look and logo unit. So for an event that
   has a portal, a previous or current edition picked from ET's list of another portal, or an ET page whose
   address is another portal's, is refused before the page is fetched or the model asked. A competitor's page
   is anyone's; an event with no portal yet, or not created yet, is not checked — and reading a page never sets an
   event's portal.
   The pick says which portal's list the edition came from, so it must be the event's own portal exactly (the
   picker never offers another). The address says only which site serves the page: one served by the other name
   of the event's own site (siteOfPortal) is the event's own; and a pick of the event's own portal whose address
   ET's own list gives as that edition's page (confirmEtPick: ET's record, cached) is the event's own wherever it
   is served. Otherwise an address on another portal is refused — an unconfirmed pick never lets one through,
   since what is read next would be read by that address, as that other portal's.
   -> Promise<the other portal's slug, or '' when the page may be read>, never rejecting */
function otherPortalOf(eventPortal, type, etPick, url) {
  if (!etEvents.isPortal(eventPortal) || (type !== 'previousEdition' && type !== 'currentEdition')) return Promise.resolve('');
  if (etPick && etPick.portal !== eventPortal) return Promise.resolve(etPick.portal);
  var page = etPrevious.portalOf(url);
  if (!etEvents.isPortal(page) || siteOfPortal(page) === siteOfPortal(eventPortal)) return Promise.resolve('');
  if (!etPick) return Promise.resolve(page);
  return confirmEtPick(etPick, url, 'refused: the address is ' + page + '\'s').then(function (pick) { return pick ? '' : page; });
}
function otherPortalError(eventPortal, pagePortal) {
  var ours = portalNameOf(eventPortal), theirs = portalNameOf(pagePortal);
  return httpError(400, 'This event is on ' + ours + ', and that page is ' + theirs + '\'s. Pick one of ' + ours + '\'s editions, or change the event\'s portal first.',
    { code: 'other-portal', eventPortal: eventPortal, pagePortal: pagePortal });
}

/* Internal pages (an award's Categories, Guidelines, Judging Criteria, Jury, FAQs, T&C) need sites of more than
   one page, which come next for every kind of event (the owner, 23 Oct 2026: award sites go live as one page
   first). Until then an award site is its home page: no page sections, no page links; the words written for
   the pages are kept on the event (awardPages) for when they come. */
var SITE_PAGES = true;   // merged 28 Oct 2026 (the internal-pages work): an award site has its pages
/* events/<id>/faqs from an award's FAQs (writeAwardPages: written for this edition; else the previous
   edition's record), only when the event has no FAQ yet — never over the owner's own. Never fails the run. */
function seedAwardFaqs(fb, eventId, got, by) {
  var list = ((got.pages && got.pages.faq) || []).length ? got.pages.faq : ((got.record && got.record.faq) || []);
  list = list.filter(function (f) { return f && f.q && f.a; }).slice(0, 30);
  if (!list.length) return Promise.resolve();
  var col = fb.db.collection('events').doc(eventId).collection('faqs');
  return col.limit(1).get().then(function (snap) {
    if (!snap.empty) return;
    var batch = fb.db.batch(), now = new Date().toISOString(), who = String(by || 'platform');
    list.forEach(function (f, i) {
      batch.set(col.doc(), { question: String(f.q).slice(0, 300), answer: String(f.a).slice(0, 3000), order: i + 1, createdAt: now, updatedAt: now, createdBy: who, updatedBy: who });
    });
    return batch.commit();
  }).then(null, function (err) { console.error('generate-content: the award FAQs of ' + eventId + ' were not stored — ' + (err && err.message)); });
}
/* An award has no speakers: its jury is the event's Speakers records (the console calls them Jury for an award; the
   owner, 28 Oct 2026). events/<id>/speakerGroups and speakers from the jury on record (awardForSite: each group named
   with its edition's year, "Grand Jury 2026", so the owner sees whose they are), the grand jury first — only when the
   event has neither speakers nor speaker groups of its own. Never fails the run. */
var JURY_SEED_MAX = 300;
function seedAwardJury(fb, eventId, jury, by) {
  function https(v) { v = String(v || '').trim(); return /^https:\/\/[^\s"'<>\\]+$/i.test(v) ? v : ''; }
  var groups = (jury || []).map(function (g) {
    return { name: String((g && g.group) || 'Jury').trim().slice(0, 120) || 'Jury', people: ((g && g.people) || []).filter(function (p) { return p && String(p.name || '').trim(); }) };
  }).filter(function (g) { return g.people.length; });
  groups.sort(function (a, b) { return (/grand/i.test(b.name) ? 1 : 0) - (/grand/i.test(a.name) ? 1 : 0); });
  if (!groups.length) return Promise.resolve();
  var ref = fb.db.collection('events').doc(eventId);
  return Promise.all([ref.collection('speakers').limit(1).get(), ref.collection('speakerGroups').limit(1).get()]).then(function (snaps) {
    if (!snaps[0].empty || !snaps[1].empty) return;
    var batch = fb.db.batch(), now = new Date().toISOString(), who = String(by || 'platform'), n = 0;
    var stamp = { createdAt: now, updatedAt: now, createdBy: who, updatedBy: who };
    groups.forEach(function (g, gi) {
      if (n >= JURY_SEED_MAX) return;
      var gref = ref.collection('speakerGroups').doc();
      batch.set(gref, Object.assign({ name: g.name, order: gi + 1 }, stamp));
      g.people.forEach(function (p) {
        if (n >= JURY_SEED_MAX) return;
        n++;
        batch.set(ref.collection('speakers').doc(), Object.assign({
          name: String(p.name).trim().slice(0, 160), desig: String(p.title || '').trim().slice(0, 200), comp: String(p.company || '').trim().slice(0, 200),
          photoUrl: https(p.photo), bio: String(p.bio || '').trim().slice(0, 4000), li: https(p.linkedin), groupId: gref.id, order: n
        }, stamp));
      });
    });
    return batch.commit();
  }).then(null, function (err) { console.error('generate-content: the award jury of ' + eventId + ' was not stored — ' + (err && err.message)); });
}

/* The words of an award site's internal pages (award-site.js): one reading, beside the sections. Rewritten for
   this edition from the previous edition's own pages when its award record has them; with no categories on
   record (an award made from a brief), the categories are proposed here too — free, never with a fee.
   -> Promise<{ award: AWARD with its categories, pages: { guidelines, judging, tnc, faq }, record }>, never
   rejecting: a failed reading leaves the pages it would have written out of the site. */
function writeAwardPages(fb, eventId, stored, sourceDocs, brief, eventMeta) {
  var award = awardForSite(sourceDocs, stored);
  var rec = (sourceDocs || []).filter(function (d) { return d && d.type === 'previousEdition' && d.award; }).map(function (d) { return d.award; })[0] || null;
  var recPages = rec && rec.pages ? rec.pages : {};
  var needCategories = !award.categories.length;
  var prompt = awardSite.buildPagesPrompt({
    event: { name: stored.name || eventMeta.name, dates: award.dates, venue: [stored.venue, stored.city].filter(Boolean).join(', '), description: eventMeta.description },
    brief: brief || null,
    previousPages: { guidelines: recPages.guidelines, judging: recPages.judging, tnc: recPages.tnc, faq: (recPages.faq && recPages.faq.length ? recPages.faq : (rec && rec.faq) || []) },
    needCategories: needCategories
  });
  return llm.callJson(prompt, awardSite.PAGES_SCHEMA, { route: 'generate-content', eventId: eventId, timeoutMs: 100000, maxOutputTokens: AI_OUTPUT_TOKENS.small, onUsage: aiUsageRecorder(fb, eventId, 'generate-content') })
    .then(function (r) {
      if (r.error) console.error('generate-content: the award pages of ' + eventId + ' were not written — ' + (r.code || r.error));
      var pages = awardSite.sanitizePages(r.error ? {} : r.parsed, needCategories);
      if (needCategories) award.categories = pages.categories;
      return { award: award, pages: pages, record: rec };
    }, function () { return { award: award, pages: awardSite.sanitizePages({}, false), record: rec }; });
}
/* what an internal page shows (award-sections.js PAGE_KINDS kind -> its content) */
function awardPageContent(kind, got) {
  var p = got.pages || {}, a = got.award || {};
  if (kind === 'award-category') return a.categories;
  if (kind === 'award-jury') return a.jury;
  if (kind === 'award-guidelines') return p.guidelines;
  if (kind === 'award-judging-criteria') return p.judging;
  if (kind === 'award-tnc') return p.tnc;
  if (kind === 'award-faq') return (p.faq || []).length ? p.faq : ((got.record && got.record.faq) || []);
  return null;
}

/* An ET award's address -> { portal, id: <microsite id>, kind: 'award' } when it is one of that portal's
   awards (et-events.js listAwards, cached), else null — for a previous edition pasted rather than picked. */
function awardPickByLink(url) {
  var portal = etPrevious.portalOf(url);
  if (!etEvents.isPortal(portal)) return Promise.resolve(null);
  return etEvents.listAwards(portal, etJson).then(function (list) {
    var hit = list.filter(function (a) { return pageKey(a.link) && pageKey(a.link) === pageKey(url); })[0];
    return hit ? { portal: portal, id: String(hit.id), kind: 'award' } : null;
  }, function () { return null; });
}
/* the award's record (et-awards.js readAward), bounded for the source document; null when it cannot be read */
var AWARD_PAGE_MAX_BYTES = 3 * 1024 * 1024;
function readAwardRecord(pick) {
  function fetchText(u, headers) {
    return safeFetch(u, { timeoutMs: 15000, maxBytes: AWARD_PAGE_MAX_BYTES, headers: headers || {} }).then(function (r) { return r.status === 200 ? r.body.toString('utf8') : ''; });
  }
  return etAwards.readAward({ portal: pick.portal, micrositeId: pick.id }, { fetchJson: etJson, fetchText: fetchText }).then(function (a) {
    if (!a) return null;
    /* a source document holds at most a few hundred KB of it (Firestore's limit is 1 MB a document) */
    var text = JSON.stringify(a);
    if (text.length > 600 * 1024) {
      a.jury = (a.jury || []).map(function (g) { return Object.assign({}, g, { people: g.people.slice(0, 40).map(function (p) { return Object.assign({}, p, { bio: String(p.bio || '').slice(0, 400) }); }) }); });
      a.guests = [];
    }
    return a;
  }).then(null, function (err) { console.error('ingest-source: award record not read — ' + (err && err.message)); return null; });
}

/* What KIND of picture the previous edition puts in each of its content sections (section-pictures.js):
   its content pictures are fetched (bounded) and read together in one small call, so that the new edition's
   pictures follow its choices section by section. Never fails the step: what cannot be had is not known.
   -> Promise<[{ heading, kind, about }]> */
var SECTION_PICTURE_MAX_BYTES = 1.5 * 1024 * 1024;
function readSectionPictures(eventId, html, url, skip, deadlineAt) {
  var found = [];
  try { found = sectionPictures.picturesIn(html, url, { skip: skip }); } catch (e) { found = []; }
  if (!found.length || (deadlineAt && deadlineAt - Date.now() < 40000)) return Promise.resolve([]);
  return Promise.all(found.map(function (p) {
    return safeFetch(p.url, { timeoutMs: 8000, maxBytes: SECTION_PICTURE_MAX_BYTES }).then(function (r) {
      var info = r.status === 200 ? logoUnit.imageInfo(r.body) : null;
      /* a real picture, big enough to be a section's (an icon or a thumbnail is not) */
      if (!info || ['png', 'jpeg', 'webp', 'gif'].indexOf(info.type) === -1 || !(info.width >= 240 && info.height >= 160)) return null;
      return Object.assign({}, p, { image: { mimeType: info.mime, data: r.body.toString('base64') } });
    }, function () { return null; });
  })).then(function (got) {
    return sectionPictures.classify(got.filter(Boolean), function (prompt, schema, images) {
      return callGeminiJson(prompt, schema, { route: 'ingest-source', eventId: eventId, images: images, maxOutputTokens: AI_OUTPUT_TOKENS.small, timeoutMs: 60000, deadlineAt: deadlineAt })
        .then(function (r) { var record = aiUsageRecorder(null, eventId, 'ingest-source'); if (record) record(r.usage); return r; });
    });
  }).then(null, function (err) { console.error('ingest-source: section pictures not read — ' + (err && err.message)); return []; });
}

/* What the edition looks like, beyond its words (edition-look.js): its palette and type from its own styles,
   its lock-up's colours, and the banner picture it is built on (read by the model, described in words). What
   is read here inspires the new design; none of it is copied into it. Each read is bounded and none can
   fail the step. -> Promise<{ look, keyVisual: { url, width, height, mime } | null, picture: { mimeType, data } | null }> */
/* 3.5 MB: its base64 stays under the 5 MB a picture may be for either provider */
var KEY_VISUAL_MAX_BYTES = 3.5 * 1024 * 1024;
function readEditionLook(url, html, css, logoCandidates) {
  var look = {}, kvUrl = '';
  try { look = editionLook.readLook(html, css); kvUrl = editionLook.keyVisualOf(html, url); }
  catch (e) { console.error('ingest-source: the edition\'s look was not read — ' + (e && e.message)); }
  var first = (logoCandidates || [])[0];
  var logoSvg = !first ? Promise.resolve('')
    : first.kind === 'inline-svg' ? Promise.resolve(first.svg || '')
    : safeFetch(first.url, { timeoutMs: 6000, maxBytes: 1024 * 1024 }).then(function (r) {
      return r.status === 200 && logoUnit.imageInfo(r.body).type === 'svg' ? r.body.toString('utf8') : '';
    }).catch(function () { return ''; });
  var kv = !kvUrl ? Promise.resolve(null) : safeFetch(kvUrl, { timeoutMs: 8000, maxBytes: KEY_VISUAL_MAX_BYTES }).then(function (r) {
    var info = r.status === 200 ? logoUnit.imageInfo(r.body) : null;
    /* a banner: a wide raster picture of some size, not a strip or an icon */
    if (!info || ['image/jpeg', 'image/png', 'image/webp'].indexOf(info.mime) === -1 || !(info.width >= 800) || info.width > 8000 || info.height > 8000 || !(info.width / info.height >= 1.2) || info.width / info.height > 4.5) return null;
    return { url: kvUrl, width: info.width, height: info.height, mime: info.mime, data: r.body.toString('base64') };
  }).catch(function () { return null; });
  return Promise.all([logoSvg, kv]).then(function (both) {
    var full = look;
    try { full = editionLook.withLogo(look, editionLook.logoColours(both[0])); } catch (e) { /* the page's own look stands */ }
    var k = both[1];
    return { look: full, keyVisual: k ? { url: k.url, width: k.width, height: k.height, mime: k.mime } : null, picture: k ? { mimeType: k.mime, data: k.data } : null };
  });
}
/* the model's reading of the banner picture, in words, kept with its address (for reference only) */
function keptKeyVisual(kv, read) {
  if (!kv) return null;
  read = read || {};
  /* at most `max` characters, ending at a sentence (else a word): never half a word in a prompt */
  function line(v, max) {
    var t = String(v || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    t = t.slice(0, max);
    var end = t.lastIndexOf('. ');
    return end > max / 2 ? t.slice(0, end + 1) : t.replace(/\s+\S*$/, '') + '.';
  }
  return {
    url: kv.url, width: kv.width, height: kv.height, mime: kv.mime,
    description: line(read.description, 400), place: line(read.place, 200)
  };
}

/* ---------- a page read a few minutes ago is not read again (BE-065) ----------
   Reading a page costs a fetch, often the rendering service, and a model call. The same page (type and address) read
   for the same event less than SOURCE_FRESH_MS ago — a Retry on the wizard's row, a reload, Generate pressed again — is
   answered from that reading (cached: true) unless the caller asks for refresh: true. A previous edition picked from
   ETB2B's list is read again when the earlier reading got none of its records. Looking it up never fails the step: a
   reading that cannot be looked up is simply read again. -> Promise<{ ref, id, data } | null> */
var SOURCE_FRESH_MS = 10 * 60 * 1000;
var CACHED_READING = {};
function freshSourceReading(fb, eventId, type, url, etPick) {
  return fb.db.collection('events').doc(eventId).collection('sources').where('type', '==', type).where('url', '==', url).get().then(function (same) {
    var now = Date.now();
    return same.docs.map(function (d) { return { ref: d.ref, id: d.id, data: d.data() || {} }; }).filter(function (x) {
      var at = Date.parse(String(x.data.fetchedAt || ''));
      if (!(at > 0) || now - at >= SOURCE_FRESH_MS || at - now > 60000) return false;
      if (!Array.isArray(x.data.extractedSections)) return false;
      return !(etPick && !x.data.previous && !x.data.award);
    }).sort(function (a, b) { return Date.parse(b.data.fetchedAt) - Date.parse(a.data.fetchedAt); })[0] || null;
  }, function (err) {
    console.error('ingest-source: an earlier reading of the page was not looked up, so it is read again — ' + (err && err.message));
    return null;
  });
}
/* answers with that reading, as a new reading is answered, and makes it this run's: the run's later steps read the
   pages read for it (generated-site.js inputs). The reading is changed only while the event is there (watch.within). */
function answerFreshReading(fb, res, watch, eventId, runId, hit) {
  var rec = hit.data;
  var claim = runId && rec.runId !== runId
    ? watch.within(function (tx) { tx.update(hit.ref, { runId: runId }); })
    : Promise.resolve();
  return claim.then(function () {
    var prev = rec.previous;
    var count = function (list) { return Array.isArray(list) ? list.length : 0; };
    sendJson(res, 200, { eventId: eventId, sourceId: hit.id, type: rec.type, url: rec.url, extractedSections: rec.extractedSections || [],
      colorSignals: rec.colorSignals || [], fontSignals: rec.fontSignals || [], design: rec.design === undefined ? null : rec.design, tone: rec.tone === undefined ? null : rec.tone,
      previous: prev ? { name: prev.name, speakers: count(prev.speakers), sponsors: count(prev.sponsors), agenda: count(prev.agenda), glimpses: count(prev.glimpses) } : null,
      cached: true, fetchedAt: rec.fetchedAt });
  });
}

function handleIngestSource(req, res) {
  readBody(req, res, function (raw) {
    var payload;
    try { payload = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    var eventId = String(payload.eventId || '').trim();
    var url = String(payload.url || '').trim();
    var type = Object.prototype.hasOwnProperty.call(SOURCE_TYPE_LABELS, payload.type) ? payload.type : 'previousEdition';
    if (!eventId || !url) return sendJson(res, 400, { error: 'eventId and url are required.' });
    if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });
    if (!/^https?:\/\//i.test(url) || url.length > 2000) return sendJson(res, 400, { error: 'Use the page’s full web address, starting with http:// or https://.', code: 'bad-url' });
    var etPick = etPickOf(payload.etEvent);
    if (etPick === false) return sendJson(res, 400, { error: 'etEvent must name a known portal and a numeric event id.' });
    /* the generation this page is read for (WZ-034): only that run's later steps read it (generated-site.js) */
    var runId = runIdOf(payload);
    if (runId === null) return sendJson(res, 400, { error: RUN_ID_ERROR });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    /* reading a page that had to be rendered can take two minutes: the model works in what is left */
    var deadlineAt = Date.now() + 270000;
    /* a previous edition on ETB2B's own platform is read from ETB2B's event API beside its page (readEtPrevious): its
       records are the material even when the page itself carries little text */
    var etEdition = type === 'previousEdition' && !!(etPick || etPrevious.portalOf(url));

    var watch = null;
    /* BE-020 / BE-026: the page is read through safeFetch (readSourcePage): an address on the public internet only —
       not this server, the network it runs in or the cloud's metadata service — checked before it is connected to and
       again at every redirect, the connection made to exactly the address that was checked (400 bad-url) */
    watchEvent(fb, eventId)
      .then(function (w) {
        watch = w;
        /* another portal's edition is refused here, before the page is fetched (otherPortalOf) */
        return otherPortalOf(w.portal, type, etPick, url);
      })
      .then(function (other) {
        if (other) throw otherPortalError(watch.portal, other);
        /* BE-065: the same page read for this event a few minutes ago (a retried row, a reload, Generate pressed again)
           is not fetched and paid for again; refresh: true reads it again all the same */
        return payload.refresh === true ? null : freshSourceReading(fb, eventId, type, url, etPick);
      })
      .then(function (hit) {
        if (hit) return answerFreshReading(fb, res, watch, eventId, runId, hit).then(function () { return CACHED_READING; });
        return readSourcePage(url, etEdition).then(function (html) {
          return fetchSourceCss(url, html).then(function (css) { return { html: html, css: css }; });
        });
      })
      .then(function (page) {
        if (page === CACHED_READING) return;
        var html = page.html;
        /* colours and fonts are read from the page AND its stylesheets: most sites keep them in the latter */
        var colorSignals = extractColorSignals(html + '\n' + page.css);
        var fontSignals = genDesign.fontFamilies(extractFontSignals(html + '\n' + page.css));
        var tone = genDesign.pageTone(page.css, html);
        var text = stripToText(html).slice(0, MAX_SOURCE_TEXT_CHARS);
        var skeleton = genDesign.markupSkeleton(html);
        /* An edition of this same event: what could be its logo unit is kept (addresses, never pictures),
           with what the page says about its year — plan-structure takes the unit from here. */
        var ownEdition = type === 'previousEdition' || type === 'currentEdition';
        var logoCandidates = !ownEdition ? [] : logoUnit.findLogoCandidates(html, url, String((payload.eventMeta || {}).name || '')).slice(0, 4).map(function (c) {
          var kept = { url: String(c.url || '').slice(0, 1000), kind: c.kind, score: c.score, cls: String(c.cls || '').slice(0, 120), alt: String(c.alt || '').slice(0, 200) };
          if (c.kind === 'inline-svg') kept.svg = String(c.svg || '');
          return kept;
        }).filter(function (c) { return c.kind !== 'inline-svg' || (c.svg && c.svg.length <= 120000); });
        var hints = ownEdition ? logoUnit.editionHints(html, url) : null;
        /* A previous edition on ET's own platform: its real speakers, sponsors, agenda and photos, read from
           ET's event API (et-previous.js) beside the summary below — shown as "Previous Edition …" sections. */
        var confirmed = type !== 'previousEdition' ? Promise.resolve(null) : confirmEtPick(etPick, url);
        var previousRead = type !== 'previousEdition' ? Promise.resolve(null) : confirmed.then(function (pick) {
          return pick || etPrevious.portalOf(url) ? readEtPrevious(url, html, pick) : null;
        });
        /* a previous edition that is one of ET's AWARDS: its award record — categories, jury and partners by
           group, FAQs, and the words of its internal pages (et-awards.js) — kept for the award site */
        var awardRead = type !== 'previousEdition' ? Promise.resolve(null) : confirmed.then(function (pick) {
          return pick && pick.kind === 'award' ? pick : awardPickByLink(url);
        }).then(function (pick) { return pick ? readAwardRecord(pick) : null; }, function () { return null; });
        var editionHints = hints ? {
          title: String(hints.title || '').slice(0, 200), headings: (hints.headings || []).slice(0, 6).map(function (h) { return String(h).slice(0, 200); }),
          years: (hints.years || []).slice(0, 8), editionImage: String(hints.editionImage || '').slice(0, 1000)
        } : null;
        /* an edition of this event: its own look, and its banner picture for the model to read with the page */
        var lookRead = ownEdition ? readEditionLook(url, html, page.css, logoCandidates) : Promise.resolve(null);
        return lookRead.then(function (edition) {
          var picture = edition && edition.picture;
          var ask = { route: 'ingest-source', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.small, deadlineAt: deadlineAt, onUsage: aiUsageRecorder(fb, eventId, 'ingest-source') };
          if (picture) ask.images = [picture];
          /* a picture the model turned away is not a reason to lose the page: it is read again without it */
          var read = llm.callJson(buildIngestSourcePrompt(url, type, text, skeleton, !!picture), ingestSchemaFor(!!picture), ask).then(function (r) {
            if (!picture || !r.error || r.code !== 'ai-rejected') return r;
            edition.keyVisual = null;
            return llm.callJson(buildIngestSourcePrompt(url, type, text, skeleton, false), ingestSchemaFor(false), Object.assign({}, ask, { images: undefined }));
          });
          /* the previous edition's section pictures, by kind — read beside the page (the banner is the key visual) */
          var picturesRead = type !== 'previousEdition' ? Promise.resolve([]) :
            readSectionPictures(eventId, html, url, [edition && edition.keyVisual && edition.keyVisual.url], deadlineAt);
          return Promise.all([read, previousRead, edition, picturesRead, awardRead]);
        }).then(function (both) {
          var r = both[0], previous = both[1], edition = both[2], pictureKinds = both[3] || [], award = both[4] || null;
          if (r.error) return sendAiFailure(res, r);
          var look = edition ? edition.look : null;
          var keyVisual = edition ? keptKeyVisual(edition.keyVisual, r.parsed.keyVisual) : null;
          var sections = (r.parsed.sections || []).slice(0, 25).map(function (s) {
            return { heading: String(s.heading || '').slice(0, 120), body: String(s.body || '').slice(0, 500) };
          });
          var design = sanitizeSourceDesign(r.parsed.design);
          var now = new Date().toISOString();
          var sourcesRef = fb.db.collection('events').doc(eventId).collection('sources');
          var record = {
            /* createdBy: who had the page read (BE-058: every write names who made it) */
            type: type, url: url, extractedSections: sections, colorSignals: colorSignals, fontSignals: fontSignals,
            design: design, tone: tone, logoCandidates: logoCandidates, editionHints: editionHints, fetchedAt: now, createdBy: actorOf(req.user),
            previous: previous || null, look: look, keyVisual: keyVisual, sectionPictures: pictureKinds, award: award
          };
          if (runId) record.runId = runId;
          /* the same page read again (generating the site again) replaces its earlier reading: two readings of
             one previous edition left plan-structure taking whichever Firestore listed first. What ET's API gave the
             earlier reading (its award record, its speakers and photos) and the logo examined for it are kept when
             this reading got none: ET's API answering nothing for a while (28 Oct 2026) must not cost a site its
             categories and jury. */
          return watch.stillThere().then(function () {
            return sourcesRef.where('type', '==', type).where('url', '==', url).get();
          }).then(function (same) {
            if (same.empty) return sourcesRef.add(record);
            var earlier = same.docs.map(function (d) { return d.data() || {}; });
            ['award', 'previous', 'examinedUnit'].forEach(function (k) {
              if (record[k]) return;
              var had = earlier.filter(function (e) { return e[k]; })[0];
              if (had) record[k] = had[k];
            });
            var keep = same.docs[0].ref;
            return Promise.all(same.docs.slice(1).map(function (d) { return d.ref.delete(); }))
              .then(function () { return keep.set(record); }).then(function () { return keep; });
          }).then(function (sourceRef) {
            sendJson(res, 200, { eventId: eventId, sourceId: sourceRef.id, type: type, url: url, extractedSections: sections, colorSignals: colorSignals, fontSignals: fontSignals, design: design, tone: tone,
              previous: previous ? { name: previous.name, speakers: previous.speakers.length, sponsors: previous.sponsors.length, agenda: previous.agenda.length, glimpses: previous.glimpses.length } : null });
            if (watch.live) logActivity(fb, eventId, req.user, 'source-added', ({ previousEdition: 'previous edition', currentEdition: 'current edition', competitor: 'competitor' }[type] || 'source') + ' page read for the AI: ' + url.split(/[?#]/)[0].slice(0, 200), { area: 'content' });
          });
        });
      })
      .catch(function (err) {
        /* a refusal made on purpose says why; anything else is logged (the page without its query) and answered in one fixed sentence */
        sendStepFailure(res, err, 502, 'That page could not be read. Please try again, or skip it.', 'ingest-source ' + url.split(/[?#]/)[0].slice(0, 200));
      });
  }, BODY_LIMITS.small);
}

/* ---------- reading the page itself (BE-026) ----------
   Through safeFetch: a public address only, checked again at every redirect, the connection made to the address
   that was checked, 20 s in all, at most 2 MB, and only a web page (an HTML answer — or one that names no type).
   A site that turns away anything but a browser (several ETB2B verticals do) is read the way an import is: by the
   rendering service, in a real browser. So is a page that builds itself in the browser, whose plain answer is an
   empty shell (a lone <div id="root"> and its scripts): a page with less than SOURCE_MIN_TEXT_CHARS of visible text
   is rendered, and when it still has too little — or the service is not there — it is refused with 422
   'unreadable', before any model call: the model is not paid to "read" a title, and nothing is stored as if the
   page had been read. thinOk: a previous edition on ETB2B's own platform, whose records come from ETB2B's event API.
   -> Promise<html> or a rejection made with httpError (bad-url 400, not-a-page 415, too-large 413,
   unreachable-url 502/504, unreadable 422). */
var SOURCE_PAGE_MAX_BYTES = 2 * 1024 * 1024;
var SOURCE_PAGE_TIMEOUT_MS = 20000;
var SOURCE_MIN_TEXT_CHARS = 400;
var SOURCE_PAGE_TYPES = [/^(?:text\/html|application\/xhtml\+xml)?$/];
var SOURCE_RENDERED_STATUSES = [401, 403, 406, 429, 503];
function visibleTextLength(html) { return stripToText(String(html || '')).replace(/\s+/g, ' ').trim().length; }
function sourceFetchError(err) {
  var code = err && err.code;
  if (code === 'bad-url' || code === 'blocked-address') return httpError(400, err.message, { code: 'bad-url' });
  if (code === 'bad-type') return httpError(415, 'That link is not a web page. Paste the address of a page, or skip it.', { code: 'not-a-page' });
  if (code === 'too-large') return httpError(413, 'That page is too large to read (over 2 MB). Skip it, or paste its text into the description.', { code: 'too-large' });
  if (code === 'timeout') return httpError(504, 'That site took too long to answer (over 20 seconds). Try again, or skip it.', { code: 'unreachable-url' });
  return httpError(502, 'That site could not be reached. Check the address, or skip it.', { code: 'unreachable-url' });
}
function renderSourcePage(url) {
  return scrapeLovableUrl(url).then(function (rendered) {
    return { html: stripAllScriptTags(rendered), rendered: true };
  }, function (err) {
    console.error('ingest-source: the rendering service could not read ' + url.split(/[?#]/)[0].slice(0, 200) + ' — ' + (err && err.message));
    throw httpError(502, 'That page could not be read. Check the address, or skip it.', { code: 'unreachable-url' });
  });
}
function readSourcePage(url, thinOk) {
  var scraper = !!process.env.LOVABLE_SCRAPER_URL;
  /* the User-Agent this step always sent: some sites answer only a client that says "Mozilla" */
  return safeFetch(url, { timeoutMs: SOURCE_PAGE_TIMEOUT_MS, maxBytes: SOURCE_PAGE_MAX_BYTES, maxRedirects: 5, accept: SOURCE_PAGE_TYPES,
    userAgent: 'Mozilla/5.0 (compatible; RevampCMS-Pilot/1.0)' })
    .then(function (r) {
      if (r.status >= 200 && r.status < 300) return { html: r.body.toString('utf8'), rendered: false };
      if (SOURCE_RENDERED_STATUSES.indexOf(r.status) !== -1 && scraper) return renderSourcePage(url);
      throw httpError(502, 'That page answered with an error (HTTP ' + r.status + '). Check the address, or skip it.', { code: 'unreachable-url', httpStatus: r.status });
    }, function (err) { throw sourceFetchError(err); })
    .then(function (page) {
      if (page.rendered || !scraper || visibleTextLength(page.html) >= SOURCE_MIN_TEXT_CHARS) return page;
      /* an empty shell: the page as a browser shows it, when the service can render it (else the shell, refused below) */
      return renderSourcePage(url).then(function (seen) {
        return visibleTextLength(seen.html) > visibleTextLength(page.html) ? seen : page;
      }, function () { return page; });
    })
    .then(function (page) {
      if (!thinOk && visibleTextLength(page.html) < SOURCE_MIN_TEXT_CHARS) {
        throw httpError(422, 'Too little of this page could be read (it may build itself in the browser). Skip it, or paste its text into the description.', { code: 'unreadable' });
      }
      return page.html;
    });
}

/* ---------- GENERATED TEMPLATES — theme extraction, hero image ----------
   A "generated" template (id 'gen-<eventId>') has no templates/<id>/ folder and no fixed component library
   at all anymore — Gemini designs its own structure AND its own HTML/CSS per event (see the AI-DESIGNED
   GENERATED TEMPLATES PIPELINE block further down: POST /api/plan-structure, POST /api/generate-content's
   'gen-' branch, GET /api/generated-template, GET /api/generated-section). This block only holds the two
   pieces of that pipeline that are still genuinely shared, unchanged infrastructure: previousEdition theme
   signal extraction (grounding input, never a mechanical output anymore) and hero background image
   generation. */

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

  /* The edition's own look (edition-look.js, read at ingest from the page's own styles and its lock-up) is
     the event's brand. colorSignals, a frequency count over the page AND the platform's shared stylesheets,
     is the fallback for a source read before the look was: on an ET microsite its first colour is ET's own
     red, not the event's own colour. */
  var look = null;
  prev.some(function (s) { if (s.look && (s.look.brand || s.look.background || s.look.headingFont || s.look.bodyFont)) { look = s.look; return true; } return false; });
  var themeColor = look && look.brand ? look.brand : null;
  if (!themeColor) prev.some(function (s) {
    var signals = s.colorSignals || [];
    if (signals.length) { themeColor = signals[0]; return true; }
    return false;
  });

  // Fonts: tally every previousEdition source's own fontSignals (also already ranked per-source), weighting
  // each by its rank within that source, then pick the two most-frequent DISTINCT families across all of
  // them as heading/body.
  var tally = {};
  prev.forEach(function (s) {
    var signals = genDesign.fontFamilies(s.fontSignals || []);
    /* counted as the Google families they are or stand in for: a page's own licensed face is never named */
    signals.forEach(function (family, idx) {
      var g = googleFonts.toGoogle(family);
      if (g) tally[g] = (tally[g] || 0) + (signals.length - idx);
    });
  });
  var ranked = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; });
  var headingFont = ranked[0] || THEME_FALLBACK.headingFont;
  var bodyFont = (ranked[1] && ranked[1] !== headingFont) ? ranked[1] : (ranked.length ? THEME_FALLBACK.bodyFont : THEME_FALLBACK.bodyFont);
  /* the edition's type by role: what its headings and its body are set in */
  var lookHead = look && googleFonts.toGoogle(look.headingFont), lookBody = look && googleFonts.toGoogle(look.bodyFont);
  if (lookHead || lookBody) {
    headingFont = lookHead || lookBody;
    bodyFont = lookBody || lookHead;
    ranked = [headingFont];
  }
  var keyVisual = null;
  prev.some(function (s) { if (s.keyVisual && s.keyVisual.url) { keyVisual = s.keyVisual; return true; } return false; });

  return {
    themeColor: themeColor || THEME_FALLBACK.themeColor,
    headingFont: headingFont,
    bodyFont: bodyFont,
    look: look,
    keyVisual: keyVisual,
    usedFallback: { color: !themeColor, font: !ranked.length, noPreviousEditionSource: !prev.length }
  };
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
/* the colour along a picture's bottom edge (its lowest 6 per cent, averaged), for the page to run on from the banner
   (genDesign.pageColoursFrom); null for a picture that is not a PNG or cannot be read */
function bottomColour(buffer, mimeType) {
  if (!/png/i.test(String(mimeType || ''))) return null;
  var img = pngLite.decode(buffer);
  if (!img || !img.width || !img.height) return null;
  var y0 = Math.max(0, Math.floor(img.height * 0.94)), n = 0, r = 0, g = 0, b = 0, d = img.data;
  for (var y = y0; y < img.height; y++) {
    for (var x = 0; x < img.width; x += 2) { var o = (y * img.width + x) * 4; if (d[o + 3] < 128) continue; r += d[o]; g += d[o + 1]; b += d[o + 2]; n++; }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
}
function buildHeroImage(fb, eventId, brief, themeColor, prompt, stamp) {
  return callGeminiImage(prompt || buildHeroImagePrompt(brief, themeColor), { route: 'plan-structure', eventId: eventId }).then(function (r) {
    var record = aiUsageRecorder(fb, eventId, 'pictures');
    if (record) record(r.usage);
    if (r.error) {
      console.error('plan-structure: hero image generation failed, degrading to no hero image — ' + r.error);
      return { heroImageUrl: null, heroImageStoragePath: null, heroImageError: r.error };
    }
    var buffer = Buffer.from(r.base64, 'base64');
    /* named after the run (stamp), like every other generated picture: what one name holds never changes,
       so it can be cached for a year and get WebP copies (pictures.js) */
    var ext = /jpe?g/i.test(r.mimeType) ? 'jpg' : /webp/i.test(r.mimeType) ? 'webp' : 'png';
    var storagePath = 'events/' + eventId + '/generated/' + (stamp ? stamp + '-' : '') + 'hero-bg.' + ext;
    var file = fb.bucket.file(storagePath);
    /* The raw base64 (often several hundred KB-plus) must never go into Firestore directly — a single
       document is capped at 1MiB total, and an inline data: URI that size blew right through it the first
       time this ran ("Property theme contains an invalid nested entity"). The image already lives in
       Storage; Firestore only needs a real URL to it, same as any other image reference in this app. */
    return file.save(buffer, { metadata: { contentType: r.mimeType, cacheControl: stamp ? pictures.CACHE : 'public, max-age=3600' } })
      .then(function () { return file.makePublic(); })
      .then(function () { return pictures.storeVariants(fb, storagePath, buffer); })
      .then(function () {
        var heroImageUrl = 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath;
        var bottom = null;
        try { bottom = bottomColour(buffer, r.mimeType); } catch (e) { bottom = null; }
        return { heroImageUrl: heroImageUrl, heroImageStoragePath: storagePath, heroImageError: null, heroBottom: bottom };
      })
      .catch(function (err) {
        console.error('plan-structure: hero image generated but Storage save/publish failed, degrading to no hero image — ' + err.message);
        return { heroImageUrl: null, heroImageStoragePath: null, heroImageError: 'The banner picture could not be saved.' };
      });
  }).catch(function (err) {
    console.error('plan-structure: hero image generation threw unexpectedly, degrading to no hero image — ' + (err && err.stack || err));
    return { heroImageUrl: null, heroImageStoragePath: null, heroImageError: 'The banner picture could not be made.' };
  });
}

/* One picture for one section of a generated site: made, stored under the event and answered as
   { sectionId, url, subject } — or null when it could not be made, which costs the site that one picture
   and nothing else. `stamp` keeps a re-run's pictures apart from the last run's (a cached old picture under
   the same address would otherwise be shown for the new site). */
function buildSectionImage(fb, eventId, sectionId, subject, design, stamp, context, about, level, kind) {
  return callGeminiImage(genDesign.imagePrompt(subject, design, { context: context, about: about, level: level, kind: kind }), { route: 'plan-structure', eventId: eventId }).then(function (r) {
    var record = aiUsageRecorder(fb, eventId, 'pictures');
    if (record) record(r.usage);
    if (r.error) { console.error('plan-structure: picture for "' + sectionId + '" failed — ' + r.error); return null; }
    var ext = /jpe?g/i.test(r.mimeType) ? 'jpg' : /webp/i.test(r.mimeType) ? 'webp' : 'png';
    var storagePath = 'events/' + eventId + '/generated/' + stamp + '-' + sectionId + '.' + ext;
    var file = fb.bucket.file(storagePath), bytes = Buffer.from(r.base64, 'base64');
    /* the run's stamp makes the name unique: cached for a year, with WebP copies (pictures.js) */
    return file.save(bytes, { metadata: { contentType: r.mimeType, cacheControl: pictures.CACHE } })
      .then(function () { return file.makePublic(); })
      .then(function () { return pictures.storeVariants(fb, storagePath, bytes); })
      .then(function () { return { sectionId: sectionId, url: 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath, subject: subject }; });
  }).catch(function (err) {
    console.error('plan-structure: picture for "' + sectionId + '" failed — ' + err.message);
    return null;
  });
}

/* ---------- shared id/value sanitizers — AI-DESIGNED GENERATED TEMPLATES PIPELINE ----------
   Used by both POST /api/plan-structure (section ids) and POST /api/generate-content's 'gen-' branch
   (matching returned section code back to planned ids). */
function slugifyId(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}
function clampHexColor(v, fallback) {
  var s = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
}
/* a font the design names, as a Google Fonts family (google-fonts.js): a licensed face the model or the
   previous edition named is set in the Google family nearest to it, anything else in the fallback */
function clampFontName(v, fallback) {
  return googleFonts.googleOnly(String(v || '').trim().slice(0, 60), fallback);
}
// Not part of THEME_FALLBACK (left completely unchanged per the design brief) — accentColor is a new field
// that object never had, so it gets its own small fallback constant instead of growing that one.
var DESIGN_FALLBACK_ACCENT = '#0f172a';

/* ---------- POST /api/plan-structure — AI-DESIGNED GENERATED TEMPLATES PIPELINE, step 1 ----------
   Reads the event's latest brief + all its sources (same read as handleGenerateContent always has), asks
   Gemini to independently DESIGN this event's site — its own section list (ids/kinds/purposes, freely
   chosen, no fixed library to pick from) AND an overall creative direction (mood/colours/fonts) — grounded
   only in this event's own real material. previousEdition colorSignals/fontSignals (extractThemeFrom
   PreviousEditionSources, unchanged) are fed in as a real signal to weigh, never a mechanical formula to
   copy — this is the direct fix for the bug that put every under-resourced event (no sources at all) on the
   exact same hardcoded THEME_FALLBACK palette: Gemini must always produce a considered, event-specific
   palette, with or without a previous-edition signal. Persists {designPlan} onto the event's own doc, and
   explicitly nulls out the old pipeline's matchedTemplateId/structurePlan/theme fields so a re-run of an
   old-pipeline event cleanly migrates. Step 2 (POST /api/generate-content's 'gen-' branch, further down)
   reads designPlan back and writes the real HTML/CSS for every section it describes. */
var DESIGN_SECTION_KINDS = ['custom', 'speakers', 'sessions', 'faq', 'partners', 'contact', 'glimpses'];

/* A STANDARD site is made of the sections every ET event microsite has had, edition after edition — these
   twelve and no others. Which of them a site gets is read from its reference page (what the previous
   edition had is made again for this one) and from the brief; the document and the owner's instructions
   can ask for one or rule one out. Everything else about the site — pictures, type, motion, the hero — is
   as for an ADVANCED site, whose sections the AI chooses freely. `also`: other names a section goes by. */
var STANDARD_SECTIONS = [
  { id: 'overview', name: 'Overview', kind: 'custom', also: /overview|about (the )?(event|summit|conclave|awards|conference)|introduction|why now|the theme/ },
  /* ET's newer event sites (upcoming IP events, 23 Oct 2026): a band of big numbers under the banner, a "What awaits
     you" band of photo cards, and a closing call to act on a photo */
  { id: 'by-the-numbers', name: 'By the Numbers', kind: 'custom', also: /numbers|stats|in figures|scale|at a glance/ },
  { id: 'what-awaits', name: 'What Awaits You', kind: 'custom', also: /what awaits|experience|formats?|what to expect|inside/ },
  { id: 'closing-cta', name: 'Take Your Seat', kind: 'custom', also: /closing|take your seat|join us|call to action|cta/ },
  { id: 'speakers', name: 'Speakers', kind: 'speakers', also: /speaker|jury|panel(l)?ist|faculty/ },
  { id: 'agenda', name: 'Agenda', kind: 'sessions', also: /agenda|schedule|programme|program|session|itinerary/ },
  { id: 'sponsors', name: 'Sponsors', kind: 'partners', also: /sponsor|partner|supported by|exhibitor/ },
  { id: 'key-discussion-points', name: 'Key Discussion Points', kind: 'custom', also: /discussion|key (topic|theme|point|takeaway)|track|what (we|you).ll discuss|spotlight|pillar/ },
  { id: 'who-should-attend', name: 'Who Should Attend', kind: 'custom', also: /who should attend|who (will|is) (attend|in the room)|audience|delegate profile|industries in the room/ },
  { id: 'why-join-us', name: 'Why Join Us', kind: 'custom', also: /why (join|attend|participate|nominate)|reasons to|benefit|what awaits/ },
  { id: 'resources', name: 'Resources', kind: 'custom', also: /resource|download|brochure|report|whitepaper|media kit/ },
  { id: 'contact-us', name: 'Contact Us', kind: 'contact', also: /contact|get in touch|reach us|enquir|queries/ },
  { id: 'faqs', name: 'FAQs', kind: 'faq', also: /faq|frequently asked|questions/ },
  { id: 'about-vertical', name: 'About Vertical', kind: 'custom', also: /about (et|the economic times|us|the organi[sz]er|the vertical)|about et[a-z]+|organi[sz]ed by/ },
  { id: 'past-edition-glimpses', name: 'Past Edition Glimpses', kind: 'glimpses', also: /glimpse|gallery|past edition|previous edition|highlights|photos|moments/ }
];
function standardSectionFor(id) {
  var key = slugifyId(id);
  var exact = STANDARD_SECTIONS.filter(function (x) { return x.id === key; })[0];
  if (exact) return exact;
  var words = key.replace(/-/g, ' ');
  return STANDARD_SECTIONS.filter(function (x) { return x.also.test(words); })[0] || null;
}
var DESIGN_PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    /* called "evidence", not "reasoning": Claude refuses an answer format that asks for a field of that
       name (it reads it as a request for the model's own reasoning) */
    evidence: { type: 'STRING', description: 'A note for the team, never shown on the site: the specific evidence (from the brief, the reference pages, the event\'s facts) behind each section and each design choice.' },
    /* written to events/<id>.description when that is empty or the owner's raw brief (event-description.js) */
    eventDescription: { type: 'STRING', description: eventDescription.RULE },
    design: {
      type: 'OBJECT',
      properties: {
        mood: { type: 'STRING', description: '2-4 sentences: the specific visual identity for THIS event (tone, typographic character, layout character) — concrete and specific to this event, never generic conference boilerplate.' },
        mode: { type: 'STRING', enum: ['light', 'dark'], description: 'Whether the page as a whole is light (dark text on a light background) or dark (light text on a dark background).' },
        themeColor: { type: 'STRING', description: 'hex, e.g. #1a2b3c — the brand colour: buttons, links, highlights' },
        accentColor: { type: 'STRING', description: 'hex — a second colour that works beside the theme colour' },
        backgroundColor: { type: 'STRING', description: 'hex — the page background; light in light mode, dark in dark mode' },
        surfaceColor: { type: 'STRING', description: 'hex — cards and alternating bands, a step away from the background' },
        textColor: { type: 'STRING', description: 'hex — body text, strongly readable on the background' },
        mutedColor: { type: 'STRING', description: 'hex — secondary text, still comfortably readable on the background' },
        headingFont: { type: 'STRING', description: 'a real Google Fonts family name' },
        bodyFont: { type: 'STRING', description: 'a real Google Fonts family name' },
        layout: { type: 'STRING', description: '2-3 sentences: the layout system of the whole page — the grid, how sections vary (in layout, never by flipping between light and dark), how pictures are placed, what the hero is built like. Specific enough that two designers would build the same page from it.' },
        cornerRadius: { type: 'STRING', enum: ['0', '6', '12', '20'], description: 'Corner radius in px used for every card, picture and input on the site (buttons follow it too).' },
        imageStyle: { type: 'STRING', description: 'One sentence: the single PHOTOGRAPHIC style every generated picture on this site shares — the look of the photographs, not their subject (e.g. "editorial event photography, wide and atmospheric, deep shadows with warm stage light and teal accents").' },
        logoUnit: {
          type: 'OBJECT',
          description: 'The event\'s NAME, split into three parts for its logo lock-up without changing, adding or dropping a single word: the one distinctive keyword that identifies this event (what a regular would call it for short — "TECH500" in "TECH500 Summit", "EV" in "EV Conclave", "CIO" in "ETCIO Awards 2027" is not a word so the keyword is "ETCIO"), and whatever of the name comes before and after it. Generic words (Summit, Awards, Conclave, Forum, Conference, the year) are never the keyword.',
          properties: {
            before: { type: 'STRING', description: 'The words of the name before the keyword, or an empty string.' },
            keyword: { type: 'STRING', description: 'The one or two distinctive words.' },
            after: { type: 'STRING', description: 'The words of the name after the keyword, or an empty string.' },
            style: { type: 'STRING', enum: ['stacked', 'inline', 'boxed', 'underline'], description: 'How the lock-up is set when it has to be drawn new: stacked (three centred lines, the classic), inline (one line, for a short name), boxed (the keyword reversed out of a theme-colour box), underline (stacked, with a theme-colour rule under the keyword). Choose what suits this design\'s mood.' }
          },
          required: ['before', 'keyword', 'after', 'style']
        },
        heroTagline: { type: 'STRING', description: 'The ONE line under the event\'s name in the hero banner: what this event is, or its promise, in at most 10 words, no full stop needed (e.g. "India\'s Most Influential Enterprise Technology Decision-Makers. One Room."). Not the event\'s name, not a paragraph.' },
        placeCity: { type: 'STRING', description: 'When THE PLACE is given below: the city of that venue, as its own name (e.g. from "Hotel X, Juhu, <city>, <state>" the city). An empty string when no place is given.' },
        placeCues: { type: 'STRING', description: 'When THE PLACE is given below: one sentence, the visual cues of that city a local would recognise at once (its architecture, landscape, light, crafts and textiles), for its pictures to carry — tasteful, never a postcard. An empty string when no place is given.' },
        placeMotif: { type: 'STRING', description: 'When THE PLACE is given below: one graphic motif drawn from that city\'s own crafts or architecture that a designer can draw in simple lines (a pattern, a border, an outline). An empty string when no place is given.' },
        heroImage: { type: 'STRING', description: 'One or two sentences: the KEY VISUAL of the hero banner, as ET\'s own event sites have it — a rich, full-colour designed composition (a photo-real 3-D render, a detailed illustration or a photo-collage — never thin line art or a wireframe, never a photograph of an audience and a stage) of the objects, machines, infrastructure and symbols of THIS event\'s own field (for automotive technology: an EV battery pack, ADAS sensors, a software-defined car in cutaway; for ports: container ships and cranes; for pharma: molecules, vials, a lab), together with the landmarks of the host city when one is known. No people, no text, no logos.' }
      },
      required: ['mood', 'mode', 'themeColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor', 'mutedColor', 'headingFont', 'bodyFont', 'layout', 'cornerRadius', 'imageStyle', 'logoUnit', 'heroTagline', 'placeCity', 'placeCues', 'placeMotif', 'heroImage']
    },
    sections: {
      type: 'ARRAY',
      description: 'The MIDDLE sections only — never include nav, hero or footer, those are added automatically. Freely choose ids, purposes and ordering; this is not a menu to pick from.',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'short kebab-case id, unique, describing this section\'s actual role (e.g. "why-attend", "agenda-day-one", "speaker-lineup") — never a generic name like "section-1".' },
          kind: { type: 'STRING', enum: DESIGN_SECTION_KINDS, description: '"custom" for anything editorial/static that you write yourself; one of the others ONLY when this section is really that specific data-bound type (see below).' },
          purpose: { type: 'STRING', description: 'one sentence: what real, grounded content this section will hold and why it belongs on this specific event\'s site.' },
          layout: { type: 'STRING', description: 'one sentence: how THIS section is laid out (e.g. "picture left, text right, three ticked points under the text", "one band of four large numbers", "three-column cards with an icon each", "a vertical timeline"). Neighbouring sections must not share a layout.' },
          image: { type: 'STRING', description: 'What the picture in this section shows, in one concrete sentence, of the KIND given in imageKind: the real thing THIS section is about (not a generic backdrop, and different from every other picture on the page). people: the gathering — delegates in conversation, an audience, an awards table; place: the venue or the city itself; subject: the field\'s own technology, products, materials or workplace, in detail, no people; graphic: an illustration drawn from the subject. People appear only in a "people" picture: Indian, women and men in about equal numbers, women in leading roles too; never a real or named person. No text or logos. Empty string only for a section that carries no generated picture.' },

          imageKind: { type: 'STRING', enum: genDesign.IMAGE_KINDS, description: 'The KIND of that picture (see PICTURE KINDS): "people" only where the section is about people or the gathering; "place", "subject" or "graphic" otherwise. Any value when the section has no picture.' }
        },
        required: ['id', 'kind', 'purpose', 'layout', 'image', 'imageKind']
      }
    }
  },
  required: ['evidence', 'eventDescription', 'design', 'sections']
};

/* What a generated site is modelled on. The event's own previous edition comes first (a returning visitor
   should recognise the event), then its current edition, then a competitor; a site with none of them starts
   from an art direction fixed for that event (gen-design.js), so that two such sites do not look alike. */
var REFERENCE_ORDER = ['previousEdition', 'currentEdition', 'competitor'];
function usableDesign(s) {
  var d = s && s.design;
  return !!(d && (d.sectionPattern || []).length >= 2 && d.layoutStyle);
}
function designReference(sourceDocs) {
  var basis = null;
  REFERENCE_ORDER.forEach(function (type) {
    if (basis) return;
    basis = (sourceDocs || []).filter(function (s) { return s && s.type === type && usableDesign(s); })[0] || null;
  });
  var others = (sourceDocs || []).filter(function (s) { return s !== basis && usableDesign(s); });
  return { basis: basis, others: others };
}

/* About two fifths of a generated page is pictures: the hero's, and one for most of the sections the model
   writes itself. Each is a paid image call, made side by side with the others. */
/* ET's newer standard (its upcoming event sites, studied 23 Oct 2026): a numbers band, a "What awaits you" band of
   photo cards, editorial serif headlines, light and dark bands alternating, and the previous edition's REAL photos
   in the banner, the overview, the cards and the closing band (newStandardPictures). false: the earlier rules. */
var NEW_ET_STANDARD = true;
/* Pictures on an ET event or award site are few (200 recent ET sites, 23 Oct 2026): a median of one or two
   made for a section, a third of event sites none — the rest of the page's pictures are real (the previous
   edition's photos, speakers, jury, logos) and its sections carry icons. */
var MAX_SECTION_IMAGES = 3;
/* where ET puts a section's picture, in the order a picture is kept when there are more (etPictureRules) */
var PICTURE_SECTIONS = [
  { re: /venue|city|location|getting-there|travel|stay/, kind: 'place' },
  { re: /how-it-works|how-our-awards|judging|evaluation|process/, kind: 'subject' },
  { re: /why-(join|attend|enter)|reasons|what-awaits|experience/, kind: 'people', real: true },
  { re: /key-discussion|discussion|themes?|tracks|focus|pillars|topics|sectors/, kind: 'subject' },
  { re: /^overview$|about-the-(event|summit|awards)/, kind: 'subject' }
];
/* of those, the ones whose picture is of people (genDesign.IMAGE_KINDS): a page of faces section after section
   read as one picture repeated (the owner, 22 Oct 2026) */
var MAX_PEOPLE_PICTURES = 2;
/* a section that is about people or the gathering itself — the first to keep a picture of people */
var PEOPLE_SECTION = /network|who-?(?:should|attends|is-it-for|enter)|attendee|audience|delegate|community|testimonial|experience|gala|ceremony|awards?-night|night|meet|connect/i;

/* The previous edition's look, for the plan prompt: its palette and type as its own page sets them, its
   lock-up's colours and its banner artwork in words (edition-look.js, read at ingest). The new site is
   INSPIRED BY all of this — never a copy: no hex value, font, picture or layout of it is taken over. */
function editionLookLines(look, keyVisual) {
  var out = [];
  if (look) {
    var page = [];
    if (look.background) page.push('a ' + (genDesign.luminance(look.background) < 0.2 ? 'dark' : 'light') + ' ground (' + look.background + ')');
    if (look.text) page.push('text ' + look.text);
    if (look.brand) page.push('brand ' + look.brand);
    if (look.accent) page.push('second colour ' + look.accent);
    if ((look.logoColours || []).length) page.push('a logo lock-up drawn in ' + look.logoColours.slice(0, 4).join(', '));
    if (page.length) out.push('Its palette, read from its own styles: ' + page.join(', ') + '.');
    function kind(raw, google) { return (editionLook.fontKind(google || raw) === 'serif' ? 'a serif' : 'a sans-serif') + ' (' + raw + ')'; }
    var type = [];
    if (look.headingFontRaw) type.push('headings in ' + kind(look.headingFontRaw, look.headingFont));
    if (look.bodyFontRaw) type.push('text in ' + kind(look.bodyFontRaw, look.bodyFont));
    if (type.length) out.push('Its type: ' + type.join(', ') + '.');
    if (page.length || type.length) out.push('The new edition is INSPIRED BY this, not a copy of it: choose your OWN palette in the same colour family and tone (derive it — never reuse these hex values one for one) and your OWN two Google Fonts families with the same feel (never the same families). A returning visitor should sense the same event; nobody should see last year\'s page.');
  }
  if (keyVisual && keyVisual.description) {
    /* its place is not passed on: the city this site shows is THE PLACE's (this edition's venue, else the last
       one's), never the one the old banner happens to show */
    out.push('ITS BANNER ARTWORK, in words: ' + keyVisual.description +
      ' The new hero picture is newly made, inspired by it (its mood, palette family and the way it is made) — never a copy of it: describe a scene of your own in design.heroImage, and let design.imageStyle sit in the same mood so that every picture on the site reads as one set. Any city or landmark that artwork shows is not carried over: the only place this site shows is THE PLACE, when one is given.');
  }
  return out;
}

function buildDesignPlanPrompt(payload) {
  var ref = payload.reference || { basis: null, others: [] };
  /* a brief that is a designed presentation gives the site its look (deckIdentity); otherwise null */
  var deck = payload.brief && payload.brief.visualIdentity && payload.brief.visualIdentity.designed === 'yes' ? payload.brief.visualIdentity : null;
  var mode = payload.themeMode || 'auto';
  var lines = [
    'You are the lead designer of a bespoke event microsite, for ETB2B EventSphere\'s event builder. You decide its SECTION STRUCTURE, the layout of every section, its colours and type, and which sections carry a picture. A second step writes the HTML and CSS from exactly what you decide here, so be specific.',
    ''
  ];

  if (ref.basis) {
    /* a previous edition INSPIRES the new one (a fresh design, nothing of it copied); any other reference
       page is followed as it always was */
    var inspiredByEdition = ref.basis.type === 'previousEdition';
    lines.push(
      inspiredByEdition
        ? 'THE REFERENCE THIS SITE IS INSPIRED BY — ' + SOURCE_TYPE_LABELS[ref.basis.type] + ' (' + ref.basis.url + '). This is the core requirement: the new site must be recognisably inspired by this reference\'s structure and visual character, then improved — a fresh design of its own, not an unrelated one and not a copy.'
        : 'THE REFERENCE THIS SITE IS MODELLED ON — ' + SOURCE_TYPE_LABELS[ref.basis.type] + ' (' + ref.basis.url + '). This is the core requirement: the new site must be recognisably built on this reference\'s structure and visual language, then improved — not an unrelated design.',
      JSON.stringify(ref.basis.design, null, 2),
      ref.basis.tone ? 'Its page background is ' + ref.basis.tone + '.' : '',
      '',
      inspiredByEdition
        ? 'Follow it like this: keep its section order wherever this event has real content for that section; give each section a fresh layout of your own in the spirit of its sectionPattern entry (never the same layout copied); keep the feel of its typography, its density and its use of imagery. Then improve on it: fix what is weak, drop what this event has no content for, and add what the material below supports.'
        : 'Follow it like this: keep its section order and the kind of layout each of its sections uses wherever this event has real content for that section (your sections[].layout should echo its sectionPattern entry); keep its hero construction; keep its typographic character and its density; keep its use of imagery. Then improve on it: fix what is weak, drop what this event has no content for, and add what the material below supports.'
    );
    if (ref.others.length) {
      lines.push('', 'OTHER PAGES TO LEARN FROM — take the strongest idea from each (a section this event lacks, a better layout for one it has) and work it into the structure above. Never copy their branding:');
      ref.others.forEach(function (s) { lines.push('--- ' + s.type + ' (' + s.url + ') ---', JSON.stringify(s.design, null, 2)); });
    }
  } else if (!deck) {
    var art = payload.artDirection;
    lines.push(
      'There is no previous edition or competitor page to model this site on, so its design starts from this art direction, chosen for this event — build the whole page on it, do not fall back on a generic dark-navy-and-gold conference look:',
      art.label + ': ' + art.note
    );
  }
  if (deck) {
    lines.push('',
      'THE BRIEF IS A DESIGNED PRESENTATION WITH ITS OWN VISUAL IDENTITY — this site must look like it belongs to that deck. This is binding' + (ref.basis ? ' for colour, type and imagery (the reference page above still gives the structure)' : '') + ':',
      '- colours (design.themeColor = its primary, design.accentColor = its accent or highlight, and the page background its background when it has one): ' + deck.colours.map(function (c) { return c.hex + ' ' + c.role; }).join(', '),
      deck.mode && deck.mode !== 'mixed' ? '- its pages are mostly ' + deck.mode + ': design.mode "' + deck.mode + '" unless the owner asked otherwise below.' : '- its pages mix light and dark: choose the mode that carries its primary colour best.',
      '- type: headings "' + deck.headingStyle + '", body "' + deck.bodyStyle + '" — pick the two real Google Fonts families that are closest to that.',
      '- imagery: ' + deck.imagery + ' — design.imageStyle and design.heroImage must come from this, so the pictures look like the deck\'s.',
      '- graphic motifs to carry into the layout: ' + deck.motifs + ' (a deck\'s page numbers are not a motif: the site\'s sections are never numbered).',
      deck.ipName ? '- the deck brands the property as "' + deck.ipName + '"' + (deck.ipTagline ? ' with the line "' + deck.ipTagline + '"' : '') + ': use that line (or the strongest line of the deck) for design.heroTagline when it fits.' : '',
      (payload.brief.deckSections || []).length
        ? '- its content pages are listed in the brief as deckSections. Each one carries real content the owner put in front of you: carry EVERY one of them into the site with its points — as its own section, or inside the section it belongs to (' + (payload.siteMode === 'standard' ? 'this is a standard site, so inside the matching standard section: e.g. its benefits and "why" pages go into why-join-us, its thesis into overview, its questions and pillars into key-discussion-points, its audience groups — all of them — into who-should-attend' : 'its own section where it has substance') + '). Do not drop or merge away any of their points.'
        : ''
    );
  }

  /* the owner's brief (owner-brief.js): what they said, binding */
  var ownerLines = ownerBrief.planLines(payload.brief && payload.brief.owner);
  if (ownerLines.length) { lines.push(''); lines.push.apply(lines, ownerLines); }
  if (payload.ownerNotes) {
    lines.push('', 'THE OWNER\'S OWN INSTRUCTIONS FOR THIS SITE — follow them. They override the reference and the art direction wherever they differ (never the facts: nothing may be invented to satisfy them):',
      '"' + payload.ownerNotes + '"');
  }

  lines.push(
    '',
    'Ground every section in real content-shape evidence from the material below — never include a section that has nothing real to put in it, and never omit one the material clearly supports. A thin site with 3 well-grounded sections beats a padded one with 7 that have nothing real to say.',
    '',
    payload.siteMode === 'award'
      ? 'THIS IS AN AWARD SITE, built as every ET award site is. Its sections are chosen ONLY from this list, in this order — use exactly these ids and kinds:\n' +
        awardSite.AWARD_SECTIONS.filter(function (x) { return !x.prebuilt; }).map(function (x) { return '  ' + x.id + '  (kind "' + x.kind + '") — ' + x.name + (x.purpose ? ': ' + x.purpose : ''); }).join('\n') + '\n' +
        'Include overview, why-enter, who-should-enter, contact-us and about-vertical always; past-edition-glimpses only when a previous edition is given. The band of category names, the key dates, the categories, how the awards work, the jury, the two calls to act (recognition, the awards night), the partners and the FAQs are built by the server, in ET\'s design, and placed in their ET positions — never list them. The award\'s internal pages (categories, entry guidelines, judging criteria, jury, FAQs, terms) are made separately. (nav, hero and footer are added automatically.)\n' +
        'AN ET AWARD SITE IS DRESSED FOR THE CEREMONY (ET\'s own award sites, read 28 Oct 2026): dark and premium — a near-black or deep brand-coloured ground with the brand colour and a warm metallic highlight as accents, never a pale page of text. Its hero key visual (design.heroImage) is an AWARDS key visual: a trophy or statuette on a dark stage under spotlight beams, light rays and glowing particles in the brand colour — premium, ceremonial, no people, no words, no city skyline.'
      : payload.siteMode === 'standard'
      ? 'THIS IS A STANDARD SITE. Its sections are chosen ONLY from this list — use exactly these ids and kinds, and no section that is not on it:\n' +
        STANDARD_SECTIONS.map(function (x) { return '  ' + x.id + '  (kind "' + x.kind + '") — ' + x.name; }).join('\n') + '\n' +
        'Which of them this site has: every one of these that the reference page above has, under whatever name it goes there (its "Partners" are sponsors, its "Gallery" or "Glimpses" are past-edition-glimpses, its "Why attend" is why-join-us, its "Themes" or "Tracks" are key-discussion-points…), is made again for this edition; add one the brief document or the owner\'s instructions ask for; leave out one they say this edition does not have. With no reference page, include the ones the material supports — Overview always. Order them as the reference page does; with none, in the order of the list. (nav, hero and footer are added automatically and are not in your list.)'
      : 'nav, hero and footer are always present — never include them in your sections list, those are added automatically. Everything else is yours: section ids, purposes, ordering and count.',
    '',
    ET_LOGO_COLOUR_RULE,
    NAME_RULE,
    'THE HERO IS FIXED, as on every Economic Times event site: centred, and holding only The Economic Times Business Verticals logo, the event\'s name as a wordmark, ONE line (design.heroTagline), the date and place, and two buttons. It never carries an overview, a paragraph, numbers or tracks — so the overview of the event is the FIRST section of your list, and everything a visitor needs to understand the event lives in the sections. (The server places the sponsors directly under the hero, ahead of the overview: this edition\'s sponsors section when the site has one, then the previous edition\'s sponsors; list it wherever you like — the other sections keep your order.)',
    '',
    'Set each section\'s kind to "custom" unless it is really one of 6 specific data-bound types, each backed by real records the ET ops team manages by hand, never your invention: "speakers" (real speaker bios), "sessions" (the real agenda), "faq" (real FAQs), "partners" (real sponsor/partner logos), "contact" (real contacts), "glimpses" (a real photo gallery).' + (payload.siteMode === 'standard' ? '' : ' Only use one of those when the material genuinely supports that this event will have real data of that kind.') + (payload.siteMode === 'award' ? ' On an award site, "speakers" is never used: the jury is built from records.' : ''),
    '',
    'LAYOUT: give every section its own layout (sections[].layout) and make neighbouring sections differ — a page of identical centred-heading-plus-card-grid sections is a failure. Mix: picture/text splits, full-width bands, large-number rows, timelines, quote blocks, card grids, lists, and a carousel (a sideways-scrolling row with previous/next buttons — say "carousel" in the layout) where a section has many items of one kind, such as speakers, partner logos, photos or testimonials, or where the reference uses one.',
    (NEW_ET_STANDARD
      ? 'ET\'S NEWER STANDARD (its upcoming event sites, 23 Oct 2026) — build the page this way: right under the hero a band of big numbers (by-the-numbers: 4 to 6 figures — delegates, speakers, sessions, exhibitors, networking minutes, days — from the material); a "What awaits you" band (what-awaits: 3 or 4 tall photo cards, numbered, one per format or moment of the day — the conference, boardrooms, networking, the expo floor, an awards night — each with a short caption); a closing call to act (closing-cta) on a full-width photo, with the main buttons; and every other section as the list allows. Headlines are editorial — a short statement, not the section\'s label ("Region Rewriting How It Learns.", "Four scenes, one day.") — under a small numbered eyebrow ("01  OVERVIEW"). design.headingFont is a SERIF DISPLAY face (Playfair Display, Fraunces, DM Serif Display or Cormorant Garamond) with a clean sans for the body. ONE BACKGROUND: every section sits on the page\'s own background or its soft surface tint — no deep or dark bands between light sections, no chessboard of light and dark (the owner, 10 Nov 2026: "for a smooth website single/similar background of sections are recommended"); sections differ by layout and pictures, and the closing call to act is told apart by its full-width photo, not by a dark band.'
      : 'ONE TONE: the page keeps its mode (design.mode) from the first section under the hero to the footer — a light site is light all the way down, a dark site dark all the way down. Sections differ by layout, pictures and the surface colour, never by switching between light and dark bands.'),
    '',
    'PICTURES, AS ON ET\'S OWN SITES: an ET event or award site has few pictures made for its sections — a median of one or two, a third of them none. The hero has its key visual (design.heroImage). Of the sections, ONLY these carry a picture (sections[].image), at most ' + MAX_SECTION_IMAGES + ' in all: a venue or city section (the venue or the city itself, no people); "how our awards work" on an award site (an evaluation scene: a chart on a boardroom table, entries under review); why attend / why enter (the experience of the day; the previous edition\'s real photos are used here when there are any); the themes or discussion points (ONE picture of the subject itself, no people); the overview only when none of those have one. Every other section has no picture: give it a strong typographic layout with simple line icons (inline SVG, drawn in the brand colour), large numerals, cards and brand-colour panels — never an empty-looking section. Who should attend / enter, the recognition, the benefits and reasons are icon cards, never pictures. Data-bound sections (speakers, sessions, partners, glimpses, faq, contact) show real records and get no generated picture.',
    'Each picture must be about ITS OWN section: name the concrete thing that section talks about (for a section on battery supply chains: "rows of lithium battery cell modules on a factory line"; for one on a gala dinner: "a long banquet table set with glassware under warm pendant lights") — never a generic "abstract technology background", never a metaphor made of unrelated objects (glass blocks, light trails, a server rack for a marketing event), and never the same subject twice on one page. RELEVANCE IS THE TEST: someone shown the picture alone should be able to say what kind of event this is and what it is about. No text or logos in any picture (screens and signs are blank or blurred). Where the event is tied to a place (a city, a country), let that place show.',
    'PICTURE KINDS — a page of photographs of people, section after section, is dull and reads as one picture repeated. Give each section\'s picture the KIND (sections[].imageKind) that suits what the section says:',
    '- "people": a photograph whose subject is people — ONLY for why attend / why enter (the experience of the day: a packed hall, delegates networking, an expo floor), never for any other section. The people are Indian professionals, women and men in about equal numbers, women in leading roles too; never a real or named person.',
    '- "place": the venue, the city or the setting — no people (the overview of an event tied to a city, the venue, travel and stay).',
    '- "subject": the field itself — its technology, products, machines, materials or workplace, shot as a still life or an industrial photograph, no people (themes, tracks, discussion points, the state of the industry, award categories).',
    '- "graphic": an illustration or abstract artwork drawn from the subject (the overview, why attend, how it works, the process, numbers).',
    'Mix them: at most ' + MAX_PEOPLE_PICTURES + ' sections with "people" pictures, never two "people" sections next to each other, and every kind you use should have a reason in what its section says. Where the previous edition\'s section pictures are listed below, follow its choice of kind for a section that does the same job.',

    '',
    'Event (already known):', JSON.stringify(payload.eventMeta || {}, null, 2)
  );
  /* only for a site that has a previous edition to be inspired by (handlePlanStructure): the venue the
     design shows (edition-look.js venueForDesign) — this edition's, else the previous edition's */
  var place = payload.place;
  if (place && place.venue) {
    var named = place.city || 'the city of that venue';
    lines.push('',
      'THE PLACE: ' + (place.source === 'previous' ? 'this edition has not named its venue yet; the previous edition was held at "' + place.venue + '"' : 'this edition takes place at "' + place.venue + '"') +
        '. The site must carry that city in creative terms, not only in the hero\'s address line. Name the city in design.placeCity, write in design.placeCues the cues of it a local would recognise at once, and in design.placeMotif one graphic motif drawn from its own crafts or architecture. In the pictures: set each scene in ' + named + ' wherever the scene allows, through those cues — in the view, the décor, the attire and the light — tastefully, never as a postcard or a caricature. ' +
        'In the words, where it is natural: the overview can say what the city and its region bring to this event, a reason to attend can be the region\'s own market. ' +
        'These are directions for you: never write them, or any instruction, on the site itself.');
  }
  /* the lists the event already has on record: their sections are on the page (an agenda that exists is shown) */
  var REC = { sessions: 'this edition\'s agenda (kind "sessions", id "agenda")', speakers: 'this edition\'s speakers (kind "speakers", id "speakers")', faqs: 'FAQs (kind "faq", id "faqs")' };
  var held = (payload.onRecord || []).filter(function (k) { return REC[k]; });
  if (held.length) lines.push('', 'ALREADY ON RECORD for this edition (the ET team entered them): ' + held.map(function (k) { return REC[k]; }).join('; ') + '. Each of these MUST have its section on the page, placed where ET\'s sites put it (the agenda after the discussion topics).');
  if (payload.brief) lines.push('', 'Extracted brief:', JSON.stringify(payload.brief, null, 2));
  if (payload.sources && payload.sources.length) {
    lines.push('', 'What the collected pages SAY (content, summarised):');
    payload.sources.forEach(function (s) { lines.push('--- ' + s.type + ' (' + s.url + ') ---', JSON.stringify(s.extractedSections, null, 2)); });
    /* what kind of picture the previous edition put in each section (ingest-source, section-pictures.js) */
    var kinds = [];
    payload.sources.forEach(function (s) { (s.sectionPictures || []).forEach(function (p) { kinds.push('- "' + p.heading + '": ' + p.kind + ' — ' + p.about); }); });
    if (kinds.length) {
      lines.push('', 'THE PICTURES THE PREVIOUS EDITION PUT IN ITS SECTIONS (section heading: kind — what it showed). For a section of yours that does the same job, choose the same KIND of picture (sections[].imageKind) — a new picture, never theirs:');
      lines.push.apply(lines, kinds.slice(0, 12));
    }
  }

  var ti = payload.themeInfo || {};
  lines.push('', 'COLOUR AND TYPE:');
  if (mode === 'light' || mode === 'dark') {
    lines.push('The owner asked for a ' + mode.toUpperCase() + ' site: design.mode must be "' + mode + '", with a ' + (mode === 'dark' ? 'dark background and light text' : 'light background and dark text') + '. This is not negotiable.');
  } else if (ref.basis && ref.basis.tone) {
    lines.push('The owner left light or dark to you: the reference page is ' + ref.basis.tone + ', so stay ' + ref.basis.tone + ' unless that plainly does not suit this event.');
  } else {
    lines.push('The owner left light or dark to you: choose what suits this event. Do not default to dark.');
  }
  if (deck && ti.usedFallback && ti.usedFallback.noPreviousEditionSource) {
    lines.push('The colours and type come from the presentation above — not from an art direction.');
  } else if (ti.usedFallback && ti.usedFallback.noPreviousEditionSource) {
    lines.push('No previous edition was given, so there is no brand colour or font to carry over. Choose a considered palette and font pairing that fit THIS event\'s subject and the direction above — a different event must get a visibly different palette.');
  } else {
    lines.push('Found on this event\'s own previous edition — this is the event\'s existing brand character: let the new design be inspired by it (its colour family, tone and type feel), with colours and fonts of its own (say in evidence how you derived them):',
      'brand colour: ' + (ti.usedFallback && ti.usedFallback.color ? '(none found)' : ti.themeColor),
      'heading font: ' + (ti.usedFallback && ti.usedFallback.font ? '(none found)' : ti.headingFont),
      'body font: ' + (ti.usedFallback && ti.usedFallback.font ? '(none found)' : ti.bodyFont));
    lines.push.apply(lines, editionLookLines(ti.look, ti.keyVisual));
  }
  lines.push('Text must be easy to read: textColor against backgroundColor at a contrast of 7:1 or more, mutedColor at 4.5:1 or more.');

  lines.push('',
    'Task — produce:',
    '- evidence: a note for the team, never shown on the site. Name the evidence behind each section and each design choice' + (ref.basis ? ', and say what you kept from the reference and what you changed.' : '.'),
    '- design: mood, mode, the six colours, the two fonts (real Google Fonts family names), layout, imageStyle, heroImage.',
    '- sections: the middle sections, each with id, kind, purpose, layout and image.',
    '- eventDescription: the event\'s own short description (its listing, its search result, its promotions). ' + eventDescription.RULE
  );
  return lines.filter(function (l) { return l != null; }).join('\n');
}

var RESERVED_DESIGN_SECTION_IDS = ['nav', 'hero', 'footer'];
function sanitizeDesignPlanSections(parsed, siteMode) {
  var seen = {};
  var out = [];
  var pictures = 0;
  var list = Array.isArray(parsed.sections) ? parsed.sections.slice() : [];
  /* an award site: ET's own sections, in ET's order; the ones built from records are never the model's */
  if (siteMode === 'award') return awardPlanSections(list);
  /* a standard site always opens with its overview */
  if (siteMode === 'standard' && !list.some(function (s) { return s && standardSectionFor(s.id) && standardSectionFor(s.id).id === 'overview'; })) {
    list.unshift({ id: 'overview', kind: 'custom', purpose: 'What this event is, who it is for and why it matters this year.', layout: 'picture and text side by side', image: '' });
  }
  list.forEach(function (s) {
    if (!s) return;
    var id = slugifyId(s.id), std = null;
    if (siteMode === 'standard') {
      std = standardSectionFor(s.id);
      if (!std) return;                                   // not one of the twelve: a standard site does not have it
      id = std.id;
    }
    if (!id || RESERVED_DESIGN_SECTION_IDS.indexOf(id) !== -1 || seen[id]) return;
    seen[id] = true;
    var kind = std ? std.kind : (DESIGN_SECTION_KINDS.indexOf(s.kind) !== -1 ? s.kind : 'custom');
    var image = kind === 'custom' ? String(s.image || '').trim().slice(0, 300) : '';
    if (image && ++pictures > MAX_SECTION_IMAGES) image = '';
    var imageKind = genDesign.IMAGE_KINDS.indexOf(s.imageKind) !== -1 ? s.imageKind : (image ? 'subject' : '');
    out.push({ id: id, name: std ? std.name : '', kind: kind, purpose: String(s.purpose || '').trim().slice(0, 500), layout: String(s.layout || '').trim().slice(0, 300), image: image, imageKind: image ? imageKind : '' });
  });
  return fewerPeoplePictures(out);
}
/* The award a site is built for: the previous edition's records as ET's award API gave them at ingest
   (sources[].award, et-awards.js), under THIS edition's name and dates — the nomination window the owner set
   (events/<id>.nomination) and the event's own date for the awards night, never the previous edition's.
   Its jury and partners were the previous edition's, and say so ("Grand Jury 2026"). Its categories keep
   their nomination fees as ET has them (the owner, 23 Oct 2026: "show the fee, will add payment setup
   later" — the nomination form takes no payment yet).
   With no award on record: the owner's dates alone (the categories come with the internal pages' words).
   -> AWARD (award-sections.js shape) */
function awardForSite(sourceDocs, stored) {
  stored = stored || {};
  var rec = (sourceDocs || []).filter(function (d) { return d && d.type === 'previousEdition' && d.award; }).map(function (d) { return d.award; })[0] || null;
  var nom = stored.nomination || {};
  function when(v, tbd) { return tbd ? '' : String(v || '').replace('T', ' ').slice(0, 19); }
  var prevYear = rec ? (String((rec.dates || {}).ceremony || '').slice(0, 4) || ((/(19|20)\d{2}/.exec(rec.name || '') || [''])[0])) : '';
  function labelled(groups) {
    return (groups || []).map(function (g) { return Object.assign({}, g, { group: g.group + (prevYear ? ' ' + prevYear : '') }); });
  }
  return {
    name: String(stored.name || (rec && rec.name) || ''),
    edition: '',
    dates: { nominationOpen: when(nom.open, nom.openTbd), nominationClose: when(nom.close, nom.closeTbd), ceremony: when(stored.start) },
    categories: rec ? rec.categories || [] : [],
    jury: rec ? labelled(rec.jury) : [],
    partners: rec ? labelled(rec.partners) : [],
    fromRecords: !!rec
  };
}

/* The model's sections of an award site, as ET's: each mapped onto its AWARD_SECTIONS entry (award-site.js),
   those built from records dropped (the server adds them where it has records), unknown ones dropped, the
   overview always first, and the list put in ET's order. */
function awardPlanSections(list) {
  var seen = {}, out = [], pictures = 0;
  (list || []).forEach(function (s) {
    if (!s) return;
    var std = awardSite.awardSectionFor(s.id) || awardSite.awardSectionFor(s.name || '');
    if (!std || std.prebuilt || seen[std.id]) return;
    seen[std.id] = true;
    var image = std.kind === 'custom' ? String(s.image || '').trim().slice(0, 300) : '';
    if (image && ++pictures > MAX_SECTION_IMAGES) image = '';
    var imageKind = genDesign.IMAGE_KINDS.indexOf(s.imageKind) !== -1 ? s.imageKind : (image ? 'subject' : '');
    out.push({ id: std.id, name: std.name, kind: std.kind, purpose: String(s.purpose || std.purpose || '').trim().slice(0, 500), layout: String(s.layout || '').trim().slice(0, 300), image: image, imageKind: image ? imageKind : '' });
  });
  if (!seen.overview) out.unshift({ id: 'overview', name: 'Overview', kind: 'custom', purpose: awardSite.AWARD_SECTIONS[0].purpose, layout: 'picture and text side by side', image: '', imageKind: '' });
  var order = awardSite.AWARD_SECTIONS.map(function (x) { return x.id; });
  out.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
  return fewerPeoplePictures(out);
}
/* The award's sections built from records (award-sections.js), as planned entries in their ET places:
   key dates after the overview, the categories after why-enter, the jury after how-it-works, the partners
   after who-should-enter — each only when its records exist. award: et-awards.js AWARD, or what the brief
   gave (categories proposed by the model, the owner's dates). */
function withAwardRecords(sections, award, o) {
  if (!award) return sections;
  /* the jury is the event's Speakers records: its section stands for a jury on record, or records of the event's own */
  var built = awardSections.homeSections(award, { edition: award.name || '', bound: true, hasJury: !!(o && o.speakers) });
  /* with no categories on record (an award from a brief) they are proposed with the internal pages' words
     (writeAwardPages, generate-content): their place is kept, and left empty if none come */
  if (!built.some(function (b) { return b.id === 'award-categories'; })) {
    built.push({ id: 'award-categories', name: 'Award Categories', prebuilt: 'award-categories', purpose: 'Award Categories — the master categories. Built by the server.', layout: 'a grid of cards, one per master category' });
  }
  var have = {}; built.forEach(function (b) { have[b.id] = b; });
  var order = awardSite.AWARD_SECTIONS.map(function (x) { return x.id; });
  var out = sections.slice();
  built.forEach(function (b) {
    var entry = { id: b.id, name: b.name, kind: b.id === 'award-partners' ? 'partners' : 'custom', prebuilt: b.prebuilt, purpose: b.purpose || b.name, layout: b.layout || '', image: '', imageKind: '' };
    var mine = order.indexOf(b.id), at = out.length;
    for (var i = 0; i < out.length; i++) { var o = order.indexOf(out[i].id); if (o > mine) { at = i; break; } }
    out.splice(at, 0, entry);
  });
  return out;
}

/* The previous edition's photos, each read for what it shows (one small reading for up to 12): { url, kind, wide }
   kind: hall (a full room or audience) | stage (a speaker or ceremony on stage, room in view) | panel (a panel or
   fireside on stage) | award (an award being given) | expo (booths, a show floor) | networking (delegates talking)
   | portrait (one face, close up) | other (a slide, a logo, text). wide: a landscape shot with room for words over
   it. -> Promise<[…] | null> (null: they could not be read; the addresses are then used in their order) */
var GLIMPSE_SCHEMA = { type: 'OBJECT', properties: { photos: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  n: { type: 'INTEGER' }, kind: { type: 'STRING', enum: ['hall', 'stage', 'panel', 'award', 'expo', 'networking', 'portrait', 'performance', 'other'] }, wide: { type: 'BOOLEAN' }, textHeavy: { type: 'BOOLEAN' } }, required: ['n', 'kind', 'wide', 'textHeavy'] } } }, required: ['photos'] };
function classifyGlimpses(fb, eventId, urls, deadlineAt) {
  var list = (urls || []).filter(function (u) { return /^https:\/\//i.test(String(u || '')); }).slice(0, 12);
  if (!list.length) return Promise.resolve(null);
  return Promise.all(list.map(function (u) {
    return safeFetch(u, { timeoutMs: 8000, maxBytes: SECTION_PICTURE_MAX_BYTES }).then(function (r) {
      var info = r.status === 200 ? logoUnit.imageInfo(r.body) : null;
      return info && ['png', 'jpeg', 'webp'].indexOf(info.type) !== -1 ? { url: u, image: { mimeType: info.mime, data: r.body.toString('base64') }, w: info.width, h: info.height } : null;
    }, function () { return null; });
  })).then(function (got) {
    got = got.filter(Boolean);
    if (!got.length) return null;
    var batches = [];
    for (var i = 0; i < got.length; i += 6) batches.push(got.slice(i, i + 6));
    return Promise.all(batches.map(function (b) {
      var prompt = 'These are photos from an earlier edition of a business conference. For each numbered photo say what it shows (kind: "performance" for entertainment — a singer, comedian, celebrity act, dance or cultural show; "portrait" for a close-up of one or two people), whether it is a wide landscape shot that could sit behind a heading (wide), and whether large words — a name on a screen, a slide, a backdrop title — fill a big part of it (textHeavy).\n' + b.map(function (p, k) { return (k + 1) + '. ' + p.w + 'x' + p.h + 'px'; }).join('\n');
      /* a reading that fails is asked once more while there is time; a photo still unread is marked unknown and
         never placed (23 Oct 2026: one timed-out batch let a close-up and a screen of names onto a page) */
      function ask(tries) {
        return callGeminiJson(prompt, GLIMPSE_SCHEMA, { route: 'plan-structure', eventId: eventId, images: b.map(function (p) { return p.image; }), maxOutputTokens: AI_OUTPUT_TOKENS.small, timeoutMs: 60000, deadlineAt: deadlineAt })
          .then(function (r) {
            var record = aiUsageRecorder(fb, eventId, 'plan-structure'); if (record) record(r.usage);
            if (r.error && tries < 2 && !(deadlineAt && deadlineAt - Date.now() < 70000)) { console.warn('pictures: the reading of ' + eventId + '\'s photos failed (' + (r.code || r.error) + '); asked once more'); return ask(tries + 1); }
            return r;
          });
      }
      return ask(1)
        .then(function (r) {
          return r.error ? b.map(function (p) { return { url: p.url, kind: 'unknown', wide: false }; }) : b.map(function (p, k) {
            var x = (r.parsed.photos || []).filter(function (y) { return y.n === k + 1; })[0] || {};
            return { url: p.url, kind: x.kind || 'unknown', wide: x.wide === true && p.w >= p.h * 1.2, textHeavy: x.textHeavy === true };
          });
        });
    })).then(function (parts) { return [].concat.apply([], parts); });
  }).then(null, function () { return null; });
}

/* A section's picture taken away: its layout is told so too, or the section is written around a picture box
   that stays empty (Healthcare Leaders 2027's "Why join us": half the band a blank 560px box) */
function dropPicture(s) {
  s.image = ''; s.imageKind = '';
  if (s.imageUrl) return;
  var layout = String(s.layout || '');
  if (/\b(picture|photo|image|visual|illustration)s?\b/i.test(layout) && !/NO PICTURE/.test(layout)) {
    s.layout = layout.replace(/[.\s]*$/, '') + '. NO PICTURE in this section after all: lay it out without one — no picture box, no empty column; the words take the full width or a layout of their own.';
  }
}

/* ET's newer sites put the previous edition's real photos — people, stage, hall — in the banner (under a tint), beside
   the overview, on the "What awaits you" cards, as one tile among the audience cards and behind the closing call to
   act. Those places get the previous edition's photos (glimpses) when it has any: s.photos (the cards) or s.imageUrl,
   and design.heroImageUrl. Without them, a generated picture stands in where one is needed (the overview's subject,
   the cards' moments of the day); nothing else gets one. -> the sections, changed in place */
var REAL_PHOTO_PLACES = { overview: 1, 'what-awaits': 4, 'who-should-attend': 1, 'closing-cta': 1 };
function newStandardPictures(sections, glimpses, design) {
  /* glimpses: addresses, or classifyGlimpses' { url, kind, wide } — then each place takes the kind it wants */
  var all = (glimpses || []).map(function (g) { return typeof g === 'string' ? { url: g, kind: '', wide: true } : g; })
    /* never a close-up, an entertainment act, or a photo filled with a screen's words: they say nothing about the
       business audience, and the words come out cropped (23 Oct 2026, Healthcare and Retail test sites) */
    .filter(function (g) { return g && /^https:\/\//i.test(String(g.url || '')) && ['portrait', 'performance', 'other', 'unknown'].indexOf(g.kind) === -1 && !g.textHeavy; });
  var used = {};
  function pick(kinds, wide) {
    for (var i = 0; i < kinds.length; i++) {
      var hit = all.filter(function (g) { return !used[g.url] && (!kinds[i] || g.kind === kinds[i]) && (!wide || g.wide); })[0];
      if (hit) { used[hit.url] = 1; return hit.url; }
    }
    return '';
  }
  var WANT = {
    hero: [['hall', true], ['stage', true], ['panel', true], ['', true]],
    overview: [['stage', true], ['panel', true], ['hall', true], ['', true]],
    'what-awaits': [['panel'], ['award'], ['expo'], ['networking'], ['stage'], ['hall'], ['']],
    'who-should-attend': [['networking'], ['expo'], ['hall'], ['']],
    'closing-cta': [['hall', true], ['panel', true], ['stage', true], ['', true], ['']]
  };
  function take(id, n) {
    var out = [], want = WANT[id] || [['']];
    if (id === 'what-awaits') { want.forEach(function (w) { if (out.length < n) { var u = pick([w[0]], w[1]); if (u) out.push(u); } }); return out; }
    for (var k = 0; k < n; k++) { var u = ''; for (var j = 0; j < want.length && !u; j++) u = pick([want[j][0]], want[j][1]); if (u) out.push(u); }
    return out;
  }
  var real = all, given = {};
  /* the banner is a city / industry key visual, generated (ET's upcoming sites: 81% of event banners, glimpses
     or not — 23 Oct 2026); the real photos go to the sections below */
  /* the places that matter most choose first: the closing band, the overview, the cards, the audience tile */
  ['closing-cta', 'overview', 'what-awaits', 'who-should-attend'].forEach(function (id) {
    if (real.length && sections.some(function (s) { return s.id === id; })) given[id] = take(id, REAL_PHOTO_PLACES[id]);
  });
  sections.forEach(function (s) {
    var n = REAL_PHOTO_PLACES[s.id];
    if (n && real.length) {
      var got = given[s.id] || [];
      if (!got.length) { dropPicture(s); return; }
      s.image = ''; s.imageKind = 'photo'; s.imageSource = 'previous-edition'; s.imageUrl = got[0];
      if (n > 1) s.photos = got;
      return;
    }
    /* no real photo: a generated one only for the overview (the subject) and the cards (the moments of the day) */
    if (s.image && (s.id === 'overview' || s.id === 'what-awaits')) { s.imageKind = s.id === 'overview' ? 'subject' : 'people'; return; }
    dropPicture(s);
  });
  return sections;
}

/* A section keeps a picture only where ET's own sites put one (PICTURE_SECTIONS: venue, how the awards work,
   why attend, the themes, the overview only when none of those has one), in that order of preference, at most
   MAX_SECTION_IMAGES; its kind is the one ET uses there. Why attend shows the previous edition's REAL photo
   when it has any (glimpses), made by nobody. -> the sections, changed in place */
function etPictureRules(sections, glimpses) {
  var real = (glimpses || []).filter(function (u) { return /^https:\/\//i.test(String(u || '')); });
  function ruleOf(s) {
    var key = slugifyId(s.id + ' ' + (s.name || ''));
    for (var i = 0; i < PICTURE_SECTIONS.length; i++) if (PICTURE_SECTIONS[i].re.test(key)) return i;
    return -1;
  }
  var wanted = sections.filter(function (s) { return s.image && ruleOf(s) !== -1; });
  var others = wanted.filter(function (s) { return PICTURE_SECTIONS[ruleOf(s)].re.source.indexOf('overview') === -1; });
  if (others.length) wanted = others;
  wanted.sort(function (a, b) { return ruleOf(a) - ruleOf(b); });
  var keep = {};
  wanted.slice(0, MAX_SECTION_IMAGES).forEach(function (s) { keep[s.id] = 1; });
  var usedReal = 0;
  sections.forEach(function (s) {
    if (!s.image) return;
    if (!keep[s.id]) { dropPicture(s); return; }
    var rule = PICTURE_SECTIONS[ruleOf(s)];
    if (rule.real && real[usedReal]) {
      s.imageUrl = real[usedReal++]; s.imageSource = 'previous-edition'; s.image = ''; s.imageKind = 'photo';
      return;
    }
    s.imageKind = rule.kind === 'subject' && s.imageKind === 'graphic' ? 'graphic' : rule.kind;
  });
  return sections;
}

/* At most MAX_PEOPLE_PICTURES sections with a picture of people, never two next to each other; sections that
   are about people keep theirs first. Another becomes a picture of its subject, its scene said again from
   what the section is for (the scene written for people would bring them back). */
function fewerPeoplePictures(sections) {
  var people = sections.filter(function (s) { return s.imageKind === 'people'; });
  var keep = people.filter(function (s) { return PEOPLE_SECTION.test(s.id + ' ' + s.name + ' ' + s.purpose); })
    .concat(people.filter(function (s) { return !PEOPLE_SECTION.test(s.id + ' ' + s.name + ' ' + s.purpose); }));
  var kept = {}, n = 0;
  keep.forEach(function (s) {
    var i = sections.indexOf(s);
    var beside = (sections[i - 1] && kept[sections[i - 1].id]) || (sections[i + 1] && kept[sections[i + 1].id]);
    if (n < MAX_PEOPLE_PICTURES && !beside) { kept[s.id] = 1; n++; }
  });
  sections.forEach(function (s) {
    if (s.imageKind !== 'people' || kept[s.id]) return;
    s.imageKind = 'subject';
    s.image = 'what this section is about, shown through its own objects, tools and setting, with no people: ' + s.purpose.slice(0, 220);
  });
  return sections;
}
function sanitizeDesignPlanDesign(parsed, themeMode, eventName) {
  var d = (parsed && parsed.design) || {};
  var colours = genDesign.palette(d, themeMode);
  return {
    mood: String(d.mood || '').trim().slice(0, 600),
    mode: colours.mode,
    themeColor: clampHexColor(d.themeColor, THEME_FALLBACK.themeColor),
    accentColor: clampHexColor(d.accentColor, DESIGN_FALLBACK_ACCENT),
    backgroundColor: colours.backgroundColor, surfaceColor: colours.surfaceColor,
    textColor: colours.textColor, mutedColor: colours.mutedColor,
    headingFont: clampFontName(d.headingFont, THEME_FALLBACK.headingFont),
    bodyFont: clampFontName(d.bodyFont, THEME_FALLBACK.bodyFont),
    layout: String(d.layout || '').trim().slice(0, 700),
    cornerRadius: ['0', '6', '12', '20'].indexOf(String(d.cornerRadius)) !== -1 ? String(d.cornerRadius) : '12',
    imageStyle: String(d.imageStyle || '').trim().slice(0, 300),
    logoUnit: genDesign.logoUnitParts(eventName, d.logoUnit),
    logoUnitStyle: /^(stacked|inline|boxed|underline)$/.test(String((d.logoUnit || {}).style)) ? d.logoUnit.style : 'stacked',
    heroTagline: String(d.heroTagline || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 14).join(' ').slice(0, 120),
    heroImage: String(d.heroImage || '').trim().slice(0, 300)
  };
}
var LOGO_UNIT_TRIES = 3;

var etLogoText = {};
/* the official file for that tone, as text ('' if it cannot be read: the unit is then drawn without it,
   and the hero falls back to the unit set in type, which shows the logo as a file) */
function etLogoSvg(tone) {
  if (etLogoText[tone] == null) {
    try { etLogoText[tone] = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', '_shared', 'img', 'et-business-verticals-on-' + tone + '.svg'), 'utf8'); }
    catch (e) { etLogoText[tone] = ''; }
  }
  return etLogoText[tone];
}

/* the picture a candidate names: { bytes, info, stacked } — or { refused: why } when it cannot be had or is
   not a logo unit (why: a few words for the owner's note, never dropped: see previousEditionUnit) */
function fetchLogoCandidate(cand) {
  if (cand.kind === 'inline-svg') {
    var text = String(cand.svg || '');
    if (!standsAlone(text)) return Promise.resolve({ refused: 'it is drawn into the page and cannot be shown on its own' });
    if (!/\sxmlns=/.test(text.slice(0, 600))) text = text.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    var inline = Buffer.from(text, 'utf8');
    return Promise.resolve(usableLogoPicture(inline));
  }
  if (!/^https?:\/\//i.test(String(cand.url || ''))) return Promise.resolve({ refused: 'its address could not be read' });
  /* the type is judged from the bytes: ET's own image host serves PNGs named .jpg as image/jpeg */
  return safeFetch(cand.url, { timeoutMs: 8000, maxBytes: LOGO_UNIT_MAX_BYTES }).then(function (r) {
    return r.status === 200 ? usableLogoPicture(r.body) : { refused: 'its picture could not be downloaded (the site answered ' + r.status + ')' };
  }, function (err) { return { refused: 'its picture could not be downloaded (' + String((err && err.message) || 'no answer').slice(0, 80) + ')' }; });
}
/* An <svg> cut out of a page is only a picture by itself when it does not lean on that page: on a symbol
   defined elsewhere (<use href="#…">), on the page's text colour (currentColor), on the page's style sheet
   (classes with no <style> of its own) or on the page's fonts (<text>). Otherwise it would be stored blank
   or black — the next candidate, or a unit drawn new, is better. */
function standsAlone(svg) {
  if (/currentColor/i.test(svg) || /<text[\s>]/i.test(svg)) return false;
  if (/\sclass\s*=/.test(svg) && !/<style[\s>]/i.test(svg)) return false;
  var refs = svg.match(/(?:href\s*=\s*["']#|url\(\s*["']?#)([\w:.-]+)/g) || [];
  return refs.every(function (ref) {
    var id = ref.replace(/^.*#/, '');
    return new RegExp('\\sid\\s*=\\s*["\']' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']').test(svg);
  });
}
/* -> { bytes, info, stacked } | { refused: why }. A lock-up stacked with its sponsors (taller than wide,
   logo-unit.js stackedUnit) is taken, marked stacked: it is used only once they are cropped out of it. */
function usableLogoPicture(bytes) {
  var info = logoUnit.imageInfo(bytes), stacked = logoUnit.stackedUnit(info), why = logoUnit.plausibleUnit(info);
  if (why && !stacked) return { refused: 'the picture found on its page ' + (/^its /.test(why) ? 'has a size that cannot be read' : 'is ' + why) };
  if (info.type === 'svg') {
    var text = bytes.toString('utf8');
    if (svgCouldRun(text)) return { refused: 'its SVG contains scripts or embedded content' };
    var sized = sizedSvg(text, info);
    if (sized !== text) bytes = Buffer.from(sized, 'utf8');
  }
  return { bytes: bytes, info: info, stacked: stacked };
}

/* The sources that name a previous (or this) edition's logo unit: the newest reading of the previous
   edition first, then of this edition's own current site. */
function unitSources(sourceDocs) {
  var docs = (sourceDocs || []).filter(function (s) { return s && (s.type === 'previousEdition' || s.type === 'currentEdition') && Array.isArray(s.logoCandidates) && s.logoCandidates.length; });
  docs.sort(function (a, b) { return (a.type === b.type ? 0 : a.type === 'previousEdition' ? -1 : 1) || String(b.fetchedAt || '').localeCompare(String(a.fetchedAt || '')); });
  return docs;
}
/* What the owner is told when the previous edition's unit had to be passed over — never nothing. ETCIO
   Annual Conclave 2027 got its name drawn in place of the 2026 lock-up without a word, because that
   lock-up was taller than wide (its sponsors stacked under it) and was refused before it was looked at. */
function previousUnitNote(why) {
  return 'The previous edition\'s logo could not be used: ' + String(why || 'it could not be examined').replace(/[.\s]+$/, '') +
    '. Upload this year\'s logo under Event logo in the event\'s Basics, or select this and use Replace image.';
}

/* The previous (or this) edition's own unit, examined.
   -> unit | { stuck: true, note } | { failed: true, note } | null (no edition's page named a logo)
   failed: a logo was named and could not be used; why is said in the note. */
function previousEditionUnit(fb, eventId, o) {
  var source = unitSources(o.sourceDocs)[0];
  if (!source) return Promise.resolve(null);
  var candidates = source.logoCandidates.slice(0, LOGO_UNIT_TRIES), refusals = [];
  var years = logoUnit.editionYears({ eventName: o.eventMeta.name, start: o.eventMeta.start, briefTexts: o.briefTexts, hints: source.editionHints || {}, pageUrl: source.url });
  /* A lock-up examined once for this edition's year is not examined again: reading it can take a minute or
     more when Gemini is slow, and a site made again would otherwise risk the event's name in its place. Kept on
     the previous edition's record; only a unit used after a finished examination is kept — never one read short,
     and never a year that could not be moved (where a reading places the year varies: the next may move it). */
  var cacheKey = candidates.map(function (c) { return c.url || (c.svg ? 'inline:' + crypto.createHash('sha1').update(String(c.svg)).digest('hex') : ''); }).join(',') + '|' + years.to + '|' + String(o.eventMeta.name || '');
  var cached = source.examinedUnit && source.examinedUnit.key === cacheKey ? source.examinedUnit.unit : null;
  if (cached && cached.url) return Promise.resolve(cached);
  var finished = false;
  function remember(unit) {
    if (!finished || !unit || !unit.url || !(fb && fb.db && typeof fb.db.collection === 'function')) return unit;
    /* keeping it is a convenience: whatever goes wrong here, the unit made is used */
    return Promise.resolve().then(function () {
      return fb.db.collection('events').doc(eventId).collection('sources').where('type', '==', source.type).where('url', '==', source.url).limit(1).get();
    }).then(function (snap) { if (snap && !snap.empty) return snap.docs[0].ref.update({ examinedUnit: { key: cacheKey, unit: unit, at: new Date().toISOString() } }); })
      .then(function () { return unit; }, function (err) { console.error('logo unit: the examined unit of ' + eventId + ' was not kept — ' + (err && err.message)); return unit; });
  }
  function failed(why) {
    console.error('logo unit: the previous edition\'s logo of ' + eventId + ' was not used (' + why + ') — ' + source.url);
    return { failed: true, note: previousUnitNote(why) };
  }
  function pick(i) {
    if (i >= candidates.length) return Promise.resolve(null);
    return fetchLogoCandidate(candidates[i]).then(function (picture) {
      if (picture && !picture.refused) return picture;
      refusals.push((picture && picture.refused) || 'its picture could not be had');
      return pick(i + 1);
    });
  }
  return pick(0).then(function (picture) {
    /* the reason the best candidate (the first) was refused is the one that matters */
    if (!picture) return failed(refusals[0] || 'no picture was found on its page');
    return examineUnit(fb, eventId, picture, { years: years, origin: 'previous-edition', eventName: o.eventMeta.name, deadlineAt: o.deadlineAt }).then(function (ex) {
      finished = !ex.unread;
      /* never used showing an earlier edition's year: the event's name stands in its place, and the owner
         is told why */
      if (ex.stuck) {
        return { stuck: true, note: 'The previous edition\'s logo shows ' + ex.stuck + ' and could not be updated to ' + logoUnit.yearAs(ex.stuck, years.to) +
          ', so the event\'s name is shown here instead. Upload this year\'s logo under Event logo in the event\'s Basics, or select this and use Replace image.' };
      }
      /* A lock-up stacked with its sponsors is used only cut down to the event's own, never with them. A tall
         one read whole in which nothing was a sponsor's is the event's own lock-up and is used as it is:
         Digiplus Awards 2026's is ETBrandEquity's masthead over "DG+ '26" — the publisher's mark is part of
         the lock-up, and refusing it for being tall put the event's name in its place (28 Oct 2026). */
      var tallOwn = false;
      if (picture.stacked && logoUnit.plausibleUnit(ex.picture.info)) {
        if (ex.unread) return failed('it is stacked with its sponsors\' marks, and it could not be read in time to crop them out, so the event\'s name is shown here instead');
        if (ex.extrasLeft) return failed('it is stacked with its sponsors\' marks, and they could not be cropped out cleanly, so the event\'s name is shown here instead');
        tallOwn = true;
      }
      var notes = ex.notes.slice();
      if (tallOwn) notes.push('The previous edition\'s logo is taller than it is wide; nothing in it was read as a sponsor\'s mark, so it is used whole. If it does carry one, upload this year\'s logo under Event logo in the event\'s Basics, or select it and use Replace image.');
      /* used unread: its year and any sponsor's mark in it went unchecked, and the owner is told */
      if (ex.unread) {
        notes.push('The previous edition\'s logo could not be read to check ' + (years.from ? 'its year and ' : '') + 'whether a sponsor\'s mark is drawn into it. If it ' +
          (years.from ? 'still shows ' + years.from + ' or a sponsor' : 'shows a sponsor') + ', upload this year\'s logo under Event logo in the event\'s Basics, or select it and use Replace image.');
      }
      return storeLogoUnit(fb, eventId, o.stamp, ex.picture).then(function (stored) {
        return {
          url: stored.url, storagePath: stored.storagePath, source: 'previous-edition', from: source.url,
          width: ex.picture.info.width || 0, height: ex.picture.info.height || 0,
          /* What the lock-up was drawn for. The hero takes that tone (a dark banner over a light site is how
             ET's own sites carry a white lock-up), so the unit is never redrawn and never needs a plate. */
          heroMode: heroModeOf(ex.tone), plate: '', note: notes.join(' ')
        };
      });
    });
  }).then(remember);
}

function drawnLogoUnit(fb, eventId, o) {
  var design = o.design, tone = design.mode === 'dark' ? 'dark' : 'light';
  var parts = design.logoUnit || genDesign.logoUnitParts(o.eventMeta.name);
  var name = [parts.before, parts.keyword, parts.after].filter(Boolean).join(' ');
  if (!name) return Promise.resolve(null);
  var logo = etLogoSvg(tone);
  if (!logo) return Promise.resolve(null);
  return fetchUnitFont(design.headingFont, 700, name).then(function (font) {
    var drawn = function (t, etLogo) { return logoUnit.buildLogoUnitSvg({ parts: parts, style: design.logoUnitStyle, tone: t, themeColor: design.themeColor, font: font || { family: design.headingFont }, etLogoSvg: etLogo }); };
    var made = drawn(tone, logo);
    if (!made.svg || svgCouldRun(made.svg)) return null;
    var storagePath = 'events/' + eventId + '/generated/' + o.stamp + '-logo-unit.svg';
    /* a light site's unit gets its copy for a dark ground drawn the same way — white lettering, the ET logo made for
       a dark ground — never made from the picture, whose lettering is text a drawing here cannot show */
    var onDark = tone === 'light' && etLogoSvg('dark') ? drawn('dark', etLogoSvg('dark')) : null;
    var darkPath = 'events/' + eventId + '/generated/' + o.stamp + '-logo-unit-on-dark.svg';
    return Promise.all([
      storePublicPicture(fb, storagePath, Buffer.from(made.svg, 'utf8'), 'image/svg+xml'),
      onDark && onDark.svg && !svgCouldRun(onDark.svg) ? storePublicPicture(fb, darkPath, Buffer.from(onDark.svg, 'utf8'), 'image/svg+xml').then(null, function () { return ''; }) : ''
    ]).then(function (urls) {
      var unit = { url: urls[0], storagePath: storagePath, source: 'generated', from: '', width: made.width, height: made.height, heroMode: '', plate: '', note: '' };
      if (urls[1]) { unit.darkUrl = urls[1]; unit.darkStoragePath = darkPath; }
      return unit;
    });
  });
}

/* The hero's logo unit, in this order:
     1. the logo the owner uploaded, examined (ownerLogoUnit) — owner-supplied content wins;
     2. else the previous (or this) edition's own unit, its year moved on, its sponsors cropped out
        (previousEditionUnit);
     3. else, or when that unit could not be used, the event's name drawn as a unit — the last resort, and
        whenever a previous edition's logo was named, with the owner told why it is not that one; the hero
        sets the name in type when even that cannot be made.
   foundLogoUnit() is steps 1 and 2: they need nothing of the design, so plan-structure starts them while the
   plan is being written (o.found), and the readings have the time they need.
   o: { eventMeta, ownerLogoUrl, briefTexts, design, sourceDocs, stamp, deadlineAt, found }. Never rejects. */
var NO_UNIT = { url: '', storagePath: '', source: '', from: '', width: 0, height: 0, heroMode: '', plate: '', note: '' };
/* -> Promise<{ unit: the owner's or the previous edition's unit | null, note: why not, for what stands in
   its place ('' when there is nothing to say) }>. Never rejects. */
function foundLogoUnit(fb, eventId, o) {
  var hadPrevious = unitSources(o.sourceDocs).length > 0;
  function step(run, what) {
    return Promise.resolve().then(run).then(null, function (err) {
      console.error('plan-structure: ' + what + ' could not be used — ' + (err && err.message));
      return { error: err };
    });
  }
  /* an upload that could not be used at all is said so on whatever stands in its place */
  var ownerNote = '';
  function withOwnerNote(note) { return [ownerNote, note].filter(Boolean).join(' '); }
  return step(function () { return ownerLogoUnit(fb, eventId, o); }, 'the uploaded logo').then(function (unit) {
    if (unit && !unit.refused && !unit.error) return { unit: unit, note: '' };
    if (unit && unit.refused) ownerNote = unit.note;
    if (unit && unit.error) ownerNote = 'Your uploaded logo could not be checked (something went wrong while it was read), so the hero does not show it. Select this and use Replace image to put it in.';
    return step(function () { return previousEditionUnit(fb, eventId, o); }, 'the previous edition\'s logo unit').then(function (prev) {
      if (prev && !prev.stuck && !prev.failed && !prev.error) return { unit: withNote(prev, ownerNote), note: '' };
      var note = prev && (prev.stuck || prev.failed) ? prev.note
        : prev && prev.error && hadPrevious ? previousUnitNote('something went wrong while it was examined (' + String((prev.error && prev.error.message) || 'no detail').slice(0, 120) + ')')
        : '';
      return { unit: null, note: withOwnerNote(note) };
    });
  });
}
function withNote(unit, before) {
  if (unit && before) unit.note = (before + ' ' + (unit.note || '')).trim();
  return unit;
}
function buildLogoUnit(fb, eventId, o) {
  var hadPrevious = unitSources(o.sourceDocs).length > 0;
  var found = o.found ? Promise.resolve(o.found).then(null, function () { return foundLogoUnit(fb, eventId, o); }) : foundLogoUnit(fb, eventId, o);
  return found.then(function (f) {
    if (f && f.unit) return f.unit;
    return Promise.resolve().then(function () { return drawnLogoUnit(fb, eventId, o); }).then(null, function (err) {
      console.error('plan-structure: a drawn logo unit could not be used — ' + (err && err.message));
      return null;
    }).then(function (drawn) {
      drawn = drawn || Object.assign({}, NO_UNIT);
      if (f && f.note) drawn.note = f.note;
      return drawn;
    });
  }).then(function (unit) { return guardedUnit(unit || Object.assign({}, NO_UNIT), hadPrevious); }, function (err) {
    console.error('plan-structure: the logo unit could not be made, the hero will set it in type — ' + (err && err.message));
    return guardedUnit(Object.assign({}, NO_UNIT), hadPrevious);
  });
}
/* The last word: a previous edition's logo was named, and what stands in the hero is not it (nor the
   owner's): the owner is told, whatever path led here. */
function guardedUnit(unit, hadPrevious) {
  if (hadPrevious && unit.source !== 'previous-edition' && unit.source !== 'owner' && !String(unit.note || '').trim()) {
    console.error('logo unit: a previous edition\'s logo was named and not used, with no reason recorded');
    unit.note = previousUnitNote('it could not be examined');
  }
  return unit;
}
/* the same, never later than the plan may be: past that the owner's logo is used as uploaded, else the hero
   sets the unit in type — and says why when a previous edition's logo was named */
function logoUnitInTime(fb, eventId, o) {
  if (!o.deadlineAt) return buildLogoUnit(fb, eventId, o);
  var timer = null;
  var late = new Promise(function (resolve) {
    timer = setTimeout(function () {
      console.error('plan-structure: the logo unit was not ready in time');
      var url = /^https:\/\//i.test(String(o.ownerLogoUrl || '')) ? String(o.ownerLogoUrl).trim() : '';
      resolve(guardedUnit({ url: url, storagePath: url ? storagePathOf(fb, url) : '', source: url ? 'owner' : '', from: url, width: 0, height: 0, heroMode: '', plate: '',
        note: url ? 'Your logo could not be checked in time, so it is used exactly as you uploaded it. Check that it shows this edition\'s year.'
          : unitSources(o.sourceDocs).length ? previousUnitNote('there was not enough time to examine it before the site was made') : '' }, unitSources(o.sourceDocs).length > 0));
    }, Math.max(1000, o.deadlineAt - Date.now() - 8000));
  });
  return Promise.race([buildLogoUnit(fb, eventId, o), late]).then(function (unit) { clearTimeout(timer); return unit; });
}
/* Whether the design's copy for a dark ground was made of its unit: said by logoUnitDarkOf; a design written before
   that was kept shows it by its file — made in the same run as its unit (generated/<stamp>-logo-unit… beside
   generated/<stamp>-logo-unit-on-dark…). An owner's logo used as uploaded has no such name: its old copy is not
   trusted (one could be an earlier logo's, left by an upload before 28 Oct 2026). */
function darkCopyOfUnit(design) {
  if (!design || !design.logoUnitDarkUrl) return false;
  if (design.logoUnitDarkOf) return design.logoUnitDarkOf === design.logoUnitUrl;
  var run = function (p) { var m = /\/generated\/(\d+)-logo-unit[.-]/.exec(String(p || '')); return m ? m[1] : ''; };
  var a = run(design.logoUnitStoragePath), b = run(design.logoUnitDarkStoragePath);
  return !!a && a === b;
}

function handlePlanStructure(req, res) {
  readBody(req, res, function (raw) {
    var payload;
    try { payload = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    var eventId = String(payload.eventId || '').trim();
    if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
    if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });
    /* 'light' | 'dark' as the owner chose in Create Event, else 'auto': the design decides */
    var themeMode = genDesign.normaliseMode(payload.themeMode);
    /* what the owner typed under "Anything else the AI should know" in Create Event, in their own words */
    var ownerNotes = String(payload.designNotes || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    /* 'standard': the twelve sections every ET microsite draws on; 'advanced': the AI chooses the sections */
    var siteMode = payload.siteMode === 'standard' ? 'standard' : 'advanced';
    /* The generation this plan is for (WZ-034, BE-029): it reads only what that run read — the brief and the pages
       the owner gave this time, never an earlier run's — and the plan is kept with the run, not put on the event,
       until the run's site is written (generate-content). useEventInputs: a run made from what the event already
       has on record (an event whose site an earlier pipeline made). Without a run: the event's newest brief and
       every page it has, and the plan saved on the event, as before. */
    var runId = runIdOf(payload);
    if (runId === null) return sendJson(res, 400, { error: RUN_ID_ERROR });
    var inputsOf = runId && payload.useEventInputs !== true ? runId : '';

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    var eventRef = fb.db.collection('events').doc(eventId);
    var watch = null;
    /* one time limit for everything this request asks a model: the plan, then reading the logo unit */
    var deadlineAt = Date.now() + llm.LIMITS.budgetMs;
    watchEvent(fb, eventId).then(function (w) {
      watch = w;
      /* BE-033: the run's record says its plan is being made (GET /api/generate/status), so a page reloaded meanwhile
         waits for it instead of paying for a second one. The plan, once kept, replaces the record. Never fails the step. */
      if (runId) {
        w.within(function (tx) { tx.set(generatedSite.runRef(fb, eventId, runId), { runId: runId, planningAt: new Date().toISOString() }, { merge: true }); })
          .then(null, function (err) { console.error('plan-structure: run ' + runId + ' of ' + eventId + ' was not marked as planning — ' + (err && err.message)); });
      }
      return Promise.all([
        eventRef.get(),
        generatedSite.inputs(fb, eventId, inputsOf),
        /* what the event already has on record (Content › Agenda, Speakers, FAQ): a list that exists gets its section */
        Promise.all(['sessions', 'speakers', 'faqs'].map(function (c) { return eventRef.collection(c).limit(1).get().then(function (q) { return q.empty ? '' : c; }, function () { return ''; }); }))
      ]);
    }).then(function (results) {
      var eventSnap = results[0], read = results[1];
      var onRecord = (results[2] || []).filter(Boolean);
      var stored = eventSnap.exists ? eventSnap.data() : {};
      /* the facts of the event only: what earlier runs left on the record is not material for a new design */
      var eventMeta = Object.assign({}, {
        name: stored.name, category: stored.category, start: stored.start, end: stored.end,
        venue: stored.venue, city: stored.city, description: stored.description
      }, payload.eventMeta || {});
      /* the description's headings are the owner's brief — directions, not facts to show (owner-brief.js) */
      eventMeta.description = ownerBrief.withoutHeadings(eventMeta.description);
      if (!eventMeta.description) delete eventMeta.description;
      var brief = read.brief;
      var sourceDocs = read.sourceDocs;
      /* Nothing to design from (BE-021): no name, no description, no brief, no reference page and no notes. Answered
         before anything is paid for — the plan, the logo unit's readings and the photos' are all model calls. An event
         with a name alone is designed from it, as a thin run. */
      if (!String(eventMeta.name || stored.name || '').trim() && !eventMeta.description && !brief && !sourceDocs.length && !ownerNotes) {
        throw httpError(400, 'Add a description, a document or a reference link first.', { code: 'need-input' });
      }
      /* an awards event is built as ET's award sites are (award-site.js), whatever structure was asked for */
      if (String(stored.category || '').toLowerCase() === 'awards' || payload.siteMode === 'award') siteMode = 'award';
      var sources = sourceDocs.map(function (v) { return { type: v.type, url: v.url, extractedSections: v.extractedSections, sectionPictures: v.type === 'previousEdition' ? v.sectionPictures || [] : [] }; });
      var themeInfo = extractThemeFromPreviousEditionSources(sourceDocs);
      var reference = designReference(sourceDocs);
      var artDirection = genDesign.artDirectionFor(eventId);

      /* A previous-edition link given: the site is INSPIRED BY it, and carries its city in creative terms —
         this edition's venue, else the previous edition's, never a mix (edition-look.js venueForDesign).
         Without one, the site is designed exactly as before. */
      var prevSource = sourceDocs.filter(function (d) { return d.type === 'previousEdition'; })[0] || null;
      var venue = prevSource ? editionLook.venueForDesign(eventMeta, brief, prevSource.previous) : null;
      var place = venue && venue.venue ? venue : null;
      var prompt = buildDesignPlanPrompt({ eventMeta: eventMeta, brief: brief, sources: sources, themeInfo: themeInfo, reference: reference, artDirection: artDirection, themeMode: themeMode, ownerNotes: ownerNotes, siteMode: siteMode, place: place, onRecord: onRecord });
      /* The logo unit — the owner's upload, else the previous edition's lock-up — needs nothing of the plan:
         it is fetched and read while the plan is written, so that its readings (20 to 30 s each, measured)
         have the time they need rather than what the plan leaves (foundLogoUnit). */
      var logoInputs = { eventMeta: eventMeta, ownerLogoUrl: stored.logoUrl, briefTexts: briefYearTexts(brief, eventMeta), sourceDocs: sourceDocs,
        stamp: new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14), deadlineAt: deadlineAt };
      var logoFound = foundLogoUnit(fb, eventId, logoInputs);
      /* the previous edition's photos, sorted by what they show (classifyGlimpses), read beside the plan */
      var glimpseSrc = sourceDocs.filter(function (d) { return d.type === 'previousEdition' && d.previous; })[0];
      var glimpseRead = NEW_ET_STANDARD && glimpseSrc ? classifyGlimpses(fb, eventId, glimpseSrc.previous.glimpses, deadlineAt) : Promise.resolve(null);
      return Promise.all([llm.callJson(prompt, DESIGN_PLAN_SCHEMA, { route: 'plan-structure', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.small, deadlineAt: deadlineAt, onUsage: aiUsageRecorder(fb, eventId, 'plan-structure') }), glimpseRead]).then(function (both) {
        var r = both[0], glimpseKinds = both[1];
        if (r.error) return sendAiFailure(res, r);
        var sections = sanitizeDesignPlanSections(r.parsed, siteMode);
        /* the previous edition's real records, as sections the server builds (prev-sections.js): placed before
           the contact section, or at the end */
        var prevDoc = sourceDocs.filter(function (d) { return d.type === 'previousEdition' && d.previous; })[0];
        var prevPlanned = prevDoc ? prevSections.plan(prevDoc.previous).filter(function (x) { return !sections.some(function (y) { return y.id === x.id; }); }) : [];
        /* an award site: the jury and partners are built from the award's records (below), so of the previous
           edition's own lists only its photos stay */
        if (siteMode === 'award') {
          prevPlanned = prevPlanned.filter(function (x) { return x.prebuilt === 'glimpses'; });
          sections = withAwardRecords(sections, awardForSite(sourceDocs, stored), { speakers: onRecord.indexOf('speakers') !== -1 });
        }
        /* the previous edition's real photos stand in for the standard "past edition glimpses" gallery */
        if (prevPlanned.some(function (x) { return x.prebuilt === 'glimpses'; })) sections = sections.filter(function (x) { return x.id !== 'past-edition-glimpses'; });
        if (prevPlanned.length) {
          var at = sections.map(function (x) { return x.kind === 'contact' || /contact/.test(x.id) ? 1 : 0; }).indexOf(1);
          if (at === -1) at = sections.length;
          sections.splice.apply(sections, [at, 0].concat(prevPlanned));
        }
        /* the sponsors (this edition's, then the previous edition's) open the page, straight after the hero;
           the rest keep the planned order (section-order.js) */
        sections = sectionOrder.sponsorsFirst(sections);
        /* A designed presentation's own colours are not left to the model to remember: they are set here,
           before the palette is checked for contrast. The owner's light/dark choice still wins. */
        var look = brief && brief.visualIdentity && brief.visualIdentity.designed === 'yes' ? brief.visualIdentity : null;
        if (look && r.parsed && r.parsed.design) {
          var dd = r.parsed.design;
          dd.themeColor = deckColour(look, 'primary') || dd.themeColor;
          dd.accentColor = deckColour(look, 'accent') || deckColour(look, 'highlight') || dd.accentColor;
          var deckBg = deckColour(look, 'background');
          if (themeMode === 'auto' && (look.mode === 'light' || look.mode === 'dark')) dd.mode = look.mode;
          if (deckBg && (themeMode === 'auto' || (genDesign.luminance(deckBg) < 0.2) === (themeMode === 'dark'))) dd.backgroundColor = deckBg;
          var deckText = deckColour(look, 'text');
          if (deckText) dd.textColor = deckText;
        }
        /* A site INSPIRED BY the previous edition, never a copy of it (edition-look.js, inspiredDesign): the
           model's own colours and fonts stand while they are of the edition's palette family, tone and type
           feel; one that left it, or simply copied the edition's own value, is replaced by one derived from
           it. Not where a designed presentation gave the look above, or the owner's own words speak of colour
           or type; the owner's light/dark choice always wins. */
        var ownerWords = ownerNotes + ' ' + String((brief && brief.owner && brief.owner.lookText) || '');
        if (!look && themeInfo.look && r.parsed && r.parsed.design && !editionLook.ownerSetsLook(ownerWords)) {
          Object.assign(r.parsed.design, editionLook.inspiredDesign(themeInfo.look, r.parsed.design, themeMode));
        }
        /* ET's award sites are dark and premium — five of the seven read on 28 Oct 2026 (HR, BFSI, Auto, Retail,
           Health); the owner found ours "an article page". An award site opens dark unless the owner chose light
           (the theme switcher still offers light) */
        if (siteMode === 'award' && themeMode === 'auto' && r.parsed && r.parsed.design) r.parsed.design.mode = 'dark';
        var design = sanitizeDesignPlanDesign(r.parsed, themeMode, eventMeta.name);
        /* ET's newer sites set their headlines in a serif display face */
        if (NEW_ET_STANDARD && googleFonts.categoryOf(design.headingFont) !== 'serif') design.headingFont = 'Playfair Display';
        /* the city as the model named and pictured it (no city is known to the code) */
        if (place) {
          var pd = r.parsed.design || {};
          var clip = function (v, max) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max); };
          var city = clip(pd.placeCity, 60) || place.city;
          if (city) design.place = { venue: place.venue, source: place.source, city: city, cues: clip(pd.placeCues, 400), motif: clip(pd.placeMotif, 200) };
        }
        /* the previous edition's banner artwork, in words: the new hero picture is inspired by it */
        if (themeInfo.keyVisual && themeInfo.keyVisual.description) design.inspiredBy = themeInfo.keyVisual.description;
        /* What the owner said is not left to the model to remember (owner-brief.js): their tagline is the
           hero's line, word for word, and "graphics, not photographs" means no generated photographs. */
        var owner = brief && brief.owner ? brief.owner : null;
        if (owner && owner.tagline) design.heroTagline = owner.tagline;
        var graphic = !!(owner && owner.pictures === 'graphics');
        if (graphic) sections.forEach(function (s) { s.image = ''; });
        /* the previous edition's real photos where ET's newer sites put theirs; generated pictures only where
           there are none (newStandardPictures) — else, the earlier rules (etPictureRules) */
        /* only photos that were looked at are placed: unread ones could be a close-up or a screen of names */
        else if (NEW_ET_STANDARD) sections = newStandardPictures(sections, glimpseKinds || [], design);
        else sections = etPictureRules(sections, prevDoc && prevDoc.previous ? prevDoc.previous.glimpses : []);
        /* the numbers band is told the previous edition's own figures */
        if (NEW_ET_STANDARD && prevDoc && prevDoc.previous) {
          var pv = prevDoc.previous, days = {};
          (pv.agenda || []).forEach(function (a) { var d = String(a.start || '').slice(0, 10); if (d) days[d] = 1; });
          var figures = [Object.keys(days).length ? Object.keys(days).length + ' days' : '', (pv.speakers || []).length ? (pv.speakers || []).length + ' speakers' : '',
            (pv.agenda || []).length ? (pv.agenda || []).length + ' sessions' : '', (pv.sponsors || []).length ? (pv.sponsors || []).length + ' partners' : ''].filter(Boolean);
          sections.forEach(function (s) { if (s.id === 'by-the-numbers' && figures.length) s.purpose = String(s.purpose || '') + ' The previous edition had: ' + figures.join(', ') + ' — use these (as "60+" and the like) with any the brief gives.'; });
        }
        var now = new Date().toISOString();
        var stamp = now.replace(/[^0-9]/g, '').slice(0, 14);

        /* The pictures are made side by side: the hero's and one for each section the plan gave one. A
           picture that fails costs the site that picture only. */
        /* what every picture is told about the event it belongs to: its name, its subject, its place */
        var about = [eventMeta.name, (brief && brief.theme) || eventMeta.description, [eventMeta.venue, eventMeta.city].filter(Boolean).join(', ')]
          .map(function (v) { return String(v || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(' — ').slice(0, 400);
        var level = owner && owner.level ? owner.level : '';
        var heroPrompt = genDesign.imagePrompt(design.heroImage, design, { hero: true, about: about, level: level, graphic: graphic });
        /* the banner on the previous edition's real photo (newStandardPictures), else a generated one */
        var heroReal = design.heroImageReal;
        delete design.heroImageReal;
        var jobs = [heroReal ? Promise.resolve({ heroImageUrl: heroReal, heroImageStoragePath: null, heroImageError: null }) : buildHeroImage(fb, eventId, brief, design.themeColor, heroPrompt, stamp)].concat(
          sections.filter(function (s) { return s.image; }).map(function (s) {
            /* what the section is for, so the picture is about that section and not only the event at large */
            var context = 'It illustrates the section of the event\'s website that is about this (for your understanding only — none of these words may be written in the picture): ' + s.purpose;
            return buildSectionImage(fb, eventId, s.id, s.image, design, stamp, context, about, level, s.imageKind);
          })
        );
        /* the logo unit is made alongside them: the logo the owner uploaded, else the previous edition's own,
           else a new one drawn — each examined for its year and its extras (buildLogoUnit) */
        var unitJob = logoUnitInTime(fb, eventId, Object.assign({}, logoInputs, { design: design, found: logoFound }));
        return Promise.all([Promise.all(jobs), unitJob]).then(function (both) {
          var made = both[0], unit = both[1];
          design.logoUnitUrl = unit.url; design.logoUnitStoragePath = unit.storagePath; design.logoUnitSource = unit.source;
          design.logoUnitFrom = unit.from; design.logoUnitWidth = unit.width; design.logoUnitHeight = unit.height;
          design.logoUnitPlate = unit.plate; design.logoUnitNote = unit.note; design.logoUnitHeroMode = unit.heroMode || '';
          delete design.logoUnitDarkUrl; delete design.logoUnitDarkStoragePath; delete design.logoUnitDarkOf;
          var heroImage = made[0];
          /* the hero picture's name carries the run (buildHeroImage) */
          design.heroImageUrl = heroImage.heroImageUrl || null;
          design.heroImageStoragePath = heroImage.heroImageStoragePath;
          design.heroImageError = heroImage.heroImageError;
          /* the page runs on from the banner: its background is the colour the banner picture ends in, as light (or
             dark) as the site is, and the banner's foot fades into it (genDesign.heroCss) — the owner, 10 Nov 2026 */
          var runOn = heroImage.heroBottom ? genDesign.pageColoursFrom(heroImage.heroBottom, design.mode, design.textColor) : null;
          if (runOn) { design.backgroundColor = runOn.backgroundColor; design.surfaceColor = runOn.surfaceColor; design.pageFromHero = true; }
          var images = made.slice(1).filter(Boolean);
          sections.forEach(function (s) {
            if (!s.image && s.imageSource === 'previous-edition') return;      // a real photo, set by etPictureRules
            var img = images.filter(function (i) { return i.sectionId === s.id; })[0];
            s.imageUrl = img ? img.url : '';
          });
          /* A lock-up on a light banner gets a copy for a dark one (only the black lettering made white: ET's logo
             rule). A dark site's banner is then dark as the site is — never a pale banner on a dark site; a light
             site's banner shows it when a dark theme turns the banner dark (gen-base.css, the owner, 28 Oct 2026). */
          var lightHero = /^(dark|light)$/.test(String(design.logoUnitHeroMode)) ? design.logoUnitHeroMode === 'light' : design.mode !== 'dark';
          /* none is needed on a plate (it stays as drawn) nor for a unit set in type (it carries the ET logo for a
             dark ground); the event's name drawn as a unit brings its own (drawnLogoUnit) */
          var wantsDark = lightHero && unit.url && !unit.plate;
          var onDark = !wantsDark ? Promise.resolve(null)
            : unit.source === 'generated' ? Promise.resolve(unit.darkUrl ? { url: unit.darkUrl, storagePath: unit.darkStoragePath } : { why: 'failed' })
            : storeOnDarkUnit(fb, eventId, stamp, unit);
          return onDark.then(function (dark) {
          if (dark && dark.url) { design.logoUnitDarkUrl = dark.url; design.logoUnitDarkStoragePath = dark.storagePath; design.logoUnitDarkOf = unit.url; }
          /* and the owner is told when there is none, on the unit's note like anything else about the logo */
          else if (wantsDark) design.logoUnitNote = [design.logoUnitNote, darkCopyNote(dark && dark.why, design.mode === 'dark')].filter(Boolean).join(' ');

          var designPlan = {
            /* generatedBy: who asked for this design (BE-058: every write names who made it) */
            sections: sections, design: design, generatedAt: now, generatedBy: actorOf(req.user), themeMode: themeMode, ownerNotes: ownerNotes, siteMode: siteMode,
            owner: owner,
            reference: reference.basis
              ? { type: reference.basis.type, url: reference.basis.url, design: reference.basis.design }
              : { type: 'none', artDirection: artDirection.id }
          };
          /* the event's description, written from the brief and the previous edition — only where it is empty or
             still the owner's raw brief; one the owner wrote by hand is kept (event-description.js) */
          var described = eventDescription.patch(r.parsed && r.parsed.eventDescription, stored, (payload.eventMeta || {}).description);
          /* within a run, the plan (and the description written with it) waits with the run for its site: the event
             changes when the site is written (generate-content), never half-way. The run becomes the event's newest:
             a run that planned earlier, in another tab or by someone else, can no longer put its site on the event. */
          var kept = runId
            ? watch.within(function (tx, ref) {
              var at = new Date().toISOString(), runRef = generatedSite.runRef(fb, eventId, runId);
              /* a run the person stopped while this was being made keeps the event as it is (WZ-055) */
              return tx.get(runRef).then(function (was) {
              if (was.exists && (was.data() || {}).status === 'stopped') throw httpError(409, RUN_STOPPED, { code: 'run-stopped' });
              tx.set(runRef, { runId: runId, status: 'planned', designPlan: designPlan, described: described ? { description: described.description, from: String(stored.description || ''), previous: !!prevSource } : null,
                usedEventInputs: !inputsOf, by: actorOf(req.user), plannedAt: at });    // whole: a plan made again in the same run replaces the last, never blends with it
              tx.update(ref, { generationRun: { runId: runId, at: at } });
              });
            })
            : watch.merge(Object.assign({ designPlan: designPlan, matchedTemplateId: null, structurePlan: null, theme: null }, described || {}));
          return kept
            .then(function () {
              sendJson(res, 200, { eventId: eventId, runId: runId || undefined, matchedTemplateId: null, structurePlan: null, theme: null, designPlan: designPlan, description: described ? described.description : undefined });
              if (watch.live) logActivity(fb, eventId, req.user, 'site-designed', 'AI made a new site design — ' + sections.length + ' sections' + (runId ? ' (used once its pages are written)' : ''), { area: 'design' });
              if (watch.live && described && !runId) logActivity(fb, eventId, req.user, 'updated', eventDescription.activityDetail(!!prevSource), { area: 'event',
                fields: [{ field: 'description', before: String(stored.description || '').slice(0, 600), after: described.description }] });
            });
          });
        });
      });
    }).catch(function (err) { sendStepFailure(res, err, 500, 'The site could not be designed just now. Please try again.', 'plan-structure'); });
  }, BODY_LIMITS.small);
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
    'You are generating REAL content for an event microsite, for ETB2B EventSphere\'s event builder. Ground every fact below — never invent a date, number, named person or company that isn\'t clearly present in the material. An empty string/array is the correct answer when nothing grounded supports a field; never pad with generic filler just to fill it in.',
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
function runGenerateContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, contentMap, skippedLibraries, genTheme, by) {
  var needs = classifyLibraryNeeds(contentMap);
  if (!Object.keys(needs).length) return sendJson(res, 400, { error: 'This template has no content.map entries this step knows how to generate for.' });

  var draftRef = fb.db.collection('events').doc(eventId);
  var sourceRef = fb.db.collection('events').doc(sourceEventId);
  var watch = null;
  watchEvent(fb, eventId).then(function (w) {
    watch = w;
    return Promise.all([
      sourceRef.get(),
      sourceRef.collection('briefs').orderBy('createdAt', 'desc').limit(1).get(),
      sourceRef.collection('sources').get()
    ]);
  }).then(function (results) {
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

    return llm.callJson(prompt, schema, { route: 'generate-content', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.site, onUsage: aiUsageRecorder(fb, eventId, 'generate-content') }).then(function (r) {
      if (r.error) return sendAiFailure(res, r);
      var library = sanitizeGeneratedLibrary(r.parsed, needs);
      if (genTheme && genTheme.heroImageUrl && library.hero) {
        library.hero.psdBanner = { compositeImageData: genTheme.heroImageUrl };
      }
      var positioningNotes = String(r.parsed.positioningNotes || '').trim().slice(0, 500);
      var now = new Date().toISOString();
      return watch.stillThere()
        .then(function () { return draftRef.collection('drafts').add({ templateId: templateId, sourceEventId: sourceEventId, library: library, positioningNotes: positioningNotes, model: r.model || GEMINI_TEXT_MODEL, generatedAt: now, generatedBy: actorOf(by), skippedLibraries: skippedLibraries }); })
        .then(function (docRef) {
          sendJson(res, 200, { eventId: eventId, templateId: templateId, draftId: docRef.id, positioningNotes: positioningNotes, library: library });
          if (watch.live) logActivity(fb, eventId, by, 'site-generated', 'AI content written for the site (' + Object.keys(library).length + ' parts) — opened in the editor next', { area: 'site' });
        });
    });
  }).catch(function (err) { sendStepFailure(res, err, 500, 'The pages could not be written just now. Please try again.', 'generate-content'); });
}

/* ---------- POST /api/generate-content, 'gen-' branch — AI-DESIGNED GENERATED TEMPLATES PIPELINE, step 2 ----------
   Deliberately SEPARATE from classifyLibraryNeeds/buildGenerateSchema/buildGenerateContentPrompt/
   sanitizeGeneratedLibrary/runGenerateContent/GENERATION_EXCLUDED_LIBRARIES/deliberatelySkippedLibraries
   above — those are the ported-template path's real pipeline (templateJson.briefReady===true, handled in
   handleGenerateContent below) and must keep working byte-for-byte unchanged. This block is the gen- path's
   own pipeline: instead of filling text into a fixed component's content.map, Gemini writes the actual
   HTML + CSS for every section designPlan.sections describes (plus nav/hero/footer), grounded in
   designPlan.design and the same real research. */
var SECTION_CODE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    positioningNotes: { type: 'STRING', description: 'Internal only. Name the ONE specific thing adapted from a competitor (or "no competitor material was given") and the ONE thing deliberately NOT carried over from this event\'s own previous edition.' },
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          html: { type: 'STRING', description: 'Real, complete, semantic HTML for this section\'s inner content — ONE root element, no <html>/<body>/<head> wrapper, no <script> tags, no inline event handler attributes, no javascript: URIs, no <iframe>/<object>/<embed>.' },
          css: { type: 'STRING', description: 'Real CSS for this section only, written as plain class selectors for the classes used in this section\'s html. Do NOT write [data-rv-section] in any selector and do not style html, body or :root: the server confines every rule to this section, and the section\'s root element is the positioning context for anything absolutely positioned inside it. No @import, no url(javascript:...), no CSS behaviors.' }
        },
        required: ['id', 'html', 'css']
      }
    }
  },
  required: ['positioningNotes', 'sections']
};

function plannedSectionList(designPlan) {
  /* the sections the server builds itself (the previous edition's records) are not the model's to write */
  var planned = ((designPlan && designPlan.sections) || []).filter(function (s) { return !s.prebuilt; });
  return [{ id: 'nav', kind: 'nav', purpose: 'Top bar of the site, built by the server (functions/lib/et-nav.js) as on ET\'s own event sites: the portal\'s logo, the event\'s name with its date and place, a link to every section, the main action. Always present, first. Not written by you.', layout: 'A full-width bar with a second row of section links; once the visitor scrolls, a rounded bar floating at the top centre.' }]
    .concat([{ id: 'hero', kind: 'hero', purpose: 'Hero banner, built by the server: the ET Business Verticals logo, the event\'s wordmark, one line, date and place, two buttons. Always present, right after nav. Not written by you.', layout: 'Centred, a full screen tall, over the hero picture.' }])
    .concat(planned);
  /* the footer is ET's common footer, built by the server (et-footer.js, siteFooter below): not the model's */
}

/* payload.write: the ids this call writes (the site is written in two calls side by side — see
   runGenerateDesignedContent); every call is shown the whole page so that its part fits the rest. */
/* ONE TONE, top to bottom. A page that flips light / dark / light from section to section reads as pieces of
   different sites (owners asked for the theme to carry through). The hero is a picture banner and takes its
   own tone; every section after it, the footer included, stays in the page's mode. */
function toneRule(design) {
  /* ET's newer standard had the what-awaits band, the discussion topics and the closing call to act as deep dark
     bands; the owner asked for one background instead (10 Nov 2026: "All microsites are being designed on chess
     pattern … for a smooth website single/similar background of sections are recommended") */
  var dark = design && design.mode === 'dark';
  return 'ONE TONE FOR THE WHOLE PAGE: this site is ' + (dark ? 'DARK' : 'LIGHT') + ' and every section below the hero — the footer included — stays ' + (dark ? 'dark' : 'light') + ': its background is var(--rv-bg) or var(--rv-surface) (or a soft tint of the brand colour that is just as ' + (dark ? 'dark' : 'light') + '), its text var(--rv-text) and var(--rv-muted). Never invert a section to the opposite (' + (dark ? 'a white or light band' : 'a black, navy or dark-brand band') + ') — sections differ by layout, pictures and surface, not by flipping between light and dark. Text set over a picture sits on a ' + (dark ? 'dark' : 'light') + ' veil, in the page\'s own text colour. Brand colour is for buttons, accents, rules and highlights, not for whole ' + (dark ? 'light' : 'dark') + ' bands.';
}

/* The city an edition takes place in (design.place, set by plan-structure), for the model writing sections:
   shown subtly, beyond the hero's address line. oneSection: the prompt writes a single section (Redesign
   section), which may carry the motif when it suits it. '' when no city is known. */
function placeDirection(place, oneSection) {
  if (!place || !place.city) return '';
  /* ET's newer sites carry the city in the banner and in their words, never as drawn ornaments: line-art domes
     and arches above sections read as clip-art (the owner, 23 Oct 2026) */
  if (NEW_ET_STANDARD) {
    var c = String(place.city).replace(/\s+/g, ' ').trim().slice(0, 60);
    return 'THE PLACE: this edition takes place in ' + c + ': where the words naturally speak of the venue or the region, name ' + c + '. Draw NO ornament, motif, outline or pattern of the city (no domes, arches, skylines or monuments in CSS or SVG). These are directions for you: never write them on the site.';
  }
  var city = String(place.city).replace(/\s+/g, ' ').trim().slice(0, 60);
  var motif = String(place.motif || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return 'THE PLACE: this edition takes place in ' + city + ', and the page shows it beyond the hero\'s address line — subtly: ' +
    (motif ? 'one graphic motif drawn from it (' + motif + ')' : 'one graphic detail drawn from its own architecture or crafts') +
    ', drawn by you in CSS or inline SVG in the brand colours at low opacity, as a divider, a corner ornament or a faint pattern ' +
    (oneSection ? 'in this section where it suits it' : 'in one or two sections') + ' — never behind running text' + (oneSection ? '' : ', never in every section') +
    '; and, where the words naturally speak of the venue or the region, ' + city + ' by name. These are directions for you: never write them, or any instruction, on the site.';
}

function buildSectionCodePrompt(payload) {
  var designPlan = payload.designPlan || {};
  var design = designPlan.design || {};
  var reference = designPlan.reference || { type: 'none' };
  var fullList = plannedSectionList(designPlan);
  var write = payload.write || fullList.map(function (s) { return s.id; });
  var ownHistory = (payload.sources || []).filter(function (s) { return s.type !== 'competitor'; });
  var competitors = (payload.sources || []).filter(function (s) { return s.type === 'competitor'; });
  var radius = (design.cornerRadius || '12') + 'px';

  var lines = [
    'You are writing the REAL HTML and CSS of a bespoke event microsite, for ETB2B EventSphere\'s event builder — designing and coding it yourself to the standard of a top agency, not filling a template. Ground every fact below — never invent a date, number, named person or company that isn\'t clearly present in the material. Leave out what nothing supports; never pad with generic filler.',
    '',
    'THE DESIGN — decided already; every section follows it, so the page reads as one piece:',
    'Mood: ' + (design.mood || ''),
    'Layout system: ' + (design.layout || ''),
    'Page is ' + (design.mode === 'dark' ? 'DARK (light text on a dark background)' : 'LIGHT (dark text on a light background)') + '.',
    '',
    'Colours and fonts are CSS variables already defined on the page — use the variables, never the raw values, so that the owner can restyle the site later:',
    '  var(--theme-color)   ' + (design.themeColor || '') + '   brand colour: buttons, links, highlights',
    '  var(--accent-color)  ' + (design.accentColor || '') + '   second colour',
    /* accessibility (rv-theme.js derivedVars): colours worked out from these to read at 4.5:1 */
    '  var(--rv-theme-fill,var(--theme-color)) with var(--rv-on-theme,#ffffff)   the ground and the words of a brand-coloured button or badge (always readable together; write them exactly so)',
    '  var(--rv-theme-ink,var(--theme-color))   the brand colour for small text — labels, eyebrows, links — on the page or a card (always readable)',
    '  var(--rv-bg)         ' + (design.backgroundColor || '') + '   page background',
    '  var(--rv-surface)    ' + (design.surfaceColor || '') + '   cards, alternating bands',
    '  var(--rv-text)       ' + (design.textColor || '') + '   body text',
    '  var(--rv-muted)      ' + (design.mutedColor || '') + '   secondary text',
    '  var(--heading-font-family)  ' + (design.headingFont || '') + '   headings (loaded)',
    '  var(--body-font-family)     ' + (design.bodyFont || '') + '   everything else (loaded)',
    toneRule(design),
    '',
    'SHARED RULES — written identically in every section, because sections are styled separately:',
    '- Content sits in a container: max-width 1200px, margin 0 auto, padding 0 24px. Sections have vertical padding clamp(64px, 9vw, 128px).',
    '- Corner radius ' + radius + ' on cards, pictures and inputs. Buttons: padding 15px 30px, radius ' + radius + ', font-weight 600, font-size 1rem; primary = background var(--rv-theme-fill,var(--theme-color)) with color var(--rv-on-theme,#ffffff); secondary = outlined.',
    '- TYPE MUST BE EASY TO READ. Use rem or px for every font-size — never em or %. Paragraph and list text: 1.125rem (18px) or larger, line-height 1.65, in var(--rv-text) or var(--rv-muted), lines no longer than about 70 characters (max-width: 68ch). Section headings (h2): exactly ' + genDesign.HEADING_SCALE.section + ', line-height 1.15 — calm and confident, never larger (not even in capitals or a heavy weight); the hero, which the server builds, holds the page\'s only h1. Sub-headings and card titles (h3): ' + genDesign.HEADING_SCALE.sub + '. Small labels and captions: never below 0.875rem. Only a band of big numbers may be set larger than a section heading. Set font-family, font-size, line-height and color explicitly on the text you write; do not rely on inherited values.',
    '- Responsive without script: grids and splits collapse to one column under 820px (use @media (max-width: 820px)); nothing may cause sideways scrolling; pictures are width:100%, height:auto or object-fit:cover inside a sized frame.',
    genDesign.MOBILE_RULES,
    '- Give the page visual rhythm: do not build two neighbouring sections the same way. Follow each section\'s own "layout" below exactly.',
    '- BUTTONS SAY IT SHORT: one to three words, at most 24 characters ("Register Now", "Let\'s Discuss", "Request an Invite") — never a sentence or a description in brackets; a button\'s words stay on one line at every width (the owner, 10 Nov 2026: "avoid using this much long CTA text").',
    /* a heading said twice reads as a mistake (Agentic: "Not more AI. Better AI." over two sections); the sections
       are written in several answers at once, so each is told (repeatedHeadingIds writes a repeat again) */
    '- Every section\'s heading (h2) is its own: never the words of another section\'s heading, nor the hero\'s line "' + (design.heroTagline || '') + '". Sections are written by several writers at the same moment, so make each heading say what that section alone is about.',
    /* a red round play glyph on a card that plays nothing (BWS Knowledge Series) reads as a broken video */
    '- Nothing may look like a control that is not one: never draw a play button or triangle, a pause, a download or an external-link icon on anything that is not a real link to that video, file or page (none is given to you, so draw none).',
    '- MOTION, kept light: put the attribute data-rv-reveal on blocks that should ease into view as the visitor scrolls to them — a section\'s heading block, its picture, its cards (cards that are siblings follow one another automatically). Values: data-rv-reveal (rises), data-rv-reveal="left" or "right" (slides in from that side — good for the two halves of a split), "zoom" (pictures), "fade". Use it in most sections below the hero, on a few blocks each; never on the nav, never on a section\'s root element, never on a data-rv-repeat-template item. The page does the animating: do not write opacity:0, keyframes or transitions for it yourself. Besides that, give cards, buttons and pictures a gentle hover (transition: transform .25s ease, box-shadow .25s ease; a 3–4px lift or a slight picture zoom). Nothing loops, blinks or moves on its own.',
    '- CAROUSELS: any section with a row of more items than fit may be a carousel — speakers, partner logos, photos, testimonials, and also discussion topics, tracks or reasons to attend when there are many — but only where it suits the content; a short list is better laid out in full. Mark the wrapper with data-rv-carousel and the element that directly holds the items with data-rv-carousel-track. MOVING ON ITS OWN (data-rv-carousel="auto") is for logos and photos only, and at most one in what you write: many things moving at once tires a visitor (the server keeps no more than two on a page, never in neighbouring sections). Give each item a width (e.g. flex: 0 0 min(360px, 82vw)). The page makes the track scroll sideways and adds the previous/next buttons itself — never draw arrows, dots or a scrollbar of your own, and never write animation to move the items.'
  ];

  if (reference.type && reference.type !== 'none' && reference.design) {
    lines.push('', 'THE REFERENCE this site is modelled on (' + SOURCE_TYPE_LABELS[reference.type] + ', ' + reference.url + ') — the plan below was built on it; keep its structure and character recognisable in what you write, improved, never copied word for word:',
      JSON.stringify(reference.design, null, 2));
  }

  if (designPlan.ownerNotes) {
    lines.push('', 'THE OWNER\'S OWN INSTRUCTIONS FOR THIS SITE — follow them in what you write (never by inventing facts):', '"' + designPlan.ownerNotes + '"');
  }
  /* the owner's brief (owner-brief.js): binding on the copy and every call to action */
  var ownerCopy = ownerBrief.copyLines(designPlan.owner || (payload.brief && payload.brief.owner));
  if (ownerCopy.length) {
    lines.push('');
    lines.push.apply(lines, ownerCopy);
  }
  /* the site's forms runtime opens the registration form from such a button (templates/_shared/rv-forms.js) */
  lines.push('', 'Every button whose action is to register gets data-register-cta and href="#register".');
  /* payment is not part of this release (the owner's standing rule): no button may promise a sale */
  lines.push('', 'NO TICKETS OR PAYMENT: this site takes no payment, so no button or line offers tickets, passes for sale, prices or checkout ("Get Tickets", "Buy Passes", "Pay now"). A seat is registered for or requested ("Register Now", "Request an invitation").');

  /* Numbering the sections ("01", "02" tabs before each heading) is not what an event site does, and when a
     section without records is hidden the count jumps (04, then 07). Items inside a list may be numbered. */
  lines.push('', 'NO SECTION NUMBERS: never number the sections themselves — no "01", "02" tabs, counters, badges or "Section 3" labels before or beside a section\'s heading, and no running count across the page' +
    (payload.designPlan && payload.designPlan.ownerNotes ? ', unless the owner\'s own instructions above ask for numbered sections' : '') + '. Numbering the items inside one list (steps, questions, pillars) is fine.');
  /* the city, in creative terms (plan-structure set design.place from edition-look.js) */
  var placeLine = placeDirection(design.place, false);
  if (placeLine) lines.push('', placeLine);
  lines.push('', 'THE HERO IS NOT YOURS TO WRITE: the server builds it (centred: The Economic Times Business Verticals logo, the event\'s name as a wordmark, the line "' + (design.heroTagline || '') + '", date and place, two buttons). Do not return a "hero" section. Because the hero holds no overview, the first section of the list below that is not the sponsors introduces the event properly. The sections stand on the page in the order listed below (the sponsors, when there are any, come straight after the hero), and the nav\'s links follow that order.',
    'THE ECONOMIC TIMES BRAND: never draw, write or imitate an Economic Times / ET / ETB2B logo, monogram or badge yourself — no "ET" box, no styled "ET" initials, anywhere on the site. The real logo is placed by the server in the hero.',
    ET_LOGO_COLOUR_RULE,
    NAME_RULE,
    'THE TOP BAR IS NOT YOURS TO WRITE EITHER: the server builds the nav as ET\'s own event sites have it (the portal\'s logo, the event\'s name, date and place, a link to every section, the main action). Do not return a "nav" section.');

  lines.push('', 'PICTURES — the site must not be text only:');
  var pictured = fullList.filter(function (s) { return s.imageUrl; });
  pictured.forEach(function (s) {
    if (s.photos && s.photos.length > 1) {
      lines.push('- Section "' + s.id + '" has ' + s.photos.length + ' REAL photos from the previous edition, one per card: ' + s.photos.map(function (u, i) { return genDesign.pictureToken('photo-' + s.id + '-' + (i + 1)); }).join(' , ') + '. Make each a tall photo card (about 3:4, object-fit: cover) with a dark gradient at its foot carrying a small number ("01"), the card\'s title in the serif and one line under it; in a row that scrolls sideways on a phone.');
      return;
    }
    lines.push('- Section "' + s.id + '" has a picture, already made. Its address is exactly ' + genDesign.pictureToken(s.id) + ' (it shows: ' + s.image + '). Use it with <img src="' + genDesign.pictureToken(s.id) + '" alt="…" loading="lazy"> and give it real presence — half the section\'s width or more in a split, or the full container width (or the full width of the page) as a plate or band, at least 460px tall on desktop, object-fit: cover — placed as that section\'s layout says.');
  });
  lines.push('- Pictures should fill roughly 40% of the page: make them large — tall splits, full-width bands — never thumbnails.');
  /* ET's award sites (seven read on 28 Oct 2026): the sections the model writes match the ones the server builds */
  if (designPlan.siteMode === 'award') {
    lines.push('', 'THIS IS AN ET AWARD SITE — premium and ceremonial, never an article page. The key dates, categories, jury, how-it-works, the calls to act and the FAQs are built by the server in this design; write yours to sit beside them:',
      '- Every section heading is centred, with a short uppercase eyebrow over it in the brand colour; headings are bold and confident (ET writes them in title case or capitals).',
      '- Cards stand on the ground of the page with a faint glow of the brand colour from one corner (background-image: radial-gradient(120% 90% at 0% 0%, color-mix(in srgb,var(--theme-color) 22%, transparent), transparent 60%)), a 1px border at 14% of the text colour, and lift a little on hover.',
      '- overview: two columns — the picture (a trophy, the stage, the ceremony) tall on one side, the text on the other; at most two short paragraphs.',
      '- why-enter: four to six reasons as cards, each with a small line icon, a short bold title and one line — or, with real photos, as photo cards with the title over a dark veil. Never a paragraph per reason.',
      '- who-should-enter: a grid of icon tiles, three or four across, each one kind of entrant ("Banks", "Insurance", "Technology vendors"…) in a few words — no paragraphs.',
      '- contact-us: centred cards side by side, one per purpose ("For Nominations", "For Jury Opportunities", "For Partnerships"), each with the person\'s name, e-mail and phone.',
      '- about-vertical: one centred paragraph under its heading.');
  }
  if (NEW_ET_STANDARD) {
    lines.push('- NO DECORATION WITHOUT CONTENT: never draw illustrations, line art, clip-art, monuments, outlines of buildings or vehicles, or decorative patterns in SVG or CSS; never a box, frame, panel or card that holds no real picture and no real text (a coloured block "standing in" for a picture is a blank box — leave it out and let the text use the width). Icons are allowed only as small line icons (about 24px) beside a card\'s title.');
    lines.push('- PHOTOS OF PEOPLE: object-fit: cover with object-position: center 25% so heads and faces stay in frame; a picture frame is never taller than the photo allows (no head cut off at the top).');
    lines.push('- SPACING: every section has the same vertical padding, clamp(48px, 5vw, 72px) top and bottom, and no empty spacer blocks; a section that is only a heading and a button is not a section.');
    lines.push('- A section with one of the data-bound kinds (speakers/sessions/faq/partners/contact/glimpses) holds ONLY its heading block and its list — no button, call to act or side panel: when the event has no records of that kind the whole section is hidden, and nothing may be left standing.');
  }
  lines.push('- Each picture belongs to the section it is given to and appears ONCE on the page: never put one section\'s picture in another section, and never add a picture to a section that was given none.');
  lines.push('- Use ONLY the picture addresses given above, written exactly as given (they begin "rvimg://" — the server turns them into the real addresses); never write an http address for a picture and never invent one. Elsewhere, add visual interest with CSS: inline SVG icons you draw yourself (simple line icons, stroke="currentColor"), large numerals, coloured shapes, rules and gradients.');

  /* the nav and the footer carry The Economic Times Business Verticals logo, placed by the server */
  lines.push('', 'THE LOGO IN THE NAV AND THE FOOTER is The Economic Times Business Verticals logo — the same on every ET event site — and the server places it: at the far left of the nav bar, and at the top of the footer. Do not write any logo, wordmark or event name as a logo in either; keep the left of the nav bar free for it (about 220px; the section links sit on the right) and let the footer open with room for it.');

  lines.push('', 'Event (already known):', JSON.stringify(payload.eventMeta || {}, null, 2));
  if (payload.brief) lines.push('', 'Extracted brief:', JSON.stringify(payload.brief, null, 2));
  if (payload.futureEdition) {
    lines.push('', 'IMPORTANT: this is a FUTURE edition that has not happened yet and has no logistics decided — the "own history" sources below are PAST editions, not this one. Project the THEME forward sensibly from how it has evolved across those past editions (what moved from edition to edition — don\'t just repeat the most recent one\'s angle), but never invent a specific date, venue, speaker or sponsor for this edition — those aren\'t known yet. Leave date/location out of the hero copy unless the eventMeta above already states them.');
  }
  if (ownHistory.length) {
    lines.push('', 'This event\'s OWN history (previous/current edition) — your primary source of real facts and theme, but do not simply restate or lightly reword it. The job is a genuine improvement, not a refresh.');
    ownHistory.forEach(function (s) { lines.push('--- ' + s.type + ' (' + s.url + ') ---', JSON.stringify(s.extractedSections, null, 2)); });
  }
  if (competitors.length) {
    lines.push('', 'COMPETITOR events running something similar — read these specifically to find what they do that this event\'s own history above does NOT: a sharper audience framing, a track or angle missing from this event, a stronger hook, a format this event lacks. You must identify at least one such gap and actively close it in your output (in this event\'s own voice, never their wording) — this is not optional background reading.');
    competitors.forEach(function (s) { lines.push('--- ' + s.type + ' (' + s.url + ') ---', JSON.stringify(s.extractedSections, null, 2)); });
  }

  lines.push('', 'THE WHOLE PAGE, in order (the nav links to these by href="#<id>"; every section\'s root element carries id="<id>"):',
    JSON.stringify(fullList.map(function (s) { return { id: s.id, kind: s.kind, purpose: s.purpose, layout: s.layout }; }), null, 2));
  if (write.length < fullList.length) {
    lines.push('', 'In THIS answer write ONLY these sections, in this order — the others are being written at the same moment from this same brief, to the same rules: ' + JSON.stringify(write));
  } else {
    lines.push('', 'Write every one of these sections.');
  }
  /* written again because its heading repeated another's (repeatedHeadingIds): the headings it must not take */
  if (payload.takenHeadings && payload.takenHeadings.length) {
    lines.push('', 'HEADINGS ALREADY ON THE PAGE — give the sections you write here headings of their own, never these words again: ' + JSON.stringify(payload.takenHeadings));
  }

  lines.push('',
    'Make each section substantial: use the material fully — real headings, real explanatory text, real lists — and build it out with the care of a finished site. A heading with one line under it is not a section.',
    '',
    'For each section with kind "custom" (including nav/hero/footer): write real, grounded text directly into the html — there is no separate content-fill step, content and markup are generated together.',
    '',
    'For a section with one of the data-bound kinds (speakers/sessions/faq/partners/contact/glimpses): design the section\'s own visual container and any intro/heading copy with real text, but the REPEATING list items are real records a human CMS editor manages elsewhere — never yours to invent. Write exactly ONE well-designed example item, marked with the attribute data-rv-repeat-template="<kind>" on its root element, with clearly-labeled placeholder values (e.g. "Speaker Name", "Role, Company") — that is the ONLY item you write; a client-side mechanism clones or replaces it once real records exist, or leaves this one placeholder item visible as-is when none do. Its container must lay the clones out well however many there are (a responsive grid: repeat(auto-fill, minmax(…, 1fr))). Inside that one template element, put these EXACT, case-sensitive data-rv-field attributes on the right descendant elements, by kind — never invent other field names:',
    '  speakers: data-rv-field="n" (name, text), "r" (role/title, text), "c" (company, text), "photo" (headshot — on an <img>, or on a div meant to show a background-image photo)',
    '  sessions (the agenda): data-rv-field="time" (e.g. "9:30 AM – 10:15 AM", text), "title" (text), "desc" (text), "speakers" (the speakers\' names, text), "room" (text). An agenda of more than one day is shown ONE DAY AT A TIME: the page puts a row of day tabs ("Day 1", its date) above the list itself — so write no day headings, day columns or day tabs of your own, only the one session item in a list that reads well for a single day.',
    '  faq: data-rv-field="t" (question, text), "d" (answer, text)',
    '  partners: data-rv-field="name" (text), "url" (the href target if the item is/contains a link — put this on the <a>), "logo" (on an <img>)',
    '  contact: data-rv-field="label" (e.g. department/role, text), "name" (text), "email" (text), "phone" (text)',
    '  glimpses: data-rv-field="imageUrl" (on an <img>), "caption" (text)',
    'In such a template item an <img> has no src attribute at all (its picture comes from the record).',
    'Placeholder values must be unmistakably placeholders — "Contact name", "name@example.com", "+00 00000 00000", "Question goes here" — never a plausible-looking name, e-mail address, phone number or web domain. Anywhere on the site: never write an e-mail address, phone number, web address, street address, price, deadline or statistic that is not in the material above. Do not invent a domain name for the event.',
    'Example snippet (speakers): <div class="speaker-card" data-rv-repeat-template="speakers"><img data-rv-field="photo" alt=""><h4 data-rv-field="n">Speaker Name</h4><p data-rv-field="r">Role</p><p data-rv-field="c">Company</p></div>',
    '',
    'HTML rules, every section: ONE root element carrying id="<section id>", no <html>/<body>/<head> wrapper, no <script> tags, no inline event handler attributes, no javascript: URIs, no <iframe>/<object>/<embed>.',
    'CSS rules, every section: write plain class selectors for the classes you used in that section\'s html, including one for the root element itself (its background, padding and layout belong on the root\'s own class). Prefix every class with the section id so that names never collide between sections. Do NOT write [data-rv-section] in any selector and do not style html, body or :root — the server confines every rule to its section, and the root element is the positioning context for anything absolutely positioned inside it. No @import, no url(javascript:...), no CSS behaviors.',
    '',
    'positioningNotes: internal only, never shown on the site. Name the ONE specific thing you adapted FROM a competitor (or state "no competitor material was given" if none was provided) and the ONE specific thing you deliberately did NOT just carry over from this event\'s own previous edition. Be concrete (name the competitor/section), not generic.'
  );
  return lines.join('\n');
}

/* A written section's styles shorter than this are none at all: its words would show as bare text */
var UNSTYLED_CSS_CHARS = 80;
/* the planned sections (written by the model, not built here) that came back with no styles, with an empty
   picture box, or not at all */
function unstyledSectionIds(answers, designPlan) {
  var got = {};
  (answers || []).forEach(function (r) {
    ((r && r.parsed && r.parsed.sections) || []).forEach(function (s) { if (s && s.id) got[slugifyId(s.id)] = s; });
  });
  return ((designPlan && designPlan.sections) || []).filter(function (p) { return p && p.id && !p.prebuilt; }).map(function (p) { return p.id; })
    .filter(function (id) { var s = got[id]; return !s || String(s.css || '').trim().length < UNSTYLED_CSS_CHARS || emptyPictureBox(s.html, s.css); });
}
/* a box named for a picture with nothing in it and no picture behind it in the CSS: a blank block on the page.
   An empty box whose class is given a background picture (url(...)) is a picture, and an overlay or veil is not
   meant to hold one. */
function emptyPictureBox(html, css) {
  var re = /<(div|figure|aside)\b[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>\s*<\/\1>/gi, m, styles = String(css || '');
  while ((m = re.exec(String(html || '')))) {
    var names = m[2].split(/\s+/).filter(Boolean);
    if (!names.some(function (n) { return /(media|image|img|photo|picture|visual)/i.test(n) && !/(overlay|veil|shade|scrim|gradient|glow|tint)/i.test(n); })) continue;
    var painted = names.some(function (n) {
      var rule = new RegExp('\\.' + n.replace(/[^\w-]/g, '\\$&') + '(?![\\w-])[^{]*\\{[^}]*url\\(', 'i');
      return rule.test(styles);
    });
    if (!painted) return true;
  }
  return false;
}
function writtenSections(answers) {
  var got = {};
  (answers || []).forEach(function (r) {
    ((r && r.parsed && r.parsed.sections) || []).forEach(function (s) { if (s && s.id) got[slugifyId(s.id)] = s; });
  });
  return got;
}
/* the planned sections (written by the model) whose heading repeats one before it on the page: the hero's line,
   or an earlier section's heading. The sections are written in several answers at once and could not see each
   other (Agentic Summit: "Not more AI. Better AI." over its overview and the next section). The first keeps it. */
function repeatedHeadingIds(answers, designPlan) {
  var got = writtenSections(answers), seen = {};
  var tagline = headingWords('<h2>' + String((designPlan && designPlan.design && designPlan.design.heroTagline) || '').replace(/</g, ' ') + '</h2>');
  if (tagline) seen[tagline] = 1;
  return ((designPlan && designPlan.sections) || []).filter(function (p) { return p && p.id && !p.prebuilt; }).map(function (p) { return p.id; })
    .filter(function (id) {
      var w = got[id] ? headingWords(got[id].html) : '';
      if (!w) return false;
      if (seen[w]) return true;
      seen[w] = 1;
      return false;
    });
}
/* the headings a section written again must not take: every other written section's, and the hero's line.
   -> { shown: [as written], words: [as compared] } */
function takenHeadings(answers, designPlan, rewriting) {
  var got = writtenSections(answers), shown = [], words = [];
  function take(text, w) { if (w && words.indexOf(w) === -1) { words.push(w); shown.push(text); } }
  var tagline = String((designPlan && designPlan.design && designPlan.design.heroTagline) || '').replace(/\s+/g, ' ').trim();
  take(tagline, headingWords('<h2>' + tagline.replace(/</g, ' ') + '</h2>'));
  Object.keys(got).forEach(function (id) { if (rewriting.indexOf(id) === -1) take(headingText(got[id].html), headingWords(got[id].html)); });
  return { shown: shown, words: words };
}

// Matches Gemini's returned sections back to the planned id list (nav/hero + designPlan.sections + footer),
// in planned order — drops any returned section whose id isn't a planned one, and logs (never fails the
// request over) any planned section Gemini's response left out, same "degrade, never crash" discipline as
// every other best-effort AI step in this file.
function sanitizeSectionCodeResult(parsed, designPlan) {
  /* the nav and the footer are built by the server afterwards (et-nav.js, et-footer.js), in the page's final order */
  var plannedList = [{ id: 'hero', kind: 'hero' }]
    .concat((designPlan.sections || []).filter(function (s) { return !s.prebuilt; }).map(function (s) { return { id: s.id, kind: s.kind }; }));

  var returnedMap = {};
  (Array.isArray(parsed.sections) ? parsed.sections : []).forEach(function (s) {
    if (!s) return;
    var id = slugifyId(s.id);
    if (id) returnedMap[id] = s;
  });

  var sections = [];
  plannedList.forEach(function (p) {
    var found = returnedMap[p.id];
    if (!found) {
      console.error('generate-content: planned section "' + p.id + '" is missing from Gemini\'s response, omitting it rather than failing the whole page.');
      return;
    }
    /* tidied here; made safe (safeGeneratedSection) once its pictures are addresses again, before it is stored */
    var html = tidyGeneratedSectionHtml(String(found.html || ''));
    /* no text below the smallest readable size, and no heading above the site's type scale, whatever was
       written (the hero keeps its own type) */
    var css = genDesign.clampFontSizes(tidyGeneratedSectionCss(String(found.css || '')));
    if (p.id !== 'hero') css = genDesign.capHeadingSizes(css, html);
    sections.push({ id: p.id, kind: p.kind, html: html, css: css });
  });
  return sections;
}

/* BE-031: the planned sections the model was to write (not those built here from records) that are not in the site,
   or are there with nothing in them. -> [id] */
function missingSectionIds(sections, designPlan) {
  var have = {};
  /* a section is there when its markup has an element in it: the model's empty string or bare words are not one */
  (sections || []).forEach(function (s) { if (s && s.id && /<[a-z]/i.test(String(s.html || ''))) have[s.id] = 1; });
  return ((designPlan && designPlan.sections) || []).filter(function (p) { return p && p.id && !p.prebuilt; })
    .map(function (p) { return p.id; }).filter(function (id) { return !have[id]; });
}
/* the failure in the owner's words: the sections by the names the plan gave them */
function missingSectionsSentence(ids, designPlan) {
  var names = ids.map(function (id) {
    var p = ((designPlan && designPlan.sections) || []).filter(function (x) { return x && x.id === id; })[0];
    return '“' + String((p && p.name) || id.replace(/-/g, ' ')).trim() + '”';
  });
  var list = names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  /* short enough for Create Event to show as it is (its rows show a server's sentence of up to 140 characters) */
  return 'ETB2B AI did not write ' + (names.length === 1 ? 'the ' + list + ' section' : list) + '. Nothing was saved — retry.';
}

/* The site is written in two calls side by side once it has more than a few sections: each answer is
   smaller, so neither runs into the time one call may take, and the page is ready sooner. Both are shown
   the whole plan and the same rules. -> [[ids], [ids]] or [[ids]] */
var SECTION_CODE_SPLIT_ABOVE = 5;
/* Claude writes at a steadier, slower pace than Gemini: asked first, it is given two sections a call, all
   calls side by side, so that each answer is ready well inside its time. */
var SECTION_CODE_CLAUDE_BATCH = 2;
function sectionCodeBatches(designPlan, skip) {
  /* every section but the hero and the nav, which are built here (genDesign.heroHtml, et-nav.js) — and but those in
     skip (a run's sections already written by an earlier try of it: BE-030) */
  var ids = plannedSectionList(designPlan).map(function (s) { return s.id; }).filter(function (id) { return id !== 'hero' && id !== 'nav' && !(skip && skip.indexOf(id) !== -1); });
  if (llm.activeProvider() === 'claude') {
    var small = [];
    for (var i = 0; i < ids.length; i += SECTION_CODE_CLAUDE_BATCH) small.push(ids.slice(i, i + SECTION_CODE_CLAUDE_BATCH));
    return small.length ? small : [ids];
  }
  if (ids.length <= SECTION_CODE_SPLIT_ABOVE) return [ids];
  var cut = Math.ceil(ids.length / 2);
  return [ids.slice(0, cut), ids.slice(cut)];
}

/* An overview with too little in it to fill its layout gets a picture made from what it says (the owner, 28 Oct
   2026: Digiplus Awards 2027's overview was one short line in half its width, beside two paragraphs). A written
   overview with no picture of its own and fewer words than this is one. -> its words, or '' */
var SPARSE_OVERVIEW_CHARS = 900;
function sparseOverviewText(answers, designPlan) {
  var planned = ((designPlan && designPlan.sections) || []).filter(function (s) { return s && s.id === 'overview'; })[0];
  if (!planned || planned.prebuilt || planned.imageUrl || (planned.photos || []).length) return '';
  var written = null;
  (answers || []).forEach(function (r) {
    ((r && r.parsed && r.parsed.sections) || []).forEach(function (s) { if (s && slugifyId(s.id) === 'overview') written = s; });
  });
  if (!written) return '';
  var html = String(written.html || ''), css = String(written.css || '');
  if (/<(img|video|picture)\b/i.test(html) || /url\(/i.test(css)) return '';
  var text = stripToText(html).replace(/\s+/g, ' ').trim();
  return text && text.length < SPARSE_OVERVIEW_CHARS ? text : '';
}
/* The picture for it, made in the site's picture style (no people: the overview is not a section about people),
   and the overview written once more with it in the half its words leave empty. Never fails the run: anything
   that does not come leaves the overview as it was written. -> Promise<{ answers, designPlan }> */
function fillSparseOverview(fb, eventId, answers, designPlan, ctx) {
  var text = sparseOverviewText(answers, designPlan);
  if (!text) return Promise.resolve({ answers: answers, designPlan: designPlan });
  var design = designPlan.design || {}, eventMeta = ctx.eventMeta || {};
  var kinds = (designPlan.sections || []).map(function (s) { return s.imageKind; }).filter(function (k) { return k && k !== 'people'; });
  var kind = kinds.indexOf('graphic') !== -1 && kinds.filter(function (k) { return k === 'graphic'; }).length * 2 >= kinds.length ? 'graphic' : 'subject';
  var subject = 'what this overview says, shown through the objects, work and setting of the event\'s own field: ' + text.slice(0, 400);
  var about = [eventMeta.name, (ctx.brief && ctx.brief.theme) || eventMeta.description, [eventMeta.venue, eventMeta.city].filter(Boolean).join(', ')]
    .map(function (v) { return String(v || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(' — ').slice(0, 400);
  var stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  var level = designPlan.owner && designPlan.owner.level ? designPlan.owner.level : '';
  console.warn('generate-content: ' + eventId + ' — the overview is sparse (' + text.length + ' characters, no picture): a picture is made for it');
  return buildSectionImage(fb, eventId, 'overview', subject, design, stamp, 'It illustrates the overview of the event\'s website (for your understanding only — none of these words may be written in the picture).', about, level, kind).then(function (made) {
    if (!made) return { answers: answers, designPlan: designPlan };
    var plan = Object.assign({}, designPlan, { sections: designPlan.sections.map(function (s) {
      if (s.id !== 'overview') return s;
      return Object.assign({}, s, { image: 'the event\'s field, as the overview describes it', imageKind: kind, imageUrl: made.url,
        layout: String(s.layout || '').trim() + ' The picture fills the side of the section that its words leave empty; nothing stands alone in a half-empty column.' });
    }) });
    var prompt = buildSectionCodePrompt(Object.assign({}, ctx.prompt, { designPlan: plan, write: ['overview'] }));
    return llm.callJson(prompt, SECTION_CODE_SCHEMA, { timeoutMs: 100000, route: 'generate-content', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.site, onUsage: aiUsageRecorder(fb, eventId, 'generate-content') }).then(function (r) {
      var again = r && !r.error && r.parsed && Array.isArray(r.parsed.sections)
        ? r.parsed.sections.filter(function (s) { return s && slugifyId(s.id) === 'overview' && String(s.css || '').trim().length >= UNSTYLED_CSS_CHARS && /<img\b/i.test(String(s.html || '')) && !emptyPictureBox(s.html, s.css); })[0]
        : null;
      if (!again) return { answers: answers, designPlan: designPlan };
      return {
        designPlan: plan,
        answers: answers.map(function (a) {
          return Object.assign({}, a, { parsed: Object.assign({}, a.parsed, { sections: ((a.parsed && a.parsed.sections) || []).filter(function (s) { return !s || slugifyId(s.id) !== 'overview'; }) }) });
        }).concat([{ parsed: { sections: [again] } }])
      };
    }, function () { return { answers: answers, designPlan: designPlan }; });
  });
}

// The gen- branch's own tail, deliberately separate from runGenerateContent above (see this block's own
// header comment for why) — reads brief/sources for sourceEventId exactly like runGenerateContent does,
// builds the prompt from designPlan, calls Gemini, sanitizes, and stores the sections in documents of the run's
// own (generated-site.js), the event switching to them in one write (BE-032: not on the event's document).
// Also still writes a `drafts` row (library: {} deliberately empty) purely so GET /api/draft's existing
// draftId/staleness-tracking machinery keeps working for this event — see this function's call site for the
// full reasoning.
/* run: { runId, fromRun (the plan is the run's own, kept by plan-structure), described (the event description written
   with that plan), ownInputs (read only this run's brief and pages) } — see generated-site.js. The event's site is
   switched in one write once every section is written; a run overtaken by a newer one, or whose caller has gone
   (Cancel, a closed tab), changes nothing. */
function runGenerateDesignedContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, designPlan, by, run) {
  run = run || {};
  /* a plan made before sponsors were put first is written in today's order (section-order.js) */
  designPlan = Object.assign({}, designPlan, { sections: sectionOrder.sponsorsFirst(designPlan.sections) });
  var draftRef = fb.db.collection('events').doc(eventId);
  var sourceRef = fb.db.collection('events').doc(sourceEventId);
  var watch = null, overviewPictured = false;
  /* the person who asked is still waiting for the answer: one who stopped (the wizard's Cancel aborts the request) or
     left is not given a site they no longer expect (WZ-055) */
  var callerGone = false;
  if (res && typeof res.on === 'function') res.on('close', function () { if (!res.writableEnded) callerGone = true; });
  var ownInputs = !!(run.ownInputs && run.runId && sourceEventId === eventId);
  /* BE-030 / BE-033: within a run, every answer the model gives is kept with the run as soon as it comes back
     (generated-site.js keepWritten), and the run's record says how far the step is (GET /api/generate/status). A try
     of the same run after one that failed, or whose caller left (a reload), asks only for the sections not kept yet.
     A run found stopped (or its event removed) while an answer is kept is not asked anything more. */
  var keepRun = !!run.runId, planKey = keepRun ? generatedSite.planKey(designPlan) : '', halted = '';
  /* this request's try of the run: one try writes a run at a time (keepWritten's claim) */
  var tryId = crypto.randomBytes(4).toString('hex');
  function keep(list, writing, claim) {
    if (!keepRun || !watch) return Promise.resolve('');
    return generatedSite.keepWritten(watch.within, fb, eventId, run.runId, planKey, list, writing, { tryId: tryId, claim: !!claim }).then(function (how) {
      if (how === 'stopped' || how === 'gone') halted = how;
      return how;
    });
  }
  function haltIfStopped() {
    if (halted === 'stopped') throw httpError(409, RUN_STOPPED, { code: 'run-stopped' });
    if (halted === 'gone') throw httpError(409, 'This event was removed while this was running, so nothing was saved.', { code: 'event-gone' });
  }
  /* the sections of one answer that it was asked for and that have markup, as kept */
  function keptOf(r, ids) {
    if (!r || r.error || !r.parsed || !Array.isArray(r.parsed.sections)) return [];
    return r.parsed.sections.filter(function (s) { return s && ids.indexOf(slugifyId(s.id)) !== -1 && /<[a-z]/i.test(String(s.html || '')); })
      .map(function (s) { return { id: slugifyId(s.id), html: String(s.html || ''), css: String(s.css || '') }; });
  }
  watchEvent(fb, eventId).then(function (w) {
    watch = w;
    return Promise.all([
      sourceRef.get(),
      /* this run's own brief and pages (WZ-034); a future edition's, its series' own as recorded */
      generatedSite.inputs(fb, sourceEventId, ownInputs ? run.runId : ''),
      /* what an earlier try of this run, for this same plan, was given already */
      keepRun ? generatedSite.readWritten(fb, eventId, run.runId, planKey) : null
    ]);
  }).then(function (results) {
    var eventSnap = results[0], read = results[1];
    var kept = results[2] || { sections: [], checked: false, overviewPlan: null, overviewDone: false };
    var keptIds = kept.sections.map(function (s) { return s.id; });
    /* an overview an earlier try pictured (fillSparseOverview): its planned entry with the picture, as that try left it */
    if (kept.overviewPlan && keptIds.indexOf('overview') !== -1) {
      designPlan = Object.assign({}, designPlan, { sections: designPlan.sections.map(function (s) { return s.id === 'overview' ? Object.assign({}, s, kept.overviewPlan) : s; }) });
      overviewPictured = true;
    }
    var stored = eventSnap.exists ? eventSnap.data() : {};
    var eventMeta = eventFacts(stored, payload.eventMeta);
    var logoUrl = /^https:\/\//i.test(String(stored.logoUrl || '')) ? stored.logoUrl : '';
    var brief = read.brief;
    var sourceDocs = read.sourceDocs;
    var sources = sourceDocs.map(function (v) {
      return { type: v.type, url: v.url, extractedSections: v.extractedSections };
    });
    /* the footer's "What's Happening" is read from ET while the site is being written. The bar and the footer
       are the portal of the event this site is for (watchEvent read its document), not of the one the brief
       and sources may be read from (sourceEventId) */
    var footerOf = sitePortalOf({ portal: watch.portal }, sourceDocs);
    var footerRead = footerEvents(footerOf.portal);

    // 100s, not the 60s default — writing full bespoke HTML/CSS is a genuinely bigger generation job than
    // any other call this file makes. A timeout is never retried (gemini.js), so 100s is also the longest
    // this request can spend on the model: the calls of a split site run side by side, not one after another.
    /* only the sections no earlier try of this run was given (BE-030) */
    var batches = sectionCodeBatches(designPlan, keptIds).filter(function (ids) { return ids.length; });
    if (keptIds.length) console.log('generate-content: ' + eventId + ' — run ' + run.runId + ' already has ' + keptIds.length + ' sections; asking for ' + batches.reduce(function (n, b) { return n + b.length; }, 0) + ' more');
    /* the run's record says its pages are being written, before any of them is asked for — and by this request: one
       that finds another request still writing the same run (a page reloaded a moment ago, a second tab) asks for
       nothing and answers 409 run-busy, to wait for that one (GET /api/generate/status) */
    var writingMarked = keep([], { state: 'writing', startedAt: new Date().toISOString(),
      planned: sectionCodeBatches(designPlan).reduce(function (all, b) { return all.concat(b); }, []) }, true).then(function (how) {
      if (how === 'busy') throw httpError(409, 'The pages of this run are still being written. Wait a moment.', { code: 'run-busy', retryable: true });
    });
    /* an award site: the words of its internal pages, written beside the sections (writeAwardPages) */
    /* (once this request holds the run: a try that is turned away pays for nothing) */
    var awardRead = designPlan.siteMode === 'award'
      ? writingMarked.then(function () { return writeAwardPages(fb, eventId, stored, sourceDocs, brief, eventMeta); }, function () { return null; }).then(function (a) {
        if (!a) return null;
        /* its Nomination form (a Category list from its categories) and its Express Interest form
           (api-forms.js createAwardForms: reused when they exist, their categories brought up to date) */
        return require('./api-forms').createAwardForms(fb, eventId, { categories: a.award.categories, nominateTitle: 'Nomination', by: by })
          .then(function (ids) { a.forms = ids; return a; }, function (err) {
            console.error('generate-content: the award forms of ' + eventId + ' were not made — ' + (err && err.message));
            a.forms = {}; return a;
          });
      })
      : Promise.resolve(null);
    return writingMarked.then(function () {
      haltIfStopped();
      return Promise.all(batches.map(function (ids) {
        var prompt = buildSectionCodePrompt({ eventMeta: eventMeta, brief: brief, sources: sources, designPlan: designPlan, futureEdition: futureEdition, logoUrl: logoUrl, write: ids });
        return llm.callJson(prompt, SECTION_CODE_SCHEMA, { timeoutMs: 100000, route: 'generate-content', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.site, onUsage: aiUsageRecorder(fb, eventId, 'generate-content') })
          /* kept the moment it comes back: a batch that failed beside it does not cost this one (BE-030) */
          .then(function (r) { var mine = keptOf(r, ids); return mine.length ? keep(mine, {}).then(function () { return r; }) : r; });
      }));
    }).then(function (fresh) {
      haltIfStopped();
      /* what earlier tries kept, after this try's answers (which are kept to the sections they were asked for) */
      var answers = !keptIds.length ? fresh : fresh.map(function (a) {
        if (!a || a.error || !a.parsed) return a;
        return Object.assign({}, a, { parsed: Object.assign({}, a.parsed, { sections: (a.parsed.sections || []).filter(function (s) { return !s || keptIds.indexOf(slugifyId(s.id)) === -1; }) }) });
      }).concat([{ parsed: { sections: kept.sections, positioningNotes: '' } }]);
      /* a section that came back without its styles (or not at all) shows as bare text on the page: it is
         written once more on its own, and the second answer replaces the first */
      var failedAnswer = answers.some(function (r) { return r.error; });
      var again = failedAnswer ? [] : unstyledSectionIds(answers, designPlan);
      /* a section whose heading repeats one before it is written again too, told which headings are taken */
      var repeated = failedAnswer ? [] : repeatedHeadingIds(answers, designPlan);
      /* …but not one an earlier try of this run has already been through this with (BE-030) */
      if (kept.checked) {
        again = again.filter(function (id) { return keptIds.indexOf(id) === -1; });
        repeated = repeated.filter(function (id) { return keptIds.indexOf(id) === -1; });
      }
      repeated.forEach(function (id) { if (again.indexOf(id) === -1) again.push(id); });
      if (!again.length) { if (!failedAnswer) keep([], { checked: true }); return answers; }
      var taken = takenHeadings(answers, designPlan, again);
      console.warn('generate-content: ' + eventId + ' — written again, unstyled, missing or with a repeated heading: ' + again.join(', '));
      var prompt = buildSectionCodePrompt({ eventMeta: eventMeta, brief: brief, sources: sources, designPlan: designPlan, futureEdition: futureEdition, logoUrl: logoUrl, write: again, takenHeadings: taken.shown });
      return llm.callJson(prompt, SECTION_CODE_SCHEMA, { timeoutMs: 100000, route: 'generate-content', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.site, onUsage: aiUsageRecorder(fb, eventId, 'generate-content') })
        .then(function (r) {
          if (r.error || !r.parsed || !Array.isArray(r.parsed.sections)) return keep([], { checked: true }).then(function () { return answers; });
          /* a second answer replaces the first only when it is better: styled, no empty picture box and — for a
             repeated heading — a heading of its own this time */
          var fixed = r.parsed.sections.filter(function (s) {
            return s && again.indexOf(slugifyId(s.id)) !== -1 && String(s.css || '').trim().length >= UNSTYLED_CSS_CHARS && !emptyPictureBox(s.html, s.css) &&
              (repeated.indexOf(slugifyId(s.id)) === -1 || taken.words.indexOf(headingWords(s.html)) === -1);
          });
          var ids = fixed.map(function (s) { return slugifyId(s.id); });
          /* the better answers are kept in place of the first ones, and the run is marked checked (BE-030) */
          return keep(keptOf({ parsed: { sections: fixed } }, ids), { checked: true }).then(function () {
            return answers.map(function (a) {
              return Object.assign({}, a, { parsed: Object.assign({}, a.parsed, { sections: (a.parsed.sections || []).filter(function (s) { return !s || ids.indexOf(slugifyId(s.id)) === -1; }) }) });
            }).concat([{ parsed: { sections: fixed } }]);
          });
        }, function () { return answers; });
    }).then(function (answers) {
      haltIfStopped();
      /* an overview too thin for its layout gets a picture made from its words, and is written again with it — once
         a run: an earlier try of it that did this (or found no need) is not done again (BE-030) */
      if (answers.some(function (r) { return r.error; }) || kept.overviewDone) return answers;
      return fillSparseOverview(fb, eventId, answers, designPlan, {
        eventMeta: eventMeta, brief: brief,
        prompt: { eventMeta: eventMeta, brief: brief, sources: sources, futureEdition: futureEdition, logoUrl: logoUrl }
      }).then(function (r) {
        var pictured = r.designPlan !== designPlan;
        if (pictured) { designPlan = r.designPlan; overviewPictured = true; }
        /* the overview written again with its picture is kept with its planned entry, which carries the picture */
        var entry = pictured ? designPlan.sections.filter(function (s) { return s.id === 'overview'; })[0] : null;
        var again = pictured ? keptOf(r.answers[r.answers.length - 1], ['overview']) : [];
        return keep(again, { overviewDone: true, overviewPlan: entry && again.length ? { image: entry.image, imageKind: entry.imageKind, imageUrl: entry.imageUrl, layout: entry.layout } : null })
          .then(function () { return r.answers; });
      });
    }).then(function (answers) {
      return Promise.all([footerRead, awardRead]).then(function (both) { return { answers: answers, footerList: both[0], award: both[1] }; });
    }).then(function (got) {
      var answers = got.answers;
      var failed = answers.filter(function (r) { return r.error; })[0];
      /* what this try wrote is kept with the run: Retry (the same run) asks only for the rest (BE-030) */
      if (failed) return keep([], { state: 'failed' }).then(function () { sendAiFailure(res, failed); });
      var written = [];
      answers.forEach(function (r) { written = written.concat(Array.isArray(r.parsed.sections) ? r.parsed.sections : []); });
      var design = designPlan.design || {};
      var planned = designPlan.sections || [];
      /* The hero is built here, to the one pattern every ET event site has. Its buttons go to what the
         page really has: registration to the contact section (or the footer), partnership to the partners
         section when there is one. */
      function firstOf(kind) { return planned.filter(function (x) { return x.kind === kind; })[0]; }
      var contact = firstOf('contact'), partners = firstOf('partners');
      var place = [eventMeta.venue, eventMeta.city].filter(function (v, i, list) { return v && list.indexOf(v) === i; }).join(', ') || eventMeta.location || '';
      /* a lock-up taken from the previous edition was drawn for a dark or a light banner: the hero is that */
      var heroMode = design.logoUnitUrl && /^(dark|light)$/.test(String(design.logoUnitHeroMode)) ? design.logoUnitHeroMode : design.mode;
      /* a dark site whose lock-up was drawn for light shows its dark-ground copy (storeOnDarkUnit), on a dark banner;
         a light banner keeps the copy beside its own, for a dark theme (gen-base.css) */
      var unitUrl = design.logoUnitUrl, unitDarkUrl = '';
      /* only a copy made of this unit: one made of an earlier logo is never shown in its place (darkCopyOfUnit) */
      if (heroMode === 'light' && design.logoUnitDarkUrl && darkCopyOfUnit(design)) {
        if (design.mode === 'dark') { heroMode = 'dark'; unitUrl = design.logoUnitDarkUrl; } else unitDarkUrl = design.logoUnitDarkUrl;
      }
      var heroOpts = {
        /* the unit as one picture (the logo the owner uploaded, the previous edition's, or the one drawn for
           this event — buildLogoUnit); set in type only when no picture could be made */
        unit: genDesign.logoUnitImageHtml({ url: unitUrl, alt: eventMeta.name, width: design.logoUnitWidth, height: design.logoUnitHeight, plate: design.logoUnitPlate, note: design.logoUnitNote, mode: heroMode, darkUrl: unitDarkUrl }) ||
          genDesign.logoUnitHtml(design.logoUnit || genDesign.logoUnitParts(eventMeta.name), design.mode, design.logoUnitNote),
        tagline: design.heroTagline, date: eventMeta.dateLabel || eventMeta.date || genDesign.dateLabel(stored.start, stored.end), place: place,
        /* with no hero picture there is no veil to make that tone: the banner is painted in it */
        banner: heroMode !== design.mode && !design.heroImageUrl ? (heroMode === 'dark' ? '#0d1017' : '#ffffff') : '',
        mode: heroMode, cornerRadius: design.cornerRadius, themeColor: design.themeColor, image: design.heroImageUrl || '',
        /* the owner's main action leads (owner-brief.js); with none, Register and Join as Partner as always */
        primary: null, secondary: null
      };
      var heroButtons = ownerBrief.buttons(designPlan.owner || (brief && brief.owner), { register: contact ? contact.id : 'footer', partner: partners ? partners.id : '' });
      /* an award site's main button follows the award (rv-award-cta.js): Express Interest, Nominate Now, Winners
         will be announced soon, View Winners — by the visitor's date; its second goes to the categories page */
      if (got.award) {
        var ad = got.award.award.dates || {}, af = got.award.forms || {};
        heroButtons = {
          primary: { label: 'Nominate Now', href: '#hero', award: { open: ad.nominationOpen, close: ad.nominationClose, ceremony: ad.ceremony,
            nominateForm: af.nominateFormId || '', interestForm: af.interestFormId || '', winnersHref: '' } },
          secondary: (got.award.award.categories || []).length
            ? (SITE_PAGES ? { label: 'View Categories', href: 'award-category', page: 'award-category' } : { label: 'View Categories', href: '#award-categories' })
            : heroButtons.secondary
        };
      }
      heroOpts.primary = heroButtons.primary; heroOpts.secondary = heroButtons.secondary;
      written.push({ id: 'hero', html: genDesign.heroHtml(heroOpts), css: genDesign.heroCss(heroOpts) });

      var sections = sanitizeSectionCodeResult({ sections: written }, designPlan);
      /* BE-031: a planned section the model did not write, even when asked once more on its own (above), is a failed
         generation — said, never dropped in silence: nothing is saved and the wizard's row offers Retry */
      var missing = missingSectionIds(sections, designPlan);
      if (missing.length) {
        console.error('generate-content: ' + eventId + ' — not written, so nothing was saved: ' + missing.join(', '));
        return keep([], { state: 'failed' }).then(function () {
          sendJson(res, 502, { error: missingSectionsSentence(missing, designPlan), code: 'ai-bad-output', retryable: true, missing: missing });
        });
      }
      /* Pictures were named to the model by short tokens; here they become addresses again, and any picture
         address that is not one of this site's is repaired (genDesign.restorePictures). The event's own
         logo is in the top bar whatever was written. */
      var pictures = {};
      planned.forEach(function (x) {
        if (x.imageUrl) pictures[genDesign.pictureToken(x.id)] = x.imageUrl;
        (x.photos || []).forEach(function (u, i) { pictures[genDesign.pictureToken('photo-' + x.id + '-' + (i + 1))] = u; });
      });
      if (logoUrl) pictures[genDesign.pictureToken('logo')] = logoUrl;
      if (design.heroImageUrl) pictures[genDesign.pictureToken('hero')] = design.heroImageUrl;
      sections.forEach(function (sec) {
        if (sec.id === 'hero') return;                               // built above, from real addresses
        var own = pictures[genDesign.pictureToken(sec.id)] || '';
        sec.html = genDesign.restorePictures(sec.html, pictures, own);
        sec.css = genDesign.restorePictures(sec.css, pictures, own);
        /* The Economic Times Business Verticals logo, in the version for the site's tone */
        if (sec.id === 'nav') sec.html = genDesign.ensureEtLogo(sec.html, design.mode, sec.id);
        if (sec.id === 'nav') sec.html = genDesign.capNavLinks(sec.html);
      });
      /* BE-043: what the model wrote that nothing this event supplied supports (lib/invented-facts.js) — an e-mail or a
         phone number becomes the placeholder the check before publishing holds back; figures, claims, partners,
         addresses and web addresses are logged here and listed by the console's site check while they are on the page.
         The banner, and every section built below from the event's records, are the server's own. */
      /* never a reason to lose a whole site: a check that fails leaves the sections as written, and says so */
      try {
        var facts = inventedFacts.checkSections(sections, inventedFacts.groundOf(eventMeta, stored.description, brief,
          sources.filter(function (x) { return x.type !== 'competitor'; }), designPlan.ownerNotes, designPlan.owner,
          sourceDocs.map(function (v) { return v.type === 'previousEdition' ? inventedFacts.previousFacts(v.previous) : []; })), TOKEN_KIT, { fix: true });
        sections = facts.sections;
        if (facts.removed.length || facts.flagged.length) {
          console.warn('generate-content: ' + eventId + ' — facts nothing supplied: ' + inventedFacts.summary(facts) + ' ' +
            JSON.stringify(facts.removed.concat(facts.flagged).slice(0, 30)));
        }
      } catch (factsErr) { console.error('generate-content: the facts check of ' + eventId + ' failed — ' + (factsErr && factsErr.message)); }
      /* the previous edition's sections, built here from its real records (prev-sections.js), each in its
         planned place */
      var prevDoc = sourceDocs.filter(function (v) { return v.type === 'previousEdition' && v.previous; })[0];
      /* every photo a section shows: the previous edition's gallery leaves them out (no picture twice on a page) */
      var usedPhotos = [];
      planned.forEach(function (x) { if (x.imageUrl) usedPhotos.push(x.imageUrl); (x.photos || []).forEach(function (u) { usedPhotos.push(u); }); });
      if (design.heroImageUrl) usedPhotos.push(design.heroImageUrl);
      /* an award site's own sections built from its records (award-sections.js), by id */
      var awardHome = {};
      /* the previous edition's photos not shown elsewhere on the page light the award's stage panels and its calls to act */
      var awardRec = sourceDocs.filter(function (v) { return v.type === 'previousEdition' && v.award; }).map(function (v) { return v.award; })[0];
      var photoPool = (prevDoc && prevDoc.previous && prevDoc.previous.glimpses && prevDoc.previous.glimpses.length ? prevDoc.previous.glimpses : (awardRec && awardRec.glimpses) || []);
      var awardPhotos = photoPool.filter(function (u) { return usedPhotos.indexOf(u) === -1; }).slice(0, 5);
      /* the jury is the event's Speakers records (seedAwardJury): drawn into the page by the editor; the plan has its
         section only when there are jurors to show */
      var juryPlanned = planned.some(function (x) { return x.id === 'award-jury'; });
      if (got.award) awardSections.homeSections(got.award.award, { edition: eventMeta.name || '', pages: SITE_PAGES, photos: awardPhotos, bound: true, hasJury: juryPlanned,
        heroImage: design.heroImageUrl || '', dateLabel: heroOpts.date, place: place }).forEach(function (b) { awardHome[b.id] = b; });
      awardPhotos.forEach(function (u) { usedPhotos.push(u); });
      planned.filter(function (x) { return x.prebuilt; }).forEach(function (x) {
        var built = /^award-/.test(x.prebuilt) ? awardHome[x.id] || null : prevDoc ? prevSections.build(x.prebuilt, prevDoc.previous, { exclude: usedPhotos }) : null;
        if (!built) return;
        var at = sections.length - (sections.length && sections[sections.length - 1].id === 'footer' ? 1 : 0);
        var order = planned.map(function (y) { return y.id; }), mine = order.indexOf(x.id);
        for (var i = 0; i < sections.length; i++) { var o = order.indexOf(sections[i].id); if (o > mine) { at = i; break; } }
        sections.splice(at, 0, { id: x.id, kind: 'custom', html: built.html, css: genDesign.capHeadingSizes(genDesign.clampFontSizes(scopeSectionCss(built.css, x.id, sectionRootInfo(built.html))), built.html) });
      });
      /* the sponsors right after the hero whatever came back (section-order.js) */
      sections = sectionOrder.sponsorsAfterHero(sections, planned);
      /* an award site: a section's own call to act (written as a registration button) enters the award — it
         follows the award as the main button does; the awards night's stays a registration (a seat on the night) */
      if (got.award) sections.forEach(function (sec) {
        if (/^(nav|hero|footer|awards-night)$/.test(sec.id)) return;
        sec.html = String(sec.html || '').replace(/\sdata-register-cta(?=[\s>=])(?:=(?:"[^"]*"|'[^']*'))?/g, genDesign.ctaAttrs(heroButtons.primary));
      });
      /* an award site's internal pages (award-sections.js pageSections), after the home page's sections:
         each page's sections carry its slug (data-rv-page), and the page list goes with the site */
      var sitePages = [];
      if (got.award && SITE_PAGES) awardSections.PAGE_KINDS.forEach(function (k) {
        var built = awardSections.pageSections(k.kind, awardPageContent(k.kind, got.award), { edition: eventMeta.name || '', bound: true, hasJury: juryPlanned });
        if (!built.length) return;
        sitePages.push({ slug: k.slug, title: k.title });
        built.forEach(function (b) {
          sections.push({ id: b.id, kind: 'custom', page: k.slug, html: b.html,
            css: genDesign.capHeadingSizes(genDesign.clampFontSizes(scopeSectionCss(b.css, b.id, sectionRootInfo(b.html))), b.html) });
        });
      });
      /* ET's common footer, last: the portal's links and its events coming up, under a band for this event
         with its main button (et-footer.js) */
      sections = sections.filter(function (s) { return s.id !== 'footer'; });
      sections.push(siteFooter({ portal: footerOf.portal, series: footerOf.series, events: got.footerList, design: design,
        eventName: eventMeta.name, date: heroOpts.date, place: place, button: heroButtons.primary }));
      /* the top bar, built here as on ET's own event sites (et-nav.js): the portal's logo, the event's name,
         date and place, a link to every section in the page's order, the owner's main action */
      sections = sections.filter(function (s) { return s.id !== 'nav'; });
      var navFor = { order: sections.filter(function (s) { return !s.page; }).map(function (s) { return s.id; }), sources: sourceDocs, owner: designPlan.owner || (brief && brief.owner) };
      /* the bar's portal logo is the event's own portal, the footer's (sitePortalOf): et-nav.js takes it as given
         when the key is there ('' gives none), and works one out of the sources only for callers that send none */
      navFor.portal = footerOf.portal;
      /* An award site: a link to each of its internal pages, and no button at the right of the bar. That place is
         the portal's sign-in on ET's own sites; with no sign-in for the portals here, the owner had the bar's
         "Express Interest" taken away (28 Oct 2026) — the hero and the footer keep the award's button. */
      if (got.award) {
        navFor.cta = false;
        /* the page's title too: a home-section link of the same words ("Award Categories") is left out of the bar (et-nav.js repeatsPage) */
        navFor.tabs = sitePages.map(function (pg) { return { label: AWARD_TAB_LABELS[pg.slug] || pg.title, page: pg.slug, title: pg.title }; });
      }
      var navSection;
      /* never a reason to lose a whole site: a bar that cannot be made from the stored records is made from
         the event's facts alone (its portal, the default action) */
      try { navSection = etNav.sectionFor(Object.assign({}, eventMeta, { designPlan: designPlan }), navFor); }
      catch (navErr) {
        console.error('[generate-content] the ET bar for ' + eventId + ' fell back to the plain one: ' + (navErr && navErr.message));
        navSection = etNav.sectionFor(Object.assign({}, eventMeta, { designPlan: { sections: [] } }), { order: navFor.order, portal: navFor.portal });
      }
      sections.unshift(navSection);
      /* no more than two rows move on their own, never in neighbouring sections (genDesign.motionBudget) */
      genDesign.motionBudget(sections);
      /* the safety step, last, over every section stored — the model's and the ones built here around its words */
      sections = sections.map(function (s) {
        var safe = safeGeneratedSection(s.html, s.css);
        return Object.assign({}, s, { html: safe.html, css: safe.css });
      });
      var positioningNotes = answers.map(function (r) { return String(r.parsed.positioningNotes || '').trim(); }).filter(Boolean).join(' ').slice(0, 500);
      var now = new Date().toISOString();

      /* The caller stopped or left while the site was being written: the event is left as it was (the wizard's
         Cancel says nothing is kept). Within a run, what the model wrote stays kept with the run (BE-030): a page
         that was reloaded asks for the pages of the same run again, which puts them on the event without asking the
         model anything more (BE-033: the run's record says 'left'). */
      if (callerGone) {
        console.warn('generate-content: ' + eventId + ' — the request was stopped before the site was written; the event was not changed.');
        return keep([], { state: 'left' }).then(function () {});
      }
      /* BE-032: the sections go into documents of this run's own (generated-site.js), then the event switches to them
         in one write — its plan, its list of sections, the description written with the plan — so a site is never
         half the new run's and half an earlier one's. The sections no longer live on the event's document (the old
         field is removed by the same write), so it stays small whatever the site holds. */
      var commitRunId = run.runId || generatedSite.newRunId();
      var described = run.fromRun ? run.described : null, describedNow = null, describedBefore = '', hadSite = false;
      /* the event is checked first: one removed meanwhile (Create Event's Cancel removes the event its run made) gets nothing */
      /* BE-033: a run another request of it has already put on the event (it took the run over after this one fell
         silent) is not put there twice: this one answers as that one did */
      var ALREADY = { status: 200, body: { eventId: eventId, templateId: templateId, runId: commitRunId, already: true, library: {},
        sections: sections.map(function (s) { return { id: s.id, kind: s.kind }; }) } };
      var draftDoc = draftRef.collection('drafts').doc();
      return watch.stillThere()
        .then(function () { return run.runId ? generatedSite.readRun(fb, eventId, commitRunId) : null; })
        /* (its status is left as it is: a Stop that comes in meanwhile is what the switch below reads) */
        .then(function (rec) {
          if (rec && rec.status === 'done') throw ALREADY;
          return generatedSite.writeSections(fb, eventId, commitRunId, sections, { writtenAt: now });
        })
        .then(function () {
          return watch.within(function (tx, ref, snap) {
            /* the run's own record, read in the same transaction: one the person stopped is never put on the event */
            return (run.runId ? tx.get(generatedSite.runRef(fb, eventId, commitRunId)) : Promise.resolve(null)).then(function (runSnap) {
            if (runSnap && runSnap.exists && (runSnap.data() || {}).status === 'stopped') throw httpError(409, RUN_STOPPED, { code: 'run-stopped' });
            if (runSnap && runSnap.exists && (runSnap.data() || {}).status === 'done') throw ALREADY;
            var cur = snap.data() || {};
            describedNow = null;                    // a transaction may run more than once
            /* the activity log says "again" only when the event had a site written before this one (NU-025) */
            hadSite = !!(cur.generatedSite || cur.generatedAt || (Array.isArray(cur.generatedSections) && cur.generatedSections.length));
            /* BE-029: only the event's newest run puts its site on it — one that planned after this one (another
               tab, someone else) has taken the event, and this run's site is not used */
            var newest = cur.generationRun && cur.generationRun.runId;
            if (run.runId && newest && newest !== run.runId) {
              throw httpError(409, 'A newer run for this event was started elsewhere, so this one was not saved. Generate again to replace it.', { code: 'run-superseded' });
            }
            /* generatedAt is what a list reads to know this event has a generated site, without reading the site */
            var patch = { generatedSite: generatedSite.pointer(commitRunId, sections, now), generatedPages: sitePages, generatedAt: now,
              generationRun: { runId: commitRunId, at: now, done: true }, generatedBy: actorOf(by) };
            if (Array.isArray(cur.generatedSections)) patch.generatedSections = fieldDelete();
            /* the run's own plan becomes the event's, with what the earlier pipeline kept cleared, and the description
               written with it (only where it was empty or the owner's raw brief: event-description.js) */
            if (run.fromRun) {
              patch.designPlan = designPlan; patch.matchedTemplateId = null; patch.structurePlan = null; patch.theme = null;
              /* …and only while the description is still what it was then: one the owner has written meanwhile stays */
              if (described && described.description && String(cur.description || '') === String(described.from || '')) {
                patch.description = described.description;
                describedNow = described.description; describedBefore = String(cur.description || '');
              }
            /* the event's own plan: only what this step changed in it — the overview's picture (fillSparseOverview) */
            } else if (overviewPictured) patch['designPlan.sections'] = designPlan.sections;
            /* an award site's internal pages' words, kept until the site can have pages (SITE_PAGES) */
            if (got.award) patch.awardPages = got.award.pages;
            tx.update(ref, patch);
            tx.set(generatedSite.runRef(fb, eventId, commitRunId), { status: 'done', doneAt: now, writing: { state: 'done', at: now } }, { merge: true });
            /* the draft row GET /api/draft hands the editor, written with the switch: a page that finds the run done (one
               reloaded meanwhile: BE-033) opens this run's, never the one before it */
            tx.set(draftDoc, { templateId: templateId, sourceEventId: sourceEventId, library: {}, runId: commitRunId, positioningNotes: positioningNotes,
              model: (answers[0] && answers[0].model) || GEMINI_TEXT_MODEL, generatedAt: now, generatedBy: actorOf(by), skippedLibraries: [] });
            });
          });
        })
        /* what earlier runs left — their sections, plans, and (for a run made from its own inputs) the briefs and
           pages the owner has since replaced — is let go: nothing reads them any more. Never fails the request. */
        .then(function () { return generatedSite.retire(fb, eventId, commitRunId, { inputs: ownInputs }); })
        /* the answers kept while it was written are in the site now (BE-030) */
        .then(function () { return keepRun ? generatedSite.dropWritten(fb, eventId, commitRunId) : null; })
        /* an award site's FAQs are the event's FAQ records (Content › FAQ), as the page shows them: the ones
           written for this edition, put there only while the event has none of its own */
        .then(function () { return got.award ? seedAwardFaqs(fb, eventId, got.award, by) : null; })
        /* ...and its jury, the event's Speakers records: the jury on record, while the event has none of its own */
        .then(function () { return got.award ? seedAwardJury(fb, eventId, got.award.award.jury, by) : null; })
        .then(function () { return draftDoc; })
        .then(function (docRef) {
          sendJson(res, 200, {
            eventId: eventId, templateId: templateId, draftId: docRef.id, runId: commitRunId, positioningNotes: positioningNotes,
            sections: sections.map(function (s) { return { id: s.id, kind: s.kind }; }), library: {}
          });
          if (watch.live) logActivity(fb, eventId, by, 'site-generated', 'AI wrote the site’s ' + sections.length + ' sections' + (hadSite ? ' again, in place of the last ones' : ''), { area: 'site' });
          if (watch.live && describedNow) logActivity(fb, eventId, by, 'updated', eventDescription.activityDetail(!!(described && described.previous)), { area: 'event',
            fields: [{ field: 'description', before: describedBefore.slice(0, 600), after: describedNow }] });
        });
    });
  }).catch(function (err) {
    /* the run's record says the try ended (a stopped run, or a removed event, is not written to: keepWritten) */
    keep([], { state: 'failed' });
    sendStepFailure(res, err, 500, 'The pages could not be written just now. Please try again.', 'generate-content');
  });
}

/* ---------- POST /api/redesign-section — one section of an AI-designed site, designed again ----------
   The editor's "Redesign with AI" on a section: the section as it stands on the page (the owner may have
   edited it since it was generated), the site's design, and what the owner asked for, if anything. The
   answer is that one section's new HTML and CSS, to the same rules the whole site was written to. Nothing
   is stored here: the editor puts the answer on the page as one undoable step and saves it with the site. */
var REDESIGN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING', description: 'One plain sentence for the site owner: what is different about the new version.' },
    html: { type: 'STRING', description: 'The section\'s new HTML: ONE root element, no <script>, no inline event handlers.' },
    css: { type: 'STRING', description: 'The section\'s new CSS as plain class selectors for the classes used in its html.' }
  },
  required: ['summary', 'html', 'css']
};
var REDESIGN_MAX_CHARS = 90000;

/* what the editor adds to a section while it is being edited is no part of the section */
function stripEditorMarks(html) {
  return String(html || '')
    .replace(/\s(?:data-editable|data-rv-key|data-sec-name|data-ai-generated|data-ai-skipped|data-rv-open|data-rv-aria|data-rv-cur-item|data-text-original|contenteditable)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '')
    .replace(/\sclass="([^"]*)"/gi, function (full, cls) {
      var kept = cls.split(/\s+/).filter(function (c) { return c && !/^(ed-selected|sec-active|is-hidden-sec|rv-in|rv-shown)$/.test(c); }).join(' ');
      return kept ? ' class="' + kept + '"' : '';
    });
}

/* A background picture set on the section's own element, lost by the new version of the section while the owner did
   not ask to remove or replace it, is put back on the new element (owner, 10 Nov 2026: CISO Secufest's hero went blank
   twice after "reduce the opacity of white overlay a little bit to show the background properly"). */
var DROP_PICTURE_RE = /\b(?:remove|delete|drop|hide|without|no|replace|swap|change|new|another|different|instead)\b[^.]{0,40}\b(?:background|picture|image|photo|bg)\b|\b(?:background|picture|image|photo)s?\b[^.]{0,20}\b(?:removed|gone|off|plain|solid|colou?r|blank)\b/i;
function keepRootBackground(origHtml, newHtml, newCss, instruction) {
  var root = /^\s*<[a-z][a-z0-9-]*\b[^>]*>/i.exec(String(origHtml || ''));
  var style = root && /\bstyle\s*=\s*"([^"]*)"/i.exec(root[0]);
  var bg = style && /background(?:-image)?\s*:[^;]*url\(\s*(?:&quot;|["'])?(https?:\/\/[^"')&\s]+)(?:&quot;|["'])?\s*\)/i.exec(style[1]);
  if (!bg) return newHtml;
  var url = bg[1];
  if (String(newHtml).indexOf(url) !== -1 || String(newCss).indexOf(url) !== -1 || DROP_PICTURE_RE.test(instruction)) return newHtml;
  console.error('redesign-section: the new version lost the section\'s own background picture; it is put back');
  var decl = 'background-image: url(&quot;' + url + '&quot;)';
  return String(newHtml).replace(/^(\s*<[a-z][a-z0-9-]*\b)([^>]*)>/i, function (all, open, attrs) {
    if (/\bstyle\s*=\s*"/i.test(attrs)) {
      return open + attrs.replace(/\bstyle\s*=\s*"([^"]*)"/i, function (a, v) { v = v.replace(/;\s*$/, ''); return 'style="' + (v ? v + '; ' : '') + decl + ';"'; }) + '>';
    }
    return open + attrs + ' style="' + decl + ';">';
  });
}
/* url(&quot;…&quot;) is HTML's way of writing quotes, and no URL at all in a stylesheet: written plainly */
function cssUrlQuotes(css) { return String(css || '').replace(/url\(\s*&quot;([^"]*?)&quot;\s*\)/g, 'url("$1")'); }

var PICTURE_URL = /https?:\/\/[^\s"'()<>]+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s"'()<>]*)?|data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+\/=]+/gi;

function buildRedesignPrompt(payload) {
  var design = payload.design || {};
  var radius = (design.cornerRadius || '12') + 'px';
  var urls = payload.pictureTokens || [];
  var lines = [
    payload.mode === 'edit'
      ? 'You are changing ONE section of an event microsite that is already built, for ETB2B EventSphere\'s event builder, exactly as its owner asked. Return the section\'s whole HTML and CSS after the change.'
      : payload.mode === 'create'
        ? 'You are writing ONE NEW section for an event microsite that is already built, for ETB2B EventSphere\'s event builder, from its owner\'s brief. Return the section\'s HTML and CSS, to the standard of a top agency.'
        : 'You are redesigning ONE section of an event microsite that is already built, for ETB2B EventSphere\'s event builder. Return that section\'s new HTML and CSS — a visibly different, better design of the same section, to the standard of a top agency.',
    '',
    payload.mode === 'edit'
      ? 'WHAT THE OWNER ASKED FOR: "' + String(payload.instruction).slice(0, 1500) + '"'
      : payload.mode === 'create'
        ? 'THE BRIEF: "' + String(payload.instruction).slice(0, 1500) + '"'
        : payload.instruction
          ? 'WHAT THE OWNER ASKED FOR — this comes first: "' + String(payload.instruction).slice(0, 600) + '"'
          : 'The owner gave no particular instruction: choose a clearly different layout for this content (if it is a card grid, try a picture/text split, a timeline, a band of large numbers, a carousel, an alternating list…) and make it more striking.',
    '',
    payload.mode === 'edit'
      ? 'DO WHAT WAS ASKED, ALL OF IT, AND NOTHING ELSE. Anything the request needs is allowed: adding, removing, reordering or rewriting content, a different layout, other colours, sizes, spacing or alignment. Whatever the request does not touch stays exactly as it is — the same markup, class names, wording and styles. New facts come only from the request itself: never invent a name, company, number, date, address, e-mail or phone number.'
      : payload.mode === 'create'
        ? 'Write what the brief asks for. Facts come only from the brief: never invent a name, company, number, date, address, e-mail or phone number — where the brief gives no detail, write honest general copy.'
        : 'KEEP THE CONTENT. Every fact, name, number, date, link and e-mail address in the section stays, with the same meaning; wording may be tightened, and headings sharpened. Do not invent a fact, person, company, number, address, e-mail or phone number. Keep every link\'s href.',
    payload.mode === 'create' ? '' : 'KEEP THESE ATTRIBUTES exactly as they are on the elements that carry them: data-rv-repeat-template, data-rv-field, data-rv-bind, data-rv-bound, data-rv-auto, data-rv-logo, data-rv-logo-unit, data-rv-logo-note, data-register-cta, data-rv-form, data-rv-form-embed, data-rv-form-title, data-rv-carousel, data-rv-carousel-track. The logo unit (the element with data-rv-logo-unit) stays exactly as it is, with every picture in it — its second picture with the class rv-lu-dark is its copy for a dark background, never remove it. An element with data-rv-repeat-template stays the single template item it is — never write more copies of it, and never remove it unless the owner asked for the list to go. An element with data-rv-form-embed stays exactly as it is, with its contents (it is a form the site draws in place); keep it in the section.',
    'Every button whose action is to register gets data-register-cta and href="#register".',
    (payload.supplied || []).length
      ? 'PICTURES THE OWNER ATTACHED for this change — use them exactly as the request says, by these addresses: ' + payload.supplied.map(function (p) { return 'attached picture ' + p.n + ' = ' + p.token; }).join(' , ') + '. As an <img> give it alt text and object-fit: cover in a sized frame; as a background use background-image with cover and centre, keeping any veil that keeps text readable.'
      : '',
    urls.length ? 'PICTURES: the section\'s own pictures — with any attached above, the only pictures you may use — by exactly these addresses (they begin "rvimg://"; the server turns them into the real ones — never write an http address) — keep using them, larger if anything: ' + urls.join(' , ') : (payload.supplied || []).length ? 'Besides the attached ones, this section has no picture.' : 'This section has no picture and you cannot add one: build its visual interest from CSS (shapes, large numerals, rules, gradients) and inline SVG icons you draw yourself.',
    '',
    'THE SITE\'S DESIGN — the section must sit naturally between its neighbours:',
    payload.generated === false
      ? 'This site is built on a fixed template: its CSS is not shown to you and stays as it is. Keep the section\'s existing class names wherever you keep its markup, so that the template\'s styling still applies. The CSS you return is ADDED for this section: write only the rules your change needs, with new class names for new things. Use var(--theme-color) for the brand colour and inherit fonts. Sizes in px only (never rem or em: this site\'s root font size is 10px).'
      : 'Mood: ' + (design.mood || '') + '\nLayout system: ' + (design.layout || '') + '\nColours and fonts are CSS variables already on the page — use the variables for the site\'s own colours (a specific colour the owner asked for is written as asked): var(--theme-color) brand, var(--accent-color) second colour, var(--rv-bg) page background, var(--rv-surface) cards and bands, var(--rv-text) body text, var(--rv-muted) secondary text, var(--heading-font-family), var(--body-font-family).\n' + toneRule(design) + ' (Only the owner can ask otherwise: a change they ask for in so many words, such as a dark band here, is made as asked.)' +
        (payload.owner ? '\n' + ownerBrief.copyLines(payload.owner).join('\n') + '\n(What the owner asks for in this change wins over these where the two differ.)' : '') +
        /* a redesign may carry the city too; an edit does only what was asked */
        (payload.mode !== 'edit' && placeDirection(design.place, true) ? '\n' + placeDirection(design.place, true) : ''),
    '- Content sits in a container: max-width 1200px, margin 0 auto, padding 0 24px. The section has vertical padding clamp(64px, 9vw, 128px).',
    '- Corner radius ' + radius + ' on cards, pictures and inputs. Buttons: padding 15px 30px, radius ' + radius + ', font-weight 600, font-size 1rem.',
    '- Type: rem or px only. Paragraph and list text 1.125rem or larger with line-height 1.65 and lines no longer than 68ch; ' + (payload.generated === false ? 'keep the template\'s existing heading sizes and heading levels (px only)' : payload.sectionId === 'hero' ? 'the hero keeps its own headline size' : 'section heading (h2) exactly ' + genDesign.HEADING_SCALE.section + ', never larger, and no h1') + (payload.generated === false ? '' : '; sub-headings and card titles (h3) ' + genDesign.HEADING_SCALE.sub) + '; nothing below 0.875rem; only a band of big numbers may be larger than the heading. Set font-family, font-size, line-height and color explicitly.',
    '- Responsive without script: grids and splits collapse to one column under 820px; nothing causes sideways scrolling.' + (payload.generated === false ? '' : '\n' + genDesign.MOBILE_RULES),
    '- Light motion: data-rv-reveal (or ="left", "right", "zoom", "fade") on a few blocks that should ease in on scroll — the page animates them, write no opacity:0 or keyframes for it; a gentle hover lift on cards and buttons.',
    '- A row with more items than fit may be a carousel: data-rv-carousel on the wrapper, data-rv-carousel-track on the element holding the items, a width on each item; the page adds the buttons — never draw arrows or dots.',
    '',
    ET_LOGO_COLOUR_RULE,
    NAME_RULE,
    'HTML rules: ONE root element carrying id="' + payload.sectionId + '", no <html>/<body>/<head>, no <script>, no inline event handler attributes, no javascript: URIs, no <iframe>/<object>/<embed>.',
    'CSS rules: plain class selectors for the classes you use, each class prefixed with "' + payload.sectionId + '-", including one for the root element. Do NOT write [data-rv-section] in any selector and do not style html, body or :root. No @import.',
    '',
    'Neighbouring sections, so that yours differs from them: above — ' + (payload.above || '(none)') + '; below — ' + (payload.below || '(none)') + '.',
    '',
    'THE SECTION AS IT IS NOW — its HTML:', String(payload.html),
    '',
    'Its CSS (shown as stored: the "[data-rv-section=…]" prefix on each rule is added by the server, do not write it):', String(payload.css)
  ];
  return lines.join('\n');
}

function handleRedesignSection(req, res) {
  readBody(req, res, function (raw) {
    var payload;
    try { payload = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
    var eventId = String(payload.eventId || '').trim();
    var sectionId = slugifyId(payload.sectionId);
    var html = stripEditorMarks(payload.html), css = String(payload.css || '');
    if (!eventId || !isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });
    if (!sectionId || !html.trim()) return sendJson(res, 400, { error: 'The section to redesign is missing.' });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    watchEvent(fb, eventId).then(function () { return fb.db.collection('events').doc(eventId).get(); }).then(function (snap) {
      var data = snap.exists ? snap.data() : {};
      var design = (data.designPlan && data.designPlan.design) || {};
      /* pictures go to the model as short tokens and come back as addresses (genDesign.restorePictures) */
      var found = (html.match(PICTURE_URL) || []).concat(css.match(PICTURE_URL) || []);
      found = found.filter(function (u, i) { return found.indexOf(u) === i && !/^https?:\/\/[^/]+\/templates\/_shared\//i.test(u); });
      var pictures = {}, origHtml = html;
      found.forEach(function (u, i) { var token = genDesign.pictureToken('p' + (i + 1)); pictures[token] = u; html = html.split(u).join(token); css = css.split(u).join(token); });
      /* measured once pictures are tokens: a picture kept inline in the page is not text the model reads */
      if (html.length + css.length > REDESIGN_MAX_CHARS) return sendJson(res, 413, { error: 'This section has too much in it to redesign in one go. Move part of it into a second section, then redesign each.' });
      /* pictures the owner attached in the chat for this change: only ones stored for this event */
      var ownStore = 'https://storage.googleapis.com/' + fb.bucket.name + '/events/' + eventId + '/';
      var supplied = [];
      (Array.isArray(payload.addPictures) ? payload.addPictures : []).slice(0, 6).forEach(function (p) {
        var url = String((p && p.url) || '').trim(), n = parseInt(p && p.n, 10);
        if (url.indexOf(ownStore) !== 0 || !(n >= 1) || pictures[genDesign.pictureToken('attached-' + n)]) return;
        var token = genDesign.pictureToken('attached-' + n);
        pictures[token] = url;
        supplied.push({ n: n, token: token });
      });
      var mode = payload.mode === 'edit' || payload.mode === 'create' ? payload.mode : 'redesign';
      if (mode !== 'redesign' && !String(payload.instruction || '').trim()) return sendJson(res, 400, { error: 'Say what should change.' });
      var prompt = buildRedesignPrompt({
        mode: mode, generated: payload.generated !== false, supplied: supplied,
        pictureTokens: Object.keys(pictures).filter(function (t) { return !/^rvimg:\/\/attached-/.test(t); }),
        sectionId: sectionId, html: html, css: css, design: design, owner: (data.designPlan && data.designPlan.owner) || null,
        instruction: String(payload.instruction || '').trim(),
        above: String(payload.above || '').slice(0, 200), below: String(payload.below || '').slice(0, 200)
      });
      return llm.callJson(prompt, REDESIGN_SCHEMA, { timeoutMs: 90000, route: 'redesign-section', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.site, onUsage: aiUsageRecorder(null, eventId, 'redesign-section') }).then(function (r) {
        if (r.error) return sendAiFailure(res, r);
        var unusable = { error: 'The AI did not return a usable section. Nothing on the site changed — try again.', code: 'ai-unusable' };
        var newHtml = genDesign.restorePictures(tidyGeneratedSectionHtml(String(r.parsed.html || '')).trim(), pictures, found[0] || '');
        if (!/^<[a-zA-Z]/.test(newHtml)) return sendJson(res, 502, unusable);
        var newCss = genDesign.clampFontSizes(tidyGeneratedSectionCss(String(r.parsed.css || '')));
        /* no heading above the site's type scale, as when the site was made (the hero keeps its own type) */
        if (sectionId !== 'hero' && payload.generated !== false) newCss = genDesign.capHeadingSizes(newCss, newHtml);
        newCss = cssUrlQuotes(genDesign.restorePictures(newCss, pictures, found[0] || ''));
        /* a change that was not about the background keeps the section's own background picture */
        if (mode === 'edit') newHtml = keepRootBackground(origHtml, newHtml, newCss, String(payload.instruction || ''));
        /* BE-043: an e-mail or phone number that neither the section as it stood, the owner's words nor the event's
           record has becomes the placeholder (lib/invented-facts.js) */
        try {
          var facts = inventedFacts.check(newHtml, inventedFacts.groundOf(origHtml, payload.instruction, eventFacts(data, null),
            data.designPlan && data.designPlan.owner), TOKEN_KIT, { fix: true, skipSections: [] });
          if (facts.removed.length) console.warn('redesign-section: ' + eventId + '/' + sectionId + ' — ' + inventedFacts.summary(facts));
          newHtml = facts.html;
        } catch (factsErr) { console.error('redesign-section: the facts check of ' + eventId + '/' + sectionId + ' failed — ' + (factsErr && factsErr.message)); }
        /* the safety step (BE-025), once the pictures are addresses again: nothing the model wrote reaches the page
           unless sanitize.js lets it */
        var safe = safeGeneratedSection(newHtml, newCss);
        newHtml = safe.html.trim();
        if (!/^<[a-zA-Z]/.test(newHtml)) return sendJson(res, 502, unusable);
        var scopedCss = scopeSectionCss(safe.css, sectionId, sectionRootInfo(newHtml));
        /* an AI-designed site's section is held to a phone's width as soon as it is remade, as on the published
           page (gen-markup.js mobileSafeCss; idempotent); a fixed template's CSS is left as it was written */
        if (payload.generated !== false) scopedCss = mobileSafeCss(scopedCss);
        /* …and the stylesheet read once more as it leaves, after it was scoped */
        scopedCss = sanitize.sanitizeCss(scopedCss);
        sendJson(res, 200, {
          sectionId: sectionId, html: newHtml,
          css: scopedCss,
          summary: String(r.parsed.summary || '').trim().slice(0, 300)
        });
      });
    }).catch(function (err) { sendStepFailure(res, err, 500, 'The section could not be redesigned just now. Please try again.', 'redesign-section'); });
  }, BODY_LIMITS.ai);
}

function handleGenerateContent(req, res) {
  readBody(req, res, function (raw) {
    var payload;
    try { payload = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    var eventId = String(payload.eventId || '').trim();
    var templateId = String(payload.templateId || '').trim();
    // sourceEventId: where to read the brief/sources FROM — defaults to eventId, but a not-yet-run future
    // edition (e.g. "making-ai-work-2027") has no sources of its own yet; it reads the same event series'
    // already-collected research (e.g. "making-ai-work", whose 2025/2026 editions are real past history)
    // and writes its own draft under its own eventId, so it never collides with that series' current draft.
    var sourceEventId = String(payload.sourceEventId || eventId).trim();
    var futureEdition = !!payload.futureEdition;
    if (!eventId || !templateId) return sendJson(res, 400, { error: 'eventId and templateId are required.' });
    if (!isEventId(eventId) || !isEventId(sourceEventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(templateId)) return sendJson(res, 400, { error: 'Invalid templateId.' });
    /* BE-020: a site is written onto the event it is for, from that event's own design and research. Another
       event's brief and sources are read only for a future edition (its own past editions'), and only from an
       event that exists (checked below, with the caller's portal checked for it by routeApi). */
    if (sourceEventId !== eventId && !futureEdition) return sendJson(res, 400, { error: 'A site is written from its own event\'s brief and sources (sourceEventId must be the eventId).', code: 'other-event' });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });
    /* asked only once a branch below is taken: a refusal made before it leaves no promise unanswered */
    function sourceOk() { return sourceEventId === eventId ? Promise.resolve() : loadLiveEvent(fb, sourceEventId); }

    // AI-DESIGNED GENERATED TEMPLATES: templateId:'gen-<eventId>' has no templates/<id>/template.json on
    // disk at all — Gemini designs/writes its own HTML+CSS per section (runGenerateDesignedContent, a
    // deliberately SEPARATE pipeline from the ported-template path below — see that function's own header
    // comment for why), reading the designPlan /api/plan-structure already saved on events/{eventId}.
    if (/^gen-/.test(templateId)) {
      /* the design is this event's own: 'gen-<another event>' would write that event's site onto this one */
      if (templateId !== 'gen-' + eventId) return sendJson(res, 400, { error: 'An AI-designed site is written from its own event\'s design (templateId must be "gen-' + eventId + '").', code: 'other-event' });
      /* the generation this is (WZ-034, BE-029): its own plan, kept with it by plan-structure, and its own brief and
         pages; the event changes only once its site is written. A run with no record of its own (its plan was made
         before runs were kept) works from the event's plan, as a caller without a run does. */
      var runId = runIdOf(payload);
      if (runId === null) return sendJson(res, 400, { error: RUN_ID_ERROR });
      /* WZ-055: { stop: true } — the person stopped this run (Create Event's Stop generating, the editor's Stop). No
         model is asked: the run is marked stopped, so a step of it still under way on the server (its plan, its
         pages) is never put on the event, whatever happens to the request it came in on. */
      if (payload.stop === true) {
        if (!runId) return sendJson(res, 400, { error: 'Name the run to stop (runId).' });
        return stopGenerationRun(fb, eventId, runId, req.user).then(function (out) { sendJson(res, 200, { eventId: eventId, runId: runId, stopped: out.stopped, done: out.done }); })
          .catch(function (err) { sendStepFailure(res, err, 500, 'The run could not be stopped. Please try again.', 'generate-content stop'); });
      }
      return sourceOk().then(function () {
        return Promise.all([fb.db.collection('events').doc(eventId).get(), generatedSite.readRun(fb, eventId, runId)]);
      }).then(function (got) {
        var data = got[0].exists ? got[0].data() : {}, run = got[1];
        if (run && run.status === 'stopped') return sendJson(res, 409, { error: RUN_STOPPED, code: 'run-stopped' });
        /* BE-033: the run's site is on the event already (a page reloaded after it was put there asks again): it is
           answered as written, and nothing is asked of the model */
        if (runId && run && run.status === 'done' && data.generatedSite && data.generatedSite.runId === runId) {
          return sendJson(res, 200, { eventId: eventId, templateId: templateId, runId: runId, already: true, library: {},
            sections: generatedSite.index(data).map(function (s) { return { id: s.id, kind: s.kind }; }) });
        }
        var fromRun = !!(run && run.designPlan);
        var designPlan = fromRun ? run.designPlan : data.designPlan;
        if (!designPlan || !designPlan.design || !Array.isArray(designPlan.sections)) {
          return sendJson(res, 409, { error: NOT_PLANNED, code: 'not-planned' });
        }
        runGenerateDesignedContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, designPlan, req.user, {
          runId: runId, fromRun: fromRun, described: fromRun ? run.described || null : null,
          /* this run's own brief and pages, unless it was made from what the event already had */
          ownInputs: fromRun && !run.usedEventInputs && payload.useEventInputs !== true
        });
      }).catch(function (err) { sendStepFailure(res, err, 500, 'The pages could not be written just now. Please try again.', 'generate-content'); });
    }

    var templatePath = path.join(__dirname, '..', '..', 'templates', templateId, 'template.json');
    var templateJson;
    try { templateJson = JSON.parse(fs.readFileSync(templatePath, 'utf8')); }
    catch (e) {
      /* the reason stays in the server's log: it names the server's own folders */
      console.error('generate-content: template "' + templateId + '" could not be read — ' + e.message);
      return sendJson(res, 400, { error: 'There is no template "' + templateId + '".', code: 'unknown-template' });
    }

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

    sourceOk().then(function () {
      runGenerateContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, (templateJson.content || {}).map, skippedLibraries, null, req.user);
    }, function (err) { sendStepFailure(res, err, 500, 'The pages could not be written just now. Please try again.', 'generate-content'); });
  }, BODY_LIMITS.ai);
}

/* ---------- a run of "Generate my site": stopped, and where it is (BE-033) ----------
   stopGenerationRun: the run is marked stopped in its own record (and on the event while it is the event's newest),
   in one transaction with the check that the event is there. A step of it still under way on the server reads that
   before it keeps an answer and before its site is put on the event (runGenerateDesignedContent, plan-structure),
   so nothing of a stopped run is ever used. A run whose site is already the event's is left as it is.
   -> Promise<{ stopped, done }> */
function stopGenerationRun(fb, eventId, runId, by) {
  var out = { stopped: false, done: false };
  return watchEvent(fb, eventId).then(function (w) {
    return w.within(function (tx, ref, snap) {
      var runRef = generatedSite.runRef(fb, eventId, runId);
      return tx.get(runRef).then(function (runSnap) {
        var at = new Date().toISOString(), cur = snap.data() || {}, newest = cur.generationRun || {};
        out.done = !!(cur.generatedSite && cur.generatedSite.runId === runId) || (runSnap.exists && (runSnap.data() || {}).status === 'done');
        out.stopped = !out.done;
        if (out.done) return;
        if (newest.runId === runId && !newest.done) tx.update(ref, { 'generationRun.stopped': true });
        tx.set(runRef, { runId: runId, status: 'stopped', stoppedAt: at, stoppedBy: actorOf(by) }, { merge: true });
      });
    });
  }).then(function () { return out; });
}

/* What GET /api/generate/status answers for a run, from the event's document, the run's record and the answers it
   has kept (generated-site.js). A step is `active` while its last sign of life is recent: the writing step marks one
   at its start and with every answer kept (each model call is at most 100 s; a picture and a call follow one
   another at most), the plan step once, at its start (a plan with its pictures is done within about four minutes).
     state  'unknown'     no record of it (never started, or let go once a newer run's site was put on the event)
            'planning'    its plan is being made
            'planned'     its plan is kept and its pages are not being written
            'writing'     its pages are being written
            'left'        the request writing them ended before the site was put on the event (the page was reloaded
                          or closed): asking for its pages again (the same runId) finishes it from what is kept
            'failed'      its last try failed: asking again (the same runId) asks only for what is missing
            'stopped'     it was stopped: nothing of it is used
            'superseded'  a newer run has taken the event: this one's site is not used
            'done'        its site is the event's (siteReady) */
var RUN_ACTIVE_MS = { planning: 6 * 60 * 1000, writing: generatedSite.WRITING_FRESH_MS };
function runStatusOf(eventId, runId, ev, run, written, now) {
  ev = ev || {};
  var siteReady = !!(ev.generatedSite && ev.generatedSite.runId === runId);
  var newestId = ev.generationRun && ev.generationRun.runId, newest = newestId === runId;
  var w = (run && run.writing && typeof run.writing === 'object') ? run.writing : {};
  var planned = run && run.designPlan && Array.isArray(run.designPlan.sections)
    ? sectionCodeBatches(run.designPlan).reduce(function (all, b) { return all.concat(b); }, [])
    : Array.isArray(w.planned) ? w.planned.slice() : [];
  var writtenIds = (written || []).filter(function (s) {
    return s && typeof s.id === 'string' && (!w.planKey || s.planKey === w.planKey) && (!planned.length || planned.indexOf(s.id) !== -1);
  }).map(function (s) { return s.id; });
  var lastAt = Math.max(Date.parse(w.at || '') || 0, Date.parse((run && run.planningAt) || '') || 0);
  var state = 'unknown', active = false;
  if (siteReady) state = 'done';
  else if (!run) state = 'unknown';
  else if (run.status === 'stopped') state = 'stopped';
  else if (newestId && !newest) state = 'superseded';
  else if (run.status === 'done') state = 'done';
  else if (w.state === 'writing') { active = now - (Date.parse(w.at || '') || 0) < RUN_ACTIVE_MS.writing; state = active ? 'writing' : 'left'; }
  else if (w.state === 'left' || w.state === 'failed') state = w.state;
  else if (run.status === 'planned') state = 'planned';
  else if (run.planningAt) { active = now - (Date.parse(run.planningAt) || 0) < RUN_ACTIVE_MS.planning; state = active ? 'planning' : 'unknown'; }
  return { eventId: eventId, runId: runId, state: state, active: active, newest: newest, siteReady: siteReady,
    sections: { planned: planned.length, written: siteReady ? planned.length : Math.min(writtenIds.length, planned.length || writtenIds.length) },
    at: lastAt ? new Date(lastAt).toISOString() : null };
}

/* ---------- GET /api/generate/status?eventId=&runId= — where a run of "Generate my site" is (BE-033) ----------
   Signed in, any role, an event of the caller's portals (routeApi's caller check). Read from the run's own record,
   never from the request doing the work, so it answers the same in any tab and after a reload: Create Event shows the
   writing step's progress from it, and picks a run up again after a reload. 200 runStatusOf(…). */
function handleGenerateStatus(req, res) {
  var q = queryOf(req), eventId = String(q.get('eventId') || '').trim(), runId = String(q.get('runId') || '').trim();
  if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });
  if (!generatedSite.isRunId(runId)) return sendJson(res, 400, { error: RUN_ID_ERROR });
  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });
  loadLiveEvent(fb, eventId).then(function (data) {
    return Promise.all([generatedSite.readRun(fb, eventId, runId), generatedSite.writtenCol(fb, eventId, runId).get()]).then(function (r) {
      sendJson(res, 200, runStatusOf(eventId, runId, data, r[0], r[1].docs.map(function (d) { return d.data() || {}; }), Date.now()));
    });
  }).catch(function (err) { sendFailure(res, 'generate status', err, 'Where this run is could not be read. Please try again.'); });
}

/* ---------- POST /api/generate/cancel { eventId, runId } — Create Event's Cancel generation (BE-033) ----------
   An Editor of the event. The run is stopped (stopGenerationRun): whatever of it is still under way on the server
   keeps nothing more and is never put on the event. No model is asked. 200 { eventId, runId, stopped, done } — done:
   its site was the event's already, and stays. (POST /api/generate-content { stop: true } does the same.) */
function handleGenerateCancel(req, res) {
  readBody(req, res, function (raw) {
    var payload;
    try { payload = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
    var eventId = String(payload.eventId || '').trim(), runId = String(payload.runId || '').trim();
    if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });
    if (!generatedSite.isRunId(runId)) return sendJson(res, 400, { error: 'Name the run to stop (runId).' });
    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });
    stopGenerationRun(fb, eventId, runId, req.user).then(function (out) {
      sendJson(res, 200, { eventId: eventId, runId: runId, stopped: out.stopped, done: out.done });
    }).catch(function (err) { sendStepFailure(res, err, 500, 'The run could not be stopped. Please try again.', 'generate cancel'); });
  }, BODY_LIMITS.small);
}

/* ---------- GET /api/draft — fetches the latest generated draft, pre-shaped for the editor ----------
   Turns a stored draft's `library` (what /api/generate-content produced and saved) into the exact
   `revamp.editor.handoff.v1` shape the real wizard hand-off uses: {event, sections:[{libId,name,data}], …}.
   The site editor (editor-template-ui.js) and Create Event read it, so a generated draft opens from the event's
   id alone — no payload wiring per event. */
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
  if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  fb.db.collection('events').doc(eventId).collection('drafts').orderBy('generatedAt', 'desc').limit(1).get()
    .then(function (snap) {
      if (snap.empty) return sendJson(res, 404, { error: NOT_GENERATED, code: 'not-generated' });
      var draftId = snap.docs[0].id, draft = snap.docs[0].data();
      sendJson(res, 200, { eventId: eventId, templateId: draft.templateId, draftId: draftId, generatedAt: draft.generatedAt || null, handoff: libraryToHandoffDraft(draft.library, eventId, draft.skippedLibraries) });
    })
    .catch(function (err) { sendFailure(res, 'get-draft', err, 'The generated site could not be loaded. Please try again.'); });
}

/* ---------- GET /api/generated-template?eventId=<id> — AI-DESIGNED GENERATED TEMPLATES PIPELINE, step 3 ----------
   Assembles the exact template.json shape (see the top-of-file comment and the contract shared with the
   frontend's template-loader.js) from the designPlan and the site's sections /api/plan-structure and
   /api/generate-content already saved for events/{eventId} (generated-site.js). No fixed component library anymore: every
   section's real markup/CSS is Gemini's own, served per-section by GET /api/generated-section right below.
   No "theme" key: every theme/colour value goes straight into body.style as inline CSS custom properties,
   computed fresh on every request — no Storage round-trip, no separate theme.css file. */
function buildGeneratedDesign(design) {
  // Generic, class-name-agnostic selectors — there's no fixed class vocabulary any more (Gemini names its
  // own classes per event). This only degrades a few optional Design-panel cosmetic controls (corner
  // radius / divider style) when Gemini's own class names don't happen to match; not a functional risk.
  return {
    headingFontVar: '--heading-font-family',
    headings: 'h1, h2, h3',
    /* BE-039: buttons only — the register buttons, real <button>s and links styled as one. A bare "a" took in every
       link of the top bar and the footer, so Corner radius rounded those too and was offered on every site. */
    buttons: '[data-register-cta], button, a[class*="btn"], a[class*="button"], a[class*="cta"]',
    cards: '[data-rv-repeat-template], [class*="card"]',
    swatches: [design.themeColor]
  };
}

function fontStack(family) { return '"' + family + '", Arial, sans-serif'; }

/* BE-035: an event whose site the first AI pipeline made (October 2026: structurePlan + theme over the fixed section
   library templates/_library, written to the event by plan-structure; no designPlan, no written sections). Four such
   events exist (cio — published —, enterprise-ai, next-billion, nexttech-summit); they are left as they are. */
function earlierPipelineSite(data) {
  return !!(data && data.structurePlan && Array.isArray(data.structurePlan.sections) && !(data.designPlan && data.designPlan.design) &&
    !generatedSite.has(data));
}
var EARLIER_PIPELINE_SENTENCE = 'This site was made by an earlier version of ETB2B AI, which the site editor cannot open. Nothing about the event has been changed.';

/* The page's section ids, top to bottom: nav, hero, designPlan.sections in planned order with this edition's
   sponsors first (section-order.js), footer — filtered down to whatever sections the site has (generatedSections:
   generated-site.js index(), [{ id, page? }]; a site generated before BE-031 may lack a planned section the model
   left out). */
function generatedPageIds(designPlan, generatedSections) {
  var have = {}, paged = [];
  (generatedSections || []).forEach(function (s) {
    if (!s || !s.id) return;
    have[s.id] = 1;
    /* an internal page's sections (an award's Categories, Jury, FAQs …: generate-content writes them with their
       page) come after the home page's, in the order they were made */
    if (typeof s.page === 'string' && s.page && s.page !== '*' && s.page !== sitePages.HOME) paged.push(s.id);
  });
  var home = ['nav', 'hero'].concat(sectionOrder.sponsorsFirst(designPlan.sections).map(function (s) { return s.id; }))
    .filter(function (id) { return paged.indexOf(id) === -1; });
  var seen = {};
  return home.concat(paged).concat(['footer']).filter(function (id) { return have[id] && !seen[id] && (seen[id] = 1); });
}

function handleGeneratedTemplate(req, res) {
  var qs = new URLSearchParams(req.url.split('?')[1] || '');
  var eventId = String(qs.get('eventId') || '').trim();
  if (!eventId) return sendJson(res, 400, { error: 'eventId is required.' });
  if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  fb.db.collection('events').doc(eventId).get().then(function (snap) {
    if (!snap.exists) return sendJson(res, 404, { error: 'No event found for "' + eventId + '".' });
    var data = snap.data();
    var designPlan = data.designPlan;
    /* BE-035: a site the first AI pipeline made (October 2026: a structure plan over a fixed section library, no
       design plan and no written sections) cannot be built here. Said as such — the editor explains it and offers
       to make the site again — and nothing about the event is changed by asking. */
    if (earlierPipelineSite(data)) {
      return sendJson(res, 409, { error: EARLIER_PIPELINE_SENTENCE, code: 'earlier-ai-design', published: data.published === true });
    }
    if (!designPlan || !designPlan.design || !Array.isArray(designPlan.sections)) {
      return sendJson(res, 404, { error: NOT_GENERATED, code: 'not-generated' });
    }
    /* the site's sections without their markup (generated-site.js: the run's own documents, or the event's field for
       a site generated before 13 Nov 2026) */
    var generatedSections = generatedSite.index(data);
    if (!generatedSections.length) {
      return sendJson(res, 404, { error: NOT_GENERATED, code: 'not-generated' });
    }
    // THEME_FALLBACK only as an absolute last resort — sanitizeDesignPlanDesign (POST /api/plan-structure)
    // always fills themeColor/headingFont/bodyFont itself, so this merge is normally a no-op.
    var design = Object.assign({}, THEME_FALLBACK, designPlan.design || {});
    if (!design.accentColor) design.accentColor = DESIGN_FALLBACK_ACCENT;
    /* a site designed before the plan carried page colours gets the ones its own mode implies */
    var colours = genDesign.palette(design, 'auto');
    var name = String(data.name || eventId);
    /* the site's themes (templates/_shared/rv-theme.js): the one chosen is on <body>; every theme's fonts are
       loaded so that switching is immediate */
    var themes = rvTheme.themesFor(Object.assign({}, design, { mode: colours.mode, backgroundColor: colours.backgroundColor, surfaceColor: colours.surfaceColor, textColor: colours.textColor, mutedColor: colours.mutedColor }));
    var chosen = themes.filter(function (t) { return t.id === designPlan.themeId; })[0] || themes[0];
    var fonts = [googleFontUrl(design.headingFont), googleFontUrl(design.bodyFont)]
      .concat([].concat.apply([], themes.map(function (t) { return [googleFontUrl(t.headingFont), googleFontUrl(t.bodyFont)]; })))
      .filter(function (url, i, arr) { return url && arr.indexOf(url) === i; });

    var byId = {};
    generatedSections.forEach(function (s) { if (s && s.id) byId[s.id] = s; });
    var orderedIds = generatedPageIds(designPlan, generatedSections);
    /* the site's internal pages: the plan's, else those generate-content made (an award's: generatedPages) */
    var sitePageList = sitePages.cleanPages(Array.isArray(designPlan.pages) && designPlan.pages.length ? designPlan.pages : data.generatedPages);

    var template = {
      id: 'gen-' + eventId,
      name: name,
      title: name,
      /* its own base, not ET's global stylesheet (see gen-base.css for why) */
      shared: ['gen-base.css', 'et-platform.css'],
      fonts: fonts,
      design: buildGeneratedDesign(design),
      body: {
        id: 'gen',
        class: 'microsite rv-generated',
        /* light or dark, as the theme it opens in (rv-theme.js apply sets it when the theme changes) */
        mode: chosen.mode === 'dark' ? 'dark' : 'light',
        // picked up by footer/script.js at runtime (document.body.dataset.rvEventId) so the real
        // registration POST knows which event it's for — a plain DOM attribute, so it rides through
        // canvas.serialize() into the actually-published static page the same as any other markup.
        eventId: eventId,
        style: {
          '--theme-color': design.themeColor,
          '--accent-color': design.accentColor,
          '--heading-font-family': fontStack(design.headingFont),
          '--body-font-family': fontStack(design.bodyFont),
          '--rv-bg': colours.backgroundColor,
          '--rv-surface': colours.surfaceColor,
          '--rv-text': colours.textColor,
          '--rv-muted': colours.mutedColor,
          '--default-color': colours.textColor,
          '--body-color': colours.textColor,
          /* text a section gives no size of its own is read at BASE_TEXT_PX */
          'font-size': genDesign.BASE_TEXT_PX + 'px',
          'line-height': '1.6',
          'font-family': 'var(--body-font-family)',
          'background-color': colours.backgroundColor,
          'color': colours.textColor,
          '--rv-radius': (+design.cornerRadius || 0) + 'px'
        }
      },
      themes: themes,
      themeId: chosen.id,
      // No server-side fill step any more — the 5 data-bound kinds are filled client-side via the
      // data-rv-repeat-template/data-rv-field convention baked directly into Gemini's own HTML.
      content: { map: [] },
      layout: { pinStart: ['hero'], pinEnd: ['footer'] },
      // No section ships its own script.js any more — scripts were never allowed through sanitization.
      sections: orderedIds.filter(function (id) { return byId[id]; }).map(function (id) {
        var planned = designPlan.sections.filter(function (x) { return x.id === id; })[0];
        var label = (planned && planned.name) || (id === 'nav' ? 'Top bar' : id.replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }));
        var section = { id: id, name: label, etId: null, script: false };
        /* ED-046: the sections whose words ETB2B AI wrote, for the editor's "Check what the AI wrote" before
           publishing — not the top bar and the footer (built from the event's facts and its portal), nor a section
           built from records (the previous edition's speakers, sponsors, agenda and photos; an award's categories
           and jury): template-loader.js marks only the others (data-ai-generated) */
        if (id === 'nav' || id === 'footer' || (planned && planned.prebuilt)) section.ai = false;
        /* internal pages (site-pages.js): the top bar and the footer are on every page; a planned section on the page
           its plan names (designPlan.sections[].page); the rest — the hero first — on the home page */
        if (sitePageList.length) {
          var made = byId[id];
          var onPage = id === 'nav' || id === 'footer' ? '*' : made && typeof made.page === 'string' && made.page ? made.page
            : planned && typeof planned.page === 'string' ? planned.page : '';
          if (onPage === '*' || onPage === sitePages.HOME || sitePageList.some(function (p) { return p.slug === onPage; })) section.page = onPage;
        }
        return section;
      })
    };
    /* a site with internal pages: designPlan.pages [{ slug, title, description? }] (template-loader.js writes the
       list into the page's <head>) */
    if (sitePageList.length) template.pages = sitePageList;
    /* accessibility: the reading colours of this palette (a brand-coloured button's ground and words, the brand colour as
       text, quiet text that reads on the panels too) — rv-theme.js derivedVars; a theme's own come with varsOf */
    Object.assign(template.body.style, rvTheme.derivedVars({ theme: design.themeColor, accent: design.accentColor,
      bg: colours.backgroundColor, surface: colours.surfaceColor, muted: colours.mutedColor }));
    if (chosen.id !== 'original') Object.assign(template.body.style, rvTheme.varsOf(chosen));
    sendJson(res, 200, template);
  }).catch(function (err) { sendFailure(res, 'generated-template', err, 'The site could not be loaded. Please try again.'); });
}

/* ---------- GET /api/generated-section?eventId=<id>&id=<sectionId> — AI-DESIGNED GENERATED TEMPLATES
   PIPELINE, step 4 ----------
   Signed in, any role, an event of one of the caller's portals (routeApi's caller check) — one section's real,
   model-written {html, css}, read where POST /api/generate-content keeps it (generated-site.js: the run's own
   document, or events/{eventId}.generatedSections for a site generated before 13 Nov 2026) and made safe again on
   the way out (safeGeneratedSection), whatever was stored. */
function handleGeneratedSection(req, res) {
  var qs = new URLSearchParams(req.url.split('?')[1] || '');
  var eventId = String(qs.get('eventId') || '').trim();
  var sectionId = String(qs.get('id') || '').trim();
  if (!eventId || !sectionId) return sendJson(res, 400, { error: 'eventId and id are required.' });
  if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  var data = null;
  fb.db.collection('events').doc(eventId).get().then(function (snap) {
    if (!snap.exists) return null;
    data = snap.data();
    /* where the site keeps it (generated-site.js): its run's own document, or the event's field (before 13 Nov 2026) */
    return generatedSite.readOne(fb, eventId, data, sectionId);
  }).then(function (found) {
    if (!data) return sendJson(res, 404, { error: 'No event found for "' + eventId + '".' });
    if (!found) return sendJson(res, 404, { error: 'That section is not part of this event\'s site.', code: 'not-generated' });
    /* scoped on the way out as well as when stored (it is idempotent), so sections stored before the
       server did the scoping are served correctly too */
    var html = String(found.html || '');
    /* the links of the top bar and the footer follow the page's order (a site made before that was enforced
       is served so too) */
    if ((sectionId === 'nav' || sectionId === 'footer') && data.designPlan && Array.isArray(data.designPlan.sections)) html = sectionOrder.orderNavLinks(html, generatedPageIds(data.designPlan, generatedSite.index(data)));
    /* made safe on the way out as well as when stored (BE-025): a section stored before the real sanitiser, or
       written to the record by any other way, reaches the editor only through it. Its own <style> rules join its CSS. */
    var css = [String(found.css || '')].concat(sanitize.styleTexts(html)).join('\n');
    html = sanitize.sanitizeHtml(html, { profile: 'generated' }).html;
    css = genDesign.clampFontSizes(scopeSectionCss(css, sectionId, sectionRootInfo(html)));
    /* no heading louder than the site's type scale — a section stored before the scale was calmed is served
       calm too (idempotent); the hero banner keeps its own type */
    if (sectionId !== 'hero') css = genDesign.capHeadingSizes(css, html);
    /* a colour of the design's palette written as a fixed value becomes its variable, so every theme reaches
       it (templates/_shared/rv-theme.js); the hero banner keeps its own tone */
    if (sectionId !== 'hero' && data.designPlan && data.designPlan.design) css = rvTheme.themableCss(css, data.designPlan.design);
    /* held to a phone's width (gen-markup.js; idempotent), as on the published page — not the top bar and the
       footer, which the server builds for phones itself (et-nav.js, et-footer.js: their one-line texts stay one line) */
    if (sectionId !== 'nav' && sectionId !== 'footer') css = mobileSafeCss(css);
    sendJson(res, 200, { html: html, css: sanitize.sanitizeCss(css) });
  }).catch(function (err) { sendFailure(res, 'generated-section', err, 'This section could not be loaded. Please try again.'); });
}

/* The AI steps write onto the event, and under it, at the END of a model call that can run for over a
   minute — long enough for the owner to cancel and for the wizard to discard the draft (DELETE
   /api/event?discard=1) meanwhile. A late write would then bring the removed event back as a shell with
   a brief or a generated site under it. So each step looks at the event before it starts and again just
   before it stores anything:
     - an event that does not exist — never made, only a shell, or deleted — is refused at the start (404
       event-not-found / event-deleted) — no model call is paid for (BE-021);
     - an event that was there at the start and is gone, or deleted, at the end answers
       409 { code: 'event-gone' } and stores nothing.
   Resolves { live, portal, stillThere(), merge(data), update(data) }. */
function watchEvent(fb, eventId) {
  var ref = eventDocRef(fb, eventId);
  function check(snap, start) {
    var now = eventStateOf(snap);
    if (now === 'deleted' || (start === 'live' && now !== 'live')) {
      throw httpError(409, 'This event was removed while this was running, so nothing was saved.', { code: 'event-gone' });
    }
  }
  return ref.get().then(function (snap) {
    var start = eventStateOf(snap);
    /* BE-021: a step works only on an event that exists — Create Event makes the event first (its "create" row) —
       so no step makes a nameless events/<id> shell, renames one or pays for a model call on an id nobody made */
    if (start !== 'live') throw notLiveError(start, eventId);
    var stored = snap.data() || {};
    return {
      /* a real (created) event: always, now (kept for the callers that ask) */
      live: true,
      /* the ET portal it belongs to (a roster slug, else ''): what a step reads from ET is that portal's, and the
         site's bar and footer show it */
      portal: etEvents.isPortal(stored.portal) ? stored.portal : '',
      stillThere: function () { return ref.get().then(function (now) { check(now, start); }); },
      /* merges `data` into the event document, in the same transaction as the check (which refuses an event that
         is gone, so the merge only ever writes into the live document it found) */
      merge: function (data) {
        return fb.db.runTransaction(function (tx) {
          return tx.get(ref).then(function (now) { check(now, start); tx.set(ref, data, { merge: true }); });
        });
      },
      /* sets top-level fields of the event document with update(): never makes a document */
      update: function (data) {
        return fb.db.runTransaction(function (tx) {
          return tx.get(ref).then(function (now) { check(now, start); tx.update(ref, data); });
        });
      },
      /* fn(tx, ref, snap) in a transaction that has read the event and found it still there: for a step that writes
         beside the event too (a generation's own record), or decides from what the event holds right then */
      within: function (fn) {
        return fb.db.runTransaction(function (tx) {
          return tx.get(ref).then(function (now) { check(now, start); return fn(tx, ref, now); });
        });
      }
    };
  });
}

module.exports = { wire, handleSuggestDesign, handleExtractBrief, handleIngestSource, handlePlanStructure, handleGenerateContent, handleGenerateStatus, handleGenerateCancel, handleRedesignSection, handleGetDraft, handleGeneratedTemplate, handleGeneratedSection };
/* what lib/api.js's _testHooks hands the tests and tools/ from this file (read there on first use) */
module.exports._testHooks = { drawnLogoUnit, darkCopyOfUnit, classifyGlimpses, unstyledSectionIds, emptyPictureBox, dropPicture, usableLogoPicture, runStatusOf, RUN_ACTIVE_MS, SOURCE_FRESH_MS, buildGeneratedDesign, confirmEtPick, pageKey, otherPortalOf, siteOfPortal, extractThemeFromPreviousEditionSources, editionLookLines, placeDirection, readEditionLook, keptKeyVisual, ingestSchemaFor, buildSectionImage, fetchSourceCss, buildRedesignPrompt, stripEditorMarks, generatedPageIds, sanitizeDesignPlanSections, fewerPeoplePictures, awardPlanSections, withAwardRecords, etPictureRules, newStandardPictures, MAX_SECTION_IMAGES, awardForSite, writeAwardPages, awardPageContent, seedAwardFaqs, seedAwardJury, sparseOverviewText, SPARSE_OVERVIEW_CHARS, readAwardRecord, awardPickByLink, readSectionPictures, MAX_PEOPLE_PICTURES, buildDesignPlanPrompt, buildExtractBriefPrompt, buildIngestSourcePrompt, buildSectionCodePrompt, designReference, buildLogoUnit, foundLogoUnit, logoUnitInTime, previousUnitNote, previousEditionUnit, unitSources, sectionCodeBatches, DESIGN_PLAN_SCHEMA, SECTION_CODE_SCHEMA, repeatedHeadingIds, takenHeadings, keepRootBackground, cssUrlQuotes, bottomColour, briefFacts, watchEvent, missingSectionIds, earlierPipelineSite, runIdOf, handleExtractBrief, handleGenerateContent, handleGeneratedSection };
