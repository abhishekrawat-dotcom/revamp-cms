/* etb2b-assistant.js — ONE ETB2B AI on every page a signed-in team member uses (window.RevampAssistant).

   The owner, 5 Nov 2026: "keep consistency in the AI Bot. The current one which is live on dashboard is good, keep
   it across and place it in the bottom right corner", "The AI will be same across" and "don't forget to add
   attachment option in the AI Bot". So every page carries the same "Ask ETB2B AI" launcher and panel (the chat kit,
   etb2b-chat.js), bottom-right, and behind it the same assistant. This file is that assistant's shell:

     - it knows WHERE the person is: the page (the mount's data-rv-assistant), the event of that page (?event=, or
       ?slug= in the site editor) and the console section or Promotions tab. Every message carries it, so "this
       event" and "registrations here" mean the event on screen;
     - it mounts the kit once, with the page's placement (data-keep-clear lifts the launcher over a page's own
       action bar), the welcome and suggestions for that place, and the right conversation: the person's own
       dashboard history on pages with no event, that event's ETB2B AI history inside an event (one conversation
       for both brains);
     - it routes each message to a BRAIN. The "dash brain" (dash-bot-client.js, POST /api/dash-bot) answers on
       every page: questions from real data, opening pages, promotions, a new event, portals; inside an event, that
       event only (owner decision 10: the panel's line says "Working on <event> only"). The "edit brain"
       (editor-chat-client.js, POST /api/chat-edit) exists only in the site editor, where it changes the page and
       makes pictures. In the editor a fixed rule (route(), below) picks the brain; either brain may hand the
       message to the other once ("handoff"), never back; "undo that" there is local and costs no AI call, and goes
       to the brain whose change in this panel is the newest (a portal switch is put back by the dash brain, a page
       change by the editor's); a bare "go back" is asked about (undo, or another page?), never guessed;
     - it takes ATTACHMENTS everywhere (the attach button, drag and drop, paste: the kit draws them as chips), with
       a policy per place that says plainly what a file is for: without an event a brief (PDF or text) and a logo
       start a new event through Create Event's own inputs; inside an event pictures can go on to that event's site
       editor; in the editor the editor's own attach path places pictures on the page (the editor gives its own).
       Files stay in this browser until an action needs them, and then go only through an upload the page already
       has (Create Event's logo box and Overview document, the editor's own upload), so every check of those paths
       still runs. Nothing an attachment holds reaches a published page without the person's own Save, Publish or
       Create Event confirm;
     - it says errors the same way for both brains (errorFor: one table, by the server's code).

   window.RevampAssistant
     place()                         -> { page, eventId, tab }   the event is the one the page opened with, kept for as
                                     long as the panel is up (so the conversation shown, the one stored and "this
                                     event" always match, even when the page rewrites its address); the console's
                                     section and Promotions' tab are read afresh
     registerBrain(name, brain)      'dash' | 'edit'. brain: { send(text, o) -> Promise, replay?(turn, writer) -> bool,
                                     loadHistory?(writer), stop?(), undoLocal?(text, o) -> Promise, onMount?(chat),
                                     welcome?(place, me), help?(place), changedAt?() -> ms of its newest change in
                                     this tab that Undo can still take back, 0 for none }
     registerPlace(adapter)          the page's adapter (only the site editor has one): { welcome, suggestions, quickIdeas,
                                     footNote, attach, route(text, recs), context: { current(), onChange(fn), clear() },
                                     dock, phoneSheet, phoneQuery, wrapAttrs, onMount(chat), leave(url) }
     chat()                          the kit's chat, or null before the mount
     open(), close(), isOpen(), focusInput(), onOpenChange(fn), ready() -> Promise<chat|null>
     leave(url)                      opens a page ETB2B AI was asked for, through the page's own guard for unsaved work
     markReopen()                    Back (or a reload) to this page reopens the panel (sessionStorage, per page)
     route(text, recs, place)        the editor's rule: 'undo' | 'ask' | 'edit' | 'dash' (pure, tested on a corpus)
     errorFor(r, place)              -> Error with .retryable, the sentence for a failed answer ({status, body} or a
                                     network failure { network: err })
     wireAttachments(recs)           what the dash brain's server is sent for the chips of a message
     carryCheck(role, rec)           '' when Create Event's own box takes that file, else the sentence why not
     handoffFiles(prefillId, items)  keeps a new event's logo and brief file for Create Event (IndexedDB, 10 minutes)
     carry(eventId, recs, text)      keeps pictures (and the words) for that event's site editor (IndexedDB + a pointer)
     takeCarry(eventId)              -> Promise<{ text, files, expected } | null>   the editor's side, read once

   Where it never appears: inside a frame (the Promotions studios), on a published site, a preview or a shared link
   (/e/, /s/, /preview/), on a page with no mount, or for someone signed out. The pages that carry it say so with
   one attribute; functions/lib/assistant-pages.test.js holds that list.

   Browser storage (all optional; with storage blocked ETB2B AI still answers)
     sessionStorage  rv.assistant.open.<page>          '1' after ETB2B AI opened another page from here: Back reopens
     localStorage    rv.assistant.carry.<eventId>      { key, text, at, n } pictures waiting for that event's editor
     IndexedDB       aihandoff:<prefillId>             a new event's logo and brief file, for Create Event
                     aicarry:<eventId>:<key>           pictures for an event's site editor
                     aihandoff:index, aicarry:index    what is kept, so anything older than 10 minutes is swept
     (the editor's store, editor-store.js; its site:*, create:* and rv.aiTurn.* keys are never touched here)

   ES5 on purpose (var, function, promises): every page serves it as it is, with no build step. */
