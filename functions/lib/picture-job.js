/* lib/picture-job.js — the picture job: the one shape every part of ETB2B AI's picture-making shares (the advanced
   picture assistant, plan of 16 Nov 2026, Step 0). Pure data: no model, no network, no Firestore of its own.

   A message may ask for up to MAX_JOBS pictures. Each is a job, kept on the chat turn as turn.pictureJobs[k]; job 0 is
   also kept as turn.newPicture, exactly as before, so an older editor, chatPicture.historyLine and the editor's
   offerAgain read it unchanged. A turn written before jobs existed has only turn.newPicture: jobsOf() reads it as the
   one job, and writing it back keeps it in that one field.

   The stored `state` keeps the words the code has always used ('asked' | 'offered' | 'making' | 'made' | 'failed';
   a made job kept off the page has held: true). phaseOf() gives the plan's names for display, the ledger and the
   closing line: planned, offered, making, made, held, failed, placed, undone.

     MAX_JOBS, MODES, BASED_ON, PLACEMENTS, ENTITY_TYPES, REFUSED_ENTITIES, EDIT_OF, CHANGE_KINDS, REF_USES, REF_KINDS,
     VARIANT_COUNTS, STATES, PHASES, STAGES, VERDICTS, PEOPLE_RULES, MAX_REFS
     phase1Props()                 -> the schema properties the chat model's newPictures entry gains (all required:
                                      the chat route counts optional fields), plus FEEDBACK_PROP for the answer itself
     entryOf(raw)                  -> the new fields of one newPictures entry, cleaned (the rest is planAsk's)
     normalise(job)                -> a job with its plan fields cleaned and defaulted; every other field kept as it is
     jobsOf(turn)                  -> the turn's jobs as stored (raw), [] when it has none
     jobOf(turn, k)                -> one of them, or null
     jobPatch(turn, k, job)        -> the turn fields that store job k: { newPicture } for a turn of one job written
                                      before jobs, else { pictureJobs, newPicture? (when k is 0) }
     writeJob(tx, turnRef, k, patch, turn, extra) -> tx.update of job k, the patch merged onto it
     phaseOf(job)                  -> 'planned' | 'offered' | 'making' | 'made' | 'held' | 'failed' | 'placed' | 'undone'
     fromAsk(ask, k)               -> a job from chatPicture.planAsk's ask (k, mode 'new', the plan fields defaulted)
     briefOf / reviewOf / refOf / editOfOf / focusOf  -> the parts of a job, cleaned (null when unusable)
     answerJob(job)                -> what the editor is sent for one job (chatPicture.answerOf's fields and k)
   Owners (CONTRACT.md): this file is the integrator's; builders add fields here only with the integrator. */
'use strict';

var MAX_JOBS = 4;                       // pictures per message (owner, 16 Nov 2026)
var MAX_REFS = 3;                       // reference pictures the picture model is shown (gemini-2.5-flash-image)
var MAX_ENTITIES = 8;
var MAX_REPAIRS = 3;
var MODES = ['new', 'edit', 'place'];   // a new picture | a change to one already there | an owner's or a document's picture as it is
var BASED_ON = ['owner-words', 'accepted-offer'];
var PLACEMENTS = ['hero', 'background', 'picture'];
var ENTITY_TYPES = ['place', 'landmark', 'venue', 'person', 'brand', 'organisation', 'other'];
var REFUSED_ENTITIES = ['person', 'brand', 'organisation'];   // never drawn; places, landmarks and venues are
var EDIT_OF = ['', 'selected', 'last-made', 'slot'];
var CHANGE_KINDS = ['', 'tone', 'light', 'crop', 'focus', 'remove', 'replace', 'extend', 'style', 'season', 'fill'];
var REF_USES = ['subject', 'style', 'as-is'];
/* where a reference picture comes from: the owner's attachment, a picture taken out of a document, the site's own
   picture, the job's current picture (an edit's base), the previous edition (style only, never an edit base) */
var REF_KINDS = ['attachment', 'document', 'site', 'current', 'previous-edition'];
var VARIANT_COUNTS = [0, 3];            // "Show 3 options" (switch `variants`, off by default)
var STATES = ['asked', 'offered', 'making', 'made', 'failed'];
var PHASES = ['planned', 'offered', 'making', 'made', 'held', 'failed', 'placed', 'undone'];
var STAGES = ['', 'brief', 'picture', 'check', 'repair', 'store'];
var VERDICTS = ['ok', 'trim', 'repair', 'remake', 'hold'];
var PEOPLE_RULES = ['none', 'distant', 'allowed'];
var PLACED = ['', 'placed', 'undone', 'replaced'];
var BRIEF_FIELDS = { scene: 600, composition: 300, palette: 200, light: 160, medium: 120, placeCues: 300, notThis: 200, peopleLine: 200 };

