/* Settings › Search and sharing in the event console (edit-event.html; route settings/seo, the tab was "URL & SEO"):
   every search and sharing setting of an event in one calm page — the owner (6 Nov 2026): "keep everything in one
   section under settings -> seo", never the site's own words; (14 Nov 2026) "too noisy, it should be neat and clean".
   Written for event and marketing teams, so every field is named in plain words (LABEL), never in search-engine jargon.

   THE PAGE, TOP TO BOTTOM (view):
     heading            "Search and sharing", one line under it saying what needs the team (the title, description
                        and search words), and the page's one helper (actionsHtml): Suggest with ETB2B AI (every field
                        it writes, asking before it replaces what is already filled in)
     status line        live, or how many changes the next publish takes live (the list folded under "What changed")
                        with the console's own Publish or Send for approval as a link; under it, while ETB2B AI works
                        or after it wrote, one line with Undo
     preview            the Google result and the shared link, side by side on a wide screen: the page's anchor
     checklist          one line, "Checklist: 3 of 5 done · Show" (functions/lib/api-seo.js readiness): what to do here
     Google result      title, description, search words and main heading, each with one muted line under it (where
                        its value comes from, what is cut off, and Suggest with ETB2B AI for that field alone, or
                        "Suggest again" after ETB2B AI wrote it); then the main web address and Show in Google. A site
                        with a main heading of its own says so in one line instead of the heading's field (the field
                        moves into Advanced: it is used only if that heading goes)
     When the link is   the share picture (the console's own field, CTX.seo.sharePictureField: it saves itself at once),
       shared           small, as the preview shows it large, and one line: a shared link shows Google's title and
                        description, with the way to change them
     Advanced (closed)  Event details for search engines: on or off, what is filled in from Basics and the portal, the
                        event's name and description in event listings, street address (with Bring in the previous
                        edition's address), postcode, how people attend, latitude and longitude (and the main heading,
                        when the site has its own). Speakers, FAQs and reviews in Google: on or off, the speakers and
                        FAQs to give (from Content), testimonials (typed here or brought in from the previous edition,
                        never written by AI), the rating (worked out), passes and prices (left out). The code search
                        engines read (for developers, folded). Short links: not available yet, said so.
     save bar           the page's one primary button
   Folded, never taken out: every field is still on the page, and a field with an error inside a fold opens it, as
   does a result that lands inside the closed fold (what ETB2B AI left out of a field there).

   HOW IT SAVES. The fields are a form with the console's save bar (Save changes / Discard), sent as the changed keys of
   settings.seo through PATCH /api/event. ETB2B AI (Suggest with ETB2B AI, for the page or for one field; Suggest again)
   writes and saves at once — the console's "do it, then undo": Undo saves what was there before; the fields it is
   writing cannot be typed in meanwhile. A field ETB2B AI wrote is marked as its own until somebody edits it. Nothing
   here changes a live site: a live page carries the values that were published with it, so the status line says
   what the next publish changes and offers the console's own Publish (or Send for approval).

   The console hands this file its helpers (edit-event.html, CTX.seo): the share picture field's two functions, its
   dialogs, the publish action, the tab cache and the leave guard. Its styles are the "seo2" blocks at the end of
   edit-event.css. ES5, no build step. */
