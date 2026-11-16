/* lib/picture-capabilities.js — W1 (builder A): the one list of what ETB2B AI can and cannot do with pictures, from
   which the prompt block, the help text and the limit sentences are written, and the check that an answer does not
   claim a limit the switches have lifted (owner, 16 Nov 2026: "I can't see the pictures inside your PDF", "I can make
   one picture per message", "the banner at the top looks empty" — each untrue when it was said).

     MANIFEST                       -> { can: [{ code, words, needs }], cannot: [{ code, words }] }
     can(code, switches)            -> true when that capability may be claimed now (its switch on, or none needed)
     promptBlock(switches)          -> the lines for chatPicture.promptLines (plan on): what may be said, and how
     sentence(code, ctx)            -> a limit or a capability in the manifest's own words ('' for an unknown code)
     claimCheck(summary, switches, facts)
                                    -> { ok: true, summary } | { ok: false, codes: [code], summary } — every sentence
                                       that claims a limit the manifest says is not one (or calls the banner empty while
                                       facts.bannerPicture says it has a picture) replaced by the true line, once per
                                       code; the rest of the answer kept as it is
   Nothing here calls a model or reads anything. */
'use strict';

var pictureSwitches = require('./picture-switches');

/* `needs`: the switch that must be on for the capability to be claimed ('' = always) */
var MANIFEST = {
  can: [
    { code: 'make', words: 'make new pictures for this page, each in the shape of its frame', needs: '' },
    { code: 'pdf-pictures', words: 'see the pictures inside an attached PDF or deck, place them and re-create them', needs: '' },
    { code: 'owner-photo', words: 'put a picture the owner attaches in as it is', needs: '' },
    { code: 'fit-frame', words: 'make a picture in the shape of its frame', needs: '' },
    { code: 'see-page', words: 'see the page as it looks in the editor now', needs: '' },
    { code: 'several', words: 'make several pictures in one message (up to 4)', needs: 'plan' },
    { code: 'edit', words: 'change a picture already on the page (warmer, brighter, wider, without the people)', needs: 'edit' },
    { code: 'references', words: 'use an attached photo or a document picture as a guide for a new picture', needs: 'refs' },
    { code: 'options', words: 'show 3 options for one picture when asked', needs: 'variants' }
  ],
  cannot: [
    { code: 'real-people', words: 'put a real or named person into a picture it makes' },
    { code: 'lettering', words: 'put words, letters or logos into a picture it makes' },
    { code: 'brand', words: 'put a company\'s or a brand\'s name, sign or logo into a picture it makes' },
    { code: 'content-photos', words: 'replace the photos that come from Content (speakers, partners): those are changed under Content' },
    { code: 'web', words: 'open other websites or find photos on the web' }
  ]
};

/* the words the owner reads: what is true, said in one line each (never a bare "ET") */
var TRUE_LINES = {
  make: 'I can make new pictures for this page, each in the shape of its frame.',
  'pdf-pictures': 'I can see the photos inside an attached PDF or deck, put them on the page and make new pictures that follow them.',
  'owner-photo': 'I can put a picture you attach on the page as it is.',
  'fit-frame': 'I make each picture in the shape of its frame.',
  'see-page': 'I can see the page as it looks in the editor right now.',
  several: 'I can make up to 4 new pictures in one message.',
  edit: 'I can change a picture that is already on the page — warmer, brighter, wider, or without the people — and keep the rest of it.',
  references: 'I can use a photo you attach, or one from your PDF, as a guide for a new picture.',
  options: 'I can show you 3 options for one picture when you ask.',
  'banner-empty': 'The banner already has its picture.'
};
var LIMIT_LINES = {
  'real-people': 'I don\'t put real or named people into pictures I make.',
  lettering: 'Pictures I make never carry words, letters or logos — the site sets every word itself.',
  brand: 'Pictures I make never carry a company\'s or a brand\'s name, sign or logo.',
  'content-photos': 'The photos of speakers and partners come from Content, so they are changed there, not by a picture I make.',
  web: 'I can\'t open other websites or find photos on the web.'
};

function on(sw, name) { return !name || pictureSwitches.on(sw, name, 'chat'); }
function entry(code) { return MANIFEST.can.filter(function (c) { return c.code === code; })[0] || null; }
function can(code, switches) { var c = entry(code); return !!c && on(switches, c.needs); }

/* The prompt's lines (only with `plan` on: chatPicture.promptLines) — what may be claimed now, and the rule that a
   limit is said only as the manifest words it */
