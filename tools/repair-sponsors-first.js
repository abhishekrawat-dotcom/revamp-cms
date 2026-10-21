/* node tools/repair-sponsors-first.js --event <eventId> [--dry] [--new-draft]

   Puts an AI-designed site that was planned before the rule into today's order (functions/lib/section-order.js):
   the sponsors straight after the hero — this edition's sponsors section, then the "Previous Edition Sponsors"
   section — and every other section where it was. Writes, on events/<eventId>:
     designPlan.sections   the sponsors first (nothing else in the plan changes)
     generatedSections     the same order, the sponsors right after the hero; the nav's and the footer's links
                           to sections put in that order (only their order: every link, word and attribute stays)
   Nothing else on the event is written. A site with no sponsors section of either edition, or one already in
   order, is left alone.

   --dry        print what would change, write nothing
   --new-draft  also add a drafts row and move generatedAt on (as a regeneration does), so an editor that has a
                copy of the site in its browser (IndexedDB) takes this version on its next opening, and its
                Preview then rebuilds the preview draft from it. Any edit the owner made in the editor since the
                last generation is in that browser copy only, and is replaced by the stored site — use it when
                there are none, or the owner agrees. Without it, the editor's copy keeps its order until the
                owner moves the section there (or the site is generated again); preview and publish follow the
                page the editor saves.

   Credentials: the main checkout's tools/.env.local (FIREBASE_* as for tools/serve.js), never printed. */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dry = args.indexOf('--dry') !== -1;
const newDraft = args.indexOf('--new-draft') !== -1;
const eventId = (args[args.indexOf('--event') + 1] || '').trim();
if (args.indexOf('--event') === -1 || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(eventId)) {
  console.error('usage: node tools/repair-sponsors-first.js --event <eventId> [--dry] [--new-draft]');
  process.exit(2);
}

const REPO = path.join(__dirname, '..');
/* the env file sits in the main checkout (a worktree has none): look here, then up from .claude/worktrees/<x> */
const envCandidates = [path.join(REPO, 'tools', '.env.local'), path.join(REPO, '..', '..', '..', 'tools', '.env.local')];
const envFile = envCandidates.filter(function (f) { return fs.existsSync(f); })[0];
if (!envFile) { console.error('tools/.env.local not found'); process.exit(2); }
fs.readFileSync(envFile, 'utf8').split('\n').forEach(function (line) {
  var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
});

const so = require(path.join(REPO, 'functions', 'lib', 'section-order.js'));
const fb = require(path.join(REPO, 'functions', 'lib', 'firebase.js')).getFirebase();
if (fb.error) { console.error('Firebase: ' + fb.error); process.exit(1); }

function ids(list) { return (list || []).map(function (s) { return s && s.id; }).join(', '); }
function hrefs(html) { return (String(html || '').match(/href\s*=\s*["']#[^"']*["']/gi) || []).map(function (h) { return h.replace(/^href\s*=\s*["']#|["']$/gi, ''); }).join(', '); }

(async function () {
  const ref = fb.db.collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No event "' + eventId + '".');
  const data = snap.data();
  const plan = data.designPlan;
  const gen = data.generatedSections;
  if (!plan || !Array.isArray(plan.sections) || !Array.isArray(gen) || !gen.length) throw new Error('"' + eventId + '" is not an AI-designed site (no designPlan.sections / generatedSections).');

  const sponsors = [so.sponsorsId(plan.sections), so.previousSponsorsId(plan.sections)].filter(Boolean);
  console.log('event:            ' + eventId);
  console.log('sponsors sections: ' + (sponsors.join(', ') || '(none — nothing to do)'));
  if (!sponsors.length) return;

  const planAfter = so.sponsorsFirst(plan.sections);
  const genAfter = so.sponsorsAfterHero(gen, plan.sections).map(function (s) { return Object.assign({}, s); });
  const pageIds = genAfter.map(function (s) { return s.id; });
  const linkChanges = [];
  genAfter.forEach(function (s) {
    if (s.id !== 'nav' && s.id !== 'footer') return;
    const html = so.orderNavLinks(s.html, pageIds);
    if (html !== s.html) {
      if (html.length !== String(s.html).length) throw new Error('link reorder changed the length of ' + s.id + ' — refusing');
      linkChanges.push(s.id + ' links: ' + hrefs(s.html) + '\n            -> ' + hrefs(html));
      s.html = html;
    }
  });

  /* nothing but order may differ: the same sections, each unchanged apart from nav/footer link order */
  if (planAfter.length !== plan.sections.length || genAfter.length !== gen.length) throw new Error('a section count changed — refusing');
  genAfter.forEach(function (s) {
    const was = gen.filter(function (g) { return g.id === s.id; })[0];
    if (!was || (s.id !== 'nav' && s.id !== 'footer' && was.html !== s.html) || was.css !== s.css || was.kind !== s.kind) throw new Error('section ' + s.id + ' would change beyond its order — refusing');
  });

  /* two rows that move on their own never stand in neighbouring sections (genDesign.motionBudget): only
     reported here, since this script changes no section's own markup */
  genAfter.forEach(function (s, i) {
    const auto = function (x) { return x && /data-rv-carousel\s*=\s*["']auto["']/i.test(String(x.html || '')); };
    if (i && auto(s) && auto(genAfter[i - 1])) console.log('NOTE: ' + genAfter[i - 1].id + ' and ' + s.id + ' both have a self-scrolling row and now stand next to each other');
  });

  const planMoved = ids(planAfter) !== ids(plan.sections);
  const genMoved = ids(genAfter) !== ids(gen);
  console.log('designPlan.sections: ' + ids(plan.sections));
  console.log('                  -> ' + (planMoved ? ids(planAfter) : '(unchanged)'));
  console.log('generatedSections:   ' + ids(gen));
  console.log('                  -> ' + (genMoved ? ids(genAfter) : '(unchanged)'));
  linkChanges.forEach(function (l) { console.log(l); });
  if (!planMoved && !genMoved && !linkChanges.length) { console.log('already in order — nothing written'); return; }
  if (dry) { console.log('--dry: nothing written'); return; }

  const now = new Date().toISOString();
  const update = { 'designPlan.sections': planAfter, generatedSections: genAfter };
  if (newDraft) { update.generatedAt = now; update.updatedAt = now; }
  /* only over the version read above: a save in between makes this fail rather than be overwritten */
  await ref.update(update, { lastUpdateTime: snap.updateTime });
  console.log('written: designPlan.sections, generatedSections' + (newDraft ? ', generatedAt' : ''));
  await require(path.join(REPO, 'functions', 'lib', 'activity.js')).logActivity(fb, eventId, 'platform', 'repaired',
    'section order repair (tools/repair-sponsors-first.js): sponsors placed right after the hero' + (linkChanges.length ? ', menu links updated' : ''), { area: 'site' });
  if (newDraft) {
    const last = await ref.collection('drafts').orderBy('generatedAt', 'desc').limit(1).get();
    const prev = last.empty ? {} : last.docs[0].data();
    const row = await ref.collection('drafts').add({
      templateId: prev.templateId || ('gen-' + eventId), sourceEventId: prev.sourceEventId || eventId, library: {},
      positioningNotes: prev.positioningNotes || '', model: prev.model || '', generatedAt: now, skippedLibraries: [],
      note: 'sponsors placed after the hero (tools/repair-sponsors-first.js)'
    });
    console.log('drafts row added: ' + row.id);
  }
})().then(function () { process.exit(0); }, function (err) { console.error(err.message || err); process.exit(1); });
