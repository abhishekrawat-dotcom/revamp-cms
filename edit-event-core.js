/* ===========================================================================
   ET Oneworld - Revamp CMS
   Edit Event : CORE

   Shared foundation for the event console. Everything here is used by the
   shell (edit-event.html) AND by the standalone section workbenches, so a
   section file can be opened and worked on entirely on its own.

   Exposes one global: window.RevampCore

     .IC                  icon path table
     .esc .svg            escaping and icon rendering
     .comma .compact .money
     .fmtDate(v)          "14 Mar 2027" — a date-only value is that calendar day, never shifted or timed
     .fmtDT(v)            "Mar 14, 2027 (07:00 PM)" — the time only when the value has one
     .fmtRange(start,end) "14–15 Mar 2027", "30 Mar – 2 Apr 2027"; '' with no start
     .PORTALS .AV
     .TYPES               the one table of event categories (key -> label); no page keeps its own
     .slugify(text)       the event-address rule (same as the backend's)
     .isReservedSlug(s)   true for an address no event can have (gen-…, imported-…, numbers, new, …)

     The API client. Every call returns a promise; a failure rejects with an Error whose
     .message can be shown to a user as it is and whose .status is the HTTP status (0 when
     the server could not be reached). Extra fields of the server's error answer (.code,
     .suggestion, .current) are copied onto the Error.

     .authedFetch(url, opts)      the one way to call /api/* — RevampAuth.authedFetch when auth.js
                                   provides it (fresh token, one retry on 401, sign-in redirect)
     Events
     .fetchEvents(opts)           GET    /api/events -> [event]   (opts.deleted: the deleted ones)
     .fetchEvent(eventId)         GET    /api/event -> event
     .createEvent(data)           POST   /api/event -> {ok, eventId, createdAt, updatedAt}; 409 -> err.code
                                   'slug-taken', 400 -> err.code 'slug-reserved'; both carry err.suggestion
     .updateEvent(eventId, patch, {ifUpdatedAt})
                                  PATCH  /api/event -> {ok, updatedAt}; with ifUpdatedAt, 409 -> err.code
                                   'stale', err.current {updatedAt, updatedBy} (someone else saved first)
     .slugAvailable(slug)         GET    /api/event/slug-available -> {available, suggestion, reason, message}
     .deleteEvent(eventId)        DELETE /api/event — restorable; the address stays reserved
     .discardEvent(eventId)       DELETE /api/event?discard=1 — a draft this user just created and has not
                                   worked on is removed for good and its address freed; anything else
                                   -> 409 err.code 'not-discardable', nothing changed
     .restoreEvent(eventId)       POST   /api/event/restore
     .cloneEvent(sourceEventId, eventId, name)
                                  POST   /api/event/clone -> {eventId, name, templateId, copied};
                                   409 -> err.code 'slug-taken', err.suggestion
     The site
     .fetchSite(eventId)          GET    /api/event/site -> {version, templateId, updatedAt, updatedBy,
                                   snapshot}, or null when the site has never been saved
     .saveSite(eventId, {templateId, baseVersion, snapshot, html, force})
                                  PUT    /api/event/site -> {version, updatedAt}; 409 -> err.current
                                   {version, updatedAt, updatedBy} (someone else saved first)
     .publishEvent(eventId)       POST   /api/event/publish -> {publishedPath, publishedUrl, publishedAt,
                                   publishedVersion}; 409 when no site was ever saved. Publishes the SAVED
                                   site. (publishEvent(eventId, html) — the older form — still works.)
     .unpublishEvent(eventId)     POST   /api/event/unpublish
     .previewUrl(eventId)         -> absolute URL of /preview/<id> (a string, not a promise)
     .publicUrl(event)            -> absolute URL of the event's public page, location.origin + /e/<id>
                                   (a string, not a promise; '' when the event has no id)
     .stageEvent(eventId, html)   POST   /api/event/stage — the older Preview; kept for cached editors
     .fetchSiteData(eventId)      GET    /api/public/site-data -> what the site shows (section 5 shape)
     Content
     .uploadImage(eventId, kind, file)
                                  POST   /api/event/upload -> {url, path}. file is a File or Blob; kind is
                                   speakers | partners | gallery | logo | banner | media | brief. Refuses a
                                   non-image or anything over 8 MB before sending.
     .refreshLogoUnit(eventId)    POST   /api/event/logo-unit -> {aiDesigned, unit, heroUpdated, savedSite}: the
                                   event's uploaded logo examined (its year brought to this edition's) and
                                   made the AI-designed site's hero logo; a saved site is left to the editor
     .logoUnitDark(eventId, url)  POST   /api/event/logo-unit-dark -> {url, width, height} | {url:'', why, note}: a
                                   picture put into the hero's logo unit, copied for a dark background (or why not)
     .seedContent(eventId, payload) POST /api/event/seed -> {created}
     .fetchHeroVideo / .uploadHeroVideo / .saveHeroVideo / .removeHeroVideo   the banner video
                                  (/api/event/hero-video…; see the functions themselves)
     .fetchSub(resource, eventId)              GET    /api/event/<resource> — list, in `order`
     .createSub(resource, eventId, data)       POST   /api/event/<resource> — create, -> {id, createdAt, updatedAt}
     .updateSub(resource, eventId, id, patch, {ifUpdatedAt})
                                               PATCH  /api/event/<resource> -> {ok, updatedAt}
     .deleteSub(resource, eventId, id)         DELETE /api/event/<resource> — delete
       resource is one of: speakers, speaker-groups, sessions, agenda-groups, partners,
       partner-tiers, gallery, faqs, contacts, promo-templates, promo-audiences, leads.
       A refused value rejects with err.field naming the field.
     Leads (Promotions)
     .fetchLeads(eventId)                     -> [lead], all of them, with .total
     .bulkCreateLeads(eventId, items, {onDuplicate, importId})   -> {created, updated, skipped, ids}
     .bulkUpdateLeads(eventId, ids, patch)    -> {updated, missing}
     .bulkDeleteLeads(eventId, ids)           -> {deleted}
     .appendLeadNote(eventId, id, {kind, text})  .removeLeadNote(eventId, id, at)
     Registrations and reporting
     .fetchRegistrations(eventId)             GET    /api/event/registrations -> [registration], ALL of them
                                               (it follows the pages), with .total
     .fetchRegistrations(eventId, {limit, cursor, formId})    -> {items, total, nextCursor} — one page of any size
                                               list; with formId only that form's responses (total is that form's)
     .exportRegistrations(eventId, {formId, status})  GET /api/event/registrations/export -> {blob, filename}: the
                                               CSV (UTF-8, a column per answer), for a download
     .updateRegistration(eventId, id, patch)  PATCH  /api/event/registrations ({status, checkedIn, notes, tags})
                                               -> {ok, registration}
     .deleteRegistration(eventId, id)         DELETE /api/event/registrations
     .fetchStats(eventId, days)   GET    /api/event/dashboard-stats (days defaults to 30). conversion is a
                                   percentage (registrations per 100 page views); byDay has every day of
                                   the window, as India days
     .fetchInsights(days)         GET    /api/insights — the same totals across all events
     .fetchActivity(eventId)      GET    /api/event/activity -> [{at, by, action, detail}], newest first
     Registration forms (one event has several: Register now, Express interest, VIP delegates…)
     .fetchForms(eventId)         GET    /api/event/forms -> {forms, defaultFormId, materialized, templates,
                                   fieldTypes, presets, countries, limits, registration, published, updatedAt}
     .createForm(eventId, {form} | {template} | {duplicateOf})
                                  POST   /api/event/forms -> {form}; exactly one of the three
     .updateForm(eventId, formId, form, ifUpdatedAt)
                                  PUT    /api/event/forms -> {form}; the whole form. 409 -> err.code 'stale',
                                   err.form (the stored form, whose updatedAt a second try sends)
     .deleteForm(eventId, formId, {force})
                                  DELETE /api/event/forms -> {ok, formId}; 409 -> err.code 'default-form', or
                                   'form-in-use' with err.saved / err.published (places that use it) unless forced
     .setDefaultForm(eventId, formId)  POST /api/event/forms/default -> {ok, defaultFormId}
     .reorderForms(eventId, ids)  POST   /api/event/forms/order -> {ok, forms}; ids: every form id, in the new order

     .statTile .panel .panelFlush .emptyState
     .toast(msg)          a success message;  .toast(msg, { kind: 'error' }) a failure (no tick, stays
                          longer);  { kind: 'info' };  { action: { label, onClick } } adds a button.
                          Draws itself on a page without the console's stylesheet.
     .loadState(key) .saveState(key, obj)
     .makeCtx(opts)       builds the object every section view receives

   Every API call needs a signed-in session (window.RevampAuth, auth.js). Without one the
   promise rejects — nothing here throws — so callers .catch() and show the message.
   =========================================================================== */

