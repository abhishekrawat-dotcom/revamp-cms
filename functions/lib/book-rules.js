/* Books: what is design and what is content (the owner, 26 Nov 2026: a Designer does everything; a Content editor does
   everything except the design), and how two people's saves of one book are put together. ONE copy, used by the server
   (lib/api-books.js refuses a Content editor's design change) and by the editor (books-app/: it never makes one, and it
   merges a save that crossed another person's). Plain CommonJS with no dependencies, so the editor's bundle takes it too.

   DESIGN (Designer only): page setup, master pages, the design system (colours, fonts, styles), print settings and
   templates; a frame's position, size, rotation, opacity, layer, lock, visibility, grouping and name; text styles,
   shapes, photo effects (brightness, contrast, greyscale, sepia, corner radius), an infographic's colours and font;
   a page's role, master, background and size; adding or removing a frame on an existing page.
   CONTENT (everyone with Books): the book's name, subtitle, category, status, cover picture, chapters, manuscript and
   photo library; adding, deleting and reordering pages (a new page is made from the book's own layouts: every frame on
   it is a copy of a frame the book already has); a page's label and chapter; the text in a frame; the photo in a frame
   and where it sits in it (src, zoom, focal point, fit, caption); an infographic's data, labels, titles and chart type.
   Anything not named as content is design: a field added later is locked until it is named here.

     designChanges(before, after)         -> [sentence]  the design changes `after` makes to `before` ([] = content only)
     mergeBooks(base, mine, theirs)        -> { merged, conflicts: [conflict] }   a three-way merge: what only one side
                                              changed is taken from it; the same thing changed differently on both sides
                                              is a conflict { id, kind, pageId, elementId, field, label, mine, theirs },
                                              and `merged` holds theirs there until it is resolved
     resolveConflicts(merged, conflicts, choices)  -> book   choices: { [conflict.id]: 'mine' | 'theirs' }
     DESIGN_BOOK_KEYS, CONTENT_BOOK_KEYS, CONTENT_PAGE_KEYS, CONTENT_ELEMENT_KEYS, CONTENT_IMAGE_KEYS, CONTENT_INFOGRAPHIC_KEYS */
'use strict';

var CONTENT_BOOK_KEYS = ['id', 'name', 'subtitle', 'category', 'status', 'unit', 'coverThumbnail', 'chapters', 'contentSections', 'imageAssets', 'pages',
  'createdAt', 'updatedAt', 'ownerId'];
var DESIGN_BOOK_KEYS = ['dimensions', 'designSystem', 'masterPages', 'printSettings', 'customDimensionPresets', 'templateReport'];
var CONTENT_PAGE_KEYS = ['id', 'orderIndex', 'label', 'chapterId', 'elements'];
var CONTENT_ELEMENT_KEYS = ['id', 'text', 'contentSectionId', 'image', 'infographic'];
var CONTENT_IMAGE_KEYS = ['src', 'assetId', 'alt', 'fit', 'zoom', 'focalX', 'focalY', 'naturalWidth', 'naturalHeight', 'captionText', 'originalCrop'];
var CONTENT_INFOGRAPHIC_KEYS = ['templateId', 'variant', 'title', 'subtitle', 'categoryLabel', 'sourceNote', 'items', 'showLegend', 'showValues'];
/* ids that a copied frame is given anew: not part of what a frame looks like */
var COPY_IDS = ['id', 'groupId', 'masterElementId', 'overriddenFromMaster', 'zIndex'];

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
/* JSON with keys in order, undefined left out: two values are the same when this is */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(function (x) { return x === undefined ? 'null' : stable(x); }).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  return v === undefined ? 'null' : JSON.stringify(v);
}
function same(a, b) { return stable(a) === stable(b); }
function without(o, keys) { var out = {}; Object.keys(o || {}).forEach(function (k) { if (keys.indexOf(k) === -1) out[k] = o[k]; }); return out; }
function only(o, keys) { var out = {}; keys.forEach(function (k) { if (o && has(o, k)) out[k] = o[k]; }); return out; }

/* what a frame looks like: everything but its content (and, for a copy, the ids it is given anew) */
function elementDesign(el, forCopy) {
  var d = without(el, CONTENT_ELEMENT_KEYS.filter(function (k) { return k !== 'image' && k !== 'infographic'; }));
  if (forCopy) d = without(d, COPY_IDS);
  if (isObj(el.image)) d.image = without(el.image, CONTENT_IMAGE_KEYS); else delete d.image;
  if (isObj(el.infographic)) d.infographic = without(el.infographic, CONTENT_INFOGRAPHIC_KEYS); else delete d.infographic;
  return d;
}
function pageDesign(p) { return without(p, CONTENT_PAGE_KEYS); }
/* a value left empty and one switched off are the same setting (null, undefined, false) */
function settled(o) { var out = {}; Object.keys(o || {}).forEach(function (k) { var v = o[k]; if (v !== null && v !== undefined && v !== false) out[k] = v; }); return out; }
/* what a new page must share with a layout of the book: every page setting but its layout-type label (a page is added as
   an editorial page whatever its source) — background, size, master link and any setting not named as content */
