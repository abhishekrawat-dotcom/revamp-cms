// The Lovable import pipeline:
//
//   -- Lovable import pipeline — the live site's own URL (rendered with headless Chrome by the capture service —
//      see the HEADLESS RENDER ADAPTER block; the old ZIP upload is no longer taken, BE-054) -> flattened static HTML+CSS
//      -> a third template-loader.js template kind ('imported-<id>'), mounted through the EXACT same
//      RevampCanvas.mount() pipeline every real ported/generated template already uses, so it comes out fully
//      click-to-edit for free (see editor-canvas.js's walk() — tags any markup editable independent of
//      content.map). See LOVABLE IMPORT PIPELINE below for the full design (CSS inline-vs-linked decision,
//      the one-section content.map shape). The core is processLovableImport — see that function's own comment.
//   POST /api/import-lovable                 admin-gated. Body: {url} (live render; a {zipBase64} upload is answered
//                               400 zip-not-supported). Strips every script tag in the rendered DOM (meaningless
//                               once this app's own click-to-edit canvas takes over the same DOM), re-hosts the
//                               page's media to Storage, inlines the gathered CSS, stores the result privately in
//                               Storage and creates the imports/<importId> record under an id the server makes
//                               (lib/import-store.js). Returns {templateId: 'imported-<importId>'}.
//   GET  /api/imported-template?eventId=<importId>   signed in (routeApi's caller check) — the
//                               template.json-shaped object for an imported design: one opaque 'imported'
//                               section, content.map has a single inert entry (no library/from id this app's
//                               wizard ever writes to, so editor-fill.js's apply() always leaves the real
//                               captured markup alone — see its own `if (!(m.from in ctx.content)) return;`).
//   GET  /api/imported-section?eventId=<importId>    signed in (routeApi's caller check) — the page's
//                               markup and CSS as JSON { html } (or ?all=1: its sections and frame), sanitised
//                               when imported and again when served (sanitize.js, profile "imported") — proxied through this server rather than the browser
//                               hitting the Storage URL directly, same reasoning as every other template
//                               asset in this app.
//
// The capture itself (scrapeLovableUrl, the HEADLESS RENDER ADAPTER block) and the markup helpers it shares with
// POST /api/ingest-source (parseTagAttrs, extractStylesheetLinks, stripAllScriptTags) stay in lib/api.js and are handed
// to this file. The imports nobody took are listed and cleared by lib/import-sweep.js (POST /api/imports/sweep).
//
// Moved out of lib/api.js as it was (BE-017): from the line after the wire() block below to module.exports, the code
// and its comments are lib/api.js's own, in their order there, unchanged — so where a comment below says "this file",
// "above" or "below" of something that is not in this file, it means lib/api.js, where the rest of that code still is.
// lib/api.js routes the requests here (ROUTES, loaded on first use through inModule()) and hands this file, on every
// call, the helpers and settings that its own routes use too (wire(), as for lib/dash-bot.js): requiring that file from
// here would be a require cycle. Loading this file reads nothing, writes nothing and needs no environment.
const crypto = require('crypto');
const { getFirebase } = require('./firebase');
const { sendJson, parseJsonBody, requireAdmin } = require('./http');
/* The one sanitiser for markup this server did not write itself (a model's sections, a page copied from another
   site): an allow-list on a real parser, applied when such markup is stored and again when it is served. */
const sanitize = require('./sanitize');
const pictures = require('./pictures');
const { splitImportedPage } = require('./import-split');
/* a Lovable import that did not work, said so (BE-048); its pictures, fonts and films copied safely (BE-052) */
const importCheck = require('./import-check');
const importMedia = require('./import-media');
/* where an import is kept, under an id the server makes (BE-049), and what its page says of itself (BE-053) */
const importStore = require('./import-store');
const importPage = require('./import-page');
const { safeFetch, checkPublicUrl } = require('./safe-fetch');
/* the one address of the published sites (UX-001) */
const publicBase = require('./public-base');
/* what would be wrong to put live, and the repairs every live page gets on its way out (site-checks.js) */
const siteChecks = require('./site-checks');

