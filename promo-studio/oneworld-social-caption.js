/* Oneworld's Caption tab, Write with AI and Suggest headlines, inside the platform's social posts studio
   (promo-social-studio.html, shown in Promotions → Social posts). The studio and its layout editor are the
   platform's own code, copied into promo-studio/social-studio.js; this file loads last and adds what Oneworld's own
   posts studio has and the platform's has not (promo-posts.js), so the merge keeps the owner's named features:

     - the editor's 4th tab, Caption (the copied paintSide calls owRenderCaption(), patch S18): LinkedIn, Instagram
       and X captions made from the template's own caption, shaped per network by Oneworld's rules (promo-posts.js
       lines()), with the date · place line, "Register: <link>" while the site is published, and the hashtag; edited
       freely, written by the AI, copied, or put back to the facts;
     - Write with AI for the caption, and Suggest headlines under the heading field of the 5 templates that have
       one (POST /api/promo/write, functions/lib/promo.js), told what each text on the post is under its own key;
     - the caption that is saved with the layout (state), whether it has unsaved changes (dirty), and the text the
       ZIP's caption.txt holds (textFor). promo-studio/oneworld-social.js calls these (window.OWSCap).

   Every text that came from the server or the AI is set with textContent or value, never written as HTML: the AI's
   answer is cleaned on the server only of complete tags, so a stray "<img … onerror=…" would otherwise run in the
   console's origin, which holds the sign-in token. This file writes no HTML at all.

   Everything is kept inside one function: the platform's code declares its names with const and let, and a
   function declared here with one of those names would stop this whole file from loading. */
