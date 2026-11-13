/* node tools/clean-ghosts.js [--include-qa] [--json <file>]                          DRY RUN: reads only
   node tools/clean-ghosts.js --apply (--event <eventId> | --all) [--include-qa]       removes what the dry run lists

   What the code before the core (and the October audit itself) left in production (launch check BE-070): writes
   under an event nobody had created used to succeed. A PATCH, a publish, a stage or an AI step on a mistyped or
   abandoned address made an events/<id> document without `createdAt` — a "shell", which no list shows and no route
   can open (lib/api.js eventStateOf) — or wrote records under an id that has no document at all; a PATCH of a record
   deleted in another tab brought back a nameless "ghost" of it. Since the core none of this can happen (BE-021,
   subcollectionRoutes), but what was made before is still stored. Nothing reads it; it only takes space and holds
   addresses. This script finds it and, with --apply, removes it.

   WHAT IT LOOKS FOR
     events/<id> as a shell             the document exists, with no createdAt and no deletedAt
     events/<id> with no document       records, files or a history under an id that has no event document
     events/<id> with discardingAt      Create Event's discard of an abandoned draft that stopped half-way (it is
                                        already marked deleted; finishing it is what the same request would do)
     a ghost record                     under a real (live or deleted) event: a speaker, session, sponsor, picture,
                                        FAQ, contact or one of their groups with no createdAt and nothing in it but
                                        housekeeping (order, weight, status, its group, updatedAt / updatedBy)
   Never touched: events/import-<id> (a Lovable import's record, lib/http.js LEGACY_IMPORT_DOCS), qa- events unless
   --include-qa, and any real event (one with createdAt) or its content beyond such ghost records.

   LISTED FOR A PERSON, NEVER REMOVED: a ghost event that has registrations (someone signed up there), one changed
   in the last 7 days, one whose files a real event still names (its document, its saved site or its live page
   points into events/<ghost id>/ — a picture made there before the event had its own address), and a nameless
   record that still holds something of its own (a photo, a bio, an answer).

   DRY RUN (the default) writes nothing: each ghost with what is under it (its records by collection, its files and
   their size), then totals. --json <file> also writes that list.
   --apply removes each ghost event — its document, everything under it (Firestore recursiveDelete) and its files
   (events/<id>/ in Storage) — and each ghost record, after reading it again first: anything that has become an event
   or a real record meanwhile, or has registrations now, is left alone and said.
     --event <id>   that event id only (with --apply: required, or --all)
     --all          everything the dry run lists

   Credentials: the main checkout's tools/.env.local (FIREBASE_* as for tools/serve.js), never printed. Never shipped:
   nothing in the server or the pages loads this file. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const LIB = path.join(REPO, 'functions', 'lib');

/* the Content records (lib/api-events.js CONTENT_COLLECTIONS) and what names one */
var CONTENT = ['speakers', 'speakerGroups', 'sessions', 'agendaGroups', 'partners', 'partnerTiers', 'gallery', 'faqs', 'contacts'];
var NAMING = ['name', 'title', 'question', 'imageUrl', 'label'];
/* what a record carries for the console's own bookkeeping: a record with only these holds nothing of its own */
var HOUSEKEEPING = ['order', 'weight', 'status', 'groupId', 'tierId', 'colour', 'updatedAt', 'updatedBy', 'eventId', 'id'];
var RECENT_MS = 7 * 24 * 60 * 60 * 1000;
var RECORD_PATH = /^events\/([^/]+)\/([^/]+)\/([^/]+)$/;

function isQa(id) { return /^qa-/.test(id); }
function isImport(id) { return /^import-/.test(id); }
function filled(v) { return v != null && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length); }
function timeOf(v) {
  if (!v) return 0;
  if (typeof v === 'string') return Date.parse(v) || 0;
  if (typeof v.toDate === 'function') { try { return v.toDate().getTime(); } catch (e) { return 0; } }
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
}