function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function oneLine(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function pick(v, list, dflt) { return list.indexOf(v) !== -1 ? v : dflt; }
function int(v, lo, hi, dflt) { v = parseInt(v, 10); if (!(v >= lo && v <= hi)) return dflt; return v; }
function unit(v) { v = +v; return v >= 0 && v <= 1 ? Math.round(v * 1000) / 1000 : null; }
function httpsUrl(v) { v = String(v || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(v) && v.length <= 1000 ? v : ''; }

/* ---------- phase 1: the chat model's newPictures entry ----------
   The fields W1 adds to chatPicture.schemaItem (behind the `plan` switch), declared once so W3 and W4 can rely on
   them. Gemini-style types, as llm.js's schemas are written. */
function phase1Props() {
  return {
    mode: { type: 'STRING', enum: MODES.slice(), description: 'new: make a new picture; edit: change a picture already on the page (editOf says which); place: put an attached or document picture in as it is' },
    basedOn: { type: 'STRING', enum: BASED_ON.slice(), description: 'owner-words: the owner\'s latest message asks for it; accepted-offer: the owner said yes to the plan you offered' },
    ownerQuote: { type: 'STRING', description: 'the exact words of the owner\'s latest message that ask for this picture, copied as they are; "" for an accepted offer' },
    entities: { type: 'ARRAY', description: 'every proper name in the subject, typed', items: { type: 'OBJECT', properties: {
      text: { type: 'STRING' }, type: { type: 'STRING', enum: ENTITY_TYPES.slice() } }, required: ['text', 'type'] } },
    editOf: { type: 'STRING', enum: EDIT_OF.slice(), description: 'for mode edit: selected (the picture the owner selected), last-made (the last picture you made), slot (the section\'s picture by slot); "" otherwise' },
    change: { type: 'STRING', description: 'for mode edit: one imperative instruction ("make the light warmer; change nothing else"); "" otherwise' },
    changeKind: { type: 'STRING', enum: CHANGE_KINDS.slice(), description: 'for mode edit: what kind of change it is; "" otherwise' },
    refs: { type: 'ARRAY', description: 'numbered attached or document pictures this picture uses', items: { type: 'OBJECT', properties: {
      n: { type: 'INTEGER', minimum: 1 }, use: { type: 'STRING', enum: REF_USES.slice() } }, required: ['n', 'use'] } },
    variants: { type: 'INTEGER', enum: VARIANT_COUNTS.slice(), description: '3 only when the owner asks to see a few options; 0 otherwise' }
  };
}
var PHASE1_FIELDS = Object.keys(phase1Props());
/* once per answer, beside newPictures: what the owner's latest message says about the last picture (W4's ledger) */
var FEEDBACK_PROP = { lastPictureFeedback: { type: 'STRING', description: 'what the owner\'s latest message says about the last picture you made, in a few words ("no people", "not relevant", "too dark"); "" when it says nothing about it' } };

function entitiesOf(v) {
  var out = [];
  (Array.isArray(v) ? v : []).forEach(function (e) {
    e = obj(e);
    if (!e || out.length >= MAX_ENTITIES) return;
    var text = oneLine(e.text, 120);
    if (text) out.push({ text: text, type: pick(e.type, ENTITY_TYPES, 'other') });
  });
  return out;
}
function entryRefsOf(v) {
  var out = [], seen = {};
  (Array.isArray(v) ? v : []).forEach(function (r) {
    r = obj(r);
    var n = r ? int(r.n, 1, 40, 0) : 0;
    if (!n || seen[n] || out.length >= MAX_REFS) return;
    seen[n] = true;
    out.push({ n: n, use: pick(r.use, REF_USES, 'style') });
  });
  return out;
}
/* the new fields of one entry, cleaned; an entry of an older answer (no new fields) reads as a new picture from the
   owner's words with nothing else */
function entryOf(raw) {
  raw = obj(raw) || {};
  var mode = pick(raw.mode, MODES, 'new');
  return {
    mode: mode, basedOn: pick(raw.basedOn, BASED_ON, 'owner-words'), ownerQuote: oneLine(raw.ownerQuote, 400),
    entities: entitiesOf(raw.entities),
    editOf: mode === 'edit' ? pick(raw.editOf, EDIT_OF, '') : '',
    change: mode === 'edit' ? oneLine(raw.change, 300) : '',
    changeKind: mode === 'edit' ? pick(raw.changeKind, CHANGE_KINDS, '') : '',
    refs: entryRefsOf(raw.refs),
    variants: +raw.variants === 3 ? 3 : 0
  };
}

/* ---------- the job's parts ---------- */
function briefOf(v) {
  v = obj(v);
  if (!v) return null;
  var out = {};
  Object.keys(BRIEF_FIELDS).forEach(function (k) { out[k] = oneLine(v[k], BRIEF_FIELDS[k]); });
  return out.scene ? out : null;
}
function focusOf(v) {
  v = obj(v);
  if (!v) return null;
  var x = unit(v.x), y = unit(v.y);
  return x === null || y === null ? null : { x: x, y: y };
}
function boxesOf(v) {
  return (Array.isArray(v) ? v : []).map(function (b) {
    b = obj(b);
    if (!b) return null;
    var x = unit(b.x), y = unit(b.y), w = unit(b.w), h = unit(b.h);
    return x === null || y === null || w === null || h === null ? null : { x: x, y: y, w: w, h: h };
  }).filter(Boolean).slice(0, 12);
}
/* what a look at a made picture found (lib/picture-critic.js review): kept on the job, never a picture */
function reviewOf(v) {
  v = obj(v);
  if (!v) return null;
  var found = obj(v.found) || {};
  var out = { verdict: pick(v.verdict, VERDICTS, 'ok'), source: oneLine(v.source, 20) || 'check', flags: [], found: {}, scores: {}, why: oneLine(v.why, 300) };
  (Array.isArray(v.flags) ? v.flags : []).forEach(function (f) { f = oneLine(f, 30); if (f && out.flags.indexOf(f) === -1 && out.flags.length < 12) out.flags.push(f); });
  Object.keys(found).slice(0, 12).forEach(function (k) {
    var f = found[k];
    if (typeof f === 'boolean') out.found[k] = f;
    else if (obj(f)) out.found[k] = { found: f.found === true, boxes: boxesOf(f.boxes).length };
  });
  var scores = obj(v.scores) || {};
  Object.keys(scores).slice(0, 12).forEach(function (k) { var s = int(scores[k], 0, 5, -1); if (s >= 0) out.scores[k] = s; });
  if (v.repair) out.repair = oneLine(v.repair, 300);
  return out;
}
/* a reference picture shown to the picture model: this event's own picture only (lib/picture-refs.js checks that) */
function refOf(v) {
  v = obj(v);
  if (!v) return null;
  var url = httpsUrl(v.url);
  if (!url) return null;
  var kind = pick(v.kind, REF_KINDS, '');
  if (!kind) return null;
  /* the previous edition and the site's own pictures are style only, never the subject or an edit base (owner, 16 Nov) */
  var use = pick(v.use, REF_USES, 'style');
  if ((kind === 'previous-edition' || kind === 'site') && use !== 'style') use = 'style';
  return { id: oneLine(v.id, 80), kind: kind, url: url, use: use };
}
function editOfOf(v) {
  v = obj(v);
  var url = v ? httpsUrl(v.url) : '';
  return url ? { url: url } : null;
}

/* ---------- the job ---------- */
/* Every plan field cleaned and defaulted; every other field (today's newPicture: n, sectionId, placement, slot, apply,
   kind, alt, subject, frame, state, url, held, heldWhy, tries, checks, …) kept as it is. */
function normalise(job, k) {
  job = obj(job);
  if (!job) return null;
  var out = Object.assign({}, job);
  out.k = int(k == null ? job.k : k, 0, MAX_JOBS - 1, 0);
  out.mode = pick(job.mode, MODES, 'new');
  out.state = pick(job.state, STATES, 'asked');
  out.basedOn = pick(job.basedOn, BASED_ON, 'owner-words');
  out.ownerQuote = oneLine(job.ownerQuote, 400);
  out.plainSubject = oneLine(job.plainSubject, 400);
  out.entities = entitiesOf(job.entities);
  out.peopleRule = pick(job.peopleRule, PEOPLE_RULES, '');
  out.editOf = editOfOf(job.editOf);
  out.change = oneLine(job.change, 300);
  out.changeKind = pick(job.changeKind, CHANGE_KINDS, '');
  out.refs = (Array.isArray(job.refs) ? job.refs : []).map(refOf).filter(Boolean).slice(0, MAX_REFS);
  out.brief = briefOf(job.brief);
  out.stage = pick(job.stage, STAGES, '');
  out.focus = focusOf(job.focus);
  out.review = reviewOf(job.review);
  out.repairs = (Array.isArray(job.repairs) ? job.repairs : []).map(function (r) {
    r = obj(r);
    return r ? { what: oneLine(r.what, 200), at: oneLine(r.at, 40) } : null;
  }).filter(function (r) { return r && r.what; }).slice(0, MAX_REPAIRS);
  out.original = httpsUrl(job.original);
  out.line = oneLine(job.line, 300);
  out.variantOf = job.variantOf == null || job.variantOf === '' ? null : int(job.variantOf, 0, MAX_JOBS - 1, null);
  out.placed = pick(job.placed, PLACED, '');
  return out;
}

/* the turn's jobs, as stored: pictureJobs when it has them, else its one newPicture */
function jobsOf(turn) {
  turn = obj(turn);
  if (!turn) return [];
  if (Array.isArray(turn.pictureJobs) && turn.pictureJobs.length) return turn.pictureJobs.slice(0, MAX_JOBS).map(function (j) { return obj(j); });
  return obj(turn.newPicture) ? [turn.newPicture] : [];
}
function jobOf(turn, k) {
  k = int(k, 0, MAX_JOBS - 1, -1);
  if (k < 0) return null;
  return jobsOf(turn)[k] || null;
}
function hasJobs(turn) { turn = obj(turn); return !!turn && Array.isArray(turn.pictureJobs) && turn.pictureJobs.length > 0; }
/* the fields that store job k, whole */
function jobPatch(turn, k, job) {
  k = int(k, 0, MAX_JOBS - 1, -1);
  if (k < 0 || !obj(job)) throw new Error('picture-job: job ' + k + ' cannot be stored');
  if (!hasJobs(turn)) {
    if (k !== 0) throw new Error('picture-job: a turn of one picture has no job ' + k);
    return { newPicture: job };
  }
  var list = jobsOf(turn).slice();
  if (k >= list.length) throw new Error('picture-job: the turn has no job ' + k);
  list[k] = job;
  var out = { pictureJobs: list };
  if (k === 0) out.newPicture = job;
  return out;
}
/* job k updated inside a transaction that has read `turn`: the patch merged onto the job as it is */
function writeJob(tx, turnRef, k, patch, turn, extra) {
  var cur = jobOf(turn, k);
  if (!cur) throw new Error('picture-job: the turn has no job ' + k);
  tx.update(turnRef, Object.assign(jobPatch(turn, k, Object.assign({}, cur, patch || {})), extra || {}));
  return tx;
}
function phaseOf(job) {
  job = obj(job);
  if (!job) return '';
  if (job.placed === 'placed' || job.placed === 'undone') return job.placed;
  var state = pick(job.state, STATES, 'asked');
  if (state === 'asked') return 'planned';
  if (state === 'made' && job.held === true) return 'held';
  return state;
}
/* a job from planAsk's ask: the ask's own fields as turnRecord keeps them are W1's; this adds k and the plan fields */
function fromAsk(ask, k) {
  if (!obj(ask)) return null;
  return normalise(Object.assign({}, ask, { k: k || 0 }), k || 0);
}
/* what the editor is sent for one job (W1 adds pictureJobs[] to the answer behind the `plan` switch) */
function answerJob(job) {
  job = obj(job);
  if (!job) return null;
  var out = { k: int(job.k, 0, MAX_JOBS - 1, 0), n: job.n, sectionId: job.sectionId, placement: job.placement, slot: job.slot || 0, apply: job.apply, kind: job.kind,
    alt: job.alt || '', subject: String(job.subject || '').slice(0, 140), frame: job.frame || '', mode: pick(job.mode, MODES, 'new') };
  if (job.variantOf != null && job.variantOf !== '') out.variantOf = int(job.variantOf, 0, MAX_JOBS - 1, 0);
  return out;
}

module.exports = {
  MAX_JOBS: MAX_JOBS, MAX_REFS: MAX_REFS, MODES: MODES, BASED_ON: BASED_ON, PLACEMENTS: PLACEMENTS, ENTITY_TYPES: ENTITY_TYPES,
  REFUSED_ENTITIES: REFUSED_ENTITIES, EDIT_OF: EDIT_OF, CHANGE_KINDS: CHANGE_KINDS, REF_USES: REF_USES, REF_KINDS: REF_KINDS,
  VARIANT_COUNTS: VARIANT_COUNTS, STATES: STATES, PHASES: PHASES, STAGES: STAGES, VERDICTS: VERDICTS, PEOPLE_RULES: PEOPLE_RULES,
  PLACED: PLACED, BRIEF_FIELDS: BRIEF_FIELDS, PHASE1_FIELDS: PHASE1_FIELDS, FEEDBACK_PROP: FEEDBACK_PROP,
  phase1Props: phase1Props, entryOf: entryOf, normalise: normalise, jobsOf: jobsOf, jobOf: jobOf, hasJobs: hasJobs,
  jobPatch: jobPatch, writeJob: writeJob, phaseOf: phaseOf, fromAsk: fromAsk, answerJob: answerJob,
  briefOf: briefOf, reviewOf: reviewOf, refOf: refOf, editOfOf: editOfOf, focusOf: focusOf
};
