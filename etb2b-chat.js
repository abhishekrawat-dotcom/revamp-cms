/* ETB2B AI chat kit (etb2b-chat.js, window.RevampChat), with etb2b-chat.css.
   The floating "Ask ETB2B AI" launcher, its panel, the conversation bubbles and the cards inside them, for every
   Oneworld 2.0 page a signed-in team member uses. It is one look everywhere: the dashboard's pill and panel, at the
   bottom-right corner, in the kit's own palette (etb2b-chat.css), whatever page it sits on. Nothing here knows
   about events, lists or the server: the page's adapter (dash-bot-client.js, etb2b-assistant.js,
   editor-chat-client.js) decides what is asked and draws the answers through the calls below.

   RevampChat.mount(host, opts) -> chat
     host  an element (or its id) the kit appends its markup to. Everything it draws is position:fixed, so where
           the host sits in the page only decides the Tab order.
     opts  { id:'dash', title:'ETB2B AI', launcherLabel:'Ask ETB2B AI', placeholder:'Ask ETB2B AI…',
             welcome:{heading, text}, suggestions:[{label, text}], quickIdeas:[{label, text}], footNote,
             help:{label, onClick}|null, scope:'Your events',
             send(text, {attachments, context}) -> Promise, loadHistory(writer) -> Promise|null,
             onOpenChange(open), onDockChange(docked), startOpen,
             placement:{right, bottom, compact}, keepClear:'<selectors>', dock:{minWidth, top, foldOver},
             phoneSheet:'full'|'half', phoneQuery:'(max-width: 600px)', zIndex:{launcher, panel},
             wrapAttrs:{'data-…': '…'},
             attach:{accept, max, numbered, label, hint, needWords, add(file) -> Promise<rec>, remove(rec)} }
       send       the kit draws the person's own bubble, locks the box and shows "thinking" by itself; send only
                  asks and draws the answer (chat.ai). It gets the attachments that were ready (rec objects, as
                  attach.add gave them) and the context chip's label (or null). A rejection puts the text and
                  the attachments back and shows the Error's message in an error bubble with Try again.
                  Error.retryable === false leaves Try again out (a daily allowance that is used up);
                  Error.silent === true draws no bubble at all.
       loadHistory  called once, on the first open, with a writer {divider, user, ai, custom} for the replay.
                  While its promise is pending a new message waits for it (at most 6 s). A replay later than that
                  still lands above the new message, never between it and its answer: whatever is drawn through
                  the writer does, and so do chat.divider() and any chat.user() / chat.ai() / chat.custom() given
                  its own time (at), because a turn from the past always has one and a new turn never needs one.
                  Once the replay is in, the thread shows its newest turn.
       placement  where the corner is: right and bottom in px (22 and 22 by default; a phone always uses 16),
                  compact:true for the round face at every width.
       keepClear  a page's own bars the launcher must never cover (Create Event's footer, the console's save
                  bar): while one is on screen under the launcher, or within 40 px above it, everything the kit
                  draws moves up to 8 px above that bar (at most 45 % of the window's height). A bar that slides
                  in (the console's save bar rises over 280 ms) is measured again when its slide ends.
       dock       the editor's column: at minWidth px and wider, the open panel stands as a full-height column at
                  the right edge, from dock.top down, and html gets rvc-docked so the page can make room.
                  chat.setDock(false) turns it off (the panel then floats like on every other page).
                  dock.foldOver:true: while the panel floats open (narrower than minWidth), a keepClear bar that
                  comes under it (the editor's floating toolbars) folds it into its bar at the corner, unless the
                  person is typing in it; Back to chat brings it back.
       phoneSheet 'full' (a full-screen sheet that holds the focus) or 'half' (a bottom sheet over the lower part
                  of the screen, with the page still usable above it). phoneQuery says what counts as a phone:
                  up to three of (max|min)-width, (max|min)-device-width in px, (pointer: coarse|fine) and
                  (hover: none|hover), joined by commas. The device width is what tells a phone on a page with
                  no viewport meta (the editor's), which a phone lays out 980 px wide.
       attach     the attach button (with drag and drop onto the open panel, and paste into the box). The kit
                  calls add(file) once per file; it resolves with {id, name, kind:'image'|'doc', thumb?, size}
                  or rejects with an Error whose message says why, in a sentence (shown on the chip). The page
                  decides what may be attached and what it is for; hint says it in a line.
   chat: open(), close(), isOpen(), isFolded(), focusInput(), setBusy(on, text?, {onStop}?), divider(label),
         fold(label, onUndo), unfold(), user(text, {at?, attachments?, context?}) -> node,
         ai(content, {error?, at?, asOf?, plain?}) -> Bubble, custom(role, node, {at?}) -> Bubble|node,
         markUndone(onUndo), setScope(text), setContext({label, title, prefix?, onClear}|null),
         addAttachment(rec) -> bool, attachments() -> [rec], clearAttachments(), thread() -> element,
         reveal(node) -> bool, setDock(bool), isDocked(), setPhoneSheet('full'|'half'),
         setQuickIdeas([{label, text}]), setWelcome({heading?, text?, suggestions?}|null), relayout() -> lift in px, lift(),
         setChips({label, hint, items:[{label, title, onClick}], more:{label, title, onClick}}|null),
         ask(text) -> Promise<{ok:true, result} | {ok:false, error} | {stopped:true} | {busy:true}>,
         currentAnswer() -> Bubble|null, isBusy() -> bool, isLeaving() -> bool, leaveCount() -> {went, stayed}, undoBind(button, fn),
         undoRun(fn) -> Promise<bool>,
         undoState(fn) -> 'none'|'ready'|'pending'|'done'
         setChips   the one-click row above the box (etb2b-ai-habits.js: what the person asks most often here, and
                  their shortcuts): unlike suggestions and quick ideas, a chip SENDS (its onClick asks through
                  ask()), so the row is locked while an answer is awaited, and it stands in for the quick ideas
                  while it shows. Arrow keys move along it. null takes it away.
         ask        sends the text as if typed and Enter pressed (the person's bubble, busy, the answer), and says
                  how it ended: the adapter's send result, its failure, Stop, or that a message was already being
                  answered (nothing sent).
         currentAnswer  while a message is being answered, the newest answer drawn for it (where "Save as
                  shortcut" goes); null otherwise.
         isLeaving  a page is about to open (an "Opening …" countdown is running); leaveCount how many countdowns
                  ran out (that page opens) and how many were stayed, so a shortcut's run knows which.
         undoBind / undoRun / undoState  an Undo of the page's own (a step of a shortcut that was run) tied to the
                  same change as the brain's own Undo: either one says "Undone" for both; undoRun is a click on it
                  (Undo all), resolving true once it is undone, or was already.
         close() and fold() stop a page that is about to open (as Stay here does), since its Stay here would be
         out of sight; a countdown that starts while the panel is shut shows in the folded bar, with Stay here.
         setBusy(true, text, {onStop}) shows Stop in the busy strip: Stop calls onStop, unlocks the box and marks
         the person's message "Stopped", with Try again. The answer that comes after that is the adapter's to
         drop: the kit ignores how that send settles. onStop returns 'partly' when Stop came while the
         request was being carried out and part of it is done (the editor's card says which steps, with their
         Undo): the message then says only "Stopped", and its words and attachments are not put back, so
         Enter never runs the whole request again on top of what was done.
   Bubble: node, list({title, count, more, items:[{href, name, meta, chip:{label, tone}, value}]}) -> card,
           note(text) -> el, link(href, label) -> <a> (or a <span> when the address is not one of ours),
           button(label, onClick, {primary?}) -> el, undo(onUndo) -> el,
           countdown(ms, label, onCancel, onDone?) -> {node, cancel(opts?), isRunning()},
           choices([{label, onClick}]) -> el, slot() -> an empty element for the adapter's own nodes,
           text(content) -> replaces the answer's words

   Rules it keeps, and why:
   - Text is only ever put on the page with textContent. innerHTML is used only for the fixed SVG drawings
     below (the face and the icons), so nothing a person or a model typed can become markup. An answer's words
     are given a little structure (bold, lists, paragraphs) by building elements, never by writing markup.
     Nodes an adapter puts in a slot are the adapter's own.
   - A link is drawn only for a path on this site (/x…). "//x" and "/\x" are other sites to a browser, and
     "javascript:" is code, so those stay plain text. A picture is drawn only from a picture data address, a
     blob: address, https: or a path on this site.
   - "Do it, then undo": there is no Apply step. Undo controls bound to the same handler (the card's and the
     folded bar's) become "Undone" together, so one change is never undone twice. A handler that returns false
     (the person said no to a question) leaves Undo as it was; a promise keeps it busy until it settles.
   - The way to stay is always in sight: a page opens only after a countdown whose Stay here can be seen (in
     the open panel, or in the folded bar), and Esc is Stay here wherever the focus is.
   - Focus moves only from inside the chat, or from nowhere: a person typing in the page (its search box, a
     filter) keeps their place when an answer, a failure or a fold arrives, so a key meant for the page never
     lands on Undo.
   - A key pressed inside the chat stays inside it: the page's own shortcuts (the editor's Ctrl+Z, Delete,
     Escape to deselect) never fire while someone types to ETB2B AI.
   - The page's own windows open above it: the panel sits at layer 69, under drawers (70/71), modals (90),
     toasts (100) and full-window studios (1000), so it never hides their buttons.
   - The kit reads and writes no storage: what is remembered between pages is the adapter's choice.
   - html.rvc-ready is set only after a mount that did not throw, so a page can keep its old help button
     until the chat is really there.
   ES5 throughout (var, function, promises), as every Oneworld-authored browser file. */
