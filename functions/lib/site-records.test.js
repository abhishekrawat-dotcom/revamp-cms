/* node functions/lib/site-records.test.js — Content reaches the site (UX-101, UX-114, UX-076, UX-147):
     1. lib/site-records.js renderRecords: the event's records drawn into a saved AI-designed page the way the
        editor draws them (applyGenericRepeat), only where something changes, and the rule for what leaves the page
        when a list is empty (a Register button no longer keeps a section on show when the page has others);
     2. the routes, through the real router against an in-memory Firestore and Storage: POST /api/event/site/records
        stages a Content change as a version of its own; a save from the editor builds on such versions without a
        conflict and keeps today's records; nothing is stored when nothing changed; the editor's automatic updates
        are kept apart; a request for approval draws Content in first and lists records and automatic updates apart.
   No network, no AI. Exits 1 listing every failure. */
'use strict';

var failures = [], checks = 0;
function check(label, cond, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : '')); }

/* ---------- an in-memory Firestore + Storage ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {}, files = {}, seq = 0;
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } }; }
  function write(p, data, merge) {
    if (!merge || !docs[p]) docs[p] = docs[p] && merge ? docs[p] : {};
    Object.keys(data).forEach(function (k) { if (isDelete(data[k])) delete docs[p][k]; else docs[p][k] = clone(data[k]); });
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, data, o && o.merge); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, data, true); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p, filters) {
    filters = filters || [];
    var q = { path: p, doc: function (id) { return docRef(p + '/' + (id || 'auto' + (++seq))); },
      add: function (data) { var r = docRef(p + '/auto' + (++seq)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) { return colRef(p, filters.concat([{ field: field, op: op, value: value }])); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; })
          .filter(function (k) { return filters.every(function (f) { var v = docs[k][f.field]; return f.op === '>' ? v > f.value : v === f.value; }); })
          .sort().map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      } };
    return q;
  }
  var db = { collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = { get: function (r) { return r.get(); }, set: function (r, d, o) { write(r.path, d, o && o.merge); return tx; },
        update: function (r, d) { write(r.path, d, true); return tx; }, delete: function (r) { delete docs[r.path]; return tx; } };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, d, o && o.merge); }); }, update: function (r, d) { ops.push(function () { write(r.path, d, true); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); }, commit: function () { ops.forEach(function (f) { f(); }); return Promise.resolve(); } };
    } };
  var bucket = { name: 'test-bucket', file: function (p) {
    return { name: p,
      save: function (buf) { files[p] = Buffer.from(buf); return Promise.resolve(); }, delete: function () { delete files[p]; return Promise.resolve(); },
      exists: function () { return Promise.resolve([!!files[p]]); },
      download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      getMetadata: function () { return files[p] ? Promise.resolve([{ size: files[p].length, updated: '2026-01-01T00:00:00.000Z' }]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      setMetadata: function () { return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } };
  } };
  var auth = { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
require('./delivery')._testFetch(function (url, done) { done(null); });
const api = require('./api');
const SR = require('./site-records');
const { diffPages } = require('./page-diff');

function call(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    var body = opts.body ? JSON.stringify(opts.body) : '';
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body) };
    if (body) headers['content-type'] = 'application/json';
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, text: t, body: j, headers: res.headers }); } };
    api.handleApi(req, res);
  });
}
function count(text, needle) { return String(text).split(needle).length - 1; }

/* ---------- an AI-designed page: a menu, an agenda with a Register button, FAQs, contacts ---------- */
var FAQ_MODEL = '<div class="qa" data-rv-repeat-template="faq"><h3 class="q" data-rv-field="t">Question goes here</h3><p class="a" data-rv-field="d">Answer goes here.</p></div>';
var SESSION_MODEL = '<article class="row" data-rv-repeat-template="sessions"><div class="time" data-rv-field="time">00:00 AM – 00:00 AM</div><h3 data-rv-field="title">Session title goes here</h3>' +
  '<p class="meta"><span data-rv-field="speakers">Speaker names</span> · <span data-rv-field="room">Room</span></p></article>';
var SPEAKER_MODEL = '<div class="spk" data-rv-repeat-template="speakers"><img data-rv-field="photo" alt=""><h3 data-rv-field="n">Speaker Name</h3><p data-rv-field="r">Role</p><a data-rv-field="li">LinkedIn</a>' +
  '<svg class="ico" viewBox="0 0 24 24"><path d="M3 7l9 6 9-6"></path></svg></div>';
function sitePage(opts) {
  opts = opts || {};
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Site</title><style>.x{color:red}</style></head><body style="--theme-color:#123456">' +
    '<nav data-rv-section="nav" data-rv-key="nav"><a href="#agenda"' + (opts.agendaLinkHidden ? ' data-rv-nav-empty=""' : '') + '>Agenda</a><a href="#faq"' + (opts.faqLinkHidden ? ' data-rv-nav-empty=""' : '') + '>FAQ</a>' +
    '<a href="#register" data-register-cta="">Register</a></nav>' +
    '<section data-rv-section="hero" data-rv-key="hero" id="hero"><h1>Big Summit 2027</h1><a href="#register" data-register-cta="">Register now</a></section>' +
    '<section data-rv-section="agenda" data-rv-key="agenda" id="agenda"' + (opts.agendaMark || '') + '><h2>What’s happening</h2><p>The plan for the summit.</p>' +
    '<div class="chips"><span class="chip chip-on">Day 1</span><span class="chip">Day 2</span></div>' +
    '<div class="timeline"' + (opts.timelineMark || '') + '>' + (opts.sessions || SESSION_MODEL) + '</div>' +
    '<div class="cta"><a class="btn" href="#register" data-register-cta="">Register Now</a></div></section>' +
    (opts.noFaq ? '' : '<section data-rv-section="faq" data-rv-key="faq" id="faq"' + (opts.faqMark || '') + '><h2>Questions</h2><div class="list">' + (opts.faqs || FAQ_MODEL) + '</div></section>') +
    (opts.speakers ? '<section data-rv-section="speakers" data-rv-key="speakers" id="speakers"><h2>Speakers</h2><div class="grid">' + opts.speakers + '</div></section>' : '') +
    '<section data-rv-section="partners" data-rv-key="partners" id="partners"><h2>Partners</h2><div class="logos"><div data-rv-repeat-template="partners"><img data-rv-field="logo" alt=""><span data-rv-field="name">Partner</span></div></div>' +
    '<a href="#join" data-rv-form="partner-form">Join as partner</a></section>' +
    '<footer data-rv-section="footer" data-rv-key="footer"><p>© 2027</p></footer></body></html>';
}
function rows(extra) {
  return Object.assign({ speakers: [], sessions: [], 'agenda-groups': [], faqs: [], partners: [], contacts: [], gallery: [] }, extra || {});
}

