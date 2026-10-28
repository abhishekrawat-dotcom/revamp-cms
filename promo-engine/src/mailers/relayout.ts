import type { EventEntity } from "../model/types.ts";
import type { Mailer } from "./mailer.ts";
import { BLOCK_SCHEMAS, blockOf, type Block, type BlockType, type MailerDoc } from "./blocks.ts";
import { buildDoc, getMailer } from "./registry.ts";

// ---------------------------------------------------------------------------
// Change the LAYOUT without losing the CONTENT.
//
// A mailer template only ever seeds the first version of a document; everything
// after that is the sender's. So "switch this announcement to the conference
// layout" cannot mean "rebuild from the template" — that throws away every word
// they typed — and it cannot mean "keep my document and repaint it" either,
// because the document IS the layout here. It has to mean: build the target
// template's skeleton, then move the sender's own work into it.
//
// The whole design rests on one question: **which parts of this document did the
// sender actually author?** We can answer it exactly, because a template is a
// pure function of (event, params) — so re-seeding the CURRENT mailer gives us
// the document as the template first produced it, and anything that differs from
// that baseline is the sender's. Everything else is the old template's defaults,
// which is precisely what a layout switch is supposed to leave behind: carry
// them over and switching layouts would drag the old template's opinions into
// the new one and defeat the point.
//
//   current doc  ─┬─ differs from its own seed ──▶ the sender's → migrate
//                 └─ identical to its own seed ──▶ the template's → drop
//
// Three kinds of block come out of that comparison, and each has one rule:
//
//   • SEEDED + EDITED — the template made this block, the sender changed it.
//     Migrate the changed props into the best-matching block of the same type in
//     the target skeleton. Only the changed props move; the rest of that slot
//     stays as the new template seeded it.
//   • ADDED — no counterpart in the source seed, so the sender dragged it in
//     from the palette. It is theirs entire, and it is not a variant of anything
//     the target template ships, so it is carried across as an extra block
//     rather than being allowed to overwrite one of the target's slots.
//   • SEEDED + UNTOUCHED — the old template's default. Dropped: the target's own
//     seed for that slot is better.
//
// Nothing the sender typed is ever dropped in silence. A block that would have
// migrated but found no free slot of its type is carried as an extra too, and
// every decision — matched, carried, dropped, filtered — comes back in a report
// the caller can show or log.
// ---------------------------------------------------------------------------

/** Document-level settings that belong to the sender, not to the template. Each
 *  survives the switch when it differs from what the source template seeded —
 *  the same "did they touch it?" test the blocks get. `trackLinks` is in here
 *  because it is a per-document choice the studio writes onto the doc even
 *  though the seeders never set it. */
const DOC_SETTINGS = ["subject", "preheader", "theme", "accent", "background", "trackLinks", "imageGuard"] as const;

/** Key order is not meaningful in a block's props, and a document that has been
 *  through JSON.stringify/parse (every save, every request body) can come back
 *  with a different one. Sorting before comparing keeps that from reading as an
 *  edit the sender never made. */
function stable(v: any): any {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o: any, k) => { o[k] = stable(v[k]); return o; }, {});
  }
  return v;
}

/** Value equality as the EDITOR means it, not as JavaScript means it.
 *  - absent, null and "" are the same thing: a field the sender never filled.
 *    Clearing an unset field is not an edit.
 *  - 3 and "3" are the same thing: `cols` is seeded as a string in one template
 *    and as a number in another, and a type change is not an edit either. */
function eq(a: any, b: any): boolean {
  const na = a == null ? "" : a;
  const nb = b == null ? "" : b;
  if (typeof na === "object" || typeof nb === "object") {
    return JSON.stringify(stable(na)) === JSON.stringify(stable(nb));
  }
  return String(na) === String(nb);
}

/** Index of each block WITHIN its own type: the 3rd `heading` is heading #2.
 *  Blocks repeat — a mailer has five headings and four paragraphs — so a stable
 *  identity for "which one of these" is the whole matching problem. Ids can't do
 *  it: `blockOf` mints a fresh id on every build, so a re-seed of the same
 *  template shares no id with the document it produced. Position within type is
 *  the one thing that survives a rebuild. */
