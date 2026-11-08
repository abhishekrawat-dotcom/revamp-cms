// node functions/lib/promo-social-art.test.js — Promotions → Social posts, the "Background & logo" uploads in the browser
// (promo-studio/oneworld-social-art.js, window.OWSArt): the PSD read in the tab and sent as two pictures and a summary,
// the 120 MB and 40 MB caps, pictures brought within what the server keeps (3840 px, 8 MiB) before they are sent, the
// pills that follow what is stored, Remove, the layout editor's "Upload a picture" (owner O2 = c), and that the file
// is ES5. Since UX-128, UX-129 and UX-131 the strip itself is this file's (owStripHtml, patch S37): plain words, pills
// that are buttons, the logo line ("Using your site's logo · Replace"), "Every post starts on" (Use for all posts), a
// design file that asks before its logo replaces the one the posts use, and statuses that end on what happened.
// No network: the file runs in a vm over a small stand-in page, stand-ins of RevampAuth (a fake server holding the
// event's art), OWSocial.psdUnits, createImageBitmap and the canvas.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }
var passed = 0, failed = 0, notes = [];
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 30); i++) p = p.then(function () { return new Promise(function (ok) { setImmediate(ok); }); }); return p; }

var SRC = read('promo-studio/oneworld-social-art.js');
var MiB = 1024 * 1024;
var EV = 'qa-art';
var TOO_LARGE = 'That upload is too large.';
var PSD_TOO_LARGE = 'This PSD is too large to read in the browser. Save a flattened copy of at most 64 megapixels and 16,384 px a side (8,000 × 8,000 px fits), or upload the background and logo as pictures.';
var PSD_UNREADABLE = 'This PSD could not be read. Save it again from Photoshop with Maximize Compatibility on, or upload the background and logo as pictures.';
var NOT_A_PICTURE = 'That file is not a picture EventSphere can read. Upload a PNG, JPG, WebP, GIF, AVIF, TIFF or SVG.';

/* ---------- a small page: elements, text, the few calls the uploads make ---------- */
function decodeEntities(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&'); }
function makeDocument(log) {
  var doc = {};
  function siblingsOf(n) { return n.parentNode ? n.parentNode.childNodes : null; }
  function nextSibling() { var s = siblingsOf(this); return s ? (s[s.indexOf(this) + 1] || null) : null; }
  function Text(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
  Object.defineProperty(Text.prototype, 'nextSibling', { get: nextSibling });
  Object.defineProperty(Text.prototype, 'textContent', { get: function () { return this.data; } });
  function El(tag) {
    var self = this;
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attrs = {}; this.childNodes = []; this.parentNode = null;
    this.className = ''; this.id = ''; this.onclick = null; this.disabled = false; this.value = '';
    function names() { return self.className.split(/\s+/).filter(Boolean); }
    this.classList = {
      contains: function (c) { return names().indexOf(c) !== -1; },
      add: function (c) { if (names().indexOf(c) === -1) self.className = names().concat(c).join(' '); },
      remove: function (c) { self.className = names().filter(function (x) { return x !== c; }).join(' '); },
      toggle: function (c, on) { if (on === undefined) on = names().indexOf(c) === -1; if (on) this.add(c); else this.remove(c); return !!on; }
    };
  }
  Object.defineProperty(El.prototype, 'nextSibling', { get: nextSibling });
  El.prototype.getAttribute = function (n) {
    if (n === 'class') return this.className || null;
    if (n === 'id') return this.id || null;
    return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null;
  };
  El.prototype.setAttribute = function (n, v) { v = String(v); if (n === 'class') this.className = v; else if (n === 'id') this.id = v; else this.attrs[n] = v; };
  El.prototype.insertBefore = function (c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    var i = ref ? this.childNodes.indexOf(ref) : -1;
    if (ref && i === -1) throw new Error('NotFoundError: the reference is not a child');
    if (i === -1) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    log.inserted.push(c);
    return c;
  };
  El.prototype.appendChild = function (c) { return this.insertBefore(c, null); };
  El.prototype.removeChild = function (c) {
    var i = this.childNodes.indexOf(c);
    if (i === -1) throw new Error('NotFoundError: not a child');
    this.childNodes.splice(i, 1); c.parentNode = null;
    return c;
  };
  El.prototype.walk = function (f) { this.childNodes.forEach(function (c) { f(c); if (c.nodeType === 1) c.walk(f); }); };
  El.prototype.getElementsByTagName = function (t) { var out = []; t = t.toUpperCase(); this.walk(function (c) { if (c.nodeType === 1 && c.tagName === t) out.push(c); }); return out; };
  El.prototype.querySelectorAll = function (sel) {
    var cls = /^\.([\w-]+)$/.exec(sel); if (!cls) throw new Error('this stand-in page knows only .class selectors: ' + sel);
    var out = []; this.walk(function (c) { if (c.nodeType === 1 && c.classList.contains(cls[1])) out.push(c); }); return out;
  };
  El.prototype.closest = function (sel) {
    var cls = /^\.([\w-]+)$/.exec(sel); if (!cls) throw new Error('this stand-in page knows only .class selectors: ' + sel);
    for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (n.classList.contains(cls[1])) return n;
    return null;
  };
  El.prototype.click = function () { if (typeof this.onclick === 'function') return this.onclick({ target: this, preventDefault: function () {} }); };
  Object.defineProperty(El.prototype, 'textContent', {
    get: function () { var s = ''; this.walk(function (c) { if (c.nodeType === 3) s += c.data; }); return s; },
    set: function (v) { this.childNodes.slice().forEach(function (c) { c.parentNode = null; }); this.childNodes = []; this.appendChild(new Text(String(v))); }
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    get: function () { throw new Error('this stand-in page does not serialise markup'); },
    set: function (h) { this.childNodes.slice().forEach(function (c) { c.parentNode = null; }); this.childNodes = []; parseInto(this, String(h)); }
  });
  /* markup → elements: enough for the platform's upload strip and its status lines */
  function parseInto(parent, html) {
    var re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>\/]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g, m, stack = [parent];
    while ((m = re.exec(html))) {
      var top = stack[stack.length - 1];
      if (m[4] !== undefined) { top.appendChild(new Text(decodeEntities(m[4]))); continue; }
      if (m[1]) {
        for (var i = stack.length - 1; i > 0; i--) if (stack[i].tagName === m[2].toUpperCase()) { stack.length = i; break; }
        continue;
      }
      var el = new El(m[2]);
      (m[3].match(/[^\s=]+(?:="[^"]*")?/g) || []).forEach(function (a) {
        var k = a.indexOf('=');
        if (k === -1) el.setAttribute(a, ''); else el.setAttribute(a.slice(0, k), decodeEntities(a.slice(k + 2, -1)));
      });
      top.appendChild(el);
      if (!/^(input|img|br|meta|link)$/i.test(m[2])) stack.push(el);
    }
  }
  doc.body = new El('body');
  doc.getElementById = function (id) { var hit = null; doc.body.walk(function (c) { if (!hit && c.nodeType === 1 && c.id === id) hit = c; }); return hit; };
  doc.getElementsByTagName = function (t) { return doc.body.getElementsByTagName(t); };
  doc.createElement = function (t) {
    if (String(t).toLowerCase() === 'canvas') return log.canvas();
    return new El(t);
  };
  doc.createTextNode = function (s) { return new Text(s); };
  return doc;
}

/* ---------- the strip: Oneworld's own since patch S37 ---------- */
var STUDIO = exists('promo-studio/social-studio.js') ? read('promo-studio/social-studio.js') : null;
if (STUDIO) {
  check('the generated studio draws Oneworld\'s strip (patch S37), not the platform\'s labels', STUDIO.indexOf('${owStripHtml(assets)}') !== -1 &&
    STUDIO.indexOf('>BG 1</label>') === -1 && STUDIO.indexOf('event details always come from the API') === -1);
} else {
  notes.push('promo-studio/social-studio.js is not there yet: the strip patch was not checked');
}

/* ---------- pictures, the canvas and the PSD reader ---------- */
function blob(size, type, w, h, opts) {
  opts = opts || {};
  return { size: size, type: type, _w: w, _h: h, _decodes: opts.decodes !== false, name: opts.name || 'picture',
    arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(16)); } };
}

