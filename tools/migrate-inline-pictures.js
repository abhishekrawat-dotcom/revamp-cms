/* node tools/migrate-inline-pictures.js [--event <eventId>] [--include-qa] [--json <file>]        DRY RUN: reads only
   node tools/migrate-inline-pictures.js --apply (--event <eventId> | --all) [--include-qa]       moves the pictures

   Speaker photos, speakers' company logos, sponsor logos and gallery pictures saved before 13 Nov 2026 are held
   INSIDE their records as image text (data: URLs; launch check CON-052/054/055/056). Since then every new one is
   stored as a file and the record keeps its address (functions/lib/inline-pictures.js); the old ones stay as they
   are until the owner decides to move them. This script finds them and, with --apply, moves them.

   WHERE IT LOOKS
     events/<id>/speakers/<rec>   photoUrl, logoUrl
     events/<id>/partners/<rec>   logoUrl
     events/<id>/gallery/<rec>    imageUrl
     speakerPages/<slug>          set.photo      (the speaker pages' own photo, added by the team)
     sponsorPages/<slug>          set.logo
   qa- events are test data and are left out unless --include-qa. The pages' change history (…Pages/<slug>/log) keeps
   what each page held before a change and is never rewritten.

   DRY RUN (the default) writes nothing. It lists every record that holds a data: picture — the event (its name,
   published / draft / deleted), the record (id and name), the field, the picture's type and size — then totals.
   --json <file> also writes that list (without the pictures themselves) as JSON.

   --apply stores each such picture as a file exactly as an upload stores one (lib/api-events.js storeImageFile:
   events/<id>/speakers|partners|gallery/, a name unique for ever, WebP copies; a page's picture in
   people/<kind>/<slug>/) and sets the record's field to the file's address, in a transaction that writes only while
   the field still holds that same picture: a record changed meanwhile is left alone, said, and its new file removed.
   Nothing else on the record changes (not updatedAt: the picture is the same picture). A page's version goes up by
   one, so a page open in the console is read again before it is saved over. The site keeps showing every picture
   throughout: a saved or published page that drew a picture inline keeps it until the site is next saved.
   It can be run again at any time; a picture already moved is not found again.
     --event <id>   that event only (with --apply: required, or --all)
     --all          every event (not qa-) and the speaker and sponsor pages

   Credentials: the main checkout's tools/.env.local (FIREBASE_* as for tools/serve.js), never printed. Never shipped:
   nothing in the server or the pages loads this file. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const LIB = path.join(REPO, 'functions', 'lib');

/* what is looked at in an event's records: collection -> the picture fields, the upload folder, what it is called */
var RECORDS = {
  speakers: { fields: { photoUrl: 'speaker photo', logoUrl: 'speaker company logo' }, folder: 'speakers' },
  partners: { fields: { logoUrl: 'sponsor logo' }, folder: 'partners' },
  gallery: { fields: { imageUrl: 'gallery picture' }, folder: 'gallery' }
};
var PAGES = { speakers: { field: 'photo', what: 'speaker page photo' }, sponsors: { field: 'logo', what: 'sponsor page logo' } };
var RECORD_PATH = /^events\/([^/]+)\/(speakers|partners|gallery)\/([^/]+)$/;

function isInline(v) { return typeof v === 'string' && /^\s*data:/i.test(v); }
/* the picture's declared type and its size in bytes once decoded (from the base64's length, without decoding it) */
function sizeOf(v) {
  var s = String(v), comma = s.indexOf(','), head = comma === -1 ? '' : s.slice(5, comma).toLowerCase();
  var body = comma === -1 ? '' : s.slice(comma + 1).replace(/\s+/g, '');
  var b64 = /;\s*base64\s*$/.test(head);
  var pad = b64 ? (body.match(/=+$/) || [''])[0].length : 0;
  return { type: head.split(';')[0].trim() || '(none)', chars: s.length, bytes: b64 ? Math.floor(body.length * 3 / 4) - pad : body.length };
}
function nameOf(d) { return String((d && (d.name || d.caption || d.comp)) || '').replace(/\s+/g, ' ').trim().slice(0, 60); }
function isQa(eventId) { return /^qa-/.test(eventId); }

