/* node functions/lib/site-save-names.test.js — exits 1 on the first failure it lists. No network, no Firebase (a fake
   Storage and Firestore in memory).

   NEW-5 (first-time-user QA follow-up, 14 Nov 2026): the Activity log and the approver's list of changes named a site's
   sections by their ids in words — "Site saved › version 2 — 2 sections edited (Overview, Key topic)", "version 3 —
   updated automatically when the site editor opened: 1 added, content: 1 session added (Auto sessions, Session)" —
   while the site editor and the check before publishing call them "Key Discussion Points" and "Agenda". A save now
   names them as the editor lists them (lib/api.js recordSave reads the site's names with sectionNamesFor, the ones
   the check uses), and a record by the section that shows it. */
'use strict';
var fs = require('fs'), path = require('path');
var api = require('./api');
var SC = require('./site-checks');
var hooks = api._testHooks;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 900) : '')); }

var ROOT = path.join(__dirname, '..', '..');
function page(body) { return '<!DOCTYPE html><html><head><title>x</title></head><body data-rv-template-id="making-ai-work">' + body + '</body></html>'; }
/* a real template's section as a saved page has it: the loader marks its root with its id, the editor gives it its key */
function onPage(tpl, sec) {
  return fs.readFileSync(path.join(ROOT, 'templates', tpl, 'sections', sec, 'index.html'), 'utf8')
    .replace(/<section\b/, '<section data-rv-section="' + sec + '" data-rv-key="' + sec + '"');
}

/* ---------- a fake Storage and Firestore: documents by path, objects by path, transactions run at once ---------- */
function fakeFb(docs, objects) {
  function plain(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype; }
  function snapOf(p) {
    var d = docs[p];
    return { exists: !!d, id: p.split('/').pop(), data: function () { return d ? JSON.parse(JSON.stringify(d)) : undefined; }, ref: docRef(p) };
  }
  function coll(p) {
    return {
      doc: function (id) { return docRef(p + '/' + id); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).sort().map(snapOf);
        return Promise.resolve({ docs: list, empty: !list.length, size: list.length });
      },
      orderBy: function () { return this; }, limit: function () { return this; }, where: function () { return this; },
      add: function (v) { var id = 'n' + String(Object.keys(docs).length).padStart(4, '0'); docs[p + '/' + id] = JSON.parse(JSON.stringify(v)); return Promise.resolve({ id: id }); }
    };
  }
  function docRef(p) {
    return {
      path: p, id: p.split('/').pop(),
      get: function () { return Promise.resolve(snapOf(p)); },
      collection: function (name) { return coll(p + '/' + name); },
      update: function (v) {
        var d = Object.assign({}, docs[p]);
        Object.keys(v).forEach(function (k) { if (plain(v[k])) delete d[k]; else d[k] = JSON.parse(JSON.stringify(v[k])); });   // FieldValue.delete()
        docs[p] = d;
        return Promise.resolve();
      },
      set: function (v) { docs[p] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); }
    };
  }
  return {
    docs: docs, objects: objects,
    bucket: {
      name: 'revamp-cms.firebasestorage.app',
      file: function (p) {
        return {
          download: function () { return Object.prototype.hasOwnProperty.call(objects, p) ? Promise.resolve([Buffer.from(objects[p], 'utf8')]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
          save: function (buf) { objects[p] = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf); return Promise.resolve(); },
          exists: function () { return Promise.resolve([Object.prototype.hasOwnProperty.call(objects, p)]); }
        };
      }
    },
    db: {
      collection: function (name) { return coll(name); },
      runTransaction: function (fn) {
        return Promise.resolve(fn({ get: function (ref) { return ref.get(); }, update: function (ref, v) { return ref.update(v); }, set: function (ref, v) { return ref.set(v); } }));
      }
    }
  };
}
function activity(fb, eventId) {
  return Object.keys(fb.docs).filter(function (k) { return k.indexOf('events/' + eventId + '/activity/') === 0; }).sort().map(function (k) { return fb.docs[k]; });
}
function changes(fb, eventId) {
  return Object.keys(fb.docs).filter(function (k) { return k.indexOf('events/' + eventId + '/changes/') === 0; }).sort().map(function (k) { return fb.docs[k]; });
}
/* stageContent with a change of its own (opts.transform, the operator's way in): the version is recorded by recordSave */
function stage(fb, eventId, after, kind) {
  return hooks.stageContent(fb, eventId, { email: 'qa-agent@timesinternet.in' }, { kind: kind, transform: function () { return { html: after, changed: true }; } });
}
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

