/* Repair an AI-designed site made before the previous edition's look and the venue's city were read
   (functions/lib/edition-look.js). For ONE event, it does what plan-structure now does, without designing
   the site again:

     1. reads the event's previous-edition link again (the previousEdition source's url): the edition's own
        palette and type (its own styles, its lock-up's colours) and its banner artwork, described in words
        by the text model (1 cheap call, with the picture attached) -> stored on that source as look, keyVisual
     2. the city: this edition's venue, else the previous edition's; its cues and one motif are written by the
        text model (1 cheap call) -> designPlan.design.place
     3. the palette and type: the design's own colours and fonts, moved back into the edition's family where
        they left it — INSPIRED BY the edition, never its own values (edition-look.js inspiredDesign) — and the
        sections' literal colours moved with them (recolour) -> designPlan.design, generatedSections
     4. pictures (paid image calls, one each): the hero, inspired by the edition's banner artwork in words and
        set in the city, and the section pictures named in --images, set in the city. Each goes to a NEW
        storage path; the old ones are left where they are (a draft open elsewhere still shows them).

   Nothing else is touched: section copy, layout, the logo unit, the Previous Edition sections' records.
   With no previous-edition link the event is left as it is (such a site is designed exactly as before).

   node tools/scratch/repair-edition-look.js --event <id> [--dry] [--images hero,overview,...|all|none]
                                              [--theme original|keep]
     --dry       reads everything, makes NO model call, writes nothing; prints what would change and how
                 many paid calls the real run would make
     --images    which pictures to make again (default: hero and every section whose picture is in its
                 markup); 'none' for none
     --theme     'original' sets the site's theme back to "As designed" (the palette this repairs); 'keep'
                 (default) leaves the owner's choice in the theme switcher as it is
   Env: tools/.env.local of the repo it runs in (Firebase admin, the model keys). Run from the repo root. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const envFile = path.join(ROOT, 'tools', '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(function (l) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}
const lib = path.join(ROOT, 'functions', 'lib');
const api = require(path.join(lib, 'api.js'))._testHooks;
const el = require(path.join(lib, 'edition-look.js'));
const gd = require(path.join(lib, 'gen-design.js'));
const llm = require(path.join(lib, 'llm.js'));
const { callGeminiImage } = require(path.join(lib, 'gemini.js'));
const { safeFetch } = require(path.join(lib, 'safe-fetch.js'));
const logoUnit = require(path.join(lib, 'logo-unit.js'));

function arg(name, fallback) { const i = process.argv.indexOf('--' + name); return i !== -1 && process.argv[i + 1] && !/^--/.test(process.argv[i + 1]) ? process.argv[i + 1] : fallback; }
const ID = arg('event', '');
const DRY = process.argv.includes('--dry');
const IMAGES = arg('images', '');
const THEME = arg('theme', 'keep');
if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(ID)) { console.error('Usage: --event <event id> [--dry] [--images ...] [--theme original|keep]'); process.exit(2); }

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
const PLACE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    placeCity: api.DESIGN_PLAN_SCHEMA.properties.design.properties.placeCity,
    placeCues: api.DESIGN_PLAN_SCHEMA.properties.design.properties.placeCues,
    placeMotif: api.DESIGN_PLAN_SCHEMA.properties.design.properties.placeMotif
  },
  required: ['placeCity', 'placeCues', 'placeMotif']
};

(async function main() {
  const { getFirebase } = require(path.join(lib, 'firebase.js'));
  const fb = getFirebase();
  if (fb.error) throw new Error('Firebase: ' + fb.error);
  const ref = fb.db.collection('events').doc(ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No event ' + ID);
  const ev = snap.data();
  const plan = ev.designPlan;
  const sections = Array.isArray(ev.generatedSections) ? ev.generatedSections : [];
  if (!plan || !plan.design || !sections.length) throw new Error(ID + ' is not an AI-designed site with generated sections.');
  const sourcesSnap = await ref.collection('sources').get();
  const prevDocSnap = sourcesSnap.docs.filter(function (d) { return d.data().type === 'previousEdition'; })[0];
  if (!prevDocSnap) { console.log(ID + ': no previous-edition link — nothing to repair (such a site is designed as before).'); process.exit(0); }
  const prev = prevDocSnap.data();
  const briefSnap = await ref.collection('briefs').orderBy('createdAt', 'desc').limit(1).get();
  const brief = briefSnap.empty ? null : briefSnap.docs[0].data().extracted;
  const calls = { text: 0, image: 0 };

  /* 1. the edition's look and banner, read again from its own page */
  console.log('previous edition: ' + prev.url);
  const page = await safeFetch(prev.url, { timeoutMs: 20000, maxBytes: 6 * 1024 * 1024, headers: { 'User-Agent': BROWSER_UA } });
  if (page.status !== 200) throw new Error('the previous edition answered HTTP ' + page.status);
  const html = page.body.toString('utf8');
  const css = await api.fetchSourceCss(prev.url, html);
  const read = await api.readEditionLook(prev.url, html, css, prev.logoCandidates || []);
  const look = read.look;
  console.log('  its look: ' + JSON.stringify({ brand: look.brand, accent: look.accent, background: look.background, text: look.text, muted: look.muted, headings: look.headingFontRaw, text_font: look.bodyFontRaw, logo: look.logoColours }));
  let keyVisual = null;
  if (read.keyVisual) {
    console.log('  its banner artwork: ' + read.keyVisual.url + ' (' + read.keyVisual.width + 'x' + read.keyVisual.height + ')');
    if (DRY) { calls.text++; keyVisual = api.keptKeyVisual(read.keyVisual, { description: '(read by the text model in the real run)' }); }
    else {
      calls.text++;
      const r = await llm.callJson('The picture attached is the artwork the top banner of an event microsite (' + prev.url + ') is built on. Describe it.',
        api.ingestSchemaFor(true).properties.keyVisual, { route: 'ingest-source', eventId: ID, images: [read.picture], onUsage: api.aiUsageRecorder(fb, ID, 'ingest-source') });
      if (r.error) console.warn('  the banner could not be read (' + r.error + '): the hero is made without it');
      else keyVisual = api.keptKeyVisual(read.keyVisual, r.parsed);
      if (keyVisual) console.log('  in words: ' + keyVisual.description + (keyVisual.place ? ' | place: ' + keyVisual.place : ''));
    }
  } else console.log('  no banner artwork found on it');

  /* 2. the city: this edition's venue, else the previous edition's */
  const venue = el.venueForDesign({ venue: ev.venue, city: ev.city, location: ev.location }, brief, prev.previous);
  let place = null;
  if (venue.venue) {
    console.log('venue (' + venue.source + ' edition): ' + venue.venue + (venue.city ? ' -> ' + venue.city : ''));
    calls.text++;
    if (!DRY) {
      const r = await llm.callJson('An event takes place at "' + venue.venue + '". For its website\'s pictures and graphics, fill in the city of that venue, the visual cues of that city a local would recognise at once (architecture, landscape, light, crafts, textiles — tasteful, never a postcard), and one graphic motif drawn from its own crafts or architecture that a designer can draw in simple lines. THE PLACE is: "' + venue.venue + '".',
        PLACE_SCHEMA, { route: 'plan-structure', eventId: ID, onUsage: api.aiUsageRecorder(fb, ID, 'plan-structure') });
      if (r.error) throw new Error('the city\'s cues could not be written: ' + r.error);
      const p = r.parsed || {};
      const clip = function (v, max) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max); };
      place = { venue: venue.venue, source: venue.source, city: clip(p.placeCity, 60) || venue.city, cues: clip(p.placeCues, 400), motif: clip(p.placeMotif, 200) };
      console.log('  cues: ' + place.cues + '\n  motif: ' + place.motif);
    } else place = { venue: venue.venue, source: venue.source, city: venue.city, cues: '(written by the text model in the real run)', motif: '' };
  } else console.log('no venue named on either edition: no city to show');

  /* 3. palette and type, inspired by the edition */
  const old = plan.design;
  const ownerWords = String(plan.ownerNotes || '') + ' ' + String((plan.owner && plan.owner.lookText) || '');
  const themeMode = plan.themeMode || 'auto';
  const change = el.ownerSetsLook(ownerWords) ? {} : el.inspiredDesign(look, old, themeMode);
  if (el.ownerSetsLook(ownerWords)) console.log('the owner\'s own words speak of colour or type: the palette is left as it is');
  const merged = Object.assign({}, old, change);
  const colours = gd.palette(merged, themeMode);
  const design = Object.assign({}, merged, { mode: colours.mode, backgroundColor: colours.backgroundColor, surfaceColor: colours.surfaceColor, textColor: colours.textColor, mutedColor: colours.mutedColor });
  if (place) design.place = place; else delete design.place;
  if (keyVisual && keyVisual.description) design.inspiredBy = keyVisual.description;
  console.log('design:');
  ['mode', 'themeColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor', 'mutedColor', 'headingFont', 'bodyFont'].forEach(function (k) {
    if (old[k] !== design[k]) console.log('  ' + k + ': ' + old[k] + ' -> ' + design[k]);
  });
  let recoloured = 0;
  const newSections = sections.map(function (s) {
    const html2 = el.recolour(s.html, old, design), css2 = el.recolour(s.css, old, design);
    if (html2 !== s.html || css2 !== s.css) recoloured++;
    return Object.assign({}, s, { html: html2, css: css2 });
  });
  console.log('sections whose literal colours move with the palette: ' + recoloured + ' of ' + sections.length);

  /* 4. pictures */
  const pictured = plan.sections.filter(function (s) {
    if (!s.image || !s.imageUrl) return false;
    const gen = newSections.filter(function (x) { return x.id === s.id; })[0];
    return gen && (String(gen.html) + String(gen.css)).indexOf(s.imageUrl) !== -1;
  });
  let want = IMAGES === 'none' ? [] : IMAGES === '' || IMAGES === 'all' ? ['hero'].concat(pictured.map(function (s) { return s.id; })) : IMAGES.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  want = want.filter(function (id) { return id === 'hero' || pictured.some(function (s) { return s.id === id; }); });
  console.log('pictures to make again (' + want.length + ' paid image calls): ' + (want.join(', ') || 'none'));
  calls.image = want.length;
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const about = [ev.name, (brief && brief.theme) || '', [ev.venue, ev.city].filter(Boolean).join(', ')].map(function (v) { return String(v || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(' — ').slice(0, 400);
  const level = plan.owner && plan.owner.level ? plan.owner.level : '';
  const swaps = {};
  const newPlanSections = plan.sections.map(function (s) { return Object.assign({}, s); });
  if (!DRY) {
    const jobs = want.map(function (id) {
      if (id === 'hero') {
        const prompt = gd.imagePrompt(design.heroImage, design, { hero: true, about: about, level: level });
        return callGeminiImage(prompt, { route: 'plan-structure', eventId: ID }).then(function (r) {
          const rec = api.aiUsageRecorder(fb, ID, 'pictures'); if (rec) rec(r.usage);
          if (r.error) { console.warn('  hero: not made (' + r.error + '), the old one stays'); return; }
          const ext = /jpe?g/i.test(r.mimeType) ? 'jpg' : /webp/i.test(r.mimeType) ? 'webp' : 'png';
          const storagePath = 'events/' + ID + '/generated/' + stamp + '-hero.' + ext;
          const file = fb.bucket.file(storagePath);
          return file.save(Buffer.from(r.base64, 'base64'), { metadata: { contentType: r.mimeType } }).then(function () { return file.makePublic(); }).then(function () {
            const url = 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath;
            if (old.heroImageUrl) swaps[old.heroImageUrl] = url;
            design.heroImageUrl = url; design.heroImageStoragePath = storagePath; design.heroImageError = null;
            console.log('  hero: ' + url);
          });
        });
      }
      const s = newPlanSections.filter(function (x) { return x.id === id; })[0];
      const context = 'It illustrates the section of the event\'s website that is about this (for your understanding only — none of these words may be written in the picture): ' + s.purpose;
      return api.buildSectionImage(fb, ID, s.id, s.image, design, stamp, context, about, level).then(function (img) {
        if (!img) { console.warn('  ' + id + ': not made, the old one stays'); return; }
        swaps[s.imageUrl] = img.url; s.imageUrl = img.url;
        console.log('  ' + id + ': ' + img.url);
      });
    });
    await Promise.all(jobs);
    newSections.forEach(function (s) {
      Object.keys(swaps).forEach(function (from) { s.html = String(s.html).split(from).join(swaps[from]); s.css = String(s.css).split(from).join(swaps[from]); });
    });
  }

  const newPlan = Object.assign({}, plan, { design: design, sections: newPlanSections });
  if (THEME === 'original') newPlan.themeId = 'original';
  console.log('theme switcher: ' + (THEME === 'original' ? (plan.themeId || 'original') + ' -> original ("As designed")' : 'kept (' + (plan.themeId || 'original') + ')'));
  console.log('model calls ' + (DRY ? 'the real run would make' : 'made') + ': ' + calls.text + ' text (cheap), ' + calls.image + ' image (paid)');
  if (DRY) { console.log('DRY RUN: nothing written.'); process.exit(0); }

  const now = new Date().toISOString();
  await prevDocSnap.ref.set({ look: look, keyVisual: keyVisual || null }, { merge: true });
  await ref.set({ designPlan: newPlan, generatedSections: newSections, generatedAt: now }, { merge: true });
  console.log('written: events/' + ID + ' designPlan + generatedSections, and its previous-edition source (look, keyVisual). Press Preview in the editor to rebuild the draft.');
  process.exit(0);
})().catch(function (err) { console.error('FAILED: ' + (err && err.stack || err)); process.exit(1); });
