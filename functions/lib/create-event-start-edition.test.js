// node functions/lib/create-event-start-edition.test.js — Create Event's "Start from a previous edition" (launch check
// WZ-064, 13 Nov 2026). The owner's rule for a previous edition: only its speakers, sponsors, agenda and glimpses are
// taken over (as-is, what its site showed), venue is this edition's else the previous edition's, and nothing of its
// design or words is copied. Choosing one used to take only its template; now its four lists come into the new event as
// records of its own (create-event-editions.js carryOver), and the previous edition is only ever read.
// Runs create-event-editions.js in a vm with a stand-in RevampCore that keeps two events' Content in memory. No network.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
var EDITIONS = fs.readFileSync(path.join(ROOT, 'create-event-editions.js'), 'utf8');
var RECORDS = require(path.join(ROOT, 'templates/_shared/rv-records.js'));
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function J(v) { return JSON.stringify(v); }

var w = {}; w.window = w; vm.createContext(w);
vm.runInContext(EDITIONS, w, { filename: 'create-event-editions.js' });
var E = w.RevampEditions;
check('0 the module offers the carry', ['recordsOf', 'carryCounts', 'carryPlan', 'carryOver', 'unfinished', 'onSite'].every(function (k) { return typeof E[k] === 'function'; }) &&
  E.KIND_WORDS.partners === 'sponsors');

/* the previous edition, as the console holds it */
function previous() {
  return {
    speakers: [
      { id: 'sp1', name: 'Asha Rao', desig: 'CIO', comp: 'Beta', photoUrl: 'https://storage.googleapis.com/b/events/prev/a.png', status: 'confirmed', groupId: 'g1', order: 2,
        email: 'asha@beta.test', phone: '+91 90000 00000', li: 'https://www.linkedin.com/in/asha', bio: 'Leads IT.' },
      { id: 'sp2', name: 'Ravi Iyer', desig: 'CTO', comp: 'Acme', photoUrl: 'data:image/png;base64,xx', order: 1 },
      { id: 'sp3', name: 'Invited Only', status: 'invited', groupId: 'g2', order: 3 },
      { id: 'sp4', name: '  ', order: 4 }
    ],
    speakerGroups: [{ id: 'g1', name: 'Keynote', order: 1 }, { id: 'g2', name: 'Waiting', order: 2 }],
    sessions: [
      { id: 's1', title: 'Opening', start: '09:30', end: '10:00', groupId: 'd1', speakerIds: ['sp2', 'sp3', 'sp1'], room: 'Hall A', order: 1 },
      { id: 's2', title: 'Panel', start: '11:00', groupId: 'd2', speakerIds: ['gone'], order: 2 },
      { id: 's3', title: '', start: '12:00' }
    ],
    agendaGroups: [{ id: 'd1', name: 'Day 1', date: '2025-11-10', order: 1 }, { id: 'd2', name: 'Day 2', date: '2025-11-11', order: 2 }, { id: 'd3', name: 'Unused', order: 3 }],
    partners: [
      { id: 'p1', name: 'Gold Co', tierId: 't1', logoUrl: 'https://x.test/g.png', url: 'https://gold.test', status: '', contact: 'Ms Gold', email: 'g@gold.test', note: 'owes us', order: 1 },
      { id: 'p2', name: 'Tentative Co', tierId: 't2', status: 'tentative', order: 2 },
      { id: 'p3', name: 'Loose Co', order: 3 }
    ],
    partnerTiers: [{ id: 't1', name: 'Gold', order: 1 }, { id: 't2', name: 'Silver', order: 2 }],
    gallery: [{ id: 'i1', imageUrl: 'https://x.test/1.jpg', caption: 'Day 1', order: 1 }, { id: 'i2', imageUrl: 'javascript:x' }]
  };
}

/* ======================= 1 what comes ======================= */
var R = previous();
check('1.1 the on-site rule is rv-records.js isOnSite, word for word', [{}, { status: '' }, { status: 'confirmed' }, { status: 'invited' }, { status: 'tentative' }, { status: null }].every(function (r) {
  return E.onSite(r) === RECORDS.isOnSite(r);
}));
check('1.2 counts: what its site showed (no Invited or Tentative one, no nameless one, no session without a title, no picture without an address)',
  J(E.carryCounts(R)) === J({ speakers: 2, partners: 2, glimpses: 1, agenda: 2 }), E.carryCounts(R));
