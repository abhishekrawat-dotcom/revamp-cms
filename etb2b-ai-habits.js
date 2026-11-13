/* etb2b-ai-habits.js — ETB2B AI learns, part 1, in the browser (window.RevampAiHabits; owner decision 11, 8 Nov 2026,
   ~/.revamp-cms-qa/ai-learning/SPEC.md): what makes the one ETB2B AI panel faster for the person using it.

   The assistant's shell (etb2b-assistant.js) loads this file once its panel is up, on every page that carries it, and
   hands it a hub (attach). Then:

     ONE-CLICK SUGGESTIONS. The panel's row above the box (the kit's setChips) shows up to four chips of what THIS
       PERSON asks most often on this page; with too little of their own, the team's for this kind of event (IP, Client,
       Awards) fill it (functions/lib/ai-habits.js GET /api/ai-habits works them out from the record of what people ask,
       and leaves out what is often undone). One click SENDS that request here, through the same panel as a typed
       message: the AI does it, with its Undo (do it, then undo). The row is locked while an answer is awaited, is
       short at a phone's width (each chip cut with …, its whole request in its title) and works by keyboard (Tab,
       and the arrow keys along it). On Promotions, while a post or a mail is open in "Edit with AI", the row is that
       editor's. Read when the panel first opens, and again after a turn (at most every REFRESH_MS).
     SAVE AS SHORTCUT. Under an answer that did what was asked (a change kept, a page opened, a question answered),
       "Save as shortcut" names the request and keeps it for this person (POST /api/ai-habits/shortcuts): a new
       shortcut, or one more request in one they have ("My launch set" = save-the-date post + announcement mailer +
       the site's banner).
     SHORTCUTS. "Shortcuts" at the end of the row lists the person's own, in the conversation: Run, Rename, Delete.
       Running one sends each request in order on the event this page is about, waiting for each answer; each answer
       has its own Undo, and the run ends with a list of its requests, Undo per request and Undo all (newest first,
       through the very handlers the brains bind their own Undo to: brain.undoHandle, so both say "Undone"). A request
       that opens another page (the dash brain's "Opening … · Stay here") carries the rest of the run to that page,
       which goes on with it only when it is about the same event (owner decision 10: fail closed) and only soon after
       (RUN_KEEP_MS); Stay here keeps the run on this page. Stop, or a failure that cannot be tried again, ends it.
     LOCKED TO THE EVENT. Nothing here decides what an answer may touch: every request goes through the brains, which
     the server and the page keep on this page's event. The server only ever suggests words asked on this very event.

   Browser storage (optional; with storage blocked a run simply stays on its page)
     sessionStorage  rv.aiHabits.run   { v, id, name, eventId, page, at, i, steps: [{ text, state }] }  a run carried to
                                      the page one of its requests opened; read once there, removed when it ends

   ES5 on purpose (var, function, promises), as every page script: served as it is, with no build step. */
