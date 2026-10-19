/* The owner's brief: the ten points Create Event asks for under "Describe the event" (its Guide panel names
   them), read so that a site is built to what the owner said, not to what a model guessed.

   They arrive two ways. The description starts as ten headings the owner fills in ("Main action: Request an
   invite"): those lines are read here, word for word, with no model in between. A deck can state the same
   things: the brief reader (extract-brief) is asked for them too, as ownerPoints. The owner's own lines win
   over the deck wherever both say something.

   Each point is optional. A point not given is simply absent, and the site is designed as it always was.

     fromText(text)                 -> { tagline: '…', mainAction: '…', … }   the filled-in headings, raw
     withoutHeadings(text)          -> text   the description with the headings taken out (its free text)
     normalise(raw)                 -> owner | null   the points, cleaned and read (see OWNER below)
     merge(fromOwner, fromDeck)     -> owner | null   the owner's lines first, the deck's for the rest
     buttons(owner, targets)        -> { primary, secondary }   the hero's two buttons
     planLines(owner) / copyLines(owner)  -> [string]   the rules the plan and the writing are given

   OWNER = { tagline, usp, audience, industry, scale, mustAvoid,            (the owner's words)
             level: 'india'|'global'|'regional', levelText,
             format: 'in-person'|'virtual'|'hybrid', formatText,
             action: { kind: 'register'|'request-invite'|'apply'|'nominate'|'sponsor'|'custom', label },
             secondAction: same | absent,
             pictures: 'photos'|'graphics', tone: 'boardroom'|'energetic'|'editorial', lookText,
             from: { <point>: 'description'|'document' } }
   No network, no Firebase: see owner-brief.test.js. */

var HEADINGS = [
  { key: 'tagline', re: /^tag\s*line|^theme\b/i },
  { key: 'usp', re: /^why attend|^usp\b|^unique selling/i },
  { key: 'audience', re: /^(target )?audience/i },
  { key: 'industry', re: /^(target )?industr/i },
  { key: 'level', re: /^(event )?level/i },
  { key: 'format', re: /^format/i },
  { key: 'mainAction', re: /^main action|^primary action|^call to action/i },
  { key: 'scale', re: /^expected scale|^scale\b/i },
  { key: 'look', re: /^look/i },
  { key: 'mustAvoid', re: /^must avoid|^avoid\b/i }
];
var KEYS = HEADINGS.map(function (h) { return h.key; });

/* a value that only says "not decided" */
var EMPTY = /^(?:-+|—|–|\.+|n\/?a|na|nil|none|tbd|tbc|to be decided|to be confirmed|not sure|later|\?+)$/i;

function clean(v, max) {
  v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  /* quotation marks round the whole of it are not part of it */
  var q = /^["'“‘](.*)["'”’]$/.exec(v);
  if (q && !/["“”]/.test(q[1])) v = q[1].trim();
  return EMPTY.test(v) ? '' : v.slice(0, max || 400);
}

/* "Heading (options): value" — the heading part is what comes before the first colon */
function headingOf(line) {
  var m = /^\s*[-*•]?\s*([^:]{2,90}):(.*)$/.exec(line);
  if (!m) return null;
  var name = m[1].replace(/\([^)]*\)/g, '').trim();
  for (var i = 0; i < HEADINGS.length; i++) if (HEADINGS[i].re.test(name)) return { key: HEADINGS[i].key, value: m[2].trim() };
  return null;
}

/* The filled-in headings of a description. A value may go on over the next lines (up to a blank line or the
   next heading). Anything else in the description is left to the brief reader. */
function fromText(text) {
  var out = {}, current = null;
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var h = headingOf(line);
    if (h) { current = h.key; if (out[current] == null) out[current] = h.value; return; }
    if (!line.trim()) { current = null; return; }
    if (current) out[current] = (out[current] ? out[current] + ' ' : '') + line.trim();
  });
  Object.keys(out).forEach(function (k) { out[k] = clean(out[k], 600); if (!out[k]) delete out[k]; });
  return out;
}

/* The description without its headings, filled or not (and a filled one's following lines): what is left is
   the owner's free text about the event. The headings are directions (planLines, copyLines), never facts to
   show, so they are not handed to a model as part of the event's description. */
