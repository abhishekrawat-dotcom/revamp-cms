/* node functions/lib/dash-bot-portals.test.js — ETB2B AI on the events dashboard knows ET's portals (plan §17, the
   owner's request of 3 Nov 2026, after the portals change): the server half (lib/dash-bot.js).
     P.1  a portal is taken only from ET's roster, and only when the person said it (portalSaid, namedPortals)
     P.2  the request's view: the portal shown and the portal worked in; the prompt says both, and lists the roster
     P.3  filters: "Show ETHRWorld's drafts" names that portal; one the person did not say is dropped
     P.4  lists: in the portal named, across all portals (each row's portal), or the events with no portal yet
     P.5  "switch to ETAuto": kind portal, only to a roster portal said; "already there"; "no portal" is a look instead
     P.6  Create Event's portal: the one named, else the one worked in
     P.7  events with no portal are found, opened and said to have none; another portal's event is said to be there
     P.8  setting an event's portal is refused, pointing to its Basics
     P.9  the whole route: a switch is stored done, and the memory says what happened
     P.10 an answer across portals says its scope and each event's portal (QA follow-up 2 F6, plan §15d)
   No network, no AI: the model is stubbed and Firestore is in memory. */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- an in-memory Firestore: documents by path, set (merge), update, a query by order and limit, transactions ---------- */
function fakeFb() {
  var docs = {}, seq = 0;
  function isInc(v) { return !!v && typeof v === 'object' && typeof v.operand === 'number'; }
  function write(target, data, merge) {
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      if (isInc(v)) target[k] = (typeof target[k] === 'number' ? target[k] : 0) + v.operand;
      else if (merge && v && typeof v === 'object' && !Array.isArray(v)) { if (!target[k] || typeof target[k] !== 'object') target[k] = {}; write(target[k], v, true); }
      else target[k] = clone(v);
    });
  }
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { if (!(o && o.merge) || !docs[p]) docs[p] = (o && o.merge && docs[p]) || {}; write(docs[p], data, !!(o && o.merge)); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); write(docs[p], data, false); return Promise.resolve(); } };
  }
  function colRef(p, order, lim) {
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(16, '0')))); },
      orderBy: function (f, dir) { return colRef(p, { f: f, desc: dir === 'desc' }, lim); },
      limit: function (n) { return colRef(p, order, n); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        if (order) {
          list = list.filter(function (s) { return s.data()[order.f] !== undefined; });
          list.sort(function (a, b) { var x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1)) * (order.desc ? -1 : 1); });
        }
        if (lim) list = list.slice(0, lim);
        return Promise.resolve({ docs: list });
      } };
  }
  function runTransaction(fn) {
    var writes = [];
    var tx = { get: function (ref) { return ref.get(); }, set: function (ref, d, o) { writes.push(function () { return ref.set(d, o); }); }, update: function (ref, d) { writes.push(function () { return ref.update(d); }); } };
    return Promise.resolve(fn(tx)).then(function (out) { return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return out; }); });
  }
  return { db: { collection: function (n) { return colRef(n); }, runTransaction: runTransaction }, bucket: { name: 'test-bucket' }, docs: docs };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };

/* the model, stubbed: each ask answers what the check scripted */
var llm = require('./llm');
var calls = [], answers = [];
llm.callJson = function (prompt, schema, opts) {
  calls.push({ prompt: prompt, opts: opts });
  return Promise.resolve({ parsed: answers.length ? answers.shift() : { kind: 'reply', text: 'Hello.' }, provider: 'claude', model: 'claude-haiku-5-5' });
};

var bot = require('./dash-bot');
var T = bot._test;
var etEvents = require('./et-events');
var NOW = Date.UTC(2026, 10, 3, 6, 35);
T.clock.now = function () { return NOW; };