(function () {
  'use strict';

  /* ---------- what the tab knows ---------- */

  /* the three networks and how long each one's post may be (promo-posts.js NETWORKS) */
  var NETWORKS = [
    { id: 'linkedin', label: 'LinkedIn', max: 3000 },
    { id: 'instagram', label: 'Instagram', max: 2200 },
    { id: 'x', label: 'X', max: 280 }
  ];
  /* what kind of post each template is, in the words the AI route knows (promo.js KIND_NOTES), so the copy fits it */
  var KIND = {
    'generic.announcement': 'save-the-date',
    'generic.who-should-attend': 'audience',
    'generic.summit-highlights': 'stats',
    'generic.prediction-outcome': 'outlook',
    'generic.testimonial': 'testimonial',
    'partner.tier-ladder': 'partners',
    'partner.presenting-spotlight': 'partner',
    'speaker.individual': 'speaker',
    'speaker.combined': 'speakers'
  };
  /* the 5 templates with a heading, and the option that holds it */
  var HEAD_KEY = {
    'generic.who-should-attend': 'title',
    'generic.summit-highlights': 'title',
    'generic.prediction-outcome': 'headline',
    'partner.tier-ladder': 'title',
    'speaker.combined': 'title'
  };
  /* the templates' own text options, sent to the AI first and under their own names, so it knows which text is the
     heading and which the quote (the canvas texts that follow carry no such name) */
  var TEXT_KEYS = ['kicker', 'title', 'headline', 'quote', 'roleLabel', 'prediction', 'outcome', 'predictionLabel', 'outcomeLabel', 'author', 'authorTitle'];
  /* these two templates' captions already say when and where (announcement.ts, individual.ts): no second date line */
  var NO_WHEN = { 'generic.announcement': true, 'speaker.individual': true };
  var TESTIMONIAL = 'generic.testimonial';
  /* the AI route reads 30 keys of the post and 3,000 characters of them, each value at most 600 (promo.js pieceText):
     what is sent stays inside that, so nothing the post says is dropped on the way */
  var POST_KEYS = 30, POST_CHARS = 3000, POST_VALUE = 600;
  var MAX_SUGGESTIONS = 4;
  /* a sentence that needs reading stays up for 6 s, as the studio's other long toasts (oneworld-social.js) */
  var LONG = 6000;
  /* the "Caption written." toast's own time on screen (the platform's toast default), before a warning follows it */
  var TOAST_MS = 2200;

  var HINT = 'Made from the event’s facts. Edit it freely.';
  var HONEST = 'Posting straight to LinkedIn, Instagram or X is not part of this release. Download the picture, copy the caption, and post them from the event’s own account.';
  var QUOTE_FIRST = 'Type the quote in Options first.';
  var QUOTE_GUARD = 'Type the quote in Options, then Apply & re-render: a testimonial shows a real quote, never a made-up one.';
  var SUGG_NOTE = 'Apply & re-render to use it; layout edits are reset.';

  function own(table, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key); }
  function netOf(id) { for (var i = 0; i < NETWORKS.length; i++) if (NETWORKS[i].id === id) return NETWORKS[i]; return null; }
  function oneLine(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function copy(v) { try { return JSON.parse(JSON.stringify(v || {})); } catch (e) { return {}; } }

  /* ---------- the studio around this file (the platform's globals, read when they are needed) ---------- */

  function editState() { return typeof EDIT !== 'undefined' && EDIT ? EDIT : null; }
  function appliedParams() { return typeof edParams !== 'undefined' && edParams ? edParams : {}; }
  function eventOf() { return (typeof CAT !== 'undefined' && CAT && CAT.event) || {}; }
  function templateOf(tid) {
    try { return (typeof findTpl === 'function' && findTpl(tid)) || null; } catch (e) { return null; }
  }
  function say(m, ms) { if (typeof toast === 'function') toast(m, ms); }
  function eventId() {
    if (typeof EVENT_ID !== 'undefined' && EVENT_ID) return String(EVENT_ID);
    try { return new URLSearchParams(location.search).get('event') || ''; } catch (e) { return ''; }
  }

  /* A POST to Oneworld, signed in. It never rejects: a failure of the network or of the sign-in answers status 0,
     so every caller has one place to say what went wrong. */
  function send(url, body) {
    return new Promise(function (resolve) {
      function failed() { resolve({ ok: false, status: 0, json: null }); }
      var p;
      try {
        p = window.RevampAuth.authedFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch (e) { failed(); return; }
      Promise.resolve(p).then(function (r) {
        var read = r && typeof r.json === 'function' ? r.json() : null;
        return Promise.resolve(read).then(null, function () { return null; }).then(function (j) {
          resolve({ ok: !!(r && r.ok), status: (r && r.status) || 0, json: j && typeof j === 'object' ? j : null });
        });
      }).then(null, failed);
    });
  }

  /* what the owner is told when the AI did not answer (promo-posts.js aiError, with the server's own words when
     it gave some) */
  function aiError(r) {
    var said = r && r.json && typeof r.json.error === 'string' ? r.json.error : '';
    if (r && r.status === 404) return 'Writing with AI is not available yet.';
    if (r && r.status === 429) return said || 'The AI has been used too much for now. Try again later.';
    return said || 'The AI did not answer. Try again.';
  }

  /* ---------- the caption, shaped per network ---------- */

  /* Oneworld's lines() (promo-posts.js), over the template's own caption: the body is that caption without the one
     hashtag it ends with, since each network puts the hashtag where it belongs. The link is the registration
     address only while the site is published, so a caption never points to a site that is not live. */
  function owCapShape(base, network, templateId) {
    var e = eventOf(), tid = templateId || (CS && CS.tid) || '';
    var b = String(base == null ? '' : base);
    /* a testimonial with no quote has no caption: nothing about it is made up, not even the event's name */
    if (tid === TESTIMONIAL && !b.trim()) return '';
    var tag = String(e.hashtag || '').trim();
    var link = e.published ? String(e.link || '').trim() : '';
    var when = NO_WHEN[tid] ? '' : [e.dateLabel, e.venue].filter(Boolean).join(' · ');
    var body = b.trim();
    var at = body.length - tag.length;
    if (tag && at >= 0 && body.slice(at) === tag && (at === 0 || /\s/.test(body.charAt(at - 1)))) body = body.slice(0, at).trim();
    if (network === 'x') {
      var t = body, tail = [link, tag].filter(Boolean).join(' ');
      var room = 280 - tail.length - 2;
      if (t.length > room) t = t.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '') + '…';
      return [t, tail].filter(Boolean).join('\n\n');
    }
    var out = [body, when];
    if (link && network !== 'instagram') out.push('Register: ' + link);
    if (tag) out.push(tag);
    return out.filter(Boolean).join('\n\n') || String(e.name || '');
  }

  /* ---------- the open layout's caption ---------- */

  /* CS: the caption of the layout open in the editor, a new object at every load, so an answer that comes back for
     an earlier load (CS is no longer the one that asked) is dropped, never shown on this one.
       tid, fmt, params   the template, the size and the options the canvas was drawn with
       network, text      what is saved with the layout: text null means "the facts", shaped for the network
       base      network and text as loaded or last saved (dirty compares against it)
       sent      network and text as last handed to a save (state()); markSaved() makes that the base, so words
                 typed while the save is on its way are still unsaved when its answer comes
       before, canUndo    the text before the last AI write, while Undo can still bring it back
       aiBusy, sugg       a Write with AI in flight; Suggest headlines per heading key: { busy, options, empty }
       view      the tab's elements while it is drawn */
  var CS = null;
  /* the network a layout with no saved caption opens on, as every new post in Oneworld's own studio does
     (promo-posts.js newCfg). It is not carried over from the last layout: picking a network is a change to save, so a
     new layout that opened on it would ask "Discard your changes?" over a change it keeps anyway. */
  var FIRST_NETWORK = 'linkedin';
  /* the template's own caption per template and options: { key, done, failed, base } */
  var FACTS = {};

  /* the options a caption depends on, in a stable order; theme and background change the picture, never the words */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function factsKey(tid, params) {
    var p = {};
    Object.keys(params || {}).forEach(function (k) { if (k !== 'theme' && k !== 'bg') p[k] = params[k]; });
    return tid + '|' + stable(p);
  }
  /* the template's caption for the options the canvas was drawn with (POST /api/promo/social/html, captionOnly).
     Asked once per template and options; a failed answer is asked again the next time the tab is shown. */
  function factsFor(c) {
    var key = factsKey(c.tid, c.params), f = FACTS[key];
    c.factsKey = key;
    if (f && !f.failed) return f;
    f = FACTS[key] = { key: key, done: false, failed: false, base: '' };
    f.p = send('/api/promo/social/html', { eventId: eventId(), items: [{ templateId: c.tid, format: c.fmt, params: c.params }], captionOnly: true })
      .then(function (r) {
        var item = r.ok && r.json && Array.isArray(r.json.items) ? r.json.items[0] : null;
        if (item && !item.error && typeof item.caption === 'string') f.base = item.caption;
        else f.failed = true;
        f.done = true;
        /* shown on whichever load is open now, when it is about the same template and options (a reload of the
           same layout while this was being asked is one) */
        if (CS && CS.factsKey === f.key && CS.text == null) paintText();
        return f;
      });
    return f;
  }
  function factsNow(c) { var f = c && FACTS[c.factsKey]; return f && f.done && !f.failed ? f : null; }
  /* the caption the tab shows: what was typed or written, else the facts for the network */
  function shown(c) {
    if (!c) return '';
    if (c.text != null) return c.text;
    var f = factsNow(c);
    return f ? owCapShape(f.base, c.network, c.tid) : '';
  }

  /* What the layout's caption was when it was opened: the saved one when there is one. oneworld-social.js passes the
     load's answer as `saved` ({ saved:true, caption, … }), or the caption beside it; a plain true or false carries
     none. */
  function savedCaption(info) {
    var c = info.caption !== undefined ? info.caption : (info.saved && typeof info.saved === 'object' ? info.saved.caption : undefined);
    return c && typeof c === 'object' ? c : null;
  }

  /* after every load of the editor (oneworld-social.js): the caption starts again from the saved one or the facts */
  function onLoad(info) {
    info = info || {};
    var saved = savedCaption(info);
    var network = saved && netOf(saved.network) ? saved.network : FIRST_NETWORK;
    var text = saved && typeof saved.text === 'string' ? saved.text : null;
    CS = { tid: String(info.templateId || ''), fmt: String(info.format || ''), params: copy(info.params),
      network: network, text: text, base: { network: network, text: text }, sent: null, before: null, canUndo: false,
      aiBusy: false, sugg: {}, view: null, factsKey: '' };
    /* The facts are asked now, not when the tab is first shown, because the ZIP's caption.txt (oneworld-social.js)
       reads textFor() as soon as the pictures are drawn, and the owner may download without opening the tab. A
       layout saved with its own words shows and downloads those, so its facts wait until the tab is drawn (Back to
       the facts is only reachable there). Each template and options is asked once in the visit (FACTS). */
    if (CS.tid && CS.text == null) factsFor(CS);
  }
  /* The tab and the options are only drawn in an open editor; if this file was not told of the load (the editor
     opened before the adapter could say so), it starts from what the editor shows. */
  function ensure() {
    var ed = editState();
    if (ed && ed.tid && (!CS || CS.tid !== ed.tid)) onLoad({ templateId: ed.tid, format: ed.fmt, params: appliedParams() });
    return CS;
  }

  /* ---------- what the AI is told about the post ---------- */

  /* { type, template, the template's applied text options under their own names, then text1 … textN from the canvas's
     text elements in order }, cut so the route's 30 keys and 3,000 characters hold all of it (promo.js pieceText).
     The options come first: with 28 texts on the canvas, the heading still arrives. */
  function postFor(tid) {
    var t = templateOf(tid) || {}, defs = {};
    (Array.isArray(t.params) ? t.params : []).forEach(function (p) { if (p && typeof p.key === 'string') defs[p.key] = p; });
    var params = CS && CS.tid === tid ? CS.params : appliedParams();
    var post = { type: own(KIND, tid) ? KIND[tid] : '' };
    var keys = 1, chars = 0, full = false;
    function add(k, v) {
      if (full || keys >= POST_KEYS) { full = true; return; }
      v = oneLine(v).slice(0, POST_VALUE);
      if (!v) return;
      var sep = chars ? 1 : 0, room = POST_CHARS - chars - sep - k.length - 2;
      if (room <= 0) { full = true; return; }
      if (v.length > room) { v = v.slice(0, room).trim(); full = true; if (!v) return; }
      post[k] = v; keys++; chars += sep + k.length + 2 + v.length;
    }
    add('template', t.label || tid);
    TEXT_KEYS.forEach(function (k) {
      if (t.params && !own(defs, k) && !own(params, k)) return;
      var v = own(params, k) ? params[k] : undefined;
      if (typeof v !== 'string' && typeof v !== 'number') v = '';
      /* an option left at its default is still on the post: the default is what was drawn */
      if (!String(v).trim() && own(defs, k) && typeof defs[k].default === 'string') v = defs[k].default;
      add(k, v);
    });
    var ed = editState(), n = 0;
    ((ed && Array.isArray(ed.els)) ? ed.els : []).forEach(function (el) {
      if (el && el.type === 'text' && typeof el.text === 'string' && el.text.trim()) add('text' + (++n), el.text);
    });
    return post;
  }
  /* the testimonial's quote as applied: without one there is nothing true to write about */
  function quoteOf(c) { var q = c && c.params ? c.params.quote : ''; return typeof q === 'string' ? q.trim() : ''; }

  /* ---------- the Caption tab ---------- */

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(id, cls, text) {
    var b = node('button', cls, text);
    b.type = 'button';
    if (id) b.id = id;
    return b;
  }
  function show(el, on) { if (el) el.style.display = on ? '' : 'none'; }
  /* the info mark of Oneworld's note (promo-posts.js ICON.info), drawn as elements */
  function infoIcon() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    [['width', '15'], ['height', '15'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'],
      ['stroke-width', '2'], ['stroke-linecap', 'round'], ['aria-hidden', 'true']].forEach(function (a) { svg.setAttribute(a[0], a[1]); });
    var circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M12 11v5M12 7.8h.01');
    svg.appendChild(circle); svg.appendChild(path);
    return svg;
  }
  function viewOf(c) {
    var v = c && c.view;
    return v && document.getElementById('owCapText') === v.ta ? v : null;
  }

  /* the copied paintSide calls this when the Caption tab is picked (patch S18) */
  function owRenderCaption() {
    var body = document.getElementById('edSideBody');
    if (!body) return;
    var c = ensure();
    body.textContent = '';
    if (!c || !c.tid) { body.appendChild(node('div', 'ed-empty', 'Open a template to write its caption.')); return; }
    factsFor(c);

    body.appendChild(node('div', 'ph', 'Caption'));
    var seg = node('div', 'seg');
    seg.id = 'owCapNet';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Network');
    NETWORKS.forEach(function (n) {
      var b = button('', '', n.label);
      b.setAttribute('data-v', n.id);
      b.onclick = function () { pickNetwork(c, n.id); };
      seg.appendChild(b);
    });
    var label = node('label', 'ow-cap-l');
    label.setAttribute('for', 'owCapText');
    var forText = node('span', 'ow-cap-for');
    var count = node('span', 'ow-cap-n');
    count.id = 'owCapN';
    label.appendChild(forText); label.appendChild(document.createTextNode(' ')); label.appendChild(count);
    var ta = node('textarea', 'ow-cap-text');
    ta.id = 'owCapText';
    ta.rows = 7;
    ta.oninput = function () {
      if (CS !== c) return;
      c.text = ta.value;
      c.canUndo = false;
      paintMeta();
    };
    var acts = node('div', 'ow-cap-acts');
    var ai = button('owCapAi', 'btn alt sm', 'Write with AI');
    var cp = button('owCapCopy', 'btn ghost sm', 'Copy caption');
    var undo = button('owCapUndo', 'btn ghost sm', 'Undo');
    var reset = button('owCapReset', 'btn ghost sm', 'Back to the facts');
    ai.onclick = function () { writeCaption(c); };
    cp.onclick = function () { copyCaption(c); };
    undo.onclick = function () { undoWrite(c); };
    reset.onclick = function () { backToFacts(c); };
    acts.appendChild(ai); acts.appendChild(cp); acts.appendChild(undo); acts.appendChild(reset);
    var note = node('p', 'ow-honest');
    note.appendChild(infoIcon());
    note.appendChild(node('span', '', HONEST));

    body.appendChild(seg);
    body.appendChild(label);
    body.appendChild(ta);
    body.appendChild(node('div', 'hint', HINT));
    body.appendChild(acts);
    body.appendChild(note);
    c.view = { seg: seg, forText: forText, count: count, ta: ta, ai: ai, copy: cp, undo: undo, reset: reset };
    paintText();
  }

  /* the textarea from the state: after a load, a network picked, an AI write, Undo or Back to the facts (never while
     typing, which would move the cursor) */
  function paintText() {
    var c = CS, v = viewOf(c);
    if (!v) return;
    v.ta.value = shown(c);
    var placeholder = '';
    if (c.text == null) {
      var f = FACTS[c.factsKey];
      if (!f || !f.done) placeholder = 'Reading the event’s facts…';
      else if (f.failed) placeholder = 'The event’s facts could not be read. Type the caption, or use Write with AI.';
      else if (c.tid === TESTIMONIAL && !v.ta.value) placeholder = QUOTE_FIRST;
    }
    v.ta.placeholder = placeholder;
    paintMeta();
  }
  /* everything around the text: the network, the label, the count, which buttons show */
  function paintMeta() {
    var c = CS, v = viewOf(c);
    if (!v) return;
    var net = netOf(c.network) || NETWORKS[0];
    var picks = v.seg.querySelectorAll('button[data-v]');
    for (var i = 0; i < picks.length; i++) {
      var on = picks[i].getAttribute('data-v') === net.id;
      picks[i].className = on ? 'on' : '';
      picks[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    v.forText.textContent = 'Caption for ' + net.label;
    var n = v.ta.value.length;
    v.count.textContent = n + ' / ' + net.max;
    v.count.className = 'ow-cap-n' + (n > net.max ? ' over' : '');
    v.ai.disabled = !!c.aiBusy;
    v.ai.textContent = c.aiBusy ? 'Writing…' : 'Write with AI';
    show(v.undo, c.canUndo);
    show(v.reset, c.text != null);
  }

  function pickNetwork(c, id) {
    if (CS !== c || !netOf(id)) return;
    c.network = id;
    /* a caption the owner typed is kept as it is; the facts are shaped again for the network */
    if (c.text == null) paintText(); else paintMeta();
  }
  function backToFacts(c) {
    if (CS !== c) return;
    c.text = null;
    c.canUndo = false;
    paintText();
  }
  function undoWrite(c) {
    if (CS !== c || !c.canUndo) return;
    c.text = c.before;
    c.before = null;
    c.canUndo = false;
    paintText();
  }
  function copyCaption(c) {
    var v = viewOf(c), text = v ? v.ta.value : shown(c), clip;
    /* asked inside the click itself: the browser lets a page write to the clipboard only right after a click */
    try {
      clip = navigator.clipboard && navigator.clipboard.writeText ? Promise.resolve(navigator.clipboard.writeText(text)) : Promise.reject(new Error('no clipboard'));
    } catch (e) { clip = Promise.reject(e); }
    clip.then(function () { say('Caption copied.'); }, function () {
      var w = viewOf(c);
      if (w) { w.ta.focus(); w.ta.select(); }
      say('Press Ctrl+C (⌘C on a Mac) to copy the selected caption.', LONG);
    });
  }

  /* Write with AI: the caption for the network on screen, from the post's own texts (POST /api/promo/write). Undo
     is a button beside it, because the platform's toast carries no action. */
  function writeCaption(c) {
    if (CS !== c || c.aiBusy) return;
    /* a testimonial is about a real quote; with none typed, the AI would only have the event to quote from */
    if (c.tid === TESTIMONIAL && !quoteOf(c)) { say(QUOTE_GUARD, LONG); return; }
    var v = viewOf(c), current = v ? v.ta.value : shown(c);
    c.aiBusy = true;
    paintMeta();
    send('/api/promo/write', { eventId: eventId(), task: 'caption', network: c.network, post: postFor(c.tid), current: current }).then(function (r) {
      c.aiBusy = false;
      if (CS !== c) return;
      paintMeta();
      if (!r.ok) { say(aiError(r), LONG); return; }
      var j = r.json || {};
      var text = j.text || (j.options && j.options[0] && (j.options[0].text || j.options[0]));
      if (!text || typeof text !== 'string') { say('No caption came back. Try again.', LONG); return; }
      c.before = c.text;
      c.canUndo = true;
      c.text = text;
      paintText();
      say('Caption written.');
      /* the route's warning (the copy links to a site not yet published) follows once the first toast has gone */
      if (j.warning && typeof j.warning === 'string') {
        var warning = j.warning;
        setTimeout(function () { if (CS === c) say(warning, LONG); }, TOAST_MS + 200);
      }
    });
  }

  /* ---------- Suggest headlines, in the Options tab ---------- */

  function suggOf(c, key) {
    if (!own(c.sugg, key)) c.sugg[key] = { busy: false, options: [], empty: false };
    return c.sugg[key];
  }
  function headInput(key) {
    var host = document.getElementById('edOpts');
    return host ? host.querySelector('[data-key="' + key + '"]') : null;
  }
  /* the button, the list and the line, from the state: the Options tab is drawn again each time it is shown */
  function paintSugg(c, key, focus) {
    var input = headInput(key), s = suggOf(c, key);
    var wrap = input && input.parentNode;
    if (!wrap || CS !== c) return;
    var btn = wrap.querySelector('.ow-sugg'), list = wrap.querySelector('.ow-sugg-list'), note = wrap.querySelector('.ow-sugg-note');
    if (!btn || !list) return;
    btn.disabled = s.busy;
    btn.textContent = s.busy ? 'Writing…' : 'Suggest headlines';
    list.textContent = '';
    s.options.forEach(function (o) {
      var b = button('', '', o);
      b.onclick = function () {
        var field = headInput(key);
        if (field) { field.value = o; field.focus(); }
      };
      list.appendChild(b);
    });
    if (s.empty) list.appendChild(node('span', 'hint', 'No suggestions came back. Try again.'));
    show(note, s.options.length > 0);
    if (focus && list.firstChild && list.firstChild.focus) list.firstChild.focus();
  }
  function suggest(c, key) {
    var s = suggOf(c, key);
    if (CS !== c || s.busy) return;
    var input = headInput(key);
    s.busy = true;
    s.empty = false;
    paintSugg(c, key);
    send('/api/promo/write', { eventId: eventId(), task: 'headline', post: postFor(c.tid), current: input ? String(input.value || '') : '' }).then(function (r) {
      s.busy = false;
      if (CS !== c) return;
      if (!r.ok) { paintSugg(c, key); say(aiError(r), LONG); return; }
      var j = r.json || {};
      var raw = Array.isArray(j.options) ? j.options : Array.isArray(j.headlines) ? j.headlines : (j.text ? [j.text] : []);
      s.options = raw.map(function (x) { return typeof x === 'string' ? x : (x && (x.text || x.headline)) || ''; })
        .map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, MAX_SUGGESTIONS);
      s.empty = !s.options.length;
      paintSugg(c, key, true);
    });
  }
  /* oneworld-social.js calls this after the platform's renderOptions has drawn the Options tab */
  function decorateOptions() {
    var ed = editState();
    if (!ed || !own(HEAD_KEY, ed.tid)) return;
    var key = HEAD_KEY[ed.tid], input = headInput(key);
    if (!input || !input.parentNode || input.parentNode.querySelector('.ow-sugg')) return;
    var c = ensure();
    if (!c) return;
    var btn = button('', 'btn ghost sm ow-sugg', 'Suggest headlines');
    var list = node('div', 'ow-sugg-list');
    list.setAttribute('aria-live', 'polite');
    var note = node('div', 'hint ow-sugg-note', SUGG_NOTE);
    btn.onclick = function () { suggest(c, key); };
    var after = input.nextSibling;
    input.parentNode.insertBefore(btn, after);
    input.parentNode.insertBefore(list, after);
    input.parentNode.insertBefore(note, after);
    paintSugg(c, key);
  }

  /* ---------- for oneworld-social.js ---------- */

  window.OWSCap = {
    onLoad: onLoad,
    /* what the layout saves: { network, text }, text null for "the facts". oneworld-social.js reads it just before
       the save's request, so what it hands over is kept as what was sent. */
    state: function () {
      if (!CS) return { network: FIRST_NETWORK, text: null };
      CS.sent = { network: CS.network, text: CS.text };
      return { network: CS.network, text: CS.text };
    },
    dirty: function () { return !!CS && (CS.network !== CS.base.network || CS.text !== CS.base.text); },
    /* called when the save's answer comes: what was sent is now saved, not what is on screen, since the owner may
       have gone on typing while the save was on its way (the editor is not locked while saving), and those words
       must still count as a change. A load that sent nothing (the answer is for a save made before this load) has
       nothing saved by it. With two saves on their way at once, the first answer marks the later save's words,
       which that save is storing; if it fails, its own toast says so. */
    markSaved: function () { if (CS && CS.sent) CS.base = CS.sent; },
    /* the text on the Caption tab for this template, for the ZIP's caption.txt; null while it is not known */
    textFor: function (tid) {
      if (!CS || (tid && tid !== CS.tid)) return null;
      if (CS.text != null) return CS.text;
      return factsNow(CS) ? shown(CS) : null;
    },
    decorateOptions: decorateOptions
  };
  window.owRenderCaption = owRenderCaption;
  window.owCapShape = owCapShape;
})();
