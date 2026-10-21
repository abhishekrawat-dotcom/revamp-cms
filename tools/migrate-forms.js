/* Moves events onto registration FORMS ahead of time (functions/lib/forms.js, lib/api-forms.js). Optional:
   every step below also happens by itself, the first time an event needs it —

     1. an event with no form stored gets the form its original registration settings describe
        (forms/register, from forms.legacyDefaultForm), made its default (settings.registration.defaultFormId)
        — otherwise done by the first save of any of its forms;
     2. its registrations made before forms are marked as responses to that form (formId "register",
        formName, counts: true) — otherwise done, 500 at a time, when Reporting first lists them;
     3. its registration totals are worked out again in the form-aware shape (counters.audienceV 2:
        submissions, pending, rejected, per-form counts) — otherwise done just before its next
        registration, change or delete;
     4. its "Register now", when it was made for the event automatically and nobody has edited it since
        (forms.isUntouchedDefault: never saved by anyone but this tool, still questions the platform gave it —
        the original name, email and optional phone / company / designation, or the seven standard questions
        in their old order, First name first), is given today's seven standard questions every new form
        starts with (Official email, First name, Last name, Mobile, Company, Designation, Location; all
        required), then the consent box, and its rev moves on, so a published page holding the old
        definition draws the new one. A form an organiser has saved keeps its questions and their order.
     5. every other stored form that does not end with the consent box (THE CONSENT BOX in
        functions/lib/forms.js) has it stored, last, its own questions and their order untouched. Only the
        form's fields are written — not its rev or who changed it last — so an organiser's open builder is
        not told the form changed under them. Readers already add the box to a form stored without it
        (forms.storedForm); this step writes it down.

   node tools/migrate-forms.js [--dry | --apply] [--event <id> | --prefix <p>]
     --dry (default)   a dry run: reads everything, writes nothing, prints what it would do
     --apply           writes
     --event <id>      that one event
     --prefix <p>      every event whose id starts with <p> (e.g. qa-)
     neither           every live event (deleted events and import records are skipped)

   Env: tools/.env.local (this checkout's, else the main checkout's when run from a worktree), never printed. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const envFile = [path.join(ROOT, 'tools', '.env.local'), path.join(ROOT, '..', '..', '..', 'tools', '.env.local')].filter(function (f) { return fs.existsSync(f); })[0];
if (envFile) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(function (l) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}
const lib = path.join(ROOT, 'functions', 'lib');
const { getFirebase } = require(path.join(lib, 'firebase.js'));
const forms = require(path.join(lib, 'forms.js'));
const audience = require(path.join(lib, 'api-audience.js'));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || '');
}
const APPLY = process.argv.indexOf('--apply') !== -1, DRY = process.argv.indexOf('--dry') !== -1;
const ONE = arg('--event'), PREFIX = arg('--prefix');
const KNOWN = ['--apply', '--dry', '--event', '--prefix'];
const unknown = process.argv.slice(2).filter(function (a, i, all) { return /^--/.test(a) ? KNOWN.indexOf(a) === -1 : !/^--(event|prefix)$/.test(all[i - 1] || ''); });
if ((ONE !== null && !ONE) || (PREFIX !== null && !PREFIX) || (ONE && PREFIX) || (APPLY && DRY) || unknown.length) {
  console.error('Usage: node tools/migrate-forms.js [--dry | --apply] [--event <id> | --prefix <p>]' + (unknown.length ? ' (not understood: ' + unknown.join(' ') + ')' : ''));
  process.exit(2);
}

function isLive(d) { return !!d && !d.deletedAt && !!d.createdAt; }

/* What steps 4 and 5 do to one stored form (forms.migrationPlan) -> { action: 'standard' | 'consent' | 'none',
   patch, say, done } */
function planForm(snap, ev) {
  const p = forms.migrationPlan(snap.id, snap.data() || {}, ev, new Date().toISOString());
  if (p.action === 'standard') return Object.assign(p, { say: APPLY ? 'given the standard seven' : 'would get the standard seven (email first) and the consent box', done: 'given the standard seven' });
  if (p.action === 'consent') return Object.assign(p, { say: p.kept + (APPLY ? '; consent box stored' : '; would store the consent box'), done: p.kept + '; consent box stored' });
  return Object.assign(p, { say: p.kept });
}

