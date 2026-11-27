// Charts as vectors in the PDF (pdfEngine.ts): the SVG infographicEngine.renderInfographicToSvgString makes (the one
// BookCanvas shows) read into a list of shapes and texts and drawn with the PDF's own commands — its rect (rounded),
// circle, ellipse, line, polyline, polygon, path (M L H V C S Q T Z, absolute and relative), text, and g, with
// transforms (translate, rotate about a point, scale, matrix, skew), fills, strokes, dashes, line caps and joins,
// opacities, and text in the chart's font with its weight, letter spacing and anchor. Anything else in it (a gradient,
// a pattern, an arc, a nested picture…) is refused before anything is drawn, and pdfEngine draws that one chart as a
// 300-ppi picture instead, with a warning.
import { parseColor, type Rgba } from './color';

export class SvgUnsupported extends Error {
  constructor(what: string) {
    super(what);
    this.name = 'SvgUnsupported';
  }
}

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  // m then n (n applied after m in the parent's terms: the result maps a point by n's frame inside m's)
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/* ---------- reading the SVG ---------- */
export function parseSvg(svg: string): Node {
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  const root: Node = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: Node[] = [root];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    if (m[6]) throw new SvgUnsupported('a "<" that starts no tag');
    if (m[5] !== undefined) {
      const top = stack[stack.length - 1];
      if (top.tag === 'text') top.text += decode(m[5]);
      continue;
    }
    if (!m[2]) continue; // a comment or a declaration
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const top = stack.pop();
      if (!top || top.tag !== tag) throw new SvgUnsupported(`a </${tag}> that closes nothing`);
      continue;
    }
    const attrs: Record<string, string> = {};
    const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? '');
    if (attrs.style) {
      for (const decl of attrs.style.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const k = decl.slice(0, i).trim().toLowerCase();
        const v = decl.slice(i + 1).trim();
        if (k && !(k in attrs)) attrs[k] = v;
      }
    }
    const node: Node = { tag, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  if (stack.length !== 1) throw new SvgUnsupported('a tag left open');
  const svgNode = root.children.find((c) => c.tag === 'svg');
  if (!svgNode) throw new SvgUnsupported('no <svg>');
  return svgNode;
}

/* ---------- what is drawn ---------- */
export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

export interface PaintStyle {
  fill: Rgba | null;
  fillOpacity: number;
  stroke: Rgba | null;
  strokeOpacity: number;
  strokeWidth: number;
  dash: number[];
  dashOffset: number;
  cap: 0 | 1 | 2;
  join: 0 | 1 | 2;
  evenOdd: boolean;
}

export interface ShapeItem {
  kind: 'path';
  m: Mat;
  path: PathCmd[];
  paint: PaintStyle;
  /** a circle drawn as its dashes: arcs of [from, to] radians (clockwise from the right), stroked */
  arcs?: { cx: number; cy: number; r: number; spans: Array<[number, number]> };
}

export interface TextItem {
  kind: 'text';
  m: Mat;
  x: number;
  y: number;
  text: string;
  family: string;
  weight: number;
  italic: boolean;
  size: number;
  letterSpacing: number;
  anchor: 'start' | 'middle' | 'end';
  fill: Rgba | null;
  opacity: number;
}

export interface CompiledSvg {
  viewBox: { x: number; y: number; w: number; h: number };
  preserve: 'meet' | 'none';
  items: Array<ShapeItem | TextItem>;
}

const SHAPES = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const SKIP = new Set(['title', 'desc', 'metadata']);
const INHERITED = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-rule',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
];

function nums(s: string | undefined): number[] {
  if (!s) return [];
  return (s.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || []).map(Number);
}