/* what kind of ghost an events/<id> document is, or '' for a real event (live or deleted) */
function eventGhostKind(exists, d) {
  if (!exists) return 'no document';
  d = d || {};
  if (d.discardingAt) return 'interrupted discard';
  if (!d.createdAt && !d.deletedAt) return 'shell';
  return '';
}
/* a record: 'ghost' (nothing of its own), 'nameless' (no name, but something else: for a person) or '' */
function recordGhostKind(d) {
  d = d || {};
  if (d.createdAt) return '';
  if (NAMING.some(function (k) { return filled(d[k]); })) return '';
  var own = Object.keys(d).filter(function (k) { return HOUSEKEEPING.indexOf(k) === -1 && filled(d[k]); });
  return own.length ? 'nameless' : 'ghost';
}

function countOf(col) {
  if (typeof col.count === 'function') return col.count().get().then(function (s) { return s.data().count; });
  return col.get().then(function (s) { return s.size; });
}
/* what is under one ghost event: its records by collection, its files */
function contentsOf(fb, id) {
  var ref = fb.db.collection('events').doc(id);
  var cols = typeof ref.listCollections === 'function' ? ref.listCollections() : Promise.resolve([]);
  return Promise.all([cols, fb.bucket.getFiles({ prefix: 'events/' + id + '/' })]).then(function (r) {
    var files = r[1][0] || [];
    var bytes = files.reduce(function (n, f) { return n + (+((f.metadata && f.metadata.size) || 0)); }, 0);
    return Promise.all(r[0].map(function (c) { return countOf(c).then(function (n) { return { col: c.id, n: n }; }); })).then(function (counts) {
      var records = {};
      counts.forEach(function (c) { if (c.n) records[c.col] = c.n; });
      return { records: records, files: files.length, bytes: bytes };
    });
  });
}

/* Which real events still name a ghost's files: its document, its saved site and its live page, searched for
   events/<ghost id>/ (and its %2F form, as a Storage download address writes it). -> Promise<{ ghostId: [where] }> */
function readText(fb, p) {
  return fb.bucket.file(p).download().then(function (r) { return String(r[0] || ''); }, function (e) {
    if (e && (e.code === 404 || e.code === '404')) return '';
    throw e;
  });
}
function referencesTo(fb, ghosts, realIds) {
  var needles = ghosts.filter(function (g) { return g.files > 0; }).map(function (g) {
    return { id: g.eventId, plain: 'events/' + g.eventId + '/', encoded: 'events%2F' + g.eventId + '%2F' };
  });
  var found = {};
  if (!needles.length) return Promise.resolve(found);
  function look(text, where) {
    needles.forEach(function (n) {
      if (text.indexOf(n.plain) !== -1 || text.indexOf(n.encoded) !== -1) (found[n.id] = found[n.id] || []).push(where);
    });
  }
  return realIds.reduce(function (p, id) {
    return p.then(function () {
      return Promise.all([
        fb.db.collection('events').doc(id).get().then(function (s) { return s.exists ? JSON.stringify(s.data()) : ''; }),
        readText(fb, 'events/' + id + '/site/page.html'),
        readText(fb, 'events/' + id + '/published/index.html')
      ]).then(function (t) { look(t[0], id + ' (event)'); look(t[1], id + ' (saved site)'); look(t[2], id + ' (live page)'); });
    });
  }, Promise.resolve()).then(function () { return found; });
}

/* -> Promise<{ events: [ghost event], records: [ghost record], skipped: { imports, qa }, read: { events, records } }>
   o: { eventId, includeQa, now } */
