/* node tools/regenerate-pictures.js --event <id> [--dry]

   Makes an AI-designed site's SECTION pictures again under today's rules (functions/lib/gen-design.js
   imagePrompt kinds, api.js PICTURE KINDS and MAX_PEOPLE_PICTURES): people only in a section about people or
   the gathering, at most two such sections and never side by side; the place, the subject or an illustration
   elsewhere — following the kind of picture the previous edition used for a section doing the same job.
   Made for sites generated before 22 Oct 2026, when every section picture was a photograph of delegates.

     1. the previous edition's section pictures, by kind (section-pictures.js), when its source has none yet:
        its page is read and the kinds kept on the source (what ingest-source now does itself);
     2. one small reading (llm.js, plan-structure's route) chooses each pictured section's kind and scene
        again from what the section says — the sections, their text and layout stay as they are;
     3. the pictures are made as a new site's are (api.js buildSectionImage: stored under the event with a new
        stamp, WebP copies alongside) — one image call a section;
     4. every reference to an old picture is pointed at its new one: designPlan.sections, generatedSections,
        and the saved site and the editors' drafts in Storage (site/page.html, site/snapshot.json,
        site/drafts/*). Never touched: the hero picture (it shows the event, as before), the saved versions
        (site/versions/), and anything published — a published site shows the new pictures once it is
        published again. The old pictures stay in Storage; the event's history lists old -> new, to undo.

   --dry   reads the page and makes the kind reading (one small text call), prints what would change; makes no
           picture and writes nothing.
   Credentials: the main checkout's tools/.env.local, never printed. */
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
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ID = args.indexOf('--event') === -1 ? '' : String(args[args.indexOf('--event') + 1] || '').trim();
if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(ID)) { console.error('usage: node tools/regenerate-pictures.js --event <id> [--dry]'); process.exit(2); }

const lib = path.join(ROOT, 'functions', 'lib');
const api = require(path.join(lib, 'api.js'))._testHooks;
const gd = require(path.join(lib, 'gen-design.js'));
const llm = require(path.join(lib, 'llm.js'));
const { getFirebase } = require(path.join(lib, 'firebase.js'));
const { logActivity } = require(path.join(lib, 'activity.js'));

const KIND_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          imageKind: { type: 'STRING', enum: gd.IMAGE_KINDS },
          image: { type: 'STRING', description: 'one concrete sentence: what the picture shows, of that kind' }
        },
        required: ['id', 'imageKind', 'image']
      }
    }
  },
  required: ['sections']
};

function kindPrompt(event, sections, previousKinds, place) {
  return [
    'You are choosing the pictures of the sections of an event website that is already designed and written: only the pictures change.',
    'The event: ' + event + '.' + (place ? ' It takes place in ' + place + '; let the city show where a scene allows.' : ''),
    '',
    'PICTURE KINDS — a page of photographs of people, section after section, is dull and reads as one picture repeated. Give each section the KIND that suits what it says:',
    '- "people": a photograph whose subject is people — ONLY for a section about people or the gathering itself: networking, who attends or should enter, the audience and the experience of the day, an awards night, testimonials. Indian professionals, women and men in about equal numbers, women in leading roles too; never a real or named person.',
    '- "place": the venue, the city or the setting — no people.',
    '- "subject": the field itself — its technology, products, tools, materials or workplace, as a still life or an industrial photograph, no people.',
    '- "graphic": an illustration or abstract artwork drawn from the subject — with no words, labels or numbers in it.',
    'At most ' + api.MAX_PEOPLE_PICTURES + ' sections with "people", never two of them next to each other; every kind you use must have a reason in what its section says. Each picture is about ITS OWN section, concrete and recognisably of this event\'s field, never the same subject twice, no text or logos in any.',
    previousKinds.length ? '\nThe pictures the previous edition put in its sections (heading: kind — what it showed); for a section doing the same job, choose the same kind (a new picture, never theirs):\n' + previousKinds.map(function (p) { return '- "' + p.heading + '": ' + p.kind + ' — ' + p.about; }).join('\n') : '',
    '',
    'The sections, in page order (id; what it says; its layout; its picture now):',
    sections.map(function (s) { return '- ' + s.id + ': ' + s.purpose + ' | layout: ' + s.layout + ' | now: ' + s.image; }).join('\n'),
    '',
    'Answer every one of these sections: its id, the kind, and the new picture in one concrete sentence.'
  ].join('\n');
}