(function (root) {
  'use strict';

  var doc = root.document;

  /* the pages that may carry ETB2B AI (data-rv-assistant), and what each is called in a help e-mail */
  var PAGE_LABELS = {
    'dashboard': 'Events dashboard', 'console': 'Event console', 'create-event': 'Create Event', 'editor': 'Site editor',
    'promotions': 'Promotions', 'review': 'Review', 'activity-log': 'Activity log', 'registrations': 'Registrations',
    'mailer-performance': 'Mailer performance', 'portal-review': 'Portal review'
  };
  /* pages that are never about one event, whatever their address says */
  var NO_EVENT = { dashboard: 1, 'create-event': 1, 'mailer-performance': 1, 'portal-review': 1 };
  var EVENT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
  var CONSOLE_TAB = /^(?:dashboard|activity|(?:content|settings|design)\/[a-z][a-z-]{0,39})$/;
  var PROMO_TABS = { posts: 1, 'site-posts': 1, mailers: 1 };
  /* a published site, a preview, a shared link, the sign-in page and the framed studios: never, even with a mount */
  var NEVER_PATH = /^\/(?:e|s|preview|templates)(?:\/|$)|^\/(?:preview-draft|index|banner)\.html$|^\/promo-[a-z-]+-studio\.html$/;
  var ID_RE = /^[A-Za-z0-9]{10,40}$/;

  var AUTH_WAIT_MS = 4000;            // the sign-in check that never answers: mount anyway, unnamed
  var EDITOR_WAIT_MS = 30000;         // the editor registers once it has opened its site
  var POLL_MS = 500;
  var SCRIPT_WAIT_MS = 8000;          // a script this page loads on demand (the store, the portal picker)
  var KEEP_MS = 10 * 60 * 1000;       // files waiting for another page are kept this long
  var INPUT_WAIT_MS = 30 * 60 * 1000; // Create Event's form may take a while to reach (type, then method)
  var MAX_FILES = 4;                  // files with one message, as the server takes them (dash-bot.js CAPS.attachments)
  var IMAGE_MAX = 8 * 1024 * 1024;    // as every image upload (edit-event-core.js uploadImage)
  var PDF_MAX = 15 * 1024 * 1024;     // as Create Event's Overview document (create-event.html BRIEF_DOC_MAX_BYTES)
  var LOGO_MAX = 5 * 1024 * 1024;     // as Create Event's logo box (#f-logo)
  var TEXT_CHARS = 4000;              // as a brief typed on Create Event
  var TEXT_BYTES = 32 * 1024;         // a text file larger than this cannot hold 4,000 characters worth reading
  var THUMB_EDGE = 512;               // what the model sees of a picture: re-encoded, never the file itself
  var THUMB_BYTES = 120 * 1024;
  var HELP_EMAIL = 'customercare@economictimesb2b.com';

  var HANDOFF_PREFIX = 'aihandoff:', HANDOFF_INDEX = 'aihandoff:index';
  var CARRY_PREFIX = 'aicarry:', CARRY_INDEX = 'aicarry:index', CARRY_POINTER = 'rv.assistant.carry.';
  var OPEN_PREFIX = 'rv.assistant.open.';

  /* Create Event's own boxes, and what each takes (create-event.html: #f-logo, #gb-doc). create-event-prefill.js
     keeps the same rules for the Create Event side; dash-bot-handoff.test.js holds the two together. */
  var LOGO_TYPES = { 'image/png': 1, 'image/webp': 1, 'image/svg+xml': 1 };
  var CE_INPUTS = { logo: { input: 'f-logo', box: 'logo-cell' }, brief: { input: 'gb-doc', box: 'gb-doc-row' } };

  /* Every sentence a person reads from this file. The product is ETB2B EventSphere (owner decision 6, 2026-11-03)
     and the assistant ETB2B AI; no sentence here names the product's old names. */
  var TEXT = {
    scopeGlobal: 'Your events',
    /* inside an event ETB2B AI works on that event only (owner decision 10), and the panel's line says so; it is
       one line under the title, cut with … at a phone's width (the whole name is its title) */
    scopeEvent: 'This event only',
    scopeEventNamed: 'Working on {name} only',
    earlier: 'Earlier in this conversation',
    now: 'Now',
    historyFailed: 'Your earlier messages could not be loaded',
    editorMissing: 'Editing this page with ETB2B AI isn’t available right now; reload the editor. ',
    cantTell: 'I couldn’t tell whether that is about this page. Name the part of the page, for example “the hero”.',
    goBackWhich: 'Do you want me to undo my last change, or open another page? Say “undo that”, or name the page, for example “go back to the console”.',
    helpLabel: 'Email Customer Care',
    helpSubject: 'ETB2B EventSphere help: ',

    /* errors, the same for both brains (UX-097) */
    session: 'Your session has ended. Sign in again.',
    offline: 'You’re offline. Check your connection and try again.',
    unreachable: 'Could not reach ETB2B AI. Check your connection and try again.',
    rate: 'That is a lot of messages in a short time. Please wait a few minutes and try again.',
    daily: 'You have used today’s ETB2B AI allowance. It resets at midnight (India time).',
    tooLong: 'Keep the message under 4,000 characters. For a longer brief, ask me to start a new event from a brief, then paste it on Create Event.',
    tooLarge: 'That message and its attachments are too large to send. Remove an attachment and try again.',
    unchanged: 'Nothing was changed.',
    pageUnchanged: 'Your page is unchanged.',
    aiConfig: 'ETB2B AI is switched off right now. {unchanged} Please tell the ETB2B EventSphere support team.',
    aiBlocked: 'ETB2B AI couldn’t work with that request. {unchanged} Try saying it another way.',
    aiBusy: 'ETB2B AI is busy right now. {unchanged} Try again in a minute.',
    aiBadOutput: 'ETB2B AI gave an answer it couldn’t use. {unchanged} Try again.',
    aiRejected: 'ETB2B AI couldn’t take that request. {unchanged} Try saying it another way, or remove an attachment.',
    aiOther: 'ETB2B AI couldn’t answer that. {unchanged} Try again, or say it another way.',
    noAnswer: 'ETB2B AI didn’t answer. {unchanged} Try again.',

    /* attachments */
    attachStart: 'Attach a brief (PDF or text) or a logo',
    attachEvent: 'Attach a picture',
    hintStart: 'I use attachments to start a new event: a PDF or text brief, and the event’s logo.',
    hintEvent: 'Here I can take pictures to this event’s site editor: say “use it on the site”.',
    word: 'Create Event reads PDFs and plain text. Save the Word file as a PDF and attach it again.',
    docInEvent: 'A brief is read when a new event’s site is generated, in Create Event. It can’t be read into this event.',
    docInEditor: 'In the editor I can use pictures. A brief is read by Create Event’s Generate from a brief.',
    empty: '“{name}” is empty.',
    otherStart: '“{name}” isn’t a file I can use here. Attach a picture (PNG, JPG, WEBP or SVG), a PDF or a text file.',
    otherEvent: '“{name}” isn’t a picture I can use. Attach a PNG, JPG, WEBP, GIF or SVG picture.',
    imageTooBig: '“{name}” is {mb} MB. Pictures can be up to 8 MB.',
    pdfTooBig: '“{name}” is {mb} MB. A brief PDF can be up to 15 MB.',
    textTooLong: '“{name}” is longer than 4,000 characters. Attach the part that matters, or the brief as a PDF.',
    notPdf: '“{name}” isn’t a PDF that can be read.',
    notText: '“{name}” could not be read as text.',
    badPicture: '“{name}” could not be read as a picture.',
    noReader: 'This browser cannot read “{name}” here.',

    /* Create Event's own boxes */
    logoNot: 'Create Event takes a PNG, WEBP or SVG logo of up to 5 MB, so “{name}” wasn’t carried: upload the logo there.',
    briefNot: 'Create Event’s Overview document takes a PDF of up to 15 MB, so “{name}” wasn’t carried.',
    lostFile: '“{name}” couldn’t be brought to Create Event from the events dashboard (this browser didn’t keep it). Add it here: {where}.',
    noDataTransfer: 'This browser can’t hand “{name}” to Create Event’s form. Add it there yourself: {where}.',
    refusedLogo: '“{name}” wasn’t put in: Create Event takes a PNG, WEBP or SVG logo of up to 5 MB.',
    refusedBrief: '“{name}” wasn’t put in: the Overview document takes a PDF of up to 15 MB.',
    whereLogo: 'Upload logo, on the details form',
    whereBrief: 'Choose a PDF, under Overview document',
    handedIn: '“{name}” is in Create Event’s {box} now. Nothing is generated or created until you say so.',
    boxLogo: 'logo box',
    boxBrief: 'Overview document'
  };

  function str(v) { return v == null ? '' : String(v); }
  function isFn(f) { return typeof f === 'function'; }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function now() { return new Date().getTime(); }
  function fill(s, o) { return str(s).replace(/\{([a-z]+)\}/g, function (m, k) { return own(o, k) ? str(o[k]) : m; }); }
  function warn(msg) { try { if (root.console && root.console.warn) root.console.warn('[ETB2B AI] ' + msg); } catch (e) { /* nothing to do */ } }
  function oneLine(v, max) { return str(v).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, max || 160); }

  /* ---------- browser storage: every access may throw (private windows, blocked site data) ---------- */
  function store(kind) { try { return root[kind] || null; } catch (e) { return null; } }
  function getItem(kind, key) { var s = store(kind); if (!s) return null; try { return s.getItem(key); } catch (e) { return null; } }
  function setItem(kind, key, value) { var s = store(kind); if (!s) return false; try { s.setItem(key, value); return true; } catch (e) { return false; } }
  function removeItem(kind, key) { var s = store(kind); if (!s) return; try { s.removeItem(key); } catch (e) { /* nothing to remove */ } }

  /* ================================================================ where the person is */
  function query(search) {
    var out = {};
    str(search).replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('='), k = i === -1 ? pair : pair.slice(0, i), v = i === -1 ? '' : pair.slice(i + 1);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return; }
      if (!own(out, k)) out[k] = v;
    });
    return out;
  }
  /* The page comes from the mount, never from the address; the event from the address, checked for shape here and
     against the person's own live events on the server (an address is only a hint). */
  function readPlace(page, loc) {
    if (!own(PAGE_LABELS, page)) return null;
    loc = loc || {};
    var q = query(loc.search);
    var id = page === 'editor' ? (q.slug || q.event || '') : (q.event || '');
    if (NO_EVENT[page] || !EVENT_ID.test(id)) id = '';
    var tab = '';
    if (page === 'console') {
      var h = str(loc.hash).replace(/^#/, '');
      if (CONSOLE_TAB.test(h)) tab = h;
    } else if (page === 'promotions' && own(PROMO_TABS, q.tab)) tab = q.tab;
    return { page: page, eventId: id, tab: tab };
  }
  function framed() {
    try { return root.top !== root; } catch (e) { return true; }   // a parent on another site cannot even be read
  }
  function forbiddenPath(loc) { return NEVER_PATH.test(str(loc && loc.pathname)); }

  /* ================================================================ the editor's rule: which brain answers */
  /* "undo that" and its kin, alone: the newest change is undone without asking the model */
  var UNDO_RE = /^(?:undo|undo (?:that|it|this)|put it back|revert(?: that| it)?|take (?:that|it) back)[.!]?$/i;
  /* "go back" alone could be either (undo, or another page, as in "go back to the console"): it is asked about */
  var GO_BACK_RE = /^go back[.!]?$/i;
  /* words about the page itself: they keep a message with the editor even when it also sounds like a question */
  var PAGE_CUE = /\b(?:sections?|hero|banners?|headings?|titles?|taglines?|buttons?|text|wording|fonts?|colou?rs?|backgrounds?|pictures?|images?|photos?|logos?|layout|spacing|footer|menu|nav|forms?)\b|\bthis page\b|\bon the page\b/i;
  /* what the dash brain is for: another page, numbers, a new event, promotions, portals, other events */
  var DASH_CUES = [
    /\b(?:open|go to|go back to|take me to|take me back to|show me)\b[^.?!]*\b(?:dashboard|console|content|speakers|agenda|sponsors|settings|registrations?|promotions?|insights|history|activity log|mailer performance|preview|live site|create event)\b/i,
    /\bhow many\b/i,
    /\b(?:registrations?|registrants|visitors|sign-?ups|attendees|checked in|conversion|waitlist)\b/i,
    /\b(?:create|start|set up|make)\s+(?:a|an|another|new)\b[^.?!]{0,40}\bevent\b/i,
    /\bnew event\b/i,
    /\b(?:save[- ]the[- ]date|mailer|newsletter|social post|linkedin post|promotions?)\b/i,
    /\bswitch (?:to|portal)\b/i,
    /\bwork in\b.*\bportal\b/i,
    /\b(?:which|list|my) events\b/i,
    /\bother events?\b/i
  ];
  /* What only a person does, never ETB2B AI: deleting, cancelling or restoring an event, publishing a site or taking
     it offline, approving. The events side answers these with its fixed sentence saying who does it and where
     (functions/lib/dash-bot.js REFUSALS: an approver, in Settings › Visibility, for going offline); the editor's own
     model has no such sentence, so these never go to it. Read before the page words ("publish this page", "take
     this page offline"), on the message without its quoted words, so "Change the button to “Publish now”" stays an
     edit. "event" followed by a part of the page ("remove the event logo") is the page's. */
  var NEVER_CUES = [
    /\b(?:delete|remove|cancel|restore|undelete|trash|archive)\s+(?:this|the|my|our|that|its)?\s*event\b(?!['\u2019]s|\s+(?:logo|name|date|title|picture|image|photo|banner|section|details|description|text|venue|hero|heading|tagline|card|button)s?\b)/i,
    /\b(?:take|taking|put|bring)\b[^.?!]{0,40}\boffline\b/i,
    /\bun-?publish\b/i,
    /\bpublish\b/i,
    /\bgo live\b|\bmake (?:it|the site|this site|the page|this page) live\b/i,
    /\b(?:approve|reject)\b/i
  ];
  var QUOTED = /[\u201c"][^\u201c\u201d"]*[\u201d"]/g;
  function hasPicture(recs) {
    if (!isArr(recs)) return false;
    for (var i = 0; i < recs.length; i++) if (recs[i] && recs[i].kind === 'image') return true;
    return false;
  }
  /* A misroute costs one extra call (the other brain answers "handoff" once); a dash question sent to the editor
     costs a Sonnet call and a screenshot, so questions and navigation go to the dash brain first. */
  function route(text, recs) {
    var t = str(text).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (UNDO_RE.test(t)) return 'undo';
    if (GO_BACK_RE.test(t)) return 'ask';
    if (hasPicture(recs)) return 'edit';
    var bare = t.replace(QUOTED, ' ');
    for (var n = 0; n < NEVER_CUES.length; n++) if (NEVER_CUES[n].test(bare)) return 'dash';
    if (PAGE_CUE.test(t)) return 'edit';
    for (var i = 0; i < DASH_CUES.length; i++) if (DASH_CUES[i].test(t)) return 'dash';
    return 'edit';
  }

  /* ================================================================ errors, said once for both brains */
  /* the product's two old names, as some server sentences still have them until the rename batch: such a sentence
     is never shown, this table's own words are */
  var OLD_NAME = /\bRevamp\b|\bOneworld\b/i;
  function problem(text, retryable) {
    var e = new Error(text);
    if (retryable === false) e.retryable = false;
    return e;
  }
  /* r: { status, body } of an answer that failed, or { network: err } when no answer came. place: where it was asked
     (the editor says "Your page is unchanged", everywhere else "Nothing was changed"). */
  function errorFor(r, p) {
    r = r || {};
    var u = { unchanged: p && p.page === 'editor' ? TEXT.pageUnchanged : TEXT.unchanged };
    if (own(r, 'network')) {
      var err = r.network || {};
      if (err.status === 401 || err.code === 'revamp/signed-out') { var s = problem(TEXT.session, false); s.signIn = true; return s; }
      if (root.navigator && root.navigator.onLine === false) return problem(TEXT.offline);
      return problem(TEXT.unreachable);
    }
    var status = +r.status || 0;
    var b = r.body && typeof r.body === 'object' && !isArr(r.body) ? r.body : null;
    var code = b && typeof b.code === 'string' ? b.code : '';
    var said = b && typeof b.error === 'string' ? oneLine(b.error, 400) : '';
    /* a server sentence that still has the old product name in it is not shown: this table's own words are */
    if (OLD_NAME.test(said)) said = '';
    if (status === 401) { var e401 = problem(TEXT.session, false); e401.signIn = true; return e401; }
    if (code === 'chat-rate') return problem(said || TEXT.rate);
    if (code === 'dash-bot-daily') return problem(said || TEXT.daily, false);
    if (code === 'too-long') return problem(said || TEXT.tooLong, false);
    if (code === 'ai-config') return problem(fill(TEXT.aiConfig, u), false);
    if (code === 'ai-blocked') return problem(fill(TEXT.aiBlocked, u), false);
    if (code === 'ai-quota' || code === 'ai-unavailable' || code === 'ai-timeout') return problem(fill(TEXT.aiBusy, u));
    if (code === 'ai-bad-output') return problem(fill(TEXT.aiBadOutput, u));
    /* the AI service turned the request down (a picture it would not take, a request too large): the same again
       would be turned down too, so no Try again */
    if (code === 'ai-rejected') return problem(fill(TEXT.aiRejected, u), false);
    /* an AI failure this table does not know yet: plain words and what was left as it was, never the server's */
    if (/^ai-/.test(code)) return problem(fill(TEXT.aiOther, u), b.retryable === false ? false : undefined);
    if (status === 413) return problem(TEXT.tooLarge, false);
    /* an error page from in front of the API (no JSON), or a failure that says nothing */
    if (!b || !said) return problem(status >= 500 || !status ? fill(TEXT.noAnswer, u) : 'ETB2B AI could not answer (error ' + status + '). Try again.');
    return problem(said, b.retryable === false ? false : undefined);
  }

  /* ================================================================ attachments */
  var IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
  var EXT_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown' };
  /* What each place takes. Without an event: what starts a new event. Inside an event (and in the editor before its
     own attach path is there): pictures, for that event's site editor. */
  var POLICIES = {
    start: { name: 'start', images: { png: 1, jpg: 1, webp: 1, svg: 1 }, pdf: true, text: true, max: MAX_FILES, label: TEXT.attachStart, hint: TEXT.hintStart,
      accept: 'image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,text/plain,text/markdown,.png,.jpg,.jpeg,.webp,.svg,.pdf,.txt,.md,.doc,.docx',
      doc: TEXT.word, other: TEXT.otherStart },
    event: { name: 'event', images: { png: 1, jpg: 1, webp: 1, svg: 1, gif: 1 }, pdf: false, text: false, max: MAX_FILES, label: TEXT.attachEvent, hint: TEXT.hintEvent,
      accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg',
      doc: TEXT.docInEvent, other: TEXT.otherEvent },
    editor: { name: 'editor', images: { png: 1, jpg: 1, webp: 1, svg: 1, gif: 1 }, pdf: false, text: false, max: MAX_FILES, label: TEXT.attachEvent, hint: TEXT.hintEvent,
      accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg',
      doc: TEXT.docInEditor, other: TEXT.otherEvent }
  };
  /* the pages that are always about one event: there an attachment never starts a new event (owner decision 10),
     even when the address carries no event the server could confirm */
  var EVENT_PAGES = { console: 1, promotions: 1, review: 1, registrations: 1 };
  function policyFor(p) {
    if (p && p.page === 'editor') return POLICIES.editor;
    return p && (p.eventId || own(EVENT_PAGES, p.page)) ? POLICIES.event : POLICIES.start;
  }
  /* a file's name as it is shown and sent: one line, no path, at most 120 characters */
  function cleanName(n) {
    var s = oneLine(str(n).split(/[\\/]/).pop(), 120);
    return s || 'file';
  }
  function extOf(name) { var m = /\.([a-z0-9]{1,5})$/i.exec(str(name)); return m ? m[1].toLowerCase() : ''; }
  /* the type the browser reports wins; a file with none (an SVG on some systems) is known by its ending */
  function classify(file) {
    var t = str(file && file.type).toLowerCase(), ext = extOf(file && file.name);
    if (!t) t = EXT_TYPES[ext] || '';
    if (own(IMAGE_TYPES, t)) return { kind: 'image', sub: IMAGE_TYPES[t], type: t };
    if (t === 'application/pdf') return { kind: 'pdf', type: t };
    if (t === 'text/plain' || t === 'text/markdown' || t === 'text/x-markdown') return { kind: 'text', type: t === 'text/plain' ? t : 'text/markdown' };
    if (/msword|wordprocessingml|ms-word/.test(t) || ext === 'doc' || ext === 'docx') return { kind: 'word', type: t };
    return { kind: 'other', type: t };
  }
  function mb(n) { return (Math.round(n / 104857.6) / 10).toFixed(1); }
  /* The checks that need no reading: '' when the file may go on to be read, else the sentence the chip shows. */
  function checkFile(file, pol) {
    var name = cleanName(file && file.name), c = classify(file), size = +(file && file.size) || 0;
    if (!size) return fill(TEXT.empty, { name: name });
    if (c.kind === 'image' && own(pol.images, c.sub)) return size > IMAGE_MAX ? fill(TEXT.imageTooBig, { name: name, mb: mb(size) }) : '';
    if (c.kind === 'pdf' && pol.pdf) return size > PDF_MAX ? fill(TEXT.pdfTooBig, { name: name, mb: mb(size) }) : '';
    if (c.kind === 'text' && pol.text) return size > TEXT_BYTES ? fill(TEXT.textTooLong, { name: name }) : '';
    if (c.kind === 'word' || c.kind === 'pdf' || c.kind === 'text') return pol.doc;
    return fill(pol.other, { name: name });
  }
  function dataBytes(dataUrl) {
    var i = str(dataUrl).indexOf(',');
    return i === -1 ? 0 : Math.floor((dataUrl.length - i - 1) * 3 / 4);
  }
  /* What the model sees of a picture: drawn on a canvas from a blob: <img> (an SVG's scripts never run there),
     on white, at most 512 px on its long side, as a JPEG of at most 120 KB. Never the file itself. A picture the
     browser cannot draw is refused; one it may not read back (an SVG in some browsers) goes with no thumbnail. */
  function thumbOf(file) {
    return new Promise(function (resolve, reject) {
      var U = root.URL || root.webkitURL;
      if (!U || !isFn(U.createObjectURL) || !doc || !isFn(root.Image)) { reject(new Error('no-reader')); return; }
      var url = '', done = false, img = new root.Image();
      var timer = root.setTimeout(function () { finish(new Error('timeout')); }, 15000);
      function finish(err, out) {
        if (done) return;
        done = true;
        root.clearTimeout(timer);
        try { U.revokeObjectURL(url); } catch (e) { /* already gone */ }
        if (err) reject(err); else resolve(out);
      }
      img.onload = function () {
        var w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
        var dw = w || THUMB_EDGE, dh = h || THUMB_EDGE;
        var k = Math.min(1, THUMB_EDGE / Math.max(dw, dh));
        var cw = Math.max(1, Math.round(dw * k)), ch = Math.max(1, Math.round(dh * k));
        var data = '';
        try {
          var canvas = doc.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var g = canvas.getContext('2d');
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, cw, ch);
          g.drawImage(img, 0, 0, cw, ch);
          var qs = [0.82, 0.7, 0.55, 0.4];
          for (var i = 0; i < qs.length; i++) {
            data = canvas.toDataURL('image/jpeg', qs[i]);
            if (dataBytes(data) <= THUMB_BYTES) break;
          }
          if (!/^data:image\/jpeg;base64,/.test(data) || dataBytes(data) > THUMB_BYTES) data = '';
        } catch (e) { data = ''; }      // a canvas the browser will not read back: no thumbnail, the file still goes
        finish(null, { thumb: data, w: w, h: h });
      };
      img.onerror = function () { finish(new Error('decode')); };
      try { url = U.createObjectURL(file); img.src = url; } catch (e) { finish(e); }
    });
  }
  function reader() { return isFn(root.FileReader) ? new root.FileReader() : null; }
  /* the first bytes of a PDF are "%PDF-": a file only named .pdf is not read as one */
  function looksLikePdf(file) {
    return new Promise(function (resolve) {
      var fr = reader();
      if (!fr || !isFn(file.slice)) { resolve(true); return; }      // nothing to look with: the server checks again
      fr.onload = function () {
        var s = '';
        try { var a = new root.Uint8Array(fr.result); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); } catch (e) { s = str(fr.result); }
        resolve(s === '%PDF-');
      };
      fr.onerror = function () { resolve(false); };
      try { fr.readAsArrayBuffer(file.slice(0, 5)); } catch (e) { resolve(false); }
    });
  }
  function readText(file) {
    return new Promise(function (resolve, reject) {
      var fr = reader();
      if (!fr) { reject(new Error('no-reader')); return; }
      fr.onload = function () { resolve(str(fr.result)); };
      fr.onerror = function () { reject(new Error('unreadable')); };
      try { fr.readAsText(file, 'utf-8'); } catch (e) { reject(e); }
    });
  }

  var held = {};                       // chip id -> the File, kept in this browser until an action needs it
  var seq = 0;
  function recId() { seq += 1; return 'att' + now().toString(36) + seq; }
  /* The kit's attach.add(file): the chip's record, or a rejection whose message the chip shows. */
  function prepare(file, pol) {
    var name = cleanName(file && file.name);
    var why = checkFile(file, pol);
    if (why) return Promise.reject(problem(why));
    var c = classify(file), id = recId();
    var rec = { id: id, name: name, kind: c.kind === 'image' ? 'image' : 'doc', size: +file.size || 0, type: c.type, wire: c.kind === 'image' ? 'image' : c.kind };
    var work;
    if (c.kind === 'image') {
      work = thumbOf(file).then(function (t) {
        if (t.thumb) rec.thumb = t.thumb;
        rec.w = t.w; rec.h = t.h;
      }, function (err) { throw problem(fill(err && err.message === 'no-reader' ? TEXT.noReader : TEXT.badPicture, { name: name })); });
    } else if (c.kind === 'pdf') {
      work = looksLikePdf(file).then(function (ok) { if (!ok) throw problem(fill(TEXT.notPdf, { name: name })); });
    } else {
      work = readText(file).then(function (t) {
        t = t.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, '').replace(/^\s+|\s+$/g, '');
        if (!t) throw problem(fill(TEXT.empty, { name: name }));
        if (t.length > TEXT_CHARS) throw problem(fill(TEXT.textTooLong, { name: name }));
        rec.text = t;
      }, function () { throw problem(fill(TEXT.notText, { name: name })); });
    }
    return work.then(function () { held[id] = file; return rec; });
  }
  function fileOf(rec) { return rec && own(held, rec.id) ? held[rec.id] : null; }
  /* What the dash brain's server is sent for a message's chips: numbered in the order shown, the picture's
     thumbnail (as the editor's chat already sends pictures), a text file's words; a PDF only by name and size
     (Create Event's Generate from a brief reads it, after the person confirms). */
  function wireAttachments(recs) {
    var out = [];
    (isArr(recs) ? recs : []).slice(0, MAX_FILES).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var kind = r.wire === 'pdf' || r.wire === 'text' ? r.wire : r.kind === 'image' ? 'image' : '';
      if (!kind) return;
      var a = { n: out.length + 1, kind: kind, name: cleanName(r.name), type: str(r.type), size: +r.size || 0 };
      if (kind === 'image') {
        a.w = +r.w || 0; a.h = +r.h || 0;
        if (/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(str(r.thumb))) a.thumb = r.thumb;
      }
      if (kind === 'text' && typeof r.text === 'string') a.text = r.text.slice(0, TEXT_CHARS);
      out.push(a);
    });
    return out;
  }
  /* '' when Create Event's own box takes this file (its type and size), else the sentence why it is not carried */
  function carryCheck(role, rec) {
    var name = cleanName(rec && rec.name), size = +(rec && rec.size) || 0, t = str(rec && rec.type);
    if (role === 'logo') return rec && rec.kind === 'image' && own(LOGO_TYPES, t) && size > 0 && size <= LOGO_MAX ? '' : fill(TEXT.logoNot, { name: name });
    if (role === 'brief') return rec && rec.wire === 'pdf' && size > 0 && size <= PDF_MAX ? '' : fill(TEXT.briefNot, { name: name });
    return 'none';
  }

  /* ================================================================ files kept for another page (IndexedDB) */
  var loading = {};
  /* a script this page does not load itself, from this site, once */
  function loadScript(src, isReady) {
    if (isReady()) return Promise.resolve(true);
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (resolve) {
      if (!doc || !isFn(doc.createElement)) { resolve(false); return; }
      var done = false;
      function end(ok) { if (done) return; done = true; if (!ok) delete loading[src]; resolve(ok); }
      var s = doc.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { end(!!isReady()); };
      s.onerror = function () { end(false); };
      /* a script that never answers is given up, so nothing waits on it for ever */
      root.setTimeout(function () { end(!!isReady()); }, SCRIPT_WAIT_MS);
      try { (doc.head || doc.documentElement || doc.body).appendChild(s); } catch (e) { end(false); }
    });
    return loading[src];
  }
  function storeApi() {
    var S = root.RevampStore;
    return S && isFn(S.get) && isFn(S.put) && isFn(S.remove) ? S : null;
  }
  function ensureStore() {
    return loadScript('/editor-store.js', function () { return !!storeApi(); }).then(function () { return storeApi(); });
  }
  function ensurePortals() {
    return loadScript('/portal-picker.js', function () { return !!(root.RevampPortals && isFn(root.RevampPortals.setWorking)); });
  }
  /* The index of what is kept under one prefix ({ v:1, keys: { id: at } }): anything older than ten minutes is
     removed whenever something is added or taken, so a file nobody came for never stays. */
  function sweepIndex(S, indexKey, prefix, t, add) {
    return Promise.resolve(S.get(indexKey)).then(null, function () { return null; }).then(function (ix) {
      var keys = ix && typeof ix === 'object' && ix.keys && typeof ix.keys === 'object' ? ix.keys : {};
      var keep = {}, gone = [];
      Object.keys(keys).forEach(function (k) {
        var at = +keys[k];
        if (isFinite(at) && t - at <= KEEP_MS && at - t <= 60000) keep[k] = at; else gone.push(k);
      });
      if (add) keep[add] = t;
      return Promise.all(gone.map(function (k) { return Promise.resolve(S.remove(prefix + k)).then(null, function () { return null; }); }))
        .then(function () { return S.put(indexKey, { v: 1, keys: keep }); });
    });
  }
  function keptFile(rec, role, n) {
    var f = fileOf(rec);
    if (!f) return null;
    var o = { name: cleanName(rec.name), type: str(rec.type || f.type), size: +f.size || +rec.size || 0, blob: f };
    if (role) { o.role = role; o.n = +n || 0; }
    return o;
  }
  /* A new event's logo and brief file, for Create Event (create-event-prefill.js takeFiles reads them once).
     items: [{ rec, role: 'logo'|'brief', n }]. Resolves true once kept, false when nothing could be. */
  function handoffFiles(prefillId, items) {
    if (!ID_RE.test(str(prefillId))) return Promise.resolve(false);
    var files = [];
    (isArr(items) ? items : []).forEach(function (it) {
      if (!it || (it.role !== 'logo' && it.role !== 'brief') || carryCheck(it.role, it.rec)) return;
      var k = keptFile(it.rec, it.role, it.n);
      if (k) files.push(k);
    });
    if (!files.length) return Promise.resolve(false);
    var t = now();
    return ensureStore().then(function (S) {
      if (!S) return false;
      return Promise.resolve(S.put(HANDOFF_PREFIX + prefillId, { v: 1, at: t, files: files }))
        .then(function () { return sweepIndex(S, HANDOFF_INDEX, HANDOFF_PREFIX, t, prefillId); })
        .then(function () { return true; });
    }).then(null, function (err) { warn('the files for Create Event could not be kept: ' + (err && err.message)); return false; });
  }
  function randomKey() {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', s = '';
    for (var i = 0; i < 16; i++) s += a.charAt(Math.floor(Math.random() * a.length));
    return s;
  }
  /* Pictures attached on another page of this event, for its site editor: the files in IndexedDB, and a pointer
     (with the words) in localStorage, both for ten minutes. The editor takes them once (takeCarry) and puts them in
     its own tray, uploaded through its own path, with the words in the box, unsent. */
  function carry(eventId, recs, text) {
    if (!EVENT_ID.test(str(eventId))) return Promise.resolve(false);
    var files = [];
    (isArr(recs) ? recs : []).forEach(function (r) { if (r && r.kind === 'image') { var k = keptFile(r); if (k) files.push(k); } });
    if (!files.length) return Promise.resolve(false);
    var key = randomKey(), t = now(), words = str(text).slice(0, TEXT_CHARS);
    setItem('localStorage', CARRY_POINTER + eventId, JSON.stringify({ key: key, text: words, at: t, n: files.length }));
    return ensureStore().then(function (S) {
      if (!S) return false;
      return Promise.resolve(S.put(CARRY_PREFIX + eventId + ':' + key, { v: 1, at: t, text: words, files: files }))
        .then(function () { return sweepIndex(S, CARRY_INDEX, CARRY_PREFIX, t, eventId + ':' + key); })
        .then(function () { return true; });
    }).then(null, function (err) { warn('the pictures for the site editor could not be kept: ' + (err && err.message)); return false; });
  }
  function toFile(blob, name, type) {
    if (!blob) return null;
    try { if (isFn(root.File)) return new root.File([blob], name, { type: type || blob.type || '' }); } catch (e) { /* an old browser */ }
    try { blob.name = name; } catch (e) { /* a read-only Blob */ }
    return blob;
  }
  /* The editor's side of carry(): { text, files: [File], expected } once, or null (none, or older than ten minutes).
     expected is how many pictures were sent, so the editor can say when fewer arrived. */
  function takeCarry(eventId, nowMs) {
    if (!EVENT_ID.test(str(eventId))) return Promise.resolve(null);
    var t = typeof nowMs === 'number' ? nowMs : now();
    var raw = getItem('localStorage', CARRY_POINTER + eventId);
    removeItem('localStorage', CARRY_POINTER + eventId);
    var p = null;
    try { p = raw ? JSON.parse(raw) : null; } catch (e) { p = null; }
    if (!p || typeof p !== 'object' || !/^[A-Za-z0-9]{16}$/.test(str(p.key)) || !(t - (+p.at) <= KEEP_MS) || (+p.at) - t > 60000) return Promise.resolve(null);
    var out = { text: str(p.text).slice(0, TEXT_CHARS), files: [], expected: Math.max(0, Math.min(MAX_FILES, +p.n || 0)) };
    var key = CARRY_PREFIX + eventId + ':' + p.key;
    return ensureStore().then(function (S) {
      if (!S) return out;
      return Promise.resolve(S.get(key)).then(function (rec) {
        return Promise.resolve(S.remove(key)).then(null, function () { return null; }).then(function () {
          return sweepIndex(S, CARRY_INDEX, CARRY_PREFIX, t, '').then(null, function () { return null; });
        }).then(function () {
          var files = rec && typeof rec === 'object' && isArr(rec.files) && t - (+rec.at) <= KEEP_MS ? rec.files : [];
          files.slice(0, MAX_FILES).forEach(function (f) {
            var c = f && classify({ type: f.type, name: f.name });
            if (!f || !f.blob || !c || c.kind !== 'image' || +f.size > IMAGE_MAX) return;
            out.files.push(toFile(f.blob, cleanName(f.name), c.type));
          });
          return out;
        });
      });
    }).then(null, function () { return out; });
  }

  /* ================================================================ Create Event: the files go into the page's own boxes */
  /* When create-event-prefill.js has filled the new draft it says so (revamp:prefill-applied). The logo and the
     brief file kept on the dashboard are then put into Create Event's own inputs (#f-logo, #gb-doc) as if chosen
     there, once the form showing them is on screen: the page's own checks and messages run, and nothing is
     generated or created until the person presses Generate or creates the event. */
  var pendingSay = [];
  function say(text) {
    if (chatRef && isFn(chatRef.ai)) { try { chatRef.ai(text, {}); return; } catch (e) { /* drawn later */ } }
    pendingSay.push(text);
  }
  function visible(el) {
    if (!el) return false;
    try { return isFn(el.getClientRects) ? el.getClientRects().length > 0 : !el.hidden; } catch (e) { return false; }
  }
  function whenInput(role, fn) {
    var spec = CE_INPUTS[role], tries = Math.ceil(INPUT_WAIT_MS / POLL_MS);
    (function look() {
      var input = doc && doc.getElementById(spec.input), box = doc && doc.getElementById(spec.box);
      if (input && isFn(input.onchange) && visible(box)) { fn(input); return; }
      if (--tries < 0) return;
      root.setTimeout(look, POLL_MS);
    })();
  }
  function changeEvent() {
    try { return new root.Event('change', { bubbles: true }); } catch (e) { /* an old browser */ }
    var ev = doc.createEvent('HTMLEvents');
    ev.initEvent('change', true, false);
    return ev;
  }
  function putIntoInput(input, f) {
    var where = f.role === 'logo' ? TEXT.whereLogo : TEXT.whereBrief;
    var file = toFile(f.blob, f.name, f.type);
    if (!file || !isFn(root.DataTransfer)) { say(fill(TEXT.noDataTransfer, { name: f.name, where: where })); return; }
    try {
      var dt = new root.DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(changeEvent());
    } catch (e) { say(fill(TEXT.noDataTransfer, { name: f.name, where: where })); }
  }
  function deliverFiles(id, meta) {
    var P = root.RevampPrefill;
    ensureStore().then(function (S) {
      return S && P && isFn(P.takeFiles) ? P.takeFiles(S, id) : null;
    }).then(null, function () { return null; }).then(function (got) {
      var files = got && isArr(got.files) ? got.files : [], refusedNow = got && isArr(got.refused) ? got.refused : [];
      meta.forEach(function (m) {
        var f = null, r = null, i;
        for (i = 0; i < files.length; i++) if (files[i].role === m.role) { f = files[i]; break; }
        for (i = 0; i < refusedNow.length; i++) if (refusedNow[i] && refusedNow[i].role === m.role) { r = refusedNow[i]; break; }
        /* the file came but is not what the box takes (checked again here, by the file itself): said, never put in */
        if (!f && r) { say(fill(m.role === 'logo' ? TEXT.refusedLogo : TEXT.refusedBrief, { name: cleanName(r.name) })); return; }
        if (!f) { say(fill(TEXT.lostFile, { name: cleanName(m.name), where: m.role === 'logo' ? TEXT.whereLogo : TEXT.whereBrief })); return; }
        whenInput(m.role, function (input) { putIntoInput(input, f); });
      });
    });
  }
  var prefillSeen = {};
  /* d: { id, files: [{ role, name }] }, as create-event-prefill.js said it (its event, or lastApplied()). Each id is
     taken once, however it arrives. */
  function takePrefillFiles(d) {
    d = d && typeof d === 'object' ? d : null;
    if (!d || !ID_RE.test(str(d.id)) || own(prefillSeen, d.id)) return;
    var meta = (isArr(d.files) ? d.files : []).filter(function (m) { return m && (m.role === 'logo' || m.role === 'brief'); });
    if (!meta.length) return;
    prefillSeen[d.id] = 1;
    /* the page fills its form after apply() returns: the boxes are looked for from the next turn on */
    root.setTimeout(function () { deliverFiles(d.id, meta); }, 0);
  }
  function onPrefillApplied(e) { takePrefillFiles(e && e.detail); }
  /* On a normal load Create Event fills its draft (and says which files came) as soon as the page has loaded, which
     is before this shell has heard back from the sign-in check: what it said is read first, then anything later
     (a draft question answered after this point) is listened for. */
  function listenForPrefill() {
    var P = root.RevampPrefill;
    if (P && isFn(P.lastApplied)) { try { takePrefillFiles(P.lastApplied()); } catch (e) { warn('the files for Create Event could not be read: ' + (e && e.message)); } }
    if (isFn(root.addEventListener)) root.addEventListener('revamp:prefill-applied', onPrefillApplied);
  }

  /* ================================================================ the shell */
  var brains = {};
  var adapter = null;
  var chatRef = null;
  var mounted = false, refused = false, mounting = false;
  var mountEl = null, pagePlace = null;
  var openListeners = [];
  var wantOpen = false;
  var readyWaiters = [];
  var activeBrain = null;
  var editorTimer = null;

  function settleReady(v) {
    var w = readyWaiters;
    readyWaiters = [];
    w.forEach(function (fn) { try { fn(v); } catch (e) { /* a waiter's own trouble */ } });
  }
  function place() {
    if (!pagePlace) return { page: '', eventId: '', tab: '' };
    var p = readPlace(pagePlace.page, root.location);
    return { page: pagePlace.page, eventId: pagePlace.eventId, tab: p ? p.tab : '' };
  }
  function registerBrain(name, brain) {
    if ((name !== 'dash' && name !== 'edit') || !brain || !isFn(brain.send)) return false;
    brains[name] = brain;
    if (chatRef && isFn(brain.onMount)) { try { brain.onMount(chatRef); } catch (e) { warn('a brain could not start: ' + (e && e.message)); } }
    return true;
  }
  function registerPlace(a) {
    /* once a panel is up without it (the editor was not ready in time) it stays as it said: reload to edit */
    if (!a || typeof a !== 'object' || adapter || mounted) return false;
    adapter = a;
    /* the editor has opened its site: the panel can come now */
    if (pagePlace && pagePlace.page === 'editor' && authOk && !mounted) mountNow();
    return true;
  }
  function me(p) {
    var who = {};
    try {
      if (p.page === 'dashboard' && root.RvListing && isFn(root.RvListing.me)) who = root.RvListing.me() || {};
      else {
        var u = root.RevampAuth && isFn(root.RevampAuth.currentUser) ? root.RevampAuth.currentUser() : null;
        who = u ? { name: u.displayName || '', email: u.email || '' } : {};
      }
    } catch (e) { who = {}; }
    return who;
  }
  function firstName(name) {
    var n = str(name).replace(/^\s+|\s+$/g, '').split(/\s+/)[0] || '';
    return n.length > 40 ? '' : n;
  }
  /* "Email Customer Care": the dashboard's own help window there, a mail to Customer Care elsewhere */
  function mailHelp(p) {
    var href = 'mailto:' + HELP_EMAIL + '?subject=' + encodeURIComponent(TEXT.helpSubject + (PAGE_LABELS[p.page] || 'a page'));
    return { label: TEXT.helpLabel, href: href, onClick: function () {
      try {
        var a = doc.createElement('a');
        a.href = href;
        a.rel = 'noopener';
        a.style.display = 'none';
        (doc.body || doc.documentElement).appendChild(a);
        a.click();
        a.parentNode.removeChild(a);
      } catch (e) { warn('the mail could not be opened'); }
    } };
  }
  function scopeText(p) { return p.eventId ? TEXT.scopeEvent : TEXT.scopeGlobal; }
  function setScope(text) { if (chatRef && isFn(chatRef.setScope)) { try { chatRef.setScope(text); } catch (e) { /* the line is a nicety */ } } }
  function setScopeEvent(ev) {
    var name = ev && typeof ev === 'object' ? oneLine(ev.name, 80) : '';
    if (name) setScope(fill(TEXT.scopeEventNamed, { name: name }));
  }
  function tellOpen(v) {
    openListeners.forEach(function (fn) { try { fn(!!v); } catch (e) { /* a listener's own trouble */ } });
  }
  function isHandoff(r) { return !!r && typeof r === 'object' && (r.handoff === true || r.kind === 'handoff'); }
  /* When each brain last made a change in this panel that Undo can still take back (0: none). A brain may say so
     itself (changedAt); for the editor's brain, until it does, the shell counts the page changes it answered with
     and takes one off for each undo (its own "undo" answer, or one passed on from here). */
  var editChanges = [], lastAnswered = '';
  function noteAnswer(name, r) {
    if (!r || typeof r !== 'object' || isHandoff(r)) return;
    lastAnswered = name;
    if (name !== 'edit') return;
    if (r.kind === 'edit' && (r.status === 'applied' || r.status === 'partly')) editChanges.push(now());
    else if (r.kind === 'undo' && r.status === 'undone') editChanges.pop();
  }
  function changedAt(name) {
    var b = brains[name];
    if (b && isFn(b.changedAt)) { try { return +b.changedAt() || 0; } catch (e) { return 0; } }
    return name === 'edit' && editChanges.length ? editChanges[editChanges.length - 1] : 0;
  }
  /* "undo that" goes to the brain whose change in this panel is the newest: after "switch to ETAuto" it switches
     back, rather than taking away an older page change. With no change of the dash brain here, it is the editor's
     (its newest change still on the page, as before). */
  function undoBy() {
    var d = brains.dash, e = brains.edit, dAt = changedAt('dash'), eAt = changedAt('edit');
    /* two changes stamped with the same millisecond (only a test is that quick): the one that answered last is newer */
    if (d && isFn(d.undoLocal) && dAt && (dAt > eAt || (dAt === eAt && lastAnswered === 'dash'))) return 'dash';
    return e && isFn(e.undoLocal) ? 'edit' : '';
  }
  function undoWith(name, text, o) {
    var b = brains[name];
    activeBrain = b;
    var p;
    try { p = Promise.resolve(b.undoLocal(text, o)); } catch (e) { return Promise.reject(e); }
    return p.then(function (r) {
      if (name === 'edit' && r && r.ok) editChanges.pop();
      return r;
    });
  }
  function callBrain(name, text, o, handedFrom) {
    var b = brains[name];
    activeBrain = b;
    var opts = { attachments: o.attachments || [], context: o.context || null, place: place() };
    if (handedFrom) opts.handedFrom = handedFrom;
    var p;
    try { p = b.send(text, opts); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (r) { noteAnswer(name, r); return r; });
  }
  /* One message from the panel: in the editor the rule picks the brain, elsewhere the dash brain answers. A brain
     that answers "handoff" passes the message to the other once; the other may not hand it back. */
  /* The editor's brain answers only in the editor, and only once the editor has said it is ready (registerPlace);
     a page where only it is there (no dash brain) has nothing else to ask. */
  function canEdit() {
    return !!brains.edit && !!pagePlace && pagePlace.page === 'editor' && (!!adapter || !brains.dash);
  }
  function usable(name) { return name === 'dash' ? !!brains.dash : canEdit(); }
  function send(text, o) {
    o = o || {};
    var p = place();
    var which = brains.dash ? 'dash' : 'edit';
    if (canEdit()) {
      try { which = adapter && isFn(adapter.route) ? adapter.route(text, o.attachments || [], p) : route(text, o.attachments || [], p); } catch (e) { which = 'edit'; }
      if (which !== 'undo' && which !== 'ask' && which !== 'dash') which = 'edit';
      if (which === 'dash' && !brains.dash) which = 'edit';
      /* a bare "go back": undo, or another page? Asked in one line, with no AI call and nothing undone */
      if (which === 'ask') { if (chatRef) chatRef.ai(TEXT.goBackWhich, {}); return Promise.resolve({ kind: 'ask' }); }
      if (which === 'undo') {
        var by = undoBy();
        if (by) return undoWith(by, text, o);
        which = 'edit';
      }
    }
    if (!usable(which)) return Promise.reject(problem(fill(TEXT.noAnswer, { unchanged: p.page === 'editor' ? TEXT.pageUnchanged : TEXT.unchanged })));
    return callBrain(which, text, o, '').then(function (r) {
      if (!isHandoff(r)) return r;
      var other = which === 'edit' ? 'dash' : 'edit';
      /* the other brain is not here (the editor is not ready): one plain sentence, no second hop */
      if (!usable(other)) { if (chatRef) chatRef.ai(TEXT.cantTell, {}); return r; }
      return callBrain(other, text, o, which).then(function (r2) {
        if (isHandoff(r2) && chatRef) chatRef.ai(TEXT.cantTell, {});
        return r2;
      });
    });
  }
  function stop() {
    var b = activeBrain;
    if (b && isFn(b.stop)) { try { b.stop(); } catch (e) { /* nothing more to stop */ } }
  }

  /* ---------- the conversation shown on the first open ---------- */
  /* the site editor's change, shown where its Undo is not (the checkpoints are the editor's): plain lines */
  var EDIT_LINES = { applied: 'Done in the site editor.', partly: 'Partly done in the site editor.', failed: 'This change could not be applied.',
    undone: 'Done in the site editor, then undone.', applying: 'This change was still being applied when the editor was closed.',
    stopped: 'Stopped — nothing on the page changed.' };
  function plainEditReplay(t, w) {
    var at = t.at || null;
    var line = own(EDIT_LINES, t.status) ? EDIT_LINES[t.status] : '';
    if (t.question) w.user(str(t.question), { at: at });
    var said = str(t.answer).replace(/^\s+|\s+$/g, '');
    var b = w.ai(said || line || ' ', { at: at });
    (isArr(t.done) ? t.done : []).slice(0, 12).forEach(function (d) { if (typeof d === 'string' && d) b.note('Done: ' + oneLine(d, 200)); });
    (isArr(t.notDone) ? t.notDone : []).slice(0, 12).forEach(function (d) { if (typeof d === 'string' && d) b.note('Not done: ' + oneLine(d, 200)); });
    if (line && said) b.note(line);
  }
  function replayTurn(t, w) {
    t = t && typeof t === 'object' ? t : {};
    var name = t.brain === 'dash' ? 'dash' : 'edit';
    var b = brains[name];
    if (b && isFn(b.replay) && b.replay(t, w) !== false) return;
    if (name === 'edit') plainEditReplay(t, w);
  }
  function api(url, method) {
    var auth = root.RevampAuth;
    if (!auth || !isFn(auth.authedFetch)) return Promise.reject({ status: 401 });
    return auth.authedFetch(url, { method: method, headers: { 'Accept': 'application/json' } }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
        return { ok: !!res.ok, status: res.status, body: data };
      });
    });
  }
  /* Inside an event: the event's own ETB2B AI conversation, both brains' turns in order. The editor may replay it
     itself (its changes come back with their Undo); elsewhere each turn goes to the brain that answered it, and
     an editor change with no editor here is shown as plain lines. */
  function loadEventHistory(p, writer) {
    var w = {
      divider: writer.divider, user: writer.user, ai: writer.ai, custom: writer.custom,
      event: setScopeEvent,
      other: function (t) { var d = brains.dash; return d && isFn(d.replay) ? d.replay(t, w) : false; }
    };
    if (canEdit() && isFn(brains.edit.loadHistory)) return brains.edit.loadHistory(w);
    return api('/api/chat/history?eventId=' + encodeURIComponent(p.eventId), 'GET').then(function (r) {
      if (!r.ok || !r.body || !isArr(r.body.turns)) throw new Error(TEXT.historyFailed + ' (' + r.status + ').');
      setScopeEvent(r.body.event);
      var turns = r.body.turns;
      if (!turns.length) return 0;
      w.divider(TEXT.earlier);
      turns.forEach(function (t) { try { replayTurn(t, w); } catch (e) { /* one odd old turn never hides the rest */ } });
      w.divider(TEXT.now);
      return turns.length;
    });
  }
  function historyFor(p) {
    return function (writer) {
      writer = writer || chatRef;
      if (p.eventId) return loadEventHistory(p, writer);
      var d = brains.dash;
      return d && isFn(d.loadHistory) ? d.loadHistory(writer) : null;
    };
  }

  /* ---------- the kit's options for this place ---------- */
  function attachFor(p) {
    if (adapter && adapter.attach && typeof adapter.attach === 'object') return adapter.attach;
    var pol = policyFor(p);
    return { accept: pol.accept, max: pol.max, numbered: false, label: pol.label, hint: pol.hint,
      add: function (file) { return prepare(file, pol); },
      /* the person took the chip away (its ×): its file is let go too */
      remove: function (rec) { if (rec && own(held, rec.id)) delete held[rec.id]; } };
  }
  function kitOptions(p, startOpen, dashOnlyEditor) {
    var who = me(p), first = firstName(who.name);
    var dash = brains.dash;
    var w = {};
    try { w = dash && isFn(dash.welcome) ? dash.welcome(p, who) || {} : {}; } catch (e) { w = {}; }
    var heading = first ? 'Hi ' + first + ', I’m ETB2B AI.' : 'Hi, I’m ETB2B AI.';
    var text = str(w.text);
    var suggestions = isArr(w.suggestions) ? w.suggestions : [];
    var quickIdeas = isArr(w.quickIdeas) ? w.quickIdeas : [];
    var footNote = str(w.footNote);
    if (adapter) {
      var aw = adapter.welcome;
      try { if (isFn(aw)) aw = aw(who, p); } catch (e) { aw = null; }
      if (aw && typeof aw === 'object') { if (aw.heading) heading = str(aw.heading); if (aw.text) text = str(aw.text); }
      else if (typeof aw === 'string' && aw) text = aw;
      if (isArr(adapter.suggestions)) suggestions = adapter.suggestions;
      if (isArr(adapter.quickIdeas)) quickIdeas = adapter.quickIdeas;
      if (typeof adapter.footNote === 'string') footNote = adapter.footNote;
    }
    if (dashOnlyEditor) text = TEXT.editorMissing + text;
    var help = null;
    try { help = dash && isFn(dash.help) ? dash.help(p) : null; } catch (e) { help = null; }
    if (!help) help = mailHelp(p);
    var o = {
      id: p.page === 'dashboard' ? 'dash' : 'ai',
      title: 'ETB2B AI',
      launcherLabel: 'Ask ETB2B AI',
      placeholder: 'Ask ETB2B AI…',
      welcome: { heading: heading, text: text },
      suggestions: suggestions,
      quickIdeas: quickIdeas,
      footNote: footNote,
      help: help,
      scope: scopeText(p),
      placement: { right: 22, bottom: 22, compact: false },
      keepClear: mountEl ? str(mountEl.getAttribute('data-keep-clear')) : '',
      zIndex: { launcher: 65, panel: 69 },
      attach: attachFor(p),
      send: send,
      loadHistory: historyFor(p),
      onOpenChange: tellOpen,
      startOpen: startOpen
    };
    if (adapter) {
      ['dock', 'phoneSheet', 'phoneQuery', 'wrapAttrs'].forEach(function (k) { if (adapter[k] != null) o[k] = adapter[k]; });
    }
    return o;
  }
  function wireContext() {
    var c = adapter && adapter.context;
    if (!c || !chatRef || !isFn(chatRef.setContext) || !isFn(c.current)) return;
    function sync() {
      var now0 = null;
      try { now0 = c.current(); } catch (e) { now0 = null; }
      try {
        chatRef.setContext(now0 && now0.label ? { label: str(now0.label), title: str(now0.title), onClear: function () { if (isFn(c.clear)) c.clear(); } } : null);
      } catch (e) { /* the chip is a nicety */ }
    }
    if (isFn(c.onChange)) { try { c.onChange(sync); } catch (e) { /* follows on the next mount */ } }
    sync();
  }
  function mountNow(dashOnlyEditor) {
    if (mounted || refused || mounting) return chatRef;
    var kit = root.RevampChat;
    var p = place();
    if (!mountEl || !kit || !isFn(kit.mount) || (!brains.dash && !brains.edit)) { refused = true; settleReady(null); return null; }
    if (editorTimer) { root.clearTimeout(editorTimer); editorTimer = null; }
    mounting = true;
    var key = OPEN_PREFIX + p.page;
    var startOpen = getItem('sessionStorage', key) === '1' || wantOpen;
    removeItem('sessionStorage', key);
    try { chatRef = kit.mount(mountEl, kitOptions(p, startOpen, !!dashOnlyEditor)) || null; } catch (e) {
      chatRef = null;
      warn('could not start: ' + (e && e.message));
    }
    mounting = false;
    mounted = !!chatRef;
    if (!chatRef) { refused = true; settleReady(null); return null; }
    ['dash', 'edit'].forEach(function (n) {
      var b = brains[n];
      if (b && isFn(b.onMount)) { try { b.onMount(chatRef); } catch (e) { warn('a brain could not start: ' + (e && e.message)); } }
    });
    if (adapter && isFn(adapter.onMount)) { try { adapter.onMount(chatRef); } catch (e) { warn('the page could not start the panel: ' + (e && e.message)); } }
    wireContext();
    var said = pendingSay;
    pendingSay = [];
    said.forEach(say);
    settleReady(chatRef);
    return chatRef;
  }

  /* ---------- start: after the sign-in check, on a page that carries the mount ---------- */
  var authOk = false;
  function whenEditorReady() {
    var tries = Math.ceil(EDITOR_WAIT_MS / POLL_MS);
    (function look() {
      if (mounted || refused) return;
      if (adapter) { mountNow(); return; }
      var failedLoad = false;
      try { failedLoad = !!(doc.body && doc.body.classList && doc.body.classList.contains('ed-load-failed')); } catch (e) { failedLoad = false; }
      /* the editor never said it is ready: the panel still answers questions, and says why it cannot edit */
      if (failedLoad || --tries < 0) { mountNow(true); return; }
      editorTimer = root.setTimeout(look, POLL_MS);
    })();
  }
  function afterAuth(signedIn) {
    if (!signedIn) { refused = true; settleReady(null); return; }
    authOk = true;
    var p = place();
    if (p.page === 'create-event') listenForPrefill();
    /* the portal switch off the dashboard goes through the person's working portal (portal-picker.js) */
    if (p.page !== 'dashboard') ensurePortals();
    if (p.page === 'editor') whenEditorReady();
    else mountNow();
  }
  function boot() {
    if (!doc) return;
    mountEl = isFn(doc.querySelector) ? doc.querySelector('[data-rv-assistant]') : null;
    if (!mountEl) { refused = true; settleReady(null); return; }
    var page = str(mountEl.getAttribute('data-rv-assistant'));
    if (!own(PAGE_LABELS, page)) { warn('unknown place "' + page + '": not mounted'); refused = true; settleReady(null); return; }
    if (framed() || forbiddenPath(root.location)) { refused = true; settleReady(null); return; }
    /* The event is read once, here. The conversation shown, the one each message is stored in and what "this event"
       means are then that event's for as long as the panel is up, even when the page rewrites its address (the
       activity log's Event filter does): a message is never stored in another conversation than the one on screen. */
    var first = readPlace(page, root.location);
    pagePlace = { page: page, eventId: first ? first.eventId : '' };
    var auth = root.RevampAuth;
    if (!auth || !isFn(auth.authedFetch)) { refused = true; settleReady(null); return; }
    var done = false;
    function go(known) {
      if (done) return;
      done = true;
      var signedIn = true;
      if (known && isFn(auth.currentUser)) { try { signedIn = !!auth.currentUser(); } catch (e) { signedIn = true; } }
      afterAuth(signedIn);
    }
    if (isFn(auth.whenResolved)) {
      try { auth.whenResolved().then(function () { go(true); }, function () { go(true); }); } catch (e) { go(false); return; }
      root.setTimeout(function () { go(false); }, AUTH_WAIT_MS);
    } else go(false);
  }

  /* Back to this page out of the browser's memory (no reload): reopen the panel if ETB2B AI opened another page */
  if (isFn(root.addEventListener)) {
    root.addEventListener('pageshow', function (e) {
      if (!e || !e.persisted || !chatRef || !pagePlace) return;
      var key = OPEN_PREFIX + pagePlace.page;
      if (getItem('sessionStorage', key) !== '1') return;
      removeItem('sessionStorage', key);
      try { if (!chatRef.isOpen()) chatRef.open(); } catch (x) { /* the panel is gone */ }
    });
  }

  var A = {
    TEXT: TEXT,
    PAGES: Object.keys(PAGE_LABELS),
    place: place,
    registerBrain: registerBrain,
    registerPlace: registerPlace,
    chat: function () { return chatRef; },
    open: function () { if (chatRef) chatRef.open(); else wantOpen = true; },
    close: function () { wantOpen = false; if (chatRef) chatRef.close(); },
    isOpen: function () { try { return !!(chatRef && chatRef.isOpen()); } catch (e) { return false; } },
    focusInput: function () { if (chatRef && isFn(chatRef.focusInput)) chatRef.focusInput(); },
    onOpenChange: function (fn) { if (isFn(fn)) openListeners.push(fn); },
    ready: function () {
      if (mounted) return Promise.resolve(chatRef);
      if (refused) return Promise.resolve(null);
      return new Promise(function (resolve) { readyWaiters.push(resolve); });
    },
    /* a page ETB2B AI opens never skips that page's own guard for unsaved work: the editor's leave() asks in its
       own dialog; elsewhere the browser's own beforeunload question still runs */
    leave: function (url) {
      if (adapter && isFn(adapter.leave)) { try { adapter.leave(url); return; } catch (e) { warn('the page could not be left: ' + (e && e.message)); return; } }
      root.location.assign(url);
    },
    markReopen: function () { if (pagePlace) setItem('sessionStorage', OPEN_PREFIX + pagePlace.page, '1'); },
    say: say,
    stop: stop,
    route: route,
    errorFor: errorFor,
    policyFor: policyFor,
    wireAttachments: wireAttachments,
    fileOf: fileOf,
    carryCheck: carryCheck,
    handoffFiles: handoffFiles,
    carry: carry,
    takeCarry: takeCarry,
    /* pure parts, for functions/lib/etb2b-assistant.test.js */
    _test: { readPlace: readPlace, framed: framed, forbiddenPath: forbiddenPath, checkFile: checkFile, classify: classify, cleanName: cleanName,
      prepare: prepare, dataBytes: dataBytes, mailHelp: mailHelp, POLICIES: POLICIES, UNDO_RE: UNDO_RE, KEEP_MS: KEEP_MS,
      HANDOFF_PREFIX: HANDOFF_PREFIX, HANDOFF_INDEX: HANDOFF_INDEX, CARRY_PREFIX: CARRY_PREFIX, CARRY_INDEX: CARRY_INDEX, CARRY_POINTER: CARRY_POINTER,
      onPrefillApplied: onPrefillApplied, CE_INPUTS: CE_INPUTS }
  };
  root.RevampAssistant = A;

  /* the dash brain (dash-bot-client.js) loads first and waits here; a brain loaded later registers itself */
  if (root.RevampDashBot && root.RevampDashBot.brain) registerBrain('dash', root.RevampDashBot.brain);
  if (doc && doc.readyState === 'loading' && isFn(doc.addEventListener)) doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : this);
