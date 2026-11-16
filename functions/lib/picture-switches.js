/* lib/picture-switches.js — the switches of ETB2B AI's advanced picture-making (plan of 16 Nov 2026), turned on and
   off without a deploy: one Firestore document, config/aiPictures (PICTURE_SWITCHES_DOC for QA, as ACCESS_CONFIG_DOC
   is for access), read at most once a minute per server.

     { plan:     true,   // W1: several pictures per message, the owner's quote checked, a yes runs the stored plan
       brief:    true,   // W2: the Director writes a brief for the picture model (else today's promptFor)
       critic:   true,   // W2: the vision Critic looks at each picture (else today's people/words/logos check)
       repair:   true,   // W2: what the Critic finds is fixed by editing the picture (needs critic; else a remake)
       edit:     true,   // W3: "warmer", "remove the people", "wider" change the picture itself
       refs:     true,   // W3: the picture model is shown up to 3 reference pictures
       variants: false,  // "Show 3 options": OFF by default (owner, 16 Nov 2026); on, only when asked
       exclude:  ['ai-hero'] }   // callers kept on today's path whatever the rest says (a caller that regressed)

   A missing document, a missing field, or one that cannot be read means OFF: every part then behaves as it did
   before the upgrade. Nothing here writes the document; the owner (or QA, on its own document) does.

     NAMES, CALLERS, OFF
     read(fb, opts)          -> Promise<switches>   never rejects; opts.fresh skips the minute's cache
     on(sw, name, caller)    -> boolean             the switch, for that caller ('chat' when none is named)
     normalise(raw)          -> switches            what is stored, made safe to read
     forget()                -> the cache emptied (tests) */
'use strict';

var NAMES = ['plan', 'brief', 'critic', 'repair', 'edit', 'refs', 'variants'];
/* the parts of the product that make pictures through lib/chat-picture.js's runner or its check */
var CALLERS = ['chat', 'promo', 'ai-hero', 'share-still', 'phone-banner', 'create'];
var CACHE_MS = 60000;

function off() { var o = { exclude: [], stored: false }; NAMES.forEach(function (n) { o[n] = false; }); return o; }
var OFF = Object.freeze(off());

function docPath() { return String(process.env.PICTURE_SWITCHES_DOC || 'config/aiPictures'); }
function docRef(fb) { var p = docPath().split('/'); return fb.db.collection(p[0]).doc(p[1]); }

function normalise(raw) {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  var out = off();
  NAMES.forEach(function (n) { out[n] = raw[n] === true; });
  /* a repair is an edit of the picture the Critic looked at: without the Critic there is nothing to repair */
  if (!out.critic) out.repair = false;
  out.exclude = (Array.isArray(raw.exclude) ? raw.exclude : []).map(String).filter(function (c) { return CALLERS.indexOf(c) !== -1; });
  out.stored = raw.stored === true;
  return out;
}

/* kept per database handle (fb.db): a test's fake database never sees another's switches */
var cache = { db: null, sw: null, at: 0 };
function forget() { cache = { db: null, sw: null, at: 0 }; }
function read(fb, opts) {
  if (!fb || !fb.db) return Promise.resolve(off());
  var now = Date.now();
  if (cache.db !== fb.db) cache = { db: fb.db, sw: null, at: 0 };
  if (!(opts && opts.fresh) && cache.sw && now - cache.at < CACHE_MS) return Promise.resolve(cache.sw);
  return Promise.resolve().then(function () { return docRef(fb).get(); }).then(function (snap) {
    var sw = snap && snap.exists ? Object.assign(normalise(snap.data()), { stored: true }) : off();
    cache = { db: fb.db, sw: sw, at: now };
    return sw;
  }, function (err) {
    /* unreadable: off, and not kept, so the next request tries again */
    console.error('picture-switches: ' + docPath() + ' could not be read — ' + (err && err.message) + '; every switch is off');
    return off();
  });
}
function on(sw, name, caller) {
  if (!sw || typeof sw !== 'object' || NAMES.indexOf(name) === -1 || sw[name] !== true) return false;
  if (name === 'repair' && sw.critic !== true) return false;
  var c = caller || 'chat';
  return !(Array.isArray(sw.exclude) && sw.exclude.indexOf(c) !== -1);
}

module.exports = { NAMES: NAMES, CALLERS: CALLERS, OFF: OFF, CACHE_MS: CACHE_MS, read: read, on: on, normalise: normalise, forget: forget, docPath: docPath };
