/* Promotions → Mailers, "Edit myself": the mailer editor made for event managers and marketers (batch B18, UX-123,
   and the Mailers parts of UX-128, UX-131 and UX-132; the owner chose this design on 2026-11-08, owner-decisions.md #9,
   ~/.revamp-cms-qa/promo-easy-edit/DESIGN.md section 2). It loads after the platform's studio
   (promo-studio/mailer-studio.js) and Oneworld's side of it (promo-studio/oneworld.js), so what it declares wins:

     - the settings panel (mlProps). SUBJECT and PREVIEW TEXT are pinned at its top at all times, also while a section
       is selected (the platform folded them under "Mail settings & AI ▸" then). With nothing selected it shows how to
       edit (click words to type, click a picture to swap it), "Speakers & partners" (tick who appears; choose who is
       in focus), the mail's sections as a list of buttons a keyboard can reach (UX-131), "+ Add a section", the
       palette, then "▸ Advanced" (the exact accent colour, the mail's background, link tracking, the save button on
       pictures) and "▸ Writing help (AI)" folded away. With a section selected: "← All sections", its settings, and its
       exact colours folded under its own "▸ Advanced".
     - "+ Add a section", and the "+" between sections on the mail: the sections in plain groups (Text, Pictures,
       People, Event details, Footer), the rare ones under "More", Custom HTML last as advanced. The platform's
       always-open rail of 30 blocks is gone (tools/extract-promo-studio.py MARKUP_PATCHES).
     - a picture clicked in the mail is swapped in place: upload one, or paste the address of one online (the engine
       marks each picture with the setting it shows, data-img; the upload is POST /api/promo/mailer/picture). Picture
       settings in the panel have the same "Upload a picture".
     - one way to format words: the rich-text toolbar, in the mail and in the panel (Quill, on one-line fields too).
       The platform's marker bar, with its "selection · markdown" hint, is not shown any more.
     - colours: the contrast check runs without a word, and says something only when a colour fails it.

   THE ONE DOOR FOR CHANGES (owMailEdit). Every change this layout makes to the mail (words, a picture, who appears, the
   person in focus, the subject, the preview text, a section added or removed) goes through owMailEdit. It applies the
   change with the studio's own functions (mlSetProp, mlAdd) and ends on the studio's own redraw (mlStatus, mlProps,
   mlRender), which is where the studio takes its Undo history from (mlHistPush). Each change is one step that Undo
   takes back, recorded at once (owHistNow) so it is never merged with what came before; typing (the subject, the
   preview text) is gathered into one step the way the studio gathers it. ETB2B AI (batch B18-ai) makes its changes
   through this same door, so "do it, then Undo" works the same for both.

   Browser code is ES5 (no let, const or arrow functions), as the rest of Oneworld's. */

/* ---------- state kept across the panel's redraws ---------- */
var OWE = { adv: false, help: false, blkAdv: false, more: false, popFrom: null, rosterTimer: null, focusAfter: null, shown: null };
/* the settings that hold a picture (the engine's PICTURE_PROPS, blocks.ts tagPictures) */
var OW_PICTURE_KEYS = ['url', 'logo', 'logoLight', 'photo', 'image'];
var OW_PICTURE_MAX = 8 * 1024 * 1024;          // the server's limit (lib/promo-mailer.js MAIL_PICTURE_MAX)
var OW_PICTURE_SHRINK_EDGE = 2400;             // a larger file is made smaller here first, on its long edge
/* the groups of "+ Add a section", in order; blocks the engine puts in no group go under More */
var OW_GROUPS = [['text', 'Text'], ['pictures', 'Pictures'], ['people', 'People'], ['event', 'Event details'], ['footer', 'Footer']];
/* where the console keeps each list a mail draws from (edit-event.html's routes) */
var OW_ROSTER_HOME = { speakers: ['Content › Speakers', 'content/speakers'], partners: ['Content › Sponsors', 'content/sponsors'],
  sessions: ['Content › Agenda', 'content/agenda'] };

function owEsc(s) { return escapeHtml(s == null ? '' : String(s)); }
/* a block id as a part of an element id or a selector (the engine's ids are letters and digits; an imported mail's
   are kept as they came) */
function owSafeId(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, ''); }
function owConsoleLink(route) { return '/edit-event.html?event=' + encodeURIComponent(EVENT_ID) + '#' + route; }

/* ================= the one door for changes ================= */

/* One Undo step now, of whatever the mail is at this moment. The studio's own recorder (mlHistPush) waits 350 ms, so
   that a held key is one step; a change made in one go (a picture, a tick, ETB2B AI) must not be folded into the
   typing just before it, or Undo would take both back. This is the recorder's own step, without the wait. */
function owHistNow() {
  if (typeof MLH === 'undefined' || MLH.busy || !MD.doc) return;
  clearTimeout(MLH.t);
  var s = mlHistSnap();
  if (!s || s === MLH.stack[MLH.at]) return;
  MLH.stack = MLH.stack.slice(0, MLH.at + 1);
  MLH.stack.push(s);
  if (MLH.stack.length > MLH_MAX) MLH.stack.shift();
  MLH.at = MLH.stack.length - 1;
}
function owBlockById(id) { var i = blockIndex(id); return i < 0 ? null : MD.doc.blocks[i]; }
/* where a section added from the panel goes: after the selected one; with none selected, at the end of the mail but
   above its footer (a section under the legal footer reads as a mistake) */
