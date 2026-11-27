// Writes the PDF as it is made, so a 150-page photo book never holds all its pictures in the page's memory at once
// (pdfEngine.ts). pdf-lib keeps every object until save() and then builds the whole file in one buffer; here each
// page's pictures and drawing commands (its streams) are written out when the page is done, into Blob parts the browser
// may keep outside the page's memory, and taken out of pdf-lib's document. What is left at the end (the fonts, made
// once every page has said which glyphs it uses; the page dictionaries; the catalogue and the document's details) is
// written last, then the cross-reference table and the trailer. The file is the one PDFWriter would make, object for
// object, without object streams.
import { PDFCrossRefSection, PDFHeader, PDFStream, PDFTrailer, PDFTrailerDict, type PDFDocument, type PDFObject, type PDFRef } from 'pdf-lib';

const enc = new TextEncoder();

export class StreamingPdfWriter {
  private parts: Blob[] = [];
  private chunk: Uint8Array[] = [];
  private chunkBytes = 0;
  private offset = 0;
  private offsets: Array<{ ref: PDFRef; at: number }> = [];
  private mark = 0;
  /** the largest Blob part held in the page's memory before it is handed to the browser */
  private static CHUNK = 4 * 1024 * 1024;

  constructor(private readonly doc: PDFDocument) {
    const header = PDFHeader.forVersion(1, 7);
    const head = new Uint8Array(header.sizeInBytes() + 2);
    const n = header.copyBytesInto(head, 0);
    head[n] = 10;
    head[n + 1] = 10;
    this.add(head);
    this.mark = doc.context.largestObjectNumber;
  }

  private add(bytes: Uint8Array): void {
    this.chunk.push(bytes);
    this.chunkBytes += bytes.length;
    this.offset += bytes.length;
    if (this.chunkBytes >= StreamingPdfWriter.CHUNK) this.seal();
  }

  /* the bytes so far become one Blob part, and the arrays can be let go */
  private seal(): void {
    if (!this.chunk.length) return;
    this.parts.push(new Blob(this.chunk as BlobPart[]));
    this.chunk = [];
    this.chunkBytes = 0;
  }

  private writeObject(ref: PDFRef, obj: PDFObject): void {
    const head = enc.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    const body = new Uint8Array(obj.sizeInBytes());
    obj.copyBytesInto(body, 0);
    this.offsets.push({ ref, at: this.offset });
    this.add(head);
    this.add(body);
    this.add(enc.encode('\nendobj\n\n'));
  }

  /**
   * After a page: every stream made since the last call (its drawing commands, its pictures) is written and taken
   * out of the document. Pictures must already be embedded (PDFImage.embed). Dictionaries stay: pdf-lib still reads
   * the page tree while pages are added, and they are small.
   */
  flushStreams(): number {
    const ctx = this.doc.context;
    let written = 0;
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (ref.objectNumber <= this.mark) continue;
      if (!(obj instanceof PDFStream)) continue;
      this.writeObject(ref, obj);
      ctx.delete(ref);
      written += 1;
    }
    this.seal();
    return written;
  }

  /** the rest of the document, the cross-reference table and the trailer: the finished file */
  async finish(): Promise<Blob> {
    await this.doc.flush();
    const ctx = this.doc.context;
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) this.writeObject(ref, obj);
    const xref = PDFCrossRefSection.create();
    this.offsets.sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);
    for (const o of this.offsets) xref.addEntry(o.ref, o.at);
    const xrefAt = this.offset;
    const xb = new Uint8Array(xref.sizeInBytes() + 1);
    xref.copyBytesInto(xb, 0);
    xb[xb.length - 1] = 10;
    this.add(xb);
    const trailerDict = PDFTrailerDict.of(
      ctx.obj({
        Size: ctx.largestObjectNumber + 1,
        Root: ctx.trailerInfo.Root,
        Encrypt: ctx.trailerInfo.Encrypt,
        Info: ctx.trailerInfo.Info,
        ID: ctx.trailerInfo.ID,
      })
    );
    const tb = new Uint8Array(trailerDict.sizeInBytes() + 2);
    trailerDict.copyBytesInto(tb, 0);
    tb[tb.length - 2] = 10;
    tb[tb.length - 1] = 10;
    this.add(tb);
    const trailer = PDFTrailer.forLastCrossRefSectionOffset(xrefAt);
    const end = new Uint8Array(trailer.sizeInBytes());
    trailer.copyBytesInto(end, 0);
    this.add(end);
    this.seal();
    const blob = new Blob(this.parts, { type: 'application/pdf' });
    this.parts = [];
    return blob;
  }
}
