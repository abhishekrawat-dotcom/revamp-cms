/* ===========================================================================
   Revamp CMS — the banner video's settings (ES5; needs RevampCore and RevampHeroVideoCore)

   ONE component for both places an owner sets the video that plays behind the top of the site:
     - the event console, Content › Basics › Banner video (edit-event.html)   layout 'wide'
     - the site editor's Design panel (custom_editor.html)                    layout 'compact'
   Both read and write events/<id>.heroVideo through RevampCore (functions/lib/api-hero-video.js); the site
   shows it as it is served, so a change here is on the live site within a minute, without a publish.

   window.RevampHeroVideoUI.mount(container, {
     eventId, core: RevampCore, layout: 'wide' | 'compact',
     onChange: function (heroVideo | null, answer)   after every successful save or removal, and once loaded
     toast:    function (msg)
   }) -> { reload(), destroy(), busy() }

   window.RevampHeroVideoUI.drawCanvas(doc, heroVideo | null) -> boolean
     The editor canvas's still picture with a "Video background" badge on the banner (never saved: data-rv-editor,
     and never in a snapshot: data-rv-hv-preview). Nothing plays while editing. true when the site has a banner
     it could go on.

   What the owner can do: upload a video (MP4 H.264 or WebM, up to 30 MB and 60 s — checked here first, then by
   the server on the file's own bytes), see what visitors will see, turn it on and off, set the overlay
   (automatic: the site's own tone at a strength that keeps the words readable; or a colour and a strength, with
   a readability check), choose the still picture (a frame of the video, picked here, or a picture uploaded),
   replace it, remove it.
   =========================================================================== */
