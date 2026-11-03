/* ETB2B AI chat kit (etb2b-chat.js, window.RevampChat), with etb2b-chat.css.
   The floating "Ask ETB2B AI" launcher, its panel, the conversation bubbles and the cards inside them, for any
   Oneworld 2.0 console page. The events dashboard (dash-bot-client.js) is its first user; the editor keeps its
   own chat for now and can move onto this kit later, which is why nothing here knows about events, lists or
   the server.

   RevampChat.mount(host, opts) -> chat
     host  an element (or its id) the kit appends its markup to. Everything it draws is position:fixed, so where
           the host sits in the page only decides the Tab order.
     opts  { id:'dash', title:'ETB2B AI', launcherLabel:'Ask ETB2B AI', placeholder:'Ask ETB2B AI…',
             welcome:{heading, text}, suggestions:[{label, text}], footNote, help:{label, onClick}|null,
             send(text) -> Promise, loadHistory() -> Promise|null, onOpenChange(open), startOpen }
       send       the kit draws the person's own bubble, locks the box and shows "thinking" by itself; send only
                  asks and draws the answer (chat.ai). A rejection puts the text back in the box and shows the
                  Error's message in an error bubble with Try again. Error.retryable === false leaves Try again
                  out (a daily allowance that is used up); Error.silent === true draws no bubble at all.
       loadHistory  called once, on the first open, with a writer {divider, user, ai} for the replay. While its
                  promise is pending a new message waits for it (at most 6 s). A replay later than that still
                  lands above the new message, never between it and its answer: whatever is drawn through the
                  writer does, and so do chat.divider() and any chat.user() / chat.ai() given its own time (at),
                  because a turn from the past always has one and a new turn never needs one.
   chat: open(), close(), isOpen(), isFolded(), focusInput(), setBusy(on, text?), divider(label),
         fold(label, onUndo), unfold(), user(text, {at?}) -> node, ai(content, {error?, at?, asOf?}) -> Bubble,
         markUndone(onUndo)
         close() and fold() stop a page that is about to open (as Stay here does), since its Stay here would be
         out of sight; a countdown that starts while the panel is shut shows in the folded bar, with Stay here.
   Bubble: node, list({title, count, more, items:[{href, name, meta, chip:{label, tone}, value}]}) -> card,
           note(text) -> el, link(href, label) -> <a> (or a <span> when the address is not one of ours),
           button(label, onClick, {primary?}) -> el, undo(onUndo) -> el,
           countdown(ms, label, onCancel, onDone?) -> {node, cancel(opts?), isRunning()},
           choices([{label, onClick}]) -> el

   Rules it keeps, and why:
   - Text is only ever put on the page with textContent. innerHTML is used only for the fixed SVG drawings
     below (the face and three icons), so nothing a person or a model typed can become markup.
   - A link is drawn only for a path on this site (/x…). "//x" and "/\x" are other sites to a browser, and
     "javascript:" is code, so those stay plain text.
   - "Do it, then undo": there is no Apply step. Undo controls bound to the same handler (the card's and the
     folded bar's) become "Undone" together, so one change is never undone twice. A handler that returns false
     (the person said no to a question) leaves Undo as it was; a promise keeps it busy until it settles.
   - The way to stay is always in sight: a page opens only after a countdown whose Stay here can be seen (in
     the open panel, or in the folded bar), and Esc is Stay here wherever the focus is.
   - Focus moves only from inside the chat, or from nowhere: a person typing in the page (its search box, a
     filter) keeps their place when an answer, a failure or a fold arrives, so a key meant for the page never
     lands on Undo.
   - The kit reads and writes no storage: what is remembered between pages is the adapter's choice.
   - html.rvc-ready is set only after a mount that did not throw, so a page can keep its old help button
     until the chat is really there.
   ES5 throughout (var, function, promises), as every Oneworld-authored browser file. */
