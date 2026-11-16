/* lib/picture-critic.js — W2 "the Critic" (builder B, plan of 16 Nov 2026 §5): a look at each picture ETB2B AI makes,
   and the one table that decides what happens next.

   WHY. The owner, 16 Nov 2026: "it is very basic, and always giving wrong/incorrect responses whenever I am trying to
   generate an image". Today's look at a made picture is three yes/no questions to a low-cost model (people, words,
   logos), and anything it finds means a blind remake with a stronger line, then a third with the strictest. It never
   sees a white mat drawn inside the picture (the #53 picture of ET DAVOS 2027: 63/48/58/80 px of white on its four
   sides, "there are white spaces in the side of images" three times), the wrong mountain for Davos, a brief the
   picture ignores, a subject the frame's cut loses, or people who are not Indian or include no women.

   WHAT. With the `critic` switch on (lib/picture-switches.js; else every part of this file behaves as the runner did
   before), review() shows the picture — uncut, then cut to its desktop and phone frames — to Claude Sonnet (route
   'picture-critic'), which answers what is in it with boxes, a border and how deep it is, whether a named place is
   that place, a famous likeness, Indian people with women where people may be, how well it shows the brief (0-5),
   its tone (0-5), the point it is about (the focus the cut follows), whether the subject survives the cut, one
   imperative repair, and one plain sentence for the owner. decide() then picks, in this order: trim a flat border
   with sharp (no AI), one repair (the picture edited, not remade), one remake with what was missing, else keep it
   off the page with the Critic's own reason. A Critic that cannot answer falls back to today's Haiku check, and
   that check's answer is decided as it always was.

     CRITIC_SCHEMA, FIXABLE, REMAKE_ONLY, REPAIR_NEEDS_MS, MAX_REPAIRS, MAX_REMAKES, PHONE_RATIO
     review(pic, job, ctx)  -> Promise<review>   never rejects
                               pic: { bytes, type, width, height, original?: { bytes, type, width, height } (the uncut
                                     picture, which the Critic is shown; its boxes and focus are of it) }
                               job: the stored job (placement, kind, subject, plainSubject, sectionName, frame, aspect,
                                    brief, entities) — Create Event (caller 'create', CREATE-FROM-DECK F7) passes the
                                    same few fields for a picture of its own
                               ctx: { rule, eventId, deadlineAt, record (usage of the look), switches, caller, refs
                                      (loaded references: the first style one is shown for the tone), before ({ bytes,
                                      type }: the picture before an edit or a repair), place (the place the ask names,
                                      in words), styleWords (the site's palette and light, in words) }
                               review: picture-job.reviewOf's shape and more — { verdict, source: 'critic'|'check',
                                       flags, found: { people, text, logos } (booleans, as today's check keeps them;
                                       null when nothing could look), scores: { brief, tone }, why, repair, what:
                                       { people, text, logos, artefacts }, boxes: { … }, border: { kind, top, right,
                                       bottom, left } | null, focus: { x, y } | null, missing: [], placeMatch,
                                       survivesCrop, sameScene, faceChanged }
     decide(review, t)      -> { action: 'keep' } | { action: 'trim', edges } | { action: 'repair', change }
                               | { action: 'remake', line } | { action: 'hold', why: 'tries' | 'time' }
                               t: { calls (paid picture calls so far), made, maxTries, timeLeftMs, retryNeedsMs,
                                    switches, caller, trimmed, repairs, remakes }
     trimBorders(bytes, o)  -> Promise<{ bytes, width, height, trimmed: { top, right, bottom, left } } | null>
                               flat near-white or near-black bands drawn along the picture's edges cut off (null: none,
                               or the bytes cannot be read). A band on one edge only is cut only with o.force (the
                               Critic saw a border): a white sky alone is never taken for a mat.
     framePreviews(pic, job) -> Promise<[{ label, mimeType, data, ratio }]>  the picture cut to its desktop frame and,
                               for a banner or a background, to a phone's tall frame (small JPEGs)
     rank(reviews)          -> [index, …] best first (for "Show 3 options", the `variants` switch: the best one is
                               placed at once, the other two wait in the card)
     remakeLine(review)     -> the line a remake ends with, from what the Critic found and what was missing
     plainWhy(review, rule) -> the Critic's sentence for the owner, made safe to show (never a bare "ET")

   The models are looked up on their modules at the moment of the call (llm.callJson), so the tests can stand in. */
'use strict';

var llm = require('./llm');
var pictureSwitches = require('./picture-switches');
var shape = require('./picture-shape');
/* chat-picture.js requires this file, so it is read when first used, never at load */
function cp() { return require('./chat-picture'); }

