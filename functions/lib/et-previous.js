/* A previous edition of an ET event, read from ET's own event platform — its speakers, sponsors, agenda and
   glimpses (photos), so a new edition's site can show them under "Previous Edition …" headings.

   An ET microsite lives at <portal>.economictimes.indiatimes.com/<slug>. ET's public event API, asked with
   the portal as a header, gives an edition's records by its id:
     /v1/microsite/details?digital_month_id=<id>                     name, dates, venue, its address (url_text, branding_url)…
     /v1/activity/speaker|sponsor|agenda|image/list?entity_id=<id>&activity=microsite&page=&per_page=
   (the image list is the edition's gallery: photos in named groups such as "Previous Edition Glimpses").

   Finding the id. Every ET page names its own id as `var siteId = '3391'` (and in its forms, as site_id); a
   page whose edition is still to come also names the edition before it, whose records it shows, as
   digital_month_id; and most pages name stray ids too — the template's menus, a registration form copied from
   another portal's event, a sister event on the same portal. So the page only gives candidates; the API
   says which is which:
     own       its url_text is the page's slug                                 (brand-world-summit-south2025)
     edition   the same event: its branding_url is this page, or its url_text
               is the slug with a year (agentic-ai-summit2026 for agentic-ai-summit)
     anything else — another portal's event, a sister event, a menu's id — is never used.
   Of the editions that have taken place (or carry no date), the page's own is used if it has records, else
   the latest one that has; an edition still to come never is — its speakers are not a previous edition's
   (an evergreen address such as /annual-conclave is often the next edition's, naming the last one's id).

   Glimpses. The edition's image list; when it has none, the photos the page shows: every picture inside its
   gallery sections (<section id="glimpses_event">, "glimpses_event_0", "glimpsesFromTheRoom"…, drawn as a
   marquee, a carousel or a justified grid, the address in href, src or data-original), and any
   …/glimpses_….webp the page names elsewhere.

     portalOf(url)               -> 'enterpriseai' | '' (only an ET microsite)
     slugOf(url)                 -> 'agentic-ai-summit'
     candidatesIn(html)          -> [{ id, from: ['siteId', 'digital_month_id'…], score }]   the page's own first
     idsIn(html)                 -> ['3858', '4865']   the candidates' ids, in that order
     glimpsesIn(html)            -> [url]              the page's gallery photos
     relationOf(details, url)    -> 'own' | 'edition' | ''
     normalise(raw)              -> PREVIOUS (below), from { details, speakers, sponsors, agenda, glimpses }
     readPrevious(url, html, o)  -> Promise<PREVIOUS | null>   o: { fetchJson(url, headers), now } for tests

   PREVIOUS = { portal, id, name, url, start, end, venue,
                speakers: [{ name, designation, company, photo, group, bio, linkedin, x, logo, sessions: [{ title, start, end }] }],
                sponsors: [{ name, logo, tier, url }],
                agenda:   [{ title, start, end, speakers: [name], description }],
                glimpses: [url] }
   Nothing is invented: a list the edition has nothing for is empty, and a speaker's field ET has nothing for
   is '' (or [] for sessions).

   A speaker, as ET's speaker list gives it (asked in October 2026: 2,095 speakers of 72 past editions on 12 portals):
     speaker_name, speaker_desig, speaker_company, speaker_picture (cp/…)   nearly always
     company_logo      the company's logo, a file under cp/                   nearly always
     linkedin_url      about one speaker in seven, written any way (with or without https://, www., a space)
     speaker_info      the speaker's own text: almost never filled (2 of 2,095)
     twitter_url, speaker_specialization, speaker_thumb                    never filled
     speaker_email, speaker_phone                                          private: never read
     status            0 is a speaker the edition's own page does not show: left out here too
   The agenda's sessions name their speakers by the same id; a speaker's sessions come from there. */

