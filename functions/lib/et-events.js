/* ET's own events on one B2B portal, for Create Event's previous-edition picker — read from ET's public
   event API (the same host et-previous.js reads an edition's records from), asked with the portal as a
   header:
     /v1/event-listing?page=N   -> { status, data: { active: [row], upcoming: [row],
                                     past: { items: [row], total_cnt, total_pages, cur_page, is_last_page } } }
   Active and upcoming events come whole on page 1; past ones come ten to a page. Only ET's own IP events
   are kept (ownership_type 1; 2 is a partner's or a client's event, which is never an edition of ours).
   Awards are a separate listing of the same shape, /v1/award-listing (the social post app reads it too).
   An award row has two ids that are NOT interchangeable: entity_id is the award, event_id the microsite
   that holds its content. et-previous.js reads an edition's records by the microsite id, so an AWARD's
   id here is its event_id (and entity_id is kept as awardId); a row with no microsite is left out.

     PORTALS                         { slug: name }  the portal roster (promo.js signs mailers off with it)
     portalList()                    -> [{ slug, name }] by name
     isPortal(slug)                  -> true for a slug on the roster, and nothing else
     compact(row, past)              -> EVENT (below) | null
     compactAward(row, past)         -> EVENT with kind 'award' and awardId | null
     fetchIpEvents(portal, fetchJson) -> Promise<[EVENT]>   no cache: every page, every time
     fetchAwards(portal, fetchJson)  -> Promise<[EVENT]>   the portal's awards, likewise
     listIpEvents(portal, fetchJson, o) -> Promise<[EVENT]> the same through a cache (6 hours a portal);
                                     callers asking while a read is under way share it. o.now() for tests.
     listAwards(portal, fetchJson, o) -> Promise<[EVENT]>  the awards through the same kind of cache
     listUpcoming(portal, fetchJson, o) -> Promise<[EVENT]> what is on now or coming (not past), from page 1
                                     alone (active and upcoming come whole on it) — one request, kept 6 hours;
                                     the whole list's entry is used instead while it is fresh. For the ET
                                     footer's "What's Happening" (et-footer.js). o.now() for tests.
     clearCache()

   EVENT = { id, kind: 'event' | 'award', title, start, end, dateLabel, link, logo, speakers, past, upcoming }
           (an award also carries awardId)
   fetchJson(url, headers) -> Promise<json>; it may reject, or resolve null, for a bad answer.
   A portal not on the roster is refused (error.code 'unknown-portal') before anything is asked of ET, so
   no caller's text ever reaches the header or the address. ET's API not answering is error.code 'et-down'.
   A failed read is never kept: the next caller asks again. */

var API = 'https://api.economictimes.indiatimes.com';
var TTL_MS = 6 * 60 * 60 * 1000;
/* a list missing a page that would not come (asked twice) is kept only briefly, so it is soon read whole */
var PARTIAL_TTL_MS = 5 * 60 * 1000;
var CONCURRENCY = 6;
var MAX_PAGES = 120; // 1,200 past events: well beyond any portal's

/* ---------- the portal roster ----------
   The promotional platform's: names as ET's own sends sign off (templates/_shared/img/portals holds each
   one's wordmark, <slug>.png dark-ink and <slug>-light.png light-ink). */
var PORTALS = {
  brandequity: 'ET BrandEquity',
  cio: 'ETCIO',
  ciso: 'ETCISO',
  infra: 'ET Infra',
  cfo: 'ETCFO',
  hr: 'ETHRWorld',
  retail: 'ETRetail',
  health: 'ETHealthworld',
  auto: 'ETAuto',
  telecom: 'ETTelecom',
  bfsi: 'ETBFSI',
  energy: 'ETEnergyworld',
  government: 'ETGovernment',
  legal: 'ETLegalWorld',
  realty: 'ETRealty',
  education: 'ET Education',
  manufacturing: 'ET Manufacturing',
  supplychain: 'ET Supply Chain',
  travel: 'ETTravelWorld',
  hospitality: 'ET HospitalityWorld',
  b2b: 'ET B2B',
  masterclass: 'ET Masterclass',
  hrsea: 'ETHRWorld Southeast Asia',
  hrme: 'ETHRWorld Middle East',
  ciosea: 'ETCIO Southeast Asia',
  ciome: 'ETCIO Middle East',
  pharma: 'ETPharma',
  gcc: 'ET GCC',
  enterpriseai: 'ET EnterpriseAI',
  techmonk: 'TechMonk',
  entrepreneur: 'ET Entrepreneur',
  datacenters: 'ET Data Centers',
  electronics: 'ET Electronics',
  energymea: 'ET EnergyWorld MEA',
  sustainability: 'ET Sustainability',
  workplace: 'ET Workplace',
  agriculture: 'ET Agriculture',
  chemicals: 'ET Chemicals',
  climate: 'ET Climate',
  construction: 'ET Construction',
  crypto: 'ET Crypto',
  defence: 'ET Defence',
  drones: 'ET Drones',
  facilities: 'ET Facilities',
  food: 'ET Food',
  geospatial: 'ET Geospatial',
  jewellery: 'ET Jewellery',
  machinetools: 'ET MachineTools',
  packaging: 'ET Packaging',
  rajasthan: 'ET Rajasthan',
  safety: 'ET Safety',
  salon: 'ET Salon',
  shipping: 'ET Shipping',
  sports: 'ET Sports',
  startup: 'ET Startup',
  textile: 'ETTextile',
  wastemanagement: 'ET Waste Management'
};