function owDefaultAt() {
  if (MD.sel && blockIndex(MD.sel) !== -1) return blockIndex(MD.sel) + 1;
  var bs = MD.doc.blocks || [], n = bs.length;
  while (n > 0 && bs[n - 1] && (bs[n - 1].type === 'footer' || bs[n - 1].type === 'social')) n--;
  return n;
}
/* change: { kind, … } —
     words      { path: "blockId|field" (or "blockId|items.2.text", "blockId|text#1"), value }   the studio's mlSetProp
     picture    { path, value: "https://…" }                                                  likewise
     people     { block, items: [...] }        who appears in a speakers / partners / agenda section
     person     { block, person: { name, role, company, photo } }   who is in focus in "One speaker, large"
     subject    { value }    preview { value }
     add        { type, at? }   a new section (the server seeds it from the event); remove { block }
   o.typing: one keystroke of many (gathered into one Undo step; the panel is not drawn again under the cursor).
   Resolves true when the mail changed. */
function owMailEdit(change) {
  if (!change || typeof MD === 'undefined' || !MD.doc) return Promise.resolve(false);
  var typing = !!change.typing, k = change.kind;
  if (!typing) owHistNow();
  if (k === 'add') {
    var at = change.at != null ? change.at : MD.insertAt != null ? null : owDefaultAt();
    OWE.focusAfter = '#owBlkName';
    return Promise.resolve(mlAdd(change.type, at == null ? undefined : at)).then(function () {
      owHistNow();
      return true;
    });
  }
  var b = change.block ? owBlockById(change.block) : null;
  if (k === 'words' || k === 'picture') {
    if (typeof change.path !== 'string' || change.path.indexOf('|') < 1) return Promise.resolve(false);
    if (!owBlockById(change.path.split('|')[0])) return Promise.resolve(false);
    mlSetProp(change.path, String(change.value == null ? '' : change.value));
  } else if (k === 'people') {
    if (!b || !Array.isArray(change.items)) return Promise.resolve(false);
    b.props.items = change.items;
  } else if (k === 'person') {
    if (!b || !change.person) return Promise.resolve(false);
    ['name', 'role', 'company', 'photo'].forEach(function (f) { b.props[f] = String(change.person[f] || ''); });
  } else if (k === 'subject') {
    MD.doc.subject = String(change.value == null ? '' : change.value);
  } else if (k === 'preview') {
    MD.doc.preheader = String(change.value == null ? '' : change.value);
  } else if (k === 'remove') {
    if (!b) return Promise.resolve(false);
    mlDel(b.id);
    owHistNow();
    return Promise.resolve(true);
  } else return Promise.resolve(false);
  MD.dirty = true;
  if (typing) { mlStatus(); mlRender(700); return Promise.resolve(true); }
  mlProps(); mlStatus(); mlRender(0);
  owHistNow();
  return Promise.resolve(true);
}

/* ================= words the platform wrote, in plain words (PATCHES) ================= */

/* a speakers / partners / agenda list that is empty: where to add them (it said "… in the API") */
function owRosterNone(kind) {
  var home = OW_ROSTER_HOME[kind] || OW_ROSTER_HOME.speakers;
  return 'This event has no ' + owEsc(kind) + ' yet. <a href="' + owEsc(owConsoleLink(home[1])) + '" target="_top">Add them in ' + owEsc(home[0]) + '</a>.';
}
/* a list that has reached its most (it said "raise Max above", a field the overview does not show) */
function owLimitNote(max) { return 'All ' + max + ' places are taken. Untick one to swap someone in, or show more in this section’s settings.'; }

/* ================= "+ Add a section" ================= */

/* within a group, the ones people reach for first: a heading before a title band, a picture before a collage */
var OW_ADD_FIRST = ['heading', 'text', 'bullets', 'button', 'quote', 'hero', 'image', 'banner', 'mosaic', 'logobar',
  'speakers', 'speaker', 'sponsors', 'contacts', 'meta', 'sessions', 'stats', 'pricing', 'footer', 'social'];
function owAddOrder(a, b) {
  var i = OW_ADD_FIRST.indexOf(a.type), j = OW_ADD_FIRST.indexOf(b.type);
  return (i === -1 ? 99 : i) - (j === -1 ? 99 : j);
}
/* the addable blocks in their groups, in order: [{ id, name, blocks }], More last (with Custom HTML at its end) */
function owAddGroups(blocks) {
  var add = (blocks || []).filter(function (b) { return b && b.addable; });
  var known = {}, out = [];
  OW_GROUPS.forEach(function (g) { known[g[0]] = true; });
  OW_GROUPS.forEach(function (g) {
    var bs = add.filter(function (b) { return b.group === g[0]; }).sort(owAddOrder);
    if (bs.length) out.push({ id: g[0], name: g[1], blocks: bs });
  });
  var more = add.filter(function (b) { return !known[b.group] && b.group !== 'advanced'; })
    .concat(add.filter(function (b) { return b.group === 'advanced'; }));
  if (more.length) out.push({ id: 'more', name: 'More', blocks: more });
  return out;
}
function owAddHtml(groups, moreOpen) {
  return groups.map(function (g) {
    var more = g.id === 'more';
    var rows = g.blocks.map(function (b) {
      return '<button type="button" class="ow-addb" data-type="' + owEsc(b.type) + '">' + owEsc(b.label) +
        (b.group === 'advanced' ? ' <span class="ow-adv-tag">advanced</span>' : '') + '</button>';
    }).join('');
    if (more) {
      return '<div class="ow-addg ow-addg-more">' +
        '<button type="button" class="ow-disc ow-more-tg" aria-expanded="' + !!moreOpen + '" aria-controls="owAddMore">' + (moreOpen ? '▾' : '▸') + ' More sections</button>' +
        '<div class="ow-addl" id="owAddMore"' + (moreOpen ? '' : ' hidden') + '>' + rows + '</div></div>';
    }
    return '<div class="ow-addg" role="group" aria-label="' + owEsc(g.name) + '"><div class="ow-addh">' + owEsc(g.name) + '</div><div class="ow-addl">' + rows + '</div></div>';
  }).join('');
}
/* The platform's popover, filled with the groups and placed by what opened it: beside the "+" between two sections,
   or under "+ Add a section" (a keyboard's click has no pointer position, so the button's own place is used). */
