/* lib/picture-ledger.js — W4 "remembers" (builder A): the last LEDGER_MAX pictures of a person's conversation on an
   event — placed, undone, held or replaced, with what the owner said about each — kept at
   events/<id>/aiChats/<uid>.pictureLedger, so "not like that one" and "the jungle picture I attached earlier" are
   understood after a reload. Addresses and short subjects only, never a picture. STEP 0 STUB: nothing is kept, and
   the ledger reads as empty.

     read(fb, eventId, uid)            -> Promise<[entry]>  never rejects; [] = none
                                          entry: { job, turnId, sectionId, url, subjectShort, state: 'placed'|'undone'
                                                   |'held'|'replaced', feedback, refs, at }
     record(fb, eventId, uid, entries) -> Promise<void>     never rejects (builder A)
     promptLines(entries)              -> '' (builder A: the lines the chat model and the Director get) */
'use strict';

var LEDGER_MAX = 20;
function read(fb, eventId, uid) { return Promise.resolve([]); }
function record(fb, eventId, uid, entries) { return Promise.resolve(); }
function promptLines(entries) { return ''; }

module.exports = { LEDGER_MAX: LEDGER_MAX, read: read, record: record, promptLines: promptLines };