function isPortal(slug) { return typeof slug === 'string' && Object.prototype.hasOwnProperty.call(PORTALS, slug); }
function portalList() {
  return Object.keys(PORTALS).map(function (slug) { return { slug: slug, name: PORTALS[slug] }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }); });
}

function str(v) { return v == null ? '' : String(v); }
function text(v) {
  return str(v).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, '’')
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function https(u) {
  var s = str(u).trim();
  if (/^http:\/\//i.test(s)) s = 'https://' + s.slice(7);
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}
function stamp(v) { var s = str(v).trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) && !/^0000/.test(s) ? s.slice(0, 19) : ''; } // ET writes 0000-00-00 for no date

/* one listing row -> EVENT, or null when it is not one of ET's own events (or has no id or title) */
function compact(row, past) {
  if (!row || typeof row !== 'object' || str(row.ownership_type).trim() !== '1') return null;
  var id = str(row.entity_id).trim(), title = text(row.title).slice(0, 200);
  if (!/^\d{1,9}$/.test(id) || !title) return null;
  return {
    id: id, kind: 'event', title: title, start: stamp(row.event_start_date), end: stamp(row.event_end_date),
    dateLabel: text(row.date_str || row.date_time).slice(0, 60), link: https(row.link), logo: https(row.small_logo),
    speakers: Math.max(0, parseInt(row.speakers_cnt, 10) || 0),
    past: !!past || +row.is_past === 1, upcoming: !past && +row.is_upcoming === 1
  };
}

/* one award-listing row -> EVENT (kind 'award'), or null when it has no microsite, award id or title.
   Its id is the MICROSITE's (event_id): microsite/details?digital_month_id=<entity_id> answers with an
   unrelated event, as the two id spaces overlap. An award row has no start date of its own: its ceremony
   (complete_date, else date_unix) stands for it. */
