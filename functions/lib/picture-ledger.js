/* lib/picture-ledger.js — W4 "remembers" (builder A): the last LEDGER_MAX pictures of a person's conversation on an
   event — placed, undone, held, failed or replaced, with what the owner said about each — kept at
   events/<id>/aiChats/<uid>.pictureLedger, so "not like that one", "another one, no people like before" and "the
   jungle picture I attached earlier" are understood after a reload. Addresses and short subjects only, never a
   picture. Written by the chat route (lib/api-chat.js) after its answer has gone: what became of the newest turn's
   pictures, and the owner's words about the last one (the chat model's `lastPictureFeedback`).

     LEDGER_MAX, STATES
     read(fb, eventId, uid)            -> Promise<[entry]>  never rejects; [] = none
                                          entry: { key, job, turnId, sectionId, sectionName, url, subjectShort, state,
                                                   feedback, noPeople, refs, at }
     clean(entries)                    -> the entries as stored: each checked, one per key (the newest kept), the last
                                          LEDGER_MAX by time
     fromTurn(turn, turnId)            -> the entries one stored turn makes (its jobs made, held or failed; placed or undone
                                          by the turn's status) — [] for a turn with no picture made
     record(fb, eventId, uid, entries, feedback) -> Promise<[entry]>  never rejects: entries merged by key in one
                                          transaction; feedback (the owner's words about the last picture) goes on the
                                          newest entry
     promptLines(entries)              -> the lines the chat model (and the Director) get: '' with none */
'use strict';

var pictureJob = require('./picture-job');

var LEDGER_MAX = 20;
var STATES = ['placed', 'undone', 'held', 'failed', 'replaced', 'made'];

function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function oneLine(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function httpsUrl(v) { v = String(v || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(v) && v.length <= 1000 ? v : ''; }
function short(s) {
  var w = oneLine(s, 400).replace(/[\s.!?;,]+$/, '').split(/\s+/);
  return w.length > 14 ? w.slice(0, 14).join(' ') + '…' : w.join(' ');
}
var NO_PEOPLE_RE = /\b(?:no|without|minus|zero|free\s+of|need\s+not|no\s+need\s+(?:to\s+use|for))\s+(?:any\s+)?(?:people|persons|humans|figures|crowds?|men|women|faces|one|anyone|body)\b|\b(?:nobody|no-one|deserted)\b|\bno\s+need\s+to\s+use\s+men\b/i;

function entryOf(e) {
  e = obj(e);
  if (!e) return null;
  var turnId = oneLine(e.turnId, 40).replace(/[^A-Za-z0-9]/g, ''), job = parseInt(e.job, 10);
  if (!turnId || !(job >= 0 && job < pictureJob.MAX_JOBS)) return null;
  var state = STATES.indexOf(e.state) !== -1 ? e.state : 'made';
  var feedback = oneLine(e.feedback, 120);
  return { key: turnId + ':' + job, job: job, turnId: turnId, sectionId: oneLine(e.sectionId, 120), sectionName: oneLine(e.sectionName, 60),
    url: httpsUrl(e.url), subjectShort: short(e.subjectShort || e.subject), state: state, feedback: feedback,
    noPeople: e.noPeople === true || NO_PEOPLE_RE.test(feedback),
    refs: (Array.isArray(e.refs) ? e.refs : []).map(function (r) { r = obj(r); return r && httpsUrl(r.url) ? { kind: oneLine(r.kind, 20), url: httpsUrl(r.url), use: oneLine(r.use, 10) } : null; }).filter(Boolean).slice(0, 3),
    at: oneLine(e.at, 40) };
}
function clean(entries) {
  var byKey = {}, order = [];
  (Array.isArray(entries) ? entries : []).forEach(function (raw) {
    var e = entryOf(raw);
    if (!e) return;
    if (!byKey[e.key]) order.push(e.key);
    else e.feedback = e.feedback || byKey[e.key].feedback;
    if (byKey[e.key] && byKey[e.key].noPeople) e.noPeople = true;
    byKey[e.key] = e;
  });
  return order.map(function (k) { return byKey[k]; }).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }).slice(-LEDGER_MAX);
}

