/* node functions/lib/share-token.test.js — the token of a shareable preview link (lib/share-token.js): it cannot be
   guessed, only its hash is kept, its address is read strictly, and a log line never carries it. Pure: no
   network, no Firebase. Exits 1 on any failure. */
'use strict';
var T = require('./share-token');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }

/* ---------- newToken ---------- */
var seen = {}, all43 = true, allMatch = true, unique = true;
for (var i = 0; i < 1000; i++) {
  var t = T.newToken();
  if (t.length !== 43) all43 = false;
  if (!T.TOKEN_RE.test(t)) allMatch = false;
  if (seen[t]) unique = false;
  seen[t] = 1;
}
check('1,000 tokens are all 43 characters', all43);
check('… all match TOKEN_RE (base64url, no padding)', allMatch);
check('… and all are different', unique);
check('a token carries 256 bits (32 random bytes)', Buffer.from(T.newToken(), 'base64url').length === 32);

/* ---------- hashToken ---------- */
var tok = T.newToken();
check('hashToken is deterministic', T.hashToken(tok) === T.hashToken(tok));
check('hashToken is 64 hex characters', /^[0-9a-f]{64}$/.test(T.hashToken(tok)), T.hashToken(tok));
check('hashToken is never the token itself, nor contains it', T.hashToken(tok) !== tok && T.hashToken(tok).indexOf(tok) === -1);
check('two tokens, two hashes', T.hashToken(tok) !== T.hashToken(T.newToken()));
check('hashToken is SHA-256 of the token\'s UTF-8', T.hashToken('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

/* ---------- last4 ---------- */
check('last4 is the last four characters', T.last4('abcdefgh') === 'efgh' && T.last4(tok) === tok.slice(-4));
check('last4 of nothing is empty', T.last4('') === '' && T.last4(null) === '');

/* ---------- parseSharePath ---------- */
var A = 'AbC_-0123456789abcdefghijklmnopqrstuvwxyzQZ';   // 43 characters
check('the test token is 43 characters', A.length === 43 && T.TOKEN_RE.test(A));
var p1 = T.parseSharePath('/s/' + A), p2 = T.parseSharePath('/s/' + A + '/'), p3 = T.parseSharePath('/s/' + A + '/agenda');
check('/s/<t> is the home page', p1 && p1.token === A && p1.slug === '', p1);
check('/s/<t>/ is the home page', p2 && p2.token === A && p2.slug === '', p2);
check('/s/<t>/agenda is that page', p3 && p3.token === A && p3.slug === 'agenda', p3);
check('/s/<t>/agenda/ too', (T.parseSharePath('/s/' + A + '/agenda/') || {}).slug === 'agenda');
check('/s/abc (too short) is refused', T.parseSharePath('/s/abc') === null);
check('/s/<t>/Agenda (not a slug) is refused', T.parseSharePath('/s/' + A + '/Agenda') === null);
check('/s/<t>/a/b (below a page) is refused', T.parseSharePath('/s/' + A + '/a/b') === null);
check('/s/<44 characters> is refused', T.parseSharePath('/s/' + A + 'x') === null);
check('/s/<42 characters> is refused', T.parseSharePath('/s/' + A.slice(1)) === null);
check('a token with a character outside base64url is refused', T.parseSharePath('/s/' + A.slice(1) + '.') === null && T.parseSharePath('/s/' + A.slice(1) + '%') === null);
check('a slug longer than 40 is refused', T.parseSharePath('/s/' + A + '/' + new Array(42).join('a')) === null);
check('/s/ and /s are refused', T.parseSharePath('/s/') === null && T.parseSharePath('/s') === null);
check('/preview/<t> and /e/<t> are not share paths', T.parseSharePath('/preview/' + A) === null && T.parseSharePath('/e/' + A) === null);
check('a path with its query is not read as a share path (callers strip the query first)', T.parseSharePath('/s/' + A + '?draft=1') === null);
check('nothing at all is refused', T.parseSharePath(undefined) === null && T.parseSharePath(null) === null);

/* ---------- redactUrl ---------- */
var r1 = T.redactUrl('/s/' + A + '/agenda?draft=1');
check('redactUrl keeps …last4, the page and the query', r1 === '/s/…' + A.slice(-4) + '/agenda?draft=1', r1);
check('… and the token is gone', r1.indexOf(A) === -1);
check('redactUrl of /s/<t> alone', T.redactUrl('/s/' + A) === '/s/…' + A.slice(-4));
check('a short segment (/s/x) becomes … alone', T.redactUrl('/s/x') === '/s/…' && T.redactUrl('/s/abcdefg/x') === '/s/…/x', T.redactUrl('/s/abcdefg/x'));
check('an 8-character segment shows its last four', T.redactUrl('/s/abcdefgh') === '/s/…efgh');
check('a token sent with doubled slashes is redacted too', T.redactUrl('//s//' + A).indexOf(A) === -1, T.redactUrl('//s//' + A));
check('a query-only token (/s/?x) is left alone and holds no token', T.redactUrl('/s/?x=1') === '/s/…?x=1', T.redactUrl('/s/?x=1'));
['/preview/abc?draft=1', '/e/event-x/agenda', '/api/event/share-preview', '/', '/sx/' + A, '/t/c/abc?u=1'].forEach(function (u) {
  check('redactUrl leaves ' + u + ' unchanged', T.redactUrl(u) === u, T.redactUrl(u));
});
check('redactUrl of nothing is empty', T.redactUrl(undefined) === '' && T.redactUrl(null) === '');

/* ---------- shareHeaders ---------- */
var h = T.shareHeaders();
check('every /s/ answer: no-store', h['Cache-Control'] === 'no-store');
check('… noindex, nofollow, noarchive', h['X-Robots-Tag'] === 'noindex, nofollow, noarchive');
check('… Referrer-Policy: strict-origin', h['Referrer-Policy'] === 'strict-origin');
check('… no framing', h['X-Frame-Options'] === 'DENY' && h['Content-Security-Policy'] === "frame-ancestors 'none'");
check('… nosniff and Vary', h['X-Content-Type-Options'] === 'nosniff' && h['Vary'] === 'Accept-Encoding');
check('… and no cookie', !Object.keys(h).some(function (k) { return /cookie/i.test(k); }));
h.X = 1;
check('a fresh object each time', T.shareHeaders().X === undefined);

if (failed) { console.error('share-token: ' + failed + ' of ' + (passed + failed) + ' checks failed'); process.exit(1); }
console.log('share-token: all ' + passed + ' checks passed');
