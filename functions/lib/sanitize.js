/* The one sanitiser for HTML and CSS this server did not write itself: sections written by the model
   (profile "generated") and pages copied from another site (profile "imported").

   Such markup is shown inside the editor and served at /e/<id> on the CMS origin, where a script would run
   with the signed-in person's session. So this is an allow-list on a real parser: an element, attribute,
   URL scheme or CSS construct that is not named below does not come out, however it was written.

     sanitizeHtml(html, { profile })  ->  { html, removed: [ { what, count } ] }
     sanitizeCss(css)                 ->  string ("" when the stylesheet cannot be parsed)
     sanitizeStyleAttribute(value)    ->  string (the declarations that may stay in a style="" attribute)
     styleBlocks(html)                ->  [{ attrs, css }]: every <style> element, its attributes and its text
     styleTexts(html)                 ->  [css]: the text of every <style> element in the markup, as a parser
                                          reads it (sanitizeHtml takes those elements out; a caller that wants
                                          their rules runs them through sanitizeCss and puts them in a <style>
                                          of its own, in the page's HTML — never back where they were, which may
                                          be inside an <svg>, where a <style>'s text is read as markup)
     sanitizeSection(html, css, { profile }) -> { html, css, removed }: one section's markup and its styles, the
                                          markup's own <style> rules moved into its CSS (after the CSS given)

   `removed` says what was taken out, so a caller can tell the owner what an import lost.
   The output is always re-serialised from the parsed tree (lower-case names, quoted attributes, escaped
   text), so anything that searches the markup for substrings must search the sanitised result.
   data-* attributes stay in both profiles (the site's own scripts — et-runtime.js, rv-popups.js, rv-blend.js,
   rv-award-cta.js, rv-data.js — read them, and a browser does nothing with them by itself); a value that is an
   address a script could run (javascript:, vbscript:, data: other than a bitmap) is taken out. */

const sanitizeHtmlLib = require('sanitize-html');
const htmlparser2 = require('htmlparser2');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');

/* ---------- what may stay ---------- */

var TEXT_TAGS = ['div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'a', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'blockquote', 'hr', 'br', 'wbr', 'small',
  'strong', 'em', 'b', 'i', 'u', 's', 'sup', 'sub', 'mark', 'abbr', 'cite', 'q', 'code', 'pre', 'time', 'address', 'label',
  'details', 'summary', 'button'];
var MEDIA_TAGS = ['img', 'picture', 'source', 'video', 'audio', 'track'];
var TABLE_TAGS = ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'];
/* The parser lower-cases names; a browser reading the result as HTML restores the SVG spelling
   (lineargradient -> linearGradient, viewbox -> viewBox). foreignObject and script are deliberately absent. */
var SVG_TAGS = ['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'defs', 'symbol', 'use',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'marker', 'text', 'tspan', 'textpath', 'image',
  'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'fecomposite', 'feflood', 'femerge', 'femergenode',
  'fedropshadow', 'feturbulence', 'fedisplacementmap', 'femorphology', 'fecomponenttransfer', 'fefunca', 'fefuncr',
  'fefuncg', 'fefuncb', 'animate', 'animatetransform', 'animatemotion', 'set'];
var SVG_ANIMATION_TAGS = ['animate', 'animatetransform', 'animatemotion', 'set'];
var IMPORTED_ONLY_TAGS = ['input', 'textarea', 'select', 'option', 'optgroup', 'fieldset', 'legend', 'iframe'];

var BASE_TAGS = TEXT_TAGS.concat(MEDIA_TAGS, TABLE_TAGS, SVG_TAGS, ['template']);
var PROFILE_TAGS = {
  generated: BASE_TAGS,
  imported: BASE_TAGS.concat(IMPORTED_ONLY_TAGS)
};

/* Removed together with everything inside them (for any other element that is not allowed, the element
   goes and its text and allowed children stay). */
