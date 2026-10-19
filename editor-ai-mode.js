/* The site editor's two modes (custom_editor.html): "Edit with AI" and "Edit myself".

   "Edit myself" is the editor as it always was: the canvas (editor-canvas.js) with selection, typing in place,
   the panels, the section tools and the chat beside it. Nothing here changes it.

   "Edit with AI" shows the site as its draft preview shows it (/preview/<id>?draft=1), full width, with ETB2B AI
   (the editor's own chat panel) floating at the bottom right. The page in it is a throw-away copy: the
   editor's page (canvas.serialize()) put through the preview's own transform (POST /api/event/live-view ->
   lib/api.js publishTransform, liveView), shown in a frame of its own (the "live view") and drawn again after
   every change. So the site's runtime runs there as on the preview — carousels, reveals, the nav, pop-ups —
   while the canvas, the one copy that is edited, saved and published, stays exactly as it is, out of sight.
   Changes still only ever happen on the canvas: through the chat (Apply), Undo / Redo, Save, Publish.

   In the live view
     - pointing at a section outlines it and offers "Ask AI about this section"; a click (or Enter on a link or
       button in it) makes it the chat's selected section — the same reference a click on the canvas gives —
       and opens the chat. Nothing is typed into the page.
     - a link to another page, a form or a new window never goes anywhere (the frame is sandboxed without
       popups, top navigation or forms, and such clicks are stopped); links within the page still scroll, and
       buttons that open, slide or play something on the page still work.
     - Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Y undo and redo, as on the canvas.
     - on a phone the page is laid out at the phone's own width, the chat is a sheet along the bottom and the
       live view keeps the window above it (a tap on a section opens it and keeps what was tapped in sight).

   The mode signal for site code: the canvas's <html> carries data-rv-editor-mode="manual" (template-loader.js,
   with data-rv-editing), the live view's carries data-rv-editor-mode="ai" (and no data-rv-editing). See
   templates/_shared/et-runtime.js, "Which editor mode a page is in".

   Switching keeps the section in view, and never touches the page: what is being typed is recorded first.
   The mode is remembered per signed-in user in this browser; ?mode=ai|manual in the address wins, and
   ?section=<data-rv-key> scrolls to that section (the preview's "Edit with AI" button, rv-preview-edit.js).

   window.RevampEditorMode
     ready()           custom_editor.html calls it once the site is on the canvas
     mode()            "ai" | "manual"
     setMode(m, opts)  opts.section: the section to show
     openAt(key)       "Edit with AI" at that section; false when the site is not open yet
     eventId()         the event this editor has open */