(function () {
  'use strict';

  var HV = function () { return window.RevampHeroVideoCore; };
  var ACCEPT = 'video/mp4,video/webm,.mp4,.m4v,.webm';
  var uid = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mb(n) { return (n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1) + ' MB'; }
  function clock(s) {
    s = Math.round(+s || 0);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function pct(v) { return Math.round((+v || 0) * 100) + '%'; }

  /* ---------- reading the chosen file in this browser ----------
     Its length and size, and a frame of it as a JPEG (the still picture). A file this browser cannot play is
     very likely one visitors' browsers cannot play either. */
  function typeOf(file) {
    var t = String(file.type || '').toLowerCase();
    if (t === 'video/mp4' || t === 'video/webm') return t;
    var ext = (/\.([a-z0-9]+)$/i.exec(String(file.name || '')) || [])[1];
    if (ext && /^(mp4|m4v)$/i.test(ext)) return 'video/mp4';
    if (ext && /^webm$/i.test(ext)) return 'video/webm';
    if (t === 'video/quicktime' || /^mov$/i.test(ext || '')) return 'mov';
    return '';
  }

  function openLocal(file) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video'), url = URL.createObjectURL(file), done = false;
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      var timer = setTimeout(function () { finish(new Error('This video could not be read in this browser. Export it as MP4 (H.264) and try again.')); }, 20000);
      function finish(err) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (err) { URL.revokeObjectURL(url); reject(err); } else resolve({ video: v, url: url, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      }
      v.addEventListener('loadeddata', function () { finish(null); });
      v.addEventListener('error', function () { finish(new Error('This browser cannot play this video, so visitors’ browsers may not either. Export it as MP4 with H.264 and upload that.')); });
      v.src = url;
    });
  }

  function seek(v, t) {
    return new Promise(function (resolve) {
      var to = Math.max(0, Math.min(t, (v.duration || 0) - 0.05));
      if (Math.abs(v.currentTime - to) < 0.01 && v.readyState >= 2) return resolve();
      var timer = setTimeout(resolve, 5000);
      v.addEventListener('seeked', function on() { v.removeEventListener('seeked', on); clearTimeout(timer); resolve(); });
      v.currentTime = to;
    });
  }

  function frameBlob(v, maxW) {
    return new Promise(function (resolve, reject) {
      var w = v.videoWidth, h = v.videoHeight;
      if (!w || !h) return reject(new Error('No picture could be taken from this video.'));
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, w, h);
      c.toBlob(function (b) { if (b) resolve({ blob: b, width: w, height: h }); else reject(new Error('No picture could be taken from this video.')); }, 'image/jpeg', 0.82);
    });
  }

  /* where a still is taken by default: a second in (a first frame is often black), or a tenth of a short clip */
  function defaultFrameAt(duration) { return Math.min(1, (duration || 0) / 10); }

  /* ---------- the component ---------- */
  function mount(container, opts) {
    opts = opts || {};
    var C = opts.core || window.RevampCore;
    var eventId = String(opts.eventId || '');
    var id = 'hvu' + (++uid);
    var wide = opts.layout === 'wide';
    var answer = null, error = '', loading = true, busy = '', progress = -1, xhr = null, confirming = false;
    var local = null;        // { file, video, url, duration } while the file this browser just uploaded is at hand
    var scrubAt = 0, previewPlaying = false, saveTimer = null, pendingOverlay = null, destroyed = false;
    var status = '';         // a short line for screen readers and sighted owners alike
    var keepFocus = '';

    function toast(msg) { if (opts.toast) opts.toast(msg); }
    function hv() { return answer && answer.heroVideo; }
    function changed() { if (opts.onChange) { try { opts.onChange(hv() || null, answer); } catch (e) { if (window.console) console.error(e); } } }

    function load() {
      loading = true; error = ''; render();
      return C.fetchHeroVideo(eventId).then(function (a) {
        answer = a; loading = false; render(); changed();
      }, function (err) {
        loading = false; error = (err && err.message) || 'The banner video could not be loaded.'; render();
      });
    }

    /* ---------- what the overlay will be ---------- */
    function overlaySetting() {
      var cur = pendingOverlay || (hv() && hv().overlay) || { mode: 'auto' };
      return cur;
    }
    function overlayNow() {
      var core = HV(), look = (answer && answer.site) || { tone: 'dark' };
      var o = overlaySetting();
      return core.overlayFor(o.mode === 'custom' ? { mode: 'custom', color: o.color || '#000000', opacity: o.opacity == null ? 0.55 : o.opacity } : { mode: 'auto' }, look);
    }

    /* ---------- rendering ---------- */
    function facts(v) {
      var bits = [v.duration > 0 && v.duration < 10 ? (Math.round(v.duration * 10) / 10) + ' s' : clock(v.duration)];
      if (v.width && v.height) bits.push(v.width + '×' + v.height);
      if (v.codec) bits.push(v.codec);
      bits.push(v.size < 1048576 ? Math.max(1, Math.round(v.size / 1024)) + ' KB' : mb(v.size));
      return bits.join(' · ');
    }
    function advice(v) {
      var L = (answer && answer.limits) || HV().LIMITS, out = [];
      /* the banner is wide on every screen that plays the video (phones get the still): an upright or square
         video is cut to a band across its middle */
      if (v.width && v.height && v.width / v.height < 1.3) out.push('It is ' + (v.width < v.height ? 'upright' : 'nearly square') + ' (' + v.width + '×' + v.height + '). The banner is wide, so only a band across the middle of it shows. A landscape (16:9) video fills it better.');
      if (v.duration > 0 && v.duration < 3) out.push('At ' + (Math.round(v.duration * 10) / 10) + ' seconds the loop repeats very often, which visitors notice. A loop of 10 to ' + L.adviseSeconds + ' seconds looks calmer.');
      if (v.hasAudio) out.push('It has a sound track, which is never played. Exporting it without sound makes the file smaller.');
      if (v.size > L.adviseBytes) out.push('At ' + mb(v.size) + ' it is large for a banner: under ' + mb(L.adviseBytes) + ' starts sooner for visitors.');
      if (v.duration > L.adviseSeconds) out.push('A loop of 10 to ' + L.adviseSeconds + ' seconds is usually enough, and makes a smaller file.');
      if (v.width > L.adviseWidth) out.push('It is ' + v.width + ' pixels wide: ' + L.adviseWidth + ' is enough for any screen.');
      if (!v.fastStart) out.push('It can only start playing once most of it has downloaded. Exporting with “fast start” (or “optimise for web”) lets it start sooner.');
      return out;
    }

    function previewHtml(v) {
      var ov = overlayNow(), ink = ov.ink === 'dark' ? '#14161b' : '#ffffff';
      var still = v.posterUrl ? '<img class="hvu-still" src="' + esc(v.posterUrl) + '" alt="">' : '<span class="hvu-nostill">No still picture yet</span>';
      return '<div class="hvu-stage" id="' + id + '-stage">' + still +
        '<video class="hvu-play" id="' + id + '-video" muted loop playsinline preload="none" aria-hidden="true"' + (previewPlaying ? ' data-on="1"' : '') + '></video>' +
        '<div class="hvu-ov" style="background:' + esc(ov.rgba) + '"></div>' +
        '<div class="hvu-sample" style="color:' + ink + '"><b>Your banner’s words</b><span>Date · Venue</span></div>' +
        '<button type="button" class="hvu-playbtn" id="' + id + '-playbtn" aria-pressed="' + (previewPlaying ? 'true' : 'false') + '">' + (previewPlaying ? 'Pause preview' : 'Play preview') + '</button>' +
        (v.enabled ? '' : '<span class="hvu-offtag">Off on the site</span>') +
        '</div>';
    }

    function readabilityHtml() {
      var ov = overlayNow(), words = ov.ink === 'dark' ? 'Dark words' : 'White words';
      if (ov.readable) return '<p class="hvu-read ok" id="' + id + '-read">' + words + ' stay readable over any part of the video.</p>';
      if (ov.needed == null) return '<p class="hvu-read bad" id="' + id + '-read">' + words + ' are hard to read on this colour at any strength, so it is not used. Choose a ' + (ov.ink === 'dark' ? 'lighter' : 'darker') + ' colour.</p>';
      return '<p class="hvu-read bad" id="' + id + '-read">' + words + ' would be hard to read over bright parts of the video, so this is not used. Use at least ' + pct(ov.needed) + '.</p>';
    }

    function overlayHtml() {
      var o = overlaySetting(), custom = o.mode === 'custom', ov = overlayNow();
      var colour = custom ? (o.color || '#000000') : ov.color;
      var strength = custom ? (o.opacity == null ? 0.55 : o.opacity) : ov.opacity;
      return '<fieldset class="hvu-group"><legend>Overlay</legend>' +
        '<label class="hvu-radio"><input type="radio" name="' + id + '-ovm" value="auto"' + (custom ? '' : ' checked') + '> Automatic <span class="hvu-hint">the site’s own tone, as strong as its words need</span></label>' +
        '<label class="hvu-radio"><input type="radio" name="' + id + '-ovm" value="custom"' + (custom ? ' checked' : '') + '> Choose the colour</label>' +
        '<div class="hvu-ovrow"' + (custom ? '' : ' hidden') + '>' +
          '<label class="hvu-colour"><span class="hvu-sr">Overlay colour</span><input type="color" id="' + id + '-ovc" value="' + esc(colour) + '"></label>' +
          '<label class="hvu-range"><span>Strength</span><input type="range" id="' + id + '-ovo" min="' + (custom && ov.needed != null ? Math.ceil(ov.needed * 100) : 0) + '" max="' + Math.round(HV().LIMITS.maxOpacity * 100) + '" step="1" value="' + Math.round(strength * 100) + '" aria-valuetext="' + pct(strength) + '"><output id="' + id + '-ovov">' + pct(strength) + '</output></label>' +
        '</div>' + readabilityHtml() + '</fieldset>';
    }

    function stillHtml(v) {
      var scrub = local && local.duration > 0
        ? '<div class="hvu-scrub"><label for="' + id + '-scrub">Pick the moment</label>' +
            '<input type="range" id="' + id + '-scrub" min="0" max="' + Math.floor(local.duration * 10) + '" step="1" value="' + Math.round(scrubAt * 10) + '" aria-valuetext="' + clock(scrubAt) + '">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="' + id + '-useframe">Use this moment</button></div>'
        : '';
      return '<fieldset class="hvu-group"><legend>Still picture</legend>' +
        '<p class="hvu-hint">What phones, slow connections and visitors who ask for less motion see, and what shows while the video loads. ' +
          (v.posterUrl ? (v.posterAuto ? 'Now: a moment of the video.' : 'Now: a picture you uploaded.') + ' While the video is on, it takes the place of the banner’s own picture.' : 'There is none yet: the site keeps its own banner picture.') + '</p>' +
        scrub +
        '<div class="hvu-row"><button type="button" class="btn btn-secondary btn-sm" id="' + id + '-poster">Upload a picture</button>' +
        '<input type="file" id="' + id + '-posterfile" accept="image/jpeg,image/png,image/webp" hidden></div>' +
        '</fieldset>';
    }

    function uploadBox(again) {
      var L = (answer && answer.limits) || HV().LIMITS;
      return '<div class="hvu-drop" id="' + id + '-drop">' +
        '<button type="button" class="btn ' + (again ? 'btn-secondary' : 'btn-primary') + ' btn-sm" id="' + id + '-pick">' + (again ? 'Replace the video' : 'Upload a video') + '</button>' +
        '<input type="file" id="' + id + '-file" accept="' + ACCEPT + '" hidden>' +
        (again ? '' : '<span class="hvu-hint">or drop the file here</span>') +
        '<p class="hvu-hint">MP4 (H.264) or WebM, up to ' + mb(L.maxBytes) + ' and ' + L.maxSeconds + ' seconds. Best: a 10–20 second loop, ' + L.adviseWidth + ' pixels wide, without sound, under ' + mb(L.adviseBytes) + '.</p>' +
        '</div>';
    }

    function render() {
      if (destroyed) return;
      var html = '<div class="hvu ' + (wide ? 'hvu-wide' : 'hvu-compact') + '">';
      if (loading) html += '<p class="hvu-hint" role="status">Loading…</p>';
      else if (error && !answer) html += '<p class="hvu-err" role="alert">' + esc(error) + '</p><button type="button" class="btn btn-secondary btn-sm" id="' + id + '-retry">Try again</button>';
      else if (answer.site && answer.site.host === 'none') {
        html += '<p class="hvu-note">This site’s design has no banner a video can play behind (an imported design). ' +
          'A banner video works on the ET templates and on sites designed with AI.</p>';
      } else {
        var v = hv();
        if (!wide || !v) html += '<p class="hvu-hint hvu-intro">A silent video that plays in a loop behind the top of the site, under an overlay that keeps its words readable. Visitors on phones, on slow connections or who ask for less motion see its still picture instead.</p>';
        if (answer.site && answer.site.host === 'unknown') html += '<p class="hvu-note">The site has not been saved yet. The video shows once it is, on its banner.</p>';
        if (busy) {
          html += '<div class="hvu-busy" role="status" aria-live="polite"><span>' + esc(busy) + (progress >= 0 ? ' ' + pct(progress) : '') + '</span>' +
            (progress >= 0 ? '<div class="hvu-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(progress * 100) + '"><i style="width:' + pct(progress) + '"></i></div>' : '') +
            (xhr ? '<button type="button" class="btn btn-ghost btn-sm" id="' + id + '-cancel">Cancel</button>' : '') + '</div>';
        }
        if (error) html += '<p class="hvu-err" role="alert">' + esc(error) + '</p>';
        if (!v) {
          if (!busy) html += uploadBox(false);
        } else {
          var notes = advice(v);
          html += '<div class="hvu-main">' +
            '<div class="hvu-left">' + previewHtml(v) +
              '<p class="hvu-facts">' + esc(facts(v)) + '</p>' +
              (notes.length ? '<ul class="hvu-advice">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
            '</div>' +
            '<div class="hvu-right">' +
              '<label class="hvu-switch"><input type="checkbox" id="' + id + '-on"' + (v.enabled ? ' checked' : '') + (busy ? ' disabled' : '') + '> <span>Play it on the site</span></label>' +
              overlayHtml() + stillHtml(v) +
              (busy ? '' : uploadBox(true)) +
              (confirming
                ? '<div class="hvu-confirm" role="group" aria-label="Remove the banner video?"><span>Remove the banner video? The site goes back to its banner picture.</span>' +
                    '<button type="button" class="btn btn-danger btn-sm" id="' + id + '-rmyes">Remove</button><button type="button" class="btn btn-ghost btn-sm" id="' + id + '-rmno">Keep it</button></div>'
                : '<button type="button" class="btn btn-ghost btn-sm hvu-remove" id="' + id + '-rm"' + (busy ? ' disabled' : '') + '>Remove the video</button>') +
            '</div></div>';
        }
        if (status) html += '<p class="hvu-sr" role="status" aria-live="polite">' + esc(status) + '</p>';
      }
      html += '</div>';
      /* the control that had the focus keeps it (each control's id is the same in every drawing) */
      var had = document.activeElement && container.contains(document.activeElement) && document.activeElement.id ? document.activeElement.id : keepFocus;
      container.innerHTML = html;
      wire();
      keepFocus = '';
      if (had) {
        var back = document.getElementById(had);
        if (back && !back.disabled) back.focus(); else if (back) keepFocus = had;     // disabled while saving: once it is back
      }
    }

    function $(suffix) { return document.getElementById(id + '-' + suffix); }

    function wire() {
      var retry = $('retry');
      if (retry) retry.onclick = load;
      var pick = $('pick'), file = $('file'), drop = $('drop');
      if (pick && file) {
        pick.onclick = function () { file.click(); };
        file.onchange = function () { if (file.files && file.files[0]) upload(file.files[0]); file.value = ''; };
      }
      if (drop) {
        drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
        drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
        drop.addEventListener('drop', function (e) {
          e.preventDefault(); drop.classList.remove('is-over');
          var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) upload(f);
        });
      }
      var cancel = $('cancel');
      if (cancel) cancel.onclick = function () { if (xhr) xhr.abort(); };
      var on = $('on');
      if (on) on.onchange = function () { save({ enabled: on.checked }, on.checked ? 'The video plays on the site.' : 'The video is off: the site shows its banner picture.'); };
      var radios = container.querySelectorAll('input[name="' + id + '-ovm"]');
      Array.prototype.forEach.call(radios, function (r) {
        r.onchange = function () {
          var cur = overlaySetting(), now = overlayNow();
          pendingOverlay = r.value === 'custom'
            ? { mode: 'custom', color: cur.color || now.color, opacity: cur.opacity == null ? Math.max(now.opacity, now.needed || 0) : cur.opacity }
            : { mode: 'auto', color: '', opacity: null };
          render(); queueOverlay();
          var first = r.value === 'custom' ? $('ovc') : null;
          if (first) first.focus(); else { var again = container.querySelector('input[name="' + id + '-ovm"][value="' + r.value + '"]'); if (again) again.focus(); }
        };
      });
      var ovc = $('ovc'), ovo = $('ovo');
      /* the strength never goes below what keeps the words readable with the colour chosen: picking a colour raises
         it to that when it is lower, and the slider stops there */
      function setStrength(v) {
        ovo.value = String(Math.round(v * 100));
        ovo.setAttribute('aria-valuetext', pct(v));
        var out = $('ovov'); if (out) out.textContent = pct(v);
      }
      if (ovc) ovc.oninput = function () {
        var look = (answer && answer.site) || { tone: 'dark' };
        var need = HV().overlayFor({ mode: 'custom', color: ovc.value, opacity: 0 }, look).needed;
        var strength = +ovo.value / 100;
        if (need != null && strength < need) { strength = need; setStrength(need); }
        ovo.min = need != null ? String(Math.ceil(need * 100)) : '0';
        pendingOverlay = { mode: 'custom', color: ovc.value, opacity: strength };
        repaintOverlay(); queueOverlay();
      };
      if (ovo) ovo.oninput = function () {
        pendingOverlay = { mode: 'custom', color: ovc.value, opacity: +ovo.value / 100 };
        setStrength(+ovo.value / 100);
        repaintOverlay(); queueOverlay();
      };
      var pb = $('playbtn');
      if (pb) pb.onclick = togglePreview;
      var vid = $('video');
      if (vid && previewPlaying && hv()) { vid.src = (local && local.url) || hv().url; vid.play().catch(function () {}); }
      var scrub = $('scrub'), use = $('useframe');
      if (scrub && local) {
        scrub.oninput = function () {
          scrubAt = +scrub.value / 10;
          scrub.setAttribute('aria-valuetext', clock(scrubAt));
          showLocalFrame();
        };
      }
      if (use) use.onclick = function () { useFrame(scrubAt); };
      var pbtn = $('poster'), pfile = $('posterfile');
      if (pbtn && pfile) {
        pbtn.onclick = function () { pfile.click(); };
        pfile.onchange = function () { if (pfile.files && pfile.files[0]) uploadPoster(pfile.files[0]); pfile.value = ''; };
      }
      var rm = $('rm'), yes = $('rmyes'), no = $('rmno');
      if (rm) rm.onclick = function () { confirming = true; render(); var y = $('rmyes'); if (y) y.focus(); };
      if (no) no.onclick = function () { confirming = false; render(); var r2 = $('rm'); if (r2) r2.focus(); };
      if (yes) yes.onclick = remove;
    }

    function repaintOverlay() {
      var ov = overlayNow(), layer = container.querySelector('.hvu-ov'), sample = container.querySelector('.hvu-sample');
      if (layer) layer.style.background = ov.rgba;
      if (sample) sample.style.color = ov.ink === 'dark' ? '#14161b' : '#ffffff';
      var read = $('read');
      if (read) { var tmp = document.createElement('div'); tmp.innerHTML = readabilityHtml(); read.parentNode.replaceChild(tmp.firstChild, read); }
    }
    function queueOverlay() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        if (!pendingOverlay) return;
        var o = pendingOverlay;
        if (!overlayNow().readable) return;       // said beside the colour; the last readable overlay stays
        save({ overlay: o.mode === 'custom' ? { mode: 'custom', color: o.color, opacity: Math.round(o.opacity * 100) / 100 } : { mode: 'auto' } }, 'Overlay saved.', true);
      }, 600);
    }

    function togglePreview() {
      previewPlaying = !previewPlaying;
      var vid = $('video'), pb = $('playbtn');
      if (!vid || !hv()) return;
      if (previewPlaying) { vid.setAttribute('data-on', '1'); if (!vid.src) vid.src = (local && local.url) || hv().url; vid.play().catch(function () {}); }
      else { vid.removeAttribute('data-on'); vid.pause(); }
      if (pb) { pb.setAttribute('aria-pressed', previewPlaying ? 'true' : 'false'); pb.textContent = previewPlaying ? 'Pause preview' : 'Play preview'; }
    }

    function showLocalFrame() {
      if (!local) return;
      var vid = $('video');
      if (!vid) return;
      previewPlaying = false;
      if (vid.src !== local.url) vid.src = local.url;
      vid.pause();
      vid.setAttribute('data-on', '1');
      vid.currentTime = Math.max(0, Math.min(scrubAt, local.duration - 0.05));
    }

    /* ---------- saving ---------- */
    function save(patch, said, quiet) {
      error = '';
      var wasBusy = busy;
      if (!quiet) { busy = 'Saving…'; progress = -1; render(); }
      return C.saveHeroVideo(eventId, patch).then(function (r) {
        if (answer) answer.heroVideo = r.heroVideo;
        if (patch.overlay) pendingOverlay = null;
        busy = quiet ? busy : wasBusy && wasBusy !== 'Saving…' ? wasBusy : '';
        status = said || 'Saved.';
        if (!quiet) render(); else repaintStatus();
        changed();
        return r;
      }, function (err) {
        busy = '';
        error = (err && err.message) || 'That was not saved. Please try again.';
        render();
        throw err;
      });
    }
    function repaintStatus() {
      var s = container.querySelector('.hvu-sr[role="status"]');
      if (s) s.textContent = status;
    }

    function stillFrom(at) {
      return seek(local.video, at).then(function () { return frameBlob(local.video, HV().LIMITS.posterWidth); }).then(function (f) {
        var name = (String(local.file.name || 'video').replace(/\.[a-z0-9]+$/i, '') || 'video') + '-still.jpg';
        var file;
        try { file = new File([f.blob], name, { type: 'image/jpeg' }); } catch (e) { file = f.blob; file.name = name; }
        return C.uploadImage(eventId, 'media', file);
      });
    }

    function upload(file) {
      if (busy) return;
      error = ''; status = ''; confirming = false;
      var L = (answer && answer.limits) || HV().LIMITS, type = typeOf(file), shown = '“' + (file.name || 'This file') + '”';
      if (type === 'mov') { error = shown + ' is a QuickTime (.mov) file, which not every browser plays. Export it as MP4 (H.264) and upload that.'; return render(); }
      if (!type) { error = shown + ' is not a video we can use. Upload an MP4 (H.264) or a WebM file.'; return render(); }
      if (file.size > L.maxBytes) { error = shown + ' is ' + mb(file.size) + '. A banner video can be up to ' + mb(L.maxBytes) + ': export it shorter or at a lower quality.'; return render(); }
      busy = 'Reading the video…'; progress = -1; render();
      var opened = null, checked = null;
      if (local) { try { URL.revokeObjectURL(local.url); } catch (e) { /* gone */ } local = null; }
      openLocal(file).then(function (o) {
        opened = o;
        if (o.duration > L.maxSeconds) throw new Error(shown + ' is ' + Math.round(o.duration) + ' seconds long. A banner video can be up to ' + L.maxSeconds + ' seconds: a loop of 10 to 20 seconds works best.');
        busy = 'Uploading the video…'; progress = 0; render();
        return C.uploadHeroVideo(eventId, file, {
          onProgress: function (f) { progress = f; var bar = container.querySelector('.hvu-bar i'), t = container.querySelector('.hvu-busy span'); if (bar) bar.style.width = pct(f); if (t) t.textContent = busy + ' ' + pct(f); },
          onXhr: function (x) { xhr = x; render(); }
        });
      }).then(function (info) {
        xhr = null; checked = info;
        busy = 'Taking the still picture…'; progress = -1; render();
        local = { file: file, video: opened.video, url: opened.url, duration: opened.duration };
        scrubAt = defaultFrameAt(opened.duration);
        return stillFrom(scrubAt).catch(function (err) {
          if (window.console) console.warn('[hero-video] no still picture:', err);
          return null;
        });
      }).then(function (still) {
        busy = 'Saving…'; render();
        var patch = { video: { path: checked.path } };
        if (still) { patch.poster = { url: still.url }; patch.posterAuto = true; }
        return save(patch, hv() ? 'The new video is saved.' : 'The banner video is saved. It plays on the site for visitors on a computer.');
      }).then(function () {
        busy = ''; render();
        toast(status);
      }).catch(function (err) {
        xhr = null; busy = ''; progress = -1;
        if (opened && !local) { try { URL.revokeObjectURL(opened.url); } catch (e) { /* gone */ } }
        if (!(err && err.cancelled)) error = (err && err.message) || 'The video could not be uploaded. Please try again.';
        else status = 'Upload cancelled.';
        render();
      });
    }

    function useFrame(at) {
      if (busy || !local) return;
      busy = 'Saving the still picture…'; error = ''; render();
      stillFrom(at).then(function (img) {
        return save({ poster: { url: img.url }, posterAuto: true }, 'The still picture is saved.');
      }).then(function () { busy = ''; render(); }, function (err) {
        busy = ''; error = (err && err.message) || 'The still picture could not be saved.'; render();
      });
    }

    function uploadPoster(file) {
      if (busy) return;
      busy = 'Uploading the picture…'; error = ''; render();
      C.uploadImage(eventId, 'media', file).then(function (img) {
        return save({ poster: { url: img.url }, posterAuto: false }, 'The still picture is saved.');
      }).then(function () { busy = ''; render(); }, function (err) {
        busy = ''; error = (err && err.message) || 'The picture could not be uploaded.'; render();
      });
    }

    function remove() {
      if (busy) return;
      busy = 'Removing…'; error = ''; confirming = false; render();
      C.removeHeroVideo(eventId).then(function () {
        if (answer) answer.heroVideo = null;
        if (local) { try { URL.revokeObjectURL(local.url); } catch (e) { /* gone */ } local = null; }
        busy = ''; status = 'The banner video is removed.'; pendingOverlay = null; previewPlaying = false;
        render(); changed(); toast(status);
        var p = $('pick'); if (p) p.focus();
      }, function (err) {
        busy = ''; error = (err && err.message) || 'The video could not be removed.'; render();
      });
    }

    load();
    return {
      reload: load,
      busy: function () { return !!busy; },
      destroy: function () {
        destroyed = true; clearTimeout(saveTimer);
        if (xhr) try { xhr.abort(); } catch (e) { /* done */ }
        if (local) try { URL.revokeObjectURL(local.url); } catch (e) { /* gone */ }
        container.innerHTML = '';
      }
    };
  }

  /* ---------- the editor's canvas ---------- */
  function drawCanvas(doc, heroVideo) {
    var core = HV();
    if (!doc || !core) return false;
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-hv-preview]'), function (n) { n.parentNode.removeChild(n); });
    var host = doc.querySelector('#banner .bnr-bg-video, [data-rv-media="bg-video"]');
    var hero = host ? null : doc.querySelector('section#hero, section.hero-root');
    if (!host && !hero) return false;
    var hv = core.clean(heroVideo);
    if (!hv) return true;
    var look;
    if (host) {
      var banner = host.closest('#banner') || host.parentNode;
      var scrim = '';
      try { scrim = doc.defaultView.getComputedStyle(banner).getPropertyValue('--rv-banner-scrim').trim(); } catch (e) { scrim = ''; }
      var c = core.parseColour(scrim);
      look = { tone: c && core.luminance(c) > 0.5 ? 'light' : 'dark', scrim: scrim };
      host.insertAdjacentHTML('afterbegin', core.editorLayer(hv, { host: 'banner' }));
      banner.insertAdjacentHTML('beforeend', core.editorBadge());
    } else {
      /* the tone of the words as they are drawn (an AI edit may have restyled them; the server reads the same
         from the page's stylesheet: rv-hero-video-core.js heroTone) */
      var words = hero.querySelector('.hero-tagline') || hero, ink = null;
      try { ink = core.parseColour(doc.defaultView.getComputedStyle(words).color); } catch (e) { ink = null; }
      look = { tone: ink ? (core.luminance(ink) < 0.5 ? 'light' : 'dark') : hero.classList.contains('hero-on-light') ? 'light' : 'dark', scrim: '' };
      hero.insertAdjacentHTML('afterbegin', core.editorLayer(hv, { host: 'hero' }));
      hero.insertAdjacentHTML('beforeend', core.editorBadge());
    }
    var st = doc.createElement('style');
    st.setAttribute('data-rv-editor', '');
    st.setAttribute('data-rv-hv-preview', '');
    /* as the page has it (lib/api.js applyHeroVideo): a colour that leaves this banner's words unreadable (chosen
       before a redesign changed their tone) is not used, the automatic overlay stands in */
    var overlay = core.overlayFor(hv.overlay, look);
    if (!overlay.readable) overlay = core.overlayFor({ mode: 'auto' }, look);
    st.textContent = core.editorCss({ host: host ? 'banner' : 'hero', overlay: overlay, poster: !!hv.posterUrl });
    (doc.head || doc.documentElement).appendChild(st);
    return true;
  }

  window.RevampHeroVideoUI = { mount: mount, drawCanvas: drawCanvas, _pure: { typeOf: typeOf, defaultFrameAt: defaultFrameAt, clock: clock } };
})();