(function (root) {
  'use strict';

  /* The robot face, drawn with classes rather than colours so it follows the console's light and dark tokens
     (etb2b-chat.css .rvc-f-*). It has no gradient and no id, so any number of copies can sit on one page. */
  var FACE_SVG = '<svg class="rvc-face" viewBox="0 0 64 64" width="28" height="28" aria-hidden="true" focusable="false">' +
    '<line class="rvc-f-line" x1="32" y1="9" x2="32" y2="16"/>' +
    '<circle class="rvc-f-dot" cx="32" cy="7" r="3.6"/>' +
    '<rect class="rvc-f-ear" x="7" y="27" width="6" height="12" rx="3"/>' +
    '<rect class="rvc-f-ear" x="51" y="27" width="6" height="12" rx="3"/>' +
    '<rect class="rvc-f-shell" x="12" y="16" width="40" height="32" rx="13"/>' +
    '<rect class="rvc-f-visor" x="18" y="23" width="28" height="18" rx="9"/>' +
    '<circle class="rvc-f-dot" cx="26" cy="32" r="3.6"/>' +
    '<circle class="rvc-f-dot" cx="38" cy="32" r="3.6"/>' +
    '<circle class="rvc-f-glint" cx="27" cy="31" r="1.1"/>' +
    '<circle class="rvc-f-glint" cx="39" cy="31" r="1.1"/>' +
    '<path class="rvc-f-shell" d="M22 50h20a6 6 0 0 1 6 6v3H16v-3a6 6 0 0 1 6-6z"/>' +
    '<circle class="rvc-f-dot" cx="32" cy="55" r="2.2"/>' +
    '</svg>';
  var ICON_CLOSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var ICON_SEND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M3 11.5l17.5-8.5-8.5 17.5-2-7-7-2z"/></svg>';
  var ICON_MAIL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';

  var PHONE_QUERY = '(max-width: 600px)';     /* the full-screen sheet; etb2b-chat.css uses the same width */
  var STILL_WORKING_MS = 8000;                /* after this the busy line says a long answer is normal */
  var STILL_WORKING_TEXT = 'Still working. This can take up to a minute.';
  var HISTORY_WAIT_MS = 6000;                 /* a first message waits this long, at most, for the replay */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TONES = { draft: 1, upcoming: 1, active: 1, completed: 1, cancelled: 1, deleted: 1, ok: 1, warn: 1, crit: 1, muted: 1 };
  var IST_MIN = 330;                          /* the "as of" time is India time, as the server works it out */

  function str(v) { return v == null ? '' : String(v); }
  function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }
  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isFn(f) { return typeof f === 'function'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Only a path on this site becomes a link: "/" then a letter or digit, with no space, control character or
     backslash anywhere (browsers drop tabs and line breaks inside an address, and read "\" as "/"). */
  function safeHref(h) {
    if (typeof h !== 'string') return null;
    if (!/^\/[A-Za-z0-9]/.test(h)) return null;
    if (/[\u0000- \u007F\\]/.test(h)) return null;
    return h;
  }

  function fmtNum(n) {
    var x = Number(n);
    if (!isFinite(x)) return str(n);
    try { return x.toLocaleString('en-IN'); } catch (e) { return String(x); }
  }

  function toDate(v) {
    if (v == null || v === '') return null;
    var d = typeof v === 'number' ? new Date(v) : new Date(Date.parse(str(v)));
    return isNaN(d.getTime()) ? null : d;
  }

  /* "as of 12:05 IST", or "as of 3 Nov, 12:05 IST" on another day, so a number replayed from history is never
     read as today's. */
  function fmtAsOf(v, nowMs) {
    var d = toDate(v);
    if (!d) return '';
    var t = new Date(d.getTime() + IST_MIN * 60000);
    var n = new Date(nowMs + IST_MIN * 60000);
    var time = pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes());
    var sameDay = t.getUTCFullYear() === n.getUTCFullYear() && t.getUTCMonth() === n.getUTCMonth() && t.getUTCDate() === n.getUTCDate();
    if (sameDay) return 'as of ' + time + ' IST';
    var day = t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + (t.getUTCFullYear() !== n.getUTCFullYear() ? ' ' + t.getUTCFullYear() : '');
    return 'as of ' + day + ', ' + time + ' IST';
  }

  /* A turn's own time, in the person's clock: "12:05" today, else "3 Nov, 12:05". */
  function fmtAt(d, nowMs) {
    var n = new Date(nowMs);
    var time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return time;
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== n.getFullYear() ? ' ' + d.getFullYear() : '') + ', ' + time;
  }

  function cleanId(v) {
    var s = str(v).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'rv';
  }

  function report(err) {
    try { if (root.console && root.console.error) root.console.error('ETB2B AI chat:', err); } catch (e) { /* nothing to do */ }
  }

  /* A page callback that throws must not leave the chat half-open or locked. */
  function safe(fn, a, b) {
    if (!isFn(fn)) return undefined;
    try { return fn(a, b); } catch (e) { report(e); return undefined; }
  }

  function mount(host, opts) {
    var doc = root.document;
    if (!doc || !isFn(doc.createElement)) throw new Error('RevampChat.mount: there is no document');
    if (typeof host === 'string') host = doc.getElementById(host);
    if (!host || !isFn(host.appendChild)) throw new Error('RevampChat.mount: the host element is missing');
    opts = opts || {};
    if (!isFn(opts.send)) throw new Error('RevampChat.mount: opts.send must be a function');

    var title = trim(opts.title) || 'ETB2B AI';
    var launcherLabel = trim(opts.launcherLabel) || 'Ask ' + title;
    var clean = cleanId(opts.id), base = clean, n = 1;
    /* a second chat on the page gets its own ids (dash, dash-2, …) rather than duplicates */
    while (doc.getElementById(base + '-chat-panel')) { n += 1; base = clean + '-' + n; }
    function idOf(part) { return base + '-chat-' + part; }

    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text != null && text !== '') e.textContent = String(text);
      return e;
    }
    function txt(s) { return doc.createTextNode(str(s)); }
    function button(cls, label) {
      var b = el('button', cls, label);
      b.setAttribute('type', 'button');
      return b;
    }
    function on(target, type, fn) { target.addEventListener(type, fn); }
    function lockBtn(b) { b.setAttribute('aria-disabled', 'true'); }
    function isLocked(b) { return b.getAttribute('aria-disabled') === 'true'; }
    function now() { return Date.now(); }

    /* ---------- state ---------- */
    var isOpenNow = false, folded = false, everOpened = false, reported = false;
    var busy = false, busyTimer = null, stillShown = false, busyWords = '', savedScroll = null;
    var historyPending = null;                /* the replay's promise while it runs */
    var historyAnchor = null;                 /* the first new message drawn while the replay was still loading */
    var lastFail = null;                      /* {text, node, bubble}: Enter on the same text is Try again */
    var running = [];                         /* countdowns still running, newest last (Esc stops the newest) */
    var undoSets = [];                        /* [{fn, els[], done, pending}] */
    var peekUndoFn = null;
    var peekCd = null;                        /* the countdown the folded bar shows, while the panel is shut */
    var mq = null;
    var CLOSED_STAY = 'Stayed here, as ' + title + ' was closed.';

    /* ---------- markup ---------- */
    var wrap = el('div', 'rvc');
    wrap.setAttribute('data-rvc', base);

    var launcher = button('rvc-launcher');
    launcher.id = idOf('launcher');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', idOf('panel'));
    /* the name holds the words shown on it, so "click Ask ETB2B AI" works for voice control too */
    launcher.setAttribute('aria-label', launcherLabel);
    var lFace = el('span', 'rvc-launcher-face');
    lFace.innerHTML = FACE_SVG;
    var lNew = el('span', 'rvc-launcher-new');
    lNew.setAttribute('aria-hidden', 'true');
    lFace.appendChild(lNew);
    var lLabel = el('span', 'rvc-launcher-label', launcherLabel);
    lLabel.setAttribute('aria-hidden', 'true');
    launcher.appendChild(lFace);
    launcher.appendChild(lLabel);

    var panel = el('section', 'rvc-panel');
    panel.id = idOf('panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', idOf('title'));
    panel.hidden = true;

    var head = el('div', 'rvc-head');
    var hFace = el('span', 'rvc-head-face');
    hFace.innerHTML = FACE_SVG;
    var hId = el('div', 'rvc-head-id');
    var hTitle = el('h2', 'rvc-title', title);
    hTitle.id = idOf('title');
    var status = el('span', 'rvc-status');
    status.id = idOf('status');
    status.setAttribute('role', 'status');
    var statusDot = el('i');
    statusDot.setAttribute('aria-hidden', 'true');
    var statusText = el('span', 'rvc-status-text', 'Ready');
    var statusMore = el('span', 'rvc-sr');
    status.appendChild(statusDot);
    status.appendChild(statusText);
    status.appendChild(statusMore);
    hId.appendChild(hTitle);
    hId.appendChild(status);
    head.appendChild(hFace);
    head.appendChild(hId);
    var helpBtn = null;
    if (opts.help && isFn(opts.help.onClick)) {
      helpBtn = button('rvc-head-help');
      var helpIcon = el('span', 'rvc-head-help-icon');
      helpIcon.innerHTML = ICON_MAIL;
      helpBtn.appendChild(helpIcon);
      helpBtn.appendChild(el('span', 'rvc-head-help-text', trim(opts.help.label) || 'Email Customer Care'));
      head.appendChild(helpBtn);
    }
    var closeBtn = button('rvc-close');
    closeBtn.setAttribute('aria-label', 'Close ' + title);
    closeBtn.innerHTML = ICON_CLOSE;
    head.appendChild(closeBtn);

    var thread = el('div', 'rvc-thread');
    thread.id = idOf('thread');
    thread.setAttribute('role', 'log');
    thread.setAttribute('aria-live', 'polite');
    thread.setAttribute('aria-relevant', 'additions');
    thread.setAttribute('aria-label', 'Conversation with ' + title);
    thread.setAttribute('tabindex', '0');      /* a scrolling area a keyboard can scroll */

    var busyEl = el('div', 'rvc-busy');
    busyEl.id = idOf('busy');
    busyEl.hidden = true;
    busyEl.setAttribute('aria-hidden', 'true');  /* the status pill says it to screen readers, once */
    var spin = el('span', 'rvc-spin');
    var busyText = el('span', 'rvc-busy-text');
    busyEl.appendChild(spin);
    busyEl.appendChild(busyText);

    var compose = el('div', 'rvc-compose');
    var inputLabel = el('label', 'rvc-sr', 'Message ' + title);
    inputLabel.setAttribute('for', idOf('input'));
    var input = el('textarea', 'rvc-input');
    input.id = idOf('input');
    input.setAttribute('rows', '1');
    input.setAttribute('placeholder', trim(opts.placeholder) || 'Ask ' + title + '…');
    input.setAttribute('enterkeyhint', 'send');
    input.setAttribute('autocomplete', 'off');
    var sendBtn = button('rvc-send');
    sendBtn.id = idOf('send');
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.innerHTML = ICON_SEND;
    compose.appendChild(inputLabel);
    compose.appendChild(input);
    compose.appendChild(sendBtn);

    panel.appendChild(head);
    panel.appendChild(thread);
    panel.appendChild(busyEl);
    panel.appendChild(compose);
    if (trim(opts.footNote)) panel.appendChild(el('p', 'rvc-footnote', trim(opts.footNote)));

    /* the folded bar: what the last list change was, Undo, and the way back to the conversation */
    var peek = el('div', 'rvc-peek');
    peek.id = idOf('peek');
    peek.setAttribute('role', 'group');
    peek.setAttribute('aria-label', title);
    peek.hidden = true;
    var pFace = el('span', 'rvc-peek-face');
    pFace.innerHTML = FACE_SVG;
    var pLabel = el('span', 'rvc-peek-label');
    var pUndo = button('rvc-btn rvc-undo', 'Undo');
    var pBack = button('rvc-btn', 'Back to chat');
    /* Stay here, put in the bar only while a page is about to open with the panel shut (so it is never a hidden
       twin of the card's own Stay here) */
    var pStay = button('rvc-btn rvc-stay', 'Stay here');
    peek.appendChild(pFace);
    peek.appendChild(pLabel);
    peek.appendChild(pUndo);
    peek.appendChild(pBack);

    /* said to screen readers while the panel (and its log) is out of sight */
    var live = el('div', 'rvc-sr');
    live.id = idOf('live');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');

    wrap.appendChild(launcher);
    wrap.appendChild(peek);
    wrap.appendChild(panel);
    wrap.appendChild(live);

    /* ---------- the welcome (always first in the thread) ---------- */
    var welcomeOpts = opts.welcome || {};
    var welcome = el('div', 'rvc-welcome');
    welcome.appendChild(el('h3', 'rvc-welcome-h', trim(welcomeOpts.heading) || 'Hi, I’m ' + title + '.'));
    if (trim(welcomeOpts.text)) welcome.appendChild(el('p', 'rvc-welcome-p', trim(welcomeOpts.text)));
    var suggestions = isArray(opts.suggestions) ? opts.suggestions : [];
    if (suggestions.length) {
      var sg = el('div', 'rvc-suggest');
      sg.setAttribute('role', 'group');
      sg.setAttribute('aria-label', 'Suggestions');
      /* says plainly that a suggestion only starts the message: nothing is sent until the person sends it */
      sg.appendChild(el('p', 'rvc-suggest-hint', 'Pick one to start your message. Nothing is sent until you press Enter.'));
      for (var si = 0; si < suggestions.length; si++) {
        (function (s) {
          if (!s) return;
          var label = trim(s.label) || trim(s.text);
          if (!label) return;
          var b = button('rvc-suggestion', label);
          on(b, 'click', function () { fillFromSuggestion(str(s.text) || label); });
          sg.appendChild(b);
        })(suggestions[si]);
      }
      welcome.appendChild(sg);
    }
    thread.appendChild(welcome);

    /* ---------- scrolling: follow new turns only when the person is already at the end ---------- */
    function nearEnd() { return (thread.scrollHeight || 0) - (thread.scrollTop || 0) - (thread.clientHeight || 0) < 48; }
    function toEnd() { thread.scrollTop = thread.scrollHeight || 0; }
    function append(node, force) {
      var stick = force || nearEnd();
      thread.appendChild(node);
      if (stick) toEnd();
      return node;
    }
    function follow(fn) {
      var stick = nearEnd();
      var r = fn();
      if (stick) toEnd();
      return r;
    }
    /* browsers may forget a hidden box's scroll place, so it is kept by hand across close and fold */
    function saveScroll() { savedScroll = thread.scrollTop || 0; }
    function restoreScroll() { if (savedScroll != null) thread.scrollTop = savedScroll; }

    function announce(s) {
      live.textContent = '';
      root.setTimeout(function () { live.textContent = s; }, 60);
    }
    function focusInside() {
      var a = doc.activeElement;
      return !!(a && wrap.contains(a));
    }
    /* the kit may move focus only from inside the chat or from nowhere (see the rules at the top) */
    function mayTakeFocus() {
      var a = doc.activeElement;
      return !a || a === doc.body || a === doc.documentElement || wrap.contains(a);
    }
    function focusInput() { try { input.focus(); } catch (e) { /* not focusable yet */ } }
    function focusEl(e) { try { e.focus(); } catch (x) { /* not focusable */ } }

    /* ---------- phones: a full-screen sheet that keeps the page still behind it ---------- */
    function isPhone() { return !!(mq && mq.matches); }
    function syncMode() {
      var html = doc.documentElement;
      var sheet = isOpenNow && isPhone();
      panel.setAttribute('aria-modal', sheet ? 'true' : 'false');
      if (html && html.classList) {
        if (sheet) html.classList.add('rvc-lock'); else html.classList.remove('rvc-lock');
      }
      syncViewport();
    }
    /* the on-screen keyboard shrinks the visual viewport, not the layout one: the sheet follows the visual
       one so the message box stays above the keyboard */
    function syncViewport() {
      var vv = root.visualViewport;
      if (vv && isOpenNow && isPhone() && vv.height > 0) {
        panel.style.setProperty('--rvc-vh', Math.round(vv.height) + 'px');
        panel.style.setProperty('--rvc-vt', Math.round(vv.offsetTop || 0) + 'px');
        panel.classList.add('rvc-has-vv');
      } else {
        panel.classList.remove('rvc-has-vv');
      }
    }

    function tellOpen(v) {
      if (v === reported) return;
      reported = v;
      safe(opts.onOpenChange, v);
    }
    function markNew() {
      launcher.classList.add('has-new');
      launcher.setAttribute('aria-label', launcherLabel + ' (new reply)');
    }
    function clearNew() {
      launcher.classList.remove('has-new');
      launcher.setAttribute('aria-label', launcherLabel);
    }

    /* ---------- open, close, fold ---------- */
    function open() {
      var was = isOpenNow;
      /* a countdown shown in the bar goes on in its card, whose Stay here is now in sight */
      if (folded) { folded = false; peek.hidden = true; dropPeekStay(); }
      if (!was) {
        panel.hidden = false;
        isOpenNow = true;
        launcher.setAttribute('aria-expanded', 'true');
        launcher.classList.add('is-open');
        clearNew();
        syncMode();
        restoreScroll();
      }
      focusInput();
      if (!everOpened) {
        everOpened = true;
        launcher.classList.add('is-quiet');
        startHistory();
      }
      tellOpen(true);
    }

    function close(focusLauncher) {
      var hadFocus = focusInside();
      /* closing is staying: a page about to open would otherwise leave with its Stay here out of sight */
      stopCountdowns(CLOSED_STAY);
      if (isOpenNow) saveScroll();
      isOpenNow = false;
      folded = false;
      panel.hidden = true;
      peek.hidden = true;
      dropPeekStay();
      launcher.setAttribute('aria-expanded', 'false');
      launcher.classList.remove('is-open');
      syncMode();
      if (focusLauncher || hadFocus) focusEl(launcher);
      tellOpen(false);
    }

    /* After a change to the list the open panel would hide exactly what changed, so it folds into a one-line
       bar above the launcher: the change, Undo, and Back to chat. */
    function fold(label, onUndo) {
      /* where the focus is now decides whether the bar may take it: someone typing in the page keeps their place */
      var take = mayTakeFocus();
      var l = trim(label);
      var shown = l ? (/^showing\b/i.test(l) ? l : 'Showing ' + l) : 'Showing the results';
      /* the list change is the newest thing asked for: a page that was about to open stays here */
      stopCountdowns();
      dropPeekStay();
      if (isOpenNow) saveScroll();
      isOpenNow = false;
      panel.hidden = true;
      folded = true;
      peek.hidden = false;
      pLabel.textContent = shown;
      pLabel.setAttribute('title', shown);
      launcher.setAttribute('aria-expanded', 'false');
      launcher.classList.remove('is-open');
      peekUndoFn = isFn(onUndo) ? onUndo : null;
      unbindUndo(pUndo);
      if (peekUndoFn) { pUndo.hidden = false; bindUndo(peekUndoFn, pUndo); } else pUndo.hidden = true;
      syncMode();
      if (take) focusEl(peekUndoFn ? pUndo : pBack);
      announce(shown + (peekUndoFn ? '. Undo is in the ' + title + ' bar.' : '.'));
      tellOpen(false);
    }
    function unfold() { if (folded) open(); }

    /* ---------- a page about to open while the panel is shut ---------- */
    function stopCountdowns(words) {
      var list = running.slice();
      for (var i = list.length - 1; i >= 0; i--) list[i].cancel(words ? { text: words } : undefined);
    }
    /* takes Stay here out of the bar; says whether it had the focus */
    function dropPeekStay() {
      var had = doc.activeElement === pStay;
      peekCd = null;
      removeNode(pStay);
      pStay.removeAttribute('aria-disabled');
      return had;
    }
    /* The bar shows "Opening …" and Stay here, without taking the focus (Esc is Stay here wherever it is). */
    function peekCountdown(h, name) {
      var line = 'Opening ' + name + '…';
      folded = true;
      peek.hidden = false;
      pLabel.textContent = line;
      pLabel.setAttribute('title', line);
      peekUndoFn = null;
      unbindUndo(pUndo);
      pUndo.hidden = true;
      /* unlocked: an earlier one whose time ran out may have left it locked, if that page then did not open */
      pStay.removeAttribute('aria-disabled');
      peek.insertBefore(pStay, pUndo);
      peekCd = h;
      announce('Opening ' + name + ' in a moment. Press Escape or choose Stay here to stay on this page.');
    }
    function peekCountdownEnd(h, words) {
      if (peekCd !== h) return;
      var had = dropPeekStay();
      pLabel.textContent = words;
      pLabel.setAttribute('title', words);
      announce(words);
      if (had) focusEl(pBack);
    }

    /* ---------- Undo, shared by every control bound to one handler ---------- */
    function entryFor(fn) {
      for (var i = 0; i < undoSets.length; i++) if (undoSets[i].fn === fn) return undoSets[i];
      var e = { fn: fn, els: [], done: false, pending: false };
      undoSets.push(e);
      return e;
    }
    function entryOfEl(b) {
      for (var i = 0; i < undoSets.length; i++) if (undoSets[i].els.indexOf(b) !== -1) return undoSets[i];
      return null;
    }
    function paintUndo(b, state) {
      if (state === 'done') { b.textContent = 'Undone'; lockBtn(b); b.classList.add('is-done'); b.removeAttribute('aria-busy'); }
      else if (state === 'pending') { lockBtn(b); b.setAttribute('aria-busy', 'true'); }
      else { b.textContent = 'Undo'; b.removeAttribute('aria-disabled'); b.removeAttribute('aria-busy'); b.classList.remove('is-done'); }
    }
    function paintEntry(e, state) { for (var i = 0; i < e.els.length; i++) paintUndo(e.els[i], state); }
    function bindUndo(fn, b) {
      var e = entryFor(fn);
      if (e.els.indexOf(b) === -1) e.els.push(b);
      paintUndo(b, e.done ? 'done' : e.pending ? 'pending' : 'ready');
      return e;
    }
    function unbindUndo(b) {
      for (var i = 0; i < undoSets.length; i++) {
        var k = undoSets[i].els.indexOf(b);
        if (k !== -1) undoSets[i].els.splice(k, 1);
      }
    }
    function finishUndo(e) {
      e.done = true;
      e.pending = false;
      paintEntry(e, 'done');
      if (folded) announce('Undone.');
    }
    function runUndo(e) {
      if (!e || e.done || e.pending) return;
      var r;
      try { r = e.fn(); } catch (err) { report(err); return; }
      if (r === false) return;
      if (r && isFn(r.then)) {
        e.pending = true;
        paintEntry(e, 'pending');
        r.then(function (v) {
          if (v === false) { e.pending = false; paintEntry(e, 'ready'); } else finishUndo(e);
        }, function (err) { report(err); e.pending = false; paintEntry(e, 'ready'); });
        return;
      }
      finishUndo(e);
    }
    function markUndone(fn) {
      if (!isFn(fn)) return;
      var e = entryFor(fn);
      if (!e.done) finishUndo(e);
    }

    /* ---------- busy ---------- */
    function setStatus(text, more) {
      statusText.textContent = text;
      statusMore.textContent = more || '';
    }
    /* Calling it again while busy only changes the strip's words: the 8 s clock keeps running from the first
       call, and once the pill says "Still working…" it keeps saying so (an adapter may call it more than once). */
    function setBusy(onFlag, text) {
      var words = trim(text);
      if (onFlag) {
        if (!busy) {
          busy = true;
          stillShown = false;
          panel.classList.add('is-busy');
          panel.setAttribute('aria-busy', 'true');
          busyEl.hidden = false;
          /* the box is locked but keeps focus: readonly, not disabled, so a keyboard user is not thrown out */
          input.readOnly = true;
          input.setAttribute('aria-disabled', 'true');
          sendBtn.disabled = true;
          busyTimer = root.setTimeout(function () {
            busyTimer = null;
            if (!busy) return;
            stillShown = true;
            if (!busyWords) busyText.textContent = STILL_WORKING_TEXT;
            setStatus('Still working…', ' This can take up to a minute.');
          }, STILL_WORKING_MS);
        }
        busyWords = words;
        busyText.textContent = words || (stillShown ? STILL_WORKING_TEXT : title + ' is thinking…');
        if (!stillShown) setStatus('Thinking…');
      } else {
        busy = false;
        stillShown = false;
        busyWords = '';
        if (busyTimer) { root.clearTimeout(busyTimer); busyTimer = null; }
        panel.classList.remove('is-busy');
        panel.removeAttribute('aria-busy');
        setStatus('Ready');
        busyEl.hidden = true;
        input.readOnly = false;
        input.removeAttribute('aria-disabled');
        sendBtn.disabled = false;
      }
    }

    /* ---------- the message box ---------- */
    function autosize() {
      var s = input.style;
      s.height = 'auto';
      var h = input.scrollHeight || 0;
      if (h > 0) s.height = h + 'px';    /* the stylesheet's max-height stops it at five lines */
    }
    function fillFromSuggestion(t) {
      if (busy) return;
      if (!isOpenNow) open();
      input.value = t;
      autosize();
      focusInput();
      /* the first "…" is selected, so typing replaces it */
      var i = t.indexOf('…');
      try {
        if (i !== -1) input.setSelectionRange(i, i + 1);
        else input.setSelectionRange(t.length, t.length);
      } catch (e) { /* an input that cannot select */ }
    }

    function waitForHistory() {
      if (!historyPending) return Promise.resolve();
      return new Promise(function (done) {
        var t = root.setTimeout(done, HISTORY_WAIT_MS);
        historyPending.then(function () { root.clearTimeout(t); done(); }, function () { root.clearTimeout(t); done(); });
      });
    }

    function errorText(err) {
      if (root.navigator && root.navigator.onLine === false) return 'You’re offline. Check your connection and try again.';
      var m = err && typeof err === 'object' ? err.message : err;
      m = trim(m);
      return m || title + ' could not answer just now. Try again.';
    }

    function markFailed(node) {
      if (!node || node._rvcFailed) return;
      node.classList.add('is-failed');
      var note = el('p', 'rvc-failed-note', 'Not sent');
      node._rvcFailed = note;
      var body = node.lastChild || node;
      body.appendChild(note);
    }
    function unmarkFailed(node) {
      if (!node || !node._rvcFailed) return;
      node.classList.remove('is-failed');
      var note = node._rvcFailed;
      if (note.parentNode) note.parentNode.removeChild(note);
      node._rvcFailed = null;
    }
    function removeNode(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }

    function failed(t, node, err) {
      if (!trim(input.value)) { input.value = t; autosize(); }
      markFailed(node);
      if (err && err.silent === true) { lastFail = { text: t, node: node, bubble: null }; return; }
      var b = ai(errorText(err), { error: true });
      var fail = { text: t, node: node, bubble: b.node };
      lastFail = fail;
      if (!(err && err.retryable === false)) {
        b.button('Try again', function () {
          if (busy) return;
          removeNode(fail.bubble);
          if (lastFail === fail) lastFail = null;
          submit(t, node);
          focusInput();
        });
      }
    }

    /* One request at a time. The person's bubble is drawn here, after any replay of earlier turns. */
    function submit(given, retryNode) {
      if (busy) return false;
      var raw = given != null ? str(given) : str(input.value);
      var t = trim(raw);
      if (!t) { focusInput(); return false; }
      var userNode = retryNode || null;
      if (lastFail) {
        /* Enter on the same text that just failed is the same as its Try again */
        if (!userNode && lastFail.text === t) userNode = lastFail.node;
        if (userNode && userNode === lastFail.node) removeNode(lastFail.bubble);
        lastFail = null;
      }
      if (trim(input.value) === t) { input.value = ''; autosize(); }
      setBusy(true);
      return waitForHistory().then(function () {
        var node = userNode;
        /* the failed bubble is used again only while it is still the last thing in the conversation */
        if (node && node.parentNode === thread && thread.lastChild === node) { unmarkFailed(node); toEnd(); }
        else node = user(t, null, true);
        /* the replay is late: whatever of it is still to come goes in above this message */
        if (historyPending && !historyAnchor) historyAnchor = node;
        var p;
        try { p = opts.send(t); } catch (e) { p = Promise.reject(e); }
        return Promise.resolve(p).then(function () {
          setBusy(false);
          if (isOpenNow && mayTakeFocus()) focusInput();
        }, function (err) {
          setBusy(false);
          failed(t, node, err);
          if (isOpenNow && mayTakeFocus()) focusInput();
        });
      });
    }

    /* ---------- history ---------- */
    /* Normally a new message waits for the replay, so everything is simply drawn in order at the end. Once the
       6 s wait has let a new message go ahead (historyAnchor), whatever of the replay is still to come goes in
       above that message, so it never lands between the new question and its answer. */
    function startHistory() {
      if (!isFn(opts.loadHistory)) return;
      var r;
      try { r = opts.loadHistory(replayWriter); } catch (e) { r = Promise.reject(e); }
      if (!r || !isFn(r.then)) return;
      var loading = el('p', 'rvc-loading', 'Loading your earlier messages…');
      loading.setAttribute('aria-hidden', 'true');
      append(loading);
      var p = Promise.resolve(r).then(function () {
        var late = !!historyAnchor;
        removeNode(loading);
        historyAnchor = null;
        historyPending = null;
        /* a late replay went in above; the person's place in the new conversation is kept */
        if (!late) toEnd();
      }, function (err) {
        report(err);
        var note = el('p', 'rvc-loading', 'Your earlier messages could not be loaded.');
        if (loading.parentNode) { loading.parentNode.insertBefore(note, loading); removeNode(loading); } else append(note);
        historyAnchor = null;
        historyPending = null;
      });
      historyPending = p;
    }
    /* draws a node of the replay above the new message when the replay is late, else at the end */
    function place(node, toReplay, force) {
      if (!toReplay || !historyAnchor || historyAnchor.parentNode !== thread) return append(node, force);
      var stick = nearEnd();
      thread.insertBefore(node, historyAnchor);
      if (stick) toEnd();
      return node;
    }
    /* a turn with its own time (at) is one from the past */
    function pastTurn(o) { return !!(o && o.at != null && o.at !== ''); }

    /* ---------- turns ---------- */
    function metaLine(who, at) {
      var m = el('div', 'rvc-meta');
      m.appendChild(el('span', 'rvc-sender', who));
      var d = toDate(at);
      if (d) {
        var t = el('time', 'rvc-time', fmtAt(d, now()));
        t.setAttribute('datetime', d.toISOString());
        m.appendChild(t);
      }
      return m;
    }

    function user(text, o, force, toReplay) {
      o = o || {};
      var turn = el('div', 'rvc-turn rvc-user');
      var body = el('div', 'rvc-turn-body');
      body.appendChild(metaLine('You', o.at));
      body.appendChild(el('div', 'rvc-msg', str(text)));
      turn.appendChild(body);
      place(turn, toReplay, !!force);
      return turn;
    }

    function renderContent(box, content) {
      if (typeof content === 'string' || typeof content === 'number') { box.appendChild(txt(content)); return; }
      if (!isArray(content)) return;
      for (var i = 0; i < content.length; i++) {
        var p = content[i];
        if (!p || typeof p !== 'object') continue;
        if (p.t === 'text') box.appendChild(txt(p.v));
        else if (p.t === 'event') {
          var href = safeHref(p.href);
          var a = el(href ? 'a' : 'span', href ? 'rvc-ev' : 'rvc-ev-plain', str(p.name != null ? p.name : p.v));
          if (href) a.setAttribute('href', href);
          box.appendChild(a);
        } else if (p.t === 'value') {
          var s = el('strong', 'rvc-val', str(p.v));
          if (p.metric) s.setAttribute('data-metric', str(p.metric));
          box.appendChild(s);
        } else if (p.t === 'missing') box.appendChild(el('em', 'rvc-missing', str(p.v)));
        else if (typeof p.v === 'string') box.appendChild(txt(p.v));
      }
    }

    function ai(content, o, toReplay) {
      o = o || {};
      var turn = el('div', 'rvc-turn rvc-ai' + (o.error ? ' rvc-error' : ''));
      var av = el('span', 'rvc-avatar');
      av.setAttribute('aria-hidden', 'true');
      av.innerHTML = FACE_SVG;
      var body = el('div', 'rvc-turn-body');
      body.appendChild(metaLine(title, o.at));
      var msg = el('div', 'rvc-msg');
      var textBox = el('div', 'rvc-text');
      renderContent(textBox, content);
      var extra = el('div', 'rvc-extra');
      var foot = el('div', 'rvc-foot');
      msg.appendChild(textBox);
      msg.appendChild(extra);
      var asOf = o.asOf != null ? fmtAsOf(o.asOf, now()) : '';
      if (asOf) msg.appendChild(el('p', 'rvc-asof', asOf));
      msg.appendChild(foot);
      body.appendChild(msg);
      turn.appendChild(av);
      turn.appendChild(body);
      place(turn, toReplay);
      /* a replayed turn is not a new reply */
      if (!isOpenNow && !(toReplay && historyPending)) markNew();
      return bubble(turn, extra, foot);
    }

    function divider(label, toReplay) {
      var d = el('div', 'rvc-divider');
      d.appendChild(el('span', null, str(label)));
      return place(d, toReplay);
    }

    /* ---------- what goes inside an answer ---------- */
    function bubble(turn, extra, foot) {
      function list(spec) {
        spec = spec || {};
        return follow(function () {
          var items = isArray(spec.items) ? spec.items : [];
          var card = el('div', 'rvc-card rvc-list');
          var headL = el('div', 'rvc-list-head');
          headL.appendChild(el('span', 'rvc-list-title', str(spec.title)));
          var count = spec.count != null && spec.count !== '' && isFinite(Number(spec.count)) ? Number(spec.count) : null;
          if (count != null) {
            var c = el('span', 'rvc-count');
            var cv = el('span', null, fmtNum(count));
            cv.setAttribute('aria-hidden', 'true');
            c.appendChild(cv);
            c.appendChild(el('span', 'rvc-sr', ' (' + fmtNum(count) + ' in all)'));
            headL.appendChild(c);
          }
          card.appendChild(headL);
          if (items.length) {
            var ol = el('ol', 'rvc-rows');
            for (var i = 0; i < items.length; i++) {
              var it = items[i] || {};
              var li = el('li', 'rvc-row');
              var main = el('div', 'rvc-row-main');
              var href = safeHref(it.href);
              var name = el(href ? 'a' : 'span', 'rvc-row-name', str(it.name));
              if (href) name.setAttribute('href', href);
              main.appendChild(name);
              if (it.value != null && it.value !== '') main.appendChild(el('span', 'rvc-row-val', typeof it.value === 'number' ? fmtNum(it.value) : str(it.value)));
              li.appendChild(main);
              var chip = it.chip && trim(it.chip.label) ? it.chip : null;
              if (trim(it.meta) || chip) {
                var meta = el('div', 'rvc-row-meta');
                if (trim(it.meta)) meta.appendChild(el('span', 'rvc-row-dates', str(it.meta)));
                if (chip) {
                  var tone = TONES[chip.tone] ? chip.tone : 'muted';
                  var ch = el('span', 'rvc-chip rvc-tone-' + tone);
                  var dot = el('i');
                  dot.setAttribute('aria-hidden', 'true');
                  ch.appendChild(dot);
                  ch.appendChild(txt(trim(chip.label)));
                  meta.appendChild(ch);
                }
                li.appendChild(meta);
              }
              ol.appendChild(li);
            }
            card.appendChild(ol);
          }
          if (spec.more) {
            card.appendChild(el('p', 'rvc-list-more', count != null && count > items.length ?
              'Showing ' + fmtNum(items.length) + ' of ' + fmtNum(count) + '.' : 'Showing the first ' + fmtNum(items.length) + '.'));
          }
          extra.appendChild(card);
          return card;
        });
      }
      function note(text) {
        return follow(function () { var p = el('p', 'rvc-note', str(text)); extra.appendChild(p); return p; });
      }
      function link(href, label) {
        return follow(function () {
          var p = el('p', 'rvc-link-line');
          var h = safeHref(href);
          var a = el(h ? 'a' : 'span', h ? 'rvc-link' : 'rvc-link-plain', str(label) || str(href));
          if (h) a.setAttribute('href', h);
          p.appendChild(a);
          extra.appendChild(p);
          return a;
        });
      }
      function btn(label, onClick, o) {
        return follow(function () {
          var b = button('rvc-btn' + (o && o.primary ? ' rvc-btn-primary' : ''), str(label));
          on(b, 'click', function (e) { if (!isLocked(b)) safe(onClick, e); });
          foot.appendChild(b);
          return b;
        });
      }
      function undo(onUndo) {
        return follow(function () {
          var b = button('rvc-btn rvc-undo', 'Undo');
          if (isFn(onUndo)) bindUndo(onUndo, b); else lockBtn(b);
          on(b, 'click', function () { if (!isLocked(b)) runUndo(entryOfEl(b)); });
          foot.appendChild(b);
          return b;
        });
      }
      /* "Opening <label>…" with Stay here. The visible line is hidden from screen readers and one full sentence
         is said instead, so the log does not read it twice. onDone runs when the time is up (an adapter may
         also keep its own timer and stop it from onCancel). The label may be the page's name ("Promotions")
         or the whole line ("Opening Promotions…"): either way it reads "Opening Promotions…" once. */
      function countdown(ms, label, onCancel, onDone) {
        return follow(function () {
          var wait = Math.max(0, Number(ms) || 0);
          var name = trim(label);
          if (/^opening\s/i.test(name)) name = trim(name.replace(/^opening\s+/i, '').replace(/(…|\.\.\.)$/, ''));
          name = name || 'the page';
          var card = el('div', 'rvc-card rvc-countdown');
          var line = el('p', 'rvc-cd-text');
          line.setAttribute('aria-hidden', 'true');
          line.appendChild(txt('Opening '));
          line.appendChild(el('strong', null, name));
          line.appendChild(txt('…'));
          var bar = el('div', 'rvc-cd-bar');
          bar.setAttribute('aria-hidden', 'true');
          var fill = el('i');
          fill.style.animationDuration = wait + 'ms';
          bar.appendChild(fill);
          var stay = button('rvc-btn rvc-stay', 'Stay here');
          var said = el('span', 'rvc-sr', 'Opening ' + name + ' in a moment. Press Escape or choose Stay here to stay on this page.');
          card.appendChild(line);
          card.appendChild(bar);
          card.appendChild(stay);
          card.appendChild(said);
          extra.appendChild(card);
          var state = 'run';
          var handle;
          function drop() { var k = running.indexOf(handle); if (k !== -1) running.splice(k, 1); }
          var timer = root.setTimeout(function () {
            if (state !== 'run') return;
            state = 'done';
            drop();
            lockBtn(stay);
            card.classList.add('is-done');
            if (peekCd === handle) lockBtn(pStay);
            safe(onDone);
          }, wait);
          function cancel(o2) {
            if (state !== 'run') return false;
            state = 'cancelled';
            root.clearTimeout(timer);
            drop();
            var hadFocus = doc.activeElement === stay;
            var words = trim(o2 && o2.text) || 'Stayed here.';
            card.classList.add('is-cancelled');
            removeNode(line);
            removeNode(said);
            removeNode(bar);
            removeNode(stay);
            /* a new line, so the log says it */
            card.appendChild(el('p', 'rvc-cd-text', words));
            if (hadFocus) focusInput();
            peekCountdownEnd(handle, words);
            if (!(o2 && o2.silent)) safe(onCancel);
            return true;
          }
          on(stay, 'click', function () { if (!isLocked(stay)) cancel(); });
          handle = { node: card, cancel: cancel, isRunning: function () { return state === 'run'; } };
          running.push(handle);
          /* The panel is shut (closed, or folded after a list change), so this card is out of sight: the bar
             says what is about to open and offers Stay here. Only one page can be on its way at a time. */
          if (!isOpenNow) {
            var others = running.slice(0, running.length - 1);
            for (var r0 = 0; r0 < others.length; r0++) others[r0].cancel();
            peekCountdown(handle, name);
          }
          return handle;
        });
      }
      function choices(list2) {
        return follow(function () {
          var g = el('div', 'rvc-choices');
          g.setAttribute('role', 'group');
          g.setAttribute('aria-label', 'Choose one');
          var btns = [], picked = false;
          var arr = isArray(list2) ? list2 : [];
          for (var i = 0; i < arr.length; i++) {
            (function (c) {
              if (!c || !trim(c.label)) return;
              var b = button('rvc-choice', trim(c.label));
              on(b, 'click', function (e) {
                if (picked || isLocked(b)) return;
                var r = safe(c.onClick, e);
                if (r === false) return;
                picked = true;
                b.classList.add('is-chosen');
                b.appendChild(el('span', 'rvc-sr', ' (chosen)'));
                for (var k = 0; k < btns.length; k++) lockBtn(btns[k]);
              });
              btns.push(b);
              g.appendChild(b);
            })(arr[i]);
          }
          extra.appendChild(g);
          return g;
        });
      }
      return { node: turn, list: list, note: note, link: link, button: btn, undo: undo, countdown: countdown, choices: choices };
    }

    /* ---------- events ---------- */
    on(launcher, 'click', function () {
      if (folded) open();
      else if (isOpenNow) close(true);
      else open();
    });
    on(closeBtn, 'click', function () { close(true); });
    if (helpBtn) on(helpBtn, 'click', function () { safe(opts.help.onClick, helpBtn); });
    on(sendBtn, 'click', function () { submit(); });
    on(input, 'keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submit();
    });
    on(input, 'input', autosize);
    on(pUndo, 'click', function () { if (!isLocked(pUndo)) runUndo(entryOfEl(pUndo)); });
    on(pBack, 'click', function () { open(); });
    on(pStay, 'click', function () { if (!isLocked(pStay) && peekCd) peekCd.cancel(); });
    /* on a phone the sheet is modal: Tab goes round inside it */
    on(panel, 'keydown', function (e) {
      if (e.key !== 'Tab' || !isPhone()) return;
      var first = helpBtn || closeBtn;
      var last = sendBtn.disabled ? input : sendBtn;
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); focusEl(last); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); focusEl(first); }
    });
    function onDocKey(e) {
      if (!e || (e.key !== 'Escape' && e.key !== 'Esc')) return;
      /* while a page is about to open, Esc is Stay here, wherever the focus is */
      if (running.length) { running[running.length - 1].cancel(); e.preventDefault(); return; }
      var t = e.target;
      if (isOpenNow && t && panel.contains(t)) { e.preventDefault(); close(true); return; }
      if (folded && t && peek.contains(t)) { e.preventDefault(); close(true); }
    }

    /* what loadHistory draws with: always in the replay's place */
    var replayWriter = {
      divider: function (label) { return divider(label, true); },
      user: function (text, o) { return user(text, o, false, true); },
      ai: function (content, o) { return ai(content, o, true); }
    };

    var chat = {
      open: open,
      close: function () { close(false); },
      isOpen: function () { return isOpenNow; },
      isFolded: function () { return folded; },
      focusInput: focusInput,
      setBusy: setBusy,
      /* a divider, or a turn with its own time, is part of a replay (see loadHistory at the top) */
      divider: function (label) { return divider(label, true); },
      fold: fold,
      unfold: unfold,
      user: function (text, o) { return user(text, o, false, pastTurn(o)); },
      ai: function (content, o) { return ai(content, o, pastTurn(o)); },
      markUndone: markUndone
    };

    /* everything is built before anything touches the page, so a failure leaves the page as it was */
    host.appendChild(wrap);
    try {
      doc.addEventListener('keydown', onDocKey);
      if (isFn(root.matchMedia)) {
        mq = root.matchMedia(PHONE_QUERY);
        var onMq = function () { syncMode(); };
        if (mq && isFn(mq.addEventListener)) mq.addEventListener('change', onMq);
        else if (mq && isFn(mq.addListener)) mq.addListener(onMq);
      }
      var vv = root.visualViewport;
      if (vv && isFn(vv.addEventListener)) {
        vv.addEventListener('resize', syncViewport);
        vv.addEventListener('scroll', syncViewport);
      }
      if (doc.documentElement && doc.documentElement.classList) doc.documentElement.classList.add('rvc-ready');
    } catch (e) {
      removeNode(wrap);
      try { doc.removeEventListener('keydown', onDocKey); } catch (x) { /* nothing to undo */ }
      throw e;
    }
    if (opts.startOpen) open();
    return chat;
  }

  var api = { mount: mount };
  root.RevampChat = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
