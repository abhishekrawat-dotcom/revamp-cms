/* The social post editor's easy panel (UX-122, owner decision #9, promo-easy-edit/DESIGN.md §1), on Promotions →
   Social posts (promo-social-studio.html). The editor is the platform's own (promo-studio/social-studio.js); its
   tools (Style, Insert, Options) are for designers. Event managers and marketers get, beside the post:

     1. WORDS: every text on the post as a box with a plain name ("Small line above the title", "Date", "Button"),
        and the post's own words can be typed on the post itself: a click on a word (a double click while Advanced
        layout is open, where a click picks it up to move it) puts the cursor there.
     2. PICTURES: the background (the design's own, the design file's, Background 1-3) with "Use for all posts", and
        the logo the posts use ("Using your site's logo · Replace").
     3. PEOPLE (a post with speakers or partners on it): each person on the post can be swapped for another IN PLACE:
        name, title and picture change and every layout edit stays. On a speaker card, "Make one post per speaker".
     4. CAPTION: Oneworld's caption (oneworld-social-caption.js), as the Caption tab had it.
     ▸ ADVANCED LAYOUT: the platform's tabs as they were (patch S17′ draws them in owSideHost), and Reset.

   Every change the panel makes to the post goes through one function, owSetEls (window.OWSEasy.set): it changes the
   elements, records one Undo step (a burst of typing in one box is one step), and puts the change on the canvas and
   in every box that shows it. ETB2B AI (batch B18-ai) is to make its changes through it too.

   The easy panel and the tools edit the same element list (EDIT.els), so switching between them loses nothing and
   Undo / Redo cover both. ES5; it loads after oneworld-social.js and oneworld-social-art.js, before the caption
   file. Everything here is inside one function: the platform's code declares names with const and let. */