function promptBlock(switches) {
  var yes = MANIFEST.can.filter(function (c) { return on(switches, c.needs); }).map(function (c) { return c.words; });
  var no = MANIFEST.cannot.map(function (c) { return c.words; });
  var lines = [
    'WHAT YOU CAN DO WITH PICTURES: you can ' + yes.join('; ') + '.',
    'WHAT YOU CANNOT DO WITH PICTURES: you cannot ' + no.join('; ') + '.',
    '- Say a limit only in those words, and only when it is one: never say you cannot see a PDF\'s or a deck\'s pictures, cannot make or change pictures, or can make only one picture per message' +
      (can('edit', switches) ? '' : ' (a change to a picture already there is made as a new picture for the same place)') + '.'
  ];
  return lines.join('\n');
}

/* a limit (MANIFEST.cannot) or a capability (MANIFEST.can) in its own one line */
function sentence(code, ctx) {
  return LIMIT_LINES[code] || TRUE_LINES[code] || '';
}

/* ---------- the claim check ----------
   Each sentence of the answer is read on its own. A pattern is a false claim only while its capability is on (the
   PDF's pictures always are; several pictures only with `plan`; an edit only with `edit`). */
var NOT = '(?:can(?:no|\\s+no|’|\')?t|cannot|unable\\s+to|not\\s+able\\s+to|no\\s+way\\s+to|don[\'’]?t\\s+have\\s+(?:a\\s+)?way\\s+to|isn[\'’]?t\\s+possible\\s+to|not\\s+possible\\s+to|am\\s+not\\s+able\\s+to)';
var PIC = '(?:pictures?|images?|photos?|photographs?|visuals?|graphics?)';
var DOC = '(?:pdfs?|decks?|documents?|presentations?|slides?|ppts?|pptx|brochures?|attachments?|files?)';
var CLAIMS = [
  /* "I can't see the pictures inside your PDF", "I can't pull the pictures out of the PDF", "Images inside an attached PDF
     cannot be directly extracted and placed onto the page" */
  { code: 'pdf-pictures', re: [
    new RegExp('\\b' + NOT + '\\b[^.?!]{0,60}\\b(?:see|view|read|open|extract|pull|take|get|use|access|analy[sz]e|look\\s+at|place|reuse)\\b[^.?!]{0,60}\\b' + PIC + '\\b[^.?!]{0,60}\\b' + DOC + '\\b', 'i'),
    new RegExp('\\b' + PIC + '\\b[^.?!]{0,60}\\b' + DOC + '\\b[^.?!]{0,60}\\b(?:can(?:no|’|\')?t|cannot|could\\s+not|couldn[\'’]t)\\s+be\\s+(?:directly\\s+)?(?:extracted|pulled|taken|seen|used|placed|read|accessed)', 'i'),
    new RegExp('\\b' + DOC + '\\b[^.?!]{0,60}\\b' + PIC + '\\b[^.?!]{0,60}\\b(?:can(?:no|’|\')?t|cannot|could\\s+not|couldn[\'’]t)\\s+be\\s+(?:directly\\s+)?(?:extracted|pulled|taken|seen|used|placed|read|accessed)', 'i'),
    new RegExp('\\b' + NOT + '\\b[^.?!]{0,40}\\b(?:extract|pull|take)\\b[^.?!]{0,30}\\b' + PIC + '\\b', 'i')
  ] },
  /* "I can make one picture per message", "one new image at a time", "I make one new picture per message" */
  { code: 'several', re: [
    new RegExp('\\b(?:one|1|a\\s+single|only\\s+one)\\s+(?:new\\s+)?' + PIC + '\\s+(?:per|a|each|in\\s+a|in\\s+each|with\\s+each)\\s+(?:message|request|turn|reply|go)\\b', 'i'),
    new RegExp('\\b(?:one|1|a\\s+single)\\s+(?:new\\s+)?' + PIC + '\\s+at\\s+a\\s+time\\b', 'i'),
    /\b(?:one|1)\s+at\s+a\s+time\b/i,
    new RegExp('\\b' + NOT + '\\b[^.?!]{0,30}\\b(?:make|create|generate|do)\\b[^.?!]{0,20}\\b(?:several|multiple|more\\s+than\\s+one|many|all\\s+(?:the|of\\s+the)?)\\b[^.?!]{0,20}\\b' + PIC + '\\b', 'i')
  ] },
  /* "I can't edit an existing picture", "I'm unable to change that image" */
  { code: 'edit', re: [
    new RegExp('\\b' + NOT + '\\b[^.?!]{0,30}\\b(?:edit|retouch|modify|adjust|alter|touch\\s+up|change)\\b[^.?!]{0,30}\\b(?:an?\\s+|the\\s+|this\\s+|that\\s+|your\\s+)?(?:existing\\s+|current\\s+|same\\s+)?' + PIC + '\\b', 'i')
  ] },
  /* "I can't generate images", "I'm unable to create new pictures" */
  { code: 'make', re: [
    new RegExp('\\b' + NOT + '\\s+(?:make|create|generate|draw|produce|design)\\s+(?:(?:an?|any|new|more)\\s+)*' + PIC + '\\b', 'i'),
    new RegExp('\\b(?:image|picture|photo)\\s+generation\\s+(?:is\\s+)?(?:not\\s+(?:available|possible|supported)|unavailable)', 'i')
  ] },
  /* "I can't see the page", "I cannot view the screenshot" */
  { code: 'see-page', re: [
    new RegExp('\\b' + NOT + '\\s+(?:see|view|look\\s+at)\\s+(?:the\\s+|your\\s+)?(?:page|site|website|screenshots?|layout|banner)\\b', 'i')
  ] }
];
/* "the banner at the top looks empty", "the top of the page is very bare", "the banner looks plain right now: a pale,
   empty background", "an empty hero", "the banner has no picture" — said of the banner itself, never of a band or a
   space in it ("I removed the empty white band at the top of the hero picture") */
