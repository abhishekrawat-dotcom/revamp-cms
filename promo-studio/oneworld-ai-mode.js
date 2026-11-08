/* "Edit with AI | Edit myself" in the social post editor and the mailer editor (batch B18-ai; the owner's choice of
   2026-11-08, owner-decisions.md #9, promo-easy-edit/DESIGN.md section 3). One file for both framed studios
   (promo-social-studio.html, promo-mailer-studio.html); it loads last on each.

   THE TOGGLE. The same one as the site editor's (custom_editor.html #ed-mode-toggle, editor-ai-mode.js): the same
   look, words, titles and keys (a radio group: the arrow keys, Home and End move and switch, Tab leaves it), in the
   editor's top bar beside Undo / Save / Download. It shows once the editor is open, and never on the team's Mailer
   performance page (no event) or on a phone (the editors give way to a message there).
     - "Edit myself" is the editor as batch B18 made it: the easy panel, typing on the post or in the mail, and the
       advanced tools. Nothing here changes it.
     - "Edit with AI" shows the post (or the mail) full size, with nothing to click on it, and ETB2B AI at the bottom
       right: the one assistant of Promotions (etb2b-assistant.js on marketing.html, which this frame tells of the
       mode). Switching never touches the post: what is being typed is recorded first.
   The mode is remembered per signed-in person in this browser (localStorage, optional: blocked storage means this
   visit only).

   THE BRIDGE (window.OWAi), which the assistant's brain for the open editor (promo-ai-client.js, same origin) uses:
     kind()                 'post' | 'mail'
     eventId()              the event this studio is for (the page's ?event=)
     active()               the editor is open and in "Edit with AI"
     state()                the post's or mail's words, people and settings, for POST /api/promo/ai-edit
     apply(changes, turnId) -> Promise<{ changed, done: [], notDone: [] }>  ETB2B AI's change, made through the
                            editors' own change paths: the social editor's one write (window.OWSEasy.set, which
                            records Undo) and the mailer's (owMailEdit, through the studio's block-change path and its
                            Undo history), as ONE Undo step
     background(url, turnId) -> Promise<{ changed, done, notDone }>  a new background made by ETB2B AI pictures, as
                            the post's back layer (with a veil so the words stay readable), one Undo step; the post's
                            logo and words stay on top of it, untouched
     undo(turnId)           -> Promise<{ ok, why? }>  takes that change back, with no AI call: only while the post or
                            mail is still as the change left it (otherwise the top bar's Undo steps back)
     perSpeaker()           -> Promise<{ id, count, message }>  one post per speaker drawn in this tab, kept for the
                            person's own Download; download(id) is that Download
     chatOpen(open)         the assistant's panel opened or closed: the post keeps clear of it
   ETB2B AI never sends, publishes, deletes or downloads for the person here: there is no such call.

   Browser code is ES5 (no let, const or arrow functions). The platform's code declares its names with const and let,
   so everything here is inside one function. */