(async function () {
  const fb = getFirebase();
  if (fb.error) throw new Error('Firebase: ' + fb.error);
  const ref = fb.db.collection('events').doc(ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('no event ' + ID);
  const e = snap.data();
  const plan = e.designPlan;
  if (!plan || !Array.isArray(plan.sections) || !plan.design) throw new Error(ID + ' has no AI design (designPlan)');
  const pictured = plan.sections.filter(function (s) { return s && s.image && s.imageUrl; });
  if (!pictured.length) { console.log(ID + ': no section pictures to make again.'); process.exit(0); }
  console.log(ID + ' — ' + e.name + ': ' + pictured.length + ' section pictures');

  /* 1. the previous edition's section pictures, by kind */
  const srcSnap = await ref.collection('sources').get();
  const prevDoc = srcSnap.docs.filter(function (d) { return d.data().type === 'previousEdition'; })[0];
  let previousKinds = prevDoc && Array.isArray(prevDoc.data().sectionPictures) ? prevDoc.data().sectionPictures : null;
  if (prevDoc && !previousKinds) {
    const url = prevDoc.data().url;
    const html = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36' } })
      .then(function (r) { return r.ok ? r.text() : ''; }, function () { return ''; });
    const kv = prevDoc.data().keyVisual && prevDoc.data().keyVisual.url;
    previousKinds = html ? await api.readSectionPictures(ID, html, url, [kv], Date.now() + 200000) : [];
    console.log('  previous edition (' + url + '): ' + (html ? previousKinds.length + ' section pictures read' : 'page could not be read'));
    if (!DRY && html) await prevDoc.ref.update({ sectionPictures: previousKinds });
  }
  previousKinds = previousKinds || [];
  previousKinds.forEach(function (p) { console.log('    "' + p.heading + '": ' + p.kind + ' — ' + p.about); });

  /* 2. the kinds and scenes, chosen again */
  const place = plan.design.place && plan.design.place.city ? plan.design.place.city : (e.city || '');
  const about = [e.name, (e.description || '').replace(/\s+/g, ' ').slice(0, 300), [e.venue, e.city].filter(Boolean).join(', ')].filter(Boolean).join(' — ').slice(0, 400);
  const r = await llm.callJson(kindPrompt(about, pictured, previousKinds, place), KIND_SCHEMA, { route: 'plan-structure', eventId: ID, maxOutputTokens: 8192 });
  if (r.error) throw new Error('the kind reading failed: ' + r.error);
  const chosen = {};
  (r.parsed.sections || []).forEach(function (c) { if (c && c.id) chosen[c.id] = c; });
  const next = pictured.map(function (s) {
    const c = chosen[s.id] || {};
    return { id: s.id, name: s.name || '', purpose: s.purpose || '', image: String(c.image || s.image).trim().slice(0, 300), imageKind: gd.IMAGE_KINDS.indexOf(c.imageKind) !== -1 ? c.imageKind : 'subject', old: s };
  });
  api.fewerPeoplePictures(next);
  next.forEach(function (s) { console.log('  ' + s.id + ': ' + s.imageKind + ' — ' + s.image); });
  if (DRY) { console.log('\nDRY RUN: no picture made, nothing written.'); process.exit(0); }

  /* 3. the pictures */
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const design = Object.assign({}, plan.design, gd.palette(plan.design, 'auto'));
  const level = plan.owner && plan.owner.level ? plan.owner.level : '';
  const made = await Promise.all(next.map(function (s) {
    const context = 'It illustrates the section of the event\'s website that is about this (for your understanding only — none of these words may be written in the picture): ' + s.purpose;
    return api.buildSectionImage(fb, ID, s.id, s.image, design, stamp, context, about, level, s.imageKind);
  }));
  const swaps = {};
  next.forEach(function (s, i) {
    if (!made[i] || !made[i].url) { console.log('  ' + s.id + ': picture could not be made — the old one stays'); return; }
    swaps[s.old.imageUrl] = made[i].url;
    console.log('  ' + s.id + ': ' + made[i].url.replace(/^https:\/\/storage\.googleapis\.com\/[^\/]+\//, ''));
  });
  const olds = Object.keys(swaps);
  if (!olds.length) { console.log('No picture was made; nothing changed.'); process.exit(1); }
  function swapIn(text) { let t = String(text); olds.forEach(function (o) { t = t.split(o).join(swaps[o]); }); return t; }

  /* 4. every reference */
  const fresh = (await ref.get()).data();
  const sections = fresh.designPlan.sections.map(function (s) {
    const n = next.filter(function (x) { return x.old.imageUrl === s.imageUrl && swaps[s.imageUrl]; })[0];
    return n ? Object.assign({}, s, { image: n.image, imageKind: n.imageKind, imageUrl: swaps[s.imageUrl] }) : s;
  });
  const generated = (fresh.generatedSections || []).map(function (g) { return Object.assign({}, g, { html: swapIn(g.html || ''), css: swapIn(g.css || '') }); });
  await ref.update({ 'designPlan.sections': sections, generatedSections: generated });
  const [files] = await fb.bucket.getFiles({ prefix: 'events/' + ID + '/site/' });
  let touched = 0;
  for (const f of files) {
    if (/\/site\/versions\//.test(f.name) || !/\.(html|json)$/.test(f.name)) continue;
    const [buf] = await f.download();
    const before = buf.toString('utf8'), after = swapIn(before);
    if (after === before) continue;
    const [meta] = await f.getMetadata();
    await f.save(after, { resumable: false, metadata: { contentType: meta.contentType || (/\.json$/.test(f.name) ? 'application/json' : 'text/html; charset=utf-8'), cacheControl: meta.cacheControl } });
    touched++;
    console.log('  updated ' + f.name.replace('events/' + ID + '/', ''));
  }
  await logActivity(fb, ID, 'platform', 'updated', 'Section pictures made again under the new picture rules (people only where the section is about people): ' +
    next.filter(function (s) { return swaps[s.old.imageUrl]; }).map(function (s) { return s.id + ' → ' + s.imageKind; }).join(', '),
    { area: 'design', pictures: olds.map(function (o) { return { from: o, to: swaps[o] }; }) });
  console.log('\nDone: ' + olds.length + ' pictures, ' + touched + ' saved/draft file(s) updated.' + (fresh.published ? ' The site is published: publish again for visitors to see them.' : ''));
  process.exit(0);
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
