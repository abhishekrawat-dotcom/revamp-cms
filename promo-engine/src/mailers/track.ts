import { esc } from "../templates/base.ts";
import { createHmac, timingSafeEqual } from "node:crypto";

// Open/click tracking for a mailer, added WITHOUT a single line of script —
// which is the only thing that could work anyway, since no email client runs
// JavaScript, and house rule 4 forbids scripts reaching a download.
//
//   opens  — a 1x1 transparent GIF. The client fetching the image is the signal.
//   clicks — every http(s) href is rewritten through a redirect that records the
//            hit and then 302s to the original URL.
//
// This runs as one pass over the FINISHED html rather than inside the block
// renderers: a link added to a new block type is then covered automatically,
// and there is no tracking context to thread through forty call sites.
//
// It is applied to downloads and copied HTML only — never to the studio preview,
// or your own editing would inflate the numbers.

/** Left alone: anchors the mail needs to keep verbatim. */
function skipHref(url: string): boolean {
  const u = url.trim();
  if (!u || u === "#") return true;
  if (/^(mailto:|tel:|sms:)/i.test(u)) return true;      // not web links
  if (/^\{\$\$/.test(u) || u.includes("{$$")) return true; // the ESP's own merge tokens (unsubscribe)
  // ONEWORLD PORT: other sending services' merge tokens too — *|EMAIL|* (Mailchimp),
  // %%email%% (Salesforce Marketing Cloud) and {{email}} (most of the rest). Oneworld's
  // mails go out through whatever service the team uses. Inside the redirect's u= such
  // a token is percent-encoded, so the service can no longer fill it in — and if it
  // did, the filled-in link would no longer match its signature.
  if (/\*\|[^|]*\|\*/.test(u) || /%%[^%\s]+%%/.test(u) || /\{\{[^}]*\}\}/.test(u)) return true;
  if (/^cid:|^data:/i.test(u)) return true;
  return !/^https?:\/\//i.test(u);                        // anything not absolute http(s)
}

/** ONEWORLD PORT: true only for a URL the click redirect will follow — the test the
 *  redirect itself makes before it checks the signature (Oneworld's
 *  functions/lib/promo-track.js calls this very function). Absolute http(s), no
 *  control character, a URL that parses, and one encodeURIComponent can write into
 *  `u=` (a lone surrogate cannot be). injectTracking signs nothing that fails here:
 *  the platform did, and the recipient of such a link got "bad link" instead of the
 *  page. */
