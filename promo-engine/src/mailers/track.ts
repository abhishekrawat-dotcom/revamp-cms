import { esc } from "../templates/base.ts";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
  if (/^cid:|^data:/i.test(u)) return true;
  return !/^https?:\/\//i.test(u);                        // anything not absolute http(s)
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
// The secret is per-deployment and stable across restarts: `TRACK_SECRET` if set,
// otherwise a random value persisted once beside the analytics data. A restart
// must NOT rotate it, or in-flight campaign links would stop redirecting.
let _secret: Buffer | null = null;
function secret(): Buffer {
  if (_secret) return _secret;
  const env = (process.env.TRACK_SECRET || "").trim();
  if (env) return (_secret = Buffer.from(env, "utf8"));
  const dir = join(process.cwd(), "assets", "analytics");
  const file = join(dir, ".track-secret");
  try { _secret = Buffer.from(readFileSync(file, "utf8").trim(), "hex"); if (_secret.length >= 16) return _secret; } catch { /* create below */ }
  const fresh = randomBytes(32);
  try { mkdirSync(dir, { recursive: true }); writeFileSync(file, fresh.toString("hex"), { mode: 0o600 }); } catch { /* fall back to in-memory */ }
  return (_secret = fresh);
}

/** Short, URL-safe signature over the exact (id, target) pair. Truncated to 16
 *  base64url chars — 96 bits, far past what a forger could grind, and it keeps
 *  the link short. */
export function signClick(id: string, target: string): string {
  return createHmac("sha256", secret()).update(`${id}\n${target}`).digest("base64url").slice(0, 16);
}

/** True only for a signature this deployment produced for this exact id+url.
 *  Constant-time so the check leaks no timing. A missing or wrong signature — a
 *  forged or pre-signing link — returns false and the redirect is refused. */
export function verifyClick(id: string, target: string, sig: string): boolean {
  const want = signClick(id, target);
  const got = String(sig || "");
  if (got.length !== want.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(want)); } catch { return false; }
}

export const clickUrl = (base: string, id: string, target: string) =>
  `${base}/t/c/${encodeURIComponent(id)}?u=${encodeURIComponent(target)}&s=${signClick(id, target)}`;
export const openUrl = (base: string, id: string) =>
  `${base}/t/o/${encodeURIComponent(id)}.gif`;

/** Rewrite every trackable href and append the open pixel.
 *
 *  `links:false` leaves hrefs pointing at the real destination. Rewriting them
 *  sends every link in the mail through this deployment's domain, so a recipient
 *  hovering an ET mail sees a vercel.app URL — which reads as untrustworthy, is
 *  a spam signal, and means every link in every mail already sent breaks if this
 *  host ever moves. Clicks stop being counted; opens still are. */
export function injectTracking(html: string, id: string, base: string, o: { links?: boolean } = {}): string {
  const root = String(base || "").replace(/\/+$/, "");
  if (!root || !id) return html;

  let out = o.links === false ? String(html) : String(html).replace(/href="([^"]*)"/gi, (whole, raw) => {
    // The href is HTML-escaped in the document; unescape to get the real URL,
    // rewrite, then re-escape so the markup stays well formed.
    const target = String(raw).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    if (skipHref(target)) return whole;
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
