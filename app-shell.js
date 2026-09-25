/* ===========================================================================
   ET Oneworld - Revamp CMS
   APP SHELL : the chrome that never changes

   One source of truth for the two things a user must never see move when they
   switch section: the top bar and the icon rail. Every in-event page mounts
   this instead of hand-writing its own header/rail, so Dashboard, Content,
   Design, Payment, Promotions, Reporting and Settings are the same room with
   different furniture, not seven different rooms.

   Exposes one global: window.RevampShell

     .SECTIONS            the rail, in order
     .sectionHref(id, eventId, base)
     .mount(opts)         renders top bar + rail, returns { event, eventId }

   mount(opts):
     section      rail item to light up  ('dashboard' | 'content' | 'design' |
                  'payment' | 'marketing' | 'audience' | 'settings')
     eventId      defaults to ?event=, then '1'
     event        { name, meta } — only needed where RevampCore is not loaded
     base         path back to the repo root ('' at root, '../../' in payment/)
     topbar,rail  element or id to fill; defaults to the first .topbar / .rail
     actions      extra HTML injected before Preview, for a page whose primary
                  action is its own (Reporting's "Send communication")
     wireActions  false when the page binds #btn-preview / #btn-publish itself
     onPreview,onPublish   handlers, if the page wants them bound here
     sub          { <sectionId>: [ { label, icon, active, href, onClick } ] }
                  hover fly-out under a rail item (Payment's Setup / Report)
     onSection    intercept a rail click; return false to stay on the page

   Moving between sections is a real document navigation, so the two
   stylesheets (edit-event.css and payment/html_version/styles.css) carry the
   matching @view-transition opt-in and give .topbar / .rail a
   view-transition-name. That is what stops the flash between pages and keeps
   the chrome still while the content cross-fades. Chrome 126+; elsewhere the
   at-rule is ignored and you get the old hard navigation.
   =========================================================================== */