(function () {
  'use strict';

  var UI = null;
  var mode = 'manual', isReady = false;
  var toggle = null, layer = null, viewport = null, status = null, hoverBox = null, pickBox = null, hint = null;
  var current = null;                 // the live view's iframe on show
  var renderSeq = 0, renderTimer = null, scale = 1, fallbackSaid = false;
  var hoverKey = '', overlayFrame = 0;
  var leaving = false;                // the editor itself is being closed or reloaded
  window.addEventListener('pagehide', function () { leaving = true; });
  window.addEventListener('pageshow', function () { leaving = false; });
  var MOBILE_MAX = 720;

  var qs = new URLSearchParams(location.search);
  var EVENT_ID = qs.get('slug') || qs.get('event') || '';

  function store() { try { return window.localStorage; } catch (e) { return null; } }
  function userKey() {
    var u = null;
    try { u = window.RevampAuth && RevampAuth.currentUser ? RevampAuth.currentUser() : null; } catch (e) { u = null; }
    return 'revamp.editorMode.' + ((u && (u.uid || u.email)) || 'anon');
  }
  function remembered() {
    var s = store(), v = null;
    try { v = s && s.getItem(userKey()); } catch (e) { v = null; }
    return v === 'ai' || v === 'manual' ? v : '';
  }
  function remember(m) {
    var s = store();
    try { if (s) s.setItem(userKey(), m); } catch (e) { /* private window or blocked storage: this visit only */ }
  }

  function device() {
    var b = document.querySelector('.device-toggle button.active');
    var name = b ? b.getAttribute('data-device') : 'desktop';
    var sizes = (window.RevampCanvas && RevampCanvas.DEVICES) || { desktop: 1440, mobile: 390 };
    return sizes[name] || sizes.desktop;
  }
  function narrow() { return window.innerWidth <= MOBILE_MAX; }

  /* ---------- the toggle ---------- */
  function buildToggle() {
    toggle = document.getElementById('ed-mode-toggle');
    if (!toggle) return;
    var radios = Array.prototype.slice.call(toggle.querySelectorAll('[role="radio"]'));
    radios.forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
      b.addEventListener('keydown', function (e) {
        var i = radios.indexOf(b), to = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % radios.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + radios.length) % radios.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = radios.length - 1;
        if (to === -1) return;
        e.preventDefault();
        radios[to].focus();
        setMode(radios[to].getAttribute('data-mode'));
      });
    });
    toggle.hidden = false;
    drawToggle();
  }
  function drawToggle() {
    if (!toggle) return;
    Array.prototype.forEach.call(toggle.querySelectorAll('[role="radio"]'), function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
  }

  /* ---------- where the person is on the page ----------
     A place is a section and how far into it the top of the window is (a fraction of its height), so it
     carries over between the canvas and the live view, whose pages differ by the editor's own marks. */
  function topSections(doc) {
    return Array.prototype.filter.call(doc.querySelectorAll('[data-rv-section]'), function (s) {
      return !(s.parentElement && s.parentElement.closest('[data-rv-section]')) && !s.classList.contains('is-hidden-sec');
    });
  }
  function keyOf(sec) { return sec.getAttribute('data-rv-key') || sec.getAttribute('data-rv-section') || ''; }
  /* a bar of the site's own that stays at the top (the nav) is over every place on the page, so a place is
     read, and a section brought into view, just below it */
  function stuck(win, sec) { return /^(fixed|sticky)$/.test(win.getComputedStyle(sec).position); }
  function barHeight(win, except) {
    var h = 0;
    topSections(win.document).forEach(function (s) {
      if (s === except || !stuck(win, s)) return;
      var b = s.getBoundingClientRect().height;
      if (b < win.innerHeight * 0.4) h = Math.max(h, b);
    });
    return h;
  }
  function placeIn(doc) {
    var win = doc && doc.defaultView;
    if (!win) return null;
    var secs = topSections(doc), line = barHeight(win, null);
    for (var i = 0; i < secs.length; i++) {
      var r = secs[i].getBoundingClientRect();
      if (r.height < 1 || r.bottom <= line + 1 || stuck(win, secs[i])) continue;
      return { key: keyOf(secs[i]), frac: r.top >= line ? 0 : Math.min(1, (line - r.top) / r.height) };
    }
    return null;
  }
  function byKey(doc, key) {
    if (!doc || !key) return null;
    var secs = topSections(doc);
    for (var i = 0; i < secs.length; i++) if (keyOf(secs[i]) === key) return secs[i];
    for (i = 0; i < secs.length; i++) if (secs[i].getAttribute('data-rv-section') === key) return secs[i];
    return null;
  }
  function goToPlace(win, place) {
    if (!win || !place) return false;
    var sec = byKey(win.document, place.key);
    if (!sec) return false;
    var r = sec.getBoundingClientRect();
    var y = Math.max(0, r.top + win.scrollY + (place.frac || 0) * r.height - barHeight(win, sec));
    try { win.scrollTo({ top: y, left: 0, behavior: 'instant' }); } catch (e) { win.scrollTo(0, y); }
    return true;
  }

  /* ---------- the live view ---------- */
  function buildLayer() {
    var frame = document.getElementById('frame');
    layer = document.createElement('div');
    layer.className = 'ai-live';
    layer.id = 'ai-live';
    layer.hidden = true;
    viewport = document.createElement('div');
    viewport.className = 'ai-live-viewport';
    hoverBox = document.createElement('div');
    hoverBox.className = 'ai-live-hover';
    hoverBox.hidden = true;
    hoverBox.innerHTML = '<span class="ai-live-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>Ask AI about this section</span>';
    pickBox = document.createElement('div');
    pickBox.className = 'ai-live-pick';
    pickBox.hidden = true;
    pickBox.innerHTML = '<span class="ai-live-tag"></span>';
    status = document.createElement('div');
    status.className = 'ai-live-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    layer.appendChild(viewport);
    layer.appendChild(pickBox);
    layer.appendChild(hoverBox);
    layer.appendChild(status);
    frame.appendChild(layer);
    if (window.ResizeObserver) new ResizeObserver(function () { fitAll(); drawOverlay(); }).observe(viewport);

    var rail = document.querySelector('.ed-rail .rail-fixed');
    if (rail) {
      hint = document.createElement('span');
      hint.className = 'ai-mode-hint';
      hint.textContent = 'Live view — click any section to ask ETB2B AI about it';
      rail.parentNode.insertBefore(hint, rail);
    }
    // the device switch acts on the live view too (its page re-lays itself out at the new width)
    Array.prototype.forEach.call(document.querySelectorAll('.device-toggle button'), function (b) {
      b.addEventListener('click', function () { setTimeout(function () { fitAll(); drawOverlay(); }, 0); });
    });
  }

  /* a live view frame taken away by this script (its page going then is expected, not a navigation) */
  function drop(ifr) {
    if (!ifr || ifr.rvDropped) return;
    ifr.rvDropped = true;
    if (ifr.parentNode) ifr.parentNode.removeChild(ifr);
  }

  function fit(ifr) {
    if (!ifr || !viewport) return;
    var w = device(), vw = viewport.clientWidth, vh = viewport.clientHeight;
    if (!vw || !vh) return;
    // on a phone the page is laid out at the phone's own width, as its preview there would be
    if (narrow() && w > vw) w = vw;
    scale = Math.min(1, vw / w);
    ifr.style.width = w + 'px';
    ifr.style.height = (vh / scale) + 'px';
    ifr.style.transform = scale === 1 ? '' : 'scale(' + scale + ')';
    ifr.style.left = Math.max(0, Math.round((vw - w * scale) / 2)) + 'px';
  }
  function fitAll() { Array.prototype.forEach.call(viewport ? viewport.querySelectorAll('iframe') : [], fit); }

  function setStatus(text) {
    if (!status) return;
    status.textContent = text || '';
    status.hidden = !text;
  }

  /* the page as the draft preview shows it; without an event (a template opened on its own), or when the
     server cannot be reached, the editor's own copy of it with the live site's stylesheet */
  function localPage(c) {
    var html = c.serialize().replace(/<html\b/i, '<html data-rv-editor-mode="ai"');
    return html.replace(/<\/head>/i, '<link rel="stylesheet" href="/templates/_shared/rv-live.css">\n</head>');
  }
  function pageHtml(c) {
    if (!EVENT_ID || !window.RevampAuth || !RevampAuth.authedFetch) return Promise.resolve(localPage(c));
    var page = c.serialize();
    return RevampAuth.authedFetch('/api/event/live-view', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: EVENT_ID, html: page, origin: location.origin })
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body || typeof body.html !== 'string') throw new Error((body && body.error) || ('HTTP ' + res.status));
        return body.html;
      });
    }).then(null, function (err) {
      if (window.console) console.warn('[editor-ai-mode] live view from the editor’s copy:', err && err.message);
      // said where the mode is explained, not as an alarm: the page shown is the same, less the preview's finishing
      if (!fallbackSaid && hint) {
        hint.textContent = 'Live view (the preview could not be prepared, so this is the editor’s copy) — click any section to ask ETB2B AI about it';
      }
      fallbackSaid = true;
      return localPage(UI.canvas() || c);
    });
  }

  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { render(null); }, delay == null ? 250 : delay);
  }

  /* place: where to show the new page; by default where the live view is now */
  function render(place) {
    var c = UI.canvas();
    if (mode !== 'ai' || !c) return;
    var seq = ++renderSeq;
    var want = place || placeIn(current && current.contentDocument) || null;
    setStatus(current ? 'Updating the live view…' : 'Loading the live view…');
    pageHtml(c).then(function (html) {
      if (seq !== renderSeq || mode !== 'ai') return;
      mount(html, want, seq);
    });
  }

  function mount(html, place, seq) {
    var ifr = document.createElement('iframe');
    ifr.className = 'ai-live-frame';
    ifr.title = 'Live view of the site — click a section to ask ETB2B AI about it';
    // scripts run as on the preview; no popups, no forms, no navigating the editor itself
    ifr.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    ifr.style.visibility = 'hidden';
    viewport.appendChild(ifr);
    fit(ifr);
    var loads = 0, shown = false, touched = false;
    function show() {
      if (shown) return;
      shown = true;
      clearTimeout(early);
      if (seq !== renderSeq || mode !== 'ai') { drop(ifr); return; }
      wire(ifr, function () { touched = true; });
      goToPlace(ifr.contentWindow, place);
      ifr.style.visibility = '';
      // keyboard focus moves on with the page, so Undo / Redo / Save keys keep working after each redraw
      var hadFocus = !!current && document.activeElement === current;
      if (current && current !== ifr) drop(current);
      current = ifr;
      if (hadFocus) { try { ifr.contentWindow.focus(); } catch (e) { /* the browser decides */ } }
      setStatus('');
      hoverKey = '';
      drawOverlay();
    }
    ifr.addEventListener('load', function () {
      loads++;
      if (loads === 1) {
        if (!shown) show();
        else if (!touched && current === ifr) { goToPlace(ifr.contentWindow, place); drawOverlay(); }   // pictures moved things
        return;
      }
      // the page went somewhere after all (a script set location): show the site again
      if (current === ifr && mode === 'ai') render(place);
    });
    // a page still fetching pictures is shown as it is, without waiting for every one
    var early = setTimeout(function () {
      var d = ifr.contentDocument;
      if (d && d.body && d.readyState !== 'loading') show();
    }, 2500);
    ifr.srcdoc = html;
  }

  function sectionAt(target) {
    var t = target && (target.nodeType === 1 ? target : target.parentElement);
    var sec = t && t.closest ? t.closest('[data-rv-section]') : null;
    while (sec && sec.parentElement && sec.parentElement.closest('[data-rv-section]')) sec = sec.parentElement.closest('[data-rv-section]');
    return sec;
  }

  function wire(ifr, onTouch) {
    var doc = ifr.contentDocument, win = ifr.contentWindow;
    if (!doc || !win) return;
    try { win.open = function () { return null; }; } catch (e) { /* the sandbox stops it anyway */ }
    /* links: a click is left to the site's own code first (a photo in a link to its file opens the site's
       pop-up, as on the preview) and stopped last of all, below; a middle click is stopped here */
    function guard(e, links) {
      var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      if (!t || !t.closest) return;
      var a = links ? t.closest('a[href], area[href]') : null;
      if (a) {
        var href = a.getAttribute('href') || '';
        // only a jump within this page stays a link; everything else would leave the editor
        if (!/^#./.test(href) || (a.getAttribute('target') && a.getAttribute('target') !== '_self')) e.preventDefault();
      }
      var control = t.closest('button, input');
      if (control && control.form && (control.type === 'submit' || control.type === 'image')) e.preventDefault();
    }
    doc.addEventListener('click', function (e) {
      guard(e, false);
      if (e.button) return;
      var sec = sectionAt(e.target);
      if (sec) pick(keyOf(sec), e.clientY);
    }, true);
    doc.addEventListener('auxclick', function (e) { guard(e, true); }, true);
    /* Last of all, every link the site's own code has not dealt with is stopped: one to another page would take
       the live view away, and the browser must not follow even "#name" itself — the live view's address is
       about:srcdoc, whose links resolve against the editor's own address, so it would load the whole editor
       inside the live view. A link within the page is followed here instead (a Register button, a name the
       runtime cannot find, a hidden section). */
    win.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      var a = t && t.closest ? t.closest('a[href], area[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      e.preventDefault();
      if (href.charAt(0) !== '#' || href.length < 2) return;
      // the site's own way there first (it clears the site's bar at the top), then a plain jump
      try { if (win.RevampSections && win.RevampSections.goTo && win.RevampSections.goTo(href)) return; } catch (err) { /* below */ }
      var name = href.slice(1);
      try { name = decodeURIComponent(name); } catch (err) { /* taken as written */ }
      var el = doc.getElementById(name) || doc.getElementsByName(name)[0];
      if (el) el.scrollIntoView({ block: 'start' });
    });
    doc.addEventListener('submit', function (e) { e.preventDefault(); }, true);
    doc.addEventListener('mousemove', function (e) {
      var sec = sectionAt(e.target), key = sec ? keyOf(sec) : '';
      if (key !== hoverKey) { hoverKey = key; drawOverlay(); }
    }, { passive: true });
    doc.addEventListener('mouseleave', function () { hoverKey = ''; drawOverlay(); });
    doc.addEventListener('focusin', function (e) {
      var sec = sectionAt(e.target);
      hoverKey = sec ? keyOf(sec) : '';
      drawOverlay();
    });
    doc.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      var k = String(e.key || '').toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); UI.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); UI.redo(); }
      else if (k === 's' && !e.shiftKey && !e.altKey) {
        // Save, as everywhere else in the editor — never the browser's "Save page as" of the live view
        e.preventDefault();
        var save = document.getElementById('btn-save');
        if (save && !save.hidden && !save.disabled) save.click();
      }
    });
    /* Should the live view still be about to load another document (a script setting location, a handler
       that stopped the click above from being seen), the frame is taken away the moment its page goes —
       before anything that page would load could run — and the site drawn again. */
    win.addEventListener('pagehide', function () {
      if (leaving || ifr.rvDropped || mode !== 'ai' || current !== ifr || !ifr.isConnected) return;
      var place = null;
      try { place = placeIn(doc); } catch (err) { place = null; }
      current = null;
      drop(ifr);
      render(place);
    });
    win.addEventListener('scroll', function () { drawOverlay(); }, { passive: true });
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) { win.addEventListener(type, onTouch, { passive: true, once: true }); });
  }

  /* the chat's selected section, as long as the chat still takes its messages to be about it */
  function referenceKey() {
    var chip = document.querySelector('#panel-chat .chat-focus');
    if (chip && chip.hidden) return '';
    var list = UI.listSections ? UI.listSections() : [];
    for (var i = 0; i < list.length; i++) if (list[i].current) return list[i].key || '';
    return '';
  }
  function referenceName(key) {
    var list = UI.listSections ? UI.listSections() : [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].name || key;
    return key;
  }

  function placeBox(box, sec) {
    if (!sec || !current) { box.hidden = true; return; }
    var bar = barHeight(current.contentWindow, sec) * scale;      // the site's nav that stays at the top
    var r = sec.getBoundingClientRect();
    var left = (parseFloat(current.style.left) || 0);
    var vw = viewport.clientWidth, vh = viewport.clientHeight;
    var top = r.top * scale, height = r.height * scale;
    var visTop = Math.max(0, top), visBottom = Math.min(vh, top + height);
    if (visBottom - visTop < 8) { box.hidden = true; return; }
    box.hidden = false;
    box.style.left = (left + r.left * scale) + 'px';
    box.style.width = Math.min(vw, r.width * scale) + 'px';
    box.style.top = top + 'px';
    box.style.height = height + 'px';
    // the tag stays in sight, below the site's own bar, while the section's top is scrolled past
    var tag = box.firstChild;
    if (tag) tag.style.top = Math.max(8, bar + 8 - top) + 'px';
  }

  function drawOverlay() {
    if (overlayFrame) return;
    overlayFrame = requestAnimationFrame(function () {
      overlayFrame = 0;
      if (!layer || mode !== 'ai') return;
      var doc = current && current.contentDocument;
      var ref = referenceKey();
      var refSec = doc && ref ? byKey(doc, ref) : null;
      if (refSec) pickBox.firstChild.textContent = 'ETB2B AI: ' + referenceName(ref);
      placeBox(pickBox, refSec);
      placeBox(hoverBox, doc && hoverKey && hoverKey !== ref ? byKey(doc, hoverKey) : null);
    });
  }

  /* a click on a section in the live view: it becomes the chat's selected section, and the chat opens for the
     question. y: where on the page (the frame's own window) it was clicked */
  function pick(key, y) {
    var c = UI.canvas();
    var sec = c && key ? c.sectionByKey(key) : null;
    if (!sec) return;
    UI.selectSection(sec);         // the same reference a click on the canvas gives; brings it into view there too
    var chat = document.getElementById('panel-chat');
    if (chat && chat.hidden) {
      var launcher = document.getElementById('chat-launcher');
      if (launcher) launcher.click();
      /* on a phone the chat takes the bottom of the window and the live view the rest: what was tapped is
         brought up into the part still showing */
      var win = current && current.contentWindow;
      if (narrow() && win && typeof y === 'number') {
        requestAnimationFrame(function () {
          var room = viewport.clientHeight / scale;
          if (y > room - 48) win.scrollBy(0, y - room / 3);
        });
      }
    } else if (chat) {
      var box = document.getElementById('chat-input');
      if (box) { try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); } }
    }
    drawOverlay();
  }

  /* ---------- switching ---------- */
  function canvasPlace(c) { return placeIn(c && c.doc); }

  function setMode(next, opts) {
    opts = opts || {};
    if (next !== 'ai' && next !== 'manual') return;
    var c = UI && UI.canvas();
    if (!isReady || !c) return;
    if (next === mode) {
      if (next === 'ai' && opts.section) {
        if (!goToPlace(current && current.contentWindow, { key: opts.section, frac: 0 })) render({ key: opts.section, frac: 0 });
      }
      return;
    }
    if (next === 'ai') {
      UI.leaveEditing();               // what is being typed is recorded; the selected section stays the chat's reference
      var place = opts.section ? { key: opts.section, frac: 0 } : canvasPlace(c);
      mode = 'ai';
      document.body.classList.add('ed-mode-ai');
      layer.hidden = false;
      fitAll();
      render(place);
      var chat = document.getElementById('panel-chat');
      if (chat && chat.hidden && !narrow() && opts.openChat !== false) {
        var launcher = document.getElementById('chat-launcher');
        if (launcher) launcher.click();
      }
    } else {
      var at = placeIn(current && current.contentDocument);
      mode = 'manual';
      renderSeq++;                     // a live view still on its way is not shown
      clearTimeout(renderTimer);
      document.body.classList.remove('ed-mode-ai');
      layer.hidden = true;
      if (current) { drop(current); current = null; }
      Array.prototype.forEach.call(viewport.querySelectorAll('iframe'), drop);
      setStatus('');
      hoverKey = '';
      // once the canvas has its room back and has been fitted to it
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        var cc = UI.canvas();
        if (cc) { cc.fit(); goToPlace(cc.win, at); }
        window.dispatchEvent(new Event('resize'));
      }); });
    }
    if (!opts.keep) remember(mode);
    drawToggle();
  }

  function ready() {
    if (isReady) return;
    UI = window.RevampTemplateUI;
    if (!UI || !UI.canvas || !UI.canvas()) return;
    isReady = true;
    buildLayer();
    buildToggle();
    UI.onChange(function () { if (mode === 'ai') scheduleRender(); });
    // the chat's selected section shown on the live view follows the chip (picked, dismissed, replaced)
    var chip = document.querySelector('#panel-chat .chat-focus');
    if (chip && window.MutationObserver) new MutationObserver(drawOverlay).observe(chip, { attributes: true, childList: true, subtree: true, characterData: true });
    // on a phone the open chat takes the bottom of the window: the live view keeps the rest
    var chat = document.getElementById('panel-chat');
    function chatOpen() { document.body.classList.toggle('ai-chat-open', !!chat && !chat.hidden); fitAll(); drawOverlay(); }
    if (chat && window.MutationObserver) new MutationObserver(chatOpen).observe(chat, { attributes: true, attributeFilter: ['hidden'] });
    chatOpen();

    var asked = qs.get('mode'), section = qs.get('section') || '';
    if (asked || section) {
      // read once: a reload afterwards opens in the mode last chosen
      var url = new URL(location.href);
      url.searchParams.delete('mode'); url.searchParams.delete('section');
      try { history.replaceState(history.state, '', url.href); } catch (e) { /* the address stays as it is */ }
    }
    var start = asked === 'ai' || asked === 'manual' ? asked : remembered() || 'manual';
    // an address or the preview's button opens a mode for this visit; the mode remembered is the one last chosen
    if (start === 'ai') setMode('ai', { section: section, keep: true });
    else if (section) {
      var c = UI.canvas(), sec = c.sectionByKey(section);
      if (sec) c.scrollToSection(sec);
    }
  }

  window.RevampEditorMode = {
    ready: ready,
    mode: function () { return mode; },
    setMode: setMode,
    eventId: function () { return EVENT_ID; },
    openAt: function (section) {
      if (!isReady) return false;
      /* called from the preview's tab, which closes straight after: the work is done on this page's own
         clock, not inside the other page's click */
      setTimeout(function () { setMode('ai', { section: String(section || ''), keep: true }); }, 0);
      return true;
    }
  };
})();