/* What lib/api.js hands this file on every call (wire(); see importHelpers() there): the helpers and settings
   that its own routes use too. Each is kept here under its own name, so the code below reads exactly as it did there.
   Run without them it would have no sign-in check or answer to call, so a wiring with parts missing is refused. */
var NEEDS = [
  'BODY_LIMITS', 'TOKEN_KIT', 'extractStylesheetLinks', 'has', 'scrapeLovableUrl', 'sendFailure', 'stripAllScriptTags'
];
var BODY_LIMITS, TOKEN_KIT, extractStylesheetLinks, has, scrapeLovableUrl, sendFailure, stripAllScriptTags;
function wire(helpers) {
  var missing = NEEDS.filter(function (k) { return !helpers || helpers[k] == null; });
  if (missing.length) throw new Error('lib/api-import.js needs ' + missing.join(', ') + ' from lib/api.js');
  ({
    BODY_LIMITS, TOKEN_KIT, extractStylesheetLinks, has, scrapeLovableUrl, sendFailure, stripAllScriptTags
  } = helpers);
}

var IMPORT_NOT_FOUND = 'This imported design could not be found. Import it again.';

/* =====================================================================================================
   LOVABLE IMPORT PIPELINE — POST /api/import-lovable, GET /api/imported-template, GET /api/imported-section
   ---------------------------------------------------------------------------------------------------
   A live Lovable.app site is rendered by the capture service and its DOM read back (HEADLESS RENDER ADAPTER
   below). The page's own scripts are exactly what we must NOT ship into this app's own
   editor: editor-canvas.js's click-to-edit canvas (RevampCanvas.mount -> template-loader.js's load() ->
   editor-canvas.js's tagEditables/walk()) wants clean static markup it alone controls, not a second JS
   runtime fighting it for the same DOM. So this pipeline FLATTENS the capture (strips every script, keeps
   the real rendered body + CSS) and feeds it through the exact same template-loader.js
   contract every ported/generated template already uses — walk() tags ANY captured markup (images, SVG
   icons, <a> text as buttons, any element with its own text) editable independent of content.map, so once
   the markup is clean static HTML, zero section-detection heuristics are needed here.

   Judgment call — CSS inline vs. linked: this pipeline INLINES every gathered stylesheet directly as
   <style> tags in what GET /api/imported-section actually serves. Reasoning: there's exactly one opaque
   section — there is no real benefit to a second round-trip for a separate .css file, and template-loader.js's
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

   One input method (BE-054): the live URL. The browser-console exporter's ZIP upload this pipeline began with was
   taken out (a request that still sends one is answered 400 zip-not-supported); the media of a capture are copied
   by lib/import-media.js and the record kept by lib/import-store.js. */

