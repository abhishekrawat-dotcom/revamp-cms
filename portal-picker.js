/* ET's portals in Oneworld 2.0's pages: the roster, the person's working portal, and the "Set portal" window.

   Every Oneworld 2.0 event belongs to one ET B2B portal (ETCIO, ET BrandEquity, ETHRWorld, …), stored on the
   event as a slug (events/<id>.portal). The one roster is the server's (functions/lib/et-events.js PORTALS,
   served by GET /api/et/portals), and the server refuses any other value, so no page keeps a table of its own:
   the dashboard, Create Event, the event console, Promotions and the "Fill in portals" page all read it here.

   window.RevampPortals = {
     list()                    -> Promise<[{ slug, name }]>  the roster, by name. Asked once per page and shared;
                                  a failed read is not kept, so Retry asks again. Rejects with an Error whose
                                  message can be shown as it is.
     nameOf(slug)              -> string  the portal's name ("ETHRWorld"), or '' while the roster has not come
                                  (the person's cached working portal still has its name then)
     optionsHtml(current, placeholder) -> string  <option>s of the roster, `current` selected; with no current
                                  portal, a first disabled `placeholder` option is selected. Before the roster has
                                  come it is the current portal alone.
     chipHtml(opts)            -> string  the "No portal yet" chip with its Set portal button
                                  ([data-set-portal="<opts.eventId>"]); the page wires the button
     openSetPortal(opts)       -> void    the "Set this event's portal" window:
                                  opts { eventId, eventName, current, hasGeneratedSite, published, intro,
                                         returnFocus, onDone(slug, name), onConflict(current, currentName) }
                                  It PATCHes /api/event { eventId, portal, ifPortal: current }. With no eventId it
                                  sends nothing and only reports the choice (Create Event's draft). A 409
                                  'portal-changed' (someone set it meanwhile) shows the server's sentence and Reload.
                                  While "Saving…" shows, Cancel, Escape and the dimmed page wait for the answer, and
                                  a change the server made always reaches onDone (onConflict for a 409), even if
                                  another window replaced this one meanwhile.
     working()                 -> Promise<slug|'all'|null>  the working portal: the server's choice when it has
                                  one (it is then cached here), else this browser's cache, else null. Never rejects.
                                  null means the person now signed in has no choice anywhere, so a page that
                                  painted cachedWorking() before they were known goes back to every portal.
     cachedWorking()           -> slug|'all'|null  this browser's cache, at once, for the first paint
     setWorking(v)             -> Promise<v>  a slug or 'all': cached here first, then saved for the person
                                  (PUT /api/me/working-portal). When that fails the choice stays in this browser
                                  and the promise rejects with a sentence that says so.
   }

   The cache is localStorage 'rv.workingPortal.<uid>' = { v: 1, portal, name }, one per person, so a shared
   browser never shows one person's portal to another once they are known. Until auth.js has said who is signed
   in (a moment after load), 'rv.workingPortal' names the last person seen here, so the dashboard can paint on
   that person's portal at once; the server's answer then wins. working() renames that last person as soon as
   the one signed in is known, even when they have no choice yet, so the next load paints on their own (empty)
   cache rather than on the person before them. Storage that throws (a private window) only loses the cache.

   The window and the chip are drawn in the page's own colour tokens (--surface, --text, --accent-strong, …),
   which every console page defines for light and dark, so flipping the theme switch flips them too. ES5. */
