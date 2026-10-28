import type { EventEntity } from "../model/types.ts";
import type { RenderCtx, ThemeMode } from "./base.ts";
import { inlineCopy, safeUrl } from "./base.ts";
import { BLOCK_SCHEMAS, blockOf, renderCtx, renderDoc, sanitiseFragment } from "./blocks.ts";
import type { Block, BlockType, Field, MailerDoc } from "./blocks.ts";

// Import an arbitrary HTML email and ADOPT it into the block document this app
// edits. The output is an ordinary MailerDoc — after this runs there is nothing
// special about the mail: it is blocks, it renders through renderDoc(), and the
// studio edits it like any other.
//
// Three rules shape everything below.
//
// 1. NEVER LOSE CONTENT SILENTLY. A pixel-perfect import of arbitrary HTML is
//    impossible, so where a structure has no typed equivalent it falls back to
//    the `html` block (which the renderer sanitises) rather than being dropped.
//    Anything that IS dropped is named in the report.
// 2. NEVER TRUST THE FILE. This is the only path in the codebase that takes
//    markup from outside and turns it into block props, so the sanitising is
//    done at PARSE time — executable elements never enter the tree, so no
//    recogniser can accidentally carry one into a prop. Every URL goes through
//    `safeUrl()`, and text is extracted from decoded TEXT NODES only, so no
//    markup can ride along inside a string.
// 3. NEVER EMIT A BLOCK THE STUDIO CANNOT EDIT. Every block is validated
//    against `BLOCK_SCHEMAS` at runtime (read live, never copied into a list
//    here) — unknown type, unknown prop or an out-of-range select value would
//    all corrupt the document.

// ---- public shape -----------------------------------------------------------

export interface ImportNote {
  /** What was seen in the source. */
  what: string;
  /** What it became, when that is not obvious. */
  as?: string;
  detail?: string;
  count: number;
}

export interface ImportReport {
  /** False only when the file could not be parsed at all — the doc is then empty. */
  ok: boolean;
  bytes: number;
  /** Blocks in the finished document. */
  blocks: number;
  byType: Record<string, number>;
  /** Structures mapped onto a block that carries the same meaning. */
  recognised: ImportNote[];
  /** Mapped onto the closest block, with fidelity knowingly lost. */
  approximated: ImportNote[];
  /** No typed equivalent — kept verbatim in an `html` block, or listed here as lost. */
  unrepresented: ImportNote[];
  /** Removed for safety. Anything named here never reached a block prop.
   *  This is the RAW, technical list — one entry per kind of thing stripped
   *  ("on* handler", "unsafe URL", "<body> unwrapped"…). It is diagnostic data,
   *  NOT copy to show a marketer: "85 unsafe URLs removed" reads as broken links
   *  when what went was invisible chrome. The audit suite reads it, so it keeps
   *  the exact strings. Render `removedSummary` to a person instead. */
  removed: ImportNote[];
  /** The SAME removals, collapsed into a few calm, plain-language groups for a
   *  non-technical reader (see `humaniseRemoved`). This is the list to show in
   *  the UI in place of `removed`; the security behaviour is identical, only the
   *  description is human. A count is kept only where it means something to a
   *  person (genuine images that could not be carried over), never for chrome. */
  removedSummary: ImportNote[];
  /** Share of the source's visible words that survive into the document, 0..1. */
  textCoverage: number;
  /** Content images in the source, and how many reach the re-rendered mail.
   *  Words are not the only content: an import can measure 100% text-perfect
   *  while silently losing every photograph, which is exactly how a speaker grid
   *  built as a <ul> passed for a clean import. */
  imageCoverage: number;
  imagesInSource: number;
  imagesInMail: number;
  /** Source images with no counterpart in the mail (filenames, truncated). */
  lostImages: string[];
  /** A sample of source text that is NOT in any block prop. */
  lostText: string[];
  warnings: string[];
  /** Plain-language, reassuring notes for a result a marketer should look twice
   *  at — a low coverage figure, or pictures that did not come across. Says the
   *  LIKELY cause and what to do, so a bare percentage never has to alarm on its
   *  own. Empty when the import came across cleanly. Meant to be shown prominently
   *  (not under a "Warnings" heading), alongside the studio's "Undo import". */
  guidance: string[];
}

export interface ImportOptions {
  mailerId?: string;
  subject?: string;
  preheader?: string;
  theme?: ThemeMode;
  accent?: string;
  background?: string;
  /** Refuse anything larger; the caller should also cap the upload. */
  maxBytes?: number;
  maxBlocks?: number;
  maxNodes?: number;
  maxDepth?: number;
}

const LIMITS = {
  maxBytes: 2_000_000,
  maxBlocks: 300,
  maxNodes: 40_000,
  maxDepth: 120,
  /** Longest string allowed into any text prop. */
  maxField: 20_000,
  /** Longest markup kept in one `html` fallback block. */
  maxRaw: 12_000,
  maxItems: 60,
};

// ---- tokenizer / tree -------------------------------------------------------

interface El {
  kind: "el"; tag: string; attrs: Record<string, string>; children: TNode[];
  /** Set while parsing. The stylesheet matcher needs to walk ANCESTORS to resolve
   *  a descendant selector like `.ul_section.style-4 li img`. */
  parent?: El;
  /** Memoised `hiddenByCss` verdict for this element. */
  hid?: boolean;
}
interface Txt { kind: "text"; text: string }
type TNode = El | Txt;

const VOID = new Set(["area", "base", "br", "col", "command", "embed", "hr", "img", "input",
  "keygen", "link", "meta", "param", "source", "track", "wbr"]);

/** Elements removed WITH their content. Everything here either executes, loads
 *  something that executes, or is a document-level tag that has no meaning
 *  inside a mail. They are skipped in the TOKENIZER — the tree never holds one,
 *  so no recogniser downstream has to remember to check. */
const DROP = new Set(["script", "style", "iframe", "object", "embed", "applet", "frame",
  "frameset", "noscript", "template", "svg", "math", "map", "select", "textarea",
  "base", "meta", "link", "input", "keygen", "param", "source", "track"]);

/** The wrapper is unsafe or meaningless but the CONTENT is the user's copy, so
 *  the element is unwrapped rather than dropped. A <form> loses its action; the
 *  words inside it survive. */
//  `video`/`audio`/`canvas` are unwrapped rather than dropped for the same
//  reason: no mail client plays them, but what sits INSIDE one is the fallback
//  the sender wrote for exactly that case — usually a poster image and a link.
const UNWRAP = new Set(["form", "button", "fieldset", "legend", "html", "body", "head",
  "center", "main", "article", "video", "audio", "canvas", "picture", "figure"]);

/** Purely inline — these never break a line of copy. */
const INLINE = new Set(["a", "abbr", "b", "big", "code", "del", "em", "font", "i", "ins", "kbd",
  "label", "mark", "nobr", "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup",
  "tt", "u", "var", "wbr", "time", "bdi", "bdo"]);

/** Start tags that implicitly close an open tag of another name. */
const AUTO_CLOSE: Record<string, string[]> = {
  li: ["li"], td: ["td", "th"], th: ["td", "th"], tr: ["tr", "td", "th"],
  dd: ["dd", "dt"], dt: ["dd", "dt"], option: ["option"], optgroup: ["option", "optgroup"],
  thead: ["td", "th", "tr", "thead", "tbody", "tfoot"],
  tbody: ["td", "th", "tr", "thead", "tbody", "tfoot"],
  tfoot: ["td", "th", "tr", "thead", "tbody", "tfoot"],
};
/** …and these all close an open <p>. */
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "div", "dl", "fieldset",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav",
  "ol", "p", "pre", "section", "table", "ul"]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", bull: "•", middot: "·", copy: "©",
  reg: "®", trade: "™", zwnj: "", zwj: "", shy: "", times: "×", divide: "÷",
  euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", sect: "§",
  para: "¶", laquo: "«", raquo: "»", dagger: "†", permil: "‰",
  larr: "←", rarr: "→", harr: "↔", check: "✓", star: "★", rupee: "₹",
};

/** Entities become PLAIN TEXT, never markup: `&lt;script&gt;` decodes to the
 *  characters `<script>` and stays a string in a block prop, which every renderer
 *  escapes again on the way out. Decoding is therefore safe and keeps the
 *  sender's real copy (curly quotes, dashes, ₹) intact. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]{1,31});?/gi, (m, body: string) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return m;
      // Surrogates and C0 controls are never legitimate copy.
      if (cp >= 0xd800 && cp <= 0xdfff) return "";
      if (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) return "";
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    const hit = NAMED[body.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

const ZERO_WIDTH = /[\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff\u00ad]/g;
/** Raw C0 controls are stripped as well as decoded ones: `neutraliseMarkers()`
 *  below uses a few of them as private sentinels for the markers THIS module
 *  generates, so a file must not be able to supply its own. */
const C0 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (s: string) => decodeEntities(s).replace(ZERO_WIDTH, "").replace(C0, "").replace(/\u00a0/g, " ");

interface ParseResult {
  root: El;
  title: string;
  /** Raw text of every <style> element, for `hideRules()` only. */
  styles: string[];
  removed: Record<string, number>;
  truncated: boolean;
}

function parse(src: string, lim: typeof LIMITS): ParseResult {
  const root: El = { kind: "el", tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const removed: Record<string, number> = {};
  let title = "";
  const styles: string[] = [];
  let nodes = 0;
  let truncated = false;
  let i = 0;
  const n = src.length;
  const note = (k: string) => { removed[k] = (removed[k] || 0) + 1; };
  const top = () => stack[stack.length - 1];

  const addText = (raw: string) => {
    if (!raw) return;
    const t = clean(raw);
    if (!t.trim()) {
      // Keep a single separating space so "<b>a</b> <b>b</b>" doesn't become "ab".
      const last = top().children[top().children.length - 1];
      if (last && !(last.kind === "text" && /\s$/.test(last.text))) top().children.push({ kind: "text", text: " " });
      return;
    }
    top().children.push({ kind: "text", text: t });
    nodes++;
  };

  while (i < n) {
    if (nodes > lim.maxNodes) { truncated = true; break; }
    const lt = src.indexOf("<", i);
    if (lt < 0) { addText(src.slice(i)); break; }
    if (lt > i) addText(src.slice(i, lt));

    // comments, CDATA and doctype. Conditional comments (<!--[if mso]>…) go with
    // them: their payload is Outlook-only chrome, and keeping it would mean
    // parsing markup that every other client is told to ignore.
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith("<![", lt)) {
      const end = src.indexOf("]>", lt + 3);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (src.startsWith("<!", lt) || src.startsWith("<?", lt)) {
      const end = src.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }

    const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:_-]*)([^>]*?)(\/?)>/.exec(src.slice(lt));
    if (!m) { addText(src.slice(lt, lt + 1)); i = lt + 1; continue; }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase().replace(/^[a-z]+:/, "");   // o:p, v:rect → p, rect
    const rawAttrs = m[3] || "";
    let next = lt + m[0].length;

    if (closing) {
      // Pop to the nearest matching open element; a stray </b> is ignored rather
      // than allowed to unwind the tree.
      let at = -1;
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { at = k; break; }
      if (at > 0) stack.length = at;
      i = next;
      continue;
    }

    if (tag === "title") {
      const end = /<\s*\/\s*title\s*>/i.exec(src.slice(next));
      const body = end ? src.slice(next, next + end.index) : src.slice(next);
      if (!title) title = clean(body).replace(/\s+/g, " ").trim();
      i = end ? next + end.index + end[0].length : n;
      continue;
    }

    if (DROP.has(tag)) {
      note(tag);
      // Skip the whole element, content included. Doing it in the tokenizer is
      // what makes `<script>if(a<b){}</script>` safe: the body is never scanned
      // for tags, so nothing inside it can become a node.
      if (!VOID.has(tag) && !m[4]) {
        const end = new RegExp(`<\\s*/\\s*${tag}\\s*>`, "i").exec(src.slice(next));
        // The <style> ELEMENT is still dropped — it must never reach a block — but
        // its text is kept for one purpose only: working out which elements the
        // mail does not show. Layout is not safety; refusing to read it is how
        // three `black_line_divider.png` decorations became content blocks.
        if (tag === "style" && styles.length < 20) styles.push(src.slice(next, end ? next + end.index : n));
        i = end ? next + end.index + end[0].length : n;
      } else {
        i = next;
      }
      continue;
    }

    const attrs = parseAttrs(rawAttrs, note);

    if (UNWRAP.has(tag)) { note(`<${tag}> unwrapped`); i = next; continue; }

    if (VOID.has(tag) || m[4]) {
      top().children.push({ kind: "el", tag, attrs, children: [], parent: top() });
      nodes++;
      i = next;
      continue;
    }

    if (top().tag === "p" && CLOSES_P.has(tag)) stack.pop();
    const auto = AUTO_CLOSE[tag];
    if (auto) while (stack.length > 1 && auto.includes(top().tag)) stack.pop();

    if (stack.length >= lim.maxDepth) {
      // Pathological nesting: keep the CONTENT (children land in the parent) and
      // drop only the wrapper, rather than recursing without a bound.
      truncated = true;
      i = next;
      continue;
    }
    const el: El = { kind: "el", tag, attrs, children: [], parent: top() };
    top().children.push(el);
    stack.push(el);
    nodes++;
    i = next;
  }

  return { root, title, styles, removed, truncated };
}

