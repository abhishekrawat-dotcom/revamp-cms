/* The banner picture behind the share card of a site whose banner plays a video with no still picture (the owner,
   7 Nov 2026: "For video headers you have to generate a banner at your own"). Brand World Summit's hero is one: a
   video and nothing else, so share-card.js had nothing to draw the card's background from, and a link showed the
   site's overview photo instead.

   WHAT. ONE picture for the event, made by ETB2B AI with the dashboard's first hero picture's own rules
   (lib/ai-hero.js picturePrompt: gen-design.js's key visual for a hero — the event's FIELD, from its portal, and its
   PLACE, never its name; NO people in any form, NO words or letters, NO logos; 16:9), in the site's own tone: light
   or dark as its logo unit stands (the card puts that unit on it), in the site's theme and accent colours. It must
   pass the editor's picture check (lib/chat-picture.js checkPicture: people, words, logos): a picture found with
   any of them is made once more with the check's stronger line, and if that one is found wanting too — or cannot be
   checked — nothing is used. The share card is then made from it exactly as from a banner's own picture
   (share-card.js: the hero's veil over it, the logo unit centred, never boxed, recoloured or cropped). The site
   keeps its video: this picture is used for the share card only, and the owner's own share picture still wins.

   ONCE. It is made once and kept on the event; it is never made again on a serve or a publish once it is there.
   It is made again only while it is missing: after a picture the check refused (a day later), or after the model
   failed to answer (ten minutes later). Bounded for good: at most MAX_ROUNDS makings whose pictures were not used
   (refused, or abandoned by a server that stopped half way — its picture may have been paid for), and at most
   MAX_CLAIMS makings in all, for one event, ever; each making is one picture, or two when the first is refused.
   The console then says plainly that there is none, and why.

   THE RECORD events/<id>.shareStill, written straight to that one field (never updatedAt or the site's version, no
   history line: like the card it is not an edit, and no approval lists it):
     { state: 'making', at, rounds, claims }                            being made (a mark older than MAKING_TTL_MS
                                                                       is somebody's that died, and is taken over;
                                                                       that counts as a round)
     { state: 'ready', url, path, type, subject, tries, checks, rounds, at, v }    the picture
     { state: 'held', why, found, subject, tries, checks, rounds, at, v }   made, but not used: why 'twice' (the
                                                                       second had it too), 'time' (no time left for a
                                                                       second), 'failed' (the second could not be
                                                                       made), 'unchecked' (it could not be checked)
                                                                       or 'stopped' (servers stopped half way)
     { state: 'failed', reason, rounds, at, v }                        the model made nothing (its failure code)
   Every record carries rounds (makings not used) and claims (makings in all); a held or failed one says last: true
   when nothing will be tried again for this event. Under QA_SHARE_KEEP_HELD=1 (the QA harness only) a held record
   also names the refused pictures, kept privately (kept: [paths]) so a person can look at what the check found.
   STORED private (only the server reads it, to draw the card): events/<id>/share-card/still-<base36 time>.<ext>.
   What the model used goes into the event's aiUsage (routes 'share-still' and 'share-still-check').

   WHEN (share-card.js stillThenCard): at a publish, inside the card's own bounded wait (never holding the publish
   up); and for a site already live, in the background when its page is served — as the card itself is.
   One picture at a time per server instance; at most MAX_WAITING waiting behind it.

   share-card.js wires this module (wire) with api.js's usage recorder; loading it reads nothing and writes nothing.
   No network in its tests: share-still.test.js stubs the picture model and the check (_test.setModels). */
'use strict';
const gemini = require('./gemini');
const chatPicture = require('./chat-picture');
const aiHero = require('./ai-hero');

var STILL_VERSION = 1;
var FOLDER = 'share-card';
var MAKING_TTL_MS = 5 * 60 * 1000;          // longer than one making can take (two pictures and their checks)
var TIMEOUT_MS = 60000;                      // one call to the picture model, as the hero picture gives it
var DEADLINE_MS = chatPicture.DEADLINE_MS;   // room for two pictures and their checks
var RETRY_MS = { failed: 10 * 60 * 1000, held: 24 * 60 * 60 * 1000 };
var MAX_ROUNDS = 2;                          // makings whose pictures were not used, for one event, ever
var MAX_CLAIMS = 5;                          // makings in all, for one event, ever (a model that keeps failing)
var MAX_WAITING = 3;
var PEOPLE_RULE = aiHero.PEOPLE_RULE;        // the banner shows nobody (chat-picture.js peopleRule for the hero)

