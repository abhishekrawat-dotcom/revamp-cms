/* Pop-ups of a published or previewed site: a speaker's profile, and a gallery's photos one by one, large.

   Loaded by the page's runtime block (functions/lib/api.js publishTransform), so only on /preview/… and the
   live page — never in the editor, where a click picks an element to edit. A page that still has
   <html data-rv-editing> does nothing either. Plain ES5, no dependencies. Nothing it adds is saved with the page.

   Speaker profile
     A card holding <template data-rv-profile> (prev-sections.js for the previous edition's speakers; the editor
     for the event's own Content › Speakers records) opens a dialog: the card's photo, name, role and company,
     and from the template the speaker's text, LinkedIn / X profile, the company's logo and the sessions they
     speak or spoke in. A card whose template holds none of text, profile or sessions does not open — there
     would be nothing more to show than the card itself. Where things are read from:
       name      [data-rv-profile-name] | [data-rv-field="n"] | the card's first h2–h5 | the photo's alt
       role      [data-rv-profile-role] | [data-rv-field="r"]
       company   [data-rv-profile-co]   | [data-rv-field="c"]
       group     [data-rv-profile-group]
       photo     [data-rv-field="photo"] | the card's first <img>
       template  [data-rv-profile-bio] (one or more), a[data-rv-profile-li], a[data-rv-profile-x],
                 img[data-rv-profile-logo], [data-rv-profile-sessions-title], [data-rv-profile-session] each with
                 [data-rv-profile-when] and [data-rv-profile-title]; [data-rv-profile-for] names whose profile it
                 is, and a card whose own name is another (copied and renamed in the editor) does not open
     The card becomes a button (focusable, Enter / Space) with a small "View profile" line.

   Photo galleries
     Any photo in a gallery opens large, with previous / next (buttons, ← →, a swipe), "3 / 24", and the
     neighbours loaded ahead. A gallery is: an element marked data-rv-lightbox; the previous edition's glimpses
     ([data-rv-section="previous-glimpses"]); the editor's Gallery section ([data-rv-auto="glimpses"]); the list
     an AI-written section draws the event's Gallery records into (data-rv-repeat-template / data-rv-item
     "glimpses"); and an AI-written section that is plainly a gallery — named glimpses / gallery / moments /
     photos, not speakers' or partners', with at least three photos. A carousel that repeats its photos (a
     marquee) counts each photo once, and the photo clicked is the one shown.

   While a pop-up is open: the page does not scroll, <html> carries data-rv-modal (et-runtime.js's carousels hold
   still), everything else on the page is inert, Tab stays inside, Escape / the close button / a click outside
   closes it, and focus goes back to what opened it. Text is only ever set as text; a link is kept only on
   https. Colours and fonts are the page's variables, so a theme reaches the profile too. */