var DROPPED_WITH_CONTENT = ['script', 'style', 'object', 'embed', 'base', 'meta', 'link', 'noscript', 'frame', 'frameset',
  'applet', 'math', 'title', 'head', 'foreignobject', 'xmp', 'noembed', 'noframes', 'plaintext'];
var DROPPED_WITH_CONTENT_GENERATED = DROPPED_WITH_CONTENT.concat(['iframe', 'textarea', 'select', 'option', 'optgroup']);

var GLOBAL_ATTRS = ['class', 'id', 'style', 'title', 'role', 'hidden', 'lang', 'dir', 'tabindex'];
var TAG_ATTRS = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding', 'fetchpriority'],
  /* old presentational attributes a copied page may still carry: inert */
  hr: ['size', 'noshade', 'width'], br: ['clear'],
  source: ['src', 'srcset', 'sizes', 'type', 'media', 'width', 'height'],
  video: ['src', 'poster', 'width', 'height', 'controls', 'muted', 'loop', 'playsinline', 'autoplay', 'preload'],
  audio: ['src', 'controls', 'muted', 'loop', 'autoplay', 'preload'],
  track: ['src', 'kind', 'srclang', 'label', 'default'],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], col: ['span'], colgroup: ['span'],
  ol: ['start', 'reversed'], li: ['value'], time: ['datetime'], label: ['for'], details: ['open'],
  button: ['type', 'disabled'],
  input: ['type', 'placeholder', 'value', 'checked', 'disabled', 'readonly', 'min', 'max', 'step', 'required', 'autocomplete', 'maxlength', 'minlength'],
  textarea: ['placeholder', 'rows', 'cols', 'disabled', 'readonly', 'required', 'maxlength', 'minlength'],
  select: ['disabled', 'multiple', 'required'], option: ['value', 'selected', 'disabled'], optgroup: ['label', 'disabled'],
  iframe: ['src', 'width', 'height', 'title', 'allowfullscreen', 'frameborder', 'sandbox', 'loading']
};
var SVG_ATTRS = ['viewbox', 'xmlns', 'xmlns:xlink', 'preserveaspectratio', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'stroke-opacity', 'opacity', 'clip-path', 'clip-rule', 'mask', 'filter', 'vector-effect', 'pathlength', 'focusable',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'offset', 'stop-color', 'stop-opacity', 'patternunits',
  'patterncontentunits', 'patterntransform', 'maskunits', 'maskcontentunits', 'clippathunits', 'markerwidth',
  'markerheight', 'markerunits', 'refx', 'refy', 'orient', 'marker-start', 'marker-mid', 'marker-end', 'text-anchor',
  'dominant-baseline', 'font-size', 'font-family', 'font-weight', 'letter-spacing', 'startoffset', 'href', 'xlink:href',
  'filterunits', 'primitiveunits', 'color-interpolation-filters', 'stddeviation', 'in', 'in2', 'result', 'mode', 'values',
  'type', 'flood-color', 'flood-opacity', 'operator', 'k1', 'k2', 'k3', 'k4', 'basefrequency', 'numoctaves', 'seed',
  'scale', 'xchannelselector', 'ychannelselector', 'radius', 'tablevalues', 'slope', 'intercept', 'amplitude', 'exponent',
  'attributename', 'attributetype', 'from', 'to', 'by', 'dur', 'begin', 'end', 'repeatcount', 'repeatdur', 'calcmode',
  'keytimes', 'keysplines', 'additive', 'accumulate', 'path', 'rotate'];

var URL_ATTRS = ['href', 'xlink:href', 'src', 'poster', 'action', 'formaction', 'background', 'cite', 'data'];
var URL_SCHEMES = ['http', 'https', 'mailto', 'tel'];
var DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+\/=\s]+$/i;
var FORCED_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation';