/* ---------- limits ---------- */
var REPAIR_NEEDS_MS = 60000;      // one edit of the picture (20-50 s) and its look again, before the deadline
var MAX_REPAIRS = 1;              // plan §5.5: trim, then one repair, then one remake, then held
var MAX_REMAKES = 1;
var LOOK_TIMEOUT_MS = 30000;
var MAIN_SIDE = 1280;             // the picture the Critic is shown, at most this wide or tall (about 1.2k tokens)
var PREVIEW_SIDE = 512;
/* a phone shows a banner and a section's background in a tall frame (object-fit: cover): about 390 x 650 and 390 x 520 */
var PHONE_RATIO = { hero: 0.6, background: 0.75 };
/* what an edit of the picture can fix (boxes say where), and what only a new picture can */
var FIXABLE = ['people', 'text', 'logos', 'artefacts', 'place'];
var REMAKE_ONLY = ['brief', 'crop', 'women', 'likeness', 'face', 'scene'];
var FLAG_ORDER = ['people', 'text', 'logos', 'border', 'artefacts', 'place', 'likeness', 'women', 'face', 'scene', 'brief', 'crop'];

/* ---------- small helpers ---------- */
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function oneLine(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function yes(v) { return v === true || String(v).toLowerCase() === 'true'; }
function unit(v) { v = +v; return v >= 0 && v <= 1 ? Math.round(v * 1000) / 1000 : null; }
function score(v) { v = Math.round(+v); return v >= 0 && v <= 5 ? v : null; }
function pick(v, list, dflt) { return list.indexOf(v) !== -1 ? v : dflt; }
function joinAnd(list) { return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]; }
/* the words a user reads never say a bare "ET" (owner, 11 Nov 2026) */
function noBareEt(s) { return String(s || '').replace(/\bET\b(?!B2B)/g, 'ETB2B'); }
function on(sw, name, caller) { return pictureSwitches.on(sw, name, caller || 'chat'); }

var sharpModule;
function loadSharp() {
  if (sharpModule === undefined) {
    try { sharpModule = require('sharp'); } catch (e) {
      sharpModule = null;
      console.error('picture-critic: pictures cannot be measured or trimmed here (sharp) — ' + e.message);
    }
  }
  return sharpModule;
}
var INPUT = { limitInputPixels: 60000000, failOn: 'error' };

/* ---------- the Critic's answer ---------- */
var BOX = { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, w: { type: 'NUMBER' }, h: { type: 'NUMBER' } }, required: ['x', 'y', 'w', 'h'] };
function seen(desc) {
  return { type: 'OBJECT', description: desc, properties: {
    found: { type: 'BOOLEAN' },
    what: { type: 'STRING', description: 'what and where, in a few plain words ("two small figures at lower left"); "" when none' },
    boxes: { type: 'ARRAY', items: BOX, description: 'where, as boxes from 0 to 1 of picture 1 (x, y: top-left; w, h: size); [] when none' }
  }, required: ['found', 'what', 'boxes'] };
}
var CRITIC_SCHEMA = { type: 'OBJECT', properties: {
  people: seen('people, as the people rule says'),
  text: seen('letters, words, numbers or glyphs that look like writing'),
  logos: seen('logos, brand marks, emblems, crests, badges, flags or watermarks'),
  artefacts: seen('broken image-model artefacts: melted or doubled objects, smeared brush marks, stray patches or rectangles'),
  border: { type: 'OBJECT', properties: {
    found: { type: 'BOOLEAN' },
    kind: { type: 'STRING', enum: ['none', 'mat', 'frame', 'letterbox', 'picture-in-picture'] },
    top: { type: 'NUMBER' }, right: { type: 'NUMBER' }, bottom: { type: 'NUMBER' }, left: { type: 'NUMBER' }
  }, required: ['found', 'kind', 'top', 'right', 'bottom', 'left'] },
  placeMatch: { type: 'STRING', enum: ['ok', 'wrong-landmark', 'generic', 'n/a'] },
  placeWhy: { type: 'STRING' },
  likeness: { type: 'BOOLEAN' },
  indianWomen: { type: 'STRING', enum: ['n/a', 'ok', 'missing'] },
  faceChanged: { type: 'STRING', enum: ['n/a', 'no', 'yes'] },
  sameScene: { type: 'STRING', enum: ['n/a', 'yes', 'no'] },
  brief: { type: 'INTEGER' },
  missing: { type: 'ARRAY', items: { type: 'STRING' } },
  tone: { type: 'INTEGER' },
  focus: BOX,
  survivesCrop: { type: 'BOOLEAN' },
  repair: { type: 'STRING' },
  why: { type: 'STRING' }
}, required: ['people', 'text', 'logos', 'artefacts', 'border', 'placeMatch', 'placeWhy', 'likeness', 'indianWomen', 'faceChanged', 'sameScene', 'brief', 'missing', 'tone', 'focus', 'survivesCrop', 'repair', 'why'] };