/* ===================== 1. renderRecords ===================== */
(function () {
  var page = sitePage({ faqMark: ' data-rv-empty="faq"', faqLinkHidden: true });
  var one = rows({ faqs: [{ id: 'f1', question: 'Is there parking?', answer: 'Yes, at Gate 2.' }] });
  var r = SR.renderRecords(page, one);
  check('1.1 the first FAQ is drawn from the design\'s own item', r.changed && r.filled.indexOf('faq') !== -1 &&
    r.html.indexOf('<div class="qa" data-rv-repeat-template="faq" data-rv-filled="" data-rv-id="f1"><h3 class="q" data-rv-field="t">Is there parking?</h3><p class="a" data-rv-field="d">Yes, at Gate 2.</p></div>') !== -1, r.html);
  check('1.2 its section and the menu\'s link to it are shown again', r.html.indexOf('id="faq" data-rv-empty') === -1 && r.html.indexOf('<a href="#faq">FAQ</a>') !== -1);
  check('1.3 the rest of the page keeps its bytes', r.html.indexOf('<style>.x{color:red}</style></head><body style="--theme-color:#123456">') !== -1 && r.html.indexOf('<h1>Big Summit 2027</h1>') !== -1 && r.html.indexOf('<!DOCTYPE html>\n') === 0);
  var again = SR.renderRecords(r.html, one);
  check('1.4 drawing the same records again changes nothing', !again.changed && again.html === r.html);
  var two = rows({ faqs: [{ id: 'f1', question: 'Is there parking?', answer: 'Yes, at Gate 2.' }, { id: 'f2', question: 'Is lunch served?', answer: '' }] });
  var r2 = SR.renderRecords(r.html, two);
  check('1.5 a second FAQ is cloned from the first; an empty answer is cleared and hidden', count(r2.html, 'data-rv-repeat-template="faq"') === 2 &&
    r2.html.indexOf('data-rv-id="f2"><h3 class="q" data-rv-field="t">Is lunch served?</h3><p class="a" data-rv-field="d" hidden=""></p></div>') !== -1, r2.html.slice(r2.html.indexOf('id="faq"'), r2.html.indexOf('id="faq"') + 600));
  var items = diffPages(r.html, r2.html);
  check('1.6 the approver reads it as one added FAQ', items.length === 1 && items[0].type === 'record-added' && items[0].after === 'Is lunch served?', items);
  var gone = SR.renderRecords(r2.html, rows());
  check('1.7 no FAQs: the section goes, with the menu link; its old cards stay inside, hidden', gone.emptied.indexOf('faq') !== -1 &&
    /id="faq" data-rv-empty="faq"/.test(gone.html) && gone.html.indexOf('<a href="#faq" data-rv-nav-empty="">FAQ</a>') !== -1 && count(gone.html, 'data-rv-repeat-template="faq"') === 2);
  check('1.8 kinds whose records were not read are left alone', SR.renderRecords(page, { faqs: [{ id: 'f9', question: 'Q', answer: 'A' }] }).filled.join() === 'faq' &&
    !SR.renderRecords(page, {}).changed);

  /* UX-147: an empty agenda with a Register button goes, as an empty FAQ list does, when the page has other Register buttons */
  var agenda = SR.renderRecords(sitePage({ timelineMark: ' data-rv-empty="sessions"' }), rows());
  check('1.9 an empty agenda leaves the page with its menu link, though it has a Register button (the page has others)',
    /<section data-rv-section="agenda" data-rv-key="agenda" id="agenda" data-rv-empty="sessions">/.test(agenda.html) && agenda.html.indexOf('<a href="#agenda" data-rv-nav-empty="">Agenda</a>') !== -1 &&
    agenda.html.indexOf('<div class="timeline">') !== -1, agenda.html.slice(agenda.html.indexOf('<nav'), agenda.html.indexOf('<nav') + 900));
  var onlyRegister = sitePage().replace(/<a href="#register" data-register-cta="">Register<\/a>/, '').replace('<a href="#register" data-register-cta="">Register now</a>', '');
  var kept = SR.renderRecords(onlyRegister, rows());
  check('1.10 …but when it holds the page\'s only Register button, only its list goes', /<div class="timeline" data-rv-empty="sessions">/.test(kept.html) && !/id="agenda" data-rv-empty/.test(kept.html));
  check('1.11 a section with another form\'s button (Join as partner) keeps showing; only its empty list goes',
    /<div class="logos" data-rv-empty="partners">/.test(agenda.html) && !/id="partners" data-rv-empty/.test(agenda.html));

  /* sessions: day marks, speakers' names; a speaker's profile, link and picture */
  var day = [{ id: 'd1', name: 'Day 1', date: '2027-06-22', order: 0 }];
  var s1 = SR.renderRecords(sitePage(), rows({ sessions: [{ id: 's1', title: 'Opening keynote', start: '09:30', end: '10:15', speakerIds: ['p1'], groupId: 'd1', room: '' }],
    'agenda-groups': day, speakers: [{ id: 'p1', name: 'Priya Sharma', desig: 'CTO', photoUrl: 'https://x/p.jpg', li: 'https://www.linkedin.com/in/priya', bio: 'Builds cars.' }] }));
  var row = s1.html.slice(s1.html.indexOf('<article'), s1.html.indexOf('</article>') + 10);
  check('1.12 a session: its time, title, speakers and day; an empty room is hidden', row.indexOf('data-rv-day="d1" data-rv-day-name="Day 1" data-rv-day-date="22 June 2027" data-rv-filled="" data-rv-id="s1"') !== -1 &&
    row.indexOf('>9:30 AM – 10:15 AM<') !== -1 && row.indexOf('>Priya Sharma<') !== -1 && row.indexOf('<span data-rv-field="room" hidden=""></span>') !== -1, row);
  check('1.13 the speakers kind has no list on this page: reported, not designed', s1.unplaced.indexOf('speakers') !== -1);
  var sp = SR.renderRecords(sitePage({ speakers: SPEAKER_MODEL }), rows({ speakers: [{ id: 'p1', name: 'Priya Sharma', desig: 'CTO', photoUrl: 'https://x/p.jpg', li: 'https://www.linkedin.com/in/priya', bio: 'Builds cars.' }],
    sessions: [{ id: 's1', title: 'Opening keynote', start: '09:30', end: '10:15', speakerIds: ['p1'], groupId: 'd1' }], 'agenda-groups': day }));
  var card = sp.html.slice(sp.html.indexOf('<div class="spk"'), sp.html.indexOf('</template>', sp.html.indexOf('<div class="spk"')) + 11);
  check('1.14 a speaker: photo, name, role, LinkedIn link, and the profile the visitor\'s pop-up reads', card.indexOf('<img data-rv-field="photo" alt="" src="https://x/p.jpg">') !== -1 &&
    card.indexOf('<a data-rv-field="li" href="https://www.linkedin.com/in/priya">LinkedIn</a>') !== -1 &&
    card.indexOf('<template data-rv-profile=""><span data-rv-profile-for="" hidden="">Priya Sharma</span><p data-rv-profile-bio="">Builds cars.</p><a data-rv-profile-li="" href="https://www.linkedin.com/in/priya" target="_blank" rel="noopener">LinkedIn</a><p data-rv-profile-sessions-title="">Session</p><ul data-rv-profile-sessions=""><li data-rv-profile-session=""><span data-rv-profile-when="">22 June 2027 · 9:30 AM – 10:15 AM</span><span data-rv-profile-title="">Opening keynote</span></li></ul></template>') !== -1, card);
  check('1.15 an icon inside an item keeps its SVG names (viewBox) and closing tags', card.indexOf('<svg class="ico" viewBox="0 0 24 24"><path d="M3 7l9 6 9-6"></path></svg>') !== -1, card);
  var refill = SR.renderRecords(sp.html, rows({ speakers: [{ id: 'p2', name: 'Anita Rao', desig: '' }], sessions: [], 'agenda-groups': [] }));
  var c2 = refill.html.slice(refill.html.indexOf('<div class="spk"'), refill.html.indexOf('</div>', refill.html.indexOf('<div class="spk"')) + 6);
  check('1.16 drawn again from a filled card: what the new record lacks goes (no old photo, LinkedIn address or profile; the link hidden)', c2.indexOf('src=') === -1 && c2.indexOf('<a data-rv-field="li" hidden=""></a>') !== -1 && c2.indexOf('linkedin') === -1 && c2.indexOf('data-rv-profile') === -1 &&
    c2.indexOf('>Anita Rao<') !== -1 && c2.indexOf('<p data-rv-field="r" hidden=""></p>') !== -1, c2);
  var bg = SR.renderRecords('<section data-rv-section="g"><div class="w"><figure data-rv-repeat-template="glimpses" style="color: red; background-image: url(&quot;a.png&quot;);"><figcaption data-rv-field="caption">Caption</figcaption><div data-rv-field="imageUrl" style="height:10px"></div></figure></div></section>',
    rows({ gallery: [{ id: 'g1', imageUrl: 'https://x/g.jpg', caption: 'Hall' }] }));
  check('1.17 a picture shown as a background is set in the element\'s style', bg.html.indexOf('<div data-rv-field="imageUrl" style="height:10px; background-image: url(&quot;https://x/g.jpg&quot;);"></div>') !== -1, bg.html);
  var tpl = SR.renderRecords('<section data-rv-section="faq"><template data-rv-pristine="x"><div data-rv-repeat-template="faq"><p data-rv-field="t">Q</p></div></template></section>', rows({ faqs: [{ id: 'f1', question: 'A?' }] }));
  check('1.18 a model kept inside a <template> is not a list', !tpl.changed && tpl.unplaced.indexOf('faq') !== -1);

  /* B05 verify: drawn from the design's sample item, a record that has no picture or link does not keep the
     sample's (a sample person's photo, another sponsor's logo, a "#sponsors" link), so a second draw — the next
     Content change, the next request for approval — finds nothing to change and records no version */
  var SAMPLE = '<section data-rv-section="sponsors" id="sponsors"><h2>Partners</h2><div class="grid"><a class="card" data-rv-repeat-template="partners" data-rv-field="url" href="#sponsors">' +
    '<img data-rv-field="logo" src="https://x/other-sponsor.png" alt=""><span data-rv-field="name">Partner Name</span></a></div></section>' +
    '<section data-rv-section="speakers" id="speakers"><h2>Speakers</h2><div class="grid"><div data-rv-repeat-template="speakers"><img data-rv-field="photo" src="https://x/sample-person.jpg" alt="">' +
    '<h3 data-rv-field="n">Speaker Name</h3><p data-rv-field="r">Role</p><a data-rv-field="li" href="#">LinkedIn</a></div></div></section>';
  var bare = rows({ speakers: [{ id: 's1', name: 'Asha Rao', desig: 'CTO', photoUrl: '' }], partners: [{ id: 'p1', name: 'Acme', url: '', logoUrl: '' }] });
  var d1 = SR.renderRecords(SAMPLE, bare), d2 = SR.renderRecords(d1.html, bare);
  check('1.19 a sponsor without a logo or link keeps neither of the sample\'s', d1.changed && d1.html.indexOf('other-sponsor.png') === -1 && d1.html.indexOf('href="#sponsors"') === -1 &&
    d1.html.indexOf('<a class="card" data-rv-repeat-template="partners" data-rv-field="url" data-rv-filled="" data-rv-id="p1"><img data-rv-field="logo" alt=""><span data-rv-field="name">Acme</span></a>') !== -1, d1.html);
  check('1.20 a speaker without a photo does not show the sample person', d1.html.indexOf('sample-person.jpg') === -1 && d1.html.indexOf('<img data-rv-field="photo" alt=""><h3 data-rv-field="n">Asha Rao</h3>') !== -1, d1.html);
  check('1.21 drawing the same records a second time changes nothing', !d2.changed && d2.html === d1.html, diffPages(d1.html, d2.html));
  /* the same, over every kind of list on the test page and records with and without each value */
  var sets = [
    bare,
    rows({ speakers: [{ id: 's1', name: 'Asha Rao', desig: 'CTO', photoUrl: 'https://x/asha.jpg', li: 'https://www.linkedin.com/in/asha', bio: 'Leads.' }, { id: 's2', name: 'Meera Iyer' }],
      partners: [{ id: 'p1', name: 'Acme', url: 'https://acme.example', logoUrl: 'https://x/acme.png' }, { id: 'p2', name: 'Beta' }],
      faqs: [{ id: 'f1', question: 'Q?', answer: '' }], sessions: [{ id: 'x1', title: 'Talk', start: '10:00', end: '', speakerIds: ['s1'], groupId: 'd1' }],
      'agenda-groups': [{ id: 'd1', name: 'Day 1', date: '2027-06-22' }], contacts: [{ id: 'k1', label: 'Sales', name: 'Ravi', email: '', phone: '' }] }),
    rows()
  ];
  var steady = sets.every(function (set) {
    return [SAMPLE, sitePage({ speakers: SPEAKER_MODEL })].every(function (page) {
      var first = SR.renderRecords(page, set), second = SR.renderRecords(first.html, set);
      return !second.changed && second.html === first.html;
    });
  });
  check('1.22 every list, with and without each value: a second draw of the same records changes nothing', steady);
})();

