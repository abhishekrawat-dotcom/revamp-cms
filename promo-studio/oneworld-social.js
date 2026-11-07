/* Oneworld's side of the promotional platform's social posts studio (promo-social-studio.html, shown inside
   Promotions → Social posts). The studio is the platform's own code: its event page's social half and its layout
   editor, copied into promo-studio/social-studio.js by tools/extract-promo-social.py (unchanged except
   SOCIAL_PATCHES). This file loads after it and supplies what the platform's server and page had around the
   studio, on Oneworld:

     - api(url, opts): the platform's request helper, on Oneworld's routes (/api/promo/social/*,
       functions/lib/promo-social.js) and sign-in (RevampAuth.authedFetch). It never rejects: a failure comes back as
       a Response holding { error }, which the platform's code already reads. The platform's server drew every
       picture with Chrome; Oneworld's server has none (apphosting.yaml), so the picture routes are answered here:
         /api/editor/load    the post built on the server (POST /api/promo/social/html), drawn in a hidden frame,
                             flattened into editable elements (OWSocial.extract) and drawn again as the base picture;
                             or the saved layout (GET /api/promo/social/layout), with the options it was saved with
         /api/editor/save    the base picture stored first when it was drawn here (POST …/layout/base), then the
                             layout with its options, the Caption tab's text and the changes it made to its template
                             (POST …/layout)
         /api/editor/render  Download PNG: the edited post (OWSocial.renderEditableHtml) drawn at 2×
         /api/download       Download all sizes (ZIP): each size drawn at 2× as it was made (the canvas, a saved
                             layout, or the template with the canvas's and the saved changes carried in), the
                             platform's captions.json, and Oneworld's caption.txt (the Caption tab's words) when there
                             are any
         /api/preview        one post drawn (nothing calls it now that the cards draw their own; kept for parity)
         /api/psd, /api/background, /api/logo   the uploads, in oneworld-social-art.js (OWSArt)
     - the render frame (OWS.frame): a hidden, sandboxed frame of exactly the post's size. Before anything is drawn
       every script and on… handler is taken out of the post, and every outside picture is fetched through
       Oneworld's picture route (/api/promo/image) and swapped for a blob: (a picture from another host would taint
       the drawing); data-ow-src keeps its real address for the flattener. A picture that cannot be had falls back
       as the platform's markup meant it to (a partner's name in place of a missing logo), or is left out with a
       toast that says so. The frame is flattened and drawn only once its stylesheets and fonts are in, and the
       post's web fonts are put into the picture by this page (owFontCss): html-to-image cannot find them inside a
       frame, and drew the post in a fallback face. Downloads and the editor's base are drawn twice (the first pass
       loads the fonts and pictures into the drawing), card thumbnails once. One queue draws one post at a time;
       whatever the editor asks for is drawn before any card still waiting.
     - the template cards (owner B): every card shows this event's own post, on cards 360 px or wider, drawn at the
       card's size and kept in this browser under the post it shows, so a visit draws only what has changed (UX-121).
       A template the event cannot make yet is drawn with only its gap filled from the shared example library
       (badged "Example", with a link to where the real ones are added) or, for a gap that is a fact (no date or
       venue), as it is with a chip; it can never be opened or downloaded. A template with a saved layout for its
       card shows that layout, marked Saved (UX-127). A click on a picture shows it full size, drawn at its size.
     - the saved layouts (UX-118, UX-124): each size, theme and background is a layout of its own; the text and
       picture changes saved in one size are carried into the sizes that have none, each into the same element by its
       place in the template (never into another that shows the same words), the editor says which sizes are saved,
       and the ZIP takes each size as it was made.
     - the editor's guards: leaving, switching or applying options with unsaved edits asks first (the platform lost
       them without a word); Reset asks; a Testimonial with no quote is never downloaded, nor a Prediction vs Outcome
       still showing the template's own prediction and outcome (UX-135: its card and the editor say they are an
       example until they are this event's own); a QR code is left out of a
       saved layout once the site is no longer published; a pasted picture address must be one Oneworld can load
       (the event's own files, ET's image servers, or a small pasted picture), and "Upload a picture" puts any
       picture on the event first.
     - the page fits Promotions: the frame grows to its content (the page scrolls, not a box inside it), the
       studio, the full-size view and a dialog over the cards take the whole window, and a toast from a tall frame
       is shown by the console, where it can be seen.
     - one post asked for by name (&template=<id>, from ETB2B AI on the events dashboard through Promotions): it
       opens in the editor once the cards are in, or a toast says why it cannot (owOpenDeep).

   Function declarations here replace the platform's of the same name (this file loads after it): toast, cardHtml,
   loadThumbs; mark, crumbs and setProdNav do nothing (Promotions has its own heading); openPortal, showPortals and
   renderEvents go to the event listing. Wrapped: openEditor, closeEditor, loadEditor, refreshThumbs, renderOptions,
   renderEventDetail (its event card becomes one slim line, UX-134), edDownload, edDownloadZip, wirePanel, updUndo,
   updLayerLabel and paintSide (UX-135's note follows the canvas), and uiOpen (so a dialog over the cards is in view). The
   platform's code calls owLeaveEditor, owNudgeSnap, owConfirmReset and owMayDiscard through SOCIAL_PATCHES. While a
   layout loads the stage waits under a spinner until its picture is in (UX-127). */

/* ---------- the event ---------- */
var EVENT_ID = new URLSearchParams(location.search).get('event') || '';
var S = { portal: '', portalName: '', event: EVENT_ID, award: null, kind: 'events', product: 'social', section: 'social' };
var CAT = null, SEL = null, MAILERS = null, previewCache = {}, thumbCache = {};
function mark() { /* the platform kept its own URL in step; this page's URL is the event's, and stays */ }
function crumbs() { /* Promotions has its own heading: the platform's crumb trail has no place here */ }
function setProdNav() { /* the platform's Social / Mailers switch is Promotions' tabs here */ }
/* the platform's portal and event lists are Oneworld's event listing (the whole window: this page is framed) */
function openPortal() { window.top.location.href = '/Event_Listing.html'; }
function showPortals() { openPortal(); }
function renderEvents() { openPortal(); }
/* the event page's mailer half is Promotions → Mailers */
function mailerCards() { return ''; }
function renderEvSaved() { return ''; }

var OW_E = encodeURIComponent(EVENT_ID);
var OW_MIB = 1024 * 1024;
/* what the server keeps (promo-social.js): a base picture of at most 8 MiB, else WebP stepped down to 7.5 MiB */
var OW_BASE_MAX = 8 * OW_MIB, OW_WEBP_MAX = 7.5 * OW_MIB, OW_WEBP_STEPS = [0.92, 0.85, 0.75];
/* a picture pasted into the Source box as data: is taken as the platform took it, up to 300 KB (the server's cap) */
var OW_DATA_MAX = 300 * 1024;
/* how long a post may take to load its fonts and pictures before it is drawn as it is (promo-posts.js waitFonts) */
var OW_SETTLE_MS = 6000;
/* a toast that asks the reader to do something stays long enough to be read */
var OW_LONG = 6000;
var OW_TESTIMONIAL = 'generic.testimonial';
/* UX-135: a post whose two paragraphs are the template's own filler until the user writes them (the server's rule is
   promo-examples.js FILLER_LINES): their option keys */
var OW_PREDICTION = 'generic.prediction-outcome', OW_FILLER_KEYS = ['prediction', 'outcome'];
var OW_MSG = {
  testimonial: 'Type the quote in Options, then Apply & re-render: a testimonial shows a real quote, never a made-up one.',
  prediction: 'Write this event’s own prediction and outcome first, in Options (then Apply & re-render) or on the canvas: the words there now are the template’s example, not this event’s.',
  predictionNote: 'The prediction and outcome are the template’s example words, not this event’s. Write its own, in Options or on the canvas, before downloading.',
  picture: 'Oneworld can only use pictures from this event\'s own files or ET\'s image servers. Use Insert → speakers or sponsors, or use Upload a picture.',
  qr: 'The QR code was left out: the site is not published.',
  carried: 'Your text and picture changes from another size of this post were carried in here.',
  unsure: 'A change from another size of this post was not carried in: Oneworld could not tell which element it belongs to here, and does not guess. Make it here if this size needs it.',
  leftOut: 'A picture could not be loaded and was left out: ',
  tooLarge: 'This layout is too large to save. Remove some pictures or text and save again.',
  offline: 'Oneworld could not be reached. Check your connection and try again.',
  failed: 'Something went wrong with the posts. Please try again.'
};

/* Oneworld's state for this page. frame/shot/strip/inline are the drawing steps (QA's probes call them too). */
var OWS = {
  art: {}, queue: null, htmlCache: {}, snap: '', loaded: null, skipGuard: false,
  frame: owFrame, shot: owShot, strip: owStrip, inline: owInline,
  thumbs: {}, thumbGen: 0, blobCache: {}, baseBlobs: {}, seeds: {},
  fontSheets: {}, fontFiles: {},                                // the posts' font stylesheets and font files, kept for the session (owFontCss)
  loadSeq: 0, lastLoad: null, lastNudge: 0, lb: null, modal: 0,
  uploading: [],                                                // the elements a picture is being uploaded for (owUploadPicture)
  layouts: null, layoutsP: null,                                // the event's saved layouts (owLayouts)
  orig: {}, carried: 0,                                         // the stage's template words and pictures by element; changes carried in
  cardsStale: {}, idb: null, zipSaid: '', zipBusy: false,      // cards to draw again; the kept cards' store; the ZIP's summary; a ZIP being drawn
  artEarly: null                                                // the art asked for beside the catalog, until the page takes it (owArt)
};

