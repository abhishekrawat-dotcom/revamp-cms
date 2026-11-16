/* lib/picture-brief.js — W2 "the Director" (builder B, plan of 16 Nov 2026 §5): one call per message writes a brief
   for each new picture it plans, and the picture model's prompt is built from that brief.

   WHY. Today the picture model is given a 40-word subject inside a 1,400-2,100-character template of three or four
   negative paragraphs ("no people… no text… no logos…"), so the first picture passes its check 4 times in 10, the
   Davos valley comes back as the Matterhorn, and two pictures of one message do not look like one site.

   WHAT. With the `brief` switch on (lib/picture-switches.js; off, nothing here is called and today's promptFor is the
   prompt), writeBriefs() asks Claude Sonnet (route 'picture-brief') once for every new picture of the message: a
   positive scene of 60-120 words ("a deserted promenade before dawn"), the composition for the frame it fills (where
   the words sit over a banner, a thin band across a strip), the palette in colour NAMES, the light, the medium, what
   makes the place itself and the famous look-alikes it is not, and — only where people may be — who is in it. One
   call for all keeps one tone and stops two pictures repeating each other. promptFromBrief() then writes the prompt
   from it, deterministically: the scene and its composition first, the place, the palette in words, "a full-bleed
   photograph, edge to edge, with no border, frame or mat", and site generation's STRICT rules last, so the rules stay
   on top. The site's style card (events/<id>.pictureStyle) is written once, from the Director's first answer or the
   design's own words, so later pictures keep the same look.

     BRIEF_SCHEMA, SCENE_WORDS
     writeBriefs(jobs, ctx)           -> Promise<null | [brief | null per job]>   never rejects; null: no brief (the
                                         switch is off, or the Director could not answer — today's prompt is used)
                                         ctx: { fb, eventId, eventData, ownerWords (the owner's message), ledger
                                                (lib/picture-ledger.js read), styleCard, switches, caller, deadlineAt,
                                                record (usage) }
     promptFromBrief(brief, job, ctx) -> the picture model's prompt; '' when the brief is unusable (today's prompt then)
     writeStyleCard(ctx)              -> Promise<card | null>  events/<id>.pictureStyle, written when the event has none
                                         (or ctx.force): from ctx.card (the Director's), else the design's own words
                                         ctx: { fb, eventId, eventData, card, force }
     briefStep(deps, o)               -> Promise<{ status, body }>  POST /api/chat-edit { step: 'brief', turnId }: the
                                         briefs of every new picture of the turn, written on each job in one
                                         transaction. 200 { briefs: n } (0 when the switch is off or there is nothing
                                         to brief); 404 when the turn has no picture
     colourName(hex)                  -> the plain name of a colour ("crimson"), for a prompt that never says hex */
'use strict';

var llm = require('./llm');
var pictureJob = require('./picture-job');
var pictureSwitches = require('./picture-switches');
var pictureLedger = require('./picture-ledger');
var shape = require('./picture-shape');
/* chat-picture.js requires this file, so it is read when first used, never at load */
function cp() { return require('./chat-picture'); }

var BRIEF_TIMEOUT_MS = 45000;
var SCENE_WORDS = 120;               // at most, of a scene (plan §5: 60-120 words)
var MAX_STYLE = 160;

