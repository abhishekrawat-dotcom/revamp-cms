/* ===========================================================================
   ET Oneworld - Revamp CMS
   Edit Event : CORE

   Shared foundation for the event console. Everything here is used by the
   shell (edit-event.html) AND by the standalone section workbenches, so a
   section file can be opened and worked on entirely on its own.

   Exposes one global: window.RevampCore

     .IC                  icon path table
     .esc .svg            escaping and icon rendering
     .comma .compact .money .fmtDate .fmtDT
     .PORTALS .TYPES .AV
     .fetchEvent(eventId)         GET  /api/event — real event doc from Firestore
     .createEvent(data)           POST /api/event — creates one
     .updateEvent(eventId, patch) PATCH /api/event — updates one
     .fetchRegistrations(eventId) GET  /api/event/registrations — real attendee list
     .publishEvent(eventId, html) POST /api/event/publish — stores the editor's final rendered page for
                                   real (custom_editor.html's Publish button), -> {publishedUrl}
     .stageEvent(eventId, html)   POST /api/event/stage — same, for the Preview button, -> {stagingUrl}
                                   (one stable URL per event, never touches published/publishedUrl)
     .fetchSub(resource, eventId)              GET    /api/event/<resource> — list
     .createSub(resource, eventId, data)       POST   /api/event/<resource> — create, -> {id}
     .updateSub(resource, eventId, id, patch)  PATCH  /api/event/<resource> — update
     .deleteSub(resource, eventId, id)         DELETE /api/event/<resource> — delete
       resource is one of: speakers, speaker-groups, sessions, agenda-groups, partners,
       partner-tiers, gallery, faqs, contacts
     .statTile .panel .panelFlush .emptyState
     .toast(msg)
     .loadState(key) .saveState(key, obj)
     .makeCtx(opts)       builds the object every section view receives

   fetchEvent/createEvent/updateEvent/fetchRegistrations are admin-gated: they call
   window.RevampAuth.getIdToken() for the Authorization: Bearer <token> header. If
   window.RevampAuth isn't loaded yet (sign-in wiring is a parallel, separately-landing
   piece of work), they fail soft with a console warning and a rejected promise rather
   than throwing — callers should .catch() and show a "please sign in" state.
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
  function fmtDT(iso){
    if (!iso) return 'Date to be announced';
    var d = new Date(iso);
    if (isNaN(d)) return 'Date to be announced';
    var hh = d.getHours(), mm = d.getMinutes();
    var ap = hh >= 12 ? 'PM' : 'AM', h12 = hh % 12 || 12;
    return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
           ' (' + (h12 < 10 ? '0' : '') + h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap + ')';
  }
  function fmtDate(iso){
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  }
  function money(n){
    if (n == null) return '—';
    return '₹ ' + comma(n);
  }

  function toast(msg){
    var host = $('toast-host');
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = svg(IC.check, 15) + '<span>' + esc(msg) + '</span>';
    host.appendChild(el);
    setTimeout(function(){
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
      setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2600);
  }

  var AV    = ['#ED1C24','#2F6FB0','#2F8F5B','#8A5A9E','#9C6B14','#B3151B','#3E7C7C','#A2457A'];

  /* ---------------------------------------------------------------- real backend (functions/lib/api.js)
     Every event identifier from here on is the real Firestore slug string (e.g.
     'ethrworld-nextsummit') — there is no numeric 1-8 id scheme any more, nothing here special-cases it.
     All four calls below are admin-gated (functions/lib/api.js's requireAdmin()): they need a verified
     Firebase ID token in an `Authorization: Bearer <token>` header. Sign-in itself is a parallel, not-yet-
     landed piece of work (see window.RevampAuth below), so every call here fails soft — rejecting its
     promise with a clear Error — rather than throwing, whether that's because RevampAuth isn't loaded yet,
     the user isn't signed in, or the token is stale (server 401). Callers should .catch() and show a
     "please sign in" state instead of letting the rejection go unhandled. */

  function getIdToken(){
    if (!window.RevampAuth || typeof window.RevampAuth.getIdToken !== 'function'){
      console.warn('[RevampCore] window.RevampAuth.getIdToken() is not available yet (sign-in isn\'t wired up) — API calls will fail until it is.');
      return Promise.reject(new Error('Not signed in.'));
    }
    return window.RevampAuth.getIdToken();
  }

  function authedFetch(url, opts){
    opts = opts || {};
    return getIdToken().then(function(token){
      var headers = {};
      for (var k in (opts.headers || {})) if (opts.headers.hasOwnProperty(k)) headers[k] = opts.headers[k];
      headers['Authorization'] = 'Bearer ' + token;
      if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      opts.headers = headers;
      return fetch(url, opts);
    });
  }

  function readJsonResponse(res){
    return res.json().catch(function(){ return {}; }).then(function(data){
      if (!res.ok){
        var err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
        err.status = res.status;
        throw err;
      }
      return data;
    });
  }

  function fetchEvent(eventId){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(new Error('fetchEvent: eventId is required.'));
    return authedFetch('/api/event?eventId=' + encodeURIComponent(eventId), { method: 'GET' })
      .then(readJsonResponse)
      .then(function(data){
        data.id = eventId;
        data.eventId = eventId;
        return data;
      });
  }

  function createEvent(data){
    data = data || {};
    var eventId = String(data.eventId || data.slug || '').trim();
    if (!eventId) return Promise.reject(new Error('createEvent: eventId/slug is required.'));
    return authedFetch('/api/event', { method: 'POST', body: JSON.stringify(data) })
      .then(readJsonResponse);
  }

  function updateEvent(eventId, patch){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(new Error('updateEvent: eventId is required.'));
    var body = { eventId: eventId };
    for (var k in (patch || {})) if (patch.hasOwnProperty(k)) body[k] = patch[k];
    return authedFetch('/api/event', { method: 'PATCH', body: JSON.stringify(body) })
      .then(readJsonResponse);
  }

  function publishEvent(eventId, html){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(new Error('publishEvent: eventId is required.'));
    if (!html) return Promise.reject(new Error('publishEvent: html is required.'));
    return authedFetch('/api/event/publish', { method: 'POST', body: JSON.stringify({ eventId: eventId, html: html }) })
      .then(readJsonResponse);   // -> {publishedUrl, publishedAt}
  }

  function stageEvent(eventId, html){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(new Error('stageEvent: eventId is required.'));
    if (!html) return Promise.reject(new Error('stageEvent: html is required.'));
    return authedFetch('/api/event/stage', { method: 'POST', body: JSON.stringify({ eventId: eventId, html: html }) })
      .then(readJsonResponse);   // -> {stagingUrl}
  }

  function fetchRegistrations(eventId){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(new Error('fetchRegistrations: eventId is required.'));
    return authedFetch('/api/event/registrations?eventId=' + encodeURIComponent(eventId), { method: 'GET' })
      .then(readJsonResponse)
      .then(function(data){ return (data && data.items) || []; });
  }

  /* ---- generic per-event subcollection CRUD ----
     One shared client for the 9 structurally-identical resources functions/lib/api.js's own
     subcollectionRoutes() factory serves: 'speakers', 'speaker-groups', 'sessions', 'agenda-groups',
     'partners', 'partner-tiers', 'gallery', 'faqs', 'contacts'. Every record gets a server-assigned `id`;
     list results are NOT guaranteed sorted beyond the server's own `order`-field sort (empty/equal `order`
     values sort together, stable otherwise) — a tab that needs a specific manual order should still sort
     client-side off the `order` field it itself maintains, same as before. */
  function fetchSub(resource, eventId){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(new Error('fetchSub(' + resource + '): eventId is required.'));
    return authedFetch('/api/event/' + resource + '?eventId=' + encodeURIComponent(eventId), { method: 'GET' })
      .then(readJsonResponse)
      .then(function(data){ return (data && data.items) || []; });
  }
  function createSub(resource, eventId, data){
    eventId = String(eventId || '').trim();
    if (!eventId) return Promise.reject(new Error('createSub(' + resource + '): eventId is required.'));
    var body = { eventId: eventId };
    for (var k in (data || {})) if (data.hasOwnProperty(k)) body[k] = data[k];
    return authedFetch('/api/event/' + resource, { method: 'POST', body: JSON.stringify(body) })
      .then(readJsonResponse);   // -> {id}
  }
  function updateSub(resource, eventId, id, patch){
    eventId = String(eventId || '').trim(); id = String(id || '').trim();
    if (!eventId || !id) return Promise.reject(new Error('updateSub(' + resource + '): eventId and id are required.'));
    var body = { eventId: eventId, id: id };
    for (var k in (patch || {})) if (patch.hasOwnProperty(k)) body[k] = patch[k];
    return authedFetch('/api/event/' + resource, { method: 'PATCH', body: JSON.stringify(body) })
      .then(readJsonResponse);   // -> {ok:true}
  }
  function deleteSub(resource, eventId, id){
    eventId = String(eventId || '').trim(); id = String(id || '').trim();
    if (!eventId || !id) return Promise.reject(new Error('deleteSub(' + resource + '): eventId and id are required.'));
    return authedFetch('/api/event/' + resource + '?eventId=' + encodeURIComponent(eventId) + '&id=' + encodeURIComponent(id), { method: 'DELETE' })
      .then(readJsonResponse);   // -> {ok:true}
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
    var S = { sections:null, nav:null, checklist:null, published:false, theme:'ET Red' };
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
  function toast(msg){
    var host = $('toast-host');
    if (!host){
      host = document.createElement('div');
      host.className = 'toast-host'; host.id = 'toast-host';
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = svg(IC.check, 15) + '<span>' + esc(msg) + '</span>';
    host.appendChild(el);
    setTimeout(function(){
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
      setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2600);
  }

  /* ----------------------------------------------------------------
     The bundle every section view receives. A section never reaches
     outside this object, which is what lets it live in its own file.

     opts: { EV, S, PEOPLE, vhead, go, render, save }
     ---------------------------------------------------------------- */
  function makeCtx(opts){
    return {
      EV: opts.EV,
      S: opts.S,
      PEOPLE: opts.PEOPLE || [],
      IC: IC, AV: AV, PORTALS: PORTALS, TYPES: TYPES,
      $: $, esc: esc, svg: svg,
      comma: comma, compact: compact, money: money, fmtDate: fmtDate, fmtDT: fmtDT,
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
    comma: comma, compact: compact, money: money, fmtDate: fmtDate, fmtDT: fmtDT, rnd: rnd,
    PORTALS: PORTALS, TYPES: TYPES,
    fetchEvent: fetchEvent, createEvent: createEvent, updateEvent: updateEvent,
    fetchRegistrations: fetchRegistrations, publishEvent: publishEvent, stageEvent: stageEvent,
    fetchSub: fetchSub, createSub: createSub, updateSub: updateSub, deleteSub: deleteSub,
    statTile: statTile, panel: panel, panelFlush: panelFlush, emptyState: emptyState,
    toast: toast, loadState: loadState, saveState: saveState, makeCtx: makeCtx
  };
})();
