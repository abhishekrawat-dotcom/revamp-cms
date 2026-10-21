/* node tools/repair-description.js --event <eventId> [--dry]
   node tools/repair-description.js --all [--dry]

   Writes a real description for an event whose description is still the owner's raw brief (the "Tagline /
   theme: …" headings Create Event asks for, stored there by the brief step before it stopped doing so). The
   description is what the event console's Basics, the published pages' meta description and schema.org data,
   the promotions and the events listing show — two or three sentences about this edition, never the brief.

   One short text call per event (route "event-description", lib/llm.js), from: the event's name, dates and
   venue; its latest brief (events/<id>/briefs: the owner's points, the theme, the key messages); and its
   previous edition (events/<id>/sources, type previousEdition: its name, venue, dates and what its pages say).
   The rule the model follows is lib/event-description.js RULE — the same one plan-structure gives it.

   Writes, on events/<eventId>: description (and updatedAt), and one line in the event's activity log, by
   "platform". Nothing else. A description the owner wrote by hand is never touched: only one that carries the
   brief's headings is replaced, and that is checked again in the write itself.

   --event <id>  that event (a qa- copy too)
   --all         every event whose description is the raw brief — not deleted events, not qa- test events
   --dry         print what would be sent (the prompt) and make no model call, write nothing

   Credentials: the main checkout's tools/.env.local (FIREBASE_* and the model keys, as for tools/serve.js),
   never printed. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const lib = path.join(REPO, 'functions', 'lib');
const ed = require(path.join(lib, 'event-description.js'));

/* the events --all repairs: a description that is the raw brief, on an event that is not deleted and not a
   qa- test event. docs: [{ id, data }]. */
function pick(docs, opts) {
  opts = opts || {};
  return (docs || []).filter(function (d) {
    var data = d.data || {};
    if (data.deletedAt) return false;
    if (!opts.includeQa && /^qa-/.test(d.id)) return false;
    return ed.isRawBrief(data.description);
  });
}

/* what the prompt is built from, read from the event's own records */
function promptInputs(data, briefDoc, sourceDocs) {
  var prev = (sourceDocs || []).filter(function (s) { return s && s.type === 'previousEdition'; })[0] || null;
  return {
    event: { name: data.name, start: data.start, end: data.end, venue: data.venue, city: data.city },
    brief: briefDoc ? briefDoc.extracted || null : null,
    previous: prev && prev.previous ? { name: prev.previous.name, venue: prev.previous.venue, start: prev.previous.start, end: prev.previous.end } : null,
    previousSummary: prev && Array.isArray(prev.extractedSections) ? prev.extractedSections : []
  };
}

function loadEnv() {
  /* the env file sits in the main checkout (a worktree has none): look here, then up from .claude/worktrees/<x> */
  const envCandidates = [path.join(REPO, 'tools', '.env.local'), path.join(REPO, '..', '..', '..', 'tools', '.env.local')];
  const envFile = envCandidates.filter(function (f) { return fs.existsSync(f); })[0];
  if (!envFile) { console.error('tools/.env.local not found'); process.exit(2); }
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(function (line) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.indexOf('--dry') !== -1;
  const all = args.indexOf('--all') !== -1;
  const at = args.indexOf('--event');
  const one = at === -1 ? '' : String(args[at + 1] || '').trim();
  if ((!all && !one) || (all && one) || (one && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(one))) {
    console.error('usage: node tools/repair-description.js (--event <eventId> | --all) [--dry]');
    process.exit(2);
  }
  loadEnv();
  const fb = require(path.join(lib, 'firebase.js')).getFirebase();
  if (fb.error) { console.error('Firebase: ' + fb.error); process.exit(1); }
  const llm = require(path.join(lib, 'llm.js'));
  const { logActivity } = require(path.join(lib, 'activity.js'));
  const events = fb.db.collection('events');

  let targets;
  if (all) {
    const snap = await events.get();
    targets = pick(snap.docs.map(function (d) { return { id: d.id, data: d.data() }; }));
    console.log(targets.length + ' event(s) with the raw brief as their description' + (dry ? ' (dry run: no model call, nothing written)' : '') + ':');
  } else {
    const s = await events.doc(one).get();
    if (!s.exists) throw new Error('No event "' + one + '".');
    targets = pick([{ id: one, data: s.data() }], { includeQa: true });
    if (!targets.length) { console.log(one + ': its description is not the raw brief (or the event is deleted) — nothing to do.'); return; }
  }

  let failures = 0;
  for (const t of targets) {
    const ref = events.doc(t.id);
    const [briefSnap, sourcesSnap] = await Promise.all([
      ref.collection('briefs').orderBy('createdAt', 'desc').limit(1).get(),
      ref.collection('sources').get()
    ]);
    const inputs = promptInputs(t.data, briefSnap.empty ? null : briefSnap.docs[0].data(), sourcesSnap.docs.map(function (d) { return d.data(); }));
    const prompt = ed.buildPrompt(inputs);
    console.log('\n== ' + t.id + ' — ' + (t.data.name || '(no name)') + ' · brief: ' + (inputs.brief ? 'yes' : 'no') + ' · previous edition: ' + (inputs.previous ? inputs.previous.name || 'yes' : 'no') + ' · prompt ' + prompt.length + ' chars');
    if (dry) {
      if (!all) console.log('--- prompt ---\n' + prompt + '\n--- end ---');
      continue;
    }
    const r = await llm.callJson(prompt, ed.SCHEMA, { route: 'event-description', eventId: t.id, maxOutputTokens: 4000 });
    if (r.error) { failures++; console.error('  model failed: ' + (r.code || '') + ' ' + r.error); continue; }
    const text = ed.clean(r.parsed && r.parsed.eventDescription);
    if (!text) { failures++; console.error('  the answer was not a usable description: ' + JSON.stringify(r.parsed).slice(0, 300)); continue; }
    /* checked again in the write: the owner may have written one by hand since it was read */
    let before = null;
    const wrote = await fb.db.runTransaction(async function (tx) {
      const now = await tx.get(ref);
      if (!now.exists || !ed.isRawBrief((now.data() || {}).description)) return false;
      before = now.data().description;
      tx.update(ref, { description: text, updatedAt: new Date().toISOString() });
      return true;
    });
    if (!wrote) { console.log('  skipped: the description changed meanwhile'); continue; }
    await logActivity(fb, t.id, 'platform', 'updated', ed.ACTIVITY_DETAIL, { area: 'event',
      fields: [{ field: 'description', before: String(before || '').slice(0, 600), after: text }] });
    console.log('  written (' + (r.model || r.provider || 'model') + '):\n  ' + text);
  }
  if (failures) process.exitCode = 1;
}

module.exports = { pick, promptInputs };

if (require.main === module) {
  main().then(function () { setTimeout(function () { process.exit(process.exitCode || 0); }, 200); },
    function (err) { console.error(err && err.message ? err.message : err); process.exit(1); });
}
