/* dash-bot-client.js — ETB2B AI on the events dashboard (Event_Listing.html): the page's side of the bot.

   It mounts the shared chat kit (etb2b-chat.js, window.RevampChat) in #rv-dash-bot, sends each message to
   POST /api/dash-bot together with what the list is showing, and does what the answer says at once. That is
   ETB2B AI's "do it, then undo": there is no Apply or Discard step, and everything it changes can be put back.
     filter     the list changes (window.RvListing.apply); the panel folds to a one-line peek so the list is in
                view; Undo puts the list back exactly as it was. Another portal's events are looked at "for now":
                the portal the person works in is not moved
     portal     ("switch to ETAuto") the dashboard's own portal switcher moves (RvListing.setPortal, saved for the
                person as the switcher saves it); Undo switches back
     navigate   "Opening … · Stay here" for 1.2 s, then the page opens; Stay here cancels, and Back undoes
     create     the details go to Create Event (localStorage, under an id the server made), then as navigate
     choose     one button per event; a click runs that event's own action, with no second AI call
     refuse     the fixed sentence, and a link to the manual control where one exists
     undo       ("undo that") the newest list change ETB2B AI made in this tab is put back
   There is no action here that deletes, cancels, publishes, approves, sends or pays: those stay manual, and
   nothing in this file could do them.

   Every page it opens is checked again against NAV_OK, one whitelist, right before it is opened. Every name and
   number it shows came from the server; from the page it reads only what the list is showing (RvListing).
   Each person's chat history is their own (GET /api/dash-bot/history) and is replayed on the first open.

   Browser storage (all optional: with storage blocked the bot still answers, Undo lasts until the tab closes)
     sessionStorage  rv.dashBot.open                 '1' while ETB2B AI has just opened a page: Back reopens the panel
     sessionStorage  rv.dashBot.undo.<turnId>        the list before a filter (….list for "Show these in the list"),
                                                     the newest 15, so Undo still works after a reload
     localStorage    revamp.createEvent.prefill.v1.<prefillId>   the Create Event hand-off, read once over there

   ES5 on purpose (var, function, promises): the dashboard serves it as it is, with no build step. */