/* ---------- small helpers ---------- */
function owArr(x) { return Array.prototype.slice.call(x || []); }
function owClone(o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); }
function owErr(status, msg) { var e = new Error(msg); e.status = status; return e; }
function owMessage(e) { return (e && e.message) || (typeof e === 'string' ? e : ''); }
function owResp(body, status, type) { return new Response(body, { status: status || 200, headers: { 'content-type': type || 'application/json' } }); }
function owJson(obj, status) { return owResp(JSON.stringify(obj), status); }
function owFail(status, msg) { return owJson({ error: msg }, status); }
/* a status a Response can carry (a sign-in failure has 0) */
function owStatus(e) { var s = e && e.status; return s >= 200 && s <= 599 ? s : 503; }
function owAuthed(url, opts) { return window.RevampAuth.authedFetch(url, opts); }
function owPost(url, obj) { return owAuthed(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) }); }
/* a JSON answer, or {} when the body is not JSON */
function owRead(r) { return r.json().then(null, function () { return {}; }); }
function owBodyOf(o) { try { return o && typeof o.body === 'string' ? (JSON.parse(o.body) || {}) : {}; } catch (e) { return {}; } }
function owSafeId(id) { return String(id).replace(/\W/g, '_'); }
/* the platform server's slug() (src/server.ts), for the ZIP's file names */
function owSlug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function owHost(u) { var m = /^[a-z]+:\/\/([^/?#]+)/i.exec(String(u || '')); return m ? m[1] : String(u || '').slice(0, 60); }
/* the layout's key, as the platform's (SRC src/server.ts layoutVariant): template, size, theme, background */
function owKey(tid, fmt, theme, bg) { return tid + '__' + fmt + '__' + (theme || 'dark') + '_bg' + (bg || 'psd'); }
function owFixLink(route) { return '/edit-event.html?event=' + OW_E + '#' + route; }
/* at most ms for p; the timer is cleared as soon as p settles */
function owWithin(p, ms) {
  return new Promise(function (ok) {
    var t = setTimeout(ok, Math.max(0, ms));
    Promise.resolve(p).then(function () { clearTimeout(t); ok(); }, function () { clearTimeout(t); ok(); });
  });
}
function owFramed() { try { return !!window.parent && window.parent !== window; } catch (e) { return false; } }
function owTell(msg) { if (!owFramed()) return; try { window.parent.postMessage(msg, location.origin); } catch (e) { /* not framed by us */ } }
function owTellParent(state) { owTell({ rvSocialStudio: state }); }
function owEditorOpen() { var ed = $('editor'); return !!(ed && ed.classList.contains('on')); }
function owTall() { return document.documentElement.classList.contains('ow-tall'); }
/* the frame fills the window (the studio, the full-size view, a dialog over the cards): no height reports, toasts here */
function owFull() { return owEditorOpen() || !!OWS.lb || OWS.modal > 0; }

/* ---------- requests ---------- */
/* the body of a request the platform's code sends on to Oneworld as it is: Oneworld names the event itself */
function owWithEvent(o) {
  if (!o || typeof o.body !== 'string' || !/^\s*\{/.test(o.body)) return o;
  try {
    var j = JSON.parse(o.body);
    delete j.portal; delete j.event; delete j.award;
    j.eventId = EVENT_ID;
    return Object.assign({}, o, { body: JSON.stringify(j) });
  } catch (e) { return o; }
}
function api(u, o) {
  o = o || {};
  var p;
  try { p = owRoute(String(u), o); } catch (e) { p = Promise.reject(e); }
  return Promise.resolve(p).then(null, function (e) {
    if (!(e && e.status !== undefined)) console.error('promo social: ' + u, e);
    /* fetch fails with a TypeError when there is no network (by name: an error may come from another frame's realm) */
    return owFail(owStatus(e), e && e.status !== undefined && e.message ? e.message : (e && e.name === 'TypeError' ? OW_MSG.offline : OW_MSG.failed));
  });
}
function owRoute(u, o) {
  var path = u.split('?')[0], q = new URLSearchParams(u.split('?')[1] || '');
  if (path === '/api/catalog') return owCatalog();
  if (path === '/api/assets') return owArt();
  /* the platform's event page also asked for its mailers; they are Promotions → Mailers here */
  if (path === '/api/mailers') return Promise.resolve(owResp('null', 200));
  if (path === '/api/preview') return owPreview(owBodyOf(o));
  if (path === '/api/download') return owZip(owBodyOf(o));
  if (path === '/api/editor/load') return owLoad(owBodyOf(o));
  if (path === '/api/editor/save') return owSave(owBodyOf(o));
  if (path === '/api/editor/reset') return owReset(owBodyOf(o));
  if (path === '/api/editor/render') return owRender(owBodyOf(o));
  if (path === '/api/editor/assets') return owRoster();
  if (path === '/api/psd' || path === '/api/background' || path === '/api/logo') return owUpload(path, q, o);
  if (/^\/api\/promo\//.test(path)) return owAuthed(u, owWithEvent(o));
  return Promise.resolve(owFail(404, 'That is not part of Oneworld\'s social posts.'));
}
/* UX-121: the catalog comes with every card's post in it (GET …/catalog?cards=1, made from the same reading of the
   event), so the first card is drawn one round trip sooner. Promotions (marketing.html) asks for it while this frame
   is still loading, beside the event and its kit, and this frame takes that answer, once and for this event only
   (owTakePrefetch); without it, or when it failed, the frame asks itself. The posts go into the cards' cache
   (owSeedCards) and the platform's code reads the catalog as before. The saved layouts and the art are asked for at
   the same time (owEarly), not after the catalog. */
function owCatalog() {
  owEarly();
  var url = '/api/promo/social/catalog?eventId=' + OW_E + '&cards=1';
  var pre = owTakePrefetch();
  var got = pre ? pre.then(function (x) {
    return x && x.status === 200 && typeof x.text === 'string' ? owResp(x.text, 200) : owAuthed(url);
  }) : owAuthed(url);
  return got.then(function (r) {
    if (!r.ok) return r;
    return r.text().then(function (text) {
      var j = null;
      try { j = JSON.parse(text); } catch (e) { j = null; }
      if (!j || typeof j !== 'object') return owResp(text, r.status);
      owSeedCards(j.cards);
      delete j.cards;
      owPrefetchCards(j);
      return owJson(j, r.status);
    });
  });
}
/* Promotions' early catalog for this event, taken once: a promise of { status, text } or null */
function owTakePrefetch() {
  try {
    var P = owFramed() ? window.parent.RevampSocialPrefetch : null;
    if (!P || P.eventId !== EVENT_ID || P.used || !P.catalog) return null;
    P.used = true;
    return Promise.resolve(P.catalog).then(null, function () { return null; });
  } catch (e) { return null; }           // a frame of another page: nothing to take
}
/* the cards' posts that came with the catalog, kept as the html route's answers would be (owCachedHtml); being the
   newest reading of the event, each takes the place of one kept before. Their pictures and font stylesheets are
   asked for at once, all together (owWarm), instead of one card at a time as each is drawn. */
function owSeedCards(cards) {
  if (!Array.isArray(cards)) return;
  var htmls = [];
  cards.forEach(function (c) {
    if (!c || !c.item || !c.answer || typeof c.answer !== 'object') return;
    var key = owHtmlKey({ templateId: c.item.templateId, format: c.item.format, params: c.item.params || {}, preview: c.item.preview === true });
    OWS.htmlCache[key] = Promise.resolve(c.answer);
    if (typeof c.answer.html === 'string') htmls.push(c.answer.html);
  });
  owWarm(htmls);
}
/* the outside pictures (an <img>'s, a style's url()) and the @import-ed font stylesheets of these posts, asked for
   now through the same session caches the drawing reads (owBlobFor, owFontSheet), so a card waits for none of them
   when it is drawn; a failure here is the drawing's to report, as before */
var OW_SRC_RE = /<img\b[^>]*?\ssrc\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi, OW_STYLE_ATTR_RE = /\sstyle\s*=\s*"([^"]*)"/gi;
var OW_IMPORT_RE = /@import\s+url\(\s*(['"]?)(https:\/\/[^'")]+)\1\s*\)/gi;
function owWarm(htmls) {
  var pics = [], sheets = [], m;
  (htmls || []).forEach(function (html) {
    OW_SRC_RE.lastIndex = 0;
    while ((m = OW_SRC_RE.exec(html))) { var src = m[2].replace(/&amp;/g, '&'); if (pics.indexOf(src) === -1) pics.push(src); }
    /* a background in a style attribute, as owInline reads them (a stylesheet's url()s are fonts, not pictures) */
    OW_STYLE_ATTR_RE.lastIndex = 0;
    while ((m = OW_STYLE_ATTR_RE.exec(html))) {
      owStyleUrls(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')).forEach(function (u) { if (pics.indexOf(u) === -1) pics.push(u); });
    }
    OW_IMPORT_RE.lastIndex = 0;
    while ((m = OW_IMPORT_RE.exec(html))) if (sheets.indexOf(m[2]) === -1) sheets.push(m[2]);
  });
  pics.slice(0, 24).forEach(function (u) { owBlobFor(u).then(null, function () { /* the drawing says so */ }); });
  sheets.slice(0, 12).forEach(function (u) { owFontSheet(u); });
}
/* the saved layouts and the event's art, asked for beside the catalog; owArt takes the early answer once */
function owEarly() {
  owLayouts();
  if (!OWS.artEarly) OWS.artEarly = owArtFetch();
}
/* the cards' posts and the saved layouts the catalog's templates need: what the catalog did not bring is asked for
   now, beside the art the page asks for next, instead of after it; loadThumbs then finds them asked for already
   (owCachedHtml, owLayouts) */
function owPrefetchCards(cat) {
  var tpls = [];
  ((cat && cat.catalog && cat.catalog.categories) || []).forEach(function (c) { (c.templates || []).forEach(function (t) { tpls.push(t); }); });
  if (!tpls.length) return;
  owCachedHtml(tpls.map(owCardItem));
  owLayouts();
}
/* the art the event has (which slots are filled), kept for the upload strip */
function owArtFetch() {
  return owAuthed('/api/promo/social/art?eventId=' + OW_E).then(function (r) {
    return owRead(r).then(function (j) { if (r.ok) OWS.art = j; return { status: r.status, j: j }; });
  });
}
function owArt() {
  var early = OWS.artEarly;
  OWS.artEarly = null;                    // taken once: an upload's refresh asks again
  return (early || owArtFetch()).then(function (x) { return owJson(x.j, x.status); });
}
/* the Insert tab's speakers and sponsors: those with a picture, as the platform's editor asked for (no all=1) */
function owRoster() {
  return owAuthed('/api/promo/mailer/roster?eventId=' + OW_E).then(function (r) {
    if (!r.ok) return r;
    return owRead(r).then(function (j) {
      return owJson({ event: j.event, portal: j.portal,
        speakers: (j.speakers || []).filter(function (s) { return s && s.photoUrl; }),
        sponsors: (j.sponsors || []).filter(function (s) { return s && s.logoUrl; }) });
    });
  });
}
function owUpload(path, q, o) {
  var A = window.OWSArt;
  if (!A) return Promise.resolve(owFail(503, 'Uploads did not load. Reload the page and try again.'));
  if (path === '/api/psd') return A.psd(o);
  if (path === '/api/background') return A.background(q.get('slot'), o);
  return A.logo(o);
}
/* posts built on the server: one request for any number of them (at most 36 a request) */
function owHtml(items, extra) {
  var chunks = [];
  for (var i = 0; i < items.length; i += 36) chunks.push(items.slice(i, i + 36));
  return Promise.all(chunks.map(function (part) {
    var body = { eventId: EVENT_ID, items: part };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return owPost('/api/promo/social/html', body).then(function (r) {
      return owRead(r).then(function (j) {
        if (!r.ok || !j || !Array.isArray(j.items)) throw owErr(r.ok ? 502 : r.status, (j && j.error) || 'The posts could not be made. Please try again.');
        return j.items;
      });
    });
  })).then(function (parts) { return [].concat.apply([], parts); });
}
function owHtmlKey(it) { return it.templateId + '|' + it.format + '|' + JSON.stringify(it.params || {}) + '|' + (it.preview ? 1 : 0); }
/* the cards' posts, asked for once and kept until refreshThumbs; what is not kept yet goes in one request */
function owCachedHtml(items) {
  var keys = items.map(owHtmlKey), want = [], wantKeys = [];
  keys.forEach(function (k, i) { if (!OWS.htmlCache[k] && wantKeys.indexOf(k) === -1) { want.push(items[i]); wantKeys.push(k); } });
  if (want.length) {
    var batch = owHtml(want), cache = OWS.htmlCache;
    wantKeys.forEach(function (k, n) { cache[k] = batch.then(function (got) { return got[n] || { error: 'render failed' }; }); });
    /* a request that failed is asked again next time */
    batch.then(null, function () { wantKeys.forEach(function (k) { if (cache === OWS.htmlCache) delete cache[k]; }); });
  }
  return Promise.all(keys.map(function (k) {
    return OWS.htmlCache[k].then(null, function (e) { return { error: owMessage(e) || 'render failed' }; });
  }));
}

/* ---------- the render frame ---------- */
/* One drawing at a time; the editor's (a load, Download PNG, the ZIP) always before any card still waiting. */
function owQueue() {
  var lanes = { editor: [], thumb: [] }, busy = false;
  function pump() {
    if (busy) return;
    var job = lanes.editor.shift() || lanes.thumb.shift();
    if (!job) return;
    busy = true;
    var p;
    try { p = Promise.resolve(job.fn()); } catch (e) { p = Promise.reject(e); }
    p.then(function (v) { busy = false; job.ok(v); pump(); }, function (e) { busy = false; job.no(e); pump(); });
  }
  return {
    run: function (lane, fn) {
      return new Promise(function (ok, no) { (lane === 'editor' ? lanes.editor : lanes.thumb).push({ fn: fn, ok: ok, no: no }); pump(); });
    },
    waiting: function () { return { editor: lanes.editor.length, thumb: lanes.thumb.length, busy: busy }; }
  };
}
OWS.queue = owQueue();

function owParse(html) { return new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html'); }
/* Nothing in a post may run: the frame is sandboxed with no scripts, and the drawing library copies the post's nodes
   into this page, so every script, frame, plug-in and on… handler is taken out first. Two of the platform's handlers
   were fallbacks for a picture that fails (base.ts logoChip: the partner's name; presenting-spotlight.ts: a name
   block); they are kept as a mark (data-ow-fb) and done here instead (owFallback). */
function owStrip(doc) {
  owArr(doc.querySelectorAll('script,iframe,object,embed')).forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
  owArr(doc.getElementsByTagName('*')).forEach(function (el) {
    var h = el.getAttribute('onerror');
    if (h && String(el.tagName).toUpperCase() === 'IMG' && !el.hasAttribute('data-ow-fb')) {
      if (/classList\.add\(\s*'text'\s*\)/.test(h)) el.setAttribute('data-ow-fb', 'chip');
      else if (/ps-name/.test(h)) el.setAttribute('data-ow-fb', 'ps-name');
    }
    owArr(el.attributes).map(function (a) { return a.name; }).filter(function (n) { return /^on/i.test(n); })
      .forEach(function (n) { el.removeAttribute(n); });
  });
  return doc;
}
/* A picture from this site, or one Oneworld's picture route allows, as a blob: of this page (kept for the session). */
function owBlobFor(src) {
  if (OWS.blobCache[src]) return OWS.blobCache[src];
  /* the app's own pictures are written with its public address; whatever host that is, they are this site's files */
  var own = /^https?:\/\/[^/]+(\/(?:templates|assets)\/[^?#]*)/i.exec(src);
  var same = src.indexOf(location.origin + '/') === 0;
  var p = Promise.resolve().then(function () {
    if (own) return fetch(location.origin + own[1]);
    if (same) return fetch(src);
    return owAuthed('/api/promo/image?eventId=' + OW_E + '&url=' + encodeURIComponent(src));
  }).then(function (r) {
    if (!r.ok) throw owErr(r.status, 'The picture could not be loaded.');
    return r.blob();
  }).then(function (b) { return URL.createObjectURL(b); });
  OWS.blobCache[src] = p;
  p.then(null, function () { if (OWS.blobCache[src] === p) delete OWS.blobCache[src]; });
  return p;
}
/* What the platform's markup meant to happen when a picture fails (ONEWORLD PORT: its logo chip handler removed the
   picture before reading its parent, so the name never showed), else the picture is left out (owLeftovers says so). */
function owFallback(img, src) {
  var fb = img.getAttribute('data-ow-fb'), alt = img.getAttribute('alt') || '', par = img.parentNode, doc = img.ownerDocument;
  if (fb === 'chip' && par && par.classList) {
    par.removeChild(img);
    par.classList.add('text');
    par.textContent = alt;
    return;
  }
  if (fb === 'ps-name' && par && doc) {
    var d = doc.createElement('div');
    d.className = 'ps-name';
    d.textContent = alt;
    par.replaceChild(d, img);
    return;
  }
  src = src || img.getAttribute('src') || img.getAttribute('data-ow-src') || '';
  if (src) img.setAttribute('data-ow-src', src);
  img.setAttribute('data-ow-out', owHost(src));
  img.removeAttribute('src');
  img.style.visibility = 'hidden';
}
var OW_URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
function owStyleUrls(st) {
  var out = [], m;
  OW_URL_RE.lastIndex = 0;
  while ((m = OW_URL_RE.exec(st))) if (/^https?:\/\//i.test(m[2]) && out.indexOf(m[2]) === -1) out.push(m[2]);
  return out;
}
function owSwapUrl(st, u, rep) {
  var esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return st.replace(new RegExp('url\\(\\s*([\'"]?)' + esc + '\\1\\s*\\)', 'g'), function () { return rep; });
}
/* every outside picture of the post (an <img>, or a background in a style attribute) becomes a blob: of this page */
function owInline(doc) {
  var jobs = [];
  owArr(doc.getElementsByTagName('img')).forEach(function (img) {
    var src = String(img.getAttribute('src') || '').trim();
    if (!/^https?:\/\//i.test(src)) return;                       // data:, blob: and this page's own are drawn as they are
    jobs.push(owBlobFor(src).then(function (b) {
      img.setAttribute('data-ow-src', src);
      img.setAttribute('src', b);
      img.removeAttribute('srcset');
    }, function () { owFallback(img, src); }));
  });
  owArr(doc.querySelectorAll('[style]')).forEach(function (el) {
    var urls = owStyleUrls(el.getAttribute('style') || '');
    if (!urls.length) return;
    jobs.push(Promise.all(urls.map(function (u) {
      return owBlobFor(u).then(function (b) { return [u, b]; }, function () { return [u, null]; });
    })).then(function (pairs) {
      var st = el.getAttribute('style') || '';
      pairs.forEach(function (pr) {
        st = owSwapUrl(st, pr[0], pr[1] ? 'url("' + pr[1] + '")' : 'none');
        if (!pr[1]) el.setAttribute('data-ow-out', owHost(pr[0]));
      });
      el.setAttribute('style', st);
    }));
  });
  return Promise.all(jobs).then(function () { return doc; });
}
/* Every @import in the frame's stylesheets has arrived or failed (either way its rule then holds a styleSheet).
   A post's fonts come in through one (the templates' and the editor's Google Fonts @import). Chrome reports a frame
   written with document.write as readyState 'complete' at once, before that @import has arrived, and fonts.ready
   then resolves at once too (no @font-face is known yet), so the post was flattened in a fallback face. */
function owSheetsIn(d) {
  return owArr(d.styleSheets).every(function (sh) {
    var rules;
    try { rules = sh.cssRules; } catch (e) { return true; }    // another site's sheet, unreadable: the frame's load event covers it
    return owArr(rules).every(function (r) { return r.type !== 3 || !!r.styleSheet; });   // 3: CSSRule.IMPORT_RULE
  });
}
/* the document is loaded (its stylesheets too), its pictures decoded and its fonts in, or OW_SETTLE_MS has passed */
function owSettle(f, d) {
  var stop = Date.now() + OW_SETTLE_MS;
  function left() { return stop - Date.now(); }
  function ready() { return d.readyState === 'complete' && owSheetsIn(d); }
  var loaded = new Promise(function (ok) {
    if (ready()) { ok(); return; }
    var t = setInterval(function () { if (ready()) { clearInterval(t); ok(); } }, 25);
    f.addEventListener('load', function () { clearInterval(t); ok(); });
    setTimeout(function () { clearInterval(t); }, OW_SETTLE_MS);
  });
  return owWithin(loaded, left()).then(function () {
    var waits = owArr(d.getElementsByTagName('img')).filter(function (img) { return !img.complete; }).map(function (img) {
      return new Promise(function (ok) { img.addEventListener('load', ok); img.addEventListener('error', ok); });
    });
    return owWithin(Promise.all(waits), left());
  }).then(function () {
    /* decoded too, so the drawing never meets a picture still being unpacked */
    var decodes = owArr(d.getElementsByTagName('img')).filter(function (img) { return img.getAttribute('src') && typeof img.decode === 'function'; })
      .map(function (img) { return img.decode().then(null, function () { /* a picture that cannot be shown falls back below */ }); });
    return owWithin(Promise.all(decodes), left());
  }).then(function () {
    /* a layout first, so every face the post's text uses is asked for now that its @font-face rules are known;
       fonts.ready then waits for those (before it, it could resolve with nothing asked for yet) */
    if (d.documentElement) void d.documentElement.offsetHeight;
    return d.fonts && d.fonts.ready ? owWithin(d.fonts.ready, left()) : null;
  });
}
/* a picture that came but cannot be shown (not a picture after all) falls back as a failed one does */
function owBroken(d) {
  owArr(d.getElementsByTagName('img')).forEach(function (img) {
    if (img.getAttribute('src') && img.complete && img.naturalWidth === 0) owFallback(img);
  });
}
/* Nothing outside may be left to the drawing library, which would lose it without a word: any picture still on
   another host is left out, and (for the editor and downloads) a toast names where it was. */
function owLeftovers(d, tell) {
  var hosts = [];
  owArr(d.querySelectorAll('[data-ow-out]')).forEach(function (el) { hosts.push(el.getAttribute('data-ow-out')); });
  owArr(d.getElementsByTagName('img')).forEach(function (img) {
    var s = String(img.getAttribute('src') || '');
    if (!/^https?:/i.test(s)) return;
    img.setAttribute('data-ow-src', s);
    img.removeAttribute('src');
    img.style.visibility = 'hidden';
    hosts.push(owHost(s));
  });
  owArr(d.querySelectorAll('[style]')).forEach(function (el) {
    var st = el.getAttribute('style') || '', urls = owStyleUrls(st);
    if (!urls.length) return;
    urls.forEach(function (u) { st = owSwapUrl(st, u, 'none'); hosts.push(owHost(u)); });
    el.setAttribute('style', st);
  });
  hosts = hosts.filter(function (h, i) { return h && hosts.indexOf(h) === i; });
  if (tell && hosts.length) toast(OW_MSG.leftOut + hosts.join(', '), OW_LONG);
  return hosts;
}
/* The post in a hidden frame of exactly W × H, made safe and self-contained before it is loaded.
   Resolves { frame, doc, done() }; done() takes the frame away. */
function owFrame(html, W, H, o) {
  o = o || {};
  var pre = owParse(html);
  owStrip(pre);
  return owInline(pre).then(function () {
    var text = '<!doctype html>' + pre.documentElement.outerHTML;
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin');
    f.setAttribute('aria-hidden', 'true');
    f.setAttribute('tabindex', '-1');
    f.style.cssText = 'position:fixed;left:-100000px;top:0;width:' + W + 'px;height:' + H + 'px;border:0';
    document.body.appendChild(f);
    function done() { if (f.parentNode) f.parentNode.removeChild(f); }
    return owWrite(f, text).then(function (d) {
      owStrip(d);   // again on the live document: nothing the round trip made may run either
      return owSettle(f, d).then(function () {
        owBroken(d);
        var out = owLeftovers(d, o.tell);
        return { frame: f, doc: d, done: done, leftOut: out };
      });
    }).then(null, function (e) { done(); throw e; });
  });
}
/* written into the frame's own document (layout runs at once); where a browser will not write into a sandboxed
   frame, its srcdoc is used instead */
function owWrite(f, text) {
  try {
    var d = f.contentDocument;
    d.open(); d.write(text); d.close();
    return Promise.resolve(d);
  } catch (e) {
    return new Promise(function (ok, no) {
      var t = setTimeout(function () { no(owErr(500, 'The post could not be drawn.')); }, OW_SETTLE_MS);
      f.addEventListener('load', function () { clearTimeout(t); ok(f.contentDocument); });
      f.srcdoc = text;
    });
  }
}
/* ---------- the post's web fonts, put into the drawing ----------
   html-to-image picks the @font-face rules to put into its picture by the font families of the drawn element and its
   children, but it walks the children only while each is `instanceof HTMLElement` of THIS page's window. Every
   element in the frame belongs to the frame's own window, so the walk stopped at <html>, whose family is the
   browser's default, and no rule was kept: the picture (every download, base and card) was drawn in a fallback face
   (system-ui) while the frame, the editor and the platform's own Chrome screenshot showed Inter, and headings wrapped
   at other words. So the frame's own @font-face rules (with its @imports followed) are gathered here, kept for the
   families the post uses, their font files inlined as data: URIs, and given to html-to-image as fontEmbedCSS, which
   it uses as it is (it then looks for no fonts itself). */
var OW_FACE_RE = /@font-face\s*\{[^}]*\}/gi;
var OW_FONT_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
/* a family as CSS compares it: without quotes, in any case */
function owFamilyKey(f) { return String(f || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase(); }
/* the families the post's elements are set in */
function owFamilies(doc) {
  var used = {}, view = doc.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return used;
  owArr(doc.getElementsByTagName('*')).forEach(function (el) {
    String(view.getComputedStyle(el).fontFamily || '').split(',').forEach(function (f) { var k = owFamilyKey(f); if (k) used[k] = 1; });
  });
  return used;
}
function owAbsUrl(u, base) { try { return new URL(u, base).href; } catch (e) { return ''; } }
/* only https (and this site's own files) are fetched for a font: a post holds nothing else, and http would be refused */
function owFontUrlOk(u) { return /^https:\/\//i.test(u) || u.indexOf(location.origin + '/') === 0; }
function owFacesIn(text, base) {
  return (String(text || '').match(OW_FACE_RE) || []).map(function (css) { return { css: css, base: base }; });
}
/* a font stylesheet's @font-face rules, fetched once a session; a failed one gives none and is asked again next time */
function owFontSheet(url) {
  if (!OWS.fontSheets[url]) {
    var p = fetch(url, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw owErr(r.status, 'The font stylesheet could not be loaded.');
      return r.text();
    }).then(function (t) { return owFacesIn(t, url); });
    OWS.fontSheets[url] = p;
    p.then(null, function () { if (OWS.fontSheets[url] === p) delete OWS.fontSheets[url]; });
  }
  return OWS.fontSheets[url].then(null, function () { return []; });
}
/* a font file as a data: URI, fetched once a session */
function owFontFile(url) {
  if (!OWS.fontFiles[url]) {
    var p = fetch(url, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw owErr(r.status, 'The font could not be loaded.');
      return r.blob();
    }).then(function (b) {
      return new Promise(function (ok, no) {
        var rd = new FileReader();
        rd.onload = function () { ok(String(rd.result)); };
        rd.onerror = function () { no(rd.error || owErr(500, 'The font could not be read.')); };
        rd.readAsDataURL(b);
      });
    });
    OWS.fontFiles[url] = p;
    p.then(null, function () { if (OWS.fontFiles[url] === p) delete OWS.fontFiles[url]; });
  }
  return OWS.fontFiles[url];
}
/* every @font-face rule of the frame: its own sheets' rules, each @import's (Google's sheet cannot be read through
   the frame, it is fetched as html-to-image would fetch it) and any other site's sheet, fetched the same way */
function owAllFaces(doc) {
  var jobs = [], base = doc.baseURI || location.href;
  owArr(doc.styleSheets).forEach(function (sh) {
    var rules = null, at = sh.href || base;
    try { rules = sh.cssRules; } catch (e) { rules = null; }
    if (!rules) { if (sh.href && owFontUrlOk(sh.href)) jobs.push(owFontSheet(sh.href)); return; }
    owArr(rules).forEach(function (r) {
      var u = r.type === 3 && r.href ? owAbsUrl(r.href, at) : '';                        // 3: CSSRule.IMPORT_RULE
      if (u && owFontUrlOk(u)) jobs.push(owFontSheet(u));
      else if (r.type === 5) jobs.push(Promise.resolve(owFacesIn(r.cssText, at)));        // 5: CSSRule.FONT_FACE_RULE
    });
  });
  return Promise.all(jobs).then(function (lists) { return [].concat.apply([], lists); });
}
/* one @font-face rule with its font files inlined; '' when one cannot be had (the face is then left out, as the
   picture could not load it from its address anyway) */
function owInlineFace(face) {
  var urls = [], m;
  OW_FONT_URL_RE.lastIndex = 0;
  while ((m = OW_FONT_URL_RE.exec(face.css))) if (!/^data:/i.test(m[2]) && urls.indexOf(m[2]) === -1) urls.push(m[2]);
  return Promise.all(urls.map(function (u) {
    var abs = owAbsUrl(u, face.base);
    if (!abs || !owFontUrlOk(abs)) return Promise.reject(owErr(400, 'A font address that is not allowed.'));
    return owFontFile(abs).then(function (data) { return [u, data]; });
  })).then(function (pairs) {
    var css = face.css;
    pairs.forEach(function (pr) {
      css = css.replace(OW_FONT_URL_RE, function (all, q, u) { return u === pr[0] ? 'url(' + pr[1] + ')' : all; });
    });
    return css;
  }, function () { return ''; });
}
/* the CSS html-to-image puts into the picture: the @font-face rules of the families the post uses ('' for none, or
   when nothing can be had: the picture then shows the fallback face, as the frame itself does offline) */
function owFontCss(doc) {
  var used = owFamilies(doc);
  return owAllFaces(doc).then(function (faces) {
    return Promise.all(faces.filter(function (f) {
      var m = /font-family\s*:\s*([^;}]+)/i.exec(f.css);
      return !!m && used[owFamilyKey(m[1])] === 1;
    }).map(owInlineFace));
  }).then(function (list) { return list.filter(Boolean).join('\n'); }, function (e) {
    console.error('oneworld-social: the post\'s fonts could not be put into the picture', e);
    return '';
  });
}
/* the picture of the frame's post: twice when passes is 2 (the first pass loads the fonts and pictures into the
   drawing; the second is the one kept, promo-kit.js toPng). The fonts are gathered once for both passes. info, when
   given, is told whether any font went into the picture (info.fonts): a card drawn in a fallback face is not kept. */
function owShot(doc, W, H, ratio, passes, info) {
  var H2I = window.htmlToImage;
  if (!H2I) return Promise.reject(owErr(500, 'The picture maker did not load. Reload the page.'));
  return owFontCss(doc).then(function (css) {
    if (info) info.fonts = !!css;
    var opts = { width: W, height: H, pixelRatio: ratio || 1, fontEmbedCSS: css }, p = Promise.resolve(null);
    for (var i = 0; i < Math.max(1, passes || 1); i++) p = p.then(function () { return H2I.toBlob(doc.documentElement, opts); });
    return p;
  }).then(function (blob) { if (!blob) throw owErr(500, 'The picture could not be made.'); return blob; });
}
/* draw now: { blob, els, clean } (els when o.extract: the editor's elements, flattened before the base is drawn;
   clean: every picture came and the post's fonts went in, so the drawing is the post as it is and may be kept) */
function owDrawNow(html, W, H, o) {
  return owFrame(html, W, H, o).then(function (fr) {
    var els = null, info = {};
    return Promise.resolve().then(function () {
      if (o.extract) els = window.OWSocial.extract(fr.doc, W, H);
      return owShot(fr.doc, W, H, o.ratio, o.passes, info);
    }).then(function (blob) {
      fr.done();
      return { blob: blob, els: els, clean: !(fr.leftOut && fr.leftOut.length) && info.fonts === true };
    }, function (e) { fr.done(); throw e; });
  });
}
/* o.stale(): true once the drawing is no longer wanted; it is then skipped when its turn comes (resolves null) */
function owDraw(html, W, H, o) {
  return OWS.queue.run(o.lane || 'editor', function () { return o.stale && o.stale() ? null : owDrawNow(html, W, H, o); });
}

/* ---------- the template cards (owner B: this event's real posts, larger, with a full-size view) ---------- */
/* what an example fills, in words, and where the real ones are added (promo-posts.js fixLink) */
var OW_FILL = {
  speakers: { w: 'speakers', go: 'content/speakers' },
  sponsors: { w: 'partners', go: 'content/sponsors' },
  sessions: { w: 'sessions', go: 'content/agenda' },
  stats: { w: 'numbers', go: 'content/speakers' },
  audience: { w: 'audience', tail: 'the event’s brief has no “who should attend” list' },
  quote: { w: 'quote and its speaker', tail: 'open it and type the real quote in Options' },
  prediction: { w: 'prediction and outcome', tail: 'open it and write this event’s own' }
};
var OW_STATE = { past: 'Past event', 'no-date-venue': 'No date or venue yet', 'no-date': 'No date yet', closed: 'Nominations closed' };
function owStateLabel(s) { return OW_STATE[s] || 'Not ready yet'; }
function owFirstFormat(t) { return (t.formats && t.formats[0] && t.formats[0].id) || 'ig_square'; }
/* the note under an example: what is an example, and a link to add the real ones (none where there is no place to) */
function owNoteEl(filled) {
  var keys = (filled || []).filter(function (k) { return OW_FILL[k]; });
  var words = keys.map(function (k) { return OW_FILL[k].w; });
  var said = !words.length ? 'content' : words.length === 1 ? words[0] : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
  var go = keys.filter(function (k) { return OW_FILL[k].go; })[0], tail = keys.filter(function (k) { return OW_FILL[k].tail; })[0];
  var d = document.createElement('div');
  d.className = 'ow-ex-note';
  d.appendChild(document.createTextNode('Example ' + said + ' — '));
  if (go) {
    var a = document.createElement('a');
    a.setAttribute('href', owFixLink(OW_FILL[go].go));
    a.setAttribute('target', '_top');
    a.textContent = 'add yours to use this';
    d.appendChild(a);
  } else d.appendChild(document.createTextNode(tail ? OW_FILL[tail].tail : 'not this event’s own'));
  return d;
}
/* The platform's card (SRC index.html:1973-1979). Changed for owner B: the picture is a button that shows it full
   size; a template the event cannot make yet is drawn too (a spinner until then, not "preview N/A"), and has no
   Generate button. Words are escaped, though the engine's own. */
function cardHtml(t) {
  var safe = owSafeId(t.id), label = escapeHtml(t.label), zoom = ' data-ow-zoom="' + escapeHtml(t.id) + '" aria-label="See ' + label + ' full size"';
  var badge = t.isNew ? '<span class="newbadge">NEW</span>' : '';
  var thumb = t.available
    ? '<button type="button" class="thumb" id="th-' + safe + '"' + zoom + '>' + badge + '<span class="spin"></span></button>'
    : '<div class="thumb" id="th-' + safe + '"' + zoom + ' role="button" tabindex="0">' + badge + '<span class="spin"></span></div>';
  return '<div class="tcard ' + (t.available ? '' : 'dis') + '" id="tc-' + safe + '">\n    ' + thumb + '\n' +
    '    <div class="b"><div class="cat">' + escapeHtml(t.catLabel) + '</div><div class="nm">' + label + '</div>\n' +
    '      <div class="ds">' + escapeHtml(t.description) + '</div>\n' +
    '      <div class="cta">' + (t.available
      ? '<button class="btn sm" style="width:100%;justify-content:center" onclick=\'openEditor(' + JSON.stringify(t.id) + ')\'>Generate &amp; edit →</button>'
      : '<div class="warn">needs ' + escapeHtml((t.missing || []).join(', ')) + '</div>') + '</div>\n' +
    '    </div></div>';
}
/* The platform's loadThumbs (SRC index.html:1980-1992), on one request for every card: the templates the event can
   make at their first size, the rest (and the Testimonial, whose card has no quote of its own) as previews with only
   their gap filled. Drawn one at a time, the ones the event can make first, in catalog order.
   UX-121: each is drawn at the card's own size (OW_CARD_W, at the screen's density), not at 1080 px, and a drawing is
   kept in this browser (owThumbCached) under the post it shows, so a visit after the first draws only the cards whose
   post has changed (the event's data, its pictures or the template). A line above the cards counts them in.
   UX-127: a template with a layout saved for its card's size, theme and background shows that layout, marked Saved;
   one with layouts saved in other sizes only is marked "Saved in …" over the template's post. */
function loadThumbs(tpls) {
  var gen = OWS.thumbGen;
  var list = (tpls || []).map(function (t) { return { t: t, item: owCardItem(t) }; });
  if (!list.length) return Promise.resolve();
  owThumbsCount(gen, 0, list.length);
  return Promise.all([owCachedHtml(list.map(function (x) { return x.item; })), owLayouts()]).then(function (r) {
    var answers = r[0], done = 0;
    var rows = list.map(function (x, i) { return { t: x.t, a: answers[i] }; });
    var order = rows.filter(function (r) { return r.t.available; }).concat(rows.filter(function (r) { return !r.t.available; }));
    return Promise.all(order.map(function (r) {
      return owThumb(r.t, r.a, gen).then(function () { owThumbsCount(gen, ++done, order.length); });
    }));
  }, function () {
    if (gen === OWS.thumbGen) list.forEach(function (x) { owThumbSay(x.t, '—'); });
    owThumbsCount(gen, list.length, list.length);
  });
}
/* a card's post: the template at its first size with its default options; a template the event cannot make yet, the
   Testimonial (no quote of its own) and Prediction vs Outcome (the template's own words, UX-135), as a preview with
   only its gap filled and marked */
function owCardItem(t) {
  return { templateId: t.id, format: owFirstFormat(t), params: {}, preview: !t.available || t.id === OW_TESTIMONIAL || t.id === OW_PREDICTION };
}
/* "Drawing your posts — 3 of 9" above the cards while they are drawn (more than one at a time); gone when done */
function owThumbsCount(gen, n, total) {
  if (gen !== OWS.thumbGen) return;
  var grid = $('tgrid'), el = $('owThumbsNote');
  if (n >= total || total < 2 || !grid) { if (el && el.parentNode) el.parentNode.removeChild(el); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'owThumbsNote'; el.className = 'ow-thumbs-note';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    grid.parentNode.insertBefore(el, grid);
  }
  el.textContent = 'Drawing your posts — ' + n + ' of ' + total;
}
function owThumbSay(t, words) {
  var cell = $('th-' + owSafeId(t.id));
  if (cell) cell.innerHTML = (t.isNew ? '<span class="newbadge">NEW</span>' : '') + '<span class="faint" style="font-size:12px">' + escapeHtml(words) + '</span>';
}
/* the theme a card is drawn in (it asks with no options: the template's own default) */
function owCardTheme(t) {
  var th = ((t && t.params) || []).filter(function (p) { return p && p.key === 'theme'; })[0];
  return (th && th.default) || 'dark';
}
/* the sizes of a template with a saved layout, in any theme or background, as their ratios */
function owSavedSizes(t) {
  return ((t && t.formats) || []).filter(function (f) {
    return (OWS.layouts || []).some(function (l) { return l && l.templateId === t.id && l.format === f.id; });
  }).map(function (f) { return f.ratio || f.id; });
}
function owThumb(t, a, gen) {
  if (gen !== OWS.thumbGen) return Promise.resolve();         // the cards were asked for again meanwhile
  var sizes = t.available ? owSavedSizes(t) : [];
  var own = t.available ? owSavedOf(t.id, owFirstFormat(t), owCardTheme(t), '') : null;
  if (!own) return owThumbDraw(t, a, gen, { saved: false, sizes: sizes });
  /* the card's own size is saved: its saved layout, as the editor opens it (the template's post if it cannot be had) */
  return owGetSaved(t.id, owFirstFormat(t), owCardTheme(t), '').then(function (sv) {
    if (!sv) return owThumbDraw(t, a, gen, { saved: false, sizes: sizes });
    var q = owQrCheck(sv.elements);
    var html = window.OWSocial.renderEditableHtml(sv.width, sv.height, String(sv.base || ''), q.list);
    /* a layout saved with the template's own prediction and outcome is still an example (UX-135) */
    var filler = owFillerIn(t.id, sv.elements);
    return owThumbDraw(t, { html: html, width: sv.width, height: sv.height, example: filler, filled: filler ? ['prediction'] : [] }, gen, { saved: true, sizes: sizes });
  }, function () { return owThumbDraw(t, a, gen, { saved: false, sizes: sizes }); });
}
function owThumbDraw(t, a, gen, mark) {
  if (gen !== OWS.thumbGen) return Promise.resolve();
  if (!a || !a.html) {
    /* a template that still cannot be shown says so as the platform did; any other failure is the platform's "—" */
    owThumbSay(t, !t.available && a && a.missing ? 'preview N/A' : '—');
    return Promise.resolve();
  }
  var ratio = owThumbRatio($('th-' + owSafeId(t.id)), a.width), key = owThumbKey(t, a, ratio);
  return owThumbCached(key).then(function (blob) {
    if (blob) return { blob: blob, kept: true };
    return OWS.queue.run('thumb', function () {
      if (gen !== OWS.thumbGen) return null;                  // the cards were asked for again meanwhile
      return owDrawNow(a.html, a.width, a.height, { ratio: ratio, passes: 1 });
    });
  }).then(function (res) {
    if (!res || gen !== OWS.thumbGen) return;
    if (!res.kept && res.clean) owThumbKeep(key, res.blob);
    var cell = $('th-' + owSafeId(t.id)), url = URL.createObjectURL(res.blob);
    if (!cell) { URL.revokeObjectURL(url); return; }
    var was = OWS.thumbs[t.id];
    if (was) { URL.revokeObjectURL(was.url); if (was.full) URL.revokeObjectURL(was.full); }
    thumbCache[t.id] = url;
    OWS.thumbs[t.id] = { id: t.id, url: url, label: t.label, available: !!t.available, example: !!a.example, filled: a.filled || [], state: a.state || '',
      ratio: ratio, html: a.html, width: a.width, height: a.height, full: null, saved: mark.saved, sizes: mark.sizes };
    var tag = owSavedTag(mark);
    cell.innerHTML = (t.isNew ? '<span class="newbadge">NEW</span>' : '') + '<img src="' + escapeHtml(url) + '" alt="">' +
      (a.example ? '<span class="ow-ex">Example</span>' : a.state ? '<span class="ow-chip">' + escapeHtml(owStateLabel(a.state)) + '</span>' :
        tag ? '<span class="ow-saved" title="' + escapeHtml(tag.title) + '">' + escapeHtml(tag.text) + '</span>' : '');
    if (a.example) owCardNote(t.id, a.filled);
  }, function () { if (gen === OWS.thumbGen) owThumbSay(t, '—'); });
}
/* Saved: the card shows the layout saved for its size; Saved in 9:16: layouts are saved in other sizes only */
function owSavedTag(mark) {
  if (!mark) return null;
  if (mark.saved) return { text: 'Saved', title: 'Your saved layout for this size' + (mark.sizes.length > 1 ? ' (saved sizes: ' + mark.sizes.join(', ') + ')' : '') };
  if (mark.sizes && mark.sizes.length) return { text: 'Saved in ' + mark.sizes.join(', '), title: 'This card shows the template; your saved layouts are in ' + mark.sizes.join(', ') };
  return null;
}

/* ---------- the cards' pictures, kept in this browser (UX-121) ----------
   A card is drawn at the card's width at the screen's density (in steps of a tenth, so a card a few pixels wider
   draws the same), never more than the post's own size. Each drawing is kept in IndexedDB under the post it shows:
   its template, size and drawing scale, and a fingerprint of the post's HTML, which holds everything drawn (the
   event's words, the addresses of its pictures, the template's markup). A post that has changed has another
   fingerprint, so it is drawn again; one that has not is shown at once. Only a drawing with every picture and its
   fonts in is kept, for at most OW_KEEP_DAYS, and the oldest go past OW_KEEP_MAX. OW_THUMB_V is raised when the
   drawing itself changes. Storage that is missing, blocked or full only means the cards are drawn again. */
var OW_CARD_W = 400, OW_THUMB_V = 1, OW_KEEP_DAYS = 7, OW_KEEP_MAX = 120;
var OW_IDB_NAME = 'oneworld-social-cards', OW_IDB_STORE = 'cards';
function owThumbRatio(cell, W) {
  var w = 0;
  try { w = cell && cell.getBoundingClientRect ? cell.getBoundingClientRect().width : 0; } catch (e) { w = 0; }
  if (!(w > 0)) w = OW_CARD_W;
  var dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
  return Math.max(0.3, Math.min(1, Math.ceil(w * dpr / (W || 1080) * 10) / 10));
}
/* two FNV-1a hashes of the post's HTML and its length: a fingerprint, not a secret */
function owHash(s) {
  s = String(s);
  var a = 0x811c9dc5, b = 0x9747b28c, c;
  for (var i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822519) >>> 0;
  }
  return ('0000000' + a.toString(16)).slice(-8) + ('0000000' + b.toString(16)).slice(-8) + '-' + s.length.toString(36);
}
function owThumbKey(t, a, ratio) {
  return 'v' + OW_THUMB_V + '|' + EVENT_ID + '|' + t.id + '|' + a.width + 'x' + a.height + '@' + ratio + '|' + owHash(a.html);
}
function owIdb() {
  if (OWS.idb) return OWS.idb;
  OWS.idb = new Promise(function (ok) {
    var rq = null;
    try { rq = window.indexedDB ? window.indexedDB.open(OW_IDB_NAME, 1) : null; } catch (e) { rq = null; }
    if (!rq) { ok(null); return; }
    rq.onupgradeneeded = function () { try { rq.result.createObjectStore(OW_IDB_STORE); } catch (e) { /* there already */ } };
    rq.onsuccess = function () { ok(rq.result); };
    rq.onerror = function () { ok(null); };
    rq.onblocked = function () { ok(null); };
  });
  return OWS.idb;
}
/* the kept drawing, or null */
function owThumbCached(key) {
  return owIdb().then(function (db) {
    if (!db) return null;
    return new Promise(function (ok) {
      try {
        var rq = db.transaction(OW_IDB_STORE, 'readonly').objectStore(OW_IDB_STORE).get(key);
        rq.onsuccess = function () {
          var v = rq.result;
          ok(v && v.blob && Date.now() - (v.at || 0) < OW_KEEP_DAYS * 864e5 ? v.blob : null);
        };
        rq.onerror = function () { ok(null); };
      } catch (e) { ok(null); }
    });
  }).then(null, function () { return null; });
}
function owThumbKeep(key, blob) {
  return owIdb().then(function (db) {
    if (!db) return;
    try {
      var st = db.transaction(OW_IDB_STORE, 'readwrite').objectStore(OW_IDB_STORE), rows = [];
      st.put({ blob: blob, at: Date.now() }, key);
      var cur = st.openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (c) { rows.push([c.key, (c.value && c.value.at) || 0]); c['continue'](); return; }
        if (rows.length <= OW_KEEP_MAX) return;
        rows.sort(function (x, y) { return x[1] - y[1]; }).slice(0, rows.length - OW_KEEP_MAX).forEach(function (r) { st['delete'](r[0]); });
      };
    } catch (e) { /* full or blocked: the card is drawn again next time */ }
  }).then(null, function () { /* the same */ });
}
function owCardNote(id, filled) {
  var card = $('tc-' + owSafeId(id)), b = card && card.querySelector('.b');
  if (!b) return;
  owArr(b.querySelectorAll('.ow-ex-note')).forEach(function (n) { n.parentNode.removeChild(n); });
  b.insertBefore(owNoteEl(filled), b.querySelector('.cta'));
}
/* the full-size view of a drawn card. A card drawn at the card's size is drawn once more at the post's own size for
   it (before any card still waiting) and kept for the page's life; the card's picture shows until then. */
function owOpenThumb(id) {
  var th = OWS.thumbs[id];
  if (!th) return;
  owLightbox(th.full || th.url, th.label, th);
  if (th.full || !(th.ratio < 1) || !th.html) return;
  OWS.queue.run('editor', function () { return OWS.thumbs[id] === th ? owDrawNow(th.html, th.width, th.height, { ratio: 1, passes: 1 }) : null; }).then(function (res) {
    if (!res || OWS.thumbs[id] !== th) return;
    th.full = URL.createObjectURL(res.blob);
    var img = OWS.lb && OWS.lb.id === id ? OWS.lb.el.querySelector('.ow-lb-img') : null;
    if (img) img.setAttribute('src', th.full);
  }, function () { /* the card's picture stays */ });
}
document.addEventListener('click', function (e) {
  var z = e.target && e.target.closest && e.target.closest('[data-ow-zoom]');
  if (z) owOpenThumb(z.getAttribute('data-ow-zoom'));
});
document.addEventListener('keydown', function (e) {
  if (OWS.lb && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); owCloseLightbox(); return; }
  /* the picture of a card the event cannot make yet is not a <button> (it cannot be opened), but Enter shows it */
  var z = e.target && e.target.closest && e.target.closest('[data-ow-zoom]');
  if (z && String(z.tagName).toUpperCase() !== 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); owOpenThumb(z.getAttribute('data-ow-zoom')); }
});
/* The picture at its full width, its name, and what can be done: Generate & edit for a template the event can make;
   for an example, what is an example and where to add the real ones. Never a download. */
function owLightbox(blobUrl, label, info) {
  owCloseLightbox(true);
  info = info || {};
  var lb = document.createElement('div');
  lb.className = 'ow-lb';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', String(label || 'Post') + ', full size');
  var col = document.createElement('div'); col.className = 'ow-lb-col';
  var bar = document.createElement('div'); bar.className = 'ow-lb-bar';
  var t = document.createElement('div'); t.className = 'ow-lb-t'; t.textContent = String(label || '');
  bar.appendChild(t);
  if (info.example || info.state) {
    var tag = document.createElement('span');
    tag.className = info.example ? 'ow-ex' : 'ow-chip';
    tag.textContent = info.example ? 'Example' : owStateLabel(info.state);
    bar.appendChild(tag);
  }
  var sp = document.createElement('span'); sp.className = 'ow-lb-sp'; bar.appendChild(sp);
  if (info.available && info.id) {
    var go = document.createElement('button');
    go.type = 'button'; go.className = 'btn sm'; go.textContent = 'Generate & edit →';
    go.onclick = function () { owCloseLightbox(); openEditor(info.id); };
    bar.appendChild(go);
  }
  var x = document.createElement('button');
  x.type = 'button'; x.className = 'ow-lb-x'; x.setAttribute('aria-label', 'Close'); x.title = 'Close'; x.textContent = '✕';
  x.onclick = function () { owCloseLightbox(); };
  bar.appendChild(x);
  col.appendChild(bar);
  if (info.example) col.appendChild(owNoteEl(info.filled));
  var img = document.createElement('img');
  img.className = 'ow-lb-img'; img.setAttribute('src', blobUrl); img.setAttribute('alt', String(label || 'Post'));
  col.appendChild(img);
  lb.appendChild(col);
  lb.addEventListener('click', function (e) { if (e.target === lb) owCloseLightbox(); });
  document.body.appendChild(lb);
  OWS.lb = { el: lb, back: document.activeElement, id: info.id || '' };
  owTellParent('open');
  try { x.focus(); } catch (e) { /* nothing to focus */ }
}
function owCloseLightbox(quiet) {
  var lb = OWS.lb;
  if (!lb) return;
  OWS.lb = null;
  if (lb.el.parentNode) lb.el.parentNode.removeChild(lb.el);
  if (quiet) return;
  owTellParent('close');
  try { if (lb.back && lb.back.focus) lb.back.focus(); } catch (e) { /* gone */ }
  owReportHeight();
}

/* ---------- the frame grows to its content (owner B) ---------- */
var OW_H = { last: 0, raf: 0 };
function owRaf(fn) { return window.requestAnimationFrame ? window.requestAnimationFrame(fn) : setTimeout(fn, 16); }
/* the bottom of the content, in the page: not scrollHeight, which never shrinks (mailer-studio.js mlFit) */
function owMeasure() {
  var c = $('content');
  return c ? Math.ceil(c.getBoundingClientRect().bottom + (window.scrollY || 0)) : 0;
}
/* at most once a frame, only a change of more than 1 px, never while the frame fills the window, never a hidden 0 */
function owReportHeight() {
  if (OW_H.raf) return;
  OW_H.raf = owRaf(function () {
    OW_H.raf = 0;
    if (owFull()) return;
    var h = owMeasure();
    if (h <= 50 || Math.abs(h - OW_H.last) <= 1) return;
    OW_H.last = h;
    owTell({ rvSocialHeight: h });
  });
}
/* Promotions lets the frame grow (rvSocialTall): the page's own scroll is turned off (html.ow-tall, oneworld.css) */
window.addEventListener('message', function (e) {
  if (e.origin !== location.origin || e.source !== window.parent || !e.data) return;
  if (e.data.rvSocialTall) document.documentElement.classList.add('ow-tall');
});
/* The platform's toast (SRC index.html:2124). In a frame taller than the window its bottom edge can be far below
   what is shown, so while the frame is tall and not filling the window the console shows it instead. */
var owToastTimer = null;
function toast(m, ms) {
  if (owTall() && !owFull() && owFramed()) { owTell({ rvToast: { m: String(m == null ? '' : m), ms: ms } }); return; }
  var t = $('toast');
  if (!t) return;
  t.textContent = m; t.classList.add('on');
  clearTimeout(owToastTimer);
  owToastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 2200);
}
/* a dialog over the cards (Remove a picture) in a tall frame would open in the middle of the whole content, maybe
   far from view: while it is open the frame takes the window, as the studio does */
var owUiOpen = uiOpen;
uiOpen = function (o) {
  var lift = owTall() && !owEditorOpen() && !OWS.lb;
  if (lift && OWS.modal++ === 0) owTellParent('open');
  return owUiOpen(o).then(function (v) {
    if (lift && --OWS.modal === 0) { owTellParent('close'); owReportHeight(); }
    return v;
  });
};

/* ---------- the editor ---------- */
var owOrig = {
  openEditor: openEditor, closeEditor: closeEditor, loadEditor: loadEditor, refreshThumbs: refreshThumbs,
  renderOptions: renderOptions, renderEventDetail: renderEventDetail, edDownload: edDownload, edDownloadZip: edDownloadZip,
  wirePanel: wirePanel
};
/* the studio takes the whole window while it is open; its first load never asks about edits of an earlier visit */
openEditor = function (preId) {
  OWS.skipGuard = true;
  var r = owOrig.openEditor(preId);
  OWS.skipGuard = false;
  if (owEditorOpen()) owTellParent('open');
  return r;
};
closeEditor = function () {
  var was = owEditorOpen();
  owOrig.closeEditor();
  if (was && !owEditorOpen()) { owTellParent('close'); owReportHeight(); owRedrawCards(); }
};
/* UX-127: a template whose layouts were saved or reset in the editor has its card drawn again, from its saved layout */
function owRedrawCards() {
  var ids = Object.keys(OWS.cardsStale);
  OWS.cardsStale = {};
  if (!ids.length || !CAT) return;
  var tpls = [];
  CAT.catalog.categories.forEach(function (c) {
    c.templates.forEach(function (t) { if (ids.indexOf(t.id) !== -1) tpls.push(Object.assign({}, t, { catLabel: c.label })); });
  });
  tpls.forEach(function (t) { var cell = $('th-' + owSafeId(t.id)); if (cell) cell.innerHTML = (t.isNew ? '<span class="newbadge">NEW</span>' : '') + '<span class="spin"></span>'; });
  if (tpls.length) loadThumbs(tpls);
}
/* Switching the template, size, theme or background, applying options and Reset all draw the layout again from the
   template: with unsaved edits that asks first, and Cancel puts every control back as the layout on screen has it. */
loadEditor = function (fresh) {
  if (OWS.skipGuard || !owDirty()) { OWS.skipGuard = false; return owLoadNow(fresh); }
  return owAskDiscard().then(function (yes) { if (yes) return owLoadNow(fresh); owRestoreControls(); });
};
function owLoadNow(fresh) {
  var seq = ++OWS.loadSeq;
  owStageWait(true);
  return Promise.resolve(owOrig.loadEditor(fresh)).then(function () {
    var L = OWS.lastLoad;
    if (seq !== OWS.loadSeq) return;                          // a newer load has the stage, and its own wait
    if (!L || L.seq !== seq || !L.ok || !EDIT.width) { owStageWait(false); return; }
    OWS.snap = JSON.stringify(EDIT.els);
    OWS.loaded = { tid: EDIT.tid, fmt: EDIT.fmt, params: owClone(edParams) };
    OWS.orig = L.orig || {};
    OWS.carried = L.carried || 0;
    owKeepBase();
    if (window.OWSCap && typeof OWSCap.onLoad === 'function') OWSCap.onLoad({ templateId: EDIT.tid, format: EDIT.fmt, params: owClone(edParams), saved: L.saved });
    /* a change that could not be pinned to one element here is said too: the user then makes it in this size */
    var said = L.qr ? OW_MSG.qr : L.carried ? OW_MSG.carried : '';
    if (L.unsure) said = (said ? said + ' ' : '') + OW_MSG.unsure;
    if (said) toast(said, OW_LONG);
    owSizeNote();
    owFillerNote();
    owBaseIn().then(function () { if (seq === OWS.loadSeq) owStageWait(false); });
  }).then(null, function (e) { if (seq === OWS.loadSeq) owStageWait(false); console.error('promo social: the layout editor', e); });
}

/* UX-127: while a layout loads, and until its base picture is in (a saved layout's is a large picture on Storage), the
   stage is hidden under a spinner: the platform showed the elements at once over an empty base, which read as a
   broken post for seconds. Whatever happens, the stage is shown again: on a failure, or after OW_BASE_WAIT_MS. */
var OW_BASE_WAIT_MS = 20000;
function owStageWait(on) {
  var c = $('edCanvas');
  if (!c) return;
  c.classList.toggle('ow-wait', !!on);
  if (on && !$('owStageSpin')) {
    var sp = document.createElement('div');
    sp.id = 'owStageSpin'; sp.className = 'ow-stage-spin'; sp.setAttribute('role', 'status');
    sp.innerHTML = '<span class="spin"></span><span>Loading the layout…</span>';
    c.appendChild(sp);
  }
}
/* resolves once the stage's base picture has loaded or failed (at most OW_BASE_WAIT_MS) */
function owBaseIn() {
  var img = $('edBase');
  return new Promise(function (ok) {
    if (!img || !img.getAttribute('src') || (img.complete && img.naturalWidth > 0)) { ok(); return; }
    var t = setTimeout(done, OW_BASE_WAIT_MS);
    function done() { clearTimeout(t); img.removeEventListener('load', done); img.removeEventListener('error', done); ok(); }
    img.addEventListener('load', done);
    img.addEventListener('error', done);
  });
}

/* UX-124: under the editor's bar, which sizes of this post are saved (each size, theme and background is a layout of
   its own) and that the others are the template's, with the saved changes carried in; nothing while no size, or every
   size, is saved */
function owSizeNote() {
  var ed = $('editor'), top = ed && ed.querySelector('.ed-top');
  if (!top) return;
  var el = $('owSizeNote');
  if (!el) {
    el = document.createElement('div');
    el.id = 'owSizeNote'; el.className = 'ow-size-note'; el.setAttribute('role', 'status');
    top.parentNode.insertBefore(el, top.nextSibling);
  }
  var words = owSizeWords();
  el.textContent = words;
  if (words) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
}
function owListWords(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
function owSizeWords() {
  var t = EDIT.tid ? findTpl(EDIT.tid) : null;
  if (!t || !EDIT.width || t.kind === 'psd' || !owEditorOpen()) return '';
  var fmts = t.formats || [], p = edParams || {}, theme = p.theme || 'dark', bg = p.bg || '';
  if (fmts.length < 2) return '';
  var ratio = function (f) { return f.ratio || f.id; };
  var saved = fmts.filter(function (f) { return !!owSavedOf(t.id, f.id, theme, bg); }), rest = fmts.filter(function (f) { return saved.indexOf(f) === -1; });
  if (!saved.length) return OWS.carried ? OW_MSG.carried + ' Save to keep this size as it is.' : '';
  if (!rest.length) return '';
  var carry = owChangesFor(t.id).length > 0;
  return 'Saved for ' + owListWords(saved.map(ratio)) + ' only. ' + owListWords(rest.map(ratio)) + (rest.length === 1 ? ' uses' : ' use') +
    ' the template' + (carry ? ', with your text and picture changes carried in' : '') + '.';
}
function owDirty() {
  if (!EDIT.width || !owEditorOpen()) return false;
  if (JSON.stringify(EDIT.els) !== OWS.snap) return true;
  return !!(window.OWSCap && typeof OWSCap.dirty === 'function' && OWSCap.dirty());
}
function owAskDiscard() {
  return uiConfirm('Discard your changes?', 'Switching the template, size, theme or background, or applying options, draws the layout again from the template.',
    { ok: 'Discard changes', cancel: 'Keep editing', danger: true });
}
/* S5′ (Apply & re-render) and the loadEditor guard: true when the layout may be drawn again */
function owMayDiscard() {
  if (OWS.skipGuard || !owDirty()) return Promise.resolve(true);
  return owAskDiscard().then(function (yes) { if (yes) OWS.skipGuard = true; return !!yes; });
}
/* S13: Reset deletes the saved layout, so it asks; on yes the reload that follows does not ask again */
function owConfirmReset() {
  return uiConfirm('Reset this layout?', 'Any saved layout for this template, size, theme and background is deleted, and the template is drawn again from the event.',
    { ok: 'Reset', danger: true }).then(function (yes) { if (yes) OWS.skipGuard = true; return !!yes; });
}
/* S7′ and S8: Escape and ← leave the editor, asking first when there are unsaved edits */
function owLeaveEditor() {
  if (!owDirty()) { closeEditor(); return Promise.resolve(true); }
  return uiConfirm('Leave without saving?', 'This layout has changes that are not saved.', { ok: 'Leave without saving', cancel: 'Keep editing', danger: true })
    .then(function (yes) { if (yes) closeEditor(); return !!yes; });
}
/* S9: a run of arrow nudges is one step of Undo */
function owNudgeSnap() {
  var now = Date.now();
  if (now - OWS.lastNudge > 600) pushHistory();
  OWS.lastNudge = now;
}
/* the controls back as the layout on screen has them (the template's sizes rebuilt as switchEditorTpl does) */
function owRestoreControls() {
  var L = OWS.loaded;
  if (!L) return;
  var t = findTpl(L.tid), fmt = $('edFmt');
  $('edTpl').value = L.tid;
  if (t && fmt) {
    fmt.innerHTML = (t.formats || []).map(function (f) { return '<option value="' + escapeHtml(f.id) + '">' + escapeHtml(f.ratio) + '</option>'; }).join('');
    fmt.style.display = t.kind === 'psd' ? 'none' : '';
  }
  if (fmt) fmt.value = L.fmt;
  edParams = owClone(L.params);
  $('edBg').value = edParams.bg || '';
  wireTheme();
}
window.addEventListener('beforeunload', function (e) {
  if (!owDirty()) return;
  e.preventDefault();
  e.returnValue = '';
  return '';
});

/* ---------- the saved layouts (UX-118, UX-124, UX-127) ----------
   A layout is saved per template, size, theme and background (owKey). The list of the event's saved layouts (GET
   /api/promo/social/layouts: each one's key parts, when it was saved, and the text and picture changes it made to its
   template) is asked for once a page and kept in step by this page's own saves and resets. With it the editor says
   which sizes of a post are saved (owSizeNote) and carries a layout's changes into the sizes that have no layout of
   their own, the all-sizes ZIP takes each size as it was made, and a card shows its saved layout. A list that cannot
   be had is an empty one: nothing is carried or marked, and every size is the template's, as before. */
function owLayouts(fresh) {
  if (OWS.layoutsP && !fresh) return OWS.layoutsP;
  var p = owAuthed('/api/promo/social/layouts?eventId=' + OW_E).then(function (r) {
    return owRead(r).then(function (j) {
      if (!r.ok || !j || !Array.isArray(j.layouts)) throw owErr(r.status || 502, (j && j.error) || 'The saved layouts could not be listed.');
      return j.layouts;
    });
  }).then(function (list) {
    if (OWS.layoutsP === p) OWS.layouts = list;
    return OWS.layouts || list;
  }, function () {
    if (OWS.layoutsP === p) OWS.layoutsP = null;                // asked again next time
    return OWS.layouts || [];
  });
  OWS.layoutsP = p;
  return p;
}
function owSavedOf(tid, fmt, theme, bg) {
  var key = owKey(tid, fmt, theme, bg);
  return (OWS.layouts || []).filter(function (l) { return l && l.key === key; })[0] || null;
}
/* a saved layout, as the editor loads it, or null when there is none */
function owGetSaved(tid, fmt, theme, bg) {
  return owAuthed('/api/promo/social/layout?eventId=' + OW_E + '&templateId=' + encodeURIComponent(tid) + '&format=' + encodeURIComponent(fmt) +
    '&theme=' + encodeURIComponent(theme || 'dark') + '&bg=' + encodeURIComponent(bg || '')).then(function (r) {
    return owRead(r).then(function (j) {
      if (!r.ok) throw owErr(r.status, j.error || 'This layout could not be loaded.');
      return j && j.saved ? j : null;
    });
  });
}
/* this page saved a layout (entry) or reset one (gone: its key): the list follows, and the template's card is drawn
   again when the editor closes */
function owRemember(entry, goneKey, tid) {
  var key = entry ? entry.key : goneKey;
  var list = (OWS.layouts || []).filter(function (l) { return l && l.key !== key; });
  if (entry) list.push(entry);
  OWS.layouts = list;
  OWS.cardsStale[entry ? entry.templateId : tid] = true;
}

/* What the template drew in each element of the layout on the stage (OWS.orig, by element id): its words, or its
   picture's address, and its place in the template (owPlaces). Only the template's own elements count: the flattener
   numbers them e0, e1… in the order the template draws them (promo-engine/src/render/extract.ts), while a pasted,
   duplicated or inserted element has an id of another form, so it is never carried. A layout drawn from the template
   is its own; a saved one's are worked back, element by element, from the changes it was saved with. Save sends
   what has changed since (owChangesNow), one change for each element. */
var OW_CHANGES_MAX = 60, OW_CHANGE_LEN = 2000;
/* a neighbour's words are compared up to this length; the server keeps the same (promo-social.js NUMBERS.nearText) */
var OW_NEAR_LEN = 120;
var OW_TPL_ID = /^e(\d{1,6})$/;
/* the template's number for an element it drew, or -1 for one the user added */
function owTplNo(el) { var m = el && typeof el.id === 'string' ? OW_TPL_ID.exec(el.id) : null; return m ? +m[1] : -1; }
/* what a change to the element is: its words, or its picture; '' for a shape, which is never carried */
function owKindOf(el) { return !el ? '' : el.type === 'text' ? 'text' : el.type === 'image' || el.type === 'frame' ? 'src' : ''; }
/* a place as owPlaces gives it, or as a change carries it (the server holds the same rule, cleanChanges) */
function owPlaceOk(p) {
  return !!p && typeof p.of === 'number' && p.of % 1 === 0 && p.of >= 1 && typeof p.alike === 'number' && p.alike % 1 === 0 && p.alike >= 1 &&
    p.alike <= p.of && Array.isArray(p.near) && p.near.length === 2 && typeof p.near[0] === 'string' && typeof p.near[1] === 'string';
}
/* UX-124: each template element's place, so a change made to it is carried into the same element of another size and
   never into another one the template drew with the same words (3 partners and 3 days): how many elements of its kind
   the template drew with those words (of), the template's words in the text elements just before and after it, in
   the order the template drew them (near), and how many of those also have the same words around them (alike).
   valOf(el) gives what the template drew in el. A QR code's caption is no one's neighbour: it is left out once the
   site is not published, and the places must not change with it. */
function owPlaces(els, valOf) {
  var list = (els || []).filter(function (el) { return owTplNo(el) >= 0 && owKindOf(el) && typeof valOf(el) === 'string'; })
    .sort(function (a, b) { return owTplNo(a) - owTplNo(b); });
  var words = list.map(function (el) { return el.type === 'text' && !el.owQr ? String(valOf(el)).slice(0, OW_NEAR_LEN) : null; });
  var near = list.map(function (el, i) {
    var before = '', after = '', j;
    for (j = i - 1; j >= 0; j--) if (words[j] != null) { before = words[j]; break; }
    for (j = i + 1; j < list.length; j++) if (words[j] != null) { after = words[j]; break; }
    return [before, after];
  });
  var out = {};
  list.forEach(function (el, i) {
    var kind = owKindOf(el), v = valOf(el), of = 0, alike = 0;
    list.forEach(function (x, j) {
      if (owKindOf(x) !== kind || valOf(x) !== v) return;
      of++;
      if (near[j][0] === near[i][0] && near[j][1] === near[i][1]) alike++;
    });
    out[el.id] = { of: of, near: near[i], alike: alike };
  });
  return out;
}
function owOrigOf(els, changes) {
  var by = {}, orig = {}, kept = {};
  (changes || []).forEach(function (c) { if (c && typeof c.id === 'string' && !by[c.id]) by[c.id] = c; });
  (els || []).forEach(function (el) {
    var kind = owKindOf(el), now = kind === 'text' ? el.text : kind === 'src' ? el.src : null;
    if (owTplNo(el) < 0 || typeof now !== 'string') return;
    var c = by[el.id] && by[el.id].kind === kind && typeof by[el.id].from === 'string' ? by[el.id] : null;
    var o = {};
    o[kind] = c ? c.from : now;
    orig[el.id] = o;
    /* a changed element keeps the place it was saved with: the elements around it may have been deleted since */
    if (c && owPlaceOk(c)) kept[el.id] = { of: c.of, near: c.near.slice(), alike: c.alike };
  });
  var at = owPlaces(els, function (el) { var o = orig[el.id]; return o ? (o.text != null ? o.text : o.src) : null; });
  Object.keys(orig).forEach(function (id) { orig[id].at = kept[id] || at[id]; });
  return orig;
}
function owChangesNow(els) {
  var out = [], seen = {};
  (els || []).forEach(function (el) {
    var o = owTplNo(el) >= 0 ? OWS.orig[el.id] : null, kind = owKindOf(el);
    if (!o || !kind || seen[el.id] || out.length >= OW_CHANGES_MAX) return;
    var from = kind === 'text' ? o.text : o.src, to = kind === 'text' ? el.text : el.src;
    if (typeof from !== 'string' || typeof to !== 'string' || from === to || !from.trim()) return;
    if (from.length > OW_CHANGE_LEN || to.length > OW_CHANGE_LEN) return;
    /* a pasted picture stays with its own element: it is not carried (the server keeps no such change) */
    if (kind === 'src' && /^data:/i.test(to)) return;
    if (!owPlaceOk(o.at)) return;
    seen[el.id] = true;
    out.push({ kind: kind, from: from, to: to, id: el.id, of: o.at.of, near: o.at.near.slice(), alike: o.at.alike });
  });
  return out;
}
/* the changes the template's saved layouts made, in any size, theme or background, the most recently saved first:
   what is carried into a size of it that has no layout of its own (one for each place; owApplyChanges lets the first
   change that reaches an element have it) */
function owChangesFor(tid) {
  var seen = {}, out = [];
  (OWS.layouts || []).filter(function (l) { return l && l.templateId === tid; })
    .sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); })
    .forEach(function (l) {
      (l.changes || []).forEach(function (c) {
        if (!c || !owPlaceOk(c)) return;
        var k = c.kind + '\u0000' + c.from + '\u0000' + c.near[0] + '\u0000' + c.near[1];
        if (!seen[k]) { seen[k] = true; out.push(c); }
      });
    });
  return out;
}
/* UX-124: each change put into its own element of this size, as the template drew it: the only element with the
   change's words, where the template drew them only once there too and a neighbour agrees, or else the one element
   with those words and the same words on both sides. A change that fits no element, or more than one, is left out
   and counted (unsure), never guessed: words drawn twice would otherwise take a number the event does not have.
   Changes come most recent first, and the first to reach an element has it. { placed, unsure } */
function owApplyChanges(els, changes) {
  var tpl = (els || []).filter(function (el) { return owTplNo(el) >= 0 && owKindOf(el); });
  var vals = {};
  tpl.forEach(function (el) { vals[el.id] = owKindOf(el) === 'text' ? el.text : el.src; });   // the template's, before any change
  var at = owPlaces(tpl, function (el) { return vals[el.id]; });
  var taken = {}, placed = 0, unsure = 0;
  function sides(el, c, both) {
    var p = at[el.id];
    return both ? p.near[0] === c.near[0] && p.near[1] === c.near[1] : p.near[0] === c.near[0] || p.near[1] === c.near[1];
  }
  (changes || []).forEach(function (c) {
    if (!c || (c.kind !== 'text' && c.kind !== 'src') || typeof c.from !== 'string' || typeof c.to !== 'string' || !owPlaceOk(c)) return;
    var same = tpl.filter(function (el) { return owKindOf(el) === c.kind && vals[el.id] === c.from; });
    if (!same.length) return;
    var hit = null;
    if (c.of === 1 && same.length === 1) hit = sides(same[0], c, false) ? same[0] : null;
    else if (c.alike === 1) {
      var close = same.filter(function (el) { return sides(el, c, true); });
      hit = close.length === 1 ? close[0] : null;
    }
    if (!hit) { unsure++; return; }
    if (taken[hit.id]) return;
    taken[hit.id] = true;
    if (c.kind === 'text') {
      hit.text = c.to;
      if (/\n/.test(hit.text) && hit.whiteSpace === 'nowrap') hit.whiteSpace = 'pre-wrap';   // as a line break typed in does (S16)
    } else hit.src = c.to;
    placed++;
  });
  return { placed: placed, unsure: unsure };
}

/* a QR code is left out once the site is not published (correctness 14): it would lead to a site that is not live */
function owQrCheck(list) {
  list = Array.isArray(list) ? list : [];
  if (CAT && CAT.event && CAT.event.published) return { list: list, dropped: 0 };
  var keep = list.filter(function (e) { return !(e && e.owQr); });
  return { list: keep, dropped: list.length - keep.length };
}
/* F3: the saved layout (with its options, V19), or the post built on the server, flattened and drawn here.
   A load the user has moved on from (another template, size, theme or background chosen while it was answering) is
   dropped and never reaches the editor: its answer could land after the newer one's and put the earlier post on the
   stage under the newer one's controls. */
function owLoad(body) {
  var seq = OWS.loadSeq, p = body.params || {}, tid = String(body.templateId || ''), fmt = String(body.format || '');
  var theme = p.theme || 'dark', bg = p.bg || '';
  function stale() { return seq !== OWS.loadSeq; }
  OWS.lastLoad = null;
  var saved = body.fresh ? Promise.resolve(null) : owGetSaved(tid, fmt, theme, bg);
  /* a size drawn from the template takes the changes saved in its other sizes (UX-124); not after Reset or Apply &
     re-render, which ask for the template itself */
  var list = body.fresh ? Promise.resolve([]) : owLayouts();
  return Promise.all([saved, list]).then(function (r) { return r[0]; }).then(function (s) {
    if (stale()) return null;
    if (s) {
      /* the options it was saved with, before anything reads them (V19); theme and background are its key's */
      edParams = Object.assign({}, s.params || {}, { theme: theme, bg: bg || undefined });
      var q = owQrCheck(s.elements);
      OWS.lastLoad = { seq: seq, ok: true, saved: { caption: s.caption || null, savedAt: s.savedAt || null }, qr: q.dropped,
        orig: owOrigOf(q.list, s.changes), carried: 0 };
      return owJson({ width: s.width, height: s.height, base: s.base, elements: q.list, saved: true });
    }
    return owHtml([{ templateId: tid, format: fmt, params: p }]).then(function (got) {
      var a = got[0] || {};
      if (stale()) return null;
      if (!a.html) throw owErr(a.missing ? 409 : 422, a.error || 'This template could not be drawn.');
      return owDraw(a.html, a.width, a.height, { lane: 'editor', ratio: 2, passes: 2, extract: true, tell: true, stale: stale }).then(function (res) {
        if (!res || stale()) return null;
        var base = URL.createObjectURL(res.blob);
        OWS.baseBlobs[base] = res.blob;
        var q = owQrCheck(res.els), orig = owOrigOf(q.list, null);
        var put = body.fresh ? { placed: 0, unsure: 0 } : owApplyChanges(q.list, owChangesFor(tid));
        OWS.lastLoad = { seq: seq, ok: true, saved: null, qr: q.dropped, orig: orig, carried: put.placed, unsure: put.unsure };
        return owJson({ width: a.width, height: a.height, base: base, elements: q.list, saved: false });
      });
    });
  }).then(function (resp) {
    return resp && !stale() ? resp : new Promise(function () { /* dropped: a newer load is on its way */ });
  }, function (e) {
    if (stale()) return new Promise(function () { /* dropped */ });
    OWS.lastLoad = { seq: seq, ok: false };
    throw e;
  });
}
/* only the base on screen (and the picture behind a saved one) is kept; earlier drawings are let go */
function owKeepBase() {
  var keep = /^blob:/.test(EDIT.base) ? EDIT.base : OWS.seeds[EDIT.base];
  Object.keys(OWS.baseBlobs).forEach(function (u) { if (u !== keep) { URL.revokeObjectURL(u); delete OWS.baseBlobs[u]; } });
  Object.keys(OWS.seeds).forEach(function (url) { if (OWS.seeds[url] !== keep) { delete OWS.seeds[url]; delete OWS.blobCache[url]; } });
}
/* V20: the base as drawn (PNG); over what the server keeps, WebP at 0.92, 0.85, then 0.75, the first that fits */
function owFitBase(blob) {
  if (blob.size <= OW_BASE_MAX) return Promise.resolve(blob);
  return createImageBitmap(blob).then(function (bmp) {
    var c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    function step(i) {
      if (i >= OW_WEBP_STEPS.length) throw owErr(413, OW_MSG.tooLarge);
      return new Promise(function (ok) { c.toBlob(ok, 'image/webp', OW_WEBP_STEPS[i]); }).then(function (b) {
        return b && b.type === 'image/webp' && b.size <= OW_WEBP_MAX ? b : step(i + 1);
      });
    }
    return step(0);
  });
}
function owUploadBase(blobUrl, key) {
  var blob = OWS.baseBlobs[blobUrl];
  return (blob ? Promise.resolve(blob) : fetch(blobUrl).then(function (r) { return r.blob(); })).then(owFitBase).then(function (b) {
    return owAuthed('/api/promo/social/layout/base?eventId=' + OW_E + '&key=' + encodeURIComponent(key),
      { method: 'POST', headers: { 'content-type': b.type || 'image/png' }, body: b }).then(function (r) {
      if (!r.ok) return { fail: r };
      return owRead(r).then(function (j) { return j.url ? { url: j.url } : { fail: owFail(502, 'The layout\'s picture could not be stored. Please try again.') }; });
    });
  }, function (e) { return { fail: owFail(e && e.status ? owStatus(e) : 500, owMessage(e) || OW_MSG.tooLarge) }; });
}
/* F4: a base drawn here goes up first; the layout is saved with its options and the Caption tab's words */
function owSave(body) {
  var p = body.params || {}, tid = String(body.templateId || ''), fmt = String(body.format || '');
  var theme = p.theme || 'dark', bg = p.bg || '', base = String(body.base || '');
  var params = owClone(p);
  delete params.bg;
  var up = /^blob:/.test(base) ? owUploadBase(base, owKey(tid, fmt, theme, bg)) : Promise.resolve({ url: base });
  return up.then(function (b) {
    if (b.fail) return b.fail;
    var caption = window.OWSCap && typeof OWSCap.state === 'function' ? OWSCap.state() : null;
    var changes = owChangesNow(body.elements);
    return owPost('/api/promo/social/layout', { eventId: EVENT_ID, templateId: tid, format: fmt, theme: theme, bg: bg, width: body.width, height: body.height,
      base: b.url, elements: body.elements, params: params, caption: caption, changes: changes }).then(function (r) {
      if (!r.ok) return r;
      return owRead(r).then(function (j) {
        owRemember({ key: owKey(tid, fmt, theme, bg), templateId: tid, format: fmt, theme: theme, bg: bg, savedAt: j.savedAt || Date.now(), changes: changes });
        /* only while the editor still has the layout this save was for, by its whole key: an answer landing after a
           reload on another theme or background (same template and size) would mark that other layout as saved */
        var now = edParams || {};
        if (owKey(EDIT.tid, EDIT.fmt, now.theme, now.bg) === owKey(tid, fmt, theme, bg)) {
          /* the stored base is the one on screen: a download draws it from here, not from Storage */
          if (/^blob:/.test(base)) { OWS.seeds[b.url] = base; OWS.blobCache[b.url] = Promise.resolve(base); }
          if (EDIT.base === base) EDIT.base = b.url;
          OWS.snap = JSON.stringify(body.elements || []);
          if (window.OWSCap && typeof OWSCap.markSaved === 'function') OWSCap.markSaved();
          if (OWS.loaded) OWS.loaded.params = owClone(edParams);
          owSizeNote();
        }
        return owJson(j, 200);
      });
    });
  });
}
/* a Reset that did not go through gives back the guard's one-time pass (owConfirmReset) whichever way it failed: a
   refusal, a rejection, or the sign-in helper throwing before any request (the Promise turns that into a rejection) */
function owReset(body) {
  var p = body.params || {};
  return new Promise(function (ok) {
    ok(owPost('/api/promo/social/layout/reset', { eventId: EVENT_ID, templateId: body.templateId, format: body.format, theme: p.theme || 'dark', bg: p.bg || '' }));
  }).then(function (r) {
    if (!r || !r.ok) OWS.skipGuard = false;
    else owRemember(null, owKey(body.templateId, body.format, p.theme || 'dark', p.bg || ''), body.templateId);
    return r;
  }, function (e) { OWS.skipGuard = false; throw e; });
}
/* F5: Download PNG, the edited post drawn at 2× */
function owRender(body) {
  var W = Number(body.width), H = Number(body.height);
  if (!(W > 0 && H > 0)) return Promise.resolve(owFail(400, 'There is nothing to draw yet.'));
  var q = owQrCheck(body.elements);
  if (q.dropped) toast(OW_MSG.qr, OW_LONG);
  var html = window.OWSocial.renderEditableHtml(W, H, String(body.base || ''), q.list);
  return owDraw(html, W, H, { lane: 'editor', ratio: 2, passes: 2, tell: true }).then(function (res) { return owResp(res.blob, 200, 'image/png'); });
}
/* F6 and UX-118: every size at 2×, each as the user made it. The size on the canvas is drawn as it is there now
   (edits not saved yet included, as Download PNG takes it); another size as it was saved, in the same theme and
   background; a size with no layout of its own from the template and the Options form, with the text and picture
   changes carried in (UX-124): the canvas's own, saved or not, first, then those saved in its other sizes. The
   platform drew every size from the template and the form, so the edits on the canvas were silently left out. With
   the platform's captions.json ({ "<template>": caption } as its server wrote it, 2-space JSON) and, when the Caption
   tab has words, Oneworld's caption.txt (V18). A toast counts the sizes as they are drawn (a size with changes carried
   in is drawn twice, so the ZIP can take ten seconds); what each size was drawn from is said in OWS.zipSaid, for the
   toast at the end (edDownloadZip). */
function owZip(body) {
  var tids = Array.isArray(body.templates) ? body.templates : [], fmts = Array.isArray(body.formats) ? body.formats : [], params = body.params || {};
  var items = [];
  tids.forEach(function (tid) {
    var t = findTpl(tid), own = ((t && t.formats) || []).map(function (f) { return f.id; });
    (fmts.length ? fmts : own).forEach(function (f) { if (own.indexOf(f) !== -1) items.push({ templateId: tid, format: f, params: params[tid] || {} }); });
  });
  if (!items.length) return Promise.resolve(owFail(400, 'There is nothing to download.'));
  OWS.zipSaid = '';
  var open = owEditorOpen() && !!EDIT.width, onCanvas = open ? owChangesNow(EDIT.els) : [];
  function carry(tid) { return (open && tid === EDIT.tid ? onCanvas : []).concat(owChangesFor(tid)); }
  var ready = 0;
  function count() { toast('Drawing all sizes… ' + ready + ' of ' + items.length + ' ready.', 60000); }
  count();
  return Promise.all([owHtml(items), owLayouts()]).then(function (r0) {
    var got = r0[0], zip = new JSZip(), captions = {}, drawn = 0, said = [], qr = 0;
    return Promise.all(got.map(function (a, i) {
      var it = items[i], p = it.params || {}, theme = p.theme || 'dark', bg = p.bg || '';
      function from(res, how) {
        return res ? { a: a && a.width ? a : it, it: it, blob: res.blob, how: res.carried ? 'carried' : how, unsure: res.unsure || 0 } : null;
      }
      var job;
      if (open && it.templateId === EDIT.tid && it.format === EDIT.fmt) {
        job = owDrawEls(EDIT.width, EDIT.height, EDIT.base, EDIT.els).then(function (res) { qr += res.qr; return from(res, 'canvas'); });
      } else if (owSavedOf(it.templateId, it.format, theme, bg)) {
        job = owGetSaved(it.templateId, it.format, theme, bg).then(function (sv) {
          if (sv) return owDrawEls(sv.width, sv.height, sv.base, sv.elements).then(function (res) { qr += res.qr; return from(res, 'saved'); });
          return a && a.html ? owDrawTemplate(a, carry(it.templateId)).then(function (res) { return from(res, 'template'); }) : null;
        });
      } else if (a && a.html) {
        job = owDrawTemplate(a, carry(it.templateId)).then(function (res) { return from(res, 'template'); });
      } else job = Promise.resolve(null);
      /* a size that could not be drawn as it was made (its saved picture would not load, say) is drawn from the
         template, and the toast says so, rather than the whole ZIP failing */
      return job.then(null, function (e) {
        if (!(a && a.html)) throw e;
        console.error('promo social: the ZIP drew ' + it.format + ' from the template', e);
        return owDraw(a.html, a.width, a.height, { lane: 'editor', ratio: 2, passes: 2, tell: true }).then(function (res) { return from(res, 'fallback'); });
      }).then(function (d) { ready++; if (ready < items.length) count(); return d; });
    })).then(function (done) {
      done.forEach(function (d) {
        if (!d) return;
        var t = findTpl(d.it.templateId) || {}, id = String(d.it.templateId), dot = id.indexOf('.');
        zip.file(owSlug(t.category || id.slice(0, dot)) + '-' + owSlug(t.subtype || id.slice(dot + 1)) + '-' + d.it.format + '.png', d.blob);
        captions[d.it.templateId] = d.a.caption;
        said.push({ how: d.how, unsure: d.unsure, ratio: (((t.formats || []).filter(function (f) { return f.id === d.it.format; })[0]) || {}).ratio || d.it.format });
        drawn++;
      });
      if (!drawn) throw owErr(422, (got[0] && got[0].error) || 'The posts could not be drawn.');
      OWS.zipSaid = owZipWords(said) + (qr ? ' ' + OW_MSG.qr : '');
      zip.file('captions.json', JSON.stringify(captions, null, 2));
      var text = tids.map(function (tid) { return window.OWSCap && typeof OWSCap.textFor === 'function' ? OWSCap.textFor(tid) : null; })
        .filter(function (s) { return s && String(s).trim(); })[0];
      if (text) zip.file('caption.txt', String(text));
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) { return owResp(blob, 200, 'application/zip'); });
  });
}
/* a layout's elements on its base, drawn at 2× as Download PNG draws them: { blob, qr } (qr: QR elements left out) */
function owDrawEls(W, H, base, els) {
  var q = owQrCheck(els);
  var html = window.OWSocial.renderEditableHtml(W, H, String(base || ''), q.list);
  return owDraw(html, W, H, { lane: 'editor', ratio: 2, passes: 2, tell: true }).then(function (res) { return { blob: res.blob, qr: q.dropped }; });
}
/* A size with no layout of its own: the template's post. With changes to carry in it is flattened as the editor
   flattens it, the changes are put in, and it is drawn from its elements: { blob, carried, unsure } (how many changes
   found their element; how many could not be pinned to one). With none, or none that finds its element, the post is
   drawn as the template made it. */
function owDrawTemplate(a, changes) {
  function plain(unsure) {
    return owDraw(a.html, a.width, a.height, { lane: 'editor', ratio: 2, passes: 2, tell: true }).then(function (res) { return { blob: res.blob, carried: 0, unsure: unsure || 0 }; });
  }
  if (!changes || !changes.length) return plain(0);
  return owDraw(a.html, a.width, a.height, { lane: 'editor', ratio: 2, passes: 2, extract: true }).then(function (res) {
    var els = res.els || [], put = owApplyChanges(els, changes);
    if (!put.placed) return plain(put.unsure);
    var base = URL.createObjectURL(res.blob);
    return owDrawEls(a.width, a.height, base, els).then(function (r2) { URL.revokeObjectURL(base); return { blob: r2.blob, carried: put.placed, unsure: put.unsure }; },
      function (e) { URL.revokeObjectURL(base); throw e; });
  });
}
/* "✓ Downloaded ZIP — 1:1 as on the canvas; 4:5 as saved; 16:9 and 9:16 from the template, with your text and picture
   changes", and the sizes a change could not be pinned to one element in */
function owZipWords(said) {
  var HOW = [['canvas', 'as on the canvas'], ['saved', 'as saved'], ['carried', 'from the template, with your text and picture changes'], ['template', 'from the template'],
    ['fallback', 'from the template, as the layout you made could not be drawn']];
  var parts = HOW.map(function (h) {
    var r = said.filter(function (x) { return x.how === h[0]; }).map(function (x) { return x.ratio; });
    return r.length ? owListWords(r) + ' ' + h[1] : '';
  }).filter(Boolean);
  var unsure = said.filter(function (x) { return x.unsure; }).map(function (x) { return x.ratio; });
  return '✓ Downloaded ZIP — ' + parts.join('; ') + '.' + (unsure.length ? ' A change Oneworld could not match to one element was left out of ' +
    owListWords(unsure) + ', rather than guessed.' : '');
}

/* the platform's single-post route; nothing calls it now that the cards draw their own */
function owPreview(body) {
  return owHtml([{ templateId: body.templateId, format: body.format, params: body.params || {} }]).then(function (got) {
    var a = got[0] || {};
    if (!a.html) throw owErr(a.missing ? 409 : 422, a.error || 'This template could not be drawn.');
    var thumb = !!body.thumb;
    return owDraw(a.html, a.width, a.height, { lane: thumb ? 'thumb' : 'editor', ratio: thumb ? 1 : 2, passes: thumb ? 1 : 2, tell: !thumb })
      .then(function (res) { return owResp(res.blob, 200, 'image/png'); });
  });
}

/* V9: a Testimonial is never downloaded without a real quote */
function owNoQuote(q) { return EDIT.tid === OW_TESTIMONIAL && !String(q == null ? '' : q).trim(); }
/* UX-135: Prediction vs Outcome is never downloaded while it shows the template's own prediction or outcome. What is
   checked is the words on the canvas, so they may be written in Options (then Apply) or on the canvas itself */
function owSquash(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); }
function owFillerLines(tid) {
  if (tid !== OW_PREDICTION || !CAT || !CAT.catalog) return [];
  var t = findTpl(tid);
  return owArr(t && t.params).filter(function (p) { return p && OW_FILLER_KEYS.indexOf(p.key) !== -1 && typeof p.default === 'string'; })
    .map(function (p) { return owSquash(p.default); }).filter(Boolean);
}
function owFillerIn(tid, els) {
  var lines = owFillerLines(tid);
  return lines.length > 0 && owArr(els).some(function (e) { return !!e && e.type === 'text' && lines.indexOf(owSquash(e.text)) !== -1; });
}
/* The ZIP takes a saved size as it was saved (UX-118): the saved sizes of this post, other than the one on the canvas,
   that still show those words, as their ratios. One that cannot be read is left to the ZIP, which says so itself. */
function owFillerSaved() {
  var t = EDIT.tid === OW_PREDICTION ? findTpl(EDIT.tid) : null;
  if (!t) return Promise.resolve([]);
  var p = edParams || {}, theme = p.theme || 'dark', bg = p.bg || '';
  var fmts = (t.formats || []).filter(function (f) { return f.id !== EDIT.fmt && !!owSavedOf(t.id, f.id, theme, bg); });
  return Promise.all(fmts.map(function (f) {
    return owGetSaved(t.id, f.id, theme, bg).then(function (sv) { return sv && owFillerIn(t.id, sv.elements) ? (f.ratio || f.id) : null; },
      function () { return null; });
  })).then(function (r) { return r.filter(Boolean); });
}
function owFillerSavedWords(sizes) {
  var many = sizes.length > 1;
  return 'Not downloaded: your saved ' + owListWords(sizes) + ' layout' + (many ? 's still show' : ' still shows') +
    ' the template’s example prediction and outcome. Open ' + (many ? 'those sizes' : 'that size') + ' and write this event’s own there.';
}
/* under the editor's bar while the canvas shows them, with the Example badge the card carries */
function owFillerNote() {
  var ed = $('editor'), top = ed && ed.querySelector('.ed-top');
  if (!top) return;
  var el = $('owFillerNote'), on = owEditorOpen() && !!EDIT.width && owFillerIn(EDIT.tid, EDIT.els);
  if (!on) { if (el) el.setAttribute('hidden', ''); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'owFillerNote'; el.className = 'ow-filler-note'; el.setAttribute('role', 'status');
    el.innerHTML = '<span class="ow-ex">Example</span><span>' + escapeHtml(OW_MSG.predictionNote) + '</span>';
    top.parentNode.insertBefore(el, top.nextSibling);
  }
  el.removeAttribute('hidden');
}
/* the note follows the canvas: a text typed in Style (updLayerLabel), undo and redo (updUndo), a selection or a
   deletion (paintSide) */
var owUpdUndo = updUndo, owUpdLayerLabel = updLayerLabel, owPaintSide = paintSide;
updUndo = function () { var r = owUpdUndo.apply(this, arguments); owFillerNote(); return r; };
updLayerLabel = function () { var r = owUpdLayerLabel.apply(this, arguments); owFillerNote(); return r; };
paintSide = function () { var r = owPaintSide.apply(this, arguments); owFillerNote(); return r; };
edDownload = function () {
  if (owNoQuote(edParams.quote)) { toast(OW_MSG.testimonial, OW_LONG); return Promise.resolve(); }
  if (owFillerIn(EDIT.tid, EDIT.els)) { owFillerNote(); toast(OW_MSG.prediction, OW_LONG); return Promise.resolve(); }
  return owOrig.edDownload.apply(this, arguments);
};
/* the ZIP is drawn from the Options form as it stands (edDownloadZip reads it), so its quote is the form's */
edDownloadZip = function () {
  var f = document.querySelector('#edOpts [data-key="quote"]');
  if (owNoQuote(f ? f.value : edParams.quote)) { toast(OW_MSG.testimonial, OW_LONG); return Promise.resolve(); }
  if (owFillerIn(EDIT.tid, EDIT.els)) { owFillerNote(); toast(OW_MSG.prediction, OW_LONG); return Promise.resolve(); }
  /* one ZIP at a time: it can take ten seconds, and a second click would draw every size again and download twice */
  if (OWS.zipBusy) { toast('The ZIP is still being drawn. It downloads when every size is ready.', OW_LONG); return Promise.resolve(); }
  var self = this, args = arguments, held = false;
  OWS.zipBusy = true;
  owZipButton(true);
  OWS.zipSaid = '';
  function done() { OWS.zipBusy = false; owZipButton(false); }
  function go() { return owOrig.edDownloadZip.apply(self, args); }
  /* Prediction vs Outcome: its saved sizes are checked first (UX-135); any other post goes at once, as before */
  var first = EDIT.tid !== OW_PREDICTION ? new Promise(function (ok) { ok(go()); }) : owFillerSaved().then(function (sizes) {
    if (!sizes.length) return go();
    held = true;
    toast(owFillerSavedWords(sizes), OW_LONG);
    return undefined;
  });
  /* the platform's "✓ Downloaded ZIP", with what each size was drawn from (owZip) */
  return first.then(function (v) {
    done();
    if (OWS.zipSaid && !held) toast(OWS.zipSaid, OW_LONG);
    OWS.zipSaid = '';
    return v;
  }, function (e) { done(); throw e; });
};
/* the ZIP button, shut and reading "Drawing all sizes…" while a ZIP is drawn (the Options panel may have been drawn
   again meanwhile: it is the button shown now that is set) */
function owZipBtn() {
  var body = $('edSideBody');
  return body ? owArr(body.querySelectorAll('button')).filter(function (b) { return b.getAttribute('onclick') === 'edDownloadZip()'; })[0] || null : null;
}
function owZipButton(busy) {
  var btn = owZipBtn();
  if (!btn) return null;
  if (busy && !btn.hasAttribute('data-ow-label')) btn.setAttribute('data-ow-label', btn.textContent);
  if (!busy && btn.hasAttribute('data-ow-label')) { btn.textContent = btn.getAttribute('data-ow-label'); btn.removeAttribute('data-ow-label'); }
  else if (busy) btn.textContent = 'Drawing all sizes…';
  btn.disabled = !!busy;
  return btn;
}

/* ---------- picture addresses (V16, O2 = c) ---------- */
/* A pasted picture is taken only in the forms the server keeps when the layout is saved: this is its own rule
   (DATA_PICTURE, functions/lib/promo-social.js), letter case and all. A looser rule here would take a picture (an SVG
   written "data:image/svg+xml,%3Csvg…", say) that Save then refuses. The adapter test holds the two the same. */
var OW_DATA_PICTURE = /^data:image\/(png|jpeg|webp|svg\+xml)(;charset=[A-Za-z0-9_-]+)?(;base64,[A-Za-z0-9+/=\s]*|;utf8,[\s\S]*)$/;
/* true when Oneworld can use the address: a small pasted picture, or an https address its picture route allows (the
   event's own files, ET's image servers), asked of the route itself and let go once it has answered */
function owPictureOk(v) {
  if (OW_DATA_PICTURE.test(v)) return Promise.resolve(v.length <= OW_DATA_MAX);
  if (!/^https:\/\//i.test(v)) return Promise.resolve(false);
  var ctl = window.AbortController ? new AbortController() : null;
  return owAuthed('/api/promo/image?eventId=' + OW_E + '&url=' + encodeURIComponent(v), ctl ? { signal: ctl.signal } : {}).then(function (r) {
    if (ctl) { try { ctl.abort(); } catch (e) { /* already done */ } }
    return r.status === 200;
  }, function () { return false; });
}
wirePanel = function (el) {
  owOrig.wirePanel(el);
  if (!el || (el.type !== 'image' && el.type !== 'frame')) return;
  var src = $('epSrc');
  if (!src) return;
  var take = src.onchange;
  src.onchange = function () {
    var v = String(src.value || '').trim();
    if (!v || v === el.src) { if (take) take.call(src); return; }
    var before = el.src || '';
    owPictureOk(v).then(function (ok) {
      if (String(src.value || '').trim() !== v) return;      // typed over meanwhile: its own change is checked
      if (ok) { if (take) take.call(src); return; }
      src.value = before.indexOf('data:') === 0 ? '' : before;
      toast(OW_MSG.picture, OW_LONG);
    });
  };
  owAddUpload(el, src);
};
/* §13 O2 = c: "Upload a picture" beside the Source box puts a picture on the event first (OWSArt.picture) */
function owAddUpload(el, src) {
  var row = document.createElement('div'); row.className = 'ow-upl-row';
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'btn alt sm ow-upl';
  b.owEl = el;                                                  // the element it uploads for (owUplShown reads it)
  owUplLook(b, OWS.uploading.indexOf(el) !== -1);
  var inp = document.createElement('input');
  inp.type = 'file'; inp.setAttribute('accept', 'image/*'); inp.setAttribute('hidden', ''); inp.setAttribute('aria-hidden', 'true'); inp.tabIndex = -1;
  b.onclick = function () { inp.click(); };
  inp.onchange = function () {
    var f = inp.files && inp.files[0];
    inp.value = '';
    if (f) owUploadPicture(el, f);
  };
  row.appendChild(b); row.appendChild(inp);
  src.parentNode.insertBefore(row, src.nextSibling);
}
/* shut and reading "Uploading…" while a picture for its element is on its way (§13 O2 = c) */
function owUplLook(b, busy) { b.disabled = busy; b.textContent = busy ? 'Uploading…' : 'Upload a picture'; }
/* The Style panel is drawn afresh on every selection and at the end of every drag, so the button that was clicked may
   be gone before its upload ends. Uploads in progress are therefore kept by element (OWS.uploading), and it is the
   button the panel shows now that is set, and only when it is that element's. */
function owUplShown(el) {
  var b = document.querySelector('.ow-upl');
  if (b && b.owEl === el) owUplLook(b, OWS.uploading.indexOf(el) !== -1);
}
function owUploadPicture(el, file) {
  var A = window.OWSArt;
  if (!A || typeof A.picture !== 'function') { toast('Uploading pictures did not load. Reload the page and try again.', OW_LONG); return Promise.resolve(); }
  if (OWS.uploading.indexOf(el) !== -1) return Promise.resolve();   // one at a time for an element: the first is kept
  OWS.uploading.push(el);
  owUplShown(el);
  return Promise.resolve().then(function () { return A.picture(file); }).then(function (got) {
    var i = EDIT.els.indexOf(el);
    if (!got || !got.url) throw new Error('The picture could not be uploaded.');
    if (i === -1) { toast('The picture was uploaded, but the element it was for is no longer on the canvas.', OW_LONG); return; }
    pushHistory();                                              // Undo brings the old picture back
    el.src = got.url;
    if (edNodes[i]) applyNode(edNodes[i], el);
    if (edSel === i) { var s = $('epSrc'); if (s) s.value = got.url; updLayerLabel(); }
  }).then(null, function (e) {
    toast(owMessage(e) || 'The picture could not be uploaded.', OW_LONG);
  }).then(function () {
    var k = OWS.uploading.indexOf(el);
    if (k !== -1) OWS.uploading.splice(k, 1);
    owUplShown(el);
  });
}

/* ---------- the event page ---------- */
refreshThumbs = function () {
  OWS.htmlCache = {};
  OWS.thumbGen++;
  Object.keys(thumbCache).forEach(function (k) { URL.revokeObjectURL(thumbCache[k]); });
  Object.keys(OWS.thumbs).forEach(function (k) { if (OWS.thumbs[k].full) URL.revokeObjectURL(OWS.thumbs[k].full); });
  OWS.thumbs = {};
  if (!CAT) return;
  /* the cards the event cannot make yet are drawn again too (the platform's refresh spun only the others) */
  CAT.catalog.categories.forEach(function (c) {
    c.templates.forEach(function (t) {
      if (t.available) return;
      var cell = $('th-' + owSafeId(t.id)), card = $('tc-' + owSafeId(t.id));
      if (cell) cell.innerHTML = '<span class="spin"></span>';
      if (card) owArr(card.querySelectorAll('.ow-ex-note')).forEach(function (n) { n.parentNode.removeChild(n); });
    });
  });
  return owOrig.refreshThumbs();
};
renderOptions = function () {
  owOrig.renderOptions();
  owZipHint();
  if (window.OWSCap && typeof OWSCap.decorateOptions === 'function') OWSCap.decorateOptions();
};
/* UX-118: under "Download all sizes (ZIP)", what each size in it is */
function owZipHint() {
  var btn = owZipBtn();
  if (btn && OWS.zipBusy) owZipButton(true);                   // the panel was drawn again while a ZIP is being drawn
  if (!btn || $('owZipHint')) return;
  var h = document.createElement('div');
  h.id = 'owZipHint'; h.className = 'hint';
  h.textContent = 'Every size as you made it: this one as it is on the canvas, a saved size as saved, and the others from the template with the text and picture changes made here (saved or not) and in your saved sizes.';
  btn.parentNode.insertBefore(h, btn.nextSibling);
}
/* UX-134: the console's header above this frame already names the event and its date, and the platform's event card
   repeated them (with the venue and an empty grey logo square), filling a phone's first screen. It is replaced by
   one slim line (oneworld.css .ow-facts) of what only this page says: the hashtag the posts carry, the edition, the
   site while it is live, and the counts that decide which posts can be made. */
function owFactsLine() {
  var head = document.querySelector('#content .ev-head'), ev = CAT && CAT.event;
  if (!head || !ev || !head.parentNode) return;
  var c = ev.counts || {};
  function stat(n, one) { n = Number(n) || 0; return '<span class="stat">' + n + '<span>' + escapeHtml(n === 1 ? one : one + 's') + '</span></span>'; }
  var line = document.createElement('div');
  line.className = 'ow-facts';
  line.innerHTML = (ev.hashtag ? '<span class="hchip">' + escapeHtml(ev.hashtag) + '</span>' : '') +
    (ev.edition ? '<span class="chip">' + escapeHtml(ordinal(ev.edition)) + ' edition</span>' : '') +
    (ev.micrositeUrl ? '<a class="chip" href="' + escapeHtml(ev.micrositeUrl) + '" target="_blank" rel="noopener">Website ↗</a>' : '') +
    stat(c.speakers, 'speaker') + stat(c.sponsorTiers, 'sponsor tier') + stat(c.sessions, 'session');
  head.parentNode.replaceChild(line, head);
}
renderEventDetail = function (assets) {
  owOrig.renderEventDetail(assets);
  owFactsLine();
  if (window.OWSArt && typeof OWSArt.decorate === 'function') OWSArt.decorate(OWS.art);
  owReportHeight();
};

/* ---------- one post asked for by name ----------
   ETB2B AI on the events dashboard opens Promotions on the post the person asked for ("a save-the-date post"), and
   Promotions passes it on in this frame's address (&template=<id>). Once the event's cards are in, a template the
   event can make opens in the editor, once; one it cannot make yet, or one that does not exist, is said in a toast
   over the cards. The toast waits a moment for the frame to have grown (rvSocialTall), so that it is the console
   that shows it, in view, and never longer than that. */
var OW_DEEP = new URLSearchParams(location.search).get('template') || '';
var OW_DEEP_WAIT = 2000;
function owList(words) {
  words = owArr(words).map(String).filter(Boolean);
  return words.length < 2 ? words.join('') : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
}
function owWhenTall(ms) {
  return new Promise(function (resolve) {
    var waited = 0;
    (function again() {
      if (!owFramed() || owTall() || waited >= ms) { resolve(); return; }
      waited += 100;
      setTimeout(again, 100);
    })();
  });
}
function owDeepToast(m) { return owWhenTall(OW_DEEP_WAIT).then(function () { toast(m, OW_LONG); }); }
function owOpenDeep() {
  var id = OW_DEEP, found = null;
  OW_DEEP = '';
  if (!id || !CAT || !CAT.catalog) return;
  try {
    if (/^[a-z]+\.[a-z-]+$/.test(id)) {
      owArr(CAT.catalog.categories).forEach(function (c) {
        owArr(c && c.templates).forEach(function (t) { if (t && t.id === id) found = t; });
      });
    }
    if (!found) { owDeepToast('That post template doesn\'t exist.'); return; }
    if (!found.available) {
      var need = owList(found.missing);
      owDeepToast('That post isn\'t available for this event yet' + (need ? ': it needs ' + need : '') + '.');
      return;
    }
    openEditor(found.id);
  } catch (e) { console.error('promo social: the post asked for', e); }
}

/* ---------- boot ---------- */
function owBoot() {
  if (!EVENT_ID) { $('content').innerHTML = '<div class="empty"><div class="big">No event</div>Open Promotions from an event.</div>'; return Promise.resolve(); }
  return Promise.resolve().then(function () { return openEvent(EVENT_ID); }).then(owOpenDeep, function (err) {
    console.error('promo social: the event page', err);
    $('content').innerHTML = '<div class="empty"><div class="big">Social posts could not be loaded</div>' + escapeHtml(owMessage(err) || 'Please try again.') +
      '<div style="margin-top:14px"><button class="btn" id="owBootAgain" type="button">Try again</button></div></div>';
    $('owBootAgain').onclick = function () { owBoot(); };
  });
}
if (window.ResizeObserver && $('content')) new ResizeObserver(function () { owReportHeight(); }).observe($('content'));
window.addEventListener('resize', function () { owReportHeight(); });
window.RevampAuth.whenResolved().then(owBoot, owBoot);