var ITEMS = [
  { id: 'cio-forum', data: { name: 'CIO Leaders Forum 2026', category: 'ip', published: true, start: '2026-11-20T09:00', end: '2026-11-21T18:00', city: 'Pune', portal: 'cio', portalName: 'ETCIO', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' } },
  { id: 'cio-draft', data: { name: 'CIO Draft Meet', category: 'ip', published: false, start: '2026-11-25T09:00', portal: 'cio', portalName: 'ETCIO', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' } },
  { id: 'hr-draft', data: { name: 'HR Future of Work Summit', category: 'ip', published: false, start: '2026-11-12T09:00', city: 'Mumbai', portal: 'hr', portalName: 'ETHRWorld', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' } },
  { id: 'auto-tech', data: { name: 'Autotech Summit 2026', category: 'ip', published: true, start: '2026-11-05T09:00', end: '2026-11-06T18:00', city: 'Chennai', portal: 'auto', portalName: 'ETAuto', createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' } },
  { id: 'unsorted', data: { name: 'Unsorted Retail Meet', category: 'client', published: false, start: '2026-11-15T09:00', createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' } },
  { id: 'odd-portal', data: { name: 'Odd Portal Night', category: 'awards', published: true, start: '2026-11-28T18:00', portal: 'nowhere', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' } }
];
/* registrations and visitors are not what these checks are about: the totals are known to be unread */
function ctxWith(message, view, turns) {
  var ctx = T.contextFor({ decoded: { uid: 'u-asha', email: 'asha@timesinternet.in' }, name: 'Asha Rao', message: message, view: view || {}, docs: clone(ITEMS), now: NOW, turnId: 'TurnPortalTest0001', turns: turns || [] });
  ctx.events.forEach(function (ev) { ctx.totals[ev.id] = null; });
  return ctx;
}
function partsText(parts) { return (parts || []).map(function (p) { return p.t === 'event' ? p.name : p.v; }).join(''); }
function ids(list) { return (list && list.items || []).map(function (i) { return i.id; }); }
var ON_CIO = { portal: 'cio', working: 'cio' };

(async function () {
  /* ===== P.1 the roster, and only what the person said ===== */
  check('P.1 "ETHRWorld\'s drafts" names ETHRWorld', same(T.namedPortals('Show ETHRWorld\'s drafts'), ['hr']));
  check('P.1 "ETCIO" is ETCIO', same(T.namedPortals('events on ETCIO this month'), ['cio']));
  check('P.1 a name in any spacing: "ET HR World", "ET Auto"', same(T.namedPortals('the ET HR World drafts'), ['hr']) && same(T.namedPortals('switch to ET Auto'), ['auto']));
  check('P.1 a short name written as a name: "HR", "CIO", "HRWorld"', same(T.namedPortals('HR drafts'), ['hr']) && same(T.namedPortals('the CIO events'), ['cio']) && same(T.namedPortals('HRWorld drafts'), ['hr']));
  check('P.1 an everyday word is not a portal: "a retail summit about the auto industry"', same(T.namedPortals('create a retail summit about the auto industry'), []));
  check('P.1 …unless it is called a portal: "the retail portal"', same(T.namedPortals('on the retail portal'), ['retail']));
  check('P.1 a word that only contains a name is not it: "set automation"', same(T.namedPortals('set automation for hrs'), []));
  /* the assistant's own name is not the ET B2B portal: addressing it never names a portal */
  check('P.1 "ETB2B AI" (the assistant) names no portal, in any spacing', same(T.namedPortals('ETB2B AI, start an IP event called Retail Next'), []) &&
    same(T.namedPortals('Hey ET B2B AI show my drafts'), []) && same(T.namedPortals('ET-B2B-AI: switch to ETHRWorld'), ['hr']));
  check('P.1 …while the ET B2B portal itself is still named', same(T.namedPortals('Show ETB2B drafts'), ['b2b']) && same(T.namedPortals('switch to ET B2B'), ['b2b']));
  check('P.1 …so a create that only addressed the assistant keeps the working portal, and says the model\'s portal was not used',
    (function () { var c = T.cleanCreate({ category: 'IP', name: 'Retail Next', portal: 'b2b' }, ctxWith('ETB2B AI, start an IP event called Retail Next', ON_CIO)); return c.prefill.portal === 'cio' && c.dropped.indexOf('portal') !== -1; })());
  check('P.1 portalSlug: a slug or a name, never a portal ET does not have', T.portalSlug('ETCIO') === 'cio' && T.portalSlug('ET HR World') === 'hr' && T.portalSlug('cio') === 'cio' &&
    T.portalSlug('ETNews') === '' && T.portalSlug('nowhere') === '' && T.portalSlug('All') === 'all' && T.portalSlug('none') === 'none' && T.portalSlug('') === '');
  check('P.1 every portal the bot can take is on ET\'s roster', Object.keys(etEvents.PORTALS).every(function (slug) { return T.portalSlug(etEvents.PORTALS[slug]) === slug; }));
  check('P.1 "all portals" and "no portal" are said too', T.portalSaid('all', 'drafts across all portals') && T.portalSaid('all', 'in every portal') && !T.portalSaid('all', 'all drafts') &&
    T.portalSaid('none', 'events with no portal yet') && T.portalSaid('none', 'events without a portal') && !T.portalSaid('none', 'any portal'));
  check('P.1 portalSaid: a roster portal named, nothing else', T.portalSaid('hr', 'ETHRWorld drafts') && !T.portalSaid('cio', 'ETHRWorld drafts') && !T.portalSaid('nowhere', 'nowhere portal'));

  /* ===== P.2 the view and the prompt ===== */
  var v = T.cleanView({ portal: 'hr', working: 'cio' });
  check('P.2 view: the portal shown and the portal worked in', v.portal === 'hr' && v.working === 'cio', v);
  check('P.2 view: a page without "working" sends the portal it works in as "portal"', T.cleanView({ portal: 'cio' }).working === 'cio' && T.cleanView({ portal: 'none' }).working === '');
  check('P.2 view: off-roster values are nothing', T.cleanView({ portal: 'nowhere', working: '__proto__' }).portal === '' && T.cleanView({ portal: 'x', working: 'nowhere' }).working === '');
  var ctx = ctxWith('Which drafts are there?', { portal: 'hr', working: 'cio' });
  var prompt = T.buildPrompt(ctx);
  check('P.2 the prompt says where the person works and what the list shows for now', prompt.indexOf('Asha works in ETCIO (portal "cio"); the list shows ETHRWorld (portal "hr") for now.') !== -1,
    prompt.slice(prompt.indexOf('WHAT ASHA'), prompt.indexOf('WHAT ASHA') + 400));
  check('P.2 the prompt lists ET\'s roster, and nothing else as a portal', prompt.indexOf('ET PORTALS (slug "name"; these are the only portals there are): ') !== -1 && prompt.indexOf('hr "ETHRWorld"') !== -1 && prompt.indexOf('auto "ETAuto"') !== -1);
  check('P.2 each row has its portal, "no portal" for none (an off-roster one too)', /\ncio-forum \| [^\n]*\| ETCIO \|/.test(prompt) && /\nunsorted \| [^\n]*\| no portal \|/.test(prompt) && /\nodd-portal \| [^\n]*\| no portal \|/.test(prompt));
  check('P.2 the prompt asks for the portal kind and the portal fields', prompt.indexOf('- "portal": switch the dashboard') !== -1 && prompt.indexOf('`filter.portal` or `list.portal`') !== -1 && prompt.indexOf('{{<id>.portal}}') !== -1);
  check('P.2 an All-portals person: "works in all portals"', T.buildPrompt(ctxWith('hi', { portal: '', working: '' })).indexOf('Asha works in all portals.') !== -1);

  /* ===== P.3 filters ===== */
  ctx = ctxWith('Show ETHRWorld\'s drafts', ON_CIO);
  var a = await T.cleanAnswer({ kind: 'filter', filter: { view: 'draft', portal: 'hr' }, text: 'Here they are.' }, ctx);
  check('P.3 "Show ETHRWorld\'s drafts": the drafts of ETHRWorld, said on the card', a.action && a.action.type === 'filter' && a.action.patch.view === 'draft' && a.action.patch.portal === 'hr' &&
    a.action.label === 'Draft events · in ETHRWorld', a.action);
  a = await T.cleanAnswer({ kind: 'filter', filter: { view: 'draft', portal: 'ETHRWorld' }, text: 'x' }, ctx);
  check('P.3 …the model may write its name', a.action && a.action.patch.portal === 'hr');
  ctx = ctxWith('Show drafts', ON_CIO);
  a = await T.cleanAnswer({ kind: 'filter', filter: { view: 'draft', portal: 'hr' }, text: 'x' }, ctx);
  check('P.3 a portal the person did not say is dropped: the list stays on the portal it shows', a.action && a.action.patch.portal === 'cio' && a.notes.indexOf('portal-not-said') !== -1 &&
    a.action.label === 'Draft events · in ETCIO', [a.action, a.notes]);
  ctx = ctxWith('Show drafts with no portal yet', ON_CIO);
  a = await T.cleanAnswer({ kind: 'filter', filter: { view: 'draft', portal: 'none' }, text: 'x' }, ctx);
  check('P.3 "no portal yet" is a scope of its own', a.action && a.action.patch.portal === 'none' && a.action.label === 'Draft events · with no portal yet', a.action);
  ctx = ctxWith('Show the drafts across all portals', ON_CIO);
  a = await T.cleanAnswer({ kind: 'filter', filter: { view: 'draft', portal: 'all' }, text: 'x' }, ctx);
  check('P.3 "across all portals"', a.action && a.action.patch.portal === 'all' && a.action.label === 'Draft events · across all portals', a.action);
  ctx = ctxWith('Show ETHRWorld\'s events', ON_CIO);
  a = await T.cleanAnswer({ kind: 'filter', filter: { portal: 'hr' }, text: 'x' }, ctx);
  check('P.3 a portal alone is a filter (the tab on screen)', a.action && a.action.patch.portal === 'hr' && a.action.patch.view === 'active', a.action);
  a = await T.cleanAnswer({ kind: 'filter', filter: { view: 'draft', portal: 'hr' }, text: 'x' }, ctxWith('Show ETHRWorld\'s drafts', { portal: '', working: '' }));
  check('P.3 an All-portals person gets the portal they named', a.action && a.action.patch.portal === 'hr');
  a = await T.cleanAnswer({ kind: 'filter', filter: { view: 'draft' }, text: 'x' }, ctxWith('Show drafts', { portal: '', working: '' }));
  check('P.3 …and all portals otherwise', a.action && a.action.patch.portal === 'all' && a.action.label === 'Draft events · across all portals', a.action);

  /* ===== P.4 lists ===== */
  ctx = ctxWith('Which events are on ETCIO this month?', { portal: 'hr', working: 'hr' });
  a = await T.cleanAnswer({ kind: 'reply', text: 'Here are the events on ETCIO this month.', list: { portal: 'cio', startFrom: '2026-11-01', startTo: '2026-11-30' } }, ctx);
  check('P.4 "events on ETCIO this month": ETCIO\'s only, the title says so', !!a.list && same(ids(a.list).sort(), ['cio-draft', 'cio-forum']) && /in ETCIO$/.test(a.list.title), a.list);
  ctx = ctxWith('Which drafts are there?', ON_CIO);
  a = await T.cleanAnswer({ kind: 'reply', text: 'Here.', list: { statuses: ['draft'] } }, ctx);
  check('P.4 no portal named: the portal the list shows', !!a.list && same(ids(a.list), ['cio-draft']) && /in ETCIO$/.test(a.list.title), a.list);
  check('P.4 "Show these in the list" carries the portal', !!a.list.view && a.list.view.portal === 'cio', a.list.view);
  a = await T.cleanAnswer({ kind: 'reply', text: 'Here.', list: { statuses: ['draft'], portal: 'hr' } }, ctx);
  check('P.4 a list portal the person did not say is dropped', !!a.list && same(ids(a.list), ['cio-draft']) && a.notes.indexOf('portal-not-said') !== -1, [ids(a.list), a.notes]);
  ctx = ctxWith('Which drafts are there across all portals?', ON_CIO);
  a = await T.cleanAnswer({ kind: 'reply', text: 'Here.', list: { statuses: ['draft'], portal: 'all' } }, ctx);
  check('P.4 across all portals: every portal\'s drafts, each row naming its portal ("No portal yet" for none)', !!a.list && same(ids(a.list).sort(), ['cio-draft', 'hr-draft', 'unsorted']) &&
    a.list.showPortal === true && a.list.items.filter(function (i) { return i.id === 'unsorted'; })[0].portal === 'No portal yet' &&
    a.list.items.filter(function (i) { return i.id === 'hr-draft'; })[0].portal === 'ETHRWorld' && /across all portals$/.test(a.list.title), a.list);
  check('P.4 …"Show these in the list" works for another portal scope too (a look, for now)', !!a.list.view && a.list.view.portal === 'all', a.list.view);
  ctx = ctxWith('Which events have no portal yet?', ON_CIO);
  a = await T.cleanAnswer({ kind: 'reply', text: 'Here.', list: { statuses: [], portal: 'none' } }, ctx);
  check('P.4 the events with no portal yet are findable (an off-roster portal counts as none)', !!a.list && same(ids(a.list).sort(), ['odd-portal', 'unsorted']) && /with no portal yet$/.test(a.list.title), a.list);
  var r = await T.runList({ statuses: ['draft'], portal: 'ETHRWorld' }, ctxWith('x', ON_CIO));
  check('P.4 a list rule may name the portal by its name', same(ids(r.list), ['hr-draft']));
  r = await T.runList({ statuses: ['draft'] }, ctxWith('x', {}));
  check('P.4 before anyone works in a portal, and with portals on events: every portal, with each row\'s', same(ids(r.list).sort(), ['cio-draft', 'hr-draft', 'unsorted']) && r.list.showPortal === true);

  /* ===== P.5 switching the dashboard's portal ===== */
  ctx = ctxWith('Switch to ETAuto', ON_CIO);
  a = await T.cleanAnswer({ kind: 'portal', switchTo: { portal: 'auto' }, text: 'Switching to ETAuto.' }, ctx);
  check('P.5 "switch to ETAuto": kind portal, to auto, labelled with its name', a.kind === 'portal' && same(a.action, { type: 'portal', portal: 'auto', label: 'ETAuto' }) && a.memo === 'the dashboard was switched to ETAuto', a);
  a = await T.cleanAnswer({ kind: 'portal', switchTo: { portal: 'auto' }, text: '' }, ctx);
  check('P.5 …with no words, the product\'s own sentence', partsText(a.parts) === T.MSG.portalSwitch, partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'portal', switchTo: { portal: 'auto' }, text: 'I have switched you to ETAuto.' }, ctx);
  check('P.5 …and "I have switched you" is a claim the page has not made true yet: the product\'s sentence instead', partsText(a.parts) === T.MSG.portalSwitch && a.notes.indexOf('claim-dropped') !== -1, [partsText(a.parts), a.notes]);
  a = await T.cleanAnswer({ kind: 'portal', switchTo: { portal: 'all' }, text: 'x' }, ctxWith('Switch me to all portals', ON_CIO));
  check('P.5 "all portals"', a.action && a.action.portal === 'all' && a.action.label === 'All portals', a.action);
  a = await T.cleanAnswer({ kind: 'portal', switchTo: { portal: 'auto' }, text: 'Done, I switched it.' }, ctxWith('Switch the portal', ON_CIO));
  check('P.5 a portal the person did not name: no switch, it asks which', a.kind === 'reply' && a.action === null && partsText(a.parts) === T.MSG.whichPortal && a.notes.indexOf('portal-not-said') !== -1, [a.kind, partsText(a.parts)]);
  a = await T.cleanAnswer({ kind: 'portal', switchTo: { portal: 'ETNews' }, text: 'x' }, ctxWith('Switch to ETNews', ON_CIO));
  check('P.5 a portal ET does not have: no switch', a.kind === 'reply' && a.action === null && partsText(a.parts) === T.MSG.whichPortal);
  a = await T.cleanAnswer({ kind: 'portal', switchTo: { portal: 'cio' }, text: 'x' }, ctxWith('Switch to ETCIO', ON_CIO));
  check('P.5 already there: said, nothing done', a.kind === 'reply' && a.action === null && partsText(a.parts) === 'You already work in ETCIO.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'portal', switchTo: { portal: 'cio' }, text: 'x' }, ctxWith('Switch to ETCIO', { portal: 'hr', working: 'cio' }));
  check('P.5 looking at another portal for now: switching to the own one brings the list back', a.action && a.action.type === 'portal' && a.action.portal === 'cio');
  a = await T.cleanAnswer({ kind: 'portal', switchTo: { portal: 'none' }, text: 'x' }, ctxWith('Switch to the events with no portal', ON_CIO));
  check('P.5 "no portal" is not a portal to work in: those events are shown for now instead', a.kind === 'filter' && a.action.type === 'filter' && a.action.patch.portal === 'none', a.action);
  check('P.5 the schema has the switch, and the kind', T.SCHEMA.properties.kind.enum.indexOf('portal') !== -1 && !!T.SCHEMA.properties.switchTo.properties.portal);

  /* ===== P.6 Create Event's portal ===== */
  var c = T.cleanCreate({ name: 'QA Expo', category: 'IP', portal: 'cio' }, ctxWith('Create an IP event on ETCIO called QA Expo', { portal: 'hr', working: 'hr' }));
  check('P.6 the portal named: ETCIO, over the one worked in', c.prefill.portal === 'cio' && c.dropped.indexOf('portal') === -1, c);
  c = T.cleanCreate({ name: 'QA Expo', category: 'IP', portal: 'ETCIO' }, ctxWith('Create an IP event on ETCIO called QA Expo', { portal: 'hr', working: 'hr' }));
  check('P.6 …by its name too', c.prefill.portal === 'cio');
  c = T.cleanCreate({ name: 'QA Expo', category: 'IP', portal: '' }, ctxWith('Create an IP event called QA Expo', { portal: 'auto', working: 'hr' }));
  check('P.6 none named: the portal worked in, not the one looked at for now', c.prefill.portal === 'hr', c.prefill.portal);
  c = T.cleanCreate({ name: 'QA Expo', category: 'IP', portal: 'retail' }, ctxWith('Create a retail summit called QA Expo', ON_CIO));
  check('P.6 an everyday word is not a portal named: the one worked in, and the card says the portal was left out', c.prefill.portal === 'cio' && c.dropped.indexOf('portal') !== -1, c);
  c = T.cleanCreate({ name: 'QA Expo', category: 'IP', portal: 'nowhere' }, ctxWith('Create QA Expo on the nowhere portal', { portal: '', working: '' }));
  check('P.6 never a portal ET does not have; All portals gives none (Create Event asks)', c.prefill.portal === '', c.prefill.portal);

  /* ===== P.7 events with no portal, and events on another portal ===== */
  ctx = ctxWith('Take me to the Unsorted Retail Meet editor', ON_CIO);
  a = await T.cleanAnswer({ kind: 'open', events: ['unsorted'], open: { target: 'editor' }, text: 'Opening its editor.' }, ctx);
  check('P.7 an event with no portal opens, and is said to have none', a.action && a.action.url === '/edit-event.html?event=unsorted#design/editor' && /It has no portal yet\.$/.test(partsText(a.parts)), partsText(a.parts));
  ctx = ctxWith('Open the Autotech editor', ON_CIO);
  a = await T.cleanAnswer({ kind: 'open', events: ['auto-tech'], open: { target: 'editor' }, text: 'Opening its editor.' }, ctx);
  check('P.7 an event on another portal opens, and its portal is named', a.action && /It is on ETAuto\.$/.test(partsText(a.parts)), partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'open', events: ['cio-forum'], open: { target: 'editor' }, text: 'Opening its editor.' }, ctxWith('Open the CIO forum editor', ON_CIO));
  check('P.7 one on the portal shown: nothing more said', a.action && partsText(a.parts) === 'Opening its editor.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'promo', events: ['unsorted'], promo: { mailer: 'mailer.announcement' }, text: 'Opening Promotions.' }, ctxWith('Make an announcement mailer for the Unsorted Retail Meet', ON_CIO));
  check('P.7 Promotions of an event with no portal: said too', a.action && /It has no portal yet\.$/.test(partsText(a.parts)), partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'reply', events: ['unsorted', 'hr-draft'], text: '{{unsorted}} is on {{unsorted.portal}}. {{hr-draft}} is on {{hr-draft.portal}}.' }, ctxWith('Which portals are they on?', ON_CIO));
  check('P.7 {{id.portal}}: "no portal yet", or its name', partsText(a.parts) === 'Unsorted Retail Meet is on no portal yet. HR Future of Work Summit is on ETHRWorld.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'open', events: ['cio-forum', 'auto-tech'], open: { target: 'console' }, text: 'Which one?' }, ctxWith('Open the summit', ON_CIO));
  check('P.7 choices name each event\'s portal', a.kind === 'choose' && a.choices[0].portal === 'ETCIO' && a.choices[1].portal === 'ETAuto', a.choices);
  ctx = T.contextFor({ decoded: { email: 'asha@timesinternet.in' }, name: 'Asha', message: 'Open it', view: {}, docs: [{ id: 'plain', data: { name: 'Plain Event', createdAt: '2026-10-01T00:00:00.000Z' } }], now: NOW });
  a = await T.cleanAnswer({ kind: 'open', events: ['plain'], open: { target: 'console' }, text: 'Opening it.' }, ctx);
  check('P.7 with no portals in play at all, nothing about portals is said', a.action && partsText(a.parts) === 'Opening it.' && ctx.hasPortals === false, partsText(a.parts));

  /* ===== P.10 an answer across portals says so (QA follow-up 2 F6, plan §15d) =====
     "How many registrations does each QA Dashbot event have, across all portals?" named five events from ETCIO,
     ETHRWorld and none, as one undifferentiated list. */
  var ALL = { portal: '', working: '' };
  function withTotals(c) {
    var n = { 'cio-forum': 37, 'cio-draft': 0, 'hr-draft': 18, 'auto-tech': 9, unsorted: 5 };
    Object.keys(n).forEach(function (id) { c.totals[id] = { registrations: n[id], visitors: 0, confirmed: 0, waitlist: 0, cancelledRegs: 0, checkedIn: 0, pending: 0, uniques: 0, conversion: 0 }; });
    return c;
  }
  var EACH = 'So far, {{unsorted}} has {{unsorted.registrations}} registrations, {{hr-draft}} has {{hr-draft.registrations}}, {{cio-forum}} has {{cio-forum.registrations}}, and {{cio-draft}} has {{cio-draft.registrations}}.';
  a = await T.cleanAnswer({ kind: 'reply', events: ['unsorted', 'hr-draft', 'cio-forum', 'cio-draft'], text: EACH }, withTotals(ctxWith('How many registrations does each event have, across all portals?', ALL)));
  check('P.10 All portals: each event\'s name is followed by its portal, "no portal yet" for none, and the answer says its scope',
    partsText(a.parts) === 'So far, Unsorted Retail Meet (no portal yet) has 5 registrations, HR Future of Work Summit (ETHRWorld) has 18, CIO Leaders Forum 2026 (ETCIO) has 37, and CIO Draft Meet (ETCIO) has 0. That is across all portals.',
    partsText(a.parts));
  check('P.10 …the names stay links and the numbers stay values (the tags are plain text beside them)', a.parts.filter(function (p) { return p.t === 'event'; }).length === 4 &&
    a.parts.filter(function (p) { return p.t === 'value'; }).length === 4 && a.parts.every(function (p, i) { return !(p.t === 'text' && a.parts[i + 1] && a.parts[i + 1].t === 'text'); }), a.parts);
  check('P.10 …the stored answer keeps its tokens (the memory names events by id)', a.answerRaw === EACH, a.answerRaw);
  a = await T.cleanAnswer({ kind: 'reply', events: ['hr-draft', 'cio-forum'], text: 'Across all portals, {{hr-draft}} has {{hr-draft.registrations}} and {{cio-forum}} has {{cio-forum.registrations}} registrations.' },
    withTotals(ctxWith('registrations across all portals?', ALL)));
  check('P.10 All portals, an answer that already says so: not said twice', partsText(a.parts) === 'Across all portals, HR Future of Work Summit (ETHRWorld) has 18 and CIO Leaders Forum 2026 (ETCIO) has 37 registrations.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'reply', events: ['cio-forum'], text: '{{cio-forum}} has {{cio-forum.registrations}} registrations so far.' }, withTotals(ctxWith('How many for the CIO forum?', ALL)));
  check('P.10 All portals, one event: its portal, and no scope sentence (one event is no mix)', partsText(a.parts) === 'CIO Leaders Forum 2026 (ETCIO) has 37 registrations so far.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'reply', events: ['cio-forum', 'cio-draft'], text: '{{cio-forum}} has {{cio-forum.registrations}} and {{cio-draft}} has {{cio-draft.registrations}}.' }, withTotals(ctxWith('both?', ON_CIO)));
  check('P.10 looking at ETCIO, events on ETCIO: nothing added (as before)', partsText(a.parts) === 'CIO Leaders Forum 2026 has 37 and CIO Draft Meet has 0.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'reply', events: ['hr-draft'], text: '{{hr-draft}} has {{hr-draft.registrations}} registrations so far.' }, withTotals(ctxWith('And the HR summit?', ON_CIO)));
  check('P.10 looking at ETCIO, an event on another portal: its portal is said', partsText(a.parts) === 'HR Future of Work Summit (ETHRWorld) has 18 registrations so far.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'reply', events: ['cio-forum', 'hr-draft'], text: '{{cio-forum}} has {{cio-forum.registrations}} and {{hr-draft}} has {{hr-draft.registrations}}.' }, withTotals(ctxWith('Compare them', ON_CIO)));
  check('P.10 looking at ETCIO, events from two portals: each one\'s portal, and that they are on more than one',
    partsText(a.parts) === 'CIO Leaders Forum 2026 (ETCIO) has 37 and HR Future of Work Summit (ETHRWorld) has 18. These events are on more than one portal.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'reply', events: ['hr-draft', 'unsorted'], text: '{{hr-draft}} has {{hr-draft.registrations}}. {{hr-draft}} is on ETHRWorld; {{unsorted}} has {{unsorted.registrations}}.' },
    withTotals(ctxWith('these two?', ON_CIO)));
  check('P.10 an event named twice is tagged once, the first time', partsText(a.parts) === 'HR Future of Work Summit (ETHRWorld) has 18. HR Future of Work Summit is on ETHRWorld; Unsorted Retail Meet (no portal yet) has 5. These events are on more than one portal.',
    partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'reply', events: ['auto-tech'], text: '{{auto-tech}} is live at {{auto-tech.site}}.' }, withTotals(ctxWith('Where is the Autotech site?', ON_CIO)));
  check('P.10 only an event\'s own name is tagged, never its live address', partsText(a.parts) === 'Autotech Summit 2026 (ETAuto) is live at /e/auto-tech.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'open', events: ['auto-tech'], open: { target: 'editor' }, text: 'Opening the editor of {{auto-tech}}.' }, ctxWith('Open the Autotech editor', ON_CIO));
  check('P.10 opening an event on another portal: the product\'s own line says it once, and the name is not tagged as well',
    partsText(a.parts) === 'Opening the editor of Autotech Summit 2026. It is on ETAuto.', partsText(a.parts));
  a = await T.cleanAnswer({ kind: 'reply', events: ['unsorted', 'hr-draft'], text: '{{unsorted}} is on {{unsorted.portal}}. {{hr-draft}} is on {{hr-draft.portal}}.' }, ctxWith('Which portals are they on?', ALL));
  check('P.10 All portals, every portal already said by the answer: not tagged again, and the scope said', partsText(a.parts) === 'Unsorted Retail Meet is on no portal yet. HR Future of Work Summit is on ETHRWorld. That is across all portals.',
    partsText(a.parts));
  /* a list carries its scope in its title and rows: the model's own title keeps it too */
  a = await T.cleanAnswer({ kind: 'reply', text: 'Here they are.', list: { title: 'Upcoming drafts', statuses: ['draft'] } }, ctxWith('List the drafts across all portals', ALL));
  check('P.10 a list across all portals: the model\'s own title keeps the scope, its rows their portals, and no sentence is added', !!a.list && a.list.title === 'Upcoming drafts · across all portals' &&
    a.list.showPortal === true && a.list.items.every(function (i) { return typeof i.portal === 'string' && i.portal; }) && partsText(a.parts) === 'Here they are.', [a.list && a.list.title, partsText(a.parts)]);
  a = await T.cleanAnswer({ kind: 'reply', text: 'Here they are.', list: { title: 'Drafts across all portals', statuses: ['draft'] } }, ctxWith('List the drafts across all portals', ALL));
  check('P.10 …a title that already says it is kept as it is', !!a.list && a.list.title === 'Drafts across all portals', a.list && a.list.title);
  a = await T.cleanAnswer({ kind: 'reply', text: 'Here they are.', list: { title: 'Drafts', statuses: ['draft'], portal: 'hr' } }, ctxWith('List ETHRWorld\'s drafts', ON_CIO));
  check('P.10 …and one portal\'s list says that portal', !!a.list && a.list.title === 'Drafts · in ETHRWorld', a.list && a.list.title);
  var NOPORT = T.contextFor({ decoded: { email: 'asha@timesinternet.in' }, name: 'Asha', message: 'both?', view: {}, now: NOW,
    docs: [{ id: 'a1', data: { name: 'Alpha Meet', category: 'ip', createdAt: '2026-10-01T00:00:00.000Z' } }, { id: 'b1', data: { name: 'Beta Meet', category: 'ip', createdAt: '2026-10-01T00:00:00.000Z' } }] });
  a = await T.cleanAnswer({ kind: 'reply', events: ['a1', 'b1'], text: '{{a1}} and {{b1}} are both drafts.' }, NOPORT);
  check('P.10 with no portals in play at all, nothing about portals is said', NOPORT.hasPortals === false && partsText(a.parts) === 'Alpha Meet and Beta Meet are both drafts.', partsText(a.parts));

  /* ===== P.8 setting an event's portal is the person's ===== */
  a = await T.cleanAnswer({ kind: 'refuse', events: ['auto-tech'], refuse: { action: 'set-portal' }, text: 'Moving it now.' }, ctxWith('Move Autotech to ETCIO', ON_CIO));
  check('P.8 refused with the fixed sentence, pointing to the event\'s Basics', a.kind === 'refuse' && a.action.what === 'set-portal' && partsText(a.parts) === T.REFUSALS['set-portal'].text &&
    a.action.pointer.href === '/edit-event.html?event=auto-tech#content/basics', a.action);

  /* ===== P.9 the whole route ===== */
  var helpers = {
    withAdmin: function (req, res, cb) { cb(FB, { uid: 'u-asha', email: 'asha@timesinternet.in', name: 'Asha Rao' }); },
    withAdminBody: function (req, res, max, cb) { helpers.withAdmin(req, res, function (fb, d) { cb(fb, d, JSON.parse(req.rawBody)); }); },
    sendJson: function (res, status, obj) { res.statusCode = status; res.end(JSON.stringify(obj)); },
    sendFailure: function (res, what, err) { console.error(what, err && err.stack); res.statusCode = 500; res.end('{}'); },
    sendAiFailure: function (res, r) { res.statusCode = r.status; res.end(JSON.stringify(r)); },
    BODY_LIMITS: { small: 256 * 1024, tiny: 16 * 1024 }, chatRateOk: function () { return true; },
    chatUid: function (d) { return d.uid; }, chatName: function (d) { return d.name; },
    approvalsConfig: function () { return Promise.resolve({ approvers: [] }); },
    liveEventDocs: function () { return Promise.resolve(clone(ITEMS)); }
  };
  bot.wire(helpers);
  function ask(message, view) {
    return new Promise(function (resolve) {
      var res = { statusCode: 200, writeHead: function (s) { res.statusCode = s; }, end: function (b) { resolve({ status: res.statusCode, body: JSON.parse(b) }); } };
      bot.handleChat({ method: 'POST', url: '/api/dash-bot', headers: {}, rawBody: JSON.stringify({ message: message, view: view }) }, res);
    });
  }
  answers.push({ kind: 'portal', switchTo: { portal: 'auto' }, text: 'Switching to ETAuto.' });
  var out = await ask('switch to ETAuto', { tab: 'active', portal: 'cio', working: 'cio' });
  check('P.9 a switch through the route: 200, kind portal, the action', out.status === 200 && out.body.kind === 'portal' && same(out.body.action, { type: 'portal', portal: 'auto', label: 'ETAuto' }), out.body);
  var turnPath = Object.keys(FB.docs).filter(function (k) { return k.indexOf('dashChats/u-asha/turns/') === 0; })[0];
  var turn = turnPath ? FB.docs[turnPath] : null;
  check('P.9 …stored done, with what was done for the memory', !!turn && turn.status === 'done' && turn.action.type === 'portal' && turn.action.memo === 'the dashboard was switched to ETAuto', turn);
  answers.push({ kind: 'reply', text: 'Hello.' });
  await ask('and now?', { tab: 'active', portal: 'auto', working: 'auto' });
  var mem = calls[calls.length - 1].prompt;
  check('P.9 the next prompt remembers it, and says where the person now works', mem.indexOf('[What happened: the dashboard was switched to ETAuto]') !== -1 && mem.indexOf('Asha works in ETAuto (portal "auto").') !== -1,
    mem.slice(mem.indexOf('THE CONVERSATION'), mem.indexOf('THE CONVERSATION') + 500));

  console.log('dash-bot-portals: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