/* ---------- the site of the first-time-user run: Dark keynote (making-ai-work) ---------- */
var V1 = page(onPage('making-ai-work', 'banner') + onPage('making-ai-work', 'overview') + onPage('making-ai-work', 'key-topic') + onPage('making-ai-work', 'our-speakers'));
var V2 = V1.replace('Value: The Economics Of Autonomy', 'Value: What AI is worth to HR').replace(/(<section data-rv-section="overview"[\s\S]*?<p[^>]*>)/, '$1Our own overview. ');
ok(V2 !== V1 && (V2.match(/Our own overview\./g) || []).length === 1, 'the test\'s edit of the overview took', V2.length);
function agenda(rows) {
  return '<section data-rv-section="auto-sessions" data-rv-key="auto-sessions" data-rv-auto="sessions" id="sessions"><div class="rva-wrap"><h2 class="rva-title">Agenda</h2><div class="rva-list">' +
    '<article class="rva-row" data-rv-repeat-template="sessions"><div class="rva-time" data-rv-field="time">Time</div><div class="rva-what"><h3 class="rva-name" data-rv-field="title">Session title</h3></div></article>' +
    rows.map(function (r, i) { return '<article class="rva-row" data-rv-repeat-template="sessions" data-rv-filled="" data-rv-id="s' + (i + 1) + '"><div class="rva-time" data-rv-field="time">10:00</div><div class="rva-what"><h3 class="rva-name" data-rv-field="title">' + r + '</h3></div></article>'; }).join('') +
    '</div></div></section>';
}
var V3 = V2.replace('</body>', agenda(['Opening keynote']) + '</body>');

var NOW = '2026-11-14T08:00:00.000Z';
var fb = fakeFb({ 'events/qa-n': { name: 'QA HR Leaders Summit 2027', createdAt: NOW, templateId: 'making-ai-work', site: { version: 1, templateId: 'making-ai-work' } } },
  { 'events/qa-n/site/page.html': V1 });

var run = stage(fb, 'qa-n', V2, '').then(function (out) {
  ok(out.staged === true && out.version === 2, 'the edit is kept as version 2', out);
  return tick();
}).then(function () {
  var log = activity(fb, 'qa-n'), ch = changes(fb, 'qa-n');
  var line = log.length ? log[log.length - 1].detail : '';
  ok(line === 'version 2 — 2 sections edited (Overview, Key Discussion Points)', 'NEW-5 the Activity log: "2 sections edited (Overview, Key Discussion Points)", not "(Overview, Key topic)"', line);
  ok(ch.length === 1 && ch[0].items.map(function (i) { return i.name; }).join('|') === 'Overview|Key Discussion Points',
    'NEW-5 the version\'s changes (what the approver is shown) name them the same', ch.length && ch[0].items);
  return stage(fb, 'qa-n', V3, 'automatic');
}).then(function (out) {
  ok(out.staged === true && out.version === 3, 'the editor\'s automatic update is version 3', out);
  return tick();
}).then(function () {
  var log = activity(fb, 'qa-n'), ch = changes(fb, 'qa-n');
  var line = log[log.length - 1].detail, last = ch[ch.length - 1];
  ok(line === 'version 3 — updated automatically when the site editor opened: 1 added, content: 1 session added (Agenda)',
    'NEW-5 the Agenda section the editor adds, with its session: "(Agenda)", never "(Auto sessions, Session)"', line);
  ok(last.kind === 'automatic' && last.items.map(function (i) { return i.type + ':' + i.name + ':' + (i.place || ''); }).join('|') === 'added:Agenda:|record-added:Session:Agenda' &&
    !/Auto sessions/i.test(JSON.stringify(last.items)), 'NEW-5 the approver sees "Agenda" added and its session in "Agenda"', last.items);
  return stage(fb, 'qa-n', V3.replace('Opening keynote</h3></div></article>', 'Opening keynote</h3></div></article><article class="rva-row" data-rv-repeat-template="sessions" data-rv-filled="" data-rv-id="s2"><div class="rva-time" data-rv-field="time">11:00</div><div class="rva-what"><h3 class="rva-name" data-rv-field="title">Closing panel</h3></div></article>'), '');
}).then(function () { return tick(); }).then(function () {
  var log = activity(fb, 'qa-n');
  ok(log[log.length - 1].detail === 'version 4 — Content: 1 session added (Agenda)', 'NEW-5 a session added in Content: the section that shows it', log[log.length - 1].detail);
});

/* ---------- an AI-designed site: its plan's names, as the editor lists them; a section from the gallery by its heading ---------- */
var G1 = page('<header data-rv-section="nav" data-rv-key="nav"><a href="#why-attend">Why attend</a></header>' +
  '<section data-rv-section="why-attend" data-rv-key="why-attend" id="why-attend"><h2>Why attend</h2><p>Meet the people who run HR.</p></section>' +
  '<section data-rv-section="generic" data-rv-key="generic" class="rv-generic"><h2>Our partners’ pledge</h2><p>One line.</p></section>');
