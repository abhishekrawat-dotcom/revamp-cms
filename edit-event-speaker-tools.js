/* edit-event-speaker-tools.js — two ways to add many speakers at once, on the console's Speakers page
   (window.EditEventSpeakerTools; the owner, 11 Nov 2026: "Pasting a whole list from a sheet, and uploading a folder
   of photos at once" and "Taking photos out of brochure PDFs, for speakers not in ET's records").

   PASTE A LIST. Rows copied from Excel or Google Sheets (tab-separated), or typed as "name, designation, company" (the
   first comma ends the name, the last begins the company, so a designation may hold commas). A first row of headings
   is read as such: Name, Designation (Title, Role), Company (Organisation), Group (Track, Category), LinkedIn. Each
   name is looked up in the speaker library (functions/lib/et-library.js): from the one entry of exactly that name
   (and that company, when the row gives one) the row takes what it did not have — a designation, a company, a photo,
   a LinkedIn link — and says so. Someone already on the event is shown and left out. "Add N speakers" saves them in
   the order pasted, into the group chosen (or the row's own group, made when the event has none of that name).

   ADD PHOTOS. Photos picked one by one or a whole folder: each file is matched to a speaker by its name ("naven-singh.
   jpg", "Naven Singh 2.png", "Dr Naven Singh.jpeg"), only where exactly one speaker fits; any other file asks whose it
   is. Or a brochure (PDF): its pages are drawn here with PDF.js (assets/vendor/pdfjs), only those whose words name a
   speaker (twelve at most, six to a request), and ETB2B AI marks where each named speaker's own photo is
   (POST /api/event/speaker-photos/find); each photo is cut out of the full-size page here. Every photo is shown
   before anything is saved: the person ticks what to keep. A speaker who already has a photo keeps it unless the
   person ticks "Replace". Photos are saved square, 320 px, as the console saves one.

     EditEventSpeakerTools.init(ctx)        the console's helpers (edit-event.html CTX.speakerTools)
     EditEventSpeakerTools.paste()          the Paste a list window
     EditEventSpeakerTools.photos(o)        the Add photos window; o.pdfData (base64) and o.names start it on a brochure
                                            (ETB2B AI's "Take their photos from the brochure")
   ES5. */