(function (global) {
  'use strict';

  var C = global.RevampCore;
  var AI_FIELDS = ['title', 'description', 'keywords', 'h1', 'schemaTitle', 'schemaDescription'];
  /* every setting by the name the page gives it: in ETB2B AI's messages, the replace dialog, the aria-labels and the
     status line's list of changes (the server's own labels, functions/lib/seo-fields.js LABELS, are the activity log's
     and the approver's) */
  var LABEL = { title: 'Title in Google', description: 'Description in Google', keywords: 'Search words', h1: 'Main heading',
    schemaTitle: 'Event name in event listings', schemaDescription: 'Event description in event listings', canonicalUrl: 'Main web address',
    noindex: 'Show in Google', shareImageUrl: 'Share picture', streetAddress: 'Street address', postalCode: 'Postcode', latitude: 'Latitude',
    longitude: 'Longitude', attendanceMode: 'How people attend', basicSchema: 'Event details for search engines',
    advancedSchema: 'Speakers, FAQs and reviews in Google', speakersOff: 'Speakers left out', faqsOff: 'FAQs left out', testimonials: 'Testimonials',
    speakers: 'Speakers in Google', faqs: 'FAQs in Google' };
  /* the form's own fields (the share picture saves itself, as it always did; aiWritten and previous are bookkeeping) */
  var FORM = ['title', 'description', 'keywords', 'h1', 'canonicalUrl', 'noindex', 'basicSchema', 'schemaTitle', 'schemaDescription', 'attendanceMode',
    'streetAddress', 'postalCode', 'latitude', 'longitude', 'advancedSchema', 'speakersOff', 'faqsOff', 'testimonials'];
  var IDEAL = { title: 60, description: 160, h1: 70, schemaTitle: 90, schemaDescription: 300 };
  var MAX = { title: 70, description: 320, h1: 120, schemaTitle: 120, schemaDescription: 500 };

  /* the section's state, for the event on screen */
  var ST = { id: '', data: null, loading: false, error: '', F: null, B: null, aiBusy: '', aiFields: [], undo: null, dropped: [], prev: null, prevBusy: false,
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

  /* ---------- small pieces, shared by every part of the page ---------- */
  /* a text field's count against what reads best: "n / ideal", small and muted at the right of its label (class ctr
     seo-ctr [over|warn]; paintLive repaints it while typing) */
  function counter(k) {
    var n = line(ST.F[k]).length, ideal = IDEAL[k];
    return '<span class="ctr seo-ctr' + (n > ideal ? ' over' : n > ideal * 0.9 ? ' warn' : '') + '" id="seo-ctr-' + k + '">' + n + ' / ' + ideal + '</span>';
  }
  /* the site shows a main heading of its own: Google reads that one, and the page's own field (h1) is used only if it
     goes — so it is not offered in the Google result, nor written by the heading's Suggest with ETB2B AI */
  function ownHeading() { return !!(ST.data && ST.data.auto && ST.data.auto.h1 && ST.data.auto.h1.own); }
  function aiFields() { return AI_FIELDS.filter(function (k) { return k !== 'h1' || !ownHeading(); }); }
  /* the fields drawn inside the closed Advanced fold: a result about one of them opens it */
  function inAdvanced(k) { return k === 'schemaTitle' || k === 'schemaDescription' || (k === 'h1' && ownHeading()); }
  /* a field ETB2B AI is writing just now cannot be typed in: its answer would replace what was typed meanwhile */
  function aiWriting(k) { return !!ST.aiBusy && (ST.aiFields || []).indexOf(k) !== -1; }
  function joinAnd(list) { return list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list.join(''); }
  /* the muted line under a field ETB2B AI writes, as far as ETB2B AI is concerned (the search and the event details
     fields alike): what it left out, with a small icon (aiLeftOut), or that it wrote what is there (aiWrote), each
     with Suggest again; else the field's own words end with Suggest with ETB2B AI for that field alone (aiOne). Both
     are small text buttons; Suggest with ETB2B AI in the heading writes every field. */
  function aiAgain(k) {
    return '<button class="seo2-link" type="button" data-seo-ai="' + k + '"' + (ST.aiBusy ? ' disabled' : '') +
      ' aria-label="' + esc('Suggest again with ETB2B AI: ' + LABEL[k]) + '">Suggest again</button>';
  }
  function aiOne(k) {
    return '<button class="seo2-link" type="button" data-seo-ai="' + k + '"' + (ST.aiBusy ? ' disabled' : '') +
      ' aria-label="' + esc('Suggest with ETB2B AI: ' + LABEL[k]) + '">Suggest with ETB2B AI</button>';
  }
  function aiOwn(k) {
    var v = ST.F[k], empty = Array.isArray(v) ? !v.length : !line(v);
    return !empty && (ST.B.aiWritten || []).indexOf(k) !== -1 && same(v, ST.B[k]);
  }
  function aiLink(k) { return aiOwn(k) ? aiAgain(k) : aiOne(k); }
  function aiLeftOut(k) {
    var d = (ST.dropped || []).filter(function (x) { return x.field === k; })[0];
    return d ? '<span class="seo2-warn">' + svg(ST.ctx.IC.info, 13) + ' ETB2B AI ' + esc(d.why) + '.</span> ' + aiAgain(k) : '';
  }
  function aiWrote(k) { return aiOwn(k) ? 'Suggested by ETB2B AI · ' + aiAgain(k) : ''; }
  /* past what a search result shows: said in words (the counter alone, in the warning colour, read as an error) */
  var OVER = { title: 'Google shows about 60 characters; the rest may be cut off.', description: 'Google shows about 160 characters; the rest may be cut off.' };
  function overNote(k) {
    return OVER[k] && line(ST.F[k]).length > IDEAL[k] ? '<span class="seo2-warn">' + svg(ST.ctx.IC.info, 13) + ' ' + esc(OVER[k]) + '</span>' : '';
  }
  function toggle(id, on, label, attrs) {
    return '<button type="button" class="tgl" id="' + id + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (attrs || '') + '><span class="track"><i></i></span><span>' + esc(label) + '</span></button>';
  }
  /* a link to another part of the console, in the page's one quiet link style */
  function linkTo(route, text) { return '<a class="seo2-link" href="#' + route + '" data-goto="' + route + '">' + esc(text) + '</a>'; }
  function stars(n) {
    var s = '';
    for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆';
    return '<span class="seo2-stars" role="img" aria-label="' + n + ' out of 5 stars">' + s + '</span>';
  }

  /* ---------- the view ---------- */
  /* THE PAGE, TOP TO BOTTOM (the owner, 14 Nov 2026: "too noisy, it should be neat and clean"): a heading with one line
     under it; one status line (live, or what the next publish changes); the preview of the Google result and of the
     shared link, the page's anchor; the two parts a person sets up — the Google result and the shared link — open; and
     folded away, closed, everything search engines are given on their own (the event's details, speakers, FAQs and
     reviews, what search engines read, the readiness checklist); then the one save bar. Folded, never taken out: every
     field is still here, and a field with an error inside the fold opens it (showFieldErrors). The fold stays as the
     person left it while the section is drawn again (ST.advOpen, wireShell). */
  function view(ctx) {
    ST.ctx = ctx;
    var ev = ctx.EV;
    if (ST.id !== ev.id) { ST.id = ev.id; ST.data = null; ST.F = null; ST.B = null; ST.undo = null; ST.prev = null; ST.dropped = []; ST.advOpen = false; ST.readyOpen = false; ST.ldOpen = false; ST.chgOpen = false; ST.canonOpen = false; }
    var head = ctx.vhead('Search and sharing', 'How this event appears in Google and when its link is shared. Only the title, description and search words need you; everything else is filled in.',
      ST.data ? actionsHtml() : '');
    if (!ST.data) {
      if (!ST.loading && !ST.error) setTimeout(function () { if (!ST.data && !ST.loading) load(false); }, 0);
      if (ST.error) {
        return head + ctx.panel('Search and sharing', '', '<div class="callout" role="alert">' + svg(ctx.IC.info, 15) + '<span>The search and sharing settings could not be loaded: ' + esc(ST.error) + '</span></div>' +
          '<p style="margin:12px 0 0"><button class="btn btn-secondary btn-sm" type="button" data-seo="reload">Try again</button></p>');
      }
      return head + '<div id="seo-loading" class="seo-lead" aria-busy="true">Loading the search and sharing settings…</div>';
    }
    return head + '<div id="seo-root" class="seo2">' + statusHtml() + aiStatusHtml() + previewHtml() + readyHtml() +
      searchHtml() + socialHtml() +
      '<details class="seo2-adv" id="seo2-adv"' + (ST.advOpen ? ' open' : '') + '><summary>' +
        '<span class="seo2-adv-t">Advanced</span><span class="seo2-adv-s">Event details, speakers, FAQs and reviews for search engines. Filled in for you; the extras inside are optional.</span></summary>' +
        '<div class="seo2-adv-body">' + schemaHtml() + richHtml() +
          '<p class="seo2-hint seo2-adv-note"><span>Short links are not available yet: share the site’s own address.</span></p></div></details>' +
      saveBarHtml() + '</div>';
  }

  /* the page's one helper, in its heading: ETB2B AI writes every field it may write (each field also has its own
     Suggest with ETB2B AI, in its line). Secondary, so the save bar's Save changes is the page's one primary button.
     Bringing in from the previous edition sits where what it brings lands: the testimonials, and the street address. */
  function actionsHtml() {
    var busy = !!ST.aiBusy;
    return '<button class="btn btn-secondary btn-sm seo2-hact" type="button" data-seo="ai-all"' + (busy ? ' disabled' : '') + '>' + svg(ST.ctx.IC.star, 13) + ' Suggest with ETB2B AI</button>';
  }

  /* going live, said once, in one line: live, or what the next publish changes (the list folded under "What changed"),
     and the console's own way to publish as a link. Each change is named and worded as this page says it (LABEL): the
     server's words are the activity log's ("SEO title", a picture's address, "2 taken out"). */
  function cutAt(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + ' …' : s; }
  /* the speakers, FAQs or testimonials the next publish gives: only those the site shows (search engines are given
     nothing the page does not show), the rest counted */
  function namesOf(list, nameOf, picked, noun) {
    if (!picked) return 'None';
    if (!list.length) return 'None on the site yet (' + picked + ' ' + noun + ')';
    var names = list.slice(0, 3).map(nameOf).join(', ') + (list.length > 3 ? ' and ' + (list.length - 3) + ' more' : '');
    return cutAt(names, 120) + (picked > list.length ? ' (' + (picked - list.length) + ' not on the site)' : '');
  }
  function changeValue(c) {
    var d = ST.data, seo = d.seo || {}, after = String(c.after || '');
    if (c.field === 'noindex') return seo.noindex === true ? 'Off' : 'On';
    if (c.field === 'shareImageUrl') return after ? 'Your own picture' : 'Made automatically';
    if (c.field === 'canonicalUrl' && !after) return 'The site’s own';
    if (c.field === 'speakersOff' || c.field === 'faqsOff') return String((seo[c.field] || []).length || 'None');
    if (c.field === 'h1' && after && ownHeading()) return 'Not used: the site has its own main heading';
    if (c.field === 'speakers' || c.field === 'faqs') {
      var recs = (c.field === 'speakers' ? d.speakers : d.faqs).filter(function (x) { return x.counts; });
      return namesOf(recs.filter(function (x) { return x.shown; }), function (x) { return c.field === 'speakers' ? x.name : x.question; }, recs.length, 'picked');
    }
    if (c.field === 'testimonials') {
      var tms = (seo.testimonials || []).filter(function (t) { return !t.off; });
      return namesOf(tms.filter(function (t) { return d.testimonials[t.id] && d.testimonials[t.id].shown; }),
        function (t) { return t.name + (t.rating ? ' (' + t.rating + '★)' : ''); }, tms.length, 'added');
    }
    if (!after) return c.field === 'keywords' ? 'None' : 'Removed';
    return cutAt(after, 120);
  }
  function statusHtml() {
    var d = ST.data, pend = d.pending, changes = d.changes || [], n = changes.length, tone = 'ok', text, act = '', more = '';
    if (!d.live.published) {
      tone = 'mute';
      text = 'Not live yet. These settings go live when the site is first published.';
    } else if (!n && !dirty()) {
      text = 'Everything here is live. A change reaches the site with the next publish' + (d.approvalRequired ? ', once it is approved' : '') + '.';
    } else {
      tone = 'warn';
      /* "waiting for approval" only of changes that are saved: what is still being typed is in no request */
      text = (n ? n + (n === 1 ? ' change goes' : ' changes go') : 'Your changes go') + ' live with the next publish' +
        (n && pend ? (pend.seoSame ? ', and ' + (n === 1 ? 'it is' : 'they are') + ' waiting for approval.' : '. A request is waiting, but it does not have the newest changes.') : '.');
      act = dirty() ? '<span class="seo2-quiet">Save first.</span>'
        : pend && pend.seoSame ? '<a class="seo2-link" href="' + esc(pend.reviewPath) + '">Open the review</a>'
        : '<button class="seo2-link" type="button" data-seo="publish">' + (d.approvalRequired ? (pend ? 'Send again for approval' : 'Send for approval') : 'Publish now') + '</button>';
      if (n) {
        more = '<details class="seo2-chg" id="seo2-chg"' + (ST.chgOpen ? ' open' : '') + '><summary>What changed</summary><ul>' + changes.slice(0, 8).map(function (c) {
          return '<li><b>' + esc(LABEL[c.field] || c.label) + '</b>: ' + esc(changeValue(c)) + '</li>';
        }).join('') + (n > 8 ? '<li>and ' + (n - 8) + ' more</li>' : '') + '</ul></details>';
      }
    }
    return '<div class="seo2-status" role="status"><span class="seo2-status-t"><span class="dash-dot dash-dot-' + tone + '" aria-hidden="true"></span>' +
      esc(text) + '</span>' + act + more + '</div>';
  }
  function aiStatusHtml() {
    var s = '';
    if (ST.aiBusy) s = '<span class="spin"></span> <span>' + esc(ST.aiBusy) + '</span>';
    else if (ST.undo) s = '<span>' + esc(ST.undo.said) + '</span> <button class="seo2-link" type="button" data-seo="undo">Undo</button>';
    return '<div class="seo-ai-status seo2-ai" id="seo-ai-status" role="status" aria-live="polite"' + (s ? '' : ' hidden') + '>' + s + '</div>';
  }

  /* ---------- the "Google result" panel: what a search result shows ----------
     Four fields, each a label with a small counter, the field, and at most one muted line under it (searchNote): what
     ETB2B AI left out, else what a search result cuts off, else where the value comes from (ETB2B AI, Basics, the
     previous edition) — ending with Suggest with ETB2B AI for that field alone (Suggest again on ETB2B AI's own). No
     actions in the panel's head: the page's heading has Suggest with ETB2B AI for every field. A site with a main
     heading of its own shows that heading in one line instead of the field (the field is in Advanced). Below a
     hairline: the main web address and Show in Google. Same ids and ST.F keys as before: the save, the live preview
     and the leave guard read them. */
  function searchNote(k) {
    var F = ST.F, v = F[k], empty = Array.isArray(v) ? !v.length : !line(v);
    var left = aiLeftOut(k);
    if (left) return left;
    var over = overNote(k);
    if (over) return over + ' ' + aiLink(k);
    var wrote = aiWrote(k);
    if (wrote) return wrote;
    var base = '';
    if (k === 'keywords') {
      var p = ST.prev && ST.prev.previous, prevKw = p && p.seo && p.seo.keywords && p.seo.keywords.length ? p.seo.keywords : null;
      base = prevKw ? 'The previous edition used: ' + esc(prevKw.join(', ')) + ' (ETB2B AI reads them as a reference).'
        : empty ? 'What people type into Google to find it: the event, its subject, its audience, its city.' : '';
    } else if (empty) {
      base = k === 'title' ? 'Until you write one, Google shows the event’s name, from Basics.'
        : k === 'description' ? (line(ST.ctx.EV.description) ? 'Until you write one, Google shows the short description from Basics.' : 'Until you write one, Google picks lines from the page itself.')
        : 'Google reads it as the page’s main heading. Until you write one, the event’s name is used.';
    }
    return (base ? base + ' ' : '') + aiOne(k);
  }
  function paintSearchNote(k) {
    var el = $('seo2-note-' + k);
    if (!el || !ST.F) return;
    var html = searchNote(k);
    el.innerHTML = html;
    el.hidden = !html;
  }
  /* label: HTML, already escaped */
  function searchField(k, label, opts) {
    var id = 'seo-' + k, note = searchNote(k), at = ' id="' + id + '" data-seo-field="' + k + '" maxlength="' + MAX[k] + '" aria-describedby="seo2-note-' + k + '" placeholder="' + esc(opts.placeholder || '') + '"' +
      (aiWriting(k) ? ' readonly' : '');
    return '<div class="seo2-field" data-seo-wrap="' + k + '"><div class="seo2-lrow"><label for="' + id + '">' + label + '</label>' + counter(k) + '</div>' +
      (opts.area ? '<textarea class="inp" rows="3"' + at + '>' + esc(ST.F[k]) + '</textarea>' : '<input class="inp"' + at + ' value="' + esc(ST.F[k]) + '">') +
      '<p class="seo2-note" id="seo2-note-' + k + '"' + (note ? '' : ' hidden') + '>' + note + '</p></div>';
  }
  function searchHtml() {
    var d = ST.data, F = ST.F, a = d.auto, n = F.keywords.length, full = n >= 15;
    /* an empty description shows what is used instead: Basics' short description, cut where a search result cuts it */
    var basics = line(ST.ctx.EV.description), basicsCut = basics.length > 158 ? basics.slice(0, 157).replace(/\s+\S*$/, '') + ' …' : basics;

    /* while ETB2B AI writes the search words, they wait: no word is added or taken out under it */
    var kwBusy = aiWriting('keywords');
    var chips = F.keywords.map(function (k, i) {
      return '<li class="seo2-chip">' + esc(k) + '<button type="button" data-seo-kw-x="' + i + '" aria-label="Remove the search word ' + esc(k) + '"' + (kwBusy ? ' disabled' : '') + '>×</button></li>';
    }).join('');
    var kwNote = searchNote('keywords');
    var kw = '<div class="seo2-field" data-seo-wrap="keywords"><div class="seo2-lrow"><label for="seo-kw-in">Search words</label>' +
        '<span class="ctr seo-ctr' + (n > 12 ? ' over' : '') + '" id="seo-ctr-keywords">' + (n ? n + ' added · ' : '') + '8 to 12 works best</span></div>' +
      '<div class="seo2-kw">' + (chips ? '<ul class="seo2-chips" id="seo-kw-list" aria-label="Search words">' + chips + '</ul>' : '') +
        '<div class="seo2-kw-add"><input class="seo2-kw-in" id="seo-kw-in" maxlength="60" aria-describedby="seo2-note-keywords" placeholder="' +
          (full ? '15 is the most' : 'Type a word or phrase, then press Enter') + '"' + (full ? ' disabled' : kwBusy ? ' readonly' : '') + '>' +
        '<button class="seo2-link" type="button" data-seo="kw-add"' + (full || kwBusy ? ' disabled' : '') + '>Add</button></div></div>' +
      '<p class="seo2-note" id="seo2-note-keywords"' + (kwNote ? '' : ' hidden') + '>' + kwNote + '</p></div>';

    /* the main heading: the site's own when it has one (one line, nothing to write; the field is in Advanced) */
    var h1 = ownHeading()
      ? '<div class="seo2-field"><div class="seo2-lrow"><span class="seo2-label">Main heading</span></div>' +
          '<p class="seo2-note">The site’s own, “' + esc(cutAt(line(a.h1.own), 90)) + '”. Google reads it from the page, so there is nothing to write here.</p></div>'
      : searchField('h1', 'Main heading <span class="seo2-aside">(not shown on the page)</span>', { placeholder: a.title });

    /* the main web address: the site's own, said as what Google lists; another page only when the event's main page is
       elsewhere (said before the box opens, so it is not mistaken for the place to change the site's address) */
    var own = F.canonicalUrl || ST.canonOpen;
    var canon = '<div class="seo2-field"><div class="seo2-lrow">' + (own ? '<label for="seo-canonicalUrl">Main web address</label>' : '<span class="seo2-label">Main web address</span>') + '</div>' +
      (own ? '<div class="seo2-inline"><input class="inp" id="seo-canonicalUrl" data-seo-field="canonicalUrl" type="url" maxlength="500" value="' + esc(F.canonicalUrl) + '" placeholder="https://…" aria-describedby="seo2-note-canon">' +
          '<button class="seo2-link" type="button" data-seo="canon-auto">Use the site’s own</button></div>' +
          '<p class="seo2-note" id="seo2-note-canon">Only if this event’s main page is on another site. Google then lists that page instead of this one.</p>'
        : '<div class="seo2-inline"><span class="num">' + esc(a.url) + '</span><button class="seo2-link" type="button" data-seo="canon-own">Point Google to another page</button></div>' +
          '<p class="seo2-note">Google lists the site at this address.</p>') + '</div>';
    /* the switch says what the team chose; the line under it, what keeps the site out of Google all the same (the
       page's one switch style, .seo2-switch, as the Advanced panels' switches) */
    var why = a.indexing && a.indexing.reason;
    var idxNote = F.noindex ? 'Google is asked not to list it. Anyone with the address can still open it.'
      : why === 'test' ? 'Not listed yet: the event’s name says it is a test.'
      : why === 'template' ? 'Not listed yet: the site still shows template text.'
      : why === 'not-live' ? 'Listed once the site is live.' : '';
    var idx = '<div class="seo2-switch">' + toggle('seo-noindex', !F.noindex, 'Show in Google') + (idxNote ? '<p class="seo2-note">' + idxNote + '</p>' : '') + '</div>';

    return ST.ctx.panel('Google result', '', '<div class="seo2-search">' +
      searchField('title', 'Title in Google', { placeholder: a.title }) +
      searchField('description', 'Description in Google', { area: true, placeholder: basicsCut || 'One or two sentences: what it is, for whom, when and where.' }) +
      kw + h1 +
      '<div class="seo2-group">' + canon + idx + '</div>' +
      '</div>');
  }

  /* "When the link is shared" (WhatsApp, LinkedIn and X): the share picture, small, as the preview above shows it
     large, with its state in one line and its two actions (the console's own field, CTX.seo.sharePictureField, which
     saves itself at once as it always did; how the picture is made, and the square crop WhatsApp uses, are folded
     inside it). It is handed the picture the next publish gives (the preview's), so the two always show the same one.
     A shared link's title and description are always the ones in Google (the publish writes og:title and
     og:description from the same values): one line says so, with the way to change them — the preview shows them. */
  function socialHtml() {
    var M = ST.ctx.seo, share = M && M.sharePictureField ? M.sharePictureField(ST.ctx.EV, ST.data.head.ogImage || '') : '';
    return ST.ctx.panel('When the link is shared', 'WhatsApp, LinkedIn and X',
      '<p class="seo2-sh-label" aria-hidden="true">Share picture</p>' + share +
      '<p class="seo2-sh-src">A shared link shows the title and description in Google. <button class="seo2-link" type="button" data-seo2-sh="edit">Change them</button></p>');
  }
  /* "Change them" goes to the title in Google (the search panel's own field, found by what the form reads) */
  function wireSharing(root) {
    var b = root.querySelector('[data-seo2-sh="edit"]');
    if (b) b.onclick = function () {
      var f = root.querySelector('[data-seo-field="title"]');
      if (!f) return;
      if (f.scrollIntoView) f.scrollIntoView({ block: 'center' });
      try { f.focus({ preventScroll: true }); } catch (err) { f.focus(); }
    };
  }

  /* ---------- Advanced: the event's details and its rich results (the two panels of the "Advanced" fold) ----------
     Neat and calm (the owner, 14 Nov 2026: "too noisy, it should be neat and clean"): what is filled in for the team
     reads as quiet facts with one line saying where they come from, the few fields the team may add sit under them,
     and speakers, FAQs and testimonials are tidy rows to tick. A value's source and a warning are one muted line
     each, never a coloured pill; the structured data the next publish gives follows, folded. */

  /* one muted line under a field, a list or a switch: where a value comes from, what is used without one, or (warn)
     what is left out and why. html: already escaped */
  function richNote(html, id, warn) {
    return '<p class="seo2-hint"' + (id ? ' id="' + id + '"' : '') + '>' +
      (warn ? '<span class="seo2-ico" aria-hidden="true">' + svg(ST.ctx.IC.info, 13) + '</span>' : '') + '<span>' + html + '</span></p>';
  }
  /* a text field of this part, drawn as the Google result's are: its label with the count on the right, the field,
     then one muted line (richFieldNote: what ETB2B AI left out, or that it wrote what is there, each with Suggest
     again; else what the field is for and what is used while it is empty, with Suggest with ETB2B AI for it alone),
     which follows the typing (paintRichNote). The main heading is drawn here only when the site has one of its own:
     Google reads that one, so this one waits, unused, and ETB2B AI is not offered for it. */
  var RICH_EMPTY = { schemaTitle: 'How search engines name the event in their event lists. Left empty, the event’s name is used.',
    schemaDescription: 'Left empty, the description in Google is used.' };
  function richFieldNote(k) {
    if (k === 'h1') return 'Used only when the site has no main heading of its own.';
    return aiLeftOut(k) || aiWrote(k) || ((line(ST.F[k]) ? '' : esc(RICH_EMPTY[k]) + ' ') + aiOne(k));
  }
  function richField(k, label, opts) {
    var id = 'seo-' + k, v = ST.F[k], note = richFieldNote(k);
    var attrs = ' id="' + id + '" data-seo-field="' + k + '" maxlength="' + MAX[k] + '" aria-describedby="' + id + '-hint" placeholder="' + esc(opts.placeholder || '') + '"' +
      (aiWriting(k) ? ' readonly' : '');
    var input = opts.area ? '<textarea class="inp" rows="3"' + attrs + '>' + esc(v) + '</textarea>' : '<input class="inp"' + attrs + ' value="' + esc(v) + '">';
    return '<div class="field c12" data-seo-wrap="' + k + '"><div class="seo2-lrow"><label for="' + id + '">' + (opts.html ? label : esc(label)) + '</label>' + counter(k) + '</div>' +
      input + '<p class="seo2-hint" id="' + id + '-hint"' + (note ? '' : ' hidden') + '><span>' + note + '</span></p></div>';
  }
  function paintRichNote(k) {
    var el = $('seo-' + k + '-hint');
    if (!el || !ST.F) return;
    var html = richFieldNote(k);
    el.innerHTML = '<span>' + html + '</span>';
    el.hidden = !html;
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
    /* off is said in words under the switch; the fields below stay as they are (they can still be filled in), never
       greyed out as if they could not */
    var why = !exact ? 'Not while the date is to be announced: search engines list an event by its exact date. Set the dates in ' + linkTo('content/basics', 'Basics') + '.'
      : !on ? 'Off: search engines are not given these details.' : '';
    var sw = '<div class="seo2-switch">' + toggle('seo-basicSchema', on, 'Give search engines the event’s details', (exact ? '' : ' disabled') + (why ? ' aria-describedby="seo-basic-why"' : '')) +
      (why ? richNote(why, 'seo-basic-why') : '') + '</div>';

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

    /* the few the team may add (and the main heading, when the site has its own: it waits here, unused) */
    var text = richField('schemaTitle', 'Event name in event listings', { placeholder: a.title }) +
      richField('schemaDescription', 'Event description in event listings', { area: true, placeholder: 'Two or three sentences for an event listing.' }) +
      (ownHeading() ? richField('h1', 'Main heading <span class="seo2-aside">(not shown on the page)</span>', { placeholder: a.title, html: true }) : '');
    var pv = ST.prev && ST.prev.sameVenue && ST.prev.previous && ST.prev.previous.seo.streetAddress && ST.prev.previous.seo.streetAddress !== F.streetAddress ? ST.prev.previous.seo : null;
    /* the previous edition's street address: offered once it is known to be at this venue (Use it), else, while the
       field is empty, a way to bring it in (the dialog says whether it was at the same venue) */
    var prevAddr = pv ? richNote('The previous edition at this venue gave “' + esc(pv.streetAddress) + (pv.postalCode ? ', ' + esc(pv.postalCode) : '') + '”. ' +
        '<button class="seo2-link" type="button" data-seo="use-prev-address">Use it</button>')
      : !line(F.streetAddress) ? richNote('<button class="seo2-link" type="button" data-seo="prev-addr"' + (ST.prevBusy ? ' disabled' : '') + '>' +
        (ST.prevBusy ? 'Reading the previous edition…' : 'Bring in the previous edition’s address') + '</button>') : '';
    var mode = '<select class="inp" id="seo-attendanceMode" data-seo-field="attendanceMode">' +
      [['', 'Automatic: ' + (a.attendanceAuto === 'offline' ? 'in person (it has a venue)' : 'not said (no venue yet)')], ['offline', 'In person'], ['online', 'Online'], ['mixed', 'In person and online']].map(function (o) {
        return '<option value="' + o[0] + '"' + (F.attendanceMode === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    var where = '<div class="field c8"><label for="seo-streetAddress">Street address</label>' +
        '<input class="inp" id="seo-streetAddress" data-seo-field="streetAddress" maxlength="200" value="' + esc(F.streetAddress) + '" placeholder="e.g. National Highway 8, Ambience Island, DLF Phase 3">' +
        prevAddr + '</div>' +
      '<div class="field c4"><label for="seo-postalCode">Postcode</label>' +
        '<input class="inp" id="seo-postalCode" data-seo-field="postalCode" maxlength="12" inputmode="text" value="' + esc(F.postalCode) + '" placeholder="e.g. 122010"></div>' +
      '<div class="field c6"><label for="seo-attendanceMode">How people attend</label>' + mode + '</div>' +
      '<div class="field c6"><span class="flabel" id="seo-geo-label">Latitude and longitude</span><div class="seo2-pair" role="group" aria-labelledby="seo-geo-label">' +
        '<div><input class="inp" id="seo-latitude" data-seo-field="latitude" inputmode="decimal" value="' + (F.latitude == null ? '' : esc(String(F.latitude))) + '" placeholder="e.g. 28.5022" aria-label="Latitude" aria-describedby="seo-geo-hint"></div>' +
        '<div><input class="inp" id="seo-longitude" data-seo-field="longitude" inputmode="decimal" value="' + (F.longitude == null ? '' : esc(String(F.longitude))) + '" placeholder="e.g. 77.0969" aria-label="Longitude" aria-describedby="seo-geo-hint"></div>' +
        '</div>' + richNote('Optional, to put the venue on a map: in Google Maps, right-click the venue and click the two numbers at the top to copy them, then paste them here.', 'seo-geo-hint') + '</div>';

    return ST.ctx.panel('Event details for search engines', '', '<div class="seo2-rich">' + sw +
      '<div class="seo2-body"><div class="seo2-group">' + facts + '</div>' +
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
    /* left out because the site does not show them (search engines require what they are given to be on the page);
       the way to show them depends on whether the site already has the section */
    var notShownS = d.speakers.filter(function (s) { return s.confirmed && line(s.name) && !s.shown && F.speakersOff.indexOf(s.id) === -1; }).length;
    var notShownF = d.faqs.filter(function (f) { return f.counts && !f.shown && F.faqsOff.indexOf(f.id) === -1; }).length;
    var notShownT = F.testimonials.filter(function (t) { return !t.off && d.testimonials[t.id] && !d.testimonials[t.id].shown; }).length;
    var editor = linkTo('design/editor', 'site editor');
    function leftOut(n, one, many, section, has) {
      var it = n === 1 ? 'it' : 'them';
      return richNote(n + ' ' + (n === 1 ? one + ' is' : many + ' are') + ' not on the site, so search engines are not given ' + it + '. ' +
        (has ? 'Show ' + it + ' in the site’s ' + section + ' section, in the ' + editor + '.' : 'Add ' + (section === 'FAQ' ? 'an ' : 'a ') + section + ' section in the ' + editor + ' to show ' + it + '.'), '', true);
    }
    /* a testimonial is on the site when the site shows its very words (seo-schema.js showsTestimonial): a section of
       testimonials is not filled from this list, so the words are what to put there */
    function tmLeftOut(n, has) {
      var it = n === 1 ? 'it' : 'them';
      return richNote(n + (n === 1 ? ' testimonial is' : ' testimonials are') + ' not on the site, so search engines are not given ' + it + '. To give ' + it + ', put the same words in ' +
        (has ? 'the site’s testimonials section' : 'a testimonials section') + ' in the ' + editor + '.', '', true);
    }

    var speakers = '<div class="seo2-group">' + richHead('Speakers', sp.length ? linkTo('content/speakers', 'Edit in Content › Speakers') : '') +
      (sp.length ? richRows(sp, 'sp', 'speakers') + (notShownS ? leftOut(notShownS, 'speaker', 'speakers', 'speakers', d.speakers.some(function (s) { return s.shown; })) : '')
        : richNote('No speakers in ' + linkTo('content/speakers', 'Content › Speakers') + ' yet.')) + '</div>';
    var faqs = '<div class="seo2-group">' + richHead('FAQs', fq.length ? linkTo('content/faq', 'Edit in Content › FAQ') : '') +
      (fq.length ? richRows(fq, 'fq', 'FAQs') + (notShownF ? leftOut(notShownF, 'FAQ', 'FAQs', 'FAQ', d.faqs.some(function (f) { return f.shown; })) : '')
        : richNote('No FAQs in ' + linkTo('content/faq', 'Content › FAQ') + ' yet. ETB2B AI can draft five or six from the event’s details and add them there, for you to check.') +
          '<div class="seo2-acts"><button class="btn btn-secondary btn-sm" type="button" data-seo="faq-draft"' + (ST.aiBusy ? ' disabled' : '') + '>' + svg(ST.ctx.IC.star, 13) + ' Draft FAQs with ETB2B AI</button></div>') + '</div>';
    n = F.testimonials.length;
    var tms = '<div class="seo2-group">' + richHead('Testimonials', '') +
      (n ? '<ul class="seo2-rows">' + ts.join('') + '</ul>' : richNote('None yet. Add what people who were there said, in their own words, or bring them in from the previous edition.')) +
      (notShownT ? tmLeftOut(notShownT, F.testimonials.some(function (t) { return d.testimonials[t.id] && d.testimonials[t.id].shown; })) : '') +
      '<div class="seo2-acts"><button class="btn btn-secondary btn-sm" type="button" data-seo="tm-add"' + (n >= 30 ? ' disabled aria-describedby="seo-tm-max"' : '') + '>Add a testimonial</button>' +
        '<button class="btn btn-secondary btn-sm" type="button" data-seo="prev-tm"' + (ST.prevBusy ? ' disabled' : '') + '>' + (ST.prevBusy ? 'Reading the previous edition…' : 'Bring in testimonials from the previous edition') + '</button>' +
        (n >= 30 ? '<span class="seo2-faint" id="seo-tm-max">30 is the most.</span>' : '') + '</div></div>';
    var rating = '<div class="seo2-group"><dl class="seo2-facts"><dt>Rating</dt><dd>' + ratingNow().text + '</dd>' +
      '<dt>Passes and prices</dt><dd><span class="seo2-faint">Not given</span></dd></dl>' +
      richNote('The rating is the average of the star ratings of the testimonials the site shows. Prices are left out until the site shows passes.') + '</div>';

    /* what a tick does, said once under the switch; off is said there too, and the rows below stay as they are (they
       can still be ticked), never greyed out as if they could not */
    return ST.ctx.panel('Speakers, FAQs and reviews in Google', '', '<div class="seo2-rich">' +
      '<div class="seo2-switch">' + toggle('seo-advancedSchema', adv, 'Give search engines the speakers, FAQs and reviews', ' aria-describedby="seo-adv-why"') +
        richNote(adv ? 'Ticked speakers, FAQs and testimonials go to search engines when the site shows them; untick one to leave it out.'
          : 'Off: search engines are not given the speakers, FAQs or reviews.', 'seo-adv-why') + '</div>' +
      '<div class="seo2-body">' + speakers + faqs + tms + rating + '</div></div>') + structuredHtml();
  }
  /* the rating as it would be given: the included testimonials whose words the site shows (as last saved), with a rating */
  function ratingNow() {
    var d = ST.data, list = ST.F.testimonials.filter(function (t) { return !t.off && t.rating && d.testimonials[t.id] && d.testimonials[t.id].shown; });
    if (!list.length) return { text: '<span class="seo2-faint">None yet: no testimonial with a rating is on the site</span>' };
    var sum = list.reduce(function (a, t) { return a + t.rating; }, 0), avg = Math.round(sum / list.length * 10) / 10;
    return { text: '<b>' + avg + '</b> ' + stars(Math.round(avg)) + ' <span class="seo2-faint">from ' + list.length + (list.length === 1 ? ' rating' : ' ratings') + '</span>' };
  }
  /* what the next publish gives search engines, as they read it (the page's structured data: code, so it is said to
     be for developers), folded under the panels; drawn once, here, and kept open across a redraw once opened
     (ST.ldOpen, wireShell) */
  function structuredHtml() {
    var s = ST.data.schema, list = [s.event, s.faq].filter(Boolean);
    if (!list.length) return '<p class="seo2-ld seo2-hint">For developers: there is no code for search engines yet.</p>';
    return '<details class="seo2-ld" id="seo2-ld"' + (ST.ldOpen ? ' open' : '') + '><summary>For developers: the code search engines read</summary><pre>' +
      esc(JSON.stringify(list, null, 2)) + '</pre></details>';
  }

  /* the words both previews show, as typed (the event's own name, Basics' short description and the site's own address
     without them): drawn by previewHtml and repainted while typing by paintLive */
  function previewText() {
    var d = ST.data, F = ST.F;
    var desc = line(F.description) || d.head.description || '', url = line(F.canonicalUrl) || d.auto.url;
    return { title: line(F.title) || d.auto.title || 'Untitled event', desc: desc.length > 158 ? desc.slice(0, 157).replace(/\s+\S*$/, '') + ' …' : desc,
      where: url.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/\//g, ' › '), dom: url.replace(/^https?:\/\//, '').split('/')[0] };
  }
  /* the page's anchor: the Google result and the shared link, side by side on a wide screen, one above the other on a
     narrow one. The picture is the one the next publish gives (the share picture, or the automatic one). */
  function previewHtml() {
    var d = ST.data, p = previewText();
    var pic = d.head.ogImage && ST.ctx.seo && ST.ctx.seo.imgTag ? ST.ctx.seo.imgTag(d.head.ogImage) : '';
    return '<section class="seo2-pv" aria-label="Preview">' +
      '<div class="seo2-pv-one"><div class="seo2-pv-h" id="seo2-pv-g">In Google</div><div class="mock mock-serp" role="group" aria-labelledby="seo2-pv-g">' +
        '<div class="u" id="seo-pv-url">' + esc(p.where) + '</div><div class="t" id="seo-pv-title">' + esc(p.title) + '</div><div class="d" id="seo-pv-desc">' + esc(p.desc) + '</div></div></div>' +
      '<div class="seo2-pv-one"><div class="seo2-pv-h" id="seo2-pv-s">As a shared link</div><div class="mock mock-og seo-og" role="group" aria-labelledby="seo2-pv-s">' +
        '<div class="img seo-og-img">' + (pic || '<span class="md">No picture yet: the link shows words only</span>') + '</div>' +
        '<div class="cap"><span class="dom">' + esc(p.dom) + '</span><b id="seo-og-title">' + esc(p.title) + '</b><span id="seo-og-desc">' + esc(p.desc) + '</span></div></div></div>' +
      '</section>';
  }

  /* the readiness checklist (functions/lib/api-seo.js readiness), one line under the preview until it is opened:
     "Checklist: 3 of 5 done" — what is left to do here. What cannot be done on this page, or is an optional extra, is
     a note (level 'info': listed, never counted). Its groups and items are named in the page's own words; an item's
     text is the server's. */
  var READY_GROUP = [['search', 'Google result'], ['sharing', 'When the link is shared'], ['schema', 'Event details for search engines'], ['rich', 'Speakers, FAQs and reviews in Google']];
  var READY_LABEL = { title: 'Title in Google', description: 'Description in Google', keywords: 'Search words', h1: 'Main heading', indexing: 'Show in Google',
    image: 'Share picture', basic: 'Event details', advanced: 'Speakers, FAQs and reviews' };
  function readyLabel(i) {
    if (/^problem-/.test(i.id)) return /address must be PostalAddress/.test(i.text) ? 'Full address' : 'Event details';
    return READY_LABEL[i.id] || i.label;
  }
  /* a problem the server's check found in what search engines read (functions/lib/site-seo.js checkJsonLd) comes as a
     technical line: the one the team can fix is said in plain words, any other plainly, its technical words after */
  function readyText(i) {
    if (!/^problem-/.test(i.id)) return i.text;
    if (/address must be PostalAddress/.test(i.text)) return 'Search engines get only the venue’s name as its address until the street address and postcode are added.';
    return 'Search engines may not read all of it (' + i.text + ').';
  }
  function readyHtml() {
    var items = ST.data.ready || [];
    var counted = items.filter(function (i) { return i.level !== 'info'; }), done = counted.filter(function (i) { return i.ok; }).length;
    var body = READY_GROUP.map(function (g) {
      var mine = items.filter(function (i) { return i.group === g[0]; });
      if (!mine.length) return '';
      return '<div class="seo-rg"><div class="seo-rg-h">' + esc(g[1]) + '</div>' + mine.map(function (i) {
        return '<div class="seo-check"><span class="dash-dot dash-dot-' + (i.ok ? 'ok' : i.level === 'info' ? 'mute' : 'warn') + '" aria-hidden="true"></span><span><b>' + esc(readyLabel(i)) +
          '<span class="rv-sr"> — ' + (i.ok ? 'complete' : i.level === 'info' ? 'note' : 'needs a look') + '</span></b><span>' + esc(readyText(i)) + '</span></span></div>';
      }).join('') + '</div>';
    }).join('');
    return '<details class="seo2-ready" id="seo2-ready"' + (ST.readyOpen ? ' open' : '') + '><summary><b>Checklist: ' + done + ' of ' + counted.length + ' done</b>' +
      '<span class="seo2-link seo2-show">Show</span><span class="seo2-link seo2-hide">Hide</span></summary>' +
      '<div class="seo2-ready-body">' + (dirty() ? '<p class="seo2-quiet">As last saved: save to check your changes.</p>' : '') + body + '</div></details>';
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
  /* the counters (#seo-ctr-<field>: "n / ideal", class ctr seo-ctr [over|warn]), both previews and the save bar */
  function paintLive() {
    if (!$('seo-root')) return;
    var F = ST.F;
    ['title', 'description', 'h1', 'schemaTitle', 'schemaDescription'].forEach(function (k) {
      var c = $('seo-ctr-' + k);
      if (c) { var n = line(F[k]).length, ideal = IDEAL[k]; c.textContent = n + ' / ' + ideal; c.className = 'ctr seo-ctr' + (n > ideal ? ' over' : n > ideal * 0.9 ? ' warn' : ''); }
    });
    var p = previewText();
    [['seo-pv-title', p.title], ['seo-pv-desc', p.desc], ['seo-og-title', p.title], ['seo-og-desc', p.desc], ['seo-pv-url', p.where]].forEach(function (x) { var el = $(x[0]); if (el) el.textContent = x[1]; });
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
  /* back to what is saved, the main web address included: a box opened for another address closes again */
  function forget() { ST.F = clone(ST.B); ST.failed = ''; ST.canonOpen = false; }
  function discard() { forget(); redraw(); }

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
  /* before ETB2B AI replaces words that are already there (typed just now, or saved by anyone on the team): asked, in
     words that fit whoever wrote them */
  function askThenWrite(fields, all) {
    var typed = typedIn(fields);
    if (!typed.length) return writeAi(fields);
    var M = ST.ctx.seo, it = typed.length === 1 ? 'it' : 'them';
    var names = joinAnd(typed.map(function (k) { return LABEL[k]; }));
    var empty = fields.filter(function (k) { return typed.indexOf(k) === -1; });
    var both = all && empty.length;
    var m = M.openModal('<div class="modal-head"><h3>' + (all ? 'Replace what is already filled in?' : 'Replace the ' + esc(LABEL[typed[0]]) + '?') + '</h3>' + M.closeBtn() + '</div>' +
      '<div class="modal-body"><div class="confirm-msg">' + esc(names) + (typed.length === 1 ? ' is' : ' are') + ' already filled in. ETB2B AI can write ' + it +
      ' again from the event’s details; Undo puts back what is there now.</div></div>' +
      '<div class="modal-foot"><button class="btn btn-secondary" type="button" data-close>Cancel</button><span style="flex:1"></span>' +
      (both ? '<button class="btn btn-secondary" type="button" id="seo-ask-empty">Fill only the empty ones</button>' : '') +
      '<button class="btn btn-primary" type="button" id="seo-ask-all">Replace ' + it + (both ? ' as well' : '') + '</button></div>', { style: 'width:min(520px,100%)', initialFocus: '#seo-ask-all' });
    var e1 = $('seo-ask-empty'), e2 = $('seo-ask-all');
    if (e1) e1.onclick = function () { m.close(); writeAi(empty); };
    e2.onclick = function () { m.close(); writeAi(fields); };
  }
  function writeAi(fields) {
    if (!fields.length || ST.aiBusy) return;
    var ev = ST.ctx.EV;
    ST.aiBusy = 'ETB2B AI is writing ' + (fields.length > 2 ? 'the search text' : fields.map(function (k) { return LABEL[k]; }).join(' and ')) + ' from the event’s details…';
    /* the fields being written cannot be typed in meanwhile (they are drawn read-only): the answer replaces them */
    ST.aiFields = fields.slice();
    ST.undo = null; ST.dropped = [];
    redraw();
    C.writeSeo(ev.id, fields).then(function (res) {
      ST.aiBusy = ''; ST.aiFields = [];
      var keys = Object.keys(res.values || {});
      keys.forEach(function (k) { ST.F[k] = clone(res.values[k]); ST.B[k] = clone(res.values[k]); });
      ST.B.aiWritten = res.aiWritten || ST.B.aiWritten; ST.F.aiWritten = ST.B.aiWritten;
      ev.settings = ev.settings || {}; ev.settings.seo = Object.assign({}, ev.settings.seo || {}, res.values, { aiWritten: ST.B.aiWritten });
      if (res.updatedAt) { ev.updatedAt = res.updatedAt; ev.detailsUpdatedAt = res.updatedAt; }
      ST.dropped = res.dropped || [];
      /* "see below" must be on screen: a field left out inside the closed Advanced fold opens it */
      if (ST.dropped.some(function (x) { return inAdvanced(x.field); })) ST.advOpen = true;
      var said = keys.length ? 'ETB2B AI wrote ' + keys.map(function (k) { return LABEL[k]; }).join(', ') + ' and saved ' + (keys.length === 1 ? 'it' : 'them') + (res.previous ? ', with the previous edition as a reference' : '') + '.' :
        'ETB2B AI wrote nothing that could be used: every field is as it was.';
      if (ST.dropped.length) said += ' ' + ST.dropped.length + (ST.dropped.length === 1 ? ' field was' : ' fields were') + ' left out (see below).';
      ST.undo = keys.length ? { said: said, fields: keys, before: res.before || {}, aiWrittenBefore: res.aiWrittenBefore || [] } : { said: said, fields: [], before: null };
      return load(true);
    }, function (err) {
      ST.aiBusy = ''; ST.aiFields = [];
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
      '<div class="modal-body"><p class="confirm-msg">' + (again ? 'Pick another of ' + who + '’s past ' + kind + ' on ETB2B.'
        : 'No previous edition is on record for this event. Pick it from ' + who + '’s past ' + kind + ' on ETB2B; its testimonials and, at the same venue, its street address can then be brought in.') + '</p>' +
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
      '<div class="modal-body"><p class="confirm-msg">From ETB2B’s record of the previous edition' + (p.link ? ' (<a class="seo2-link" href="' + esc(p.link) + '" target="_blank" rel="noopener">its site</a>)' : '') + '. Nothing changes until you save.</p>' +
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
      /* what was brought in is in the Advanced fold: it is open, so it is seen */
      if (n) ST.advOpen = true;
      redraw();
      focusOn('[data-seo="' + (only === 'addr' ? 'prev-addr' : 'prev-tm') + '"]', a && a.checked ? 'seo-streetAddress' : '');
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
      focusOn(editing ? '[data-seo-tm-edit="' + i + '"]' : '[data-seo="tm-add"]');
      ST.ctx.toast((editing ? 'Testimonial updated.' : 'Testimonial added.') + ' Save changes to keep it.');
    }
  }

  /* ---------- wiring ---------- */
  /* the page's folds stay as the person left them while the section is drawn again (a toggle or a save redraws it) */
  function wireShell() {
    [['seo2-adv', 'advOpen'], ['seo2-ready', 'readyOpen'], ['seo2-ld', 'ldOpen'], ['seo2-chg', 'chgOpen']].forEach(function (f) {
      var el = $(f[0]);
      if (el) el.addEventListener('toggle', function () { ST[f[1]] = el.open; });
    });
  }
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
    wireShell();
    if (ctx.seo && ctx.seo.wireSharePicture) ctx.seo.wireSharePicture();
    wireSharing(root);
    ctx.seo.setLeave({ label: 'Search and sharing', dirty: dirty, save: save, discard: forget });

    /* typing: kept in the form, counted, previewed, never redrawn under the cursor */
    root.addEventListener('input', function (e) {
      var k = e.target && e.target.getAttribute && e.target.getAttribute('data-seo-field');
      if (!k) return;
      ctx.seo.clearFieldError(e.target);
      if (k === 'latitude' || k === 'longitude') {
        /* the two numbers Google Maps copies ("28.502210, 77.096887"), pasted into either box, fill both */
        var pair = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(e.target.value);
        if (pair) {
          ST.F.latitude = +pair[1]; ST.F.longitude = +pair[2];
          [['seo-latitude', pair[1]], ['seo-longitude', pair[2]]].forEach(function (x) { var el = $(x[0]); if (el) { el.value = x[1]; ctx.seo.clearFieldError(el); } });
        } else ST.F[k] = numberOf(e.target.value);
      }
      else ST.F[k] = e.target.value;
      ST.failed = '';
      paintLive();
    });
    /* the line under a text field follows the typing, in the Google result and the event details alike: a field ETB2B AI
       wrote is the team's once edited, an emptied one says what is used instead, a long one what is cut off (the main
       heading in Advanced, unused while the site has its own, keeps its one line) */
    root.addEventListener('input', function (e) {
      var k = e.target && e.target.getAttribute && e.target.getAttribute('data-seo-field');
      if (k === 'title' || k === 'description' || (k === 'h1' && !ownHeading())) paintSearchNote(k);
      else if (k === 'schemaTitle' || k === 'schemaDescription') paintRichNote(k);
    });
    root.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.getAttribute('data-seo-field') === 'attendanceMode') { ST.F.attendanceMode = t.value; paintLive(); return; }
      var sp = t && t.getAttribute('data-seo-sp'), fq = t && t.getAttribute('data-seo-fq'), tm = t && t.getAttribute('data-seo-tm-on');
      if (sp) { ST.F.speakersOff = ST.F.speakersOff.filter(function (x) { return x !== sp; }); if (!t.checked) ST.F.speakersOff.push(sp); paintLive(); }
      if (fq) { ST.F.faqsOff = ST.F.faqsOff.filter(function (x) { return x !== fq; }); if (!t.checked) ST.F.faqsOff.push(fq); paintLive(); }
      if (tm != null) {
        var row = ST.F.testimonials[+tm];
        if (row) { if (t.checked) delete row.off; else row.off = true; }
        redraw();
        if (row) focusAgain('seo-tm-' + row.id);
      }
    });
    wireRich(root);
    function addKeyword() {
      var inp = $('seo-kw-in'), v = line(inp && inp.value);
      if (!v || aiWriting('keywords')) return;
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
      if (b.hasAttribute('data-seo-tm-x')) { ST.F.testimonials.splice(+b.getAttribute('data-seo-tm-x'), 1); redraw(); focusOn('[data-seo="tm-add"]'); ctx.toast('Testimonial removed. Save changes to keep that.'); return; }
      if (b.id === 'seo-noindex') { ST.F.noindex = !ST.F.noindex; redraw(); focusAgain('seo-noindex'); return; }
      if (b.id === 'seo-basicSchema') { if (!ST.data.auto.dates.exact) return; ST.F.basicSchema = !ST.F.basicSchema; redraw(); focusAgain('seo-basicSchema'); return; }
      if (b.id === 'seo-advancedSchema') { ST.F.advancedSchema = !ST.F.advancedSchema; redraw(); focusAgain('seo-advancedSchema'); return; }
      if (!what) return;
      act(what);
    });
    /* the action in the view's heading (Suggest with ETB2B AI) is drawn above #seo-root, so it is wired here itself */
    Array.prototype.forEach.call(document.querySelectorAll('.vhead [data-seo="ai-all"]'), function (b) {
      b.onclick = function () { act(b.getAttribute('data-seo')); };
    });
    function act(what) {
      if (what === 'ai-all') askThenWrite(aiFields(), true);
      else if (what === 'undo') { if (ST.undo && ST.undo.faqs) undoFaqs(); else undo(); }
      else if (what === 'kw-add') addKeyword();
      else if (what === 'canon-own') { ST.canonOpen = true; redraw(); var c = $('seo-canonicalUrl'); if (c) c.focus(); }
      else if (what === 'canon-auto') { ST.canonOpen = false; ST.F.canonicalUrl = ''; redraw(); focusOn('[data-seo="canon-own"]'); }
      else if (what === 'prev-tm') bringIn('tm');
      else if (what === 'prev-addr') bringIn('addr');
      else if (what === 'use-prev-address') { var pv = ST.prev.previous.seo; ST.F.streetAddress = pv.streetAddress; if (pv.postalCode) ST.F.postalCode = pv.postalCode; redraw(); focusAgain('seo-streetAddress'); }
      else if (what === 'tm-add') testimonialDialog(null);
      else if (what === 'faq-draft') draftFaqs();
      else if (what === 'publish') ctx.seo.publish();
    }
    wireSaveBar();
  }
  /* after a redraw, the keyboard's place is kept: the element by id, or the first match of a selector */
  function focusAgain(id) { setTimeout(function () { var el = $(id); if (el) el.focus(); }, 0); }
  function focusOn(sel, id) { setTimeout(function () { var el = (id && $(id)) || (sel && document.querySelector(sel)); if (el && el.focus) el.focus(); }, 0); }

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

  /* reload: what the server says is read again, keeping anything typed (after a publish, or after the share picture
     saved itself); it hands back the promise, so the caller can put the keyboard back where it was */
  global.EditEventSEO = { view: view, wire: wire, reload: function () { return ST.ctx ? load(true) : Promise.resolve(); }, _state: ST, _formOf: formOf };
})(window);
