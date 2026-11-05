/* The event's records (Content) drawn into a saved site on the server, so a change made in the console reaches the
   staged copy at once and goes live through approval like any other edit (the owner, 3 Nov 2026). Before this, a
   record added in Content showed on the site only after someone opened the site editor and saved, and the live
   site never showed it until then.

     renderRecords(html, rows) -> { html, changed, filled: [kind], emptied: [kind], unplaced: [kind] }
       html   a saved page (site/page.html), as the editor serialised it
       rows   the event's records by console resource, as GET /api/event/<resource> lists them (each with its id,
              in the console's order): { speakers, sessions, 'agenda-groups', faqs, partners, contacts, gallery }.
              A resource left out means "not read": the kinds that need it are left as they are.
       filled    kinds whose lists now show their records
       emptied   kinds with no records: their place is marked data-rv-empty (the live page hides it, and the menu
                 links to it)
       unplaced  kinds that have records but no list on the page: the site editor adds a section for them when it
                 opens (editor-template-ui.js ensureAutoSections), the server does not design sections

   Only the editor's own list convention is drawn here — an element with data-rv-repeat-template="<kind>" is the
   model of one item, its data-rv-field descendants the item's values — which is what every AI-designed site and
   every section the editor adds for records use. A real template's own lists (template.json content.map, drawn by
   editor-fill.js) are not: the caller says so. This is the server's copy of editor-template-ui.js's
   applyGenericRepeat, setGenericRepeatField, markEmpty and markFilled, rule for rule; the values come from the same
   translators (templates/_shared/rv-records.js), so a record looks the same whoever drew it.

   The page is changed only where it has to be: a list whose items already show exactly these records is left as
   it is, and a changed list or tag is spliced into the original text. Everything else keeps its bytes. */
'use strict';

const { parseDocument } = require('htmlparser2');
const render = require('dom-serializer').default;
const domutils = require('domutils');
const { Text } = require('domhandler');
const RR = require('../../templates/_shared/rv-records.js');

function isEl(n) { return !!n && domutils.isTag(n); }
function has(el, name) { return isEl(el) && Object.prototype.hasOwnProperty.call(el.attribs, name); }
function attr(el, name) { return has(el, name) ? el.attribs[name] : null; }
function closest(el, test) { for (var n = el; n && isEl(n); n = n.parent) if (test(n)) return n; return null; }
function within(el, ancestor) { for (var n = el; n; n = n.parent) if (n === ancestor) return true; return false; }
function findAll(root, test) { return domutils.findAll(test, isEl(root) ? root.children : root); }
function findOne(root, test) { return domutils.findOne(test, isEl(root) ? root.children : root, true); }
function inTemplate(el) { return !!closest(el.parent, function (n) { return n.name === 'template'; }); }

/* the length of the text a visitor reads in el (what the editor measures as innerText) */
function textLength(el) {
  var out = '';
  (function walk(n) {
    if (n.type === 'text') { out += n.data; return; }
    if (!isEl(n) || /^(style|script|template|noscript)$/.test(n.name)) return;
    (n.children || []).forEach(walk);
  })(el);
  return out.replace(/\s+/g, ' ').trim().length;
}
function setText(el, value) {
  el.children.slice().forEach(function (c) { domutils.removeElement(c); });
  if (value !== '') domutils.appendChild(el, new Text(String(value)));
}

