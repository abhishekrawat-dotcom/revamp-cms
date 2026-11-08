/* promo-ai-client.js — ETB2B AI in the social post editor and the mailer editor ("Edit with AI", batch B18-ai): the
   "promo brain" of the one assistant on Promotions (marketing.html, etb2b-assistant.js). The owner chose it on
   2026-11-08 (owner-decisions.md #9; promo-easy-edit/DESIGN.md section 3).

   The two editors run in frames inside Promotions (promo-social-studio.html, promo-mailer-studio.html), and the
   assistant is never inside a frame. So there is ONE panel, this page's: while a post or a mail is open in its editor
   in "Edit with AI", the shell sends this brain the messages about it (routePromo), in the event's own conversation.
   This brain reaches the open editor through its bridge (window.OWAi, promo-studio/oneworld-ai-mode.js, same origin):

     1. it reads the post's or mail's state, and asks POST /api/promo/ai-edit (functions/lib/promo-ai.js), which
        checks every change against an allow-list and this event's real data;
     2. it DOES the change at once, through the editors' own change paths, and the answer offers Undo (do it, then
        undo: there is no Apply step). Undo is local: it costs no AI call;
     3. a new background is made in a second step (ETB2B AI pictures) and put on the post when it arrives;
     4. one post per speaker is drawn in the editor, and the answer offers its Download: ETB2B AI never sends,
        publishes, deletes or downloads for the person;
     5. it reports what became of the change (/api/promo/ai-edit/turn): applied, partly, failed, undone or stopped.
   LOCKED TO THE EVENT (owner decision 10): the server refuses any event that is not this page's and one of the
   person's own; this file refuses again when the open editor's event is not the page's, before anything is asked or
   changed.

   Each message resolves with { kind, turnId, intent, status } — the shape of the dash brain's turns, with the model's
   short label of what was asked and its outcome — so the request record (batch AI-learn-a) can take it in one line.

   ES5 on purpose (var, function, promises), as every page script. */