function typeOrdinals(blocks: Block[]): number[] {
  const seen = new Map<string, number>();
  return blocks.map((b) => {
    const n = seen.get(b.type) ?? 0;
    seen.set(b.type, n + 1);
    return n;
  });
}

/** How alike are these two template slots? Scores the props on which the SOURCE
 *  template's seed and the TARGET template's seed already agree — i.e. how much
 *  the two templates were saying the same thing in that slot before the sender
 *  touched anything. It is scored on the SEEDS, never on the edited values: the
 *  sender's copy is what we are trying to place, so it cannot also be the
 *  evidence for where it goes.
 *
 *  Numbers score by nearness rather than pass/fail, and that is not a nicety —
 *  it is what tells a 22px headline from a 15px caps section label when both are
 *  `heading` blocks. Equality alone rates 22-vs-15 exactly as unlike as
 *  22-vs-24, and the rewritten headline then lands in whichever slot happens to
 *  sit at the same ordinal, which is how a headline becomes a section label. */
function similarity(seedProps: Record<string, any>, slotProps: Record<string, any>): number {
  const keys = new Set([...Object.keys(seedProps || {}), ...Object.keys(slotProps || {})]);
  let n = 0;
  for (const k of keys) {
    const a = seedProps?.[k], b = slotProps?.[k];
    if (eq(a, b)) { n += 1; continue; }
    const x = Number(a), y = Number(b);
    if (a !== "" && b !== "" && a != null && b != null && Number.isFinite(x) && Number.isFinite(y)) {
      n += Math.max(0, 1 - Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y), 1));
    }
  }
  // Rounded, so float dust never decides a tie that position should decide.
  return Math.round(n * 1000) / 1000;
}

/** One-to-one assignment between two runs of same-type blocks, most alike
 *  first. Greedy rather than optimal: the sets are a handful of blocks each, and
 *  a greedy pass with a fully specified tiebreak is deterministic and can be
 *  explained to a sender in one sentence — "your edited heading went to the
 *  heading it most resembles" — which an assignment algorithm's global optimum
 *  cannot. Ties break on nearness of position, then document order, so the same
 *  switch made twice lands twice in the same place. */
function pairUp(a: { score: Record<string, any>; ord: number }[], b: { score: Record<string, any>; ord: number }[]): Map<number, number> {
  const pairs: { i: number; j: number; s: number; d: number }[] = [];
  a.forEach((x, i) => b.forEach((y, j) => pairs.push({ i, j, s: similarity(x.score, y.score), d: Math.abs(x.ord - y.ord) })));
  pairs.sort((p, q) => q.s - p.s || p.d - q.d || p.i - q.i || p.j - q.j);
  const out = new Map<number, number>();
  const usedB = new Set<number>();
  for (const p of pairs) {
    if (out.has(p.i) || usedB.has(p.j)) continue;
    out.set(p.i, p.j);
    usedB.add(p.j);
  }
  return out;
}

/** The blocks of one type, with their index in the document and their position
 *  among their own kind. */
const ofType = (blocks: Block[], type: string, ord: number[]) =>
  blocks.map((b, i) => ({ b, i, ord: ord[i] })).filter((x) => x.b.type === type);

interface Carried { block: Block; from: number; why: "added" | "no-slot" }

export interface RelayoutReport {
  from: string;
  to: string;
  /** Doc-level settings taken from the sender's document rather than the target seed. */
  kept: string[];
  /** Sender edits moved into a slot of the target skeleton. */
  matched: { type: string; props: string[]; fromIndex: number; toBlockId: string }[];
  /** Sender blocks with no slot in the target, kept as extra blocks. */
  carried: { type: string; id: string; index: number; why: "added" | "no-slot" }[];
  /** Blocks left behind, and why. Never silent. */
  dropped: { type: string; why: "untouched" | "unknown-type" }[];
  /** Anything filtered or repaired on the way through. */
  warnings: string[];
}

