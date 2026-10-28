// Bridge between the rich-text editor and what a mailer field actually stores.
//
// House rule: a field NEVER stores HTML (see the handoff notes in README). The
// stored value is plain text carrying inline markers — **bold**, *italic*,
// __underline__, ~~strike~~, ==highlight== and [label](url) — which the server
// parses AFTER escaping, so nothing a sender types can become markup.
//
// Quill is therefore only an input method: it edits a Delta, and every change is
// converted straight back to markers. The renderer, the email-safety guarantees
// and the audit suites are untouched by the editor's existence.
//
// The marker vocabulary here is deliberately exactly what inlineCopy() in
// src/mailers/base.ts understands — no more. Offering a control the mail cannot
// render would silently drop formatting on the way to the inbox.

/** Any background colour in the editor means ==highlight==; the mail picks the
 *  real tint from the palette, so the swatch here is only what the editor shows. */
export const HILITE = "#fde68a";

/** Order matters: these are tried left-to-right at each position, and `italic`
 *  is last so `**bold**` is never mistaken for two italic runs. */
const RULES = [
  { re: /\*\*([^*]+)\*\*/,                          attrs: () => ({ bold: true }) },
  { re: /__([^_]+)__/,                              attrs: () => ({ underline: true }) },
  { re: /~~([^~]+)~~/,                              attrs: () => ({ strike: true }) },
  { re: /==([^=]+)==/,                              attrs: () => ({ background: HILITE }) },
  { re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/,     attrs: (m) => ({ link: m[2] }) },
  { re: /\*([^*\n]+)\*/,                            attrs: () => ({ italic: true }) },
];

/** Marker text -> Quill Delta ops. */
export function markersToDelta(text) {
  const src = String(text ?? "");
  const ops = [];
  const push = (insert, attributes) => {
    if (!insert) return;
    const last = ops[ops.length - 1];
    // Merge touching runs that carry identical formatting, so the Delta stays
    // minimal and a no-op edit cannot churn the stored string.
    if (last && JSON.stringify(last.attributes || null) === JSON.stringify(attributes || null)) last.insert += insert;
    else ops.push(attributes ? { insert, attributes } : { insert });
  };

  let rest = src;
  while (rest) {
    let best = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) { push(rest); break; }
    const { m, rule } = best;
    push(rest.slice(0, m.index));
    // Inner text is taken literally: the mail's own parser does not nest a
    // marker inside a run of the same kind, so neither does the editor.
    push(m[1], rule.attrs(m));
    rest = rest.slice(m.index + m[0].length);
  }
  if (!ops.length) ops.push({ insert: "" });
  // Quill requires the document to end with a newline.
  const tail = ops[ops.length - 1];
  if (typeof tail.insert !== "string" || !tail.insert.endsWith("\n")) ops.push({ insert: "\n" });
  return ops;
}

/** Quill Delta ops -> marker text. Inverse of markersToDelta. */
export function deltaToMarkers(ops) {
  let out = "";
  for (const op of ops || []) {
    if (typeof op.insert !== "string") continue;         // embeds (images) are not supported by the mail
    let t = op.insert;
    const a = op.attributes || {};
    // A newline carries block formatting in Quill, never inline formatting —
    // wrapping it would emit stray markers around blank lines.
    if (t === "\n" || !t.trim()) { out += t; continue; }
    // Preserve leading/trailing spaces outside the markers, so "**a** b" does
    // not become "**a **b".
    const lead = (t.match(/^\s+/) || [""])[0];
    const tail = (t.match(/\s+$/) || [""])[0];
    let core = t.slice(lead.length, t.length - tail.length);
    if (core) {
      // Innermost first; bold outermost mirrors the order inlineCopy() applies.
      if (a.italic) core = `*${core}*`;
      if (a.background) core = `==${core}==`;
      if (a.strike) core = `~~${core}~~`;
      if (a.underline) core = `__${core}__`;
      if (a.bold) core = `**${core}**`;
      if (a.link) core = `[${core}](${a.link})`;
    }
    out += lead + core + tail;
  }
  return out.replace(/\n+$/, "");                        // drop Quill's trailing newline
}