/* the hits of one record document */
function recordHits(eventId, col, id, data) {
  var out = [];
  Object.keys(RECORDS[col].fields).forEach(function (f) {
    if (!isInline(data[f])) return;
    var sz = sizeOf(data[f]);
    out.push({ area: 'event', eventId: eventId, col: col, id: id, name: nameOf(data), field: f, what: RECORDS[col].fields[f],
      type: sz.type, chars: sz.chars, bytes: sz.bytes, value: data[f] });
  });
  return out;
}

/* -> Promise<{ hits: [hit], events: { <id>: { name, state } }, leftOutQa: n }>   o: { eventId, includeQa, pages } */
function scan(fb, o) {
  o = o || {};
  var hits = [], leftOutQa = 0, read = { speakers: 0, partners: 0, gallery: 0, pages: 0, events: {} };
  function take(eventId, col, id, data) {
    read[col]++; read.events[eventId] = true;
    var h = recordHits(eventId, col, id, data || {});
    if (!h.length) return;
    if (isQa(eventId) && !o.includeQa) { leftOutQa += h.length; return; }
    hits = hits.concat(h);
  }
  var cols = Object.keys(RECORDS);
  var records = o.eventId
    ? Promise.all(cols.map(function (col) {
        return fb.db.collection('events').doc(o.eventId).collection(col).get().then(function (snap) {
          snap.docs.forEach(function (d) { take(o.eventId, col, d.id, d.data()); });
        });
      }))
    : Promise.all(cols.map(function (col) {
        /* every event's records of that kind in one read; only events/<id>/<col>/<rec> are records */
        return fb.db.collectionGroup(col).get().then(function (snap) {
          snap.docs.forEach(function (d) {
            var m = RECORD_PATH.exec(d.ref.path);
            if (m && m[2] === col && !/^import-/.test(m[1])) take(m[1], col, m[3], d.data());
          });
        });
      }));
  var pages = o.eventId || o.pages === false ? Promise.resolve() : Promise.all(Object.keys(PAGES).map(function (kind) {
    var P = require(path.join(LIB, 'people.js'))._test.KINDS[kind];
    return fb.db.collection(P.pages).get().then(function (snap) {
      snap.docs.forEach(function (d) {
        read.pages++;
        var data = d.data() || {}, v = data.set && data.set[PAGES[kind].field];
        if (!isInline(v)) return;
        var sz = sizeOf(v);
        hits.push({ area: 'page', kind: kind, col: P.pages, id: d.id, name: String(data.name || (data.set && data.set.name) || d.id).slice(0, 60),
          field: 'set.' + PAGES[kind].field, what: PAGES[kind].what, type: sz.type, chars: sz.chars, bytes: sz.bytes, value: v });
      });
    });
  }));
  return Promise.all([records, pages]).then(function () {
    var ids = [];
    hits.forEach(function (h) { if (h.eventId && ids.indexOf(h.eventId) === -1) ids.push(h.eventId); });
    var events = {};
    var reads = [];
    for (var i = 0; i < ids.length; i += 100) {
      reads.push(fb.db.getAll.apply(fb.db, ids.slice(i, i + 100).map(function (id) { return fb.db.collection('events').doc(id); })).then(function (snaps) {
        snaps.forEach(function (s) {
          var d = s.exists ? s.data() || {} : null;
          events[s.id] = { name: d ? String(d.name || '') : '', state: !d || !d.createdAt ? (d && d.deletedAt ? 'deleted' : 'no event') : d.deletedAt ? 'deleted' : d.published === true ? 'published' : 'draft' };
        });
      }));
    }
    return Promise.all(reads).then(function () {
      hits.sort(function (a, b) { return (a.eventId || '~' + a.col).localeCompare(b.eventId || '~' + b.col) || a.col.localeCompare(b.col) || a.id.localeCompare(b.id) || a.field.localeCompare(b.field); });
      read.events = Object.keys(read.events).length;
      return { hits: hits, events: events, leftOutQa: leftOutQa, read: read };
    });
  });
}

