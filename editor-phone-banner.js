/* window.RevampPhoneBanner (ES5; loaded after editor-canvas.js and before editor-dev-export.js and
   editor-template-ui.js) — the banner's own picture for phones.

   The owner, 13 Nov 2026, about the hero copied to ETB2B's own CMS: "A mobile version of hero background banner should
   be there, currently it is blank. (add option to generate mobile banner on the basis of current background banner)".
   A banner is drawn wide, often with its subject at its two edges and open space in the middle for the logo and words.
   A phone shows it in a tall frame (background-size: cover) and keeps only the middle quarter of its width — the open
   space — so the banner looked blank there. Nothing hid it: the picture was cut to the frame.

   ON THE PAGE. The banner's background element (canvas.backgroundHost of the banner section) carries the phone
   picture's address, and the section holds the one rule that shows it on phones, in screens up to 767px wide (ETB2B's
   own phone width, and the banner video's):
       <section data-rv-section="hero" … data-rv-phone-banner="https://…/phone.png" style="background-image:…">
         … <style data-rv-phone-banner-css>@media (max-width: 767px){[data-rv-phone-banner="https://…/phone.png"]{
               background-image:url("https://…/phone.png") !important;background-size:cover !important;
               background-position:center !important}}</style>
   The rule is keyed by the address, so a duplicated banner keeps its own. Without a phone banner nothing is there, and
   phones show the banner's own picture as before — never nothing. It is saved, previewed, published and undone with
   the page like every other picture; publishing gives it its WebP copy and preloads it for phones only, and the
   banner's own picture for larger screens only (functions/lib/pictures.js). A new banner picture (Background picture,
   or ETB2B AI's) takes the phone banner made for the old one away with it (canvas.setBackgroundPicture -> drop()).

   IN THE EDITOR. The banner section's toolbar has "Phone banner" beside "Background picture": the two pictures side
   by side as computers and phones show them, a switch for a separate phone banner, and beside each other the way made
   by ETB2B AI — "Generate from the current banner" (POST /api/event/phone-banner, functions/lib/phone-banner.js: the
   banner laid out again for a tall screen, its look and subject kept) — and the owner's own: "Upload", "Remove".
   Each change is one step that Undo takes back.

   IN "COPY FOR ANOTHER WEBSITE" (editor-dev-export.js build -> forCopy): every declaration there is !important, an
   inline one too, and an inline !important outweighs every rule — so the banner's own picture moves from its style
   attribute into the section's CSS, and the phone picture follows it in a max-width media query, both under a
   selector that outweighs the section's own rules; the banner's preload is for larger screens, and the phone
   picture's for phones.

     RevampPhoneBanner.isBanner(sec)          -> true for the page's banner (its hero, its banner, or the section of its h1)
     RevampPhoneBanner.hostFor(sec, canvas)   -> the element whose background picture the banner shows, or null (none,
                                              or a full-bleed <img> painted over it)
     RevampPhoneBanner.read(sec)              -> { host, url } of its phone banner, or null
     RevampPhoneBanner.set(sec, host, url)    -> true when it is on the page (url: an https address)
     RevampPhoneBanner.remove(sec)            -> true when there was one
     RevampPhoneBanner.drop(el)               el's banner picture is being replaced: its phone banner goes (-> true if one did)
     RevampPhoneBanner.desktopUrl(host, win)  -> the banner's own picture (what larger screens show), '' if none
     RevampPhoneBanner.open(o)                the dialog; o: { sec, canvas, eventId, openDialog, showToast, offerUndo,
                                              before() (what is pending becomes its own step), commit() (the change, one step),
                                              busy() (ETB2B AI is changing the page), busyLine, uploadImage(eventId, kind, file),
                                              authedFetch, videoOn }
     RevampPhoneBanner.forCopy(sec, copy, o)  -> the CSS the copy needs for it ('' none); o: { cls, scope }
     RevampPhoneBanner._test                  the pure helpers (functions/lib/phone-banner-editor.test.js) */
