/* editor-chat-client.js — ETB2B AI in the site editor (custom_editor.html): the editor's place in the one ETB2B AI
   panel every console page has (etb2b-assistant.js, on the chat kit etb2b-chat.js).

   The shell routes each message (RevampAssistant.route): questions about the event, opening pages, promotions and
   new events go to the events side (the "dash" brain, dash-bot-client.js); anything about this page comes here, to
   the "edit" brain, which is the editor's own ETB2B AI (RevampTemplateUI.chat in editor-template-ui.js: POST
   /api/chat-edit, new pictures, do it then undo, with a checkpoint per change). This file joins the two:
     - the edit brain: a message sent, Stop, "undo that" with no AI call, the event's conversation read back;
     - the place: the welcome, suggestions and quick ideas for a site page; the "Selected" chip (what is selected
       on the page goes with the message); pictures attached the editor's own way, numbered as the AI is told
       them; the panel docked as a column beside the canvas in "Edit myself", a half sheet on a narrow "Edit with
       AI"; leaving the editor only through its own guard for unsaved work (RevampTemplateUI.leave);
     - the view editor-template-ui.js draws into: an answer with the change's card in it, the busy strip with
       Stop, the tray, "Show", "Open Content › Speakers";
     - after a change in "Edit with AI" (UX-094): the live view brought to the changed section and outlined
       (RevampEditorMode.show), and, when the open panel would hide it, the panel folded into its bar ("Changed
       “Hero” · Undo · Back to chat"), unless the person is typing in it;
     - pictures given to ETB2B AI on another page of this event (RevampAssistant.takeCarry): uploaded the editor's
       own way into the tray, the words put in the box, nothing sent.

   window.RevampEditorChat (and module.exports, for functions/lib/editor-chat-client.test.js)
     start()                    called at load: waits for the editor's site, then registers the brain and the place
     TEXT                       every sentence this file says
     goToFor(target, words)     the Content tab (or Forms) an answer points to: the server's goTo, else its words
     contentUrl(eventId, target), focusLabel(focus), isPicture(file), wouldCover(a, b), recFor(url, name, size)

   ES5 on purpose (var, function, promises), as every Oneworld-authored browser file: the editor serves it as it
   is, with no build step. */