/* the turn's pictures as the ledger keeps them: made (or held, or failed) and, by what the editor reported, placed or
   undone. A turn still being applied keeps them as made. */
function fromTurn(turn, turnId) {
  turn = obj(turn);
  if (!turn) return [];
  var id = String(turnId || turn.id || '');
  var status = String(turn.status || '');
  return pictureJob.jobsOf(turn).map(function (job, k) {
    job = obj(job);
    if (!job || (job.state !== 'made' && job.state !== 'failed')) return null;
    var state = job.state === 'failed' ? 'failed' : job.held === true ? 'held'
      : job.placed === 'replaced' ? 'replaced' : job.placed === 'undone' || status === 'undone' ? 'undone'
      : job.placed === 'placed' || status === 'applied' ? 'placed' : 'made';
    var k0 = typeof job.k === 'number' ? job.k : k;
    return entryOf({ turnId: id, job: k0, sectionId: job.sectionId, sectionName: job.sectionName, url: job.url, subject: job.subject,
      state: state, noPeople: job.peopleRule === 'none' && /\b(?:no|without)\b/i.test(String(job.ownerQuote || '')), refs: job.refs,
      at: job.madeAt || job.failedAt || turn.updatedAt || turn.at || '' });
  }).filter(Boolean);
}

function chatRef(fb, eventId, uid) {
  return fb.db.collection('events').doc(String(eventId)).collection('aiChats').doc(String(uid));
}
function read(fb, eventId, uid) {
  if (!fb || !fb.db || !eventId || !uid) return Promise.resolve([]);
  return Promise.resolve().then(function () { return chatRef(fb, eventId, uid).get(); }).then(function (snap) {
    var d = snap && snap.exists ? snap.data() || {} : {};
    return clean(d.pictureLedger);
  }).catch(function (err) {
    console.error('picture-ledger: the pictures of the conversation on ' + eventId + ' could not be read — ' + (err && err.message));
    return [];
  });
}
function record(fb, eventId, uid, entries, feedback) {
  var add = clean(entries), said = oneLine(feedback, 120);
  if (!fb || !fb.db || !eventId || !uid || (!add.length && !said)) return Promise.resolve([]);
  var ref;
  return Promise.resolve().then(function () { ref = chatRef(fb, eventId, uid); return fb.db.runTransaction(transact); }).catch(function (err) {
    console.error('picture-ledger: the pictures of the conversation on ' + eventId + ' were not kept — ' + (err && err.message));
    return [];
  });
  function transact(tx) {
    return tx.get(ref).then(function (snap) {
      var had = snap && snap.exists ? clean((snap.data() || {}).pictureLedger) : [];
      var all = clean(had.concat(add));
      if (said && all.length) {
        var last = all[all.length - 1];
        last.feedback = said;
        if (NO_PEOPLE_RE.test(said)) last.noPeople = true;
      }
      if (!all.length) return [];
      tx.set(ref, { pictureLedger: all }, { merge: true });
      return all;
    });
  }
}

var STATE_WORDS = { placed: 'placed', undone: 'placed, then undone by the owner', held: 'made but kept off the page (it did not pass its check)',
  failed: 'could not be made', replaced: 'placed, then replaced', made: 'made' };
function promptLines(entries) {
  var list = clean(entries);
  if (!list.length) return '';
  var lines = ['PICTURES MADE IN THIS CONVERSATION (newest last; what the owner said about each counts for the next picture of the same place — "another one" keeps it):'];
  list.forEach(function (e, i) {
    lines.push((i + 1) + '. “' + (e.sectionName || e.sectionId || 'a section') + '”: ' + (e.subjectShort || 'a picture') + ' — ' + STATE_WORDS[e.state] +
      (e.feedback ? '; the owner said: “' + e.feedback + '”' : '') + (e.noPeople ? '; NO PEOPLE in the next one for this place' : ''));
  });
  return lines.join('\n');
}

module.exports = { LEDGER_MAX: LEDGER_MAX, STATES: STATES, read: read, record: record, clean: clean, fromTurn: fromTurn, promptLines: promptLines, entryOf: entryOf, NO_PEOPLE_RE: NO_PEOPLE_RE };