var owMlPalette = mlPalette, owMlPopClose = mlPopClose;
mlPalette = function (at, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  var opener = e && (e.currentTarget && e.currentTarget.nodeType === 1 ? e.currentTarget : e.target);
  OWE.popFrom = opener && opener.closest ? (opener.closest('button') || opener) : null;
  var pal = $('mlPal');
  if (pal) pal.innerHTML = owAddHtml(owAddGroups(MAILERS && MAILERS.blocks), OWE.more);
  owWirePop();
  owMlPalette(at, e && e.clientX ? e : null);
  owPlacePop(e);
  var first = pal && pal.querySelector('.ow-addb');
  if (first && first.focus) setTimeout(function () { try { first.focus(); } catch (x) { /* a nicety */ } }, 0);
};
function owPlacePop(e) {
  var pop = $('mlPop'); if (!pop) return;
  var w = 320, h = Math.min(520, window.innerHeight - 24), x, y;
  if (e && e.clientX) { x = e.clientX - w / 2; y = e.clientY + 14; }
  else if (OWE.popFrom && OWE.popFrom.getBoundingClientRect) { var r = OWE.popFrom.getBoundingClientRect(); x = r.right - w; y = r.bottom + 6; }
  else { x = window.innerWidth - w - 24; y = 120; }
  pop.style.width = w + 'px';
  pop.style.left = Math.round(Math.max(12, Math.min(x, window.innerWidth - w - 12))) + 'px';
  pop.style.top = Math.round(Math.max(12, Math.min(y, window.innerHeight - h - 12))) + 'px';
}
function owWirePop() {
  var pal = $('mlPal'); if (!pal) return;
  pal.onclick = function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!t) return;
    ev.stopPropagation();
    if (t.classList.contains('ow-more-tg')) {
      OWE.more = !OWE.more;
      var box = $('owAddMore');
      if (box) box.hidden = !OWE.more;
      t.setAttribute('aria-expanded', String(OWE.more));
      t.textContent = (OWE.more ? '▾' : '▸') + ' More sections';
      return;
    }
    var type = t.getAttribute('data-type');
    if (type) owMailEdit({ kind: 'add', type: type });
  };
  /* ↑ ↓ move between the choices; Escape is the studio's own (it closes the popover) */
  pal.onkeydown = function (ev) {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    var all = Array.prototype.slice.call(pal.querySelectorAll('button')).filter(function (b) { return b.offsetParent !== null; });
    var i = all.indexOf(document.activeElement);
    if (i === -1) return;
    ev.preventDefault();
    var n = all[Math.max(0, Math.min(all.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))];
    if (n && n.focus) n.focus();
  };
}
/* closing gives the keyboard back to whatever opened it */
mlPopClose = function () {
  var wasOpen = $('mlPop') && $('mlPop').classList.contains('on');
  var r = owMlPopClose.apply(this, arguments);
  var from = OWE.popFrom; OWE.popFrom = null;
  if (wasOpen && from && from.isConnected && from.focus) { try { from.focus(); } catch (x) { /* gone */ } }
  return r;
};

/* ================= the settings panel ================= */

/* the words a section shows first, for its row in the list: its heading or title, else its first text */
function owSnippet(b) {
  var q = (b && b.props) || {};
  var t = q.title || q.text || q.name || q.label || q.flag || q.eyebrow || '';
  if (!t && Array.isArray(q.items) && q.items.length) {
    var it = q.items[0] || {};
    t = typeof it === 'string' ? it : (it.name || it.title || it.text || (it.label && it.value ? it.label + ': ' + it.value : it.label || it.value) || '');
    if (q.items.length > 1 && t) t += ' and ' + (q.items.length - 1) + ' more';
  }
  t = String(t).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|~~|==|\*)/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 46).replace(/\s+\S*$/, '') + '…' : t;
}
function owSectionsHtml(blocks, sel) {
  var bs = (blocks || []).filter(function (b) { return b && typeof b.type === 'string'; });
  if (!bs.length) return '<div class="hint">This mail has no sections yet.</div>';
  return '<div class="ow-rows" role="list">' + bs.map(function (b) {
    var schema = BS[b.type] || {}, snip = owSnippet(b);
    return '<div role="listitem"><button type="button" class="ow-row" data-id="' + owEsc(b.id) + '"' + (b.id === sel ? ' aria-current="true"' : '') + '>' +
      '<b>' + owEsc(schema.label || b.type) + '</b>' + (snip ? '<span>' + owEsc(snip) + '</span>' : '') + '</button></div>';
  }).join('') + '</div>';
}
/* the sections a sender picks people for: the speakers and partners lists, and "One speaker, large" */
function owPeopleBlocks(blocks) {
  return (blocks || []).filter(function (b) {
    if (!b) return false;
    if (b.type === 'speaker') return true;
    var f = owMultipickOf(b);
    return !!f && (f.source === 'speakers' || f.source === 'sponsors');
  });
}
function owMultipickOf(b) { return ((BS[b.type] || {}).fields || []).filter(function (f) { return f.type === 'multipick'; })[0] || null; }
/* a colour typed exactly is advanced (DESIGN.md: "exact colour hex"); one asked for by a choice ("Custom…") stays by it */
function owIsAdvancedField(f) { return !!f && f.type === 'color' && !f.showWhen; }
function owHasText(b) { return ((BS[b.type] || {}).fields || []).some(function (f) { return f.type === 'text' || f.type === 'textarea' || (f.type === 'list' && f.rich); }); }
function owHasPicture(b) {
  var fields = (BS[b.type] || {}).fields || [];
  return fields.some(function (f) { return f.type === 'url' && OW_PICTURE_KEYS.indexOf(f.key) !== -1; }) ||
    fields.some(function (f) { return f.type === 'list' && (f.itemFields || []).some(function (x) { return x.type === 'url' && OW_PICTURE_KEYS.indexOf(x.key) !== -1; }); });
}
function owDisc(id, open, label) {
  return '<button type="button" class="ow-disc" data-disc="' + id + '" aria-expanded="' + !!open + '" aria-controls="' + id + '">' + (open ? '▾ ' : '▸ ') + owEsc(label) + '</button>';
}

