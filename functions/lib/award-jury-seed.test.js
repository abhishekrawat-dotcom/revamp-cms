// node functions/lib/award-jury-seed.test.js — an award's jury is the event's Speakers records (api.js seedAwardJury;
// the owner, 28 Oct 2026: "the speaker module can be used as jury for awards"). The jury on record becomes speaker
// groups and speakers, the grand jury first, only while the event has none of its own. No network, no Firestore: a
// small stand-in for the parts of the Admin SDK it uses.
'use strict';
const hooks = require('./api.js')._testHooks;
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function fakeFb(existing) {
  var docs = {}, n = 0;
  Object.keys(existing || {}).forEach(function (k) { docs[k] = existing[k]; });
  function col(path) {
    return {
      doc: function (id) { var p = path + '/' + (id || 'id' + (++n)); return { id: p.split('/').pop(), path: p, collection: function (c) { return col(p + '/' + c); } }; },
      limit: function () { return { get: function () {
        var any = Object.keys(docs).some(function (k) { return k.indexOf(path + '/') === 0 && k.slice(path.length + 1).indexOf('/') === -1; });
        return Promise.resolve({ empty: !any });
      } }; }
    };
  }
  return {
    docs: docs,
    db: {
      collection: function (c) { return col(c); },
      batch: function () { var w = []; return { set: function (ref, data) { w.push([ref.path, data]); }, commit: function () { w.forEach(function (x) { docs[x[0]] = x[1]; }); return Promise.resolve(); } }; }
    }
  };
}
function of(fb, kind) { return Object.keys(fb.docs).filter(function (k) { return k.indexOf('events/ev/' + kind + '/') === 0; }).map(function (k) { return Object.assign({ id: k.split('/').pop() }, fb.docs[k]); }); }

var JURY = [
  { group: 'Jury 2026', people: [{ name: 'Second Group One', title: 'CMO', company: 'B' }] },
  { group: 'Grand Jury 2026', people: [
    { name: 'Anita Rao', title: 'CIO', company: 'Bank', photo: 'https://img.etb2bimg.com/a.jpg', bio: 'Thirty years.', linkedin: 'https://www.linkedin.com/in/anita' },
    { name: 'Vikram', title: '', company: '', photo: 'http://insecure/x.jpg', linkedin: 'javascript:alert(1)' },
    { name: '   ' }
  ] }
];

(async function () {
  var fb = fakeFb();
  await hooks.seedAwardJury(fb, 'ev', JURY, 'owner@timesinternet.in');
  var groups = of(fb, 'speakerGroups').sort(function (a, b) { return a.order - b.order; });
  var people = of(fb, 'speakers').sort(function (a, b) { return a.order - b.order; });
  check('the groups as the record names them, the grand jury first', groups.map(function (g) { return g.name; }).join('|') === 'Grand Jury 2026|Jury 2026', groups);
  check('each juror a speaker of their group, in order; a nameless one left out', people.map(function (p) { return p.name; }).join('|') === 'Anita Rao|Vikram|Second Group One' &&
    people[0].groupId === groups[0].id && people[2].groupId === groups[1].id, people);
  check('the speaker fields: designation, company, photo, text, LinkedIn', people[0].desig === 'CIO' && people[0].comp === 'Bank' && people[0].photoUrl === 'https://img.etb2bimg.com/a.jpg' &&
    people[0].bio === 'Thirty years.' && people[0].li === 'https://www.linkedin.com/in/anita' && people[0].createdBy === 'owner@timesinternet.in', people[0]);
  check('an http photo and a javascript: link are not kept', people[1].photoUrl === '' && people[1].li === '', people[1]);
  check('no status: a record with none shows on the site (confirmed)', people.every(function (p) { return p.status === undefined; }));

  var own = fakeFb({ 'events/ev/speakers/s1': { name: 'Owner Added' } });
  await hooks.seedAwardJury(own, 'ev', JURY, 'x');
  check('never over the event\'s own speakers', of(own, 'speakers').length === 1 && of(own, 'speakerGroups').length === 0);
  var groupsOnly = fakeFb({ 'events/ev/speakerGroups/g1': { name: 'Jury' } });
  await hooks.seedAwardJury(groupsOnly, 'ev', JURY, 'x');
  check('nor beside groups the owner made', of(groupsOnly, 'speakers').length === 0 && of(groupsOnly, 'speakerGroups').length === 1);
  var none = fakeFb();
  await hooks.seedAwardJury(none, 'ev', [{ group: 'Jury', people: [] }], 'x');
  check('no juror on record: nothing written', Object.keys(none.docs).length === 0);

  if (failed) { console.error('award-jury-seed: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('award-jury-seed: all ' + passed + ' checks passed');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