/* ---------- a server that keeps the event's art (lib/promo-social.js's answers) ---------- */
function json(status, body) { return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: status }); }
function makeServer(o, log) {
  var art = JSON.parse(JSON.stringify(o.art || {}));   // each page gets its own copy: a test's removals stay in that test
  var SLOT_LIST = ['background', 'logoUnit', 'bg1', 'bg2', 'bg3'];
  function artAnswer() {
    var out = { units: {}, psd: null };
    SLOT_LIST.forEach(function (s) { out[s] = !!art[s]; if (art[s]) out.units[s] = { url: 'https://storage.googleapis.com/b/events/' + EV + '/promo-art/' + s + '.png', width: art[s].width, height: art[s].height, from: art[s].from, at: 1 }; });
    out.useBg = art.useBg || '';
    return out;
  }
  return function (url, opts) {
    opts = opts || {};
    var method = opts.method || 'GET';
    var u = new URL(url, 'https://oneworld.example'), q = u.searchParams, p = u.pathname;
    var headers = opts.headers || {};
    log.req.push({ method: method, url: url, path: p, slot: q.get('slot'), from: q.get('from'), eventId: q.get('eventId'), body: opts.body,
      type: headers['Content-Type'] || headers['content-type'] });
    var key = method + ' ' + p + (q.get('slot') ? ' ' + q.get('slot') : '');
    if (o.fail && o.fail[key]) {
      var f = o.fail[key];
      if (f === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(json(f.status, f.body));
    }
    if (method === 'GET' && p === '/api/promo/social/art') return Promise.resolve(json(200, artAnswer()));
    if (method === 'POST' && p === '/api/promo/social/art') {
      var slot = q.get('slot'), from = q.get('from'), bl = opts.body;
      /* the server trims a logo; a background keeps its size */
      var w = slot === 'logoUnit' ? bl._w - 8 : bl._w, h = slot === 'logoUnit' ? bl._h - 8 : bl._h;
      art[slot] = { from: from, width: w, height: h };
      var size = { width: w, height: h, bytes: bl.size };
      return Promise.resolve(json(200, /^bg/.test(slot) ? Object.assign({ ok: true, slot: slot.slice(2) }, size) : Object.assign({ ok: true }, size)));
    }
    if (method === 'POST' && p === '/api/promo/social/art/psd') {
      var body = JSON.parse(opts.body);
      log.meta.push(body);
      ['background', 'logoUnit'].forEach(function (s) { if (!body.found[s] && art[s] && art[s].from === 'psd') art[s] = null; });
      var sizeOf = function (s) { return body.found[s] && art[s] && art[s].from === 'psd' ? { width: art[s].width, height: art[s].height } : null; };
      return Promise.resolve(json(200, { ok: true, background: sizeOf('background'), logoUnit: sizeOf('logoUnit') }));
    }
    if (method === 'POST' && p === '/api/promo/social/art/default') {
      var want = JSON.parse(opts.body).bg;
      art.useBg = want || null;
      return Promise.resolve(json(200, Object.assign({ ok: true }, artAnswer())));
    }
    if (method === 'DELETE' && p === '/api/promo/social/art') {
      var had = !!art[q.get('slot')]; art[q.get('slot')] = null;
      return Promise.resolve(json(200, { ok: true, removed: had }));
    }
    if (method === 'POST' && p === '/api/promo/social/picture') {
      return Promise.resolve(json(200, { ok: true, url: 'https://storage.googleapis.com/b/events/' + EV + '/promo-art/picture-k3-0123456789abcdef.png',
        width: opts.body._w, height: opts.body._h, bytes: opts.body.size }));
    }
    return Promise.resolve(json(404, { error: 'not found' }));
  };
}

/* the page around oneworld-social-art.js. o: art (what the server holds), fail { 'METHOD /path slot': {status, body} |
   'network' }, encode(type, q, w, h) → size, psdUnits(buf, opts), confirm (the dialog's answer), noReader, noEventId */
function load(o) {
  o = o || {};
  var log = { req: [], meta: [], decode: [], closed: 0, draw: [], encode: [], confirm: [], refresh: 0, psd: [], inserted: [], canvases: [] };
  log.canvas = function () {
    var c = { nodeType: 1, tagName: 'CANVAS', width: 300, height: 150 };
    c.getContext = function () {
      return { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage: function (bmp, x, y, w, h) { log.draw.push({ w: w, h: h, quality: this.imageSmoothingQuality }); } };
    };
    c.toBlob = function (cb, type, q) {
      var t = type || 'image/png', w = c.width, h = c.height;
      var size = (o.encode || function (t2, q2, w2, h2) { return t2 === 'image/png' ? w2 * h2 : Math.round(w2 * h2 * q2 * 0.5); })(t, q, w, h);
      log.encode.push({ type: t, q: q, w: w, h: h, size: size });
      setImmediate(function () { cb(size == null ? null : blob(size, t, w, h)); });
    };
    log.canvases.push(c);
    return c;
  };
  var document = makeDocument(log);
  var server = makeServer(o, log);
  var ctx = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Response: Response, URLSearchParams: URLSearchParams,
    location: { search: '?event=' + EV, origin: 'https://oneworld.example' },
    document: document,
    OWS: { art: null },
    RevampAuth: { authedFetch: function (url, opts) { return server(url, opts); } },
    createImageBitmap: function (b) {
      log.decode.push(b);
      if (!b || b._decodes === false) return Promise.reject(new Error('The source image could not be decoded.'));
      return Promise.resolve({ width: b._w, height: b._h, close: function () { log.closed++; } });
    },
    uiConfirm: function (title, message, opts) { log.confirm.push({ title: title, message: message, opts: opts }); return Promise.resolve(o.confirm === undefined ? true : o.confirm); },
    refreshThumbs: function () { log.refresh++; }
  };
  if (!o.noEventId) ctx.EVENT_ID = EV;
  if (!o.noReader) {
    ctx.OWSocial = { psdUnits: function (buf, opts) { log.psd.push({ buf: buf, opts: opts }); return o.psdUnits ? o.psdUnits(buf, opts) : Promise.resolve(null); } };
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'oneworld-social-art.js' });
  if (o.siteLogo) ctx.CAT = { event: { siteLogo: o.siteLogo } };
  /* the event page's strip for what the server holds now, as renderEventDetail draws it and then decorates it */
  var initial = { units: {} }; ['background', 'logoUnit', 'bg1', 'bg2', 'bg3'].forEach(function (s) {
    initial[s] = !!(o.art && o.art[s]);
    if (initial[s]) initial.units[s] = { from: o.art[s].from };
  });
  var content = document.createElement('div'); content.id = 'content';
  document.body.appendChild(content);
  content.innerHTML = ctx.owStripHtml(initial);
  ctx.OWS.art = o.art ? initial : null;                         // what the page read, as oneworld-social.js keeps it
  ctx.OWSArt.decorate(initial);
  log.inserted.length = 0;
  return { A: ctx.OWSArt, ctx: ctx, doc: document, log: log };
}
var INPUTS = { psd: 'owInPsd', 1: 'owInBg1', 2: 'owInBg2', 3: 'owInBg3', logo: 'owInLogo' };
function inputOf(x, slot) { return x.doc.getElementById(INPUTS[slot]); }
function psdLabel(x) { return x.doc.getElementById('slot-psd'); }
/* the logo line offers to remove a logo only when one was uploaded or came from a design file */
function logoLine(x) { return x.doc.getElementById('owLogoLine'); }
function logoRemove(x) { var b = logoLine(x) ? logoLine(x).getElementsByTagName('button') : []; return b.length > 1 ? b[1] : null; }
function pills(x) {
  return { background: psdLabel(x).classList.contains('on'), bg1: x.doc.getElementById('slot-bg1').classList.contains('on'),
    bg2: x.doc.getElementById('slot-bg2').classList.contains('on'), bg3: x.doc.getElementById('slot-bg3').classList.contains('on'),
    logoUnit: !!logoRemove(x) };
}
function pick(x, slot, file) { var inp = inputOf(x, slot); inp.files = [file]; inp.value = 'C:\\fakepath\\' + (file.name || 'f'); return inp; }
function crosses(x) { return x.doc.body.querySelectorAll('.ow-slot-x'); }
function status(x) { return x.doc.getElementById('psdStatus').textContent; }
function readAnswer(r) { return r.text().then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = undefined; } return { status: r.status, text: t, json: j }; }); }
function uploads(x) { return x.log.req.filter(function (r) { return r.method === 'POST' && r.path === '/api/promo/social/art'; }); }

