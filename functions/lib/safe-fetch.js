/* Fetching an address a user typed, without letting it reach anything inside our own network.

     checkPublicUrl(url)        -> Promise<{ ok, reason, code }>       (never rejects)
     safeFetch(url, options)    -> Promise<{ status, headers, body: Buffer, finalUrl }>
       options: { timeoutMs = 15000, maxBytes = 5 MB, maxRedirects = 3, accept, headers }
         accept: content types the answer may have — "text/html", a prefix "image/", or a RegExp
       rejects with an Error whose message can be shown to the user and whose .code is one of
       "bad-url" | "blocked-address" | "too-large" | "timeout" | "bad-type" | "unreachable"

   The rules, applied to the first address and again to every redirect:
     - http or https, on the standard port, with no user name or password in the address;
     - the host name is resolved ONCE, every answer must be a public address (public-address.js), and the
       connection is then made to exactly the address that was checked — the name is not looked up a second
       time, so it cannot be re-pointed between the check and the request. The Host header and the TLS
       server name stay the host name, so virtual hosts and certificates work as usual;
     - redirects are never followed automatically;
     - one timer covers the whole exchange, and the body is counted as it arrives and cut off at maxBytes
       (counted after decompression);
     - nothing of ours is sent along: no cookies, no credentials, a fixed User-Agent. */

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');
const { isPublicAddress, isInternalHostname } = require('./public-address');

var DEFAULT_TIMEOUT_MS = 15000;
var DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
var DEFAULT_MAX_REDIRECTS = 3;
var USER_AGENT = 'RevampCMS-Fetcher/1.0';

var MESSAGES = {
  'bad-url': 'That is not an address we can open. Use a full http:// or https:// web address.',
  'blocked-address': 'That address points to a private or internal network, so it cannot be opened from here.',
  'too-large': 'That page is too large to read.',
  'timeout': 'That site took too long to answer.',
  'bad-type': 'That address did not return the kind of file expected.',
  'unreachable': 'That site could not be reached.'
};

function fetchError(code, detail) {
  var err = new Error(MESSAGES[code] + (detail ? ' ' + detail : ''));
  err.code = code;
  return err;
}

function refuse(code, reason) { return { ok: false, code: code, reason: reason || MESSAGES[code] }; }

/* The checks that need no network: -> { ok: true, url, host } or a refusal. */
function parsePublicUrl(raw) {
  var url;
  try { url = new URL(String(raw == null ? '' : raw).trim()); } catch (e) { return refuse('bad-url'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return refuse('bad-url', 'Only http and https addresses can be opened.');
  if (url.username || url.password) return refuse('bad-url', 'An address with a user name or password in it cannot be opened.');
  /* new URL() drops a default port, so anything left here is a non-standard one */
  if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) {
    return refuse('bad-url', 'Only addresses on the standard web ports can be opened (this one names port ' + url.port + ').');
  }
  var host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) return refuse('bad-url');
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) return refuse('blocked-address');
  } else if (isInternalHostname(host)) {
    return refuse('blocked-address');
  }
  return { ok: true, url: url, host: host };
}

/* Resolves the host once. -> { ok: true, url, host, address, family } or a refusal. `lookup` is node's
   dns.lookup unless a caller (the tests) passes its own. */
function resolvePublicUrl(raw, lookup) {
  var parsed = parsePublicUrl(raw);
  if (!parsed.ok) return Promise.resolve(parsed);
  var literal = net.isIP(parsed.host);
  if (literal) return Promise.resolve({ ok: true, url: parsed.url, host: parsed.host, address: parsed.host, family: literal });
  return new Promise(function (resolve) {
    (lookup || dns.lookup)(parsed.host, { all: true, verbatim: true }, function (err, answers) {
      if (err || !answers || !answers.length) return resolve(refuse('unreachable', 'That site could not be found. Check the address.'));
      var list = answers.map(function (a) { return typeof a === 'string' ? { address: a, family: net.isIP(a) } : a; });
      /* one private answer is enough to refuse: which answer a connection would use is not ours to choose */
      if (!list.every(function (a) { return isPublicAddress(a.address); })) return resolve(refuse('blocked-address'));
      resolve({ ok: true, url: parsed.url, host: parsed.host, address: list[0].address, family: list[0].family || net.isIP(list[0].address) });
    });
  });
}

function checkPublicUrl(raw, opts) {
  return resolvePublicUrl(raw, opts && opts.lookup).then(function (r) {
    return r.ok ? { ok: true, reason: '', code: '' } : { ok: false, reason: r.reason, code: r.code };
  });
}