function newPageLook(p) { return stable(settled(without(pageDesign(p), ['role']))); }
function frameName(el) { return '"' + String((el && (el.name || el.type)) || 'frame').slice(0, 60) + '"'; }
function pageName(p, i) { return p && p.label ? '"' + String(p.label).slice(0, 60) + '"' : 'page ' + (i + 1); }
var WHAT = { xMm: 'position', yMm: 'position', widthMm: 'size', heightMm: 'size', rotation: 'rotation', opacity: 'opacity', zIndex: 'layer order',
  locked: 'lock', hidden: 'visibility', groupId: 'grouping', name: 'name', textStyle: 'text style', shape: 'shape', type: 'kind', textRole: 'text role',
  masterElementId: 'master link', overriddenFromMaster: 'master link', image: 'photo effects', infographic: 'colours or font' };

/* before, after: books as the editor holds them -> the design changes as sentences ([] = content only) */
function designChanges(before, after) {
  var out = [];
  before = before || {}; after = after || {};
  DESIGN_BOOK_KEYS.forEach(function (k) {
    if (!same(before[k], after[k])) out.push({ dimensions: 'the page size', designSystem: 'the design system (colours, fonts, styles)', masterPages: 'the master pages',
      printSettings: 'the print settings', customDimensionPresets: 'the saved page sizes', templateReport: 'the approved template design' }[k] + ' changed');
  });
  Object.keys(after).forEach(function (k) {
    if (CONTENT_BOOK_KEYS.indexOf(k) === -1 && DESIGN_BOOK_KEYS.indexOf(k) === -1 && !same(before[k], after[k])) out.push('the book\'s ' + k + ' changed');
  });
  var oldPages = Array.isArray(before.pages) ? before.pages : [], newPages = Array.isArray(after.pages) ? after.pages : [];
  var oldById = {};
  oldPages.forEach(function (p) { if (p && p.id) oldById[p.id] = p; });
  /* the layouts a new page may be made from: the book's pages and master pages as they were */
  var layouts = null, frames = null;
  function sources() {
    if (layouts) return;
    layouts = {}; frames = {};
    oldPages.concat(Array.isArray(before.masterPages) ? before.masterPages : []).forEach(function (src) {
      if (!src) return;
      (src.elements || []).forEach(function (el) { frames[stable(elementDesign(el, true))] = 1; });
    });
    /* a copy of a page; or a page made from a master page (linked to it, or not) */
    oldPages.forEach(function (src) { if (src) layouts[newPageLook(src)] = 1; });
    (Array.isArray(before.masterPages) ? before.masterPages : []).forEach(function (m) {
      if (!m) return;
      layouts[stable(settled({ masterPageId: m.id, backgroundColor: m.backgroundColor }))] = 1;
      layouts[stable(settled({ backgroundColor: m.backgroundColor }))] = 1;
    });
  }
  newPages.forEach(function (p, i) {
    if (!p) return;
    var was = oldById[p.id];
    if (!was) {
      sources();
      if (!layouts[newPageLook(p)]) out.push('new ' + pageName(p, i) + ' has a background, size or master page the book\'s layouts do not have');
      (p.elements || []).forEach(function (el) {
        if (!frames[stable(elementDesign(el, true))]) out.push('new ' + pageName(p, i) + ' has a frame ' + frameName(el) + ' that is not one of the book\'s layouts');
      });
      return;
    }
    var pd0 = pageDesign(was), pd1 = pageDesign(p);
    Object.keys(Object.assign({}, pd0, pd1)).forEach(function (k) {
      if (!same(pd0[k], pd1[k])) out.push(pageName(p, i) + ': its ' + ({ role: 'layout type', masterPageId: 'master page', detachedFromMaster: 'master link', backgroundColor: 'background', dimensionsOverride: 'size' }[k] || k) + ' changed');
    });
    var oldEls = {}, newIds = {};
    (was.elements || []).forEach(function (el) { if (el && el.id) oldEls[el.id] = el; });
    (p.elements || []).forEach(function (el) {
      if (!el) return;
      newIds[el.id] = 1;
      var e0 = oldEls[el.id];
      if (!e0) { out.push(pageName(p, i) + ': a frame ' + frameName(el) + ' was added'); return; }
      var d0 = elementDesign(e0, false), d1 = elementDesign(el, false), changed = {};
      Object.keys(Object.assign({}, d0, d1)).forEach(function (k) { if (!same(d0[k], d1[k])) changed[WHAT[k] || k] = 1; });
      var what = Object.keys(changed);
      if (what.length) out.push(pageName(p, i) + ': frame ' + frameName(e0) + ' — its ' + what.join(', ') + ' changed');
    });
    Object.keys(oldEls).forEach(function (id) { if (!newIds[id]) out.push(pageName(p, i) + ': frame ' + frameName(oldEls[id]) + ' was removed'); });
  });
  return out;
}

