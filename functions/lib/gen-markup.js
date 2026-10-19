/* Deterministic work on markup the model wrote, done by the server so that it does not depend on the
   model having followed an instruction.

     scopeSectionCss(css, sectionId, rootInfo)  ->  the section's stylesheet, confined to that section
     sectionRootInfo(html)                      ->  { tag, id, classes } of the section's root element, or null
     rootIsStyled(scopedCss, sectionId, rootInfo) -> true when at least one rule applies to the root itself

   WHY SCOPING IS DONE HERE. The page loader marks a section by putting data-rv-section="<id>" on the
   section's own root element. A rule the model writes as  [data-rv-section="hero"] .hero { … }  is a
   descendant selector: it can never match that root, so the root keeps no background, padding or
   positioning and anything absolutely positioned inside it escapes over the rest of the page. So every
   rule is rewritten to apply in both places it can be meant for:
       S sel          a descendant of the section        ( S = [data-rv-section="<id>"] )
       S<compound> …  the section's root itself, when the selector's first part could be the root
   and nothing in the sheet can reach outside the section: html / body / :root become the section root,
   and @keyframes and @font-face names carry the section id so two sections cannot overwrite each other's.
   One rule is added in front that makes every root the containing block for what is inside it.

   The function is idempotent — scoping an already scoped sheet gives the same sheet — so it is applied
   both when a section is stored and when a stored section is read. */

const postcss = require('postcss');
const selectorParser = require('postcss-selector-parser');
const valueParser = require('postcss-value-parser');
const { parseDocument } = require('htmlparser2');

function scopeOf(sectionId) { return '[data-rv-section="' + String(sectionId).replace(/[^A-Za-z0-9_-]/g, '') + '"]'; }

/* The containing-block rule. The navigation keeps its own stacking level above the sections that follow
   it (they are all positioned by this same rule and would otherwise paint over a fixed or sticky bar),
   and is not clipped, because menus open outside its box. */
function containmentRule(sectionId) {
  var S = scopeOf(sectionId);
  return sectionId === 'nav'
    ? S + '{position:relative;z-index:50;isolation:isolate}'
    : S + '{position:relative;isolation:isolate;overflow-x:clip}';
}

function sectionRootInfo(html) {
  var doc;
  try { doc = parseDocument(String(html == null ? '' : html)); } catch (e) { return null; }
  var root = (doc.children || []).filter(function (n) { return n.type === 'tag'; })[0];
  if (!root) return null;
  return {
    tag: String(root.name || '').toLowerCase(),
    id: String((root.attribs && root.attribs.id) || ''),
    classes: String((root.attribs && root.attribs.class) || '').split(/\s+/).filter(Boolean)
  };
}

function isScopeAttribute(node) { return node.type === 'attribute' && String(node.attribute).toLowerCase() === 'data-rv-section'; }
function isPageRoot(node) {
  return (node.type === 'tag' && /^(html|body)$/i.test(node.value)) || (node.type === 'pseudo' && /^:root$/i.test(node.value));
}

/* A selector as its compounds: [ { combinator: '' | ' ' | '>' | '+' | '~', nodes: [...] }, … ] */
function compoundsOf(selector) {
  var list = [], current = { combinator: '', nodes: [] };
  selector.each(function (node) {
    if (node.type === 'combinator') {
      list.push(current);
      current = { combinator: node.value.trim() || ' ', nodes: [] };
    } else if (node.type !== 'comment') {
      current.nodes.push(node);
    }
  });
  list.push(current);
  return list;
}

function compoundText(nodes) { return nodes.map(function (n) { return String(n).trim(); }).join(''); }

function tailText(compounds) {
  return compounds.map(function (c) {
    var text = compoundText(c.nodes);
    return c.combinator === ' ' ? ' ' + text : ' ' + c.combinator + ' ' + text;
  }).join('');
}

/* Could this compound be the section's root element? Without rootInfo: yes. With it: only when the tag and
   classes it names are the root's own (an id always may be: the page loader gives a root the section's id). */
function couldBeRoot(nodes, rootInfo) {
  if (!rootInfo) return true;
  return nodes.every(function (n) {
    if (n.type === 'tag') return n.value.toLowerCase() === rootInfo.tag;
    if (n.type === 'class') return rootInfo.classes.indexOf(n.value) !== -1;
    return true;
  });
}