function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function oneLine(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function on(sw, name, caller) { return pictureSwitches.on(sw, name, caller || 'chat'); }
function sentenceEnd(s) { s = String(s || '').trim(); return s && !/[.!?]$/.test(s) ? s + '.' : s; }
/* the event's name never reaches the picture model (it would be drawn as lettering): said as "the event" wherever the
   Director's words or the event's own description carry it */
function withoutName(text, ev) {
  var name = oneLine(obj(ev) && ev.name, 120);
  if (!name || name.length < 3) return String(text || '');
  return String(text || '').split(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi')).join('the event');
}

/* ---------- colours in words ---------- */
var NAMED = [
  ['white', 255, 255, 255], ['ivory', 250, 246, 232], ['cream', 245, 236, 210], ['silver grey', 192, 192, 192], ['slate grey', 112, 128, 144],
  ['charcoal', 54, 69, 79], ['black', 15, 15, 15], ['crimson', 200, 16, 46], ['red', 220, 30, 30], ['scarlet', 255, 36, 0], ['maroon', 128, 0, 32],
  ['burgundy', 110, 20, 40], ['rose', 230, 120, 150], ['pink', 245, 170, 190], ['magenta', 200, 30, 140], ['plum', 110, 50, 100], ['purple', 110, 40, 160],
  ['violet', 140, 90, 200], ['lavender', 190, 170, 230], ['indigo', 60, 40, 130], ['navy', 20, 30, 90], ['deep blue', 20, 60, 140], ['royal blue', 50, 90, 210],
  ['sky blue', 120, 190, 235], ['teal', 0, 128, 128], ['turquoise', 60, 200, 200], ['emerald', 20, 150, 90], ['green', 40, 160, 60], ['olive', 120, 130, 40],
  ['forest green', 30, 90, 50], ['mint', 170, 230, 200], ['gold', 212, 175, 55], ['amber', 255, 180, 0], ['saffron', 245, 150, 30], ['orange', 245, 120, 20],
  ['coral', 250, 125, 95], ['peach', 250, 200, 160], ['beige', 220, 205, 175], ['sand', 210, 185, 140], ['tan', 190, 150, 100], ['brown', 120, 75, 40],
  ['bronze', 170, 110, 50], ['copper', 185, 100, 50], ['terracotta', 200, 100, 70], ['ochre', 200, 140, 40], ['yellow', 245, 215, 40]
];
function colourName(hex) {
  var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '';
  var h = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1];
  var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16), best = '', gap = Infinity;
  NAMED.forEach(function (c) { var d = Math.pow(r - c[1], 2) * 0.3 + Math.pow(g - c[2], 2) * 0.59 + Math.pow(b - c[3], 2) * 0.11; if (d < gap) { gap = d; best = c[0]; } });
  return best;
}
/* a prompt says colours in words only: a hex code the model would draw as text, or ignore, is named instead */
function noHex(s) { return String(s || '').replace(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi, function (h) { return colourName(h) || ''; }).replace(/\s+/g, ' ').trim(); }
/* at most n words, ending on a whole sentence where it can */
function words(s, n) {
  var w = String(s || '').split(/\s+/).filter(Boolean);
  if (w.length <= n) return w.join(' ');
  var cut = w.slice(0, n).join(' '), end = cut.lastIndexOf('. ');
  return end > cut.length / 2 ? cut.slice(0, end + 1) : cut.replace(/[,;:]?\s*\S*$/, '') + '.';
}

/* ---------- what the Director is told ---------- */
var BRIEF_SCHEMA = { type: 'OBJECT', properties: {
  briefs: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    k: { type: 'INTEGER' },
    scene: { type: 'STRING', description: '60-120 words, positive and concrete: what the picture shows, where, from where, at what hour' },
    composition: { type: 'STRING', description: 'where the subject sits in the frame, what stays calm and clear' },
    palette: { type: 'STRING', description: 'three to five colour names (never codes)' },
    light: { type: 'STRING' },
    medium: { type: 'STRING' },
    placeCues: { type: 'STRING', description: 'what makes the named place itself; "" when no place is named' },
    notThis: { type: 'STRING', description: 'famous look-alikes it must not become; "" when none' },
    peopleLine: { type: 'STRING', description: 'who is in it, only where people may be; "" otherwise' },
    alt: { type: 'STRING' }
  }, required: ['k', 'scene', 'composition', 'palette', 'light', 'medium', 'placeCues', 'notThis', 'peopleLine', 'alt'] } },
  styleCard: { type: 'OBJECT', properties: { palette: { type: 'STRING' }, light: { type: 'STRING' }, medium: { type: 'STRING' }, finish: { type: 'STRING' } }, required: ['palette', 'light', 'medium', 'finish'] }
}, required: ['briefs', 'styleCard'] };

