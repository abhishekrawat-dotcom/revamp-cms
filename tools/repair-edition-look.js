/* Repair an AI-designed site made before the previous edition's look and the venue's city were read
   (functions/lib/edition-look.js). For ONE event, it does what plan-structure now does, without designing
   the site again:

     1. reads the event's previous-edition link again (the previousEdition source's url): the edition's own
        palette and type (its own styles, its lock-up's colours) and its banner artwork, described in words
        by the text model (1 cheap call, with the picture attached) -> stored on that source as look, keyVisual
     2. the words of the design: the city (this edition's venue, else the previous edition's) with its cues
        and one motif, and the design's mood / picture style / layout notes with what they say of colour and
        type brought in line with the new palette and fonts (1 cheap call) -> designPlan.design
     3. the palette and type: the design's own colours and fonts, moved back into the edition's family where
        they left it — INSPIRED BY the edition, never its own values (edition-look.js inspiredDesign) — and the
        sections' literal colours moved with them (recolour) -> designPlan.design, generatedSections
     4. pictures (paid image calls, one each): the hero, inspired by the edition's banner artwork in words and
        set in the city, and the section pictures named in --images, set in the city. Each goes to a NEW
        storage path; the old ones are left where they are (a page saved earlier still shows them).

   Nothing else is touched: section copy, layout, the logo unit, the Previous Edition sections' records.
   With no previous-edition link the event is left as it is (such a site is designed exactly as before).

   WHERE IT SHOWS. The site's stored design (what a fresh opening of the editor builds the page from) is what
   this writes. An editor that already holds a copy of the site in its browser keeps that copy — the page the
   owner edits, previews and publishes — so without --new-draft the owner sees none of this until the site
   is opened afresh. Two ways to bring it there:
     --new-draft      as a regeneration does: the editor takes the stored version on its next opening, and its
                      Preview then rebuilds the preview draft from it. Edits the owner made in the editor since
                      the last generation live only in that browser copy and are replaced, so this refuses when
                      the owner's saved preview drafts show any (generated text changed or removed), unless
                      --replace-edits is given as well (only with the owner's agreement).
     Theme panel      without --new-draft, on a site whose owner has switched to another theme (its sections'
                      fixed colours were then turned into the theme's variables), the owner chooses "As designed"
                      in the editor's Theme panel (or opens it with &theme=original): the new palette and fonts go
                      onto their copy, edits kept. The new pictures do not (their copy names the old ones). On a
                      site never switched, this way leaves the sections' fixed colours old: use --new-draft.

   node tools/repair-edition-look.js --event <id> [--dry] [--images hero,overview,...|all|none]
                                     [--theme original|keep] [--new-draft [--replace-edits]]
     --dry           reads everything, makes NO model call, writes nothing; prints what would change and how
                     many paid calls the real run would make
     --images        which pictures to make again (default: hero and every section whose picture is in its
                     markup); 'none' for none
     --theme         'original' (with --new-draft only) sets the site's theme back to "As designed" (the palette
                     this repairs); 'keep' (default) leaves the owner's choice in the theme switcher as it is —
                     what the Theme-panel way needs: there "As designed" applies the new palette to the owner's copy
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
const api = require(path.join(lib, 'api.js'))._testHooks;
const el = require(path.join(lib, 'edition-look.js'));
const gd = require(path.join(lib, 'gen-design.js'));
const llm = require(path.join(lib, 'llm.js'));
const { callGeminiImage } = require(path.join(lib, 'gemini.js'));
const { safeFetch } = require(path.join(lib, 'safe-fetch.js'));

function arg(name, fallback) { const i = process.argv.indexOf('--' + name); return i !== -1 && process.argv[i + 1] && !/^--/.test(process.argv[i + 1]) ? process.argv[i + 1] : fallback; }
const ID = arg('event', '');
const DRY = process.argv.includes('--dry');
const IMAGES = arg('images', '');
const THEME = arg('theme', 'keep');
const NEW_DRAFT = process.argv.includes('--new-draft');
const REPLACE_EDITS = process.argv.includes('--replace-edits');
if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(ID) || ['original', 'keep'].indexOf(THEME) === -1 || (REPLACE_EDITS && !NEW_DRAFT)) {
  console.error('Usage: --event <event id> [--dry] [--images ...|all|none] [--theme original|keep] [--new-draft [--replace-edits]]');
  process.exit(2);
}
/* The editor marks the theme the site is set to as the one in use; on a copy kept in the owner's browser, that
   is what the switcher says. Set to "As designed" here, the owner's copy would show "As designed" as already
   chosen — and keep the old palette, with no way to apply the new one short of choosing another theme and
   back. Without --new-draft the switcher is left on the owner's choice, and the owner applies the new palette
   with "As designed" (or by opening the editor with &theme=original). */
