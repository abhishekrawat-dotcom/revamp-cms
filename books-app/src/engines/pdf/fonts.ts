// The fonts of the vector PDF (pdfEngine.ts): which face each piece of text is drawn with, the file of that face
// (GET /api/books/font-file, the server's Google Fonts copy), embedded as a subset (pdf-lib + fontkit), and the glyphs
// of a run of text with their own advances and kerning, so pdfEngine can place every word where the editor's
// layout puts it.
//
// Which face: the one the browser draws the editor's canvas with. The browser picks among the faces its stylesheets
// declare for the family (document.fonts) by the CSS font-matching rules, and makes up a bold or an italic it does not
// have (Chrome: a bold outline for 600 and over when the face is under 600; a slant of a quarter for an italic). The PDF
// follows the same choice, so its words have the widths the layout was measured with. Where the browser declares
// nothing for the family (a test; a font that never loaded), the server's faces are matched the same way. A weight or
// italic that isn't the one asked for is said in a warning ("Lora 450 drawn with Lora 500"); a family that can't be
// embedded is a PdfFontError in a print PDF, and a standard font with a warning in a review PDF.
import fontkit from '@pdf-lib/fontkit';
import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';

export interface FaceRequest {
  family: string;
  weight: number;
  italic: boolean;
}

/** a face a stylesheet declares: its weight (or weight range, for a variable font) and style */
export interface FaceDecl {
  min: number;
  max: number;
  italic: boolean;
}

export interface PdfFontReport {
  family: string;
  weight: number;
  italic: boolean;
  embedded: boolean;
  reason?: string;
}

export interface FetchAnswer {
  status: number;
  bytes?: Uint8Array;
  json?: Record<string, unknown> | null;
  header?: (name: string) => string | null;
}

export interface FontEnv {
  /** the faces the browser's stylesheets declare for `family` ([] when none, or no browser) */
  browserFaces(family: string): FaceDecl[];
  /** GET from EventSphere (signed in) */
  get(url: string, signal?: AbortSignal): Promise<FetchAnswer>;
}

/** a font file embedded in the PDF */
export interface PdfFace {
  family: string;
  weight: number;
  italic: boolean;
  font: PDFFont;
  /** the fontkit font (null for a standard font) */
  fk: FkFont | null;
  standard: boolean;
  /** ascent and descent as fractions of the size (the font's hhea lines: the box CSS lines use) */
  ascent: number;
  descent: number;
  /** characters the face has no glyph for, with a page they're on */
  missing: Map<string, number>;
}

/** how a request is drawn */
export interface FaceUse {
  face: PdfFace;
  syntheticBold: boolean;
  syntheticItalic: boolean;
}

/** a run of text as glyphs: codes for TJ, each glyph's advance and the kerning after it (fractions of the size) */
export interface GlyphRun {
  codes: string[];
  adv: number[];
  kern: number[];
  /** the run's width as the font sets it (fractions of the size), letter spacing not included */
  width: number;
}

/* the parts of fontkit and pdf-lib's embedder this uses (neither declares them) */
interface FkGlyph {
  id: number;
  advanceWidth: number;
  codePoints: number[];
}
interface FkFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  layout(text: string, features?: Record<string, boolean>): { glyphs: FkGlyph[]; positions: Array<{ xAdvance: number; xOffset: number }> };
  hasGlyphForCodePoint(cp: number): boolean;
}
interface SubsetEmbedder {
  font: FkFont;
  subset: { includeGlyph(g: FkGlyph): number };
  glyphs: FkGlyph[];
  glyphIdMap: Map<number, number>;
  glyphCache: { invalidate(): void };
}

/** the optical size the PDF asks for: none (0). The editor loads every family from the Google Fonts CSS2 API without an
    opsz axis (fontEngine.ts), so the browser draws and measures each family's default cut at every size; asked without
    one, the font-file route answers that same file. (Asking for opsz 64 embedded Source Serif 4's and Bodoni Moda's
    display cut, whose widths are up to 23% different: the words were then stretched to the measured widths — browser
    QA, 27 Nov 2026.) If the editor ever loads an opsz axis, ask for the size it draws at, in both places. */
export const MEASURED_OPTICAL_SIZE = 0;

/* a subset's PDF name must be a six-letter tag, "+", then the font's PostScript name (ISO 32000-1 §9.6.4): printers'
   preflight tools read the tag to know the font is a subset. The tag is made from the face, so it is the same face
   to face and different between faces in one file. */