/** A rendered DOM element -> marker text. The inverse of what inlineCopy() emits.
 *
 *  In-place editing on the canvas makes the REAL rendered element editable, so
 *  what comes back is browser HTML: inlineCopy's own tags, plus whatever the
 *  browser produced when you pressed ⌘B (`<b>`, `<i>`, a `<span style>`, even a
 *  `<font>`). All of it maps down to the same six markers, and anything that
 *  maps to nothing contributes its TEXT and nothing else — so a field still
 *  cannot end up storing HTML, which is the rule this whole module exists for.
 *
 *  The alternative was reading `innerText`, which is how a single edit used to
 *  destroy every mark in a field: by then `**x**` is already `<strong>x</strong>`
 *  and the markers are gone. */
export function htmlToMarkers(root) {
  if (!root) return "";

  const marks = (el) => {
    const tag = (el.tagName || "").toLowerCase();
    const href = tag === "a" && el.getAttribute && el.getAttribute("href");
    // A link wears the renderer's own chrome — inlineCopy gives every anchor
    // font-weight:700 and an underline. Reading that back as sender intent
    // turned [label](url) into [**__label__**](url) on every round trip, so an
    // anchor contributes ONLY its link. Genuinely bold link text survives
    // because it is a <strong> CHILD of the anchor, not a style on it.
    if (href) return { link: href };
    const st = (el.getAttribute && el.getAttribute("style")) || "";
    const has = (re) => re.test(st);
    return {
      // execCommand emits <b>/<i>; the renderer emits <strong>/<em>; a paste can
      // arrive as an inline style. Treat all three the same.
      bold: tag === "b" || tag === "strong" || has(/font-weight\s*:\s*(bold|[7-9]00)/i),
      italic: tag === "i" || tag === "em" || has(/font-style\s*:\s*italic/i),
      underline: tag === "u" || has(/text-decoration[^;]*underline/i),
      strike: tag === "s" || tag === "strike" || tag === "del" || has(/text-decoration[^;]*line-through/i),
      // Any real background means ==highlight==; the mail picks the actual tint
      // from its palette, so the colour itself is not carried.
      hilite: has(/background(-color)?\s*:\s*(?!transparent|none|rgba\(0,\s*0,\s*0,\s*0\))[^;]+/i),
      link: null,
    };
  };

  // Same nesting order as deltaToMarkers, so both inverses agree.
  const wrap = (core, m) => {
    if (!core || !core.trim()) return core;
    // Never wrap across a line break: paragraphs() splits the stored value on
    // newlines, so "**a\nb**" would reach the mail as two broken fragments.
    if (core.includes("\n")) return core;
    const lead = (core.match(/^\s+/) || [""])[0];
    const tail = (core.match(/\s+$/) || [""])[0];
    let s = core.slice(lead.length, core.length - tail.length);
    if (m.italic) s = `*${s}*`;
    if (m.hilite) s = `==${s}==`;
    if (m.strike) s = `~~${s}~~`;
    if (m.underline) s = `__${s}__`;
    if (m.bold) s = `**${s}**`;
    if (m.link) s = `[${s}](${m.link})`;
    return lead + s + tail;
  };

  const BLOCK = /^(div|p|li|tr|br|h[1-6]|table|tbody)$/;
  const walk = (node) => {
    if (node.nodeType === 3) return node.nodeValue || "";        // text
    if (node.nodeType !== 1) return "";
    const tag = (node.tagName || "").toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "style" || tag === "script") return "";
    let inner = "";
    for (const child of node.childNodes) inner += walk(child);
    // A block boundary is a newline in the stored value, not a wrapper.
    if (BLOCK.test(tag)) return inner + (inner.endsWith("\n") ? "" : "\n");
    return wrap(inner, marks(node));
  };

  let out = "";
  for (const child of root.childNodes) out += walk(child);
  return out.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

if (typeof window !== "undefined") window.RichText = { markersToDelta, deltaToMarkers, htmlToMarkers, HILITE };
