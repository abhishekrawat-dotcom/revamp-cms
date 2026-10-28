// The /api/*, /e/* and /preview/* endpoint logic — the ONE place it's routed. Runs identically in:
//   - production, called from server.js (Firebase App Hosting)
//   - locally, called from tools/serve.js
//   - the legacy Cloud Function entry point, functions/index.js (an Express-based request/response)
// The req/res shapes are close enough (all are/extend Node's http.IncomingMessage / ServerResponse) that
// the same handlers work unmodified — the one real difference is how the request body arrives (see
// readBody in lib/http.js), which is the only place that branches on environment.
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
//                               hero background image. Saved on the event's own doc (events/{eventId}:
//                               designPlan) for the two endpoints below to read.
//   GET  /api/generated-template?eventId=<id>   AI-DESIGNED GENERATED TEMPLATES PIPELINE, step 3: assembles
//                               the exact template.json shape (id, name, fonts, design, body.style,
//                               content.map, layout, sections) for a generated page, from the designPlan +
//                               generatedSections saved by /api/plan-structure and /api/generate-content.
//                               The frontend's template-loader.js consumes this the same way it reads a real
//                               templates/<id>/template.json file; each section's real markup/CSS (fully
//                               Gemini's own per-event design, not a fixed library component) is resolved
//                               via GET /api/generated-section right below.
//   GET  /api/generated-section?eventId=<id>&id=<sectionId>   PUBLIC, no auth — one section's real,
//                               Gemini-written {html, css}, read straight off events/{eventId}.
//                               generatedSections. The 5 data-bound kinds (speakers/faq/partners/contact/
//                               glimpses) carry a data-rv-repeat-template/data-rv-field convention in that
//                               markup for a client-side mechanism (built separately) to fill with real
//                               per-event Firestore records. The css is confined to its own section on
//                               the way out (lib/gen-markup.js).
//   Every model call above goes through lib/gemini.js. When one fails the route answers
//   { error, code, retryable } — code is ai-quota (429) | ai-config (503) | ai-rejected | ai-unavailable |
//   ai-bad-output (502) | ai-timeout (504, with timeoutMs) | ai-blocked (422) — and error is a sentence
//   that can be shown as it is.
//
//   -- Event console, the saved site and the public site. Every route here except the public ones needs a
//      verified Firebase ID token for a company account (requireAdmin in lib/http.js). An "event" is a
//      document that was created as one (it has createdAt) and has not been deleted — see eventStateOf().
//   POST  /api/event                        create; 409 { code:'slug-taken', suggestion } over an existing one
//   GET   /api/event?eventId=               read one
//   PATCH /api/event                        update details and `settings`; 404 if there is no such event
//   GET   /api/events                       every live event, team-wide (this is a shared CMS: no per-user
//                                           filter), newest-updated first, with published / publishedPath /
//                                           counters. No deleted events, import records or leftover shells.
//                                           ?deleted=1 lists the deleted ones instead (to restore them).
//   POST/PATCH/DELETE /api/event/leads/bulk import, change or delete up to 500 leads in one request
//   GET/POST/PATCH/DELETE /api/event/<resource>   the per-event content lists — speakers, speaker-groups,
//                                           sessions, agenda-groups, partners, partner-tiers, gallery, faqs,
//                                           contacts — and the Promotions pages' leads, promo-templates and
//                                           promo-audiences. See subcollectionRoutes() / RESOURCES.
//   GET / PUT /api/event/site               the site as the editor saved it (snapshot + page), versioned;
//                                           a stale save answers 409.
//   POST  /api/event/publish | unpublish    put the saved site live at /e/<id> / take it down.
//   POST  /api/event/stage                  only for browsers still running the previous editor script.
//   POST  /api/event/live-view              the editor's "Edit with AI" live view: the page through the
//                                           preview transform, answered, never stored.
//   GET   /e/<eventId>                      PUBLIC — the published site, served from private Storage.
//   GET   /preview/<eventId>                signed-in — what would be published right now.
//
//   Routed here, implemented elsewhere (loaded on demand; see inModule()):
//     lib/api-events.js    POST /api/event/upload, GET /api/event/slug-available, DELETE /api/event,
//                          POST /api/event/restore, POST /api/event/clone
//     lib/api-audience.js  GET /api/public/site-data, POST /api/register, POST /api/track (all PUBLIC),
//                          POST /api/event/seed, GET/PATCH/DELETE /api/event/registrations,
//                          GET /api/event/registrations/export (CSV),
//                          GET /api/event/dashboard-stats, GET /api/insights, GET /api/event/activity
//     lib/api-forms.js     an event's registration forms: GET/POST/PUT/DELETE /api/event/forms,
//                          POST /api/event/forms/default, POST /api/event/forms/order,
//                          GET /api/public/forms (PUBLIC — what a visitor's page is told about them)
//     lib/promo.js         GET /api/promo/kit, GET /api/promo/image, POST /api/promo/write (the Promotions
//                          pages: an event's brand and content, its pictures from our own address, AI copy)
//
//   -- Lovable import pipeline — EITHER a captured-site ZIP (from the browser console exporter the user runs
//      on a live Lovable.app site, not part of this repo) OR, now, just the live site's own URL (rendered
//      server-side with headless Chrome — see the HEADLESS RENDER ADAPTER block) -> flattened static HTML+CSS
//      -> a third template-loader.js template kind ('imported-<id>'), mounted through the EXACT same
//      RevampCanvas.mount() pipeline every real ported/generated template already uses, so it comes out fully
//      click-to-edit for free (see editor-canvas.js's walk() — tags any markup editable independent of
//      content.map). See LOVABLE IMPORT PIPELINE below for the full design (CSS inline-vs-linked decision,
//      the one-section content.map shape). Both input methods share one core (processLovableImport) and only
//      differ in how they produce {html, cssHrefs->text, imageRef->bytes} — see that function's own comment.
//   POST /api/import-lovable                 admin-gated. Body: {importId, zipBase64, fileName?} (ZIP upload)
//                               OR {importId, url} (live render). Either way: strips scripts (the exporter's
//                               own re-hydration JS runtime, or — for the url path — every script tag in the
//                               rendered DOM, since there's no re-hydration loader worth preserving there
//                               either way; both are meaningless once this app's own click-to-edit canvas
//                               takes over the same DOM), re-hosts referenced images to Storage, inlines the
//                               gathered CSS, stores the flattened result in Storage, and persists an
//                               events/import-<importId> doc. Returns {templateId: 'imported-<importId>'}.
//   GET  /api/imported-template?eventId=<importId>   PUBLIC, no auth (template-loader.js's load() runs in the
//                               ordinary browser context, same as /api/generated-template) — the
//                               template.json-shaped object for an imported design: one opaque 'imported'
//                               section, content.map has a single inert entry (no library/from id this app's
//                               wizard ever writes to, so editor-fill.js's apply() always leaves the real
//                               captured markup alone — see its own `if (!(m.from in ctx.content)) return;`).
//   GET  /api/imported-section?eventId=<importId>    PUBLIC, no auth — the one section's real flattened
//                               markup, CSS already inlined (this file's CSS inline-vs-linked call, see the
//                               handler's own comment) — proxied through this server rather than the browser
//                               hitting the Storage URL directly, same reasoning as every other template
//                               asset in this app.
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');
const { getFirebase } = require('./firebase');

/* Request plumbing (JSON in/out, body size limits, who is calling) lives in ./http and is shared with
   lib/api-events.js and lib/api-audience.js, so the three modules cannot drift apart on what a too-large
   body, a non-object JSON body or an expired sign-in is answered with. */
const { sendJson, readBody, parseJsonObject, parseJsonBody, requireAdmin, adminFromRequest, isEventId, isReservedEventId,
  isEmail, CONTENT_STATUSES, str } = require('./http');
const { logActivity, actorOf, maskEmail, sectionNames } = require('./activity');
const { callGeminiJson, callGeminiImage, GEMINI_TEXT_MODEL } = require('./gemini');
/* every text call goes through llm.js: Claude first when its key is set, Gemini as the fallback */
const llm = require('./llm');
const logoUnit = require('./logo-unit');
const pngLite = require('./png-lite');
const svgYear = require('./svg-year');
const ownerBrief = require('./owner-brief');
const eventDescription = require('./event-description');
const etPrevious = require('./et-previous');
const etEvents = require('./et-events');
const googleFonts = require('./google-fonts');
const sectionPictures = require('./section-pictures');
const etAwards = require('./et-awards');
const awardSite = require('./award-site');
const awardSections = require('./award-sections');
const prevSections = require('./prev-sections');
const sectionOrder = require('./section-order');
const etNav = require('./et-nav');
/* registration forms: their shape, the public definitions, the AI chat's form changes (pure) */
const formsLib = require('./forms');
const etFooter = require('./et-footer');
const pictures = require('./pictures');
const editionLook = require('./edition-look');
const rvTheme = require('../../templates/_shared/rv-theme.js');
const deliveryLib = require('./delivery');
/* An SVG drawn as a picture (resvg, a native module: loaded on first use, so a server without it still runs
   and only that one step is skipped). Drawn off the request thread (renderAsync), and only a drawing of a
   lock-up's size and shape: one too big a file, or so tall or so wide that the picture made of it would not
   fit in memory, is not drawn at all.
   -> Promise<{ png, pixels (RGBA), width, height } on a mid-grey ground | null>
   o.clear: drawn on nothing (transparent), to see where its lettering is; o.width: drawn that many pixels
   wide (at most RASTER_WIDTH) instead of RASTER_WIDTH; o.font: { family, ttfBase64 } — its text is drawn
   in that font (resvg reads no @font-face: the file is handed to it, and every family in the drawing
   falls back to it) */
var resvgModule;
var RASTER_MAX_SVG_BYTES = 1500 * 1024, RASTER_WIDTH = 1000, RASTER_MAX_HEIGHT = 3000;
function rasterise(svgText, o) {
  var fontFile = '';
  function drop() { if (fontFile) { try { fs.unlinkSync(fontFile); } catch (e) { /* already gone */ } fontFile = ''; } }
  try {
    if (resvgModule === undefined) { try { resvgModule = require('@resvg/resvg-js'); } catch (e) { resvgModule = null; console.error('api: SVGs cannot be drawn here (resvg) — ' + e.message); } }
    if (!resvgModule || Buffer.byteLength(String(svgText || '')) > RASTER_MAX_SVG_BYTES) return Promise.resolve(null);
    var width = o && o.width > 0 ? Math.min(RASTER_WIDTH, Math.round(o.width)) : RASTER_WIDTH;
    var opts = { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } };
    if (!(o && o.clear)) opts.background = '#808080';
    if (o && o.font && o.font.ttfBase64) {
      var family = String(o.font.family || '').replace(/[^A-Za-z0-9 ]/g, '').trim() || 'rvyear';
      fontFile = path.join(require('os').tmpdir(), 'rv-font-' + crypto.randomBytes(8).toString('hex') + '.ttf');
      fs.writeFileSync(fontFile, Buffer.from(o.font.ttfBase64, 'base64'));
      opts.font = { loadSystemFonts: false, fontFiles: [fontFile], defaultFontFamily: family, sansSerifFamily: family, serifFamily: family };
      svgText = String(svgText).replace(/font-family="'rvyear',[^"]*"/g, 'font-family="' + family + '"');
    }
    /* its own size, read before anything is drawn (units such as pt and mm are already in px here) */
    var own = new resvgModule.Resvg(svgText, opts);
    var w = own.width, h = own.height;
    if (!(w > 0) || !(h > 0) || width * h / w > RASTER_MAX_HEIGHT || w / h > 40) { drop(); return Promise.resolve(null); }
    return resvgModule.renderAsync(svgText, opts).then(function (img) {
      drop();
      return { png: img.asPng(), pixels: img.pixels, width: img.width, height: img.height };
    }, function (e) { drop(); console.error('api: an SVG could not be drawn — ' + (e && e.message)); return null; });
  } catch (e) { drop(); console.error('api: an SVG could not be drawn — ' + (e && e.message)); return Promise.resolve(null); }
}

/* Taking a year's shapes out of a drawing is kept only when the pictures before and after show that exactly
   the year went: what changed lies in the year's place (nothing else of the lock-up went with it), what
   is left there is plain ground (no digit stayed behind), and what went was one colour — the colour the
   new year is then set in. before/after: rasterise() results; box: the year as read, in their pixels;
   digits: the extent of the shapes taken out, in the same pixels (the ground is judged there, so that a
   mark the reader took in with the year — an apostrophe before it — and that stays, is no leftover).
   -> '#rrggbb' or '' (do not change the drawing) */
function yearCutColour(before, after, box, digits) {
  digits = digits || box;
  if (!before || !after || before.width !== after.width || before.height !== after.height) return '';
  var W = before.width, H = before.height, a = before.pixels, b = after.pixels;
  var padX = box.width * 0.08 + 3, padY = box.height * 0.25 + 3;
  var x0 = Math.max(0, Math.floor(box.x - padX)), x1 = Math.min(W, Math.ceil(box.x + box.width + padX));
  var y0 = Math.max(0, Math.floor(box.y - padY)), y1 = Math.min(H, Math.ceil(box.y + box.height + padY));
  var changed = 0, outside = 0, strong = [];
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var i = (y * W + x) * 4;
      var dd = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (dd <= 60) continue;
      changed++;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) outside++;
      else if (dd > 150) strong.push(i);
    }
  }
  if (changed < 20 || outside > Math.max(8, changed * 0.01) || strong.length < 10) return '';
  /* the ground left where the year was: one colour, give or take the edges of what is around it */
  var gx0 = Math.max(0, Math.floor(digits.x)), gx1 = Math.min(W, Math.ceil(digits.x + digits.width));
  var gy0 = Math.max(0, Math.floor(digits.y)), gy1 = Math.min(H, Math.ceil(digits.y + digits.height));
  var ground = [];
  for (var gy = gy0; gy < gy1; gy++) for (var gx = gx0; gx < gx1; gx++) ground.push((gy * W + gx) * 4);
  if (!ground.length || spreadOf(b, ground) > 0.03) return '';
  /* the colour the old digits were drawn in, when they were all one */
  if (spreadOf(a, strong) > 0.15) return '';
  var m = medianColour(a, strong);
  return '#' + m.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
}
function medianColour(px, at) {
  return [0, 1, 2].map(function (c) { var v = at.map(function (i) { return px[i + c]; }).sort(function (p, q) { return p - q; }); return v[v.length >> 1]; });
}
/* the share of those pixels plainly unlike their middle colour */
function spreadOf(px, at) {
  var m = medianColour(px, at), off = 0;
  at.forEach(function (i) { if (Math.abs(px[i] - m[0]) + Math.abs(px[i + 1] - m[1]) + Math.abs(px[i + 2] - m[2]) > 80) off++; });
  return off / at.length;
}
const { scopeSectionCss, sectionRootInfo, mobileSafeCss } = require('./gen-markup');
const genDesign = require('./gen-design');
const { splitImportedPage } = require('./import-split');
const { diffPages, summarise } = require('./page-diff');
const { safeFetch } = require('./safe-fetch');
/* accessibility and search on every published page (site-a11y.js pagePass; site-seo.js robots.txt, sitemap.xml) */
const siteA11y = require('./site-a11y');
const siteSeo = require('./site-seo');
const sitePages = require('./site-pages');

/* How much each route will read before answering 413. Nothing here used to bound a request body at all:
   one unauthenticated 100 MB POST was buffered whole before any check ran. Each limit is the largest
   legitimate body for that route with headroom, not a round number for its own sake. */
var KB = 1024, MB = 1024 * 1024;
var BODY_LIMITS = {
  ai: 2 * MB,             // suggest-design / chat-edit / generate-content: the page's section texts as JSON
  small: 256 * KB,        // ingest-source, plan-structure: ids and a URL
  brief: 22 * MB,         // extract-brief: a 15 MB document, base64-encoded (x 4/3), plus the event basics
  importZip: 56 * MB,     // import-lovable: a 40 MB ZIP, base64-encoded (the platform's own ceiling is lower)
  event: 512 * KB,        // POST / PATCH /api/event: an event document is itself capped at 1 MiB by Firestore
  record: 256 * KB,       // one speaker / session / sponsor / FAQ record; images are uploaded, never inline
  site: 12 * MB,          // PUT /api/event/site, and a publish / stage request that still carries the page
  tiny: 16 * KB           // { eventId } and nothing else
};

/* The most a model call may write, so an answer that runs away is cut off (and reported as unusable)
   instead of being paid for to the end. The budget includes the model's own reasoning tokens. */
var AI_OUTPUT_TOKENS = {
  small: 16384,           // a design, a chat reply, a brief, a page summary, a structure plan
  site: 65536             // the text or the HTML + CSS of a whole site in one answer
};

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

/* ET's rule for every logo of its verticals (the owner, 23 Oct 2026), in every prompt that can style or edit a
   page or a logo: when a logo's colour changes, only its black lettering may change; the red ET square never. */
var ET_LOGO_COLOUR_RULE = 'ET LOGOS (every vertical\'s — ETAuto, ETHRWorld, ETRetail and the rest — and The Economic Times Business Verticals logo): if a logo\'s colour must change to suit a dark or a light ground, ONLY its black lettering may change (to white or another colour). The red ET square, with the white "ET" in it, is NEVER changed at any cost: never recoloured, tinted, inverted, filtered (no CSS filter, mix-blend-mode or opacity on a logo), outlined, boxed or redrawn. Never recolour a logo picture yourself: the site already has the right version of each logo for a dark and a light ground.';

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

/* Answers a failed model call: the sentence, the status and the machine-readable code from gemini.js
   (plus timeoutMs on a timeout), so a page can say which failure it was without reading the wording. */
function sendAiFailure(res, r) {
  var body = { error: r.error, code: r.code, retryable: !!r.retryable };
  if (r.timeoutMs) body.timeoutMs = r.timeoutMs;
  sendJson(res, r.status, body);
}

/* ---------- what the AI cost, per event ----------
   Every model call made for an event adds what it used to the event's own record (events/<id>.aiUsage):
   { usd, calls, pictures, updatedAt, byRoute: { 'generate-content': { calls, usd, inputTokens, outputTokens }, … } }.
   Claude's calls carry their price (claude.js, from the published price list); Gemini's carry tokens only
   (usd null), and a picture counts as a picture. The Event History shows it. Recording it is never the
   reason a request fails. -> a function for opts.onUsage, or null when there is no event to add it to. */
function aiUsageRecorder(fb, eventId, route) {
  eventId = String(eventId || '').trim();
  if (!eventId || !isEventId(eventId)) return null;
  var key = String(route || 'other').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'other';
  return function (usage) {
    if (!usage) return;
    try {
      var db = (fb && !fb.error ? fb : getFirebase());
      if (!db || db.error) return;
      var inc = require('firebase-admin').firestore.FieldValue.increment;
      var step = 'aiUsage.byRoute.' + key + '.';
      var write = { 'aiUsage.calls': inc(1), 'aiUsage.updatedAt': new Date().toISOString() };
      write[step + 'calls'] = inc(1);
      write[step + 'inputTokens'] = inc(+usage.inputTokens || 0);
      write[step + 'outputTokens'] = inc(+usage.outputTokens || 0);
      write[step + (usage.provider === 'claude' ? 'claudeCalls' : 'geminiCalls')] = inc(1);
      if (typeof usage.usd === 'number' && usage.usd > 0) { write['aiUsage.usd'] = inc(usage.usd); write[step + 'usd'] = inc(usage.usd); }
      if (usage.pictures > 0) { write['aiUsage.pictures'] = inc(usage.pictures); write[step + 'pictures'] = inc(usage.pictures); }
      /* update(), never set(): it adds to an event that is there and creates nothing — not a draft that was
         discarded while the model was answering, not a document for an id somebody typed */
      db.db.collection('events').doc(eventId).update(write).catch(function (err) {
        if (err && (err.code === 5 || /NOT_FOUND|No document to update/i.test(String(err.message)))) return;
        console.error('api: the AI usage of ' + eventId + ' could not be recorded — ' + (err && err.message));
      });
    } catch (err) {
      console.error('api: the AI usage of ' + eventId + ' could not be recorded — ' + (err && err.message));
    }
  };
}

function handleSuggestDesign(req, res) {
  readBody(req, res, function (raw) {
    var payload;
    try { payload = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

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
    });
  }, BODY_LIMITS.ai);
}

/* ---------- POST /api/chat-edit — custom_editor.html's "Ask AI to edit" chat panel (template mode) ----------
   A free-text instruction, interpreted against the REAL mounted template: a partial `design` patch (the same
   canvas.design field vocabulary as /api/suggest-design, reused as-is) plus, optionally, a few grounded text
   edits ({sectionId, find, replace} — find must be a short exact substring of that section's OWN current
   text, sent as context below, so the model can't invent a replacement for text that was never there). Nothing
   is applied server-side; the browser shows the proposal and only calls canvas.design.set()/does the text
   replacement once the user confirms (see editor-template-ui.js's wireChatPanel). */
/* What the owner had selected on the page when they wrote: the section (and the element in it, if one was
   selected). Their words still win: a message that names another section or the whole site is about that. */
function chatFocusLine(payload, sections) {
  var f = payload.focus;
  if (!f || typeof f !== 'object') return '';
  var id = String(f.sectionId || '');
  var sec = sections.filter(function (s) { return s.id === id; })[0];
  if (!sec) return '';
  var name = String(f.name || sec.name || id).replace(/\s+/g, ' ').slice(0, 80);
  var el = f.element && typeof f.element === 'object' ? f.element : null;
  var kind = el ? String(el.kind || '').replace(/[^a-z0-9-]/gi, '').slice(0, 20) : '';
  var text = el ? String(el.text || '').replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  return 'WHAT THE OWNER HAS SELECTED: while writing this, the owner had the section "' + name + '" (sectionId ' + id + ') selected on the page' +
    (el ? ', and inside it ' + (kind === 'image' ? 'a picture' : 'the ' + (kind || 'element') + (text ? ' that reads "' + text + '"' : '')) : '') + '. ' +
    'Unless the message clearly names another section or the whole site, "this", "here", "it" and any change that does not say where it goes mean ' +
    (el ? 'that ' + (kind === 'image' ? 'picture' : 'element') + ' in that section' : 'that section') + ': make the change there and only there. A question about "this" is about it too.\n';
}

/* The site's forms as the editor sent them ({ id, name, purpose, fields: [label] }), cleaned: at most the 20
   an event can have, labels only. */
function chatForms(payload) {
  return (Array.isArray(payload.forms) ? payload.forms : []).filter(function (f) {
    return f && typeof f === 'object' && formsLib.FORM_ID_RE.test(String(f.id || ''));
  }).slice(0, formsLib.LIMITS.maxForms).map(function (f) {
    return {
      id: f.id, name: String(f.name || f.id).replace(/\s+/g, ' ').trim().slice(0, 80),
      purpose: formsLib.PURPOSES.indexOf(f.purpose) !== -1 ? f.purpose : 'custom',
      fields: (Array.isArray(f.fields) ? f.fields : []).map(function (l) {
        return String(l && typeof l === 'object' ? l.label || '' : l || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      }).filter(Boolean).slice(0, formsLib.LIMITS.maxFields)
    };
  });
}

/* What the AI sees of the page: pictures the editor drew of it as it looks right now (chatView), after any the
   owner attached. The owner, 28 Oct 2026: "I can't see the page as visitors do" is not an answer an AI should give. */
var CHAT_VIEW_WHAT = { page: 'the WHOLE page, top to bottom, in order', section: 'the section the owner has selected', visible: 'the part of the page the owner has in view' };
function chatViewLine(payload) {
  var n = payload.viewCount || 0;
  if (!n) return 'No screenshot of the page came with this message (the editor could not draw it in time): answer from the page\'s text and design settings below, and still do what is asked. Do not make a point of it — at most one short clause that the visual check was not possible this time; never say "I can\'t see the page".';
  return 'You can SEE the page: ' + (n === 1 ? 'the last picture with this message is a screenshot' : 'the last ' + n + ' pictures with this message are screenshots') +
    ' of the site as it looks in the editor right now — ' + (CHAT_VIEW_WHAT[payload.viewWhat] || CHAT_VIEW_WHAT.visible) + '. Look at them properly: judge the layout, spacing, alignment, colours, contrast, type, pictures and balance from what you see, and say what you see when it matters. Never say you cannot see the page. (Editor marks may show: a coloured outline around what is selected is the editor\'s, not the site\'s.)' +
    chatViewLimits(payload);
}
/* what the screenshots leave out, so the model never reports the screenshot's own limits as problems on the page */
function chatViewLimits(payload) {
  var left = Math.max(0, Math.min(999, parseInt(payload.viewLeftOut, 10) || 0));
  var undrawn = (Array.isArray(payload.viewUndrawn) ? payload.viewUndrawn : []).map(function (n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 60); }).filter(Boolean).slice(0, 12);
  var out = [];
  if (left) out.push(left + ' picture' + (left === 1 ? ' is' : 's are') + ' left out of the screenshots and shown as hatched grey boxes marked "picture" (too many to draw) — visitors see the real pictures there');
  if (undrawn.length) out.push('the section' + (undrawn.length === 1 ? '' : 's') + ' ' + undrawn.map(function (n) { return '"' + n + '"'; }).join(', ') + (undrawn.length === 1 ? ' is' : ' are') + ' not in the screenshots (or shown as a grey block marked "could not be drawn")');
  return out.length ? ' LIMITS OF THE SCREENSHOTS, NOT OF THE PAGE: ' + out.join('; ') + '. Never report these as problems on the page or advise about them; judge those parts from the text below.' : '';
}
/* the pictures the editor drew: JPEG or PNG data addresses, at most `room`, each under CHAT_VIEW_MAX_BYTES */
var CHAT_VIEW_MAX_BYTES = 900 * 1024;
function chatView(payload, room) {
  var out = [];
  (Array.isArray(payload.view) ? payload.view : []).forEach(function (u) {
    if (out.length >= room) return;
    var m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+\/=]+)$/.exec(String(u || ''));
    if (m && m[2].length * 0.75 <= CHAT_VIEW_MAX_BYTES) out.push({ mimeType: m[1], data: m[2] });
  });
  return out;
}

/* The conversation so far, as the model reads it: each turn's question, your full answer and what then really
   happened on the page (applied, partly, undone), oldest first — from the turns stored for this person
   (chatTurnsFor), else what the browser sent (an editor with no event). */
var CHAT_MEMORY_TURNS = 12;
function chatHistoryText(payload) {
  if (Array.isArray(payload.turns) && payload.turns.length) {
    return payload.turns.slice(-CHAT_MEMORY_TURNS).map(function (t) {
      var lines = ['User: ' + String(t.question || '').slice(0, 2000), 'You: ' + String(t.answer || '').slice(0, 1500)];
      var what = chatOutcomeText(t);
      if (what) lines.push('[What happened: ' + what + ']');
      return lines.join('\n');
    }).join('\n\n');
  }
  return (payload.history || []).slice(-16).map(function (h) { return (h.role === 'user' ? 'User: ' : 'You: ') + String(h.text || '').slice(0, 1500); }).join('\n');
}
function chatOutcomeText(t) {
  var done = (t.done || []).join('; '), not = (t.notDone || []).join('; ');
  if (t.status === 'answered') return '';
  if (t.status === 'undone') return 'this change was applied and then UNDONE by the owner — the page is as it was before it' + (done ? ' (it had done: ' + done + ')' : '');
  if (t.status === 'applied') return 'applied: ' + (done || 'as described');
  if (t.status === 'partly') return 'partly applied: ' + done + (not ? '; not done: ' + not : '');
  if (t.status === 'failed') return 'nothing could be applied' + (not ? ': ' + not : '') + '; the page is unchanged';
  if (t.status === 'applying') return 'it was being applied when this conversation was left; its result is not known';
  return '';
}
function buildChatPrompt(payload) {
  var sections = (payload.sections || []).filter(function (s) { return s && s.id; });
  var history = chatHistoryText(payload);
  return [
    'You are ETB2B AI, a real conversation partner helping someone edit their already-built event microsite for ET Oneworld. You can change ANYTHING on the page the owner asks for — wording, design, the layout or content of any section, the order of sections, hiding, removing or adding sections — through the tools below. What you return is APPLIED TO THE PAGE AT ONCE (the owner can undo it with one click, and nothing goes live until they publish), so do what is asked — no more. This is a CHAT, not a one-shot command box: read the conversation so far, understand what the latest message means in that context ("make it a bit darker" refers to whatever was just discussed), and respond naturally.',
    '',
    (history ? 'Conversation so far (oldest first):\n' + history + '\n' : ''),
    'The user\'s latest message:', '"' + String(payload.instruction || '').slice(0, 2000) + '"',
    '',
    chatFocusLine(payload, sections),
    chatViewLine(payload),
    (payload.attachmentCount
      ? 'The owner ATTACHED ' + payload.attachmentCount + ' picture' + (payload.attachmentCount === 1 ? '' : 's') + ' to this message, numbered 1' + (payload.attachmentCount > 1 ? ' to ' + payload.attachmentCount : '') + '. ' +
        (payload.seenPictures ? 'You can SEE ' + (payload.seenPictures === payload.attachmentCount ? 'them' : 'pictures ' + payload.seenNumbers.join(', ')) + ': they come with this message as images, in that order. Look at them properly. When the owner asks for the look of a picture (its colours, its mood, its layout), read it from the picture itself and give real values — colours as hex codes (e.g. "#0b1f3a deep navy, #c9a227 gold accent"). Never say you cannot see an attached picture you were given. ' : 'You cannot see them; the owner\'s words say what they are for. ') +
        (payload.unseenNote ? payload.unseenNote + ' ' : '') +
        'To place a picture on the page, the owner\'s words say what it is for. To put one on the page, use `sectionEdits` (or `newSections`) for the section it belongs in, list its number in that entry\'s `pictures`, and say in the instruction exactly where it goes (e.g. "replace the section\'s picture with attached picture 1", "use attached picture 1 as the section\'s background"). If the message does not say where a picture goes, ask in a "reply" instead of guessing.\n'
      : ''),
    ET_LOGO_COLOUR_RULE,
    '',
    'The site\'s current design settings:',
    JSON.stringify(payload.design || {}, null, 2),
    '',
    'The site\'s real sections right now, in page order (sectionId -> its own current text, verbatim; hidden: true means visitors do not see it; buttons: the labels of the buttons in it):',
    JSON.stringify(sections.map(function (s) {
      var buttons = (Array.isArray(s.buttons) ? s.buttons : []).map(function (b) { return String(b || '').replace(/\s+/g, ' ').trim().slice(0, 80); }).filter(Boolean).slice(0, 8);
      return { sectionId: s.id, name: s.name, hidden: s.hidden ? true : undefined, texts: s.texts || [], buttons: buttons.length ? buttons : undefined };
    }), null, 2),
    '',
    'The site\'s forms right now (what visitors fill in — a button opens one in a pop-up, or it is placed in a section; formId -> its name, purpose and questions):',
    JSON.stringify(chatForms(payload).map(function (f) { return { formId: f.id, name: f.name, purpose: f.purpose, questions: f.fields }; }), null, 2),
    '',
    'Task:',
    '1. First decide `kind`: "edit" if the latest message (read in context of the conversation) asks for a real change to the site; "undo" if it asks to take back your last change ("undo that", "go back", "revert it", "put it back as it was") — the page then returns exactly to how it was before that change, at no cost, so never re-create the old look yourself; "reply" if it\'s a question, small talk, or anything else that doesn\'t call for a change — e.g. "what can you change here?", "why didn\'t that work?", "thanks". Don\'t force an edit out of a message that\'s just a question.',
    '2. If `kind` is "reply" or "undo": leave every change list empty and `design` empty, and put your answer in `summary` — natural, helpful and as long as the question needs (a list of sections is a full list); reference the actual sections/design above, don\'t make things up. A request that is too vague to do well, where reasonable readings would change the site in very different ways ("make it look more premium", "fix the design", "make it pop"), gets ONE short clarifying question as a "reply", offering two or three concrete options to choose from (e.g. "Darker and more spacious, a more classic serif for headings, or gold accents on a deep background?"). A clear request is simply done — don\'t ask for permission.',
    '3. If `kind` is "edit": if it asks for a visual/design change (colour, font, spacing, heading style…), return a partial `design` object — ONLY the fields the instruction actually calls for, using these field names: ' + DESIGN_FIELDS.join(', ') + '. Leave out any field it didn\'t ask to change. A colour field MUST be a hex code ("#1c1c1c") — if it names a colour in words ("orange", "navy blue"), translate it to the closest real hex value yourself; never write the colour word into a colour field, it will be rejected. If it asks to change text, return `textEdits`: an array of {sectionId, find, replace}, where `find` is copied VERBATIM (exact substring, same spelling/punctuation) from that section\'s own text shown above — never invent or paraphrase the original. Never invent facts (dates, numbers, names) that aren\'t already present. A follow-up like "make it bigger instead" that refines a design mentioned earlier in the conversation should produce a fresh, complete replacement for the fields it\'s changing, not an incremental tweak instruction.',
    'A text edit applies to EVERY place that exact `find` text appears in that section. To change a word, a year, a name or a number everywhere (e.g. "change 2026 to 2027"), give `find` as just that word or number and return one edit for each section whose texts contain it — check every section\'s texts, do not stop at the first. `find` must be copied exactly from the texts above.',
    '4. For everything those two cannot do, use the tools that follow — choose the lightest tool that does the job, and combine tools freely:',
    '   - `sectionEdits`: [{sectionId, instruction}] — one section is reworked by a designer-developer who follows your instruction exactly: change its layout, add, remove or reorder cards and blocks, rewrite or extend its content, restyle only that section (colours, sizes, spacing, alignment, backgrounds), turn a grid into a carousel or a timeline, anything. Write `instruction` as a complete, specific brief in plain words, including every fact the owner gave (names, numbers, wording) — the designer sees the section and your brief, not this conversation. One entry per section that needs it. Do NOT use it for a change `textEdits` or `design` can make.',
    '   - `sectionOps`: [{op, sectionId, beforeSectionId}] — op "hide", "show" or "remove" a whole section; op "move" puts sectionId right before beforeSectionId (an empty beforeSectionId means the end of the page). The site\'s first and last sections (navigation, hero banner, footer) stay where they are.',
    '   - `newSections`: [{afterSectionId, name, instruction}] — a NEW section is designed and written from your brief and placed after afterSectionId. `name` is its short label (e.g. "Venue & Travel"); `instruction` is the complete brief: what it is for, what it must say (only facts the owner gave or that are on the page — never invented names, numbers or dates), and how it should look.',
    '   FORMS — registration and enquiry forms ("Register now", "Express interest", "Join as partner", "VIP delegates", a speaker application…). Three tools:',
    '   - `newForms`: [{ref, template, name, title, intro, fields, submitLabel, successMessage, countsAsRegistration, needsApproval}] — a NEW form. Only when the owner asks for a form or it is plainly implied ("add a VIP delegate form", "add an Express interest button" when no such form exists). If a form with that purpose or name already exists above, use it instead and do not make another. `ref` is a short id of your own ("new-1") that ctaLinks and formEmbeds use to point at it. `template` is the closest of: register (Register now — counts as a registration), interest (Express interest — an enquiry), partner (Join as partner), vip (VIP delegates — needs approval, counts as a registration), speaker (Speaker application — needs approval), blank (anything else). `fields` are its questions in order, each {label, type, required, options, placeholder, help}; type is one of ' + formsLib.FIELD_TYPES.join(', ') + '; a select, radio or multiselect question needs its `options`. Every form starts with the seven standard questions, first and in this order, all required: Official email (email), First name (text), Last name (text), Mobile number (phone — visitors pick their country code), Company (text), Designation (text), Location (location — city, state and country); list them first, then only the questions the purpose needs (never a separate full-name, phone or city question). Every form also ends with ET\'s consent box (privacy, cookie and terms), which the platform adds by itself: never add a consent, terms or privacy question. Never invent facts (dates, prices, places, names) in the intro or the success message. countsAsRegistration: true only for forms that sign people up to attend; needsApproval: true when the organisers choose who gets in.',
    '   - `ctaLinks`: [{sectionId, buttonText, newButtonLabel, form}] — make a button open a form (an existing formId, or a newForms ref). To link a button that is already there, give its label exactly as listed in that section\'s buttons as `buttonText` (newButtonLabel empty); to add a new button, give `newButtonLabel` (at most 40 characters; buttonText empty). "Add an Express interest button to the hero" means a newForms entry if no such form exists, plus a ctaLinks entry for the hero with newButtonLabel "Express interest". Only when asked.',
    '   - `formEmbeds`: [{form, sectionId, afterSectionId, heading, intro}] — put a form IN the page instead of a pop-up. With `sectionId`, it goes at the end of that section ("embed the Express interest form in the contact section"). With sectionId empty, a new section holding the form is made after `afterSectionId` (empty: just before the footer), with `heading` (at most 80 characters) and a one-line `intro` (at most 300). Only when asked.',
    '   What you still cannot do: make a new picture yourself (a section keeps the pictures it has; a picture the owner attaches to a message can be placed as described above); add or edit the event\'s speakers, agenda, partners, FAQs or contacts, which are entered under Content and appear on the page by themselves; and take payments, or send confirmation emails or WhatsApp messages — those are not available yet. If the request needs one of these, say so in `summary` and do the rest.',
    '5. Write `summary` LAST, after deciding the above. For an edit, it tells the owner in plain, friendly words what you are changing — "I\'m making the buttons green and fully rounded, and tightening the agenda\'s spacing." — the way a designer would say it: no hex codes, CSS terms or pixel values unless the owner used them, and no claim of anything that is not in `design`, `textEdits`, `sectionEdits`, `sectionOps`, `newSections`, `newForms`, `ctaLinks` or `formEmbeds` — the page shows the owner a list of what really changed beside it, so any mismatch is a bug.'
  ].join('\n');
}

var CHAT_SECTION_OPS = ['hide', 'show', 'remove', 'move'];
function chatResponseSchema(payload) {
  var sectionIds = (payload.sections || []).map(function (s) { return s.id; });
  var designProps = {};
  DESIGN_FIELDS.forEach(function (f) { designProps[f] = { type: 'STRING' }; });
  Object.keys(DESIGN_ENUM_FIELDS).forEach(function (f) { designProps[f] = { type: 'STRING', enum: DESIGN_ENUM_FIELDS[f] }; });
  Object.keys(DESIGN_NUMERIC_FIELDS).forEach(function (f) { designProps[f] = { type: 'INTEGER', minimum: DESIGN_NUMERIC_FIELDS[f][0], maximum: DESIGN_NUMERIC_FIELDS[f][1] }; });
  var schema = {
    type: 'OBJECT',
    properties: {
      kind: { type: 'STRING', enum: ['edit', 'reply', 'undo'] },
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
    required: ['kind', 'summary', 'design', 'textEdits', 'sectionEdits', 'sectionOps', 'newSections', 'newForms', 'ctaLinks', 'formEmbeds']
  };
  /* forms (lib/forms.js; the answer is checked by cleanAiFormOps) */
  schema.properties.newForms = { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    ref: { type: 'STRING' },
    template: { type: 'STRING', enum: formsLib.FORM_TEMPLATES.map(function (t) { return t.id; }) },
    name: { type: 'STRING' }, title: { type: 'STRING' }, intro: { type: 'STRING' },
    fields: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      label: { type: 'STRING' }, type: { type: 'STRING', enum: formsLib.FIELD_TYPES }, required: { type: 'BOOLEAN' },
      options: { type: 'ARRAY', items: { type: 'STRING' } }, placeholder: { type: 'STRING' }, help: { type: 'STRING' }
    }, required: ['label', 'type'] } },
    submitLabel: { type: 'STRING' }, successMessage: { type: 'STRING' },
    countsAsRegistration: { type: 'BOOLEAN' }, needsApproval: { type: 'BOOLEAN' }
  }, required: ['ref', 'template', 'name', 'fields'] } };
  schema.properties.ctaLinks = { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    sectionId: { type: 'STRING' }, buttonText: { type: 'STRING' }, newButtonLabel: { type: 'STRING' },
    form: { type: 'STRING', description: 'an existing formId, or the ref of one of newForms' }
  }, required: ['sectionId', 'form'] } };
  schema.properties.formEmbeds = { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    form: { type: 'STRING', description: 'an existing formId, or the ref of one of newForms' },
    sectionId: { type: 'STRING', description: 'the section to put it in, or empty for a new section' },
    afterSectionId: { type: 'STRING' }, heading: { type: 'STRING' }, intro: { type: 'STRING' }
  }, required: ['form'] } };
  schema.properties.sectionEdits = { type: 'ARRAY', items: { type: 'OBJECT', properties: { sectionId: { type: 'STRING' }, instruction: { type: 'STRING' }, pictures: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'numbers of the attached pictures this edit uses' } }, required: ['sectionId', 'instruction'] } };
  schema.properties.sectionOps = { type: 'ARRAY', items: { type: 'OBJECT', properties: { op: { type: 'STRING', enum: CHAT_SECTION_OPS }, sectionId: { type: 'STRING' }, beforeSectionId: { type: 'STRING' } }, required: ['op', 'sectionId'] } };
  schema.properties.newSections = { type: 'ARRAY', items: { type: 'OBJECT', properties: { afterSectionId: { type: 'STRING' }, name: { type: 'STRING' }, instruction: { type: 'STRING' }, pictures: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'numbers of the attached pictures this section uses' } }, required: ['afterSectionId', 'name', 'instruction'] } };
  if (sectionIds.length) {
    schema.properties.textEdits.items.properties.sectionId.enum = sectionIds;
    schema.properties.sectionEdits.items.properties.sectionId.enum = sectionIds;
    schema.properties.sectionOps.items.properties.sectionId.enum = sectionIds;
    schema.properties.ctaLinks.items.properties.sectionId.enum = sectionIds;
  }
  return schema;
}

/* The pictures attached to a chat message, as the model is shown them: { images: [{ mimeType, data }],
   numbers: [n] (which attachments they are), skipped: [sentence] }. Only pictures uploaded for this event to
   our own bucket (the editor's attach button puts them there) are fetched — never an address a request
   names elsewhere. A picture the model cannot take (an SVG, one too large) is left out and the model is
   told which, so it does not pretend to have seen it. */
var CHAT_PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
var CHAT_PICTURE_MAX_BYTES = 3700000;          // base64 of it stays under the 5 MB a model takes per picture
function chatPictures(eventId, urls) {
  var fb = getFirebase();
  var none = { images: [], numbers: [], skipped: [] };
  if (fb.error || !isEventId(String(eventId || '')) || !Array.isArray(urls) || !urls.length) return Promise.resolve(none);
  var own = 'https://storage.googleapis.com/' + fb.bucket.name + '/events/' + eventId + '/';
  return Promise.all(urls.slice(0, 6).map(function (url, i) {
    url = String(url || '');
    if (url.indexOf(own) !== 0 || /[?#]/.test(url.slice(own.length).replace(/\?v=\d+$/, ''))) return Promise.resolve({ n: i + 1, why: 'was not uploaded here' });
    return safeFetch(url, { timeoutMs: 8000, maxBytes: CHAT_PICTURE_MAX_BYTES }).then(function (r) {
      var info = r.status === 200 ? logoUnit.imageInfo(r.body) : null;
      if (!info || CHAT_PICTURE_TYPES.indexOf(info.mime) === -1) return { n: i + 1, why: info && info.type === 'svg' ? 'is an SVG drawing, which cannot be shown to you' : 'could not be read' };
      return { n: i + 1, image: { mimeType: info.mime, data: r.body.toString('base64') } };
    }, function (err) {
      return { n: i + 1, why: err && err.code === 'too-large' ? 'is too large to be shown to you (over 3.7 MB)' : 'could not be fetched' };
    });
  })).then(function (got) {
    var out = { images: [], numbers: [], skipped: [] };
    got.forEach(function (g) {
      if (g.image) { out.images.push(g.image); out.numbers.push(g.n); }
      else out.skipped.push('Attached picture ' + g.n + ' ' + g.why + '.');
    });
    return out;
  });
}

/* ---------- ETB2B AI, the editor's chat (POST /api/chat-edit, the history routes below) ----------
   What the AI answers is applied to the page at once and can be undone (editor-template-ui.js); there is no
   proposal to accept (the owner, 28 Oct 2026). Every exchange is kept, under the person who had it:
   events/<id>/aiChats/<uid> { uid, email, name, lastAt } and its turns/<turnId> { question, answer, kind,
   status, done, notDone, focus, pictures, at, updatedAt }. A person sees their own conversation in the editor;
   each exchange is also a line in the event's History (activity), and the event's approvers can read every
   conversation (GET /api/chat/history?all=1). The model's memory is the stored conversation, with what really
   happened after each answer (applied, partly, undone). */
var CHAT_ANSWER_CHARS = 4000;
var CHAT_MAX_PICTURES = 6;          // what one model call takes (gemini.js / claude.js MAX_IMAGES)
var CHAT_STATUSES = ['answered', 'applying', 'applied', 'partly', 'failed', 'undone'];
function chatUserRef(fb, eventId, uid) { return eventDocRef(fb, eventId).collection('aiChats').doc(String(uid).replace(/[^A-Za-z0-9_@.-]/g, '_').slice(0, 120)); }
function chatUid(decoded) { return String((decoded && (decoded.uid || decoded.email)) || 'anon'); }
function chatName(decoded) { return String((decoded && (decoded.name || decoded.email)) || 'Someone').slice(0, 120); }
/* this person's turns for the event, oldest first */
function chatTurnsFor(fb, eventId, uid, limit) {
  return chatUserRef(fb, eventId, uid).collection('turns').orderBy('at', 'desc').limit(limit || 60).get()
    .then(function (snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).reverse(); });
}
/* A person's chat turns in a sliding window, held in this server process: a runaway loop or a stuck key cannot
   spend without bound. Generous for real use (one message every ten seconds, sustained). */
var CHAT_RATE = { windowMs: 10 * 60 * 1000, max: 60 }, chatRecent = {};
function chatRateOk(uid, now) {
  now = now || Date.now();
  var list = (chatRecent[uid] || []).filter(function (t) { return now - t < CHAT_RATE.windowMs; });
  if (list.length >= CHAT_RATE.max) { chatRecent[uid] = list; return false; }
  list.push(now);
  chatRecent[uid] = list;
  return true;
}
function chatLine(text, max) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max || 120); }

function handleChatEdit(req, res) {
  withAdminBody(req, res, BODY_LIMITS.ai, function (fb, decoded, payload) {
    if (!String(payload.instruction || '').trim()) return sendJson(res, 400, { error: 'No instruction given.' });
    var eventId = isEventId(String(payload.eventId || '')) ? String(payload.eventId) : '';
    var uid = chatUid(decoded);
    if (!chatRateOk(uid)) return sendJson(res, 429, { error: 'That is a lot of messages in a short time. Please wait a few minutes and try again.', code: 'chat-rate', retryable: true });
    var userRef = eventId ? chatUserRef(fb, eventId, uid) : null;

    /* the event must exist (its usage and its conversation are kept with it), and the conversation so far is read */
    var ready = !eventId ? Promise.resolve(null) : eventDocRef(fb, eventId).get().then(function (snap) {
      if (!snap.exists) throw httpError(404, 'This event does not exist.', { code: 'no-event' });
      return chatTurnsFor(fb, eventId, uid, CHAT_MEMORY_TURNS).catch(function (err) {
        console.error('chat-edit: the conversation of ' + eventId + ' could not be read — ' + (err && err.message));
        return [];
      });
    });
    ready.then(function (turns) {
      if (turns && turns.length) payload.turns = turns;
      return chatPictures(eventId, payload.attachments);
    }).then(function (seen) {
      payload.seenPictures = seen.images.length;
      payload.seenNumbers = seen.numbers;
      payload.unseenNote = seen.skipped.length ? seen.skipped.join(' ') + ' Tell the owner so if it matters for the answer.' : '';
      /* the page as it looks, after the owner's own pictures (a model takes six pictures at most) */
      var view = chatView(payload, CHAT_MAX_PICTURES - seen.images.length);
      payload.viewCount = view.length;
      payload.viewWhat = CHAT_VIEW_WHAT[payload.viewWhat] ? payload.viewWhat : 'visible';
      var images = seen.images.concat(view);
      return llm.callJson(buildChatPrompt(payload), chatResponseSchema(payload), { route: 'chat-edit', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.small, images: images.length ? images : undefined, onUsage: aiUsageRecorder(null, eventId, 'chat-edit') });
    }).then(function (r) {
      if (r.error) return sendAiFailure(res, r);
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

      function brief(v) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 1500); }
      var attached = Math.max(0, Math.min(6, parseInt(payload.attachmentCount, 10) || 0));
      function picturesOf(v) {
        var out = [];
        (Array.isArray(v) ? v : []).forEach(function (n) { n = parseInt(n, 10); if (n >= 1 && n <= attached && out.indexOf(n) === -1) out.push(n); });
        return out;
      }
      var sectionEdits = [], edited = {};
      (parsed.sectionEdits || []).forEach(function (e) {
        if (!e || knownSectionIds.indexOf(e.sectionId) === -1 || edited[e.sectionId] || !brief(e.instruction)) return;
        edited[e.sectionId] = true;
        sectionEdits.push({ sectionId: e.sectionId, instruction: brief(e.instruction), pictures: picturesOf(e.pictures) });
      });
      var sectionOps = (parsed.sectionOps || []).map(function (o) {
        if (!o || CHAT_SECTION_OPS.indexOf(o.op) === -1 || knownSectionIds.indexOf(o.sectionId) === -1) return null;
        var before = knownSectionIds.indexOf(o.beforeSectionId) !== -1 ? o.beforeSectionId : '';
        return o.op === 'move' ? { op: 'move', sectionId: o.sectionId, beforeSectionId: before } : { op: o.op, sectionId: o.sectionId };
      }).filter(Boolean).slice(0, 12);
      var newSections = (parsed.newSections || []).map(function (n) {
        if (!n || !brief(n.instruction)) return null;
        return { afterSectionId: knownSectionIds.indexOf(n.afterSectionId) !== -1 ? n.afterSectionId : '', name: String(n.name || 'New section').trim().slice(0, 60) || 'New section', instruction: brief(n.instruction), pictures: picturesOf(n.pictures) };
      }).filter(Boolean).slice(0, 4);

      /* forms: each new form checked as a form the routes would store, every link and placement checked
         against the page and the forms it names (lib/forms.js cleanAiFormOps) */
      var formOps = formsLib.cleanAiFormOps(parsed, { sections: payload.sections || [], forms: chatForms(payload) });
      skipped = skipped.concat(formOps.skipped);

      var summary = String(parsed.summary || '').trim().slice(0, CHAT_ANSWER_CHARS);
      var hasChange = Object.keys(design).length || textEdits.length || sectionEdits.length || sectionOps.length || newSections.length ||
        formOps.newForms.length || formOps.ctaLinks.length || formOps.formEmbeds.length;
      if (!summary && !hasChange) {
        return sendJson(res, 502, { error: 'The AI gave an answer we could not use. Try again.', code: 'ai-bad-output', retryable: true });
      }
      var kind = parsed.kind === 'reply' ? 'reply' : parsed.kind === 'undo' ? 'undo' : hasChange ? 'edit' : 'reply';
      var answer = { kind: kind, summary: summary || 'Done.', design: design, textEdits: textEdits,
        sectionEdits: sectionEdits, sectionOps: sectionOps, newSections: newSections,
        newForms: formOps.newForms, ctaLinks: formOps.ctaLinks, formEmbeds: formOps.formEmbeds, skipped: skipped };
      if (kind !== 'edit') ['textEdits', 'sectionEdits', 'sectionOps', 'newSections', 'newForms', 'ctaLinks', 'formEmbeds'].forEach(function (k) { answer[k] = []; });
      if (kind !== 'edit') answer.design = {};
      if (!userRef) return sendJson(res, 200, answer);
      /* kept under the person who asked: a reply is finished; a change is "applying" until the editor says how it went */
      var now = new Date().toISOString(), turnRef = userRef.collection('turns').doc();
      var focus = payload.focus && typeof payload.focus === 'object' ? chatLine(payload.focus.name, 80) : '';
      var turn = { question: String(payload.instruction).trim().slice(0, 4000), answer: answer.summary, kind: kind,
        status: kind === 'edit' ? 'applying' : 'answered', done: [], notDone: [], focus: focus,
        pictures: Math.max(0, Math.min(6, (payload.attachments || []).length || 0)), at: now, updatedAt: now };
      return Promise.all([
        userRef.set({ uid: uid, email: String(decoded.email || ''), name: chatName(decoded), lastAt: now }, { merge: true }),
        turnRef.set(turn)
      ]).then(function () {
        answer.turnId = turnRef.id;
        sendJson(res, 200, answer);
        if (kind !== 'edit') logActivity(fb, eventId, decoded, 'ai-chat', 'Asked ETB2B AI: “' + chatLine(turn.question) + '”' + (kind === 'undo' ? ' — undo' : ' — answered'), { area: 'site' });
      }, function (err) {
        /* the answer is not withheld because it could not be kept: the owner is told the conversation was not saved */
        console.error('chat-edit: the turn of ' + eventId + ' was not kept — ' + (err && err.message));
        answer.notKept = true;
        sendJson(res, 200, answer);
      });
    }).catch(function (err) { sendStepFailure(res, err, err && err.status === 404 ? 404 : 500, 'The chat could not answer. Please try again.'); });
  });
}

/* POST /api/chat/turn { eventId, turnId, status, done: [..], notDone: [..] } — what really happened to a change
   the AI answered with: applied, partly, failed, or undone later. Only the person whose turn it is reports it. */
function handleChatTurn(req, res) {
  withAdminBody(req, res, BODY_LIMITS.small, function (fb, decoded, body) {
    var eventId = String(body.eventId || '').trim(), turnId = String(body.turnId || '').trim();
    if (!isEventId(eventId) || !/^[A-Za-z0-9]{10,40}$/.test(turnId)) return sendJson(res, 400, { error: 'eventId and turnId are required.' });
    var status = CHAT_STATUSES.indexOf(body.status) !== -1 && body.status !== 'answered' && body.status !== 'applying' ? body.status : '';
    if (!status) return sendJson(res, 400, { error: 'status must be applied, partly, failed or undone.' });
    function lines(v) { return (Array.isArray(v) ? v : []).map(function (x) { return chatLine(x, 300); }).filter(Boolean).slice(0, 30); }
    var ref = chatUserRef(fb, eventId, chatUid(decoded)).collection('turns').doc(turnId);
    ref.get().then(function (snap) {
      if (!snap.exists) return sendJson(res, 404, { error: 'This conversation turn is not yours or no longer exists.' });
      var was = snap.data(), patch = { status: status, updatedAt: new Date().toISOString() };
      if (status !== 'undone') { patch.done = lines(body.done); patch.notDone = lines(body.notDone); }
      return ref.update(patch).then(function () {
        sendJson(res, 200, { turnId: turnId, status: status });
        if (was.status === status) return;
        var q = '“' + chatLine(was.question) + '”';
        var detail = status === 'undone' ? 'Undid an ETB2B AI change: ' + q
          : status === 'failed' ? 'ETB2B AI could not apply: ' + q
          : 'ETB2B AI changed the site: ' + q + (patch.done.length ? ' — ' + chatLine(patch.done.join('; '), 140) : '');
        logActivity(fb, eventId, decoded, 'ai-chat', detail, { area: 'site' });
      });
    }).catch(function (err) { sendFailure(res, 'chat turn', err, 'That could not be recorded. Please try again.'); });
  });
}

/* GET /api/chat/history?eventId=…  -> { turns: [..] } this person's conversation, oldest first.
   &all=1 -> { people: [{ uid, email, name, turns }] } every conversation of the event, for its approvers
   (config/approvals; with none named, nobody reads other people's conversations here — the History has a line
   for each exchange). */
function handleChatHistory(req, res) {
  withAdmin(req, res, function (fb, decoded) {
    var q = queryOf(req), eventId = String(q.get('eventId') || '').trim();
    if (!isEventId(eventId)) return sendJson(res, 400, { error: 'eventId is required.' });
    function shape(t) { return { id: t.id, question: t.question, answer: t.answer, kind: t.kind, status: t.status, done: t.done || [], notDone: t.notDone || [], focus: t.focus || '', pictures: t.pictures || 0, at: t.at }; }
    if (q.get('all') !== '1') {
      return chatTurnsFor(fb, eventId, chatUid(decoded), 60).then(function (turns) { sendJson(res, 200, { turns: turns.map(shape) }); })
        .catch(function (err) { sendFailure(res, 'chat history', err, 'The conversation could not be loaded.'); });
    }
    approvalsConfig(fb).then(function (cfg) {
      var me = String(decoded.email || '').toLowerCase();
      if (!cfg.approvers.length || cfg.approvers.indexOf(me) === -1) return sendJson(res, 403, { error: 'Only the event approvers can read everyone\'s conversations.', code: 'not-approver' });
      return eventDocRef(fb, eventId).collection('aiChats').get().then(function (snap) {
        return Promise.all(snap.docs.map(function (d) {
          var who = d.data() || {};
          return d.ref.collection('turns').orderBy('at', 'desc').limit(200).get().then(function (ts) {
            return { uid: who.uid || d.id, email: who.email || '', name: who.name || who.email || d.id, lastAt: who.lastAt || '',
              turns: ts.docs.map(function (x) { return shape(Object.assign({ id: x.id }, x.data())); }).reverse() };
          });
        }));
      }).then(function (people) {
        people.sort(function (a, b) { return String(b.lastAt).localeCompare(String(a.lastAt)); });
        sendJson(res, 200, { people: people });
      });
    }).catch(function (err) { sendFailure(res, 'chat history', err, 'The conversations could not be loaded.'); });
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
    'You are extracting a structured brief from an event overview document, for ET Oneworld\'s event microsite builder.',
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
// and well under Cloud Functions' own request size ceiling.
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
    /* the model is only ever given a document to read as a PDF or as plain text */
    mimeType = mimeType.split(';')[0].trim().toLowerCase();
    if (mimeType !== 'application/pdf' && mimeType !== 'text/plain') {
      return sendJson(res, 415, { error: 'Upload the brief as a PDF, or type the description instead.', code: 'unsupported-file' });
    }

    var buffer;
    try { buffer = Buffer.from(docBase64, 'base64'); } catch (e) { return sendJson(res, 400, { error: 'docBase64 is not valid base64.' }); }
    if (buffer.length === 0) return sendJson(res, 400, { error: 'The uploaded document is empty.' });
    if (buffer.length > MAX_BRIEF_BYTES) return sendJson(res, 413, { error: 'The uploaded document is larger than the 15MB pilot limit.' });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    var eventMeta = payload.eventMeta || {};
    var storagePath = 'events/' + eventId + '/briefs/' + fileName;
    /* what the owner typed in "Describe the event": the document itself when there is no other, else sent
       beside it (briefText). Its filled-in headings are the owner's brief (owner-brief.js). */
    var ownerText = String(payload.briefText || (mimeType === 'text/plain' ? buffer.toString('utf8') : '') || eventMeta.description || '').slice(0, 8000);

    var watch = null;
    watchEvent(fb, eventId)
      .then(function (w) { watch = w; return fb.bucket.file(storagePath).save(buffer, { metadata: { contentType: mimeType } }); })
      .then(function () {
        return llm.callJson(buildExtractBriefPrompt(eventMeta, mimeType === 'application/pdf' ? ownerText : ''), BRIEF_SCHEMA, { inlineFile: { mimeType: mimeType, data: docBase64 }, route: 'extract-brief', eventId: eventId, onUsage: aiUsageRecorder(fb, eventId, 'extract-brief'), maxOutputTokens: AI_OUTPUT_TOKENS.small });
      })
      .then(function (r) {
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
        var eventRef = fb.db.collection('events').doc(eventId);
        /* the event's facts as the form gave them — never its description: what the owner typed is the brief
           (kept with the brief below), and the description is written from it at design time
           (event-description.js) */
        return watch.merge(Object.assign({}, eventDescription.storedFacts(eventMeta), { updatedAt: now }))
          .then(function () { return eventRef.collection('briefs').add({
            sourceFileName: fileName, mimeType: mimeType, storagePath: storagePath,
            extracted: extracted, model: r.model || GEMINI_TEXT_MODEL, createdAt: now
          }); })
          .then(function (briefRef) {
            sendJson(res, 200, { eventId: eventId, briefId: briefRef.id, extracted: extracted });
            if (watch.live) logActivity(fb, eventId, req.user, 'brief-updated', 'brief read from “' + fileName.slice(0, 120) + '”', { area: 'content' });
          });
      })
      .catch(function (err) {
        /* the document uploaded for an event that is no longer there must not be left behind */
        if (err && err.body && err.body.code === 'event-gone') fb.bucket.file(storagePath).delete().catch(function () { /* already removed with the event */ });
        sendStepFailure(res, err, 500, 'extract-brief failed: ' + err.message);
      });
  }, BODY_LIMITS.brief);
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
function confirmEtPick(pick, url) {
  if (!pick) return Promise.resolve(null);
  var award = pick.kind === 'award';
  return (award ? etEvents.listAwards : etEvents.listIpEvents)(pick.portal, etJson).then(function (events) {
    var ev = events.filter(function (e) { return String(e.id) === pick.id; })[0];
    if (ev && pageKey(ev.link) && pageKey(ev.link) === pageKey(url)) return pick;
    console.warn('ingest-source: etEvent ' + pick.portal + '/' + pick.id + (ev ? ' is not ' + url : award ? ' is not an award of that portal' : ' is not an IP event of that portal') + ' — read by its address');
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

/* ---------- GET /api/et/portals, GET /api/et/events?portal=<slug>[&kind=award] — Create Event's previous-edition picker ----------
   ET's B2B portals, and one portal's own (IP) events from ET's event API — or, with kind=award (an Awards
   event), the portal's awards from ET's award listing (et-events.js; each kept 6 hours). */
function etJson(u, headers) {
  return safeFetch(u, { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024, headers: Object.assign({ accept: 'application/json' }, headers || {}) })
    .then(function (r) { return r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null; });
}
function handleEtPortals(req, res) {
  withAdmin(req, res, function () { sendJson(res, 200, { portals: etEvents.portalList() }); });
}
function handleEtEvents(req, res) {
  withAdmin(req, res, function () {
    var portal = String(queryOf(req).get('portal') || '').trim();
    if (!etEvents.isPortal(portal)) return sendJson(res, 400, { error: 'Unknown portal "' + portal.slice(0, 40) + '".', code: 'unknown-portal' });
    var kind = String(queryOf(req).get('kind') || 'event');
    if (kind !== 'event' && kind !== 'award') return sendJson(res, 400, { error: 'kind must be "event" or "award".', code: 'bad-kind' });
    (kind === 'award' ? etEvents.listAwards : etEvents.listIpEvents)(portal, etJson).then(function (events) {
      sendJson(res, 200, { portal: portal, kind: kind, events: events, partial: !!events.partial });
    }, function (err) {
      console.error('et/events: ' + portal + (kind === 'award' ? ' awards' : '') + ' — ' + (err && err.message));
      sendJson(res, 502, { error: 'ET\'s ' + (kind === 'award' ? 'award' : 'event') + ' list could not be read right now. Please try again in a few minutes.', code: 'et-down' });
    });
  });
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

/* the top bar's short names for an award site's internal pages */
var AWARD_TAB_LABELS = { 'award-category': 'Categories', 'award-guidelines': 'Guidelines', 'award-judging-criteria': 'Judging Criteria', 'award-jury': 'Jury', 'award-faq': 'FAQs', 'award-tnc': 'T&C' };

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

function handleIngestSource(req, res) {
  readBody(req, res, function (raw) {
    var payload;
    try { payload = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    var eventId = String(payload.eventId || '').trim();
    var url = String(payload.url || '').trim();
    var type = Object.prototype.hasOwnProperty.call(SOURCE_TYPE_LABELS, payload.type) ? payload.type : 'previousEdition';
    if (!eventId || !url) return sendJson(res, 400, { error: 'eventId and url are required.' });
    if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });
    if (!/^https?:\/\//i.test(url)) return sendJson(res, 400, { error: 'url must start with http:// or https://.' });
    var etPick = etPickOf(payload.etEvent);
    if (etPick === false) return sendJson(res, 400, { error: 'etEvent must name a known portal and a numeric event id.' });

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, 20000);
    /* reading a page that had to be rendered can take two minutes: the model works in what is left */
    var deadlineAt = Date.now() + 270000;

    var watch = null;
    watchEvent(fb, eventId)
      .then(function (w) { watch = w; return fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RevampCMS-Pilot/1.0)' } }); })
      .then(function (r) {
        if (r.ok) return r.text();
        /* Some sites (several ET verticals among them) turn away anything that is not a browser. The page
           is then read the way an imported one is: by the rendering service, in a real browser. */
        if ([401, 403, 406, 429, 503].indexOf(r.status) === -1 || !process.env.LOVABLE_SCRAPER_URL) throw new Error('page returned HTTP ' + r.status);
        clearTimeout(timer);
        return validateImportUrl(url).then(function (problem) {
          if (problem) throw new Error('page returned HTTP ' + r.status);
          return scrapeLovableUrl(url).then(function (rendered) { return stripAllScriptTags(rendered); });
        });
      })
      .then(function (html) {
        clearTimeout(timer);
        return fetchSourceCss(url, html).then(function (css) { return { html: html, css: css }; });
      })
      .then(function (page) {
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
            type: type, url: url, extractedSections: sections, colorSignals: colorSignals, fontSignals: fontSignals,
            design: design, tone: tone, logoCandidates: logoCandidates, editionHints: editionHints, fetchedAt: now,
            previous: previous || null, look: look, keyVisual: keyVisual, sectionPictures: pictureKinds, award: award
          };
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
        clearTimeout(timer);
        if (timedOut) return sendJson(res, 504, { error: 'Fetching ' + url + ' took too long (over 20s).' });
        sendStepFailure(res, err, 502, 'Could not ingest ' + url + ': ' + err.message);
      });
  }, BODY_LIMITS.small);
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

/* the family's stylesheet, asking only for weights it has ('' for a family not on Google Fonts) */
function googleFontUrl(family) {
  return googleFonts.cssUrl(family);
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
    'You are the lead designer of a bespoke event microsite, for ET Oneworld\'s event builder. You decide its SECTION STRUCTURE, the layout of every section, its colours and type, and which sections carry a picture. A second step writes the HTML and CSS from exactly what you decide here, so be specific.',
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
    'THE HERO IS FIXED, as on every Economic Times event site: centred, and holding only The Economic Times Business Verticals logo, the event\'s name as a wordmark, ONE line (design.heroTagline), the date and place, and two buttons. It never carries an overview, a paragraph, numbers or tracks — so the overview of the event is the FIRST section of your list, and everything a visitor needs to understand the event lives in the sections. (The server places the sponsors directly under the hero, ahead of the overview: this edition\'s sponsors section when the site has one, then the previous edition\'s sponsors; list it wherever you like — the other sections keep your order.)',
    '',
    'Set each section\'s kind to "custom" unless it is really one of 6 specific data-bound types, each backed by real records the ET ops team manages by hand, never your invention: "speakers" (real speaker bios), "sessions" (the real agenda), "faq" (real FAQs), "partners" (real sponsor/partner logos), "contact" (real contacts), "glimpses" (a real photo gallery).' + (payload.siteMode === 'standard' ? '' : ' Only use one of those when the material genuinely supports that this event will have real data of that kind.') + (payload.siteMode === 'award' ? ' On an award site, "speakers" is never used: the jury is built from records.' : ''),
    '',
    'LAYOUT: give every section its own layout (sections[].layout) and make neighbouring sections differ — a page of identical centred-heading-plus-card-grid sections is a failure. Mix: picture/text splits, full-width bands, large-number rows, timelines, quote blocks, card grids, lists, and a carousel (a sideways-scrolling row with previous/next buttons — say "carousel" in the layout) where a section has many items of one kind, such as speakers, partner logos, photos or testimonials, or where the reference uses one.',
    (NEW_ET_STANDARD
      ? 'ET\'S NEWER STANDARD (its upcoming event sites, 23 Oct 2026) — build the page this way: right under the hero a band of big numbers (by-the-numbers: 4 to 6 figures — delegates, speakers, sessions, exhibitors, networking minutes, days — from the material); a "What awaits you" band (what-awaits: 3 or 4 tall photo cards, numbered, one per format or moment of the day — the conference, boardrooms, networking, the expo floor, an awards night — each with a short caption); a closing call to act (closing-cta) on a full-width photo, with the main buttons; and every other section as the list allows. Headlines are editorial — a short statement, not the section\'s label ("Region Rewriting How It Learns.", "Four scenes, one day.") — under a small numbered eyebrow ("01  OVERVIEW"). design.headingFont is a SERIF DISPLAY face (Playfair Display, Fraunces, DM Serif Display or Cormorant Garamond) with a clean sans for the body. BANDS: the page alternates light sections with a few deep, dark bands — the what-awaits band, the discussion topics and the closing call to act — in a very deep shade of the brand colour (or near-black) with light text; never two dark bands next to each other.'
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

/* ---------- THE LOGO UNIT — the event's signature at the top of the hero ----------
   One picture (design.logoUnitUrl), made while the plan's other pictures are made (buildLogoUnit):

     the owner uploaded a logo (events/<id>.logoUrl)  ->  THAT logo. Owner-supplied content wins over anything
       derived; it is examined exactly as a previous edition's unit is (below), and used as uploaded — its
       own file, its own size — when the examination finds nothing to change (ownerLogoUnit).
     else a previous (or this) edition's site was given  ->  ITS logo unit. ingest-source kept the
       candidates it found on that page (logo-unit.js); here the best one that really is a picture is
       fetched and stored for this event (previousEditionUnit).
     else, or when that unit's year could not be brought up to this edition's  ->  a new unit is drawn as
       one SVG file: The Economic Times Business Verticals logo exactly as supplied, and the event's name set
       in the design's own heading font (embedded, so it is the same on every screen) with its keyword
       largest. A previous edition's lock-up still showing its own year is never used: the owner is told why
       its name stands there instead, and how to put this year's logo in.

   The examination (examineUnit), the same for both lock-ups:
     - the year it shows is read as written ("2026", "'26", "’26", "26", "FY26", "2026-27") and compared
       in code (logo-unit.js shownYear); another edition's is moved on to the event's year in the same
       form ("'26" -> "'27"), and only where that can be done without redrawing anything else:
         - an SVG whose year is real text: that text is changed, nothing else;
         - a PNG with the year drawn in: the picture is kept pixel for pixel, only the characters that
           change are emptied and set again over it, as text, in the face closest to the lettering;
         - an SVG whose lettering is drawn as outlines: drawn as a picture, read, the year's shapes
           replaced (outlinedYear).
       The change is kept only when a second reading finds the new year there and the old one gone.
     - a sponsor's mark, a "Presented by" / "In association with" line or another edition's mark drawn into
       it is cropped out — from a PNG (cropToOwnUnit) or from an outlined SVG, by its viewBox
       (cropSvgToOwnUnit) — only across empty lines, and an extra sharing its lines with the lock-up
       ("PRESENTS" beside the top of an emblem) emptied by itself; kept only when a second reading finds
       none of it left and the event's own words and tagline still there; otherwise it stays and the owner
       is told. The event's own tagline is part of it and always stays.
     - a lock-up stacked with its sponsors (taller than wide) is taken, and used only once they are cut away.
     - whenever a previous edition's logo was named and is not what the hero shows, the owner is told why
       (previousUnitNote) — in the editor and in the console — never silently replaced by the drawn name.
     - nothing else: never boxed, never redrawn. Most ET lock-ups carry no year at all: they are used
       untouched. The hero takes the tone the lock-up was drawn for (white lettering -> a dark banner), so
       it always stands clear, on nothing.

   buildLogoUnit() never rejects and never fails the plan: with no picture the hero falls back to the unit
   set in type (genDesign.logoUnitHtml). -> { url, storagePath, source, from, width, height, heroMode, plate, note } */
var LOGO_UNIT_MAX_BYTES = 3 * 1024 * 1024;
var LOGO_UNIT_TRIES = 3;
var LOGO_READ_TIMEOUT_MS = 60000;
var LOGO_UNIT_DECODE_PIXELS = 2500000;       // 10 MB as RGBA; the copies made of it stay well inside the instance
/* the fonts the year of a lock-up drawn as outlines can be set in: geometric, grotesque, condensed and serif
   faces, so the reader of the picture can name the nearest */
var YEAR_FONT_CHOICES = ['Outfit', 'Lexend', 'Urbanist', 'Montserrat', 'Poppins', 'Manrope', 'Inter', 'Plus Jakarta Sans', 'Space Grotesk',
  'Sora', 'Red Hat Display', 'Barlow', 'Josefin Sans', 'Raleway', 'Oswald', 'Bebas Neue', 'Roboto', 'Open Sans', 'Lato',
  'Playfair Display', 'Source Serif 4', 'Merriweather', 'Libre Baskerville', 'DM Serif Display', 'Cormorant Garamond'];
var LOGO_READ_SCHEMA = {
  type: 'OBJECT',
  properties: {
    allText: { type: 'STRING', description: 'Every word and number drawn in the picture, in reading order, exactly as drawn (an apostrophe before a year included).' },
    /* The year AS WRITTEN. A lock-up often writes it short ("summit '26"), and a reading that only had room
       for "2026" gave nothing for it: the year was then never moved (AutoTech Summit 2027 shipped '26).
       What the year is, and whether it is an earlier edition's, is worked out in code from what is written
       (logo-unit.js shownYear), not left to the model. */
    year: { type: 'STRING', description: 'The year of the edition exactly as it is drawn in the picture, with any apostrophe or prefix written with it: "2026", "\'26", "’26", "26", "FY26", "2026-27". Else an empty string. A year that is part of a slogan (e.g. "@2047") or a founding year ("Since 2015") is not the edition\'s year.' },
    yearFull: { type: 'STRING', description: 'When there is a year: the same year as four digits ("2026" for "\'26", "’26", "26" or "FY26"; the first year of "2026-27"). Else an empty string.' },
    yearBox: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'When there is a year: [ymin, xmin, ymax, xmax] of the year exactly as drawn — its digits together with the apostrophe, prefix or second year written with them, and nothing else — each 0-1000 relative to the picture. Else an empty list.' },
    yearFont: { type: 'STRING', enum: ['serif', 'sans-serif'] },
    yearWeight: { type: 'STRING', enum: ['regular', 'bold'] },
    yearFontFamily: { type: 'STRING', enum: YEAR_FONT_CHOICES, description: 'When there is a year: of these Google Fonts, the one whose digits look most like the year\'s.' },
    yearFontWeight: { type: 'STRING', enum: ['300', '400', '500', '600', '700', '800'], description: 'When there is a year: how heavy its digits are, as a font weight.' },
    /* The event's own line is part of its identity and stays in the lock-up: "DEFINING INDIA'S DECADE IN
       AUTO TECHNOLOGY" was cut out of the AutoTech Summit's unit as if it were a sponsor's. */
    tagline: { type: 'STRING', description: 'The event\'s OWN tagline, strapline or descriptor line when one is drawn as part of its lock-up (e.g. "DEFINING INDIA\'S DECADE IN AUTO TECHNOLOGY"), word for word. Else an empty string. It belongs to the event and is NOT an extra.' },
    extras: { type: 'STRING', description: 'Anything drawn inside that is NOT the event\'s own identity: a sponsor\'s or partner\'s name or logo ("Powered by …", "Presented by …", "In association with …", "Title partner …"), the mark or name of another event, an edition number ("10th edition"), a date or a venue. Else an empty string. NOT extras: the publisher\'s own mark (ET, The Economic Times, an ET vertical such as ETAuto), the event\'s name, its emblem or artwork, its year, and the event\'s own tagline or descriptor line (that is tagline).' },
    /* Where the extras are, and where the event's own lock-up is: extras often stand both above it ("X and Y
       present") and below it ("In association with Z"), so no one box can hold them all and nothing else.
       Which part is which is the model's to say; where exactly to cut is read from the pixels
       (cropToOwnUnit). */
    extraBoxes: {
      type: 'ARRAY',
      description: 'When there are extras: one entry for each group of them that stands apart (a row of sponsor logos, a "Presented by" or "In association with" line). Never the event\'s own tagline. Else an empty list.',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING', description: 'The words of this group, as drawn.' },
          box: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '[ymin, xmin, ymax, xmax] of this group, each 0-1000 relative to the picture, tight round it.' }
        },
        required: ['text', 'box']
      }
    },
    ownBox: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'When there are extras: [ymin, xmin, ymax, xmax], each 0-1000 relative to the picture, of the event\'s OWN lock-up — the publisher\'s mark, the event\'s name, its own tagline and the emblem or artwork drawn with it — enclosing all of that and none of the extras. Else an empty list.' }
  },
  required: ['allText', 'year', 'yearFull', 'yearBox', 'yearFont', 'yearWeight', 'tagline', 'extras', 'extraBoxes', 'ownBox']
};
function logoReadPrompt(eventName) {
  var name = String(eventName || '').replace(/\s+/g, ' ').replace(/"/g, '\'').trim().slice(0, 160);
  return 'This picture is the logo unit (lock-up) of an event' + (name ? ', "' + name + '"' : '') + '. It is shown here on a plain grey background that is not part of it. Read it carefully and answer.';
}

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

function storePublicPicture(fb, storagePath, buffer, contentType) {
  var file = fb.bucket.file(storagePath);
  var metadata = { contentType: contentType, cacheControl: 'public, max-age=31536000, immutable' };
  /* An SVG is shown through <img>, where it cannot run anything. Opened on its own it is a document: it is
     offered as a download instead, so that a drawing taken from somebody else's page never runs here. */
  if (contentType === 'image/svg+xml') metadata.contentDisposition = 'attachment';
  /* an SVG is stored gzipped: sent compressed (pictures.js gzipWorthIt) */
  return file.save(buffer, { metadata: metadata, gzip: pictures.gzipWorthIt(contentType, buffer) })
    .then(function () { return file.makePublic(); })
    .then(function () { return 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath; });
}

/* A Google font cut down to the characters needed, as { family, ttfBase64, metrics } — or null: the unit
   is then set in a system face. Google answers TrueType to a request that names no browser. */
/* The font for a lock-up's new year: the family the reader named at its weight, else at the weights every
   family has, else the plain stand-in of its kind (Google answers 400 for a weight a family lacks). */
function yearFont(family, weight, serif, text) {
  var tries = [[family, weight], [family, 400], [family, 700], [serif ? 'Source Serif 4' : 'Inter', weight]], seen = {};
  tries = tries.filter(function (t) { var k = t[0] + '@' + t[1]; return t[0] && !seen[k] && (seen[k] = 1); });
  function next(i) {
    if (i >= tries.length) return Promise.resolve(null);
    return fetchUnitFont(tries[i][0], tries[i][1], text).then(function (f) { return f || next(i + 1); });
  }
  return next(0);
}
function colourDistance(p, q) {
  var a = parseInt(p.slice(1), 16), b = parseInt(q.slice(1), 16);
  return Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));
}

function fetchUnitFont(family, weight, text) {
  family = String(family || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  if (!family) return Promise.resolve(null);
  return safeFetch(logoUnit.googleFontCssUrl(family, weight, text), { timeoutMs: 6000, maxBytes: 200 * 1024 }).then(function (r) {
    var fontUrl = r.status === 200 ? logoUnit.fontUrlFromCss(r.body.toString('utf8')) : '';
    if (!fontUrl) return null;
    return safeFetch(fontUrl, { timeoutMs: 6000, maxBytes: 600 * 1024 }).then(function (f) {
      var metrics = f.status === 200 ? logoUnit.fontMetrics(f.body) : null;
      return metrics ? { family: family, ttfBase64: f.body.toString('base64'), metrics: metrics } : null;
    });
  }).then(null, function () { return null; });
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
/* logo-unit.js's rules, and two things they read past: an element under a namespace prefix (<x:script>),
   and a style sheet pulled in by a processing instruction */
function svgCouldRun(text) {
  return logoUnit.svgIsActive(text) || /<\s*[\w-]+:(script|foreignObject|iframe|embed|object|handler|listener|set|animate)\b/i.test(text) || /<\?xml-stylesheet/i.test(text);
}
/* An SVG with a viewBox and no size of its own has no natural size as a picture: in a centred column it
   is laid out 0 by 0. Its size is written into its root tag from what imageInfo read (the viewBox). */
function sizedSvg(text, info) {
  var at = text.search(/<svg[\s>]/i);
  if (at === -1 || !(info.width > 0) || !(info.height > 0)) return text;
  var end = text.indexOf('>', at);
  if (end === -1) return text;
  var tag = text.slice(at, end);
  var w = /\swidth\s*=\s*["']\s*[\d.]+(px)?\s*["']/i.test(tag), h = /\sheight\s*=\s*["']\s*[\d.]+(px)?\s*["']/i.test(tag);
  if (w && h) return text;
  tag = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '') + ' width="' + Math.round(info.width) + '" height="' + Math.round(info.height) + '"';
  return text.slice(0, at) + tag + text.slice(end);
}
/* Is an SVG a picture wrapped in an SVG (the picture is the lock-up), or a lock-up drawn as outlines that
   only carries small pictures (a sponsor's icon, a gradient's piece)? -> true when a picture embedded in it
   fills a quarter of its drawing or more, when it draws nothing but pictures, or when the sizes cannot be
   told (the picture is then taken to be the lock-up, as before). */
/* A lock-up too large to work on pixel by pixel, drawn at a working size (RASTER_WIDTH wide), transparent: the
   copy its year is moved in and its extras cut from. -> Promise<{ bytes, info, decoded } | null> */
function workingCopy(svgText) {
  if (!svgText) return Promise.resolve(null);
  return rasterise(svgText, { clear: true }).then(function (r) {
    if (!r || !(r.width * r.height <= LOGO_UNIT_DECODE_PIXELS)) return null;
    var info = logoUnit.imageInfo(r.png), decoded = pngLite.decode(r.png);
    return decoded ? { bytes: r.png, info: info, decoded: decoded } : null;
  }, function () { return null; });
}
/* a PNG, JPEG or WebP lock-up as an SVG holding it, so that it can be drawn at a working size ('' when it
   cannot be: another kind, or too large to draw) */
function wrapPictureSvg(picture) {
  var info = picture && picture.info || {};
  if (['png', 'jpeg', 'webp'].indexOf(info.type) === -1 || !(info.width > 0 && info.height > 0)) return '';
  var data = picture.bytes.toString('base64');
  if (data.length + 400 > RASTER_MAX_SVG_BYTES) return '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + info.width + ' ' + info.height + '" width="' + info.width + '" height="' + info.height + '">' +
    '<image width="' + info.width + '" height="' + info.height + '" href="data:' + info.mime + ';base64,' + data + '"/></svg>';
}
/* the area a <use>'s transform scales what it places by, for a plain matrix / scale / translate; null for any
   other (a rotation, a skew, several in a row: the picture's size is then not known) */
function useScale(transform) {
  var t = String(transform || '').trim(), m;
  if (!t) return 1;
  if ((m = /^matrix\(\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+[-\d.e]+[\s,]+[-\d.e]+\s*\)$/i.exec(t))) {
    if (Math.abs(+m[2]) > 1e-6 || Math.abs(+m[3]) > 1e-6) return null;
    return Math.abs(+m[1] * +m[4]);
  }
  if ((m = /^scale\(\s*([-\d.e]+)(?:[\s,]+([-\d.e]+))?\s*\)$/i.exec(t))) return Math.abs(+m[1] * (m[2] == null ? +m[1] : +m[2]));
  if (/^translate\([^)]*\)$/i.test(t)) return 1;
  return null;
}
function embedsMainPicture(svgText) {
  if (!/<(path|text|rect|circle|ellipse|polygon|polyline|line)[\s>\/]/i.test(svgText)) return true;
  var vb = svgYear.viewBoxOf(svgText);
  if (!vb || !(vb.width > 0 && vb.height > 0)) return true;
  var tags = String(svgText).match(/<image\b[^>]*>/gi) || [], biggest = 0, unknown = false;
  tags.forEach(function (tag) {
    if (!/href\s*=\s*["']data:image\//i.test(tag)) return;
    var w = /\swidth\s*=\s*["']\s*([\d.]+)\s*(px)?\s*["']/i.exec(tag), h = /\sheight\s*=\s*["']\s*([\d.]+)\s*(px)?\s*["']/i.exec(tag);
    if (!w || !h || /\stransform\s*=/i.test(tag)) { unknown = true; return; }
    /* a picture kept in <defs> and placed by <use href="#id" transform="…">, as Illustrator exports one, is
       drawn at that scale: FinNext Summit 2026's 995 x 426 sponsor panel is placed at 8%, a corner of the
       lock-up, not the lock-up (read as its main picture, the 2026 drawn beside it went unseen) */
    var id = /\sid\s*=\s*["']([^"']+)["']/i.exec(tag), scale = 1;
    var uses = id ? String(svgText).match(new RegExp('<use\\b[^>]*href\\s*=\\s*["\']#' + id[1].replace(/[^\w-]/g, '\\$&') + '["\'][^>]*>', 'gi')) || [] : [];
    if (uses.length) {
      scale = 0;
      uses.forEach(function (u) {
        var t = /\stransform\s*=\s*["']\s*([^"']*)["']/i.exec(u), s = t ? useScale(t[1]) : 1;
        if (s == null) unknown = true; else scale = Math.max(scale, s);
      });
    }
    biggest = Math.max(biggest, (+w[1] * +h[1] * scale) / (vb.width * vb.height));
  });
  return unknown || biggest >= 0.25;
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

function hex2(v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }

/* What a vision model reads in a raster unit: { year: as written ("'26"), full: '2026', box: {x,y,width,
   height} in pixels | null (the year as written), shown: [every year written in it, logo-unit.js
   shownYear], allText, tagline, serif, bold, extras, extraBoxes: [box] where the extras are, ownBox: box |
   null where the event's own lock-up is } — or null when it could not be asked. A see-through PNG is laid on
   grey first: a model reads transparency as white, and white lettering would be invisible to it.
   The event's own tagline is never an extra: a group the model put with the extras that is that line is
   taken out of them here. */
function readLogoPicture(eventId, picture, decoded, deadlineAt, eventName) {
  /* reading it is worth a few seconds, not the plan: with little time left the picture is used unread */
  if (deadlineAt && deadlineAt - Date.now() < 25000) return Promise.resolve(null);
  var shown = decoded && pngLite.hasTransparency(decoded)
    ? { mimeType: 'image/png', data: pngLite.encode(pngLite.flatten(decoded, [128, 128, 128])).toString('base64') }
    : { mimeType: picture.info.mime, data: picture.bytes.toString('base64') };
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].indexOf(shown.mimeType) === -1) return Promise.resolve(null);
  if (shown.data.length > 4 * 1024 * 1024) return Promise.resolve(null);       // base64 of 3 MB: nothing a logo unit needs
  /* Measured on ETCIO Annual Conclave 2026's tall lock-up: 30 s for the whole picture (2,500 thinking
     tokens), 19 s for the cut — a 40 s limit left little room. A reading that runs out of time is asked once
     more while the plan still has the time for it. */
  var ask = { route: 'logo-unit', eventId: eventId, images: [shown], timeoutMs: LOGO_READ_TIMEOUT_MS, maxOutputTokens: AI_OUTPUT_TOKENS.small };
  if (deadlineAt) ask.deadlineAt = deadlineAt;
  /* This one reading goes to Gemini, not through llm.js: what is needed from it is WHERE things are in
     the picture, and Gemini places a box to the pixel where Claude's boxes land beside the lettering
     (measured on the same lock-up: Gemini's box was the year's own, Claude's was 300 px off). */
  function asked(tries) {
    return callGeminiJson(logoReadPrompt(eventName), LOGO_READ_SCHEMA, ask).then(function (r) {
      var record = aiUsageRecorder(null, eventId, 'logo-unit');
      if (record) record(r.usage);
      /* Gemini is at times slow for minutes on end (Great India Retail Summit 2027's lock-up: two readings of
         60 s ran out, with time left in the plan): asked up to three times while the plan has time */
      if (r.error && r.code === 'ai-timeout' && tries < 3 && !(deadlineAt && deadlineAt - Date.now() < 30000)) {
        console.error('logo unit: the reading of ' + eventId + '\'s logo ran out of time; asked once more');
        return asked(tries + 1);
      }
      return r;
    });
  }
  return asked(1).then(function (r) {
    if (r.error) { console.error('logo unit: the reading of ' + eventId + '\'s logo failed — ' + (r.code || r.error)); return null; }
    var p = r.parsed || {};
    var allText = String(p.allText || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    /* the year as written, read in code; a model that put it in four digits only ("2026" for "'26") is
       taken at the form allText shows, so that the new year is written the same way */
    var said = logoUnit.shownYear(p.year) || (logoUnit.shownYear(p.yearFull) && logoUnit.shownYear(p.yearFull).form === 'full' ? logoUnit.shownYear(p.yearFull) : null);
    var shownYears = logoUnit.yearsShownIn(allText);
    if (said && said.form === 'full') {
      var written = shownYears.filter(function (y) { return y.full === said.full; })[0];
      if (written && allText.indexOf(said.written) === -1) said = written;
    }
    if (said && !shownYears.some(function (y) { return y.written === said.written; })) shownYears.push(said);
    var year = said ? said.written : '', full = said ? said.full : '';
    var b = Array.isArray(p.yearBox) ? p.yearBox.map(Number) : [], box = null;
    if (year && b.length === 4 && b.every(function (n) { return n >= 0 && n <= 1000; }) && b[2] > b[0] && b[3] > b[1]) {
      box = { x: b[1] / 1000 * picture.info.width, y: b[0] / 1000 * picture.info.height, width: (b[3] - b[1]) / 1000 * picture.info.width, height: (b[2] - b[0]) / 1000 * picture.info.height };
    }
    /* [ymin, xmin, ymax, xmax] out of 1000 -> a box in the picture's pixels, or null */
    function pixels(v) {
      var u = Array.isArray(v) ? v.map(Number) : [];
      if (u.length !== 4 || !u.every(function (n) { return n >= 0 && n <= 1000; }) || !(u[2] > u[0]) || !(u[3] > u[1])) return null;
      return { x: u[1] / 1000 * picture.info.width, y: u[0] / 1000 * picture.info.height, width: (u[3] - u[1]) / 1000 * picture.info.width, height: (u[2] - u[0]) / 1000 * picture.info.height };
    }
    var tagline = String(p.tagline || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    var own = wordsOf(tagline);
    /* a group is the event's line when its words are that line, or a good part of it (a line drawn over two
       rows can come back as two groups) — never a word or two that merely also occur in it */
    function isTagline(text) { var w = wordsOf(text); return !!own && !!w && own.indexOf(w) !== -1 && w.length >= Math.min(own.length, 12); }
    var groups = (Array.isArray(p.extraBoxes) ? p.extraBoxes : []).slice(0, 12).filter(function (e) { return e && !isTagline(e.text); });
    var extraBoxes = groups.map(function (e) { return pixels(e.box); }).filter(Boolean);
    var extras = String(p.extras || '').replace(/\s+/g, ' ').trim();
    /* the extras named in words, less the event's own line: nothing else left, no extras; else, where the
       groups were given, the groups that are left */
    if (own && extras) {
      var rest = (' ' + wordsOf(extras) + ' ').split(' ' + own + ' ').join(' ').trim();
      if (!rest) extras = '';
      else if (groups.length) extras = groups.map(function (e) { return String(e.text || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(' · ') || extras;
    }
    /* every word read as an extra, in full: what a cut may take away (keepsOwnLine) */
    var extraWords = [String(p.extras || '')].concat(groups.map(function (e) { return String(e.text || ''); })).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
    return { year: year, full: full, box: box, shown: shownYears, allText: allText, tagline: tagline, ownBox: pixels(p.ownBox), extraBoxes: extraBoxes, serif: p.yearFont === 'serif', bold: p.yearWeight === 'bold', extras: shortExtras(extras), extraWords: extras ? extraWords : '',
      fontFamily: YEAR_FONT_CHOICES.indexOf(p.yearFontFamily) !== -1 ? p.yearFontFamily : '', fontWeight: /^[3-8]00$/.test(String(p.yearFontWeight)) ? +p.yearFontWeight : 0 };
  }, function () { return null; });
}
/* the extras as the owner reads them in a note: a long list of partners is cut at a word, never inside one
   ("… In Association W" in ETCISO Annual Conclave's), and said to go on */
function shortExtras(extras) {
  extras = String(extras || '');
  if (extras.length <= 160) return extras;
  return extras.slice(0, 160).replace(/\s+\S*$/, '').replace(/[\s·,;:]+$/, '') + ' …';
}
/* words only, lower case, one space between: how two readings of the same line are compared */
function wordsOf(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
/* A cut is kept only with the event's own lock-up still in it: the second reading must find (nearly) every
   word of the tagline the first one read, and of the words it read that were not the extras' (the
   publisher's mark, the event's name). Read again, a word can come back joined to its neighbour ("ET CIO"
   as "ETCIO"): it counts as found. */
function keepsOwnLine(first, second) {
  var now = ' ' + wordsOf((second.allText || '') + ' ' + (second.tagline || '')) + ' ', joined = now.replace(/ /g, '');
  function mostFound(words) {
    if (!words.length) return true;
    var found = words.filter(function (w) { return now.indexOf(' ' + w + ' ') !== -1 || joined.indexOf(w) !== -1; }).length;
    return found >= Math.ceil(words.length * 0.8);
  }
  var extra = ' ' + wordsOf(first && (first.extraWords || first.extras)) + ' ';
  var own = wordsOf(first && first.allText).split(' ').filter(function (w) { return w && extra.indexOf(' ' + w + ' ') === -1; });
  return mostFound(wordsOf(first && first.tagline).split(' ').filter(Boolean)) && mostFound(own);
}

/* Last edition's sponsor is not this edition's. A lock-up that has a sponsor's mark, a "Powered by" line
   or that edition's theme line drawn into it is cut down to the event's own part: the publisher's mark, the
   event's name and the artwork drawn with them. Nothing is redrawn — the picture is cropped.
     decoded: the picture's pixels; read: readLogoPicture()'s answer — extraBoxes, where the model saw the
     extras, and ownBox, where it saw the event's own lock-up. The extras may stand on more than one side
     of it ("X and Y present" above, "In association with Z" below).
   Which part is which is the model's to say; where to cut is read from the pixels, and the picture is cut
   only across empty lines, never through lettering. Its rows are taken as the bands of lettering that
   empty rows separate; the bands at the top and at the bottom that are extras (three quarters of their
   lettering inside the extras' boxes and under a quarter inside the event's own) are taken away, each cut
   made halfway across the empty lines before the first band kept. Then the same is done with the columns
   of what is left, for a sponsor standing beside the lock-up. A band that holds a real part of the event's
   own lock-up is always kept, whatever else is in it.
   -> the box to keep ({ x, y, width, height } in pixels, trimmed to what is drawn in it), or null when there
   is no clean way to cut: no own lock-up was read, an extra stands between two parts of the lock-up or
   shares a line with it, nothing would be taken away, or too little would be left to be a lock-up. */
function ownUnitBox(decoded, read) {
  if (!decoded || !read || !read.ownBox || !read.extraBoxes) return null;
  /* a box said to hold extras that also holds most of the event's own lock-up says nothing about where
     they are (a box round the whole picture): it is not used */
  var own0 = read.ownBox, ownArea = own0.width * own0.height;
  var extraBoxes = read.extraBoxes.filter(function (b) {
    var w = Math.min(b.x + b.width, own0.x + own0.width) - Math.max(b.x, own0.x), h = Math.min(b.y + b.height, own0.y + own0.height) - Math.max(b.y, own0.y);
    return !(w > 0 && h > 0 && w * h > ownArea * 0.5);
  });
  if (!extraBoxes.length || !(ownArea > 0)) return null;
  var asDrawn = extraBoxes, W = decoded.width, H = decoded.height;
  /* the model's boxes are a few pixels out at times ("IN ASSOCIATION WITH" began 1.4px past its box): each is
     grown by 3% of the picture on every side but the one facing the event's own lock-up, and never into it */
  var gx = W * 0.03, gy = H * 0.03, oR = own0.x + own0.width, oB = own0.y + own0.height;
  extraBoxes = extraBoxes.map(function (b) {
    var x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
    if (y1 <= own0.y) { x0 -= gx; x1 += gx; y0 -= gy; y1 = Math.min(y1 + gy, own0.y); }
    else if (y0 >= oB) { x0 -= gx; x1 += gx; y1 += gy; y0 = Math.max(y0 - gy, oB); }
    else if (x1 <= own0.x) { y0 -= gy; y1 += gy; x0 -= gx; x1 = Math.min(x1 + gx, own0.x); }
    else if (x0 >= oR) { y0 -= gy; y1 += gy; x1 += gx; x0 = Math.max(x0 - gx, oR); }
    else return b;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });
  var background = pngLite.hasTransparency(decoded) ? null : pngLite.edgeColour(decoded, { x: 1, y: 1, width: W - 2, height: H - 2 });
  var keep = { x0: 0, y0: 0, x1: W, y1: H }, taken = 0;
  var refused = ['y', 'x'].some(function (axis) {
    var part = pngLite.crop(decoded, { x: keep.x0, y: keep.y0, width: keep.x1 - keep.x0, height: keep.y1 - keep.y0 });
    if (!part) return true;
    var start = axis === 'y' ? keep.y0 : keep.x0, end = axis === 'y' ? keep.y1 : keep.x1;
    var bands = pngLite.inkRuns(pngLite.inkProfile(part, axis, background)).map(function (run) {
      var box = axis === 'y' ? { x: keep.x0, y: start + run.from, width: keep.x1 - keep.x0, height: run.to - run.from }
        : { x: start + run.from, y: keep.y0, width: run.to - run.from, height: keep.y1 - keep.y0 };
      var all = pngLite.inkCount(decoded, box, background) || 1;
      var own = pngLite.inkCount(decoded, box, background, [read.ownBox]) / all;
      var extra = pngLite.inkCount(decoded, box, background, extraBoxes) / all;
      /* the room each box was given catches lettering a few pixels out of it, never a line wholly outside
         it: the rule under ETCIO Annual Conclave's tagline, between the own box and the partners' box below,
         was taken by that room alone and cut away. An extra is (a good part) inside a box as drawn. */
      var drawn = extra >= 0.75 ? pngLite.inkCount(decoded, box, background, asDrawn) / all : 0;
      return { from: start + run.from, to: start + run.to, kind: own >= 0.25 ? 'own' : extra >= 0.75 && drawn >= 0.25 ? 'extra' : '' };
    });
    var first = 0, last = bands.length - 1;
    while (first <= last && bands[first].kind === 'extra') first++;
    while (last >= first && bands[last].kind === 'extra') last--;
    var kept = bands.slice(first, last + 1);
    /* what stays must hold the event's own lock-up, and none of the extras */
    if (!kept.some(function (band) { return band.kind === 'own'; })) return true;
    if (kept.some(function (band) { return band.kind === 'extra'; })) return true;
    var lo = first > 0 ? Math.round((bands[first - 1].to + bands[first].from) / 2) : start;
    var hi = last < bands.length - 1 ? Math.round((bands[last].to + bands[last + 1].from) / 2) : end;
    if (axis === 'y') { keep.y0 = lo; keep.y1 = hi; } else { keep.x0 = lo; keep.x1 = hi; }
    taken += first + bands.length - 1 - last;
    return false;
  });
  if (refused) return null;
  /* What is left can still hold an extra that shares its lines with the lock-up: ETCIO Annual Conclave's
     "PRESENTS" stands to the right of the top of its emblem, so no straight cut across the picture parts
     them. The part kept is taken apart into its blocks of lettering (cut across empty lines, again and
     again, rows then columns) and a block that lies inside the extras' boxes as the model drew them, with
     none of the event's own lock-up outside them, is emptied. Kept only as the second reading allows. */
  var erase = extraBlocks(decoded, { x: keep.x0, y: keep.y0, width: keep.x1 - keep.x0, height: keep.y1 - keep.y0 }, background, read.ownBox, read.extraBoxes);
  /* nothing taken away: the extras are not where they can be cut from (inside the lock-up's own lines) */
  if (!taken && !erase.length) return null;
  var cut = pngLite.crop(erase.length ? emptied(decoded, erase, background) : decoded, { x: keep.x0, y: keep.y0, width: keep.x1 - keep.x0, height: keep.y1 - keep.y0 });
  var ink = cut && pngLite.inkBounds(cut, { x: 0, y: 0, width: cut.width, height: cut.height }, background);
  if (!ink) return null;
  /* trimmed to what is drawn, with a little room — never past the cuts */
  var pad = Math.round(Math.max(ink.width, ink.height) * 0.02) + 2;
  var x0 = Math.max(keep.x0, keep.x0 + ink.x - pad), y0 = Math.max(keep.y0, keep.y0 + ink.y - pad);
  var x1 = Math.min(keep.x1, keep.x0 + ink.x + ink.width + pad), y1 = Math.min(keep.y1, keep.y0 + ink.y + ink.height + pad);
  /* cutting must have taken something away, and must have left a lock-up */
  if (((x1 - x0) * (y1 - y0) > W * H * 0.94 && !erase.length) || x1 - x0 < 120 || y1 - y0 < 30) return null;
  var out = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  if (erase.length) out.erase = erase;
  return out;
}
/* The blocks of lettering inside `box` that are extras: -> [{ x, y, width, height }] in the picture's pixels.
   A block is what is left when the part is cut across empty lines until it cannot be (rows, then columns,
   up to six deep: a line of words falls into its letters, which is fine — each is judged by itself). One is
   an extra when nine tenths of its lettering lies inside the extras' boxes as the model drew them (with
   1% of room) and under a tenth inside the event's own box outside them. Whole rows and whole columns are
   never judged here — that is the cut's to do (ownUnitBox), and it keeps a line the event's own box holds
   a real part of: only a block sharing its line with the lock-up is, as "PRESENTS" shares the emblem's. */
function extraBlocks(decoded, box, background, ownBox, rawExtras) {
  if (!ownBox || !rawExtras || !rawExtras.length) return [];
  var W = decoded.width, H = decoded.height, rx = W * 0.01, ry = H * 0.01;
  var extras = rawExtras.map(function (b) { return { x: b.x - rx, y: b.y - ry, width: b.width + 2 * rx, height: b.height + 2 * ry }; });
  /* only where an extra's box reaches into the part kept */
  var near = extras.filter(function (b) { return b.x < box.x + box.width && b.x + b.width > box.x && b.y < box.y + box.height && b.y + b.height > box.y; });
  if (!near.length) return [];
  var out = [], blocks = 0;
  (function split(b, depth, axis) {
    if (++blocks > 4000) return;
    var part = pngLite.crop(decoded, b);
    if (!part) return;
    var ink = pngLite.inkBounds(part, { x: 0, y: 0, width: part.width, height: part.height }, background);
    if (!ink) return;
    b = { x: b.x + ink.x, y: b.y + ink.y, width: ink.width, height: ink.height };
    /* a block wholly outside every extra's box is the lock-up's: nothing to look at inside it */
    if (!near.some(function (e) { return e.x < b.x + b.width && e.x + e.width > b.x && e.y < b.y + b.height && e.y + e.height > b.y; })) return;
    var all = pngLite.inkCount(decoded, b, background) || 1;
    /* a row (or column) is looked into only when the lock-up really is in it, outside the extras' boxes */
    if (depth === 1 && pngLite.inkCount(decoded, b, background, [ownBox], near) / all < 0.25) return;
    /* emptied with a pixel of room for its soft edges (the lines round a block are empty) */
    if (depth >= 2 && pngLite.inkCount(decoded, b, background, near) / all >= 0.9 && pngLite.inkCount(decoded, b, background, [ownBox], near) / all < 0.1) { out.push({ x: b.x - 1, y: b.y - 1, width: b.width + 2, height: b.height + 2 }); return; }
    if (depth >= 6) return;
    var runs = [axis, axis === 'y' ? 'x' : 'y'].map(function (ax) {
      var p = pngLite.crop(decoded, b);
      return { axis: ax, runs: pngLite.inkRuns(pngLite.inkProfile(p, ax, background)) };
    }).filter(function (r) { return r.runs.length > 1; })[0];
    if (!runs) return;
    runs.runs.forEach(function (run) {
      var next = runs.axis === 'y' ? { x: b.x, y: b.y + run.from, width: b.width, height: run.to - run.from } : { x: b.x + run.from, y: b.y, width: run.to - run.from, height: b.height };
      split(next, depth + 1, runs.axis === 'y' ? 'x' : 'y');
    });
  })({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }, 0, 'y');
  return out;
}
/* the picture with those blocks emptied: see-through where it is, else painted the colour round it */
function emptied(decoded, boxes, background) {
  return boxes.reduce(function (img, b) { return background ? pngLite.fillBox(img, b, background) : pngLite.clearBox(img, b); }, decoded);
}
/* the same, for a PNG: -> the cropped picture ({ width, height, data }) or null */
function cropToOwnUnit(decoded, read) {
  var box = ownUnitBox(decoded, read);
  if (!box) return null;
  var background = pngLite.hasTransparency(decoded) ? null : pngLite.edgeColour(decoded, { x: 1, y: 1, width: decoded.width - 2, height: decoded.height - 2 });
  return pngLite.crop(box.erase ? emptied(decoded, box.erase, background) : decoded, box);
}

/* Two drawings of the same part of a lock-up are the same picture: of the pixels both have, all but a few
   (the soft edges of a shape, drawn a hair differently) agree in how covered they are and in colour. */
function sameDrawing(a, b) {
  if (!a || !b || Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1) return false;
  var w = Math.min(a.width, b.width), h = Math.min(a.height, b.height), differ = 0;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * a.width + x) * 4, j = (y * b.width + x) * 4;
      var da = Math.abs(a.data[i + 3] - b.data[j + 3]);
      var dc = a.data[i + 3] > 200 && b.data[j + 3] > 200 ? Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2]) : 0;
      if (da > 64 || dc > 96) differ++;
    }
  }
  return differ <= Math.max(12, w * h * 0.002);
}

/* The same for a lock-up drawn as an SVG: where to cut is found on the drawing drawn on nothing, and the
   drawing itself is cut there (svgYear.cropTo: its viewBox), so it stays a drawing. The cut is kept only
   when the cut drawing, drawn again, is exactly that part of the picture — nothing that stays in sight was
   taken out with the extras. read: the reading of rasterise(svgText), its boxes in those pixels.
   -> Promise<svgText | null> */
function cropSvgToOwnUnit(svgText, read) {
  var vb = svgYear.viewBoxOf(svgText), open = /<svg\b[^>]*>/i.exec(String(svgText || ''));
  if (!vb || !open || !read || !read.extraBoxes || !read.extraBoxes.length) return Promise.resolve(null);
  var fit = ((/\spreserveAspectRatio\s*=\s*["']\s*([^"']*)["']/i.exec(open[0]) || [])[1] || '').trim();
  return rasterise(svgText, { clear: true }).then(function (r) {
    var clear = r && pngLite.decode(r.png);
    var keep = clear && ownUnitBox(clear, read);
    if (!keep) return null;
    /* the drawing's units per pixel, and where its viewBox lies in the picture: centred (the default) when
       its size and its viewBox are not quite the same shape; any other placement is not worked out here */
    var sx = vb.width / clear.width, sy = vb.height / clear.height, ox = 0, oy = 0;
    if (!/^none\b/.test(fit)) {
      var s = Math.max(sx, sy);
      if (Math.abs(sx - sy) > s * 0.002 && fit && !/^xMidYMid(\s+meet)?$/.test(fit)) return null;
      ox = (clear.width - vb.width / s) / 2; oy = (clear.height - vb.height / s) / 2; sx = sy = s;
    }
    function units(b) { return { x: vb.x + (b.x - ox) * sx, y: vb.y + (b.y - oy) * sy, width: b.width * sx, height: b.height * sy }; }
    var source = svgText, expected = clear;
    /* an extra sharing its lines with the lock-up (ownUnitBox: erase): its shapes are taken out of the
       drawing — those that lie wholly inside the block, never one that is moved by a transform */
    if (keep.erase) {
      var blocks = keep.erase.map(units), shapes = svgYear.shapesIn(svgText).filter(function (sh) {
        if (sh.transformed || sh.unsafe || !sh.box) return false;
        return blocks.some(function (b) { return sh.box.x >= b.x && sh.box.y >= b.y && sh.box.x + sh.box.width <= b.x + b.width && sh.box.y + sh.box.height <= b.y + b.height; });
      });
      if (!shapes.length) return null;
      source = svgYear.cutShapes(svgText, { shapes: shapes });
      expected = emptied(clear, keep.erase, null);
    }
    var cut = svgYear.cropTo(source, units(keep));
    if (!cut || svgCouldRun(cut)) return null;
    /* drawn again, it must be exactly that part of the picture, with the emptied blocks empty: nothing of
       the extras left in them, and nothing else gone */
    return rasterise(cut, { clear: true, width: keep.width }).then(function (again) {
      return again && sameDrawing(pngLite.decode(again.png), pngLite.crop(expected, keep)) ? cut : null;
    });
  }).then(null, function () { return null; });
}

/* A PNG with an earlier edition's year drawn in -> one SVG: the same picture, pixel for pixel, with the old
   year's characters emptied and the new ones set in their place as text (so the edition after this one is a
   text change). The year is moved on in the form the lock-up writes it: "'26" becomes "'27", "2026" becomes
   "2027", "2026-27" becomes "2027-28" (logo-unit.js yearAs).
   Character by character wherever the year's characters stand apart, one run of ink each, as in almost
   every lock-up: only those that change are emptied and set again — the apostrophe and the "2" of "'26"
   stay the artwork's own — each new digit as tall as the digits beside it, centred where the old one
   stood, in that one's colour. Otherwise the year's whole rectangle is emptied and the new year set over it.
   null when the year cannot be placed with confidence — the picture is then left alone. `read`:
   readLogoPicture()'s answer; toYear four digits.
   -> { bytes, info, font } — font: what the new characters are set in ({ family, ttfBase64 } | null), so
   that a second reading can draw them (checkMovedYear). */
/* Where the year is looked for, narrowed to leave out a neighbour's lettering. A box drawn a little loose
   takes in the edge of the letter beside the year — "summit"'s t beside '26 in ETAutoTech Summit's lock-up,
   one reading in five — and lettering that runs to the edge of the look is then taken for something that
   emptying the year would damage, so the year was left at '26. Lettering that lies mostly outside the box
   the model drew is a neighbour's: the look is cut in the empty line between it and the year, across and
   then down. Lettering that touches the year (no empty line between) is never cut away: the check after
   this still refuses it. -> the box to look in */
function yearOnly(decoded, around, box, background) {
  function narrow(area, axis) {
    var x0 = Math.max(0, Math.floor(area.x)), y0 = Math.max(0, Math.floor(area.y));
    var part = pngLite.crop(decoded, area);
    if (!part) return area;
    var runs = pngLite.inkRuns(pngLite.inkProfile(part, axis, background));
    var o = axis === 'x' ? x0 : y0, lo = (axis === 'x' ? box.x : box.y) - o, hi = lo + (axis === 'x' ? box.width : box.height);
    var mine = runs.map(function (r) { return Math.max(0, Math.min(r.to, hi) - Math.max(r.from, lo)) >= (r.to - r.from) * 0.5; });
    var first = mine.indexOf(true), last = mine.lastIndexOf(true);
    if (first === -1 || (first === 0 && last === runs.length - 1)) return area;
    var a = axis === 'x' ? area.x : area.y, end = a + (axis === 'x' ? area.width : area.height);
    if (first > 0) a = o + (runs[first - 1].to + runs[first].from) / 2;
    if (last < runs.length - 1) end = o + (runs[last].to + runs[last + 1].from) / 2;
    return axis === 'x' ? { x: a, y: area.y, width: end - a, height: area.height } : { x: area.x, y: a, width: area.width, height: end - a };
  }
  return narrow(narrow(around, 'x'), 'y');
}

/* The year redrawn in the lock-up's own lettering. A face from Google Fonts is rarely the lock-up's own
   (AutoTech Summit 2027's '27: a Montserrat 7 stood heavier and blockier than the thin 2 beside it), so Gemini's
   image model is asked to change only the year in the picture. Its answer is never used as a whole picture — it
   may reframe or soften anything — only the new year's SHAPE is taken from it: found by a reading, fitted to the
   old year's height and place, and painted in the old year's own colour into the original picture, whose every
   other pixel stays. readFn(picture, decoded) -> Promise<reading | null> (the lock-up reading).
   -> Promise<{ bytes, info } (a PNG) | null> — null: anything uncertain; the caller then sets it in a font */
var YEAR_REDRAW_MIN_MS = 90000;    // an image call and a reading of its answer, with room to spare
function redrawYearInPng(decoded, reading, toYear, eventId, deadlineAt, readFn, sourceBytes) {
  if (!decoded || !reading || !reading.box || (deadlineAt && deadlineAt - Date.now() < YEAR_REDRAW_MIN_MS)) return Promise.resolve(null);
  var oldText = String(reading.year || '').replace(/\s+/g, ''), newText = logoUnit.yearAs(reading.year, toYear).replace(/\s+/g, '');
  if (!oldText || !newText || oldText === newText || Array.from(oldText).length !== Array.from(newText).length) return Promise.resolve(null);
  var box = reading.box;
  var around = { x: box.x - box.width * 0.08, y: box.y - box.height * 0.22, width: box.width * 1.16, height: box.height * 1.44 };
  var clear = pngLite.hasTransparency(decoded) && pngLite.inkOf(decoded, around).coverage < 0.6;
  var background = clear ? null : pngLite.edgeColour(decoded, around);
  around = yearOnly(decoded, around, box, background);
  var ink = pngLite.inkBounds(decoded, around, background);
  if (!ink || !ink.colour || ink.height < 8) return Promise.resolve(null);
  /* shown to the model on a plain ground well away from the year's colour (a see-through lock-up) */
  var lum = (0.299 * ink.colour[0] + 0.587 * ink.colour[1] + 0.114 * ink.colour[2]) / 255;
  var plate = lum > 0.5 ? [40, 40, 40] : [235, 235, 235];
  var shown = clear ? pngLite.flatten(decoded, plate) : decoded;
  var prompt = 'This is an event logo. Change ONLY the year "' + oldText + '" to "' + newText + '". Draw each new character in exactly the same lettering as the characters around it — the same typeface, stroke weight, width, height, colour and baseline — as if the logo\'s own designer had drawn it. Keep everything else exactly as it is: the same background, size and framing, every other letter untouched; the red ET square and the white "ET" in it keep their exact colours and shape. Add nothing.';
  return callGeminiImage(prompt, { image: { mimeType: 'image/png', data: pngLite.encode(shown).toString('base64') }, route: 'logo-unit', eventId: eventId, timeoutMs: 60000, deadlineAt: deadlineAt }).then(function (r) {
    var record = aiUsageRecorder(null, eventId, 'logo-unit'); if (record) record(r.usage);
    if (r.error) { console.error('logo unit: the year of ' + eventId + '\'s logo could not be redrawn — ' + (r.code || r.error)); return null; }
    var bytes = Buffer.from(r.base64, 'base64'), info = logoUnit.imageInfo(bytes);
    var asPng = info.type === 'png' && info.width * info.height <= LOGO_UNIT_DECODE_PIXELS
      ? Promise.resolve({ bytes: bytes, info: info, decoded: pngLite.decode(bytes) })
      : workingCopy(wrapPictureSvg({ bytes: bytes, info: info }));
    return asPng.then(function (edited) {
      if (!edited || !edited.decoded) return null;
      return readFn({ bytes: edited.bytes, info: edited.info }, edited.decoded).then(function (e) {
        /* the model's picture must show the new year, written the same way, and placed */
        if (!e || !e.box || String(e.year || '').replace(/\s+/g, '') !== newText) return null;
        var ed = edited.decoded;
        var eAround = { x: e.box.x - e.box.width * 0.08, y: e.box.y - e.box.height * 0.22, width: e.box.width * 1.16, height: e.box.height * 1.44 };
        var eBack = pngLite.edgeColour(ed, eAround);
        eAround = yearOnly(ed, eAround, e.box, eBack);
        var eInk = pngLite.inkBounds(ed, eAround, eBack);
        if (!eInk || !eInk.colour || eInk.height < 8) return null;
        var scale = ink.height / eInk.height, W = Math.round(eInk.width * scale), H = ink.height;
        /* about as wide as the old year (a 7 for a 6, an 8 for a 7), never something else */
        if (W < ink.width * 0.7 || W > ink.width * 1.35) return null;
        /* where the new year reaches past the old one, that room must be empty in the original */
        if (W > ink.width + 2 && pngLite.inkCount(decoded, { x: ink.x + ink.width + 2, y: ink.y, width: W - ink.width, height: H }, background) > 0) return null;
        var full = Math.abs(eInk.colour[0] - eBack[0]) + Math.abs(eInk.colour[1] - eBack[1]) + Math.abs(eInk.colour[2] - eBack[2]);
        if (full < 120) return null;
        var hole = { x: ink.x - 2, y: ink.y - 2, width: Math.max(ink.width, W) + 4, height: ink.height + 4 };
        var out = clear ? pngLite.clearBox(decoded, hole) : pngLite.fillBox(decoded, hole, background);
        var d = out.data, src = ed.data, colour = ink.colour;
        /* the old year's own colour, column by column: a year set in a gradient (Digiplus Awards' orange to purple
           '26) keeps it, the new digits taking the colour of the old ones' place */
        var cols = [], od = decoded.data;
        for (var cx = 0; cx < ink.width; cx++) {
          var rr = 0, gg = 0, bb = 0, nn = 0;
          for (var cy = ink.y; cy < ink.y + ink.height; cy++) {
            var oo = (cy * decoded.width + ink.x + cx) * 4;
            var isInkPx = background ? (Math.abs(od[oo] - background[0]) + Math.abs(od[oo + 1] - background[1]) + Math.abs(od[oo + 2] - background[2]) > 96) : od[oo + 3] >= 200;
            if (isInkPx) { rr += od[oo]; gg += od[oo + 1]; bb += od[oo + 2]; nn++; }
          }
          cols.push(nn ? [Math.round(rr / nn), Math.round(gg / nn), Math.round(bb / nn)] : null);
        }
        for (var ci = 0; ci < cols.length; ci++) if (!cols[ci]) { var l = ci, rgt = ci; while (l >= 0 && !cols[l]) l--; while (rgt < cols.length && !cols[rgt]) rgt++; cols[ci] = l >= 0 && (rgt >= cols.length || ci - l <= rgt - ci) ? cols[l] || colour : rgt < cols.length ? cols[rgt] : colour; }
        function colourAt(tx) { return cols.length ? cols[Math.max(0, Math.min(cols.length - 1, Math.round(tx * ink.width / Math.max(1, W))))] || colour : colour; }
        function at(x, y, c) { x = Math.max(0, Math.min(ed.width - 1, x)); y = Math.max(0, Math.min(ed.height - 1, y)); return src[(y * ed.width + x) * 4 + c]; }
        function sample(fx, fy) {   // the edited picture's distance from its ground at a point, between pixels
          var x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, v = 0;
          [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]].forEach(function (k) {
            var x = x0 + k[0], y = y0 + k[1];
            v += k[2] * (Math.abs(at(x, y, 0) - eBack[0]) + Math.abs(at(x, y, 1) - eBack[1]) + Math.abs(at(x, y, 2) - eBack[2]));
          });
          return v;
        }
        for (var ty = 0; ty < H; ty++) {
          var py = ink.y + ty;
          if (py < 0 || py >= out.height) continue;
          for (var tx = 0; tx < W; tx++) {
            var px = ink.x + tx;
            if (px < 0 || px >= out.width) continue;
            var a = (sample(eInk.x + (tx + 0.5) / scale - 0.5, eInk.y + (ty + 0.5) / scale - 0.5) / full - 0.15) / 0.7;
            a = Math.max(0, Math.min(1, a));
            if (!a) continue;
            var o = (py * out.width + px) * 4, col = colourAt(tx);
            if (clear) { d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = Math.round(a * 255); }
            else { for (var c = 0; c < 3; c++) d[o + c] = Math.round(col[c] * a + d[o + c] * (1 - a)); d[o + 3] = 255; }
          }
        }
        var png = pngLite.encode(out);
        if (png.length * 4 / 3 > Math.min(LOGO_UNIT_MAX_BYTES, Math.max(2 * (sourceBytes || 0), 600 * 1024))) return null;
        return { bytes: png, info: logoUnit.imageInfo(png), decoded: out };
      });
    });
  }).then(null, function (err) { console.error('logo unit: redrawing the year of ' + eventId + '\'s logo failed — ' + (err && err.message)); return null; });
}

function moveYearInPng(decoded, read, toYear, eventName, sourceBytes) {
  if (!decoded || !read || !read.box) return Promise.resolve(null);
  var oldText = String(read.year || '').replace(/\s+/g, ''), newText = logoUnit.yearAs(read.year, toYear).replace(/\s+/g, '');
  if (!oldText || !newText || oldText === newText) return Promise.resolve(null);
  var box = read.box;
  /* the model's box is a little loose or a little tight: the characters are where the ink is */
  var around = { x: box.x - box.width * 0.08, y: box.y - box.height * 0.22, width: box.width * 1.16, height: box.height * 1.44 };
  /* See-through or solid is judged where the year is, not for the picture as a whole: a year on a badge
     inside a transparent lock-up stands on that badge's colour. */
  var covered = pngLite.inkOf(decoded, around).coverage;
  var clear = pngLite.hasTransparency(decoded) && covered < 0.6, background = clear ? null : pngLite.edgeColour(decoded, around);
  around = yearOnly(decoded, around, box, background);
  var ink = pngLite.inkBounds(decoded, around, background);
  if (!ink || !ink.colour) return Promise.resolve(null);
  var ratio = ink.width / ink.height;
  /* the year's characters side by side (four digits: 1.5 to 4.6 times as wide as tall; an apostrophe or a
     dash counts half a digit); anything else is not (only) the year */
  var digits = (oldText.match(/\d/g) || []).length, others = Array.from(oldText).length - digits, weight = digits + others * 0.5;
  var low = digits === 4 && !others ? 1.5 : weight * 0.3, high = digits === 4 && !others ? 4.6 : weight * 1.25;
  if (ink.height < 8 || ratio < low || ratio > high) return Promise.resolve(null);
  /* lettering that runs to the edge of where it was looked for is not the year alone: something else
     (a word beside it, a frame, artwork behind it) is in the box, and emptying it would damage that */
  var ax0 = Math.max(0, Math.floor(around.x)), ay0 = Math.max(0, Math.floor(around.y));
  var ax1 = Math.min(decoded.width, Math.ceil(around.x + around.width)), ay1 = Math.min(decoded.height, Math.ceil(around.y + around.height));
  if (ink.x <= ax0 || ink.y <= ay0 || ink.x + ink.width >= ax1 || ink.y + ink.height >= ay1) return Promise.resolve(null);
  if (background && Math.abs(ink.colour[0] - background[0]) + Math.abs(ink.colour[1] - background[1]) + Math.abs(ink.colour[2] - background[2]) < 120) return Promise.resolve(null);

  /* the year's characters: one run of ink across each, when they stand apart */
  var oldChars = Array.from(oldText), newChars = Array.from(newText);
  var part = pngLite.crop(decoded, ink);
  var runs = part ? pngLite.inkRuns(pngLite.inkProfile(part, 'x', background)) : [];
  var glyphs = runs.length === oldChars.length && oldChars.length === newChars.length ? runs.map(function (run, i) {
    var b = pngLite.inkBounds(decoded, { x: ink.x + run.from, y: ink.y, width: run.to - run.from, height: ink.height }, background);
    return { from: ink.x + run.from, to: ink.x + run.to, bounds: b, digit: /\d/.test(oldChars[i]) };
  }) : null;
  if (glyphs && glyphs.some(function (g) { return !g.bounds; })) glyphs = null;
  var digitH = glyphs ? Math.max.apply(null, glyphs.filter(function (g) { return g.digit; }).map(function (g) { return g.bounds.height; }).concat([0])) : 0;
  /* the digits of a year stand as tall as one another: runs that do not are not one character each */
  if (glyphs && (!digitH || glyphs.some(function (g) { return g.digit && g.bounds.height < digitH * 0.85; }))) glyphs = null;
  var sets = [];
  if (glyphs) {
    glyphs.forEach(function (g, i) {
      if (oldChars[i] === newChars[i]) return;
      var left = i > 0 ? Math.round((glyphs[i - 1].to + g.from) / 2) : g.from - 2;
      var right = i < glyphs.length - 1 ? Math.round((g.to + glyphs[i + 1].from) / 2) : g.to + 2;
      sets.push({ hole: { x: left, y: ink.y - 2, width: right - left, height: ink.height + 4 }, text: newChars[i], cx: (g.from + g.to) / 2,
        baseline: g.bounds.y + g.bounds.height, height: digitH, width: g.to - g.from, colour: g.bounds.colour || ink.colour, digit: g.digit && /\d/.test(newChars[i]) });
    });
    /* only digits change between two years written the same way; anything else: the whole year */
    if (!sets.length || sets.some(function (s) { return !s.digit; })) { glyphs = null; sets = []; }
  }
  if (!glyphs) sets = [{ whole: true, hole: { x: ink.x - 2, y: ink.y - 2, width: ink.width + 4, height: ink.height + 4 }, text: newText, x: ink.x, baseline: ink.y + ink.height, height: ink.height, width: ink.width, colour: ink.colour }];
  var emptied = decoded;
  sets.forEach(function (s) { emptied = clear ? pngLite.clearBox(emptied, s.hole) : pngLite.fillBox(emptied, s.hole, background); });
  var kept = pngLite.encode(emptied);
  /* written here without the row filters the original had, the picture can come out several times its
     size: a hero picture that heavy is worse than last year's year, which the owner is told about */
  if (kept.length * 4 / 3 > Math.min(LOGO_UNIT_MAX_BYTES, Math.max(2 * (sourceBytes || 0), 600 * 1024))) return Promise.resolve(null);

  var family = read.fontFamily || (read.serif ? 'Source Serif 4' : 'Inter'), fontWeight = read.fontWeight || (read.bold ? 700 : 400);
  /* A digit of the year that stays ("2" in '26 -> '27) shows how this lock-up draws its figures: the new
     digit is set in the weight whose same digit is as heavy as it (ink over its box), and narrowed or
     widened to its proportions. A reading names a face like the lock-up's, rarely the lock-up's own —
     ETAutoTech Summit's was read as Montserrat Bold, whose 7 came out 40% wider and heavier than the 2
     beside it. */
  var ref = null;
  if (glyphs) glyphs.forEach(function (g, i) { if (!ref && g.digit && oldChars[i] === newChars[i]) ref = { ch: oldChars[i], b: g.bounds }; });
  if (ref) ref.fill = pngLite.inkCount(decoded, ref.b, background) / (ref.b.width * ref.b.height);
  var subset = sets.map(function (s) { return s.text; }).join('') + (ref ? ref.ch : '');
  function calibrated() {
    if (!ref) return yearFont(family, fontWeight, read.serif, subset).then(function (font) { return { font: font, refFit: null }; });
    var weights = [fontWeight, fontWeight - 100, fontWeight + 100, fontWeight - 200, fontWeight + 200].filter(function (w) { return w >= 300 && w <= 800; });
    return Promise.all(weights.map(function (w) {
      return fetchUnitFont(family, w, subset).then(function (f) { return f ? inkOfText(f, ref.ch).then(function (fit) { return fit ? { font: f, refFit: fit } : null; }) : null; });
    })).then(function (tried) {
      var best = null;
      tried.forEach(function (t) { if (t && (!best || Math.abs(t.refFit.fill - ref.fill) < Math.abs(best.refFit.fill - ref.fill))) best = t; });
      return best || yearFont(family, fontWeight, read.serif, subset).then(function (font) { return { font: font, refFit: null }; });
    });
  }
  return calibrated().then(function (cal) {
    var font = cal.font;
    /* the lock-up's figures against the face's, width for height */
    var sx = cal.refFit ? Math.max(0.6, Math.min(1.4, (ref.b.width / ref.b.height) / (cal.refFit.width / cal.refFit.height))) : 1;
    /* and the size and baseline the kept digit was set at: a flat-topped 7 then stands as the 2 does, not
       as tall as a round 6 that overshoots it */
    var at = cal.refFit ? { size: ref.b.height / cal.refFit.height, base: ref.b.y + ref.b.height - cal.refFit.below * ref.b.height / cal.refFit.height } : null;
    return Promise.all(sets.map(function (s) { return font ? inkOfText(font, s.text) : null; })).then(function (fits) { return drawn(font, fits, sx, at); });
  });
  function drawn(font, fits, sx, at) {
    var W = decoded.width, H = decoded.height, style = '', texts = '';
    var fallback = read.serif ? 'Georgia, \'Times New Roman\', serif' : 'Arial, Helvetica, sans-serif';
    if (font) style = '<style>@font-face{font-family:\'rvyear\';src:url(data:font/ttf;base64,' + font.ttfBase64 + ') format(\'truetype\')}</style>';
    sets.forEach(function (s, i) {
      var fill = '#' + hex2(s.colour[0]) + hex2(s.colour[1]) + hex2(s.colour[2]);
      var family = font ? '\'rvyear\', ' + fallback : fallback;
      var chars = Array.from(s.text).length, fit = fits[i];
      if (font && fit && !s.whole) {
        /* One digit in the place of another, fitted to the ink it replaces: as tall as the old digits, its
           foot on theirs, centred in its place. A figure is not as tall as the font's capitals in every
           face (in ETAutoTech Summit's lock-up, set like Montserrat, a 7 sized by the capitals stood taller
           than the 2 beside it and below its foot), so the new digit's own ink is measured, not assumed. */
        var fsize = at ? at.size : s.height / fit.height;
        if (fit.width * fsize * sx > s.width * 1.3) fsize = s.width * 1.3 / (fit.width * sx);
        var fx = s.cx - (fit.left + fit.width / 2) * fsize * sx, fy = at ? at.base : s.baseline - fit.below * fsize;
        texts += '<text transform="translate(' + fx.toFixed(2) + ' ' + fy.toFixed(2) + ')' + (Math.abs(sx - 1) > 0.01 ? ' scale(' + sx.toFixed(3) + ' 1)' : '') + '" x="0" y="0" fill="' + fill + '" font-family="' + family + '" font-size="' + fsize.toFixed(2) + '">' + escHtmlText(s.text) + '</text>';
      } else if (font && fit) {
        /* the whole year, fitted the same way: as tall as the old one, its foot on the old foot, spread to
           the old one's width */
        var wsize = s.height / fit.height;
        if (fit.width * wsize > s.width * 1.04) wsize = s.width * 1.04 / fit.width;
        var wspacing = chars > 1 ? Math.max(0, Math.min((s.width - fit.width * wsize) / (chars - 1), wsize * 0.6)) : 0;
        var wx = s.x - fit.left * wsize, wy = s.baseline - fit.below * wsize;
        texts += '<text x="' + wx.toFixed(2) + '" y="' + wy.toFixed(2) + '" fill="' + fill + '" font-family="' + family + '" font-size="' + wsize.toFixed(2) + '" letter-spacing="' + wspacing.toFixed(2) + '">' + escHtmlText(s.text) + '</text>';
      } else if (font) {
        /* lining figures stand as tall as the capitals: the size that makes them as tall as the old ones */
        var size = s.height / (font.metrics.capHeight / font.metrics.unitsPerEm);
        var natural = logoUnit.textWidth(font.metrics, s.text, size, 0);
        if (s.whole) {
          if (natural > s.width * 1.04) { size = size * s.width / natural; natural = s.width; }
          var spacing = chars > 1 ? Math.min((s.width - natural) / (chars - 1), size * 0.6) : 0;
          texts += '<text x="' + s.x + '" y="' + s.baseline + '" fill="' + fill + '" font-family="' + family + '" font-size="' + size.toFixed(2) + '" letter-spacing="' + spacing.toFixed(2) + '">' + escHtmlText(s.text) + '</text>';
        } else {
          /* one digit in the place of another: never much wider than the place it takes */
          if (natural > s.width * 1.3) size = size * s.width * 1.3 / natural;
          texts += '<text x="' + s.cx.toFixed(2) + '" y="' + s.baseline + '" text-anchor="middle" fill="' + fill + '" font-family="' + family + '" font-size="' + size.toFixed(2) + '">' + escHtmlText(s.text) + '</text>';
        }
      } else if (s.whole) {
        texts += '<text x="' + s.x + '" y="' + s.baseline + '" fill="' + fill + '" font-family="' + family + '" font-weight="' + fontWeight + '" font-size="' + (s.height / 0.716).toFixed(2) + '" textLength="' + s.width + '" lengthAdjust="spacing">' + escHtmlText(s.text) + '</text>';
      } else {
        texts += '<text x="' + s.cx.toFixed(2) + '" y="' + s.baseline + '" text-anchor="middle" fill="' + fill + '" font-family="' + family + '" font-weight="' + fontWeight + '" font-size="' + (s.height / 0.716).toFixed(2) + '">' + escHtmlText(s.text) + '</text>';
      }
    });
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img">' +
      '<title>' + escHtmlText(eventName || '') + '</title>' + style +
      '<image width="' + W + '" height="' + H + '" href="data:image/png;base64,' + kept.toString('base64') + '"/>' + texts + '</svg>';
    if (svgCouldRun(svg)) return null;
    return { bytes: Buffer.from(svg, 'utf8'), info: { type: 'svg', mime: 'image/svg+xml', width: W, height: H, alpha: null }, font: font, from: oldText, to: newText };
  }
}

/* Where a text's ink falls when it is set in a font, per unit of font size: { left, width, height, below,
   fill } (left: from the text's start; below: how far its foot sits under the baseline, negative above;
   fill: the share of its box that is ink — how heavy it is). Drawn
   once at a large size and measured. -> Promise<that | null> (null: it could not be drawn here) */
var INK_PROBE_SIZE = 200;
function inkOfText(font, text) {
  var chars = Array.from(String(text || '')).length;
  if (!font || !font.ttfBase64 || !chars) return Promise.resolve(null);
  var size = INK_PROBE_SIZE, x = size * 0.5, base = size * 1.5, W = Math.round(size * (chars + 1.5)), H = size * 2;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<text x="' + x + '" y="' + base + '" fill="#000" font-family="\'rvyear\', sans-serif" font-size="' + size + '">' + escHtmlText(text) + '</text></svg>';
  return rasterise(svg, { width: W, clear: true, font: font }).then(function (r) {
    if (!r || r.width !== W || !r.pixels) return null;
    /* ink as png-lite counts it in a see-through picture (alpha 96 and up) */
    var px = r.pixels, x0 = W, y0 = r.height, x1 = -1, y1 = -1, n = 0;
    for (var y = 0; y < r.height; y++) {
      for (var xx = 0; xx < W; xx++) {
        if (px[(y * W + xx) * 4 + 3] < 96) continue;
        n++;
        if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < x0 || y1 - y0 < size * 0.2) return null;
    return { left: (x0 - x) / size, width: (x1 - x0 + 1) / size, height: (y1 - y0 + 1) / size, below: (y1 + 1 - base) / size,
      fill: n / ((x1 - x0 + 1) * (y1 - y0 + 1)) };
  }, function () { return null; });
}

/* What background a raster unit was drawn for, from its own lettering: 'for-dark' when it has white in it
   and no black, 'for-light' the other way round, '' when it would read on either. */
function rasterTone(decoded) {
  if (!decoded) return '';
  var light = 0, dark = 0, all = 0, d = decoded.data, step = Math.max(1, Math.floor(decoded.width * decoded.height / 60000)) * 4;
  var opaque = !pngLite.hasTransparency(decoded);
  if (opaque) return '';                                           // it brings its own background
  for (var i = 0; i < d.length; i += step) {
    if (d[i + 3] < 200) continue;
    all++;
    var lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    if (lum > 0.86) light++; else if (lum < 0.16) dark++;
  }
  if (!all) return '';
  /* a little white lettering and nothing black is already a unit that vanishes on a white page (the "Auto"
     of an ET Auto lock-up is a twentieth of its ink) */
  if (light / all > 0.035 && dark / all < 0.02) return 'for-dark';
  if (dark / all > 0.035 && light / all < 0.02) return 'for-light';
  if (light / all > 0.12 && dark / all < 0.04) return 'for-dark';
  if (dark / all > 0.12 && light / all < 0.04) return 'for-light';
  return '';
}
/* the same for an SVG: from its own inks, else from the one picture it wraps (many ET units are a PNG
   exported inside an SVG) */
function svgUnitTone(svgText) {
  var tone = logoUnit.svgTone(svgText);
  if (tone) return tone;
  var nested = /href\s*=\s*["']data:image\/png;base64,([A-Za-z0-9+\/=\s]+)["']/.exec(svgText);
  return nested ? rasterTone(pngLite.decode(Buffer.from(nested[1].replace(/\s+/g, ''), 'base64'))) : '';
}

/* ---------- examining a lock-up: the owner's own logo and the previous edition's unit alike ----------
   Whichever lock-up opens the hero is looked at the same way before it is used:
     its year   — the year it shows is read as written ("2026", "'26", "’26", "26", "FY26", "2026-27"); one
                  of an earlier edition is moved on to the event's year IN THE SAME FORM ("'26" -> "'27"),
                  matching the artwork's lettering, and the change is kept only when a second reading finds
                  the new year there and the old one gone;
     its extras — a sponsor's or partner's mark, a "Presented by" line, another edition's marks drawn into it
                  are cropped out (never the event's own tagline, which is part of its identity);
     and nothing else: never boxed, never redrawn, kept as the transparent picture it is.
   examineUnit(fb, eventId, picture, ctx) -> Promise<{ picture, changed, notes: [..], tone, stuck, unread, seen }>
     ctx: { years: { from, to }, origin: 'owner' | 'previous-edition', eventName, deadlineAt }
     changed: the picture is not the one given; stuck: the other edition's year it still shows, as written,
     when that could not be moved ('' otherwise); unread: it could not be read at all (no reading to be had);
     seen: the edition's year the last reading named, as written. */
function examineUnit(fb, eventId, picture, ctx) {
  var years = ctx.years || { from: '', to: '' }, owner = ctx.origin === 'owner';
  var notes = [], tone = '', changed = false, stuck = '', unread = false, seen = '', extrasLeft = false;
  var it = owner ? 'your logo' : 'the logo unit';
  function read(pic, decoded) { return readLogoPicture(eventId, pic, decoded, ctx.deadlineAt, ctx.eventName); }
  /* a year it shows is an earlier edition's when the page said so, or it is a recent one: "Since 2015" is not
     a year to move. Compared in code, on the four-digit year, whatever form it is written in.
     named: the reading named it as the edition's year — then a later one is not this edition's either (a
     logo made for the next edition), where a later year only seen in its words ("Vision 2030") is left be. */
  function isOldEdition(y, named) {
    var s = typeof y === 'string' ? logoUnit.shownYear(y) : y;
    if (!s || !/^20\d\d$/.test(String(years.to))) return false;
    if (named === true && +s.full > +years.to) return +s.full <= +years.to + 3;
    return +s.full < +years.to && (s.full === years.from || +s.full >= +years.to - 3);
  }
  /* the earlier edition's year a reading shows, as written: the edition's year it named; when it named none,
     any year written in its words (a reading that had no room for "'26" said nothing, and the year then
     stayed unmoved without a word — never again) */
  function oldIn(r) {
    if (!r) return '';
    seen = r.year || '';
    if (r.year) return isOldEdition(r.year, true) ? r.year : '';
    var other = (r.shown || []).filter(function (y) { return isOldEdition(y); })[0];
    return other ? other.written : '';
  }
  function stillShows(written) { if (!stuck) stuck = written; }
  function cropped(extras) {
    changed = true;
    notes.push('“' + extras + '” ' + (owner ? 'is not part of this edition\'s own lock-up and was cropped out of your logo' : 'belonged to the previous edition and was cropped out of the logo unit') + '; the rest of it is untouched.');
  }
  function carries(extras) {
    if (extras) extrasLeft = true;
    if (extras) notes.push((owner ? 'Your logo' : 'The logo unit') + ' also carries “' + extras + '”, which ' + (owner ? 'does not look like part of this edition\'s own lock-up' : 'came with the previous edition') + ' and could not be cropped out cleanly. Select it and use Replace image to put in artwork without it.');
  }
  function moved(from, to, how) {
    changed = true;
    notes.unshift('The year in ' + it + ' was changed from ' + from + ' to ' + to + how + '; everything else in it is untouched. Check how it sits, and replace the picture if you have this edition\'s artwork.');
  }
  /* The second reading: the moved picture drawn (in the font its new year is set in) and read again.
     -> 'ok' (the new year is there, the old one gone) | 'failed' | 'unchecked' (it could not be read) */
  function checkMovedYear(svgText, font, old) {
    var oldFull = (logoUnit.shownYear(old) || {}).full;
    return rasterise(svgText, { font: font }).then(function (r) {
      if (!r) return 'unchecked';
      return read({ bytes: r.png, info: { type: 'png', mime: 'image/png', width: r.width, height: r.height } }, null).then(function (again) {
        if (!again) return 'unchecked';
        var all = (again.shown || []).concat(again.full ? [{ full: again.full }] : []);
        var showsNew = all.some(function (y) { return y.full === years.to; });
        var showsOld = all.some(function (y) { return y.full === oldFull; });
        return showsNew && !showsOld ? 'ok' : 'failed';
      });
    }).then(null, function () { return 'unchecked'; });
  }
  /* a moved picture is kept only as the second reading allows: -> the picture to use */
  function keepMoved(movedPic, font, old, how, before) {
    var now = logoUnit.yearAs(old, years.to);
    /* without the font file (Google Fonts out of reach) the new year is set in a system face, which a
       drawing made here cannot show: it is kept, and the owner is told it was not checked */
    var check = font ? checkMovedYear(movedPic.bytes.toString('utf8'), font, old) : Promise.resolve('unchecked');
    return check.then(function (verdict) {
      if (verdict === 'failed') { stillShows(old); return before; }
      moved(old, now, how);
      if (verdict === 'unchecked') notes.push('The new year could not be checked by a second reading: look at it before you publish.');
      return movedPic;
    });
  }

  /* A lock-up drawn as outlines: drawn here as a picture on grey (a reader takes transparency for white,
     and white lettering would vanish), read, and — when it shows an earlier edition's year — that year's
     shapes are replaced by the new year set as text (svg-year.js). A sponsor's mark drawn into it is cropped
     out first (cropSvgToOwnUnit), the same way as from a PNG. -> the picture to use */
  function outlinedYear(svgText) {
    var vb = svgYear.viewBoxOf(svgText);
    if (!vb) return Promise.resolve(picture);
    var raster = null;
    function readDrawing(r) {
      return r ? read({ bytes: r.png, info: { type: 'png', mime: 'image/png', width: r.width, height: r.height } }, null) : Promise.resolve(null);
    }
    /* the drawing cut down to the event's own lock-up and read again: kept only if the second reading
       finds nothing left of the extras -> { svg, raster, read } or null */
    function withoutExtras(first) {
      return cropSvgToOwnUnit(svgText, first).then(function (cut) {
        if (!cut) return null;
        return rasterise(cut).then(function (r) {
          return readDrawing(r).then(function (second) { return second && !second.extras && keepsOwnLine(first, second) ? { svg: cut, raster: r, read: second } : null; });
        });
      }).then(null, function () { return null; });
    }
    return rasterise(svgText).then(function (r) {
      raster = r;
      return readDrawing(r);
    }).then(function (first) {
      if (!first) { unread = true; return first; }
      if (!first.extras) return first;
      return withoutExtras(first).then(function (cut) {
        var bytes = cut && Buffer.from(cut.svg, 'utf8'), info = bytes && logoUnit.imageInfo(bytes);
        if (!cut || logoUnit.plausibleUnit(info)) { carries(first.extras); return first; }
        svgText = cut.svg; vb = svgYear.viewBoxOf(cut.svg); raster = cut.raster;
        picture = { bytes: bytes, info: info };
        tone = svgUnitTone(cut.svg);                     // what is left decides what it stands on
        cropped(first.extras);
        return cut.read;
      });
    }).then(function (r) {
      var old = oldIn(r);
      if (!old) return picture;
      var form = logoUnit.shownYear(old);
      /* the digits are replaced, a mark written before them (the apostrophe of "'26") stays */
      if (old !== r.year || !r.box || !form || ['full', 'apos', 'short'].indexOf(form.form) === -1) return asPicture(old);
      var digits = form.form === 'full' ? 4 : 2;
      var sx = vb.width / raster.width, sy = vb.height / raster.height;
      var box = { x: vb.x + r.box.x * sx, y: vb.y + r.box.y * sy, width: r.box.width * sx, height: r.box.height * sy };
      var found = svgYear.yearShapes(svgText, box, { digits: digits, lead: form.form === 'apos' });
      if (!found) return asPicture(old);
      /* drawn again without them: the change is kept only when exactly the year went (yearCutColour) */
      return rasterise(svgYear.cutShapes(svgText, found)).then(function (after) {
        var at = { x: (found.box.x - vb.x) / sx, y: (found.box.y - vb.y) / sy, width: found.box.width / sx, height: found.box.height / sy };
        var colour = yearCutColour(raster, after, r.box, at);
        if (!colour) return asPicture(old);
        return withYear(svgText, r, found, colour, old, digits);
      });
    }, function () { return picture; });
  }
  /* The year's shapes could not be told apart in the drawing (Digiplus Awards 2026's '26, drawn in a gradient among
     the outlines: the event's name stood in its place on 28 Oct 2026). The lock-up is then drawn as a transparent
     picture at a working size and its year moved there, as in any picture lock-up — redrawn in its own lettering,
     else set in the closest font, each kept only when a reading finds the new year. A picture it stays, if so; when
     neither works, the drawing is kept as it was and the owner is told, as before. */
  function asPicture(old) {
    var was = changed;
    return workingCopy(svgText).then(function (copy) {
      if (!copy) { stillShows(old); return picture; }
      changed = false;
      return rasterExamined({ bytes: copy.bytes, info: copy.info }, copy.decoded).then(function (pic) {
        if (!changed || !pic) { changed = was; stillShows(old); return picture; }
        return pic;
      });
    }, function () { changed = was; stillShows(old); return picture; });
  }
  function withYear(svgText, r, found, colour, old, digits) {
    var family = r.fontFamily || (r.serif ? 'Source Serif 4' : 'Inter');
    var weight = r.fontWeight || (r.bold ? 700 : 400);
    var newDigits = digits === 4 ? years.to : String(years.to).slice(2);
    /* the declared colour when it is the one seen (exactly as written), else the one seen */
    var declared = /^#[0-9a-f]{6}$/i.test(found.fill) ? found.fill : /^#[0-9a-f]{3}$/i.test(found.fill) ? '#' + found.fill.slice(1).replace(/./g, '$&$&') : '';
    var fill = declared && colourDistance(declared, colour) <= 60 ? found.fill : colour;
    return yearFont(family, weight, r.serif, newDigits).then(function (font) {
      var text = svgYear.replaceYear(svgText, found, { toYear: newDigits, font: font, serif: r.serif, bold: r.bold, fill: fill });
      if (!text || svgCouldRun(text)) { stillShows(old); return picture; }
      var before = picture;
      return keepMoved({ bytes: Buffer.from(text, 'utf8'), info: picture.info }, font, old,
        ': its old digits were taken out and the new ones set in ' + (font ? font.family : 'a system font') + ', the closest match', before);
    });
  }

  if (picture.info.type === 'svg') {
    var svgText = picture.bytes.toString('utf8');
    tone = svgUnitTone(svgText);
    /* the year it shows as text: the one the page gave, else one just before this edition's, in whatever
       form it is written ("2026", "’26") */
    var shown = logoUnit.yearsShownIn(logoUnit.svgTexts(svgText).join(' '));
    var inText = shown.filter(function (y) { return y.full === years.from && isOldEdition(y); })[0] || shown.filter(function (y) { return isOldEdition(y); })[0];
    if (inText) {
      var swapped = logoUnit.svgReplaceYear(svgText, inText.written, years.to);
      /* the second reading, of its text: the new year there, the old one gone */
      var after = swapped.changed ? logoUnit.yearsShownIn(logoUnit.svgTexts(swapped.svg).join(' ')) : [];
      var ok = swapped.changed && !svgCouldRun(swapped.svg) && after.some(function (y) { return y.full === years.to; }) && !after.some(function (y) { return y.full === inText.full; });
      if (ok) { picture = { bytes: Buffer.from(swapped.svg, 'utf8'), info: picture.info }; moved(inText.written, logoUnit.yearAs(inText.written, years.to), ' in its text'); }
      else stillShows(inText.written);
      return Promise.resolve(result());
    }
    /* No year in real text. Many ET units are one PNG exported inside an SVG: that picture is read, so
       that an old year drawn in it is at least reported. One whose lettering is drawn as outlines is drawn
       here as a picture and read; its year's shapes are then replaced (outlinedYear). */
    var wrapped = /href\s*=\s*["']data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+\/=\s]+)["']/.exec(svgText);
    /* A lock-up drawn as outlines that only carries small pictures in it (ETCISO Annual Conclave's: the
       Chrome Enterprise sponsor's ball, three 51 x 56 pieces, in 246 outlined shapes) is not a PNG wrapped
       in an SVG: reading only that piece read nothing, so its sponsors were never seen. It is drawn whole
       and read as an outlined lock-up. */
    if (wrapped && !embedsMainPicture(svgText)) wrapped = null;
    if (!wrapped) return outlinedYear(svgText).then(function (pic) { picture = pic; return result(); });
    var innerBytes = Buffer.from(wrapped[2].replace(/\s+/g, ''), 'base64'), innerInfo = logoUnit.imageInfo(innerBytes);
    var innerDecoded = innerInfo.type === 'png' && innerInfo.width * innerInfo.height <= LOGO_UNIT_DECODE_PIXELS ? pngLite.decode(innerBytes) : null;
    /* an SVG that is nothing but that one PNG is that PNG: it is taken out and handled as one, so that a
       sponsor's mark in it can be cropped and its year moved. Kept as the SVG it is when nothing needs to
       change. */
    var onlyWraps = !/<(path|text|rect|circle|ellipse|polygon|polyline|line|g|mask|clipPath|filter)[\s>]/i.test(svgText);
    var fits = function (info) { return owner ? info.width >= 16 && info.height >= 16 : !logoUnit.plausibleUnit(info) || logoUnit.stackedUnit(info); };
    if (innerDecoded && onlyWraps && fits(innerInfo)) {
      var whole = picture;
      return rasterExamined({ bytes: innerBytes, info: innerInfo }, innerDecoded).then(function (pic) {
        picture = changed ? pic : whole;
        return result();
      });
    }
    /* that one picture too large to work on pixel by pixel, or not a PNG (Healthcare Leaders Summit 2026's:
       1792 x 1792, so its 2026 stayed and its sponsors' marks could not be cut): the SVG is drawn at a working
       size, transparent, and that drawing is examined as the lock-up */
    if (!innerDecoded && onlyWraps) {
      var wholeSvg = picture;
      return workingCopy(svgText).then(function (copy) {
        if (!copy || !fits(copy.info)) return readInnerOnly();
        return rasterExamined({ bytes: copy.bytes, info: copy.info }, copy.decoded).then(function (pic) {
          picture = changed ? pic : wholeSvg;
          return result();
        });
      });
    }
    return readInnerOnly();
  }
  function readInnerOnly() {
    return read({ bytes: innerBytes, info: innerInfo }, innerDecoded).then(function (inner) {
      if (!inner) unread = true;
      else { var old = oldIn(inner); if (old) stillShows(old); carries(inner.extras); }
      return result();
    });
  }
  /* a logo unit is a small picture: one too large to work on pixel by pixel (or not a PNG) is worked on as a
     copy at a working size; when no copy can be made it is read, and used as it is */
  var decoded = picture.info.type === 'png' && picture.info.width * picture.info.height <= LOGO_UNIT_DECODE_PIXELS ? pngLite.decode(picture.bytes) : null;
  if (decoded) return rasterExamined(picture, decoded).then(function (pic) { picture = pic; return result(); });
  var original = picture;
  return workingCopy(wrapPictureSvg(picture)).then(function (copy) {
    if (!copy) return rasterExamined(original, null).then(function (pic) { picture = pic; return result(); });
    return rasterExamined({ bytes: copy.bytes, info: copy.info }, copy.decoded).then(function (pic) { picture = changed ? pic : original; return result(); });
  });

  /* a raster lock-up: -> Promise<the picture to use> */
  function rasterExamined(pic, decoded) {
    tone = rasterTone(decoded) || tone;
    return read(pic, decoded).then(function (first) {
      if (!first) { unread = true; return null; }
      if (!first.extras) return first;
      /* A sponsor's mark is drawn in: the picture is cut down to the event's own lock-up, and read again —
         the cut is kept only if the second reading finds nothing left of it. */
      var cut = cropToOwnUnit(decoded, first);
      if (!cut) { carries(first.extras); return first; }
      var cutBytes = pngLite.encode(cut), cutPicture = { bytes: cutBytes, info: logoUnit.imageInfo(cutBytes) };
      if (logoUnit.plausibleUnit(cutPicture.info)) { carries(first.extras); return first; }
      return read(cutPicture, cut).then(function (second) {
        if (!second || second.extras || !keepsOwnLine(first, second)) { carries(first.extras); return first; }
        pic = cutPicture; decoded = cut; tone = rasterTone(cut) || tone;
        cropped(first.extras);
        return second;
      });
    }).then(function (r) {
      if (!r) return pic;
      var old = oldIn(r);
      if (!old) return pic;
      /* A year seen in its words but not placed, or placed where it cannot be moved cleanly, is read once
         more before it is given up on: where a reading puts the year varies from one reading to the next
         (AutoTech Summit 2027 was left showing '26 on one such reading). */
      function move(reading, tries) {
        var placeable = reading && reading.year === old && reading.box;
        /* first, the year redrawn in the lock-up's own lettering (redrawYearInPng), kept only when a second
           reading finds the new year and not the old; else the year set in the closest Google font */
        var redrawn = placeable && tries === 1 ? redrawYearInPng(decoded, reading, years.to, eventId, ctx.deadlineAt, read, pic.bytes.length) : Promise.resolve(null);
        return redrawn.then(function (red) {
          if (!red) return null;
          return read({ bytes: red.bytes, info: red.info }, red.decoded).then(function (again) {
            var oldFull = (logoUnit.shownYear(old) || {}).full;
            var all = again ? (again.shown || []).concat(again.full ? [{ full: again.full }] : []) : [];
            if (!again || !all.some(function (y) { return y.full === years.to; }) || all.some(function (y) { return y.full === oldFull; })) return null;
            moved(old, logoUnit.yearAs(old, years.to), ' over ' + (owner ? 'your' : 'the previous edition\'s') + ' artwork, redrawn in its own lettering');
            return { bytes: red.bytes, info: red.info };
          });
        }).then(function (done) {
          if (done) return done;
          var placed = placeable ? moveYearInPng(decoded, reading, years.to, ctx.eventName, pic.bytes.length) : Promise.resolve(null);
          return placed.then(function (patched) {
          if (patched) return keepMoved(patched, patched.font, old, ' over ' + (owner ? 'your' : 'the previous edition\'s') + ' artwork, in the lettering closest to it', pic);
          if (tries >= 2) { stillShows(old); return pic; }
          console.error('logo unit: the year ' + old + ' in ' + eventId + '\'s logo could not be placed from the first reading; read once more');
          return read(pic, decoded).then(function (again) { return move(again, tries + 1); });
          });
        });
      }
      return move(r, 1);
    });
  }
  function result() { return { picture: picture, changed: changed, notes: notes, tone: tone, stuck: stuck, unread: unread, seen: seen, extrasLeft: extrasLeft }; }
}

function heroModeOf(tone) { return tone === 'for-dark' ? 'dark' : tone === 'for-light' ? 'light' : ''; }
function storeLogoUnit(fb, eventId, stamp, pic) {
  var ext = pic.info.type === 'jpeg' ? 'jpg' : pic.info.type;
  /* an SVG with a viewBox and no size of its own is laid out 0 by 0 in the hero's centred column: its size
     is written into its root tag (sizedSvg), nothing else in it changes */
  if (pic.info.type === 'svg') {
    var text = pic.bytes.toString('utf8'), sized = sizedSvg(text, pic.info);
    if (sized !== text) pic = { bytes: Buffer.from(sized, 'utf8'), info: pic.info };
  }
  var storagePath = 'events/' + eventId + '/generated/' + stamp + '-logo-unit.' + ext;
  return storePublicPicture(fb, storagePath, pic.bytes, pic.info.mime).then(function (url) { return { url: url, storagePath: storagePath }; });
}
/* A lock-up drawn for a light ground (dark lettering), made again for a dark one by ET's logo rule (the owner,
   23 Oct 2026): only its black lettering changes — to white. Nothing light and nothing coloured ever changes, so the
   red ET square with the white "ET" in it, a gradient or an accent stay exactly as drawn. Only lettering that stands on
   the lock-up's see-through ground turns: lettering printed on a plate of the lock-up's own (Trendies Awards 2026's
   tagline, black on cream labels) stays black, as it was drawn to be read there. Turning every grey pixel instead
   turned those labels black and the white "ET" dark (28 Oct 2026).
   -> a decoded RGBA picture, or null when the lock-up has little such lettering (it is not drawn for a light ground) */
function onDarkCopy(img) {
  var w = img.width, h = img.height, d = img.data, N = w * h, out = Buffer.from(d), i;
  /* dark lettering: a pixel with no colour of its own, darker than mid-grey, drawn at all (its soft edges too) */
  var ink = new Uint8Array(N), seen = new Uint8Array(N);
  for (i = 0; i < N; i++) {
    var o = i * 4, r = d[o], g = d[o + 1], b = d[o + 2];
    ink[i] = d[o + 3] >= 24 && Math.max(r, g, b) - Math.min(r, g, b) <= 40 && 0.299 * r + 0.587 * g + 0.114 * b < 140 ? 1 : 0;
  }
  var inked = 0, turned = 0, opaque = 0;
  for (i = 0; i < N; i++) if (d[i * 4 + 3] > 128) opaque++;
  for (var start = 0; start < N; start++) {
    if (!ink[start] || seen[start]) continue;
    /* one stroke (a connected run of dark pixels), and what lies around it */
    var stack = [start], members = [], ring = 0, clear = 0;
    seen[start] = 1;
    while (stack.length) {
      var p = stack.pop(), x = p % w, y = (p - x) / w;
      members.push(p);
      var near = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (var k = 0; k < 4; k++) {
        var q = near[k];
        if (q < 0) { ring++; clear++; continue; }                                   // the picture's edge: its ground
        if (ink[q]) { if (!seen[q]) { seen[q] = 1; stack.push(q); } continue; }
        ring++;
        if (d[q * 4 + 3] < 24) clear++;
      }
    }
    var strong = 0;
    members.forEach(function (m) { if (d[m * 4 + 3] > 128) strong++; });
    inked += strong;
    /* on the see-through ground (most of what touches it is clear): lettering to turn; on a plate: left as drawn */
    if (!ring || clear / ring < 0.3) continue;
    turned += strong;
    members.forEach(function (m) {
      var o = m * 4, lum = Math.round(0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]);
      out[o] = out[o + 1] = out[o + 2] = 255 - lum;                                  // black -> white
    });
  }
  return turned && turned / inked > 0.4 && turned > opaque * 0.005 ? { width: w, height: h, data: out } : null;
}
/* the lock-up stored for the plan, made again for a dark ground -> Promise<{ url, storagePath, width, height } | null> */
function storeOnDarkUnit(fb, eventId, stamp, unit) {
  if (!unit || !unit.storagePath || !fb || !fb.bucket) return Promise.resolve(null);
  return fb.bucket.file(unit.storagePath).download().then(function (got) {
    var bytes = got[0], info = logoUnit.imageInfo(bytes);
    var decodedP = info.type === 'svg' ? workingCopy(bytes.toString('utf8'))
      : info.type === 'png' && info.width * info.height <= LOGO_UNIT_DECODE_PIXELS ? Promise.resolve({ decoded: pngLite.decode(bytes) })
      : workingCopy(wrapPictureSvg({ bytes: bytes, info: info }));
    return decodedP.then(function (copy) {
      var turned = copy && copy.decoded ? onDarkCopy(copy.decoded) : null;
      if (!turned) return null;
      var png = pngLite.encode(turned), storagePath = 'events/' + eventId + '/generated/' + stamp + '-logo-unit-on-dark.png';
      return storePublicPicture(fb, storagePath, png, 'image/png').then(function (url) {
        /* shown at the size the original is */
        return { url: url, storagePath: storagePath, width: unit.width || turned.width, height: unit.height || turned.height };
      });
    });
  }).then(null, function (err) { console.error('logo unit: the dark-ground copy of ' + eventId + '\'s lock-up was not made — ' + (err && err.message)); return null; });
}

/* what the event says about its year beyond its name and dates: the brief's own words */
function briefYearTexts(brief, eventMeta) {
  brief = brief || {};
  var vi = brief.visualIdentity || {}, owner = brief.owner || {}, points = brief.ownerPoints || {};
  return [vi.ipName, vi.ipTagline, owner.tagline, points.tagline, brief.theme].concat(Array.isArray(brief.keyMessages) ? brief.keyMessages : [])
    .concat([(eventMeta || {}).description]).map(function (t) { return String(t || ''); }).filter(Boolean);
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

/* The logo the owner uploaded (events/<id>.logoUrl), as bytes: read from this project's own bucket when it
   is there, else fetched like any other picture. Up to what an upload may be (8 MB, api-events.js); one
   over LOGO_UNIT_MAX_BYTES is used as uploaded, unexamined (ownerLogoUnit). -> Promise<Buffer | null> */
var OWNER_LOGO_MAX_BYTES = 8 * 1024 * 1024;
function fetchOwnerLogo(fb, url) {
  var own = null, m;
  var bucket = fb && fb.bucket && fb.bucket.name;
  if (bucket && (m = /^https:\/\/storage\.googleapis\.com\/([^\/?#]+)\/([^?#]+)/.exec(url)) && m[1] === bucket) own = m[2];
  else if (bucket && (m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^\/?#]+)\/o\/([^?#]+)/.exec(url)) && m[1] === bucket) own = m[2];
  var direct = own ? Promise.resolve().then(function () {
    var file = fb.bucket.file(decodeURIComponent(own));
    if (!file || typeof file.download !== 'function') return null;
    return file.download().then(function (r) { var b = r && r[0]; return Buffer.isBuffer(b) && b.length <= OWNER_LOGO_MAX_BYTES ? b : null; });
  }).then(null, function () { return null; }) : Promise.resolve(null);
  return direct.then(function (bytes) {
    if (bytes) return bytes;
    return safeFetch(url, { timeoutMs: 8000, maxBytes: OWNER_LOGO_MAX_BYTES }).then(function (r) { return r.status === 200 ? r.body : null; }, function () { return null; });
  });
}
function storagePathOf(fb, url) {
  var bucket = fb && fb.bucket && fb.bucket.name, m = /^https:\/\/storage\.googleapis\.com\/([^\/?#]+)\/([^?#]+)/.exec(String(url || ''));
  try { return m && m[1] === bucket ? decodeURIComponent(m[2]) : ''; } catch (e) { return ''; }
}

/* The logo the owner uploaded wins over anything derived: it is the hero's unit, examined like any other
   (examineUnit) — its year set to the event's if it shows an earlier one, a sponsor's mark cropped out —
   and used exactly as uploaded when the examination finds nothing to change.
   o: { ownerLogoUrl, eventMeta, briefTexts, stamp, deadlineAt }
   -> unit | null (no upload) | { refused: true, note } — an upload that could not be used at all (not to be
   had, not a picture, an SVG that could run code): the hero falls back to the previous edition's unit or the
   event's name, and the owner is told why, never silently (the bug this was written for). */
function ownerLogoUnit(fb, eventId, o) {
  var url = String(o.ownerLogoUrl || '').trim();
  if (!/^https:\/\//i.test(url)) return Promise.resolve(null);
  function refused(why) {
    console.error('logo unit: the uploaded logo of ' + eventId + ' was not used (' + why + ') — ' + url);
    return { refused: true, note: 'Your uploaded logo could not be used here (' + why + '), so the hero does not show it. Upload it again under Event logo in the event\'s Basics as a PNG, WEBP or plain SVG, or select this and use Replace image.' };
  }
  return fetchOwnerLogo(fb, url).then(function (bytes) {
    if (!bytes) return refused('the file could not be read');
    var info = logoUnit.imageInfo(bytes);
    if (!info.type || !(info.width > 0) || !(info.height > 0)) return refused('it is not a picture this site can show');
    if (info.type === 'svg' && svgCouldRun(bytes.toString('utf8'))) return refused('the SVG contains scripts or embedded content');
    var name = (o.eventMeta || {}).name;
    var years = { from: '', to: logoUnit.eventYear({ eventName: name, start: (o.eventMeta || {}).start, briefTexts: o.briefTexts }) };
    /* a logo unit is a small picture: one larger than that is used as uploaded, unexamined, and said so */
    var examined = bytes.length <= LOGO_UNIT_MAX_BYTES
      ? examineUnit(fb, eventId, { bytes: bytes, info: info }, { years: years, origin: 'owner', eventName: name, deadlineAt: o.deadlineAt })
      : Promise.resolve({ picture: { bytes: bytes, info: info }, changed: false, notes: [], tone: '', stuck: '', unread: true, seen: '', tooBig: true });
    return examined.then(function (ex) {
      var notes = ex.notes.slice();
      var seen = ex.seen && logoUnit.shownYear(ex.seen);
      if (ex.stuck) {
        notes.push('Your logo shows ' + ex.stuck + ', not ' + logoUnit.yearAs(ex.stuck, years.to) + ', and that could not be changed without redrawing it. Upload this year\'s logo under Event logo in the event\'s Basics, or select it here and use Replace image.');
      } else if (ex.tooBig) {
        notes.push('Your logo is too large a file (' + (bytes.length / 1048576).toFixed(1) + ' MB) to be checked, so it is used exactly as you uploaded it. Check that it shows this edition\'s year; a smaller file (under 3 MB) is checked for you.');
      } else if (ex.unread) {
        notes.push('Your logo could not be read to check its year and its contents, so it is used exactly as you uploaded it.');
      } else if (!ex.changed && !notes.length) {
        /* what was found, said as it is: this edition's year, no year, a year that is not an edition's to
           move, or no event year to compare it with */
        var found = !seen ? 'no edition year'
          : !years.to ? ex.seen + ' (the event\'s own year could not be told from its name, dates or brief, so it was left as it is)'
          : seen.full === years.to ? ex.seen + ', this edition\'s year,'
          : ex.seen + ', which was left as it is (not a recent edition\'s year),';
        notes.push('Your logo was checked: it shows ' + found + ' and nothing from another edition, so it is used exactly as you uploaded it.');
      }
      var unit = { source: 'owner', from: url, heroMode: heroModeOf(ex.tone), plate: '', note: notes.join(' ') };
      /* used as uploaded: its own file — unless it is an SVG with no size of its own, which is stored once
         with its size written in (storeLogoUnit) so that it does not collapse in the hero */
      var unsized = info.type === 'svg' && sizedSvg(bytes.toString('utf8'), info) !== bytes.toString('utf8');
      if (!ex.changed && !unsized) return Object.assign(unit, { url: url, storagePath: storagePathOf(fb, url), width: info.width, height: info.height });
      return storeLogoUnit(fb, eventId, o.stamp, ex.picture).then(function (stored) {
        return Object.assign(unit, { url: stored.url, storagePath: stored.storagePath, width: ex.picture.info.width || 0, height: ex.picture.info.height || 0 });
      });
    });
  });
}

function drawnLogoUnit(fb, eventId, o) {
  var design = o.design, tone = design.mode === 'dark' ? 'dark' : 'light';
  var parts = design.logoUnit || genDesign.logoUnitParts(o.eventMeta.name);
  var name = [parts.before, parts.keyword, parts.after].filter(Boolean).join(' ');
  if (!name) return Promise.resolve(null);
  var logo = etLogoSvg(tone);
  if (!logo) return Promise.resolve(null);
  return fetchUnitFont(design.headingFont, 700, name).then(function (font) {
    var made = logoUnit.buildLogoUnitSvg({ parts: parts, style: design.logoUnitStyle, tone: tone, themeColor: design.themeColor, font: font || { family: design.headingFont }, etLogoSvg: logo });
    if (!made.svg || svgCouldRun(made.svg)) return null;
    var storagePath = 'events/' + eventId + '/generated/' + o.stamp + '-logo-unit.svg';
    return storePublicPicture(fb, storagePath, Buffer.from(made.svg, 'utf8'), 'image/svg+xml').then(function (url) {
      return { url: url, storagePath: storagePath, source: 'generated', from: '', width: made.width, height: made.height, heroMode: '', plate: '', note: '' };
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

/* ---------- the owner's logo after the site was made ----------
   An AI-designed site keeps its logo unit in two places the server writes: designPlan.design.logoUnit*
   (what the hero is built from) and the hero in generatedSections (what the editor opens before the site
   is first saved). A saved site (page.html, its versions) is the owner's: it is never written here — the
   editor offers the new unit there, and puts it in itself where the hero still shows the unit that was
   made automatically (editor-template-ui.js, ownerLogoOffer).
     ownerLogoState(data)  -> what an event's logo unit is: { logoUrl, aiDesigned, source, unitUrl, savedSite,
                              needsOwnerUnit } — needsOwnerUnit: the owner uploaded a logo and the design's
                              unit is not made from it
     swapHeroUnit(html, unitHtml) -> the hero's markup with its logo unit (the [data-rv-logo-unit] block)
                              replaced by unitHtml, or null when it has none
     saveOwnerUnit(fb, eventId, unit, { heroNote }) -> Promise<{ heroUpdated, savedSite, toneClash }>: the unit written to the design
                              and to the generated hero, in one transaction */
function ownerLogoState(data) {
  data = data || {};
  var design = aiDesignOf(data.designPlan);
  var logoUrl = /^https:\/\//i.test(String(data.logoUrl || '')) ? String(data.logoUrl).trim() : '';
  var site = data.site && typeof data.site === 'object' ? data.site : null;
  var state = {
    logoUrl: logoUrl, aiDesigned: !!design, source: design ? String(design.logoUnitSource || '') : '', unitUrl: design ? String(design.logoUnitUrl || '') : '',
    savedSite: !!site && +site.version > 0
  };
  state.needsOwnerUnit = !!(logoUrl && design && !(state.source === 'owner' && (design.logoUnitFrom === logoUrl || state.unitUrl === logoUrl)));
  return state;
}
function swapHeroUnit(html, unitHtml) {
  html = String(html || '');
  var at = html.search(/<div\b[^>]*\sdata-rv-logo-unit\b[^>]*>/i);
  if (at === -1 || !unitHtml) return null;
  var re = /<(\/?)div\b[^>]*>/gi, depth = 0, m;
  re.lastIndex = at;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (!depth) return html.slice(0, at) + unitHtml + html.slice(m.index + m[0].length);
  }
  return null;
}
function unitFields(unit) {
  return {
    logoUnitUrl: unit.url || '', logoUnitStoragePath: unit.storagePath || '', logoUnitSource: unit.source || '', logoUnitFrom: unit.from || '',
    logoUnitWidth: unit.width || 0, logoUnitHeight: unit.height || 0, logoUnitPlate: unit.plate || '', logoUnitNote: unit.note || '', logoUnitHeroMode: unit.heroMode || ''
  };
}
function saveOwnerUnit(fb, eventId, unit, opts) {
  /* opts.heroNote false: the hero's unit carries no note (the design keeps it) */
  var heroNote = !(opts && opts.heroNote === false);
  var ref = fb.db.collection('events').doc(eventId), out = null;
  return fb.db.runTransaction(function (tx) {
    /* a transaction can run more than once: what it found is the last run's */
    out = { heroUpdated: false, savedSite: false, toneClash: '' };
    return tx.get(ref).then(function (snap) {
      if (eventStateOf(snap) !== 'live') throw httpError(404, 'No event found for "' + eventId + '".', { code: 'event-missing' });
      var data = snap.data(), design = (data.designPlan && data.designPlan.design) || {};
      var fields = unitFields(unit), patch = { updatedAt: new Date().toISOString() };
      Object.keys(fields).forEach(function (k) { patch['designPlan.design.' + k] = fields[k]; });
      out.savedSite = ownerLogoState(data).savedSite;
      var sections = Array.isArray(data.generatedSections) ? data.generatedSections : null;
      if (sections) {
        var mode = /^(dark|light)$/.test(String(unit.heroMode)) ? unit.heroMode : (/^(dark|light)$/.test(String(design.logoUnitHeroMode)) ? design.logoUnitHeroMode : design.mode);
        var unitHtml = genDesign.logoUnitImageHtml({ url: unit.url, alt: data.name || eventId, width: unit.width, height: unit.height, plate: unit.plate, note: heroNote ? unit.note : '', mode: mode });
        var next = sections.map(function (s) {
          if (!s || s.id !== 'hero') return s;
          /* A logo drawn for a dark ground (white lettering) would vanish on a light hero, and the other way
             round: the hero's own tone is not changed here (its colours and veil are the design's), so such a
             logo is not swapped in — the owner is told (toneClash), and the design's unit takes effect when
             the site is next generated. */
          var heroTone = (/\bhero-on-(dark|light)\b/.exec(String(s.html || '')) || [])[1] || '';
          if (heroTone && /^(dark|light)$/.test(String(unit.heroMode)) && unit.heroMode !== heroTone) { out.toneClash = unit.heroMode; return s; }
          var html = swapHeroUnit(s.html, unitHtml);
          if (html === null || html === s.html) return s;
          out.heroUpdated = true;
          return Object.assign({}, s, { html: html });
        });
        if (out.heroUpdated) patch.generatedSections = next;
      }
      tx.update(ref, patch);
    });
  }).then(function () { return out; });
}
/* the facts an examination of the owner's logo needs, from the event's document and its newest brief */
function ownerUnitInputs(fb, eventId, data) {
  return fb.db.collection('events').doc(eventId).collection('briefs').orderBy('createdAt', 'desc').limit(1).get().then(function (snap) {
    var brief = snap.empty ? null : snap.docs[0].data().extracted;
    var eventMeta = { name: data.name, start: data.start, description: data.description };
    return { ownerLogoUrl: data.logoUrl, eventMeta: eventMeta, briefTexts: briefYearTexts(brief, eventMeta) };
  });
}

/* POST /api/event/logo-unit  { eventId }
   The event's logo was uploaded or changed after its site was designed: it is examined as plan-structure
   examines it (ownerLogoUnit: its year brought to the event's, another edition's marks cropped, never
   redrawn) and becomes the design's logo unit and the generated hero's. A saved site is not touched: the
   answer says so, and the editor offers the new unit when the site is next opened.
   -> 200 { aiDesigned, unit: { url, width, height, source, note, heroMode } | null, heroUpdated, savedSite,
            toneClash: 'dark' | 'light' | '' — the logo is drawn for that ground and the generated hero is the
            other, so it was not swapped into the hero } */
function handleEventLogoUnit(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var ref = fb.db.collection('events').doc(eventId);
    ref.get().then(function (snap) {
      var state = eventStateOf(snap);
      if (state !== 'live') throw notLiveError(state, eventId);
      var data = snap.data(), info = ownerLogoState(data);
      if (!info.logoUrl) return sendJson(res, 400, { error: 'This event has no logo yet. Upload one first.', code: 'no-logo' });
      /* a site that is not AI-designed shows the logo where its template puts it: nothing to examine */
      if (!info.aiDesigned) return sendJson(res, 200, { aiDesigned: false, unit: null, heroUpdated: false, savedSite: info.savedSite });
      return ownerUnitInputs(fb, eventId, data).then(function (o) {
        o.stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        o.deadlineAt = Date.now() + 100000;
        return ownerLogoUnit(fb, eventId, o);
      }).then(function (unit) {
        if (!unit || unit.refused) return sendJson(res, 422, { error: (unit && unit.note) || 'The logo could not be read as a picture. Upload it again as a PNG, WEBP or SVG.', code: 'logo-unreadable' });
        return saveOwnerUnit(fb, eventId, unit).then(function (done) {
          sendJson(res, 200, { aiDesigned: true, unit: { url: unit.url, width: unit.width, height: unit.height, source: unit.source, note: unit.note, heroMode: unit.heroMode }, heroUpdated: done.heroUpdated, savedSite: done.savedSite, toneClash: done.toneClash });
          logActivity(fb, eventId, decoded, 'logo-changed', 'logo put into the site’s design' + (unit.url === info.logoUrl ? ' (as uploaded)' : ' (examined copy)') +
            (done.heroUpdated ? '; banner updated' : done.toneClash ? '; banner kept — the logo is drawn for a ' + done.toneClash + ' background' : ''), { area: 'design' });
        });
      });
    }).catch(function (err) { sendFailure(res, 'logo-unit', err, 'The logo could not be put into the site. Please try again.'); });
  });
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

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    var eventRef = fb.db.collection('events').doc(eventId);
    var watch = null;
    /* one time limit for everything this request asks a model: the plan, then reading the logo unit */
    var deadlineAt = Date.now() + llm.LIMITS.budgetMs;
    watchEvent(fb, eventId).then(function (w) {
      watch = w;
      return Promise.all([
        eventRef.get(),
        eventRef.collection('briefs').orderBy('createdAt', 'desc').limit(1).get(),
        eventRef.collection('sources').get(),
        /* what the event already has on record (Content › Agenda, Speakers, FAQ): a list that exists gets its section */
        Promise.all(['sessions', 'speakers', 'faqs'].map(function (c) { return eventRef.collection(c).limit(1).get().then(function (q) { return q.empty ? '' : c; }, function () { return ''; }); }))
      ]);
    }).then(function (results) {
      var eventSnap = results[0], briefSnap = results[1], sourcesSnap = results[2];
      var onRecord = (results[3] || []).filter(Boolean);
      var stored = eventSnap.exists ? eventSnap.data() : {};
      /* the facts of the event only: what earlier runs left on the record is not material for a new design */
      var eventMeta = Object.assign({}, {
        name: stored.name, category: stored.category, start: stored.start, end: stored.end,
        venue: stored.venue, city: stored.city, description: stored.description
      }, payload.eventMeta || {});
      /* the description's headings are the owner's brief — directions, not facts to show (owner-brief.js) */
      eventMeta.description = ownerBrief.withoutHeadings(eventMeta.description);
      if (!eventMeta.description) delete eventMeta.description;
      var brief = briefSnap.empty ? null : briefSnap.docs[0].data().extracted;
      var sourceDocs = sourcesSnap.docs.map(function (d) { return d.data(); });
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
          delete design.logoUnitDarkUrl; delete design.logoUnitDarkStoragePath;
          var heroImage = made[0];
          /* the hero picture's name carries the run (buildHeroImage) */
          design.heroImageUrl = heroImage.heroImageUrl || null;
          design.heroImageStoragePath = heroImage.heroImageStoragePath;
          design.heroImageError = heroImage.heroImageError;
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
          var onDark = lightHero && unit.url ? storeOnDarkUnit(fb, eventId, stamp, unit) : Promise.resolve(null);
          return onDark.then(function (dark) {
          if (dark) { design.logoUnitDarkUrl = dark.url; design.logoUnitDarkStoragePath = dark.storagePath; }

          var designPlan = {
            sections: sections, design: design, generatedAt: now, themeMode: themeMode, ownerNotes: ownerNotes, siteMode: siteMode,
            owner: owner,
            reference: reference.basis
              ? { type: reference.basis.type, url: reference.basis.url, design: reference.basis.design }
              : { type: 'none', artDirection: artDirection.id }
          };
          /* the event's description, written from the brief and the previous edition — only where it is empty or
             still the owner's raw brief; one the owner wrote by hand is kept (event-description.js) */
          var described = eventDescription.patch(r.parsed && r.parsed.eventDescription, stored, (payload.eventMeta || {}).description);
          return watch.merge(Object.assign({ designPlan: designPlan, matchedTemplateId: null, structurePlan: null, theme: null }, described || {}))
            .then(function () {
              sendJson(res, 200, { eventId: eventId, matchedTemplateId: null, structurePlan: null, theme: null, designPlan: designPlan, description: described ? described.description : undefined });
              if (watch.live) logActivity(fb, eventId, req.user, 'site-designed', 'AI made a new site design — ' + sections.length + ' sections', { area: 'design' });
              if (watch.live && described) logActivity(fb, eventId, req.user, 'updated', eventDescription.ACTIVITY_DETAIL, { area: 'event',
                fields: [{ field: 'description', before: String(stored.description || '').slice(0, 600), after: described.description }] });
            });
          });
        });
      });
    }).catch(function (err) { sendStepFailure(res, err, 500, 'plan-structure failed: ' + err.message); });
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
        .then(function () { return draftRef.collection('drafts').add({ templateId: templateId, sourceEventId: sourceEventId, library: library, positioningNotes: positioningNotes, model: r.model || GEMINI_TEXT_MODEL, generatedAt: now, skippedLibraries: skippedLibraries }); })
        .then(function (docRef) {
          sendJson(res, 200, { eventId: eventId, templateId: templateId, draftId: docRef.id, positioningNotes: positioningNotes, library: library });
          if (watch.live) logActivity(fb, eventId, by, 'site-generated', 'AI content written for the site (' + Object.keys(library).length + ' parts) — opened in the editor next', { area: 'site' });
        });
    });
  }).catch(function (err) { sendStepFailure(res, err, 500, 'generate-content failed: ' + err.message); });
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

/* The facts of an event a prompt may see. The record also holds what earlier runs produced (designPlan,
   generatedSections, the saved site…): shown to the model, a re-run would be anchored to the last result. */
function eventFacts(stored, sent) {
  stored = stored || {};
  var facts = {};
  ['name', 'category', 'categoryLabel', 'start', 'end', 'dateLabel', 'date', 'location', 'venue', 'city', 'client', 'description'].forEach(function (k) {
    var v = (sent && sent[k] != null && sent[k] !== '') ? sent[k] : stored[k];
    /* the description's headings are the owner's brief — directions, not facts to show (owner-brief.js) */
    if (k === 'description') v = ownerBrief.withoutHeadings(v);
    if (v != null && v !== '') facts[k] = v;
  });
  return facts;
}

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
  if (NEW_ET_STANDARD) {
    return 'BANDS, AS ON ET\'S NEWER SITES: most sections are light (var(--rv-bg) / var(--rv-surface), text var(--rv-text)); the "What awaits you" band, the discussion topics and the closing call to act are DEEP, DARK bands — background a very deep shade of the brand colour, e.g. color-mix(in srgb, var(--theme-color) 22%, #0b0b10), with light text (#f4f1ec and rgba(244,241,236,.72) for secondary text) and accents in the brand colour. Never two dark bands next to each other. Text set over a photo sits on a dark veil over the WHOLE photo — at least rgba(0,0,0,.72), deeper behind the words — in light text, so no lettering or logo in the photo shows through the words. Headlines are an editorial serif (var(--heading-font-family)) under a small numbered eyebrow in letter-spaced capitals ("01  OVERVIEW").';
  }
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
    'You are writing the REAL HTML and CSS of a bespoke event microsite, for ET Oneworld\'s event builder — designing and coding it yourself to the standard of a top agency, not filling a template. Ground every fact below — never invent a date, number, named person or company that isn\'t clearly present in the material. Leave out what nothing supports; never pad with generic filler.',
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

// "degrade, never crash" sanitizers (same discipline buildHeroImage elsewhere in this file already uses) —
// strip what matches, keep the rest, never throw on malformed input.
function sanitizeGeneratedSectionHtml(html) {
  try {
    var out = String(html || '');
    out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
    out = out.replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '').replace(/<iframe\b[^>]*\/?>/gi, '');
    out = out.replace(/<object\b[\s\S]*?<\/object\s*>/gi, '').replace(/<object\b[^>]*\/?>/gi, '');
    out = out.replace(/<embed\b[^>]*\/?>/gi, '');
    out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '').replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
    out = out.replace(/(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"');
    out = out.replace(/(href|src)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'");
    /* Google Fonts only, in its <style> blocks and style="" attributes too; no stylesheet <link> of its own */
    out = googleFonts.googleOnlyHtml(out);
    return out;
  } catch (e) {
    console.error('sanitizeGeneratedSectionHtml failed on malformed input, degrading to empty — ' + e.message);
    return '';
  }
}
function sanitizeGeneratedSectionCss(css) {
  try {
    var out = String(css || '');
    out = out.replace(/@import\b[^;]*;?/gi, '');
    /* Google Fonts only: no face of its own, every family named a Google one */
    out = googleFonts.googleOnlyCss(out);
    out = out.replace(/url\(\s*["']?\s*javascript:[^)]*\)/gi, 'url()');
    out = out.replace(/behavior\s*:[^;]*;?/gi, '');
    out = out.replace(/-moz-binding\s*:[^;]*;?/gi, '');
    return out;
  } catch (e) {
    console.error('sanitizeGeneratedSectionCss failed on malformed input, degrading to empty — ' + e.message);
    return '';
  }
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
    var html = sanitizeGeneratedSectionHtml(String(found.html || ''));
    /* no text below the smallest readable size, and no heading above the site's type scale, whatever was
       written (the hero keeps its own type) */
    var css = genDesign.clampFontSizes(sanitizeGeneratedSectionCss(String(found.css || '')));
    if (p.id !== 'hero') css = genDesign.capHeadingSizes(css, html);
    sections.push({ id: p.id, kind: p.kind, html: html, css: css });
  });
  return sections;
}

/* The site is written in two calls side by side once it has more than a few sections: each answer is
   smaller, so neither runs into the time one call may take, and the page is ready sooner. Both are shown
   the whole plan and the same rules. -> [[ids], [ids]] or [[ids]] */
var SECTION_CODE_SPLIT_ABOVE = 5;
/* Claude writes at a steadier, slower pace than Gemini: asked first, it is given two sections a call, all
   calls side by side, so that each answer is ready well inside its time. */
var SECTION_CODE_CLAUDE_BATCH = 2;
function sectionCodeBatches(designPlan) {
  /* every section but the hero and the nav, which are built here (genDesign.heroHtml, et-nav.js) */
  var ids = plannedSectionList(designPlan).map(function (s) { return s.id; }).filter(function (id) { return id !== 'hero' && id !== 'nav'; });
  if (llm.activeProvider() === 'claude') {
    var small = [];
    for (var i = 0; i < ids.length; i += SECTION_CODE_CLAUDE_BATCH) small.push(ids.slice(i, i + SECTION_CODE_CLAUDE_BATCH));
    return small.length ? small : [ids];
  }
  if (ids.length <= SECTION_CODE_SPLIT_ABOVE) return [ids];
  var cut = Math.ceil(ids.length / 2);
  return [ids.slice(0, cut), ids.slice(cut)];
}

/* ---------- ET's common footer on an AI-designed site (et-footer.js) ----------
   The portal a site belongs to: the one its previous edition (or this edition's own page) was read from — the
   portal the records came from, else the address. series: that address's event series
   (brand-world-summit-south2025 -> brand-world-summit-south), so "What's Happening" never lists this very
   event's own ET page. -> { portal: slug | '', series } */
function sitePortal(sourceDocs) {
  var own = (sourceDocs || []).filter(function (v) { return v && (v.type === 'previousEdition' || v.type === 'currentEdition'); });
  own.sort(function (a, b) { return (a.type === b.type ? 0 : a.type === 'previousEdition' ? -1 : 1) || (b.previous ? 1 : 0) - (a.previous ? 1 : 0); });
  for (var i = 0; i < own.length; i++) {
    var v = own[i], url = (v.previous && v.previous.url) || v.url;
    var portal = v.previous && etEvents.isPortal(v.previous.portal) ? v.previous.portal : etPrevious.portalOf(url);
    if (etEvents.isPortal(portal)) return { portal: portal, series: etPrevious.seriesOf(etPrevious.slugOf(url)) };
  }
  return { portal: '', series: '' };
}
/* What is on now or coming on that portal, from ET's event list (kept 6 hours). Never rejects and never holds
   generation up: ET not answering, or slow, leaves the footer without its "What's Happening" column. */
var FOOTER_EVENTS_WAIT_MS = 20000;
function footerEvents(portal, fetchJson) {
  if (!etEvents.isPortal(portal)) return Promise.resolve([]);
  var timer = null;
  var late = new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, FOOTER_EVENTS_WAIT_MS); if (timer.unref) timer.unref(); });
  return Promise.race([etEvents.listUpcoming(portal, fetchJson || etJson), late]).then(function (list) {
    clearTimeout(timer);
    if (!list) console.warn('footer: ET\'s event list for ' + portal + ' did not come in time — no "What\'s Happening"');
    return Array.isArray(list) ? list : [];
  }, function (err) {
    clearTimeout(timer);
    console.warn('footer: ET\'s event list for ' + portal + ' was not read — ' + (err && err.message));
    return [];
  });
}
/* The footer section itself, scoped and to the site's type scale as every other section is.
   o = { portal, series, events, design, eventName, date, place, button, year, mode } — mode: the tone of the
   theme the site is shown in when it is not the design's own (the portal logo's ink follows it) */
function siteFooter(o) {
  o = o || {};
  var design = o.design || {};
  /* with no contact section the main button leads to the footer itself (ownerBrief.buttons): in the footer's
     own band it would go nowhere, so the band then shows the event's name, date and place without it */
  var button = o.button && String(o.button.href || '').trim() !== '#footer' ? o.button : null;
  var built = etFooter.build({
    portal: o.portal, mode: (o.mode || design.mode) === 'dark' ? 'dark' : 'light', year: o.year || new Date().getFullYear(),
    events: etFooter.happening(o.events, { name: o.eventName, series: o.series }),
    event: o.eventName ? { name: o.eventName, date: o.date, place: o.place, button: button } : null,
    buttonInk: rvTheme.inkOn(/^#[0-9a-f]{6}$/i.test(String(design.themeColor || '')) ? design.themeColor : '#186bf9')
  });
  return { id: 'footer', kind: 'footer', html: built.html, css: genDesign.capHeadingSizes(genDesign.clampFontSizes(scopeSectionCss(built.css, 'footer', sectionRootInfo(built.html))), built.html) };
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
// builds the prompt from designPlan, calls Gemini, sanitizes, and persists {generatedSections} directly on
// the event doc (not a subcollection — same persistence style designPlan/structurePlan/theme already used).
// Also still writes a `drafts` row (library: {} deliberately empty) purely so GET /api/draft's existing
// draftId/staleness-tracking machinery keeps working for this event — see this function's call site for the
// full reasoning.
function runGenerateDesignedContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, designPlan, by) {
  /* a plan made before sponsors were put first is written in today's order (section-order.js) */
  designPlan = Object.assign({}, designPlan, { sections: sectionOrder.sponsorsFirst(designPlan.sections) });
  var draftRef = fb.db.collection('events').doc(eventId);
  var sourceRef = fb.db.collection('events').doc(sourceEventId);
  var watch = null, overviewPictured = false;
  watchEvent(fb, eventId).then(function (w) {
    watch = w;
    return Promise.all([
      sourceRef.get(),
      sourceRef.collection('briefs').orderBy('createdAt', 'desc').limit(1).get(),
      sourceRef.collection('sources').get()
    ]);
  }).then(function (results) {
    var eventSnap = results[0], briefSnap = results[1], sourcesSnap = results[2];
    var stored = eventSnap.exists ? eventSnap.data() : {};
    var eventMeta = eventFacts(stored, payload.eventMeta);
    var logoUrl = /^https:\/\//i.test(String(stored.logoUrl || '')) ? stored.logoUrl : '';
    var brief = briefSnap.empty ? null : briefSnap.docs[0].data().extracted;
    var sources = sourcesSnap.docs.map(function (d) {
      var v = d.data();
      return { type: v.type, url: v.url, extractedSections: v.extractedSections };
    });
    /* the footer's "What's Happening" is read from ET while the site is being written */
    var footerOf = sitePortal(sourcesSnap.docs.map(function (d) { return d.data(); }));
    var footerRead = footerEvents(footerOf.portal);

    // 100s, not the 60s default — writing full bespoke HTML/CSS is a genuinely bigger generation job than
    // any other call this file makes. A timeout is never retried (gemini.js), so 100s is also the longest
    // this request can spend on the model: the calls of a split site run side by side, not one after another.
    var batches = sectionCodeBatches(designPlan);
    /* an award site: the words of its internal pages, written beside the sections (writeAwardPages) */
    var awardRead = designPlan.siteMode === 'award'
      ? writeAwardPages(fb, eventId, stored, sourcesSnap.docs.map(function (d) { return d.data(); }), brief, eventMeta).then(function (a) {
        /* its Nomination form (a Category list from its categories) and its Express Interest form
           (api-forms.js createAwardForms: reused when they exist, their categories brought up to date) */
        return require('./api-forms').createAwardForms(fb, eventId, { categories: a.award.categories, nominateTitle: 'Nomination', by: by })
          .then(function (ids) { a.forms = ids; return a; }, function (err) {
            console.error('generate-content: the award forms of ' + eventId + ' were not made — ' + (err && err.message));
            a.forms = {}; return a;
          });
      })
      : Promise.resolve(null);
    return Promise.all(batches.map(function (ids) {
      var prompt = buildSectionCodePrompt({ eventMeta: eventMeta, brief: brief, sources: sources, designPlan: designPlan, futureEdition: futureEdition, logoUrl: logoUrl, write: ids });
      return llm.callJson(prompt, SECTION_CODE_SCHEMA, { timeoutMs: 100000, route: 'generate-content', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.site, onUsage: aiUsageRecorder(fb, eventId, 'generate-content') });
    })).then(function (answers) {
      /* a section that came back without its styles (or not at all) shows as bare text on the page: it is
         written once more on its own, and the second answer replaces the first */
      var again = answers.some(function (r) { return r.error; }) ? [] : unstyledSectionIds(answers, designPlan);
      if (!again.length) return answers;
      console.warn('generate-content: ' + eventId + ' — written again, unstyled or missing: ' + again.join(', '));
      var prompt = buildSectionCodePrompt({ eventMeta: eventMeta, brief: brief, sources: sources, designPlan: designPlan, futureEdition: futureEdition, logoUrl: logoUrl, write: again });
      return llm.callJson(prompt, SECTION_CODE_SCHEMA, { timeoutMs: 100000, route: 'generate-content', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.site, onUsage: aiUsageRecorder(fb, eventId, 'generate-content') })
        .then(function (r) {
          if (r.error || !r.parsed || !Array.isArray(r.parsed.sections)) return answers;
          var fixed = r.parsed.sections.filter(function (s) { return s && again.indexOf(slugifyId(s.id)) !== -1 && String(s.css || '').trim().length >= UNSTYLED_CSS_CHARS && !emptyPictureBox(s.html, s.css); });
          var ids = fixed.map(function (s) { return slugifyId(s.id); });
          return answers.map(function (a) {
            return Object.assign({}, a, { parsed: Object.assign({}, a.parsed, { sections: (a.parsed.sections || []).filter(function (s) { return !s || ids.indexOf(slugifyId(s.id)) === -1; }) }) });
          }).concat([{ parsed: { sections: fixed } }]);
        }, function () { return answers; });
    }).then(function (answers) {
      /* an overview too thin for its layout gets a picture made from its words, and is written again with it */
      if (answers.some(function (r) { return r.error; })) return answers;
      return fillSparseOverview(fb, eventId, answers, designPlan, {
        eventMeta: eventMeta, brief: brief,
        prompt: { eventMeta: eventMeta, brief: brief, sources: sources, futureEdition: futureEdition, logoUrl: logoUrl }
      }).then(function (r) {
        if (r.designPlan !== designPlan) { designPlan = r.designPlan; overviewPictured = true; }
        return r.answers;
      });
    }).then(function (answers) {
      return Promise.all([footerRead, awardRead]).then(function (both) { return { answers: answers, footerList: both[0], award: both[1] }; });
    }).then(function (got) {
      var answers = got.answers;
      var failed = answers.filter(function (r) { return r.error; })[0];
      if (failed) return sendAiFailure(res, failed);
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
      if (heroMode === 'light' && design.logoUnitDarkUrl) {
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
      /* the previous edition's sections, built here from its real records (prev-sections.js), each in its
         planned place */
      var prevDoc = sourcesSnap.docs.map(function (d) { return d.data(); }).filter(function (v) { return v.type === 'previousEdition' && v.previous; })[0];
      /* every photo a section shows: the previous edition's gallery leaves them out (no picture twice on a page) */
      var usedPhotos = [];
      planned.forEach(function (x) { if (x.imageUrl) usedPhotos.push(x.imageUrl); (x.photos || []).forEach(function (u) { usedPhotos.push(u); }); });
      if (design.heroImageUrl) usedPhotos.push(design.heroImageUrl);
      /* an award site's own sections built from its records (award-sections.js), by id */
      var awardHome = {};
      /* the previous edition's photos not shown elsewhere on the page light the award's stage panels and its calls to act */
      var awardRec = sourcesSnap.docs.map(function (d) { return d.data(); }).filter(function (v) { return v.type === 'previousEdition' && v.award; }).map(function (v) { return v.award; })[0];
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
      var navFor = { order: sections.filter(function (s) { return !s.page; }).map(function (s) { return s.id; }), sources: sourcesSnap.docs.map(function (d) { return d.data(); }), owner: designPlan.owner || (brief && brief.owner) };
      /* An award site: a link to each of its internal pages, and no button at the right of the bar. That place is
         the portal's sign-in on ET's own sites; with no sign-in for the portals here, the owner had the bar's
         "Express Interest" taken away (28 Oct 2026) — the hero and the footer keep the award's button. */
      if (got.award) {
        navFor.cta = false;
        navFor.tabs = sitePages.map(function (pg) { return { label: AWARD_TAB_LABELS[pg.slug] || pg.title, page: pg.slug }; });
      }
      var navSection;
      /* never a reason to lose a whole site: a bar that cannot be made from the stored records is made from
         the event's facts alone (no portal, the default action) */
      try { navSection = etNav.sectionFor(Object.assign({}, eventMeta, { designPlan: designPlan }), navFor); }
      catch (navErr) {
        console.error('[generate-content] the ET bar for ' + eventId + ' fell back to the plain one: ' + (navErr && navErr.message));
        navSection = etNav.sectionFor(Object.assign({}, eventMeta, { designPlan: { sections: [] } }), { order: navFor.order });
      }
      sections.unshift(navSection);
      /* no more than two rows move on their own, never in neighbouring sections (genDesign.motionBudget) */
      genDesign.motionBudget(sections);
      var positioningNotes = answers.map(function (r) { return String(r.parsed.positioningNotes || '').trim(); }).filter(Boolean).join(' ').slice(0, 500);
      var now = new Date().toISOString();

      /* generatedAt is what a list reads to know this event has a generated site, without reading the site */
      var merged = { generatedSections: sections, generatedPages: sitePages, generatedAt: now };
      /* the overview's picture, made here (fillSparseOverview), is kept with the plan as every section's is */
      if (overviewPictured) merged.designPlan = { sections: designPlan.sections };
      /* an award site's internal pages' words, kept until the site can have pages (SITE_PAGES) */
      if (got.award) merged.awardPages = got.award.pages;
      return watch.merge(merged)
        /* an award site's FAQs are the event's FAQ records (Content › FAQ), as the page shows them: the ones
           written for this edition, put there only while the event has none of its own */
        .then(function () { return got.award ? seedAwardFaqs(fb, eventId, got.award, by) : null; })
        /* ...and its jury, the event's Speakers records: the jury on record, while the event has none of its own */
        .then(function () { return got.award ? seedAwardJury(fb, eventId, got.award.award.jury, by) : null; })
        .then(function () {
          return draftRef.collection('drafts').add({
            templateId: templateId, sourceEventId: sourceEventId, library: {},
            positioningNotes: positioningNotes, model: (answers[0] && answers[0].model) || GEMINI_TEXT_MODEL, generatedAt: now, skippedLibraries: []
          });
        })
        .then(function (docRef) {
          sendJson(res, 200, {
            eventId: eventId, templateId: templateId, draftId: docRef.id, positioningNotes: positioningNotes,
            sections: sections.map(function (s) { return { id: s.id, kind: s.kind }; }), library: {}
          });
          if (watch.live) logActivity(fb, eventId, by, 'site-generated', 'AI wrote the site’s ' + sections.length + ' sections again — opened in the editor next', { area: 'site' });
        });
    });
  }).catch(function (err) { sendStepFailure(res, err, 500, 'generate-content failed: ' + err.message); });
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

var PICTURE_URL = /https?:\/\/[^\s"'()<>]+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s"'()<>]*)?|data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+\/=]+/gi;

function buildRedesignPrompt(payload) {
  var design = payload.design || {};
  var radius = (design.cornerRadius || '12') + 'px';
  var urls = payload.pictureTokens || [];
  var lines = [
    payload.mode === 'edit'
      ? 'You are changing ONE section of an event microsite that is already built, for ET Oneworld\'s event builder, exactly as its owner asked. Return the section\'s whole HTML and CSS after the change.'
      : payload.mode === 'create'
        ? 'You are writing ONE NEW section for an event microsite that is already built, for ET Oneworld\'s event builder, from its owner\'s brief. Return the section\'s HTML and CSS, to the standard of a top agency.'
        : 'You are redesigning ONE section of an event microsite that is already built, for ET Oneworld\'s event builder. Return that section\'s new HTML and CSS — a visibly different, better design of the same section, to the standard of a top agency.',
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
    payload.mode === 'create' ? '' : 'KEEP THESE ATTRIBUTES exactly as they are on the elements that carry them: data-rv-repeat-template, data-rv-field, data-rv-bind, data-rv-bound, data-rv-auto, data-rv-logo, data-rv-logo-unit, data-register-cta, data-rv-form, data-rv-form-embed, data-rv-form-title, data-rv-carousel, data-rv-carousel-track. An element with data-rv-repeat-template stays the single template item it is — never write more copies of it, and never remove it unless the owner asked for the list to go. An element with data-rv-form-embed stays exactly as it is, with its contents (it is a form the site draws in place); keep it in the section.',
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
      var pictures = {};
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
        var newHtml = genDesign.restorePictures(sanitizeGeneratedSectionHtml(String(r.parsed.html || '')).trim(), pictures, found[0] || '');
        if (!/^<[a-zA-Z]/.test(newHtml)) return sendJson(res, 502, { error: 'The AI did not return a usable section. Nothing on the site changed — try again.', code: 'ai-unusable' });
        var newCss = genDesign.clampFontSizes(sanitizeGeneratedSectionCss(String(r.parsed.css || '')));
        /* no heading above the site's type scale, as when the site was made (the hero keeps its own type) */
        if (sectionId !== 'hero' && payload.generated !== false) newCss = genDesign.capHeadingSizes(newCss, newHtml);
        newCss = genDesign.restorePictures(newCss, pictures, found[0] || '');
        var scopedCss = scopeSectionCss(newCss, sectionId, sectionRootInfo(newHtml));
        /* an AI-designed site's section is held to a phone's width as soon as it is remade, as on the published
           page (gen-markup.js mobileSafeCss; idempotent); a fixed template's CSS is left as it was written */
        if (payload.generated !== false) scopedCss = mobileSafeCss(scopedCss);
        sendJson(res, 200, {
          sectionId: sectionId, html: newHtml,
          css: scopedCss,
          summary: String(r.parsed.summary || '').trim().slice(0, 300)
        });
      });
    }).catch(function (err) { sendStepFailure(res, err, 500, 'redesign-section failed: ' + err.message); });
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

    var fb = getFirebase();
    if (fb.error) return sendJson(res, 503, { error: fb.error });

    // AI-DESIGNED GENERATED TEMPLATES: templateId:'gen-<eventId>' has no templates/<id>/template.json on
    // disk at all — Gemini designs/writes its own HTML+CSS per section (runGenerateDesignedContent, a
    // deliberately SEPARATE pipeline from the ported-template path below — see that function's own header
    // comment for why), reading the designPlan /api/plan-structure already saved on events/{genEventId}.
    if (/^gen-/.test(templateId)) {
      var genEventId = templateId.slice(4);
      if (!isEventId(genEventId)) return sendJson(res, 400, { error: 'Invalid templateId.' });
      return fb.db.collection('events').doc(genEventId).get().then(function (snap) {
        var data = snap.exists ? snap.data() : {};
        var designPlan = data.designPlan;
        if (!designPlan || !designPlan.design || !Array.isArray(designPlan.sections)) {
          return sendJson(res, 400, { error: 'No design plan found for "' + genEventId + '" — run /api/plan-structure first.' });
        }
        runGenerateDesignedContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, designPlan, req.user);
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

    runGenerateContent(res, fb, payload, eventId, templateId, sourceEventId, futureEdition, (templateJson.content || {}).map, skippedLibraries, null, req.user);
  }, BODY_LIMITS.ai);
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
  if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  fb.db.collection('events').doc(eventId).collection('drafts').orderBy('generatedAt', 'desc').limit(1).get()
    .then(function (snap) {
      if (snap.empty) return sendJson(res, 404, { error: 'No generated draft found for "' + eventId + '" — run /api/generate-content first.' });
      var draftId = snap.docs[0].id, draft = snap.docs[0].data();
      sendJson(res, 200, { eventId: eventId, templateId: draft.templateId, draftId: draftId, generatedAt: draft.generatedAt || null, handoff: libraryToHandoffDraft(draft.library, eventId, draft.skippedLibraries) });
    })
    .catch(function (err) { sendJson(res, 500, { error: 'get-draft failed: ' + err.message }); });
}

/* ---------- GET /api/generated-template?eventId=<id> — AI-DESIGNED GENERATED TEMPLATES PIPELINE, step 3 ----------
   Assembles the exact template.json shape (see the top-of-file comment and the contract shared with the
   frontend's template-loader.js) from the designPlan + generatedSections /api/plan-structure and
   /api/generate-content already saved on events/{eventId}. No fixed component library anymore: every
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
    buttons: 'a, button, [class*="btn"], [class*="cta"]',
    cards: '[data-rv-repeat-template], [class*="card"]',
    swatches: [design.themeColor]
  };
}

function fontStack(family) { return '"' + family + '", Arial, sans-serif'; }

/* The page's section ids, top to bottom: nav, hero, designPlan.sections in planned order with this edition's
   sponsors first (section-order.js), footer — filtered down to whatever generatedSections actually has
   (generate-content may have had to omit a planned section whose id was missing from Gemini's response; see
   sanitizeSectionCodeResult). */
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
    if (!designPlan || !designPlan.design || !Array.isArray(designPlan.sections)) {
      return sendJson(res, 404, { error: 'No design plan found for "' + eventId + '" — run /api/plan-structure first.' });
    }
    var generatedSections = Array.isArray(data.generatedSections) ? data.generatedSections : [];
    if (!generatedSections.length) {
      return sendJson(res, 404, { error: 'No generated sections found for "' + eventId + '" — run /api/generate-content first.' });
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
  }).catch(function (err) { sendJson(res, 500, { error: 'generated-template failed: ' + err.message }); });
}

/* ---------- GET /api/generated-section?eventId=<id>&id=<sectionId> — AI-DESIGNED GENERATED TEMPLATES
   PIPELINE, step 4 ----------
   PUBLIC, no auth (template-loader.js's load() runs in the ordinary browser context, same reasoning as
   /api/imported-section) — one section's real, Gemini-written {html, css}, read straight off
   events/{eventId}.generatedSections (POST /api/generate-content already wrote it there). */
function handleGeneratedSection(req, res) {
  var qs = new URLSearchParams(req.url.split('?')[1] || '');
  var eventId = String(qs.get('eventId') || '').trim();
  var sectionId = String(qs.get('id') || '').trim();
  if (!eventId || !sectionId) return sendJson(res, 400, { error: 'eventId and id are required.' });
  if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  fb.db.collection('events').doc(eventId).get().then(function (snap) {
    if (!snap.exists) return sendJson(res, 404, { error: 'No event found for "' + eventId + '".' });
    var data = snap.data();
    var sections = Array.isArray(data.generatedSections) ? data.generatedSections : [];
    var found = sections.filter(function (s) { return s && s.id === sectionId; })[0];
    if (!found) return sendJson(res, 404, { error: 'No generated section "' + sectionId + '" found for "' + eventId + '".' });
    /* scoped on the way out as well as when stored (it is idempotent), so sections stored before the
       server did the scoping are served correctly too */
    var html = String(found.html || '');
    /* the links of the top bar and the footer follow the page's order (a site made before that was enforced
       is served so too) */
    if ((sectionId === 'nav' || sectionId === 'footer') && data.designPlan && Array.isArray(data.designPlan.sections)) html = sectionOrder.orderNavLinks(html, generatedPageIds(data.designPlan, sections));
    var css = genDesign.clampFontSizes(scopeSectionCss(found.css, sectionId, sectionRootInfo(html)));
    /* no heading louder than the site's type scale — a section stored before the scale was calmed is served
       calm too (idempotent); the hero banner keeps its own type */
    if (sectionId !== 'hero') css = genDesign.capHeadingSizes(css, html);
    /* a colour of the design's palette written as a fixed value becomes its variable, so every theme reaches
       it (templates/_shared/rv-theme.js); the hero banner keeps its own tone */
    if (sectionId !== 'hero' && data.designPlan && data.designPlan.design) css = rvTheme.themableCss(css, data.designPlan.design);
    /* held to a phone's width (gen-markup.js; idempotent), as on the published page — not the top bar and the
       footer, which the server builds for phones itself (et-nav.js, et-footer.js: their one-line texts stay one line) */
    if (sectionId !== 'nav' && sectionId !== 'footer') css = mobileSafeCss(css);
    sendJson(res, 200, { html: html, css: css });
  }).catch(function (err) { sendJson(res, 500, { error: 'generated-section failed: ' + err.message }); });
}

/* =====================================================================================================
   LOVABLE IMPORT PIPELINE — POST /api/import-lovable, GET /api/imported-template, GET /api/imported-section
   ---------------------------------------------------------------------------------------------------
   A user runs a browser-console export script (lives in their own Downloads folder, not part of this repo)
   on a live Lovable.app site; it scrapes the page into a ZIP (index.html + css/*.css + js/*.js + images/* +
   fonts/* + assets/*) wired up with its own JS loader (js/lov-boot.js) that re-hydrates the exported files
   back into a live React app. That re-hydration is exactly what we must NOT ship into this app's own
   editor: editor-canvas.js's click-to-edit canvas (RevampCanvas.mount -> template-loader.js's load() ->
   editor-canvas.js's tagEditables/walk()) wants clean static markup it alone controls, not a second JS
   runtime fighting it for the same DOM. So this pipeline FLATTENS the export (strips the re-hydration
   script, keeps the real rendered body + CSS) and feeds it through the exact same template-loader.js
   contract every ported/generated template already uses — walk() tags ANY captured markup (images, SVG
   icons, <a> text as buttons, any element with its own text) editable independent of content.map, so once
   the markup is clean static HTML, zero section-detection heuristics are needed here.

   Judgment call — CSS inline vs. linked: this pipeline INLINES every gathered stylesheet directly as
   <style> tags, both in the debug/intermediate "events/import-<id>/index.html" artifact and in what GET
   /api/imported-section actually serves. Reasoning: there's exactly one opaque section and the ZIP's own
   CSS already carries embedded font data URIs (the exporter's own design, see its header comment, point 4)
   — there is no real benefit to a second round-trip for a separate .css file, and template-loader.js's
   per-section fetch already has a dedicated "style.css" slot that would otherwise go unused. Rather than
   add an unused network hop, the 'imported' branch below resolves that slot to an inert Promise.resolve('')
   and ships the CSS already embedded in the one HTML fetch instead — see template-loader.js's `imported`
   branch for the other half of this contract.

   Judgment call — the content.map entry: an imported design isn't broken into library sections at all, so
   there is no wizard field ("from") for it to receive content from. The map entry below uses
   `from: 'imported'` — an id this app's wizard content object will never contain — so editor-fill.js's
   apply() always takes its `if (!(m.from in ctx.content)) return;` early-out and leaves the section's own
   captured markup completely untouched, exactly as a template section with NO content.map entry at all
   would (templates/README.md's "sections left out, and the editor says which"). The entry still exists
   (rather than an empty content.map) purely so `mappedSections`/AI-provenance bookkeeping in editor-fill.js
   has a definite, harmless answer for this section id, should that code path ever run against an imported
   template — `fill: []` + a `from` that can never resolve means it can never write anything.

   Two input methods, one core — a second input method was added after the above (a live site URL, rendered
   with real headless Chrome instead of requiring the user to run the console exporter and upload its ZIP;
   see the HEADLESS RENDER ADAPTER block below for why a plain server-side fetch() of a Lovable URL can't
   work: it only returns the empty pre-render React shell, never the real page, since Lovable sites are
   client-rendered SPAs). Both methods produce the SAME three ingredients — HTML text, a way to fetch a
   stylesheet's content by its href, a way to fetch an image's bytes by its ref — and hand them to the one
   shared processLovableImport() below, which does everything past that point (CSS gathering, image rehost,
   Storage artifacts, the Firestore doc) identically regardless of where the ingredients came from. Keeping
   that function the single place this logic lives means template-loader.js's `imported-` branch, the
   content.map judgment call above, and everything else in this block needed ZERO changes to support the
   new input method. */

// 40MB cap on the decoded ZIP — generous for a real site export (it can carry many images), small enough to
// keep one request well under Cloud Functions' own request size ceiling. Named/sized the same way
// MAX_BRIEF_BYTES/MAX_PUBLISHED_HTML_BYTES already are in this file.
var MAX_IMPORT_ZIP_BYTES = 40 * 1024 * 1024;

var IMPORT_IMAGE_CONTENT_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif'
};
function guessImageContentType(filename) {
  var m = /\.([a-z0-9]+)$/i.exec(filename);
  return (m && IMPORT_IMAGE_CONTENT_TYPES[m[1].toLowerCase()]) || 'application/octet-stream';
}

function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Generic "<tag attr="val" attr2='val2'>" -> {attr: val, attr2: val2} (lowercased keys) — the same
// regex-over-raw-markup style extractColorSignals/extractFontSignals already use in this file, kept generic
// enough to read any attribute off any tag (link rel/href/as, script src/type) without a DOM.
function parseTagAttrs(tag) {
  var attrs = {};
  var re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*'([^']*)'/g;
  var m;
  while ((m = re.exec(tag))) {
    if (m[1] !== undefined) attrs[m[1].toLowerCase()] = m[2];
    else attrs[m[3].toLowerCase()] = m[4];
  }
  return attrs;
}

// Strips the <link> noise (preload/preconnect/dns-prefetch/modulepreload hints meaningless without a JS
// runtime) and collects every <link rel="stylesheet" href="..."> for the caller to fetch separately (its
// content is gathered by the caller's own getCss() and re-inlined into the final document instead — see
// the CSS inline-vs-linked judgment call above). Shared by BOTH import adapters — a ZIP's own css/*.css
// links and a live-rendered page's real stylesheet links are discovered exactly the same way, only how the
// href is turned into actual CSS text (getCss) differs per adapter.
function extractStylesheetLinks(html) {
  var cssHrefs = [];
  var out = html.replace(/<link\b[^>]*>/gi, function (tag) {
    var attrs = parseTagAttrs(tag);
    var rel = (attrs.rel || '').toLowerCase();
    var as = (attrs.as || '').toLowerCase();
    if (rel === 'stylesheet' && attrs.href) { cssHrefs.push(attrs.href); return ''; }
    if (rel === 'modulepreload' || rel === 'preconnect' || rel === 'dns-prefetch') return '';
    if (rel === 'preload' && (as === 'script' || as === 'font')) return '';
    return tag; // icons/canonical/manifest/etc. — not in the strip list, left alone
  });
  return { html: out, cssHrefs: cssHrefs };
}

// ZIP-export-specific script stripping — exactly what this pipeline always did (unchanged behavior): only
// the exporter's own re-hydration runtime (its JS chunks under js/, any text/lov-module script, any inline
// bootstrap carrying __LOV_CONFIG/__LOV_SRC). A ZIP export can carry other, harmless inline scripts (e.g.
// JSON-LD) that this intentionally leaves alone.
function stripZipExportScripts(html) {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, function (full, attrPart, body) {
    var attrs = parseTagAttrs('<script' + attrPart + '>');
    var src = attrs.src || '';
    var type = (attrs.type || '').toLowerCase();
    if (type === 'text/lov-module') return '';
    if (/^\.{0,2}\/?js\//.test(src)) return '';
    if (!src && (body.indexOf('__LOV_CONFIG') !== -1 || body.indexOf('__LOV_SRC') !== -1)) return '';
    return full;
  });
}

// Generic "<script>...</script>" removal for the headless-render adapter's live DOM snapshot — a direct
// capture of document.documentElement.outerHTML has real Lovable runtime/analytics/etc. <script> tags with
// no exporter-specific markers to target selectively (none of stripZipExportScripts's patterns apply: there's
// no js/ folder, no lov-module, no __LOV_CONFIG bootstrap — this is a live page, not the exporter's static
// output). Removing every script tag outright is still correct: editor-canvas.js's click-to-edit canvas
// never wants a second JS runtime in its DOM either way (see this block's header comment), and there's no
// re-hydration loader worth preserving in a direct DOM capture.
function stripAllScriptTags(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// The site builder's own "Edit with Lovable" badge — a link into the owner's Lovable project, not part of
// their page. (et-runtime.js removes it from pages imported before this did.)
function stripBuilderBadge(html) {
  return html.replace(/<aside\b[^>]*\bid=["']lovable-badge["'][\s\S]*?<\/aside>/gi, '');
}

function extractBodyInner(html) {
  var m = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1] : html;
}

// Every "images/<name>.<ext>" token found anywhere in the given text (HTML body + gathered CSS combined),
// however it's written (./images/x, ../images/x, images/x — inside url(...), src="...", a style attribute,
// whatever) — a plain substring scan, same pragmatic regex-over-text approach as stripToText/
// extractColorSignals elsewhere in this file, not a real CSS/HTML parse. This is the ZIP adapter's default
// finder (processLovableImport's `findImageRefs` option) — scoped to the ZIP's own known images/ folder
// convention, which a live-rendered page has no equivalent of (see findLiveImageRefs below for that case).
function findImportImageRefs(text) {
  var seen = {};
  var re = /(?:\.{1,2}\/)?images\/[A-Za-z0-9_\-.]+\.[A-Za-z0-9]+/gi;
  var m;
  while ((m = re.exec(text))) { seen[m[0].replace(/^\.{1,2}\//, '')] = 1; }
  return Object.keys(seen);
}

// The headless-render adapter's image finder — a live page's images can be absolute CDN URLs, root-relative
// paths, or data: URIs, with no shared folder convention to anchor on the way the ZIP export's images/
// folder lets findImportImageRefs above anchor. Matches an <img>/<source> src or srcset entry, and a CSS
// url(...), ending in a real image extension. data: URIs are skipped (already inline, nothing to re-host).
function findLiveImageRefs(text) {
  var seen = {};
  var re = /(?:\bsrc|\bsrcset)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  var m;
  while ((m = re.exec(text))) {
    var raw = m[1] || m[2];
    if (!raw) continue;
    raw.split(',').forEach(function (part) {
      var url = part.trim().split(/\s+/)[0];
      if (!url || /^data:/i.test(url)) return;
      if (!/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)(\?|#|$)/i.test(url)) return;
      seen[url] = 1;
    });
  }
  return Object.keys(seen);
}

// Replaces every written form of a reference to one zip-relative path (./images/x, ../images/x, images/x)
// with its final Storage URL, across one piece of text. (Works unchanged for the live-render adapter's
// absolute/root-relative URL refs too — they have no "./"/"../" prefix to begin with, so that part of the
// pattern just never matches, and the plain escaped-URL match still does.)
function buildImportRefRegex(ref) {
  return new RegExp('(?:\\.{1,2}\\/)?' + escapeRegex(ref), 'g');
}

/* The real work shared by BOTH import adapters (ZIP upload and live-URL render) — everything from "clean,
   script-stripped markup in hand" to "Storage artifacts + Firestore doc written". Pulled out so it's a
   plain (fb, importId, ...) function callable on its own by an integration test without needing a real
   Firebase Auth ID token to get past requireAdmin — same shape/reasoning as runGenerateContent elsewhere in
   this file. Not exported; handleImportLovable below is still the only real HTTP entry point.

     html            string    already script-stripped (stripZipExportScripts or stripAllScriptTags) HTML —
                                full document or just <body>, either way (extractBodyInner trims either).
                                Still has its <link rel="stylesheet"> tags; extractStylesheetLinks above
                                strips+collects those itself, so every caller does this step identically.
     getCss(href)    href is exactly the string written in that <link href="...">; -> Promise<string|null>
                                (null for "couldn't fetch this one" — degrades, never fails the whole import,
                                same discipline the old gatherImportCss used).
     getImage(ref)   ref is exactly one token findImageRefs(text) returned; -> Promise<Buffer|null>.
     findImageRefs(text)       optional; defaults to findImportImageRefs (the ZIP adapter's own convention).
     docFields                 extra fields merged into the events/import-<id> Firestore doc (e.g.
                                {sourceZipName} or {sourceUrl}) — whatever that adapter wants
                                handleImportedTemplate's display-name lookup to see. */
function processLovableImport(fb, importId, html, getCss, getImage, findImageRefs, docFields) {
  findImageRefs = findImageRefs || findImportImageRefs;
  var linked = extractStylesheetLinks(html);
  var bodyHtml = stripBuilderBadge(extractBodyInner(linked.html));

  return Promise.all(linked.cssHrefs.map(function (href) {
    return getCss(href).then(function (text) { return (text == null) ? null : { href: href, text: text }; });
  })).then(function (cssResults) {
    cssResults = cssResults.filter(Boolean);
    var combined = bodyHtml + '\n' + cssResults.map(function (r) { return r.text; }).join('\n');
    var imageRefs = findImageRefs(combined);

    return Promise.all(imageRefs.map(function (ref) {
      return getImage(ref).then(function (imgBuffer) {
        if (!imgBuffer) return null;
        var basename = ref.split(/[\\/]/).pop().split('?')[0].split('#')[0] || 'image';
        var sanitized = basename.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'image';
        var storagePath = 'events/import-' + importId + '/images/' + sanitized;
        var file = fb.bucket.file(storagePath);
        /* an import's folder is its own (import-<id>) and written once: cached for a year, with WebP copies
           of each raster picture (pictures.js) — a Lovable export's pictures are often megabyte PNGs */
        return file.save(imgBuffer, { metadata: { contentType: guessImageContentType(sanitized), cacheControl: 'public, max-age=31536000' },
            gzip: pictures.gzipWorthIt(guessImageContentType(sanitized), imgBuffer) })   // an SVG stored gzipped (pictures.js)
          .then(function () { return file.makePublic(); })
          .then(function () { return pictures.storeVariants(fb, storagePath, imgBuffer); })
          .then(function () { return { ref: ref, url: 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath }; });
      }).catch(function (err) {
        console.error('import-lovable: failed to re-host image "' + ref + '": ' + err.message);
        return null; // that one image stays unrewritten rather than failing the whole import
      });
    })).then(function (uploaded) {
      uploaded.filter(Boolean).forEach(function (u) {
        var re = buildImportRefRegex(u.ref);
        bodyHtml = bodyHtml.replace(re, u.url);
        cssResults = cssResults.map(function (r) { return { href: r.href, text: r.text.replace(re, u.url) }; });
      });

      var styleBlocks = cssResults.map(function (r) {
        return '<style data-rv-imported-css="' + escAttr(r.href) + '">\n' + r.text + '\n</style>';
      }).join('\n');
      var wrappedBody = '<div class="rv-imported">\n' + bodyHtml + '\n</div>';
      // Served as-is by GET /api/imported-section — CSS + the one wrapper div template-loader.js's
      // tagSection() needs a single root element to stamp data-rv-section onto (see this block's
      // header comment on the CSS judgment call).
      var sectionHtml = styleBlocks + '\n' + wrappedBody;
      // The separate, full standalone document — an intermediate/debug artifact only (never served
      // directly to end users, unlike events/{id}/published/index.html — see lib/firebase.js).
      var fullDoc = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n' + styleBlocks +
        '\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>\n';

      var flattenedHtmlPath = 'events/import-' + importId + '/index.html';
      var sectionHtmlPath = 'events/import-' + importId + '/section.html';
      /* The page cut into the sections it is made of (import-split.js), so that each can be edited, moved,
         reworked by the AI and opened in the developer zone on its own. A page that cannot be cut stays the
         one section above. The ET wrappers the page loader puts between the page's frame and its sections
         are taken out of the layout, so the sections sit in the frame as they did in the original. */
      var split = null;
      try { split = splitImportedPage(bodyHtml); } catch (e) { console.error('import-lovable: could not cut the page into sections — ' + e.message); }
      var sectionsPath = 'events/import-' + importId + '/sections.json';
      var FRAME_CSS = '<style data-rv-imported-frame>body#imported #container,body#imported #content,body#imported .main-body,body#imported .container-fluid,body#imported .row,body#imported .col-md-12{display:contents}body#imported .blur_bg,body#imported .wrapper.schemas{display:none}</style>';
      var sectionsDoc = split ? {
        v: 2,
        frameOpen: styleBlocks + '\n' + FRAME_CSS + '\n' + split.frameOpen + split.decor,
        frameClose: split.frameClose,
        sections: split.sections
      } : null;

      return fb.bucket.file(flattenedHtmlPath)
        .save(Buffer.from(fullDoc, 'utf8'), { metadata: { contentType: 'text/html; charset=utf-8' } })
        .then(function () { return fb.bucket.file(flattenedHtmlPath).makePublic(); })
        .then(function () {
          return fb.bucket.file(sectionHtmlPath)
            .save(Buffer.from(sectionHtml, 'utf8'), { metadata: { contentType: 'text/html; charset=utf-8' } });
        })
        .then(function () { return fb.bucket.file(sectionHtmlPath).makePublic(); })
        .then(function () {
          if (!sectionsDoc) return null;
          return fb.bucket.file(sectionsPath).save(Buffer.from(JSON.stringify(sectionsDoc), 'utf8'), { metadata: { contentType: 'application/json; charset=utf-8' } });
        })
        .then(function () {
          var now = new Date().toISOString();
          return fb.db.collection('events').doc('import-' + importId).set(Object.assign(
            { importedAt: now, flattenedHtmlPath: flattenedHtmlPath, sectionHtmlPath: sectionHtmlPath,
              /* the list of sections, for the template; their markup is in Storage (sectionsPath) */
              sectionsPath: sectionsDoc ? sectionsPath : null,
              sections: sectionsDoc ? sectionsDoc.sections.map(function (x) { return { id: x.id, name: x.name }; }) : null },
            docFields || {}
          ), { merge: true });
        })
        .then(function () { return { templateId: 'imported-' + importId }; });
    });
  });
}

/* ---------- ZIP adapter — unchanged behavior, restructured to call into processLovableImport ---------- */
function runImportLovableFromZip(fb, res, importId, zipBase64, sourceZipName) {
  var buffer;
  try { buffer = Buffer.from(zipBase64, 'base64'); } catch (e) { return sendJson(res, 400, { error: 'zipBase64 is not valid base64.' }); }
  if (buffer.length === 0) return sendJson(res, 400, { error: 'The uploaded ZIP is empty.' });
  if (buffer.length > MAX_IMPORT_ZIP_BYTES) return sendJson(res, 413, { error: 'The uploaded ZIP is larger than the 40MB pilot limit.' });

  JSZip.loadAsync(buffer)
    .catch(function (err) { throw Object.assign(new Error('Could not read the uploaded ZIP: ' + err.message), { status: 400 }); })
    .then(function (zip) {
      var entry = zip.file('index.html');
      if (!entry) {
        throw Object.assign(new Error('Couldn\'t find index.html in this ZIP — make sure you uploaded the export unchanged.'), { status: 400 });
      }
      return entry.async('string').then(function (rawHtml) {
        var html = stripZipExportScripts(rawHtml);
        // Reads a referenced ./css/<name>.css straight out of the zip — gracefully resolving to null when
        // missing instead of failing the whole import (same "degrade, never crash" discipline buildHeroImage
        // uses), exactly as the pre-refactor gatherImportCss did.
        var getCss = function (href) {
          var norm = href.replace(/^\.{1,2}\//, '').replace(/^\//, '');
          var file = zip.file(norm);
          if (!file) { console.error('import-lovable: referenced CSS file not found in zip: ' + href); return Promise.resolve(null); }
          return file.async('string');
        };
        var getImage = function (ref) {
          var file = zip.file(ref);
          if (!file) return Promise.resolve(null);
          return file.async('nodebuffer');
        };
        return processLovableImport(fb, importId, html, getCss, getImage, findImportImageRefs, { sourceZipName: sourceZipName });
      });
    })
    .then(function (result) { sendJson(res, 200, { templateId: result.templateId }); })
    .catch(function (err) { sendJson(res, err.status || 500, { error: err.status ? err.message : ('import-lovable failed: ' + err.message) }); });
}

/* =====================================================================================================
   HEADLESS RENDER ADAPTER — the live-URL input method (POST /api/import-lovable with {importId, url}
   instead of {importId, zipBase64}).
   ---------------------------------------------------------------------------------------------------
   Why this needs a real browser: a Lovable.app site is a client-rendered React SPA — a plain server-side
   fetch() of the URL returns only the near-empty pre-render shell (an almost bare <div id="root">, the
   bundle <script> tags, and nothing of the real page), confirmed against the real test site this session.
   There is no way to get the real final markup without actually executing the page's JS in a real browser
   engine — which is exactly what the browser-console exporter script (the OTHER input method, see this
   block's header comment) does by running inside an already-rendered tab. This adapter gets the same real,
   rendered markup a different way: a real headless Chrome navigates to the URL and
   document.documentElement.outerHTML is read back out once the page has actually mounted.

   This used to launch that Chrome in-process, right here, via puppeteer-core + @sparticuz/chromium. That
   broke in production: this backend deploys on Firebase App Hosting, whose container is built by Google's
   automatic Cloud Native Buildpacks — there is no Dockerfile, and therefore no way to apt-get install the
   system libraries (libnss3 and friends) headless Chrome needs, so the deployed process failed with
   "libnss3.so: cannot open shared object file" the moment it tried to launch Chrome.

   The fix: Chrome now runs in a separate, dedicated service — ../../lovable-scraper-service/ — deployed
   straight to Cloud Run with a real Dockerfile (not through App Hosting's buildpack pipeline), which CAN
   install whatever Chrome needs. scrapeLovableUrl() below is now just an HTTP client calling that
   service's one POST /scrape endpoint; see that directory's README.md for what it does, how to deploy it,
   and the env vars below. Everything else in this file — processLovableImport(), the SSRF guard just
   below, runImportLovableFromUrl() — needed zero changes: scrapeLovableUrl(url) still resolves to the
   same rendered-HTML string (or rejects with the same {status, message}-shaped error) it always did. */

// How long this backend will wait for the scraper service to respond before giving up and treating the
// render as failed. Set comfortably above that service's own internal 55s hard timeout (see
// lovable-scraper-service/server.js) so ITS clean {error} response is what normally wins — this is just
// the backstop for "the service didn't even respond" (e.g. it's down, or a network partition).
var SCRAPE_TOTAL_TIMEOUT_MS = 115000;

// Calls the separate lovable-scraper-service over plain HTTP instead of launching headless Chrome in this
// process (see the block comment above for why). LOVABLE_SCRAPER_URL/LOVABLE_SCRAPER_SECRET are read from
// process.env on every call, not cached at module load, matching how every other env-var read in this file
// behaves — see apphosting.yaml for how they're set in production and tools/.env.local for local dev.
function scrapeLovableUrl(url) {
  var scraperUrl = process.env.LOVABLE_SCRAPER_URL;
  if (!scraperUrl) {
    return Promise.reject(Object.assign(
      new Error('LOVABLE_SCRAPER_URL is not configured on this backend — see lovable-scraper-service/README.md.'),
      { status: 503 }
    ));
  }
  var scraperSecret = process.env.LOVABLE_SCRAPER_SECRET || '';
  var headers = { 'Content-Type': 'application/json' };
  if (scraperSecret) headers['X-Scraper-Secret'] = scraperSecret;

  var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = null;
  var fetchPromise = fetch(scraperUrl.replace(/\/+$/, '') + '/scrape', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ url: url }),
    signal: controller ? controller.signal : undefined
  });

  return new Promise(function (resolve, reject) {
    timer = setTimeout(function () {
      if (controller) controller.abort();
      reject(Object.assign(new Error('Rendering this page took too long (over ' + Math.round(SCRAPE_TOTAL_TIMEOUT_MS / 1000) + 's).'), { status: 504 }));
    }, SCRAPE_TOTAL_TIMEOUT_MS);
    fetchPromise.then(resolve, reject);
  })
    .then(function (r) {
      clearTimeout(timer);
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) {
          // A 401 here means SCRAPER_SECRET/LOVABLE_SCRAPER_SECRET are out of sync between the two
          // services — an ops misconfiguration, not something the end user did; surface it as a plain 500
          // rather than an "unauthorized" the admin triggering this import had no part in.
          var status = (r.status === 401) ? 500 : (r.status || 502);
          throw Object.assign(new Error((body && body.error) || ('Rendering that page failed (scraper service returned ' + r.status + ').')), { status: status });
        }
        if (!body || typeof body.html !== 'string') {
          throw Object.assign(new Error('The scraper service returned an unexpected response.'), { status: 502 });
        }
        return body.html;
      });
    }, function (err) {
      clearTimeout(timer);
      if (err && err.status) throw err;
      throw Object.assign(new Error('Could not reach the rendering service: ' + err.message), { status: 502 });
    });
}

// SSRF guard for the user-supplied url: only http(s), and not a host that resolves to this backend's own
// network — a real security boundary (this fetches an arbitrary user-supplied URL server-side), not just a
// correctness check. Rejects obviously-internal hostnames outright, then confirms via a real DNS lookup
// that the host doesn't resolve to a loopback/private/link-local address either (catches "a public-looking
// hostname that actually points at an internal IP" — a literal IP literal is caught by the same check since
// dns.lookup() on an IP string just returns that IP). Does NOT re-validate every subresource URL
// (stylesheet/image hrefs) discovered on the page afterward — those are fetched the same way a browser
// fetches any page's own subresources, no more of a server-side-request-forgery risk than the main fetch
// those requests are already covered by.
function isPrivateOrLoopbackIp(ip) {
  if (/^127\./.test(ip)) return true;                                    // IPv4 loopback
  if (/^10\./.test(ip)) return true;                                     // RFC1918
  if (/^192\.168\./.test(ip)) return true;                               // RFC1918
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;                // RFC1918
  if (/^169\.254\./.test(ip)) return true;                               // link-local / cloud metadata
  if (ip === '0.0.0.0') return true;
  if (ip === '::1') return true;                                         // IPv6 loopback
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;                       // IPv6 unique-local (fc00::/7)
  if (/^fe80:/i.test(ip)) return true;                                   // IPv6 link-local
  return false;
}
function validateImportUrl(rawUrl) {
  var u;
  try { u = new URL(rawUrl); } catch (e) { return Promise.resolve('That doesn\'t look like a valid URL.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return Promise.resolve('Only http:// and https:// URLs are allowed.');
  var host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateOrLoopbackIp(host)) {
    return Promise.resolve('That host isn\'t allowed.');
  }
  return new Promise(function (resolve) {
    dns.lookup(host, { all: true }, function (err, addrs) {
      if (err) return resolve('Could not resolve that host.');
      var bad = (addrs || []).some(function (a) { return isPrivateOrLoopbackIp(a.address); });
      resolve(bad ? 'That host resolves to a private address and isn\'t allowed.' : null);
    });
  });
}

/* ---------- live-URL adapter — same processLovableImport() core as the ZIP adapter above ---------- */
function runImportLovableFromUrl(fb, res, importId, url) {
  scrapeLovableUrl(url)
    .then(function (rawHtml) { return importRenderedPage(fb, importId, url, rawHtml); })
    .then(function (result) { sendJson(res, 200, { templateId: result.templateId }); })
    .catch(function (err) { sendJson(res, err.status || 500, { error: err.status ? err.message : ('import-lovable failed: ' + err.message) }); });
}

/* A page rendered and captured (lovable-scraper-service's capturePage) made into an import: its CSS and pictures
   fetched from where the page has them, and everything written as processLovableImport does. Also called by
   tools/reimport-lovable.js with a capture made on the operator's own Chrome. */
function importRenderedPage(fb, importId, url, rawHtml) {
  return Promise.resolve().then(function () {
    var html = stripAllScriptTags(rawHtml);
    /* Both getCss/getImage resolve the (possibly relative, possibly already-absolute) ref against the
       page's own URL, then fetch it directly — a public Lovable preview site's own CSS/images are public,
       ordinary GETs, same as a browser loading them; no cookie/session/Puppeteer-request-interception
       plumbing needed (confirmed against the real test site: both its stylesheet and its images are
       fetchable with a plain, unauthenticated fetch()).

       Each resolved URL is re-run through validateImportUrl() before fetching — this is NOT redundant
       with the top-level URL's own check above. The page being scraped is fully attacker-controlled
       (anyone can publish a Lovable site), so every CSS href / image src found IN that page's own
       rendered markup is attacker-controlled too. Without this, a malicious page could embed e.g.
       <img src="http://169.254.169.254/latest/meta-data/iam/security-credentials/"> and this server
       would dutifully fetch its own cloud metadata endpoint on the attacker's behalf — a classic
       confused-deputy SSRF via page content, a completely different request path from the one the
       top-level guard covers. A rejected subresource just degrades to "missing" (null), same as any
       other fetch failure here — never worth failing the whole import over one bad asset reference. */
    var getCss = function (href) {
      /* The address is read out of markup, where "&" is written "&amp;": left like that, a fonts stylesheet
         asked for several families answers with the first one only, and the page's other fonts are lost.
         A browser's User-Agent gets the compact font files a browser would get. */
      var abs; try { abs = new URL(String(href).replace(/&amp;/g, '&'), url).href; } catch (e) { return Promise.resolve(null); }
      return validateImportUrl(abs).then(function (badReason) {
        if (badReason) { console.error('import-lovable: refused to fetch CSS "' + abs + '": ' + badReason); return null; }
        return fetch(abs, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } }).then(function (r) { return r.ok ? r.text() : null; }).catch(function (err) {
          console.error('import-lovable: failed to fetch CSS "' + abs + '": ' + err.message);
          return null;
        });
      });
    };
    var getImage = function (ref) {
      var abs; try { abs = new URL(ref, url).href; } catch (e) { return Promise.resolve(null); }
      return validateImportUrl(abs).then(function (badReason) {
        if (badReason) { console.error('import-lovable: refused to fetch image "' + abs + '": ' + badReason); return null; }
        return fetch(abs).then(function (r) {
          if (!r.ok) return null;
          return r.arrayBuffer().then(function (buf) { return Buffer.from(buf); });
        }).catch(function (err) {
          console.error('import-lovable: failed to fetch image "' + abs + '": ' + err.message);
          return null;
        });
      });
    };
    return processLovableImport(fb, importId, html, getCss, getImage, findLiveImageRefs, { sourceUrl: url });
  });
}

function handleImportLovable(req, res) {
  requireAdmin(req, res, function (fb) {
    parseJsonBody(req, res, function (body) {
      var importId = String(body.importId || '').trim();
      if (!importId || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(importId)) {
        return sendJson(res, 400, { error: 'A valid importId (lowercase letters, digits, hyphens) is required.' });
      }
      var zipBase64 = body.zipBase64 ? String(body.zipBase64) : '';
      var url = body.url ? String(body.url).trim() : '';
      if (!zipBase64 && !url) return sendJson(res, 400, { error: 'Either zipBase64 or url is required.' });

      if (zipBase64) {
        var sourceZipName = body.fileName ? String(body.fileName).trim().slice(0, 200) : null;
        return runImportLovableFromZip(fb, res, importId, zipBase64, sourceZipName);
      }

      validateImportUrl(url).then(function (urlError) {
        if (urlError) return sendJson(res, 400, { error: urlError });
        runImportLovableFromUrl(fb, res, importId, url);
      });
    }, BODY_LIMITS.importZip);
  });
}

function handleImportedTemplate(req, res) {
  var qs = new URLSearchParams(req.url.split('?')[1] || '');
  var importId = String(qs.get('eventId') || '').trim();
  if (!importId) return sendJson(res, 400, { error: 'eventId is required.' });
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(importId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  fb.db.collection('events').doc('import-' + importId).get().then(function (snap) {
    if (!snap.exists) return sendJson(res, 404, { error: 'No imported design found for "' + importId + '" — run /api/import-lovable first.' });
    var data = snap.data();
    var name = data.sourceZipName || data.sourceUrl || importId;
    /* an import cut into sections: the page's frame around them comes with their markup (imported-section) */
    var cut = data.sectionsPath && Array.isArray(data.sections) && data.sections.length >= 2 ? data.sections : null;
    if (cut) {
      var ids = cut.map(function (x) { return x.id; });
      return sendJson(res, 200, {
        id: 'imported-' + importId, name: name, title: name, shared: [], fonts: [], design: {},
        header: 'none.html', footer: 'none.html', frame: true,
        body: { id: 'imported', class: 'microsite imported-microsite', style: {} },
        content: { map: [] },
        layout: { pinStart: ids.indexOf('nav') === 0 ? ['nav'] : [], pinEnd: ids[ids.length - 1] === 'footer' ? ['footer'] : [] },
        sections: cut.map(function (x) { return { id: x.id, name: x.name, etId: null, script: false }; })
      });
    }
    sendJson(res, 200, {
      id: 'imported-' + importId,
      name: name,
      title: name,
      shared: [],
      fonts: [],
      design: {},
      /* header/footer: 'none.html' (see templates/_shared/none.html), not the default header.html/
         footer.html — those are a real, visible "Shared header/footer — design to come" placeholder banner
         every OTHER template shows while the real unified ET chrome design is still pending. An imported
         design already captured its own complete, real header/nav/footer as part of the one opaque section
         below; stacking the generic placeholder on top of an already-finished site is wrong, not pending —
         confirmed visible in a real published page (the banner text literally appeared above the real
         imported content). */
      header: 'none.html',
      footer: 'none.html',
      body: { id: 'imported', class: 'microsite imported-microsite', style: {} },
      content: { map: [{ from: 'imported', section: 'imported', fill: [] }] },
      layout: { pinStart: ['imported'], pinEnd: [] },
      sections: [{ id: 'imported', name: 'Imported design', etId: null, script: false }]
    });
  }).catch(function (err) { sendJson(res, 500, { error: 'imported-template failed: ' + err.message }); });
}

function handleImportedSection(req, res) {
  var qs = new URLSearchParams(req.url.split('?')[1] || '');
  var importId = String(qs.get('eventId') || '').trim();
  if (!importId) return sendJson(res, 400, { error: 'eventId is required.' });
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(importId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  var docRef = fb.db.collection('events').doc('import-' + importId);
  docRef.get().then(function (snap) {
    var data = snap.exists ? snap.data() : null;
    if (!data || !data.sectionHtmlPath) {
      return sendJson(res, 404, { error: 'No imported design found for "' + importId + '" — run /api/import-lovable first.' });
    }
    /* ?all=1 — an import cut into sections: { frameOpen, frameClose, sections: { <id>: html } } */
    if (qs.get('all') === '1') {
      if (!data.sectionsPath) return sendJson(res, 404, { error: 'This import was not cut into sections.' });
      return fb.bucket.file(data.sectionsPath).download().then(function (contents) {
        var doc = JSON.parse(contents[0].toString('utf8')), byId = {};
        (doc.sections || []).forEach(function (x) { byId[x.id] = x.html; });
        sendJson(res, 200, { frameOpen: doc.frameOpen || '', frameClose: doc.frameClose || '', sections: byId });
      });
    }
    return fb.bucket.file(data.sectionHtmlPath).download().then(function (contents) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(contents[0]);
    });
  }).catch(function (err) { sendJson(res, 500, { error: 'imported-section failed: ' + err.message }); });
}

/* =====================================================================================================
   EVENT CONSOLE — real Firestore data for edit-event.html and its sibling tabs. See lib/firebase.js's
   header comment for the schema.
   ===================================================================================================== */

/* ---------- shared by every handler below ---------- */

/* An error that already knows what the caller should be told: `status` and a body fit to show a user.
   Thrown inside promise chains and Firestore transactions and turned into the response by sendFailure().
   (The Admin SDK retries a transaction only for its own retryable gRPC codes; an error without one, like
   this, ends the transaction at once and rejects with the same object.) */
function httpError(status, message, extra) {
  var err = new Error(message);
  err.status = status;
  err.body = Object.assign({ error: message }, extra || {});
  return err;
}

/* The single way a failed request is answered. An httpError goes out as written; anything else is a fault
   on our side — it is logged in full for us and the user gets one plain sentence, never the raw Firestore
   or Storage text (which used to leak document paths and gRPC codes into toasts). */
function sendFailure(res, what, err, friendly) {
  if (err && err.status && err.body) return sendJson(res, err.status, err.body);
  console.error('api: ' + what + ' failed — ' + (err && err.stack || err));
  sendJson(res, 500, { error: friendly || 'Something went wrong on the server. Please try again.' });
}

/* requireAdmin / parseJsonBody call back from inside a promise or a stream event, where a synchronous
   throw is caught by nobody: the request would get no answer at all and hang until the client gave up.
   Every handler below goes through these two, so a bug in a handler's own first lines costs that one
   request a 500 instead. cb(fb, decoded[, body]). */
function withAdmin(req, res, cb) {
  requireAdmin(req, res, function (fb, decoded) {
    try { cb(fb, decoded); } catch (err) { sendFailure(res, req.method + ' ' + req.url, err); }
  });
}
/* POST /api/event/theme { eventId, themeId } — the theme an AI-designed site opens in (the editor's Theme
   chooser and the preview's "Apply in editor" set it; the page itself carries it once saved). */
function handleEventTheme(req, res) {
  withAdminBody(req, res, BODY_LIMITS.small, function (fb, decoded, body) {
    var eventId = String(body.eventId || '').trim(), themeId = String(body.themeId || '').trim();
    if (!isEventId(eventId)) return sendJson(res, 400, { error: 'Invalid eventId.' });
    var ref = fb.db.collection('events').doc(eventId);
    ref.get().then(function (snap) {
      var plan = snap.exists && snap.data().designPlan;
      if (!plan || !aiDesignOf(plan)) return sendJson(res, 404, { error: 'This site has no themes: it was not designed by the AI.' });
      var themes = rvTheme.themesFor(Object.assign({}, plan.design, genDesign.palette(plan.design, 'auto')));
      var ids = themes.map(function (t) { return t.id; });
      if (ids.indexOf(themeId) === -1) return sendJson(res, 400, { error: 'Unknown theme "' + themeId.slice(0, 40) + '".' });
      var label = function (id) { var t = themes.filter(function (x) { return x.id === id; })[0]; return (t && t.label) || id || 'As designed'; };
      var was = plan.themeId || 'original';
      return ref.update({ 'designPlan.themeId': themeId, updatedAt: new Date().toISOString() }).then(function () {
        sendJson(res, 200, { eventId: eventId, themeId: themeId });
        if (was !== themeId) logActivity(fb, eventId, decoded, 'theme-changed', label(was) + ' → ' + label(themeId), { area: 'design', fields: [{ field: 'theme', before: label(was), after: label(themeId) }] });
      });
    }).catch(function (err) { sendFailure(res, 'theme', err, 'The theme could not be saved. Please try again.'); });
  });
}

/* Section edges — where one section's background meets the next: 'smooth' (the colours fade into each other;
   the page's runtime does it, reading <html data-rv-edges>, which publishTransform writes from
   designPlan.design.sectionEdges) or 'sharp' (a straight line). Smooth unless the owner chose sharp: a hard change
   of background from one section to the next was the owner's complaint about every site (28 Oct 2026). Kept with
   the site's theme, so it reaches a published page with the next publish. An imported (Lovable) site has no such
   choice and stays sharp. */
var SECTION_EDGES = ['sharp', 'smooth'];
/* The AI's design of a site (designPlan.design), or null. Saving the section edges on a site the AI did not
   design (a ported template like tech500) leaves a designPlan.design that holds only { sectionEdges }: that
   is a setting, not an AI design, and must not make the site count as AI-designed (the logo unit, themes). */
function aiDesignOf(plan) {
  var d = plan && typeof plan === 'object' && plan.design;
  if (!d || typeof d !== 'object') return null;
  return Object.keys(d).some(function (k) { return k !== 'sectionEdges'; }) ? d : null;
}
function sectionEdgesOf(event) {
  var v = event && event.designPlan && event.designPlan.design && event.designPlan.design.sectionEdges;
  return v === 'sharp' ? 'sharp' : 'smooth';
}
function isImportedSite(eventId, templateId) {
  return /^(imported|import)-/.test(String(templateId || '')) || /^import-/.test(String(eventId || ''));
}
function siteTemplateIdOf(event) {
  return String((event && ((event.site && event.site.templateId) || event.templateId)) || '');
}
/* POST /api/event/section-edges { eventId, sectionEdges: 'sharp' | 'smooth' } — the editor's Design panel saves
   it (the preview's "Apply in editor" carries a choice there). 200 { eventId, sectionEdges }. */
function handleEventSectionEdges(req, res) {
  withAdminBody(req, res, BODY_LIMITS.small, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var edges = typeof body.sectionEdges === 'string' ? body.sectionEdges.trim().toLowerCase() : '';
    if (SECTION_EDGES.indexOf(edges) === -1) return sendJson(res, 400, { error: 'Section edges must be "sharp" or "smooth".' });
    loadLiveEvent(fb, eventId).then(function (data) {
      if (isImportedSite(eventId, siteTemplateIdOf(data))) {
        return sendJson(res, 400, { error: 'An imported site keeps sharp section edges.', code: 'imported-site' });
      }
      var was = sectionEdgesOf(data);
      var label = function (v) { return v === 'smooth' ? 'Smooth' : 'Sharp'; };
      return eventDocRef(fb, eventId).update({ 'designPlan.design.sectionEdges': edges, updatedAt: new Date().toISOString() }).then(function () {
        sendJson(res, 200, { eventId: eventId, sectionEdges: edges });
        if (was !== edges) logActivity(fb, eventId, decoded, 'theme-changed', 'Section edges: ' + label(edges), { area: 'design', fields: [{ field: 'section edges', before: label(was), after: label(edges) }] });
      });
    }).catch(function (err) { sendFailure(res, 'section edges', err, 'The section edges could not be saved. Please try again.'); });
  });
}

function withAdminBody(req, res, maxBytes, cb) {
  withAdmin(req, res, function (fb, decoded) {
    parseJsonBody(req, res, function (body) {
      try { cb(fb, decoded, body); } catch (err) { sendFailure(res, req.method + ' ' + req.url, err); }
    }, maxBytes);
  });
}

function queryOf(req) { return new URLSearchParams(req.url.split('?')[1] || ''); }

/* Event ids and record ids become Firestore document paths and Storage object names. Firestore's own
   .doc() throws synchronously on "a/b", "." or "..", so an id is checked here before it is ever used —
   and answered 400, which is what it is, instead of the 401 / raw 500 / no reply at all it used to get. */
function eventIdOr400(res, value) {
  var id = typeof value === 'string' ? value.trim() : '';
  if (!id) { sendJson(res, 400, { error: 'eventId is required.' }); return ''; }
  if (!isEventId(id)) { sendJson(res, 400, { error: 'Invalid eventId — lowercase letters, digits and hyphens only.' }); return ''; }
  return id;
}
/* "__name__" is a form Firestore keeps for itself: .doc() accepts it and the request then fails. */
function isRecordId(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v) && !/^__.*__$/.test(v); }

function fieldDelete() { return require('firebase-admin').firestore.FieldValue.delete(); }

/* ---------- "this event exists" ----------
   One rule, the same one lib/api-events.js uses for the address check and for clone:

     live     events/<id> carries `createdAt` — stamped only by POST /api/event and by clone — and no
              `deletedAt`. Only a live event can be read, changed, given content, saved, published.
     deleted  it carries `deletedAt` (soft delete). To every route here it is as if it did not exist
              (404), but its address stays taken.
     shell    the document exists without `createdAt`. The AI steps write { ...eventMeta, updatedAt },
              `designPlan`, `theme` and so on with merge BEFORE the wizard creates the event, and older
              versions of this file created such documents as a side effect of PATCH / publish / stage on
              an id nobody had created. A shell is not an event: it is not listed, cannot be edited, and
              does not stop the address being used for a real event (see handleEventCreate for what a
              first creation over a shell keeps and what it throws away).
     missing  no document. */
function eventStateOf(snap) {
  if (!snap || !snap.exists) return 'missing';
  var d = snap.data() || {};
  if (d.deletedAt) return 'deleted';
  return d.createdAt ? 'live' : 'shell';
}
function notLiveError(state, eventId) {
  if (state === 'deleted') return httpError(404, 'This event has been deleted.', { code: 'event-deleted' });
  return httpError(404, 'No event found for "' + eventId + '".', { code: 'event-not-found' });
}
function eventDocRef(fb, eventId) { return fb.db.collection('events').doc(eventId); }

/* Resolves the event's data, or rejects with the 404 above. */
function loadLiveEvent(fb, eventId) {
  return eventDocRef(fb, eventId).get().then(function (snap) {
    var state = eventStateOf(snap);
    if (state !== 'live') throw notLiveError(state, eventId);
    return snap.data();
  });
}

/* The AI steps write onto the event, and under it, at the END of a model call that can run for over a
   minute — long enough for the owner to cancel and for the wizard to discard the draft (DELETE
   /api/event?discard=1) meanwhile. A late write would then bring the removed event back as a shell with
   a brief or a generated site under it. So each step looks at the event before it starts and again just
   before it stores anything:
     - an event that has been deleted is refused at the start (404) — no model call is paid for;
     - an event that was there at the start and is gone, or deleted, at the end answers
       409 { code: 'event-gone' } and stores nothing.
   An id with no event behind it at the start is left as it was: pages that run these steps before
   creating the event still work. Resolves { stillThere(), merge(data) }. */
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
    if (start === 'deleted') throw notLiveError('deleted', eventId);
    return {
      /* a real (created) event: only then does a step's result go into its activity log — the wizard runs
         these steps before the event exists */
      live: start === 'live',
      stillThere: function () { return ref.get().then(function (now) { check(now, start); }); },
      /* merges `data` into the event document, in the same transaction as the check */
      merge: function (data) {
        return fb.db.runTransaction(function (tx) {
          return tx.get(ref).then(function (now) { check(now, start); tx.set(ref, data, { merge: true }); });
        });
      }
    };
  });
}
/* How an AI step answers a failure of its own chain: a refusal made on purpose (httpError) as written,
   anything else as the route's existing message. */
function sendStepFailure(res, err, status, message) {
  if (err && err.status && err.body) return sendJson(res, err.status, err.body);
  sendJson(res, status, { error: message });
}

function publicPathOf(eventId) { return '/e/' + eventId; }

/* What a client is given for an event. The stored document plus the three things every list and console
   needs in one agreed form: `published` as a real boolean, `publishedPath` ("/e/<id>" while published,
   else null) and `counters`. Events published by the previous version of this file carry a
   `publishedUrl` on storage.googleapis.com; that address must not be shown any more (it stops working
   the next time the event is published), so it is replaced by the path here. Internal bookkeeping
   (the site save lock) is not sent. */
var EVENT_TIME_FIELDS = ['createdAt', 'updatedAt', 'publishedAt', 'unpublishedAt', 'deletedAt'];

/* A stored moment as an ISO string. Everything this file writes already is one; a document written by
   hand in the Firebase console, or by an import script, may hold a Firestore Timestamp instead, which
   would reach a client as { _seconds, _nanoseconds } and compare equal to nothing. */
function isoOf(v) {
  if (v == null || typeof v === 'string') return v;
  if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (e) { return null; } }
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return null;
}

function eventForClient(eventId, data) {
  var out = Object.assign({ eventId: eventId }, data);
  delete out.siteLock;
  delete out.aiUsage;                 // the History's own route answers it, with its labels
  EVENT_TIME_FIELDS.forEach(function (f) { if (has(out, f)) out[f] = isoOf(out[f]); });
  out.published = data.published === true;
  out.publishedPath = out.published ? publicPathOf(eventId) : null;
  if (out.published) out.publishedUrl = out.publishedPath; else delete out.publishedUrl;
  var c = data.counters || {};
  out.counters = { registrations: +c.registrations || 0, views: +c.views || 0 };
  /* Online payment is not available, so every event registers free — including the ones an earlier
     wizard stored as "paid" without ever being able to collect anything. */
  out.payment = { type: 'free' };
  return out;
}

/* ---------- validation ----------
   Every check returns '' when the value is fine, or a sentence that names the field. Nothing here
   coerces: a number where text belongs is refused, not stored as "12345". */
function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

var LIVE_RUNTIME_PRESENT = fs.existsSync(path.join(__dirname, '..', '..', 'templates', '_shared', 'rv-live.js'));

function checkText(label, v, max, required) {
  if (v == null) return required ? label + ' is required.' : '';
  if (typeof v !== 'string') return label + ' must be text.';
  if (required && !v.trim()) return label + ' is required.';
  if (v.length > max) return label + ' is too long (the limit is ' + max + ' characters).';
  return '';
}
/* An address of something on the web or on this site. Never the picture itself: an image pasted in as a
   data: URL is exactly what used to be written into the Firestore document, where anything over about
   0.75 MB failed with a raw database error. Images go through POST /api/event/upload and arrive here as
   the URL that returned. */
var INLINE_IMAGE_MAX_CHARS = 700000;   // ~520 KB of image as base64; a Firestore document holds 1 MiB
function checkUrl(label, v, max) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string') return label + ' must be a web address.';
  /* Until the console and the wizard upload every picture first, they still send small ones inline, and
     refusing those would stop a speaker photo, a sponsor logo or a gallery picture being saved at all.
     An inline image is therefore still accepted while it is small enough to fit a Firestore document
     beside the record's other fields; anything larger gets the instruction that actually helps. */
  if (/^\s*data:/i.test(v)) {
    if (/^\s*data:image\/(png|jpe?g|webp|gif);base64,/i.test(v) && v.length <= INLINE_IMAGE_MAX_CHARS) return '';
    return label + ' is too large to be saved with the record — use a smaller picture (under about 500 KB).';
  }
  if (v.length > (max || 2000)) return label + ' is too long.';
  /* http(s), a path on this host ("/assets/…") or a bare "company.com/page" — the console stores web
     addresses without their scheme. Any other scheme (javascript:, ftp:, mailto:) is not a web address;
     "host:8080/…" is a port, not a scheme. */
  var t = v.trim();
  if (/\s/.test(t)) return label + ' is not a valid web address.';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\/[^\/]/i.test(t) && !/^[a-z0-9.-]+:\d+(\/|$)/i.test(t)) return label + ' is not a valid web address.';
  return '';
}
function checkHttpUrl(label, v, max) {
  var e = checkUrl(label, v, max);
  if (e || v == null || v === '') return e;
  return /^https?:\/\/[^\s]+$/i.test(v.trim()) ? '' : label + ' must start with http:// or https://.';
}
function checkNumber(label, v, min, max) {
  if (v == null) return '';
  if (typeof v !== 'number' || !isFinite(v)) return label + ' must be a number.';
  if ((min != null && v < min) || (max != null && v > max)) return label + ' is out of range.';
  return '';
}
function checkDate(label, v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || v.length > 40 || isNaN(Date.parse(v))) return label + ' must be a date.';
  return '';
}

/* ---------- generic per-event subcollection CRUD ----------
   The console's Content tabs (speakers/speaker-groups/sessions/agenda-groups/partners/partner-tiers/
   gallery/faqs/contacts) and the Promotions pages' own records (leads, promo-templates, promo-audiences)
   are structurally identical: a flat list of records under events/{eventId}/<name>, each with a
   server-assigned id, created/updated by an admin, read back as a plain array. This factory builds
   list/create/update/remove from the collection name and its field table — every resource below is one
   entry registering its own shape, not its own copy of this logic.

   `spec.fields` is both the allow-list (only named fields are ever read off the request body, so a client
   cannot smuggle `createdBy` into a write) and the type of each one:
     'text' short text (300)   'long' long text (5000)   'long20k' a message body (20,000)
     'text:<n>'  short text of at most n characters
     'url'    an address — http(s), a path on this host, or a bare "company.com/…"; never a data: URL
     'email'  '' or an e-mail address          'phone'  '' or digits with + ( ) . - and spaces
     'colour' '' or #rgb / #rrggbb             'status' '' or one of CONTENT_STATUSES
     'enum:a|b|c'  one of the listed values ('' only when it is listed: 'enum:|hot|cold')
     'bool'   true or false                    'num'    a finite number
     'rank'   a short label or a number (the console's "weight")
     'ymd'    '' or YYYY-MM-DD                 'iso'    a date-time, or null
     'tags'   up to 20 short labels            'keys'   up to 5,000 "r:<id>" / "l:<id>" person keys
     'ref'    the id of another record, or null             'refs' a list of such ids
     a function (label, value) -> '' or the problem, for a field with a shape of its own
   `spec.required` names what a record cannot exist without; `spec.anyOf` is "at least one of these".
   A blank record (timestamps only) used to be accepted and then showed up as an empty card on the site.
   `spec.fixed` names fields that are set when the record is created and cannot be changed afterwards;
   `spec.defaults` fills fields a create left out; `spec.derive(data)` adds what the server works out
   itself from what was sent; `spec.onRemove(fb, eventId, id, ref)` replaces the plain delete when other
   records point at this one, and resolves what to add to the answer. */
var FIELD_LIMITS = { text: 300, long: 5000, long20k: 20000 };
var PERSON_KEY = /^[rl]:[A-Za-z0-9_-]{1,120}$/;

function checkRecordField(label, type, v) {
  if (typeof type === 'function') return type(label, v);
  if (type === 'text' || type === 'long' || type === 'long20k') return checkText(label, v, FIELD_LIMITS[type], false);
  if (type.indexOf('text:') === 0) return checkText(label, v, +type.slice(5), false);
  if (type === 'url') return checkUrl(label, v);
  if (type === 'num') return checkNumber(label, v, -1e9, 1e9);
  if (type === 'bool') return (v == null || typeof v === 'boolean') ? '' : label + ' must be true or false.';
  if (type === 'rank') {
    if (v == null || (typeof v === 'number' && isFinite(v))) return '';
    return typeof v === 'string' && v.length <= 40 ? '' : label + ' is not valid.';
  }
  if (type === 'email') {
    if (v == null || v === '') return '';
    return typeof v === 'string' && isEmail(v.trim()) ? '' : label + ' is not a valid email address.';
  }
  if (type === 'phone') {
    if (v == null || v === '') return '';
    return typeof v === 'string' && v.length <= 40 && /^[\d\s+().-]+$/.test(v) ? '' : label + ' is not a valid phone number.';
  }
  if (type === 'colour') {
    if (v == null || v === '') return '';
    return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? '' : label + ' must be a colour like #1a2b3c.';
  }
  if (type === 'status') {
    if (v == null || v === '') return '';
    return CONTENT_STATUSES.indexOf(v) !== -1 ? '' : label + ' must be one of: ' + CONTENT_STATUSES.join(', ') + '.';
  }
  if (type.indexOf('enum:') === 0) {
    var allowed = type.slice(5).split('|');
    if (v == null) return '';
    return typeof v === 'string' && allowed.indexOf(v) !== -1 ? '' : label + ' must be one of: ' + allowed.filter(Boolean).join(', ') + '.';
  }
  if (type === 'ymd') {
    if (v == null || v === '') return '';
    return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) ? '' : label + ' must be a date like 2026-11-30.';
  }
  if (type === 'iso') {
    if (v == null) return '';
    return typeof v === 'string' && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(v) && !isNaN(Date.parse(v)) ? '' : label + ' must be a date and time.';
  }
  if (type === 'tags') {
    if (v == null) return '';
    if (!Array.isArray(v) || v.length > 20) return label + ' must be a list of at most 20 labels.';
    return v.every(function (x) { return typeof x === 'string' && x.trim() && x.length <= 40; }) ? '' : label + ' has a label that is empty or longer than 40 characters.';
  }
  if (type === 'keys') {
    if (v == null) return '';
    if (!Array.isArray(v) || v.length > 5000) return label + ' must be a list of at most 5,000 people.';
    return v.every(function (x) { return typeof x === 'string' && PERSON_KEY.test(x); }) ? '' : label + ' has an entry that is not a person.';
  }
  if (type === 'ref') return (v == null || v === '' || isRecordId(v)) ? '' : label + ' is not a valid id.';
  if (type === 'refs') {
    if (v == null) return '';
    if (!Array.isArray(v) || v.length > 200 || !v.every(isRecordId)) return label + ' must be a list of ids.';
    return '';
  }
  return label + ' is not accepted.';
}

/* The order every list of records is returned in: by `order` (records that have a number first, lowest
   first), then oldest first, then by id so that two records made in the same millisecond never swap. */
function byRecordOrder(a, b) {
  var an = typeof a.order === 'number' && isFinite(a.order), bn = typeof b.order === 'number' && isFinite(b.order);
  if (an !== bn) return an ? -1 : 1;
  if (an && a.order !== b.order) return a.order - b.order;
  var ac = String(a.createdAt || ''), bc = String(b.createdAt || '');
  if (ac !== bc) return ac < bc ? -1 : 1;
  return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
}

/* "3:42 pm on 12 Oct" in India time, for a sentence about when somebody else saved. */
function whenInIndia(iso) {
  var t = Date.parse(iso);
  if (isNaN(t)) return '';
  var d = new Date(t + 330 * 60000), h = d.getUTCHours(), m = d.getUTCMinutes();
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' am' : ' pm') + ' on ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()];
}

/* 409 for a save made on top of a version that somebody has since replaced. The caller passed the
   `updatedAt` it last saw as `ifUpdatedAt`; without it a save is not checked (older pages). */
function staleError(what, stored) {
  var when = whenInIndia(stored.updatedAt);
  return httpError(409, 'This ' + what + ' was changed by ' + (stored.updatedBy || 'someone else') + (when ? ' at ' + when : '') +
    '. Reload to see the latest version.', { code: 'stale', current: { updatedAt: stored.updatedAt || null, updatedBy: stored.updatedBy || null } });
}
function checkIfUpdatedAt(body) {
  return (body.ifUpdatedAt == null || (typeof body.ifUpdatedAt === 'string' && body.ifUpdatedAt.length <= 40)) ? '' : '"ifUpdatedAt" must be the updatedAt value you last received.';
}
function sameValue(a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); }

/* the fields of a record that say when and by whom, not what: left out of a history line */
var RECORD_META = ['createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'order', 'eventId', 'id'];
/* what a person would call the record: its name, title, question … */
function recordTitle(d) {
  var v = d && (d.name || d.title || d.question || d.label || d.company || d.email || d.heading);
  return String(v || 'untitled').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function subcollectionRoutes(name, spec) {
  var fields = spec.fields, label = spec.label;
  /* the activity log's area for this kind of record */
  var logArea = name === 'leads' ? 'registrations' : /^promo/.test(name) ? 'promotions' : 'content';
  var required = spec.required || [], anyOf = spec.anyOf || null, fixed = spec.fixed || [];

  /* -> { data } or { error, field }. On create every required field must be present; on update a
     required field may be left out (it keeps its value) but may not be blanked.
     `stored` is the record as it is now (update only). A value that is sent back exactly as it is stored
     is not judged again: the console sends the whole record on every save, and a phone number or status
     written before a rule existed must not stop its owner from fixing a typo in the name. */
  function sanitize(body, creating, stored) {
    var out = {}, names = Object.keys(fields);
    for (var i = 0; i < names.length; i++) {
      var f = names[i];
      if (!has(body, f)) continue;
      var unchanged = !!stored && has(stored, f) && sameValue(stored[f], body[f]);
      if (!unchanged) {
        if (!creating && fixed.indexOf(f) !== -1) return { error: 'The "' + f + '" of a ' + label + ' cannot be changed after it is created.', field: f };
        var problem = checkRecordField('"' + f + '"', fields[f], body[f]);
        if (problem) return { error: problem, field: f };
      }
      out[f] = body[f];
    }
    function blank(f) { return out[f] == null || (typeof out[f] === 'string' && !out[f].trim()); }
    for (var r = 0; r < required.length; r++) {
      if (creating ? blank(required[r]) : (has(out, required[r]) && blank(required[r]))) {
        return { error: 'A ' + label + ' needs a "' + required[r] + '".', field: required[r] };
      }
    }
    if (anyOf && creating && anyOf.every(blank)) {
      return { error: 'A ' + label + ' needs at least one of: ' + anyOf.join(', ') + '.', field: anyOf[0] };
    }
    if (creating && spec.defaults) Object.keys(spec.defaults).forEach(function (k) { if (out[k] == null) out[k] = spec.defaults[k]; });
    if (spec.derive) spec.derive(out);
    return { data: out };
  }
  function col(fb, eventId) { return eventDocRef(fb, eventId).collection(name); }
  function gone() { return httpError(404, 'That ' + label + ' no longer exists — it may have been deleted.', { code: 'record-not-found' }); }

  function list(req, res) {
    withAdmin(req, res, function (fb) {
      var eventId = eventIdOr400(res, queryOf(req).get('eventId'));
      if (!eventId) return;
      /* The event itself is read alongside, only to keep a deleted event's content out of sight. An id
         with no event yet still answers an empty list, as it always has: the editor asks for a new
         site's records before there are any. */
      Promise.all([eventDocRef(fb, eventId).get(), col(fb, eventId).get()]).then(function (r) {
        if (eventStateOf(r[0]) === 'deleted') throw notLiveError('deleted', eventId);
        var items = r[1].docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        items.sort(byRecordOrder);
        sendJson(res, 200, { items: items });
      }).catch(function (err) { sendFailure(res, name + ' list', err, 'Could not load the ' + label + ' list. Please try again.'); });
    });
  }

  /* Create, update and delete all refuse to act under an event that is not live, and update / delete
     refuse an id that is not there. set(..., {merge:true}) and delete() used to succeed on anything:
     a PATCH for a speaker deleted in another tab quietly brought back a half-empty ghost of it, and a
     write under a mistyped event id created content (and a parent document) for an event nobody had. */
  function create(req, res) {
    withAdminBody(req, res, spec.maxBody || BODY_LIMITS.record, function (fb, decoded, body) {
      var eventId = eventIdOr400(res, body.eventId);
      if (!eventId) return;
      var clean = sanitize(body, true, null);
      if (clean.error) return sendJson(res, 400, { error: clean.error, field: clean.field });
      var data = clean.data, now = new Date().toISOString();
      data.createdAt = now; data.updatedAt = now; data.createdBy = actorOf(decoded); data.updatedBy = data.createdBy;
      loadLiveEvent(fb, eventId)
        .then(function () { return col(fb, eventId).add(data); })
        .then(function (ref) {
          sendJson(res, 200, { id: ref.id, createdAt: now, updatedAt: now });
          logActivity(fb, eventId, decoded, 'content-added', label + ' “' + maskEmail(recordTitle(data)) + '”', { area: logArea, fields: fieldChanges(null, data, RECORD_META) });
        })
        .catch(function (err) { sendFailure(res, name + ' create', err, 'Could not save the ' + label + '. Please try again.'); });
    });
  }
  /* Each field sent replaces the stored one as a whole. The read of the record, the checks and the write
     are one transaction, so of two people saving the same record at the same moment the second is judged
     against what the first one stored — and, when it sent `ifUpdatedAt`, told so (409) instead of
     overwriting it. */
  function update(req, res) {
    withAdminBody(req, res, spec.maxBody || BODY_LIMITS.record, function (fb, decoded, body) {
      var eventId = eventIdOr400(res, body.eventId);
      if (!eventId) return;
      if (!isRecordId(body.id)) return sendJson(res, 400, { error: 'A valid id is required.' });
      var bad = checkIfUpdatedAt(body);
      if (bad) return sendJson(res, 400, { error: bad, field: 'ifUpdatedAt' });
      var ref = col(fb, eventId).doc(body.id), now = new Date().toISOString(), diff = [], title = '';
      /* the event is read outside the transaction: every registration writes to that document, and a
         content save must not queue behind them */
      loadLiveEvent(fb, eventId).then(function () {
        return fb.db.runTransaction(function (tx) {
          return tx.get(ref).then(function (snap) {
            if (!snap.exists) throw gone();
            var stored = snap.data() || {};
            if (body.ifUpdatedAt != null && body.ifUpdatedAt !== stored.updatedAt) throw staleError(label, stored);
            var clean = sanitize(body, false, stored);
            if (clean.error) throw httpError(400, clean.error, { field: clean.field });
            var data = clean.data;
            diff = fieldChanges(stored, data, RECORD_META);
            title = recordTitle(Object.assign({}, stored, data));
            data.updatedAt = now; data.updatedBy = actorOf(decoded);
            tx.update(ref, data);
          });
        });
      }).then(function () {
        sendJson(res, 200, { ok: true, updatedAt: now });
        if (diff.length) logActivity(fb, eventId, decoded, 'content-changed', label + ' “' + maskEmail(title) + '” — ' + diff.map(function (f) { return f.field; }).join(', '), { area: logArea, fields: diff });
      })
        .catch(function (err) { sendFailure(res, name + ' update', err, 'Could not save the ' + label + '. Please try again.'); });
    });
  }
  function remove(req, res) {
    withAdmin(req, res, function (fb, decoded) {
      var qs = queryOf(req);
      var eventId = eventIdOr400(res, qs.get('eventId'));
      if (!eventId) return;
      var id = qs.get('id');
      if (!isRecordId(id)) return sendJson(res, 400, { error: 'A valid id is required.' });
      var ref = col(fb, eventId).doc(id), was = null;
      Promise.all([loadLiveEvent(fb, eventId), ref.get()]).then(function (r) {
        if (!r[1].exists) throw httpError(404, 'That ' + label + ' no longer exists — it may already have been deleted.', { code: 'record-not-found' });
        was = r[1].data() || {};
        return spec.onRemove ? spec.onRemove(fb, eventId, id, ref) : ref.delete();
      }).then(function (extra) {
        sendJson(res, 200, Object.assign({ ok: true }, spec.onRemove ? extra : null));
        var gone = fieldChanges(null, was, RECORD_META).map(function (f) { return { field: f.field, before: f.after, after: '(deleted)' }; });
        logActivity(fb, eventId, decoded, 'content-removed', label + ' “' + maskEmail(recordTitle(was)) + '”', { area: logArea, fields: gone });
      })
        .catch(function (err) { sendFailure(res, name + ' delete', err, 'Could not delete the ' + label + '. Please try again.'); });
    });
  }
  return { list: list, create: create, update: update, remove: remove, sanitize: sanitize, col: col, label: label };
}

/* Deleting a speaker also takes them off every session that lists them, in the same write: the console
   can only tidy the sessions it happens to have loaded, and a session must never name a speaker who is
   no longer there. -> { sessionsUpdated } */
function removeSpeaker(fb, eventId, id, ref) {
  var FieldValue = require('firebase-admin').firestore.FieldValue;
  return eventDocRef(fb, eventId).collection('sessions').where('speakerIds', 'array-contains', id).get().then(function (snap) {
    var docs = snap.docs, batches = [];
    for (var i = 0; i === 0 || i < docs.length; i += 400) {
      var batch = fb.db.batch();
      if (i === 0) batch.delete(ref);
      docs.slice(i, i + 400).forEach(function (d) { batch.update(d.ref, { speakerIds: FieldValue.arrayRemove(id) }); });
      batches.push(batch);
    }
    return batches.reduce(function (chain, b) { return chain.then(function () { return b.commit(); }); }, Promise.resolve())
      .then(function () { return { sessionsUpdated: docs.length }; });
  });
}

// Field shapes taken directly from edit-event.html's own in-memory objects (S.speakers[] / S.sessions[] /
// S.partners[] etc.); the Firestore collection name is the first argument, the URL segment is the key.
var RESOURCES = {
  'speakers': subcollectionRoutes('speakers', { label: 'speaker', required: ['name'], onRemove: removeSpeaker, fields: {
    name: 'text', desig: 'text', comp: 'text', photoUrl: 'url', logoUrl: 'url', colour: 'colour', weight: 'rank',
    status: 'status', email: 'email', phone: 'phone', li: 'url', bio: 'long', groupId: 'ref', order: 'num' } }),
  'speaker-groups': subcollectionRoutes('speakerGroups', { label: 'speaker group', required: ['name'], fields: { name: 'text', order: 'num' } }),
  'sessions': subcollectionRoutes('sessions', { label: 'session', required: ['title'], fields: {
    title: 'text', start: 'text', end: 'text', kind: 'text', speakerIds: 'refs', desc: 'long', room: 'text',
    weight: 'rank', groupId: 'ref', order: 'num' } }),
  'agenda-groups': subcollectionRoutes('agendaGroups', { label: 'agenda day', required: ['name'], fields: { name: 'text', date: 'text', order: 'num' } }),
  'partners': subcollectionRoutes('partners', { label: 'partner', required: ['name'], fields: {
    name: 'text', url: 'url', logoUrl: 'url', weight: 'rank', status: 'status', email: 'email', phone: 'phone',
    contact: 'text', note: 'long', tierId: 'ref', order: 'num' } }),
  'partner-tiers': subcollectionRoutes('partnerTiers', { label: 'partner tier', required: ['name'], fields: { name: 'text', weight: 'rank', order: 'num' } }),
  'gallery': subcollectionRoutes('gallery', { label: 'gallery image', required: ['imageUrl'], fields: { imageUrl: 'url', caption: 'text', order: 'num' } }),
  'faqs': subcollectionRoutes('faqs', { label: 'FAQ', required: ['question'], fields: { question: 'text', answer: 'long', order: 'num' } }),
  'contacts': subcollectionRoutes('contacts', { label: 'contact', anyOf: ['label', 'name'], fields: {
    label: 'text', name: 'text', email: 'email', phone: 'phone', order: 'num' } })
};

/* ---------- Promotions: message / post / banner templates, saved audiences, leads ----------
   The Promotions pages' own records. Templates and audiences are ordinary resources; leads are too,
   with four additions further down: paging (an event can hold tens of thousands), one lead per person,
   notes that two people can add to at once, and bulk import / change / delete. */
function checkUtmCampaign(label, v) {
  if (v == null || v === '') return '';
  return typeof v === 'string' && v.length <= 60 && /^[a-z0-9_-]*$/.test(v) ? '' : label + ' can use lowercase letters, numbers, hyphens and underscores only (up to 60).';
}
var AUDIENCE_LISTS = ['regStatus', 'stage', 'level', 'owner', 'src', 'company', 'city', 'desig', 'seniority', 'industry', 'tags'];
var AUDIENCE_CHOICES = ['registered', 'optOut'];
function checkAudienceFilters(label, v) {
  if (v == null) return '';
  if (!isPlainObject(v)) return label + ' must be an object.';
  var keys = Object.keys(v);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], x = v[k];
    if (k === 'q') { if (typeof x !== 'string' || x.length > 120) return label + ': the search text must be at most 120 characters.'; continue; }
    if (AUDIENCE_CHOICES.indexOf(k) !== -1) { if (['any', 'yes', 'no'].indexOf(x) === -1) return label + ': "' + k + '" must be any, yes or no.'; continue; }
    if (AUDIENCE_LISTS.indexOf(k) !== -1) {
      if (!Array.isArray(x) || x.length > 50 || !x.every(function (s) { return typeof s === 'string' && s.length <= 120; })) return label + ': "' + k + '" must be a list of at most 50 values.';
      continue;
    }
    return label + ': "' + k + '" is not a filter.';
  }
  return '';
}

/* `body` of a post or a mailer is its whole configuration as JSON (promo-kit.js): every text the owner
   edited, section by section, so a mailer can pass 20,000 characters. 60,000 stays far inside a record. */
function checkPromoBody(label, v) { return checkText(label, v, 60000, false); }
RESOURCES['promo-templates'] = subcollectionRoutes('promoTemplates', { label: 'promotion template', required: ['kind', 'name'], fixed: ['kind'],
  defaults: { status: 'draft' }, fields: {
    kind: 'enum:email|whatsapp|post|banner', name: 'text:120', subject: 'text:200', body: checkPromoBody, network: 'enum:|linkedin|x|facebook',
    imageUrl: 'url', size: 'text:40', placement: 'text:200', linkUrl: 'url', utmCampaign: checkUtmCampaign,
    status: 'enum:draft|posted', postedAt: 'iso', order: 'num' } });
RESOURCES['promo-audiences'] = subcollectionRoutes('promoAudiences', { label: 'saved audience', required: ['name'], maxBody: MB, fields: {
  name: 'text:120', note: 'text:500', filters: checkAudienceFilters, personKeys: 'keys', order: 'num' } });

/* LEADS. What a client may send is the field table; `emailLower`, `dupKey`, `calls` and `notes` are the
   server's (a client's value for them is never read).

   One lead per person. A lead's key is its e-mail address in lower case, or — with no e-mail — its name
   and company in lower case. A new lead is stored under an id made from that key, so the same person
   imported twice, by two people at the same moment, is still one document; a single create answers
   409 { code: 'duplicate', existingId }.

   Notes belong to whoever wrote them, when they wrote them: a client sends appendNote { kind, text }
   (or removeNoteAt) and the server adds { at, by, kind, text } inside a transaction, so two notes added
   at once are both kept. `calls` is the number of notes of kind "call". */
var LEAD_STAGES = 'new|contacted|interested|registered|won|lost';
var LEAD_BULK_FIELDS = ['stage', 'level', 'owner', 'optOut', 'tags'];
var LEAD_KEEP_ON_IMPORT = ['stage', 'level', 'owner', 'optOut'];       // an import never overrides somebody's work on a lead
var MAX_LEAD_NOTES = 200, MAX_BULK_LEADS = 500;
function leadKeyOf(d) {
  var email = typeof d.email === 'string' ? d.email.trim().toLowerCase() : '';
  if (email) return email;
  return String(d.name || '').trim().toLowerCase() + '|' + String(d.comp || '').trim().toLowerCase();
}
function leadIdOf(key) { return 'ld-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32); }
var LEADS = subcollectionRoutes('leads', { label: 'lead', required: ['name'],
  defaults: { stage: 'new', level: '', origin: 'manual', optOut: false },
  fields: {
    name: 'text:120', email: 'email', phone: 'phone', comp: 'text:120', desig: 'text:120', city: 'text:120', industry: 'text:120',
    seniority: 'text:120', src: 'text:120', tags: 'tags', stage: 'enum:' + LEAD_STAGES, level: 'enum:|hot|warm|cold', owner: 'text:200',
    next: 'ymd', optOut: 'bool', registrationId: 'ref', origin: 'enum:manual|import|registration', importId: 'text:60' } });
function leadForClient(id, d) {
  var out = Object.assign({ id: id }, d);
  delete out.dupKey;
  if (!Array.isArray(out.notes)) out.notes = [];
  out.calls = +out.calls || 0;
  return out;
}
function duplicateLead(existingId) {
  return httpError(409, 'This person is already in your leads.', { code: 'duplicate', existingId: existingId });
}
function trimLead(data) {
  ['name', 'email', 'comp'].forEach(function (f) { if (typeof data[f] === 'string') data[f] = data[f].trim(); });
  return data;
}

/* GET /api/event/leads?eventId=&limit=&cursor= -> { items, total, nextCursor }, newest first. limit
   defaults to 1,000 (at most 5,000); pass nextCursor back as cursor until it is null. */
function handleLeadsList(req, res) {
  withAdmin(req, res, function (fb) {
    var qs = queryOf(req), eventId = eventIdOr400(res, qs.get('eventId'));
    if (!eventId) return;
    var limit = Math.max(1, Math.min(5000, parseInt(qs.get('limit'), 10) || 1000)), cursor = qs.get('cursor') || '';
    if (cursor && !isRecordId(cursor)) return sendJson(res, 400, { error: 'That page of leads could not be found. Reload the list.' });
    var col = LEADS.col(fb, eventId);
    Promise.all([loadLiveEvent(fb, eventId), cursor ? col.doc(cursor).get() : null]).then(function (r) {
      if (cursor && !r[1].exists) throw httpError(400, 'That page of leads could not be found. Reload the list.');
      var q = col.orderBy('createdAt', 'desc');
      if (cursor) q = q.startAfter(r[1]);
      return Promise.all([q.limit(limit + 1).get(), col.count().get()]);
    }).then(function (out) {
      var docs = out[0].docs, more = docs.length > limit;
      if (more) docs = docs.slice(0, limit);
      sendJson(res, 200, {
        items: docs.map(function (d) { return leadForClient(d.id, d.data()); }),
        total: out[1].data().count, nextCursor: more ? docs[docs.length - 1].id : null
      });
    }).catch(function (err) { sendFailure(res, 'leads list', err, 'Could not load the leads. Please try again.'); });
  });
}

/* The lead that already has this key, whatever id it is stored under, or null. */
function findLeadByKey(col, key) {
  return col.where('dupKey', '==', key).limit(1).get().then(function (snap) { return snap.empty ? null : snap.docs[0]; });
}

/* a lead's own bookkeeping, never a line in the activity log */
var LEAD_BOOKKEEPING = ['dupKey', 'emailLower', 'calls', 'notes'];
function handleLeadCreate(req, res) {
  withAdminBody(req, res, BODY_LIMITS.record, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var clean = LEADS.sanitize(body, true, null);
    if (clean.error) return sendJson(res, 400, { error: clean.error, field: clean.field });
    var data = trimLead(clean.data), now = new Date().toISOString(), actor = actorOf(decoded), col = LEADS.col(fb, eventId);
    data.dupKey = leadKeyOf(data); data.emailLower = (data.email || '').toLowerCase();
    data.calls = 0; data.notes = [];
    data.createdAt = now; data.updatedAt = now; data.createdBy = actor; data.updatedBy = actor;
    var ref = col.doc(leadIdOf(data.dupKey));
    loadLiveEvent(fb, eventId).then(function () { return findLeadByKey(col, data.dupKey); }).then(function (existing) {
      if (existing) throw duplicateLead(existing.id);
      /* create(), not set(): of two identical requests at the same instant exactly one stores the lead */
      return ref.create(data).catch(function (err) {
        if (!(err && err.code === 6)) throw err;
        return ref.get().then(function (snap) {
          if (snap.exists && snap.get('dupKey') === data.dupKey) throw duplicateLead(ref.id);
          ref = col.doc();                 // that id belongs to a lead whose e-mail has since been changed
          return ref.set(data);
        });
      });
    }).then(function () {
      sendJson(res, 200, { id: ref.id, createdAt: now, updatedAt: now });
      logActivity(fb, eventId, decoded, 'content-added', 'lead “' + maskEmail(recordTitle(data)) + '”',
        { area: 'registrations', fields: fieldChanges(null, data, RECORD_META.concat(LEAD_BOOKKEEPING)) });
    })
      .catch(function (err) { sendFailure(res, 'lead create', err, 'Could not save the lead. Please try again.'); });
  });
}

/* PATCH /api/event/leads { eventId, id, <fields>?, appendNote?: { kind: 'note' | 'call', text },
   removeNoteAt?: '<the note's at>', ifUpdatedAt? } -> { ok, updatedAt, lead, note? } */
function handleLeadUpdate(req, res) {
  withAdminBody(req, res, BODY_LIMITS.record, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    if (!isRecordId(body.id)) return sendJson(res, 400, { error: 'A valid id is required.' });
    var bad = checkIfUpdatedAt(body);
    if (bad) return sendJson(res, 400, { error: bad, field: 'ifUpdatedAt' });
    var add = body.appendNote, note = null;
    if (add != null) {
      if (!isPlainObject(add) || (add.kind !== 'note' && add.kind !== 'call')) return sendJson(res, 400, { error: 'A note needs a kind: note or call.', field: 'appendNote' });
      if (typeof add.text !== 'string' || !add.text.trim()) return sendJson(res, 400, { error: 'Write the note first.', field: 'appendNote' });
      if (add.text.length > 2000) return sendJson(res, 400, { error: 'A note can be at most 2,000 characters.', field: 'appendNote' });
    }
    if (body.removeNoteAt != null && typeof body.removeNoteAt !== 'string') return sendJson(res, 400, { error: '"removeNoteAt" must be the time of the note to remove.', field: 'removeNoteAt' });

    var col = LEADS.col(fb, eventId), ref = col.doc(body.id), now = new Date().toISOString(), actor = actorOf(decoded), result = null, logged = null;
    loadLiveEvent(fb, eventId).then(function () {
      return fb.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          if (!snap.exists) throw httpError(404, 'That lead no longer exists — it may have been deleted.', { code: 'record-not-found' });
          var stored = snap.data() || {};
          if (body.ifUpdatedAt != null && body.ifUpdatedAt !== stored.updatedAt) throw staleError('lead', stored);
          var clean = LEADS.sanitize(body, false, stored);
          if (clean.error) throw httpError(400, clean.error, { field: clean.field });
          var data = trimLead(clean.data);
          if (!Object.keys(data).length && add == null && body.removeNoteAt == null) throw httpError(400, 'Nothing to update.');

          var merged = Object.assign({}, stored, data), key = leadKeyOf(merged);
          var moved = key !== stored.dupKey && (has(data, 'email') || has(data, 'name') || has(data, 'comp'));
          var clash = moved ? tx.get(col.where('dupKey', '==', key).limit(1)) : Promise.resolve(null);
          return clash.then(function (other) {
            if (other && !other.empty && other.docs[0].id !== ref.id) throw duplicateLead(other.docs[0].id);
            if (moved || stored.dupKey == null) { data.dupKey = key; data.emailLower = (merged.email || '').toLowerCase(); }
            var notes = Array.isArray(stored.notes) ? stored.notes.slice() : [];
            if (body.removeNoteAt != null) {
              var at = notes.map(function (n) { return n && n.at; }).indexOf(body.removeNoteAt);
              if (at === -1) throw httpError(404, 'That note is no longer there.', { code: 'note-not-found' });
              notes.splice(at, 1);
            }
            if (add != null) {
              if (notes.length >= MAX_LEAD_NOTES) throw httpError(400, 'This lead already has ' + MAX_LEAD_NOTES + ' notes. Remove an old one first.', { field: 'appendNote' });
              /* `at` identifies the note: two added within the same millisecond must not share it */
              var stamp = now, n = 1;
              while (notes.some(function (x) { return x && x.at === stamp; })) stamp = new Date(Date.parse(now) + n++).toISOString();
              note = { at: stamp, by: actor, kind: add.kind, text: add.text.trim() };
              notes.push(note);
            }
            if (add != null || body.removeNoteAt != null) {
              data.notes = notes;
              data.calls = notes.filter(function (x) { return x && x.kind === 'call'; }).length;
            }
            /* for the activity log: what changed, before and after, and what happened to the notes */
            logged = { title: recordTitle(merged), fields: fieldChanges(stored, data, RECORD_META.concat(LEAD_BOOKKEEPING)),
              notes: add != null ? (add.kind === 'call' ? 'call logged' : 'note added') : body.removeNoteAt != null ? 'note removed' : '' };
            data.updatedAt = now; data.updatedBy = actor;
            tx.update(ref, data);
            result = leadForClient(ref.id, Object.assign({}, stored, data));
          });
        });
      });
    }).then(function () {
      var out = { ok: true, updatedAt: now, lead: result };
      if (note) out.note = note;
      sendJson(res, 200, out);
      var what = logged.fields.map(function (f) { return f.field; }).concat(logged.notes ? [logged.notes] : []);
      if (what.length) logActivity(fb, eventId, decoded, 'content-changed', 'lead “' + maskEmail(logged.title) + '” — ' + what.join(', '), { area: 'registrations', fields: logged.fields });
    }).catch(function (err) { sendFailure(res, 'lead update', err, 'Could not save the lead. Please try again.'); });
  });
}

/* Every lead's key and id — two small fields per lead, read once per bulk request. */
function leadKeys(col) {
  return col.select('dupKey').get().then(function (snap) {
    var byKey = {}, ids = {};
    snap.docs.forEach(function (d) { ids[d.id] = true; var k = d.get('dupKey'); if (typeof k === 'string' && !(k in byKey)) byKey[k] = d.id; });
    return { byKey: byKey, ids: ids };
  });
}
function commitInBatches(fb, writes) {
  var chain = Promise.resolve();
  for (var i = 0; i < writes.length; i += 400) (function (group) {
    chain = chain.then(function () {
      var batch = fb.db.batch();
      group.forEach(function (w) { w(batch); });
      return batch.commit();
    });
  })(writes.slice(i, i + 400));
  return chain;
}
function bulkIds(res, body) {
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > MAX_BULK_LEADS || !body.ids.every(isRecordId)) {
    sendJson(res, 400, { error: 'Send between 1 and ' + MAX_BULK_LEADS + ' lead ids.', field: 'ids' });
    return null;
  }
  return body.ids.filter(function (id, i, a) { return a.indexOf(id) === i; });
}

/* POST /api/event/leads/bulk { eventId, items: [lead fields] (at most 500), importId?, onDuplicate: 'skip' | 'update' }
   -> { created, updated, skipped, ids }. A row whose person is already a lead — stored, or earlier in the
   same request — is skipped, or with onDuplicate "update" fills in what the stored lead has empty and
   changes nothing else (never its stage, level, owner, opt-out or notes). The whole request is checked
   before anything is written: one bad row answers 400 naming the row, and nothing is imported. */
function handleLeadsBulkCreate(req, res) {
  withAdminBody(req, res, MB, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_BULK_LEADS) {
      return sendJson(res, 400, { error: 'Send between 1 and ' + MAX_BULK_LEADS + ' leads at a time.', field: 'items' });
    }
    var mode = body.onDuplicate == null ? 'skip' : body.onDuplicate;
    if (mode !== 'skip' && mode !== 'update') return sendJson(res, 400, { error: '"onDuplicate" must be skip or update.', field: 'onDuplicate' });
    var importId = body.importId == null ? '' : body.importId;
    if (typeof importId !== 'string' || importId.length > 60) return sendJson(res, 400, { error: '"importId" must be text of at most 60 characters.', field: 'importId' });

    var rows = [];
    for (var i = 0; i < body.items.length; i++) {
      var item = body.items[i];
      if (!isPlainObject(item)) return sendJson(res, 400, { error: 'Row ' + (i + 1) + ' is not a lead.', row: i + 1 });
      var clean = LEADS.sanitize(Object.assign({ origin: 'import' }, item), true, null);
      if (clean.error) return sendJson(res, 400, { error: 'Row ' + (i + 1) + ': ' + clean.error, field: clean.field, row: i + 1 });
      rows.push(trimLead(clean.data));
    }

    var col = LEADS.col(fb, eventId), now = new Date().toISOString(), actor = actorOf(decoded);
    var out = { created: 0, updated: 0, skipped: 0, ids: [] };
    loadLiveEvent(fb, eventId).then(function () { return leadKeys(col); }).then(function (known) {
      var writes = [], seen = {}, fill = [];
      rows.forEach(function (data) {
        var key = leadKeyOf(data);
        if (seen[key]) { out.skipped++; return; }
        seen[key] = true;
        if (known.byKey[key]) {
          if (mode === 'update') fill.push({ id: known.byKey[key], data: data }); else out.skipped++;
          return;
        }
        var id = leadIdOf(key);
        var ref = known.ids[id] ? col.doc() : col.doc(id);
        data.dupKey = key; data.emailLower = (data.email || '').toLowerCase();
        if (importId) data.importId = importId;
        data.calls = 0; data.notes = [];
        data.createdAt = now; data.updatedAt = now; data.createdBy = actor; data.updatedBy = actor;
        writes.push(function (batch) { batch.set(ref, data); });
        out.created++; out.ids.push(ref.id);
      });
      if (!fill.length) return commitInBatches(fb, writes);
      return fb.db.getAll.apply(fb.db, fill.map(function (f) { return col.doc(f.id); })).then(function (snaps) {
        snaps.forEach(function (snap, n) {
          var stored = snap.exists ? (snap.data() || {}) : null, patch = {};
          if (stored) Object.keys(fill[n].data).forEach(function (f) {
            if (LEAD_KEEP_ON_IMPORT.indexOf(f) !== -1 || f === 'origin') return;
            var have = stored[f], blank = have == null || have === '' || (Array.isArray(have) && !have.length);
            var got = fill[n].data[f];
            if (blank && got != null && got !== '' && !(Array.isArray(got) && !got.length)) patch[f] = got;
          });
          if (!stored || !Object.keys(patch).length) { out.skipped++; return; }
          patch.updatedAt = now; patch.updatedBy = actor;
          writes.push(function (batch) { batch.update(snap.ref, patch); });
          out.updated++;
        });
        return commitInBatches(fb, writes);
      });
    }).then(function () {
      sendJson(res, 200, out);
      if (out.created || out.updated) logActivity(fb, eventId, decoded, 'leads-imported', out.created + ' added' + (out.updated ? ', ' + out.updated + ' updated' : '') + (out.skipped ? ', ' + out.skipped + ' already there' : ''));
    }).catch(function (err) { sendFailure(res, 'leads import', err, 'The leads could not be imported. Please try again.'); });
  });
}

/* PATCH /api/event/leads/bulk { eventId, ids (at most 500), patch: { stage?, level?, owner?, optOut?, tags? } }
   -> { updated, missing: [ids that are no longer there] } */
function handleLeadsBulkUpdate(req, res) {
  withAdminBody(req, res, BODY_LIMITS.record, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var ids = bulkIds(res, body);
    if (!ids) return;
    if (!isPlainObject(body.patch)) return sendJson(res, 400, { error: 'Say what to change.', field: 'patch' });
    var extra = Object.keys(body.patch).filter(function (k) { return LEAD_BULK_FIELDS.indexOf(k) === -1; })[0];
    if (extra) return sendJson(res, 400, { error: '"' + extra + '" cannot be changed for several leads at once — only ' + LEAD_BULK_FIELDS.join(', ') + '.', field: extra });
    var clean = LEADS.sanitize(body.patch, false, null);
    if (clean.error) return sendJson(res, 400, { error: clean.error, field: clean.field });
    if (!Object.keys(clean.data).length) return sendJson(res, 400, { error: 'Nothing to update.' });
    var col = LEADS.col(fb, eventId), now = new Date().toISOString();
    var patch = Object.assign({}, clean.data, { updatedAt: now, updatedBy: actorOf(decoded) }), missing = [], updated = 0;
    loadLiveEvent(fb, eventId).then(function () {
      return fb.db.getAll.apply(fb.db, ids.map(function (id) { return col.doc(id); }));
    }).then(function (snaps) {
      var writes = [];
      snaps.forEach(function (snap) {
        if (!snap.exists) { missing.push(snap.id); return; }
        writes.push(function (batch) { batch.update(snap.ref, patch); });
        updated++;
      });
      return commitInBatches(fb, writes);
    }).then(function () {
      sendJson(res, 200, { updated: updated, missing: missing, updatedAt: now });
      if (updated) logActivity(fb, eventId, decoded, 'leads-updated', updated + (updated === 1 ? ' lead' : ' leads') + ' — ' + Object.keys(clean.data).map(function (k) { return k + ' set to ' + historyValue(clean.data[k]); }).join(', '),
        { area: 'registrations', fields: fieldChanges(null, clean.data, RECORD_META) });
    })
      .catch(function (err) { sendFailure(res, 'leads bulk update', err, 'The leads could not be updated. Please try again.'); });
  });
}

/* DELETE /api/event/leads/bulk { eventId, ids (at most 500) } -> { deleted } */
function handleLeadsBulkDelete(req, res) {
  withAdminBody(req, res, BODY_LIMITS.record, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var ids = bulkIds(res, body);
    if (!ids) return;
    var col = LEADS.col(fb, eventId), deleted = 0;
    loadLiveEvent(fb, eventId).then(function () {
      return fb.db.getAll.apply(fb.db, ids.map(function (id) { return col.doc(id); }));
    }).then(function (snaps) {
      var writes = [];
      snaps.forEach(function (snap) {
        if (!snap.exists) return;
        writes.push(function (batch) { batch.delete(snap.ref); });
        deleted++;
      });
      return commitInBatches(fb, writes);
    }).then(function () {
      sendJson(res, 200, { deleted: deleted });
      if (deleted) logActivity(fb, eventId, decoded, 'leads-deleted', deleted + (deleted === 1 ? ' lead' : ' leads'));
    }).catch(function (err) { sendFailure(res, 'leads bulk delete', err, 'The leads could not be deleted. Please try again.'); });
  });
}

RESOURCES['leads'] = { list: handleLeadsList, create: handleLeadCreate, update: handleLeadUpdate, remove: LEADS.remove };

/* ---------- canonical Event: POST/GET/PATCH /api/event ---------- */

// Deliberately NOT 'theme': that field name is owned by the GENERATED TEMPLATES pipeline
// (handlePlanStructure writes {themeColor, headingFont, bodyFont, heroImageUrl, ...} there).
//
// Deliberately NOT 'published' either. It used to be plain data that any PATCH could flip, so an event
// could say "published" with no page behind it, or "unpublished" while its page was still up. It now
// changes in exactly two places: POST /api/event/publish and POST /api/event/unpublish.
var EVENT_STATUSES = ['draft', 'upcoming', 'active', 'live', 'completed', 'cancelled'];
var SOCIAL_KINDS = ['linkedin', 'x', 'facebook', 'instagram', 'youtube', 'website'];
var DATE_MODES = ['exact', 'month', 'quarter', 'tbd', 'none'];

/* Free-form JSON a client sends to be stored as it is (the checklist, an audience's filters) must still
   be something Firestore accepts: no empty or "__reserved__" field name, and not nested without end.
   Otherwise the write fails as a database error instead of a 400 that says what is wrong. */
function storableJson(v, depth) {
  if (v == null || typeof v !== 'object') return true;
  if ((depth || 0) > 12) return false;
  if (Array.isArray(v)) return v.every(function (x) { return !Array.isArray(x) && storableJson(x, (depth || 0) + 1); });
  return Object.keys(v).every(function (k) { return k !== '' && !/^__.*__$/.test(k) && storableJson(v[k], (depth || 0) + 1); });
}

var EVENT_FIELD_CHECKS = {
  name: function (v) { return checkText('The event name', v, 200, true); },
  category: function (v) { return checkText('"category"', v, 60, false); },
  status: function (v) { return (v == null || EVENT_STATUSES.indexOf(v) !== -1) ? '' : '"status" must be one of: ' + EVENT_STATUSES.join(', ') + '.'; },
  start: function (v) { return checkDate('The start date', v); },
  end: function (v) { return checkDate('The end date', v); },
  venue: function (v) { return checkText('The venue', v, 300, false); },
  city: function (v) { return checkText('The city', v, 120, false); },
  description: function (v) { return checkText('The description', v, 20000, false); },
  dateLabel: function (v) { return checkText('"dateLabel"', v, 120, false); },
  /* An event whose date is not fixed yet: which kind of date it has, and the parts that were picked. The
     wording a visitor sees is `dateLabel`; `start` / `end` stay null until the date is exact. */
  dateMode: function (v) { return (v == null || DATE_MODES.indexOf(v) !== -1) ? '' : '"dateMode" must be one of: ' + DATE_MODES.join(', ') + '.'; },
  datePartial: function (v) {
    if (v == null) return '';
    if (!isPlainObject(v)) return '"datePartial" must be an object.';
    var extra = Object.keys(v).filter(function (k) { return ['month', 'quarter', 'year', 'note'].indexOf(k) === -1; })[0];
    if (extra) return '"datePartial.' + extra + '" is not accepted — it takes month, quarter, year and note.';
    if (v.month != null && v.month !== '' && !(typeof v.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v.month))) return 'The month must look like 2026-11.';
    if (v.quarter != null && v.quarter !== '' && ['Q1', 'Q2', 'Q3', 'Q4'].indexOf(v.quarter) === -1) return 'The quarter must be Q1, Q2, Q3 or Q4.';
    if (v.year != null && v.year !== '' && !/^\d{4}$/.test(String(v.year))) return 'The year must have four digits.';
    return checkText('The date note', v.note, 120, false);
  },
  client: function (v) { return checkText('The client name', v, 200, false); },
  nomination: function (v) {
    if (v == null) return '';
    if (!isPlainObject(v)) return '"nomination" must be an object.';
    var dates = ['open', 'close', 'shortlist'], flags = ['openTbd', 'closeTbd', 'shortlistTbd'];
    var extra = Object.keys(v).filter(function (k) { return dates.indexOf(k) === -1 && flags.indexOf(k) === -1; })[0];
    if (extra) return '"nomination.' + extra + '" is not accepted — it takes ' + dates.concat(flags).join(', ') + '.';
    for (var i = 0; i < dates.length; i++) {
      var e = checkDate('The nomination ' + dates[i] + ' date', v[dates[i]]);
      if (e) return e;
      if (v[flags[i]] != null && typeof v[flags[i]] !== 'boolean') return '"nomination.' + flags[i] + '" must be true or false.';
    }
    return '';
  },
  logoUrl: function (v) { return checkUrl('The logo', v); },
  bannerUrl: function (v) { return checkUrl('The banner', v); },
  templateId: function (v) { return (v == null || v === '' || (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,160}$/.test(v))) ? '' : '"templateId" is not valid.'; },
  /* Accepted so that a page which still sends it is not refused, and never looked at: whatever arrives,
     { type: 'free' } is what is stored (cleanEventBody) — no amount, no currency. */
  payment: function (v) { return (v == null || isPlainObject(v)) ? '' : '"payment" must be an object.'; },
  checklist: function (v) {
    if (v == null) return '';
    if (!isPlainObject(v) || Object.keys(v).length > 200) return '"checklist" must be an object.';
    if (!storableJson(v)) return '"checklist" has a name that cannot be stored.';
    return Object.keys(v).every(function (k) { return v[k] == null || typeof v[k] === 'boolean' || typeof v[k] === 'string' || typeof v[k] === 'number'; }) ? '' : '"checklist" has a value that is not valid.';
  }
};
var EVENT_FIELDS = Object.keys(EVENT_FIELD_CHECKS);

/* event.settings (contract section 9). The whole shape is checked and anything not in it is refused by
   name, so a typo in a client ("registraton") fails loudly instead of being stored and ignored. Returns
   { value } — only the keys that were sent, ready to be merged over what is stored — or { error }. */
function cleanSettings(v) {
  if (!isPlainObject(v)) return { error: '"settings" must be an object.' };
  var out = {}, e;
  function unknown(obj, allowed, where) {
    var bad = Object.keys(obj).filter(function (k) { return allowed.indexOf(k) === -1; })[0];
    return bad ? '"' + where + '.' + bad + '" is not a setting.' : '';
  }
  if ((e = unknown(v, ['registration', 'seo', 'social'], 'settings'))) return { error: e };

  if (has(v, 'registration')) {
    var r = v.registration;
    if (!isPlainObject(r)) return { error: '"settings.registration" must be an object.' };
    /* what the event's single registration form used to hold is now each form's own (lib/api-forms.js);
       the stored values stay, read only to set up an event's first form */
    var perForm = ['fields', 'successMessage', 'duplicates'].filter(function (k) { return has(r, k); })[0];
    if (perForm) return { error: '"' + perForm + '" is now set per form: edit the form under Settings › Registration forms.', field: 'settings.registration.' + perForm };
    if (has(r, 'defaultFormId')) return { error: 'The default form is changed with POST /api/event/forms/default.', field: 'settings.registration.defaultFormId' };
    if ((e = unknown(r, ['open', 'capacity', 'target'], 'settings.registration'))) return { error: e };
    var reg = {};
    if (has(r, 'open')) { if (typeof r.open !== 'boolean') return { error: '"Registration open" must be on or off.' }; reg.open = r.open; }
    var counts = ['capacity', 'target'];
    for (var i = 0; i < counts.length; i++) {
      var k = counts[i];
      if (!has(r, k)) continue;
      if (r[k] !== null && !(typeof r[k] === 'number' && isFinite(r[k]) && r[k] >= 1 && r[k] <= 1000000 && Math.floor(r[k]) === r[k])) {
        return { error: 'The registration ' + k + ' must be a whole number of 1 or more, or left empty.' };
      }
      reg[k] = r[k];
    }
    out.registration = reg;
  }

  if (has(v, 'seo')) {
    var s = v.seo;
    if (!isPlainObject(s)) return { error: '"settings.seo" must be an object.' };
    if ((e = unknown(s, ['canonicalUrl', 'description', 'shareImageUrl'], 'settings.seo'))) return { error: e };
    var seo = {};
    if (has(s, 'canonicalUrl')) { if ((e = checkHttpUrl('The canonical address', s.canonicalUrl, 500))) return { error: e }; seo.canonicalUrl = (s.canonicalUrl || '').trim(); }
    if (has(s, 'description')) { if ((e = checkText('The search description', s.description, 320, false))) return { error: e }; seo.description = s.description || ''; }
    if (has(s, 'shareImageUrl')) {
      if ((e = checkUrl('The share image', s.shareImageUrl))) return { error: e };
      var img = (s.shareImageUrl || '').trim();
      if (img && !/^(https?:\/\/|\/(?!\/))/i.test(img)) return { error: 'The share image must be the address of an uploaded image.' };
      seo.shareImageUrl = img;
    }
    out.seo = seo;
  }

  if (has(v, 'social')) {
    if (!Array.isArray(v.social) || v.social.length > 12) return { error: '"settings.social" must be a list of at most 12 links.' };
    var social = [];
    for (var n = 0; n < v.social.length; n++) {
      var link = v.social[n];
      if (!isPlainObject(link) || SOCIAL_KINDS.indexOf(link.kind) === -1) return { error: 'A social link needs a kind: ' + SOCIAL_KINDS.join(', ') + '.' };
      if (!link.url || (e = checkHttpUrl('The ' + link.kind + ' link', link.url, 500))) return { error: e || 'The ' + link.kind + ' link needs an address.' };
      social.push({ kind: link.kind, url: link.url.trim() });
    }
    out.social = social;
  }
  return { value: out };
}

/* What is stored after a settings PATCH: registration and seo are merged key by key over what is there
   (so sending { registration: { open: false } } closes registration without wiping the capacity — or the
   default form, or the original single form's settings an event's first form is made from), and the
   social list is replaced as a whole. */
function mergeSettings(stored, patch) {
  var cur = isPlainObject(stored) ? stored : {};
  var out = Object.assign({}, cur);
  if (patch.registration) out.registration = Object.assign({}, isPlainObject(cur.registration) ? cur.registration : {}, patch.registration);
  if (patch.seo) out.seo = Object.assign({}, isPlainObject(cur.seo) ? cur.seo : {}, patch.seo);
  if (patch.social) out.social = patch.social;
  return out;
}

/* Reads the event fields off a request body. -> { data, settings } or { error }. */
function cleanEventBody(body, eventId, creating) {
  if (has(body, 'published')) {
    return { error: 'An event is published and unpublished with the Publish and Unpublish actions, not by editing it.' };
  }
  /* The address of an event IS its id: the site is served at /e/<id>, and nothing moves when a different
     "slug" is stored. Accepting one used to leave the console showing an address that did not exist. */
  if (has(body, 'slug') && body.slug != null && body.slug !== '' && body.slug !== eventId) {
    return { error: 'The address of an event cannot be changed after it is created.', code: 'slug-fixed' };
  }
  var data = {};
  for (var i = 0; i < EVENT_FIELDS.length; i++) {
    var f = EVENT_FIELDS[i];
    if (!has(body, f)) continue;
    var problem = EVENT_FIELD_CHECKS[f](body[f]);
    if (problem) return { error: problem };
    data[f] = body[f];
  }
  if (creating && !has(data, 'name')) return { error: 'The event name is required.' };
  if (typeof data.name === 'string') data.name = data.name.trim();
  if (has(data, 'payment')) data.payment = { type: 'free' };        // whatever was sent: see eventForClient
  if (data.start && data.end && Date.parse(data.end) < Date.parse(data.start)) return { error: 'The end date is before the start date.' };
  var settings = null;
  if (has(body, 'settings') && body.settings != null) {
    var s = cleanSettings(body.settings);
    if (s.error) return { error: s.error, field: s.field };
    settings = s.value;
  }
  return { data: data, settings: settings };
}

/* A free address near the one asked for, for the 409 below. lib/api-events.js owns the real rule (it
   answers GET /api/event/slug-available with it); it is used when that module can be loaded, so the
   wizard's check and this answer can never suggest different things. The fallback is the same idea in
   small: "<id>-2" … "<id>-20", first one that is not taken. Never rejects — a suggestion is a courtesy. */
function suggestFreeEventId(fb, wanted) {
  var shared = null;
  try { shared = require('./api-events')._shared; } catch (e) { shared = null; }
  var viaModule = shared && typeof shared.suggestFreeSlug === 'function'
    ? Promise.resolve().then(function () { return shared.suggestFreeSlug(fb, wanted); })
    : Promise.reject(new Error('unavailable'));
  return viaModule.catch(function () {
    var candidates = [];
    for (var n = 2; n <= 20; n++) candidates.push(wanted.slice(0, 80 - ('-' + n).length).replace(/-+$/, '') + '-' + n);
    candidates = candidates.filter(function (c) { return !isReservedEventId(c); });
    if (!candidates.length) return '';
    return fb.db.getAll.apply(fb.db, candidates.map(function (c) { return eventDocRef(fb, c); })).then(function (snaps) {
      for (var i = 0; i < snaps.length; i++) {
        var st = eventStateOf(snaps[i]);
        if (st === 'missing' || st === 'shell') return candidates[i];
      }
      return '';
    });
  }).catch(function () { return ''; });
}

/* What a document that was never created as an event may still be carrying, written by older versions
   of this file: a PATCH, publish or stage on an id nobody had created used to create the document. None
   of it belongs to the event now being created under that address — least of all `published`, which
   would put somebody's leftover page on the new event's public URL. A first creation over a shell
   removes all of it and keeps only what the AI steps prepared for this very creation (designPlan,
   theme, structurePlan, …), which the wizard runs BEFORE it creates the event. */
var SHELL_STATE_FIELDS = ['published', 'publishedAt', 'publishedBy', 'publishedVersion', 'publishedPath', 'publishedUrl',
  'unpublishedAt', 'unpublishedBy', 'stagingUrl', 'site', 'siteLock', 'deletedAt', 'deletedBy', 'counters', 'settings',
  'sections', 'nav', 'checklist', 'paletteTheme', 'cloningFrom', 'clonedFrom'];

/* POST /api/event. 200 { ok, eventId, createdAt, updatedAt }; 409 { error, code: 'slug-taken', suggestion }
   when the address belongs to an event (live or deleted); 400 { code: 'slug-reserved', suggestion } for an
   address nothing may take (lib/http.js's isReservedEventId). Creating over an existing event used to merge the new
   fields into it: the second event silently took over the first one's content, registrations and site.
   The check and the write are one transaction, so two people creating the same address at the same
   moment cannot both succeed. */
function handleEventCreate(req, res) {
  withAdminBody(req, res, BODY_LIMITS.event, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId || body.slug);
    if (!eventId) return;
    if (isReservedEventId(eventId)) {
      return suggestFreeEventId(fb, eventId).then(function (suggestion) {
        sendJson(res, 400, { error: 'That address is reserved.' + (suggestion ? ' Try "' + suggestion + '".' : ' Choose another.'), code: 'slug-reserved', suggestion: suggestion });
      });
    }
    var clean = cleanEventBody(body, eventId, true);
    if (clean.error) return sendJson(res, 400, { error: clean.error, code: clean.code, field: clean.field });

    var now = new Date().toISOString(), actor = actorOf(decoded);
    var data = clean.data;
    data.slug = eventId;
    data.createdAt = now; data.updatedAt = now; data.detailsUpdatedAt = now; data.createdBy = actor; data.updatedBy = actor;
    if (data.status == null) data.status = 'draft';
    data.published = false;
    data.counters = { registrations: 0, views: 0 };
    if (clean.settings) data.settings = mergeSettings(null, clean.settings);

    var ref = eventDocRef(fb, eventId);
    fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var state = eventStateOf(snap);
        if (state === 'live' || state === 'deleted') throw httpError(409, 'taken');
        if (state === 'missing') { tx.set(ref, data); return; }
        var write = Object.assign({}, data);
        SHELL_STATE_FIELDS.forEach(function (f) { if (!has(write, f)) write[f] = fieldDelete(); });
        tx.set(ref, write, { merge: true });
      });
    }).then(function () {
      sendJson(res, 200, { ok: true, eventId: eventId, createdAt: now, updatedAt: now });
      logActivity(fb, eventId, decoded, 'created', data.name);
    }).catch(function (err) {
      if (!(err && err.status === 409)) return sendFailure(res, 'event create', err, 'The event could not be created. Please try again.');
      suggestFreeEventId(fb, eventId).then(function (suggestion) {
        sendJson(res, 409, {
          error: 'The address "' + eventId + '" is already used by another event.' + (suggestion ? ' Try "' + suggestion + '".' : ''),
          code: 'slug-taken', suggestion: suggestion
        });
      });
    });
  });
}

function handleEventGet(req, res) {
  withAdmin(req, res, function (fb) {
    var eventId = eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    loadLiveEvent(fb, eventId)
      .then(function (data) { sendJson(res, 200, eventForClient(eventId, data)); })
      .catch(function (err) { sendFailure(res, 'event get', err, 'Could not load the event. Please try again.'); });
  });
}

/* PATCH /api/event. 200 { ok, updatedAt }; 404 for an id that is not a live event (it used to create the
   document). Each field sent replaces the stored one as a whole — a `checklist` or `nomination` object is
   not deep-merged, so a key the client stops sending really goes. `settings` is the one deliberate
   exception: see mergeSettings.

   Two people with the same event open. A page that sends `ifUpdatedAt` — the `updatedAt` it was last
   given, by GET /api/event or by its own last save — is refused with 409 { code: 'stale', current:
   { updatedAt, updatedBy } } when somebody has changed the event's details since then, instead of
   quietly putting its older copy of every field back. What it is compared with is `detailsUpdatedAt`,
   which only this route and create stamp: saving the site in the editor moves the event's `updatedAt`
   every few seconds and is not a change to its details. A request without `ifUpdatedAt` is not checked. */
function handleEventUpdate(req, res) {
  withAdminBody(req, res, BODY_LIMITS.event, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var clean = cleanEventBody(body, eventId, false);
    if (clean.error) return sendJson(res, 400, { error: clean.error, code: clean.code, field: clean.field });
    var bad = checkIfUpdatedAt(body);
    if (bad) return sendJson(res, 400, { error: bad });
    var changed = Object.keys(clean.data);
    if (!changed.length && !clean.settings) return sendJson(res, 400, { error: 'Nothing to update.' });

    var now = new Date().toISOString(), ref = eventDocRef(fb, eventId), statusChange = null, diff = [], settingsDiff = [];
    fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var state = eventStateOf(snap);
        if (state !== 'live') throw notLiveError(state, eventId);
        var stored = snap.data();
        if (body.ifUpdatedAt != null && isoOf(stored.detailsUpdatedAt) && isoOf(stored.detailsUpdatedAt) > body.ifUpdatedAt) {
          throw staleError('event', { updatedAt: isoOf(stored.updatedAt), updatedBy: stored.updatedBy });
        }
        var write = Object.assign({}, clean.data, { updatedAt: now, detailsUpdatedAt: now, updatedBy: actorOf(decoded) });
        if (clean.settings) {
          write.settings = mergeSettings(stored.settings, clean.settings);
          settingsDiff = fieldChanges(stored.settings || {}, pick(write.settings, Object.keys(clean.settings)));
        }
        diff = fieldChanges(stored, clean.data, ['status']);
        statusChange = has(clean.data, 'status') && clean.data.status != null && clean.data.status !== stored.status
          ? (stored.status || 'no status') + ' → ' + clean.data.status : null;
        tx.update(ref, write);
      });
    }).then(function () {
      sendJson(res, 200, { ok: true, updatedAt: now });
      if (clean.settings && settingsDiff.length) logActivity(fb, eventId, decoded, 'settings-changed', settingsDiff.map(function (f) { return f.field; }).join(', '), { fields: settingsDiff });
      if (statusChange) logActivity(fb, eventId, decoded, 'status-changed', statusChange);
      if (diff.length) logActivity(fb, eventId, decoded, 'updated', diff.map(function (f) { return f.field; }).join(', '), { fields: diff });
    }).catch(function (err) { sendFailure(res, 'event update', err, 'The event could not be saved. Please try again.'); });
  });
}

/* ---------- GET /api/events — list ALL events, team-wide ----------
   Every event any admin has created, for every admin to see — there is no per-user event scoping
   anywhere in this app. Most recently changed first (no pagination yet; see EVENTS_LIST_LIMIT).

   "Event" here means a live event and nothing else: not a deleted one and not a shell — a document an AI
   step, an import or an old stray write left behind under an id nobody created an event for (it has no
   createdAt, usually no name, and opening it led nowhere). The Lovable import pipeline's staging records
   (events/import-…) are shells by that rule, so nothing here needs to know their prefix.

   ?deleted=1 lists the deleted events instead, most recently deleted first, each with deletedAt and
   deletedBy: the only place a deleted event can be found again to restore it.

   What a list needs is small and fixed, so only those fields are read (EVENT_LIST_FIELDS) and every item
   has the same shape (eventListItem). An event document can also hold a whole generated site — close to
   1 MiB of markup — and the listing used to download all of it, for every event, on every open. The
   query has no orderBy on purpose: Firestore leaves a document without the ordered field out of the
   result, so an event whose `updatedAt` was missing simply never appeared. They are sorted here. */
var EVENTS_LIST_LIMIT = 1000;
var EVENT_LIST_FIELDS = ['name', 'category', 'status', 'start', 'end', 'dateLabel', 'dateMode', 'venue', 'city', 'client',
  'templateId', 'logoUrl', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'published', 'publishedAt',
  'publishedVersion', 'counters', 'site', 'generatedAt', 'deletedAt', 'deletedBy', 'discardingAt'];

function eventListItem(id, d) {
  var c = isPlainObject(d.counters) ? d.counters : {}, site = isPlainObject(d.site) ? d.site : null;
  var published = d.published === true, deleted = !!d.deletedAt;
  var text = function (v) { return typeof v === 'string' ? v : ''; };
  var item = {
    id: id, eventId: id, slug: id,
    name: text(d.name), category: text(d.category), status: text(d.status) || 'draft',
    start: text(d.start) || null, end: text(d.end) || null, dateLabel: text(d.dateLabel), dateMode: text(d.dateMode),
    venue: text(d.venue), city: text(d.city), client: text(d.client),
    templateId: text(d.templateId) || null, logoUrl: /^(https?:\/\/|\/(?!\/))/i.test(text(d.logoUrl)) ? d.logoUrl : '',
    createdAt: isoOf(d.createdAt) || null, createdBy: text(d.createdBy),
    updatedAt: isoOf(d.updatedAt) || isoOf(d.createdAt) || null, updatedBy: text(d.updatedBy),
    published: published, publishedAt: isoOf(d.publishedAt) || null,
    /* a deleted event's page is not served; `published` still says whether Restore brings it back */
    publishedPath: published && !deleted ? publicPathOf(id) : null,
    publishedVersion: +d.publishedVersion || 0,
    counters: { registrations: +c.registrations || 0, views: +c.views || 0 },
    site: site ? { version: +site.version || 0, templateId: site.templateId || null, updatedAt: site.updatedAt || null, updatedBy: site.updatedBy || null } : null,
    /* an AI-designed site exists from the moment it is generated, before the editor has saved anything */
    hasGeneratedSite: !!d.generatedAt,
    payment: { type: 'free' }
  };
  item.hasSite = (!!site && +site.version > 0) || item.hasGeneratedSite;
  if (deleted) { item.deletedAt = isoOf(d.deletedAt); item.deletedBy = text(d.deletedBy); }
  return item;
}

function handleEventsList(req, res) {
  withAdmin(req, res, function (fb) {
    var wanted = queryOf(req).get('deleted') === '1' ? 'deleted' : 'live';
    var query = fb.db.collection('events');
    query.select.apply(query, EVENT_LIST_FIELDS).limit(EVENTS_LIST_LIMIT).get()
      .then(function (snap) {
        var items = snap.docs.filter(function (d) {
          var data = d.data();
          /* a draft that is being removed for good is in neither list (lib/api-events.js) */
          if (eventStateOf(d) !== wanted || data.discardingAt) return false;
          return typeof data.name === 'string' && data.name.trim() !== '';
        }).map(function (d) { return eventListItem(d.id, d.data()); });
        var key = wanted === 'deleted' ? 'deletedAt' : 'updatedAt';
        items.sort(function (a, b) {
          var x = String(a[key] || ''), y = String(b[key] || '');
          return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? 1 : -1);
        });
        sendJson(res, 200, { items: items });
      })
      .catch(function (err) { sendFailure(res, 'events list', err, 'Could not load your events. Please try again.'); });
  });
}

/* =====================================================================================================
   THE SITE, SAVED ON THE SERVER — GET / PUT /api/event/site, publish, unpublish, /e/<id>, /preview/<id>

   Until now the editor's work existed in one browser's IndexedDB and nowhere else; the server only ever
   saw the HTML somebody last pressed Publish on, from whichever browser they happened to be using. Now:

     Storage (all private — only this file reads them)
       events/<id>/site/snapshot.json    canvas.snapshot(): what the editor reopens. Opaque to the server.
       events/<id>/site/page.html        canvas.serialize(): the page as it would be published.
       events/<id>/published/index.html  the page visitors get at /e/<id>, already through the publish
                                         transform. (Pages published by the previous version of this file
                                         are public objects written as-is; /e/<id> serves those too.)
       events/<id>/staging/index.html    only for editors still running the previous script: see
                                         handleEventStage.
     Firestore, on events/<id>
       site { version, snapshotVersion, templateId, updatedAt, updatedBy }
       published, publishedAt, publishedBy, publishedVersion, publishedPath
       siteLock { token, at }            see below; never sent to a client.
   ===================================================================================================== */
function sitePath(eventId, file) { return 'events/' + eventId + '/site/' + file; }
function publishedObjectPath(eventId) { return 'events/' + eventId + '/published/index.html'; }
function stagingObjectPath(eventId) { return 'events/' + eventId + '/staging/index.html'; }
function siteVersionOf(data) { return (data && data.site && +data.site.version) || 0; }

/* Writes text to a private object. resumable:false sends it as one request, which is both faster for
   files of this size and atomic: readers see the old object or the new one, never a partial one. Nothing
   here calls makePublic(): the old two-step "save, then make public" is what took a live page down (403)
   on every re-publish, and left it down when the second step failed. */
function saveObject(fb, objectPath, text, contentType) {
  return fb.bucket.file(objectPath).save(Buffer.from(text, 'utf8'), {
    resumable: false, metadata: { contentType: contentType, cacheControl: 'private, no-store' }
  });
}
/* Resolves the object's text, or null when there is no such object. */
function readObject(fb, objectPath) {
  return fb.bucket.file(objectPath).download().then(function (r) { return r[0].toString('utf8'); }, function (err) {
    if (err && (err.code === 404 || err.code === '404')) return null;
    throw err;
  });
}
/* Puts an object back the way it was before a failed operation (its earlier text, or absent). Used only
   on a path that is already failing, so it must not add a second failure on top: it resolves regardless. */
function restoreObject(fb, objectPath, previousText, contentType) {
  var p = previousText == null
    ? fb.bucket.file(objectPath).delete({ ignoreNotFound: true })
    : saveObject(fb, objectPath, previousText, contentType);
  return p.then(function () {}, function (err) {
    console.error('api: could not restore ' + objectPath + ' after a failed operation — ' + (err && err.message));
  });
}

/* ---------- one writer at a time per event ----------
   A site save is two Storage objects plus the version number on the event document, and a publish is a
   Storage object plus the published* fields. Storage cannot take part in a Firestore transaction, and
   doing the uploads from inside one does not help either: two transactions would both upload before one
   of them lost at commit, leaving the loser's files under the winner's version number.

   So the event document carries a short lease. acquireSiteLock() takes it in a transaction — the same
   transaction that checks the caller's precondition (the base version of a save, "has this site ever
   been saved" for a publish) — the caller then writes its objects, and commitSiteLock() applies the
   document changes and drops the lease in a second transaction, but only if the lease is still ours.
   Two simultaneous saves therefore cannot both win: the second waits for the first to finish and is then
   judged against the version the first one produced.

   The lease expires on its own (an instance that dies mid-save must not freeze the event), and a writer
   that finds it taken waits a little rather than failing at once, because the usual reason is the same
   user's previous autosave still finishing. */
var SITE_LOCK_TTL_MS = 45000;
var SITE_LOCK_WAIT_MS = 20000;
var SITE_LOCK_POLL_MS = 300;

function acquireSiteLock(fb, eventId, token, precondition) {
  var ref = eventDocRef(fb, eventId), deadline = Date.now() + SITE_LOCK_WAIT_MS;
  function attempt() {
    return fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var state = eventStateOf(snap);
        if (state !== 'live') throw notLiveError(state, eventId);
        var data = snap.data(), lock = data.siteLock;
        var heldAt = lock && lock.token !== token ? Date.parse(lock.at) : NaN;
        if (!isNaN(heldAt) && Date.now() - heldAt < SITE_LOCK_TTL_MS) return null;      // someone else is writing
        var refusal = precondition ? precondition(data) : null;
        if (refusal) throw refusal;
        tx.update(ref, { siteLock: { token: token, at: new Date().toISOString() } });
        return data;
      });
    }).then(function (data) {
      if (data) return data;
      if (Date.now() > deadline) {
        throw httpError(503, 'Another save of this site is still in progress. Please try again in a moment.', { code: 'site-busy' });
      }
      return new Promise(function (resolve) { setTimeout(resolve, SITE_LOCK_POLL_MS); }).then(attempt);
    });
  }
  return attempt();
}

/* Applies `changes` to the event and releases the lease, if and only if the lease is still ours. */
function commitSiteLock(fb, eventId, token, changes) {
  var ref = eventDocRef(fb, eventId);
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var lock = snap.exists ? snap.data().siteLock : null;
      if (!lock || lock.token !== token) {
        throw httpError(409, 'This took too long and someone else has saved the site in the meantime. Reload to see the latest version.', { code: 'site-conflict' });
      }
      tx.update(ref, Object.assign({}, changes, { siteLock: fieldDelete() }));
    });
  });
}

/* Drops the lease after a failure. Best effort: if this fails too, the lease simply expires. */
function releaseSiteLock(fb, eventId, token) {
  var ref = eventDocRef(fb, eventId);
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var lock = snap.exists ? snap.data().siteLock : null;
      if (lock && lock.token === token) tx.update(ref, { siteLock: fieldDelete() });
    });
  }).then(function () {}, function (err) {
    console.error('api: could not release the site lock on ' + eventId + ' — ' + (err && err.message));
  });
}

/* "http://localhost:8123", "https://cms.example.com" — nothing else (no path, no credentials). */
function cleanOrigin(v) {
  if (typeof v !== 'string') return '';
  var m = /^(https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?)\/?$/.exec(v.trim());
  return m ? m[1] : '';
}

/* The address this server is reached at, for the absolute URLs a page needs (canonical link, og:url) and
   for the publishedUrl a client is handed. PUBLIC_BASE_URL wins when it is set; otherwise it is the
   address the signed-in user's own browser is using right now, which for an admin request is the CMS. */
function requestOrigin(req) {
  var h = req.headers || {};
  var host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return '';
  var proto = String(h['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto !== 'http' && proto !== 'https') proto = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https';
  return proto + '://' + host;
}
function publicBaseFor(req, bodyOrigin) {
  return cleanOrigin(process.env.PUBLIC_BASE_URL || '') || cleanOrigin(bodyOrigin) || requestOrigin(req);
}

/* ---------- GET /api/event/site?eventId= ----------
   200 { eventId, version, snapshotVersion, templateId, updatedAt, updatedBy, eventCreatedAt, snapshot }
   404 { code: 'site-not-saved' } when the site has never been saved.
   `snapshot` is null and `snapshotVersion` is lower than `version` only when the newest page came from an
   editor still running the previous script (it publishes a page without a snapshot; see
   handleEventPublish) — the editor then has a page it cannot reopen and should say so rather than treat
   an older snapshot as current. `eventCreatedAt` is what the editor's local copy must match (contract
   section 3): a new event that reuses an old address must never open the old event's site. */
function handleSiteGet(req, res) {
  withAdmin(req, res, function (fb) {
    var eventId = eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    loadLiveEvent(fb, eventId).then(function (data) {
      var version = siteVersionOf(data);
      if (!version) throw httpError(404, 'This site has not been saved yet.', { code: 'site-not-saved' });
      return readObject(fb, sitePath(eventId, 'snapshot.json')).then(function (text) {
        var snapshot = null;
        if (text != null) { try { snapshot = JSON.parse(text); } catch (e) { snapshot = null; } }
        var site = data.site;
        sendJson(res, 200, {
          eventId: eventId, version: version,
          snapshotVersion: snapshot == null ? 0 : (site.snapshotVersion != null ? +site.snapshotVersion : version),
          templateId: site.templateId || data.templateId || null,
          updatedAt: site.updatedAt || null, updatedBy: site.updatedBy || null,
          eventCreatedAt: data.createdAt || null, snapshot: snapshot
        });
      });
    }).catch(function (err) { sendFailure(res, 'site get', err, 'Could not load the saved site. Please try again.'); });
  });
}

/* ---------- PUT /api/event/site ----------
   Body { eventId, templateId, baseVersion, snapshot, html, origin, force? } -> 200 { version, updatedAt }.
   `baseVersion` is the version the editor loaded (0 for a first save). If the stored version is different
   and `force` is not true: 409 { error, code: 'site-conflict', current: { version, updatedAt, updatedBy } }
   and nothing is written — the editor asks its user which copy to keep.

   The page is stored with the saving origin already made root-relative (see rewriteOrigins), so what is
   kept does not depend on which host the editor happened to be opened on. */
function handleSitePut(req, res) {
  withAdminBody(req, res, BODY_LIMITS.site, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    if (typeof body.html !== 'string' || !body.html.trim()) return sendJson(res, 400, { error: 'The page to save ("html") is missing.' });
    if (!isPlainObject(body.snapshot)) return sendJson(res, 400, { error: 'The editor state to save ("snapshot") is missing.' });
    var baseVersion = body.baseVersion == null ? 0 : body.baseVersion;
    if (typeof baseVersion !== 'number' || !isFinite(baseVersion) || baseVersion < 0 || Math.floor(baseVersion) !== baseVersion) {
      return sendJson(res, 400, { error: '"baseVersion" must be the version number this site was loaded at (0 for a first save).' });
    }
    var templateProblem = EVENT_FIELD_CHECKS.templateId(body.templateId);
    if (templateProblem) return sendJson(res, 400, { error: templateProblem });
    if (body.origin != null && body.origin !== '' && !cleanOrigin(body.origin)) return sendJson(res, 400, { error: '"origin" must be the address of the editor (location.origin).' });
    if (body.force != null && typeof body.force !== 'boolean') return sendJson(res, 400, { error: '"force" must be true or false.' });

    var snapshotText;
    try { snapshotText = JSON.stringify(body.snapshot); } catch (e) { return sendJson(res, 400, { error: 'The editor state could not be read.' }); }
    var pageHtml = rewriteOrigins(body.html, [cleanOrigin(body.origin)]);

    var token = crypto.randomBytes(12).toString('hex'), actor = actorOf(decoded), now = new Date().toISOString();
    acquireSiteLock(fb, eventId, token, function (data) {
      var current = siteVersionOf(data);
      if (body.force === true || baseVersion === current) return null;
      var site = data.site || {};
      return httpError(409, current
        ? 'This site was changed' + (site.updatedBy ? ' by ' + site.updatedBy : '') + ' after you opened it.'
        : 'This site has no saved version yet — reload the editor.', {
        code: 'site-conflict',
        current: { version: current, updatedAt: site.updatedAt || null, updatedBy: site.updatedBy || null }
      });
    }).then(function (data) {
      var previous = data.site || {}, version = siteVersionOf(data) + 1;
      var templateId = body.templateId || previous.templateId || data.templateId || null;
      var beforeHtml = null;
      /* the page as it was, read before it is replaced: what this save is compared with */
      return readObject(fb, sitePath(eventId, 'page.html')).then(function (text) { beforeHtml = siteVersionOf(data) ? text : null; }).then(function () {
        return Promise.all([
          saveObject(fb, sitePath(eventId, 'snapshot.json'), snapshotText, 'application/json; charset=utf-8'),
          saveObject(fb, sitePath(eventId, 'page.html'), pageHtml, 'text/html; charset=utf-8')
        ]);
      }).then(function () {
        return commitSiteLock(fb, eventId, token, {
          site: { version: version, snapshotVersion: version, templateId: templateId, updatedAt: now, updatedBy: actor },
          updatedAt: now
        });
      }).then(function () {
        /* a save is somebody pressing Save: every one is a kept version, on staging, with its own line in
           the history saying what changed */
        return recordSave(fb, eventId, decoded, version, beforeHtml, pageHtml, body.note).then(function (rec) {
          sendJson(res, 200, { version: version, updatedAt: now, changeId: rec.changeId, summary: rec.summary, changes: rec.items.length,
            stagingPath: '/preview/' + eventId + '?staged=1', published: data.published === true, publishedVersion: data.published === true ? (+data.publishedVersion || 0) : 0 });
        });
      }, function (err) {
        return releaseSiteLock(fb, eventId, token).then(function () { throw err; });
      });
    }).catch(function (err) { sendFailure(res, 'site save', err, 'The site could not be saved. Please try again.'); });
  });
}

/* =====================================================================================================
   THE PUBLISH TRANSFORM — one function, used for /e/<id> (at publish) and /preview/<id> (on request)

   Input: a serialized page (editor-canvas.js's serialize(): template-loader.js's document for a real
   template, an AI-designed site "gen-<id>" or a Lovable import "imported-<id>", after editing). Output:
   the page a visitor gets. In order, it
     1. removes what only the editor or the AI review needs, what a browser extension left behind in
        the page while it was being edited, and the markup authors' HTML comments;
     2. makes the saving origin root-relative, so the page works at whatever host serves it, and on an
        AI-designed site holds every section heading but the hero's to the site's type scale;
     3. sets <title> to the event's name and writes the description, Open Graph tags, canonical link and
        favicon;
     4. makes sure the live-site runtime and its config block are present exactly once;
     5. in preview mode, adds a "Preview — not published" ribbon;
     6. in preview mode, adds the theme switcher of an AI-designed site and (opts.editButton) the
        "Edit with AI" button (templates/_shared/rv-preview-edit.js) that opens the editor at the section in
        view. opts.liveView instead marks the page as the site editor's live view (<html
        data-rv-editor-mode="ai">, see et-runtime.js) and adds none of 5 and 6: the editor shows the page as
        the preview does, without the preview's own controls.

   There is no HTML parser among this project's dependencies, and this is not one. It is a tokenizer that
   knows only where tags, comments and raw-text elements (script, style, textarea, title) begin and end,
   and the transform changes nothing but whole tags it has matched exactly and text it inserts itself.
   Three rules keep it from damaging a page it does not fully understand:
     - a tag that cannot be read to its end (an unclosed quote, a stray "<") is left as plain text;
     - an element is removed only when its matching end tag is found; otherwise it stays, untouched;
     - everything the transform adds carries a marker attribute (data-rv-head, data-rv-runtime,
       data-rv-preview-ribbon) and is removed by that marker before being added again — which is what
       makes running it on its own output change nothing.
   Text inside <script> is never rewritten.
   ===================================================================================================== */
var VOID_TAGS = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
var RAW_TEXT_TAGS = { script: 1, style: 1, textarea: 1, title: 1 };

function escHtmlText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escHtmlAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Reads one start tag beginning at html[start] === '<'. Returns the token, or null when the tag does not
   end properly (then the "<" is just text). Attribute values are kept exactly as written (`raw`), so a
   tag that is not changed is written back byte for byte. */
function readStartTag(html, start) {
  var n = html.length, i = start + 1;
  while (i < n && !/[\s\/>]/.test(html.charAt(i))) i++;
  var rawName = html.slice(start + 1, i);
  var tag = { t: 'open', s: start, e: 0, name: rawName.toLowerCase(), rawName: rawName, attrs: [], selfClosing: false };
  for (;;) {
    while (i < n && /\s/.test(html.charAt(i))) i++;
    if (i >= n) return null;
    var c = html.charAt(i);
    if (c === '>') { tag.e = i + 1; return tag; }
    if (c === '/') {
      if (html.charAt(i + 1) === '>') { tag.selfClosing = true; tag.e = i + 2; return tag; }
      i++; continue;
    }
    var nameStart = i;
    while (i < n && !/[\s=>]/.test(html.charAt(i)) && !(html.charAt(i) === '/' && html.charAt(i + 1) === '>')) i++;
    if (i === nameStart) { i++; continue; }                      // a stray "=": skip it
    var attr = { name: html.slice(nameStart, i).toLowerCase(), value: null, raw: '' };
    var j = i;
    while (j < n && /\s/.test(html.charAt(j))) j++;
    if (html.charAt(j) === '=') {
      j++;
      while (j < n && /\s/.test(html.charAt(j))) j++;
      var q = html.charAt(j);
      if (q === '"' || q === "'") {
        var close = html.indexOf(q, j + 1);
        if (close === -1) return null;
        attr.value = html.slice(j + 1, close);
        i = close + 1;
      } else {
        var k = j;
        while (k < n && !/[\s>]/.test(html.charAt(k))) k++;
        attr.value = html.slice(j, k);
        i = k;
      }
    }
    attr.raw = html.slice(nameStart, i);
    tag.attrs.push(attr);
  }
}

function tokenizeHtml(html) {
  var tokens = [], n = html.length, i = 0, textStart = 0;
  function flushText(end) { if (end > textStart) tokens.push({ t: 'text', s: textStart, e: end }); }
  while (i < n) {
    var lt = html.indexOf('<', i);
    if (lt === -1) break;
    var next = html.charAt(lt + 1), end;
    if (html.substr(lt, 4) === '<!--') {
      end = html.indexOf('-->', lt + 4);
      end = end === -1 ? n : end + 3;
      flushText(lt); tokens.push({ t: 'comment', s: lt, e: end }); i = textStart = end;
    } else if (next === '!' || next === '?') {
      end = html.indexOf('>', lt + 2);
      if (end === -1) break;
      flushText(lt); tokens.push({ t: 'decl', s: lt, e: end + 1 }); i = textStart = end + 1;
    } else if (next === '/' && /[A-Za-z]/.test(html.charAt(lt + 2))) {
      end = html.indexOf('>', lt + 2);
      if (end === -1) break;
      flushText(lt);
      tokens.push({ t: 'close', s: lt, e: end + 1, name: html.slice(lt + 2, end).split(/[\s\/]/)[0].toLowerCase() });
      i = textStart = end + 1;
    } else if (/[A-Za-z]/.test(next)) {
      var tag = readStartTag(html, lt);
      if (!tag) { i = lt + 1; continue; }
      flushText(lt); tokens.push(tag); i = textStart = tag.e;
      if (RAW_TEXT_TAGS[tag.name] && !tag.selfClosing) {
        var re = new RegExp('</' + tag.name + '(?=[\\s/>])', 'ig');
        re.lastIndex = i;
        var m = re.exec(html), stop = m ? m.index : n;
        if (stop > i) tokens.push({ t: 'raw', s: i, e: stop, of: tag.name });
        i = textStart = stop;
      }
    } else {
      i = lt + 1;
    }
  }
  flushText(n);
  return tokens;
}

function attrOf(tag, name) {
  for (var i = 0; i < tag.attrs.length; i++) if (tag.attrs[i].name === name) return tag.attrs[i];
  return null;
}
function attrValue(tag, name) { var a = attrOf(tag, name); return a && a.value != null ? a.value : (a ? '' : null); }
function classListOf(tag) { return (attrValue(tag, 'class') || '').split(/\s+/).filter(Boolean); }
function writeTag(tag) {
  return '<' + tag.rawName + tag.attrs.map(function (a) { return ' ' + a.raw; }).join('') + (tag.selfClosing ? ' />' : '>');
}
function setAttr(tag, name, value) {
  var raw = name + '="' + escHtmlAttr(value) + '"', a = attrOf(tag, name);
  if (a) { a.value = escHtmlAttr(value); a.raw = raw; } else tag.attrs.push({ name: name, value: escHtmlAttr(value), raw: raw });
}
function dropAttr(tag, name) {
  var before = tag.attrs.length;
  tag.attrs = tag.attrs.filter(function (a) { return a.name !== name; });
  return tag.attrs.length !== before;
}

/* The index of the token that ends the element opened at tokens[i]: i itself for a void or self-closed
   element, the matching end tag otherwise, or -1 when there is none (the element is then left alone). */
function elementEnd(tokens, i) {
  var tag = tokens[i];
  if (VOID_TAGS[tag.name] || tag.selfClosing) return i;
  var depth = 0;
  for (var j = i + 1; j < tokens.length; j++) {
    var t = tokens[j];
    if (t.t === 'open' && t.name === tag.name && !t.selfClosing) depth++;
    else if (t.t === 'close' && t.name === tag.name) { if (depth === 0) return j; depth--; }
  }
  return -1;
}

/* Every absolute URL that points at `origin` becomes root-relative. Only where a URL starts: at the
   beginning of the value, or after whitespace, a comma, "(", a quote, "=" or ";" (the end of &quot;),
   which covers href/src, srcset lists and url(...) in style attributes and stylesheets. "http://host:81"
   is never mistaken for a prefix of "http://host:8123", because the "/" after the origin is required. */
function originRewriter(origins) {
  var list = (origins || []).filter(Boolean).filter(function (o, i, a) { return a.indexOf(o) === i; });
  if (!list.length) return null;
  var re = new RegExp('(^|[\\s,(\'"=;])(?:' + list.map(escRegExp).join('|') + ')(?=/)', 'g');
  return function (value) {
    if (list.indexOf(value) !== -1) return '/';
    return value.indexOf('://') === -1 ? value : value.replace(re, '$1');
  };
}

/* The origin a serialized page was saved from, read off the page itself: template-loader.js always links
   its own et-runtime.js by absolute URL. Lets a page be made root-relative even when nobody told us where
   it came from — which is the case for every page published before the site was saved on the server. */
function detectSavingOrigins(tokens) {
  var found = [];
  tokens.forEach(function (t) {
    if (t.t !== 'open' || (t.name !== 'script' && t.name !== 'link')) return;
    var url = attrValue(t, t.name === 'script' ? 'src' : 'href') || '';
    var m = /^(https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?)\/templates\/_shared\/et-[a-z-]+\.(?:js|css)(?:[?#].*)?$/.exec(url);
    if (m && found.indexOf(m[1]) === -1) found.push(m[1]);
  });
  return found;
}

/* Applies the origin rewrite to a token list in place (out[] holds each token's text). */
function rewriteOriginTokens(html, tokens, out, origins) {
  var rewrite = originRewriter(origins);
  if (!rewrite) return;
  tokens.forEach(function (t, i) {
    if (out[i] === '') return;
    if (t.t === 'raw' && t.of === 'style') { out[i] = rewrite(out[i]); return; }
    if (t.t !== 'open') return;
    var changed = false;
    t.attrs.forEach(function (a) {
      if (a.value == null || a.value.indexOf('://') === -1) return;
      var v = rewrite(a.value);
      if (v === a.value) return;
      var quote = a.raw.charAt(a.raw.length - 1);
      quote = (quote === '"' || quote === "'") ? quote : '"';
      a.raw = a.raw.slice(0, a.raw.indexOf('=')).trim() + '=' + quote + v + quote;
      a.value = v; changed = true;
    });
    if (changed) out[i] = writeTag(t);
  });
}

/* Step 2 on its own, for PUT /api/event/site: the stored page is root-relative from the start. */
function rewriteOrigins(html, origins) {
  var tokens = tokenizeHtml(html);
  var out = tokens.map(function (t) { return html.slice(t.s, t.e); });
  rewriteOriginTokens(html, tokens, out, (origins || []).concat(detectSavingOrigins(tokens)));
  return out.join('');
}

/* Attributes and classes that exist for the editor only. The first seven are the same list
   editor-canvas.js's serialize() strips; the rest are the editor's own escape hatch (data-ed), its
   AI-review markers (editor-fill.js / editor-template-ui.js), and what the Grammarly extension writes
   into any page its user edits — two already-published pages carry it. */
var EDITOR_ONLY_ATTRS = ['data-rv-logo-note', 'data-editable', 'contenteditable', 'data-sec-name', 'data-text-original', 'data-date', 'data-date-shown',
  'data-date-format', 'data-ed', 'data-ai-generated', 'data-ai-skipped', 'data-ai-media-skipped', 'data-rv-editing',
  'data-rv-editor-mode', 'data-gr-ext-installed', 'data-new-gr-c-s-check-loaded', 'data-rv-edge-host',
  /* which of a site's pages is shown (rv-pages.js): written as the page is served (sitePages.selectPage), never stored */
  'data-rv-current-page'];
var EDITOR_ONLY_CLASSES = ['ed-selected', 'sec-active', 'show-ai-markers'];
var AI_BADGE_CLASSES = ['ai-prov-badge', 'ai-skip-badge', 'ai-media-skip-badge'];
var RUNTIME_SCRIPT = /\/(?:templates\/_shared\/(?:rv-data|rv-live|rv-forms|rv-blend|rv-award-cta|rv-pages)\.js|editor-fill\.js)$/;
/* The forms runtime (templates/_shared/rv-forms.js: a button's form in a pop-up, a form placed in the page,
   validation and sending). Its address carries lib/forms.js FORMS_RUNTIME_V, bumped whenever the file
   changes: static files are cached for five minutes under an unhashed name. */
var FORMS_RUNTIME_V = formsLib.FORMS_RUNTIME_V;
var FORMS_RUNTIME_SRC = '/templates/_shared/rv-forms.js?v=' + FORMS_RUNTIME_V;
var FORMS_RUNTIME_TAG = '<script src="' + FORMS_RUNTIME_SRC + '" data-rv-runtime></script>';
/* An award site's lifecycle button (templates/_shared/rv-award-cta.js: "Express Interest" -> "Nominate Now" ->
   "Winners will be announced soon" -> "View Winners" by the award's dates). Only on a page that has one
   (data-rv-award-cta); its address carries AWARD_CTA_RUNTIME_V, bumped whenever the file changes. */
var AWARD_CTA_RUNTIME_V = 1;
var AWARD_CTA_TAG = '<script src="/templates/_shared/rv-award-cta.js?v=' + AWARD_CTA_RUNTIME_V + '" data-rv-runtime></script>';
var AWARD_CTA_MARK = /<[a-z][^>]*\sdata-rv-award-cta(?=[\s=>\/])/i;
/* section edges' runtime (templates/_shared/rv-blend.js): bumped whenever that file changes */
var BLEND_RUNTIME_V = 2;
/* JSON inside a <script> block: "<" must not appear (a "</script" in some text would end the block early),
   nor the two characters JavaScript reads as line ends */
function scriptJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, function (c) { return c === '\u2028' ? '\\u2028' : '\\u2029'; });
}

/* A page published before forms existed is stored without the forms runtime and is not transformed again
   when it is served (handlePublicPage): the runtime's tag goes in on the way out, once, before the last
   </body> (at the end when there is none). Without a #rv-forms block the runtime fetches the event's forms
   itself. */
function ensureFormsRuntime(html) {
  html = String(html == null ? '' : html);
  if (html.indexOf('/templates/_shared/rv-forms.js') !== -1) return html;
  var at = html.toLowerCase().lastIndexOf('</body');
  return at === -1 ? html + FORMS_RUNTIME_TAG + '\n' : html.slice(0, at) + FORMS_RUNTIME_TAG + '\n' + html.slice(at);
}

/* ===== BANNER VIDEO (lib/api-hero-video.js stores it; templates/_shared/rv-hero-video-core.js has the markup) =====
   applyHeroVideo(html, event) -> html. The event's banner video (event.heroVideo), put on a page as it is SERVED —
   /e/<id>, /preview/<id> and the editor's live view — never into what is stored, so turning it on, off or changing
   its overlay in the console reaches the live site within a minute without a publish. Idempotent: what an
   earlier run wrote (data-rv-hero-video) is taken out first.
     - a real template's ET banner: the video goes into its .bnr-bg-video layer (cleared first), the banner's
       picture becomes the video's still (the page's largest picture, so it loads first), its overlay layer takes
       the overlay colour;
     - an AI-designed hero (section#hero.hero-root): a layer of its own goes in first — the still, the video, the
       overlay — in place of the hero's picture and veil;
     - anything else: nothing (the console says such a site has no place for one).
   A video an AI edit wrote into the hero to play by itself (<video autoplay src>) is made to wait the same way
   (data-rv-bg-video, its address in data-rv-src): it used to be downloaded in full on every visit, phones
   included, before the page had finished. With the event's own video on, it is replaced. rv-hero-video.js,
   added once, starts and stops them all. */
var heroVideoCore = require('../../templates/_shared/rv-hero-video-core.js');
var HERO_VIDEO_TAG = '<script src="/templates/_shared/rv-hero-video.js" defer data-rv-hero-video></script>';
/* an attribute whose value is already as the page had it (entities and all): only a quote is made safe */
function rawAttr(name, value) {
  var v = String(value == null ? '' : value).replace(/"/g, '&quot;');
  return { name: name, value: v, raw: name + '="' + v + '"' };
}
function heroVideoStamp(event) {
  var hv = heroVideoCore.clean(event && event.heroVideo);
  return hv ? 'v:' + (hv.stamp || 'on') : 'v:off';
}
function applyHeroVideo(html, event) {
  html = String(html == null ? '' : html);
  var hv = heroVideoCore.clean(event && event.heroVideo);
  if (!hv && !/<video\b/i.test(html) && html.indexOf('data-rv-hero-video') === -1) return html;
  var tokens = tokenizeHtml(html);
  var out = tokens.map(function (t) { return html.slice(t.s, t.e); });
  var headOpen = -1, headClose = -1, bodyClose = -1, banner = -1, still = -1, hero = -1, i;
  for (i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t === 'open' && t.name === 'head' && headOpen === -1) headOpen = i;
    if (t.t === 'close' && t.name === 'head' && headClose === -1) headClose = i;
    if (t.t === 'close' && t.name === 'body') bodyClose = i;
    if (t.t !== 'open' || out[i] === '') continue;
    if (attrOf(t, 'data-rv-hero-video')) {
      var end = elementEnd(tokens, i);
      if (end !== -1) {
        for (var k = i; k <= end; k++) out[k] = '';
        /* with the one newline this wrote after it, so a second run leaves the same bytes */
        var after = tokens[end + 1];
        if (after && after.t === 'text' && out[end + 1].charAt(0) === '\n') out[end + 1] = out[end + 1].slice(1);
        i = end;
      }
      continue;
    }
    var cls = classListOf(t);
    if (banner === -1 && (attrValue(t, 'data-rv-media') === 'bg-video' || cls.indexOf('bnr-bg-video') !== -1)) banner = i;
    if (still === -1 && t.name === 'img' && cls.indexOf('banner-bg-image') !== -1) still = i;
    if (hero === -1 && t.name === 'section' && (attrValue(t, 'id') === 'hero' || cls.indexOf('hero-root') !== -1)) hero = i;
  }
  var look = heroVideoCore.looksAt(html), place = banner !== -1 ? 'banner' : hero !== -1 ? 'hero' : '';
  var lazyfied = false;

  /* videos an AI edit wrote into the hero */
  if (hero !== -1 && place === 'hero') {
    var heroEnd = elementEnd(tokens, hero);
    for (i = hero + 1; heroEnd !== -1 && i < heroEnd; i++) {
      var v = tokens[i];
      if (v.t !== 'open' || v.name !== 'video' || out[i] === '') continue;
      var vEnd = elementEnd(tokens, i);
      if (hv) { if (vEnd !== -1) { for (var r = i; r <= vEnd; r++) out[r] = ''; i = vEnd; } continue; }
      /* one made to wait already (a page this ran on before) still needs its loader */
      if (attrOf(v, 'data-rv-bg-video')) { if (attrOf(v, 'data-rv-src')) lazyfied = true; continue; }
      if (!attrOf(v, 'autoplay')) continue;
      var src = attrValue(v, 'src') || '', type = '';
      for (var s = i + 1; vEnd !== -1 && s < vEnd; s++) {
        var so = tokens[s];
        if (so.t !== 'open' || so.name !== 'source' || !attrOf(so, 'src')) continue;
        if (!src) { src = attrValue(so, 'src'); type = attrValue(so, 'type') || ''; }
        var sv = attrValue(so, 'src') || '';
        dropAttr(so, 'src');
        so.attrs.push(rawAttr('data-rv-src', sv));
        out[s] = writeTag(so);
      }
      if (!src) continue;
      ['autoplay', 'src', 'preload', 'data-rv-src'].forEach(function (a) { dropAttr(v, a); });
      v.attrs.push(rawAttr('data-rv-src', src));
      if (type && !attrOf(v, 'data-type')) setAttr(v, 'data-type', type);
      ['muted', 'playsinline', 'data-rv-bg-video'].forEach(function (a) { if (!attrOf(v, a)) v.attrs.push({ name: a, value: null, raw: a }); });
      /* it has no still picture of its own, so its first frame is the page's largest picture: where it plays at
         all it starts at once, as it did (started late, it would make the page's largest paint late) */
      if (!attrValue(v, 'poster')) v.attrs.push(rawAttr('data-rv-bg-start', 'early'));
      setAttr(v, 'preload', 'none');
      out[i] = writeTag(v);
      lazyfied = true;
    }
  }

  var head = [];
  if (hv && place) {
    var overlay = heroVideoCore.overlayFor(hv.overlay, look);
    /* a colour chosen for the site as it was (another tone since, after a redesign) never makes its words
       unreadable: the automatic overlay stands in, and the console says the colour is not used */
    if (!overlay.readable) overlay = heroVideoCore.overlayFor({ mode: 'auto' }, look);
    if (place === 'banner') {
      var bannerEnd = elementEnd(tokens, banner);
      if (bannerEnd !== -1) for (i = banner + 1; i < bannerEnd; i++) out[i] = '';
      out[banner] = out[banner] + heroVideoCore.videoTag(hv);
      if (hv.posterUrl && still !== -1) {
        var img = tokens[still];
        setAttr(img, 'src', hv.posterUrl);
        dropAttr(img, 'srcset'); dropAttr(img, 'sizes');
        setAttr(img, 'fetchpriority', 'high'); setAttr(img, 'loading', 'eager');
        out[still] = writeTag(img);
      }
    } else {
      setAttr(tokens[hero], 'data-rv-hv', '');
      out[hero] = writeTag(tokens[hero]) + heroVideoCore.heroLayer(hv);
    }
    if (hv.posterUrl) head.push('<link rel="preload" as="image" href="' + escHtmlAttr(hv.posterUrl) + '" fetchpriority="high" data-rv-hero-video>');
    head.push('<style data-rv-hero-video>' + heroVideoCore.pageCss({ host: place, overlay: overlay, poster: !!hv.posterUrl }) + '</style>');
  } else if (lazyfied) {
    head.push('<style data-rv-hero-video>@media (prefers-reduced-motion:reduce){[data-rv-bg-video]{display:none!important}}</style>');
  }
  if (!head.length) return out.join('');
  var headText = head.join('\n') + '\n';
  if (headClose !== -1) out[headClose] = headText + out[headClose];
  else if (headOpen !== -1) out[headOpen] = out[headOpen] + headText;
  else out.unshift(headText);
  if (bodyClose !== -1) out[bodyClose] = HERO_VIDEO_TAG + '\n' + out[bodyClose];
  else out.push(HERO_VIDEO_TAG + '\n');
  return out.join('');
}
/* ===== END BANNER VIDEO ===== */
/* A served page (/e/, /preview/) with the event's banner video as it is now (applyHeroVideo), and then its
   pictures' WebP copies once more (heroVideoPictures): the video's still is a picture the stored page never
   named, and a banner picture the still replaced lost its copies. Never rejects (pictures.prepare does not). */
function withHeroVideo(fb, page, event) {
  var withVideo = applyHeroVideo(page, event);
  if (withVideo === page) return Promise.resolve(page);
  return pictures.prepare(fb, withVideo).then(function (pics) { return heroVideoPictures(withVideo, pics); });
}
/* (pure) page with the banner video -> the same with the still's WebP copy, the still's preload naming the
   very file the page will show (not the original as well), and an AI hero's own background preload taken out
   where the still covers it (its background is not drawn then: rv-hero-video-core.js pageCss) */
function heroVideoPictures(page, pics) {
  var out = pictures.rewriteHtml(page, pics);
  if (out.indexOf('<section') !== -1 && /<section\b[^>]*\sdata-rv-hv(?:[\s=>])/i.test(out) && /<link\b[^>]*\bdata-rv-hero-video\b/i.test(out)) {
    out = out.replace(/\n?<link\b[^>]*\bdata-rv-pictures-preload\b[^>]*>/i, '');
  }
  return out.replace(/<link rel="preload" as="image" href="([^"]*)" fetchpriority="high" data-rv-hero-video>/, function (tag, href) {
    var url = href.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    var webp = pictures.fullCopyUrl(pics, url);
    return webp ? '<link rel="preload" as="image" type="image/webp" href="' + escHtmlAttr(webp) + '" fetchpriority="high" data-rv-hero-video>' : tag;
  });
}

/* The event's public form definitions for a page about to be transformed (opts.forms), or null when they
   cannot be read — the failure is logged and the page goes out without them: its runtime fetches them.
   lib/api-forms.js is loaded here, on use, like the other route modules (see inModule). Never rejects. */
function publicFormsFor(fb, eventId, ev) {
  return Promise.resolve().then(function () {
    return require('./api-forms').loadPublicForms(fb, eventId, ev || {});
  }).catch(function (err) {
    console.error('api: the forms of ' + eventId + ' could not be read for its page — ' + ((err && err.message) || err));
    return null;
  });
}
/* [page, …] -> [page, …, the WebP copies of the page's pictures] (pictures.prepare, which never rejects:
   a failure leaves the pictures as they are) */
function withPictures(fb) {
  return function (got) {
    return pictures.prepare(fb, got[0]).then(function (pics) { return got.concat([pics]); });
  };
}
var RUNTIME_STYLE = /\/templates\/_shared\/rv-live\.css$/;
var SITE_FAVICON = '/assets/et-b2b-logo.svg';

function urlPathOnly(url) { return String(url || '').replace(/[?#].*$/, ''); }

/* A real template's content.map (templates/<templateId>/template.json), which the live runtime needs to
   put the event's records into that template's own markup. AI-designed sites and imports have none: they
   bind by the data-rv-* convention instead. Read from disk once per file version; any problem — an id
   that is not a real template, a file that is missing in this deployment or does not parse — means
   "no map", and the page is still published. */
var TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');
var contentMapCache = {};
function contentMapFor(templateId) {
  if (typeof templateId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(templateId) || /^(gen|imported)-/.test(templateId)) return null;
  try {
    var file = path.join(TEMPLATES_DIR, templateId, 'template.json');
    var mtime = fs.statSync(file).mtimeMs, hit = contentMapCache[templateId];
    if (hit && hit.mtime === mtime) return hit.map;
    var json = JSON.parse(fs.readFileSync(file, 'utf8'));
    var map = json && json.content && Array.isArray(json.content.map) ? json.content.map : null;
    contentMapCache[templateId] = { mtime: mtime, map: map };
    return map;
  } catch (e) { return null; }
}

/* opts: { eventId, event (the event document), mode: 'live' | 'preview', templateId, origins: [],
           publicBase: 'https://host' or '', forms: the event's public form definitions (lib/forms.js
           publicFormsPayload; optional — without it the forms runtime fetches them),
           pictures: the WebP copies of the page's pictures (pictures.prepare; optional — without it the
           pictures are left as they are) } */
function publishTransform(html, opts) {
  var tokens = tokenizeHtml(html);
  var out = tokens.map(function (t) { return html.slice(t.s, t.e); });
  var event = opts.event || {}, mode = opts.mode === 'preview' ? 'preview' : 'live';
  var origins = (opts.origins || []).concat(detectSavingOrigins(tokens));

  var headOpen = -1, headClose = -1, bodyOpen = -1, bodyClose = -1, htmlOpen = -1, i;
  for (i = 0; i < tokens.length; i++) {
    var tk = tokens[i];
    if (tk.t === 'open' && tk.name === 'html' && htmlOpen === -1) htmlOpen = i;
    if (tk.t === 'open' && tk.name === 'head' && headOpen === -1 && bodyOpen === -1) headOpen = i;
    if (tk.t === 'close' && tk.name === 'head' && headClose === -1 && headOpen !== -1 && bodyOpen === -1) headClose = i;
    if (tk.t === 'open' && tk.name === 'body' && bodyOpen === -1) bodyOpen = i;
    if (tk.t === 'close' && tk.name === 'body') bodyClose = i;
  }
  var inHead = function (idx) { return headOpen !== -1 && idx > headOpen && (headClose === -1 ? (bodyOpen === -1 || idx < bodyOpen) : idx < headClose); };
  /* a site with internal pages (site-pages.js, templates/_shared/rv-pages.js): its page list; [] for a one-page site */
  var sitePageList = sitePages._pagesFromTokens(html, tokens, TOKEN_KIT);

  /* Removes the element starting at tokens[idx]; returns the index of its last token, or idx when its
     end could not be found (nothing removed). `ours` also takes the one newline we wrote after it. */
  function removeElement(idx, ours) {
    var end = elementEnd(tokens, idx);
    if (end === -1) return idx;
    for (var k = idx; k <= end; k++) out[k] = '';
    var after = tokens[end + 1];
    if (ours && after && after.t === 'text' && out[end + 1].charAt(0) === '\n') out[end + 1] = out[end + 1].slice(1);
    return end;
  }

  /* ---- 1. what only the editor, the AI review or a browser extension put there ---- */
  for (i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    /* HTML comments are notes from whoever wrote the markup to whoever maintains it — the shared
       header/footer files and the section library open with paragraphs naming this server's source
       files — and every published page carried them to the public. A comment never renders, so none
       is needed on a live page; the one kind a browser acts on (a conditional comment) is kept. */
    if (t.t === 'comment') { if (!/^<!--\[if\b|<!\[endif\]-->$/i.test(out[i])) out[i] = ''; continue; }
    if (t.t !== 'open' || out[i] === '') continue;
    var classes = classListOf(t);
    /* a copyright year (ET's common footer, et-footer.js: <span data-rv-year>2026</span>) is this year's on
       every publish, so a site made in one year and published in the next does not show the old one. Only a
       bare year is replaced: anything else the owner wrote there stays. */
    if (attrOf(t, 'data-rv-year') && tokens[i + 1] && tokens[i + 1].t === 'text' && /^\s*(?:19|20)\d{2}\s*$/.test(out[i + 1]) &&
        tokens[i + 2] && tokens[i + 2].t === 'close' && tokens[i + 2].name === t.name) {
      out[i + 1] = String(+opts.year > 2000 ? +opts.year : new Date().getFullYear());
    }

    /* data-rv-seo: the search and sharing tags of step 7 (site-a11y.js), written afresh there */
    if (attrOf(t, 'data-rv-head') || attrOf(t, 'data-rv-runtime') || attrOf(t, 'data-rv-preview-ribbon') || attrOf(t, 'data-rv-seo')) { i = removeElement(i, true); continue; }
    if (attrOf(t, 'data-rv-editor') || attrOf(t, 'data-rv-empty-state') || attrOf(t, 'data-rv-bind-hint') || t.name === 'grammarly-desktop-integration' || attrOf(t, 'data-grammarly-shadow-root') ||
        classes.some(function (c) { return AI_BADGE_CLASSES.indexOf(c) !== -1; })) { i = removeElement(i, false); continue; }
    /* the "SHARED HEADER / FOOTER — DESIGN TO COME" strips the template loader used to put on every
       page: scaffolding for the template authors, baked into pages saved before it was removed. They go
       whatever they say — a strip whose text was edited or emptied is still a fixed bar across a live
       site. There is no shared header or footer design; when there is one it must not reuse these marks. */
    var locked = attrValue(t, 'data-rv-locked');
    if (classes.indexOf('rv-slot-header') !== -1 || classes.indexOf('rv-slot-footer') !== -1 || locked === 'header' || locked === 'footer') { i = removeElement(i, false); continue; }
    /* a section the owner switched off in the editor (its video could not be shown) */
    if (attrOf(t, 'data-rv-video-off')) { i = removeElement(i, false); continue; }
    /* an earlier copy of the runtime or of its config: step 4 writes the one that counts */
    if (t.name === 'script' && (attrValue(t, 'id') === 'rv-site-config' || attrValue(t, 'id') === 'rv-forms' || RUNTIME_SCRIPT.test(urlPathOnly(attrValue(t, 'src'))))) { i = removeElement(i, false); continue; }
    if (t.name === 'link' && RUNTIME_STYLE.test(urlPathOnly(attrValue(t, 'href')))) { i = removeElement(i, false); continue; }
    /* head tags step 3 is about to write: a page has one description, one canonical link, one icon */
    if (inHead(i)) {
      var metaName = (attrValue(t, 'name') || '').toLowerCase(), metaProp = (attrValue(t, 'property') || '').toLowerCase();
      var rel = (attrValue(t, 'rel') || '').toLowerCase().split(/\s+/);
      if ((t.name === 'meta' && (metaName === 'description' || /^twitter:/.test(metaName) || /^og:/.test(metaProp))) ||
          (t.name === 'link' && (rel.indexOf('canonical') !== -1 || rel.indexOf('icon') !== -1))) { i = removeElement(i, false); continue; }
    }

    var changed = false;
    EDITOR_ONLY_ATTRS.forEach(function (a) { if (dropAttr(t, a)) changed = true; });
    /* every AI-review mark, including ones a later editor version adds */
    if (t.attrs.some(function (a) { return a.name.indexOf('data-ai-') === 0; })) {
      t.attrs = t.attrs.filter(function (a) { return a.name.indexOf('data-ai-') !== 0; });
      changed = true;
    }
    /* items the editor opened for editing (an accordion, a tab): put them back as the site has them,
       exactly as editor-canvas.js's unopen() does */
    var opened = attrOf(t, 'data-rv-open');
    if (opened) { classes = classes.filter(function (c) { return c !== opened.value; }); dropAttr(t, 'data-rv-open'); changed = true; }
    var aria = attrOf(t, 'data-rv-aria');
    if (aria) { setAttr(t, 'aria-expanded', aria.value || 'false'); dropAttr(t, 'data-rv-aria'); changed = true; }
    var kept = classes.filter(function (c) { return EDITOR_ONLY_CLASSES.indexOf(c) === -1; });
    if (opened || kept.length !== classes.length) {
      if (kept.length) setAttr(t, 'class', kept.join(' ')); else dropAttr(t, 'class');
      changed = true;
    }
    /* the page reports visits and registrations under THIS event, whatever the template or the event it
       was copied from wrote there */
    if (t.name === 'body' && opts.eventId && attrValue(t, 'data-rv-event-id') !== opts.eventId) { setAttr(t, 'data-rv-event-id', opts.eventId); changed = true; }
    if (changed) out[i] = writeTag(t);
  }

  /* ---- 2. the saving origin becomes root-relative ---- */
  rewriteOriginTokens(html, tokens, out, origins);
  /* an AI-designed site: no section heading louder than the site's type scale (genDesign.capHeadingSizes —
     idempotent), so a page saved before the scale was calmed is calm in the preview and when it is published.
     Only the sections' own stylesheets; the hero banner keeps its own type. Every section, the hero too, is held
     to a phone's width (mobileSafeCss — idempotent): a page saved before that is put right the same way; the top bar
     and the footer are left as the server built them for phones. */
  var bodyTag = bodyOpen !== -1 ? tokens[bodyOpen] : null;
  if (/^gen-/.test(String(opts.templateId || '')) || (bodyTag && (/^gen-/.test(attrValue(bodyTag, 'data-rv-template-id') || '') || classListOf(bodyTag).indexOf('rv-generated') !== -1))) {
    var headingMap = null;
    for (i = 0; i < tokens.length - 1; i++) {
      var sheet = tokens[i], sheetId = sheet.t === 'open' && sheet.name === 'style' ? attrValue(sheet, 'data-rv-style') : null;
      if (sheetId == null || out[i] === '' || tokens[i + 1].t !== 'raw') continue;
      if (sheetId !== 'hero') {
        if (!headingMap) headingMap = genDesign.headingClasses(html);
        out[i + 1] = genDesign.capHeadingSizes(out[i + 1], headingMap);
      }
      /* the top bar and the footer are built for phones by the server (et-nav.js, et-footer.js) */
      if (sheetId !== 'nav' && sheetId !== 'footer') out[i + 1] = mobileSafeCss(out[i + 1]);
    }
  }

  /* ---- 3. title, description, sharing tags, canonical link, favicon ---- */
  var seo = (event.settings && event.settings.seo) || {};
  var name = typeof event.name === 'string' ? event.name.trim() : '';
  /* the description's headings are the owner's brief, not a summary to show (owner-brief.js): their free
     text, else what the owner said sets the event apart */
  var ownerUsp = event.designPlan && event.designPlan.owner && event.designPlan.owner.usp;
  var description = String(seo.description || ownerBrief.withoutHeadings(event.description) || ownerUsp || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!description && name) {
    /* nothing written for it yet: say what is known (when and where), so a shared link is not a bare title */
    var facts = [event.dateLabel, event.venue, event.city].map(function (v) { return typeof v === 'string' ? v.trim() : ''; }).filter(Boolean);
    if (facts.length) description = (name + ' — ' + facts.join(', ')).slice(0, 300);
  }
  var pageUrl = mode === 'live' ? (cleanCanonical(seo.canonicalUrl) || (opts.publicBase ? opts.publicBase + publicPathOf(opts.eventId) : '')) : '';
  var shareImage = String(seo.shareImageUrl || '').trim();
  if (shareImage.charAt(0) === '/' && opts.publicBase) shareImage = opts.publicBase + shareImage;

  var head = [], titleDone = !name;
  if (name) {
    for (i = 0; i < tokens.length && !titleDone; i++) {
      if (!(inHead(i) || (bodyOpen !== -1 && i < bodyOpen))) continue;
      if (tokens[i].t !== 'open' || tokens[i].name !== 'title' || out[i] === '') continue;
      if (tokens[i + 1] && tokens[i + 1].t === 'raw') out[i + 1] = escHtmlText(name);
      else out[i] += escHtmlText(name);
      titleDone = true;
    }
    if (!titleDone) head.push('<title data-rv-head>' + escHtmlText(name) + '</title>');
  }
  function meta(attr, key, value) { if (value) head.push('<meta ' + attr + '="' + key + '" content="' + escHtmlAttr(value) + '" data-rv-head>'); }
  meta('name', 'description', description);
  if (pageUrl) head.push('<link rel="canonical" href="' + escHtmlAttr(pageUrl) + '" data-rv-head>');
  meta('property', 'og:type', 'website');
  meta('property', 'og:title', name);
  meta('property', 'og:description', description);
  meta('property', 'og:url', pageUrl);
  meta('property', 'og:image', shareImage);
  meta('name', 'twitter:card', shareImage ? 'summary_large_image' : 'summary');
  if (mode === 'preview') meta('name', 'robots', 'noindex, nofollow');
  /* the tab icon is the event's own logo when it has one (an uploaded picture, so a web address or a
     path on this host), the ET mark otherwise */
  var logo = typeof event.logoUrl === 'string' ? event.logoUrl.trim() : '';
  if (/^(https?:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/i.test(logo)) head.push('<link rel="icon" href="' + escHtmlAttr(logo) + '" data-rv-head>');
  else head.push('<link rel="icon" type="image/svg+xml" href="' + SITE_FAVICON + '" data-rv-head>');
  head.push('<link rel="stylesheet" href="/templates/_shared/rv-live.css" data-rv-runtime>');
  /* internal pages: the rule that shows the page <html data-rv-current-page> names, in <head> so that the right page
     shows at once and with no script (the address of each page sets it: sitePages.selectPage) */
  if (sitePageList.length) head.push('<style id="rv-pages-css" data-rv-runtime>' + sitePages.pagesCss(sitePageList).replace(/\n$/, '') + '</style>');

  /* ---- 4. the live-site runtime and its config, exactly once ---- */
  var contentMap = contentMapFor(opts.templateId);
  var config = { eventId: opts.eventId, mode: mode, templateId: opts.templateId || null, contentMap: contentMap || [] };
  /* "<" must not appear inside the block: "</script" in a field's text would end it early */
  var tail = ['<script id="rv-site-config" type="application/json" data-rv-runtime>' + scriptJson(config) + '</script>'];
  /* the event's forms as they are now — a live page's runtime asks for them again anyway (they change
     without a republish); the preview and the editor's live view use these */
  if (opts.forms) tail.push('<script id="rv-forms" type="application/json" data-rv-runtime>' + scriptJson(opts.forms) + '</script>');
  if (contentMap) tail.push('<script src="/editor-fill.js" data-rv-runtime></script>');
  tail.push('<script src="/templates/_shared/rv-data.js" data-rv-runtime></script>');
  /* internal pages: page links, changing page in place (templates/_shared/rv-pages.js) — only on a site that has them */
  if (sitePageList.length) tail.push('<script src="/templates/_shared/rv-pages.js" data-rv-runtime></script>');
  /* a speaker's profile and a gallery's photos, in a pop-up — on the visitor's page only, never in the editor */
  tail.push('<script src="/templates/_shared/rv-popups.js" data-rv-runtime></script>');
  /* an award site's lifecycle buttons: their words and what they open, by the award's dates (before the forms
     runtime, which then opens the form a button names) */
  if (AWARD_CTA_MARK.test(html)) tail.push(AWARD_CTA_TAG);
  /* the forms: a button's form in a pop-up, a form placed in the page */
  tail.push(FORMS_RUNTIME_TAG);
  /* visit counting (rv-live.js) — the slot is kept; left out while that file is not part of this release, so
     a live page does not ask every visitor's browser for something that answers 404 */
  if (LIVE_RUNTIME_PRESENT) tail.push('<script src="/templates/_shared/rv-live.js" data-rv-runtime></script>');
  /* ---- section edges (templates/_shared/rv-blend.js) ----
     The site's choice, designPlan.design.sectionEdges: "sharp" keeps a straight line between sections; anything
     else (or nothing) fades a section's colour into the next one (sectionEdgesOf). It is written on <html data-rv-edges>, which the
     runtime reads (and the preview's "Section edges" choice changes in place). An imported site is always
     sharp. The runtime is on every preview, so the choice can be tried there; on a published page only when
     the site is smooth. */
  var edgesDesign = event.designPlan && event.designPlan.design;
  var edgesImported = /^import(?:ed)?-/.test(String(opts.templateId || event.templateId || ''));
  var edges = !edgesImported && !(edgesDesign && edgesDesign.sectionEdges === 'sharp') ? 'smooth' : 'sharp';
  if (htmlOpen !== -1) { setAttr(tokens[htmlOpen], 'data-rv-edges', edges); out[htmlOpen] = writeTag(tokens[htmlOpen]); }
  if (!edgesImported && (mode === 'preview' || edges === 'smooth')) tail.push('<script src="/templates/_shared/rv-blend.js?v=' + BLEND_RUNTIME_V + '" data-rv-runtime></script>');
  /* ---- end section edges ---- */

  /* ---- 5. preview ribbon ---- */
  var liveView = mode === 'preview' && opts.liveView === true;
  var ribbon = mode === 'preview' && !liveView
    ? '<div data-rv-preview-ribbon style="position:fixed;left:0;right:0;bottom:0;z-index:2147483000;padding:7px 12px;background:#191b1f;color:#fff;font:600 12px/1.4 Inter,Arial,sans-serif;letter-spacing:.04em;text-align:center;pointer-events:none">Preview — not published</div>'
    : '';

  var headText = head.join('\n') + '\n', tailText = tail.join('\n') + '\n';
  /* where each block goes; a page without <head> or </body> still gets everything, in the nearest
     place a browser will accept it. Every inserted line ends with the one newline that removeElement()
     takes away again with it — never a newline in front — so a second run leaves the same bytes. */
  var prefix = '', suffix = '';
  if (headClose !== -1) out[headClose] = headText + out[headClose];
  else if (bodyOpen !== -1) out[bodyOpen] = headText + out[bodyOpen];
  else if (htmlOpen !== -1) out[htmlOpen] = out[htmlOpen] + headText;
  else prefix = headText;
  if (ribbon) { if (bodyOpen !== -1) out[bodyOpen] = out[bodyOpen] + ribbon + '\n'; else tailText = ribbon + '\n' + tailText; }
  /* ---- 6. preview of an AI-designed site: its themes, to try on the page itself; and the way back into the
     editor, at the section in view. Neither is on a published page, nor in the editor's own live view. ---- */
  var switcher = mode === 'preview' && !liveView ? themeSwitcherHtml(opts.event, opts.eventId, opts.templateId) : '';
  if (switcher) tailText += switcher;
  if (mode === 'preview' && !liveView && opts.editButton === true) tailText += '<script src="/templates/_shared/rv-preview-edit.js" data-rv-runtime></script>\n';
  /* the editor's live view: the one signal runtime code reads to know it is there (et-runtime.js) */
  if (liveView && htmlOpen !== -1) {
    setAttr(tokens[htmlOpen], 'data-rv-editor-mode', 'ai');
    out[htmlOpen] = writeTag(tokens[htmlOpen]);
  }
  if (bodyClose !== -1) out[bodyClose] = tailText + out[bodyClose];
  else suffix = tailText;

  /* ---- 7. pictures: each one's WebP copies, its size, the hero's first (pictures.js) ---- */
  var page = prefix + out.join('') + suffix;
  if (opts.pictures) page = pictures.rewriteHtml(page, opts.pictures);
  /* ---- 8. accessibility and search (site-a11y.js pagePass): zoom, readable colours on an AI-designed site,
     alt text, the outline of headings, the main landmark, the schema.org Event and a link-preview picture ---- */
  page = siteA11y.pagePass(page, { mode: mode, event: event, templateId: opts.templateId }, TOKEN_KIT);
  /* ---- 9. internal pages: each page link's address, so the pages work with no script ---- */
  if (sitePageList.length && opts.eventId) page = sitePages.setPageLinks(page, mode === 'live' ? publicPathOf(opts.eventId) : '/preview/' + opts.eventId, TOKEN_KIT);
  return page;
}
/* the tokenizer above, for site-a11y.js's page pass */
var TOKEN_KIT = { tokenizeHtml: tokenizeHtml, attrOf: attrOf, attrValue: attrValue, classListOf: classListOf, writeTag: writeTag,
  setAttr: setAttr, dropAttr: dropAttr, elementEnd: elementEnd };

function cleanCanonical(v) { return (typeof v === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(v.trim())) ? v.trim() : ''; }

/* ---------- POST /api/event/publish ----------
   Body { eventId } -> 200 { publishedPath, publishedUrl, publishedAt, publishedVersion }.
   Publishes the site as last SAVED (PUT /api/event/site): 409 { code: 'site-not-saved' } when it never
   was. Because it works from the saved copy, it does the same thing from the editor, from the console
   and from any browser — the page that goes live no longer depends on whose IndexedDB the click came from.

   For one release a body that still carries `html` is accepted, because browsers will keep running the
   previous editor script for a while after this deploys: it is treated as "save this page, then publish
   it". Such a save has no snapshot, so site.version moves on while site.snapshotVersion stays (see
   handleSiteGet).

   The live page is never taken down and a failure leaves no trace:
     - the new page replaces the Storage object in ONE request (the old two-step "save, then make public"
       is what made every re-publish answer 403 for a moment, and for good if the second step failed);
     - /e/<id> does not read a public object at all any more, so there is no ACL to lose;
     - if recording the publish on the event fails after the object was replaced, the previous object is
       put back, so the page and the published* fields still describe the same publish. */
function handleEventPublish(req, res) {
  withAdminBody(req, res, BODY_LIMITS.site, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    if (body.html != null && typeof body.html !== 'string') return sendJson(res, 400, { error: '"html" must be the page as text.' });
    var legacyHtml = typeof body.html === 'string' && body.html.trim() ? body.html : null;
    var base = publicBaseFor(req, body.origin);
    /* nothing goes live without an approval, unless approval has been switched off (config/approvals). This
       check is always made: nothing in the request can skip it (a body key "__approvalChecked" used to). */
    return approvalsConfig(fb).then(function (cfg) {
      if (cfg.required) {
        return sendJson(res, 409, { error: 'Changes go live once they are approved. Save the site, then use “Publish changes” to send it for approval.', code: 'approval-required' });
      }
      publishAfterCheck();
    }).catch(function (err) { sendFailure(res, 'publish', err, 'The site could not be published. Please try again.'); });
    function publishAfterCheck() {
    var token = crypto.randomBytes(12).toString('hex'), actor = actorOf(decoded), now = new Date().toISOString();
    var HTML = 'text/html; charset=utf-8';

    acquireSiteLock(fb, eventId, token, function (data) {
      if (legacyHtml || siteVersionOf(data)) return null;
      return httpError(409, 'This site has not been saved yet. Open the site editor, make sure it says "Saved", then publish.', { code: 'site-not-saved' });
    }).then(function (data) {
      var undo = [];                                            // what to put back if a later step fails
      var previousSite = data.site || {}, changes = {}, livePages = null;
      var version = siteVersionOf(data), page;

      if (legacyHtml) {
        version += 1;
        var pagePath = sitePath(eventId, 'page.html');
        var stored = rewriteOrigins(legacyHtml, [cleanOrigin(body.origin)]);
        changes.site = {
          version: version, snapshotVersion: previousSite.snapshotVersion != null ? previousSite.snapshotVersion : siteVersionOf(data),
          templateId: previousSite.templateId || data.templateId || null, updatedAt: now, updatedBy: actor
        };
        page = readObject(fb, pagePath).then(function (before) {
          /* registered before the write, not after it: an upload can reach Storage and still be
             reported to us as failed, and the earlier object must come back in that case too */
          undo.push(function () { return restoreObject(fb, pagePath, before, HTML); });
          return saveObject(fb, pagePath, stored, HTML).then(function () { return stored; });
        });
      } else {
        page = readObject(fb, sitePath(eventId, 'page.html')).then(function (text) {
          if (text == null) throw httpError(409, 'The saved site could not be found. Open the site editor and save it again, then publish.', { code: 'site-not-saved' });
          return text;
        });
      }

      return Promise.all([page, publicFormsFor(fb, eventId, data)]).then(withPictures(fb)).then(function (got) {
        var pageHtml = got[0], livePath = publishedObjectPath(eventId);
        var live = publishTransform(pageHtml, {
          eventId: eventId, event: data, mode: 'live', publicBase: base, forms: got[1], pictures: got[2],
          templateId: (changes.site || previousSite).templateId || data.templateId, origins: [cleanOrigin(body.origin)]
        });
        livePages = publishedPagesOf(live);
        return readObject(fb, livePath).then(function (before) {
          undo.push(function () { return restoreObject(fb, livePath, before, HTML); });
          return saveObject(fb, livePath, live, HTML);
        });
      }).then(function () {
        return commitSiteLock(fb, eventId, token, Object.assign(changes, {
          published: true, publishedAt: now, publishedBy: actor, publishedVersion: version,
          publishedPath: publicPathOf(eventId), publishedUrl: fieldDelete(), updatedAt: now, publishedPages: livePages
        }));
      }).then(function () {
        forgetCachedPage(eventId);
        sendJson(res, 200, {
          publishedPath: publicPathOf(eventId), publishedUrl: base + publicPathOf(eventId),
          publishedAt: now, publishedVersion: version
        });
        logActivity(fb, eventId, decoded, 'published', 'version ' + version);
      }, function (err) {
        return Promise.all(undo.map(function (step) { return step(); }))
          .then(function () { forgetCachedPage(eventId); return releaseSiteLock(fb, eventId, token); })
          .then(function () { throw err; });
      });
    }).catch(function (err) { sendFailure(res, 'publish', err, 'The site could not be published. The page that was live before is unchanged. Please try again.'); });
    }
  });
}

/* =====================================================================================================
   SAVE -> STAGING -> APPROVAL -> LIVE, and the history of it
   ---------------------------------------------------------------------------------------------------
   Save (PUT /api/event/site) stores the site as a new version, keeps that version's page for good
   (site/versions/<n>/page.html), puts it on the staging address and records what changed against the
   version before it (events/<id>/changes/<auto>: who, when, section by section, before and after).

   Publishing is never direct. "Publish changes" asks for approval (POST /api/event/approval/request): one
   request covers everything saved since what is live, however many saves by however many people — a second
   request while one is waiting updates it. The request names every change and who made it, and has one
   address a reviewer opens (/review.html?event=…&request=…) to see the changes listed and the live page
   beside the proposed one. Approving (POST /api/event/approval/decide) is what makes that exact version
   live; rejecting sends it back with the reason.

   Who may approve (config/approvals): `approvers`, a list of e-mail addresses — empty means any signed-in
   member of the team; and never the person who asked, unless `allowSelf` is true. `required: false` turns
   approval off and lets Publish go live at once.

   Everything above is written to the event's history (events/<id>/activity) with the change or the request
   it belongs to; GET /api/event/history answers the history with those attached. ===================== */
function draftObjectPath(eventId, decoded) {
  return sitePath(eventId, 'drafts/' + String((decoded && decoded.uid) || 'anon').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) + '.html');
}
function versionPath(eventId, version) { return sitePath(eventId, 'versions/' + version + '/page.html'); }

function approvalsConfig(fb) {
  return fb.db.collection('config').doc('approvals').get().then(function (snap) {
    var d = snap.exists ? (snap.data() || {}) : {};
    return {
      approvers: (Array.isArray(d.approvers) ? d.approvers : []).map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }),
      allowSelf: d.allowSelf === true,
      required: d.required !== false
    };
  });
}
/* '' when `email` may decide a request made by `requestedBy`, else the reason it may not */
function whyNotApprover(cfg, email, requestedBy) {
  email = String(email || '').toLowerCase();
  if (cfg.approvers.length && cfg.approvers.indexOf(email) === -1) return 'Only ' + cfg.approvers.join(', ') + ' can approve changes.';
  if (!cfg.allowSelf && email === String(requestedBy || '').toLowerCase()) return 'You sent these changes for approval, so someone else has to approve them.';
  return '';
}

function reviewPathOf(eventId, id) { return '/review.html?event=' + encodeURIComponent(eventId) + '&request=' + encodeURIComponent(id); }

/* After a save: keeps the version's page, puts it on staging, and records what changed. Never the reason
   a save fails — what it cannot do is logged, and the save stands. -> { changeId, summary, items } */
function recordSave(fb, eventId, decoded, version, beforeHtml, pageHtml, note) {
  var HTML = 'text/html; charset=utf-8', now = new Date().toISOString(), actor = actorOf(decoded);
  var items = [];
  try { items = diffPages(beforeHtml || '', pageHtml); } catch (e) { console.error('api: could not compare versions of ' + eventId + ' — ' + e.message); }
  var summary = beforeHtml == null ? 'first saved version' : summarise(items);
  return Promise.all([
    saveObject(fb, versionPath(eventId, version), pageHtml, HTML),
    saveObject(fb, stagingObjectPath(eventId), pageHtml, HTML)
  ]).then(function () {
    return eventDocRef(fb, eventId).collection('changes').add({
      at: now, by: actor, version: version, baseVersion: version - 1, summary: summary,
      items: beforeHtml == null ? [] : items, note: String(note || '').trim().slice(0, 500)
    });
  }).then(function (ref) {
    var named = beforeHtml == null ? '' : sectionNames(items);   // which sections: "Hero, Speakers, Agenda"
    logActivity(fb, eventId, decoded, 'site-saved', 'version ' + version + ' — ' + summary + (named ? ' (' + named + ')' : ''), { area: 'site', changeId: ref.id, version: version });
    return { changeId: ref.id, summary: summary, items: items };
  }).then(null, function (err) {
    console.error('api: the save of ' + eventId + ' v' + version + ' was stored but not recorded — ' + (err && err.message));
    return { changeId: '', summary: summary, items: items };
  });
}

function handleApprovalRequest(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var note = String(body.note || '').trim().slice(0, 1000), actor = actorOf(decoded), now = new Date().toISOString();
    var ref = eventDocRef(fb, eventId);
    loadLiveEvent(fb, eventId).then(function (data) {
      var version = siteVersionOf(data);
      if (!version) throw httpError(409, 'Save the site first: there is nothing to send for approval yet.', { code: 'site-not-saved' });
      var liveVersion = data.published === true ? (+data.publishedVersion || 0) : 0;
      if (data.published === true && liveVersion === version) throw httpError(409, 'The saved site is already live: there is nothing new to publish.', { code: 'nothing-to-publish' });
      return Promise.all([
        liveVersion ? readObject(fb, versionPath(eventId, liveVersion)) : Promise.resolve(null),
        readObject(fb, versionPath(eventId, version)).then(function (t) { return t != null ? t : readObject(fb, sitePath(eventId, 'page.html')); }),
        ref.collection('changes').where('version', '>', liveVersion).orderBy('version').limit(60).get()
      ]).then(function (r) {
        var before = r[0], after = r[1];
        if (after == null) throw httpError(409, 'The saved site could not be found. Save it again, then send it for approval.', { code: 'site-not-saved' });
        var saves = r[2].docs.map(function (d) { var c = d.data(); return { id: d.id, at: c.at, by: c.by, version: c.version, summary: c.summary, note: c.note || '', items: c.items || [] }; })
          .filter(function (c) { return c.version <= version; });
        /* what the reviewer is shown: live against proposed when the live version's page was kept, else the
           saves one after another */
        var items = [];
        /* a first publication has no "before": the whole site is new, and listing every section as added says nothing */
        if (before != null) { try { items = diffPages(before, after); } catch (e) { items = []; } }
        if (liveVersion && before == null) saves.forEach(function (c) { items = items.concat(c.items); });
        var people = [];
        saves.forEach(function (c) { if (c.by && people.indexOf(c.by) === -1) people.push(c.by); });
        var pendingId = data.approval && data.approval.id;
        var doc = {
          status: 'pending', eventId: eventId, updatedAt: now, fromVersion: liveVersion, toVersion: version,
          firstPublish: !liveVersion, note: note, items: items.slice(0, 80), summary: !liveVersion ? 'first publication of the site' : summarise(items),
          contributors: people,
          saves: saves.map(function (c) { return { id: c.id, at: c.at, by: c.by, version: c.version, summary: c.summary, note: c.note }; })
        };
        var target = pendingId ? ref.collection('approvals').doc(pendingId) : ref.collection('approvals').doc();
        return (pendingId ? target.get() : Promise.resolve(null)).then(function (snap) {
          var open = snap && snap.exists && snap.data().status === 'pending';
          if (!open) { target = ref.collection('approvals').doc(); doc.requestedBy = actor; doc.requestedAt = now; }
          else { doc.requestedBy = snap.data().requestedBy; doc.requestedAt = snap.data().requestedAt; doc.resubmittedBy = actor; }
          return target.set(doc, { merge: true }).then(function () {
            return ref.update({ approval: { id: target.id, toVersion: version, requestedBy: doc.requestedBy, requestedAt: doc.requestedAt, updatedAt: now } });
          }).then(function () {
            logActivity(fb, eventId, decoded, 'approval-requested', 'version ' + version + ' — ' + doc.summary + (open ? ' (request updated)' : ''), { approvalId: target.id, version: version });
            var reviewPath = reviewPathOf(eventId, target.id);
            sendJson(res, 200, { id: target.id, status: 'pending', toVersion: version, fromVersion: liveVersion, summary: doc.summary, updated: !!open, reviewPath: reviewPath, reviewUrl: publicBaseFor(req, body.origin) + reviewPath });
          });
        });
      });
    }).catch(function (err) { sendFailure(res, 'approval request', err, 'The changes could not be sent for approval. Please try again.'); });
  });
}

function approvalView(id, d) {
  return {
    id: id, status: d.status, requestedBy: d.requestedBy || '', requestedAt: d.requestedAt || null, updatedAt: d.updatedAt || null,
    fromVersion: d.fromVersion || 0, toVersion: d.toVersion || 0, firstPublish: d.firstPublish === true, note: d.note || '',
    summary: d.summary || '', items: d.items || [], saves: d.saves || [], contributors: d.contributors || [],
    decidedBy: d.decidedBy || '', decidedAt: d.decidedAt || null, decisionNote: d.decisionNote || ''
  };
}

function handleApprovalGet(req, res) {
  withAdmin(req, res, function (fb, decoded) {
    var qs = queryOf(req), eventId = eventIdOr400(res, qs.get('eventId'));
    if (!eventId) return;
    var id = String(qs.get('id') || '').trim();
    var ref = eventDocRef(fb, eventId);
    Promise.all([loadLiveEvent(fb, eventId), approvalsConfig(fb)]).then(function (r) {
      var data = r[0], cfg = r[1];
      var wanted = id || (data.approval && data.approval.id) || '';
      var list = ref.collection('approvals').orderBy('requestedAt', 'desc').limit(20).get();
      return Promise.all([wanted ? ref.collection('approvals').doc(wanted).get() : Promise.resolve(null), list]).then(function (x) {
        var snap = x[0];
        var request = snap && snap.exists ? approvalView(snap.id, snap.data()) : null;
        var why = request ? whyNotApprover(cfg, actorOf(decoded), request.requestedBy) : '';
        sendJson(res, 200, {
          eventId: eventId, name: data.name || eventId, me: actorOf(decoded),
          published: data.published === true, publishedVersion: data.published === true ? (+data.publishedVersion || 0) : 0,
          publishedPath: data.published === true ? publicPathOf(eventId) : null, savedVersion: siteVersionOf(data),
          request: request, canDecide: !!request && request.status === 'pending' && !why, whyNot: why,
          approvers: cfg.approvers, allowSelf: cfg.allowSelf, required: cfg.required,
          requests: x[1].docs.map(function (d) { var v = d.data(); return { id: d.id, status: v.status, requestedBy: v.requestedBy, requestedAt: v.requestedAt, toVersion: v.toVersion, summary: v.summary, decidedBy: v.decidedBy || '', decidedAt: v.decidedAt || null }; })
        });
      });
    }).catch(function (err) { sendFailure(res, 'approval get', err, 'The request could not be loaded. Please try again.'); });
  });
}

/* The internal pages of a page going live, recorded on the event (publishedPages) for the sitemap: [{ slug, title }],
   or a delete of the field for a one-page site (most of them: nothing is written that was not there). */
function publishedPagesOf(html) {
  var list = sitePages.readPages(html, TOKEN_KIT).map(function (p) { return { slug: p.slug, title: p.title }; });
  return list.length ? list : fieldDelete();
}

/* Makes one kept version the live page. The caller has decided that it may. */
function publishVersion(fb, req, eventId, version, actor, origin, extra) {
  var HTML = 'text/html; charset=utf-8', token = crypto.randomBytes(12).toString('hex'), now = new Date().toISOString();
  var base = publicBaseFor(req, origin), livePath = publishedObjectPath(eventId), undo = null, livePages = null;
  return acquireSiteLock(fb, eventId, token, null).then(function (data) {
    var text = readObject(fb, versionPath(eventId, version)).then(function (text) {
      if (text != null) return text;
      return siteVersionOf(data) === version ? readObject(fb, sitePath(eventId, 'page.html')) : null;
    });
    return Promise.all([text, publicFormsFor(fb, eventId, data)]).then(withPictures(fb)).then(function (got) {
      var pageHtml = got[0];
      if (pageHtml == null) throw httpError(409, 'Version ' + version + ' of this site is no longer stored. Save the site again and send a new request.', { code: 'version-missing' });
      var live = publishTransform(pageHtml, {
        eventId: eventId, event: data, mode: 'live', publicBase: base, forms: got[1], pictures: got[2],
        templateId: (data.site && data.site.templateId) || data.templateId, origins: [cleanOrigin(origin)]
      });
      livePages = publishedPagesOf(live);
      return readObject(fb, livePath).then(function (before) {
        undo = function () { return restoreObject(fb, livePath, before, HTML); };
        return saveObject(fb, livePath, live, HTML);
      });
    }).then(function () {
      return commitSiteLock(fb, eventId, token, Object.assign({
        published: true, publishedAt: now, publishedBy: actor, publishedVersion: version,
        publishedPath: publicPathOf(eventId), publishedUrl: fieldDelete(), updatedAt: now, publishedPages: livePages
      }, extra || {}));
    }).then(function () {
      forgetCachedPage(eventId);
      return { publishedPath: publicPathOf(eventId), publishedUrl: base + publicPathOf(eventId), publishedAt: now, publishedVersion: version };
    }, function (err) {
      return Promise.resolve(undo ? undo() : null).then(null, function () {}).then(function () { return releaseSiteLock(fb, eventId, token); }).then(function () { throw err; });
    });
  });
}

function handleApprovalDecide(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var id = String(body.id || '').trim(), decision = body.decision, note = String(body.note || '').trim().slice(0, 1000);
    if (!/^[A-Za-z0-9]{6,40}$/.test(id)) return sendJson(res, 400, { error: 'A valid request id is required.' });
    if (decision !== 'approve' && decision !== 'reject') return sendJson(res, 400, { error: '"decision" must be "approve" or "reject".' });
    if (decision === 'reject' && !note) return sendJson(res, 400, { error: 'Say why, so the person who made the changes knows what to fix.', field: 'note' });
    var actor = actorOf(decoded), now = new Date().toISOString();
    var ref = eventDocRef(fb, eventId), reqRef = ref.collection('approvals').doc(id);
    Promise.all([loadLiveEvent(fb, eventId), reqRef.get(), approvalsConfig(fb)]).then(function (r) {
      var snap = r[1], cfg = r[2];
      if (!snap.exists) throw httpError(404, 'That request does not exist.', { code: 'request-not-found' });
      var request = snap.data();
      if (request.status !== 'pending') throw httpError(409, 'This request was already ' + request.status + (request.decidedBy ? ' by ' + request.decidedBy : '') + '.', { code: 'request-closed' });
      var why = whyNotApprover(cfg, actor, request.requestedBy);
      if (why) throw httpError(403, why, { code: 'not-an-approver' });
      var closed = { decidedBy: actor, decidedAt: now, decisionNote: note };
      if (decision === 'reject') {
        return reqRef.update(Object.assign({ status: 'rejected' }, closed))
          .then(function () { return ref.update({ approval: fieldDelete() }); })
          .then(function () {
            logActivity(fb, eventId, decoded, 'rejected', 'version ' + request.toVersion + ' — ' + note, { approvalId: id, version: request.toVersion, requestedBy: request.requestedBy });
            sendJson(res, 200, { id: id, status: 'rejected' });
          });
      }
      return publishVersion(fb, req, eventId, request.toVersion, actor, body.origin, {
        approval: fieldDelete(), lastApproval: { id: id, by: actor, at: now, requestedBy: request.requestedBy, version: request.toVersion }
      }).then(function (out) {
        return reqRef.update(Object.assign({ status: 'approved' }, closed)).then(function () {
          logActivity(fb, eventId, decoded, 'approved', 'version ' + request.toVersion + ' — ' + (request.summary || '') + (note ? ' — “' + note + '”' : ''), { approvalId: id, version: request.toVersion, requestedBy: request.requestedBy });
          logActivity(fb, eventId, decoded, 'published', 'version ' + request.toVersion + ', requested by ' + request.requestedBy + ', approved by ' + actor, { approvalId: id, version: request.toVersion });
          sendJson(res, 200, Object.assign({ id: id, status: 'approved' }, out));
        });
      });
    }).catch(function (err) { sendFailure(res, 'approval decide', err, 'The decision could not be recorded. Please try again.'); });
  });
}

function handleApprovalSettingsGet(req, res) {
  withAdmin(req, res, function (fb) {
    approvalsConfig(fb).then(function (cfg) { sendJson(res, 200, cfg); })
      .catch(function (err) { sendFailure(res, 'approval settings', err, 'The settings could not be loaded.'); });
  });
}
function handleApprovalSettingsPut(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var list = Array.isArray(body.approvers) ? body.approvers : String(body.approvers || '').split(/[\s,;]+/);
    list = list.map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean);
    var bad = list.filter(function (e) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); })[0];
    if (bad) return sendJson(res, 400, { error: '"' + bad + '" is not an e-mail address.', field: 'approvers' });
    approvalsConfig(fb).then(function (cfg) {
      /* once approvers are named, only they change who approves — else anyone could add themselves */
      if (cfg.approvers.length && cfg.approvers.indexOf(actorOf(decoded).toLowerCase()) === -1) {
        return sendJson(res, 403, { error: 'Only an approver (' + cfg.approvers.join(', ') + ') can change these settings.', code: 'not-an-approver' });
      }
      return write();
    }).catch(function (err) { sendFailure(res, 'approval settings', err, 'The settings could not be saved.'); });
    function write() {
    var doc = { approvers: list.filter(function (e, i) { return list.indexOf(e) === i; }).slice(0, 50), allowSelf: body.allowSelf === true, required: body.required !== false,
      updatedAt: new Date().toISOString(), updatedBy: actorOf(decoded) };
    return fb.db.collection('config').doc('approvals').set(doc).then(function () { sendJson(res, 200, { approvers: doc.approvers, allowSelf: doc.allowSelf, required: doc.required }); });
    }
  });
}

/* ---- Activity log (Part 1): GET /api/event/history ----
   The event's history, newest first: every recorded action with who and when, its area, and — for a save
   or an approval request — what changed, before and after. A page at a time: ?limit=50&before=<next>,
   filtered by ?from=&to= (ISO times), ?by=<email|platform>, ?area=, ?action=, ?q=<text>
   (lib/activity-query.js). Without any of them it answers the newest 300, as it always has. */
function handleEventHistory(req, res) {
  withAdmin(req, res, function (fb) {
    var qs = queryOf(req), eventId = eventIdOr400(res, qs.get('eventId'));
    if (!eventId) return;
    var ref = eventDocRef(fb, eventId), AQ = require('./activity-query'), opts = AQ.parseQuery(qs, 300);
    loadLiveEvent(fb, eventId).then(function (data) {
      return AQ.queryPage(ref.collection('activity'), opts).then(function (page) {
        /* the saves and approval requests these entries belong to, read by id */
        function byId(sub, key) {
          var ids = [];
          page.items.forEach(function (a) { if (a[key] && ids.indexOf(String(a[key])) === -1) ids.push(String(a[key])); });
          if (!ids.length) return Promise.resolve({});
          return fb.db.getAll.apply(fb.db, ids.map(function (id) { return ref.collection(sub).doc(id); })).then(function (snaps) {
            var out = {};
            snaps.forEach(function (s) { if (s.exists) out[s.id] = s.data(); });
            return out;
          });
        }
        return Promise.all([byId('changes', 'changeId'), byId('approvals', 'approvalId')]).then(function (r) {
          var changes = r[0], approvals = r[1];
          var usage = isPlainObject(data.aiUsage) ? data.aiUsage : null;
          sendJson(res, 200, {
            eventId: eventId, name: data.name || eventId, next: page.next, people: page.people || null,
            aiUsage: usage ? { usd: +usage.usd || 0, calls: +usage.calls || 0, pictures: +usage.pictures || 0, updatedAt: usage.updatedAt || null, byRoute: isPlainObject(usage.byRoute) ? usage.byRoute : {} } : null,
            items: page.items.map(function (a) {
              var out = { id: a.id, at: a.at, by: a.by, action: a.action, detail: a.detail, area: a.area, version: a.version || null };
              if (a.fields) out.fields = a.fields;
              var c = a.changeId && changes[a.changeId];
              if (c) out.changes = c.items || [];
              var p = a.approvalId && approvals[a.approvalId];
              if (p) {
                out.approval = { id: a.approvalId, status: p.status, requestedBy: p.requestedBy || '', requestedAt: p.requestedAt || null, decidedBy: p.decidedBy || '', decidedAt: p.decidedAt || null, decisionNote: p.decisionNote || '', fromVersion: p.fromVersion || 0, toVersion: p.toVersion || 0 };
                if (a.action === 'approval-requested') out.changes = p.items || [];
              }
              return out;
            })
          });
        });
      });
    }).catch(function (err) { sendFailure(res, 'history', err, 'The history could not be loaded. Please try again.'); });
  });
}
/* ---- end Activity log (Part 1) ---- */

/* what a history line shows of a field's value: short, and never a picture's bytes */
function historyValue(v) {
  if (v == null || v === '') return '(empty)';
  if (Array.isArray(v)) return v.length + (v.length === 1 ? ' item' : ' items');
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 160);
  var s = String(v);
  if (/^data:/i.test(s)) return '(an uploaded picture)';
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}
function pick(obj, keys) { var out = {}; keys.forEach(function (k) { if (obj && has(obj, k)) out[k] = obj[k]; }); return out; }
/* [{ field, before, after }] for the fields of `next` that differ from `prev` */
function fieldChanges(prev, next, skip) {
  var out = [];
  Object.keys(next || {}).forEach(function (k) {
    if (skip && skip.indexOf(k) !== -1) return;
    var a = prev ? prev[k] : undefined, b = next[k];
    if (JSON.stringify(a == null ? '' : a) === JSON.stringify(b == null ? '' : b)) return;
    out.push({ field: k, before: historyValue(a), after: historyValue(b) });
  });
  return out.slice(0, 30);
}

/* ---------- POST /api/event/unpublish ----------
   Body { eventId } -> 200 { ok, published: false }. /e/<id> reads the event on every request, so the page
   stops being served at once, on every instance. The stored page is kept: publishing again replaces it. */
function handleEventUnpublish(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var now = new Date().toISOString(), ref = eventDocRef(fb, eventId), wasPublished = false;
    fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var state = eventStateOf(snap);
        if (state !== 'live') throw notLiveError(state, eventId);
        wasPublished = snap.data().published === true;
        if (!wasPublished) return;
        tx.update(ref, {
          published: false, publishedPath: null, publishedUrl: fieldDelete(),
          unpublishedAt: now, unpublishedBy: actorOf(decoded), updatedAt: now
        });
      });
    }).then(function () {
      forgetCachedPage(eventId);
      sendJson(res, 200, { ok: true, published: false });
      if (wasPublished) logActivity(fb, eventId, decoded, 'unpublished', '');
    }).catch(function (err) { sendFailure(res, 'unpublish', err, 'The site could not be unpublished. Please try again.'); });
  });
}

/* ---------- POST /api/event/stage — only for editors still running the previous script ----------
   The previous Preview button sends the page it has in hand and opens whatever `stagingUrl` comes back.
   It used to be written to a PUBLIC Storage object, so an unreleased site could be read by anyone who
   guessed the event's address. It is now kept private and shown through /preview/<id>?staged=1, behind
   the sign-in gate like every other preview. It does not touch the saved site: a page with no snapshot
   must not become "the latest version" just because somebody looked at it. The current editor does not
   call this at all — it saves, then opens /preview/<id>. */
function handleEventStage(req, res) {
  withAdminBody(req, res, BODY_LIMITS.site, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    if (typeof body.html !== 'string' || !body.html.trim()) return sendJson(res, 400, { error: 'The page to preview ("html") is missing.' });
    /* draft: true — the editor's Preview: the page as it is in that person's editor, saved or not. It is
       theirs alone and is not staging: staging changes only when somebody presses Save. */
    var draft = body.draft === true;
    loadLiveEvent(fb, eventId).then(function () {
      return saveObject(fb, draft ? draftObjectPath(eventId, decoded) : stagingObjectPath(eventId), rewriteOrigins(body.html, [cleanOrigin(body.origin)]), 'text/html; charset=utf-8');
    }).then(function () {
      var previewPath = '/preview/' + eventId + (draft ? '?draft=1' : '?staged=1');
      sendJson(res, 200, { stagingUrl: publicBaseFor(req, body.origin) + previewPath, previewPath: previewPath });
    }).catch(function (err) { sendFailure(res, 'stage', err, 'The preview could not be prepared. Please try again.'); });
  });
}

/* ---------- POST /api/event/live-view — the site editor's "Edit with AI" live view ----------
   Body { eventId, html, origin } -> 200 { html }: the page the editor has in hand (its serialize()), put
   through the same transform as /preview/<id>?draft=1 — so the live view looks and behaves exactly like
   the draft preview — but marked as the editor's live view (opts.liveView: <html data-rv-editor-mode="ai">,
   no ribbon, no theme switcher, no "Edit with AI" button). Nothing is stored: the editor shows the answer
   in a frame of its own and asks again after every change. */
function handleEventLiveView(req, res) {
  withAdminBody(req, res, BODY_LIMITS.site, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    if (typeof body.html !== 'string' || !body.html.trim()) return sendJson(res, 400, { error: 'The page to show ("html") is missing.' });
    loadLiveEvent(fb, eventId).then(function (data) {
      return publicFormsFor(fb, eventId, data).then(function (formsPayload) {
        var html = publishTransform(body.html, {
          eventId: eventId, event: data, mode: 'preview', publicBase: '', liveView: true, forms: formsPayload,
          templateId: (data.site && data.site.templateId) || data.templateId, origins: [cleanOrigin(body.origin)]
        });
        sendJson(res, 200, { html: applyHeroVideo(html, data) });
      });
    }).catch(function (err) { sendFailure(res, 'live view', err, 'The live view could not be prepared. Please try again.'); });
  });
}

/* =====================================================================================================
   THE PAGES THEMSELVES — GET /e/<eventId> (public) and GET /preview/<eventId> (signed-in)
   These answer HTML, not JSON, and are read by people who have never heard of this CMS: every failure
   is a small plain page, never a JSON body or a stack trace.
   ===================================================================================================== */
function messagePage(title, message) {
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + escHtmlText(title) + '</title>' +
    '<link rel="icon" type="image/svg+xml" href="' + SITE_FAVICON + '">' +
    '<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#f6f7f9;color:#191b1f;' +
    'font:16px/1.5 Inter,-apple-system,"Segoe UI",Arial,sans-serif}main{max-width:460px;padding:32px 24px;text-align:center}' +
    'img{height:28px;margin-bottom:28px}h1{font-size:22px;margin:0 0 10px}p{margin:0;color:#5b616b}</style></head>' +
    '<body><main><img src="/assets/et-b2b-wordmark.svg" alt="ET"><h1>' + escHtmlText(title) + '</h1><p>' + escHtmlText(message) + '</p></main></body></html>\n';
}

/* ---- delivery (lib/delivery.js): compression, and what the browser is given to show a page sooner ----
   Every page answers compressed when the browser accepts it — brotli, else gzip — whether or not it comes
   pre-compressed (`packed`: { br, gzip } Buffers of the same html; a bare Buffer is gzip). The preview used to
   go out uncompressed: 238 KB where 38 KB would do. */
function acceptedEncoding(req) {
  var ae = String((req.headers && req.headers['accept-encoding']) || '').toLowerCase();
  function ok(name) {
    var m = new RegExp('(?:^|,)\\s*' + name + '\\s*(?:;\\s*q\\s*=\\s*([0-9.]+))?\\s*(?=,|$)').exec(ae);
    return !!m && !(m[1] != null && +m[1] === 0);
  }
  return ok('br') ? 'br' : ok('gzip') ? 'gzip' : '';
}
function compressHtml(buf, encoding, best) {
  if (encoding === 'br') {
    var params = {};
    params[zlib.constants.BROTLI_PARAM_QUALITY] = best ? 9 : 5;
    params[zlib.constants.BROTLI_PARAM_MODE] = zlib.constants.BROTLI_MODE_TEXT;
    params[zlib.constants.BROTLI_PARAM_SIZE_HINT] = buf.length;
    return zlib.brotliCompressSync(buf, { params: params });
  }
  return zlib.gzipSync(buf, { level: best ? 9 : 6 });
}
/* this file's own HTML reader, lent to lib/delivery.js */
var HTML_TOOLS = { tokenizeHtml: tokenizeHtml, attrValue: attrValue, setAttr: setAttr, dropAttr: dropAttr, writeTag: writeTag };
function deliverPage(html) { return deliveryLib.deliverPage(html, { tools: HTML_TOOLS }); }

function sendHtml(req, res, status, html, cacheControl, packed) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* socket already gone */ } return; }
  if (Buffer.isBuffer(packed)) packed = { gzip: packed };
  var raw = Buffer.from(html, 'utf8'), body = raw, encoding = acceptedEncoding(req);
  if (encoding && raw.length > 1024) {
    try { body = (packed && packed[encoding]) || compressHtml(raw, encoding, false); }
    catch (e) { body = raw; }
  }
  if (body === raw) encoding = '';
  var headers = {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl, 'Content-Length': body.length,
    'Vary': 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'
  };
  if (encoding) headers['Content-Encoding'] = encoding;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
function sendNotAvailable(req, res) {
  sendHtml(req, res, 404, messagePage('This event page is not available', 'It may not be published yet, or it may have been taken down.'), 'no-store');
}

/* The published pages this instance has served lately, so a busy page is not downloaded from Storage and
   compressed again for every visitor. The key carries the publish it belongs to (version and time), so a
   new publish is picked up on the very next request without anything having to be invalidated — the
   event document, which says what is published, is read every time regardless. Entries also expire after
   a minute, which bounds how long this instance could go on serving a page from a publish that was
   rolled back at its last step. */
var PAGE_CACHE = new Map(), PAGE_CACHE_MAX = 40, PAGE_CACHE_TTL_MS = 60000;
function cachedPage(key) {
  var hit = PAGE_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PAGE_CACHE_TTL_MS) { PAGE_CACHE.delete(key); return null; }
  /* delivered before a font stylesheet it links had arrived (lib/delivery.js writes one in only once this
     server holds it): delivered again from the same page, so the next visitor gets the sheet written in rather
     than this instance going on sending the link — the slowest request of the first paint — for a minute */
  if (hit.gen !== deliveryLib.generation()) packPage(hit);
  return hit;
}
function packPage(entry) {
  entry.gen = deliveryLib.generation();
  var html = deliverPage(entry.source);
  if (entry.packed && html === entry.html) return entry;           // a sheet another page links: this one is as it was
  entry.html = html;
  entry.packed = {};
  var buf = Buffer.from(entry.html, 'utf8');
  ['br', 'gzip'].forEach(function (enc) { try { entry.packed[enc] = compressHtml(buf, enc, true); } catch (e) { /* compressed per request instead */ } });
  return entry;
}
/* html: the page as stored; the entry holds it as delivered (lib/delivery.js) and compressed both ways */
function cachePage(key, html) {
  if (PAGE_CACHE.size >= PAGE_CACHE_MAX) PAGE_CACHE.delete(PAGE_CACHE.keys().next().value);     // oldest first
  var entry = packPage({ at: Date.now(), source: html });
  PAGE_CACHE.set(key, entry);
  return entry;
}
function forgetCachedPage(eventId) {
  PAGE_CACHE.forEach(function (v, k) { if (k.indexOf(eventId + '|') === 0) PAGE_CACHE.delete(k); });
  LIVE_DOC_CACHE.delete(eventId);
}
/* A published page may be kept by the hosting's CDN and by browsers for a minute, and served a little
   longer while a fresh copy is fetched in the background (stale-while-revalidate): a visitor then almost
   never waits for this server. Taking a page down or publishing again shows within about a minute. */
var LIVE_PAGE_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600';
/* The event document behind /e/<id>, shared by the requests of a few seconds (and by concurrent ones): a
   busy page is not one database read per visitor. This instance forgets it at once on publish/unpublish. */
var LIVE_DOC_CACHE = new Map(), LIVE_DOC_TTL_MS = 5000;
function liveEventSnap(fb, eventId) {
  var hit = LIVE_DOC_CACHE.get(eventId);
  if (hit && Date.now() - hit.at < LIVE_DOC_TTL_MS) return hit.p;
  if (LIVE_DOC_CACHE.size > 500) LIVE_DOC_CACHE.clear();
  var p = eventDocRef(fb, eventId).get();
  var entry = { at: Date.now(), p: p };
  LIVE_DOC_CACHE.set(eventId, entry);
  p.catch(function () { if (LIVE_DOC_CACHE.get(eventId) === entry) LIVE_DOC_CACHE.delete(eventId); });
  return p;
}

/* The document with one of its internal pages selected (site-pages.js): { html, found, page, pages } */
function selectSitePage(html, slug) { return sitePages.selectPage(html, slug, TOKEN_KIT); }

/* GET /e/<eventId> — the published site. Public. Served only while the event is live and published;
   anything else is the same plain 404, which gives nothing away about what exists.
   GET /e/<eventId>/<slug> — one of its internal pages: the same published document with that page selected
   (selectSitePage), cached under its own key next to the home page's; a slug the document has no page for is
   the same 404. */
function handlePublicPage(req, res, eventId, slug) {
  var fb = getFirebase();
  if (fb.error) {
    console.error('api: /e/' + eventId + ' — ' + fb.error);
    return sendHtml(req, res, 503, messagePage('This page is temporarily unavailable', 'Please try again in a few minutes.'), 'no-store');
  }
  liveEventSnap(fb, eventId).then(function (snap) {
    if (eventStateOf(snap) !== 'live' || snap.data().published !== true) return sendNotAvailable(req, res);
    var data = snap.data();
    /* the banner video is put on the page as it is served (applyHeroVideo): a change to it is a new page */
    var key = eventId + '|' + (data.publishedVersion || 0) + '|' + (data.publishedAt || '') + '|' + heroVideoStamp(data);
    var slugKey = slug ? key + '|page:' + slug : '';
    /* the page as served: the document itself, or one of its internal pages selected on it */
    function send(entry) {
      if (!slug) return sendHtml(req, res, 200, entry.html, LIVE_PAGE_CACHE_CONTROL, entry.packed);
      var chosen = selectSitePage(entry.source, slug);
      if (!chosen.found) return sendNotAvailable(req, res);
      var own = cachePage(slugKey, chosen.html);
      sendHtml(req, res, 200, own.html, LIVE_PAGE_CACHE_CONTROL, own.packed);
    }
    var hitPage = slugKey ? cachedPage(slugKey) : null;
    if (hitPage) return sendHtml(req, res, 200, hitPage.html, LIVE_PAGE_CACHE_CONTROL, hitPage.packed);
    var hit = cachedPage(key);
    if (hit) return send(hit);
    return readObject(fb, publishedObjectPath(eventId)).then(function (html) {
      if (html == null) return sendNotAvailable(req, res);
      /* A page with no publishedVersion was published by the previous version of this file: the editor's
         serialize() output, stored as it came, linking its CSS and scripts by the absolute address of
         whichever host the editor ran on and carrying no runtime. It goes through the same transform
         here, on its way out, so that it too is root-relative and can take registrations. */
      if (!data.publishedVersion) {
        return Promise.all([html, publicFormsFor(fb, eventId, data)]).then(withPictures(fb)).then(function (got) {
          var formsPayload = got[1];
          html = publishTransform(html, {
            eventId: eventId, event: data, mode: 'live', templateId: data.templateId, forms: formsPayload, pictures: got[2],
            publicBase: cleanOrigin(process.env.PUBLIC_BASE_URL || '')
          });
          return withHeroVideo(fb, html, data).then(function (page) {
            send(cachePage(key, page));
          });
        });
      }
      /* a page published before forms existed: its Register buttons open the form from now on; one
         published before its pictures had WebP copies gets them on the way out (pictures.js — a picture
         that already has them is left alone); and one published before the accessibility and search pass
         gets it on its way out (site-a11y.js pagePass: idempotent, so a page that already had it comes out
         the same, its schema.org Event following the event as it is now). Same order as publishTransform,
         then the banner video as the event has it now (withHeroVideo). */
      return pictures.prepare(fb, html).then(function (pics) {
        var page = pictures.rewriteHtml(ensureFormsRuntime(html), pics);
        page = siteA11y.pagePass(page, { mode: 'live', event: data, templateId: (data.site && data.site.templateId) || data.templateId }, TOKEN_KIT);
        return withHeroVideo(fb, page, data);
      }).then(function (page) {
        send(cachePage(key, page));
      });
    });
  }).catch(function (err) {
    console.error('api: /e/' + eventId + ' failed — ' + (err && err.stack || err));
    sendHtml(req, res, 502, messagePage('This page is temporarily unavailable', 'Please try again in a few minutes.'), 'no-store');
  });
}

/* GET /preview/<eventId> — what would be published right now: the last saved site through the same
   transform, in preview mode (the runtime then stores no registration and counts no visit), with a
   ribbon. Signed-in only. server.js's gate already turns a signed-out visitor away before this runs; the
   check is repeated here because this handler is also reachable where that gate is not in front of it
   (the Cloud Function entry point, a local server with the gate switched off), and an unreleased site
   must not depend on which door it is asked for at. ?staged=1 shows the page the previous editor
   script's Preview button sent instead (handleEventStage). */
/* The preview's theme switcher (only for an AI-designed site): the themes as buttons; picking one restyles the
   page in place (templates/_shared/rv-theme.js — the colours a section wrote as fixed values are turned into
   the variables first, the ET logo takes the version for its new ground), and "Apply in editor" opens the
   editor in it, to save and publish. Nothing here is part of a published page. */
function themeSwitcherHtml(event, eventId, templateId) {
  var plan = event && event.designPlan;
  /* an AI-designed site: its template id says so, or (a site not saved yet) its own design and sections do */
  if (!templateId && plan && Array.isArray(event.generatedSections) && event.generatedSections.length) templateId = 'gen-' + eventId;
  if (!templateId) templateId = siteTemplateIdOf(event);
  /* every site but an imported one gets the box: the section edges for all, the themes for an AI-designed one */
  if (!eventId || !templateId || isImportedSite(eventId, templateId)) return '';
  var generated = !!(plan && plan.design && /^gen-/.test(String(templateId)));
  var themes = generated ? rvTheme.themesFor(Object.assign({}, plan.design, genDesign.palette(plan.design, 'auto'))) : [];
  var editorBase = '/custom_editor.html?event=' + encodeURIComponent(eventId) + '&template=' + encodeURIComponent(templateId);
  var data = JSON.stringify({ themes: themes, design: generated ? plan.design : null, current: (plan && plan.themeId) || 'original',
    edges: sectionEdgesOf(event), editorBase: editorBase, editor: editorBase + '&theme=' })
    .replace(/</g, '\\u003c');
  return (generated ? '<script src="/templates/_shared/rv-theme.js" data-rv-runtime></script>\n' : '') +
    '<script type="application/json" id="rv-themes" data-rv-runtime>' + data + '</script>\n' +
    '<script src="/templates/_shared/rv-theme-switcher.js" data-rv-runtime></script>\n';
}

/* ?draft=1 — the page as this person last previewed it from the editor, or the site as last saved when that is
   newer or they have never pressed Preview (the console's and the listing's Preview open this same address).
   -> Promise<html | null> */
function ownDraftOrSaved(fb, eventId, user) {
  function updated(path) {
    return fb.bucket.file(path).getMetadata().then(function (r) { return Date.parse(r[0] && r[0].updated) || 0; }, function (err) {
      if (err && (err.code === 404 || err.code === '404')) return -1;
      throw err;
    });
  }
  var draft = draftObjectPath(eventId, user), saved = sitePath(eventId, 'page.html'), staging = stagingObjectPath(eventId);
  return Promise.all([updated(draft), updated(saved)]).then(function (t) {
    if (t[0] >= 0 && t[0] >= t[1]) return readObject(fb, draft);
    if (t[1] >= 0) return readObject(fb, saved);
    return readObject(fb, staging);
  });
}

function handlePreviewPage(req, res, eventId, slug) {
  /* who is asking and the event document are read at the same time (they were one after the other);
     nothing about the event is sent before the sign-in has been checked */
  var fb = getFirebase();
  var eventRead = fb.error ? null : eventDocRef(fb, eventId).get();
  if (eventRead) eventRead.catch(function () { /* answered below, or not needed */ });
  adminFromRequest(req).then(function (user) {
    if (!user) {
      res.writeHead(302, { Location: '/?next=' + encodeURIComponent(req.url), 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (fb.error) return sendHtml(req, res, 503, messagePage('Preview is temporarily unavailable', 'Please try again in a few minutes.'), 'no-store');
    var staged = queryOf(req).get('staged') === '1';
    /* ?version=N: that saved version exactly — what a reviewer is shown, and what approving makes live */
    var wantVersion = parseInt(queryOf(req).get('version'), 10);
    if (!(wantVersion > 0)) wantVersion = 0;
    var ownDraft = queryOf(req).get('draft') === '1';
    return eventRead.then(function (snap) {
      if (eventStateOf(snap) !== 'live') {
        return sendHtml(req, res, 404, messagePage('This event does not exist', 'It may have been deleted, or the address may be wrong.'), 'no-store');
      }
      var data = snap.data();
      if (!staged && !ownDraft && !siteVersionOf(data)) {
        return sendHtml(req, res, 404, messagePage('Nothing to preview yet', 'This event’s site has not been saved. Open it in the site editor first.'), 'no-store');
      }
      var source = ownDraft ? ownDraftOrSaved(fb, eventId, user) : wantVersion
        ? readObject(fb, versionPath(eventId, wantVersion)).then(function (t) { return t == null && wantVersion === siteVersionOf(data) ? readObject(fb, sitePath(eventId, 'page.html')) : t; })
        : readObject(fb, staged ? stagingObjectPath(eventId) : sitePath(eventId, 'page.html'));
      var formsRead = publicFormsFor(fb, eventId, data);         // alongside the page (never rejects)
      return source.then(function (html) {
        if (html == null && wantVersion) {
          return sendHtml(req, res, 404, messagePage('That version is not stored', 'Version ' + wantVersion + ' of this site was saved before versions were kept, or does not exist.'), 'no-store');
        }
        if (html == null) {
          return sendHtml(req, res, 404, messagePage('Nothing to preview yet', 'This event’s site has not been saved. Open it in the site editor first.'), 'no-store');
        }
        /* "Edit with AI" back into the editor — not on a saved version opened for review (?version=N) */
        return Promise.all([formsRead, pictures.prepare(fb, html)]).then(function (got) {
          var formsPayload = got[0];
          return withHeroVideo(fb, publishTransform(html, {
            eventId: eventId, event: data, mode: 'preview', publicBase: '', editButton: !wantVersion, forms: formsPayload, pictures: got[1],
            templateId: (data.site && data.site.templateId) || data.templateId
          }), data);
        }).then(function (page) {
          /* /preview/<id>/<slug>: one of the site's internal pages (site-pages.js) */
          if (slug) {
            var chosen = selectSitePage(page, slug);
            if (!chosen.found) return sendHtml(req, res, 404, messagePage('This page is not part of the site', 'The site has no page at this address. It may have been renamed or removed.'), 'no-store');
            page = chosen.html;
          }
          sendHtml(req, res, 200, deliverPage(page), 'no-store');
        });
      });
    });
  }).catch(function (err) {
    console.error('api: /preview/' + eventId + ' failed — ' + (err && err.stack || err));
    sendHtml(req, res, 502, messagePage('Preview is temporarily unavailable', 'Please try again in a few minutes.'), 'no-store');
  });
}

/* =====================================================================================================
   GET /robots.txt and GET /sitemap.xml — for search engines (site-seo.js). Public. The sitemap lists every
   published event's /e/<id> (and /e/<id>/<slug> for each of its internal pages, event.publishedPages) at the address this server is reached at (PUBLIC_BASE_URL when set), except one
   whose owner gave it a canonical address elsewhere (that address is the one to list, and it is not ours).
   Built at most every 10 minutes per instance; a failure to read the events is a 503, never an empty list
   a crawler would believe.
   ===================================================================================================== */
var SITEMAP_TTL_MS = 10 * 60 * 1000, sitemapCache = null;
function sendText(req, res, status, type, text, cacheControl) {
  var body = Buffer.from(text, 'utf8');
  var gz = /\bgzip\b/.test(String((req.headers && req.headers['accept-encoding']) || '')) && body.length > 1024;
  if (gz) body = zlib.gzipSync(body);
  var headers = { 'Content-Type': type, 'Cache-Control': cacheControl, 'Content-Length': body.length, 'Vary': 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff' };
  if (gz) headers['Content-Encoding'] = 'gzip';
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
function handleRobotsTxt(req, res) {
  sendText(req, res, 200, 'text/plain; charset=utf-8', siteSeo.robotsTxt(publicBaseFor(req, '')), 'public, max-age=3600');
}
function handleSitemapXml(req, res) {
  var base = publicBaseFor(req, '');
  if (sitemapCache && sitemapCache.base === base && Date.now() - sitemapCache.at < SITEMAP_TTL_MS) {
    return sendText(req, res, 200, 'application/xml; charset=utf-8', sitemapCache.xml, 'public, max-age=600');
  }
  var fb = getFirebase();
  if (fb.error) return sendText(req, res, 503, 'text/plain; charset=utf-8', 'The sitemap is temporarily unavailable.\n', 'no-store');
  fb.db.collection('events').where('published', '==', true).select('createdAt', 'deletedAt', 'publishedAt', 'settings', 'publishedPages').get().then(function (snap) {
    var entries = [];
    snap.docs.forEach(function (d) {
      var e = d.data() || {};
      if (eventStateOf(d) !== 'live' || !isEventId(d.id)) return;
      /* the QA harness's short-lived test copies (always "qa-…", deleted after each run) are no site to list */
      if (/^qa-/.test(d.id)) return;
      if (cleanCanonical(e.settings && e.settings.seo && e.settings.seo.canonicalUrl)) return;
      var lastmod = typeof e.publishedAt === 'string' ? e.publishedAt : '';
      entries.push({ loc: base + publicPathOf(d.id), lastmod: lastmod });
      /* its internal pages, as the publish recorded them (publishedPagesOf) */
      (Array.isArray(e.publishedPages) ? e.publishedPages : []).forEach(function (p) {
        if (p && typeof p.slug === 'string' && sitePages.SLUG_RE.test(p.slug) && p.slug !== sitePages.HOME) entries.push({ loc: base + publicPathOf(d.id) + '/' + p.slug, lastmod: lastmod });
      });
    });
    entries.sort(function (a, b) { return a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0; });
    sitemapCache = { at: Date.now(), base: base, xml: siteSeo.sitemapXml(entries) };
    sendText(req, res, 200, 'application/xml; charset=utf-8', sitemapCache.xml, 'public, max-age=600');
  }).catch(function (err) {
    console.error('api: /sitemap.xml failed — ' + (err && err.stack || err));
    sendText(req, res, 503, 'text/plain; charset=utf-8', 'The sitemap is temporarily unavailable.\n', 'no-store');
  });
}

/* =====================================================================================================
   ROUTING
   ===================================================================================================== */

/* The one entry point every server (server.js on App Hosting, tools/serve.js locally, the legacy Cloud
   Function) calls, for every path under /api/, /e/ and /preview/. A synchronous throw anywhere in routing
   or in a handler's own first lines becomes a 500 for THAT request instead of an uncaught exception for
   the whole process. Throws inside later stream/promise callbacks are each handler's own to deal with
   (withAdmin / withAdminBody / sendFailure above); server.js adds a process-level net under all of it. */
function handleApi(req, res) {
  try { return routeApi(req, res); }
  catch (err) {
    console.error('api: unhandled error on ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err));
    if (res.headersSent) { try { res.end(); } catch (e) { /* socket already gone */ } return; }
    if (/^\/(e|preview)\//.test(String(req.url))) {
      return sendHtml(req, res, 500, messagePage('Something went wrong', 'Please try again in a few minutes.'), 'no-store');
    }
    sendJson(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  }
}

/* Two groups of routes live in their own files (contract section 14): lib/api-events.js (uploads, the
   address check, delete / restore / clone) and lib/api-audience.js (the public site data, registration,
   visits, reports, history). They are loaded here, on the request that needs them, never at the top of
   this file: a module that is missing from a deployment, or that fails to load, then costs its own
   routes a clear 503 while the server still starts and every other route keeps working. (A failed
   require() is not cached by Node, so the next request tries again.) */
function inModule(moduleName, handlerName) {
  return function (req, res) {
    var mod;
    try { mod = require('./' + moduleName); }
    catch (err) {
      console.error('api: could not load lib/' + moduleName + '.js for ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err));
      return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
    }
    if (!mod || typeof mod[handlerName] !== 'function') {
      console.error('api: lib/' + moduleName + '.js has no ' + handlerName + '() for ' + req.method + ' ' + req.url);
      return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
    }
    return mod[handlerName](req, res);
  };
}
var events = function (handler) { return inModule('api-events', handler); };
var audience = function (handler) { return inModule('api-audience', handler); };
var formsRoute = function (handler) { return inModule('api-forms', handler); };
var heroVideo = function (handler) { return inModule('api-hero-video', handler); };

/* lib/promo.js needs a few of this file's helpers. They are handed to it (wire()) on each call instead of
   it requiring this file, which would be a require cycle; a module that fails to load still costs only its
   own routes the 503 inModule() answers. */
function promoHelpers() {
  return { withAdmin, withAdminBody, eventIdOr400, loadLiveEvent, readObject, sitePath, siteVersionOf, googleFontUrl,
    publicBaseFor, aiUsageRecorder, sendAiFailure, sendFailure, httpError, BODY_LIMITS };
}
var promo = function (handler) {
  var run = inModule('promo', handler);
  return function (req, res) {
    try { require('./promo').wire(promoHelpers()); } catch (e) { /* inModule() logs it and answers 503 */ }
    return run(req, res);
  };
};

/* lib/promo-mailer.js (Promotions → Mailers, the promotional platform's studio) takes the same helpers */
var promoMailer = function (handler) {
  var run = inModule('promo-mailer', handler);
  return function (req, res) {
    try { require('./promo-mailer').wire(promoHelpers()); } catch (e) { /* inModule() logs it and answers 503 */ }
    return run(req, res);
  };
};

/* "METHOD path" -> handler, for every route with a fixed path. */
var ROUTES = {
  'POST /api/suggest-design': handleSuggestDesign,
  'POST /api/chat-edit': handleChatEdit,
  'POST /api/chat/turn': handleChatTurn,
  'GET /api/chat/history': handleChatHistory,
  'POST /api/extract-brief': handleExtractBrief,
  'POST /api/ingest-source': handleIngestSource,
  'GET /api/et/portals': handleEtPortals,
  'GET /api/et/events': handleEtEvents,
  'POST /api/plan-structure': handlePlanStructure,
  'POST /api/generate-content': handleGenerateContent,
  'POST /api/redesign-section': handleRedesignSection,
  'GET /api/draft': handleGetDraft,
  'GET /api/generated-template': handleGeneratedTemplate,
  'GET /api/generated-section': handleGeneratedSection,
  'POST /api/import-lovable': handleImportLovable,
  'GET /api/imported-template': handleImportedTemplate,
  'GET /api/imported-section': handleImportedSection,

  'POST /api/event': handleEventCreate,
  'GET /api/event': handleEventGet,
  'PATCH /api/event': handleEventUpdate,
  'DELETE /api/event': events('handleEventDelete'),
  'GET /api/events': handleEventsList,
  'GET /api/event/slug-available': events('handleSlugAvailable'),
  'POST /api/event/restore': events('handleEventRestore'),
  'POST /api/event/clone': events('handleEventClone'),
  'POST /api/event/upload': events('handleUpload'),
  'GET /api/event/hero-video': heroVideo('handleHeroVideoGet'),
  'PUT /api/event/hero-video': heroVideo('handleHeroVideoSave'),
  'DELETE /api/event/hero-video': heroVideo('handleHeroVideoRemove'),
  'POST /api/event/hero-video/upload': heroVideo('handleHeroVideoUpload'),
  'POST /api/event/hero-video/check': heroVideo('handleHeroVideoCheck'),

  'GET /api/event/site': handleSiteGet,
  'PUT /api/event/site': handleSitePut,
  'POST /api/event/publish': handleEventPublish,
  'POST /api/event/approval/request': handleApprovalRequest,
  'POST /api/event/theme': handleEventTheme,
  'POST /api/event/section-edges': handleEventSectionEdges,
  'POST /api/event/logo-unit': handleEventLogoUnit,
  'POST /api/event/approval/decide': handleApprovalDecide,
  'GET /api/event/approval': handleApprovalGet,
  'GET /api/event/history': handleEventHistory,
  'GET /api/settings/approvals': handleApprovalSettingsGet,
  'PUT /api/settings/approvals': handleApprovalSettingsPut,
  'POST /api/event/unpublish': handleEventUnpublish,
  'POST /api/event/stage': handleEventStage,
  'POST /api/event/live-view': handleEventLiveView,

  'POST /api/event/seed': audience('handleSeed'),
  'GET /api/event/registrations': audience('handleRegistrationsList'),
  'PATCH /api/event/registrations': audience('handleRegistrationUpdate'),
  'DELETE /api/event/registrations': audience('handleRegistrationDelete'),
  'GET /api/event/registrations/export': audience('handleRegistrationsExport'),

  'GET /api/event/forms': formsRoute('handleFormsList'),
  'POST /api/event/forms': formsRoute('handleFormsCreate'),
  'PUT /api/event/forms': formsRoute('handleFormsUpdate'),
  'DELETE /api/event/forms': formsRoute('handleFormsDelete'),
  'POST /api/event/forms/default': formsRoute('handleFormsDefault'),
  'POST /api/event/forms/order': formsRoute('handleFormsOrder'),
  'GET /api/public/forms': formsRoute('handlePublicForms'),
  'GET /api/public/places': formsRoute('handlePublicPlaces'),
  'GET /api/event/dashboard-stats': audience('handleDashboardStats'),
  'GET /api/event/activity': audience('handleActivity'),
  'GET /api/activity/all': inModule('api-activity', 'handleActivityAll'),   // the all-events Activity log page
  'GET /api/insights': audience('handleInsights'),

  'GET /api/promo/kit': promo('handleKit'),
  'GET /api/promo/image': promo('handleImage'),
  'POST /api/promo/write': promo('handleWrite'),
  'GET /api/promo/mailers': promoMailer('handleCatalog'),
  'GET /api/promo/mailer/saves': promoMailer('handleSaves'),
  'GET /api/promo/mailer/roster': promoMailer('handleRoster'),
  'POST /api/promo/mailer/doc': promoMailer('handleDoc'),
  'POST /api/promo/mailer/relayout': promoMailer('handleRelayout'),
  'POST /api/promo/mailer/import': promoMailer('handleImport'),
  'POST /api/promo/mailer/render': promoMailer('handleRender'),
  'POST /api/promo/mailer/block': promoMailer('handleBlock'),
  'POST /api/promo/mailer/save': promoMailer('handleSave'),
  'POST /api/promo/mailer/save/rename': promoMailer('handleRename'),
  'POST /api/promo/mailer/save/delete': promoMailer('handleDelete'),
  'POST /api/promo/mailer/reset': promoMailer('handleReset'),
  'POST /api/promo/mailer/download': promoMailer('handleDownload'),
  'POST /api/promo/mailer/ai': promoMailer('handleAi'),
  'GET /api/promo/icons': promoMailer('handleIcons'),
  'POST /api/promo/icons': promoMailer('handleIconUpload'),
  'DELETE /api/promo/icons': promoMailer('handleIconDelete'),

  'POST /api/event/leads/bulk': handleLeadsBulkCreate,
  'PATCH /api/event/leads/bulk': handleLeadsBulkUpdate,
  'DELETE /api/event/leads/bulk': handleLeadsBulkDelete,

  'GET /api/public/site-data': audience('handlePublicSiteData'),
  'POST /api/register': audience('handleRegister'),
  'POST /api/track': audience('handleTrack')
};

/* The routes a published page calls from a visitor's browser — the same list lib/access.js lets through
   the sign-in gate. A browser asks permission first (OPTIONS) when the page is on another host. */
function isPublicApiPath(urlPath) {
  return urlPath === '/api/register' || urlPath === '/api/track' || urlPath.indexOf('/api/public/') === 0;
}

function routeApi(req, res) {
  var urlPath = String(req.url || '').split('?')[0];

  /* /e/<id> and /preview/<id>, and a site's internal pages: /e/<id>/<slug>, /preview/<id>/<slug> (site-pages.js) */
  var page = /^\/(e|preview)\/([^\/]*)(?:\/([^\/]+))?\/?$/.exec(urlPath);
  if (page || /^\/(e|preview)\//.test(urlPath)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); return res.end(); }
    var eventId = '', slug = '';
    if (page) { try { eventId = decodeURIComponent(page[2]); slug = page[3] ? decodeURIComponent(page[3]) : ''; } catch (e) { eventId = ''; } }
    if (!page || !isEventId(eventId) || (slug && !sitePages.SLUG_RE.test(slug))) return sendNotAvailable(req, res);
    return page[1] === 'e' ? handlePublicPage(req, res, eventId, slug) : handlePreviewPage(req, res, eventId, slug);
  }

  if (urlPath === '/robots.txt' || urlPath === '/sitemap.xml') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); return res.end(); }
    return urlPath === '/robots.txt' ? handleRobotsTxt(req, res) : handleSitemapXml(req, res);
  }

  if (req.method === 'OPTIONS' && isPublicApiPath(urlPath)) return audience('handlePublicOptions')(req, res);

  var handler = ROUTES[req.method + ' ' + urlPath];
  if (handler) return handler(req, res);

  var resourceMatch = /^\/api\/event\/([a-z-]+)$/.exec(urlPath);
  if (resourceMatch && has(RESOURCES, resourceMatch[1])) {
    var R = RESOURCES[resourceMatch[1]];
    if (req.method === 'GET') return R.list(req, res);
    if (req.method === 'POST') return R.create(req, res);
    if (req.method === 'PATCH') return R.update(req, res);
    if (req.method === 'DELETE') return R.remove(req, res);
  }

  sendJson(res, 404, { error: 'No such endpoint: ' + req.method + ' ' + urlPath });
}

module.exports = { handleApi };

// A handful of internal functions, exported ONLY so a test can call the real logic in-process — the
// import pipeline and the AI sanitizers without a live Gemini call or a real ID token, and the publish
// transform on a page held in a file. Nothing in this repo's runtime imports from this property.
module.exports._testHooks = {
  onDarkCopy: onDarkCopy, redrawYearInPng: redrawYearInPng, classifyGlimpses: classifyGlimpses, unstyledSectionIds: unstyledSectionIds, emptyPictureBox: emptyPictureBox, dropPicture: dropPicture, embedsMainPicture: embedsMainPicture, usableLogoPicture: usableLogoPicture,
  aiDesignOf: aiDesignOf,
  publishVersion: publishVersion,   // tools/republish-current.js: the published version again, through today's publish step
  confirmEtPick: confirmEtPick, pageKey: pageKey, sitePortal: sitePortal, footerEvents: footerEvents, siteFooter: siteFooter,
  extractThemeFromPreviousEditionSources, editionLookLines, placeDirection, readEditionLook, keptKeyVisual, ingestSchemaFor, buildSectionImage, fetchSourceCss, aiUsageRecorder,
  processLovableImport, runImportLovableFromZip, runImportLovableFromUrl, importRenderedPage, validateImportUrl,
  sanitizeGeneratedSectionHtml, sanitizeGeneratedSectionCss,
  buildRedesignPrompt, stripEditorMarks, generatedPageIds, sanitizeDesignPlanSections, fewerPeoplePictures, awardPlanSections, withAwardRecords, etPictureRules, newStandardPictures, MAX_SECTION_IMAGES: MAX_SECTION_IMAGES, awardForSite, writeAwardPages, awardPageContent, seedAwardFaqs, seedAwardJury, chatRateOk: chatRateOk, CHAT_RATE: CHAT_RATE, buildChatPrompt: buildChatPrompt, chatView: chatView, sparseOverviewText, SPARSE_OVERVIEW_CHARS: SPARSE_OVERVIEW_CHARS, readAwardRecord, awardPickByLink, readSectionPictures, MAX_PEOPLE_PICTURES: MAX_PEOPLE_PICTURES, buildDesignPlanPrompt: buildDesignPlanPrompt,
  buildExtractBriefPrompt, buildIngestSourcePrompt, buildDesignPlanPrompt, buildSectionCodePrompt, designReference,
  TOKEN_KIT: TOKEN_KIT, selectSitePage: selectSitePage,
  publishTransform, ensureFormsRuntime, deliverPage, cachePage, cachedPage, HTML_TOOLS, acceptedEncoding, FORMS_RUNTIME_V, sitePagePass: function (html, o) { return siteA11y.pagePass(html, o, TOKEN_KIT); }, applyHeroVideo, heroVideoStamp, heroVideoPictures, chatResponseSchema, buildChatPrompt, rewriteOrigins, tokenizeHtml, cleanSettings, mergeSettings, eventStateOf,
  buildLogoUnit, foundLogoUnit, logoUnitInTime, previousUnitNote, previousEditionUnit, unitSources, ownerLogoUnit, examineUnit, ownerLogoState, swapHeroUnit, saveOwnerUnit, ownerUnitInputs, briefYearTexts, readLogoPicture, moveYearInPng, yearOnly, inkOfText, cropToOwnUnit, ownUnitBox, cropSvgToOwnUnit, sameDrawing, LOGO_READ_SCHEMA, rasterTone, sectionCodeBatches, DESIGN_PLAN_SCHEMA, SECTION_CODE_SCHEMA, rasterise, yearCutColour, yearFont
};
