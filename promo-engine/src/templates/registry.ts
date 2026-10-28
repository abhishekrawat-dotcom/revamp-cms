/* ONEWORLD PORT: a stand-in for the platform's social-post template registry. The mailer registry needs only
   resolveParamOptions (to list a mailer's seed params with their options in the catalog); the social templates
   and their PSD reader are not part of the mailer engine, so they are not brought in here. The function itself
   is the platform's own, unchanged. */
import type { ParamDef } from "./template.ts";
import type { EventEntity } from "../model/types.ts";

export function resolveParamOptions(p: ParamDef, event: EventEntity): ParamDef {
  if (p.type === "stats") return { ...p, default: event.stats };
  if (!p.source) return p;
  let options: { value: string | number; label: string }[] = [];
  switch (p.source) {
    case "speakers":
      options = event.speakers.map((s) => ({ value: s.id, label: `${s.name} — ${s.company}` }));
      break;
    case "speakerGroups":
      options = [...new Set(event.speakers.map((s) => s.group).filter(Boolean) as string[])]
        .map((g) => ({ value: g, label: g }));
      break;
    case "sponsors":
      options = event.sponsorTiers.flatMap((t) =>
        t.sponsors.map((s) => ({ value: s.id, label: `${s.title} — ${t.tier}` })));
      break;
    case "sponsorTiers":
      options = event.sponsorTiers.map((t) => ({ value: t.tier, label: `${t.tier} (${t.sponsors.length})` }));
      break;
    case "sessions":
      options = event.sessions.map((s) => ({ value: s.id, label: s.title }));
      break;
  }
  return { ...p, options };
}
