/* Repair an AI-designed site whose owner uploaded a logo but whose hero opens with another unit — the
   previous edition's lock-up, or one drawn for the event — made before the uploaded logo won
   (functions/lib/api.js, buildLogoUnit). AutoTech Summit 2027 is the case it was written for: its owner's
   '27 logo was passed over for the 2026 edition's '26 lock-up, whose year was never moved on.

   For each such event it does what plan-structure now does with an uploaded logo, without designing the
   site again:
     1. the owner's logo is examined (ownerLogoUnit): the year it shows is read, as written ("2026", "'26"),
        and brought to the event's own year in the same form if it is an earlier edition's (checked by a
        second reading); a sponsor's or another edition's mark drawn into it is cropped out; the event's own
        tagline stays. Nothing else is changed, boxed or redrawn. A logo the examination finds nothing to
        change in is used exactly as uploaded. (1 to 3 reading calls, Gemini, each a small one.)
     2. the result becomes the design's logo unit: designPlan.design.logoUnit* (source 'owner', the note
        from the examination);
     3. the hero in generatedSections — what the editor opens when it has no copy of its own — shows it: the
        unit's picture, its width and height, and no note on the hero.

   NEVER TOUCHED: the saved site (page.html, its versions, the staged snapshot, the preview drafts) and the
   event's logo itself. The saved page is the owner's: the editor puts the owner's logo into the hero there
   when the site is next opened, where the hero still shows the unit that was made automatically, and offers
   it otherwise (editor-template-ui.js, ownerLogoOffer); the owner then saves.

   node tools/repair-owner-logo.js --event <id> [--dry]
   node tools/repair-owner-logo.js --all [--dry]
     --dry   reads only: makes NO model call and writes nothing; prints which events would change and how
             many reading calls the real run would make at most
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

function arg(name, fallback) { const i = process.argv.indexOf('--' + name); return i !== -1 && process.argv[i + 1] && !/^--/.test(process.argv[i + 1]) ? process.argv[i + 1] : fallback; }
const ID = arg('event', '');
const ALL = process.argv.includes('--all');
const DRY = process.argv.includes('--dry');
if ((!ALL && !/^[a-z0-9][a-z0-9-]{1,80}$/.test(ID)) || (ALL && ID)) {
  console.error('Usage: node tools/repair-owner-logo.js (--event <event id> | --all) [--dry]');
  process.exit(2);
}
/* the most reading calls one examination makes: the logo, the logo cut free of another edition's marks,
   and the second reading of a moved year */
const MAX_READS = 3;

function short(url) { return String(url || '').replace(/^https:\/\/storage\.googleapis\.com\/[^\/]+\//, '').slice(0, 110) || '—'; }

(async function () {
  const api = require(path.join(lib, 'api.js'))._testHooks;
  const { getFirebase } = require(path.join(lib, 'firebase.js'));
  const fb = getFirebase();
  if (fb.error) throw new Error('Firebase: ' + fb.error);
  const events = fb.db.collection('events');

  /* which events: one, or every one — read without their generated sites (up to 1 MiB each) */
  let docs;
  if (ALL) {
    const snap = await events.select('name', 'logoUrl', 'designPlan.design', 'site', 'createdAt', 'deletedAt', 'start').get();
    docs = snap.docs;
  } else {
    const one = await events.doc(ID).get();
    if (!one.exists) { console.error(ID + ': no such event.'); process.exit(1); }
    docs = [one];
  }
  const live = docs.filter(function (d) { return api.eventStateOf(d) === 'live'; });
  const due = [];
  live.forEach(function (d) {
    const state = api.ownerLogoState(d.data());
    if (state.needsOwnerUnit) due.push({ id: d.id, data: d.data(), state: state });
  });
  const withLogo = live.filter(function (d) { return api.ownerLogoState(d.data()).logoUrl; }).length;
  const aiDesigned = live.filter(function (d) { return api.ownerLogoState(d.data()).aiDesigned; }).length;
  console.log((DRY ? 'DRY RUN — no model call, nothing written. ' : '') + 'Read ' + live.length + ' live event' + (live.length === 1 ? '' : 's') +
    ' (' + withLogo + ' with an uploaded logo, ' + aiDesigned + ' AI-designed).');
  console.log(due.length + ' event' + (due.length === 1 ? '' : 's') + ' to repair: an uploaded logo, and a hero unit not made from it.');

  let failed = 0;
  for (const ev of due) {
    const d = ev.data, design = d.designPlan.design;
    /* the hero the editor opens with when it has no copy of its own: does it carry a unit to swap? */
    const full = (await events.doc(ev.id).get()).data();
    const hero = (Array.isArray(full.generatedSections) ? full.generatedSections : []).filter(function (s) { return s && s.id === 'hero'; })[0];
    const heroUnit = hero && /<div\b[^>]*\sdata-rv-logo-unit\b/i.test(String(hero.html || ''));
    console.log('\n' + ev.id + ' — ' + (d.name || '(no name)'));
    console.log('  hero unit now:   ' + (design.logoUnitSource || 'none') + ' · ' + short(design.logoUnitUrl) + (design.logoUnitFrom ? ' (from ' + design.logoUnitFrom.slice(0, 90) + ')' : ''));
    console.log('  uploaded logo:   ' + short(ev.state.logoUrl));
    console.log('  saved site:      ' + (ev.state.savedSite ? 'version ' + (+d.site.version) + ' — left as it is; the editor puts the logo in when the site is next opened' : 'none'));
    console.log('  generated hero:  ' + (heroUnit ? 'its unit would be swapped' : hero ? 'has no unit block — design only' : 'none — design only'));
    if (DRY) { console.log('  would examine the uploaded logo with at most ' + MAX_READS + ' reading calls, then write designPlan.design.logoUnit*' + (heroUnit ? ' and the generated hero' : '')); continue; }
    try {
      /* the event's facts and its newest brief, as POST /api/event/logo-unit reads them */
      const inputs = await api.ownerUnitInputs(fb, ev.id, full);
      inputs.stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      inputs.deadlineAt = Date.now() + 150000;
      const unit = await api.ownerLogoUnit(fb, ev.id, inputs);
      if (!unit || unit.refused) { failed++; console.log('  FAILED: ' + ((unit && unit.note) || 'the uploaded logo could not be read as a picture') + ' Nothing written.'); continue; }
      const done = await api.saveOwnerUnit(fb, ev.id, unit, { heroNote: false });
      console.log('  written:         ' + short(unit.url) + ' ' + unit.width + '×' + unit.height + (unit.url === ev.state.logoUrl ? ' (the logo as uploaded)' : ' (examined copy)') +
        (done.heroUpdated ? '; generated hero swapped' : done.toneClash ? '; generated hero NOT swapped: the logo is drawn for a ' + done.toneClash + ' ground and the hero is not' : '; generated hero unchanged'));
      if (unit.note) console.log('  note:            ' + unit.note);
    } catch (err) {
      failed++;
      console.log('  FAILED: ' + (err && err.message || err));
    }
  }
  if (DRY) console.log('\nDRY RUN: nothing written. A real run would make at most ' + due.length * MAX_READS + ' reading calls.');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { console.error('FAILED: ' + (err && err.stack || err)); process.exit(1); });