(function (root) {
  'use strict';

  var doc = root.document;
  var HABITS_URL = '/api/ai-habits', SHORTCUTS_URL = '/api/ai-habits/shortcuts';
  var RUN_KEY = 'rv.aiHabits.run';
  var RUN_KEEP_MS = 90000;      // a run carried to another page goes on there only this soon after its last request
  var REFRESH_MS = 30000;       // the suggestions are read again after a turn at most this often
  var STILL_HERE_MS = 12000;    // after an "Opening …" ran out, the page is taken to have stayed when it is still here
  var POLL_MS = 200;
  var MAX_STEPS = 6;            // as functions/lib/ai-habits.js CAPS.steps
  var NAME_CHARS = 40;
  var TURN_ID = /^[A-Za-z0-9]{10,40}$/;
  var EVENT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
  /* the dash brain's notes that mean it could not do what was asked (functions/lib/ai-learn.js DASH_COULD_NOT) */
  var COULD_NOT = { 'not-found': 1, 'unknown-event': 1, 'unknown-template': 1, 'unknown-kind': 1, 'totals-unavailable': 1, 'totals-timeout': 1 };
  /* the dash brain's answers that did nothing to keep: a refusal, a question back, an undo, a handoff */
  var DASH_NOT = { refuse: 1, choose: 1, undo: 1, handoff: 1, stopped: 1, ask: 1, '': 1 };
  var DASH_OPENS = { open: 1, promo: 1, create: 1 };

  /* Every sentence a person reads from this file: plain, in sentence case; the assistant is ETB2B AI. */
  var TEXT = {
    oftenYou: 'You often ask',
    oftenTeam: 'Often asked for {kind}',
    oftenHere: 'Often asked here',
    often: 'Often asked',
    hint: 'One click sends it on this event. Every change has an Undo.',
    hintGlobal: 'One click sends it. Every change has an Undo.',
    titleYou: '{text} (you asked this {n} times)',
    titleTeam: '{text} (your team asked this {n} times)',
    shortcuts: 'Shortcuts',
    shortcutsN: 'Shortcuts ({n})',
    shortcutsTitle: 'Your saved requests: run one with a click',
    save: 'Save as shortcut',
    saved: 'Saved',
    saveHead: 'Save this request as a shortcut',
    saveTo: 'Add it to',
    newOne: 'A new shortcut',
    inOne: '{name} ({steps})',
    nameLabel: 'Name',
    namePlaceholder: 'For example, My launch set',
    saveBtn: 'Save',
    noName: 'Give the shortcut a name.',
    saving: 'Saving…',
    cancel: 'Cancel',
    savedNew: 'Saved as “{name}”. Run it from Shortcuts, above the message box.',
    savedTo: 'Added to “{name}”, which now holds {steps}.',
    listHead: 'Your shortcuts',
    listHint: 'A shortcut sends its requests one after another on the event you are in. Each one has its Undo, and Undo all takes them all back.',
    listHintGlobal: 'A shortcut sends its requests one after another. Each one has its Undo, and Undo all takes them all back.',
    listEmpty: 'You have no shortcuts yet. Under an answer that did what you asked, choose Save as shortcut.',
    loading: 'Loading your shortcuts…',
    steps1: '1 request',
    stepsN: '{n} requests',
    run: 'Run',
    runName: 'Run {name}',
    rename: 'Rename',
    renameName: 'Rename {name}',
    del: 'Delete',
    delName: 'Delete {name}',
    close: 'Close',
    closeList: 'Close your shortcuts',
    renameLabel: 'New name for “{name}”',
    renamed: 'Renamed to “{name}”.',
    delAsk: 'Delete “{name}”? This can’t be undone.',
    delYes: 'Delete',
    delNo: 'Keep it',
    deleted: '“{name}” is deleted.',
    running: 'Running “{name}”: {steps}, one after another.',
    runningOne: 'Running “{name}”.',
    goingOn: 'Going on with “{name}”: request {i} of {n}.',
    notHere: 'The rest of “{name}” was not run: this page is not about the same event.',
    waitFirst: 'Wait for the answer to the message first, then run the shortcut.',
    oneAtATime: 'A shortcut is already running. Wait for it to finish.',
    summary: '“{name}”: {done} of {n} done.',
    summaryStopped: '“{name}” stopped after request {i} of {n}.',
    summaryStayed: '“{name}” stopped here: the page it was opening did not open.',
    state: { done: 'Done', partly: 'Partly done', answered: 'Answered', failed: 'Not done', stopped: 'Stopped', opened: 'Opened a page',
      stayed: 'Stayed on this page', skipped: 'Not run', earlier: 'Done on the page before', waiting: 'Not run' },
    undo: 'Undo',
    undoAll: 'Undo all',
    allUndone: 'All undone',
    undoingAll: 'Undoing…',
    notAllUndone: 'Request {list} could not be undone here.',
    nothingToUndo: 'Nothing here has an Undo: a page it opened is left with your browser’s Back button.',
    failed: 'That could not be saved. Please try again.',
    offline: 'You’re offline. Check your connection and try again.'
  };

  function str(v) { return v == null ? '' : String(v); }
  function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }
  function isFn(f) { return typeof f === 'function'; }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArr(v); }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function fill(s, o) { return str(s).replace(/\{([a-z]+)\}/g, function (m, k) { return own(o, k) ? str(o[k]) : m; }); }
  function oneLine(v, max) { return str(v).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, max || 160); }
  function now() { return new Date().getTime(); }
  function warn(msg) { try { if (root.console && root.console.warn) root.console.warn('[ETB2B AI] ' + msg); } catch (e) { /* nothing to do */ } }
  function stepsWord(n) { return n === 1 ? TEXT.steps1 : fill(TEXT.stepsN, { n: n }); }

  /* ---------- browser storage: every access may throw (private windows, blocked site data) ---------- */
  function session() { try { return root.sessionStorage || null; } catch (e) { return null; } }
  function readRun() {
    var s = session(), raw = null;
    if (!s) return null;
    try { raw = s.getItem(RUN_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { var v = JSON.parse(raw); return isObj(v) && v.v === 1 ? v : null; } catch (e) { return null; }
  }
  function writeRun(v) { var s = session(); if (!s) return false; try { s.setItem(RUN_KEY, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function dropRun() { var s = session(); if (!s) return; try { s.removeItem(RUN_KEY); } catch (e) { /* nothing kept */ } }

  /* ---------- pure parts (functions/lib/etb2b-ai-habits.test.js) ---------- */
  /* Whether an answer did what was asked, so it may be saved as a shortcut: a change kept, a page opened, an answer
     given; never a refusal, a question back, an undo, Stop, or "an event I could not find". */
  function worked(brain, r) {
    if (!isObj(r) || r.handoff === true || r.kind === 'handoff') return false;
    if (brain === 'dash') {
      if (!TURN_ID.test(str(r.turnId)) || own(DASH_NOT, str(r.kind))) return false;
      var notes = isArr(r.notes) ? r.notes : [];
      for (var i = 0; i < notes.length; i++) if (own(COULD_NOT, str(notes[i]))) return false;
      return true;
    }
    if (brain === 'edit' || brain === 'promo') return r.kind === 'edit' && (r.status === 'applied' || r.status === 'partly');
    return false;
  }
  /* what became of one request of a run, from its brain's answer: a key of TEXT.state */
  function stateOf(brain, r, leaving) {
    if (!isObj(r)) return 'failed';
    if (r.kind === 'stopped' || r.status === 'stopped') return 'stopped';
    if (brain === 'dash') {
      if (leaving || own(DASH_OPENS, str(r.kind))) return leaving ? 'opened' : 'done';
      if (r.kind === 'reply') return worked(brain, r) ? 'answered' : 'failed';
      return worked(brain, r) ? 'done' : 'failed';
    }
    if (r.kind === 'edit') return r.status === 'applied' ? 'done' : r.status === 'partly' ? 'partly' : 'failed';
    if (r.kind === 'reply') return 'answered';
    return 'failed';
  }
  /* the name a new shortcut is offered: the request's first words */
  var SMALL_END = /\s+(?:and|or|but|for|the|a|an|to|of|with|in|on|at|by|from|as|this|that|these|those|my|our|its|your|is|are|does|do)$/i;
  function nameFor(text) {
    var words = oneLine(text, 200).split(' ');
    var s = words.slice(0, 5).join(' ');
    if (s.length > NAME_CHARS - 1) s = s.slice(0, NAME_CHARS - 1).replace(/\s+\S*$/, '');
    while (SMALL_END.test(s)) s = s.replace(SMALL_END, '');
    return s + (words.length > 5 || s.length < oneLine(text, 200).length ? '…' : '');
  }
  /* the row's label: whose they are */
  function rowLabel(chips, kindName) {
    var you = 0, team = 0;
    for (var i = 0; i < chips.length; i++) { if (chips[i].from === 'team') team++; else you++; }
    if (!chips.length) return '';
    if (you && !team) return TEXT.oftenYou;
    if (team && !you) return kindName ? fill(TEXT.oftenTeam, { kind: kindName }) : TEXT.oftenHere;
    return TEXT.often;
  }
  function cleanChips(list) {
    var out = [];
    (isArr(list) ? list : []).forEach(function (c) {
      if (!isObj(c) || out.length >= 4) return;
      var label = oneLine(c.label, 60), text = oneLine(c.text, 400);
      if (!label || !text) return;
      out.push({ label: label, text: text, from: c.from === 'team' ? 'team' : 'you', count: Math.max(0, Math.floor(+c.count || 0)) });
    });
    return out;
  }
  function cleanShortcuts(list) {
    var out = [];
    (isArr(list) ? list : []).forEach(function (x) {
      if (!isObj(x) || !/^[0-9a-f]{12}$/.test(str(x.id))) return;
      var steps = (isArr(x.steps) ? x.steps : []).filter(function (s) { return isObj(s) && trim(s.text); }).slice(0, MAX_STEPS)
        .map(function (s) { return { text: str(s.text).slice(0, 2000), page: str(s.page) }; });
      if (steps.length) out.push({ id: str(x.id), name: oneLine(x.name, NAME_CHARS) || 'My shortcut', steps: steps });
    });
    return out;
  }

  /* ================================================================ attached to the panel */
  var hub = null, started = false;
  var st = { chips: [], shortcuts: [], kindName: '', scope: '', loadedAt: 0, loading: null, promo: '', list: null };
  var run = null;                // the shortcut being run: { id, name, eventId, page, i, steps: [{ text, state, brain, turnId }] }
  var stepNow = null;            // the request of the run being answered (turn() fills in its brain and answer)
  var unloading = false;

  function chat() { var c = hub && isFn(hub.chat) ? hub.chat() : null; return c && isFn(c.ai) ? c : null; }
  function placeNow() {
    var p = null;
    try { p = hub && isFn(hub.place) ? hub.place() : null; } catch (e) { p = null; }
    p = isObj(p) ? p : {};
    return { page: str(p.page), eventId: EVENT_ID.test(str(p.eventId)) ? str(p.eventId) : '', tab: str(p.tab) };
  }
  function promoKind() { try { var k = hub && isFn(hub.promoKind) ? hub.promoKind() : ''; return k === 'mail' || k === 'post' ? k : ''; } catch (e) { return ''; } }
  function api(url, method, body) {
    var auth = root.RevampAuth;
    if (!auth || !isFn(auth.authedFetch)) return Promise.reject({ status: 401 });
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return Promise.resolve(auth.authedFetch(url, opts)).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
        return { ok: !!res.ok, status: res.status, body: data };
      });
    });
  }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = String(text);
    return e;
  }
  function btn(cls, label, aria) {
    var b = el('button', cls, label);
    b.setAttribute('type', 'button');
    if (aria) b.setAttribute('aria-label', aria);
    return b;
  }
  function focus(e) { try { if (e && isFn(e.focus)) e.focus(); } catch (x) { /* not focusable */ } }
  function remove(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }
  function sayError(r, fallback) {
    if (root.navigator && root.navigator.onLine === false) return TEXT.offline;
    var b = r && isObj(r.body) ? r.body : null;
    var said = b && typeof b.error === 'string' ? oneLine(b.error, 300) : '';
    return said && !/\bRevamp\b|\bOneworld\b/i.test(said) ? said : fallback;
  }

  /* ---------- the row ---------- */
  function drawRow() {
    var c = chat();
    if (!c || !isFn(c.setChips)) return;
    var p = placeNow(), n = st.shortcuts.length;
    c.setChips({
      label: rowLabel(st.chips, st.kindName),
      hint: p.eventId ? TEXT.hint : TEXT.hintGlobal,
      items: st.chips.map(function (x) {
        return { label: x.label, title: fill(x.from === 'team' ? TEXT.titleTeam : TEXT.titleYou, { text: '“' + x.text + '”', n: x.count }),
          onClick: function () { send(x.text); } };
      }),
      more: { label: n ? fill(TEXT.shortcutsN, { n: n }) : TEXT.shortcuts, title: TEXT.shortcutsTitle, onClick: toggleList }
    });
  }
  /* GET /api/ai-habits for where the person is now; a failure leaves the row as it was */
  function load(force) {
    var p = placeNow(), kind = p.page === 'promotions' ? promoKind() : '';
    if (!p.page) return Promise.resolve(false);
    if (st.loading && !force) return st.loading;
    st.promo = kind;
    var q = '?page=' + encodeURIComponent(p.page) + (p.eventId ? '&eventId=' + encodeURIComponent(p.eventId) : '') + (kind ? '&editor=' + kind : '');
    st.loading = api(HABITS_URL + q, 'GET').then(function (r) {
      st.loading = null;
      if (!r.ok || !isObj(r.body)) return false;
      st.chips = cleanChips(r.body.chips);
      st.shortcuts = cleanShortcuts(r.body.shortcuts);
      st.kindName = oneLine(r.body.kindName, 40);
      st.scope = str(r.body.scope);
      st.loadedAt = now();
      drawRow();
      return true;
    }, function () { st.loading = null; return false; });
    return st.loading;
  }
  function refreshSoon() { if (now() - st.loadedAt >= REFRESH_MS) load(); }

  /* a chip: sent as a typed message would be */
  function send(text) {
    var c = chat();
    if (!c || !isFn(c.ask) || run) return Promise.resolve(null);
    return c.ask(text);
  }

  /* ---------- after each message the shell answered (hub.turn) ---------- */
  function turn(info) {
    info = isObj(info) ? info : {};
    if (stepNow) { stepNow.brain = str(info.brain); stepNow.result = info.result || null; stepNow.error = info.error || null; return; }
    if (info.result && worked(str(info.brain), info.result)) offerSave(str(info.text));
    refreshSoon();
  }
  function offerSave(text) {
    var c = chat(), b = c && isFn(c.currentAnswer) ? c.currentAnswer() : null;
    if (!b || !isFn(b.button) || !isFn(b.slot) || !trim(text)) return;
    var opener = null;
    opener = b.button(TEXT.save, function () { openSave(b, opener, text); });
  }
  function openSave(b, opener, text) {
    if (!opener || opener.getAttribute('aria-disabled') === 'true') return;
    opener.setAttribute('aria-disabled', 'true');
    opener.setAttribute('aria-expanded', 'true');
    var p = placeNow(), box = el('div', 'rvc-hb rvc-hb-save');
    box.setAttribute('role', 'group');
    var head = el('p', 'rvc-hb-h', TEXT.saveHead);
    head.id = 'rvc-hb-save-' + now();
    box.setAttribute('aria-labelledby', head.id);
    box.appendChild(head);
    var select = null, nameRow = el('div');
    if (st.shortcuts.length) {
      var sl = el('label', 'rvc-hb-label', TEXT.saveTo);
      select = el('select', 'rvc-hb-select');
      select.id = head.id + '-to';
      sl.setAttribute('for', select.id);
      var o0 = el('option', null, TEXT.newOne);
      o0.value = '';
      select.appendChild(o0);
      st.shortcuts.forEach(function (x) {
        if (x.steps.length >= MAX_STEPS) return;
        var o = el('option', null, fill(TEXT.inOne, { name: x.name, steps: stepsWord(x.steps.length) }));
        o.value = x.id;
        select.appendChild(o);
      });
      box.appendChild(sl);
      box.appendChild(select);
      select.addEventListener('change', function () { nameRow.hidden = !!select.value; });
    }
    var nl = el('label', 'rvc-hb-label', TEXT.nameLabel);
    var input = el('input', 'rvc-hb-input');
    input.id = head.id + '-name';
    input.setAttribute('type', 'text');
    input.setAttribute('maxlength', String(NAME_CHARS));
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('placeholder', TEXT.namePlaceholder);
    input.value = nameFor(text);
    nl.setAttribute('for', input.id);
    nameRow.appendChild(nl);
    nameRow.appendChild(input);
    box.appendChild(nameRow);
    var err = el('p', 'rvc-hb-err');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    box.appendChild(err);
    var row = el('div', 'rvc-hb-row');
    var ok = btn('rvc-btn rvc-btn-primary', TEXT.saveBtn), no = btn('rvc-btn', TEXT.cancel);
    row.appendChild(ok);
    row.appendChild(no);
    box.appendChild(row);
    var slot = b.slot();
    slot.appendChild(box);
    function closeForm(done) {
      remove(box);
      opener.removeAttribute('aria-expanded');
      if (!done) { opener.removeAttribute('aria-disabled'); focus(opener); }
    }
    var saving = false;
    function save() {
      if (saving) return;
      var to = select ? str(select.value) : '', name = oneLine(input.value, NAME_CHARS);
      if (!to && !name) { err.textContent = TEXT.noName; err.hidden = false; focus(input); return; }
      saving = true;
      ok.setAttribute('aria-disabled', 'true');
      ok.textContent = TEXT.saving;
      err.hidden = true;
      var body = { op: 'add', text: text, page: p.page };
      if (p.eventId) body.eventId = p.eventId;
      if (to) body.id = to; else body.name = name;
      api(SHORTCUTS_URL, 'POST', body).then(function (r) {
        saving = false;
        if (!r.ok || !isObj(r.body)) {
          ok.removeAttribute('aria-disabled');
          ok.textContent = TEXT.saveBtn;
          err.textContent = sayError(r, TEXT.failed);
          err.hidden = false;
          return;
        }
        st.shortcuts = cleanShortcuts(r.body.shortcuts);
        drawRow();
        var saved = isObj(r.body.saved) ? r.body.saved : {};
        closeForm(true);
        opener.textContent = TEXT.saved;
        if (isFn(b.note)) b.note(to ? fill(TEXT.savedTo, { name: oneLine(saved.name, NAME_CHARS), steps: stepsWord(+saved.steps || 1) })
          : fill(TEXT.savedNew, { name: oneLine(saved.name, NAME_CHARS) || name }));
      }, function () {
        saving = false;
        ok.removeAttribute('aria-disabled');
        ok.textContent = TEXT.saveBtn;
        err.textContent = sayError(null, TEXT.failed);
        err.hidden = false;
      });
    }
    ok.addEventListener('click', function () { if (ok.getAttribute('aria-disabled') !== 'true') save(); });
    no.addEventListener('click', function () { closeForm(false); });
    /* Enter saves, Escape cancels the form (and not the whole panel) */
    box.addEventListener('keydown', function (e) {
      if (!e) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); if (isFn(e.stopPropagation)) e.stopPropagation(); closeForm(false); }
      else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); save(); }
    });
    var c = chat();
    if (c && isFn(c.reveal)) c.reveal(box);
    focus(input);
    try { input.select(); } catch (x) { /* an input that cannot select */ }
  }

  /* ---------- the person's shortcuts, in the conversation ---------- */
  function closeList() {
    if (!st.list) return;
    remove(st.list.node);
    st.list = null;
  }
  function toggleList() {
    if (st.list && st.list.node && st.list.node.parentNode) { closeList(); return; }
    openList();
  }
  function openList(focusId) {
    var c = chat();
    if (!c || !isFn(c.custom)) return;
    closeList();
    var p = placeNow(), card = el('div', 'rvc-hb rvc-hb-shortcuts');
    card.setAttribute('role', 'group');
    var head = el('p', 'rvc-hb-h', TEXT.listHead);
    head.id = 'rvc-hb-list-' + now();
    card.setAttribute('aria-labelledby', head.id);
    card.appendChild(head);
    card.appendChild(el('p', 'rvc-hb-p', p.eventId ? TEXT.listHint : TEXT.listHintGlobal));
    var said = el('p', 'rvc-hb-p');
    said.setAttribute('role', 'status');
    said.hidden = true;
    var first = null, target = null;
    if (!st.shortcuts.length) card.appendChild(el('p', 'rvc-hb-p', TEXT.listEmpty));
    else {
      var ul = el('ul', 'rvc-hb-list');
      st.shortcuts.forEach(function (x) {
        var li = el('li', 'rvc-hb-item');
        var name = el('span', 'rvc-hb-name', x.name);
        name.appendChild(el('span', 'rvc-hb-meta', stepsWord(x.steps.length)));
        name.setAttribute('title', x.steps.map(function (s, i) { return (i + 1) + '. ' + oneLine(s.text, 120); }).join('\n'));
        var r = btn('rvc-btn rvc-btn-primary', TEXT.run, fill(TEXT.runName, { name: x.name }));
        var rn = btn('rvc-btn', TEXT.rename, fill(TEXT.renameName, { name: x.name }));
        var d = btn('rvc-btn', TEXT.del, fill(TEXT.delName, { name: x.name }));
        r.addEventListener('click', function () { runShortcut(x); });
        rn.addEventListener('click', function () { renameIn(li, x, said); });
        d.addEventListener('click', function () { deleteIn(li, x, said); });
        li.appendChild(name);
        li.appendChild(r);
        li.appendChild(rn);
        li.appendChild(d);
        ul.appendChild(li);
        if (!first) first = r;
        if (focusId && x.id === focusId) target = r;
      });
      card.appendChild(ul);
    }
    card.appendChild(said);
    var row = el('div', 'rvc-hb-row');
    var cl = btn('rvc-btn', TEXT.close, TEXT.closeList);
    cl.addEventListener('click', function () { closeList(); var k = chat(); if (k && isFn(k.focusInput)) k.focusInput(); });
    row.appendChild(cl);
    card.appendChild(row);
    card.addEventListener('keydown', function (e) {
      if (e && (e.key === 'Escape' || e.key === 'Esc') && !(e.target && e.target.tagName === 'INPUT')) {
        e.preventDefault();
        if (isFn(e.stopPropagation)) e.stopPropagation();
        closeList();
        var k = chat();
        if (k && isFn(k.focusInput)) k.focusInput();
      }
    });
    var b = c.custom('ai', card, {});
    st.list = { node: b && b.node ? b.node : card, card: card, said: said };
    if (isFn(c.reveal)) c.reveal(card);
    focus(target || first || cl);
  }
  function renameIn(li, x, said) {
    if (li.querySelector && li.querySelector('.rvc-hb-input')) return;
    var keep = [];
    while (li.firstChild) { keep.push(li.firstChild); li.removeChild(li.firstChild); }
    var lab = el('label', 'rvc-hb-label', fill(TEXT.renameLabel, { name: x.name }));
    var input = el('input', 'rvc-hb-input');
    input.id = 'rvc-hb-rename-' + x.id;
    input.setAttribute('type', 'text');
    input.setAttribute('maxlength', String(NAME_CHARS));
    input.setAttribute('autocomplete', 'off');
    input.value = x.name;
    lab.setAttribute('for', input.id);
    var err = el('p', 'rvc-hb-err');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    var row = el('div', 'rvc-hb-row');
    var ok = btn('rvc-btn rvc-btn-primary', TEXT.saveBtn), no = btn('rvc-btn', TEXT.cancel);
    row.appendChild(ok);
    row.appendChild(no);
    var wrapEl = el('div');
    wrapEl.style.flex = '1 1 100%';
    wrapEl.appendChild(lab);
    wrapEl.appendChild(input);
    wrapEl.appendChild(err);
    wrapEl.appendChild(row);
    li.appendChild(wrapEl);
    function back() { remove(wrapEl); keep.forEach(function (n) { li.appendChild(n); }); focus(keep[2]); }
    function save() {
      var name = oneLine(input.value, NAME_CHARS);
      if (!name) { err.textContent = TEXT.noName; err.hidden = false; return; }
      if (name === x.name) { back(); return; }
      ok.setAttribute('aria-disabled', 'true');
      api(SHORTCUTS_URL, 'POST', { op: 'rename', id: x.id, name: name }).then(function (r) {
        ok.removeAttribute('aria-disabled');
        if (!r.ok || !isObj(r.body)) { err.textContent = sayError(r, TEXT.failed); err.hidden = false; return; }
        st.shortcuts = cleanShortcuts(r.body.shortcuts);
        drawRow();
        openList(x.id);
        if (st.list) { st.list.said.textContent = fill(TEXT.renamed, { name: name }); st.list.said.hidden = false; }
      }, function () { ok.removeAttribute('aria-disabled'); err.textContent = sayError(null, TEXT.failed); err.hidden = false; });
    }
    ok.addEventListener('click', function () { if (ok.getAttribute('aria-disabled') !== 'true') save(); });
    no.addEventListener('click', back);
    input.addEventListener('keydown', function (e) {
      if (!e) return;
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); if (isFn(e.stopPropagation)) e.stopPropagation(); back(); }
    });
    focus(input);
    try { input.select(); } catch (e) { /* an input that cannot select */ }
  }
  function deleteIn(li, x, said) {
    if (li.querySelector && li.querySelector('.rvc-hb-ask')) return;
    var keep = [];
    while (li.firstChild) { keep.push(li.firstChild); li.removeChild(li.firstChild); }
    var box = el('div', 'rvc-hb-ask');
    box.style.flex = '1 1 100%';
    var q = el('p', 'rvc-hb-p', fill(TEXT.delAsk, { name: x.name }));
    var err = el('p', 'rvc-hb-err');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    var row = el('div', 'rvc-hb-row');
    var yes = btn('rvc-btn', TEXT.delYes, fill(TEXT.delName, { name: x.name })), no = btn('rvc-btn rvc-btn-primary', TEXT.delNo);
    row.appendChild(no);
    row.appendChild(yes);
    box.appendChild(q);
    box.appendChild(err);
    box.appendChild(row);
    li.appendChild(box);
    function back() { remove(box); keep.forEach(function (n) { li.appendChild(n); }); focus(keep[3]); }
    yes.addEventListener('click', function () {
      if (yes.getAttribute('aria-disabled') === 'true') return;
      yes.setAttribute('aria-disabled', 'true');
      api(SHORTCUTS_URL, 'POST', { op: 'delete', id: x.id }).then(function (r) {
        yes.removeAttribute('aria-disabled');
        if (!r.ok || !isObj(r.body)) { err.textContent = sayError(r, TEXT.failed); err.hidden = false; return; }
        st.shortcuts = cleanShortcuts(r.body.shortcuts);
        drawRow();
        openList();
        if (st.list) { st.list.said.textContent = fill(TEXT.deleted, { name: x.name }); st.list.said.hidden = false; }
      }, function () { yes.removeAttribute('aria-disabled'); err.textContent = sayError(null, TEXT.failed); err.hidden = false; });
    });
    no.addEventListener('click', back);
    box.addEventListener('keydown', function (e) {
      if (e && (e.key === 'Escape' || e.key === 'Esc')) { e.preventDefault(); if (isFn(e.stopPropagation)) e.stopPropagation(); back(); }
    });
    focus(no);
  }

  /* ---------- running a shortcut ---------- */
  function carry() {
    if (!run) return;
    writeRun({ v: 1, id: run.id, name: run.name, eventId: run.eventId, page: run.page, at: now(), i: run.i,
      steps: run.steps.map(function (s) { return { text: s.text, state: s.state }; }) });
  }
  function runShortcut(x) {
    var c = chat();
    if (!c) return;
    if (run) { c.ai(TEXT.oneAtATime, {}); return; }
    if (isFn(c.isBusy) && c.isBusy()) { c.ai(TEXT.waitFirst, {}); return; }
    var p = placeNow();
    closeList();
    run = { id: x.id, name: x.name, eventId: p.eventId, page: p.page, i: 0,
      steps: x.steps.slice(0, MAX_STEPS).map(function (s) { return { text: s.text, state: 'waiting' }; }) };
    c.ai(fill(run.steps.length === 1 ? TEXT.runningOne : TEXT.running, { name: x.name, steps: stepsWord(run.steps.length) }), {});
    next();
  }
  function next() {
    var c = chat();
    if (!run || !c) return;
    if (run.i >= run.steps.length) { finish(''); return; }
    var step = run.steps[run.i];
    carry();
    stepNow = step;
    var before = isFn(c.leaveCount) ? c.leaveCount() : { went: 0, stayed: 0 }, from = hrefNow();
    Promise.resolve(c.ask(step.text)).then(function (r) {
      stepNow = null;
      r = isObj(r) ? r : {};
      if (r.busy) {
        /* a message was being answered after all: the run is not started over it */
        step.state = 'waiting';
        if (!run.i) { run = null; dropRun(); c.ai(TEXT.waitFirst, {}); return; }
        finish('stopped');
        return;
      }
      if (r.stopped) { step.state = 'stopped'; run.i++; finish('stopped'); return; }
      if (!r.ok) {
        step.state = 'failed';
        run.i++;
        /* a failure that the same request would meet again (today's allowance, a signed-out session) ends the run */
        var e = r.error;
        if ((e && e.retryable === false) || (root.navigator && root.navigator.onLine === false)) { finish('stopped'); return; }
        next();
        return;
      }
      step.brain = step.brain || '';
      step.turnId = isObj(step.result) && TURN_ID.test(str(step.result.turnId)) ? str(step.result.turnId) : '';
      var leaving = isFn(c.isLeaving) && c.isLeaving();
      step.state = stateOf(step.brain, step.result || r.result, leaving);
      run.i++;
      if (!leaving) { next(); return; }
      /* a page is about to open: the rest of the run goes there with it, unless the person stays here */
      carry();
      afterLeave(c, before, from);
    }, function () { stepNow = null; step.state = 'failed'; run.i++; next(); });
  }
  function hrefNow() { try { return str(root.location && root.location.href); } catch (e) { return ''; } }
  /* wait for "Opening …" to end: stayed here, the run goes on here; ran out, the next page goes on with it, or this
     page when what opened is one of its own tabs (only the address's #part changed: the console's Content › Speakers) */
  function afterLeave(c, before, from) {
    (function look() {
      if (!run) return;
      if (c.isLeaving()) { root.setTimeout(look, POLL_MS); return; }
      var n = isFn(c.leaveCount) ? c.leaveCount() : before;
      if (n.stayed > before.stayed && n.went <= before.went) {
        run.steps[run.i - 1].state = 'stayed';
        next();
        return;
      }
      /* the page is opening (or a guard for unsaved work is asking): still here after a while, it did not open */
      var end = now() + STILL_HERE_MS;
      (function still() {
        if (!run || unloading) return;
        var here = hrefNow();
        if (here && from && here !== from && here.split('#')[0] === from.split('#')[0]) { next(); return; }
        if (now() >= end) { finish('stayed'); return; }
        root.setTimeout(still, POLL_MS);
      })();
    })();
  }
  function finish(how) {
    var c = chat();
    var r = run;
    run = null;
    stepNow = null;
    dropRun();
    if (!r || !c) return;
    var n = r.steps.length, done = 0, lastRun = 0;
    r.steps.forEach(function (s, i) {
      if (s.state === 'waiting') s.state = 'skipped';
      if (s.state !== 'skipped') lastRun = i + 1;
      if (s.state === 'done' || s.state === 'partly' || s.state === 'answered' || s.state === 'opened' || s.state === 'earlier') done++;
    });
    var words = how === 'stopped' ? fill(TEXT.summaryStopped, { name: r.name, i: lastRun, n: n })
      : how === 'stayed' ? fill(TEXT.summaryStayed, { name: r.name })
      : fill(TEXT.summary, { name: r.name, done: done, n: n });
    var b = c.ai(words, {});
    if (!b || !isFn(b.slot)) return;
    var ol = el('ol', 'rvc-hb-steps'), handles = [];
    r.steps.forEach(function (s, i) {
      var li = el('li', 'rvc-hb-step');
      var t = el('span', 'rvc-hb-step-text', (i + 1) + '. ' + oneLine(s.text, 200));
      t.id = 'rvc-hb-step-' + now() + '-' + i;
      li.appendChild(t);
      li.appendChild(el('span', 'rvc-hb-step-state', TEXT.state[s.state] || TEXT.state.failed));
      var h = null;
      if (s.brain && s.turnId && hub && isFn(hub.undoHandle)) { try { h = hub.undoHandle(s.brain, s.turnId); } catch (e) { h = null; } }
      if (isFn(h) && isFn(c.undoBind)) {
        var u = btn('rvc-btn rvc-undo', TEXT.undo);
        u.setAttribute('aria-describedby', t.id);
        c.undoBind(u, h);
        li.appendChild(u);
        handles.push({ i: i + 1, fn: h });
      }
      ol.appendChild(li);
    });
    b.slot().appendChild(ol);
    if (!handles.length) {
      if (r.steps.some(function (s) { return s.state === 'opened' || s.state === 'earlier'; })) b.note(TEXT.nothingToUndo);
      return;
    }
    if (handles.length < 2 || !isFn(c.undoRun)) return;
    var all = b.button(TEXT.undoAll, function () {
      if (all.getAttribute('aria-disabled') === 'true') return;
      all.setAttribute('aria-disabled', 'true');
      all.setAttribute('aria-busy', 'true');
      all.textContent = TEXT.undoingAll;
      var left = [];
      /* newest first, one at a time: each is then the newest change, so nothing asks about later edits */
      handles.slice().reverse().reduce(function (pr, h) {
        return pr.then(function () {
          if (c.undoState(h.fn) === 'done') return null;
          return c.undoRun(h.fn).then(function (ok) { if (!ok) left.push(h.i); });
        });
      }, Promise.resolve()).then(function () {
        all.removeAttribute('aria-busy');
        if (!left.length) { all.textContent = TEXT.allUndone; return; }
        all.textContent = TEXT.undoAll;
        all.removeAttribute('aria-disabled');
        b.note(fill(TEXT.notAllUndone, { list: left.sort(function (x, y) { return x - y; }).join(', ') }));
      });
    });
  }
  /* a run one of its requests carried here: it goes on only on the same event, and only soon after */
  function resume() {
    var v = readRun();
    if (!v) return;
    dropRun();
    var c = chat();
    if (!c) return;
    var p = placeNow();
    var steps = isArr(v.steps) ? v.steps.slice(0, MAX_STEPS) : [];
    var i = Math.max(0, Math.floor(+v.i || 0));
    if (!steps.length || i >= steps.length || now() - (+v.at || 0) > RUN_KEEP_MS || (+v.at || 0) > now() + 60000) return;
    var name = oneLine(v.name, NAME_CHARS) || 'My shortcut';
    if (str(v.eventId) !== p.eventId) { c.ai(fill(TEXT.notHere, { name: name }), {}); return; }
    run = { id: str(v.id), name: name, eventId: p.eventId, page: p.page, i: i, resumed: true,
      steps: steps.map(function (s, k) {
        var text = isObj(s) ? str(s.text).slice(0, 2000) : '';
        var was = isObj(s) ? str(s.state) : '';
        return { text: text, state: k < i ? (was === 'failed' || was === 'stopped' || was === 'skipped' ? was : 'earlier') : 'waiting' };
      }).filter(function (s) { return s.text; }) };
    if (run.i >= run.steps.length) { run = null; return; }
    if (isFn(c.open) && !c.isOpen()) c.open();
    c.ai(fill(TEXT.goingOn, { name: name, i: run.i + 1, n: run.steps.length }), {});
    next();
  }

  /* ---------- the hub from the shell ---------- */
  function attach(h) {
    if (started || !h || !isFn(h.chat)) return null;
    hub = h;
    started = true;
    var c = chat();
    if (!c) { started = false; hub = null; return null; }
    drawRow();
    if (isFn(root.addEventListener)) {
      root.addEventListener('pagehide', function () { unloading = true; });
      root.addEventListener('beforeunload', function () { unloading = true; });
      /* a post or a mail going into or out of "Edit with AI" on Promotions: that editor's suggestions */
      root.addEventListener('message', function (e) {
        if (!e || e.origin !== root.location.origin || !isObj(e.data) || e.data.rvAiMode == null) return;
        root.setTimeout(function () { if (promoKind() !== st.promo) load(true); }, 0);
      });
    }
    var carried = readRun();
    function first() { if (!st.loadedAt && !st.loading) load(); }
    if (isFn(h.onOpenChange)) h.onOpenChange(function (open) { if (open) first(); });
    if (carried || (isFn(c.isOpen) && c.isOpen())) first();
    if (carried) {
      /* the panel's replay of the conversation first, so the run's lines come after it */
      Promise.resolve(st.loading).then(function () { resume(); });
    }
    return api0;
  }
  var api0 = { turn: turn, refresh: function () { return load(true); }, running: function () { return !!run; } };

  root.RevampAiHabits = {
    attach: attach, TEXT: TEXT,
    /* pure parts, for functions/lib/etb2b-ai-habits.test.js */
    _test: { worked: worked, stateOf: stateOf, nameFor: nameFor, rowLabel: rowLabel, cleanChips: cleanChips, cleanShortcuts: cleanShortcuts,
      RUN_KEY: RUN_KEY, RUN_KEEP_MS: RUN_KEEP_MS, state: function () { return st; }, run: function () { return run; },
      reset: function () { hub = null; started = false; run = null; stepNow = null; unloading = false;
        st = { chips: [], shortcuts: [], kindName: '', scope: '', loadedAt: 0, loading: null, promo: '', list: null }; } }
  };
  if (typeof module === 'object' && module && module.exports) module.exports = root.RevampAiHabits;
})(typeof window !== 'undefined' ? window : this);
