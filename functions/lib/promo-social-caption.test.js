// node functions/lib/promo-social-caption.test.js — the Caption tab, Write with AI and Suggest headlines of
// Promotions → Social posts (promo-studio/oneworld-social-caption.js). No network: the file runs in a vm over a small
// stand-in DOM, stubs of the platform's editor state (EDIT, edParams, CAT, findTpl, toast) and of RevampAuth. The
// templates' options come from the real engine (functions/lib/vendor/promo-engine.js), and what the AI route makes of
// a post is checked with the real route's own prompt builder (functions/lib/promo.js writeRequest).
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
var FILE = 'promo-studio/oneworld-social-caption.js';
var src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

/* ---------- the templates, as the catalog lists them ---------- */
/* the real engine's 9 templates (ids, labels, options and defaults); a copy of them if the vendored engine is being
   rebuilt and cannot be loaded right now */
var TEMPLATES;
try {
  TEMPLATES = require('./vendor/promo-engine.js').ALL_TEMPLATES.map(function (t) {
    return { id: t.id, label: t.label, params: t.params.map(function (p) { return { key: p.key, label: p.label, type: p.type, default: p.default }; }), available: true, formats: [{ id: 'ig_square', ratio: '1:1' }] };
  });
} catch (e) { TEMPLATES = null; }
if (!TEMPLATES || TEMPLATES.length !== 9) {
  console.log('note: the vendored engine could not be read; the templates\' options are the test\'s own copy');
  var T = function (id, label, params) { return { id: id, label: label, params: params.map(function (p) { return { key: p[0], type: p[1], default: p[2] }; }), available: true, formats: [{ id: 'ig_square', ratio: '1:1' }] }; };
  TEMPLATES = [
    T('generic.announcement', 'Announcement / Save the Date', [['kicker', 'text', 'Save the Date'], ['stats', 'stats']]),
    T('generic.who-should-attend', 'Who Should Attend', [['limit', 'number', 6], ['title', 'text', 'Who Should Attend']]),
    T('generic.summit-highlights', 'Summit Highlights', [['title', 'text', 'Summit Highlights'], ['stats', 'stats']]),
    T('generic.prediction-outcome', 'Prediction vs Outcome', [['headline', 'text', 'What leaders saw last year. What they must prepare for next.'],
      ['prediction', 'text', 'Last year set the signals — shifting priorities, new risks, and rising expectations.'],
      ['outcome', 'text', 'This year, leaders will act on it — with sharper strategy, governance and execution.'],
      ['predictionLabel', 'text', 'Prediction'], ['outcomeLabel', 'text', 'Outcome']]),
    T('generic.testimonial', 'Testimonial', [['kicker', 'text', 'Voices of Last Edition'], ['quote', 'text', ''], ['speakerId', 'select'], ['author', 'text', ''], ['authorTitle', 'text', '']]),
    T('partner.tier-ladder', 'Sponsor Tier Ladder', [['sponsorIds', 'multiselect'], ['maxSponsors', 'number', 10], ['maxTiers', 'number', 4], ['title', 'text', 'Our Partners']]),
    T('partner.presenting-spotlight', 'Partner Spotlight', [['sponsorId', 'select'], ['tier', 'select']]),
    T('speaker.individual', 'Individual Speaker Card', [['speakerId', 'select'], ['roleLabel', 'text', 'Speaker']]),
    T('speaker.combined', 'Combined Speaker Set', [['speakerIds', 'multiselect'], ['group', 'select'], ['limit', 'number', 8], ['title', 'text', 'Meet Our Speakers']])
  ];
}
function tpl(id) { return TEMPLATES.filter(function (t) { return t.id === id; })[0]; }
var IDS = TEMPLATES.map(function (t) { return t.id; });
/* §6e: what kind of post each template is, for the AI */
var KIND = { 'generic.announcement': 'save-the-date', 'generic.who-should-attend': 'audience', 'generic.summit-highlights': 'stats',
  'generic.prediction-outcome': 'outlook', 'generic.testimonial': 'testimonial', 'partner.tier-ladder': 'partners',
  'partner.presenting-spotlight': 'partner', 'speaker.individual': 'speaker', 'speaker.combined': 'speakers' };
var HEAD = { 'generic.who-should-attend': 'title', 'generic.summit-highlights': 'title', 'generic.prediction-outcome': 'headline',
  'partner.tier-ladder': 'title', 'speaker.combined': 'title' };

/* the route's own prompt builder and kind notes, when lib/promo.js loads here (it needs no environment) */
var promoT = null;
try { promoT = require('./promo')._test; } catch (e) { console.log('note: lib/promo.js could not be loaded here: ' + (e && e.message)); }
/* the route's pieceText (promo.js): 30 keys, lines "key: value", values on one line and at most 600, 3,000 in all */
function pieceLines(piece) {
  var lines = [];
  Object.keys(piece).slice(0, 30).forEach(function (k) {
    if (k === 'type' || !/^[A-Za-z][\w-]{0,40}$/.test(k)) return;
    var v = piece[k];
    if (typeof v === 'string' && v.trim()) lines.push(k + ': ' + String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600));
  });
  return lines;
}

/* ---------- a small DOM: elements, text nodes, the selectors the file uses ---------- */
function makeDom() {
  var dom = { htmlWrites: [], created: [] };
  function TextNode(t) { this.nodeType = 3; this.nodeValue = String(t); this.parentNode = null; }
  Object.defineProperty(TextNode.prototype, 'textContent', { get: function () { return this.nodeValue; }, set: function (v) { this.nodeValue = String(v); } });
  function El(tag, ns) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.namespaceURI = ns || null;
    this.childNodes = []; this.parentNode = null; this.attrs = {}; this.style = {};
    this.value = ''; this.placeholder = ''; this.disabled = false; this.type = ''; this.rows = 0;
    this.onclick = null; this.oninput = null; this.selected = false;
    dom.created.push(this);
  }
  var P = El.prototype;
  Object.defineProperty(P, 'id', { get: function () { return this.attrs.id || ''; }, set: function (v) { this.attrs.id = String(v); } });
  Object.defineProperty(P, 'className', { get: function () { return this.attrs['class'] || ''; }, set: function (v) { this.attrs['class'] = String(v); } });
  Object.defineProperty(P, 'classList', { get: function () {
    var self = this;
    function list() { return self.className.split(/\s+/).filter(Boolean); }
    return {
      contains: function (c) { return list().indexOf(c) !== -1; },
      add: function (c) { if (list().indexOf(c) === -1) self.className = list().concat([c]).join(' '); },
      remove: function (c) { self.className = list().filter(function (x) { return x !== c; }).join(' '); },
      toggle: function (c, on) { if (on === undefined) on = list().indexOf(c) === -1; if (on) this.add(c); else this.remove(c); return on; }
    };
  } });
  Object.defineProperty(P, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  Object.defineProperty(P, 'nextSibling', { get: function () {
    if (!this.parentNode) return null;
    var k = this.parentNode.childNodes; return k[k.indexOf(this) + 1] || null;
  } });
  Object.defineProperty(P, 'children', { get: function () { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); } });
  Object.defineProperty(P, 'textContent', {
    get: function () { return this.childNodes.map(function (n) { return n.textContent; }).join(''); },
    set: function (v) { this.childNodes.forEach(function (n) { n.parentNode = null; }); this.childNodes = []; if (String(v) !== '') this.appendChild(new TextNode(v)); }
  });
  Object.defineProperty(P, 'innerHTML', {
    get: function () { return ''; },
    set: function (v) { dom.htmlWrites.push(String(v)); this.textContent = ''; }
  });
  P.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  P.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
  P.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); };
  P.removeAttribute = function (k) { delete this.attrs[k]; };
  P.appendChild = function (n) { return this.insertBefore(n, null); };
  P.insertBefore = function (n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    var i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i === -1) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    n.parentNode = this;
    return n;
  };
  P.removeChild = function (n) { var i = this.childNodes.indexOf(n); if (i !== -1) this.childNodes.splice(i, 1); n.parentNode = null; return n; };
  P.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  P.focus = function () { dom.document.activeElement = this; };
  P.select = function () { this.selected = true; };
  P.click = function () { if (this.disabled) return; if (typeof this.onclick === 'function') this.onclick.call(this, { target: this, type: 'click', preventDefault: function () {} }); };
  P.type_ = function (v) { this.value = v; if (typeof this.oninput === 'function') this.oninput.call(this, { target: this, type: 'input' }); };
  function descendants(n, out) { n.childNodes.forEach(function (c) { if (c.nodeType === 1) { out.push(c); descendants(c, out); } }); return out; }
  function parse(sel) {
    return sel.split(',').map(function (group) {
      return group.trim().split(/\s+/).map(function (part) {
        var m = /^([a-zA-Z][\w-]*)?/.exec(part), c = { tag: m[1] ? m[1].toUpperCase() : '', id: '', classes: [], attrs: [] }, rest = part.slice(m[0].length), r;
        var re = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]/g;
        while ((r = re.exec(rest))) {
          if (r[1]) c.id = r[1]; else if (r[2]) c.classes.push(r[2]); else c.attrs.push({ k: r[3], v: r[4] !== undefined ? r[4] : r[5] });
        }
        return c;
      });
    });
  }
  function one(el, c) {
    if (c.tag && el.tagName !== c.tag) return false;
    if (c.id && el.id !== c.id) return false;
    for (var i = 0; i < c.classes.length; i++) if (!el.classList.contains(c.classes[i])) return false;
    for (var j = 0; j < c.attrs.length; j++) {
      var a = c.attrs[j];
      if (!el.hasAttribute(a.k)) return false;
      if (a.v !== undefined && el.getAttribute(a.k) !== a.v) return false;
    }
    return true;
  }
  function matches(el, chain) {
    if (!one(el, chain[chain.length - 1])) return false;
    var k = chain.length - 2, p = el.parentNode;
    while (k >= 0 && p && p.nodeType === 1) { if (one(p, chain[k])) k--; p = p.parentNode; }
    return k < 0;
  }
  P.querySelectorAll = function (sel) {
    var groups = parse(sel);
    return descendants(this, []).filter(function (el) { return groups.some(function (g) { return matches(el, g); }); });
  };
  P.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  P.matches = function (sel) { var self = this; return parse(sel).some(function (g) { return matches(self, g); }); };
  P.closest = function (sel) { var n = this; while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parentNode; } return null; };

  var root = new El('html'), body = new El('body');
  root.appendChild(body);
  dom.El = El;
  dom.root = root;
  dom.document = {
    documentElement: root, body: body, activeElement: null,
    createElement: function (t) { return new El(t); },
    createElementNS: function (ns, t) { return new El(t, ns); },
    createTextNode: function (t) { return new TextNode(t); },
    getElementById: function (id) { return root.querySelector('#' + id); },
    querySelector: function (s) { return root.querySelector(s); },
    querySelectorAll: function (s) { return root.querySelectorAll(s); }
  };
  /* the editor's side pane, as the page has it */
  var side = new El('div'); side.id = 'edSide'; side.className = 'ed-side';
  var sideBody = new El('div'); sideBody.id = 'edSideBody';
  side.appendChild(sideBody); body.appendChild(side);
  dom.sideBody = sideBody;
  return dom;
}