/* Video and map embeds an imported page may keep: https only, these hosts, these paths. */
var IFRAME_SOURCES = [
  { host: /^(?:www\.)?youtube\.com$/, path: /^\/embed\// },
  { host: /^(?:www\.)?youtube-nocookie\.com$/, path: /^\/embed\// },
  { host: /^player\.vimeo\.com$/, path: /^\/video\// },
  { host: /^(?:www\.)?google\.com$/, path: /^\/maps\/embed/ }
];

function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

/* The scheme of a URL as a browser would read it (it ignores tabs, line breaks and leading control
   characters), or "" for a relative address. */
function schemeOf(url) {
  var compact = String(url == null ? '' : url).replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  var m = /^([a-z][a-z0-9+.\-]*):/i.exec(compact);
  return m ? m[1].toLowerCase() : '';
}

function isDataImage(url) { return DATA_IMAGE.test(String(url).trim()); }

/* May this address stay in `attr` of `tag`? data: only as a bitmap on an image element — never SVG or HTML. */
function urlAllowed(tag, attr, value) {
  var scheme = schemeOf(value);
  if (!scheme) return true;
  if (scheme === 'data') return (tag === 'img' || tag === 'source' || tag === 'image') && (attr === 'src' || attr === 'href' || attr === 'xlink:href') && isDataImage(value);
  return URL_SCHEMES.indexOf(scheme) !== -1;
}

/* A data-* value is read by the site's own scripts, mostly as words ("Day 1: Keynote", "previous-agenda:0",
   a JSON record) and sometimes as an address (data-src, data-winners-href). So it is refused only when it is an
   address a script could run: javascript:, vbscript:, livescript:, or data: that is not a bitmap. */
var SCRIPT_SCHEMES = ['javascript', 'vbscript', 'livescript', 'mocha'];
function dataValueAllowed(value) {
  var scheme = schemeOf(value);
  if (!scheme) return true;
  if (scheme === 'data') return isDataImage(value);
  return SCRIPT_SCHEMES.indexOf(scheme) === -1;
}

function iframeSourceAllowed(src) {
  var u;
  try { u = new URL(String(src || '').trim()); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return IFRAME_SOURCES.some(function (rule) { return rule.host.test(u.hostname) && rule.path.test(u.pathname); });
}

function attrAllowed(profile, tag, attr) {
  if (/^on/.test(attr) || attr === 'srcdoc') return false;
  if (GLOBAL_ATTRS.indexOf(attr) !== -1 || /^aria-[a-z0-9-]+$/.test(attr)) return true;
  if (/^data-[a-z0-9_.:-]+$/.test(attr)) return true;
  if (has(TAG_ATTRS, tag) && TAG_ATTRS[tag].indexOf(attr) !== -1) return true;
  if (SVG_TAGS.indexOf(tag) !== -1 && SVG_ATTRS.indexOf(attr) !== -1) return true;
  return false;
}

/* ---------- CSS ---------- */

var AT_RULES = ['media', 'supports', 'font-face', 'keyframes', '-webkit-keyframes', '-moz-keyframes', 'container', 'layer',
  'property', 'counter-style', 'page'];
var BLOCKED_PROPERTIES = /^(?:behavior|-moz-binding)$/i;
var DATA_CSS_URL = /^data:(?:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)|font\/[a-z0-9.+-]+|application\/(?:font-woff2?|x-font-[a-z0-9-]+|vnd\.ms-fontobject|octet-stream))[;,]/i;

// CSS escapes resolved and comments removed, so a blocked word cannot hide behind an escaped letter
// ("\6a avascript") or a comment in the middle of it.
function cssPlain(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, function (m, hex) {
      var code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/\\([^\r\n\f0-9a-f])/gi, '$1')
    .replace(/\\[\r\n\f]/g, '');
}

function cssUrlAllowed(url) {
  var plain = cssPlain(String(url)).trim().replace(/^["']|["']$/g, '');
  var scheme = schemeOf(plain);
  if (!scheme) return true;
  if (scheme === 'http' || scheme === 'https') return true;
  if (scheme === 'data') return DATA_CSS_URL.test(plain.replace(/\s+/g, ''));
  return false;
}

function declarationAllowed(prop, value) {
  if (BLOCKED_PROPERTIES.test(cssPlain(prop).trim())) return false;
  var plain = cssPlain(value).toLowerCase();
  if (/expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:/.test(plain.replace(/[\u0000-\u0020]+/g, ''))) return false;
  var ok = true;
  try {
    valueParser(value).walk(function (node) {
      if (node.type !== 'function') return;
      var name = cssPlain(node.value).toLowerCase();
      if (name === 'url' || name === 'src') {
        if (!cssUrlAllowed(valueParser.stringify(node.nodes))) ok = false;
      } else if (name === 'image-set' || name === '-webkit-image-set' || name === 'image') {
        node.nodes.forEach(function (n) { if (n.type === 'string' && !cssUrlAllowed(n.value)) ok = false; });
      }
    });
  } catch (e) { return false; }
  return ok;
}

function filterCssTree(root) {
  root.walkComments(function (c) { c.remove(); });
  root.walkAtRules(function (at) {
    if (AT_RULES.indexOf(String(at.name).toLowerCase()) === -1) at.remove();
  });
  root.walkDecls(function (decl) {
    if (!declarationAllowed(decl.prop, decl.value)) decl.remove();
  });
}

/* A stylesheet is put inside a <style> element by whoever uses it: the text must never be able to end
   that element, open an HTML comment or — should the element ever stand inside an <svg>, where its text is read
   as markup — start a tag. So no "<" is left before a letter, "/", "!" or "?": it is written as the CSS escape
   "\3c ", which means the same "<" inside a CSS string (the only place it can stand before such a character in
   real CSS); "a < b" in a media query keeps its own. */
function styleElementSafe(css) {
  var out = css.replace(/<(?=[A-Za-z\/!?])/g, '\\3c ').replace(/-->/g, '--\\>');
  return (/<[A-Za-z\/!?]/.test(out)) ? '' : out;
}

/* A stylesheet a browser would still mostly read — a stray word after its last rule (a real generated
   section ends in "'auto'") — is read as a browser does: rule by rule, the ones that cannot be parsed left
   out. Only for a sheet with no markup in it: one with a "<" that does not parse is refused whole. */
function topLevelChunks(text) {
  var chunks = [], start = 0, depth = 0, quote = '', i = 0, n = text.length;
  while (i < n) {
    var c = text.charAt(i);
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = '';
      i++; continue;
    }
    if (c === '/' && text.charAt(i + 1) === '*') { var end = text.indexOf('*/', i + 2); i = end === -1 ? n : end + 2; continue; }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth <= 0) { depth = 0; chunks.push(text.slice(start, i + 1)); start = i + 1; }
    } else if (c === ';' && depth === 0) { chunks.push(text.slice(start, i + 1)); start = i + 1; }
    i++;
  }
  /* a last rule left open is closed, as a browser closes it at the end of the sheet */
  if (text.slice(start).trim()) chunks.push(text.slice(start) + (depth > 0 && !quote ? new Array(depth + 1).join('}') : ''));
  return chunks;
}
function parseCss(text) {
  try { return postcss.parse(text); } catch (e) { /* read rule by rule below */ }
  if (/</.test(text)) return null;
  var root = postcss.root();
  topLevelChunks(text).forEach(function (chunk) {
    var part;
    try { part = postcss.parse(chunk); } catch (e) { return; }
    part.each(function (node) {
      if (node.type === 'rule' && !String(node.selector || '').trim()) return;     // "{…}" with nothing it applies to
      if (node.type === 'decl') return;                                            // a declaration outside any rule
      root.append(node.clone());
    });
  });
  return root.nodes.length ? root : null;
}

function sanitizeCss(css) {
  var text = String(css == null ? '' : css);
  if (!text.trim()) return '';
  var root = parseCss(text);
  if (!root) return '';
  try {
    filterCssTree(root);
    return styleElementSafe(root.toString());
  } catch (e) { return ''; }
}

/* -> { style, dropped }: the declarations that may stay, and how many were taken out */
function filterStyleAttribute(value) {
  var text = String(value == null ? '' : value);
  if (!text.trim()) return { style: '', dropped: 0 };
  var root;
  try { root = postcss.parse('a{' + text + '}'); } catch (e) { return { style: '', dropped: 1 }; }
  var rule = root.first;
  /* a value that closes the wrapper rule and starts another is not a list of declarations */
  if (root.nodes.length !== 1 || !rule || rule.type !== 'rule') return { style: '', dropped: 1 };
  var kept = [], dropped = 0;
  rule.each(function (node) {
    if (node.type !== 'decl' || !declarationAllowed(node.prop, node.value)) { if (node.type !== 'comment') dropped++; return; }
    kept.push(node.prop + ':' + node.value + (node.important ? ' !important' : ''));
  });
  return { style: kept.join(';'), dropped: dropped };
}

function sanitizeStyleAttribute(value) { return filterStyleAttribute(value).style; }

/* ---------- HTML ---------- */

function sanitizeHtml(html, opts) {
  var profile = (opts && opts.profile) === 'imported' ? 'imported' : 'generated';
  var allowedTags = PROFILE_TAGS[profile];
  var counts = {};
  function removed(what) { counts[what] = (counts[what] || 0) + 1; }

  function clean(tagName, attribs) {
    var tag = tagName, drop = false;

    if (tag === 'form' && profile === 'imported') {
      /* the page keeps its layout; nothing can be submitted anywhere */
      tag = 'div';
      attribs = Object.assign({}, attribs, { 'data-rv-was-form': '' });
      ['action', 'method', 'formaction', 'name', 'target', 'enctype'].forEach(function (a) { delete attribs[a]; });
      removed('form (kept as a plain block)');
    } else if (tag === 'iframe' && profile === 'imported') {
      if (!iframeSourceAllowed(attribs.src)) drop = true;
      else attribs = Object.assign({}, attribs, { sandbox: FORCED_IFRAME_SANDBOX, loading: 'lazy' });
    } else if (tag === 'input' && String(attribs.type || '').toLowerCase() === 'hidden') {
      drop = true;
    } else if (SVG_ANIMATION_TAGS.indexOf(tag) !== -1) {
      /* an animation that writes a link's address is a way to script it */
      var target = String(attribs.attributename || '').toLowerCase();
      var written = [attribs.to, attribs.from, attribs.by, attribs.values].join(' ');
      if (/href/.test(target) || /^on/.test(target) || /:/.test(written)) drop = true;
    }

    if (drop) {
      removed('<' + tagName + '>');
      /* an allowed kind of element that must go in this instance: marked here, taken out with
         everything inside it by exclusiveFilter below */
      return { tagName: tag, attribs: { 'data-rv-drop': '' } };
    }
    if (allowedTags.indexOf(tag) === -1) {
      removed('<' + tagName + '>');
      return { tagName: tagName, attribs: {} };
    }

    var out = {};
    Object.keys(attribs).forEach(function (name) {
      var attr = name.toLowerCase(), value = attribs[name];
      if (attr === 'data-rv-drop' || !attrAllowed(profile, tag, attr)) {
        removed(/^on/.test(attr) ? 'event handler attribute' : attr + ' attribute');
        return;
      }
      if (attr === 'style') {
        var filtered = filterStyleAttribute(value);
        if (filtered.dropped) removed('unsafe inline style');
        if (filtered.style) out.style = filtered.style;
        return;
      }
      if (URL_ATTRS.indexOf(attr) !== -1 && !urlAllowed(tag, attr, value)) { removed('unsafe address in ' + attr); return; }
      if (/^data-/.test(attr) && !dataValueAllowed(value)) { removed('unsafe address in ' + attr); return; }
      if (tag === 'use' && (attr === 'href' || attr === 'xlink:href') && !/^\s*#/.test(value)) { removed('external <use> reference'); return; }
      if (attr === 'srcset' && /data\s*:/i.test(value)) { removed('unsafe address in srcset'); return; }
      out[attr] = value;
    });

    if (tag === 'a' && String(out.target || '').toLowerCase() === '_blank') out.rel = 'noopener noreferrer';
    if (tag === 'input' && /^(?:image|file|password)$/i.test(String(out.type || ''))) { out.type = 'text'; delete out.value; }
    return { tagName: tag, attribs: out };
  }

  var allowedAttributes = { '*': GLOBAL_ATTRS.concat(['aria-*', 'data-*']) };
  Object.keys(TAG_ATTRS).forEach(function (tag) { allowedAttributes[tag] = TAG_ATTRS[tag].slice(); });
  SVG_TAGS.forEach(function (tag) { allowedAttributes[tag] = (allowedAttributes[tag] || []).concat(SVG_ATTRS); });

  var out;
  try {
    out = sanitizeHtmlLib(String(html == null ? '' : html), {
      allowedTags: allowedTags,
      nonTextTags: profile === 'generated' ? DROPPED_WITH_CONTENT_GENERATED : DROPPED_WITH_CONTENT,
      disallowedTagsMode: 'discard',
      allowedAttributes: allowedAttributes,
      allowedSchemes: URL_SCHEMES,
      allowedSchemesByTag: { img: URL_SCHEMES.concat(['data']), source: URL_SCHEMES.concat(['data']), image: URL_SCHEMES.concat(['data']) },
      allowedSchemesAppliedToAttributes: URL_ATTRS,
      allowProtocolRelative: true,
      allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com', 'player.vimeo.com', 'www.google.com', 'google.com'],
      allowIframeRelativeUrls: false,
      /* style attributes are filtered in clean() above, by the same rules as stylesheets */
      parseStyleAttributes: false,
      selfClosing: ['img', 'br', 'hr', 'wbr', 'input', 'source', 'track', 'col'],
      allowedEmptyAttributes: ['alt', 'value', 'hidden'],
      enforceHtmlBoundary: false,
      transformTags: { '*': clean },
      exclusiveFilter: function (frame) { return has(frame.attribs, 'data-rv-drop'); }
    });
  } catch (e) {
    return { html: '', removed: [{ what: 'everything (the markup could not be read)', count: 1 }] };
  }

  return {
    html: out,
    removed: Object.keys(counts).sort().map(function (what) { return { what: what, count: counts[what] }; })
  };
}

/* every <style> element, as the same parser sanitizeHtml uses reads the markup: [{ attrs, css }] */
function styleBlocks(html) {
  var found = [], depth = 0, text = '', attrs = {};
  try {
    var parser = new htmlparser2.Parser({
      onopentag: function (name, a) { if (name === 'style') { if (!depth) { text = ''; attrs = a || {}; } depth++; } },
      ontext: function (t) { if (depth) text += t; },
      onclosetag: function (name) { if (name === 'style' && depth) { depth--; if (!depth && text.trim()) found.push({ attrs: attrs, css: text }); } }
    }, { decodeEntities: false, lowerCaseTags: true, lowerCaseAttributeNames: true });
    parser.write(String(html == null ? '' : html));
    parser.end();
  } catch (e) { return found; }
  return found;
}
function styleTexts(html) { return styleBlocks(html).map(function (b) { return b.css; }); }

function sanitizeSection(html, css, opts) {
  var markup = sanitizeHtml(html, opts);
  /* each sheet on its own: one that cannot be read does not take the others with it */
  var sheets = [String(css == null ? '' : css)].concat(styleTexts(html)).map(sanitizeCss).filter(Boolean);
  return { html: markup.html, css: sheets.join('\n'), removed: markup.removed };
}

module.exports = { sanitizeHtml, sanitizeCss, sanitizeStyleAttribute, styleBlocks, styleTexts, sanitizeSection };