var PLACE_WORDS = { hero: 'the wide banner at the top of the home page', background: 'a section\'s background, behind its words', picture: 'a picture inside a section' };
function frameWords(job) {
  var f = shape.frameFromText(job.frame), ratio = shape.targetRatio({ frame: job.frame, aspect: cp().aspectOf(job) });
  var size = f ? f.w + ' x ' + f.h + ' px on a computer' : '';
  var out = (ratio ? 'about ' + (Math.round(ratio * 100) / 100) + ' times as wide as tall' : '') + (size ? ' (' + size + ')' : '');
  if (job.placement === 'hero') out += '; the event\'s name, date and buttons are set over its middle, so the centre must stay calm and the main forms sit to the sides and low; on a phone it is shown tall, cut from the middle';
  else if (job.placement === 'background') out += '; it sits behind the section\'s words under a soft veil: calm, even detail, no strong focal point in the middle; on a phone it is shown taller';
  if (ratio > 2.4) out += '; the frame is a thin band across the middle of the picture: the subject must sit inside that band, with only sky, snow, water or ground above and below it';
  return out;
}
var PEOPLE_WORDS = {
  none: 'nobody at all — no person, figure or human shape in any form; every place in it empty and quiet',
  distant: 'at most a few tiny figures far in the distance; nobody close up',
  allowed: 'people may be shown: made-up Indian people, with women among them, nobody real, famous or named'
};
function eventFacts(ev) {
  ev = obj(ev) || {};
  var plan = obj(ev.designPlan) || {}, d = obj(plan.design) || {}, brief = obj(ev.brief) || {}, place = obj(d.place) || {};
  var lines = [];
  var theme = withoutName(oneLine(brief.theme || ev.description, 400), ev);
  if (theme) lines.push('What the event is about: ' + noHex(theme) + '.');
  if (ev.portal || ev.portalName) lines.push('Its field: ' + oneLine(ev.portalName || ev.portal, 60) + '.');
  if (brief.audience) lines.push('Its audience: ' + oneLine(brief.audience, 200) + '.');
  var pl = cp().eventPlace(ev, plan);
  if (pl.names.length) lines.push('Where it is: ' + pl.names.join(', ') + (pl.look ? ' — ' + noHex(pl.look) : '') + '.');
  if (d.imageStyle) lines.push('The site\'s picture style: ' + noHex(oneLine(d.imageStyle, 300)) + '.');
  var colours = [colourName(d.themeColor), colourName(d.accentColor)].filter(Boolean);
  if (colours.length) lines.push('The site\'s colours: ' + colours.join(' and ') + (d.mode === 'dark' ? ', on a dark page' : d.mode === 'light' ? ', on a light page' : '') + '.');
  return lines;
}
function sectionIdea(ev, job) {
  var plan = obj(obj(ev) && ev.designPlan) || {};
  if (job.placement === 'hero') return oneLine(obj(plan.design) && plan.design.heroImage, 300);
  var hit = (Array.isArray(plan.sections) ? plan.sections : []).filter(function (s) {
    return s && typeof s.image === 'string' && (s.id === job.sectionId || (s.name && cp().cleanSectionName(s.name) === cp().cleanSectionName(job.sectionName)));
  })[0];
  return hit ? oneLine(hit.image, 300) : '';
}
function directorPrompt(jobs, ctx) {
  var ev = obj(ctx.eventData) || {};
  var card = obj(ctx.styleCard) || obj(ev.pictureStyle);
  var lines = [
    'You are the art director of an event website. Write one brief for each picture below, for an image model that draws exactly what it is told. The pictures belong to one site, so they share one tone and never repeat each other\'s scene.',
    '',
    'THE EVENT (for your understanding; its name, dates and words are never drawn):'
  ].concat(eventFacts(ev));
  if (card) lines.push('The site\'s picture look, to keep: ' + noHex([card.palette, card.light, card.medium, card.finish].map(function (x) { return oneLine(x, MAX_STYLE); }).filter(Boolean).join('; ')) + '.');
  if (ctx.ownerWords) lines.push('', 'The owner\'s message: "' + oneLine(ctx.ownerWords, 600) + '"');
  var led = pictureLedger.promptLines(Array.isArray(ctx.ledger) ? ctx.ledger : []);
  if (led) lines.push('', 'Pictures made earlier in this conversation, and what the owner said of them:', led);
  lines.push('', 'THE PICTURES:');
  jobs.forEach(function (job, i) {
    var rule = cp().peopleRule(job), look = cp().placeLook(job.subject, ev.designPlan), idea = sectionIdea(ev, job);
    lines.push('Picture k=' + (job.k == null ? i : job.k) + ': ' + (PLACE_WORDS[job.placement] || PLACE_WORDS.picture) +
      (job.placement !== 'hero' && job.sectionName ? ', the section "' + cp().cleanSectionName(job.sectionName) + '"' : '') + '.');
    lines.push('  What is asked: ' + oneLine(job.plainSubject || job.subject, 400) + (job.ownerSubject ? ' (the owner named this scene: it leads)' : '') + '.');
    if (job.ownerQuote) lines.push('  The owner\'s words for it: "' + oneLine(job.ownerQuote, 300) + '".');
    if (idea && !job.ownerSubject) lines.push('  The design\'s idea for this place: ' + noHex(idea) + '.');
    if (look) lines.push('  ' + look);
    lines.push('  Its frame: ' + frameWords(job) + '.');
    lines.push('  Kind: ' + (job.kind === 'graphic' ? 'a refined graphic illustration, not a photograph' : job.placement === 'hero' ? 'a premium key visual (a photograph or a 3-D render)' : 'an editorial photograph') + '.');
    lines.push('  Who may be in it: ' + PEOPLE_WORDS[rule] + '.');
    if (job.closeUp) lines.push('  It is a close-up of ONE object or detail of that scene, framed tight, never the whole scene.');
  });
  lines.push('', 'RULES for every brief:',
    '- scene: 60 to 120 words, positive and concrete — say what IS there ("a deserted promenade before dawn, its lamps still lit"), never a list of what is not. A city, place or landmark the ask names is shown as it really is, recognisably that place, never a look-alike; placeCues says what makes it itself (for Davos: a broad high valley, a lake, rounded wooded ridges, chalet roofs), notThis names the famous look-alikes it must not become (for Davos: the Matterhorn\'s pyramid peak).',
    '- No words, letters, numbers, logos, flags, signs, screens with writing or brand colours in any scene; no real, named or famous person. The event\'s name is never in a brief.',
    '- Where nobody may be in it, the scene is empty in a natural way: an early hour before anyone arrives, a place closed for the night.',
    '- peopleLine: only where people may be ("two Indian women and one Indian man in conversation, seen side-on"); "" everywhere else.',
    '- composition: written for the frame (the banner\'s calm centre, a band\'s middle strip, a background\'s even calm); the subject whole inside what the frame shows.',
    '- palette: three to five colour names, in the site\'s colours and look; never a colour code.',
    '- light and medium: one tone for every picture of the site.',
    '- alt: one plain sentence describing the picture for someone who cannot see it.',
    '- styleCard: the site\'s picture look in four short fields (palette, light, medium, finish), to keep for later pictures.',
    'Answer in JSON, one brief per picture, with its k.');
  return lines.join('\n');
}