export interface RelayoutResult { doc: MailerDoc; report: RelayoutReport }

/**
 * Re-lay a document into another mailer's structure, keeping the sender's work.
 *
 * @param current  the document on screen (any mailer)
 * @param target   the mailer whose layout is wanted
 * @param event    the event both are bound to
 * @param params   seed params for the target template (same shape `buildDoc` takes)
 */
export function relayout(
  current: MailerDoc,
  target: Mailer,
  event: EventEntity,
  params: Record<string, any> = {},
): RelayoutResult {
  const warnings: string[] = [];
  const currentBlocks = Array.isArray(current?.blocks) ? current.blocks : [];

  // The target's skeleton, and the source's own seed — the baseline that tells
  // sender content apart from template default.
  const skeleton = buildDoc(target, event, params);
  const source = getMailer(String(current?.mailerId || ""));
  // A document whose template we cannot rebuild (an unknown or retired mailer
  // id) gets an EMPTY baseline, so every prop on it reads as the sender's. That
  // errs towards carrying too much, which is recoverable; the other way round
  // loses work, which is not.
  const sourceSeed = source ? buildDoc(source, event, {}) : null;
  if (!sourceSeed) {
    warnings.push(`No template for "${current?.mailerId || "(none)"}": every value was treated as sender content.`);
  }

  // ---- what the sender authored -------------------------------------------
  // Which seeded block is this one? Pairing by likeness rather than by position
  // among its kind, because a document that has already been through a switch
  // carries blocks the current template never seeded, and those shift every
  // later block's ordinal. Ordinal pairing then hands a block the wrong
  // baseline, invents edits nobody made, and the document drifts a little
  // further on every switch.
  const curOrd = typeOrdinals(currentBlocks);
  const seedOrd = typeOrdinals(sourceSeed?.blocks || []);
  const baselineOf = new Map<number, Record<string, any>>();
  const isAdded = new Set<number>();
  if (sourceSeed) {
    for (const type of new Set(currentBlocks.map((b) => b?.type))) {
      const mine = ofType(currentBlocks, type, curOrd);
      const theirs = ofType(sourceSeed.blocks, type, seedOrd);
      const pairing = pairUp(
        mine.map((x) => ({ score: x.b.props || {}, ord: x.ord })),
        theirs.map((x) => ({ score: x.b.props || {}, ord: x.ord })),
      );
      mine.forEach((x, k) => {
        const j = pairing.get(k);
        if (j === undefined) isAdded.add(x.i);            // more of this type than the template seeds: the sender added it
        else baselineOf.set(x.i, theirs[j].b.props || {});
      });
    }
  }

  const dropped: RelayoutReport["dropped"] = [];
  interface Mover { i: number; block: Block; baseline: Record<string, any>; edits: string[] }
  const movers: Mover[] = [];
  const addedBlocks: Mover[] = [];
  const untouched: Mover[] = [];

  currentBlocks.forEach((b, i) => {
    if (!b || !BLOCK_SCHEMAS[b.type as BlockType]) {
      // A type no schema declares cannot be rendered or edited, so carrying it
      // would only plant a block that rots the document quietly.
      dropped.push({ type: String(b?.type ?? "?"), why: "unknown-type" });
      warnings.push(`Dropped a block of unknown type "${b?.type}" — no schema declares it.`);
      return;
    }
    const baseline = baselineOf.get(i) || {};
    const props = b.props || {};
    const edits = Object.keys(props).filter((k) => !eq(props[k], baseline[k]));
    // An added block is the sender's entire, so every prop on it is an edit and
    // it is scored on its own props — there is no seed to score it against.
    if (isAdded.has(i)) { addedBlocks.push({ i, block: b, baseline: props, edits: Object.keys(props) }); return; }
    if (!edits.length) { dropped.push({ type: b.type, why: "untouched" }); untouched.push({ i, block: b, baseline, edits }); return; }
    movers.push({ i, block: b, baseline, edits });
  });

  // ---- place the edits in the new skeleton ---------------------------------
  const out: Block[] = skeleton.blocks.map((b) => ({ ...b, props: { ...b.props } }));
  const outOrd = typeOrdinals(out);
  const matched: RelayoutReport["matched"] = [];
  const placedAt = new Map<number, string>();               // current index -> target block id
  const carried: Carried[] = [];
  const claimed = new Set<number>();                        // target block indices already spoken for

  /** Overlay one run of blocks onto the free slots of their type. `why` is the
   *  label a block gets when there is no free slot for it; `null` means this run
   *  is only being matched to work out where its neighbours sit, and a block
   *  with nowhere to go is simply left behind. */
  function claim(list: Mover[], why: "no-slot" | "added" | null): void {
    const byType = new Map<string, Mover[]>();
    for (const m of list) {
      if (!byType.has(m.block.type)) byType.set(m.block.type, []);
      byType.get(m.block.type)!.push(m);
    }
    for (const [type, group] of byType) {
      const slots = out.map((b, j) => ({ b, j })).filter((s) => s.b.type === type && !claimed.has(s.j));
      const pairing = pairUp(
        group.map((m) => ({ score: m.baseline, ord: curOrd[m.i] })),
        slots.map((s) => ({ score: s.b.props, ord: outOrd[s.j] })),
      );
      group.forEach((m, k) => {
        const si = pairing.get(k);
        if (si === undefined) { if (why) carried.push({ block: m.block, from: m.i, why }); return; }
        const j = slots[si].j;
        claimed.add(j);
        const allow = allowedKeys(type, skeleton);
        const moved: string[] = [];
        for (const key of m.edits) {
          if (!allow.has(key)) { warnings.push(`${type}.${key} is not declared by the target schema — not carried.`); continue; }
          out[j].props[key] = m.block.props[key];
          moved.push(key);
        }
        if (m.edits.length) matched.push({ type, props: moved, fromIndex: m.i, toBlockId: out[j].id });
        placedAt.set(m.i, out[j].id);
      });
    }
  }

  // Edited template blocks first: they have a slot in the old layout, so they
  // have the strongest claim on the matching slot in the new one. Blocks the
  // sender ADDED take what is left over.
  //
  // They do take it, though — an added block is not barred from a slot. Barring
  // them looks tidier (the skeleton stays exactly as the template drew it) and
  // is what the first build did, and it makes a switch UNREVERSIBLE: a heading
  // carried into a layout that has none comes back as "added", so A→B→A left
  // the sender with a duplicate heading, and every further switch added another.
  // Since only the props the added block actually carries are overlaid, the new
  // template's own layout settings for that slot still survive underneath.
  claim(movers, "no-slot");
  claim(addedBlocks, "added");
  // Last, the blocks the sender never touched. Nothing of theirs is overlaid —
  // they carry no edits — and one with no slot is simply dropped. They are
  // matched purely so that a homeless block can anchor itself to them: without
  // this, a carried block can only sit beside an EDITED neighbour, so it shifts
  // the first time a switch is repeated as the set of edited blocks changes
  // around it, and "switch, then switch again" is not the same document twice.
  claim(untouched, null);
  carried.sort((a, b) => a.from - b.from);

  // ---- carry the homeless blocks in, next to their neighbours --------------
  // Where a block lands matters as much as that it survives. An extra paragraph
  // that belonged under the speaker grid should still be under the speaker grid,
  // so each one follows whichever of its neighbours DID find a home; only a
  // block with no placed neighbour at all falls back to the end of the mail,
  // above the legal footer (which is not a place to insert anything after).
  const tailIndex = () => {
    const i = out.map((b) => b.type).lastIndexOf("footer");
    return i === -1 ? out.length : i;
  };
  const carriedReport: RelayoutReport["carried"] = [];
  for (const c of carried) {
    const blk = { ...c.block, props: { ...c.block.props } };
    let at: number;
    let before: string | null = null;
    for (let k = c.from - 1; k >= 0 && !before; k--) before = placedAt.get(k) || null;
    if (before) {
      at = out.findIndex((b) => b.id === before) + 1;
    } else {
      // Nothing above it in the old mail landed anywhere, so it cannot follow a
      // neighbour. Sit above the first one BELOW it that did — a block from the
      // top of the old mail belongs at the top of the new one, not at the end.
      let after: string | null = null;
      for (let k = c.from + 1; k < currentBlocks.length && !after; k++) after = placedAt.get(k) || null;
      at = after ? out.findIndex((b) => b.id === after) : tailIndex();
    }
    out.splice(at, 0, blk);
    // A carried block is itself a landmark for the next one, so a run of them
    // keeps its order instead of stacking up backwards against a shared anchor.
    placedAt.set(c.from, blk.id);
    carriedReport.push({ type: blk.type, id: blk.id, index: at, why: c.why });
  }

  // ---- hygiene ------------------------------------------------------------
  // Every block leaves here with an id nothing else in the document shares. A
  // carried block keeps its own (so a second switch recognises it), and only a
  // real collision is re-minted.
  const seenIds = new Set<string>();
  for (const b of out) {
    if (!b.id || seenIds.has(b.id)) {
      const fresh = blockOf(b.type, {}).id;
      warnings.push(`Re-minted a ${b.id ? "duplicate" : "missing"} block id on a ${b.type} block.`);
      b.id = fresh;
    }
    seenIds.add(b.id);
  }
  // No block leaves with a prop the target's schema (or the target template's own
  // seed) does not know about. An undeclared key is unreachable from the settings
  // panel and unread by the renderer, so it is dead weight that quietly rots the
  // document — but it is still removal, so it is named in the report rather than
  // done in silence.
  for (const b of out) {
    const allow = allowedKeys(b.type, skeleton);
    for (const k of Object.keys(b.props || {})) {
      if (allow.has(k)) continue;
      delete b.props[k];
      warnings.push(`Removed ${b.type}.${k}: the target schema does not declare it.`);
    }
  }

  // ---- document settings ---------------------------------------------------
  const kept: string[] = [];
  const doc: any = { ...skeleton, mailerId: target.id, blocks: out };
  for (const k of DOC_SETTINGS) {
    const mine = (current as any)?.[k];
    const wasSeeded = sourceSeed ? (sourceSeed as any)[k] : undefined;
    if (mine === undefined || mine === null || mine === "") continue;
    if (sourceSeed && eq(mine, wasSeeded)) continue;         // never touched: the new template's own value stands
    doc[k] = mine;
    kept.push(k);
  }
  // A relayout produces a NEW document, not a saved version of one: the save
  // layer stamps savedAt, and carrying the old one across would date the result
  // to whenever the source was last written.
  delete doc.savedAt;

  return {
    doc: doc as MailerDoc,
    report: {
      from: String(current?.mailerId || ""), to: target.id,
      kept, matched, carried: carriedReport, dropped,
      warnings: [...new Set(warnings)],
    },
  };
}

/** Which prop keys may exist on a block of this type after the switch.
 *
 *  Read from `BLOCK_SCHEMAS` at call time, never cached and never listed here,
 *  so a field added to a schema is accepted the moment it exists.
 *
 *  The target template's OWN seed widens it. A couple of templates set props
 *  their schema does not declare (`contacts.tint` is read by the renderer but
 *  has no field), and filtering those out of a document the same template just
 *  produced would change how it renders — the schema is the contract for what
 *  the EDITOR can touch, and this pass is not the place to enforce it on a
 *  template's own output. What it does enforce is that this pass introduces no
 *  key of its own that neither the schema nor the target seed knows about. */
function allowedKeys(type: string, skeleton: MailerDoc): Set<string> {
  const keys = new Set((BLOCK_SCHEMAS[type as BlockType]?.fields || []).map((f) => f.key));
  for (const b of skeleton.blocks) if (b.type === type) for (const k of Object.keys(b.props || {})) keys.add(k);
  return keys;
}