/* the totals of a scan, by what the picture is */
function summarise(result) {
  var by = {}, total = { n: 0, bytes: 0, chars: 0 }, evs = {}, biggest = null;
  result.hits.forEach(function (h) {
    var b = by[h.what] || (by[h.what] = { n: 0, bytes: 0, chars: 0, max: 0 });
    b.n++; b.bytes += h.bytes; b.chars += h.chars; if (h.bytes > b.max) b.max = h.bytes;
    total.n++; total.bytes += h.bytes; total.chars += h.chars;
    if (h.eventId) evs[h.eventId] = true;
    if (!biggest || h.chars > biggest.chars) biggest = h;
  });
  var states = {};
  Object.keys(evs).forEach(function (id) { var s = (result.events[id] || {}).state || 'unknown'; states[s] = (states[s] || 0) + 1; });
  var records = {};
  result.hits.forEach(function (h) { records[(h.eventId || h.col) + '/' + h.col + '/' + h.id] = true; });
  return { byKind: by, total: total, events: Object.keys(evs).length, eventStates: states, records: Object.keys(records).length,
    pages: result.hits.filter(function (h) { return h.area === 'page'; }).length, leftOutQa: result.leftOutQa, read: result.read,
    biggest: biggest ? { at: (biggest.eventId ? 'events/' + biggest.eventId + '/' : '') + biggest.col + '/' + biggest.id, field: biggest.field, bytes: biggest.bytes, chars: biggest.chars } : null };
}

function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

/* --apply for one hit -> Promise<{ hit, url } | { hit, skipped }> */
function moveOne(fb, hit, o) {
  o = o || {};
  var IP = require(path.join(LIB, 'inline-pictures.js'));
  var ref, folder, field, label;
  if (hit.area === 'page') {
    var people = require(path.join(LIB, 'people.js'));
    ref = fb.db.collection(hit.col).doc(hit.id);
    folder = people.picturesFolder(hit.kind, hit.id);
    field = hit.field.slice(4);
    label = field === 'photo' ? 'The photo' : 'The logo';
  } else {
    ref = fb.db.collection('events').doc(hit.eventId).collection(hit.col).doc(hit.id);
    folder = 'events/' + hit.eventId + '/' + RECORDS[hit.col].folder;
    field = hit.field;
    label = field === 'photoUrl' ? 'The photo' : field === 'logoUrl' ? 'The logo' : 'The picture';
  }
  var who = hit.area === 'event' && field === 'logoUrl' && hit.col === 'speakers' ? '' : hit.name;
  return IP.store(fb, folder, hit.value, { label: label, fileName: (who ? who + ' ' : '') + (field === 'photoUrl' || field === 'photo' ? 'photo' : field === 'imageUrl' ? 'picture' : 'logo'), actor: o.actor || 'migrate-inline-pictures' })
    .then(function (up) {
      return fb.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          var cur = snap.exists ? snap.data() || {} : null;
          var now = cur && (hit.area === 'page' ? cur.set && cur.set[field] : cur[field]);
          if (now !== hit.value) return { skipped: cur ? 'the picture was changed meanwhile' : 'the record is gone' };
          var patch = {};
          if (hit.area === 'page') { patch['set.' + field] = up.url; patch.version = (cur.version || 0) + 1; }
          else patch[field] = up.url;
          tx.update(ref, patch);
          return { url: up.url };
        });
      }).then(function (r) {
        if (!r.skipped) return { hit: hit, url: r.url, path: up.path };
        return fb.bucket.file(up.path).delete().catch(function () { /* best effort */ }).then(function () { return { hit: hit, skipped: r.skipped }; });
      });
    }, function (err) { return { hit: hit, skipped: 'not a usable picture — ' + (err && err.message) }; });
}
/* one at a time: a few hundred small pictures, and an error is easier to read in order */
function apply(fb, hits, o) {
  var out = [];
  return hits.reduce(function (chain, h) {
    return chain.then(function () { return moveOne(fb, h, o).then(function (r) { out.push(r); if (o && o.say) o.say(r); }); });
  }, Promise.resolve()).then(function () { return out; });
}

module.exports = { scan: scan, summarise: summarise, apply: apply, moveOne: moveOne, sizeOf: sizeOf, RECORDS: RECORDS };