(function (root) {
  'use strict';

  var MEDIA = '(max-width: 767px)', WIDE = '(min-width: 768px)';
  var ATTR = 'data-rv-phone-banner', CSS_ATTR = 'data-rv-phone-banner-css';
  var KIND = 'banner';                 // where an upload is kept (edit-event-core.js uploadImage: events/<id>/banner/)
  var WAIT_MS = 240000;                // a picture being made is waited for this long (two pictures and their checks)

  /* ---------- pure helpers ---------- */

  /* an address that can sit in a url() and an attribute as it is: https, nothing that could end either early */
  function usableUrl(url) { return /^https:\/\/[^\s"'()<>\\]{1,2000}$/.test(String(url || '')); }
  /* a CSS string ("…") of text that may hold anything */
  function cssString(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\f]/g, ' ') + '"'; }
  function selectorFor(url) { return '[' + ATTR + '=' + cssString(url) + ']'; }
  /* the page's rule for a phone banner at url */
  function pageCss(url) {
    return '@media ' + MEDIA + '{' + selectorFor(url) + '{background-image:url(' + cssString(url) + ') !important;background-size:cover !important;background-position:center !important}}';
  }
  /* text split at ";" where it is not inside () or a string */
  function declarations(text) {
    var out = [], cur = '', depth = 0, quote = '', i, c;
    text = String(text || '');
    for (i = 0; i < text.length; i++) {
      c = text.charAt(i);
      if (quote) { cur += c; if (c === '\\' && i + 1 < text.length) cur += text.charAt(++i); else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === '(') depth++; else if (c === ')') depth--;
      if (c === ';' && depth <= 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function importantAll(list) {
    return list.map(function (d) { return /!\s*important\s*$/i.test(d) ? d.replace(/\s*!\s*important\s*$/i, ' !important') : d + ' !important'; });
  }
  /* the declarations of the rule a phone banner's <style> holds (as the page has it: after publishing, with the
     image-set() of its WebP copy), every one !important; '' when it holds none */
  function declsOf(text) {
    var t = String(text || '').replace(/\/\*[\s\S]*?\*\//g, ''), end = t.indexOf('}');
    if (end === -1) return '';
    var start = t.lastIndexOf('{', end);
    if (start === -1) return '';
    var list = declarations(t.slice(start + 1, end)).filter(function (d) { return d.indexOf(':') > 0; });
    return list.length ? importantAll(list).join('; ') + ';' : '';
  }
  /* a style attribute's declarations split into the background picture's (background / background-image with a
     picture in it) and the rest -> { background, kept } (each '' or ';'-ended) */
  function splitInline(style) {
    var bg = [], kept = [];
    declarations(style).forEach(function (d) {
      var name = d.split(':')[0].trim().toLowerCase();
      if ((name === 'background-image' || name === 'background') && /url\(|image-set\(/i.test(d)) bg.push(d); else kept.push(d);
    });
    return { background: bg.length ? importantAll(bg).join('; ') + ';' : '', kept: kept.length ? kept.join('; ') + ';' : '' };
  }
  /* The copy's selector for the banner's background element: the section's id, its class three times, the mark
     and the scope's weight (.rv-embed and four ids) — more than any rule of the section's own, which the copy
     writes with the scope and at most a few classes — and, for an element inside the section, the mark on it. */
  function copySelector(id, cls, scope, hostIsSection) {
    var sec = (id ? '#' + String(id).replace(/[^\w-]/g, '\\$&') : '') + (cls ? new Array(4).join('.' + cls) : '');
    var mark = '[' + ATTR + ']';
    return hostIsSection ? sec + mark + scope : sec + scope + ' ' + mark;
  }
  /* the copy's CSS: the banner's own picture (moved from its style attribute, when it was there) and the phone's */
  function copyCss(sel, desktop, phone) {
    var out = ['', '/* the banner\u2019s own picture for phones (EventSphere \u203a Phone banner), on screens up to 767px wide' +
      (desktop ? '; the banner\u2019s picture for larger screens is here too, so the phone\u2019s can take its place' : '') + ' */'];
    if (desktop) out.push(sel + ' { ' + desktop + ' }');
    out.push('@media ' + MEDIA + ' {', sel + ' { ' + phone + ' }', '}');
    return out.join('\n');
  }
  /* the address a browser takes from declarations: the WebP in an image-set() where there is one, else the first url() */
  function pictureOf(decls) {
    var webp = /image-set\([\s\S]*?url\(\s*['"]?([^'")]+)['"]?\s*\)\s*type\(\s*['"]image\/webp['"]\s*\)/i.exec(decls || '');
    if (webp) return { href: webp[1], webp: true };
    var m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(decls || '');
    return m ? { href: m[1], webp: false } : null;
  }

  /* ---------- the page ---------- */

  function sectionOf(el) { return el && el.closest ? el.closest('[data-rv-section]') : null; }
  function isBanner(sec) {
    if (!sec || !sec.getAttribute) return false;
    return /^(hero|banner)$/i.test(sec.getAttribute('data-rv-section') || '') || !!sec.querySelector('h1');
  }
  function hostIn(sec) { return !sec ? null : sec.hasAttribute(ATTR) ? sec : sec.querySelector('[' + ATTR + ']'); }
  function styleIn(sec) { return sec ? sec.querySelector('style[' + CSS_ATTR + ']') : null; }
  function read(sec) {
    var host = hostIn(sec), url = host ? host.getAttribute(ATTR) : '';
    return host && usableUrl(url) && styleIn(sec) ? { host: host, url: url } : null;
  }
  /* The element whose background picture the banner shows: canvas.backgroundHost — unless a picture (<img>) covering
     half the banner or more is painted over it (a real template's img.banner-bg-image), which is then what visitors
     see and a phone picture under it never would be (editor-ai-picture.js heroSpot reads the banner the same way). */
  function hostFor(sec, canvas) {
    var now = read(sec);
    if (now) return now.host;
    var host = canvas && canvas.backgroundHost ? canvas.backgroundHost(sec) : null;
    if (!host) return null;
    var whole = sec.getBoundingClientRect(), area = whole.width * whole.height;
    var covered = Array.prototype.some.call(sec.querySelectorAll('img'), function (img) {
      if (img.closest('[data-rv-editor]') || !(host === img || host.contains(img))) return false;
      var r = img.getBoundingClientRect();
      return area > 0 && r.width * r.height >= area * 0.5;
    });
    return covered ? null : host;
  }
  function remove(sec) {
    if (!sec) return false;
    var had = !!read(sec);
    Array.prototype.slice.call(sec.querySelectorAll('[' + ATTR + ']')).concat(sec.hasAttribute(ATTR) ? [sec] : []).forEach(function (el) { el.removeAttribute(ATTR); });
    Array.prototype.slice.call(sec.querySelectorAll('style[' + CSS_ATTR + ']')).forEach(function (st) { st.parentNode.removeChild(st); });
    return had;
  }
  function set(sec, host, url) {
    if (!sec || !host || !usableUrl(url) || !(host === sec || sec.contains(host))) return false;
    remove(sec);
    host.setAttribute(ATTR, url);
    var st = sec.ownerDocument.createElement('style');
    st.setAttribute(CSS_ATTR, '');
    st.textContent = pageCss(url);
    sec.appendChild(st);                // last: no :first-child of the section's own counts it
    return true;
  }
  function drop(el) {
    if (!el || !el.hasAttribute || !el.hasAttribute(ATTR)) return false;
    var sec = sectionOf(el) || el;
    remove(sec);
    el.removeAttribute(ATTR);
    return true;
  }
  /* What larger screens show: the background element's own picture. On a phone-width canvas its computed picture is
     the phone's, so the phone rule is switched off while it is read (a sheet switched off is not a change to the page). */
  function firstUrl(text) {
    var m = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(String(text || ''));
    return m && !/^data:/i.test(m[2]) ? m[2] : '';
  }
  function desktopUrl(host, win) {
    if (!host) return '';
    var own = firstUrl(host.style && host.style.backgroundImage);
    if (own) return own;
    var sec = sectionOf(host) || host, st = styleIn(sec), sheet = st && st.sheet, was = sheet ? sheet.disabled : false;
    try {
      if (sheet) sheet.disabled = true;
      return firstUrl((win || host.ownerDocument.defaultView).getComputedStyle(host).backgroundImage);
    } catch (e) { return ''; } finally { if (sheet) sheet.disabled = was; }
  }

  /* ---------- "Copy for another website" ---------- */

  function forCopy(sec, copy, o) {
    o = o || {};
    if (!sec || !copy || !copy.getAttribute) return '';
    var host = copy.hasAttribute(ATTR) ? copy : copy.querySelector('[' + ATTR + ']');
    var st = styleIn(sec), phone = st ? declsOf(st.textContent) : '';
    if (!host || !usableUrl(host.getAttribute(ATTR)) || !phone) return '';
    var parts = splitInline(host.getAttribute('style') || '');
    if (parts.kept) host.setAttribute('style', parts.kept); else host.removeAttribute('style');
    // the banner's preload (editor-dev-export.js pictures) is for larger screens; the phone's picture is preloaded for phones
    var link = copy.querySelector('link[rel="preload"][as="image"]'), pic = pictureOf(phone);
    if (link && pic) {
      link.setAttribute('media', WIDE);
      var p = copy.ownerDocument.createElement('link');
      p.setAttribute('rel', 'preload');
      p.setAttribute('as', 'image');
      p.setAttribute('href', pic.href);
      p.setAttribute('fetchpriority', 'high');
      if (pic.webp) p.setAttribute('type', 'image/webp');
      p.setAttribute('media', MEDIA);
      link.parentNode.insertBefore(p, link.nextSibling);
    }
    return copyCss(copySelector(copy.id, o.cls, o.scope || '', host === copy), parts.background, phone);
  }

  /* ---------- the dialog ---------- */

  var STYLE_ID = 'rv-pb-style';
  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.pb-lead{margin:0 0 12px;font-size:13px;line-height:1.5;color:var(--text-muted)}',
      '.pb-look{display:flex;align-items:flex-end;gap:16px;margin:0 0 14px}',
      '.pb-fig{margin:0;display:flex;flex-direction:column;gap:6px;align-items:flex-start}',
      '.pb-fig figcaption{font-size:12px;color:var(--text-muted)}',
      '.pb-shot{display:block;border:1px solid var(--border);border-radius:6px;background:var(--surface-2) center/cover no-repeat}',
      '.pb-desk{width:192px;height:108px}',
      '.pb-phone{width:61px;height:108px}',
      '.pb-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--border)}',
      '.pb-row label:first-child{font-size:13px;font-weight:600}',
      '.pb-acts{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 0}',
      '.pb-note{margin:10px 0 0;font-size:12px;line-height:1.5;color:var(--text-muted)}',
      '.pb-note:empty{display:none}',
      '.pb-err{margin:8px 0 0;font-size:12px;line-height:1.5;color:var(--crit,#c0392b)}'
    ].join('\n');
    doc.head.appendChild(st);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cssUrlValue(url) { return url ? 'url(' + cssString(url) + ')' : 'none'; }

  /* this event's own picture (where uploads and ETB2B AI's pictures are kept): anything else is not put in */
  function ownPicture(url, eventId, generated) {
    var id = String(eventId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !!eventId && new RegExp('^https://storage\\.googleapis\\.com/[a-z0-9][a-z0-9._-]{1,220}/events/' + id + '/' + (generated ? 'generated/[A-Za-z0-9._-]+' : '[^?#\\s"\'()<>\\\\]+') + '(\\?v=\\d+)?$').test(String(url || ''));
  }

  /* one making per page at a time: the dialog can be closed and opened again while it is made */
  var pending = null;     // { sec, host, source } while ETB2B AI makes one

  function open(o) {
    var sec = o && o.sec, canvas = o && o.canvas;
    if (!sec || !canvas || !o.openDialog) return;
    var doc = document;
    ensureStyle(doc);
    var host = hostFor(sec, canvas);
    if (!host) return;
    var mine = !!(o.eventId && o.uploadImage);
    var handle = o.openDialog({
      title: 'Phone banner',
      bodyHtml:
        '<p class="pb-lead">Phones show the banner in a tall frame, so a wide picture keeps only its middle there. A phone banner is the same picture laid out for a phone.</p>' +
        '<div class="pb-look">' +
          '<figure class="pb-fig"><span class="pb-shot pb-desk" id="pb-desk" role="img" aria-label="The banner on a computer"></span><figcaption>Computers</figcaption></figure>' +
          '<figure class="pb-fig"><span class="pb-shot pb-phone" id="pb-phone" role="img"></span><figcaption id="pb-phone-cap">Phones</figcaption></figure>' +
        '</div>' +
        '<div class="pb-row"><label for="pb-own">A separate banner for phones</label>' +
          '<label class="toggle-sw"><input type="checkbox" id="pb-own"><span class="track"></span></label></div>' +
        '<div class="pb-acts" id="pb-acts" hidden>' +
          '<button type="button" class="btn btn-secondary btn-sm" id="pb-gen" title="ETB2B AI lays the banner you have now out again for a tall screen, keeping its look and subject">&#10024; Generate from the current banner</button>' +
          (mine ? '<button type="button" class="btn btn-secondary btn-sm" id="pb-up">Upload</button>' +
            '<input type="file" id="pb-file" accept="image/png,image/jpeg,image/webp" hidden>' : '') +
          '<button type="button" class="btn btn-ghost btn-sm" id="pb-rm" hidden>Remove</button>' +
        '</div>' +
        '<p class="pb-note" id="pb-note" role="status"></p>' +
        '<p class="pb-err" id="pb-err" role="alert" hidden></p>',
      actions: [{ label: 'Done', kind: 'primary', autofocus: true }]
    });
    var box = handle && handle.el;
    if (!box) return;
    function $(id) { return box.querySelector('#' + id); }
    var own = $('pb-own'), acts = $('pb-acts'), gen = $('pb-gen'), up = $('pb-up'), file = $('pb-file'), rm = $('pb-rm');
    var note = $('pb-note'), problem = $('pb-err'), uploading = false;

    function live() { return sec.isConnected && host.isConnected && (host === sec || sec.contains(host)); }
    function fail(text) { problem.textContent = text; problem.hidden = false; }
    function draw() {
      if (!box.isConnected) return;
      var now = read(sec), desk = desktopUrl(host, canvas.win);
      $('pb-desk').style.backgroundImage = cssUrlValue(desk);
      $('pb-phone').style.backgroundImage = cssUrlValue(now ? now.url : desk);
      $('pb-phone').setAttribute('aria-label', now ? 'The phone banner' : 'The banner as a phone shows it');
      $('pb-phone-cap').textContent = now ? 'Phones: their own banner' : 'Phones: the middle of the banner';
      var making = !!(pending && pending.sec === sec);
      if (now || making) own.checked = true;
      acts.hidden = !own.checked;
      rm.hidden = !now;
      gen.disabled = making || uploading || !desk;
      gen.innerHTML = making ? 'Making the phone banner…' : '&#10024; ' + (now ? 'Generate again from the current banner' : 'Generate from the current banner');
      if (up) up.disabled = making || uploading;
      var lines = [];
      if (making) lines.push('ETB2B AI is laying the banner out for phones. It takes about half a minute; you can close this and go on editing — it goes in when it is ready.');
      else if (!now && o.fresh) lines.push('Your new banner is in. Make its phone version: generate it from this banner, or upload one. Close to let phones show the middle of the banner.');
      else if (!now && own.checked) lines.push('Until you add one, phones show the middle of the banner above.');
      if (!desk) lines.push('The banner has no picture of its own yet: set one in Background picture first.');
      if (o.videoOn) lines.push('Your banner plays a video, so phones show the video’s still picture rather than a phone banner while it is on.');
      note.textContent = lines.join(' ');
    }
    /* a change to the page: one step, with Undo */
    function changed(say) {
      if (o.commit) o.commit();
      if (o.offerUndo) o.offerUndo(say);
      draw();
    }
    function busyNow() {
      if (o.busy && o.busy()) { fail((o.busyLine || 'ETB2B AI is changing the page') + '. Try again when it is done.'); return true; }
      return false;
    }

    own.addEventListener('change', function () {
      problem.hidden = true;
      if (!own.checked && read(sec)) {
        if (busyNow()) { own.checked = true; return; }
        if (o.before) o.before();
        remove(sec);
        changed('Phone banner removed: phones show the banner’s own picture again.');
        return;
      }
      draw();
    });
    rm.addEventListener('click', function () {
      problem.hidden = true;
      if (busyNow() || !read(sec)) return;
      if (o.before) o.before();
      remove(sec);
      own.checked = false;
      changed('Phone banner removed: phones show the banner’s own picture again.');
    });
    if (up) {
      up.addEventListener('click', function () { if (!uploading) file.click(); });
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        file.value = '';
        if (!f || uploading) return;
        problem.hidden = true;
        uploading = true;
        up.textContent = 'Uploading…';
        draw();
        o.uploadImage(o.eventId, KIND, f).then(function (got) {
          uploading = false;
          if (up) up.textContent = 'Upload';
          var url = got && got.url;
          if (!usableUrl(url) || !ownPicture(url, o.eventId, false)) { draw(); return fail('The picture could not be stored. Please try again.'); }
          if (!live()) { draw(); return fail('The banner is no longer on the page.'); }
          if (busyNow()) { draw(); return; }
          if (o.before) o.before();
          set(sec, host, url);
          shapeNote(url);
          changed('Phone banner added: phones show it in place of the banner’s own picture.');
        }, function (err) {
          uploading = false;
          if (up) up.textContent = 'Upload';
          draw();
          fail((err && err.message) || 'The picture could not be uploaded. Please try again.');
        });
      });
    }
    /* an upload wider than it is tall is the same problem again: said, not refused */
    function shapeNote(url) {
      var img = new Image();
      img.onload = function () {
        if (img.naturalWidth > img.naturalHeight && box.isConnected && !problem.textContent) {
          note.textContent = 'This picture is wider than it is tall, so phones show only its middle. A tall picture suits a phone best.';
        }
      };
      img.src = url;
    }
    gen.addEventListener('click', function () {
      problem.hidden = true;
      problem.textContent = '';
      var source = desktopUrl(host, canvas.win);
      if (!usableUrl(source)) return fail('The banner’s picture has no web address ETB2B AI can read. Set the banner’s picture in Background picture, then try again.');
      if (pending || !o.authedFetch) return;
      pending = { sec: sec, host: host, source: source };
      draw();
      makeOne(o, pending).then(function (r) {
        var was = pending;
        pending = null;
        if (r.error) { draw(); if (box.isConnected) fail(r.error); else if (o.showToast) o.showToast(r.error); return; }
        putIn(o, was, r.url, box.isConnected ? null : 'toast').then(function (said) {
          if (said && box.isConnected) fail(said);
          draw();
        });
      });
    });
    // opened for a new banner: the switch on, Generate and Upload in view
    if (o.fresh) own.checked = true;
    draw();
  }

  /* POST /api/event/phone-banner -> Promise<{ url } | { error }> (never rejects); a 409 (one is being made on the
     server for this event) is asked again every few seconds for a while */
  function makeOne(o, job) {
    var since = Date.now();
    function once() {
      return Promise.resolve().then(function () {
        return o.authedFetch('/api/event/phone-banner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: o.eventId, source: job.source }) });
      }).then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try { body = JSON.parse(text); } catch (e) { /* an error page from in front of the API */ }
          return { ok: res.ok, status: res.status, body: body };
        });
      }, function () { return null; });
    }
    function ask() {
      return once().then(function (r) {
        if (r && r.status === 409 && Date.now() - since < WAIT_MS) return new Promise(function (go) { setTimeout(go, 5000); }).then(ask);
        var url = r && r.ok && r.body && r.body.url;
        if (url && usableUrl(url) && ownPicture(url, o.eventId, true)) return { url: url };
        if (url) return { error: 'The phone banner came back from an address that is not this event’s own, so it was not used. Nothing on your site changed — try again.' };
        if (r && r.body && r.body.error) return { error: String(r.body.error) };
        return { error: r ? 'The phone banner could not be made (error ' + r.status + '). Nothing on your site changed — try again.' : 'ETB2B AI could not be reached to make the phone banner. Nothing on your site changed — check your connection and try again.' };
      });
    }
    return ask();
  }
  /* The picture made goes in — if the banner is still the one it was made from — as one step with Undo; while ETB2B
     AI is changing the page it waits for that to be done. -> Promise<'' | why it did not go in> */
  function putIn(o, job, url, how) {
    var since = Date.now();
    function tell(text) { if (how === 'toast' && o.showToast) o.showToast(text); return text; }
    function attempt() {
      if (!job.sec.isConnected || !job.host.isConnected) return Promise.resolve(tell('The phone banner was made, but the banner is no longer on the page, so it was not put in.'));
      if (desktopUrl(job.host, o.canvas && o.canvas.win) !== job.source) return Promise.resolve(tell('The phone banner was made, but the banner’s picture changed meanwhile, so it was not put in. Generate it again from the new picture.'));
      if (o.busy && o.busy()) {
        if (Date.now() - since > WAIT_MS) return Promise.resolve(tell('The phone banner was made, but ETB2B AI was still changing the page, so it was not put in. Try again.'));
        return new Promise(function (go) { setTimeout(go, 1500); }).then(attempt);
      }
      if (o.before) o.before();
      set(job.sec, job.host, url);
      if (o.commit) o.commit();
      if (o.offerUndo) o.offerUndo('Phone banner made from the current banner: phones show it in place of the banner’s own picture.');
      return Promise.resolve('');
    }
    return attempt();
  }

  root.RevampPhoneBanner = {
    MEDIA: MEDIA, ATTR: ATTR, CSS_ATTR: CSS_ATTR,
    isBanner: isBanner, hostFor: hostFor, read: read, set: set, remove: remove, drop: drop, desktopUrl: desktopUrl, open: open, forCopy: forCopy,
    _test: { usableUrl: usableUrl, cssString: cssString, selectorFor: selectorFor, pageCss: pageCss, declarations: declarations, declsOf: declsOf,
      splitInline: splitInline, copySelector: copySelector, copyCss: copyCss, pictureOf: pictureOf, ownPicture: ownPicture, firstUrl: firstUrl }
  };
})(typeof window !== 'undefined' ? window : this);