function scan(fb, o) {
  o = o || {};
  var now = o.now || Date.now();
  var col = fb.db.collection('events');
  var listed = o.eventId ? Promise.resolve([col.doc(o.eventId)])
    : (typeof col.listDocuments === 'function' ? col.listDocuments() : col.get().then(function (s) { return s.docs.map(function (d) { return d.ref; }); }));
  var skipped = { imports: 0, qa: 0 }, read = { events: 0, records: 0 };
  var real = {};          // id -> 'live' | 'deleted': the events whose records are looked at one by one
  var ghosts = [];
  return listed.then(function (refs) {
    refs = refs.filter(function (r) {
      if (isImport(r.id)) { skipped.imports++; return false; }
      if (isQa(r.id) && !o.includeQa) { skipped.qa++; return false; }
      return true;
    });
    var chunks = [];
    for (var i = 0; i < refs.length; i += 100) chunks.push(refs.slice(i, i + 100));
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        return fb.db.getAll.apply(fb.db, chunk).then(function (snaps) {
          snaps.forEach(function (s, k) {
            read.events++;
            var id = chunk[k].id, d = s.exists ? (s.data() || {}) : null, kind = eventGhostKind(s.exists, d);
            if (!kind) { real[id] = d.deletedAt ? 'deleted' : 'live'; return; }
            var touched = d ? Math.max(timeOf(d.updatedAt), timeOf(d.discardingAt), timeOf(d.deletedAt)) : 0;
            ghosts.push({ eventId: id, kind: kind, name: d ? String(d.name || '').slice(0, 80) : '', touched: touched ? new Date(touched).toISOString() : '',
              recent: !!touched && now - touched < RECENT_MS, fields: d ? Object.keys(d).sort() : [] });
          });
        });
      });
    }, Promise.resolve());
  }).then(function () {
    /* one at a time: a few dozen at most, and each lists its subcollections and files */
    return ghosts.reduce(function (p, g) {
      return p.then(function () {
        return contentsOf(fb, g.eventId).then(function (c) {
          g.records = c.records; g.files = c.files; g.bytes = c.bytes;
          g.registrations = c.records.registrations || 0;
          g.forPerson = g.registrations > 0 ? 'has ' + g.registrations + ' registration' + (g.registrations === 1 ? '' : 's') : g.recent ? 'changed in the last 7 days' : '';
        });
      });
    }, Promise.resolve());
  }).then(function () {
    /* a ghost's files that a real event still shows are not the ghost's to take away. With --event, a ghost's own
       id, every real event is still read: the pages that could name its files are theirs, not its own */
    var ids = Object.keys(real);
    var reading = o.eventId && ghosts.some(function (g) { return g.files > 0; }) ? col.get().then(function (snap) {
      snap.docs.forEach(function (d) { var v = d.data() || {}; if (eventGhostKind(true, v) === '' && !isImport(d.id)) ids.push(d.id); });
    }) : Promise.resolve();
    return reading.then(function () { return referencesTo(fb, ghosts, ids.filter(function (id, i, a) { return a.indexOf(id) === i; })); }).then(function (found) {
      ghosts.forEach(function (g) {
        g.usedBy = found[g.eventId] || [];
        if (g.usedBy.length && !g.forPerson) g.forPerson = 'its files are named by ' + g.usedBy.join(', ');
      });
    });
  }).then(function () {
    var records = [];
    return Promise.all(CONTENT.map(function (c) {
      var q = o.eventId ? col.doc(o.eventId).collection(c) : fb.db.collectionGroup(c);
      return q.get().then(function (snap) {
        snap.docs.forEach(function (doc) {
          var m = RECORD_PATH.exec(doc.ref.path);
          if (!m || m[2] !== c || !real[m[1]]) return;        // a ghost event's records go with it
          read.records++;
          var d = doc.data() || {}, kind = recordGhostKind(d);
          if (!kind) return;
          records.push({ eventId: m[1], eventState: real[m[1]], col: c, id: m[3], kind: kind, fields: Object.keys(d).sort(),
            forPerson: kind === 'nameless' ? 'no name, but it holds ' + Object.keys(d).filter(function (k) { return HOUSEKEEPING.indexOf(k) === -1 && filled(d[k]); }).join(', ') : '' });
        });
      });
    })).then(function () {
      ghosts.sort(function (a, b) { return a.eventId.localeCompare(b.eventId); });
      records.sort(function (a, b) { return a.eventId.localeCompare(b.eventId) || a.col.localeCompare(b.col) || a.id.localeCompare(b.id); });
      return { events: ghosts, records: records, skipped: skipped, read: read };
    });
  });
}