/* ---------- merging two saves of one book ---------- */
function byId(list) { var m = {}; (Array.isArray(list) ? list : []).forEach(function (x) { if (x && x.id != null) m[x.id] = x; }); return m; }
function ids(list) { return (Array.isArray(list) ? list : []).filter(function (x) { return x && x.id != null; }).map(function (x) { return x.id; }); }

/* the order of a list both sides changed: theirs, with what only mine added put after the item it followed in mine, and
   what mine deleted taken out (unless theirs changed it); mine's order when only mine reordered */
function mergeOrder(baseIds, mineIds, theirIds, keepDeleted) {
  var inBase = {}, inMine = {}, inTheirs = {};
  baseIds.forEach(function (id) { inBase[id] = 1; }); mineIds.forEach(function (id) { inMine[id] = 1; }); theirIds.forEach(function (id) { inTheirs[id] = 1; });
  var baseKept = function (list) { return list.filter(function (id) { return inBase[id]; }).join('|'); };
  var mineReordered = baseKept(mineIds) !== baseIds.filter(function (id) { return inMine[id]; }).join('|');
  var theirsReordered = baseKept(theirIds) !== baseIds.filter(function (id) { return inTheirs[id]; }).join('|');
  /* which of base's items stay: both kept it; or one side deleted it and the other changed it (keepDeleted says so) */
  var stays = {};
  baseIds.forEach(function (id) {
    if (inMine[id] && inTheirs[id]) stays[id] = 1;
    else if (inMine[id] || inTheirs[id]) { if (keepDeleted(id, inMine[id] ? 'theirs' : 'mine')) stays[id] = 1; }
  });
  var order = (mineReordered && !theirsReordered ? mineIds : theirIds).filter(function (id) { return !inBase[id] || stays[id]; });
  var present = {}; order.forEach(function (id) { present[id] = 1; });
  /* what the chosen order lacks — either side's additions, and kept items the other side deleted — goes after the item
     it followed on its own side */
  [mineIds, theirIds].forEach(function (side) {
    side.forEach(function (id, i) {
      if (present[id] || (inBase[id] && !stays[id])) return;
      var after = null;
      for (var j = i - 1; j >= 0; j--) if (present[side[j]]) { after = side[j]; break; }
      order.splice(after === null ? 0 : order.indexOf(after) + 1, 0, id); present[id] = 1;
    });
  });
  return order;
}

function mergeValue(b, m, t) {
  if (same(m, t)) return { value: m };
  if (same(m, b)) return { value: t };
  if (same(t, b)) return { value: m };
  return { conflict: true, value: t };
}

