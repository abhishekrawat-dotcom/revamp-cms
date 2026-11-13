/* node functions/lib/clean-ghosts.test.js — tools/clean-ghosts.js (launch check BE-070): what the code before the core
   left in production — event documents that were never created as events, records under ids that have no event,
   an interrupted discard, nameless ghost records — is found by the dry run, which writes nothing, and removed by
   --apply; a real event, its real records, a Lovable import's record, qa- test data and anything with registrations
   are never touched. Against an in-memory Firestore and Storage; no network. Exits 1 on any failure. */
'use strict';
var TOOL = require('../../tools/clean-ghosts.js');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 600) : '')); }

/* ---------- an in-memory Firestore + Storage with what the tool uses ---------- */
function fakeFb() {
  var docs = {}, files = {};
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function under(p) { return Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0; }); }
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      listCollections: function () {
        var names = {};
        under(p).forEach(function (k) { names[k.slice(p.length + 1).split('/')[0]] = true; });
        return Promise.resolve(Object.keys(names).map(function (n) { return colRef(p + '/' + n); }));
      }
    };
  }
  function colRef(p) {
    function direct() { return Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }); }
    return {
      id: p.split('/').pop(), path: p,
      doc: function (id) { return docRef(p + '/' + id); },
      get: function () { var l = direct().map(snap); return Promise.resolve({ docs: l, size: l.length }); },
      count: function () { return { get: function () { var n = direct().length; return Promise.resolve({ data: function () { return { count: n }; } }); } }; },
      /* every id that has a document or anything under it: Firestore's own listDocuments() also gives "missing" ones */
      listDocuments: function () {
        var ids = {};
        Object.keys(docs).forEach(function (k) { if (k.indexOf(p + '/') === 0) ids[k.slice(p.length + 1).split('/')[0]] = true; });
        return Promise.resolve(Object.keys(ids).map(function (id) { return docRef(p + '/' + id); }));
      }
    };
  }
  var db = {
    collection: function (n) { return colRef(n); },
    collectionGroup: function (n) {
      return { get: function () {
        var l = Object.keys(docs).filter(function (k) { var parts = k.split('/'); return parts.length % 2 === 0 && parts[parts.length - 2] === n; }).map(snap);
        return Promise.resolve({ docs: l });
      } };
    },
    getAll: function () { return Promise.all([].slice.call(arguments).map(function (r) { return r.get(); })); },
    runTransaction: function (fn) {
      var tx = { get: function (r) { return r.get(); }, delete: function (r) { delete docs[r.path]; return tx; } };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    recursiveDelete: function (ref) { delete docs[ref.path]; under(ref.path).forEach(function (k) { delete docs[k]; }); return Promise.resolve(); }
  };
  /* a file is its size (a number) or its text */
  function sizeOf(v) { return typeof v === 'number' ? v : String(v).length; }
  var bucket = {
    file: function (p) {
      return { download: function () { return p in files ? Promise.resolve([Buffer.from(typeof files[p] === 'number' ? '' : files[p])]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); } };
    },
    getFiles: function (o) { var pre = (o && o.prefix) || ''; return Promise.resolve([Object.keys(files).filter(function (k) { return k.indexOf(pre) === 0; }).map(function (k) { return { name: k, metadata: { size: String(sizeOf(files[k])) } }; })]); },
    deleteFiles: function (o) { var pre = (o && o.prefix) || ''; Object.keys(files).forEach(function (k) { if (k.indexOf(pre) === 0) delete files[k]; }); return Promise.resolve(); }
  };
  return { db: db, bucket: bucket, docs: docs, files: files };
}

