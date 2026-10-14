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
     yearShapes(svgText, box)         -> { shapes, box, fill } | null   the digits' shapes inside a box, and their extent
     cutShapes(svgText, found)        -> svgText   the drawing with those shapes taken out
     replaceYear(svgText, found, o)   -> svgText   o: { toYear, font: { ttfBase64, metrics, family } | null,
                                                       serif, bold, fill }
   No network, no Firebase: see svg-year.test.js. */

/* ---------- the outline of one path ---------- */
var ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/* the points an arc passes through: its end points and samples along it (SVG 1.1 F.6.5, radii scaled up
   as F.6.6 says when they are too small to reach) */
function arcPoints(x1, y1, rx, ry, phi, large, sweep, x2, y2, see) {
  see(x2, y2);
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return;
  var r = phi * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  var dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  var xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  var lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { var k = Math.sqrt(lam); rx *= k; ry *= k; }
  var num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  var co = Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp))) * (large === sweep ? -1 : 1);
  var cxp = co * rx * yp / ry, cyp = -co * ry * xp / rx;
  var cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  function ang(ux, uy, vx, vy) { return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); }
  var t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  var dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  for (var i = 1; i < 48; i++) {
    var t = t1 + dt * i / 48;
    see(cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos);
  }
}

/* -> the box of every point the path passes through or pulls towards (end points, control points — a
   reflected one for S and T too — and points along every arc). For lettering that is the glyph's box,
   give or take a hair, never smaller than it. null when the path cannot be read. */
function pathBox(d) {
  d = String(d || '');
  var pos = 0, len = d.length;
  function skip() { while (pos < len && /[\s,]/.test(d[pos])) pos++; }
  function number() {
    skip();
    var m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(pos, pos + 40));
    if (!m) return null;
    pos += m[0].length;
    return +m[0];
  }
  function flag() { skip(); var c = d[pos]; if (c === '0' || c === '1') { pos++; return +c; } return null; }
  var x = 0, y = 0, sx = 0, sy = 0, cmd = '', cx2 = null, cy2 = null, prevC = '';
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function see(px, py) { if (px < minX) minX = px; if (py < minY) minY = py; if (px > maxX) maxX = px; if (py > maxY) maxY = py; }
  function box() { return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; }
  for (var guard = 0; guard < 200000; guard++) {
    skip();
    if (pos >= len) break;
    if (/[MLHVCSQTAZ]/i.test(d[pos])) { cmd = d[pos++]; }
    else if (!cmd) return null;
    var C = cmd.toUpperCase(), rel = cmd !== C, n = ARGS[C];
    if (C === 'Z') { x = sx; y = sy; prevC = 'Z'; cmd = ''; continue; }
    var a = [];
    for (var k = 0; k < n; k++) {
      var v = C === 'A' && (k === 3 || k === 4) ? flag() : number();
      if (v === null || !isFinite(v)) return k === 0 && a.length === 0 && pos >= len ? box() : null;
      a.push(v);
    }
    var bx = rel ? x : 0, by = rel ? y : 0;
    var curve = false;
    if (C === 'H') { x = bx + a[0]; see(x, y); }
    else if (C === 'V') { y = by + a[0]; see(x, y); }
    else if (C === 'A') { var ex = bx + a[5], ey = by + a[6]; see(x, y); arcPoints(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey, see); x = ex; y = ey; }
    else if (C === 'S' || C === 'T') {
      /* the first control point is the last one's reflection, when the last segment was the same kind */
      var same = C === 'S' ? (prevC === 'C' || prevC === 'S') : (prevC === 'Q' || prevC === 'T');
      var rx1 = same && cx2 !== null ? 2 * x - cx2 : x, ry1 = same && cy2 !== null ? 2 * y - cy2 : y;
      see(x, y); see(rx1, ry1);
      for (var p = 0; p < n; p += 2) see(bx + a[p], by + a[p + 1]);
      if (C === 'S') { cx2 = bx + a[0]; cy2 = by + a[1]; } else { cx2 = rx1; cy2 = ry1; }
      x = bx + a[n - 2]; y = by + a[n - 1]; curve = true;
    } else {
      for (var q = 0; q < n; q += 2) see(bx + a[q], by + a[q + 1]);
      if (C === 'C') { cx2 = bx + a[2]; cy2 = by + a[3]; curve = true; }
      if (C === 'Q') { cx2 = bx + a[0]; cy2 = by + a[1]; curve = true; }
      x = bx + a[n - 2]; y = by + a[n - 1];
      if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
    }
    if (!curve) { cx2 = cy2 = null; }
    prevC = C;
  }
  return box();
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
      var end = m.index + m[0].length, unsafe = false;
      if (!self) {
        /* its end tag, however it is written; anything else in between (it should hold nothing) and the
           path cannot be taken out on its own */
        var closeRe = /<\/(?:[\w-]+:)?path\s*>/gi; closeRe.lastIndex = end;
        var close = closeRe.exec(svg);
        if (close && !/</.test(svg.slice(end, close.index))) end = close.index + close[0].length; else unsafe = true;
      }
      if (d && !inDefs) {
        out.push({ start: m.index, end: end, box: pathBox(d), fill: attr(m[0], 'fill') || styleFill(attr(m[0], 'style')) || inheritedFill(stack),
          transformed: moved || stack.some(function (s) { return s.moved; }), unsafe: unsafe });
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
  if (!shapes.length || shapes.length > 12 || shapes.some(function (s) { return s.transformed || s.unsafe; })) return null;
  /* A shape that reaches round the box on every side, or runs most of its width, is not a digit: it is what
     the digits sit on or are cut out of (a badge, a pill, a frame) — and the digits are not shapes of their
     own to take out. */
  var tol = 0.02 * Math.min(box.width, box.height);
  if (shapes.some(function (s) {
    var b = s.box;
    return (b.x <= box.x + tol && b.y <= box.y + tol && b.x + b.width >= box.x + box.width - tol && b.y + b.height >= box.y + box.height - tol) ||
      b.width > box.width * 0.6;
  })) return null;
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
  /* they run the whole width that was read: a digit that is not a <path> of its own (a <polygon>, or one
     drawn in the same path as the letter beside it) would leave an end of the year uncovered */
  var edge = box.width * 0.15;
  if (Math.abs(found.x - box.x) > edge || Math.abs(found.x + found.width - (box.x + box.width)) > edge) return null;
  /* all one colour, and filled: the digits of a year are (one drawn only as an outline cannot be set as
     filled text) */
  var fills = shapes.map(function (s) { return String(s.fill || '').toLowerCase(); }).filter(function (f, i, l) { return l.indexOf(f) === i; });
  if (fills.length > 1 || fills[0] === 'none' || fills[0] === 'transparent') return null;
  return { shapes: shapes, box: found, fill: fills[0] || '#000000' };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* The drawing with the old year's shapes taken out (and nothing put in their place). */
function cutShapes(svg, found) {
  var out = String(svg);
  found.shapes.slice().sort(function (p, q) { return q.start - p.start; }).forEach(function (s) { out = out.slice(0, s.start) + out.slice(s.end); });
  return out;
}

/* The drawing with the old year's shapes taken out and the new year set where they stood, in o.fill (the
   colour the digits were seen drawn in) or else the colour they were given. */
function replaceYear(svg, found, o) {
  o = o || {};
  var out = cutShapes(svg, found), b = found.box, toYear = String(o.toYear || '');
  var given = o.fill || found.fill;
  var fill = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(given) && given !== 'none' ? given : '#000000';
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

module.exports = { pathBox, shapesIn, viewBoxOf, yearShapes, cutShapes, replaceYear };