/* ---------- the style attribute, for a picture shown as a background ---------- */
function declarations(style) {
  var out = [], cur = '', depth = 0, quote = '';
  String(style || '').split('').forEach(function (ch) {
    if (quote) { if (ch === quote) quote = ''; cur += ch; return; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; return; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ''; return; }
    cur += ch;
  });
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function backgroundUrl(el) {
  var m = /background(?:-image)?\s*:[^;]*url\(\s*(["']?)([^"')]*)\1\s*\)/i.exec(attr(el, 'style') || '');
  return m ? m[2] : '';
}
/* as the browser writes el.style.backgroundImage = 'url(<value>)' — in place, or at the end; '' takes it away */
function setBackground(el, value) {
  var decls = declarations(attr(el, 'style')), done = false, out = [];
  decls.forEach(function (d) {
    if (/^background-image\s*:/i.test(d)) { if (value && !done) out.push('background-image: url("' + value.replace(/"/g, '\\"') + '")'); done = true; }
    else out.push(d);
  });
  if (value && !done) out.push('background-image: url("' + value.replace(/"/g, '\\"') + '")');
  if (out.length) el.attribs.style = out.join('; ') + ';'; else delete el.attribs.style;
}

/* ---------- one item ---------- */
/* The line holding an empty field when it holds nothing else of a record's — no other field, no picture — and no
   more words than a label: that line shows only "Speakers" or "Room" over nothing. -> it, or null */
function labelOnlyLine(fieldEl) {
  var line = fieldEl.parent;
  if (!isEl(line) || has(line, 'data-rv-repeat-template') || has(line, 'data-rv-item') || has(line, 'data-rv-section')) return null;
  var keeps = findOne(line, function (e) {
    return (has(e, 'data-rv-field') && !has(e, 'hidden')) || /^(img|picture|svg|video|button)$/.test(e.name) || (e.name === 'a' && has(e, 'href'));
  });
  if (keeps) return null;
  return domutils.textContent(line).replace(/\s+/g, ' ').trim().length <= RR.LABEL_LINE_CHARS ? line : null;
}

function setField(el, field, value, kind, refill) {
  var isImage = RR.isImageField(field), nested = !!findOne(el, function (e) { return has(e, 'data-rv-field'); });
  if (!value) {
    /* a record's text field that has nothing is cleared and hidden: the design's sample words are never the
       event's; its line goes too when all that is left in it is a label */
    if (!isImage && !nested) {
      setText(el, ''); el.attribs.hidden = '';
      var line = labelOnlyLine(el);
      if (line) { line.attribs.hidden = ''; line.attribs['data-rv-empty-line'] = ''; }
      return;
    }
    /* a model drawn from an earlier record still holds that record's values; the design's own placeholder
       item keeps its placeholder picture */
    if (!refill) return;
    if (isImage) { if (el.name === 'img') delete el.attribs.src; else setBackground(el, ''); }
    else if (RR.isLinkField(kind, field) && el.name === 'a') delete el.attribs.href;
    else if (!nested) setText(el, '');
    return;
  }
  if (isImage) {
    if (el.name === 'img') el.attribs.src = value; else setBackground(el, value);
    return;
  }
  if (RR.isLinkField(kind, field)) {
    if (el.name === 'a') el.attribs.href = value; else setText(el, value);
    return;
  }
  delete el.attribs.hidden;
  var hiddenLine = el.parent ? closest(el.parent, function (n) { return has(n, 'data-rv-empty-line'); }) : null;
  if (hiddenLine) { delete hiddenLine.attribs.hidden; delete hiddenLine.attribs['data-rv-empty-line']; }
  if (/^(input|textarea|select)$/.test(el.name)) return;          // the editor sets a form control's value, which is never saved
  setText(el, value);
}

/* written as the browser writes a page: hidden="", <path></path>, only & < > (and " in attributes) escaped */
var SERIALIZE = { encodeEntities: 'utf8', emptyAttrs: true, selfClosingTags: false };
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
/* A speaker's profile for the visitor's pop-up (templates/_shared/rv-popups.js), built as the editor builds it
   (editor-template-ui.js setSpeakerProfile): never drawn on the page; never the speaker's e-mail or phone. */
function setProfile(card, profile) {
  findAll(card, function (e) { return e.name === 'template' && has(e, 'data-rv-profile'); }).forEach(function (t) { domutils.removeElement(t); });
  if (!profile || !(profile.bio || profile.li || (profile.sessions && profile.sessions.length))) return;
  var html = '<template data-rv-profile="">';
  if (profile.name) html += '<span data-rv-profile-for="" hidden="">' + esc(profile.name) + '</span>';
  if (profile.bio) html += '<p data-rv-profile-bio="">' + esc(profile.bio) + '</p>';
  if (profile.li) html += '<a data-rv-profile-li="" href="' + escAttr(profile.li) + '" target="_blank" rel="noopener">LinkedIn</a>';
  if (profile.sessions && profile.sessions.length) {
    html += '<p data-rv-profile-sessions-title="">' + (profile.sessions.length > 1 ? 'Sessions' : 'Session') + '</p><ul data-rv-profile-sessions="">';
    profile.sessions.forEach(function (s) {
      html += '<li data-rv-profile-session="">' + (s.when ? '<span data-rv-profile-when="">' + esc(s.when) + '</span>' : '') +
        '<span data-rv-profile-title="">' + esc(s.title) + '</span></li>';
    });
    html += '</ul>';
  }
  html += '</template>';
  parseDocument(html).children.slice().forEach(function (n) { domutils.appendChild(card, n); });
}

function fieldsOf(card) {
  return (has(card, 'data-rv-field') ? [card] : []).concat(findAll(card, function (e) { return has(e, 'data-rv-field'); }));
}
function fillClone(clone, item, kind, refill) {
  fieldsOf(clone).forEach(function (el) { setField(el, attr(el, 'data-rv-field'), item[attr(el, 'data-rv-field')], kind, refill); });
  if (kind === 'speakers') setProfile(clone, item.profile);
  if (kind === 'sessions') {
    clone.attribs['data-rv-day'] = item.dayKey || '';
    if (item.dayName) clone.attribs['data-rv-day-name'] = item.dayName; else delete clone.attribs['data-rv-day-name'];
    if (item.dayDate) clone.attribs['data-rv-day-date'] = item.dayDate; else delete clone.attribs['data-rv-day-date'];
  }
  clone.attribs['data-rv-filled'] = '';
  if (item.id) clone.attribs['data-rv-id'] = item.id; else delete clone.attribs['data-rv-id'];
}

/* what an item shows, to tell whether a list already shows these records (then it is not touched) */
function signature(card) {
  var parts = [attr(card, 'data-rv-id') || '', attr(card, 'data-rv-day') || '', attr(card, 'data-rv-day-name') || '', attr(card, 'data-rv-day-date') || ''];
  fieldsOf(card).forEach(function (f) {
    parts.push(attr(f, 'data-rv-field') + (has(f, 'hidden') ? '!' : '') + '=' + [attr(f, 'src') || '', attr(f, 'href') || '', backgroundUrl(f),
      domutils.textContent(f).replace(/\s+/g, ' ').trim()].join('|'));
  });
  parts.push(findAll(card, function (e) { return has(e, 'data-rv-empty-line'); }).length);
  var profile = findOne(card, function (e) { return e.name === 'template' && has(e, 'data-rv-profile'); });
  var li = profile && findOne(profile, function (e) { return has(e, 'data-rv-profile-li'); });
  parts.push(profile ? domutils.textContent(profile).replace(/\s+/g, ' ').trim() + '|' + (attr(li, 'href') || '') : '');
  return parts.join('\u0001');
}

/* ---------- where records go, and what goes when there are none ---------- */
var FORM_HOLDER = function (e) { return (e.name === 'a' && (has(e, 'data-rv-form') || has(e, 'data-register-cta'))) || has(e, 'data-rv-form-embed'); };
/* A section holding a form — one drawn in place, or a button that opens one — is not hidden as empty, as in the
   editor (holdsForm). A Register button holds it only when it is the page's only way to register: under an empty
   agenda it is one of many, and the section goes with its empty list. */
function holdsForm(doc, el) {
  return findAll(el, FORM_HOLDER).some(function (n) {
    if (!has(n, 'data-register-cta')) return true;
    return !findAll(doc, function (o) { return o.name === 'a' && has(o, 'data-register-cta') && !within(o, el) && !closest(o, function (p) { return has(p, 'data-rv-empty'); }); }).length;
  });
}
function emptyPlaceOf(listParent) {
  var sec = closest(listParent, function (n) { return has(n, 'data-rv-section'); });
  if (!sec) return listParent;
  return textLength(sec) - textLength(listParent) <= RR.EMPTY_PLACE_CHARS ? sec : listParent;
}
function inNavOrFooter(a) { return !!closest(a, function (n) { var s = attr(n, 'data-rv-section'); return s === 'nav' || s === 'footer'; }); }
function linksTo(doc, id) { return findAll(doc, function (e) { return e.name === 'a' && attr(e, 'href') === '#' + id; }); }

function marker(changedTags) {
  return {
    set: function (el, name, value) { if (attr(el, name) === value) return; el.attribs[name] = value; changedTags.push(el); },
    drop: function (el, name) { if (!has(el, name)) return; delete el.attribs[name]; changedTags.push(el); }
  };
}

function markEmpty(doc, kind, lists, mark) {
  /* a button that opens a form is never hidden with an empty section */
  findAll(doc, function (e) { return e.name === 'a' && (has(e, 'data-register-cta') || has(e, 'data-rv-form')) && has(e, 'data-rv-nav-empty'); })
    .forEach(function (a) { mark.drop(a, 'data-rv-nav-empty'); });
  lists.forEach(function (list) {
    var parent = list.parent, place = emptyPlaceOf(parent);
    if (place !== parent && holdsForm(doc, place)) place = parent;
    mark.set(place, 'data-rv-empty', kind);
    /* marked as a whole now: a mark the list itself had from an earlier rule is not needed */
    if (place !== parent && attr(parent, 'data-rv-empty') === kind) mark.drop(parent, 'data-rv-empty');
    var id = attr(place, 'id');
    if (place !== parent && id) {
      linksTo(doc, id).forEach(function (a) {
        if (!has(a, 'data-register-cta') && !has(a, 'data-rv-form') && inNavOrFooter(a)) mark.set(a, 'data-rv-nav-empty', '');
      });
    }
  });
}
function markFilled(doc, kind, mark) {
  findAll(doc, function (e) { return attr(e, 'data-rv-empty') === kind; }).forEach(function (place) {
    mark.drop(place, 'data-rv-empty');
    var id = attr(place, 'id');
    if (id) linksTo(doc, id).forEach(function (a) { mark.drop(a, 'data-rv-nav-empty'); });
  });
}
/* a section marked empty that holds a form (one may have been added since it was marked) keeps showing, and only
   its empty list is marked — the editor's keepFormSectionsShown */
function keepFormSectionsShown(doc, mark) {
  findAll(doc, function (e) { return e.name === 'a' && (has(e, 'data-rv-form') || has(e, 'data-register-cta')) && has(e, 'data-rv-nav-empty'); })
    .forEach(function (a) { mark.drop(a, 'data-rv-nav-empty'); });
  findAll(doc, function (e) { return has(e, 'data-rv-section') && has(e, 'data-rv-empty'); }).forEach(function (sec) {
    if (!holdsForm(doc, sec)) return;
    var kind = attr(sec, 'data-rv-empty');
    mark.drop(sec, 'data-rv-empty');
    findAll(sec, function (e) { return attr(e, 'data-rv-repeat-template') === kind; }).forEach(function (el) {
      if (isEl(el.parent) && el.parent !== sec) mark.set(el.parent, 'data-rv-empty', kind);
    });
    var id = attr(sec, 'id');
    if (id) linksTo(doc, id).forEach(function (a) { mark.drop(a, 'data-rv-nav-empty'); });
  });
}

/* the lists of each kind on the page: { kind: [ { parent, standing: [items] } ] }, in page order */
function listsOf(doc) {
  var out = {};
  findAll(doc, function (e) { return has(e, 'data-rv-repeat-template'); }).forEach(function (el) {
    var kind = attr(el, 'data-rv-repeat-template');
    if (RR.KINDS.indexOf(kind) === -1 || !isEl(el.parent) || inTemplate(el)) return;
    var lists = out[kind] || (out[kind] = []);
    var list = lists.filter(function (l) { return l.parent === el.parent; })[0];
    if (list) list.standing.push(el); else lists.push({ parent: el.parent, standing: [el] });
  });
  return out;
}
/* a kind the page shows somewhere, or whose section the owner took away on purpose (editor kindPlaced) */
function placedElsewhere(doc, kind) {
  return !!findOne(doc, function (e) { return attr(e, 'data-rv-auto') === kind || (e.name === 'template' && attr(e, 'data-rv-auto-off') === kind); });
}

/* the end of the start tag that opens at `from` (the offset of its "<"), quotes respected */
function startTagEnd(html, from) {
  var quote = '';
  for (var i = from + 1; i < html.length; i++) {
    var ch = html.charAt(i);
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}
function startTag(el) {
  return '<' + el.name + Object.keys(el.attribs).map(function (k) {
    var v = el.attribs[k];
    return ' ' + k + '="' + escAttr(v == null ? '' : v).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"';
  }).join('') + '>';
}

/* the items of the kinds whose records were read: [] for a kind with none; a kind whose records were not read is
   left out */
function itemsByKind(rows) {
  var out = {};
  RR.KINDS.forEach(function (kind) {
    var lists = RR.SOURCES[kind].map(function (r) { return rows ? rows[r] : undefined; });
    if (lists.some(function (l) { return !Array.isArray(l); })) return;
    out[kind] = lists[0].length ? (RR.translate[kind].apply(null, lists) || []) : [];
  });
  return out;
}

function renderRecords(html, rows) {
  html = String(html || '');
  var report = { html: html, changed: false, filled: [], emptied: [], unplaced: [] };
  /* names kept as written: a saved page is the browser's own serialisation (lower-case HTML, SVG's viewBox as is) */
  var doc = parseDocument(html, { withStartIndices: true, withEndIndices: true, lowerCaseTags: false, lowerCaseAttributeNames: false });
  var items = itemsByKind(rows), lists = listsOf(doc), edits = [], tags = [], mark = marker(tags);

  RR.KINDS.forEach(function (kind) {
    if (!(kind in items)) return;
    var mine = lists[kind] || [];
    if (!mine.length) {
      if (items[kind].length && !placedElsewhere(doc, kind)) report.unplaced.push(kind);
      return;
    }
    if (!items[kind].length) { markEmpty(doc, kind, mine, mark); report.emptied.push(kind); return; }
    markFilled(doc, kind, mark);
    report.filled.push(kind);
    mine.forEach(function (list) {
      var model = list.standing[0], refill = has(model, 'data-rv-filled');
      var clones = items[kind].map(function (item) {
        var clone = model.cloneNode(true);
        fillClone(clone, item, kind, refill);
        return clone;
      });
      var same = clones.length === list.standing.length && clones.every(function (c, i) { return signature(c) === signature(list.standing[i]); });
      if (same) return;
      /* the items go where the last of them stood; anything else between them stays, before them (as the
         editor's insertBefore(clone, last.nextSibling) leaves it) */
      var first = list.standing[0], last = list.standing[list.standing.length - 1], between = '';
      for (var n = first; n && n !== last.next; n = n.next) {
        if (list.standing.indexOf(n) === -1) between += html.slice(n.startIndex, n.endIndex + 1);
      }
      edits.push({ start: first.startIndex, end: last.endIndex + 1,
        text: between + clones.map(function (c) { return render(c, SERIALIZE); }).join('') });
    });
  });
  keepFormSectionsShown(doc, mark);

  tags.filter(function (el, i) { return tags.indexOf(el) === i; }).forEach(function (el) {
    var end = startTagEnd(html, el.startIndex);
    if (end === -1) return;
    /* never inside a list that is being drawn again (the items are drawn whole) */
    if (edits.some(function (e) { return el.startIndex >= e.start && el.startIndex < e.end; })) return;
    edits.push({ start: el.startIndex, end: end + 1, text: startTag(el) });
  });
  if (!edits.length) return report;
  edits.sort(function (a, b) { return b.start - a.start; });
  var out = html;
  edits.forEach(function (e) { out = out.slice(0, e.start) + e.text + out.slice(e.end); });
  report.html = out;
  report.changed = out !== html;
  return report;
}

module.exports = { renderRecords: renderRecords, itemsByKind: itemsByKind };