/* One selector -> the scoped selectors that replace it.
     .x                  S .x  and  S.x     (a descendant, or the root itself)
     S .x  (the model's)  the same two       (what it wrote could not match the root)
     S.x, section S      itself             (it names the root already)
     body, html, :root   S                  (the page is not the section's to style) */
function scopeSelector(selector, S, rootInfo) {
  var compounds = compoundsOf(selector);
  var namesRoot = false;

  while (compounds.length) {
    var first = compounds[0];
    var own = first.nodes.filter(function (n) { return !isScopeAttribute(n); });
    if (first.nodes.some(isPageRoot)) own = [];
    else if (own.length === first.nodes.length) break;                       // nothing to take off
    else if (own.length) { first.nodes = own; namesRoot = true; break; }     // a scope written inside a compound
    compounds.shift();
    if (compounds.length && compounds[0].combinator === ' ') compounds[0].combinator = '';
  }
  if (!compounds.length) return [S];

  var head = compounds[0], rest = compounds.slice(1);
  /* "> .x" straight after the scope: the scope was the left-hand side */
  if (head.combinator) return [S + ' ' + head.combinator + ' ' + compoundText(head.nodes) + tailText(rest)];

  /* the compound form: a type selector has to stay in front of the attribute, "*" adds nothing */
  var tag = head.nodes[0].type === 'tag' ? String(head.nodes[0]).trim() : '';
  var others = head.nodes.filter(function (n, i) { return !(i === 0 && (n.type === 'tag' || n.type === 'universal')); });
  var onRoot = tag + S + compoundText(others) + tailText(rest);
  if (namesRoot) return [onRoot];

  /* a compound that begins with a pseudo ("::before", ":hover") means "any element" */
  var anyElement = head.nodes[0].type === 'pseudo' ? '*' : '';
  var inside = S + ' ' + anyElement + compoundText(head.nodes) + tailText(rest);
  return couldBeRoot(head.nodes, rootInfo) ? [inside, onRoot] : [inside];
}

function scopeSelectorList(selectorText, S, rootInfo) {
  var out = [];
  selectorParser(function (root) {
    root.each(function (selector) {
      scopeSelector(selector, S, rootInfo).forEach(function (s) { if (out.indexOf(s) === -1) out.push(s); });
    });
  }).processSync(selectorText, { lossless: false });
  return out.join(',');
}