var H = {};
function wire(helpers) { H = helpers || {}; }
/* the picture model and the check, replaced by a test */
var models = { image: function (p, o) { return gemini.callGeminiImage(p, o); }, check: function (b, t, r, o) { return chatPicture.checkPicture(b, t, r, o); } };
var clock = { now: function () { return Date.now(); } };

/* the QA harness talks to the production project: only qa- events get a picture there (share-card.js's own guard) */
function allowed(eventId) {
  return process.env.QA_SHARE_ONLY_QA !== '1' || /^qa-[a-z0-9-]+$/.test(String(eventId || ''));
}
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function recordOf(event) { return event && isObj(event.shareStill) ? event.shareStill : null; }
function live(ev) { return !!ev && !!ev.createdAt && !ev.deletedAt && !ev.discardingAt; }

/* the picture's address when the event has one ('' otherwise) */
function readyUrl(event) {
  var r = recordOf(event);
  return r && r.state === 'ready' && typeof r.url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(r.url) ? r.url : '';
}
/* whether a making may start now, by the record alone */
function mayMake(rec, now) {
  if (!rec) return true;
  var at = Date.parse(rec.at) || 0;
  if (rec.state === 'ready') return false;
  if (rec.state === 'making') return now - at >= MAKING_TTL_MS;
  if ((+rec.rounds || 0) >= MAX_ROUNDS || (+rec.claims || 0) >= MAX_CLAIMS) return false;
  if (rec.state === 'held') return now - at >= RETRY_MS.held;
  if (rec.state === 'failed') return now - at >= RETRY_MS.failed;
  return true;
}

/* What the picture is asked to be. want: share-card.js's plan for it ({ tone: 'light' | 'dark', colours: { theme,
   accent } }): light or dark as the logo unit that goes on it stands, in the site's own colours (else the event's
   theme, as the hero picture takes it). */
function promptFor(event, want) {
  want = want || {};
  var design = aiHero.designOf(event);
  if (want.tone === 'light' || want.tone === 'dark') design.mode = want.tone;
  if (want.colours && want.colours.theme) design.themeColor = want.colours.theme;
  if (want.colours && want.colours.accent) design.accentColor = want.colours.accent;
  return aiHero.picturePrompt(event, '', false, design) + ' ' + NO_FIGURE_FORMS;
}
/* What the check refused in this picture's first real makings (QA, 11 Nov 2026: a marketing event in Chennai, both
   pictures "people"): a field's scene of studios and "product forms" draws mannequins and dress forms, and a city's
   temple towers come with rows of statues — the check counts a mannequin or a statue of a person as a person. The
   picture only stands behind a logo unit, so it is asked for without any of them. */
var NO_FIGURE_FORMS = 'STRICT, for this picture: no mannequins, dress forms, dolls, statues, idols, busts, or sculpted or painted figures of any kind — not on a temple, a tower, a gateway or a monument either; no camera crew and no audience. The field shows through its objects, light and materials alone, and the place through its skyline, shoreline and the outlines of its buildings.';

/* one transaction: -> { how: 'go' | 'ready' | 'wait' | 'gone', rec } */
function claim(fb, eventId, now) {
  var ref = fb.db.collection('events').doc(eventId), out = { how: 'go', rec: null };
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var ev = snap.exists ? snap.data() || {} : null;
      if (!live(ev)) { out.how = 'gone'; return; }
      var rec = recordOf(ev);
      out.rec = rec;
      if (rec && rec.state === 'ready' && readyUrl(ev)) { out.how = 'ready'; return; }
      if (!mayMake(rec, now)) { out.how = 'wait'; return; }
      /* a making mark left by a server that stopped half way may have cost a picture: it counts as a round */
      var rounds = rec ? (+rec.rounds || 0) + (rec.state === 'making' ? 1 : 0) : 0;
      if (rounds >= MAX_ROUNDS) { out.how = 'wait'; tx.update(ref, { shareStill: Object.assign({}, rec, { state: 'held', why: 'stopped', found: [], rounds: rounds, last: true, at: new Date(now).toISOString() }) }); return; }
      out.rounds = rounds; out.claims = (rec ? (+rec.claims || 0) : 0) + 1;
      tx.update(ref, { shareStill: { state: 'making', at: new Date(now).toISOString(), rounds: rounds, claims: out.claims } });
    });
  }).then(function () { return out; });
}
/* the record written (the whole field) -> 'written' | 'kept' (a picture is already there: it stays) | 'gone' */
function record(fb, eventId, row) {
  var ref = fb.db.collection('events').doc(eventId), how = 'written';
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var ev = snap.exists ? snap.data() || {} : null;
      if (!live(ev)) { how = 'gone'; return; }
      if (readyUrl(ev)) { how = 'kept'; return; }
      tx.update(ref, { shareStill: row });
    });
  }).then(function () { return how; });
}

