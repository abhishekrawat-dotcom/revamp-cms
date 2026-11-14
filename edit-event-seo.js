/* Settings › URL & SEO in the event console (edit-event.html): every SEO field of ET's own event platform, in one
   section — the owner (6 Nov 2026): "keep everything in one section under settings -> seo", search and sharing only,
   never the site's own words.

   FOUR PARTS AND A CHECKLIST, each field saying where it comes from:
     1 Search listing   SEO title, meta description, keywords, H1 heading (ETB2B AI or typed), the canonical address
                        and indexing (automatic, the team may change them), the short link (not available: say so)
     2 Social sharing   the share title and description (the SEO title and description), the share picture (the
                        console's own Share picture panel, moved here from Basics), the square picture (none apart)
     3 Event schema     the schema.org Event: on or off, its title and description (ETB2B AI or typed), the dates and
                        venue (Basics), the attendance mode, street address, postcode, latitude and longitude (the
                        team), the city's state and country (the place list), the organiser and the logo (automatic)
     4 Rich results     speakers and FAQs (Content, picked here), testimonials (typed here, or brought in from the
                        previous edition — never written by AI), the rating (worked out), passes and prices (left out)
     Schema ready       what is complete and what is missing (functions/lib/api-seo.js readiness)
   with a live preview of the Google result and of the social card.

   HOW IT SAVES. The fields are a form with the console's save bar (Save changes / Discard), sent as the changed keys of
   settings.seo through PATCH /api/event. ETB2B AI ("Write with ETB2B AI", per field "Write again") writes and saves at
   once — the console's "do it, then undo": Undo saves what was there before. A field ETB2B AI wrote is marked as its
   own until somebody edits it. Nothing here changes a live site: a live page carries the values that were published
   with it, so the section says "Live after the next publish", lists what changed since the live version, and offers the
   console's own Publish (or Send for approval).

   The console hands this file its helpers (edit-event.html, CTX.seo): the share picture panel's two functions, its
   dialog, the publish action, the tab cache and the leave guard. ES5, no build step. */