function mergeBooks(base, mine, theirs) {
  base = base || {}; mine = mine || {}; theirs = theirs || {};
  var conflicts = [], merged = {};
  function conflict(c) { c.id = 'c' + (conflicts.length + 1); conflicts.push(c); }
  Object.keys(Object.assign({}, base, mine, theirs)).forEach(function (k) {
    if (k === 'pages' || k === 'contentSections' || k === 'imageAssets' || k === 'masterPages') return;
    /* the times the editor stamps on every change: the later one, never a question */
    if (k === 'updatedAt' || k === 'createdAt') {
      var times = [mine[k], theirs[k]].filter(Boolean).sort();
      if (times.length) merged[k] = k === 'updatedAt' ? times[times.length - 1] : (theirs[k] || mine[k]);
      return;
    }
    var r = mergeValue(base[k], mine[k], theirs[k]);
    if (r.conflict) conflict({ kind: 'book', field: k, label: 'The book\'s ' + k, mine: mine[k], theirs: theirs[k] });
    if (r.value !== undefined) merged[k] = r.value;
  });
  /* lists of things with ids (the manuscript, the photo library, the master pages): item by item */
  ['contentSections', 'imageAssets', 'masterPages'].forEach(function (k) {
    var B = byId(base[k]), M = byId(mine[k]), T = byId(theirs[k]);
    var order = mergeOrder(ids(base[k]), ids(mine[k]), ids(theirs[k]), function (id, deletedBy) {
      var other = deletedBy === 'mine' ? T[id] : M[id];
      return other && !same(other, B[id]);
    });
    merged[k] = order.map(function (id) {
      if (!M[id]) return T[id];
      if (!T[id]) return M[id];
      var r = mergeValue(B[id], M[id], T[id]);
      if (r.conflict) conflict({ kind: k, itemId: id, field: k, label: (k === 'contentSections' ? 'Manuscript section ' : k === 'imageAssets' ? 'Photo ' : 'Master page ') + '"' + String((M[id].title || M[id].name || id)).slice(0, 60) + '"', mine: M[id], theirs: T[id] });
      return r.value;
    }).filter(Boolean);
  });
  /* pages: their order and set, then each page's own fields and frames */
  var BP = byId(base.pages), MP = byId(mine.pages), TP = byId(theirs.pages);
  var pageOrder = mergeOrder(ids(base.pages), ids(mine.pages), ids(theirs.pages), function (id, deletedBy) {
    var other = deletedBy === 'mine' ? TP[id] : MP[id];
    return other && !same(other, BP[id]);
  });
  merged.pages = pageOrder.map(function (pid, idx) {
    var b = BP[pid], m = MP[pid], t = TP[pid];
    if (!m) return t;
    if (!t) return m;
    if (!b) return t;   // added on both sides with one id: theirs
    var page = {};
    Object.keys(Object.assign({}, b, m, t)).forEach(function (k) {
      if (k === 'elements' || k === 'orderIndex') return;
      var r = mergeValue(b[k], m[k], t[k]);
      if (r.conflict) conflict({ kind: 'page', pageId: pid, field: k, label: pageName(m, idx) + ' — its ' + k, mine: m[k], theirs: t[k] });
      if (r.value !== undefined) page[k] = r.value;
    });
    var BE = byId(b.elements), ME = byId(m.elements), TE = byId(t.elements);
    var elOrder = mergeOrder(ids(b.elements), ids(m.elements), ids(t.elements), function (id, deletedBy) {
      var other = deletedBy === 'mine' ? TE[id] : ME[id];
      return other && !same(other, BE[id]);
    });
    page.elements = elOrder.map(function (eid) {
      var be = BE[eid], me = ME[eid], te = TE[eid];
      if (!me) return te;
      if (!te) return me;
      if (!be) return te;
      var el = {};
      Object.keys(Object.assign({}, be, me, te)).forEach(function (k) {
        var r = mergeValue(be[k], me[k], te[k]);
        if (r.conflict) conflict({ kind: 'frame', pageId: pid, elementId: eid, field: k,
          label: pageName(m, idx) + ', frame ' + frameName(me) + (k === 'text' ? '' : ' — its ' + (WHAT[k] || k)), mine: me[k], theirs: te[k] });
        if (r.value !== undefined) el[k] = r.value;
      });
      return el;
    }).filter(Boolean);
    return page;
  }).filter(Boolean);
  merged.pages.forEach(function (p, i) { p.orderIndex = i; });
  return { merged: merged, conflicts: conflicts };
}

/* merged + the person's choice for each conflict ('mine' | 'theirs'; theirs is already in merged) -> the book to save */
function resolveConflicts(merged, conflicts, choices) {
  var book = JSON.parse(JSON.stringify(merged));
  (conflicts || []).forEach(function (c) {
    if ((choices || {})[c.id] !== 'mine') return;
    if (c.kind === 'book') { book[c.field] = c.mine; return; }
    if (c.kind === 'contentSections' || c.kind === 'imageAssets' || c.kind === 'masterPages') {
      book[c.kind] = (book[c.kind] || []).map(function (x) { return x && x.id === c.itemId ? c.mine : x; }); return;
    }
    var page = (book.pages || []).filter(function (p) { return p && p.id === c.pageId; })[0];
    if (!page) return;
    if (c.kind === 'page') { page[c.field] = c.mine; return; }
    var el = (page.elements || []).filter(function (e) { return e && e.id === c.elementId; })[0];
    if (el) el[c.field] = c.mine;
  });
  return book;
}

module.exports = { designChanges: designChanges, mergeBooks: mergeBooks, resolveConflicts: resolveConflicts, same: same,
  DESIGN_BOOK_KEYS: DESIGN_BOOK_KEYS, CONTENT_BOOK_KEYS: CONTENT_BOOK_KEYS, CONTENT_PAGE_KEYS: CONTENT_PAGE_KEYS,
  CONTENT_ELEMENT_KEYS: CONTENT_ELEMENT_KEYS, CONTENT_IMAGE_KEYS: CONTENT_IMAGE_KEYS, CONTENT_INFOGRAPHIC_KEYS: CONTENT_INFOGRAPHIC_KEYS };