(function () {
  'use strict';
  var doc = document, html = doc.documentElement;
  if (window.__rvPopups) return;
  window.__rvPopups = true;

  function editing() { return html.hasAttribute('data-rv-editing'); }
  function each(list, fn) { Array.prototype.forEach.call(list || [], fn); }
  function textOf(el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function first(scope, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = scope.querySelector(selectors[i]);
      if (el && textOf(el)) return el;
    }
    return null;
  }
  /* a picture's address the page may show: https, this host's own, or (for a photo the page already shows) http */
  function pictureUrl(u, pageShown) {
    u = String(u || '').trim();
    if (/^https:\/\/[^\s"'<>]+$/i.test(u) || /^\/(?!\/)[^\s"'<>]*$/.test(u)) return u;
    if (pageShown && (/^http:\/\/[^\s"'<>]+$/i.test(u) || /^data:image\//i.test(u))) return u;
    return '';
  }
  function httpsLink(u) { u = String(u || '').trim(); return /^https:\/\/[^\s"'<>\\]+$/i.test(u) ? u : ''; }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(path, size) {
    var NS = 'http://www.w3.org/2000/svg', s = doc.createElementNS(NS, 'svg'), p = doc.createElementNS(NS, 'path');
    s.setAttribute('width', size || 22); s.setAttribute('height', size || 22); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    p.setAttribute('d', path); s.appendChild(p);
    return s;
  }
  var ICON = { close: 'M6 6l12 12M18 6L6 18', prev: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7', out: 'M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4' };

  /* ---------- styles: travel with the script, written in the page's variables ---------- */
  var CSS = [
    '[data-rv-profile-ready]{cursor:pointer}',
    '[data-rv-profile-ready]:focus-visible,[data-rv-lightbox-photo]:focus-visible{outline:3px solid var(--theme-color,#186bf9);outline-offset:3px}',
    '.rv-profile-cue{display:inline-flex;align-items:center;gap:4px;margin-top:10px;font-family:var(--body-font-family,inherit);font-size:.8125rem;font-weight:700;letter-spacing:.02em;line-height:1.3;color:var(--theme-color,#186bf9);color:color-mix(in srgb,var(--theme-color,#186bf9) 62%,var(--rv-text,#16181d));transition:gap .2s ease}',
    '.rv-profile-cue svg{width:14px;height:14px}',
    '[data-rv-profile-ready]:hover .rv-profile-cue,[data-rv-profile-ready]:focus-visible .rv-profile-cue{gap:7px;text-decoration:underline;text-underline-offset:3px}',
    '[data-rv-lightbox-photo]{cursor:zoom-in}',
    'html[data-rv-modal],html[data-rv-modal] body{overflow:hidden!important}',
    '.rv-pop{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(10,12,16,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;transition:opacity .2s ease;--rv-keep:1}',
    '.rv-pop.rv-open{opacity:1}',
    '.rv-pop[hidden]{display:none}',
    '.rv-pop-panel{position:relative;box-sizing:border-box;width:min(880px,100%);max-height:min(88vh,760px);overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:var(--rv-surface,#ffffff);color:var(--rv-text,#16181d);border-radius:var(--rv-radius,14px);box-shadow:0 30px 80px rgba(0,0,0,.35);font-family:var(--body-font-family,Arial,sans-serif);transform:translateY(12px);transition:transform .25s ease}',
    '.rv-pop.rv-open .rv-pop-panel{transform:none}',
    '.rv-pop-body{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:32px;padding:32px}',
    '.rv-pop-ph{margin:0;aspect-ratio:1/1;border-radius:calc(var(--rv-radius,14px) * .8);overflow:hidden;background:var(--rv-bg,#eef0f3)}',
    '.rv-pop-ph img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}',
    '.rv-pop-ph[hidden]{display:none}',
    '.rv-pop-body.rv-no-photo{grid-template-columns:minmax(0,1fr)}',
    '.rv-pop-info{min-width:0;padding-right:28px}',
    '.rv-pop-group{margin:0 0 8px;font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--theme-color,#186bf9);color:color-mix(in srgb,var(--theme-color,#186bf9) 62%,var(--rv-text,#16181d))}',
    '.rv-pop-name{margin:0;font-family:var(--heading-font-family,inherit);font-size:clamp(1.5rem,2.4vw,2rem);line-height:1.15;color:var(--rv-text,#16181d);overflow-wrap:anywhere}',
    '.rv-pop-role{margin:10px 0 0;font-size:1rem;line-height:1.5;color:var(--rv-muted,#5b6270)}',
    '.rv-pop-co{display:flex;align-items:center;gap:12px;margin:6px 0 0;font-size:1rem;line-height:1.5;font-weight:700;color:var(--rv-text,#16181d)}',
    '.rv-pop-logo{--rv-keep:1;flex:0 0 auto;box-sizing:border-box;height:40px;max-width:120px;padding:5px 8px;background:#ffffff;border-radius:6px;box-shadow:0 0 0 1px rgba(0,0,0,.08);object-fit:contain}',
    '.rv-pop-links{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 0}',
    '.rv-pop-link{display:inline-flex;align-items:center;gap:8px;min-height:44px;box-sizing:border-box;padding:0 16px;border-radius:999px;border:1.5px solid var(--theme-color,#186bf9);color:var(--theme-color,#186bf9);font-weight:700;font-size:.9375rem;text-decoration:none}',
    '.rv-pop-link:hover{background:var(--theme-color,#186bf9);color:var(--rv-surface,#ffffff)}',
    '.rv-pop-link svg{width:16px;height:16px}',
    '.rv-pop-bio{margin:22px 0 0}',
    '.rv-pop-bio p{margin:0 0 12px;font-size:1rem;line-height:1.7;color:var(--rv-text,#16181d)}',
    '.rv-pop-sh{margin:26px 0 10px;padding-top:18px;border-top:1px solid color-mix(in srgb,var(--rv-text,#16181d) 14%,transparent);font-family:var(--heading-font-family,inherit);font-size:.875rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--rv-muted,#5b6270)}',
    '.rv-pop-sessions{list-style:none;margin:0;padding:0}',
    '.rv-pop-sessions li{padding:12px 0;border-bottom:1px solid color-mix(in srgb,var(--rv-text,#16181d) 10%,transparent)}',
    '.rv-pop-sessions li:last-child{border-bottom:0}',
    '.rv-pop-when{display:block;margin:0 0 3px;font-size:.8125rem;font-weight:700;color:var(--theme-color,#186bf9);color:color-mix(in srgb,var(--theme-color,#186bf9) 62%,var(--rv-text,#16181d))}',
    '.rv-pop-title{display:block;font-size:1rem;line-height:1.45;font-weight:600;color:var(--rv-text,#16181d)}',
    '.rv-pop-close{position:absolute;top:12px;right:12px;z-index:2;width:44px;height:44px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;cursor:pointer;background:var(--rv-bg,#f1f2f4);color:var(--rv-text,#16181d)}',
    '.rv-pop-close:focus-visible,.rv-pop-link:focus-visible,.rv-lb button:focus-visible{outline:3px solid var(--theme-color,#186bf9);outline-offset:2px}',
    '@media (max-width:720px){',
    '.rv-pop{padding:0;align-items:stretch}',
    '.rv-pop-panel{width:100%;max-height:none;height:100%;border-radius:0;transform:translateY(24px)}',
    '.rv-pop-body{grid-template-columns:1fr;gap:20px;padding:20px 20px 32px}',
    '.rv-pop-ph{width:min(260px,70%);margin:8px auto 0}',
    '.rv-pop-info{padding-right:0}',
    '.rv-pop-close{position:fixed;top:10px;right:10px;box-shadow:0 2px 10px rgba(0,0,0,.18)}',
    '}',
    /* the gallery: photos on a dark ground in every theme */
    '.rv-lb{--rv-keep:1;position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;background:rgba(8,9,12,.97);color:#ffffff;opacity:0;transition:opacity .2s ease;touch-action:pan-y;font-family:var(--body-font-family,Arial,sans-serif)}',
    '.rv-lb.rv-open{opacity:1}',
    '.rv-lb[hidden]{display:none}',
    '.rv-lb-stage{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;max-width:calc(100vw - 160px);max-height:calc(100vh - 120px)}',
    '.rv-lb-img{display:block;max-width:calc(100vw - 160px);max-height:calc(100vh - 140px);width:auto;height:auto;object-fit:contain;border-radius:6px;box-shadow:0 20px 60px rgba(0,0,0,.5);transition:opacity .2s ease;user-select:none;-webkit-user-drag:none}',
    '.rv-lb-img.rv-loading{opacity:.35}',
    '.rv-lb-cap{margin:0;max-width:720px;text-align:center;font-size:.9375rem;line-height:1.5;color:rgba(255,255,255,.85)}',
    '.rv-lb-cap:empty{display:none}',
    '.rv-lb button{position:absolute;width:52px;height:52px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;cursor:pointer;background:rgba(255,255,255,.14);color:#ffffff;transition:background .2s ease}',
    '.rv-lb button:hover{background:rgba(255,255,255,.26)}',
    '.rv-lb button[hidden]{display:none}',
    '.rv-lb-close{top:16px;right:16px}',
    '.rv-lb-prev{left:20px;top:50%;transform:translateY(-50%)}',
    '.rv-lb-next{right:20px;top:50%;transform:translateY(-50%)}',
    '.rv-lb-count{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);margin:0;padding:6px 14px;border-radius:999px;background:rgba(0,0,0,.45);font-size:.875rem;font-weight:700;letter-spacing:.06em;font-variant-numeric:tabular-nums}',
    '@media (max-width:720px){',
    '.rv-lb-stage,.rv-lb-img{max-width:100vw}',
    '.rv-lb-img{max-height:calc(100vh - 170px);border-radius:0}',
    '.rv-lb-prev,.rv-lb-next{top:auto;bottom:14px;transform:none}',
    '.rv-lb-prev{left:14px}.rv-lb-next{right:14px}',
    '.rv-lb-count{bottom:26px}',
    '.rv-lb-close{top:10px;right:10px}',
    '}',
    '@media (prefers-reduced-motion:reduce){.rv-pop,.rv-pop-panel,.rv-lb,.rv-lb-img,.rv-profile-cue{transition:none}}'
  ].join('\n');
  function addCss() {
    if (doc.querySelector('style[data-rv-popups-css]') || !doc.head) return;
    var st = el('style');
    st.setAttribute('data-rv-popups-css', '');
    st.textContent = CSS;
    doc.head.appendChild(st);
  }

  /* ---------- one pop-up at a time: scroll lock, inert page, focus kept inside, focus given back ---------- */
  var open = null;          // { layer, opener, onKey, inerted, scroll }
  function focusables(layer) {
    return Array.prototype.filter.call(layer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'), function (n) {
      return !n.hidden && n.getClientRects().length > 0;
    });
  }
  function show(layer, opener, onKey, focusFirst) {
    if (open) hide(true);
    var inerted = [];
    each(doc.body.children, function (n) {
      if (n === layer || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.hasAttribute('inert')) return;
      n.setAttribute('inert', ''); inerted.push(n);
    });
    var gap = window.innerWidth - html.clientWidth;
    var scroll = { pad: doc.body.style.paddingRight };
    if (gap > 0) doc.body.style.paddingRight = gap + 'px';
    html.setAttribute('data-rv-modal', '');
    layer.hidden = false;
    // the next frame, so the fade starts from the hidden state
    (window.requestAnimationFrame || setTimeout)(function () { layer.classList.add('rv-open'); });
    open = { layer: layer, opener: opener, onKey: onKey, inerted: inerted, scroll: scroll };
    try { (focusFirst || focusables(layer)[0] || layer).focus({ preventScroll: true }); } catch (e) { /* an old browser */ }
  }
  function hide(quick) {
    if (!open) return;
    var o = open;
    open = null;
    o.layer.classList.remove('rv-open');
    o.layer.hidden = true;
    o.inerted.forEach(function (n) { n.removeAttribute('inert'); });
    doc.body.style.paddingRight = o.scroll.pad;
    html.removeAttribute('data-rv-modal');
    if (!quick && o.opener && o.opener.isConnected) { try { o.opener.focus({ preventScroll: true }); } catch (e) { /* an old browser */ } }
  }
  doc.addEventListener('keydown', function (e) {
    if (!open) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); hide(); return; }
    if (e.key === 'Tab') {
      var list = focusables(open.layer);
      if (!list.length) { e.preventDefault(); return; }
      var at = list.indexOf(doc.activeElement);
      if (e.shiftKey && (at <= 0)) { e.preventDefault(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && (at === -1 || at === list.length - 1)) { e.preventDefault(); list[0].focus(); }
      return;
    }
    if (open.onKey) open.onKey(e);
  }, true);

  /* ---------- the speaker's profile ---------- */
  var pop = null;
  function buildPop() {
    if (pop) return pop;
    var layer = el('div', 'rv-pop');
    layer.hidden = true;
    layer.setAttribute('data-rv-popup', '');
    var panel = el('div', 'rv-pop-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'rv-pop-name');
    panel.tabIndex = -1;
    var close = el('button', 'rv-pop-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.appendChild(svg(ICON.close));
    close.addEventListener('click', function () { hide(); });
    var body = el('div', 'rv-pop-body');
    var ph = el('figure', 'rv-pop-ph'), img = el('img');
    img.alt = '';
    ph.appendChild(img);
    var info = el('div', 'rv-pop-info');
    var parts = {
      group: el('p', 'rv-pop-group'), name: el('h2', 'rv-pop-name'), role: el('p', 'rv-pop-role'), co: el('p', 'rv-pop-co'),
      links: el('div', 'rv-pop-links'), bio: el('div', 'rv-pop-bio'), sh: el('h3', 'rv-pop-sh'), sessions: el('ul', 'rv-pop-sessions')
    };
    parts.name.id = 'rv-pop-name';
    ['group', 'name', 'role', 'co', 'links', 'bio', 'sh', 'sessions'].forEach(function (k) { info.appendChild(parts[k]); });
    body.appendChild(ph); body.appendChild(info);
    panel.appendChild(close); panel.appendChild(body);
    layer.appendChild(panel);
    // a click on the ground around the panel closes it
    layer.addEventListener('click', function (e) { if (e.target === layer) hide(); });
    doc.body.appendChild(layer);
    pop = { layer: layer, panel: panel, body: body, close: close, ph: ph, img: img, parts: parts };
    return pop;
  }

  /* a name as compared: case, spacing and punctuation aside */
  function sameName(s) { return String(s || '').toLowerCase().replace(/[\s.,;:'"\u2018\u2019\u201c\u201d()\-]+/g, ''); }
  /* what a card says about its speaker: its own visible text, and what its <template> holds */
  function profileOf(card) {
    var tpl = card.querySelector('template[data-rv-profile]');
    var t = tpl && tpl.content ? tpl.content : null;
    if (!t) return null;
    var nameEl = first(card, ['[data-rv-profile-name]', '[data-rv-field="n"]', 'h2', 'h3', 'h4', 'h5']);
    var photoEl = card.querySelector('[data-rv-field="photo"]') || card.querySelector('img');
    var photo = '';
    if (photoEl) photo = photoEl.tagName === 'IMG' ? (photoEl.currentSrc || photoEl.getAttribute('src') || '') : '';
    var p = {
      name: textOf(nameEl) || (photoEl && photoEl.alt) || '',
      role: textOf(first(card, ['[data-rv-profile-role]', '[data-rv-field="r"]'])),
      company: textOf(first(card, ['[data-rv-profile-co]', '[data-rv-field="c"]'])),
      group: textOf(card.querySelector('[data-rv-profile-group]')),
      photo: pictureUrl(photo, true),
      bio: [], links: [], logo: '', sessionsTitle: '', sessions: []
    };
    each(t.querySelectorAll('[data-rv-profile-bio]'), function (b) {
      // a paragraph per line the text was written in
      String(b.textContent || '').split(/\n\s*\n|\r?\n/).forEach(function (line) { line = line.replace(/\s+/g, ' ').trim(); if (line) p.bio.push(line); });
    });
    var li = t.querySelector('a[data-rv-profile-li]'), x = t.querySelector('a[data-rv-profile-x]');
    if (li && httpsLink(li.getAttribute('href'))) p.links.push({ href: httpsLink(li.getAttribute('href')), label: textOf(li) || 'LinkedIn', what: 'LinkedIn' });
    if (x && httpsLink(x.getAttribute('href'))) p.links.push({ href: httpsLink(x.getAttribute('href')), label: textOf(x) || 'X', what: 'X' });
    var logo = t.querySelector('img[data-rv-profile-logo]');
    if (logo) p.logo = pictureUrl(logo.getAttribute('src'), false);
    p.sessionsTitle = textOf(t.querySelector('[data-rv-profile-sessions-title]'));
    each(t.querySelectorAll('[data-rv-profile-session]'), function (s) {
      var title = textOf(s.querySelector('[data-rv-profile-title]')) || textOf(s);
      if (title) p.sessions.push({ when: textOf(s.querySelector('[data-rv-profile-when]')), title: title });
    });
    p.more = !!(p.bio.length || p.links.length || p.sessions.length);
    // a profile names whose it is: a card copied and renamed in the editor keeps the <template> it was copied
    // with, and must not show that speaker's sessions and links under another name
    var owner = t.querySelector('[data-rv-profile-for]');
    if (owner && sameName(textOf(owner)) !== sameName(p.name)) return null;
    return p.name ? p : null;
  }

  function openProfile(card) {
    var p = profileOf(card);
    if (!p || !p.more) return;
    var u = buildPop(), parts = u.parts;
    u.ph.hidden = !p.photo;
    u.body.classList.toggle('rv-no-photo', !p.photo);
    u.img.removeAttribute('src');
    if (p.photo) { u.img.src = p.photo; u.img.alt = p.name; }
    parts.group.textContent = p.group; parts.group.hidden = !p.group;
    parts.name.textContent = p.name;
    parts.role.textContent = p.role; parts.role.hidden = !p.role;
    parts.co.textContent = '';
    if (p.logo) {
      var logo = el('img', 'rv-pop-logo');
      logo.alt = p.company ? p.company + ' logo' : 'Company logo';
      logo.addEventListener('error', function () { logo.remove(); });
      logo.src = p.logo;
      parts.co.appendChild(logo);
    }
    if (p.company) parts.co.appendChild(el('span', '', p.company));
    parts.co.hidden = !p.company && !p.logo;
    parts.links.textContent = '';
    p.links.forEach(function (l) {
      var a = el('a', 'rv-pop-link');
      a.href = l.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(el('span', '', l.label));
      a.appendChild(svg(ICON.out, 16));
      a.setAttribute('aria-label', p.name + ' on ' + l.what + ' (opens in a new tab)');
      parts.links.appendChild(a);
    });
    parts.links.hidden = !p.links.length;
    parts.bio.textContent = '';
    p.bio.forEach(function (line) { parts.bio.appendChild(el('p', '', line)); });
    parts.bio.hidden = !p.bio.length;
    parts.sh.textContent = p.sessionsTitle || (p.sessions.length > 1 ? 'Sessions' : 'Session');
    parts.sh.hidden = !p.sessions.length;
    parts.sessions.textContent = '';
    p.sessions.forEach(function (s) {
      var li = el('li');
      if (s.when) li.appendChild(el('span', 'rv-pop-when', s.when));
      li.appendChild(el('span', 'rv-pop-title', s.title));
      parts.sessions.appendChild(li);
    });
    parts.sessions.hidden = !p.sessions.length;
    u.panel.scrollTop = 0;
    show(u.layer, card, null, u.close);
  }

  function interactive(n, within) {
    for (; n && n !== within; n = n.parentElement) {
      if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY|VIDEO|AUDIO)$/.test(n.tagName) && (n.tagName !== 'A' || n.hasAttribute('href'))) return true;
    }
    return false;
  }
  function markCards(scope) {
    each(scope.querySelectorAll('template[data-rv-profile]'), function (tpl) {
      var card = tpl.parentElement;
      if (!card || card.hasAttribute('data-rv-profile-ready') || card === doc.body) return;
      // a card that is itself a link keeps doing what it does
      if (card.tagName === 'A' || card.tagName === 'BUTTON') return;
      var p = profileOf(card);
      if (!p || !p.more) return;
      card.setAttribute('data-rv-profile-ready', '');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-haspopup', 'dialog');
      /* its name is what it shows — the person's name, role and company, then "View profile" — so a visitor who
         speaks to their screen ("click Asha Rao") reaches it (WCAG 2.5.3); an aria-label of other words would hide it */
      card.removeAttribute('aria-label');
      var cue = el('span', 'rv-profile-cue', 'View profile');
      cue.appendChild(svg(ICON.next, 14));
      card.appendChild(cue);
    });
  }

  /* ---------- the gallery ---------- */
  var NAMED_GALLERY = /glimps|galler|moments|photos?\b|snapshots/i;
  var NOT_GALLERY = /speaker|sponsor|partner|logo|video|award|jury|testimonial|hero|banner|nav|footer|team|people/i;
  var lb = null;

  function isPhoto(img) {
    if (img.closest('template, [data-rv-profile-ready], [data-rv-popup], header, nav')) return false;
    var link = img.closest('a[href]');
    if (link && !/\.(?:jpe?g|png|webp|avif|gif)(?:[?#].*)?$/i.test(link.getAttribute('href') || '')) return false;
    var r = img.getBoundingClientRect();
    return (r.width >= 80 && r.height >= 60) || (img.naturalWidth >= 200 && r.width > 0);
  }
  /* a photo's identity: its address as written, resolved against the page (img.src) — not currentSrc, which is
     '' until a lazy picture loads and then the srcset candidate chosen, so a marquee's copy of a photo would not
     match the one on screen; a placeholder src (data:) with the real address in data-src takes data-src */
  function keyOf(img) {
    var s = img.src || '', ds = img.getAttribute('data-src');
    if (ds && (!s || /^data:/i.test(s))) { try { s = new URL(ds, doc.baseURI).href; } catch (e) { s = ds; } }
    return pictureUrl(s, true);
  }
  /* the address to show it large from: what the browser picked for it, else its own */
  function srcOf(img) {
    var k = keyOf(img), cur = img.currentSrc || '';
    return k && cur && (!/^data:/i.test(cur) || /^data:/i.test(k)) ? pictureUrl(cur, true) || k : k;
  }
  function photosIn(box) {
    var list = [], seen = {};
    each(box.querySelectorAll('img'), function (img) {
      if (!isPhoto(img)) return;
      var key = keyOf(img);
      if (!key || seen[key]) return;
      seen[key] = 1;
      var fig = img.closest('figure');
      var cap = fig ? textOf(fig.querySelector('figcaption')) : '';
      list.push({ key: key, src: srcOf(img), alt: img.getAttribute('alt') || '', caption: cap });
    });
    return list;
  }
  function galleryBoxes() {
    var boxes = [];
    function add(b) { if (b && boxes.indexOf(b) === -1) boxes.push(b); }
    each(doc.querySelectorAll('[data-rv-lightbox], [data-rv-section="previous-glimpses"], [data-rv-auto="glimpses"]'), add);
    each(doc.querySelectorAll('[data-rv-item="glimpses"], [data-rv-repeat-template="glimpses"]'), function (item) { add(item.parentElement); });
    each(doc.querySelectorAll('[data-rv-section]'), function (sec) {
      var name = (sec.getAttribute('data-rv-section') || '') + ' ' + (sec.id || '');
      if (!NAMED_GALLERY.test(name) || NOT_GALLERY.test(name) || sec.querySelector('[data-rv-item="speakers"], [data-rv-repeat-template="speakers"], template[data-rv-profile]')) return;
      if (photosIn(sec).length >= 3) add(sec);
    });
    // the outermost of nested ones
    return boxes.filter(function (b) { return !boxes.some(function (o) { return o !== b && o.contains(b); }); });
  }
  function markGalleries() {
    galleryBoxes().forEach(function (box) {
      box.setAttribute('data-rv-gallery', '');
      var photos = photosIn(box), n = photos.length;
      if (!n) return;
      each(box.querySelectorAll('img'), function (img) {
        if (img.hasAttribute('data-rv-lightbox-photo') || !isPhoto(img) || !keyOf(img)) return;
        img.setAttribute('data-rv-lightbox-photo', '');
        // a photo inside a link to its own file: the link is what is focused, and it opens the photo here
        if (!img.closest('a[href]')) {
          img.setAttribute('tabindex', '0');
          img.setAttribute('role', 'button');
        }
        var at = -1, key = keyOf(img);
        for (var i = 0; i < n; i++) if (photos[i].key === key) { at = i; break; }
        img.setAttribute('aria-label', 'Open photo ' + (at + 1) + ' of ' + n + ' larger' + (img.alt ? ': ' + img.alt : ''));
      });
    });
  }

  function buildLightbox() {
    if (lb) return lb;
    var layer = el('div', 'rv-lb');
    layer.hidden = true;
    layer.setAttribute('data-rv-popup', '');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'Photos');
    layer.tabIndex = -1;
    var stage = el('figure', 'rv-lb-stage'), img = el('img', 'rv-lb-img'), cap = el('figcaption', 'rv-lb-cap');
    img.alt = '';
    img.draggable = false;
    stage.appendChild(img); stage.appendChild(cap);
    function button(cls, label, icon, fn) {
      var b = el('button', cls);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.appendChild(svg(icon, 26));
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      return b;
    }
    var close = button('rv-lb-close', 'Close', ICON.close, function () { hide(); });
    var prev = button('rv-lb-prev', 'Previous photo', ICON.prev, function () { step(-1); });
    var next = button('rv-lb-next', 'Next photo', ICON.next, function () { step(1); });
    var count = el('p', 'rv-lb-count');
    count.setAttribute('aria-live', 'polite');
    layer.appendChild(stage); layer.appendChild(prev); layer.appendChild(next); layer.appendChild(close); layer.appendChild(count);
    // a click on the dark ground (not the photo) closes it
    layer.addEventListener('click', function (e) { if (e.target === layer || e.target === stage) hide(); });
    img.addEventListener('load', function () { img.classList.remove('rv-loading'); });
    img.addEventListener('error', function () { img.classList.remove('rv-loading'); });
    // a swipe sideways steps; one up or down is left to the page
    var sx = 0, sy = 0, st = 0;
    layer.addEventListener('touchstart', function (e) { var t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
    layer.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - st < 800) step(dx < 0 ? 1 : -1);
    }, { passive: true });
    doc.body.appendChild(layer);
    lb = { layer: layer, img: img, cap: cap, prev: prev, next: next, close: close, count: count, photos: [], at: 0 };
    return lb;
  }
  function preload(u) { if (u) { var im = new Image(); im.decoding = 'async'; im.src = u; } }
  function render() {
    var u = lb, p = u.photos[u.at], n = u.photos.length;
    if (!p) return;
    if (u.img.getAttribute('src') !== p.src) { u.img.classList.add('rv-loading'); u.img.src = p.src; }
    u.img.alt = p.alt || ('Photo ' + (u.at + 1) + ' of ' + n);
    u.cap.textContent = p.caption;
    u.count.textContent = (u.at + 1) + ' / ' + n;
    u.prev.hidden = u.next.hidden = n < 2;
    if (n > 1) { preload(u.photos[(u.at + 1) % n].src); preload(u.photos[(u.at - 1 + n) % n].src); }
  }
  function step(d) {
    if (!lb || lb.photos.length < 2) return;
    lb.at = (lb.at + d + lb.photos.length) % lb.photos.length;
    render();
  }
  function openPhoto(img) {
    var box = img.closest('[data-rv-gallery]');
    if (!box) return false;
    var photos = photosIn(box), key = keyOf(img), at = 0;
    if (!photos.length) return false;
    for (var i = 0; i < photos.length; i++) if (photos[i].key === key) { at = i; break; }
    var u = buildLightbox();
    u.photos = photos; u.at = at;
    render();
    show(u.layer, img.closest('a[href]') || img, function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    }, u.close);
    return true;
  }

  /* ---------- clicks and keys on the page ---------- */
  doc.addEventListener('click', function (e) {
    if (open || editing() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var photo = t.closest('[data-rv-lightbox-photo]'), link = t.closest('a[href]');
    // a photo inside a link to its own file: the click on the link opens it here instead
    if (!photo && link) photo = link.querySelector('[data-rv-lightbox-photo]');
    if (photo && openPhoto(photo)) { e.preventDefault(); return; }
    var card = t.closest('[data-rv-profile-ready]');
    if (card && !interactive(t, card)) { e.preventDefault(); openProfile(card); }
  });
  doc.addEventListener('keydown', function (e) {
    if (open || editing() || (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar')) return;
    var t = e.target;
    if (!t || !t.hasAttribute) return;
    if (t.hasAttribute('data-rv-profile-ready')) { e.preventDefault(); openProfile(t); return; }
    if (t.hasAttribute('data-rv-lightbox-photo') && openPhoto(t)) e.preventDefault();
  });

  function start() {
    if (editing() || !doc.body) return;
    addCss();
    markCards(doc);
    markGalleries();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
  // photos sized only once the stylesheets and pictures are in
  window.addEventListener('load', function () { if (!editing()) markGalleries(); });

  window.RevampPopups = { openProfile: openProfile, openPhoto: openPhoto, close: function () { hide(); }, refresh: start };
})();