/* one picture at a time per instance: each is a model call and a decoded picture held in memory */
var queue = Promise.resolve(), queued = 0;
function serially(job) {
  queued++;
  var run = queue.then(job, job);
  queue = run.then(function () { queued--; }, function () { queued--; });
  return run;
}
var INFLIGHT = new Map();

/* The picture for this event: made now when it is missing and may be made, else what the record has.
   -> Promise<record | null>, never rejects. opts.known: the record as the caller has just read it with the event —
   when it says a picture is being made, or may not be made yet, nothing is asked of the database at all (a busy
   page is served many times a minute). */
function ensure(fb, eventId, event, want, opts) {
  opts = opts || {};
  try {
    if (!allowed(eventId) || !fb || !fb.db || !fb.bucket) return Promise.resolve(null);
    var known = isObj(opts.known) ? opts.known : null;
    if (known && known.state === 'ready' && readyUrl({ shareStill: known })) return Promise.resolve(known);
    var now = clock.now();
    if (known && !mayMake(known, now)) return Promise.resolve(null);
    var mine = INFLIGHT.get(eventId);
    if (mine) return mine;
    if (queued >= MAX_WAITING) return Promise.resolve(null);
    var p = serially(function () { return makeOne(fb, eventId, event, want); }).then(null, function (err) {
      console.error('share-still: the picture of ' + eventId + ' could not be made or recorded — ' + (err && err.stack || err));
      return null;
    }).then(function (rec) {
      if (INFLIGHT.get(eventId) === p) INFLIGHT.delete(eventId);
      return rec;
    });
    INFLIGHT.set(eventId, p);
    return p;
  } catch (e) {
    console.error('share-still: ' + eventId + ' — ' + (e && e.stack || e));
    return Promise.resolve(null);
  }
}