var PEOPLE_RULE = {
  none: 'NOBODY may be in it: people.found is true if any person or human shape can be seen anywhere, however small, distant, faceless, see-through, shadowy or symbolic — a figure, a silhouette, an outline, a mannequin, a statue of a person, a body part, a human icon or a pictogram. Figures carved into a building\'s stone or wood (a temple\'s sculpted walls and reliefs) are architecture and do not count.',
  distant: 'only a few tiny figures far in the distance may be in it: people.found is true if anyone is more than a tiny figure far away — in the foreground or the middle, a face that can be made out, a group or a crowd — or any silhouette, outline, mannequin, body part, human icon or pictogram.',
  allowed: 'people may be shown: people.found is true if any person can be seen. They must be made-up Indian people, with women among them, and look like nobody real or famous.'
};
var WHERE_WORDS = { hero: 'the wide banner at the top of the home page (the event\'s name, date and buttons are set over its middle)', background: 'a section\'s background, behind its words under a soft veil', picture: 'a picture inside a section' };

function criticPrompt(job, ctx, has) {
  job = job || {};
  var rule = PEOPLE_RULE[ctx.rule] ? ctx.rule : 'none';
  var brief = obj(job.brief);
  var asked = oneLine(job.plainSubject || job.subject, 400);
  var lines = [
    'You are the picture critic of an event website\'s AI assistant. An image model made picture 1 for one place on the site, and image models often draw what they were told not to. Look at the WHOLE picture closely — its edges and corners, small and distant details, screens, signs and surfaces — and judge it against the rules and what was asked. Answer in JSON, every field.',
    '',
    'Where it goes: ' + (WHERE_WORDS[job.placement] || WHERE_WORDS.picture) + (job.sectionName && job.placement !== 'hero' ? ', in the section "' + oneLine(job.sectionName, 40) + '" (its name is for your understanding only)' : '') + '.',
    'What was asked: ' + (asked || 'a picture for this place') + '.'
  ];
  if (brief && brief.scene) lines.push('The brief it was made from: ' + oneLine(brief.scene, 600) + (brief.placeCues ? ' Place cues: ' + oneLine(brief.placeCues, 300) + '.' : '') + (brief.notThis ? ' Not this: ' + oneLine(brief.notThis, 200) + '.' : ''));
  if (job.change) lines.push('The change asked of the picture before: ' + oneLine(job.change, 300) + '.');
  if (ctx.place) lines.push('The place it names: ' + oneLine(ctx.place, 300) + '.');
  if (ctx.styleWords) lines.push('The site\'s look: ' + oneLine(ctx.styleWords, 300) + '.');
  lines.push('', 'The pictures: picture 1 is the picture made, whole.' +
    (has.desktop ? ' Picture ' + has.desktop + ' is it cut to the frame it fills on a computer.' : '') +
    (has.phone ? ' Picture ' + has.phone + ' is it cut to the taller frame a phone shows.' : '') +
    (has.before ? ' Picture ' + has.before + ' is the picture before this change.' : '') +
    (has.style ? ' Picture ' + has.style + ' is one of the site\'s own pictures, for its tone only.' : ''));
  lines.push('', 'The rules and the fields:',
    '- people: ' + PEOPLE_RULE[rule],
    '- text: found is true if any letters, words, numbers or writing can be seen anywhere — on a sign, a screen, a banner, a building, a page or as a caption — even blurred, partial or made-up lettering, or glyphs that look like writing.',
    '- logos: found is true if any logo, brand mark, company or team emblem, crest, badge, flag or watermark can be seen. Carved ornaments, temple or wheel carvings, architectural motifs, leaf and line patterns and abstract shapes that stand for no one are decoration, not logos.',
    '- artefacts: found is true for broken image-model work: melted, doubled or warped objects, smeared brush marks, stray rectangles or patches, a part of the scene that makes no sense.',
    '- border: a mat, frame, letterbox or picture-in-picture drawn INSIDE picture 1 — a flat band of one colour along an edge, or the scene shown smaller inside a plain surround. top, right, bottom, left: how deep the band is on that edge, from 0 to 1 of the picture\'s height (top, bottom) or width (left, right); 0 where there is none.',
    '- placeMatch: only when a place, city or landmark is named: ok when it is recognisably that place; wrong-landmark when it shows another famous place (the Matterhorn\'s pyramid peak for Davos, say); generic when it could be anywhere; n/a when no place is named. placeWhy: why, in a few words; "" for ok or n/a.',
    '- likeness: true if any face looks like a famous real person.',
    '- indianWomen: only when people may be shown and people are in it: ok when they read as Indian and women are among them; missing otherwise; n/a when nobody is in it or people may not be shown.',
    '- faceChanged: only when a picture before is given and it shows people: yes if any face in picture 1 differs from it; n/a otherwise.',
    '- sameScene: only when a picture before is given: yes when picture 1 is the same scene, composition and viewpoint with only the change asked; no when the scene itself changed; n/a otherwise.',
    '- brief: from 0 to 5, how well picture 1 shows what was asked (5: exactly; 2 or less: it misses the point). missing: what of it is missing, a few words each; [] when nothing is.',
    '- tone: from 0 to 5, how well it matches the site\'s look' + (has.style ? ' (picture ' + has.style + ')' : '') + '; 3 when there is nothing to compare with.',
    '- focus: the box around what the picture is about, from 0 to 1 of picture 1 (the frame\'s cut follows it).',
    '- survivesCrop: true when the main subject is whole and clear in ' + (has.phone ? 'both cuts' : has.desktop ? 'the cut' : 'picture 1') + '.',
    '- repair: one imperative edit that fixes what breaks the rules or the brief and changes nothing else ("remove the two small figures at lower left; change nothing else"); "" when nothing is wrong, or when only a new picture can fix it.',
    '- why: one short, plain sentence for the site\'s owner saying what is wrong ("two people walk down the street, and this place takes nobody"); "" when nothing is wrong. Plain English; never the abbreviation ET on its own.',
    'Answer from what is in the pictures only.');
  return lines.join('\n');
}