mlProps = function () {
  mlHistPush();
  var host = $('mlProps'); if (!host) return;
  /* the panel is drawn afresh after every change: its scroll, and the field being typed in, are put back */
  var keep = host.scrollTop, act = document.activeElement, actId = act && host.contains(act) ? act.id : '';
  host.innerHTML = '';
  if (ICP.el) iconPopPlace();
  if (!MD.doc) { host.innerHTML = '<div class="ed-empty"><span class="ic">✉</span>Loading…</div>'; return; }
  var b = MD.sel ? MD.doc.blocks[blockIndex(MD.sel)] : null;
  host.appendChild(owPinned());
  host.appendChild(b ? owBlockPanel(b) : owOverview());
  /* the same view drawn again keeps its place (a tick halfway down a list); another section, or back to the
     overview, starts at the top, where its name and "← All sections" are (they were left out of sight under the
     pinned subject) */
  var same = OWE.shown === (MD.sel || '');
  OWE.shown = MD.sel || '';
  if (keep && same) host.scrollTop = keep;
  if (actId && $(actId) && $(actId).focus) { try { $(actId).focus(); } catch (x) { /* a nicety */ } }
  if (OWE.focusAfter) { var f = OWE.focusAfter; OWE.focusAfter = null; var n = host.querySelector(f); if (n && n.focus) { try { n.focus(); } catch (x) { /* a nicety */ } } }
  owWatchRoster();
};

/* Subject and preview text: always first, and kept in view while the panel scrolls (oneworld-mail-easy.css) */
function owPinned() {
  var d = document.createElement('div');
  d.className = 'ow-pin';
  d.setAttribute('role', 'group');
  d.setAttribute('aria-label', 'Subject and preview text');
  d.innerHTML =
    '<div class="fld"><label for="mlSubject">Subject line</label><input id="mlSubject" autocomplete="off" value="' + owEsc(MD.doc.subject) + '"></div>' +
    '<div class="fld"><label for="mlPre">Preview text</label><input id="mlPre" autocomplete="off" value="' + owEsc(MD.doc.preheader) + '">' +
      '<div class="hint">Shown after the subject in most inboxes.</div></div>';
  d.querySelector('#mlSubject').oninput = function (e) { owMailEdit({ kind: 'subject', value: e.target.value, typing: true }); };
  d.querySelector('#mlPre').oninput = function (e) { owMailEdit({ kind: 'preview', value: e.target.value, typing: true }); };
  return d;
}