function subsetTag(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  let tag = '';
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = (Math.floor(h / 26) ^ Math.imul(h, 2654435761)) >>> 0;
  }
  return tag;
}

const NO_LIGATURES = { liga: false, clig: false, dlig: false, hlig: false };

export function styleName(f: { family: string; weight: number; italic: boolean }): string {
  return `${f.family} ${Math.round(f.weight)}${f.italic ? ' italic' : ''}`;
}

/* ---------- CSS font matching (CSS Fonts 4, §5.2: style first, then weight) ---------- */
export function cssMatch(decls: FaceDecl[], want: { weight: number; italic: boolean }): { decl: FaceDecl; weight: number } | null {
  if (!decls.length) return null;
  const sameStyle = decls.filter((d) => d.italic === want.italic);
  const pool = sameStyle.length ? sameStyle : decls;
  const w = want.weight;
  const inside = pool.find((d) => d.min <= w && w <= d.max);
  if (inside) return { decl: inside, weight: w };
  /* each face at its weight nearest the one wanted */
  const at = pool.map((d) => ({ decl: d, weight: d.max < w ? d.max : d.min }));
  const below = at.filter((c) => c.weight < w).sort((a, b) => b.weight - a.weight);
  const above = at.filter((c) => c.weight > w).sort((a, b) => a.weight - b.weight);
  let order: typeof at;
  if (w >= 400 && w <= 500) {
    const upTo500 = above.filter((c) => c.weight <= 500);
    order = [...upTo500, ...below, ...above.filter((c) => c.weight > 500)];
  } else if (w < 400) order = [...below, ...above];
  else order = [...above, ...below];
  return order[0] || null;
}

/** the faces a family's server answer lists: each weight upright, and italic too when it has italics */
export function declsFromWeights(weights: number[], italic: boolean): FaceDecl[] {
  const out: FaceDecl[] = [];
  for (const w of weights) {
    out.push({ min: w, max: w, italic: false });
    if (italic) out.push({ min: w, max: w, italic: true });
  }
  return out;
}

/* ---------- the browser's own faces ---------- */
function weightRange(v: string): [number, number] | null {
  const parts = String(v || '400')
    .trim()
    .split(/\s+/)
    .map((p) => (p === 'normal' ? 400 : p === 'bold' ? 700 : Number(p)));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return [Math.min(...parts), Math.max(...parts)];
}