function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// The site builder's own "Edit with Lovable" badge — a link into the owner's Lovable project, not part of
// their page. (et-runtime.js removes it from pages imported before this did.)
function stripBuilderBadge(html) {
  return html.replace(/<aside\b[^>]*\bid=["']lovable-badge["'][\s\S]*?<\/aside>/gi, '');
}

function extractBodyInner(html) {
  var m = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1] : html;
}

/* The real work of an import — everything from "clean, script-stripped markup in hand" to "Storage artifacts +
   Firestore record written". Pulled out so it's a
   plain (fb, importId, ...) function callable on its own by an integration test without needing a real
   Firebase Auth ID token to get past requireAdmin — same shape/reasoning as runGenerateContent elsewhere in
   this file. Not exported; handleImportLovable below is still the only real HTTP entry point.

     importId        string    made by the caller with importStore.newImportId() (BE-049) — never one a request
                                chose. The record is created once (create()): an id already used is refused.
     html            string    already script-stripped (stripAllScriptTags) HTML — full document or just <body>,
                                either way (extractBodyInner trims either). Of a full document, the head's
                                <style> blocks are kept as the page's own stylesheet, and its title, description,
                                share picture and <html>/<body> theme are read (lib/import-page.js, BE-053).
                                Still has its <link rel="stylesheet"> tags; extractStylesheetLinks above
                                strips+collects those itself, so every caller does this step identically.
     getCss(href)    href is exactly the string written in that <link href="...">; -> Promise<string|null>
                                (null for "couldn't fetch this one" — degrades, never fails the whole import,
                                same discipline the old gatherImportCss used).
     getAsset(url, kind)       one picture, font or film by its full address (kind 'image' | 'font' | 'video');
                                -> Promise<Buffer | { body, contentType } | null>. What is copied, where it is
                                kept and how the page is pointed at it: lib/import-media.js (BE-052).
     findImageRefs             no longer used (callers still pass it where they always did): import-media.js
                                finds what the markup and each stylesheet name.
     docFields                 extra fields of the imports/<id> record ({ sourceUrl, createdBy }). sourceUrl is
                                also the address the page's relative addresses are read against.
   A capture with nothing worth importing on it (lib/import-check.js verdict: next to no text and nothing else,
   or a host's "there is no site here" page) is refused BEFORE anything is fetched or written (BE-048): the
   promise rejects with an Error whose .status, .code and sentence are what the person is told. */
function processLovableImport(fb, importId, html, getCss, getAsset, findImageRefs, docFields) {
  var pageUrl = (docFields && docFields.sourceUrl) || importMedia.ZIP_BASE;
  var linked = extractStylesheetLinks(html);
  var inner = extractBodyInner(linked.html);
  var bodyHtml = stripBuilderBadge(inner);
  /* the page as it would be stored (made safe), measured: what a visitor would see of it */
  var refusal = '';
  try { refusal = importCheck.verdict(sanitize.sanitizeHtml(bodyHtml, { profile: 'imported' }).html); }
  catch (e) { console.error('import-lovable: the page could not be measured — ' + e.message); }
  if (refusal) return Promise.reject(importCheck.failure(refusal));
  var importRepairs = [];
  /* What stood around the <body> contents (BE-053): the page's name, description and share picture, recorded with
     the import (its design is named after its title, never its address); the classes and theme of <html> and <body>,
     carried onto the .rv-imported wrapper the page is kept in, where the page's CSS finds them (.dark …); and the
     <style> blocks of its <head>, kept as the page's own stylesheet with the ones in its body (made safe below). */
  var page = importPage.pageFacts(html, docFields && docFields.sourceUrl);
  var wrapper = importPage.wrapperOf(html);
  if (inner !== linked.html) {
    var headCss = importPage.headStyles(linked.html);
    if (headCss.length) bodyHtml = headCss.map(function (css) { return '<style>' + css + '</style>'; }).join('\n') + '\n' + bodyHtml;
  }

  /* one copy of a picture, font or film, public, kept for a year (its name is its address's hash: written once).
     A raster picture also gets its WebP copies (pictures.js). A font is named on this host (/img/…, which
     lib/picture-cdn.js serves for an import's fonts): a browser reads a font for a page's CSS only from the page's
     own address, or with CORS headers the bucket does not send; pictures and films keep the bucket's address,
     which every published page names on this host anyway (lib/delivery.js). */
  var bucketPrefix = 'https://storage.googleapis.com/' + fb.bucket.name + '/';
  function storeAsset(objectPath, buffer, kind) {
    return fb.bucket.file(objectPath).save(buffer, {
      resumable: false, predefinedAcl: 'publicRead', gzip: pictures.gzipWorthIt(kind.type, buffer),   // an SVG stored gzipped (pictures.js)
      metadata: { contentType: kind.type, cacheControl: 'public, max-age=31536000' }
    }).then(function () {
      return kind.kind === 'image' ? pictures.storeVariants(fb, objectPath, buffer) : null;
    }).then(function () {
      return kind.kind === 'font' ? '/img/' + objectPath : bucketPrefix + objectPath;
    });
  }

  /* an id already used is never written over (the record is created once below; checked here too, before any work) */
  var record = importStore.recordRef(fb, importId);
  return record.get().then(function (snap) {
    if (snap.exists) throw new Error('the import id ' + importId + ' is already used');
    return Promise.all(linked.cssHrefs.map(function (href) {
      return getCss(href).then(function (text) { return (text == null) ? null : { href: href, text: text }; });
    }));
  }).then(function (fetched) {
    return importMedia.copyMedia({
      html: bodyHtml, sheets: fetched.filter(Boolean), pageUrl: pageUrl, kit: TOKEN_KIT,
      load: typeof getAsset === 'function' ? getAsset : function () { return Promise.resolve(null); },
      store: storeAsset, folder: importStore.folderOf(importId) + 'assets/', ownPrefix: bucketPrefix
    });
  }).then(function (media) {
    bodyHtml = media.html;
    var cssResults = media.sheets;
    /* What the original's own scripts made work, and this page cannot (site-checks.js repair): its addresses on
       the original's host (/nominate, /about — on this host they reach the CMS's sign-in) lead to the form or the
       part of the page they stand for, its "#" privacy, terms and social links to ET's, and a menu with no menu,
       a film with no film and a chat launcher are taken out. Its home link is left for the live page (the event's
       address is not known yet). Each change is listed for the owner (repairs). After the media are copied: a film
       whose file was brought over plays here, so it stays. */
    try {
      var fixedBody = siteChecks.repair(bodyHtml, TOKEN_KIT, { imported: true, homeHref: false });
      bodyHtml = fixedBody.html;
      importRepairs = fixedBody.changes;
    } catch (e) { console.error('import-lovable: the page could not be put right — ' + e.message); }

      /* The safety step (BE-050), before anything is stored: the page is someone else's, and it is shown in the
         editor and published on this app's own address. Its markup goes through sanitize.js (profile "imported":
         no script, handler, unsafe address or frame other than a known video or map; a form kept as a plain
         block), every stylesheet through sanitizeCss, and a <style> inside its body is kept as one more
         stylesheet. GET /api/imported-section makes it safe again whenever it is served. */
      var safeBody = sanitize.sanitizeHtml(bodyHtml, { profile: 'imported' });
      var bodyStyles = sanitize.styleTexts(bodyHtml).map(sanitize.sanitizeCss).filter(Boolean);
      bodyHtml = safeBody.html;
      cssResults = cssResults.map(function (r) { return { href: r.href, text: sanitize.sanitizeCss(r.text) }; }).filter(function (r) { return r.text; });
      if (bodyStyles.length) cssResults.push({ href: 'page', text: bodyStyles.join('\n') });

      var styleBlocks = cssResults.map(function (r) {
        return '<style data-rv-imported-css="' + escAttr(r.href) + '">\n' + r.text + '\n</style>';
      }).join('\n');
      var wrappedBody = wrapper.open + '\n' + bodyHtml + '\n</div>';
      // Served by GET /api/imported-section (made safe again on the way) — CSS + the one wrapper div
      // template-loader.js's tagSection() needs a single root element to stamp data-rv-section onto (see this
      // block's header comment on the CSS judgment call). Private, as everything here but the media copies: it is
      // read only through that route (BE-049). No standalone index.html is written any more.
      var sectionHtml = styleBlocks + '\n' + wrappedBody;
      var folder = importStore.folderOf(importId);
      var sectionHtmlPath = folder + 'section.html';
      var privately = function (type) { return { resumable: false, metadata: { contentType: type, cacheControl: 'private, no-store' } }; };
      /* The page cut into the sections it is made of (import-split.js), so that each can be edited, moved,
         reworked by the AI and opened in the developer zone on its own. A page that cannot be cut stays the
         one section above. The ET wrappers the page loader puts between the page's frame and its sections
         are taken out of the layout, so the sections sit in the frame as they did in the original. */
      var split = null;
      try { split = splitImportedPage(bodyHtml, { wrapper: wrapper.open }); } catch (e) { console.error('import-lovable: could not cut the page into sections — ' + e.message); }
      var sectionsPath = folder + 'sections.json';
      var FRAME_CSS = '<style data-rv-imported-frame>body#imported #container,body#imported #content,body#imported .main-body,body#imported .container-fluid,body#imported .row,body#imported .col-md-12{display:contents}body#imported .blur_bg,body#imported .wrapper.schemas{display:none}</style>';
      var sectionsDoc = split ? {
        v: 2,
        frameOpen: styleBlocks + '\n' + FRAME_CSS + '\n' + split.frameOpen + split.decor,
        frameClose: split.frameClose,
        sections: split.sections
      } : null;

      return fb.bucket.file(sectionHtmlPath).save(Buffer.from(sectionHtml, 'utf8'), privately('text/html; charset=utf-8'))
        .then(function () {
          if (!sectionsDoc) return null;
          return fb.bucket.file(sectionsPath).save(Buffer.from(JSON.stringify(sectionsDoc), 'utf8'), privately('application/json; charset=utf-8'));
        })
        .then(function () {
          var now = new Date().toISOString();
          /* created once, never merged over (BE-049): an id already used fails here rather than replace a design */
          return record.create(Object.assign(
            { importedAt: now, sectionHtmlPath: sectionHtmlPath,
              /* what the page said of itself (BE-053): its title names the design */
              page: page,
              /* it worked (a failed import is recorded as 'failed', with why: recordImportFailure) */
              importStatus: 'imported',
              /* the list of sections, for the template; their markup is in Storage (sectionsPath) */
              sectionsPath: sectionsDoc ? sectionsPath : null,
              sections: sectionsDoc ? sectionsDoc.sections.map(function (x) { return { id: x.id, name: x.name }; }) : null,
              /* what was put right or taken out at import, for the owner (site-checks.js repair) */
              importRepairs: importRepairs.slice(0, 200),
              /* what the safety step took out of the page's markup (sanitize.js), by kind */
              importRemoved: safeBody.removed.slice(0, 100),
              /* the pictures, fonts and films copied, and what was not and why (import-media.js) */
              importMedia: media.summary },
            docFields || {}
          ));
        })
        .then(function () { return { templateId: 'imported-' + importId, repairs: importRepairs, removed: safeBody.removed, media: media.summary }; });
  });
}

/* A failed import, recorded as one (BE-048): imports/<id> says importStatus 'failed' and why, and nothing else
   is written for it — no markup, no copies. GET /api/imported-template and /api/imported-section then answer with
   that reason instead of "not found". An import of that id that is already there (it worked) is left as it is.
   Never rejects: the person is answered whether or not the record could be written. */
function recordImportFailure(fb, importId, source, err) {
  try {
    if (!fb || !fb.db || !importId) return Promise.resolve();
    var ref = importStore.recordRef(fb, importId);
    var doc = { importStatus: 'failed', failedAt: new Date().toISOString(),
      importFailure: { code: (err && err.code) || 'failed', reason: String((err && err.message) || '').slice(0, 300) } };
    if (source && source.url) doc.sourceUrl = String(source.url).slice(0, 2000);
    if (source && source.by) doc.createdBy = String(source.by).slice(0, 200);
    var write = typeof ref.create === 'function' ? ref.create(doc)
      : ref.get().then(function (snap) { return snap.exists ? null : ref.set(doc); });
    return Promise.resolve(write).then(function () {}, function (e) {
      if (!(e && (e.code === 6 || /already exists/i.test(e.message || '')))) console.error('import-lovable: the failure of import-' + importId + ' was not recorded — ' + (e && e.message));
    });
  } catch (e) {
    console.error('import-lovable: the failure of import-' + importId + ' was not recorded — ' + e.message);
    return Promise.resolve();
  }
}
/* what the person is told when an import fails: the sentence a refusal carries, or a plain one */
function sendImportFailure(res, err) {
  if (err && err.code && importCheck.WORDS[err.code]) return sendJson(res, err.status || 422, { error: err.message, code: err.code });
  if (err && err.status && err.status < 500) return sendJson(res, err.status, { error: err.message, code: (err && err.code) || 'refused' });
  console.error('import-lovable: failed — ' + (err && (err.stack || err.message)));
  return sendJson(res, 500, { error: 'The design could not be imported. Try again in a minute.', code: 'import-failed' });
}
/* an import recorded as failed, for whoever opens it (the editor, the wizard) */
function sendFailedImport(res, data) {
  var why = data && data.importFailure && data.importFailure.reason ? String(data.importFailure.reason) : '';
  return sendJson(res, 422, { error: 'This design was not imported' + (why ? ': ' + why : '.'), code: 'import-failed',
    reason: (data && data.importFailure && data.importFailure.code) || 'failed' });
}

/* ---------- live-URL adapter — the processLovableImport() core ----------
   by: who asked for it (their sign-in e-mail), kept on the record for the clear-up of imports nobody took */
function runImportLovableFromUrl(fb, res, importId, url, by) {
  scrapeLovableUrl(url)
    .then(function (rawHtml) { return importRenderedPage(fb, importId, url, rawHtml, by); })
    .then(function (result) { sendJson(res, 200, { templateId: result.templateId, repairs: result.repairs || [] }); })
    .catch(function (err) {
      /* a capture that is not a site, or a service that could not make one: recorded as a failed import, with
         why, and the person told in one sentence (BE-048) */
      var failure = err && err.code && importCheck.WORDS[err.code] ? err : null;
      return (failure ? recordImportFailure(fb, importId, { url: url, by: by }, failure) : Promise.resolve()).then(function () { sendImportFailure(res, err); });
    });
}

/* A page rendered and captured (lovable-scraper-service's capturePage) made into an import: its CSS and media
   fetched from where the page has them, and everything written as processLovableImport does. Also called by
   tools/reimport-lovable.js with a capture made on the operator's own Chrome.
   Every stylesheet and every picture, font and film is fetched through safeFetch (lib/safe-fetch.js): the page
   is someone else's, so each address in it is too, and must not reach this server's own network (the cloud's
   metadata service at 169.254.169.254, say). safeFetch resolves each name once and connects to exactly the
   address it checked, checks each redirect the same way, and stops at a time limit and a size cap (per kind of
   file for media: lib/import-media.js LIMITS). A refused or failed file is left out, never the whole import. */
function importRenderedPage(fb, importId, url, rawHtml, by) {
  return Promise.resolve().then(function () {
    var html = stripAllScriptTags(rawHtml);
    var getCss = function (href) {
      /* The address is read out of markup, where "&" is written "&amp;": left like that, a fonts stylesheet
         asked for several families answers with the first one only, and the page's other fonts are lost. */
      var abs; try { abs = new URL(String(href).replace(/&amp;/g, '&'), url).href; } catch (e) { return Promise.resolve(null); }
      return safeFetch(abs, { timeoutMs: 15000, maxBytes: 3 * 1024 * 1024, accept: /^text\/(?:css|plain)$/, headers: { Accept: 'text/css,*/*;q=0.1' } })
        .then(function (r) { return r.status >= 200 && r.status < 300 ? r.body.toString('utf8') : null; })
        .catch(function (err) {
          console.error('import-lovable: stylesheet "' + abs + '" not fetched — ' + ((err && err.code) || (err && err.message)));
          return null;
        });
    };
    var getAsset = function (abs, kind) {
      var lim = importMedia.LIMITS[kind] || importMedia.LIMITS.image;
      return safeFetch(abs, { timeoutMs: lim.timeoutMs, maxBytes: lim.maxBytes, accept: importMedia.ACCEPT[kind] || importMedia.ACCEPT.image })
        .then(function (r) { return r.status >= 200 && r.status < 300 ? { body: r.body, contentType: r.headers['content-type'] } : null; });
    };
    return processLovableImport(fb, importId, html, getCss, getAsset, null, { sourceUrl: url, createdBy: by ? String(by).slice(0, 200) : null });
  });
}

function handleImportLovable(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    parseJsonBody(req, res, function (body) {
      /* a ZIP export is no longer taken (BE-054): the import reads the published site itself */
      if (body.zipBase64 != null) {
        return sendJson(res, 400, { error: 'A ZIP file can no longer be imported. Paste the address of your published Lovable site instead.', code: 'zip-not-supported' });
      }
      var url = body.url ? String(body.url).trim() : '';
      if (!url) return sendJson(res, 400, { error: 'Paste the address of your published Lovable site.', code: 'url-required' });
      /* The import's id is made here (BE-049): an importId sent with the request is not read, so no request can
         name — and write over — another import. */
      var importId = importStore.newImportId();
      var by = decoded && (decoded.email || (decoded.access && decoded.access.email)) || null;

      /* this product's own address is not a site to import (its pages would come back as the sign-in page) */
      if (importCheck.ownHost(url, [req.headers && req.headers.host, publicBase.publicSiteBase(), publicBase.HOSTED_ORIGIN])) {
        var own = importCheck.failure('own-address');
        return sendJson(res, own.status, { error: own.message, code: own.code });
      }
      checkPublicUrl(url).then(function (r) {
        if (!r.ok) {
          var refused = importCheck.failure(r.code === 'blocked-address' ? 'blocked-address' : r.code === 'unreachable' ? 'unreachable' : 'bad-url');
          return sendJson(res, refused.status, { error: refused.message, code: refused.code });
        }
        runImportLovableFromUrl(fb, res, importId, url, by);
      });
    }, BODY_LIMITS.small);
  });
}

