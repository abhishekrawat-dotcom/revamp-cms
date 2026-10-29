import type { Template } from "../template.ts";
import { ALL_RATIOS } from "../template.ts";
import { page, esc, editionRibbon, hashtag, brandLockup, footerBar, type TemplateContext } from "../base.ts";

function pickSpeaker(ctx: TemplateContext) {
  const { speakers } = ctx.event;
  const id = ctx.params.speakerId;
  return speakers.find((s) => String(s.id) === String(id)) ?? speakers[0];
}

const css = `
  .spk-body { flex:1; display:flex; gap:4cqw; align-items:stretch; min-height:0; }
  .spk-info { flex:1; display:flex; flex-direction:column; justify-content:center; gap:2cqw; padding:4cqw; }
  .spk-role { align-self:flex-start; }
  .spk-name { font-size:8cqw; font-weight:700; line-height:1; letter-spacing:-.01em;
    text-shadow:0 .4cqw 2cqw rgba(0,0,0,.28); }
  .spk-desig { font-size:3.4cqw; font-weight:700; opacity:.96; }
  .spk-company { font-size:3cqw; font-weight:600; color:var(--accent); }
  .spk-photo { position:relative; width:44%; border-radius:3cqw; overflow:hidden;
    box-shadow:0 2cqw 6cqw rgba(0,0,0,.3); background:rgba(255,255,255,.08); }
  .spk-photo img { width:100%; height:100%; object-fit:cover; object-position:top center; }
  .spk-photo::after { content:""; position:absolute; inset:0;
    background:linear-gradient(180deg, transparent 55%, rgba(0,0,0,.28)); }
  /* landscape: keep it side-by-side but tighter */
  body[data-ratio="16:9"] .spk-name { font-size:6cqw; }
  body[data-ratio="16:9"] .spk-photo { width:38%; }
  /* story: stack photo on top */
  body[data-ratio="9:16"] .spk-body { flex-direction:column; }
  body[data-ratio="9:16"] .spk-photo { width:100%; height:52%; }
  body[data-ratio="9:16"] .spk-name { font-size:9cqw; }
`;

export const individualSpeaker: Template = {
  id: "speaker.individual",
  category: "speaker",
  subtype: "individual",
  label: "Individual Speaker Card",
  description: "Single-speaker announcement: headshot + name, designation, company and role label.",
  formats: ALL_RATIOS,
  params: [
    { key: "speakerId", label: "Speaker", type: "select", source: "speakers" },
    { key: "roleLabel", label: "Role label", type: "text", default: "Speaker" },
  ],
  requires(event) {
    return { ok: event.speakers.length > 0, missing: event.speakers.length ? [] : ["speakers"] };
  },
  render(ctx) {
    const s = pickSpeaker(ctx);
    const role = ctx.params.roleLabel || s.group || "Speaker";
    const photo = s.photoUrl
      ? `<div class="spk-photo"><img src="${esc(s.photoUrl)}" alt=""></div>`
      : "";
    const inner = `
      ${editionRibbon(ctx)} ${hashtag(ctx)}
      ${brandLockup(ctx, { compact: true })}
      <div class="spk-body">
        <div class="frost spk-info">
          <span class="chip spk-role">${esc(role)}</span>
          <div class="spk-name">${esc(s.name)}</div>
          <div class="spk-desig">${esc(s.designation)}</div>
          <div class="spk-company">${esc(s.company)}</div>
        </div>
        ${photo}
      </div>
      ${footerBar(ctx)}`;
    return page(ctx, css, inner);
  },
  caption(ctx) {
    const s = pickSpeaker(ctx);
    const where = [ctx.event.dateLabel, ctx.event.venue].filter(Boolean).join(" · ");
    return `Meet ${s.name}, ${s.designation} at ${s.company}, joining us at ${ctx.event.name}.` +
      (where ? ` ${where}.` : "") + ` ${ctx.event.hashtag}`;
  },
};