async function migrateEvent(fb, id, ev) {
  const ref = fb.db.collection('events').doc(id);
  const out = { id: id, form: 'kept', backfilled: 0, totals: 'kept', questions: 'none stored' };

  /* 1. the first form */
  const stored = await ref.collection('forms').limit(1).get();
  if (stored.empty) {
    out.form = APPLY ? 'created' : 'would create';
    if (APPLY) {
      await fb.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          const now = snap.data() || {};
          if (!isLive(now)) return null;
          return require(path.join(lib, 'api-forms.js')).ensureMaterialized(tx, fb, id, now);
        });
      });
    }
  }

  /* 2. registrations from before forms */
  const regs = await ref.collection('registrations').select('formId').get();
  const missing = regs.docs.filter(function (d) { return d.get('formId') === undefined; });
  out.backfilled = missing.length;
  if (APPLY && missing.length) {
    const reg = await ref.collection('forms').doc(forms.DEFAULT_FORM_ID).get();
    const name = (reg.exists && reg.get('name')) || 'Register now';
    for (let i = 0; i < missing.length; i += 400) {
      const batch = fb.db.batch();
      missing.slice(i, i + 400).forEach(function (d) { batch.update(d.ref, { formId: forms.DEFAULT_FORM_ID, formName: name, counts: true }); });
      await batch.commit();
    }
  }

  /* 4. today's standard questions, for a "Register now" nobody has touched; 5. the consent box, stored last on
     every other form. Each is decided again inside a transaction, on what is stored at that moment: an
     organiser saving the form meanwhile wins. */
  const formDocs = await ref.collection('forms').limit(forms.LIMITS.maxForms + 1).get();
  out.consent = 0;
  for (const d of formDocs.docs) {
    const plan = planForm(d, ev);
    if (d.id === forms.DEFAULT_FORM_ID) out.questions = plan.say;
    if (plan.action === 'none') continue;
    if (!APPLY) { if (plan.action === 'consent') out.consent++; continue; }
    const did = await fb.db.runTransaction(function (tx) {
      return Promise.all([tx.get(ref), tx.get(d.ref)]).then(function (snaps) {
        if (!isLive(snaps[0].data()) || !snaps[1].exists) return false;
        const now = planForm(snaps[1], snaps[0].data() || {});
        if (now.action !== plan.action) return false;
        tx.update(d.ref, now.patch);
        return true;
      });
    });
    if (!did) { if (d.id === forms.DEFAULT_FORM_ID) out.questions = 'changed meanwhile, kept'; continue; }
    if (plan.action === 'consent') out.consent++;
    if (d.id === forms.DEFAULT_FORM_ID) out.questions = plan.done;
  }

  /* 3. the totals */
  const counters = ev.counters && typeof ev.counters === 'object' ? ev.counters : {};
  if (counters.audienceV !== audience.AUDIENCE_V) {
    out.totals = APPLY ? 'rebuilt' : 'would rebuild';
    if (APPLY) await audience.rebuildAudience(fb, id);
  }
  /* what changed, as one line in the event's activity log by "platform" */
  const did = [];
  if (out.form === 'created') did.push('the first form (“Register now”) created');
  if (APPLY && out.backfilled) did.push(out.backfilled + ' earlier registration' + (out.backfilled === 1 ? '' : 's') + ' linked to it');
  if (out.questions === 'given the standard seven') did.push('“Register now” given the seven standard questions (email first) and the consent box');
  if (APPLY && out.consent) did.push('the consent box stored on ' + out.consent + ' form' + (out.consent === 1 ? '' : 's') + ', their questions kept in their order');
  if (APPLY && did.length) await require(path.join(lib, 'activity.js')).logActivity(fb, id, 'platform', 'repaired', 'forms migration (tools/migrate-forms.js): ' + did.join('; '), { area: 'forms' });
  return out;
}

(async function main() {
  const fb = getFirebase();
  if (fb.error) { console.error('Firebase could not start: ' + fb.error); process.exit(1); }
  let docs;
  if (ONE) {
    const snap = await fb.db.collection('events').doc(ONE).get();
    docs = snap.exists ? [snap] : [];
  } else {
    docs = (await fb.db.collection('events').get()).docs;
  }
  const targets = docs.filter(function (d) {
    if (d.id.indexOf('import-') === 0) return false;
    if (PREFIX && d.id.indexOf(PREFIX) !== 0) return false;
    return isLive(d.data());
  });
  console.log((APPLY ? 'APPLYING' : 'DRY RUN (add --apply to write)') + ' — ' + targets.length + ' event' + (targets.length === 1 ? '' : 's'));
  const sum = { created: 0, backfilled: 0, rebuilt: 0, questions: 0, consent: 0, failed: 0 };
  for (const d of targets) {
    try {
      const r = await migrateEvent(fb, d.id, d.data());
      if (/create/.test(r.form)) sum.created++;
      if (/seven/.test(r.questions)) sum.questions++;
      if (/rebuil/.test(r.totals)) sum.rebuilt++;
      sum.backfilled += r.backfilled;
      sum.consent += r.consent;
      console.log('  ' + r.id + ': form ' + r.form + ', ' + r.backfilled + ' registration' + (r.backfilled === 1 ? '' : 's') +
        (APPLY ? ' marked' : ' to mark') + ', totals ' + r.totals + ', Register now: ' + r.questions + ', consent box ' + (APPLY ? 'stored on ' : 'to store on ') + r.consent + ' form' + (r.consent === 1 ? '' : 's'));
    } catch (err) {
      sum.failed++;
      console.error('  ' + d.id + ': FAILED — ' + ((err && err.message) || err));
    }
  }
  console.log('Forms ' + (APPLY ? 'created' : 'to create') + ': ' + sum.created + ' · registrations ' + (APPLY ? 'marked' : 'to mark') + ': ' + sum.backfilled +
    ' · totals ' + (APPLY ? 'rebuilt' : 'to rebuild') + ': ' + sum.rebuilt + ' · Register now forms ' + (APPLY ? 'given' : 'to give') + ' the standard seven: ' + sum.questions +
    ' · forms ' + (APPLY ? 'given' : 'to give') + ' the consent box (order kept): ' + sum.consent +
    (sum.failed ? ' · FAILED: ' + sum.failed : ''));
  process.exit(sum.failed ? 1 : 0);
})().catch(function (err) { console.error((err && err.stack) || err); process.exit(1); });