(function (root) {
  'use strict';

  var doc = root.document;

  /* The only pages ETB2B AI may open, the same list the server builds its links from (functions/lib/dash-bot.js
     urlFor). Anything else, however it got into an answer, is not opened. */
  var NAV_OK = /^\/(?:edit-event\.html\?event=[a-z0-9-]+(?:#(?:content|settings)\/[a-z-]+|#dashboard|#activity|#design\/editor)?|marketing\.html\?event=[a-z0-9-]+&tab=(?:posts|site-posts|mailers)(?:&template=[a-z]+\.[a-z-]+)?(?:&post=[a-z-]+)?(?:&mailer=mailer\.[a-z-]+)?|audience-registrations\.html\?event=[a-z0-9-]+|preview\/[a-z0-9-]+\?draft=1|e\/[a-z0-9-]+|activity-log\.html(?:\?event=[a-z0-9-]+)?|mailer-performance\.html|create-event\.html\?new=1(?:&prefill=[A-Za-z0-9]{10,40})?)$/;

  /* long enough to read "Opening …" and press Stay here, short enough not to feel like waiting */
  var NAV_DELAY_MS = 1200;
  /* after Stay here, a click on the card's link waits at most this long for its "opened after all" report */
  var LATER_WAIT_MS = 1500;
  var STILL_WORKING_MS = 8000;
  /* the server gives up on the model after 55 s; past this the answer is not coming */
  var GIVE_UP_MS = 90000;
  var MAX_MESSAGE = 4000;
  var KEEP_UNDO = 15;
  var TURN_ID = /^[A-Za-z0-9]{10,40}$/;
  var OPEN_KEY = 'rv.dashBot.open';
  var UNDO_PREFIX = 'rv.dashBot.undo.';
  var PREFILL_PREFIX = 'revamp.createEvent.prefill.v1.';

  var TEXT = {
    welcome: 'I can start a new event, open any event’s pages, answer questions from your events’ real numbers, and set up promotions.',
    footNote: 'ETB2B AI opens pages, filters this list, switches its portal and starts drafts. It never deletes, cancels, publishes or approves anything.',
    tooLong: 'Keep the message under 4,000 characters. For a longer brief, ask me to start a new event from a brief, then paste it on Create Event.',
    session: 'Your session has ended. Sign in again.',
    offline: 'You’re offline. Check your connection and try again.',
    unreachable: 'Could not reach ETB2B AI. Check your connection and try again.',
    slow: 'ETB2B AI is taking too long to answer. Try again.',
    rate: 'That is a lot of messages in a short time. Please wait a few minutes and try again.',
    daily: 'You have used today’s ETB2B AI allowance. It resets at midnight (India time).',
    stillWorking: 'Still working. This can take up to a minute.',
    notKept: 'This message wasn’t saved to your history.',
    notShown: 'ETB2B AI answered, but this page could not show the answer. Reload the page to see it in your history.',
    olderUndo: 'This puts the list back as it was before that message, including later changes. Undo?',
    undone: 'Done, the list is back as it was.',
    nothingToUndo: 'There’s nothing here I can undo. Pages I opened can be left with your browser’s Back button, and a new event I started can be cleared with Undo on the Create Event page.',
    couldNot: 'That could not be done here. ',
    notUndone: 'That could not be undone here. Reload the page to see the whole list.',
    listMissing: 'The events list isn’t ready on this page. Reload it and ask again.',
    newTab: 'Opened in a new tab.',
    /* a create answer whose own sentence the server could not keep (older turns; the server now sends this itself) */
    creating: 'Starting Create Event with your details.',
    failedBefore: 'That could not be done at the time.'
  };

  /* the four things ETB2B AI does here; a chip fills the box (the kit selects the first "…") and never sends */
  var SUGGESTIONS = [
    { label: 'Create an IP event called … on … in …', text: 'Create an IP event called … on … in …' },
    { label: 'Show drafts from last week', text: 'Show drafts from last week' },
    { label: 'Which events go live this month?', text: 'Which events go live this month?' },
    { label: 'Make a save-the-date post and an announcement mailer for …', text: 'Make a save-the-date post and an announcement mailer for …' }
  ];

  var STATUS_WORDS = { draft: 'Draft', upcoming: 'Upcoming', active: 'Active', completed: 'Completed', cancelled: 'Cancelled' };
  var SERVER_SORTS = { start: 1, registrations: 1, visitors: 1 };
  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /* what a Create Event field is called when the server left it out because the person never typed it */
  var FIELD_WORDS = {
    name: 'the event name', client: 'the client', venue: 'the venue', city: 'the city',
    date: 'the date', start: 'the dates', end: 'the dates', dates: 'the dates', month: 'the month', quarter: 'the quarter', year: 'the year',
    currentUrl: 'this edition’s link', previousUrl: 'the previous edition’s link', portal: 'the portal', category: 'the kind of event',
    heroSubject: 'what the hero picture should show'
  };

  var chat = null;
  var mounted = false;
  var inFlight = null;
  var pending = null;        // the page about to open, while its Stay here is offered
  var changes = [];          // ETB2B AI's list changes in this tab, oldest first (by when they were made)
  var signingIn = false;

  function now() { return new Date().getTime(); }
  function str(v) { return v == null ? '' : String(v); }
  function labelOf(v, fallback) { var s = str(v).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, 160) : fallback; }
  function joinWords(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  /* ---------- browser storage: every access may throw (private windows, blocked site data) ---------- */
  function store(kind) { try { return root[kind] || null; } catch (e) { return null; } }
  function getItem(kind, key) { var s = store(kind); if (!s) return null; try { return s.getItem(key); } catch (e) { return null; } }
  function setItem(kind, key, value) { var s = store(kind); if (!s) return false; try { s.setItem(key, value); return true; } catch (e) { return false; } }
  function removeItem(kind, key) { var s = store(kind); if (!s) return; try { s.removeItem(key); } catch (e) { /* nothing to remove */ } }
  function keysWith(kind, prefix) {
    var s = store(kind), out = [];
    if (!s) return out;
    try {
      for (var i = 0; i < s.length; i++) { var k = s.key(i); if (k && k.indexOf(prefix) === 0) out.push(k); }
    } catch (e) { /* storage went away */ }
    return out;
  }

  /* ---------- the server ---------- */
  /* keepalive: the request outlives this page, for a report sent just as the person leaves it */
  function api(url, method, body, keepalive) {
    var auth = root.RevampAuth;
    if (!auth || typeof auth.authedFetch !== 'function') return Promise.reject({ status: 401 });
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (keepalive) opts.keepalive = true;
    return auth.authedFetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { /* not JSON: an error page from in front of the API */ }
        return { ok: !!res.ok, status: res.status, body: data };
      });
    });
  }

  /* how a turn ended, for the person's history and ETB2B AI's memory: undone, failed, or done with a choice.
     Resolves once the server has answered (or could not be reached), never rejects. */
  function report(turnId, status, note, keepalive) {
    if (!turnId || !TURN_ID.test(turnId)) return Promise.resolve(false);
    var body = { turnId: turnId, status: status };
    if (note) body.note = str(note).slice(0, 300);
    return api('/api/dash-bot/turn', 'POST', body, keepalive).then(function () { return true; },
      function () { return false; /* the history line is a nicety; the page already did it */ });
  }

  function signInSoon() {
    if (signingIn) return;
    signingIn = true;
    setTimeout(function () {
      var auth = root.RevampAuth;
      if (auth && typeof auth.redirectToSignIn === 'function') auth.redirectToSignIn();
    }, 2000);
  }
  /* What the kit shows in the error bubble. retryable false leaves its Try again out, where trying again at
     once cannot help (the day's allowance is used up, the message is too long, the session has ended). */
  function problem(text, retryable) {
    var e = new Error(text);
    if (retryable === false) e.retryable = false;
    return e;
  }
  function answerError(r) {
    var b = r.body && typeof r.body === 'object' ? r.body : {};
    if (r.status === 401) { signInSoon(); return problem(TEXT.session, false); }
    if (b.code === 'chat-rate') return problem(str(b.error) || TEXT.rate);
    if (b.code === 'dash-bot-daily') return problem(str(b.error) || TEXT.daily, false);
    if (b.code === 'too-long') return problem(str(b.error) || TEXT.tooLong, false);
    if (typeof b.error === 'string' && b.error) return problem(b.error, b.retryable === false ? false : undefined);
    return problem('ETB2B AI could not answer (error ' + r.status + '). Try again.');
  }
  function networkError(err) {
    if (err && (err.status === 401 || err.code === 'revamp/signed-out')) { signInSoon(); return problem(TEXT.session, false); }
    if (err && err.dashBotSlow) return problem(TEXT.slow);
    if (root.navigator && root.navigator.onLine === false) return problem(TEXT.offline);
    return problem(TEXT.unreachable);
  }

  function busy(on, text) { if (chat && typeof chat.setBusy === 'function') { try { chat.setBusy(on, text); } catch (e) { /* the strip is cosmetic */ } } }

  /* what the person is looking at, so "these" and "here" mean something. It is only context: the server takes
     no fact from it. */
  function viewNow() {
    var s = null;
    try { s = root.RvListing.snapshot(); } catch (e) { s = null; }
    s = s && typeof s === 'object' ? s : {};
    var sort = s.sort && SERVER_SORTS[s.sort.field] ? { field: s.sort.field, dir: s.sort.dir === 'desc' ? 'desc' : 'asc' } : null;
    return {
      tab: str(s.tab) || 'active',
      specialView: s.specialView || null,
      search: str(s.search).slice(0, 80),
      /* the portal scope the list shows now (a slug, 'none' or '' for every portal), and the portal the person
         works in ('' = All portals). An older page's snapshot has no working portal: its list portal was it. */
      portal: typeof s.portal === 'string' ? s.portal : '',
      working: typeof s.working === 'string' ? (s.working === 'all' ? '' : s.working) : (typeof s.portal === 'string' ? s.portal : ''),
      types: s.filters && Array.isArray(s.filters.types) ? s.filters.types.slice(0, 10) : [],
      mine: s.mine === true,
      created: s.created || null,
      starts: s.starts || null,
      sort: sort,
      shown: typeof s.shown === 'number' ? s.shown : 0
    };
  }

  /* ---------- one message ---------- */
  function send(text) {
    var message = str(text).trim();
    if (!message) return Promise.resolve();
    if (inFlight) return inFlight;                       // one request at a time (the kit locks its box too)
    if (message.length > MAX_MESSAGE) return Promise.reject(problem(TEXT.tooLong, false));
    stopPending();                                       // typing again means staying here
    busy(true);
    var slowTimer = setTimeout(function () { busy(true, TEXT.stillWorking); }, STILL_WORKING_MS);
    var giveUp = null;
    function settle() { clearTimeout(slowTimer); clearTimeout(giveUp); inFlight = null; busy(false); }
    var request = new Promise(function (resolve, reject) {
      giveUp = setTimeout(function () { reject({ dashBotSlow: true }); }, GIVE_UP_MS);
      api('/api/dash-bot', 'POST', { message: message, view: viewNow() }).then(resolve, reject);
    });
    inFlight = request.then(function (r) {
      settle();
      if (!r.ok || !r.body || typeof r.body !== 'object' || r.body.error) throw answerError(r);
      try { draw(r.body); } catch (e) {
        /* the server answered (and kept the turn): say so rather than put the question back as if it had not */
        if (root.console && root.console.warn) root.console.warn('[ETB2B AI] could not show an answer: ' + (e && e.message));
        try { chat.ai(TEXT.notShown, { error: true }); } catch (e2) { /* nothing more to try */ }
      }
    }, function (err) {
      settle();
      throw networkError(err);
    });
    return inFlight;
  }

  function hasFigures(parts, list) {
    for (var i = 0; i < parts.length; i++) if (parts[i] && parts[i].t === 'value') return true;
    if (!list || typeof list !== 'object') return false;
    if (typeof list.count === 'number') return true;
    var items = Array.isArray(list.items) ? list.items : [];
    for (var j = 0; j < items.length; j++) if (items[j] && (items[j].registrations != null || items[j].visitors != null)) return true;
    return false;
  }
  /* "as of 12:05 IST" goes only on an answer that holds figures, so a number is never read as newer than it is */
  function bubbleOpts(parts, list, asOf, at) {
    var o = {};
    if (at) o.at = at;
    if (asOf && hasFigures(parts, list)) o.asOf = asOf;
    return o;
  }
  function partsText(parts) {
    return parts.map(function (p) { return p && typeof p.v === 'string' ? p.v : (p && p.name ? str(p.name) : ''); }).join(' ');
  }

  function draw(body) {
    var ctx = {
      turnId: !body.notKept && TURN_ID.test(str(body.turnId)) ? str(body.turnId) : '',
      notes: Array.isArray(body.notes) ? body.notes : [],
      shown: ''
    };
    var action = body.action && typeof body.action === 'object' ? body.action : null;
    if (body.kind === 'undo' || (action && action.type === 'undo')) {
      var ok = undoNewest();
      var b0 = chat.ai(ok ? TEXT.undone : TEXT.nothingToUndo, {});
      if (body.notKept) b0.note(TEXT.notKept);
      return;
    }
    var parts = Array.isArray(body.parts) ? body.parts : [];
    var list = body.list && typeof body.list === 'object' ? body.list : null;
    ctx.shown = partsText(parts);
    var startsCreate = body.kind === 'create' && !!action;
    var bubble = chat.ai(parts.length ? parts : (list ? 'Here is what I found.' : (startsCreate ? TEXT.creating : '')), bubbleOpts(parts, list, body.asOf));
    if (body.notKept) bubble.note(TEXT.notKept);
    if (list) drawList(bubble, list, ctx);
    if (body.kind === 'choose' && Array.isArray(body.choices) && body.choices.length) { drawChoices(bubble, body.choices, ctx); return; }
    if (action) runAction(action, bubble, ctx, ctx.shown);
  }

  /* the whole action vocabulary of the dashboard bot */
  function runAction(action, bubble, ctx, shownText) {
    if (!action || typeof action !== 'object') return false;
    if (action.type === 'filter') return runFilter(action, bubble, ctx);
    if (action.type === 'portal') return runPortal(action, bubble, ctx);
    if (action.type === 'navigate') return runNavigate(action, bubble, ctx);
    if (action.type === 'create') return runCreate(action, bubble, ctx);
    if (action.type === 'refuse') { drawRefusal(action, bubble, shownText || ''); return true; }
    return false;
  }
  function started(ctx) { if (ctx.onStart) { var f = ctx.onStart; ctx.onStart = null; f(); } }
  function failed(bubble, ctx, reason) {
    bubble.note(TEXT.couldNot + reason);
    report(ctx.turnId, 'failed', reason);
    return false;
  }

  /* ---------- list changes and their Undo ---------- */
  function keep(c) {
    c.at = c.at || now();
    c.buttons = [];
    c.undone = false;
    /* one handler per change: the kit ties every Undo bound to it (the card's and the peek's) together, and a
       false from it (the person said no, or the list could not be put back) leaves Undo as it was */
    c.handler = function () { return undoChange(c); };
    /* kept in time order, so "the newest" is the last one even when history replays older ones later */
    var i = changes.length;
    while (i > 0 && changes[i - 1].at > c.at) i--;
    changes.splice(i, 0, c);
    if (c.key) {
      setItem('sessionStorage', UNDO_PREFIX + c.key, JSON.stringify({ at: c.at, kind: c.kind, label: c.label, snap: c.snap }));
      prune();
    }
    return c;
  }
  function prune() {
    var held = keysWith('sessionStorage', UNDO_PREFIX).map(function (k) {
      var at = 0;
      try { at = +JSON.parse(getItem('sessionStorage', k)).at || 0; } catch (e) { at = 0; }
      return { k: k, at: at };
    });
    held.sort(function (a, b) { return b.at - a.at; });
    held.slice(KEEP_UNDO).forEach(function (h) { removeItem('sessionStorage', h.k); });
  }
  function heldSnap(key) {
    if (!key) return null;
    var raw = getItem('sessionStorage', UNDO_PREFIX + key);
    if (!raw) return null;
    try {
      var v = JSON.parse(raw);
      return v && v.snap && typeof v.snap === 'object' ? v : null;
    } catch (e) { return null; }
  }
  function ask(text) {
    if (typeof root.confirm !== 'function') return true;
    try { return !!root.confirm(text); } catch (e) { return true; }
  }
  function spent(c) {
    c.undone = true;
    if (c.key) removeItem('sessionStorage', UNDO_PREFIX + c.key);
    if (chat && typeof chat.markUndone === 'function') {
      try { chat.markUndone(c.handler); } catch (e) { /* the controls stay as they are */ }
    } else {
      c.buttons.forEach(function (el) {
        if (!el) return;
        el.disabled = true;
        try { el.textContent = 'Undone'; } catch (e) { /* a read-only stand-in */ }
      });
    }
    /* a "Show these in the list" change belongs to an answer, which stays answered */
    if (c.kind === 'filter' || c.kind === 'portal') report(c.turnId, 'undone');
  }
  function undoChange(c) {
    if (!c || c.undone) return false;
    var later = changes.slice(changes.indexOf(c) + 1).filter(function (x) { return !x.undone; });
    if (later.length && !ask(TEXT.olderUndo)) return false;
    /* Going back past a portal ETB2B AI switched to switches back too. Only then: a portal the person chose
       themselves on the switcher is theirs, and an Undo of a list change never moves it. */
    var portalToo = later.concat([c]).some(function (x) { return x.kind === 'portal'; });
    var L = root.RvListing, ok = false;
    try { ok = !!(L && typeof L.restore === 'function' && L.restore(c.snap, portalToo ? { portal: true } : undefined) !== false); } catch (e) { ok = false; }
    if (!ok) { if (c.bubble) c.bubble.note(TEXT.notUndone); return false; }
    /* going back past a later change takes that change away too */
    later.concat([c]).forEach(spent);
    return true;
  }
  function undoNewest() {
    for (var i = changes.length - 1; i >= 0; i--) if (!changes[i].undone) return undoChange(changes[i]);
    return false;
  }
  /* the open panel would cover the very column a filter changed, so it folds to a one-line peek with Undo */
  function fold(c) {
    if (!chat || typeof chat.fold !== 'function') return;
    try { chat.fold((c.kind === 'portal' ? 'Now ' : 'Showing ') + c.label, c.handler); } catch (e) { /* the card keeps its Undo */ }
  }

  function runFilter(action, bubble, ctx) {
    var L = root.RvListing;
    if (!L || typeof L.apply !== 'function' || !action.patch || typeof action.patch !== 'object') return failed(bubble, ctx, TEXT.listMissing);
    var snap;
    try { snap = L.apply(action.patch); } catch (e) { return failed(bubble, ctx, 'The events list could not be changed. Reload the page and ask again.'); }
    started(ctx);
    var label = labelOf(action.label, 'the events you asked for');
    bubble.note('Showing ' + label + '.');
    if (!snap || typeof snap !== 'object') return true;
    var c = keep({ key: ctx.turnId, turnId: ctx.turnId, kind: 'filter', snap: snap, label: label, bubble: bubble });
    c.buttons.push(bubble.undo(c.handler));
    fold(c);
    return true;
  }

  /* The dashboard's own portal switcher, moved to the portal asked for (saved for the person, as the switcher
     saves it). The card and the peek say where the list now is, with Undo, which switches back. */
  function runPortal(action, bubble, ctx) {
    var L = root.RvListing;
    var to = str(action.portal);
    if (!L || typeof L.setPortal !== 'function' || !/^(?:all|[a-z0-9]{1,40})$/.test(to)) return failed(bubble, ctx, TEXT.listMissing);
    var snap = null;
    try { snap = L.setPortal(to); } catch (e) { snap = null; }
    if (!snap || typeof snap !== 'object') return failed(bubble, ctx, 'The dashboard could not be switched to that portal. Reload the page and ask again.');
    started(ctx);
    var label = 'working in ' + labelOf(action.label, to === 'all' ? 'All portals' : 'that portal');
    bubble.note('Now ' + label + '.');
    var c = keep({ key: ctx.turnId, turnId: ctx.turnId, kind: 'portal', snap: snap, label: label, bubble: bubble });
    c.buttons.push(bubble.undo(c.handler));
    fold(c);
    return true;
  }

  /* ---------- opening a page: "Opening … · Stay here", then go ---------- */
  function settleNav(p) { p.done = true; clearTimeout(p.timer); if (pending === p) pending = null; }
  /* the kit's cancel() calls Stay here's handler unless told {silent:true}; {text} is what the card then says */
  function stopBar(p, o) {
    if (!p || !p.cd || typeof p.cd.cancel !== 'function') return false;
    try { return p.cd.cancel(o) === true; } catch (e) { return false; }
  }
  function stopPending() {
    var p = pending;
    if (!p || p.done) return;
    stopBar(p);
    if (!p.done) p.stay();
  }
  function leave(p, url) {
    if (p.done) return;
    settleNav(p);
    if (!NAV_OK.test(url)) return;                       // checked again at the last moment
    setItem('sessionStorage', OPEN_KEY, '1');            // Back (or a reload) reopens the panel
    root.location.assign(url);
  }
  /* After Stay here the card's link is still there, and following it is opening the page after all. The turn is
     then reported done again (once), so the history and ETB2B AI's memory no longer say "You stayed on this page".
     A plain click waits for that report (LATER_WAIT_MS at most) before it goes, so leaving the page cannot cut the
     report off; a click into a new tab leaves this page here and goes at once. onLater puts back what Stay here
     took away (Create Event's details). */
  function openedLater(p, e, newTab, url, bubble, ctx, onLater) {
    if (onLater) onLater();
    var first = !p.later;
    p.later = true;
    var sent = first ? report(ctx.turnId, 'done', 'opened after staying', !newTab) : Promise.resolve(true);
    if (newTab) { if (first) bubble.note(TEXT.newTab); return; }
    setItem('sessionStorage', OPEN_KEY, '1');            // Back (or a reload) reopens the panel
    if (!first || !e || typeof e.preventDefault !== 'function' || !NAV_OK.test(url)) return;   // the browser follows the link
    e.preventDefault();
    var gone = false;
    function go() { if (gone) return; gone = true; root.location.assign(url); }
    setTimeout(go, LATER_WAIT_MS);
    sent.then(go, go);
  }
  function countdown(url, linkLabel, barLabel, bubble, ctx, onStay, onLater) {
    stopPending();
    var p = { done: false, stayed: false, later: false, cd: null, timer: null };
    p.stay = function () {
      if (p.done) return;
      settleNav(p);
      p.stayed = true;
      if (onStay) onStay();
      report(ctx.turnId, 'undone', 'stayed');
    };
    pending = p;
    /* this timer is set before the kit's own bar of the same length, so it runs first */
    p.timer = setTimeout(function () { leave(p, url); }, NAV_DELAY_MS);
    /* a real link too, so Ctrl/⌘-click or a middle click opens it in a new tab instead */
    var link = null;
    try { link = bubble.link(url, linkLabel); } catch (e) { link = null; }
    p.cd = bubble.countdown(NAV_DELAY_MS, barLabel, p.stay);
    if (link && typeof link.addEventListener === 'function') {
      var onClick = function (e) {
        var newTab = !!(e && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1));
        if (p.stayed) { openedLater(p, e, newTab, url, bubble, ctx, onLater); return; }
        if (p.done) return;
        settleNav(p);
        if (!newTab) { setItem('sessionStorage', OPEN_KEY, '1'); return; }   // a plain click: the browser follows the link
        /* the page opened elsewhere: this one stays, and the card says why (it is not a Stay here) */
        if (!stopBar(p, { silent: true, text: TEXT.newTab })) bubble.note(TEXT.newTab);
      };
      link.addEventListener('click', onClick);
      link.addEventListener('auxclick', function (e) { if (e && e.button === 1) onClick(e); });
    }
    return p;
  }
  function runNavigate(action, bubble, ctx) {
    var url = str(action.url);
    if (!NAV_OK.test(url)) return failed(bubble, ctx, 'That isn’t a page ETB2B AI may open.');
    started(ctx);
    var label = labelOf(action.label, 'the page');
    countdown(url, label, 'Opening ' + label + '…', bubble, ctx, null);
    return true;
  }

  /* ---------- starting Create Event with the details filled in ---------- */
  function dayText(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(s));
    return m && +m[2] >= 1 && +m[2] <= 12 ? (+m[3]) + ' ' + MONTH_SHORT[+m[2] - 1] + ' ' + m[1] : '';
  }
  function whenOf(b) {
    var mode = str(b.dateMode);
    if ((mode === 'exact' || !mode) && b.start) {
      var s = dayText(b.start), e = b.end && b.end !== b.start ? dayText(b.end) : '';
      return s ? (e ? s + ' – ' + e : s) : '';
    }
    var m = /^(\d{4})-(\d{2})$/.exec(str(b.month));
    if (mode === 'month' && m && +m[2] >= 1 && +m[2] <= 12) return MONTH_LONG[+m[2] - 1] + ' ' + m[1];
    if (mode === 'quarter' && b.quarter) return str(b.quarter) + (b.year ? ' ' + str(b.year) : '');
    if (mode === 'tbd') return 'date to be decided';
    return '';
  }
  function summary(p) {
    var b = p.basics && typeof p.basics === 'object' ? p.basics : {};
    var br = p.brief && typeof p.brief === 'object' ? p.brief : {};
    var bits = [];
    var kind = { IP: 'IP event', Client: 'Client event', Awards: 'Awards' }[p.category];
    if (kind) bits.push(kind);
    if (b.name) bits.push(str(b.name));
    var when = whenOf(b);
    if (when) bits.push(when);
    var place = [b.venue, b.city].filter(function (x) { return !!x; }).map(str).join(', ');
    if (place) bits.push(place);
    if (b.client) bits.push('for ' + str(b.client));
    if (br.text) bits.push('your brief');
    if (br.current || br.previous) bits.push(br.current && br.previous ? 'your two links' : 'your link');
    /* made only once the event is created; Create Event shows it with Change and Remove */
    if (p.hero && typeof p.hero === 'object') bits.push('a hero picture once it is created');
    return bits.join(' · ');
  }
  /* which details the server left out because the person never typed them (the "grounding" rule) */
  function dropped(notes, action) {
    var names = [], generic = false;
    function add(f) { var w = FIELD_WORDS[f]; if (w && names.indexOf(w) === -1) names.push(w); }
    (Array.isArray(action.dropped) ? action.dropped : []).forEach(add);
    notes.forEach(function (n) {
      var m = /^not-said[:.]([A-Za-z]+)$/.exec(str(n));
      if (m) add(m[1]);
      else if (n === 'not-said') generic = true;
    });
    if (names.length) return 'I left out ' + joinWords(names) + ': please type ' + (names.length === 1 ? 'it' : 'them') + ' there.';
    if (generic) return 'I left out details you didn’t type yourself: please check them there.';
    return '';
  }
  function runCreate(action, bubble, ctx) {
    var id = str(action.prefillId), url = str(action.url);
    if (!TURN_ID.test(id) || url !== '/create-event.html?new=1&prefill=' + id || !NAV_OK.test(url)) {
      return failed(bubble, ctx, 'The details for Create Event did not come through. Ask again.');
    }
    var prefill = action.prefill && typeof action.prefill === 'object' ? action.prefill : {};
    /* exactly the server's cleaned details, and who they are from; Create Event checks every field again */
    var record = {};
    Object.keys(prefill).forEach(function (k) { record[k] = prefill[k]; });
    record.v = 1;
    record.from = 'etb2b-ai';
    record.at = now();
    record.turnId = ctx.turnId || null;
    record.prefillId = id;
    var key = PREFILL_PREFIX + id;
    /* written again, with a fresh time, when the card's link is followed after Stay here took it away */
    function put() { record.at = now(); return setItem('localStorage', key, JSON.stringify(record)); }
    if (!put()) {
      return failed(bubble, ctx, 'This browser would not keep the details for Create Event (site storage is blocked).');
    }
    started(ctx);
    /* what was left out, unless the answer already says so (the server writes that sentence itself) */
    var left = dropped(ctx.notes, action);
    if (left && str(ctx.shown).indexOf('I left out') === -1) bubble.note(left);
    var what = summary(prefill);
    countdown(url, labelOf(action.label, 'Create Event, filled in'), what ? 'Opening Create Event with: ' + what + '…' : 'Opening Create Event…',
      bubble, ctx, function () { removeItem('localStorage', key); }, put);
    return true;
  }

  /* ---------- refusals, choices and lists ---------- */
  function drawRefusal(action, bubble, shownText) {
    var p = action.pointer && typeof action.pointer === 'object' ? action.pointer : {};
    var text = typeof p.text === 'string' ? p.text : '';
    if (text && shownText.indexOf(text) === -1) bubble.note(text);
    if (typeof p.href === 'string' && NAV_OK.test(p.href)) bubble.link(p.href, labelOf(p.hrefLabel, 'Open it'));
  }
  function drawChoices(bubble, choices, ctx) {
    var chosen = false;
    bubble.choices(choices.map(function (c) {
      c = c && typeof c === 'object' ? c : {};
      return {
        label: [c.name, c.portal, c.dates, c.statusLabel].filter(function (x) { return !!x; }).map(str).join(' · '),
        onClick: function () {
          if (chosen) return;
          chosen = true;
          var id = str(c.eventId).slice(0, 300);
          /* each choice already holds its own resolved action: no second AI call */
          var ok = runAction(c.action, bubble, { turnId: ctx.turnId, notes: ctx.notes, onStart: function () { report(ctx.turnId, 'done', id); } }, '');
          if (!ok) { chosen = false; return false; }               // the kit keeps the other choices open
          return true;
        }
      };
    }));
  }
  function fmtCount(n) {
    try { return Number(n).toLocaleString('en-IN'); } catch (e) { return String(n); }
  }
  /* A row's two figures, as the server sends them. The one the list is ranked by leads (the row's value, beside
     the name), and the other follows the dates, so "the most visitors" reads in order and nothing sent is hidden. */
  var LIST_FIGURES = { registrations: 'registration', visitors: 'visitor' };
  function figureText(n, word) {
    if (typeof n === 'number' && isFinite(n)) return fmtCount(n) + ' ' + word + (n === 1 ? '' : 's');
    if (typeof n === 'string' && n) return n + ' ' + word + 's';
    return '';
  }
  /* what the list is ranked by: the server's word when it sends one (list.metric), else its title when that speaks
     of visitors and not of registrations; registrations otherwise */
  function listMetric(list) {
    if (list.metric === 'registrations' || list.metric === 'visitors') return list.metric;
    var title = str(list.title);
    return /visit/i.test(title) && !/registr/i.test(title) ? 'visitors' : 'registrations';
  }
  function kitItem(it, metric, showPortal) {             // metric: 'registrations' or 'visitors' (listMetric)
    it = it && typeof it === 'object' ? it : {};
    var other = metric === 'visitors' ? 'registrations' : 'visitors';
    var lead = figureText(it[metric], LIST_FIGURES[metric]), next = figureText(it[other], LIST_FIGURES[other]);
    return {
      href: str(it.href), name: str(it.name),
      /* a list across all portals names each event's portal ("No portal yet" for none) */
      meta: [showPortal ? str(it.portal) : '', str(it.dates), lead ? next : ''].filter(function (x) { return !!x; }).join(' · '),
      chip: { label: str(it.statusLabel) || STATUS_WORDS[it.status] || '', tone: str(it.status) },
      value: lead || next
    };
  }
  function kitList(list) {
    var items = Array.isArray(list.items) ? list.items : [], metric = listMetric(list);
    return { title: str(list.title), count: typeof list.count === 'number' ? list.count : items.length, more: list.more === true,
      items: items.map(function (it) { return kitItem(it, metric, list.showPortal === true); }) };
  }
  function drawList(bubble, list, ctx) {
    bubble.list(kitList(list));
    if (!list.view || typeof list.view !== 'object') return;
    var used = false, btn = null;
    btn = bubble.button('Show these in the list', function () {
      if (used) return;
      var L = root.RvListing, snap;
      if (!L || typeof L.apply !== 'function') { bubble.note(TEXT.couldNot + TEXT.listMissing); return; }
      try { snap = L.apply(list.view); } catch (e) { bubble.note(TEXT.couldNot + 'The events list could not be changed.'); return; }
      used = true;
      if (btn) { btn.disabled = true; try { btn.textContent = 'Shown in the list'; } catch (e) { /* stand-in */ } }
      if (!snap || typeof snap !== 'object') return;
      var c = keep({ key: ctx.turnId ? ctx.turnId + '.list' : '', turnId: ctx.turnId, kind: 'list', snap: snap, label: labelOf(list.title, 'these events'), bubble: bubble });
      c.buttons.push(bubble.undo(c.handler));
      fold(c);
    });
  }

  /* ---------- the person's own history, on the first open ---------- */
  function replay(t) {
    t = t && typeof t === 'object' ? t : {};
    var at = t.at || null;
    var id = TURN_ID.test(str(t.id)) ? str(t.id) : '';
    if (t.question) chat.user(str(t.question), { at: at });
    var parts = Array.isArray(t.parts) ? t.parts : [];
    var list = t.list && typeof t.list === 'object' && Array.isArray(t.list.items) ? t.list : null;
    var a = t.action && typeof t.action === 'object' ? t.action : null;
    /* a create kept before the server sent its fixed sentence has no words: it gets them, never an empty line */
    var said = parts.length ? parts : (str(t.answer) || (a && a.type === 'create' ? TEXT.creating : ''));
    var b = chat.ai(said, bubbleOpts(parts, list, t.asOf, at));
    if (list) b.list(kitList(list));
    if (a && (a.type === 'filter' || a.type === 'portal')) {
      var isPortal = a.type === 'portal';
      var label = isPortal ? 'working in ' + labelOf(a.label, 'another portal') : labelOf(a.label, 'a filtered list');
      var did = isPortal ? 'Switched to ' + labelOf(a.label, 'another portal') : 'Showed ' + label;
      if (t.status === 'undone') b.note(did + ', then undone.');
      else if (t.status === 'failed') b.note(TEXT.failedBefore);
      else {
        b.note(did + '.');
        /* Undo comes back only where this tab still holds the list as it was */
        var held = t.status === 'done' ? heldSnap(id) : null;
        if (held) {
          var c = keep({ key: id, turnId: id, kind: a.type, snap: held.snap, label: label, at: +held.at || 1, bubble: b });
          c.buttons.push(b.undo(c.handler));
        }
      }
    } else if (a && (a.type === 'navigate' || a.type === 'create')) {
      if (t.status === 'undone') b.note('You stayed on this page.');
      else if (t.status === 'failed') b.note(TEXT.failedBefore);
      else if (a.type === 'navigate' && NAV_OK.test(str(a.url))) b.link(str(a.url), labelOf(a.label, 'Open it'));
      else if (a.type === 'create') b.note('Opened ' + labelOf(a.label, 'Create Event, filled in') + '.');
    }
    var heldList = id ? heldSnap(id + '.list') : null;
    if (heldList) {
      var cl = keep({ key: id + '.list', turnId: id, kind: 'list', snap: heldList.snap, label: labelOf(heldList.label, 'these events'), at: +heldList.at || 1, bubble: b });
      cl.buttons.push(b.undo(cl.handler));
    }
  }
  /* resolves with how many turns were replayed; a failed read rejects, and the kit then says the earlier
     messages could not be loaded rather than showing an empty past */
  function loadHistory() {
    return api('/api/dash-bot/history', 'GET').then(function (r) {
      if (!r.ok || !r.body || !Array.isArray(r.body.turns)) throw new Error('Your earlier messages could not be loaded (' + r.status + ').');
      var turns = r.body.turns;
      if (!turns.length) return 0;
      chat.divider('Earlier');
      turns.forEach(function (t) {
        try { replay(t); } catch (e) { /* one odd old turn never hides the rest */ }
      });
      chat.divider('Now');
      return turns.length;
    });
  }

  /* ---------- mounting ---------- */
  function firstName(name) {
    var n = str(name).trim().split(/\s+/)[0] || '';
    return n.length > 40 ? '' : n;
  }
  /* "Email Customer Care" in the panel's header opens the page's own help window. On a phone the panel is a
     full-screen sheet, so it steps aside first and the focus comes back to its launcher. */
  function openHelp(arg) {
    var L = root.RvListing;
    if (!L || typeof L.openHelp !== 'function') return;
    /* the kit passes its "Email Customer Care" button; an event's target works too */
    var from = arg && typeof arg.focus === 'function' ? arg :
      arg && arg.currentTarget && typeof arg.currentTarget.focus === 'function' ? arg.currentTarget : (doc && doc.activeElement) || null;
    var phone = false;
    try { phone = !!(root.matchMedia && root.matchMedia('(max-width: 600px)').matches); } catch (x) { phone = false; }
    if (phone) {
      try { chat.close(); } catch (x) { /* already closed */ }
      from = (doc && doc.getElementById('dash-chat-launcher')) || from;
    }
    L.openHelp(from);
  }
  function options(startOpen) {
    var me = {};
    try { me = root.RvListing.me() || {}; } catch (e) { me = {}; }
    var first = firstName(me.name);
    return {
      id: 'dash',
      title: 'ETB2B AI',
      launcherLabel: 'Ask ETB2B AI',
      placeholder: 'Ask ETB2B AI…',
      welcome: { heading: first ? 'Hi ' + first + ', I’m ETB2B AI.' : 'Hi, I’m ETB2B AI.', text: TEXT.welcome },
      suggestions: SUGGESTIONS,
      footNote: TEXT.footNote,
      help: { label: 'Email Customer Care', onClick: openHelp },
      send: send,
      loadHistory: loadHistory,
      onOpenChange: function () { /* the kit keeps its own open state */ },
      startOpen: startOpen
    };
  }
  function mount() {
    if (mounted) return chat;
    var host = doc && doc.getElementById('rv-dash-bot');
    var kit = root.RevampChat, L = root.RvListing;
    /* without the kit or the list's door the page keeps "Need help?" exactly as before */
    if (!host || !kit || typeof kit.mount !== 'function' || !L || typeof L.snapshot !== 'function') return null;
    mounted = true;
    var startOpen = getItem('sessionStorage', OPEN_KEY) === '1';
    removeItem('sessionStorage', OPEN_KEY);
    try { chat = kit.mount(host, options(startOpen)) || null; } catch (e) {
      chat = null;
      if (root.console && root.console.warn) root.console.warn('[ETB2B AI] could not start: ' + (e && e.message));
    }
    return chat;
  }
  /* after the sign-in check has answered, so the welcome can use the person's first name */
  function boot() {
    var auth = root.RevampAuth, begun = false;
    function go() { if (begun) return; begun = true; mount(); }
    if (auth && typeof auth.whenResolved === 'function') {
      try { auth.whenResolved().then(go, go); } catch (e) { go(); return; }
      setTimeout(go, 4000);                              // the check never answered: start anyway, unnamed
    } else go();
  }

  /* Back to this page out of the browser's memory (no reload): reopen the panel if ETB2B AI opened the page */
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('pageshow', function (e) {
      if (!e || !e.persisted || !chat) return;
      if (getItem('sessionStorage', OPEN_KEY) !== '1') return;
      removeItem('sessionStorage', OPEN_KEY);
      try { if (!chat.isOpen()) chat.open(); } catch (x) { /* the panel is gone */ }
    });
  }

  root.RevampDashBot = { NAV_OK: NAV_OK, NAV_DELAY_MS: NAV_DELAY_MS };
  boot();
})(typeof window !== 'undefined' ? window : this);