/* the review, from the Critic's answer: what the place does not take, as flags in a fixed order */
function fromCritic(p, rule) {
  function part(k) {
    var x = obj(p[k]) || {};
    var boxes = (Array.isArray(x.boxes) ? x.boxes : []).map(function (b) {
      b = obj(b);
      if (!b) return null;
      var bx = unit(b.x), by = unit(b.y), bw = unit(b.w), bh = unit(b.h);
      return bx === null || by === null || bw === null || bh === null ? null : { x: bx, y: by, w: bw, h: bh };
    }).filter(Boolean).slice(0, 12);
    return { found: yes(x.found), what: oneLine(x.what, 160), boxes: boxes };
  }
  var people = part('people'), text = part('text'), logos = part('logos'), artefacts = part('artefacts');
  var b = obj(p.border) || {};
  var edges = { top: unit(b.top) || 0, right: unit(b.right) || 0, bottom: unit(b.bottom) || 0, left: unit(b.left) || 0 };
  var kind = pick(b.kind, ['none', 'mat', 'frame', 'letterbox', 'picture-in-picture'], 'none');
  var border = yes(b.found) && kind !== 'none' ? Object.assign({ kind: kind }, edges) : null;
  var f = obj(p.focus);
  var fx = f ? unit(f.x) : null, fy = f ? unit(f.y) : null, fw = f ? unit(f.w) : null, fh = f ? unit(f.h) : null;
  var focus = fx === null || fy === null || fw === null || fh === null ? null : { x: unit(Math.min(1, fx + fw / 2)), y: unit(Math.min(1, fy + fh / 2)) };
  var placeMatch = pick(p.placeMatch, ['ok', 'wrong-landmark', 'generic', 'n/a'], 'n/a');
  var indianWomen = pick(p.indianWomen, ['n/a', 'ok', 'missing'], 'n/a');
  var faceChanged = pick(p.faceChanged, ['n/a', 'no', 'yes'], 'n/a');
  var sameScene = pick(p.sameScene, ['n/a', 'yes', 'no'], 'n/a');
  var briefScore = score(p.brief), tone = score(p.tone);
  var missing = (Array.isArray(p.missing) ? p.missing : []).map(function (m) { return oneLine(m, 80); }).filter(Boolean).slice(0, 6);
  var survives = p.survivesCrop === false || String(p.survivesCrop).toLowerCase() === 'false' ? false : true;

  var flags = [];
  if (people.found && rule !== 'allowed') flags.push('people');
  if (text.found) flags.push('text');
  if (logos.found) flags.push('logos');
  if (border) flags.push('border');
  if (artefacts.found) flags.push('artefacts');
  if (placeMatch === 'wrong-landmark') flags.push('place');
  if (yes(p.likeness) && people.found) flags.push('likeness');
  if (rule === 'allowed' && people.found && indianWomen === 'missing') flags.push('women');
  if (faceChanged === 'yes') flags.push('face');
  if (sameScene === 'no') flags.push('scene');
  if (briefScore !== null && briefScore <= 2) flags.push('brief');
  if (!survives) flags.push('crop');
  flags.sort(function (a, c) { return FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(c); });

  var rev = { verdict: 'ok', source: 'critic', flags: flags,
    /* what today's check keeps on the job (checks[]): the same three answers, so the turn reads as before */
    found: { people: people.found, text: text.found, logos: logos.found },
    scores: {}, why: oneLine(noBareEt(p.why), 300), repair: oneLine(noBareEt(p.repair), 300),
    what: { people: people.what, text: text.what, logos: logos.what, artefacts: artefacts.what },
    boxes: { people: people.boxes, text: text.boxes, logos: logos.boxes, artefacts: artefacts.boxes },
    border: border, focus: focus, missing: missing, placeMatch: placeMatch, placeWhy: oneLine(p.placeWhy, 200),
    survivesCrop: survives, sameScene: sameScene, faceChanged: faceChanged, indianWomen: indianWomen };
  if (briefScore !== null) rev.scores.brief = briefScore;
  if (tone !== null) rev.scores.tone = tone;
  rev.verdict = verdictOf(rev);
  return rev;
}
/* a usable answer has the three answers today's check has, at least */
function usable(p) {
  p = obj(p);
  return !!p && ['people', 'text', 'logos'].every(function (k) { var x = obj(p[k]); return x && (x.found === true || x.found === false || /^(true|false)$/i.test(String(x.found))); });
}
function verdictOf(rev) {
  var f = rev.flags;
  if (!f.length) return 'ok';
  if (f.every(function (x) { return x === 'border'; })) return 'trim';
  if (f.some(function (x) { return REMAKE_ONLY.indexOf(x) !== -1; })) return 'remake';
  return rev.repair ? 'repair' : 'remake';
}