function num(v: string | undefined, def: number): number {
  if (v === undefined || v === '') return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function parseTransform(t: string | undefined): Mat {
  let m: Mat = IDENTITY;
  if (!t) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let a: RegExpExecArray | null;
  let consumed = '';
  while ((a = re.exec(t))) {
    consumed += a[0];
    const v = nums(a[2]);
    let n: Mat;
    switch (a[1]) {
      case 'matrix':
        if (v.length !== 6) throw new SvgUnsupported('a matrix() without six numbers');
        n = [v[0], v[1], v[2], v[3], v[4], v[5]];
        break;
      case 'translate':
        n = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
        break;
      case 'scale':
        n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((v[0] || 0) * Math.PI) / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        const cx = v[1] || 0;
        const cy = v[2] || 0;
        n = mul(mul([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        n = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = mul(m, n);
  }
  if (consumed.replace(/\s|,/g, '') !== t.replace(/\s|,/g, '')) throw new SvgUnsupported(`the transform "${t}"`);
  return m;
}

function paintOf(v: string | undefined, def: Rgba | null): Rgba | null {
  if (v === undefined) return def;
  const s = v.trim();
  if (s === 'none' || s === 'transparent') return null;
  if (/^url\(/i.test(s)) throw new SvgUnsupported('a gradient or pattern fill');
  if (s === 'currentColor' || s === 'inherit') return def;
  const c = parseColor(s);
  if (!c) throw new SvgUnsupported(`the colour "${s}"`);
  return c;
}

function pathFromD(d: string): PathCmd[] {
  const out: PathCmd[] = [];
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let lastCtrl: [number, number] | null = null;
  let lastQ: [number, number] | null = null;
  const take = () => {
    const t = tokens[i++];
    const n = Number(t);
    if (t === undefined || !Number.isFinite(n)) throw new SvgUnsupported(`the path "${d.slice(0, 40)}"`);
    return n;
  };
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw new SvgUnsupported('a path without a command');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (C) {
      case 'M': {
        cx = ox + take();
        cy = oy + take();
        sx = cx;
        sy = cy;
        out.push(['M', cx, cy]);
        cmd = rel ? 'l' : 'L';
        lastCtrl = lastQ = null;
        break;
      }
      case 'L':
        cx = ox + take();
        cy = oy + take();
        out.push(['L', cx, cy]);
        lastCtrl = lastQ = null;
        break;
      case 'H':
        cx = (rel ? cx : 0) + take();
        out.push(['L', cx, cy]);
        lastCtrl = lastQ = null;
        break;
      case 'V':
        cy = (rel ? cy : 0) + take();
        out.push(['L', cx, cy]);
        lastCtrl = lastQ = null;
        break;
      case 'C': {
        const x1 = ox + take();
        const y1 = oy + take();
        const x2 = ox + take();
        const y2 = oy + take();
        cx = ox + take();
        cy = oy + take();
        out.push(['C', x1, y1, x2, y2, cx, cy]);
        lastCtrl = [x2, y2];
        lastQ = null;
        break;
      }
      case 'S': {
        const x1 = lastCtrl ? 2 * cx - lastCtrl[0] : cx;
        const y1 = lastCtrl ? 2 * cy - lastCtrl[1] : cy;
        const x2 = ox + take();
        const y2 = oy + take();
        const ex = ox + take();
        const ey = oy + take();
        out.push(['C', x1, y1, x2, y2, ex, ey]);
        cx = ex;
        cy = ey;
        lastCtrl = [x2, y2];
        lastQ = null;
        break;
      }
      case 'Q':
      case 'T': {
        let qx: number;
        let qy: number;
        if (C === 'Q') {
          qx = ox + take();
          qy = oy + take();
        } else {
          qx = lastQ ? 2 * cx - lastQ[0] : cx;
          qy = lastQ ? 2 * cy - lastQ[1] : cy;
        }
        const ex = ox + take();
        const ey = oy + take();
        out.push(['C', cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
        cx = ex;
        cy = ey;
        lastQ = [qx, qy];
        lastCtrl = null;
        break;
      }
      case 'Z':
        out.push(['Z']);
        cx = sx;
        cy = sy;
        lastCtrl = lastQ = null;
        break;
      default:
        throw new SvgUnsupported(`the path command "${cmd}"`);
    }
    if (C === 'Z' && isNum()) throw new SvgUnsupported('numbers after a Z');
  }
  return out;
}

const K = 0.5522847498307936;
function ellipsePath(cx: number, cy: number, rx: number, ry: number): PathCmd[] {
  const kx = rx * K;
  const ky = ry * K;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ];
}

function roundRectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): PathCmd[] {
  const a = Math.max(0, Math.min(rx, w / 2));
  const b = Math.max(0, Math.min(ry, h / 2));
  if (!(a > 0 && b > 0)) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  const ka = a * (1 - K);
  const kb = b * (1 - K);
  return [
    ['M', x + a, y],
    ['L', x + w - a, y],
    ['C', x + w - ka, y, x + w, y + kb, x + w, y + b],
    ['L', x + w, y + h - b],
    ['C', x + w, y + h - kb, x + w - ka, y + h, x + w - a, y + h],
    ['L', x + a, y + h],
    ['C', x + ka, y + h, x, y + h - kb, x, y + h - b],
    ['L', x, y + b],
    ['C', x, y + kb, x + ka, y, x + a, y],
    ['Z'],
  ];
}

function points(s: string | undefined, close: boolean): PathCmd[] {
  const v = nums(s);
  if (v.length < 4 || v.length % 2) throw new SvgUnsupported('a polyline without pairs of numbers');
  const out: PathCmd[] = [['M', v[0], v[1]]];
  for (let i = 2; i < v.length; i += 2) out.push(['L', v[i], v[i + 1]]);
  if (close) out.push(['Z']);
  return out;
}

/* a circle's dashes as arcs, when the pattern is one dash and one gap (a donut's segment, a gauge's arc) */
function dashArcs(r: number, dash: number[], offset: number): Array<[number, number]> | null {
  if (dash.length !== 2 || !(r > 0)) return null;
  const circ = 2 * Math.PI * r;
  const [on, off] = dash;
  if (!(on >= 0) || !(off >= 0) || Math.abs(on + off - circ) > circ * 0.01) return null;
  // the dash starts `offset` into the pattern: drawn from -offset along the circle
  let start = -offset;
  start = ((start % circ) + circ) % circ;
  const a0 = (start / circ) * 2 * Math.PI;
  const span = (Math.min(on, circ) / circ) * 2 * Math.PI;
  return span > 1e-6 ? [[a0, a0 + span]] : [];
}

/** the SVG read into what to draw, or SvgUnsupported */
export function compileSvg(svg: string): CompiledSvg {
  const root = parseSvg(svg);
  const vb = nums(root.attrs.viewbox);
  const w = num(root.attrs.width, 300);
  const h = num(root.attrs.height, 150);
  const viewBox = vb.length === 4 ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } : { x: 0, y: 0, w, h };
  const par = String(root.attrs.preserveaspectratio || '').trim();
  if (par && par !== 'xMidYMid meet' && par !== 'xMidYMid' && par !== 'none') throw new SvgUnsupported(`preserveAspectRatio "${par}"`);
  const items: Array<ShapeItem | TextItem> = [];
  const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

  const walk = (node: Node, m: Mat, inh: Record<string, string>, opacity: number) => {
    for (const child of node.children) {
      if (SKIP.has(child.tag)) continue;
      const a = child.attrs;
      const style: Record<string, string> = { ...inh };
      for (const k of INHERITED) if (a[k] !== undefined && a[k] !== 'inherit') style[k] = a[k];
      if (a.clip || a['clip-path'] || a.mask || a.filter) throw new SvgUnsupported('a clip, mask or filter');
      const cm = mul(m, parseTransform(a.transform));
      const op = opacity * Math.max(0, Math.min(1, num(a.opacity, 1)));
      if (child.tag === 'g') {
        walk(child, cm, style, op);
        continue;
      }
      if (child.tag === 'text') {
        if (child.children.length) throw new SvgUnsupported('text inside a <text> (tspan)');
        const content = child.text.replace(/\s+/g, ' ').trim();
        if (!content) continue;
        const size = num(style['font-size'], 16);
        const lsRaw = String(style['letter-spacing'] || '0').trim();
        const ls = lsRaw.endsWith('em') ? parseFloat(lsRaw) * size : lsRaw === 'normal' ? 0 : num(lsRaw.replace(/px$/, ''), 0);
        const weightRaw = String(style['font-weight'] || '400');
        const weight = weightRaw === 'bold' ? 700 : weightRaw === 'normal' ? 400 : num(weightRaw, 400);
        const family = String(style['font-family'] || '').split(',')[0].replace(/["']/g, '').trim();
        const anchor = (style['text-anchor'] as TextItem['anchor']) || 'start';
        if (!['start', 'middle', 'end'].includes(anchor)) throw new SvgUnsupported(`text-anchor "${anchor}"`);
        if (a.dx || a.dy || a.rotate || a.textlength) throw new SvgUnsupported('text with dx, dy, rotate or textLength');
        const xs = nums(a.x);
        const ys = nums(a.y);
        if (xs.length > 1 || ys.length > 1) throw new SvgUnsupported('text with several x or y');
        items.push({
          kind: 'text',
          m: cm,
          x: xs[0] || 0,
          y: ys[0] || 0,
          text: content,
          family,
          weight,
          italic: /italic|oblique/.test(String(style['font-style'] || '')),
          size,
          letterSpacing: ls,
          anchor,
          fill: paintOf(style.fill, BLACK),
          opacity: op * Math.max(0, Math.min(1, num(style['fill-opacity'], 1))),
        });
        continue;
      }
      if (!SHAPES.has(child.tag)) throw new SvgUnsupported(`<${child.tag}>`);
      const paint: PaintStyle = {
        fill: paintOf(style.fill, BLACK),
        fillOpacity: op * Math.max(0, Math.min(1, num(style['fill-opacity'], 1))),
        stroke: paintOf(style.stroke, null),
        strokeOpacity: op * Math.max(0, Math.min(1, num(style['stroke-opacity'], 1))),
        strokeWidth: Math.max(0, num(style['stroke-width'], 1)),
        dash: style['stroke-dasharray'] && style['stroke-dasharray'] !== 'none' ? nums(style['stroke-dasharray']) : [],
        dashOffset: num(style['stroke-dashoffset'], 0),
        cap: style['stroke-linecap'] === 'round' ? 1 : style['stroke-linecap'] === 'square' ? 2 : 0,
        join: style['stroke-linejoin'] === 'round' ? 1 : style['stroke-linejoin'] === 'bevel' ? 2 : 0,
        evenOdd: style['fill-rule'] === 'evenodd',
      };
      if (paint.dash.length % 2) paint.dash = [...paint.dash, ...paint.dash];
      if (paint.dash.length && paint.dash.every((d) => d === 0)) paint.dash = [];
      let path: PathCmd[];
      let arcs: ShapeItem['arcs'];
      switch (child.tag) {
        case 'rect': {
          const x = num(a.x, 0);
          const y = num(a.y, 0);
          const rw = num(a.width, 0);
          const rh = num(a.height, 0);
          if (!(rw > 0 && rh > 0)) continue;
          const rx = a.rx !== undefined ? num(a.rx, 0) : a.ry !== undefined ? num(a.ry, 0) : 0;
          const ry = a.ry !== undefined ? num(a.ry, 0) : rx;
          path = roundRectPath(x, y, rw, rh, rx, ry);
          break;
        }
        case 'circle': {
          const r = num(a.r, 0);
          if (!(r > 0)) continue;
          const cx = num(a.cx, 0);
          const cy = num(a.cy, 0);
          path = ellipsePath(cx, cy, r, r);
          if (paint.dash.length) {
            const spans = dashArcs(r, paint.dash, paint.dashOffset);
            if (spans) arcs = { cx, cy, r, spans };
          }
          break;
        }
        case 'ellipse': {
          const rx = num(a.rx, 0);
          const ry = num(a.ry, 0);
          if (!(rx > 0 && ry > 0)) continue;
          path = ellipsePath(num(a.cx, 0), num(a.cy, 0), rx, ry);
          break;
        }
        case 'line':
          path = [
            ['M', num(a.x1, 0), num(a.y1, 0)],
            ['L', num(a.x2, 0), num(a.y2, 0)],
          ];
          break;
        case 'polyline':
          path = points(a.points, false);
          break;
        case 'polygon':
          path = points(a.points, true);
          break;
        default:
          path = pathFromD(a.d || '');
      }
      /* a line or polyline is never filled */
      if (child.tag === 'line') paint.fill = null;
      items.push({ kind: 'path', m: cm, path, paint, ...(arcs ? { arcs } : {}) });
    }
  };
  const rootStyle: Record<string, string> = {};
  for (const k of INHERITED) if (root.attrs[k] !== undefined) rootStyle[k] = root.attrs[k];
  walk(root, IDENTITY, rootStyle, Math.max(0, Math.min(1, num(root.attrs.opacity, 1))));
  return { viewBox, preserve: par === 'none' ? 'none' : 'meet', items };
}

/** the faces a compiled chart's texts use */
export function svgFaces(c: CompiledSvg, fallbackFamily: string): Array<{ family: string; weight: number; italic: boolean }> {
  const seen = new Map<string, { family: string; weight: number; italic: boolean }>();
  for (const it of c.items) {
    if (it.kind !== 'text') continue;
    const family = it.family || fallbackFamily;
    const f = { family, weight: Math.round(it.weight), italic: it.italic };
    seen.set(`${family}|${f.weight}|${f.italic}`, f);
  }
  return Array.from(seen.values());
}
