/* ONEWORLD PORT — the layout editor's flattener, run in the browser.
   The platform flattened a rendered post in a server Chrome (src/render/renderer.ts extract(), lines 249-426): it
   loaded the post's HTML in a page, walked every element and turned each into an editable text, image, frame or
   shape, then hid those and screenshotted the rest as the base picture. Oneworld has no Chrome on its server, so the
   social posts studio loads the HTML in a hidden, sandboxed frame of exactly W × H (promo-studio/oneworld-social.js)
   and calls extract() on that frame's document; html-to-image then draws the base. The walk below is renderer.ts:257-418
   copied unchanged except where a comment says "ONEWORLD PORT":
     1. it reads the frame's document and computed styles (the shadowing pair at its top) instead of the page's;
     2. a picture's address is its data-ow-src first (the frame swaps every outside picture for a blob: before drawing);
     3. fontFamily has its " turned into ';
     4. whatever is drawn from the event's QR unit (.ow-qr: the code img.ow-qr-code and its caption .ow-qr-t) is
        marked owQr: true, so the code and its caption leave a saved layout together;
     5. extract() ends by hiding what became an element (renderer.ts:420), as the platform did before its screenshot.
   Bundled into assets/vendor/promo-social.js (window.OWSocial) by tools/build-promo-social.js. */

/** One editable element of a flattened post (renderer.ts:161-175, plus owQr). */
export interface EditableEl {
  id: string; type: "text" | "image" | "shape" | "frame";
  x: number; y: number; w: number; h: number;
  rotate?: number; // degrees
  // frame (image clipped inside a container; image has its own inner transform)
  imgScale?: number; imgX?: number; imgY?: number; imgRotate?: number; scrim?: string;
  // text
  text?: string; fontFamily?: string; fontSize?: number; fontWeight?: string; fontStyle?: string;
  color?: string; textAlign?: string; lineHeight?: string; letterSpacing?: string;
  textTransform?: string; textShadow?: string; whiteSpace?: string; padding?: string;
  // shared box styling (text plate / shape / blur panel)
  background?: string; backdropFilter?: string; border?: string; radius?: string; boxShadow?: string;
  // image
  src?: string; objectFit?: string; objectPosition?: string;
  // ONEWORLD PORT: drawn from the event's QR unit (the code, or its caption), so it is left out of a saved layout once
  // the site is unpublished
  owQr?: boolean;
}

