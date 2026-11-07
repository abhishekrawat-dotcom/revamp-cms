/* Oneworld's side of the platform's "Background & logo" uploads on Promotions → Social posts
   (promo-social-studio.html). The platform's strip and its uploadPsd, uploadBg and uploadLogo (index.html:1929-1942,
   1997-2020) are copied into promo-studio/social-studio.js; since UX-128, UX-129 and UX-131 the strip is drawn here
   (owStripHtml, patch S37) and its uploads are this file's owUploadPsd, owUploadBg and owUploadLogo, which keep the
   platform's requests and answers:

     /api/psd…                  → OWSArt.psd(o)
     /api/background…&slot=n    → OWSArt.background(n, o)
     /api/logo…                 → OWSArt.logo(o)

   (o is the request's options; o.body is the file picked.) Each one resolves a Response shaped as the platform's
   server answered (server.ts:492-523, store.ts:44-80), so every status line the platform writes is still its own.
   None of them rejects: a failure is an answer with { error }, which the platform shows as "Upload failed: …".

   What happens here instead of on the platform's server:
     - A PSD is read in this tab, never sent: OWSocial.psdUnits (assets/vendor/promo-social.js) finds its background
       and logo unit with the platform's own rules. Oneworld's server takes at most 32 MiB a request and runs in
       512 MiB, while real PSDs are 50-170 MB and took the platform's server 250 MiB to 1.4 GiB (map-psd F6, F7).
       The two units go up as pictures (from=psd), then a summary (name, size, which units came out), so the
       server clears a PSD-made unit this PSD did not make. An uploaded logo is never cleared by a PSD.
     - A picture is sent the way the server keeps it (fit): at most 3840 px on the long edge and 8 MiB. The
       platform took pictures up to 40 MB; Oneworld's server takes 8 MiB and refuses more than 16.7 million pixels,
       so anything bigger is drawn again here first, instead of being refused there.
     - Remove: a ✕ beside each filled pill (the platform had no way to take a picture back), and pills that follow
       what is stored (decorate), so a PSD that cleared a PSD-made logo turns the Logo pill off.
     - OWSArt.picture(file): the layout editor's "Upload a picture" beside an Image or Frame element's Source box
       (owner decision O2 = c). The picture is kept in this event's own folder, so the image proxy draws it.

   The strip (UX-128, UX-129, UX-131): "Pictures for your posts", in plain words. Its pills are buttons the keyboard
   reaches, each opening its own file chooser. The logo line says which logo the posts use: the one uploaded here,
   the design file's, or else the site's own logo unit (the server's siteLogoOf), never an empty square. A design file
   that brings a logo asks before it replaces the logo the posts use. "Every post starts on" is the background every
   card and newly opened post uses ("Use for all posts", POST …/art/default). An upload's status ends with what
   happened once the cards are drawn again ("Logo updated on all posts"), never a lingering "refreshing…".

   oneworld-social.js calls decorate(OWS.art) each time the event page is drawn; this file rereads the art and
   calls it again after every upload and Remove. Texts from the server are written with textContent. ES5, like
   Oneworld's other files on this page. */
