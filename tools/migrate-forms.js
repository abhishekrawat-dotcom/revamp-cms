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
        (forms.isUntouchedDefault: never saved, rev 0, still the original questions — name, email and the
        optional phone / company / designation), is given the seven standard questions every new form starts
        with (First name, Last name, Email, Mobile, Company, Designation, Location; all required) and rev 1,
        so a published page holding the old definition draws the new one. A form anyone has saved is left as
        it is. This step is the only one that does not also happen by itself.

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

  /* 4. the seven standard questions, for a "Register now" nobody has touched (decided again inside the
     transaction, on what is stored at that moment: an organiser saving it meanwhile wins) */
  const formRef = ref.collection('forms').doc(forms.DEFAULT_FORM_ID);
  const stored4 = await formRef.get();
  if (stored4.exists) {
    const f = forms.storedForm(stored4.id, stored4.data());
    const hasStd = forms.DEFAULT_FIELD_IDS.every(function (fid) { return f.fields.some(function (x) { return x.id === fid; }); });
    if (!forms.isUntouchedDefault(f, ev)) out.questions = hasStd ? 'already has the standard questions' : f.rev ? 'edited by the organiser, kept' : 'kept (not the original questions)';
    else if (!APPLY) out.questions = 'would get the standard seven';
    else {
      out.questions = await fb.db.runTransaction(function (tx) {
        return Promise.all([tx.get(ref), tx.get(formRef)]).then(function (snaps) {
          const evNow = snaps[0].data() || {}, fNow = snaps[1].exists ? forms.storedForm(snaps[1].id, snaps[1].data()) : null;
          if (!isLive(evNow) || !fNow || !forms.isUntouchedDefault(fNow, evNow)) return 'changed meanwhile, kept';
          tx.update(formRef, { fields: forms.defaultFields(), rev: 1, updatedAt: new Date().toISOString(), updatedBy: 'migration: standard questions' });
          return 'given the standard seven';
        });
      });
    }
  }

  /* 3. the totals */
  const counters = ev.counters && typeof ev.counters === 'object' ? ev.counters : {};
  if (counters.audienceV !== audience.AUDIENCE_V) {
    out.totals = APPLY ? 'rebuilt' : 'would rebuild';
    if (APPLY) await audience.rebuildAudience(fb, id);
  }
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
  const sum = { created: 0, backfilled: 0, rebuilt: 0, questions: 0, failed: 0 };
  for (const d of targets) {
    try {
      const r = await migrateEvent(fb, d.id, d.data());
      if (/create/.test(r.form)) sum.created++;
      if (/seven/.test(r.questions)) sum.questions++;
      if (/rebuil/.test(r.totals)) sum.rebuilt++;
      sum.backfilled += r.backfilled;
      console.log('  ' + r.id + ': form ' + r.form + ', ' + r.backfilled + ' registration' + (r.backfilled === 1 ? '' : 's') +
        (APPLY ? ' marked' : ' to mark') + ', totals ' + r.totals + ', Register now: ' + r.questions);
    } catch (err) {
      sum.failed++;
      console.error('  ' + d.id + ': FAILED — ' + ((err && err.message) || err));
    }
  }
  console.log('Forms ' + (APPLY ? 'created' : 'to create') + ': ' + sum.created + ' · registrations ' + (APPLY ? 'marked' : 'to mark') + ': ' + sum.backfilled +
    ' · totals ' + (APPLY ? 'rebuilt' : 'to rebuild') + ': ' + sum.rebuilt + ' · Register now forms ' + (APPLY ? 'given' : 'to give') + ' the standard seven: ' + sum.questions +
    (sum.failed ? ' · FAILED: ' + sum.failed : ''));
  process.exit(sum.failed ? 1 : 0);
})().catch(function (err) { console.error((err && err.stack) || err); process.exit(1); });