/* a brief from the Director's answer, cleaned: colour names only, the scene within its words, no people line where
   nobody may be */
function cleanBrief(b, job) {
  b = obj(b);
  if (!b) return null;
  var out = pictureJob.briefOf({
    scene: words(noHex(oneLine(b.scene, 1200)), SCENE_WORDS), composition: noHex(b.composition), palette: noHex(b.palette), light: noHex(b.light),
    medium: noHex(b.medium), placeCues: noHex(b.placeCues), notThis: noHex(b.notThis),
    peopleLine: cp().peopleRule(job) === 'allowed' ? noHex(b.peopleLine) : ''
  });
  if (!out || out.scene.split(/\s+/).length < 8) return null;
  return out;
}
function cleanCard(c) {
  c = obj(c);
  if (!c) return null;
  var out = { palette: noHex(oneLine(c.palette, MAX_STYLE)), light: noHex(oneLine(c.light, MAX_STYLE)), medium: noHex(oneLine(c.medium, MAX_STYLE)), finish: noHex(oneLine(c.finish, MAX_STYLE)) };
  return out.palette || out.light || out.medium ? out : null;
}

function writeBriefs(jobs, ctx) {
  ctx = ctx || {};
  jobs = (Array.isArray(jobs) ? jobs : []).filter(function (j) { return obj(j) && oneLine(j.subject, 10); });
  if (!jobs.length || !on(ctx.switches, 'brief', ctx.caller)) return Promise.resolve(null);
  return Promise.resolve().then(function () {
    return llm.callJson(directorPrompt(jobs, ctx), BRIEF_SCHEMA, {
      route: 'picture-brief', eventId: ctx.eventId, timeoutMs: BRIEF_TIMEOUT_MS, maxOutputTokens: 6000, deadlineAt: ctx.deadlineAt, onUsage: ctx.record
    });
  }).then(function (r) {
    var p = r && obj(r.parsed);
    var list = p && Array.isArray(p.briefs) ? p.briefs : null;
    if (!list) {
      console.error('picture-brief: no brief for ' + ctx.eventId + ' — ' + (r && r.code ? r.code : 'the answer had no briefs') + '; today\'s prompt is used');
      return null;
    }
    var byK = {};
    list.forEach(function (b, i) { b = obj(b); if (b) byK[b.k == null ? i : +b.k] = b; });
    var named = function (b) { b = obj(b); if (!b) return b; var c = {}; Object.keys(b).forEach(function (f) { c[f] = typeof b[f] === 'string' ? withoutName(b[f], ctx.eventData) : b[f]; }); return c; };
    var out = jobs.map(function (job, i) { return cleanBrief(named(byK[job.k == null ? i : job.k] || (list.length === jobs.length ? list[i] : null)), job); });
    out.styleCard = cleanCard(p.styleCard);
    /* the alt text the Director wrote, kept beside the brief for the job that has none */
    out.alts = jobs.map(function (job, i) { var b = byK[job.k == null ? i : job.k]; return b ? oneLine(b.alt, 150) : ''; });
    return out.some(Boolean) ? out : null;
  }, function (err) {
    console.error('picture-brief: no brief for ' + ctx.eventId + ' — ' + (err && err.message) + '; today\'s prompt is used');
    return null;
  });
}