var sp = E.carryPlan(R, 'speakers');
check('1.3 speakers: their groups first — only those a speaker who comes is in', sp.length === 2 && sp[0].resource === 'speaker-groups' &&
  J(sp[0].rows) === J([{ key: 'g1', body: { name: 'Keynote', order: 1 } }]), sp[0]);
check('1.4 …then the speakers in order, with what the site shows of them; no email or phone; a picture only by its web address',
  sp[1].resource === 'speakers' && J(sp[1].rows.map(function (r) { return r.body; })) === J([
    { name: 'Ravi Iyer', desig: 'CTO', comp: 'Acme', order: 1 },
    { name: 'Asha Rao', desig: 'CIO', comp: 'Beta', photoUrl: 'https://storage.googleapis.com/b/events/prev/a.png', status: 'confirmed', li: 'https://www.linkedin.com/in/asha', bio: 'Leads IT.', order: 2 }
  ]), sp[1].rows);
check('1.5 …a speaker in a group that comes points at it (to be given its new id)', J(sp[1].rows[1].ref) === J({ field: 'groupId', resource: 'speaker-groups', key: 'g1' }) && sp[1].rows[0].ref === undefined);
var pt = E.carryPlan(R, 'partners');
check('1.6 sponsors: tiers with a sponsor that comes; no contact, email or note', pt.length === 2 && J(pt[0].rows.map(function (r) { return r.body.name; })) === J(['Gold']) &&
  J(pt[1].rows.map(function (r) { return r.body; })) === J([{ name: 'Gold Co', url: 'https://gold.test', logoUrl: 'https://x.test/g.png', order: 1 }, { name: 'Loose Co', order: 3 }]) &&
  J(pt[1].rows[0].ref) === J({ field: 'tierId', resource: 'partner-tiers', key: 't1' }), pt);
var ag = E.carryPlan(R, 'agenda');
check('1.7 agenda: its days without the previous edition\'s dates, only the days a session is in', ag[0].resource === 'agenda-groups' &&
  J(ag[0].rows.map(function (r) { return r.body; })) === J([{ name: 'Day 1', order: 1 }, { name: 'Day 2', order: 2 }]), ag[0]);
check('1.8 …its sessions, their speakers by name (only those on its site)', J(ag[1].rows.map(function (r) { return [r.body.title, r.speakers]; })) === J([['Opening', ['Ravi Iyer', 'Asha Rao']], ['Panel', []]]) &&
  J(ag[1].rows[0].body) === J({ title: 'Opening', start: '09:30', end: '10:00', room: 'Hall A', order: 1 }), ag[1].rows);
check('1.9 glimpses: the pictures with an address, their captions', J(E.carryPlan(R, 'glimpses')) === J([{ resource: 'gallery', rows: [{ key: 'i1', body: { imageUrl: 'https://x.test/1.jpg', caption: 'Day 1', order: 1 } }] }]));
check('1.10 nothing of a kind, or a kind that is not one: no plan', J(E.carryPlan({}, 'speakers')) === '[]' && J(E.carryPlan(R, 'faq')) === '[]' && J(E.carryPlan(R, '__proto__')) === '[]');