/* nothing selected: the easy overview */
function owOverview() {
  var box = document.createElement('div');
  box.className = 'ow-over';
  var people = owPeopleBlocks(MD.doc.blocks);
  var track = !(MAILERS && MAILERS.tracking === false);
  box.innerHTML =
    '<p class="ow-how">Click any words in the mail to type over them. Click a picture to swap it.</p>' +
    (people.length ? '<div class="ow-sec" id="owPeople"><div class="ph">Speakers &amp; partners</div></div>' : '') +
    '<div class="ow-sec"><div class="ph">Sections in this mail</div>' + owSectionsHtml(MD.doc.blocks, null) +
      '<button type="button" class="btn alt sm ow-add" id="owAdd">+ Add a section</button></div>' +
    '<div class="ow-sec"><div class="fld"><label for="mlTheme">Look</label><select id="mlTheme">' +
      '<option value="site"' + (MD.doc.theme === 'site' ? ' selected' : '') + '>Match the event website</option>' +
      '<option value="light"' + (MD.doc.theme === 'light' ? ' selected' : '') + '>Light</option>' +
      '<option value="dark"' + (MD.doc.theme === 'dark' ? ' selected' : '') + '>Dark</option></select></div></div>' +
    '<div class="ow-sec">' + owDisc('owAdv', OWE.adv, 'Advanced') +
      '<div id="owAdv"' + (OWE.adv ? '' : ' hidden') + '>' +
        '<div class="fld"><label for="mlAccent">Accent colour</label>' +
          '<div class="clr"><input type="color" id="mlAccentPick" aria-label="Pick the accent colour" value="' + owEsc(MD.doc.accent || (MAILERS.event && MAILERS.event.siteAccent) || '#4f46e5') + '">' +
          '<input id="mlAccent" value="' + owEsc(MD.doc.accent || '') + '" placeholder="' + owEsc((MAILERS.event && MAILERS.event.siteAccent) || 'the event site’s') + '"></div>' +
          '<div class="hint">Leave it empty to use the event site’s colour.</div></div>' +
        '<div class="fld"><label for="mlBg">Mailer background<span class="ai" role="button" tabindex="0" onclick="mlSetBg(\'\')" onkeydown="if(event.key===\'Enter\')mlSetBg(\'\')" title="Back to the palette’s own">reset</span></label>' +
          '<div class="sw" id="mlSwatches"></div>' +
          '<div class="clr"><input type="color" id="mlBgPick" aria-label="Pick the background colour" value="' + owEsc(MD.doc.background || mlDefaultBg()) + '">' +
          '<input id="mlBg" value="' + owEsc(MD.doc.background || '') + '" placeholder="' + owEsc(mlDefaultBg()) + ' (the palette’s own)"></div>' +
          '<div class="hint">Behind the whole mail. Words, lines and tints change to stay readable on it.</div></div>' +
        (track ? '<div class="fld"><label>Link tracking</label>' +
          '<select onchange="MD.doc.trackLinks=this.value;MD.dirty=true;mlStatus()">' +
            '<option value="no"' + (String(MD.doc.trackLinks == null ? 'no' : MD.doc.trackLinks) === 'no' ? ' selected' : '') + '>Off: links go straight to their page</option>' +
            '<option value="yes"' + (String(MD.doc.trackLinks == null ? 'no' : MD.doc.trackLinks) === 'yes' ? ' selected' : '') + '>On: count the clicks on each link</option></select>' +
          '<div class="hint">With it on, each link passes through ETB2B EventSphere first so its clicks can be counted, and readers see that address when they point at a link. Opens are counted either way.</div></div>' : '') +
        '<div class="fld"><label>Save button on pictures</label>' +
          '<select onchange="MD.doc.imageGuard=this.value;MD.dirty=true;mlRender(0)">' +
            '<option value="yes"' + (String(MD.doc.imageGuard == null ? 'yes' : MD.doc.imageGuard) !== 'no' ? ' selected' : '') + '>Hide it (recommended)</option>' +
            '<option value="no"' + (String(MD.doc.imageGuard == null ? 'yes' : MD.doc.imageGuard) === 'no' ? ' selected' : '') + '>Leave it</option></select>' +
          '<div class="hint">Gmail and Outlook put a download button over large pictures. Hiding it makes each picture that has no link of its own a link to nowhere, which stops the button; it is not counted as a link and adds no address. Your own links do not change.</div></div>' +
      '</div></div>' +
    '<div class="ow-sec">' + owDisc('owHelp', OWE.help, 'Writing help (AI)') +
      '<div id="owHelp"' + (OWE.help ? '' : ' hidden') + '><div class="ml-ai">' +
        '<div class="fld" style="margin:0"><label for="mlTone">Tone</label><select id="mlTone">' +
          ((MAILERS.tones || ['professional']).map(function (t) { return '<option value="' + owEsc(t) + '"' + (MD.tone === t ? ' selected' : '') + '>' + owEsc(t.charAt(0).toUpperCase() + t.slice(1)) + '</option>'; }).join('')) +
        '</select></div>' +
        '<div class="r"><button type="button" class="btn alt sm" onclick="mlAiSubjects()">Subject ideas</button>' +
          '<button type="button" class="btn alt sm" onclick="mlAiPolish()">Polish the words</button></div>' +
        '<div class="r"><button type="button" class="btn sm" style="flex:1;justify-content:center" onclick="mlAiEnhance()">Improve the whole mail</button></div>' +
        '<div id="mlAiOut"></div></div></div></div>';
  if (people.length) {
    var ph = box.querySelector('#owPeople');
    people.forEach(function (b) { ph.appendChild(owPeopleControl(b)); });
  }
  box.querySelector('#owAdd').onclick = function (e) { mlPalette(null, e); };
  owWireRows(box);
  owWireDiscs(box);
  box.querySelector('#mlTheme').onchange = function (e) { MD.doc.theme = e.target.value; MD.dirty = true; mlRender(0); };
  box.querySelector('#mlTone').onchange = function (e) { MD.tone = e.target.value; };
  box.querySelector('#mlAccent').oninput = function (e) { MD.doc.accent = e.target.value.trim() || undefined; MD.dirty = true; mlRender(450); };
  box.querySelector('#mlAccentPick').oninput = function (e) { MD.doc.accent = e.target.value; box.querySelector('#mlAccent').value = e.target.value; MD.dirty = true; mlRender(250); };
  box.querySelector('#mlBg').oninput = function (e) { mlSetBg(e.target.value.trim(), true); };
  box.querySelector('#mlBgPick').oninput = function (e) { mlSetBg(e.target.value, true); };
  /* the swatches are drawn into #mlSwatches, which must be in the page first */
  setTimeout(function () { if ($('mlSwatches')) mlSwatches(); }, 0);
  return box;
}
/* tick who appears (the platform's own list, fldMultipick), or, for "One speaker, large", choose who it is */
function owPeopleControl(b) {
  var schema = BS[b.type] || {};
  var wrap = document.createElement('div');
  wrap.className = 'ow-people';
  var title = document.createElement('div');
  title.className = 'ow-people-h';
  title.innerHTML = '<b>' + owEsc(schema.label || b.type) + '</b>';
  wrap.appendChild(title);
  wrap.id = 'owPeople_' + owSafeId(b.id);
  if (b.type === 'speaker') { wrap.appendChild(owFocusPicker(b)); return wrap; }
  var f = owMultipickOf(b);
  var el = fldMultipick(f, b, function (items) {
    /* the list is drawn afresh: the keyboard goes back to the box just ticked */
    var a = document.activeElement;
    if (a && a.getAttribute && a.getAttribute('data-i') != null) OWE.focusAfter = '#' + wrap.id + ' input[data-i="' + a.getAttribute('data-i') + '"]';
    owMailEdit({ kind: 'people', block: b.id, items: items });
  });
  wrap.appendChild(el);
  return wrap;
}
function owFocusPicker(b) {
  var d = document.createElement('div');
  d.className = 'fld';
  var list = MLA.speakers || [], cur = String(b.props.name || '').toLowerCase(), id = 'owFocus_' + b.id;
  d.innerHTML = '<label for="' + owEsc(id) + '">Speaker in focus</label><select id="' + owEsc(id) + '"' + (!MLA.loaded || !list.length ? ' disabled' : '') + '>' +
    (!MLA.loaded ? '<option>Loading this event’s speakers…</option>'
      : !list.length ? '<option>No speakers yet</option>'
      : (list.some(function (x) { return String(x.name || '').toLowerCase() === cur; }) ? '' : '<option value="">' + owEsc(b.props.name || 'Choose a speaker') + '</option>') +
        list.map(function (x, i) {
          return '<option value="' + i + '"' + (String(x.name || '').toLowerCase() === cur ? ' selected' : '') + '>' + owEsc(x.name + (x.company ? ' — ' + x.company : '')) + '</option>';
        }).join('')) +
    '</select>' + (MLA.loaded && !list.length ? '<div class="hint">' + owRosterNone('speakers') + '</div>' : '');
  var sel = d.querySelector('select');
  sel.onchange = function () {
    var x = list[+sel.value]; if (!x) return;
    OWE.focusAfter = '#' + id;
    owMailEdit({ kind: 'person', block: b.id, person: { name: x.name, role: x.designation, company: x.company, photo: x.photoUrl } });
  };
  return d;
}
/* the section list: Enter or a click selects (and brings it into view); ↑ ↓ move along it */
function owWireRows(box) {
  var rows = Array.prototype.slice.call(box.querySelectorAll('.ow-row'));
  rows.forEach(function (r, i) {
    r.onclick = function () { OWE.focusAfter = '#owBlkName'; mlSelect(r.getAttribute('data-id'), { reveal: true }); };
    r.onkeydown = function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      var n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n && n.focus) n.focus();
    };
  });
}
function owWireDiscs(box) {
  Array.prototype.forEach.call(box.querySelectorAll('.ow-disc[data-disc]'), function (btn) {
    btn.onclick = function () {
      var id = btn.getAttribute('data-disc'), panel = $(id) || box.querySelector('#' + id);
      var open = !(panel && !panel.hidden);
      if (id === 'owAdv') OWE.adv = open; else if (id === 'owHelp') OWE.help = open; else if (id === 'owBlkAdv') OWE.blkAdv = open;
      if (panel) panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = (open ? '▾ ' : '▸ ') + btn.textContent.replace(/^[▸▾]\s*/, '');
      if (open && id === 'owAdv' && $('mlSwatches')) mlSwatches();
    };
  });
}
/* back to the overview, the keyboard on that section's row */
function owAllSections() {
  var id = MD.sel;
  OWE.focusAfter = id ? '.ow-row[data-id="' + String(id).replace(/["\\]/g, '') + '"]' : '#owAdd';
  mlSelect(null);
}

/* a section selected: its settings */
function owBlockPanel(b) {
  var schema = BS[b.type] || { label: b.type, fields: [] };
  var box = document.createElement('div');
  box.className = 'ow-blk';
  var say = [];
  if (owHasText(b)) say.push('Click its words in the mail to type over them.');
  if (owHasPicture(b)) say.push('Click a picture to swap it.');
  box.innerHTML =
    '<button type="button" class="ow-back" id="owBack">← All sections</button>' +
    '<div class="ph ow-blkh"><span id="owBlkName" tabindex="-1">' + owEsc(schema.label) + '</span>' +
      '<span class="rowbtns"><button type="button" class="btn ghost sm" id="owDup">Duplicate</button><button type="button" class="btn ghost sm" id="owDel">Remove</button></span></div>' +
    (say.length ? '<p class="ow-how">' + owEsc(say.join(' ')) + '</p>' : '');
  box.querySelector('#owBack').onclick = owAllSections;
  box.querySelector('#owDup').onclick = function () { owHistNow(); mlDup(b.id); owHistNow(); };
  box.querySelector('#owDel').onclick = function () { owAllSectionsAfterRemove(b.id); };
  var fields = document.createElement('div');
  fields.className = 'ow-fields';
  box.appendChild(fields);
  if (!(schema.fields || []).length) {
    var d = document.createElement('div'); d.className = 'hint'; d.textContent = 'This section has no settings.'; fields.appendChild(d);
    return box;
  }
  mlFields(fields, b);
  /* exact colours fold away under the section's own Advanced: the platform built them in place, so they are moved,
     with their handlers, into the fold (a field another field shows or hides is still drawn by mlFields) */
  var adv = (schema.fields || []).filter(owIsAdvancedField).map(function (f) { return fields.querySelector('[data-fkey="' + f.key + '"]'); }).filter(Boolean);
  if (adv.length) {
    var wrap = document.createElement('div');
    wrap.className = 'ow-sec';
    wrap.innerHTML = owDisc('owBlkAdv', OWE.blkAdv, 'Advanced: exact colours') + '<div id="owBlkAdv"' + (OWE.blkAdv ? '' : ' hidden') + '></div>';
    var inner = wrap.querySelector('#owBlkAdv');
    adv.forEach(function (n) { inner.appendChild(n); });
    fields.appendChild(wrap);
    owWireDiscs(wrap);
  }
  return box;
}
function owAllSectionsAfterRemove(id) {
  OWE.focusAfter = '#owAdd';
  owMailEdit({ kind: 'remove', block: id });
}

/* the speakers and partners load after the studio opens: the overview, which shows them, is drawn again once they are
   in (the platform redraws only when a section is selected), unless the sender is typing in the panel meanwhile */
function owWatchRoster() {
  if (OWE.rosterTimer || typeof MLA === 'undefined' || MLA.loaded) return;
  var tries = 0;
  (function wait() {
    OWE.rosterTimer = setTimeout(function () {
      OWE.rosterTimer = null;
      if (!MLA.loaded) { if (++tries < 100) wait(); return; }
      var host = $('mlProps'), act = document.activeElement;
      if (MD.sel || !owStudioOpen() || (host && act && host.contains(act) && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName))) return;
      mlProps();
    }, 250);
  })();
}

