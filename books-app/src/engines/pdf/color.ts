// Colours for the vector PDF (pdfEngine.ts): what CSS would paint, as RGB 0..1 and an alpha. The PDF is RGB: the
// browser cannot make CMYK, and the export says so.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
  maroon: '#800000',
  teal: '#008080',
  olive: '#808000',
  purple: '#800080',
  orange: '#ffa500',
  yellow: '#ffff00',
  gold: '#ffd700',
  beige: '#f5f5dc',
  ivory: '#fffff0',
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** a CSS colour as RGB and alpha; null for none, transparent, or one it can't read */
export function parseColor(input: string | undefined | null): Rgba | null {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;
  if (NAMED[s]) s = NAMED[s];
  if (s[0] === '#') {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) {
      const v = h.split('').map((c) => parseInt(c + c, 16));
      return { r: v[0] / 255, g: v[1] / 255, b: v[2] / 255, a: h.length === 4 ? v[3] / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2) || 'ff', 16));
      return { r: v[0] / 255, g: v[1] / 255, b: v[2] / 255, a: h.length === 8 ? v[3] / 255 : 1 };
    }
    return null;
  }
  const m = /^rgba?\(\s*([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const [r, g, b] = parts.slice(0, 3).map(ch);
    let a = 1;
    if (parts[3] !== undefined) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (![r, g, b, a].every(Number.isFinite)) return null;
    return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), a: clamp01(a) };
  }
  return null;
}

export function isOpaque(c: Rgba | null): boolean {
  return !!c && c.a >= 0.999;
}
