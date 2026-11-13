/* create-event-prefill.js — Create Event's hand-off from ETB2B AI on the events dashboard.

   When someone asks ETB2B AI on the dashboard (Event_Listing.html) to start an event ("Create an IP event called
   Retail Leadership Summit on 12 Feb 2027 at Jio World Centre, Mumbai"), the dashboard writes what the server
   took from their own message to localStorage under an id the server made, and opens
   create-event.html?new=1&prefill=<id>. localStorage, not sessionStorage, so a Ctrl/Cmd-click into a new tab
   works too: a new tab starts with an empty sessionStorage.

     RevampPrefill.take(storage, id, nowMs)  -> the cleaned details, or null. Read once: the key is removed, and
                                                so is every other key of this kind older than ten minutes.
     RevampPrefill.decide(o)                 -> 'start' | 'apply' | 'ask'   what Create Event does with them
     RevampPrefill.apply(S, CATS, p[, opts]) -> { fields, values, unused, phase, thenDetails, notes }   fills a blank draft S
     RevampPrefill.describe(fields)          -> "name, date and venue"
     RevampPrefill.summary(result)           -> the sentence the page shows over step 1: the values it filled in
                                                ("IP event on ETCIO · QA Dashbot Expo · 12 Feb 2027 · Jio World Centre,
                                                Mumbai"), since the screen it opens on (the method) does not show them
                                                yet. The portal is named because the event may be on another one than
                                                the person works in (they asked for ETCIO while working in ETHRWorld).
     RevampPrefill.heroLine(o)               -> what the line about ETB2B AI's hero picture says: { text, can }
     RevampPrefill.takeFiles(store, id[, nowMs]) -> Promise<{ files, refused } | null>   the logo and brief file that
                                                came with the details (IndexedDB, RevampStore), read once and checked
                                                again with this page's own rules
     RevampPrefill.lastApplied()             -> { id, files } | null   what apply() last told the page, read once: the
                                                assistant starts after the page has filled its draft, so it reads this
                                                as well as listening for the event

   FILES (the owner, 5 Nov 2026: "don't forget to add attachment option in the AI Bot"). A logo picture and a brief
   PDF attached to "start a new event …" on another page come too. The prefill names them (p.files: [{ n, role:
   'logo'|'brief', name, type, size }]); the files themselves wait in this browser's IndexedDB under
   aihandoff:<id> (etb2b-assistant.js handoffFiles). apply() keeps the ones this page's own boxes take (a PNG, WEBP
   or SVG logo of up to 5 MB; a PDF of up to 15 MB), names them in the sentence over step 1, names any it cannot
   use, and then tells the page (window event 'revamp:prefill-applied' { id, files }, also kept for lastApplied(),
   since the assistant usually starts after this has happened). The assistant then puts each file into the page's
   own input (#f-logo, #gb-doc) once the form showing it is on screen, so the page's own checks and messages run.
   A brief file means the "Generate from a brief" path; nothing is generated until the person presses Generate, and
   that path makes no separate hero picture.

   A HERO PICTURE (the owner, 3 Nov 2026). An event ETB2B AI starts also asks for a first hero picture
   (p.hero = { subject }: the person's own words for it, or '' for the event's field, which its portal sets, and
   its place: portal-fields.js; never its name, which an image model letters onto the picture). It is held in
   the draft (S.aiHero) and shown over step 1 with Change and Remove; nothing is made until the event exists
   (Create Event's hand-off, then functions/lib/ai-hero.js). "Generate from a brief" makes its own pictures, an
   imported design keeps its own, and a banner the person uploads is theirs: none of them gets one.

   What arrives is checked again here with the same rules the server used (functions/lib/dash-bot.js cleanCreate):
   a value written into storage by hand, or by an older page, can never put an odd value into the draft, and
   anything the server kept is kept here too (dash-bot-handoff.test.js E.1 runs cleanCreate's output through
   take()). Nothing is ever made up: a field the message did not give stays empty for the person to fill in. Nothing
   is lost quietly either: a field that arrived but could not be used (a value no longer valid here, or one the
   chosen type's form has no place for) is named in the sentence over step 1. The one exception is said out loud:
   Create Event's date boxes take a time, and a message rarely gives one, so an exact date gets 9:00 am to 6:00 pm
   and the page says so.

   It never replaces an unfinished draft (decide answers 'ask'), never presses Generate, and never sets
   the discard parameter: the person decides each of those on the page.

   ES5 on purpose (var, function, no arrows): the page serves it as it is, with no build step. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.RevampPrefill = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  var PREFIX = 'revamp.createEvent.prefill.v1.';
  /* the files that came with the details (etb2b-assistant.js handoffFiles writes them, takeFiles reads them) */
  var FILES_PREFIX = 'aihandoff:', FILES_INDEX = 'aihandoff:index';
  /* what this page's own boxes take (create-event.html #f-logo and #gb-doc, BRIEF_DOC_MAX_BYTES); the assistant
     keeps the same rules on the page the files come from, and dash-bot-handoff.test.js holds the two together */
  var LOGO_TYPES = ['image/png', 'image/webp', 'image/svg+xml'], LOGO_MAX = 5 * 1024 * 1024;
  var BRIEF_TYPES = ['application/pdf'], BRIEF_DOC_MAX = 15 * 1024 * 1024;
  var FILE_NAME_MAX = 120;
  /* long enough to read the bot's card and click through; short enough that an old one never surprises anyone */
  var MAX_AGE_MS = 10 * 60 * 1000;
  /* one browser writes and reads, so its clock agrees with itself; a time well ahead of now is a broken value */
  var SKEW_MS = 60 * 1000;
  var ID_RE = /^[A-Za-z0-9]{10,40}$/;
  var CATEGORIES = ['IP', 'Client', 'Awards'];
  var ALL_DATE_MODES = ['exact', 'month', 'quarter', 'tbd', 'none'];
  /* the date formats each type allows, and its default, as create-event.html's CATS has them. A copy, because
     this file is read before the page's script; dash-bot-handoff.test.js E.1 holds the two together. apply()
     checks again against the page's own CATS. */
  var DATE_MODES = { IP: ['exact', 'month', 'quarter', 'tbd'], Client: ['none', 'exact', 'month', 'tbd'], Awards: ['exact', 'month', 'quarter', 'tbd'] };
  var DEFAULT_DATE_MODE = { IP: 'exact', Client: 'exact', Awards: 'month' };
  var TEXT_MAX = 120, URL_MAX = 500, BRIEF_MAX = 4000, SUBJECT_MAX = 200;
  var YEAR_MIN = 2000, YEAR_MAX = 2100;
  /* Create Event's Starts and Ends boxes are datetime-local: a date alone does not fit in them */
  var START_TIME = '09:00', END_TIME = '18:00';
  var LABELS = {
    category: 'event type', name: 'name', slug: 'web address', client: 'client', dates: 'date', venue: 'venue',
    city: 'city', brief: 'brief', current: 'this edition’s link', previous: 'previous edition’s link', portal: 'portal',
    hero: 'hero picture'
  };
  /* the event type as the dashboard's ETB2B AI card names it (dash-bot-client.js summary), so the two read alike */
  var KIND_WORDS = { IP: 'IP event', Client: 'Client event', Awards: 'Awards' };
  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function plain(o) { return !!o && typeof o === 'object' && Object.prototype.toString.call(o) === '[object Object]'; }

  /* one line of the person's own words: no control characters or line breaks, at most `max` characters */
  function line(v, max) {
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  }
  /* a pasted brief keeps its lines and tabs; every other control character goes */
  function briefText(v) {
    if (typeof v !== 'string') return '';
    return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, '').trim().slice(0, BRIEF_MAX);
  }
  /* The server's rule for a link (dash-bot.js cleanUrl), so a link it kept is never thrown away here: https: in any
     case ("Https://" from a phone's auto-capital), at most 500 characters, and one the browser's own URL parser
     reads (an apostrophe in the path, an underscore in the host: as the page takes them when typed). Kept word for
     word; the page shows it as the box's value, never as markup, and its own check (normalUrl) judges it there.
     A browser with no URL parser keeps nothing, and the note over step 1 names the link as not used. */
  function httpsUrl(v) {
    if (typeof v !== 'string') return '';
    v = v.trim();
    if (!v || v.length > URL_MAX || !/^https:\/\//i.test(v)) return '';
    try { new URL(v); } catch (e) { return ''; }
    return v;
  }
  /* the stored value says something: text with more than spaces, or any other value that is there (and not used) */
  function given(v) { return typeof v === 'string' ? v.trim() !== '' : v != null && v !== false; }
  /* a date was said: a day, a month, a quarter or year, or "to be announced" / "no date", which need none */
  function saysDate(b) {
    return given(b.start) || given(b.end) || given(b.month) || given(b.quarter) || given(b.year) || b.dateMode === 'tbd' || b.dateMode === 'none';
  }
  function validDay(y, m, d) {
    if (y < YEAR_MIN || y > YEAR_MAX || m < 1 || m > 12 || d < 1) return false;
    var days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= days[m - 1];
  }
  /* 'YYYY-MM-DD', or 'YYYY-MM-DDTHH:MM' should the server ever send a time: { day, time } or null */
  function dayTime(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/.exec(typeof v === 'string' ? v.trim() : '');
    if (!m || !validDay(+m[1], +m[2], +m[3])) return null;
    return { day: m[1] + '-' + m[2] + '-' + m[3], time: m[4] ? m[4] + ':' + m[5] : '' };
  }
  function moment(t) { return t ? t.day + (t.time ? 'T' + t.time : '') : ''; }
  /* '2027-02-12' or '2027-02-12T09:00' -> '12 Feb 2027' */
  function dayText(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof v === 'string' ? v : '');
    return m && +m[2] >= 1 && +m[2] <= 12 ? (+m[3]) + ' ' + MONTH_SHORT[+m[2] - 1] + ' ' + m[1] : '';
  }
  /* the date the draft now holds, in words, as the dashboard's card wrote it */
  function whenText(b) {
    if (b.dateMode === 'exact') {
      var s = dayText(b.start), e = String(b.end || '').slice(0, 10) !== String(b.start || '').slice(0, 10) ? dayText(b.end) : '';
      return s ? (e ? s + ' – ' + e : s) : '';
    }
    if (b.dateMode === 'month') {
      var mo = /^(\d{4})-(\d{2})$/.exec(String(b.month || ''));
      return mo ? MONTH_LONG[+mo[2] - 1] + ' ' + mo[1] : '';
    }
    if (b.dateMode === 'quarter') return [b.quarter, b.year].filter(function (x) { return !!x; }).join(' ');
    if (b.dateMode === 'tbd') return 'date to be decided';
    if (b.dateMode === 'none') return 'no date';
    return '';
  }
  function monthOf(v) {
    var m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(typeof v === 'string' ? v.trim() : '');
    return m && +m[1] >= YEAR_MIN && +m[1] <= YEAR_MAX ? m[0] : '';
  }
  function yearOf(v) {
    var s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
    return /^\d{4}$/.test(s) && +s >= YEAR_MIN && +s <= YEAR_MAX ? s : '';
  }

  /* The stored details as Create Event may use them, or null. `id` is the one in the address. */
  function clean(p, id, now) {
    if (!plain(p) || p.v !== 1 || p.from !== 'etb2b-ai' || p.prefillId !== id) return null;
    var at = typeof p.at === 'number' ? p.at : NaN;
    if (!isFinite(at) || now - at > MAX_AGE_MS || at - now > SKEW_MS) return null;
    var category = CATEGORIES.indexOf(p.category) !== -1 ? p.category : '';
    var b = plain(p.basics) ? p.basics : {}, br = plain(p.brief) ? p.brief : {};

    /* the date: the format first (one the type allows, else the type's default, as pickCategory does), then only
       the values that format shows, so nothing hidden is carried into the draft */
    var start = dayTime(b.start), end = start ? dayTime(b.end) : null;
    if (start && end && (end.day < start.day || (end.day === start.day && start.time && end.time && end.time < start.time))) end = null;
    var month = monthOf(b.month), quarter = typeof b.quarter === 'string' && /^Q[1-4]$/.test(b.quarter) ? b.quarter : '', year = yearOf(b.year);
    var mode = ALL_DATE_MODES.indexOf(b.dateMode) !== -1 ? b.dateMode : '';
    if (!mode) mode = start ? 'exact' : month ? 'month' : (quarter && year) ? 'quarter' : '';
    if (mode && category && DATE_MODES[category].indexOf(mode) === -1) mode = DEFAULT_DATE_MODE[category];
    var basics = {
      name: line(b.name, TEXT_MAX), client: line(b.client, TEXT_MAX), dateMode: mode,
      start: mode === 'exact' ? moment(start) : '', end: mode === 'exact' ? moment(end) : '',
      month: mode === 'month' ? month : '',
      quarter: mode === 'quarter' ? quarter : '', year: mode === 'quarter' ? year : '',
      venue: line(b.venue, TEXT_MAX), city: line(b.city, TEXT_MAX)
    };

    /* the files named with the details: one logo and one brief file, each one this page's own box takes */
    var files = cleanFileList(p.files);
    var briefFile = false;
    files.kept.forEach(function (f) { if (f.role === 'brief') briefFile = true; });
    /* "Generate from a brief" needs something to generate from; the person's brief, link or brief file means that path */
    var brief = { text: briefText(br.text), current: httpsUrl(br.current), previous: httpsUrl(br.previous) };
    var hasBrief = !!(brief.text || brief.current || brief.previous || briefFile);
    var method = p.method === 'brief' || p.method === 'template' ? p.method : '';
    if (method === 'brief' && !hasBrief) method = '';
    if (!method && hasBrief) method = 'brief';
    if (method !== 'brief') brief = { text: '', current: '', previous: '' };
    /* a brief file belongs to the brief path; on the template path it is named as not used */
    if (method !== 'brief') {
      files.kept = files.kept.filter(function (f) {
        if (f.role !== 'brief') return true;
        files.refused.push({ role: 'brief', name: f.name, why: 'path' });
        return false;
      });
    }
    var portal = typeof p.portal === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(p.portal) ? p.portal : '';
    /* the hero picture asked for: its subject one line of the person's words, or '' (the event's field and place);
       none on the brief path, which makes the site's pictures itself */
    var hero = plain(p.hero) && method !== 'brief' ? { subject: line(p.hero.subject, SUBJECT_MAX) } : null;

    /* what arrived and is not kept, by LABELS key: apply() passes it on, and the note over step 1 names it */
    var dropped = [];
    function lost(k, raw, kept) { if (given(raw) && !kept && dropped.indexOf(k) === -1) dropped.push(k); }
    lost('category', p.category, category);
    lost('name', b.name, basics.name);
    lost('client', b.client, basics.client);
    var keptDate = !!(basics.start || basics.month || basics.quarter || basics.year) ||
      ((basics.dateMode === 'tbd' || basics.dateMode === 'none') && basics.dateMode === b.dateMode);
    if (saysDate(b) && !keptDate) dropped.push('dates');
    lost('venue', b.venue, basics.venue);
    lost('city', b.city, basics.city);
    lost('brief', br.text, brief.text);
    lost('current', br.current, brief.current);
    lost('previous', br.previous, brief.previous);
    lost('portal', p.portal, portal);

    return {
      v: 1, from: 'etb2b-ai', at: at, prefillId: id,
      turnId: typeof p.turnId === 'string' && ID_RE.test(p.turnId) ? p.turnId : '',
      category: category, method: method, portal: portal,
      basics: basics, brief: brief, hero: hero, dropped: dropped,
      files: { kept: files.kept, refused: files.refused }
    };
  }

  /* ---------- the files that came with the details ---------- */
  function fileName(v) { var s = line(String(v == null ? '' : v).split(/[\\/]/).pop(), FILE_NAME_MAX); return s || 'file'; }
  function extOf(name) { var m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  /* the type this page's box would see: the one given, else the name's ending (an SVG often has none) */
  function fileType(t, name) {
    t = typeof t === 'string' ? t.toLowerCase() : '';
    if (t) return t;
    return { png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[extOf(name)] || '';
  }
  /* '' when this page's own box takes a file of this role, type and size, else why not ('type' | 'size') */
  function fileFits(role, type, size) {
    var types = role === 'logo' ? LOGO_TYPES : BRIEF_TYPES, max = role === 'logo' ? LOGO_MAX : BRIEF_DOC_MAX;
    if (types.indexOf(type) === -1) return 'type';
    if (!(size > 0) || size > max) return 'size';
    return '';
  }
  /* [{ n, role, name, type, size }] as the assistant names them -> { kept, refused }: at most one of each role */
  function cleanFileList(list) {
    var kept = [], refused = [], seen = {};
    (Array.isArray(list) ? list : []).slice(0, 4).forEach(function (f) {
      if (!plain(f) || (f.role !== 'logo' && f.role !== 'brief') || seen[f.role]) return;
      seen[f.role] = true;
      var name = fileName(f.name), type = fileType(f.type, f.name), size = typeof f.size === 'number' && isFinite(f.size) ? f.size : 0;
      var why = fileFits(f.role, type, size);
      if (why) { refused.push({ role: f.role, name: name, why: why }); return; }
      kept.push({ n: typeof f.n === 'number' && f.n >= 1 && f.n <= 4 ? Math.floor(f.n) : 0, role: f.role, name: name, type: type, size: size });
    });
    return { kept: kept, refused: refused };
  }
  function isBlob(b) {
    if (!b || typeof b !== 'object') return false;
    if (typeof Blob !== 'undefined' && b instanceof Blob) return true;
    return typeof b.size === 'number' && typeof b.slice === 'function';
  }
  /* The index of what is kept ({ v:1, keys: { id: at } }), so a file nobody came for is removed after ten minutes */
  function sweepFiles(store, now, take) {
    return Promise.resolve(store.get(FILES_INDEX)).then(null, function () { return null; }).then(function (ix) {
      var keys = plain(ix) && plain(ix.keys) ? ix.keys : {}, keep = {}, gone = [];
      Object.keys(keys).forEach(function (k) {
        var at = +keys[k];
        if (k !== take && isFinite(at) && now - at <= MAX_AGE_MS && at - now <= SKEW_MS) keep[k] = at; else if (k !== take) gone.push(k);
      });
      return Promise.all(gone.map(function (k) { return Promise.resolve(store.remove(FILES_PREFIX + k)).then(null, function () { return null; }); }))
        .then(function () { return store.put(FILES_INDEX, { v: 1, keys: keep }); });
    }).then(null, function () { return null; });
  }
  /* The logo and brief file kept for this id, read once (the record is removed whatever it holds), checked again
     with this page's own rules: { files: [{ role, name, type, size, blob }], refused: [{ role, name, why }] }, or
     null when there is none, it is older than ten minutes, or the store cannot be read. store: RevampStore. */
  function takeFiles(store, id, now) {
    if (!store || typeof store.get !== 'function' || typeof store.remove !== 'function' || typeof store.put !== 'function') return Promise.resolve(null);
    if (typeof id !== 'string' || !ID_RE.test(id)) return Promise.resolve(null);
    now = typeof now === 'number' && isFinite(now) ? now : Date.now();
    var key = FILES_PREFIX + id;
    return Promise.resolve(store.get(key)).then(function (rec) {
      return Promise.resolve(store.remove(key)).then(null, function () { return null; }).then(function () {
        return sweepFiles(store, now, id);
      }).then(function () {
        if (!plain(rec) || rec.v !== 1 || typeof rec.at !== 'number' || now - rec.at > MAX_AGE_MS || rec.at - now > SKEW_MS || !Array.isArray(rec.files)) return null;
        var files = [], refused = [], seen = {};
        rec.files.slice(0, 4).forEach(function (f) {
          if (!plain(f) || (f.role !== 'logo' && f.role !== 'brief') || seen[f.role] || !isBlob(f.blob)) return;
          seen[f.role] = true;
          var name = fileName(f.name), type = fileType(f.type || f.blob.type, f.name), size = f.blob.size;
          var why = fileFits(f.role, type, size);
          if (why) { refused.push({ role: f.role, name: name, why: why }); return; }
          files.push({ role: f.role, name: name, type: type, size: size, blob: f.blob });
        });
        return { files: files, refused: refused };
      });
    }, function () { return null; });
  }
  /* What apply() last told the page, kept until the assistant reads it (lastApplied). Create Event fills its draft
     as soon as the page has loaded, before the assistant has started (it waits for the sign-in check), so the
     event below has nobody listening yet on a normal load: the assistant reads this instead. */
  var lastAnnounced = null;
  function lastApplied() {
    var d = lastAnnounced;
    lastAnnounced = null;
    return d ? { id: d.id, files: d.files.map(function (f) { return { role: f.role, name: f.name }; }) } : null;
  }
  /* tells the page's assistant which files to put into its boxes (a browser only; nothing in node) */
  function announce(id, files) {
    var detail = { id: id, files: files.map(function (f) { return { role: f.role, name: f.name }; }) };
    lastAnnounced = detail;
    if (!root || typeof root.dispatchEvent !== 'function') return;
    var ev = null;
    try { ev = new root.CustomEvent('revamp:prefill-applied', { detail: detail }); } catch (e) {
      try { ev = root.document.createEvent('CustomEvent'); ev.initCustomEvent('revamp:prefill-applied', false, false, detail); } catch (e2) { ev = null; }
    }
    if (!ev) return;
    try { root.dispatchEvent(ev); } catch (e) { /* a listener's own trouble never stops the page */ }
  }

  /* every other key of this kind that can no longer be used: older than ten minutes, or unreadable */
  function sweep(storage, now, keep) {
    var keys = [], i, k;
    try {
      for (i = 0; i < storage.length; i++) {
        k = storage.key(i);
        if (typeof k === 'string' && k.indexOf(PREFIX) === 0 && k !== keep) keys.push(k);
      }
    } catch (e) { return; }
    keys.forEach(function (key) {
      var at = NaN;
      try {
        var v = JSON.parse(storage.getItem(key));
        if (plain(v) && typeof v.at === 'number') at = v.at;
      } catch (e) { /* unreadable: it goes */ }
      if (isFinite(at) && now - at <= MAX_AGE_MS && at - now <= SKEW_MS) return;
      try { storage.removeItem(key); } catch (e) { /* storage refused: nothing more to do */ }
    });
  }

  function take(storage, id, now) {
    if (!storage) return null;
    now = typeof now === 'number' && isFinite(now) ? now : Date.now();
    var valid = typeof id === 'string' && ID_RE.test(id), key = valid ? PREFIX + id : '';
    sweep(storage, now, key);
    if (!valid) return null;
    var raw = null;
    try { raw = storage.getItem(key); } catch (e) { return null; }
    /* read once, whatever it holds: a reload or a second tab never fills a second draft from it */
    try { storage.removeItem(key); } catch (e) { /* storage refused: it ages out */ }
    if (raw == null) return null;
    var p = null;
    try { p = JSON.parse(raw); } catch (e) { return null; }
    return clean(p, id, now);
  }

  /* o: { startNew, prefill, stored, hasInput, discard }. With no prefill the page does what it always did ('start').
     With one, a stored draft that holds anything its owner entered is asked about first ('ask'); otherwise the
     prefill fills a new draft ('apply'). The discard parameter never skips that question for a prefill: the bot never sets
     it, and nothing may silently replace an unfinished event. */
  function decide(o) {
    o = o || {};
    if (!o.prefill) return 'start';
    return o.stored && o.hasInput ? 'ask' : 'apply';
  }

  /* Fills the blank draft S (create-event.html's state) from p, a take() result. CATS is the page's own.
     opts.slugify: the page's; the web address then follows the name, as when it is typed (slugTouched stays
     false). opts.portalName: the page's (a slug -> "ETCIO", or '' while its name is not known), so the note over
     step 1 names the portal filled in. Returns { fields: what was filled, unused: what arrived and was not filled
     (take()'s dropped, and what this type's form has no place for), phase: where step 1 opens, thenDetails: a brief is waiting for its
     type, so picking one opens the brief form, notes: what was assumed }.
     A brief with no type opens the type picker as a first choice, exactly as a new event does (catReturnPhase stays
     null: no type is shown as chosen, and there is nothing to cancel back to). The page keeps thenDetails with the
     draft (S.aiPrefill) for its pickCategory. */
  function apply(S, CATS, p, opts) {
    opts = opts || {};
    var fields = [], notes = [], unused = [];
    function notUsed(k) { if (own(LABELS, k) && unused.indexOf(k) === -1) unused.push(k); }
    if (!S || !plain(S.basics) || !p || !CATS) return { fields: fields, unused: unused, phase: (S && S.step1Phase) || 'category', thenDetails: false, notes: notes };
    var b = S.basics, pb = plain(p.basics) ? p.basics : {}, br = plain(p.brief) ? p.brief : {};
    (Array.isArray(p.dropped) ? p.dropped : []).forEach(notUsed);
    var hasCat = !!(p.category && own(CATS, p.category));
    var brief = p.method === 'brief';
    if (hasCat) { b.category = p.category; fields.push('category'); }
    else if (p.category) notUsed('category');
    var C = CATS[b.category] || {}, modes = C.dateModes || ALL_DATE_MODES;

    if (pb.name) {
      b.name = pb.name;
      fields.push('name');
      if (typeof opts.slugify === 'function' && !b.slugTouched && !S.createdEventId) {
        b.slug = opts.slugify(pb.name);
        if (b.slug) fields.push('slug');
      }
    }
    /* a client is asked for only by the types that have one, and not on the brief form: it is never kept hidden */
    if (pb.client && C.client && !brief) { b.client = pb.client; fields.push('client'); }
    else if (pb.client) notUsed('client');

    if (pb.dateMode && modes.indexOf(pb.dateMode) !== -1) b.dateMode = pb.dateMode;
    if (modes.indexOf(b.dateMode) === -1) b.dateMode = C.defaultDateMode || modes[0];
    var dated = false;
    if (b.dateMode === 'exact' && pb.start) {
      var s = dayTime(pb.start), e = dayTime(pb.end);
      if (s) {
        if (!s.time) notes.push('times-assumed');
        if (!e) { notes.push('end-assumed'); e = { day: s.day, time: '' }; }
        else if (!e.time && notes.indexOf('times-assumed') === -1) notes.push('times-assumed');
        b.start = s.day + 'T' + (s.time || START_TIME);
        b.end = e.day + 'T' + (e.time || END_TIME);
        if (b.end < b.start) b.end = b.start;     // a start given at 7 pm with no end: it ends when it starts, for the person to set
        dated = true;
      }
    }
    else if (b.dateMode === 'month' && pb.month) { b.month = pb.month; dated = true; }
    else if (b.dateMode === 'quarter' && (pb.quarter || pb.year)) {
      if (pb.quarter) b.quarter = pb.quarter;
      if (pb.year) b.year = pb.year;
      dated = true;
    }
    else if ((b.dateMode === 'tbd' || b.dateMode === 'none') && pb.dateMode === b.dateMode) dated = true;
    if (dated) fields.push('dates');
    else if (saysDate(pb)) notUsed('dates');

    /* the venue and the city, each in its own field */
    var place = pb.venue || '';
    var withCity = !!pb.city;
    if ((place || withCity) && C.venue !== false) {
      if (place) { b.venue = place; fields.push('venue'); }
      if (withCity) { b.city = pb.city; fields.push('city'); }
    }
    else if (place || withCity) {
      if (pb.venue) notUsed('venue');
      if (withCity) notUsed('city');
    }

    if (brief) {
      if (!plain(S.brief)) S.brief = {};
      if (br.text) { S.brief.text = br.text; fields.push('brief'); }
      if (br.current) { S.brief.current = br.current; fields.push('current'); }
      if (br.previous) { S.brief.previous = br.previous; S.brief.etEvent = null; fields.push('previous'); }
    }
    /* the portal box exists once the portals change is in (S.basics.portal); before that the page has no portal at
       all, so there is nothing the person could fill it into either, and it is not named as left out */
    if (p.portal && own(b, 'portal')) { b.portal = p.portal; fields.push('portal'); }
    /* the hero picture request goes into the draft (the page's S has an aiHero slot); it is made only once the
       event is created, and the line over step 1 says so */
    if (plain(p.hero) && own(S, 'aiHero') && !brief) {
      S.aiHero = { subject: line(p.hero.subject, SUBJECT_MAX), removed: false, made: null, note: '', turnId: typeof p.turnId === 'string' ? p.turnId : '', at: typeof p.at === 'number' ? p.at : 0 };
      fields.push('hero');
    }

    /* the values themselves, for the note over step 1: the screen it opens on does not show them yet (the place as one
       line: the venue, then the city unless the venue names it) */
    function placeText(venue, city) {
      venue = String(venue || '').trim(); city = String(city || '').trim();
      return venue && city && venue.toLowerCase().indexOf(city.toLowerCase()) !== -1 ? venue : [venue, city].filter(Boolean).join(', ');
    }
    function has(k) { return fields.indexOf(k) !== -1; }
    var links = (has('current') ? 1 : 0) + (has('previous') ? 1 : 0);
    var portalName = '';
    if (has('portal') && typeof opts.portalName === 'function') { try { portalName = line(String(opts.portalName(b.portal) || ''), 60); } catch (e) { portalName = ''; } }
    var values = {
      kind: has('category') ? (KIND_WORDS[b.category] || '') : '', portal: portalName, name: has('name') ? b.name : '', slug: has('slug') ? b.slug : '',
      when: has('dates') ? whenText(b) : '', place: has('venue') || has('city') ? placeText(b.venue, b.city) : '', client: has('client') ? b.client : '',
      brief: has('brief'), links: links
    };

    S.step = 1;
    S.catReturnPhase = null;
    var thenDetails = false;
    if (hasCat && brief) { S.creationMethod = 'brief'; S.step1Phase = 'details'; }
    else if (hasCat) S.step1Phase = 'method';
    /* the type is still to be chosen, as a first choice; picking it goes straight on to the brief form */
    else if (brief) { S.creationMethod = 'brief'; S.step1Phase = 'category'; thenDetails = true; }
    else S.step1Phase = 'category';

    /* The files that came with the details: a logo on any path, a brief file on the brief path. They are not put in
       the draft here: the page's own boxes take them (with their own checks) once its form is on screen. */
    var pf = plain(p.files) ? p.files : {};
    var keptFiles = [], refusedFiles = [];
    (Array.isArray(pf.kept) ? pf.kept : []).forEach(function (f) {
      if (!plain(f) || (f.role !== 'logo' && f.role !== 'brief')) return;
      if (f.role === 'brief' && !brief) { refusedFiles.push({ role: 'brief', name: fileName(f.name), why: 'path' }); return; }
      keptFiles.push({ role: f.role, name: fileName(f.name) });
    });
    (Array.isArray(pf.refused) ? pf.refused : []).forEach(function (f) {
      if (plain(f) && (f.role === 'logo' || f.role === 'brief')) refusedFiles.push({ role: f.role, name: fileName(f.name), why: f.why === 'path' || f.why === 'size' ? f.why : 'type' });
    });
    var out = { fields: fields, values: values, unused: unused, phase: S.step1Phase, thenDetails: thenDetails, notes: notes,
      files: { kept: keptFiles, refused: refusedFiles } };
    if (typeof p.prefillId === 'string' && ID_RE.test(p.prefillId)) announce(p.prefillId, keptFiles);
    return out;
  }

  /* "IP event on ETCIO · QA Dashbot Expo · 12 Feb 2027 · Jio World Centre, Mumbai", or '' with no values to show.
     The portal goes with the type ("Event on ETCIO" while the type is still to be chosen). */
  function valuesLine(v) {
    if (!plain(v)) return '';
    var bits = [], kind = typeof v.kind === 'string' ? v.kind : '', portal = typeof v.portal === 'string' ? v.portal : '';
    if (portal) bits.push((kind || 'Event') + ' on ' + portal);
    else if (kind) bits.push(kind);
    ['name', 'when', 'place'].forEach(function (k) { if (typeof v[k] === 'string' && v[k]) bits.push(v[k]); });
    if (typeof v.client === 'string' && v.client) bits.push('for ' + v.client);
    if (v.brief === true) bits.push('your brief');
    if (v.links === 1) bits.push('your link');
    else if (v.links === 2) bits.push('your two links');
    return bits.join(' · ');
  }

  function describe(fields) {
    var words = [];
    (fields || []).forEach(function (f) { if (own(LABELS, f) && words.indexOf(LABELS[f]) === -1) words.push(LABELS[f]); });
    if (words.length < 2) return words.join('');
    return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
  }

  /* what the sentence over step 1 says about the files: where the kept ones go, and why any other was not used */
  function filesText(res) {
    var f = plain(res.files) ? res.files : {}, kept = Array.isArray(f.kept) ? f.kept : [], refused = Array.isArray(f.refused) ? f.refused : [];
    var logo = null, doc = null, out = '';
    kept.forEach(function (x) { if (plain(x) && x.role === 'logo') logo = x; else if (plain(x) && x.role === 'brief') doc = x; });
    var where = res.phase === 'details' ? 'on the form below' : 'on the details form';
    if (logo && doc) out += ' Your logo “' + logo.name + '” and your brief document “' + doc.name + '” go into their boxes ' + where + '.';
    else if (logo) out += ' Your logo “' + logo.name + '” goes into its box ' + where + '.';
    else if (doc) out += ' Your brief document “' + doc.name + '” goes into the Overview document box ' + where + '.';
    refused.forEach(function (x) {
      if (!plain(x)) return;
      if (x.role === 'logo') out += ' The logo “' + x.name + '” wasn’t used: Create Event takes a PNG, WEBP or SVG logo of up to 5 MB.';
      else if (x.why === 'path') out += ' The brief document “' + x.name + '” wasn’t used: it is read only when the site is generated from a brief.';
      else out += ' The brief document “' + x.name + '” wasn’t used: the Overview document takes a PDF of up to 15 MB.';
    });
    return out;
  }

  function summary(res) {
    res = res || {};
    var fields = res.fields || [], notes = res.notes || [], left = describe(res.unused || []);
    /* said plainly, not as a task: some cannot be typed in at all (a client on an event type that has none) */
    var notUsed = (left ? ' Not used from your message: ' + left + '.' : '') + filesText(res);
    if (!fields.length) return 'ETB2B AI started a new event for you, but nothing in your message could be filled in. Choose its type to begin.' + notUsed;
    /* the values themselves (the type picker and the method screen do not show them), or, from a caller without
       them, the fields' names */
    var out = 'Filled in by ETB2B AI from your message: ' + (valuesLine(res.values) || describe(fields)) + '.';
    /* the one value the person did not type: said, so it is not taken for theirs */
    var slug = plain(res.values) && typeof res.values.slug === 'string' ? res.values.slug : '';
    if (slug) out += ' Its web address, ' + slug + ', was made from the name.';
    /* where the filled-in fields are on screen: the type and the method come first */
    if (res.phase === 'category') out += res.thenDetails ? ' Choose the event type, and your brief opens with them.' : ' Choose the event type, then check them.';
    else if (res.phase === 'method') out += ' Choose how to build your site, then check them on the details form.';
    else out += ' Check them and continue.';
    var times = notes.indexOf('times-assumed') !== -1, end = notes.indexOf('end-assumed') !== -1;
    if (times && end) out += ' Your message gave no end or times, so it is set for that one day, 9:00 am to 6:00 pm: change them if needed.';
    else if (times) out += ' Your message gave no times, so it starts at 9:00 am and ends at 6:00 pm: change them if needed.';
    else if (end) out += ' Your message gave no end, so it ends at 6:00 pm that day: change it if needed.';
    return out + notUsed;
  }

  /* What the line over step 1 says about ETB2B AI's hero picture, from the draft as it is now.
     o: { hero: S.aiHero, method: S.creationMethod, ownBanner: the draft has a banner picture of its own,
          noSlot: the chosen design has no hero picture,
          subject: what the picture is of when the person gave no words: the event's field and place as they are now
                   (portal-fields.js subject: "technology leadership, Jio World Centre, Mumbai"),
          from: { portal: the event is on a portal of the table, place: it has a venue or city } — what that subject
                was made from, said after it so nobody looks for the event's name in the picture }
     -> { text, can: 'change' (Change and Remove) | 'restore' (Make one after all) | '' (nothing to do) } or null
        when there is no request. Every reason none will be made is said, never left to be guessed. */
  function heroLine(o) {
    o = o || {};
    var h = o.hero;
    if (!plain(h)) return null;
    var made = plain(h.made) && typeof h.made.url === 'string' && !!h.made.url;
    /* a picture already made goes to the editor only while the draft is still on the template path with no banner
       of the person's own (create-event.html aiHeroForHandoff); otherwise the lines below say why it is not used */
    if (made && !o.ownBanner && o.method !== 'brief' && o.method !== 'imported') {
      return { text: 'ETB2B AI made this event\u2019s hero picture' + (h.made.subject ? ': ' + h.made.subject : '') + '. It is in the editor, where Undo puts the design\u2019s own picture back.', can: '' };
    }
    if (made && o.ownBanner) return { text: 'You added your own banner picture, so it is used instead of the hero picture ETB2B AI made.', can: '' };
    if (h.removed === true) return { text: 'ETB2B AI won\u2019t make a hero picture for this event.', can: 'restore' };
    if (o.method === 'brief') return { text: 'Generate from a brief makes the site\u2019s pictures itself, so ETB2B AI won\u2019t make a separate hero picture.', can: '' };
    if (o.method === 'imported') return { text: 'An imported design keeps its own pictures, so ETB2B AI won\u2019t make a hero picture.', can: '' };
    if (o.ownBanner) return { text: 'You added your own banner picture, so ETB2B AI won\u2019t make one.', can: '' };
    if (o.noSlot) return { text: 'This design has no hero picture, so ETB2B AI won\u2019t make one.', can: '' };
    var own = line(h.subject, SUBJECT_MAX), auto = line(o.subject, SUBJECT_MAX), from = plain(o.from) ? o.from : {};
    var basis = from.portal && from.place ? 'from the event\u2019s portal and place' : from.portal ? 'from the event\u2019s portal'
      : from.place ? 'from the event\u2019s place: it has no portal yet' : 'it has no portal or place yet';
    var what = own ? own : auto ? auto + ' (' + basis + ')' : 'from the event\u2019s portal and place, once you have chosen them';
    return { text: 'ETB2B AI will make a hero picture: ' + what + '. Nothing is made until your event is created.', can: 'change' };
  }

  return {
    PREFIX: PREFIX, MAX_AGE_MS: MAX_AGE_MS, ID_RE: ID_RE, DATE_MODES: DATE_MODES, DEFAULT_DATE_MODE: DEFAULT_DATE_MODE, SUBJECT_MAX: SUBJECT_MAX,
    FILES_PREFIX: FILES_PREFIX, FILES_INDEX: FILES_INDEX, LOGO_TYPES: LOGO_TYPES, LOGO_MAX: LOGO_MAX, BRIEF_TYPES: BRIEF_TYPES, BRIEF_DOC_MAX: BRIEF_DOC_MAX,
    take: take, decide: decide, apply: apply, describe: describe, summary: summary, heroLine: heroLine, takeFiles: takeFiles,
    lastApplied: lastApplied
  };
});
