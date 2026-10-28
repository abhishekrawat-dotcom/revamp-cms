import type { EventEntity } from "../model/types.ts";
import type { ParamDef, Availability } from "../templates/template.ts";
import type { MailerDoc } from "./blocks.ts";

// A promotional mailer TEMPLATE. Unlike social templates (which render to PNG),
// a mailer template's job is to seed a block DOCUMENT from live event data; the
// document is then edited in the studio and rendered to email HTML.
export interface Mailer {
  id: string;
  /** Card grouping in the UI, e.g. "Announcement" / "Speaker" / "Partner". */
  group: string;
  label: string;
  description: string;
  /** Params seed the first document only — they are not used at render time. */
  params(event: EventEntity): ParamDef[];
  /** Include this in "Download all"? Defaults to true. A mailer that seeds no
   *  content of its own (the blank canvas) would only add an empty file to the
   *  ZIP, so it opts out — you build it in the studio and download it there. */
  bulk?: boolean;
  /** Is there enough event data for this mailer? Drives greying-out in the UI. */
  requires(event: EventEntity): Availability;
  build(event: EventEntity, params: Record<string, any>): MailerDoc;
}

export type { MailerDoc };