(function () {
  'use strict';

  /* ---------- plain names for what is on a post ---------- */

  /* the templates' class names (the flattener's owRole, promo-engine/src/render/extract.ts) and what an event manager
     calls them. A class used by several templates for the same thing has one name. */
  var ROLE_NAMES = {
    'an-save': 'Small line above the title', 'tst-kicker': 'Small line above the title', 'ps-welcome': 'Small line above the title',
    'an-date': 'Date', 'an-venue': 'Venue', 'footer-when': 'Date and venue', cta: 'Button', 'an-cta': 'Button',
    hashtag: 'Hashtag', ribbon: 'Edition', 'lockup-name': 'Event name', 'lockup-presenter': 'Presented by', 'lockup-tagline': 'Tagline',
    'wsa-title': 'Title', 'sh-title': 'Title', 'po-title': 'Title', 'tl-title': 'Title', 'cs-title': 'Title',
    'wsa-item': 'Who should attend', 'sh-v': 'Number', 'sh-l': 'What the number counts', v: 'Number', l: 'What the number counts',
    'po-label': 'Card label', 'po-text': 'Card text', 'tst-quote': 'Quote',
    'tst-attr-name': 'Speaker’s name', 'tst-attr-title': 'Speaker’s title', 'cs-nm': 'Speaker’s name', 'cs-rl': 'Speaker’s title',
    'spk-role': 'Label above the name', 'spk-name': 'Speaker’s name', 'spk-desig': 'Designation', 'spk-company': 'Company',
    'ps-name': 'Partner’s name', 'ps-tier': 'Partner tier', 'tl-tier-name': 'Tier name', 'ow-qr-t': 'QR code caption', chip: 'Label'
  };
  /* class names that say how a thing looks, not what it is: a more telling class beside one of them names it */
  var GENERIC = { chip: true, frost: true, v: true, l: true };
  /* decoration typed as a character: not a word anyone changes */
  var NOT_WORDS = { 'tst-quotemark': true };
  /* the templates whose post is one person, and the option that picks that person */
  var ONE_PERSON = { 'speaker.individual': 'speakerId', 'generic.testimonial': 'speakerId', 'partner.presenting-spotlight': 'sponsorId' };
  /* the templates whose post is a group, and the option that lists them */
  var GROUP = { 'speaker.combined': 'speakerIds', 'partner.tier-ladder': 'sponsorIds' };
  var PER_SPEAKER = 'speaker.individual';
  /* typing in one box within this long is one step of Undo */
  var STEP_MS = 1500;
  var LONG = 6000;

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function arr(x) { return Array.prototype.slice.call(x || []); }
  function squash(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function el$(id) { return document.getElementById(id); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(text, cls, onclick) {
    var b = make('button', cls || 'btn alt sm', text);
    b.setAttribute('type', 'button');
    if (onclick) b.onclick = onclick;
    return b;
  }
  function say(m, kind) { if (typeof toast === 'function') toast(m, kind === 'error' ? LONG : undefined, kind); }

  /* the plain name of an element from its owRole, or '' */
  function roleName(el) {
    var classes = String((el && el.owRole) || '').split(/\s+/).filter(Boolean), best = '';
    for (var i = 0; i < classes.length; i++) {
      if (!own(ROLE_NAMES, classes[i])) continue;
      if (!GENERIC[classes[i]]) return ROLE_NAMES[classes[i]];
      if (!best) best = ROLE_NAMES[classes[i]];
    }
    return best;
  }
  function isDecoration(el) { return String((el && el.owRole) || '').split(/\s+/).some(function (c) { return NOT_WORDS[c]; }); }

  /* The Words list: every text element, top to bottom then left to right, each with its plain name; a name used more
     than once is numbered ("Number 1", "Number 2"); a text with no known name (a layout saved before owRole, or text
     the user added) is "Text 1", "Text 2". -> [{ i, id, name, text }] */
  function wordsOf(els) {
    var rows = [];
    arr(els).forEach(function (el, i) {
      if (!el || el.type !== 'text' || isDecoration(el)) return;
      rows.push({ i: i, id: el.id, name: roleName(el) || 'Text', text: String(el.text == null ? '' : el.text), y: +el.y || 0, x: +el.x || 0 });
    });
    rows.sort(function (a, b) { return Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x; });
    var count = {}, seen = {};
    rows.forEach(function (r) { count[r.name] = (count[r.name] || 0) + 1; });
    rows.forEach(function (r) {
      if (count[r.name] > 1) { seen[r.name] = (seen[r.name] || 0) + 1; r.name = r.name + ' ' + seen[r.name]; }
      delete r.x; delete r.y;
    });
    return rows;
  }

  /* ---------- the one write: change elements, record Undo, show it everywhere ---------- */

  var OWE = { lastStep: '', lastAt: 0, typing: null, down: null, adv: false, capOpen: false, roster: null, people: [], openAt: null, busy: false };

  /* the index of a change's element: c.i when it still holds that element (c.id), else by id */
  function indexOf(c) {
    var els = EDIT.els;
    if (typeof c.i === 'number' && els[c.i] && (c.id == null || els[c.i].id === c.id)) return c.i;
    if (c.id == null) return -1;
    for (var k = 0; k < els.length; k++) if (els[k] && els[k].id === c.id) return k;
    return -1;
  }
  /* changes: [{ i or id, set: { field: value } }]. opts: { step: a key that keeps a burst of typing in one Undo step,
     from: 'words' | 'canvas' | 'people' | 'ai' (the box being typed in is not rewritten under the cursor) }.
     Returns how many elements changed. */
  function setEls(changes, opts) {
    opts = opts || {};
    if (!EDIT || !EDIT.width) return 0;
    var list = arr(changes).map(function (c) { return c && c.set ? { i: indexOf(c), set: c.set } : null; })
      .filter(function (c) { return c && c.i >= 0; });
    if (!list.length) return 0;
    var now = Date.now();
    if (!(opts.step && OWE.lastStep === opts.step && now - OWE.lastAt < STEP_MS)) pushHistory();
    /* after pushHistory: it calls updUndo, which starts a new step (an Undo always does) */
    OWE.lastStep = opts.step || '';
    OWE.lastAt = now;
    list.forEach(function (c) {
      var el = EDIT.els[c.i];
      Object.keys(c.set).forEach(function (k) { el[k] = c.set[k]; });
      /* S16's rule: a line break in one-line text breaks the line */
      if (c.set.text != null && /\n/.test(String(el.text)) && el.whiteSpace === 'nowrap') el.whiteSpace = 'pre-wrap';
      var node = edNodes[c.i], typing = OWE.typing && OWE.typing.el === el && opts.from === 'canvas';
      if (node && !typing) applyNode(node, el);
      mirror(c.i, el, opts.from);
    });
    if (typeof layoutGroupFrame === 'function') layoutGroupFrame();
    if (typeof owFillerNote === 'function') owFillerNote();
    return list.length;
  }
  /* the boxes that show an element, brought up to date (never the one being typed in) */
  function mirror(i, el, from) {
    if (from !== 'words') {
      var box = document.querySelector('#owEasy [data-ow-key="w:' + cssId(el.id) + '"]');
      if (box && box !== document.activeElement) { box.value = String(el.text == null ? '' : el.text); fit(box); }
    }
    if (i === edSel) {
      var tx = el$('epText');
      if (tx && tx !== document.activeElement && el.type === 'text') tx.value = el.text || '';
      if (typeof updLayerLabel === 'function') updLayerLabel();
    }
  }
  function cssId(id) { return String(id).replace(/["\\]/g, ''); }
  /* a box as tall as its words, up to 6 lines */
  function fit(ta) {
    var lines = String(ta.value || '').split('\n').length;
    ta.rows = Math.max(1, Math.min(6, lines + (ta.value.length > 42 ? 1 : 0)));
  }

  /* ---------- Undo and Redo cover the people on the post too ----------
     The platform's history (edHist, edRedo) keeps only the elements. A swap in place also changes which person the
     post's options pick (edParams.speakerId and the like), and the caption, Download all sizes, a later Update post
     and Save all read those options. So beside each step of the history is the people setting it had (OWE.hp for
     edHist, OWE.rp for edRedo, one each, newest last): Undo and Redo put the elements and the setting back together,
     and the caption follows. Without this, Undo showed the old speaker while the caption and a Save named the new one. */
  var PEOPLE_KEYS = ['speakerId', 'sponsorId', 'speakerIds', 'sponsorIds'];
  OWE.hp = [];
  OWE.rp = [];
  /* the four options a swap changes, as JSON (one string per step, compared as it is) */
  function peopleOf(p) {
    var o = {};
    p = p || {};
    PEOPLE_KEYS.forEach(function (k) { if (p[k] !== undefined) o[k] = p[k]; });
    return JSON.stringify(o);
  }
  /* options p with the people setting `json` in place of its own (an option the setting has not is taken out) */
  function withPeople(p, json) {
    var o = JSON.parse(json), out = Object.assign({}, p || {});
    PEOPLE_KEYS.forEach(function (k) { if (own(o, k)) out[k] = o[k]; else delete out[k]; });
    return out;
  }
  /* The post's people setting becomes `json`; the caption is told when it changed. The options the layout on screen
     was drawn with (OWS.loaded.params) follow too: a "Discard your changes?" answered Keep editing puts the options
     back from them (owRestoreControls), and they must name the people the post shows now, not those it was drawn with. */
  function setPeople(json) {
    if (json == null) return false;
    var changed = json !== peopleOf(edParams);
    edParams = withPeople(edParams, json);
    if (window.OWS && OWS.loaded) OWS.loaded.params = withPeople(OWS.loaded.params, json);
    if (changed) tellCaption();
    return changed;
  }
  /* One people setting per step, whatever the platform did to its lists: a load or a Reset empties them, more than 80
     steps drop the oldest. They line up from the newest; a step this file never saw has none (null: Undo leaves the
     setting as it is). */
  function lineUp() {
    function fitTo(a, n) { a = a.slice(Math.max(0, a.length - n)); while (a.length < n) a.unshift(null); return a; }
    OWE.hp = fitTo(OWE.hp, edHist.length);
    OWE.rp = fitTo(OWE.rp, edRedo.length);
  }
  /* an Undo or Redo starts a new step: the next word typed is undone on its own */
  var updUndo0 = updUndo;
  updUndo = function () { OWE.lastStep = ''; lineUp(); return updUndo0.apply(this, arguments); };
  /* A step is the elements and the people setting before a change. One that would put back what is on screen already
     is not made: a click on a word starts a drag (the platform's startDrag records a step) and typing in it then
     recorded a second, the same, so the first Undo changed nothing. A new change still ends Redo, as it always did. */
  var pushHistory0 = pushHistory;
  pushHistory = function () {
    var ppl = peopleOf(edParams);
    if (edHist.length && edHist[edHist.length - 1] === JSON.stringify(EDIT.els) && OWE.hp[OWE.hp.length - 1] === ppl) {
      edRedo = [];
      updUndo();
      return;
    }
    OWE.hp.push(ppl);
    return pushHistory0.apply(this, arguments);
  };
  /* the setting goes back first, so the side the platform's Undo draws (selectEl, paintSide) shows it */
  var edUndo0 = edUndo;
  edUndo = function () {
    if (OWE.typing) stopTyping();
    if (edHist.length) {
      lineUp();
      var back = OWE.hp.pop();
      OWE.rp.push(peopleOf(edParams));
      setPeople(back);
    }
    return edUndo0.apply(this, arguments);
  };
  var edRedoFn0 = edRedoFn;
  edRedoFn = function () {
    if (OWE.typing) stopTyping();
    if (edRedo.length) {
      lineUp();
      var fwd = OWE.rp.pop();
      OWE.hp.push(peopleOf(edParams));
      setPeople(fwd);
    }
    return edRedoFn0.apply(this, arguments);
  };

  /* ---------- the side: easy panel, then Advanced layout ---------- */

  /* where the platform's tabs are drawn (patch S17′): inside Advanced layout, built when it is not there (a load
     replaces the whole side with a spinner, or "Couldn't load this template.") */
  function sideHost() {
    var side = el$('edSide'), host = el$('owAdvHost');
    if (host && side && side.contains(host)) return host;
    side.textContent = '';
    var easy = make('div', 'ow-easy');
    easy.id = 'owEasy';
    var adv = make('details', 'ow-adv');
    adv.id = 'owAdv';
    if (OWE.adv) adv.setAttribute('open', '');
    var sum = make('summary', 'ow-adv-s', 'Advanced layout');
    adv.appendChild(sum);
    adv.appendChild(make('div', 'ow-adv-note', 'Move, resize, rotate and restyle each part, add text, pictures or shapes, and the design’s own options.'));
    host = make('div', 'ow-adv-host');
    host.id = 'owAdvHost';
    adv.appendChild(host);
    var reset = button('Reset to the design', 'btn ghost sm ow-adv-reset', function () { edReset(); });
    reset.setAttribute('title', 'Deletes the layout saved for this size, theme and background, and draws the post from the design again');
    adv.appendChild(reset);
    adv.addEventListener('toggle', function () {
      if (OWE.adv === adv.open) return;
      OWE.adv = adv.open;
      var ed = el$('editor');
      if (ed) ed.classList.toggle('ow-adv-open', OWE.adv);
      paintEasy();
    });
    side.appendChild(easy);
    side.appendChild(adv);
    return host;
  }
  window.owSideHost = sideHost;

  /* paintSide draws the tools; the easy panel is drawn after it. A Layers row keeps the focus when the panel is drawn
     again (UX-131: Enter on a row selects it, which draws the panel again). */
  var paintSide0 = paintSide;
  paintSide = function () {
    var ae = document.activeElement;
    var layer = ae && ae.classList && ae.classList.contains('ed-layer') ? ae.getAttribute('data-i') : null;
    var r = paintSide0.apply(this, arguments);
    paintEasy();
    if (layer != null) {
      var row = document.querySelector('#owAdvHost .ed-layer[data-i="' + layer.replace(/\D/g, '') + '"]');
      if (row) row.focus();
    }
    return r;
  };

  /* the easy panel, drawn afresh; a box being typed in keeps the focus and the cursor */
  function paintEasy() {
    sideHost();
    var easy = el$('owEasy');
    if (!easy) return;
    var ae = document.activeElement, key = ae && easy.contains(ae) && ae.getAttribute ? ae.getAttribute('data-ow-key') : null;
    var sel = key && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd] : null;
    easy.textContent = '';
    if (!EDIT || !EDIT.width) return;
    easy.appendChild(wordsSection());
    easy.appendChild(picturesSection());
    var ppl = peopleSection();
    if (ppl) easy.appendChild(ppl);
    captionSection(easy);
    markSelected();
    if (key) {
      var again = easy.querySelector('[data-ow-key="' + key.replace(/["\\]/g, '') + '"]');
      if (again) { again.focus(); if (sel && again.setSelectionRange) { try { again.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not text */ } } }
    }
  }

  function section(title, id) {
    var s = make('section', 'ow-easy-sec');
    if (id) s.id = id;
    var h = make('h3', 'ow-easy-h', title);
    s.appendChild(h);
    return s;
  }

  /* ---------- 1. Words ---------- */

  function wordsSection() {
    var s = section('Words', 'owWords');
    var rows = wordsOf(EDIT.els);
    if (!rows.length) s.appendChild(make('p', 'ow-easy-empty', 'This post has no words of its own to change.'));
    rows.forEach(function (r) {
      var f = make('div', 'ow-word');
      f.setAttribute('data-ow-el', r.id);
      var id = 'owW_' + String(r.id).replace(/[^A-Za-z0-9_-]/g, '_');
      var lab = make('label', 'ow-word-l', r.name);
      lab.setAttribute('for', id);
      var ta = make('textarea', 'ow-word-t');
      ta.id = id;
      ta.value = r.text;
      ta.setAttribute('data-ow-key', 'w:' + cssId(r.id));
      ta.setAttribute('spellcheck', 'true');
      fit(ta);
      ta.oninput = function () {
        fit(ta);
        setEls([{ i: r.i, id: r.id, set: { text: ta.value } }], { step: 'words:' + r.id, from: 'words' });
      };
      ta.onfocus = function () { highlight(r.id, true); };
      ta.onblur = function () { highlight(r.id, false); };
      f.appendChild(lab);
      f.appendChild(ta);
      s.appendChild(f);
    });
    quoteBox(s);
    s.appendChild(make('p', 'ow-easy-hint', OWE.adv
      ? 'Double-click a word on the post to type there too.'
      : 'Or click a word on the post and type there.'));
    return s;
  }
  /* the post's outline follows the box being typed in */
  function highlight(id, on) {
    var k = -1;
    EDIT.els.forEach(function (e, i) { if (e && e.id === id) k = i; });
    if (k >= 0 && edNodes[k]) edNodes[k].classList.toggle('ow-hl', !!on);
  }
  /* a Testimonial shows no quote until one is typed (a real one, never a made-up one): until then its quote is an
     option of the design, written here and put on the post with Update post */
  function quoteBox(s) {
    if (EDIT.tid !== 'generic.testimonial') return;
    if (EDIT.els.some(function (e) { return e && e.type === 'text' && /\btst-quote\b/.test(String(e.owRole || '')); })) return;
    var f = make('div', 'ow-word');
    var lab = make('label', 'ow-word-l', 'Quote');
    lab.setAttribute('for', 'owQuote');
    var ta = make('textarea', 'ow-word-t');
    ta.id = 'owQuote';
    ta.rows = 3;
    ta.setAttribute('data-ow-key', 'quote');
    ta.placeholder = 'Type the speaker’s real words';
    ta.value = String((edParams && edParams.quote) || '');
    var go = button('Update post', 'btn sm', function () {
      var q = String(ta.value || '').trim();
      if (!q) { say('Type the quote first: a testimonial shows a real quote, never a made-up one.', 'error'); ta.focus(); return; }
      owMayDiscard().then(function (yes) {
        if (!yes) return;
        edParams = Object.assign({}, edParams, { quote: q });
        edMode = 'props';
        loadEditor(true);
      });
    });
    f.appendChild(lab);
    f.appendChild(ta);
    f.appendChild(go);
    s.appendChild(f);
  }
  function markSelected() {
    arr(document.querySelectorAll('#owWords .ow-word')).forEach(function (w) {
      var on = edSel >= 0 && EDIT.els[edSel] && EDIT.els[edSel].id === w.getAttribute('data-ow-el');
      w.classList.toggle('on', !!on);
      if (on && !OWE.adv && w.scrollIntoView) { try { w.scrollIntoView({ block: 'nearest' }); } catch (e) { /* old browser */ } }
    });
  }

  /* ---------- 2. Pictures ---------- */

  function art() { return (window.OWS && OWS.art && typeof OWS.art === 'object') ? OWS.art : {}; }
  function picturesSection() {
    var s = section('Pictures', 'owPictures');
    var A = window.OWSArt, a = art();
    if (!A) return s;
    /* the background */
    var row = make('div', 'ow-pic');
    var lab = make('label', 'ow-word-l', 'Background');
    lab.setAttribute('for', 'owBgSel');
    var sel = make('select', 'ow-pic-sel');
    sel.id = 'owBgSel';
    sel.setAttribute('data-ow-key', 'bg');
    var cur = A.bgValue(a, edParams && edParams.bg);
    A.bgChoices(a).forEach(function (c) {
      var o = make('option', '', c.t);
      o.value = c.v;
      if (c.v === cur) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { postBg(sel.value); };
    row.appendChild(lab);
    row.appendChild(sel);
    var dflt = A.bgValue(a, a.useBg);
    if (cur !== dflt) {
      row.appendChild(button('Use for all posts', 'btn alt sm', function () {
        var b = this;
        b.disabled = true;
        A.setUseBg(cur).then(function (got) {
          if (got) say(A.bgLabel(got, cur) + ' is now used for all posts.', 'success');
          else { b.disabled = false; say('The background could not be set for all posts. Please try again.', 'error'); }
          paintEasy();
        });
      }));
    } else row.appendChild(make('span', 'ow-pic-note', 'Used for all posts'));
    s.appendChild(row);
    if (!(a.bg1 || a.bg2 || a.bg3 || a.background)) {
      s.appendChild(make('p', 'ow-easy-hint', 'Backgrounds and a design file (.psd) are uploaded on the Social posts page, under “Pictures for your posts”.'));
    }
    /* the logo */
    var lr = make('div', 'ow-pic');
    lr.appendChild(make('span', 'ow-word-l', 'Logo'));
    lr.appendChild(make('span', 'ow-pic-t', A.logoWords(a)));
    var inp = make('input');
    inp.setAttribute('type', 'file');
    inp.setAttribute('accept', 'image/*');
    inp.setAttribute('hidden', '');
    inp.onchange = function () { var f = inp.files && inp.files[0]; inp.value = ''; if (f) replaceLogo(f); };
    var rep = button(a.logoUnit || A.siteHasLogo() ? 'Replace' : 'Upload a logo', 'btn alt sm', function () { inp.click(); });
    rep.setAttribute('aria-label', (a.logoUnit || A.siteHasLogo() ? 'Replace the logo' : 'Upload a logo') + ' on all posts');
    rep.setAttribute('data-ow-key', 'logo');
    if (OWE.busy) { rep.disabled = true; rep.textContent = 'Uploading…'; }
    lr.appendChild(rep);
    lr.appendChild(inp);
    s.appendChild(lr);
    return s;
  }
  /* this post's background: drawn again (asking first when it has unsaved edits) */
  function postBg(v) {
    var sel = el$('edBg');
    edParams = Object.assign({}, edParams, { bg: v || undefined });
    if (sel) sel.value = /^[123]?$/.test(v) ? v : '';
    return Promise.resolve(loadEditor()).then(function () { paintEasy(); });
  }
  /* a new logo for every post; on this post it takes the old logo's place (Undo puts it back), or the post is drawn
     again when it showed none */
  function replaceLogo(file) {
    var A = window.OWSArt, before = logoUrls();
    OWE.busy = true;
    paintEasy();
    return A.logo({ body: file }).then(function (r) { return r.json().then(null, function () { return {}; }).then(function (j) { return { ok: r.ok && j && j.ok, j: j }; }); })
      .then(function (got) {
        OWE.busy = false;
        if (!got.ok) { say('The logo could not be uploaded: ' + ((got.j && got.j.error) || 'please try again.'), 'error'); paintEasy(); return; }
        var now = art().units && art().units.logoUnit && art().units.logoUnit.url;
        if (typeof refreshThumbs === 'function') refreshThumbs();
        var changes = [];
        EDIT.els.forEach(function (e, i) { if (e && (e.type === 'image' || e.type === 'frame') && before.indexOf(e.src) !== -1 && now) changes.push({ i: i, id: e.id, set: { src: now } }); });
        if (changes.length) { setEls(changes, { from: 'people' }); say('Logo updated on all posts.', 'success'); paintEasy(); return; }
        say('Logo updated on all posts.', 'success');
        return Promise.resolve(loadEditor()).then(function () { paintEasy(); });
      }, function () { OWE.busy = false; say('The logo could not be uploaded. Please try again.', 'error'); paintEasy(); });
  }
  /* every address the posts' logo has now: the one uploaded, the site's own for each theme */
  function logoUrls() {
    var a = art(), out = [];
    if (a.units && a.units.logoUnit && a.units.logoUnit.url) out.push(a.units.logoUnit.url);
    var s = typeof CAT !== 'undefined' && CAT && CAT.event && CAT.event.siteLogo;
    if (s && s.dark) out.push(s.dark);
    if (s && s.light) out.push(s.light);
    return out;
  }

  /* ---------- 3. People ---------- */

  /* everyone on the event, with or without a picture (the Insert tab lists only those with one) */
  function roster() {
    if (!OWE.roster) {
      OWE.roster = owAuthed('/api/promo/mailer/roster?eventId=' + OW_E).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok || !j) throw new Error((j && j.error) || 'The speakers and partners could not be listed.');
          return { speakers: arr(j.speakers).filter(function (s) { return s && s.name; }), sponsors: arr(j.sponsors).filter(function (s) { return s && s.title; }) };
        });
      }).then(null, function (e) { OWE.roster = null; throw e; });
    }
    return OWE.roster;
  }
  /* a speaker's title as the templates write it: designation, company, or the two joined */
  function titleLines(s) {
    var d = String((s && s.designation) || '').trim(), c = String((s && s.company) || '').trim(), dc = [d, c].filter(Boolean);
    return [['d', d], ['c', c], ['dc', dc.join(', ')], ['dc-dot', dc.join(' · ')], ['dc-bar', dc.join(' | ')]].filter(function (x) { return !!x[1]; });
  }
  function titleOf(s, key) {
    var hit = titleLines(s).filter(function (x) { return x[0] === key; })[0];
    if (hit) return hit[1];
    return '';
  }
  /* The people on a post: each speaker whose name is a text on it, with the texts and the picture beside it in the
     order the template drew them (within 4 elements: a person's parts are drawn together), and each partner whose
     logo is a picture on it (or whose name is, where its logo could not be shown). A text is matched by its words now,
     else by the words the design drew in it (origOf: a title the user retyped still belongs to its person, and is
     replaced with the next person's). Names are matched on the words now first, so the person swapped in last is
     found before the one the design drew. -> [{ kind, person, name, parts: [{ i, key }], photo }] (indexes into
     els). Pure, for the tests. */
  function findPeople(els, list, origOf) {
    els = arr(els);
    var used = {}, out = [];
    origOf = typeof origOf === 'function' ? origOf : function () { return null; };
    function says(e, words) { return squash(e.text) === squash(words) || (origOf(e) != null && squash(origOf(e)) === squash(words)); }
    function near(i, test) {
      for (var d = 1; d <= 4; d++) {
        var js = [i + d, i - d];
        for (var q = 0; q < js.length; q++) { var j = js[q]; if (j >= 0 && j < els.length && !used[j] && els[j] && test(els[j])) return j; }
      }
      return -1;
    }
    function nameIs(el, s, pass) {
      if (!el || el.type !== 'text' || !squash(s.name)) return false;
      return pass === 0 ? squash(el.text) === squash(s.name) : origOf(el) != null && squash(origOf(el)) === squash(s.name);
    }
    [0, 1].forEach(function (pass) { arr(list && list.speakers).forEach(function (s) {
      if (out.some(function (h) { return h.person === s; })) return;
      els.forEach(function (el, i) {
        if (used[i] || !nameIs(el, s, pass)) return;
        used[i] = true;
        var hit = { kind: 'speaker', person: s, name: i, parts: [], photo: -1 };
        titleLines(s).forEach(function (t) {
          var j = near(i, function (e) { return e.type === 'text' && says(e, t[1]); });
          if (j >= 0) { used[j] = true; hit.parts.push({ i: j, key: t[0] }); }
        });
        if (s.photoUrl) {
          var p = near(i, function (e) { return (e.type === 'frame' || e.type === 'image') && e.src === s.photoUrl; });
          if (p >= 0) { used[p] = true; hit.photo = p; }
        }
        out.push(hit);
      });
    }); });
    arr(list && list.sponsors).forEach(function (p) {
      els.forEach(function (el, i) {
        if (used[i] || !el) return;
        var byLogo = (el.type === 'image' || el.type === 'frame') && p.logoUrl && el.src === p.logoUrl;
        var byName = el.type === 'text' && squash(el.text) === squash(p.title) && squash(p.title);
        if (!byLogo && !byName) return;
        used[i] = true;
        var hit = { kind: 'partner', person: p, name: byName ? i : -1, parts: [], photo: byLogo ? i : -1 };
        if (p.tier) {
          var t = near(i, function (e) { return e.type === 'text' && squash(e.text) === squash(p.tier); });
          if (t >= 0) { used[t] = true; hit.parts.push({ i: t, key: 'tier' }); }
        }
        out.push(hit);
      });
    });
    return out;
  }
  /* What swapping hit's person for `to` changes, in place: { ok, changes: [{ i, set }] }. ok is false when the swap
     cannot be made in place without leaving the old person's picture or showing none where the design shows one: a
     picture that was not found, or one of the two has no picture. Pure, for the tests. */
  function swapPlan(els, hit, to) {
    var out = { ok: true, changes: [] };
    if (!hit || !to) return { ok: false, changes: [] };
    if (hit.kind === 'speaker') {
      out.changes.push({ i: hit.name, set: { text: String(to.name || '') } });
      hit.parts.forEach(function (p) { out.changes.push({ i: p.i, set: { text: titleOf(to, p.key) } }); });
      if (hit.photo >= 0 && to.photoUrl) out.changes.push({ i: hit.photo, set: { src: to.photoUrl } });
      else if (hit.photo >= 0 || to.photoUrl || hit.person.photoUrl) out.ok = false;
    } else {
      if (hit.name >= 0) out.changes.push({ i: hit.name, set: { text: String(to.title || '') } });
      hit.parts.forEach(function (p) { if (p.key === 'tier') out.changes.push({ i: p.i, set: { text: String(to.tier || '') } }); });
      if (hit.photo >= 0 && to.logoUrl) out.changes.push({ i: hit.photo, set: { src: to.logoUrl } });
      else if (hit.photo >= 0 || (hit.name < 0)) out.ok = false;
      else if (to.logoUrl) out.ok = false;          // the post shows a name where this partner has a logo to show
    }
    out.changes.forEach(function (c) { c.id = els[c.i] && els[c.i].id; });
    return out;
  }
  /* the options that pick the people now on the post, so its caption, a later Update post and the saved layout
     follow the swap */
  function peopleParams(tid, people) {
    var p = {};
    if (own(ONE_PERSON, tid) && people[0]) p[ONE_PERSON[tid]] = String(people[0].person.id);
    if (own(GROUP, tid)) {
      var kind = GROUP[tid] === 'speakerIds' ? 'speaker' : 'partner';
      var ids = people.filter(function (h) { return h.kind === kind; }).map(function (h) { return String(h.person.id); });
      if (ids.length) p[GROUP[tid]] = ids;
    }
    return p;
  }

  /* the words the design drew in an element (oneworld-social.js keeps them for the layout on the stage) */
  function origText(el) {
    var o = el && window.OWS && OWS.orig ? OWS.orig[el.id] : null;
    return o && typeof o.text === 'string' ? o.text : null;
  }
  function peopleSection() {
    var tid = EDIT.tid, list = OWE.rosterNow;
    if (!list) {
      if (own(ONE_PERSON, tid) || own(GROUP, tid)) roster().then(function (r) { OWE.rosterNow = r; paintEasy(); }, function () { /* the section stays out */ });
      return null;
    }
    var people = findPeople(EDIT.els, list, origText);
    OWE.people = people;
    if (!people.length && !(own(ONE_PERSON, tid) || own(GROUP, tid))) return null;
    var s = section('People', 'owPeople');
    if (!people.length) s.appendChild(make('p', 'ow-easy-empty', 'No speaker or partner of this event was found on this post.'));
    var n = { speaker: 0, partner: 0 }, total = { speaker: 0, partner: 0 };
    people.forEach(function (h) { total[h.kind]++; });
    people.forEach(function (h, k) {
      n[h.kind]++;
      var row = make('div', 'ow-person');
      var id = 'owP_' + k;
      var label = (h.kind === 'speaker' ? 'Speaker' : 'Partner') + (total[h.kind] > 1 ? ' ' + n[h.kind] : '');
      var lab = make('label', 'ow-word-l', label);
      lab.setAttribute('for', id);
      var sel = make('select', 'ow-pic-sel');
      sel.id = id;
      sel.setAttribute('data-ow-key', 'p:' + k);
      var choices = h.kind === 'speaker' ? list.speakers : list.sponsors;
      choices.forEach(function (c, ci) {
        var words = h.kind === 'speaker' ? c.name + (titleOf(c, 'dc') ? ' — ' + titleOf(c, 'dc') : '') : c.title + (c.tier ? ' — ' + c.tier : '');
        var o = make('option', '', words);
        o.value = String(ci);
        if (c === h.person) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function () { swapTo(k, choices[+sel.value]); };
      row.appendChild(lab);
      row.appendChild(sel);
      s.appendChild(row);
    });
    if (tid === PER_SPEAKER && list.speakers.length > 1) {
      var b = button('Make one post per speaker (' + list.speakers.length + ')', 'btn sm', function () { perSpeaker(b); });
      b.id = 'owPerSpeaker';
      if (OWE.batch) { b.disabled = true; b.textContent = 'Drawing the posts…'; }
      s.appendChild(b);
      s.appendChild(make('p', 'ow-easy-hint', 'One picture for each speaker in this size, laid out as this one, in a ZIP.'));
    }
    return s;
  }
  /* swap the k-th person on the post for `to`: in place when it can be (every layout edit stays), else the post is
     drawn again from the design with them (asking first when it has unsaved edits) */
  function swapTo(k, to) {
    var hit = OWE.people[k];
    if (!hit || !to || to === hit.person) return Promise.resolve(false);
    var plan = swapPlan(EDIT.els, hit, to);
    var after = OWE.people.map(function (h, j) { return j === k ? { kind: h.kind, person: to } : h; });
    var params = peopleParams(EDIT.tid, after);
    if (plan.ok && plan.changes.length) {
      /* the step setEls records holds the people setting from before, so Undo brings back both */
      setEls(plan.changes, { from: 'people' });
      setPeople(peopleOf(Object.assign({}, edParams, params)));
      say((hit.kind === 'speaker' ? to.name : to.title) + ' is on the post now.', 'success');
      paintEasy();
      return Promise.resolve(true);
    }
    return owMayDiscard().then(function (yes) {
      if (!yes) { paintEasy(); return false; }
      edParams = Object.assign({}, edParams, params);
      tellCaption();
      say((hit.kind === 'speaker' ? to.name : to.title) + (hit.kind === 'speaker' ? ' has a different kind of picture, so the post is drawn again from the design.' : ' shows differently, so the post is drawn again from the design.'), 'info');
      return Promise.resolve(loadEditor(true)).then(function () { return true; });
    });
  }
  /* the caption follows the people on the post (its words from the event's facts are asked again) */
  function tellCaption() {
    if (window.OWSCap && typeof OWSCap.paramsChanged === 'function') OWSCap.paramsChanged(owClone(edParams));
  }

  /* "Make one post per speaker": every speaker's card in this size, as a ZIP. Each is this post with the speaker
     swapped in (its layout edits kept), or, when that cannot be done in place (a picture the design shows that one
     of them lacks), the design drawn for that speaker. */
  function perSpeaker(btn) {
    if (OWE.batch) return Promise.resolve();
    var list = OWE.rosterNow, hit = OWE.people.filter(function (h) { return h.kind === 'speaker'; })[0];
    if (!list || !list.speakers.length) return Promise.resolve();
    OWE.batch = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Drawing the posts…'; }
    var W = EDIT.width, H = EDIT.height, base = EDIT.base, els = owClone(EDIT.els), tid = EDIT.tid, fmt = EDIT.fmt, params = owClone(edParams);
    var jobs = list.speakers.map(function (s) {
      var plan = hit && s !== hit.person ? swapPlan(els, hit, s) : { ok: !!hit, changes: [] };
      return { s: s, plan: plan };
    });
    var fromDesign = jobs.filter(function (j) { return !j.plan.ok; });
    var htmlP = fromDesign.length
      ? owHtml(fromDesign.map(function (j) { return { templateId: tid, format: fmt, params: Object.assign({}, params, { speakerId: String(j.s.id) }) }; }))
      : Promise.resolve([]);
    var done = 0, zip = new JSZip(), names = {};
    function count() { say('Drawing one post per speaker… ' + done + ' of ' + jobs.length + ' ready.', 'info'); }
    count();
    return htmlP.then(function (htmls) {
      var at = 0;
      return jobs.reduce(function (p, j) {
        return p.then(function () {
          var draw;
          if (j.plan.ok) {
            var mine = owClone(els);
            j.plan.changes.forEach(function (c) { Object.keys(c.set).forEach(function (f) { mine[c.i][f] = c.set[f]; }); });
            draw = owDrawEls(W, H, base, mine);
          } else {
            var a = htmls[at++] || {};
            if (!a.html) return null;
            draw = owDraw(a.html, a.width, a.height, { lane: 'editor', ratio: 2, passes: 2, tell: true });
          }
          return draw.then(function (res) {
            var name = owSlug(j.s.name) || 'speaker';
            names[name] = (names[name] || 0) + 1;
            zip.file(name + (names[name] > 1 ? '-' + names[name] : '') + '.png', res.blob);
            done++;
            if (done < jobs.length) count();
          });
        });
      }, Promise.resolve());
    }).then(function () {
      if (!done) throw new Error('The posts could not be drawn.');
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = owSlug((CAT && CAT.event && CAT.event.name) || 'event') + '-speaker-posts-' + fmt + '.zip';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
      var size = owSizeShort(((findTpl(tid) || {}).formats || []).filter(function (f) { return f.id === fmt; })[0] || { id: fmt });
      say('✓ Downloaded ' + done + ' speaker posts (' + size + ')' + (fromDesign.length ? '. ' + fromDesign.length + ' of them ' +
        (fromDesign.length === 1 ? 'was' : 'were') + ' drawn from the design, as their picture differs from this one.' : '.'), 'success');
    }).then(null, function (e) {
      say('The speaker posts could not be made: ' + (owMessage(e) || 'please try again.'), 'error');
    }).then(function () {
      OWE.batch = false;
      var b = el$('owPerSpeaker');
      if (b) { b.disabled = false; b.textContent = 'Make one post per speaker (' + list.speakers.length + ')'; }
    });
  }

  /* ---------- 4. Caption ---------- */

  /* The caption is drawn once its section is on the page: the caption file finds its box by id (viewOf) before it
     writes the words in, so a box drawn off the page stayed empty whenever the words were known already (after an
     Undo, or a click on the post, drew the panel again), while the download still had them. */
  function captionSection(parent) {
    var d = make('details', 'ow-easy-sec ow-cap-sec');
    d.id = 'owCapSec';
    if (OWE.capOpen) d.setAttribute('open', '');
    d.appendChild(make('summary', 'ow-easy-h', 'Caption'));
    var host = make('div', 'ow-cap-host');
    host.id = 'owCapHost';
    d.appendChild(host);
    d.addEventListener('toggle', function () { OWE.capOpen = d.open; });
    parent.appendChild(d);
    if (typeof window.owRenderCaption === 'function') window.owRenderCaption(host);
    return d;
  }

  /* ---------- typing on the post itself ---------- */

  function nodeIndex(n) {
    var node = n && n.closest ? n.closest('.ednode') : null;
    return node && node.parentNode === el$('edStage') ? +node.getAttribute('data-i') : -1;
  }
  /* a click on a word (no drag) types there while Advanced layout is closed; a double click always does */
  function wireStage() {
    var st = el$('edStage');
    if (!st || st.getAttribute('data-ow-easy')) return;
    st.setAttribute('data-ow-easy', '1');
    st.addEventListener('pointerdown', function (e) {
      var t = OWE.typing;
      if (t && t.node.contains(e.target)) { e.stopPropagation(); return; }   // the cursor moves; nothing is dragged
      if (t) stopTyping();
      var i = nodeIndex(e.target);
      OWE.down = i >= 0 && EDIT.els[i] && EDIT.els[i].type === 'text' && !e.shiftKey && !e.metaKey && !e.ctrlKey
        ? { i: i, x: e.clientX, y: e.clientY } : null;
    }, true);
    document.addEventListener('pointerup', function (e) {
      var d = OWE.down;
      OWE.down = null;
      if (!d || OWE.adv || OWE.typing) return;
      if (Math.abs(e.clientX - d.x) > 4 || Math.abs(e.clientY - d.y) > 4) return;
      if (nodeIndex(e.target) !== d.i) return;
      startTyping(d.i, e.clientX, e.clientY);
    });
    st.addEventListener('dblclick', function (e) {
      var i = nodeIndex(e.target);
      if (i >= 0 && EDIT.els[i] && EDIT.els[i].type === 'text' && !OWE.typing) startTyping(i, e.clientX, e.clientY);
    });
  }
  function startTyping(i, x, y) {
    var el = EDIT.els[i], node = edNodes[i], tx = node && node.querySelector('.edtxt');
    if (!el || !tx) return;
    var row = wordsOf(EDIT.els).filter(function (r) { return r.id === el.id; })[0];
    OWE.typing = { el: el, node: node, tx: tx };
    node.classList.add('ow-typing');
    var plain = 'plaintext-only';
    tx.setAttribute('contenteditable', plain);
    if (tx.contentEditable !== plain) tx.setAttribute('contenteditable', 'true');
    tx.setAttribute('role', 'textbox');
    tx.setAttribute('aria-multiline', 'true');
    tx.setAttribute('aria-label', row ? row.name : 'Text');
    tx.setAttribute('spellcheck', 'true');
    tx.oninput = function () {
      var v = String(tx.innerText == null ? tx.textContent : tx.innerText).replace(/\n$/, '');
      setEls([{ i: indexOf({ id: el.id }), id: el.id, set: { text: v } }], { step: 'canvas:' + el.id, from: 'canvas' });
    };
    tx.onpaste = function (e) {
      if (tx.getAttribute('contenteditable') === plain) return;
      var t = e.clipboardData && e.clipboardData.getData('text/plain');
      if (t == null) return;
      e.preventDefault();
      if (document.execCommand) document.execCommand('insertText', false, t);
    };
    tx.onkeydown = function (e) {
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); stopTyping(true); }
    };
    tx.onblur = function () { stopTyping(); };
    tx.focus();
    caretAt(tx, x, y);
  }
  function caretAt(tx, x, y) {
    try {
      var r = null;
      if (x != null && document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
      else if (x != null && document.caretPositionFromPoint) {
        var p = document.caretPositionFromPoint(x, y);
        if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); }
      }
      if (!r || !tx.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(tx); r.collapse(false); }
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch (e) { /* the cursor stays where the browser put it */ }
  }
  function stopTyping(keepFocus) {
    var t = OWE.typing;
    if (!t) return;
    OWE.typing = null;
    t.tx.removeAttribute('contenteditable');
    t.tx.removeAttribute('role');
    t.tx.removeAttribute('aria-multiline');
    t.tx.removeAttribute('aria-label');
    t.tx.oninput = t.tx.onkeydown = t.tx.onblur = t.tx.onpaste = null;
    t.node.classList.remove('ow-typing');
    applyNode(t.node, t.el);
    mirror(EDIT.els.indexOf(t.el), t.el, 'canvas');
    if (keepFocus) {
      var box = document.querySelector('#owEasy [data-ow-key="w:' + cssId(t.el.id) + '"]');
      if (box) box.focus();
    }
  }

  /* ---------- the editor opens, loads and closes ---------- */

  /* each opening starts on the background chosen for all posts, with Advanced layout closed; a saved post opens on
     its own size, theme and background (openSaved) */
  var openEditor0 = openEditor;
  openEditor = function () {
    if (!owEditorOpen()) {
      if (!OWE.openAt) edParams = { theme: (edParams && edParams.theme) || 'dark', bg: owUseBg() || undefined };
      OWE.adv = false;
      var ed = el$('editor');
      if (ed) ed.classList.remove('ow-adv-open');
      wireStage();
    }
    var r = openEditor0.apply(this, arguments);
    if (typeof owZipHint === 'function') owZipHint();
    return r;
  };
  var loadEditor0 = loadEditor;
  loadEditor = function () {
    if (OWE.typing) stopTyping();
    var at = OWE.openAt, fmt = el$('edFmt');
    OWE.openAt = null;
    if (at && fmt && arr(fmt.options).some(function (o) { return o.value === at; })) fmt.value = at;
    return loadEditor0.apply(this, arguments);
  };
  var closeEditor0 = closeEditor;
  closeEditor = function () {
    if (OWE.typing) stopTyping();
    var r = closeEditor0.apply(this, arguments);
    paintSaved();
    return r;
  };

  /* ---------- the Saved list on the Social posts page (UX-132) ---------- */

  function fmtOf(t, id) { return ((t && t.formats) || []).filter(function (f) { return f.id === id; })[0] || { id: id }; }
  function when(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function paintSaved() {
    var grid = el$('tgrid');
    if (!grid || !CAT) return Promise.resolve();
    var box = el$('owSavedList');
    if (!box) {
      box = make('section', 'ow-saved-list');
      box.id = 'owSavedList';
      box.setAttribute('aria-labelledby', 'owSavedH');
      grid.parentNode.insertBefore(box, grid.nextSibling);
    }
    /* the list as this page keeps it now (its own saves and resets follow it), once it has been read */
    return owLayouts().then(function (list) {
      list = (window.OWS && OWS.layouts) || list;
      box.textContent = '';
      var h = make('h3', 'ow-saved-h', 'Saved posts');
      h.id = 'owSavedH';
      box.appendChild(h);
      box.appendChild(make('p', 'ow-saved-sub', 'Kept for this event, for everyone who works on it.'));
      var rows = arr(list).filter(function (l) { return l && findTpl(l.templateId); }).sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
      if (!rows.length) { box.appendChild(make('p', 'ow-saved-empty', 'Nothing saved yet. Open a post with Edit, then use Save.')); owReportHeight(); return; }
      var ul = make('ul', 'ow-saved-ul');
      rows.forEach(function (l) {
        var t = findTpl(l.templateId), li = make('li', 'ow-saved-li');
        var bgw = window.OWSArt ? OWSArt.bgPhrase(art(), l.bg) : '';
        var txt = make('span', 'ow-saved-t');
        txt.appendChild(make('b', '', t.label));
        txt.appendChild(document.createTextNode(' · ' + owSizeName(fmtOf(t, l.format)) + ' · ' + (l.theme === 'light' ? 'Light' : 'Dark') +
          (bgw ? ' · ' + bgw.charAt(0).toUpperCase() + bgw.slice(1) : '')));
        var w = when(l.savedAt);
        if (w) txt.appendChild(make('span', 'ow-saved-w', 'Saved ' + w));
        li.appendChild(txt);
        var b = button('Edit', 'btn alt sm', function () { openSaved(l); });
        b.setAttribute('aria-label', 'Edit the saved ' + t.label + ', ' + owSizeShort(fmtOf(t, l.format)));
        li.appendChild(b);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      owReportHeight();
    });
  }
  function openSaved(l) {
    edParams = { theme: l.theme === 'light' ? 'light' : 'dark', bg: l.bg || undefined };
    OWE.openAt = l.format;
    openEditor(l.templateId);
  }
  var renderEventDetail0 = renderEventDetail;
  renderEventDetail = function () {
    var r = renderEventDetail0.apply(this, arguments);
    paintSaved();
    return r;
  };

  /* what the AI batch (B18-ai) and the tests reach */
  window.OWSEasy = {
    set: setEls, words: function () { return wordsOf(EDIT.els); }, people: function () { return OWE.people.slice(); },
    swapTo: swapTo, perSpeaker: perSpeaker, repaint: paintEasy, startTyping: startTyping, stopTyping: stopTyping,
    paintSaved: paintSaved, openSaved: openSaved, state: OWE,
    pure: { roleName: roleName, wordsOf: wordsOf, findPeople: findPeople, swapPlan: swapPlan, peopleParams: peopleParams, titleLines: titleLines }
  };
})();
