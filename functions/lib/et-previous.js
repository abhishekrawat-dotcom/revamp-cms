/* A previous edition of an ET event, read from ET's own event platform — its speakers, sponsors, agenda and
   glimpses (photos), so a new edition's site can show them under "Previous Edition …" headings.

   An ET microsite lives at <portal>.economictimes.indiatimes.com/<slug>. Its page names its id
   (digital_month_id, often beside other ids — a registration form's, a sister event's); ET's public event
   API, asked with the portal as a header, gives that event's records:
     /v1/microsite/details?digital_month_id=<id>                     name, dates, venue, discussion points…
     /v1/activity/speaker|sponsor|agenda/list?entity_id=<id>&activity=microsite&page=&per_page=
   The glimpses are not in the API: they are the gallery photos the page itself lists (…/glimpses_….webp).
   Of the ids a page names, the one used is the one whose records are really there.

     portalOf(url)               -> 'enterpriseai' | '' (only an ET microsite)
     idsIn(html)                 -> ['3858', '4865']   by how often the page names them
     glimpsesIn(html)            -> [url]              the page's gallery photos
     normalise(raw)              -> PREVIOUS (below), from { details, speakers, sponsors, agenda, glimpses }
     readPrevious(url, html, o)  -> Promise<PREVIOUS | null>   o: { fetchJson(url, headers) } for tests

   PREVIOUS = { portal, id, name, url, start, end, venue,
                speakers: [{ name, designation, company, photo, group }],
                sponsors: [{ name, logo, tier, url }],
                agenda:   [{ title, start, end, speakers: [name], description }],
                glimpses: [url] }
   Nothing is invented: a list the edition has nothing for is empty. */

var API = 'https://api.economictimes.indiatimes.com';
var IMG = 'https://img.etb2bimg.com/files/';
var MAX = { speakers: 60, sponsors: 60, agenda: 80, glimpses: 24 };