function compactAward(row, past) {
  if (!row || typeof row !== 'object') return null;
  var id = str(row.event_id).trim(), awardId = str(row.entity_id).trim(), title = text(row.title).slice(0, 200);
  if (!/^\d{1,9}$/.test(id) || !+id || !/^\d{1,9}$/.test(awardId) || !title) return null;
  var when = stamp(row.complete_date), unix = parseInt(row.date_unix, 10);
  if (!when && unix > 0) when = new Date(unix * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return {
    id: id, kind: 'award', awardId: awardId, title: title, start: when, end: when,
    dateLabel: text(row.date_str || row.date_time).slice(0, 60), link: https(row.link), logo: https(row.small_logo || row.medium_logo),
    speakers: 0, past: !!past || +row.is_past === 1, upcoming: !past && +row.is_upcoming === 1
  };
}

function etDown(why) { var e = new Error('ET\'s event list could not be read right now (' + why + ').'); e.code = 'et-down'; return e; }

/* the two listings: which address, and how a row becomes an EVENT */
var LISTINGS = {
  event: { path: '/v1/event-listing', compact: compact, none: 'events' },
  award: { path: '/v1/award-listing', compact: compactAward, none: 'awards' }
};

/* -> Promise<[EVENT]> (with .partial = true when a past page would not come, even asked twice) */
function fetchIpEvents(portal, fetchJson) { return fetchListing('event', portal, fetchJson); }
function fetchAwards(portal, fetchJson) { return fetchListing('award', portal, fetchJson); }
function fetchListing(kind, portal, fetchJson) {
  var L = LISTINGS[kind], compact = L.compact;
  if (!isPortal(portal)) { var bad = new Error('Unknown portal.'); bad.code = 'unknown-portal'; return Promise.reject(bad); }
  if (typeof fetchJson !== 'function') return Promise.reject(new Error('fetchJson is required.'));
  function page(n) {
    return Promise.resolve().then(function () { return fetchJson(API + L.path + '?page=' + n, { portal: portal, accept: 'application/json' }); })
      .then(function (j) { if (!j || j.status === false || !j.data || typeof j.data !== 'object') throw etDown('page ' + n + ' had no ' + L.none); return j.data; });
  }
  function again(n) { return page(n).then(null, function () { return page(n); }); }

  return page(1).then(null, function (err) { throw err && err.code === 'et-down' ? err : etDown(err && err.message || 'no answer'); }).then(function (first) {
    var rows = [], partial = false;
    (Array.isArray(first.active) ? first.active : []).concat(Array.isArray(first.upcoming) ? first.upcoming : [])
      .forEach(function (r) { rows.push(compact(r, false)); });
    var past = first.past && typeof first.past === 'object' ? first.past : {};
    (Array.isArray(past.items) ? past.items : []).forEach(function (r) { rows.push(compact(r, true)); });
    var pages = Math.min(MAX_PAGES, Math.max(1, parseInt(past.total_pages, 10) || 1));
    var todo = [];
    if (!past.is_last_page) for (var n = 2; n <= pages; n++) todo.push(n);

    /* the remaining past pages, a few at a time */
    var next = 0;
    function worker() {
      if (next >= todo.length) return Promise.resolve();
      var n = todo[next++];
      return again(n).then(function (d) {
        var items = d.past && Array.isArray(d.past.items) ? d.past.items : [];
        items.forEach(function (r) { rows.push(compact(r, true)); });
      }, function () { partial = true; }).then(worker);
    }
    var workers = [];
    for (var w = 0; w < Math.min(CONCURRENCY, todo.length); w++) workers.push(worker());
    return Promise.all(workers).then(function () {
      var seen = {}, out = [];
      rows.forEach(function (e) {
        if (!e || seen[e.id]) return;
        seen[e.id] = 1; out.push(e);
      });
      /* what is coming (or on now) first, then the past; newest first within each */
      out.sort(function (a, b) {
        if (a.past !== b.past) return a.past ? 1 : -1;
        return a.start < b.start ? 1 : a.start > b.start ? -1 : (+b.id) - (+a.id);
      });
      if (partial) out.partial = true;
      return out;
    });
  });
}

/* ---------- the cache: one entry a portal ---------- */
var cache = {}; // portal -> { at, ttl, events } | { pending: Promise }
var soonCache = {}; // portal -> { at, events } | { pending: Promise }   (listUpcoming)
function clearCache() { cache = {}; soonCache = {}; }

function listIpEvents(portal, fetchJson, o) { return listCached('event', portal, fetchJson, o); }
/* awards are kept apart from the events (their own key), so the footer's upcoming list never sees one */
function listAwards(portal, fetchJson, o) { return listCached('award', portal, fetchJson, o); }
function listCached(kind, portal, fetchJson, o) {
  o = o || {};
  var now = typeof o.now === 'function' ? o.now : Date.now;
  if (!isPortal(portal)) return fetchListing(kind, portal, fetchJson);
  var key = kind === 'event' ? portal : kind + ':' + portal;
  var hit = cache[key];
  if (hit && hit.pending) return hit.pending;
  if (hit && hit.events && now() - hit.at < hit.ttl) return Promise.resolve(hit.events);
  var pending = fetchListing(kind, portal, fetchJson).then(function (events) {
    cache[key] = { at: now(), ttl: events.partial ? PARTIAL_TTL_MS : TTL_MS, events: events };
    return events;
  }, function (err) {
    /* a failed read leaves nothing behind (an older list it would have replaced goes too: it was stale) */
    if (cache[key] && cache[key].pending === pending) delete cache[key];
    throw err;
  });
  cache[key] = { pending: pending };
  return pending;
}

/* What is on now or coming, from the listing's first page only: the footer of every site of a portal shows it,
   and reading all of a portal's past pages for it (thirty for ET BrandEquity) would be wasted. */
function listUpcoming(portal, fetchJson, o) {
  o = o || {};
  var now = typeof o.now === 'function' ? o.now : Date.now;
  if (!isPortal(portal)) { var bad = new Error('Unknown portal.'); bad.code = 'unknown-portal'; return Promise.reject(bad); }
  if (typeof fetchJson !== 'function') return Promise.reject(new Error('fetchJson is required.'));
  function coming(list) { return list.filter(function (e) { return !e.past; }); }
  var whole = cache[portal];
  if (whole && whole.events && now() - whole.at < whole.ttl) return Promise.resolve(coming(whole.events));
  var hit = soonCache[portal];
  if (hit && hit.pending) return hit.pending;
  if (hit && hit.events && now() - hit.at < TTL_MS) return Promise.resolve(hit.events);
  var pending = Promise.resolve().then(function () { return fetchJson(API + '/v1/event-listing?page=1', { portal: portal, accept: 'application/json' }); })
    .then(function (j) {
      if (!j || j.status === false || !j.data || typeof j.data !== 'object') throw etDown('page 1 had no events');
      var d = j.data, seen = {}, out = [];
      (Array.isArray(d.active) ? d.active : []).concat(Array.isArray(d.upcoming) ? d.upcoming : []).forEach(function (r) {
        var e = compact(r, false);
        if (e && !e.past && !seen[e.id]) { seen[e.id] = 1; out.push(e); }
      });
      soonCache[portal] = { at: now(), events: out };
      return out;
    }, function (err) { throw err && err.code === 'et-down' ? err : etDown(err && err.message || 'no answer'); })
    .then(null, function (err) {
      if (soonCache[portal] && soonCache[portal].pending === pending) delete soonCache[portal];
      throw err;
    });
  soonCache[portal] = { pending: pending };
  return pending;
}

module.exports = { PORTALS, portalList, isPortal, compact, compactAward, fetchIpEvents, fetchAwards, listIpEvents, listAwards, listUpcoming, clearCache, API, TTL_MS, PARTIAL_TTL_MS };
