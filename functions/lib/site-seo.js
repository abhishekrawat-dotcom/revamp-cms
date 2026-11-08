/* What search engines and link previews read off a published event site, beyond the title, description, sharing
   tags and canonical link the publish transform writes (lib/api.js publishTransform, step 3):

     eventJsonLd(event, o)   -> the schema.org Event for the page (JSON-LD), or null when the event has no exact
                                start date (a "date to be announced" event is not an Event a search engine can list)
        o = { name, description, url, images: [absolute urls], organizer: { name, url } | null }
     robotsTxt(base)         -> /robots.txt: published sites (/e/) and what they load may be crawled; previews, the
                                API and the CMS itself may not; the sitemap is named
     sitemapXml(entries)     -> /sitemap.xml of published sites. entries: [{ loc, lastmod }]
     shareDescription(text)  -> the page's description for search results and link previews: at most 160
                                characters, cut at a word with "…" (never "…with governe")
     calendarIcs(event, o)   -> an .ics file of the event (GET /api/public/calendar, the registration form's "Add to
                                calendar"), or '' when it has no exact start date. o = { id, url, stamp: Date }

   Dates are stored as the owner typed them, without a time zone ("2026-12-05T10:41"): ET's events are held in
   India, so they are written with +05:30 (EVENT_TZ). The wizard's and the console's date fields used to make up a
   time when only a date was picked (the minute the form was filled in: "10:41", "00:06"), and the site never
   shows one: a time is published only when it looks chosen (chosenTime), else the date alone. */
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
/* a time an owner picked is on the quarter hour (9:30, 18:00); midnight and any other minute (10:41, 00:06) is one
   the date field filled in by itself, so the event is published by its date alone */
function chosenTime(v) {
  var m = /T(\d{2}):(\d{2})/.exec(str(v));
  return !!m && +m[2] % 15 === 0 && !(+m[1] === 0 && +m[2] === 0);
}
/* the date (and time, when chosen) a search engine is given: "2026-12-05" or "2026-12-05T09:30:00+05:30" */
function eventDate(v, timed) {
  var full = isoDate(v);
  return full && !timed ? full.slice(0, 10) : full;
}

function eventJsonLd(event, o) {
  event = event || {}; o = o || {};
  var mode = str(event.dateMode);
  if (mode && mode !== 'exact') return null;
  var timed = chosenTime(event.start);
  var start = eventDate(event.start, timed);
  var name = str(o.name) || str(event.name);
  if (!start || !name) return null;
  var end = eventDate(event.end, timed && chosenTime(event.end));
  if (end && (end.length > 10 && start.length > 10 ? end.slice(0, 16) < start.slice(0, 16) : end.slice(0, 10) < start.slice(0, 10))) end = '';
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
  var description = shareDescription(o.description, 500);
  if (description) ld.description = description;
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
    '# ETB2B EventSphere: published event sites are public; previews, the API and the CMS itself are not.',
    'User-agent: *',
    'Allow: /e/',
    /* what a published site loads, so a crawler that draws the page sees it as a visitor does */
    'Allow: /templates/',
    'Allow: /assets/',
    'Allow: /editor-fill.js',
    'Allow: /api/public/',
    'Allow: /favicon.ico',
    'Disallow: /preview/',
    /* a shareable preview link (lib/share-preview.js): noindex already, and the final Disallow: / covers it too */
    'Disallow: /s/',
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

/* The description a search result and a shared link show: Google shows about 155–160 characters, and a
   description cut at a fixed length ended mid-word ("…with governe"). A longer one is cut at the last word that
   fits, with "…"; one that fits is as it was (so cutting again changes nothing). */
var DESCRIPTION_MAX = 160;
function shareDescription(text, max) {
  max = max > 20 ? max : DESCRIPTION_MAX;
  var s = str(text);
  if (s.length <= max) return s;
  var cut = s.slice(0, max - 1), space = cut.lastIndexOf(' ');
  /* one long word (an address) is cut where it must be */
  if (space > max * 0.6) cut = cut.slice(0, space);
  return cut.replace(/[\s,;:.\-\u2013\u2014(\[]+$/, '') + '\u2026';
}

/* ---------- the event as a calendar entry (RFC 5545) ----------
   What "Add to calendar" opens after registering: the event's name, its dates (all day unless a time was
   chosen, as for search engines), its place and its site. A time is India time, written in UTC (no time-zone
   block needed); an all-day end is the day after the last one, as calendars count it. */
function icsText(v) {
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}
/* lines of at most 75 octets, continued with a space (a calendar app may refuse a longer one) */
function icsFold(line) {
  var out = [], cur = '', bytes = 0;
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i), b = Buffer.byteLength(ch, 'utf8');
    if (/[\ud800-\udbff]/.test(ch) && i + 1 < line.length) { ch += line.charAt(++i); b = Buffer.byteLength(ch, 'utf8'); }
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function icsStamp(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }
function utcOf(full) {
  /* "2026-12-05T09:30:00+05:30" -> 20261205T040000Z */
  var t = Date.parse(full);
  return isFinite(t) ? icsStamp(new Date(t)) : '';
}
function dayAfter(ymd) {
  var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + 1));
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
function calendarIcs(event, o) {
  event = event || {}; o = o || {};
  var mode = str(event.dateMode);
  if (mode && mode !== 'exact') return '';
  var timed = chosenTime(event.start);
  var start = eventDate(event.start, timed), name = str(event.name);
  if (!start || !name) return '';
  var end = eventDate(event.end, timed && chosenTime(event.end));
  if (end && end.slice(0, 10) < start.slice(0, 10)) end = '';
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ET B2B//ETB2B EventSphere//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT'];
  lines.push('UID:' + icsText(str(o.id) || name) + '@oneworld.etb2b');
  lines.push('DTSTAMP:' + icsStamp(o.stamp instanceof Date && isFinite(o.stamp.getTime()) ? o.stamp : new Date()));
  if (start.length > 10) {
    lines.push('DTSTART:' + utcOf(start));
    /* a chosen start with no chosen end: the calendar shows it as starting then, for an hour */
    lines.push('DTEND:' + (end.length > 10 && end > start ? utcOf(end) : icsStamp(new Date(Date.parse(start) + 3600000))));
  } else {
    lines.push('DTSTART;VALUE=DATE:' + start.replace(/-/g, ''));
    lines.push('DTEND;VALUE=DATE:' + dayAfter((end || start).slice(0, 10)));
  }
  lines.push('SUMMARY:' + icsText(name));
  var venue = str(event.venue), city = str(event.city);
  if (venue && city && venue.toLowerCase().indexOf(city.toLowerCase()) !== -1) city = '';
  var where = [venue, city].filter(Boolean).join(', ') || str(event.location);
  if (where) lines.push('LOCATION:' + icsText(where));
  if (/^https?:\/\/[^\s"'<>]+$/i.test(String(o.url || ''))) { lines.push('URL:' + o.url); lines.push('DESCRIPTION:' + icsText(o.url)); }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

module.exports = { eventJsonLd: eventJsonLd, robotsTxt: robotsTxt, sitemapXml: sitemapXml, scriptJson: scriptJson, isoDate: isoDate, chosenTime: chosenTime,
  shareDescription: shareDescription, DESCRIPTION_MAX: DESCRIPTION_MAX, calendarIcs: calendarIcs, EVENT_TZ: EVENT_TZ, ET: ET };
