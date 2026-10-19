/* What search engines and link previews read off a published event site, beyond the title, description, sharing
   tags and canonical link the publish transform writes (lib/api.js publishTransform, step 3):

     eventJsonLd(event, o)   -> the schema.org Event for the page (JSON-LD), or null when the event has no exact
                                start date (a "date to be announced" event is not an Event a search engine can list)
        o = { name, description, url, images: [absolute urls], organizer: { name, url } | null }
     robotsTxt(base)         -> /robots.txt: published sites (/e/) and what they load may be crawled; previews, the
                                API and the CMS itself may not; the sitemap is named
     sitemapXml(entries)     -> /sitemap.xml of published sites. entries: [{ loc, lastmod }]

   Dates are stored as the owner typed them, without a time zone ("2026-12-05T10:41"): ET's events are held in
   India, so they are written with +05:30 (EVENT_TZ). */
var EVENT_TZ = '+05:30';
var ET = { name: 'The Economic Times', url: 'https://economictimes.indiatimes.com' };

function str(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''; }

/* "2026-12-05T10:41" -> "2026-12-05T10:41:00+05:30"; "2026-12-05" stays a date; anything else -> '' */
function isoDate(v) {
  var s = str(v), m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return valid(+m[1], +m[2], +m[3]) ? s : '';
  if ((m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s))) {
    if (!valid(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59) return '';
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + EVENT_TZ;
  }
  return '';
}
function valid(y, mo, d) { return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31; }

function eventJsonLd(event, o) {
  event = event || {}; o = o || {};
  var mode = str(event.dateMode);
  if (mode && mode !== 'exact') return null;
  var start = isoDate(event.start);
  var name = str(o.name) || str(event.name);
  if (!start || !name) return null;
  var end = isoDate(event.end);
  if (end && end.slice(0, 16) < start.slice(0, 16)) end = '';
  var ld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: name,
    startDate: start
  };
  if (end) ld.endDate = end;
  ld.eventStatus = 'https://schema.org/EventScheduled';
  var venue = str(event.venue), city = str(event.city), where = str(event.location);
  if (venue || city || where) {
    ld.eventAttendanceMode = 'https://schema.org/OfflineEventAttendanceMode';
    var place = { '@type': 'Place', name: venue || where || city };
    if (city || where) place.address = city ? { '@type': 'PostalAddress', addressLocality: city } : where;
    ld.location = place;
  }
  var description = str(o.description);
  if (description) ld.description = description.slice(0, 500);
  var images = (o.images || []).filter(function (u) { return /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')); });
  if (images.length) ld.image = images;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(String(o.url || ''))) ld.url = o.url;
  var org = o.organizer && str(o.organizer.name) ? o.organizer : ET;
  ld.organizer = { '@type': 'Organization', name: str(org.name) };
  if (/^https:\/\/[^\s"'<>]+$/i.test(String(org.url || ''))) ld.organizer.url = org.url;
  return ld;
}

/* JSON inside <script>: "<" never appears (a "</script" in a name would end the block), nor U+2028/2029 */
function scriptJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, function (c) { return c === '\u2028' ? '\\u2028' : '\\u2029'; });
}

function robotsTxt(base) {
  var lines = [
    '# Revamp CMS: published event sites are public; previews, the API and the CMS itself are not.',
    'User-agent: *',
    'Allow: /e/',
    /* what a published site loads, so a crawler that draws the page sees it as a visitor does */
    'Allow: /templates/',
    'Allow: /assets/',
    'Allow: /editor-fill.js',
    'Allow: /api/public/',
    'Allow: /favicon.ico',
    'Disallow: /preview/',
    'Disallow: /api/',
    'Disallow: /'
  ];
  if (/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(String(base || ''))) lines.push('', 'Sitemap: ' + base + '/sitemap.xml');
  return lines.join('\n') + '\n';
}

function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function sitemapXml(entries) {
  var body = (entries || []).filter(function (e) { return e && /^https?:\/\/[^\s"'<>]+$/i.test(String(e.loc || '')); }).map(function (e) {
    var lastmod = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(String(e.lastmod || '')) ? '<lastmod>' + e.lastmod.replace(/\.\d+Z$/, 'Z') + '</lastmod>' : '';
    return '<url><loc>' + xmlEsc(e.loc) + '</loc>' + lastmod + '</url>';
  }).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + (body ? '\n' : '') + '</urlset>\n';
}

module.exports = { eventJsonLd: eventJsonLd, robotsTxt: robotsTxt, sitemapXml: sitemapXml, scriptJson: scriptJson, isoDate: isoDate, EVENT_TZ: EVENT_TZ, ET: ET };