export function browserFaceDecls(family: string): FaceDecl[] {
  const set = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!set || typeof (set as unknown as { forEach?: unknown }).forEach !== 'function') return [];
  const want = family.trim().toLowerCase();
  const out: FaceDecl[] = [];
  const seen = new Set<string>();
  set.forEach((face: FontFace) => {
    const fam = String(face.family || '').replace(/^["']|["']$/g, '').trim().toLowerCase();
    if (fam !== want) return;
    const r = weightRange(face.weight);
    if (!r) return;
    const italic = /italic|oblique/.test(String(face.style || ''));
    const key = `${r[0]}|${r[1]}|${italic}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ min: r[0], max: r[1], italic });
  });
  return out;
}

/* ---------- the fonts of one PDF ---------- */
interface Resolved {
  use: FaceUse | null;
  /** why it isn't drawn as asked (a different weight, a made-up style), or why it can't be embedded */
  note: string;
  failure: string;
}

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, '0');
}

export class FontBook {
  readonly warnings: string[] = [];
  private resolved = new Map<string, Resolved>();
  private requests = new Map<string, FaceRequest>();
  private files = new Map<string, Promise<PdfFace | { error: string; code: string; weights?: number[]; italic?: boolean }>>();
  private faces: PdfFace[] = [];
  private standard = new Map<string, PdfFace>();
  private registered = false;

  constructor(
    private readonly doc: PDFDocument,
    private readonly env: FontEnv,
    private readonly opsz: number = MEASURED_OPTICAL_SIZE
  ) {}

  private key(r: FaceRequest): string {
    return `${r.family.trim().toLowerCase()}|${Math.round(r.weight)}|${r.italic ? 1 : 0}`;
  }

  /* one file from the server, embedded once */
  private file(family: string, weight: number, italic: boolean, signal?: AbortSignal) {
    const k = `${family.toLowerCase()}|${weight}|${italic ? 1 : 0}`;
    let p = this.files.get(k);
    if (!p) {
      p = (async () => {
        const url = `/api/books/font-file?family=${encodeURIComponent(family)}&weight=${weight}&italic=${italic ? 1 : 0}${this.opsz > 0 ? `&opsz=${this.opsz}` : ''}`;
        let ans: FetchAnswer;
        try {
          ans = await this.env.get(url, signal);
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') throw err;
          return { error: "it couldn't be downloaded (check the connection)", code: 'network' };
        }
        if (ans.status === 200 && ans.bytes && ans.bytes.length) {
          try {
            if (!this.registered) {
              this.doc.registerFontkit(fontkit as never);
              this.registered = true;
            }
            const font = await this.doc.embedFont(ans.bytes, { subset: true });
            const emb = (font as unknown as { embedder: SubsetEmbedder & { customName?: string } }).embedder;
            hardenSubset(emb);
            const fk = emb.font;
            /* named before it is written into the file (pdf-lib reads customName when it embeds the font) */
            const ps = String((fk as unknown as { postscriptName?: string }).postscriptName || `${family}-${weight}${italic ? 'Italic' : ''}`).replace(/[^A-Za-z0-9-]/g, '');
            emb.customName = `${subsetTag(`${ps}|${weight}|${italic ? 1 : 0}`)}+${ps}`;
            const upm = fk.unitsPerEm || 1000;
            const face: PdfFace = {
              family,
              weight,
              italic,
              font,
              fk,
              standard: false,
              ascent: (fk.ascent || upm * 0.8) / upm,
              descent: Math.abs(fk.descent || -upm * 0.2) / upm,
              missing: new Map(),
            };
            this.faces.push(face);
            return face;
          } catch {
            return { error: "its file couldn't be read as a font", code: 'unreadable' };
          }
        }
        const json = ans.json || {};
        const code = String(json.code || (ans.status === 404 ? 'font-weight' : 'server'));
        return {
          error: String(json.error || `the server answered ${ans.status}`),
          code,
          weights: Array.isArray(json.weights) ? (json.weights as unknown[]).map(Number).filter((n) => n > 0) : undefined,
          italic: typeof json.italic === 'boolean' ? (json.italic as boolean) : undefined,
        };
      })();
      this.files.set(k, p);
    }
    return p;
  }

  private async resolve(r: FaceRequest, signal?: AbortSignal): Promise<Resolved> {
    const asked = styleName(r);
    /* the browser's choice, when it declares the family */
    const decls = this.env.browserFaces(r.family);
    let weight = Math.round(r.weight);
    let italic = r.italic;
    let byBrowser = false;
    if (decls.length) {
      const m = cssMatch(decls, r);
      if (m) {
        weight = Math.round(m.weight);
        italic = m.decl.italic;
        byBrowser = true;
      }
    }
    let got = await this.file(r.family, weight, italic, signal);
    /* the server has no such face: the nearest it has, as a browser would choose (a few tries at most) */
    if (!('font' in got) && got.code === 'font-weight' && got.weights && got.weights.length) {
      const tried = new Set<string>([`${weight}|${italic}`]);
      let pool = declsFromWeights(got.weights, !!got.italic);
      for (let attempt = 0; attempt < 4 && !('font' in got); attempt++) {
        pool = pool.filter((d) => !tried.has(`${d.min}|${d.italic}`));
        const m = cssMatch(pool, { weight, italic });
        if (!m) break;
        tried.add(`${m.weight}|${m.decl.italic}`);
        const next = await this.file(r.family, m.weight, m.decl.italic, signal);
        if ('font' in next) {
          weight = m.weight;
          italic = m.decl.italic;
          byBrowser = false;
        }
        got = next;
      }
    }
    if (!('font' in got)) {
      const why =
        got.code === 'font-family'
          ? `${r.family} isn't a Google font, so it can't be embedded`
          : got.code === 'font-weight'
            ? `${r.family} has no style close to ${asked.slice(r.family.length + 1)} that can be embedded`
            : got.error;
      return { use: null, note: '', failure: why };
    }
    const face = got;
    const syntheticItalic = r.italic && !face.italic;
    const syntheticBold = r.weight >= 600 && face.weight < 600;
    let note = '';
    if (face.weight !== Math.round(r.weight) || face.italic !== r.italic) {
      const drawn = styleName(face);
      const how = [syntheticBold ? 'emboldened' : '', syntheticItalic ? 'slanted' : ''].filter(Boolean).join(' and ');
      const where = byBrowser ? ', the face the editor shows' : '';
      note = `${asked} drawn with ${drawn}${how ? ` (${how}, as a browser does)` : ''}${where}`;
    }
    return { use: { face, syntheticBold, syntheticItalic }, note, failure: '' };
  }

  /** fetches and embeds every face asked for (several at a time) */
  async load(requests: FaceRequest[], signal?: AbortSignal): Promise<void> {
    const unique = new Map<string, FaceRequest>();
    for (const r of requests) if (r.family && r.family.trim()) unique.set(this.key(r), { family: r.family.trim(), weight: Math.round(r.weight) || 400, italic: !!r.italic });
    unique.forEach((r, k) => this.requests.set(k, r));
    const list = Array.from(unique.entries());
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const [k, r] = list[next++];
        const res = await this.resolve(r, signal);
        this.resolved.set(k, res);
        if (res.note) this.warnings.push(res.note);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  /** how a frame's font is drawn: null when it can't be embedded (before fallback) */
  use(family: string, weight: number, italic: boolean): FaceUse | null {
    const r = this.resolved.get(this.key({ family: family || '', weight: Math.round(weight) || 400, italic: !!italic }));
    return r ? r.use : null;
  }

  /** the requests that can't be embedded, with why (as the book names them) */
  failures(): PdfFontReport[] {
    const out: PdfFontReport[] = [];
    this.resolved.forEach((res, k) => {
      if (res.use) return;
      const r = this.requests.get(k);
      if (r) out.push({ family: r.family, weight: r.weight, italic: r.italic, embedded: false, reason: res.failure });
    });
    return out;
  }

  /** a standard font for a review PDF's text whose font can't be embedded (Helvetica, by weight and style) */
  async fallback(weight: number, italic: boolean): Promise<FaceUse> {
    const bold = weight >= 600;
    const name = bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
    let face = this.standard.get(name);
    if (!face) {
      const font = await this.doc.embedFont(name);
      face = { family: 'Helvetica', weight: bold ? 700 : 400, italic, font, fk: null, standard: true, ascent: 0.718, descent: 0.207, missing: new Map() };
      this.standard.set(name, face);
    }
    return { face, syntheticBold: false, syntheticItalic: false };
  }

  /** the faces embedded (each once), for the report: what each stands in for when it isn't what was asked */
  reports(): PdfFontReport[] {
    const out: PdfFontReport[] = [];
    for (const face of this.faces) {
      const standsIn: string[] = [];
      this.resolved.forEach((res, k) => {
        const r = this.requests.get(k);
        if (!r || !res.use || res.use.face !== face) return;
        if (r.weight !== face.weight || r.italic !== face.italic) standsIn.push(styleName(r));
      });
      const used = Array.from(this.resolved.values()).some((r) => r.use && r.use.face === face);
      if (!used) continue;
      out.push({
        family: face.family,
        weight: face.weight,
        italic: face.italic,
        embedded: true,
        ...(standsIn.length ? { reason: `also draws ${standsIn.join(', ')}` } : {}),
      });
    }
    return [...out, ...this.failures()];
  }

  /** an embedded face to set the slug line in (the first the book uses), or null */
  anyFace(): PdfFace | null {
    return this.faces[0] || null;
  }

  /** missing glyphs, as warnings */
  missingWarnings(): string[] {
    const out: string[] = [];
    for (const face of [...this.faces, ...this.standard.values()]) {
      if (!face.missing.size) continue;
      const chars = Array.from(face.missing.keys()).slice(0, 8).join(' ');
      const page = Math.min(...face.missing.values());
      out.push(
        `${styleName(face)} has no glyph for ${chars}${face.missing.size > 8 ? ' …' : ''} (first on page ${page}): ${face.missing.size === 1 ? 'it prints' : 'they print'} as a box`
      );
    }
    return out;
  }
}

/* ---------- two faults of @pdf-lib/fontkit 1.1.1, mended where the font is embedded ----------
   1. Its TrueType subset copies each glyph's bytes as they are and, when the subset is small, writes the short loca
      table (offsets ÷ 2): a glyph of an odd number of bytes then shifts every glyph after it, and they print blank or
      broken (Cormorant Garamond does this). Each glyph is padded to 4 bytes here, as the OpenType spec asks and later
      fontkit releases do.
   2. Reading the box of an empty glyph (a space) that is the last one in the glyf table reads past its end and
      throws; such a glyph's box is empty. */
interface FkSubsetInternals {
  glyf: Uint8Array[];
  offset: number;
  _addGlyph(gid: number): number;
  __padded?: boolean;
}
interface FkGlyphProto {
  _getCBox(internal?: boolean): unknown;
  __safe?: boolean;
}
function hardenSubset(emb: SubsetEmbedder): void {
  const sub = emb.subset as unknown as FkSubsetInternals;
  if (sub && typeof sub._addGlyph === 'function' && !sub.__padded) {
    const add = sub._addGlyph;
    sub._addGlyph = function (this: FkSubsetInternals, gid: number) {
      const index = add.call(this, gid);
      const last = this.glyf.length - 1;
      const buf = this.glyf[last];
      const pad = buf ? (4 - (buf.length % 4)) % 4 : 0;
      if (pad) {
        const Ctor = buf.constructor as unknown as { alloc?: (n: number) => Uint8Array };
        const out = typeof Ctor.alloc === 'function' ? Ctor.alloc(buf.length + pad) : new Uint8Array(buf.length + pad);
        out.set(buf, 0);
        this.glyf[last] = out;
        this.offset += pad;
      }
      return index;
    };
    sub.__padded = true;
  }
  try {
    const proto = Object.getPrototypeOf((emb.font as unknown as { getGlyph(id: number): object }).getGlyph(0)) as FkGlyphProto;
    if (proto && typeof proto._getCBox === 'function' && !proto.__safe) {
      const box = proto._getCBox;
      proto._getCBox = function (this: FkGlyphProto, internal?: boolean) {
        try {
          return box.call(this, internal);
        } catch (err) {
          if (err instanceof RangeError) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
          throw err;
        }
      };
      proto.__safe = true;
    }
  } catch {
    /* a font without glyph 0's box: nothing to mend */
  }
}

/* ---------- glyph runs ---------- */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/**
 * The glyphs of `text` in a face: codes for a TJ and each glyph's advance and the kerning after it (fractions of the
 * size). Glyphs used are added to the face's subset. noLigatures: letter-spaced text, which a browser sets without
 * ligatures. A character the face lacks is drawn as its empty box and remembered (with `page`) for a warning.
 */
export function shapeRun(face: PdfFace, text: string, noLigatures: boolean, page: number): GlyphRun {
  const run: GlyphRun = { codes: [], adv: [], kern: [], width: 0 };
  if (!text) return run;
  if (face.standard || !face.fk) {
    for (const ch of Array.from(text)) {
      const cp = ch.codePointAt(0) || 63;
      let use = ch;
      if (!(cp >= 32 && cp <= 126) && !(cp >= 160 && cp <= 255) && !WIN_ANSI_EXTRA.includes(ch)) {
        if (!/\s/.test(ch)) face.missing.set(ch, Math.min(face.missing.get(ch) ?? page, page));
        use = /\s/.test(ch) ? ' ' : '?';
      }
      const code = face.font.encodeText(use).toString().replace(/[<>]/g, '');
      const w = face.font.widthOfTextAtSize(use, 1);
      run.codes.push(code);
      run.adv.push(w);
      run.kern.push(0);
      run.width += w;
    }
    return run;
  }
  const emb = (face.font as unknown as { embedder: SubsetEmbedder }).embedder;
  const fk = face.fk;
  const upm = fk.unitsPerEm || 1000;
  /* characters the face has no glyph for (fontkit gives them all one .notdef, so each is looked up itself) */
  for (const ch of text) {
    const cp = ch.codePointAt(0) || 0;
    if (cp > 32 && !/\s/.test(ch) && !fk.hasGlyphForCodePoint(cp)) face.missing.set(ch, Math.min(face.missing.get(ch) ?? page, page));
  }
  const laid = fk.layout(text, noLigatures ? NO_LIGATURES : undefined);
  for (let i = 0; i < laid.glyphs.length; i++) {
    const g = laid.glyphs[i];
    const pos = laid.positions[i] || { xAdvance: g.advanceWidth, xOffset: 0 };
    const sid = emb.subset.includeGlyph(g);
    emb.glyphs[sid - 1] = g;
    emb.glyphIdMap.set(g.id, sid);
    run.codes.push(hex4(sid));
    const adv = g.advanceWidth / upm;
    const kern = (pos.xAdvance - g.advanceWidth) / upm;
    run.adv.push(adv);
    run.kern.push(kern);
    run.width += adv + kern;
  }
  emb.glyphCache.invalidate();
  return run;
}