/* ---------- the studio around the file ---------- */
var RICH = { name: 'Agentic AI Summit 2027', hashtag: '#AgenticAiSummit27', edition: 9, dateLabel: '12–13 March 2027', venue: 'Jio World Centre, Mumbai',
  link: 'https://agentic.etb2b.example/register', micrositeUrl: 'https://agentic.etb2b.example/', published: true };
/* each template's own caption as the html route answers it (untrimmed, ending with the hashtag) */
function captionOf(tid, params) {
  if (tid === 'generic.testimonial') return params && params.quote ? '"' + params.quote + '" — Asha Rao, CIO #AgenticAiSummit27' : '';
  if (tid === 'speaker.individual') return 'Meet ' + ((params && params.speakerId) || 's1') + ' at Agentic AI Summit 2027. #AgenticAiSummit27';
  return 'Facts for ' + tid + ' at Agentic AI Summit 2027. #AgenticAiSummit27';
}
function res(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status,
    json: function () { return body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body); } });
}
function deferred() { var d = {}; d.p = new Promise(function (ok) { d.go = function (v) { ok(v); }; }); return d; }
function settle(ms) { return new Promise(function (ok) { setTimeout(ok, ms || 8); }); }

/* o: { tid, params, els, event, clipboard, write(body) -> Promise<response>, html(body) -> Promise<response>, authThrows } */
function load(o) {
  o = o || {};
  var dom = makeDom(), calls = { fetch: [], toast: [], timers: [] };
  var sb = {
    console: console, URLSearchParams: URLSearchParams,
    document: dom.document,
    location: { search: '?event=qa-ev1', origin: 'https://oneworld.example' },
    navigator: { clipboard: o.clipboard },
    setTimeout: function (fn, ms) { calls.timers.push(ms); return setTimeout(fn, 0); },
    clearTimeout: clearTimeout,
    EVENT_ID: 'qa-ev1',
    EDIT: { tid: o.tid === undefined ? 'generic.who-should-attend' : o.tid, fmt: 'ig_square', width: 1080, height: 1080, base: '', els: o.els || [] },
    edParams: o.params || { theme: 'dark' },
    edMode: 'props',
    CAT: { event: o.event || RICH, catalog: { categories: [{ id: 'all', templates: TEMPLATES }] } },
    findTpl: function (id) { return tpl(id); },
    toast: function (m, ms) { calls.toast.push(ms === undefined ? [m] : [m, ms]); },
    RevampAuth: {
      authedFetch: function (url, opts) {
        if (o.authThrows === 'sync') throw new Error('signed out');
        var body = JSON.parse(opts.body);
        calls.fetch.push({ url: url, body: body, opts: opts });
        if (o.authThrows === 'reject') return Promise.reject(new Error('network down'));
        if (url === '/api/promo/social/html') {
          if (o.html) return o.html(body);
          return res(200, { items: body.items.map(function (it) { return { templateId: it.templateId, format: it.format, width: 1080, height: 1080, caption: captionOf(it.templateId, it.params) }; }) });
        }
        if (url === '/api/promo/write') return o.write ? o.write(body) : new Promise(function () {});
        return res(404, { error: 'no such route' });
      }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: FILE });
  return { sb: sb, dom: dom, calls: calls, cap: sb.OWSCap,
    /* a load of the editor as oneworld-social.js reports it: the editor's template, size and options are set first
       (a saved layout's options restored into edParams), then OWSCap.onLoad */
    open: function (info) {
      sb.EDIT.tid = info.templateId; sb.EDIT.fmt = info.format;
      sb.edParams = info.params || {};
      sb.OWSCap.onLoad(info);
    },
    $: function (id) { return dom.document.getElementById(id); },
    writes: function () { return calls.fetch.filter(function (f) { return f.url === '/api/promo/write'; }); },
    htmls: function () { return calls.fetch.filter(function (f) { return f.url === '/api/promo/social/html'; }); },
    lastToast: function () { return calls.toast[calls.toast.length - 1]; } };
}
function shown(el) { return !!el && el.style.display !== 'none'; }
/* the Options tab as the platform's renderOptions draws it: one .param per option, the field carrying data-key */
function drawOptions(x, tid, values) {
  var d = x.dom.document, body = x.dom.sideBody;
  body.textContent = '';
  var ph = d.createElement('div'); ph.className = 'ph'; ph.textContent = 'Template options'; body.appendChild(ph);
  var host = d.createElement('div'); host.id = 'edOpts'; body.appendChild(host);
  tpl(tid).params.forEach(function (p) {
    var wrap = d.createElement('div'); wrap.className = 'param';
    var lab = d.createElement('label'); lab.className = 'h'; lab.textContent = p.label || p.key; wrap.appendChild(lab);
    var f = d.createElement(p.type === 'select' ? 'select' : p.type === 'textarea' ? 'textarea' : 'input');
    f.setAttribute('data-key', p.key);
    f.value = values && values[p.key] != null ? values[p.key] : (p.default != null && !Array.isArray(p.default) ? String(p.default) : '');
    wrap.appendChild(f);
    var hint = d.createElement('div'); hint.className = 'hint'; hint.textContent = 'a hint'; wrap.appendChild(hint);
    host.appendChild(wrap);
  });
  return host;
}
function field(x, key) { return x.$('edOpts').querySelector('[data-key="' + key + '"]'); }