function handleImportedTemplate(req, res) {
  var qs = new URLSearchParams(req.url.split('?')[1] || '');
  var importId = String(qs.get('eventId') || '').trim();
  if (!importId) return sendJson(res, 400, { error: 'eventId is required.' });
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(importId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  /* imports/<id>, or an import from before the move still at events/import-<id> (lib/import-store.js) */
  importStore.readRecord(fb, importId).then(function (rec) {
    if (!rec.data) return sendJson(res, 404, { error: IMPORT_NOT_FOUND, code: 'import-not-found' });
    var data = rec.data;
    /* an import that did not work says so, and why (BE-048) */
    if (data.importStatus === 'failed') return sendFailedImport(res, data);
    /* named after its page's title, never its address (BE-053) */
    var name = importPage.templateName(data);
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
  }).catch(function (err) { sendFailure(res, 'imported-template', err, 'The imported design could not be loaded. Please try again.'); });
}

function handleImportedSection(req, res) {
  var qs = new URLSearchParams(req.url.split('?')[1] || '');
  var importId = String(qs.get('eventId') || '').trim();
  if (!importId) return sendJson(res, 400, { error: 'eventId is required.' });
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(importId)) return sendJson(res, 400, { error: 'Invalid eventId.' });

  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });

  importStore.readRecord(fb, importId).then(function (rec) {
    var data = rec.data;
    if (data && data.importStatus === 'failed') return sendFailedImport(res, data);
    if (!data || !data.sectionHtmlPath) {
      return sendJson(res, 404, { error: IMPORT_NOT_FOUND, code: 'import-not-found' });
    }
    /* ?all=1 — an import cut into sections: { frameOpen, frameClose, sections: { <id>: html } } */
    if (qs.get('all') === '1') {
      if (!data.sectionsPath) return sendJson(res, 404, { error: 'This import was not cut into sections.' });
      return fb.bucket.file(data.sectionsPath).download().then(function (contents) {
        var doc = JSON.parse(contents[0].toString('utf8')), byId = {};
        (doc.sections || []).forEach(function (x) { if (x && typeof x.id === 'string') byId[x.id] = safeImportedMarkup(x.html); });
        var frame = safeImportedFrame(doc.frameOpen, doc.frameClose);
        sendJson(res, 200, { frameOpen: frame.open, frameClose: frame.close, sections: byId });
      });
    }
    /* as JSON { html }, never as an HTML document of this app's own address (template-loader.js reads both) */
    return fb.bucket.file(data.sectionHtmlPath).download().then(function (contents) {
      sendJson(res, 200, { html: safeImportedMarkup(contents[0].toString('utf8')) });
    });
  }).catch(function (err) { sendFailure(res, 'imported-section', err, 'The imported design could not be loaded. Please try again.'); });
}