var BANNER = '(?:banner|hero(?:\\s+section)?|top\\s+of\\s+(?:the|your)\\s+(?:page|site)|header\\s+(?:area|section)|key\\s+visual)';
var BANNER_EMPTY_RE = new RegExp('\\b' + BANNER + '\\b[^.?!:]{0,40}\\b(?:is|looks?|seems?|feels?|appears?|remains?|stays?|reads?)\\b[^.?!:]{0,25}\\b(?:empty|bare|blank|plain)\\b' +
  '|\\b(?:empty|bare|blank|plain)\\s+' + BANNER + '\\b' +
  '|\\b' + BANNER + '\\b[^.?!]{0,40}\\b(?:has|shows|carries)\\s+no\\s+(?:picture|image|photo|visual|background)s?\\b', 'i');
/* a sentence that names a real limit (a real person, words or a logo, Content's photos, the web) states it, not a false
   one: "I can't make a picture of a real person", "I can't change the speakers' photos — they come from Content" */
var TRUE_LIMIT_RE = /\b(?:real|named|famous|person|people|faces?|words?|letters?|lettering|text|logos?|brands?|compan(?:y|ies)|signs?|web|websites?|internet|content|speakers?|partners?|sponsors?|headshots?|video|limit|today|tomorrow)\b/i;
/* sentences: split after . ! ? (and line breaks), each kept with its end */
function sentencesOf(text) {
  return String(text || '').match(/[^.!?\n]+(?:[.!?]+["”’)]*\s*|\n+|$)/g) || [];
}
function bannerClaim(s) { return BANNER_EMPTY_RE.test(s); }
function claimCheck(summary, switches, facts) {
  var text = String(summary == null ? '' : summary);
  facts = facts && typeof facts === 'object' ? facts : {};
  var codes = [], out = [];
  sentencesOf(text).forEach(function (s) {
    var hit = '';
    CLAIMS.some(function (c) {
      if (!can(c.code, switches)) return false;
      if ((c.code === 'make' || c.code === 'edit') && TRUE_LIMIT_RE.test(s)) return false;
      if (c.re.some(function (re) { return re.test(s); })) { hit = c.code; return true; }
      return false;
    });
    if (!hit && facts.bannerPicture === true && bannerClaim(s)) hit = 'banner-empty';
    if (!hit) { out.push(s); return; }
    if (codes.indexOf(hit) === -1) {
      codes.push(hit);
      var lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0];
      out.push(lead + TRUE_LINES[hit] + (tail || ' '));
    }
  });
  if (!codes.length) return { ok: true, summary: text };
  return { ok: false, codes: codes, code: codes[0], line: TRUE_LINES[codes[0]], summary: out.join('').replace(/[ \t]+$/, '').replace(/^\s+/, '') };
}

module.exports = { MANIFEST: MANIFEST, TRUE_LINES: TRUE_LINES, LIMIT_LINES: LIMIT_LINES, can: can, promptBlock: promptBlock, sentence: sentence, claimCheck: claimCheck, sentencesOf: sentencesOf };
