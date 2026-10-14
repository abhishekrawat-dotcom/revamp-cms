/* The year in a lock-up whose lettering is drawn as outlines — an SVG of <path>s, with no real text to change.

   A previous edition's logo unit is usually exported this way ("SUMMIT '2026" is a row of shapes). Its year
   is moved on without redrawing anything else: the shapes of the old year's digits are taken out, exactly,
   and the new year is set in their place as real text — in the closest font the reader of the picture could
   name, embedded, in the digits' own colour, as tall as they were and as wide as they ran. Every other byte
   of the drawing is left as it was.

   Where the digits are is told by a model that read the drawing as a picture (yearBox, in the drawing's own
   units); which shapes are the digits is then decided here, from the shapes' own extents.

     pathBox(d)                       -> { x, y, width, height } | null   the extent of one path's outline
     shapesIn(svgText)                -> [ { start, end, box, fill, transformed } ]   the drawing's <path>s
     viewBoxOf(svgText)               -> { x, y, width, height } | null
     yearShapes(svgText, box)         -> { shapes, box } | null   the digits' shapes inside a box, and their extent
     replaceYear(svgText, found, o)   -> svgText   o: { toYear, font: { ttfBase64, metrics, family } | null,
                                                       serif, bold }
   No network, no Firebase: see svg-year.test.js. */

/* ---------- the outline of one path ---------- */
var NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
var ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/* -> the box of every point the path passes through or pulls towards (end points and control points; an
   arc by its end point and radii). For lettering that is the glyph's box, give or take a hair. */
