/* Repair an AI-designed site whose hero opens with the event's name drawn (or set in type) although a
   previous edition's logo was named on its page — the case of ETCIO Annual Conclave 2027, made on 21 Oct
   2026: the 2026 lock-up was 251 x 400 (its sponsors stacked above and below it), was refused for being
   taller than wide before it was ever looked at, and the owner was told nothing (functions/lib/api.js,
   previousEditionUnit and buildLogoUnit, since fixed).

   For one event it does what plan-structure now does, without designing the site again:
     1. the previous edition's logo is fetched and examined (previousEditionUnit): the year it shows brought
        to this edition's in the same form, the sponsors, "presents" / "in association with" lines and other
        editions' marks cropped out, the event's own tagline kept — never boxed, never redrawn. Up to four
        reading calls (Gemini, each a small one: the whole lock-up, the cut, a moved year, a retry);
     2. the result becomes the design's logo unit (designPlan.design.logoUnit*, source 'previous-edition')
        and the generated hero's (generatedSections), with the note from the examination;
     3. when it cannot be used, nothing is swapped: the reason is written as the design's logo note (when it
        has none), so that the owner reads it in the console and the editor.

   NEVER TOUCHED: the saved site (page.html, its versions, the staged snapshot, the preview drafts) and the
   event's own logo field. The editor puts the new unit into a saved site's hero when it is next opened,
   where that hero still shows the unit made automatically (editor-template-ui.js, ownerLogoOffer); the owner
   then saves. An event with an uploaded logo is tools/repair-owner-logo.js's.

   node tools/repair-logo-unit.js --event <id> [--dry]
   node tools/repair-logo-unit.js --list
     --dry    reads only: makes NO model call and writes nothing. It fetches the previous edition's logo (a
              public picture) to say what it is, and prints what a real run would do.
     --list   reads only: every live AI-designed event without an uploaded logo whose hero unit is not the
              previous edition's although a previous edition's page named a logo — the likely cases.
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
const LIST = process.argv.includes('--list');
const DRY = process.argv.includes('--dry');
if ((!LIST && !/^[a-z0-9][a-z0-9-]{1,80}$/.test(ID)) || (LIST && ID)) {
  console.error('Usage: node tools/repair-logo-unit.js (--event <event id> [--dry] | --list)');
  process.exit(2);
}
const MAX_READS = 4;

function short(url) { return String(url || '').replace(/^https:\/\/storage\.googleapis\.com\/[^\/]+\//, '').slice(0, 110) || '—'; }

(async function () {
  const api = require(path.join(lib, 'api.js'))._testHooks;
  const logoUnit = require(path.join(lib, 'logo-unit.js'));
  const { getFirebase } = require(path.join(lib, 'firebase.js'));
  const { logActivity } = require(path.join(lib, 'activity.js'));
  const fb = getFirebase();
  if (fb.error) throw new Error('Firebase: ' + fb.error);
  const events = fb.db.collection('events');

  /* the previous edition's page that named a logo, as plan-structure picks it */
  async function sourceOf(id) {
    const snap = await events.doc(id).collection('sources').get();
    const docs = snap.docs.map(function (d) { return d.data(); });
    return { docs: docs, best: api.unitSources(docs)[0] || null };
  }
  function due(data) {
    const state = api.ownerLogoState(data);
    return state.aiDesigned && !state.logoUrl && state.source !== 'previous-edition';
  }

  if (LIST) {
    const snap = await events.select('name', 'logoUrl', 'designPlan.design.logoUnitSource', 'designPlan.design.logoUnitNote', 'designPlan.design.logoUnitUrl', 'site', 'createdAt', 'deletedAt').get();
    const live = snap.docs.filter(function (d) { return api.eventStateOf(d) === 'live'; });
    const candidates = live.filter(function (d) { return due(d.data()); });
    console.log('READ ONLY. ' + live.length + ' live events; ' + candidates.length + ' AI-designed without an uploaded logo and without the previous edition\'s unit in the hero.');
    let found = 0;
    for (const d of candidates) {
      const src = await sourceOf(d.id);
      if (!src.best) continue;
      found++;
      const data = d.data(), design = data.designPlan.design;
      console.log('\n' + d.id + ' — ' + (data.name || '(no name)') + ' (created ' + String(data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || '').slice(0, 10) + ')');
      console.log('  hero unit:  ' + (design.logoUnitSource || 'set in type') + ' · ' + short(design.logoUnitUrl));
      console.log('  note:       ' + (design.logoUnitNote ? design.logoUnitNote.slice(0, 160) : '(none — the owner was told nothing)'));
      console.log('  named logo: ' + src.best.logoCandidates.slice(0, 3).map(function (c) { return (c.url || c.kind) + ' (score ' + c.score + ')'; }).join(' · ').slice(0, 220));
      console.log('  saved site: ' + (data.site && +data.site.version > 0 ? 'version ' + data.site.version : 'none'));
    }
    console.log('\n' + found + ' event' + (found === 1 ? ' names' : 's name') + ' a previous edition\'s logo and ' + (found === 1 ? 'does' : 'do') + ' not show it.');
    /* the other half of the same complaint: the previous edition's unit is shown, its sponsors still in it */
    const withSponsors = live.filter(function (d) {
      const design = (d.data().designPlan || {}).design || {};
      return design.logoUnitSource === 'previous-edition' && /could not be cropped out cleanly/.test(String(design.logoUnitNote || ''));
    });
    console.log(withSponsors.length + ' event' + (withSponsors.length === 1 ? ' shows' : 's show') + ' the previous edition\'s unit with marks that could not be cropped out' +
      (withSponsors.length ? ': ' + withSponsors.map(function (d) { return d.id; }).join(', ') + ' (run --event on each after this fix: the cut now handles more shapes)' : '.'));
    process.exit(0);
  }

  const snap = await events.doc(ID).get();
  if (!snap.exists || api.eventStateOf(snap) !== 'live') { console.error(ID + ': no such live event.'); process.exit(1); }
  const data = snap.data(), state = api.ownerLogoState(data), design = (data.designPlan && data.designPlan.design) || null;
  console.log((DRY ? 'DRY RUN — no model call, nothing written.\n' : '') + ID + ' — ' + (data.name || '(no name)'));
  if (!state.aiDesigned) { console.log('  not an AI-designed site: its template places the logo. Nothing to do.'); process.exit(0); }
  if (state.logoUrl) { console.log('  the owner uploaded a logo: use tools/repair-owner-logo.js --event ' + ID + '. Nothing done.'); process.exit(0); }
  console.log('  hero unit now:   ' + (design.logoUnitSource || 'set in type') + ' · ' + short(design.logoUnitUrl));
  console.log('  note now:        ' + (design.logoUnitNote || '(none)'));
  if (state.source === 'previous-edition') { console.log('  the hero already shows the previous edition\'s unit. Nothing to do.'); process.exit(0); }
  const src = await sourceOf(ID);
  if (!src.best) { console.log('  no previous edition\'s page named a logo. Nothing to do.'); process.exit(0); }
  console.log('  previous edition: ' + src.best.url);
  src.best.logoCandidates.slice(0, 3).forEach(function (c, i) { console.log('  candidate ' + (i + 1) + ':     ' + (c.url || c.kind) + ' (score ' + c.score + (c.cls ? ', ' + c.cls : '') + ')'); });
  const hero = (Array.isArray(data.generatedSections) ? data.generatedSections : []).filter(function (s) { return s && s.id === 'hero'; })[0];
  const heroUnit = hero && /<div\b[^>]*\sdata-rv-logo-unit\b/i.test(String(hero.html || ''));
  console.log('  saved site:      ' + (state.savedSite ? 'version ' + (+data.site.version) + ' — left as it is; the editor puts the unit in when the site is next opened' : 'none'));
  console.log('  generated hero:  ' + (heroUnit ? 'its unit would be swapped' : hero ? 'has no unit block — design only' : 'none — design only'));

  if (DRY) {
    /* what the first candidate is, as the examination will see it (a public picture; no model call) */
    const { safeFetch } = require(path.join(lib, 'safe-fetch.js'));
    const first = src.best.logoCandidates[0];
    if (first && first.url) {
      try {
        const r = await safeFetch(first.url, { timeoutMs: 8000, maxBytes: 3 * 1024 * 1024 });
        const info = logoUnit.imageInfo(r.body);
        const why = logoUnit.plausibleUnit(info);
        console.log('  candidate 1 is:  HTTP ' + r.status + ', ' + (info.type || 'not a picture') + ' ' + Math.round(info.width || 0) + ' × ' + Math.round(info.height || 0) +
          (why ? ' — ' + why + (logoUnit.stackedUnit(info) ? ': a lock-up stacked with its sponsors, now taken and cut down to its own lock-up' : ': refused (the owner is now told)') : ' — a plausible unit'));
      } catch (e) { console.log('  candidate 1:     could not be fetched (' + e.message + ')'); }
    }
    console.log('  would examine it with at most ' + MAX_READS + ' reading calls, then write designPlan.design.logoUnit*' + (heroUnit ? ' and the generated hero' : '') +
      ' — or, if it cannot be used, only the note saying why.');
    console.log('\nDRY RUN: nothing written. A real run would make at most ' + MAX_READS + ' reading calls.');
    process.exit(0);
  }

  const brief = await events.doc(ID).collection('briefs').orderBy('createdAt', 'desc').limit(1).get();
  const eventMeta = { name: data.name, start: data.start, description: data.description };
  const unit = await api.previousEditionUnit(fb, ID, {
    eventMeta: eventMeta, briefTexts: api.briefYearTexts(brief.empty ? null : brief.docs[0].data().extracted, eventMeta), sourceDocs: src.docs,
    stamp: new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14), deadlineAt: Date.now() + 200000
  });
  if (!unit || unit.stuck || unit.failed) {
    const note = (unit && unit.note) || api.previousUnitNote('it could not be examined');
    console.log('  NOT USED:        ' + note);
    if (!String(design.logoUnitNote || '').trim()) {
      await events.doc(ID).update({ 'designPlan.design.logoUnitNote': note, updatedAt: new Date().toISOString() });
      console.log('  written:         the note only (designPlan.design.logoUnitNote), so the owner is told in the console and the editor');
    }
    process.exit(1);
  }
  const done = await api.saveOwnerUnit(fb, ID, unit, { heroNote: false });
  await logActivity(fb, ID, 'platform', 'logo-changed', 'logo repair (tools/repair-logo-unit.js): the previous edition’s logo put into the site’s design' +
    (done.heroUpdated ? '; banner updated' : done.toneClash ? '; banner kept — the logo is drawn for a ' + done.toneClash + ' background' : ''), { area: 'design' });
  console.log('  written:         ' + short(unit.url) + ' ' + Math.round(unit.width) + '×' + Math.round(unit.height) +
    (done.heroUpdated ? '; generated hero swapped' : done.toneClash ? '; generated hero NOT swapped: the logo is drawn for a ' + done.toneClash + ' ground and the hero is not' : '; generated hero unchanged'));
  if (unit.note) console.log('  note:            ' + unit.note);
  process.exit(0);
})().catch(function (err) { console.error('FAILED: ' + (err && err.stack || err)); process.exit(1); });