function str(v) { return v == null ? '' : String(v); }
function text(v) {
  return str(v).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, '’')
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function picture(path, sponsor) {
  var p = str(path).trim();
  if (!p) return '';
  if (/^https:\/\//i.test(p)) return p;
  if (/^http:\/\//i.test(p)) return 'https://' + p.slice(7);
  return IMG + (sponsor ? 'retail_files/' : '') + p.replace(/^\/+/, '');
}

function portalOf(url) {
  var m = /^https?:\/\/([a-z0-9-]+)\.economictimes\.indiatimes\.com(?:[\/:?#]|$)/i.exec(str(url));
  return m && !/^(www|m|api|img)$/i.test(m[1]) ? m[1].toLowerCase() : '';
}

function idsIn(html) {
  var count = {}, re = /digital_month_id["']?\s*[:=]\s*["']?(\d{2,7})/g, m;
  while ((m = re.exec(str(html)))) count[m[1]] = (count[m[1]] || 0) + 1;
  return Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
}

function glimpsesIn(html) {
  var seen = {}, out = [], re = /https?:\/\/img\.etb2bimg\.com\/files\/[^"'\s)<>]*glimpses_[^"'\s)<>]+\.(?:webp|jpe?g|png)/gi, m;
  while ((m = re.exec(str(html)))) {
    var u = m[0].replace(/^http:/i, 'https:');
    if (!seen[u]) { seen[u] = 1; out.push(u); }
  }
  return out.slice(0, MAX.glimpses);
}

function byWeight(a, b) { return (a.w || 0) - (b.w || 0); }
function normalise(raw) {
  raw = raw || {};
  var d = raw.details || {};
  var speakers = (raw.speakers || []).filter(function (s) { return s && text(s.speaker_name); }).map(function (s) {
    return { name: text(s.speaker_name), designation: text(s.speaker_desig), company: text(s.speaker_company),
      photo: picture(s.speaker_picture), group: s.group && s.group.group_name ? text(s.group.group_name) : '', w: +(s.speaker_weightage || s.weightage || 0) };
  }).sort(byWeight).slice(0, MAX.speakers).map(function (s) { delete s.w; return s; });
  var sponsors = (raw.sponsors || []).filter(function (s) { return s && (s.sponsor_logo || s.sponsor_log_png); }).map(function (s) {
    return { name: text(s.sponsor_title), logo: picture(s.sponsor_logo || s.sponsor_log_png, true),
      tier: s.group && s.group.group_name ? text(s.group.group_name) : 'Partner', url: /^https?:\/\//i.test(str(s.url)) ? str(s.url) : '', w: +(s.weightage || 0) };
  }).sort(byWeight).slice(0, MAX.sponsors).map(function (s) { delete s.w; return s; });
  var agenda = (raw.agenda || []).filter(function (a) { return a && text(a.agenda_title); }).map(function (a) {
    return { title: text(a.agenda_title), start: str(a.agenda_start_datetime), end: str(a.agenda_end_datetime),
      description: text(a.agenda_description).slice(0, 400),
      speakers: (Array.isArray(a.speakers) ? a.speakers : []).map(function (s) { return text(s.speaker_name); }).filter(Boolean) };
  }).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; }).slice(0, MAX.agenda);
  return {
    portal: str(raw.portal), id: str(raw.id), url: str(raw.url),
    name: text(d.company_name).replace(/\s+Edition\s+\d+$/i, ''),
    start: str(d.event_start_date), end: str(d.event_end_date), venue: text(d.event_venue || d.location),
    speakers: speakers, sponsors: sponsors, agenda: agenda, glimpses: (raw.glimpses || []).slice(0, MAX.glimpses)
  };
}

/* every page of one list (500 to a page; an edition never has more than a few pages) */
function allItems(fetchJson, path, id, portal) {
  var out = [];
  function page(n) {
    return fetchJson(API + path + '?entity_id=' + encodeURIComponent(id) + '&activity=microsite&page=' + n + '&per_page=500', { portal: portal }).then(function (j) {
      var d = j && j.status !== false && j.data ? j.data : null;
      if (!d) return out;
      out = out.concat(Array.isArray(d.items) ? d.items : []);
      return d.is_last_page || n >= (d.total_pages || 1) || n >= 4 ? out : page(n + 1);
    });
  }
  return page(1).then(null, function () { return out; });
}

/* -> Promise<PREVIOUS | null>. fetchJson(url, headers) -> Promise<json>, never throwing for a bad answer */
function readPrevious(url, html, o) {
  o = o || {};
  /* o.portal / o.id: an edition picked from ET's own list (et-events.js, checked by the caller) — neither is guessed */
  var portal = o.portal || portalOf(url), ids = o.id ? [String(o.id)] : idsIn(html).slice(0, 4);
  if (!portal || !ids.length || typeof o.fetchJson !== 'function') return Promise.resolve(null);
  var fetchJson = o.fetchJson;
  /* each id the page names, as the API knows it: the edition is the one with records */
  return Promise.all(ids.map(function (id) {
    return Promise.all([allItems(fetchJson, '/v1/activity/speaker/list', id, portal), allItems(fetchJson, '/v1/activity/sponsor/list', id, portal)])
      .then(function (r) { return { id: id, speakers: r[0], sponsors: r[1], weight: r[0].length + r[1].length }; });
  })).then(function (found) {
    var best = found.filter(function (f) { return f.weight > 0; }).sort(function (a, b) { return b.weight - a.weight; })[0];
    var glimpses = glimpsesIn(html);
    if (!best && !glimpses.length) return null;
    var id = best ? best.id : ids[0];
    return Promise.all([
      fetchJson(API + '/v1/microsite/details?digital_month_id=' + encodeURIComponent(id), { portal: portal }).then(function (j) { return j && j.data && j.status !== false ? j.data : {}; }, function () { return {}; }),
      allItems(fetchJson, '/v1/activity/agenda/list', id, portal)
    ]).then(function (r) {
      var p = normalise({ portal: portal, id: id, url: url, details: r[0], speakers: best ? best.speakers : [], sponsors: best ? best.sponsors : [], agenda: r[1], glimpses: glimpses });
      return p.speakers.length || p.sponsors.length || p.agenda.length || p.glimpses.length ? p : null;
    });
  }).then(null, function () { return null; });
}

module.exports = { portalOf, idsIn, glimpsesIn, normalise, readPrevious, API };
