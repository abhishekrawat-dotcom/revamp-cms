// The drawing commands of one PDF page (pdfEngine.ts), written straight into its content stream: paths, clips,
// colours with their opacity, text runs with per-glyph positions (TJ), pictures. pdfEngine first maps each design
// page's millimetres onto the sheet with one transform (y down, as the canvas), so everything here is in mm.
import {
  PDFArray,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames as Op,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import type { Rgba } from './color';

export const PT_PER_MM = 72 / 25.4;
/* the Bézier handle for a quarter circle */
export const KAPPA = 0.5522847498307936;

type Arg = PDFNumber | PDFName | PDFHexString | PDFArray;

/** one item of a TJ array: glyph codes (hex), or a shift in thousandths of the font size (positive moves left) */
export type TjItem = string | number;

export class Draw {
  private ops: PDFOperator[] = [];
  private gsKeys = new Map<string, PDFName>();
  private fontKeys = new Map<PDFRef, PDFName>();
  private imageKeys = new Map<PDFRef, PDFName>();
  /** what was drawn: counted for the tests and the progress line */
  drawn = { paths: 0, texts: 0, images: 0 };

  constructor(
    readonly doc: PDFDocument,
    readonly page: PDFPage
  ) {}

  private num(v: number): PDFNumber {
    const r = Math.round(v * 10000) / 10000;
    return PDFNumber.of(Object.is(r, -0) || !Number.isFinite(r) ? 0 : r);
  }

  private push(name: Op, args: Arg[] = []): void {
    this.ops.push(PDFOperator.of(name, args));
  }

  private nums(name: Op, ...v: number[]): void {
    this.push(
      name,
      v.map((x) => this.num(x))
    );
  }

  save(): void {
    this.push(Op.PushGraphicsState);
  }
  restore(): void {
    this.push(Op.PopGraphicsState);
  }
  cm(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.nums(Op.ConcatTransformationMatrix, a, b, c, d, e, f);
  }
  translate(x: number, y: number): void {
    if (x || y) this.cm(1, 0, 0, 1, x, y);
  }
  /** turns what follows by `deg` clockwise (the page's y runs down) about (cx, cy), as CSS rotate() does */
  rotateAbout(cx: number, cy: number, deg: number): void {
    if (!deg) return;
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    this.cm(1, 0, 0, 1, cx, cy);
    this.cm(c, s, -s, c, 0, 0);
    this.cm(1, 0, 0, 1, -cx, -cy);
  }

  /* ---------- paths ---------- */
  moveTo(x: number, y: number): void {
    this.nums(Op.MoveTo, x, y);
  }
  lineTo(x: number, y: number): void {
    this.nums(Op.LineTo, x, y);
  }
  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.nums(Op.AppendBezierCurve, x1, y1, x2, y2, x, y);
  }
  close(): void {
    this.push(Op.ClosePath);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.nums(Op.AppendRectangle, x, y, w, h);
  }
  /** a rectangle with corners rounded by r (taken down to what fits, as CSS does) */
  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    if (!(rr > 0.0005)) return this.rect(x, y, w, h);
    const k = rr * (1 - KAPPA);
    this.moveTo(x + rr, y);
    this.lineTo(x + w - rr, y);
    this.curveTo(x + w - k, y, x + w, y + k, x + w, y + rr);
    this.lineTo(x + w, y + h - rr);
    this.curveTo(x + w, y + h - k, x + w - k, y + h, x + w - rr, y + h);
    this.lineTo(x + rr, y + h);
    this.curveTo(x + k, y + h, x, y + h - k, x, y + h - rr);
    this.lineTo(x, y + rr);
    this.curveTo(x, y + k, x + k, y, x + rr, y);
    this.close();
  }
  /** an ellipse, starting at its right and running clockwise on the page (as SVG draws a circle) */
  ellipse(cx: number, cy: number, rx: number, ry: number): void {
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    this.moveTo(cx + rx, cy);
    this.curveTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
    this.curveTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
    this.curveTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
    this.curveTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
    this.close();
  }
  /** an arc of a circle from angle a0 to a1 (radians, clockwise on the page from the right), as Bézier pieces */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, move = true): void {
    const span = a1 - a0;
    const pieces = Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2)));
    const step = span / pieces;
    const k = (4 / 3) * Math.tan(step / 4);
    let a = a0;
    if (move) this.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    for (let i = 0; i < pieces; i++) {
      const b = a + step;
      const x0 = cx + r * Math.cos(a);
      const y0 = cy + r * Math.sin(a);
      const x3 = cx + r * Math.cos(b);
      const y3 = cy + r * Math.sin(b);
      this.curveTo(x0 - k * r * Math.sin(a), y0 + k * r * Math.cos(a), x3 + k * r * Math.sin(b), y3 - k * r * Math.cos(b), x3, y3);
      a = b;
    }
  }
  fill(evenOdd = false): void {
    this.push(evenOdd ? Op.FillEvenOdd : Op.FillNonZero);
    this.drawn.paths += 1;
  }
  stroke(): void {
    this.push(Op.StrokePath);
    this.drawn.paths += 1;
  }
  /** the path becomes the clip for what follows (until restore) */
  clip(evenOdd = false): void {
    this.push(evenOdd ? Op.ClipEvenOdd : Op.ClipNonZero);
    this.push(Op.EndPath);
  }

  /* ---------- paint ---------- */
  fillColor(c: Rgba): void {
    this.nums(Op.NonStrokingColorRgb, c.r, c.g, c.b);
  }
  strokeColor(c: Rgba): void {
    this.nums(Op.StrokingColorRgb, c.r, c.g, c.b);
  }
  lineWidth(w: number): void {
    this.nums(Op.SetLineWidth, w);
  }
  /** a dash pattern (lengths in mm) starting `phase` into it; [] for solid */
  dash(pattern: number[], phase = 0): void {
    const arr = PDFArray.withContext(this.doc.context);
    pattern.forEach((v) => arr.push(this.num(Math.max(0, v))));
    this.push(Op.SetLineDashPattern, [arr, this.num(Math.max(0, phase))]);
  }
  /** 0 butt, 1 round, 2 square */
  lineCap(cap: 0 | 1 | 2): void {
    this.nums(Op.SetLineCapStyle, cap);
  }
  /** 0 miter, 1 round, 2 bevel */
  lineJoin(join: 0 | 1 | 2): void {
    this.nums(Op.SetLineJoinStyle, join);
  }
  /** fill and stroke opacity for what follows (an ExtGState, kept once per page) */
  alpha(fillA: number, strokeA = fillA): void {
    const fa = Math.round(Math.max(0, Math.min(1, fillA)) * 1000) / 1000;
    const sa = Math.round(Math.max(0, Math.min(1, strokeA)) * 1000) / 1000;
    const key = `${fa}|${sa}`;
    let name = this.gsKeys.get(key);
    if (!name) {
      const dict = this.doc.context.obj({ Type: 'ExtGState', ca: fa, CA: sa });
      name = this.page.node.newExtGState('GS', dict);
      this.gsKeys.set(key, name);
    }
    this.push(Op.SetGraphicsStateParams, [name]);
  }

  /* ---------- text ---------- */
  beginText(): void {
    this.push(Op.BeginText);
  }
  endText(): void {
    this.push(Op.EndText);
  }
  font(font: PDFFont, size: number): void {
    let name = this.fontKeys.get(font.ref);
    if (!name) {
      name = this.page.node.newFontDictionary(font.name, font.ref);
      this.fontKeys.set(font.ref, name);
    }
    this.push(Op.SetFontAndSize, [name, this.num(size)]);
  }
  charSpacing(tc: number): void {
    this.nums(Op.SetCharacterSpacing, tc);
  }
  /** horizontal scaling, in percent */
  hScale(tz: number): void {
    this.nums(Op.SetTextHorizontalScaling, tz);
  }
  /** 0 fill, 2 fill then stroke (an emboldened face), 3 invisible */
  renderMode(mode: 0 | 1 | 2 | 3): void {
    this.nums(Op.SetTextRenderingMode, mode);
  }
  textMatrix(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.nums(Op.SetTextMatrix, a, b, c, d, e, f);
  }
  /** a TJ: glyph codes (hex strings) and shifts between them */
  showAdjusted(items: TjItem[]): void {
    if (!items.length) return;
    const arr = PDFArray.withContext(this.doc.context);
    let hex = '';
    for (const it of items) {
      if (typeof it === 'string') hex += it;
      else {
        if (hex) arr.push(PDFHexString.of(hex));
        hex = '';
        if (Math.abs(it) > 0.0005) arr.push(this.num(it));
      }
    }
    if (hex) arr.push(PDFHexString.of(hex));
    this.push(Op.ShowTextAdjusted, [arr]);
    this.drawn.texts += 1;
  }

  /* ---------- pictures ---------- */
  /** a picture filling the box (x, y, w, h), its first row at the top (the page's y runs down) */
  image(ref: PDFRef, x: number, y: number, w: number, h: number): void {
    let name = this.imageKeys.get(ref);
    if (!name) {
      name = this.page.node.newXObject('Im', ref);
      this.imageKeys.set(ref, name);
    }
    this.save();
    this.cm(w, 0, 0, -h, x, y + h);
    this.push(Op.DrawObject, [name]);
    this.restore();
    this.drawn.images += 1;
  }

  /** the commands so far, into the page's content stream */
  commit(): void {
    for (let i = 0; i < this.ops.length; i += 2000) this.page.pushOperators(...this.ops.slice(i, i + 2000));
    this.ops = [];
  }
}