(function () {
  'use strict';

  var MiB = 1024 * 1024;
  var LIMITS = {
    psd: 120 * MiB,      // the platform's PSD cap (server.ts:492, express.raw "120mb")
    picture: 40 * MiB,   // the platform's picture cap (server.ts:503, 515, express.raw "40mb")
    send: 8 * MiB,       // the most Oneworld's server takes in one upload (lib/promo-social.js NUMBERS.uploadMax)
    webp: 7.5 * MiB,     // a WebP comes in under this, as the server's own fallback does: the image proxy stops at 8 MiB
    edge: 3840           // the longest edge kept: the 9:16 story drawn at 2× is 2160 × 3840
  };
  var WEBP_QUALITIES = [0.92, 0.85, 0.75];

  /* the platform's own words over its size limit (server.ts:1119-1127), and when an answer could not be read
     (index.html:2001, 2009, 2017) */
  var TOO_LARGE = 'That upload is too large.';
  var UPLOAD_FAILED = 'upload failed';
  /* the two PSD sentences (plan V10; the same text the PSD reader throws with) */
  var PSD_TOO_LARGE = 'This PSD is too large to read in the browser. Save a flattened copy of at most 64 megapixels and 16,384 px a side (8,000 × 8,000 px fits), or upload the background and logo as pictures.';
  var PSD_UNREADABLE = 'This PSD could not be read. Save it again from Photoshop with Maximize Compatibility on, or upload the background and logo as pictures.';
  var PSD_READER_MISSING = 'The PSD reader did not load. Reload the page, then upload the PSD again.';
  var NOT_SENT = 'The upload did not reach EventSphere. Check the connection, then try again.';
  var PICTURE_FAILED = 'The picture could not be uploaded. Try again.';
  var PICTURE_EMPTY = 'That file is empty. Choose the picture again.';

  /* The strip's four background pills (the platform's PSD and BG 1-3, index.html:1934-1939, in its order), and the
     logo, which has a line of its own (logoLine). Each pill is a button with its own file input (pick). */
  var BG_WHY = 'Posts go back to the design\'s own background.';
  var SLOTS = [
    { slot: 'background', id: 'slot-psd', input: 'owInPsd', text: 'Design file (.psd)', name: 'the design file\'s background', ask: 'Remove the design file\'s background?', why: BG_WHY, done: 'The design file\'s background was removed.' },
    { slot: 'bg1', id: 'slot-bg1', input: 'owInBg1', text: 'Background 1', name: 'background 1', ask: 'Remove background 1?', why: BG_WHY, done: 'Background 1 removed.' },
    { slot: 'bg2', id: 'slot-bg2', input: 'owInBg2', text: 'Background 2', name: 'background 2', ask: 'Remove background 2?', why: BG_WHY, done: 'Background 2 removed.' },
    { slot: 'bg3', id: 'slot-bg3', input: 'owInBg3', text: 'Background 3', name: 'background 3', ask: 'Remove background 3?', why: BG_WHY, done: 'Background 3 removed.' }
  ];
  var LOGO = { slot: 'logoUnit', name: 'the logo you uploaded', ask: 'Remove the logo you uploaded?', done: 'Logo removed.',
    why: function () { return siteHasLogo() ? 'Your posts go back to your site’s logo.' : 'Your posts show the event’s name in type instead.'; } };

  /* ---------- requests ---------- */

  /* the open event: oneworld-social.js's EVENT_ID (this page's ?event=) */
  function eventId() {
    if (typeof EVENT_ID === 'string' && EVENT_ID) return EVENT_ID;
    try { return new URLSearchParams(location.search).get('event') || ''; } catch (e) { return ''; }
  }
  function artUrl(extra) { return '/api/promo/social/art?eventId=' + encodeURIComponent(eventId()) + (extra || ''); }

  /* One request through Oneworld's sign-in, read whole. Never rejects: a request that did not go through is
     status 0, and an answer that is not JSON has json null. */
  function send(url, opts) {
    var p;
    try { p = window.RevampAuth.authedFetch(url, opts); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (r) {
      return Promise.resolve(r.text()).then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { j = null; }
        return { status: r.status, ok: !!r.ok, json: j && typeof j === 'object' ? j : null };
      });
    }).then(null, function () { return { status: 0, ok: false, json: null }; });
  }
  function accepted(got) { return got.ok && !!got.json && got.json.ok === true; }
  /* the server's own reason when it gave one */
  function reasonOf(got, fallback) {
    if (got.json && typeof got.json.error === 'string' && got.json.error) return got.json.error;
    return got.status ? fallback : NOT_SENT;
  }

  /* The answers the platform's code reads. A string body is not JSON, on purpose (see psd). */
  function answer(status, body) {
    var text = typeof body === 'string';
    return new Response(text ? body : JSON.stringify(body),
      { status: status, headers: { 'Content-Type': text ? 'text/plain; charset=utf-8' : 'application/json' } });
  }
  /* a refused step, as the platform's server would have answered it: { error } with the server's reason */
  function refusal(got) {
    return answer(got.status >= 400 ? got.status : (got.status ? 502 : 503), { error: reasonOf(got, UPLOAD_FAILED) });
  }

  function putArt(slot, from, blob) {
    return send(artUrl('&slot=' + slot + '&from=' + from),
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
  }

  /* What is stored now: kept where oneworld-social.js keeps it (OWS.art), and the pills set from it. Resolves the
     art, or null when it could not be read (the pills then stay as they were). */
  /* only the newest read counts: two quick removals each read the art again, and the first read's answer can land
     after the second removal (or after the second read) and switch its pill back on */
  var readSeq = 0;
  function reread() {
    var mine = ++readSeq;
    return send(artUrl(), { method: 'GET' }).then(function (got) {
      if (!got.ok || !got.json) return null;
      if (mine !== readSeq) return got.json;
      keep(got.json);
      decorate(got.json);
      return got.json;
    });
  }
  function keep(art) { if (window.OWS && typeof window.OWS === 'object') window.OWS.art = art; }
  /* the posts' thumbnails are drawn with the art: draw them again (oneworld-social.js wraps the platform's own) */
  function redraw() {
    try { if (typeof refreshThumbs === 'function') refreshThumbs(); } catch (e) { /* a thumbnail that fails shows "—" on its own */ }
  }

  /* ---------- a picture the way the server keeps it (correctness 5) ---------- */

  function fileOf(o) { return o && typeof o === 'object' && 'body' in o ? o.body : o; }
  function isFile(f) { return !!f && typeof f === 'object' && typeof f.size === 'number'; }

  function decode(file) {
    if (typeof createImageBitmap !== 'function') return Promise.resolve(null);
    var p;
    try { p = createImageBitmap(file); } catch (e) { return Promise.resolve(null); }
    return Promise.resolve(p).then(function (b) {
      if (b && b.width > 0 && b.height > 0) return b;
      close(b);
      return null;
    }, function () { return null; });
  }
  function close(b) { try { if (b && typeof b.close === 'function') b.close(); } catch (e) { /* already closed */ } }
  /* a canvas holds its pixels until it is resized: let go of them at once */
  function free(c) { try { c.width = 0; c.height = 0; } catch (e) { /* nothing held */ } }
  function encode(c, type, quality) {
    return new Promise(function (resolve) {
      try { c.toBlob(function (b) { resolve(b || null); }, type, quality); } catch (e) { resolve(null); }
    });
  }
  function webpOf(c, i) {
    if (i >= WEBP_QUALITIES.length) return Promise.resolve(null);
    return encode(c, 'image/webp', WEBP_QUALITIES[i]).then(function (b) {
      return b && b.size <= LIMITS.webp ? b : webpOf(c, i + 1);
    });
  }

  /* Resolves what to send, or null when the picture cannot be brought within what the server takes (the caller
     answers "That upload is too large." without sending anything).
     - A picture the browser can open that is at most 3840 px and 8 MiB: its own bytes, untouched (the server
       turns it upright from its EXIF and keeps it as PNG).
     - Larger: drawn again at most 3840 px on the long edge, as PNG; when that PNG is still over 8 MiB, as WebP at
       0.92, then 0.85, then 0.75, the first under 7.5 MiB (the server's own steps). The browser draws the picture
       upright, so the copy needs no EXIF.
     - One the browser cannot open (TIFF, some SVGs): its own bytes when they are at most 8 MiB, for the server to
       read; otherwise null.
     o.fromCanvas: the blob is a PNG this browser just made (a PSD unit) at o.width × o.height: within the limits it
     is sent without being opened again, and over 8 MiB it goes straight to WebP (the same PNG would come out). */
  function fit(file, o) {
    o = o || {};
    if (o.fromCanvas && file.size <= LIMITS.send && Math.max(o.width, o.height) <= LIMITS.edge) return Promise.resolve(file);
    return decode(file).then(function (bmp) {
      if (!bmp) return file.size <= LIMITS.send ? file : null;
      var w = bmp.width, h = bmp.height, long = Math.max(w, h);
      if (long <= LIMITS.edge && file.size <= LIMITS.send) { close(bmp); return file; }
      var s = long > LIMITS.edge ? LIMITS.edge / long : 1;
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s));
      c.height = Math.max(1, Math.round(h * s));
      var g = null;
      try { g = c.getContext('2d'); } catch (e) { g = null; }
      if (!g) { close(bmp); free(c); return file.size <= LIMITS.send ? file : null; }
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, c.width, c.height);
      close(bmp);
      var png = (s === 1 && o.fromCanvas) ? Promise.resolve(null) : encode(c, 'image/png');
      return png.then(function (b) {
        return b && b.size <= LIMITS.send ? b : webpOf(c, 0);
      }).then(function (b) { free(c); return b; }, function () { free(c); return null; });
    }).then(null, function () {
      /* the browser opened it but could not draw it: the server may still read its own bytes */
      return file.size <= LIMITS.send ? file : null;
    });
  }

  /* ---------- the platform's three upload routes ---------- */

  /* BG 1-3 and Logo (server.ts:503-523): { ok, slot, width, height, bytes } / { ok, width, height, bytes }, the
     size the server kept (at most 3840 on the long edge; plan V11) */
  function upload(slot, file) {
    if (!isFile(file) || !file.size) return Promise.resolve(answer(400, { error: 'empty upload' }));
    if (file.size > LIMITS.picture) return Promise.resolve(answer(413, { error: TOO_LARGE }));
    return fit(file).then(function (blob) {
      if (!blob) return answer(413, { error: TOO_LARGE });
      return putArt(slot, 'upload', blob).then(function (got) {
        if (!accepted(got)) return refusal(got);
        return reread().then(function () { return answer(got.status, got.json); });
      });
    }).then(null, function () { return answer(500, { error: UPLOAD_FAILED }); });
  }
  function background(slot, o) {
    var n = String(slot == null ? '' : slot).replace(/^bg/, '');
    if (!/^[123]$/.test(n)) return Promise.resolve(answer(400, { error: 'unknown slot' }));
    return upload('bg' + n, fileOf(o));
  }
  function logo(o) { return upload('logoUnit', fileOf(o)); }

  function bytesOf(file) {
    if (typeof file.arrayBuffer === 'function') return Promise.resolve(file.arrayBuffer());
    return new Response(file).arrayBuffer();
  }
  function sizeOf(u) { return u && typeof u === 'object' ? { width: u.width, height: u.height } : null; }

  /* PSD (server.ts:492-500): { ok, canvasWidth, canvasHeight, background: {width,height}|null,
     logoUnit: {width,height}|null }, with the sizes the server kept. The platform also answered the PSD's layer
     table; nothing read it, and it is not kept. */
  function psd(o) {
    var file = fileOf(o);
    if (!isFile(file) || !file.size) return Promise.resolve(answer(400, { error: 'empty upload' }));
    /* over the platform's own cap the answer is not JSON, so the platform's line reads "file too large (max 120 MB)
       — flatten the PSD" (index.html:2001): of its two wordings, the one that says what to do (plan V10) */
    if (file.size > LIMITS.psd) return Promise.resolve(answer(413, 'too large'));
    var lib = window.OWSocial;
    if (!lib || typeof lib.psdUnits !== 'function') return Promise.resolve(answer(400, { error: PSD_READER_MISSING }));
    return bytesOf(file).then(function (buf) {
      return lib.psdUnits(buf, { maxEdge: LIMITS.edge });
    }).then(function (units) {
      return mayTakePsdLogo(units).then(function (yes) {
        if (!yes && units) units = Object.assign({}, units, { logo: null });
        return sendUnits(file, units);
      });
    }, function (e) {
      return answer(400, { error: e && e.name === 'PsdTooLarge' ? PSD_TOO_LARGE : PSD_UNREADABLE });
    }).then(null, function () { return answer(500, { error: UPLOAD_FAILED }); });
  }

  /* The background, then the logo, then the summary, in that order (the server keeps one unit per request).
     A step the server refuses ends the upload with its reason. When an earlier step was already kept, the pills
     and thumbnails are brought up to date even so: what is stored has changed. */
  function sendUnits(file, units) {
    units = units || {};
    var found = { background: false, logoUnit: false }, wrote = false;
    var chain = Promise.resolve(null);
    [['background', units.background], ['logoUnit', units.logo]].forEach(function (step) {
      chain = chain.then(function (stop) {
        if (stop || !step[1] || !step[1].blob) return stop;
        return fit(step[1].blob, { fromCanvas: true, width: step[1].width, height: step[1].height }).then(function (blob) {
          if (!blob) return answer(413, { error: TOO_LARGE });
          return putArt(step[0], 'psd', blob).then(function (got) {
            if (!accepted(got)) return refusal(got);
            wrote = true;
            found[step[0]] = true;
            return null;
          });
        });
      });
    });
    function stopped(res) {
      if (!wrote) return res;
      return reread().then(function () { redraw(); return res; });
    }
    return chain.then(function (stop) {
      if (stop) return stopped(stop);
      var meta = { eventId: eventId(), name: String(file.name || '').slice(0, 120), bytes: file.size,
        canvasWidth: units.canvasWidth, canvasHeight: units.canvasHeight, found: found };
      return send('/api/promo/social/art/psd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) })
        .then(function (got) {
          if (!accepted(got)) return stopped(refusal(got));
          return reread().then(function () {
            return answer(200, { ok: true, canvasWidth: units.canvasWidth, canvasHeight: units.canvasHeight,
              background: sizeOf(got.json.background), logoUnit: sizeOf(got.json.logoUnit) });
          });
        });
    });
  }

  /* ---------- the layout editor's "Upload a picture" (owner O2 = c) ---------- */

  /* An Error whose text is what to show: its message, and String(err) too */
  function problem(text, status) {
    var e = new Error(text);
    e.status = status || 0;
    e.toString = function () { return text; };
    return e;
  }
  /* Resolves { url, width, height } — a public address of this event's own folder, which the image proxy draws and
     a saved layout may keep. Rejects with the server's reason. Limited like a background: 40 MB, then fit. */
  function picture(file) {
    file = fileOf(file);
    if (!isFile(file) || !file.size) return Promise.reject(problem(PICTURE_EMPTY, 400));
    if (file.size > LIMITS.picture) return Promise.reject(problem(TOO_LARGE, 413));
    return fit(file).then(function (blob) {
      if (!blob) throw problem(TOO_LARGE, 413);
      return send('/api/promo/social/picture?eventId=' + encodeURIComponent(eventId()),
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
    }).then(function (got) {
      if (!accepted(got) || typeof got.json.url !== 'string' || !got.json.url) throw problem(reasonOf(got, PICTURE_FAILED), got.status);
      return { url: got.json.url, width: got.json.width, height: got.json.height };
    });
  }

  /* ---------- the pills and Remove ---------- */

  function hasClass(n, c) { return !!n && n.nodeType === 1 && !!n.classList && n.classList.contains(c); }
  function nextElement(n) {
    var s = n.nextSibling;
    while (s && s.nodeType !== 1) s = s.nextSibling;
    return s;
  }
  function labelOf(def) { return def.id ? document.getElementById(def.id) : null; }
  /* the status line: each new sentence replaces the last; a sentence written when a redraw ends (after) is dropped
     when another was written meanwhile */
  var statusSeq = 0;
  function setStatus(text, act) {
    var el = document.getElementById('psdStatus');
    statusSeq++;
    if (!el) return statusSeq;
    el.textContent = text;
    if (act) {
      var b = document.createElement('button');
      b.setAttribute('type', 'button');
      b.className = 'btn alt sm ow-status-act';
      b.textContent = act.text;
      b.onclick = act.run;
      el.appendChild(document.createTextNode(' '));
      el.appendChild(b);
    }
    return statusSeq;
  }

  /* Every pill's "on" from what is stored (fidelity 7), and a ✕ right after each filled one. The ✕ sits outside
     its label, so a click on it never opens the file picker. */
  function decorate(art) {
    if (!art || typeof art !== 'object') return;
    wirePills();
    logoLine(art);
    useBgMenu(art);
    SLOTS.forEach(function (def) {
      var label = labelOf(def);
      if (!label || !label.parentNode) return;
      var on = !!art[def.slot];
      label.classList.toggle('on', on);
      var x = nextElement(label);
      if (!hasClass(x, 'ow-slot-x')) x = null;
      if (on && !x) {
        x = document.createElement('button');
        x.setAttribute('type', 'button');
        x.className = 'ow-slot-x';
        x.setAttribute('title', 'Remove ' + def.name);
        x.setAttribute('aria-label', 'Remove ' + def.name);
        x.textContent = '✕';
        label.parentNode.insertBefore(x, label.nextSibling);
      } else if (!on && x) {
        x.parentNode.removeChild(x);
        return;
      }
      if (x) x.onclick = function () { remove(def, x); };
    });
  }

  function confirmRemove(def) {
    var opts = { ok: 'Remove', danger: true };
    if (typeof uiConfirm === 'function') {
      var p;
      try { p = uiConfirm(def.ask, typeof def.why === 'function' ? def.why() : def.why, opts); } catch (e) { return Promise.resolve(false); }
      return Promise.resolve(p).then(function (v) { return v === true; }, function () { return false; });
    }
    return Promise.resolve(!!(window.confirm && window.confirm(def.ask + '\n\n' + (typeof def.why === 'function' ? def.why() : def.why))));
  }

  /* Remove: asked first; the slot is cleared on the server (the picture itself stays in Storage while the event
     lives, because a saved layout may still show it); the pills follow; the thumbnails are drawn again. */
  function remove(def, btn) {
    return confirmRemove(def).then(function (yes) {
      if (!yes) return false;
      if (btn) btn.disabled = true;
      return send(artUrl('&slot=' + def.slot), { method: 'DELETE' }).then(function (got) {
        if (!accepted(got)) {
          if (btn) btn.disabled = false;
          /* the uploads' own pattern ("Upload failed: <the server's reason>") */
          var why = reasonOf(got, '');
          setStatus(why ? 'Remove failed: ' + why : 'Remove failed. Try again.');
          return false;
        }
        /* the slot is empty now: the pill and its ✕ follow at once, with the message, rather than after the art is
           read again (on a slow answer the message said "removed" while the pill still showed the picture) */
        var known = (window.OWS && window.OWS.art && typeof window.OWS.art === 'object') ? window.OWS.art : {};
        var next = {};
        for (var k in known) if (Object.prototype.hasOwnProperty.call(known, k)) next[k] = known[k];
        next[def.slot] = false;
        if (next.units && typeof next.units === 'object') {
          var units = {};
          for (var u in next.units) if (Object.prototype.hasOwnProperty.call(next.units, u) && u !== def.slot) units[u] = next.units[u];
          next.units = units;
        }
        keep(next);
        decorate(next);
        setStatus(def.done + (def.slot === 'logoUnit' ? (siteHasLogo() ? ' Your posts use your site’s logo again.' : ' Your posts show the event’s name.') : ''));
        /* then what is stored, which also catches a change someone else made meanwhile */
        return reread().then(function () {
          redraw();
          return true;
        });
      });
    }).then(null, function () {
      if (btn) btn.disabled = false;
      return false;
    });
  }

  /* ---------- the strip (UX-128, UX-129, UX-131) ---------- */

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function artNow() { return window.OWS && window.OWS.art && typeof window.OWS.art === 'object' ? window.OWS.art : {}; }
  /* the site's own logo unit for each theme of post, as the catalog says (promo-social.js siteLogoOf) */
  function siteLogo() {
    var ev = typeof CAT !== 'undefined' && CAT && CAT.event ? CAT.event : null, s = ev && ev.siteLogo;
    return { dark: !!(s && s.dark), light: !!(s && s.light) };
  }
  function siteHasLogo() { var s = siteLogo(); return s.dark || s.light; }
  /* which logo the posts use, in words */
  function logoWords(art) {
    var u = art.units && art.units.logoUnit;
    if (art.logoUnit) return u && u.from === 'psd' ? 'Using the logo from your design file' : 'Using the logo you uploaded';
    if (!siteHasLogo()) return 'No logo yet: your posts show the event’s name';
    var s = siteLogo();
    return 'Using your site’s logo' + (s.dark && s.light ? '' : s.dark ? ' (on dark posts; light ones show the event’s name)' : ' (on light posts; dark ones show the event’s name)');
  }
  /* the background choices: the design's own, the design file's when one is uploaded, and Background 1-3 when uploaded.
     With no design file the design's own is '' (the platform's own default), so a layout keeps the key it had. */
  function bgChoices(art) {
    var out = [{ v: art.background ? 'design' : '', t: 'The design’s own background' }];
    if (art.background) out.push({ v: '', t: 'Design file (.psd)' });
    ['1', '2', '3'].forEach(function (n) { if (art['bg' + n]) out.push({ v: n, t: 'Background ' + n }); });
    return out;
  }
  /* a stored choice as one of today's: 'design' with no design file is the same as '' */
  function bgValue(art, v) {
    v = typeof v === 'string' ? v : '';
    if (v === 'design' && !art.background) return '';
    return bgChoices(art).some(function (c) { return c.v === v; }) ? v : '';
  }
  function bgLabel(art, v) {
    var c = bgChoices(art).filter(function (x) { return x.v === bgValue(art, v); })[0];
    return c ? c.t : 'The design’s own background';
  }
  /* what the posts use now, in one sentence */
  function bgPhrase(art, v) {
    v = bgValue(art, v);
    return /^[123]$/.test(v) ? 'Background ' + v : v === '' && art.background ? 'the design file’s background' : 'the design’s own background';
  }
  function summary(art) {
    return 'Your posts use ' + bgPhrase(art, art.useBg) + ' and ' +
      (art.logoUnit ? ((art.units && art.units.logoUnit && art.units.logoUnit.from === 'psd') ? 'the logo from your design file' : 'the logo you uploaded') :
        siteHasLogo() ? 'your site’s logo' : 'the event’s name in place of a logo') + '.';
  }
  /* The strip, drawn into the event page by renderEventDetail (patch S37) as markup of fixed words only (the summary
     is made of this file's own words); decorate, called right after, wires its buttons, inputs and menu and fills the
     logo line and the menu from the art. */
  function stripHtml(assets) {
    var art = assets && typeof assets === 'object' ? assets : {};
    var pills = SLOTS.map(function (def) {
      return '<button type="button" class="slot' + (art[def.slot] ? ' on' : '') + '" id="' + def.id + '">' + esc(def.text) + '</button>' +
        '<input type="file" id="' + def.input + '" accept="' + (def.slot === 'background' ? '.psd' : 'image/*') + '" hidden>';
    }).join('');
    return '<div class="psd ow-strip">' +
      '<div class="ic" aria-hidden="true">◧</div>' +
      '<div class="ow-strip-b">' +
        '<div class="t">Pictures for your posts <span class="faint" style="font-weight:400">· your event details fill in automatically</span></div>' +
        '<div class="h" id="psdStatus" role="status" aria-live="polite">' + esc(summary(art)) + '</div>' +
        '<div class="assets-slots" role="group" aria-label="Backgrounds">' + pills + '</div>' +
        '<div class="ow-strip-row" id="owLogoLine"></div>' +
        '<div class="ow-strip-row"><label for="owUseBgSel">Every post starts on</label><select id="owUseBgSel"></select></div>' +
      '</div></div>';
  }
  /* each pill opens its own file chooser; each input uploads what was chosen */
  function wirePills() {
    SLOTS.forEach(function (def) {
      var b = document.getElementById(def.id), inp = document.getElementById(def.input);
      if (b) b.onclick = function () { pick(def.input); };
      if (inp) inp.onchange = def.slot === 'background' ? function () { uploadPsdFrom(inp); } : function () { uploadBgFrom(inp, def.slot.slice(2)); };
    });
  }
  /* "Logo · Using your site's logo · Replace" (UX-129), with Remove for a logo uploaded here */
  function logoLine(art) {
    var el = document.getElementById('owLogoLine');
    if (!el) return;
    el.textContent = '';
    var t = document.createElement('span');
    t.className = 'ow-logo-t';
    t.textContent = 'Logo · ' + logoWords(art);
    el.appendChild(t);
    var rep = document.createElement('button');
    rep.setAttribute('type', 'button');
    rep.className = 'btn alt sm';
    rep.id = 'slot-logo';
    rep.textContent = art.logoUnit || siteHasLogo() ? 'Replace' : 'Upload a logo';
    rep.setAttribute('aria-label', (art.logoUnit || siteHasLogo() ? 'Replace the logo' : 'Upload a logo') + ' for your posts');
    rep.onclick = function () { pick('owInLogo'); };
    el.appendChild(rep);
    if (art.logoUnit) {
      var rm = document.createElement('button');
      rm.setAttribute('type', 'button');
      rm.className = 'btn ghost sm';
      rm.textContent = siteHasLogo() ? 'Use the site’s logo' : 'Remove';
      rm.setAttribute('aria-label', siteHasLogo() ? 'Remove the uploaded logo and use the site’s logo' : 'Remove the logo');
      rm.onclick = function () { remove(LOGO, rm); };
      el.appendChild(rm);
    }
    var inp = document.getElementById('owInLogo');
    if (!inp) {
      inp = document.createElement('input');
      inp.setAttribute('type', 'file');
      inp.setAttribute('accept', 'image/*');
      inp.setAttribute('hidden', '');
      inp.id = 'owInLogo';
      inp.onchange = function () { uploadLogoFrom(inp); };
    }
    el.appendChild(inp);
  }
  function useBgMenu(art) {
    var sel = document.getElementById('owUseBgSel');
    if (!sel) return;
    var v = bgValue(art, art.useBg);
    sel.textContent = '';
    bgChoices(art).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.v;
      o.textContent = c.t;
      if (c.v === v) o.selected = true;
      sel.appendChild(o);
    });
    sel.value = v;
    sel.onchange = function () { setUseBg(sel.value); };
  }
  function pick(id) { var i = document.getElementById(id); if (i && typeof i.click === 'function') i.click(); }

  /* ---------- the uploads, with a result to end on ---------- */

  function bodyOf(r) {
    return Promise.resolve(r && typeof r.text === 'function' ? r.text() : '').then(function (t) {
      var j = null;
      try { j = JSON.parse(t); } catch (e) { j = null; }
      return { status: r ? r.status : 0, json: j && typeof j === 'object' ? j : null };
    }, function () { return { status: r ? r.status : 0, json: null }; });
  }
  /* the cards drawn again; then, unless something else was said meanwhile, what happened */
  function afterRedraw(drawing, done) {
    var mine = setStatus(drawing);
    redraw();
    var p = window.OWS && window.OWS.thumbsP ? window.OWS.thumbsP : Promise.resolve();
    return Promise.resolve(p).then(null, function () { /* a card that fails says so on its own */ }).then(function () {
      if (mine === statusSeq) setStatus(done);
    });
  }
  function failed(got, fallback) {
    var why = got.json && typeof got.json.error === 'string' && got.json.error ? got.json.error : fallback;
    setStatus('Upload failed: ' + why);
  }
  function fileFrom(inp) {
    var f = inp && inp.files && inp.files[0];
    if (inp) inp.value = '';                 // the same file can be chosen again
    return f || null;
  }
  function uploadPsdFrom(inp) {
    var f = fileFrom(inp);
    if (!f) return Promise.resolve();
    setStatus('Reading the design file… A large one can take a minute.');
    return psd({ body: f }).then(bodyOf).then(function (got) {
      if (!got.json) { failed(got, got.status === 413 ? 'the design file is over 120 MB. Save a flattened copy and upload that.' : UPLOAD_FAILED); return; }
      if (!got.json.ok) { failed(got, UPLOAD_FAILED); return; }
      var j = got.json, parts = [];
      if (j.background) parts.push('background');
      if (j.logoUnit) parts.push('logo');
      if (!parts.length) {
        setStatus('The design file was read, but it has no background or logo your posts can use. Upload them as pictures instead.');
        redraw();
        return;
      }
      /* its background is on the posts only while they start on the design file's: with another chosen for all
         posts (Use for all posts) it waits in the menu, and the status says so rather than claiming it is used */
      var art = artNow(), waiting = j.background && bgValue(art, art.useBg) !== '' ? 'Its background is ready: choose “Design file (.psd)” under “Every post starts on” to use it on all posts.' : '';
      if (waiting) parts = parts.filter(function (x) { return x !== 'background'; });
      if (!parts.length) { setStatus('Design file read. ' + waiting); return; }
      var what = parts.join(' and ');
      return afterRedraw('Design file read. Drawing your posts again with its ' + what + '…',
        'The design file’s ' + what + (parts.length > 1 ? ' are' : ' is') + ' now on all posts.' + (waiting ? ' ' + waiting : ''));
    });
  }
  function uploadBgFrom(inp, n) {
    var f = fileFrom(inp);
    if (!f) return Promise.resolve();
    setStatus('Uploading background ' + n + '…');
    return background(n, { body: f }).then(bodyOf).then(function (got) {
      if (!got.json || !got.json.ok) { failed(got, UPLOAD_FAILED); return; }
      var art = artNow();
      if (art.useBg === String(n)) {
        return afterRedraw('Background ' + n + ' uploaded. Drawing your posts again…', 'Background ' + n + ' is now on all posts.');
      }
      /* the cards are not drawn again: they use the background every post starts on, which this is not (yet) */
      setStatus('Background ' + n + ' uploaded (' + got.json.width + '×' + got.json.height + ').',
        { text: 'Use it for all posts', run: function () { setUseBg(String(n)); } });
    });
  }
  function uploadLogoFrom(inp) {
    var f = fileFrom(inp);
    if (!f) return Promise.resolve();
    setStatus('Uploading the logo…');
    return logo({ body: f }).then(bodyOf).then(function (got) {
      if (!got.json || !got.json.ok) { failed(got, UPLOAD_FAILED); return; }
      return afterRedraw('Logo uploaded. Drawing your posts again with it…', 'Logo updated on all posts.');
    });
  }
  /* "Use for all posts": the background every post starts on. Resolves the art, or null when it was refused. */
  function setUseBg(v) {
    var art = artNow(), want = bgValue(art, v);
    setStatus('Saving the background for all posts…');
    return send('/api/promo/social/art/default', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: eventId(), bg: want }) }).then(function (got) {
      if (!accepted(got)) {
        setStatus('The background could not be set for all posts: ' + reasonOf(got, 'please try again.'));
        useBgMenu(artNow());
        return null;
      }
      keep(got.json);
      decorate(got.json);
      var ph = bgPhrase(got.json, want), label = ph.charAt(0).toUpperCase() + ph.slice(1);
      return afterRedraw(label + ' is used for all posts. Drawing them again…', label + ' is now on all posts.').then(function () { return got.json; });
    });
  }

  /* A design file with a logo of its own asks before that logo replaces the one the posts use now: the logo uploaded
     here, or the site's own (UX-129). A design file's logo replaces an earlier design file's without asking. Resolves
     true when the design file's logo may go up. */
  function mayTakePsdLogo(units) {
    if (!units || !units.logo || !units.logo.blob) return Promise.resolve(true);
    var art = artNow(), cur = art.units && art.units.logoUnit, ask = null;
    if (art.logoUnit && cur && cur.from === 'upload') {
      ask = ['Replace the logo you uploaded?', 'This design file has a logo of its own. Use it on your posts in place of the logo you uploaded?', 'Keep my logo'];
    } else if (!art.logoUnit && siteHasLogo()) {
      ask = ['Use the design file’s logo?', 'Your posts use your site’s logo now. This design file has a logo of its own: use it on your posts instead?', 'Keep the site’s logo'];
    }
    if (!ask || typeof uiConfirm !== 'function') return Promise.resolve(true);
    var p;
    try { p = uiConfirm(ask[0], ask[1], { ok: 'Use the design file’s logo', cancel: ask[2] }); } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(p).then(function (v) { return v === true; }, function () { return false; });
  }

  window.OWSArt = { psd: psd, background: background, logo: logo, decorate: decorate, picture: picture,
    stripHtml: stripHtml, uploadPsd: uploadPsdFrom, uploadBg: uploadBgFrom, uploadLogo: uploadLogoFrom, setUseBg: setUseBg,
    bgChoices: bgChoices, bgValue: bgValue, bgLabel: bgLabel, bgPhrase: bgPhrase, summary: summary, logoWords: logoWords, siteHasLogo: siteHasLogo };
  /* the copied renderEventDetail calls it by name (patch S37) */
  window.owStripHtml = stripHtml;
})();
