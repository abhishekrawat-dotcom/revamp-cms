/* Speakers and Sponsors across ET (people.html; the owner, 11 Nov 2026: "a global speaker section can be added in the
   backend to manage that page … Same for the sponsor"). One page for each speaker and each sponsor of every ET
   portal (functions/lib/people.js); here the team finds one by name and adds to it what ET's records do not say.
   What is saved is on the page at once (the owner's choice), and every change can be undone.

     the list   search by name; All, Changed by the team, Hidden, and Same name (two pages that may be one person)
     one page   (#<slug>) the picture, name, designation, company, LinkedIn and X (a sponsor: logo, name, website)
                over what ET's records say; About; sections of the team's own; links; which events are shown;
                Hide this page; the records it is made of (some can become another person: Split); other pages of
                the same name (Join); the changes made, and Undo.
   Only an editor who works in one of the person's portals (an admin: anyone) changes a page; the others read it.
   Data: RevampCore.listPeople / fetchPerson / savePerson / mergePeople / splitPerson / undoPerson. ES5. */
(function () {
  'use strict';
  var C = window.RevampCore;
  var root = document.getElementById('pp-root');
  var qs = new URLSearchParams(location.search);
  var KIND = qs.get('kind') === 'sponsors' ? 'sponsors' : 'speakers';
  var SP = KIND === 'speakers';
  var WORDS = SP ? { one: 'speaker', many: 'speakers', One: 'Speaker', Many: 'Speakers', pic: 'photo' } : { one: 'sponsor', many: 'sponsors', One: 'Sponsor', Many: 'Sponsors', pic: 'logo' };
  /* typed: what the search box holds now (kept when the list is drawn again mid-typing); q: what was searched */
  var state = { q: '', typed: '', filter: 'all', list: null, view: null, draft: null, busy: false, asking: null, err: '', note: '' };
  /* listSeq / oneSeq: the latest list and the latest page asked for; an older answer is not drawn */
  var listSeq = 0, oneSeq = 0, searchTimer = null;

  document.title = WORDS.Many + ' — EventSphere';
  document.getElementById('pp-title').textContent = WORDS.Many;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function initials(n) { return String(n || '').split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
  function pic(src, name, logo) {
    var ok = /^(https:\/\/|data:image\/)/.test(String(src || ''));
    return '<span class="pp-av' + (logo ? ' logo' : '') + '" aria-hidden="true">' + (ok ? '<img src="' + esc(src) + '" alt="">' : esc(initials(name))) + '</span>';
  }
  function comma(n) { return C.comma ? C.comma(n) : String(n); }
  function when(iso) { try { return C.fmtDate(iso, { time: true }); } catch (e) { return String(iso || ''); } }
  function errText(e) { return C.errText ? C.errText(e) : String(e && e.message || e); }
  function clone(v) { return JSON.parse(JSON.stringify(v == null ? null : v)); }
  function slugNow() { return decodeURIComponent(String(location.hash || '').replace(/^#/, '')); }
  /* the same content, whatever order its fields are in, and an empty field the same as a missing one */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(function (k) { return v[k] !== '' && v[k] != null; }).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v == null ? '' : v);
  }
  function dirty() { return !!(state.view && state.draft && canon(state.draft) !== canon(state.view.page)); }
  function publicHref(path) { return (C.publicBase ? C.publicBase() : location.origin) + path; }

  /* ---------- the list ---------- */
  var FILTERS = [['all', 'All'], ['edited', 'Changed by the team'], ['hidden', 'Hidden'], ['same-name', 'Same name']];
  function tabs() {
    return '<nav class="pp-tabs" aria-label="Speakers or sponsors">' +
      '<a href="/people.html?kind=speakers"' + (SP ? ' aria-current="page"' : '') + '>Speakers</a>' +
      '<a href="/people.html?kind=sponsors"' + (!SP ? ' aria-current="page"' : '') + '>Sponsors</a></nav>';
  }
  function renderList() {
    var L = state.list;
    var html = '<div class="vhead"><div class="crumb">Every ETB2B portal</div><h2 id="pp-h" tabindex="-1">' + WORDS.Many + '</h2>' +
      '<div class="sub">' + (SP
        ? 'One page for each speaker, whichever portals they spoke on: the ETB2B events they spoke at and their sessions, and what the team adds. Event sites open it from a speaker’s card.'
        : 'One page for each sponsor: the ETB2B events they partnered, at which tier, and what the team adds. Event sites open it from a sponsor’s logo.') + '</div></div>' + tabs() +
      '<div class="pp-bar"><label class="search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
      '<input id="pp-q" type="search" autocomplete="off" placeholder="Search ' + WORDS.many + ' by name" aria-label="Search ' + WORDS.many + ' by name" value="' + esc(state.typed) + '"></label>' +
      '<div class="pp-filters" role="group" aria-label="Show">' + FILTERS.map(function (f) {
        return '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (state.filter === f[0]) + '">' + f[1] + '</button>';
      }).join('') + '</div></div>';
    if (state.err) html += '<p class="pa-msg err" role="alert">' + esc(state.err) + '</p>';
    if (!L) html += '<p class="pa-msg">Reading the ' + WORDS.many + '…</p>';
    else if (!L.ready) html += '<p class="pa-msg">The ' + WORDS.many + '’ pages are being prepared. Please look again in a few minutes.</p>';
    else {
      var what = state.filter === 'edited' ? 'changed by the team' : state.filter === 'hidden' ? 'hidden' : state.filter === 'same-name' ? 'that share a name with another page: check whether they are one person' : '';
      html += '<p class="pp-count" aria-live="polite">' + (state.q || state.filter !== 'all'
        ? comma(L.total) + ' ' + (L.total === 1 ? WORDS.one : WORDS.many) + (state.q ? ' named “' + esc(state.q) + '”' : '') + (what ? ' ' + what : '') + (L.total > L.items.length ? '; the first ' + L.items.length + ' are shown' : '') + '.'
        : comma(L.count) + ' ' + WORDS.many + ' across every ETB2B portal, each once. The ' + L.items.length + ' most recent are shown; search for anyone.') + '</p>';
      if (L.items.length) {
        html += '<ul class="pp-list">' + L.items.map(function (it) {
          var line = [it.company, (it.portals || []).slice(0, 3).join(', ') + ((it.portals || []).length > 3 ? '…' : ''), it.editions ? it.editions + (it.editions === 1 ? ' edition' : ' editions') : '', it.year].filter(Boolean).join(' · ');
          return '<li><a class="pp-row" href="#' + encodeURIComponent(it.slug) + '">' + pic(it.photo, it.name, !SP) +
            '<span class="pp-txt"><b>' + esc(it.name) + '</b><span>' + esc(line) + '</span></span>' +
            (it.hidden ? '<span class="pp-tag warn">Hidden</span>' : '') + (it.edited ? '<span class="pp-tag">Changed</span>' : '') + '</a></li>';
        }).join('') + '</ul>';
      } else html += '<p class="pa-msg">No ' + WORDS.many + ' to show here.</p>';
    }
    root.innerHTML = html;
    var q = document.getElementById('pp-q');
    q.addEventListener('input', function () {
      state.typed = q.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { state.q = state.typed.trim(); loadList(true); }, 260);
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-filter]'), function (b) {
      b.addEventListener('click', function () { state.filter = b.getAttribute('data-filter'); loadList(); });
    });
  }
  function loadList(keepFocus) {
    var my = ++listSeq;
    state.err = '';
    C.listPeople(KIND, state.q, state.filter).then(function (d) {
      if (my !== listSeq || slugNow()) return;
      state.list = d;
      var had = document.activeElement && document.activeElement.id === 'pp-q';
      renderList();
      if (keepFocus || had) { var q = document.getElementById('pp-q'); q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) { /* type=search */ } }
    }, function (e) {
      if (my !== listSeq || slugNow()) return;
      state.err = errText(e);
      renderList();
    });
  }

  /* ---------- one page ---------- */
  function field(id, label, value, auto, o) {
    o = o || {};
    var input = o.area
      ? '<textarea class="inp" id="' + id + '" rows="' + (o.rows || 5) + '" maxlength="' + (o.max || 4000) + '" placeholder="' + esc(auto || o.placeholder || '') + '">' + esc(value) + '</textarea>'
      : '<input class="inp" id="' + id + '" type="' + (o.type || 'text') + '" maxlength="' + (o.max || 200) + '" value="' + esc(value) + '" placeholder="' + esc(auto || o.placeholder || '') + '"' + (o.type === 'url' ? ' inputmode="url"' : '') + '>';
    var hint = auto ? (SP ? 'Left empty, ETB2B’s records say: ' : 'Left empty: ') + '“' + String(auto).slice(0, 140) + (String(auto).length > 140 ? '…' : '') + '”' : (o.hint || '');
    return '<div class="field ' + (o.c || 'c6') + '"><label for="' + id + '">' + label + '</label>' + input + (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') + '</div>';
  }
  /* About: written by hand, or by ETB2B AI from what this page shows (a draft to read and change, then Save) */
  function aboutField(p, d, ro) {
    var ai = state.aboutMode === 'ai';
    var dis = ro || state.aiBusy ? ' disabled' : '';
    var auto = SP ? (p.auto.bio || '') : '';
    return '<div class="field c12"><div class="pp-about-head"><label for="pp-about">About</label>' +
      '<div class="pp-mode" role="group" aria-label="How to write the About">' +
      '<button type="button" data-mode="me" aria-pressed="' + !ai + '"' + (ro ? ' disabled' : '') + '>Edit myself</button>' +
      '<button type="button" data-mode="ai" aria-pressed="' + ai + '"' + (ro ? ' disabled' : '') + '>Edit with ETB2B AI</button></div></div>' +
      (ai ? '<div class="pp-ai"><input class="inp" id="pp-ai-note" maxlength="300" placeholder="Anything to stress? (optional), e.g. their work on cloud security" value="' + esc(state.aiNoteText || '') + '"' + dis + '>' +
        '<button class="btn btn-secondary btn-sm" type="button" id="pp-ai-go"' + dis + '>' + (state.aiBusy ? 'Writing\u2026' : (d.about ? 'Write it again' : 'Write it')) + '</button></div>' +
        '<p class="hint">ETB2B AI writes only from what this page shows: its events, roles and sessions, and what the team added. It puts a draft in the box below; nothing is saved until you Save.</p>' : '') +
      (state.aiDone ? '<p class="hint pp-ai-done" role="status">' + esc(state.aiDone) + '</p>' : '') +
      '<textarea class="inp" id="pp-about" rows="6" maxlength="4000" placeholder="' + esc(auto || (SP ? 'A few lines about them, for the page.' : 'A few lines about the company, for the page.')) + '">' + esc(d.about || '') + '</textarea>' +
      (auto ? '<p class="hint">' + esc('Left empty, ETB2B\u2019s records say: \u201c' + auto.slice(0, 140) + (auto.length > 140 ? '\u2026' : '') + '\u201d') + '</p>' : '') + '</div>';
  }
  function wikiPanel(p, ro) {
    var w = p.wiki, st = p.wikiState || null, dis = ro || state.wikiBusy ? ' disabled' : '';
    var html = '<section class="panel"><div class="panel-head"><h3>Wikipedia</h3><span class="sub">' + (SP
      ? 'Shown only when Wikipedia names their company as their employer, or the team confirms it is them, with its credit line.'
      : 'Shown only when Wikipedia gives the sponsor\u2019s own website, or the team confirms it, with its credit line.') + '</span></div><div class="panel-body">';
    if (state.wikiBusy) html += '<p class="pa-msg">Looking on Wikipedia\u2026</p>';
    else if (w) {
      html += '<p class="pp-txt"><b><a href="' + esc(w.url) + '" target="_blank" rel="noopener">' + esc(w.title) + '</a></b><span>' + esc((st && st.why) || w.matchedOn || '') + '</span></p>' +
        '<p class="hint" style="margin:8px 0 10px">' + esc(String(w.extract || '').slice(0, 260) + (String(w.extract || '').length > 260 ? '\u2026' : '')) + '</p>' +
        '<div class="pp-acts"><button class="btn btn-secondary btn-sm" type="button" data-wiki="off"' + dis + '>Don\u2019t show it on the page</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-wiki="find"' + dis + '>Look again</button></div>';
    } else if (st && st.status === 'off') {
      html += '<p class="pa-msg">Not shown on the page: the team turned it off.</p><div class="pp-acts" style="margin-top:8px"><button class="btn btn-secondary btn-sm" type="button" data-wiki="on"' + dis + '>Show it again</button></div>';
    } else {
      if (st && st.status === 'none') {
        var c = (st.candidates || []).filter(function (x) { return x.title; });
        html += '<p class="pa-msg">Not shown: ' + (c.length ? 'Wikipedia has ' + (c.length === 1 ? 'a page' : 'pages') + ' of that name, but none names ' + (SP ? 'their company' : 'their website') + '.' : 'Wikipedia has no page for them.') + '</p>';
        if (c.length) html += '<ul class="pp-j" style="margin-top:8px">' + c.map(function (x) {
          return '<li><span class="pp-txt"><b>' + esc(x.label) + '</b><span>' + esc([x.description, x.why].filter(Boolean).join(' \u00b7 ')) + '</span></span>' +
            '<button class="btn btn-secondary btn-sm" type="button" data-wiki="use" data-qid="' + esc(x.qid) + '"' + dis + '>It is them: use it</button></li>';
        }).join('') + '</ul>';
      }
      html += '<div class="pp-acts" style="margin-top:8px"><button class="btn btn-secondary btn-sm" type="button" data-wiki="find"' + dis + '>' + (st ? 'Look again' : 'Look for them on Wikipedia') + '</button></div>';
    }
    return html + '</div></section>';
  }
  function journeyLine(j) {
    var bits = [j.date ? C.fmtDate(j.date) : j.year, j.portalName, SP && j.company ? 'as ' + j.company : '', !SP && j.tier ? j.tier : ''].filter(Boolean).join(' · ');
    return bits;
  }
  function renderOne() {
    var v = state.view, p = v.person, d = state.draft, set = d.set || {};
    var ro = !v.canChange || state.busy;
    var dis = ro ? ' disabled' : '';
    var picNow = set[SP ? 'photo' : 'logo'] || p.auto[SP ? 'photo' : 'logo'];
    var shown = (p.journey || []).filter(function (j) { return !j.why && d.hideEvents.indexOf(j.key) === -1; });
    var html = '<p style="margin:0 0 12px"><a href="#" id="pp-tolist" class="btn btn-ghost btn-sm">← All ' + WORDS.many + '</a></p>' +
      '<div class="pp-head">' + pic(picNow, p.name, !SP) + '<div class="grow"><h2 id="pp-h" tabindex="-1">' + esc(set.name || p.name) + '</h2>' +
      '<p class="sub">' + esc([SP ? (set.designation || p.auto.designation) : '', SP ? (set.company || p.auto.company) : ''].filter(Boolean).join(', ')) + '</p>' +
      '<p class="sub">' + esc(shown.length + (shown.length === 1 ? ' event' : ' events') + ' on the page' + (p.stats && p.stats.sessions ? ', ' + p.stats.sessions + (p.stats.sessions === 1 ? ' session' : ' sessions') : '') + (v.hidden ? ' · hidden' : '')) + '</p></div>' +
      '<div class="pp-acts">' + (v.hidden || !p.hasPage ? '' : '<a class="btn btn-secondary" href="' + esc(publicHref(v.path)) + '" target="_blank" rel="noopener">Open the page</a>') +
      '<button class="btn btn-ghost" type="button" id="pp-copy"' + (v.hidden ? ' disabled' : '') + '>Copy its link</button></div></div>';
    if (state.note) html += '<p class="pp-note" role="status">' + state.note + '</p>';
    if (state.err) html += '<p class="pp-note err" role="alert">' + esc(state.err) + '</p>';
    if (!v.canChange) html += '<p class="pp-note">' + esc(v.whyNot || 'You can read this page but not change it.') + '</p>';
    if (v.hidden) html += '<p class="pp-note err">This page is hidden: its address answers “not available”, and event sites do not lead to it.</p>';
    else if (!p.hasPage) html += '<p class="pp-note">This page has nothing public to show yet (no ETB2B edition, and no live event), so its address answers “not available”.</p>';

    /* what the page says */
    html += '<section class="panel"><div class="panel-head"><h3>On the page</h3><span class="sub">Anything left empty is what ETB2B’s records say.</span></div><div class="panel-body">' +
      '<div class="field" style="margin-bottom:14px"><span class="flabel">' + (SP ? 'Photo' : 'Logo') + '</span><div class="pp-pic">' + pic(picNow, p.name, !SP) +
      '<div class="pp-acts"><label class="btn btn-secondary"' + (ro ? ' aria-disabled="true"' : '') + '>Upload a ' + WORDS.pic + '<input type="file" id="pp-file" accept="image/jpeg,image/png,image/webp" hidden' + dis + '></label>' +
      (set[SP ? 'photo' : 'logo'] ? '<button class="btn btn-ghost" type="button" id="pp-pic-auto"' + dis + '>Use ETB2B’s ' + WORDS.pic + '</button>' : '') + '</div></div>' +
      '<p class="hint">' + (set[SP ? 'photo' : 'logo'] ? 'The team’s ' + WORDS.pic + ' is shown.' : p.auto[SP ? 'photo' : 'logo'] ? 'ETB2B’s ' + WORDS.pic + ' is shown.' : 'No ' + WORDS.pic + ' yet: ' + (SP ? 'initials are shown.' : 'the name is shown.')) + '</p></div>' +
      '<div class="frow">' + field('pp-name', 'Name', set.name || '', p.auto.name, { max: 120, c: SP ? 'c12' : 'c6' }) +
      (SP ? field('pp-desig', 'Designation', set.designation || '', p.auto.designation, { max: 200 }) + field('pp-co', 'Company', set.company || '', p.auto.company, { max: 160 }) +
        field('pp-li', 'LinkedIn', set.linkedin || '', p.auto.linkedin, { type: 'url', max: 500, placeholder: 'https://www.linkedin.com/in/…' }) +
        field('pp-x', 'X', set.x || '', '', { type: 'url', max: 500, placeholder: 'https://x.com/…', hint: 'Their profile on X, if they have one.' })
        : field('pp-web', 'Website', set.website || '', p.auto.website, { type: 'url', max: 500, placeholder: 'https://…' })) +
      aboutField(p, d, ro) + '</div></div></section>';

    /* the team's sections and links */
    html += '<section class="panel"><div class="panel-head"><h3>More on the page</h3><span class="sub">Anything else worth saying: awards, books, a quote, a talk to watch.</span></div><div class="panel-body">' +
      (d.sections || []).map(function (s, i) {
        return '<div class="pp-sec"><div class="frow">' + field('pp-sh-' + i, 'Heading', s.heading, '', { max: 120, c: 'c12', placeholder: 'e.g. Recognition' }) +
          field('pp-st-' + i, 'Text', s.text, '', { area: true, rows: 4, c: 'c12', max: 4000 }) + '</div>' +
          '<div class="pp-sec-acts">' + (i > 0 ? '<button class="btn btn-ghost btn-sm" type="button" data-up="' + i + '"' + dis + '>Move up</button>' : '') +
          '<button class="btn btn-ghost btn-sm" type="button" data-del-sec="' + i + '"' + dis + '>Remove this section</button></div></div>';
      }).join('') +
      ((d.sections || []).length < 8 ? '<button class="btn btn-secondary btn-sm" type="button" id="pp-add-sec"' + dis + '>Add a section</button>' : '') +
      '<h4 style="margin:18px 0 8px;font-size:13px">Links</h4>' +
      (d.links || []).map(function (l, i) {
        return '<div class="pp-sec"><div class="frow">' + field('pp-ll-' + i, 'Words shown', l.label, '', { max: 80, placeholder: 'e.g. Keynote at ETCIO Annual Conclave' }) +
          field('pp-lu-' + i, 'Address', l.url, '', { type: 'url', max: 500, placeholder: 'https://…' }) + '</div>' +
          '<div class="pp-sec-acts"><button class="btn btn-ghost btn-sm" type="button" data-del-link="' + i + '"' + dis + '>Remove this link</button></div></div>';
      }).join('') +
      ((d.links || []).length < 10 ? '<button class="btn btn-secondary btn-sm" type="button" id="pp-add-link"' + dis + '>Add a link</button>' : '') + '</div></section>';

    /* Wikipedia, for the well-known: used only when it names their company (or the team confirms it is them) */
    html += wikiPanel(p, ro);

    /* the journey */
    var j = p.journey || [];
    html += '<section class="panel"><div class="panel-head"><h3>' + (SP ? 'Journey with ETB2B' : 'Partnerships with ETB2B') + '</h3><span class="sub">Untick an event to leave it off the page.</span></div><div class="panel-body">' +
      (j.length ? '<ul class="pp-j">' + j.map(function (x) {
        var off = !!x.why;
        return '<li><input type="checkbox" id="pp-ev-' + esc(x.key) + '" data-ev="' + esc(x.key) + '"' + (!off && d.hideEvents.indexOf(x.key) === -1 ? ' checked' : '') + (off || ro ? ' disabled' : '') + '>' +
          '<label class="pp-txt" for="pp-ev-' + esc(x.key) + '"><b>' + esc(x.title) + '</b><span>' + esc(journeyLine(x)) + (x.src === 'own' ? ' · EventSphere' : ' · ETB2B’s records') + '</span>' +
          (off ? '<span class="why">Not on the page: ' + esc(x.why) + '</span>' : '') +
          (x.sessions && x.sessions.length ? '<ul>' + x.sessions.map(function (s) { return '<li>' + esc(s.title) + '</li>'; }).join('') + '</ul>' : '') + '</label></li>';
      }).join('') + '</ul>' : '<p class="pa-msg">No events yet.</p>') + '</div></section>';

    html += '<div class="pp-save"><span class="grow" id="pp-dirty">' + (dirty() ? 'Changes not saved yet.' : (v.updatedAt ? 'Last changed ' + esc(when(v.updatedAt)) + (v.updatedBy ? ' by ' + esc(v.updatedBy) : '') + '.' : 'Nothing changed by the team yet.')) + '</span>' +
      '<button class="btn btn-ghost" type="button" id="pp-reset"' + (dirty() && !ro ? '' : ' disabled') + '>Discard changes</button>' +
      '<button class="btn btn-primary" type="button" id="pp-save"' + (dirty() && !ro ? '' : ' disabled') + '>' + (state.busy ? 'Saving…' : 'Save') + '</button></div>';

    /* who this is: the records, the same name, hiding */
    var rows = p.rows || [];
    html += '<section class="panel" style="margin-top:18px"><div class="panel-head"><h3>Who this is</h3><span class="sub">The records this page is made of: ' + (SP ? 'the same name and company on every portal.' : 'the same name on every portal.') + '</span></div><div class="panel-body">' +
      '<ul class="pp-j">' + rows.map(function (r) {
        return '<li><input type="checkbox" data-row="' + esc(r.key) + '" id="pp-row-' + esc(r.key) + '"' + (ro || rows.length < 2 ? ' disabled' : '') + '>' +
          '<label class="pp-txt" for="pp-row-' + esc(r.key) + '"><b>' + esc(r.label) + '</b><span>' + esc([r.company, r.at ? String(r.at).slice(0, 4) : '', r.src === 'own' ? 'EventSphere' : 'ETB2B’s records'].filter(Boolean).join(' · ')) + '</span>' +
          (r.why ? '<span class="why">Not on the page: ' + esc(r.why) + '</span>' : '') + '</label></li>';
      }).join('') + '</ul>' +
      (rows.length > 1 ? '<div class="pp-acts" style="margin-top:10px"><button class="btn btn-secondary btn-sm" type="button" id="pp-split" disabled>The ticked ones are another ' + (SP ? 'person' : 'company') + '</button></div>' : '') +
      (state.asking && state.asking.what === 'split' ? '<div class="pp-confirm" role="alertdialog" aria-label="Move these records">Move the ' + state.asking.rows.length + ' ticked ' + (state.asking.rows.length === 1 ? 'record' : 'records') + ' to a page of their own? This page keeps the rest.' +
        '<div class="pp-acts"><button class="btn btn-primary btn-sm" type="button" id="pp-yes">Move them</button><button class="btn btn-ghost btn-sm" type="button" id="pp-no">Cancel</button></div></div>' : '') +
      (v.sameName && v.sameName.length ? '<h4 style="margin:18px 0 8px;font-size:13px">Other pages with this name</h4><ul class="pp-j">' + v.sameName.map(function (o) {
        return '<li>' + pic(o.photo, o.name, !SP) + '<span class="pp-txt"><b><a href="#' + encodeURIComponent(o.slug) + '">' + esc(o.name) + '</a></b><span>' + esc([o.company, (o.portals || []).join(', '), o.editions ? o.editions + ' editions' : '', o.year].filter(Boolean).join(' · ')) + '</span></span>' +
          '<button class="btn btn-secondary btn-sm" type="button" data-join="' + esc(o.slug) + '" data-join-name="' + esc(o.name) + '"' + dis + '>Same ' + (SP ? 'person' : 'company') + ': join here</button></li>';
      }).join('') + '</ul>' : '') +
      '<h4 style="margin:18px 0 8px;font-size:13px">Join another page into this one</h4>' +
      '<div class="pp-bar"><label class="search"><input id="pp-find" type="search" autocomplete="off" placeholder="Find a page by name (another spelling, a new company)" aria-label="Find another page by name"' + dis + '></label></div><ul class="pp-j" id="pp-found"></ul>' +
      (state.asking && state.asking.what === 'join' ? '<div class="pp-confirm" role="alertdialog" aria-label="Join two pages">Join “' + esc(state.asking.name) + '” into this page? Their events and anything the team added come here, and their address will lead here.' +
        '<div class="pp-acts"><button class="btn btn-primary btn-sm" type="button" id="pp-yes">Join them</button><button class="btn btn-ghost btn-sm" type="button" id="pp-no">Cancel</button></div></div>' : '') +
      '<h4 style="margin:18px 0 8px;font-size:13px">Visibility</h4>' +
      (state.asking && state.asking.what === 'hide' ? '<div class="pp-confirm" role="alertdialog" aria-label="Hide this page">Hide this page? Its address will answer “not available” and event sites will not lead to it, until it is shown again.' +
        '<div class="pp-acts"><button class="btn btn-primary btn-sm" type="button" id="pp-yes">Hide it</button><button class="btn btn-ghost btn-sm" type="button" id="pp-no">Cancel</button></div></div>'
        : '<button class="btn btn-secondary btn-sm" type="button" id="pp-hide"' + dis + '>' + (v.hidden ? 'Show this page again' : 'Hide this page') + '</button>') +
      '</div></section>';

    /* changes */
    var log = v.log || [];
    html += '<section class="panel"><div class="panel-head"><h3>Changes</h3>' + (log.some(function (l) { return !l.undone && l.action !== 'undo'; }) ? '<button class="btn btn-secondary btn-sm" type="button" id="pp-undo"' + dis + '>Undo the last change</button>' : '') + '</div><div class="panel-body">' +
      (log.length ? '<ul class="pp-log">' + log.map(function (l) {
        var words = { edit: 'changed the page', hide: 'hid the page', show: 'showed the page again', merge: l.what || 'joined another page here', split: l.what || 'moved records to another page', undo: l.what || 'undid a change' };
        return '<li>' + esc(when(l.at)) + ' · ' + esc(l.by || 'someone') + ' ' + esc(String(l.action || '').split('+').map(function (a) { return words[a] || a; }).join(' and ')) + (l.undone ? ' (undone)' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="pa-msg">No changes yet.</p>') + '</div></section>';

    root.innerHTML = html;
    wireOne();
  }
  function readInputs() {
    var d = state.draft, set = d.set || (d.set = {});
    function val(id) { var n = document.getElementById(id); return n ? n.value : ''; }
    function put(k, id) { var v = val(id).trim(); if (v) set[k] = v; else delete set[k]; }
    put('name', 'pp-name');
    if (SP) { put('designation', 'pp-desig'); put('company', 'pp-co'); put('linkedin', 'pp-li'); put('x', 'pp-x'); }
    else put('website', 'pp-web');
    d.about = val('pp-about').trim();
    d.sections = (d.sections || []).map(function (s, i) { return { heading: val('pp-sh-' + i), text: val('pp-st-' + i) }; });
    d.links = (d.links || []).map(function (l, i) { return { label: val('pp-ll-' + i), url: val('pp-lu-' + i) }; });
  }
  function noteDirty() {
    var n = document.getElementById('pp-dirty'), on = dirty() && state.view.canChange && !state.busy;
    if (n) n.textContent = dirty() ? 'Changes not saved yet.' : 'No changes.';
    ['pp-save', 'pp-reset'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = !on; });
  }
  /* an uploaded picture: a photo square (320 px, the top of a portrait kept), a logo whole (at most 480 px) */
  function readPicture(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Choose a JPEG, PNG or WebP picture.'));
      if (file.size > 15 * 1024 * 1024) return reject(new Error('That picture is larger than 15 MB.'));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, cv = document.createElement('canvas'), out;
        if (SP) {
          var side = Math.min(w, h), sx = (w - side) / 2, sy = h > w ? Math.min((h - side) * 0.15, h - side) : 0;
          cv.width = cv.height = 320;
          var g = cv.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 320, 320);
          g.drawImage(img, sx, sy, side, side, 0, 0, 320, 320);
          out = cv.toDataURL('image/jpeg', 0.86);
        } else {
          var k = Math.min(1, 480 / Math.max(w, h));
          cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          out = cv.toDataURL('image/png');
          if (out.length > 280 * 1024) {
            var g2 = cv.getContext('2d'); g2.globalCompositeOperation = 'destination-over'; g2.fillStyle = '#ffffff'; g2.fillRect(0, 0, cv.width, cv.height);
            out = cv.toDataURL('image/jpeg', 0.88);
          }
        }
        URL.revokeObjectURL(url);
        if (out.length > 300 * 1024) return reject(new Error('That picture is still too large once made smaller. Try another.'));
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a picture.')); };
      img.src = url;
    });
  }
  function act(promise, okNote) {
    state.busy = true; state.err = ''; state.note = '';
    renderOne();
    return promise.then(function (v) {
      state.busy = false; state.asking = null;
      setView(v);
      state.note = okNote ? okNote(v) : '';
      renderOne();
      var h = document.getElementById('pp-h'); if (h) h.focus();
      return v;
    }, function (e) {
      state.busy = false;
      state.err = errText(e);
      if (e && e.status === 409) return openOne(state.view.slug, true).then(function () { state.err = errText(e); renderOne(); });
      renderOne();
    });
  }
  function setView(v) {
    if (!state.view || state.view.slug !== v.slug) { state.aboutMode = 'me'; state.aiDone = ''; state.aiNoteText = ''; }
    state.view = v; state.draft = clone(v.page); if (!state.draft.hideEvents) state.draft.hideEvents = [];
  }
  function wireOne() {
    var v = state.view, d = state.draft;
    document.getElementById('pp-tolist').addEventListener('click', function (e) { e.preventDefault(); location.hash = ''; });
    document.getElementById('pp-copy').addEventListener('click', function () {
      var href = publicHref(v.path);
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(href) : Promise.reject()).then(function () { C.toast('Link copied: ' + href); }, function () { window.prompt('The page’s link:', href); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('.pp-main input.inp, .pp-main textarea.inp'), function (n) {
      n.addEventListener('input', function () { readInputs(); noteDirty(); });
    });
    var file = document.getElementById('pp-file');
    if (file) file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      readInputs();
      readPicture(f).then(function (data) { d.set[SP ? 'photo' : 'logo'] = data; renderOne(); }, function (e) { state.err = e.message; renderOne(); });
    });
    var auto = document.getElementById('pp-pic-auto');
    if (auto) auto.addEventListener('click', function () { readInputs(); delete d.set[SP ? 'photo' : 'logo']; renderOne(); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-mode]'), function (b) {
      b.addEventListener('click', function () { readInputs(); state.aboutMode = b.getAttribute('data-mode'); state.aiDone = ''; renderOne(); var n = document.getElementById(state.aboutMode === 'ai' ? 'pp-ai-note' : 'pp-about'); if (n) n.focus(); });
    });
    var aiGo = document.getElementById('pp-ai-go');
    if (aiGo) aiGo.addEventListener('click', function () {
      readInputs();
      var noteEl = document.getElementById('pp-ai-note');
      state.aiNoteText = noteEl ? noteEl.value : '';
      state.aiBusy = true; state.aiDone = ''; state.err = '';
      renderOne();
      C.writePersonAbout(KIND, v.slug, state.aiNoteText).then(function (r) {
        state.aiBusy = false;
        d.about = r.about;
        state.aiDone = 'Written by ETB2B AI from this page\u2019s records. Read it, change anything, then Save.';
        renderOne();
        var t = document.getElementById('pp-about'); if (t) t.focus();
      }, function (e) { state.aiBusy = false; state.err = errText(e); renderOne(); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-wiki]'), function (b) {
      b.addEventListener('click', function () {
        readInputs();
        var action = b.getAttribute('data-wiki'), qid = b.getAttribute('data-qid') || '';
        var keep = clone(state.draft), was = dirty();
        state.wikiBusy = true; state.err = ''; state.note = '';
        renderOne();
        C.personWiki(KIND, v.slug, action, qid).then(function (r) {
          state.wikiBusy = false;
          var draft = was ? keep : null;
          setView(r);
          if (draft) state.draft = draft;   /* what the person was typing stays */
          state.note = action === 'find' ? (r.person.wiki ? 'Found on Wikipedia, and shown on the page.' : 'Not shown: no Wikipedia page that is surely them.') :
            action === 'use' ? 'Their Wikipedia summary is on the page now.' : action === 'off' ? 'Wikipedia is not shown on the page now.' : 'Wikipedia is shown again.';
          renderOne();
        }, function (e) { state.wikiBusy = false; state.err = errText(e); renderOne(); });
      });
    });
    var addSec = document.getElementById('pp-add-sec');
    if (addSec) addSec.addEventListener('click', function () { readInputs(); d.sections.push({ heading: '', text: '' }); renderOne(); var n = document.getElementById('pp-sh-' + (d.sections.length - 1)); if (n) n.focus(); });
    var addLink = document.getElementById('pp-add-link');
    if (addLink) addLink.addEventListener('click', function () { readInputs(); d.links.push({ label: '', url: '' }); renderOne(); var n = document.getElementById('pp-ll-' + (d.links.length - 1)); if (n) n.focus(); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-del-sec]'), function (b) { b.addEventListener('click', function () { readInputs(); d.sections.splice(+b.getAttribute('data-del-sec'), 1); renderOne(); }); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-up]'), function (b) { b.addEventListener('click', function () { readInputs(); var i = +b.getAttribute('data-up'); var x = d.sections[i]; d.sections[i] = d.sections[i - 1]; d.sections[i - 1] = x; renderOne(); }); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-del-link]'), function (b) { b.addEventListener('click', function () { readInputs(); d.links.splice(+b.getAttribute('data-del-link'), 1); renderOne(); }); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-ev]'), function (c) {
      c.addEventListener('change', function () {
        var k = c.getAttribute('data-ev'), at = d.hideEvents.indexOf(k);
        if (c.checked && at !== -1) d.hideEvents.splice(at, 1);
        if (!c.checked && at === -1) d.hideEvents.push(k);
        noteDirty();
      });
    });
    var save = document.getElementById('pp-save');
    save.addEventListener('click', function () {
      readInputs();
      act(C.savePerson(KIND, { slug: v.slug, base: v.version, page: d }), function () { return 'Saved. The page shows it now.'; });
    });
    document.getElementById('pp-reset').addEventListener('click', function () { state.draft = clone(v.page); renderOne(); });
    var split = document.getElementById('pp-split');
    function ticked() { return Array.prototype.filter.call(root.querySelectorAll('[data-row]'), function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-row'); }); }
    Array.prototype.forEach.call(root.querySelectorAll('[data-row]'), function (c) {
      c.addEventListener('change', function () { var t = ticked(); if (split) split.disabled = !t.length || t.length === (v.person.rows || []).length; });
    });
    if (split) split.addEventListener('click', function () { state.asking = { what: 'split', rows: ticked() }; readInputs(); renderOne(); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-join]'), function (b) {
      b.addEventListener('click', function () { readInputs(); state.asking = { what: 'join', slug: b.getAttribute('data-join'), name: b.getAttribute('data-join-name') }; renderOne(); });
    });
    var hide = document.getElementById('pp-hide');
    if (hide) hide.addEventListener('click', function () {
      if (v.hidden) return act(C.savePerson(KIND, { slug: v.slug, base: v.version, hidden: false }), function () { return 'The page is shown again.'; });
      readInputs(); state.asking = { what: 'hide' }; renderOne();
    });
    var yes = document.getElementById('pp-yes'), no = document.getElementById('pp-no');
    if (no) no.addEventListener('click', function () { state.asking = null; renderOne(); });
    if (yes) yes.addEventListener('click', function () {
      var a = state.asking;
      if (a.what === 'hide') return act(C.savePerson(KIND, { slug: v.slug, base: v.version, hidden: true }), function () { return 'The page is hidden.'; });
      if (a.what === 'join') return act(C.mergePeople(KIND, v.slug, a.slug), function () { return '“' + esc(a.name) + '” is joined into this page; their address leads here now.'; });
      if (a.what === 'split') return act(C.splitPerson(KIND, v.slug, a.rows), function (r) { return 'Moved to a page of their own: <a href="#' + encodeURIComponent(r.made) + '">open it</a>.'; });
    });
    var undo = document.getElementById('pp-undo');
    if (undo) undo.addEventListener('click', function () { act(C.undoPerson(KIND, v.slug), function () { return 'The last change is undone.'; }); });
    var find = document.getElementById('pp-find'), found = document.getElementById('pp-found'), t = null;
    if (find) find.addEventListener('input', function () {
      clearTimeout(t);
      var q = find.value.trim();
      if (q.length < 2) { found.innerHTML = ''; return; }
      t = setTimeout(function () {
        C.listPeople(KIND, q, 'all').then(function (r) {
          var list = (r.items || []).filter(function (o) { return o.slug !== v.slug; }).slice(0, 6);
          found.innerHTML = list.length ? list.map(function (o) {
            return '<li>' + pic(o.photo, o.name, !SP) + '<span class="pp-txt"><b>' + esc(o.name) + '</b><span>' + esc([o.company, (o.portals || []).join(', '), o.year].filter(Boolean).join(' · ')) + '</span></span>' +
              '<button class="btn btn-secondary btn-sm" type="button" data-join="' + esc(o.slug) + '" data-join-name="' + esc(o.name) + '">Join here</button></li>';
          }).join('') : '<li><span class="pp-txt"><span>No other page by that name.</span></span></li>';
          Array.prototype.forEach.call(found.querySelectorAll('[data-join]'), function (b) {
            b.addEventListener('click', function () { readInputs(); state.asking = { what: 'join', slug: b.getAttribute('data-join'), name: b.getAttribute('data-join-name') }; renderOne(); });
          });
        }, function () { found.innerHTML = ''; });
      }, 260);
    });
  }
  function openOne(slug, keep) {
    /* a search still waiting to be made is not made once a page is opened */
    clearTimeout(searchTimer);
    var my = ++oneSeq;
    if (!keep) { state.err = ''; state.note = ''; state.asking = null; }
    root.innerHTML = '<p class="pa-msg">Reading the page…</p>';
    return C.fetchPerson(KIND, slug).then(function (v) {
      if (my !== oneSeq || slugNow() !== slug && slugNow() !== v.slug) return;
      setView(v);
      if (v.slug !== slug) { history.replaceState(null, '', '#' + encodeURIComponent(v.slug)); }
      renderOne();
      var h = document.getElementById('pp-h'); if (h) h.focus();
    }, function (e) {
      if (my !== oneSeq) return;
      root.innerHTML = '<p style="margin:0 0 12px"><a href="#" class="btn btn-ghost btn-sm" onclick="location.hash=\'\';return false;">← All ' + WORDS.many + '</a></p><p class="pa-msg err" role="alert">' + esc(errText(e)) + '</p>';
    });
  }

  /* ---------- where we are ---------- */
  var lastHash = location.hash;
  function route() {
    var slug = slugNow();
    if (slug) return openOne(slug);
    state.view = null; state.draft = null;
    if (state.list) renderList(); else root.innerHTML = '<p class="pa-msg">Reading the ' + WORDS.many + '…</p>';
    loadList();
    var h = document.getElementById('pp-h'); if (h) h.focus();
  }
  window.addEventListener('hashchange', function () {
    if (dirty() && !window.confirm('Leave this page without saving your changes?')) { history.replaceState(null, '', lastHash || '#'); return; }
    lastHash = location.hash;
    route();
  });
  window.addEventListener('beforeunload', function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  route();
})();