function summarise(r) {
  var byKind = {};
  r.events.forEach(function (g) { byKind[g.kind] = (byKind[g.kind] || 0) + 1; });
  return {
    events: r.events.length, eventsByKind: byKind,
    eventsToRemove: r.events.filter(function (g) { return !g.forPerson; }).length,
    eventsForPerson: r.events.filter(function (g) { return g.forPerson; }).length,
    recordsUnder: r.events.reduce(function (n, g) { return n + Object.keys(g.records || {}).reduce(function (m, k) { return m + g.records[k]; }, 0); }, 0),
    files: r.events.reduce(function (n, g) { return n + (g.files || 0); }, 0),
    bytes: r.events.reduce(function (n, g) { return n + (g.bytes || 0); }, 0),
    records: r.records.filter(function (x) { return x.kind === 'ghost'; }).length,
    recordsForPerson: r.records.filter(function (x) { return x.kind !== 'ghost'; }).length,
    skipped: r.skipped, read: r.read
  };
}

/* --apply for one ghost event -> Promise<{ ghost, removed: true } | { ghost, skipped }> */
function removeEvent(fb, g) {
  if (g.forPerson) return Promise.resolve({ ghost: g, skipped: 'for a person: ' + g.forPerson });
  var ref = fb.db.collection('events').doc(g.eventId);
  return Promise.all([ref.get(), countOf(ref.collection('registrations'))]).then(function (r) {
    var s = r[0], kind = eventGhostKind(s.exists, s.exists ? s.data() : null);
    if (kind !== g.kind) return { ghost: g, skipped: kind ? 'it is now ' + kind : 'it is an event now' };
    if (r[1] > 0) return { ghost: g, skipped: 'it has registrations now' };
    /* files the dry run saw no real event name: removed with it */
    return fb.bucket.deleteFiles({ prefix: 'events/' + g.eventId + '/' })
      .then(function () { return fb.db.recursiveDelete(ref); })
      .then(function () { return { ghost: g, removed: true }; });
  });
}
/* --apply for one ghost record -> Promise<{ record, removed: true } | { record, skipped }> */
function removeRecord(fb, x) {
  if (x.kind !== 'ghost') return Promise.resolve({ record: x, skipped: 'for a person: ' + x.forPerson });
  var ref = fb.db.collection('events').doc(x.eventId).collection(x.col).doc(x.id);
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (s) {
      if (!s.exists) return 'it is gone already';
      if (recordGhostKind(s.data()) !== 'ghost') return 'it holds something now';
      tx.delete(ref);
      return '';
    });
  }).then(function (why) { return why ? { record: x, skipped: why } : { record: x, removed: true }; });
}
/* one at a time, events first; o.say(result) after each */
function apply(fb, result, o) {
  o = o || {};
  var out = [];
  var jobs = result.events.map(function (g) { return function () { return removeEvent(fb, g); }; })
    .concat(result.records.map(function (x) { return function () { return removeRecord(fb, x); }; }));
  return jobs.reduce(function (p, job) {
    return p.then(function () {
      return job().then(null, function (err) { return { skipped: 'failed — ' + (err && err.message) }; }).then(function (r) { out.push(r); if (o.say) o.say(r); });
    });
  }, Promise.resolve()).then(function () { return out; });
}

module.exports = { scan: scan, summarise: summarise, apply: apply, eventGhostKind: eventGhostKind, recordGhostKind: recordGhostKind, CONTENT: CONTENT };