/* ======================= 2 brought in ======================= */
/* a stand-in RevampCore: each event's Content in memory; every write is logged */
function core(store, o) {
  o = o || {};
  var seq = 0, log = { reads: [], created: [], deleted: [] };
  function list(res, id) { var e = store[id] = store[id] || {}; return (e[res] = e[res] || []); }
  return {
    log: log,
    fetchSub: function (res, id) { log.reads.push(res + ':' + id); return o.readFails === res ? Promise.reject(new Error('down')) : Promise.resolve(JSON.parse(JSON.stringify(list(res, id)))); },
    createSub: function (res, id, body) {
      if (o.failAt && log.created.length === o.failAt) return Promise.reject(Object.assign(new Error('Could not reach the server.'), { status: 0 }));
      var rec = Object.assign({ id: 'n' + (++seq) }, body);
      list(res, id).push(rec); log.created.push([res, id, rec.id]);
      return Promise.resolve({ id: rec.id });
    },
    deleteSub: function (res, id, rid) {
      log.deleted.push([res, id, rid]);
      var l = list(res, id), at = -1;
      l.forEach(function (r, i) { if (r.id === rid) at = i; });
      if (at === -1) return Promise.reject(Object.assign(new Error('Not found'), { status: 404 }));
      l.splice(at, 1); return Promise.resolve({ ok: true });
    }
  };
}
function storeWith() {
  var p = previous(), s = { prev: {}, next: {} };
  s.prev = { speakers: p.speakers, 'speaker-groups': p.speakerGroups, sessions: p.sessions, 'agenda-groups': p.agendaGroups, partners: p.partners, 'partner-tiers': p.partnerTiers, gallery: p.gallery };
  return s;
}
function writesTo(c, id) { return c.log.created.concat(c.log.deleted).every(function (x) { return x[1] === id; }); }

