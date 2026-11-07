/* ETB2B EventSphere — one Publish, the same from every page (UX-105).

   The event console's Publish (its top bar, Settings › Visibility, the bar above a Content tab) and the site editor's
   Publish button all come here: RevampCore.openPublishFlow(eventId, opts). It asks the server where the site stands
   (RevampCore.fetchApproval) and then does the one thing that fits:
     not saved yet         says so, with the way to the site editor
     nothing new           says so kindly (a message, not an error)
     already waiting       shows the request: its link, who approves, Copy message — nothing is sent again
     AI not checked yet    sends the person to the site editor's "Check what the AI wrote" (the console cannot tick
                           sections it does not show; going round the check from here is not offered)
     approval needed       asks for a note, sends the request, and shows the link and who to send it to
     approval switched off asks once, then publishes
   Every dialog takes the focus, keeps Tab inside, closes on Escape and gives the focus back (UX-113). The page stays
   where it is: nothing navigates away (the console used to jump to the review page).

   Who approves is named from config/approvals (fetchApproval's approvers): EventSphere sends no e-mail, so the person
   asking is told exactly whom to send the link to, and can copy a ready message (UX-102).

   It also tells the person who asked what became of the last request, on their next visit to the console or the
   editor (UX-103): decisionNotice() decides, paintDecision() draws the line under the page's top bar.

   ES5 on purpose (var, function, promises): it loads as a plain script on pages that are not bundled.
   window.RevampPublishFlow = { open, buttonState, decisionNotice, paintDecision, aiUncheckedOf, _test } and
   RevampCore.openPublishFlow(eventId, opts) = open(eventId, opts).
   opts: from ('console' | 'editor'), name (the event's), opener (focus goes back there; it shows the busy state
   unless busy(on) is given), toast(text, { kind }), onDone(result), onError(err) -> true when the page dealt with
   it, editorUrl (the console: where "Open the site editor" goes), approval (fetchApproval's answer, when the page
   has just read it). */