(function (root) {
  'use strict';

  var doc = root.document;
  var FRAME_IDS = ['promo-social-frame', 'promo-mailer-frame'];
  var TURN_ID = /^[A-Za-z0-9]{10,40}$/;
  var MAX_MESSAGE = 4000;
  var GIVE_UP_MS = 70000;              // the server's own deadline is 55 s
  var PICTURE_GIVE_UP_MS = 200000;     // a background and its check take up to three minutes (chat-picture DEADLINE_MS)

  var TEXT = {
    thinking: 'Reading the post…',
    thinkingMail: 'Reading the mail…',
    picture: 'Making the new background… it takes about half a minute.',
    drawing: 'Drawing one post per speaker…',
    wrongEvent: 'This editor is not showing this event’s post, so I won’t change it. Reload Promotions and open the post again.',
    closed: 'The editor was closed before I could make the change, so nothing was changed.',
    undone: 'Undone — the {what} is as it was before that change.',
    nothingToUndo: 'There is no change of mine to undo here.',
    notUndone: 'I couldn’t undo that.',
    tooLong: 'Keep the message under 4,000 characters.',
    slow: 'ETB2B AI is taking too long. Nothing was changed. Try again.',
    pictureFailed: 'The new background could not be made: ',
    pictureHeld: 'The new background was made but not put on the post: ',
    pictureStopped: 'Stopped — the new background was not put on the post.',
    already: 'It was already like that, so nothing needed changing.',
    downloadLabel: 'Download {n} speaker posts (ZIP)',
    downloaded: 'Downloading the speaker posts.',
    downloadGone: 'Those posts are no longer ready: ask me again.',
    replayDone: 'Done in the {what} editor.',
    replayUndone: 'Done in the {what} editor, then undone.',
    replayPartly: 'Partly done in the {what} editor.',
    replayFailed: 'This change could not be made.'
  };
  /* what the panel offers while an editor is open in "Edit with AI" (the dash brain's come back when it closes) */
  var IDEAS = {
    post: [{ label: 'Shorten the title', text: 'Make the title shorter and punchier.' },
      { label: 'Write a LinkedIn caption', text: 'Write a LinkedIn caption for this post.' },
      { label: 'New background', text: 'Make a new background for this post: a calm, premium conference hall.' },
      { label: 'One post per speaker', text: 'Make one post per speaker.' }],
    mail: [{ label: 'Write a subject line', text: 'Write a better subject line for this mail.' },
      { label: 'Write the preview text', text: 'Write the preview text for this mail.' },
      { label: 'Show all speakers', text: 'Show all of the event’s speakers in this mail.' },
      { label: 'Tighten the words', text: 'Make the opening paragraph shorter and clearer.' }]
  };

  var chat = null, inFlight = null, stopNow = null;
  var changes = [];                    // this tab's changes: { turnId, at, what, frame, undone }
  var lastMode = '';

  function str(v) { return v == null ? '' : String(v); }
  function isFn(f) { return typeof f === 'function'; }
  function fill(s, o) { return str(s).replace(/\{([a-z]+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(o, k) ? str(o[k]) : m; }); }
  function shell() { return root.RevampAssistant || null; }
  function problem(text, retryable) { var e = new Error(text); if (retryable === false) e.retryable = false; return e; }

  function api(url, method, body) {
    var auth = root.RevampAuth;
    if (!auth || !isFn(auth.authedFetch)) return Promise.reject({ status: 401 });
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return auth.authedFetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
        return { ok: !!res.ok, status: res.status, body: data };
      });
    });
  }
  function errorOf(r, place) {
    var A = shell();
    if (A && isFn(A.errorFor)) { try { return A.errorFor(r, place); } catch (e) { /* the plain one below */ } }
    return problem('ETB2B AI couldn’t answer that. Nothing was changed. Try again.');
  }
  function busy(on, text, o) {
    if (!chat || !isFn(chat.setBusy)) return;
    try { if (o) chat.setBusy(on, text, o); else chat.setBusy(on, text); } catch (e) { /* the strip is cosmetic */ }
  }

  /* ---------- the open editor ---------- */
  /* the studio frame that is open full-window on the tab shown, and in "Edit with AI": { frame, ai } or null */
  function openStudio() {
    for (var i = 0; i < FRAME_IDS.length; i++) {
      var f = doc.getElementById(FRAME_IDS[i]);
      if (!f || !f.classList.contains('is-studio') || !(f.getClientRects && f.getClientRects().length)) continue;
      var ai = null;
      try { ai = f.contentWindow && f.contentWindow.OWAi; } catch (e) { ai = null; }
      try { if (ai && ai.active()) return { frame: f, ai: ai }; } catch (e) { /* the frame is going */ }
    }
    return null;
  }
  function frameById(id) {
    var f = doc.getElementById(id), ai = null;
    try { ai = f && f.contentWindow && f.contentWindow.OWAi; } catch (e) { ai = null; }
    return ai ? { frame: f, ai: ai } : null;
  }
  function placeNow() {
    var A = shell(), p = null;
    try { p = A && isFn(A.place) ? A.place() : null; } catch (e) { p = null; }
    return p || { page: '', eventId: '', tab: '' };
  }
  /* the second lock: the open editor's event is the page's (whose own the server confirms) */
  function sameEvent(s, place) {
    var ev = '';
    try { ev = str(s.ai.eventId()); } catch (e) { ev = ''; }
    return !!place.eventId && place.page === 'promotions' && ev === place.eventId;
  }

  function report(eventId, turnId, status, done, notDone) {
    if (!TURN_ID.test(str(turnId))) return Promise.resolve(false);
    return api('/api/promo/ai-edit/turn', 'POST', { eventId: eventId, turnId: turnId, status: status, done: done || [], notDone: notDone || [] })
      .then(function () { return true; }, function () { return false; /* the History line is a nicety; the post already changed */ });
  }
  function notes(b, list, prefix) {
    (list || []).slice(0, 12).forEach(function (t) { if (t && b && isFn(b.note)) b.note(prefix + str(t)); });
  }

  /* ---------- one message ---------- */
  function send(text, o) {
    o = o || {};
    var message = str(text).replace(/^\s+|\s+$/g, '');
    if (!message) return Promise.resolve();
    if (inFlight) return inFlight;
    if (message.length > MAX_MESSAGE) return Promise.reject(problem(TEXT.tooLong, false));
    var place = placeNow();
    var s = openStudio();
    /* no editor open in "Edit with AI" any more: the events side answers */
    if (!s) return Promise.resolve({ handoff: true, kind: 'handoff' });
    if (!sameEvent(s, place)) { if (chat) chat.ai(TEXT.wrongEvent, {}); return Promise.resolve({ kind: 'refuse', status: 'refused', intent: 'other event' }); }
    var kind = s.ai.kind(), what = kind === 'mail' ? 'mail' : 'post';
    var state = null;
    try { state = s.ai.state(); } catch (e) { state = null; }
    if (!state) return Promise.resolve({ handoff: true, kind: 'handoff' });
    var body = { eventId: place.eventId, editor: kind, message: message, place: { page: 'promotions', eventId: place.eventId, tab: place.tab }, state: state };

    var finished = false, stopped = false, resolveOuter = null, rejectOuter = null;
    var outer = new Promise(function (resolve, reject) { resolveOuter = resolve; rejectOuter = reject; });
    var giveUp = null;
    function settle() { finished = true; clearTimeout(giveUp); inFlight = null; stopNow = null; busy(false); }
    stopNow = function () { if (finished) return; stopped = true; settle(); resolveOuter({ kind: 'stopped', status: 'stopped' }); };
    busy(true, kind === 'mail' ? TEXT.thinkingMail : TEXT.thinking, { onStop: function () { if (stopNow) stopNow(); } });
    var request = new Promise(function (resolve, reject) {
      giveUp = setTimeout(function () { reject({ slow: true }); }, GIVE_UP_MS);
      api('/api/promo/ai-edit', 'POST', body).then(resolve, reject);
    });
    request.then(function (r) {
      var a = r && r.body && typeof r.body === 'object' ? r.body : null;
      if (stopped) {
        /* the person stopped waiting: nothing is changed, and the conversation says so */
        if (r && r.ok && a && a.kind === 'edit') report(place.eventId, str(a.turnId), 'stopped');
        return;
      }
      if (finished) return;
      if (!r.ok || !a || a.error) { settle(); rejectOuter(errorOf(r, place)); return; }
      if (a.kind === 'handoff') { settle(); resolveOuter({ handoff: true, kind: 'handoff', intent: str(a.intent) }); return; }
      var turnId = str(a.turnId), intent = str(a.intent);
      if (a.kind === 'refuse' || a.kind === 'reply') {
        settle();
        chat.ai(str(a.summary) || ' ', {});
        resolveOuter({ kind: a.kind, turnId: turnId, intent: intent, status: a.kind === 'refuse' ? 'refused' : 'answered' });
        return;
      }
      if (a.kind === 'undo') { settle(); undoLocal().then(function (u) { resolveOuter({ kind: 'undo', turnId: turnId, intent: intent, status: u && u.ok ? 'undone' : 'failed' }); }); return; }
      /* an edit: done now, through the open editor (the same one, still on this event) */
      var now = openStudio();
      if (!now || now.frame !== s.frame || !sameEvent(now, placeNow())) {
        settle();
        chat.ai(TEXT.closed, {});
        report(place.eventId, turnId, 'failed', [], [TEXT.closed]);
        resolveOuter({ kind: 'edit', turnId: turnId, intent: intent, status: 'failed' });
        return;
      }
      doEdit(now, a, place, what, function () { return stopped; }).then(function (status) {
        settle();
        resolveOuter({ kind: 'edit', turnId: turnId, intent: intent, status: status });
      }, function (e) {
        settle();
        report(place.eventId, turnId, 'failed', [], [str(e && e.message)]);
        rejectOuter(problem('The change could not be made: ' + str(e && e.message)));
      });
    }, function (err) {
      if (stopped || finished) return;
      settle();
      rejectOuter(err && err.slow ? problem(TEXT.slow) : errorOf({ network: err }, place));
    });
    inFlight = outer;
    return outer;
  }

  /* the change, its notes, its Undo, then the background and the per-speaker posts that follow it -> status */
  /* isStopped: the person pressed Stop while a background was being made: it is then not put on the post */
  function doEdit(s, a, place, what, isStopped) {
    var turnId = str(a.turnId), c = a.changes || {};
    var b = chat.ai(str(a.summary) || 'Done.', {});
    var done = [], notDone = (a.skipped || []).slice();
    var rec = { turnId: turnId, at: new Date().getTime(), what: what, frame: s.frame.id, undone: false, eventId: place.eventId };
    var undoShown = false;
    function offerUndo() {
      if (undoShown || !b || !isFn(b.undo)) return;
      undoShown = true;
      changes.push(rec);
      /* the kit marks every Undo bound to this one handler "Undone" together (etb2b-chat.js markUndone) */
      rec.onUndo = function () { return undoChange(rec); };
      b.undo(rec.onUndo);
    }
    return Promise.resolve(s.ai.apply(c, turnId)).then(function (res) {
      res = res || {};
      done = done.concat(res.done || []);
      notDone = notDone.concat(res.notDone || []);
      notes(b, res.done, 'Done: ');
      notes(b, (a.skipped || []).concat(res.notDone || []), 'Not done: ');
      if (res.changed) offerUndo();
      var next = Promise.resolve();
      if (a.newPicture && a.newPicture.pending) next = next.then(function () { return makeBackground(s, a, place, b, isStopped); }).then(function (got) {
        if (got.done) { done.push(got.done); offerUndo(); }
        if (got.notDone) notDone.push(got.notDone);
      });
      if (c.perSpeaker) next = next.then(function () { return speakerPosts(s, b); }).then(function (got) {
        if (got.done) done.push(got.done);
        if (got.notDone) notDone.push(got.notDone);
      });
      return next.then(function () {
        /* asked for what the post or mail already is ("show all the speakers" when it does): nothing to change, said
           plainly, and not counted as a failure */
        if (!done.length && !notDone.length) {
          b.note(TEXT.already);
          done.push(TEXT.already);
        }
        var status = done.length && notDone.length ? 'partly' : done.length ? 'applied' : 'failed';
        report(place.eventId, turnId, status, done, notDone);
        return status;
      });
    });
  }
  /* the second step: the background the stored turn asked for, then on the post */
  function makeBackground(s, a, place, b, isStopped) {
    busy(true, TEXT.picture);
    var giveUp = null;
    var got = new Promise(function (resolve, reject) {
      giveUp = setTimeout(function () { reject({ slow: true }); }, PICTURE_GIVE_UP_MS);
      api('/api/promo/ai-edit', 'POST', { eventId: place.eventId, step: 'picture', turnId: str(a.turnId) }).then(resolve, reject);
    });
    return got.then(function (r) {
      clearTimeout(giveUp);
      var p = r && r.body && typeof r.body === 'object' ? r.body : {};
      if (!r.ok || p.error || !p.url) { var why = str(p.error) || 'ask again.'; b.note(TEXT.pictureFailed + why); return { notDone: 'The new background: ' + why }; }
      if (p.held) { var held = str(p.heldWhy) || 'it did not pass its check.'; b.note(TEXT.pictureHeld + held); return { notDone: 'The new background: ' + held }; }
      if (isFn(isStopped) && isStopped()) { b.note(TEXT.pictureStopped); return { notDone: TEXT.pictureStopped }; }
      var now = frameById(s.frame.id);
      if (!now || !now.ai.active() || !sameEvent(now, placeNow())) { b.note(TEXT.closed); return { notDone: TEXT.closed }; }
      return Promise.resolve(now.ai.background(p.url, str(a.turnId))).then(function (res) {
        notes(b, res && res.done, 'Done: ');
        notes(b, res && res.notDone, 'Not done: ');
        return res && res.changed ? { done: 'A new background' } : { notDone: 'The new background could not be put on the post' };
      });
    }, function (err) {
      clearTimeout(giveUp);
      var why = err && err.slow ? 'it took too long; ask again.' : 'it could not be reached; ask again.';
      b.note(TEXT.pictureFailed + why);
      return { notDone: 'The new background: ' + why };
    }).then(function (res) { busy(false); return res; });
  }
  /* one post per speaker, drawn in the editor, with the person's own Download */
  function speakerPosts(s, b) {
    busy(true, TEXT.drawing);
    return Promise.resolve().then(function () { return s.ai.perSpeaker(); }).then(function (h) {
      busy(false);
      if (!h || !h.id) return { notDone: 'One post per speaker could not be drawn' };
      b.note(str(h.message));
      b.button(fill(TEXT.downloadLabel, { n: h.count }), function () {
        var f = frameById(s.frame.id), ok = false;
        try { ok = !!(f && f.ai.download(h.id)); } catch (e) { ok = false; }
        if (chat) chat.ai(ok ? TEXT.downloaded : TEXT.downloadGone, {});
      }, { primary: true });
      return { done: 'One post per speaker, ready to download' };
    }, function (e) {
      busy(false);
      b.note('Not done: one post per speaker — ' + str(e && e.message));
      return { notDone: 'One post per speaker: ' + str(e && e.message) };
    });
  }

  /* ---------- Undo, with no AI call ---------- */
  function undoChange(rec) {
    if (!rec || rec.undone) return Promise.resolve(false);
    var f = frameById(rec.frame);
    if (!f) { if (chat) chat.ai(TEXT.notUndone, {}); return Promise.resolve(false); }
    return Promise.resolve(f.ai.undo(rec.turnId)).then(function (r) {
      if (r && r.ok) {
        rec.undone = true;
        report(rec.eventId, rec.turnId, 'undone');
        return true;
      }
      if (chat) chat.ai(str(r && r.why) || TEXT.notUndone, {});
      return false;
    }, function () { if (chat) chat.ai(TEXT.notUndone, {}); return false; });
  }
  function newestOpen() {
    for (var i = changes.length - 1; i >= 0; i--) if (!changes[i].undone) return changes[i];
    return null;
  }
  function changedAt() { var c = newestOpen(); return c ? c.at : 0; }
  /* "undo that", sent here by the shell with no AI call */
  function undoLocal() {
    var c = newestOpen();
    if (!c) { if (chat) chat.ai(TEXT.nothingToUndo, {}); return Promise.resolve({ ok: false }); }
    return undoChange(c).then(function (ok) {
      if (ok && chat) {
        chat.ai(fill(TEXT.undone, { what: c.what }), {});
        /* the answer's own Undo becomes "Undone" too, so one change is never undone twice */
        try { if (isFn(chat.markUndone) && c.onUndo) chat.markUndone(c.onUndo); } catch (e) { /* a nicety */ }
      }
      return { ok: ok, kind: 'edit' };
    });
  }

  /* ---------- the conversation read back ---------- */
  var REPLAY = { applied: 'replayDone', partly: 'replayPartly', failed: 'replayFailed', undone: 'replayUndone' };
  function replay(t, w) {
    if (!t || t.brain !== 'promo') return false;
    var at = t.at || null, what = t.editor === 'mail' ? 'mailer' : 'post';
    if (t.question) w.user(str(t.question), { at: at });
    var said = str(t.answer).replace(/^\s+|\s+$/g, '');
    var line = REPLAY[t.status] ? fill(TEXT[REPLAY[t.status]], { what: what }) : '';
    var b = w.ai(said || line || ' ', { at: at });
    (Array.isArray(t.done) ? t.done : []).slice(0, 12).forEach(function (d) { if (typeof d === 'string' && d && b && isFn(b.note)) b.note('Done: ' + d); });
    (Array.isArray(t.notDone) ? t.notDone : []).slice(0, 12).forEach(function (d) { if (typeof d === 'string' && d && b && isFn(b.note)) b.note('Not done: ' + d); });
    if (line && said && b && isFn(b.note)) b.note(line);
    return true;
  }

  /* ---------- the page around it ---------- */
  /* an editor going into or out of "Edit with AI": the panel's ideas follow it */
  function dashIdeas() {
    var d = root.RevampDashBot && root.RevampDashBot.brain, w = null;
    try { w = d && isFn(d.welcome) ? d.welcome(placeNow(), {}) : null; } catch (e) { w = null; }
    return w && Array.isArray(w.quickIdeas) ? w.quickIdeas : [];
  }
  function modeChanged() {
    var s = openStudio(), m = s ? s.ai.kind() : '';
    if (m === lastMode) return;
    lastMode = m;
    if (!chat || !isFn(chat.setQuickIdeas)) return;
    try { chat.setQuickIdeas(m ? IDEAS[m] : dashIdeas()); } catch (e) { /* the ideas are a nicety */ }
  }
  if (root.addEventListener) {
    root.addEventListener('message', function (e) {
      if (e.origin !== root.location.origin || !e.data || typeof e.data !== 'object' || e.data.rvAiMode == null) return;
      setTimeout(modeChanged, 0);
    });
  }

  var brain = {
    send: send,
    replay: replay,
    stop: function () { if (stopNow) stopNow(); },
    changedAt: changedAt,
    undoLocal: undoLocal,
    active: function () { return !!openStudio(); },
    onMount: function (c) {
      chat = c || null;
      modeChanged();
      /* the studios keep their post or mail clear of ETB2B AI's open panel (oneworld-ai-mode.js chatOpen) */
      var A = shell();
      if (A && isFn(A.onOpenChange) && !chatWired) {
        chatWired = true;
        A.onOpenChange(function (open) {
          FRAME_IDS.forEach(function (id) {
            var f = doc.getElementById(id);
            try { if (f && f.contentWindow) f.contentWindow.postMessage({ rvAiChat: !!open }, root.location.origin); } catch (e) { /* the frame has gone */ }
          });
        });
      }
    }
  };
  var chatWired = false;
  root.RevampPromoAi = { brain: brain, TEXT: TEXT, IDEAS: IDEAS, _test: { openStudio: openStudio, sameEvent: sameEvent, changes: changes } };
  /* the shell usually loads after this file and picks the brain up itself; loaded later, it is told here */
  var A0 = shell();
  if (A0 && isFn(A0.registerBrain)) A0.registerBrain('promo', brain);
})(typeof window !== 'undefined' ? window : this);