/* ---------- today's look (the `critic` switch off, or the Critic could not answer) ---------- */
function todaysLook(pic, ctx, rule) {
  return Promise.resolve().then(function () {
    return cp().checkPicture(pic && pic.bytes, pic && pic.type, rule, { eventId: ctx.eventId, deadlineAt: ctx.deadlineAt, record: ctx.record });
  }).then(function (found) {
    var flags = cp().refusedFor(found, rule);
    return { verdict: flags.length ? 'remake' : 'ok', source: 'check', flags: flags, found: found, scores: {}, why: '' };
  }, function (err) {
    /* checkPicture never rejects; this is a fault of this file: the picture goes on unchecked, as a failed look does */
    console.error('picture-critic: the look at the picture of ' + ctx.eventId + ' failed — ' + (err && err.message));
    return { verdict: 'ok', source: 'check', flags: [], found: null, scores: {}, why: '' };
  });
}

/* a picture as the Critic is shown it: a JPEG at most `side` wide or tall (its proportion kept) */
function small(bytes, side) {
  var sharp = loadSharp();
  if (!sharp || !Buffer.isBuffer(bytes) || !bytes.length) return Promise.resolve(null);
  return Promise.resolve().then(function () {
    return sharp(bytes, INPUT).rotate().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  }).catch(function () { return null; });
}

function review(pic, job, ctx) {
  ctx = ctx || {};
  var rule = ctx.rule || 'none';
  if (!on(ctx.switches, 'critic', ctx.caller)) return todaysLook(pic, ctx, rule);
  var whole = pic && pic.original && Buffer.isBuffer(pic.original.bytes) ? pic.original : pic;
  if (!whole || !Buffer.isBuffer(whole.bytes) || !whole.bytes.length) return todaysLook(pic, ctx, rule);
  var images = [], has = {};
  return Promise.all([small(whole.bytes, MAIN_SIDE), framePreviews(whole, job), ctx.before && ctx.before.bytes ? small(ctx.before.bytes, PREVIEW_SIDE) : null]).then(function (got) {
    var main = got[0];
    if (!main) {
      /* sharp could not read it: the picture itself, when it is small enough to send */
      if (whole.bytes.length > cp().CHECK_MAX_BYTES || !whole.type) return null;
      images.push({ mimeType: whole.type, data: whole.bytes.toString('base64') });
    } else images.push({ mimeType: 'image/jpeg', data: main.toString('base64') });
    (got[1] || []).forEach(function (p) {
      images.push({ mimeType: p.mimeType, data: p.data });
      has[p.label] = images.length;
    });
    if (got[2]) { images.push({ mimeType: 'image/jpeg', data: got[2].toString('base64') }); has.before = images.length; }
    var style = (Array.isArray(ctx.refs) ? ctx.refs : []).filter(function (r) { return r && r.use === 'style' && r.data && r.mimeType; })[0];
    if (style && images.length < 5) { images.push({ mimeType: style.mimeType, data: style.data }); has.style = images.length; }
    return llm.callJson(criticPrompt(job, Object.assign({}, ctx, { rule: rule }), has), CRITIC_SCHEMA, {
      route: 'picture-critic', eventId: ctx.eventId, images: images, timeoutMs: LOOK_TIMEOUT_MS, maxOutputTokens: 3000,
      deadlineAt: ctx.deadlineAt, onUsage: ctx.record
    });
  }).then(function (r) {
    var p = r && r.parsed;
    if (usable(p)) return fromCritic(p, rule);
    console.error('picture-critic: the Critic could not look at the picture of ' + ctx.eventId + ' — ' + (r && r.code ? r.code : 'its answer was not usable') + '; today\'s check looks instead');
    return todaysLook(pic, ctx, rule);
  }, function (err) {
    console.error('picture-critic: the Critic could not look at the picture of ' + ctx.eventId + ' — ' + (err && err.message) + '; today\'s check looks instead');
    return todaysLook(pic, ctx, rule);
  });
}