(function (global) {
  'use strict';

  var C = global.RevampCore;
  var AI_FIELDS = ['title', 'description', 'keywords', 'h1', 'schemaTitle', 'schemaDescription'];
  var LABEL = { title: 'SEO title', description: 'Meta description', keywords: 'Keywords', h1: 'H1 heading', schemaTitle: 'Schema title',
    schemaDescription: 'Schema description', canonicalUrl: 'Canonical address', noindex: 'Indexing', streetAddress: 'Street address',
    postalCode: 'Postcode', latitude: 'Latitude', longitude: 'Longitude', attendanceMode: 'Attendance mode', basicSchema: 'Basic schema',
    advancedSchema: 'Advanced schema', speakersOff: 'Speakers', faqsOff: 'FAQs', testimonials: 'Testimonials' };
  /* the form's own fields (the share picture saves itself, as it always did; aiWritten and previous are bookkeeping) */
  var FORM = ['title', 'description', 'keywords', 'h1', 'canonicalUrl', 'noindex', 'basicSchema', 'schemaTitle', 'schemaDescription', 'attendanceMode',
    'streetAddress', 'postalCode', 'latitude', 'longitude', 'advancedSchema', 'speakersOff', 'faqsOff', 'testimonials'];
  var IDEAL = { title: 60, description: 160, h1: 70, schemaTitle: 90, schemaDescription: 300 };
  var MAX = { title: 70, description: 320, h1: 120, schemaTitle: 120, schemaDescription: 500 };

  /* the section's state, for the event on screen */
  var ST = { id: '', data: null, loading: false, error: '', F: null, B: null, aiBusy: '', undo: null, dropped: [], prev: null, prevBusy: false,
    canonOpen: false, saving: false, failed: '', seq: 0, ctx: null };

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }
  function norm(v) { return v === undefined ? null : v; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function line(v) { return str(v).replace(/\s+/g, ' ').trim(); }
  function esc(s) { return ST.ctx.esc(s == null ? '' : String(s)); }
  function svg(ic, n) { return ST.ctx.svg(ic, n); }
  function $(id) { return document.getElementById(id); }
  function uid() { return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function errText(err) { return (err && err.message) || 'Please try again.'; }

  /* the draft as the form keeps it: every form field present, defaults filled in */
  function formOf(seo) {
    seo = seo || {};
    return {
      title: str(seo.title), description: str(seo.description), keywords: Array.isArray(seo.keywords) ? seo.keywords.slice() : [], h1: str(seo.h1),
      canonicalUrl: str(seo.canonicalUrl), noindex: seo.noindex === true, basicSchema: seo.basicSchema !== false, schemaTitle: str(seo.schemaTitle),
      schemaDescription: str(seo.schemaDescription), attendanceMode: str(seo.attendanceMode), streetAddress: str(seo.streetAddress), postalCode: str(seo.postalCode),
      latitude: typeof seo.latitude === 'number' ? seo.latitude : null, longitude: typeof seo.longitude === 'number' ? seo.longitude : null,
      advancedSchema: seo.advancedSchema !== false, speakersOff: Array.isArray(seo.speakersOff) ? seo.speakersOff.slice() : [],
      faqsOff: Array.isArray(seo.faqsOff) ? seo.faqsOff.slice() : [], testimonials: clone(Array.isArray(seo.testimonials) ? seo.testimonials : []),
      aiWritten: Array.isArray(seo.aiWritten) ? seo.aiWritten.slice() : []
    };
  }
  function changedKeys() {
    if (!ST.F || !ST.B) return [];
    return FORM.filter(function (k) { return !same(ST.F[k], ST.B[k]); });
  }
  function dirty() { return changedKeys().length > 0; }

  /* ---------- loading ---------- */
  function load(keepForm) {
    var mine = ++ST.seq, ev = ST.ctx.EV;
    ST.loading = true; ST.error = '';
    return C.fetchSeo(ev.id).then(function (d) {
      if (mine !== ST.seq) return;
      ST.data = d;
      var fresh = formOf(d.seo);
      if (!keepForm || !ST.F) { ST.F = fresh; ST.B = clone(fresh); }
      else {
        /* the form keeps what is being typed: only what was saved is taken from the server */
        var typed = changedKeys(), was = ST.F;
        ST.B = clone(fresh);
        ST.F = clone(fresh);
        typed.forEach(function (k) { ST.F[k] = was[k]; });
      }
    }, function (err) {
      if (mine !== ST.seq) return;
      ST.error = errText(err);
    }).then(function () {
      if (mine !== ST.seq) return;
      ST.loading = false;
      if (onScreen()) ST.ctx.render();
    });
  }
  function onScreen() { return !!$('seo-root') || !!$('seo-loading'); }

  /* ---------- small pieces ---------- */
  var FROM_CLS = { ai: 'b-review', team: 'b-info', auto: 'b-mute', basics: 'b-ok', content: 'b-ok', none: 'b-warn' };
  function from(kind, text) { return '<span class="badge seo-src ' + (FROM_CLS[kind] || 'b-mute') + '">' + esc(text) + '</span>'; }
  function aiFrom(k) {
    var F = ST.F;
    var v = F[k], empty = Array.isArray(v) ? !v.length : !line(v);
    if (empty) return from('none', 'Not set');
    var written = (ST.B.aiWritten || []).indexOf(k) !== -1 && same(F[k], ST.B[k]);
    return written ? from('ai', 'ETB2B AI') : from('team', 'Team');
  }
  function aiButton(k) {
    var written = (ST.B.aiWritten || []).indexOf(k) !== -1 && same(ST.F[k], ST.B[k]);
    var busy = !!ST.aiBusy;
    return '<button class="btn btn-ghost btn-sm seo-ai-one" type="button" data-seo-ai="' + k + '"' + (busy ? ' disabled' : '') +
      ' aria-label="' + esc((written ? 'Write again: ' : 'Write with ETB2B AI: ') + LABEL[k]) + '">' + svg(ST.ctx.IC.star, 13) + ' ' + (written ? 'Write again' : 'Write with ETB2B AI') + '</button>';
  }
  function counter(k) {
    var n = k === 'keywords' ? ST.F.keywords.length : line(ST.F[k]).length;
    if (k === 'keywords') return '<span class="ctr seo-ctr' + (n && (n < 8 || n > 12) ? ' warn' : '') + '" id="seo-ctr-keywords">' + n + (n === 1 ? ' keyword' : ' keywords') + ' · 8 to 12 works best</span>';
    var ideal = IDEAL[k];
    return '<span class="ctr seo-ctr' + (n > ideal ? ' over' : n > ideal * 0.9 ? ' warn' : '') + '" id="seo-ctr-' + k + '">' + n + ' / ' + ideal + '</span>';
  }
  function row(label, value, src, extra) {
    return '<div class="seo-row"><div class="seo-k">' + esc(label) + (src || '') + '</div><div class="seo-v">' + value + (extra || '') + '</div></div>';
  }
  function fieldText(k, label, opts) {
    opts = opts || {};
    var id = 'seo-' + k, v = ST.F[k];
    var input = opts.area
      ? '<textarea class="inp" id="' + id + '" data-seo-field="' + k + '" rows="3" maxlength="' + MAX[k] + '" aria-describedby="' + id + '-hint" placeholder="' + esc(opts.placeholder || '') + '">' + esc(v) + '</textarea>'
      : '<input class="inp" id="' + id + '" data-seo-field="' + k + '" maxlength="' + MAX[k] + '" value="' + esc(v) + '" aria-describedby="' + id + '-hint" placeholder="' + esc(opts.placeholder || '') + '">';
    return '<div class="field c12 seo-field" data-seo-wrap="' + k + '"><div class="flabel-row"><label for="' + id + '">' + esc(label) + '</label>' + aiFrom(k) +
      '<span class="seo-sp"></span>' + counter(k) + aiButton(k) + '</div>' + input +
      '<p class="hint" id="' + id + '-hint">' + opts.hint + '</p>' + droppedNote(k) + '</div>';
  }
  function droppedNote(k) {
    var d = (ST.dropped || []).filter(function (x) { return x.field === k; })[0];
    return d ? '<p class="field-over seo-dropped" role="status">ETB2B AI ' + esc(d.why) + '. Write it again, or type it.</p>' : '';
  }
  function toggle(id, on, label, attrs) {
    return '<button type="button" class="tgl" id="' + id + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (attrs || '') + '><span class="track"><i></i></span><span>' + esc(label) + '</span></button>';
  }
  function linkTo(route, text) { return '<a href="#' + route + '" data-goto="' + route + '">' + esc(text) + '</a>'; }
  function stars(n) {
    if (!n) return '<span class="seo-none">No rating</span>';
    var s = '';
    for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆';
    return '<span class="seo2-stars" role="img" aria-label="' + n + ' out of 5 stars">' + s + '</span>';
  }

  /* ---------- the view ---------- */
  function view(ctx) {
    ST.ctx = ctx;
    var ev = ctx.EV;
    if (ST.id !== ev.id) { ST.id = ev.id; ST.data = null; ST.F = null; ST.B = null; ST.undo = null; ST.prev = null; ST.dropped = []; }
    var head = ctx.vhead('URL & SEO', 'What search engines and link previews read about this event, and where each part comes from. Only search and sharing are set here: the site’s own words are edited in the site editor.',
      ST.data ? actionsHtml() : '');
    if (!ST.data) {
      if (!ST.loading && !ST.error) setTimeout(function () { if (!ST.data && !ST.loading) load(false); }, 0);
      if (ST.error) {
        return head + ctx.panel('Search and sharing', '', '<div class="callout" role="alert">' + svg(ctx.IC.info, 15) + '<span>The search and sharing settings could not be loaded: ' + esc(ST.error) + '</span></div>' +
          '<p style="margin:12px 0 0"><button class="btn btn-secondary btn-sm" type="button" data-seo="reload">Try again</button></p>');
      }
      return head + '<div id="seo-loading" class="seo-lead" aria-busy="true">Loading the search and sharing settings…</div>';
    }
    return head + '<div id="seo-root">' + statusHtml() + aiStatusHtml() +
      '<div class="bx seo-bx"><div class="bx-main">' + searchHtml() + socialHtml() + schemaHtml() + richHtml() + '</div>' +
      '<aside class="bx-side">' + previewHtml() + readyHtml() + '</aside></div>' + saveBarHtml() + '</div>';
  }

  function actionsHtml() {
    var busy = !!ST.aiBusy;
    return '<button class="btn btn-primary btn-sm" type="button" data-seo="ai-all"' + (busy ? ' disabled' : '') + '>' + svg(ST.ctx.IC.star, 13) + ' Write with ETB2B AI</button>' +
      '<button class="btn btn-secondary btn-sm" type="button" data-seo="prev"' + (ST.prevBusy ? ' disabled' : '') + '>' + (ST.prevBusy ? 'Reading the previous edition…' : 'Bring in from the previous edition') + '</button>';
  }

  /* going live: what the next publish changes, and the console's own way to publish */
  function statusHtml() {
    var d = ST.data, ev = ST.ctx.EV, body;
    var pend = d.pending, changes = d.changes || [];
    if (!d.live.published) {
      body = '<p class="seo-lead"><b>Not live yet.</b> The site carries all of this when it is first published.</p>';
    } else if (!changes.length && !dirty()) {
      body = '<p class="seo-lead"><b>Everything here is live.</b> A change you make here reaches the live site with the next publish' + (d.approvalRequired ? ', once it is approved' : '') + '.</p>';
    } else {
      var list = changes.slice(0, 8).map(function (c) {
        return '<li><b>' + esc(c.label) + '</b>' + (c.after ? ': ' + esc(c.after.slice(0, 120)) : ': removed') + '</li>';
      }).join('');
      var act = dirty() ? '<span class="seo-n">Save your changes first, then send them.</span>'
        : pend && pend.seoSame ? '<a class="btn btn-secondary btn-sm" href="' + esc(pend.reviewPath) + '">Open the review</a>'
        : '<button class="btn btn-primary btn-sm" type="button" data-seo="publish">' + (d.approvalRequired ? (pend ? 'Send again for approval' : 'Send for approval') : 'Publish now') + '</button>';
      body = '<p class="seo-lead"><b>Live after the next publish.</b> ' + (changes.length ? changes.length + (changes.length === 1 ? ' change' : ' changes') + ' since the live version' : 'Your unsaved changes') +
        (pend ? (pend.seoSame ? ' are waiting for approval.' : ': a request is waiting, but changes made since it was sent are not in it.') : '.') + '</p>' +
        (list ? '<ul class="seo-changes">' + list + (changes.length > 8 ? '<li>and ' + (changes.length - 8) + ' more</li>' : '') + '</ul>' : '') +
        '<div class="seo-acts">' + act + '</div>';
    }
    return '<div class="seo-status" role="status">' + body + '</div>';
  }
  function aiStatusHtml() {
    var s = '';
    if (ST.aiBusy) s = '<span class="spin"></span> ' + esc(ST.aiBusy);
    else if (ST.undo) s = esc(ST.undo.said) + ' <button class="btn btn-secondary btn-sm" type="button" data-seo="undo">Undo</button>';
    return '<div class="seo-ai-status" id="seo-ai-status" role="status" aria-live="polite"' + (s ? '' : ' hidden') + '>' + s + '</div>';
  }

  function searchHtml() {
    var d = ST.data, F = ST.F, a = d.auto, prevKw = ST.prev && ST.prev.seo && ST.prev.seo.keywords && ST.prev.seo.keywords.length ? ST.prev.seo.keywords : null;
    var chips = F.keywords.map(function (k, i) {
      return '<span class="seo-chip">' + esc(k) + '<button type="button" data-seo-kw-x="' + i + '" aria-label="Remove the keyword ' + esc(k) + '">×</button></span>';
    }).join('');
    var kw = '<div class="field c12 seo-field" data-seo-wrap="keywords"><div class="flabel-row"><label for="seo-kw-in">Keywords</label>' + aiFrom('keywords') +
      '<span class="seo-sp"></span>' + counter('keywords') + aiButton('keywords') + '</div>' +
      '<div class="seo-chips" id="seo-kw-list" aria-label="Keywords">' + (chips || '<span class="seo-none">None yet</span>') + '</div>' +
      '<div class="seo-kw-add"><input class="inp" id="seo-kw-in" placeholder="Type a keyword, then Enter" maxlength="60" aria-describedby="seo-kw-hint"' + (F.keywords.length >= 15 ? ' disabled' : '') + '>' +
      '<button class="btn btn-secondary btn-sm" type="button" data-seo="kw-add"' + (F.keywords.length >= 15 ? ' disabled' : '') + '>Add</button></div>' +
      '<p class="hint" id="seo-kw-hint">Phrases people search for: the event, its subject, its audience, its city. Up to 15.' +
      (prevKw ? ' The previous edition used: <span class="seo-ref">' + esc(prevKw.join(', ')) + '</span> (ETB2B AI reads these as a reference, with this edition’s year).' : '') + '</p>' + droppedNote('keywords') + '</div>';

    var h1Hint = a.h1 && a.h1.own
      ? 'The site has its own main heading, “' + esc(a.h1.own.slice(0, 90)) + '”: search engines read that one, and this is used only if the site has none.'
      : 'The page’s main heading for search engines. It is not shown on the page (its banner shows the logo); without it, the event’s name is used.';
    var canon = F.canonicalUrl || ST.canonOpen
      ? '<div class="seo-inline"><input class="inp" id="seo-canonicalUrl" data-seo-field="canonicalUrl" type="url" maxlength="500" value="' + esc(F.canonicalUrl) + '" placeholder="https://…" aria-label="Canonical address">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-seo="canon-auto">Use the site’s own</button></div>' +
        '<p class="hint">Only when the event’s page of record is somewhere else: search engines then list that address instead.</p>'
      : '<span class="num">' + esc(a.url) + '</span> <button class="btn btn-ghost btn-sm" type="button" data-seo="canon-own">Use another address</button>';
    var idx = '<span>' + esc(a.indexing.text) + '</span><div style="margin-top:8px">' + toggle('seo-noindex', F.noindex, 'Keep this site out of search engines') + '</div>' +
      '<p class="hint">The site stays open to anyone with its address; search engines are asked not to list it, and the sitemap leaves it out.</p>';
    return ST.ctx.panel('1 · Search listing', 'What a search result shows', '<div class="frow">' +
      fieldText('title', 'SEO title', { hint: 'The title of the search result and of a shared link. About 60 characters; the event’s name is used without one.', placeholder: a.title }) +
      fieldText('description', 'Meta description', { area: true, hint: 'The lines under the title in a search result, and under a shared link. 120 to 160 characters reads best.', placeholder: d.head.description || 'One or two sentences: what it is, for whom, when and where.' }) +
      kw +
      fieldText('h1', 'H1 heading', { hint: h1Hint, placeholder: a.title }) +
      '</div><div class="seo-rows">' +
      row('Canonical address', canon, F.canonicalUrl ? from('team', 'Team') : from('auto', 'Auto'), '') +
      row('Indexing', idx, F.noindex ? from('team', 'Team') : from('auto', 'Auto')) +
      row('Short link', '<span class="seo-none">Not available.</span> <span class="seo-n">ETB2B’s short links (such as ethrworld.com/s/…) are made by ETB2B’s own link shortener, which EventSphere cannot use. The site’s own address is used everywhere.</span>', from('none', 'Not available')) +
      '</div>');
  }

  function socialHtml() {
    var d = ST.data, F = ST.F;
    var title = line(F.title) || d.auto.title, desc = line(F.description) || d.head.description;
    var share = ST.ctx.seo && ST.ctx.seo.sharePictureField ? ST.ctx.seo.sharePictureField(ST.ctx.EV) : '';
    return ST.ctx.panel('2 · Social sharing', 'What a link to the site shows on WhatsApp, LinkedIn and X', '<div class="seo-rows">' +
      row('Share title', esc(title) || '<span class="seo-none">None</span>', from('auto', 'Auto'), '<p class="hint">The SEO title (the event’s name without one).</p>') +
      row('Share description', esc(desc) || '<span class="seo-none">None</span>', from('auto', 'Auto'), '<p class="hint">The meta description (Basics’ short description without one).</p>') +
      '</div><div class="seo-sub"><div class="flabel-row"><span class="flabel">Share picture</span>' + (str(ST.ctx.EV.settings && ST.ctx.EV.settings.seo && ST.ctx.EV.settings.seo.shareImageUrl) ? from('team', 'Team') : from('auto', 'Auto')) + '</div><div class="frow">' + share + '</div></div>' +
      '<div class="seo-rows">' + row('Square picture', '<span class="seo-n">No separate square picture. Where a link is shown as a square (WhatsApp), the centre of the share picture is used.</span>', from('auto', 'Auto')) + '</div>');
  }

  /* ---------- Advanced: the event's details and its rich results (the two panels of the "Advanced" fold) ----------
     Neat and calm (the owner, 14 Nov 2026: "too noisy, it should be neat and clean"): what is filled in for the team
     reads as quiet facts with one line saying where they come from, the few fields the team may add sit under them,
     and speakers, FAQs and testimonials are tidy rows to tick. A value's source and a warning are one muted line
     each, never a coloured pill; the structured data the next publish gives follows, folded. */
  /* the words ETB2B AI's messages use for this part's two fields ("ETB2B AI wrote … and saved them") */
  LABEL.schemaTitle = 'Event name for search engines';
  LABEL.schemaDescription = 'Event description for search engines';

  /* one muted line under a field, a list or a switch: where a value comes from, what is used without one, or (warn)
     what is left out and why. html: already escaped */
  function richNote(html, id, warn) {
    return '<p class="seo2-hint"' + (id ? ' id="' + id + '"' : '') + '>' +
      (warn ? '<span class="seo2-ico" aria-hidden="true">' + svg(ST.ctx.IC.info, 13) + '</span>' : '') + '<span>' + html + '</span></p>';
  }
  /* a text field of this part: its label with the count and ETB2B AI's small button on the right, the field, then
     one muted line (ETB2B AI's, when it wrote what is there; else what is used while it is empty) */
  function richField(k, label, opts) {
    var id = 'seo-' + k, v = ST.F[k];
    var aiOwn = (ST.B.aiWritten || []).indexOf(k) !== -1 && same(ST.F[k], ST.B[k]);
    var note = aiOwn ? 'Suggested by ETB2B AI.' : !line(v) ? opts.empty : '';
    var attrs = ' id="' + id + '" data-seo-field="' + k + '" maxlength="' + MAX[k] + '"' + (note ? ' aria-describedby="' + id + '-hint"' : '') +
      ' placeholder="' + esc(opts.placeholder || '') + '"';
    var input = opts.area ? '<textarea class="inp" rows="3"' + attrs + '>' + esc(v) + '</textarea>' : '<input class="inp"' + attrs + ' value="' + esc(v) + '">';
    return '<div class="field c12" data-seo-wrap="' + k + '"><div class="seo2-lrow"><label for="' + id + '">' + esc(label) + '</label>' + counter(k) +
      '<button class="btn btn-ghost btn-sm" type="button" data-seo-ai="' + k + '"' + (ST.aiBusy ? ' disabled' : '') + ' aria-label="' +
        esc((aiOwn ? 'Suggest again with ETB2B AI: ' : 'Suggest with ETB2B AI: ') + LABEL[k]) + '">' + svg(ST.ctx.IC.star, 13) + (aiOwn ? ' Suggest again' : ' Suggest with ETB2B AI') + '</button></div>' +
      input + (note ? richNote(esc(note), id + '-hint') : '') + droppedNote(k) + '</div>';
  }
  function richHead(title, right) { return '<div class="seo2-head"><h4>' + esc(title) + '</h4>' + (right || '') + '</div>'; }
  function richRow(inner, state) { return '<li class="seo2-row">' + inner + '<span class="seo2-state">' + esc(state) + '</span></li>'; }
  /* a list of rows; a long one shows its first six and folds the rest under "Show N more" (kept open across redraws) */
  function richRows(rows, key, noun) {
    var more = ST.more || (ST.more = {});
    if (rows.length <= 7) return '<ul class="seo2-rows">' + rows.join('') + '</ul>';
    return '<ul class="seo2-rows">' + rows.slice(0, 6).join('') + '</ul><details class="seo2-more" data-seo-more="' + key + '"' + (more[key] ? ' open' : '') + '>' +
      '<summary><span class="seo2-more-show">Show ' + (rows.length - 6) + ' more ' + esc(noun) + '</span><span class="seo2-more-hide">Show fewer</span></summary>' +
      '<ul class="seo2-rows">' + rows.slice(6).join('') + '</ul></details>';
  }
  /* "Show N more" is a <details>: whether it is open is kept here, so a redraw (a tick, a save) does not fold it again */
  function wireRich(root) {
    root.addEventListener('toggle', function (e) {
      var k = e.target && e.target.getAttribute && e.target.getAttribute('data-seo-more');
      if (k) (ST.more || (ST.more = {}))[k] = e.target.open;
    }, true);
  }

  function schemaHtml() {
    var d = ST.data, F = ST.F, a = d.auto, M = ST.ctx.seo;
    var exact = a.dates.exact, on = exact && F.basicSchema;
    var sw = '<div class="seo2-switch">' + toggle('seo-basicSchema', on, 'Give search engines the event’s details', exact ? '' : ' disabled aria-describedby="seo-basic-why"') +
      (exact ? '' : richNote('Not while the date is to be announced: search engines list an event by its exact date. Set the dates in ' + linkTo('content/basics', 'Basics') + '.', 'seo-basic-why')) + '</div>';

    /* filled in for the team: from Basics, the place list and the event's portal */
    var faint = function (t) { return '<span class="seo2-faint">' + esc(t) + '</span>'; };
    var place = a.place ? esc(a.place.label) : a.city ? esc(a.city) + ' ' + faint('· its state and country are not known') : faint('No city yet');
    var org = esc(a.organizer.name) + (a.organizer.url ? ' ' + faint(a.organizer.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')) : '') + (a.organizer.portal ? '' : ' ' + faint('· no portal yet'));
    var logo = a.logo ? '<span class="seo2-logo">' + (M && M.imgTag ? M.imgTag(a.logo.url) : '') + '</span><span>The ' + esc(a.logo.from) + '</span>' : faint('None yet');
    var facts = '<dl class="seo2-facts">' +
      '<dt>Dates</dt><dd>' + esc(a.dates.label || 'To be announced') + '</dd>' +
      '<dt>Venue</dt><dd>' + (a.venue ? esc(a.venue) : faint('None yet')) + '</dd>' +
      '<dt>City</dt><dd>' + place + '</dd>' +
      '<dt>Organiser</dt><dd>' + org + '</dd>' +
      '<dt>Logo</dt><dd class="seo2-logo-dd">' + logo + '</dd></dl>' +
      richNote('Filled in from Basics and the event’s portal. ' + linkTo('content/basics', 'Change them in Basics'));

    /* the few the team may add */
    var text = richField('schemaTitle', 'Event name', { placeholder: a.title, empty: 'Left empty, the event’s name is used.' }) +
      richField('schemaDescription', 'Event description', { area: true, placeholder: 'Two or three sentences for an event listing.', empty: 'Left empty, the description in Google is used.' });
    var pv = ST.prev && ST.prev.sameVenue && ST.prev.previous && ST.prev.previous.seo.streetAddress && ST.prev.previous.seo.streetAddress !== F.streetAddress ? ST.prev.previous.seo : null;
    var mode = '<select class="inp" id="seo-attendanceMode" data-seo-field="attendanceMode">' +
      [['', 'Automatic: ' + (a.attendanceAuto === 'offline' ? 'in person (it has a venue)' : 'not said (no venue yet)')], ['offline', 'In person'], ['online', 'Online'], ['mixed', 'In person and online']].map(function (o) {
        return '<option value="' + o[0] + '"' + (F.attendanceMode === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    var where = '<div class="field c8"><label for="seo-streetAddress">Street address</label>' +
        '<input class="inp" id="seo-streetAddress" data-seo-field="streetAddress" maxlength="200" value="' + esc(F.streetAddress) + '" placeholder="e.g. National Highway 8, Ambience Island, DLF Phase 3">' +
        (pv ? richNote('The previous edition at this venue gave “' + esc(pv.streetAddress) + (pv.postalCode ? ', ' + esc(pv.postalCode) : '') + '”. ' +
          '<button class="btn btn-ghost btn-sm" type="button" data-seo="use-prev-address">Use it</button>') : '') + '</div>' +
      '<div class="field c4"><label for="seo-postalCode">Postcode</label>' +
        '<input class="inp" id="seo-postalCode" data-seo-field="postalCode" maxlength="12" inputmode="text" value="' + esc(F.postalCode) + '" placeholder="e.g. 122010"></div>' +
      '<div class="field c6"><label for="seo-attendanceMode">How people attend</label>' + mode + '</div>' +
      '<div class="field c6"><span class="flabel" id="seo-geo-label">Latitude and longitude</span><div class="seo2-pair">' +
        '<div><input class="inp" id="seo-latitude" data-seo-field="latitude" inputmode="decimal" value="' + (F.latitude == null ? '' : esc(String(F.latitude))) + '" placeholder="28.5022" aria-label="Latitude" aria-describedby="seo-geo-hint"></div>' +
        '<div><input class="inp" id="seo-longitude" data-seo-field="longitude" inputmode="decimal" value="' + (F.longitude == null ? '' : esc(String(F.longitude))) + '" placeholder="77.0969" aria-label="Longitude" aria-describedby="seo-geo-hint"></div>' +
        '</div>' + richNote('Optional: both or neither, to put the venue on a map.', 'seo-geo-hint') + '</div>';

    return ST.ctx.panel('Event details for search engines', '', '<div class="seo2-rich">' + sw +
      '<div class="seo2-body' + (on ? '' : ' seo2-off') + '"><div class="seo2-group">' + facts + '</div>' +
      '<div class="seo2-group frow">' + text + '</div><div class="seo2-group frow">' + where + '</div></div></div>');
  }

  function richHtml() {
    var d = ST.data, F = ST.F, adv = F.advancedSchema, n;
    var sp = d.speakers.map(function (s) {
      var on = F.speakersOff.indexOf(s.id) === -1, id = 'seo-sp-' + s.id, who = [s.role, s.company].filter(Boolean).join(' · ');
      return richRow('<input type="checkbox" id="' + id + '" data-seo-sp="' + esc(s.id) + '"' + (on && s.confirmed ? ' checked' : '') + (s.confirmed ? '' : ' disabled') + '>' +
        '<label for="' + id + '"><b>' + esc(s.name || 'No name') + '</b>' + (who ? '<span>' + esc(who) + '</span>' : '') + '</label>',
        !s.confirmed ? 'Not confirmed' : s.shown ? 'On the site' : 'Not on the site');
    });
    var fq = d.faqs.map(function (f) {
      var on = F.faqsOff.indexOf(f.id) === -1, id = 'seo-fq-' + f.id;
      return richRow('<input type="checkbox" id="' + id + '" data-seo-fq="' + esc(f.id) + '"' + (on ? ' checked' : '') + '>' +
        '<label for="' + id + '"><b>' + esc(f.question) + '</b>' + (f.answer ? '<span class="seo2-clip">' + esc(f.answer.slice(0, 160)) + '</span>' : '') + '</label>',
        !f.answer ? 'No answer' : f.shown ? 'On the site' : 'Not on the site');
    });
    var ts = F.testimonials.map(function (t, i) {
      var shown = d.testimonials[t.id], id = 'seo-tm-' + t.id, who = [t.role, t.company].filter(Boolean).join(', ');
      var state = t.off ? 'Left out' : !shown ? 'Not saved yet' : shown.shown ? 'On the site' : 'Not on the site';
      return '<li class="seo2-row seo2-trow"><input type="checkbox" id="' + id + '" data-seo-tm-on="' + i + '"' + (t.off ? '' : ' checked') + ' aria-label="Include ' + esc(t.name) + '’s testimonial">' +
        '<div class="seo2-tmain"><div class="seo2-twho"><label for="' + id + '"><b>' + esc(t.name) + '</b>' + (who ? '<span>' + esc(who) + '</span>' : '') + '</label>' + (t.rating ? stars(t.rating) : '') + '</div>' +
          '<p class="seo2-quote">' + (t.title ? '<b>' + esc(t.title) + '</b> ' : '') + esc(t.text) + '</p>' +
          '<p class="seo2-meta">' + esc((t.from === 'previous' ? 'From the previous edition · ' : '') + state) + '</p></div>' +
        '<span class="seo2-tacts"><button class="btn btn-ghost btn-sm" type="button" data-seo-tm-edit="' + i + '" aria-label="Edit ' + esc(t.name) + '’s testimonial">Edit</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-seo-tm-x="' + i + '" aria-label="Remove ' + esc(t.name) + '’s testimonial">Remove</button></span></li>';
    });
    /* left out because the site does not show them (search engines require what they are given to be on the page) */
    var notShownT = F.testimonials.filter(function (t) { return !t.off && d.testimonials[t.id] && !d.testimonials[t.id].shown; }).length;
    var notShownF = d.faqs.filter(function (f) { return f.counts && !f.shown && F.faqsOff.indexOf(f.id) === -1; }).length;
    function leftOut(n, one, many, section) {
      return richNote(n + ' ' + (n === 1 ? one + ' is' : many + ' are') + ' not shown on the site, so ' + (n === 1 ? 'it is' : 'they are') + ' left out. Add ' + section + ' in the ' +
        linkTo('design/editor', 'site editor') + ' to show ' + (n === 1 ? 'it' : 'them') + '.', '', true);
    }

    var speakers = '<div class="seo2-group">' + richHead('Speakers', sp.length ? linkTo('content/speakers', 'Edit in Content › Speakers') : '') +
      (sp.length ? richRows(sp, 'sp', 'speakers') : richNote('No speakers in ' + linkTo('content/speakers', 'Content › Speakers') + ' yet.')) + '</div>';
    var faqs = '<div class="seo2-group">' + richHead('FAQs', fq.length ? linkTo('content/faq', 'Edit in Content › FAQ') : '') +
      (fq.length ? richRows(fq, 'fq', 'FAQs') + (notShownF ? leftOut(notShownF, 'FAQ', 'FAQs', 'an FAQ section') : '')
        : richNote('No FAQs in ' + linkTo('content/faq', 'Content › FAQ') + ' yet. ETB2B AI can draft five or six from the event’s details and add them there, for you to check.') +
          '<div class="seo2-acts"><button class="btn btn-secondary btn-sm" type="button" data-seo="faq-draft"' + (ST.aiBusy ? ' disabled' : '') + '>' + svg(ST.ctx.IC.star, 13) + ' Draft FAQs with ETB2B AI</button></div>') + '</div>';
    n = F.testimonials.length;
    var tms = '<div class="seo2-group">' + richHead('Testimonials', '') +
      (n ? '<ul class="seo2-rows">' + ts.join('') + '</ul>' : richNote('None yet. Add what people who were there said, in their own words, or bring them in from the previous edition.')) +
      (notShownT ? leftOut(notShownT, 'testimonial', 'testimonials', 'a testimonials section') : '') +
      '<div class="seo2-acts"><button class="btn btn-secondary btn-sm" type="button" data-seo="tm-add"' + (n >= 30 ? ' disabled aria-describedby="seo-tm-max"' : '') + '>Add a testimonial</button>' +
        '<button class="btn btn-secondary btn-sm" type="button" data-seo="prev-tm"' + (ST.prevBusy ? ' disabled' : '') + '>' + (ST.prevBusy ? 'Reading the previous edition…' : 'Bring in from the previous edition') + '</button>' +
        (n >= 30 ? '<span class="seo2-faint" id="seo-tm-max">30 is the most.</span>' : '') + '</div></div>';
    var rating = '<div class="seo2-group"><dl class="seo2-facts"><dt>Rating</dt><dd>' + ratingNow().text + '</dd>' +
      '<dt>Passes and prices</dt><dd><span class="seo2-faint">Not given</span></dd></dl>' +
      richNote('The rating is worked out from the testimonials the site shows, never typed. Prices are left out until the site shows passes.') + '</div>';

    return ST.ctx.panel('Speakers, FAQs and reviews in Google', '', '<div class="seo2-rich">' +
      '<div class="seo2-switch">' + toggle('seo-advancedSchema', adv, 'Give search engines the speakers, FAQs and reviews', ' aria-describedby="seo-adv-why"') +
        richNote('Only what the site itself shows is given.', 'seo-adv-why') + '</div>' +
      '<div class="seo2-body' + (adv ? '' : ' seo2-off') + '">' + speakers + faqs + tms + rating + '</div></div>') + structuredHtml();
  }
  /* the rating as it would be given: the included testimonials whose words the site shows (as last saved), with a rating */
  function ratingNow() {
    var d = ST.data, list = ST.F.testimonials.filter(function (t) { return !t.off && t.rating && d.testimonials[t.id] && d.testimonials[t.id].shown; });
    if (!list.length) return { text: '<span class="seo2-faint">None yet: no testimonial with a rating is on the site</span>' };
    var sum = list.reduce(function (a, t) { return a + t.rating; }, 0), avg = Math.round(sum / list.length * 10) / 10;
    return { text: '<b>' + avg + '</b> ' + stars(Math.round(avg)) + ' <span class="seo2-faint">from ' + list.length + (list.length === 1 ? ' rating' : ' ratings') + '</span>' };
  }
  /* what the next publish gives search engines, as they read it (the page's structured data), folded under the panels */
  function structuredHtml() {
    var s = ST.data.schema, list = [s.event, s.faq].filter(Boolean);
    if (!list.length) return '<p class="seo2-ld seo2-hint">What search engines read: nothing yet.</p>';
    return '<details class="seo2-ld"><summary>What search engines read <span>structured data</span></summary><pre>' + esc(JSON.stringify(list, null, 2)) + '</pre></details>';
  }

  function previewHtml() {
    var d = ST.data, F = ST.F;
    var title = line(F.title) || d.auto.title || 'Untitled event';
    var desc = line(F.description) || d.head.description || '';
    var shownDesc = desc.length > 158 ? desc.slice(0, 157).replace(/\s+\S*$/, '') + ' …' : desc;
    var url = line(F.canonicalUrl) || d.auto.url;
    var where = url.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/\//g, ' › ');
    var dom = url.replace(/^https?:\/\//, '').split('/')[0];
    var pic = d.head.ogImage && ST.ctx.seo && ST.ctx.seo.imgTag ? ST.ctx.seo.imgTag(d.head.ogImage) : '';
    var ld = d.schema.event || d.schema.faq ? '<details class="seo-ld"><summary>What search engines read (structured data)</summary><pre>' +
      esc(JSON.stringify([d.schema.event, d.schema.faq].filter(Boolean), null, 2)) + '</pre></details>' : '<p class="seo-n">No structured data yet.</p>';
    return '<div class="pvc"><div class="pvc-head"><span class="eyebrow">Google result</span></div><div class="pvc-body"><div class="mock mock-serp">' +
        '<div class="u" id="seo-pv-url">' + esc(where) + '</div><div class="t" id="seo-pv-title">' + esc(title) + '</div><div class="d" id="seo-pv-desc">' + esc(shownDesc) + '</div></div></div>' +
        '<div class="pvc-foot">Roughly how a search result shows it.</div></div>' +
      '<div class="pvc"><div class="pvc-head"><span class="eyebrow">Social card</span></div><div class="pvc-body"><div class="mock mock-og seo-og">' +
        '<div class="img seo-og-img">' + (pic || '<span class="md">No picture: the card shows words only</span>') + '</div>' +
        '<div class="cap"><span class="dom">' + esc(dom) + '</span><b id="seo-og-title">' + esc(title) + '</b><span id="seo-og-desc">' + esc(shownDesc) + '</span></div></div></div>' +
        '<div class="pvc-foot">What a WhatsApp, LinkedIn or X share unfurls into. The picture is the one the live page gives' + (d.live.published ? '' : ' once published') + '.</div></div>' +
      '<div class="pvc"><div class="pvc-body">' + ld + '</div></div>';
  }

  function readyHtml() {
    var items = ST.data.ready || [];
    var groups = [['search', 'Search listing'], ['sharing', 'Social sharing'], ['schema', 'Event schema'], ['rich', 'Rich results']];
    var done = items.filter(function (i) { return i.ok; }).length, all = items.filter(function (i) { return i.level !== 'info'; }).length;
    var body = groups.map(function (g) {
      var mine = items.filter(function (i) { return i.group === g[0]; });
      if (!mine.length) return '';
      return '<div class="seo-rg"><div class="seo-rg-h">' + esc(g[1]) + '</div>' + mine.map(function (i) {
        return '<div class="seo-check"><span class="dash-dot dash-dot-' + (i.ok ? 'ok' : i.level === 'info' ? 'mute' : 'warn') + '" aria-hidden="true"></span><span><b>' + esc(i.label) +
          '<span class="rv-sr"> — ' + (i.ok ? 'complete' : i.level === 'info' ? 'note' : 'missing') + '</span></b><span>' + esc(i.text) + '</span></span></div>';
      }).join('') + '</div>';
    }).join('');
    return '<div class="pvc"><div class="pvc-head"><span class="eyebrow">Schema ready</span><span class="ctr">' + done + ' / ' + all + '</span></div>' +
      '<div class="pvc-body">' + (dirty() ? '<p class="seo-n">As last saved: save to check your changes.</p>' : '') + body + '</div></div>';
  }

  function saveBarHtml() {
    var n = changedKeys().length;
    return '<div class="savebar' + (n ? ' on' : '') + (ST.failed ? ' failed' : '') + '" id="seo-savebar">' +
      '<span class="sb-txt" id="seo-sbtxt" role="' + (ST.failed ? 'alert' : 'status') + '"><b id="seo-sbhead">' + (ST.failed ? 'Not saved' : 'Unsaved changes') + '</b><span id="seo-sbwhat">' +
      esc(ST.failed || (n === 1 ? '1 field edited' : n + ' fields edited')) + '</span></span>' +
      '<button class="sb-ghost" type="button" id="seo-discard"' + (ST.saving ? ' disabled' : '') + '>Discard</button>' +
      '<button class="btn btn-primary btn-sm" type="button" id="seo-save"' + (ST.saving ? ' disabled' : '') + '>' + (ST.saving ? '<span class="spin"></span> Saving' : ST.failed ? 'Try again' : 'Save changes') + '</button></div>';
  }

  /* ---------- in place, while typing (nothing is redrawn under the cursor) ---------- */
  function paintLive() {
    if (!$('seo-root')) return;
    var d = ST.data, F = ST.F;
    ['title', 'description', 'h1', 'schemaTitle', 'schemaDescription'].forEach(function (k) {
      var c = $('seo-ctr-' + k);
      if (c) { var n = line(F[k]).length, ideal = IDEAL[k]; c.textContent = n + ' / ' + ideal; c.className = 'ctr seo-ctr' + (n > ideal ? ' over' : n > ideal * 0.9 ? ' warn' : ''); }
    });
    var title = line(F.title) || d.auto.title || 'Untitled event', desc = line(F.description) || d.head.description || '';
    var shownDesc = desc.length > 158 ? desc.slice(0, 157).replace(/\s+\S*$/, '') + ' …' : desc;
    var url = line(F.canonicalUrl) || d.auto.url;
    [['seo-pv-title', title], ['seo-pv-desc', shownDesc], ['seo-og-title', title], ['seo-og-desc', shownDesc],
      ['seo-pv-url', url.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/\//g, ' › ')]].forEach(function (p) { var el = $(p[0]); if (el) el.textContent = p[1]; });
    var bar = $('seo-savebar');
    if (bar) {
      var n2 = changedKeys().length;
      bar.classList.toggle('on', n2 > 0);
      bar.classList.toggle('failed', n2 > 0 && !!ST.failed);
      var w = $('seo-sbwhat'); if (w) w.textContent = ST.failed || (n2 === 1 ? '1 field edited' : n2 + ' fields edited');
      var h = $('seo-sbhead'); if (h) h.textContent = ST.failed ? 'Not saved' : 'Unsaved changes';
    }
  }
  function redraw() { if (onScreen()) ST.ctx.render(); }

  /* ---------- saving ---------- */
  function numberOf(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function problems() {
    var F = ST.F, errs = [];
    if (F.canonicalUrl && !/^https?:\/\/[^\s"'<>]+$/i.test(F.canonicalUrl.trim())) errs.push(['seo-canonicalUrl', 'Give a web address starting with https://, or use the site’s own.']);
    if (F.postalCode && !/^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(F.postalCode.trim())) errs.push(['seo-postalCode', 'Letters, digits, spaces and hyphens, up to 12.']);
    else if (F.postalCode && (!ST.data.auto.place || ST.data.auto.place.countryCode === 'IN') && !/^[1-9][0-9]{5}$/.test(F.postalCode.trim())) errs.push(['seo-postalCode', 'An Indian postcode has 6 digits (for example 122010).']);
    if (typeof F.latitude === 'number' && (isNaN(F.latitude) || F.latitude < -90 || F.latitude > 90)) errs.push(['seo-latitude', 'A latitude is a number from -90 to 90.']);
    if (typeof F.longitude === 'number' && (isNaN(F.longitude) || F.longitude < -180 || F.longitude > 180)) errs.push(['seo-longitude', 'A longitude is a number from -180 to 180.']);
    if ((F.latitude == null) !== (F.longitude == null)) errs.push([F.latitude == null ? 'seo-latitude' : 'seo-longitude', 'Give both the latitude and the longitude, or neither.']);
    return errs;
  }
  function save() {
    if (ST.saving) return Promise.reject(new Error('A save is already under way.'));
    var keys = changedKeys();
    if (!keys.length) return Promise.resolve();
    var errs = problems();
    if (errs.length) return Promise.reject({ fields: errs });
    var patch = {}, F = ST.F, B = ST.B;
    keys.forEach(function (k) { patch[k] = clone(F[k]); });
    ['title', 'description', 'h1', 'schemaTitle', 'schemaDescription', 'streetAddress', 'postalCode', 'canonicalUrl'].forEach(function (k) { if (k in patch) patch[k] = line(patch[k]); });
    /* a field somebody edited is the team's from now on */
    var ai = (B.aiWritten || []).filter(function (k) { return keys.indexOf(k) === -1; });
    if (ai.length !== (B.aiWritten || []).length) patch.aiWritten = ai;
    ST.saving = true; ST.failed = ''; paintSaveBar();
    var ev = ST.ctx.EV;
    return C.updateEvent(ev.id, { settings: { seo: patch } }).then(function (res) {
      ST.saving = false;
      ev.settings = ev.settings || {};
      ev.settings.seo = Object.assign({}, ev.settings.seo || {}, patch);
      if (res && res.updatedAt) { ev.updatedAt = res.updatedAt; ev.detailsUpdatedAt = res.updatedAt; }
      keys.forEach(function (k) { B[k] = clone(F[k]); });
      if (patch.aiWritten) B.aiWritten = patch.aiWritten;
      ST.undo = null;
      ST.ctx.toast(ev.published ? 'Saved. It reaches the live site with the next publish.' : 'Search and sharing saved.');
      return load(true);
    }, function (err) {
      ST.saving = false;
      ST.failed = errText(err);
      paintSaveBar();
      if (err && err.field === 'settings.seo.postalCode') throw { fields: [['seo-postalCode', err.message]] };
      throw err;
    });
  }
  function paintSaveBar() { var bar = $('seo-savebar'); if (bar) bar.outerHTML = saveBarHtml(), wireSaveBar(); }
  function discard() { ST.F = clone(ST.B); ST.failed = ''; redraw(); }

  /* ---------- ETB2B AI ---------- */
  /* fields the team wrote (saved or typed) that an AI write would replace */
  function typedIn(fields) {
    return fields.filter(function (k) {
      var v = ST.F[k], empty = Array.isArray(v) ? !v.length : !line(v);
      if (empty) return false;
      var aiOwn = (ST.B.aiWritten || []).indexOf(k) !== -1 && same(ST.F[k], ST.B[k]);
      return !aiOwn;
    });
  }
  function askThenWrite(fields, all) {
    var typed = typedIn(fields);
    if (!typed.length) return writeAi(fields);
    var M = ST.ctx.seo;
    var names = typed.map(function (k) { return LABEL[k]; }).join(', ');
    var empty = fields.filter(function (k) { return typed.indexOf(k) === -1; });
    var m = M.openModal('<div class="modal-head"><h3>' + (all ? 'Replace what the team wrote?' : 'Replace the ' + esc(LABEL[typed[0]]) + '?') + '</h3>' + M.closeBtn() + '</div>' +
      '<div class="modal-body"><div class="confirm-msg">' + esc(names) + (typed.length === 1 ? ' was' : ' were') + ' written by the team. ETB2B AI can write ' + (typed.length === 1 ? 'it' : 'them') +
      ' again from the event’s details; Undo puts back what is there now.</div></div>' +
      '<div class="modal-foot"><button class="btn btn-secondary" type="button" data-close>Cancel</button><span style="flex:1"></span>' +
      (all && empty.length ? '<button class="btn btn-secondary" type="button" id="seo-ask-empty">Only the empty ones</button>' : '') +
      '<button class="btn btn-primary" type="button" id="seo-ask-all">Replace ' + (typed.length === 1 ? 'it' : 'them') + ' too</button></div>', { style: 'width:min(520px,100%)', initialFocus: '#seo-ask-all' });
    var e1 = $('seo-ask-empty'), e2 = $('seo-ask-all');
    if (e1) e1.onclick = function () { m.close(); writeAi(empty); };
    e2.onclick = function () { m.close(); writeAi(fields); };
  }
  function writeAi(fields) {
    if (!fields.length || ST.aiBusy) return;
    var ev = ST.ctx.EV;
    ST.aiBusy = 'ETB2B AI is writing ' + (fields.length > 2 ? 'the search text' : fields.map(function (k) { return LABEL[k]; }).join(' and ')) + ' from the event’s details…';
    ST.undo = null; ST.dropped = [];
    redraw();
    C.writeSeo(ev.id, fields).then(function (res) {
      ST.aiBusy = '';
      var keys = Object.keys(res.values || {});
      keys.forEach(function (k) { ST.F[k] = clone(res.values[k]); ST.B[k] = clone(res.values[k]); });
      ST.B.aiWritten = res.aiWritten || ST.B.aiWritten; ST.F.aiWritten = ST.B.aiWritten;
      ev.settings = ev.settings || {}; ev.settings.seo = Object.assign({}, ev.settings.seo || {}, res.values, { aiWritten: ST.B.aiWritten });
      if (res.updatedAt) { ev.updatedAt = res.updatedAt; ev.detailsUpdatedAt = res.updatedAt; }
      ST.dropped = res.dropped || [];
      var said = keys.length ? 'ETB2B AI wrote ' + keys.map(function (k) { return LABEL[k]; }).join(', ') + ' and saved ' + (keys.length === 1 ? 'it' : 'them') + (res.previous ? ', with the previous edition as a reference' : '') + '.' :
        'ETB2B AI wrote nothing that could be used: every field is as it was.';
      if (ST.dropped.length) said += ' ' + ST.dropped.length + (ST.dropped.length === 1 ? ' field was' : ' fields were') + ' left out (see below).';
      ST.undo = keys.length ? { said: said, fields: keys, before: res.before || {}, aiWrittenBefore: res.aiWrittenBefore || [] } : { said: said, fields: [], before: null };
      return load(true);
    }, function (err) {
      ST.aiBusy = '';
      redraw();
      ST.ctx.toastError(err, { what: 'ETB2B AI could not write them. Nothing was changed.' });
    });
  }
  function undo() {
    var u = ST.undo, ev = ST.ctx.EV;
    if (!u || !u.before || !u.fields.length) { ST.undo = null; redraw(); return; }
    /* a field that was empty before has no value in `before`: it is sent back as empty ("" or no keywords), since a
       missing value would leave ETB2B AI's text where it is */
    var patch = {};
    u.fields.forEach(function (k) { var v = u.before[k]; patch[k] = v == null ? (k === 'keywords' ? [] : '') : clone(v); });
    patch.aiWritten = u.aiWrittenBefore || [];
    ST.aiBusy = 'Putting back what was there…'; redraw();
    C.updateEvent(ev.id, { settings: { seo: patch } }).then(function () {
      ST.aiBusy = ''; ST.undo = null; ST.dropped = [];
      u.fields.forEach(function (k) { ST.F[k] = clone(patch[k]); ST.B[k] = clone(patch[k]); });
      ST.B.aiWritten = u.aiWrittenBefore; ST.F.aiWritten = u.aiWrittenBefore;
      ev.settings.seo = Object.assign({}, ev.settings.seo || {}, patch);
      ST.ctx.toast('Undone: the fields are as they were.');
      return load(true);
    }, function (err) {
      ST.aiBusy = ''; redraw();
      ST.ctx.toastError(err, { what: 'That could not be undone.' });
    });
  }
  function draftFaqs() {
    var ev = ST.ctx.EV;
    if (ST.aiBusy) return;
    ST.aiBusy = 'ETB2B AI is drafting FAQs from the event’s details…'; ST.undo = null; redraw();
    var added = [];
    C.draftFaqs(ev.id).then(function (res) {
      var list = res.faqs || [];
      /* through Content › FAQ's own route, as a person adds one, one after another */
      return list.reduce(function (p, f, i) {
        return p.then(function () { return C.createSub('faqs', ev.id, { question: f.question, answer: f.answer, order: i + 1 }).then(function (r) { added.push(r.id); }); });
      }, Promise.resolve()).then(function () { return res; });
    }).then(function (res) {
      ST.aiBusy = '';
      if (ST.ctx.seo && ST.ctx.seo.forgetTab) ST.ctx.seo.forgetTab('faq');
      var said = added.length ? 'ETB2B AI drafted ' + added.length + ' FAQs and added them to Content › FAQ. Check them there before the site shows them.' : 'ETB2B AI drafted nothing that could be used.';
      if (res.dropped && res.dropped.length) said += ' ' + res.dropped.length + ' left out for saying what the event’s details do not.';
      ST.undo = added.length ? { said: said, fields: [], before: null, faqs: added } : { said: said, fields: [], before: null };
      return load(true);
    }, function (err) {
      ST.aiBusy = '';
      if (added.length && ST.ctx.seo && ST.ctx.seo.forgetTab) ST.ctx.seo.forgetTab('faq');
      redraw();
      ST.ctx.toastError(err, { what: added.length ? added.length + ' FAQs were added before it stopped.' : 'ETB2B AI could not draft FAQs. Nothing was added.' });
      if (added.length) load(true);
    });
  }
  function undoFaqs() {
    var u = ST.undo, ev = ST.ctx.EV;
    ST.aiBusy = 'Taking the drafted FAQs out again…'; redraw();
    u.faqs.reduce(function (p, id) { return p.then(function () { return C.deleteSub('faqs', ev.id, id); }); }, Promise.resolve()).then(function () {
      ST.aiBusy = ''; ST.undo = null;
      if (ST.ctx.seo && ST.ctx.seo.forgetTab) ST.ctx.seo.forgetTab('faq');
      ST.ctx.toast('Undone: the drafted FAQs were taken out of Content › FAQ.');
      return load(true);
    }, function (err) { ST.aiBusy = ''; redraw(); ST.ctx.toastError(err, { what: 'Not every drafted FAQ could be taken out: remove the rest in Content › FAQ.' }); load(true); });
  }

  /* ---------- the previous edition ---------- */
  function bringIn(only) {
    var ev = ST.ctx.EV;
    if (ST.prevBusy) return;
    ST.prevBusy = true; redraw();
    C.fetchSeoPrevious(ev.id).then(function (r) {
      ST.prevBusy = false; redraw();
      if (!r.previous) {
        if (r.why === 'et-down') ST.ctx.toastError('ETB2B’s event platform did not answer just now. Please try again in a few minutes.');
        else pickPrevious(only);
        return;
      }
      ST.prev = r;
      bringInDialog(r, only);
    }, function (err) { ST.prevBusy = false; redraw(); ST.ctx.toastError(err, { what: 'The previous edition could not be read.' }); });
  }
  /* again: opened from "Choose another previous edition" (the event has one on record already) */
  function pickPrevious(only, again) {
    var ev = ST.ctx.EV, M = ST.ctx.seo;
    if (!ev.portal) { ST.ctx.toastError('Set the event’s portal in Basics first: a previous edition comes from that portal.'); return; }
    var award = String(ev.category || '') === 'awards', who = esc(ev.portalName || ev.portal), kind = award ? 'awards' : 'events';
    var m = M.openModal('<div class="modal-head"><h3>Choose the previous edition</h3>' + M.closeBtn() + '</div>' +
      '<div class="modal-body"><p class="confirm-msg">' + (again ? 'Pick another of ' : 'No previous edition is on record for this event. Pick it from ') + who + '’s past ' + kind + ' on ETB2B.</p>' +
      '<div id="seo-pick-list" class="seo2-pick" aria-busy="true"><p class="seo2-hint">Loading ' + who + '’s ' + kind + '…</p></div></div>' +
      '<div class="modal-foot"><button class="btn btn-secondary" type="button" data-close>Cancel</button></div>', { style: 'width:min(560px,100%)' });
    C.fetchEtEvents(ev.portal, award ? 'award' : '').then(function (r) {
      var list = (r.events || []).filter(function (e) { return e.past || !e.upcoming; });
      var host = $('seo-pick-list'); if (!host) return;
      host.removeAttribute('aria-busy');
      host.innerHTML = list.length ? '<ul class="seo2-pick-list">' + list.slice(0, 60).map(function (e) {
        return '<li><button class="seo2-pick-btn" type="button" data-pick="' + esc(String(e.id)) + '"><b>' + esc(e.title) + '</b><span>' + esc(e.dateLabel || '') + '</span></button></li>';
      }).join('') + '</ul>' : '<p class="seo2-hint">' + who + ' has no past ' + kind + ' on ETB2B.</p>';
      Array.prototype.forEach.call(host.querySelectorAll('[data-pick]'), function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-pick'), e = list.filter(function (x) { return String(x.id) === id; })[0];
          m.close();
          ST.prevBusy = true; redraw();
          C.fetchSeoPrevious(ev.id, { portal: ev.portal, id: id }).then(function (res) {
            if (!res.previous) { ST.prevBusy = false; redraw(); ST.ctx.toastError('ETB2B’s event platform did not answer for that edition just now. Please try again.'); return; }
            /* kept as the event's previous edition for search: ETB2B AI reads its SEO as a reference from now on */
            var keep = { portal: ev.portal, id: id, name: e ? e.title : res.previous.name, link: (e && e.link) || res.previous.link || '' };
            return C.updateEvent(ev.id, { settings: { seo: { previous: keep } } }).then(function () {
              ev.settings = ev.settings || {}; ev.settings.seo = Object.assign({}, ev.settings.seo || {}, { previous: keep });
              ST.prevBusy = false; ST.prev = res; redraw();
              bringInDialog(res, only);
            });
          }).catch(function (err) { ST.prevBusy = false; redraw(); ST.ctx.toastError(err, { what: 'The previous edition could not be read.' }); });
        };
      });
    }, function (err) {
      var host = $('seo-pick-list'); if (host) { host.removeAttribute('aria-busy'); host.innerHTML = '<p class="seo2-err" role="alert">ETB2B’s list could not be read: ' + esc(errText(err)) + '</p>'; }
    });
  }
  function bringInDialog(r, only) {
    var p = r.previous, F = ST.F, M = ST.ctx.seo;
    var have = {};
    F.testimonials.forEach(function (t) { if (t.prevId) have[t.prevId] = 1; });
    var newT = (p.testimonials || []).filter(function (t) { return !have[t.prevId]; });
    var addr = p.seo && p.seo.streetAddress;
    /* what can be ticked, and (muted, one line each) what is not offered and why */
    var rows = [], off = [];
    if (!addr) off.push('Street address and postcode: ETB2B has none for it.');
    else if (!r.sameVenue) off.push('Street address and postcode: not offered, as it was at ' + esc(r.venueThen || 'another venue') + (r.venueNow ? ' and this one is at ' + esc(r.venueNow) : '') + '.');
    else {
      var typed = F.streetAddress && F.streetAddress !== addr;
      rows.push('<li class="seo2-row"><input type="checkbox" id="seo-bi-addr"' + (typed || only === 'tm' ? '' : ' checked') + '><label for="seo-bi-addr"><b>Street address and postcode</b><span>' + esc(addr) + (p.seo.postalCode ? ', ' + esc(p.seo.postalCode) : '') +
        (typed ? ' — replaces “' + esc(F.streetAddress) + '”' : '') + '</span></label></li>');
    }
    if (newT.length) {
      rows.push('<li class="seo2-row"><input type="checkbox" id="seo-bi-tm"' + (only === 'addr' ? '' : ' checked') + '><label for="seo-bi-tm"><b>' + newT.length + (newT.length === 1 ? ' testimonial' : ' testimonials') + '</b><span>' +
        esc(newT.map(function (t) { return t.name + (t.rating ? ' (' + t.rating + '★)' : ''); }).join(', ')) + ' — as they wrote them</span></label></li>');
    } else off.push('Testimonials: ' + ((p.testimonials || []).length ? 'all of them are here already.' : 'ETB2B has none for it.'));
    if (p.seo && p.seo.keywords && p.seo.keywords.length) off.push('Its ' + p.seo.keywords.length + ' search words: kept as a reference for ETB2B AI, which writes this edition’s own.');
    var m = M.openModal('<div class="modal-head"><h3>Bring in from ' + esc(p.name || 'the previous edition') + '</h3>' + M.closeBtn() + '</div>' +
      '<div class="modal-body"><p class="confirm-msg">From ETB2B’s record of the previous edition' + (p.link ? ' (<a href="' + esc(p.link) + '" target="_blank" rel="noopener">its site</a>)' : '') + '. Nothing changes until you save.</p>' +
      (rows.length ? '<ul class="seo2-rows seo2-bi">' + rows.join('') + '</ul>' : '') +
      (off.length ? '<ul class="seo2-bi-off">' + off.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="seo2-bi-other"><button class="btn btn-ghost btn-sm" type="button" id="seo-bi-other">Choose another previous edition</button></p></div>' +
      '<div class="modal-foot">' + (rows.length ? '<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" id="seo-bi-go">Bring them in</button>'
        : '<button class="btn btn-secondary" type="button" data-close>Close</button>') + '</div>',
      { style: 'width:min(560px,100%)', initialFocus: rows.length ? '#seo-bi-go' : '.modal-foot [data-close]' });
    $('seo-bi-other').onclick = function () { m.close(); pickPrevious(only, true); };
    var go = $('seo-bi-go');
    if (go) go.onclick = function () {
      var a = $('seo-bi-addr'), t = $('seo-bi-tm'), n = 0;
      if (a && a.checked) { F.streetAddress = addr; if (p.seo.postalCode) F.postalCode = p.seo.postalCode; n++; }
      if (t && t.checked) {
        var room = newT.slice(0, Math.max(0, 30 - F.testimonials.length));
        room.forEach(function (x) {
          F.testimonials.push({ id: uid(), name: x.name, role: x.role, company: x.company, title: x.title, text: x.text, rating: x.rating, photoUrl: x.photoUrl, from: 'previous', prevId: x.prevId });
        });
        if (room.length) n++;
      }
      m.close();
      redraw();
      if (n) ST.ctx.toast('Brought in. Save changes to keep them.');
      else if (t && t.checked) ST.ctx.toast('Nothing was brought in: there are 30 testimonials already, the most there can be.');
    };
  }

  /* ---------- a testimonial, typed by the team ---------- */
  function testimonialDialog(i) {
    var M = ST.ctx.seo, F = ST.F, editing = i != null, t = editing ? F.testimonials[i] : { id: uid(), name: '', role: '', company: '', title: '', text: '', rating: null, photoUrl: '', from: 'team' };
    var photo = t.photoUrl;
    var opts = '<option value="">No rating</option>' + [5, 4, 3, 2, 1].map(function (n) { return '<option value="' + n + '"' + (t.rating === n ? ' selected' : '') + '>' + n + (n === 1 ? ' star' : ' stars') + '</option>'; }).join('');
    function typed() { return JSON.stringify(['tm-name', 'tm-role', 'tm-company', 'tm-title', 'tm-text', 'tm-rating'].map(function (x) { return ($(x) || {}).value; }).concat([photo])); }
    var pristine = '', req = ' <span class="seo2-req">(required)</span>';
    var m = M.openModal('<div class="modal-head"><h3>' + (editing ? 'Edit the testimonial' : 'Add a testimonial') + '</h3>' + M.closeBtn() + '</div>' +
      '<form class="modal-form" novalidate><div class="modal-body seo2-tm"><div class="frow">' +
      '<div class="field c6"><label for="tm-name">Name' + req + '</label><input class="inp" id="tm-name" maxlength="120" value="' + esc(t.name) + '"></div>' +
      '<div class="field c6"><label for="tm-role">Role</label><input class="inp" id="tm-role" maxlength="120" value="' + esc(t.role) + '" placeholder="e.g. CHRO"></div>' +
      '<div class="field c6"><label for="tm-company">Company</label><input class="inp" id="tm-company" maxlength="120" value="' + esc(t.company) + '"></div>' +
      '<div class="field c6"><label for="tm-rating">Rating</label><select class="inp" id="tm-rating">' + opts + '</select></div>' +
      '<div class="field c12"><label for="tm-text">What they said' + req + '</label><textarea class="inp" id="tm-text" maxlength="1500" rows="4" aria-describedby="tm-text-hint">' + esc(t.text) + '</textarea>' +
        '<p class="seo2-hint" id="tm-text-hint">In their own words, as they said or wrote it.</p></div>' +
      '<div class="field c12"><label for="tm-title">Headline</label><input class="inp" id="tm-title" maxlength="200" value="' + esc(t.title) + '" placeholder="e.g. A truly pleasant experience"></div>' +
      '<div class="field c12"><span class="flabel">Photo</span><div class="seo2-photo"><span class="seo2-photo-pic" id="tm-photo-prev">' + (M.imgTag(photo) || svg(ST.ctx.IC.image, 18)) + '</span>' +
        '<span class="seo2-photo-state" id="tm-photo-state">' + (photo ? 'Their photo.' : 'Optional.') + '</span>' +
        '<button class="btn btn-secondary btn-sm" type="button" id="tm-photo-btn">' + (photo ? 'Replace' : 'Upload') + '</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="tm-photo-x"' + (photo ? '' : ' hidden') + '>Remove</button></div></div>' +
      '</div></div><div class="modal-foot"><span class="modal-err" id="tm-err" role="alert"></span><button class="btn btn-secondary" type="button" data-close>Cancel</button>' +
      '<button class="btn btn-primary" type="submit" id="tm-save">' + (editing ? 'Update testimonial' : 'Add testimonial') + '</button></div></form>',
      { style: 'width:min(600px,100%)', initialFocus: '#tm-name', isDirty: function () { return typed() !== pristine; }, onSubmit: done });
    pristine = typed();
    function showPhoto() {
      $('tm-photo-prev').innerHTML = M.imgTag(photo) || svg(ST.ctx.IC.image, 18);
      $('tm-photo-state').textContent = photo ? 'Their photo.' : 'Optional.';
      $('tm-photo-btn').textContent = photo ? 'Replace' : 'Upload';
      $('tm-photo-x').hidden = !photo;
    }
    $('tm-photo-btn').onclick = function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp';
      inp.onchange = function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        $('tm-photo-state').textContent = 'Uploading…';
        C.uploadImage(ST.ctx.EV.id, 'media', file).then(function (up) { photo = up.url; showPhoto(); }, function (err) { showPhoto(); $('tm-err').textContent = 'The photo was not uploaded: ' + errText(err); });
      };
      inp.click();
    };
    $('tm-photo-x').onclick = function () { photo = ''; showPhoto(); };
    function done() {
      var name = line($('tm-name').value), text = String($('tm-text').value || '').trim(), errs = [];
      if (!name) errs.push(['tm-name', 'Enter the person’s name.']);
      if (!text) errs.push(['tm-text', 'Enter what they said.']);
      if (errs.length) { M.showFieldErrors(errs); return; }
      var r = $('tm-rating').value;
      var next = { id: t.id, name: name, role: line($('tm-role').value), company: line($('tm-company').value), title: line($('tm-title').value), text: text,
        rating: r ? +r : null, photoUrl: photo || '', from: t.from === 'previous' ? 'previous' : 'team' };
      if (t.prevId) next.prevId = t.prevId;
      if (t.off) next.off = true;
      if (editing) F.testimonials[i] = next; else F.testimonials.push(next);
      m.close();
      redraw();
      ST.ctx.toast((editing ? 'Testimonial updated.' : 'Testimonial added.') + ' Save changes to keep it.');
    }
  }

  /* ---------- wiring ---------- */
  function wireSaveBar() {
    var s = $('seo-save'), x = $('seo-discard');
    if (s) s.onclick = function () {
      save().then(null, function (err) {
        if (err && err.fields) ST.ctx.seo.showFieldErrors(err.fields);
      });
    };
    if (x) x.onclick = function () { discard(); ST.ctx.toast('Changes discarded'); };
  }
  function wire(ctx) {
    ST.ctx = ctx;
    var root = $('seo-root') || $('seo-loading') || document;
    Array.prototype.forEach.call(document.querySelectorAll('[data-seo="reload"]'), function (b) { b.onclick = function () { ST.error = ''; load(false); redraw(); }; });
    if (!$('seo-root')) return;
    if (ctx.seo && ctx.seo.wireSharePicture) ctx.seo.wireSharePicture();
    ctx.seo.setLeave({ label: 'URL & SEO', dirty: dirty, save: save, discard: function () { ST.F = clone(ST.B); ST.failed = ''; } });

    /* typing: kept in the form, counted, previewed, never redrawn under the cursor */
    root.addEventListener('input', function (e) {
      var k = e.target && e.target.getAttribute && e.target.getAttribute('data-seo-field');
      if (!k) return;
      ctx.seo.clearFieldError(e.target);
      if (k === 'latitude' || k === 'longitude') ST.F[k] = numberOf(e.target.value);
      else ST.F[k] = e.target.value;
      ST.failed = '';
      paintLive();
    });
    root.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.getAttribute('data-seo-field') === 'attendanceMode') { ST.F.attendanceMode = t.value; paintLive(); return; }
      var sp = t && t.getAttribute('data-seo-sp'), fq = t && t.getAttribute('data-seo-fq'), tm = t && t.getAttribute('data-seo-tm-on');
      if (sp) { ST.F.speakersOff = ST.F.speakersOff.filter(function (x) { return x !== sp; }); if (!t.checked) ST.F.speakersOff.push(sp); paintLive(); }
      if (fq) { ST.F.faqsOff = ST.F.faqsOff.filter(function (x) { return x !== fq; }); if (!t.checked) ST.F.faqsOff.push(fq); paintLive(); }
      if (tm != null) { var row = ST.F.testimonials[+tm]; if (row) { if (t.checked) delete row.off; else row.off = true; } redraw(); }
    });
    wireRich(root);
    function addKeyword() {
      var inp = $('seo-kw-in'), v = line(inp && inp.value);
      if (!v) return;
      var parts = v.split(/\s*[,;]\s*/).filter(Boolean);
      parts.forEach(function (p) {
        if (ST.F.keywords.length >= 15) return;
        if (ST.F.keywords.some(function (k) { return k.toLowerCase() === p.toLowerCase(); })) return;
        ST.F.keywords.push(p.slice(0, 60));
      });
      redraw();
      var again = $('seo-kw-in'); if (again && !again.disabled) again.focus();
    }
    var kwIn = $('seo-kw-in');
    if (kwIn) kwIn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKeyword(); } });
    root.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button, a') : null;
      if (!b) return;
      var what = b.getAttribute('data-seo'), one = b.getAttribute('data-seo-ai');
      if (one) { askThenWrite([one], false); return; }
      if (b.hasAttribute('data-seo-kw-x')) { ST.F.keywords.splice(+b.getAttribute('data-seo-kw-x'), 1); redraw(); var k2 = $('seo-kw-in'); if (k2) k2.focus(); return; }
      if (b.hasAttribute('data-seo-tm-edit')) { testimonialDialog(+b.getAttribute('data-seo-tm-edit')); return; }
      if (b.hasAttribute('data-seo-tm-x')) { ST.F.testimonials.splice(+b.getAttribute('data-seo-tm-x'), 1); redraw(); ctx.toast('Testimonial removed. Save changes to keep that.'); return; }
      if (b.id === 'seo-noindex') { ST.F.noindex = !ST.F.noindex; redraw(); focusAgain('seo-noindex'); return; }
      if (b.id === 'seo-basicSchema') { if (!ST.data.auto.dates.exact) return; ST.F.basicSchema = !ST.F.basicSchema; redraw(); focusAgain('seo-basicSchema'); return; }
      if (b.id === 'seo-advancedSchema') { ST.F.advancedSchema = !ST.F.advancedSchema; redraw(); focusAgain('seo-advancedSchema'); return; }
      if (!what) return;
      act(what);
    });
    /* the two actions in the view's heading (Write with ETB2B AI, Bring in from the previous edition) are drawn above
       #seo-root, so they are wired here themselves */
    Array.prototype.forEach.call(document.querySelectorAll('.vhead [data-seo="ai-all"], .vhead [data-seo="prev"]'), function (b) {
      b.onclick = function () { act(b.getAttribute('data-seo')); };
    });
    function act(what) {
      if (what === 'ai-all') askThenWrite(AI_FIELDS.slice(), true);
      else if (what === 'undo') { if (ST.undo && ST.undo.faqs) undoFaqs(); else undo(); }
      else if (what === 'kw-add') addKeyword();
      else if (what === 'canon-own') { ST.canonOpen = true; redraw(); var c = $('seo-canonicalUrl'); if (c) c.focus(); }
      else if (what === 'canon-auto') { ST.canonOpen = false; ST.F.canonicalUrl = ''; redraw(); }
      else if (what === 'prev') bringIn('');
      else if (what === 'prev-tm') bringIn('tm');
      else if (what === 'use-prev-address') { var pv = ST.prev.previous.seo; ST.F.streetAddress = pv.streetAddress; if (pv.postalCode) ST.F.postalCode = pv.postalCode; redraw(); }
      else if (what === 'tm-add') testimonialDialog(null);
      else if (what === 'faq-draft') draftFaqs();
      else if (what === 'publish') ctx.seo.publish();
    }
    wireSaveBar();
  }
  function focusAgain(id) { setTimeout(function () { var el = $(id); if (el) el.focus(); }, 0); }

  /* Back to this tab — an approver may have put the site live meanwhile, from the review page: what is live and what
     waits is read again (keeping anything typed), at most every 20 seconds, and never while a field has the cursor */
  var lastBack = 0;
  function onBack() {
    if (document.visibilityState === 'hidden' || !ST.ctx || !ST.data || ST.loading || ST.saving || ST.aiBusy || !onScreen()) return;
    var a = document.activeElement;
    if (a && a.closest && a.closest('#seo-root') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    var now = Date.now();
    if (now - lastBack < 20000) return;
    lastBack = now;
    load(true);
  }
  document.addEventListener('visibilitychange', onBack);
  global.addEventListener('focus', onBack);

  global.EditEventSEO = { view: view, wire: wire, reload: function () { if (ST.ctx) load(true); }, _state: ST, _formOf: formOf };
})(window);