/* ================= pictures ================= */

/* the picture under a point of the canvas: its data-img ("blockId|path"), or null */
function owPictureAt(clientX, clientY) {
  var f = $('mlFrame'), d = f && f.contentDocument;
  if (!d || !d.elementFromPoint) return null;
  var fr = f.getBoundingClientRect(), sc = owStageScale();
  var el = d.elementFromPoint((clientX - fr.left) / sc, (clientY - fr.top) / sc);
  var hit = el && el.closest ? el.closest('[data-img]') : null;
  return hit ? hit.getAttribute('data-img') : null;
}
/* A click on the mail: a picture is swapped; words are edited in place as before (the platform's mlEditAt) */
var owMlEditAt = mlEditAt;
mlEditAt = function (clientX, clientY) {
  var path = owPictureAt(clientX, clientY);
  if (path) { owSwapPictureAt(path); return true; }
  return owMlEditAt(clientX, clientY);
};
/* what the dialog calls the picture: "Ananya Rao's photo", "the logo", "the picture" */
function owPictureName(path) {
  var parts = String(path || '').split('|'), b = owBlockById(parts[0]), key = parts[1] || '';
  var m = /^items\.(\d+)\.(\w+)$/.exec(key), it = m && b && Array.isArray(b.props.items) ? b.props.items[+m[1]] : null;
  var leaf = m ? m[2] : key;
  var who = it ? String(it.name || it.title || '').trim() : (b && b.type === 'speaker' ? String(b.props.name || '').trim() : '');
  var what = leaf === 'logo' || leaf === 'logoLight' ? 'logo' : leaf === 'photo' ? 'photo' : 'picture';
  return who ? who + '’s ' + what : 'the ' + what;
}
function owSwapPictureAt(path) {
  var cur = mlGetProp(path);
  owSwapPicture({ title: 'Change ' + owPictureName(path), current: cur, apply: function (url) { return owMailEdit({ kind: 'picture', path: path, value: url }); } });
}
/* The dialog: upload a picture, or paste the address of one online. o: { title, current, apply(url) }. Resolves the
   address used, or null. The studio's own dialog (uiOpen) with an upload button in its body. */
