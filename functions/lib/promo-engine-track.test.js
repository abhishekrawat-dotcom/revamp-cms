// node functions/lib/promo-engine-track.test.js — a mailer's open pixel and signed click links, as the vendored engine
// makes and checks them (promo-engine/src/mailers/track.ts, built into vendor/promo-engine.js): the key comes from
// TRACK_SECRET only and is never made up or written to a file, the previous key still opens links sent before a
// rotation, merge tokens and links the click redirect would refuse are left as written, and every link that is
// rewritten passes the redirect's own checks. No network; keys are made here and thrown away.
var crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
var engine = require('./vendor/promo-engine');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

/* a test owns its environment: no deployed-instance flag, and no key until a check sets one */
delete process.env.K_SERVICE;
delete process.env.TRACK_SECRET;
delete process.env.TRACK_SECRET_PREVIOUS;

var KEY_MSG = 'TRACK_SECRET is not set (32+ characters) — tracked links cannot be signed or checked';
var SEND_ID_RE = /^[A-Za-z0-9_-]{12}$/;
var BASE = 'https://track.example';
var ID = 'abcDEF012_-x';
function newKey() { return crypto.randomBytes(32).toString('hex'); }
function thrown(fn) { try { fn(); return null; } catch (err) { return err && err.message || String(err); } }
/* the signature as §3d defines it, computed here independently of the engine */
function hmac(key, id, target) { return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(id + '\n' + target).digest('base64url').slice(0, 16); }
function count(s, sub) { return s.split(sub).length - 1; }
function hrefs(html) { var out = [], re = /href="([^"]*)"/gi, m; while ((m = re.exec(html))) out.push(m[1]); return out; }
/* an attribute's text back to its value: esc() writes only these four */
function unescAttr(s) { return s.replace(/&(amp|lt|gt|quot);/g, function (_, n) { return { amp: '&', lt: '<', gt: '>', quot: '"' }[n]; }); }

/* What the click redirect does with a rewritten link (plan §3c gates 1-6, as lib/promo-track.js runs them): exactly
   one u, safeUrl, clickTargetOk, a send id, a key, the signature. Gives the URL it would redirect to, or null for
   "bad link". */
function follow(attr) {
  var u;
  try { u = new URL(unescAttr(attr)); } catch (err) { return null; }
  var m = /^\/t\/c\/([^/]+)$/.exec(u.pathname);
  if (!m) return null;
  var id = decodeURIComponent(m[1]), us = u.searchParams.getAll('u');
  if (us.length !== 1) return null;
  var target = engine.safeUrl(us[0]) || '';
  if (!engine.clickTargetOk(target) || !SEND_ID_RE.test(id)) return null;
  if (!engine.verifyClick(id, target, String(u.searchParams.get('s') || ''))) return null;
  return target;
}

