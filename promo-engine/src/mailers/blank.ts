import type { Mailer } from "./mailer.ts";
import { blockOf } from "./blocks.ts";
import { THEME_PARAM, ACCENT_PARAM, logoBlock, footerBlock } from "./shared.ts";

// A mailer with no design in it — the escape hatch from the templates.
//
// Every other mailer here answers "build me this kind of send". This one answers
// "get out of my way": it seeds the frame and nothing else, and the sender adds
// blocks from the palette in whatever order the brief actually needs.
//
// It is NOT literally empty, and that is deliberate:
//
//   • The **masthead** goes in because a mail with no portal identity is not a
//     draft anyone would send, and it is the one thing every ET send opens with.
//   • The **legal footer** goes in because the unsubscribe line is a legal
//     requirement, not a design choice. Starting without it means the first
//     download of a hand-built mailer ships without one — the sender would have
//     to know to add it back, and the failure is invisible until it matters.
//     House rule: the footer is never removed, so it is never absent to begin
//     with. Both are ordinary blocks; delete them if you really mean to.
//
// Everything between them is yours.
export const blankMailer: Mailer = {
  id: "mailer.blank",
  group: "Blank",
  label: "Blank canvas",
  description: "Start with nothing but the masthead and the legal footer, and build the mail block by block.",
  // Nothing to bulk-download: an unbuilt blank would just add an empty file to
  // the ZIP. You build this one in the studio and download it from there.
  bulk: false,
  params() {
    // No copy params: there is no copy to seed. Palette and accent still apply,
    // because they set the surfaces every block you add will be drawn on.
    return [THEME_PARAM, ACCENT_PARAM];
  },
  // Needs no event data at all — that is the point, and it means this one is
  // never greyed out on an event with a thin API payload.
  requires() {
    return { ok: true, missing: [] };
  },
  build(event, params) {
    return {
      mailerId: this.id,
      // Seeded from the event so Save has a sensible default name and the
      // sender is editing a subject rather than inventing one from blank.
      subject: event.name || "Untitled mailer",
      preheader: "",
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: [
        logoBlock(event),
        // One spacer so the canvas has somewhere obvious to insert into: with
        // the masthead and footer flush against each other there is no gap to
        // aim the inline + at.
        // `height`, not `size`: that is the key the schema declares and the
        // renderer reads. `size` was a dead prop the settings panel never showed,
        // and the gap only looked right because both defaulted to 24.
        blockOf("spacer", { height: 24 }),
        footerBlock(event),
      ],
    };
  },
};