/* ---------- the picture model's prompt, from the brief ---------- */
function promptFromBrief(brief, job, ctx) {
  var b = pictureJob.briefOf(brief);
  if (!b) return '';
  job = obj(job) || {};
  var C = cp(), hero = job.placement === 'hero', graphic = job.kind === 'graphic', rule = C.peopleRule(job);
  var lead = hero
    ? (graphic ? 'Create the wide background artwork for the hero banner of a professional event website: a refined graphic composition, not a photograph.'
      : 'Create the wide picture for the hero banner of a professional event website: a polished, premium key visual — a photograph or a 3-D render, rich in colour, depth and light.')
    : graphic ? 'Create one refined graphic illustration (not a photograph) for a section of a professional event website. It is artwork, not a diagram: nothing in it is labelled.'
      : 'Create one editorial photograph for a section of a professional event website.';
  var lines = [lead, 'Scene: ' + sentenceEnd(noHex(b.scene))];
  if (b.composition) lines.push('Composition: ' + sentenceEnd(noHex(b.composition)));
  if (hero) lines.push('The event\'s name, date and buttons will be set over the middle, so the centre stays calm and softly lit, with the main forms towards the sides and the lower part.');
  else if (job.placement === 'background') lines.push('It sits behind the section\'s text under a veil: calm, even detail, no strong focal point in the middle.');
  var ratio = shape.targetRatio({ frame: job.frame, aspect: C.aspectOf(job) });
  if (ratio > 2.4) lines.push('Only a thin band across the middle of the picture is shown: keep the whole subject inside that middle band, with only open sky, snow, water or ground above and below it.');
  if (b.placeCues) lines.push('The place is recognisably itself, true to its real shape and setting: ' + sentenceEnd(noHex(b.placeCues)));
  if (b.notThis) lines.push('It is not ' + sentenceEnd(noHex(b.notThis).replace(/^not\s+/i, '')));
  if (b.light) lines.push('Light: ' + sentenceEnd(noHex(b.light)));
  if (b.medium) lines.push('Medium: ' + sentenceEnd(noHex(b.medium)));
  if (b.palette) lines.push('Palette: ' + sentenceEnd(noHex(b.palette)));
  if (rule === 'allowed' && b.peopleLine) lines.push('People: ' + noHex(b.peopleLine).replace(/[.\s]+$/, '') + ' — made-up Indian people, with women among them, who look like nobody real or famous.');
  else if (rule !== 'allowed' && !graphic) lines.push(job.kind === 'place' && !job.closeUp ? C.EMPTY_PLACE : C.EMPTY_SCENE);
  if (job.closeUp === true && !hero) lines.push(C.CLOSE_UP);
  lines.push(graphic ? 'The artwork fills the whole canvas, edge to edge, with no border, frame or mat.' : 'A full-bleed photograph, edge to edge, with no border, frame, mat or picture inside a picture.');
  lines.push('Every picture on this site shares this one style, so that they read as a set.');
  lines.push(hero ? 'The picture itself carries no words at all — never the event\'s name, its date or its place: the site sets the name and the buttons over it.' : 'The picture carries no words, letters or numbers.');
  lines.push(C.ASPECT_WORDS[C.aspectOf(job)] || 'Landscape, 4:3.');
  /* site generation's STRICT rules, and who may be in it, last: the rules stay on top */
  lines.push(C.strictRules(job));
  return lines.join(' ');
}