(function (root) {
  'use strict';
  var doc = root.document;
  var X = null;                       // the console's helpers
  var OUT = 320, AT_ONCE = 4, PDF_PAGES = 12, PAGES_PER_ASK = 6, MAX_ROWS = 200;
  var TITLES = { dr: 1, mr: 1, mrs: 1, ms: 1, prof: 1, shri: 1, smt: 1, sir: 1, er: 1, ca: 1, adv: 1 };
  var FILE_NOISE = { photo: 1, pic: 1, picture: 1, img: 1, image: 1, headshot: 1, profile: 1, final: 1, copy: 1, new: 1, hd: 1, hr: 1, dp: 1, speaker: 1 };

  function $(id) { return doc.getElementById(id); }
  function str(v) { return v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function words(s) {
    return str(s).replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  }
  function nameWords(s) { return words(s).filter(function (w) { return !TITLES[w] && !/^\d+$/.test(w); }); }
  function key(s) { return nameWords(s).join(' '); }
  function inTurns(list, n, fn) {
    var i = 0;
    function lane() { if (i >= list.length) return Promise.resolve(); var k = i++; return Promise.resolve(fn(list[k], k)).then(lane, lane); }
    var lanes = []; for (var j = 0; j < Math.min(n, list.length); j++) lanes.push(lane());
    return Promise.all(lanes);
  }
  function pick(accept, multiple, folder) {
    return new Promise(function (resolve) {
      var inp = doc.createElement('input');
      inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
      if (folder) { inp.setAttribute('webkitdirectory', ''); inp.setAttribute('directory', ''); }
      inp.onchange = function () { resolve(Array.prototype.slice.call(inp.files || [])); };
      inp.click();
    });
  }
  /* a square photo, 320 px, from a picture or a page drawing: the part given (box, in its own pixels) or the whole;
     a tall one keeps its top, where the face is */
  function square(src, box) {
    var w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
    var b = box || { x: 0, y: 0, w: w0, h: h0 };
    var side = Math.min(b.w, b.h);
    var sx = b.x + (b.w - side) / 2, sy = b.h > b.w ? b.y + (b.h - side) * 0.2 : b.y + (b.h - side) / 2;
    var c = doc.createElement('canvas'); c.width = OUT; c.height = OUT;
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, OUT, OUT);
    g.drawImage(src, sx, sy, side, side, 0, 0, OUT, OUT);
    return c.toDataURL('image/jpeg', 0.86);
  }
  function fileImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('“' + file.name + '” could not be read as a picture.')); };
      img.src = url;
    });
  }

  /* ---------- matching a file to a speaker by its name ---------- */
  function matchFile(fileName, speakers) {
    var fw = nameWords(str(fileName).replace(/\.[a-z0-9]{2,5}$/i, '')).filter(function (w) { return !FILE_NOISE[w]; });
    if (!fw.length) return null;
    var hits = speakers.filter(function (s) {
      var sw = nameWords(s.name);
      if (!sw.length) return false;
      if (sw.join(' ') === fw.join(' ')) return true;
      var all = sw.every(function (w) { return fw.indexOf(w) !== -1; });           // "dr-naven-kumar-singh" for Naven Kumar Singh
      var mine = fw.length >= 2 && fw.every(function (w) { return sw.indexOf(w) !== -1; });   // "naven-singh" for Naven Kumar Singh
      return all || mine;
    });
    return hits.length === 1 ? hits[0] : null;
  }

  /* ---------- the brochure ---------- */
  var pdfjs = null;
  function loadPdfJs() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (pdfjs) return pdfjs;
    pdfjs = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = '/assets/vendor/pdfjs/pdf.min.js';
      s.onload = function () {
        if (!root.pdfjsLib) { pdfjs = null; reject(new Error('The brochure reader could not start.')); return; }
        root.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.min.js';
        resolve(root.pdfjsLib);
      };
      s.onerror = function () { pdfjs = null; reject(new Error('The brochure reader could not be loaded. Check your connection and try again.')); };
      doc.head.appendChild(s);
    });
    return pdfjs;
  }
  function bytesOf(b64) { var bin = atob(b64), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  /* -> Promise<[{ speaker, data, page }]> and says how it goes through say(text) */
  function photosFromPdf(bytes, speakers, say) {
    return loadPdfJs().then(function (lib) { return lib.getDocument({ data: bytes }).promise; }).then(function (pdf) {
      var n = Math.min(pdf.numPages, 60), pages = [];
      say('Reading the brochure’s ' + n + (n === 1 ? ' page' : ' pages') + '…');
      var reads = [];
      for (var i = 1; i <= n; i++) reads.push(i);
      return inTurns(reads, 4, function (num) {
        return pdf.getPage(num).then(function (page) {
          return page.getTextContent().then(function (t) {
            var text = ' ' + nameWords((t.items || []).map(function (x) { return x.str; }).join(' ')).join(' ') + ' ';
            var named = speakers.filter(function (s) { var w = nameWords(s.name); return w.length && w.every(function (x) { return text.indexOf(' ' + x + ' ') !== -1; }); });
            pages.push({ num: num, page: page, named: named.length });
          });
        });
      }).then(function () {
        /* the pages that name speakers, most first; a brochure that is only pictures: its first pages */
        var withNames = pages.filter(function (p) { return p.named; });
        var chosen = (withNames.length ? withNames.sort(function (a, b) { return b.named - a.named; }) : pages.sort(function (a, b) { return a.num - b.num; })).slice(0, PDF_PAGES)
          .sort(function (a, b) { return a.num - b.num; });
        var batches = [];
        for (var k = 0; k < chosen.length; k += PAGES_PER_ASK) batches.push(chosen.slice(k, k + PAGES_PER_ASK));
        var found = [], got = {}, asked = 0;
        var chain = Promise.resolve();
        batches.forEach(function (batch) {
          chain = chain.then(function () {
            var names = speakers.filter(function (s) { return !got[s.id]; }).map(function (s) { return s.name; });
            if (!names.length) return null;
            asked += batch.length;
            say('ETB2B AI is looking for the speakers’ photos on ' + (chosen.length === 1 ? 'the page' : 'pages ' + batch.map(function (p) { return p.num; }).join(', ')) + '…');
            return Promise.all(batch.map(function (p) { return draw(p.page); })).then(function (drawn) {
              return X.C.findSpeakerPhotos(X.ev().id, names, drawn.map(function (d) { return { data: d.small, w: d.big.width, h: d.big.height }; })).then(function (r) {
                (r.found || []).forEach(function (f) {
                  var s = speakers.filter(function (x) { return key(x.name) === key(f.name) && !got[x.id]; })[0];
                  var d = drawn[f.page - 1];
                  if (!s || !d) return;
                  var c = d.big, b = f.box;
                  got[s.id] = true;
                  found.push({ speaker: s, data: square(c, { x: b.x0 * c.width, y: b.y0 * c.height, w: (b.x1 - b.x0) * c.width, h: (b.y1 - b.y0) * c.height }), page: batch[f.page - 1].num });
                });
              });
            });
          });
        });
        return chain.then(function () { return { found: found, pages: chosen.length, total: n }; });
      });
    });
  }
  /* a page drawn full size (for cutting photos out) and smaller (for ETB2B AI to look at) */
  function draw(page) {
    var v = page.getViewport({ scale: 1 }), scale = 1800 / Math.max(v.width, v.height);
    var vp = page.getViewport({ scale: scale });
    var big = doc.createElement('canvas'); big.width = Math.round(vp.width); big.height = Math.round(vp.height);
    return page.render({ canvasContext: big.getContext('2d'), viewport: vp }).promise.then(function () {
      var f = 1280 / Math.max(big.width, big.height), sm = doc.createElement('canvas');
      sm.width = Math.round(big.width * f); sm.height = Math.round(big.height * f);
      sm.getContext('2d').drawImage(big, 0, 0, sm.width, sm.height);
      return { big: big, small: sm.toDataURL('image/jpeg', 0.82).replace(/^data:image\/jpeg;base64,/, '') };
    });
  }

  /* ---------- Add photos ---------- */
  function photos(o) {
    o = o || {};
    var speakers = X.speakers().filter(function (s) { return s.id && str(s.name).trim(); });
    if (!speakers.length) { X.notifyError('Add the speakers first: their photos are matched to them by name.'); return; }
    var cands = [], seq = 0;   // { key, speakerId, data, from, use, file }
    var m = X.openModal(
      '<div class="modal-head"><h3>Add photos to ' + esc(X.words().many) + '</h3>' + X.closeBtn() + '</div>' +
      '<div class="modal-body st-body">' +
        '<div class="st-src">' +
          '<button class="btn btn-secondary btn-sm" type="button" id="ph-files">' + X.svg(X.IC.image, 13) + ' Choose photos</button>' +
          '<button class="btn btn-secondary btn-sm" type="button" id="ph-folder">' + X.svg(X.IC.image, 13) + ' Choose a folder</button>' +
          '<button class="btn btn-secondary btn-sm" type="button" id="ph-pdf">' + X.svg(X.IC.star, 13) + ' From a brochure (PDF)</button>' +
        '</div>' +
        '<p class="hint">Name each photo after its speaker (naven-singh.jpg) and it finds its speaker by itself. From a brochure, ETB2B AI finds each speaker’s photo beside their name. You see every photo here before anything is saved.</p>' +
        '<p class="st-status" id="ph-status" role="status" aria-live="polite"></p>' +
        '<ul class="st-list" id="ph-list"></ul>' +
      '</div>' +
      '<div class="modal-foot"><span class="modal-err" id="ph-err" role="alert"></span><button class="btn btn-secondary" type="button" data-close>Cancel</button>' +
        '<button class="btn btn-primary" type="button" id="ph-save" disabled>Save photos</button></div>',
      { cls: 'wide', isDirty: function () { return cands.some(function (c) { return c.use && c.speakerId; }); } });

    function say(t) { var el = $('ph-status'); if (el) el.textContent = t || ''; }
    function byId(id) { return speakers.filter(function (s) { return s.id === id; })[0] || null; }
    function paint() {
      var list = $('ph-list');
      if (!list) return;
      var matched = {};
      cands.forEach(function (c) { if (c.speakerId) matched[c.speakerId] = true; });
      list.innerHTML = cands.map(function (c) {
        var s = byId(c.speakerId), had = s && s.photo;
        var who = s ? '<b>' + esc(s.name) + '</b>' : '<select class="inp st-who" data-who="' + c.key + '" aria-label="Whose photo is “' + esc(c.from) + '”?"><option value="">Whose photo is this?</option>' +
          speakers.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + (x.photo ? ' (has a photo)' : '') + '</option>'; }).join('') + '</select>';
        return '<li class="st-row">' + '<span class="st-pic">' + X.imgTag(c.data) + '</span>' +
          '<span class="st-txt">' + who + '<span>' + esc(c.from) + '</span></span>' +
          (s ? '<label class="st-use"><input type="checkbox" data-use="' + c.key + '"' + (c.use ? ' checked' : '') + '><span>' + (had ? 'Replace their photo' : 'Use it') + '</span></label>' : '') + '</li>';
      }).join('');
      var missing = speakers.filter(function (s) { return !matched[s.id] && !s.photo; });
      if (cands.length && missing.length) list.innerHTML += '<li class="st-none">No photo yet for ' + esc(missing.slice(0, 12).map(function (s) { return s.name; }).join(', ')) + (missing.length > 12 ? ' and ' + (missing.length - 12) + ' more' : '') + '.</li>';
      Array.prototype.forEach.call(list.querySelectorAll('[data-use]'), function (b) { b.onchange = function () { cand(b.getAttribute('data-use')).use = b.checked; count(); }; });
      Array.prototype.forEach.call(list.querySelectorAll('[data-who]'), function (sel) {
        sel.onchange = function () { var c = cand(sel.getAttribute('data-who')), s2 = byId(sel.value); c.speakerId = sel.value; c.use = !!s2 && !s2.photo; paint(); };
      });
      count();
    }
    function cand(k) { return cands.filter(function (c) { return c.key === k; })[0]; }
    function count() {
      var n = cands.filter(function (c) { return c.use && c.speakerId; }).length, b = $('ph-save');
      if (!b) return;
      b.disabled = !n; b.textContent = n ? 'Save ' + n + (n === 1 ? ' photo' : ' photos') : 'Save photos';
    }
    function addCand(speaker, data, from) {
      /* a speaker given a second photo keeps the first one found */
      if (speaker && cands.some(function (c) { return c.speakerId === speaker.id; })) speaker = null;
      cands.push({ key: 'c' + (++seq), speakerId: speaker ? speaker.id : '', data: data, from: from, use: !!speaker && !speaker.photo });
    }
    function fromFiles(files) {
      files = files.filter(function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif)$/i.test(f.name); });
      if (!files.length) { say('No pictures among the files chosen.'); return; }
      say('Reading ' + files.length + (files.length === 1 ? ' photo' : ' photos') + '…');
      var bad = [];
      inTurns(files, 4, function (f) {
        return fileImage(f).then(function (img) { addCand(matchFile(f.name, speakers), square(img), 'from “' + f.name + '”'); }, function () { bad.push(f.name); });
      }).then(function () {
        var n = cands.filter(function (c) { return c.speakerId; }).length;
        say(n + ' of ' + files.length + (files.length === 1 ? ' photo matched to its speaker by name' : ' photos matched to their speakers by name') + (bad.length ? '; ' + bad.length + ' could not be read (' + bad.slice(0, 3).join(', ') + ')' : '') + '.');
        paint();
      });
    }
    function fromPdf(bytes, names) {
      var want = names && names.length ? speakers.filter(function (s) { return names.some(function (n) { return key(n) === key(s.name); }); }) : speakers.filter(function (s) { return !s.photo; });
      if (!want.length) want = speakers;
      $('ph-pdf').disabled = true;
      photosFromPdf(bytes, want, say).then(function (r) {
        r.found.forEach(function (f) { addCand(f.speaker, f.data, 'from the brochure, page ' + f.page); });
        say('ETB2B AI found ' + r.found.length + ' of ' + want.length + ' speakers’ photos on ' + r.pages + ' of the brochure’s ' + r.total + (r.total === 1 ? ' page' : ' pages') + '. Check each one.');
        paint();
      }, function (err) {
        say(''); $('ph-err').textContent = X.errText(err);
      }).then(function () { var b = $('ph-pdf'); if (b) b.disabled = false; });
    }
    $('ph-files').onclick = function () { pick('image/*', true, false).then(fromFiles); };
    $('ph-folder').onclick = function () { pick('image/*', true, true).then(fromFiles); };
    $('ph-pdf').onclick = function () {
      pick('application/pdf,.pdf', false, false).then(function (files) {
        var f = files[0];
        if (!f) return;
        if (f.size > 40 * 1024 * 1024) { $('ph-err').textContent = 'That PDF is over 40 MB. Save a smaller copy (only the speakers’ pages) and try again.'; return; }
        f.arrayBuffer().then(function (buf) { fromPdf(new Uint8Array(buf), null); });
      });
    };
    $('ph-save').onclick = function () {
      var todo = cands.filter(function (c) { return c.use && c.speakerId; }), done = 0, failed = [];
      m.busy(true, $('ph-save'));
      inTurns(todo, AT_ONCE, function (c) {
        return X.C.updateSub('speakers', X.ev().id, c.speakerId, { photoUrl: c.data }).then(function () { done++; }, function () { var s = byId(c.speakerId); failed.push(s ? s.name : '?'); });
      }).then(function () {
        X.reload();
        if (done) X.notify(done + (done === 1 ? ' photo saved' : ' photos saved'));
        if (!failed.length) { m.close(); return; }
        m.busy(false, $('ph-save'));
        $('ph-err').textContent = 'Not saved for ' + failed.join(', ') + '. Try again.';
      });
    };
    if (o.pdfData) fromPdf(bytesOf(o.pdfData), o.names);
    return m;
  }

  /* ---------- Paste a list ---------- */
  var HEADS = { name: /^(full\s*)?name|speaker/i, designation: /designation|title|role|position/i, company: /company|organi[sz]ation|org$|firm/i,
    group: /group|track|category|session|panel/i, linkedin: /linked\s*in/i };
  function parseList(text) {
    var lines = str(text).replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.replace(/ /g, ' ').trim(); }).filter(Boolean).slice(0, MAX_ROWS + 1);
    if (!lines.length) return [];
    var tabs = lines.some(function (l) { return l.indexOf('\t') !== -1; });
    function cells(l) {
      if (tabs) return l.split('\t').map(function (c) { return c.trim().replace(/^"|"$/g, ''); });
      if (l.indexOf('|') !== -1) return l.split('|').map(function (c) { return c.trim(); });
      var a = l.indexOf(','), z = l.lastIndexOf(',');
      if (a === -1) return [l];
      if (a === z) return [l.slice(0, a).trim(), l.slice(a + 1).trim()];            // "name, designation"
      return [l.slice(0, a).trim(), l.slice(a + 1, z).trim(), l.slice(z + 1).trim()];
    }
    var rows = lines.map(cells);
    var cols = { name: 0, designation: 1, company: 2, group: 3, linkedin: 4 };
    var first = rows[0];
    if (first.length > 1 && first.some(function (c) { return HEADS.name.test(c); }) && first.some(function (c) { return HEADS.designation.test(c) || HEADS.company.test(c); })) {
      cols = { name: -1, designation: -1, company: -1, group: -1, linkedin: -1 };
      first.forEach(function (c, i) { Object.keys(HEADS).forEach(function (k) { if (cols[k] === -1 && HEADS[k].test(c)) cols[k] = i; }); });
      rows = rows.slice(1);
    }
    return rows.slice(0, MAX_ROWS).map(function (r) {
      function at(k) { return cols[k] >= 0 ? str(r[cols[k]]).trim() : ''; }
      return { name: at('name').slice(0, 120), designation: at('designation').slice(0, 160), company: at('company').slice(0, 160), group: at('group').slice(0, 80), linkedin: at('linkedin').slice(0, 300) };
    }).filter(function (r) { return r.name && /[A-Za-zऀ-ॿ]/.test(r.name); });
  }
  function paste() {
    var W = X.words(), groups = X.groups(), rows = [], looked = {}, timer = null;
    var have = {};
    X.speakers().forEach(function (s) { have[key(s.name)] = true; });
    var groupSel = '<select class="inp" id="pl-group">' + groups.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>'; }).join('') +
      '<option value="__new">A new group…</option></select>';
    var m = X.openModal(
      '<div class="modal-head"><h3>Paste a list of ' + esc(W.many) + '</h3>' + X.closeBtn() + '</div>' +
      '<div class="modal-body st-body">' +
        '<div class="field"><label for="pl-text">Rows from Excel or Google Sheets</label>' +
          '<textarea class="inp" id="pl-text" rows="6" spellcheck="false" placeholder="Name	Designation	Company&#10;Naven Singh	Group CISO	Acme Bank&#10;&#10;or: Naven Singh, Group CISO, Acme Bank"></textarea>' +
          '<p class="hint">One ' + esc(W.one) + ' a row: name, designation, company (and a group, if you like). A first row of headings is fine. Each name is looked up in the speaker library for a photo and the details the row leaves out.</p></div>' +
        '<div class="field" style="margin-top:12px"><label for="pl-group">Add them to</label>' + (groups.length ? groupSel : '<input class="inp" id="pl-newgroup" value="' + esc(W.title) + '">') +
          '<input class="inp" id="pl-newname" placeholder="The new group’s name" hidden style="margin-top:8px"></div>' +
        '<p class="st-status" id="pl-status" role="status" aria-live="polite"></p>' +
        '<div class="st-table" id="pl-preview"></div>' +
      '</div>' +
      '<div class="modal-foot"><span class="modal-err" id="pl-err" role="alert"></span><button class="btn btn-secondary" type="button" data-close>Cancel</button>' +
        '<button class="btn btn-primary" type="button" id="pl-save" disabled>Add ' + esc(W.many) + '</button></div>',
      { cls: 'wide', isDirty: function () { return !!str(($('pl-text') || {}).value).trim(); }, initialFocus: '#pl-text' });

    function preview() {
      var host = $('pl-preview'), adding = rows.filter(function (r) { return !r.there; });
      if (!host) return;
      host.innerHTML = rows.length ? '<table><thead><tr><th></th><th>Name</th><th>Designation</th><th>Company</th><th></th></tr></thead><tbody>' + rows.map(function (r) {
        return '<tr' + (r.there ? ' class="st-skip"' : '') + '><td class="st-pic">' + (r.photo ? X.imgTag(r.photo) : '') + '</td><td><b>' + esc(r.name) + '</b>' + (r.group ? '<span class="st-g">' + esc(r.group) + '</span>' : '') + '</td>' +
          '<td>' + esc(r.designation) + '</td><td>' + esc(r.company) + '</td><td class="st-tag">' +
          (r.there ? 'Already on this event' : r.fromLib ? 'Filled in from the library' : looked[key(r.name)] === undefined ? 'Looking up…' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '';
      var b = $('pl-save');
      b.disabled = !adding.length;
      b.textContent = adding.length ? 'Add ' + adding.length + ' ' + (adding.length === 1 ? W.one : W.many) : 'Add ' + W.many;
      var lib = adding.filter(function (r) { return r.fromLib; }).length, there = rows.length - adding.length;
      $('pl-status').textContent = rows.length ? adding.length + ' to add' + (lib ? ', ' + lib + ' with a photo and details from the library (check they are the same people)' : '') + (there ? '; ' + there + ' already on this event' : '') + '.' : '';
    }
    /* one entry of exactly that name (and company, when the row gives one): it fills what the row left out */
    function lookUp(r) {
      var k = key(r.name);
      var ask = looked[k] !== undefined ? Promise.resolve(looked[k]) : X.C.searchLibrary('speakers', r.name, X.ev().id).then(function (res) { looked[k] = (res && res.items) || []; return looked[k]; }, function () { looked[k] = []; return []; });
      return ask.then(function (items) {
        var hits = items.filter(function (it) { return key(it.name) === k && (!r.company || !it.company || key(it.company) === key(r.company)); });
        if (hits.length !== 1) return;
        var it = hits[0], took = false;
        if (!r.designation && it.designation) { r.designation = it.designation; took = true; }
        if (!r.company && it.company) { r.company = it.company; took = true; }
        if (!r.linkedin && it.linkedin) { r.linkedin = it.linkedin; took = true; }
        if (it.photo) { r.photo = it.photo; took = true; }
        r.fromLib = took;
      });
    }
    function read() {
      rows = parseList($('pl-text').value);
      rows.forEach(function (r) { r.there = !!have[key(r.name)]; });
      var seen = {};
      rows.forEach(function (r) { var k = key(r.name); if (seen[k]) r.there = true; seen[k] = true; });   // a name pasted twice: once
      preview();
      inTurns(rows.filter(function (r) { return !r.there; }), AT_ONCE, function (r) { return lookUp(r).then(preview); });
    }
    $('pl-text').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(read, 400); });
    var gs = $('pl-group');
    if (gs) gs.onchange = function () { $('pl-newname').hidden = gs.value !== '__new'; if (gs.value === '__new') $('pl-newname').focus(); };
    $('pl-save').onclick = function () {
      var adding = rows.filter(function (r) { return !r.there; });
      var chosen = gs ? gs.value : '', newName = gs ? str($('pl-newname').value).trim() : str($('pl-newgroup').value).trim() || W.title;
      if (chosen === '__new' && !newName) { $('pl-err').textContent = 'Give the new group a name.'; $('pl-newname').focus(); return; }
      m.busy(true, $('pl-save'));
      var ev = X.ev().id, made = {}, order = X.nextOrder(), added = 0, failed = [];
      X.groups().forEach(function (g) { made[key(g.name)] = g.id; });
      function groupId(name) {
        var k = key(name);
        if (made[k]) return Promise.resolve(made[k]);
        return X.C.createSub('speaker-groups', ev, { name: name, order: X.groups().length + Object.keys(made).length + 1 }).then(function (r) { made[k] = r.id; return r.id; });
      }
      var def = chosen && chosen !== '__new' ? Promise.resolve(chosen) : groupId(newName);
      def.then(function (defId) {
        var jobs = adding.map(function (r) { order += 1; return { r: r, order: order }; });
        var chain = Promise.resolve();
        /* the groups the rows name are made one after another, first */
        adding.forEach(function (r) { if (r.group) chain = chain.then(function () { return groupId(r.group); }); });
        return chain.then(function () {
          return inTurns(jobs, AT_ONCE, function (j) {
            var r = j.r, body = { name: r.name, desig: r.designation, comp: r.company, status: 'confirmed', weight: 'featured', order: j.order,
              groupId: r.group ? made[key(r.group)] : defId, colour: X.AV[Math.floor(Math.random() * X.AV.length)] };
            if (r.photo) body.photoUrl = r.photo;
            if (r.linkedin) body.li = r.linkedin;
            return X.C.createSub('speakers', ev, body).then(function () { added++; r.there = true; }, function () { failed.push(r.name); });
          });
        });
      }).then(function () {
        X.reload();
        if (added) X.notify(added + ' ' + (added === 1 ? W.one : W.many) + ' added');
        if (!failed.length) { m.close(); return; }
        m.busy(false, $('pl-save'));
        preview();
        $('pl-err').textContent = 'Not added: ' + failed.join(', ') + '. Try again.';
      }, function (err) { m.busy(false, $('pl-save')); $('pl-err').textContent = X.errText(err); });
    };
    return m;
  }

  root.EditEventSpeakerTools = {
    init: function (ctx) { X = ctx; },
    paste: function () { return X ? paste() : null; },
    photos: function (o) { return X ? photos(o) : null; },
    _test: { parseList: parseList, matchFile: matchFile, key: key, nameWords: nameWords }
  };
})(window);