function owSwapPicture(o) {
  var body = '<p class="ow-pic-say">Upload a picture from your computer, or paste the address of a picture that is online.</p>' +
    '<div class="ow-pic-row"><button type="button" class="btn alt sm" id="owPicUp">Upload a picture</button>' +
    '<span class="hint" id="owPicMsg" role="status" aria-live="polite">JPG, PNG, GIF or WebP, up to 8 MB.</span></div>' +
    '<input type="file" id="owPicFile" accept="image/jpeg,image/png,image/gif,image/webp" hidden>' +
    '<label class="ow-pic-lbl" for="uiModalInput">Or paste a picture’s address</label>';
  var asked = uiOpen({ title: o.title || 'Change the picture', message: body, input: true, value: o.current || '', placeholder: 'https://…', ok: 'Use this address', cancel: 'Cancel' });
  var up = $('owPicUp'), file = $('owPicFile');
  if (up && file) {
    up.onclick = function () { file.click(); };
    file.onchange = function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      owPicBusy(true, 'Uploading…');
      owUploadPicture(f).then(function (url) {
        owPicBusy(false, '');
        uiClose(url);
      }, function (err) {
        owPicBusy(false, String(err && err.message || 'The picture could not be uploaded.'), true);
      });
    };
  }
  return asked.then(function (v) {
    if (v == null) return null;
    v = String(v).trim();
    if (!v || v === String(o.current || '')) return null;
    if (!/^https:\/\/[^\s"'<>]+$/i.test(v)) { toast('A picture’s address starts with https:// — upload the picture instead if it is on your computer.', 6000, 'error'); return null; }
    return Promise.resolve(o.apply(v)).then(function () { toast('Picture changed', undefined, 'success'); return v; });
  });
}
function owPicBusy(on, words, bad) {
  var up = $('owPicUp'), msg = $('owPicMsg'), ok = $('uiModalOk');
  if (up) up.disabled = !!on;
  if (ok) ok.disabled = !!on;
  if (msg) { msg.textContent = words || 'JPG, PNG, GIF or WebP, up to 8 MB.'; msg.classList.toggle('ow-bad', !!bad); }
}
/* Resolves the uploaded picture's public address; rejects with words to show. A file over the limit is first made
   smaller here (a phone's 12 MB photo), so it can still be used. */
function owUploadPicture(file) {
  if (!file || !file.size) return Promise.reject(new Error('That file is empty. Choose a picture.'));
  if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.type || '')) return Promise.reject(new Error('Choose a JPG, PNG, GIF or WebP picture.'));
  return owShrink(file).then(function (blob) {
    if (blob.size > OW_PICTURE_MAX) throw new Error('That picture is larger than 8 MB. Choose a smaller one.');
    return window.RevampAuth.authedFetch('/api/promo/mailer/picture?eventId=' + encodeURIComponent(EVENT_ID),
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
  }).then(function (r) {
    return r.json().then(null, function () { return {}; }).then(function (j) {
      if (!r.ok || !j || typeof j.url !== 'string') throw new Error((j && j.error) || 'The picture could not be uploaded. Please try again.');
      return j.url;
    });
  });
}
function owShrink(file) {
  if (file.size <= OW_PICTURE_MAX || !document.createElement('canvas').toBlob) return Promise.resolve(file);
  return new Promise(function (ok) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var s = Math.min(1, OW_PICTURE_SHRINK_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      var g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) { ok(b || file); }, 'image/jpeg', 0.86);
    };
    img.onerror = function () { URL.revokeObjectURL(url); ok(file); };
    img.src = url;
  });
}

