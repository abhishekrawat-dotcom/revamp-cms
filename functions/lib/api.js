// The /api/*, /e/*, /preview/*, /s/*, /t/* and /img/* endpoint logic — the ONE place it's routed (routeApi at the
// end of this file). It runs behind functions/lib/web-server.js, the same in production (server.js on Firebase App
// Hosting) and locally (tools/serve.js); the QA harness calls handleApi directly. req and res are Node's own
// http.IncomingMessage and ServerResponse. Signed in or public: the sign-in gate (lib/access.js) lets a signed-out
// request reach only the public routes named below, and every route that is not public checks the caller itself
// as well (requireAdmin / requireMember in lib/http.js, CALLER_CHECKED below) — it never relies on the gate alone.
//
//   The AI routes — the site-generation pipeline and the AI steps around it (lib/api-generate.js) and the editor's
//   ETB2B AI chat (lib/api-chat.js) — are routed here and listed under "Routed here, implemented elsewhere" below; each
//   file's header describes its routes. Every model call there goes through lib/gemini.js. When one fails the route answers
//   { error, code, retryable } — code is ai-quota (429) | ai-config (503) | ai-rejected | ai-unavailable |
//   ai-bad-output (502) | ai-timeout (504, with timeoutMs) | ai-blocked (422) — and error is a sentence
//   that can be shown as it is. A person's paid steps are limited per
//   route (429 rate-limited, lib/http.js AI_RATE).
//
//   -- Event console, the saved site and the public site. Every route here except the public ones needs a
//      verified Firebase ID token for a company account (requireAdmin in lib/http.js). An "event" is a
//      document that was created as one (it has createdAt) and has not been deleted — see eventStateOf().
//   POST  /api/event                        create; 409 { code:'slug-taken', suggestion } over an existing one.
//                                           `portal`, the ET portal the event belongs to, is required.
//   GET   /api/event?eventId=               read one
//   PATCH /api/event                        update details and `settings`; 404 if there is no such event. A
//                                           portal can be changed (with `ifPortal`), never removed.
//   GET   /api/events                       every live event, team-wide (this is a shared CMS: no per-user
//                                           filter), newest-updated first, with published / publishedPath /
//                                           counters and portal / portalName. No deleted events, import
//                                           records or leftover shells.
//                                           ?deleted=1 lists the deleted ones instead (to restore them).
//   POST/PATCH/DELETE /api/event/leads/bulk import, change or delete up to 500 leads in one request
//   GET/POST/PATCH/DELETE /api/event/<resource>   the per-event content lists — speakers, speaker-groups,
//                                           sessions, agenda-groups, partners, partner-tiers, gallery, faqs,
//                                           contacts — and the Promotions pages' leads, promo-templates and
//                                           promo-audiences. See subcollectionRoutes() / RESOURCES.
//   GET / PUT /api/event/site               the site as the editor saved it (snapshot + page), versioned;
//                                           a stale save answers 409.
//   GET   /api/event/site-outline           what the site shows of the Content tabs (lib/site-outline.js): the
//                                           sections that list speakers, sessions, sponsors…, the previous
//                                           edition's own sections, the banner's logo — for the console's notes.
//   POST  /api/event/publish | unpublish    put the saved site live at /e/<id> / take it down.
//   POST  /api/event/stage                  the editor's Preview: the page in that person's editor, saved or not
//                                           ({ draft: true }), shown at /preview/<id>?draft=1. Theirs alone.
//   POST  /api/event/live-view              the editor's "Edit with AI" live view: the page through the
//                                           preview transform, answered, never stored.
//   GET   /e/<eventId>                      PUBLIC — the published site, served from private Storage.
//   GET   /preview/<eventId>                signed-in — what would be published right now.
//   GET   /img/<object path>                PUBLIC — a picture of the storage bucket that is public there, from our own
//                                           address so the hosting's CDN keeps it near the visitor (lib/picture-cdn.js;
//                                           the pages a visitor gets name their pictures there: lib/delivery.js step 7).
//   GET   /s/<token>[/<slug>]               PUBLIC — a shareable preview link: the site as last saved, for people
//                                           without an ET account, for 7 days or until stopped. With
//                                           GET/POST /api/event/share-preview and POST /api/event/share-preview/stop
//                                           (make, list, stop), all in lib/share-preview.js (see shareRoute()).
//
//   Routed here, implemented elsewhere (loaded on demand; see inModule()):
//     lib/api-events.js    POST /api/event/upload, GET /api/event/slug-available, DELETE /api/event,
//                          POST /api/event/restore, POST /api/event/clone
//     lib/api-audience.js  GET /api/public/site-data, POST /api/register, POST /api/track (all PUBLIC),
//                          POST /api/event/seed, GET/PATCH/DELETE /api/event/registrations,
//                          POST /api/event/registrations/status (one status for several), GET /api/event/registrations/export (CSV),
//                          GET /api/event/dashboard-stats, GET /api/insights, GET /api/event/activity
//     lib/api-forms.js     an event's registration forms: GET/POST/PUT/DELETE /api/event/forms,
//                          POST /api/event/forms/default, POST /api/event/forms/order,
//                          GET /api/public/forms (PUBLIC — what a visitor's page is told about them)
//     lib/event-portal.js  GET /api/events/portal-evidence (what says which ET portal each existing event is on,
//                          read only), POST /api/events/portal-backfill (an approver fills in the portals they
//                          ticked, only where that evidence is still certain)
//     lib/working-portal.js GET / PUT /api/me/working-portal (the portal a person works on, kept for that person)
//     lib/create-drafts.js GET /api/me/create-drafts, GET/PUT/DELETE /api/me/create-draft, GET/POST
//                          /api/me/create-draft/file (Create Event's unfinished drafts and their pictures, each person's own)
//     lib/promo.js         GET /api/promo/kit, GET /api/promo/image, POST /api/promo/write (the Promotions
//                          pages: an event's brand and content, its pictures from our own address, AI copy)
//     lib/promo-track.js   GET /t/o/<id>.gif, GET /t/c/<id> (PUBLIC — a mailer's open pixel and click redirect),
//                          GET /api/promo/analytics, GET /api/promo/analytics/all
//     lib/promo-mailer.js  GET /api/promo/mailers, /api/promo/mailer/* except previews and banner (open, render,
//                          save, download, AI …),
//                          GET/POST/DELETE /api/promo/icons, POST /api/promo/mailer/picture (Promotions → Mailers,
//                          the platform's mailer studio)
//     lib/promo-social.js  Promotions → Social posts (the platform's post templates): GET /api/promo/social/catalog,
//                          GET/POST/DELETE /api/promo/social/art, POST /api/promo/social/art/psd and /art/default,
//                          POST /api/promo/social/html, GET/POST /api/promo/social/layout, GET /api/promo/social/layouts,
//                          POST /api/promo/social/layout/base, POST /api/promo/social/layout/reset,
//                          POST /api/promo/social/picture
//     lib/promo-previews.js  POST /api/promo/mailer/previews (each mailer card's live preview of this event's mail)
//     lib/promo-banner.js  GET/POST /api/promo/mailer/banner (the mailers' top banner picture, drawn in the browser)
//     lib/dash-bot.js      ETB2B AI on the events dashboard: POST /api/dash-bot (one message, one answer, at most
//                          one action), POST /api/dash-bot/turn (what became of that action: done, undone, failed),
//                          GET /api/dash-bot/history (your own conversation; ?all=1 everyone's, for the approvers).
//                          It reads the same events GET /api/events lists, through liveEventDocs() — see
//                          dashBotHelpers() for what it is handed.
//     lib/ai-learn.js      the record of what people ask ETB2B AI (both chats write it), GET /api/ai-report and
//                          POST /api/ai-report/resolve (the approvers' report), POST /api/ai-qa/note (a page error).
//     lib/ai-habits.js     what the record makes faster: GET /api/ai-habits (the panel's one-click suggestions and the
//                          person's shortcuts), POST /api/ai-habits/shortcuts (save, rename, delete one), and the
//                          team's examples every ETB2B AI prompt gets (examplesFor).
//     lib/ai-hero.js       POST /api/event/ai-hero: the first hero picture of an event started from the dashboard's
//                          ETB2B AI, made once Create Event has created the event (one per event, a small daily
//                          allowance per person) — see aiHeroHelpers() for what it is handed.
//     lib/phone-banner.js  POST /api/event/phone-banner: the banner's own picture for phones, laid out by ETB2B AI from
//                          the banner the site has now (the editor's Phone banner) — see phoneBannerHelpers().
//     lib/api-generate.js  the AI site-generation pipeline and the AI steps around it: POST /api/suggest-design,
//                          POST /api/extract-brief, POST /api/ingest-source, POST /api/plan-structure,
//                          POST /api/generate-content, GET /api/generate/status, POST /api/generate/cancel,
//                          POST /api/redesign-section, GET /api/draft, GET /api/generated-template,
//                          GET /api/generated-section — see generateHelpers() for what it is handed.
//     lib/api-chat.js      ETB2B AI, the editor's chat: POST /api/chat-edit, POST /api/chat/turn, GET /api/chat/history
//                          — see aiChatHelpers().
//     lib/api-import.js    the Lovable import pipeline (a live site's own URL -> a third template kind, 'imported-<id>'):
//                          POST /api/import-lovable, GET /api/imported-template, GET /api/imported-section — see
//                          importHelpers(). The imports nobody took: POST /api/imports/sweep, lib/import-sweep.js.
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const crypto = require('crypto');
const zlib = require('zlib');
const { getFirebase } = require('./firebase');

/* Request plumbing (JSON in/out, body size limits, who is calling) lives in ./http and is shared with
   lib/api-events.js and lib/api-audience.js, so the three modules cannot drift apart on what a too-large
   body, a non-object JSON body or an expired sign-in is answered with. */
const { sendJson, failureRef, parseJsonBody, requireAdmin, requireMember, adminFromRequest, isEventId, isReservedEventId,
  isEmail, CONTENT_STATUSES, str } = require('./http');
const { logActivity, actorOf, maskEmail, sectionNames } = require('./activity');
/* a shareable preview link's address, written into a log line without its token (lib/share-token.js) */
const shareToken = require('./share-token');
const { callGeminiJson, callGeminiImage } = require('./gemini');
/* every text call goes through llm.js: Claude first when its key is set, Gemini as the fallback */
const llm = require('./llm');
const logoUnit = require('./logo-unit');
const pngLite = require('./png-lite');
const svgYear = require('./svg-year');
const ownerBrief = require('./owner-brief');
const etPrevious = require('./et-previous');
const etEvents = require('./et-events');
const accessControl = require('./access-control');
/* the rules of Content › Basics' three details for posts and mailers (pure: no Firebase, no model) */
const promoDetails = require('./promo-details');
/* Settings › URL & SEO: its fields and their published copy (seo-fields.js); the structured data built from them,
   holding only what a page shows (seo-schema.js) */
const seoFields = require('./seo-fields');
const seoSchema = require('./seo-schema');
const googleFonts = require('./google-fonts');
/* The one sanitiser for markup this server did not write itself (a model's sections, a page copied from another
   site): an allow-list on a real parser, applied when such markup is stored and again when it is served. */
const sanitize = require('./sanitize');
/* an AI-designed site's generations (runs) and where its sections are kept (BE-029, BE-032) */
const generatedSite = require('./generated-site');
const etNav = require('./et-nav');
/* registration forms: their shape, the public definitions, the AI chat's form changes (pure) */
const formsLib = require('./forms');
const etFooter = require('./et-footer');
const pictures = require('./pictures');
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
/* a Lovable import that did not work, said so (BE-048) */
const importCheck = require('./import-check');
const { diffPages, summarise, listed, changeCount } = require('./page-diff');
/* the event's records drawn into a saved site on the server (Content reaches the staged copy at once) */
const siteRecords = require('./site-records');
/* the request waiting on each event of the list, and the AI-written sections nobody has checked (UX-102, UX-105) */
const approvalList = require('./approval-list');
const { safeFetch, checkPublicUrl } = require('./safe-fetch');
/* accessibility and search on every published page (site-a11y.js pagePass; site-seo.js robots.txt, sitemap.xml) */
const siteA11y = require('./site-a11y');
const siteSeo = require('./site-seo');
/* the one address of the published sites (UX-001) */
const publicBase = require('./public-base');
const sitePages = require('./site-pages');
/* the picture a link to a site shows: its banner's background with the logo unit on it (share-card.js). It draws
   an SVG unit with this file's own rasterise and the year font the unit carries, as the logo-unit code does */
const shareCard = require('./share-card');
/* and, for a banner that plays a video with no still, ETB2B AI's picture behind its card (share-still.js), whose
   model calls are added to the event's AI usage like every other */
shareCard.wire({ rasterise: rasterise, embeddedYearFont: embeddedYearFont, aiUsageRecorder: aiUsageRecorder });
/* what would be wrong to put live, and the repairs every live page gets on its way out (site-checks.js) */
const siteChecks = require('./site-checks');
/* what ETB2B AI wrote that nothing the event supplied supports (BE-043) */
const inventedFacts = require('./invented-facts');
/* the check before Publish: what is good to put right, advisory (owner decision #11, part 3.2) */
const siteAdvisory = require('./site-advisory');
/* what the site shows of the console's Content tabs, read off its page (site-outline.js) */
const siteOutline = require('./site-outline');

/* How much each route will read before answering 413. Nothing here used to bound a request body at all:
   one unauthenticated 100 MB POST was buffered whole before any check ran. Each limit is the largest
   legitimate body for that route with headroom, not a round number for its own sake. */
var KB = 1024, MB = 1024 * 1024;
var BODY_LIMITS = {
  ai: 2 * MB,             // suggest-design / chat-edit / generate-content: the page's section texts as JSON
  small: 256 * KB,        // ingest-source, plan-structure: ids and a URL
  brief: 22 * MB,         // extract-brief: a 15 MB document, base64-encoded (x 4/3), plus the event basics
  event: 512 * KB,        // POST / PATCH /api/event: an event document is itself capped at 1 MiB by Firestore
  record: 256 * KB,       // one speaker / session / sponsor / FAQ record; images are uploaded, never inline
  site: 12 * MB,          // PUT /api/event/site, and a publish / stage request that still carries the page
  tiny: 16 * KB,          // { eventId } and nothing else
  assist: 22 * MB,        // POST /api/dash-bot: a message, the page's place, up to four ≤160 KB picture thumbnails and PDFs of up to 15 MB in all (base64; lib/ai-docs.js)
  aiDocs: 24 * MB         // POST /api/chat-edit and /api/promo/ai-edit: a page's sections or a post, with PDFs of up to 15 MB in all (base64)
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
var DESIGN_NUMERIC_FIELDS = { bodySize: [12, 24], headingSize: [20, 64], sectionSpacing: [0, 140], bgOpacity: [0, 100], heroVeil: [0, 100] };
var DESIGN_FIELDS = DESIGN_COLOR_FIELDS.concat(DESIGN_FONT_FIELDS, Object.keys(DESIGN_ENUM_FIELDS), DESIGN_WEIGHT_FIELDS, Object.keys(DESIGN_NUMERIC_FIELDS));

/* ET's rule for every logo of its verticals (the owner, 23 Oct 2026), in every prompt that can style or edit a
   page or a logo: when a logo's colour changes, only its black lettering may change; the red ET square never. */
var NAME_RULE = require('./name-rule').NAME_RULE;
var ET_LOGO_COLOUR_RULE = 'ET LOGOS (every vertical\'s — ETAuto, ETHRWorld, ETRetail and the rest — and The Economic Times Business Verticals logo): if a logo\'s colour must change to suit a dark or a light ground, ONLY its black lettering may change (to white or another colour). The red ET square, with the white "ET" in it, is NEVER changed at any cost: never recoloured, tinted, inverted, filtered (no CSS filter, mix-blend-mode or opacity on a logo), outlined, boxed or redrawn. Never recolour a logo picture yourself: the site already has the right version of each logo for a dark and a light ground.';

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
function chatUserRef(fb, eventId, uid) { return eventDocRef(fb, eventId).collection('aiChats').doc(String(uid).replace(/[^A-Za-z0-9_@.-]/g, '_').slice(0, 120)); }
function chatUid(decoded) { return String((decoded && (decoded.uid || decoded.email)) || 'anon'); }
function chatName(decoded) { return String((decoded && (decoded.name || decoded.email)) || 'Someone').slice(0, 120); }
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

/* A roster portal's name ("hr" -> "ETHRWorld"), '' for anything else — so a value that is not on the roster is
   never shown as if it were a portal. */
function portalNameOf(slug) { return etEvents.isPortal(slug) ? etEvents.PORTALS[slug] : ''; }

/* ---------- GET /api/et/portals, GET /api/et/events?portal=<slug>[&kind=award] — Create Event's previous-edition picker ----------
   ET's B2B portals, and one portal's own (IP) events from ET's event API — or, with kind=award (an Awards
   event), the portal's awards from ET's award listing (et-events.js; each kept 6 hours). */
function etJson(u, headers) {
  return safeFetch(u, { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024, headers: Object.assign({ accept: 'application/json' }, headers || {}) })
    .then(function (r) { return r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null; });
}
function handleEtPortals(req, res) {
  /* someone who works in chosen portals is offered only those (lib/access-control.js) */
  withAdmin(req, res, function (fb, decoded) {
    var access = decoded && decoded.access;
    sendJson(res, 200, { portals: etEvents.portalList().filter(function (p) { return !access || accessControl.portalOk(access, p.slug); }) });
  });
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
      sendJson(res, 502, { error: 'ETB2B\'s ' + (kind === 'award' ? 'award' : 'event') + ' list could not be read right now. Please try again in a few minutes.', code: 'et-down' });
    });
  });
}

/* the top bar's short names for an award site's internal pages */
var AWARD_TAB_LABELS = { 'award-category': 'Categories', 'award-guidelines': 'Guidelines', 'award-judging-criteria': 'Judging Criteria', 'award-jury': 'Jury', 'award-faq': 'FAQs', 'award-tnc': 'T&C' };

/* the family's stylesheet, asking only for weights it has ('' for a family not on Google Fonts) */
function googleFontUrl(family) {
  return googleFonts.cssUrl(family);
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
function workingCopy(svgText, font) {
  if (!svgText) return Promise.resolve(null);
  return rasterise(svgText, { clear: true, font: font || null }).then(function (r) {
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
   -> a decoded RGBA picture, or null when the lock-up has little such lettering (darkCopyOf says why) */
function onDarkCopy(img) { return darkCopyOf(img).copy || null; }
/* -> { copy: a decoded RGBA picture } | { why } — why no copy could be made, for the owner (darkCopyNote):
     'solid': the picture has no see-through ground (a JPEG, or a flattened PNG), so there is no lettering standing on it;
     'coloured': its lettering is in colour — only black lettering may change, by ET's rule;
     'light': it has no dark lettering at all — drawn for a dark ground, most likely;
     'plate': its dark lettering sits on a plate of its own, which stays as drawn */
function darkCopyOf(img) {
  var w = img.width, h = img.height, d = img.data, N = w * h, out = Buffer.from(d), i;
  /* dark lettering, drawn at all (its soft edges too): a pixel with no colour of its own darker than mid-grey, or one
     so dark it reads as black whatever its tint: no channel above 90. A tagline running from
     deep maroon to black (AutoTech Summit 2027's) was turned white only where its tint fell under the line, half of
     it, on 28 Oct 2026. A colour that shows as one stays, by ET's rule: the ET red, a navy (#1F3864), a maroon
     (#800000) or an indigo (#4B0082) wordmark all have a channel above 90. */
  var ink = new Uint8Array(N), seen = new Uint8Array(N);
  var clearAll = 0, coloured = 0, light = 0;
  for (i = 0; i < N; i++) {
    var o = i * 4, r = d[o], g = d[o + 1], b = d[o + 2], a = d[o + 3];
    var top = Math.max(r, g, b), chroma = top - Math.min(r, g, b), luma = 0.299 * r + 0.587 * g + 0.114 * b;
    ink[i] = a >= 24 && luma < 140 && (chroma <= 40 || top <= 90) ? 1 : 0;
    if (a < 24) clearAll++;
    else if (a > 128) { if (chroma > 40) coloured++; else if (luma >= 200) light++; }
  }
  /* no see-through ground: there is no lettering standing on one, and the whole picture would be one dark stroke
     (a white wordmark on a black field came out as a blank white picture) */
  if (clearAll < N * 0.02) return { why: 'solid' };
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
        if (q < 0) continue;                    // the picture's edge says nothing of the ground (a plate filling it would read as standing on it)
        if (ink[q]) { if (!seen[q]) { seen[q] = 1; stack.push(q); } continue; }
        ring++;
        if (d[q * 4 + 3] < 24) clear++;
      }
    }
    var strong = 0;
    members.forEach(function (m) { if (d[m * 4 + 3] > 128) strong++; });
    inked += strong;
    /* on the see-through ground (most of what touches it is clear): lettering to turn; on a plate: left as drawn. A run
       with nothing solidly drawn in it is a soft fringe (around the ET red square), never lettering: left as drawn */
    if (!strong || !ring || clear / ring < 0.3) continue;
    turned += strong;
    members.forEach(function (m) {
      var o = m * 4, lum = Math.round(0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]);
      out[o] = out[o + 1] = out[o + 2] = 255 - lum;                                  // black -> white
    });
  }
  if (turned && turned / inked > 0.4 && turned > opaque * 0.005) return { copy: { width: w, height: h, data: out } };
  if (inked <= opaque * 0.005) return { why: light > coloured ? 'light' : 'coloured' };
  return { why: 'plate' };
}

/* What the owner is told when a lock-up on a light banner has no copy for a dark ground (storeOnDarkUnit): on a
   light site the banner stays light in a dark theme; on a dark site the banner is light from the start. Never
   that the logo is broken — it shows as drawn — but, where it may not, what to do. */
var DARK_COPY_WHY = {
  solid: 'the logo is a picture with a solid background, not a see-through one',
  coloured: 'its lettering is in colour, and only black lettering may be changed for a dark background',
  light: 'it has no dark lettering to change. If it looks faint on the light banner, it was drawn for a dark background: upload the version for light backgrounds under Event logo in the event\'s Basics',
  plate: 'its lettering sits on the logo\'s own background, which stays as drawn',
  text: 'its lettering is live text in the SVG, which cannot be changed safely here',
  failed: 'the copy could not be made just now. Upload the logo again under Event logo in the event\'s Basics to try again'
};
function darkCopyNote(why, darkSite) {
  var reason = DARK_COPY_WHY[why] || DARK_COPY_WHY.failed;
  return (darkSite ? 'The banner stays light on this dark site, so the logo shows as drawn: no copy of it for a dark background could be made, because '
    : 'In a dark theme the banner stays light, so the logo shows as drawn: no copy of it for a dark background could be made, because ') + reason + '.';
}
/* The font a year moved here was set in (svg-year.js replaceYear embeds it as 'rvyear'), when every text in the
   drawing is set in it -> { family, ttfBase64 } for rasterise, or null: text in any other font cannot be drawn here */