function makeOne(fb, eventId, event, want) {
  var started = clock.now(), deadlineAt = started + DEADLINE_MS;
  var subject = aiHero.subjectOf(event || {});
  var looks = [], tries = 0, rounds = 0, claims = 1, made = [];
  var recorder = typeof H.aiUsageRecorder === 'function' ? H.aiUsageRecorder : null;
  var useOf = safe(recorder && recorder(fb, eventId, 'share-still'));
  var checkUse = safe(recorder && recorder(fb, eventId, 'share-still-check'));
  return claim(fb, eventId, started).then(function (c) {
    if (c.how === 'ready') return c.rec;
    if (c.how !== 'go') return null;
    rounds = c.rounds || 0; claims = c.claims || 1;
    var prompt = promptFor(event || {}, want);
    return picture(prompt, deadlineAt).then(function (first) {
      if (first.ai) {
        return finish({ state: 'failed', reason: String(first.ai.code || 'ai-unavailable').slice(0, 60), rounds: rounds, claims: claims, at: iso(), v: STILL_VERSION });
      }
      return look(first).then(function (flags) {
        if (!flags.length) return store(first);
        /* the check could not look (its providers are down): a second picture could not be checked either */
        if (flags[0] === 'unchecked') return hold([], 'unchecked');
        if (deadlineAt - clock.now() < chatPicture.RETRY_NEEDS_MS) return hold(flags, 'time');
        return picture(prompt + ' ' + chatPicture.againLine(flags), deadlineAt - chatPicture.CHECK_RESERVE_MS).then(function (second) {
          if (second.ai) return hold(flags, 'failed');
          return look(second).then(function (again) {
            return !again.length ? store(second) : again[0] === 'unchecked' ? hold([], 'unchecked') : hold(again, 'twice');
          });
        });
      });
    });
  });

  function iso() { return new Date(clock.now()).toISOString(); }
  /* one call to the picture model, wide as a banner -> Promise<{ bytes, type } | { ai }> */
  function picture(text, until) {
    var call;
    try {
      call = Promise.resolve(models.image(text, { route: 'share-still', eventId: eventId, user: 'share-card', timeoutMs: TIMEOUT_MS, deadlineAt: until, aspectRatio: chatPicture.WIDE_ASPECT }));
    } catch (err) { call = Promise.reject(err); }
    return call.then(function (r) {
      if (r && r.usage) useOf(r.usage);
      if (!r || r.error || !r.base64) return { ai: r && (r.code || r.error) ? r : gemini.failure('ai-bad-output') };
      tries++;
      var bytes = Buffer.from(String(r.base64), 'base64');
      var type = chatPicture.sniff(bytes);
      if (!type) { console.error('share-still: the picture model answered ' + bytes.length + ' bytes that are not a PNG, JPEG or WebP'); return { ai: gemini.failure('ai-bad-output') }; }
      made.push({ bytes: bytes, type: type });
      return { bytes: bytes, type: type };
    }, function (err) {
      console.error('share-still: the picture call for ' + eventId + ' failed — ' + (err && err.message));
      return { ai: gemini.failure('ai-unavailable') };
    });
  }
  /* the editor's check -> what a banner may not have; ['unchecked'] when it could not look (then nothing is used) */
  function look(pic) {
    return Promise.resolve().then(function () {
      return models.check(pic.bytes, pic.type, PEOPLE_RULE, { eventId: eventId, deadlineAt: deadlineAt, record: checkUse });
    }).then(function (found) {
      looks.push(found ? { people: !!found.people, text: !!found.text, logos: !!found.logos } : null);
      return found ? chatPicture.refusedFor(found, PEOPLE_RULE) : ['unchecked'];
    }, function () { looks.push(null); return ['unchecked']; });
  }
  function hold(flags, why) {
    var row = { state: 'held', why: why, found: flags, subject: subject, tries: tries, checks: looks, rounds: rounds + 1, claims: claims, at: iso(), v: STILL_VERSION };
    /* QA_SHARE_KEEP_HELD=1 (the QA harness only): the refused pictures are kept, privately, so a person can see what
       the check found; nothing else reads them, and they go with the event */
    if (process.env.QA_SHARE_KEEP_HELD !== '1' || !made.length) return finish(row);
    row.kept = [];
    return Promise.all(made.map(function (pic, n) {
      var path = 'events/' + eventId + '/' + FOLDER + '/held-' + clock.now().toString(36) + '-' + n + '.' + (pic.type === 'image/jpeg' ? 'jpg' : pic.type === 'image/webp' ? 'webp' : 'png');
      return fb.bucket.file(path).save(pic.bytes, { resumable: false, metadata: { contentType: pic.type } }).then(function () { row.kept.push(path); }, function () {});
    })).then(function () { return finish(row); });
  }
  /* a making that left no picture; last: nothing will be tried again for this event (the console says so) */
  function finish(row) {
    row.last = (+row.rounds || 0) >= MAX_ROUNDS || (+row.claims || 0) >= MAX_CLAIMS;
    return record(fb, eventId, row).then(function () { return null; });
  }
  function store(pic) {
    var ext = pic.type === 'image/jpeg' ? 'jpg' : pic.type === 'image/webp' ? 'webp' : 'png';
    var path = 'events/' + eventId + '/' + FOLDER + '/still-' + clock.now().toString(36) + '.' + ext;
    var url = 'https://storage.googleapis.com/' + fb.bucket.name + '/' + path;
    var file = fb.bucket.file(path);
    return file.save(pic.bytes, { resumable: false, metadata: { contentType: pic.type, cacheControl: 'private, max-age=31536000' } }).then(function () {
      var row = { state: 'ready', url: url, path: path, type: pic.type, subject: subject, tries: tries, checks: looks, rounds: rounds, claims: claims, at: iso(), v: STILL_VERSION };
      return record(fb, eventId, row).then(function (how) {
        if (how === 'written') return row;
        /* the event is gone, or another instance's picture got there first: this one is not left behind */
        return file.delete().catch(function () {}).then(function () { return null; });
      });
    }, function (err) {
      console.error('share-still: the picture of ' + eventId + ' was made but not stored — ' + (err && err.message));
      return finish({ state: 'failed', reason: 'not-stored', rounds: rounds, claims: claims, at: iso(), v: STILL_VERSION });
    });
  }
}
/* a usage recorder that can never be why a picture fails */
function safe(rec) {
  return function (usage) {
    if (!rec || !usage) return;
    try { rec(usage); } catch (e) { console.error('share-still: usage not recorded — ' + (e && e.message)); }
  };
}

module.exports = { wire: wire, ensure: ensure, readyUrl: readyUrl, mayMake: mayMake, promptFor: promptFor, STILL_VERSION: STILL_VERSION, MAX_ROUNDS: MAX_ROUNDS, MAX_CLAIMS: MAX_CLAIMS };
module.exports._test = {
  clock: clock, models: models, INFLIGHT: INFLIGHT, RETRY_MS: RETRY_MS, MAKING_TTL_MS: MAKING_TTL_MS, claim: claim, record: record,
  setModels: function (m) { if (m && m.image) models.image = m.image; if (m && m.check) models.check = m.check; }
};
