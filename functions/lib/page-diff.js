/* What changed between two saved versions of a site, in words a reviewer can read.

     diffPages(beforeHtml, afterHtml) -> [ item ]
       item: { section, name, type, before, after, note }
         type "added" | "removed"      a section that is new, or gone            (after | before: its text)
              "text"                   wording changed in a section               (before / after: the lines that differ)
              "look"                   same words, different markup or styling    (note says what kind)
              "pictures"               the section's pictures changed             (before / after: file names)
              "moved"                  the section stands somewhere else          (before / after: "3rd of 9")
              "hidden" | "shown"       the section was hidden from, or put back on, the site
              "design"                 a site-wide setting changed                (before / after: "name: value" lines)
              "record-added" | "record-removed"   one of the event's records (Content) now shown, or gone
                                       (after | before: what names it — the question, the speaker's name…)
              "record-changed"         a record shown both times, with different words or pictures
                                       (before / after: the lines that differ)
              "record-order"           the same records in another order (name: "Speakers", note says so)
       A record's item also has kind (speakers, sessions, partners, glimpses, faq, contact) and name, the word
       for one of them ("FAQ", "Speaker"). An unchanged site gives [].

   A page is read as the editor saves it: sections are the elements carrying data-rv-section (their identity
   is data-rv-key, else data-rv-section; their name data-sec-name), the site-wide design is the inline style of
   <body> and the state kept on <style data-rv-design>. Records drawn into a section (speakers, partners… — an item of
   a data-rv-repeat-template list, or a data-rv-item card) are not the site's own words: they are left out of a
   section's text, pictures and layout, so adding a speaker in Content does not read as an edit of the page, and
   are compared on their own, record by record (by data-rv-id; by what names them on a page saved before records
   carried their id), so the approver sees each one that was added, changed or removed. A record counts while it
   is shown: an item of a list whose place is marked empty (data-rv-empty) is not on the live page. The marks
   that show or hide a place for having records (data-rv-empty, data-rv-nav-empty…) are not a change of layout.
   No network, no Firebase: see page-diff.test.js. */

const { parseDocument } = require('htmlparser2');
const render = require('dom-serializer').default;
const domutils = require('domutils');
const RR = require('../../templates/_shared/rv-records.js');

var MAX_LINES = 12;          // differing lines listed per section, each side
var MAX_CHARS = 280;         // of one line
var MAX_ITEMS = 60;

var BLOCK = /^(p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|ul|ol|dl|dt|dd|tr|td|th|table|figure|figcaption|blockquote|details|summary|form|button|a|br|hr)$/;

function attr(el, name) { return (el.attribs && el.attribs[name]) || ''; }
function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

/* a record drawn into a list, or the model or a card of such a list (not the page's own words either way) */
function isItem(n) { return !!(attr(n, 'data-rv-repeat-template') || (n.attribs && 'data-rv-item' in n.attribs)); }
function insideItem(n) { for (var p = n.parent; p; p = p.parent) if (p.attribs && isItem(p)) return true; return false; }

/* the lines of text a visitor reads in a section, in order: one per block of text; of a record itself with
   opts.record (its own lines are then what is read) */
function linesOf(node, opts) {
  var own = !!(opts && opts.record);
  var lines = [], cur = '';
  function flush() { var t = cur.replace(/\s+/g, ' ').trim(); if (t) lines.push(t.slice(0, MAX_CHARS)); cur = ''; }
  (function walk(n) {
    if (n.type === 'text') { cur += n.data || ''; return; }
    if (n.type !== 'tag') return;
    if (n.name === 'style' || n.name === 'script' || n.name === 'template') return;
    if (isItem(n) && !(own && n === node)) return;      // a record, not the page's words
    var block = BLOCK.test(n.name);
    if (block) flush();
    (n.children || []).forEach(walk);
    if (block) flush();
  })(node);
  return lines;
}