function typeAccepted(accept, contentType) {
  if (!accept) return true;
  var type = String(contentType || '').split(';')[0].trim().toLowerCase();
  return [].concat(accept).some(function (rule) {
    if (rule instanceof RegExp) return rule.test(type);
    rule = String(rule).toLowerCase();
    return rule.slice(-1) === '/' ? type.indexOf(rule) === 0 : type === rule;
  });
}

/* One request to one already-vetted address. Resolves { redirect } or the final answer. */
function requestOnce(target, opts, deadlineAt, connectTo) {
  return new Promise(function (resolve, reject) {
    var url = target.url, secure = url.protocol === 'https:';
    var pinned = connectTo ? connectTo(target) : { address: target.address, port: url.port ? +url.port : (secure ? 443 : 80) };
    var family = net.isIP(pinned.address);
    var headers = Object.assign({ 'Accept': '*/*' }, opts.headers || {}, {
      'Host': url.host, 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate, br', 'Connection': 'close'
    });
    delete headers.Cookie; delete headers.cookie; delete headers.Authorization; delete headers.authorization;

    var settled = false, req = null;
    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (req) req.destroy();
      if (err) reject(err); else resolve(value);
    }
    var timer = setTimeout(function () { finish(fetchError('timeout')); }, Math.max(1, deadlineAt - Date.now()));

    var options = {
      method: 'GET', host: target.host, port: pinned.port, path: url.pathname + url.search, headers: headers, agent: false,
      /* the connection goes to the address that was checked; the name is never resolved again */
      lookup: function (hostname, lookupOptions, cb) {
        if (typeof lookupOptions === 'function') { cb = lookupOptions; lookupOptions = {}; }
        if (lookupOptions && lookupOptions.all) cb(null, [{ address: pinned.address, family: family }]);
        else cb(null, pinned.address, family);
      }
    };
    if (net.isIP(target.host)) options.host = pinned.address;
    if (secure && !net.isIP(target.host)) options.servername = target.host;

    try { req = (secure ? https : http).request(options); } catch (e) { return finish(fetchError('unreachable')); }
    req.on('error', function () { finish(fetchError('unreachable')); });
    req.on('response', function (res) {
      var status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].indexOf(status) !== -1 && res.headers.location) {
        res.resume();
        return finish(null, { redirect: String(res.headers.location) });
      }
      if (status >= 200 && status < 300 && !typeAccepted(opts.accept, res.headers['content-type'])) return finish(fetchError('bad-type'));
      var declared = +res.headers['content-length'];
      if (declared && declared > opts.maxBytes && !res.headers['content-encoding']) return finish(fetchError('too-large'));

      var encoding = String(res.headers['content-encoding'] || '').trim().toLowerCase();
      var stream = res;
      if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      else if (encoding && encoding !== 'identity') return finish(fetchError('unreachable'));

      var chunks = [], size = 0;
      stream.on('data', function (chunk) {
        size += chunk.length;
        if (size > opts.maxBytes) return finish(fetchError('too-large'));
        chunks.push(chunk);
      });
      stream.on('error', function () { finish(fetchError('unreachable')); });
      res.on('error', function () { finish(fetchError('unreachable')); });
      stream.on('end', function () {
        finish(null, { status: status, headers: res.headers, body: Buffer.concat(chunks), finalUrl: url.href });
      });
    });
    req.end();
  });
}

function safeFetch(raw, options) {
  options = options || {};
  var opts = {
    maxBytes: options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_BYTES,
    accept: options.accept || null,
    headers: options.headers || null
  };
  var maxRedirects = options.maxRedirects >= 0 ? options.maxRedirects : DEFAULT_MAX_REDIRECTS;
  var deadlineAt = Date.now() + (options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS);

  function hop(address, redirectsLeft) {
    if (Date.now() >= deadlineAt) return Promise.reject(fetchError('timeout'));
    var lookupTimer, lookupTimeout = new Promise(function (resolve, reject) {
      lookupTimer = setTimeout(function () { reject(fetchError('timeout')); }, Math.max(1, deadlineAt - Date.now()));
    });
    return Promise.race([resolvePublicUrl(address, options.lookup), lookupTimeout]).finally(function () { clearTimeout(lookupTimer); }).then(function (target) {
      if (!target.ok) throw Object.assign(new Error(target.reason), { code: target.code });
      return requestOnce(target, opts, deadlineAt, options._connectTo).then(function (answer) {
        if (!answer.redirect) return answer;
        if (redirectsLeft <= 0) throw fetchError('unreachable', 'It redirects too many times.');
        var next;
        try { next = new URL(answer.redirect, target.url).href; } catch (e) { throw fetchError('unreachable'); }
        return hop(next, redirectsLeft - 1);
      });
    });
  }
  return hop(raw, maxRedirects);
}

module.exports = { safeFetch, checkPublicUrl, isPublicAddress };