/* ---------------------------------------------------------------------------------------------- the command */
if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = function (f) { return args.indexOf(f) !== -1; };
  const value = function (f) { var i = args.indexOf(f); return i === -1 ? '' : String(args[i + 1] || '').trim(); };
  const doApply = flag('--apply'), all = flag('--all'), includeQa = flag('--include-qa');
  const eventId = value('--event'), jsonFile = value('--json');
  const usage = 'usage: node tools/clean-ghosts.js [--event <eventId>] [--include-qa] [--json <file>]\n' +
    '       node tools/clean-ghosts.js --apply (--event <eventId> | --all) [--include-qa]';
  if ((flag('--event') && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(eventId)) || (doApply && !all && !eventId) || (all && eventId) ||
      (flag('--json') && !jsonFile) || args.some(function (a, i) { return /^--/.test(a) ? ['--apply', '--all', '--include-qa', '--event', '--json'].indexOf(a) === -1 : ['--event', '--json'].indexOf(args[i - 1]) === -1; })) {
    console.error(usage);
    process.exit(2);
  }
  if (eventId && isQa(eventId) && !includeQa) { console.error('"' + eventId + '" is a qa- event: add --include-qa.'); process.exit(2); }
  if (eventId && isImport(eventId)) { console.error('"' + eventId + '" is a Lovable import\'s record: not a ghost.'); process.exit(2); }

  /* the env file sits in the main checkout (a worktree has none): look here, then up from .claude/worktrees/<x> */
  const envCandidates = [path.join(REPO, 'tools', '.env.local'), path.join(REPO, '..', '..', '..', 'tools', '.env.local')];
  const envFile = envCandidates.filter(function (f) { return fs.existsSync(f); })[0];
  if (!envFile) { console.error('tools/.env.local not found'); process.exit(2); }
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(function (line) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
  const fb = require(path.join(LIB, 'firebase.js')).getFirebase();
  if (fb.error) { console.error('Firebase: ' + fb.error); process.exit(1); }

  function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }
  function recs(r) { var k = Object.keys(r || {}).sort(); return k.length ? k.map(function (c) { return c + ' ' + r[c]; }).join(', ') : 'no records'; }
  (async function () {
    console.log(doApply ? 'APPLY — ghost events and records are removed.' : 'DRY RUN — nothing is written.');
    console.log('scope: ' + (eventId ? 'events/' + eventId : 'every event id' + (includeQa ? ' (qa- included)' : ' (qa- left out)')));
    const result = await scan(fb, { eventId: eventId, includeQa: includeQa });
    if (result.events.length) console.log('\nGHOST EVENTS');
    result.events.forEach(function (g) {
      console.log('  events/' + g.eventId + '  [' + g.kind + ']' + (g.name ? '  "' + g.name + '"' : '') + (g.touched ? '  last changed ' + g.touched : '') +
        '\n      ' + recs(g.records) + '; ' + g.files + ' files (' + kb(g.bytes) + ')' + (g.fields.length ? '; fields: ' + g.fields.join(' ') : '') +
        (g.forPerson ? '\n      FOR A PERSON, not removed: ' + g.forPerson : ''));
    });
    if (result.records.length) console.log('\nGHOST RECORDS (under real events)');
    result.records.forEach(function (x) {
      console.log('  events/' + x.eventId + ' [' + x.eventState + ']  ' + x.col + '/' + x.id + '  fields: ' + (x.fields.join(' ') || '(none)') +
        (x.forPerson ? '\n      FOR A PERSON, not removed: ' + x.forPerson : ''));
    });
    const sum = summarise(result);
    console.log('\nSUMMARY');
    console.log('  read: ' + sum.read.events + ' event ids, ' + sum.read.records + ' records of real events; left out: ' + sum.skipped.imports + ' import records, ' + sum.skipped.qa + ' qa- ids');
    console.log('  ghost events: ' + sum.events + ' ' + JSON.stringify(sum.eventsByKind) + ' — ' + sum.eventsToRemove + ' to remove, ' + sum.eventsForPerson + ' for a person');
    console.log('    under them: ' + sum.recordsUnder + ' records, ' + sum.files + ' files (' + kb(sum.bytes) + ')');
    console.log('  ghost records: ' + sum.records + ' to remove, ' + sum.recordsForPerson + ' for a person');
    if (jsonFile) {
      fs.writeFileSync(jsonFile, JSON.stringify({ at: new Date().toISOString(), summary: sum, events: result.events, records: result.records }, null, 2));
      console.log('  list written to ' + jsonFile);
    }
    if (!doApply) return;
    console.log('\nREMOVING…');
    const out = await apply(fb, result, { say: function (r) {
      var what = r.ghost ? 'events/' + r.ghost.eventId : r.record ? 'events/' + r.record.eventId + '/' + r.record.col + '/' + r.record.id : '?';
      console.log('  ' + (r.removed ? 'removed ' : 'skipped ') + what + (r.skipped ? ' — ' + r.skipped : ''));
    } });
    console.log('removed ' + out.filter(function (r) { return r.removed; }).length + ', skipped ' + out.filter(function (r) { return !r.removed; }).length);
  })().then(function () { process.exit(0); }, function (err) { console.error(err && err.stack || err); process.exit(1); });
}