window.RevampShell = (function(){
  'use strict';

  var SECTIONS = [
    { id:'dashboard', label:'Dashboard', page:'dashboard.html',
      icon:'<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15.5 3.5A9 9 0 0 1 20.5 8.5H15.5z"/>' },
    { id:'content',   label:'Content',   page:'edit-event.html', hash:'content',
      icon:'<path d="M12 2.5l9.5 5-9.5 5-9.5-5z"/><path d="M2.5 12.5l9.5 5 9.5-5"/><path d="M2.5 17l9.5 5 9.5-5"/>' },
    { id:'design',    label:'Design',    page:'custom_editor.html',
      icon:'<path d="M12 2l7 7-9 9H3v-7z"/><path d="M15 5l4 4"/>' },
    { id:'payment',   label:'Payment',   page:'payment/html_version/index.html',
      icon:'<rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M2.5 10h19"/><path d="M6 15h4"/>' },
    { id:'marketing', label:'Promotions', page:'marketing.html',
      icon:'<path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a5 5 0 0 1 0 8"/><path d="M18.5 5a9 9 0 0 1 0 14"/>' },
    { id:'audience',  label:'Reporting', page:'audience-registrations.html',
      icon:'<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8.5a3 3 0 0 1 0 6"/><path d="M18.5 20a5.6 5.6 0 0 0-3-4.4"/>' },
    { id:'settings',  label:'Settings',  page:'settings.html',
      icon:'<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2v.18a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.93-1.15l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.5 13.6h-.18a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.57 6.67L4.5 6.6a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 1 1.87.34h.08A1.7 1.7 0 0 0 10.4 2.6v-.18a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1.02h.18a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1.02z"/>' }
  ];

  var ENTITIES = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ENTITIES[c]; });
  }

  function el(ref, fallbackSelector){
    if (!ref) return document.querySelector(fallbackSelector);
    if (ref.nodeType === 1) return ref;
    return document.getElementById(ref) || document.querySelector(fallbackSelector);
  }

  function toast(msg){
    var C = window.RevampCore;
    if (C && C.toast) return C.toast(msg);
    if (window.showToast) return window.showToast(msg);
  }

  /* One routing table. Before this existed every page carried its own copy and
     they had drifted — Payment landed in two different places and Dashboard
     dropped the event id, so switching section silently changed which event
     you were looking at. */
  function sectionHref(id, eventId, base){
    var s = null;
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) s = SECTIONS[i];
    if (!s) s = SECTIONS[0];
    return (base || '') + s.page + '?event=' + encodeURIComponent(eventId) +
      (s.hash ? '#' + s.hash : '');
  }

  /* ---------- chrome CSS the shell owns ------------------------------------
     Kept here rather than in a stylesheet because the payment sub-app loads a
     different one; anything the shell draws has to travel with the shell. */
  var CSS = [
    /* reserve the scrollbar gutter always, or the top bar's buttons slide 15px
       sideways between a section that scrolls and one that does not */
    'html{overflow-y:scroll;scrollbar-gutter:stable;}',
    /* the payment section already used a 6px scrollbar while everything else
       used the OS default, so crossing into it moved the whole page 9px.
       One scrollbar for the whole console. */
    '::-webkit-scrollbar{width:6px;height:6px;}',
    '::-webkit-scrollbar-track{background:transparent;}',
    '::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px;}',
    '::-webkit-scrollbar-thumb:hover{background:var(--text-faint);}',
    /* the editor ships its own .btn rule; pin the two shell buttons so they are
       the same size in every section rather than 3px off in one of them */
    '.topbar .btn{font-size:13px;font-weight:700;padding:8px 15px;border-radius:9px;',
      'border-width:1.5px;border-style:solid;}',
    '.ev-switch{flex:1;min-width:0;display:flex;align-items:center;gap:8px;',
      'background:none;border:0;padding:4px 8px 4px 4px;margin:0;border-radius:9px;',
      'cursor:pointer;text-align:left;color:inherit;transition:background .14s;}',
    '.ev-switch:hover{background:var(--surface-2);}',
    /* pinned in px: two of these pages are quirks-mode documents, and a
       unitless line-height resolves differently there - the title block has to
       be the same height everywhere or the top bar twitches between sections */
    '.ev-title h1{font-size:16.5px;line-height:20px;margin:0;}',
    '.ev-title .meta{display:block;font-size:11.5px;line-height:16px;}',
    '.ev-switch .ev-title{flex:1;min-width:0;display:block;}',
    '.ev-switch .chev{flex-shrink:0;color:var(--text-muted);}',
    '.ev-switch[aria-expanded="true"] .chev{color:var(--accent-strong);}',
    '.ev-menu{position:fixed;top:calc(var(--topbar-h) - 4px);left:120px;z-index:60;',
      'width:340px;max-width:calc(100vw - 32px);max-height:60vh;overflow-y:auto;',
      'background:var(--surface);border:1px solid var(--border);border-radius:13px;',
      'padding:6px;box-shadow:var(--shadow-md);}',
    '.ev-menu[hidden]{display:none;}',
    '.ev-menu-item{display:block;width:100%;text-align:left;border:0;background:none;',
      'padding:9px 11px;border-radius:9px;cursor:pointer;color:var(--text);}',
    '.ev-menu-item:hover{background:var(--surface-2);}',
    '.ev-menu-item.active{background:var(--accent-soft);color:var(--accent-strong);}',
    '.ev-menu-item b{display:block;font-size:13px;font-weight:700;}',
    '.ev-menu-item span{display:block;font-size:11px;color:var(--text-muted);',
      'font-family:var(--font-mono);margin-top:1px;}',
    /* the rail runs the full height of the viewport on every page — the root
       pages capped it at their content height, the payment sub-app did not */
    '.rail{height:calc(100vh - var(--topbar-h));}',
    /* fly-out under a rail item — lived only in the payment stylesheet before.
       It sits in a wrapper, not inside the rail item: an <a> inside an <a> is
       not parseable HTML and the browser hoists the children out of the rail. */
    '.rail-item{position:relative;text-decoration:none;}',
    '.rail-slot{position:relative;display:block;width:100%;}',
    '.rail-sub{position:absolute;left:calc(100% + 4px);top:0;background:var(--surface);',
      'border:1px solid var(--border);border-radius:12px;padding:6px;box-shadow:var(--shadow-md);',
      'display:flex;flex-direction:column;gap:4px;min-width:160px;opacity:0;pointer-events:none;',
      'transform:translateX(-8px);transition:all .2s cubic-bezier(.4,0,.2,1);z-index:901;}',
    '.rail-sub::before{content:"";position:absolute;left:-10px;top:0;bottom:0;width:10px;}',
    '.rail-slot:hover .rail-sub,.rail-slot:focus-within .rail-sub{',
      'opacity:1;pointer-events:auto;transform:translateX(0);}',
    '.rail-sub-item{text-align:left;padding:8px 12px;border-radius:8px;font-size:13px;',
      'font-weight:600;color:var(--text-muted);text-decoration:none;cursor:pointer;border:0;',
      'background:transparent;display:flex;align-items:center;gap:8px;}',
    '.rail-sub-item:hover{background:var(--surface-2);color:var(--text);}',
    '.rail-sub-item.active{background:var(--accent-soft);color:var(--accent-strong);}',
    '@media (max-width:760px){.ev-menu{left:12px;right:12px;width:auto;}}'
  ].join('');

  function injectCSS(){
    if (document.getElementById('revamp-shell-css')) return;
    var st = document.createElement('style');
    st.id = 'revamp-shell-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- event identity ---------- */
  function describe(eventId, given){
    var C = window.RevampCore;
    if (C && C.EVENTS) {
      var ev = C.eventById(eventId) || C.EVENTS[0];
      return {
        id: ev.id,
        name: ev.name + ' | ' + (C.PORTALS[ev.portal] || ''),
        meta: C.fmtDT(ev.start) + '  |  ' + ev.eventNo + '  |  ' + (C.TYPES[ev.type] || ev.type),
        raw: ev
      };
    }
    given = given || {};
    return { id: eventId, name: given.name || '', meta: given.meta || '', raw: given.raw || null };
  }

  function eventList(){
    var C = window.RevampCore;
    if (!C || !C.EVENTS) return [];
    return C.EVENTS.map(function(ev){
      return {
        id: ev.id,
        name: ev.name + ' | ' + (C.PORTALS[ev.portal] || ''),
        meta: C.fmtDT(ev.start) + '  |  ' + ev.eventNo
      };
    });
  }

  /* Switching event keeps you on the same section — that is the whole point of
     a shell. Same URL, different ?event=. */
  function urlForEvent(id){
    var u = new URL(location.href);
    u.searchParams.set('event', id);
    return u.pathname + u.search + u.hash;
  }

  /* ---------- top bar ---------- */
  function renderTopbar(host, ev, opts){
    var events = eventList();
    var switchable = events.length > 1;

    /* A page that re-mounts to move the rail's active item (the console does it
       on every route change) must not rebuild the top bar underneath the user —
       that would drop focus and stack a new document listener each time. */
    if (host.getAttribute('data-shell-topbar') === '1') {
      var nameEl = document.getElementById('shell-event-name');
      var metaEl = document.getElementById('shell-event-meta');
      if (nameEl) nameEl.textContent = ev.name;
      if (metaEl) metaEl.textContent = ev.meta;
      bindActions(opts);
      return;
    }
    host.setAttribute('data-shell-topbar', '1');

    var title =
      '<span class="ev-title">' +
        '<h1 id="shell-event-name">' + esc(ev.name) + '</h1>' +
        '<span class="meta" id="shell-event-meta">' + esc(ev.meta) + '</span>' +
      '</span>';

    host.innerHTML =
      '<a class="back-btn" href="' + (opts.base || '') + 'Event_Listing.html">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>' +
        'Back to events' +
      '</a>' +
      (switchable
        ? '<button class="ev-switch" type="button" id="shell-ev-switch" aria-expanded="false" aria-haspopup="true" title="Switch event">' +
            title +
            '<svg class="chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
          '</button>'
        : title) +
      '<span class="topbar-acts">' +
        (opts.actions || '') +
        '<button class="btn btn-secondary" type="button" id="btn-preview">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/></svg>' +
          'Preview' +
        '</button>' +
        '<button class="btn btn-primary" type="button" id="btn-publish">Publish</button>' +
      '</span>';

    if (switchable) wireSwitcher(ev, events);
    bindActions(opts);
  }

  function bindActions(opts){
    if (opts.wireActions === false) return;
    var prev = document.getElementById('btn-preview');
    var pub = document.getElementById('btn-publish');
    if (prev) prev.onclick = opts.onPreview || function(){ toast('Preview opened'); };
    if (pub) pub.onclick = opts.onPublish ||
      function(){ toast('Published. The microsite is live at etoneworld.com'); };
  }

  function wireSwitcher(ev, events){
    var btn = document.getElementById('shell-ev-switch');
    var menu = document.getElementById('shell-ev-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'ev-menu';
      menu.id = 'shell-ev-menu';
      menu.hidden = true;
      document.body.appendChild(menu);
    }
    menu.innerHTML = events.map(function(e){
      return '<button class="ev-menu-item' + (String(e.id) === String(ev.id) ? ' active' : '') +
        '" type="button" data-ev="' + esc(e.id) + '">' +
        '<b>' + esc(e.name) + '</b><span>' + esc(e.meta) + '</span></button>';
    }).join('');

    function close(){ menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.onclick = function(e){
      e.stopPropagation();
      var opening = menu.hidden;
      menu.hidden = !opening;
      btn.setAttribute('aria-expanded', String(opening));
    };
    menu.onclick = function(e){
      var item = e.target.closest('[data-ev]');
      if (!item) return;
      location.href = urlForEvent(item.getAttribute('data-ev'));
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
  }

  /* ---------- rail ---------- */
  function renderRail(host, eventId, opts){
    var active = opts.section || 'dashboard';
    var sub = opts.sub || {};

    host.innerHTML = SECTIONS.map(function(s){
      var kids = sub[s.id];
      var flyout = kids && kids.length
        ? '<span class="rail-sub">' + kids.map(function(k, i){
            return '<a class="rail-sub-item' + (k.active ? ' active' : '') +
              '" href="' + esc(k.href || '#') + '" data-sub="' + s.id + ':' + i + '">' +
              (k.icon || '') + esc(k.label) + '</a>';
          }).join('') + '</span>'
        : '';
      var item = '<a class="rail-item' + (s.id === active ? ' active' : '') + (flyout ? ' has-sub' : '') + '"' +
        ' href="' + esc(sectionHref(s.id, eventId, opts.base)) + '"' +
        ' data-section="' + s.id + '"' +
        ' aria-label="' + esc(s.label) + '"' +
        (s.id === active ? ' aria-current="page"' : '') + '>' +
        '<span class="ri"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + s.icon + '</svg></span>' +
        '<span class="rl">' + esc(s.label) + '</span>' +
      '</a>';
      /* the fly-out is a sibling, never a child: anchors cannot nest */
      return flyout ? '<span class="rail-slot">' + item + flyout + '</span>' : item;
    }).join('');

    /* Real anchors, so middle-click and "open in new tab" behave. A page that
       needs to intercept (the editor stays put, a sub-item runs JS) hooks in
       here without giving that up. */
    host.querySelectorAll('[data-sub]').forEach(function(a){
      var parts = a.getAttribute('data-sub').split(':');
      var kid = (sub[parts[0]] || [])[Number(parts[1])];
      if (!kid || !kid.onClick) return;
      a.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        kid.onClick();
      });
    });

    if (!opts.onSection) return;
    host.querySelectorAll('[data-section]').forEach(function(a){
      a.addEventListener('click', function(e){
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        if (opts.onSection(a.getAttribute('data-section')) === false) e.preventDefault();
      });
    });
  }

  /* ---------- content entrance ---------------------------------------------
     motion.css cascades whatever is inside [data-enter]. The attribute goes on
     while the container is still empty, because the page fills it later in the
     same task: the children then animate the first time they are rendered. It
     comes back off a second later so the *re*-renders - a tab, a filter, a
     keystroke in a search box - are instant. A table that re-animated on every
     keystroke would be unusable, and that window is the whole guard against
     it. */
  var ENTER_ROOTS = ['#view', '#page', '#app-content', '.main-content .fade-in', '.main-content'];
  var mounted = false;

  function markEnter(){
    if (reducedMotion()) return;
    var root = null;
    for (var i = 0; i < ENTER_ROOTS.length && !root; i++) {
      root = document.querySelector(ENTER_ROOTS[i]);
    }
    if (!root) return;
    root.setAttribute('data-enter', '');
    setTimeout(function(){ root.removeAttribute('data-enter'); }, 1100);
    /* the page has not rendered yet; count up on the next frame, while the
       tiles are still transparent on their way in */
    requestAnimationFrame(function(){ countUp(root); });
  }

  function reducedMotion(){
    return !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* A headline number that lands already at its value reads as a label. Rolling
     it up is what makes it read as a measurement. Only the digits move - the
     currency symbol, the "K"/"Lacs" suffix and the thousands grouping are put
     back each frame, and the exact original string is restored at the end, so
     no rounding artefact can outlive the animation.

     It writes the element's first *text node*, never its textContent: the
     payment module's .hud-val holds the number followed by a sibling <span>
     ("2" + "2 live"), and setting textContent would flatten that span into
     plain text and lose its styling for good. */
  var COUNT_MS = 620;

  function countUp(root){
    var els = root.querySelectorAll('.stat .st-v, .hud-val');
    Array.prototype.forEach.call(els, function(el){
      var node = el.firstChild;
      if (!node || node.nodeType !== 3) return;
      var text = node.nodeValue;
      var m = text.match(/^(\D*)([\d,]+(?:\.\d+)?)([\s\S]*)$/);
      if (!m) return;
      var target = parseFloat(m[2].replace(/,/g, ''));
      if (!isFinite(target) || target === 0) return;
      var parts = m[2].split('.');
      var decimals = parts[1] ? parts[1].length : 0;
      var grouped = parts[0].indexOf(',') >= 0;
      var started = null;
      var settled = false;

      function settle(){
        if (settled) return;
        settled = true;
        node.nodeValue = text;
      }
      function frame(now){
        if (settled) return;
        if (started === null) started = now;
        var t = Math.min(1, (now - started) / COUNT_MS);
        /* the same decelerating shape as --ease-out, so the number settles the
           moment the tile it sits in stops moving */
        var v = target * (1 - Math.pow(1 - t, 3));
        if (t < 1) {
          node.nodeValue = m[1] + format(v, decimals, grouped) + m[3];
          requestAnimationFrame(frame);
        } else {
          settle();
        }
      }
      node.nodeValue = m[1] + format(0, decimals, grouped) + m[3];
      requestAnimationFrame(frame);
      /* frames stop in a background tab, and a number frozen part-way is a
         wrong number on screen. The clock keeps running, so it finishes the
         job whatever the compositor is doing. */
      setTimeout(settle, COUNT_MS + 400);
    });
  }

  function format(v, decimals, grouped){
    var s = v.toFixed(decimals);
    if (!grouped) return s;
    var bits = s.split('.');
    bits[0] = bits[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return bits.join('.');
  }

  function mount(opts){
    opts = opts || {};
    injectCSS();

    var eventId = opts.eventId != null
      ? opts.eventId
      : (new URLSearchParams(location.search).get('event') || '1');

    var ev = describe(eventId, opts.event);
    if (ev.id != null) eventId = ev.id;

    var topbar = el(opts.topbar, 'header.topbar, .topbar');
    var rail = el(opts.rail, 'nav.rail, .rail');

    if (topbar) {
      topbar.classList.add('topbar');
      renderTopbar(topbar, ev, opts);
    }
    if (rail) {
      rail.classList.add('rail');
      if (!rail.getAttribute('aria-label')) rail.setAttribute('aria-label', 'Sections');
      renderRail(rail, eventId, opts);
    }

    /* once per page, not once per mount - the console re-mounts on every route
       change to move the rail's active item, and that must not restart the
       cascade under the user */
    if (!mounted) { mounted = true; markEnter(); }

    return { event: ev, eventId: eventId };
  }

  return { SECTIONS: SECTIONS, sectionHref: sectionHref, mount: mount };
})();