/* ===================== 1b. the site editor's side (its source: it needs a browser to run) =====================
   The editor draws the same lists in the browser (applyGenericRepeat), and what it changes by itself as the page
   opens is told apart from the person's changes (UX-076) on B04's opening, where every browser opens the version
   saved on the server. */
(function () {
  var ED = require('fs').readFileSync(require('path').join(__dirname, '../../editor-template-ui.js'), 'utf8');
  function body(name) {
    var i = ED.indexOf('function ' + name + '(');
    if (i === -1) return '';
    var open = ED.indexOf('{', i), depth = 0;
    for (var j = open; j < ED.length; j++) { if (ED[j] === '{') depth++; else if (ED[j] === '}' && --depth === 0) return ED.slice(i, j + 1); }
    return '';
  }
  function code(name) { return body(name).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''); }
  var field = code('setGenericRepeatField');
  check('1b.1 the editor, like the server, takes away a picture or link the record lacks, from the sample item as from a drawn card (no "refill")',
    /function setGenericRepeatField\(fieldEl, field, value, kind\)/.test(field) && !/\brefill\b/.test(field + code('fillGenericRepeatClone') + code('applyGenericRepeat')) && code('applyGenericRepeat').length > 0 &&
    /if \(isLink && fieldEl\.tagName === 'A'\) fieldEl\.removeAttribute\('href'\);/.test(field) &&
    /if \(fieldEl\.tagName === 'IMG'\) fieldEl\.removeAttribute\('src'\); else fieldEl\.style\.backgroundImage = '';/.test(field) &&
    field.indexOf("removeAttribute('src')") < field.indexOf("setAttribute('hidden', '')"));
  check('1b.2 a fresh browser\'s opening counts as opened as saved: B04 takes the saved version and marks it as this browser\'s',
    /onSavedVersion\(site\.version\)/.test(code('takeSavedSite')) && /writeMark\(\{ version: version, hash: snapHash\(undoStack\[undoPtr\]\) \}\)/.test(code('onSavedVersion')) &&
    /openPtr = undoPtr;/.test(code('noteOpening')) && /mark\.hash === snapHash\(undoStack\[undoPtr\]\)/.test(code('noteOpening')) && /var mark = savedMark \|\| readMark\(\);/.test(code('noteOpening')));
  check('1b.3 the updates are part of the step the page opened on, also after "Open version N" over an older copy (step 1)',
    /if \(undoPtr !== openPtr \|\| editingEl\) \{ commitAutomatic\(\); return; \}/.test(code('bakeAuto')) && /undoStack\[openPtr\] = snap;/.test(code('bakeAuto')) && /aiWorking/.test(code('bakeAuto')) &&
    /undoPtr !== openPtr\) return;/.test(code('settleAuto')) && /ptr: openPtr,/.test(code('settleAuto')) && /undoPtr !== openPtr \+ 1\) return;/.test(code('tagAutoStep')));
  var chip = code('renderSiteState');
  check('1b.4 the chip says "Updated automatically", never "Unsaved changes", for them', chip.indexOf("text = 'Updated automatically'") !== -1 && chip.indexOf("dirty && autoOnly()") < chip.indexOf("text = 'Unsaved changes'"));
  var saveFn = code('saveToStaging');
  check('1b.5 Save keeps them first, on the version this editor is on, as automatic; the person\'s save is then made on what that answered',
    /baseVersion: baseVersion, snapshot: undoStack\[auto\.ptr\], html: auto\.html,\s*automatic: true/.test(saveFn) && /writeMark\(\{ version: out\.version, hash: auto\.hash \}\);\s*baseVersion = out\.version;/.test(saveFn) &&
    /if \(a && hash === auto\.hash\) return a;/.test(saveFn));
  check('1b.6 they are no reason to ask before leaving, nor the person\'s own after an Undo, and the owner\'s logo put in by itself is the editor\'s step',
    /dirty: isDirty\(\) && !autoOnly\(\)/.test(code('hasUnsavedWork')) && /&& !autoOnly\(\)\);/.test(code('step')) &&
    /if \(byItself\) commitAutomatic\(\); else commitNow\(\);/.test(ED) && /putIn\(true\);\s*tagAutoStep\(/.test(ED));
})();

