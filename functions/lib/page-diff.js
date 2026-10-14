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
       An unchanged site gives [].

   A page is read as the editor saves it: sections are the elements carrying data-rv-section (their identity
   is data-rv-key, else data-rv-section; their name data-sec-name), the site-wide design is the inline style of
   <body> and the state kept on <style data-rv-design>. Records drawn into a section by the editor (speakers,
   partners…) are not the site's own words and are left out of a section's text, so adding a speaker in
   Content does not read as an edit of the page. No network, no Firebase: see page-diff.test.js. */

const { parseDocument } = require('htmlparser2');
const render = require('dom-serializer').default;
const domutils = require('domutils');

var MAX_LINES = 12;          // differing lines listed per section, each side
var MAX_CHARS = 280;         // of one line
var MAX_ITEMS = 60;

var BLOCK = /^(p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|ul|ol|dl|dt|dd|tr|td|th|table|figure|figcaption|blockquote|details|summary|form|button|a|br|hr)$/;

function attr(el, name) { return (el.attribs && el.attribs[name]) || ''; }
function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

/* the lines of text a visitor reads in a section, in order: one per block of text */
function linesOf(node) {
  var lines = [], cur = '';
  function flush() { var t = cur.replace(/\s+/g, ' ').trim(); if (t) lines.push(t.slice(0, MAX_CHARS)); cur = ''; }
  (function walk(n) {
    if (n.type === 'text') { cur += n.data || ''; return; }
    if (n.type !== 'tag') return;
    if (n.name === 'style' || n.name === 'script' || n.name === 'template') return;
    if (attr(n, 'data-rv-repeat-template') || attr(n, 'data-rv-item')) return;      // a record, not the page's words
    var block = BLOCK.test(n.name);
    if (block) flush();
    (n.children || []).forEach(walk);
    if (block) flush();
  })(node);
  return lines;
}

function picturesOf(node) {
  var out = [];
  domutils.findAll(function (e) { return e.name === 'img' && !attr(e, 'data-rv-field') && !!attr(e, 'src'); }, [node]).forEach(function (img) {
    out.push(attr(img, 'src'));
  });
  var style = render([node]).match(/background(?:-image)?\s*:[^;"']*url\(\s*["']?([^"')]+)/gi) || [];
  style.forEach(function (s) { var m = /url\(\s*["']?([^"')]+)/i.exec(s); if (m) out.push(m[1]); });
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
    .replace(/\s(?:data-editable|contenteditable|data-text-original|data-rv-cur-item|data-rv-open|data-rv-aria|data-ai-generated|data-ai-skipped|data-rv-filled)(?:="[^"]*")?/g, '')
    .replace(/\sclass="([^"]*)"/g, function (all, cls) {
      var kept = cls.split(/\s+/).filter(function (c) { return c && !/^(ed-selected|sec-active|rv-in|rv-shown|is-hidden-sec)$/.test(c); }).join(' ');
      return kept ? ' class="' + kept + '"' : '';
    })
    .replace(/>\s+</g, '><').replace(/\s+/g, ' ');
}

function readPage(html) {
  var doc = parseDocument(String(html || ''), { decodeEntities: true });
  var sections = [], seen = {};
  domutils.findAll(function (e) { return !!attr(e, 'data-rv-section'); }, doc.children).forEach(function (el) {
    // a section inside a section is part of it
    for (var p = el.parent; p; p = p.parent) if (p.attribs && p.attribs['data-rv-section']) return;
    var key = attr(el, 'data-rv-key') || attr(el, 'data-rv-section');
    if (seen[key]) key = key + '#' + sections.length;
    seen[key] = true;
    var next = el.next;
    while (next && next.type !== 'tag') next = next.next;
    var css = next && next.name === 'style' && attr(next, 'data-rv-style') ? domutils.textContent(next).replace(/\s+/g, ' ').trim() : '';
    sections.push({
      key: key,
      name: attr(el, 'data-sec-name') || attr(el, 'data-rv-section'),
      hidden: /(^|\s)is-hidden-sec(\s|$)/.test(attr(el, 'class')),
      lines: linesOf(el), pictures: picturesOf(el), shape: shapeOf(el), css: css
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
  return { sections: sections, design: design };
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
  return items.slice(0, MAX_ITEMS);
}

/* one line for a list: "3 sections edited, 1 added, design changed" */
function summarise(items) {
  var n = { text: 0, look: 0, pictures: 0, added: 0, removed: 0, moved: 0, hidden: 0, shown: 0, design: 0 };
  var edited = {};
  (items || []).forEach(function (i) {
    if (n[i.type] != null) n[i.type]++;
    if (i.type === 'text' || i.type === 'look' || i.type === 'pictures') edited[i.section] = 1;
  });
  var parts = [], e = Object.keys(edited).length;
  if (e) parts.push(e + (e === 1 ? ' section edited' : ' sections edited'));
  if (n.added) parts.push(n.added + ' added');
  if (n.removed) parts.push(n.removed + ' removed');
  if (n.moved) parts.push(n.moved + ' moved');
  if (n.hidden) parts.push(n.hidden + ' hidden');
  if (n.shown) parts.push(n.shown + ' shown again');
  if (n.design) parts.push('site design changed');
  return parts.join(', ') || 'no visible change';
}

/* readPage is also how lib/promo.js reads a saved site's design (the body's variables and the editor's state) */
module.exports = { diffPages, summarise, readPage };