(async function () {
  /* ================= I.5 and the shape of the file ================= */
  var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/.*$/gm, '$1');
  check('I.5 ES5: no let', !/\blet\s/.test(code));
  check('I.5 ES5: no const', !/\bconst\s/.test(code));
  check('I.5 ES5: no arrow functions', code.indexOf('=>') === -1);
  check('I.5 ES5: no async or await', !/\basync\b|\bawait\b/.test(code));
  check('I.5 ES5: no class, template literal, spread or for…of', !/\bclass\s/.test(code) && code.indexOf('`') === -1 && code.indexOf('...') === -1 && !/\bfor\s*\([^)]*\bof\b/.test(code));
  check('server text is never written as markup (no innerHTML in the file)', code.indexOf('innerHTML') === -1 && code.indexOf('insertAdjacentHTML') === -1);
  check('it never calls fetch itself: every request goes through RevampAuth.authedFetch', !/[^.\w]fetch\(/.test(code) && code.indexOf('RevampAuth.authedFetch') !== -1);
  var bare = { window: null }; bare.window = bare; vm.createContext(bare);
  vm.runInContext(SRC, bare);
  check('loaded on a bare page it gives the page OWSArt and the strip the copied code draws (owStripHtml), nothing else',
    JSON.stringify(Object.keys(bare).sort()) === JSON.stringify(['OWSArt', 'owStripHtml', 'window']), Object.keys(bare));
  check('C5 + §13 + UX-129: OWSArt is the uploads, decorate, picture, the strip and its words', JSON.stringify(Object.keys(bare.OWSArt).sort()) === JSON.stringify(['background',
    'bgChoices', 'bgLabel', 'bgPhrase', 'bgValue', 'decorate', 'logo', 'logoWords', 'picture', 'psd', 'setUseBg', 'siteHasLogo', 'stripHtml', 'summary', 'uploadBg', 'uploadLogo', 'uploadPsd']), Object.keys(bare.OWSArt).sort());

  /* ================= I.1: the PSD's caps and the reader's two sentences ================= */
  /* the studio answers with its own copy of the reader's sentences (it keys on the error's name), so the two copies
     must not drift: the owner would be told one limit by the reader and another by the upload line */
  var psdTs = read('promo-engine/src/psd/extract.ts');
  var readerLarge = (psdTs.match(/const TOO_LARGE = "([^"]*)";/) || [])[1], readerUnreadable = (psdTs.match(/const UNREADABLE = "([^"]*)";/) || [])[1];
  check('I.1 the "too large" sentence is the PSD reader\'s own, word for word', readerLarge === PSD_TOO_LARGE && SRC.indexOf("var PSD_TOO_LARGE = '" + PSD_TOO_LARGE + "';") !== -1, readerLarge);
  check('I.1 … and it names the 64 megapixel and 16,384 px limits, with 8,000 × 8,000 px as a size that fits', /at most 64 megapixels and 16,384 px a side \(8,000 × 8,000 px fits\)/.test(PSD_TOO_LARGE));
  check('I.1 the "could not be read" sentence is the reader\'s own too', readerUnreadable === PSD_UNREADABLE && SRC.indexOf("var PSD_UNREADABLE = '" + PSD_UNREADABLE + "';") !== -1, readerUnreadable);
  var x = load(), r, got;
  r = await x.A.psd({ method: 'POST', body: blob(120 * MiB + 1, '', 0, 0, { decodes: false, name: 'huge.psd' }) });
  got = await readAnswer(r);
  check('I.1 a PSD over 120 MB → 413', got.status === 413, got.status);
  check('I.1 … whose body is not JSON (the platform\'s line then says to flatten it)', got.json === undefined, got.text);
  check('I.1 … refused before it is read or sent', x.log.psd.length === 0 && x.log.req.length === 0);
  r = await x.A.psd({ body: blob(120 * MiB, '', 0, 0, { decodes: false }) });
  check('I.1 exactly 120 MB is read', x.log.psd.length === 1);
  check('I.1 the reader gets the file\'s bytes and the 3840 px edge', Object.prototype.toString.call(x.log.psd[0].buf) === '[object ArrayBuffer]',
    Object.prototype.toString.call(x.log.psd[0].buf));
  check('I.1 … { maxEdge: 3840 }', x.log.psd[0].opts && x.log.psd[0].opts.maxEdge === 3840, x.log.psd[0].opts);

  function throwing(name, message) { return function () { var e = new Error(message || 'stub'); if (name) e.name = name; return Promise.reject(e); }; }
  x = load({ psdUnits: throwing('PsdTooLarge', 'canvas 20000×20000') });
  got = await readAnswer(await x.A.psd({ body: blob(50 * MiB, '', 0, 0, { name: 'big.psd' }) }));
  check('I.1 PsdTooLarge → 400 with the "too large" sentence', got.status === 400 && got.json && got.json.error === PSD_TOO_LARGE, got);
  check('I.1 … and nothing is sent', x.log.req.length === 0);
  x = load({ psdUnits: throwing('PsdUnreadable', PSD_UNREADABLE) });
  got = await readAnswer(await x.A.psd({ body: blob(5, '', 0, 0) }));
  check('I.1 PsdUnreadable → the "could not be read" sentence', got.json && got.json.error === PSD_UNREADABLE, got);
  x = load({ psdUnits: throwing('', 'Offset is outside the bounds of the DataView') });
  got = await readAnswer(await x.A.psd({ body: blob(5, '', 0, 0) }));
  check('I.1 any other throw → the "could not be read" sentence, never the library\'s own words', got.status === 400 && got.json && got.json.error === PSD_UNREADABLE, got);
  x = load({ psdUnits: function () { throw new RangeError('Invalid typed array length'); } });
  got = await readAnswer(await x.A.psd({ body: blob(5, '', 0, 0) }));
  check('I.1 a reader that throws at once → the same sentence', got.json && got.json.error === PSD_UNREADABLE, got);
  x = load({ noReader: true });
  got = await readAnswer(await x.A.psd({ body: blob(5, '', 0, 0) }));
  check('a page whose PSD reader did not load says so, and sends nothing', got.status === 400 && /did not load/.test(got.json.error) && x.log.req.length === 0, got);
  got = await readAnswer(await load().A.psd({ body: blob(0, '', 0, 0) }));
  check('an empty PSD → the platform\'s "empty upload"', got.status === 400 && got.json.error === 'empty upload', got);

  x = load({ psdUnits: throwing('PsdTooLarge') });
  var inp = pick(x, 'psd', blob(60 * MiB, '', 0, 0));
  await x.A.uploadPsd(inp);
  check('I.1 the strip\'s line for a design file too large to read: the reader\'s own sentence', status(x) === 'Upload failed: ' + PSD_TOO_LARGE, status(x));

  /* ================= I.2: pictures within what the server keeps ================= */
  x = load();
  got = await readAnswer(await x.A.background('1', { method: 'POST', body: blob(40 * MiB + 1, 'image/jpeg', 3000, 2000) }));
  check('I.2 a background over 40 MB → 413 "That upload is too large."', got.status === 413 && got.json && got.json.error === TOO_LARGE, got);
  check('I.2 … with no request and nothing decoded', x.log.req.length === 0 && x.log.decode.length === 0);
  got = await readAnswer(await x.A.logo({ body: blob(41 * MiB, 'image/png', 900, 300) }));
  check('I.2 a logo over 40 MB → the same 413', got.status === 413 && got.json.error === TOO_LARGE && x.log.req.length === 0, got);

  /* a 35 MB picture under 3840 px: PNG still 9 MB, WebP 0.92 still 7.6 MiB, WebP 0.85 fits */
  var steps = function (t, q, w, h) { return t === 'image/png' ? 9 * MiB : q === 0.92 ? Math.round(7.6 * MiB) : q === 0.85 ? 6 * MiB : 4 * MiB; };
  x = load({ encode: steps });
  var big = blob(35 * MiB, 'image/png', 3000, 3000, { name: 'big.png' });
  got = await readAnswer(await x.A.background('2', { body: big }));
  var sent = uploads(x);
  check('I.2 a 35 MB picture that opens and is under 3840 px is sent', got.status === 200 && got.json.ok === true && sent.length === 1, got);
  check('I.2 … re-encoded: what is sent is under 8 MiB, never the 35 MB original', sent.length === 1 && sent[0].body !== big && sent[0].body.size <= 8 * MiB, sent[0] && sent[0].body.size);
  check('I.2 … PNG first, then WebP 0.92, 0.85 — the first under 7.5 MiB', JSON.stringify(x.log.encode.map(function (e) { return e.type + (e.q ? '@' + e.q : ''); })) ===
    JSON.stringify(['image/png', 'image/webp@0.92', 'image/webp@0.85']) && sent[0].body.type === 'image/webp', x.log.encode);
  check('I.2 … at its own size (no scaling under 3840 px), drawn smoothly', x.log.encode[0].w === 3000 && x.log.encode[0].h === 3000 && x.log.draw[0].quality === 'high', x.log.encode[0]);
  check('I.2 … to slot bg2, from=upload, as raw bytes', sent[0].slot === 'bg2' && sent[0].from === 'upload' && sent[0].type === 'application/octet-stream' && sent[0].eventId === EV, sent[0]);
  check('I.2 … the decoded picture and the canvas are let go', x.log.closed === 1 && x.log.canvases.every(function (c) { return c.width === 0 && c.height === 0; }));
  check('I.2 the platform\'s answer for a numbered background', JSON.stringify(got.json) === JSON.stringify({ ok: true, slot: '2', width: 3000, height: 3000, bytes: 6 * MiB }), got.json);
  check('I.2 after the upload the art is read again: OWS.art holds it, its pill is on with its ✕', x.ctx.OWS.art && x.ctx.OWS.art.bg2 === true && pills(x).bg2 && crosses(x).length === 1 &&
    x.log.req.map(function (q) { return q.method; }).join() === 'POST,GET', x.ctx.OWS.art);

  x = load({ encode: function (t) { return t === 'image/png' ? 5 * MiB : 1; } });
  got = await readAnswer(await x.A.background('3', { body: blob(6 * MiB, 'image/jpeg', 6000, 4000) }));
  sent = uploads(x);
  check('I.2 a picture over 3840 px is drawn at 3840 on its long edge, in proportion', x.log.encode.length === 1 && x.log.encode[0].w === 3840 && x.log.encode[0].h === 2560, x.log.encode);
  check('I.2 … and sent as that PNG when it is within 8 MiB', sent.length === 1 && sent[0].body.type === 'image/png' && sent[0].body.size === 5 * MiB && got.json.width === 3840, got.json);
  x = load({ encode: function (t) { return t === 'image/png' ? 5 * MiB : 1; } });
  await x.A.logo({ body: blob(2 * MiB, 'image/png', 2400, 9000) });
  check('I.2 a tall picture: its height is the long edge', x.log.encode[0].w === 1024 && x.log.encode[0].h === 3840, x.log.encode[0]);

  x = load();
  var small = blob(1 * MiB, 'image/jpeg', 1200, 800, { name: 'bg.jpg' });
  await x.A.background(1, { body: small });
  sent = uploads(x);
  check('I.2 a picture within 3840 px and 8 MiB goes as its own bytes, untouched', sent.length === 1 && sent[0].body === small && x.log.encode.length === 0, x.log.encode);
  check('I.2 … and the decoded copy is let go', x.log.closed === 1);
  x = load();
  var edge = blob(8 * MiB, 'image/png', 3840, 3840);
  await x.A.background('bg1', { body: edge });
  check('I.2 exactly 8 MiB and 3840 px: its own bytes ("bg1" is read as slot 1 too)', uploads(x).length === 1 && uploads(x)[0].body === edge && uploads(x)[0].slot === 'bg1');

  x = load();
  got = await readAnswer(await x.A.background('1', { body: blob(9 * MiB, 'image/tiff', 0, 0, { decodes: false }) }));
  check('I.2 a picture that does not open in the browser and is over 8 MiB → 413, with no request', got.status === 413 && got.json.error === TOO_LARGE && x.log.req.length === 0, got);
  x = load();
  var tiff = blob(5 * MiB, 'image/tiff', 0, 0, { decodes: false });
  got = await readAnswer(await x.A.logo({ body: tiff }));
  check('I.2 one that does not open but is within 8 MiB goes as its own bytes, for the server to read', uploads(x).length === 1 && uploads(x)[0].body === tiff && uploads(x)[0].slot === 'logoUnit', got);
  x = load();
  delete x.ctx.createImageBitmap;
  var svg = blob(200 * 1024, 'image/svg+xml', 0, 0);
  await x.A.logo({ body: svg });
  check('I.2 with no createImageBitmap at all, a small picture still goes as it is', uploads(x).length === 1 && uploads(x)[0].body === svg);
  x = load({ encode: function (t) { return t === 'image/png' ? 30 * MiB : 8 * MiB; } });
  got = await readAnswer(await x.A.background('2', { body: blob(30 * MiB, 'image/png', 3800, 3800) }));
  check('I.2 when even WebP 0.75 is over 7.5 MiB → 413 and nothing is sent', got.status === 413 && got.json.error === TOO_LARGE && x.log.req.length === 0 &&
    x.log.encode.length === 4, x.log.encode.length);
  x = load({ encode: function () { return null; } });
  got = await readAnswer(await x.A.background('2', { body: blob(12 * MiB, 'image/png', 3000, 3000) }));
  check('I.2 a canvas that cannot encode → 413, nothing sent', got.status === 413 && x.log.req.length === 0, got);

  x = load();
  await x.A.logo({ body: blob(1000, 'image/png', 900, 300) });
  sent = uploads(x);
  check('I.2 Logo → slot logoUnit, from=upload', sent.length === 1 && sent[0].slot === 'logoUnit' && sent[0].from === 'upload');
  got = await readAnswer(await x.A.background('4', { body: blob(1000, 'image/png', 9, 9) }));
  check('a background slot outside 1-3 is refused here', got.status === 400 && got.json.error === 'unknown slot');
  got = await readAnswer(await x.A.background('1', { body: blob(0, 'image/png', 0, 0) }));
  check('an empty picture → "empty upload"', got.status === 400 && got.json.error === 'empty upload');

  x = load({ fail: { 'POST /api/promo/social/art bg1': { status: 400, body: { error: NOT_A_PICTURE } } } });
  got = await readAnswer(await x.A.background('1', { body: blob(1000, 'text/plain', 0, 0, { decodes: false }) }));
  check('a refusal keeps the server\'s status and reason', got.status === 400 && got.json.error === NOT_A_PICTURE, got);
  check('… and the art is not read again (nothing changed)', x.log.req.filter(function (q) { return q.method === 'GET'; }).length === 0);
  x = load({ fail: { 'POST /api/promo/social/art bg1': { status: 502, body: '<html>Bad gateway</html>' } } });
  got = await readAnswer(await x.A.background('1', { body: blob(1000, 'image/png', 10, 10) }));
  check('an answer that is not JSON → the platform\'s own "upload failed"', got.status === 502 && got.json.error === 'upload failed', got);
  x = load({ fail: { 'POST /api/promo/social/art logoUnit': 'network' } });
  got = await readAnswer(await x.A.logo({ body: blob(1000, 'image/png', 10, 10) }));
  check('a request that did not go through resolves (never rejects) with a reason to show', got.status === 503 && /did not reach EventSphere/.test(got.json.error), got);
  x = load(); x.ctx.RevampAuth = undefined;
  got = await readAnswer(await x.A.logo({ body: blob(1000, 'image/png', 10, 10) }));
  check('… also with no sign-in on the page', got.status === 503 && /did not reach EventSphere/.test(got.json.error), got);
  x = load({ noEventId: true });
  await x.A.logo({ body: blob(1000, 'image/png', 10, 10) });
  check('the event comes from the page\'s ?event= when EVENT_ID is not set', uploads(x)[0].eventId === EV);

  /* I.2 the strip's own uploads (UX-129): each ends on what happened */
  x = load(); inp = pick(x, '2', blob(35 * MiB, 'image/png', 3000, 3000, { name: 'big.png' }));
  await x.A.uploadBg(inp, '2'); await tick();
  check('I.2 a background: its size, and an offer to use it for all posts', status(x) === 'Background 2 uploaded (3000×3000). Use it for all posts' &&
    x.doc.getElementById('psdStatus').getElementsByTagName('button').length === 1, status(x));
  check('I.2 … its pill on, its ✕ beside it, the cards not drawn again (they use another background), the input cleared', pills(x).bg2 && crosses(x).length === 1 && x.log.refresh === 0 && inp.value === '',
    [pills(x), x.log.refresh, inp.value]);
  x.doc.getElementById('psdStatus').getElementsByTagName('button')[0].click(); await tick();
  var dflt = x.log.req.filter(function (q) { return q.path === '/api/promo/social/art/default'; });
  check('I.2 Use it for all posts: kept for the event, the menu follows, the cards are drawn again, and the status ends on it',
    dflt.length === 1 && JSON.parse(dflt[0].body).bg === '2' && JSON.parse(dflt[0].body).eventId === EV && x.ctx.OWS.art.useBg === '2' &&
    x.doc.getElementById('owUseBgSel').value === '2' && x.log.refresh === 1 && status(x) === 'Background 2 is now on all posts.', [status(x), x.ctx.OWS.art && x.ctx.OWS.art.useBg]);
  x = load(); inp = pick(x, '1', blob(41 * MiB, 'image/jpeg', 6000, 4000));
  await x.A.uploadBg(inp, '1');
  check('I.2 a background over 40 MB', status(x) === 'Upload failed: That upload is too large.' && !pills(x).bg1 && x.log.refresh === 0, status(x));
  x = load({ fail: { 'POST /api/promo/social/art logoUnit': { status: 400, body: { error: '<img src=x onerror=alert(1)>' } } } });
  inp = pick(x, 'logo', blob(1000, 'image/png', 50, 50));
  await x.A.uploadLogo(inp);
  check('a server reason with markup shows as text', status(x) === 'Upload failed: <img src=x onerror=alert(1)>' &&
    x.doc.getElementById('psdStatus').getElementsByTagName('img').length === 0, status(x));
  x = load(); inp = pick(x, 'logo', blob(1000, 'image/png', 908, 308));
  await x.A.uploadLogo(inp); await tick();
  check('UX-129 a logo: the cards are drawn again, then "Logo updated on all posts.", never a lingering "refreshing…"', status(x) === 'Logo updated on all posts.' &&
    pills(x).logoUnit && x.log.refresh === 1 && /Using the logo you uploaded/.test(logoLine(x).textContent), [status(x), logoLine(x).textContent]);

  /* ================= I.3: a PSD with both units, then one with no logo ================= */
  var UNITS = { canvasWidth: 1350, canvasHeight: 600, roles: { background: 1, logo: 2, text: 3, ignore: 0 },
    background: { blob: blob(3 * MiB, 'image/png', 1350, 600), width: 1350, height: 600 },
    logo: { blob: blob(200 * 1024, 'image/png', 468, 230), width: 468, height: 230, box: { x: 40, y: 30, width: 468, height: 230 } } };
  x = load({ psdUnits: function () { return Promise.resolve(UNITS); } });
  var psdFile = blob(48 * MiB, 'image/vnd.adobe.photoshop', 0, 0, { name: 'Summit banner.psd', decodes: false });
  got = await readAnswer(await x.A.psd({ method: 'POST', body: psdFile }));
  var order = x.log.req.map(function (q) { return q.method + ' ' + q.path + (q.slot ? ' ' + q.slot + '/' + q.from : ''); });
  check('I.3 background, logo, summary, then the art read again — in that order', JSON.stringify(order) === JSON.stringify([
    'POST /api/promo/social/art background/psd', 'POST /api/promo/social/art logoUnit/psd', 'POST /api/promo/social/art/psd', 'GET /api/promo/social/art']), order);
  check('I.3 the PSD itself is never sent', x.log.req.every(function (q) { return q.body !== psdFile; }));
  check('I.3 each unit goes as the reader made it (within 8 MiB and 3840 px, so not opened or drawn again)',
    x.log.req[0].body === UNITS.background.blob && x.log.req[1].body === UNITS.logo.blob && x.log.encode.length === 0 && x.log.decode.length === 0);
  check('I.3 … as raw bytes', x.log.req[0].type === 'application/octet-stream' && x.log.req[1].type === 'application/octet-stream');
  var meta = x.log.meta[0];
  check('I.3 the summary: event, name, bytes, canvas size and what was found — no layer table', JSON.stringify(meta) === JSON.stringify({ eventId: EV, name: 'Summit banner.psd',
    bytes: 48 * MiB, canvasWidth: 1350, canvasHeight: 600, found: { background: true, logoUnit: true } }), meta);
  check('I.3 … sent as JSON', x.log.req[2].type === 'application/json');
  check('I.3 the platform\'s answer shape, with the sizes the server kept', got.status === 200 && JSON.stringify(got.json) === JSON.stringify({ ok: true, canvasWidth: 1350, canvasHeight: 600,
    background: { width: 1350, height: 600 }, logoUnit: { width: 460, height: 222 } }), got.json);
  check('I.3 OWS.art is what the server holds now, and the pills follow it', x.ctx.OWS.art && x.ctx.OWS.art.background === true && x.ctx.OWS.art.logoUnit === true &&
    pills(x).background && pills(x).logoUnit && !pills(x).bg1 && crosses(x).length === 1, [x.ctx.OWS.art, pills(x)]);
  check('I.3 a PSD does not draw the thumbnails itself on success (the platform\'s line does)', x.log.refresh === 0);

  /* the next PSD has no logo: the PSD-made logo is cleared, its pill turns off (fidelity 7) */
  var NOLOGO = Object.assign({}, UNITS, { logo: null });
  x = load({ art: { background: { from: 'psd', width: 1350, height: 600 }, logoUnit: { from: 'psd', width: 460, height: 222 } }, psdUnits: function () { return Promise.resolve(NOLOGO); } });
  x.A.decorate({ background: true, logoUnit: true, units: { logoUnit: { from: 'psd' } } });
  check('I.3 (before) the logo line says the design file\'s logo, with Remove; the background pill has its ✕', pills(x).logoUnit && crosses(x).length === 1 &&
    /Using the logo from your design file/.test(logoLine(x).textContent));
  got = await readAnswer(await x.A.psd({ body: blob(20 * MiB, '', 0, 0, { name: 'no-logo.psd' }) }));
  check('I.3 no logo → no logo request', uploads(x).length === 1 && uploads(x)[0].slot === 'background');
  check('I.3 … and found.logoUnit false', x.log.meta[0].found.background === true && x.log.meta[0].found.logoUnit === false, x.log.meta[0]);
  check('I.3 … the answer says no logo', got.json.ok === true && got.json.logoUnit === null && got.json.background && got.json.background.width === 1350, got.json);
  check('I.3 … the cleared PSD logo leaves the logo line with nothing to remove', !pills(x).logoUnit && pills(x).background && crosses(x).length === 1 &&
    /No logo yet/.test(logoLine(x).textContent), [pills(x), logoLine(x).textContent]);
  /* an uploaded logo is never cleared by a PSD (the server's rule), and its pill stays on */
  x = load({ art: { logoUnit: { from: 'upload', width: 300, height: 100 } }, psdUnits: function () { return Promise.resolve(NOLOGO); } });
  await x.A.psd({ body: blob(20 * MiB, '', 0, 0) });
  check('I.3 an uploaded logo stays, and so does its line', pills(x).logoUnit && pills(x).background && /Using the logo you uploaded/.test(logoLine(x).textContent), pills(x));
  /* UX-129: a design file with a logo of its own asks before that logo replaces the one the posts use */
  x = load({ art: { logoUnit: { from: 'upload', width: 300, height: 100 } }, psdUnits: function () { return Promise.resolve(UNITS); }, confirm: false });
  await x.A.psd({ body: blob(20 * MiB, '', 0, 0) });
  check('UX-129 a design file\'s logo over an uploaded one: asked first, in plain words', x.log.confirm.length === 1 && x.log.confirm[0].title === 'Replace the logo you uploaded?' &&
    x.log.confirm[0].opts.ok === 'Use the design file’s logo' && x.log.confirm[0].opts.cancel === 'Keep my logo', x.log.confirm[0]);
  check('UX-129 … No: the logo is not sent, the summary says the design file brought none, the uploaded logo stays', uploads(x).length === 1 && uploads(x)[0].slot === 'background' &&
    x.log.meta[0].found.logoUnit === false && pills(x).logoUnit && /Using the logo you uploaded/.test(logoLine(x).textContent), [uploads(x).map(function (q) { return q.slot; }), x.log.meta[0]]);
  x = load({ art: { logoUnit: { from: 'upload', width: 300, height: 100 } }, psdUnits: function () { return Promise.resolve(UNITS); }, confirm: true });
  await x.A.psd({ body: blob(20 * MiB, '', 0, 0) });
  check('UX-129 … Yes: the design file\'s logo goes up', uploads(x).map(function (q) { return q.slot + '/' + q.from; }).join() === 'background/psd,logoUnit/psd' && x.log.meta[0].found.logoUnit === true);
  x = load({ psdUnits: function () { return Promise.resolve(UNITS); }, confirm: false, siteLogo: { dark: 'https://img.etb2bimg.com/u.png', light: '' } });
  await x.A.psd({ body: blob(20 * MiB, '', 0, 0) });
  check('UX-129 over the site\'s own logo it asks too, and No keeps the site\'s', x.log.confirm.length === 1 && x.log.confirm[0].title === 'Use the design file’s logo?' &&
    x.log.confirm[0].opts.cancel === 'Keep the site’s logo' && uploads(x).length === 1 && /Using your site’s logo/.test(logoLine(x).textContent), [x.log.confirm[0], logoLine(x).textContent]);
  x = load({ art: { logoUnit: { from: 'psd', width: 300, height: 100 } }, psdUnits: function () { return Promise.resolve(UNITS); }, confirm: false });
  await x.A.psd({ body: blob(20 * MiB, '', 0, 0) });
  check('UX-129 a design file\'s logo replaces an earlier design file\'s without asking', x.log.confirm.length === 0 && uploads(x).length === 2);
  /* a PSD with neither unit still sends its summary (it clears the old PSD's units) */
  x = load({ art: { background: { from: 'psd', width: 10, height: 10 } }, psdUnits: function () { return Promise.resolve({ canvasWidth: 800, canvasHeight: 800, background: null, logo: null }); } });
  got = await readAnswer(await x.A.psd({ body: blob(1 * MiB, '', 0, 0) }));
  check('a PSD with neither unit: no picture sent, the summary says so, the old PSD background is cleared', uploads(x).length === 0 &&
    JSON.stringify(x.log.meta[0].found) === JSON.stringify({ background: false, logoUnit: false }) && got.json.background === null && !pills(x).background, [got.json, pills(x)]);

  /* a unit over 8 MiB goes as WebP, straight away (the reader's PNG is not made again) */
  x = load({ psdUnits: function () { return Promise.resolve({ canvasWidth: 3840, canvasHeight: 2160, background: { blob: blob(11 * MiB, 'image/png', 3840, 2160), width: 3840, height: 2160 }, logo: null }); },
    encode: function (t, q) { return t === 'image/png' ? 11 * MiB : 3 * MiB; } });
  got = await readAnswer(await x.A.psd({ body: blob(90 * MiB, '', 0, 0) }));
  check('a PSD background over 8 MiB is sent as WebP 0.92, with no second PNG made', got.json.ok === true && uploads(x)[0].body.type === 'image/webp' &&
    JSON.stringify(x.log.encode.map(function (e) { return e.type + '@' + e.q; })) === JSON.stringify(['image/webp@0.92']), x.log.encode);

  /* a step the server refuses ends the upload with its reason; what was kept already is shown */
  x = load({ psdUnits: function () { return Promise.resolve(UNITS); }, fail: { 'POST /api/promo/social/art logoUnit': { status: 400, body: { error: 'That picture is too large to use (more than 16 million pixels). Make it smaller and upload it again.' } } } });
  got = await readAnswer(await x.A.psd({ body: blob(20 * MiB, '', 0, 0) }));
  check('a refused logo step → { error } with the server\'s text and status', got.status === 400 && /16 million pixels/.test(got.json.error) && got.json.ok === undefined, got);
  check('… no summary is sent', x.log.meta.length === 0);
  check('… the background already kept shows: pill on, thumbnails drawn again', pills(x).background && x.log.refresh === 1, [pills(x), x.log.refresh]);
  x = load({ psdUnits: function () { return Promise.resolve(UNITS); }, fail: { 'POST /api/promo/social/art background': { status: 413, body: { error: TOO_LARGE } } } });
  got = await readAnswer(await x.A.psd({ body: blob(20 * MiB, '', 0, 0) }));
  check('a refused first step → its reason, nothing else sent, nothing redrawn', got.status === 413 && got.json.error === TOO_LARGE && x.log.req.length === 1 && x.log.refresh === 0, [got, x.log.req.length]);
  x = load({ psdUnits: function () { return Promise.resolve(UNITS); }, fail: { 'POST /api/promo/social/art/psd': { status: 400, body: { error: 'The PSD\'s summary could not be read. Upload the PSD again.' } } } });
  got = await readAnswer(await x.A.psd({ body: blob(20 * MiB, '', 0, 0) }));
  check('a refused summary → its reason; both units were kept, so the pills and thumbnails follow', got.status === 400 && /summary/.test(got.json.error) &&
    pills(x).background && pills(x).logoUnit && x.log.refresh === 1, [got, pills(x)]);

  x = load({ psdUnits: function () { return Promise.resolve(UNITS); } });
  inp = pick(x, 'psd', blob(48 * MiB, '', 0, 0, { name: 'banner.psd' }));
  await x.A.uploadPsd(inp); await tick();
  check('I.3 a design file: the cards are drawn again, then what it put on them', status(x) === 'The design file’s background and logo are now on all posts.' &&
    pills(x).background && pills(x).logoUnit && crosses(x).length === 1 && x.log.refresh === 1 && inp.value === '', [status(x), pills(x), x.log.refresh]);
  x = load({ art: { background: { from: 'psd', width: 1, height: 1 }, logoUnit: { from: 'psd', width: 1, height: 1 } }, psdUnits: function () { return Promise.resolve(NOLOGO); } });
  inp = pick(x, 'psd', blob(48 * MiB, '', 0, 0));
  await x.A.uploadPsd(inp); await tick();
  check('I.3 a design file with no logo after one with a logo: says the background, and the logo line follows (fidelity 7)',
    status(x) === 'The design file’s background is now on all posts.' && !pills(x).logoUnit && pills(x).background, [status(x), pills(x)]);
  x = load({ psdUnits: function () { return Promise.resolve({ canvasWidth: 500, canvasHeight: 500, background: null, logo: UNITS.logo }); } });
  inp = pick(x, 'psd', blob(2 * MiB, '', 0, 0));
  await x.A.uploadPsd(inp); await tick();
  check('a design file with no background leaves its pill off', status(x) === 'The design file’s logo is now on all posts.' && !pills(x).background && pills(x).logoUnit, [status(x), pills(x)]);
  x = load({ art: { bg1: { from: 'upload', width: 1, height: 1 }, useBg: '1' }, psdUnits: function () { return Promise.resolve(UNITS); } });
  await x.A.uploadPsd(pick(x, 'psd', blob(2 * MiB, '', 0, 0))); await tick();
  check('a design file while the posts start on Background 1: only its logo is said to be on them, its background waits in the menu',
    status(x) === 'The design file’s logo is now on all posts. Its background is ready: choose “Design file (.psd)” under “Every post starts on” to use it on all posts.', status(x));
  x = load({ psdUnits: function () { return Promise.resolve({ canvasWidth: 500, canvasHeight: 500, background: null, logo: null }); } });
  await x.A.uploadPsd(pick(x, 'psd', blob(2 * MiB, '', 0, 0)));
  check('a design file with neither says what to do instead', /has no background or logo your posts can use\. Upload them as pictures instead\.$/.test(status(x)), status(x));
  x = load();
  await x.A.uploadPsd(pick(x, 'psd', blob(121 * MiB, '', 0, 0)));
  check('a design file over 120 MB: what to do, in MB', status(x) === 'Upload failed: the design file is over 120 MB. Save a flattened copy and upload that.', status(x));

  /* ================= UX-128, UX-129, UX-131: the strip ================= */
  x = load();
  var strip = x.doc.body.querySelectorAll('.ow-strip')[0];
  check('UX-128 the strip in plain words', /^◧Pictures for your posts · your event details fill in automatically/.test(strip.textContent) &&
    !/the API|PSD background|BG 1|refreshing/.test(strip.textContent), strip.textContent);
  var pillBtns = x.doc.body.querySelectorAll('.slot');
  check('UX-131 the pills are buttons with plain names, each with its own hidden file input', pillBtns.length === 4 && pillBtns.every(function (b) { return b.tagName === 'BUTTON' && b.getAttribute('type') === 'button'; }) &&
    pillBtns.map(function (b) { return b.textContent; }).join('|') === 'Design file (.psd)|Background 1|Background 2|Background 3' &&
    ['psd', 1, 2, 3].every(function (k) { var i = inputOf(x, k); return i && i.getAttribute('hidden') === '' && i.getAttribute('type') === 'file'; }) &&
    inputOf(x, 'psd').getAttribute('accept') === '.psd' && inputOf(x, 3).getAttribute('accept') === 'image/*');
  var opened = []; ['psd', 1, 2, 3, 'logo'].forEach(function (k) { var i = inputOf(x, k); i.click = function () { opened.push(k); }; });
  pillBtns.forEach(function (b) { b.click(); });
  x.doc.getElementById('slot-logo').click();
  check('UX-131 each button opens its own file chooser (the logo\'s Replace too)', opened.join() === 'psd,1,2,3,logo', opened);
  check('UX-129 no logo anywhere: the posts show the event\'s name, and the line offers an upload', /^Logo · No logo yet: your posts show the event’s name/.test(logoLine(x).textContent) &&
    x.doc.getElementById('slot-logo').textContent === 'Upload a logo' && !logoRemove(x), logoLine(x).textContent);
  check('UX-129 the summary says what the posts use', status(x) === 'Your posts use the design’s own background and the event’s name in place of a logo.', status(x));
  x = load({ siteLogo: { dark: 'https://img.etb2bimg.com/u.png', light: 'https://img.etb2bimg.com/u.png' } });
  check('UX-129 the site\'s own logo is what the posts use: "Using your site\'s logo · Replace"', logoLine(x).textContent === 'Logo · Using your site’s logoReplace' &&
    x.doc.getElementById('slot-logo').getAttribute('aria-label') === 'Replace the logo for your posts' && status(x) === 'Your posts use the design’s own background and your site’s logo.', logoLine(x).textContent);
  x = load({ siteLogo: { dark: 'https://img.etb2bimg.com/u.png', light: '' } });
  check('UX-129 a site logo for dark posts only says so', /Using your site’s logo \(on dark posts; light ones show the event’s name\)/.test(logoLine(x).textContent), logoLine(x).textContent);
  x = load({ art: { logoUnit: { from: 'upload', width: 3, height: 1 } }, siteLogo: { dark: 'u', light: 'u' } });
  check('UX-129 an uploaded logo can be taken back to the site\'s', logoRemove(x) && logoRemove(x).textContent === 'Use the site’s logo');
  logoRemove(x).click(); await tick();
  check('UX-129 … asked first, then the site\'s logo is back', x.log.confirm[0].title === 'Remove the logo you uploaded?' && x.log.confirm[0].message === 'Your posts go back to your site’s logo.' &&
    status(x) === 'Logo removed. Your posts use your site’s logo again.' && /Using your site’s logo/.test(logoLine(x).textContent), [x.log.confirm[0], status(x)]);
  /* Every post starts on: the design's own, the design file's, Background 1-3 */
  x = load({ art: { background: { from: 'psd', width: 1, height: 1 }, bg3: { from: 'upload', width: 1, height: 1 } } });
  var sel = x.doc.getElementById('owUseBgSel'), opts = sel.getElementsByTagName('option');
  check('UX-129 "Every post starts on": the design\'s own, the design file\'s and each uploaded background, the default chosen', opts.map(function (o) { return o.value + '=' + o.textContent; }).join('|') ===
    'design=The design’s own background|=Design file (.psd)|3=Background 3' && sel.value === '', opts.map(function (o) { return o.value; }));
  sel.value = '3'; sel.onchange(); await tick();
  check('UX-129 picking one keeps it for the event and draws the cards again', x.ctx.OWS.art.useBg === '3' && x.log.refresh === 1 && status(x) === 'Background 3 is now on all posts.', status(x));
  check('UX-129 OWSArt.bgValue: "design" with no design file is the platform\'s own default', x.A.bgValue({}, 'design') === '' && x.A.bgValue({ background: true }, 'design') === 'design' &&
    x.A.bgValue({ bg1: true }, '2') === '' && x.A.bgValue({ bg2: true }, '2') === '2');

  /* ================= I.4: decorate and Remove ================= */
  x = load();
  x.A.decorate({ background: false, logoUnit: false, bg1: false, bg2: false, bg3: false, units: {}, psd: null });
  check('I.4 nothing stored: every pill off, no ✕', JSON.stringify(pills(x)) === JSON.stringify({ background: false, bg1: false, bg2: false, bg3: false, logoUnit: false }) && crosses(x).length === 0);
  var ART = { background: true, logoUnit: true, bg1: false, bg2: true, bg3: false, units: { logoUnit: { from: 'upload' } } };
  x.A.decorate(ART);
  check('I.4 each pill\'s "on" follows the art, and the logo line the logo', JSON.stringify(pills(x)) === JSON.stringify({ background: true, bg1: false, bg2: true, bg3: false, logoUnit: true }), pills(x));
  var xs = crosses(x);
  check('I.4 one ✕ per filled background pill (the logo has its own line)', xs.length === 2);
  var labels = [psdLabel(x), x.doc.getElementById('slot-bg2')];
  check('I.4 each ✕ sits right after its own pill, in the strip', xs.every(function (b, i) {
    var l = labels[i], n = l.nextSibling; while (n && n.nodeType !== 1) n = n.nextSibling;
    return n === b && b.parentNode === l.parentNode && b.parentNode.classList.contains('assets-slots') && b.closest('.slot') === null;
  }));
  check('I.4 each ✕ is a button that says what it removes', xs.every(function (b) { return b.tagName === 'BUTTON' && b.getAttribute('type') === 'button' && b.textContent === '✕'; }) &&
    JSON.stringify(xs.map(function (b) { return [b.getAttribute('title'), b.getAttribute('aria-label')]; })) === JSON.stringify([
      ['Remove the design file\'s background', 'Remove the design file\'s background'], ['Remove background 2', 'Remove background 2']]), xs.map(function (b) { return b.getAttribute('title'); }));
  x.A.decorate(ART);
  check('I.4 drawn again: still one ✕ each, one logo line', crosses(x).length === 2 && x.doc.getElementById('owLogoLine').getElementsByTagName('button').length === 2);
  x.A.decorate(Object.assign({}, ART, { logoUnit: false }));
  check('I.4 a cleared logo: the line has nothing to remove', !pills(x).logoUnit && crosses(x).length === 2);
  x.A.decorate(null); x.A.decorate(undefined); x.A.decorate('nope');
  check('I.4 with no art read, the pills are left as they are', pills(x).background && pills(x).bg2 && crosses(x).length === 2);
  var y = load(); y.doc.getElementById('content').innerHTML = '<div class="tgrid"></div>';
  y.A.decorate(ART);
  check('decorate on a page with no strip does nothing', crosses(y).length === 0);

  /* Remove: ask → DELETE → status → art read again → pills → thumbnails */
  var held = { background: { from: 'psd', width: 1350, height: 600 }, bg2: { from: 'upload', width: 1200, height: 800 }, logoUnit: { from: 'upload', width: 300, height: 100 } };
  x = load({ art: held });
  var bg2x = crosses(x)[1];
  bg2x.click(); await tick();
  check('I.4 Remove asks first, in the page\'s dialog', x.log.confirm.length === 1 && JSON.stringify(x.log.confirm[0]) === JSON.stringify({ title: 'Remove background 2?',
    message: 'Posts go back to the design\'s own background.', opts: { ok: 'Remove', danger: true } }), x.log.confirm[0]);
  var del = x.log.req.filter(function (q) { return q.method === 'DELETE'; });
  check('I.4 … then DELETE for that slot of this event', del.length === 1 && del[0].url === '/api/promo/social/art?eventId=' + EV + '&slot=bg2', del);
  check('I.4 … the status line says so', status(x) === 'Background 2 removed.', status(x));
  check('I.4 … the art is read again: its pill off, its ✕ gone, the others untouched', !pills(x).bg2 && pills(x).background && pills(x).logoUnit && crosses(x).length === 1 &&
    x.ctx.OWS.art && x.ctx.OWS.art.bg2 === false, pills(x));
  check('I.4 … and the thumbnails are drawn again', x.log.refresh === 1);
  logoRemove(x).click(); await tick();
  check('I.4 Remove the logo (no site logo): its own question and status', x.log.confirm[1].title === 'Remove the logo you uploaded?' && x.log.confirm[1].message === 'Your posts show the event’s name in type instead.' &&
    status(x) === 'Logo removed. Your posts show the event’s name.' && !pills(x).logoUnit && x.log.refresh === 2, [x.log.confirm[1], status(x)]);
  crosses(x)[0].click(); await tick();
  check('I.4 Remove the design file\'s background: its own question and status', x.log.confirm[2].title === 'Remove the design file\'s background?' && x.log.confirm[2].message === 'Posts go back to the design\'s own background.' &&
    status(x) === 'The design file\'s background was removed.' && !pills(x).background && crosses(x).length === 0, [x.log.confirm[2], status(x)]);

  x = load({ art: held, confirm: false });
  var before = status(x);
  crosses(x)[0].click(); await tick();
  check('I.4 Cancel: nothing sent, nothing changes', x.log.req.length === 0 && pills(x).background && status(x) === before && x.log.refresh === 0);

  x = load({ art: held, fail: { 'DELETE /api/promo/social/art bg2': { status: 500, body: { error: 'Something went wrong with the posts. Please try again.' } } } });
  bg2x = crosses(x)[1];
  bg2x.click(); await tick();
  check('a failed Remove says why, keeps the pill and its ✕ (usable again), and redraws nothing',
    status(x) === 'Remove failed: Something went wrong with the posts. Please try again.' && pills(x).bg2 && crosses(x).length === 2 && bg2x.disabled === false && x.log.refresh === 0, status(x));
  x = load({ art: held, fail: { 'DELETE /api/promo/social/art bg2': 'network' } });
  crosses(x)[1].click(); await tick();
  check('… and when the request did not go through', /^Remove failed: The upload did not reach EventSphere|^Remove failed: .*connection/.test(status(x)), status(x));
  x = load({ art: held, fail: { 'GET /api/promo/social/art': { status: 500, body: { error: 'x' } } } });
  x.ctx.OWS.art = { background: true, bg2: true, logoUnit: true, units: { bg2: { url: 'u' }, background: { url: 'v' } } };
  x.A.decorate(x.ctx.OWS.art);
  crosses(x)[1].click(); await tick();
  check('when the art cannot be read again after Remove, the removed slot is still shown empty',
    !pills(x).bg2 && pills(x).background && x.ctx.OWS.art.bg2 === false && !x.ctx.OWS.art.units.bg2 && x.ctx.OWS.art.units.background && x.log.refresh === 1, [pills(x), x.ctx.OWS.art]);
  x = load({ art: held });
  bg2x = crosses(x)[1];
  var realFetch = x.ctx.RevampAuth.authedFetch, release = null;
  x.ctx.RevampAuth.authedFetch = function (url, opts) {
    if (opts && opts.method === 'DELETE') return new Promise(function (ok) { release = function () { ok(realFetch(url, opts)); }; });
    return realFetch(url, opts);
  };
  bg2x.click(); await tick();
  var during = bg2x.disabled;
  release(); await tick();
  check('the ✕ is disabled while its Remove runs', during === true && !pills(x).bg2 && crosses(x).length === 1, [during, pills(x)]);

  /* ================= §13: the layout editor's "Upload a picture" ================= */
  x = load();
  var picErr = null;
  await x.A.picture(blob(41 * MiB, 'image/jpeg', 5000, 4000)).then(null, function (e) { picErr = e; });
  check('§13 a picture over 40 MB is refused with "That upload is too large.", nothing sent', picErr && picErr.message === TOO_LARGE && String(picErr) === TOO_LARGE && x.log.req.length === 0, String(picErr));
  x = load({ encode: steps });
  var pic = await x.A.picture(blob(35 * MiB, 'image/png', 3000, 2000, { name: 'photo.png' }));
  var picReq = x.log.req.filter(function (q) { return q.path === '/api/promo/social/picture'; });
  check('§13 a 35 MB picture is brought under 8 MiB first (fit), then sent raw to this event', picReq.length === 1 && picReq[0].body.size <= 8 * MiB && picReq[0].body.type === 'image/webp' &&
    picReq[0].eventId === EV && picReq[0].type === 'application/octet-stream' && picReq[0].method === 'POST', picReq[0]);
  check('§13 it resolves { url, width, height } from the server', JSON.stringify(pic) === JSON.stringify({ url: 'https://storage.googleapis.com/b/events/' + EV + '/promo-art/picture-k3-0123456789abcdef.png',
    width: 3000, height: 2000 }), pic);
  check('§13 it is not one of the art slots: the art is not read again and no pill changes', x.log.req.length === 1 && crosses(x).length === 0 && x.log.refresh === 0);
  x = load({ fail: { 'POST /api/promo/social/picture': { status: 400, body: { error: NOT_A_PICTURE } } } });
  picErr = null;
  await x.A.picture(blob(1000, 'text/plain', 0, 0, { decodes: false })).then(null, function (e) { picErr = e; });
  check('§13 it rejects with the server\'s text', picErr && picErr.message === NOT_A_PICTURE && String(picErr) === NOT_A_PICTURE && picErr.status === 400, picErr && picErr.message);
  x = load({ fail: { 'POST /api/promo/social/picture': { status: 200, body: { ok: true } } } });
  picErr = null;
  await x.A.picture(blob(1000, 'image/png', 10, 10)).then(null, function (e) { picErr = e; });
  check('§13 an answer with no address is a failure, never an empty src', picErr && /could not be uploaded/.test(picErr.message), picErr && picErr.message);
  x = load(); picErr = null;
  await x.A.picture(blob(9 * MiB, 'image/heic', 0, 0, { decodes: false })).then(null, function (e) { picErr = e; });
  check('§13 one that does not open and is over 8 MiB is refused with no request', picErr && picErr.message === TOO_LARGE && x.log.req.length === 0);
  x = load({ fail: { 'POST /api/promo/social/picture': 'network' } }); picErr = null;
  await x.A.picture(blob(1000, 'image/png', 10, 10)).then(null, function (e) { picErr = e; });
  check('§13 a request that did not go through rejects with a reason to show', picErr && /did not reach EventSphere/.test(picErr.message));
  x = load(); picErr = null;
  await x.A.picture(null).then(null, function (e) { picErr = e; });
  check('§13 no file → a reason, no request', picErr && picErr.message && x.log.req.length === 0);

  notes.forEach(function (m) { console.log('note: ' + m); });
  if (failed) { console.error('promo-social-art: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-social-art: all ' + passed + ' checks passed');
})().catch(function (err) { console.error('promo-social-art: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