(function () {
  'use strict';

  var doc = document;
  var KIND = '';
  /* the platform's globals are lexical (const / let), seen by name, never on window */
  try { if (typeof EDIT !== 'undefined' && doc.getElementById('edStage')) KIND = 'post'; } catch (e) { KIND = ''; }
  try { if (!KIND && typeof MD !== 'undefined' && doc.getElementById('mlCanvas')) KIND = 'mail'; } catch (e) { /* not the mailer */ }
  var EV = typeof EVENT_ID === 'string' ? EVENT_ID : '';
  /* the team's Mailer performance page (?scope=all) is about no event: no ETB2B AI editing there */
  if (!KIND || !EV) return;
  var ROOT_ID = KIND === 'post' ? 'editor' : 'mailer';
  var NOUN = KIND === 'post' ? 'post' : 'mail';
  var mode = 'manual';
  var toggle = null, hint = null;
  var records = [];                    // ETB2B AI's changes in this tab, oldest first (undo)
  var kept = {};                       // per-speaker ZIPs waiting for the person's Download
  var keptN = 0;
  var FLASH_MS = 2000;

  var TEXT = {
    hintPost: 'Ask ETB2B AI, at the bottom right, to change this post: its words, its speaker or partner, its caption or its background. Or switch to Edit myself.',
    hintMail: 'Ask ETB2B AI, at the bottom right, to change this mail: its subject, preview text, words, or who it shows. Or switch to Edit myself.',
    aiTitlePost: 'See the post full size and change it by asking ETB2B AI',
    aiTitleMail: 'See the mail full size and change it by asking ETB2B AI',
    meTitlePost: 'Click any word or picture on the post to change it yourself',
    meTitleMail: 'Click any word or picture in the mail to change it yourself',
    changedSince: 'You have changed the ' + NOUN + ' since, so I left it as it is. Use Undo in the top bar to step back.',
    gone: 'That ' + NOUN + ' is not open any more, so the change can’t be undone here. Open it and use Undo in the top bar.',
    notOpen: 'The editor is not open.',
    noText: 'is not on the ' + NOUN + ' any more',
    noPerson: 'that person is not in this event’s Content',
    notInPlace: 'has a different kind of picture, so swapping them would draw the post again from the design: swap them in Edit myself, under People',
    noRoster: 'this event’s speakers and partners are still loading: ask again in a moment',
    noBlock: 'that section is not in the mail any more'
  };

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function arr(x) { return Array.prototype.slice.call(x || []); }
  function str(v) { return v == null ? '' : String(v); }
  function shortWords(v) { var t = str(v).replace(/\s+/g, ' ').trim(); return t.length > 160 ? t.slice(0, 159).replace(/\s+\S*$/, '') + '…' : t; }
  function framed() { try { return window.parent !== window; } catch (e) { return false; } }
  function tellParent(msg) { try { if (framed()) window.parent.postMessage(msg, location.origin); } catch (e) { /* not framed */ } }
  function editorOpen() { var r = doc.getElementById(ROOT_ID); return !!(r && r.classList.contains('on')); }

  /* ---------- the mode, remembered per person ---------- */
  function userKey() {
    var u = null;
    try { u = window.RevampAuth && RevampAuth.currentUser ? RevampAuth.currentUser() : null; } catch (e) { u = null; }
    return 'revamp.promoEditorMode.' + ((u && (u.uid || u.email)) || 'anon');
  }
  function remembered() {
    var v = null;
    try { v = window.localStorage.getItem(userKey()); } catch (e) { v = null; }
    return v === 'ai' || v === 'manual' ? v : '';
  }
  function remember(m) { try { window.localStorage.setItem(userKey(), m); } catch (e) { /* this visit only */ } }

  /* ---------- the toggle (the site editor's, custom_editor.html) ---------- */
  var SPARK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
  var PEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  function radio(m, label, short, title, icon) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.setAttribute('data-mode', m);
    b.setAttribute('aria-label', label);
    b.title = title;
    b.tabIndex = -1;
    b.innerHTML = icon + '<span class="mt-long" aria-hidden="true">' + label + '</span><span class="mt-short" aria-hidden="true">' + short + '</span>';
    return b;
  }
  function buildToggle() {
    var top = doc.querySelector('#' + ROOT_ID + ' .ed-top');
    if (!top || doc.getElementById('owModeToggle')) return;
    toggle = doc.createElement('div');
    toggle.className = 'mode-toggle ow-mode-toggle';
    toggle.id = 'owModeToggle';
    toggle.setAttribute('role', 'radiogroup');
    toggle.setAttribute('aria-label', 'Editor mode');
    toggle.appendChild(radio('ai', 'Edit with AI', 'AI', KIND === 'post' ? TEXT.aiTitlePost : TEXT.aiTitleMail, SPARK));
    toggle.appendChild(radio('manual', 'Edit myself', 'Myself', KIND === 'post' ? TEXT.meTitlePost : TEXT.meTitleMail, PEN));
    top.insertBefore(toggle, top.querySelector('.acts'));
    var radios = arr(toggle.querySelectorAll('[role="radio"]'));
    radios.forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
      b.addEventListener('keydown', function (e) {
        var i = radios.indexOf(b), to = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % radios.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + radios.length) % radios.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = radios.length - 1;
        if (to === -1) return;
        e.preventDefault();
        /* the studio's own keys (Delete, the arrows that nudge, Escape that closes) are not for the toggle */
        e.stopPropagation();
        radios[to].focus();
        setMode(radios[to].getAttribute('data-mode'));
      });
    });
    /* the line that says how to edit here, under the top bar while "Edit with AI" is on */
    hint = doc.createElement('div');
    hint.className = 'ow-ai-hint';
    hint.id = 'owAiHint';
    hint.textContent = KIND === 'post' ? TEXT.hintPost : TEXT.hintMail;
    top.parentNode.insertBefore(hint, top.nextSibling);
    draw();
  }
  function draw() {
    if (!toggle) return;
    arr(toggle.querySelectorAll('[role="radio"]')).forEach(function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
  }

  /* ---------- switching ---------- */
  /* what is being typed is kept before the post changes hands */
  function commitTyping() {
    if (KIND === 'post') {
      try { if (window.OWSEasy && OWSEasy.state && OWSEasy.state.typing) OWSEasy.stopTyping(); } catch (e) { /* nothing typed */ }
    } else {
      try { if (typeof IE !== 'undefined' && IE.el && typeof mlEditEnd === 'function') mlEditEnd(true); } catch (e) { /* nothing typed */ }
    }
    var a = doc.activeElement;
    try { if (a && a !== doc.body && a.blur && !(toggle && toggle.contains(a))) a.blur(); } catch (e) { /* nothing focused */ }
  }
  function deselect() {
    try {
      if (KIND === 'post') { if (typeof selectEl === 'function') selectEl(-1); }
      else if (MD.sel && typeof mlSelect === 'function') mlSelect(null);
    } catch (e) { /* nothing selected */ }
  }
  /* the post fits its new room; the mail keeps its own width */
  function relayout() {
    setTimeout(function () {
      try {
        if (KIND === 'post') { if (EDIT && EDIT.width && typeof edZoomFit === 'function') edZoomFit(); }
        else if (typeof mlFit === 'function') mlFit();
      } catch (e) { /* drawn at the next resize */ }
    }, 30);
  }
  function tellMode() { tellParent({ rvAiMode: editorOpen() ? mode : 'off', rvAiStudio: KIND }); }
  function setMode(m, opts) {
    opts = opts || {};
    m = m === 'ai' ? 'ai' : 'manual';
    if (m !== mode) {
      commitTyping();
      mode = m;
      if (!opts.quiet) remember(m);
      doc.body.classList.toggle('ow-ai-mode', m === 'ai');
      if (m === 'ai') deselect();
      relayout();
    }
    draw();
    tellMode();
    return mode;
  }
  /* each opening starts on the person's remembered mode; a close tells the page there is no editor any more */
  var wasOpen = false;
  function watchOpen() {
    var r = doc.getElementById(ROOT_ID);
    if (!r || typeof MutationObserver !== 'function') return;
    new MutationObserver(function () {
      var open = editorOpen();
      if (open === wasOpen) return;
      wasOpen = open;
      if (open) { buildToggle(); setMode(remembered() || 'manual', { quiet: true }); }
      else { kept = {}; tellMode(); }
    }).observe(r, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- what the server is told ---------- */
  function postState() {
    var easy = window.OWSEasy;
    var t = typeof findTpl === 'function' ? findTpl(EDIT.tid) : null;
    var fmt = ((t && t.formats) || []).filter(function (f) { return f.id === EDIT.fmt; })[0];
    var roster = easy && easy.state ? easy.state.rosterNow : null;
    var cap = null;
    try { cap = window.OWSCap && OWSCap.get ? OWSCap.get() : null; } catch (e) { cap = null; }
    var params = typeof edParams === 'object' && edParams ? edParams : {};
    return {
      design: t ? str(t.label) : '', size: fmt && typeof owSizeName === 'function' ? owSizeName(fmt) : str(EDIT.fmt),
      theme: params.theme === 'light' ? 'light' : 'dark', width: EDIT.width, height: EDIT.height,
      words: (easy ? easy.words() : []).map(function (w) { return { target: str(w.id), name: w.name, text: w.text }; }),
      people: (easy ? easy.people() : []).map(function (h) { return { kind: h.kind, id: str(h.person && h.person.id) }; }),
      caption: cap && cap.shown != null ? { network: cap.network, text: cap.shown } : null,
      perSpeaker: EDIT.tid === 'speaker.individual' && !!roster && roster.speakers.length > 1
    };
  }
  /* a mail's words: every text field of every section, and the rows of a list that are not people (a speakers or
     partners section's rows are its people: those change through `people`) */
  function mailWords(blocks) {
    var out = [];
    blocks.forEach(function (b) {
      if (!b || typeof b.type !== 'string' || !b.props) return;
      var schema = (typeof BS !== 'undefined' && BS[b.type]) || {}, label = schema.label || b.type;
      var people = b.type === 'speaker' || !!owMultipickOf(b);
      (schema.fields || []).forEach(function (f) {
        if (f.type === 'text' || f.type === 'textarea') {
          if (b.type === 'speaker' && /^(?:name|role|company)$/.test(f.key)) return;
          var v = b.props[f.key];
          if (typeof v === 'string' && v.trim()) out.push({ target: b.id + '|' + f.key, name: label + ' · ' + (f.label || f.key), text: v });
        } else if (f.type === 'list' && f.key === 'items' && !people && Array.isArray(b.props.items)) {
          b.props.items.forEach(function (it, i) {
            (f.itemFields || []).forEach(function (x) {
              if (x.type && x.type !== 'text' && x.type !== 'textarea') return;
              var v = it && it[x.key];
              if (typeof v === 'string' && v.trim()) out.push({ target: b.id + '|items.' + i + '.' + x.key, name: label + ' · ' + (x.label || x.key) + ' ' + (i + 1), text: v });
            });
          });
        }
      });
    });
    return out;
  }
  function mailPeople(blocks) {
    var out = [];
    blocks.forEach(function (b) {
      if (!b || !b.props) return;
      var label = ((typeof BS !== 'undefined' && BS[b.type]) || {}).label || b.type;
      if (b.type === 'speaker') { out.push({ target: b.id, kind: 'focus', name: label, max: 1, now: [str(b.props.name)].filter(Boolean) }); return; }
      var mp = owMultipickOf(b);
      if (!mp) return;
      out.push({ target: b.id, kind: mp.source, name: label, max: +b.props.max || 0,
        now: (Array.isArray(b.props.items) ? b.props.items : []).map(function (it) { return str(mp.source === 'speakers' ? it.name : it.title); }).filter(Boolean) });
    });
    return out;
  }
  function mailState() {
    var blocks = (MD.doc && MD.doc.blocks) || [];
    var m = typeof findMailer === 'function' ? findMailer(MD.id) : null;
    return { design: m ? str(m.label) : '', subject: str(MD.doc && MD.doc.subject), preview: str(MD.doc && MD.doc.preheader),
      words: mailWords(blocks), people: mailPeople(blocks) };
  }
  function state() {
    if (!editorOpen()) return null;
    return KIND === 'post' ? postState() : mailState();
  }

  /* ---------- ETB2B AI's change, through the editors' own paths ---------- */
  function postNow() { return JSON.stringify(EDIT.els); }
  function flashPost(ids) {
    var nodes = [];
    EDIT.els.forEach(function (el, i) { if (el && ids.indexOf(el.id) !== -1 && edNodes[i]) nodes.push(edNodes[i]); });
    nodes.forEach(function (n) { n.classList.add('ow-ai-flash'); });
    setTimeout(function () { nodes.forEach(function (n) { n.classList.remove('ow-ai-flash'); }); }, FLASH_MS);
  }
  function rosterFind(list, id) { return arr(list).filter(function (x) { return x && str(x.id) === str(id); })[0] || null; }
  function applyPost(c, turnId) {
    var easy = window.OWSEasy, done = [], notDone = [];
    if (!easy || !EDIT.width) return { changed: false, done: done, notDone: [TEXT.notOpen] };
    var words = easy.words(), byId = {};
    words.forEach(function (w) { byId[str(w.id)] = w; });
    var list = [], ids = [];
    arr(c.words).forEach(function (w) {
      var row = byId[str(w.target)];
      if (!row) { notDone.push('A text ' + TEXT.noText); return; }
      list.push({ id: row.id, set: { text: str(w.text) } });
      ids.push(row.id);
      done.push('Changed “' + row.name + '”');
    });
    var hits = easy.people(), roster = easy.state && easy.state.rosterNow, after = hits.slice(), swapped = false;
    arr(c.people).forEach(function (p) {
      var k = +p.target, hit = hits[k];
      if (!hit) { notDone.push('A person ' + TEXT.noText); return; }
      if (!roster) { notDone.push('A swap — ' + TEXT.noRoster); return; }
      var to = rosterFind(hit.kind === 'speaker' ? roster.speakers : roster.sponsors, (p.ids || [])[0]);
      if (!to) { notDone.push('A swap — ' + TEXT.noPerson); return; }
      var plan = easy.pure.swapPlan(EDIT.els, hit, to);
      var who = hit.kind === 'speaker' ? to.name : to.title;
      if (!plan.ok || !plan.changes.length) { notDone.push(who + ' ' + TEXT.notInPlace); return; }
      plan.changes.forEach(function (ch) { list.push(ch); ids.push(ch.id); });
      after[k] = { kind: hit.kind, person: to };
      swapped = true;
      done.push(who + ' is on the post now');
    });
    var before = postNow();
    var capBefore = null, capChanged = false;
    if (list.length) easy.set(list, { from: 'ai' });
    if (swapped) easy.setPeople(easy.pure.peopleParams(EDIT.tid, after));
    if (c.caption && window.OWSCap && OWSCap.get) {
      capBefore = OWSCap.get();
      /* in "Edit with AI" the caption box is out of sight, so the answer says the words */
      if (capBefore && OWSCap.set(str(c.caption))) { capChanged = true; done.push('Wrote the caption: “' + shortWords(c.caption) + '”'); }
    }
    var changed = postNow() !== before || capChanged;
    if (changed) {
      /* one step: the one write records it (OWSEasy.set; the people setting rides on that step, the caption is
         put back here). Counted by the write, not by the history's length, which stops growing at 80 steps. */
      records.push({ turnId: turnId, kind: 'post', tid: EDIT.tid, fmt: EDIT.fmt, steps: list.length ? 1 : 0, after: postNow(), histLen: edHist.length,
        caption: capChanged ? capBefore : null, captionAfter: capChanged ? str(c.caption) : null });
      if (typeof easy.repaint === 'function') easy.repaint();
      flashPost(ids);
    }
    return { changed: changed, done: done, notDone: notDone };
  }
  /* the mail: every part of the change in one step of the studio's history (owHistNow before and after; each part
     through owMailEdit as a keystroke would go, gathered, then one redraw) */
  function mailRow(source, x, old) {
    var name = source === 'speakers' ? x.name : x.title;
    var keep = arr(old).filter(function (it) { return it && str(source === 'speakers' ? it.name : it.title).toLowerCase() === str(name).toLowerCase(); })[0];
    if (keep) return keep;
    if (source === 'speakers') return { name: x.name || '', role: x.designation || '', company: x.company || '', photo: x.photoUrl || '' };
    if (source === 'sessions') return { time: x.time || '', title: x.title || '', who: x.who || '' };
    return { title: x.title || '', logo: x.logoUrl || '', url: x.url || '', tier: x.tier || '' };
  }
  function flashMail(paths) {
    var f = doc.getElementById('mlFrame'), d = null;
    try { d = f && f.contentDocument; } catch (e) { d = null; }
    if (!d) return;
    var nodes = arr(d.querySelectorAll('[data-ed]')).filter(function (n) { var p = n.getAttribute('data-ed') || ''; return paths.some(function (x) { return p === x || p.indexOf(x + '#') === 0 || p.split('|')[0] === x; }); });
    if (nodes[0] && nodes[0].scrollIntoView) { try { nodes[0].scrollIntoView({ block: 'center' }); } catch (e) { /* drawn already */ } }
    nodes.forEach(function (n) { n.style.outline = '2px solid #8A5A9E'; n.style.outlineOffset = '3px'; });
    setTimeout(function () { nodes.forEach(function (n) { n.style.outline = ''; n.style.outlineOffset = ''; }); }, FLASH_MS);
  }
  function applyMail(c, turnId) {
    var done = [], notDone = [], paths = [];
    if (!MD.doc) return Promise.resolve({ changed: false, done: done, notDone: [TEXT.notOpen] });
    owHistNow();
    var before = mlHistSnap();
    var edits = [];
    var names = {};
    mailWords(MD.doc.blocks || []).forEach(function (w) { names[w.target] = w.name; });
    arr(c.words).forEach(function (w) {
      var path = str(w.target);
      if (!own(names, path) || !owBlockById(path.split('|')[0])) { notDone.push('A text ' + TEXT.noText); return; }
      edits.push({ kind: 'words', path: path, value: str(w.text), typing: true });
      paths.push(path);
      done.push('Changed “' + names[path] + '”');
    });
    /* in "Edit with AI" the pinned subject and preview text are out of sight, so the answer says the words */
    if (c.subject) { edits.push({ kind: 'subject', value: str(c.subject), typing: true }); done.push('Wrote the subject line: “' + shortWords(c.subject) + '”'); }
    if (c.preview) { edits.push({ kind: 'preview', value: str(c.preview), typing: true }); done.push('Wrote the preview text: “' + shortWords(c.preview) + '”'); }
    arr(c.people).forEach(function (p) {
      var b = owBlockById(str(p.target));
      if (!b) { notDone.push('A people section — ' + TEXT.noBlock); return; }
      var label = ((typeof BS !== 'undefined' && BS[b.type]) || {}).label || b.type;
      if (b.type === 'speaker') {
        var x = rosterFind(MLA.speakers, (p.ids || [])[0]);
        if (!x) { notDone.push('“' + label + '” — ' + (MLA.loaded ? TEXT.noPerson : TEXT.noRoster)); return; }
        edits.push({ kind: 'person', block: b.id, person: { name: x.name, role: x.designation, company: x.company, photo: x.photoUrl }, typing: true });
        paths.push(b.id);
        done.push(x.name + ' is the speaker in focus');
        return;
      }
      var mp = owMultipickOf(b);
      if (!mp) { notDone.push('“' + label + '” — ' + TEXT.noBlock); return; }
      var rows = [], missing = 0;
      arr(p.ids).forEach(function (id) { var x = rosterFind(MLA[mp.source], id); if (x) rows.push(mailRow(mp.source, x, b.props.items)); else missing++; });
      if (missing) notDone.push(missing + ' of them — ' + (MLA.loaded ? TEXT.noPerson : TEXT.noRoster));
      if (!rows.length) return;
      edits.push({ kind: 'people', block: b.id, items: rows, typing: true });
      paths.push(b.id);
      done.push('“' + label + '” shows ' + rows.length + ' now');
    });
    return edits.reduce(function (p, e) { return p.then(function () { return owMailEdit(e); }); }, Promise.resolve()).then(function () {
      if (!edits.length) return { changed: false, done: [], notDone: notDone };
      MD.dirty = true;
      mlProps(); mlStatus(); mlRender(0);
      owHistNow();
      var after = mlHistSnap(), changed = after !== before;
      if (changed) {
        records.push({ turnId: turnId, kind: 'mail', id: MD.id, after: after });
        setTimeout(function () { flashMail(paths); }, 900);
      }
      return { changed: changed, done: changed ? done : [], notDone: notDone };
    });
  }
  function apply(changes, turnId) {
    if (!editorOpen()) return Promise.resolve({ changed: false, done: [], notDone: [TEXT.notOpen] });
    commitTyping();
    try {
      return Promise.resolve(KIND === 'post' ? applyPost(changes || {}, str(turnId)) : applyMail(changes || {}, str(turnId)));
    } catch (e) {
      return Promise.resolve({ changed: false, done: [], notDone: ['The change could not be made: ' + str(e && e.message)] });
    }
  }

  /* A new background (ETB2B AI pictures): a picture layer at the back of the post, cover-fitted, with a veil above it
     in the post's theme, so the words over it stay readable. A background ETB2B AI made before is replaced in place. */
  var BG_ROLE = 'ow-ai-background', VEIL_ROLE = 'ow-ai-veil';
  function background(url, turnId) {
    if (KIND !== 'post' || !editorOpen() || !EDIT.width) return Promise.resolve({ changed: false, done: [], notDone: [TEXT.notOpen] });
    url = str(url);
    if (!/^https:\/\//.test(url)) return Promise.resolve({ changed: false, done: [], notDone: ['The new background has no address'] });
    commitTyping();
    var before = postNow();
    var at = -1;
    EDIT.els.forEach(function (el, i) { if (el && el.owRole === BG_ROLE) at = i; });
    if (at !== -1) window.OWSEasy.set([{ i: at, id: EDIT.els[at].id, set: { src: url } }], { from: 'ai' });
    else {
      var dark = !(edParams && edParams.theme === 'light'), stamp = Date.now();
      var pic = { id: 'aibg' + stamp, type: 'image', x: 0, y: 0, w: EDIT.width, h: EDIT.height, src: url, objectFit: 'cover', objectPosition: 'center',
        background: 'rgba(0, 0, 0, 0)', padding: '0', radius: '0', boxShadow: 'none', rotate: 0, owRole: BG_ROLE };
      var veil = { id: 'aiveil' + stamp, type: 'shape', x: 0, y: 0, w: EDIT.width, h: EDIT.height, background: dark ? 'rgba(8, 10, 22, 0.45)' : 'rgba(255, 255, 255, 0.55)',
        backdropFilter: 'none', border: 'none', radius: '0', boxShadow: 'none', rotate: 0, owRole: VEIL_ROLE };
      pushHistory();
      EDIT.els.unshift(pic, veil);
      buildNodes(); layoutStage(); selectEl(-1);
      if (window.OWSEasy && OWSEasy.repaint) OWSEasy.repaint();
    }
    var changed = postNow() !== before;
    if (changed) records.push({ turnId: str(turnId), kind: 'post', tid: EDIT.tid, fmt: EDIT.fmt, steps: 1, after: postNow(), histLen: edHist.length, caption: null });
    return Promise.resolve({ changed: changed, done: changed ? ['A new background, behind the post’s words and logo'] : [], notDone: [] });
  }

  /* ---------- Undo, with no AI call ---------- */
  function undoRecord(r) {
    if (r.kind === 'post') {
      if (!editorOpen() || EDIT.tid !== r.tid || EDIT.fmt !== r.fmt) return { ok: false, why: TEXT.gone };
      var capNow = null;
      try { capNow = r.caption && window.OWSCap ? OWSCap.get() : null; } catch (e) { capNow = null; }
      if (postNow() !== r.after || edHist.length !== r.histLen || (r.caption && capNow && capNow.text !== r.captionAfter)) return { ok: false, why: TEXT.changedSince };
      for (var i = 0; i < r.steps; i++) edUndo();
      if (r.caption) OWSCap.set(r.caption.text, r.caption.network);
      if (window.OWSEasy && OWSEasy.repaint) OWSEasy.repaint();
      return { ok: true };
    }
    if (!editorOpen() || MD.id !== r.id) return { ok: false, why: TEXT.gone };
    if (mlHistSnap() !== r.after || MLH.stack[MLH.at] !== r.after) return { ok: false, why: TEXT.changedSince };
    mlUndo();
    return { ok: true };
  }
  /* a change's parts are taken back newest first; one that cannot be (the post moved on) stops it there */
  function undo(turnId) {
    turnId = str(turnId);
    commitTyping();
    var mine = records.filter(function (r) { return r.turnId === turnId && !r.undone; });
    if (!mine.length) return Promise.resolve({ ok: false, why: TEXT.gone });
    for (var i = mine.length - 1; i >= 0; i--) {
      var got = undoRecord(mine[i]);
      if (!got.ok) return Promise.resolve(got);
      mine[i].undone = true;
    }
    return Promise.resolve({ ok: true });
  }
  function canUndo(turnId) { return records.some(function (r) { return r.turnId === str(turnId) && !r.undone; }); }

  /* ---------- one post per speaker, for the person's own Download ---------- */
  function perSpeaker() {
    if (KIND !== 'post' || !window.OWSEasy || !editorOpen()) return Promise.reject(new Error(TEXT.notOpen));
    return Promise.resolve(OWSEasy.perSpeaker(null, { keep: true })).then(function (got) {
      if (!got || !got.blob) throw new Error('The speaker posts could not be drawn.');
      var id = 'z' + (++keptN);
      kept[id] = got;
      return { id: id, count: got.count, message: got.message };
    });
  }
  function download(id) {
    var got = kept[str(id)];
    if (!got) return false;
    var a = doc.createElement('a');
    a.href = URL.createObjectURL(got.blob);
    a.download = got.name;
    doc.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
    return true;
  }

  window.OWAi = {
    kind: function () { return KIND; },
    eventId: function () { return EV; },
    active: function () { return editorOpen() && mode === 'ai'; },
    mode: function () { return mode; },
    setMode: setMode,
    state: state,
    apply: apply,
    background: background,
    undo: undo,
    canUndo: canUndo,
    perSpeaker: perSpeaker,
    download: download,
    chatOpen: function (open) { doc.body.classList.toggle('ow-ai-chat-open', !!open); if (mode === 'ai') relayout(); },
    /* pure parts, for functions/lib/promo-ai-mode.test.js */
    _test: { mailWords: mailWords, mailPeople: mailPeople, mailRow: mailRow, records: records }
  };

  /* the page tells this frame when ETB2B AI's panel opens or closes */
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    if (framed() && e.source !== window.parent) return;
    if (e.data.rvAiChat != null) window.OWAi.chatOpen(e.data.rvAiChat === true);
  });
  watchOpen();
  if (editorOpen()) { wasOpen = true; buildToggle(); setMode(remembered() || 'manual', { quiet: true }); }
})();