function isKeyframes(node) { return node && node.type === 'atrule' && /keyframes$/i.test(node.name); }
function unquote(s) { return String(s).trim().replace(/^(["'])([\s\S]*)\1$/, '$2'); }

/* @keyframes spin -> @keyframes rv-<id>-spin, and every animation that names it. */
function prefixKeyframes(root, prefix) {
  var renamed = {};
  root.walkAtRules(function (at) {
    if (!isKeyframes(at)) return;
    var name = unquote(at.params);
    if (!name || name.indexOf(prefix) === 0) return;
    renamed[name] = prefix + name;
    at.params = prefix + name;
  });
  if (!Object.keys(renamed).length) return;
  root.walkDecls(/^(?:-webkit-|-moz-)?animation(?:-name)?$/i, function (decl) {
    var parsed = valueParser(decl.value);
    parsed.walk(function (node) {
      if ((node.type === 'word' || node.type === 'string') && Object.prototype.hasOwnProperty.call(renamed, node.value)) node.value = renamed[node.value];
    });
    decl.value = parsed.toString();
  });
}

/* @font-face { font-family: "X" } -> "rv-<id>-X", and every font-family / font that names it. */
function prefixFontFaces(root, prefix) {
  var renamed = {};
  root.walkAtRules(/^font-face$/i, function (at) {
    at.walkDecls(/^font-family$/i, function (decl) {
      var name = unquote(decl.value);
      if (!name || name.indexOf(prefix) === 0) return;
      renamed[name.toLowerCase()] = prefix + name;
      decl.value = '"' + prefix + name + '"';
    });
  });
  if (!Object.keys(renamed).length) return;
  root.walkDecls(/^font(?:-family)?$/i, function (decl) {
    if (decl.parent && decl.parent.type === 'atrule' && /^font-face$/i.test(decl.parent.name)) return;
    /* family names are the comma-separated parts; in the `font` shorthand the first part also carries the
       size and style, so only its quoted name can be recognised */
    var parts = postcss.list.comma(decl.value);
    decl.value = parts.map(function (part) {
      var key = unquote(part).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(renamed, key)) return '"' + renamed[key] + '"';
      return part.replace(/(["'])([^"']+)\1/g, function (all, q, name) {
        return Object.prototype.hasOwnProperty.call(renamed, name.toLowerCase()) ? '"' + renamed[name.toLowerCase()] + '"' : all;
      });
    }).join(', ');
  });
}

function parseCss(css) {
  var text = String(css == null ? '' : css);
  /* a sheet that was cut off inside a block is still worth having: close what was left open */
  for (var i = 0; i < 4; i++) {
    try { return postcss.parse(text); } catch (e) { text += '}'; }
  }
  return null;
}

function scopeSectionCss(css, sectionId, rootInfo) {
  var id = String(sectionId == null ? '' : sectionId).replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return '';
  var S = scopeOf(id), containment = containmentRule(id);
  var root = parseCss(css);
  if (!root) return containment;

  var prefix = 'rv-' + id + '-';
  prefixKeyframes(root, prefix);
  prefixFontFaces(root, prefix);

  root.walkRules(function (rule) {
    if (isKeyframes(rule.parent)) return;                      // "from", "to", "50%"
    try { rule.selector = scopeSelectorList(rule.selector, S, rootInfo || null); }
    catch (e) { rule.remove(); }                               // a selector that cannot be read cannot be confined
  });

  /* the containment rule exactly once, in front, so a rule of the section's own always wins over it */
  root.each(function (node) {
    if (node.type === 'rule' && node.toString().replace(/\s+/g, '').replace(/;}$/, '}') === containment) node.remove();
  });
  var body = root.toString().trim();
  return containment + (body ? '\n' + body : '');
}

/* ---------- holding a section to a phone's width ----------
   mobileSafeCss(css) -> the section's stylesheet with the two things that most often push a model's section past
   the edge of a 360px screen made safe, whatever breakpoints the model wrote:
     · a box given a fixed width (or min-width, or flex-basis) of WIDE_PX or more may not be wider than its place:
       width: 420px  ->  width: min(420px, 100%). Below that width nothing changes, so a desktop is untouched.
     · the cells of a grid may shrink below their content's widest word (CSS gives every grid cell min-width:auto,
       so one long word or a wide picture widens its whole column past the screen): a rule
       :where(<the grid's selectors>) > *{min-width:0}, which every rule of the section's own outweighs.
     · text set white-space:nowrap wraps under 640px (one @media block at the end; see below for what is spared).
   Idempotent: a value already in min() is left alone, and the grid and wrap rules are added once. A sheet that
   cannot be read comes back as it was. */
var WIDE_PX = 240;
var GRID_MARK = '/*rv-grid-cells*/';
var WRAP_MARK = '/*rv-phone-wrap*/';

function mobileSafeCss(css) {
  var text = String(css == null ? '' : css);
  if (!text.trim()) return text;
  var root;
  try { root = postcss.parse(text); } catch (e) { return text; }
  var changed = false;

  root.walkDecls(/^(width|min-width|flex-basis|flex)$/i, function (decl) {
    if (isKeyframes(decl.parent && decl.parent.parent) || /^@?font-face$/i.test((decl.parent && decl.parent.name) || '')) return;
    var prop = decl.prop.toLowerCase(), value = decl.value;
    var fixed;
    if (prop === 'flex') {
      /* flex: <grow> <shrink> <basis> — only the basis */
      var parts = value.trim().split(/\s+/);
      if (parts.length !== 3 || !/^\d+(\.\d+)?px$/i.test(parts[2]) || parseFloat(parts[2]) < WIDE_PX) return;
      parts[2] = 'min(' + parts[2] + ', 100%)';
      fixed = parts.join(' ');
    } else {
      var m = /^\s*(\d+(?:\.\d+)?)px\s*$/i.exec(value);
      if (!m || +m[1] < WIDE_PX) return;
      fixed = 'min(' + m[1] + 'px, 100%)';
    }
    decl.value = fixed;
    changed = true;
  });

  /* grids: every selector of a rule that makes a grid (in the same @media as that rule) */
  var grids = [];
  root.walkRules(function (rule) {
    if (isKeyframes(rule.parent)) return;
    var isGrid = false;
    if (!rule.nodes || /::|:(before|after)\b/i.test(rule.selector)) return;
    rule.each(function (n) { if (n.type === 'decl' && /^display$/i.test(n.prop) && /^\s*(inline-)?grid\s*$/i.test(n.value)) isGrid = true; });
    if (isGrid) grids.push(rule);
  });
  var have = {};
  root.walkComments(function (c) { if ('/*' + c.text + '*/' === GRID_MARK && c.next() && c.next().type === 'rule') have[c.next().selector] = true; });
  grids.forEach(function (rule) {
    var sel = ':where(' + rule.selector.replace(/\s+/g, ' ').trim() + ') > *';
    if (have[sel]) return;
    have[sel] = true;
    var cells = postcss.rule({ selector: sel });
    cells.append(postcss.decl({ prop: 'min-width', value: '0' }));
    rule.after(cells);
    rule.after(postcss.comment({ text: GRID_MARK.slice(2, -2) }));
    changed = true;
  });

  /* text kept on one line (white-space:nowrap) wraps on a phone, where a line of 40 capitals runs past the edge.
     Not the top bar's (its links scroll sideways on one line), nor a box that scrolls or clips its own content,
     nor a flex row (the setting is for the words, not the row). One @media block at the end of the sheet, added
     once. */
  var hasWrap = false;
  root.walkComments(function (c) { if ('/*' + c.text + '*/' === WRAP_MARK) hasWrap = true; });
  if (!hasWrap) {
    var wraps = [];
    root.walkRules(function (rule) {
      if (isKeyframes(rule.parent) || !rule.nodes || /data-rv-section="nav"/.test(rule.selector) || /::|:(before|after)\b/i.test(rule.selector)) return;
      var nowrap = false, keeps = false;
      rule.each(function (n) {
        if (n.type !== 'decl') return;
        var p = n.prop.toLowerCase(), v = String(n.value).toLowerCase();
        if (p === 'white-space' && /^\s*nowrap\s*$/.test(v)) nowrap = true;
        if ((p === 'overflow' || p === 'overflow-x') && /(auto|scroll|hidden|clip)/.test(v)) keeps = true;
        if (p === 'text-overflow' || /^animation/.test(p)) keeps = true;
        if (p === 'display' && /flex|grid/.test(v)) keeps = true;
      });
      if (nowrap && !keeps) wraps.push(rule.selector.replace(/\s+/g, ' ').trim());
    });
    if (wraps.length) {
      var phone = postcss.atRule({ name: 'media', params: '(max-width:640px)' });
      var w = postcss.rule({ selector: wraps.join(',') });
      w.append(postcss.decl({ prop: 'white-space', value: 'normal' }));
      phone.append(w);
      root.append(postcss.comment({ text: WRAP_MARK.slice(2, -2) }));
      root.append(phone);
      changed = true;
    }
  }
  return changed ? root.toString() : text;
}

/* After scoping: does any rule apply to the root itself (and give it at least one declaration)? */
function rootIsStyled(scopedCss, sectionId, rootInfo) {
  var S = scopeOf(String(sectionId).replace(/[^A-Za-z0-9_-]/g, '')), containment = containmentRule(sectionId);
  var root = parseCss(scopedCss);
  if (!root || !rootInfo) return false;
  var styled = false;
  root.walkRules(function (rule) {
    if (styled || isKeyframes(rule.parent) || !rule.nodes || !rule.nodes.some(function (n) { return n.type === 'decl'; })) return;
    if (rule.toString().replace(/\s+/g, '').replace(/;}$/, '}') === containment) return;
    try {
      selectorParser(function (list) {
        list.each(function (selector) {
          var compounds = compoundsOf(selector);
          if (compounds.length !== 1) return;
          var nodes = compounds[0].nodes;
          if (!nodes.some(isScopeAttribute)) return;
          var own = nodes.filter(function (n) { return !isScopeAttribute(n); });
          if (own.some(function (n) { return n.type === 'pseudo' || n.type === 'attribute'; })) return;
          if (couldBeRoot(own, rootInfo)) styled = true;
        });
      }).processSync(rule.selector, { lossless: false });
    } catch (e) { /* not a selector we can read: it does not count */ }
  });
  return styled;
}

module.exports = { scopeSectionCss, sectionRootInfo, rootIsStyled, mobileSafeCss };