/* the pictures of a section (records' pictures are the records'), or of one record (opts.record) */
function picturesOf(node, opts) {
  var out = [], record = !!(opts && opts.record);
  function counts(e) { return record || (!isItem(e) && !insideItem(e)); }
  domutils.findAll(function (e) { return e.name === 'img' && (record || !attr(e, 'data-rv-field')) && !!attr(e, 'src') && counts(e); }, [node]).forEach(function (img) {
    out.push(attr(img, 'src'));
  });
  domutils.findAll(function (e) { return /url\(/i.test(attr(e, 'style')) && counts(e); }, [node]).forEach(function (e) {
    var m = /background(?:-image)?\s*:[^;]*url\(\s*["']?([^"')]+)/i.exec(attr(e, 'style'));
    if (m) out.push(m[1]);
  });
  return out;
}
function fileName(url) {
  if (/^data:/i.test(url)) return 'an uploaded picture';
  var clean = String(url).split('?')[0].split('#')[0];
  return decodeURIComponent(clean.slice(clean.lastIndexOf('/') + 1)).slice(0, 60) || clean.slice(0, 60);
}

/* markup with everything that differs from save to save without being a change taken out */
function shapeOf(node) {
  return render([node])
    .replace(/\s(?:data-editable|contenteditable|data-text-original|data-rv-cur-item|data-rv-open|data-rv-aria|data-ai-generated|data-ai-skipped|data-rv-filled|data-rv-empty|data-rv-empty-display|data-rv-nav-empty|data-rv-bound)(?:="[^"]*")?/g, '')
    .replace(/\sclass="([^"]*)"/g, function (all, cls) {
      var kept = cls.split(/\s+/).filter(function (c) { return c && !/^(ed-selected|sec-active|rv-in|rv-shown|is-hidden-sec)$/.test(c); }).join(' ');
      return kept ? ' class="' + kept + '"' : '';
    })
    .replace(/>\s+</g, '><').replace(/\s+/g, ' ');
}

/* What names a record: the field that does on an AI-designed list item (a speaker's name, a question, a session's
   title…), else its first line, else its picture's file name */
var NAME_FIELD = { speakers: ['n'], faq: ['t'], partners: ['name'], contact: ['name', 'label'], glimpses: ['caption'], sessions: ['title'] };
function recordOf(el, sectionKey) {
  var kind = attr(el, 'data-rv-repeat-template') || attr(el, 'data-rv-item');
  var label = '';
  (NAME_FIELD[kind] || []).some(function (field) {
    var f = attr(el, 'data-rv-field') === field ? el : domutils.findOne(function (e) { return attr(e, 'data-rv-field') === field && !('hidden' in e.attribs); }, el.children, true);
    label = f ? domutils.textContent(f).replace(/\s+/g, ' ').trim() : '';
    return !!label;
  });
  var lines = linesOf(el, { record: true }), pictures = picturesOf(el, { record: true });
  var links = domutils.findAll(function (e) { return e.name === 'a' && !!attr(e, 'href'); }, [el]).map(function (a) { return attr(a, 'href'); });
  if (!label) label = lines[0] || (pictures[0] ? fileName(pictures[0]) : '');
  return { kind: kind, id: attr(el, 'data-rv-id'), label: label.slice(0, MAX_CHARS), lines: lines, pictures: pictures, links: links, section: sectionKey };
}
/* the records shown on a page: an item a list drew from a record (data-rv-filled), or a card that carries its
   record's id — never the design's own sample item, never one in a place marked empty */
function recordsIn(node, sectionKey) {
  var out = [];
  domutils.findAll(function (e) {
    var kind = attr(e, 'data-rv-repeat-template') || attr(e, 'data-rv-item');
    if (RR.KINDS.indexOf(kind) === -1) return false;
    if (attr(e, 'data-rv-repeat-template') ? !('data-rv-filled' in e.attribs) : !attr(e, 'data-rv-id')) return false;
    for (var p = e.parent; p; p = p.parent) {
      if (p.name === 'template' || (p.attribs && 'data-rv-empty' in p.attribs)) return false;
      if (p.attribs && isItem(p) && attr(p, 'data-rv-id')) return false;           // inside another record
    }
    return !('data-rv-empty' in e.attribs);
  }, [node]).forEach(function (e) { out.push(recordOf(e, sectionKey)); });
  return out;
}

function readPage(html) {
  var doc = parseDocument(String(html || ''), { decodeEntities: true });
  var sections = [], seen = {}, records = [];
  domutils.findAll(function (e) { return !!attr(e, 'data-rv-section'); }, doc.children).forEach(function (el) {
    // a section inside a section is part of it
    for (var p = el.parent; p; p = p.parent) if (p.attribs && p.attribs['data-rv-section']) return;
    var key = attr(el, 'data-rv-key') || attr(el, 'data-rv-section');
    if (seen[key]) key = key + '#' + sections.length;
    seen[key] = true;
    var next = el.next;
    while (next && next.type !== 'tag') next = next.next;
    var css = next && next.name === 'style' && attr(next, 'data-rv-style') ? domutils.textContent(next).replace(/\s+/g, ' ').trim() : '';
    records = records.concat(recordsIn(el, key));
    var lines = linesOf(el), pictures = picturesOf(el);
    /* the layout without the records' items (the model or the cards drawn from records): a list that gained or
       lost a record has the same layout */
    domutils.findAll(function (e) { return isItem(e) && !insideItem(e); }, [el]).forEach(function (item) { domutils.removeElement(item); });
    sections.push({
      key: key,
      name: attr(el, 'data-sec-name') || attr(el, 'data-rv-section'),
      hidden: /(^|\s)is-hidden-sec(\s|$)/.test(attr(el, 'class')),
      lines: lines, pictures: pictures, shape: shapeOf(el), css: css
    });
  });
  var design = {};
  var body = domutils.findOne(function (e) { return e.name === 'body'; }, doc.children, true);
  String(attr(body || {}, 'style')).split(';').forEach(function (decl) {
    var at = decl.indexOf(':');
    if (at < 1) return;
    design[decl.slice(0, at).trim()] = decl.slice(at + 1).trim();
  });
  var state = domutils.findOne(function (e) { return e.name === 'style' && e.attribs && 'data-rv-design' in e.attribs; }, doc.children, true);
  if (state) {
    try {
      var rules = JSON.parse(attr(state, 'data-rv-state') || '{}');
      Object.keys(rules).forEach(function (k) { design[k] = String(rules[k]); });
    } catch (e) { /* no readable state: the inline styles still tell */ }
  }
  return { sections: sections, design: design, records: records };
}

var DESIGN_NAMES = {
  '--theme-color': 'Theme colour', '--accent-color': 'Accent colour', '--rv-bg': 'Page background', '--rv-text': 'Text colour',
  '--rv-surface': 'Card background', '--rv-muted': 'Secondary text colour', '--heading-font-family': 'Heading font',
  '--body-font-family': 'Body font', 'background-color': 'Page background', 'color': 'Text colour', 'font-size': 'Text size',
  'font-weight': 'Text weight', bodySize: 'Text size', bodyWeight: 'Text weight', sectionSpacing: 'Section spacing',
  headingFont: 'Heading font', headingSize: 'Heading size', headingWeight: 'Heading weight', headingColor: 'Heading colour',
  headingCase: 'Heading case', headingAlign: 'Heading alignment', radius: 'Corner rounding', divider: 'Section divider',
  animation: 'Section animation', motion: 'Motion', reveals: 'Scroll effects', bgImage: 'Page background picture', bgOpacity: 'Background strength'
};
var DESIGN_SKIP = /^(--default-color|--body-color|--bg-color|--para-font-size|--primary-font-size|--bg-spacing|line-height|font-family|--theme-color-hex)$/;

/* the lines of `a` that are not in `b`, in a's order (a line that occurs twice in a and once in b counts once) */
function onlyIn(a, b) {
  var left = {};
  b.forEach(function (l) { left[l] = (left[l] || 0) + 1; });
  return a.filter(function (l) { if (left[l]) { left[l]--; return false; } return true; });
}

function diffPages(beforeHtml, afterHtml) {
  var A = readPage(beforeHtml), B = readPage(afterHtml), items = [];
  var a = {}, b = {};
  A.sections.forEach(function (s, i) { a[s.key] = s; s.at = i; });
  B.sections.forEach(function (s, i) { b[s.key] = s; s.at = i; });

  /* ---- site-wide design ---- */
  var was = [], now = [];
  Object.keys(Object.assign({}, A.design, B.design)).forEach(function (k) {
    if (DESIGN_SKIP.test(k) || (A.design[k] || '') === (B.design[k] || '')) return;
    var label = DESIGN_NAMES[k] || k;
    if (was.some(function (l) { return l.indexOf(label + ':') === 0; })) return;       // the same setting, kept in two places
    was.push(label + ': ' + (A.design[k] || 'the design’s own'));
    now.push(label + ': ' + (B.design[k] || 'the design’s own'));
  });
  if (was.length) items.push({ section: '', name: 'Site design', type: 'design', before: was.join('\n'), after: now.join('\n'), note: '' });

  /* ---- sections ---- */
  B.sections.forEach(function (s) {
    var old = a[s.key];
    if (!old) {
      items.push({ section: s.key, name: s.name, type: 'added', before: '', after: s.lines.slice(0, MAX_LINES).join('\n'), note: ordinal(s.at + 1) + ' on the page' });
      return;
    }
    if (old.hidden !== s.hidden) items.push({ section: s.key, name: s.name, type: s.hidden ? 'hidden' : 'shown', before: '', after: '', note: '' });
    var gone = onlyIn(old.lines, s.lines), come = onlyIn(s.lines, old.lines);
    if (gone.length || come.length) {
      items.push({ section: s.key, name: s.name, type: 'text',
        before: gone.slice(0, MAX_LINES).join('\n') + (gone.length > MAX_LINES ? '\n… and ' + (gone.length - MAX_LINES) + ' more' : ''),
        after: come.slice(0, MAX_LINES).join('\n') + (come.length > MAX_LINES ? '\n… and ' + (come.length - MAX_LINES) + ' more' : ''), note: '' });
    }
    var picsWas = onlyIn(old.pictures, s.pictures), picsNow = onlyIn(s.pictures, old.pictures);
    if (picsWas.length || picsNow.length) {
      items.push({ section: s.key, name: s.name, type: 'pictures', before: picsWas.map(fileName).join('\n'), after: picsNow.map(fileName).join('\n'), note: '' });
    }
    if (!gone.length && !come.length && !picsWas.length && !picsNow.length && (old.shape !== s.shape || old.css !== s.css)) {
      items.push({ section: s.key, name: s.name, type: 'look', before: '', after: '',
        note: old.shape !== s.shape && old.css !== s.css ? 'layout and styling changed' : old.css !== s.css ? 'styling (CSS) changed' : 'layout or formatting changed' });
    }
  });
  A.sections.forEach(function (s) {
    if (!b[s.key]) items.push({ section: s.key, name: s.name, type: 'removed', before: s.lines.slice(0, MAX_LINES).join('\n'), after: '', note: '' });
  });

  /* ---- order: among the sections both versions have ---- */
  var orderA = A.sections.filter(function (s) { return b[s.key]; }).map(function (s) { return s.key; });
  var orderB = B.sections.filter(function (s) { return a[s.key]; }).map(function (s) { return s.key; });
  if (orderA.join('|') !== orderB.join('|')) {
    /* the sections that kept their order among themselves stayed; the others are the ones that were moved */
    var n = orderA.length, m = orderB.length, t = [], i, j;
    for (i = 0; i <= n; i++) { t.push([]); for (j = 0; j <= m; j++) t[i].push(0); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) t[i][j] = orderA[i] === orderB[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    var stayed = {};
    for (i = 0, j = 0; i < n && j < m;) {
      if (orderA[i] === orderB[j]) { stayed[orderA[i]] = true; i++; j++; }
      else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++;
    }
    orderB.forEach(function (key) {
      if (stayed[key]) return;
      items.push({ section: key, name: b[key].name, type: 'moved', before: ordinal(a[key].at + 1) + ' of ' + A.sections.length, after: ordinal(b[key].at + 1) + ' of ' + B.sections.length, note: '' });
    });
  }
  return items.concat(diffRecords(A.records, B.records)).slice(0, MAX_ITEMS);
}

function noun(kind, n) { var t = RR.TABS[kind]; return t ? (n === 1 ? t.one : t.many) : 'record' + (n === 1 ? '' : 's'); }
function capital(w) { return w.charAt(0).toUpperCase() + w.slice(1); }
/* what a record shows, to tell whether it changed */
function shown(r) { return r.lines.join('\n') + '\u0001' + r.pictures.map(fileName).join('\n') + '\u0001' + r.links.join('\n'); }

/* One record shown in more than one place is one record: a site with pages lists its FAQs, speakers or partners on
   the home page and again on a page of their own, and one FAQ added in Content is "1 FAQ added", not one per page
   that shows it (B05 verify). Places are the same record when they carry the same id, or — on a page saved before
   records carried their id — the same name in another section. What it shows is what all its places show. */
function oneEach(records) {
  var out = [], byId = {};
  records.forEach(function (r) {
    var same = (r.id && byId[r.id]) || out.filter(function (o) {
      return (!o.id || !r.id) && !!r.label && o.label === r.label && o.sections.indexOf(r.section) === -1;
    })[0];
    if (!same) {
      same = Object.assign({}, r, { sections: [r.section] });
      out.push(same);
      if (r.id) byId[r.id] = same;
      return;
    }
    if (r.id && !same.id) { same.id = r.id; byId[r.id] = same; }
    same.sections.push(r.section);
    same.lines = same.lines.concat(onlyIn(r.lines, same.lines));
    same.pictures = same.pictures.concat(onlyIn(r.pictures, same.pictures));
    same.links = same.links.concat(onlyIn(r.links, same.links));
  });
  return out;
}

/* Each kind of record on its own: a record on both pages is the same record when it has the same id, or — on a
   page saved before records carried their id — when it is named the same. The rest were added or removed. */
function diffRecords(before, after) {
  var items = [];
  RR.KINDS.forEach(function (kind) {
    var a = oneEach(before.filter(function (r) { return r.kind === kind; })), b = oneEach(after.filter(function (r) { return r.kind === kind; }));
    if (!a.length && !b.length) return;
    var pairs = [], leftA = a.slice(), leftB = b.slice();
    function pair(match) {
      leftB.slice().forEach(function (rb) {
        var ra = leftA.filter(function (x) { return match(x, rb); })[0];
        if (!ra) return;
        pairs.push([ra, rb]);
        leftA.splice(leftA.indexOf(ra), 1); leftB.splice(leftB.indexOf(rb), 1);
      });
    }
    pair(function (x, y) { return !!x.id && x.id === y.id; });
    pair(function (x, y) { return !!x.label && x.label === y.label && (!x.id || !y.id); });
    var one = capital(noun(kind, 1));
    leftB.forEach(function (r) { items.push({ section: r.section, name: one, kind: kind, type: 'record-added', before: '', after: r.label, note: '' }); });
    pairs.forEach(function (p) {
      if (shown(p[0]) === shown(p[1])) return;
      var gone = onlyIn(p[0].lines, p[1].lines), come = onlyIn(p[1].lines, p[0].lines);
      var picsWas = onlyIn(p[0].pictures, p[1].pictures).map(fileName), picsNow = onlyIn(p[1].pictures, p[0].pictures).map(fileName);
      var linksWas = onlyIn(p[0].links, p[1].links), linksNow = onlyIn(p[1].links, p[0].links);
      items.push({ section: p[1].section, name: one, kind: kind, type: 'record-changed',
        before: gone.concat(picsWas, linksWas).slice(0, MAX_LINES).join('\n'), after: come.concat(picsNow, linksNow).slice(0, MAX_LINES).join('\n'),
        note: p[1].label && gone.indexOf(p[1].label) === -1 && come.indexOf(p[1].label) === -1 ? p[1].label : '' });
    });
    leftA.forEach(function (r) { items.push({ section: r.section, name: one, kind: kind, type: 'record-removed', before: r.label, after: '', note: '' }); });
    /* the records both pages show, in another order */
    var orderA = a.filter(function (r) { return pairs.some(function (p) { return p[0] === r; }); });
    var orderB = b.filter(function (r) { return pairs.some(function (p) { return p[1] === r; }); });
    if (orderB.some(function (r, i) { var p = pairs.filter(function (q) { return q[1] === r; })[0]; return orderA[i] !== p[0]; })) {
      items.push({ section: orderB[0].section, name: capital(noun(kind, 2)), kind: kind, type: 'record-order', before: '', after: '', note: 'shown in a new order' });
    }
  });
  return items;
}

/* one line for a list: "3 sections edited, 1 added, design changed", then what Content changed:
   "Content: 1 FAQ added, 2 speakers changed" (alone) or "…, content: 1 FAQ added" (after the rest) */
function summarise(items) {
  var n = { text: 0, look: 0, pictures: 0, added: 0, removed: 0, moved: 0, hidden: 0, shown: 0, design: 0 };
  var edited = {}, records = {};
  (items || []).forEach(function (i) {
    if (n[i.type] != null) n[i.type]++;
    if (i.type === 'text' || i.type === 'look' || i.type === 'pictures') edited[i.section] = 1;
    if (/^record-/.test(i.type)) { var k = (records[i.kind] = records[i.kind] || {}); k[i.type] = (k[i.type] || 0) + 1; }
  });
  var parts = [], e = Object.keys(edited).length;
  if (e) parts.push(e + (e === 1 ? ' section edited' : ' sections edited'));
  if (n.added) parts.push(n.added + ' added');
  if (n.removed) parts.push(n.removed + ' removed');
  if (n.moved) parts.push(n.moved + ' moved');
  if (n.hidden) parts.push(n.hidden + ' hidden');
  if (n.shown) parts.push(n.shown + ' shown again');
  if (n.design) parts.push('site design changed');
  var content = [];
  RR.KINDS.forEach(function (kind) {
    var k = records[kind];
    if (!k) return;
    [['record-added', 'added'], ['record-changed', 'changed'], ['record-removed', 'removed']].forEach(function (w) {
      if (k[w[0]]) content.push(k[w[0]] + ' ' + noun(kind, k[w[0]]) + ' ' + w[1]);
    });
    if (k['record-order']) content.push(noun(kind, 2) + ' reordered');
  });
  if (content.length) parts.push((parts.length ? 'content: ' : 'Content: ') + content.join(', '));
  return parts.join(', ') || 'no visible change';
}

/* readPage is also how lib/promo.js reads a saved site's design (the body's variables and the editor's state) */
module.exports = { diffPages, summarise, readPage };