export function clickTargetOk(target: string): boolean {
  const t = String(target ?? "");
  if (!/^https?:\/\//i.test(t) || /[\u0000-\u001f\u007f]/.test(t)) return false;
  try { new URL(t); encodeURIComponent(t); return true; } catch { return false; }
}

// ONEWORLD PORT: the entities an href can carry, decoded in ONE pass. The platform
// replaced `&amp;` first and the others after it, so `&amp;lt;` (the text "&lt;" in
// the link) became "<"; and numeric entities, which an imported mail's raw HTML can
// carry (`&#38;`), were signed as written. A numeric entity past U+10FFFF is no
// character, so it is left as written. `&#X…;` is the same entity as `&#x…;` in HTML.
const HREF_ENTITY = /&(amp|quot|#39|lt|gt|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/g;
const NAMED_ENTITY: Record<string, string> = { amp: "&", quot: '"', "#39": "'", lt: "<", gt: ">" };
function decodeHref(raw: string): string {
  return raw.replace(HREF_ENTITY, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(NAMED_ENTITY, name)) return NAMED_ENTITY[name];
    const code = /^#[xX]/.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** ONEWORLD PORT: an href attribute's text, as written in the HTML, to the exact URL
 *  that gets signed — or "" to leave that href alone (skipHref's anchors, and any
 *  link the click redirect would refuse). Tabs and line breaks are dropped and the
 *  ends trimmed, as a browser does with an href. The platform signed the untrimmed
 *  text while its redirect checked the trimmed one, so a link wrapped over two lines
 *  answered "bad link". */
export function trackTarget(rawHref: string): string {
  const target = decodeHref(String(rawHref ?? "")).replace(/[\t\n\r]/g, "").trim();
  if (skipHref(target) || !clickTargetOk(target)) return "";
  return target;
}

// ---------------------------------------------------------------------------
// The click redirect is SIGNED, which is what stops it being an open redirect.
//
// `/t/c/<id>?u=<url>` will 302 to `u`. Checking only that `u` is http(s) — as it
// did — lets anyone craft `https://<our-mail-domain>/t/c/x?u=https://phish`: a
// link that shows the trusted sending domain on hover and lands the victim on a
// phishing page. A host allowlist was the alternative, but a mail can legitimately
// link a sponsor's own site, so an allowlist would break real links.
//
// Instead every click URL this platform emits carries an HMAC over (id, url). The
// redirect recomputes it and refuses anything whose signature does not match, so
// only URLs WE wrapped are ever followed — for any destination, ET or partner.
//
// ONEWORLD PORT (owner, 2026-10-28): the key is the TRACK_SECRET environment value
// (an App Hosting secret, 32+ characters), read on every call, with NO fallback.
// The platform otherwise made a random key and kept it in a file beside its
// analytics data. Oneworld runs on more than one instance and replaces them on
// every rollout, so a key kept in a file or in memory would differ between them,
// and a link signed by one would be refused by the next. Without the key nothing
// is signed (signClick throws, and the caller sends the mail untracked) and every
// click check fails.
//
// TRACK_SECRET_PREVIOUS, when set (same rule), is the key before a rotation. It is
// accepted when a click is checked and never used to sign, so mails already in
// inboxes keep redirecting while new mails carry the new key.
function keyOf(name: "TRACK_SECRET" | "TRACK_SECRET_PREVIOUS"): Buffer | null {
  const v = String(process.env[name] || "").trim();
  return v.length >= 32 ? Buffer.from(v, "utf8") : null;
}
function sign(key: Buffer, id: string, target: string): string {
  return createHmac("sha256", key).update(`${id}\n${target}`).digest("base64url").slice(0, 16);
}

/** Short, URL-safe signature over the exact (id, target) pair. Truncated to 16
 *  base64url chars — 96 bits, far past what a forger could grind, and it keeps
 *  the link short. */
export function signClick(id: string, target: string): string {
  const key = keyOf("TRACK_SECRET");
  if (!key) throw new Error("TRACK_SECRET is not set (32+ characters) — tracked links cannot be signed or checked");
  return sign(key, id, target);
}

/** True only for a signature this deployment produced for this exact id+url.
 *  Constant-time so the check leaks no timing. A missing or wrong signature — a
 *  forged or pre-signing link — returns false and the redirect is refused.
 *  ONEWORLD PORT: never throws; false while TRACK_SECRET is not set; tries the
 *  current key, then TRACK_SECRET_PREVIOUS. */
export function verifyClick(id: string, target: string, sig: string): boolean {
  const current = keyOf("TRACK_SECRET");
  if (!current) return false;
  const got = Buffer.from(String(sig || ""), "utf8");
  for (const key of [current, keyOf("TRACK_SECRET_PREVIOUS")]) {
    if (!key) continue;
    try {
      const want = Buffer.from(sign(key, String(id), String(target)), "utf8");
      if (got.length === want.length && timingSafeEqual(got, want)) return true;
    } catch { /* a check never throws: it fails */ }
  }
  return false;
}

export const clickUrl = (base: string, id: string, target: string) =>
  `${base}/t/c/${encodeURIComponent(id)}?u=${encodeURIComponent(target)}&s=${signClick(id, target)}`;
export const openUrl = (base: string, id: string) =>
  `${base}/t/o/${encodeURIComponent(id)}.gif`;

/** Rewrite every trackable href and append the open pixel.
 *
 *  `links:false` leaves hrefs pointing at the real destination. Rewriting them
 *  sends every link in the mail through Oneworld's own address, so a recipient
 *  hovering a link in an ET mail sees that address rather than the real page —
 *  which reads as less trustworthy, is a spam signal, and means every link in
 *  every mail already sent breaks if that address ever stops serving the
 *  redirect. Clicks stop being counted; opens still are.
 *
 *  ONEWORLD PORT: the note above is reworded for Oneworld (the platform's named its
 *  own hosting domain). An href is rewritten only when trackTarget() gives a URL
 *  to sign; see there for what is left alone. */
export function injectTracking(html: string, id: string, base: string, o: { links?: boolean } = {}): string {
  const root = String(base || "").replace(/\/+$/, "");
  if (!root || !id) return html;

  let out = o.links === false ? String(html) : String(html).replace(/href="([^"]*)"/gi, (whole, raw) => {
    // The href is HTML-escaped in the document; trackTarget unescapes it to get
    // the real URL, which is rewritten and then re-escaped so the markup stays
    // well formed.
    const target = trackTarget(raw);
    if (!target) return whole;
    return `href="${esc(clickUrl(root, id, target))}"`;
  });

  // The pixel goes last so it is fetched after the visible content, and carries
  // dimensions inline because a mail client will not read a stylesheet for it.
  const pixel = `<img src="${esc(openUrl(root, id))}" width="1" height="1" border="0" alt="" style="display:block;width:1px;height:1px;border:0;outline:none;line-height:1px">`;
  return out.includes("</body>") ? out.replace(/<\/body>/i, `${pixel}</body>`) : out + pixel;
}

/** Short, URL-safe, and unguessable enough that nobody can inflate a rival's
 *  numbers by hand. Not a secret — it only identifies a generated mail. */
export function newSendId(): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Buffer.from(a).toString("base64url");
}