/* ---------- the site's style card ---------- */
function writeStyleCard(ctx) {
  ctx = ctx || {};
  var fb = ctx.fb, eventId = String(ctx.eventId || '');
  if (!fb || !fb.db || !eventId) return Promise.resolve(null);
  var ev = obj(ctx.eventData) || {};
  if (obj(ev.pictureStyle) && !ctx.force) return Promise.resolve(ev.pictureStyle);
  var card = cleanCard(ctx.card);
  if (!card) {
    /* seeded from the design's own words (an AI-designed site): its picture style and colours */
    var d = obj(obj(ev.designPlan) && ev.designPlan.design) || {};
    var colours = [colourName(d.themeColor), colourName(d.accentColor)].filter(Boolean);
    if (!d.imageStyle && !colours.length) return Promise.resolve(null);
    card = { palette: colours.length ? colours.join(' and ') + ' accents' : '', light: d.mode === 'dark' ? 'dark and moody, glowing accents' : 'bright and airy, natural light',
      medium: noHex(oneLine(d.imageStyle, MAX_STYLE)) || 'high-end editorial photography', finish: 'one style across the site' };
  }
  card = Object.assign({}, card, { at: new Date().toISOString() });
  return Promise.resolve().then(function () {
    return fb.db.collection('events').doc(eventId).update({ pictureStyle: card });
  }).then(function () { return card; }, function (err) {
    console.error('picture-brief: the style card of ' + eventId + ' was not kept — ' + (err && err.message));
    return null;
  });
}