/* ---------- what happens next: one table ---------- */
/* today's runner (the `critic` switch off, or today's check looked): a stronger remake, the strictest third, then held */
function todaysDecide(rev, t) {
  var flags = rev && Array.isArray(rev.flags) ? rev.flags : [];
  if (!flags.length) return { action: 'keep' };
  var maxTries = t.maxTries || cp().MAX_TRIES, calls = t.calls || 1;
  if (calls >= maxTries) return { action: 'hold', why: 'tries' };
  if (!(t.timeLeftMs >= (t.retryNeedsMs == null ? cp().RETRY_NEEDS_MS : t.retryNeedsMs))) return { action: 'hold', why: 'time' };
  return { action: 'remake', line: cp().againLine(flags) + (calls + 1 >= maxTries ? ' ' + cp().strictLine(flags) : '') };
}
/* the Critic's table (plan §5.5):
     nothing found                          -> keep
     a border (and not trimmed yet)         -> trim with sharp, no AI (then the rest is decided again)
     people, words, logos, artefacts or the wrong landmark, with a repair, and no remake-only flag
                                            -> one repair: that picture edited (the `repair` switch)
     the brief missed, the subject lost in the cut, no Indian women where people are, a famous likeness, a face
     changed, the scene changed by an edit — or anything a repair did not fix
                                            -> one remake, with what was missing
     still wanting, or no time or tries left -> held, with the Critic's own reason */
function decide(rev, t) {
  t = t || {};
  rev = rev || {};
  if (rev.source !== 'critic' || !on(t.switches, 'critic', t.caller)) return todaysDecide(rev, t);
  var flags = Array.isArray(rev.flags) ? rev.flags : [];
  if (!flags.length) return { action: 'keep' };
  var maxTries = t.maxTries || cp().MAX_TRIES, calls = t.calls || 1, left = +t.timeLeftMs || 0;
  if (flags.indexOf('border') !== -1 && !t.trimmed) return { action: 'trim', edges: rev.border || null };
  var rest = flags.filter(function (f) { return f !== 'border'; });
  var remakeOnly = rest.some(function (f) { return REMAKE_ONLY.indexOf(f) !== -1; });
  /* a border the trim could not cut is fixed as the rest are: the picture edited to fill its edges */
  var change = rev.repair || (flags.indexOf('border') !== -1 && !rest.length ? 'Remove the plain border, mat or frame around the picture and continue the scene out to every edge; change nothing else.' : '');
  if (!remakeOnly && change && on(t.switches, 'repair', t.caller) && (t.repairs || 0) < MAX_REPAIRS && calls < maxTries && left >= REPAIR_NEEDS_MS) {
    return { action: 'repair', change: /change nothing else/i.test(change) ? change : change.replace(/[.;\s]+$/, '') + '; change nothing else.' };
  }
  var retryNeeds = t.retryNeedsMs == null ? cp().RETRY_NEEDS_MS : t.retryNeedsMs;
  if ((t.remakes || 0) < MAX_REMAKES && calls < maxTries) {
    if (left < retryNeeds) return { action: 'hold', why: 'time' };
    return { action: 'remake', line: remakeLine(rev) };
  }
  return { action: 'hold', why: calls >= maxTries || (t.remakes || 0) >= MAX_REMAKES ? 'tries' : 'time' };
}

/* the line a remake ends with: what the first had or missed, and what this one must be (the strict words for people,
   words and logos are today's, as this is the last new picture made for the ask) */
function remakeLine(rev) {
  rev = rev || {};
  var flags = Array.isArray(rev.flags) ? rev.flags : [], what = obj(rev.what) || {};
  var marks = flags.filter(function (f) { return f === 'people' || f === 'text' || f === 'logos'; });
  var parts = [];
  if (marks.length) parts.push(cp().againLine(marks) + ' ' + cp().strictLine(marks));
  var also = [];
  if (flags.indexOf('artefacts') !== -1) also.push('no melted, doubled or broken shapes' + (what.artefacts ? ' (the first had ' + what.artefacts + ')' : ''));
  if (flags.indexOf('border') !== -1) also.push('a full-bleed picture, edge to edge, with no border, frame or mat');
  if (flags.indexOf('place') !== -1) also.push('the named place itself, true to its real shape' + (rev.placeWhy ? ' (the first ' + rev.placeWhy.replace(/[.\s]+$/, '') + ')' : ''));
  if (flags.indexOf('brief') !== -1 && rev.missing && rev.missing.length) also.push('what the first left out: ' + joinAnd(rev.missing));
  else if (flags.indexOf('brief') !== -1) also.push('the scene as asked, as the main subject');
  if (flags.indexOf('crop') !== -1) also.push('the main subject whole and near the middle, with room around it, so the frame\'s cut keeps it');
  if (flags.indexOf('women') !== -1) also.push('made-up Indian people, with women among them');
  if (flags.indexOf('likeness') !== -1) also.push('only made-up people who look like no one famous');
  if (flags.indexOf('scene') !== -1 || flags.indexOf('face') !== -1) also.push('the same scene as asked, nothing of it changed');
  if (also.length) parts.push('ANOTHER TRY: this one must have ' + also.join('; ') + '.');
  return parts.join(' ') || cp().againLine(flags);
}