(function () {
  'use strict';

  var STYLE_ID = 'rv-portal-picker-css';
  var DIALOG_ID = 'rv-portal-dialog';
  var CACHE_PREFIX = 'rv.workingPortal.';
  var LAST_KEY = 'rv.workingPortal';
  var LIST_FAILED = 'The portal list could not be loaded.';
  var KEPT_HERE = 'Your portal choice is kept in this browser only: it could not be saved to your account.';
  var OFFLINE = 'Could not reach the server. Check your connection and try again.';

  var roster = null;              // [{ slug, name }] once GET /api/et/portals has answered
  var names = {};                 // slug -> name, for the same roster
  var asking = null;              // the one request for it while it is under way, or done
  var openWindow = null;          // the Set portal window that is open, if any: { close }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /* a roster slug's shape (et-events.js: lower-case letters and digits); the roster itself decides the rest */
  function slugShape(s) { return typeof s === 'string' && /^[a-z0-9]{1,40}$/.test(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function problem(message, status, data) {
    var err = new Error(message);
    err.status = status || 0;
    if (data && typeof data.code === 'string') err.code = data.code;
    return err;
  }

  /* ---------- the server ---------- */

  /* -> Promise<{ status, ok, data }> with the JSON answer (or {}); rejects only when no answer came */
  function call(method, url, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    var auth = window.RevampAuth;
    var sent;
    if (auth && typeof auth.authedFetch === 'function') {
      sent = Promise.resolve().then(function () { return auth.authedFetch(url, opts); });
    } else if (auth && typeof auth.getIdToken === 'function' && typeof window.fetch === 'function') {
      sent = auth.getIdToken().then(function (token) {
        opts.headers.Authorization = 'Bearer ' + token;
        return window.fetch(url, opts);
      });
    } else {
      return Promise.reject(problem('You are not signed in. Sign in and try again.', 401));
    }
    return sent.then(function (r) {
      return Promise.resolve(typeof r.text === 'function' ? r.text() : '').then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        return { status: r.status, ok: !!r.ok, data: data && typeof data === 'object' ? data : {} };
      });
    }, function (err) {
      /* auth.js's own refusal (signed out) carries a status and a sentence; anything else is the network */
      if (err && typeof err.status === 'number' && err.message) throw problem(err.message, err.status, err);
      throw problem(OFFLINE, 0);
    });
  }

  /* ---------- the roster ---------- */

  function list() {
    if (!asking) {
      asking = call('GET', '/api/et/portals').then(function (r) {
        var rows = r.ok && r.data && r.data.portals;
        var out = [], seen = {};
        if (Object.prototype.toString.call(rows) === '[object Array]') {
          rows.forEach(function (p) {
            var name = p && typeof p.name === 'string' ? p.name.trim() : '';
            if (p && slugShape(p.slug) && name && !own(seen, p.slug)) { seen[p.slug] = name; out.push({ slug: p.slug, name: name }); }
          });
        }
        if (!out.length) throw problem(LIST_FAILED, r.status, r.data);
        roster = out;
        names = seen;
        /* a working portal cached before its name was known (the server answered first) gets its name now */
        var uid = uidNow(), entry = uid ? readEntry(uid) : null;
        if (entry && entry.portal !== 'all' && own(names, entry.portal) && entry.name !== names[entry.portal]) writeEntry(uid, entry.portal);
        return out;
      }).then(null, function (err) {
        asking = null;   // a failed read is never kept: the next caller (Retry) asks again
        throw (err && err.message === LIST_FAILED) ? err : problem(LIST_FAILED, err && err.status);
      });
    }
    /* each caller gets its own copy, so one page changing its list cannot change another's */
    return asking.then(function (out) { return out.map(function (p) { return { slug: p.slug, name: p.name }; }); });
  }

  function nameOf(slug) {
    if (typeof slug !== 'string' || !slug) return '';
    if (own(names, slug)) return names[slug];
    var entry = readEntry(uidNow() || lastUid());
    return entry && entry.portal === slug ? entry.name : '';
  }

  function optionsHtml(current, placeholder) {
    var cur = typeof current === 'string' ? current : '';
    if (!roster) {
      if (cur) return '<option value="' + esc(cur) + '" selected>' + esc(nameOf(cur) || cur) + '</option>';
      return placeholder ? '<option value="" disabled selected>' + esc(placeholder) + '</option>' : '';
    }
    var known = own(names, cur);
    var html = !known && placeholder ? '<option value="" disabled selected>' + esc(placeholder) + '</option>' : '';
    return html + roster.map(function (p) {
      return '<option value="' + esc(p.slug) + '"' + (known && p.slug === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');
  }

  function chipHtml(opts) {
    opts = opts || {};
    ensureStyle();
    var id = typeof opts.eventId === 'string' ? opts.eventId : '';
    var aria = opts.eventName ? ' aria-label="' + esc('Set the portal of ' + opts.eventName) + '"' : '';
    return '<span class="rvp-chip"><span class="rvp-chip-text">No portal yet</span>' +
      '<button type="button" class="rvp-chip-btn" data-set-portal="' + esc(id) + '"' + aria + '>Set portal</button></span>';
  }

  /* ---------- the working portal ---------- */

  function store() { try { return window.localStorage || null; } catch (e) { return null; } }
  function lsGet(k) { try { var s = store(); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { var s = store(); if (s) s.setItem(k, v); } catch (e) { /* a private window: only the cache is lost */ } }
  function uidNow() {
    try {
      var auth = window.RevampAuth;
      var u = auth && typeof auth.currentUser === 'function' ? auth.currentUser() : null;
      return u && typeof u.uid === 'string' ? u.uid : '';
    } catch (e) { return ''; }
  }
  function lastUid() { var v = lsGet(LAST_KEY); return typeof v === 'string' ? v : ''; }
  function readEntry(uid) {
    if (!uid) return null;
    var o = null;
    try { o = JSON.parse(lsGet(CACHE_PREFIX + uid) || 'null'); } catch (e) { o = null; }
    if (!o || o.v !== 1 || !(o.portal === 'all' || slugShape(o.portal))) return null;
    /* a slug the roster no longer has is no choice at all */
    if (roster && o.portal !== 'all' && !own(names, o.portal)) return null;
    return { portal: o.portal, name: typeof o.name === 'string' ? o.name : '' };
  }
  function writeEntry(uid, v) {
    if (!uid) return;
    lsSet(CACHE_PREFIX + uid, JSON.stringify({ v: 1, portal: v, name: v === 'all' ? '' : (own(names, v) ? names[v] : '') }));
    lsSet(LAST_KEY, uid);
  }

  function cachedWorking() {
    var entry = readEntry(uidNow() || lastUid());
    return entry ? entry.portal : null;
  }

  /* the person signed in is known by now: they become the last person seen here, choice or not, so the next
     page's first paint (cachedWorking before auth.js answers) is theirs and never the person's before them */
  function seen() { var uid = uidNow(); if (uid) lsSet(LAST_KEY, uid); }

  function working() {
    return call('GET', '/api/me/working-portal').then(function (r) {
      var v = r.ok && r.data ? r.data.workingPortal : null;
      if (v === 'all' || (slugShape(v) && (!roster || own(names, v)))) {
        writeEntry(uidNow(), v);
        return v;
      }
      /* the server has no choice for this person (or could not say): this browser's for them, if it has one.
         Their own entry only: cachedWorking reads the last person's just until auth.js has said who this is */
      seen();
      return cachedWorking();
    }, function () { seen(); return cachedWorking(); });
  }

  function setWorking(v) {
    if (!(v === 'all' || (slugShape(v) && (!roster || own(names, v))))) {
      return Promise.reject(problem('Unknown portal "' + String(v).slice(0, 40) + '".', 400));
    }
    writeEntry(uidNow(), v);
    return call('PUT', '/api/me/working-portal', { workingPortal: v }).then(function (r) {
      writeEntry(uidNow(), v);   // the person is known by now, even when they were not a moment ago
      if (r.ok) return v;
      throw problem(KEPT_HERE, r.status, r.data);
    }, function (err) {
      writeEntry(uidNow(), v);
      throw problem(KEPT_HERE, err && err.status);
    });
  }

  /* ---------- the look: the page's own tokens, light and dark ---------- */

  var CSS = [
    '.rvp-overlay{ position:fixed; inset:0; z-index:95; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(20,18,12,.45); }',
    '.rvp-dialog{ width:100%; max-width:440px; max-height:calc(100vh - 32px); overflow:auto; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:16px; box-shadow:var(--shadow-lg); font-family:var(--font-body); font-size:14px; line-height:1.5; text-align:left; }',
    '.rvp-head{ padding:16px 18px 12px; border-bottom:1px solid var(--border); }',
    '.rvp-title{ margin:0; font-size:16px; font-weight:700; color:var(--text); }',
    '.rvp-sub{ margin:3px 0 0; font-size:12.5px; color:var(--text-muted); overflow-wrap:anywhere; }',
    '.rvp-body{ padding:14px 18px 16px; display:flex; flex-direction:column; gap:12px; }',
    '.rvp-intro{ margin:0; font-size:13.5px; color:var(--text); }',
    '.rvp-label{ display:block; margin-bottom:5px; font-size:12px; font-weight:700; color:var(--text-muted); }',
    '.rvp-select{ width:100%; padding:9px 11px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text); font-family:inherit; font-size:14px; }',
    '.rvp-select:focus{ outline:2px solid var(--accent); outline-offset:1px; }',
    '.rvp-notes{ display:flex; flex-direction:column; gap:8px; }',
    '.rvp-note{ margin:0; font-size:12.5px; color:var(--text-muted); }',
    '.rvp-warn{ margin:0; padding:9px 11px; border-radius:8px; font-size:12.5px; color:var(--text); background:var(--warn-soft); }',
    '.rvp-error{ padding:9px 11px; border-radius:8px; font-size:13px; color:var(--text); background:var(--accent-soft); }',
    '.rvp-load{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:13px; color:var(--text); }',
    '.rvp-foot{ padding:12px 18px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }',
    '.rvp-btn{ font-family:inherit; font-size:13px; font-weight:600; padding:8px 14px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text); cursor:pointer; }',
    '.rvp-btn:hover{ background:var(--surface-2); }',
    /* white on --accent is below AA at this size, so the primary button stands on --accent-strong */
    '.rvp-btn-primary{ background:var(--accent-strong); border-color:var(--accent-strong); color:var(--accent-contrast); }',
    '.rvp-btn-primary:hover{ background:var(--accent-strong); opacity:.92; }',
    '.rvp-btn[disabled]{ opacity:.5; cursor:default; }',
    '.rvp-btn:focus-visible, .rvp-chip-btn:focus-visible{ outline:2px solid var(--accent); outline-offset:2px; }',
    '.rvp-chip{ display:inline-flex; align-items:center; gap:4px 6px; flex-wrap:wrap; vertical-align:middle; }',
    '.rvp-chip-text{ font-size:11.5px; font-weight:700; color:var(--text-muted); background:var(--surface-2); border:1px dashed var(--border); border-radius:100px; padding:2px 9px; white-space:nowrap; }',
    '.rvp-chip-btn{ font-family:inherit; font-size:12px; font-weight:700; color:var(--accent-strong); background:none; border:none; padding:2px 4px; text-decoration:underline; cursor:pointer; white-space:nowrap; }',
    '.rvp-overlay [hidden]{ display:none !important; }'
  ].join('\n');

  function ensureStyle() {
    var doc = window.document;
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    (doc.head || doc.documentElement || doc.body).appendChild(el);
  }

  /* ---------- the Set portal window ---------- */

  var NOTE_EVENT = 'The event moves to this portal\'s list on the dashboard. Its registration forms link to this portal\'s ' +
    'privacy, cookie and terms pages, and its mailers and posts carry its name and wordmark.';
  var NOTE_DRAFT = 'The previous editions you can pick, the ETB2B bar and footer of its site, and the branding of its mailers and ' +
    'posts come from this portal.';
  var NOTE_SITE = 'Its site keeps the ETB2B bar and footer it was made with. They change to this portal\'s only if the site is ' +
    'generated again, which replaces the site.';
  var NOTE_PUBLISHED = 'Its live registration form keeps the privacy links it was published with until it is published again.';

  function fallbackSentence(status) {
    if (status === 401) return 'Your sign-in has expired. Please sign in again.';
    if (status === 403) return 'You do not have access to do that.';
    if (status === 404) return 'That event could not be found. It may have been deleted.';
    if (status >= 500) return 'The server had a problem. Please try again.';
    return 'The portal could not be set (' + status + '). Please try again.';
  }

  function openSetPortal(opts) {
    opts = opts || {};
    var doc = window.document;
    ensureStyle();
    if (openWindow) openWindow.close(false);

    var eventId = typeof opts.eventId === 'string' ? opts.eventId.trim() : '';
    var current = slugShape(opts.current) ? opts.current : '';
    var opener = opts.returnFocus || doc.activeElement || null;
    var title = current ? 'Change this event\'s portal' : 'Set this event\'s portal';
    var intro = typeof opts.intro === 'string' ? opts.intro : (eventId ? '' : 'Which portal is this event on? Everything you entered is kept.');
    var notes = '<p class="rvp-note">' + esc(eventId ? NOTE_EVENT : NOTE_DRAFT) + '</p>';
    /* only an ETB2B AI-designed site has an ET bar and footer of its own; a gallery template's site has none */
    if (eventId && opts.hasGeneratedSite) notes += '<p class="rvp-warn">' + esc(NOTE_SITE) + '</p>';
    if (eventId && opts.published) notes += '<p class="rvp-warn">' + esc(NOTE_PUBLISHED) + '</p>';

    var overlay = doc.createElement('div');
    overlay.className = 'rvp-overlay';
    overlay.innerHTML =
      '<div class="rvp-dialog" id="' + DIALOG_ID + '" role="dialog" aria-modal="true" aria-labelledby="rvp-title" aria-describedby="rvp-notes">' +
        '<div class="rvp-head"><h2 class="rvp-title" id="rvp-title">' + esc(title) + '</h2>' +
          (opts.eventName ? '<p class="rvp-sub">' + esc(opts.eventName) + '</p>' : '') + '</div>' +
        '<div class="rvp-body">' +
          (intro ? '<p class="rvp-intro">' + esc(intro) + '</p>' : '') +
          '<div><label class="rvp-label" for="rvp-select">Portal</label>' +
            '<select class="rvp-select" id="rvp-select" disabled><option value="" disabled selected>Loading portals…</option></select></div>' +
          '<div class="rvp-load" id="rvp-load" hidden><span>' + esc(LIST_FAILED) + '</span>' +
            '<button type="button" class="rvp-btn" id="rvp-retry">Retry</button></div>' +
          '<div class="rvp-notes" id="rvp-notes">' + notes + '</div>' +
          '<div class="rvp-error" id="rvp-error" role="alert" hidden></div>' +
        '</div>' +
        '<div class="rvp-foot">' +
          '<button type="button" class="rvp-btn" id="rvp-cancel">Cancel</button>' +
          '<button type="button" class="rvp-btn" id="rvp-reload" hidden>Reload</button>' +
          '<button type="button" class="rvp-btn rvp-btn-primary" id="rvp-save" disabled>Set portal</button>' +
        '</div>' +
      '</div>';
    (doc.body || doc.documentElement).appendChild(overlay);

    var box = overlay.querySelector('#' + DIALOG_ID);
    var sel = overlay.querySelector('#rvp-select');
    var load = overlay.querySelector('#rvp-load');
    var retry = overlay.querySelector('#rvp-retry');
    var error = overlay.querySelector('#rvp-error');
    var cancel = overlay.querySelector('#rvp-cancel');
    var reload = overlay.querySelector('#rvp-reload');
    var save = overlay.querySelector('#rvp-save');
    var closed = false, busy = false;

    function showError(text) { error.textContent = text; error.hidden = false; }
    function hideError() { error.textContent = ''; error.hidden = true; }

    function close(giveFocusBack) {
      if (closed) return;
      closed = true;
      if (openWindow && openWindow.box === box) openWindow = null;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (giveFocusBack !== false && opener && typeof opener.focus === 'function' && opener.isConnected !== false) {
        try { opener.focus(); } catch (e) { /* it has gone from the page */ }
      }
    }
    /* the person's own ways out (Cancel, Escape, the dimmed page) wait while a change is being saved: a window
       closed then would leave the page showing no portal for an event the server has just given one, and a
       second try would be refused as if somebody else had set it */
    function dismiss() { if (!busy) close(); }
    openWindow = { close: close, box: box };

    function shown(el) {
      for (var n = el; n && n !== overlay; n = n.parentNode) if (n.hidden) return false;
      return true;
    }
    function focusables() {
      return [].slice.call(box.querySelectorAll('select, button')).filter(function (el) { return !el.disabled && shown(el); });
    }
    function inside(el) { for (var n = el; n; n = n.parentNode) if (n === box) return true; return false; }

    function fill() {
      sel.innerHTML = optionsHtml(current, 'Choose a portal');
      sel.disabled = false;
      save.disabled = false;
      load.hidden = true;
      /* focus moves to the list once it is there, unless the person has already gone somewhere else in the window */
      var at = doc.activeElement;
      if (!inside(at) || at === cancel) sel.focus();
    }
    function ask() {
      /* Retry hides itself: focus waits on Cancel rather than fall out of the window */
      if (doc.activeElement === retry) cancel.focus();
      load.hidden = true;
      list().then(function () { if (!closed) fill(); }, function () {
        if (closed) return;
        sel.disabled = true;
        save.disabled = true;
        load.hidden = false;
        if (!inside(doc.activeElement) || doc.activeElement === cancel) retry.focus();
      });
    }

    function done(slug, name) {
      close();
      if (typeof opts.onDone === 'function') opts.onDone(slug, name);
    }
    function submit() {
      if (busy) return;
      var slug = sel.value;
      if (!slug || !own(names, slug)) { showError('Choose a portal.'); sel.focus(); return; }
      if (slug === current) { close(); return; }   // nothing changed
      var name = names[slug];
      if (!eventId) { done(slug, name); return; }   // Create Event's draft: only the choice is reported
      busy = true;
      hideError();
      save.disabled = true;
      cancel.disabled = true;   // see dismiss: the window stays until the server has answered
      save.textContent = 'Saving…';
      function ready() {
        save.disabled = false;
        cancel.disabled = false;
        save.textContent = 'Set portal';
      }
      call('PATCH', '/api/event', { eventId: eventId, portal: slug, ifPortal: current }).then(function (r) {
        busy = false;
        /* what the server did is always told to the page, even when another window has replaced this one
           meanwhile (openSetPortal closes the open one): done() then only reports, as this one is gone */
        if (r.ok) { done(slug, name); return; }
        var d = r.data || {};
        var conflict = r.status === 409 && d.code === 'portal-changed';
        function tellConflict() {
          if (typeof opts.onConflict === 'function') opts.onConflict(typeof d.current === 'string' ? d.current : '', typeof d.currentName === 'string' ? d.currentName : '');
        }
        if (closed) { if (conflict) tellConflict(); return; }
        ready();
        if (conflict) {
          /* somebody else set it meanwhile: say so, and offer the page as it now is rather than a blind second try */
          showError(typeof d.error === 'string' && d.error ? d.error : 'This event\'s portal was changed meanwhile. Reload to see it.');
          save.hidden = true;
          reload.hidden = false;
          reload.focus();
          tellConflict();
          return;
        }
        showError(typeof d.error === 'string' && d.error ? d.error : fallbackSentence(r.status));
      }, function (err) {
        busy = false;
        if (closed) return;   // nothing was changed, so there is nothing to tell the page
        ready();
        showError((err && err.message) || OFFLINE);
      });
    }

    save.addEventListener('click', submit);
    cancel.addEventListener('click', dismiss);
    retry.addEventListener('click', ask);
    reload.addEventListener('click', function () { try { window.location.reload(); } catch (e) { /* nothing to do */ } });
    sel.addEventListener('change', hideError);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        /* taken here even while saving, so the page underneath does not act on it either */
        e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        dismiss();
        return;
      }
      if (e.key !== 'Tab') return;
      /* focus stays in the window while it is open */
      var f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1], at = doc.activeElement;
      if (e.shiftKey && (at === first || !inside(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !inside(at))) { e.preventDefault(); first.focus(); }
    });

    if (roster) fill();
    else { cancel.focus(); ask(); }
  }

  window.RevampPortals = {
    list: list,
    nameOf: nameOf,
    optionsHtml: optionsHtml,
    chipHtml: chipHtml,
    openSetPortal: openSetPortal,
    working: working,
    cachedWorking: cachedWorking,
    setWorking: setWorking
  };
})();