/* ===================== 2. the routes ===================== */
var NOW = '2026-02-01T00:00:00.000Z';
function save(path, text) { return FB.bucket.file(path).save(text); }
function file(path) { return FB.files[path] ? String(FB.files[path]) : null; }
function changes(id) { return Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + id + '/changes/') === 0; }).map(function (k) { return FB.docs[k]; }).sort(function (a, b) { return a.version - b.version; }); }
function addFaq(id, fid, q, a) { FB.docs['events/' + id + '/faqs/' + fid] = { question: q, answer: a || '', createdAt: NOW, order: 0 }; }

(async function () {
  FB.docs['config/approvals'] = { required: true, allowSelf: false };
  var ID = 'cr-live';
  var V2 = sitePage({ faqMark: ' data-rv-empty="faq"', faqLinkHidden: true });
  FB.docs['events/' + ID] = { name: 'Content Live', createdAt: NOW, templateId: 'gen-cr-live', published: true, publishedVersion: 2,
    site: { version: 2, snapshotVersion: 2, templateId: 'gen-cr-live', updatedAt: NOW, updatedBy: 'owner@timesinternet.in' } };
  await save('events/' + ID + '/site/page.html', V2);
  await save('events/' + ID + '/site/versions/2/page.html', V2);
  await save('events/' + ID + '/site/snapshot.json', '{"nodes":[]}');
  await save('events/' + ID + '/published/index.html', 'LIVE V2');

  /* a FAQ added in Content reaches the staged copy at once, as a version of its own */
  addFaq(ID, 'f1', 'Is there parking at the venue?', 'Yes, in the basement.');
  var r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: ID } });
  var ev = FB.docs['events/' + ID];
  check('2.1 staged as version 3, said in Content\'s words', r.status === 200 && r.body.staged === true && r.body.version === 3 && r.body.summary === 'Content: 1 FAQ added' &&
    r.body.published === true && r.body.publishedVersion === 2 && r.body.pending === null && r.body.approvalRequired === true, r.status + ' ' + r.text.slice(0, 400));
  check('2.2 the saved page, the kept version and staging show it; the live page does not', /Is there parking at the venue\?/.test(file('events/' + ID + '/site/page.html')) &&
    /Is there parking/.test(file('events/' + ID + '/site/versions/3/page.html')) && /Is there parking/.test(file('events/' + ID + '/staging/index.html')) && file('events/' + ID + '/published/index.html') === 'LIVE V2');
  check('2.3 the site moves on, the editor\'s own state does not: the content was made on version 2', ev.site.version === 3 && ev.site.snapshotVersion === 2 && ev.site.contentBase === 2 && !ev.siteLock &&
    ev.site.updatedBy === 'editor@timesinternet.in', ev.site);
  var c3 = changes(ID).filter(function (c) { return c.version === 3; })[0];
  check('2.4 its history line: who, Content, the FAQ by name', c3 && c3.kind === 'content' && c3.by === 'editor@timesinternet.in' && c3.items.length === 1 && c3.items[0].type === 'record-added' && c3.items[0].after === 'Is there parking at the venue?', c3);
  r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: ID } });
  check('2.5 asked again with nothing new: no new version', r.status === 200 && r.body.staged === false && r.body.version === 3 && ev.site.version === 3, r.text);

  /* a save from the editor that opened version 2 is no conflict, and keeps today's records */
  var editorPage = V2.replace('<h1>Big Summit 2027</h1>', '<h1>Big Summit 2027 — Mumbai</h1>');
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID, templateId: 'gen-cr-live', baseVersion: 2, snapshot: { nodes: ['a'] }, html: editorPage } });
  var stored = file('events/' + ID + '/site/page.html');
  check('2.6 a save built on the version the Content change was made on goes in, as version 4', r.status === 200 && r.body.version === 4 && FB.docs['events/' + ID].site.version === 4, r.status + ' ' + r.text.slice(0, 300));
  check('2.7 …and the stored page still shows the FAQ the editor did not have', /Big Summit 2027 — Mumbai/.test(stored) && /Is there parking at the venue\?/.test(stored) && !/id="faq" data-rv-empty/.test(stored));
  var c4 = changes(ID).filter(function (c) { return c.version === 4; })[0];
  check('2.8 …and its summary is only what the person changed', c4 && !c4.kind && c4.summary === '1 section edited', c4 && c4.summary);
  check('2.9 the editor saved: the Content base is cleared', FB.docs['events/' + ID].site.contentBase == null && FB.docs['events/' + ID].site.snapshotVersion === 4);
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID, templateId: 'gen-cr-live', baseVersion: 2, snapshot: { nodes: ['b'] }, html: editorPage } });
  check('2.10 a save built on an older version than that is still a conflict', r.status === 409 && r.body.code === 'site-conflict', r.status + ' ' + r.text);

  /* nothing changed: nothing stored */
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID, templateId: 'gen-cr-live', baseVersion: 4, snapshot: { nodes: ['a'] }, html: stored } });
  check('2.11 the same page and editor state: no new version', r.status === 200 && r.body.unchanged === true && r.body.version === 4 && FB.docs['events/' + ID].site.version === 4 && changes(ID).length === 2, r.text);
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID, templateId: 'gen-cr-live', baseVersion: 4, snapshot: { nodes: ['a', 'hidden draft'] }, html: stored } });
  check('2.12 the same page but a new editor state (a hidden section, say) is kept', r.status === 200 && r.body.version === 5 && !r.body.unchanged, r.text);

  /* the editor's automatic updates: kept apart, and only when a reader would see them */
  var page5 = file('events/' + ID + '/site/page.html');
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID, templateId: 'gen-cr-live', baseVersion: 5, snapshot: { nodes: ['auto'] }, automatic: true, note: 'Updated automatically: FAQs from Content',
    html: page5.replace('<h3 class="q" data-rv-field="t">', '<h3 data-rv-field="t" class="q">') } });
  check('2.13 automatic updates nobody would see: nothing stored', r.status === 200 && r.body.unchanged === true && r.body.version === 5, r.text);
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID, templateId: 'gen-cr-live', baseVersion: 5, snapshot: { nodes: ['auto'] }, automatic: true, note: 'Updated automatically: the ET logo and menu',
    html: page5.replace('<a href="#faq">FAQ</a>', '<a href="#faq" style="white-space: nowrap;">FAQ</a>') } });
  var c6 = changes(ID).filter(function (c) { return c.version === 6; })[0];
  check('2.14 automatic updates a reader would see: a version of their own, recorded as automatic', r.status === 200 && r.body.version === 6 && c6 && c6.kind === 'automatic' && c6.note === 'Updated automatically: the ET logo and menu', c6);
  /* UX-076: an untouched Save recorded "4 sections edited" under the person's name; the editor's own updates are nobody's */
  var a6 = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + ID + '/activity/') === 0; }).map(function (k) { return FB.docs[k]; }).filter(function (a) { return a.version === 6; })[0];
  check('2.14b …in nobody\'s name: the site editor\'s, with who pressed Save kept apart, in the history line and the History', c6 && c6.by === 'Site editor (automatic)' && c6.savedBy === 'owner@timesinternet.in' &&
    a6 && a6.by === 'Site editor (automatic)' && /updated automatically when the site editor opened/.test(a6.detail), { change: c6, activity: a6 });
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID, templateId: 'gen-cr-live', baseVersion: 6, snapshot: { nodes: ['mine'] },
    html: file('events/' + ID + '/site/page.html').replace('<p>The plan for the summit.</p>', '<p>The plan, day by day.</p>') } });
  check('2.15 then the person\'s save', r.status === 200 && r.body.version === 7, r.text);

  /* a request for approval draws Content in first, and lists records and automatic updates apart */
  addFaq(ID, 'f2', 'Is lunch served?', 'Yes.');
  r = await call('POST', '/api/event/approval/request', { token: 'owner', body: { eventId: ID } });
  var req = r.body && FB.docs['events/' + ID + '/approvals/' + r.body.id];
  check('2.16 the request holds the FAQ added since the last save: Content was staged as version 8 first', r.status === 200 && r.body.toVersion === 8 && FB.docs['events/' + ID].site.version === 8 &&
    /Is lunch served\?/.test(file('events/' + ID + '/site/versions/8/page.html')), r.status + ' ' + r.text.slice(0, 300));
  var types = req ? req.items.map(function (i) { return i.type + ':' + i.section + (i.auto ? ':auto' : ''); }).join(',') : '';
  check('2.17 what changed: the person\'s edits, the menu\'s automatic update marked as such, and each FAQ by name',
    req && /text:hero/.test(types) && /text:agenda/.test(types) && /look:nav:auto/.test(types) && /record-added:faq/.test(types) &&
    req.items.filter(function (i) { return i.type === 'record-added'; }).map(function (i) { return i.after; }).sort().join('|') === 'Is lunch served?|Is there parking at the venue?', types);
  check('2.18 the saves say which were Content and which automatic', req && req.saves.filter(function (s) { return s.kind === 'content'; }).map(function (s) { return s.version; }).join() === '3,8' &&
    req.saves.filter(function (s) { return s.kind === 'automatic'; }).map(function (s) { return s.version; }).join() === '6', req && req.saves);
  check('2.18b "Changes by" names the people who changed it, not the site editor\'s own updates', req && req.contributors.slice().sort().join() === 'editor@timesinternet.in,owner@timesinternet.in', req && req.contributors);
  r = await call('GET', '/api/event/approval?eventId=' + ID, { token: 'approver' });
  check('2.19 the approval page is given the items with their marks', r.status === 200 && r.body.request.items.some(function (i) { return i.auto; }) && r.body.request.saves.some(function (s) { return s.kind === 'content'; }), r.text.slice(0, 300));

  /* Content changed, nothing else, on a live site: Publish no longer says there is nothing new */
  var ID2 = 'cr-only';
  FB.docs['events/' + ID2] = { name: 'Only content', createdAt: NOW, templateId: 'gen-cr-only', published: true, publishedVersion: 1, site: { version: 1, snapshotVersion: 1, templateId: 'gen-cr-only' } };
  await save('events/' + ID2 + '/site/page.html', V2);
  await save('events/' + ID2 + '/site/versions/1/page.html', V2);
  r = await call('POST', '/api/event/approval/request', { token: 'owner', body: { eventId: ID2 } });
  check('2.20 nothing new at all: still "nothing to publish"', r.status === 409 && r.body.code === 'nothing-to-publish', r.text);
  addFaq(ID2, 'q1', 'Where is it?', 'In Pune.');
  r = await call('POST', '/api/event/approval/request', { token: 'owner', body: { eventId: ID2 } });
  check('2.21 a FAQ added in Content: the request is made, for the version that shows it', r.status === 200 && r.body.toVersion === 2 && r.body.summary === 'Content: 1 FAQ added', r.text);

  /* what the console is told for a site that cannot show it this way */
  FB.docs['events/cr-unsaved'] = { name: 'Unsaved', createdAt: NOW, templateId: 'gen-cr-unsaved' };
  r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: 'cr-unsaved' } });
  check('2.22 a site never saved: nothing to stage, said so', r.status === 200 && r.body.notSaved === true && !FB.docs['events/cr-unsaved'].site, r.text);
  FB.docs['events/cr-nofaq'] = { name: 'No FAQ section', createdAt: NOW, templateId: 'gen-cr-nofaq', site: { version: 1, templateId: 'gen-cr-nofaq' } };
  await save('events/cr-nofaq/site/page.html', sitePage({ noFaq: true }));
  addFaq('cr-nofaq', 'z1', 'Q?', 'A.');
  r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: 'cr-nofaq' } });
  check('2.23 FAQs with no FAQ list on the page: unplaced (the editor adds a section when it opens)', r.status === 200 && r.body.unplaced.indexOf('faq') !== -1 && r.body.staged === false, r.text);
  FB.docs['events/cr-tech'] = { name: 'Real template', createdAt: NOW, templateId: 'tech500', site: { version: 1, templateId: 'tech500' } };
  await save('events/cr-tech/site/page.html', '<!DOCTYPE html><html><body><section data-rv-section="faq"><div class="faq-item">Q</div></section></body></html>');
  addFaq('cr-tech', 't1', 'Q?', 'A.');
  r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: 'cr-tech' } });
  check('2.24 a real template draws FAQs in the site editor: the console is told to open it', r.status === 200 && r.body.needsEditor.indexOf('faq') !== -1 && r.body.staged === false, r.text);
  r = await call('POST', '/api/event/site/records', { body: { eventId: ID } });
  check('2.25 signed out: refused', r.status === 401, r.status);

  /* B05 verify: a Save that answered "Nothing new to save" leaves the editor on a Content version; another Content
     version made since is no conflict ("Save over version 10?" named the same person), a person's save is */
  var ID3 = 'cr-chain', P3 = sitePage();
  FB.docs['events/' + ID3] = { name: 'Chain', createdAt: NOW, templateId: 'gen-cr-chain', site: { version: 1, snapshotVersion: 1, templateId: 'gen-cr-chain' } };
  await save('events/' + ID3 + '/site/page.html', P3);
  await save('events/' + ID3 + '/site/snapshot.json', JSON.stringify({ nodes: ['s1'] }));
  addFaq(ID3, 'c1', 'First question?', 'One.');
  r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: ID3 } });
  var onV2 = file('events/' + ID3 + '/site/page.html');
  check('2.26 a Content change: version 2, made on version 1', r.status === 200 && r.body.version === 2 && FB.docs['events/' + ID3].site.contentBase === 1, r.text);
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID3, templateId: 'gen-cr-chain', baseVersion: 1, snapshot: { nodes: ['s1'] }, html: onV2 } });
  check('2.27 the editor saves nothing new: "nothing new", on version 2', r.status === 200 && r.body.unchanged === true && r.body.version === 2, r.text);
  addFaq(ID3, 'c2', 'Second question?', 'Two.');
  r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: ID3 } });
  check('2.28 another Content change: version 3, still made on version 1', r.status === 200 && r.body.version === 3 && FB.docs['events/' + ID3].site.contentBase === 1, r.text);
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID3, templateId: 'gen-cr-chain', baseVersion: 2, snapshot: { nodes: ['s1', 'edit'] },
    html: onV2.replace('<h1>Big Summit 2027</h1>', '<h1>Big Summit 2027 — Pune</h1>') } });
  var p4 = file('events/' + ID3 + '/site/page.html') || '';
  check('2.29 the editor on version 2 saves an edit: no conflict, version 4, and both FAQs stay', r.status === 200 && r.body.version === 4 && /— Pune/.test(p4) &&
    /First question\?/.test(p4) && /Second question\?/.test(p4) && FB.docs['events/' + ID3].site.contentBase == null, r.status + ' ' + r.text.slice(0, 300));
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID3, templateId: 'gen-cr-chain', baseVersion: 3, snapshot: { nodes: ['old'] }, html: onV2 } });
  check('2.30 a save built on a Content version from before a person\'s save is a conflict', r.status === 409 && r.body.code === 'site-conflict' && r.body.current.version === 4, r.status + ' ' + r.text);
  addFaq(ID3, 'c3', 'Third question?', 'Three.');
  r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: ID3 } });
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID3, templateId: 'gen-cr-chain', baseVersion: 3, snapshot: { nodes: ['old'] }, html: onV2 } });
  check('2.31 …and still one when Content versions came after that save', FB.docs['events/' + ID3].site.version === 5 && r.status === 409 && r.body.current.version === 5, r.status + ' ' + r.text);

  /* B05 verify: a site with pages shows one FAQ on its home page and on its FAQ page — "1 FAQ added", not 2 */
  var ID4 = 'cr-pages';
  var MP = sitePage().replace('<footer', '<section data-rv-section="award-faq" data-rv-key="award-faq" id="award-faq" data-rv-page="award-faq"><h2>All the questions</h2><div class="list">' + FAQ_MODEL + '</div></section><footer');
  FB.docs['events/' + ID4] = { name: 'Pages', createdAt: NOW, templateId: 'gen-cr-pages', site: { version: 1, snapshotVersion: 1, templateId: 'gen-cr-pages' } };
  await save('events/' + ID4 + '/site/page.html', MP);
  addFaq(ID4, 'm1', 'Who can enter?', 'Any company.');
  r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: ID4 } });
  var c4p = changes(ID4).filter(function (c) { return c.version === 2; })[0];
  check('2.32 one FAQ on two pages: drawn on both, counted once', r.status === 200 && r.body.summary === 'Content: 1 FAQ added' && count(file('events/' + ID4 + '/site/page.html'), 'Who can enter?') === 2 &&
    c4p && c4p.summary === 'Content: 1 FAQ added' && c4p.items.length === 1, r.text.slice(0, 300));

  /* UX-076: the editor opens a page whose records Content drew in after its last save (the editor's state is behind
     the page); its own updates are the very page staging shows: no version, nothing in anybody's name, and the state
     is kept beside the page so the next opening has nothing to update. An automatic page that is only alike is not. */
  var ID5 = 'cr-catchup', P5 = sitePage();
  FB.docs['events/' + ID5] = { name: 'Catch up', createdAt: NOW, templateId: 'gen-cr-catchup', site: { version: 1, snapshotVersion: 1, templateId: 'gen-cr-catchup', updatedBy: 'owner@timesinternet.in' } };
  await save('events/' + ID5 + '/site/page.html', P5);
  await save('events/' + ID5 + '/site/snapshot.json', JSON.stringify({ nodes: ['v1'] }));
  addFaq(ID5, 'k1', 'Is there parking?', 'Yes.');
  r = await call('POST', '/api/event/site/records', { token: 'editor', body: { eventId: ID5 } });
  var staged5 = file('events/' + ID5 + '/site/page.html'), before5 = changes(ID5).length;
  check('2.33 Content drew the FAQ in: version 2, the editor\'s state still version 1\'s', r.status === 200 && r.body.version === 2 && FB.docs['events/' + ID5].site.snapshotVersion === 1, r.text);
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID5, templateId: 'gen-cr-catchup', baseVersion: 2, snapshot: { nodes: ['v1', 'faq drawn'] }, automatic: true,
    note: 'Updated automatically: FAQs from Content', html: staged5.replace('<h3 class="q" data-rv-field="t">', '<h3 data-rv-field="t" class="q">') } });
  check('2.34 a page only alike: nothing stored, the state neither', r.status === 200 && r.body.unchanged === true && file('events/' + ID5 + '/site/snapshot.json') === JSON.stringify({ nodes: ['v1'] }), r.text);
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID5, templateId: 'gen-cr-catchup', baseVersion: 2, snapshot: { nodes: ['v1', 'faq drawn'] }, automatic: true,
    note: 'Updated automatically: FAQs from Content', html: staged5 } });
  var ev5 = FB.docs['events/' + ID5];
  check('2.35 the very page staging shows: no version and no history line, but the editor\'s state is kept beside it', r.status === 200 && r.body.unchanged === true && r.body.version === 2 &&
    ev5.site.version === 2 && ev5.site.snapshotVersion === 2 && ev5.site.contentBase === 1 && !ev5.siteLock && changes(ID5).length === before5 &&
    file('events/' + ID5 + '/site/snapshot.json') === JSON.stringify({ nodes: ['v1', 'faq drawn'] }) && file('events/' + ID5 + '/site/page.html') === staged5, { body: r.body, site: ev5.site });
  r = await call('GET', '/api/event/site?eventId=' + ID5, { token: 'owner' });
  check('2.36 the next opening gets that state, as version 2, saved by whoever last saved', r.status === 200 && r.body.version === 2 && r.body.snapshot && r.body.snapshot.nodes.join() === 'v1,faq drawn' && r.body.updatedBy === 'editor@timesinternet.in', r.text.slice(0, 300));
  r = await call('PUT', '/api/event/site', { token: 'owner', body: { eventId: ID5, templateId: 'gen-cr-catchup', baseVersion: 2, snapshot: { nodes: ['v1', 'faq drawn'] }, html: staged5 } });
  check('2.37 a person\'s Save of the same page and state after it: "nothing new"', r.status === 200 && r.body.unchanged === true && changes(ID5).length === before5, r.text);

  if (failures.length) { console.error('site-records: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('site-records: all ' + checks + ' checks passed');
})().catch(function (e) { console.error(e); process.exit(1); });