const URL_ATTRS = new Set(["href", "src", "action", "background", "formaction", "poster", "srcset", "data", "codebase", "cite", "longdesc", "xlink:href", "ping"]);
const KEEP_ATTRS = new Set(["style", "width", "height", "align", "valign", "bgcolor", "background",
  "colspan", "rowspan", "src", "href", "alt", "border", "cellpadding", "cellspacing", "role",
  "class", "id", "target", "dir", "title", "type", "start", "size", "color", "face"]);

function parseAttrs(raw: string, note: (k: string) => void): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    let val = m[2] ?? "";
    if (val && (val[0] === '"' || val[0] === "'")) val = val.slice(1, -1);
    val = clean(val).trim();

    // Event handlers are the single most common way markup executes. Dropped
    // whole, including the exotic ones (onanimationstart, onauxclick…).
    if (/^on/.test(name)) { note("on* handler"); continue; }
    // Angular/Vue/HTMX style bindings can execute in a browser preview.
    if (/^(v-|:|@|x-|hx-|ng-|data-on)/.test(name)) { note("binding attribute"); continue; }
    if (name === "srcdoc" || name === "formaction" || name === "ping") { note(name); continue; }

    if (URL_ATTRS.has(name)) {
      const ok = cleanUrl(val);
      if (!ok) { if (val) note("unsafe URL"); continue; }
      out[name] = ok;
      continue;
    }
    if (name === "style") {
      const st = cleanStyle(val, note);
      if (st) out.style = st;
      continue;
    }
    if (!KEEP_ATTRS.has(name)) continue;
    out[name] = val.slice(0, 2000);
  }
  return out;
}

/** The one place a URL enters the importer. `safeUrl()` is the codebase's rule
 *  (no javascript:/data:/vbscript:); on top of it this refuses anything with
 *  whitespace or control characters — `java\nscript:` is a real bypass — and
 *  anything that is not a scheme a mail client will actually follow. The ESP's
 *  own unsubscribe merge token is the documented exception. */
