/* Oneworld 2.0 — "Share preview": a link to an event's site, as last saved, for people with no ET account
   (clients, sponsors, speakers).

   Loaded by the event console (edit-event.html) and the site editor (custom_editor.html). Each page carries one
   button, [data-share-preview], beside Preview, and this file. Nothing else on either page changes: the button
   copies Preview's own hidden / disabled state, so it appears when the console has an event and wakes up once the
   editor's canvas has mounted, without touching either page's start-up code.

   The server half is functions/lib/share-preview.js:
     POST /api/event/share-preview        { eventId, label?, origin }  -> { url, link, warnings }
     GET  /api/event/share-preview?eventId=                           -> { links, maxActive, days }
     POST /api/event/share-preview/stop   { eventId, id }             -> { ok, id, changed }
   A link is /s/<token>. The server keeps only a fingerprint (hash) of the token, so the create answer is the one
   and only time the full link exists anywhere. This file therefore holds it in memory while the dialog is open,
   never in browser storage, and lets it go when the dialog closes.

   ES5 on purpose (var, function, promises): it loads as a plain script on pages that are not bundled.
   window.RevampSharePreview = { open(), _test: { eventIdFrom, untilText, whenText, errorText, CSS } }. */
(function () {
  'use strict';

  if (window.RevampSharePreview) return;   // a second copy of the script must not wire the button twice

  var API = '/api/event/share-preview';
  var LABEL_MAX = 60;
  var COPIED_MS = 2000;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var NOT_SAVED = 'Save the site first: a shared link shows the site as last saved.';
  /* The console has no Save of its own, so it says where saving happens. */
  var NOT_SAVED_CONSOLE = 'Save the site in the site editor first: a shared link shows the site as last saved.';

  /* ============================================================
     PURE HELPERS (tested in node through _test)
     ============================================================ */

  function decodePart(s) {
    try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return ''; }
  }

  /* The console's address carries ?event=, the editor's ?slug= (after creating) or ?event= — the same event
     either way. */
  function eventIdFrom(search) {
    var found = { event: '', slug: '' };
    String(search || '').replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var at = pair.indexOf('=');
      var key = decodePart(at === -1 ? pair : pair.slice(0, at));
      if ((key !== 'event' && key !== 'slug') || found[key]) return;
      found[key] = decodePart(at === -1 ? '' : pair.slice(at + 1)).trim();
    });
    return found.event || found.slug;
  }

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function clockText(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'am' : 'pm');
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function dayFrom(d, offset) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset); }

  /* "today, 4:20 pm", "tomorrow, 9:05 am", "Tue, 10 Nov, 4:20 pm" — in the viewer's own clock, which for this
     team is IST. A link lasts a week, so the year is named only when it is not this year. '' for a bad date. */
  function whenText(iso, now, withWeekday) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    var n = now === undefined || now === null ? new Date() : new Date(now);
    if (isNaN(n.getTime())) n = new Date();
    var date = sameDay(d, n) ? 'today'
      : sameDay(d, dayFrom(n, 1)) ? 'tomorrow'
      : sameDay(d, dayFrom(n, -1)) ? 'yesterday'
      : (withWeekday ? WEEKDAYS[d.getDay()] + ', ' : '') + d.getDate() + ' ' + MONTHS[d.getMonth()] +
        (d.getFullYear() !== n.getFullYear() ? ' ' + d.getFullYear() : '');
    return date + ', ' + clockText(d);
  }
  function untilText(iso, now) {
    var when = whenText(iso, now, true);
    return when ? 'Works until ' + when + '.' : '';
  }

  /* The sentence to show for a failed call. The server's own sentence wins: it knows why (a rate limit says
     how long to wait). Without one — a proxy's error page, no answer at all — a plain sentence, never a raw
     status line. where: 'console' | 'editor'. */
  function errorText(status, body, where) {
    var code = body && typeof body.code === 'string' ? body.code : '';
    var said = body && typeof body.error === 'string' ? body.error.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (code === 'site-not-saved') return where === 'console' ? NOT_SAVED_CONSOLE : (said || NOT_SAVED);
    if (said) return said;
    if (code === 'too-many-links') return 'This event already shares as many links as it can. Stop one you no longer need, then make a new one.';
    if (status === 429 || code === 'rate-limited') return 'That is a lot of links in a short time. Wait a few minutes and try again.';
    if (!status) return 'Could not reach the server. Check your connection and try again.';
    if (status === 401) return 'Your sign-in has expired. Please sign in again.';
    if (status === 403) return 'You do not have access to do that.';
    if (status === 404) return 'That could not be found. The event or the link may have been deleted.';
    if (status === 409) return 'That conflicts with a newer change. Reload and try again.';
    if (status === 413) return 'That is too large to send.';
    if (status === 503) return 'Sharing is not available right now. Please try again in a moment.';
    if (status >= 500) return 'The server had a problem. Please try again.';
    return 'That could not be done (' + status + '). Please try again.';
  }

  function shortId(last4) { return '…' + String(last4 || '').slice(-4); }
  function trimLabel(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX); }
  function count(n, fallback) { n = Number(n); return n > 0 && n < 1000 ? Math.floor(n) : fallback; }

  /* ============================================================
     STYLES — the console's own tokens only, so the light / dark switch flips the dialog with the page
     ============================================================ */
  var CSS = [
    /* on a narrow screen the top bar runs out of room: the button keeps only its icon (aria-label keeps its name) */
    '@media (max-width:720px){.topbar [data-share-preview]>span{display:none}.topbar [data-share-preview]{padding-left:10px;padding-right:10px}}',
    /* the site editor's bar is already full (mode switch, page switch, site state, Save, Publish changes) and does
       not shrink: with the label the event title is squeezed to nothing and, on a site with internal pages, Publish
       changes and the account are pushed past the window edge. So there the button is icon-only (37px instead of
       142px) up to a 1440px window: measured on a site with internal pages, the label at 1367px would still leave
       the title only 80px, while from 1441px the title keeps about 150px, what the editor itself leaves it at 1280px.
       It is keyed to the editor's mode switch, which only the editor's bar has, so the console keeps its label. */
    '@media (max-width:1440px){#ed-mode-toggle ~ [data-share-preview]>span{display:none}#ed-mode-toggle ~ [data-share-preview]{padding-left:10px;padding-right:10px}}',
    /* under the editor's own dialogs (90) and both pages' messages (99, 100), so a save conflict or a toast
       raised from here still shows on top */
    '.rvsp-scrim{position:fixed;inset:0;z-index:85;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(20,14,13,.55)}',
    '.rvsp-scrim [hidden]{display:none!important}',
    '.rvsp-box{display:flex;flex-direction:column;width:min(560px,calc(100vw - 32px));max-height:min(86vh,780px);background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-lg);overflow:hidden;font-family:var(--font-body,inherit);font-size:14px;line-height:1.5;text-align:left}',
    '.rvsp-box:focus{outline:0}',
    '.rvsp-box :focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.rvsp-head{display:flex;align-items:center;gap:12px;padding:12px 12px 12px 20px;border-bottom:1px solid var(--border)}',
    '.rvsp-head h2{flex:1;min-width:0;margin:0;font-size:16.5px;font-weight:700;color:var(--text)}',
    '.rvsp-x{display:inline-grid;place-items:center;width:40px;height:40px;flex-shrink:0;border:0;border-radius:9px;background:transparent;color:var(--text-muted);cursor:pointer}',
    '.rvsp-x:hover{background:var(--surface-2);color:var(--text)}',
    '.rvsp-body{display:flex;flex-direction:column;gap:16px;padding:16px 20px 20px;overflow-y:auto;overscroll-behavior:contain}',
    '.rvsp-body p{margin:0}',
    '.rvsp-intro{font-size:13px;color:var(--text-muted)}',
    '.rvsp-box .btn{min-height:40px}',
    '.rvsp-box a.btn{text-decoration:none}',
    '.rvsp-note{display:flex;align-items:center;flex-wrap:wrap;gap:10px 12px;padding:10px 12px;border-radius:10px;background:var(--warn-soft);color:var(--text);font-size:13px}',
    '.rvsp-note > svg{flex-shrink:0;color:var(--warn)}',
    '.rvsp-note > p{flex:1 1 200px;min-width:0}',
    '.rvsp-field{display:flex;flex-direction:column;gap:6px}',
    '.rvsp-field > label{font-size:12.5px;font-weight:700;color:var(--text)}',
    '.rvsp-hint{font-size:12px;color:var(--text-muted)}',
    '.rvsp-row{display:flex;gap:8px;align-items:stretch}',
    '.rvsp-input{flex:1;min-width:0;min-height:40px;padding:0 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font:inherit;font-size:13.5px}',
    '.rvsp-input:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}',
    '.rvsp-input::placeholder{color:var(--text-muted);opacity:.8}',
    '.rvsp-url{font-family:var(--font-mono,monospace);font-size:12.5px;background:var(--surface-2)}',
    '.rvsp-status:empty{display:none}',
    '.rvsp-status{font-size:13px;font-weight:600;color:var(--text)}',
    /* a confirmation is plain text: --ok on white is too faint for small type; the words carry it */
    '.rvsp-status.is-ok{color:var(--text)}',
    /* an error is text on a tinted band rather than red text: --accent on white is too faint for small type */
    '.rvsp-status.is-error{padding:9px 12px;border-radius:9px;border-left:3px solid var(--accent);background:var(--accent-soft);font-weight:600}',
    '.rvsp-made{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2)}',
    '.rvsp-made .rvsp-url{background:var(--surface)}',
    '.rvsp-made-head{display:flex;align-items:center;gap:8px;font-weight:700}',
    '.rvsp-made-head > svg{flex-shrink:0;color:var(--ok)}',
    '.rvsp-made-head > span{min-width:0;overflow-wrap:anywhere}',
    '.rvsp-small{font-size:12.5px;color:var(--text-muted)}',
    '.rvsp-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.rvsp-acts .grow{flex:1}',
    '.rvsp-ask{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;width:100%;padding:10px 12px;border-radius:9px;background:var(--accent-soft);color:var(--text)}',
    '.rvsp-ask > p{flex:1 1 220px;min-width:0;font-size:13px;font-weight:600}',
    '.rvsp-links h3{margin:0 0 8px;font-size:13.5px;font-weight:700;color:var(--text)}',
    '.rvsp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
    '.rvsp-item{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}',
    '.rvsp-item-main{flex:1 1 220px;min-width:0}',
    '.rvsp-item-main > p{overflow-wrap:anywhere}',
    '.rvsp-id{font-family:var(--font-mono,monospace);font-weight:600}',
    '.rvsp-new{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;background:var(--accent-soft);color:var(--text);font-size:11px;font-weight:700;vertical-align:1px}',
    /* below 720px the dialog is a sheet from the bottom edge, the way phones show one */
    '@media (max-width:720px){.rvsp-scrim{align-items:flex-end;padding:0}.rvsp-box{width:100%;max-height:92vh;border-radius:16px 16px 0 0;border-bottom:0}.rvsp-body{padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))}}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('rvsp-css')) return;
    var style = document.createElement('style');
    style.setAttribute('id', 'rvsp-css');
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ============================================================
     DOM HELPERS — everything is built with createElement / textContent. Labels and email addresses are
     people's own words, so none of it ever goes through HTML parsing.
     ============================================================ */
  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') node.textContent = String(v);
        else if (k === 'className') node.className = v;
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function icon(paths, size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size || 16));
    svg.setAttribute('height', String(size || 16));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }
  var IC_CLOSE = ['M18 6L6 18', 'M6 6l12 12'];
  var IC_CHECK = ['M20 6L9 17l-5-5'];
  var IC_WARN = ['M12 3l9.5 17h-19z', 'M12 10v4', 'M12 17.5v.01'];
  function button(label, cls, onClick, attrs) {
    var b = el('button', attrs, [label]);
    b.setAttribute('type', 'button');
    b.className = cls;
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  /* ============================================================
     THE SERVER
     ============================================================ */
  function where() { return window.RevampTemplateUI ? 'editor' : 'console'; }

  function failure(status, body) {
    var err = new Error(errorText(status, body, where()));
    err.status = status || 0;
    err.code = body && typeof body.code === 'string' ? body.code : '';
    return err;
  }
  function readJson(res) {
    return Promise.resolve().then(function () { return res.json(); })
      .then(function (data) { return data && typeof data === 'object' ? data : {}; }, function () { return {}; });
  }
  /* RevampCore.authedFetch owns the sign-in (a fresh token, one retry, then the sign-in page). An HTTP error
     still resolves there, so it is turned into a sentence here. */
  function request(method, url, body) {
    var core = window.RevampCore;
    if (!core || typeof core.authedFetch !== 'function') return Promise.reject(failure(0, null));
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
    var sent;
    try { sent = Promise.resolve(core.authedFetch(url, opts)); } catch (e) { sent = Promise.reject(e); }
    return sent.then(function (res) {
      return readJson(res).then(function (data) {
        if (!res || !res.ok) throw failure(res ? res.status : 0, data);
        return data;
      });
    }, function (err) {
      /* the sign-in layer's own refusal is already a sentence; anything else means no answer arrived */
      if (err && typeof err.status === 'number' && err.status > 0 && err.message) throw err;
      throw failure(0, null);
    });
  }

  function absoluteUrl(url) {
    url = String(url || '');
    if (/^https?:\/\/[^\s]+$/i.test(url)) return url;
    if (url.charAt(0) === '/' && url.charAt(1) !== '/') return String(window.location.origin || '') + url;
    return '';
  }
  function cleanLink(l) {
    if (!l || typeof l.id !== 'string' || !l.id) return null;
    return {
      id: l.id, last4: String(l.last4 || ''), label: typeof l.label === 'string' ? l.label : '',
      createdBy: typeof l.createdBy === 'string' ? l.createdBy : '', createdAt: l.createdAt || '', expiresAt: l.expiresAt || ''
    };
  }
  function myEmail() {
    try {
      var auth = window.RevampAuth, user = auth && typeof auth.currentUser === 'function' ? auth.currentUser() : null;
      return user && user.email ? String(user.email).toLowerCase() : '';
    } catch (e) { return ''; }
  }

  /* The editor knows whether what is on the canvas has been saved; the console does not (it has no canvas). */
  function editorSiteState() {
    var T = window.RevampTemplateUI;
    if (!T || typeof T.siteState !== 'function') return null;
    var s;
    try { s = T.siteState(); } catch (e) { return null; }
    if (!s || !s.info) return null;   // still being read from the server: say nothing rather than guess
    var v = Number(s.info.savedVersion) || 0;
    if (!v) return { kind: 'never', version: 0 };
    if (s.dirty) return { kind: 'dirty', version: v };
    return null;
  }

  /* ============================================================
     THE DIALOG
     ============================================================ */
  var S = null;   // the open dialog's state; null when it is closed

  function open(opener, eventId) {
    if (S) { S.box.focus(); return S; }
    eventId = eventId || eventIdFrom(window.location.search);
    if (!eventId) return null;
    injectCss();
    var s = S = {
      open: true, eventId: eventId, opener: opener || null,
      links: null, listState: 'loading', listError: '', maxActive: 20, days: 7,
      made: null, ask: null, stopping: {}, busy: { create: false, save: false }, copiedTimer: null,
      els: {}, downOnScrim: false
    };
    build(s);
    document.body.appendChild(s.scrim);
    document.addEventListener('keydown', onDocKey, true);
    renderAll(s);
    firstField(s).focus();
    loadList(s);
    return s;
  }

  function close() {
    var s = S;
    if (!s) return;
    s.open = false;
    S = null;
    clearTimeout(s.copiedTimer);
    document.removeEventListener('keydown', onDocKey, true);
    /* the link exists only here: forget it with the dialog */
    s.made = null;
    if (s.scrim.parentNode) s.scrim.parentNode.removeChild(s.scrim);
    var back = s.opener;
    if (back && typeof back.focus === 'function' && document.body.contains(back) && !back.hidden && !back.disabled) back.focus();
  }

  function build(s) {
    var E = s.els;
    E.title = el('h2', { id: 'rvsp-title', text: 'Share a preview' });
    E.close = button('', 'rvsp-x', close, { 'aria-label': 'Close' });
    E.close.appendChild(icon(IC_CLOSE, 18));
    E.intro = el('p', { id: 'rvsp-intro', className: 'rvsp-intro' });
    E.note = el('div', { className: 'rvsp-note', hidden: true });

    E.label = el('input', {
      id: 'rvsp-label', className: 'rvsp-input', type: 'text', maxlength: LABEL_MAX, autocomplete: 'off',
      placeholder: 'e.g. Infosys sponsor team', 'aria-describedby': 'rvsp-label-hint'
    });
    E.label.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); create(s); }
    });
    E.create = button('Create link', 'btn btn-primary', function () { create(s); });
    E.limit = el('p', { className: 'rvsp-hint', hidden: true });
    var field = el('div', { className: 'rvsp-field' }, [
      el('label', { 'for': 'rvsp-label', text: 'Who is it for? (optional)' }),
      el('div', { className: 'rvsp-row' }, [E.label, E.create]),
      el('p', { id: 'rvsp-label-hint', className: 'rvsp-hint', text: 'Shown to your team in the list below and in History, so links can be told apart. The people you send it to don’t see it.' }),
      E.limit
    ]);

    E.status = el('p', { className: 'rvsp-status', role: 'status', 'aria-live': 'polite' });
    E.made = el('section', { className: 'rvsp-made', 'aria-label': 'The new link', hidden: true });
    E.listHead = el('h3', { id: 'rvsp-links-h' });
    E.listBody = el('div');
    var links = el('section', { className: 'rvsp-links', 'aria-labelledby': 'rvsp-links-h' }, [E.listHead, E.listBody]);

    s.box = el('div', {
      className: 'rvsp-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rvsp-title',
      'aria-describedby': 'rvsp-intro', tabindex: '-1'
    }, [
      el('div', { className: 'rvsp-head' }, [E.title, E.close]),
      el('div', { className: 'rvsp-body' }, [E.intro, E.note, field, E.status, E.made, links])
    ]);
    /* typing here must not reach the page's own shortcuts (the editor's Ctrl+Z would undo the canvas) */
    s.box.addEventListener('keydown', function (e) { e.stopPropagation(); });

    s.scrim = el('div', { className: 'rvsp-scrim' }, [s.box]);
    /* only a press that starts and ends on the backdrop closes — selecting text in a field and letting go
       outside must not. Not while a new link is on screen: it cannot be shown again once the dialog is gone. */
    s.scrim.addEventListener('mousedown', function (e) { s.downOnScrim = e.target === s.scrim; });
    s.scrim.addEventListener('click', function (e) {
      var fromBackdrop = s.downOnScrim && e.target === s.scrim;
      s.downOnScrim = false;
      if (fromBackdrop && !(s.made && s.made.url)) close();
    });
  }

  function renderAll(s) {
    s.els.intro.textContent = 'Anyone with this link can see the site as last saved — no sign-in needed. Forms don’t send, and search engines are told to stay away. The link stops working after ' +
      s.days + ' days, or as soon as you stop sharing it.';
    renderNote(s);
    renderCreate(s);
    renderMade(s);
    renderList(s);
  }

  function setStatus(s, text, kind) {
    s.els.status.textContent = text || '';
    s.els.status.className = 'rvsp-status' + (text && kind ? ' is-' + kind : '');
  }

  /* ---------- the editor's unsaved changes ---------- */
  function renderNote(s) {
    var E = s.els, st = editorSiteState();
    clear(E.note);
    E.save = null;
    E.note.hidden = !st;
    if (!st) return;
    E.note.appendChild(icon(IC_WARN, 18));
    E.note.appendChild(el('p', {
      text: st.kind === 'never'
        ? 'This site has not been saved yet. Save it first: a shared link shows the site as last saved.'
        : 'You have unsaved changes. The link shows version ' + st.version + ', the last one saved.'
    }));
    E.save = button(s.busy.save ? 'Saving…' : 'Save now', 'btn btn-secondary', function () { saveNow(s); });
    E.save.disabled = s.busy.save;
    E.note.appendChild(E.save);
  }

  function saveNow(s) {
    var T = window.RevampTemplateUI;
    if (s.busy.save || !T || typeof T.save !== 'function') return;
    s.busy.save = true;
    renderNote(s);
    setStatus(s, '', '');
    var saving;
    try { saving = Promise.resolve(T.save()); } catch (e) { saving = Promise.reject(e); }
    saving.then(function (out) {
      if (!s.open) return;
      s.busy.save = false;
      renderNote(s);
      renderCreate(s);
      if (!editorSiteState()) {
        var v = out && out.version;
        setStatus(s, 'Saved' + (v ? ' as version ' + v : '') + '. Shared links show it now.', 'ok');
        firstField(s).focus();
      } else if (s.els.save) {
        s.els.save.focus();
      }
    }, function () {
      /* the editor has already said why it could not save, in its own message */
      if (!s.open) return;
      s.busy.save = false;
      renderNote(s);
      if (s.els.save) s.els.save.focus();
    });
  }

  /* ---------- Create link ---------- */
  function atLimit(s) { return !!(s.links && s.links.length >= s.maxActive); }

  function renderCreate(s) {
    var E = s.els, st = editorSiteState(), full = atLimit(s);
    E.create.textContent = s.busy.create ? 'Creating…' : 'Create link';
    E.create.disabled = s.busy.create || full || !!(st && st.kind === 'never');
    E.create.setAttribute('aria-busy', s.busy.create ? 'true' : 'false');
    E.limit.hidden = !full;
    E.limit.textContent = full ? 'This event already shares ' + s.links.length + ' links, the most it can at once. Stop one below to make another.' : '';
  }

  function create(s) {
    if (!s.open || s.busy.create || s.els.create.disabled) return;
    var label = trimLabel(s.els.label.value);
    s.busy.create = true;
    s.ask = null;
    renderCreate(s);
    setStatus(s, '', '');
    var body = { eventId: s.eventId, origin: String(window.location.origin || '') };
    if (label) body.label = label;
    request('POST', API, body).then(function (out) {
      if (!s.open) return;
      var link = cleanLink(out && out.link), url = absoluteUrl(out && out.url);
      if (!link || !url) throw failure(502, null);
      s.busy.create = false;
      clearTimeout(s.copiedTimer);
      s.made = {
        url: url, link: link,
        warnings: (out.warnings || []).filter(function (w) { return w && typeof w.message === 'string' && w.message; })
      };
      s.els.label.value = '';
      if (s.links) {
        s.links = s.links.filter(function (l) { return l.id !== link.id; });
        s.links.unshift(link);
      }
      renderCreate(s);
      renderMade(s);
      renderList(s);
      setStatus(s, 'Link ' + shortId(link.last4) + ' is ready. Copy it now.', 'ok');
      if (s.els.copy) s.els.copy.focus();
      if (!s.links && s.listState !== 'loading') loadList(s);
    }).then(null, function (err) {
      if (!s.open) return;
      s.busy.create = false;
      renderCreate(s);
      setStatus(s, err && err.message ? err.message : errorText(0, null, where()), 'error');
      /* the list may be out of date: someone else may have made links meanwhile */
      if (err && err.code === 'too-many-links') loadList(s);
      firstField(s).focus();
    });
  }

  /* ---------- the link just made ---------- */
  function renderMade(s) {
    var E = s.els, made = s.made;
    clear(E.made);
    E.copy = null;
    E.made.hidden = !made;
    if (!made) return;
    var link = made.link;
    E.made.appendChild(el('p', { className: 'rvsp-made-head' }, [
      icon(IC_CHECK, 18),
      el('span', { text: 'Link ' + shortId(link.last4) + (link.label ? ' for ' + link.label : '') + ' is ready' })
    ]));
    var input = el('input', {
      className: 'rvsp-input rvsp-url', type: 'text', readonly: true, spellcheck: 'false', autocomplete: 'off',
      'aria-label': 'The preview link'
    });
    input.value = made.url;
    input.addEventListener('focus', function () { try { input.select(); } catch (e) { /* nothing to select */ } });
    E.copy = button('Copy', 'btn btn-primary', function () { copyLink(s, input); });
    E.made.appendChild(el('div', { className: 'rvsp-row' }, [input, E.copy]));
    E.made.appendChild(el('p', { text: (untilText(link.expiresAt) ? untilText(link.expiresAt) + ' ' : '') + 'Later saves show up on this link too.' }));
    E.made.appendChild(el('p', { className: 'rvsp-small', text: 'Copy it now — ETB2B EventSphere keeps only a fingerprint of this link, so it can’t be shown again.' }));
    made.warnings.forEach(function (w) {
      E.made.appendChild(el('div', { className: 'rvsp-note' }, [icon(IC_WARN, 18), el('p', { text: w.message })]));
    });
    if (asking(s, link.id, 'made')) {
      E.made.appendChild(askBox(s, link));
    } else {
      var openIt = el('a', { className: 'btn btn-secondary', href: made.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open it' });
      var stopIt = button('Stop sharing', 'btn btn-secondary', function () { askStop(s, link.id, 'made'); }, { 'data-rvsp-stop': link.id });
      stopIt.disabled = !!s.stopping[link.id];
      E.made.appendChild(el('div', { className: 'rvsp-acts' }, [openIt, el('span', { className: 'grow' }), stopIt]));
    }
  }

  /* Copy: the clipboard API, else the old select-and-copy, else ask the person to copy it themselves. */
  function copyLink(s, input) {
    var url = s.made && s.made.url;
    if (!url) return;
    var clip = window.navigator && window.navigator.clipboard;
    var tried;
    try {
      tried = clip && typeof clip.writeText === 'function'
        ? Promise.resolve(clip.writeText(url)).then(function () { return true; }, function () { return false; })
        : Promise.resolve(false);
    } catch (e) { tried = Promise.resolve(false); }
    tried.then(function (ok) {
      if (ok) return true;
      try {
        input.focus();
        input.select();
        return !!(typeof document.execCommand === 'function' && document.execCommand('copy'));
      } catch (e) { return false; }
    }).then(function (ok) {
      if (!s.open || !s.els.copy) return;
      if (!ok) {
        try { input.focus(); input.select(); } catch (e) { /* nothing to select */ }
        setStatus(s, 'Select the link and copy it.', 'error');
        return;
      }
      var copyBtn = s.els.copy;
      copyBtn.textContent = 'Copied';
      setStatus(s, 'Link copied.', 'ok');
      clearTimeout(s.copiedTimer);
      s.copiedTimer = setTimeout(function () { if (s.open && s.els.copy === copyBtn) copyBtn.textContent = 'Copy'; }, COPIED_MS);
    });
  }

  /* ---------- Stop sharing ---------- */
  function askBox(s, link) {
    var busy = !!s.stopping[link.id];
    var keep = button('Keep it', 'btn btn-secondary', function () { var at = s.ask; s.ask = null; rerenderFor(s, link.id, at && at.where, 'stop'); });
    var yes = button(busy ? 'Stopping…' : 'Stop sharing', 'btn btn-primary', function () { stop(s, link); });
    keep.disabled = yes.disabled = busy;
    keep.setAttribute('data-rvsp-keep', '');
    return el('div', { className: 'rvsp-ask', role: 'group', 'aria-label': 'Stop link ' + shortId(link.last4) }, [
      el('p', { text: 'Stop this link? Anyone who opens it will see that it has expired.' }), keep, yes
    ]);
  }

  /* "Stop this link?" is asked in the part where Stop sharing was pressed: the new link's panel ('made') or
     its row in the list ('list'). */
  function asking(s, id, part) { return !!(s.ask && s.ask.id === id && s.ask.where === part); }
  function askStop(s, id, part) {
    s.ask = { id: id, where: part };
    rerenderFor(s, id, part, 'keep');
  }

  /* Draws both parts again, then puts focus back where the person was working: on Keep it while asking, on
     that link's Stop sharing after an answer. */
  function rerenderFor(s, id, part, focusOn) {
    renderMade(s);
    renderList(s);
    var scope = part === 'made' && s.made ? s.els.made : findRow(s, id);
    var target = null;
    if (scope && focusOn === 'keep') target = findIn(scope, function (n) { return n.hasAttribute && n.hasAttribute('data-rvsp-keep'); });
    if (scope && focusOn === 'stop') target = findIn(scope, function (n) { return n.getAttribute && n.getAttribute('data-rvsp-stop') === id; });
    (target || firstField(s)).focus();
  }
  /* where focus goes when what had it is gone: the label box, or Close when making a link is not possible now */
  function firstField(s) { return s.els.create.disabled ? s.els.close : s.els.label; }

  function stop(s, link) {
    if (!s.open || s.stopping[link.id]) return;
    s.stopping[link.id] = true;
    renderMade(s);
    renderList(s);
    /* the pressed button was just drawn again (as Stopping…, disabled): keep keyboard focus in the dialog */
    s.box.focus();
    request('POST', API + '/stop', { eventId: s.eventId, id: link.id }).then(function (out) {
      if (!s.open) return;
      delete s.stopping[link.id];
      s.ask = null;
      var next = nextRowId(s, link.id);
      if (s.links) s.links = s.links.filter(function (l) { return l.id !== link.id; });
      /* the stopped link's address is no use to anyone now: let it go */
      if (s.made && s.made.link.id === link.id) s.made = null;
      renderAll(s);
      setStatus(s, 'Link ' + shortId(link.last4) + (out && out.changed === false ? ' had already stopped.' : ' stopped.'), 'ok');
      var row = next ? findRow(s, next) : null;
      var nextBtn = row ? findIn(row, function (n) { return n.getAttribute && n.getAttribute('data-rvsp-stop') === next; }) : null;
      (nextBtn || firstField(s)).focus();
    }, function (err) {
      if (!s.open) return;
      delete s.stopping[link.id];
      /* a 404 means it is gone already (or the event is): nothing is left to ask about */
      var gone = !!(err && err.status === 404);
      if (gone && s.ask && s.ask.id === link.id) s.ask = null;
      /* otherwise the question is still open, so the person can try again or keep the link */
      if (s.ask && s.ask.id === link.id) rerenderFor(s, link.id, s.ask.where, 'keep');
      else { renderMade(s); renderList(s); firstField(s).focus(); }
      setStatus(s, err && err.message ? err.message : errorText(0, null, where()), 'error');
      if (gone) loadList(s);   // show the list as it really is now
    });
  }

  /* ---------- Links that work now ---------- */
  function loadList(s) {
    s.listState = 'loading';
    redraw(s, function () { renderList(s); });
    request('GET', API + '?eventId=' + encodeURIComponent(s.eventId)).then(function (out) {
      if (!s.open) return;
      var links = (out && out.links || []).map(cleanLink).filter(Boolean);
      links.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      /* a link made while this list was on its way is still a link that works */
      if (s.made && !links.some(function (l) { return l.id === s.made.link.id; })) links.unshift(s.made.link);
      s.links = links;
      s.maxActive = count(out && out.maxActive, 20);
      s.days = count(out && out.days, 7);
      s.listState = 'ready';
      s.listError = '';
      redraw(s, function () { renderAll(s); });
    }, function (err) {
      if (!s.open) return;
      s.listState = 'error';
      s.listError = err && err.message ? err.message : errorText(0, null, where());
      redraw(s, function () { renderList(s); });
    });
  }

  /* Drawing a part again replaces its buttons. If one of them had focus, it goes back to the same link's Stop
     sharing, else to the label box, so a keyboard user is never dropped onto the page behind the dialog. */
  function redraw(s, draw) {
    var was = document.activeElement;
    var had = !!(was && s.box.contains(was));
    var stopId = had && was.getAttribute ? was.getAttribute('data-rvsp-stop') : null;
    draw();
    var now = document.activeElement;
    if (!had || !s.open || (now && now !== document.body && s.box.contains(now))) return;
    var again = stopId ? findIn(s.box, function (n) { return n.getAttribute && n.getAttribute('data-rvsp-stop') === stopId && !n.disabled; }) : null;
    (again || firstField(s)).focus();
  }

  function renderList(s) {
    var E = s.els, links = s.links || [];
    clear(E.listBody);
    E.listHead.textContent = 'Links that work now' + (s.links ? ' (' + links.length + ')' : '');
    if (s.listState === 'loading' && !s.links) {
      E.listBody.appendChild(el('p', { className: 'rvsp-small', text: 'Loading links…' }));
      return;
    }
    if (s.listState === 'error' && !s.links) {
      E.listBody.appendChild(el('p', { className: 'rvsp-status is-error', text: 'The links could not be loaded. ' + s.listError }));
      E.listBody.appendChild(el('div', { className: 'rvsp-acts' }, [button('Try again', 'btn btn-secondary', function () { loadList(s); })]));
      return;
    }
    if (!links.length) {
      E.listBody.appendChild(el('p', { className: 'rvsp-small', text: 'No links are shared right now.' }));
      return;
    }
    var me = myEmail(), now = Date.now();
    var list = el('ul', { className: 'rvsp-list' });
    links.forEach(function (link) {
      var who = link.createdBy && me && link.createdBy.toLowerCase() === me ? 'you' : (link.createdBy || 'someone on the team');
      var bits = ['Made by ' + who];
      var made = whenText(link.createdAt, now, false), until = whenText(link.expiresAt, now, false);
      if (made) bits.push(made);
      if (until) bits.push('works until ' + until);
      var title = el('p', null, [
        el('span', { className: 'rvsp-id', text: shortId(link.last4) }),
        link.label ? ' · For ' + link.label : '',
        s.made && s.made.link.id === link.id ? el('span', { className: 'rvsp-new', text: 'New' }) : null
      ]);
      var row = el('li', { className: 'rvsp-item', 'data-rvsp-link': link.id }, [
        el('div', { className: 'rvsp-item-main' }, [title, el('p', { className: 'rvsp-small', text: bits.join(' · ') })])
      ]);
      if (asking(s, link.id, 'list')) {
        row.appendChild(askBox(s, link));
      } else {
        var b = button('Stop sharing', 'btn btn-secondary', function () { askStop(s, link.id, 'list'); }, {
          'aria-label': 'Stop sharing link ' + shortId(link.last4) + (link.label ? ' for ' + link.label : ''),
          'data-rvsp-stop': link.id
        });
        b.disabled = !!s.stopping[link.id];
        row.appendChild(b);
      }
      list.appendChild(row);
    });
    E.listBody.appendChild(list);
  }

  function findIn(root, test) {
    var stack = [root];
    while (stack.length) {
      var n = stack.shift();
      if (n !== root && n.nodeType === 1 && test(n)) return n;
      var kids = n.childNodes || [];
      for (var i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return null;
  }
  function findRow(s, id) {
    return findIn(s.els.listBody, function (n) { return n.getAttribute && n.getAttribute('data-rvsp-link') === id; });
  }
  function nextRowId(s, id) {
    var links = s.links || [];
    for (var i = 0; i < links.length; i++) {
      if (links[i].id === id) return (links[i + 1] || links[i - 1] || {}).id || '';
    }
    return '';
  }

  /* ---------- the keyboard: Esc closes, Tab stays inside ---------- */
  function focusables(root) {
    var out = [];
    (function walk(n) {
      var kids = n.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType !== 1 || k.hasAttribute('hidden')) continue;
        var tag = k.tagName;
        var can = (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') ? !k.disabled
          : tag === 'A' ? k.hasAttribute('href')
          : k.hasAttribute('tabindex') && k.getAttribute('tabindex') !== '-1';
        if (can) out.push(k);
        walk(k);
      }
    })(root);
    return out;
  }

  /* One of the page's own dialogs opened on top of this one (the editor asks there before saving over someone
     else's version): its keys are its own. */
  function coveredByAnother(s) {
    var last = document.body && document.body.lastElementChild;
    return !!(last && last !== s.scrim && /(^|\s)(scrim|modal-bg|fb-scrim|variant-lightbox-scrim)(\s|$)/.test(String(last.className || '')));
  }

  function onDocKey(e) {
    var s = S;
    if (!s) return;
    var inside = s.scrim.contains(e.target);
    if (!inside && (coveredByAnother(s) || (e.target && e.target !== document.body && e.target !== document.documentElement && e.target !== document))) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
      if (s.ask) {
        var at = s.ask;
        s.ask = null;
        rerenderFor(s, at.id, at.where, 'stop');
      } else {
        close();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    var f = focusables(s.box);
    if (!f.length) { e.preventDefault(); s.box.focus(); return; }
    var at = f.indexOf(document.activeElement);
    if (e.shiftKey && at <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (at === -1 || at === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }

  /* ============================================================
     THE BUTTON — it copies Preview: hidden while Preview is (the console before its event has loaded),
     disabled while Preview is (the editor before its canvas has mounted)
     ============================================================ */
  function wire() {
    var btn = document.querySelector('[data-share-preview]');
    if (!btn || btn.hasAttribute('data-rvsp-wired')) return;
    btn.setAttribute('data-rvsp-wired', '');
    injectCss();
    var preview = document.getElementById('btn-preview');
    var eventId = eventIdFrom(window.location.search);
    function sync() {
      var off = !eventId || !!(preview && preview.hidden);
      var dis = !eventId || !!(preview && preview.disabled);
      if (btn.hidden !== off) btn.hidden = off;
      if (btn.disabled !== dis) btn.disabled = dis;
    }
    sync();
    if (preview && typeof window.MutationObserver === 'function') {
      new window.MutationObserver(sync).observe(preview, { attributes: true, attributeFilter: ['hidden', 'disabled'] });
    }
    btn.addEventListener('click', function () {
      if (!btn.disabled && eventId) open(btn, eventId);
    });
  }

  window.RevampSharePreview = {
    open: function (eventId) { return !!open(document.querySelector('[data-share-preview]'), eventId); },
    _test: { eventIdFrom: eventIdFrom, untilText: untilText, whenText: whenText, errorText: errorText, CSS: CSS }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