if (THEME === 'original' && !NEW_DRAFT) {
  console.error('--theme original only goes with --new-draft. Without it, leave the theme as it is and have the owner choose "As designed" in the editor\'s Theme panel (or open custom_editor.html?...&theme=original): that applies the new palette and fonts to their copy and keeps their edits.');
  process.exit(2);
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
const PLAN_DESIGN = api.DESIGN_PLAN_SCHEMA.properties.design.properties;
const WORDS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    placeCity: PLAN_DESIGN.placeCity, placeCues: PLAN_DESIGN.placeCues, placeMotif: PLAN_DESIGN.placeMotif,
    mood: { type: 'STRING', description: 'The design\'s mood, as given, with only what it says of colours and fonts brought in line with the NEW palette and fonts.' },
    imageStyle: { type: 'STRING', description: 'The picture style, as given, with only what it says of colours brought in line with the NEW palette.' },
    layout: { type: 'STRING', description: 'The layout notes, as given, with only what they say of colours (the ground, bands, buttons) and fonts brought in line with the NEW palette and fonts.' }
  },
  required: ['placeCity', 'placeCues', 'placeMotif', 'mood', 'imageStyle', 'layout']
};
function clip(v, max) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max); }
/* the visible text of a page or a section, as sentences long enough to be the owner's or the model's own */
function sentences(html) {
  return String(html || '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&#8217;/g, '\'').replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(function (s) { return s.length > 25; });
}

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

  /* 0. --new-draft replaces the editor's copy: never over edits the owner made, unless they agreed */
  if (NEW_DRAFT) {
    const [files] = await fb.bucket.getFiles({ prefix: 'events/' + ID + '/site/drafts/' });
    const generated = [].concat.apply([], sections.map(function (s) { return sentences(s.html); }));
    let edited = 0;
    for (const f of files.filter(function (x) { return /\.html$/.test(x.name); })) {
      const [buf] = await f.download();
      const page = sentences(buf.toString('utf8')).join(' ');
      const missing = generated.filter(function (s) { return page.indexOf(s) === -1; });
      console.log('owner draft ' + f.name.split('/').pop() + ': ' + (missing.length ? missing.length + ' generated sentence(s) changed or removed, e.g. "' + missing[0].slice(0, 80) + '"' : 'no text edits found'));
      edited += missing.length;
    }
    if (!files.length) console.log('no saved preview drafts: no edits to check');
    if (edited && !REPLACE_EDITS) throw new Error('the owner has edited the site in the editor; --new-draft would replace those edits. Run without --new-draft (the owner applies the palette with Theme -> "As designed"), or add --replace-edits with the owner\'s agreement.');
  }

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
    calls.text++;
    if (DRY) keyVisual = api.keptKeyVisual(read.keyVisual, { description: '(read by the text model in the real run)' });
    else {
      const r = await llm.callJson('The picture attached is the artwork the top banner of an event microsite (' + prev.url + ') is built on. Describe it.',
        api.ingestSchemaFor(true).properties.keyVisual, { route: 'ingest-source', eventId: ID, images: [read.picture], onUsage: api.aiUsageRecorder(fb, ID, 'ingest-source') });
      if (r.error) console.warn('  the banner could not be read (' + r.error + '): the hero is made without it');
      else keyVisual = api.keptKeyVisual(read.keyVisual, r.parsed);
      if (keyVisual) console.log('  in words: ' + keyVisual.description + (keyVisual.place ? ' | place: ' + keyVisual.place : ''));
    }
  } else console.log('  no banner artwork found on it');

  /* 2. palette and type, inspired by the edition */
  const old = plan.design;
  const ownerWords = String(plan.ownerNotes || '') + ' ' + String((plan.owner && plan.owner.lookText) || '');
  const themeMode = plan.themeMode || 'auto';
  const ownerSays = el.ownerSetsLook(ownerWords);
  const change = ownerSays ? {} : el.inspiredDesign(look, old, themeMode);
  if (ownerSays) console.log('the owner\'s own words speak of colour or type: the palette is left as it is');
  const merged = Object.assign({}, old, change);
  const colours = gd.palette(merged, themeMode);
  const design = Object.assign({}, merged, { mode: colours.mode, backgroundColor: colours.backgroundColor, surfaceColor: colours.surfaceColor, textColor: colours.textColor, mutedColor: colours.mutedColor });
  if (keyVisual && keyVisual.description) design.inspiredBy = keyVisual.description;

  /* 3. the words: the city (this edition's venue, else the previous edition's), and mood / picture style /
     layout notes that no longer name the old colours and fonts */
  const venue = el.venueForDesign({ venue: ev.venue, city: ev.city, location: ev.location }, brief, prev.previous);
  if (venue.venue) console.log('venue (' + venue.source + ' edition): ' + venue.venue + (venue.city ? ' -> ' + venue.city : ''));
  else console.log('no venue named on either edition: no city to show');
  const lookChanged = ['themeColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor', 'mutedColor', 'headingFont', 'bodyFont', 'mode'].some(function (k) { return old[k] !== design[k]; });
  delete design.place;
  if (venue.venue || lookChanged) {
    calls.text++;
    if (!DRY) {
      const ask = [
        'An AI-designed event website is being given a new palette and fonts. Fill in the fields below.',
        venue.venue ? 'THE PLACE is: "' + venue.venue + '". For its pictures and graphics: the city of that venue, the visual cues of that city a local would recognise at once (architecture, landscape, light, crafts, textiles — tasteful, never a postcard), and one graphic motif drawn from its own crafts or architecture that a designer can draw in simple lines.' : 'No place is given: placeCity, placeCues and placeMotif are empty strings.',
        'The NEW palette: brand ' + design.themeColor + ', second colour ' + design.accentColor + ', a ' + design.mode + ' ground ' + design.backgroundColor + ', cards ' + design.surfaceColor + '. The NEW fonts: headings ' + design.headingFont + ', text ' + design.bodyFont + '.',
        'Rewrite each text below with only what it says of colours and fonts brought in line with the new ones; every other word stays as it is.',
        'mood: ' + clip(old.mood, 1200), 'imageStyle: ' + clip(old.imageStyle, 600), 'layout: ' + clip(old.layout, 1500)
      ].join('\n');
      const r = await llm.callJson(ask, WORDS_SCHEMA, { route: 'plan-structure', eventId: ID, onUsage: api.aiUsageRecorder(fb, ID, 'plan-structure') });
      if (r.error) throw new Error('the design\'s words could not be written: ' + r.error);
      const p = r.parsed || {};
      if (venue.venue) {
        design.place = { venue: venue.venue, source: venue.source, city: clip(p.placeCity, 60) || venue.city, cues: clip(p.placeCues, 400), motif: clip(p.placeMotif, 200) };
        console.log('  city: ' + design.place.city + '\n  cues: ' + design.place.cues + '\n  motif: ' + design.place.motif);
      }
      if (lookChanged) {
        if (clip(p.mood, 1200)) design.mood = clip(p.mood, 1200);
        if (clip(p.imageStyle, 600)) design.imageStyle = clip(p.imageStyle, 600);
        if (clip(p.layout, 1500)) design.layout = clip(p.layout, 1500);
        console.log('  mood: ' + design.mood);
      }
    } else if (venue.venue) design.place = { venue: venue.venue, source: venue.source, city: venue.city, cues: '(written by the text model in the real run)', motif: '' };
  }
  console.log('design:');
  ['mode', 'themeColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor', 'mutedColor', 'headingFont', 'bodyFont'].forEach(function (k) {
    if (old[k] !== design[k]) console.log('  ' + k + ': ' + old[k] + ' -> ' + design[k]);
  });
  let recoloured = 0;
  const newSections = sections.map(function (s) {
    const html2 = el.recolour(s.html, old, design, 'html'), css2 = el.recolour(s.css, old, design, 'css');
    if (html2 !== s.html || css2 !== s.css) recoloured++;
    return Object.assign({}, s, { html: html2, css: css2 });
  });
  console.log('sections whose literal colours move with the palette: ' + recoloured + ' of ' + sections.length);

  /* 4. pictures */
  const pictured = (plan.sections || []).filter(function (s) {
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
  const newPlanSections = (plan.sections || []).map(function (s) { return Object.assign({}, s); });
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
  const onOriginal = !plan.themeId || plan.themeId === 'original';
  console.log('the editor\'s copy in the owner\'s browser: ' + (NEW_DRAFT ? 'replaced by this version on its next opening (--new-draft)'
    : 'kept as it is — the owner takes the palette and fonts with Theme -> "As designed"' + (onOriginal ? ' — NOT ENOUGH HERE: the site has never left "As designed", so the colours its sections write as fixed values were never turned into the theme\'s and stay the old ones on that copy; use --new-draft' : ' (or by opening the editor with &theme=original)') + '; pictures stay the old ones there (see the top of this file)'));
  console.log('model calls ' + (DRY ? 'the real run would make' : 'made') + ': ' + calls.text + ' text (cheap), ' + calls.image + ' image (paid)');
  if (DRY) { console.log('DRY RUN: nothing written.'); process.exit(0); }

  /* the owner may have edited the site while the pictures were made: nothing is written over their edit
     (compared and written in one transaction) */
  const same = function (a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); };
  const now = new Date().toISOString();
  await fb.db.runTransaction(async function (t) {
    const again = (await t.get(ref)).data() || {};
    if (!same(again.generatedSections, ev.generatedSections) || !same(again.designPlan, ev.designPlan)) {
      throw new Error('the site was changed while this ran (an edit in the editor?): nothing written. New pictures made: ' + (Object.values(swaps).join(', ') || 'none') + '. Run it again.');
    }
    t.set(prevDocSnap.ref, { look: look, keyVisual: keyVisual || null }, { merge: true });
    const update = { designPlan: newPlan, generatedSections: newSections };
    if (NEW_DRAFT) { update.generatedAt = now; update.updatedAt = now; }
    t.set(ref, update, { merge: true });
  });
  console.log('written: events/' + ID + ' designPlan + generatedSections, and its previous-edition source (look, keyVisual).');
  await require(path.join(lib, 'activity.js')).logActivity(fb, ID, 'platform', 'repaired',
    'design repair (tools/repair-edition-look.js): the previous edition’s look and the venue’s city applied; new pictures: ' + (Object.keys(swaps).length || 'none') + (NEW_DRAFT ? ' — opened in the editor next' : ''), { area: 'design' });
  if (NEW_DRAFT) {
    const last = await ref.collection('drafts').orderBy('generatedAt', 'desc').limit(1).get();
    const was = last.empty ? {} : last.docs[0].data();
    const row = await ref.collection('drafts').add({
      templateId: was.templateId || ('gen-' + ID), sourceEventId: was.sourceEventId || ID, library: {},
      positioningNotes: was.positioningNotes || '', model: was.model || '', generatedAt: now, skippedLibraries: [],
      note: 'the previous edition\'s look and the venue\'s city (tools/repair-edition-look.js)'
    });
    console.log('drafts row added: ' + row.id + ' — the editor takes this version on its next opening; press Preview there to rebuild the preview draft.');
  }
  process.exit(0);
})().catch(function (err) { console.error('FAILED: ' + (err && err.stack || err)); process.exit(1); });