(async function () {
  var FB = fakeFb(), now = Date.parse('2026-11-13T10:00:00Z'), old = '2026-08-01T10:00:00.000Z', recent = '2026-11-10T10:00:00.000Z';
  var D = FB.docs, F = FB.files;
  /* real events: one live, one deleted — with real records and two ghosts */
  D['events/brand-summit-2026'] = { name: 'Brand Summit 2026', createdAt: old, updatedAt: old };
  D['events/brand-summit-2026/speakers/s1'] = { name: 'Asha Rao', createdAt: old };
  D['events/brand-summit-2026/speakers/s2'] = { name: 'Old Speaker' };                         // before createdAt existed: a real one
  D['events/brand-summit-2026/speakers/g1'] = { updatedAt: old, updatedBy: 'x', order: 3 };     // a ghost of a deleted speaker
  D['events/brand-summit-2026/faqs/g2'] = { updatedAt: old, status: '' };                        // a ghost FAQ
  D['events/brand-summit-2026/partners/n1'] = { updatedAt: old, logoUrl: 'https://x.test/l.png' }; // nameless, holds a logo: for a person
  D['events/brand-summit-2026/registrations/r1'] = { email: 'a@b.co' };
  F['events/brand-summit-2026/speakers/a.png'] = 900;
  D['events/old-summit-2025'] = { name: 'Old Summit 2025', createdAt: old, deletedAt: old };
  D['events/old-summit-2025/sessions/g3'] = { order: 1 };
  /* ghosts */
  D['events/tech-sumit-2026'] = { name: 'Tech Sumit', updatedAt: old, designPlan: { x: 1 } };     // a shell from an AI step
  D['events/tech-sumit-2026/briefs/b1'] = { model: 'x' };
  F['events/tech-sumit-2026/briefs/deck.pdf'] = 5000;
  D['events/typo-event/speakers/z1'] = { name: 'Someone' };                                        // records under no document
  F['events/typo-event/published/index.html'] = 300;
  D['events/abandoned-2026'] = { name: 'Abandoned', createdAt: old, deletedAt: old, discardingAt: old };    // an interrupted discard
  D['events/discarding-now'] = { name: 'Being discarded', createdAt: recent, deletedAt: recent, discardingAt: recent };  // one still running: for a person
  D['events/shell-with-people'] = { updatedAt: old };                                               // a shell someone registered on
  D['events/shell-with-people/registrations/r1'] = { email: 'p@q.co' };
  D['events/fresh-shell'] = { name: 'Fresh', updatedAt: recent };                                  // changed 3 days ago: for a person
  /* ghosts whose files a real event still names: a picture made there before the event had its own address */
  D['events/early-hero'] = { theme: { heroImageUrl: 'x' } };
  F['events/early-hero/generated/hero-bg.png'] = 2000;
  D['events/old-summit-2025'].designPlan = { heroImage: 'https://storage.googleapis.com/b/events/early-hero/generated/hero-bg.png' };
  D['events/early-pics/drafts/d1'] = { model: 'x' };
  F['events/early-pics/generated/s1.png'] = 100;
  F['events/brand-summit-2026/site/page.html'] = '<img src="https://firebasestorage.googleapis.com/v0/b/b/o/events%2Fearly-pics%2Fgenerated%2Fs1.png?alt=media">';
  /* never touched */
  D['events/import-abc123'] = { importedAt: old };
  D['events/qa-ghost'] = { updatedAt: old };
  D['speakerPages/asha-rao'] = { name: 'Asha Rao' };
  F['events/tech-sumit-2026-b/x.png'] = 10;                                                         // another id that starts the same
  D['events/tech-sumit-2026-b'] = { name: 'Tech Sumit B', createdAt: old };

  var before = JSON.stringify(D), filesBefore = JSON.stringify(F);
  var res = await TOOL.scan(FB, { now: now });
  var sum = TOOL.summarise(res);
  ok(JSON.stringify(D) === before && JSON.stringify(F) === filesBefore, '1 the dry run writes nothing');
  var ev = res.events.map(function (g) { return g.eventId + ':' + g.kind + (g.forPerson ? ':person' : ''); });
  ok(ev.join() === ['abandoned-2026:interrupted discard', 'discarding-now:interrupted discard:person', 'early-hero:shell:person', 'early-pics:no document:person', 'fresh-shell:shell:person',
    'shell-with-people:shell:person', 'tech-sumit-2026:shell', 'typo-event:no document'].join(),
    '1 it finds every ghost event — a shell, an id with no document, an interrupted discard — and marks those with registrations or recent changes for a person', ev);
  var t = res.events.filter(function (g) { return g.eventId === 'tech-sumit-2026'; })[0];
  ok(t && t.records.briefs === 1 && t.files === 1 && t.bytes === 5000 && t.name === 'Tech Sumit', '1 …with what is under each: records by collection, files and their size', t);
  var p = res.events.filter(function (g) { return g.eventId === 'shell-with-people'; })[0];
  ok(p && /1 registration/.test(p.forPerson), '1 …a ghost someone registered on says so', p && p.forPerson);
  var rec = res.records.map(function (x) { return x.eventId + '/' + x.col + '/' + x.id + ':' + x.kind; });
  ok(rec.join() === ['brand-summit-2026/faqs/g2:ghost', 'brand-summit-2026/partners/n1:nameless', 'brand-summit-2026/speakers/g1:ghost', 'old-summit-2025/sessions/g3:ghost'].join(),
    '1 ghost records under real events (live or deleted) are found; real ones, even without createdAt, are not', rec);
  var eh = res.events.filter(function (g) { return g.eventId === 'early-hero'; })[0], ep = res.events.filter(function (g) { return g.eventId === 'early-pics'; })[0];
  ok(eh && /files are named by old-summit-2025 \(event\)/.test(eh.forPerson) && ep && /brand-summit-2026 \(saved site\)/.test(ep.forPerson),
    '1 a ghost whose files a real event still names (its document, its saved site, even as a %2F download address) is for a person', [eh && eh.forPerson, ep && ep.forPerson]);
  ok(sum.events === 8 && sum.eventsToRemove === 3 && sum.eventsForPerson === 5 && sum.records === 3 && sum.recordsForPerson === 1 &&
    sum.skipped.imports === 1 && sum.skipped.qa === 1, '1 totals, with the import records and qa- ids left out', sum);
  var qa = await TOOL.scan(FB, { now: now, includeQa: true });
  ok(qa.events.some(function (g) { return g.eventId === 'qa-ghost'; }), '1 --include-qa: qa- ids too');
  var one = await TOOL.scan(FB, { now: now, eventId: 'brand-summit-2026' });
  ok(one.events.length === 0 && one.records.length === 3 && one.records.every(function (x) { return x.eventId === 'brand-summit-2026'; }), '1 --event: that id only', one.records.length);

  /* --apply, with one ghost record filled in and one shell created as an event in between */
  D['events/brand-summit-2026/faqs/g2'].question = 'Is there parking?';
  D['events/tech-sumit-2026'].createdAt = new Date(now).toISOString();
  var out = await TOOL.apply(FB, res, {});
  var removed = out.filter(function (r) { return r.removed; }).map(function (r) { return r.ghost ? r.ghost.eventId : r.record.col + '/' + r.record.id; }).sort();
  ok(removed.join() === ['abandoned-2026', 'sessions/g3', 'speakers/g1', 'typo-event'].join(), '2 --apply removes the ghosts that are still ghosts', removed);
  ok(!Object.keys(D).some(function (k) { return /^events\/(typo-event|abandoned-2026)(\/|$)/.test(k); }) && !Object.keys(F).some(function (k) { return /^events\/typo-event\//.test(k); }),
    '2 …each ghost event with everything under it and its files');
  ok(!!D['events/tech-sumit-2026'] && !!D['events/tech-sumit-2026/briefs/b1'] && !!F['events/tech-sumit-2026/briefs/deck.pdf'] && !!F['events/tech-sumit-2026-b/x.png'] && !!D['events/tech-sumit-2026-b'],
    '2 a shell that became an event meanwhile is left whole (and another id that starts the same is never touched)');
  var skipped = out.filter(function (r) { return !r.removed; }).map(function (r) { return (r.ghost ? r.ghost.eventId : r.record.id) + ': ' + r.skipped; });
  ok(skipped.some(function (s) { return /^tech-sumit-2026: it is an event now/.test(s); }) && skipped.some(function (s) { return /^g2: it holds something now/.test(s); }) &&
    skipped.some(function (s) { return /^shell-with-people: for a person/.test(s); }) && skipped.some(function (s) { return /^n1: for a person/.test(s); }), '2 …and each one left alone says why', skipped);
  ok(!!F['events/early-hero/generated/hero-bg.png'] && !!F['events/early-pics/generated/s1.png'] && !!D['events/early-pics/drafts/d1'] &&
    !!D['events/shell-with-people/registrations/r1'] && !!D['events/fresh-shell'] && !!D['events/discarding-now'] && !!D['events/brand-summit-2026/partners/n1'] && !!D['events/brand-summit-2026/faqs/g2'],
    '2 registrations, recent shells, a discard still running and records that hold something are never removed');
  ok(!!D['events/brand-summit-2026'] && !!D['events/brand-summit-2026/speakers/s1'] && !!D['events/brand-summit-2026/speakers/s2'] && !!D['events/brand-summit-2026/registrations/r1'] &&
    !!F['events/brand-summit-2026/speakers/a.png'] && !!D['events/old-summit-2025'] && !!D['events/import-abc123'] && !!D['events/qa-ghost'] && !!D['speakerPages/asha-rao'],
    '2 real events, their real records and files, import records, qa- data and everything else are untouched');
  var again = await TOOL.scan(FB, { now: now });
  ok(again.events.filter(function (g) { return !g.forPerson; }).length === 0 && again.records.filter(function (x) { return x.kind === 'ghost'; }).length === 0,
    '3 run again: nothing left to remove', { events: again.events.map(function (g) { return g.eventId; }), records: again.records.map(function (x) { return x.id; }) });

  ok(TOOL.recordGhostKind({ name: '  ' }) === 'ghost' && TOOL.recordGhostKind({ title: 'Keynote' }) === '' && TOOL.recordGhostKind({ createdAt: old }) === '' &&
    TOOL.recordGhostKind({ bio: 'x' }) === 'nameless' && TOOL.eventGhostKind(true, { createdAt: old, deletedAt: old }) === '' && TOOL.eventGhostKind(false, null) === 'no document',
    '4 the rules: a blank name is no name; createdAt or any name makes it real; a deleted event is a real event');

  if (failures.length) { console.log('clean-ghosts: ' + (checks - failures.length) + ' passed, ' + failures.length + ' failed\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('clean-ghosts: ' + checks + ' passed, 0 failed');
  process.exit(0);
})().catch(function (e) { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