/* ---------------------------------------------------------------------------------------------- the command */
if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = function (f) { return args.indexOf(f) !== -1; };
  const value = function (f) { var i = args.indexOf(f); return i === -1 ? '' : String(args[i + 1] || '').trim(); };
  const doApply = flag('--apply'), all = flag('--all'), includeQa = flag('--include-qa');
  const eventId = value('--event'), jsonFile = value('--json');
  const usage = 'usage: node tools/migrate-inline-pictures.js [--event <eventId>] [--include-qa] [--json <file>]\n' +
    '       node tools/migrate-inline-pictures.js --apply (--event <eventId> | --all) [--include-qa]';
  if ((flag('--event') && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(eventId)) || (doApply && !all && !eventId) || (all && eventId) ||
      (flag('--json') && !jsonFile) || args.some(function (a, i) { return /^--/.test(a) ? ['--apply', '--all', '--include-qa', '--event', '--json'].indexOf(a) === -1 : ['--event', '--json'].indexOf(args[i - 1]) === -1; })) {
    console.error(usage);
    process.exit(2);
  }
  if (eventId && isQa(eventId) && !includeQa) { console.error('"' + eventId + '" is a qa- event: add --include-qa.'); process.exit(2); }

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

  (async function () {
    console.log(doApply ? 'APPLY — pictures are stored as files and records changed.' : 'DRY RUN — nothing is written.');
    console.log('scope: ' + (eventId ? 'events/' + eventId : 'every event' + (includeQa ? ' (qa- included)' : ' (qa- left out)') + ' and the speaker and sponsor pages'));
    const result = await scan(fb, { eventId: eventId, includeQa: includeQa });
    let last = null;
    result.hits.forEach(function (h) {
      const head = h.eventId ? 'events/' + h.eventId + '  — ' + ((result.events[h.eventId] || {}).name || '(no name)') + ' [' + ((result.events[h.eventId] || {}).state || '?') + ']' : h.col;
      if (head !== last) { console.log('\n' + head); last = head; }
      console.log('  ' + h.col + '/' + h.id + '  "' + h.name + '"  ' + h.field + '  ' + h.type + '  ' + kb(h.bytes) + ' (' + h.chars + ' characters)');
    });
    const sum = summarise(result);
    console.log('\nSUMMARY');
    console.log('  read: ' + sum.read.speakers + ' speakers, ' + sum.read.partners + ' sponsors, ' + sum.read.gallery + ' gallery pictures (in ' + sum.read.events + ' events, qa- included), ' + sum.read.pages + ' speaker and sponsor pages');
    Object.keys(sum.byKind).sort().forEach(function (k) {
      const b = sum.byKind[k];
      console.log('  ' + (k + ':').padEnd(24) + String(b.n).padStart(5) + '   ' + kb(b.bytes).padStart(10) + '   largest ' + kb(b.max));
    });
    console.log('  ' + 'all:'.padEnd(24) + String(sum.total.n).padStart(5) + '   ' + kb(sum.total.bytes).padStart(10) + '   (' + sum.total.chars + ' characters stored)');
    console.log('  records: ' + sum.records + '   events: ' + sum.events + ' ' + JSON.stringify(sum.eventStates) + '   pages: ' + sum.pages);
    if (sum.biggest) console.log('  largest: ' + sum.biggest.at + ' ' + sum.biggest.field + ' ' + kb(sum.biggest.bytes));
    if (!includeQa) console.log('  qa- pictures left out: ' + sum.leftOutQa);
    if (jsonFile) {
      fs.writeFileSync(jsonFile, JSON.stringify({ at: new Date().toISOString(), summary: sum, events: result.events,
        hits: result.hits.map(function (h) { var o = Object.assign({}, h); delete o.value; return o; }) }, null, 2));
      console.log('  list written to ' + jsonFile);
    }
    if (!doApply) return;
    console.log('\nMOVING ' + result.hits.length + ' pictures…');
    const out = await apply(fb, result.hits, { say: function (r) {
      console.log('  ' + (r.url ? 'moved   ' : 'skipped ') + (r.hit.eventId ? r.hit.eventId + '/' : '') + r.hit.col + '/' + r.hit.id + ' ' + r.hit.field + (r.url ? ' -> ' + r.url : ' — ' + r.skipped));
    } });
    console.log('moved ' + out.filter(function (r) { return r.url; }).length + ', skipped ' + out.filter(function (r) { return r.skipped; }).length);
  })().then(function () { process.exit(0); }, function (err) { console.error(err && err.stack || err); process.exit(1); });
}