/* ---------- POST /api/chat-edit { step: 'brief', turnId } ---------- */
function briefStep(deps, o) {
  deps = deps || {};
  o = o || {};
  var sw = o.switches || pictureSwitches.OFF;
  if (!on(sw, 'brief', 'chat') || !o.fb || !o.turnRef) return Promise.resolve({ status: 200, body: { briefs: 0 } });
  var fb = o.fb, eventId = String(o.eventId || ''), turnRef = o.turnRef, ev = obj(o.eventData) || {};
  function waiting(j) { return obj(j) && (j.mode == null || j.mode === 'new') && (j.state || 'asked') === 'asked' && !pictureJob.briefOf(j.brief) && oneLine(j.subject, 10) && j.sectionId; }
  var question = '';
  return Promise.resolve().then(function () { return turnRef.get(); }).then(function (snap) {
    var turn = snap && snap.exists ? snap.data() : null;
    var jobs = pictureJob.jobsOf(turn);
    if (!jobs.length) return { status: 404, body: { error: cp().sentence('chat-picture-none') || 'There is no picture to make for that message.', code: 'chat-picture-none', retryable: false } };
    question = typeof turn.question === 'string' ? turn.question : '';
    var todo = [];
    jobs.forEach(function (j, k) { if (waiting(j)) todo.push(Object.assign({}, j, { k: k })); });
    if (!todo.length) return { status: 200, body: { briefs: 0 } };
    return pictureLedger.read(fb, eventId, o.uid).then(function (ledger) {
      return writeBriefs(todo, { fb: fb, eventId: eventId, eventData: ev, ownerWords: question, ledger: ledger, styleCard: ev.pictureStyle || null,
        switches: sw, caller: 'chat', deadlineAt: Date.now() + BRIEF_TIMEOUT_MS + 5000, record: deps.record });
    }).then(function (briefs) {
      if (!briefs) return { status: 200, body: { briefs: 0 } };
      var byK = {};
      todo.forEach(function (j, i) { if (briefs[i]) byK[j.k] = briefs[i]; });
      return fb.db.runTransaction(function (tx) {
        return tx.get(turnRef).then(function (s2) {
          var cur = s2 && s2.exists ? s2.data() : null, list = pictureJob.jobsOf(cur).slice(), n = 0, at = new Date().toISOString();
          list = list.map(function (j, k) {
            if (!byK[k] || !waiting(j)) return j;
            n++;
            return Object.assign({}, j, { brief: byK[k], stage: 'brief' });
          });
          if (!n) return 0;
          /* every job in one write: a turn of several keeps them all, job 0 mirrored to newPicture; a turn of one its newPicture */
          tx.update(turnRef, pictureJob.hasJobs(cur) ? { pictureJobs: list, newPicture: list[0], updatedAt: at } : { newPicture: list[0], updatedAt: at });
          return n;
        });
      }).then(function (n) {
        if (n && briefs.styleCard && !obj(ev.pictureStyle)) return writeStyleCard({ fb: fb, eventId: eventId, eventData: ev, card: briefs.styleCard }).then(function () { return n; });
        return n;
      }).then(function (n) { return { status: 200, body: { briefs: n } }; });
    });
  }).catch(function (err) {
    /* nothing lost: each picture is then made from today's prompt */
    console.error('picture-brief: the briefs of ' + eventId + ' were not written — ' + (err && err.message));
    return { status: 200, body: { briefs: 0 } };
  });
}

module.exports = {
  BRIEF_SCHEMA: BRIEF_SCHEMA, SCENE_WORDS: SCENE_WORDS,
  writeBriefs: writeBriefs, promptFromBrief: promptFromBrief, writeStyleCard: writeStyleCard, briefStep: briefStep,
  colourName: colourName, directorPrompt: directorPrompt, cleanBrief: cleanBrief
};