export function cleanUrl(raw: string): string | undefined {
  let v = String(raw ?? "").trim().replace(ZERO_WIDTH, "");
  if (!v) return undefined;
  if (v.length > 2048) return undefined;
  // Controls and whitespace INSIDE a url are a bypass, not a typo: browsers strip
  // them before resolving the scheme, so "java\tscript:x" runs.
  if (/[\u0000-\u0020]/.test(v)) return undefined;
  if (/^\{\$\$!!.*!!\$\$\}$/.test(v)) return v;              // ESP merge token
  // Strip whitespace before testing the scheme, or "java script:x" slips past.
  const squashed = v.replace(/\s+/g, "");
  if (/^(javascript|vbscript|data|file|blob|about|jar|view-source|chrome|res|ms-msdt):/i.test(squashed)) return undefined;
  if (!safeUrl(squashed)) return undefined;
  // A mail downloaded from this studio has every link rewritten through the click
  // redirect of the send it came from. Re-importing that would point the new mail
  // at the OLD send's counters, so the real target is unwrapped here — the studio
  // adds fresh tracking on the next download.
  const tracked = /^https?:\/\/[^/]+\/t\/c\/[A-Za-z0-9_.-]+\?u=(.+)$/i.exec(v);
  if (tracked) {
    try {
      const target = decodeURIComponent(tracked[1].split("&")[0]);
      if (/^https?:\/\//i.test(target)) return cleanUrl(target);
    } catch { /* fall through and keep the wrapper */ }
  }
  if (/^(https?:|mailto:|tel:|#|\/|\.)/i.test(v)) return v;
  // Scheme-relative and bare domains are fine; an unknown scheme is not.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return undefined;
  return v;
}

/** CSS can execute too (IE `expression()`, `-moz-binding`, `behavior:`) and can
 *  load remote code through url(). The style attribute is only read for LAYOUT
 *  hints here, but it is also copied verbatim into `html` fallback blocks, so it
 *  is cleaned rather than trusted. */
function cleanStyle(raw: string, note: (k: string) => void): string {
  let v = String(raw ?? "");
  if (/expression\s*\(|-moz-binding|behaviou?r\s*:|@import|javascript\s*:|vbscript\s*:/i.test(v)) {
    note("executable CSS");
    v = v.replace(/[^;]*(expression\s*\(|-moz-binding|behaviou?r\s*:|@import|javascript\s*:|vbscript\s*:)[^;]*(;|$)/gi, "");
  }
  v = v.replace(/url\(\s*['"]?\s*(javascript|vbscript|data)\s*:[^)]*\)/gi, () => { note("unsafe CSS url()"); return "none"; });
  return v.slice(0, 4000);
}

// ---- stylesheet: visibility, and nothing else --------------------------------
//
// The <style> block is read for ONE question — "does the mail show this?" — and
// no other. No colour, no size, no layout: honouring arbitrary CSS is how an
// importer starts guessing, and the block renderers are the design here.
//
// The rule that keeps this safe: CSS visibility may delete DECORATION, never
// WORDS. An element the stylesheet hides is skipped only when it carries no text
// — so the divider images and the bullet icons go, while a `.desktop-only` table
// full of copy is imported exactly as before. Emails routinely hide one of two
// alternative layouts, and a rule that could drop either one could drop the mail.

interface CssPart { tag?: string; classes: string[]; id?: string }
interface CssSel { parts: CssPart[]; combs: string[] }

const HIDE_DECL = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*(hidden|collapse)|opacity\s*:\s*0(?![.\d])|(max-)?height\s*:\s*0(?![.\d])|(max-)?width\s*:\s*0(?![.\d])|font-size\s*:\s*0(?![.\d]))/i;

function parseSel(raw: string): CssSel | undefined {
  const t = raw.trim().replace(/\s*>\s*/g, " > ").replace(/\s+/g, " ");
  // Only the simple shapes are understood. Attribute, pseudo, sibling and
  // universal selectors are ignored rather than half-matched — a selector this
  // cannot read is a selector it must not act on.
  if (!t || /[\[\]:+~*(),]/.test(t)) return undefined;
  const parts: CssPart[] = [];
  const combs: string[] = [];
  for (const tok of t.split(" ")) {
    if (tok === ">") { combs.push(">"); continue; }
    if (parts.length && combs.length < parts.length) combs.push(" ");
    const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(tok);
    if (!m) return undefined;
    const part: CssPart = { classes: [] };
    if (m[1]) part.tag = m[1].toLowerCase();
    for (const bit of m[2].match(/[.#][\w-]+/g) || []) {
      if (bit[0] === ".") part.classes.push(bit.slice(1));
      else part.id = bit.slice(1);
    }
    if (!part.tag && !part.classes.length && !part.id) return undefined;
    parts.push(part);
  }
  return parts.length ? { parts, combs } : undefined;
}

/** Selectors that hide whatever they match. Rules inside `@media` count too: an
 *  element the mail hides at ANY width is chrome, and the no-words rule above is
 *  what makes reading them safe. */
function hideRules(sheets: string[]): CssSel[] {
  const out: CssSel[] = [];
  for (const raw of sheets) {
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    let i = 0;
    let buf = "";
    while (i < css.length && out.length < 400) {
      const c = css[i];
      if (c === "{") {
        const sel = buf.trim();
        buf = "";
        if (sel.startsWith("@")) { i++; continue; }          // descend into @media
        const end = css.indexOf("}", i);
        const decls = css.slice(i + 1, end < 0 ? css.length : end);
        if (HIDE_DECL.test(decls)) {
          for (const one of sel.split(",")) {
            const p = parseSel(one);
            if (p) out.push(p);
          }
        }
        i = end < 0 ? css.length : end + 1;
        continue;
      }
      if (c === "}") { buf = ""; i++; continue; }
      buf += c;
      i++;
    }
  }
  return out;
}

/** Set for the duration of one synchronous `importHtml` call and cleared after,
 *  because every tree helper below would otherwise have to thread it through. */
let SHEET: CssSel[] = [];

function matchPart(el: El, p: CssPart): boolean {
  if (p.tag && p.tag !== el.tag) return false;
  if (p.id && p.id !== (el.attrs.id || "")) return false;
  if (p.classes.length) {
    const have = String(el.attrs.class || "").split(/\s+/);
    for (const c of p.classes) if (!have.includes(c)) return false;
  }
  return true;
}

function matchSel(el: El, sel: CssSel): boolean {
  let i = sel.parts.length - 1;
  if (!matchPart(el, sel.parts[i])) return false;
  let cur = el.parent;
  i--;
  while (i >= 0) {
    const comb = sel.combs[i] || " ";
    if (comb === ">") {
      if (!cur || !matchPart(cur, sel.parts[i])) return false;
      cur = cur.parent;
    } else {
      let found = false;
      while (cur) {
        const hit = matchPart(cur, sel.parts[i]);
        cur = cur.parent;
        if (hit) { found = true; break; }
      }
      if (!found) return false;
    }
    i--;
  }
  return true;
}

function hiddenByCss(el: El): boolean {
  if (!SHEET.length) return false;
  if (el.hid !== undefined) return el.hid;
  let hit = false;
  for (const sel of SHEET) if (matchSel(el, sel)) { hit = true; break; }
  el.hid = hit;
  return hit;
}

/** A saved page from ET's own block editor ("meditor") ships the editor's OWN
 *  chrome inline: a `.meditor-toolbar` of Remove/Clone/Move icons above every
 *  section, and — for a rich-text section — the entire CKEditor DOM (`.cke_*`
 *  toolbars, voice labels, an empty `cke_wysiwyg_frame` iframe). None of it is
 *  the mail; all of it is the editor a recipient never sees. Recognised by class
 *  and dropped WITH its content, exactly like a `<script>`: it is what was
 *  turning the toolbar's icons into full-width image blocks and the toolbar's
 *  labels ("keyboard shortcut command", "Insert", "Paste") into source words the
 *  coverage figure then measured against. */
const CHROME_CLASS = /(^|\s)(cke(_[\w-]+)?|meditor[\w-]*|custom_tooltip|CE_delete_icon|clone_section|move_section)(\s|$)/i;
function isEditorChrome(el: El): boolean {
  return CHROME_CLASS.test(String(el.attrs.class || ""));
}

/** Editor chrome, OR hidden-and-wordless decoration the mail itself does not
 *  show. Either way it never reaches a block, and the checks below all skip it
 *  before descending, so its subtree is never read as content. */
const isDecoration = (el: El) => isEditorChrome(el) || (hiddenByCss(el) && !plainOf(el).trim());

// ---- small tree helpers -----------------------------------------------------

const isEl = (n: TNode): n is El => n.kind === "el";
const kids = (el: El): El[] => el.children.filter(isEl);
const attr = (el: El, k: string) => el.attrs[k] ?? "";

function styleOf(el: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(el.attrs.style || "").split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const k = part.slice(0, at).trim().toLowerCase();
    const v = part.slice(at + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

const px = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const m = /(-?[\d.]+)\s*(px)?/.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
};

/** The visual style of a wrapper that only exists to hold one styled child —
 *  `<td><div style="font-size:22px">…</div></td>`. Reading the td alone would
 *  miss every type decision in the mail. */
function visualOf(el: El): Record<string, string> {
  let cur: El = el;
  let merged = styleOf(el);
  for (let hop = 0; hop < 4; hop++) {
    const ch = kids(cur);
    if (ch.length !== 1) break;
    const only = ch[0];
    const st = styleOf(only);
    merged = { ...st, ...merged };
    // Only inherit DOWN into a child that adds type information.
    for (const k of ["font-size", "font-weight", "text-align", "text-transform", "letter-spacing", "line-height", "color", "font-style", "text-decoration"]) {
      if (st[k] && !styleOf(el)[k]) merged[k] = st[k];
    }
    cur = only;
  }
  return merged;
}

function isHidden(el: El): boolean {
  const st = styleOf(el);
  if (/none/i.test(st.display || "")) return true;
  if (/hidden|collapse/i.test(st.visibility || "")) return true;
  if ((px(st["max-height"]) ?? 1) === 0 && /hidden/i.test(st.overflow || "")) return true;
  if ((px(st["font-size"]) ?? 12) <= 1 && (px(st["line-height"]) ?? 12) <= 1) return true;
  if (attr(el, "hidden")) return true;
  return false;
}

interface Line { text: string; links: { href: string; label: string }[] }

// ---- markers: generated vs literal ------------------------------------------
//
// `inlineCopy()` promotes marker syntax to real formatting AFTER escaping. That
// is right for copy a sender typed, and wrong for copy this module lifted out of
// somebody's HTML: a source that merely PRINTS the characters
// `[y](https://evil.example.com/z)` would come back as a live, disguised link to
// a domain the mail never linked to — a phishing vector on a platform whose job
// is sending to a list. `**bold**` printed in the source is the same bug with
// lower stakes.
//
// So the two kinds of marker are kept apart. Markers this module GENERATES (from
// a real <b>/<i>/<a>) are emitted as private sentinels — control characters,
// which `clean()` strips from the input, so the file cannot forge one. Literal
// marker characters that came out of a text node are then neutralised, and only
// afterwards are the sentinels turned into real markers.
const S = {
  bo: "\u0011", bc: "\u0012",     // **bold**
  io: "\u0013", ic: "\u0014",     // *italic*
  uo: "\u0015", uc: "\u0016",     // __underline__
  so: "\u0017", sc: "\u0018",     // ~~strike~~
  ho: "\u0019", hc: "\u001a",     // ==highlight==
  lo: "\u001b", lm: "\u001c", lc: "\u001d",   // [label](url)
};
const MARKERS: Record<string, [string, string]> = {
  strong: [S.bo, S.bc], b: [S.bo, S.bc],
  em: [S.io, S.ic], i: [S.io, S.ic],
  u: [S.uo, S.uc], ins: [S.uo, S.uc],
  s: [S.so, S.sc], del: [S.so, S.sc], strike: [S.so, S.sc],
  mark: [S.ho, S.hc],
};

/** U+2060 WORD JOINER: zero width, and — unlike U+200B — introduces no line-break
 *  opportunity, so a neutralised `**` cannot wrap mid-pair. It is also in
 *  `ZERO_WIDTH`, so re-importing a mail that already carries these strips them
 *  and re-runs this pass: the neutralisation is self-healing. */
const SEP = "\u2060";
/** U+2217 ASTERISK OPERATOR. The escape hatch of last resort — see `finishRich`. */
const ASTERISK = "\u2217";

const LINK_URL = new RegExp(`${S.lm}[^${S.lc}]*${S.lc}`, "g");
const LINK_ALL = new RegExp(`${S.lo}([^${S.lm}]*)${S.lm}([^${S.lc}]*)${S.lc}`, "g");
const SENTINEL = /[\u0011-\u001d]/g;

/** What the reader must see: sentinels removed, a link reduced to its label. */
const visibleOf = (s: string) => s.replace(LINK_ALL, "$1").replace(SENTINEL, "");
/** Sentinels become the real marker syntax. */
const withMarkers = (s: string) => s
  .replace(LINK_ALL, "[$1]($2)")
  .split(S.bo).join("**").split(S.bc).join("**")
  .split(S.io).join("*").split(S.ic).join("*")
  .split(S.uo).join("__").split(S.uc).join("__")
  .split(S.so).join("~~").split(S.sc).join("~~")
  .split(S.ho).join("==").split(S.hc).join("==");

/** Break LITERAL marker syntax with an invisible joiner — and only where it is
 *  syntax. A lone `(` or `_` cannot start anything, so it is left alone: the
 *  report says "marker syntax was neutralised" and that has to be true when it
 *  says it.
 *
 *  Complete for every pair-delimited marker (`**` `__` `~~` `==`) and for the
 *  link, whose pattern needs `]` immediately followed by `(`. NOT complete for a
 *  lone `*`: `*x*` needs only two asterisks anywhere on a line, so no insertion
 *  of invisible characters can break it — that residue is what `finishRich`'s
 *  oracle catches. */
const neutraliseChunk = (s: string) => s
  .replace(/([*_~=])\1+/g, (run) => run.split("").join(SEP))
  .replace(/\]\(/g, `]${SEP}(`);

/** …applied everywhere except inside a generated link's URL, where an inserted
 *  character would corrupt the address. */
function neutraliseMarkers(s: string): string {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(LINK_URL)) {
    out += neutraliseChunk(s.slice(last, m.index)) + m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  return out + neutraliseChunk(s.slice(last));
}

/** Text extraction. Everything here comes from TEXT NODES, already entity-decoded
 *  — no markup can survive into the result by construction.
 *
 *  `markers:true` re-expresses inline emphasis in the app's own marker syntax so
 *  bold copy stays bold after the import. That is only safe because `inlineCopy()`
 *  escapes the whole string BEFORE parsing markers, and because the only marker
 *  that can produce an attribute — `[label](url)` — is restricted here to a
 *  literal http(s) URL with no quotes, parens or whitespace. So a generated
 *  marker can never close the href and start an attribute of its own.
 *
 *  Markers are emitted as SENTINELS here, not as marker characters — see the
 *  block above. `finishRich()` is what turns them into real markers, after the
 *  literal ones have been neutralised. */
function linesOf(el: El, markers: boolean): Line[] {
  const out: Line[] = [];
  let buf = "";
  let links: { href: string; label: string }[] = [];
  const flush = () => {
    const t = buf.replace(/[ \t]+/g, " ").trim();
    if (t) out.push({ text: t, links });
    buf = ""; links = [];
  };
  const walk = (node: TNode, depth: number) => {
    if (depth > 60) return;
    if (node.kind === "text") { buf += node.text; return; }
    const tag = node.tag;
    if (tag === "br") { flush(); return; }
    if (tag === "img") return;
    if (isHidden(node) || isEditorChrome(node)) return;
    if (tag === "a") {
      const href = cleanUrl(attr(node, "href")) || "";
      const before = buf;
      buf = "";
      for (const c of node.children) walk(c, depth + 1);
      const label = buf.replace(/\s+/g, " ").trim();
      buf = before;
      if (label) links.push({ href, label });
      // A link marker is generated only when it can round-trip losslessly: the
      // label must carry no bracket of its own (it would re-split the marker) and
      // the URL none of the pair markers, which `inlineCopy` expands BEFORE the
      // link rule and would otherwise chop the address in half. Anything else
      // keeps its words and loses its href — reported, never invented.
      const linkable = markers && label && href.length < 400
        && /^https?:\/\/[^\s()<>"'`\\]+$/.test(href)
        && !/[\[\]()]/.test(label)
        && !/\*|__|~~|==/.test(href);
      buf += linkable ? `${S.lo}${label}${S.lm}${href}${S.lc}` : label;
      return;
    }
    const mk = markers ? MARKERS[tag] : undefined;
    if (mk) {
      const before = buf;
      buf = "";
      for (const c of node.children) walk(c, depth + 1);
      const inner = buf.trim();
      buf = before + (inner ? `${mk[0]}${inner}${mk[1]} ` : "");
      return;
    }
    if (!INLINE.has(tag)) flush();
    for (const c of node.children) walk(c, depth + 1);
    if (!INLINE.has(tag)) flush();
  };
  for (const c of el.children) walk(c, 0);
  flush();
  return out;
}

/** Raw extraction — with `markers`, the result still holds SENTINELS and must go
 *  through `finishRich()` before it can be stored. */
const textOf = (el: El, markers = false) => linesOf(el, markers).map((l) => l.text).join("\n");
/** Visible text, always safe to store in a field that does not parse markers. */
const plainOf = (el: El) => visibleOf(textOf(el, false));

function imgsIn(el: El, depth = 0): El[] {
  const out: El[] = [];
  if (depth > 40) return out;
  for (const c of el.children) {
    if (!isEl(c)) continue;
    // A branch the stylesheet hides and that carries no words is chrome: the
    // bullet-list icons and the column dividers live here.
    if (isDecoration(c)) continue;
    if (c.tag === "img") { if (!isSpacerImg(c)) out.push(c); }
    else out.push(...imgsIn(c, depth + 1));
  }
  return out;
}

/** 1×1 tracking pixels, shim gifs and the editor's own UI icons are structure,
 *  not content. */
function isSpacerImg(el: El): boolean {
  const st = styleOf(el);
  const w = Number(attr(el, "width")) || px(st.width) || 0;
  const h = Number(attr(el, "height")) || px(st.height) || 0;
  if (w && w <= 4 && h && h <= 4) return true;
  const src = attr(el, "src");
  if (/spacer|shim|pixel|\/t\/o\//i.test(src)) return true;
  // ET's meditor ships its own toolbar and bullet icons as bare-hash PNGs under
  // /files/cp/ — the "control panel" path. A filename that is nothing but a hex
  // hash is a system icon, never the sender's artwork (whose names always carry a
  // data_file_/file_/speaker_ prefix). These repeat 15× per saved section, so
  // counting them as content is what put the image % and the "N of M not
  // imported" line on different denominators.
  const file = (src.split(/[?#]/)[0].split("/").pop() || "");
  if (/\/files\/cp\//i.test(src) && /^[0-9a-f]{12,}\.(png|gif|jpe?g)$/i.test(file)) return true;
  return false;
}

function anchorsIn(el: El, depth = 0): El[] {
  const out: El[] = [];
  if (depth > 40) return out;
  for (const c of el.children) {
    if (!isEl(c)) continue;
    // The editor toolbar's own <a>Remove</a>/<a>Clone</a> icons are not the
    // sender's links, and would confuse the "exactly one anchor" button test.
    if (isEditorChrome(c)) continue;
    if (c.tag === "a") out.push(c);
    else out.push(...anchorsIn(c, depth + 1));
  }
  return out;
}

/** Direct `tr`s of this table — NOT those of a nested table, which belong to the
 *  layout inside a cell and would otherwise be read as extra rows of this grid. */
function rowsOf(table: El): El[] {
  const out: El[] = [];
  const walk = (el: El, depth: number) => {
    for (const c of kids(el)) {
      if (c.tag === "table") continue;
      if (c.tag === "tr") out.push(c);
      else if (c.tag === "tbody" || c.tag === "thead" || c.tag === "tfoot") walk(c, depth + 1);
      else if (depth < 3) walk(c, depth + 1);
    }
  };
  walk(table, 0);
  return out;
}

const cellsOf = (tr: El) => kids(tr).filter((c) => c.tag === "td" || c.tag === "th");

/** Is there anything a reader would see? An image whose src did not survive
 *  `cleanUrl()` does NOT count — treating it as content made a cell of dropped
 *  javascript: images look like a section worth keeping. */
function hasContent(el: El): boolean {
  // The element ITSELF may be the decoration — `imgsIn` only ever inspects
  // children, so a hidden `<td class="mobile-none"><img></td>` still looked like
  // a content cell and kept the stats band at five columns instead of four.
  if (isDecoration(el)) return false;
  if (imgsIn(el).some((i) => cleanUrl(attr(i, "src")))) return true;
  return plainOf(el).replace(/[\s|·•—–-]/g, "").length > 0;
}

/** Re-serialise a subtree for an `html` fallback block. Only attributes on the
 *  keep-list survive, and every one of them was cleaned at parse time — but the
 *  result still goes through `sanitiseFragment()` before it is stored, because
 *  the renderer's contract is the one that must hold. */
function serialize(el: El, budget: { left: number }, depth = 0): string {
  if (budget.left <= 0 || depth > 40) return "";
  let out = "";
  for (const c of el.children) {
    if (budget.left <= 0) break;
    if (c.kind === "text") {
      const t = escText(c.text);
      out += t;
      budget.left -= t.length;
      continue;
    }
    const parts: string[] = [];
    for (const [k, v] of Object.entries(c.attrs)) {
      if (!KEEP_ATTRS.has(k)) continue;
      parts.push(`${k}="${escText(v).replace(/"/g, "&quot;")}"`);
    }
    const open = `<${c.tag}${parts.length ? " " + parts.join(" ") : ""}>`;
    budget.left -= open.length;
    if (VOID.has(c.tag)) { out += open; continue; }
    out += open + serialize(c, budget, depth + 1) + `</${c.tag}>`;
  }
  return out;
}

const escText = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- schema validation ------------------------------------------------------

/** The gate every block passes through. `BLOCK_SCHEMAS` is read HERE, at call
 *  time, so a block type or field added elsewhere is picked up without this file
 *  changing — and a document carrying an unknown type or a stray prop (which
 *  would break the studio's settings panel) can never leave this module. */
export function validateBlock(type: string, props: Record<string, any>, warn: (s: string) => void): Block | null {
  const schema = (BLOCK_SCHEMAS as Record<string, any>)[type];
  if (!schema) { warn(`dropped a block of unknown type "${type}"`); return null; }
  const fields: Field[] = schema.fields || [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: Record<string, any> = {};

  for (const [k, raw] of Object.entries(props || {})) {
    const f = byKey.get(k);
    if (!f) { warn(`dropped prop "${k}" — not declared on the ${type} schema`); continue; }
    const v = coerce(f, raw, type, warn);
    if (v !== undefined) out[k] = v;
  }
  return { ...blockOf(type as BlockType, out) };
}

function coerce(f: Field, raw: any, type: string, warn: (s: string) => void): any {
  switch (f.type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "select": {
      const v = String(raw ?? "");
      if (!f.options || f.options.some((o) => o.value === v)) return v;
      warn(`"${v}" is not an option for ${type}.${f.key} — using the default`);
      return f.default !== undefined ? f.default : f.options[0]?.value;
    }
    case "color": {
      const v = String(raw ?? "").trim();
      return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : undefined;
    }
    case "url": {
      const v = cleanUrl(String(raw ?? ""));
      return v === undefined ? undefined : v;
    }
    case "list": {
      if (!Array.isArray(raw)) return undefined;
      const allowed = new Set((f.itemFields || []).map((x) => x.key));
      const rows = raw.slice(0, LIMITS.maxItems).map((r: any) => {
        const o: Record<string, any> = {};
        for (const [k, v] of Object.entries(r || {})) {
          if (allowed.size && !allowed.has(k)) continue;
          const kind = (f.itemFields || []).find((x) => x.key === k)?.type;
          if (kind === "url") { const u = cleanUrl(String(v ?? "")); if (u) o[k] = u; continue; }
          o[k] = String(v ?? "").slice(0, LIMITS.maxField);
        }
        return o;
      }).filter((r) => Object.keys(r).length);
      return rows.length ? rows : undefined;
    }
    case "picker": case "multipick":
      // Never emitted by the importer: these bind to the EVENT's collections, and
      // an imported mail's people are not the event's people.
      return undefined;
    default:
      return String(raw ?? "").slice(0, LIMITS.maxField);
  }
}

/** Does this field's renderer parse inline markers? Read from the schema, never
 *  guessed from the field name — a marker written into a field that does not
 *  parse them prints `**bold**` at the reader. */
function isRich(type: string, key: string): boolean {
  const schema = (BLOCK_SCHEMAS as Record<string, any>)[type];
  return !!(schema?.fields || []).find((f: Field) => f.key === key)?.rich;
}

// ---- rich fields: literal stays literal --------------------------------------

/** Turn an extracted string into a value that is safe to store in a field whose
 *  renderer parses markers.
 *
 *  The invariant, and the only one worth having: THE READER MUST SEE WHAT THE
 *  SOURCE SHOWED. That is checked against the real `inlineCopy()` rather than
 *  against a copy of its regexes here, so this cannot drift when those change.
 *
 *  Three steps, escalating only as far as needed:
 *   1. neutralise literal marker characters with an invisible joiner;
 *   2. ask `inlineCopy()` what a reader would actually see;
 *   3. if that is still not the source's text, the residue can only be a lone
 *      `*` (see `neutraliseChunk`) — swap those for U+2217, which is an
 *      asterisk-shaped glyph rather than an invisible one. Failing even that,
 *      drop this module's OWN markers and store the plain visible text.
 *
 *  Every step past the first is recorded in the report. */
function finishRich(raw: string, ctx: Ctx): string {
  if (!raw) return "";
  const neutral = neutraliseMarkers(raw);
  if (neutral !== raw) bump(ctx.approximated, "marker syntax printed in the source was neutralised so it still reads as typed", "invisible joiner");

  const attempt = (n: string): string | undefined => {
    const value = withMarkers(n);
    const want = visibleOf(n);
    // No oracle (the palette could not be built) — trust nothing, escalate.
    if (!ctx.rc) return undefined;
    let rendered: string;
    try { rendered = inlineCopy(value, ctx.rc); } catch { return undefined; }
    const seen = decodeEntities(rendered.replace(/<[^>]*>/g, ""));
    return strip(seen) === strip(want) ? value : undefined;
  };

  const first = attempt(neutral);
  if (first !== undefined) return first;

  const starred = neutral.replace(/\*/g, ASTERISK);
  const second = attempt(starred);
  if (second !== undefined) {
    bump(ctx.approximated, "a printed asterisk was set as U+2217 so it survives", "text",
      "a lone `*` cannot be neutralised invisibly — `inlineCopy` has no escape syntax, so the closest asterisk that it does not parse is used");
    return second;
  }

  bump(ctx.approximated, "inline formatting was dropped to keep the words exactly as printed", "plain text",
    "the source's own marker characters and this import's formatting could not both survive");
  return visibleOf(starred);
}
const strip = (s: string) => s.replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();

/** The one way a value reaches a block prop. Rich fields go through the oracle;
 *  a field that does not parse markers takes the visible text, where a literal
 *  `**` is printed as `**` by the renderer and needs no help. */
function fieldText(ctx: Ctx, type: string, key: string, el: El): string {
  return isRich(type, key) ? finishRich(textOf(el, true), ctx) : plainOf(el);
}
/** Same contract, for a value already reduced to a string. */
function fieldFrom(ctx: Ctx, type: string, key: string, s: string): string {
  return isRich(type, key) ? finishRich(s, ctx) : visibleOf(s);
}

// ---- import -----------------------------------------------------------------

interface Ctx {
  out: { type: string; props: Record<string, any> }[];
  recognised: Map<string, ImportNote>;
  approximated: Map<string, ImportNote>;
  unrepresented: Map<string, ImportNote>;
  removed: Map<string, ImportNote>;
  warnings: string[];
  preheader: string;
  sawLogo: boolean;
  sawFooter: boolean;
  sawBanner: boolean;
  /** Running total of speakers whose "Role, Company" line was split into two
   *  fields, across EVERY speaker list in the file — so the report can carry one
   *  merged note ("…for 15 speakers") instead of one per grid. */
  speakerSplit: number;
  limits: typeof LIMITS;
  /** Palette context, used ONLY to run `inlineCopy` as an oracle in `finishRich`. */
  rc?: RenderCtx;
  /** The one element allowed to become the `footer` block — see `findFooter`. */
  footerEl?: El;
}

/** Is this input not plausibly HTML or text at all? A PNG/JPEG/PDF/zip renamed
 *  `.html` decodes to a string dense with NUL/control bytes and U+FFFD
 *  replacement characters; genuine markup and plain text carry almost none. A
 *  leading binary magic number settles it outright (for a byte-preserving decode
 *  like latin1), and otherwise the density of un-decodable bytes over a 4 KB
 *  sample does — 10% is far above anything real copy produces and far below what
 *  binary does. The point is a caller can say "this file does not look like
 *  HTML" instead of importing a block of mojibake and reporting success. */
function looksBinary(s: string): boolean {
  const sample = s.slice(0, 4096);
  if (!sample) return false;
  // Common magic numbers, present when the bytes were decoded 1:1 (latin1).
  if (/^(\x89PNG|\xFF\xD8\xFF|GIF8[79]a|%PDF-|PK\x03\x04|BM|II\*\x00|MM\x00\*|\x1F\x8B|RIFF|OggS|\x00\x00\x01\x00|ID3|fLaC)/.test(sample)) return true;
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0xfffd) bad++;                                   // utf8 could not decode the byte
    else if (c < 0x09 || (c > 0x0d && c < 0x20) || c === 0x7f) bad++;   // C0 control (not \t\n\r)
  }
  return bad / sample.length > 0.1;
}

const bump = (m: Map<string, ImportNote>, what: string, as?: string, detail?: string) => {
  const key = `${what}|${as || ""}`;
  const hit = m.get(key);
  if (hit) hit.count++;
  else m.set(key, { what, ...(as ? { as } : {}), ...(detail ? { detail } : {}), count: 1 });
};

function emit(ctx: Ctx, type: string, props: Record<string, any>, as: string, note = ""): boolean {
  if (ctx.out.length >= ctx.limits.maxBlocks) return false;
  ctx.out.push({ type, props });
  if (note) bump(ctx.approximated, note, type);
  else bump(ctx.recognised, as, type);
  return true;
}

export function importHtml(
  html: string,
  event: EventEntity,
  opts: ImportOptions = {},
): { doc: MailerDoc; report: ImportReport } {
  const limits = { ...LIMITS, ...pickLimits(opts) };
  const src = String(html ?? "");
  const ctx: Ctx = {
    out: [], recognised: new Map(), approximated: new Map(), unrepresented: new Map(),
    removed: new Map(), warnings: [], preheader: "", sawLogo: false, sawFooter: false,
    sawBanner: false, speakerSplit: 0, limits,
  };
  // Built once. If the brand/palette cannot be resolved the oracle is simply
  // absent and `finishRich` escalates instead of trusting an unchecked value.
  try {
    ctx.rc = renderCtx(event, { theme: opts.theme || "site", accent: opts.accent, background: opts.background });
  } catch { /* no oracle; finishRich escalates */ }
  const report: ImportReport = {
    ok: true, bytes: src.length, blocks: 0, byType: {},
    recognised: [], approximated: [], unrepresented: [], removed: [], removedSummary: [],
    textCoverage: 0, lostText: [],
    imageCoverage: 1, imagesInSource: 0, imagesInMail: 0, lostImages: [],
    warnings: [], guidance: [],
  };

  let doc: MailerDoc = {
    mailerId: opts.mailerId || "mailer.imported",
    subject: opts.subject || "",
    preheader: opts.preheader || "",
    theme: opts.theme || "site",
    ...(opts.accent ? { accent: opts.accent } : {}),
    ...(opts.background ? { background: opts.background } : {}),
    blocks: [],
  };

  try {
    if (src.length > limits.maxBytes) {
      report.ok = false;
      report.warnings.push(`file is ${Math.round(src.length / 1024)} KB — the limit is ${Math.round(limits.maxBytes / 1024)} KB`);
      return { doc, report };
    }
    if (!src.trim()) {
      report.warnings.push("the file is empty — an empty document was created");
      return { doc, report };
    }
    if (looksBinary(src)) {
      report.ok = false;
      report.textCoverage = 0;
      report.warnings.push("this file does not look like HTML — it appears to be a binary file (an image, PDF or archive), so nothing was imported");
      return { doc, report };
    }

    const parsed = parse(src, limits);
    SHEET = hideRules(parsed.styles);
    if (SHEET.length) bump(ctx.recognised, `${SHEET.length} stylesheet rule(s) that hide an element`, "used to skip decoration");
    for (const [k, n] of Object.entries(parsed.removed)) {
      ctx.removed.set(k, { what: k, count: n, detail: "removed before anything could read it" });
    }
    if (parsed.truncated) ctx.warnings.push("the file was larger or more deeply nested than the parser's limits — the tail was not imported");

    // A file with no tags at all is still someone's mail: treat it as copy.
    if (!/[<]\s*[a-zA-Z!\/]/.test(src)) {
      const t = clean(src).split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).join("\n");
      const v = fieldFrom(ctx, "text", "text", t);
      if (v) emit(ctx, "text", { text: v.slice(0, limits.maxField), size: 15, align: "left" }, "plain text file", "plain text with no markup");
    } else {
      const card = findCard(parsed.root);
      if (card.el !== parsed.root) {
        bump(ctx.recognised, `content column (${card.width || "auto"}px)`, "walked as the mail body");
      }
      if (/\/t\/c\/[A-Za-z0-9_.-]+\?u=/.test(src)) bump(ctx.recognised, "click-tracking redirects", "unwrapped back to the real links");
      if (/\/t\/o\/[A-Za-z0-9_.-]+\.gif/.test(src)) bump(ctx.removed, "open-tracking pixel", undefined, "belongs to the send it came from, so it is not carried over");
      ctx.preheader = findPreheader(parsed.root, card.el);
      // Chosen from the whole document, not just the card: a mail can carry its
      // legal band outside the content column.
      ctx.footerEl = findFooter(parsed.root, card.el);
      walkFlow(card.el, ctx, 0);
      // The content column was a guess. If it yielded nothing, the guess was
      // wrong and the real copy is somewhere else in the file — walking the whole
      // document is slower and noisier, and still better than importing nothing.
      if (!ctx.out.length && card.el !== parsed.root) {
        bump(ctx.approximated, "the detected content column was empty — the whole file was walked instead", "every block");
        walkFlow(parsed.root, ctx, 0);
      }
      // Last resort. Nothing matched, but the file has words in it: keep the
      // markup verbatim in the one block that accepts markup rather than hand
      // back an empty document and call it an import.
      if (!ctx.out.length && words(plainOf(parsed.root)).length > 3) {
        fallbackHtml(parsed.root, ctx, "the whole document");
      }
    }

    // ---- assemble ----------------------------------------------------------
    let raw = mergeRuns(ctx);
    const blocks: Block[] = [];
    for (const b of raw) {
      const v = validateBlock(b.type, b.props, (w) => { if (ctx.warnings.length < 40) ctx.warnings.push(w); });
      if (v) blocks.push(v);
    }
    doc = {
      ...doc,
      subject: opts.subject || parsed.title || firstHeadingText(blocks) || "Imported mailer",
      preheader: opts.preheader || ctx.preheader,
      blocks,
    };

    // ---- report ------------------------------------------------------------
    report.blocks = blocks.length;
    for (const b of blocks) report.byType[b.type] = (report.byType[b.type] || 0) + 1;
    const rendered = (() => { try { return renderDoc(doc, event); } catch { return ""; } })();
    const cov = coverage(parsed.root, blocks, rendered);
    // An empty document carried NOTHING over — never the "100%" that a 0/0 ratio
    // would otherwise read as (a source with no countable words divided by the
    // same). "Nothing in, nothing out" is 0% survived, and the warning below says
    // it in words too.
    report.textCoverage = blocks.length ? cov.ratio : 0;
    report.lostText = cov.lost;
    const pics = imageCoverage(parsed.root, rendered);
    report.imageCoverage = pics.ratio;
    report.imagesInSource = pics.inSource;
    report.imagesInMail = pics.inMail;
    report.lostImages = pics.lost;
    // The count and the percentage are derived from the SAME de-duplicated set,
    // so "N of M not imported" and the coverage % always reconcile: M − N reach
    // the mail, and that is exactly what the % is over.
    if (pics.lost.length) ctx.warnings.push(`${pics.lost.length} of ${pics.inSource} image(s) in the file are not in the imported mail`);
    if (!blocks.length) ctx.warnings.push("nothing in the file could be turned into a block — the document is empty");

    // ---- guidance: what a low number LIKELY means, and what to do ----------
    // The percentages above are honest and stay honest; these sentences keep a
    // bad one from reading as a fault the sender caused. Actionable, never
    // accusatory — the file used a layout we could not fully read, not "you did
    // something wrong". The studio pairs these with an Undo import control.
    if (!blocks.length) {
      report.guidance.push(
        "We couldn’t turn this file into editable sections — it’s probably built in a way this importer can’t read yet. Nothing was changed; undo the import and try the original design tool, or send us the file so we can add support for it.");
    } else {
      if (report.textCoverage < 0.7) {
        report.guidance.push(
          "Some of the wording didn’t come across — this file used a layout we couldn’t fully read, so a section or two may be missing. Compare it with your original, and use Undo import if it isn’t right.");
      }
      if (pics.inSource >= 2 && report.imageCoverage < 0.6) {
        const gone = pics.inSource - pics.inMail;
        report.guidance.push(
          `${gone} of the ${pics.inSource} pictures in the file didn’t come across, usually because of how they were placed in the original. Check the images against your source before sending — you can re-add any that are missing.`);
      }
    }
  } catch (err: any) {
    // A malformed upload must never take the request down. The doc built so far
    // (possibly empty) is still valid, and the report says what happened.
    report.ok = false;
    ctx.warnings.push(`import failed: ${String(err?.message || err).slice(0, 300)}`);
  } finally {
    SHEET = [];
  }

  // One merged note for all the speaker "Role, Company" splits, with the number
  // baked into the text (so the UI shows a sentence, not a "×N"), instead of one
  // line per grid.
  if (ctx.speakerSplit) {
    bump(ctx.approximated,
      `Split the combined “Role, Company” line into separate role and company fields for ${ctx.speakerSplit} speaker${ctx.speakerSplit === 1 ? "" : "s"}`,
      "speakers");
  }

  report.recognised = [...ctx.recognised.values()];
  report.approximated = [...ctx.approximated.values()];
  report.unrepresented = [...ctx.unrepresented.values()];
  report.removed = [...ctx.removed.values()];
  report.removedSummary = humaniseRemoved(report.removed);
  report.warnings = [...report.warnings, ...ctx.warnings];
  return { doc, report };
}

/** The raw `removed` keys, in a MARKETER's language.
 *
 *  Everything stripped at parse time is real, and the SECURITY behaviour is not
 *  touched here — the same things are still removed. This only changes how the
 *  removals are DESCRIBED. "on* handler ×122", "unsafe URL ×85", "<body>
 *  unwrapped" read, to a non-technical sender, as though 85 of their links were
 *  broken; in fact what went was invisible editor scaffolding and inert code the
 *  mail never showed. So the technical keys collapse into a couple of calm
 *  groups, and a count is kept only where it means something to a person —
 *  genuine images that could not be carried over — never for chrome nobody sees. */
const SAFETY_KEYS = new Set([
  // Executes, embeds, or loads something that executes.
  "script", "noscript", "iframe", "object", "embed", "applet", "frame", "frameset",
  "svg", "math", "on* handler", "binding attribute", "srcdoc", "formaction", "ping",
  "unsafe URL", "executable CSS", "unsafe CSS url()",
  // Interactive / form controls no email client runs.
  "select", "textarea", "input", "keygen", "param", "source", "track",
]);

function humaniseRemoved(raw: ImportNote[]): ImportNote[] {
  let structure = 0;   // document tags, meta/link/style, unwrapped wrappers, editor chrome, old tracking pixel
  let safety = 0;      // scripts, handlers, unsafe URLs, executable CSS, embeds, form controls
  let hidden = 0;      // content the source deliberately hid
  let lostImages = 0;  // genuine images whose address a mail client cannot load
  for (const n of raw) {
    const w = n.what;
    if (w === "image with an unusable URL") { lostImages += n.count; continue; }
    if (w === "hidden element") { hidden += n.count; continue; }
    if (SAFETY_KEYS.has(w)) { safety += n.count; continue; }
    // Everything else — unwrapped layout wrappers, document/meta/style tags, the
    // saved editor's own chrome, the previous send's tracking pixel — is
    // invisible page plumbing, not content.
    structure += n.count;
  }
  const out: ImportNote[] = [];
  if (structure) out.push({
    what: "Tidied up editor code and page structure",
    as: "doesn’t affect your content",
    detail: "Layout scaffolding, editor toolbars and document tags that email programs wrap around the words — none of it is shown to a reader.",
    count: 1,
  });
  if (safety) out.push({
    what: "Removed some inactive code for safety",
    as: "your links and text are unaffected",
    detail: "Scripts, click handlers and embeds that no email app runs, cleared as a routine precaution. Your real links, images and copy come across untouched.",
    count: 1,
  });
  if (hidden) out.push({
    what: "Left out content the original kept hidden",
    as: "not shown to readers",
    detail: "Sections the source file hid from view were skipped, so the import matches what recipients actually saw.",
    count: 1,
  });
  if (lostImages) out.push({
    what: lostImages === 1 ? "1 image couldn’t be brought over" : `${lostImages} images couldn’t be brought over`,
    as: "broken address in the original",
    detail: "Their address wasn’t one an email program could load, so they were left out rather than shown as a broken picture. Everything else came across — you can re-add any you still need.",
    count: 1,
  });
  return out;
}

function pickLimits(o: ImportOptions) {
  const out: Record<string, number> = {};
  for (const k of ["maxBytes", "maxBlocks", "maxNodes", "maxDepth"] as const) {
    const v = (o as any)[k];
    if (Number.isFinite(v) && v > 0) out[k] = Number(v);
  }
  return out;
}

function firstHeadingText(blocks: Block[]): string {
  const h = blocks.find((b) => b.type === "heading" || b.type === "hero");
  const t = visibleOf(String(h?.props?.text ?? h?.props?.title ?? ""))
    .replace(ZERO_WIDTH, "").replace(/[*_~=]/g, "").trim();
  return t.slice(0, 160);
}

/** The mail's content column. Real emails wrap the card in one or two full-width
 *  tables of page wash; importing those as blocks would add empty rows around
 *  everything. The widest table that is still a column (320–900px) and holds the
 *  most text wins. */
function findCard(root: El): { el: El; width?: number } {
  let best: { el: El; width: number; score: number } | undefined;
  const walk = (el: El, depth: number) => {
    if (depth > 20) return;
    for (const c of kids(el)) {
      if (c.tag === "table") {
        const st = styleOf(c);
        const w = px(st["max-width"]) || Number(attr(c, "width")) || px(st.width) || 0;
        if (w >= 320 && w <= 900) {
          const score = plainOf(c).length;
          if (!best || score > best.score) best = { el: c, width: w, score };
        }
      }
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return best ? { el: best.el, width: best.width } : { el: root };
}

/** The hidden preview line every ESP puts at the top of the body. It is content,
 *  but it belongs on the document, not in a block. */
function findPreheader(root: El, card: El): string {
  let found = "";
  const walk = (el: El, depth: number) => {
    if (found || depth > 12) return;
    for (const c of kids(el)) {
      if (c === card) continue;
      if (isHidden(c)) {
        const t = plainOf(c).replace(/\s+/g, " ").trim();
        if (t && t.length <= 600) { found = t; return; }
      }
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

// ---- the walker -------------------------------------------------------------

function walkFlow(el: El, ctx: Ctx, depth: number): void {
  if (depth > 60 || ctx.out.length >= ctx.limits.maxBlocks) return;
  let pending = "";
  const flushText = () => {
    const t = pending.trim();
    pending = "";
    const v = fieldFrom(ctx, "text", "text", t);
    if (v) emit(ctx, "text", { text: v.slice(0, ctx.limits.maxField), size: 15, align: "left" }, "loose copy");
  };
  for (const child of el.children) {
    if (child.kind === "text") { pending += child.text; continue; }
    flushText();
    emitFor(child, ctx, depth + 1);
  }
  flushText();
}

function emitFor(el: El, ctx: Ctx, depth: number): void {
  if (depth > 60 || ctx.out.length >= ctx.limits.maxBlocks) return;
  const tag = el.tag;

  if (tag === "br" || tag === "wbr" || tag === "col" || tag === "colgroup") return;

  if (isEditorChrome(el)) {
    bump(ctx.removed, "editor UI (meditor / CKEditor chrome)", undefined,
      "the saved editor's own toolbar and rich-text widgets were stripped, not imported");
    return;
  }
  if (isHidden(el)) {
    const t = plainOf(el).trim();
    if (t) bump(ctx.removed, "hidden element", undefined, "content the mail deliberately hides was not imported");
    return;
  }
  if (isDecoration(el)) {
    bump(ctx.unrepresented, "decoration the stylesheet hides", undefined, "skipped — it is not shown in the mail and carries no words");
    return;
  }

  if (tag === "hr") { emit(ctx, "divider", {}, "<hr>"); return; }

  if (/^h[1-6]$/.test(tag)) {
    const t = fieldText(ctx, "heading", "text", el).replace(/\n+/g, " ").trim();
    if (!t) return;
    const st = visualOf(el);
    const DEF: Record<string, number> = { h1: 30, h2: 24, h3: 20, h4: 18, h5: 16, h6: 14 };
    emit(ctx, "heading", {
      text: t.slice(0, 400),
      size: Math.round(px(st["font-size"]) || DEF[tag] || 22),
      align: alignOf(el, st),
      caps: /uppercase/i.test(st["text-transform"] || "") ? "yes" : "no",
      eyebrow: "",
    }, `<${tag}>`);
    return;
  }

  if (tag === "ul" || tag === "ol") { emitList(el, ctx); return; }

  if (tag === "img") { emitImage(el, ctx, undefined); return; }

  if (tag === "blockquote") {
    const t = fieldText(ctx, "quote", "text", el).trim();
    if (t) emit(ctx, "quote", { text: t.slice(0, 2000), cite: "" }, "<blockquote>");
    return;
  }

  if (tag === "a") {
    const imgs = imgsIn(el);
    if (imgs.length === 1 && !plainOf(el).trim()) { emitImage(imgs[0], ctx, attr(el, "href")); return; }
    if (looksLikeButton(el, undefined)) { emitButton(el, ctx, undefined); return; }
    // A bare link in the flow is copy; the marker keeps it clickable. The marker
    // has to be built HERE — `linesOf` walks an element's CHILDREN, so handing it
    // the anchor itself would read the label and silently drop the href.
    const label = plainOf(el).replace(/\s+/g, " ").trim();
    if (!label) return;
    const href = cleanUrl(attr(el, "href")) || "";
    const linkable = /^https?:\/\/[^\s()<>"'`\\]+$/.test(href) && !/[\[\]()]/.test(label) && !/\*|__|~~|==/.test(href);
    const t = fieldFrom(ctx, "text", "text", linkable ? `${S.lo}${label}${S.lm}${href}${S.lc}` : label);
    if (!t) return;
    emit(ctx, "text", { text: t.slice(0, 2000), size: 15, align: "left" }, "inline link", "a standalone link became a paragraph");
    return;
  }

  if (tag === "table") { emitTable(el, ctx, depth); return; }
  if (tag === "tr") { for (const c of cellsOf(el)) emitFor(c, ctx, depth + 1); return; }

  // ---- containers --------------------------------------------------------
  if (!hasContent(el)) { emitEmpty(el, ctx); return; }

  if (!ctx.sawFooter && el === ctx.footerEl) { emitFooter(el, ctx); return; }
  if (tryHero(el, ctx)) return;
  if (tryContacts(el, ctx)) return;

  const imgs = imgsIn(el);
  // An anchor is INLINE, so a cell holding nothing but a painted CTA reads as a
  // text leaf and used to be imported as a heading — with the link marker
  // printed at the reader. Check for the button before the type is inspected.
  const own = anchorsIn(el);
  if (own.length === 1 && !imgs.length && looksLikeButton(own[0], el)
    && plainOf(own[0]).trim() && plainOf(el).trim() === plainOf(own[0]).trim()) {
    emitButton(own[0], ctx, el);
    return;
  }
  const leaf = isTextLeaf(el);
  if (leaf) { emitTextish(el, ctx); return; }

  // A container holding exactly one image and nothing else is that image.
  if (imgs.length === 1 && !plainOf(el).trim()) {
    const a = anchorsIn(el)[0];
    emitImage(imgs[0], ctx, a ? attr(a, "href") : undefined);
    return;
  }

  const before = ctx.out.length;
  walkFlow(el, ctx, depth);
  if (ctx.out.length === before) fallbackHtml(el, ctx, `<${tag}>`);
}

function alignOf(el: El, st?: Record<string, string>): string {
  const s = st || visualOf(el);
  const v = String(s["text-align"] || attr(el, "align") || "left").toLowerCase();
  return v === "center" || v === "right" ? v : "left";
}

/** Every descendant is inline and there is no image — the element IS a run of
 *  copy, not a layout. */
function isTextLeaf(el: El): boolean {
  let ok = true;
  const walk = (n: TNode, depth: number) => {
    if (!ok || depth > 30 || n.kind === "text") return;
    if (n.tag === "img" || !INLINE.has(n.tag)) {
      if (n.tag !== "br") { ok = false; return; }
    }
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const c of el.children) walk(c, 0);
  return ok;
}

function emitTextish(el: El, ctx: Ctx): void {
  const st = visualOf(el);
  const fs = px(st["font-size"]) || 15;
  const weight = weightOf(st["font-weight"]);
  const caps = /uppercase/i.test(st["text-transform"] || "");
  const align = alignOf(el, st);
  const plain = plainOf(el).trim();
  if (!plain) { emitEmpty(el, ctx); return; }

  // A short, uppercase, letter-spaced line is the house section label; a big or
  // heavy line is a heading. Everything else is body copy.
  // Tracking is nearly always given in `em` (".16em"), so any POSITIVE value
  // counts — testing for a px threshold read .16em as 0.16 and sent every section
  // label back as a paragraph.
  const ls = px(st["letter-spacing"]);
  const spaced = ls !== undefined && ls > 0;
  if (caps && spaced && plain.length <= 80 && !/\n/.test(plain)) {
    emit(ctx, "heading", {
      text: fieldText(ctx, "heading", "text", el).replace(/\n+/g, " ").trim().slice(0, 200),
      size: Math.round(fs), caps: "yes", align, eyebrow: "",
    }, "section label");
    return;
  }
  if ((fs >= 19 || (weight >= 700 && fs >= 16)) && plain.length <= 220 && !/\n/.test(plain)) {
    emit(ctx, "heading", {
      text: fieldText(ctx, "heading", "text", el).replace(/\n+/g, " ").trim().slice(0, 300),
      size: Math.round(fs), caps: "no", align, eyebrow: "",
    }, "heading (styled text)");
    return;
  }
  const text = fieldText(ctx, "text", "text", el).trim();
  if (!text) return;
  // `inlineCopy`'s link marker only accepts http(s), so a mailto:/tel: inside a
  // paragraph keeps its words and loses its href. Said out loud rather than
  // patched over: rewriting the copy to paste the address in would be inventing
  // content, and the sender can add it back in two keystrokes.
  if (anchorsIn(el).some((a) => /^(mailto|tel):/i.test(attr(a, "href")))) {
    bump(ctx.approximated, "mailto: / tel: link inside copy became plain text", "text",
      "only http(s) links survive as an inline marker — move it to a Contact rows block to keep it clickable");
  }
  emit(ctx, "text", {
    text: text.slice(0, ctx.limits.maxField),
    size: Math.round(fs), align,
    weight: String(weight >= 700 ? 700 : weight >= 500 ? 500 : 400),
    lh: lhOf(st["line-height"], fs),
    italic: /italic/i.test(st["font-style"] || "") ? "yes" : "no",
    underline: /underline/i.test(st["text-decoration"] || "") ? "yes" : "no",
    caps: caps ? "yes" : "no",
  }, "paragraph");
}

const weightOf = (v?: string): number => {
  const s = String(v || "").toLowerCase();
  if (/bold|bolder/.test(s)) return 700;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 400;
};
const lhOf = (v: string | undefined, fs: number): string => {
  if (!v) return "1.55";
  const n = /px/.test(v) ? (px(v) || 0) / (fs || 15) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return "1.55";
  return n < 1.45 ? "1.35" : n > 1.68 ? "1.8" : "1.55";
};

/** An element with no content: a spacer cell, a hairline rule, or nothing at all. */
function emitEmpty(el: El, ctx: Ctx): void {
  const st = visualOf(el);
  const h = px(st.height) || Number(attr(el, "height")) || 0;
  const bg = st["background-color"] || st.background || attr(el, "bgcolor") || "";
  const border = st["border-top"] || st["border-bottom"] || "";
  if ((h > 0 && h <= 2 && bg) || border) { emit(ctx, "divider", {}, "hairline rule"); return; }
  // 3–7px of solid colour is a brand band, not a rule and not rhythm — importing
  // it as a divider put a hairline at the top of every mail this app made.
  if (h > 2 && h < 8) { bump(ctx.unrepresented, "decorative colour band", undefined, "a few pixels of solid colour with no block equivalent"); return; }
  if (h >= 8) { emit(ctx, "spacer", { height: Math.min(200, Math.round(h)) }, "spacer"); return; }
  // Recurse: an "empty" wrapper may still hold a nested rule.
  for (const c of kids(el)) if (c.tag === "table" || c.tag === "div" || c.tag === "tr" || c.tag === "td") { emitFor(c, ctx, 50); return; }
}

function emitImage(img: El, ctx: Ctx, href?: string): void {
  const url = cleanUrl(attr(img, "src"));
  if (!url || isSpacerImg(img)) {
    if (attr(img, "src")) bump(ctx.removed, "image with an unusable URL", undefined, "src was not a URL a mail client would load");
    return;
  }
  const st = styleOf(img);
  const w = Number(attr(img, "width")) || px(st.width) || px(st["max-width"]) || 0;
  const alt = String(attr(img, "alt") || "").slice(0, 300);
  const logoish = /logo|masthead|wordmark|brand/i.test(`${url} ${alt} ${attr(img, "class")}`);
  const link = cleanUrl(href || "");

  if (logoish && !ctx.sawLogo && (!w || w <= 400)) {
    ctx.sawLogo = true;
    emit(ctx, "logobar", { logo: url, href: link || "", right: "" }, "masthead / logo");
    return;
  }
  // …or an image the sender NAMED as the banner. ET's house mailer ships
  // `class="banner_img max-full"` with no width attribute at all, so size alone
  // never found it. Deliberately not a bare `og`/`header`: "og" is a substring of
  // "logo", which is the one thing this must not claim.
  const named = /(banner|hero|keyvisual|key[-_]visual|seo[-_]?image|og[-_]?image)/i
    .test(`${url} ${alt} ${attr(img, "class")}`);
  if (!ctx.sawBanner && (w >= 500 || ((!w || w >= 400) && named))) {
    ctx.sawBanner = true;
    emit(ctx, "banner", { url, href: link || "", alt }, "banner image");
    return;
  }
  emit(ctx, "image", {
    url, href: link || "", alt,
    ...(w ? { width: Math.min(686, Math.round(w)) } : {}),
  }, "inline image");
}

/** An anchor is a BUTTON when it is painted like one: a fill or border of its
 *  own, or a cell whose only job is to paint it. This is the shape every
 *  table-based email uses for a CTA. */
function looksLikeButton(a: El, cell?: El): boolean {
  const st = styleOf(a);
  const cls = `${attr(a, "class")} ${cell ? attr(cell, "class") : ""}`;
  if (/\bbtn\b|button|cta/i.test(cls)) return true;
  const painted = (s: Record<string, string>) =>
    !!(s["background-color"] || s.background || s["border-radius"] || /solid/.test(s.border || ""));
  const padded = !!st.padding || !!st["padding-top"] || !!st["padding-left"];
  if (painted(st) && padded) return true;
  if (cell) {
    const cs = styleOf(cell);
    if ((painted(cs) || attr(cell, "bgcolor")) && (padded || /inline-block|block/.test(st.display || ""))) return true;
  }
  return false;
}

function emitButton(a: El, ctx: Ctx, cell?: El): void {
  const label = plainOf(a).replace(/\s+/g, " ").trim();
  if (!label) return;
  const st = styleOf(a);
  const cs = cell ? styleOf(cell) : {};
  // Real mails write `background: rgb(3, 104, 166)` at least as often as a hex,
  // and the `color` field only accepts a hex — so convert rather than discard.
  const hex = (v?: string) => {
    const t = String(v || "").trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return t;
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
    if (!m) return "";
    if (m[4] !== undefined && Number(m[4]) < 0.5) return "";       // effectively transparent
    const to = (x: string) => Math.max(0, Math.min(255, Math.round(Number(x)))).toString(16).padStart(2, "0");
    return `#${to(m[1])}${to(m[2])}${to(m[3])}`;
  };
  const bg = hex(cs["background-color"]) || hex(cs.background) || hex(cell ? attr(cell, "bgcolor") : "") || hex(st["background-color"]) || hex(st.background);
  const radius = px(cs["border-radius"]) ?? px(st["border-radius"]);
  const caps = /uppercase/i.test(`${st["text-transform"]} ${cs["text-transform"]}`);
  emit(ctx, "button", {
    label: label.slice(0, 120),
    href: cleanUrl(attr(a, "href")) || "",
    note: "",
    variant: bg ? "solid" : "outline",
    ...(bg ? { bg } : {}),
    ...(radius !== undefined ? { radius: Math.max(0, Math.min(99, Math.round(radius))) } : {}),
    ...(px(st["font-size"]) ? { fontSize: Math.round(px(st["font-size"]) as number) } : {}),
    align: cell ? alignOf(cell) : "left",
    caps: caps ? "yes" : "no",
    full: /block/.test(st.display || "") && !/inline/.test(st.display || "") ? "yes" : "no",
  }, "call-to-action button");
}

/** ET builds its speaker grids as a LIST, not as table cells:
 *  `<ul class="speaker_listing"><li><img><strong>Name</strong><p>Role, Company</p></li>`.
 *  The grid recognisers only ever inspected table cells, so eighteen people with
 *  photographs fell through to `bullets` — a block with no image field — and
 *  every portrait was lost while the word count still read 100%. */
function trySpeakerList(el: El, ctx: Ctx): boolean {
  const lis = kids(el).filter((c) => c.tag === "li");
  if (lis.length < 2) return false;
  const rows = lis.map((li) => ({ li, imgs: imgsIn(li), lines: linesOf(li, false).map((l) => l.text).filter(Boolean) }));
  // Every entry must be a person: exactly one photograph and a name, at most a
  // role and a company under it. Anything looser and a list of illustrated
  // bullet points would import as a cast of speakers.
  if (!rows.every((r) => r.imgs.length === 1 && r.lines.length >= 1 && r.lines.length <= 3)) return false;
  if (rows.some((r) => !r.lines[0] || r.lines[0].length > 70)) return false;
  if (!rows.every((r) => cleanUrl(attr(r.imgs[0], "src")))) return false;

  let split = 0;
  const items = rows.map((r) => {
    let role = r.lines[1] || "";
    let company = r.lines.slice(2).join(", ");
    // "CISO, State Bank of India" is one field in the source and two here. Split
    // at the LAST comma — a role may well contain one ("EVP & CISO, Reliance"),
    // a company name much more rarely carries another clause after it.
    if (role && !company) {
      const at = role.lastIndexOf(",");
      const tail = at > 0 ? role.slice(at + 1).trim() : "";
      if (tail.length >= 2 && tail.length <= 45) { company = tail; role = role.slice(0, at).trim(); split++; }
    }
    return { name: r.lines[0], role, company, photo: cleanUrl(attr(r.imgs[0], "src")) || "" };
  });
  emit(ctx, "speakers", {
    title: "", style: "cards",
    cols: String(Math.max(1, Math.min(4, items.length >= 3 ? 3 : items.length))),
    max: items.length, items: items.slice(0, ctx.limits.maxItems),
  }, "speaker list (<ul> of people)");
  // Accumulated across every list in the file and reported ONCE at the end, so a
  // mail with two speaker grids does not print two near-identical split lines.
  ctx.speakerSplit += split;
  return true;
}

function emitList(el: El, ctx: Ctx): void {
  if (trySpeakerList(el, ctx)) return;
  const items = kids(el).filter((c) => c.tag === "li")
    .map((li) => ({ text: fieldText(ctx, "bullets", "items", li).replace(/\n+/g, " ").trim() }))
    .filter((x) => x.text);
  if (!items.length) return;
  emit(ctx, "bullets", {
    title: "",
    style: el.tag === "ol" ? "numbered" : "plain",
    items: items.slice(0, ctx.limits.maxItems),
  }, el.tag === "ol" ? "<ol> list" : "<ul> list");
}

const FOOTER_RE = /unsubscrib|opt[- ]?out|manage (your )?preferences|\{\$\$!!unsubscribelink!!\$\$\}/i;
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const LISTS = new Set(["ul", "ol", "dl"]);

function hasTagIn(el: El, set: Set<string>, depth = 0): boolean {
  if (depth > 40) return false;
  for (const c of kids(el)) if (set.has(c.tag) || hasTagIn(c, set, depth + 1)) return true;
  return false;
}
/** Largest inline font-size anywhere in the subtree. 0 when nothing declares one. */
function maxFontSize(el: El, depth = 0): number {
  let max = px(styleOf(el)["font-size"]) || 0;
  if (depth > 40) return max;
  for (const c of kids(el)) max = Math.max(max, maxFontSize(c, depth + 1));
  return max;
}
/** Any image bigger than an icon. Unknown size counts as big: a false "this is
 *  not a footer" costs a block type, a false "this IS a footer" costs the mail. */
function hasRealImage(el: El): boolean {
  return imgsIn(el).some((i) => {
    if (!cleanUrl(attr(i, "src"))) return false;
    const st = styleOf(i);
    const w = Number(attr(i, "width")) || px(st.width) || px(st["max-width"]) || 0;
    return !w || w > 48;
  });
}
/** A nested table laying content out in columns — i.e. real structure. */
function hasGridRow(el: El, depth = 0): boolean {
  if (depth > 30) return false;
  for (const c of kids(el)) {
    if (c.tag === "table" && rowsOf(c).some((tr) => cellsOf(tr).filter(hasContent).length >= 2)) return true;
    if (hasGridRow(c, depth + 1)) return true;
  }
  return false;
}
function hasButtonLike(el: El, cell?: El, depth = 0): boolean {
  if (depth > 30) return false;
  for (const c of kids(el)) {
    if (c.tag === "a" && looksLikeButton(c, cell)) return true;
    if (hasButtonLike(c, c.tag === "td" || c.tag === "th" ? c : cell, depth + 1)) return true;
  }
  return false;
}

/** Is this element PLAUSIBLY JUST A FOOTER?
 *
 *  Matching on the word "unsubscribe" alone is what made a real marketing email
 *  import as one block: those mails are a single wrapper table with a legal line
 *  at the bottom, so the wrapper contained the word and the whole mail — heading,
 *  banner, CTA and all — disappeared into a `footer`. A container only counts
 *  when it holds nothing a footer would never hold. */
function isFooterish(el: El): boolean {
  if (INLINE.has(el.tag) || isHidden(el)) return false;
  const t = plainOf(el).replace(/\s+/g, " ").trim();
  if (!FOOTER_RE.test(t) || !t.length || t.length > 800) return false;
  // A legal band is a couple of lines. More than that and the element is holding
  // a mail that merely ENDS with an unsubscribe line.
  if (linesOf(el, false).length > 6) return false;
  if (hasTagIn(el, HEADINGS) || hasTagIn(el, LISTS)) return false;
  if (maxFontSize(el) >= 17) return false;
  if (hasRealImage(el)) return false;
  if (hasButtonLike(el)) return false;
  if (hasGridRow(el)) return false;
  return true;
}

/** The footer is chosen ONCE, before the walk, so the decision is made with the
 *  whole document in view instead of by whichever container happened to be
 *  visited first.
 *
 *  Topmost-then-last: descent stops at a qualifying element (so the block is the
 *  whole legal band, not the bare `<a>Unsubscribe</a>` inside it), and of the
 *  candidates found, the LAST in document order wins (so a "having trouble
 *  viewing / unsubscribe" line at the top cannot claim the role the real footer
 *  should have). */
function findFooter(root: El, card: El): El | undefined {
  const found: El[] = [];
  // `emitTable` walks a single-column table cell by cell, so a <tr> is never
  // handed to `emitFor` and naming one here would silently mean "no footer".
  // The candidate has to be an element the walker will actually visit.
  const PASS_THROUGH = new Set(["tr", "tbody", "thead", "tfoot", "colgroup"]);
  const walk = (el: El, depth: number) => {
    if (depth > 40) return;
    for (const c of kids(el)) {
      if (isHidden(c)) continue;
      // The content column is entered by `walkFlow`, which never offers the
      // element itself to a recogniser — naming it here would mean "no footer".
      // It is also, by definition, the whole mail.
      const eligible = c !== card && !PASS_THROUGH.has(c.tag);
      if (eligible && isFooterish(c)) found.push(c);
      else walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return found[found.length - 1];
}

function emitFooter(el: El, ctx: Ctx): void {
  ctx.sawFooter = true;
  const lines = linesOf(el, false);
  const anchors = anchorsIn(el);
  const unsub = anchors.map((a) => attr(a, "href")).find((h) => /unsubscrib|\{\$\$!!/i.test(h))
    || anchors.find((a) => /unsubscrib/i.test(plainOf(a)))?.attrs.href
    || "";
  // The footer block prints its own legal sentence; what is worth carrying over
  // is the sender's own address line and the ESP's unsubscribe target.
  // Only the address/legal lines beside the unsubscribe sentence. This used to
  // take every line in the container, which is how a mis-claimed footer could
  // swallow a whole mail into one prop and still measure as "text preserved".
  const addr = lines.map((l) => l.text)
    .filter((t) => !FOOTER_RE.test(t) && t.length > 12 && t.length <= 200)
    .slice(0, 3).join(" ").trim();
  emit(ctx, "footer", {
    portal: "",
    unsubscribe: cleanUrl(unsub) || "{$$!!unsubscribelink!!$$}",
    ...(addr ? { address: addr.slice(0, 600) } : {}),
  }, "legal footer / unsubscribe");
  const dropped = lines.map((l) => l.text).filter((t) => FOOTER_RE.test(t)).join(" ");
  if (dropped) bump(ctx.approximated, "footer wording replaced by the house unsubscribe line", "footer");
}

/** A coloured or photographic band carrying a headline, a line or two of copy
 *  and at most a couple of buttons — the hero every event mail opens with. */
function tryHero(el: El, ctx: Ctx): boolean {
  if (el.tag !== "td" && el.tag !== "div") return false;
  const st = styleOf(el);
  const bg = st["background-color"] || st.background || attr(el, "bgcolor") || "";
  const bgImage = /url\((['"]?)(https?:[^)'"]+)\1\)/i.exec(st["background-image"] || st.background || "");
  if (!bg && !bgImage) return false;
  if (imgsIn(el).length) return false;
  // Same over-match as the footer had: a coloured wrapper cell holding a short
  // mail would otherwise be claimed as a hero. A hero band carries a headline and
  // a line or two — never a list, a rule or a column layout.
  if (hasTagIn(el, LISTS) || hasTagIn(el, new Set(["hr"])) || hasGridRow(el)) return false;
  const lines = linesOf(el, false);
  if (lines.length < 1 || lines.length > 6) return false;
  const heads = findBig(el);
  if (!heads) return false;
  const anchors = anchorsIn(el);
  if (anchors.length > 2) return false;

  const texts = lines.map((l) => l.text).filter((t) => !anchors.some((a) => plainOf(a).trim() === t));
  const title = heads.text;
  const at = texts.indexOf(title);
  if (at < 0) return false;
  // The block has exactly four slots for copy — ribbon, title, sub, meta. Claim
  // it only when everything present FITS in them; anything more would be
  // silently dropped, which is the one outcome worse than a plain import.
  const before = texts.slice(0, at);
  const after = texts.slice(at + 1);
  if (before.length > 1 || after.length > 2) return false;
  const photo = bgImage ? cleanUrl(bgImage[2]) : undefined;
  emit(ctx, "hero", {
    ribbon: (before[0] || "").slice(0, 120),
    title: fieldFrom(ctx, "hero", "title", title).slice(0, 300),
    sub: fieldFrom(ctx, "hero", "sub", after[0] || "").slice(0, 600),
    meta: (after[1] || "").slice(0, 200),
    style: photo ? "photo" : "gradient",
    ...(photo ? { photo } : {}),
    align: alignOf(el, st),
    cta1: anchors[0] ? plainOf(anchors[0]).trim().slice(0, 60) : "",
    cta1href: anchors[0] ? cleanUrl(attr(anchors[0], "href")) || "" : "",
    cta2: anchors[1] ? plainOf(anchors[1]).trim().slice(0, 60) : "",
    cta2href: anchors[1] ? cleanUrl(attr(anchors[1], "href")) || "" : "",
  }, "hero band");
  if (bg && !photo) bump(ctx.approximated, "hero band repainted in the mailer's own palette", "hero");
  return true;
}

/** The largest piece of type inside a band, if it reads as a headline. */
function findBig(el: El): { text: string; size: number } | undefined {
  let best: { text: string; size: number } | undefined;
  const walk = (n: El, depth: number, inherited: number) => {
    if (depth > 12) return;
    for (const c of kids(n)) {
      const st = styleOf(c);
      const fs = px(st["font-size"]) || inherited;
      const t = plainOf(c).replace(/\s+/g, " ").trim();
      if (fs >= 22 && t && t.length <= 200 && isTextLeaf(c)) {
        if (!best || fs > best.size) best = { text: t, size: fs };
      }
      walk(c, depth + 1, fs);
    }
  };
  walk(el, 0, 0);
  return best;
}

/** "For Delegation — Name | email | phone" rows. Recognised by the mailto links:
 *  a `text` block would lose them (only http(s) survives the link marker). */
function tryContacts(el: El, ctx: Ctx): boolean {
  const lines = linesOf(el, false);
  if (!lines.length || lines.length > 14) return false;
  const mails = lines.flatMap((l) => l.links).filter((l) => /^mailto:/i.test(l.href));
  if (!mails.length) return false;
  if (imgsIn(el).length) return false;
  // A single mailto is not enough: this must be a BLOCK OF CONTACT ROWS, not a
  // section that happens to mention an address. Every line has to be either a
  // contact line or a short label above one — otherwise a paragraph ending in
  // "write to us" swallowed the four paragraphs above it.
  const contactish = lines.every((l) =>
    l.links.some((x) => /^(mailto|tel):/i.test(x.href))
    || (l.links.length === 0 && l.text.length <= 60));
  if (!contactish) return false;
  // …and it must hold nothing a block of contact rows would never hold, so a
  // wrapper that merely ends with an address cannot claim the whole mail.
  if (hasTagIn(el, HEADINGS) || hasTagIn(el, LISTS) || hasButtonLike(el) || hasGridRow(el)) return false;

  const items: any[] = [];
  let role = "";
  let title = "";
  for (const l of lines) {
    const email = l.links.find((x) => /^mailto:/i.test(x.href));
    const phone = l.links.find((x) => /^tel:/i.test(x.href));
    if (!email && !phone) {
      if (!items.length && !role && l.text.length <= 40 && l.text === l.text.toUpperCase()) title = l.text;
      else role = l.text.slice(0, 80);
      continue;
    }
    const strip = [email?.label, phone?.label].filter(Boolean) as string[];
    let name = l.text;
    for (const s of strip) name = name.split(s).join(" ");
    name = name.replace(/[|·•]/g, " ").replace(/\s+/g, " ").trim();
    items.push({
      role, name: name.slice(0, 120),
      email: (email?.href || "").replace(/^mailto:/i, "").slice(0, 200),
      phone: (phone?.href || "").replace(/^tel:/i, "").slice(0, 60),
    });
    role = "";
  }
  if (!items.length) return false;
  emit(ctx, "contacts", { title: fieldFrom(ctx, "contacts", "title", title) || "Contact us", items }, "contact rows");
  return true;
}

// ---- tables -----------------------------------------------------------------

interface CellInfo { el: El; imgs: El[]; lines: string[]; text: string; anchors: El[] }

function infoOf(td: El): CellInfo {
  const ls = linesOf(td, false).map((l) => l.text).filter(Boolean);
  return { el: td, imgs: imgsIn(td), lines: ls, text: ls.join("\n"), anchors: anchorsIn(td) };
}

function emitTable(table: El, ctx: Ctx, depth: number): void {
  if (ctx.out.length >= ctx.limits.maxBlocks) return;
  if (isHidden(table)) return;
  const rows = rowsOf(table);
  if (!rows.length) { if (hasContent(table)) walkFlow(table, ctx, depth); return; }

  if (!ctx.sawFooter && table === ctx.footerEl) { emitFooter(table, ctx); return; }

  const grids = rows.map((tr) => cellsOf(tr).filter((td) => hasContent(td) || px(styleOf(td).height)));
  const widest = Math.max(...grids.map((g) => g.length), 0);

  // Single-column tables are layout, not content: walk straight through them.
  if (widest <= 1) {
    // …unless the single cell IS a button or a spacer.
    const only = grids.find((g) => g.length === 1)?.[0];
    if (rows.length === 1 && only) {
      const as = anchorsIn(only);
      if (as.length === 1 && looksLikeButton(as[0], only) && !imgsIn(only).length) { emitButton(as[0], ctx, only); return; }
    }
    for (const tr of rows) {
      if (ctx.out.length >= ctx.limits.maxBlocks) return;
      const tds = cellsOf(tr);
      if (tds.length) {
        for (const td of tds) {
          if (ctx.out.length >= ctx.limits.maxBlocks) return;
          if (hasContent(td)) emitFor(td, ctx, depth + 1);
          else emitEmpty(td, ctx);
        }
      } else if (hasContent(tr)) {
        // ET's meditor wraps each section's cell in a <div class="editable_div">
        // BETWEEN the <tr> and its <td>, so the real cell is a grandchild that
        // `cellsOf` never sees. Walking the row rather than its (absent) direct
        // cells is what keeps the section — heading, bullets, CTA — from vanishing.
        walkFlow(tr, ctx, depth + 1);
      }
    }
    return;
  }

  // ---- a real grid -------------------------------------------------------
  const cells = grids.flat().map(infoOf);
  if (tryLogoBar(cells, ctx)) return;
  if (tryBulletTable(grids, ctx)) return;
  if (tryStats(cells, ctx)) return;
  if (trySpeakers(cells, ctx)) return;
  if (trySponsors(cells, ctx)) return;
  if (tryMeta(cells, ctx)) return;

  // No typed grid fits. Flattening keeps every word — losing them would be worse
  // than losing the columns — and the report says the columns are gone.
  bump(ctx.approximated, `${widest}-column layout flattened to a single column`, "sequential blocks");
  for (const c of cells) {
    if (ctx.out.length >= ctx.limits.maxBlocks) return;
    emitFor(c.el, ctx, depth + 1);
  }
}

function tryLogoBar(cells: CellInfo[], ctx: Ctx): boolean {
  if (ctx.sawLogo || cells.length !== 2) return false;
  const withImg = cells.filter((c) => c.imgs.length === 1 && !c.text.trim());
  const withText = cells.filter((c) => !c.imgs.length && c.text.trim().length <= 60);
  if (withImg.length !== 1 || withText.length !== 1) return false;
  const img = withImg[0].imgs[0];
  const url = cleanUrl(attr(img, "src"));
  if (!url) return false;
  ctx.sawLogo = true;
  const a = withImg[0].anchors[0];
  emit(ctx, "logobar", {
    logo: url,
    href: a ? cleanUrl(attr(a, "href")) || "" : "",
    right: withText[0].text.trim().slice(0, 60),
  }, "logo bar");
  return true;
}

/** Rows of "marker cell + copy cell" — how every table-based email draws a list. */
function tryBulletTable(grids: El[][], ctx: Ctx): boolean {
  const rows = grids.filter((g) => g.length);
  if (rows.length < 2 || !rows.every((g) => g.length === 2)) return false;
  const items: { text: string }[] = [];
  let numbered = false;
  let marker = "";
  for (const [a, b] of rows) {
    const lead = plainOf(a).trim();
    if (lead.length > 3) return false;
    if (imgsIn(a).length) return false;
    if (/^\d+\.?$/.test(lead)) numbered = true;
    else if (lead) marker = lead;
    const t = fieldText(ctx, "bullets", "items", b).replace(/\n+/g, " ").trim();
    if (!t) return false;
    items.push({ text: t });
  }
  if (!items.length) return false;
  const OPTIONS = new Set(["✓", "→", "•", "▪", "◆", "★", "»"]);
  emit(ctx, "bullets", {
    title: "",
    style: numbered ? "numbered" : "plain",
    ...(marker && OPTIONS.has(marker) ? { marker } : {}),
    items: items.slice(0, ctx.limits.maxItems),
  }, "bulleted list (table)");
  if (marker && !OPTIONS.has(marker)) bump(ctx.approximated, `bullet marker "${marker}" replaced with the house marker`, "bullets");
  return true;
}

const NUMERIC = /^[+₹$€£]?\s*\d[\d,.\s]*\s*(\+|%|k|m|bn|cr|lakh|°)?\s*$/i;
/** "2000+ Minutes of Networking" -> figure, caption. */
const SPLIT_FIGURE = /^([+₹$€£]?\d[\d,.]*\s*(?:\+|%|k|m|bn|cr|lakh|crore|°)?)\s+(\S.{1,58})$/i;

function tryStats(cells: CellInfo[], ctx: Ctx): boolean {
  const good = cells.filter((c) => !c.imgs.length && c.lines.length >= 1 && c.lines.length <= 3);
  if (good.length < 2 || good.length !== cells.length) return false;
  // The stats renderer shows six. Claiming a row of eight would quietly drop two
  // of them, so a longer row is left to import as ordinary blocks instead.
  if (good.length > 6) return false;
  const items: { value: string; label: string }[] = [];
  for (const c of good) {
    const numIdx = c.lines.findIndex((l) => NUMERIC.test(l) && l.length <= 12);
    if (numIdx < 0) {
      // The house ET band puts the figure in a <span> and the caption in a
      // <label> — both inline, so they arrive as ONE line, "35+ Topical
      // Sessions". Split the leading figure off rather than miss the band.
      const one = c.lines.length === 1 ? SPLIT_FIGURE.exec(c.lines[0]) : null;
      if (!one) return false;
      items.push({ value: one[1].trim(), label: one[2].trim() });
      continue;
    }
    const label = c.lines.filter((_, i) => i !== numIdx).join(" ").trim();
    if (label.length > 60) return false;
    items.push({ value: c.lines[numIdx].trim(), label });
  }
  emit(ctx, "stats", { style: "band", title: "", items }, "stat tiles");
  return true;
}

function trySpeakers(cells: CellInfo[], ctx: Ctx): boolean {
  // EVERY cell, not most of them. Accepting a 60% match meant the cells that did
  // not fit the card shape were simply left out of `items` — their content gone
  // from the document while the report called the grid "recognised".
  const good = cells.filter((c) => c.imgs.length === 1 && c.lines.length >= 2 && c.lines.length <= 5);
  if (good.length < 2 || good.length < Math.ceil(cells.length * 0.6)) return false;
  if (good.some((c) => c.lines[0].length > 70)) return false;
  const items = good.map((c) => ({
    name: c.lines[0],
    role: c.lines[1] || "",
    company: c.lines.slice(2).join(", "),
    photo: cleanUrl(attr(c.imgs[0], "src")) || "",
  }));
  const cols = Math.max(1, Math.min(4, Math.round(cells.length)));
  emit(ctx, "speakers", {
    title: "", style: "cards", cols: String(Math.min(4, cols)),
    max: items.length, items: items.slice(0, ctx.limits.maxItems),
  }, "speaker cards");
  // A cell that did not fit the card shape is WALKED, not dropped. Leaving it out
  // of `items` and calling the grid "recognised" lost its content outright; its
  // blocks now follow the grid, which moves them but keeps every word.
  const rest = cells.filter((c) => !good.includes(c));
  if (rest.length) {
    bump(ctx.approximated, "cells that did not fit the speaker card shape were imported after the grid", "their own blocks");
    for (const c of rest) emitFor(c.el, ctx, 40);
  }
  return true;
}

function trySponsors(cells: CellInfo[], ctx: Ctx): boolean {
  const good = cells.filter((c) => c.imgs.length === 1 && c.lines.length <= 1);
  if (good.length < 2 || good.length !== cells.length) return false;
  const items = good.map((c) => ({
    title: (c.lines[0] || attr(c.imgs[0], "alt") || "").slice(0, 120),
    logo: cleanUrl(attr(c.imgs[0], "src")) || "",
    url: c.anchors[0] ? cleanUrl(attr(c.anchors[0], "href")) || "" : "",
  })).filter((x) => x.logo);
  if (items.length < 2) return false;
  emit(ctx, "sponsors", {
    title: "", style: "cards", cols: String(Math.max(1, Math.min(5, items.length))),
    max: items.length, items: items.slice(0, ctx.limits.maxItems),
  }, "partner logo grid");
  return true;
}

function tryMeta(cells: CellInfo[], ctx: Ctx): boolean {
  if (cells.length < 2 || cells.length > 4) return false;
  if (cells.some((c) => c.imgs.length || c.lines.length !== 2)) return false;
  if (cells.some((c) => c.lines[0].length > 30 || c.lines[1].length > 90)) return false;
  emit(ctx, "meta", {
    items: cells.map((c) => ({ label: c.lines[0], value: c.lines[1] })),
  }, "date / venue tiles");
  return true;
}

/** The honest fallback. Nothing typed fits, so the markup is kept verbatim in the
 *  one block that accepts markup — sanitised twice on the way in, and sanitised
 *  again by the renderer on the way out.
 *
 *  Belt and braces, in the same spirit as the final script sweep in `renderDoc`:
 *  it does not fire on any file in the test corpus, because `walkFlow` captures
 *  loose text and images directly and therefore almost always emits SOMETHING.
 *  It is here so that a recogniser changed later fails by keeping the sender's
 *  markup rather than by silently dropping a section. */
function fallbackHtml(el: El, ctx: Ctx, what: string): void {
  const budget = { left: ctx.limits.maxRaw };
  const raw = sanitiseFragment(serialize(el, budget)).trim();
  if (!raw) return;
  const truncated = budget.left <= 0;
  emit(ctx, "html", { html: raw }, "custom HTML");
  bump(ctx.unrepresented, `${what} had no matching block type`, "html", truncated ? "kept as markup, truncated at the size limit" : "kept verbatim as markup");
}

// ---- post-passes ------------------------------------------------------------

/** `gridRows()` emits one table per ROW of a grid, and `paragraphs()` one div per
 *  paragraph, so a faithful import produces runs of identical adjacent blocks.
 *  Merging them back is what makes a round trip return the block COUNT it started
 *  with, not just the words. */
function mergeRuns(ctx: Ctx): { type: string; props: Record<string, any> }[] {
  const out: { type: string; props: Record<string, any> }[] = [];
  let merged = 0;
  for (const b of ctx.out) {
    const prev = out[out.length - 1];
    if (prev && prev.type === b.type) {
      const GRIDS = ["speakers", "sponsors", "stats", "bullets", "meta"];
      if (GRIDS.includes(b.type) && !prev.props.title && !b.props.title
        && Array.isArray(prev.props.items) && Array.isArray(b.props.items)
        && prev.props.style === b.props.style) {
        prev.props.items = [...prev.props.items, ...b.props.items].slice(0, LIMITS.maxItems);
        if (prev.props.max !== undefined) prev.props.max = prev.props.items.length;
        merged++;
        continue;
      }
      if (b.type === "text" && sameType(prev.props, b.props)) {
        prev.props.text = `${prev.props.text}\n${b.props.text}`;
        merged++;
        continue;
      }
      if (b.type === "spacer") { prev.props.height = Math.min(200, (Number(prev.props.height) || 0) + (Number(b.props.height) || 0)); merged++; continue; }
      if (b.type === "divider") { merged++; continue; }
    }
    out.push(b);
  }
  if (merged) bump(ctx.recognised, `${merged} adjacent fragments merged back into their block`, "fewer, whole blocks");
  return out;
}

const sameType = (a: Record<string, any>, b: Record<string, any>) =>
  ["size", "align", "weight", "lh", "italic", "underline", "caps"].every((k) => String(a[k] ?? "") === String(b[k] ?? ""));

// ---- fidelity measurement ---------------------------------------------------

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9À-ɏ]+/g) || []);

function docText(blocks: Block[]): string {
  const parts: string[] = [];
  const walk = (v: any, depth: number) => {
    if (depth > 6 || v == null) return;
    if (typeof v === "string") { parts.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === "object") { for (const x of Object.values(v)) walk(x, depth + 1); return; }
  };
  for (const b of blocks) walk(b.props, 0);
  return parts.join("\n");
}

/** How much of the source's visible copy survives. Measured as a multiset of
 *  words, so a word that appeared three times has to survive three times — this
 *  is the number the UI should show, and it should be the real one even when it
 *  is bad.
 *
 *  Measured against the mail the document RENDERS, not against the props: a
 *  `footer` block regenerates the unsubscribe sentence from its own defaults, so
 *  those words are in the reader's mail even though no prop holds them. Comparing
 *  props alone reported them lost, which is the wrong answer to "did my content
 *  survive". Props are the fallback if rendering fails for any reason. */
function coverage(root: El, blocks: Block[], rendered: string): { ratio: number; lost: string[] } {
  const srcLines = linesOf(root, false).map((l) => l.text);
  const out = rendered ? clean(rendered.replace(/<[^>]*>/g, " ")) : docText(blocks);
  const have = new Map<string, number>();
  for (const w of words(out)) have.set(w, (have.get(w) || 0) + 1);
  let total = 0;
  let hit = 0;
  const lost: string[] = [];
  for (const line of srcLines) {
    const ws = words(line);
    if (!ws.length) continue;
    let lineHit = 0;
    for (const w of ws) {
      total++;
      const n = have.get(w) || 0;
      if (n > 0) { have.set(w, n - 1); hit++; lineHit++; }
    }
    if (lineHit < ws.length * 0.5 && lost.length < 12) lost.push(line.slice(0, 120));
  }
  return { ratio: total ? Number((hit / total).toFixed(4)) : 1, lost };
}

/** The same question for pictures. Matched on FILENAME, because the renderer
 *  requests speaker photos from the CDN at the exact cell size — the URL in the
 *  mail is `/imgv2/width-230,height-230,resize_mode-2/files/…` and never equals
 *  the one in the file. Decoration the stylesheet hides, tracking pixels and
 *  spacer gifs are not counted: they were never content. */
function imageCoverage(root: El, rendered: string): { ratio: number; inSource: number; inMail: number; lost: string[] } {
  const key = (u: string) => {
    const path = String(u).split("?")[0].split("#")[0];
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)).toLowerCase();
  };
  // De-duplicated by filename key from the start: a spacer/icon repeated 15× is
  // still one image, and — the defect this fixes — the count and the percentage
  // must be over the SAME set. Counting duplicates in one and unique filenames in
  // the other is how the report read "58%" beside "4 of 77 not imported".
  const want = new Map<string, string>();
  const walk = (el: El, depth: number) => {
    if (depth > 60) return;
    for (const c of kids(el)) {
      if (isHidden(c) || isDecoration(c)) continue;
      if (c.tag === "img") {
        const u = cleanUrl(attr(c, "src"));
        if (u && !isSpacerImg(c)) { const k = key(u); if (!want.has(k)) want.set(k, u); }
        continue;
      }
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  const have = new Set([...rendered.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => key(m[1])));
  const missing = [...want.keys()].filter((k) => !have.has(k));
  const inSource = want.size;
  const inMail = inSource - missing.length;
  return {
    ratio: inSource ? Number((inMail / inSource).toFixed(4)) : 1,
    inSource, inMail,
    lost: missing.slice(0, 12),
  };
}