(function () {
  'use strict';

  if (window.RevampPublishFlow) return;

  /* ============================================================
     PURE HELPERS (tested in node through _test)
     ============================================================ */
  function num(v) { return +v || 0; }
  function lower(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* "3 Nov, 12:24 pm" in the viewer's clock; '' for no date */
  function when(iso) {
    var d = new Date(iso || '');
    if (!iso || isNaN(d.getTime())) return '';
    var h = d.getHours(), m = d.getMinutes();
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'am' : 'pm');
  }
  function listWords(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1];
  }

  /* fetchApproval's answer -> where the site stands for publishing */
  function standing(a) {
    a = a || {};
    var saved = num(a.savedVersion), published = a.published === true;
    return {
      saved: saved, published: published, live: published ? num(a.publishedVersion) : 0,
      pending: a.request && a.request.status === 'pending' ? a.request : null,
      required: a.required !== false
    };
  }

  /* What Publish does now. opts.aiUnchecked: the AI-written sections nobody has checked (the console's; the editor
     asks about them itself before it gets here). -> { kind, version, updates, count }
     kind: 'not-saved' | 'waiting' | 'nothing-new' | 'ai-unchecked' | 'ask' | 'direct' */
  function planOf(a, opts) {
    opts = opts || {};
    var s = standing(a);
    if (!s.saved) return { kind: 'not-saved', version: 0 };
    /* a request already holds the newest save: it is shown, not sent again */
    if (s.required && s.pending && num(s.pending.toVersion) >= s.saved) return { kind: 'waiting', version: num(s.pending.toVersion) };
    if (s.published && s.live === s.saved) return { kind: 'nothing-new', version: s.saved };
    if (num(opts.aiUnchecked) > 0) return { kind: 'ai-unchecked', version: s.saved, count: num(opts.aiUnchecked) };
    return { kind: s.required ? 'ask' : 'direct', version: s.saved, updates: s.required && s.pending ? num(s.pending.toVersion) : 0 };
  }

  /* The Publish button, before anybody presses it (UX-105: "shows its state before the click"). opts.dirty: the site
     editor holds changes not saved yet (Publish saves them first). -> { label, short, title, quiet }; quiet: nothing to
     do (the button is shown as such, aria-disabled, and a press says why) or only something to look at. short: the
     word a phone's top bar shows instead of a label too long for it ("Send…", "Sent"); '' when the label is short. */
  function buttonState(a, opts) {
    opts = opts || {};
    var s = standing(a || {});
    var send = s.required ? 'Send for approval…' : 'Publish…', sendShort = s.required ? 'Send…' : '';
    var sendTitle = s.required ? 'Send the saved site for approval: it goes live once an approver approves it.' : 'Approval is switched off: this makes the saved site live.';
    if (!a) return { label: send, short: sendShort, title: sendTitle, quiet: false };
    if (opts.dirty) return { label: send, short: sendShort, title: 'Saves your changes first. ' + sendTitle, quiet: false };
    var plan = planOf(a, opts);
    if (plan.kind === 'not-saved') return { label: send, short: sendShort, title: 'Save the site in the site editor first: Publish sends the site as it was last saved.', quiet: false };
    if (plan.kind === 'nothing-new') return { label: 'Live', short: '', title: 'The live site already shows the last save: there is nothing new to publish.', quiet: true };
    if (plan.kind === 'waiting') return { label: 'Sent for approval', short: 'Sent', title: 'Version ' + plan.version + ' is waiting for approval. Open this for its link and who approves.', quiet: true };
    if (plan.kind === 'ai-unchecked') return { label: send, short: sendShort, title: plan.count + (plan.count === 1 ? ' section the AI wrote has' : ' sections the AI wrote have') + ' not been checked yet: the site editor asks about ' + (plan.count === 1 ? 'it' : 'them') + ' first.', quiet: false };
    if (plan.updates) return { label: send, short: sendShort, title: 'Adds the newer saves to the request waiting for approval (version ' + plan.updates + ').', quiet: false };
    return { label: send, short: sendShort, title: sendTitle, quiet: false };
  }

  /* Who to send the request to, from config/approvals: { to, line, alone }. Nobody approves their own changes unless
     allowSelf is on, so the person asking is never told to send it to themselves. */
  function approverWords(a) {
    a = a || {};
    var me = lower(a.me);
    var list = (Array.isArray(a.approvers) ? a.approvers : []).map(lower).filter(Boolean);
    var others = a.allowSelf ? list : list.filter(function (e) { return e !== me; });
    if (!list.length) {
      return { to: '', names: [], alone: false, line: a.allowSelf ? 'Anyone on the team can approve it.' : 'Anyone on the team other than you can approve it.' };
    }
    if (!others.length) {
      return { to: '', names: [], alone: true, line: 'You are the only approver, and nobody approves their own changes: another approver has to be added (review page › Who approves).' };
    }
    return { to: others.join(', '), names: others, alone: false, line: 'Send the link to ' + listWords(others) + (others.length > 1 ? ': any of them can approve it.' : ': they approve changes.') };
  }

  /* the message "Copy message" puts on the clipboard, ready to paste into a chat or an e-mail */
  function copyMessage(name, version, link) {
    return 'Please review the changes to ' + (String(name || '').trim() || 'our event site') + (version ? ' (version ' + version + ')' : '') + ' before they go live: ' + link;
  }

  /* What became of the newest request, for the person who asked (UX-103), or null:
     a rejection while nothing newer has been sent and the live site is not past it; an approval for a week after
     it, while that version is still the one live. Never to the person who decided, never once dismissed
     (opts.seen(id)). -> { id, tone ('bad' | 'ok'), title, text, href, link } */
  var APPROVED_FOR_MS = 7 * 24 * 3600 * 1000;
  function decisionNotice(a, opts) {
    opts = opts || {};
    a = a || {};
    if (a.request && a.request.status === 'pending') return null;
    var last = Array.isArray(a.requests) ? a.requests[0] : null;
    if (!last || !last.id || (last.status !== 'rejected' && last.status !== 'approved')) return null;
    var me = lower(opts.me != null ? opts.me : a.me);
    if (me && lower(last.decidedBy) === me) return null;
    if (typeof opts.seen === 'function' && opts.seen(String(last.id))) return null;
    var who = String(last.decidedBy || '').trim() || 'An approver', v = num(last.toVersion), note = String(last.decisionNote || '').trim();
    var eventId = String(opts.eventId || a.eventId || '');
    var live = a.published === true ? num(a.publishedVersion) : 0;
    if (last.status === 'rejected') {
      if (live && live >= v) return null;
      return {
        id: String(last.id), tone: 'bad', title: who + ' rejected version ' + v + (note ? ':' : '.'),
        text: (note ? '“' + note + '” ' : '') + 'Change what is asked, save, and send it for approval again.',
        href: '/review.html?event=' + encodeURIComponent(eventId) + '&request=' + encodeURIComponent(last.id), link: 'Open the review'
      };
    }
    var at = Date.parse(last.decidedAt || ''), now = opts.now != null ? +opts.now : Date.now();
    if (!(at > 0) || now - at > APPROVED_FOR_MS || live !== v) return null;
    return {
      id: String(last.id), tone: 'ok', title: who + ' approved version ' + v + '.',
      text: 'It is live now.' + (note ? ' Their note: “' + note + '”' : ''),
      href: '/e/' + encodeURIComponent(eventId), link: 'View the live site'
    };
  }

  /* How many sections of a saved editor state are still marked as written by the AI and not checked: the same rule
     as functions/lib/approval-list.js aiUncheckedOf, for a site saved before the server counted them. */
  function openingTag(html) {
    var m = /^\s*<([a-zA-Z][^\s>\/]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(String(html || ''));
    return m ? m[2] : '';
  }
  function hasAttr(attrs, name) { return new RegExp('(^|\\s)' + name + '(?=[\\s=>/]|$)', 'i').test(attrs); }
  function aiUncheckedOf(snapshot) {
    var nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    var n = 0;
    nodes.forEach(function (html) {
      var attrs = openingTag(html);
      if (!attrs || !hasAttr(attrs, 'data-rv-section') || !hasAttr(attrs, 'data-ai-generated')) return;
      var cls = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
      if (cls && /(^|\s)is-hidden-sec(\s|$)/.test(cls[2] != null ? cls[2] : cls[3])) return;
      n++;
    });
    return n;
  }

  /* a refusal from the server -> what the flow does with it: 'nothing-new' | 'not-saved' | 'ask' | 'show' */
  function errorPlan(err) {
    var code = err && err.code;
    if (code === 'nothing-to-publish') return 'nothing-new';
    if (code === 'site-not-saved') return 'not-saved';
    if (code === 'approval-required') return 'ask';
    return 'show';
  }
  /* A failed request in the console's words (UX-008): a request's failure (it has a status) is said by RevampCore.errText,
     so a server fault reads "Something went wrong on our side…", never the server's own sentence; a refusal made in
     the page has no status and is said as it is. */
  function errText(err) {
    var C = window.RevampCore;
    if (err && (typeof err.status === 'number' || err.code === 'revamp/signed-out') && C && typeof C.errText === 'function') return C.errText(err);
    return (err && err.message) || 'Please try again.';
  }

  /* "The site as saved on 3 Nov, 12:24 pm by priya@… (version 7)" — when and who first, the number last (UX-112) */
  function savedLine(a, version) {
    var at = when(a && a.savedAt), by = String((a && a.savedBy) || '').trim();
    return 'The site as saved' + (at ? ' on ' + at : '') + (by ? ' by ' + by : '') + ' (version ' + version + ')';
  }

  /* ============================================================
     THE LOOK — the console's and the editor's own colour tokens (edit-event.css), both themes
     ============================================================ */
  var CSS = [
    '.rvpf-scrim{position:fixed;inset:0;z-index:88;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(20,14,13,.55)}',
    '.rvpf-box{display:flex;flex-direction:column;width:min(520px,calc(100vw - 32px));max-height:min(88vh,760px);background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-lg);overflow:hidden;font-size:14px;line-height:1.5;text-align:left}',
    '.rvpf-box:focus{outline:0}',
    '.rvpf-box :focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.rvpf-head{display:flex;align-items:center;gap:12px;padding:14px 12px 12px 20px;border-bottom:1px solid var(--border)}',
    '.rvpf-head h2{flex:1;min-width:0;margin:0;font-size:16.5px;font-weight:700;color:var(--text)}',
    '.rvpf-x{display:inline-grid;place-items:center;width:40px;height:40px;flex-shrink:0;border:0;border-radius:9px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:22px;line-height:1}',
    '.rvpf-x:hover{background:var(--surface-2);color:var(--text)}',
    '.rvpf-body{display:flex;flex-direction:column;gap:12px;padding:16px 20px 18px;overflow-y:auto}',
    '.rvpf-body p{margin:0}',
    '.rvpf-muted{color:var(--text-muted);font-size:13px}',
    '.rvpf-note{padding:10px 12px;border-radius:10px;background:var(--warn-soft);color:var(--text);font-size:13px}',
    '.rvpf-who{padding:10px 12px;border-radius:10px;background:var(--surface-2);color:var(--text);font-size:13px}',
    '.rvpf-who b{font-weight:700}',
    '.rvpf-field{display:flex;flex-direction:column;gap:6px}',
    '.rvpf-field label{font-size:12.5px;font-weight:700;color:var(--text)}',
    '.rvpf-field textarea{width:100%;box-sizing:border-box;min-height:72px;padding:10px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font:inherit;font-size:13.5px;resize:vertical}',
    '.rvpf-field textarea:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}',
    /* the link: one calm line in the page\'s own text colour, never red monospace (UX-113) */
    '.rvpf-link{display:flex;gap:8px;align-items:stretch}',
    '.rvpf-link input{flex:1;min-width:0;min-height:40px;padding:0 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface-2);color:var(--text);font:inherit;font-size:13px;font-weight:500;text-overflow:ellipsis}',
    '.rvpf-err:empty{display:none}',
    '.rvpf-err{padding:9px 12px;border-radius:9px;border-left:3px solid var(--accent);background:var(--accent-soft);color:var(--text);font-size:13px;font-weight:600}',
    '.rvpf-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;padding:12px 20px 16px;border-top:1px solid var(--border)}',
    '.rvpf-foot .grow{flex:1}',
    '.rvpf-box .btn{min-height:40px}',
    '.rvpf-box a.btn{text-decoration:none;display:inline-flex;align-items:center}',
    '.rvpf-ok{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--ok-soft);color:var(--ok);flex-shrink:0}',
    '@media (max-width:720px){.rvpf-scrim{align-items:flex-end;padding:0}.rvpf-box{width:100%;max-height:92vh;border-radius:16px 16px 0 0;border-bottom:0}}',
    /* the line under the top bar that tells what became of the last request (UX-103) */
    '.rvpf-strip{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;padding:9px 16px;border-bottom:1px solid var(--border);background:var(--surface-2);color:var(--text);font-size:13px;line-height:1.45}',
    '.rvpf-strip[hidden]{display:none}',
    '.rvpf-strip.is-bad{background:var(--accent-soft)}',
    '.rvpf-strip.is-ok{background:var(--ok-soft)}',
    '.rvpf-strip .grow{flex:1 1 260px;min-width:0}',
    '.rvpf-strip b{font-weight:700}',
    '.rvpf-strip a{color:var(--text);font-weight:700}',
    '.rvpf-strip button{border:0;background:transparent;color:var(--text-muted);font:inherit;font-weight:600;cursor:pointer;padding:6px 8px;border-radius:7px}',
    '.rvpf-strip button:hover{background:var(--surface);color:var(--text)}',
    /* in the console it sits at the top of the page\'s content, as a box; in the editor it runs under the top bar */
    '.main > .rvpf-strip{border:1px solid var(--border);border-radius:10px;margin:0 0 16px}',
    /* a Publish button with nothing to do (or only something to look at): it looks it, never like the red call to act,
       and a press says why */
    '.btn[data-rvpf-quiet],.btn[data-rvpf-quiet]:hover{background:var(--surface-2);color:var(--text);border-color:var(--border);box-shadow:none}',
    /* a phone or a narrow window (up to 600 px): "Send for approval…" beside Preview, Share preview, the light/dark switch
       and the account pushed the console 30-100 px sideways and cut the account off, so the button shows its short word
       ("Send…") instead; its name for a screen reader stays the full label (paintButton sets aria-label). While it is
       busy it shows its own "Checking…". 13px is the top bar buttons' own size in the console and the editor. */
    '@media (max-width:600px){.btn[data-rvpf-short]:not([aria-busy]){font-size:0;gap:0;padding-left:12px;padding-right:12px}' +
      '.btn[data-rvpf-short]:not([aria-busy])::after{content:attr(data-rvpf-short);font-size:13px}}'
  ].join('\n');
  function injectCss() {
    if (document.getElementById('rvpf-css')) return;
    var st = document.createElement('style');
    st.id = 'rvpf-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ============================================================
     ONE DIALOG AT A TIME
     ============================================================ */
  var CUR = null;
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function focusables(box) {
    return Array.prototype.filter.call(box.querySelectorAll(FOCUSABLE), function (el) { return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement; });
  }
  /* spec: { title, body (HTML), actions: [{ key, label, kind, href, primary, aside }], opener, focus (selector) }
     -> { box, close(), busy(on, key, label), error(text), on(key, fn), field(selector) } */
  function dialog(spec) {
    if (CUR) CUR.close(true);
    injectCss();
    var opener = spec.opener && spec.opener.focus ? spec.opener : document.activeElement;
    var scrim = document.createElement('div');
    scrim.className = 'rvpf-scrim';
    scrim.innerHTML =
      '<div class="rvpf-box" role="dialog" aria-modal="true" aria-labelledby="rvpf-title" tabindex="-1">' +
        '<div class="rvpf-head"><h2 id="rvpf-title">' + esc(spec.title) + '</h2><button type="button" class="rvpf-x" data-rvpf="close" aria-label="Close">×</button></div>' +
        '<div class="rvpf-body">' + spec.body + '<p class="rvpf-err" role="alert"></p></div>' +
        '<div class="rvpf-foot">' + (spec.actions || []).map(function (a) {
          var cls = 'btn ' + (a.kind === 'primary' ? 'btn-primary' : 'btn-secondary');
          return (a.aside ? '<span class="grow"></span>' : '') + (a.href
            ? '<a class="' + cls + '" data-rvpf="' + esc(a.key) + '" href="' + esc(a.href) + '"' + (a.newTab ? ' target="_blank" rel="noopener"' : '') + '>' + esc(a.label) + '</a>'
            : '<button type="button" class="' + cls + '" data-rvpf="' + esc(a.key) + '">' + esc(a.label) + '</button>');
        }).join('') + '</div>' +
      '</div>';
    var box = scrim.firstChild, handlers = {}, busy = false, closed = false, downOnScrim = false;
    function close(quiet) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      if (CUR === handle) CUR = null;
      if (!quiet && opener && opener.focus && document.body.contains(opener)) { try { opener.focus(); } catch (e) { /* gone meanwhile */ } }
      if (handle.onClose) handle.onClose();
    }
    function onKey(e) {
      if (closed) return;
      /* the page's own shortcuts (the editor's Ctrl+Z, Ctrl+S) never reach past an open dialog */
      e.stopPropagation();
      if (e.key === 'Escape') { if (!busy) close(); e.preventDefault(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables(box);
      if (!f.length) { e.preventDefault(); box.focus(); return; }
      var at = f.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (at === -1 || at === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
    box.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-rvpf]') : null;
      if (!t || busy) return;
      var key = t.getAttribute('data-rvpf');
      if (key === 'close') { close(); return; }
      if (handlers[key]) handlers[key](e);
      else if (!t.getAttribute('href')) close();
    });
    scrim.addEventListener('mousedown', function (e) { downOnScrim = e.target === scrim; });
    scrim.addEventListener('click', function (e) { if (downOnScrim && e.target === scrim && !busy && !spec.keep) close(); downOnScrim = false; });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(scrim);
    var handle = {
      box: box, close: close,
      on: function (key, fn) { handlers[key] = fn; return handle; },
      field: function (sel) { return box.querySelector(sel); },
      error: function (text) { box.querySelector('.rvpf-err').textContent = text || ''; },
      /* while the server works: nothing in the dialog can be used and it cannot be closed; the button says so */
      busy: function (on, key, label) {
        busy = !!on;
        Array.prototype.forEach.call(box.querySelectorAll('button, textarea, input'), function (b) { b.disabled = busy; });
        box.setAttribute('aria-busy', busy ? 'true' : 'false');
        var b = key ? box.querySelector('[data-rvpf="' + key + '"]') : null;
        if (b) {
          if (!b.hasAttribute('data-label')) b.setAttribute('data-label', b.textContent);
          b.textContent = busy ? label : b.getAttribute('data-label');
        }
      }
    };
    CUR = handle;
    var first = spec.focus ? box.querySelector(spec.focus) : null;
    (first || box).focus();
    return handle;
  }

  function copyText(text, box, button, done) {
    function said() { if (button) { button.textContent = done || 'Copied'; setTimeout(function () { if (button.isConnected !== false) button.textContent = button.getAttribute('data-label') || button.textContent; }, 2000); } }
    function fallback() {
      var input = box.querySelector('.rvpf-link input');
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      box.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      box.removeChild(t);
      if (ok) said();
      else if (input) { input.focus(); input.select(); if (button) button.textContent = 'Press Ctrl+C to copy'; }
    }
    if (button && !button.hasAttribute('data-label')) button.setAttribute('data-label', button.textContent);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(said, fallback);
    else fallback();
  }

  /* ============================================================
     THE FLOW
     ============================================================ */
  var RUNNING = null;

  function toastOf(opts) {
    return function (text, kind) { if (typeof opts.toast === 'function') opts.toast(text, { kind: kind || 'info' }); };
  }
  function setBusy(opts, on) {
    if (typeof opts.busy === 'function') { opts.busy(on); return; }
    var b = opts.opener;
    if (!b || !b.setAttribute) return;
    if (on) {
      b.setAttribute('data-rvpf-label', b.textContent);
      b.textContent = 'Checking…';
      /* a button named by its full label (paintButton, for the phone's short word) is named by what it says now */
      if (b.hasAttribute('aria-label')) b.setAttribute('aria-label', 'Checking…');
      b.setAttribute('aria-busy', 'true');
      b.disabled = true;
    } else if (b.hasAttribute('data-rvpf-label')) {
      b.textContent = b.getAttribute('data-rvpf-label');
      if (b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.textContent);
      b.removeAttribute('data-rvpf-label');
      b.removeAttribute('aria-busy');
      b.disabled = false;
    }
  }

  function open(eventId, opts) {
    opts = opts || {};
    eventId = String(eventId || '').trim();
    var C = window.RevampCore;
    if (!eventId || !C) return Promise.resolve({ kind: 'none' });
    if (RUNNING) return RUNNING;            // a second press while the first is being answered
    injectCss();
    var toast = toastOf(opts);
    setBusy(opts, true);
    RUNNING = C.fetchApproval(eventId).then(function (a) {
      var plan = planOf(a);
      /* the console cannot show the sections, so the AI check is the site editor's; it is counted only when there is
         something to send (a site saved before the server counted them is read once to count them) */
      if (opts.from === 'console' && (plan.kind === 'ask' || plan.kind === 'direct')) {
        var known = typeof a.aiUnchecked === 'number' ? Promise.resolve(a.aiUnchecked)
          : C.fetchSite(eventId).then(function (site) { return aiUncheckedOf(site && site.snapshot); }, function () { return 0; });
        return known.then(function (count) { return { a: a, plan: planOf(a, { aiUnchecked: count }) }; });
      }
      return { a: a, plan: plan };
    }).then(function (x) {
      setBusy(opts, false);
      return step(eventId, x.a, x.plan, opts, toast);
    }, function (err) {
      setBusy(opts, false);
      toast('Could not check where the site stands — ' + errText(err), 'error');
      return { kind: 'failed' };
    }).then(function (r) { RUNNING = null; return r; }, function (err) { RUNNING = null; throw err; });
    return RUNNING;
  }

  function step(eventId, a, plan, opts, toast) {
    var name = String(opts.name || a.name || '').trim();
    if (plan.kind === 'nothing-new') {
      toast('Nothing new to publish: the live site already shows the last save (version ' + plan.version + ').', 'info');
      return Promise.resolve({ kind: 'nothing-new' });
    }
    if (plan.kind === 'not-saved') return notSaved(opts);
    if (plan.kind === 'waiting') return waiting(eventId, a, name, opts);
    if (plan.kind === 'ai-unchecked') return aiUnchecked(plan, opts);
    if (plan.kind === 'direct') return direct(eventId, a, plan, opts, toast);
    return ask(eventId, a, plan, name, opts, toast);
  }

  function notSaved(opts) {
    return new Promise(function (done) {
      var url = opts.editorUrl || '';
      var d = dialog({
        title: 'Save the site first', opener: opts.opener,
        body: '<p>Publish sends the site as it was last saved, and this site has not been saved yet.</p>' +
          (url ? '<p class="rvpf-muted">Open it in the site editor, look it over and press Save. Then publish from there or from here.</p>' : ''),
        actions: url ? [{ key: 'cancel', label: 'Not now' }, { key: 'editor', label: 'Open the site editor', kind: 'primary', href: url }] : [{ key: 'cancel', label: 'OK', kind: 'primary' }],
        focus: url ? '[data-rvpf="editor"]' : '[data-rvpf="cancel"]'
      });
      d.onClose = function () { done({ kind: 'not-saved' }); };
    });
  }

  function aiUnchecked(plan, opts) {
    return new Promise(function (done) {
      var url = opts.editorUrl || '';
      var many = plan.count !== 1;
      var d = dialog({
        title: 'Check what the AI wrote first', opener: opts.opener,
        body: '<p>' + plan.count + (many ? ' sections the AI wrote have' : ' section the AI wrote has') + ' not been checked by anyone yet.</p>' +
          '<p class="rvpf-muted">Read ' + (many ? 'them' : 'it') + ' in the site editor: its ' + 'Send for approval' + ' lists ' + (many ? 'each one' : 'it') +
          ' to tick, with a way to see ' + (many ? 'each' : 'it') + ' on the page, and then sends the site on.</p>',
        actions: [{ key: 'cancel', label: 'Not now' }].concat(url ? [{ key: 'editor', label: 'Open the site editor', kind: 'primary', href: url }] : []),
        focus: url ? '[data-rvpf="editor"]' : '[data-rvpf="cancel"]'
      });
      d.onClose = function () { done({ kind: 'ai-unchecked' }); };
    });
  }

  /* who to send it to, in bold, and that nobody else will tell them (UX-102) */
  function whoHtml(a) {
    var w = approverWords(a);
    return '<p class="rvpf-who">' + (w.names.length ? 'Send the link to <b>' + esc(listWords(w.names)) + '</b>' + (w.names.length > 1 ? ': any of them can approve it.' : ': they approve changes.') : esc(w.line)) +
      ' EventSphere does not e-mail approvers, so they only hear of it from you.</p>';
  }

  /* the request, its link and who to send it to: after sending, and for a request already waiting */
  function showRequest(spec, a, name, opts) {
    return new Promise(function (done) {
      var link = spec.link;
      var d = dialog({
        title: spec.title, opener: opts.opener, keep: true,
        body: '<p>' + spec.text + '</p>' + whoHtml(a) +
          '<div class="rvpf-field"><label for="rvpf-url">Review link</label><div class="rvpf-link">' +
            '<input id="rvpf-url" type="text" readonly value="' + esc(link) + '" aria-describedby="rvpf-title">' +
            '<button type="button" class="btn btn-secondary" data-rvpf="copy-link">Copy link</button></div></div>',
        actions: [
          { key: 'copy-message', label: 'Copy message' },
          { key: 'review', label: 'Open review page', href: spec.reviewPath, newTab: true },
          { key: 'done', label: 'Done', kind: 'primary' }
        ],
        focus: '[data-rvpf="done"]'
      });
      d.on('copy-link', function (e) { copyText(link, d.box, e.target.closest('button')); });
      d.on('copy-message', function (e) { copyText(copyMessage(name, spec.version, link), d.box, e.target.closest('button'), 'Message copied'); });
      d.onClose = function () { done(spec.result); };
    });
  }

  function waiting(eventId, a, name, opts) {
    var p = a.request, path = '/review.html?event=' + encodeURIComponent(eventId) + '&request=' + encodeURIComponent(p.id);
    var sent = when(p.updatedAt || p.requestedAt);
    return showRequest({
      title: 'Waiting for approval', version: num(p.toVersion), reviewPath: path, link: location.origin + path,
      text: 'Version ' + num(p.toVersion) + ' was sent for approval' + (p.requestedBy ? ' by ' + esc(p.requestedBy) : '') + (sent ? ' on ' + esc(sent) : '') +
        '. It holds every save so far: there is nothing new to add to it.',
      result: { kind: 'waiting' }
    }, a, name, opts);
  }

  function ask(eventId, a, plan, name, opts, toast) {
    var C = window.RevampCore;
    return new Promise(function (done) {
      var s = standing(a), p = s.pending, outcome = { kind: 'closed' };
      var who = approverWords(a);
      var d = dialog({
        title: 'Send for approval', opener: opts.opener,
        body: '<p>' + esc(savedLine(a, plan.version)) + ' goes live once an approver approves it.' +
            (s.published ? ' Until then the live site stays as it is.' : '') + ' The approver sees every change saved since ' + (s.published ? 'the live version' : 'the start') + ', and who made it.</p>' +
          (plan.updates ? '<p class="rvpf-note">A request' + (p && p.requestedBy ? ' by ' + esc(p.requestedBy) : '') + ' is already waiting (version ' + plan.updates + '). Sending adds the newer saves to it.</p>' : '') +
          '<p class="rvpf-who">' + esc(who.line) + ' You get the link to send once the request is made.</p>' +
          '<div class="rvpf-field"><label for="rvpf-note">Note for the approver (optional)</label>' +
            '<textarea id="rvpf-note" rows="3" maxlength="1000" placeholder="What changed and why"></textarea></div>',
        actions: [{ key: 'cancel', label: 'Cancel' }, { key: 'send', label: 'Send for approval', kind: 'primary' }],
        focus: '#rvpf-note'
      });
      d.onClose = function () { done(outcome); };
      d.on('send', function () {
        d.error('');
        d.busy(true, 'send', 'Sending…');
        C.requestApproval(eventId, d.field('#rvpf-note').value).then(function (r) {
          outcome = { kind: 'sent', request: r };
          if (typeof opts.onDone === 'function') opts.onDone(outcome);
          var path = r.reviewPath, link = r.reviewUrl || (location.origin + path);
          d.onClose = null;
          d.close(true);
          showRequest({
            title: r.updated ? 'Request updated' : 'Sent for approval', version: num(r.toVersion), reviewPath: path, link: link,
            text: 'Version ' + num(r.toVersion) + (r.summary ? ' — ' + esc(r.summary) : '') + '. It goes live once it is approved; the review page lists what changed, who changed it, and shows the live site beside the new one.',
            result: outcome
          }, a, name, opts).then(done);
        }, function (err) {
          d.busy(false, 'send');
          var next = errorPlan(err);
          if (typeof opts.onError === 'function' && opts.onError(err)) { d.close(true); return; }
          if (next === 'nothing-new') { d.close(); toast('Nothing new to publish: the live site already shows the last save.', 'info'); return; }
          if (next === 'not-saved') { d.onClose = null; d.close(true); notSaved(opts).then(done); return; }
          d.error('Not sent: ' + errText(err));
        });
      });
    });
  }

  function direct(eventId, a, plan, opts, toast) {
    var C = window.RevampCore;
    return new Promise(function (done) {
      var outcome = { kind: 'closed' };
      var url = location.origin + '/e/' + encodeURIComponent(eventId);
      var d = dialog({
        title: 'Publish the site?', opener: opts.opener,
        body: '<p>' + esc(savedLine(a, plan.version)) + ' goes live at <b>' + esc(url) + '</b> at once.</p>' +
          '<p class="rvpf-muted">Approval is switched off for this team, so nobody else checks it first.</p>',
        actions: [{ key: 'cancel', label: 'Cancel' }, { key: 'publish', label: 'Publish', kind: 'primary' }],
        focus: '[data-rvpf="cancel"]'
      });
      d.onClose = function () { done(outcome); };
      d.on('publish', function () {
        d.error('');
        d.busy(true, 'publish', 'Publishing…');
        C.publishEvent(eventId).then(function (out) {
          outcome = { kind: 'published', result: out };
          if (typeof opts.onDone === 'function') opts.onDone(outcome);
          var live = out.publishedUrl || (location.origin + (out.publishedPath || '/e/' + encodeURIComponent(eventId)));
          d.onClose = null;
          d.close(true);
          var r = dialog({
            title: 'Published', opener: opts.opener,
            body: '<p>Version ' + num(out.publishedVersion) + ' is live now.</p>' +
              '<div class="rvpf-field"><label for="rvpf-url">Live address</label><div class="rvpf-link">' +
              '<input id="rvpf-url" type="text" readonly value="' + esc(live) + '"><button type="button" class="btn btn-secondary" data-rvpf="copy-link">Copy link</button></div></div>',
            actions: [{ key: 'view', label: 'View the live site', href: live, newTab: true }, { key: 'done', label: 'Done', kind: 'primary' }],
            focus: '[data-rvpf="done"]'
          });
          r.on('copy-link', function (e) { copyText(live, r.box, e.target.closest('button')); });
          r.onClose = function () { done(outcome); };
        }, function (err) {
          d.busy(false, 'publish');
          if (typeof opts.onError === 'function' && opts.onError(err)) { d.close(true); return; }
          var next = errorPlan(err);
          if (next === 'ask') { d.onClose = null; d.close(true); ask(eventId, Object.assign({}, a, { required: true }), Object.assign({}, plan, { kind: 'ask' }), String(opts.name || a.name || ''), opts, toast).then(done); return; }
          if (next === 'not-saved') { d.onClose = null; d.close(true); notSaved(opts).then(done); return; }
          if (next === 'nothing-new') { d.close(); toast('Nothing new to publish: the live site already shows the last save.', 'info'); return; }
          d.error('Not published: ' + errText(err));
        });
      });
    });
  }

  /* ============================================================
     WHAT BECAME OF THE LAST REQUEST — a line under the page's top bar (UX-103)
     ============================================================ */
  function seenKey(id) { return 'rv-decision-seen:' + id; }
  function seen(id) { try { return localStorage.getItem(seenKey(id)) === '1'; } catch (e) { return false; } }
  function markSeen(id) { try { localStorage.setItem(seenKey(id), '1'); } catch (e) { /* this visit only */ } }
  /* host: the page's empty element for it; a: fetchApproval's answer; opts { me, eventId, now } */
  function paintDecision(host, a, opts) {
    if (!host) return null;
    injectCss();
    var n = a ? decisionNotice(a, { me: opts && opts.me, eventId: opts && opts.eventId, now: opts && opts.now, seen: seen }) : null;
    if (!n) { host.hidden = true; host.innerHTML = ''; return null; }
    host.className = 'rvpf-strip is-' + n.tone;
    host.setAttribute('role', 'status');
    host.innerHTML = '<span class="grow"><b>' + esc(n.title) + '</b> ' + esc(n.text) + '</span>' +
      '<a href="' + esc(n.href) + '" target="_blank" rel="noopener">' + esc(n.link) + '</a>' +
      '<button type="button" data-rvpf-dismiss>Dismiss</button>';
    host.hidden = false;
    host.querySelector('[data-rvpf-dismiss]').onclick = function () { markSeen(n.id); host.hidden = true; host.innerHTML = ''; };
    return n;
  }

  /* the Publish button's look from buttonState: a button with nothing to do is aria-disabled, never disabled, so
     its title still shows and a press still says why. A label with a short word keeps the full label as its text and
     its name, and a narrow top bar shows the short word (the CSS above), so no width has to be measured here. */
  function paintButton(btn, st) {
    if (!btn || !st) return;
    if (btn.hasAttribute('data-rvpf-label')) return;     // busy: painted once it is done
    injectCss();
    if (btn.textContent !== st.label) btn.textContent = st.label;
    if (st.short && st.short !== st.label) { btn.setAttribute('data-rvpf-short', st.short); btn.setAttribute('aria-label', st.label); }
    else { btn.removeAttribute('data-rvpf-short'); btn.removeAttribute('aria-label'); }
    btn.title = st.title;
    if (st.quiet) { btn.setAttribute('aria-disabled', 'true'); btn.setAttribute('data-rvpf-quiet', ''); }
    else { btn.removeAttribute('aria-disabled'); btn.removeAttribute('data-rvpf-quiet'); }
  }

  window.RevampPublishFlow = {
    open: open, planOf: planOf, buttonState: buttonState, paintButton: paintButton, decisionNotice: decisionNotice, paintDecision: paintDecision,
    aiUncheckedOf: aiUncheckedOf, approverWords: approverWords,
    _test: { planOf: planOf, buttonState: buttonState, approverWords: approverWords, copyMessage: copyMessage, decisionNotice: decisionNotice,
      aiUncheckedOf: aiUncheckedOf, errorPlan: errorPlan, errText: errText, savedLine: savedLine, setBusy: setBusy, CSS: CSS }
  };
  if (window.RevampCore) window.RevampCore.openPublishFlow = open;
})();
