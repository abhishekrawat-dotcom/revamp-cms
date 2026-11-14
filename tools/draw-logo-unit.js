/* Draw the logo unit of an AI-designed site whose hero still sets the event's name in type, as the product draws one
   for a new event (functions/lib/api-generate.js drawnLogoUnit), and put it in the banner. Written for the National
   Data Center Symposium, a dummy event the owner asked on 14 Nov 2026 to give a logo: nobody uploaded one for it and
   no previous edition's page named one (tools/repair-logo-unit.js --dry: "no previous edition's page named a logo.
   Nothing to do"), so its banner opens with its name set in type.

   The owner's rules: the hero's logo unit is a transparent picture — the previous edition's, only its year changed,
   where there is one (tools/repair-logo-unit.js); where there is none, one newly made: for an AI-designed site the
   product's own drawn unit — the event's name lock-up with the official ET logo file — never lettering drawn by a
   model, never boxed or put on a plate. The ET logo's red square never changes: the unit carries the official file
   for its ground (templates/_shared/img/et-business-verticals-on-light|dark.svg) as it is (ET_LOGO_COLOUR_RULE).

   For one event:
     1. the unit is drawn exactly as drawnLogoUnit draws it — the design's own split of the name (logoUnit, else
        logoUnitParts), its logoUnitStyle, its tone (mode), themeColor and heading font (fetched from Google Fonts and
        embedded), the official ET logo for that ground; a light site's unit gets its copy for a dark ground drawn the
        same way (white lettering, the ET logo made for a dark ground). Both are stored where drawnLogoUnit stores
        them: events/<id>/generated/<stamp>-logo-unit.svg and …-logo-unit-on-dark.svg. No model call.
     2. it becomes the design's logo unit — designPlan.design.logoUnit* (source 'generated') and logoUnitDark* — and
        the generated hero's, as plan-structure writes a drawn unit, through lib/api.js saveOwnerUnit (the write
        tools/repair-logo-unit.js makes);
     3. the saved site's hero shows it: the lock-up set in type there — its [data-rv-logo-unit] block, nothing else on
        the page — becomes the unit's picture, as the generated hero shows one (gen-design.js logoUnitImageHtml: the
        same classes, the unit's width and height, alt = the event's name, the copy for a dark ground beside it on a
        light hero). The page's own headings are left as they are: its h1 stays, and a page whose name is then only in
        its logo picture gets a visually hidden h1 with the event's name when it is published (site-a11y.js, UX-154).
        Kept as a new saved version with its change record, on the staging address (lib/api.js stageContent, as
        tools/refresh-dummy-dates.js does);
     4. --publish: that version goes live (lib/api.js publishVersion), with a line in the event's history saying it
        was put live on the owner's instruction — only when the event is live and its saved version is the live one.

   Refused, and left as they are (the dry run says which and why): an event that is not live; one that is not
   AI-designed (its template places the logo); one with an uploaded logo (tools/repair-owner-logo.js); one whose hero
   unit is already the owner's or the previous edition's; one where a previous edition's page names a logo
   (tools/repair-logo-unit.js takes it, its year changed); a saved hero with no logo unit block, or showing a picture
   of its own (never replaced here), or whose ground the unit is not drawn for; a saved site holding work newer than
   the live version (it would go live with it); a request waiting for approval. --publish also refuses an event that
   is not live or has no saved site. A second run finds nothing to do.

   node tools/draw-logo-unit.js --event <id> --dry [--publish] [--preview <dir>]
   node tools/draw-logo-unit.js --event <id> [--publish]
     --dry      reads only, writes nothing: the unit is drawn in memory (its font fetched from Google Fonts), and what a
                real run would do is printed — the parts the unit is drawn from and the hero element it would replace;
                with --publish, the checks a publishing run makes. --preview <dir>: the units it would draw are also
                saved there (a local folder), with a page showing them on their grounds.
     --publish  puts the new version live (only when the event is live and its saved version is the live one)
   Env: tools/.env.local (this checkout's, else the main checkout's when run from a worktree), never printed. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const lib = path.join(ROOT, 'functions', 'lib');

const ACTOR = 'platform';
const OWNER_DAY = '14 Nov 2026';
const NOTE = 'the event’s logo unit drawn for it (no logo was uploaded and no previous edition’s page named one) and put in the banner in place of its name set in type';

/* ---------- the page: its hero and the logo unit in it (no writing) ---------- */
function attrOf(tag, name) {
  const m = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(String(tag || ''));
  return m ? (m[2] != null ? m[2] : m[3]) : '';
}
function classes(tag) { return attrOf(tag, 'class').split(/\s+/).filter(Boolean); }
/* the end of the element whose open tag starts at `at` (tags of its name counted) */
function elementEnd(html, at, name) {
  const re = new RegExp('<(/?)' + name + '\\b[^>]*>', 'gi');
  let depth = 0, m;
  re.lastIndex = at;
  while ((m = re.exec(html))) {
    if (!m[1] && /\/>$/.test(m[0])) continue;
    depth += m[1] ? -1 : 1;
    if (!depth) return m.index + m[0].length;
  }
  return -1;
}
/* the hero section of a saved page: [start, end) and its open tag, or null */
function heroOf(page) {
  const m = /<([a-z][a-z0-9]*)\b[^>]*\sdata-rv-section\s*=\s*["']hero["'][^>]*>/i.exec(page) || /<([a-z][a-z0-9]*)\b[^>]*\sid\s*=\s*["']hero["'][^>]*>/i.exec(page);
  if (!m) return null;
  const end = elementEnd(page, m.index, m[1].toLowerCase());
  return end === -1 ? null : { start: m.index, end: end, open: m[0] };
}
/* The logo unit block ([data-rv-logo-unit]) in html — in its hero when `hero` (a saved page), else anywhere (the generated
   hero is that section alone) -> { start, end, html, open, picture: src | '', tone, note, heroTone, h1 } | { why } */
function unitBlockOf(html, inHero) {
  html = String(html || '');
  const hero = inHero ? heroOf(html) : { start: 0, end: html.length, open: (/^\s*(<[a-z][^>]*>)/i.exec(html) || ['', ''])[1] };
  if (!hero) return { why: 'the page has no hero section' };
  const scope = html.slice(hero.start, hero.end);
  const at = scope.search(/<div\b[^>]*\sdata-rv-logo-unit\b[^>]*>/i);
  if (at === -1) return { why: 'its hero has no logo unit block ([data-rv-logo-unit]), so the name set in type cannot be told from the rest of the banner', hero: hero };
  const end = elementEnd(scope, at, 'div');
  if (end === -1) return { why: 'its logo unit block is not closed', hero: hero };
  const block = scope.slice(at, end), open = /^<div\b[^>]*>/i.exec(block)[0];
  const img = /<img\b[^>]*>/gi;
  let pic = '', m;
  while ((m = img.exec(block))) {
    const c = classes(m[0]);
    if (c.indexOf('rv-lu-img') !== -1 && c.indexOf('rv-lu-dark') === -1) { pic = attrOf(m[0], 'src') || '(no address)'; break; }
  }
  const tone = (/\brv-lu-on-(dark|light)\b/.exec(attrOf(open, 'class')) || [])[1] || '';
  const heroTone = (/\bhero-on-(dark|light)\b/.exec(attrOf(hero.open, 'class')) || [])[1] || '';
  return { start: hero.start + at, end: hero.start + end, html: block, open: open, picture: pic, tone: tone, heroTone: heroTone,
    note: attrOf(open, 'data-rv-logo-note'), h1: /<h1\b/i.test(block), hero: hero };
}
function words(html) { return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }

/* What the unit's picture is on a hero: the ground the hero stands on (its own tone, else the unit's, else the site's), and
   which drawing shows there — as saveOwnerUnit and the editor show a unit: on a dark banner a unit drawn for a light one
   shows as its copy for a dark ground; on a light banner the copy goes beside it, for a dark theme. A unit drawn for the
   other ground with no copy would vanish there: refused. -> { mode, url, darkUrl } | { why } */
function shownOn(block, unit, designMode) {
  const ground = block.heroTone || block.tone || (designMode === 'dark' ? 'dark' : 'light');
  const drawnFor = /^(dark|light)$/.test(String(unit.heroMode)) ? unit.heroMode : (designMode === 'dark' ? 'dark' : 'light');
  if (drawnFor === ground) return { mode: ground, url: unit.url, darkUrl: ground === 'light' && unit.darkUrl ? unit.darkUrl : '' };
  if (drawnFor === 'light' && ground === 'dark' && unit.darkUrl) return { mode: 'dark', url: unit.darkUrl, darkUrl: '' };
  return { why: 'the unit is drawn for a ' + drawnFor + ' ground and this banner is ' + ground + ', where it would not show' };
}
/* The saved page with the unit's picture in place of the lock-up set in type: that block replaced, nothing else.
   -> { html, changed, before, after } | { done: true } (it shows this unit already) | { why } */
function withUnit(page, unit, o) {
  const genDesign = require(path.join(lib, 'gen-design.js'));
  const b = unitBlockOf(page, true);
  if (b.why) return { why: 'the saved site: ' + b.why };
  if (b.picture) {
    if (b.picture === unit.url || (unit.darkUrl && b.picture === unit.darkUrl)) return { done: true };
    return { why: 'the saved hero shows a picture of its own (' + b.picture.slice(0, 120) + '): it is never replaced here' };
  }
  const shown = shownOn(b, unit, o.designMode);
  if (shown.why) return { why: 'the saved site: ' + shown.why };
  const after = genDesign.logoUnitImageHtml({ url: shown.url, alt: o.name, width: unit.width, height: unit.height, plate: '', note: '', mode: shown.mode, darkUrl: shown.darkUrl });
  if (!after) return { why: 'the unit\'s address is not one a page can show' };
  const html = page.slice(0, b.start) + after + page.slice(b.end);
  return { html: html, changed: html !== page, before: b.html, after: after, h1: b.h1 };
}

/* ---------- the plan: what one event needs, writing nothing ---------- */
/* -> Promise<{ id, ok, nothing, line, … }> */
function plan(fb, hooks, id, opts) {
  opts = opts || {};
  const generatedSite = require(path.join(lib, 'generated-site.js'));
  const genDesign = require(path.join(lib, 'gen-design.js'));
  const events = fb.db.collection('events');
  const out = { id: id, ok: false, nothing: false, line: '' };
  function refuse(why) { out.line = why + ' — left as it is'; return out; }
  return events.doc(id).get().then(function (snap) {
    const state = hooks.eventStateOf(snap);
    if (state !== 'live') return refuse(state === 'deleted' ? 'the event was deleted' : 'no such event');
    const data = snap.data(), logo = hooks.ownerLogoState(data);
    out.name = String(data.name || id);
    if (!logo.aiDesigned) return refuse('not an AI-designed site: its template places the logo');
    if (logo.logoUrl) return refuse('the owner uploaded a logo: tools/repair-owner-logo.js --event ' + id + ' puts it in');
    const design = data.designPlan.design, source = String(design.logoUnitSource || '');
    if (source === 'owner' || source === 'previous-edition') return refuse('the hero\'s unit is ' + (source === 'owner' ? 'made from the owner\'s logo' : 'the previous edition\'s') + ' already');
    const saved = hooks.siteVersionOf ? hooks.siteVersionOf(data) : ((data.site && +data.site.version) || 0);
    const live = data.published === true ? (+data.publishedVersion || 0) : 0;
    out.saved = saved; out.live = live; out.published = data.published === true;
    out.state = (data.published === true ? (live ? 'live version ' + live : 'live as one page published before sites had versions') : 'not published') +
      ', saved version ' + (saved || 'none') + (data.approval && data.approval.id ? ', a request waiting for approval' : ', no request waiting');
    if (data.approval && data.approval.id) return refuse('a request is waiting for approval (version ' + (+data.approval.toVersion || '?') + ')');
    if (data.published === true && saved && saved !== live) return refuse('its saved site (version ' + saved + ') is not the live one (' + (live ? 'version ' + live : 'published before sites had versions') + '): publishing would put that work live too');
    if (opts.publish && !(data.published === true && live)) return refuse('--publish: the event is not live');
    if (opts.publish && !saved) return refuse('--publish: it has no saved site to publish');
    return Promise.all([
      events.doc(id).collection('sources').get(),
      saved ? hooks.readObject(fb, hooks.sitePath(id, 'page.html')) : Promise.resolve(null),
      (function () {
        const ref = generatedSite.sectionRef(fb, id, data, 'hero');
        if (ref) return ref.get().then(function (h) { return h.exists ? String((h.data() || {}).html || '') : ''; });
        const s = (Array.isArray(data.generatedSections) ? data.generatedSections : []).filter(function (x) { return x && x.id === 'hero'; })[0];
        return Promise.resolve(s ? String(s.html || '') : '');
      })()
    ]).then(function (got) {
      const named = hooks.unitSources(got[0].docs.map(function (d) { return d.data(); }));
      if (named.length) return refuse('a previous edition\'s page names a logo (' + String(named[0].url || '').slice(0, 100) + '): tools/repair-logo-unit.js --event ' + id + ' takes it, its year changed');
      const page = got[1];
      if (saved && page == null) return refuse('its saved site (version ' + saved + ') was not found');
      /* the design's unit: drawn now, or the one drawn before (a second run, or a run that stopped half-way) */
      const has = source === 'generated' && /^https:\/\//i.test(String(design.logoUnitUrl || ''));
      const unit = has ? {
        url: design.logoUnitUrl, storagePath: design.logoUnitStoragePath || '', source: 'generated', from: '', width: +design.logoUnitWidth || 0, height: +design.logoUnitHeight || 0,
        heroMode: design.logoUnitHeroMode || '', plate: '', note: design.logoUnitNote || '',
        darkUrl: hooks.darkCopyOfUnit(design) ? design.logoUnitDarkUrl : '', darkStoragePath: hooks.darkCopyOfUnit(design) ? design.logoUnitDarkStoragePath || '' : ''
      } : null;
      const parts = design.logoUnit || genDesign.logoUnitParts(out.name);
      out.design = design;
      out.parts = parts;
      out.draw = !has;
      out.unit = unit;
      out.tone = design.mode === 'dark' ? 'dark' : 'light';
      out.hasPage = !!page;
      out.heroNow = has ? 'the design\'s drawn unit (' + String(design.logoUnitUrl).split('/').pop() + ')' : 'set in type (the design has no unit' + (source ? ': ' + source : '') + ')';
      /* the generated hero (what the editor opens before a site is first saved) */
      const gen = got[2] ? unitBlockOf(got[2], false) : { why: 'none' };
      out.genHero = gen.why ? (got[2] ? 'has no logo unit block — design only' : 'none — design only') : gen.picture ? (has && (gen.picture === unit.url || gen.picture === unit.darkUrl) ? 'shows the drawn unit already' : 'shows a picture (' + gen.picture.split('/').pop().slice(0, 60) + ') — swapped for the drawn unit only with a new drawing, as repair-logo-unit.js swaps one') : 'its unit block set in type would be swapped';
      out.genInType = !gen.why && !gen.picture;
      /* the saved hero: checked with a stand-in for the unit when none is drawn yet (the real one is put in under the site lock) */
      if (page) {
        const probe = unit || { url: 'https://storage.googleapis.com/dry-run/events/' + id + '/generated/STAMP-logo-unit.svg', darkUrl: out.tone === 'light' ? 'https://storage.googleapis.com/dry-run/events/' + id + '/generated/STAMP-logo-unit-on-dark.svg' : '', width: 0, height: 0, heroMode: '' };
        const w = withUnit(page, probe, { name: out.name, designMode: design.mode });
        if (w.why) return refuse(w.why);
        out.pageDone = !!w.done;
        out.before = w.before || '';
        out.after = w.after || '';
        out.blockH1 = !!w.h1;
        const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(page);
        out.pageH1 = h1 ? words(h1[1]) : '';
        out.page = page;
      }
      if (!out.draw && (!page || out.pageDone) && !out.genInType) { out.nothing = true; out.line = 'nothing to do: the hero already shows its drawn unit'; return out; }
      out.ok = true;
      out.line = 'live: ' + out.state;
      return out;
    });
  });
}

/* ---------- the drawing: in memory for a dry run (no bucket of ours is written) ---------- */
function memoryFb() {
  const files = {};
  return { files: files, bucket: { name: 'dry-run', file: function (p) {
    return { save: function (buf) { files[p] = Buffer.from(buf); return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } };
  } } };
}
function draw(fb, hooks, p, stamp) {
  return Promise.resolve(hooks.drawnLogoUnit(fb, p.id, { design: p.design, eventMeta: { name: p.name }, stamp: stamp }));
}
/* The dry run: the plan, and the unit drawn in memory exactly as a real run would draw it -> Promise<{ p, drawn }>,
   drawn: { unit, svg, darkSvg, font } | null. Nothing of the event's is written. */
function dryRun(fb, hooks, id, opts) {
  return plan(fb, hooks, id, opts).then(function (p) {
    if (!p.ok || !p.draw) return { p: p, drawn: null };
    const mem = memoryFb(), stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    return draw(mem, hooks, p, stamp).then(null, function () { return null; }).then(function (u) {
      if (!u || !mem.files[u.storagePath]) return { p: p, drawn: null };
      const svg = mem.files[u.storagePath].toString('utf8');
      /* the hero's new markup with the drawn unit's own size (its addresses are this dry run's) */
      if (p.page && !p.pageDone) {
        const w = withUnit(p.page, u, { name: p.name, designMode: p.design.mode });
        if (w.after) p.after = w.after;
      }
      return { p: p, drawn: { unit: u, svg: svg, darkSvg: u.darkStoragePath && mem.files[u.darkStoragePath] ? mem.files[u.darkStoragePath].toString('utf8') : '',
        font: /@font-face\{font-family:'rvlu'/.test(svg) ? (p.design.headingFont || 'the heading font') : '' } };
    });
  });
}

/* ---------- the run ---------- */
/* -> Promise<{ id, lines: [..], version, published }> */
function apply(fb, hooks, logActivity, origin, p, opts) {
  opts = opts || {};
  const lines = [], decoded = { email: ACTOR, uid: ACTOR };
  const stamp = opts.stamp || new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  let unit = p.unit, version = 0, published = null;
  return (p.draw ? draw(fb, hooks, p, stamp) : Promise.resolve(unit)).then(function (u) {
    if (!u || !/^https:\/\//i.test(String(u.url || ''))) throw new Error('the unit could not be drawn (the event has no name to draw, or the ET logo file could not be read)');
    unit = u;
    if (p.draw) lines.push('drawn:           ' + String(u.url).split('/').pop() + ' ' + u.width + '×' + u.height + (u.darkUrl ? ', and its copy for a dark ground ' + String(u.darkUrl).split('/').pop() : ''));
    /* the design and the generated hero, as plan-structure writes a drawn unit */
    if (!p.draw && !p.genInType) return null;
    return hooks.saveOwnerUnit(fb, p.id, unit, { heroNote: false, stamp: stamp }).then(function (done) {
      lines.push('design:          designPlan.design.logoUnit* = the drawn unit (source generated)' + (done.darkUrl ? ', logoUnitDark* = its copy for a dark ground' : '') +
        (done.heroUpdated ? '; generated hero swapped' : '; generated hero unchanged'));
      return logActivity(fb, p.id, ACTOR, 'logo-changed', 'logo drawn (tools/draw-logo-unit.js): the event’s name drawn as its logo unit, with the official ET logo — no logo was uploaded and no previous edition’s page named one; put into the site’s design' +
        (done.heroUpdated ? '; banner updated' : ''), { area: 'design' });
    });
  }).then(function () {
    if (!p.hasPage || p.pageDone) return null;
    /* the saved site, under its lock: the version checked is still the one there (and the live one, to publish) */
    return hooks.stageContent(fb, p.id, decoded, { note: NOTE, transform: function (page, data) {
      const now = (data && data.site && +data.site.version) || 0, live = data && data.published === true ? (+data.publishedVersion || 0) : 0;
      if (now !== p.saved) throw new Error('the saved site changed since it was checked (version ' + now + ', was ' + p.saved + ') — left as it is');
      if (data.approval && data.approval.id) throw new Error('a request for approval was sent since it was checked — left as it is');
      if (opts.publish && live !== now) throw new Error('the live version changed since it was checked — left as it is');
      const w = withUnit(page, unit, { name: (data && data.name) || p.name, designMode: (((data || {}).designPlan || {}).design || {}).mode });
      if (w.why) throw new Error(w.why);
      if (w.done) return { html: page, changed: false };
      return { html: w.html, changed: w.changed };
    } }).then(function (st) {
      if (!st || !st.staged) { lines.push('saved site:      nothing to change'); return null; }
      version = st.version;
      lines.push('saved site:      version ' + st.version + ' saved (the banner\'s lock-up set in type replaced by the unit\'s picture), on the staging address');
      if (!opts.publish) return null;
      const req = { headers: { host: String(origin).replace(/^https:\/\//, ''), 'x-forwarded-proto': 'https' }, socket: {} };
      return hooks.publishVersion(fb, req, p.id, st.version, ACTOR, origin).then(function (outp) {
        published = outp;
        return logActivity(fb, p.id, ACTOR, 'published', 'version ' + st.version + ' — ' + NOTE + '; put live on the owner\'s instruction (' + OWNER_DAY + ')', { version: st.version });
      }).then(function () { lines.push('live:            version ' + st.version + ' at ' + published.publishedPath); });
    });
  }).then(function () { return { id: p.id, lines: lines, version: version, published: published, unit: unit }; }, function (err) {
    /* what was done before it failed goes with the error, for the operator */
    if (err && typeof err === 'object') err.lines = lines.slice();
    throw err;
  });
}

/* ---------- printing ---------- */
function short(url) { return String(url || '').replace(/^https:\/\/storage\.googleapis\.com\/[^\/]+\//, '').slice(0, 110) || '—'; }
function clip(s, n) { s = String(s || '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function printPlan(p, drawn, opts) {
  console.log(p.id + ' — ' + (p.name || '(no name)'));
  console.log('  ' + (p.ok || p.nothing ? 'state:           ' + p.state : 'REFUSED:         ' + p.line));
  if (!p.ok && !p.nothing) return;
  console.log('  hero unit now:   ' + p.heroNow);
  console.log('  previous edition: no page named a logo');
  if (p.nothing) { console.log('  ' + p.line); return; }
  const d = p.design, parts = p.parts || {};
  if (p.draw) {
    console.log('  would draw:      ' + [parts.before, parts.keyword, parts.after].filter(Boolean).map(function (w) { return String(w).toUpperCase(); }).join(' / ') +
      ' — before "' + (parts.before || '') + '", keyword "' + (parts.keyword || '') + '", after "' + (parts.after || '') + '"' + (d.logoUnit ? ' (the design\'s own split)' : ' (logoUnitParts of the name)'));
    console.log('                   style ' + (d.logoUnitStyle || 'stacked (none set)') + ', ' + p.tone + ' ground, theme colour ' + (d.themeColor || '(none: #e81d3d)') + ', heading font ' + (d.headingFont || '(none)') +
      ', the official ET logo for a ' + p.tone + ' ground (templates/_shared/img/et-business-verticals-on-' + p.tone + '.svg)' + (p.tone === 'light' ? '; and its copy for a dark ground, drawn the same way' : ''));
    if (drawn) {
      console.log('  drawn in memory: ' + drawn.width + ' × ' + drawn.height + ' SVG' + (drawn.font ? ', its lettering in ' + drawn.font + ' (embedded)' : ', its lettering in a system face (the heading font could not be fetched)') +
        (drawn.darkUrl ? '; dark copy ' + drawn.width + ' × ' + drawn.height : p.tone === 'light' ? '; NO dark copy could be drawn' : ''));
      console.log('  would store:     events/' + p.id + '/generated/<stamp>-logo-unit.svg' + (drawn.darkUrl ? ' and …-logo-unit-on-dark.svg' : '') + ' (public pictures)');
    } else if (opts && opts.dry) console.log('  drawn in memory: FAILED — the unit could not be drawn (no name, or the ET logo file could not be read); a real run would stop here');
    console.log('  design:          designPlan.design.logoUnit* would be the drawn unit (source generated)' + (p.tone === 'light' ? ', logoUnitDark* its copy' : ''));
  } else console.log('  design:          keeps the unit drawn before: ' + short(p.unit.url));
  console.log('  generated hero:  ' + p.genHero);
  if (!p.hasPage) console.log('  saved site:      none — the editor builds the banner from the generated hero');
  else if (p.pageDone) console.log('  saved site:      version ' + p.saved + ' shows the unit already');
  else {
    console.log('  saved site:      version ' + p.saved + ' — this element of its hero would be replaced, nothing else:');
    console.log('                   ' + clip(p.before, 600));
    console.log('                   (its words: "' + clip(words(p.before), 160) + '")');
    console.log('                   by:  ' + clip(p.after, 600));
    console.log('                   headings: ' + (p.blockH1 ? 'the block holds an h1; the published page then gets a visually hidden h1 with the event\'s name (site-a11y.js)'
      : p.pageH1 ? 'the page\'s h1 stays as it is ("' + clip(p.pageH1, 90) + '"); the picture\'s alt is the event\'s name' : 'the page has no h1: the published page gets a visually hidden h1 with the event\'s name (site-a11y.js)'));
    console.log('  version:         ' + (p.saved + 1) + ' would be saved, with its change record, and put on the staging address');
  }
  if (opts.publish) console.log('  publish:         version ' + (p.hasPage && !p.pageDone ? p.saved + 1 : p.saved) + ' would go live (live version ' + p.live + ' = saved version ' + p.saved + '), the history saying: put live on the owner\'s instruction (' + OWNER_DAY + ')');
  else if (p.published && p.live && p.hasPage && !p.pageDone) console.log('  publish:         not asked (--publish puts it live: live version ' + p.live + ' = saved version ' + p.saved + ')');
}
function previewPage(name, tone, design, files) {
  const esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
  return '<!doctype html><meta charset="utf-8"><title>' + esc(name) + ' — logo unit</title>' +
    '<style>body{margin:0;font:14px/1.5 system-ui,sans-serif}div{padding:40px 24px;text-align:center}img{max-width:min(100%,680px);height:auto}p{margin:12px 0 0}</style>' +
    '<div style="background:' + esc(design.backgroundColor || (tone === 'dark' ? '#0d1017' : '#f8f9fa')) + '"><img src="' + esc(files[0]) + '" alt="' + esc(name) + '"><p>the unit, on the site\'s ' + tone + ' ground</p></div>' +
    (files[1] ? '<div style="background:#0d1017;color:#fff"><img src="' + esc(files[1]) + '" alt=""><p>its copy for a dark ground</p></div>' : '');
}

function main() {
  function arg(name) { const i = process.argv.indexOf('--' + name); return i !== -1 && process.argv[i + 1] && !/^--/.test(process.argv[i + 1]) ? process.argv[i + 1] : ''; }
  const ID = arg('event'), DRY = process.argv.includes('--dry'), PUBLISH = process.argv.includes('--publish'), PREVIEW = arg('preview');
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(ID) || (PREVIEW && !DRY)) {
    console.error('Usage: node tools/draw-logo-unit.js --event <event id> [--dry [--preview <dir>]] [--publish]');
    process.exit(2);
  }
  /* the credentials, only once the arguments are right (never printed) */
  (function loadEnv() {
    const envFile = [path.join(ROOT, 'tools', '.env.local'), path.join(ROOT, '..', '..', '..', 'tools', '.env.local')].filter(function (f) { return fs.existsSync(f); })[0];
    if (!envFile) return;
    fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(function (l) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  })();
  const api = require(path.join(lib, 'api.js'));
  const hooks = api._testHooks;
  const { getFirebase } = require(path.join(lib, 'firebase.js'));
  const { logActivity } = require(path.join(lib, 'activity.js'));
  const ORIGIN = require(path.join(lib, 'public-base.js')).HOSTED_ORIGIN;
  const fb = getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  if (DRY) console.log('DRY RUN — nothing written; the unit is drawn in memory only.');
  return (DRY ? dryRun(fb, hooks, ID, { publish: PUBLISH }) : plan(fb, hooks, ID, { publish: PUBLISH }).then(function (p) { return { p: p, drawn: null }; })).then(function (r) {
    const p = r.p, d = r.drawn;
    printPlan(p, d ? { width: d.unit.width, height: d.unit.height, darkUrl: d.darkSvg ? d.unit.darkUrl : '', font: d.font } : null, { publish: PUBLISH, dry: DRY });
    if (d && PREVIEW) {
      fs.mkdirSync(PREVIEW, { recursive: true });
      const names = [ID + '-logo-unit.svg'].concat(d.darkSvg ? [ID + '-logo-unit-on-dark.svg'] : []);
      fs.writeFileSync(path.join(PREVIEW, names[0]), d.svg);
      if (d.darkSvg) fs.writeFileSync(path.join(PREVIEW, names[1]), d.darkSvg);
      fs.writeFileSync(path.join(PREVIEW, ID + '-logo-unit.html'), previewPage(p.name, p.tone, p.design, names));
      console.log('  preview:         ' + path.join(PREVIEW, ID + '-logo-unit.html'));
    }
    return p;
  }).then(function (p) {
    if (DRY) { console.log('\nDRY RUN: nothing written.' + (p.ok ? ' Run again without --dry' + (PUBLISH ? ' (with --publish)' : '') + ' to do it.' : '')); return p.ok || p.nothing ? 0 : 1; }
    if (!p.ok) return p.nothing ? 0 : 1;
    console.log('\nDoing it:');
    return apply(fb, hooks, logActivity, ORIGIN, p, { publish: PUBLISH }).then(function (done) {
      done.lines.forEach(function (l) { console.log('  ' + l); });
      console.log('Done.');
      return 0;
    }, function (err) {
      (err && err.lines || []).forEach(function (l) { console.log('  ' + l); });
      console.log('  FAILED:          ' + (err && err.message || err) + (err && err.lines && err.lines.length ? ' (what is above was done)' : ' (nothing was written)'));
      return 1;
    });
  }).then(function (code) { process.exit(code); });
}

module.exports = { plan: plan, dryRun: dryRun, apply: apply, withUnit: withUnit, unitBlockOf: unitBlockOf, heroOf: heroOf, printPlan: printPlan, NOTE: NOTE };
if (require.main === module) main().catch(function (err) { console.error('FAILED: ' + (err && err.message || err)); process.exit(1); });