async function main() {
  var store = storeWith(), before = JSON.stringify(store.prev), C = core(store), state = { done: {}, made: {} }, saves = 0;
  w.RevampCore = C;
  var res = await E.carryOver({ from: 'prev', to: 'next', kinds: ['agenda', 'speakers', 'partners', 'glimpses'], state: state, save: function () { saves++; } });
  var N = store.next;
  check('2.1 all four come, as new records of the new event; the previous edition is only read', J(res) === J({ copied: { speakers: 2, partners: 2, glimpses: 1, agenda: 2 }, kept: [] }) &&
    writesTo(C, 'next') && JSON.stringify(store.prev) === before, res);
  check('2.2 …with new ids of its own (none of the previous edition\'s)', ['speakers', 'speaker-groups', 'sessions', 'agenda-groups', 'partners', 'partner-tiers', 'gallery'].every(function (r) {
    return (N[r] || []).length > 0 && (N[r] || []).every(function (x) { return /^n\d+$/.test(x.id) && (store.prev[r] || []).every(function (y) { return y.id !== x.id; }); });
  }));
  var asha = N.speakers.filter(function (x) { return x.name === 'Asha Rao'; })[0], ravi = N.speakers.filter(function (x) { return x.name === 'Ravi Iyer'; })[0];
  check('2.3 a speaker\'s group is the new one', N['speaker-groups'].length === 1 && asha.groupId === N['speaker-groups'][0].id && ravi.groupId === undefined);
  var gold = N.partners.filter(function (x) { return x.name === 'Gold Co'; })[0];
  check('2.4 a sponsor\'s tier is the new one', N['partner-tiers'].length === 1 && gold.tierId === N['partner-tiers'][0].id && !('email' in gold) && !('note' in gold));
  var opening = N.sessions.filter(function (x) { return x.title === 'Opening'; })[0], panel = N.sessions.filter(function (x) { return x.title === 'Panel'; })[0];
  check('2.5 a session\'s day and speakers are the new event\'s', N['agenda-groups'].length === 2 && opening.groupId === N['agenda-groups'].filter(function (d) { return d.name === 'Day 1'; })[0].id &&
    J(opening.speakerIds) === J([ravi.id, asha.id]) && panel.speakerIds === undefined && !('date' in N['agenda-groups'][0]), opening);
  check('2.6 what was made is kept in the draft, kind by kind', state.done.speakers === 'copied' && state.done.agenda === 'copied' && state.made.speakers.length === 2 && state.made['agenda-groups'].length === 2 && saves > 5);
  var again = await E.carryOver({ from: 'prev', to: 'next', kinds: ['agenda', 'speakers', 'partners', 'glimpses'], state: state });
  check('2.7 a second run brings nothing in twice', J(again) === J({ copied: {}, kept: [] }) && N.speakers.length === 2 && N.sessions.length === 2);

  /* a kind the new event already has is kept, never doubled */
  store = storeWith(); store.next = { speakers: [{ id: 'own1', name: 'Asha Rao' }, { id: 'own2', name: 'Meera Nair' }] };
  C = core(store); w.RevampCore = C; state = { done: {}, made: {} };
  res = await E.carryOver({ from: 'prev', to: 'next', kinds: ['speakers', 'agenda'], state: state });
  check('2.8 speakers already in the new event (from the wizard\'s own section) are kept, not doubled', J(res) === J({ copied: { agenda: 2 }, kept: ['speakers'] }) &&
    store.next.speakers.length === 2 && state.done.speakers === 'kept', res);
  check('2.9 …and the agenda names them by name', J(store.next.sessions.filter(function (x) { return x.title === 'Opening'; })[0].speakerIds) === J(['own1']));
  check('2.10 only the kinds asked for come', !store.next.partners && !store.next.gallery);

  /* a run stopped part-way: carried on, never half in, never doubled */
  store = storeWith(); C = core(store, { failAt: 4 }); w.RevampCore = C; state = { done: {}, made: {} };
  var err = await E.carryOver({ from: 'prev', to: 'next', kinds: ['speakers', 'partners'], state: state }).then(function () { return null; }, function (e) { return e; });
  check('2.11 a write that fails fails the run, saying why', err && /Could not reach the server/.test(err.message) && E.unfinished(state).length === 1, err && err.message);
  var unfinishedKind = E.unfinished(state)[0];
  C = core(store); w.RevampCore = C;
  res = await E.carryOver({ from: 'prev', to: 'next', kinds: [], state: state });
  check('2.12 the kind it began is finished on the next run, even when no longer asked for: its part-made records taken out first',
    unfinishedKind === 'partners' && res.copied.partners === 2 && store.next.partners.length === 2 && store.next['partner-tiers'].length === 1 &&
    C.log.deleted.length >= 1 && E.unfinished(state).length === 0, { res: res, store: store.next, deleted: C.log.deleted });
  check('2.13 …a kind it did not begin, and is not asked for, does not come', !store.next.gallery && state.done.glimpses === undefined);

  /* stopped by the page (Cancel): nothing more is written */
  store = storeWith(); C = core(store); w.RevampCore = C; state = { done: {}, made: {} };
  var calls = 0;
  err = await E.carryOver({ from: 'prev', to: 'next', kinds: ['speakers', 'glimpses'], state: state, going: function () { return ++calls < 3; } }).then(function () { return null; }, function (e) { return e; });
  check('2.14 a run the page stopped rejects with "stopped" and writes no more', err && err.message === 'stopped' && C.log.created.length <= 2, { err: err && err.message, created: C.log.created });
  /* a list of the previous edition that cannot be read: nothing is written */
  store = storeWith(); C = core(store, { readFails: 'gallery' }); w.RevampCore = C; state = { done: {}, made: {} };
  err = await E.carryOver({ from: 'prev', to: 'next', kinds: ['speakers'], state: state }).then(function () { return null; }, function (e) { return e; });
  check('2.15 one of its lists cannot be read: the run fails before anything is written (never half taken over)', err && C.log.created.length === 0);
  check('2.16 recordsOf reads its seven lists', C.log.reads.filter(function (r) { return /:prev$/.test(r); }).length === 7);
  w.RevampCore = null;
  err = await E.carryOver({ from: 'prev', to: 'next', kinds: ['speakers'], state: { done: {}, made: {} } }).then(function () { return null; }, function (e) { return e; });
  check('2.17 without RevampCore: the page did not load, said so', err && /did not load completely/.test(err.message));
  check('2.18 unfinished: none for an empty or odd state', J(E.unfinished(null)) === '[]' && J(E.unfinished({ made: { speakers: 'x' } })) === '[]' &&
    J(E.unfinished({ done: { speakers: 'copied' }, made: { speakers: ['a'] } })) === '[]' && J(E.unfinished({ done: {}, made: { gallery: ['a'] } })) === '["glimpses"]');

  /* the existing "Use a previous edition's content" takes the same rule */
  var content = E.toContent(previous());
  check('3.1 toContent leaves out a speaker or sponsor who was not on its site', J(content.speakers.items.map(function (x) { return x.n; })) === J(['Ravi Iyer', 'Asha Rao']) &&
    content.partners.tiers.every(function (t) { return t.logos.every(function (l) { return l.n !== 'Tentative Co'; }); }) &&
    content.agenda.items[0].sp === 'Ravi Iyer, Asha Rao', content);

  console.log('create-event-start-edition: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}
main().catch(function (e) { console.error(e); process.exitCode = 1; });