/* ================= the settings' own controls ================= */

/* A picture setting gets "Upload a picture" beside its address; a one-line field that takes formatting gets the
   rich-text toolbar (one way to format words everywhere), never the platform's marker bar and its markdown hint. */
var owFldInput = fldInput;
fldInput = function (f, val, onchange, aiWhat) {
  if (f && f.type === 'text' && f.rich && richOk()) return owRichLine(f, val, onchange, aiWhat);
  var wrap = owFldInput(f, val, onchange, aiWhat);
  if (f && f.type === 'url' && OW_PICTURE_KEYS.indexOf(f.key) !== -1) owPictureButton(wrap, f, onchange);
  return wrap;
};
function owRichLine(f, val, onchange, aiWhat) {
  var id = 'f_' + Math.random().toString(36).slice(2, 9);
  var wrap = document.createElement('div');
  wrap.className = 'fld ow-line';
  wrap.innerHTML = '<label>' + owEsc(f.label) + (aiWhat ? '<span class="ai" role="button" tabindex="0" title="Rewrite with AI" onclick="mlAiField(\'' + owEsc(aiWhat) + '\',\'' + id + '\')">✨</span>' : '') + '</label>' +
    '<div id="' + id + '" class="rt"></div>' + (f.hint ? '<div class="hint">' + owEsc(f.hint) + '</div>' : '');
  var host = wrap.querySelector('#' + id);
  var q = new Quill(host, {
    theme: 'snow',
    formats: ['bold', 'italic', 'underline', 'strike', 'background', 'link'],
    modules: {
      toolbar: [['bold', 'italic', 'underline', 'strike'], [{ background: [window.RichText.HILITE] }], ['link'], ['clean']],
      /* one line: Enter does nothing (the mail prints this field on one line) */
      keyboard: { bindings: { owEnter: { key: 'Enter', handler: function () { return false; } }, owShiftEnter: { key: 'Enter', shiftKey: true, handler: function () { return false; } } } }
    }
  });
  q.setContents({ ops: window.RichText.markersToDelta(val == null ? '' : String(val)) }, 'silent');
  q.on('text-change', function () { onchange(window.RichText.deltaToMarkers(q.getContents().ops).replace(/\s*\n+\s*/g, ' ')); });
  host.__quill = q;
  return wrap;
}
function owPictureButton(wrap, f, onchange) {
  var input = wrap.querySelector('input');
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn alt sm ow-pic-btn';
  btn.textContent = 'Upload or change the picture';
  btn.onclick = function () {
    owSwapPicture({ title: 'Change the ' + String(f.label || 'picture').toLowerCase(), current: input ? input.value : '',
      apply: function (url) { if (input) input.value = url; onchange(url); } });
  };
  var hint = wrap.querySelector('.hint');
  wrap.insertBefore(btn, hint || null);
}
/* The colour field: the platform showed "label #474747 · 6.4:1 ✓ AA" under every colour. The check now runs without a
   word, and says something only when the colour fails it: for a button colour, its words against it; for a colour
   of words, against the mail's background. */
var owFldColor = fldColor;
fldColor = function (f, val, onchange) {
  var wrap = owFldColor(f, val, onchange);
  var read = wrap.querySelector('.hexr'), hx = wrap.querySelector('.hx'), pk = wrap.querySelector('.pk');
  if (!read) return wrap;
  read.style.display = 'none';
  var warn = document.createElement('div');
  warn.className = 'hint ow-warn';
  warn.setAttribute('role', 'status');
  wrap.insertBefore(warn, read);
  function look() {
    var v = hexNorm(hx ? hx.value : '');
    var w = owContrastWarning(f, v, hexNorm(MD.doc && MD.doc.background) || hexNorm(mlDefaultBg()) || '#ffffff');
    warn.textContent = w;
    warn.style.display = w ? '' : 'none';
  }
  if (hx) hx.addEventListener('input', look);
  if (pk) pk.addEventListener('input', look);
  var rst = wrap.querySelector('.rst');
  if (rst) rst.addEventListener('click', look);
  look();
  return wrap;
};
/* '' when the colour reads well; otherwise what to do about it. A colour left empty is the mail's own, which the
   studio has already made readable. */
function owContrastWarning(f, hex, bg) {
  if (!hex) return '';
  var key = String(f && f.key || '');
  if (key === 'color' || key === 'ink') {
    var r = ratio(hex, bg);
    return r < 4.5 ? 'Hard to read: this colour is too close to the mail’s background (' + r.toFixed(1) + ' to 1; it needs 4.5). Pick a ' + (relLum(bg) > 0.5 ? 'darker' : 'lighter') + ' one.' : '';
  }
  var ink = derivedInk(hex), r2 = ratio(ink, hex);
  return r2 < 4.5 ? 'Hard to read: words on this colour have too little contrast. Pick a darker or a lighter one.' : '';
}