(async function main() {
  var HONEST = 'Posting straight to LinkedIn, Instagram or X is not part of this release. Download the picture, copy the caption, and post them from the event’s own account.';
  var x, y, t, r, d;

  /* ================= G.1 the caption, shaped per network ================= */
  x = load();
  var shape = x.sb.owCapShape;
  var B = 'Who should attend Agentic AI Summit 2027? CIOs, CTOs and heads of data. #AgenticAiSummit27';
  var BODY = 'Who should attend Agentic AI Summit 2027? CIOs, CTOs and heads of data.';
  var WHEN = '12–13 March 2027 · Jio World Centre, Mumbai', LINK = 'https://agentic.etb2b.example/register', TAG = '#AgenticAiSummit27';
  check('G.1 LinkedIn: body, date · place, Register: link, hashtag',
    shape(B, 'linkedin', 'generic.who-should-attend') === [BODY, WHEN, 'Register: ' + LINK, TAG].join('\n\n'), shape(B, 'linkedin', 'generic.who-should-attend'));
  check('G.1 Instagram: body, date · place, hashtag, no link', shape(B, 'instagram', 'generic.who-should-attend') === [BODY, WHEN, TAG].join('\n\n'),
    shape(B, 'instagram', 'generic.who-should-attend'));
  check('G.1 X: body, then the link and the hashtag on one line, no date line', shape(B, 'x', 'generic.who-should-attend') === BODY + '\n\n' + LINK + ' ' + TAG,
    shape(B, 'x', 'generic.who-should-attend'));
  var words = []; for (var i = 0; words.join(' ').length < 420; i++) words.push('leaders' + i);
  var longBase = words.join(' ') + ' ' + TAG, xs = shape(longBase, 'x', 'generic.summit-highlights');
  var xHead = xs.split('\n\n')[0], kept = xHead.slice(0, -1);
  check('G.1 X: a long caption fits in 280 with the link and the hashtag', xs.length <= 280 && /\n\nhttps:\/\/agentic\.etb2b\.example\/register #AgenticAiSummit27$/.test(xs), xs.length);
  check('G.1 X: cut at a word, with …', xHead.slice(-1) === '…' && longBase.indexOf(kept) === 0 && longBase.charAt(kept.length) === ' ', xHead.slice(-30));
  check('G.1 X: the cut is Oneworld\'s (280 − tail − 2, at a word)', xHead === longBase.slice(0, 280 - (LINK + ' ' + TAG).length - 2 - 1).replace(/\s+\S*$/, '') + '…');
  ['generic.announcement', 'speaker.individual'].forEach(function (tid) {
    var b = 'Save the date for Agentic AI Summit 2027 on 12 March in Mumbai. ' + TAG;
    check('G.1 ' + tid + ': no date · place line (its own caption has them)', shape(b, 'linkedin', tid) === ['Save the date for Agentic AI Summit 2027 on 12 March in Mumbai.', 'Register: ' + LINK, TAG].join('\n\n') &&
      shape(b, 'instagram', tid).indexOf(WHEN) === -1, shape(b, 'linkedin', tid));
  });
  IDS.filter(function (id) { return id !== 'generic.announcement' && id !== 'speaker.individual' && id !== 'generic.testimonial'; }).forEach(function (tid) {
    check('G.1 ' + tid + ' has the date · place line', shape('Text. ' + TAG, 'linkedin', tid).indexOf('\n\n' + WHEN + '\n\n') !== -1);
  });
  check('G.1 the trailing hashtag is taken off once', shape('Hello ' + TAG + ' ' + TAG, 'linkedin', 'speaker.combined') === ['Hello ' + TAG, WHEN, 'Register: ' + LINK, TAG].join('\n\n'),
    shape('Hello ' + TAG + ' ' + TAG, 'linkedin', 'speaker.combined'));
  check('G.1 a hashtag inside the text stays', shape('Join ' + TAG + ' now.', 'instagram', 'speaker.combined') === ['Join ' + TAG + ' now.', WHEN, TAG].join('\n\n'));
  check('G.1 a word that only ends like the hashtag is not cut', shape('x' + TAG, 'instagram', 'speaker.combined').indexOf('x' + TAG + '\n\n') === 0);
  check('G.1 a caption with no hashtag (the template wrote a space) loses only the space',
    load({ event: Object.assign({}, RICH, { hashtag: '' }) }).sb.owCapShape('Text ', 'linkedin', 'speaker.combined') === ['Text', WHEN, 'Register: ' + LINK].join('\n\n'));
  y = load({ event: Object.assign({}, RICH, { published: false }) });
  check('G.1 an unpublished event: no link on LinkedIn', y.sb.owCapShape(B, 'linkedin', 'generic.who-should-attend') === [BODY, WHEN, TAG].join('\n\n'),
    y.sb.owCapShape(B, 'linkedin', 'generic.who-should-attend'));
  check('G.1 an unpublished event: no link on X', y.sb.owCapShape(B, 'x', 'generic.who-should-attend') === BODY + '\n\n' + TAG);
  y = load({ event: { name: 'Only The Name', hashtag: '', dateLabel: '', venue: '', link: '', published: true } });
  check('G.1 all empty: the event\'s name (LinkedIn, Instagram)', y.sb.owCapShape('', 'linkedin', 'speaker.combined') === 'Only The Name' &&
    y.sb.owCapShape('', 'instagram', 'speaker.combined') === 'Only The Name');
  check('G.1 all empty on X: nothing, as Oneworld\'s X has no name fallback', y.sb.owCapShape('', 'x', 'speaker.combined') === '');
  check('G.1 a testimonial with no quote has no caption at all', ['linkedin', 'instagram', 'x'].every(function (n) { return x.sb.owCapShape('', n, 'generic.testimonial') === ''; }));
  check('G.1 venue only: the place alone', load({ event: Object.assign({}, RICH, { dateLabel: '' }) }).sb.owCapShape('A. ' + TAG, 'instagram', 'speaker.combined') ===
    ['A.', 'Jio World Centre, Mumbai', TAG].join('\n\n'));

  /* ================= the tab ================= */
  x = load();
  x.open({ templateId: 'generic.who-should-attend', format: 'ig_square', params: { theme: 'dark' }, saved: false });
  await settle();
  x.sb.owRenderCaption();
  var body = x.dom.sideBody, ta = x.$('owCapText');
  var facts = shape(captionOf('generic.who-should-attend'), 'linkedin', 'generic.who-should-attend');
  check('tab: heading Caption', body.querySelector('.ph') && body.querySelector('.ph').textContent === 'Caption');
  var segBtns = x.$('owCapNet').querySelectorAll('button[data-v]');
  check('tab: the networks LinkedIn | Instagram | X, LinkedIn on', x.$('owCapNet').classList.contains('seg') && segBtns.map(function (b) { return b.textContent; }).join('|') === 'LinkedIn|Instagram|X' &&
    segBtns[0].classList.contains('on') && segBtns[0].getAttribute('aria-pressed') === 'true' && segBtns[2].getAttribute('aria-pressed') === 'false');
  var lab = body.querySelector('label');
  check('tab: the label is for the textarea and says the network', lab.getAttribute('for') === 'owCapText' && /^Caption for LinkedIn /.test(lab.textContent), lab.textContent);
  check('tab: the counter n / 3000 inside the label', x.$('owCapN') && x.$('owCapN').parentNode === lab && x.$('owCapN').textContent === facts.length + ' / 3000', x.$('owCapN') && x.$('owCapN').textContent);
  check('tab: a textarea of 7 rows holding the facts', ta.tagName === 'TEXTAREA' && ta.rows === 7 && ta.value === facts, ta.value);
  check('tab: the hint, verbatim', body.querySelectorAll('.hint').some(function (h) { return h.textContent === 'Made from the event’s facts. Edit it freely.'; }));
  var acts = body.querySelector('.ow-cap-acts');
  check('tab: the four buttons in .ow-cap-acts', acts && ['owCapAi', 'owCapCopy', 'owCapUndo', 'owCapReset'].every(function (id) { return x.$(id) && x.$(id).parentNode === acts && x.$(id).type === 'button'; }));
  check('tab: the buttons\' words', x.$('owCapAi').textContent === 'Write with AI' && x.$('owCapCopy').textContent === 'Copy caption' &&
    x.$('owCapUndo').textContent === 'Undo' && x.$('owCapReset').textContent === 'Back to the facts');
  check('tab: Undo and Back to the facts hidden at first', !shown(x.$('owCapUndo')) && !shown(x.$('owCapReset')));
  check('tab: the honest note, verbatim', body.querySelector('.ow-honest') && body.querySelector('.ow-honest').textContent === HONEST, body.querySelector('.ow-honest') && body.querySelector('.ow-honest').textContent);
  check('tab: the facts were asked once, captionOnly, with the template, size and options',
    x.htmls().length === 1 && x.htmls()[0].body.captionOnly === true && x.htmls()[0].body.eventId === 'qa-ev1' &&
    JSON.stringify(x.htmls()[0].body.items) === JSON.stringify([{ templateId: 'generic.who-should-attend', format: 'ig_square', params: { theme: 'dark' } }]), x.htmls()[0] && x.htmls()[0].body);
  x.sb.owRenderCaption();
  check('tab: drawn again, the facts are not asked again', x.htmls().length === 1);
  /* the elements of the tab as drawn now */
  ta = x.$('owCapText'); lab = x.dom.sideBody.querySelector('label'); segBtns = x.$('owCapNet').querySelectorAll('button[data-v]');
  check('tab: drawn again, the same text', ta.value === facts);
  /* no template open */
  y = load({ tid: null });
  y.sb.owRenderCaption();
  check('tab: with no template open it says so and asks nothing', /Open a template/.test(y.dom.sideBody.textContent) && y.htmls().length === 0);
  /* drawn before the adapter told it of the load: it starts from the editor's own state */
  y = load({ tid: 'speaker.combined', params: { theme: 'light', group: 'Jury' } });
  y.sb.owRenderCaption();
  await settle();
  check('tab: drawn with no onLoad, it reads the editor\'s template and options', y.htmls().length === 1 && y.htmls()[0].body.items[0].templateId === 'speaker.combined' &&
    y.htmls()[0].body.items[0].params.group === 'Jury' && y.$('owCapText').value === y.sb.owCapShape(captionOf('speaker.combined'), 'linkedin', 'speaker.combined'));

  /* networks */
  segBtns[2].click();
  check('network: X shapes the facts for X', ta.value === shape(captionOf('generic.who-should-attend'), 'x', 'generic.who-should-attend') && /^Caption for X/.test(lab.textContent) &&
    / \/ 280$/.test(x.$('owCapN').textContent) && segBtns[2].classList.contains('on') && !segBtns[0].classList.contains('on'), ta.value);
  check('network: picking one is a change to save', x.cap.dirty() === true && x.cap.state().network === 'x' && x.cap.state().text === null);
  segBtns[1].click();
  check('network: Instagram, max 2200', / \/ 2200$/.test(x.$('owCapN').textContent) && ta.value === shape(captionOf('generic.who-should-attend'), 'instagram', 'generic.who-should-attend'));
  segBtns[0].click();
  check('network: back to the loaded one, nothing to save', x.cap.dirty() === false);

  /* ================= G.4 typing, Back to the facts, Undo, dirty, state ================= */
  ta.type_('My own words');
  check('G.4 typing keeps the text, shows Back to the facts, not Undo', x.cap.state().text === 'My own words' && shown(x.$('owCapReset')) && !shown(x.$('owCapUndo')) && x.cap.dirty() === true);
  check('G.4 the counter follows the typing', x.$('owCapN').textContent === '12 / 3000');
  segBtns[2].click();
  check('G.4 a typed caption is kept when the network changes', ta.value === 'My own words' && x.cap.state().text === 'My own words' && x.cap.state().network === 'x');
  ta.type_(new Array(301).join('a'));
  check('G.4 past the network\'s length the counter is marked .over', x.$('owCapN').classList.contains('over') && x.$('owCapN').textContent === '300 / 280', x.$('owCapN').className);
  ta.type_('short');
  check('G.4 back under it, the mark goes', !x.$('owCapN').classList.contains('over'));
  x.$('owCapReset').click();
  check('G.4 Back to the facts: the facts again, the button hides', x.cap.state().text === null && ta.value === shape(captionOf('generic.who-should-attend'), 'x', 'generic.who-should-attend') && !shown(x.$('owCapReset')));
  /* a save as oneworld-social.js makes it: state() goes in the request, markSaved() when the answer comes. state()
     keeps what it hands over, so no check below reads it between a save's state() and its markSaved(). */
  var sentNow = x.cap.state();
  x.cap.markSaved();
  check('G.4 saved: nothing left to save', x.cap.dirty() === false && JSON.stringify(sentNow) === JSON.stringify({ network: 'x', text: null }));
  ta.type_('edited after the save');
  check('G.4 an edit after the save is a change again', x.cap.dirty() === true);
  x.cap.state();
  x.cap.markSaved();
  check('G.4 saved again', x.cap.dirty() === false);
  /* the owner goes on typing while the save is on its way: what was sent is saved, the rest is still a change */
  ta.type_('Version sent');
  sentNow = x.cap.state();
  ta.type_('Version sent, then more typed while saving');
  x.cap.markSaved();
  var afterAnswer = x.cap.dirty();
  x.cap.markSaved();
  check('G.4 words typed while saving are still a change when the answer comes', sentNow.text === 'Version sent' && afterAnswer === true &&
    ta.value === 'Version sent, then more typed while saving', [sentNow.text, afterAnswer, ta.value]);
  check('G.4 …and a second markSaved for the same save does not mark them', x.cap.dirty() === true);
  segBtns[0].click();
  x.cap.state();
  segBtns[1].click();
  x.cap.markSaved();
  check('G.4 a network picked while saving is still a change', x.cap.dirty() === true && segBtns[1].classList.contains('on'));
  segBtns[0].click();
  check('G.4 …and picking back the network that was sent leaves nothing to save', x.cap.dirty() === false);
  ta.type_('Typed, then put back');
  ta.type_('Version sent, then more typed while saving');
  check('G.4 the saved words typed again are nothing to save', x.cap.dirty() === false);
  /* an answer for a save made before this load marks nothing on this one (oneworld-social.js marks a save of the
     same template and size, whichever theme or background is open when the answer comes) */
  y = load();
  y.open({ templateId: 'speaker.combined', format: 'ig_square', params: { theme: 'dark' } });
  y.sb.owRenderCaption();
  y.$('owCapText').type_('Saved on the dark theme');
  y.cap.state();
  y.open({ templateId: 'speaker.combined', format: 'ig_square', params: { theme: 'light' } });
  y.sb.owRenderCaption();
  y.$('owCapText').type_('Typed on the light theme');
  y.cap.markSaved();
  check('G.4 an answer for a save of the earlier load marks nothing on this one', y.cap.dirty() === true && y.$('owCapText').value === 'Typed on the light theme');
  y.open({ templateId: 'speaker.combined', format: 'ig_square', params: { theme: 'dark' } });
  y.sb.owRenderCaption();
  y.$('owCapText').type_('Not sent');
  y.cap.markSaved();
  check('G.4 markSaved with nothing sent on this load marks nothing', y.cap.dirty() === true);

  /* saved captions, restored */
  x = load({ tid: 'speaker.individual' });
  x.open({ templateId: 'speaker.individual', format: 'ig_portrait', params: { theme: 'dark', speakerId: 's3' }, saved: { saved: true, params: { speakerId: 's3' }, caption: { network: 'x', text: 'Saved words' } } });
  check('G.4 a saved caption is the state, and nothing is to save', JSON.stringify(x.cap.state()) === JSON.stringify({ network: 'x', text: 'Saved words' }) && x.cap.dirty() === false);
  await settle();
  check('G.4 a layout saved with its own words asks no facts on load (one layout read only)', x.htmls().length === 0 && x.cap.textFor('speaker.individual') === 'Saved words');
  x.sb.owRenderCaption();
  await settle();
  check('G.4 the facts after a reopen come from the saved options, asked when the tab is drawn', x.htmls().length === 1 && x.htmls()[0].body.items[0].params.speakerId === 's3' && x.htmls()[0].body.items[0].format === 'ig_portrait',
    x.htmls()[0] && x.htmls()[0].body.items[0]);
  ta = x.$('owCapText');
  check('G.4 the tab shows the saved caption on its network, with Back to the facts', ta.value === 'Saved words' && x.$('owCapNet').querySelector('[data-v="x"]').classList.contains('on') && shown(x.$('owCapReset')));
  x.$('owCapReset').click();
  check('G.4 …and Back to the facts gives the saved options\' facts', ta.value === x.sb.owCapShape(captionOf('speaker.individual', { speakerId: 's3' }), 'x', 'speaker.individual') && /Meet s3/.test(ta.value), ta.value);
  check('G.4 textFor gives what the tab shows; another template has none', x.cap.textFor('speaker.individual') === ta.value && x.cap.textFor('speaker.combined') === null);
  /* own words saved, the tab drawn and Back to the facts pressed before the facts have come */
  x = load({ tid: 'speaker.individual' });
  x.open({ templateId: 'speaker.individual', format: 'ig_square', params: { speakerId: 's3' }, saved: { saved: true, caption: { network: 'linkedin', text: 'Own words' } } });
  x.sb.owRenderCaption();
  x.$('owCapReset').click();
  check('G.4 Back to the facts before they have come: the textarea says they are being read', x.$('owCapText').value === '' &&
    x.$('owCapText').placeholder === 'Reading the event’s facts…' && x.cap.textFor('speaker.individual') === null && x.htmls().length === 1);
  await settle();
  check('G.4 …then shows them', x.$('owCapText').value === x.sb.owCapShape(captionOf('speaker.individual', { speakerId: 's3' }), 'linkedin', 'speaker.individual') &&
    x.$('owCapText').placeholder === '', x.$('owCapText').value);
  y = load({ tid: 'speaker.individual' });
  y.open({ templateId: 'speaker.individual', format: 'ig_square', params: {}, saved: true, caption: { network: 'instagram', text: null } });
  check('G.4 a caption passed beside saved:true is read too', JSON.stringify(y.cap.state()) === JSON.stringify({ network: 'instagram', text: null }));
  y.open({ templateId: 'speaker.individual', format: 'ig_square', params: {}, saved: { saved: true, caption: { network: 'myspace', text: 'T' } } });
  check('G.4 a saved caption for a network not known falls back to LinkedIn', JSON.stringify(y.cap.state()) === JSON.stringify({ network: 'linkedin', text: 'T' }));
  y.open({ templateId: 'speaker.individual', format: 'ig_square', params: {}, saved: false });
  check('G.4 a fresh load: the facts, nothing to save', JSON.stringify(y.cap.state()) === JSON.stringify({ network: 'linkedin', text: null }) && y.cap.dirty() === false);
  check('G.4 textFor is null while the facts are being read', y.cap.textFor('speaker.individual') === null);
  await settle();
  check('G.4 textFor gives the facts once read', y.cap.textFor('speaker.individual') === y.sb.owCapShape(captionOf('speaker.individual', {}), 'linkedin', 'speaker.individual'));
  y = load();
  check('G.4 before any load: state is LinkedIn and the facts, nothing to save, no text', JSON.stringify(y.cap.state()) === JSON.stringify({ network: 'linkedin', text: null }) &&
    y.cap.dirty() === false && y.cap.textFor('generic.who-should-attend') === null);
  /* a layout with no saved caption opens on LinkedIn, whatever was picked on the one before (promo-posts.js newCfg) */
  x = load();
  x.open({ templateId: 'generic.who-should-attend', format: 'ig_square', params: {} });
  x.sb.owRenderCaption();
  x.$('owCapNet').querySelector('[data-v="instagram"]').click();
  check('G.4 a network picked is a change to save', x.cap.dirty() === true);
  x.open({ templateId: 'speaker.combined', format: 'ig_square', params: {} });
  check('G.4 the next layout with no saved caption opens on LinkedIn, nothing to save', x.cap.dirty() === false && x.cap.state().network === 'linkedin');
  x.sb.owRenderCaption();
  check('G.4 …and its tab shows LinkedIn', x.$('owCapNet').querySelector('[data-v="linkedin"]').classList.contains('on') &&
    /^Caption for LinkedIn /.test(x.dom.sideBody.querySelector('label').textContent), x.dom.sideBody.querySelector('label').textContent);
  x.open({ templateId: 'speaker.combined', format: 'ig_square', params: {}, saved: { saved: true, caption: { network: 'instagram', text: null } } });
  check('G.4 a layout saved on Instagram still opens on Instagram', x.cap.dirty() === false && x.cap.state().network === 'instagram');

  /* the facts: cache, failure, an answer for an earlier load */
  x = load();
  x.open({ templateId: 'speaker.combined', format: 'ig_square', params: { theme: 'dark', group: 'A' } });
  x.open({ templateId: 'speaker.combined', format: 'ig_story', params: { theme: 'light', bg: '2', group: 'A' } });
  check('facts: asked once per template and options (theme, background and size change no word)', x.htmls().length === 1);
  x.open({ templateId: 'speaker.combined', format: 'ig_square', params: { theme: 'dark', group: 'B' } });
  check('facts: other options are asked again', x.htmls().length === 2);
  var failNext = true;
  x = load({ html: function (b) { if (failNext) { failNext = false; return res(500, { error: 'Something went wrong with the posts. Please try again.' }); } return res(200, { items: [{ templateId: b.items[0].templateId, caption: 'Back. ' + TAG }] }); } });
  x.open({ templateId: 'speaker.combined', format: 'ig_square', params: {} });
  x.sb.owRenderCaption();
  check('facts: while they are read the textarea says so', x.$('owCapText').placeholder === 'Reading the event’s facts…' && x.$('owCapText').value === '');
  await settle();
  check('facts: a failure says so, and nothing is shown as the facts', /could not be read/.test(x.$('owCapText').placeholder) && x.$('owCapText').value === '' && x.cap.textFor('speaker.combined') === null);
  x.sb.owRenderCaption();
  await settle();
  check('facts: shown again, the tab asks again', x.htmls().length === 2 && x.$('owCapText').value === ['Back.', WHEN, 'Register: ' + LINK, TAG].join('\n\n') && x.$('owCapText').placeholder === '');
  var slow = deferred();
  x = load({ html: function (b) { return b.items[0].templateId === 'speaker.combined' ? slow.p : res(200, { items: [{ caption: 'Second. ' + TAG }] }); } });
  x.open({ templateId: 'speaker.combined', format: 'ig_square', params: {} });
  x.sb.owRenderCaption();
  x.open({ templateId: 'generic.summit-highlights', format: 'ig_square', params: {} });
  x.sb.owRenderCaption();
  await settle();
  slow.go(res(200, { items: [{ caption: 'First, late. ' + TAG }] }));
  await settle();
  check('facts: an answer for an earlier template is never shown on the one open now', x.$('owCapText').value.indexOf('Second.') === 0 && x.$('owCapText').value.indexOf('First') === -1, x.$('owCapText').value);

  /* testimonial */
  x = load({ tid: 'generic.testimonial' });
  x.open({ templateId: 'generic.testimonial', format: 'ig_square', params: { theme: 'dark' } });
  x.sb.owRenderCaption();
  await settle();
  check('testimonial with no quote: no facts, and the textarea says to type the quote first', x.$('owCapText').value === '' && x.$('owCapText').placeholder === 'Type the quote in Options first.' &&
    x.cap.textFor('generic.testimonial') === '');
  x.$('owCapAi').click();
  await settle();
  check('testimonial with no quote: Write with AI asks nothing and says why (6 s)', x.writes().length === 0 &&
    JSON.stringify(x.lastToast()) === JSON.stringify(['Type the quote in Options, then Apply & re-render: a testimonial shows a real quote, never a made-up one.', 6000]), x.lastToast());
  x.open({ templateId: 'generic.testimonial', format: 'ig_square', params: { theme: 'dark', quote: 'It changed how we buy AI.' } });
  x.sb.owRenderCaption();
  await settle();
  x.$('owCapAi').click();
  check('testimonial with a quote: the quote is in the facts and goes to the AI under its own name',
    /It changed how we buy AI/.test(x.$('owCapText').value) && x.writes().length === 1 && x.writes()[0].body.post.quote === 'It changed how we buy AI.');

  /* copy */
  var copied = [];
  x = load({ clipboard: { writeText: function (t) { copied.push(t); return Promise.resolve(); } } });
  x.open({ templateId: 'generic.who-should-attend', format: 'ig_square', params: {} });
  x.sb.owRenderCaption();
  await settle();
  x.$('owCapCopy').click();
  await settle();
  check('copy: the caption on screen is copied', copied.length === 1 && copied[0] === x.$('owCapText').value && JSON.stringify(x.lastToast()) === JSON.stringify(['Caption copied.']));
  for (var c = 0; c < 3; c++) {
    var clip = [{ writeText: function () { return Promise.reject(new Error('denied')); } }, { writeText: function () { throw new Error('no permission'); } }, undefined][c];
    var z = load({ clipboard: clip });
    z.open({ templateId: 'generic.who-should-attend', format: 'ig_square', params: {} });
    z.sb.owRenderCaption();
    await settle();
    z.$('owCapCopy').click();
    await settle();
    check('copy (' + ['refused', 'throws', 'no clipboard'][c] + '): the caption is selected and the owner told how to copy it',
      z.$('owCapText').selected === true && z.dom.document.activeElement === z.$('owCapText') &&
      JSON.stringify(z.lastToast()) === JSON.stringify(['Press Ctrl+C (⌘C on a Mac) to copy the selected caption.', 6000]), z.lastToast());
  }

  /* ================= G.2 what Write with AI sends ================= */
  var els = [];
  for (var k = 0; k < 28; k++) els.push({ id: 't' + k, type: 'text', text: 'Canvas line number ' + k + ' with some words to fill the post out properly, line ' + k + '.', x: 0, y: 0, w: 100 });
  els.splice(3, 0, { id: 'img', type: 'image', src: 'https://img.etb2bimg.com/x.png' }, { id: 'blank', type: 'text', text: '   ' }, { id: 'shape', type: 'shape' });
  x = load({ tid: 'generic.prediction-outcome', els: els, params: { theme: 'dark', headline: 'Signals to action' } });
  x.open({ templateId: 'generic.prediction-outcome', format: 'ig_square', params: { theme: 'dark', headline: 'Signals to action' }, saved: false });
  x.sb.owRenderCaption();
  await settle();
  x.$('owCapAi').click();
  var w = x.writes()[0], post = w && w.body.post;
  check('G.2 one request to /api/promo/write', x.writes().length === 1);
  check('G.2 the body: eventId, task caption, the network, the post, the caption on screen as current',
    w.body.eventId === 'qa-ev1' && w.body.task === 'caption' && w.body.network === 'linkedin' && w.body.current === x.$('owCapText').value && w.body.current.length > 0, w.body);
  check('G.2 no heading key anywhere (the route reads current)', !('heading' in w.body) && !('heading' in post));
  check('G.2 type and template', post.type === 'outlook' && post.template === 'Prediction vs Outcome', [post.type, post.template]);
  var pk = Object.keys(post);
  check('G.2 the options come first, under their own names', pk.slice(0, 7).join(',') === 'type,template,headline,prediction,outcome,predictionLabel,outcomeLabel', pk.slice(0, 8));
  check('G.2 the applied value, not the default', post.headline === 'Signals to action');
  check('G.2 an option left at its default is sent with the default', post.prediction === tpl('generic.prediction-outcome').params[1].default && post.predictionLabel === 'Prediction');
  check('G.2 then the canvas texts in order as text1…, blank ones and pictures left out', post.text1 === els[0].text && post.text3 === els[2].text && post.text4 === els[6].text, [post.text3, post.text4]);
  check('G.2 at most 30 keys', pk.length <= 30, pk.length);
  var lines = pieceLines(post), joined = lines.join('\n');
  check('G.2 at most 3,000 characters as the route counts them', joined.length <= 3000, joined.length);
  check('G.2 every key the browser sends is read by the route (none past its 30 keys or 3,000 characters)', lines.length === pk.length - 1, [lines.length, pk.length]);
  if (promoT) {
    var kit = { event: { name: RICH.name, hashtag: TAG, published: true }, content: { overview: '', audience: [], topics: [], stats: [], speakers: [], partners: [], sessions: [] } };
    var prompt = promoT.writeRequest(w.body, kit).prompt, piece = prompt.split('THE POST\'S OWN TEXT\n')[1] || '';
    check('G.2 with 28 canvas texts the options still reach the prompt', ['headline: Signals to action', 'prediction: ', 'outcome: ', 'predictionLabel: Prediction', 'outcomeLabel: Outcome'].every(function (s) { return piece.indexOf(s) !== -1; }));
    check('G.2 …and the last text sent arrives whole', piece.indexOf(lines[lines.length - 1]) !== -1, lines[lines.length - 1]);
    check('G.2 the route knows what an outlook post is for', promoT.kindNote('outlook') !== 'promotes the event');
  }
  /* long values: each at most 600, the total kept */
  var big = new Array(901).join('w');
  x = load({ tid: 'generic.prediction-outcome', els: [{ type: 'text', text: big }, { type: 'text', text: big }, { type: 'text', text: big }, { type: 'text', text: big }, { type: 'text', text: big }, { type: 'text', text: 'last' }],
    params: { theme: 'dark', prediction: big } });
  x.open({ templateId: 'generic.prediction-outcome', format: 'ig_square', params: { theme: 'dark', prediction: big } });
  x.sb.owRenderCaption();
  x.$('owCapAi').click();
  post = x.writes()[0].body.post;
  check('G.2 each value at most 600 characters', Object.keys(post).every(function (q) { return String(post[q]).length <= 600; }) && post.prediction.length === 600 && post.text1.length === 600);
  check('G.2 the total stays inside 3,000 with the last text cut to fit, and nothing after it', pieceLines(post).join('\n').length <= 3000 &&
    pieceLines(post).join('\n').length > 2900 && !('text6' in post), [pieceLines(post).join('\n').length, Object.keys(post)]);
  check('G.2 line breaks in a text are sent on one line', (function () {
    var z = load({ tid: 'speaker.combined', els: [{ type: 'text', text: 'Meet\nour\n\nspeakers' }] });
    z.open({ templateId: 'speaker.combined', format: 'ig_square', params: {} });
    z.sb.owRenderCaption(); z.$('owCapAi').click();
    return z.writes()[0].body.post.text1 === 'Meet our speakers';
  })());
  /* every template: its kind, and its text options under their own names */
  IDS.forEach(function (tid) {
    var params = { theme: 'dark' }, want = {};
    tpl(tid).params.forEach(function (p) { if (p.type === 'text') { params[p.key] = 'Value of ' + p.key; want[p.key] = 'Value of ' + p.key; } });
    var z = load({ tid: tid, params: params, els: [{ type: 'text', text: 'On the canvas' }] });
    z.open({ templateId: tid, format: 'ig_square', params: params });
    z.sb.owRenderCaption();
    z.$('owCapAi').click();
    var p = z.writes()[0] && z.writes()[0].body.post;
    check('G.2 ' + tid + ': type ' + KIND[tid], p && p.type === KIND[tid], p && p.type);
    check('G.2 ' + tid + ': its template label', p && p.template === tpl(tid).label);
    check('G.2 ' + tid + ': every text option under its own name', p && Object.keys(want).every(function (q) { return p[q] === want[q]; }), p);
    check('G.2 ' + tid + ': no option that is not text (ids, counts, stats)', p && ['speakerId', 'speakerIds', 'sponsorId', 'sponsorIds', 'limit', 'maxSponsors', 'maxTiers', 'stats', 'group', 'tier', 'theme', 'bg'].every(function (q) { return !(q in p); }));
    check('G.2 ' + tid + ': the canvas text last', p && p['text1'] === 'On the canvas' && Object.keys(p)[Object.keys(p).length - 1] === 'text1');
    if (promoT) check('G.2 ' + tid + ': the route has a note for its kind', promoT.kindNote(KIND[tid]) !== 'promotes the event', KIND[tid]);
  });

  /* ================= G.3 answers and errors ================= */
  var ERRS = [
    { name: '404', r: function () { return res(404, { error: 'That event was not found.' }); }, want: 'Writing with AI is not available yet.' },
    { name: '429 with the server\'s words', r: function () { return res(429, { error: 'The AI has been used a lot in the last few minutes. Try again in a little while.' }); }, want: 'The AI has been used a lot in the last few minutes. Try again in a little while.' },
    { name: '429 with none', r: function () { return res(429); }, want: 'The AI has been used too much for now. Try again later.' },
    { name: '500 with the server\'s words', r: function () { return res(500, { error: 'The AI service did not answer in time.' }); }, want: 'The AI service did not answer in time.' },
    { name: '500 with none', r: function () { return res(500); }, want: 'The AI did not answer. Try again.' },
    { name: '422 example', r: function () { return res(422, { error: 'Example content cannot be saved, downloaded or sent. Add the event\'s own details, then try again.', code: 'example' }); },
      want: 'Example content cannot be saved, downloaded or sent. Add the event\'s own details, then try again.' },
    { name: 'no text', r: function () { return res(200, { text: '' }); }, want: 'No caption came back. Try again.' },
    { name: 'text not a string', r: function () { return res(200, { text: { a: 1 } }); }, want: 'No caption came back. Try again.' }
  ];
  for (var e = 0; e < ERRS.length; e++) {
    x = load({ write: ERRS[e].r });
    x.open({ templateId: 'generic.who-should-attend', format: 'ig_square', params: {} });
    x.sb.owRenderCaption();
    await settle();
    var before = x.$('owCapText').value;
    x.$('owCapAi').click();
    await settle();
    check('G.3 ' + ERRS[e].name + ': ' + ERRS[e].want, JSON.stringify(x.lastToast()) === JSON.stringify([ERRS[e].want, 6000]), x.lastToast());
    check('G.3 ' + ERRS[e].name + ': the caption is untouched and the button usable again', x.$('owCapText').value === before && x.cap.state().text === null &&
      !x.$('owCapAi').disabled && x.$('owCapAi').textContent === 'Write with AI' && !shown(x.$('owCapUndo')));
  }
  for (var h = 0; h < 2; h++) {
    var zz = load({ authThrows: ['sync', 'reject'][h] });
    zz.open({ templateId: 'generic.who-should-attend', format: 'ig_square', params: {} });
    zz.sb.owRenderCaption();
    zz.$('owCapAi').click();
    await settle();
    check('G.3 the sign-in or the network failing (' + ['throws', 'rejects'][h] + '): "The AI did not answer. Try again."',
      JSON.stringify(zz.lastToast()) === JSON.stringify(['The AI did not answer. Try again.', 6000]) && !zz.$('owCapAi').disabled, zz.lastToast());
  }
  /* success, busy, warning, Undo */
  d = deferred();
  x = load({ write: function () { return d.p; } });
  x.open({ templateId: 'generic.who-should-attend', format: 'ig_square', params: {} });
  x.sb.owRenderCaption();
  await settle();
  var factsShown = x.$('owCapText').value;
  x.$('owCapAi').click();
  check('busy: the button reads Writing… and is disabled', x.$('owCapAi').disabled === true && x.$('owCapAi').textContent === 'Writing…');
  x.$('owCapAi').disabled = false; x.$('owCapAi').click();
  check('busy: a second press asks nothing more', x.writes().length === 1);
  x.sb.owRenderCaption();
  check('busy: drawn again while asking, the button is still busy', x.$('owCapAi').disabled === true && x.$('owCapAi').textContent === 'Writing…');
  d.go(res(200, { text: 'Leaders of AI, meet in Mumbai. ' + TAG, warning: 'This copy links to the event\'s site, which is not published yet: the link works once the site is published.' }));
  await settle(); await settle();
  check('G.3 success: the caption is written in, "Caption written."', x.$('owCapText').value === 'Leaders of AI, meet in Mumbai. ' + TAG && x.cap.state().text === 'Leaders of AI, meet in Mumbai. ' + TAG &&
    x.calls.toast.some(function (q) { return q[0] === 'Caption written.' && q.length === 1; }));
  check('G.3 the warning follows as a second toast, once the first has gone', JSON.stringify(x.lastToast()) ===
    JSON.stringify(['This copy links to the event\'s site, which is not published yet: the link works once the site is published.', 6000]) &&
    x.calls.toast.map(function (q) { return q[0]; }).indexOf('Caption written.') < x.calls.toast.length - 1 && x.calls.timers.some(function (ms) { return ms >= 2200; }), x.calls.timers);
  check('G.4 after an AI write: Undo and Back to the facts show; it is a change', shown(x.$('owCapUndo')) && shown(x.$('owCapReset')) && x.cap.dirty() === true && !x.$('owCapAi').disabled);
  x.$('owCapUndo').click();
  check('G.4 Undo brings back the facts and hides itself', x.$('owCapText').value === factsShown && x.cap.state().text === null && !shown(x.$('owCapUndo')) && !shown(x.$('owCapReset')) && x.cap.dirty() === false);
  /* Undo brings back a typed caption, and goes with the next edit */
  x = load({ write: function () { return res(200, { text: 'AI words' }); } });
  x.open({ templateId: 'generic.who-should-attend', format: 'ig_square', params: {} });
  x.sb.owRenderCaption();
  x.$('owCapText').type_('Typed first');
  x.$('owCapAi').click();
  await settle();
  check('G.3 the request carried the typed caption as current', x.writes()[0].body.current === 'Typed first');
  x.$('owCapUndo').click();
  check('G.4 Undo brings back the typed caption', x.$('owCapText').value === 'Typed first' && x.cap.state().text === 'Typed first' && shown(x.$('owCapReset')));
  x.$('owCapAi').click();
  await settle();
  x.$('owCapText').type_('AI words, edited');
  check('G.4 the next edit takes Undo away', !shown(x.$('owCapUndo')) && x.cap.state().text === 'AI words, edited');
  x.$('owCapAi').click();
  await settle();
  x.$('owCapReset').click();
  check('G.4 Back to the facts takes Undo away too', !shown(x.$('owCapUndo')) && x.cap.state().text === null);
  /* an answer for an earlier load is dropped */
  d = deferred();
  x = load({ write: function () { return d.p; } });
  x.open({ templateId: 'generic.who-should-attend', format: 'ig_square', params: {} });
  x.sb.owRenderCaption();
  x.$('owCapAi').click();
  x.open({ templateId: 'speaker.combined', format: 'ig_square', params: {} });
  x.sb.owRenderCaption();
  d.go(res(200, { text: 'For the old template', warning: 'w' }));
  await settle(); await settle();
  check('an AI answer for a layout no longer open is dropped, silently', x.cap.state().text === null && x.$('owCapText').value.indexOf('For the old') === -1 &&
    !x.calls.toast.some(function (q) { return q[0] === 'Caption written.' || q[0] === 'w'; }) && !x.$('owCapAi').disabled);

  /* ================= G.5 Suggest headlines ================= */
  IDS.forEach(function (tid) {
    var z = load({ tid: tid });
    z.open({ templateId: tid, format: 'ig_square', params: {} });
    drawOptions(z, tid);
    z.cap.decorateOptions();
    var btns = z.dom.sideBody.querySelectorAll('.ow-sugg');
    if (HEAD[tid]) {
      var f = field(z, HEAD[tid]);
      check('G.5 ' + tid + ': one Suggest headlines under ' + HEAD[tid], btns.length === 1 && f.nextSibling === btns[0] && btns[0].textContent === 'Suggest headlines' &&
        btns[0].type === 'button' && btns[0].className === 'btn ghost sm ow-sugg', btns.length);
      check('G.5 ' + tid + ': then the list, then the line (hidden until there are suggestions)', btns[0].nextSibling && btns[0].nextSibling.classList.contains('ow-sugg-list') &&
        btns[0].nextSibling.nextSibling.textContent === 'Apply & re-render to use it; layout edits are reset.' && !shown(btns[0].nextSibling.nextSibling));
      z.cap.decorateOptions();
      check('G.5 ' + tid + ': asked twice, still one button', z.dom.sideBody.querySelectorAll('.ow-sugg').length === 1);
    } else {
      check('G.5 ' + tid + ': no Suggest headlines', btns.length === 0);
    }
  });
  check('G.5 the 5 templates with a heading are the ones decorated', Object.keys(HEAD).length === 5 && Object.keys(HEAD).every(function (id) {
    return tpl(id).params.some(function (p) { return p.key === HEAD[id] && p.type === 'text'; });
  }));
  y = load({ tid: 'speaker.combined' });
  y.cap.decorateOptions();
  check('G.5 with no Options form drawn, nothing happens', y.dom.created.length === 2 + 2);
  d = deferred();
  x = load({ tid: 'partner.tier-ladder', write: function () { return d.p; } });
  x.open({ templateId: 'partner.tier-ladder', format: 'ig_square', params: { theme: 'dark', maxTiers: '3' } });
  drawOptions(x, 'partner.tier-ladder', { title: 'Partners of the summit' });
  x.cap.decorateOptions();
  var sb = x.dom.sideBody.querySelector('.ow-sugg');
  sb.click();
  check('G.5 asking: the button is disabled and reads Writing…', sb.disabled === true && sb.textContent === 'Writing…');
  sb.disabled = false; sb.click();
  check('G.5 a second press asks nothing more', x.writes().length === 1);
  w = x.writes()[0];
  check('G.5 the request: task headline, the field\'s value as current, the post', w.body.task === 'headline' && w.body.current === 'Partners of the summit' &&
    w.body.post.type === 'partners' && w.body.post.title === 'Our Partners' && !('network' in w.body) && !('heading' in w.body.post), w.body);
  d.go(res(200, { options: ['Our partners, our summit', 'Built with our partners', 'The partners behind 2027', 'Partners who make it happen', 'A fifth one', 'A sixth one'] }));
  await settle();
  var list = x.dom.sideBody.querySelector('.ow-sugg-list'), opts = list.querySelectorAll('button');
  check('G.5 at most 4 suggestions, as buttons', opts.length === 4 && opts.every(function (b) { return b.type === 'button'; }) && opts[3].textContent === 'Partners who make it happen', opts.length);
  check('G.5 the line shows with them', shown(x.dom.sideBody.querySelector('.ow-sugg-note')));
  check('G.5 the button is usable again', !sb.disabled && sb.textContent === 'Suggest headlines');
  check('G.5 the first suggestion has the focus', x.dom.document.activeElement === opts[0]);
  opts[1].click();
  check('G.5 a click fills the field', field(x, 'title').value === 'Built with our partners' && x.dom.document.activeElement === field(x, 'title'));
  drawOptions(x, 'partner.tier-ladder');
  x.cap.decorateOptions();
  check('G.5 the Options tab drawn again keeps the suggestions', x.dom.sideBody.querySelectorAll('.ow-sugg-list button').length === 4 && shown(x.dom.sideBody.querySelector('.ow-sugg-note')));
  x = load({ tid: 'speaker.combined', write: function () { return res(200, { options: [] }); } });
  x.open({ templateId: 'speaker.combined', format: 'ig_square', params: {} });
  drawOptions(x, 'speaker.combined');
  x.cap.decorateOptions();
  x.dom.sideBody.querySelector('.ow-sugg').click();
  await settle();
  check('G.5 none came back: said in the list, no line', x.dom.sideBody.querySelector('.ow-sugg-list').textContent === 'No suggestions came back. Try again.' &&
    !shown(x.dom.sideBody.querySelector('.ow-sugg-note')));
  x = load({ tid: 'generic.prediction-outcome', write: function () { return res(429, { error: 'The AI has been used a lot in the last few minutes. Try again in a little while.' }); } });
  x.open({ templateId: 'generic.prediction-outcome', format: 'ig_square', params: {} });
  drawOptions(x, 'generic.prediction-outcome');
  x.cap.decorateOptions();
  x.dom.sideBody.querySelector('.ow-sugg').click();
  await settle();
  check('G.5 an error is a toast with the server\'s words, and the button is usable again', JSON.stringify(x.lastToast()) ===
    JSON.stringify(['The AI has been used a lot in the last few minutes. Try again in a little while.', 6000]) && !x.dom.sideBody.querySelector('.ow-sugg').disabled &&
    x.writes()[0].body.current === tpl('generic.prediction-outcome').params[0].default);
  x = load({ tid: 'generic.summit-highlights', write: function () { return res(404); } });
  x.open({ templateId: 'generic.summit-highlights', format: 'ig_square', params: {} });
  drawOptions(x, 'generic.summit-highlights');
  x.cap.decorateOptions();
  x.dom.sideBody.querySelector('.ow-sugg').click();
  await settle();
  check('G.5 404: "Writing with AI is not available yet."', JSON.stringify(x.lastToast()) === JSON.stringify(['Writing with AI is not available yet.', 6000]));

  /* ================= G.6 what the AI says is shown as text ================= */
  var XSS = '<img src=x onerror=alert(1)';
  x = load({ tid: 'speaker.combined', write: function (b) { return b.task === 'caption' ? res(200, { text: XSS }) : res(200, { options: [XSS, XSS + ' two'] }); },
    html: function () { return res(200, { items: [{ caption: XSS + ' facts ' + TAG }] }); }, els: [{ type: 'text', text: XSS }] });
  x.open({ templateId: 'speaker.combined', format: 'ig_square', params: { title: XSS } });
  x.sb.owRenderCaption();
  await settle();
  check('G.6 facts with markup are shown as text', x.$('owCapText').value.indexOf(XSS + ' facts') === 0);
  x.$('owCapAi').click();
  await settle();
  check('G.6 the AI\'s caption is the textarea\'s value, as text', x.$('owCapText').value === XSS);
  drawOptions(x, 'speaker.combined');
  x.cap.decorateOptions();
  x.dom.sideBody.querySelector('.ow-sugg').click();
  await settle();
  var sButtons = x.dom.sideBody.querySelectorAll('.ow-sugg-list button');
  check('G.6 a suggestion with markup is a button\'s text', sButtons.length === 2 && sButtons[0].textContent === XSS && sButtons[0].children.length === 0);
  check('G.6 no picture element was ever made', !x.dom.created.some(function (n) { return n.tagName === 'IMG'; }));
  check('G.6 nothing was ever written as HTML', x.dom.htmlWrites.length === 0, x.dom.htmlWrites);

  /* ================= G.7 ES5, and the file's exports ================= */
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/.*$/gm, '$1');
  check('G.7 ES5: no let, const, arrow, async or template string', !/\blet\b|\bconst\b|=>|\basync\b|`/.test(code), (code.match(/\blet\b|\bconst\b|=>|\basync\b|`/) || [])[0]);
  check('G.7 the file parses', (function () { try { new vm.Script(src, { filename: FILE }); return true; } catch (er) { return false; } })());
  check('G.7 no innerHTML, insertAdjacentHTML or outerHTML in the file', !/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(code));
  x = load();
  check('C6: OWSCap has the contract\'s six functions', ['onLoad', 'state', 'dirty', 'markSaved', 'textFor', 'decorateOptions'].every(function (f) { return typeof x.sb.OWSCap[f] === 'function'; }));
  check('C6: owRenderCaption is global', typeof x.sb.owRenderCaption === 'function');
  check('the file adds only its three names to the page', ['OWSCap', 'owRenderCaption', 'owCapShape'].every(function (n) { return n in x.sb; }) &&
    !('NETWORKS' in x.sb) && !('KIND' in x.sb) && !('send' in x.sb) && !('CS' in x.sb));
  /* the page loads it last, after the adapter (Unit E writes the page) */
  try {
    var page = fs.readFileSync(path.join(ROOT, 'promo-social-studio.html'), 'utf8');
    var at = page.indexOf('src="' + FILE + '"');
    check('the page loads it once, after oneworld-social.js, as the last script', at !== -1 && page.indexOf('src="' + FILE + '"', at + 1) === -1 &&
      page.indexOf('src="promo-studio/oneworld-social.js"') !== -1 && page.indexOf('src="promo-studio/oneworld-social.js"') < at && page.indexOf('<script', at + 1) === -1);
  } catch (er) { console.log('note: promo-social-studio.html is not there yet; its script order is checked by promo-social-studio.test.js'); }

  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { console.error('FAIL the test itself threw — ' + (err && err.stack || err)); process.exit(1); });