function withoutHeadings(text) {
  var out = [], inHeading = false;
  String(text || '').split(/\r?\n/).forEach(function (line) {
    if (headingOf(line)) { inHeading = true; return; }
    if (!line.trim()) { inHeading = false; out.push(''); return; }
    if (!inHeading) out.push(line);
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- reading a point ---------- */

/* the kinds a value names, in the order it names them; a value that names every option was not a choice */
function kindsIn(value, table) {
  var found = [];
  table.forEach(function (t) {
    var m = t.re.exec(value);
    if (m) found.push({ kind: t.kind, at: m.index });
  });
  found.sort(function (a, b) { return a.at - b.at; });
  return found.map(function (f) { return f.kind; });
}

var LEVELS = [
  { kind: 'global', re: /\b(global|international|worldwide|multi-?country|across (?:the )?world)\b/i },
  { kind: 'india', re: /\b(pan[- ]?india|national|india|indian)\b/i },
  { kind: 'regional', re: /\b(regional|zonal|state[- ]level|city[- ]level|local)\b/i }
];
function readLevel(v) {
  var k = kindsIn(v, LEVELS);
  if (k.length === 3) return '';
  /* "global, with an India focus": global; "pan-India": india */
  return k.indexOf('global') !== -1 ? 'global' : k[0] || '';
}

var FORMATS = [
  { kind: 'hybrid', re: /\b(hybrid|both in[- ]?person and (?:virtual|online))\b/i },
  { kind: 'virtual', re: /\b(virtual|online|webinar|digital(?:ly)?|live[- ]?stream(?:ed)?)\b/i },
  { kind: 'in-person', re: /\b(in[- ]?person|physical|on[- ]?ground|offline|on[- ]?site)\b/i }
];
function readFormat(v) {
  var k = kindsIn(v, FORMATS);
  if (k.length === 3) return '';
  if (k.indexOf('hybrid') !== -1 || (k.indexOf('virtual') !== -1 && k.indexOf('in-person') !== -1)) return 'hybrid';
  if (k.length) return k[0];
  /* a place and nothing else ("Mumbai, JW Marriott") is an event held there */
  return /[a-z]{3}/i.test(v) ? 'in-person' : '';
}

var ACTIONS = [
  { kind: 'request-invite', label: 'Request an Invite', re: /\b(request(?:ing)? (?:an |your )?invit\w*|by invitation|invite[- ]only|invitation)\b/i },
  { kind: 'nominate', label: 'Nominate Now', re: /\b(nominat\w*)\b/i },
  { kind: 'apply', label: 'Apply Now', re: /\b(apply|application)\b/i },
  { kind: 'sponsor', label: 'Become a Partner', re: /\b(become a (?:sponsor|partner)|sponsor\w*|partner with us|partnership)\b/i },
  { kind: 'register', label: 'Register Now', re: /\b(regist\w*|sign[- ]?up|book (?:a |your )?(?:seat|pass|ticket)\w*|buy (?:a )?(?:pass|ticket)\w*)\b/i }
];
function readActions(v) {
  var k = kindsIn(v, ACTIONS);
  if (k.length >= 4) return [];                                   // the option list itself, not a choice
  var out = k.slice(0, 2).map(function (kind) { return { kind: kind, label: ACTIONS.filter(function (a) { return a.kind === kind; })[0].label }; });
  if (!out.length && v) {
    /* the owner's own words for it ("Book a meeting"): the button says that */
    var label = v.replace(/[.!]+$/, '').slice(0, 32).trim();
    if (label) out.push({ kind: 'custom', label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return out;
}

var PICTURES = [
  { kind: 'graphics', re: /\b(no (?:photo|picture|image)s?|without (?:photo|picture|image)s?|graphic\w*|illustrat\w*|vector|abstract|icons?)\b/i },
  { kind: 'photos', re: /\b(photo\w*|pictures?|images?|imagery|real people)\b/i }
];
function readPictures(v) {
  if (/\b(no|without) (?:photo|picture|image)s?\b/i.test(v)) return 'graphics';
  var k = kindsIn(v, PICTURES);
  return k.length === 2 ? '' : k[0] || '';
}
var TONES = [
  { kind: 'boardroom', re: /\b(boardroom|formal|corporate|premium|serious|executive|classic|sober)\b/i },
  { kind: 'energetic', re: /\b(energetic|energy|vibrant|bold|dynamic|lively|youthful|fun|playful)\b/i },
  { kind: 'editorial', re: /\b(editorial|magazine|journalistic|thoughtful|minimal\w*|typographic)\b/i }
];
function readTone(v) {
  var k = kindsIn(v, TONES);
  return k.length === 3 ? '' : k[0] || '';
}

/* raw points -> OWNER (or null when nothing usable is in them) */
function normalise(raw) {
  raw = raw || {};
  var o = {};
  ['tagline', 'usp', 'audience', 'industry', 'scale', 'mustAvoid'].forEach(function (k) {
    var v = clean(raw[k], k === 'tagline' ? 160 : 500);
    /* a scale is numbers: "delegates" alone says nothing a page could show */
    if (k === 'scale' && !/\d/.test(v)) v = '';
    if (v) o[k] = v;
  });
  var level = clean(raw.level, 200);
  if (level && readLevel(level)) { o.level = readLevel(level); o.levelText = level; }
  var format = clean(raw.format, 200);
  if (format && readFormat(format)) { o.format = readFormat(format); o.formatText = format; }
  var actions = readActions(clean(raw.mainAction, 200));
  if (actions[0]) o.action = actions[0];
  if (actions[1]) o.secondAction = actions[1];
  var look = clean(raw.look, 300);
  if (look) {
    var pictures = readPictures(look), tone = readTone(look);
    if (pictures) o.pictures = pictures;
    if (tone) o.tone = tone;
    o.lookText = look;
  }
  return Object.keys(o).length ? o : null;
}

/* The owner's points over the deck's: each point is taken from the description when it is there, else from
   the document. -> OWNER with `from` naming where each point came from, or null */
function merge(fromOwner, fromDeck) {
  var a = normalise(fromOwner), b = normalise(fromDeck);
  if (!a && !b) return null;
  var out = {}, from = {};
  var groups = { level: ['level', 'levelText'], format: ['format', 'formatText'], mainAction: ['action', 'secondAction'], look: ['pictures', 'tone', 'lookText'] };
  KEYS.forEach(function (k) {
    var fields = groups[k] || [k];
    var src = a && fields.some(function (f) { return a[f] != null; }) ? a : b && fields.some(function (f) { return b[f] != null; }) ? b : null;
    if (!src) return;
    fields.forEach(function (f) { if (src[f] != null) out[f] = src[f]; });
    from[k] = src === a ? 'description' : 'document';
  });
  out.from = from;
  return out;
}

/* ---------- what the site does with it ---------- */

/* The hero's two buttons. targets: { register, partner } — the section ids each kind of button leads to. */
function buttons(owner, targets) {
  targets = targets || {};
  function href(kind) { return '#' + ((kind === 'sponsor' ? targets.partner || targets.register : targets.register) || 'footer'); }
  var first = owner && owner.action, second = owner && owner.secondAction;
  if (!first) return { primary: { label: 'Register Now', href: href('register'), register: true }, secondary: { label: 'Join as Partner', href: href('sponsor') } };
  var primary = { label: first.label, href: href(first.kind), register: first.kind !== 'sponsor' };
  var secondary = second ? { label: second.label, href: href(second.kind) }
    : first.kind === 'sponsor' ? { label: 'Register Now', href: href('register') }
    : { label: 'Join as Partner', href: href('sponsor') };
  return { primary: primary, secondary: secondary };
}

/* How each point STEERS the site. None of them is content: a visitor never sees "Level: pan-India", "Tone:
   energetic" or "Expected: delegates" as words on the page. Only three reach the page as such: the tagline
   (the hero line), the main action (the wording of the buttons) and real numbers of the expected scale. */
var LEVEL_NOTES = {
  india: 'a pan-India event — frame the whole site for India: Indian context, companies and examples, Indian people in every picture.',
  global: 'a global event — frame the whole site internationally: global companies and examples, never India-only framing; the people in the pictures are an international mix, Indian professionals among them.',
  regional: 'a regional event — keep its region and city in view in the framing and the pictures.'
};
var FORMAT_NOTES = {
  'in-person': 'held in person — the venue and the city matter.',
  virtual: 'VIRTUAL — there is no venue: no venue or travel section, no map, no "see you in <city>"; joining is online.',
  hybrid: 'HYBRID — in person and online: how to take part either way is clear.'
};
var TONE_NOTES = {
  boardroom: 'boardroom — formal, restrained and premium: measured wording, generous space, a classic type pairing, nothing loud.',
  energetic: 'energetic — bold and vivid: punchy short lines, strong colour, dynamic layouts.',
  editorial: 'editorial — magazine-like: considered typography, fewer and larger statements, thoughtful wording.'
};
var NOT_CONTENT = 'These are DIRECTIONS that steer your work, not content for the page. Never show them as labels, tags, chips, fact strips, cards, bands or footer notes — no "Reach", "Level", "Pan-India", "Format", "Tone", "Main action" or "Expected …" items anywhere. The only ones a visitor sees as such: the tagline (the hero line), the main action (the wording of the buttons) and the numbers of the expected scale when they are given.';

/* the rules the PLAN is given (structure, design, pictures) */
function planLines(o) {
  if (!o) return [];
  var l = ['THE OWNER\'S BRIEF — the owner wrote these points themselves; they win over the reference page, the art direction and the document wherever they differ (never by inventing a fact). ' + NOT_CONTENT];
  if (o.tagline) l.push('- Tagline: "' + o.tagline + '" — design.heroTagline is exactly this, word for word.');
  if (o.usp) l.push('- What sets it apart: "' + o.usp + '" — the reason a visitor should come: plan the first section under the hero and a why-attend section around it.');
  if (o.audience) l.push('- Audience: "' + o.audience + '" — design for them (mood, density, seriousness), and plan a who-should-attend section about them.');
  if (o.industry) l.push('- Industry: "' + o.industry + '" — the pictures and examples come from these industries.');
  if (o.level) l.push('- Level: ' + LEVEL_NOTES[o.level]);
  if (o.format) l.push('- Format: ' + FORMAT_NOTES[o.format]);
  if (o.action) l.push('- Main action: "' + o.action.label + '" — the site leads a visitor to this; plan a closing section that asks for it.');
  if (o.scale) l.push('- Expected scale: "' + o.scale + '" — if the page shows headline numbers, these are they, exactly as given and labelled as expected for this edition; no other headline number may be made up.');
  if (o.pictures === 'graphics') l.push('- Look: GRAPHICS, NOT PHOTOGRAPHS — no section gets a generated picture (sections[].image empty), every section builds its interest from graphic shapes, icons and type, and design.heroImage describes a graphic composition from the event\'s subject (no people, no photograph).');
  else if (o.pictures === 'photos') l.push('- Look: photographs — real event and industry scenes, as set out under PICTURES.');
  if (o.tone) l.push('- Tone: ' + TONE_NOTES[o.tone] + ' Choose the mood, fonts and layout for it.');
  else if (o.lookText && !o.pictures) l.push('- Look and tone, in the owner\'s words: "' + o.lookText + '" — choose the mood, fonts and layout for it.');
  if (o.mustAvoid) l.push('- MUST AVOID: "' + o.mustAvoid + '" — none of this may appear anywhere on the site, in any wording or picture.');
  return l;
}

/* the rules the WRITING is given (the copy and the calls to action of every section) */
function copyLines(o) {
  if (!o) return [];
  var l = ['THE OWNER\'S BRIEF — the owner wrote these points themselves; follow them in what you write (never by inventing a fact). ' + NOT_CONTENT];
  if (o.usp) l.push('- What sets it apart: "' + o.usp + '" — the overview opens on this and the why-attend copy is built on it, in well-written sentences (not the owner\'s note pasted as it is).');
  if (o.audience) l.push('- Audience: "' + o.audience + '" — write to them, in their language; who-should-attend describes exactly these people.');
  if (o.industry) l.push('- Industry: "' + o.industry + '" — examples and wording come from these industries.');
  if (o.level) l.push('- Level: ' + LEVEL_NOTES[o.level]);
  if (o.format) l.push('- Format: ' + FORMAT_NOTES[o.format]);
  if (o.action) l.push('- Main action: every call to action on the site — the nav button, a closing band, any "join us" line — says "' + o.action.label + '" (or a close variant of it); never another main action' + (o.action.kind === 'request-invite' ? ': this event is by invitation, so never "Register" or "Buy a pass".' : '.'));
  if (o.scale) l.push('- Expected scale: "' + o.scale + '" — if you show headline numbers, these are they, exactly as given and labelled as expected; never a figure without its number, and no other headline number made up.');
  if (o.pictures === 'graphics') l.push('- Look: graphics, not photographs — sections without a picture build their interest from shapes, icons and type.');
  if (o.tone) l.push('- Tone of the writing: ' + TONE_NOTES[o.tone]);
  if (o.mustAvoid) l.push('- MUST AVOID, anywhere in what you write: "' + o.mustAvoid + '".');
  return l;
}

module.exports = { KEYS, fromText, withoutHeadings, normalise, merge, buttons, planLines, copyLines };
