import type { Mailer } from "./mailer.ts";
import { blockOf } from "./blocks.ts";
import { dateVenue } from "./base.ts";
import {
  THEME_PARAM, ACCENT_PARAM, BANNER_PARAMS, headerBlocks, logoBlock, heroBlock, sectionLabel, metaBlock,
  ctaBlock, footerBlock, contactsBlock, dividerBlock, speakersBlock, copyParams, ctaParams,
  selectSpeakers, YES_NO, isNo, compact,
  overviewBlock,
} from "./shared.ts";

// ---- speaker line-up --------------------------------------------------------

export const speakersMailer: Mailer = {
  id: "mailer.speakers",
  group: "Speaker",
  label: "Speaker Announcement",
  description: "Line-up send: a uniform speaker grid (hand-picked or top-N), with date/venue and CTA.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM, ...BANNER_PARAMS,
      { key: "speakerIds", label: "Pick speakers", type: "multiselect", source: "speakers",
        hint: "Leave empty to auto-pick by priority. Order follows your picks." },
      { key: "group", label: "Speaker group", type: "select", source: "speakerGroups",
        hint: "Filters the auto-pick (e.g. only Keynote Speakers)." },
      { key: "limit", label: "Auto-pick count", type: "number", default: 6 },
      { key: "cols", label: "Grid columns", type: "select", default: "3",
        options: [{ value: "2", label: "2 per row (bigger photos)" }, { value: "3", label: "3 per row" }, { value: "4", label: "4 per row" }] },
      ...copyParams("Meet the speakers", `Here's a first look at the leaders taking the stage at ${event.name}.`),
      YES_NO("showMeta", "Date / venue tiles"),
      ...ctaParams(event),
    ];
  },
  requires(event) {
    return { ok: event.speakers.length >= 2, missing: event.speakers.length >= 2 ? [] : ["speakers (2+)"] };
  },
  build(event, params) {
    const list = selectSpeakers(event, params);
    const first = list[0];
    const subject = !first
      ? `Speakers announced | ${event.name}`
      : list.length > 1
        ? `${first.name} & ${list.length - 1} more speaking at ${event.name}`
        : `${first.name} is speaking at ${event.name}`;

    return {
      mailerId: this.id,
      subject,
      preheader: list.slice(0, 3).map((s) => [s.name, s.company].filter(Boolean).join(", ")).join(" • ") || dateVenue(event),
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        ...headerBlocks(event, params),
        sectionLabel("Speakers announced"),
        blockOf("heading", { text: params.headline || "Meet the speakers", size: 22, align: "center" }),
        overviewBlock(event, params, `Here's a first look at the leaders taking the stage at ${event.name}.`),
        speakersBlock(list, {
          title: "",
          cols: Number(params.cols) || 3,
          note: event.speakers.length > list.length ? `+ ${event.speakers.length - list.length} more speakers to be announced.` : "",
        }),
        isNo(params.showMeta) ? null : metaBlock(event),
        dividerBlock(),
        ctaBlock(event, params, { align: "center", note: "Join the room where these conversations happen." }),
        contactsBlock(),
        footerBlock(event),
      ]),
    };
  },
};

// ---- single-speaker spotlight ----------------------------------------------

export const speakerSpotlightMailer: Mailer = {
  id: "mailer.speaker-spotlight",
  group: "Speaker",
  label: "Speaker Spotlight",
  description: "One speaker, front and centre: big photo, role, a session/quote line, plus the rest of the line-up.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM,
      { key: "speakerIds", label: "Speaker", type: "multiselect", source: "speakers",
        hint: "Pick one — the first selection is the spotlight." },
      ...copyParams("In the spotlight", ""),
      { key: "quote", label: "Quote / session line", type: "textarea", hint: "Shown as a pull-quote under the speaker." },
      { key: "moreCount", label: "Other speakers to show", type: "number", default: 3, hint: "0 hides the 'also speaking' grid." },
      ...ctaParams(event),
    ];
  },
  requires(event) {
    return { ok: event.speakers.length >= 1, missing: event.speakers.length ? [] : ["speakers"] };
  },
  build(event, params) {
    const star = selectSpeakers(event, params, 1)[0] ?? event.speakers[0];
    const nMore = Number(params.moreCount ?? 3);
    const others = nMore > 0 ? event.speakers.filter((s) => s.id !== star?.id).slice(0, nMore) : [];

    return {
      mailerId: this.id,
      subject: star ? `${star.name} joins ${event.name}` : `Speaker spotlight | ${event.name}`,
      preheader: star ? `${[star.designation, star.company].filter(Boolean).join(", ")} — ${dateVenue(event)}` : dateVenue(event),
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        logoBlock(event),
        heroBlock(event),
        star ? blockOf("speaker", {
          eyebrow: params.headline || "In the spotlight",
          name: star.name, role: star.designation, company: star.company,
          photo: star.photoUrl || "", link: star.linkedin || "",
        }) : null,
        params.quote ? blockOf("quote", { text: params.quote, cite: star ? star.name : "" }) : null,
        overviewBlock(event, params, star ? `${star.name} joins the line-up at ${event.name}.` : undefined),
        ctaBlock(event, params),
        metaBlock(event),
        others.length ? dividerBlock() : null,
        others.length ? speakersBlock(others, { title: "Also speaking" }) : null,
        contactsBlock(),
        footerBlock(event),
      ]),
    };
  },
};