var G2 = G1.replace('Why attend</a>', 'Why come</a>').replace('Meet the people who run HR.', 'Meet the people who lead HR.').replace('One line.', 'Two lines.');
var fbG = fakeFb({ 'events/qa-g': { name: 'QA AI Summit', createdAt: NOW, templateId: 'gen-qa-g', site: { version: 4, templateId: 'gen-qa-g' },
  designPlan: { sections: [{ id: 'why-attend', name: 'Why you should come' }, { id: 'stats', name: 'stats' }] } } }, { 'events/qa-g/site/page.html': G1 });
run = run.then(function () { return stage(fbG, 'qa-g', G2, ''); }).then(function () { return tick(); }).then(function () {
  var line = activity(fbG, 'qa-g').pop().detail;
  ok(line === 'version 5 — 3 sections edited (Top bar, Why you should come, Our partners’ pledge)',
    'NEW-5 an AI-designed site: its plan\'s names ("Top bar", "Why you should come"), and a section from the gallery by its heading, as the check names it', line);
  var named = Object.assign({}, hooks.TOKEN_KIT, { names: hooks.sectionNamesFor(fbG.docs['events/qa-g']) });
  var ph = SC.placeholderHits(G2.replace('Two lines.', 'Lorem ipsum dolor sit amet.'), named);
  ok(ph.length && ph[0].sections[0] === 'Our partners’ pledge', 'NEW-5 …the same name the check gives that section', ph);
});

/* ---------- names that cannot be read never stop a save from being recorded: its ids in words, as before ---------- */
var fbB = fakeFb({ 'events/qa-b': { name: 'QA Broken Plan', createdAt: NOW, templateId: 'gen-qa-b', site: { version: 1, templateId: 'gen-qa-b' }, designPlan: { sections: 'not a list' } } },
  { 'events/qa-b/site/page.html': G1 });
var said = [], error = console.error;
run = run.then(function () {
  console.error = function (m) { said.push(String(m)); };
  return stage(fbB, 'qa-b', G2, '');
}).then(function (out) {
  console.error = error;
  return tick().then(function () {
    var line = activity(fbB, 'qa-b').pop().detail;
    ok(out.version === 2 && changes(fbB, 'qa-b').length === 1 && line === 'version 2 — 3 sections edited (Nav, Why attend, Generic)' &&
      said.some(function (m) { return /the section names of qa-b could not be read/.test(m); }), 'NEW-5 a plan that cannot be read: the save is recorded all the same, named as before, and the reason logged', [line, said]);
  });
}, function (err) { console.error = error; ok(false, 'NEW-5 a plan that cannot be read stopped the save', err && err.stack); });

/* ---------- a long name (a section named by its heading) is cut at a word in the log ---------- */
var L1 = page('<section data-rv-section="generic" data-rv-key="generic"><h2>The future of work and the leaders who are building it today</h2><p>a</p></section>');
var fbL = fakeFb({ 'events/qa-l': { name: 'QA Long', createdAt: NOW, templateId: 'making-ai-work', site: { version: 1, templateId: 'making-ai-work' } } }, { 'events/qa-l/site/page.html': L1 });
run = run.then(function () { return stage(fbL, 'qa-l', L1.replace('<p>a</p>', '<p>b</p>'), ''); }).then(function () { return tick(); }).then(function () {
  var line = activity(fbL, 'qa-l').pop().detail, m = /\(([^)]*)\)$/.exec(line), name = m ? m[1] : '';
  ok(name.length <= 40 && /…$/.test(name) && 'The future of work and the leaders who are building it today'.indexOf(name.slice(0, -1)) === 0 && !/\s…$/.test(name),
    'NEW-5 a long section name is cut at a word, within the 40 letters the log keeps', line);
});

/* ---------- the approval request compares the live version with the proposed one by the same names ---------- */
var API = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
ok(/items = diffPages\(before, after, \{ names: sectionNamesFor\(data\) \}\)/.test(API), 'NEW-5 the approver\'s list (live against proposed) is named the same way');
ok((API.match(/return recordSave\([^\n]*event: /g) || []).length === 3, 'NEW-5 every save hands its event to recordSave (a save, Content, the site check\'s repair)');

run.then(function () {
  if (failures.length) {
    console.log(failures.length + ' of ' + checks + ' checks FAILED:\n\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('site-save-names: all ' + checks + ' checks passed');
}, function (err) {
  console.log('site-save-names: the test itself failed — ' + (err && err.stack || err));
  process.exit(1);
});