(function (root) {
  'use strict';

  /* The robot face, drawn with classes rather than colours so it follows the kit's light and dark palette
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
  var ICON_CLIP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2"/></svg>';
  var ICON_DOC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

  var PHONE_QUERY = '(max-width: 600px)';     /* a phone, unless the page says otherwise (opts.phoneQuery) */
  var STILL_WORKING_MS = 8000;                /* after this the busy line says a long answer is normal */
  var HISTORY_WAIT_MS = 6000;                 /* a first message waits this long, at most, for the replay */
  var DOCK_MIN_WIDTH = 1100;                  /* narrower than this a docked column would squeeze the page */
  var DESK_RIGHT = 22, DESK_BOTTOM = 22;      /* the corner on a desktop (etb2b-chat.css --rvc-right/-bottom) */
  var NARROW_RIGHT = 16, NARROW_MAX = 880;    /* from 601 to 880px the corner comes in to 16px */
  var PHONE_EDGE = 16;                        /* a phone's corner */
  var KEEP_BAND = 40;                         /* a bar this close above the launcher still lifts it */
  var KEEP_SPACE = 8;                         /* the room left between a lifted launcher and the bar under it */
  var KEEP_CAP = 0.45;                        /* never lifted more than this share of the window's height */
  var MOTION_ENDS = ['transitionend', 'transitioncancel', 'animationend'];
  var KEEP_SETTLE_MS = 320;                   /* measured once more this long after the page's last change: a bar
                                                 that slides in (the console's save bar, 280 ms) is in place by then */
  var MAX_ATTACH = 10;                        /* the most files one message can carry, whatever a page asks */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TONES = { draft: 1, upcoming: 1, active: 1, completed: 1, cancelled: 1, deleted: 1, ok: 1, warn: 1, crit: 1, muted: 1 };
  var IST_MIN = 330;                          /* the "as of" time is India time, as the server works it out */

  /* Every sentence the kit says, in one place, so the product's wording changes here and only here. */
  var TEXT = {
    ready: 'Ready',
    thinkingPill: 'Thinking…',
    thinkingLine: function (t) { return t + ' is thinking…'; },
    stillPill: 'Still working…',
    stillPillMore: ' This can take up to a minute.',
    stillLine: 'Still working. This can take up to a minute.',
    ask: function (t) { return 'Ask ' + t; },
    placeholder: function (t) { return 'Ask ' + t + '…'; },
    message: function (t) { return 'Message ' + t; },
    conversation: function (t) { return 'Conversation with ' + t; },
    closeName: function (t) { return 'Close ' + t; },
    help: 'Email Customer Care',
    send: 'Send',
    hi: function (t) { return 'Hi, I’m ' + t + '.'; },
    suggestions: 'Suggestions',
    suggestHint: 'Pick one to start your message. Nothing is sent until you press Enter.',
    quickIdeas: 'Quick ideas',
    newReply: ' (new reply)',
    you: 'You',
    undo: 'Undo',
    undone: 'Undone',
    undoneSaid: 'Undone.',
    backToChat: 'Back to chat',
    stayHere: 'Stay here',
    stayed: 'Stayed here.',
    stayedClosed: function (t) { return 'Stayed here, as ' + t + ' was closed.'; },
    showing: 'Showing ',
    showingAll: 'Showing the results',
    undoInBar: function (t) { return '. Undo is in the ' + t + ' bar.'; },
    opening: function (n) { return 'Opening ' + n + '…'; },
    openingWord: 'Opening ',
    openingSaid: function (n) { return 'Opening ' + n + ' in a moment. Press Escape or choose Stay here to stay on this page.'; },
    thePage: 'the page',
    offline: 'You’re offline. Check your connection and try again.',
    noAnswer: function (t) { return t + ' could not answer just now. Try again.'; },
    notSent: 'Not sent',
    tryAgain: 'Try again',
    stop: 'Stop',
    stopName: function (t) { return 'Stop waiting for ' + t; },
    stopped: 'Stopped',
    stoppedSaid: 'Stopped.',
    aside: 'Moved aside for the toolbar',
    loadingHistory: 'Loading your earlier messages…',
    historyFailed: 'Your earlier messages could not be loaded.',
    inAll: function (n) { return ' (' + n + ' in all)'; },
    showingOf: function (a, b) { return 'Showing ' + a + ' of ' + b + '.'; },
    showingFirst: function (a) { return 'Showing the first ' + a + '.'; },
    chooseOne: 'Choose one',
    chosen: ' (chosen)',
    attachLabel: 'Attach a file',
    attachments: 'Attachments',
    dropHere: 'Drop to attach',
    adding: 'Adding…',
    attachedState: ', attached',
    removeName: function (n) { return 'Remove ' + n; },
    attachedSaid: function (n) { return n + ' attached.'; },
    attachFailedSaid: function (n, why) { return n + ' could not be attached: ' + why; },
    attachFailed: 'It could not be attached.',
    removedSaid: function (n) { return n + ' removed.'; },
    tooMany: function (n) { return 'Up to ' + n + ' files per message.'; },
    nFiles: function (n) { return n + ' files'; },
    aFile: 'file',
    needWords: 'Say what the attachment is for, for example “use this as the logo”.',
    stillAdding: 'An attachment is still being added. Send again in a moment.',
    selected: 'Selected: ',
    clearContext: function (l) { return 'Remove “' + l + '” from the message'; },
    contextMark: '↳ ',
    oftenAsked: 'Often asked',
    shortcuts: 'Shortcuts'
  };

  function str(v) { return v == null ? '' : String(v); }
  function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }
  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isFn(f) { return typeof f === 'function'; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArray(v); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* Only a path on this site becomes a link: "/" then a letter or digit, with no space, control character or
     backslash anywhere (browsers drop tabs and line breaks inside an address, and read "\" as "/"). */
  function safeHref(h) {
    if (typeof h !== 'string') return null;
    if (!/^\/[A-Za-z0-9]/.test(h)) return null;
    if (/[\u0000- \u007F\\]/.test(h)) return null;
    return h;
  }

  /* A picture's address: a picture held as data (PNG, JPEG, WebP or GIF only: an SVG is drawn by the page
     first, onto a canvas, before it is shown), one the browser holds (blob:), one on https:, or a path on this
     site. Nothing with a space, a quote or a bracket in it. */
  function safeSrc(s) {
    if (typeof s !== 'string' || !s || s.length > 4000000) return null;
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(s)) return s;
    if (/[\u0000- "'<>\u0060\\\u007F]/.test(s)) return null;
    if (/^blob:https?:\/\/[A-Za-z0-9.:-]+\/[A-Za-z0-9-]+$/.test(s)) return s;
    if (/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\//.test(s)) return s;
    return safeHref(s);
  }

  /* a file's name as it is shown: one line, no control characters, never so long it pushes the panel */
  function cleanName(s) {
    return trim(str(s).replace(/[\u0000-\u001F\u007F]+/g, ' ')).slice(0, 200);
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

  /* a page's px number (a corner, a width), or null when it is not one */
  function pxNum(v) {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 && n <= 4000 ? Math.round(n) : null;
  }
  /* a CSS length for the docked column's top: a number (px) or "56px" / "3.5rem" / "8vh" */
  function cssLen(v) {
    var n = pxNum(v);
    if (n != null) return n + 'px';
    var s = trim(v);
    return /^\d{1,4}(?:\.\d{1,3})?(?:px|rem|em|vh)$/.test(s) ? s : '0px';
  }
  function layer(v) {
    var n = Number(v);
    return isFinite(n) && n >= 1 && n <= 2147483647 && Math.floor(n) === n ? n : null;
  }
  /* only a plain phone query is taken from a page, so nothing else can be slipped into matchMedia: up to three
     of (max|min)-width or (max|min)-device-width in px, (pointer: coarse|fine), (hover: none|hover), joined by
     commas (any one matching is a phone) */
  var MQ_PART = '\\((?:(?:max|min)-(?:device-)?width:\\s*\\d{2,4}px|pointer:\\s*(?:coarse|fine)|hover:\\s*(?:none|hover))\\)';
  var MQ_RE = new RegExp('^' + MQ_PART + '(?:\\s*,\\s*' + MQ_PART + '){0,2}$');
  function widthQuery(v) {
    var s = trim(v);
    return MQ_RE.test(s) ? s : '';
  }
  /* the file input's accept list: types and extensions only */
  function cleanAccept(v) {
    var s = trim(v);
    return /^[A-Za-z0-9.+\/*,\- ]{1,400}$/.test(s) ? s : '';
  }
  function cleanIdeas(list) {
    var out = [];
    if (!isArray(list)) return out;
    for (var i = 0; i < list.length && out.length < 3; i++) {
      var s = list[i];
      if (!s) continue;
      var label = trim(s.label) || trim(s.text);
      if (!label) continue;
      out.push({ label: label, text: str(s.text) || label });
    }
    return out;
  }
  function cleanAttach(a) {
    if (!isObj(a) || !isFn(a.add)) return null;
    var max = Math.floor(Number(a.max));
    if (!isFinite(max) || max < 1) max = 4;
    if (max > MAX_ATTACH) max = MAX_ATTACH;
    return {
      add: a.add, remove: isFn(a.remove) ? a.remove : null, max: max, numbered: !!a.numbered,
      label: trim(a.label) || TEXT.attachLabel, hint: trim(a.hint), accept: cleanAccept(a.accept),
      needWords: trim(a.needWords) || TEXT.needWords
    };
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
    var launcherLabel = trim(opts.launcherLabel) || TEXT.ask(title);
    var clean = cleanId(opts.id), base = clean, n = 1;
    /* a second chat on the page gets its own ids (dash, dash-2, …) rather than duplicates */
    while (doc.getElementById(base + '-chat-panel')) { n += 1; base = clean + '-' + n; }
    function idOf(part) { return base + '-chat-' + part; }

    /* ---------- the page's choices, checked ---------- */
    var placement = isObj(opts.placement) ? opts.placement : {};
    var placeRight = pxNum(placement.right), placeBottom = pxNum(placement.bottom);
    var compact = placement.compact === true;
    var keepSel = typeof opts.keepClear === 'string' ? trim(opts.keepClear) : '';
    var dockOpt = isObj(opts.dock) ? opts.dock : null;
    var dockMin = dockOpt && pxNum(dockOpt.minWidth) ? pxNum(dockOpt.minWidth) : DOCK_MIN_WIDTH;
    var phoneQuery = widthQuery(opts.phoneQuery) || PHONE_QUERY;
    var half = opts.phoneSheet === 'half';
    var attachCfg = cleanAttach(opts.attach);
    var quickIdeas = cleanIdeas(opts.quickIdeas);

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
    function on(target, type, fn, o) { target.addEventListener(type, fn, o); }
    function setClass(e, c, onFlag) { if (e && e.classList) { if (onFlag) e.classList.add(c); else e.classList.remove(c); } }
    function lockBtn(b) { b.setAttribute('aria-disabled', 'true'); }
    function isLocked(b) { return b.getAttribute('aria-disabled') === 'true'; }
    function now() { return Date.now(); }

    /* ---------- state ---------- */
    var isOpenNow = false, folded = false, everOpened = false, reported = false;
    var busy = false, busyTimer = null, stillShown = false, busyWords = '', savedScroll = null;
    var stopFn = null;                        /* the adapter's onStop while Stop is offered */
    var current = null;                       /* {text, node, recs, stopped}: the message being answered */
    var historyPending = null;                /* the replay's promise while it runs */
    var historyAnchor = null;                 /* the first new message drawn while the replay was still loading */
    var lastFail = null;                      /* {text, node, bubble}: Enter on the same text is Try again */
    var running = [];                         /* countdowns still running, newest last (Esc stops the newest) */
    var leaves = { went: 0, stayed: 0 };      /* countdowns that ran out (the page opens) and that were stayed (leaveCount) */
    var undoSets = [];                        /* [{fn, els[], done, pending}] */
    var peekUndoFn = null;
    var peekCd = null;                        /* the countdown the folded bar shows, while the panel is shut */
    var mq = null, dockMq = null;
    var hasTurn = false;                      /* quick ideas show once the conversation has begun */
    var chipSpec = null;                      /* the one-click row's {label, hint, items, more}, or null */
    var chipBtns = [];
    var items = [];                           /* attachments in the tray: {state, name, rec, chip, …} */
    var ctxSpec = null;                       /* the context chip: {label, title, prefix, onClear} */
    var dockOn = !!dockOpt, docked = false;
    var liftNow = 0, liftQueued = false, settleTimer = null;
    var foldOver = !!(dockOpt && dockOpt.foldOver === true);
    var underSig = '';                        /* the keepClear bars under the floating open panel at the last look */
    var dragDepth = 0;
    var CLOSED_STAY = TEXT.stayedClosed(title);

    /* ---------- markup ---------- */
    var wrap = el('div', 'rvc');
    wrap.setAttribute('data-rvc', base);
    if (isObj(opts.wrapAttrs)) {
      for (var wk in opts.wrapAttrs) {
        /* data-* and aria-* only: an attribute a page passes can never be a handler */
        if (has(opts.wrapAttrs, wk) && /^(?:data-[a-z0-9-]+|aria-[a-z]+)$/.test(wk)) wrap.setAttribute(wk, str(opts.wrapAttrs[wk]));
      }
    }
    if (placeRight != null) wrap.style.setProperty('--rvc-right', placeRight + 'px');
    if (placeBottom != null) wrap.style.setProperty('--rvc-bottom', placeBottom + 'px');
    if (compact) wrap.classList.add('rvc-compact');
    if (dockOpt) wrap.style.setProperty('--rvc-dock-top', cssLen(dockOpt.top));
    if (isObj(opts.zIndex)) {
      var zl = layer(opts.zIndex.launcher), zp = layer(opts.zIndex.panel);
      if (zl) wrap.style.setProperty('--rvc-z-launcher', String(zl));
      if (zp) wrap.style.setProperty('--rvc-z-panel', String(zp));
    }

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
    var sub = el('div', 'rvc-sub');
    var status = el('span', 'rvc-status');
    status.id = idOf('status');
    status.setAttribute('role', 'status');
    var statusDot = el('i');
    statusDot.setAttribute('aria-hidden', 'true');
    var statusText = el('span', 'rvc-status-text', TEXT.ready);
    var statusMore = el('span', 'rvc-sr');
    status.appendChild(statusDot);
    status.appendChild(statusText);
    status.appendChild(statusMore);
    /* where this conversation belongs: "Your events", or "This event: …". It is a line of its own across the
       header, under the title row (the stylesheet puts it last), so a long event name is not squeezed beside
       the help button; it is read right after the title and the status. */
    var scope = el('p', 'rvc-scope');
    scope.id = idOf('scope');
    sub.appendChild(status);
    hId.appendChild(hTitle);
    hId.appendChild(sub);
    head.appendChild(hFace);
    head.appendChild(hId);
    head.appendChild(scope);
    var helpBtn = null;
    if (opts.help && isFn(opts.help.onClick)) {
      helpBtn = button('rvc-head-help');
      var helpIcon = el('span', 'rvc-head-help-icon');
      helpIcon.innerHTML = ICON_MAIL;
      helpBtn.appendChild(helpIcon);
      helpBtn.appendChild(el('span', 'rvc-head-help-text', trim(opts.help.label) || TEXT.help));
      head.appendChild(helpBtn);
    }
    var closeBtn = button('rvc-close');
    closeBtn.setAttribute('aria-label', TEXT.closeName(title));
    closeBtn.innerHTML = ICON_CLOSE;
    head.appendChild(closeBtn);

    var thread = el('div', 'rvc-thread');
    thread.id = idOf('thread');
    thread.setAttribute('role', 'log');
    thread.setAttribute('aria-live', 'polite');
    thread.setAttribute('aria-relevant', 'additions');
    thread.setAttribute('aria-label', TEXT.conversation(title));
    thread.setAttribute('tabindex', '0');      /* a scrolling area a keyboard can scroll */

    /* the busy strip: its words are said by the status pill (once), its Stop is a real button */
    var busyEl = el('div', 'rvc-busy');
    busyEl.id = idOf('busy');
    busyEl.hidden = true;
    var spin = el('span', 'rvc-spin');
    spin.setAttribute('aria-hidden', 'true');
    var busyText = el('span', 'rvc-busy-text');
    busyText.setAttribute('aria-hidden', 'true');
    var stopBtn = button('rvc-btn rvc-stop', TEXT.stop);
    stopBtn.id = idOf('stop');
    stopBtn.setAttribute('aria-label', TEXT.stopName(title));
    stopBtn.hidden = true;
    busyEl.appendChild(spin);
    busyEl.appendChild(busyText);
    busyEl.appendChild(stopBtn);

    /* what the message is about (the editor's selected section), with its × */
    var ctxRow = el('div', 'rvc-context');
    ctxRow.id = idOf('context');
    ctxRow.hidden = true;
    var ctxText = el('span', 'rvc-context-text');
    var ctxRm = button('rvc-context-rm', '×');
    ctxRow.appendChild(ctxText);
    ctxRow.appendChild(ctxRm);

    /* the attachments that go with the next message */
    var tray = el('div', 'rvc-tray');
    tray.id = idOf('tray');
    tray.hidden = true;
    var trayHint = el('p', 'rvc-tray-hint', attachCfg ? attachCfg.hint : '');
    trayHint.hidden = !(attachCfg && attachCfg.hint);
    var chips = el('div', 'rvc-chips');
    chips.setAttribute('role', 'list');
    chips.setAttribute('aria-label', TEXT.attachments);
    tray.appendChild(trayHint);
    tray.appendChild(chips);
    /* a line that says why Send did nothing (no words with an attachment, one still being added) */
    var noteEl = el('p', 'rvc-attach-note');
    noteEl.id = idOf('note');
    noteEl.hidden = true;

    /* the one-click row (setChips): a label, the chips and the shortcuts button; a chip sends at once */
    var chipRow = el('div', 'rvc-chiprow');
    chipRow.id = idOf('chips');
    chipRow.setAttribute('role', 'group');
    chipRow.hidden = true;
    var chipHint = el('span', 'rvc-sr');
    chipHint.id = idOf('chips-hint');

    var compose = el('div', 'rvc-compose');
    var inputLabel = el('label', 'rvc-sr', TEXT.message(title));
    inputLabel.setAttribute('for', idOf('input'));
    var input = el('textarea', 'rvc-input');
    input.id = idOf('input');
    input.setAttribute('rows', '1');
    input.setAttribute('placeholder', trim(opts.placeholder) || TEXT.placeholder(title));
    input.setAttribute('enterkeyhint', 'send');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-describedby', idOf('note'));
    var sendBtn = button('rvc-send');
    sendBtn.id = idOf('send');
    sendBtn.setAttribute('aria-label', TEXT.send);
    sendBtn.innerHTML = ICON_SEND;
    compose.appendChild(inputLabel);
    var attachBtn = null, fileInput = null;
    if (attachCfg) {
      attachBtn = button('rvc-attach');
      attachBtn.id = idOf('attach');
      attachBtn.setAttribute('aria-label', attachCfg.label);
      attachBtn.setAttribute('title', attachCfg.hint || attachCfg.label);
      attachBtn.innerHTML = ICON_CLIP;
      fileInput = el('input', 'rvc-file rvc-sr');
      fileInput.id = idOf('file');
      fileInput.setAttribute('type', 'file');
      fileInput.setAttribute('multiple', '');
      if (attachCfg.accept) fileInput.setAttribute('accept', attachCfg.accept);
      fileInput.setAttribute('tabindex', '-1');
      fileInput.setAttribute('aria-hidden', 'true');
      compose.appendChild(attachBtn);
      compose.appendChild(fileInput);
      setClass(compose, 'has-attach', true);
    }
    compose.appendChild(input);
    compose.appendChild(sendBtn);

    var quick = el('div', 'rvc-quick');
    quick.id = idOf('quick');
    quick.setAttribute('role', 'group');
    quick.setAttribute('aria-label', TEXT.quickIdeas);
    quick.hidden = true;

    /* "Drop to attach", over the open panel while a file is dragged over it */
    var drop = null;
    if (attachCfg) {
      drop = el('div', 'rvc-drop');
      drop.setAttribute('aria-hidden', 'true');
      drop.hidden = true;
      drop.appendChild(el('p', 'rvc-drop-h', TEXT.dropHere));
      if (attachCfg.hint) drop.appendChild(el('p', 'rvc-drop-p', attachCfg.hint));
    }

    panel.appendChild(head);
    panel.appendChild(thread);
    panel.appendChild(busyEl);
    panel.appendChild(ctxRow);
    panel.appendChild(tray);
    panel.appendChild(noteEl);
    panel.appendChild(chipRow);
    panel.appendChild(compose);
    panel.appendChild(quick);
    if (trim(opts.footNote)) panel.appendChild(el('p', 'rvc-footnote', trim(opts.footNote)));
    if (drop) panel.appendChild(drop);

    /* the folded bar: what the last change was, Undo, and the way back to the conversation */
    var peek = el('div', 'rvc-peek');
    peek.id = idOf('peek');
    peek.setAttribute('role', 'group');
    peek.setAttribute('aria-label', title);
    peek.hidden = true;
    var pFace = el('span', 'rvc-peek-face');
    pFace.innerHTML = FACE_SVG;
    var pLabel = el('span', 'rvc-peek-label');
    var pUndo = button('rvc-btn rvc-undo', TEXT.undo);
    var pBack = button('rvc-btn', TEXT.backToChat);
    /* Stay here, put in the bar only while a page is about to open with the panel shut (so it is never a hidden
       twin of the card's own Stay here) */
    var pStay = button('rvc-btn rvc-stay', TEXT.stayHere);
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
    /* the page's own welcome, kept so setWelcome(null) can bring it back (Promotions shows the post or mailer
       editor's while one is open in "Edit with AI", and the events side's again when it closes) */
    var firstWelcome = { heading: trim(welcomeOpts.heading) || TEXT.hi(title), text: trim(welcomeOpts.text),
      suggestions: isArray(opts.suggestions) ? opts.suggestions : [] };
    function drawWelcome(w) {
      welcome.textContent = '';
      welcome.appendChild(el('h3', 'rvc-welcome-h', w.heading));
      if (w.text) welcome.appendChild(el('p', 'rvc-welcome-p', w.text));
      var suggestions = w.suggestions;
      if (!suggestions.length) return;
      var sg = el('div', 'rvc-suggest');
      sg.setAttribute('role', 'group');
      sg.setAttribute('aria-label', TEXT.suggestions);
      /* says plainly that a suggestion only starts the message: nothing is sent until the person sends it */
      sg.appendChild(el('p', 'rvc-suggest-hint', TEXT.suggestHint));
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
    /* {heading?, text?, suggestions?}: what it leaves out stays the page's own; null: the page's own again */
    function setWelcome(w) {
      if (!w || typeof w !== 'object') { drawWelcome(firstWelcome); return; }
      drawWelcome({ heading: trim(w.heading) || firstWelcome.heading,
        text: typeof w.text === 'string' ? trim(w.text) : firstWelcome.text,
        suggestions: isArray(w.suggestions) ? w.suggestions : firstWelcome.suggestions });
    }
    drawWelcome(firstWelcome);
    thread.appendChild(welcome);

    /* ---------- quick ideas: under the box once the conversation has begun; they fill, never send ---------- */
    function drawQuick() {
      quick.textContent = '';
      for (var i = 0; i < quickIdeas.length; i++) {
        (function (q) {
          var b = button('rvc-quick-btn', q.label);
          on(b, 'click', function () { fillFromSuggestion(q.text); });
          quick.appendChild(b);
        })(quickIdeas[i]);
      }
      syncQuick();
    }
    function syncQuick() { quick.hidden = !(hasTurn && quickIdeas.length) || !chipRow.hidden; }

    /* ---------- the one-click row: chips that send, and the shortcuts button ---------- */
    function lockChips() {
      for (var i = 0; i < chipBtns.length; i++) {
        if (busy) lockBtn(chipBtns[i]); else chipBtns[i].removeAttribute('aria-disabled');
      }
    }
    function drawChips() {
      chipRow.textContent = '';
      chipBtns = [];
      var spec = chipSpec, items = spec && isArray(spec.items) ? spec.items : [];
      var more = spec && isObj(spec.more) && isFn(spec.more.onClick) ? spec.more : null;
      var any = false;
      if (spec && (items.length || more)) {
        chipRow.setAttribute('aria-label', trim(spec.label) || (items.length ? TEXT.oftenAsked : TEXT.shortcuts));
        chipHint.textContent = trim(spec.hint);
        chipRow.appendChild(chipHint);
        var drawn = 0;
        for (var i = 0; i < items.length && drawn < 6; i++) {
          (function (c) {
            if (!c || !trim(c.label) || !isFn(c.onClick)) return;
            if (!drawn && trim(spec.label)) chipRow.appendChild(el('span', 'rvc-chiprow-label', trim(spec.label)));
            var b = button('rvc-chip-btn', trim(c.label));
            if (trim(c.title)) b.setAttribute('title', trim(c.title));
            if (trim(spec.hint)) b.setAttribute('aria-describedby', chipHint.id);
            on(b, 'click', function (e) { if (!isLocked(b) && !busy) safe(c.onClick, e); });
            chipBtns.push(b);
            chipRow.appendChild(b);
            drawn++;
            any = true;
          })(items[i]);
        }
        if (more) {
          var m = button('rvc-chip-more', trim(more.label) || TEXT.shortcuts);
          if (trim(more.title)) m.setAttribute('title', trim(more.title));
          on(m, 'click', function (e) { safe(more.onClick, e); });
          chipRow.appendChild(m);
          any = true;
        }
      }
      chipRow.hidden = !any;
      lockChips();
      syncQuick();
      scheduleLift();
    }
    /* arrow keys move along the row (Tab still reaches every button in it) */
    on(chipRow, 'keydown', function (e) {
      if (!e || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End')) return;
      var all = [];
      for (var i = 0; i < chipRow.childNodes.length; i++) { var c = chipRow.childNodes[i]; if (c && c.tagName === 'BUTTON') all.push(c); }
      var at = all.indexOf(doc.activeElement);
      if (at === -1 || !all.length) return;
      var to = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
      e.preventDefault();
      focusEl(all[to]);
    });
    function turnDrawn() { if (!hasTurn) { hasTurn = true; syncQuick(); } }
    drawQuick();

    /* ---------- scrolling ----------
       New turns are followed only when the person is already at the end. A new answer taller than the
       conversation's window is shown from its top, so the reader starts at its beginning, not mid-answer. */
    function nearEnd() { return (thread.scrollHeight || 0) - (thread.scrollTop || 0) - (thread.clientHeight || 0) < 48; }
    function toEnd() { thread.scrollTop = thread.scrollHeight || 0; }
    /* a node's distance from the top of the conversation (the thread is the offset parent: position:relative) */
    function offsetIn(node) {
      var top = 0, nd = node, guard = 0;
      while (nd && nd !== thread && guard++ < 40) {
        top += Number(nd.offsetTop) || 0;
        var p = nd.offsetParent;
        if (!p || p === thread) break;
        nd = p;
      }
      return top;
    }
    function isAiTurn(node) { return !!(node && node.classList && node.classList.contains('rvc-ai')); }
    function showNewest(turn) {
      var view = thread.clientHeight || 0, h = turn ? Number(turn.offsetHeight) || 0 : 0;
      if (isAiTurn(turn) && view > 0 && h > view - 16) { thread.scrollTop = Math.max(0, offsetIn(turn) - 8); return; }
      toEnd();
    }
    function append(node, force) {
      var stick = force || nearEnd();
      thread.appendChild(node);
      if (stick) showNewest(node);
      return node;
    }
    function follow(fn, turn) {
      var stick = nearEnd();
      var r = fn();
      if (stick) showNewest(turn);
      return r;
    }
    /* brings a node into view with the least scrolling (the editor's card foot, with its Undo) */
    function reveal(node) {
      if (!node || node === thread || !thread.contains(node)) return false;
      var view = thread.clientHeight || 0;
      if (!view) return false;
      var top = offsetIn(node), h = Number(node.offsetHeight) || 0, st = thread.scrollTop || 0;
      if (top + h > st + view) st = top + h - view + 8;
      if (top < st) st = top - 8;
      thread.scrollTop = Math.max(0, st);
      return true;
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

    /* ---------- phones, and the editor's docked column ---------- */
    function isPhone() { return !!(mq && mq.matches); }
    function syncMode() {
      var html = doc.documentElement;
      var phone = isPhone();
      setClass(wrap, 'rvc-phone', phone);
      setClass(wrap, 'rvc-half', half);
      /* the full sheet holds the focus and keeps the page still behind it; the half sheet leaves the page usable */
      var sheet = isOpenNow && phone && !half;
      panel.setAttribute('aria-modal', sheet ? 'true' : 'false');
      setClass(html, 'rvc-lock', sheet);
      syncDock();
      syncViewport();
    }
    /* the on-screen keyboard shrinks the visual viewport, not the layout one: the sheet follows the visual
       one so the message box stays above the keyboard */
    function syncViewport() {
      var vv = root.visualViewport;
      if (vv && isOpenNow && isPhone() && vv.height > 0) {
        var top = Math.round(vv.offsetTop || 0), hgt = Math.round(vv.height);
        panel.style.setProperty('--rvc-vh', hgt + 'px');
        panel.style.setProperty('--rvc-vt', top + 'px');
        /* the keyboard's height in the layout (the half sheet stands on it) */
        panel.style.setProperty('--rvc-vb', Math.max(0, Math.round((Number(root.innerHeight) || 0) - top - hgt)) + 'px');
        panel.classList.add('rvc-has-vv');
      } else {
        panel.classList.remove('rvc-has-vv');
      }
    }
    function wantDock() { return !!(dockOpt && dockOn && isOpenNow && !isPhone() && dockMq && dockMq.matches); }
    /* html.rvc-docked changes before onOpenChange / onDockChange run, so a page that refits then sees the room */
    function syncDock() {
      var d = wantDock();
      if (d === docked) return;
      docked = d;
      setClass(wrap, 'rvc-is-docked', d);
      setClass(doc.documentElement, 'rvc-docked', d);
      safe(opts.onDockChange, d);
    }

    /* ---------- keeping clear of the page's own bars ----------
       A bar listed in keepClear that is on screen under the launcher's column, and reaches into the band from
       40 px above the unlifted launcher down to the window's bottom, lifts the launcher, the folded bar and
       the panel to 8 px above it. Measured once per frame, after a scroll, a resize or a change to the page,
       and again when a slide or fade on the page ends and KEEP_SETTLE_MS after the last change: a bar that
       slides in (the console's save bar) is still almost below the window in the frame after its change, and
       the end of a transition is no change a MutationObserver sees. */
    function rectOf(e) {
      try { return e && isFn(e.getBoundingClientRect) ? e.getBoundingClientRect() : null; } catch (x) { return null; }
    }
    function unseen(e) {
      if (!isFn(root.getComputedStyle)) return false;
      try { var cs = root.getComputedStyle(e); return !!cs && (cs.visibility === 'hidden' || cs.display === 'none'); } catch (x) { return false; }
    }
    /* the keepClear bars on screen now (not the kit's own), with their boxes: one look per frame */
    function keepBars() {
      var out = [];
      if (!keepSel || !isFn(doc.querySelectorAll)) return out;
      var list;
      try { list = doc.querySelectorAll(keepSel); } catch (e) { report(e); keepSel = ''; return out; }
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (!b || wrap.contains(b)) continue;
        var r = rectOf(b);
        if (!r || !(r.width > 0) || !(r.height > 0) || unseen(b)) continue;
        out.push(r);
      }
      return out;
    }
    function measureLift(bars) {
      var vh = Number(root.innerHeight) || 0, vw = Number(root.innerWidth) || 0;
      if (!keepSel || !vh || !vw) return 0;
      if (!bars) bars = keepBars();
      var phone = isPhone();
      var bottom = phone ? PHONE_EDGE : (placeBottom != null ? placeBottom : DESK_BOTTOM);
      var round = phone || compact;
      var lr = rectOf(launcher);
      var seen = !!(lr && lr.width > 0 && lr.height > 0);
      var lh = seen ? lr.height : (round ? 52 : 44);
      var right = seen ? lr.right : vw - (phone ? PHONE_EDGE : placeRight != null ? placeRight : vw <= NARROW_MAX ? NARROW_RIGHT : DESK_RIGHT);
      var left = seen ? lr.left : right - (round ? 52 : 170);
      var bandTop = vh - bottom - lh - KEEP_BAND;
      var need = 0;
      for (var i = 0; i < bars.length; i++) {
        var r = bars[i];
        if (r.right <= left || r.left >= right) continue;          /* beside the launcher's column */
        if (r.bottom <= bandTop || r.top >= vh) continue;          /* well above it, or below the window */
        var v = vh - r.top + KEEP_SPACE - bottom;
        if (v > need) need = v;
      }
      return Math.max(0, Math.min(Math.floor(vh * KEEP_CAP), Math.round(need)));
    }
    function relayout() {
      if (!keepSel) return liftNow;
      var bars = keepBars();
      var v = measureLift(bars);
      if (v !== liftNow) {
        liftNow = v;
        wrap.style.setProperty('--rvc-lift', v + 'px');
      }
      checkUnder(bars);
      return liftNow;
    }
    /* ---------- the floating panel never sits on a page's toolbar (dock.foldOver) ----------
       While the panel floats open (the editor's "Edit myself" narrower than its dock width), a keepClear bar that
       comes under it (a floating toolbar or pop-up appears or moves there) folds it into its bar at the corner,
       without moving the focus: the person is working on the page. Not while they type in the panel, nor while
       a page is about to open (its Stay here is in the panel). A bar already under the panel when it was
       opened is the person's choice: only a new or moved one folds it. */
    function floatingOpen() { return isOpenNow && !folded && !docked && !isPhone(); }
    function underPanel(bars) {
      var pr = rectOf(panel), sig = '';
      if (!pr || !(pr.width > 0) || !(pr.height > 0)) return '';
      for (var i = 0; i < bars.length; i++) {
        var r = bars[i];
        if (r.right <= pr.left || r.left >= pr.right || r.bottom <= pr.top || r.top >= pr.bottom) continue;
        sig += Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height) + ';';
      }
      return sig;
    }
    function checkUnder(bars) {
      if (!foldOver) return;
      if (!floatingOpen()) { underSig = ''; return; }
      var sig = underPanel(bars), was = underSig;
      underSig = sig;
      if (!sig || sig === was || focusInside() || running.length) return;
      foldAside();
    }
    function noteUnder() { underSig = foldOver && keepSel && floatingOpen() ? underPanel(keepBars()) : ''; }
    function nextFrame(fn) {
      if (isFn(root.requestAnimationFrame)) return root.requestAnimationFrame(fn);
      return root.setTimeout(fn, 16);
    }
    function scheduleLift() {
      if (!keepSel || liftQueued) return;
      liftQueued = true;
      nextFrame(function () { liftQueued = false; relayout(); });
    }
    /* a change to the page: measured in the next frame, and once more when anything it set sliding is still */
    function afterPageChange() {
      scheduleLift();
      if (settleTimer) root.clearTimeout(settleTimer);
      settleTimer = root.setTimeout(function () { settleTimer = null; scheduleLift(); }, KEEP_SETTLE_MS);
    }
    /* a slide or a fade on the page ended (the kit's own are not the page's) */
    function onMotionEnd(ev) {
      var t = ev && ev.target;
      if (t && t.nodeType === 1 && wrap.contains(t)) return;
      scheduleLift();
    }

    function tellOpen(v) {
      if (v === reported) return;
      reported = v;
      safe(opts.onOpenChange, v);
    }
    function markNew() {
      launcher.classList.add('has-new');
      launcher.setAttribute('aria-label', launcherLabel + TEXT.newReply);
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
        noteUnder();
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
      showDrop(false);
      launcher.setAttribute('aria-expanded', 'false');
      launcher.classList.remove('is-open');
      syncMode();
      if (focusLauncher || hadFocus) focusEl(launcher);
      tellOpen(false);
    }

    /* After a change the open panel would hide exactly what changed, so it folds into a one-line bar above
       the launcher: the change, Undo, and Back to chat. */
    function fold(label, onUndo, aside) {
      /* where the focus is now decides whether the bar may take it: someone typing in the page keeps their place;
         a fold-aside never takes it (the person is using the page's toolbar) */
      var take = aside !== true && mayTakeFocus();
      var l = trim(label);
      /* a label that already says what happened ("Showing …", "Now working in ETHRWorld", "Changed “Hero”") is
         shown as it is: "Showing " goes only in front of a bare list ("Draft events · …") */
      var shown = aside === true ? l : l ? (/^(?:showing|now|changed)\b/i.test(l) ? l : TEXT.showing + l) : TEXT.showingAll;
      /* the change is the newest thing asked for: a page that was about to open stays here */
      stopCountdowns();
      dropPeekStay();
      if (isOpenNow) saveScroll();
      isOpenNow = false;
      panel.hidden = true;
      showDrop(false);
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
      announce(shown + (peekUndoFn ? TEXT.undoInBar(title) : '.'));
      tellOpen(false);
    }
    function unfold() { if (folded) open(); }
    function foldAside() { fold(TEXT.aside, null, true); }

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
      var line = TEXT.opening(name);
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
      announce(TEXT.openingSaid(name));
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
      if (state === 'done') { b.textContent = TEXT.undone; lockBtn(b); b.classList.add('is-done'); b.removeAttribute('aria-busy'); }
      else if (state === 'pending') { lockBtn(b); b.setAttribute('aria-busy', 'true'); }
      else { b.textContent = TEXT.undo; b.removeAttribute('aria-disabled'); b.removeAttribute('aria-busy'); b.classList.remove('is-done'); }
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
      if (folded) announce(TEXT.undoneSaid);
    }
    /* -> Promise<boolean>: true once the change is undone (or was already), false when it was not */
    function runUndo(e) {
      if (!e) return Promise.resolve(false);
      if (e.done) return Promise.resolve(true);
      if (e.pending) return e.waiting || Promise.resolve(false);
      var r;
      try { r = e.fn(); } catch (err) { report(err); return Promise.resolve(false); }
      if (r === false) return Promise.resolve(e.done);
      if (r && isFn(r.then)) {
        e.pending = true;
        paintEntry(e, 'pending');
        e.waiting = r.then(function (v) {
          e.pending = false;
          e.waiting = null;
          if (v === false && !e.done) { paintEntry(e, 'ready'); return false; }
          finishUndo(e);
          return true;
        }, function (err) { report(err); e.pending = false; e.waiting = null; paintEntry(e, e.done ? 'done' : 'ready'); return e.done; });
        return e.waiting;
      }
      finishUndo(e);
      return Promise.resolve(true);
    }
    function markUndone(fn) {
      if (!isFn(fn)) return;
      var e = entryFor(fn);
      if (!e.done) finishUndo(e);
    }

    /* ---------- busy, and Stop ---------- */
    function setStatus(text, more) {
      statusText.textContent = text;
      statusMore.textContent = more || '';
    }
    /* Calling it again while busy only changes the strip's words (and, when given, what Stop does): the 8 s
       clock keeps running from the first call, and once the pill says "Still working…" it keeps saying so (an
       adapter may call it more than once). */
    function setBusy(onFlag, text, o) {
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
          lockChips();
          busyTimer = root.setTimeout(function () {
            busyTimer = null;
            if (!busy) return;
            stillShown = true;
            if (!busyWords) busyText.textContent = TEXT.stillLine;
            setStatus(TEXT.stillPill, TEXT.stillPillMore);
          }, STILL_WORKING_MS);
        }
        if (isObj(o) && has(o, 'onStop')) stopFn = isFn(o.onStop) ? o.onStop : null;
        stopBtn.hidden = !stopFn;
        busyWords = words;
        busyText.textContent = words || (stillShown ? TEXT.stillLine : TEXT.thinkingLine(title));
        if (!stillShown) setStatus(TEXT.thinkingPill);
      } else {
        var stopHadFocus = doc.activeElement === stopBtn;
        busy = false;
        stillShown = false;
        busyWords = '';
        stopFn = null;
        stopBtn.hidden = true;
        if (busyTimer) { root.clearTimeout(busyTimer); busyTimer = null; }
        panel.classList.remove('is-busy');
        panel.removeAttribute('aria-busy');
        setStatus(TEXT.ready);
        busyEl.hidden = true;
        input.readOnly = false;
        input.removeAttribute('aria-disabled');
        sendBtn.disabled = false;
        lockChips();
        if (stopHadFocus) focusInput();
      }
    }
    /* Stop: the adapter stops waiting (onStop), the box is free again, and the message says "Stopped" with
       Try again. However the send then settles, the kit leaves it alone. onStop returning 'partly' means part
       of the request is already done (the editor stopped between the steps of a change, which stay, with
       Undo): the message says only "Stopped", and its words and attachments stay out of the box, so neither
       Try again nor Enter runs the whole request again on top of what was done. */
    function doStop() {
      if (!busy || !stopFn) return;
      var fn = stopFn, run = current;
      current = null;
      if (run) run.stopped = true;
      if (run && isFn(run.onStop)) run.onStop();
      var left = safe(fn);
      setBusy(false);
      if (run && left === 'partly') {
        markNode(run.node, 'partly', run.text);
      } else if (run) {
        if (!trim(input.value)) { input.value = run.text; autosize(); }
        restoreRecs(run.recs);
        markNode(run.node, 'stopped', run.text);
        lastFail = { text: run.text, node: run.node, bubble: null };
      }
      announce(TEXT.stoppedSaid);
      if (mayTakeFocus()) focusInput();
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
      sayNote('');
      focusInput();
      /* the first "…" is selected, so typing replaces it */
      var i = t.indexOf('…');
      try {
        if (i !== -1) input.setSelectionRange(i, i + 1);
        else input.setSelectionRange(t.length, t.length);
      } catch (e) { /* an input that cannot select */ }
    }
    function sayNote(s) {
      noteEl.textContent = s || '';
      noteEl.hidden = !s;
      if (s) announce(s);
    }

    function waitForHistory() {
      if (!historyPending) return Promise.resolve();
      return new Promise(function (done) {
        var t = root.setTimeout(done, HISTORY_WAIT_MS);
        historyPending.then(function () { root.clearTimeout(t); done(); }, function () { root.clearTimeout(t); done(); });
      });
    }

    function errorText(err) {
      if (root.navigator && root.navigator.onLine === false) return TEXT.offline;
      var m = err && typeof err === 'object' ? err.message : err;
      m = trim(m);
      return m || TEXT.noAnswer(title);
    }

    /* "Not sent" (a failure), "Stopped · Try again" (Stop) or "Stopped" (Stop after part of it was done) under
       the person's message */
    function markNode(node, kind, t) {
      if (!node) return;
      unmarkNode(node);
      var stopped = kind === 'stopped' || kind === 'partly';
      node.classList.add(stopped ? 'is-stopped' : 'is-failed');
      var note = el('p', 'rvc-failed-note' + (stopped ? ' is-stopped' : ''), stopped ? TEXT.stopped : TEXT.notSent);
      if (kind === 'stopped') {
        var again = button('rvc-linkbtn', TEXT.tryAgain);
        on(again, 'click', function () {
          if (busy) return;
          removeNode(again);
          submit(t, node);
          focusInput();
        });
        note.appendChild(txt(' · '));
        note.appendChild(again);
      }
      node._rvcMark = note;
      var body = node.lastChild || node;
      body.appendChild(note);
    }
    function unmarkNode(node) {
      if (!node || !node._rvcMark) return;
      node.classList.remove('is-failed');
      node.classList.remove('is-stopped');
      removeNode(node._rvcMark);
      node._rvcMark = null;
    }
    function removeNode(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }

    function failed(t, node, err, recs) {
      if (!trim(input.value)) { input.value = t; autosize(); }
      restoreRecs(recs);
      markNode(node, 'failed', t);
      if (err && err.silent === true) { lastFail = { text: t, node: node, bubble: null }; return; }
      var b = ai(errorText(err), { error: true, plain: true });
      var fail = { text: t, node: node, bubble: b.node };
      lastFail = fail;
      if (!(err && err.retryable === false)) {
        b.button(TEXT.tryAgain, function () {
          if (busy) return;
          removeNode(fail.bubble);
          if (lastFail === fail) lastFail = null;
          submit(t, node);
          focusInput();
        });
      }
    }

    /* One request at a time. The person's bubble is drawn here, after any replay of earlier turns. The ready
       attachments and the context chip go with it; a failure or Stop puts the attachments back. */
    function submit(given, retryNode) {
      if (busy) return false;
      var raw = given != null ? str(given) : str(input.value);
      var t = trim(raw);
      if (attachCfg && countState('adding')) { sayNote(TEXT.stillAdding); return false; }
      var recs = readyRecs();
      if (!t) {
        if (recs.length) sayNote(attachCfg.needWords);
        focusInput();
        return false;
      }
      sayNote('');
      var userNode = retryNode || null;
      if (lastFail) {
        /* Enter on the same text that just failed is the same as its Try again */
        if (!userNode && lastFail.text === t) userNode = lastFail.node;
        if (userNode && userNode === lastFail.node) removeNode(lastFail.bubble);
        lastFail = null;
      }
      if (trim(input.value) === t) { input.value = ''; autosize(); }
      var ctxLabel = ctxSpec ? ctxSpec.label : null;
      takeRecs(recs);
      setBusy(true);
      return waitForHistory().then(function () {
        var node = userNode;
        /* the failed bubble is used again only while it is still the last thing in the conversation */
        if (node && node.parentNode === thread && thread.lastChild === node) {
          unmarkNode(node);
          paintUserExtras(node, recs, ctxLabel);
          toEnd();
        } else node = user(t, { attachments: recs, context: ctxLabel }, true);
        /* the replay is late: whatever of it is still to come goes in above this message */
        if (historyPending && !historyAnchor) historyAnchor = node;
        var run = { text: t, node: node, recs: recs, stopped: false };
        /* Stop says how this message ended at once (ask()), however late the adapter's send then settles */
        var stoppedNow = new Promise(function (r) { run.onStop = function () { r({ stopped: true }); }; });
        current = run;
        var p;
        try { p = opts.send(t, { attachments: recs.slice(), context: ctxLabel }); } catch (e) { p = Promise.reject(e); }
        return Promise.race([stoppedNow, Promise.resolve(p).then(function (v) {
          if (run.stopped) return { stopped: true };
          current = null;
          setBusy(false);
          if (isOpenNow && mayTakeFocus()) focusInput();
          return { ok: true, result: v };
        }, function (err) {
          if (run.stopped) return { stopped: true };
          current = null;
          setBusy(false);
          failed(t, node, err, recs);
          if (isOpenNow && mayTakeFocus()) focusInput();
          return { ok: false, error: err };
        })]);
      });
    }

    /* ---------- attachments ---------- */
    function countState(state) {
      var k = 0;
      for (var i = 0; i < items.length; i++) if (items[i].state === state) k++;
      return k;
    }
    function liveCount() { return countState('adding') + countState('ready'); }
    function readyRecs() {
      var out = [];
      for (var i = 0; i < items.length; i++) if (items[i].state === 'ready' && items[i].rec) out.push(items[i].rec);
      return out;
    }
    function sameRec(a, b) { return a === b || (!!a && !!b && a.id != null && a.id !== '' && a.id === b.id); }
    function itemOf(rec) {
      for (var i = 0; i < items.length; i++) if (items[i].rec && sameRec(items[i].rec, rec)) return items[i];
      return null;
    }
    function isImageRec(rec) { return !!rec && rec.kind !== 'doc' && !!safeSrc(rec.thumb); }

    function makeItem(name) {
      var it = { state: 'adding', name: name || TEXT.aFile, rec: null, error: '' };
      var chip = el('div', 'rvc-achip is-adding');
      chip.setAttribute('role', 'listitem');
      var pic = el('span', 'rvc-achip-pic');
      pic.setAttribute('aria-hidden', 'true');
      var num = el('b', 'rvc-achip-num');
      num.setAttribute('aria-hidden', 'true');
      num.hidden = true;
      var main = el('span', 'rvc-achip-main');
      var nm = el('span', 'rvc-achip-name', it.name);
      nm.setAttribute('title', it.name);
      var st = el('span', 'rvc-achip-state', TEXT.adding);
      main.appendChild(nm);
      main.appendChild(st);
      var rm = button('rvc-achip-rm', '×');
      rm.setAttribute('aria-label', TEXT.removeName(it.name));
      on(rm, 'click', function () { removeItem(it, true); });
      chip.appendChild(pic);
      chip.appendChild(num);
      chip.appendChild(main);
      chip.appendChild(rm);
      it.chip = chip; it.pic = pic; it.num = num; it.nameEl = nm; it.stateEl = st; it.rm = rm;
      paintPic(it);
      return it;
    }
    function paintPic(it) {
      it.pic.textContent = '';
      if (it.state === 'adding') { it.pic.appendChild(el('span', 'rvc-spin')); return; }
      var src = it.rec && it.rec.kind !== 'doc' ? safeSrc(it.rec.thumb) : null;
      if (src) {
        var img = el('img', 'rvc-achip-img');
        img.setAttribute('alt', '');
        img.setAttribute('src', src);
        it.pic.appendChild(img);
        return;
      }
      var ic = el('span', 'rvc-doc-ico');
      ic.innerHTML = ICON_DOC;
      it.pic.appendChild(ic);
    }
    function setItem(it, state, why) {
      it.state = state;
      it.error = why || '';
      it.chip.className = 'rvc-achip is-' + state;
      it.nameEl.textContent = it.name;
      it.nameEl.setAttribute('title', it.name);
      it.rm.setAttribute('aria-label', TEXT.removeName(it.name));
      it.stateEl.textContent = state === 'adding' ? TEXT.adding : state === 'error' ? it.error : '';
      if (state === 'ready') it.stateEl.appendChild(el('span', 'rvc-sr', TEXT.attachedState));
      paintPic(it);
      paintTray();
    }
    /* the tray shows while it holds anything; ready ones are numbered in the order they will be sent */
    function paintTray() {
      var k = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        /* only pictures are numbered: a document is never "attached picture 2" (owner decision 14) */
        var numbered = !!(attachCfg && attachCfg.numbered && it.state === 'ready' && it.rec && it.rec.kind !== 'doc');
        it.num.hidden = !numbered;
        it.num.textContent = numbered ? String(++k) : '';
      }
      tray.hidden = !items.length;
    }
    function putItem(it, atFront) {
      if (atFront) {
        var first = null;
        for (var i = 0; i < items.length; i++) if (items[i].chip.parentNode === chips) { first = items[i].chip; break; }
        items.unshift(it);
        chips.insertBefore(it.chip, first);
      } else {
        items.push(it);
        chips.appendChild(it.chip);
      }
    }
    function removeItem(it, byPerson) {
      var k = items.indexOf(it);
      if (k === -1) return;
      var hadFocus = doc.activeElement === it.rm;
      items.splice(k, 1);
      it.removed = true;
      removeNode(it.chip);
      paintTray();
      if (byPerson) {
        if (it.rec && attachCfg.remove) safe(attachCfg.remove, it.rec);
        announce(TEXT.removedSaid(it.name));
        if (hadFocus) {
          var next = items[k] || items[k - 1];
          focusEl(next ? next.rm : input);
        }
      }
    }
    function addOne(file) {
      var it = makeItem(cleanName(file && file.name));
      putItem(it, false);
      paintTray();
      var p;
      try { p = attachCfg.add(file); } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(function (rec) {
        if (it.removed) { if (rec && attachCfg.remove) safe(attachCfg.remove, rec); return; }
        if (!isObj(rec)) throw new Error('');
        it.rec = rec;
        it.name = cleanName(rec.name) || it.name;
        setItem(it, 'ready');
        announce(TEXT.attachedSaid(it.name));
      }).then(null, function (err) {
        if (it.removed) return;
        var why = trim(err && typeof err === 'object' ? err.message : err) || TEXT.attachFailed;
        setItem(it, 'error', why);
        announce(TEXT.attachFailedSaid(it.name, why));
      });
    }
    /* each file once to the page's add(); past the page's limit, one chip says so */
    function addFiles(list) {
      if (!attachCfg || !list) return;
      var files = [];
      for (var i = 0; i < list.length; i++) if (list[i]) files.push(list[i]);
      if (!files.length) return;
      sayNote('');
      var room = Math.max(0, attachCfg.max - liveCount());
      for (var j = 0; j < files.length && j < room; j++) addOne(files[j]);
      var over = files.slice(room);
      if (over.length) {
        var it = makeItem(over.length === 1 ? cleanName(over[0].name) : TEXT.nFiles(over.length));
        putItem(it, false);
        setItem(it, 'error', TEXT.tooMany(attachCfg.max));
        announce(TEXT.attachFailedSaid(it.name, it.error));
      }
    }
    /* the ready ones leave the tray with the message */
    function takeRecs(recs) {
      for (var i = 0; i < recs.length; i++) { var it = itemOf(recs[i]); if (it) removeItem(it, false); }
    }
    /* after a failure or Stop they come back, first, as far as the tray has room */
    function restoreRecs(recs) {
      if (!attachCfg || !recs || !recs.length) return;
      for (var i = recs.length - 1; i >= 0; i--) {
        var rec = recs[i];
        if (!isObj(rec) || itemOf(rec)) continue;
        if (liveCount() >= attachCfg.max) continue;
        var it = makeItem(cleanName(rec.name));
        it.rec = rec;
        putItem(it, true);
        setItem(it, 'ready');
      }
    }
    function addAttachment(rec) {
      if (!attachCfg || !isObj(rec)) return false;
      if (itemOf(rec)) return true;
      if (liveCount() >= attachCfg.max) return false;
      var it = makeItem(cleanName(rec.name));
      it.rec = rec;
      putItem(it, false);
      setItem(it, 'ready');
      sayNote('');
      return true;
    }
    function clearAttachments() {
      var all = items.slice();
      for (var i = 0; i < all.length; i++) removeItem(all[i], false);
      sayNote('');
    }
    function showDrop(onFlag) {
      if (!drop) return;
      if (!onFlag) dragDepth = 0;
      drop.hidden = !onFlag;
      setClass(panel, 'is-dropping', onFlag);
    }
    function isFileDrag(e) {
      var dt = e && e.dataTransfer;
      var t = dt && dt.types;
      if (!t) return false;
      if (isFn(t.indexOf)) return t.indexOf('Files') !== -1;
      if (isFn(t.contains)) return !!t.contains('Files');
      for (var i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
      return false;
    }
    /* the files on a paste or a drop: the list itself, or the file entries of its items */
    function filesOf(dt) {
      var out = [];
      if (!dt) return out;
      var fl = dt.files;
      if (fl && fl.length) { for (var i = 0; i < fl.length; i++) if (fl[i]) out.push(fl[i]); return out; }
      var its = dt.items;
      if (its && its.length) {
        for (var j = 0; j < its.length; j++) {
          var x = its[j];
          if (x && x.kind === 'file' && isFn(x.getAsFile)) { var f = x.getAsFile(); if (f) out.push(f); }
        }
      }
      return out;
    }

    /* ---------- the context chip ---------- */
    function setContext(spec) {
      var label = isObj(spec) ? trim(spec.label) : '';
      if (!label) { ctxSpec = null; ctxRow.hidden = true; ctxText.textContent = ''; return; }
      ctxSpec = {
        label: label, title: trim(spec.title) || label, onClear: spec.onClear,
        prefix: spec.prefix != null ? str(spec.prefix) : TEXT.selected
      };
      ctxText.textContent = ctxSpec.prefix + label;
      ctxText.setAttribute('title', ctxSpec.title);
      ctxRm.setAttribute('aria-label', TEXT.clearContext(label));
      ctxRow.hidden = false;
    }
    function setScope(s) {
      var v = trim(s);
      scope.textContent = v;
      if (v) scope.setAttribute('title', v); else scope.removeAttribute('title');
      scope.hidden = !v;
    }
    setScope(opts.scope);

    /* ---------- history ---------- */
    /* Normally a new message waits for the replay, so everything is simply drawn in order at the end. Once the
       6 s wait has let a new message go ahead (historyAnchor), whatever of the replay is still to come goes in
       above that message, so it never lands between the new question and its answer. */
    function startHistory() {
      if (!isFn(opts.loadHistory)) return;
      var r;
      try { r = opts.loadHistory(replayWriter); } catch (e) { r = Promise.reject(e); }
      if (!r || !isFn(r.then)) return;
      var loading = el('p', 'rvc-loading', TEXT.loadingHistory);
      loading.setAttribute('aria-hidden', 'true');
      append(loading);
      var p = Promise.resolve(r).then(function () {
        var late = !!historyAnchor;
        removeNode(loading);
        historyAnchor = null;
        historyPending = null;
        /* a late replay went in above; the person's place in the new conversation is kept. On time, the
           conversation opens at its newest turn, with that turn's Undo in view. */
        if (!late) toEnd();
      }, function (err) {
        report(err);
        var note = el('p', 'rvc-loading', TEXT.historyFailed);
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

    /* the "↳ Selected …" line and the attachments (thumbnails, or a document's name) of the person's message */
    function paintUserExtras(turn, recs, ctxLabel) {
      var msg = turn && turn._rvcMsg;
      if (!msg) return;
      removeNode(turn._rvcCtx);
      removeNode(turn._rvcSent);
      turn._rvcCtx = null;
      turn._rvcSent = null;
      var label = trim(ctxLabel);
      if (label) {
        var c = el('div', 'rvc-msg-ctx', TEXT.contextMark + label);
        msg.insertBefore(c, msg.firstChild);
        turn._rvcCtx = c;
      }
      var list = isArray(recs) ? recs : [];
      if (!list.length) return;
      var strip = el('div', 'rvc-sent');
      var numbered = !!(attachCfg && attachCfg.numbered), picNo = 0;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!isObj(r)) continue;
        var name = cleanName(r.name) || TEXT.aFile;
        var item = el('span', 'rvc-sent-item');
        if (numbered && r.kind !== 'doc') {
          var b = el('b', 'rvc-sent-num', String(++picNo));
          b.setAttribute('aria-hidden', 'true');
          item.appendChild(b);
        }
        if (isImageRec(r)) {
          var img = el('img', 'rvc-sent-pic');
          img.setAttribute('src', safeSrc(r.thumb));
          img.setAttribute('alt', name);
          img.setAttribute('title', name);
          item.appendChild(img);
        } else {
          item.classList.add('is-doc');
          var ic = el('span', 'rvc-doc-ico');
          ic.setAttribute('aria-hidden', 'true');
          ic.innerHTML = ICON_DOC;
          item.appendChild(ic);
          item.appendChild(el('span', 'rvc-sent-name', name));
        }
        strip.appendChild(item);
      }
      msg.appendChild(strip);
      turn._rvcSent = strip;
    }

    function user(text, o, force, toReplay) {
      o = o || {};
      var turn = el('div', 'rvc-turn rvc-user');
      var body = el('div', 'rvc-turn-body');
      body.appendChild(metaLine(TEXT.you, o.at));
      var msg = el('div', 'rvc-msg');
      var words = el('span', 'rvc-msg-words', str(text));
      msg.appendChild(words);
      body.appendChild(msg);
      turn.appendChild(body);
      turn._rvcMsg = msg;
      paintUserExtras(turn, o.attachments, o.context);
      place(turn, toReplay, !!force);
      turnDrawn();
      return turn;
    }

    /* An answer's words, with a little structure, built from elements (never markup): a blank line starts a
       new paragraph, lines that start "- ", "• " or "* " are a list, "1. " a numbered one, "# " a heading, and
       **words** are bold. A lone "**" is dropped rather than shown. */
    function inline(parent, s) {
      var parts = str(s).split('**');
      var n2 = parts.length;
      for (var i = 0; i < n2; i++) {
        var part = parts[i];
        if (!part) continue;
        /* an odd piece is between two markers, unless its closing one is missing */
        var bold = i % 2 === 1 && !(n2 % 2 === 0 && i === n2 - 1);
        if (bold) parent.appendChild(el('b', null, part));
        else parent.appendChild(txt(part));
      }
    }
    function formatInto(box, s) {
      var lines = str(s).replace(/\r\n?/g, '\n').split('\n');
      var para = null, list = null, listKind = '';
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\s+$/, '');
        if (!trim(line)) { para = null; list = null; listKind = ''; continue; }
        var mb = /^\s*[-•*]\s+(.*)$/.exec(line);
        var mo = mb ? null : /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line);
        if (mb || mo) {
          var kind = mb ? 'ul' : 'ol';
          para = null;
          if (!list || listKind !== kind) {
            list = el(kind, 'rvc-fl');
            if (mo && Number(mo[1]) > 1) list.setAttribute('start', String(Number(mo[1])));
            box.appendChild(list);
            listKind = kind;
          }
          var li = el('li');
          inline(li, mb ? mb[1] : mo[2]);
          list.appendChild(li);
          continue;
        }
        list = null; listKind = '';
        var mh = /^\s*#{1,6}\s+(.*)$/.exec(line);
        if (mh) {
          para = null;
          var hp = el('p', 'rvc-fh');
          var hb = el('b');
          inline(hb, mh[1]);
          hp.appendChild(hb);
          box.appendChild(hp);
          continue;
        }
        if (!para) { para = el('p', 'rvc-fp'); box.appendChild(para); } else para.appendChild(txt('\n'));
        inline(para, line);
      }
    }
    function renderContent(box, content, plain) {
      if (typeof content === 'number') { box.appendChild(txt(content)); return; }
      if (typeof content === 'string') {
        if (plain) box.appendChild(txt(content)); else formatInto(box, content);
        return;
      }
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
      renderContent(textBox, content, !!o.plain);
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
      turnDrawn();
      /* a replayed turn is not a new reply */
      if (!isOpenNow && !(toReplay && historyPending)) markNew();
      var made = bubble(turn, textBox, extra, foot, !!o.plain);
      /* the newest answer to the message being answered (currentAnswer: where "Save as shortcut" goes) */
      if (current && !toReplay && !o.error) current.answer = made;
      return made;
    }

    /* an adapter's own node as a whole turn: the editor's change card, a picture it made */
    function custom(role, node, o, toReplay) {
      o = o || {};
      if (role === 'user') {
        var turn = el('div', 'rvc-turn rvc-user rvc-custom');
        var body = el('div', 'rvc-turn-body');
        body.appendChild(metaLine(TEXT.you, o.at));
        var box = el('div', 'rvc-custom-body');
        if (node) box.appendChild(node);
        body.appendChild(box);
        turn.appendChild(body);
        place(turn, toReplay, true);
        turnDrawn();
        return turn;
      }
      /* a page's own card (a shortcuts list) is not the answer to the message being answered */
      var had = current ? current.answer || null : null;
      var b = ai('', o, toReplay);
      if (current) current.answer = had;
      b.node.classList.add('rvc-custom');
      if (node) b.slot().appendChild(node);
      return b;
    }

    function divider(label, toReplay) {
      var d = el('div', 'rvc-divider');
      d.appendChild(el('span', null, str(label)));
      return place(d, toReplay);
    }

    /* ---------- what goes inside an answer ---------- */
    function bubble(turn, textBox, extra, foot, plain) {
      function list(spec) {
        spec = spec || {};
        return follow(function () {
          var items2 = isArray(spec.items) ? spec.items : [];
          var card = el('div', 'rvc-card rvc-list');
          var headL = el('div', 'rvc-list-head');
          headL.appendChild(el('span', 'rvc-list-title', str(spec.title)));
          var count = spec.count != null && spec.count !== '' && isFinite(Number(spec.count)) ? Number(spec.count) : null;
          if (count != null) {
            var c = el('span', 'rvc-count');
            var cv = el('span', null, fmtNum(count));
            cv.setAttribute('aria-hidden', 'true');
            c.appendChild(cv);
            c.appendChild(el('span', 'rvc-sr', TEXT.inAll(fmtNum(count))));
            headL.appendChild(c);
          }
          card.appendChild(headL);
          if (items2.length) {
            var ol = el('ol', 'rvc-rows');
            for (var i = 0; i < items2.length; i++) {
              var it = items2[i] || {};
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
            card.appendChild(el('p', 'rvc-list-more', count != null && count > items2.length ?
              TEXT.showingOf(fmtNum(items2.length), fmtNum(count)) : TEXT.showingFirst(fmtNum(items2.length))));
          }
          extra.appendChild(card);
          return card;
        }, turn);
      }
      function note(text) {
        return follow(function () { var p = el('p', 'rvc-note', str(text)); extra.appendChild(p); return p; }, turn);
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
        }, turn);
      }
      function btn(label, onClick, o) {
        return follow(function () {
          var b = button('rvc-btn' + (o && o.primary ? ' rvc-btn-primary' : ''), str(label));
          on(b, 'click', function (e) { if (!isLocked(b)) safe(onClick, e); });
          foot.appendChild(b);
          return b;
        }, turn);
      }
      function undo(onUndo) {
        return follow(function () {
          var b = button('rvc-btn rvc-undo', TEXT.undo);
          if (isFn(onUndo)) bindUndo(onUndo, b); else lockBtn(b);
          on(b, 'click', function () { if (!isLocked(b)) runUndo(entryOfEl(b)); });
          foot.appendChild(b);
          return b;
        }, turn);
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
          name = name || TEXT.thePage;
          var card = el('div', 'rvc-card rvc-countdown');
          var line = el('p', 'rvc-cd-text');
          line.setAttribute('aria-hidden', 'true');
          line.appendChild(txt(TEXT.openingWord));
          line.appendChild(el('strong', null, name));
          line.appendChild(txt('…'));
          var bar = el('div', 'rvc-cd-bar');
          bar.setAttribute('aria-hidden', 'true');
          var fill = el('i');
          fill.style.animationDuration = wait + 'ms';
          bar.appendChild(fill);
          var stay = button('rvc-btn rvc-stay', TEXT.stayHere);
          var said = el('span', 'rvc-sr', TEXT.openingSaid(name));
          card.appendChild(line);
          card.appendChild(bar);
          card.appendChild(stay);
          card.appendChild(said);
          extra.appendChild(card);
          var state = 'run';
          var handle;
          function dropRun() { var k = running.indexOf(handle); if (k !== -1) running.splice(k, 1); }
          var timer = root.setTimeout(function () {
            if (state !== 'run') return;
            state = 'done';
            leaves.went++;
            dropRun();
            lockBtn(stay);
            card.classList.add('is-done');
            if (peekCd === handle) lockBtn(pStay);
            safe(onDone);
          }, wait);
          function cancel(o2) {
            if (state !== 'run') return false;
            state = 'cancelled';
            leaves.stayed++;
            root.clearTimeout(timer);
            dropRun();
            var hadFocus = doc.activeElement === stay;
            var words = trim(o2 && o2.text) || TEXT.stayed;
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
          /* The panel is shut (closed, or folded after a change), so this card is out of sight: the bar says
             what is about to open and offers Stay here. Only one page can be on its way at a time. */
          if (!isOpenNow) {
            var others = running.slice(0, running.length - 1);
            for (var r0 = 0; r0 < others.length; r0++) others[r0].cancel();
            peekCountdown(handle, name);
          }
          return handle;
        }, turn);
      }
      function choices(list2) {
        return follow(function () {
          var g = el('div', 'rvc-choices');
          g.setAttribute('role', 'group');
          g.setAttribute('aria-label', TEXT.chooseOne);
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
                b.appendChild(el('span', 'rvc-sr', TEXT.chosen));
                for (var k = 0; k < btns.length; k++) lockBtn(btns[k]);
              });
              btns.push(b);
              g.appendChild(b);
            })(arr[i]);
          }
          extra.appendChild(g);
          return g;
        }, turn);
      }
      /* an empty place in the answer for the adapter's own nodes, in the order asked for */
      function slot() {
        return follow(function () { var s = el('div', 'rvc-slot'); extra.appendChild(s); return s; }, turn);
      }
      function text(content) {
        return follow(function () { textBox.textContent = ''; renderContent(textBox, content, plain); return textBox; }, turn);
      }
      return { node: turn, list: list, note: note, link: link, button: btn, undo: undo, countdown: countdown, choices: choices, slot: slot, text: text };
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
    on(stopBtn, 'click', function () { doStop(); });
    on(input, 'keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submit();
    });
    on(input, 'input', function () { autosize(); if (!noteEl.hidden) sayNote(''); });
    on(ctxRm, 'click', function () {
      var s = ctxSpec;
      setContext(null);
      if (s) safe(s.onClear);
      focusInput();
    });
    if (attachCfg) {
      on(attachBtn, 'click', function () { try { fileInput.click(); } catch (e) { report(e); } });
      on(fileInput, 'change', function () {
        var files = filesOf({ files: fileInput.files });
        try { fileInput.value = ''; } catch (e) { /* some browsers keep it read-only */ }
        addFiles(files);
      });
      on(input, 'paste', function (e) {
        var files = filesOf(e && e.clipboardData);
        if (!files.length) return;          /* words are pasted as words */
        e.preventDefault();
        addFiles(files);
      });
      on(panel, 'dragenter', function (e) { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; showDrop(true); });
      on(panel, 'dragover', function (e) {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'copy'; } catch (x) { /* read-only in some browsers */ }
      });
      on(panel, 'dragleave', function (e) { if (!isFileDrag(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) showDrop(false); });
      on(panel, 'drop', function (e) {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        showDrop(false);
        addFiles(filesOf(e.dataTransfer));
      });
    }
    on(pUndo, 'click', function () { if (!isLocked(pUndo)) runUndo(entryOfEl(pUndo)); });
    on(pBack, 'click', function () { open(); });
    on(pStay, 'click', function () { if (!isLocked(pStay) && peekCd) peekCd.cancel(); });
    /* the full phone sheet is modal: Tab goes round inside it */
    function tabStops() {
      var out = [];
      (function walk(nd) {
        var kids = nd.childNodes || [];
        for (var i = 0; i < kids.length; i++) {
          var c = kids[i];
          if (!c || c.nodeType !== 1 || c.hidden) continue;
          var tag = c.localName;
          var ti = c.getAttribute('tabindex');
          if ((tag === 'button' && !c.disabled) || tag === 'textarea' || (tag === 'a' && c.getAttribute('href') != null) || ti === '0') {
            if (ti !== '-1') out.push(c);
          }
          walk(c);
        }
      })(panel);
      return out;
    }
    on(panel, 'keydown', function (e) {
      if (e.key !== 'Tab' || !isPhone() || half) return;
      var stops = tabStops();
      if (!stops.length) return;
      var first = stops[0];
      var last = stops[stops.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); focusEl(last); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); focusEl(first); }
    });
    /* Keys pressed inside the chat are the chat's: Escape is handled here (Stay here while a page is about to
       open, else close), and no key goes on to the page, whose shortcuts would otherwise act on it. */
    function ownKeys(e) {
      if (e && e.type === 'keydown' && (e.key === 'Escape' || e.key === 'Esc')) {
        var t = e.target;
        if (running.length) { running[running.length - 1].cancel(); e.preventDefault(); }
        else if (drop && !drop.hidden) { showDrop(false); e.preventDefault(); }
        else if (isOpenNow && t && panel.contains(t)) { e.preventDefault(); close(true); }
        else if (folded && t && peek.contains(t)) { e.preventDefault(); close(true); }
      }
      if (e && isFn(e.stopPropagation)) e.stopPropagation();
    }
    on(wrap, 'keydown', ownKeys);
    on(wrap, 'keyup', ownKeys);
    on(wrap, 'keypress', ownKeys);
    /* while a page is about to open, Esc anywhere on the page is Stay here */
    function onDocKey(e) {
      if (!e || (e.key !== 'Escape' && e.key !== 'Esc')) return;
      if (running.length) { running[running.length - 1].cancel(); e.preventDefault(); }
    }

    /* what loadHistory draws with: always in the replay's place */
    var replayWriter = {
      divider: function (label) { return divider(label, true); },
      user: function (text, o) { return user(text, o, false, true); },
      ai: function (content, o) { return ai(content, o, true); },
      custom: function (role, node, o) { return custom(role, node, o, true); }
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
      fold: function (label, onUndo) { fold(label, onUndo); },
      unfold: unfold,
      user: function (text, o) { return user(text, o, false, pastTurn(o)); },
      ai: function (content, o) { return ai(content, o, pastTurn(o)); },
      custom: function (role, node, o) { return custom(role, node, o, pastTurn(o)); },
      markUndone: markUndone,
      setScope: setScope,
      setContext: setContext,
      addAttachment: addAttachment,
      attachments: readyRecs,
      clearAttachments: clearAttachments,
      thread: function () { return thread; },
      reveal: reveal,
      setDock: function (v) { dockOn = !!v && !!dockOpt; syncDock(); },
      isDocked: function () { return docked; },
      setPhoneSheet: function (kind) { half = kind === 'half'; syncMode(); },
      setQuickIdeas: function (list) { quickIdeas = cleanIdeas(list); drawQuick(); },
      setChips: function (spec) { chipSpec = isObj(spec) ? spec : null; drawChips(); },
      ask: function (text) {
        if (busy) return Promise.resolve({ busy: true });
        if (!isOpenNow) open();
        var r = submit(str(text));
        return r && isFn(r.then) ? r : Promise.resolve({ ok: false, error: null, nothing: true });
      },
      currentAnswer: function () { return current && current.answer ? current.answer : null; },
      isLeaving: function () { return running.length > 0; },
      isBusy: function () { return busy; },
      leaveCount: function () { return { went: leaves.went, stayed: leaves.stayed }; },
      undoBind: function (b, fn) {
        if (!b || !isFn(fn)) return b;
        bindUndo(fn, b);
        on(b, 'click', function () { if (!isLocked(b)) runUndo(entryOfEl(b)); });
        return b;
      },
      undoRun: function (fn) { return isFn(fn) ? runUndo(entryFor(fn)) : Promise.resolve(false); },
      undoState: function (fn) {
        if (!isFn(fn)) return 'none';
        for (var i = 0; i < undoSets.length; i++) {
          if (undoSets[i].fn === fn) return undoSets[i].done ? 'done' : undoSets[i].pending ? 'pending' : 'ready';
        }
        return 'none';
      },
      setWelcome: setWelcome,
      relayout: relayout,
      lift: function () { return liftNow; }
    };

    /* everything is built before anything touches the page, so a failure leaves the page as it was */
    host.appendChild(wrap);
    try {
      doc.addEventListener('keydown', onDocKey);
      if (isFn(root.matchMedia)) {
        mq = root.matchMedia(phoneQuery);
        var onMq = function () { syncMode(); scheduleLift(); };
        if (mq && isFn(mq.addEventListener)) mq.addEventListener('change', onMq);
        else if (mq && isFn(mq.addListener)) mq.addListener(onMq);
        if (dockOpt) {
          dockMq = root.matchMedia('(min-width: ' + dockMin + 'px)');
          if (dockMq && isFn(dockMq.addEventListener)) dockMq.addEventListener('change', syncDock);
          else if (dockMq && isFn(dockMq.addListener)) dockMq.addListener(syncDock);
        }
      }
      var vv = root.visualViewport;
      if (vv && isFn(vv.addEventListener)) {
        vv.addEventListener('resize', function () { syncViewport(); scheduleLift(); });
        vv.addEventListener('scroll', function () { syncViewport(); scheduleLift(); });
      }
      if (keepSel) {
        if (isFn(root.addEventListener)) {
          root.addEventListener('scroll', scheduleLift, { capture: true, passive: true });
          root.addEventListener('resize', scheduleLift);
        }
        /* a bar that appears, hides or moves (a class, hidden, a style, a node added) is measured again; the
           kit's own changes are not the page's */
        if (isFn(root.MutationObserver) && doc.body) {
          var mo = new root.MutationObserver(function (list) {
            for (var i = 0; i < list.length; i++) {
              var t = list[i] && list[i].target;
              if (!t || !wrap.contains(t)) { afterPageChange(); return; }
            }
          });
          mo.observe(doc.body, { attributes: true, attributeFilter: ['class', 'hidden', 'style'], childList: true, subtree: true });
        }
        /* the end of a slide or a fade anywhere on the page (in the capture phase, so a page that stops it on
           the way up cannot hide it) */
        if (isFn(doc.addEventListener)) {
          for (var me = 0; me < MOTION_ENDS.length; me++) doc.addEventListener(MOTION_ENDS[me], onMotionEnd, true);
        }
      }
      syncMode();
      if (doc.documentElement && doc.documentElement.classList) doc.documentElement.classList.add('rvc-ready');
    } catch (e) {
      removeNode(wrap);
      try {
        doc.removeEventListener('keydown', onDocKey);
        for (var mx = 0; mx < MOTION_ENDS.length; mx++) doc.removeEventListener(MOTION_ENDS[mx], onMotionEnd, true);
      } catch (x) { /* nothing to undo */ }
      throw e;
    }
    scheduleLift();
    if (opts.startOpen) open();
    return chat;
  }

  var api = { mount: mount };
  root.RevampChat = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
