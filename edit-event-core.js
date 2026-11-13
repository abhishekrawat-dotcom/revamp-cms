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
     The one way every page writes a date (UX-010):
     .fmtDate(v, opts)    "14 Mar 2027" — a date-only value is that calendar day, never shifted or timed;
                          opts.time "14 Mar 2027, 7:00 pm" (when the value has a time), opts.day "Sun 14 Mar 2027",
                          opts.ist a server stamp written as India time
     .fmtDT(v, opts)      "14 Mar 2027, 7:00 pm" — the time only when the value has one; "Date to be announced"
     .fmtTime(v, opts)    "7:00 pm"; '' when the value has no time
     .fmtRange(start,end) "14–15 Mar 2027", "30 Mar – 2 Apr 2027"; '' with no start
     .AV                  the avatar colours
                          An event's portal is ev.portal (a slug of ET's roster) and its name ev.portalName, both
                          from the server; the roster itself is portal-picker.js's (window.RevampPortals), so
                          no table of portal names is kept here
     .TYPES               the one table of event categories (key -> label); no page keeps its own
     .CATEGORY_KEYS       ['ip','client','awards']: the categories Create Event makes, the only ones offered
     .typeLabel(key)      a category's name ('' for none; an unknown one as stored)
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
                                   'stale', err.current {updatedAt, updatedBy} (someone else saved first).
                                   A patch with a portal carries ifPortal, the portal the page showed ('' for
                                   none): 409 -> err.code 'portal-changed', err.current, err.currentName
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
     .fetchSiteOutline(eventId)   GET    /api/event/site-outline -> {of: 'live'|'saved'|'none', version, places,
                                   previous, logo}: what the site shows of the Content tabs (the console's notes)
     .saveSite(eventId, {templateId, baseVersion, snapshot, html, force, note, automatic})
                                  PUT    /api/event/site -> {version, updatedAt, unchanged?}; 409 -> err.current
                                   {version, updatedAt, updatedBy} (someone else saved first)
     .stageSiteContent(eventId)   POST   /api/event/site/records -> Content drawn into the saved site as a
                                   version of its own (see the function)
     .fetchBriefDetails(eventId)  GET    /api/promo/details -> {fromBrief}: what the brief says for Basics'
                                   who should attend, key topics and headline numbers
     .publishEvent(eventId)       POST   /api/event/publish -> {publishedPath, publishedUrl, publishedAt,
                                   publishedVersion}; 409 when no site was ever saved. Publishes the SAVED
                                   site. (publishEvent(eventId, html) — the older form — still works.)
     .unpublishEvent(eventId)     POST   /api/event/unpublish
     .restoreVersion(eventId, n)  POST   /api/event/restore-version: version n, live before, live again (approvers)
     .previewUrl(eventId)         -> absolute URL of /preview/<id> (a string, not a promise)
     .publicUrl(event)            -> absolute URL of the event's public page, the public base + /e/<id>
                                   (a string, not a promise; '' when the event has no id)
     .publicBase()                -> the public base the server named (X-Public-Base), else this origin
     .notePublicBase(res)         -> keeps the X-Public-Base of a fetch Response a page made on its own
     .siteState(event, approval)  -> where the site stands: live / offline / draft, a request waiting or
                                   rejected, newer changes not live, and the chips that say so (see the function)
     .mayTakeOffline(approval)    -> false only when approvers are named and the signed-in person is not one
     .basicsGaps(fields)          -> the six Basics rows ({key, label, field, why}; why '' when it is done)
     .readSiteHead(html)          -> what a page tells search engines and link previews (title, description,
                                   canonical, image, robots / noindex, eventLd), read from its own tags
     .DESC                        {min, ideal, max}: the short description's lengths (Basics' counter and rule)
     .stageEvent(eventId, html)   POST   /api/event/stage — the older Preview; kept for cached editors
     .fetchSiteData(eventId)      GET    /api/public/site-data -> what the site shows (section 5 shape)
     Content
     .uploadImage(eventId, kind, file)
                                  POST   /api/event/upload -> {url, path}. file is a File or Blob; kind is
                                   speakers | partners | gallery | logo | banner | media | brief. Refuses a
                                   non-image or anything over 8 MB before sending.
     .storePicture(eventId, kind, value, name)
                                  -> a picture held as image text (a data: URL) uploaded as above, resolved as
                                   its address; any other value resolved as it is (see the function)
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
     .toast(msg, opts)    the one message of every page (UX-006): a success (a tick); opts.kind 'error' a failure
                          (red, announced, stays until dismissed) or 'info'; { action: { label, onClick } },
                          retry, sticky, duration. Draws itself on any page; returns the function that closes it.
     .errText(err)        what to tell the user about a failed request (never a server fault's own words)
     .loadErrorText(err, opts) / .renderLoadError(host, err, opts)
                          the one "Event not found" / "Couldn't load this event" state (UX-008)
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

  /* The event categories, ONE name each, used on every page (UX-005): Create Event's cards, the console's
     Category list and header, the dashboard's Event type filter, row chip and phone Filters sheet. They were
     "IP & Residential Event" / "IP Event" / "Intellectual Property (IP)" for the same thing on three pages.
     CATEGORY_KEYS are the three Create Event makes, and the only ones any page offers. The others are only
     named, for an event made before there were three: such an event still shows its own category, and the
     dashboard's filter lists one only while some loaded event has it. The server keeps the same names
     (functions/lib/promo.js CATEGORY_LABELS, dash-bot.js TYPE_LABELS); events-dashboard-b11.test.js checks
     that they agree. */
  var TYPES = {
    ip:'IP Event', client:'Client Event', awards:'Awards',
    editorial:'Editorial', leadgen:'Lead-Gen Microsite', roundtable:'Round Table', virtual:'Virtual Event'
  };
  var CATEGORY_KEYS = ['ip', 'client', 'awards'];
  /* a category's name, or '' for none: a value the table does not know is shown as it is stored */
  function typeLabel(key){
    var k = String(key == null ? '' : key).trim();
    return Object.prototype.hasOwnProperty.call(TYPES, k.toLowerCase()) ? TYPES[k.toLowerCase()] : k;
  }

  /* deterministic pseudo-random — no longer used to seed fake event/attendee data (that's gone, see
     fetchEvent/fetchRegistrations below). No page calls RevampCore.rnd any more either: its last caller,
     edit-event-marketing.js, was deleted when that old page became a redirect to Promotions (UX-137). It stays
     exported only so that taking it off RevampCore is a change of its own. */
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
     time nobody entered. -> { d: Date in local time, timed: whether the value carries a time,
     zoned: whether it names its own time zone (a stamp the server made, "…Z") } or null. */
  function readDate(v){
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : { d: v, timed: true, zoned: true };
    if (typeof v === 'number'){ var n = new Date(v); return isNaN(n) ? null : { d: n, timed: true, zoned: true }; }
    var str = String(v).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (m){
      var day = new Date(+m[1], +m[2] - 1, +m[3]);
      return (day.getMonth() === +m[2] - 1 && day.getDate() === +m[3]) ? { d: day, timed: false, zoned: false } : null;
    }
    var d = new Date(str);
    return isNaN(d) ? null : { d: d, timed: true, zoned: /(Z|[+-]\d{2}:?\d{2})$/i.test(str) };
  }
  /* ONE way to write a date on every page (UX-010): "5 Dec 2026"; with opts.time "5 Dec 2026, 10:41 am";
     with opts.day "Sat 5 Dec 2026"; a range is fmtRange's "5–7 Dec 2026". A time is written only when the
     value has one, never made up. opts.ist: a stamp the server made, written as India time — for a page
     whose heading says IST, so it is right on a laptop set to another zone. A date typed into a form
     carries no zone: it is already the wall-clock time and is never shifted. */
  var WDAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function inZone(r, opts){
    if (!(opts && opts.ist) || !r.zoned) return r.d;
    return new Date(r.d.getTime() + (330 + r.d.getTimezoneOffset()) * 60000);
  }
  function clock(d){
    var hh = d.getHours(), mm = d.getMinutes();
    return (hh % 12 || 12) + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (hh < 12 ? 'am' : 'pm');
  }
  /* "14 Mar 2027"; opts { time, day, ist } as above; '—' when there is no date */
  function fmtDate(iso, opts){
    var r = readDate(iso);
    if (!r) return '—';
    var d = inZone(r, opts);
    var out = (opts && opts.day ? WDAY[d.getDay()] + ' ' : '') + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
    return (opts && opts.time && r.timed) ? out + ', ' + clock(d) : out;
  }
  /* "10:41 am"; '' for a value with no time */
  function fmtTime(iso, opts){
    var r = readDate(iso);
    return r && r.timed ? clock(inZone(r, opts)) : '';
  }
  /* "14 Mar 2027, 7:00 pm" — the date, and its time when the value has one; "Date to be announced" without one */
  function fmtDT(iso, opts){
    if (!readDate(iso)) return 'Date to be announced';
    return fmtDate(iso, { time: true, day: opts && opts.day, ist: opts && opts.ist });
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

  /* initials are white on these: each at 4.5:1 or more (UX-004; the ET red and the green were 4.38 and 4.04) */
  var AV    = ['#D3141B','#2F6FB0','#23744A','#8A5A9E','#9C6B14','#B3151B','#3E7C7C','#A2457A'];

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
    notePublicBase(res);
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
  /* An approver puts a version that was live before back live, at once (UX-107; approvers only, as taking a site
     offline is). -> {restoredVersion, replacedVersion, publishedPath, publishedUrl, publishedAt, publishedVersion} */
  function restoreVersion(eventId, version){
    return need(eventId, 'restoreVersion: eventId') ||
      api('POST', '/api/event/restore-version', { eventId: String(eventId).trim(), version: +version || 0, origin: location.origin });
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
  /* ---- Settings › URL & SEO (functions/lib/api-seo.js) ----
     fetchSeo(eventId)              -> the section: the draft, what is live, what the next publish writes, the checklist
     writeSeo(eventId, fields)      -> { values, before, aiWritten, aiWrittenBefore, dropped, updatedAt }: ETB2B AI writes
                                       and SAVES those fields (Undo saves `before` back through updateEvent)
     draftFaqs(eventId)             -> { faqs: [{ question, answer }], dropped }: nothing saved
     fetchSeoPrevious(eventId, pick)-> { previous, sameVenue, venueNow, venueThen }: pick { portal, id } or none (the
                                       one the event records) */
  function fetchSeo(eventId){
    return need(eventId, 'fetchSeo: eventId') || api('GET', '/api/event/seo?eventId=' + q(eventId));
  }
  function writeSeo(eventId, fields){
    return need(eventId, 'writeSeo: eventId') || api('POST', '/api/event/seo/write', { eventId: String(eventId).trim(), fields: fields || [] });
  }
  function draftFaqs(eventId){
    return need(eventId, 'draftFaqs: eventId') || api('POST', '/api/event/seo/write', { eventId: String(eventId).trim(), faqs: true });
  }
  function fetchSeoPrevious(eventId, pick){
    return need(eventId, 'fetchSeoPrevious: eventId') ||
      api('GET', '/api/event/seo/previous?eventId=' + q(eventId) + (pick && pick.portal ? '&portal=' + q(pick.portal) + '&id=' + q(pick.id) : ''));
  }
  /* one ET portal's own events (or, kind 'award', its awards) from ET's listing — a previous edition is picked from these */
  function fetchEtEvents(portal, kind){
    return need(portal, 'fetchEtEvents: portal') || api('GET', '/api/et/events?portal=' + q(portal) + (kind === 'award' ? '&kind=award' : ''));
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
  /* the speaker and sponsor library (functions/lib/et-library.js): ET's records and EventSphere's own, by name.
     kind: 'speakers' | 'sponsors'. -> { items, coverage }. buildLibrary reads from ET what is missing or a day old. */
  function searchLibrary(kind, q, eventId){
    return api('GET', '/api/library/' + (kind === 'sponsors' ? 'sponsors' : 'speakers') + '?q=' + encodeURIComponent(String(q || '').slice(0, 80)) +
      (eventId ? '&eventId=' + encodeURIComponent(eventId) : ''));
  }
  function buildLibrary(eventId){ return api('POST', '/api/library/build', { eventId: String(eventId || '') }); }
  /* where each named speaker's photo is on a brochure's pages (functions/lib/speaker-photos.js): pages [{ data (JPEG
     base64), w, h }], six at most -> { found: [{ name, page, box: { x0, y0, x1, y1 } }], dropped } */
  function findSpeakerPhotos(eventId, names, pages){ return api('POST', '/api/event/speaker-photos/find', { eventId: String(eventId || ''), names: names || [], pages: pages || [] }); }
  /* Speakers and Sponsors across ET (functions/lib/people.js; people.html): kind 'speakers' | 'sponsors' */
  function peopleKind(kind){ return kind === 'sponsors' ? 'sponsors' : 'speakers'; }
  /* params: { q, filter, sort, page, per, company, designation, portal, has, lacks, complete, jury, sessions } — or (kind, q, filter) */
  function listPeople(kind, q, filter){
    var p = q && typeof q === 'object' ? q : { q: q, filter: filter };
    var parts = [];
    ['q', 'filter', 'sort', 'page', 'per', 'company', 'designation', 'portal', 'has', 'lacks', 'complete', 'profile', 'jury', 'sessions'].forEach(function(k){
      var v = p[k];
      if (v === undefined || v === null || v === '' || v === false) return;
      parts.push(k + '=' + encodeURIComponent(v === true ? '1' : String(v).slice(0, 80)));
    });
    return api('GET', '/api/people/' + peopleKind(kind) + (parts.length ? '?' + parts.join('&') : ''));
  }
  function fetchPerson(kind, slug){ return api('GET', '/api/people/' + peopleKind(kind) + '/one?slug=' + encodeURIComponent(String(slug || ''))); }
  /* body: { slug, base (the version read), page, hidden } */
  function savePerson(kind, body){ return api('PUT', '/api/people/' + peopleKind(kind) + '/one', body || {}); }
  function mergePeople(kind, slug, other){ return api('POST', '/api/people/' + peopleKind(kind) + '/merge', { slug: String(slug || ''), other: String(other || '') }); }
  function splitPerson(kind, slug, rows){ return api('POST', '/api/people/' + peopleKind(kind) + '/split', { slug: String(slug || ''), rows: rows || [] }); }
  function undoPerson(kind, slug){ return api('POST', '/api/people/' + peopleKind(kind) + '/undo', { slug: String(slug || '') }); }
  /* ETB2B AI's draft of a page's About, from its facts (never saved by it): -> { about } */
  /* Wikipedia on a page: action 'find' | 'use' (with qid) | 'off' | 'on' -> the page's view again */
  function personWiki(kind, slug, action, qid){ return api('POST', '/api/people/' + peopleKind(kind) + '/wiki', { slug: String(slug || ''), action: String(action || ''), qid: String(qid || '') }); }
  function writePersonAbout(kind, slug, note){ return api('POST', '/api/people/' + peopleKind(kind) + '/about', { slug: String(slug || ''), note: String(note || '').slice(0, 300) }); }
  /* Settings › Access (functions/lib/api-access.js): who may use EventSphere, as what, in which portals */
  function fetchAccess(){ return api('GET', '/api/access'); }
  function saveAccessMember(m){ return api('POST', '/api/access/member', m || {}); }
  function removeAccessMember(email){ return api('POST', '/api/access/remove', { email: email }); }
  function saveAccessDefault(role){ return api('POST', '/api/access/default', { role: role }); }

  /* ---- where the published sites are (UX-001, owner decision #2) ----
     Every /api/ answer carries X-Public-Base: the ONE setting the server builds every public address from
     (functions/lib/public-base.js: PUBLIC_BASE_URL, else the hosted address). It is kept here and in this
     browser, so the next page shows the same address from its first paint; the pages never keep a host of
     their own (the made-up etoneworld.com and events.economictimes.indiatimes.com were exactly that). Until
     an answer has said it, it is this page's own origin, which serves the sites as well. A page that drew an
     address before the first answer can listen for 'revamp:publicbase' and draw it again. */
  var PUBLIC_BASE_KEY = 'rv-public-base', publicBaseNow = '';
  function cleanBase(v){
    var m = /^(https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?)\/?$/.exec(String(v == null ? '' : v).trim());
    return m ? m[1] : '';
  }
  function publicBase(){
    if (!publicBaseNow){
      try { publicBaseNow = cleanBase(window.localStorage.getItem(PUBLIC_BASE_KEY)); } catch (e) { /* storage blocked: the answer still says it */ }
    }
    return publicBaseNow || location.origin;
  }
  /* res: a fetch Response from this server (any /api/ answer); pages that fetch on their own pass theirs too */
  function notePublicBase(res){
    var v = '';
    try { v = cleanBase(res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('X-Public-Base') : ''); } catch (e) { v = ''; }
    if (!v) return;
    var was = publicBase();
    publicBaseNow = v;
    try { window.localStorage.setItem(PUBLIC_BASE_KEY, v); } catch (e) { /* not kept: this page still has it */ }
    if (was !== v){
      try { window.dispatchEvent(new CustomEvent('revamp:publicbase', { detail: { base: v } })); } catch (e) { /* an old browser: the next paint has it */ }
    }
  }

  /* Both are plain strings — never a made-up domain. A preview is the CMS's own signed-in page, so it is on
     this page's host; the public address of an event is the public base + /e/<id> whether or not it is
     published yet (callers say "not live yet" from event.published; the address itself does not change). */
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
    return path ? publicBase() + path : '';
  }

  /* ---- where the event's site stands ----
     The one reading of an event's publishing state, so the console's header, its Dashboard and Settings ›
     Visibility can never disagree. Built only from what the server recorded:
       event     as fetchEvent gives it: published, publishedAt, publishedVersion, unpublishedAt, site.version,
                 and approval { id, toVersion, requestedBy, requestedAt } while a request is waiting
       approval  optional, fetchApproval's answer: its `requests` (newest first) say whether the last one was
                 rejected; `rejectNote` is that request's reason when the page fetched it
     -> { live, offline, liveVersion, savedVersion, publishedAt, newer, pending, rejected, chips }
     chips: the primary state first (Live since <date> / Offline / Draft), then at most one about changes
     (Waiting for approval / Changes rejected / Newer changes not published): { text, short, tone, title, href };
     `short` is the same in a word or two, for a narrow top bar. */
  function reviewPathOf(eventId, requestId){
    return '/review.html?event=' + encodeURIComponent(eventId) + '&request=' + encodeURIComponent(requestId);
  }
  function siteState(event, approval){
    var e = event || {}, id = String(e.eventId || e.id || '').trim();
    var live = e.published === true;
    var liveVersion = live ? (+e.publishedVersion || 0) : 0;
    var savedVersion = (e.site && +e.site.version) || 0;
    var offline = !live && !!e.unpublishedAt;
    var a = e.approval && typeof e.approval === 'object' && e.approval.id ? e.approval : null;
    var pending = a ? { id: String(a.id), toVersion: +a.toVersion || 0, requestedBy: a.requestedBy || '', requestedAt: a.requestedAt || null,
      reviewPath: reviewPathOf(id, a.id) } : null;
    /* a rejection matters only while nothing newer has been asked for: the newest request is the one that counts */
    var last = !pending && approval && Array.isArray(approval.requests) ? approval.requests[0] : null;
    var rejected = last && last.status === 'rejected' && last.id ? { id: String(last.id), toVersion: +last.toVersion || 0,
      decidedBy: last.decidedBy || '', decidedAt: last.decidedAt || null, note: String((approval && approval.rejectNote) || ''),
      reviewPath: reviewPathOf(id, last.id) } : null;
    var newer = live && savedVersion > liveVersion && !pending;
    var when = live && readDate(e.publishedAt) ? fmtDate(e.publishedAt) : '';

    var chips = [];
    if (live) chips.push({ text: when ? 'Live since ' + when : 'Live', short: 'Live', tone: 'ok',
      title: (liveVersion ? 'Version ' + liveVersion + ' of the site is live' : 'The site is live') + (when ? ', published on ' + when : '') + '.' });
    else if (offline) chips.push({ text: 'Offline', short: 'Offline', tone: 'mute',
      title: 'The site was taken offline' + (readDate(e.unpublishedAt) ? ' on ' + fmtDate(e.unpublishedAt) : '') + '. Its address shows “This page is not available”.' });
    else chips.push({ text: 'Draft', short: 'Draft', tone: 'mute', title: savedVersion ? 'The site is saved but has not been published.' : 'The site has not been saved yet.' });

    if (pending) chips.push({ text: 'Waiting for approval · Review', short: 'Waiting for approval', tone: 'warn', href: pending.reviewPath,
      title: (pending.toVersion ? 'Version ' + pending.toVersion + ' was' : 'Changes were') + ' sent for approval' +
        (pending.requestedBy ? ' by ' + pending.requestedBy : '') + (readDate(pending.requestedAt) ? ' on ' + fmtDate(pending.requestedAt) : '') + '.' });
    else if (rejected) chips.push({ text: 'Changes rejected · Review', short: 'Rejected', tone: 'bad', href: rejected.reviewPath,
      title: 'Rejected' + (rejected.decidedBy ? ' by ' + rejected.decidedBy : '') + (rejected.note ? ': ' + rejected.note : '.') });
    else if (newer) chips.push({ text: 'Newer changes not published', short: 'Not published', tone: 'warn',
      title: 'Version ' + savedVersion + ' is saved; version ' + liveVersion + ' is live.' });

    return { live: live, offline: offline, liveVersion: liveVersion, savedVersion: savedVersion, publishedAt: live ? (e.publishedAt || null) : null,
      newer: newer, pending: pending, rejected: rejected, chips: chips };
  }

  /* ---- what a published page tells search engines and link previews ----
     readSiteHead(html) -> { title, description, canonical, ogTitle, image, robots, noindex, eventLd }, read from
     the page's own tags (the ones lib/api.js publishTransform and lib/site-a11y.js pagePass write), so Settings ›
     URL & SEO shows what the live page really carries. Plain text matching, no DOM: it runs anywhere. A value
     the page does not carry is ''. eventLd is true when a schema.org Event is given (JSON-LD). */
  function decodeEntities(s){
    return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt|nbsp);/gi, function(m, x){
      var k = x.toLowerCase();
      if (k.charAt(0) === '#'){
        var n = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        if (!(isFinite(n) && n > 0 && n < 0x110000)) return m;
        return String.fromCodePoint ? String.fromCodePoint(n) : String.fromCharCode(n);
      }
      return { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ' }[k];
    });
  }
  function tagAttrs(tag){
    var out = {}, re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g, m;
    while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[3] != null ? m[3] : (m[4] != null ? m[4] : m[5]));
    return out;
  }
  function readSiteHead(html){
    var text = String(html || '');
    var end = text.search(/<\/head\s*>/i);
    var head = (end === -1 ? text.slice(0, 400000) : text.slice(0, end)).replace(/<!--[\s\S]*?-->/g, '');
    var out = { title: '', description: '', canonical: '', ogTitle: '', image: '', robots: '', noindex: false, eventLd: false };
    var t = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
    if (t) out.title = decodeEntities(t[1]).replace(/\s+/g, ' ').trim();
    (head.match(/<meta\b[^>]*>/gi) || []).forEach(function(tag){
      var a = tagAttrs(tag), key = String(a.name || a.property || '').toLowerCase(), v = String(a.content || '').replace(/\s+/g, ' ').trim();
      if (key === 'description' && !out.description) out.description = v;
      else if (key === 'og:title' && !out.ogTitle) out.ogTitle = v;
      else if (key === 'og:image' && !out.image) out.image = v;
      else if (key === 'robots' && !out.robots) out.robots = v;
    });
    (head.match(/<link\b[^>]*>/gi) || []).some(function(tag){
      var a = tagAttrs(tag);
      if (!/(^|\s)canonical(\s|$)/i.test(a.rel || '')) return false;
      out.canonical = String(a.href || '').trim();
      return true;
    });
    var re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, m;
    while ((m = re.exec(head))){
      if (!/application\/ld\+json/i.test(tagAttrs('<x ' + m[1] + '>').type || '')) continue;
      try {
        var ld = JSON.parse(m[2]), list = Array.isArray(ld) ? ld : (ld && ld['@graph'] ? ld['@graph'] : [ld]);
        if (list.some(function(x){ return x && (x['@type'] === 'Event' || (Array.isArray(x['@type']) && x['@type'].indexOf('Event') !== -1)); })) out.eventLd = true;
      } catch (e) { /* a block that does not parse gives a search engine nothing either */ }
    }
    out.noindex = /(^|[\s,])(noindex|none)([\s,]|$)/i.test(out.robots);
    return out;
  }

  /* Who may take a live site offline (and delete an event): an approver, by the owner's rule — one of
     config/approvals' `approvers`, or anybody signed in while none are named. `approval` is fetchApproval's
     answer ({ me, approvers }); without it nothing is known here and the server decides (it refuses with
     403 'not-an-approver'). */
  function mayTakeOffline(approval){
    if (!approval || !Array.isArray(approval.approvers) || !approval.approvers.length) return true;
    var me = String(approval.me || '').trim().toLowerCase();
    return approval.approvers.map(function(x){ return String(x || '').trim().toLowerCase(); }).indexOf(me) !== -1;
  }

  /* ---- the event's basics: what Basics asks for, and whether each is there ----
     Basics' own checklist (as the form is typed) and the Dashboard (from the stored event) both read this.
     fields: { name, start, end, venue, city, desc, cat, portal } as text; portal is the portal's slug as shown,
     '' while the event has none (a stored value off ET's roster counts as none). DESC is the short description's lengths:
     at least `min`; `ideal` reads best on the listing card and in a search result; `max` is the most a save
     takes, and the server's description writer keeps to it too (functions/lib/event-description.js MAX_LENGTH). */
  var DESC = { min: 40, ideal: 160, max: 220 };
  function basicsGaps(fields){
    var f = fields || {};
    function t(k){ return String(f[k] == null ? '' : f[k]).trim(); }
    var a = readDate(t('start')), b = readDate(t('end'));
    var endBad = !!(a && b && b.d <= a.d);
    var n = t('desc').length;
    return [
      { key: 'name', label: 'Event name', field: 'b-name', why: t('name') ? '' : 'Add the event name' },
      { key: 'date', label: 'Date', field: endBad ? 'b-end' : 'b-start',
        why: !a ? 'Add a start date and time' : (endBad ? 'The end is before the start' : '') },
      { key: 'place', label: 'Venue or city', field: 'b-venue', why: (t('venue') || t('city')) ? '' : 'Add a venue or a city' },
      { key: 'desc', label: 'Short description', field: 'b-desc',
        why: n < DESC.min ? 'Add at least ' + DESC.min + ' characters (now ' + n + ')'
           : (n > DESC.ideal ? 'Shorten to ' + DESC.ideal + ' characters (now ' + n + ')' : '') },
      { key: 'cat', label: 'Category', field: 'b-cat', why: t('cat') ? '' : 'Choose a category' },
      { key: 'portal', label: 'Portal', field: 'b-portal', why: t('portal') ? '' : 'Choose the portal it belongs to' }
    ];
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
  /* What the site shows of the Content tabs (functions/lib/site-outline.js): the sections that list each kind of
     record, the previous edition's own sections, the banner's logo — read off the live page, else the saved one. */
  function fetchSiteOutline(eventId){
    return need(eventId, 'fetchSiteOutline: eventId') || api('GET', '/api/event/site-outline?eventId=' + q(eventId));
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
    /* the editor's own load-time updates, saved apart from the person's changes (recorded as automatic) */
    if (site.automatic === true) body.automatic = true;
    // 409 -> err.current {version, updatedAt, updatedBy}: someone saved on top of baseVersion
    return api('PUT', '/api/event/site', body);  // -> {version, updatedAt}
  }

  /* After a change in Content: the event's records drawn into the saved site, kept as a version of its own on the
     staging address (POST /api/event/site/records) -> { notSaved } | { staged, version, summary, items, unplaced,
     needsEditor, published, publishedVersion, pending: { id, toVersion, reviewPath } | null, approvalRequired } */
  function stageSiteContent(eventId){
    return need(eventId, 'stageSiteContent: eventId') ||
      api('POST', '/api/event/site/records', { eventId: String(eventId).trim() });
  }

  /* What the event's brief says for Content › Basics' three details for posts and mailers (UX-130), read from
     what the brief reader stored (no model is asked): GET /api/promo/details ->
     { fromBrief: { whoShouldAttend: [text], keyTopics: [text], headlineNumbers: [{ value, label }] } } */
  function fetchBriefDetails(eventId){
    return need(eventId, 'fetchBriefDetails: eventId') ||
      api('GET', '/api/promo/details?eventId=' + q(eventId));
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

  /* A picture the console holds as image text — a photo cropped or a logo drawn smaller on a canvas, a library
     entry's picture kept inline in an older record — stored as a file before a record names it: uploaded with
     uploadImage (kind speakers | partners | …) and resolved as its address. Anything else (an address already,
     '', null) is resolved as it is, so a record's pictures can all be passed through. name: what the file is
     named after ("Naven Singh photo"; a name with "logo" in it keeps a logo's WebP copies lossless).
     -> Promise<url | value> */
  var DATA_TYPE_EXT = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'image/svg+xml':'svg' };
  function storePicture(eventId, kind, value, name){
    var s = typeof value === 'string' ? value.trim() : '';
    if (!/^data:/i.test(s)) return Promise.resolve(value);
    var comma = s.indexOf(','), head = comma === -1 ? '' : s.slice(5, comma).toLowerCase();
    var type = head.split(';')[0].trim(), bin = null;
    if (/;\s*base64\s*$/.test(head) && DATA_TYPE_EXT[type]){
      try { bin = atob(s.slice(comma + 1).replace(/\s+/g, '')); } catch (e) { bin = null; }
    }
    if (!bin) return Promise.reject(apiError('That picture could not be read. Add it again.', 400));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var fileName = (String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'picture') + '.' + DATA_TYPE_EXT[type];
    var file;
    try { file = new File([bytes], fileName, { type: type }); } catch (e) { file = new Blob([bytes], { type: type }); }
    return uploadImage(eventId, kind, file).then(function(up){ return up.url; });
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

  /* ---------------------------------------------------------------- shared look (UX-006, UX-008)
     The message and the "could not load" state draw themselves the same way on every page, whatever
     stylesheet the page has, so their rules are written here once (rv- class names, which no page uses
     for anything else). Colours come from the page's own theme variables, so they follow light and dark;
     the fallbacks are for a page that defines none. An error is one red everywhere. */
  var SHARED_CSS = [
    /* the higher of two lifts: the page's own (--rv-toast-bottom, over a save bar or footer) and the one that keeps a
       corner control in view (--rv-toast-clear, below) */
    '.rv-toasts{position:fixed;left:50%;bottom:max(var(--rv-toast-bottom,24px),var(--rv-toast-clear,0px));transform:translateX(-50%);z-index:2147482000;display:flex;' +
      'flex-direction:column;align-items:center;gap:8px;width:max-content;max-width:calc(100vw - 32px);pointer-events:none;' +
      'transition:bottom .18s ease}',
    /* ETB2B AI's launcher sits in a bottom corner of every page (etb2b-chat.css: a 52px round 16px up on a phone, a
       pill or round 22px up wider). Up to 880px a message is wide enough to reach that corner, and a failure stays until
       it is dismissed, so it covered the launcher the whole time: the messages start above it there. */
    '@media (max-width:880px){body:has(.rvc-launcher){--rv-toast-clear:calc(80px + env(safe-area-inset-bottom,0px))}}',
    '.rv-toast{display:flex;align-items:flex-start;gap:9px;box-sizing:border-box;max-width:min(460px,100%);padding:10px 14px;border-radius:10px;' +
      'background:var(--text,#191B1F);color:var(--bg,#FFFFFF);font:600 13px/1.45 var(--font-body,Inter,"Segoe UI",system-ui,-apple-system,sans-serif);' +
      'box-shadow:0 8px 24px rgba(0,0,0,.22);pointer-events:auto;overflow-wrap:anywhere;text-align:left;opacity:0;transform:translateY(6px);' +
      'transition:opacity .18s ease,transform .18s ease}',
    '.rv-toast.on{opacity:1;transform:none}',
    '.rv-toast.with-btn{padding-right:8px}',
    '.rv-toast-error{background:#B3151B;color:#FFFFFF}',
    '.rv-toast-ico{display:inline-flex;flex-shrink:0;margin-top:1px}',
    '.rv-toast-msg{flex:1;min-width:0}',
    '.rv-toast-act,.rv-toast-x{flex-shrink:0;-webkit-appearance:none;appearance:none;margin:-2px 0;border:0;background:transparent;color:inherit;' +
      'font:inherit;font-weight:800;cursor:pointer;border-radius:7px}',
    '.rv-toast-act{padding:2px 9px;box-shadow:inset 0 0 0 1px currentColor}',
    '.rv-toast-x{display:grid;place-items:center;width:24px;height:24px;padding:0;opacity:.85}',
    '.rv-toast-act:hover,.rv-toast-x:hover{background:rgba(127,127,127,.28);opacity:1}',
    '.rv-toast-act:focus-visible,.rv-toast-x:focus-visible{outline:2px solid currentColor;outline-offset:1px}',
    '.rv-load-error{grid-column:1/-1;align-self:start;display:flex;flex-direction:column;align-items:center;gap:10px;box-sizing:border-box;width:100%;max-width:560px;margin:0 auto;' +
      'padding:64px 20px;text-align:center;color:var(--text,#1D1B17);font-family:var(--font-body,Inter,"Segoe UI",system-ui,-apple-system,sans-serif)}',
    '.rv-load-error .rv-le-ico{display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:var(--surface-2,#F1F0EC);' +
      'color:var(--text-muted,#6C6A60)}',
    '.rv-load-error h2{margin:4px 0 0;font-size:19px;line-height:1.3;font-weight:700;color:inherit}',
    '.rv-load-error p{margin:0;max-width:46ch;font-size:14px;line-height:1.5;color:var(--text-muted,#6C6A60)}',
    '.rv-le-acts{display:flex;flex-wrap:wrap;justify-content:center;gap:9px;margin-top:10px}',
    '.rv-le-btn{display:inline-flex;align-items:center;gap:7px;box-sizing:border-box;padding:8px 15px;border-radius:9px;font-family:inherit;font-size:13px;font-weight:700;line-height:1.3;' +
      'cursor:pointer;text-decoration:none;border:1.5px solid var(--border,#E6E4DE);background:var(--surface,#FFFFFF);color:var(--text,#1D1B17)}',
    '.rv-le-btn:hover{border-color:var(--accent,#D3141B)}',
    '.rv-le-btn.primary{background:var(--accent,#D3141B);border-color:var(--accent,#D3141B);color:var(--accent-contrast,#FFFFFF)}',
    '.rv-le-btn:focus-visible{outline:2px solid var(--accent,#D3141B);outline-offset:2px}',
    '@media (prefers-reduced-motion:reduce){.rv-toast,.rv-toasts{transition:none}}'
  ].join('\n');
  function sharedCss(){
    if (typeof document === 'undefined' || document.getElementById('rv-core-css')) return;
    var st = document.createElement('style');
    st.id = 'rv-core-css';
    st.textContent = SHARED_CSS;
    var where = document.head || document.documentElement || document.body;
    if (where) where.appendChild(st);
  }

  /* ---------------------------------------------------------------- what to tell the user about a failure
     RevampCore rejects with an Error whose status is the HTTP status (0 when no answer came back) and
     whose message is the server's own sentence. A server fault's wording ("Internal error: Firestore
     DEADLINE_EXCEEDED") is of no use to the person at the screen, so that case gets ours; the detail goes
     to the browser console for whoever is fixing it. A refusal the server explains (a 4xx) is said as it
     is. 'revamp/signed-out' is auth.js saying the session was refused: the page and what was typed stay
     (the sign-in box is over it), so the person is told to sign in and press the button again (UX-013). */
  function errText(err){
    if (typeof err === 'string') return err;
    var status = err && typeof err.status === 'number' ? err.status : 0;
    var said = (err && err.message) || '';
    if (err && err.code === 'revamp/signed-out') return 'You were signed out. Sign in again, then try once more: what you typed is still here.';
    if (status === 401 || (!status && /not signed in/i.test(said))) return 'Your sign-in has expired. Sign in again, then try once more.';
    if (!status) return 'We couldn’t reach the server. Check your connection and try again.';
    if (status >= 500) return 'Something went wrong on our side. Please try again.';
    return said || 'That could not be done. Please try again.';
  }

  /* ---------------------------------------------------------------- when a page cannot open its event (UX-008)
     One pattern on every page: a plain headline, a one-line reason, one way back (Back to events), and no
     Preview, Publish or rail while there is no event — the page hides those (opts.hide). Never the server's
     words and never the raw id.
     loadErrorText(err, { kind, none }) -> { title, text, missing, retry }
       kind 'none': there is no event in the address ('missing': known to be gone); otherwise read from err.
       none: what to open instead, finishing "Use Back to events and open …" (default "the event you want"). */
  function loadErrorText(err, opts){
    opts = opts || {};
    var status = err && typeof err.status === 'number' ? err.status : 0;
    if (opts.kind === 'none') return { title: 'No event selected', text: 'Use Back to events and open ' + (opts.none || 'the event you want') + '.', missing: true, retry: false };
    if (opts.kind === 'missing' || status === 404) return { title: 'Event not found', text: 'This event doesn’t exist or was deleted. Use Back to events to open another one.', missing: true, retry: false };
    if (status === 403) return { title: 'You can’t open this event', text: 'Your account does not have access to it. Use Back to events to open another one.', missing: true, retry: false };
    if (status === 401 || (err && err.code === 'revamp/signed-out')) return { title: 'Couldn’t load this event', text: 'Your sign-in has expired. Sign in again, then try once more.', missing: false, retry: true };
    return { title: 'Couldn’t load this event', missing: false, retry: true,
      text: status >= 500 ? 'Something went wrong on our side. Please try again in a moment.' : 'The event could not be loaded. Check your connection and try again.' };
  }
  /* Paints that state into host and returns what it said. opts: kind, none (as above); onRetry: a function for
     "Try again" (shown only when trying again can help); hide: elements or ids put away (Preview, Publish, the
     rail); title: the element or id of the page's heading, which then reads the headline instead of "Loading…";
     back: where Back to events goes (the events list). */
  function renderLoadError(host, err, opts){
    opts = opts || {};
    var t = loadErrorText(err, opts);
    if (err && opts.kind !== 'none' && typeof console !== 'undefined') console.error('Event load failed:', err);
    sharedCss();
    (opts.hide || []).forEach(function(x){ var el = typeof x === 'string' ? $(x) : x; if (el) el.hidden = true; });
    var head = typeof opts.title === 'string' ? $(opts.title) : opts.title;
    if (head) head.textContent = t.title;
    if (typeof host === 'string') host = $(host);
    if (!host) return t;
    var retry = t.retry && typeof opts.onRetry === 'function';
    host.innerHTML = '<div class="rv-load-error" role="alert"><span class="rv-le-ico">' + svg(IC.info, 22) + '</span>' +
      '<h2>' + esc(t.title) + '</h2><p>' + esc(t.text) + '</p><div class="rv-le-acts">' +
      (retry ? '<button class="rv-le-btn primary" type="button" data-rv-retry>Try again</button>' : '') +
      '<a class="rv-le-btn' + (retry ? '' : ' primary') + '" href="' + esc(opts.back || '/Event_Listing.html') + '">Back to events</a></div></div>';
    var again = host.querySelector('[data-rv-retry]');
    if (again) again.addEventListener('click', function(){ opts.onRetry(); });
    return t;
  }

  /* ---------------------------------------------------------------- toast (UX-006)
     The one message component of every page: bottom-centre, lifted clear of a page's save bar or footer
     (the page sets --rv-toast-bottom), read out by screen readers.
       toast(msg)                         something worked: a tick, gone after a few seconds
       toast(msg, { kind: 'error' })      something did not: one red, a warning mark, announced at once, and it
                                          stays until it is dismissed (the same message is never stacked twice)
       toast(msg, { kind: 'info' })       neither; no mark
       toast(msg, 'error')                the same, shorter
     More options: action { label, onClick } adds one button (Undo, Open copy) and keeps the message eight
     seconds at least; retry: a function adds "Try again"; sticky keeps any message until it is dismissed;
     duration: how long it stays (ms); kind 'auto' reads the wording (for a message that comes with no kind: the
     platform code inside the Promotions studios has none, while Oneworld's own messages there send theirs).
     Pausing the mouse on a message holds it. Returns the function that closes it (also as .dismiss). */
  var TOAST_MAX = 4;
  var FAIL_WORDS = /\b(fail(ed|s|ure)?|could ?n[o'’]t|did ?n[o'’]t|cannot|can[’']t|unable|(is|was)n[’']t (saved|added|sent|loaded|uploaded|allowed|available)|not (been )?(saved|added|sent|loaded|uploaded|allowed|available)|blocked|refused|error)\b/i;
  var DONE_WORDS = /\b(saved|uploaded|downloaded|copied|added|removed|deleted|renamed|reverted|applied|imported|switched|rewritten|enhanced|rebuilt|undone|redone|moved|created|sent|published|updated|restored|discarded|pasted|cut|reset)\b/i;
  function toastKind(msg){
    var s = String(msg == null ? '' : msg);
    if (FAIL_WORDS.test(s)) return 'error';
    return DONE_WORDS.test(s) ? 'success' : 'info';
  }
  /* The messages' place on the page. The events list keeps its #toast-region (its tests and its assistant's
     layers name it), which becomes this place; elsewhere it is made here. */
  function toastHost(){
    if (typeof document === 'undefined' || !document.body) return null;
    var host = $('rv-toasts') || $('toast-region');
    if (!host){
      host = document.createElement('div');
      host.id = 'rv-toasts';
      document.body.appendChild(host);
    }
    if (!host.classList.contains('rv-toasts')){
      host.classList.add('rv-toasts');
      host.removeAttribute('role');
      host.setAttribute('aria-live', 'polite');
    }
    return host;
  }
  function toast(msg, opts){
    if (typeof opts === 'string') opts = { kind: opts };
    opts = opts || {};
    var kind = opts.kind || opts.type || 'success';
    if (kind === 'auto') kind = toastKind(msg);
    if (kind !== 'error' && kind !== 'info') kind = 'success';
    var failed = kind === 'error', text = String(msg == null ? '' : msg);
    var action = opts.action && opts.action.label ? opts.action : null;
    var sticky = failed || !!opts.sticky;
    sharedCss();
    var host = toastHost();
    var noop = function(){};
    noop.dismiss = noop;
    if (!host) return noop;

    /* the same message already on screen is not stacked again (several requests failing for one reason) */
    var open = host.querySelectorAll('.rv-toast');
    for (var i = 0; i < open.length; i++){
      if (open[i].getAttribute('data-msg') === kind + ':' + text && !open[i].hasAttribute('data-gone') && open[i]._rvClose) return open[i]._rvClose;
    }

    var el = document.createElement('div'), timer = null, gone = false;
    el.className = 'rv-toast rv-toast-' + kind;
    el.setAttribute('role', failed ? 'alert' : 'status');
    el.setAttribute('data-msg', kind + ':' + text);
    var mark = failed ? '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.6h.01"/>' : (kind === 'success' ? IC.check : '');
    el.innerHTML = (mark ? '<span class="rv-toast-ico" aria-hidden="true">' + svg(mark, 16) + '</span>' : '') +
      '<span class="rv-toast-msg">' + esc(text) + '</span>';
    function close(){
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      el.setAttribute('data-gone', '');
      el.classList.remove('on');
      setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }
    close.dismiss = close;
    el._rvClose = close;
    function button(cls, label, run, aria){
      var b = document.createElement('button');
      b.type = 'button'; b.className = cls;
      if (aria){ b.setAttribute('aria-label', aria); b.innerHTML = svg('<path d="M18 6L6 18M6 6l12 12"/>', 14); }
      else b.textContent = label;
      b.addEventListener('click', function(){ close(); if (typeof run === 'function') run(); });
      el.appendChild(b);
      el.classList.add('with-btn');
    }
    if (action) button('rv-toast-act', action.label, action.onClick);
    if (typeof opts.retry === 'function') button('rv-toast-act', 'Try again', opts.retry);
    if (sticky || action) button('rv-toast-x', '', null, 'Dismiss this message');

    /* a run of quick actions must not build a wall of messages: the oldest passing ones make room */
    var passing = [];
    for (var j = 0; j < open.length; j++) if (!open[j].hasAttribute('data-sticky') && !open[j].hasAttribute('data-gone') && open[j]._rvClose) passing.push(open[j]);
    for (var k = 0; k <= passing.length - TOAST_MAX; k++) passing[k]._rvClose();
    if (sticky) el.setAttribute('data-sticky', '');
    host.appendChild(el);
    var show = function(){ el.classList.add('on'); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(show); else show();
    if (sticky) return close;
    /* long enough to read, the longer the text the longer, and long enough to reach its button */
    var ms = typeof opts.duration === 'number' && opts.duration > 0 ? opts.duration : Math.min(10000, Math.max(3000, 60 * text.length));
    if (action) ms = Math.max(ms, 8000);
    function arm(){ clearTimeout(timer); timer = setTimeout(close, ms); }
    el.addEventListener('mouseenter', function(){ clearTimeout(timer); });
    el.addEventListener('mouseleave', arm);
    arm();
    return close;
  }
  /* the live region is on the page before the first message, so screen readers hear that one too */
  try {
    if (typeof document !== 'undefined' && document){
      if (document.body) toastHost();
      else if (typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', function(){ toastHost(); });
    }
  } catch (e) { /* no page to put it on (a test, a worker): the first message makes it */ }

  /* ----------------------------------------------------------------
     The bundle every section view receives. A section never reaches
     outside this object, which is what lets it live in its own file.

     opts: { EV, S, vhead, go, render, save }
     ---------------------------------------------------------------- */
  function makeCtx(opts){
    return {
      EV: opts.EV,
      S: opts.S,
      IC: IC, AV: AV, TYPES: TYPES,
      $: $, esc: esc, svg: svg,
      comma: comma, compact: compact, money: money, fmtDate: fmtDate, fmtDT: fmtDT, fmtRange: fmtRange, fmtTime: fmtTime,
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
    comma: comma, compact: compact, money: money, fmtDate: fmtDate, fmtDT: fmtDT, fmtRange: fmtRange, fmtTime: fmtTime, rnd: rnd,
    TYPES: TYPES, CATEGORY_KEYS: CATEGORY_KEYS, typeLabel: typeLabel,
    authedFetch: authedFetch, slugify: slugify, isReservedSlug: isReservedSlug,
    fetchEvents: fetchEvents, fetchEvent: fetchEvent, createEvent: createEvent, updateEvent: updateEvent,
    slugAvailable: slugAvailable, deleteEvent: deleteEvent, discardEvent: discardEvent, restoreEvent: restoreEvent, cloneEvent: cloneEvent,
    fetchSite: fetchSite, fetchSiteOutline: fetchSiteOutline, saveSite: saveSite, stageSiteContent: stageSiteContent, publishEvent: publishEvent, unpublishEvent: unpublishEvent, restoreVersion: restoreVersion,
    previewDraft: previewDraft, requestApproval: requestApproval, fetchApproval: fetchApproval, decideApproval: decideApproval,
    fetchSeo: fetchSeo, writeSeo: writeSeo, draftFaqs: draftFaqs, fetchSeoPrevious: fetchSeoPrevious, fetchEtEvents: fetchEtEvents,
    fetchHistory: fetchHistory, fetchHistoryAndUsage: fetchHistoryAndUsage, fetchActivityLog: fetchActivityLog, fetchApprovalSettings: fetchApprovalSettings, saveApprovalSettings: saveApprovalSettings,
    searchLibrary: searchLibrary, buildLibrary: buildLibrary, findSpeakerPhotos: findSpeakerPhotos,
    listPeople: listPeople, fetchPerson: fetchPerson, savePerson: savePerson, mergePeople: mergePeople, splitPerson: splitPerson, undoPerson: undoPerson, writePersonAbout: writePersonAbout, personWiki: personWiki,
    fetchAccess: fetchAccess, saveAccessMember: saveAccessMember, removeAccessMember: removeAccessMember, saveAccessDefault: saveAccessDefault,
    stageEvent: stageEvent, previewUrl: previewUrl, publicUrl: publicUrl, publicBase: publicBase, notePublicBase: notePublicBase, fetchSiteData: fetchSiteData, fetchBriefDetails: fetchBriefDetails,
    siteState: siteState, mayTakeOffline: mayTakeOffline, basicsGaps: basicsGaps, DESC: DESC, readSiteHead: readSiteHead,
    uploadImage: uploadImage, storePicture: storePicture, refreshLogoUnit: refreshLogoUnit, logoUnitDark: logoUnitDark, seedContent: seedContent,
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
    toast: toast, toastKind: toastKind, errText: errText, loadErrorText: loadErrorText, renderLoadError: renderLoadError,
    loadState: loadState, saveState: saveState, makeCtx: makeCtx
  };
})();