var API = 'https://api.economictimes.indiatimes.com';
var IMG = 'https://img.etb2bimg.com/files/';
var MAX = { speakers: 60, sponsors: 60, agenda: 80, glimpses: 24, candidates: 6, related: 4 };

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
/* the microsite's own segment of its address: /agentic-ai-summit, /microsite/test, /annual-conclave/agenda */
function slugOf(url) {
  var m = /^https?:\/\/[^\/?#]+\/([^?#]*)/i.exec(str(url));
  var parts = (m ? m[1] : '').split('/').filter(Boolean);
  if (parts[0] && parts[0].toLowerCase() === 'microsite') parts.shift();
  try { return decodeURIComponent(parts[0] || '').toLowerCase(); } catch (e) { return (parts[0] || '').toLowerCase(); }
}
/* an event's name across its editions: the slug without a closing year (annual-conclave-2026 -> annual-conclave) */
function seriesOf(slug) { return str(slug).toLowerCase().replace(/[-_]?(?:19|20)\d{2}$/, '').replace(/[-_]+$/, ''); }

/* Where a page names an id, and how much each place says it is the page's own. siteId is set by the page
   for itself; digital_month_id is the edition whose records it shows; entity_id and company_id are used by
   every widget on the page — its own, and those copied from other events. A page drawn by the rendering
   service has its scripts taken out, and with them most of these. */
var ID_PLACES = [
  { from: 'siteId', score: 100, re: /\bsiteId\s*=\s*["']?(\d{2,7})\b/g },
  { from: 'siteId', score: 100, re: /name=(?:\\u0022|\\"|["'])siteId(?:\\u0022|\\"|["'])[^<>]{0,120}?value=(?:\\u0022|\\"|["'])(\d{2,7})/g },
  { from: 'site_id', score: 40, re: /["']?\bsite_id["']?\s*[:=]\s*["']?(\d{2,7})\b/g },
  { from: 'digital_month_id', score: 20, re: /\bdigital_month_id["']?\s*[:=]\s*["']?(\d{2,7})\b/g },
  { from: 'entity_id', score: 4, re: /["']?\bentity_id["']?\s*[:=]\s*["']?(\d{2,7})\b/g },
  { from: 'company_id', score: 4, re: /["']?\bcompany_id["']?\s*[:=]\s*["']?(\d{2,7})\b/g }
];
function candidatesIn(html) {
  var h = str(html), by = {}, order = [];
  ID_PLACES.forEach(function (p) {
    var re = new RegExp(p.re.source, 'g'), m;
    while ((m = re.exec(h))) {
      var c = by[m[1]];
      if (!c) { c = by[m[1]] = { id: m[1], from: [], score: 0 }; order.push(c); }
      if (c.from.indexOf(p.from) === -1) c.from.push(p.from);
      c.score += p.score;
    }
  });
  return order.sort(function (a, b) { return b.score - a.score; });
}
function idsIn(html) { return candidatesIn(html).map(function (c) { return c.id; }); }

/* What an edition (its details from the API) is to the page at url: its own, an edition of the same event, or
   nothing to do with it. The portal is checked first: asked with one portal's header, the API answers for
   another portal's events too. */
function relationOf(d, url) {
  d = d || {};
  var portal = portalOf(url), slug = slugOf(url);
  var home = str(d.branding_url) ? portalOf(d.branding_url) : '';
  if (!portal || !slug || (d.portal && str(d.portal).toLowerCase() !== portal) || (home && home !== portal)) return '';
  var own = str(d.url_text).toLowerCase();
  if (own && own === slug) return 'own';
  if (home && slugOf(d.branding_url) === slug) return 'edition';
  if (own && seriesOf(own) && seriesOf(own) === seriesOf(slug)) return 'edition';
  return '';
}

/* The photos a page shows: every picture in its gallery sections, then any glimpses_ file it names elsewhere. */
var GALLERY_OPEN = /<(section|div|ul)\b[^>]*\b(?:id|class)\s*=\s*["']([^"']*(?:glimps|galler|justified)[^"']*)["'][^>]*>/gi;
/* a gallery of the event's photos — not a speakers', partners' or videos' "gallery" */
function isPhotoGallery(name) { return /glimps|justified-?gallery|justifiedgallerygrid/i.test(name) || (/galler/i.test(name) && !/speaker|sponsor|partner|logo|video|award|jury/i.test(name)); }
var PHOTO_ATTR = /\b(?:href|src|data-original|data-src|data-lazy|data-full|data-image)\s*=\s*(["'])(https?:\/\/img\.etb2bimg\.com\/[^"'<>\s]+?)\1/gi;
var PHOTO_FILE = /\.(?:webp|jpe?g|png|avif)$/i;
function glimpsesIn(html) {
  var h = str(html), seen = {}, out = [], m, x;
  function add(u) {
    u = u.replace(/^http:/i, 'https:').replace(/[?#].*$/, '');
    if (!PHOTO_FILE.test(u) || /\/(?:logo|icon|sprite)[^\/]*$/i.test(u) || seen[u]) return;
    seen[u] = 1; out.push(u);
  }
  var re = new RegExp(GALLERY_OPEN.source, 'gi');
  while ((m = re.exec(h))) {
    if (!isPhotoGallery(m[2])) continue;
    /* the block runs to the end of its section (a gallery div sits inside one), never into the next section */
    var close = h.indexOf('</section>', re.lastIndex), next = h.indexOf('<section', re.lastIndex);
    var end = close === -1 ? next : next === -1 ? close : Math.min(close, next);
    var body = h.slice(re.lastIndex, end === -1 ? re.lastIndex + 200000 : end);
    var attr = new RegExp(PHOTO_ATTR.source, 'gi');
    while ((x = attr.exec(body))) add(x[2]);
    if (end !== -1 && m[1].toLowerCase() === 'section') re.lastIndex = end;
  }
  var loose = /https?:\/\/img\.etb2bimg\.com\/files\/[^"'\s<>]*glimpses_[^"'\s<>]+?\.(?:webp|jpe?g|png)(?=["'\s<>)?]|$)/gi;
  while ((x = loose.exec(h))) add(x[0]);
  return out.slice(0, MAX.glimpses);
}

/* an edition's gallery from its image list: the shown photos (status 1) of its named groups, once each */
function photosOf(items) {
  var seen = {}, out = [];
  (items || []).forEach(function (it) {
    if (!it || String(it.status) !== '1' || !(it.group && it.group.group_name) || !str(it.img_name).trim()) return;
    var name = str(it.img_name).trim(), u;
    if (/^https?:\/\//i.test(name)) u = name.replace(/^http:/i, 'https:');
    else { try { u = IMG + 'retail_files/' + encodeURI(name.replace(/^\/+/, '')); } catch (e) { return; } }
    if (!PHOTO_FILE.test(u) || seen[u]) return;
    seen[u] = 1; out.push(u);
  });
  return out.slice(0, MAX.glimpses);
}

/* ---------- a speaker's profile ---------- */
var MAX_BIO = 1200, MAX_SESSIONS = 6;
var LINKEDIN_HOST = /^(?:[a-z]{2}\.)?linkedin\.com$/i, X_HOST = /^(?:x|twitter)\.com$/i;
/* the speaker's own text, as plain text — a paragraph per line, what a script or style block holds dropped — cut
   at a word near MAX_BIO. ET's field is the CMS's HTML (<p>, <br>) or plain text with line breaks. */
function bioOf(v) {
  // read no more than a long biography can use: the patterns below rescan what follows an unclosed '<'
  var t = str(v).slice(0, MAX_BIO * 6).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .split(/\r?\n/).map(text).filter(Boolean).join('\n');
  if (t.length <= MAX_BIO) return t;
  var cut = t.slice(0, MAX_BIO), at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return (at > MAX_BIO * 0.8 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…';
}
/* a profile's address on one of the given hosts, on https, however it was written ("linkedin.com/in/x",
   " http://www.linkedin.com/in/x "); anything else (another host, a bare host, a script) is '' */
function profileLink(v, host) {
  var u = str(v).replace(/\s+/g, '');
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  var m = /^https?:\/\/(www\.)?([a-z0-9.-]+)(\/[^\s"'<>\\]+)$/i.exec(u);
  if (!m || !host.test(m[2])) return '';
  return 'https://' + (m[1] || '').toLowerCase() + m[2].toLowerCase() + m[3];
}
/* the company's logo: a file under cp/ (where the speaker's picture is), or an address */
function companyLogo(v) {
  var p = str(v).trim();
  if (!p || !/\.(?:png|jpe?g|webp|svg|gif|avif)$/i.test(p.replace(/[?#].*$/, ''))) return '';
  return /^https?:\/\//i.test(p) || p.indexOf('/') !== -1 ? picture(p) : picture('cp/' + p);
}
/* the sessions each speaker spoke in, from the agenda — by the speaker's id, or by name where an agenda entry
   names its speaker without one — in time order, once each */
function speakerSessions(agenda) {
  var byId = {}, byName = {};
  (agenda || []).filter(function (a) { return a && text(a.agenda_title); }).slice().sort(function (a, b) {
    var x = str(a.agenda_start_datetime), y = str(b.agenda_start_datetime);
    return x < y ? -1 : x > y ? 1 : 0;
  }).forEach(function (a) {
    var session = { title: text(a.agenda_title).slice(0, 300), start: str(a.agenda_start_datetime), end: str(a.agenda_end_datetime) };
    (Array.isArray(a.speakers) ? a.speakers : []).forEach(function (s) {
      if (!s) return;
      var byIdToo = s.id != null && str(s.id) !== '';
      var into = byIdToo ? byId : byName, key = '#' + (byIdToo ? str(s.id) : text(s.speaker_name).toLowerCase());
      if (key === '#') return;
      var list = into[key] || (into[key] = []);
      if (list.length < MAX_SESSIONS && !list.some(function (x) { return x.title === session.title && x.start === session.start; })) list.push(session);
    });
  });
  return { byId: byId, byName: byName };
}

function byWeight(a, b) { return (a.w || 0) - (b.w || 0); }
function normalise(raw) {
  raw = raw || {};
  var d = raw.details || {};
  var sessionsOf = speakerSessions(raw.agenda);
  var speakers = (raw.speakers || []).filter(function (s) { return s && text(s.speaker_name) && str(s.status) !== '0'; }).map(function (s) {
    var name = text(s.speaker_name);
    return { name: name, designation: text(s.speaker_desig), company: text(s.speaker_company),
      photo: picture(s.speaker_picture), group: s.group && s.group.group_name ? text(s.group.group_name) : '',
      bio: bioOf(s.speaker_info), linkedin: profileLink(s.linkedin_url, LINKEDIN_HOST), x: profileLink(s.twitter_url, X_HOST),
      logo: companyLogo(s.company_logo),
      sessions: ((s.id != null && sessionsOf.byId['#' + s.id]) || sessionsOf.byName['#' + name.toLowerCase()] || []).slice(),
      w: +(s.speaker_weightage || s.weightage || 0) };
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
function detailsOf(fetchJson, id, portal) {
  return fetchJson(API + '/v1/microsite/details?digital_month_id=' + encodeURIComponent(id), { portal: portal })
    .then(function (j) { return j && j.status !== false && j.data && typeof j.data === 'object' && (j.data.company_id != null || j.data.url_text) ? j.data : null; }, function () { return null; });
}
/* an edition's start as a time, or NaN when it has none (0000-00-00) */
function startOf(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(str(d && d.event_start_date));
  return m && +m[1] > 1970 ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) - 330 * 60000 : NaN;
}

/* -> Promise<PREVIOUS | null>. fetchJson(url, headers) -> Promise<json>, never throwing for a bad answer */
function readPrevious(url, html, o) {
  o = o || {};
  /* o.portal / o.id: an edition picked from ET's own list (et-events.js; confirmed by the caller to be that
     portal's event and this page) — taken as the page's own, neither guessed */
  var portal = o.portal || portalOf(url);
  var candidates = o.id ? [{ id: String(o.id), from: ['picked'], score: 0 }] : candidatesIn(html).slice(0, MAX.candidates);
  if (!portal || typeof o.fetchJson !== 'function') return Promise.resolve(null);
  var fetchJson = o.fetchJson, now = typeof o.now === 'number' ? o.now : Date.now();
  var glimpsesOnPage = glimpsesIn(html);
  /* 1. what each id the page names is to it */
  return Promise.all(candidates.map(function (c) {
    return detailsOf(fetchJson, c.id, portal).then(function (d) {
      /* the API not answering for it: the page's own id (or the picked one) is still known to be its own */
      var own = c.from.indexOf('siteId') !== -1 || c.from.indexOf('picked') !== -1;
      var relation = c.from.indexOf('picked') !== -1 ? 'own' : d ? relationOf(d, url) : (own ? 'own' : '');
      return { id: c.id, details: d || {}, relation: relation, start: startOf(d) };
    });
  })).then(function (named) {
    var related = named.filter(function (n) { return n.relation; })
      .sort(function (a, b) { return (b.relation === 'own') - (a.relation === 'own'); }).slice(0, MAX.related);
    /* 2. the records of each that is this event */
    return Promise.all(related.map(function (n) {
      return Promise.all(['speaker', 'sponsor', 'agenda', 'image'].map(function (kind) { return allItems(fetchJson, '/v1/activity/' + kind + '/list', n.id, portal); }))
        .then(function (r) {
          n.speakers = r[0]; n.sponsors = r[1]; n.agenda = r[2]; n.photos = photosOf(r[3]);
          n.weight = r[0].length + r[1].length + r[2].length + n.photos.length;
          return n;
        });
    }));
  }).then(function (related) {
    /* 3. the edition: of those that have taken place (or have no date), the page's own if it has records, else
       the latest that has. One still to come is never used: its speakers are not a previous edition's. */
    function happened(n) { return !(n.start > now); }
    function latest(a, b) { return (b.relation === 'own') - (a.relation === 'own') || (b.start || 0) - (a.start || 0) || b.weight - a.weight; }
    var best = related.filter(function (n) { return n.weight > 0 && happened(n); }).sort(latest)[0] || null;
    /* no records: the photos the page shows, named after the page's own edition only if it is known to have
       taken place (an undated page is often the next edition's, "… 2027") */
    var own = related.filter(function (n) { return n.relation === 'own' && n.start <= now; })[0];
    var chosen = best || own || null;
    var glimpses = best && best.photos.length ? best.photos : glimpsesOnPage;
    if (!best && !glimpses.length) return null;
    var p = normalise({ portal: portal, id: chosen ? chosen.id : '', url: url, details: chosen ? chosen.details : {},
      speakers: best ? best.speakers : [], sponsors: best ? best.sponsors : [], agenda: best ? best.agenda : [], glimpses: glimpses });
    return p.speakers.length || p.sponsors.length || p.agenda.length || p.glimpses.length ? p : null;
  }).then(null, function () { return null; });
}

module.exports = { portalOf, slugOf, seriesOf, candidatesIn, idsIn, relationOf, glimpsesIn, photosOf, normalise, readPrevious, profileLink, API };