(function (root) {
  'use strict';

  /* Every sentence a person reads from this file. The product name stays "Oneworld 2.0" / "ETB2B AI" until the
     rename batch, which changes this one table. */
  var TEXT = {
    welcome: function (eventName) {
      return 'I change this page when you ask, make new pictures for it, answer questions about ' + (eventName || 'this event') +
        ' and open its other pages. Every change has an Undo, and nothing goes live until you publish.';
    },
    /* they only start the message (UX-095): each is cheap and safe on any site page */
    suggestions: [
      { label: 'What can you change on this page?', text: 'What can you change on this page?' },
      { label: 'Shorten the overview to two sentences', text: 'Shorten the overview to two sentences' },
      { label: 'Rewrite the hero tagline to sound more premium', text: 'Rewrite the hero tagline to sound more premium' },
      { label: 'How many registrations does this event have?', text: 'How many registrations does this event have?' }
    ],
    quickIdeas: [
      { label: 'Shorten the overview', text: 'Shorten the overview to two sentences' },
      { label: 'A new hero picture', text: 'Make a new hero picture of …' }
    ],
    attachLabel: 'Attach a picture',
    attachHint: 'Pictures go on this page where you say, for example “use this as the hero background”.',
    needWords: 'Say what the picture is for, for example “use this as the hero background”.',
    notPicture: 'In the editor I can use pictures. A brief is read by Create Event’s Generate from a brief.',
    focusTitle: 'ETB2B AI will take your message to be about this, unless you name another part of the page',
    focusPicture: 'picture',
    undone: 'Undone. The page is back to how it was before my last change.',
    changed: function (name) { return 'Changed “' + name + '”'; },
    checking: 'Checking your events…',
    carried: function (n) {
      if (!n) return '';
      return n === 1 ? 'The picture you gave me is in the tray. Say where it goes and send.'
        : 'The ' + n + ' pictures you gave me are in the tray. Say where they go and send.';
    },
    carriedShort: function (got, of) {
      var missing = of - got;
      return missing === 1 ? '1 picture could not be brought over: attach it again with the paper clip.'
        : missing + ' pictures could not be brought over: attach them again with the paper clip.';
    },
    goTo: {
      'content:speakers': 'Open Content › Speakers', 'content:agenda': 'Open Content › Agenda', 'content:sponsors': 'Open Content › Sponsors',
      'content:faq': 'Open Content › FAQ', 'content:contact': 'Open Content › Contact', forms: 'Open Forms'
    },
    goToTitle: 'Your work in the editor is kept first',
    noAnswer: 'ETB2B AI didn’t answer. Your page is unchanged. Try again.'
  };

  var PICTURE_TYPES = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1, 'image/svg+xml': 1 };
  var PICTURE_EXT = /\.(?:png|jpe?g|webp|gif|svg)$/i;
  var ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg';
  var MAX_PICTURES = 6;               // as the editor's tray always took, and /api/chat-edit numbers them
  var DOCK_MIN_WIDTH = 1100;          // narrower, a 400 px column would squeeze the canvas: the panel floats there
  var PHONE_QUERY = '(max-width: 720px)';   // the editor's narrow "Edit with AI" (the page has no viewport meta)
  var HISTORY_WAIT_MS = 6000;         // the carried pictures' note waits this long, at most, for the replay
  var GOTO = { 'content:speakers': 1, 'content:agenda': 1, 'content:sponsors': 1, 'content:faq': 1, 'content:contact': 1, forms: 1 };
  /* where an answer's own words point (UX-098), read only when it says something is entered under Content */
  var CONTENT_SAID = /\b(?:under|in|on|from)\s+(?:the\s+)?Content\b|\bContent\s*(?:›|>|tab)/i;
  var CONTENT_WORDS = [
    ['content:speakers', /\bspeakers?\b/i],
    ['content:agenda', /\b(?:agenda|sessions?|schedule)\b/i],
    ['content:sponsors', /\b(?:sponsors?|partners?)\b/i],
    ['content:faq', /\b(?:faqs?|frequently asked)\b/i],
    ['content:contact', /\bcontacts?\b/i]
  ];

  function str(v) { return v == null ? '' : String(v); }
  function isFn(f) { return typeof f === 'function'; }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function warn(msg) { try { if (root.console && root.console.warn) root.console.warn('[ETB2B AI] ' + msg); } catch (e) { /* nothing to do */ } }
  function clip(s, n) { s = str(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function doc() { return root.document || null; }

  /* ---------------------------------------------------------------- pure parts (tested) */
  /* the Content tab (or the Forms panel) an answer points to: the server's goTo when it names one, else, when the
     answer says something is entered under Content, the first kind of record it names; '' for none */
  function goToFor(target, words) {
    var t = str(target);
    if (Object.prototype.hasOwnProperty.call(GOTO, t)) return t;
    if (t) return '';
    var w = str(words);
    if (!CONTENT_SAID.test(w)) return '';
    var best = '', at = -1;
    for (var i = 0; i < CONTENT_WORDS.length; i++) {
      var m = CONTENT_WORDS[i][1].exec(w);
      if (m && (at === -1 || m.index < at)) { at = m.index; best = CONTENT_WORDS[i][0]; }
    }
    return best;
  }
  /* the console's tab for it, an address the dash brain may open too (dash-bot-client.js NAV_OK) */
  function contentUrl(eventId, target) {
    var id = str(eventId), tab = /^content:([a-z]+)$/.exec(str(target));
    if (!tab || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) return '';
    return '/edit-event.html?event=' + id + '#content/' + tab[1];
  }
  /* what the "Selected" chip says: the section, and the text (or picture) selected in it */
  function focusLabel(f) {
    if (!f || !f.name) return '';
    var label = str(f.name);
    if (f.element) label += f.element.text ? ' · “' + clip(f.element.text, 48) + '”' : ' · ' + TEXT.focusPicture;
    return label;
  }
  function isPicture(file) {
    if (!file) return false;
    var type = str(file.type).toLowerCase();
    if (type) return Object.prototype.hasOwnProperty.call(PICTURE_TYPES, type);
    return PICTURE_EXT.test(str(file.name));
  }
  /* two boxes ({left, top, right, bottom}) share some area */
  function wouldCover(a, b) {
    if (!a || !b) return false;
    return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
  }
  /* a picture stored with the event, as a chip in the tray: its address is what a message sends */
  function recFor(url, name, size) {
    return { id: str(url), url: str(url), name: str(name) || 'Picture', kind: 'image', thumb: str(url), size: +size || 0 };
  }
  function urlOf(rec) { return rec && typeof rec === 'object' ? str(rec.url || rec.id) : ''; }

  /* ---------------------------------------------------------------- the editor around it */
  function ui() { var U = root.RevampTemplateUI; return U && U.chat && isFn(U.chat.send) ? U : null; }
  function assistant() { var A = root.RevampAssistant; return A && isFn(A.registerBrain) && isFn(A.registerPlace) ? A : null; }
  function modes() { var M = root.RevampEditorMode; return M && isFn(M.mode) ? M : null; }
  function isAiMode() { var M = modes(); return !!M && M.mode() === 'ai'; }
  function eventIdHere() { var A = assistant(); try { return A && isFn(A.place) ? str(A.place().eventId) : ''; } catch (e) { return ''; } }
  /* the docked column starts where the editor's workspace does: under the top bar, and under the "generated from a
     brief" strip while it shows (its × must stay in sight) */
  function workspaceTop() {
    var d = doc(), ws = d && isFn(d.querySelector) ? d.querySelector('.ed-workspace') : null;
    var r = null;
    try { r = ws && isFn(ws.getBoundingClientRect) ? ws.getBoundingClientRect() : null; } catch (e) { r = null; }
    return r ? Math.max(0, Math.round(r.top)) : 56;
  }
  /* the canvas measures the room it has on a resize: it is told when the docked column comes or goes */
  function refit() {
    try {
      var ev;
      if (isFn(root.Event)) ev = new root.Event('resize');
      else { ev = doc().createEvent('Event'); ev.initEvent('resize', false, false); }
      root.dispatchEvent(ev);
    } catch (e) { /* the canvas fits itself on the next resize */ }
  }

  var chatRef = null, started = false, historyLoad = null;

  function wrapOf(chat) {
    var th = chat && isFn(chat.thread) ? chat.thread() : null;
    return th && isFn(th.closest) ? th.closest('.rvc') : null;
  }
  function panelRect(chat) {
    var th = chat && isFn(chat.thread) ? chat.thread() : null;
    var panel = th && isFn(th.closest) ? th.closest('.rvc-panel') || th : th;
    try { return panel && isFn(panel.getBoundingClientRect) ? panel.getBoundingClientRect() : null; } catch (e) { return null; }
  }
  /* someone writing in the panel keeps it open: a fold would take their words out of sight */
  function typingInPanel() {
    var d = doc(), a = d && d.activeElement;
    return !!(a && a.tagName === 'TEXTAREA' && isFn(a.closest) && a.closest('.rvc') && str(a.value).replace(/\s+/g, ''));
  }
  /* the message box's words, unsent (the carried pictures' words) */
  function setDraft(chat, text) {
    if (!chat || !text) return;
    if (isFn(chat.setDraft)) { chat.setDraft(text); return; }
    var w = wrapOf(chat), box = w && isFn(w.querySelector) ? w.querySelector('textarea') : null;
    if (!box) return;
    box.value = text;
    try {
      var ev;
      if (isFn(root.Event)) ev = new root.Event('input', { bubbles: true });
      else { ev = doc().createEvent('Event'); ev.initEvent('input', true, false); }
      box.dispatchEvent(ev);
    } catch (e) { /* the box keeps its height until typed in */ }
  }

  /* ---------------------------------------------------------------- the view editor-template-ui.js draws into */
  /* An answer's element for the editor's own nodes (its pictures, its card): a holder of this file's in the kit's
     slot, so the card the editor puts after it (beside, in the holder) stays in the same answer. */
  function holderIn(bubble) {
    var d = doc();
    var slot = bubble && isFn(bubble.slot) ? bubble.slot() : null;
    var holder = d.createElement('div'), inner = d.createElement('div');
    holder.className = 'rvc-ed-answer';
    inner.className = 'rvc-ed-body';
    holder.appendChild(inner);
    (slot || d.createElement('div')).appendChild(holder);
    return inner;
  }
  function makeView(chat) {
    var U = ui();
    return {
      ai: function (text, o) {
        o = o || {};
        var opts = { error: !!o.error };
        if (o.at) opts.at = o.at;
        return holderIn(chat.ai(str(text), opts));
      },
      /* a message read back (a new one is drawn by the panel itself) */
      user: function (text, o) {
        o = o || {};
        var opts = { context: str(o.context) || null };
        if (o.at) opts.at = o.at;
        var node = chat.user(str(text), opts);
        if (node && o.picturesText) {
          var msg = isFn(node.querySelector) ? node.querySelector('.rvc-msg') || node : node;
          var p = doc().createElement('span');
          p.className = 'rvc-ed-pics';
          p.textContent = o.picturesText;
          msg.appendChild(p);
        }
        return node;
      },
      divider: function (label) { chat.divider(label); },
      thread: function () { return isFn(chat.thread) ? chat.thread() : null; },
      /* while ETB2B AI works the box is locked and Stop is offered; ready frees it */
      status: function (state, text) {
        if (state === 'ready') { chat.setBusy(false); return; }
        chat.setBusy(true, str(text), { onStop: function () { if (U) U.chat.stop(); } });
      },
      addAttachment: function (url, name) { return isFn(chat.addAttachment) ? chat.addAttachment(recFor(url, name, 0)) === true : false; },
      focusInput: function () { chat.focusInput(); },
      reveal: function (node) { if (isFn(chat.reveal)) chat.reveal(node); },
      markUndone: function (fn) { chat.markUndone(fn); },
      /* "Show" on a step: in "Edit with AI" the live view goes to it and outlines it; else the canvas does */
      show: function (key) {
        var M = modes();
        if (!M || M.mode() !== 'ai' || !isFn(M.show)) return false;
        M.show(key);
        return true;
      },
      goTo: function (host, target, words) { drawGoTo(host, target, words); }
    };
  }
  /* "Open Content › Speakers" (UX-098): the editor's work is recorded first, and the editor is left through its
     own guard for unsaved work; "Open Forms" opens the Forms panel, beside the canvas */
  function drawGoTo(host, target, words) {
    var U = ui(), d = doc();
    var to = goToFor(target, words);
    if (!to || !host || !U || !d) return null;
    var url = to === 'forms' ? '' : contentUrl(eventIdHere(), to);
    if (to !== 'forms' && !url) return null;
    var b = d.createElement('button');
    b.type = 'button';
    b.className = 'rvc-btn rvc-ed-goto';
    b.textContent = TEXT.goTo[to];
    b.title = TEXT.goToTitle;
    b.addEventListener('click', function () {
      if (to === 'forms') { openForms(); return; }
      if (isFn(U.flush)) U.flush();
      if (isFn(U.leave)) U.leave(url);
    });
    host.appendChild(b);
    return b;
  }
  function openForms() {
    var M = modes(), d = doc();
    if (M && M.mode() === 'ai' && isFn(M.setMode)) M.setMode('manual');
    var btn = d && isFn(d.querySelector) ? d.querySelector('.rail-btn[data-panel="forms"]') : null;
    if (btn && isFn(btn.click)) btn.click();
  }

  /* ---------------------------------------------------------------- after a change (UX-094) */
  /* In "Edit with AI": the live view is brought to the changed section and outlines it; what is waited for is that
     (the card says Done once the change shows). Then, when the open panel lies over that section, it folds into its
     bar with this change's Undo, unless the person is typing in it. "Edit myself" docks the panel beside the canvas,
     so nothing is covered there. */
  function afterChange(ch) {
    var M = modes();
    if (!ch || !ch.key || !M || M.mode() !== 'ai' || !isFn(M.show)) return null;
    return Promise.resolve(M.show(ch.key)).then(function (shown) {
      var chat = chatRef;
      if (!shown || !chat || !chat.isOpen() || typingInPanel()) return;
      var sec = isFn(M.sectionRect) ? M.sectionRect(ch.key) : null;
      if (wouldCover(sec, panelRect(chat))) chat.fold(TEXT.changed(ch.name || ch.key), ch.peekFn);
    });
  }

  /* ---------------------------------------------------------------- the panel's shape for the editor's mode */
  function syncMode() {
    var chat = chatRef;
    if (!chat) return;
    var ai = isAiMode();
    // Edit myself: a column beside the canvas (at 1100 px and wider, the kit's rule); Edit with AI: floating
    if (isFn(chat.setDock)) chat.setDock(!ai);
    if (isFn(chat.setPhoneSheet)) chat.setPhoneSheet(ai ? 'half' : 'full');
    syncDockTop();
    refit();
  }
  function syncDockTop() {
    var w = wrapOf(chatRef);
    if (w && w.style && isFn(w.style.setProperty)) w.style.setProperty('--rvc-dock-top', workspaceTop() + 'px');
  }
  function onOpenChange(open) {
    var M = modes();
    if (M && isFn(M.setChatOpen)) M.setChatOpen(!!open);
    syncDockTop();
    // the docked column came or went: the canvas fits the room beside it (as the old column's setOpen did)
    if (!isAiMode()) refit();
  }

  /* ---------------------------------------------------------------- pictures given on another page of the event */
  function carryIn() {
    var A = assistant(), U = ui(), chat = chatRef, id = eventIdHere();
    if (!A || !U || !chat || !id || !isFn(A.takeCarry)) return;
    Promise.resolve(A.takeCarry(id)).then(function (got) {
      if (!got || typeof got !== 'object') return;
      var files = isArr(got.files) ? got.files : [];
      if (!files.length && !got.text) return;
      chat.open();
      var added = 0;
      return files.reduce(function (p, file) {
        return p.then(function () {
          return attachAdd(file).then(function (rec) { if (chat.addAttachment(rec) === true) added++; }, function (err) {
            chat.ai(str(err && err.message) || TEXT.notPicture, { error: true });
          });
        });
      }, Promise.resolve()).then(function () {
        setDraft(chat, str(got.text));
        // said after the earlier conversation is in, so it is the newest thing in the panel
        return waitHistory().then(function () {
          var said = TEXT.carried(added);
          var expected = Math.max(+got.expected || 0, files.length);
          if (expected > added) said = (said ? said + ' ' : '') + TEXT.carriedShort(added, expected);
          if (said) chat.ai(said);
          chat.focusInput();
        });
      });
    }).then(null, function (err) { warn('the pictures from another page could not be put in the tray: ' + (err && err.message)); });
  }
  function waitHistory() {
    if (!historyLoad) return Promise.resolve();
    return new Promise(function (done) {
      var t = root.setTimeout(done, HISTORY_WAIT_MS);
      historyLoad.then(function () { root.clearTimeout(t); done(); }, function () { root.clearTimeout(t); done(); });
    });
  }

  /* ---------------------------------------------------------------- the edit brain */
  /* a picture into the tray: checked here first (the file dialog asks for pictures, a drop or a paste may bring
     anything), then stored the editor's own way, which checks it again */
  function attachAdd(file) {
    var U = ui();
    if (!isPicture(file)) return Promise.reject(new Error(TEXT.notPicture));
    if (!U || !isFn(U.chat.upload)) return Promise.reject(new Error(TEXT.noAnswer));
    return U.chat.upload(file).then(function (p) { return recFor(p.url, p.name || (file && file.name), file && file.size); });
  }
  /* the sentence for a message with no usable answer: the shell's one table (errorFor), the editor's words */
  function wordError(err) {
    if (err && err.local) return err;
    var A = assistant(), out = null;
    try {
      if (A && isFn(A.errorFor)) {
        out = err && err.status ? A.errorFor({ status: err.status, body: err.body || null }, A.place())
          : A.errorFor({ network: (err && err.network) || err || {} }, A.place());
      }
    } catch (e) { out = null; }
    return out instanceof Error ? out : new Error(TEXT.noAnswer);
  }
  var brain = {
    send: function (text, o) {
      var U = ui();
      o = o || {};
      if (!U) return Promise.reject(new Error(TEXT.noAnswer));
      var urls = [];
      (isArr(o.attachments) ? o.attachments : []).forEach(function (r) { var u = urlOf(r); if (u && urls.length < MAX_PICTURES) urls.push(u); });
      var sendOpts = { attachments: urls };
      if (o.handedFrom === 'dash') sendOpts.handedFrom = 'dash';
      return U.chat.send(text, sendOpts).then(function (r) {
        // not about this page: the shell hands it to the events side, once
        if (r && r.kind === 'handoff' && !sendOpts.handedFrom && chatRef) {
          var A = assistant();
          chatRef.setBusy(true, TEXT.checking, { onStop: function () { if (A && isFn(A.stop)) A.stop(); } });
        }
        return r;
      }, function (err) { throw wordError(err); });
    },
    stop: function () { var U = ui(); if (U) U.chat.stop(); },
    /* "undo that": the newest change of ETB2B AI on the page, without asking the AI */
    undoLocal: function () {
      var U = ui();
      if (!U) return Promise.reject(new Error(TEXT.noAnswer));
      return U.chat.undoLast().then(function (r) {
        if (chatRef) chatRef.ai(r && r.ok ? TEXT.undone : str(r && r.why) || TEXT.noAnswer);
        return r;
      });
    },
    /* the event's conversation, both brains' turns in order: the editor's own come back with their Undo */
    loadHistory: function (w) {
      var U = ui();
      if (!U) return null;
      historyLoad = Promise.resolve(U.chat.loadHistory(w)).then(function (got) {
        if (got && got.event && w && isFn(w.event)) w.event(got.event);
        return got;
      });
      return historyLoad;
    },
    replay: function (t) {
      var U = ui();
      if (!U || !t || t.brain === 'dash') return false;
      return U.chat.replayTurn(t);
    }
  };

  /* ---------------------------------------------------------------- the place */
  function placeAdapter() {
    var U = ui();
    return {
      welcome: function () { return { text: TEXT.welcome(U.chat.eventName()) }; },
      suggestions: TEXT.suggestions,
      quickIdeas: TEXT.quickIdeas,
      attach: { accept: ACCEPT, max: MAX_PICTURES, numbered: true, label: TEXT.attachLabel, hint: TEXT.attachHint, needWords: TEXT.needWords, add: attachAdd },
      context: {
        current: function () { var f = U.chat.focus(); var l = focusLabel(f); return l ? { label: l, title: TEXT.focusTitle } : null; },
        onChange: function (fn) { U.chat.onFocusChange(fn); },
        clear: function () { U.chat.clearFocus(); }
      },
      dock: { minWidth: DOCK_MIN_WIDTH, top: workspaceTop() },
      phoneSheet: isAiMode() ? 'half' : 'full',
      phoneQuery: PHONE_QUERY,
      // a click in the panel keeps the selected section, the message's reference (as the old column did)
      wrapAttrs: { 'data-keep-selection': '' },
      leave: function (url) { U.leave(url); },
      onMount: onMount
    };
  }
  function onMount(chat) {
    var U = ui(), A = assistant(), M = modes();
    chatRef = chat;
    U.chat.attachView(makeView(chat));
    U.chat.onAiChange(afterChange);
    if (A && isFn(A.onOpenChange)) A.onOpenChange(onOpenChange);
    if (M && isFn(M.onModeChange)) M.onModeChange(syncMode);
    root.addEventListener('resize', syncDockTop);
    // the "generated from a brief" strip comes and goes above the workspace: the docked column follows
    var d = doc(), shell = d && isFn(d.querySelector) ? d.querySelector('.ed') : null;
    if (shell && isFn(root.MutationObserver)) new root.MutationObserver(syncDockTop).observe(shell, { childList: true });
    syncMode();
    onOpenChange(chat.isOpen());
    carryIn();
  }

  /* Once the editor has its site on the canvas: the brain and the place. A load that failed never registers, so the
     shell mounts the events side alone and says the editing part is not there. */
  function start() {
    if (started) return;
    var U = ui(), A = assistant();
    if (!U || !A || !isFn(U.chat.ready)) return;
    started = true;
    Promise.resolve(U.chat.ready()).then(function (ok) {
      if (!ok) return;
      A.registerBrain('edit', brain);
      A.registerPlace(placeAdapter());
    }).then(null, function (err) { warn('the editor could not join the panel: ' + (err && err.message)); });
  }

  var api = {
    start: start, TEXT: TEXT, goToFor: goToFor, contentUrl: contentUrl, focusLabel: focusLabel, isPicture: isPicture,
    wouldCover: wouldCover, recFor: recFor, brain: brain
  };
  root.RevampEditorChat = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  start();
})(typeof window !== 'undefined' ? window : this);