window.RevampCore = (function(){
  'use strict';

  function $(id){ return document.getElementById(id); }

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function svg(inner, size){
    return '<svg width="' + (size||16) + '" height="' + (size||16) + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }

  var IC = {
    grid:     '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
    sliders:  '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
    megaphone:'<path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a5 5 0 0 1 0 8"/><path d="M18.5 5a9 9 0 0 1 0 14"/>',
    brush:    '<path d="M12 2l7 7-9 9H3v-7z"/><path d="M15 5l4 4"/>',
    users:    '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8.5a3 3 0 0 1 0 6"/><path d="M18.5 20a5.6 5.6 0 0 0-3-4.4"/>',
    mail:     '<rect x="2.5" y="4.5" width="19" height="15" rx="2.2"/><path d="M3 7l9 6 9-6"/>',
    headset:  '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="13" width="4.5" height="6" rx="1.7"/><rect x="17" y="13" width="4.5" height="6" rx="1.7"/><path d="M20 19v.7a2.6 2.6 0 0 1-2.6 2.6H13"/>',
    bell:     '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.2 7.5-2.2 7.5h16.4S18 14.5 18 8.5z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
    chart:    '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15.5 3.5A9 9 0 0 1 20.5 8.5H15.5z"/>',
    card:     '<rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M2.5 10h19"/>',
    gear:     '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2v.18a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.93-1.15l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.5 13.6h-.18a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.57 6.67L4.5 6.6a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.4 2.6v-.18a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1.02h.18a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1.02z"/>',
    image:    '<rect x="3" y="4.5" width="18" height="15" rx="2.3"/><circle cx="8.7" cy="10" r="1.8"/><path d="M3 16.5l5-4.3 3.8 3.3 2.9-2.4L21 18"/>',
    search:   '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.2 2"/>',
    shield:   '<path d="M12 2.7l7.5 3v5.5c0 4.6-3.1 8.5-7.5 10.1-4.4-1.6-7.5-5.5-7.5-10.1V5.7z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    caret:    '<path d="M9 18l6-6-6-6"/>',
    check:    '<path d="M20 6L9 17l-5-5"/>',
    plus:     '<path d="M12 5v14M5 12h14"/>',
    edit:     '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash:    '<path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M19 6l-1 14.2a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 20.2L5 6"/>',
    eye:      '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/>',
    down:     '<path d="M12 5v13M6 13l6 6 6-6"/>',
    ext:      '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 13.5V19a1.6 1.6 0 0 1-1.6 1.6H5A1.6 1.6 0 0 1 3.4 19V7.6A1.6 1.6 0 0 1 5 6h5.5"/>',
    info:     '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    grip:     '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
    up:       '<path d="M12 19V6M6 11l6-6 6 6"/>',
    send:     '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.8 18-3.7-8.5L2 9.1z"/>',
    money:    '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M14.8 9.3A2.7 2.7 0 0 0 12 8c-1.6 0-2.6.8-2.6 2s1 1.9 2.6 2 2.6.8 2.6 2-1 2-2.6 2a2.7 2.7 0 0 1-2.8-1.3"/>',
    wa:       '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.2 7.5L3.5 20.5l1.5-4.6a8.4 8.4 0 1 1 15.5-4.3z"/><path d="M8.8 9.2c.3-.7.6-.7.9-.7h.7c.2 0 .5 0 .7.6l.8 2c.1.3 0 .5-.1.7l-.4.5c-.1.2-.3.4-.1.7a6 6 0 0 0 2.8 2.4c.3.2.5 0 .7-.1l.6-.7c.2-.2.4-.2.6-.1l1.9 1c.3.1.4.3.4.5a2 2 0 0 1-1.9 1.9 8 8 0 0 1-6-3.4c-1.1-1.6-1.7-3.1-1.6-4.2a2 2 0 0 1 .5-1.1z"/>',
    sms:      '<rect x="3" y="4.5" width="18" height="13" rx="2.4"/><path d="M8 21l3.5-3.5"/><path d="M7.5 9h9M7.5 13h5"/>',
    open:     '<rect x="2.5" y="4.5" width="19" height="15" rx="2.2"/><path d="M3 7l9 6 9-6"/><path d="M17 3l4 3-4 3"/>',
    click:    '<path d="M9 4.5v6M4.5 9h6"/><path d="M12.5 12.5L21 21"/><path d="M11 11l3 10 2.2-4.8L21 14z"/>',
    ban:      '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    layers:   '<path d="M12 2.5l9.5 5-9.5 5-9.5-5z"/><path d="M2.5 12.5l9.5 5 9.5-5"/><path d="M2.5 17l9.5 5 9.5-5"/>',
    link:     '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
    lock:     '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    star:     '<path d="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6-4.4-4.3 6.1-.9z"/>',
    help:     '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2A2.6 2.6 0 0 1 14.4 10c0 1.7-2.4 2.2-2.4 3.8"/><path d="M12 17.2h.01"/>',
    ticket:   '<path d="M3 8.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.3a2.2 2.2 0 0 0 0 4.4v1.3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.3a2.2 2.2 0 0 0 0-4.4z"/><path d="M14 6.5v11"/>'
  };

  var PORTALS = {
    cio:'ETCIO', bfsi:'ETBFSI', legal:'ETLegalWorld', auto:'ETAuto', telecom:'ETTelecom',
    retail:'ETRetail', health:'ETHealthWorld', hrworld:'ETHRWorld', manufacturing:'ETManufacturing',
    gov:'ETGovernment', brandequity:'ETBrandEquity'
  };
  var TYPES = {
    ip:'IP Event', client:'Client Event', editorial:'Editorial',
    leadgen:'Lead-Gen Microsite', roundtable:'Round Table', awards:'Awards'
  };

  /* deterministic pseudo-random — no longer used to seed fake event/attendee data (that's gone, see
     fetchEvent/fetchRegistrations below), but kept: other files (edit-event-marketing.js,
     audience-registrations.html) still call RevampCore.rnd for unrelated deterministic-random UI bits. */
  function rnd(seed){ var x = Math.sin(seed) * 10000; return x - Math.floor(x); }

  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function compact(n){
    if (n == null) return '—';
    if (n >= 10000000) return (n / 10000000).toFixed(2).replace(/\.00$/,'') + ' Cr';
    if (n >= 100000)   return (n / 100000).toFixed(2).replace(/\.00$/,'') + ' Lacs';
    if (n >= 1000)     return (n / 1000).toFixed(2).replace(/\.00$/,'') + ' K';
    return String(n);
  }
  function comma(n){
    if (n == null) return '—';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  /* A date as it was typed. "2027-03-14" is a calendar day, not a moment: new Date() would read it as
     midnight UTC, which is the evening before in the Americas and 05:30 in India — a wrong day, or a
     time nobody entered. -> { d: Date in local time, timed: whether the value carries a time } or null. */
  function readDate(v){
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : { d: v, timed: true };
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
    if (m){
      var day = new Date(+m[1], +m[2] - 1, +m[3]);
      return (day.getMonth() === +m[2] - 1 && day.getDate() === +m[3]) ? { d: day, timed: false } : null;
    }
    var d = new Date(v);
    return isNaN(d) ? null : { d: d, timed: true };
  }
  /* "Mar 14, 2027 (07:00 PM)"; the time only when the value has one. */
  function fmtDT(iso){
    var r = readDate(iso);
    if (!r) return 'Date to be announced';
    var d = r.d, out = MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    if (!r.timed) return out;
    var hh = d.getHours(), mm = d.getMinutes();
    var ap = hh >= 12 ? 'PM' : 'AM', h12 = hh % 12 || 12;
    return out + ' (' + (h12 < 10 ? '0' : '') + h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap + ')';
  }
  /* "14 Mar 2027" — never a time. */
  function fmtDate(iso){
    var r = readDate(iso);
    if (!r) return '—';
    return r.d.getDate() + ' ' + MON[r.d.getMonth()] + ' ' + r.d.getFullYear();
  }
  /* An event's dates on one line: "14 Mar 2027", "14–15 Mar 2027", "30 Mar – 2 Apr 2027",
     "30 Dec 2026 – 2 Jan 2027". '' when there is no start date (callers show the event's dateLabel). */
  function fmtRange(start, end){
    var a = readDate(start), b = readDate(end);
    if (!a) return '';
    var s = a.d, e = b ? b.d : s;
    if (e < s || (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate())) return fmtDate(s);
    if (s.getFullYear() !== e.getFullYear()) return fmtDate(s) + ' – ' + fmtDate(e);
    if (s.getMonth() !== e.getMonth()) return s.getDate() + ' ' + MON[s.getMonth()] + ' – ' + fmtDate(e);
    return s.getDate() + '–' + fmtDate(e);
  }
  function money(n){
    if (n == null) return '—';
    return '₹ ' + comma(n);
  }

  var AV    = ['#ED1C24','#2F6FB0','#2F8F5B','#8A5A9E','#9C6B14','#B3151B','#3E7C7C','#A2457A'];

  /* ---------------------------------------------------------------- real backend (functions/lib/api.js)
     Every event identifier from here on is the real Firestore id string (e.g. 'ethrworld-nextsummit'),
     which is also the event's public address (/e/<id>).

     Every call below returns a promise and never throws. A failure — not signed in, no connection, a
     refusal from the server — rejects with an Error made by apiError(): its message is a sentence a user
     can be shown, its status is the HTTP status (0 when no answer came back at all). */

  function apiError(message, status, data){
    var err = new Error(message);
    err.status = status || 0;
    /* What the server said besides `error` is what lets a caller act on a refusal instead of only
       reporting it: code + suggestion (address taken), current (someone else saved the site first). */
    if (data && typeof data === 'object'){
      for (var k in data) if (data.hasOwnProperty(k) && k !== 'error' && k !== 'message' && k !== 'status' && k !== 'name' && k !== 'stack') err[k] = data[k];
      err.data = data;
    }
    return err;
  }

  function getIdToken(){
    if (!window.RevampAuth || typeof window.RevampAuth.getIdToken !== 'function'){
      console.warn('[RevampCore] window.RevampAuth.getIdToken() is not available (auth.js is not loaded on this page) — API calls will fail until it is.');
      return Promise.reject(apiError('You are not signed in. Please sign in and try again.', 401));
    }
    return window.RevampAuth.getIdToken();
  }

  /* The one way any page calls /api/*. auth.js's RevampAuth.authedFetch owns the session (a fresh token,
     the cookie the server-side gate reads, one retry on 401, then the sign-in page); when a page has an
     auth.js without it, this does what it always did: attach the current token and send. Resolves the
     fetch Response — an HTTP error is still a resolved Response here; the functions below turn it into
     a rejection. */
  function authedFetch(url, opts){
    opts = opts || {};
    try {
      if (window.RevampAuth && typeof window.RevampAuth.authedFetch === 'function'){
        var o = {};
        for (var key in opts) if (opts.hasOwnProperty(key)) o[key] = opts[key];
        if (o.body && typeof o.body === 'string'){
          var h = {};
          for (var hk in (o.headers || {})) if (o.headers.hasOwnProperty(hk)) h[hk] = o.headers[hk];
          if (!h['Content-Type']) h['Content-Type'] = 'application/json';
          o.headers = h;
        }
        return Promise.resolve(window.RevampAuth.authedFetch(url, o));
      }
    } catch (e) { return Promise.reject(e); }
    return getIdToken().then(function(token){
      var headers = {};
      for (var k in (opts.headers || {})) if (opts.headers.hasOwnProperty(k)) headers[k] = opts.headers[k];
      headers['Authorization'] = 'Bearer ' + token;
      if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      opts.headers = headers;
      return fetch(url, opts);
    });
  }

  /* What to say when the answer carries no message of its own — a proxy's HTML error page, an empty
     body, a timeout upstream. Never the raw status line. */
  function fallbackMessage(status){
    if (status === 401) return 'Your sign-in has expired. Please sign in again.';
    if (status === 403) return 'You do not have access to do that.';
    if (status === 404) return 'That could not be found. It may have been deleted.';
    if (status === 409) return 'That conflicts with a newer change. Reload and try again.';
    if (status === 413) return 'That is too large to send.';
    if (status === 429) return 'Too many requests at once. Wait a moment and try again.';
    if (status === 503) return 'This is not available right now. Please try again in a moment.';
    if (status >= 500) return 'The server had a problem. Please try again.';
    return 'The request could not be completed (' + status + ').';
  }

  function readJsonResponse(res){
    return res.json().catch(function(){ return {}; }).then(function(data){
      if (!res.ok){
        var said = data && typeof data.error === 'string' && data.error;
        throw apiError(said || fallbackMessage(res.status), res.status, data);
      }
      return data;
    });
  }

  /* One request, start to finish, for every function below: sends JSON, reads JSON, and makes every
     way of failing an apiError. fetch() itself rejects (a TypeError with a
     browser-specific message) only when no answer arrived, so that case gets a sentence and status 0;
     anything that already carries a status is passed on untouched. */
  function api(method, url, body){
    var opts = { method: method };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return authedFetch(url, opts).then(readJsonResponse, function(err){
      if (err && typeof err.status === 'number') throw err;
      if (err && /sign|auth|token/i.test(String(err.message || ''))) throw apiError('You are not signed in. Please sign in and try again.', 401);
      throw apiError('Could not reach the server. Check your connection and try again.', 0);
    });
  }

  function need(value, what){
    value = String(value == null ? '' : value).trim();
    return value ? null : Promise.reject(apiError(what + ' is required.', 400));
  }
  function q(v){ return encodeURIComponent(String(v == null ? '' : v).trim()); }

  function fetchEvent(eventId){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(apiError('fetchEvent: eventId is required.', 400));
    return api('GET', '/api/event?eventId=' + encodeURIComponent(eventId))
      .then(function(data){
        data.id = eventId;
        data.eventId = eventId;
        return data;
      });
  }

  function createEvent(data){
    data = data || {};
    var eventId = String(data.eventId || data.slug || '').trim();
    if (!eventId) return Promise.reject(apiError('createEvent: eventId/slug is required.', 400));
    /* An address that is already an event answers 409 and changes nothing: the Error then carries
       code 'slug-taken' and a free `suggestion` (apiError copies the server's fields onto it). */
    return api('POST', '/api/event', data);   // -> {eventId, createdAt}
  }

  /* -> { ok, updatedAt }. Pass opts.ifUpdatedAt — the updatedAt this page last received for the event,
     from fetchEvent or from its own last save — and a save made on top of somebody else's newer change is
     refused instead of silently undoing it: the Error has status 409, code 'stale' and
     current { updatedAt, updatedBy }. Keep the returned updatedAt for the next save. */
  function updateEvent(eventId, patch, opts){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(apiError('updateEvent: eventId is required.', 400));
    var body = { eventId: eventId };
    for (var k in (patch || {})) if (patch.hasOwnProperty(k)) body[k] = patch[k];
    if (opts && opts.ifUpdatedAt) body.ifUpdatedAt = opts.ifUpdatedAt;
    return api('PATCH', '/api/event', body);
  }

  /* Publishes the site as it was last SAVED on the server (saveSite). The console and the editor call
     exactly this, so Publish means the same thing everywhere and works without the editor open.
     publishEvent(eventId, html) is the older form: editor scripts that browsers still have cached pass
     the page itself, and the server treats that as "save this page, then publish" for one more release. */
  function publishEvent(eventId, html){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(apiError('publishEvent: eventId is required.', 400));
    var body = { eventId: eventId };
    if (typeof html === 'string' && html) body.html = html;
    return api('POST', '/api/event/publish', body);   // -> {publishedPath, publishedUrl, publishedAt, publishedVersion}
  }

  function unpublishEvent(eventId){
    return need(eventId, 'unpublishEvent: eventId') ||
      api('POST', '/api/event/unpublish', { eventId: String(eventId).trim() });
  }

  /* The older Preview (a page stored at a storage URL). New code opens previewUrl(eventId) instead;
     this stays for editor scripts already cached in browsers. */
  function stageEvent(eventId, html){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(apiError('stageEvent: eventId is required.', 400));
    if (!html) return Promise.reject(apiError('stageEvent: html is required.', 400));
    return api('POST', '/api/event/stage', { eventId: eventId, html: html });   // -> {stagingUrl}
  }
  /* The editor's Preview: the page as it is in this person's editor, saved or not. Theirs alone — staging
     itself changes only on Save (saveSite). */
  function previewDraft(eventId, html){
    return need(eventId, 'previewDraft: eventId') ||
      api('POST', '/api/event/stage', { eventId: String(eventId).trim(), html: html, draft: true, origin: location.origin });
  }

  /* ---- approval: nothing goes live until somebody approves it ----
     requestApproval -> {id, status, toVersion, fromVersion, summary, updated, reviewPath, reviewUrl}
     fetchApproval   -> {name, me, published, publishedVersion, savedVersion, request, canDecide, whyNot,
                         approvers, allowSelf, required, requests}   (id omitted: the one that is waiting)
     decideApproval  -> {id, status} (+ publishedUrl … when approved)
     fetchHistory    -> [{at, by, action, detail, version, fields, changes, approval}], newest first */
  function requestApproval(eventId, note){
    return need(eventId, 'requestApproval: eventId') ||
      api('POST', '/api/event/approval/request', { eventId: String(eventId).trim(), note: note || '', origin: location.origin });
  }
  function fetchApproval(eventId, id){
    return need(eventId, 'fetchApproval: eventId') ||
      api('GET', '/api/event/approval?eventId=' + q(eventId) + (id ? '&id=' + q(id) : ''));
  }
  function decideApproval(eventId, id, decision, note){
    return need(eventId, 'decideApproval: eventId') ||
      api('POST', '/api/event/approval/decide', { eventId: String(eventId).trim(), id: id, decision: decision, note: note || '', origin: location.origin });
  }
  function fetchHistory(eventId){
    return need(eventId, 'fetchHistory: eventId') ||
      api('GET', '/api/event/history?eventId=' + q(eventId)).then(function(data){ return (data && data.items) || []; });
  }
  /* the same, with what the AI has cost this event: { items, aiUsage: { usd, calls, pictures, byRoute } | null } */
  function fetchHistoryAndUsage(eventId){
    return need(eventId, 'fetchHistoryAndUsage: eventId') ||
      api('GET', '/api/event/history?eventId=' + q(eventId)).then(function(data){ return { items: (data && data.items) || [], aiUsage: (data && data.aiUsage) || null }; });
  }
  /* the Activity log, a page at a time: opts { limit, before (the last answer's `next`), from, to (ISO times),
     by, area, action, q } -> { items, next, people (first page only), aiUsage } */
  function fetchActivityLog(eventId, opts){
    var u = '/api/event/history?eventId=' + q(eventId);
    opts = opts || {};
    ['limit', 'before', 'from', 'to', 'by', 'area', 'action', 'q'].forEach(function(k){
      if (opts[k] != null && opts[k] !== '') u += '&' + k + '=' + q(opts[k]);
    });
    return need(eventId, 'fetchActivityLog: eventId') ||
      api('GET', u).then(function(data){
        data = data || {};
        return { items: data.items || [], next: data.next || null, people: data.people || null, aiUsage: data.aiUsage || null };
      });
  }
  function fetchApprovalSettings(){ return api('GET', '/api/settings/approvals'); }
  function saveApprovalSettings(settings){ return api('PUT', '/api/settings/approvals', settings || {}); }

  /* Both are plain strings, built from the host this page is on — never a made-up domain. The public
     address of an event is /e/<id> whether or not it is published yet (callers say "not live yet"
     from event.published; the address itself does not change). */
  function previewUrl(eventId){
    eventId = String(eventId == null ? '' : eventId).trim();
    return eventId ? location.origin + '/preview/' + encodeURIComponent(eventId) : '';
  }
  function publicUrl(event){
    var id = '', path = '';
    if (event && typeof event === 'object'){
      id = String(event.eventId || event.id || event.slug || '').trim();
      if (typeof event.publishedPath === 'string' && /^\/e\/[^\/?#]+$/.test(event.publishedPath)) path = event.publishedPath;
    } else {
      id = String(event == null ? '' : event).trim();
    }
    if (!path && id) path = '/e/' + encodeURIComponent(id);
    return path ? location.origin + path : '';
  }

  /* ---- the saved site ----
     The server's copy is the truth; the editor's IndexedDB copy is a cache and an offline buffer. */
  function fetchSite(eventId){
    /* "Never saved" is an ordinary state of a new event, not a failure: it resolves null, so a caller
       can tell it from "could not load" (which rejects) without inspecting a status. */
    return need(eventId, 'fetchSite: eventId') ||
      api('GET', '/api/event/site?eventId=' + q(eventId)).then(null, function(err){
        // only "this event has no saved site": an event that is missing or deleted is still a failure
        if (err && err.status === 404 && err.code !== 'event-not-found' && err.code !== 'event-deleted') return null;
        throw err;
      });
  }
  function saveSite(eventId, site){
    site = site || {};
    var missing = need(eventId, 'saveSite: eventId');
    if (missing) return missing;
    if (site.snapshot == null || typeof site.html !== 'string' || !site.html){
      return Promise.reject(apiError('saveSite: snapshot and html are required.', 400));
    }
    var body = {
      eventId: String(eventId).trim(),
      templateId: site.templateId == null ? null : site.templateId,
      baseVersion: +site.baseVersion || 0,       // 0 = first save
      snapshot: site.snapshot,
      html: site.html,
      origin: location.origin                     // the server rewrites this host to root-relative
    };
    if (site.force === true) body.force = true;
    if (site.note) body.note = String(site.note);
    // 409 -> err.current {version, updatedAt, updatedBy}: someone saved on top of baseVersion
    return api('PUT', '/api/event/site', body);  // -> {version, updatedAt}
  }

  /* What the site shows: the event's details and Content-tab records, in the shape of the public
     site-data route. Sent with the session, so it also answers for an event that is not published. */
  function fetchSiteData(eventId){
    return need(eventId, 'fetchSiteData: eventId') ||
      api('GET', '/api/public/site-data?eventId=' + q(eventId));
  }

  /* ---- images ----
     A picture is uploaded first and referenced by its URL afterwards; nothing stores image data inside
     a record or inside the saved site. The checks here are the server's own, made early so that a
     wrong file costs no upload — the server still decides (it looks at the file's bytes). */
  var UPLOAD_KINDS = ['speakers', 'partners', 'gallery', 'logo', 'banner', 'media', 'brief'];
  var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  var IMAGE_TYPES = { 'image/png':1, 'image/jpeg':1, 'image/webp':1, 'image/gif':1, 'image/svg+xml':1 };
  var IMAGE_EXT = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', svg:'image/svg+xml' };

  function imageTypeOf(file){
    var type = String(file.type || '').toLowerCase().split(';')[0].trim();
    if (type === 'image/jpg' || type === 'image/pjpeg') type = 'image/jpeg';
    if (type) return IMAGE_TYPES[type] ? type : '';
    // some browsers and drag sources leave the type empty; the name is then all there is to go on
    var m = /\.([A-Za-z0-9]+)$/.exec(String(file.name || ''));
    return (m && IMAGE_EXT[m[1].toLowerCase()]) || '';
  }

  function readBase64(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){
        var s = String(reader.result || ''), i = s.indexOf(',');
        resolve(i === -1 ? '' : s.slice(i + 1));
      };
      reader.onerror = function(){ reject(apiError('The file could not be read from your computer. Please choose it again.', 0)); };
      reader.readAsDataURL(file);
    });
  }

  function refreshLogoUnit(eventId){
    return need(eventId, 'refreshLogoUnit: eventId') || api('POST', '/api/event/logo-unit', { eventId: String(eventId).trim() });
  }
  function logoUnitDark(eventId, url){
    return need(eventId, 'logoUnitDark: eventId') || api('POST', '/api/event/logo-unit-dark', { eventId: String(eventId).trim(), url: String(url || '') });
  }

  function uploadImage(eventId, kind, file){
    var missing = need(eventId, 'uploadImage: eventId');
    if (missing) return missing;
    if (UPLOAD_KINDS.indexOf(kind) === -1) return Promise.reject(apiError('uploadImage: kind must be one of ' + UPLOAD_KINDS.join(', ') + '.', 400));
    if (typeof Blob === 'undefined' || !(file instanceof Blob)) return Promise.reject(apiError('Choose an image file to upload.', 400));
    var name = String(file.name || '').trim();
    var shown = name ? '"' + name + '"' : 'That file';
    var type = imageTypeOf(file);
    if (!type) return Promise.reject(apiError(shown + ' is not an image we can use. Upload a PNG, JPG, WebP, GIF or SVG file.', 415));
    if (!file.size) return Promise.reject(apiError(shown + ' is empty. Choose another image.', 400));
    if (file.size > MAX_IMAGE_BYTES){
      return Promise.reject(apiError(shown + ' is ' + (file.size / 1048576).toFixed(1) + ' MB. Images can be up to 8 MB.', 413));
    }
    return readBase64(file).then(function(dataBase64){
      return api('POST', '/api/event/upload', {
        eventId: String(eventId).trim(), kind: kind,
        fileName: name || ('image.' + ({ 'image/jpeg':'jpg', 'image/svg+xml':'svg' }[type] || type.slice(6))),
        mimeType: type, dataBase64: dataBase64
      });
    }).then(function(data){
      if (!data || typeof data.url !== 'string' || !data.url) throw apiError('The image could not be stored. Please try again.', 500);
      return data;     // {url, path, contentType, size}
    });
  }

  /* ---------- the banner video (functions/lib/api-hero-video.js; the settings UI is hero-video-ui.js) ----------
     fetchHeroVideo(eventId) -> { heroVideo | null, site: { host, tone, scrim }, auto, limits, types }
     uploadHeroVideo(eventId, file, { onProgress(fraction), onXhr(xhr) }) -> the video as the server read it
       { url, path, contentType, size, duration, width, height, codec, hasAudio, fastStart }. The file goes
       straight to Cloud Storage (a session the server opens), then the server checks what it really is; a file
       it refuses is deleted again and the Error says why (err.reason). onXhr gets the request, to abort it.
     saveHeroVideo(eventId, patch) -> { heroVideo }     patch: { video: { path }, poster: { url } | null, posterAuto,
                                                         overlay: { mode, color, opacity }, enabled }
     removeHeroVideo(eventId) -> { heroVideo: null } */
  function fetchHeroVideo(eventId){
    var missing = need(eventId, 'fetchHeroVideo: eventId');
    return missing || api('GET', '/api/event/hero-video?eventId=' + q(eventId));
  }
  function uploadHeroVideo(eventId, file, opts){
    opts = opts || {};
    var missing = need(eventId, 'uploadHeroVideo: eventId');
    if (missing) return missing;
    if (typeof Blob === 'undefined' || !(file instanceof Blob)) return Promise.reject(apiError('Choose a video file to upload.', 400));
    var name = String(file.name || 'video').trim();
    return api('POST', '/api/event/hero-video/upload', {
      eventId: String(eventId).trim(), fileName: name, mimeType: file.type || '', size: file.size, origin: location.origin
    }).then(function(session){
      return new Promise(function(resolve, reject){
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', session.uploadUrl, true);
        xhr.upload.onprogress = function(e){ if (e.lengthComputable && opts.onProgress) opts.onProgress(e.loaded / e.total); };
        xhr.onload = function(){
          if (xhr.status >= 200 && xhr.status < 300) return resolve(session);
          reject(apiError('The video could not be sent (' + xhr.status + '). Please try again.', xhr.status));
        };
        xhr.onerror = function(){ reject(apiError('The video could not be sent. Check your connection and try again.', 0)); };
        xhr.onabort = function(){ var e = apiError('The upload was cancelled.', 0); e.cancelled = true; reject(e); };
        if (opts.onXhr) opts.onXhr(xhr);
        xhr.send(file);
      });
    }).then(function(session){
      return api('POST', '/api/event/hero-video/check', { eventId: String(eventId).trim(), path: session.path });
    });
  }
  function saveHeroVideo(eventId, patch){
    var missing = need(eventId, 'saveHeroVideo: eventId');
    if (missing) return missing;
    var body = { eventId: String(eventId).trim() };
    for (var k in (patch || {})) if (patch.hasOwnProperty(k)) body[k] = patch[k];
    return api('PUT', '/api/event/hero-video', body);
  }
  function removeHeroVideo(eventId){
    var missing = need(eventId, 'removeHeroVideo: eventId');
    return missing || api('DELETE', '/api/event/hero-video?eventId=' + q(eventId));
  }

  /* Turns what the wizard collected (speakers, FAQs, sponsors, contacts, gallery …) into real Content
     records. The server only fills a list that is still empty. */
  function seedContent(eventId, payload){
    var missing = need(eventId, 'seedContent: eventId');
    if (missing) return missing;
    var body = {};
    for (var k in (payload || {})) if (payload.hasOwnProperty(k)) body[k] = payload[k];
    body.eventId = String(eventId).trim();
    return api('POST', '/api/event/seed', body);   // -> {created: {speakers: n, ...}}
  }

  /* ---- event lifecycle ---- */

  /* The address rule, identical to the backend's (functions/lib/api-events.js): lowercase letters,
     digits and single hyphens, at most 80 characters. Use it to derive an address from a name. */
  function slugify(text){
    return String(text == null ? '' : text).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  }

  /* Addresses no event can have (the server's rule, functions/lib/http.js isReservedEventId): they mean
     something else to the editor or to this site's own paths. slugAvailable() answers reason 'reserved'
     for them too; this is for saying so before asking. Not mirrored: the server also refuses qa-… addresses,
     but only where it is deployed (the QA harness creates its qa- events on a local server), which this page
     cannot tell — there the server's answer (reason 'reserved', with a suggestion) is the one to show. */
  var RESERVED_SLUGS = ['new', 'api', 'e', 'preview', 'templates', 'assets', 'index', 'import', 'imports'];
  function isReservedSlug(slug){
    slug = String(slug == null ? '' : slug).trim().toLowerCase();
    return /^(gen|imported|import)-/.test(slug) || /^\d+$/.test(slug) || RESERVED_SLUGS.indexOf(slug) !== -1;
  }

  /* -> {available, suggestion, reason, message}. A check, not a reservation: createEvent / cloneEvent
     can still answer 409 if someone takes the address in between, so handle that as well. */
  function slugAvailable(slug){
    return need(slug, 'An address') ||
      api('GET', '/api/event/slug-available?slug=' + q(slug));
  }

  /* [event], newest change first. Deleted events are not in it; fetchEvents({deleted:true}) asks for
     those instead (the listing's "Deleted events" view). */
  function fetchEvents(opts){
    return api('GET', '/api/events' + (opts && opts.deleted ? '?deleted=1' : ''))
      .then(function(data){ return Array.isArray(data) ? data : ((data && data.items) || []); });
  }

  function deleteEvent(eventId){
    return need(eventId, 'deleteEvent: eventId') ||
      api('DELETE', '/api/event?eventId=' + q(eventId));          // -> {ok, eventId, deletedAt}
  }
  /* Removes for good a draft this user has just created and not worked on (the wizard's Cancel), and
     frees its address. Anything else — published, registered for, edited, older than a day, somebody
     else's — rejects with status 409 and code 'not-discardable' and is left exactly as it was: delete
     such an event with deleteEvent(). -> {ok, eventId, discarded} */
  function discardEvent(eventId){
    return need(eventId, 'discardEvent: eventId') ||
      api('DELETE', '/api/event?eventId=' + q(eventId) + '&discard=1');
  }
  function restoreEvent(eventId){
    return need(eventId, 'restoreEvent: eventId') ||
      api('POST', '/api/event/restore', { eventId: String(eventId).trim() });   // -> {ok, eventId, published}
  }
  /* A new, unpublished event with the source's details, settings, content records and saved site —
     never its registrations, statistics or published page. 409 -> err.code 'slug-taken', err.suggestion. */
  function cloneEvent(sourceEventId, eventId, name){
    return need(sourceEventId, 'cloneEvent: sourceEventId') || need(eventId, 'An address for the new event') ||
      api('POST', '/api/event/clone', {
        sourceEventId: String(sourceEventId).trim(), eventId: String(eventId).trim(),
        name: String(name == null ? '' : name).trim()
      });   // -> {eventId, name, templateId, createdAt, copied}
  }

  /* ---- registrations and reporting ---- */
  function updateRegistration(eventId, id, patch){
    var missing = need(eventId, 'updateRegistration: eventId') || need(id, 'updateRegistration: id');
    if (missing) return missing;
    var body = {};
    for (var k in (patch || {})) if (patch.hasOwnProperty(k)) body[k] = patch[k];
    body.eventId = String(eventId).trim(); body.id = String(id).trim();
    return api('PATCH', '/api/event/registrations', body);
  }
  function deleteRegistration(eventId, id){
    return need(eventId, 'deleteRegistration: eventId') || need(id, 'deleteRegistration: id') ||
      api('DELETE', '/api/event/registrations?eventId=' + q(eventId) + '&id=' + q(id));
  }
  function daysParam(days){
    days = Math.round(+days);
    return days > 0 ? Math.min(days, 366) : 30;
  }
  function fetchStats(eventId, days){
    return need(eventId, 'fetchStats: eventId') ||
      api('GET', '/api/event/dashboard-stats?eventId=' + q(eventId) + '&days=' + daysParam(days));
  }
  function fetchInsights(days){
    return api('GET', '/api/insights?days=' + daysParam(days));
  }
  function fetchActivity(eventId){
    return need(eventId, 'fetchActivity: eventId') ||
      api('GET', '/api/event/activity?eventId=' + q(eventId))
        .then(function(data){ return Array.isArray(data) ? data : ((data && (data.items || data.activity)) || []); });
  }

  /* fetchRegistrations(eventId) -> [registration]: EVERY registration of the event, newest first, however
     many there are (it asks for page after page); the array also carries .total, the event's own count.
     fetchRegistrations(eventId, { limit, cursor }) -> { items, total, nextCursor }: one page (limit up to
     5,000) for a page that pages itself; pass nextCursor back as cursor until it is null.
     fetchRegistrations(eventId, { formId }) — no limit, no cursor — follows the pages of that one form's.
     A page also says partial: true when the server could only look through part of the responses for it.
     A registration: id, name, email, phone, company, designation, city, source, utm {source, medium,
     campaign}, device, referrer, formId, formName, counts (false for a form that does not count as a
     registration), answers {fieldId: value}, answerLabels {fieldId: label}, status (confirmed | waitlist |
     pending | rejected | cancelled), notes, tags [], createdAt, checkedInAt (ISO string or null), decidedAt,
     decidedBy, updatedAt. */
  function registrationsPage(eventId, page){
    var url = '/api/event/registrations?eventId=' + encodeURIComponent(eventId);
    if (page && page.limit) url += '&limit=' + q(page.limit);
    if (page && page.cursor) url += '&cursor=' + q(page.cursor);
    if (page && page.formId) url += '&formId=' + q(page.formId);
    return api('GET', url).then(function(data){
      var items = (data && data.items) || [];
      return { items: items, total: data && typeof data.total === 'number' ? data.total : items.length,
        nextCursor: (data && data.nextCursor) || null, partial: !!(data && data.partial) };
    });
  }
  function fetchRegistrations(eventId, page){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(apiError('fetchRegistrations: eventId is required.', 400));
    if (page && (page.limit || page.cursor || !page.formId)) return registrationsPage(eventId, page);
    var formId = page ? page.formId : '';
    var all = [];
    function next(cursor){
      return registrationsPage(eventId, { limit: 1000, cursor: cursor, formId: formId }).then(function(p){
        all = all.concat(p.items);
        if (p.nextCursor && p.items.length) return next(p.nextCursor);
        all.total = Math.max(p.total, all.length);
        return all;
      });
    }
    return next(null);
  }

  /* The CSV of an event's responses as the server builds it (a column per answer; UTF-8 with a byte-order
     mark, so a spreadsheet reads accents right). opts: { formId, status } narrow it. -> { blob, filename }.
     A refusal rejects like every other call here. */
  function exportRegistrations(eventId, opts){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(apiError('exportRegistrations: eventId is required.', 400));
    opts = opts || {};
    var url = '/api/event/registrations/export?eventId=' + encodeURIComponent(eventId);
    if (opts.formId) url += '&formId=' + q(opts.formId);
    if (opts.status) url += '&status=' + q(opts.status);
    return authedFetch(url, { method: 'GET' }).then(function(res){
      if (!res.ok) return readJsonResponse(res);          // rejects with the server's sentence
      var cd = res.headers.get('Content-Disposition') || '';
      var m = /filename="?([^";]+)"?/i.exec(cd);
      var filename = m ? m[1] : eventId + '-registrations' + (opts.formId ? '-' + opts.formId : '') + '.csv';
      return res.blob().then(function(blob){ return { blob: blob, filename: filename }; });
    }, function(err){
      if (err && typeof err.status === 'number') throw err;
      throw apiError('Could not reach the server. Check your connection and try again.', 0);
    });
  }

  /* ---- registration forms ----
     An event's forms live in events/<id>/forms (functions/lib/api-forms.js). The console's Settings ›
     Registration forms and the site editor's Forms panel both edit them through these, with the one builder
     (forms-builder.js). A form is changed as a whole: updateForm sends every field of it with the updatedAt
     the page last received, and someone else's newer save is a 409 'stale' that carries the stored form. */
  function fetchForms(eventId){
    return need(eventId, 'fetchForms: eventId') ||
      api('GET', '/api/event/forms?eventId=' + q(eventId));
  }
  function createForm(eventId, what){
    var missing = need(eventId, 'createForm: eventId');
    if (missing) return missing;
    what = what || {};
    var body = { eventId: String(eventId).trim() };
    if (what.form) body.form = what.form;
    else if (what.template) body.template = String(what.template);
    else if (what.duplicateOf) body.duplicateOf = String(what.duplicateOf);
    else return Promise.reject(apiError('createForm: a form, a template or a form to duplicate is required.', 400));
    return api('POST', '/api/event/forms', body);
  }
  function updateForm(eventId, formId, form, ifUpdatedAt){
    var missing = need(eventId, 'updateForm: eventId') || need(formId, 'updateForm: formId');
    if (missing) return missing;
    var body = { eventId: String(eventId).trim(), formId: String(formId).trim(), form: form || {} };
    if (ifUpdatedAt) body.ifUpdatedAt = String(ifUpdatedAt);
    return api('PUT', '/api/event/forms', body);
  }
  function deleteForm(eventId, formId, opts){
    return need(eventId, 'deleteForm: eventId') || need(formId, 'deleteForm: formId') ||
      api('DELETE', '/api/event/forms?eventId=' + q(eventId) + '&formId=' + q(formId) + (opts && opts.force ? '&force=1' : ''));
  }
  function setDefaultForm(eventId, formId){
    return need(eventId, 'setDefaultForm: eventId') || need(formId, 'setDefaultForm: formId') ||
      api('POST', '/api/event/forms/default', { eventId: String(eventId).trim(), formId: String(formId).trim() });
  }
  function reorderForms(eventId, ids){
    return need(eventId, 'reorderForms: eventId') ||
      api('POST', '/api/event/forms/order', { eventId: String(eventId).trim(), ids: (ids || []).map(String) });
  }

  /* ---- generic per-event subcollection CRUD ----
     One shared client for the 9 structurally-identical resources functions/lib/api.js's own
     subcollectionRoutes() factory serves: 'speakers', 'speaker-groups', 'sessions', 'agenda-groups',
     'partners', 'partner-tiers', 'gallery', 'faqs', 'contacts' — and the Promotions pages' 'promo-templates'
     and 'promo-audiences' (leads have their own functions below). Every record gets a server-assigned `id`.
     A list comes back in one fixed order: by `order` (records that have a number first, lowest first),
     then oldest first, then by id.
     A refused write rejects with the server's sentence; err.field names the field it is about when
     there is one (400), err.code is 'stale' with err.current {updatedAt, updatedBy} when
     opts.ifUpdatedAt was sent and somebody saved the record since (409). */
  function fetchSub(resource, eventId){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(apiError('fetchSub(' + resource + '): eventId is required.', 400));
    return api('GET', '/api/event/' + resource + '?eventId=' + encodeURIComponent(eventId))
      .then(function(data){ return (data && data.items) || []; });
  }
  function createSub(resource, eventId, data){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(apiError('createSub(' + resource + '): eventId is required.', 400));
    var body = { eventId: eventId };
    for (var k in (data || {})) if (data.hasOwnProperty(k)) body[k] = data[k];
    return api('POST', '/api/event/' + resource, body);   // -> {id, createdAt, updatedAt}
  }
  function updateSub(resource, eventId, id, patch, opts){
    eventId = String(eventId || '').trim(); id = String(id || '').trim();
    if (!eventId || !id) return Promise.reject(apiError('updateSub(' + resource + '): eventId and id are required.', 400));
    var body = { eventId: eventId, id: id };
    for (var k in (patch || {})) if (patch.hasOwnProperty(k)) body[k] = patch[k];
    if (opts && opts.ifUpdatedAt) body.ifUpdatedAt = opts.ifUpdatedAt;
    return api('PATCH', '/api/event/' + resource, body);   // -> {ok:true, updatedAt}
  }
  function deleteSub(resource, eventId, id){
    eventId = String(eventId || '').trim(); id = String(id || '').trim();
    if (!eventId || !id) return Promise.reject(apiError('deleteSub(' + resource + '): eventId and id are required.', 400));
    return api('DELETE', '/api/event/' + resource + '?eventId=' + encodeURIComponent(eventId) + '&id=' + encodeURIComponent(id));   // -> {ok:true} (speakers: also sessionsUpdated)
  }

  /* ---- leads (Promotions) ----
     One lead per person: the same e-mail (or, without one, the same name and company) is one lead.
     createSub('leads', …) rejects a repeat with status 409, code 'duplicate' and err.existingId;
     updateSub('leads', …) and deleteSub('leads', …) work as for any record. */

  /* -> [lead], every lead of the event, newest first (it asks for page after page), with .total. */
  function fetchLeads(eventId){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(apiError('fetchLeads: eventId is required.', 400));
    var all = [];
    function next(cursor){
      return api('GET', '/api/event/leads?eventId=' + q(eventId) + '&limit=1000' + (cursor ? '&cursor=' + q(cursor) : '')).then(function(data){
        var items = (data && data.items) || [];
        all = all.concat(items);
        if (data && data.nextCursor && items.length) return next(data.nextCursor);
        all.total = Math.max((data && data.total) || 0, all.length);
        return all;
      });
    }
    return next(null);
  }
  /* Up to 500 rows per call -> {created, updated, skipped, ids}. opts.onDuplicate: 'skip' (default) leaves
     a person who is already a lead alone; 'update' fills in what that lead has empty and nothing else.
     opts.importId tags the new leads. A bad row rejects the whole call (err.row, err.field) and nothing
     is imported. */
  function bulkCreateLeads(eventId, items, opts){
    var missing = need(eventId, 'bulkCreateLeads: eventId');
    if (missing) return missing;
    var body = { eventId: String(eventId).trim(), items: items || [], onDuplicate: (opts && opts.onDuplicate) || 'skip' };
    if (opts && opts.importId) body.importId = opts.importId;
    return api('POST', '/api/event/leads/bulk', body);
  }
  /* patch: any of stage, level, owner, optOut, tags -> {updated, missing: [ids no longer there]} */
  function bulkUpdateLeads(eventId, ids, patch){
    return need(eventId, 'bulkUpdateLeads: eventId') ||
      api('PATCH', '/api/event/leads/bulk', { eventId: String(eventId).trim(), ids: ids || [], patch: patch || {} });
  }
  function bulkDeleteLeads(eventId, ids){
    return need(eventId, 'bulkDeleteLeads: eventId') ||
      api('DELETE', '/api/event/leads/bulk', { eventId: String(eventId).trim(), ids: ids || [] });   // -> {deleted}
  }
  /* note: {kind: 'note' | 'call', text}. The server adds who and when, and keeps a colleague's note made
     at the same moment. -> {ok, updatedAt, lead, note} */
  function appendLeadNote(eventId, id, note){
    return need(eventId, 'appendLeadNote: eventId') || need(id, 'appendLeadNote: id') ||
      api('PATCH', '/api/event/leads', { eventId: String(eventId).trim(), id: String(id).trim(), appendNote: note || {} });
  }
  /* at: the note's own `at` value -> {ok, updatedAt, lead} */
  function removeLeadNote(eventId, id, at){
    return need(eventId, 'removeLeadNote: eventId') || need(id, 'removeLeadNote: id') ||
      api('PATCH', '/api/event/leads', { eventId: String(eventId).trim(), id: String(id).trim(), removeNoteAt: at });
  }

  function statTile(ico, label, value, delta, viewLink){
    var d = '';
    if (delta){
      var cls = delta.dir === 'up' ? 'up' : (delta.dir === 'down' ? 'down' : 'flat');
      var arrow = delta.dir === 'up' ? IC.up : (delta.dir === 'down' ? IC.down : '');
      d = '<span class="st-d ' + cls + '">' + (arrow ? svg(arrow, 12) : '') + esc(delta.text) + '</span>';
    }
    return '<' + (viewLink ? 'button type="button" data-goto="' + viewLink + '"' : 'div') +
        ' class="stat' + (viewLink ? ' clickable' : '') + '">' +
        '<span class="st-top"><span class="st-ico">' + svg(ico, 15) + '</span>' +
        '<span class="st-lb">' + esc(label) + '</span></span>' +
        '<span class="st-v">' + esc(value) + '</span>' + d +
      '</' + (viewLink ? 'button' : 'div') + '>';
  }

  function panel(title, sub, body, right){
    return '<div class="panel">' +
        '<div class="panel-head"><h3>' + esc(title) + '</h3>' +
          (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
          (right || '') + '</div>' +
        '<div class="panel-body">' + body + '</div>' +
      '</div>';
  }
  function panelFlush(title, sub, body, right){
    return '<div class="panel">' +
        '<div class="panel-head"><h3>' + esc(title) + '</h3>' +
          (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
          (right || '') + '</div>' + body +
      '</div>';
  }

  function emptyState(ico, title, msg, cta){
    return '<div class="empty"><span class="ico">' + svg(ico, 24) + '</span>' +
      '<h4>' + esc(title) + '</h4><p>' + esc(msg) + '</p>' + (cta || '') + '</div>';
  }

  /* ---------------------------------------------------------------- state */
  function loadState(key){
    var S = { checklist:null, published:false };
    try {
      var raw = localStorage.getItem(key);
      if (raw){ var p = JSON.parse(raw); for (var k in p) if (p.hasOwnProperty(k)) S[k] = p[k]; }
    } catch(e){}
    return S;
  }
  function saveState(key, S){
    try { localStorage.setItem(key, JSON.stringify(S)); } catch(e){}
  }

  /* ---------------------------------------------------------------- toast */
  /* toast(msg) says something worked (a tick). toast(msg, { kind: 'error' }) — or just 'error' — says
     something did not: no tick, a warning mark, and it stays long enough to be read. { kind: 'info' } is
     neither. { action: { label, onClick } } adds one button (Undo, Retry); the toast then stays for eight
     seconds and goes when the button is pressed.
     Works on any page: where the console's stylesheet is not loaded it draws itself, under class names
     of its own — other pages have a `.toast` rule that means something else. */
  var TOAST_HOST_STYLE = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;display:flex;' +
    'flex-direction:column;gap:8px;align-items:center;pointer-events:none;max-width:calc(100vw - 32px)';
  var TOAST_STYLE = 'display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:10px;background:#191b1f;color:#fff;' +
    'font:500 13px/1.4 Inter,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.22);pointer-events:auto';
  function toast(msg, kind){
    var action = null;
    if (kind && typeof kind === 'object'){ action = kind.action || null; kind = kind.kind || kind.type; }
    var failed = kind === 'error', plain = kind === 'info';
    var host = $('toast-host');
    if (!host){
      host = document.createElement('div');
      host.className = 'toast-host'; host.id = 'toast-host';
      document.body.appendChild(host);
    }
    /* styled by the page (the console's stylesheet), or drawn here — decided once per host */
    var styled = false;
    if (host.getAttribute('data-rv-toasts') !== 'own'){
      try { styled = window.getComputedStyle(host).position === 'fixed'; } catch (e) {}
      if (!styled){ host.setAttribute('data-rv-toasts', 'own'); host.style.cssText = TOAST_HOST_STYLE; }
    }
    var el = document.createElement('div');
    if (styled) el.className = 'toast' + (failed ? ' toast-error' : '');
    else { el.className = 'rv-toast'; el.style.cssText = TOAST_STYLE; }
    el.setAttribute('role', failed ? 'alert' : 'status');
    el.innerHTML = (failed ? '<span style="display:inline-flex' + (styled ? '' : ';color:#ff8589') + '">' + svg(IC.info, 15) + '</span>' : (plain ? '' : svg(IC.check, 15))) +
      '<span>' + esc(msg) + '</span>';
    function close(){
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
      setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }
    if (action && action.label){
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = styled ? 'toast-act' : 'rv-toast-act';
      if (!styled) btn.style.cssText = 'margin-left:6px;padding:3px 9px;border:1px solid rgba(255,255,255,.45);border-radius:7px;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer';
      btn.textContent = action.label;
      btn.onclick = function(){ close(); if (typeof action.onClick === 'function') action.onClick(); };
      el.appendChild(btn);
    }
    host.appendChild(el);
    setTimeout(close, action ? 8000 : (failed ? 6000 : 2600));
  }

  /* ----------------------------------------------------------------
     The bundle every section view receives. A section never reaches
     outside this object, which is what lets it live in its own file.

     opts: { EV, S, vhead, go, render, save }
     ---------------------------------------------------------------- */
  function makeCtx(opts){
    return {
      EV: opts.EV,
      S: opts.S,
      IC: IC, AV: AV, PORTALS: PORTALS, TYPES: TYPES,
      $: $, esc: esc, svg: svg,
      comma: comma, compact: compact, money: money, fmtDate: fmtDate, fmtDT: fmtDT, fmtRange: fmtRange,
      statTile: statTile, panel: panel, panelFlush: panelFlush, emptyState: emptyState,
      toast: toast,
      vhead:  opts.vhead  || function(t, sub, right){
        return '<div class="vhead"><div class="vhead-row"><div class="grow">' +
          '<h2>' + esc(t) + '</h2>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') +
          '</div>' + (right ? '<div style="display:flex;gap:9px;flex-wrap:wrap">' + right + '</div>' : '') +
          '</div></div>';
      },
      go:     opts.go     || function(){},
      render: opts.render || function(){},
      save:   opts.save   || function(){}
    };
  }

  return {
    $: $, esc: esc, svg: svg, IC: IC, AV: AV,
    comma: comma, compact: compact, money: money, fmtDate: fmtDate, fmtDT: fmtDT, fmtRange: fmtRange, rnd: rnd,
    PORTALS: PORTALS, TYPES: TYPES,
    authedFetch: authedFetch, slugify: slugify, isReservedSlug: isReservedSlug,
    fetchEvents: fetchEvents, fetchEvent: fetchEvent, createEvent: createEvent, updateEvent: updateEvent,
    slugAvailable: slugAvailable, deleteEvent: deleteEvent, discardEvent: discardEvent, restoreEvent: restoreEvent, cloneEvent: cloneEvent,
    fetchSite: fetchSite, saveSite: saveSite, publishEvent: publishEvent, unpublishEvent: unpublishEvent,
    previewDraft: previewDraft, requestApproval: requestApproval, fetchApproval: fetchApproval, decideApproval: decideApproval,
    fetchHistory: fetchHistory, fetchHistoryAndUsage: fetchHistoryAndUsage, fetchActivityLog: fetchActivityLog, fetchApprovalSettings: fetchApprovalSettings, saveApprovalSettings: saveApprovalSettings,
    stageEvent: stageEvent, previewUrl: previewUrl, publicUrl: publicUrl, fetchSiteData: fetchSiteData,
    uploadImage: uploadImage, refreshLogoUnit: refreshLogoUnit, logoUnitDark: logoUnitDark, seedContent: seedContent,
    fetchHeroVideo: fetchHeroVideo, uploadHeroVideo: uploadHeroVideo, saveHeroVideo: saveHeroVideo, removeHeroVideo: removeHeroVideo,
    fetchSub: fetchSub, createSub: createSub, updateSub: updateSub, deleteSub: deleteSub,
    fetchRegistrations: fetchRegistrations, updateRegistration: updateRegistration, deleteRegistration: deleteRegistration,
    exportRegistrations: exportRegistrations,
    fetchForms: fetchForms, createForm: createForm, updateForm: updateForm, deleteForm: deleteForm,
    setDefaultForm: setDefaultForm, reorderForms: reorderForms,
    fetchStats: fetchStats, fetchInsights: fetchInsights, fetchActivity: fetchActivity,
    fetchLeads: fetchLeads, bulkCreateLeads: bulkCreateLeads, bulkUpdateLeads: bulkUpdateLeads, bulkDeleteLeads: bulkDeleteLeads,
    appendLeadNote: appendLeadNote, removeLeadNote: removeLeadNote,
    statTile: statTile, panel: panel, panelFlush: panelFlush, emptyState: emptyState,
    toast: toast, loadState: loadState, saveState: saveState, makeCtx: makeCtx
  };
})();
