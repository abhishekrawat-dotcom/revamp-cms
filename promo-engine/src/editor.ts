// ONEWORLD PORT: the element type lives beside the browser flattener (render/extract.ts); the platform's
// render/renderer.ts drives a server Chrome, which Oneworld does not have, so it is not ported.
import type { EditableEl } from "./render/extract.ts";

const FONT_IMPORT = "https://fonts.googleapis.com/css2?" + [
  "family=Inter:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400",
  "family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400",
  "family=Mulish:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400",
  "family=Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400",
  "family=Montserrat:wght@400;600;700;800;900", "family=Oswald:wght@400;500;600;700",
  "family=Anton", "family=Bebas+Neue", "family=Playfair+Display:ital,wght@0,700;1,700",
].join("&") + "&display=swap";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const transp = (v?: string) => !v || v === "transparent" || /rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(v);
const rot = (el: EditableEl) => `transform:rotate(${el.rotate || 0}deg);transform-origin:center center;`;
const bf = (el: EditableEl) => (el.backdropFilter && el.backdropFilter !== "none")
  ? `backdrop-filter:${el.backdropFilter};-webkit-backdrop-filter:${el.backdropFilter};` : "";

/* ONEWORLD PORT (D18): every style value below is written inside a double-quoted style="…" attribute, and the
   platform wrote them as they came. A value holding a double quote ended the attribute early: Chrome reports the
   Testimonial's quotation mark as font-family Georgia, "Times New Roman", serif, so the downloaded post lost that
   mark's size, colour and shadow while the editor's stage (which sets DOM properties) showed it right. Each value
   now goes through attr() (& and " escaped), which the browser decodes back to the same CSS. src and text keep the
   platform's own esc(); they are left out here so they are not escaped twice. A value without & or " is unchanged,
   so every other post is written byte for byte as before. */
const attr = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const attrEl = (el: EditableEl): EditableEl => {
  const out: any = {};
  for (const k of Object.keys(el || {})) {
    const v = (el as any)[k];
    out[k] = k === "src" || k === "text" || v == null || typeof v === "number" || typeof v === "boolean" ? v : attr(v);
  }
  return out;
};

/** Rebuild the final creative = static base image + the (edited) elements on top. */
export function renderEditableHtml(width: number, height: number, baseUri: string, elements: EditableEl[]): string {
  // ONEWORLD PORT (D18): style values escaped for the attribute (attrEl, above)
  const body = (elements || []).map((raw) => { const el = attrEl(raw);
    if (el.type === "image") {
      return `<img style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;` +
        `object-fit:${el.objectFit || "cover"};object-position:${el.objectPosition || "center"};box-sizing:border-box;` +
        `background:${transp(el.background) ? "transparent" : el.background};padding:${el.padding || "0"};` +
        `border-radius:${el.radius || "0"};box-shadow:${el.boxShadow && el.boxShadow !== "none" ? el.boxShadow : "none"};` +
        `${rot(el)}" src="${esc(el.src)}">`;
    }
    if (el.type === "frame") {
      const t = `translate(${el.imgX || 0}px, ${el.imgY || 0}px) scale(${el.imgScale || 1}) rotate(${el.imgRotate || 0}deg)`;
      const scrim = el.scrim && el.scrim !== "none" ? `<div style="position:absolute;inset:0;pointer-events:none;background:${el.scrim}"></div>` : "";
      return `<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;overflow:hidden;` +
        `border-radius:${el.radius || "0"};border:${el.border && el.border !== "none" ? el.border : "none"};` +
        `box-shadow:${el.boxShadow && el.boxShadow !== "none" ? el.boxShadow : "none"};background:${transp(el.background) ? "transparent" : el.background};` +
        `${rot(el)}"><img style="position:absolute;inset:0;width:100%;height:100%;object-fit:${el.objectFit || "cover"};` +
        `object-position:${el.objectPosition || "center"};transform:${t};transform-origin:center center" src="${esc(el.src)}">${scrim}</div>`;
    }
    if (el.type === "shape") {
      return `<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;` +
        `background:${transp(el.background) ? "transparent" : el.background};${bf(el)}` +
        `border:${el.border && el.border !== "none" ? el.border : "none"};border-radius:${el.radius || "0"};` +
        `box-shadow:${el.boxShadow && el.boxShadow !== "none" ? el.boxShadow : "none"};${rot(el)}"></div>`;
    }
    return `<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;box-sizing:border-box;` +
      `font-family:${el.fontFamily || "Inter"};font-size:${el.fontSize || 24}px;font-weight:${el.fontWeight || 400};font-style:${el.fontStyle || "normal"};` +
      `color:${el.color || "#fff"};text-align:${el.textAlign || "left"};line-height:${el.lineHeight || "normal"};letter-spacing:${el.letterSpacing || "normal"};` +
      `text-transform:${el.textTransform || "none"};text-shadow:${el.textShadow && el.textShadow !== "none" ? el.textShadow : "none"};` +
      `background:${transp(el.background) ? "transparent" : el.background};${bf(el)}padding:${el.padding || "0"};` +
      `border-radius:${el.radius || "0"};box-shadow:${el.boxShadow && el.boxShadow !== "none" ? el.boxShadow : "none"};${rot(el)}white-space:${el.whiteSpace || "pre-wrap"};">${esc(el.text)}</div>`;
  }).join("");

  // ONEWORLD PORT (D18): the base picture's address is an attribute too, escaped like every element's src
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @import url('${FONT_IMPORT}');
    *{margin:0;box-sizing:border-box}html,body{width:${width}px;height:${height}px}
    .stage{position:relative;width:${width}px;height:${height}px;overflow:hidden}
    .stage>.bg{position:absolute;inset:0;width:${width}px;height:${height}px}
  </style></head><body><div class="stage"><img class="bg" src="${esc(baseUri)}">${body}</div></body></html>`;
}