/* ---- 1. no key: nothing is signed, nothing verifies, and no key is invented or written anywhere ---- */
var home = process.cwd(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-engine-track-'));
try {
  process.chdir(tmp);
  check('no key: signing throws the exact message', thrown(function () { engine.signClick(ID, 'https://a.example/'); }) === KEY_MSG,
    thrown(function () { engine.signClick(ID, 'https://a.example/'); }));
  check('no key: a click never verifies', engine.verifyClick(ID, 'https://a.example/', 'AAAAAAAAAAAAAAAA') === false);
  check('no key: a click URL cannot be built', thrown(function () { engine.clickUrl(BASE, ID, 'https://a.example/'); }) === KEY_MSG);
  check('no key: rewriting links throws (the caller then sends the mail plain)',
    thrown(function () { engine.injectTracking('<a href="https://a.example/">x</a>', ID, BASE, { links: true }); }) === KEY_MSG);
  var pixelOnly = engine.injectTracking('<a href="https://a.example/">x</a>', ID, BASE, { links: false });
  check('no key: the pixel alone needs no key', count(pixelOnly, '/t/o/' + ID + '.gif') === 1 && pixelOnly.indexOf('<a href="https://a.example/">') === 0);

  var k31 = newKey().slice(0, 31);
  process.env.TRACK_SECRET = '  ' + k31 + '\n';
  check('a 31-character key (after trimming) is no key: signing throws', thrown(function () { engine.signClick(ID, 'https://a.example/'); }) === KEY_MSG);
  check('a 31-character key is no key: verify is false, even for its own HMAC', engine.verifyClick(ID, 'https://a.example/', hmac(k31, ID, 'https://a.example/')) === false);
  process.env.TRACK_SECRET = '';
  check('an empty key is no key', thrown(function () { engine.signClick(ID, 'https://a.example/'); }) === KEY_MSG);
  delete process.env.TRACK_SECRET;

  var k32 = newKey().slice(0, 32);
  process.env.TRACK_SECRET_PREVIOUS = k32;
  check('a previous key alone checks nothing (the current key is required)', engine.verifyClick(ID, 'https://a.example/', hmac(k32, ID, 'https://a.example/')) === false);
  delete process.env.TRACK_SECRET_PREVIOUS;

  check('no key file is written beside the analytics data (the platform\'s fallback is gone)',
    !fs.existsSync(path.join(tmp, 'assets', 'analytics')) && !fs.existsSync(path.join(tmp, 'assets')) && fs.readdirSync(tmp).length === 0, fs.readdirSync(tmp));
} finally {
  process.chdir(home);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- 2. with a key: sign and verify ---- */
var K = newKey();
process.env.TRACK_SECRET = K;
var T = 'https://sponsor.example/page?a=1&b=2';
var S = engine.signClick(ID, T);
check('a signature is 16 base64url characters', /^[A-Za-z0-9_-]{16}$/.test(S), S);
check('the signature is HMAC-SHA256 over "id\\ntarget", base64url, first 16', S === hmac(K, ID, T));
check('the key is trimmed before use', (function () { process.env.TRACK_SECRET = ' ' + K + ' \n'; var s = engine.signClick(ID, T); process.env.TRACK_SECRET = K; return s === S; })());
check('exactly 32 characters is a key', (function () { var k = K.slice(0, 32); process.env.TRACK_SECRET = k; var s = engine.signClick(ID, T); process.env.TRACK_SECRET = K; return s === hmac(k, ID, T); })());
check('sign then verify round-trips', engine.verifyClick(ID, T, S) === true);
check('a changed id fails', engine.verifyClick('abcDEF012_-y', T, S) === false);
check('a changed target fails', engine.verifyClick(ID, T + 'x', S) === false && engine.verifyClick(ID, 'https://sponsor.example/page?a=1&b=3', S) === false);
var flipped = S.slice(0, 5) + (S[5] === 'A' ? 'B' : 'A') + S.slice(6);
check('one changed signature character fails', engine.verifyClick(ID, T, flipped) === false);
check('a short signature fails', engine.verifyClick(ID, T, S.slice(0, 15)) === false && engine.verifyClick(ID, T, '') === false);
check('a long signature fails', engine.verifyClick(ID, T, S + 'A') === false);
check('a missing or odd signature fails and never throws', engine.verifyClick(ID, T, undefined) === false && engine.verifyClick(ID, T, null) === false &&
  engine.verifyClick(ID, T, 'é' + S.slice(1)) === false);
check('the key is read on every call: a new key refuses the old signature', (function () { process.env.TRACK_SECRET = newKey(); var ok = engine.verifyClick(ID, T, S); process.env.TRACK_SECRET = K; return ok === false && engine.verifyClick(ID, T, S); })());

/* ---- 3. TRACK_SECRET_PREVIOUS: rotation without breaking links already sent ---- */
var A = newKey(), B = newKey();
process.env.TRACK_SECRET = A;
var sigA = engine.signClick(ID, T);
process.env.TRACK_SECRET = B;
check('after a rotation with no previous key, a link signed with the old key fails', engine.verifyClick(ID, T, sigA) === false);
process.env.TRACK_SECRET_PREVIOUS = A;
check('with TRACK_SECRET_PREVIOUS set to the old key, the old link verifies', engine.verifyClick(ID, T, sigA) === true);
var sigB = engine.signClick(ID, T);
check('new signatures use the current key, never the previous one', sigB === hmac(B, ID, T) && sigB !== sigA);
check('a new link verifies too', engine.verifyClick(ID, T, sigB) === true);
check('the previous key still binds id and target', engine.verifyClick('abcDEF012_-y', T, sigA) === false && engine.verifyClick(ID, T + '/', sigA) === false);
process.env.TRACK_SECRET_PREVIOUS = '  ' + A + '  ';
check('the previous key is trimmed too', engine.verifyClick(ID, T, sigA) === true);
var P31 = A.slice(0, 31);
process.env.TRACK_SECRET_PREVIOUS = P31;
check('a previous key under 32 characters is ignored', engine.verifyClick(ID, T, hmac(P31, ID, T)) === false && engine.verifyClick(ID, T, sigB) === true);
delete process.env.TRACK_SECRET_PREVIOUS;
process.env.TRACK_SECRET = K;

/* ---- 4. injectTracking ---- */
var MAIL = '<!doctype html><html><head><title>t</title></head><body><table><tr><td>' +
  '<a href="https://sponsor.example/a">one</a> <a href="http://plain.example/b?x=1&amp;y=2">two</a> ' +
  '<a href="#">self</a> <a href="mailto:hello@example.com">mail</a>' +
  '</td></tr></table></body></html>';
var PIXEL_RE = new RegExp('<img src="' + BASE.replace(/\./g, '\\.') + '/t/o/' + ID + '\\.gif" width="1" height="1" border="0" alt="" style="[^"]*">');

var plainLinks = engine.injectTracking(MAIL, ID, BASE, { links: false });
check('links:false — exactly one pixel', count(plainLinks, '/t/o/') === 1 && PIXEL_RE.test(plainLinks));
check('the pixel sits immediately before </body>', new RegExp(PIXEL_RE.source + '</body></html>$').test(plainLinks), plainLinks.slice(-260));
check('links:false — every href untouched (the mail is the input plus the pixel)', plainLinks.replace(PIXEL_RE, '') === MAIL);
check('no script is ever added', !/<script/i.test(plainLinks) && !/<script/i.test(engine.injectTracking(MAIL, ID, BASE, { links: true })));

var noBody = engine.injectTracking('<p>hi</p>', ID, BASE, { links: false });
check('with no </body>, the pixel is appended at the end', noBody.indexOf('<p>hi</p><img src=') === 0 && /\.gif" [^>]*>$/.test(noBody) && count(noBody, '/t/o/') === 1);
check('a trailing slash on the base is not doubled', engine.injectTracking('<p>x</p>', ID, BASE + '/', { links: false }).indexOf(BASE + '/t/o/' + ID + '.gif') !== -1 &&
  engine.injectTracking('<p>x</p>', ID, BASE + '/', { links: false }).indexOf('//t/') === -1);
check('no base or no id: the mail is returned as it was', engine.injectTracking(MAIL, ID, '', {}) === MAIL && engine.injectTracking(MAIL, '', BASE, {}) === MAIL);

var tracked = engine.injectTracking(MAIL, ID, BASE, { links: true });
var hs = hrefs(tracked);
var CLICK_RE = new RegExp('^' + BASE.replace(/\./g, '\\.') + '/t/c/' + ID + '\\?u=[^&"]+&amp;s=[A-Za-z0-9_-]{16}$');
check('links:true — https and http hrefs become <base>/t/c/<id>?u=…&s=<16 chars>', CLICK_RE.test(hs[0]) && CLICK_RE.test(hs[1]), hs.slice(0, 2));
check('links:true — the redirect follows them to the real pages', follow(hs[0]) === 'https://sponsor.example/a' && follow(hs[1]) === 'http://plain.example/b?x=1&y=2', [follow(hs[0]), follow(hs[1])]);
check('links:true — # and mailto: kept as written, still one pixel', hs[2] === '#' && hs[3] === 'mailto:hello@example.com' && count(tracked, '/t/o/') === 1);
check('links left out of the options are rewritten, as the platform did', engine.injectTracking(MAIL, ID, BASE).indexOf('/t/c/' + ID) !== -1);
check('an upper-case HREF is rewritten too', /href="https:\/\/track\.example\/t\/c\//.test(engine.injectTracking('<a HREF="https://a.example/">x</a>', ID, BASE, { links: true })));

var SKIP = ['', '#', 'mailto:a@b.example', 'tel:+911234567890', 'sms:+911234567890', '{$$!!unsubscribelink!!$$}', 'https://x.example/?a={$$y$$}',
  'https://x.example/?e=*|EMAIL|*', 'https://x.example/?e=%%email%%', 'https://x.example/?e={{email}}', 'https://x.example/?e={{ contact.email }}',
  'cid:logo@x', 'data:image/png;base64,AAAA', '/rel', 'ftp://x.example/y', 'javascript:alert(1)', '  #  ', 'MAILTO:a@b.example'];
SKIP.forEach(function (raw) {
  var html = '<p><a href="' + raw + '">x</a></p>';
  var out = engine.injectTracking(html, ID, BASE, { links: true });
  check('left alone: ' + JSON.stringify(raw), out.indexOf(html) === 0 && out.indexOf('/t/c/') === -1 && engine.trackTarget(raw) === '', out);
});
/* links the click redirect would refuse: the platform signed them, and the recipient got "bad link" */
var UNTRACKABLE = ['https://a b.example/', 'https://x.example/?a=&#1;', 'https://x.example/&#xD800;', 'https://x.example/&#0;', 'https://x.example/?a=&#127;', 'https://[nope/', 'http://'];
UNTRACKABLE.forEach(function (raw) {
  var html = '<p><a href="' + raw + '">x</a></p>';
  var out = engine.injectTracking(html, ID, BASE, { links: true });
  check('untrackable, so left alone: ' + JSON.stringify(raw), out.indexOf(html) === 0 && out.indexOf('/t/c/') === -1 && count(out, '/t/o/') === 1, out);
});

function trackOne(raw) {
  var out = engine.injectTracking('<a href="' + raw + '">x</a>', ID, BASE, { links: true });
  var h = hrefs(out)[0];
  return { attr: h, to: follow(h), u: (function () { try { return new URL(unescAttr(h)).searchParams.get('u'); } catch (e) { return null; } })() };
}
var amp = trackOne('https://x.example/p?a=1&amp;b=2');
check('?a=1&amp;b=2 is signed as ?a=1&b=2', amp.u === 'https://x.example/p?a=1&b=2' && amp.to === 'https://x.example/p?a=1&b=2', amp);
check('…and the rewritten href is escaped again (no bare & in the attribute)', amp.attr.indexOf('&amp;s=') !== -1 && !/&(?!amp;)/.test(amp.attr), amp.attr);
var ampLt = trackOne('https://x.example/?q=&amp;lt;');
check('&amp;lt; decodes once, to the text &lt;', ampLt.to === 'https://x.example/?q=&lt;', ampLt);
var num = trackOne('https://x.example/?a=1&#38;b=2');
check('&#38; decodes to &', num.to === 'https://x.example/?a=1&b=2', num);
check('&#x26; and &#X26; decode to & too', trackOne('https://x.example/?a=1&#x26;b=2').to === 'https://x.example/?a=1&b=2' && trackOne('https://x.example/?a=1&#X26;b=2').to === 'https://x.example/?a=1&b=2');
check('&quot; and &#39; decode', trackOne('https://x.example/?q=&quot;hi&#39;').to === 'https://x.example/?q="hi\'');
var spaced = trackOne(' https://a.example/c ');
check('href=" https://a.example/c " — trimmed, and the link passes the redirect', spaced.to === 'https://a.example/c' && spaced.u === 'https://a.example/c', spaced);
var wrapped = trackOne('https://a.example/c?x=1\n  &amp;y=2\t');
check('an href broken over two lines — the line break and tab dropped, and the link passes the redirect', wrapped.to === 'https://a.example/c?x=1  &y=2', wrapped);
check('every rewritten link in one mail shares the send id', (function () {
  var out = engine.injectTracking('<a href="https://a.example/1">1</a><a href="https://a.example/2">2</a><a href="https://a.example/1">3</a>', ID, BASE, { links: true });
  var h = hrefs(out);
  return h.length === 3 && h.every(function (x) { return x.indexOf(BASE + '/t/c/' + ID + '?') === 0; }) && h[0] === h[2] && h[0] !== h[1];
})());

/* ---- 5. trackTarget / clickTargetOk / safeUrl directly ---- */
check('trackTarget: a plain link is itself', engine.trackTarget('https://a.example/x?y=1') === 'https://a.example/x?y=1');
check('trackTarget: entities, once', engine.trackTarget('https://x.example/?a=1&amp;b=2') === 'https://x.example/?a=1&b=2' &&
  engine.trackTarget('https://x.example/?q=&amp;lt;') === 'https://x.example/?q=&lt;' && engine.trackTarget('https://x.example/?a=&#38;') === 'https://x.example/?a=&' &&
  engine.trackTarget('https://x.example/?a=&lt;b&gt;') === 'https://x.example/?a=<b>');
check('trackTarget: a numeric entity past U+10FFFF is left as written', engine.trackTarget('https://x.example/?a=&#9999999;') === 'https://x.example/?a=&#9999999;' &&
  engine.trackTarget('https://x.example/?a=&#x110000;') === 'https://x.example/?a=&#x110000;');
check('trackTarget: an entity that is not one of the decoded set is left as written', engine.trackTarget('https://x.example/?a=&nbsp;') === 'https://x.example/?a=&nbsp;');
check('trackTarget: tabs, line breaks and the ends', engine.trackTarget('\n https://a.example/\tc\r\n ') === 'https://a.example/c');
check('trackTarget: the scheme in any case, kept as written', engine.trackTarget('HTTPS://A.example/') === 'HTTPS://A.example/');
check('trackTarget: an entity-hidden javascript: link is not tracked', engine.trackTarget('javascript&#58;alert(1)') === '' && engine.trackTarget('&#106;avascript:alert(1)') === '');
check('trackTarget: nothing at all', engine.trackTarget('') === '' && engine.trackTarget(undefined) === '' && engine.trackTarget(null) === '');
SKIP.concat(UNTRACKABLE).forEach(function (raw) { check('trackTarget gives "" for ' + JSON.stringify(raw), engine.trackTarget(raw) === ''); });

['https://a.example/', 'http://a.example/x?y=1', 'HTTPS://A.EXAMPLE', 'https://a.example/ü?q=é', 'https://xn--mnchen-3ya.example/', 'https://a.example/a b'].forEach(function (t) {
  check('clickTargetOk true: ' + JSON.stringify(t), engine.clickTargetOk(t) === true);
});
['', 'ftp://a.example/', 'javascript:alert(1)', 'mailto:a@b.example', '/rel', 'https://a b.example/', 'https://a.example/\u0001', 'https://a.example/\u007f',
  'https://a.example/\n', 'https://a.example/\t', 'https://a.example/\uD800', 'https://a.example/\uDC00x', 'http://', 'https://[nope/', 'x https://a.example/'].forEach(function (t) {
  check('clickTargetOk false: ' + JSON.stringify(t), engine.clickTargetOk(t) === false);
});
check('clickTargetOk never throws on odd input', engine.clickTargetOk(undefined) === false && engine.clickTargetOk(null) === false && engine.clickTargetOk(42) === false);

check('safeUrl is exported: trims, and drops javascript:/data:/vbscript:', engine.safeUrl(' https://a.example/ ') === 'https://a.example/' &&
  engine.safeUrl('javascript:alert(1)') === undefined && engine.safeUrl(' data:text/html,x') === undefined && engine.safeUrl('VBScript:x') === undefined &&
  engine.safeUrl('') === undefined && engine.safeUrl(undefined) === undefined);

/* Whatever an href holds, the rule holds: either the href is left exactly as written, or the rewritten link passes the
   redirect's own checks and leads to trackTarget's URL. Built from awkward pieces, with a fixed seed so a failure
   repeats. */
var seed = 20261028;
function rnd(n) { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; }
var PIECES = ['https://', 'http://', 'HTTPS://', 'a.example', 'x.example/', '/p', '?a=1', '&amp;', '&', '&#38;', '&#x26;', '&lt;', '&quot;', '&#39;',
  '&#1;', '&#0;', '&#127;', '&#xD800;', '&#xDC00;', '&#128512;', '&#9999999;', ' ', '\n', '\t', '\r', 'é', ' ', '%20', '%', '%%', '{{', '}}', '*|', '|*',
  '{$$', '#', 'mailto:', 'javascript:', ' ', 'ü', '[', ']', ':80', '@', '\\', '..', '=', ';'];
var fuzzBad = [];
for (var i = 0; i < 3000; i++) {
  var raw = '', n = 1 + rnd(8);
  if (rnd(3)) raw += ['https://', 'http://', ' https://', '\nhttp://'][rnd(4)] + ['a.example', 'x.example', 'b.example:8080'][rnd(3)];
  for (var j = 0; j < n; j++) raw += PIECES[rnd(PIECES.length)];
  if (raw.indexOf('"') !== -1) continue;
  var want = engine.trackTarget(raw);
  var out = engine.injectTracking('<a href="' + raw + '">x</a>', ID, BASE, { links: true });
  var h = hrefs(out)[0];
  if (!want) { if (h !== raw) fuzzBad.push({ raw: raw, why: 'changed though trackTarget gave ""' }); continue; }
  if (follow(h) !== want) fuzzBad.push({ raw: raw, want: want, got: follow(h) });
}
check('3000 awkward hrefs: each is left as written, or its rewritten link passes the redirect to trackTarget\'s URL', fuzzBad.length === 0, fuzzBad.slice(0, 5));

/* ---- 6. send ids ---- */
var ids = {}, badIds = [];
for (var n6 = 0; n6 < 1000; n6++) { var sid = engine.newSendId(); if (!SEND_ID_RE.test(sid) || ids[sid]) badIds.push(sid); ids[sid] = 1; }
check('1000 send ids: all unique, all 12 base64url characters', badIds.length === 0 && Object.keys(ids).length === 1000, badIds.slice(0, 5));

/* ---- 7. URL formats (plan §7a C6) ---- */
var TG = 'https://sponsor.example/p?a=1&b=é c';
check('clickUrl is <base>/t/c/<id>?u=<encoded target>&s=<signature>', engine.clickUrl(BASE, ID, TG) === BASE + '/t/c/' + ID + '?u=' + encodeURIComponent(TG) + '&s=' + hmac(K, ID, TG));
check('openUrl is <base>/t/o/<id>.gif', engine.openUrl(BASE, ID) === BASE + '/t/o/' + ID + '.gif');
check('the pixel in a mail is openUrl, escaped', engine.injectTracking('<p>x</p>', ID, BASE, { links: false }).indexOf('<img src="' + engine.openUrl(BASE, ID) + '"') !== -1);
check('the engine\'s exports are all there', ['trackTarget', 'clickTargetOk', 'clickUrl', 'openUrl', 'safeUrl', 'signClick', 'verifyClick', 'newSendId', 'injectTracking']
  .every(function (k) { return typeof engine[k] === 'function'; }));

/* the engine's importer unwraps Oneworld's own click links and drops its pixel, because both stay at the root */
var reimported = engine.importHtml(engine.injectTracking('<html><body><p>Read the <a href="https://sponsor.example/page?a=1&amp;b=2">agenda</a> now.</p></body></html>', ID, BASE, { links: true }),
  { portal: 'hr', name: 'Test Summit' });
var reText = JSON.stringify(reimported.doc), reReport = JSON.stringify(reimported.report);
check('re-importing a tracked mail gives back the real link, with no tracking address', reText.indexOf('https://sponsor.example/page?a=1&b=2') !== -1 && reText.indexOf('track.example') === -1, reText.slice(0, 400));
check('…and reports the click redirect unwrapped and the pixel dropped', /click-tracking redirects/.test(reReport) && /open-tracking pixel/.test(reReport));

delete process.env.TRACK_SECRET;
if (failed) { console.error('promo-engine-track: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('promo-engine-track: all ' + passed + ' checks passed');