/** Flatten the post drawn in `doc` (a W × H frame) into editable elements, marking each with data-edit. */
export function extractElements(doc: Document, W: number, H: number): EditableEl[] {
  // ONEWORLD PORT (1): these two names stand for the frame's document and its computed styles, so the walk below
  // reads as the platform's, line for line
  const document = doc;
  const getComputedStyle = (el: Element, pseudo?: string | null) => doc.defaultView!.getComputedStyle(el, pseudo);
  // ONEWORLD PORT (4): the event's QR unit is .ow-qr > img.ow-qr-code + .ow-qr-t (base.ts qrTile). Every element drawn
  // from it is marked, the caption as well as the code: the editor drops marked elements from a saved layout once the
  // site is unpublished (correctness 14), and a caption left behind would read "Scan to register" over nothing.
  // Unmarked elements get no owQr key at all, so a layout without a QR code is the platform's JSON.
  const qrOf = (...els: any[]) => els.some((e) => !!e && ((e.classList && e.classList.contains("ow-qr-code")) || !!(e.closest && e.closest(".ow-qr"))))
    ? { owQr: true } : {};

  const out: any[] = []; let id = 0;
  const alpha = (c: string) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return c && c !== "transparent" ? 1 : 0;
    const p = m[1].split(",").map((s) => s.trim()); return p[3] != null ? +p[3] : 1;
  };
  const borderOf = (cs: any) => cs.borderTopWidth !== "0px"
    ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : "none";
  // Classify a ::before/::after box. A small in-flow coloured dot is a
  // "bullet" we can rebuild as a shape; anything else (absolute photo scrims,
  // glyph content) is an "overlay" we can't reproduce -> its component bakes.
  const pseudoInfo = (el: any): any => {
    for (const pe of ["::before", "::after"]) {
      const p = getComputedStyle(el, pe); if (!p) continue;
      const c = p.content; if (!c || c === "none") continue;
      const txt = c !== '""' && c !== "''" && c !== "" && c !== "normal";
      if (txt) return { protect: true }; // glyph content -> can't reproduce
      const w = parseFloat(p.width) || 0, h = parseFloat(p.height) || 0;
      const bgVis = alpha(p.backgroundColor) > 0.03;
      const bgImg = !!(p.backgroundImage && p.backgroundImage !== "none");
      const pos = p.position;
      if (w > 0 && h > 0 && bgVis && (pos === "static" || pos === "relative"))
        return { bullet: { w, h, radius: p.borderRadius, bg: p.backgroundColor } }; // in-flow dot
      if (bgVis || bgImg || (p.borderTopWidth && p.borderTopWidth !== "0px"))
        return { overlay: { bg: p.backgroundColor, bgImage: p.backgroundImage } }; // scrim/ring
    }
    return null;
  };
  // Everything becomes editable/movable EXCEPT subtrees we truly can't
  // reproduce: canvas/video, clip-path shapes, and glyph ::before/::after.
  // Photo scrims (gradient overlays) are re-synthesised as shapes, SVG icons
  // are rasterised, and bullets are rebuilt — so photos, icon cards and
  // bullet lists all stay movable.
  const isHost = (el: any) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "canvas" || tag === "video") return true;
    const cs = getComputedStyle(el);
    if (cs.clipPath && cs.clipPath !== "none") return true;
    const pi = pseudoInfo(el);
    return !!(pi && pi.protect);
  };
  const hosts: any[] = [];
  document.querySelectorAll("body *").forEach((el: any) => { if (isHost(el)) hosts.push(el); });
  const isProtected = (el: any) => hosts.some((h) => h === el || h.contains(el) || el.contains(h));
  const overlays: any[] = []; // ::after/::before scrims, drawn on top at the end
  document.querySelectorAll("body *").forEach((el: any) => {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return;
    if (isProtected(el)) return; // unreproducible subtree -> keep baked
    if (el.getAttribute("data-framed")) return; // image already folded into a frame
    // Photo FRAME: a clipping container (overflow:hidden + radius) wrapping an
    // image -> one "frame" element (container + clipped image with its own
    // inner transform). Removes the redundant container box AND lets the user
    // resize/rotate/re-align the image inside its frame.
    const fullBleedEl = r.width >= W * 0.95 && r.height >= H * 0.95;
    if (el.tagName !== "IMG" && !fullBleedEl && cs.overflow === "hidden" && (parseFloat(cs.borderRadius) || 0) > 0) {
      const img = el.querySelector("img");
      if (img && !img.getAttribute("data-framed")) {
        const ics = getComputedStyle(img);
        const pf = pseudoInfo(el);
        const scrim = pf && pf.overlay ? (pf.overlay.bgImage && pf.overlay.bgImage !== "none" ? pf.overlay.bgImage : pf.overlay.bg) : "";
        out.push({ id: "e" + id++, type: "frame", x: r.x, y: r.y, w: r.width, h: r.height, rotate: 0,
          radius: cs.borderRadius, border: borderOf(cs), boxShadow: cs.boxShadow, background: cs.backgroundColor,
          // ONEWORLD PORT (2): the picture's real address; the drawing frame swapped it for a blob: and kept it in data-ow-src
          src: img.getAttribute("data-ow-src") || img.currentSrc || img.src, objectFit: ics.objectFit || "cover", objectPosition: ics.objectPosition || "center",
          imgScale: 1, imgX: 0, imgY: 0, imgRotate: 0, scrim,
          ...qrOf(el, img) }); // ONEWORLD PORT (4)
        el.setAttribute("data-edit", "1"); img.setAttribute("data-framed", "1"); img.setAttribute("data-edit", "1");
        return;
      }
    }
    const ov = pseudoInfo(el);
    if (ov && ov.overlay) { // rebuild the scrim/ring as a shape drawn on top
      overlays.push({ id: "e" + id++, type: "shape", x: r.x, y: r.y, w: r.width, h: r.height, rotate: 0,
        background: ov.overlay.bgImage && ov.overlay.bgImage !== "none" ? ov.overlay.bgImage : ov.overlay.bg,
        backdropFilter: "none", border: "none", radius: cs.borderRadius, boxShadow: "none", ...qrOf(el) }); // ONEWORLD PORT (4)
      el.setAttribute("data-edit", "1"); // hide the host's original pseudo in the base
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "svg") { // rasterise inline SVG (icons) to a movable image
      try {
        el.style.color = cs.color; // resolve currentColor in the standalone SVG
        const xml = new XMLSerializer().serializeToString(el);
        const src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
        out.push({ id: "e" + id++, type: "image", x: r.x, y: r.y, w: r.width, h: r.height, rotate: 0,
          src, objectFit: "contain", objectPosition: "center", radius: "0", background: "rgba(0, 0, 0, 0)", padding: "0",
          ...qrOf(el) }); // ONEWORLD PORT (4): a QR code drawn as inline SVG
        el.setAttribute("data-edit", "1");
      } catch (e) { /* leave baked on failure */ }
      return;
    }
    if (el.ownerSVGElement != null) return; // SVG internals -> handled by the <svg>
    if (el.tagName === "IMG") {
      // Photos are usually rounded by a clipping parent (overflow:hidden +
      // radius), not on the <img> itself — inherit that radius so the
      // decomposed, movable image keeps its rounded corners.
      let radius = cs.borderRadius;
      const par = el.parentElement;
      if (par && (parseFloat(radius) || 0) === 0) {
        const pcs = getComputedStyle(par);
        if (pcs.overflow === "hidden" && (parseFloat(pcs.borderRadius) || 0) > 0) radius = pcs.borderRadius;
      }
      out.push({ id: "e" + id++, type: "image", x: r.x, y: r.y, w: r.width, h: r.height, rotate: 0,
        // ONEWORLD PORT (2): the picture's real address; the drawing frame swapped it for a blob: and kept it in data-ow-src
        src: el.getAttribute("data-ow-src") || el.currentSrc || el.src, objectFit: cs.objectFit, objectPosition: cs.objectPosition, radius,
        background: cs.backgroundColor, padding: cs.padding,
        ...qrOf(el) }); // ONEWORLD PORT (4): the QR code itself
      el.setAttribute("data-edit", "1"); return;
    }
    const directText = Array.from(el.childNodes).some((n: any) => n.nodeType === 3 && n.textContent.trim());
    const childHasText = Array.from(el.children).some((c: any) => (c.textContent || "").trim());
    if (directText && !childHasText) {
      // If the text sits on a single line in the clean render, pin it to
      // nowrap — re-rendering at the exact captured width can otherwise wrap
      // the last word due to sub-pixel rounding (e.g. a pill CTA button).
      const padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
      const singleLine = (r.height - padT - padB) <= lh * 1.6;
      const fwNum = cs.fontWeight === "bold" ? 700 : cs.fontWeight === "normal" ? 400 : (parseInt(cs.fontWeight) || 400);
      // Rebuild a leading ::before bullet as a shape and shift the text right
      // so wrapping matches the clean render.
      let padding = cs.padding;
      const info = pseudoInfo(el);
      const bullet = info && info.bullet;
      if (bullet) {
        const gap = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0;
        const padL = parseFloat(cs.paddingLeft) || 0;
        padding = `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${padL + bullet.w + gap}px`;
      }
      out.push({ id: "e" + id++, type: "text", x: r.x, y: r.y, w: r.width + 1, h: r.height, rotate: 0,
        // ONEWORLD PORT (3): Chrome quotes family names with " (Georgia, "Times New Roman", serif); they become ' so the
        // value can sit inside a style="…" attribute and pass the layout check on save (the same families to CSS)
        text: el.innerText, fontFamily: String(cs.fontFamily || "").replace(/"/g, "'"), fontSize: parseFloat(cs.fontSize), fontWeight: String(Math.min(700, fwNum)),
        fontStyle: cs.fontStyle, color: cs.color, textAlign: cs.textAlign, lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, textShadow: cs.textShadow,
        whiteSpace: singleLine ? "nowrap" : cs.whiteSpace,
        background: cs.backgroundColor, backdropFilter: cs.backdropFilter || (cs as any).webkitBackdropFilter || "none",
        padding, radius: cs.borderRadius, boxShadow: cs.boxShadow,
        ...qrOf(el) }); // ONEWORLD PORT (4): the QR code's caption
      el.setAttribute("data-edit", "1");
      if (bullet) { // draw the dot on top of the tile background
        const padL = parseFloat(cs.paddingLeft) || 0;
        out.push({ id: "e" + id++, type: "shape", x: r.x + padL, y: r.y + (r.height - bullet.h) / 2,
          w: bullet.w, h: bullet.h, rotate: 0, background: bullet.bg, backdropFilter: "none",
          border: "none", radius: bullet.radius, boxShadow: "none", ...qrOf(el) }); // ONEWORLD PORT (4)
      }
      return;
    }
    // Any painted box (frost panel, card, stat tile, chip) -> movable shape,
    // so the blur area / panels can be re-placed. Purely structural, unpainted
    // containers are skipped (their children are captured individually).
    const bf = cs.backdropFilter || (cs as any).webkitBackdropFilter || "none";
    const bm = /blur\(([\d.]+)px\)/.exec(bf);
    const blurPx = bm ? parseFloat(bm[1]) : 0;
    const bgA = alpha(cs.backgroundColor);
    const shadow = cs.boxShadow && cs.boxShadow !== "none";
    const bord = cs.borderTopWidth !== "0px" && alpha(cs.borderTopColor) > 0.03;
    const areaFrac = (r.width * r.height) / (W * H);
    const fullBleed = r.width >= W * 0.95 && r.height >= H * 0.95;
    const painted = blurPx > 0 || bgA > 0.03 || shadow || bord;
    if (!fullBleed && painted && areaFrac > 0.004 && areaFrac < 0.92) {
      out.push({ id: "e" + id++, type: "shape", x: r.x, y: r.y, w: r.width, h: r.height, rotate: 0,
        background: cs.backgroundColor, backdropFilter: bf, border: borderOf(cs),
        radius: cs.borderRadius, boxShadow: cs.boxShadow, ...qrOf(el) }); // ONEWORLD PORT (4): a card behind the QR unit
      el.setAttribute("data-edit", "1"); return;
    }
  });
  overlays.forEach((o) => out.push(o)); // scrims/rings paint on top
  return out;
}

/** The editor's flattening: the elements, with their originals hidden in `doc` so the base drawn next holds only
 *  what stays baked (the platform's renderer.ts:420, run before its screenshot). */
export function extract(doc: Document, W: number, H: number): EditableEl[] {
  const elements = extractElements(doc, W, H);
  // ONEWORLD PORT (5): the platform's own next step, run on the frame's document
  doc.querySelectorAll("[data-edit]").forEach((e: any) => { e.style.visibility = "hidden"; });
  return elements;
}