function pathBox(d) {
  var tokens = String(d || '').match(/[MLHVCSQTAZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi);
  if (!tokens || !tokens.length) return null;
  var x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function see(px, py) { if (px < minX) minX = px; if (py < minY) minY = py; if (px > maxX) maxX = px; if (py > maxY) maxY = py; }
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) { cmd = tokens[i++]; if (/z/i.test(cmd)) { x = sx; y = sy; continue; } }
    var C = cmd.toUpperCase(), rel = cmd !== C, n = ARGS[C];
    if (!n) return null;
    var a = [];
    for (var k = 0; k < n; k++) {
      if (i >= tokens.length || /[a-z]/i.test(tokens[i])) return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      a.push(+tokens[i++]);
    }
    var bx = rel ? x : 0, by = rel ? y : 0;
    if (C === 'H') { x = bx + a[0]; see(x, y); }
    else if (C === 'V') { y = by + a[0]; see(x, y); }
    else if (C === 'A') {
      var ex = bx + a[5], ey = by + a[6];
      see(x, y); see(ex, ey);
      // the bulge of an arc stays within its radii of either end
      see(Math.min(x, ex) - Math.abs(a[0]) * 0, Math.min(y, ey)); x = ex; y = ey;
    } else {
      for (var p = 0; p < n; p += 2) see(bx + a[p], by + a[p + 1]);
      x = bx + a[n - 2]; y = by + a[n - 1];
      if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function attr(tag, name) {
  var m = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? (m[2] != null ? m[2] : m[3]) : null;
}

function viewBoxOf(svg) {
  var open = /<svg\b[^>]*>/i.exec(String(svg || ''));
  if (!open) return null;
  var vb = attr(open[0], 'viewBox');
  if (vb) {
    var n = vb.trim().split(/[\s,]+/).map(Number);
    if (n.length === 4 && n.every(isFinite) && n[2] > 0 && n[3] > 0) return { x: n[0], y: n[1], width: n[2], height: n[3] };
  }
  var w = parseFloat(attr(open[0], 'width')), h = parseFloat(attr(open[0], 'height'));
  return w > 0 && h > 0 ? { x: 0, y: 0, width: w, height: h } : null;
}

/* every <path> of the drawing, with where it is in the text and whether anything moves it (a transform on it
   or on a group around it: its box would not be where it is drawn, so it is never chosen) */
function shapesIn(svg) {
  svg = String(svg || '');
  var out = [], stack = [], re = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*?)(\/?)>/g, m;
  while ((m = re.exec(svg))) {
    var closing = m[1] === '/', name = m[2].toLowerCase(), self = m[4] === '/' || /\/\s*$/.test(m[3]);
    if (closing) { for (var j = stack.length - 1; j >= 0; j--) if (stack[j].name === name) { stack.length = j; break; } continue; }
    var moved = /\stransform\s*=/.test(' ' + m[3]);
    if (name === 'path') {
      var d = attr(m[0], 'd');
      var inDefs = stack.some(function (s) { return s.name === 'defs' || s.name === 'clippath' || s.name === 'mask' || s.name === 'symbol' || s.name === 'pattern'; });
      var end = m.index + m[0].length;
      if (!self) { var close = svg.indexOf('</path>', end); if (close !== -1) end = close + 7; }
      if (d && !inDefs) {
        out.push({ start: m.index, end: end, box: pathBox(d), fill: attr(m[0], 'fill') || styleFill(attr(m[0], 'style')) || inheritedFill(stack),
          transformed: moved || stack.some(function (s) { return s.moved; }) });
      }
      if (!self) re.lastIndex = end;
      continue;
    }
    if (!self) stack.push({ name: name, moved: moved, fill: attr(m[0], 'fill') || styleFill(attr(m[0], 'style')) });
  }
  return out;
}
function styleFill(style) { var m = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(String(style || '')); return m ? m[1].trim() : null; }
function inheritedFill(stack) { for (var i = stack.length - 1; i >= 0; i--) if (stack[i].fill) return stack[i].fill; return null; }

/* The shapes that are the year: inside the box the reader gave (with a little room), each a glyph-sized shape
   (never one that runs far outside it, a background or a frame), untransformed, and together a row of digits.
   -> { shapes, box } or null when that is not what the box holds. */
function yearShapes(svg, box) {
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;
  var padX = box.width * 0.12, padY = box.height * 0.35;
  var room = { x0: box.x - padX, y0: box.y - padY, x1: box.x + box.width + padX, y1: box.y + box.height + padY };
  var shapes = shapesIn(svg).filter(function (s) {
    var b = s.box;
    if (!b || !(b.width > 0) || !(b.height > 0)) return false;
    var cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (cx < box.x - padX / 2 || cx > box.x + box.width + padX / 2 || cy < box.y - padY / 2 || cy > box.y + box.height + padY / 2) return false;
    return b.x >= room.x0 && b.y >= room.y0 && b.x + b.width <= room.x1 && b.y + b.height <= room.y1;
  });
  if (!shapes.length || shapes.length > 12 || shapes.some(function (s) { return s.transformed; })) return null;
  /* digits stand as tall as one another; a mark much shorter than them (an apostrophe before the year, a dot)
     is not one of them and stays where it is */
  var heights = shapes.map(function (s) { return s.box.height; }).sort(function (p, q) { return p - q; });
  var tall = heights[Math.floor(heights.length / 2)];
  shapes = shapes.filter(function (s) { return s.box.height >= tall * 0.6; });
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  shapes.forEach(function (s) { var b = s.box; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); });
  var found = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  var ratio = found.width / found.height;
  /* four digits side by side, and nothing much bigger or smaller than the box that was read */
  if (ratio < 1.4 || ratio > 5 || found.width > box.width * 1.6 || found.width < box.width * 0.5) return null;
  /* all one colour: the digits of a year are */
  var fills = shapes.map(function (s) { return String(s.fill || '').toLowerCase(); }).filter(function (f, i, l) { return l.indexOf(f) === i; });
  if (fills.length > 1) return null;
  return { shapes: shapes, box: found, fill: fills[0] || '#000000' };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* The drawing with the old year's shapes taken out and the new year set where they stood. */
function replaceYear(svg, found, o) {
  o = o || {};
  var out = String(svg), b = found.box, toYear = String(o.toYear || '');
  found.shapes.slice().sort(function (p, q) { return q.start - p.start; }).forEach(function (s) { out = out.slice(0, s.start) + out.slice(s.end); });
  var fill = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(found.fill) && found.fill !== 'none' ? found.fill : '#000000';
  var text, style = '';
  var font = o.font && o.font.metrics && o.font.ttfBase64 ? o.font : null;
  if (font) {
    var m = font.metrics;
    var size = b.height / ((m.capHeight || m.unitsPerEm * 0.7) / m.unitsPerEm);
    var natural = 0;
    Array.from(toYear).forEach(function (ch) { natural += m.advanceOf(ch.codePointAt(0)) / m.unitsPerEm * size; });
    if (natural > b.width * 1.04) { size = size * b.width / natural; natural = b.width; }
    var spacing = toYear.length > 1 ? Math.max(-size * 0.05, Math.min((b.width - natural) / (toYear.length - 1), size * 0.6)) : 0;
    style = '<style>@font-face{font-family:\'rvyear\';src:url(data:font/ttf;base64,' + font.ttfBase64 + ') format(\'truetype\')}</style>';
    text = '<text x="' + b.x.toFixed(2) + '" y="' + (b.y + b.height).toFixed(2) + '" fill="' + esc(fill) + '" font-family="\'rvyear\', ' + (o.serif ? 'Georgia, serif' : 'Arial, sans-serif') +
      '" font-size="' + size.toFixed(2) + '" letter-spacing="' + spacing.toFixed(2) + '">' + esc(toYear) + '</text>';
  } else {
    text = '<text x="' + b.x.toFixed(2) + '" y="' + (b.y + b.height).toFixed(2) + '" fill="' + esc(fill) + '" font-family="' + (o.serif ? 'Georgia, \'Times New Roman\', serif' : 'Arial, Helvetica, sans-serif') +
      '" font-weight="' + (o.bold ? 700 : 400) + '" font-size="' + (b.height / 0.716).toFixed(2) + '" textLength="' + b.width.toFixed(2) + '" lengthAdjust="spacing">' + esc(toYear) + '</text>';
  }
  var close = out.lastIndexOf('</svg>');
  if (close === -1) return null;
  return out.slice(0, close) + style + text + out.slice(close);
}

module.exports = { pathBox, shapesIn, viewBoxOf, yearShapes, replaceYear };
