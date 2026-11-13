/* A Lovable import that did not work, said so (BE-048).

   Before this, an address with no site behind it (a Lovable address with no project answers 404 with "No Lovable
   project found"), a page that never came, or a capture with nothing on it was stored as a successful import and
   the editor opened on a blank page; a fault between this server and the capture service was shown to the person
   as the service's own words ("Missing or incorrect X-Scraper-Secret header.").

     failure(code, extra)       -> an Error with .status (what this server answers), .code and .message: one plain
                                   sentence for the person importing (create-event.html shows it as it is, so it is
                                   short and names no service, address or technical term)
     fromScraper(status, body)  -> that Error for an answer of lovable-scraper-service other than 200 (its codes,
                                   and the bare statuses an older deployment of it answers)
     fromNetwork(err)           -> that Error for a capture service that could not be reached at all
     measure(html)              -> { text, content, sample }: the visible text of a page's markup (its length and its
                                   first 600 characters) and how many things are on it besides text
     verdict(html)              -> '' | 'empty-page' | 'not-a-site' — the same rule lovable-scraper-service applies to
                                   the open page (captureVerdict), applied here to the markup, so that a capture made
                                   elsewhere (tools/reimport-lovable.js) or by an older deployment of that service is
                                   held to it too
     ownHost(url, hosts)        -> true when the address is on one of this product's own hosts

   Node 20, CommonJS, no dependencies. */
'use strict';

/* Each sentence is also what create-event.html's serverSentence() lets through as it is: at most 140 characters,
   no address, no brackets, and no word that looks like a system error code to it (a word of five letters or more
   starting with "e": "error", "empty", "EventSphere" are avoided for that reason). A test checks all of them. */
var WORDS = {
  'bad-url': [400, 'That is not a web address we can open. Paste the full link to the published site.'],
  'blocked-address': [400, 'That address points to a private or internal network, so it cannot be imported.'],
  'own-address': [400, 'That is a link to this product itself. Paste the link to the published Lovable site instead.'],
  'refused': [400, 'That address cannot be imported. Check it is the public link to the published site.'],
  'unreachable': [422, 'That site could not be reached. Check the address and that the site is published.'],
  'source-http-error': [422, 'That address answered with status {status}: there is no published site there. Check the address.'],
  'empty-page': [422, 'That page looks blank: there is nothing on it to import. Check the address.'],
  'not-a-site': [422, 'That address shows a page saying there is no site there. Check the address and that the site is published.'],
  'capture-too-large': [422, 'That page is too large to import.'],
  'timeout': [504, 'The site took too long to open. Try again in a minute.'],
  'busy': [503, 'The importer is busy with another site. Try again in a minute.'],
  'not-configured': [503, 'Importing from a link is not set up on this server yet. Ask the ETB2B team.'],
  'importer-down': [502, 'The importer could not be reached just now. Try again in a few minutes.'],
  'render-failed': [502, 'The site could not be opened for import. Try again in a minute.']
};

function failure(code, extra) {
  if (!WORDS[code]) code = 'render-failed';
  var status = extra && extra.httpStatus ? +extra.httpStatus : 0;
  var message = WORDS[code][1].replace('status {status}', status ? 'status ' + status : 'a fault');
  if (code === 'source-http-error' && status === 404) message = 'That address answered 404 (not found): there is no published site there. Check the address.';
  var err = new Error(message);
  err.status = WORDS[code][0];
  err.code = code;
  if (status) err.httpStatus = status;
  return err;
}

/* An answer of the capture service other than 200. Its own words are never passed on: they are for its log. */
function fromScraper(status, body) {
  var code = body && typeof body.code === 'string' ? body.code : '';
  if (code === 'unauthorized' || status === 401 || status === 403) {
    console.error('import-lovable: the capture service refused this server (' + status + ') — LOVABLE_SCRAPER_SECRET and its SCRAPER_SECRET differ');
    return failure('not-configured');
  }
  if (code === 'not-configured') {
    console.error('import-lovable: the capture service has no SCRAPER_SECRET set');
    return failure('not-configured');
  }
  if (code === 'busy' || status === 429) return failure('busy');
  if (code === 'timeout' || status === 504) return failure('timeout');
  if (code === 'source-http-error') return failure(code, { httpStatus: body && body.httpStatus });
  if (WORDS[code] && code !== 'not-configured') return failure(code);
  if (code === 'too-large' || code === 'bad-request') {
    console.error('import-lovable: the capture service refused the request (' + code + ')');
    return failure('render-failed');
  }
  /* an older deployment: 400 with a sentence of its own for an address it would not open */
  if (status === 400) return failure('refused');
  console.error('import-lovable: the capture service answered ' + status + (code ? ' ' + code : ''));
  return failure('render-failed');
}

function fromNetwork(err) {
  console.error('import-lovable: the capture service could not be reached — ' + (err && err.message));
  return failure('importer-down');
}

/* ---------- is it a page at all ---------- */

var NOT_A_SITE = /no lovable project found|project not found|site not found|page not found|this site can.?t be reached|deployment (?:not found|has failed|failed)|404[\s:.—-]+not found|there.?s nothing here|domain is not configured/i;
var CONTENT_TAGS = /<(?:img|svg|video|picture|canvas|h[1-6]|p|li)\b/gi;

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, e) {
    if (e.charAt(0) === '#') {
      var n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
    }
    var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return Object.prototype.hasOwnProperty.call(named, e.toLowerCase()) ? named[e.toLowerCase()] : ' ';
  });
}

/* What a person would see as text, roughly: tags, comments and what styles, scripts, templates and hidden parts
   hold are not text. */
function measure(html) {
  var s = String(html == null ? '' : html);
  var content = (s.match(CONTENT_TAGS) || []).length;
  var text = s.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text).replace(/\s+/g, ' ').trim();
  return { text: text.length, content: content, sample: text.slice(0, 600) };
}

function verdictOf(m) {
  if (m.text < 600 && m.content < 12 && NOT_A_SITE.test(m.sample)) return 'not-a-site';
  if (m.text < 200 && m.content < 3) return 'empty-page';
  return '';
}
function verdict(html) { return verdictOf(measure(html)); }

/* hosts: host names, or origins/addresses to take the host of */
function hostOf(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : 'http://' + s).hostname.replace(/\.$/, ''); } catch (e) { return ''; }
}
function ownHost(url, hosts) {
  var h = hostOf(url);
  if (!h) return false;
  return (hosts || []).some(function (x) { var o = hostOf(x); return o && o === h; });
}

module.exports = { failure: failure, fromScraper: fromScraper, fromNetwork: fromNetwork, measure: measure, verdict: verdict,
  verdictOf: verdictOf, ownHost: ownHost, NOT_A_SITE: NOT_A_SITE, WORDS: WORDS };