/* ---------- an imported page, made safe as it is served (BE-050) ----------
   Whatever is stored — an import made before the safety step, or a file changed in Storage since — is read through
   sanitize.js again before it reaches the editor. The page's stylesheets stay <style> elements with their marks
   (data-rv-imported-css: et-runtime.js reads the page's own end states from them; data-rv-imported-frame: the frame's
   layout), first, each through sanitizeCss; the markup goes through sanitizeHtml, which takes every <style> out of
   it. A <style> found inside the markup is kept as one more stylesheet at the front, never where it was (inside an
   <svg> a <style>'s text is read as markup). */
function importedStyleTag(block) {
  var css = sanitize.sanitizeCss(block && block.css);
  if (!css) return '';
  var a = (block && block.attrs) || {};
  var mark = has(a, 'data-rv-imported-frame') ? ' data-rv-imported-frame' : ' data-rv-imported-css="' + escAttr(a['data-rv-imported-css'] || 'page') + '"';
  return '<style' + mark + '>\n' + css + '\n</style>';
}
function safeImportedMarkup(html) {
  try {
    var styles = sanitize.styleBlocks(html).map(importedStyleTag).filter(Boolean).join('\n');
    var body = sanitize.sanitizeHtml(html, { profile: 'imported' }).html;
    return (styles ? styles + '\n' : '') + body;
  } catch (e) {
    console.error('imported-section: the markup could not be made safe, so none is served — ' + e.message);
    return '';
  }
}
/* The frame is the page's wrappers around its sections: an opening half and a closing half that are only whole
   together. They are read as one, with a mark between them that only this request knows, and cut again at it. */
function safeImportedFrame(open, close) {
  try {
    var mark = 'rvframe' + crypto.randomBytes(12).toString('hex');
    var styles = sanitize.styleBlocks(open).map(importedStyleTag).filter(Boolean).join('\n');
    var whole = sanitize.sanitizeHtml(String(open || '') + mark + String(close || ''), { profile: 'imported' }).html;
    var at = whole.indexOf(mark);
    if (at === -1 || whole.indexOf(mark, at + mark.length) !== -1) return { open: styles, close: '' };
    return { open: (styles ? styles + '\n' : '') + whole.slice(0, at), close: whole.slice(at + mark.length) };
  } catch (e) {
    console.error('imported-section: the page frame could not be made safe, so none is served — ' + e.message);
    return { open: '', close: '' };
  }
}

module.exports = { wire, handleImportLovable, handleImportedTemplate, handleImportedSection };
/* what lib/api.js's _testHooks hands the tests and tools/ from this file (read there on first use) */
module.exports._testHooks = { processLovableImport, runImportLovableFromUrl, importRenderedPage, recordImportFailure, safeImportedMarkup, safeImportedFrame, handleImportedSection };