function embeddedYearFont(svgText) {
  var m = /@font-face\{font-family:'rvyear';src:url\(data:font\/ttf;base64,([A-Za-z0-9+\/=]+)\)/.exec(String(svgText || ''));
  if (!m) return null;
  var texts = String(svgText).match(/<text\b[^>]*>/gi) || [];
  return texts.length && texts.every(function (t) { return /font-family="'rvyear',/.test(t); }) ? { family: 'rvyear', ttfBase64: m[1] } : null;
}
/* The lock-up made again for a dark ground -> Promise<{ url, storagePath, width, height } | { why }>, never rejects.
   why (darkCopyOf, plus): 'text' — an SVG whose lettering is live <text> in a font it does not carry: drawn here with
   no fonts, the copy would lose it (the event's name drawn for a light site came out as the ET logo alone, 28 Oct
   2026); a year moved here as text is drawn in the font embedded with it (embeddedYearFont); 'failed' — the
   picture could not be had or worked on. Read from this project's bucket, else fetched (fetchOwnerLogo: an
   owner's logo used as uploaded can live elsewhere). */
function storeOnDarkUnit(fb, eventId, stamp, unit) {
  function failed(what) { console.error('logo unit: the dark-ground copy of ' + eventId + '\'s lock-up was not made — ' + what); return { why: 'failed' }; }
  if (!unit || !fb || !fb.bucket || !(unit.storagePath || /^https:\/\//i.test(String(unit.url || '')))) return Promise.resolve(failed('there is no picture to copy'));
  var got = unit.storagePath
    ? fb.bucket.file(unit.storagePath).download().then(function (r) { return r && r[0]; }, function () { return fetchOwnerLogo(fb, unit.url); })
    : fetchOwnerLogo(fb, unit.url);
  return got.then(function (bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) return failed('the picture could not be read');
    var info = logoUnit.imageInfo(bytes);
    if (!info.type) return failed('it is not a picture');
    var yearFont = null;
    if (info.type === 'svg') {
      var text = bytes.toString('utf8');
      if (svgCouldRun(text)) return failed('its SVG could run code');
      /* a year moved here as text (svg-year.js replaceYear) is drawn in the font it carries; other text cannot be */
      if (/<text[\s>]/i.test(text) && !(yearFont = embeddedYearFont(text))) return { why: 'text' };
    }
    var decodedP = info.type === 'svg' ? workingCopy(bytes.toString('utf8'), yearFont)
      : info.type === 'png' && info.width * info.height <= LOGO_UNIT_DECODE_PIXELS ? Promise.resolve({ decoded: pngLite.decode(bytes) })
      : workingCopy(wrapPictureSvg({ bytes: bytes, info: info }));
    return decodedP.then(function (copy) {
      if (!copy || !copy.decoded) return failed('it could not be drawn to work on');
      var made = darkCopyOf(copy.decoded);
      if (!made.copy) return { why: made.why };
      var png = pngLite.encode(made.copy), storagePath = 'events/' + eventId + '/generated/' + stamp + '-logo-unit-on-dark.png';
      return storePublicPicture(fb, storagePath, png, 'image/png').then(function (url) {
        /* shown at the size the original is */
        return { url: url, storagePath: storagePath, width: unit.width || made.copy.width, height: unit.height || made.copy.height };
      });
    });
  }).then(null, function (err) { return failed(err && err.message); });
}

/* what the event says about its year beyond its name and dates: the brief's own words */
function briefYearTexts(brief, eventMeta) {
  brief = brief || {};
  var vi = brief.visualIdentity || {}, owner = brief.owner || {}, points = brief.ownerPoints || {};
  return [vi.ipName, vi.ipTagline, owner.tagline, points.tagline, brief.theme].concat(Array.isArray(brief.keyMessages) ? brief.keyMessages : [])
    .concat([(eventMeta || {}).description]).map(function (t) { return String(t || ''); }).filter(Boolean);
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

/* ---------- the owner's logo after the site was made ----------
   An AI-designed site keeps its logo unit in two places the server writes: designPlan.design.logoUnit*
   (what the hero is built from) and the generated hero (generated-site.js; what the editor opens before the site
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
/* the tone of banner a new unit is shown on once it is the design's: its own, else the site's — never the tone of the
   unit it replaces, which says nothing of it (as handleGenerateContent builds the hero from the design) */
function unitHeroMode(unit, design) {
  return /^(dark|light)$/.test(String(unit.heroMode)) ? unit.heroMode : (design.mode === 'dark' ? 'dark' : 'light');
}
function saveOwnerUnit(fb, eventId, unit, opts) {
  /* opts.heroNote false: the hero's unit carries no note (the design keeps it) */
  var heroNote = !(opts && opts.heroNote === false);
  var ref = fb.db.collection('events').doc(eventId), out = null;
  var stamp = (opts && opts.stamp) || new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  /* The unit's copy for a dark ground, made before the transaction (it writes a file, and a transaction can run more
     than once): a unit on a light banner gets one, as when the site was designed (plan-structure), and the copy of
     the unit it replaces is dropped — shown in its place, it would bring the old logo back (a dark site shows the
     copy as its unit; a light one in a dark theme). */
  return ref.get().then(function (snap) {
    var design = snap.exists ? (((snap.data() || {}).designPlan || {}).design || {}) : {};
    var wants = unitHeroMode(unit, design) === 'light' && unit.url && !unit.plate;
    return wants ? storeOnDarkUnit(fb, eventId, stamp, unit).then(function (dark) { return { wants: true, dark: dark }; }) : { wants: false, dark: null };
  }).then(function (made) {
    var dark = made.dark && made.dark.url ? made.dark : null;
    return fb.db.runTransaction(function (tx) {
      /* a transaction can run more than once: what it found is the last run's */
      out = { heroUpdated: false, savedSite: false, toneClash: '', note: unit.note || '', darkUrl: dark ? dark.url : '' };
      return tx.get(ref).then(function (snap) {
        if (eventStateOf(snap) !== 'live') throw httpError(404, 'No event found for "' + eventId + '".', { code: 'event-missing' });
        var data = snap.data(), design = (data.designPlan && data.designPlan.design) || {};
        var darkSite = design.mode === 'dark';
        /* no copy for a dark ground where one was wanted: said on the unit's note, like anything else about it */
        if (made.wants && !dark) out.note = [unit.note, darkCopyNote(made.dark && made.dark.why, darkSite)].filter(Boolean).join(' ');
        var fields = unitFields(Object.assign({}, unit, { note: out.note })), patch = { updatedAt: new Date().toISOString() };
        Object.keys(fields).forEach(function (k) { patch['designPlan.design.' + k] = fields[k]; });
        if (dark) {
          patch['designPlan.design.logoUnitDarkUrl'] = dark.url; patch['designPlan.design.logoUnitDarkStoragePath'] = dark.storagePath;
          patch['designPlan.design.logoUnitDarkOf'] = unit.url;
        } else {
          ['logoUnitDarkUrl', 'logoUnitDarkStoragePath', 'logoUnitDarkOf'].forEach(function (k) { patch['designPlan.design.' + k] = fieldDelete(); });
        }
        out.savedSite = ownerLogoState(data).savedSite;
        /* the generated hero, where the site keeps it (generated-site.js): its run's own document, read in this same
           transaction, or the event's field (a site generated before 13 Nov 2026) */
        var heroRef = generatedSite.sectionRef(fb, eventId, data, 'hero');
        var heroRead = heroRef ? tx.get(heroRef).then(function (h) { return h.exists ? [h.data()] : null; })
          : Promise.resolve(Array.isArray(data.generatedSections) ? data.generatedSections : null);
        return heroRead.then(function (sections) {
          if (sections) {
            var next = sections.map(function (s) {
              if (!s || s.id !== 'hero') return s;
              var heroTone = (/\bhero-on-(dark|light)\b/.exec(String(s.html || '')) || [])[1] || '';
              /* as the hero is built (handleGenerateContent): a dark banner shows a light-drawn unit's copy as the unit;
                 a light banner keeps the copy beside it, for a dark theme */
              var mode = unitHeroMode(unit, design), url = unit.url, darkUrl = '';
              if (mode === 'light' && dark) { if ((heroTone || (darkSite ? 'dark' : 'light')) === 'dark') { mode = 'dark'; url = dark.url; } else darkUrl = dark.url; }
              /* A logo drawn for a dark ground (white lettering) would vanish on a light hero, and the other way
                 round with no copy to show: the hero's own tone is not changed here (its colours and veil are the
                 design's), so such a logo is not swapped in — the owner is told (toneClash), and the design's unit
                 takes effect when the site is next generated. */
              if (heroTone && /^(dark|light)$/.test(String(unit.heroMode)) && mode !== heroTone) { out.toneClash = unit.heroMode; return s; }
              var unitHtml = genDesign.logoUnitImageHtml({ url: url, alt: data.name || eventId, width: unit.width, height: unit.height, plate: unit.plate, note: heroNote ? out.note : '', mode: mode, darkUrl: darkUrl });
              var html = swapHeroUnit(s.html, unitHtml);
              if (html === null || html === s.html) return s;
              out.heroUpdated = true;
              return Object.assign({}, s, { html: html });
            });
            if (out.heroUpdated) {
              if (heroRef) tx.update(heroRef, { html: next[0].html });
              else patch.generatedSections = next;
            }
          }
          tx.update(ref, patch);
        });
      });
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
   -> 200 { aiDesigned, unit: { url, width, height, source, note, heroMode, darkUrl: its copy for a dark ground,
            '' when none was wanted or could be made (the note then says why) } | null, heroUpdated, savedSite,
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
      var stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      return ownerUnitInputs(fb, eventId, data).then(function (o) {
        o.stamp = stamp;
        o.deadlineAt = Date.now() + 100000;
        return ownerLogoUnit(fb, eventId, o);
      }).then(function (unit) {
        if (!unit || unit.refused) return sendJson(res, 422, { error: (unit && unit.note) || 'The logo could not be read as a picture. Upload it again as a PNG, WEBP or SVG.', code: 'logo-unreadable' });
        return saveOwnerUnit(fb, eventId, unit, { stamp: stamp }).then(function (done) {
          sendJson(res, 200, { aiDesigned: true, unit: { url: unit.url, width: unit.width, height: unit.height, source: unit.source, note: done.note, heroMode: unit.heroMode, darkUrl: done.darkUrl }, heroUpdated: done.heroUpdated, savedSite: done.savedSite, toneClash: done.toneClash });
          logActivity(fb, eventId, decoded, 'logo-changed', 'logo put into the site’s design' + (unit.url === info.logoUrl ? ' (as uploaded)' : ' (examined copy)') +
            (done.heroUpdated ? '; banner updated' : done.toneClash ? '; banner kept — the logo is drawn for a ' + done.toneClash + ' background' : ''), { area: 'design' });
        });
      });
    }).catch(function (err) { sendFailure(res, 'logo-unit', err, 'The logo could not be put into the site. Please try again.'); });
  });
}

/* POST /api/event/logo-unit-dark  { eventId, url }
   A picture the owner put into the hero's logo unit in the editor (Replace image, or the event's logo put in for the
   one made automatically) gets its copy for a dark ground, as the unit made with the site does (storeOnDarkUnit): the
   editor sets it beside the picture, or tells the owner why there is none. Fetched from this project's bucket, else
   through safeFetch (public addresses only).
   -> 200 { url, width, height } | { url: '', why, note: what the owner is told (darkCopyNote) } */
function handleEventLogoUnitDark(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var url = String(body.url || '').trim();
    if (!/^https:\/\/[^\s"'<>]+$/i.test(url) || url.length > 2000) return sendJson(res, 400, { error: 'The picture\'s address (https) is required.', field: 'url' });
    fb.db.collection('events').doc(eventId).get().then(function (snap) {
      var state = eventStateOf(snap);
      if (state !== 'live') throw notLiveError(state, eventId);
      var design = ((snap.data().designPlan || {}).design) || {};
      var stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      return storeOnDarkUnit(fb, eventId, stamp, { url: url, storagePath: storagePathOf(fb, url) }).then(function (dark) {
        if (dark.url) return sendJson(res, 200, { url: dark.url, width: dark.width || 0, height: dark.height || 0 });
        sendJson(res, 200, { url: '', why: dark.why, note: darkCopyNote(dark.why, design.mode === 'dark') });
      });
    }).catch(function (err) { sendFailure(res, 'logo-unit-dark', err, 'The logo\'s copy for a dark background could not be made. Please try again.'); });
  });
}

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

// "degrade, never crash" sanitizers (same discipline buildHeroImage elsewhere in this file already uses) —
// strip what matches, keep the rest, never throw on malformed input.
/* An address in a style attribute written with the attribute's own quote marks — style="background-image:
   url("…")" — ends the attribute at url(: the browser reads an empty picture, which then hides the section's real
   background (owner, 10 Nov 2026: CISO Secufest's hero went blank after "reduce the white overlay of this section";
   reproduced in the editor: the model wrote exactly that). Outside the section's <style> blocks, such quotes are
   written as a browser writes them (&quot;, &#39;), which is right in any attribute and reads the same as text. */
function attrUrlQuotes(html) {
  return String(html || '').split(/(<style\b[\s\S]*?<\/style\s*>)/i).map(function (part, i) {
    if (i % 2) return part;
    return part.replace(/url\(\s*"([^"<>]*)"\s*\)/gi, 'url(&quot;$1&quot;)').replace(/url\(\s*'([^'<>]*)'\s*\)/gi, 'url(&#39;$1&#39;)');
  }).join('');
}
/* What a model's section needs before it is read as markup: quotes a browser would misread, and Google fonts only
   (in its <style> blocks and style="" attributes too; no stylesheet <link> of its own). Not a safety step — the
   picture tokens ("rvimg://…") are still in it and are put back as addresses after it; safeGeneratedSection is the
   safety step, and it runs last. */
function tidyGeneratedSectionHtml(html) {
  try {
    return googleFonts.googleOnlyHtml(attrUrlQuotes(String(html || '')));
  } catch (e) {
    console.error('tidyGeneratedSectionHtml failed on malformed input, degrading to empty — ' + e.message);
    return '';
  }
}
function tidyGeneratedSectionCss(css) {
  try {
    /* Google Fonts only: no face of its own, every family named a Google one */
    return googleFonts.googleOnlyCss(String(css || '').replace(/@import\b[^;]*;?/gi, ''));
  } catch (e) {
    console.error('tidyGeneratedSectionCss failed on malformed input, degrading to empty — ' + e.message);
    return '';
  }
}
/* THE safety step for a section of an AI-designed site (BE-025): sanitize.js's allow-list on a real parser (profile
   "generated": no script, handler, frame, form, object or unsafe address survives, however it is written), the
   markup's own <style> rules moved into its CSS, and the CSS through the same rules. Run on every section when the
   site is written (generate-content), on every section the AI reworks (redesign-section, which the chat's
   rework and new-section steps use too), and on every section served (generated-section). -> { html, css } */
function safeGeneratedSection(html, css) {
  try {
    var out = sanitize.sanitizeSection(html, css, { profile: 'generated' });
    return { html: out.html, css: out.css };
  } catch (e) {
    console.error('safeGeneratedSection failed, degrading to empty — ' + e.message);
    return { html: '', css: '' };
  }
}
function sanitizeGeneratedSectionHtml(html) { return safeGeneratedSection(tidyGeneratedSectionHtml(html), '').html; }
function sanitizeGeneratedSectionCss(css) { return safeGeneratedSection('', tidyGeneratedSectionCss(css)).css; }

/* A section's heading (its first h2) as plain words — case, markup and punctuation aside — so that "Not more AI.
   Better AI." and "NOT MORE AI. BETTER AI." are the same heading. */
function headingText(html) {
  var m = /<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/i.exec(String(html || ''));
  return m ? m[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&[a-z#0-9]+;/gi, '').replace(/\s+/g, ' ').trim() : '';
}
function headingWords(html) { return headingText(html).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }

/* ---------- ET's common footer on an AI-designed site (et-footer.js) ----------
   The portal an event's sources point to: the one its previous edition (or this edition's own page) was read
   from — the portal the records came from, else the address. series: that address's event series
   (brand-world-summit-south2025 -> brand-world-summit-south), so "What's Happening" never lists this very
   event's own ET page. It no longer decides the site's portal (sitePortalOf, below, does): its portal is what
   the consent links of an event with no portal yet are still read from (forms.js portalOfSources is the same
   rule). -> { portal: slug | '', series } */
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
/* The portal a site's ET bar and footer show: the event's own (events/<id>.portal, chosen in Create Event or
   set with Set portal) and nothing else. It is never worked out from the sources, which could name another
   portal than the one the event is listed under; with none set, the site gets the ET Business Verticals bar
   and the ET B2B footer. The series is still the edition's address's (sitePortal). stored: the event's
   document, or { portal }. -> { portal: slug | '', series } */
function sitePortalOf(stored, sourceDocs) {
  var portal = stored && etEvents.isPortal(stored.portal) ? stored.portal : '';
  return { portal: portal, series: sitePortal(sourceDocs).series };
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
// the CSS inline-vs-linked judgment call above).
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

// Generic "<script>...</script>" removal for the headless-render adapter's live DOM snapshot — a direct
// capture of document.documentElement.outerHTML has real Lovable runtime/analytics/etc. <script> tags with
// no markers to target selectively. Removing every script tag outright is correct: editor-canvas.js's click-to-edit canvas
// never wants a second JS runtime in its DOM either way (see this block's header comment), and there's no
// re-hydration loader worth preserving in a direct DOM capture.
function stripAllScriptTags(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

/* =====================================================================================================
   HEADLESS RENDER ADAPTER — the live-URL input method (POST /api/import-lovable with {url}).
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
// render as failed. Set above that service's own limit (it answers every call within 110 s, waiting for its
// turn included: lovable-scraper-service/server.js REQUEST_BUDGET_MS) so ITS clean {error, code} response is what
// normally wins — this is just the backstop for "the service didn't even respond" (it's down, a network partition).
var SCRAPE_TOTAL_TIMEOUT_MS = 115000;

// Calls the separate lovable-scraper-service over plain HTTP instead of launching headless Chrome in this
// process (see the block comment above for why). LOVABLE_SCRAPER_URL/LOVABLE_SCRAPER_SECRET are read from
// process.env on every call, not cached at module load, matching how every other env-var read in this file
// behaves — see apphosting.yaml for how they're set in production and tools/.env.local for local dev.
// A failure rejects with lib/import-check.js's Error (.status, .code, a sentence for the person): the service's
// own words — and a mismatched secret — go to the log, never to the person importing (BE-048).
function scrapeLovableUrl(url) {
  var scraperUrl = process.env.LOVABLE_SCRAPER_URL;
  if (!scraperUrl) {
    console.error('import-lovable: LOVABLE_SCRAPER_URL is not configured on this backend — see lovable-scraper-service/README.md');
    return Promise.reject(importCheck.failure('not-configured'));
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
      console.error('import-lovable: the capture service did not answer within ' + Math.round(SCRAPE_TOTAL_TIMEOUT_MS / 1000) + ' s');
      reject(importCheck.failure('timeout'));
    }, SCRAPE_TOTAL_TIMEOUT_MS);
    fetchPromise.then(resolve, reject);
  })
    .then(function (r) {
      clearTimeout(timer);
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw importCheck.fromScraper(r.status, body);
        if (!body || typeof body.html !== 'string') {
          console.error('import-lovable: the capture service answered 200 without markup');
          throw importCheck.failure('render-failed');
        }
        return body.html;
      });
    }, function (err) {
      clearTimeout(timer);
      if (err && err.code && importCheck.WORDS[err.code]) throw err;
      throw importCheck.fromNetwork(err);
    });
}

// SSRF guard for the user-supplied url — the same rules every other address a user supplies is held to
// (lib/safe-fetch.js checkPublicUrl, with lib/public-address.js): http(s) on the standard port, no user name or
// password, not an internal name, and every address the name resolves to public. -> Promise<sentence | null>.
// It used to be a regex copy of a shorter list (it let through 100.64/10, 0/8 beyond 0.0.0.0, IPv4-mapped IPv6…).
// The import's own fetches of the page's stylesheets and media go through safeFetch itself (importRenderedPage),
// which also checks every redirect and connects to exactly the address it checked.
function validateImportUrl(rawUrl) {
  return checkPublicUrl(rawUrl).then(function (r) { return r.ok ? null : r.reason; });
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
  /* the ref is the same in the answer and in the log line, so a reported failure can be found (BE-024) */
  var ref = failureRef();
  console.error('api: ' + what + ' failed [ref ' + ref + '] — ' + (err && err.stack || err));
  sendJson(res, 500, { error: friendly || 'Something went wrong on the server. Please try again.', ref: ref });
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
/* How an AI step answers a failure of its own chain: a refusal made on purpose (httpError) as written; anything else
   is logged in full under `what` with a ref, and the person is given the step's plain sentence and that ref — never
   the raw Firestore, Storage or library text (BE-024). sendFailure, at the step's own status (a page that could not
   be read is 502). */
function sendStepFailure(res, err, status, sentence, what) {
  if (err && err.status && err.body) return sendJson(res, err.status, err.body);
  if (status === 500) return sendFailure(res, what || 'an AI step', err, sentence);
  var ref = failureRef();
  console.error('api: ' + (what || 'an AI step') + ' failed [ref ' + ref + '] — ' + (err && err.stack || err));
  sendJson(res, status, { error: sentence, ref: ref });
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
  /* BE-032: the markup of a site generated before 13 Nov 2026, still on its document (generated-site.js): no page
     reads it from here, and it is most of the document. Which sections the site has stays (generatedSite). */
  delete out.generatedSections;
  EVENT_TIME_FIELDS.forEach(function (f) { if (has(out, f)) out[f] = isoOf(out[f]); });
  out.published = data.published === true;
  out.publishedPath = out.published ? publicPathOf(eventId) : null;
  if (out.published) out.publishedUrl = out.publishedPath; else delete out.publishedUrl;
  var c = data.counters || {};
  out.counters = { registrations: +c.registrations || 0, views: +c.views || 0, qrScans: +c.qrScans || 0 };
  /* Online payment is not available, so every event registers free — including the ones an earlier
     wizard stored as "paid" without ever being able to collect anything. */
  out.payment = { type: 'free' };
  /* the ET portal's name ("ETHRWorld") for the console's header, '' while it has none on the roster */
  out.portalName = portalNameOf(data.portal);
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
function checkUrl(label, v, max) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string') return label + ' must be a web address.';
  /* Nothing is written with a picture held inside it (CON-056): an event's own logo and banner (PATCH /api/event),
     a link on a record — an address only. A speaker's photo and company logo, a partner's logo and a gallery picture
     are 'picture:' fields (checkPicture): a new one sent as image text is stored as a file first
     (lib/inline-pictures.js), and one sent back exactly as it is stored is not judged again. Pictures saved inline
     before 13 Nov 2026 are still READ as they are (lib/api-audience.js imageUrl's legacyInline, the console's
     safeUrl) until the owner has run tools/migrate-inline-pictures.js --apply --all (BE-070). */
  if (/^\s*data:/i.test(v)) return label + ' must be a web address. A picture is uploaded as a file first: add it again.';
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
     'picture:<folder>'  the address of a picture's file (a speaker's photo and company logo, a partner's logo, a
              gallery picture). A NEW picture sent as image text (a data: URL) is stored as a file first, in
              events/<eventId>/<folder>/ as POST /api/event/upload stores one, and the record keeps its address
              (lib/inline-pictures.js; create / update below); one sent back exactly as stored is left as it is
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

/* A picture field (type 'picture:<folder>'): the address of a file. Image text never gets here to be saved: a new
   data: picture is stored as a file before the record is judged (subcollectionRoutes), and one sent back exactly as
   it is stored is not judged again (sanitize) — so a data: URL that is left is refused, never written. */
function checkPicture(label, v) {
  if (typeof v === 'string' && /^\s*data:/i.test(v)) return label + ' must be uploaded as a file first. Add the picture again.';
  return checkUrl(label, v);
}
function checkRecordField(label, type, v) {
  if (typeof type === 'function') return type(label, v);
  if (type.indexOf('picture:') === 0) return checkPicture(label, v);
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

/* how a picture field is named in a sentence about it ("The photo is not an image we can use …") */
var PICTURE_LABELS = { photoUrl: 'The photo', logoUrl: 'The logo', imageUrl: 'The picture' };
function inlinePictures() { return require('./inline-pictures'); }

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

  /* PICTURES (fields of type 'picture:<folder>'). A new picture that arrives as image text is stored as a file
     and the record keeps its address (lib/inline-pictures.js). The record is judged first, with each such
     picture standing in as an address, so that a record that is refused leaves no file behind. */
  var pictureFolder = {};
  Object.keys(fields).forEach(function (f) { if (typeof fields[f] === 'string' && fields[f].indexOf('picture:') === 0) pictureFolder[f] = fields[f].slice(8); });
  var hasPictures = Object.keys(pictureFolder).length > 0;
  function newInlinePictures(body, stored) { return hasPictures ? inlinePictures().changedInline(body, pictureFolder, stored) : []; }
  function asSaved(body, inline) {
    if (!inline.length) return body;
    var b = Object.assign({}, body);
    inline.forEach(function (f) { b[f] = 'https://storage.googleapis.com/picture-to-be-stored.png'; });
    return b;
  }
  function storeInlinePictures(fb, eventId, body, inline, decoded) {
    if (!inline.length) return Promise.resolve([]);
    var folders = {};
    inline.forEach(function (f) { folders[f] = 'events/' + eventId + '/' + pictureFolder[f]; });
    return inlinePictures().storeFields(fb, body, folders, null, { labels: PICTURE_LABELS, actor: actorOf(decoded) });
  }

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
      var inline = newInlinePictures(body, null);
      var clean = sanitize(asSaved(body, inline), true, null);
      if (clean.error) return sendJson(res, 400, { error: clean.error, field: clean.field });
      var data = clean.data, now = new Date().toISOString();
      loadLiveEvent(fb, eventId)
        .then(function () { return storeInlinePictures(fb, eventId, body, inline, decoded); })
        .then(function () {
          if (inline.length) {
            var stored = sanitize(body, true, null);
            if (stored.error) throw httpError(400, stored.error, { field: stored.field });
            data = stored.data;
          }
          data.createdAt = now; data.updatedAt = now; data.createdBy = actorOf(decoded); data.updatedBy = data.createdBy;
          return col(fb, eventId).add(data);
        })
        .then(function (ref) {
          sendJson(res, 200, { id: ref.id, createdAt: now, updatedAt: now });
          logActivity(fb, eventId, decoded, 'content-added', label + ' “' + maskEmail(recordTitle(data)) + '”', { area: logArea, fields: fieldChanges(null, data, RECORD_META) });
          if (spec.onWrite) spec.onWrite(fb);
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
      /* a new picture sent as image text is stored as a file first (see PICTURES above): judged against the record
         as it is now, and not stored for a save that would be refused as stale */
      var pictures = newInlinePictures(body, null).length ? loadLiveEvent(fb, eventId).then(function () { return ref.get(); }).then(function (snap) {
        if (!snap.exists) throw gone();
        var stored = snap.data() || {};
        if (body.ifUpdatedAt != null && body.ifUpdatedAt !== stored.updatedAt) throw staleError(label, stored);
        var inline = newInlinePictures(body, stored);
        var probe = sanitize(asSaved(body, inline), false, stored);
        if (probe.error) throw httpError(400, probe.error, { field: probe.field });
        return storeInlinePictures(fb, eventId, body, inline, decoded);
      }) : Promise.resolve();
      /* the event is read outside the transaction: every registration writes to that document, and a
         content save must not queue behind them */
      pictures.then(function () { return loadLiveEvent(fb, eventId); }).then(function () {
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
        if (diff.length && spec.onWrite) spec.onWrite(fb);
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
        if (spec.onWrite) spec.onWrite(fb);
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
  'speakers': subcollectionRoutes('speakers', { label: 'speaker', required: ['name'], onRemove: removeSpeaker, onWrite: peopleSoon('speakers'), fields: {
    name: 'text', desig: 'text', comp: 'text', photoUrl: 'picture:speakers', logoUrl: 'picture:speakers', colour: 'colour', weight: 'rank',
    status: 'status', email: 'email', phone: 'phone', li: 'url', bio: 'long', groupId: 'ref', order: 'num' } }),
  'speaker-groups': subcollectionRoutes('speakerGroups', { label: 'speaker group', required: ['name'], fields: { name: 'text', order: 'num' } }),
  'sessions': subcollectionRoutes('sessions', { label: 'session', required: ['title'], fields: {
    title: 'text', start: 'text', end: 'text', kind: 'text', speakerIds: 'refs', desc: 'long', room: 'text',
    weight: 'rank', groupId: 'ref', order: 'num' } }),
  'agenda-groups': subcollectionRoutes('agendaGroups', { label: 'agenda day', required: ['name'], fields: { name: 'text', date: 'text', order: 'num' } }),
  'partners': subcollectionRoutes('partners', { label: 'partner', required: ['name'], onWrite: peopleSoon('sponsors'), fields: {
    name: 'text', url: 'url', logoUrl: 'picture:partners', weight: 'rank', status: 'status', email: 'email', phone: 'phone',
    contact: 'text', note: 'long', tierId: 'ref', order: 'num' } }),
  'partner-tiers': subcollectionRoutes('partnerTiers', { label: 'partner tier', required: ['name'], fields: { name: 'text', weight: 'rank', order: 'num' } }),
  'gallery': subcollectionRoutes('gallery', { label: 'gallery image', required: ['imageUrl'], fields: { imageUrl: 'picture:gallery', caption: 'text', order: 'num' } }),
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

/* A saved promotion may never hold the example content the Promotions previews fill a gap with
   (lib/promo-examples.js isExample: an example picture's address, an example person's or logo's "ex-…" id,
   a previewed page's example marker). Those people and logos are made up, and a saved promotion goes out
   under the event's name and is copied into the next edition (CLONED_COLLECTIONS). So every field that can
   hold free text or an address is checked, not only `body`: the browser checks the whole record before it
   sends it (promo-kit.js save), and a direct call must not get past the server with a picture in `imageUrl`
   or an id in `name` that the browser would have refused. Each value is judged as sent and quoted, as the
   browser's whole-record check sees it, so a bare "ex-p01" in a name is caught as the id it is.
   That module is loaded here on first use, as every Promotions module is, so a broken one never stops this
   file from loading. If it cannot be loaded, a value cannot be checked, so it is refused rather than saved
   unchecked; an empty value holds nothing and is not refused for it. */
function promoExampleProblem(label, v) {
  if (v == null || v === '') return '';
  var examples = null;
  try { examples = require('./promo-examples'); }
  catch (err) { console.error('api: could not load lib/promo-examples.js to check a saved promotion — ' + (err && err.stack || err)); }
  if (!examples || typeof examples.isExample !== 'function') return label + ' could not be checked just now. Please try again in a few minutes.';
  return examples.isExample(v) || examples.isExample([v]) ? label + ' holds example content, which can never be saved.' : '';
}
/* a promotion field's own rule (a field-table type, or a function) first, then the example check */
function promoField(type) {
  return function (label, v) { return checkRecordField(label, type, v) || promoExampleProblem(label, v); };
}
/* `body` of a post or a mailer is its whole configuration as JSON (promo-kit.js): every text the owner
   edited, section by section, so a mailer can pass 20,000 characters. 60,000 stays far inside a record. */
var checkPromoBody = promoField('text:60000');
RESOURCES['promo-templates'] = subcollectionRoutes('promoTemplates', { label: 'promotion template', required: ['kind', 'name'], fixed: ['kind'],
  defaults: { status: 'draft' }, fields: {
    kind: 'enum:email|whatsapp|post|banner', name: promoField('text:120'), subject: promoField('text:200'), body: checkPromoBody,
    network: 'enum:|linkedin|x|facebook', imageUrl: promoField('url'), size: promoField('text:40'), placement: promoField('text:200'),
    linkUrl: promoField('url'), utmCampaign: promoField(checkUtmCampaign),
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
// No longer 'payment' or 'checklist' (BE-071): online payment is not part of this release — every event registers
// free, whatever an older document says (eventForClient answers { type: 'free' }) — and nothing has sent a checklist
// since the console stopped keeping one. A page that still sends either (Create Event sends payment: { type: 'free' })
// is not refused: a field not listed here is not read off the request at all.
//
// Deliberately NOT 'published' either. It used to be plain data that any PATCH could flip, so an event
// could say "published" with no page behind it, or "unpublished" while its page was still up. It now
// changes in exactly two places: POST /api/event/publish and POST /api/event/unpublish.
var EVENT_STATUSES = ['draft', 'upcoming', 'active', 'live', 'completed', 'cancelled'];
var SOCIAL_KINDS = ['linkedin', 'x', 'facebook', 'instagram', 'youtube', 'website'];
var DATE_MODES = ['exact', 'month', 'quarter', 'tbd', 'none'];

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
  /* The ET portal the event belongs to (ETHRWorld, ETCIO …): a slug on et-events.js's roster and nothing else
     (isPortal is an own-property check, so "__proto__" is refused too). It decides where the event is listed,
     whose previous editions it is made from, its site's ET bar and footer, its consent links and its mailers'
     branding. Required on create; once set it can be changed, never removed (cleanEventBody, portalRefusal). */
  portal: function (v) {
    if (etEvents.isPortal(v)) return '';
    return v == null || v === '' ? PORTAL_REMOVE_TEXT : 'Unknown portal "' + String(v).slice(0, 40) + '".';
  },
  /* Content › Basics' three details for posts and mailers (UX-130): who should attend, the key topics and the
     event's own headline numbers. lib/promo-details.js has the rules (a number never names what the records
     count, such as speakers); posts and mailers read them before the brief (lib/promo.js detailsOf). They are
     not on the site, so saving them changes nothing a visitor of a live site sees. */
  whoShouldAttend: function (v) { return promoDetails.check.whoShouldAttend(v); },
  keyTopics: function (v) { return promoDetails.check.keyTopics(v); },
  headlineNumbers: function (v) { return promoDetails.check.headlineNumbers(v); }
};
var EVENT_FIELDS = Object.keys(EVENT_FIELD_CHECKS);

/* The two refusals about a missing portal. A Create Event page opened before the portal was asked for sends
   none, and shows the server's sentence as it is: it says what to do. */
var PORTAL_CHOOSE_TEXT = 'Choose the portal this event belongs to. If this page has no Portal box, reload it.';
var PORTAL_REMOVE_TEXT = 'An event\'s portal can be changed, not removed. Choose another portal.';
/* The answer to a portal that cannot be stored: 'portal-required' for none, 'unknown-portal' for a value that
   is not on the roster — with the field, so a page can show it beside its Portal box. */
function portalRefusal(v, creating) {
  if (v == null || v === '') return { error: creating ? PORTAL_CHOOSE_TEXT : PORTAL_REMOVE_TEXT, code: 'portal-required', field: 'portal' };
  return { error: EVENT_FIELD_CHECKS.portal(v), code: 'unknown-portal', field: 'portal' };
}

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

  /* Settings › URL & SEO (seo-fields.js cleanSeo: every field, with its limits; anything else refused by name). The
     site stays live for anyone with its address when noindex is on, but search engines are asked not to list it. */
  if (has(v, 'seo')) {
    var seo = seoFields.cleanSeo(v.seo);
    if (seo.error) return { error: seo.error, field: seo.field };
    out.seo = seo.value;
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
    /* on create, an empty portal is no portal: handleEventCreate refuses that after the address checks */
    if (f === 'portal' && creating && (body.portal == null || body.portal === '')) continue;
    var problem = EVENT_FIELD_CHECKS[f](body[f]);
    if (problem) return f === 'portal' ? portalRefusal(body[f], creating) : { error: problem };
    data[f] = body[f];
  }
  if (creating && !has(data, 'name')) return { error: 'The event name is required.' };
  if (typeof data.name === 'string') data.name = data.name.trim();
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
  'sections', 'nav', 'checklist', 'paletteTheme', 'cloningFrom', 'clonedFrom', 'publishedSeo'];

/* POST /api/event. 200 { ok, eventId, createdAt, updatedAt }; 409 { error, code: 'slug-taken', suggestion }
   when the address belongs to an event (live or deleted); 400 { code: 'slug-reserved', suggestion } for an
   address nothing may take (lib/http.js's isReservedEventId). Creating over an existing event used to merge the new
   fields into it: the second event silently took over the first one's content, registrations and site.
   The check and the write are one transaction, so two people creating the same address at the same
   moment cannot both succeed.

   Every event belongs to one ET portal, chosen in Create Event: with none, 400 { code: 'portal-required',
   field: 'portal' }. That is decided after the address (reserved, taken), so a page that sends no portal
   still hears first about an address it cannot have, as it always did. The portal is a line of its own in
   the History, after "created". */
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
    /* how the portal was set (only this server writes it): here, by the person creating the event */
    if (has(data, 'portal')) data.portalFrom = 'create';

    var ref = eventDocRef(fb, eventId);
    fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var state = eventStateOf(snap);
        if (state === 'live' || state === 'deleted') throw httpError(409, 'taken');
        if (!has(data, 'portal')) throw httpError(400, PORTAL_CHOOSE_TEXT, { code: 'portal-required', field: 'portal' });
        if (state === 'missing') { tx.set(ref, data); return; }
        var write = Object.assign({}, data);
        SHELL_STATE_FIELDS.forEach(function (f) { if (!has(write, f)) write[f] = fieldDelete(); });
        tx.set(ref, write, { merge: true });
      });
    }).then(function () {
      sendJson(res, 200, { ok: true, eventId: eventId, createdAt: now, updatedAt: now });
      var name = portalNameOf(data.portal);
      /* one after the other, so the History reads "created" and then the portal it was created on */
      logActivity(fb, eventId, decoded, 'created', data.name).then(function () {
        return logActivity(fb, eventId, decoded, 'portal-set', name + ' (chosen in Create Event)',
          { area: 'event', fields: [{ field: 'portal', before: 'No portal', after: name }] });
      });
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
   document). Each field sent replaces the stored one as a whole — a `nomination` or `datePartial` object is
   not deep-merged, so a key the client stops sending really goes. `settings` is the one deliberate
   exception: see mergeSettings.

   Two people with the same event open. A page that sends `ifUpdatedAt` — the `updatedAt` it was last
   given, by GET /api/event or by its own last save — is refused with 409 { code: 'stale', current:
   { updatedAt, updatedBy } } when somebody has changed the event's details since then, instead of
   quietly putting its older copy of every field back. What it is compared with is `detailsUpdatedAt`,
   which only this route and create stamp: saving the site in the editor moves the event's `updatedAt`
   every few seconds and is not a change to its details. A request without `ifUpdatedAt` is not checked.

   The portal. Set portal (the dashboard, the console, the review page) and Basics send `ifPortal`: the
   portal the page showed, '' for none. When somebody has set another one meanwhile, 409 { code:
   'portal-changed', current, currentName } and nothing is written, so a portal is never silently put
   back. `{ eventId, portal }` alone needs no `ifUpdatedAt`. A portal equal to the stored one is no
   change: it is not written, not logged, and a PATCH that sent nothing else writes nothing at all and
   answers the stored `updatedAt` (otherwise both dates would move for nothing). A real change is its
   own line in the History ("ETCIO → ETHRWorld"), not part of the "updated" line. */
function checkIfPortal(body) {
  return (body.ifPortal == null || (typeof body.ifPortal === 'string' && body.ifPortal.length <= 40)) ? '' : '"ifPortal" must be the portal the page showed ("" for none).';
}
function portalChangedError(current) {
  var name = portalNameOf(current);
  return httpError(409, 'This event\'s portal was changed' + (name ? ' to ' + name : '') + ' meanwhile. Reload to see it.',
    { code: 'portal-changed', current: current, currentName: name });
}
function handleEventUpdate(req, res) {
  withAdminBody(req, res, BODY_LIMITS.event, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var clean = cleanEventBody(body, eventId, false);
    if (clean.error) return sendJson(res, 400, { error: clean.error, code: clean.code, field: clean.field });
    var bad = checkIfUpdatedAt(body) || checkIfPortal(body);
    if (bad) return sendJson(res, 400, { error: bad });
    var changed = Object.keys(clean.data);
    if (!changed.length && !clean.settings) return sendJson(res, 400, { error: 'Nothing to update.' });

    var now = new Date().toISOString(), ref = eventDocRef(fb, eventId), statusChange = null, diff = [], settingsDiff = [];
    var portalChange = null, answeredAt = now;
    fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var state = eventStateOf(snap);
        if (state !== 'live') throw notLiveError(state, eventId);
        var stored = snap.data();
        /* worked out again on each run: a transaction can run more than once */
        statusChange = null; diff = []; settingsDiff = []; portalChange = null; answeredAt = now;
        /* a stored value that is not on the roster is no portal, on both sides of the comparison */
        var storedPortal = etEvents.isPortal(stored.portal) ? stored.portal : '';
        if (typeof body.ifPortal === 'string' && (etEvents.isPortal(body.ifPortal) ? body.ifPortal : '') !== storedPortal) {
          throw portalChangedError(storedPortal);
        }
        if (body.ifUpdatedAt != null && isoOf(stored.detailsUpdatedAt) && isoOf(stored.detailsUpdatedAt) > body.ifUpdatedAt) {
          throw staleError('event', { updatedAt: isoOf(stored.updatedAt), updatedBy: stored.updatedBy });
        }
        var data = Object.assign({}, clean.data);
        if (has(data, 'portal') && data.portal === storedPortal) delete data.portal;
        if (!Object.keys(data).length && !clean.settings) { answeredAt = isoOf(stored.updatedAt) || isoOf(stored.createdAt) || now; return; }
        var write = Object.assign({}, data, { updatedAt: now, detailsUpdatedAt: now, updatedBy: actorOf(decoded) });
        if (has(data, 'portal')) {
          write.portalFrom = 'set';
          portalChange = { before: storedPortal, after: data.portal };
        }
        if (clean.settings) {
          write.settings = mergeSettings(stored.settings, clean.settings);
          /* the SEO rules that need the event itself (an Indian postcode has 6 digits: the city decides) */
          var seoWhy = clean.settings.seo ? seoFields.checkWithEvent(write.settings.seo, Object.assign({}, stored, data)) : '';
          if (seoWhy) throw httpError(400, seoWhy, { field: 'settings.seo.postalCode' });
          settingsDiff = fieldChanges(stored.settings || {}, pick(write.settings, Object.keys(clean.settings).filter(function (k) { return k !== 'seo'; })));
          /* the SEO section's changes field by field, by the names the section gives them, not as one block of JSON */
          if (clean.settings.seo) settingsDiff = settingsDiff.concat(seoFields.changes(write.settings.seo, (stored.settings || {}).seo).map(function (c) {
            return { field: 'SEO › ' + c.label, before: c.before, after: c.after };
          }));
        }
        diff = fieldChanges(stored, data, ['status', 'portal']);
        statusChange = has(data, 'status') && data.status != null && data.status !== stored.status
          ? (stored.status || 'no status') + ' → ' + data.status : null;
        tx.update(ref, write);
      });
    }).then(function () {
      sendJson(res, 200, { ok: true, updatedAt: answeredAt });
      if (clean.settings && settingsDiff.length) logActivity(fb, eventId, decoded, 'settings-changed', settingsDiff.map(function (f) { return f.field; }).join(', '), { fields: settingsDiff });
      if (statusChange) logActivity(fb, eventId, decoded, 'status-changed', statusChange);
      if (diff.length) logActivity(fb, eventId, decoded, 'updated', diff.map(function (f) { return f.field; }).join(', '), { fields: diff });
      if (portalChange) {
        var before = portalNameOf(portalChange.before) || 'No portal', after = portalNameOf(portalChange.after);
        logActivity(fb, eventId, decoded, 'portal-set', before + ' → ' + after, { area: 'event', fields: [{ field: 'portal', before: before, after: after }] });
      }
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
  'publishedVersion', 'counters', 'site', 'generatedAt', 'deletedAt', 'deletedBy', 'discardingAt', 'portal', 'approval'];

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
    counters: { registrations: +c.registrations || 0, views: +c.views || 0, qrScans: +c.qrScans || 0 },   // qrScans: the events list's QR codes (LST-038)
    site: site ? { version: +site.version || 0, templateId: site.templateId || null, updatedAt: site.updatedAt || null, updatedBy: site.updatedBy || null } : null,
    /* an AI-designed site exists from the moment it is generated, before the editor has saved anything */
    hasGeneratedSite: !!d.generatedAt,
    /* the ET portal it is listed under, and its name; '' and '' while it has none ("No portal yet") — a stored
       value that is not on the roster is none too. The list reads every event and the dashboard picks a
       portal's own: a query on the portal would leave out the events that have none yet. */
    portal: etEvents.isPortal(d.portal) ? d.portal : '',
    portalName: portalNameOf(d.portal),
    /* the request waiting for approval, or null: the dashboard lists what is waiting and marks the row (UX-102) */
    approval: approvalList.listApproval(id, d),
    payment: { type: 'free' }
  };
  item.hasSite = (!!site && +site.version > 0) || item.hasGeneratedSite;
  if (deleted) { item.deletedAt = isoOf(d.deletedAt); item.deletedBy = text(d.deletedBy); }
  return item;
}

/* The events GET /api/events lists, as their documents: a promise of [{ id, data }], in the list's own order
   (newest-changed first, or newest-deleted first), with only EVENT_LIST_FIELDS read — so `data.counters` is the
   raw map, audienceV and all, which is what lib/api-audience.js insightTotals() needs to total an event without
   reading it again. which: 'live' (anything else) or 'deleted'.
   ETB2B AI on the dashboard (lib/dash-bot.js) reads its events through this as well, so it can never see an event
   the person's own list does not show, nor miss one it does. `decoded` is the person asking: someone who works in
   chosen portals (decoded.access, lib/access-control.js) gets only those portals' events, here for both at once. */
function liveEventDocs(fb, decoded, which) {
  var wanted = which === 'deleted' ? 'deleted' : 'live';
  return Promise.resolve().then(function () {
    var query = fb.db.collection('events');
    return query.select.apply(query, EVENT_LIST_FIELDS).limit(EVENTS_LIST_LIMIT).get();
  }).then(function (snap) {
    var docs = [], order = {};
    snap.docs.forEach(function (d) {
      var data = d.data();
      /* a draft that is being removed for good is in neither list (lib/api-events.js) */
      if (eventStateOf(d) !== wanted || data.discardingAt) return;
      if (typeof data.name !== 'string' || data.name.trim() === '') return;
      /* someone who works in chosen portals sees only their portals' events (lib/access-control.js) */
      if (decoded && decoded.access && !accessControl.eventOk(decoded.access, data)) return;
      docs.push({ id: d.id, data: data });
      /* the very value the list item shows as updatedAt (or deletedAt), so the order is the list's */
      order[d.id] = String((wanted === 'deleted' ? isoOf(data.deletedAt) : isoOf(data.updatedAt) || isoOf(data.createdAt) || null) || '');
    });
    docs.sort(function (a, b) {
      var x = order[a.id], y = order[b.id];
      return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? 1 : -1);
    });
    return docs;
  });
}

function handleEventsList(req, res) {
  withAdmin(req, res, function (fb, decoded) {
    var which = queryOf(req).get('deleted') === '1' ? 'deleted' : 'live';
    liveEventDocs(fb, decoded, which)
      .then(function (docs) {
        sendJson(res, 200, { items: docs.map(function (d) { return eventListItem(d.id, d.data); }) });
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
       events/<id>/staging/index.html    the staged copy: the page as last saved, written by every save
                                         (recordSave) and shown at /preview/<id>?staged=1.
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

/* The address this request reached the server at, from its own headers: what a signed-in page links back
   to (a preview, the review page), since that is where its person is signed in. */
function requestOrigin(req) {
  var h = req.headers || {};
  var host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return '';
  var proto = String(h['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto !== 'http' && proto !== 'https') proto = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https';
  return proto + '://' + host;
}
/* The address of the published sites, for every absolute URL a visitor follows: the canonical link and
   og:url, the publishedUrl a client is handed, the sitemap and robots.txt, mailers, Promotions' QR codes and
   share links. It is ONE setting (lib/public-base.js: PUBLIC_BASE_URL, else the hosted address; owner
   decision #2, UX-001), not the host a request came in on: a page published or a link made from another
   address (a local copy of the CMS, a second domain) must still send people to where the site really is.
   The arguments are kept so every caller reads the same; neither changes the answer. */
function publicBaseFor(req, bodyOrigin) {
  return publicBase.publicSiteBase();
}
/* The CMS's own address, for links into signed-in pages (a preview, the review page): the page's own origin
   when it sent one, else the request's, else the public base. Those pages need the person's sign-in, which
   lives on the address they are using, so a public domain set later must not move them. */
function cmsOriginFor(req, bodyOrigin) {
  return cleanOrigin(bodyOrigin) || requestOrigin(req) || publicBase.publicSiteBase();
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
   Body { eventId, templateId, baseVersion, snapshot, html, origin, force?, note?, automatic? } -> 200 { version, updatedAt }.
   `baseVersion` is the version the editor loaded (0 for a first save). If the stored version is different
   and `force` is not true: 409 { error, code: 'site-conflict', current: { version, updatedAt, updatedBy } }
   and nothing is written — the editor asks its user which copy to keep. Versions that only brought Content
   in (stageContent: site.contentBase is the last version made by anything else) are no conflict, whichever of
   them the editor is on: the editor draws the event's records into the page when it opens it, and this save
   draws today's records in again below.

   The page is stored with the saving origin already made root-relative (see rewriteOrigins), so what is
   kept does not depend on which host the editor happened to be opened on, and with the event's records as
   they are now (siteRecords.renderRecords): a record changed in Content while the editor was open is not
   taken off the staged copy by the next save.

   Nothing is stored when nothing changed: a page and an editor state the same as the saved ones answer the saved
   version with unchanged: true. `automatic: true` is the editor's own load-time updates (an ET logo brought up
   to date, the records it drew in), saved apart from the person's changes so that their summary names only
   what they changed: kept only when a reader would see a difference, and recorded as automatic, in nobody's
   name (recordSave). When the page they make is the staged page already, no version is made but the editor's
   state is kept beside it, so the next opening has nothing left to update. */
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
    if (body.automatic != null && typeof body.automatic !== 'boolean') return sendJson(res, 400, { error: '"automatic" must be true or false.' });
    var automatic = body.automatic === true;

    var snapshotText;
    try { snapshotText = JSON.stringify(body.snapshot); } catch (e) { return sendJson(res, 400, { error: 'The editor state could not be read.' }); }
    var pageHtml = rewriteOrigins(body.html, [cleanOrigin(body.origin)]);

    var token = crypto.randomBytes(12).toString('hex'), actor = actorOf(decoded), now = new Date().toISOString();
    acquireSiteLock(fb, eventId, token, function (data) {
      var current = siteVersionOf(data);
      if (body.force === true || baseVersion === current) return null;
      var site = data.site || {};
      /* Every version after contentBase was made by Content alone (any other save writes the site afresh,
         without contentBase), so a save built on contentBase or on any of them is no conflict: an editor on
         version 9 meets the Content version 10 made since, not somebody's work (a Save that answered "Nothing
         new to save" leaves the editor on a Content version — B05 verify). */
      if (baseVersion && site.contentBase != null && +site.contentBase <= baseVersion && baseVersion < current) return null;
      return httpError(409, current
        ? 'This site was changed' + (site.updatedBy ? ' by ' + site.updatedBy : '') + ' after you opened it.'
        : 'This site has no saved version yet — reload the editor.', {
        code: 'site-conflict',
        current: { version: current, updatedAt: site.updatedAt || null, updatedBy: site.updatedBy || null }
      });
    }).then(function (data) {
      var previous = data.site || {}, current = siteVersionOf(data), version = current + 1;
      var templateId = body.templateId || previous.templateId || data.templateId || null;
      var beforeHtml = null, beforeSnapshot = null;
      /* the page as it was, read before it is replaced: what this save is compared with */
      return Promise.all([
        readObject(fb, sitePath(eventId, 'page.html')),
        current ? readObject(fb, sitePath(eventId, 'snapshot.json')) : Promise.resolve(null),
        readRecordRows(fb, eventId).then(null, function (err) {
          console.error('api: the records of ' + eventId + ' could not be read for a save — the page is kept as sent: ' + (err && err.message));
          return null;
        })
      ]).then(function (got) {
        beforeHtml = current ? got[0] : null;
        beforeSnapshot = got[1];
        /* today's records, and the event's name, date and place as Basics hold them (records that could not be read
           are left as the editor drew them) */
        pageHtml = siteRecords.renderRecords(pageHtml, got[2] || {}, { templateId: templateId, event: data }).html;
        var same = beforeHtml != null && pageHtml === beforeHtml && (automatic || snapshotText === beforeSnapshot);
        if (!same && automatic && beforeHtml != null) {
          var seen = [];
          try { seen = diffPages(beforeHtml, pageHtml); } catch (e) { seen = [{ type: 'unknown' }]; }
          same = !seen.length;
        }
        /* The editor's own updates on a page staging already shows (the records Content drew into it since the
           editor last saved, stageContent): no version, but the editor's state is kept beside the page, as every
           save keeps it, so the next opening, in any browser, starts from it and has nothing to update (UX-076).
           Only when the page it makes is byte for byte the staged one: a state is never kept beside another page. */
        var catchUp = same && automatic && pageHtml === beforeHtml && beforeSnapshot != null && snapshotText !== beforeSnapshot;
        if (catchUp) {
          return saveObject(fb, sitePath(eventId, 'snapshot.json'), snapshotText, 'application/json; charset=utf-8').then(function () {
            return commitSiteLock(fb, eventId, token, { site: Object.assign({}, previous, { snapshotVersion: current, aiUnchecked: approvalList.aiUncheckedOf(body.snapshot) }) });
          }).then(function () {
            sendJson(res, 200, { version: current, updatedAt: previous.updatedAt || null, unchanged: true, summary: 'no change', changes: 0,
              stagingPath: '/preview/' + eventId + '?staged=1', published: data.published === true, publishedVersion: data.published === true ? (+data.publishedVersion || 0) : 0 });
            return null;
          });
        }
        if (same) {
          return releaseSiteLock(fb, eventId, token).then(function () {
            sendJson(res, 200, { version: current, updatedAt: previous.updatedAt || null, unchanged: true, summary: 'no change', changes: 0,
              stagingPath: '/preview/' + eventId + '?staged=1', published: data.published === true, publishedVersion: data.published === true ? (+data.publishedVersion || 0) : 0 });
            return null;
          });
        }
        return Promise.all([
          saveObject(fb, sitePath(eventId, 'snapshot.json'), snapshotText, 'application/json; charset=utf-8'),
          saveObject(fb, sitePath(eventId, 'page.html'), pageHtml, 'text/html; charset=utf-8')
        ]).then(function () {
          return commitSiteLock(fb, eventId, token, {
            /* aiUnchecked: the AI-written sections nobody has checked yet in this state, for the console's Publish */
            site: { version: version, snapshotVersion: version, templateId: templateId, updatedAt: now, updatedBy: actor, aiUnchecked: approvalList.aiUncheckedOf(body.snapshot) },
            updatedAt: now
          });
        }).then(function () { return true; });
      }).then(function (stored) {
        if (!stored) return;
        /* a save is somebody pressing Save: every one is a kept version, on staging, with its own line in
           the history saying what changed */
        return recordSave(fb, eventId, decoded, version, beforeHtml, pageHtml, body.note, { kind: automatic ? 'automatic' : '' }).then(function (rec) {
          sendJson(res, 200, { version: version, updatedAt: now, changeId: rec.changeId, summary: rec.summary, changes: changeCount(rec.items),
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
  'data-rv-current-page',
  /* an imported page's motion has been taken over (et-runtime.js startMotion): true of one visit only */
  'data-rv-motion-ready',
  /* the sample words an added section or block came with, kept so the editor can mark them until they are replaced
     (editor-template-ui.js markPlaceholders) */
  'data-rv-placeholder'];
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
/* An imported page's own motion (lovable-scraper-service motionRecorder: data-rv-motion). Each element that moves
   in is written as its motion ends; et-runtime.js, loaded deferred, puts it back at its start and plays it. Till
   then it is held out of sight, so the first paint does not show it finished and then snatch it away — for 3 s
   at most: after that it shows whether the runtime came or not. Never while editing, nor for a visitor who asked
   for no motion. */
var MOTION_MARK = /<[a-z][^>]*\sdata-rv-motion=(["'])\{(?:&quot;|")on(?:&quot;|")/i;
var MOTION_HOLD = '<style data-rv-runtime>@media (prefers-reduced-motion:no-preference){@keyframes rv-motion-hold{from,to{opacity:0}}' +
  'html:not([data-rv-motion-ready]):not([data-rv-editing]) [data-rv-motion^=\'{"on":\']{animation:rv-motion-hold 3s linear}}</style>';
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
    /* rv-hero-video.js gives this video its pause button too: it needs the button's rules (in the hero's tone)
       or it shows as an empty grey sliver at the hero's edge */
    head.push('<style data-rv-hero-video>' + heroVideoCore.toggleCss(look.tone === 'light' ? 'dark' : 'light').join('\n') +
      '\n@media (prefers-reduced-motion:reduce){[data-rv-bg-video]{display:none!important}}</style>');
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
/* the red ET square, exactly as it is in the ET B2B logo (assets/favicon.svg): the same icon as every CMS tab (UX-003) */
var SITE_FAVICON = '/assets/favicon.svg';

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
           pictures are left as they are),
           shareView: true for a shareable preview link (lib/share-preview.js, mode 'preview'): the ribbon says
           "not live yet", none of the editor's tools, #rv-site-config says shared (its forms send nothing),
           shareLive: with shareView, when the event is already published: 'changed' (the saved site has changes
           the live one has not) or 'same' — the ribbon says so, and #rv-site-config says live with the live
           site's path, so its forms send a guest there instead of saying the site is not open,
           pageBase: the address its internal-page links start from ('/s/<token>'),
           ribbonText: the team preview's ribbon in words that fit the page shown ("Preview — same as the live site"),
           noRibbon: true for none (a review page's pane), noTools: true for no theme switcher and no "Edit with AI",
           report: an object the page pass fills in: { shareCard } — what the page's share card needs
           (share-card.js planOf), so a publish or a serve can have it made } */
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
      if ((t.name === 'meta' && (metaName === 'description' || metaName === 'keywords' || /^twitter:/.test(metaName) || /^og:/.test(metaProp))) ||
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
    /* an awards site: its people are the jury, whose cards keep their profile pop-up; an event site's speakers and
       sponsors open their pages across ET (templates/_shared/rv-popups.js, lib/people.js) */
    if (t.name === 'body') {
      var awards = event.category === 'awards';
      if (awards && !attrOf(t, 'data-rv-awards')) { setAttr(t, 'data-rv-awards', ''); changed = true; }
      else if (!awards && attrOf(t, 'data-rv-awards')) { dropAttr(t, 'data-rv-awards'); changed = true; }
    }
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

  /* ---- 3. title, description, keywords, sharing tags, canonical link, favicon ----
     From Settings › URL & SEO as this page has it (seo-fields.js seoFor): a live page reads the copy that was
     published with it — a change in the console reaches the live site with the next publish or approval, never
     before — and a preview reads the draft. The SEO title is the page's title and its share title (the event's
     name when there is none); the meta description is its description and its share description. */
  var seo = seoFields.seoFor(event, mode === 'live' ? 'live' : 'draft');
  var name = typeof event.name === 'string' ? event.name.trim() : '';
  var seoTitle = seoFields.line(seo.title);
  /* the description's headings are the owner's brief, not a summary to show (owner-brief.js): their free
     text, else what the owner said sets the event apart */
  var ownerUsp = event.designPlan && event.designPlan.owner && event.designPlan.owner.usp;
  /* at most what a search result shows, cut at a word (site-seo.js shareDescription), never mid-word */
  var description = siteSeo.shareDescription(String(seo.description || ownerBrief.withoutHeadings(event.description) || ownerUsp || ''));
  if (!description && name) {
    /* nothing written for it yet: say what is known (when and where), so a shared link is not a bare title */
    var facts = [event.dateLabel, event.venue, event.city].map(function (v) { return typeof v === 'string' ? v.trim() : ''; }).filter(Boolean);
    if (facts.length) description = siteSeo.shareDescription(name + ' — ' + facts.join(', '));
  }
  var pageUrl = mode === 'live' ? (cleanCanonical(seo.canonicalUrl) || (opts.publicBase ? opts.publicBase + publicPathOf(opts.eventId) : '')) : '';
  var shareImage = String(seo.shareImageUrl || '').trim();
  if (shareImage.charAt(0) === '/' && opts.publicBase) shareImage = opts.publicBase + shareImage;

  var pageTitle = seoTitle || name;
  var head = [], titleDone = !pageTitle;
  /* a preview's tab says it is one ("Preview · <event>"), so it cannot be taken for the live site's tab beside it
     (UX-003), with the SEO title the page will go live with; a shared link still unfurls under the page's own title
     (og:title) */
  var tabTitle = mode === 'preview' ? 'Preview \u00b7 ' + pageTitle : pageTitle;
  if (pageTitle) {
    for (i = 0; i < tokens.length && !titleDone; i++) {
      if (!(inHead(i) || (bodyOpen !== -1 && i < bodyOpen))) continue;
      if (tokens[i].t !== 'open' || tokens[i].name !== 'title' || out[i] === '') continue;
      if (tokens[i + 1] && tokens[i + 1].t === 'raw') out[i + 1] = escHtmlText(tabTitle);
      else out[i] += escHtmlText(tabTitle);
      titleDone = true;
    }
    if (!titleDone) head.push('<title data-rv-head>' + escHtmlText(tabTitle) + '</title>');
  }
  function meta(attr, key, value) { if (value) head.push('<meta ' + attr + '="' + key + '" content="' + escHtmlAttr(value) + '" data-rv-head>'); }
  meta('name', 'description', description);
  /* the team's keywords, when there are any (search engines give them little weight, but ET's sites carry them) */
  var keywords = Array.isArray(seo.keywords) ? seo.keywords.map(seoFields.line).filter(Boolean) : [];
  if (keywords.length) meta('name', 'keywords', keywords.join(', '));
  if (pageUrl) head.push('<link rel="canonical" href="' + escHtmlAttr(pageUrl) + '" data-rv-head>');
  meta('property', 'og:type', 'website');
  meta('property', 'og:title', pageTitle);
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
  /* an imported page's own motion: what moves in is held from the first paint until the runtime has it */
  if (MOTION_MARK.test(html)) head.push(MOTION_HOLD);

  /* ---- 4. the live-site runtime and its config, exactly once ---- */
  var contentMap = contentMapFor(opts.templateId);
  var config = { eventId: opts.eventId, mode: mode, templateId: opts.templateId || null, contentMap: contentMap || [] };
  if (opts.shareView === true) config.shared = true;      // a guest's shared link: rv-forms.js sends nothing
  /* ...and when the event is live, its forms point the guest to the live site, where they do work */
  if (opts.shareView === true && opts.shareLive) { config.live = true; config.livePath = publicPathOf(opts.eventId); }
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
  /* opts.noRibbon: a review page's pane, whose own caption says which version it is and whether it is live (UX-110):
     a ribbon over the page would only cover its foot */
  var ribbon = mode === 'preview' && !liveView && opts.noRibbon !== true
    ? '<div data-rv-preview-ribbon style="position:fixed;left:0;right:0;bottom:0;z-index:2147483000;padding:7px 12px;background:#191b1f;color:#fff;font:600 12px/1.4 Inter,Arial,sans-serif;letter-spacing:.04em;text-align:center;pointer-events:none">' + shareRibbonText(opts) + '</div>'
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
  /* a shareable preview link (opts.shareView) is a guest's page: none of the team's tools on it; nor a saved version
     opened for review (opts.noTools): it is shown exactly as approving it would put it live (UX-109) */
  var editorTools = mode === 'preview' && !liveView && opts.shareView !== true && opts.noTools !== true;
  var switcher = editorTools ? themeSwitcherHtml(opts.event, opts.eventId, opts.templateId) : '';
  if (switcher) tailText += switcher;
  if (editorTools && opts.editButton === true) tailText += '<script src="/templates/_shared/rv-preview-edit.js" data-rv-runtime></script>\n';
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
  page = siteA11y.pagePass(page, { mode: mode, event: event, templateId: opts.templateId, report: opts.report }, TOKEN_KIT);
  /* ---- 8b. buttons that lead nowhere put right, what an import cannot run taken out, and a live page that is a
     test or an unfilled template kept out of search engines (liveRepair, site-checks.js) ---- */
  page = liveRepair(page, event, opts.eventId, mode, opts.forms);
  /* ---- 9. internal pages: each page link's address, so the pages work with no script ---- */
  if (sitePageList.length && opts.eventId) page = sitePages.setPageLinks(page, mode === 'live' ? publicPathOf(opts.eventId) : opts.pageBase || '/preview/' + opts.eventId, TOKEN_KIT);
  return page;
}
/* The preview ribbon's words. A shareable link (opts.shareView) is seen by guests, and it often shows the
   coming changes of a site that is already live: it must not tell them the site is not open when it is. */
function shareRibbonText(opts) {
  /* the team's own preview says what is true of the page it shows (handlePreviewPage previewRibbon, UX-110) */
  if (opts.shareView !== true) return opts.ribbonText ? escHtmlText(opts.ribbonText) : 'Preview — not published';
  if (opts.shareLive === 'same') return 'Preview — this version is live';
  return opts.shareLive ? 'Preview — changes not live yet' : 'Preview — not live yet';
}
/* The live page a publish (or an approval) is about to write, with its share card (share-card.js) when it can be had
   in time: the page is transformed, the card it needs is made and recorded (waited for at most share-card.js
   PUBLISH_WAIT_MS), and the page is transformed again knowing it. Never rejects and never holds the publish up: a
   card that fails, or is not ready in time, leaves the page with the picture it would have had, and a card that
   is still being made reaches the page at its next visit (its cached copy is dropped once the card is stored).
   -> Promise<page> */
function liveWithShareCard(fb, eventId, data, pageHtml, transformOpts) {
  var report = {};
  var live = publishTransform(pageHtml, Object.assign({}, transformOpts, { report: report }));
  return shareCard.atPublish(fb, eventId, data, report.shareCard, function () { forgetCachedPage(eventId); }).then(function (rec) {
    if (!rec) return live;
    return publishTransform(pageHtml, Object.assign({}, transformOpts, { event: Object.assign({}, data, { shareCard: rec }) }));
  }, function (err) {
    console.error('api: the share card of ' + eventId + ' was not waited for — ' + (err && err.message));
    return live;
  });
}

/* the tokenizer above, for site-a11y.js's page pass */
var TOKEN_KIT = { tokenizeHtml: tokenizeHtml, attrOf: attrOf, attrValue: attrValue, classListOf: classListOf, writeTag: writeTag,
  setAttr: setAttr, dropAttr: dropAttr, elementEnd: elementEnd };

function cleanCanonical(v) { return (typeof v === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(v.trim())) ? v.trim() : ''; }

/* The repairs a page gets on its way to a visitor (site-checks.js repair): a Register button opens the form, a
   partner button that leads nowhere opens a partner enquiry, a link to a section that is not shown is hidden, an
   imported page's links to this host's own addresses lead to its sections, and what an import cannot run is
   taken out. On a live page, its robots meta says noindex when the event is a test, an unfilled template or one
   its owner keeps out of search (noindexReason). Never the saved page; idempotent; a failure leaves the page as
   it came. */
function liveRepair(page, event, eventId, mode, forms) {
  try {
    event = event || {};
    var fixed = siteChecks.repair(page, TOKEN_KIT, { eventId: eventId, homeHref: eventId ? publicPathOf(eventId) : '', portal: event.portal, forms: forms });
    page = fixed.html;
    if (mode === 'live') page = siteChecks.robots(page, TOKEN_KIT, !!siteChecks.noindexReason(Object.assign({ id: eventId }, event), page, TOKEN_KIT));
    return page;
  } catch (err) {
    console.error('api: the live repairs of ' + eventId + ' failed, page left as it was — ' + (err && err.stack || err));
    return page;
  }
}

/* ---------- the logo unit's notice: answered before anything goes live ----------
   What the owner has to check about the hero's logo unit travels on the unit (data-rv-logo-note: a year that could
   not be moved, a sponsor's mark that could not be cut, a logo that could not be used, a banner with no copy for a
   dark ground…). The editor shows it until it is answered — "Looks right", or a picture of the owner's own — and a
   save then stores the page without it. Until then nothing of that site goes live: publishing, asking for approval
   and approving all refuse (409 'logo-unit-unanswered'). The saved page is what is read: publishTransform takes the
   note off every live and preview page. A version that is already live may go out again as it is (published again
   after its event's details changed, an approval of it, tools/republish-current.js). */
var LOGO_NOTE_CODE = 'logo-unit-unanswered';
/* the note on the first element that carries one, as written (entities read), or null; ' ' for an empty one */
function unansweredLogoNote(html) {
  if (typeof html !== 'string' || html.indexOf('data-rv-logo-note') === -1) return null;
  var tokens = tokenizeHtml(html);
  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].t !== 'open') continue;
    var v = attrValue(tokens[i], 'data-rv-logo-note');
    if (v == null) continue;
    var text = v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return text || ' ';
  }
  return null;
}
/* who: 'owner' (publishing, asking for approval) | 'approver' (approving someone else's changes) */
function logoNoteError(note, who) {
  var said = String(note || '').trim(), quote = said ? ' (“' + (said.length > 220 ? said.slice(0, 217).replace(/\s+\S*$/, '') + '…' : said) + '”)' : '';
  var text = who === 'approver'
    ? 'These changes cannot go live yet: the logo in the banner still has a notice its editor has not answered' + quote + '. Reject this request so they can answer it in the site editor, save, and send the changes again.'
    : 'The logo in the banner still has a notice to answer' + quote + '. Open the site editor, check the logo, then press “Looks right” or replace the picture, and save. Then publish again.';
  return httpError(409, text, { code: LOGO_NOTE_CODE });
}

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
    /* a page sent along (an editor of before) is refused before it is saved over the site */
    var sentNote = legacyHtml ? unansweredLogoNote(legacyHtml) : null;
    if (sentNote) return sendFailure(res, 'publish', logoNoteError(sentNote, 'owner'), 'The site could not be published.');
    /* nothing goes live without an approval, unless approval has been switched off (config/approvals). This
       check is always made: nothing in the request can skip it (a body key "__approvalChecked" used to). */
    return approvalsConfig(fb).then(function (cfg) {
      if (cfg.required) {
        return sendJson(res, 409, { error: 'Changes go live once they are approved. Save the site, then use “Send for approval…” to send it.', code: 'approval-required' });
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
      /* the SEO section's values go live with the page, as they are now (no approval to have seen them) */
      page = withPublishedSeo(fb, eventId, data, page, 'draft', actor);

      /* the request waiting for approval that this publish overtakes: its version, or an older one, goes live now */
      var overtaken = data.approval && data.approval.id && (+data.approval.toVersion || 0) <= version ? String(data.approval.id) : '';
      return Promise.all([page, publicFormsFor(fb, eventId, data)]).then(withPictures(fb)).then(function (got) {
        var pageHtml = got[0], livePath = publishedObjectPath(eventId);
        /* the version already live going out again (its event's details changed) is not held: it is live as it is */
        var alreadyLive = !legacyHtml && data.published === true && +data.publishedVersion === version;
        var note = alreadyLive ? null : unansweredLogoNote(pageHtml);
        if (note) throw logoNoteError(note, 'owner');
        /* template text, a picture that cannot be shown, last year's logo: refused before anything changes */
        return (alreadyLive ? Promise.resolve() : siteCheckGate(fb, eventId, data, pageHtml, 'owner', got[1])).then(function () {
          return liveWithShareCard(fb, eventId, data, pageHtml, {
            eventId: eventId, event: data, mode: 'live', publicBase: base, forms: got[1], pictures: got[2],
            templateId: (changes.site || previousSite).templateId || data.templateId, origins: [cleanOrigin(body.origin)]
          });
        }).then(function (live) {
          livePages = publishedPagesOf(live);
          return readObject(fb, livePath).then(function (before) {
            undo.push(function () { return restoreObject(fb, livePath, before, HTML); });
            return saveObject(fb, livePath, live, HTML);
          });
        });
      }).then(function () {
        /* a request still waiting for this version or an older one is overtaken by this publish (approval was
           switched off meanwhile): it is closed, so it can never put the older version back (UX-108) */
        if (overtaken) changes.approval = fieldDelete();
        return commitSiteLock(fb, eventId, token, Object.assign(changes, {
          published: true, publishedAt: now, publishedBy: actor, publishedVersion: version,
          publishedPath: publicPathOf(eventId), publishedUrl: fieldDelete(), updatedAt: now, publishedPages: livePages,
          publishedSeo: data.publishedSeo
        }));
      }).then(function () {
        forgetCachedPage(eventId);
        sendJson(res, 200, {
          publishedPath: publicPathOf(eventId), publishedUrl: base + publicPathOf(eventId),
          publishedAt: now, publishedVersion: version
        });
        if (overtaken) closeSuperseded(fb, eventId, overtaken, actor, 'Version ' + version + ' was published directly (approval was switched off), so this request was closed.');
        recordPublish(fb, eventId, version, actor, 'direct', data.published === true ? +data.publishedVersion || 0 : 0);
        logActivity(fb, eventId, decoded, 'published', 'version ' + version, { version: version });
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

   Who may approve: the Approvers and Admins of Settings › Access (approvalsConfig, below); and never the person
   who asked, unless config/approvals' `allowSelf` is true. `required: false` turns
   approval off and lets Publish go live at once.

   Everything above is written to the event's history (events/<id>/activity) with the change or the request
   it belongs to; GET /api/event/history answers the history with those attached. ===================== */
function draftObjectPath(eventId, decoded) {
  return sitePath(eventId, 'drafts/' + String((decoded && decoded.uid) || 'anon').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) + '.html');
}
function versionPath(eventId, version) { return sitePath(eventId, 'versions/' + version + '/page.html'); }

/* The approvers are the people with the Approver or Admin role (Settings › Access, lib/access-control.js; the
   owner's choice of 10 Nov 2026, replacing config/approvals' own list); config/approvals keeps allowSelf and
   required. Until the access list is first saved, its Approvers are the ones config/approvals named, and its
   Admin the first admin. There is always an Admin, so the list is never empty. */
function approvalsConfig(fb) {
  return Promise.all([fb.db.collection('config').doc('approvals').get(), accessControl.readConfig(fb)]).then(function (r) {
    var snap = r[0], d = snap.exists ? (snap.data() || {}) : {}, cfg = r[1];
    return {
      approvers: accessControl.approversWith(cfg, d.approvers),
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
   a save fails — what it cannot do is logged, and the save stands. -> { changeId, summary, items }
   opts.kind: '' for a person's save; 'content' when it only brought in what changed in Content (stageContent);
   'automatic' for the editor's own load-time updates (PUT /api/event/site, automatic: true). The approval page
   lists those apart from the person's changes. An automatic version is nobody's change: it is recorded, and told
   in the History, as AUTOMATIC_BY's, with who pressed Save kept as savedBy (UX-076: an untouched Save recorded
   "4 sections edited" under the person's name). */
var AUTOMATIC_BY = 'Site editor (automatic)';
function recordSave(fb, eventId, decoded, version, beforeHtml, pageHtml, note, opts) {
  var HTML = 'text/html; charset=utf-8', now = new Date().toISOString(), actor = actorOf(decoded);
  var kind = (opts && opts.kind) || '';
  var by = kind === 'automatic' ? AUTOMATIC_BY : actor;
  var items = [];
  try { items = diffPages(beforeHtml || '', pageHtml); } catch (e) { console.error('api: could not compare versions of ' + eventId + ' — ' + e.message); }
  var summary = beforeHtml == null ? 'first saved version' : summarise(items);
  var told = kind === 'automatic' ? 'updated automatically when the site editor opened: ' : '';
  return Promise.all([
    saveObject(fb, versionPath(eventId, version), pageHtml, HTML),
    saveObject(fb, stagingObjectPath(eventId), pageHtml, HTML)
  ]).then(function () {
    var change = {
      at: now, by: by, version: version, baseVersion: version - 1, summary: summary,
      items: beforeHtml == null ? [] : items, note: String(note || '').trim().slice(0, 500)
    };
    if (kind) change.kind = kind;
    if (by !== actor) change.savedBy = actor;
    return eventDocRef(fb, eventId).collection('changes').add(change);
  }).then(function (ref) {
    var named = beforeHtml == null ? '' : sectionNames(items);   // which sections: "Hero, Speakers, Agenda"
    logActivity(fb, eventId, by === actor ? decoded : by, 'site-saved', 'version ' + version + ' — ' + told + summary + (named ? ' (' + named + ')' : ''), { area: 'site', changeId: ref.id, version: version });
    return { changeId: ref.id, summary: summary, items: items };
  }).then(null, function (err) {
    console.error('api: the save of ' + eventId + ' v' + version + ' was stored but not recorded — ' + (err && err.message));
    return { changeId: '', summary: summary, items: items };
  });
}

/* ---------- Content reaches the staged copy (the owner, 3 Nov 2026) ----------
   A speaker, session, sponsor, picture, FAQ or contact added, changed or removed in the console is drawn into the
   saved site at once and kept as a version of its own ("Content: 1 FAQ added", by whoever changed it), on the
   staging address. It goes live like any edit: with the next approval (handleApprovalRequest draws Content in
   first, so a request always holds it). A site that is not live yet simply shows it from then on.

   The event's records, by console resource, as GET /api/event/<resource> lists them -> Promise<rows> (the sponsors'
   tiers too: a real template lists its sponsors tier by tier) */
var RECORD_RESOURCES = ['speakers', 'sessions', 'agenda-groups', 'faqs', 'partners', 'partner-tiers', 'contacts', 'gallery'];
function readRecordRows(fb, eventId) {
  return Promise.all(RECORD_RESOURCES.map(function (name) {
    return RESOURCES[name].col(fb, eventId).get().then(function (snap) {
      return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).sort(byRecordOrder);
    });
  })).then(function (lists) {
    var rows = {};
    RECORD_RESOURCES.forEach(function (name, i) { rows[name] = lists[i]; });
    return rows;
  });
}
/* Draws the event's records — and its name, date and place from Basics — into its saved site and keeps the result as
   a new version, when that changes what a visitor would see. A real template's own lists are drawn here too
   (site-records.js drawOwn: TPL-007, TPL-034), so nothing waits for the site editor: needsEditor is always [] (kept
   for the console that reads it). -> Promise<{ notSaved } | { version, staged, summary, items, changeId, unplaced,
   needsEditor, published, publishedVersion }> — staged false when the saved site already shows Content as it is.
   opts.transform(page, event) -> { html, changed }, for an operator's tool only (tools/refresh-dummy-dates.js): a
   change of its own made to the saved site in place of the drawing, kept as a version the same way. */
function stageContent(fb, eventId, decoded, opts) {
  var token = crypto.randomBytes(12).toString('hex'), actor = actorOf(decoded), now = new Date().toISOString();
  return loadLiveEvent(fb, eventId).then(function (data) {
    if (!siteVersionOf(data)) return { notSaved: true, published: data.published === true };
    return acquireSiteLock(fb, eventId, token, null).then(function (data) {
      var site = data.site || {}, current = siteVersionOf(data), templateId = site.templateId || data.templateId || null;
      var answer = { version: current, staged: false, summary: '', items: [], unplaced: [], needsEditor: [],
        published: data.published === true, publishedVersion: data.published === true ? (+data.publishedVersion || 0) : 0 };
      return Promise.all([readObject(fb, sitePath(eventId, 'page.html')), readRecordRows(fb, eventId)]).then(function (got) {
        var page = got[0];
        if (page == null) throw httpError(409, 'The saved site could not be found. Open the site editor and save it again.', { code: 'site-not-saved' });
        var drawn = opts && typeof opts.transform === 'function' ? opts.transform(page, data)
          : siteRecords.renderRecords(page, got[1], { templateId: templateId, event: data });
        answer.unplaced = drawn.unplaced || [];
        var items = [];
        if (drawn.changed) { try { items = diffPages(page, drawn.html); } catch (e) { items = [{ type: 'unknown' }]; } }
        /* nothing a visitor would see (a page that only gains its records' ids): no new version */
        if (!items.length) return releaseSiteLock(fb, eventId, token).then(function () { return answer; });
        var version = current + 1;
        return saveObject(fb, sitePath(eventId, 'page.html'), drawn.html, 'text/html; charset=utf-8').then(function () {
          /* the editor's own state is not changed: it draws the records itself when it opens; contentBase is the
             last version made by anything but Content (it stays through a run of Content versions), and a save
             built on it or on any of those versions is no conflict (handleSitePut) */
          return commitSiteLock(fb, eventId, token, {
            site: Object.assign({}, site, { version: version, updatedAt: now, updatedBy: actor, contentBase: site.contentBase != null ? +site.contentBase : current }),
            updatedAt: now
          });
        }).then(function () {
          return recordSave(fb, eventId, decoded, version, page, drawn.html, (opts && opts.note) || '', { kind: (opts && opts.kind) || 'content' });
        }).then(function (rec) {
          return Object.assign(answer, { version: version, staged: true, summary: rec.summary, items: rec.items.slice(0, 20), changeId: rec.changeId });
        });
      }).then(null, function (err) {
        return releaseSiteLock(fb, eventId, token).then(function () { throw err; });
      });
    });
  });
}

/* ---------- POST /api/event/site/records ----------
   Body { eventId } -> 200 stageContent's answer, plus pending (the request waiting for approval: { id, toVersion,
   reviewPath } or null) and approvalRequired. The console calls it once a change in Content has been saved. */
function handleSiteRecords(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    stageContent(fb, eventId, decoded).then(function (out) {
      return Promise.all([loadLiveEvent(fb, eventId), approvalsConfig(fb)]).then(function (r) {
        var a = r[0].approval;
        out.pending = a && a.id ? { id: a.id, toVersion: +a.toVersion || 0, reviewPath: reviewPathOf(eventId, a.id) } : null;
        out.approvalRequired = r[1].required;
        sendJson(res, 200, out);
      });
    }).catch(function (err) { sendFailure(res, 'site records', err, 'The change is saved in Content, but it could not be put on the site’s staged copy. Please try again.'); });
  });
}

function handleApprovalRequest(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var note = String(body.note || '').trim().slice(0, 1000), actor = actorOf(decoded), now = new Date().toISOString();
    var ref = eventDocRef(fb, eventId);
    /* what changed in Content since the last save goes in with the request: it is drawn into the site first */
    stageContent(fb, eventId, decoded).then(function () { return loadLiveEvent(fb, eventId); }).then(function (data) {
      var version = siteVersionOf(data);
      if (!version) throw httpError(409, 'Save the site first: there is nothing to send for approval yet.', { code: 'site-not-saved' });
      var liveVersion = data.published === true ? (+data.publishedVersion || 0) : 0;
      /* the version that is live, going out again with new search and sharing settings (Settings › URL & SEO): a
         request of its own, listing those changes alone */
      var seoOnly = data.published === true && liveVersion === version;
      return Promise.all([
        liveVersion ? readObject(fb, versionPath(eventId, liveVersion)) : Promise.resolve(null),
        readObject(fb, versionPath(eventId, version)).then(function (t) { return t != null ? t : readObject(fb, sitePath(eventId, 'page.html')); }),
        ref.collection('changes').where('version', '>', liveVersion).orderBy('version').limit(60).get(),
        seoChangeItems(fb, eventId, data)
      ]).then(function (r) {
        var before = r[0], after = r[1];
        if (seoOnly && !r[3].length) throw httpError(409, 'The saved site and its search and sharing settings are already live: there is nothing new to publish.', { code: 'nothing-to-publish' });
        if (after == null) throw httpError(409, 'The saved site could not be found. Save it again, then send it for approval.', { code: 'site-not-saved' });
        /* the live version again: what it shows is live already, so nothing about it can hold it back */
        if (seoOnly) return r;
        var logoNote = unansweredLogoNote(after);
        if (logoNote) throw logoNoteError(logoNote, 'owner');
        /* what would hold the version back at approval is said now, to the person asking (siteCheckGate) */
        return siteCheckGate(fb, eventId, data, after, 'owner', null).then(function () { return r; });
      }).then(function (r) {
        var before = r[0], after = r[1];
        var saves = r[2].docs.map(function (d) { var c = d.data(); return { id: d.id, at: c.at, by: c.by, version: c.version, summary: c.summary, note: c.note || '', items: c.items || [], kind: c.kind || '' }; })
          .filter(function (c) { return c.version <= version; });
        /* what the reviewer is shown: live against proposed when the live version's page was kept, else the
           saves one after another */
        var items = [], seoItems = r[3] || [];
        /* a first publication has no "before": the whole site is new, and listing every section as added says nothing */
        if (before != null && !seoOnly) { try { items = diffPages(before, after); } catch (e) { items = []; } }
        if (liveVersion && before == null && !seoOnly) saves.forEach(function (c) { items = items.concat(c.items); });
        /* kept within one document, and never cut unsaid: what is past the caps is counted in the last item, which the
           summary counts too (page-diff listed; UX-114: a silent cut at 60 left a fourth FAQ out and said "3 FAQs added") */
        items = listed(items);
        /* a change only the editor's automatic updates made (no person's save touched that section the same way)
           is listed apart on the review page */
        var autoKeys = {}, ownKeys = {};
        saves.forEach(function (c) {
          if (c.kind === 'content') return;
          c.items.forEach(function (i) { (c.kind === 'automatic' ? autoKeys : ownKeys)[i.section + '|' + i.type] = 1; });
        });
        items = items.map(function (i) {
          return autoKeys[i.section + '|' + i.type] && !ownKeys[i.section + '|' + i.type] && !/^record-|^more$/.test(i.type) ? Object.assign({}, i, { auto: true }) : i;
        });
        /* the search and sharing changes (Settings › URL & SEO) come after the site's, at most 40, and the summary says
           both */
        var siteSummary = !liveVersion ? 'the whole site, going live for the first time' : summarise(items);
        var seoCount = seoItems.filter(function (i) { return !i.record; }).length;
        var seoSummary = seoCount ? 'search and sharing: ' + seoCount + (seoCount === 1 ? ' change' : ' changes') : '';
        if (seoOnly && !seoSummary) seoSummary = 'search and sharing: the speakers and FAQs given to search engines';
        items = items.concat(seoItems.slice(0, 40));
        /* who changed it: the people who saved, not the site editor's own updates */
        var people = [];
        saves.forEach(function (c) { if (c.by && c.kind !== 'automatic' && people.indexOf(c.by) === -1) people.push(c.by); });
        var pendingId = data.approval && data.approval.id;
        var doc = {
          status: 'pending', eventId: eventId, updatedAt: now, fromVersion: liveVersion, toVersion: version,
          firstPublish: !liveVersion, note: note, items: items,
          summary: seoOnly ? seoSummary : !seoSummary ? siteSummary : siteSummary === 'no visible change' ? seoSummary : siteSummary + '; ' + seoSummary,
          /* the SEO section as it was when this was asked for: what the approver sees, and what approving puts live */
          seoOnly: seoOnly, seo: JSON.parse(JSON.stringify((data.settings && data.settings.seo) || {})),
          contributors: people,
          saves: saves.map(function (c) { var o = { id: c.id, at: c.at, by: c.by, version: c.version, summary: c.summary, note: c.note }; if (c.kind) o.kind = c.kind; return o; })
        };
        var target = pendingId ? ref.collection('approvals').doc(pendingId) : ref.collection('approvals').doc();
        return (pendingId ? target.get() : Promise.resolve(null)).then(function (snap) {
          var open = snap && snap.exists && snap.data().status === 'pending';
          if (!open) { target = ref.collection('approvals').doc(); doc.requestedBy = actor; doc.requestedAt = now; }
          else { doc.requestedBy = snap.data().requestedBy; doc.requestedAt = snap.data().requestedAt; doc.resubmittedBy = actor; }
          return target.set(doc, { merge: true }).then(function () {
            return ref.update({ approval: { id: target.id, toVersion: version, requestedBy: doc.requestedBy, requestedAt: doc.requestedAt, updatedAt: now, seoOnly: !!doc.seoOnly } });
          }).then(function () {
            logActivity(fb, eventId, decoded, 'approval-requested', 'version ' + version + ' — ' + doc.summary + (open ? ' (request updated)' : ''), { approvalId: target.id, version: version });
            var reviewPath = reviewPathOf(eventId, target.id);
            sendJson(res, 200, { id: target.id, status: 'pending', toVersion: version, fromVersion: liveVersion, summary: doc.summary, updated: !!open, reviewPath: reviewPath, reviewUrl: cmsOriginFor(req, body.origin) + reviewPath });
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
    decidedBy: d.decidedBy || '', decidedAt: d.decidedAt || null, decisionNote: d.decisionNote || '',
    seoOnly: d.seoOnly === true
  };
}

function handleApprovalGet(req, res) {
  var since = Date.now();
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
        /* a request a newer live version has overtaken is said so, and cannot be decided (staleRequestWhy) */
        var stale = staleRequestWhy(request, data);
        var why = request ? (stale || whyNotApprover(cfg, actorOf(decoded), request.requestedBy)) : '';
        /* a request whose version's logo unit still carries its notice cannot be approved (publishVersion's logoGate):
           said before the approver tries, so they can reject it with the reason */
        var pendingNew = request && request.status === 'pending' && !(data.published === true && +data.publishedVersion === request.toVersion);
        var page = pendingNew ? readObject(fb, versionPath(eventId, request.toVersion)).then(function (t) {
          return t != null ? t : siteVersionOf(data) === request.toVersion ? readObject(fb, sitePath(eventId, 'page.html')) : null;
        }).then(null, function () { return null; }) : Promise.resolve(null);
        /* and, asked for with ?checks=1 (the review page, after its first paint), what the site check finds on it
           (siteCheckOf): listed for the approver before they decide, and what blocks it keeps Approve away, as the
           logo unit's notice does. The site editor reads this view on every open, and does not wait for it. */
        var wantChecks = qs.get('checks') === '1';
        /* the version live before the one live now, when it is still kept: an approver may put it back (UX-107) */
        var previous = data.published === true ? liveVersionsOf(fb, eventId).then(function (list) {
          var p = previousLiveOf(list, +data.publishedVersion || 0);
          if (!p) return null;
          return fb.bucket.file(versionPath(eventId, p.version)).exists().then(function (e) { return e && e[0] ? p : null; });
        }).then(null, function (err) {
          console.error('api: the versions live before on ' + eventId + ' could not be read — ' + (err && err.message));
          return null;
        }) : Promise.resolve(null);
        return Promise.all([page, previous]).then(function (pp) {
          previous = pp[1];
          return pp[0];
        }).then(function (html) {
          return html == null || !wantChecks ? { html: html, check: null } : livePageOf(fb, eventId, data).then(function (livePage) {
            /* with the check before Publish (advisory), as the person sending it saw it: the approver sees the same list */
            return siteCheckOf(fb, eventId, data, html, { records: true, livePage: livePage, advisory: { version: request.toVersion, waitMs: advisoryWait(qs.get('wait')), since: since } });
          }).then(function (check) {
            return { html: html, check: check };
          }, function (err) {
            console.error('api: the site check of ' + eventId + ' v' + request.toVersion + ' failed — ' + (err && err.message));
            return { html: html, check: null };
          });
        }).then(function (pg) {
        var html = pg.html, check = pg.check;
        var logoNote = unansweredLogoNote(html);
        var checkErr = siteCheckError(check, 'approver');
        var canDecide = !!request && request.status === 'pending' && !why;
        sendJson(res, 200, {
          eventId: eventId, name: data.name || eventId, me: actorOf(decoded),
          published: data.published === true, publishedVersion: data.published === true ? (+data.publishedVersion || 0) : 0,
          publishedPath: data.published === true ? publicPathOf(eventId) : null, savedVersion: siteVersionOf(data),
          /* when and by whom the site was last saved, and how many AI-written sections nobody has checked in it (null:
             not known for a site saved before that was counted): Publish says the one and sends the person to the
             site editor's check for the other, wherever it is pressed (UX-105, UX-112) */
          savedAt: (data.site && data.site.updatedAt) || null, savedBy: (data.site && data.site.updatedBy) || '',
          aiUnchecked: data.site && typeof data.site.aiUnchecked === 'number' ? data.site.aiUnchecked : null,
          /* canDecide: may approve or reject; canApprove: may approve too (not while the logo unit's notice is open,
             said in whyNot — it can still be rejected with that reason) */
          request: request, canDecide: canDecide, canApprove: canDecide && !logoNote && !checkErr,
          whyNot: why || (logoNote ? logoNoteError(logoNote, 'approver').message : checkErr ? checkErr.message : ''),
          checks: check ? check.items : null, checksPending: check ? check.pending || 0 : 0,
          approvers: cfg.approvers, allowSelf: cfg.allowSelf, required: cfg.required,
          /* the version that was live before this one ({ version, at }), still kept, or null; and whether the person
             asking may put it back or take the site offline (approvers only, lib/access.js notAnApprover) */
          previousLive: previous, mayTakeDown: !require('./access').notAnApprover(cfg.approvers, actorOf(decoded)),
          stale: !!stale,
          /* with each decision's reason: the editor and the console tell the person who asked what was decided and why,
             on their next visit (UX-103) */
          requests: x[1].docs.map(function (d) { var v = d.data(); return { id: d.id, status: v.status, requestedBy: v.requestedBy, requestedAt: v.requestedAt, toVersion: v.toVersion, summary: v.summary, decidedBy: v.decidedBy || '', decidedAt: v.decidedAt || null, decisionNote: v.decisionNote || '' }; }),
          logoNote: !!logoNote
        });
        });
      });
    }).catch(function (err) { sendFailure(res, 'approval get', err, 'The request could not be loaded. Please try again.'); });
  });
}

/* ---------- Settings › URL & SEO going live ----------
   A live page shows the SEO values as they were published, never the draft (owner rule: nothing in the console
   changes a live site without a publish or an approval). Every publish and approval writes the copy that goes live
   on the event (publishedSeo, seo-fields.js snapshot), and sets it on `data` first, so that the transform writes the
   page from it; /e/<id>'s page pass reads the same copy on every serve (site-a11y.js, seoFor 'live').
   source: an object — the settings.seo an approval request was made with (what the approver saw); 'keep' — the copy
   that is live already (a site published before the copy existed keeps the four settings it had then); anything
   else — the draft as it is now (a direct publish, where approval is switched off). The records that count for
   search (the speakers and FAQs the site shows, less those the team took out) are read now. It never holds a
   publish up: records that cannot be read go live as none, which the console's SEO section then shows.
   -> Promise<the page text>, passed through */
function seoRecordsNow(fb, eventId, fields) {
  var ref = eventDocRef(fb, eventId);
  return Promise.all([ref.collection('speakers').get(), ref.collection('faqs').get()]).then(function (r) {
    function rows(snap) { return snap.docs.map(function (d) { return Object.assign({}, d.data(), { id: d.id }); }); }
    return seoFields.pickRecords(fields, rows(r[0]), rows(r[1]));
  });
}
function withPublishedSeo(fb, eventId, data, page, source, actor) {
  var keep = source === 'keep';
  var fields = source && typeof source === 'object' ? source
    : keep ? (isPlainObject(data.publishedSeo) && isPlainObject(data.publishedSeo.fields) ? data.publishedSeo.fields : seoFields.seoFor(data, 'live'))
    : ((data.settings && data.settings.seo) || {});
  var records = keep ? Promise.resolve(seoFields.recordsFor(data)) : seoRecordsNow(fb, eventId, fields).then(null, function (err) {
    console.error('api: the speakers and FAQs of ' + eventId + ' could not be read for search, published as none — ' + (err && err.message));
    return { speakers: [], faqs: [] };
  });
  return Promise.all([page, records]).then(function (r) {
    data.publishedSeo = seoFields.snapshot(fields, r[1], actor);
    return r[0];
  });
}
/* What the next publish changes in search and sharing, as the approver's list has changes: the SEO values against the
   copy that is live, and the speakers and FAQs that count against those published with it.
   -> Promise<[{ type: 'seo', section, name, before, after }]>, never rejecting */
function seoChangeItems(fb, eventId, data) {
  var draft = (data.settings && data.settings.seo) || {};
  function item(c) { return { type: 'seo', section: 'Search & sharing', name: c.label, before: c.before, after: c.after }; }
  var fieldItems = seoFields.changes(draft, seoFields.seoFor(data, 'live')).map(item);
  return seoRecordsNow(fb, eventId, draft).then(function (records) {
    /* which speakers and FAQs search engines are given follows Content: listed for the approver, but a change in Content
       is already counted as the site's own, so these are not counted again (record: true) */
    return fieldItems.concat(seoFields.recordChanges(records, seoFields.recordsFor(data)).map(function (c) { return Object.assign(item(c), { record: true }); }));
  }, function () { return fieldItems; });
}

/* The internal pages of a page going live, recorded on the event (publishedPages) for the sitemap: [{ slug, title }],
   or a delete of the field for a one-page site (most of them: nothing is written that was not there). */
function publishedPagesOf(html) {
  var list = sitePages.readPages(html, TOKEN_KIT).map(function (p) { return { slug: p.slug, title: p.title }; });
  return list.length ? list : fieldDelete();
}

/* ---------- which versions have been live, and requests that a newer live version has overtaken ----------
   Every time a version goes live it is noted in events/<id>/publishes ({ version, at, by, how: 'approved' | 'direct' |
   'restored', replaced }) — a collection of its own, so a copy of the event (api-events.js clones an allow-list of
   collections) never inherits another event's history. It is what lets an approver put the previous version back
   (POST /api/event/restore-version, UX-107). Noting it never fails the publish. */
function recordPublish(fb, eventId, version, actor, how, replaced) {
  try {
    return eventDocRef(fb, eventId).collection('publishes').add({ version: +version, at: new Date().toISOString(), by: actor, how: how, replaced: +replaced || 0 })
      .then(null, function (err) { console.error('api: could not note that ' + eventId + ' v' + version + ' went live — ' + (err && err.message)); });
  } catch (err) { console.error('api: could not note that ' + eventId + ' v' + version + ' went live — ' + (err && err.message)); return Promise.resolve(); }
}
/* The versions that have been live, newest first: [{ version, at, before }]. From the publishes noted above and, for
   what went live before they were noted, the approved requests (each one's version went live when it was decided, and
   its fromVersion was live until then: `before`, placed just before the request, its own start not known).
   requests: [{ status, toVersion, fromVersion, decidedAt, requestedAt }]. */
function liveVersionsFrom(publishes, requests) {
  var list = [];
  (publishes || []).forEach(function (p) { if (+p.version > 0 && p.at) list.push({ version: +p.version, at: String(p.at) }); });
  (requests || []).forEach(function (r) {
    if (!r || r.status !== 'approved' || !r.decidedAt) return;
    if (+r.toVersion > 0) list.push({ version: +r.toVersion, at: String(r.decidedAt) });
    /* live just before this one went live: placed a moment before its decision */
    if (+r.fromVersion > 0) list.push({ version: +r.fromVersion, at: String(r.requestedAt || r.decidedAt), before: true });
  });
  list.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : (a.before ? 1 : 0) - (b.before ? 1 : 0); });
  return list.map(function (x) { return { version: x.version, at: x.at, before: !!x.before }; });
}
/* the version that was live before the one live now -> { version, at } | null; at: when it last went live before
   then, or null when that is not recorded */
function previousLiveOf(list, liveVersion) {
  var i = 0;
  while (i < list.length && list[i].version === liveVersion) i++;
  if (i === 0 || i >= list.length) return null;   // the live version is not in the record: nothing says what came before it
  var v = list[i].version, at = null;
  for (var j = i; j < list.length && at == null; j++) if (list[j].version === v && !list[j].before) at = list[j].at;
  return { version: v, at: at };
}
function liveVersionsOf(fb, eventId) {
  var ref = eventDocRef(fb, eventId);
  return Promise.all([
    ref.collection('publishes').orderBy('at', 'desc').limit(40).get().then(function (snap) { return snap.docs.map(function (d) { return d.data(); }); }),
    ref.collection('approvals').orderBy('requestedAt', 'desc').limit(40).get().then(function (snap) { return snap.docs.map(function (d) { return d.data(); }); })
  ]).then(function (r) { return liveVersionsFrom(r[0], r[1]); });
}
/* A request still waiting whose version (or a newer one) is already live can no longer be decided: approving it
   would put that version live again over a newer one (UX-108: approving an old request put v9 live over v10).
   -> '' when it may still be decided, else why not */
function staleRequestWhy(request, data) {
  if (!request || request.status !== 'pending' || data.published !== true) return '';
  var live = +data.publishedVersion || 0, v = +request.toVersion || 0;
  if (!live || live < v) return '';
  /* A request for search and sharing settings alone (Settings › URL & SEO) is for the version that is live: approving it
     puts those settings live. It is overtaken only when the site went live again after it was sent. */
  if (request.seoOnly && live === v) {
    var sent = String(request.updatedAt || request.requestedAt || ''), went = isoOf(data.publishedAt) || '';
    return sent && went && went > sent ? 'The site went live again after this request was sent, with the search and sharing settings it had then. Send it for approval again if these still need to go live.' : '';
  }
  return live === v ? 'Version ' + v + ' is already live, so there is nothing left to approve in this request.'
    : 'Version ' + live + ' is live now, which is newer than this request (version ' + v + '): approving it would put an older version back. Send the site for approval again if it still needs to go live.';
}
/* closes such a request: status 'superseded', with who and why; never the reason the caller fails */
function closeSuperseded(fb, eventId, id, actor, why) {
  if (!id) return Promise.resolve();
  return eventDocRef(fb, eventId).collection('approvals').doc(id).update({ status: 'superseded', decidedBy: actor, decidedAt: new Date().toISOString(), decisionNote: why })
    .then(null, function (err) { console.error('api: could not close the overtaken request ' + id + ' of ' + eventId + ' — ' + (err && err.message)); });
}

/* Makes one kept version the live page. The caller has decided that it may. */
/* opts.logoGate: refuse a version whose logo unit still carries its notice (logoNoteError, worded for an approver),
   or that the site check holds back (siteCheckGate: template text, a picture that cannot be shown, last year's
   logo), unless it is the version already live — an approval, never tools/republish-current.js, which re-publishes
   what is live as it is.
   opts.closeOvertaken: the request waiting for this version or an older one is closed as overtaken once this version
   is live (a restore, UX-108: putting version 8 back left the request for version 8 waiting, so the dashboard still
   offered Review for a version that was already live). It is read under the site lock, as the direct publish does,
   so a request sent for a newer version meanwhile is left waiting. An approval does not ask for it: the request it
   decides is the one waiting, and it is marked approved instead. */
function publishVersion(fb, req, eventId, version, actor, origin, extra, opts) {
  var HTML = 'text/html; charset=utf-8', token = crypto.randomBytes(12).toString('hex'), now = new Date().toISOString();
  var base = publicBaseFor(req, origin), livePath = publishedObjectPath(eventId), undo = null, livePages = null, overtaken = '';
  return acquireSiteLock(fb, eventId, token, null).then(function (data) {
    if (opts && opts.closeOvertaken && data.approval && data.approval.id && (+data.approval.toVersion || 0) <= version) overtaken = String(data.approval.id);
    var text = readObject(fb, versionPath(eventId, version)).then(function (text) {
      if (text != null) return text;
      return siteVersionOf(data) === version ? readObject(fb, sitePath(eventId, 'page.html')) : null;
    });
    /* the SEO values that go live: an approval's, as its request carried them (what the approver saw); otherwise the
       copy already live is kept (tools/republish-current.js puts live what is live, as it is) */
    text = withPublishedSeo(fb, eventId, data, text, opts && opts.seo !== undefined ? opts.seo : 'keep', actor);
    return Promise.all([text, publicFormsFor(fb, eventId, data)]).then(withPictures(fb)).then(function (got) {
      var pageHtml = got[0];
      if (pageHtml == null) throw httpError(409, 'Version ' + version + ' of this site is no longer stored. Save the site again and send a new request.', { code: 'version-missing' });
      var alreadyLive = data.published === true && +data.publishedVersion === version;
      var note = opts && opts.logoGate && !alreadyLive ? unansweredLogoNote(pageHtml) : null;
      if (note) throw logoNoteError(note, 'approver');
      /* an approval of a version that has what blocks it (siteCheckGate): refused, worded for the approver */
      return (opts && opts.logoGate && !alreadyLive ? siteCheckGate(fb, eventId, data, pageHtml, 'approver', got[1]) : Promise.resolve()).then(function () {
        return liveWithShareCard(fb, eventId, data, pageHtml, {
          eventId: eventId, event: data, mode: 'live', publicBase: base, forms: got[1], pictures: got[2],
          templateId: (data.site && data.site.templateId) || data.templateId, origins: [cleanOrigin(origin)]
        });
      }).then(function (live) {
        livePages = publishedPagesOf(live);
        return readObject(fb, livePath).then(function (before) {
          undo = function () { return restoreObject(fb, livePath, before, HTML); };
          return saveObject(fb, livePath, live, HTML);
        });
      });
    }).then(function () {
      return commitSiteLock(fb, eventId, token, Object.assign({
        published: true, publishedAt: now, publishedBy: actor, publishedVersion: version,
        publishedPath: publicPathOf(eventId), publishedUrl: fieldDelete(), updatedAt: now, publishedPages: livePages,
        publishedSeo: data.publishedSeo
      }, overtaken ? { approval: fieldDelete() } : {}, extra || {}));
    }).then(function () {
      forgetCachedPage(eventId);
      var out = { publishedPath: publicPathOf(eventId), publishedUrl: base + publicPathOf(eventId), publishedAt: now, publishedVersion: version };
      /* closed before the answer goes back, so the review page opened next already says "Closed"; closeSuperseded
         never fails the call (the version is live either way) */
      return overtaken ? closeSuperseded(fb, eventId, overtaken, actor, 'Version ' + version + ' was put back live, so this request was closed.').then(function () { return out; }) : out;
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
      if (request.status === 'superseded') throw httpError(409, 'A newer version went live after this request was sent, so it was closed. Send the site for approval again if it still needs to go live.', { code: 'request-closed' });
      if (request.status !== 'pending') throw httpError(409, 'This request was already ' + request.status + (request.decidedBy ? ' by ' + request.decidedBy : '') + '.', { code: 'request-closed' });
      var why = whyNotApprover(cfg, actor, request.requestedBy);
      if (why) throw httpError(403, why, { code: 'not-an-approver' });
      /* a newer version (or this one) is live already: closed as overtaken, never put live over it */
      var stale = staleRequestWhy(request, r[0]);
      if (stale) {
        return closeSuperseded(fb, eventId, id, actor, stale).then(function () {
          return (r[0].approval && r[0].approval.id === id ? ref.update({ approval: fieldDelete() }) : Promise.resolve()).then(null, function () {});
        }).then(function () { throw httpError(409, stale, { code: 'request-stale' }); });
      }
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
      }, { logoGate: true, seo: isPlainObject(request.seo) ? request.seo : undefined }).then(function (out) {
        return reqRef.update(Object.assign({ status: 'approved' }, closed)).then(function () {
          recordPublish(fb, eventId, request.toVersion, actor, 'approved', r[0].published === true ? +r[0].publishedVersion || 0 : 0);
          logActivity(fb, eventId, decoded, 'approved', 'version ' + request.toVersion + ' — ' + (request.summary || '') + (note ? ' — “' + note + '”' : ''), { approvalId: id, version: request.toVersion, requestedBy: request.requestedBy });
          logActivity(fb, eventId, decoded, 'published', 'version ' + request.toVersion + ', requested by ' + request.requestedBy + ', approved by ' + actor, { approvalId: id, version: request.toVersion });
          sendJson(res, 200, Object.assign({ id: id, status: 'approved' }, out));
        });
      });
    }).catch(function (err) { sendFailure(res, 'approval decide', err, 'The decision could not be recorded. Please try again.'); });
  });
}

/* ---------- the approval rule (config/approvals), for every event ----------
   GET  /api/settings/approvals -> { approvers, allowSelf, required, me, canEdit, whyNot, history: [{ at, by, before,
        after }] } — its one place is Settings › Publishing approvals (settings.html); the review page only shows it
   PUT  /api/settings/approvals { allowSelf, required } -> { approvers, allowSelf, required }
   Who approves is no longer set here: it is everybody with the Approver or Admin role in Settings › Access
   (approvalsConfig). An `approvers` list sent here is not used. Only an approver may change the two switches
   (UX-108: any member could turn approval off for every event, unasked and unrecorded). Every change is recorded
   with what it was before and after (config/approvals/log), and the page shows it. */
function approvalSettingsWhyNot(cfg, email) {
  return require('./access').notAnApprover(cfg.approvers, email, 'change these settings');
}
var APPROVALS_LOG = function (fb) { return fb.db.collection('config').doc('approvals').collection('log'); };
function handleApprovalSettingsGet(req, res) {
  withAdmin(req, res, function (fb, decoded) {
    var me = actorOf(decoded).toLowerCase();
    Promise.all([approvalsConfig(fb), APPROVALS_LOG(fb).orderBy('at', 'desc').limit(10).get().then(function (snap) {
      return snap.docs.map(function (d) { var v = d.data() || {}; return { at: v.at || null, by: v.by || '', before: v.before || null, after: v.after || null }; });
    }, function (err) { console.error('api: the approval settings log could not be read — ' + (err && err.message)); return []; })]).then(function (r) {
      var cfg = r[0], why = approvalSettingsWhyNot(cfg, me);
      sendJson(res, 200, Object.assign({}, cfg, { me: me, canEdit: !why, whyNot: why, history: r[1], approversFrom: 'access' }));
    }).catch(function (err) { sendFailure(res, 'approval settings', err, 'The settings could not be loaded.'); });
  });
}
function handleApprovalSettingsPut(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var actor = actorOf(decoded).toLowerCase(), now = new Date().toISOString();
    var doc = { allowSelf: body.allowSelf === true, required: body.required !== false, updatedAt: now, updatedBy: actor };
    approvalsConfig(fb).then(function (cfg) {
      var why = approvalSettingsWhyNot(cfg, actor);
      if (why) throw httpError(403, why, { code: 'not-an-approver' });
      var before = { allowSelf: cfg.allowSelf, required: cfg.required };
      var after = { allowSelf: doc.allowSelf, required: doc.required };
      var same = JSON.stringify(before) === JSON.stringify(after);
      /* merge: config/approvals' old `approvers` list stays as it was (the access list started from it) */
      return fb.db.collection('config').doc('approvals').set(doc, { merge: true }).then(function () {
        sendJson(res, 200, { approvers: cfg.approvers, allowSelf: doc.allowSelf, required: doc.required });
        if (same) return;
        console.log('api: approval settings changed by ' + actor + ' — ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after));
        return APPROVALS_LOG(fb).add({ at: now, by: actor, before: before, after: after }).then(null, function (err) {
          console.error('api: the approval settings change could not be recorded — ' + (err && err.message));
        });
      });
    }).catch(function (err) { sendFailure(res, 'approval settings', err, 'The settings could not be saved.'); });
  });
}

/* =====================================================================================================
   THE SITE CHECK (lib/site-checks.js) — what is wrong with a page before it goes live, and with a page that
   is live, in words an owner and an approver can act on (the UX sweep of 3 Nov 2026: a template nobody had
   filled in went live, a picture's address had a typo, Register buttons led nowhere, and nothing said so).
     siteCheckOf(fb, eventId, data, html, opts) -> Promise<{ items, blocking }>
       items: [{ code, level: 'block' | 'warn' | 'info', title, lines: [text], hint, action? }]
       opts: { forms (the public forms payload, when read), records: true to read Content's records too,
               live: true for the page that is live (says why search engines are kept away), probe (tests),
               livePage: the page of the version that is live now (livePageOf), when a newer one is checked,
               advisory: { version, waitMs, since? (when the request came in: waitMs counts from it), fetch?, fetchOptions? } to add the check before Publish too
               (lib/site-advisory.js: links and pictures on other sites, empty sections, dates and place, the
               banner's logo, forms switched off) — the publish window and the review page ask for it; the gate
               never does, so it never holds anything back nor makes publishing wait for other sites }
       -> also pending: how many outside links and pictures are still being asked about (advisory only), and
          each item's fix: [{ where, key | route, label, href }] — the places to put it right
   'block' holds a version back: publishing it, asking for its approval and approving it all refuse (409
   'site-check', the items with the answer) — never the version already live going out again.
   A version of a site that is live is held back only by what it would put live that is not live already: a
   problem the live page shows too (the same template text, sample, picture address or logo) is said as a 'warn'
   with alreadyLive: true, so a repair — a picture's address put right, ET's header and footer — can go live while
   the rest still waits to be put right, and the live site is never kept worse than the version waiting for it.
   The check of the live page itself (live: true) is said the same way: what it shows already holds no next
   version back. (UX-144: the national-data-center-symposium repair was refused for the "Sponsor 1" the live
   page already showed, so its broken picture stayed live.)
     placeholders  template text a visitor would read ("Event name goes here", "Sponsor 1")        block
     samples       a real template's samples of its design (data-rv-sample: another event's copy, figures, quotes) block
     pictures      a picture whose address cannot be shown (a mistyped bucket, or no such picture) block
     logo-year     the header or footer logo showing another year than this edition's            block
     et-chrome     an AI-designed site built before ET's header and footer (its logo boxed, no phone
                   menu, no legal links) — with the repair that puts them in (POST /api/event/site/repair) warn
     records       sample entries in Content (a sponsor named "Sponsor 1")                        warn
     headings      a section whose heading repeats an earlier one's (or the hero's line) — on an AI-designed
                   site with the repair that has ETB2B AI write it one of its own (UX-155)          warn
     payment       a button that promises tickets or payment, which this release does not take    warn
     buttons       what the live page puts right on its way out (site-checks.js repair)           info, warn when hidden
     search        kept out of search engines, and why (the live page only)                       info
   ===================================================================================================== */
var SITE_CHECK_CODE = 'site-check';

/* ---- headings that repeat (UX-155) ----
   Generation writes a section again when its heading repeats one before it (repeatedHeadingIds); a page made
   before that (agentic-summit-2027: "Not more AI. Better AI." over its overview and the next section) still shows
   it, so the site check says so and its repair has ETB2B AI write the later section a heading of its own. */
/* each section's heading in page order: the banner's (its h1) and every other section's first h2; the header and
   footer have none. page: the site page the section is on (data-rv-page, templates/_shared/rv-pages.js: none or
   "home" is the home page). -> [{ id, text, words, page }] */
function sectionHeadings(html) {
  html = String(html || '');
  var tokens = tokenizeHtml(html), out = [];
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t !== 'open') continue;
    var id = attrValue(t, 'data-rv-section');
    if (!id) continue;
    var end = elementEnd(tokens, i);
    if (end === -1) continue;
    if (id !== 'nav' && id !== 'footer') {
      var tag = id === 'hero' ? 'h1' : 'h2';
      var m = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'i').exec(html.slice(t.s, tokens[end].e));
      var words = m ? headingWords('<h2>' + m[1] + '</h2>') : '';
      if (words) out.push({ id: id, text: headingText('<h2>' + m[1] + '</h2>'), words: words, page: String(attrValue(t, 'data-rv-page') || 'home') });
    }
    i = end;                                        // a section inside a section is part of it
  }
  return out;
}
/* the sections whose heading repeats an earlier one's on the same page of the site (the banner's line included); the
   first keeps it. An award site's FAQ page may share a heading with the home page's: a visitor never sees both.
   -> [{ id, text, firstId }] */
function repeatedPageHeadings(html) {
  var seen = {}, out = [];
  sectionHeadings(html).forEach(function (h) {
    var key = h.page + '|' + h.words;
    if (Object.prototype.hasOwnProperty.call(seen, key)) { if (h.id !== 'hero') out.push({ id: h.id, text: h.text, firstId: seen[key] }); }
    else seen[key] = h.id;
  });
  return out;
}
/* html with the words of the first <tag> inside the element marked data-rv-section="id" (or, with no id, the first
   <tag> of html) set to text; the tag and its attributes stay. -> html, or null when there is no such heading */
function withHeadingText(html, id, tag, text) {
  html = String(html || '');
  var tokens = tokenizeHtml(html), from = 0, to = tokens.length - 1;
  if (id) {
    from = -1;
    for (var i = 0; i < tokens.length; i++) if (tokens[i].t === 'open' && attrValue(tokens[i], 'data-rv-section') === id) { from = i; break; }
    if (from === -1) return null;
    to = elementEnd(tokens, from);
    if (to === -1) return null;
  }
  for (var k = from; k <= to; k++) {
    if (tokens[k].t !== 'open' || tokens[k].name !== tag) continue;
    var close = elementEnd(tokens, k);
    if (close === -1 || close === k) return null;
    return html.slice(0, tokens[k].e) + escHtmlText(text) + html.slice(tokens[close].s);
  }
  return null;
}
/* a section's words as a visitor reads them (no markup, no scripts or styles), cut to max */
function sectionWords(html, id, max) {
  var tokens = tokenizeHtml(String(html || '')), from = -1;
  for (var i = 0; i < tokens.length; i++) if (tokens[i].t === 'open' && attrValue(tokens[i], 'data-rv-section') === id) { from = i; break; }
  if (from === -1) return '';
  var end = elementEnd(tokens, from);
  var part = String(html).slice(tokens[from].s, end === -1 ? undefined : tokens[end].e)
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  return part.length > max ? part.slice(0, max) + '…' : part;
}
var HEADINGS_SCHEMA = { type: 'OBJECT', properties: { headings: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  id: { type: 'STRING' }, heading: { type: 'STRING' } }, required: ['id', 'heading'] } } }, required: ['headings'] };
var HEADING_MAX_CHARS = 70, HEADING_MAX_WORDS = 10;
/* ETB2B AI writes each repeated section (repeatedPageHeadings) a heading of its own from that section's words, in
   the page's style. A heading is refused when it is any other heading on the page (or another new one), when it is
   too long, or when it copies a run of three or more of the section's own words (the sentence under it, its small
   label): the
   section would then say the same thing twice, as before. A refused answer is asked for once more, told why.
   -> Promise<{ id: heading }>, or a 502 'ai-heading' httpError when the second answer is unusable too (nothing is
   changed then) */
function plainWords(s) { return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function writeSectionHeadings(fb, eventId, data, page, reps) {
  var taken = sectionHeadings(page), ids = reps.map(function (r) { return r.id; });
  var keep = taken.filter(function (h) { return ids.indexOf(h.id) === -1; });
  var words = {};
  reps.forEach(function (r) { words[r.id] = sectionWords(page, r.id, 1500); });
  var base = [
    'You write section headings for an event\'s website. Some sections repeat the heading of a section before them, so a visitor reads the same heading twice. Write each of the sections below a heading of its own.',
    'Event: ' + String(data.name || eventId).slice(0, 200) + '.',
    'Headings already on the page, which no new heading may repeat or closely echo: ' + keep.map(function (h) { return '"' + h.text + '"'; }).join(', ') + '.',
    'Rules: say what THAT section is about, from its own words below, but in NEW words: never copy a sentence, a phrase or the small label from its words, because the heading sits right above them and would say the same thing twice. ' +
      HEADING_MAX_WORDS + ' words at most and ' + HEADING_MAX_CHARS + ' characters at most; the same voice, capitalisation and punctuation as the heading it had; plain words only (no HTML, no quotation marks, no emoji); never invent facts, numbers or names that are not in its words; two new headings never the same.',
    'Sections:'
  ].concat(reps.map(function (r) {
    return '- id: ' + r.id + '; its heading now: "' + r.text + '"; its words: "' + words[r.id].replace(/"/g, '\'') + '"';
  })).concat(['Answer with one entry per section, by its id.']).join('\n');
  function ask(prompt) {
    return llm.callJson(prompt, HEADINGS_SCHEMA, { route: 'site-heading', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.small, onUsage: aiUsageRecorder(fb, eventId, 'site-heading') }).then(function (r) {
      var list = r && r.parsed && Array.isArray(r.parsed.headings) ? r.parsed.headings : [];
      var used = keep.map(function (h) { return h.words; }), out = {}, why = [];
      reps.forEach(function (rep) {
        var got = list.filter(function (x) { return x && x.id === rep.id; })[0];
        var text = got ? String(got.heading || '').replace(/<[^>]*>/g, '').replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, '').replace(/\s+/g, ' ').trim() : '';
        var w = headingWords('<h2>' + escHtmlText(text) + '</h2>');
        if (!text || !w) return why.push(rep.id + ': no heading');
        if (text.length > HEADING_MAX_CHARS || text.split(' ').length > HEADING_MAX_WORDS) return why.push(rep.id + ': "' + text + '" is too long');
        if (used.indexOf(w) !== -1) return why.push(rep.id + ': "' + text + '" is another heading on the page');
        /* three words or more found together in the section's words: a copy (two can meet by chance) */
        if (w.split(' ').length >= 3 && (' ' + plainWords(words[rep.id]) + ' ').indexOf(' ' + w + ' ') !== -1) return why.push(rep.id + ': "' + text + '" copies the section\'s own words');
        used.push(w);
        out[rep.id] = text;
      });
      return { out: out, why: why, code: r && (r.code || r.error) };
    });
  }
  return ask(base).then(function (first) {
    if (!first.why.length) return first;
    return ask(base + '\nYour last answer could not be used: ' + first.why.join('; ') + '. Write each of them again, in new words, keeping to the rules.');
  }).then(function (got) {
    if (got.why.length) {
      console.error('api: the new headings for ' + eventId + ' were not usable — ' + (got.code || got.why.join('; ')));
      throw httpError(502, 'ETB2B AI did not write a heading of its own for ' + (reps.length === 1 ? 'that section' : 'each of those sections') + ' just now. Nothing was changed. Try again, or change the heading in the site editor.', { code: 'ai-heading' });
    }
    return got.out;
  });
}

var SITE_CHECK_PICTURES_MAX = 80, SITE_CHECK_LINES_MAX = 12;
/* whether an object of ours exists, for a few minutes: the review page asks again on every open */
var STORAGE_SEEN = new Map(), STORAGE_SEEN_TTL_MS = 5 * 60 * 1000;
function storageExists(fb, objectPath) {
  var hit = STORAGE_SEEN.get(objectPath);
  if (hit && Date.now() - hit.at < STORAGE_SEEN_TTL_MS) return Promise.resolve(hit.ok);
  return fb.bucket.file(objectPath).exists().then(function (r) {
    if (STORAGE_SEEN.size > 2000) STORAGE_SEEN.clear();
    STORAGE_SEEN.set(objectPath, { at: Date.now(), ok: !!r[0] });
    return !!r[0];
  });
}
function quoteText(s, max) { s = String(s || ''); max = max || 90; return '“' + (s.length > max ? s.slice(0, max - 1) + '…' : s) + '”'; }
function capLines(lines) {
  return lines.length > SITE_CHECK_LINES_MAX ? lines.slice(0, SITE_CHECK_LINES_MAX - 1).concat(['…and ' + (lines.length - SITE_CHECK_LINES_MAX + 1) + ' more']) : lines;
}
/* The years this edition goes by: the one in its name ("… Summit 2026") and the one it is held in (its start date).
   Both, as either can be on its logo: an edition named for 2026 but held in January 2027 shows 2026 rightly. The
   name's comes first, as the one people read. -> [2026, 2027] | [] */
function editionYearsOf(data) {
  var out = siteChecks.yearsIn((data && data.name) || '').slice(0, 1);
  var m = /^(\d{4})-/.exec(String((data && data.start) || ''));
  if (m && out.indexOf(+m[1]) === -1) out.push(+m[1]);
  return out;
}

/* The pictures of storage.googleapis.com a page names that cannot be shown: one of ours that is not there, or one
   in another bucket that answers it has no such picture (asked of storage itself: probeUrl) — a mistyped bucket's
   fix is ours, when the same picture is there. A picture that cannot be asked about right now is not reported.
   probe: (url) -> Promise<HTTP status, 0 when unknown> (tests pass their own). -> Promise<[{ url, why, fixUrl }]> */
function probeUrl(url) {
  return safeFetch(url, { timeoutMs: 6000, maxBytes: 4096, headers: { Range: 'bytes=0-0' } }).then(function (r) { return r.status; }, function (err) {
    return err && err.code === 'too-large' ? 200 : 0;                     // too large to read is there
  });
}
var pictureProbe = probeUrl;          // a test sets its own (_testHooks.setPictureProbe): no network in tests
function pictureProblems(fb, html, probe) {
  var ours = fb && fb.bucket && fb.bucket.name ? String(fb.bucket.name).toLowerCase() : '';
  if (!ours) return Promise.resolve([]);
  probe = probe || pictureProbe;
  var refs = siteChecks.storageRefs(html).slice(0, SITE_CHECK_PICTURES_MAX);
  return Promise.all(refs.map(function (r) {
    if (r.bucket === ours) {
      return storageExists(fb, r.path).then(function (ok) { return ok ? null : { url: r.url, why: 'there is no such picture in storage', fixUrl: '' }; }, function () { return null; });
    }
    return probe(r.url).then(function (status) {
      if (!(status >= 400 && status < 500)) return null;                   // there, or not known now
      var why = siteChecks.nearBucket(r.bucket, ours) ? 'its address names “' + r.bucket + '”, a typo of this product’s storage (“' + ours + '”)'
        : 'its address answers that there is no such picture (' + status + ')';
      return storageExists(fb, r.path).then(function (ok) {
        return { url: r.url, why: why, fixUrl: ok ? r.url.replace(/^(https:\/\/storage\.googleapis\.com\/)[^\/]+/i, '$1' + ours) : '' };
      }, function () { return { url: r.url, why: why, fixUrl: '' }; });
    });
  })).then(function (list) { return list.filter(Boolean); });
}

/* The header and footer logos against this edition: a year they say (their file's name, the words of an SVG of
   ours) that is not this edition's -> 'year'; no year to read, but the site has a logo unit for this edition and
   they show another picture -> 'unit'. -> Promise<{ wrong: [{ where, years }], notUnit: bool }> */
function logoProblems(fb, data, logos) {
  var want = editionYearsOf(data), design = (data && data.designPlan && data.designPlan.design) || {};
  var unitUrls = [design.logoUnitUrl, design.logoUnitDarkUrl].filter(Boolean);
  var ours = fb && fb.bucket && fb.bucket.name ? String(fb.bucket.name).toLowerCase() : '';
  return Promise.all((logos || []).map(function (l) {
    var file = String(l.src).replace(/[?#].*$/, '').split('/').pop() || '';
    try { file = decodeURIComponent(file); } catch (e) { /* as written */ }
    var years = siteChecks.yearsIn(file);
    var ref = siteChecks.storageRefs(l.src)[0];
    var svg = ref && ref.bucket === ours && /\.svg$/i.test(ref.path) ? readObject(fb, ref.path).then(null, function () { return null; }) : Promise.resolve(null);
    return svg.then(function (text) {
      /* only the words an SVG draws as text: the numbers of its outlines are coordinates, not years */
      var words = [], re = /<text\b[^>]*>([\s\S]*?)<\/text>/gi, m;
      while (text && (m = re.exec(text))) words.push(m[1].replace(/<[^>]+>/g, ' '));
      siteChecks.yearsIn(words.join(' ')).forEach(function (y) { if (years.indexOf(y) === -1) years.push(y); });
      return { where: l.where, src: l.src, years: years };
    });
  })).then(function (list) {
    return {
      wrong: want.length ? list.filter(function (l) { return l.years.length && !l.years.some(function (y) { return want.indexOf(y) !== -1; }); }) : [],
      notUnit: unitUrls.length > 0 && list.some(function (l) { return unitUrls.indexOf(l.src) === -1; }),
      want: want.join(' / ')
    };
  });
}

/* A real template's samples of its design (data-rv-sample in the index.html of each of its sections: another event's
   quotes, people, logos, figures and copy — TPL-051), read from disk once per file version. -> { texts, srcs, wholes,
   instructions } (instructions: the design's own notes of what belongs there, data-rv-sample="instruction": NU-023) */
var TEMPLATE_SAMPLES = {};
function templateSamples(templateId) {
  var none = { texts: [], srcs: [], wholes: [], instructions: [] };
  if (typeof templateId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(templateId) || /^(gen|imported)-/.test(templateId)) return none;
  try {
    var dir = path.join(TEMPLATES_DIR, templateId, 'sections');
    var files = fs.readdirSync(dir).map(function (d) { return path.join(dir, d, 'index.html'); }).filter(function (f) { return fs.existsSync(f); });
    var stamp = files.map(function (f) { return f + ':' + fs.statSync(f).mtimeMs; }).join('|');
    var hit = TEMPLATE_SAMPLES[templateId];
    if (hit && hit.stamp === stamp) return hit.samples;
    var samples = { texts: [], srcs: [], wholes: [], instructions: [] };
    files.forEach(function (f) {
      var text = fs.readFileSync(f, 'utf8');
      if (text.indexOf('data-rv-sample') === -1) return;
      var got = siteChecks.samplesOf(text, TOKEN_KIT);
      samples.texts = samples.texts.concat(got.texts);
      samples.srcs = samples.srcs.concat(got.srcs);
      samples.wholes = samples.wholes.concat(got.wholes);
      samples.instructions = samples.instructions.concat(got.instructions || []);
    });
    TEMPLATE_SAMPLES[templateId] = { stamp: stamp, samples: samples };
    return samples;
  } catch (e) { return none; }
}

/* The names the site editor lists a site's sections by (NU-002), so the site check, the publish window and the
   console say "Questions this raises", "Who should attend", "Manifesto" — never a section's id in words ("Who enter",
   "Conventions box", "About wrapper"), which the person never sees. A real template's are its template.json
   sections[].name (editor-canvas.js names them so; read from disk once per file version), an AI-designed site's its
   plan's (GET /api/generated-template: designPlan.sections[].name, the top bar "Top bar"). A section the design has
   no name for is named by its id in words, as the editor does; one the design does not have at all by its heading
   (site-checks.js titleOf). -> { sectionId: name } ({} for an imported site: one page, "Page") */
var SECTION_NAMES = {};
function sectionNamesFor(data) {
  var templateId = String((data && data.site && data.site.templateId) || (data && data.templateId) || '');
  var out = {};
  function put(id, name) {
    id = String(id == null ? '' : id).trim();
    if (!id || Object.prototype.hasOwnProperty.call(out, id)) return;
    name = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    out[id] = (name && name !== id ? name : siteChecks.sectionName(id)).slice(0, 80);
  }
  if (/^gen-/.test(templateId)) {
    (((data && data.designPlan) || {}).sections || []).forEach(function (x) { if (x && x.id) put(x.id, x.name); });
    put('nav', 'Top bar');
    return out;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(templateId) || /^imported-/.test(templateId)) return out;
  try {
    var file = path.join(TEMPLATES_DIR, templateId, 'template.json');
    var mtime = fs.statSync(file).mtimeMs, hit = SECTION_NAMES[templateId];
    if (!hit || hit.mtime !== mtime) {
      var json = JSON.parse(fs.readFileSync(file, 'utf8'));
      hit = SECTION_NAMES[templateId] = { mtime: mtime, sections: Array.isArray(json && json.sections) ? json.sections.map(function (x) { return { id: x && x.id, name: x && x.name }; }) : [] };
    }
    hit.sections.forEach(function (x) { put(x.id, x.name); });
  } catch (e) { /* no names: the check names sections by their ids, as before */ }
  return out;
}
/* TOKEN_KIT with the site's section names (site-checks.js kit.names), for what is said to a person */
function namedKit(data) { return Object.assign({}, TOKEN_KIT, { names: sectionNamesFor(data) }); }

/* The words of Content's records a visitor would read as names (site-checks.js recordPlaceholders), read with only
   those fields: a sponsor's or speaker's logo and photo can be stored inline and are not wanted here.
   -> Promise<{ partners, speakers, faqs, sessions, contacts } | null> (null: could not be read; nothing is said) */
var CONTENT_NAMES = { partners: ['name'], speakers: ['name'], faqs: ['question'], sessions: ['title'], contacts: ['name', 'email', 'phone'] };
/* the console tab each kind of record is put right in (edit-event.html's routes) */
var RECORD_TABS = { partners: 'content/sponsors', speakers: 'content/speakers', faqs: 'content/faq', sessions: 'content/agenda', contacts: 'content/contact' };
function contentNames(fb, eventId) {
  var ref = eventDocRef(fb, eventId), kinds = Object.keys(CONTENT_NAMES);
  return Promise.all(kinds.map(function (k) {
    var q = ref.collection(k);
    return (typeof q.select === 'function' ? q.select.apply(q, CONTENT_NAMES[k]) : q).limit(300).get();
  })).then(function (snaps) {
    var out = {};
    kinds.forEach(function (k, i) { out[k] = snaps[i].docs.map(function (d) { return d.data() || {}; }); });
    return out;
  }, function (err) {
    console.error('api: the site check could not read the records of ' + eventId + ' — ' + (err && err.message));
    return null;
  });
}
/* What an event supplied, for the facts on its AI-designed site (BE-043, lib/invented-facts.js): its record as the
   owner keeps it, its latest brief, its own sources (never a competitor's) and its Content records.
   -> Promise<ground | null> (null: could not be read; nothing is said) */
var FACT_RECORD_FIELDS = { speakers: ['name', 'desig', 'comp', 'bio'], partners: ['name', 'url'], faqs: ['question', 'answer'],
  sessions: ['title', 'desc'], contacts: ['label', 'name', 'email', 'phone'] };
function factGroundOf(fb, eventId, data) {
  var ref = eventDocRef(fb, eventId), kinds = Object.keys(FACT_RECORD_FIELDS), plan = (data && data.designPlan) || {};
  return Promise.all([ref.collection('briefs').orderBy('createdAt', 'desc').limit(1).get(), ref.collection('sources').get()].concat(kinds.map(function (k) {
    var q = ref.collection(k);
    return (typeof q.select === 'function' ? q.select.apply(q, FACT_RECORD_FIELDS[k]) : q).limit(300).get();
  }))).then(function (snaps) {
    var brief = snaps[0].empty ? null : snaps[0].docs[0].data().extracted;
    var sources = snaps[1].docs.map(function (d) { return d.data() || {}; }).filter(function (v) { return v.type !== 'competitor'; })
      .map(function (v) { return [{ url: v.url, extractedSections: v.extractedSections }, inventedFacts.previousFacts(v.previous)]; });
    var records = kinds.map(function (k, i) { return snaps[i + 2].docs.map(function (d) { return d.data() || {}; }); });
    return inventedFacts.groundOf(eventFacts(data, null), data && data.description, plan.ownerNotes, plan.owner,
      data && data.settings && data.settings.seo, brief, sources, records);
  }, function (err) {
    console.error('api: the site check could not read what ' + eventId + ' supplied — ' + (err && err.message));
    return null;
  });
}
/* the sections of an AI-designed site the server built from the event's record and ET's own details: the banner, the
   top bar, the footer, the previous edition's sections, and an award site's (from ETB2B's award records) */
function factSkips(data) {
  var ids = ['hero', 'nav', 'footer', 'award-*'];
  (((data && data.designPlan) || {}).sections || []).forEach(function (x) { if (x && x.prebuilt && x.id) ids.push(String(x.id)); });
  return ids;
}
function siteCheckOf(fb, eventId, data, html, opts) {
  opts = opts || {};
  data = data || {};
  var page = String(html == null ? '' : html);
  /* every section named as the site editor names it (NU-002) */
  var kit = namedKit(data), names = kit.names;
  var ins = siteChecks.inspect(page, kit);
  var fixed = siteChecks.repair(page, kit, { eventId: eventId, homeHref: publicPathOf(eventId), portal: data.portal, forms: opts.forms });
  var after = siteChecks.inspect(fixed.html, kit);
  var records = opts.records ? contentNames(fb, eventId) : Promise.resolve(null);
  /* an AI-designed site: what its words state that nothing the event supplied supports (BE-043) */
  var facts = ins.generated ? Promise.resolve().then(function () { return factGroundOf(fb, eventId, data); }).then(function (g) {
    return g ? inventedFacts.findings(page, g, kit, { skipSections: factSkips(data) }) : [];
  }).then(null, function (err) {
    console.error('api: the facts check of ' + eventId + ' failed — ' + (err && err.message));
    return [];
  }) : Promise.resolve([]);

  var hits = siteChecks.sampleHits(page, kit, templateSamples((data.site && data.site.templateId) || data.templateId || ''));
  /* the design's own notes of what belongs there, apart from another event's words (NU-023) */
  var samples = hits.filter(function (h) { return !h.instruction; }), notes = hits.filter(function (h) { return h.instruction; });
  var onLive = alreadyLiveTest(opts.live ? page : opts.livePage, data);
  /* the forms are handed over still being read, so other sites are asked meanwhile: the first list comes sooner */
  var adv = opts.advisory ? Promise.resolve().then(function () {
    return siteAdvisory.check(page, {
      kit: kit, eventId: eventId, event: data, inspect: ins, forms: opts.forms !== undefined ? opts.forms : publicFormsFor(fb, eventId, data),
      pages: sitePages.readPages(page, TOKEN_KIT), version: opts.advisory.version, waitMs: advisoryLeft(opts.advisory),
      fetch: opts.advisory.fetch, fetchOptions: opts.advisory.fetchOptions
    });
  }).then(null, function (err) {
    /* the check before Publish is advice: when it fails, the rest of the check still stands */
    console.error('api: the check before Publish of ' + eventId + ' failed — ' + (err && err.message));
    return null;
  }) : Promise.resolve(null);
  /* the places to put right what the check finds (the site editor at a section, the console at a tab) */
  function inEditor(places) { return siteAdvisory.sectionFixes(eventId, data, places || []); }
  function placesOf(list) { var out = []; (list || []).forEach(function (h) { out = out.concat(h.places || []); }); return out; }
  return Promise.all([pictureProblems(fb, page, opts.probe), logoProblems(fb, data, ins.logos), records, adv, facts]).then(function (got) {
    var pics = got[0], logos = got[1], siteData = got[2], advice = got[3], items = [];
    /* each kind that holds a version back, split in two when the live page has some of it already (onLive) */
    blockUnlessLive(items, 'placeholders', ins.placeholders, onLive.placeholder, function (list) {
      return { title: 'Template text is still on the page',
        lines: capLines(list.map(function (h) { return quoteText(h.text) + (h.count > 1 ? ' ×' + h.count : '') + ' — ' + h.sections.join(', '); })),
        hint: 'Write the event’s own words in the site editor, or take the section out, then save.', fix: inEditor(placesOf(list)) };
    });
    /* another event's quotes, people, logos, figures or copy the template shows as samples of its design (TPL-051) */
    blockUnlessLive(items, 'samples', samples, onLive.sample, function (list) {
      return { title: 'Samples from the template are still on the page',
        lines: capLines(list.map(function (h) { return (h.picture ? 'Their picture ' + quoteText(h.text, 70) : quoteText(h.text, 70)) + (h.count > 1 ? ' ×' + h.count : '') + ' — ' + h.sections.join(', '); })),
        hint: 'They belong to another event: its words, figures, quotes, people or logos, shown until this event’s own are entered. Put this event’s own in, or take them out, in the site editor, then save.', fix: inEditor(placesOf(list)) };
    });
    /* the design's own notes of what to write there, which would go live as the page's words (NU-023) */
    blockUnlessLive(items, 'instructions', notes, onLive.sample, function (list) {
      return { title: list.length === 1 ? 'A writing tip from the template is still on the page' : 'Writing tips from the template are still on the page',
        lines: capLines(list.map(function (h) { return quoteText(h.text, 70) + (h.count > 1 ? ' ×' + h.count : '') + ' — ' + h.sections.join(', '); })),
        hint: (list.length === 1 ? 'It says' : 'They say') + ' what belongs there; visitors would read ' + (list.length === 1 ? 'it' : 'them') + ' as they are. Write this event’s own words in ' + (list.length === 1 ? 'its' : 'their') + ' place, or take the section out, in the site editor, then save.',
        fix: inEditor(placesOf(list)) };
    });
    blockUnlessLive(items, 'pictures', pics, onLive.picture, function (list) {
      var fixable = list.filter(function (p) { return p.fixUrl; }).length;
      return { title: list.length === 1 ? '1 picture cannot be shown' : list.length + ' pictures cannot be shown',
        lines: capLines(list.map(function (p) { return quoteText(p.url.split('/').pop(), 60) + ': ' + p.why; })),
        hint: fixable ? 'The right address of ' + (fixable === 1 ? 'it' : fixable + ' of them') + ' is known. Correct it here, or replace the picture in the site editor.' : 'Replace it in the site editor, then save.',
        action: fixable ? { kind: 'pictures', label: fixable === 1 ? 'Correct the picture’s address' : 'Correct the pictures’ addresses' } : null, fix: inEditor([]) };
    });
    var chromeAction = ins.generated && ins.hasNav && ins.hasFooter ? { kind: 'et-chrome', label: 'Update this site’s header and footer' } : null;
    blockUnlessLive(items, 'logo-year', logos.wrong, onLive.logo, function (list) {
      return { title: 'The ' + (list[0].where === 'footer' ? 'footer' : 'header') + ' logo shows another year',
        lines: list.map(function (l) { return (l.where === 'footer' ? 'Footer' : 'Header') + ': ' + l.years.join(', ') + ' — this edition is ' + logos.want; }),
        hint: chromeAction ? 'ETB2B’s header and footer use the portal’s logo and this edition’s name and date.' : 'Replace the logo in the site editor with this edition’s, then save.',
        action: chromeAction, fix: inEditor([]) };
    });
    if (ins.generated && ((ins.hasNav && !ins.etNav) || (ins.hasFooter && !ins.etFooter))) {
      var lines = [];
      if (ins.hasNav && !ins.etNav) lines.push('The header has no menu button on phones' + (logos.notUnit ? ', and shows the logo as it was uploaded, in a box, not this edition’s logo' : '') + '.');
      if (ins.hasFooter && !ins.etFooter) lines.push('The footer has no privacy, terms or contact links.');
      items.push({ code: 'et-chrome', level: 'warn', title: 'This site was built before ETB2B’s header and footer', lines: lines,
        hint: 'In the event console, one click puts them in as a new saved version' + (opts.live ? ' and sends it for approval' : '') + '. Nothing else on the page changes.',
        action: chromeAction,
        /* the console shows its site check, with that button, above every tab */
        fix: [siteAdvisory.consoleFix(eventId, 'dashboard', chromeAction ? '“' + chromeAction.label + '” in the event console' : 'The event console')] });
    }
    var sample = siteData ? siteChecks.recordPlaceholders(siteData) : [];
    if (sample.length) {
      items.push({ code: 'records', level: 'warn', title: 'Sample entries in Content',
        lines: sample.map(function (r) { return r.label + ': ' + r.items.slice(0, 5).map(function (t) { return quoteText(t, 50); }).join(', ') + (r.items.length > 5 ? ' …' : ''); }),
        hint: 'Rename or delete them there. The page shows Content’s entries as they were when the site was last saved in the editor.',
        fix: sample.slice(0, 4).map(function (r) { return siteAdvisory.consoleFix(eventId, RECORD_TABS[r.kind] || 'content/basics', r.label); }) });
    }
    /* BE-043: never a block — the owner may have written them in since, from what they know */
    var unsupported = got[4] || [];
    if (unsupported.length) {
      items.push({ code: 'facts', level: 'warn', title: unsupported.length === 1 ? 'A fact to check: nothing this event supplied says it' : unsupported.length + ' facts to check: nothing this event supplied says them',
        lines: capLines(unsupported.map(function (f) { return quoteText(f.text, 60) + ' (' + f.label + ')' + (f.count > 1 ? ' ×' + f.count : '') + ' — ' + f.sections.join(', '); })),
        hint: 'The event’s details, brief, previous edition and Content do not mention them, so ETB2B AI may have made them up. Make sure each is true for this event, or take it out in the site editor, then save.',
        fix: inEditor(placesOf(unsupported)) });
    }
    var reps = repeatedPageHeadings(page);
    if (reps.length) {
      items.push({ code: 'headings', level: 'warn', title: reps.length === 1 ? 'Two sections have the same heading' : reps.length + ' sections repeat another section’s heading',
        lines: capLines(reps.map(function (r) { return quoteText(r.text, 70) + ' — ' + siteChecks.sectionName(r.id, names) + ' repeats ' + (r.firstId === 'hero' ? 'the banner' : siteChecks.sectionName(r.firstId, names)); })),
        hint: ins.generated ? 'Visitors read the same heading twice. ETB2B AI can write the later section a heading of its own from what that section says, as a new saved version' + (opts.live ? ' sent for approval' : '') + '; or change it in the site editor.'
          : 'Visitors read the same heading twice. Give the later section a heading of its own in the site editor, then save.',
        action: ins.generated ? { kind: 'headings', label: reps.length === 1 ? 'Write it a heading of its own' : 'Write them headings of their own' } : null,
        fix: inEditor(reps.map(function (r) { return { key: r.id, section: siteChecks.sectionName(r.id, names) }; })) });
    }
    if (after.payment.length) {
      items.push({ code: 'payment', level: 'warn', title: 'A button promises tickets or payment',
        lines: capLines(after.payment.map(function (p) { return quoteText(p.label, 50) + ' — ' + p.section; })),
        hint: 'Online payment is not available yet. Use words such as “Register” or “Request an invitation”.',
        fix: inEditor(after.payment) });
    }
    if (fixed.changes.length) {
      /* a button hidden, or what an import cannot run taken out, is worth a look; a menu link hidden with its empty
         section is what the menu does anyway */
      var hides = fixed.changes.some(function (c) { return c.what !== 'nav' && /^(?:is hidden|taken out)/.test(c.how); });
      items.push({ code: 'buttons', level: hides ? 'warn' : 'info', title: 'Put right on the live page as it is shown',
        lines: capLines(fixed.changes.map(function (c) { return quoteText(c.label, 50) + ' (' + c.section + ') ' + c.how; })),
        hint: 'Nothing to do: visitors get these. Change them in the site editor to make them part of the site.',
        fix: inEditor(fixed.changes) });
    }
    if (opts.live) {
      var why = siteChecks.noindexReason(Object.assign({ id: eventId }, data), page, kit);
      if (why) items.push({ code: 'search', level: 'info', title: 'Kept out of search engines',
        lines: [why === 'owner' ? 'Its settings say so.' : why === 'test' ? 'Its name says it is a test (' + quoteText(data.name, 60) + ').' : 'Its page is still the template (' + quoteText((ins.placeholders.filter(function (h) { return h.strong; })[0] || {}).text || 'Event name goes here') + ').'],
        hint: 'It stays live for anyone with its address; search engines are asked not to list it, and the sitemap leaves it out.' });
    }
    /* the check before Publish: after what the site check says, never a block (site-advisory.js) */
    if (advice) advice.items.forEach(function (x) { if (x.level !== 'block') items.push(x); });
    var order = { block: 0, warn: 1, info: 2 };
    items.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return { items: items, blocking: items.some(function (x) { return x.level === 'block'; }), pending: advice ? advice.pending : 0 };
  });
}

/* What the live page shows already, as four tests of one problem each (siteCheckOf): the same template text, the
   same sample, a picture at the same address, a logo of the same picture in the same place. livePage: that page's
   HTML, or null for a site that is not live (then nothing is live already, and every test says no). */
function alreadyLiveTest(livePage, data) {
  var none = function () { return false; };
  if (livePage == null) return { placeholder: none, sample: none, picture: none, logo: none };
  livePage = String(livePage);
  var ins = siteChecks.inspect(livePage, TOKEN_KIT);
  var texts = ins.placeholders.map(function (h) { return h.text; });
  var samples = siteChecks.sampleHits(livePage, TOKEN_KIT, templateSamples((data && data.site && data.site.templateId) || (data && data.templateId) || ''))
    .map(function (h) { return (h.picture ? 'picture:' : 'text:') + h.text; });
  var urls = siteChecks.storageRefs(livePage).map(function (r) { return r.url; });
  var logos = ins.logos.map(function (l) { return l.where + ' ' + l.src; });
  return {
    placeholder: function (h) { return texts.indexOf(h.text) !== -1; },
    sample: function (h) { return samples.indexOf((h.picture ? 'picture:' : 'text:') + h.text) !== -1; },
    picture: function (p) { return urls.indexOf(p.url) !== -1; },
    logo: function (l) { return logos.indexOf(l.where + ' ' + l.src) !== -1; }
  };
}
/* One kind of problem that holds a version back, pushed onto items: what the live page does not show yet as a
   'block'; what it shows already as a 'warn' (alreadyLive), which says so first — fixing it is still asked for,
   but it holds nothing back. build(list) -> { title, lines, hint, action? }. A one-click repair is offered once:
   on the 'block' when both are there. */
var ALREADY_LIVE_HINT = 'The live site shows this already, so it does not hold the next version back. ';
function blockUnlessLive(items, code, list, onLive, build) {
  var fresh = [], old = [];
  (list || []).forEach(function (x) { (onLive(x) ? old : fresh).push(x); });
  var blockItem = null;
  if (fresh.length) { blockItem = Object.assign({ code: code, level: 'block' }, build(fresh)); items.push(blockItem); }
  if (old.length) {
    var warn = Object.assign({ code: code, level: 'warn', alreadyLive: true }, build(old));
    warn.hint = ALREADY_LIVE_HINT + warn.hint;
    if (blockItem && blockItem.action && warn.action && blockItem.action.kind === warn.action.kind) warn.action = null;
    items.push(warn);
  }
}
/* The page of the version that is live now, as it was saved (its kept version, else the published page), to check
   a newer version against (siteCheckOf's livePage) -> Promise<html | null>: null for a site that is not live, or a
   page that cannot be read (then every problem holds the version back, as for a first publication) */
function livePageOf(fb, eventId, data) {
  if (!data || data.published !== true) return Promise.resolve(null);
  var v = +data.publishedVersion || 0;
  return (v ? readObject(fb, versionPath(eventId, v)) : Promise.resolve(null)).then(function (text) {
    return text != null ? text : readObject(fb, publishedObjectPath(eventId));
  }).then(function (text) { return text == null ? null : text; }, function () { return null; });
}

/* The refusal when a version has what blocks it (409 'site-check'), worded for whoever asked. who: 'owner' |
   'approver'. -> httpError, or null when nothing blocks */
function siteCheckError(check, who) {
  var block = (check && check.items || []).filter(function (x) { return x.level === 'block'; });
  if (!block.length) return null;
  var what = block.map(function (x) {
    /* the first case, short: "“Sponsor 1”", "“fiber.png”", "Header: 2026" */
    var first = x.lines && x.lines[0] ? ' (' + x.lines[0].replace(/(?: — |”: ).*$/, function (m) { return m.charAt(0) === '”' ? '”' : ''; }) + (x.lines.length > 1 ? ' …' : '') + ')' : '';
    return x.title.charAt(0).toLowerCase() + x.title.slice(1) + first;
  }).join('; ');
  var text = who === 'approver'
    ? 'These changes cannot go live yet: ' + what + '. Reject this request with the reason, so they can be put right in the site editor and sent again.'
    : 'This site cannot go live yet: ' + what + '. Put ' + (block.length > 1 ? 'these' : 'this') + ' right in the site editor, save, and send it again.';
  return httpError(409, text, { code: SITE_CHECK_CODE, checks: check.items });
}
/* -> Promise that rejects with siteCheckError when the page has what blocks it (for a site that is live: what it
   would put live that the live page does not show already) */
function siteCheckGate(fb, eventId, data, html, who, forms) {
  return livePageOf(fb, eventId, data).then(function (livePage) {
    return siteCheckOf(fb, eventId, data, html, { forms: forms, livePage: livePage });
  }).then(function (check) {
    var err = siteCheckError(check, who);
    if (err) throw err;
    return check;
  });
}

/* ---------- GET /api/event/site-check?eventId=&of=live|saved[&advisory=1&wait=ms] ----------
   The site check of the page that is live (of=live, the default) or of the site as last saved (of=saved), for
   the event console: what blocks, what to know, and what can be put right in one click (an item's action:
   'et-chrome', 'pictures' — POST /api/event/site/repair). -> { eventId, of, published, publishedVersion,
   savedVersion, approvalVersion (the version waiting for approval, 0 when none), items, blocking, found, pending }
   advisory=1 (the publish window, publish-flow.js): the check before Publish too (siteCheckOf's advisory), waiting
   at most wait ms (ADVISORY_WAIT_MS by default, never more than ADVISORY_WAIT_MAX_MS) for other sites to answer;
   pending says how many are still being asked, and asking again picks up their answers. */
var ADVISORY_WAIT_MS = 2500, ADVISORY_WAIT_MAX_MS = 8000;
function advisoryWait(v) { var n = parseInt(v, 10); return n >= 0 ? Math.min(n, ADVISORY_WAIT_MAX_MS) : ADVISORY_WAIT_MS; }
/* What is left of the wait when other sites start being asked: the wait is counted from when the request came in
   (advisory.since), so reading the event and its pages first does not add to it — the publish window's first list
   comes about wait ms after it asked, with what is known by then (the browser check of 8 Nov 2026 saw 4.9 s for a
   wait of 2.5 s). Without since, the whole wait. */
function advisoryLeft(a) {
  var wait = Math.max(0, +a.waitMs || 0);
  return a.since > 0 ? Math.max(0, wait - (Date.now() - a.since)) : wait;
}
function handleSiteCheck(req, res) {
  var since = Date.now();
  withAdmin(req, res, function (fb) {
    var qs = queryOf(req), eventId = eventIdOr400(res, qs.get('eventId'));
    if (!eventId) return;
    var of = qs.get('of') === 'saved' ? 'saved' : 'live';
    loadLiveEvent(fb, eventId).then(function (data) {
      var published = data.published === true, base = {
        eventId: eventId, of: of, published: published, publishedVersion: published ? (+data.publishedVersion || 0) : 0, savedVersion: siteVersionOf(data),
        approvalVersion: data.approval && +data.approval.toVersion || 0
      };
      if (of === 'live' && !published) return sendJson(res, 200, Object.assign(base, { items: [], blocking: false, found: false }));
      return readObject(fb, of === 'live' ? publishedObjectPath(eventId) : sitePath(eventId, 'page.html')).then(function (html) {
        if (html == null) return sendJson(res, 200, Object.assign(base, { items: [], blocking: false, found: false }));
        /* the saved version of a live site is checked against the live page, as asking for its approval will be */
        return (of === 'saved' ? livePageOf(fb, eventId, data) : Promise.resolve(null)).then(function (livePage) {
          var advisory = qs.get('advisory') === '1' ? { version: of === 'live' ? base.publishedVersion : base.savedVersion, waitMs: advisoryWait(qs.get('wait')), since: since } : null;
          return siteCheckOf(fb, eventId, data, html, { records: true, live: of === 'live', livePage: livePage, advisory: advisory });
        }).then(function (check) {
          sendJson(res, 200, Object.assign(base, { items: check.items, blocking: check.blocking, found: true, pending: check.pending || 0 }));
        });
      });
    }).catch(function (err) { sendFailure(res, 'site check', err, 'The site could not be checked. Please try again.'); });
  });
}

/* ---------- GET /api/event/site-outline?eventId= ----------
   What the site shows of the event console's Content tabs (lib/site-outline.js), so a tab can say what it costs the
   site (UX-066: "Your live site's Sponsors section is hidden until you add a confirmed sponsor"), what the site shows
   from the previous edition that the tab does not hold (UX-067), and the Event logo tile can show the logo visitors
   see (UX-071). Read off the live page while the site is live, else the site as last saved; a site never saved has
   nothing to read (of: 'none'), and the console then says nothing it cannot know.
   -> { eventId, of: 'live' | 'saved' | 'none', version, places, previous, logo, logoIsUnit }
      places: by kind, [{ key, name, hides, stands? }] — what the page does with each section's list (site-outline.js)
      logoIsUnit: the banner's picture is the design's own logo unit (designPlan.design.logoUnitUrl) — the same address,
      or the same stored file under another name: a unit made again from the same upload leaves the page with its
      older copy until the site is saved again (brand-world-summit-2026's live banner and its design, on 5 Nov 2026) */
function sameStoredPicture(fb, a, b) {
  if (!a || !b) return Promise.resolve(false);
  if (a === b) return Promise.resolve(true);
  var pa = storagePathOf(fb, a), pb = storagePathOf(fb, b);
  if (!pa || !pb) return Promise.resolve(false);
  function md5(p) { return fb.bucket.file(p).getMetadata().then(function (r) { return (r && r[0] && r[0].md5Hash) || ''; }, function () { return ''; }); }
  return Promise.all([md5(pa), md5(pb)]).then(function (h) { return !!h[0] && h[0] === h[1]; });
}
function handleSiteOutline(req, res) {
  withAdmin(req, res, function (fb) {
    var eventId = eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    loadLiveEvent(fb, eventId).then(function (data) {
      var live = data.published === true, saved = siteVersionOf(data);
      var none = { eventId: eventId, of: 'none', version: 0, places: siteOutline.outline('', TOKEN_KIT).places, previous: [], logo: '', logoIsUnit: false,
        imported: /^imported-/.test(String((data.site && data.site.templateId) || data.templateId || '')) };
      /* a live site whose published copy cannot be found is read as last saved, which is what goes live next */
      var reads = live ? [['live', publishedObjectPath(eventId), +data.publishedVersion || 0]] : [];
      if (saved) reads.push(['saved', sitePath(eventId, 'page.html'), saved]);
      function next(i) {
        if (i >= reads.length) return sendJson(res, 200, none);
        return readObject(fb, reads[i][1]).then(function (html) {
          if (html == null) return next(i + 1);
          var templateId = (data.site && data.site.templateId) || data.templateId || '';
          /* redrawn: whether the page's records are drawn again on every visit, which decides what an unmarked
             section does with no records (site-outline.js placeState) */
          var o = siteOutline.outline(html, namedKit(data), contentMapFor(templateId), { redrawn: LIVE_RUNTIME_PRESENT });
          var design = aiDesignOf(data.designPlan);
          return sameStoredPicture(fb, o.logo, design ? String(design.logoUnitUrl || '') : '').then(function (same) {
            /* imported: one captured page, which the site editor adds no section to (edit-event-site-notes.js says so) */
            sendJson(res, 200, { eventId: eventId, of: reads[i][0], version: reads[i][2], places: o.places, previous: o.previous, logo: o.logo, logoIsUnit: same,
              imported: /^imported-/.test(templateId) });
          });
        });
      }
      return next(0);
    }).catch(function (err) { sendFailure(res, 'site outline', err, 'What the site shows could not be read. Please try again.'); });
  });
}

/* ---------- POST /api/event/site/repair ----------
   Body { eventId, repairs: ['et-chrome' | 'pictures' | 'headings'] } -> 200 { version, repaired: [text], summary }.
   Puts right, in the site as last saved, what the site check offers to: 'et-chrome' — an AI-designed site built
   before ET's header and footer gets them (et-nav.js, et-footer.js: the portal's logo for its ground, never
   boxed, this edition's name, date and place, a phone menu, Register, the portal's privacy, terms and contact),
   as the brand-world-summit-2026 site was on 19 Oct; 'pictures' — a picture whose address has a mistyped bucket
   is pointed at this product's storage, where that picture is; 'headings' — a section of an AI-designed site whose
   heading repeats an earlier one's gets one of its own, written by ETB2B AI from that section's words
   (writeSectionHeadings; UX-155). The page, the editor's snapshot and the stored
   sections change together, as one new saved version with its line in the history: the editor reopens it as
   it is, and nothing goes live from here — the console then sends it for approval like any edit. */
function handleSiteRepair(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var wanted = (Array.isArray(body.repairs) ? body.repairs : []).filter(function (r, i, a) { return (r === 'et-chrome' || r === 'pictures' || r === 'headings') && a.indexOf(r) === i; });
    if (!wanted.length) return sendJson(res, 400, { error: '"repairs" must name what to put right: "et-chrome", "pictures", "headings".' });
    var token = crypto.randomBytes(12).toString('hex'), actor = actorOf(decoded), now = new Date().toISOString();
    var HTML = 'text/html; charset=utf-8', JSON_TYPE = 'application/json; charset=utf-8';
    acquireSiteLock(fb, eventId, token, function (data) {
      return siteVersionOf(data) ? null : httpError(409, 'This site has not been saved yet. Open the site editor and save it first.', { code: 'site-not-saved' });
    }).then(function (data) {
      var version = siteVersionOf(data), undo = [];
      /* the stored sections too, where the site keeps them (generated-site.js): an editor opened without its own copy
         mounts the site from them, so they are put right with the page */
      return Promise.all([readObject(fb, sitePath(eventId, 'page.html')), readObject(fb, sitePath(eventId, 'snapshot.json')), generatedSite.readAll(fb, eventId, data)]).then(function (r) {
        var before = r[0], page = r[0], snapText = r[1], snap = null;
        var storedSections = r[2] && r[2].length ? r[2] : null, keptIn = generatedSite.where(data);
        try { snap = snapText != null ? JSON.parse(snapText) : null; } catch (e) { snap = null; }
        if (page == null) throw httpError(409, 'The saved site could not be found. Open the site editor, save it once, and try again.', { code: 'site-not-saved' });
        /* a site saved before the editor's snapshot was kept on the server has none: its page and its stored
           sections are put right, and it stays without one, as before (handleSiteGet) */
        if (!snap || !Array.isArray(snap.nodes)) snap = null;
        var nodesOf = function () { return snap ? snap.nodes : []; };
        var done = [], sectionsPatch = null, planPatch = null, chain = Promise.resolve();
        if (wanted.indexOf('et-chrome') !== -1) chain = chain.then(function () {
          if (!/^gen-/.test(siteTemplateIdOf(data) || '')) throw httpError(409, 'Only a site the AI designed has ETB2B’s header and footer.', { code: 'not-ai-designed' });
          return etChromeFor(fb, eventId, data, page).then(function (built) {
            ['nav', 'footer'].forEach(function (id) {
              var next = replaceSiteSection(page, nodesOf(), id, built[id], !snap);
              if (!next) throw httpError(409, 'The site’s ' + (id === 'nav' ? 'header' : 'footer') + ' could not be found in the saved site. Open the site editor, save it once, and try again.', { code: 'section-missing' });
              page = next.page;
              if (snap) snap.nodes = next.nodes;
            });
            sectionsPatch = storedSections ? storedSections.map(function (s) {
              return s && (s.id === 'nav' || s.id === 'footer') ? Object.assign({}, s, { html: built[s.id].html, css: built[s.id].css }) : s;
            }) : null;
            done.push('ETB2B header and footer');
          });
        });
        if (wanted.indexOf('pictures') !== -1) chain = chain.then(function () {
          return pictureProblems(fb, page).then(function (pics) {
            var fixes = pics.filter(function (p) { return p.fixUrl; });
            /* every place the address is written: the page, the editor's snapshot, the stored sections and the plan's
               pictures (an editor opened without its own copy mounts the site from those) */
            function fix(v) {
              if (typeof v === 'string') return fixes.reduce(function (t, f) { return t.split(f.url).join(f.fixUrl); }, v);
              if (Array.isArray(v)) return v.map(fix);
              if (isPlainObject(v)) { var o = {}; Object.keys(v).forEach(function (k) { o[k] = fix(v[k]); }); return o; }
              return v;
            }
            if (!fixes.length) return;
            page = fix(page);
            if (snap) snap.nodes = fix(snap.nodes);
            var sections = sectionsPatch || storedSections;
            if (Array.isArray(sections) && JSON.stringify(sections) !== JSON.stringify(fix(sections))) sectionsPatch = fix(sections);
            var plan = data.designPlan && data.designPlan.sections;
            if (Array.isArray(plan) && JSON.stringify(plan) !== JSON.stringify(fix(plan))) planPatch = fix(plan);
            done.push(fixes.length === 1 ? '1 picture’s address' : fixes.length + ' pictures’ addresses');
          });
        });
        if (wanted.indexOf('headings') !== -1) chain = chain.then(function () {
          var reps = repeatedPageHeadings(page);
          if (!reps.length) return;
          if (!/^gen-/.test(siteTemplateIdOf(data) || '')) throw httpError(409, 'Only a site the AI designed has its headings written here. Change the heading in the site editor.', { code: 'not-ai-designed' });
          return writeSectionHeadings(fb, eventId, data, page, reps).then(function (written) {
            /* the page, the editor's snapshot and the stored sections, as the other repairs change them */
            reps.forEach(function (r) {
              var next = withHeadingText(page, r.id, 'h2', written[r.id]);
              if (next == null) throw httpError(409, 'The heading of “' + siteChecks.sectionName(r.id, sectionNamesFor(data)) + '” could not be found in the saved site. Open the site editor, save it once, and try again.', { code: 'section-missing' });
              page = next;
              if (snap) snap.nodes = snap.nodes.map(function (n) {
                if (typeof n !== 'string' || !new RegExp('^<[a-z][\\w-]*\\b[^>]*\\sdata-rv-section="' + r.id + '"', 'i').test(n)) return n;
                return withHeadingText(n, r.id, 'h2', written[r.id]) || n;
              });
            });
            var sections = sectionsPatch || storedSections;
            if (Array.isArray(sections)) {
              var patched = sections.map(function (sec) {
                if (!sec || !written[sec.id] || typeof sec.html !== 'string') return sec;
                var html = withHeadingText(sec.html, null, 'h2', written[sec.id]);
                return html == null ? sec : Object.assign({}, sec, { html: html });
              });
              if (JSON.stringify(patched) !== JSON.stringify(sections)) sectionsPatch = patched;
            }
            done.push(reps.map(function (r) { return siteChecks.sectionName(r.id, sectionNamesFor(data)) + '’s heading (now “' + written[r.id] + '”)'; }).join(', '));
          });
        });
        return chain.then(function () {
          if (!done.length || page === before) throw httpError(409, 'There is nothing to put right in the saved site.', { code: 'nothing-to-repair' });
          var next = version + 1, previous = data.site || {};
          undo.push(function () { return restoreObject(fb, sitePath(eventId, 'page.html'), before, HTML); });
          if (snap) undo.push(function () { return restoreObject(fb, sitePath(eventId, 'snapshot.json'), snapText, JSON_TYPE); });
          return Promise.all([
            snap ? saveObject(fb, sitePath(eventId, 'snapshot.json'), JSON.stringify(snap), JSON_TYPE) : null,
            saveObject(fb, sitePath(eventId, 'page.html'), page, HTML)
          ]).then(function () {
            /* a site generated since 13 Nov 2026 keeps its sections in documents of their own: written here, and put
               back if the save does not go through */
            if (!sectionsPatch || keptIn !== 'run') return null;
            var runId = data.generatedSite.runId;
            undo.push(function () { return generatedSite.writeSections(fb, eventId, runId, storedSections).catch(function () {}); });
            return generatedSite.writeSections(fb, eventId, runId, sectionsPatch);
          }).then(function () {
            var changes = {
              site: { version: next, snapshotVersion: snap ? next : (previous.snapshotVersion != null ? previous.snapshotVersion : 0), templateId: previous.templateId || data.templateId || null, updatedAt: now, updatedBy: actor },
              updatedAt: now
            };
            if (sectionsPatch && keptIn === 'event') changes.generatedSections = sectionsPatch;
            if (planPatch) changes['designPlan.sections'] = planPatch;
            return commitSiteLock(fb, eventId, token, changes);
          }).then(function () {
            return recordSave(fb, eventId, decoded, next, before, page, 'Put right from the site check: ' + done.join(', ')).then(function (rec) {
              sendJson(res, 200, { version: next, repaired: done, summary: rec.summary, published: data.published === true });
            });
          });
        });
      }).then(null, function (err) {
        return Promise.all(undo.map(function (step) { return step(); })).then(function () { return releaseSiteLock(fb, eventId, token); }).then(function () { throw err; });
      });
    }).catch(function (err) { sendFailure(res, 'site repair', err, 'The site could not be put right. Nothing was changed. Please try again.'); });
  });
}

/* ET's header and footer for an AI-designed site, built as generation builds them (runGenerateDesignedContent):
   the bar from the event's facts, its plan and its sources (et-nav.js), the footer from its portal (et-footer.js,
   with "What's Happening" when ET answers in time). Both are the event's own portal (events/<id>.portal,
   sitePortalOf), never one worked out from the sources: an event with none set yet gets the ET Business Verticals
   bar and the ET B2B footer. eventsOf: the portal's events (footerEvents; a test passes its own).
   -> Promise<{ nav: { html, css }, footer: { html, css } }> */
function etChromeFor(fb, eventId, data, page, eventsOf) {
  var ref = eventDocRef(fb, eventId);
  return Promise.all([
    ref.collection('sources').get(),
    ref.collection('briefs').orderBy('createdAt', 'desc').limit(1).get().then(null, function () { return null; })
  ]).then(function (r) {
    var sources = r[0].docs.map(function (d) { return d.data(); });
    var brief = r[1] && !r[1].empty ? r[1].docs[0].data().extracted : null;
    var plan = data.designPlan || {}, design = plan.design || {}, planned = plan.sections || [];
    var meta = eventFacts(data, null), owner = plan.owner || (brief && brief.owner);
    var order = pageSectionOrder(page).filter(function (id) { return id !== 'nav' && id !== 'footer'; });
    var portal = sitePortalOf(data, sources);
    /* the key is there, so et-nav.js takes the portal as given and guesses none from the sources */
    var navOpts = { order: order, sources: sources, owner: owner, portal: portal.portal };
    /* an award site: a link to each of its pages and no button in the bar, as generation makes it */
    var pages = Array.isArray(data.generatedPages) ? data.generatedPages : [];
    if (data.category === 'awards' && pages.length) {
      navOpts.cta = false;
      navOpts.tabs = pages.map(function (pg) { return { label: AWARD_TAB_LABELS[pg.slug] || pg.title, page: pg.slug }; });
    }
    var nav = etNav.sectionFor(Object.assign({}, meta, { designPlan: plan }), navOpts);
    function firstOf(kind) { return planned.filter(function (x) { return x.kind === kind; })[0]; }
    var contact = firstOf('contact'), partners = firstOf('partners');
    var buttons = ownerBrief.buttons(owner, { register: contact ? contact.id : 'footer', partner: partners ? partners.id : '' });
    var place = [meta.venue, meta.city].filter(function (v, i, list) { return v && list.indexOf(v) === i; }).join(', ') || meta.location || '';
    return (eventsOf || footerEvents)(portal.portal).then(function (list) {
      var footer = siteFooter({ portal: portal.portal, series: portal.series, events: list, design: design, eventName: meta.name,
        date: meta.dateLabel || meta.date || genDesign.dateLabel(data.start, data.end), place: place, button: buttons.primary });
      return { nav: { html: nav.html, css: nav.css }, footer: { html: footer.html, css: footer.css } };
    });
  });
}
/* the ids of a page's sections, in page order */
function pageSectionOrder(html) {
  var ids = [];
  tokenizeHtml(html).forEach(function (t) {
    var id = t.t === 'open' ? attrValue(t, 'data-rv-section') : null;
    if (id && ids.indexOf(id) === -1) ids.push(id);
  });
  return ids;
}
/* One section of a saved site replaced: its element and its stylesheet in the page, and the same two among the
   editor's snapshot nodes. The new element keeps the old one's section marks (data-rv-section, data-rv-key).
   noNodes: the site has no snapshot, so only the page is asked for. -> { page, nodes } or null when the section
   is not in both */
function replaceSiteSection(page, nodes, id, built, noNodes) {
  var tokens = tokenizeHtml(page), out = tokens.map(function (t) { return page.slice(t.s, t.e); });
  var at = -1, sheet = -1;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t !== 'open') continue;
    if (sheet === -1 && t.name === 'style' && attrValue(t, 'data-rv-style') === id) sheet = i;
    if (at === -1 && attrValue(t, 'data-rv-section') === id) at = i;
  }
  var end = at === -1 ? -1 : elementEnd(tokens, at);
  if (end === -1) return null;
  var html = withSectionMarks(built.html, id, attrValue(tokens[at], 'data-rv-key') || id);
  for (var k = at; k <= end; k++) out[k] = '';
  out[at] = html;
  var sheetText = '<style data-rv-style="' + id + '">' + built.css + '</style>';
  if (sheet !== -1 && tokens[sheet + 1] && tokens[sheet + 1].t === 'raw') out[sheet + 1] = built.css;
  else if (sheet !== -1 && tokens[sheet + 1] && tokens[sheet + 1].t === 'close') out[sheet] = out[sheet] + built.css;
  else out[at] = sheetText + html;
  var nodeAt = -1, sheetAt = -1;
  nodes.forEach(function (n, j) {
    if (typeof n !== 'string') return;
    var head = /^<([a-z][\w-]*)\b[^>]*>/i.exec(n);
    if (!head) return;
    if (sheetAt === -1 && new RegExp('^<style\\b[^>]*\\bdata-rv-style="' + id + '"').test(n)) sheetAt = j;
    else if (nodeAt === -1 && new RegExp('\\sdata-rv-section="' + id + '"').test(head[0])) nodeAt = j;
  });
  if (noNodes) return { page: out.join(''), nodes: nodes };
  if (nodeAt === -1) return null;
  var nextNodes = nodes.slice();
  nextNodes[nodeAt] = html;
  if (sheetAt !== -1) nextNodes[sheetAt] = sheetText;
  else nextNodes.splice(nodeAt, 0, sheetText);
  return { page: out.join(''), nodes: nextNodes };
}
function withSectionMarks(html, id, key) {
  var tokens = tokenizeHtml(html);
  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].t !== 'open') continue;
    var t = tokens[i];
    if (attrValue(t, 'data-rv-section') == null) setAttr(t, 'data-rv-section', id);
    if (attrValue(t, 'data-rv-key') == null) setAttr(t, 'data-rv-key', key);
    return html.slice(0, t.s) + writeTag(t) + html.slice(t.e);
  }
  return html;
}
/* ---- end of the site check ---- */

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
   stops being served at once, on every instance. The stored page is kept: publishing again replaces it.
   Approvers only (lib/access.js notAnApprover): anybody else gets 403 { code: 'not-an-approver' } and the
   site stays live. */
function handleEventUnpublish(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var now = new Date().toISOString(), ref = eventDocRef(fb, eventId), wasPublished = false;
    approvalsConfig(fb).then(function (cfg) {
      var why = require('./access').notAnApprover(cfg.approvers, actorOf(decoded), 'take a live site offline');
      if (why) throw httpError(403, why, { code: 'not-an-approver' });
      return fb.db.runTransaction(function (tx) {
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
      });
    }).then(function () {
      forgetCachedPage(eventId);
      sendJson(res, 200, { ok: true, published: false });
      if (wasPublished) logActivity(fb, eventId, decoded, 'unpublished', '');
    }).catch(function (err) { sendFailure(res, 'unpublish', err, 'The site could not be unpublished. Please try again.'); });
  });
}

/* ---------- POST /api/event/restore-version ----------
   Body { eventId, version } -> 200 { restoredVersion, replacedVersion, publishedPath, publishedUrl, publishedAt,
   publishedVersion }. Puts a version that was live before back live, at once, in place of the live one (UX-107: a
   wrong approval could only be undone by editing forward and waiting for a second approval). Approvers only, like
   taking a site offline (owner decision #4, lib/access.js notAnApprover); the version must have been live before
   (liveVersionsOf) and still be kept. It is not put through the site check again: it was approved and live once, and
   the point is to undo the version that replaced it. The saved site is left as it is, so the newer saves show as
   "not live yet" and can be sent for approval again. */
function handleRestoreVersion(req, res) {
  withAdminBody(req, res, BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var version = parseInt(body.version, 10), actor = actorOf(decoded), replaced = 0;
    if (!(version > 0)) return sendJson(res, 400, { error: 'Say which version to put back.', field: 'version' });
    approvalsConfig(fb).then(function (cfg) {
      var why = require('./access').notAnApprover(cfg.approvers, actor, 'put an earlier version of a live site back');
      if (why) throw httpError(403, why, { code: 'not-an-approver' });
      return loadLiveEvent(fb, eventId);
    }).then(function (data) {
      if (data.published !== true) throw httpError(409, 'The site is not live, so there is no live version to replace. Publish it instead.', { code: 'not-live' });
      replaced = +data.publishedVersion || 0;
      if (version === replaced) throw httpError(409, 'Version ' + version + ' is already the live version.', { code: 'already-live' });
      return liveVersionsOf(fb, eventId).then(function (list) {
        if (!list.some(function (x) { return x.version === version; })) {
          throw httpError(409, 'Version ' + version + ' has never been live, so it cannot be put back. Send it for approval instead.', { code: 'never-live' });
        }
        /* a request waiting for this version (or an older one) is overtaken once it is live, and closed (UX-108) */
        return publishVersion(fb, req, eventId, version, actor, body.origin, null, { closeOvertaken: true });
      });
    }).then(function (out) {
      recordPublish(fb, eventId, version, actor, 'restored', replaced);
      logActivity(fb, eventId, decoded, 'published', 'version ' + version + ' put back in place of version ' + replaced, { version: version });
      sendJson(res, 200, Object.assign({ restoredVersion: version, replacedVersion: replaced }, out));
    }).catch(function (err) { sendFailure(res, 'restore version', err, 'The earlier version could not be put back. The live site is unchanged. Please try again.'); });
  });
}

/* ---------- POST /api/event/stage { eventId, html, draft: true, origin } — the editor's Preview ----------
   The page as it is in that person's editor, saved or not (RevampCore.previewDraft), kept as their own preview
   (events/<id>/site/drafts/<uid>.html) and shown at /preview/<id>?draft=1. It is theirs alone and never the
   staged copy: that changes only when somebody saves (recordSave).
   A body without draft: true was the previous editor script's Preview, which wrote the page it had in hand over
   the staged copy — an unsaved page that then showed as "the staged copy" to everyone. That form is gone
   (BE-071): it answers 400 { code: 'reload-editor' }, never a silent fallback. */
function handleEventStage(req, res) {
  withAdminBody(req, res, BODY_LIMITS.site, function (fb, decoded, body) {
    var eventId = eventIdOr400(res, body.eventId);
    if (!eventId) return;
    if (body.draft !== true) return sendJson(res, 400, { error: 'This site editor is out of date. Reload the page, then press Preview again.', code: 'reload-editor' });
    if (typeof body.html !== 'string' || !body.html.trim()) return sendJson(res, 400, { error: 'The page to preview ("html") is missing.' });
    loadLiveEvent(fb, eventId).then(function () {
      return saveObject(fb, draftObjectPath(eventId, decoded), rewriteOrigins(body.html, [cleanOrigin(body.origin)]), 'text/html; charset=utf-8');
    }).then(function () {
      var previewPath = '/preview/' + eventId + '?draft=1';
      sendJson(res, 200, { stagingUrl: cmsOriginFor(req, body.origin) + previewPath, previewPath: previewPath });
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
/* link: { href (root-relative), label } — the way on, where there is one (an event's home page) */
function messagePage(title, message, link) {
  var way = link && /^\/(?!\/)[^\s"'<>]*$/.test(String(link.href || '')) && link.label
    ? '<p class="way"><a href="' + escHtmlAttr(link.href) + '">' + escHtmlText(link.label) + '</a></p>' : '';
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + escHtmlText(title) + '</title>' +
    '<link rel="icon" type="image/svg+xml" href="' + SITE_FAVICON + '">' +
    '<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#f6f7f9;color:#191b1f;' +
    'font:16px/1.5 Inter,-apple-system,"Segoe UI",Arial,sans-serif}main{max-width:460px;padding:32px 24px;text-align:center}' +
    'img{height:28px;margin-bottom:28px}h1{font-size:22px;margin:0 0 10px}p{margin:0;color:#5b616b}' +
    '.way{margin-top:24px}.way a{display:inline-block;padding:11px 20px;border-radius:8px;background:#c8161d;color:#fff;font-weight:600;text-decoration:none}' +
    '.way a:hover{background:#a81219}.way a:focus-visible{outline:3px solid #191b1f;outline-offset:2px}</style></head>' +
    '<body><main><img src="/assets/et-b2b-wordmark.svg" alt="ETB2B"><h1>' + escHtmlText(title) + '</h1><p>' + escHtmlText(message) + '</p>' + way + '</main></body></html>\n';
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
/* /e/<id>/<slug> of a live site with no page at that address: the site is there, so this is no dead end */
function noSuchPageHtml(eventId, event) {
  var name = event && typeof event.name === 'string' ? event.name.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  return messagePage('This page does not exist', 'The address may be mistyped, or the page may have been renamed or removed.',
    { href: publicPathOf(eventId), label: name ? 'Go to ' + name : 'Go to the event’s home page' });
}
function sendNoSuchPage(req, res, eventId, event) {
  sendHtml(req, res, 404, noSuchPageHtml(eventId, event), 'no-store');
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
  var entry = packPage({ at: Date.now(), source: html, noindex: siteChecks.isNoindexPage(html) });
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

/* The id of the section a QR code's /agenda or /speakers stands for on a one-page site: an element whose id is that
   word, else the first whose id holds it ("previous-speakers"). '' for any other name, or when the page has none. */
var SECTION_ANCHOR_WORDS = { agenda: /agenda/i, speakers: /speaker/i };
function sectionAnchorFor(html, slug) {
  var word = has(SECTION_ANCHOR_WORDS, slug) ? SECTION_ANCHOR_WORDS[slug] : null;
  if (!word || typeof html !== 'string') return '';
  var ids = [], re = /\sid\s*=\s*["']([A-Za-z][A-Za-z0-9_-]{0,80})["']/g, m;
  while ((m = re.exec(html))) ids.push(m[1]);
  var exact = ids.filter(function (id) { return id.toLowerCase() === slug; })[0];
  return exact || ids.filter(function (id) { return word.test(id); })[0] || '';
}

/* The document with one of its internal pages selected (site-pages.js): { html, found, page, pages } */
function selectSitePage(html, slug) { return sitePages.selectPage(html, slug, TOKEN_KIT); }

/* ---------- page views (TPL-039) ----------
   The live page with its visit counter (templates/_shared/rv-visit.js): one POST /api/track per page a visitor
   opens, counted per event per India day (api-audience.js handleTrack). It is put in as the page is served from
   /e/, never stored, so every live site counts whenever it was published, and a preview, a shared link, the editor
   and a review page never carry it. It counts in the visitor's browser because a live page is kept for a minute by
   the CDN and by browsers: most visits never reach this server. Left out while the file is not in the release. */
var VISIT_COUNTER_PRESENT = fs.existsSync(path.join(__dirname, '..', '..', 'templates', '_shared', 'rv-visit.js'));
function withVisitCounter(html, eventId) {
  if (!VISIT_COUNTER_PRESENT || typeof html !== 'string' || !html || !eventId || html.indexOf('/templates/_shared/rv-visit.js') !== -1) return html;
  var tag = '<script src="/templates/_shared/rv-visit.js" data-rv-visit="' + escHtmlAttr(eventId) + '" defer data-rv-runtime></script>';
  var at = html.toLowerCase().lastIndexOf('</body');
  return at === -1 ? html + '\n' + tag : html.slice(0, at) + tag + '\n' + html.slice(at);
}

/* ---------- QR codes (LST-038) ----------
   The events list's QR codes name the live page with ?qr=<tag> (codes made before 13 Nov 2026 carry ?ag=<tag>).
   Such a request is counted (api-audience.js countQrScan: a person's GET only, never a robot or a prefetch) and
   sent on to the same page with the tag as utm_source and "qr" as utm_medium, which is what a registration made
   there records as its source. The redirect is never kept by the CDN (no-store), so every scan reaches here.
   -> { tag, params } for such a request, else null */
function qrQueryOf(url) {
  var q = String(url || '').split('#')[0].split('?')[1];
  if (!q) return null;
  var params = new URLSearchParams(q);
  var raw = params.has('qr') ? params.get('qr') : params.has('ag') ? params.get('ag') : null;
  if (raw === null) return null;
  params.delete('qr'); params.delete('ag');
  var tag = String(raw).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return { tag: tag === '1' ? '' : tag, params: params };
}
function qrRedirect(req, res, eventId, slug, qr) {
  var params = qr.params;
  if (!params.has('utm_source')) params.set('utm_source', qr.tag || 'qr-code');
  if (!params.has('utm_medium')) params.set('utm_medium', 'qr');
  var target = publicPathOf(eventId) + (slug ? '/' + encodeURIComponent(slug) : '') + '?' + params.toString();
  var counted;
  try { counted = require('./api-audience').countQrScan(req, eventId); }
  catch (err) { console.error('api: a QR code scan of ' + eventId + ' was not counted — ' + (err && err.message)); counted = Promise.resolve(false); }
  /* the count is written before the answer (an instance may be paused once it has answered), in at most 1.5 s */
  var timer;
  Promise.race([counted, new Promise(function (resolve) { timer = setTimeout(resolve, 1500); })]).then(function () {
    clearTimeout(timer);
    if (res.headersSent) return;
    res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
    res.end();
  });
}

/* GET /e/<eventId> — the published site. Public. Served only while the event is live and published;
   anything else is the same plain 404, which gives nothing away about what exists.
   GET /e/<eventId>/<slug> — one of its internal pages: the same published document with that page selected
   (selectSitePage), cached under its own key next to the home page's. A slug the document has no page for (or
   one that cannot be a page name) is a 404 that says the page does not exist and leads to the event's home page
   (sendNoSuchPage): the site itself is live, so this is no dead end. */
function handlePublicPage(req, res, eventId, slug) {
  var fb = getFirebase();
  if (fb.error) {
    console.error('api: /e/' + eventId + ' — ' + fb.error);
    return sendHtml(req, res, 503, messagePage('This page is temporarily unavailable', 'Please try again in a few minutes.'), 'no-store');
  }
  liveEventSnap(fb, eventId).then(function (snap) {
    if (eventStateOf(snap) !== 'live' || snap.data().published !== true) return sendNotAvailable(req, res);
    var data = snap.data();
    /* a QR code from the events list (?qr=<tag>): the scan counted, the visitor sent on to the page (LST-038) */
    var qr = qrQueryOf(req.url);
    if (qr) return qrRedirect(req, res, eventId, slug, qr);
    /* the banner video is put on the page as it is served (applyHeroVideo): a change to it is a new page */
    var key = eventId + '|' + (data.publishedVersion || 0) + '|' + (data.publishedAt || '') + '|' + heroVideoStamp(data);
    var slugKey = slug ? key + '|page:' + slug : '';
    /* the page as served: the document itself, or one of its internal pages selected on it */
    function send(entry) {
      if (!slug) return sendLivePage(entry);
      var chosen = sitePages.SLUG_RE.test(slug) ? selectSitePage(entry.source, slug) : { found: false };
      /* /agenda and /speakers are what the dashboard's QR codes name (Event_Listing.html eventPublicUrl). A one-page
         site has no such page but usually such a section: the code then opens the home page at that section, so a
         code printed on a badge or a standee leads to the agenda rather than to "no such page" (UX-001). */
      var anchor = !chosen.found ? sectionAnchorFor(entry.source, slug) : '';
      if (anchor) {
        var query = String(req.url || '').split('#')[0].split('?')[1];
        res.writeHead(302, { Location: publicPathOf(eventId) + (query ? '?' + query : '') + '#' + encodeURIComponent(anchor), 'Cache-Control': LIVE_PAGE_CACHE_CONTROL });
        return res.end();
      }
      /* the site is live, only this address is wrong (a mistyped or an old page name): say so, and the way home */
      if (!chosen.found) return sendNoSuchPage(req, res, eventId, data);
      sendLivePage(cachePage(slugKey, chosen.html));
    }
    /* a page kept out of search says so in its header too (X-Robots-Tag), as its robots meta does */
    function sendLivePage(entry) {
      if (entry.noindex) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      sendHtml(req, res, 200, entry.html, LIVE_PAGE_CACHE_CONTROL, entry.packed);
    }
    var hitPage = slugKey ? cachedPage(slugKey) : null;
    if (hitPage) return sendLivePage(hitPage);
    var hit = cachedPage(key);
    if (hit) return send(hit);
    return readObject(fb, publishedObjectPath(eventId)).then(function (html) {
      if (html == null) return sendNotAvailable(req, res);
      /* A page with no publishedVersion was published by the previous version of this file: the editor's
         serialize() output, stored as it came, linking its CSS and scripts by the absolute address of
         whichever host the editor ran on and carrying no runtime. It goes through the same transform
         here, on its way out, so that it too is root-relative and can take registrations. */
      /* what the page's share card needs (share-card.js), read by the page pass below: a live page whose card is
         missing, or was made for what the page showed before, has it made in the background, keeps the picture it
         had meanwhile, and is dropped from this instance's cache once the card is stored, so the next visitor (or
         crawler) gets it — a site live before cards existed gets one without being published again */
      var report = {};
      function afterSend() { shareCard.afterServe(fb, eventId, data, report.shareCard, function () { forgetCachedPage(eventId); }); }
      if (!data.publishedVersion) {
        return Promise.all([html, publicFormsFor(fb, eventId, data)]).then(withPictures(fb)).then(function (got) {
          var formsPayload = got[1];
          html = publishTransform(html, {
            eventId: eventId, event: data, mode: 'live', templateId: data.templateId, forms: formsPayload, pictures: got[2],
            publicBase: publicBase.publicSiteBase(), report: report
          });
          return withHeroVideo(fb, html, data).then(function (page) {
            send(cachePage(key, withVisitCounter(page, eventId)));
            afterSend();
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
        page = siteA11y.pagePass(page, { mode: 'live', event: data, templateId: (data.site && data.site.templateId) || data.templateId, report: report }, TOKEN_KIT);
        /* and the buttons put right, an import's dead parts taken out, a test kept out of search (liveRepair) —
           so a page published before these needs no new publish */
        page = liveRepair(page, data, eventId, 'live', null);
        return withHeroVideo(fb, page, data);
      }).then(function (page) {
        /* and the visit counter, on the live page only (withVisitCounter, TPL-039) */
        send(cachePage(key, withVisitCounter(page, eventId)));
        afterSend();
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
   (tools/serve.js with REVAMP_AUTH_DISABLED=1, the QA harness), and an unreleased site must not depend on
   which door it is asked for at. ?staged=1 shows the staged copy (events/<id>/staging/index.html: the page as
   last saved, recordSave) — the console's "See the staged copy". */
/* The preview's theme switcher (only for an AI-designed site): the themes as buttons; picking one restyles the
   page in place (templates/_shared/rv-theme.js — the colours a section wrote as fixed values are turned into
   the variables first, the ET logo takes the version for its new ground), and "Apply in editor" opens the
   editor in it, to save and publish. Nothing here is part of a published page. */
function themeSwitcherHtml(event, eventId, templateId) {
  var plan = event && event.designPlan;
  /* an AI-designed site: its template id says so, or (a site not saved yet) its own design and sections do */
  if (!templateId && plan && generatedSite.has(event)) templateId = 'gen-' + eventId;
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
   -> Promise<{ html | null, from: 'draft' | 'saved' | 'staging' }> — from says which, for the ribbon's words */
function ownDraftOrSaved(fb, eventId, user) {
  function updated(path) {
    return fb.bucket.file(path).getMetadata().then(function (r) { return Date.parse(r[0] && r[0].updated) || 0; }, function (err) {
      if (err && (err.code === 404 || err.code === '404')) return -1;
      throw err;
    });
  }
  var draft = draftObjectPath(eventId, user), saved = sitePath(eventId, 'page.html'), staging = stagingObjectPath(eventId);
  function from(path, kind) { return readObject(fb, path).then(function (html) { return { html: html, from: kind }; }); }
  return Promise.all([updated(draft), updated(saved)]).then(function (t) {
    if (t[0] >= 0 && t[0] >= t[1]) return from(draft, 'draft');
    if (t[1] >= 0) return from(saved, 'saved');
    return from(staging, 'staging');
  });
}

/* The team preview's ribbon, in words that are true of the page it shows (UX-110: a live, unchanged site said
   "not published", and so did the version an approver had just put live). wantVersion: ?version=N; from: which
   page ?draft=1 found (ownDraftOrSaved), '' for the saved site; data: the event. */
function previewRibbon(data, wantVersion, from) {
  var live = data.published === true ? (+data.publishedVersion || 0) : 0;
  if (wantVersion) return 'Version ' + wantVersion + (live === wantVersion ? ' — this version is live' : live ? ' — not the live version' : ' — not published');
  if (!live) return 'Preview — not published';
  /* the person's own unsaved preview may differ from anything saved: never called the live site */
  if (from !== 'draft' && live === siteVersionOf(data)) return 'Preview — same as the live site';
  return 'Preview — changes not live yet';
}

/* "Nothing to preview yet" with the way on: the site editor, where the site is made and saved (UX-065: the page
   had no button, and many real drafts land on it) */
function nothingToPreviewPage(data, eventId) {
  var tpl = (data && data.site && data.site.templateId) || (data && data.templateId) || '';
  var href = '/custom_editor.html?event=' + encodeURIComponent(eventId) + (tpl ? '&template=' + encodeURIComponent(tpl) : '');
  return messagePage('Nothing to preview yet', 'This event’s site has not been saved yet. Design it in the site editor and save it, then preview it.',
    { href: href, label: 'Open the site editor' });
}

function handlePreviewPage(req, res, eventId, slug) {
  /* a site that is not released, shown to the signed-in team: in a frame of the app's own pages only (the review
     page's panes), never in another site's — as server.js sends the app's pages (BE-057). Not the published site's
     rule (/e/), which the owner has not set. */
  if (typeof res.setHeader === 'function' && !res.headersSent) {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
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
      /* someone who works in chosen portals previews only their portals' events (lib/access-control.js) */
      if (user.access && !accessControl.eventOk(user.access, data)) {
        return sendHtml(req, res, 403, messagePage('This event is not in your portals', accessControl.outsideSentence(user.access, data.portal)), 'no-store');
      }
      if (!staged && !ownDraft && !siteVersionOf(data)) {
        return sendHtml(req, res, 404, nothingToPreviewPage(data, eventId), 'no-store');
      }
      function page(t, kind) { return { html: t, from: kind || '' }; }
      var source = ownDraft ? ownDraftOrSaved(fb, eventId, user) : wantVersion
        ? readObject(fb, versionPath(eventId, wantVersion)).then(function (t) { return t == null && wantVersion === siteVersionOf(data) ? readObject(fb, sitePath(eventId, 'page.html')) : t; }).then(page)
        : readObject(fb, staged ? stagingObjectPath(eventId) : sitePath(eventId, 'page.html')).then(function (t) { return page(t, staged ? 'staging' : 'saved'); });
      var formsRead = publicFormsFor(fb, eventId, data);         // alongside the page (never rejects)
      /* ?frame=1: the review page's panes (review.html), whose captions say what each one is */
      var framed = queryOf(req).get('frame') === '1';
      return source.then(function (got0) {
        var html = got0.html;
        if (html == null && wantVersion) {
          return sendHtml(req, res, 404, messagePage('That version is not stored', 'Version ' + wantVersion + ' of this site was saved before versions were kept, or does not exist.'), 'no-store');
        }
        if (html == null) {
          return sendHtml(req, res, 404, nothingToPreviewPage(data, eventId), 'no-store');
        }
        /* "Edit with AI" back into the editor and the theme switcher — not on a saved version opened for review
           (?version=N): it is shown as approving it would put it live (UX-109) */
        return Promise.all([formsRead, pictures.prepare(fb, html)]).then(function (got) {
          var formsPayload = got[0];
          return withHeroVideo(fb, publishTransform(html, {
            eventId: eventId, event: data, mode: 'preview', publicBase: '', editButton: !wantVersion, forms: formsPayload, pictures: got[1],
            templateId: (data.site && data.site.templateId) || data.templateId,
            noTools: !!wantVersion, noRibbon: framed, ribbonText: previewRibbon(data, wantVersion, got0.from)
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

/* lib/share-preview.js (shareable preview links: /s/<token> and the make / list / stop routes) is handed the
   helpers below on every call, like the Promotions modules. It has its own loader rather than inModule(): that
   one logs req.url, and an /s/ address is a working link to an unreleased site, so this one logs it without
   the token (shareToken.redactUrl). When the module cannot be loaded a shared link gets a plain HTML page, not
   inModule()'s JSON. */
/* Settings › URL & SEO (lib/api-seo.js): its routes get this file's helpers on every call, as share-preview.js does */
function seoHelpers() {
  return { withAdmin, withAdminBody, BODY_LIMITS, eventIdOr400, eventDocRef, loadLiveEvent, siteVersionOf, sitePath, readObject, queryOf,
    publishTransform, TOKEN_KIT, approvalsConfig, publicBaseFor, publicPathOf, portalNameOf, etJson, httpError, sendFailure, sendAiFailure, aiUsageRecorder };
}
/* speakers' photos found in a brochure's pages (lib/speaker-photos.js) */
/* speaker and sponsor pages (lib/people.js): the public pages and the console's Speakers and Sponsors */
function peopleModule() {
  var mod = null;
  try {
    mod = require('./people');
    mod.wire({ firebase: getFirebase, isEventId: isEventId, sendHtml: sendHtml, messagePage: messagePage, sendText: sendText, sendJson: sendJson,
      publicBaseFor: publicBaseFor, requireAdmin: requireAdmin, withAdminBody: withAdminBody, looksLikeTest: siteChecks.looksLikeTest });
  } catch (err) { mod = null; console.error('api: could not load lib/people.js — ' + (err && err.stack || err)); }
  return mod;
}
function peopleRoute(handlerName) {
  return function (req, res) {
    var mod = peopleModule();
    if (mod && typeof mod[handlerName] === 'function') return mod[handlerName](req, res);
    return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
  };
}
function peopleSoon(kind) {
  return function (fb) { var mod = peopleModule(); if (mod) mod.soon(fb, kind); };
}
function photosRoute(handlerName) {
  return function (req, res) {
    var mod = null;
    try { mod = require('./speaker-photos'); mod.wire({ withAdminBody: withAdminBody, eventIdOr400: eventIdOr400, loadLiveEvent: loadLiveEvent,
      aiUsageRecorder: aiUsageRecorder, sendAiFailure: sendAiFailure, sendFailure: sendFailure }); }
    catch (err) { mod = null; console.error('api: could not load lib/speaker-photos.js — ' + (err && err.stack || err)); }
    if (mod && typeof mod[handlerName] === 'function') return mod[handlerName](req, res);
    return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
  };
}
function seoRoute(handlerName) {
  return function (req, res) {
    var mod = null;
    try { mod = require('./api-seo'); mod.wire(seoHelpers()); }
    catch (err) { mod = null; console.error('api: could not load lib/api-seo.js for ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err)); }
    if (mod && typeof mod[handlerName] === 'function') return mod[handlerName](req, res);
    return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
  };
}
function shareHelpers() {
  return { withAdmin, withAdminBody, BODY_LIMITS, eventIdOr400, eventDocRef, eventStateOf, siteVersionOf, sitePath, readObject,
    publicFormsFor, preparePictures: function (fb, html) { return pictures.prepare(fb, html); }, publishTransform, withHeroVideo,
    selectSitePage, deliverPage, messagePage, acceptedEncoding, compressHtml, publicBaseFor, unansweredLogoNote, sendFailure };
}
/* an /s/ answer when lib/share-preview.js is not there to give it: the headers of every /s/ answer (no-store,
   noindex, Referrer-Policy: strict-origin — sendHtml's policy would hand the token to our own host as the Referer) */
function shareErrorPage(req, res, status) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* socket already gone */ } return; }
  var body = Buffer.from(messagePage('This preview is temporarily unavailable', 'Please try again in a few minutes.'), 'utf8');
  var headers = shareToken.shareHeaders();
  headers['Content-Type'] = 'text/html; charset=utf-8';
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
function shareRoute(handlerName) {
  return function (req, res) {
    var mod = null;
    try { mod = require('./share-preview'); mod.wire(shareHelpers()); }
    catch (err) {
      mod = null;
      console.error('api: could not load lib/share-preview.js for ' + req.method + ' ' + shareToken.redactUrl(req.url) + ' — ' + (err && err.stack || err));
    }
    if (mod && typeof mod[handlerName] === 'function') return mod[handlerName](req, res);
    if (mod) console.error('api: lib/share-preview.js has no ' + handlerName + '() for ' + req.method + ' ' + shareToken.redactUrl(req.url));
    if (/^\/s\//.test(String(req.url))) return shareErrorPage(req, res, 503);
    return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
  };
}

/* =====================================================================================================
   GET /robots.txt and GET /sitemap.xml — for search engines (site-seo.js). Public. The sitemap lists every
   published event's /e/<id> (and /e/<id>/<slug> for each of its internal pages, event.publishedPages) at the public address (publicBaseFor: PUBLIC_BASE_URL, else the hosted address), except one
   whose owner gave it a canonical address elsewhere (that address is the one to list, and it is not ours), and
   one kept out of search: its owner said so (settings.seo.noindex), it is a test ("test event 5"), or its live
   page is still the template itself ("Event name goes here") — the same reasons its page and header say
   noindex (site-checks.js noindexReason). The page is read for that once per publish (SEARCH_VERDICTS).
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
/* Whether each live page is still the template itself, read off its stored page once per publish (the key is
   the publish: version and time) and kept for the life of this instance. A page that cannot be read now is
   listed as before, and read again next time. -> Promise<{ eventId: true }> for the ones to leave out */
var SEARCH_VERDICTS = new Map(), SEARCH_VERDICTS_MAX = 2000, SEARCH_READS_AT_ONCE = 6;
function searchVerdicts(fb, docs) {
  var hidden = {}, todo = [];
  docs.forEach(function (d) {
    var e = d.data() || {}, key = d.id + '|' + (e.publishedVersion || 0) + '|' + (e.publishedAt || '');
    if (SEARCH_VERDICTS.has(key)) { if (SEARCH_VERDICTS.get(key)) hidden[d.id] = true; }
    else todo.push({ id: d.id, key: key });
  });
  function next() {
    var job = todo.shift();
    if (!job) return Promise.resolve();
    return readObject(fb, publishedObjectPath(job.id)).then(function (html) {
      var template = html != null && siteChecks.noindexReason({}, html, TOKEN_KIT) === 'template';
      if (SEARCH_VERDICTS.size >= SEARCH_VERDICTS_MAX) SEARCH_VERDICTS.clear();
      SEARCH_VERDICTS.set(job.key, template);
      if (template) hidden[job.id] = true;
    }, function (err) {
      console.error('api: /sitemap.xml could not read the page of ' + job.id + ' — ' + (err && err.message));
    }).then(next);
  }
  var lanes = [];
  for (var n = 0; n < SEARCH_READS_AT_ONCE; n++) lanes.push(next());
  return Promise.all(lanes).then(function () { return hidden; });
}
function handleRobotsTxt(req, res) {
  sendText(req, res, 200, 'text/plain; charset=utf-8', siteSeo.robotsTxt(publicBaseFor(req, '')), 'public, max-age=3600');
}

/* GET /api/public/calendar?eventId=<id> — the event as a calendar file (site-seo.js calendarIcs): the
   registration form's "Add to calendar" (rv-forms.js). Public, as the site is: only a live, published event with
   an exact date has one; anything else is a plain 404. A phone opens the file in its calendar app; a computer
   downloads it, to open in Outlook, Apple Calendar or Google Calendar. */
function calendarHeaders(eventId, body) {
  return { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + eventId + '.ics"',
    'Cache-Control': 'public, max-age=300', 'Content-Length': Buffer.byteLength(body, 'utf8'), 'X-Content-Type-Options': 'nosniff' };
}
function handlePublicCalendar(req, res) {
  var eventId = queryOf(req).get('eventId') || '';
  var plain = 'text/plain; charset=utf-8';
  if (!isEventId(eventId)) return sendText(req, res, 404, plain, 'There is no event at this address.\n', 'no-store');
  var fb = getFirebase();
  if (fb.error) return sendText(req, res, 503, plain, 'The calendar file is not available right now. Please try again in a few minutes.\n', 'no-store');
  liveEventSnap(fb, eventId).then(function (snap) {
    if (eventStateOf(snap) !== 'live' || snap.data().published !== true) return sendText(req, res, 404, plain, 'There is no event at this address.\n', 'no-store');
    var data = snap.data(), seo = seoFields.seoFor(data, 'live');
    var ics = siteSeo.calendarIcs(data, { id: eventId, url: cleanCanonical(seo.canonicalUrl) || publicBaseFor(req, '') + publicPathOf(eventId) });
    if (!ics) return sendText(req, res, 404, plain, 'This event has no date yet.\n', 'no-store');
    res.writeHead(200, calendarHeaders(eventId, ics));
    res.end(req.method === 'HEAD' ? undefined : ics);
  }).catch(function (err) {
    console.error('api: /api/public/calendar for ' + eventId + ' failed — ' + (err && err.stack || err));
    sendText(req, res, 502, plain, 'The calendar file is not available right now. Please try again in a few minutes.\n', 'no-store');
  });
}
function handleSitemapXml(req, res) {
  var base = publicBaseFor(req, '');
  if (sitemapCache && sitemapCache.base === base && Date.now() - sitemapCache.at < SITEMAP_TTL_MS) {
    return sendText(req, res, 200, 'application/xml; charset=utf-8', sitemapCache.xml, 'public, max-age=600');
  }
  var fb = getFirebase();
  if (fb.error) return sendText(req, res, 503, 'text/plain; charset=utf-8', 'The sitemap is temporarily unavailable.\n', 'no-store');
  fb.db.collection('events').where('published', '==', true).select('createdAt', 'deletedAt', 'publishedAt', 'publishedVersion', 'settings', 'publishedSeo', 'publishedPages', 'name').get().then(function (snap) {
    var listed = snap.docs.filter(function (d) {
      var e = d.data() || {};
      if (eventStateOf(d) !== 'live' || !isEventId(d.id)) return false;
      /* the QA harness's short-lived test copies (always "qa-…", deleted after each run) are no site to list */
      if (/^qa-/.test(d.id)) return false;
      /* a site whose live page names another address as its own (the published copy of URL & SEO) is listed there */
      if (cleanCanonical(seoFields.seoFor(e, 'live').canonicalUrl)) return false;
      /* kept out of search by its owner, or a test */
      return !siteChecks.noindexReason(Object.assign({ id: d.id }, e), null, TOKEN_KIT);
    });
    return searchVerdicts(fb, listed).then(function (hidden) { return { listed: listed, hidden: hidden }; });
  }).then(function (got) {
    var entries = [];
    got.listed.forEach(function (d) {
      var e = d.data() || {};
      /* a live page that is still the template itself */
      if (got.hidden[d.id]) return;
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
   Function) calls, for every path under /api/, /e/, /preview/ and /t/. A synchronous throw anywhere in routing
   or in a handler's own first lines becomes a 500 for THAT request instead of an uncaught exception for
   the whole process. Throws inside later stream/promise callbacks are each handler's own to deal with
   (withAdmin / withAdminBody / sendFailure above); server.js adds a process-level net under all of it. */
function handleApi(req, res) {
  try { return routeApi(req, res); }
  catch (err) {
    console.error('api: unhandled error on ' + req.method + ' ' + shareToken.redactUrl(req.url) + ' — ' + (err && err.stack || err));
    if (res.headersSent) { try { res.end(); } catch (e) { /* socket already gone */ } return; }
    if (/^\/s\//.test(String(req.url))) return shareErrorPage(req, res, 500);
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

/* lib/event-portal.js (the evidence report on which ET portal each existing event is on, and the approver's
   backfill of the ones ticked) and lib/working-portal.js (the portal a person works on, kept for that person)
   take a few of this file's helpers the way lib/promo.js does: handed to them (wire()) on each call, so
   neither requires this file. A module that is missing or fails to load costs only its own routes the 503
   inModule() answers. */
function portalHelpers() {
  return { withAdmin, withAdminBody, eventDocRef, eventStateOf, approvalsConfig, actorOf, logActivity, sendJson, sendFailure,
    httpError, BODY_LIMITS, isEventId };
}
function portalModuleRoute(moduleName, handler) {
  var run = inModule(moduleName, handler);
  return function (req, res) {
    try { require('./' + moduleName).wire(portalHelpers()); } catch (e) { /* inModule() logs it and answers 503 */ }
    return run(req, res);
  };
}
var eventPortal = function (handler) { return portalModuleRoute('event-portal', handler); };
var workingPortal = function (handler) { return portalModuleRoute('working-portal', handler); };
/* lib/create-drafts.js (Create Event's unfinished drafts, kept with the person's account: UX-048) takes the same few helpers */
var createDrafts = function (handler) { return portalModuleRoute('create-drafts', handler); };

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

/* lib/promo-ai.js (ETB2B AI in the post and mailer editors, batch B18-ai) takes the Promotions helpers and the chat's
   own: the person's rate bucket and conversation (one per person per event, as the site editor's and the events
   side's), their live events (the lock to the event), the History, and the ET logo rule every AI prompt carries.
   lib/promo.js is wired too: it reads the event's facts (buildKit). */
function promoAiHelpers() {
  return Object.assign(promoHelpers(), { sendJson, chatRateOk, chatUid, chatName, chatUserRef, liveEventDocs, logActivity, eventDocRef,
    isEventId, ET_LOGO_COLOUR_RULE: ET_LOGO_COLOUR_RULE + '\n' + NAME_RULE });
}
var promoAi = function (handler) {
  var run = inModule('promo-ai', handler);
  return function (req, res) {
    try { require('./promo').wire(promoHelpers()); require('./promo-ai').wire(promoAiHelpers()); } catch (e) { /* inModule() logs it and answers 503 */ }
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

/* lib/promo-track.js (a mailer's open and click counts, and the "Mailer performance" dashboard) takes the
   same helpers */
var promoTrack = function (handler) {
  var run = inModule('promo-track', handler);
  return function (req, res) {
    try { require('./promo-track').wire(promoHelpers()); } catch (e) { /* inModule() logs it and answers 503 */ }
    return run(req, res);
  };
};

/* lib/promo-social.js (Promotions → Social posts: the platform's post templates, their art, saved layouts and
   uploaded pictures), lib/promo-previews.js (the live previews on the Mailers cards) and lib/promo-banner.js
   (the mailers' composed top banner) take the same helpers. Each reads the event through lib/promo.js
   (buildKit) or lib/promo-mailer.js (eventFor), and those two are otherwise handed their helpers only by
   their own routes above. On a fresh instance whose first Promotions request is one of these, they would
   still be unwired and the request would fail with a 500, so these routes hand the helpers to them too. */
function promoRoute(moduleName, handler) {
  var run = inModule(moduleName, handler);
  return function (req, res) {
    var helpers = promoHelpers();
    ['promo', 'promo-mailer', moduleName].forEach(function (name) {
      try { require('./' + name).wire(helpers); } catch (e) { /* left to inModule() below: it logs a route module that cannot be loaded and answers 503 */ }
    });
    return run(req, res);
  };
}
var promoSocial = function (handler) { return promoRoute('promo-social', handler); };
var promoPreviews = function (handler) { return promoRoute('promo-previews', handler); };
var promoBanner = function (handler) { return promoRoute('promo-banner', handler); };

/* lib/dash-bot.js (ETB2B AI on the events dashboard) is handed this file's helpers the same way, on each call: no
   require cycle, and a module that fails to load costs only its own three routes inModule()'s 503. It reads its
   events through liveEventDocs(), so the bot sees exactly the list the person sees, and it shares the editor
   chat's rate bucket (chatRateOk), so the two chats together cannot outrun one person's limit. */
/* Since the assistant is on every page (5 Nov 2026), a question asked inside an event is kept in that event's own
   conversation, the very document the editor's chat keeps for the person (chatUserRef), and is a line in the
   event's History (logActivity), so it is handed both, and the event's document (eventDocRef). */
function dashBotHelpers() {
  return { withAdmin, withAdminBody, sendJson, sendFailure, sendAiFailure, httpError, BODY_LIMITS, chatRateOk, chatUid, chatName,
    approvalsConfig, liveEventDocs, eventListItem, isEventId, chatUserRef, logActivity, eventDocRef };
}
function dashBot(handler) {
  var run = inModule('dash-bot', handler);
  return function (req, res) {
    var mod;
    try { mod = require('./dash-bot'); }
    catch (e) { return run(req, res); /* inModule() logs a module that cannot be loaded and answers 503 */ }
    /* unlike the Promotions modules, a bot that loads but cannot take its helpers is not run without them (its
       handlers would have no sign-in check to call and fail with a 500): it is answered as a missing module */
    try { mod.wire(dashBotHelpers()); }
    catch (err) {
      console.error('api: lib/dash-bot.js could not be wired for ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err));
      return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
    }
    return run(req, res);
  };
}

/* lib/ai-hero.js (the first hero picture of an event started from the dashboard's ETB2B AI) is handed this file's
   helpers the same way: its sign-in check, its answers, the editor chat's per-person key (chatUid, which the bot's
   daily allowance is kept under) and the event's AI usage recorder. A module that fails to load costs only its
   own route the 503 inModule() answers, and a wiring with parts missing is answered the same way. */
function aiHeroHelpers() {
  return { withAdminBody, sendJson, sendFailure, sendAiFailure, BODY_LIMITS, chatUid, isEventId, aiUsageRecorder };
}
function aiHeroRoute(handler) {
  var run = inModule('ai-hero', handler);
  return function (req, res) {
    var mod;
    try { mod = require('./ai-hero'); }
    catch (e) { return run(req, res); /* inModule() logs a module that cannot be loaded and answers 503 */ }
    try { mod.wire(aiHeroHelpers()); }
    catch (err) {
      console.error('api: lib/ai-hero.js could not be wired for ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err));
      return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
    }
    return run(req, res);
  };
}

/* lib/phone-banner.js (the banner's own picture for phones, made by ETB2B AI from the banner the site has now) is
   handed this file's helpers the same way as lib/ai-hero.js, with the History line's writer and the ET logos' rule,
   which every picture prompt that may meet one of those logos carries. */
function phoneBannerHelpers() {
  return { withAdminBody, sendJson, sendFailure, sendAiFailure, BODY_LIMITS, chatUid, isEventId, aiUsageRecorder, logActivity, ET_LOGO_COLOUR_RULE };
}
function phoneBannerRoute(handler) {
  var run = inModule('phone-banner', handler);
  return function (req, res) {
    var mod;
    try { mod = require('./phone-banner'); }
    catch (e) { return run(req, res); /* inModule() logs a module that cannot be loaded and answers 503 */ }
    try { mod.wire(phoneBannerHelpers()); }
    catch (err) {
      console.error('api: lib/phone-banner.js could not be wired for ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err));
      return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
    }
    return run(req, res);
  };
}

/* lib/ai-learn.js (the approvers' report "What people ask ETB2B AI", marking its QA notes resolved, and the page
   errors the assistant's pages send) is handed this file's helpers on each call, like the modules above; a module
   that fails to load costs only its own routes inModule()'s 503. */
function aiLearnRoute(handler) {
  var run = inModule('ai-learn', handler);
  return function (req, res) {
    try { require('./ai-learn').wire({ withAdmin, withAdminBody, sendJson, sendFailure, approvalsConfig, BODY_LIMITS }); } catch (e) { /* inModule() logs it and answers 503 */ }
    return run(req, res);
  };
}

/* lib/ai-habits.js (the panel's suggestions from the record, and each person's shortcuts) is handed this file's
   helpers on each call, as lib/ai-learn.js is; a module that fails to load costs only its own routes the 503. */
function aiHabitsRoute(handler) {
  var run = inModule('ai-habits', handler);
  return function (req, res) {
    try { require('./ai-habits').wire({ withAdmin, withAdminBody, sendJson, sendFailure, BODY_LIMITS, chatName }); } catch (e) { /* inModule() logs it and answers 503 */ }
    return run(req, res);
  };
}

/* lib/api-generate.js (the AI site-generation pipeline and the AI steps around it), lib/api-chat.js (ETB2B AI, the
   editor's chat) and lib/api-import.js (the Lovable import), moved out of this file as they were (BE-017), are handed
   this file's helpers the same way as lib/dash-bot.js and lib/ai-hero.js: on each call, so none of them requires this
   file (a require cycle). Each is handed only what the routes that stay here use too; everything else they use is
   their own. A module that fails to load costs only its own routes inModule()'s 503, and a wiring with parts missing
   is answered the same way (its handlers would have no sign-in check or answer to call). */
function generateHelpers() {
  return {
    AI_OUTPUT_TOKENS, AWARD_TAB_LABELS, BODY_LIMITS, DESIGN_COLOR_FIELDS, DESIGN_ENUM_FIELDS, DESIGN_FIELDS,
    DESIGN_FONT_FIELDS, DESIGN_NUMERIC_FIELDS, DESIGN_WEIGHT_FIELDS, ET_LOGO_COLOUR_RULE, EVENT_FIELD_CHECKS,
    LOGO_UNIT_MAX_BYTES, NAME_RULE, RESPONSE_SCHEMA_BASE, TOKEN_KIT, aiUsageRecorder, briefYearTexts, darkCopyNote,
    etJson, eventDocRef, eventFacts, eventStateOf, examineUnit, extractStylesheetLinks, fetchUnitFont, fieldDelete,
    footerEvents, googleFontUrl, headingText, headingWords, heroModeOf, httpError, isPlainObject, loadLiveEvent,
    notLiveError, ownerLogoUnit, portalNameOf, queryOf, safeGeneratedSection, sanitizeDesignField, scrapeLovableUrl,
    sendAiFailure, sendFailure, sendStepFailure, siteFooter, sitePortalOf, sizedSvg, storagePathOf, storeLogoUnit,
    storeOnDarkUnit, storePublicPicture, stripAllScriptTags, svgCouldRun, tidyGeneratedSectionCss,
    tidyGeneratedSectionHtml
  };
}
function aiChatHelpers() {
  return {
    AI_OUTPUT_TOKENS, BODY_LIMITS, DESIGN_ENUM_FIELDS, DESIGN_FIELDS, DESIGN_NUMERIC_FIELDS, ET_LOGO_COLOUR_RULE,
    NAME_RULE, aiUsageRecorder, approvalsConfig, chatName, chatRateOk, chatUid, chatUserRef, eventDocRef, httpError,
    queryOf, sanitizeDesignField, sendAiFailure, sendFailure, sendStepFailure, withAdmin, withAdminBody
  };
}
function importHelpers() {
  return { BODY_LIMITS, TOKEN_KIT, extractStylesheetLinks, has, scrapeLovableUrl, sendFailure, stripAllScriptTags };
}
function wiredRoute(moduleName, helpersOf, handler) {
  var run = inModule(moduleName, handler);
  return function (req, res) {
    var mod;
    try { mod = require('./' + moduleName); }
    catch (e) { return run(req, res); /* inModule() logs a module that cannot be loaded and answers 503 */ }
    try { mod.wire(helpersOf()); }
    catch (err) {
      console.error('api: lib/' + moduleName + '.js could not be wired for ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err));
      return sendJson(res, 503, { error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' });
    }
    return run(req, res);
  };
}
var generate = function (handler) { return wiredRoute('api-generate', generateHelpers, handler); };
var aiChat = function (handler) { return wiredRoute('api-chat', aiChatHelpers, handler); };
var lovableImport = function (handler) { return wiredRoute('api-import', importHelpers, handler); };

/* the same 42 bytes as lib/promo-track.js PIXEL (a test checks): a mail must never show a broken image, even
   when that module is missing from a deployment */
var TRACK_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
var trackLoadLoggedAt = 0;
/* /t/o/<id>.gif and /t/c/<id> go to lib/promo-track.js, loaded on each hit like every other route module.
   They are what a recipient's mail asks for, so when that module cannot be loaded the answer is not
   inModule()'s JSON 503: the pixel is still a picture (nothing is counted) and a link says in plain words
   that it is not available just now. That failure is logged at most once a minute: one sent mail can be
   opened many times a second. */
function trackHit(kind, req, res) {
  var mod = null;
  try { mod = require('./promo-track'); mod.wire(promoHelpers()); }
  catch (err) {
    mod = null;
    if (Date.now() - trackLoadLoggedAt > 60000) { trackLoadLoggedAt = Date.now(); console.error('api: could not load lib/promo-track.js for ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err)); }
  }
  if (mod && kind === 'o' && typeof mod.handleOpen === 'function') return mod.handleOpen(req, res);
  if (mod && kind === 'c' && typeof mod.handleClick === 'function') return mod.handleClick(req, res);
  if (kind === 'o') {
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': TRACK_PIXEL.length, 'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options': 'nosniff' });
    return res.end(req.method === 'HEAD' ? undefined : TRACK_PIXEL);
  }
  res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Retry-After': '60' });
  return res.end('This link is not available right now. Please try again in a few minutes.');
}

/* "METHOD path" -> handler, for every route with a fixed path. */
/* BE-018. The AI and site-generation steps, the generated draft, and the AI-designed and imported sites' markup:
   their handlers do not check who is calling, and the hosting sign-in gate only knows "signed in and not blocked".
   So routeApi checks the caller for them, as requireAdmin does for the rest — the access list, the role (a Viewer
   may read them, only an Editor or above may start a step: they spend on the model and write the event) and, for
   someone who works in chosen portals, an event of one of those (eventId, sourceEventId). The Bearer header or
   the sign-in cookie: Create Event calls the steps with the cookie alone. */
var CALLER_CHECKED = {
  'POST /api/suggest-design': 1, 'POST /api/extract-brief': 1, 'POST /api/ingest-source': 1, 'POST /api/plan-structure': 1,
  'POST /api/generate-content': 1, 'POST /api/redesign-section': 1,
  'GET /api/draft': 1, 'GET /api/generated-template': 1, 'GET /api/generated-section': 1,
  'GET /api/imported-template': 1, 'GET /api/imported-section': 1,
  /* where a run of "Generate my site" is, and stopping it (BE-033): Create Event calls them with the cookie too */
  'GET /api/generate/status': 1, 'POST /api/generate/cancel': 1
};
var ROUTES = {
  'POST /api/suggest-design': generate('handleSuggestDesign'),
  'POST /api/chat-edit': aiChat('handleChatEdit'),
  'POST /api/chat/turn': aiChat('handleChatTurn'),
  'GET /api/chat/history': aiChat('handleChatHistory'),
  'POST /api/dash-bot': dashBot('handleChat'),                // ETB2B AI on the events dashboard (lib/dash-bot.js)
  'POST /api/dash-bot/turn': dashBot('handleTurn'),
  'GET /api/dash-bot/history': dashBot('handleHistory'),
  'GET /api/ai-report': aiLearnRoute('handleReport'),         // what people ask ETB2B AI, for the approvers (lib/ai-learn.js)
  'POST /api/ai-report/resolve': aiLearnRoute('handleResolve'),
  'POST /api/ai-qa/note': aiLearnRoute('handleNote'),
  'GET /api/ai-habits': aiHabitsRoute('handleHabits'),        // the panel's one-click suggestions and shortcuts (lib/ai-habits.js)
  'POST /api/ai-habits/shortcuts': aiHabitsRoute('handleShortcuts'),
  'POST /api/extract-brief': generate('handleExtractBrief'),
  'POST /api/ingest-source': generate('handleIngestSource'),
  'GET /api/et/portals': handleEtPortals,
  'GET /api/et/events': handleEtEvents,
  'POST /api/plan-structure': generate('handlePlanStructure'),
  'POST /api/generate-content': generate('handleGenerateContent'),
  'GET /api/generate/status': generate('handleGenerateStatus'),
  'POST /api/generate/cancel': generate('handleGenerateCancel'),
  'POST /api/redesign-section': generate('handleRedesignSection'),
  'GET /api/draft': generate('handleGetDraft'),
  'GET /api/generated-template': generate('handleGeneratedTemplate'),
  'GET /api/generated-section': generate('handleGeneratedSection'),
  'POST /api/import-lovable': lovableImport('handleImportLovable'),
  'GET /api/imported-template': lovableImport('handleImportedTemplate'),
  'GET /api/imported-section': lovableImport('handleImportedSection'),
  /* the imports nobody took, listed (and, for an admin who asks, cleared away): lib/import-sweep.js */
  'POST /api/imports/sweep': inModule('import-sweep', 'handleSweep'),

  'POST /api/event': handleEventCreate,
  'GET /api/event': handleEventGet,
  'PATCH /api/event': handleEventUpdate,
  'DELETE /api/event': events('handleEventDelete'),
  'GET /api/events': handleEventsList,
  'GET /api/events/portal-evidence': eventPortal('handleEvidence'),
  'POST /api/events/portal-backfill': eventPortal('handleBackfill'),
  'GET /api/me/working-portal': workingPortal('handleGet'),
  'PUT /api/me/working-portal': workingPortal('handlePut'),
  /* Create Event's drafts, each person's own (lib/create-drafts.js): listed on the dashboard, resumed on any computer */
  'GET /api/me/create-drafts': createDrafts('handleList'),
  'GET /api/me/create-draft': createDrafts('handleGet'),
  'PUT /api/me/create-draft': createDrafts('handlePut'),
  'DELETE /api/me/create-draft': createDrafts('handleDelete'),
  'POST /api/me/create-draft/file': createDrafts('handleFilePut'),
  'GET /api/me/create-draft/file': createDrafts('handleFileGet'),
  'GET /api/event/slug-available': events('handleSlugAvailable'),
  'POST /api/event/restore': events('handleEventRestore'),
  'POST /api/event/clone': events('handleEventClone'),
  'POST /api/event/upload': events('handleUpload'),
  'GET /api/event/hero-video': heroVideo('handleHeroVideoGet'),
  'PUT /api/event/hero-video': heroVideo('handleHeroVideoSave'),
  'POST /api/event/ai-hero': aiHeroRoute('handleHero'),       // ETB2B AI's first hero picture for an event it started (lib/ai-hero.js)
  'POST /api/event/phone-banner': phoneBannerRoute('handle'),   // the banner's own picture for phones, by ETB2B AI (lib/phone-banner.js)
  'DELETE /api/event/hero-video': heroVideo('handleHeroVideoRemove'),
  'POST /api/event/hero-video/upload': heroVideo('handleHeroVideoUpload'),
  'POST /api/event/hero-video/check': heroVideo('handleHeroVideoCheck'),

  'GET /api/event/site': handleSiteGet,
  'GET /api/event/site-check': handleSiteCheck,
  'GET /api/event/site-outline': handleSiteOutline,
  'POST /api/event/site/repair': handleSiteRepair,
  'PUT /api/event/site': handleSitePut,
  'POST /api/event/site/records': handleSiteRecords,
  'POST /api/event/publish': handleEventPublish,
  'POST /api/event/approval/request': handleApprovalRequest,
  'POST /api/event/theme': handleEventTheme,
  'POST /api/event/section-edges': handleEventSectionEdges,
  'POST /api/event/logo-unit': handleEventLogoUnit,
  'POST /api/event/logo-unit-dark': handleEventLogoUnitDark,
  'POST /api/event/approval/decide': handleApprovalDecide,
  /* Settings › URL & SEO (lib/api-seo.js): the section, ETB2B AI's SEO text and FAQs, the previous edition's */
  'GET /api/event/seo': seoRoute('handleSeoGet'),
  'POST /api/event/seo/write': seoRoute('handleSeoWrite'),
  'POST /api/event/speaker-photos/find': photosRoute('handleFind'),
  'GET /api/people/speakers': peopleRoute('handleList'),        // the console's Speakers and Sponsors (lib/people.js)
  'GET /api/people/sponsors': peopleRoute('handleList'),
  'GET /api/people/speakers/one': peopleRoute('handleOne'),
  'GET /api/people/sponsors/one': peopleRoute('handleOne'),
  'PUT /api/people/speakers/one': peopleRoute('handleOne'),
  'PUT /api/people/sponsors/one': peopleRoute('handleOne'),
  'POST /api/people/speakers/merge': peopleRoute('handleMerge'),
  'POST /api/people/sponsors/merge': peopleRoute('handleMerge'),
  'POST /api/people/speakers/split': peopleRoute('handleSplit'),
  'POST /api/people/sponsors/split': peopleRoute('handleSplit'),
  'POST /api/people/speakers/undo': peopleRoute('handleUndo'),
  'POST /api/people/sponsors/undo': peopleRoute('handleUndo'),
  'POST /api/people/speakers/about': peopleRoute('handleAbout'),
  'POST /api/people/sponsors/about': peopleRoute('handleAbout'),
  'POST /api/people/speakers/wiki': peopleRoute('handleWiki'),
  'POST /api/people/sponsors/wiki': peopleRoute('handleWiki'),
  'GET /api/event/seo/previous': seoRoute('handleSeoPrevious'),
  'GET /api/event/approval': handleApprovalGet,
  'GET /api/event/history': handleEventHistory,
  /* the speaker and sponsor library: ET's records kept here, and EventSphere's own, searched by name (lib/et-library.js) */
  'GET /api/library/speakers': inModule('et-library', 'handleSpeakers'),
  'GET /api/library/sponsors': inModule('et-library', 'handleSponsors'),
  'POST /api/library/build': inModule('et-library', 'handleBuild'),
  /* Settings › Access: who may use EventSphere, as what, and in which portals (lib/api-access.js) */
  'GET /api/access/me': inModule('api-access', 'handleMe'),
  'GET /api/access': inModule('api-access', 'handleGet'),
  'POST /api/access/member': inModule('api-access', 'handleMember'),
  'POST /api/access/remove': inModule('api-access', 'handleRemove'),
  'POST /api/access/default': inModule('api-access', 'handleDefault'),
  'GET /api/settings/approvals': handleApprovalSettingsGet,
  'PUT /api/settings/approvals': handleApprovalSettingsPut,
  'POST /api/event/unpublish': handleEventUnpublish,
  'POST /api/event/restore-version': handleRestoreVersion,
  'POST /api/event/stage': handleEventStage,
  'POST /api/event/live-view': handleEventLiveView,
  /* shareable preview links (lib/share-preview.js): make, list, stop */
  'POST /api/event/share-preview': shareRoute('handleCreate'),
  'GET /api/event/share-preview': shareRoute('handleList'),
  'POST /api/event/share-preview/stop': shareRoute('handleStop'),

  'POST /api/event/seed': audience('handleSeed'),
  'GET /api/event/registrations': audience('handleRegistrationsList'),
  'PATCH /api/event/registrations': audience('handleRegistrationUpdate'),
  'POST /api/event/registrations/status': audience('handleRegistrationsStatus'),   // Reporting's bulk Set status (REG-019)
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
  'GET /api/promo/details': promo('handleDetails'),
  'GET /api/promo/image': promo('handleImage'),
  'POST /api/promo/write': promo('handleWrite'),
  'POST /api/promo/ai-edit': promoAi('handleEdit'),          // ETB2B AI in the post and mailer editors (lib/promo-ai.js)
  'POST /api/promo/ai-edit/turn': promoAi('handleTurn'),
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
  'POST /api/promo/mailer/picture': promoMailer('handlePicture'),
  'GET /api/promo/social/catalog': promoSocial('handleCatalog'),
  'GET /api/promo/social/art': promoSocial('handleArt'),
  'POST /api/promo/social/art': promoSocial('handleArtUpload'),
  'POST /api/promo/social/art/psd': promoSocial('handleArtPsd'),
  'DELETE /api/promo/social/art': promoSocial('handleArtDelete'),
  'POST /api/promo/social/art/default': promoSocial('handleArtDefault'),
  'POST /api/promo/social/html': promoSocial('handleHtml'),
  'GET /api/promo/social/layout': promoSocial('handleLayout'),
  'GET /api/promo/social/layouts': promoSocial('handleLayouts'),
  'POST /api/promo/social/layout/base': promoSocial('handleLayoutBase'),
  'POST /api/promo/social/layout': promoSocial('handleLayoutSave'),
  'POST /api/promo/social/layout/reset': promoSocial('handleLayoutReset'),
  'POST /api/promo/social/picture': promoSocial('handlePicture'),
  'POST /api/promo/mailer/previews': promoPreviews('handlePreviews'),
  'GET /api/promo/mailer/banner': promoBanner('handleBanner'),
  'POST /api/promo/mailer/banner': promoBanner('handleBannerUpload'),
  'GET /api/promo/analytics': promoTrack('handleAnalytics'),
  'GET /api/promo/analytics/all': promoTrack('handleAnalyticsAll'),

  'POST /api/event/leads/bulk': handleLeadsBulkCreate,
  'PATCH /api/event/leads/bulk': handleLeadsBulkUpdate,
  'DELETE /api/event/leads/bulk': handleLeadsBulkDelete,

  'GET /api/public/site-data': audience('handlePublicSiteData'),
  'GET /api/public/calendar': handlePublicCalendar,
  'HEAD /api/public/calendar': handlePublicCalendar,
  'POST /api/register': audience('handleRegister'),
  'POST /api/track': audience('handleTrack')
};

/* The routes a published page calls from a visitor's browser — the same list lib/access.js lets through
   the sign-in gate. A browser asks permission first (OPTIONS) when the page is on another host. */
function isPublicApiPath(urlPath) {
  return urlPath === '/api/register' || urlPath === '/api/track' || urlPath.indexOf('/api/public/') === 0;
}

/* /img/<object path> (lib/picture-cdn.js), loaded on its first request like the other route modules; a module that
   cannot be loaded costs only its pictures a plain 503 (they are pictures: no JSON) */
function pictureRoute(req, res) {
  var mod;
  try { mod = require('./picture-cdn'); }
  catch (err) {
    console.error('api: could not load lib/picture-cdn.js for ' + req.method + ' ' + req.url + ' — ' + (err && err.stack || err));
    return sendText(req, res, 503, 'text/plain; charset=utf-8', 'This picture is not available right now. Please try again shortly.\n', 'no-store');
  }
  return mod.handle(req, res);
}

function routeApi(req, res) {
  var urlPath = String(req.url || '').split('?')[0];

  /* /img/<object path>: one of the bucket's public pictures, from our own address (lib/picture-cdn.js) — public */
  if (urlPath.indexOf('/img/') === 0) return pictureRoute(req, res);

  /* /s/<token>[/<slug>]: a shareable preview link (lib/share-preview.js) — public; it answers every method itself */
  if (urlPath === '/s' || urlPath.indexOf('/s/') === 0) return shareRoute('handleSharedPage')(req, res);

  /* /e/<id> and /preview/<id>, and a site's internal pages: /e/<id>/<slug>, /preview/<id>/<slug> (site-pages.js) */
  var page = /^\/(e|preview)\/([^\/]*)(?:\/([^\/]+))?\/?$/.exec(urlPath);
  if (page || /^\/(e|preview)\//.test(urlPath)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); return res.end(); }
    var eventId = '', slug = '';
    if (page) { try { eventId = decodeURIComponent(page[2]); slug = page[3] ? decodeURIComponent(page[3]) : ''; } catch (e) { eventId = ''; } }
    /* a live site's page name that cannot be one ("Award-FAQs") is still asked of the site: its 404 leads home */
    var badSlug = slug && !sitePages.SLUG_RE.test(slug);
    if (!page || !isEventId(eventId) || (badSlug && (page[1] !== 'e' || slug.length > 120))) return sendNotAvailable(req, res);
    return page[1] === 'e' ? handlePublicPage(req, res, eventId, slug) : handlePreviewPage(req, res, eventId, slug);
  }

  /* /speakers/<slug>, /sponsors/<slug> and their /go: one page per person and sponsor across ET (lib/people.js) — public */
  var person = /^\/(speakers|sponsors)\/([^\/]{1,120})\/?$/.exec(urlPath);
  if (person || /^\/(speakers|sponsors)(\/|$)/.test(urlPath)) {
    if (!person) return sendHtml(req, res, 404, messagePage('This page is not available', 'The address may be mistyped.'), 'no-store');
    var pm = peopleModule();
    if (!pm) return sendHtml(req, res, 503, messagePage('Please try again in a moment', 'This page could not be loaded just now.'), 'no-store');
    return pm.routePublic(req, res, person[1], person[2]);
  }
  if (urlPath === '/sitemap-people.xml') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); return res.end(); }
    var pm2 = peopleModule();
    if (!pm2) return sendText(req, res, 503, 'text/plain; charset=utf-8', 'The sitemap is temporarily unavailable.\n', 'no-store');
    return pm2.handleSitemap(req, res);
  }

  /* /t/o/<id>.gif, /t/c/<id>: a mailer's open pixel and click redirect (lib/promo-track.js) — public */
  var tr = /^\/t\/(o|c)\/([^\/]{1,80})$/.exec(urlPath);
  if (tr || /^\/t\//.test(urlPath)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); return res.end(); }
    if (!tr) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end('Not found'); }
    return trackHit(tr[1], req, res);
  }

  if (urlPath === '/robots.txt' || urlPath === '/sitemap.xml') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); return res.end(); }
    return urlPath === '/robots.txt' ? handleRobotsTxt(req, res) : handleSitemapXml(req, res);
  }

  if (req.method === 'OPTIONS' && isPublicApiPath(urlPath)) return audience('handlePublicOptions')(req, res);

  /* Every /api/ answer says where the published sites are (the one setting, publicBaseFor): the pages build
     each address they show or copy from it (RevampCore.publicUrl), so no page keeps a host of its own. */
  if (urlPath.indexOf('/api/') === 0 && !res.headersSent) res.setHeader('X-Public-Base', publicBaseFor(req, ''));

  var handler = ROUTES[req.method + ' ' + urlPath];
  /* the routes that used to lean on the hosting sign-in gate alone check the caller here (BE-018) */
  if (handler && CALLER_CHECKED[req.method + ' ' + urlPath]) {
    return requireMember(req, res, function (fb, decoded) {
      req.user = decoded;
      try { handler(req, res); } catch (err) { sendFailure(res, req.method + ' ' + urlPath, err); }
    });
  }
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
  onDarkCopy: onDarkCopy, darkCopyOf: darkCopyOf, darkCopyNote: darkCopyNote, storeOnDarkUnit: storeOnDarkUnit, embeddedYearFont: embeddedYearFont,
  unansweredLogoNote: unansweredLogoNote, logoNoteError: logoNoteError, LOGO_NOTE_CODE: LOGO_NOTE_CODE,
  redrawYearInPng: redrawYearInPng, embedsMainPicture: embedsMainPicture, stageContent: stageContent, sitePath: sitePath, readObject: readObject, saveObject: saveObject, publishedObjectPath: publishedObjectPath,
  aiDesignOf: aiDesignOf,
  TRACK_PIXEL: TRACK_PIXEL,   // the open pixel answered when lib/promo-track.js cannot be loaded (must equal its PIXEL)
  sectionAnchorFor: sectionAnchorFor, publicBaseFor: publicBaseFor, cmsOriginFor: cmsOriginFor,
  publishVersion: publishVersion,   // tools/republish-current.js: the published version again, through today's publish step
  sitePortal: sitePortal, sitePortalOf: sitePortalOf, footerEvents: footerEvents, siteFooter: siteFooter,
  aiUsageRecorder,
  validateImportUrl, scrapeLovableUrl, withVisitCounter,
  sanitizeGeneratedSectionHtml, sanitizeGeneratedSectionCss,
  chatRateOk: chatRateOk, CHAT_RATE: CHAT_RATE,
  TOKEN_KIT: TOKEN_KIT, selectSitePage: selectSitePage,
  siteCheckOf: siteCheckOf, siteCheckError: siteCheckError, sectionNamesFor: sectionNamesFor, templateSamples: templateSamples, siteCheckGate: siteCheckGate, livePageOf: livePageOf, repeatedPageHeadings: repeatedPageHeadings, withHeadingText: withHeadingText, writeSectionHeadings: writeSectionHeadings, pictureProblems: pictureProblems, setPictureProbe: function (fn) { pictureProbe = fn || probeUrl; }, logoProblems: logoProblems, liveRepair: liveRepair,
  replaceSiteSection: replaceSiteSection, etChromeFor: etChromeFor, searchVerdicts: searchVerdicts, handleSitemapXml: handleSitemapXml, handleSiteRepair: handleSiteRepair, handleSiteCheck: handleSiteCheck,
  publishTransform, ensureFormsRuntime, deliverPage, cachePage, cachedPage, HTML_TOOLS, acceptedEncoding, FORMS_RUNTIME_V, sitePagePass: function (html, o) { return siteA11y.pagePass(html, o, TOKEN_KIT); }, applyHeroVideo, heroVideoStamp, heroVideoPictures, rewriteOrigins, tokenizeHtml, cleanSettings, mergeSettings, eventStateOf,
  ownerLogoUnit, examineUnit, ownerLogoState, swapHeroUnit, saveOwnerUnit, ownerUnitInputs, briefYearTexts, readLogoPicture, moveYearInPng, yearOnly, inkOfText, cropToOwnUnit, ownUnitBox, cropSvgToOwnUnit, sameDrawing, LOGO_READ_SCHEMA, rasterTone, rasterise, yearCutColour, yearFont,
  /* tools/award-logo-from-previous.js: an examined lock-up stored as the product stores a hero's unit */
  storeLogoUnit: storeLogoUnit,
  /* published pages' UX (published-page-ux.test.js) */
  noSuchPageHtml: noSuchPageHtml, messagePage: messagePage, routeApi: routeApi, headingWords: headingWords, calendarHeaders: calendarHeaders,
  /* Settings › URL & SEO going live (seo-flow.test.js) */
  withPublishedSeo: withPublishedSeo, seoChangeItems: seoChangeItems, forgetCachedPage: forgetCachedPage
};
/* the event's fields as PATCH /api/event reads them: Content › Basics' three details for posts and mailers among them
   (promo-details.test.js) */
module.exports._testHooks.cleanEventBody = cleanEventBody;
module.exports._testHooks.attrUrlQuotes = attrUrlQuotes;
module.exports._testHooks.sanitizeGeneratedSectionHtml = sanitizeGeneratedSectionHtml;
/* the safety steps for markup this server did not write, and the checks of the AI steps (security-fixes.test.js) */
module.exports._testHooks.safeGeneratedSection = safeGeneratedSection;
module.exports._testHooks.tidyGeneratedSectionHtml = tidyGeneratedSectionHtml;
module.exports._testHooks.CALLER_CHECKED = CALLER_CHECKED;
/* The internals of lib/api-generate.js, lib/api-chat.js and lib/api-import.js that the tests and tools/ read here, as
   they did before those routes were moved (BE-017): each is read from its own module, loaded and wired as a request
   would be, on its first read — never when this file is loaded. */
[
  ['api-generate', generateHelpers, [
    'drawnLogoUnit', 'darkCopyOfUnit', 'classifyGlimpses', 'unstyledSectionIds', 'emptyPictureBox', 'dropPicture',
    'usableLogoPicture', 'runStatusOf', 'RUN_ACTIVE_MS', 'SOURCE_FRESH_MS', 'buildGeneratedDesign', 'confirmEtPick',
    'pageKey', 'otherPortalOf', 'siteOfPortal', 'extractThemeFromPreviousEditionSources', 'editionLookLines',
    'placeDirection', 'readEditionLook', 'keptKeyVisual', 'ingestSchemaFor', 'buildSectionImage', 'fetchSourceCss',
    'buildRedesignPrompt', 'stripEditorMarks', 'generatedPageIds', 'sanitizeDesignPlanSections',
    'fewerPeoplePictures', 'awardPlanSections', 'withAwardRecords', 'etPictureRules', 'newStandardPictures',
    'MAX_SECTION_IMAGES', 'awardForSite', 'writeAwardPages', 'awardPageContent', 'seedAwardFaqs', 'seedAwardJury',
    'sparseOverviewText', 'SPARSE_OVERVIEW_CHARS', 'readAwardRecord', 'awardPickByLink', 'readSectionPictures',
    'MAX_PEOPLE_PICTURES', 'buildDesignPlanPrompt', 'buildExtractBriefPrompt', 'buildIngestSourcePrompt',
    'buildSectionCodePrompt', 'designReference', 'buildLogoUnit', 'foundLogoUnit', 'logoUnitInTime',
    'previousUnitNote', 'previousEditionUnit', 'unitSources', 'sectionCodeBatches', 'DESIGN_PLAN_SCHEMA',
    'SECTION_CODE_SCHEMA', 'repeatedHeadingIds', 'takenHeadings', 'keepRootBackground', 'cssUrlQuotes',
    'bottomColour', 'briefFacts', 'watchEvent', 'missingSectionIds', 'earlierPipelineSite', 'runIdOf',
    'handleExtractBrief', 'handleGenerateContent', 'handleGeneratedSection'
  ]],
  ['api-chat', aiChatHelpers, ['buildChatPrompt', 'chatView', 'chatLastPicture', 'chatHistoryText', 'chatResponseSchema']],
  ['api-import', importHelpers, [
    'processLovableImport', 'runImportLovableFromUrl', 'importRenderedPage', 'recordImportFailure',
    'safeImportedMarkup', 'safeImportedFrame', 'handleImportedSection'
  ]]
].forEach(function (m) {
  m[2].forEach(function (name) {
    Object.defineProperty(module.exports._testHooks, name, { enumerable: true, configurable: true, get: function () {
      var mod = require('./' + m[0]);
      mod.wire(m[1]());
      return mod._testHooks[name];
    } });
  });
});