/* the Critic's sentence, safe to show; '' when it gave none */
function plainWhy(rev) {
  var s = oneLine(noBareEt(rev && rev.why), 300).replace(/[.\s]+$/, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/* ---------- borders drawn into the picture ---------- */
var WHITE_MIN = 232, BLACK_MAX = 24;
var BAND_FILL = 0.96;          // of a line's pixels the band's colour
var BAND_CLEAN = 0.985;        // the band's lines, on average
var EDGE_DROP = 0.6;           // the first line past the band: a mat ends sharply, a white sky fades
var FLAT_SPREAD = 6;           // the band's luminance spread (standard deviation, of 255): a mat is flat
var MAX_DEPTH = 0.3;           // a band deeper than this is the picture itself
var DETECT_SIDE = 1600;
var MARGIN_PX = 2;             // the soft line where a mat meets the picture goes with it
function trimBorders(bytes, o) {
  o = o || {};
  var sharp = loadSharp();
  if (!sharp || !Buffer.isBuffer(bytes) || !bytes.length) return Promise.resolve(null);
  var meta;
  return Promise.resolve().then(function () {
    return sharp(bytes, INPUT).metadata();
  }).then(function (m) {
    meta = m;
    if (!m || ['png', 'jpeg', 'webp'].indexOf(m.format) === -1 || (m.pages || 1) > 1) return null;
    return sharp(bytes, INPUT).rotate().resize({ width: DETECT_SIDE, height: DETECT_SIDE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#808080' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  }).then(function (got) {
    if (!got) return null;
    var turned = (meta.orientation || 1) >= 5;
    var W0 = turned ? meta.height : meta.width, H0 = turned ? meta.width : meta.height;
    var bands = findBands(got.data, got.info.width, got.info.height, got.info.channels, !!o.force);
    if (!bands) return null;
    var sx = W0 / got.info.width, sy = H0 / got.info.height;
    function cut(v, s) { return v ? Math.min(Math.round(v * s) + MARGIN_PX, Math.round(MAX_DEPTH * (s === sx ? W0 : H0))) : 0; }
    var t = { top: cut(bands.top, sy), right: cut(bands.right, sx), bottom: cut(bands.bottom, sy), left: cut(bands.left, sx) };
    var w = W0 - t.left - t.right, h = H0 - t.top - t.bottom;
    if (!(w >= W0 * 0.5 && h >= H0 * 0.5)) return null;
    var pipe = sharp(bytes, INPUT).rotate().extract({ left: t.left, top: t.top, width: w, height: h });
    pipe = meta.format === 'jpeg' ? pipe.jpeg({ quality: 92 }) : meta.format === 'webp' ? pipe.webp({ quality: 92 }) : pipe.png();
    return pipe.toBuffer().then(function (out) { return { bytes: out, width: w, height: h, trimmed: t }; });
  }).catch(function (err) {
    console.error('picture-critic: ' + (o.label || 'a picture') + ' could not be trimmed — ' + (err && err.message));
    return null;
  });
}
/* the flat bands along each edge, in pixels of the picture measured ({ top, right, bottom, left }), or null */
function findBands(data, W, H, C, force) {
  function lum(i) { return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000; }
  function isWhite(i) { return data[i] >= WHITE_MIN && data[i + 1] >= WHITE_MIN && data[i + 2] >= WHITE_MIN; }
  function isBlack(i) { return data[i] <= BLACK_MAX && data[i + 1] <= BLACK_MAX && data[i + 2] <= BLACK_MAX; }
  /* the share of a row's (or a column's) pixels, between a and b, that pass test */
  function rowFill(y, a, b, test) { var n = 0; for (var x = a; x < b; x++) if (test((y * W + x) * C)) n++; return b > a ? n / (b - a) : 0; }
  function colFill(x, a, b, test) { var n = 0; for (var y = a; y < b; y++) if (test((y * W + x) * C)) n++; return b > a ? n / (b - a) : 0; }
  /* how deep a band of that colour is on one edge, with how clean it is, how sharply it ends and how flat it is */
  function depth(edge, test, win) {
    var max = Math.floor((edge === 'top' || edge === 'bottom' ? H : W) * MAX_DEPTH), d = 0, sum = 0, lead = 0;
    function fill(k) {
      if (edge === 'top') return rowFill(k, win.a, win.b, test);
      if (edge === 'bottom') return rowFill(H - 1 - k, win.a, win.b, test);
      if (edge === 'left') return colFill(k, win.a, win.b, test);
      return colFill(W - 1 - k, win.a, win.b, test);
    }
    /* the outermost two lines may be a thin outline or a shadow (the #53 picture's grey corner) */
    while (lead < 2 && fill(lead) < BAND_FILL && fill(lead + 1) >= BAND_FILL) lead++;
    d = lead;
    while (d < max && fill(d) >= BAND_FILL) { sum += fill(d); d++; }
    var lines = d - lead;
    if (lines < 1) return null;
    var after = d < max ? Math.min(fill(d), d + 1 < max ? fill(d + 1) : 1, d + 2 < max ? fill(d + 2) : 1) : 1;
    /* flatness: the luminance spread over the band, sampled */
    var n = 0, m = 0, m2 = 0, step = Math.max(1, Math.floor((win.b - win.a) / 200));
    for (var k = lead; k < d; k += Math.max(1, Math.floor(lines / 20))) {
      for (var j = win.a; j < win.b; j += step) {
        var x = edge === 'left' ? k : edge === 'right' ? W - 1 - k : j, y = edge === 'top' ? k : edge === 'bottom' ? H - 1 - k : j;
        var v = lum((y * W + x) * C); n++; m += v; m2 += v * v;
      }
    }
    var spread = n ? Math.sqrt(Math.max(0, m2 / n - (m / n) * (m / n))) : 255;
    return { depth: d, clean: sum / lines, after: after, spread: spread };
  }
  var found = { top: 0, right: 0, bottom: 0, left: 0 };
  /* twice: each edge is measured between the bands the others have, as a mat's sides run the picture's full height */
  for (var pass = 0; pass < 2; pass++) {
    ['top', 'bottom', 'left', 'right'].forEach(function (edge) {
      var across = edge === 'top' || edge === 'bottom';
      var win = across ? { a: found.left, b: W - found.right } : { a: found.top, b: H - found.bottom };
      var best = null;
      [isWhite, isBlack].forEach(function (test) {
        var r = depth(edge, test, win);
        if (r && r.clean >= BAND_CLEAN && r.after < EDGE_DROP && r.spread <= FLAT_SPREAD && (!best || r.depth > best.depth)) best = r;
      });
      found[edge] = best ? best.depth : 0;
    });
  }
  var minDepth = function (edge) { return Math.max(3, Math.round((edge === 'top' || edge === 'bottom' ? H : W) * 0.01)); };
  var edges = Object.keys(found).filter(function (e) { return found[e] >= minDepth(e); });
  Object.keys(found).forEach(function (e) { if (edges.indexOf(e) === -1) found[e] = 0; });
  if (!edges.length || (edges.length < 2 && !force)) return null;
  return found;
}

/* ---------- the picture in its frames ---------- */
function framePreviews(pic, job) {
  pic = pic || {};
  job = job || {};
  var sharp = loadSharp();
  if (!sharp || !Buffer.isBuffer(pic.bytes) || !pic.bytes.length) return Promise.resolve([]);
  var desk = shape.targetRatio({ frame: job.frame, aspect: job.aspect });
  var phone = PHONE_RATIO[job.placement] || 0;
  var wanted = [];
  if (desk > 0) wanted.push({ label: 'desktop', ratio: desk });
  if (phone > 0 && (!desk || Math.abs(Math.log(phone / desk)) > 0.05)) wanted.push({ label: 'phone', ratio: phone });
  return Promise.all(wanted.map(function (w) {
    return shape.crop(pic.bytes, w.ratio, { label: 'a preview' }).then(function (cut) {
      return small(cut.bytes, PREVIEW_SIDE).then(function (jpg) { return jpg ? { label: w.label, mimeType: 'image/jpeg', data: jpg.toString('base64'), ratio: w.ratio } : null; });
    });
  })).then(function (list) { return list.filter(Boolean); }, function () { return []; });
}

/* ---------- "Show 3 options": the best first ---------- */
function rank(reviews) {
  var list = Array.isArray(reviews) ? reviews : [];
  function worth(r) {
    r = obj(r) || {};
    var flags = Array.isArray(r.flags) ? r.flags.length : 9, s = obj(r.scores) || {};
    return (flags ? 0 : 100) - flags * 10 + (s.brief == null ? 3 : s.brief) * 3 + (s.tone == null ? 3 : s.tone) * 2;
  }
  return list.map(function (r, i) { return { i: i, w: worth(r) }; }).sort(function (a, b) { return b.w - a.w || a.i - b.i; }).map(function (x) { return x.i; });
}

module.exports = {
  CRITIC_SCHEMA: CRITIC_SCHEMA, FIXABLE: FIXABLE, REMAKE_ONLY: REMAKE_ONLY, REPAIR_NEEDS_MS: REPAIR_NEEDS_MS, MAX_REPAIRS: MAX_REPAIRS,
  MAX_REMAKES: MAX_REMAKES, PHONE_RATIO: PHONE_RATIO,
  review: review, decide: decide, trimBorders: trimBorders, framePreviews: framePreviews, rank: rank, remakeLine: remakeLine,
  plainWhy: plainWhy, criticPrompt: criticPrompt, fromCritic: fromCritic
};
