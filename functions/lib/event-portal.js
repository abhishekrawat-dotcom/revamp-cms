/* Which ET portal an event made before Oneworld 2.0 stored one belongs to — said only where its own records make
   it CERTAIN (the owner's decision of 3 Nov 2026: "existing events get a portal automatically only where it is
   certain … never guess"). Nothing here runs when an event is read: events/<id>.portal is the one truth, and this
   file only puts values in front of the owner, who ticks them on the "Fill in portals" page (portal-review.html)
   and presses one button.

     GET  /api/events/portal-evidence   any admin, read only. Every live, named event with what its stored records
                                        say about its portal -> REPORT (below)
     POST /api/events/portal-backfill   { items: [{ eventId, portal }] } — 1 to 200 pairs, each the portal the owner
                                        saw and ticked. When config/approvals names approvers, only one of them may
                                        send it (403 not-an-approver); otherwise any admin. Each pair is written in a
                                        transaction of its own, and only when the event is live, has no portal, and
                                        its evidence, read again inside that transaction, is still certain and still
                                        names the ticked portal. -> { results: [{ eventId, status: 'set'|'skipped',
                                        portal?, reason? }] }. Running it again sets nothing twice.

   lib/api.js routes both here and hands over its helpers with wire() on each call (requiring that file from here
   would be a require cycle): withAdmin, withAdminBody, eventDocRef, eventStateOf, approvalsConfig, actorOf,
   logActivity, sendJson, sendFailure, httpError, BODY_LIMITS, isEventId.

     KINDS                    the kinds of evidence, in the order they are weighed (the table below)
     evidenceOf(ev, sources)  -> VERDICT. ev: the event's fields (name, portal, designPlan, generatedSections);
                              sources: the data of its sources/* documents
     nameOf(slug)             -> 'ETHRWorld' | ''  (the roster's name; '' for anything off the roster)
     handleEvidence(req, res), handleBackfill(req, res), wire(helpers)

   WHAT COUNTS (each must be a slug on lib/et-events.js PORTALS; anything else found is ignored):
     1 et-record        a previous- or current-edition source's ETB2B record: previous.portal, award.portal
     2 et-link          the same sources' address (url, previous.url), through lib/et-previous.js portalOf
     3 design-reference designPlan.reference, when it is a previous or current edition (it survives a clone)
     4 logo-unit-page   designPlan.design.logoUnitFrom, when it is a *.economictimes.indiatimes.com page
     5 site-bar         the generated nav's wordmarks: /templates/_shared/img/portals/<slug>(-light).png
     6 site-footer      the generated footer's data-rv-et-footer="<slug>" ("et" is the fallback, never evidence)
   Kinds 5 and 6 only corroborate: they echo kinds 1-4 as those were when the site was generated, and they are the
   generated original, not the page visitors see. Never evidence: the event's name or id, its category, who made
   it, competitor sources, Promotions' records, the SEO canonical address, any other host.

   VERDICT = { portal, certain, from, evidence: [{ kind, portal, where }], conflict: [slug], disagrees: [slug],
               blockers: ['name-mentions:<slug>' | 'site-only'], hints: ['link-only' | 'design-only'] }
     certain   true only when the event has no portal yet, kinds 1-4 name a slug, every slug found in every kind
               and every source is that same one, and nothing blocks it. portal is then that slug (else ''), and
               from is the first kind that found it.
     evidence  everything found, in KINDS order; `where` is said in words, for the owner ("its previous edition's
               ETB2B record") and for the activity line.
     conflict  two or more different slugs: the event gets no portal.
     disagrees for an event that already has a portal (never changed here): the slugs found that are not it.
     blockers  name-mentions:<slug> — the event's name names another portal (the name is never evidence FOR a
               portal, but it is evidence against one); site-only — only kinds 5-6 say so. Looked for only when
               exactly one slug was found (two are a conflict already), so an event is blocked or in conflict,
               never both.
     hints     shown on the review page, never deciding anything: link-only (only a typed ETB2B link says so),
               design-only (only the design it was copied from says so).

   REPORT = { generatedAt, canFill, approvers, counts: { live, withPortal, certain, blocked, conflict, none },
              items: [{ eventId, name, published, hasGeneratedSite, portal, portalName, portalFrom, certain,
                        certainName, from, evidence, conflict, disagrees, blockers, hints }] }
     portal is the stored slug (or '' when it is off the roster, as the events list says). Here certain is the
     slug the page may offer ticked, or '' (the VERDICT's portal), and certainName its roster name. canFill says
     whether this caller passes the backfill's approver rule, so the page can say so before anyone presses
     anything. Items come certain first, then blocked, then conflict, then no evidence, then those that already
     have a portal; by name within each group.

   Firestore calls, for anyone faking it: events select(…).limit(1000).get(); db.getAll(…refs, { fieldMask })
   ten at a time; <event>/sources select(…).get(); db.runTransaction(tx => tx.get(ref), tx.get(sources query),
   tx.update(ref, { portal, portalFrom })); and logActivity's add() under <event>/activity. */
'use strict';
const etEvents = require('./et-events');
const etPrevious = require('./et-previous');

var H = null;
function wire(helpers) { H = helpers; }

var KINDS = ['et-record', 'et-link', 'design-reference', 'logo-unit-page', 'site-bar', 'site-footer'];
/* the kinds that can make an event certain; site-bar and site-footer can only make a conflict */
var STRONG = ['et-record', 'et-link', 'design-reference', 'logo-unit-page'];
/* the events list's own ceiling (lib/api.js EVENTS_LIST_LIMIT), and the report's batch: the generated sections
   read with each event can be up to about 1 MiB, so ten at a time keeps one batch's answer bounded */
var LIST_LIMIT = 1000, BATCH = 10, MAX_PAIRS = 200;
var LIST_FIELDS = ['name', 'published', 'portal', 'portalFrom', 'createdAt', 'deletedAt', 'discardingAt', 'generatedAt'];
var EVENT_MASK = ['designPlan.reference', 'designPlan.design.logoUnitFrom', 'generatedSections'];
var SOURCE_FIELDS = ['type', 'url', 'previous.portal', 'previous.url', 'award.portal'];

/* the words each kind is said in. A current-edition source is this edition's own ETB2B page, not a previous one. */
var WORDS = {
  'et-record': { previousEdition: 'its previous edition\'s ETB2B record', currentEdition: 'this edition\'s own ETB2B record' },
  'et-link': { previousEdition: 'the ETB2B link of its previous edition', currentEdition: 'the ETB2B link of this edition\'s own ETB2B page' },
  'design-reference': 'the ETB2B page its design was modelled on',
  'logo-unit-page': 'the ETB2B page its logo unit came from',
  'site-bar': 'the ETB2B bar its site was generated with',
  'site-footer': 'the ETB2B footer its site was generated with'
};
var NO_PORTAL = 'No portal';

function str(v) { return v == null ? '' : String(v); }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function isOwnEdition(type) { return type === 'previousEdition' || type === 'currentEdition'; }
function nameOf(slug) { return etEvents.isPortal(slug) ? etEvents.PORTALS[slug] : ''; }
function storedPortalOf(ev) { return ev && etEvents.isPortal(ev.portal) ? ev.portal : ''; }
/* the roster portal an ET address names, or '' (www, m, api, img and every other host name none) */
function portalOfUrl(url) { var s = etPrevious.portalOf(typeof url === 'string' ? url : ''); return etEvents.isPortal(s) ? s : ''; }
function distinct(list) { var seen = Object.create(null); return list.filter(function (v) { if (seen[v]) return false; seen[v] = 1; return true; }); }

/* every slug the generated bar shows a wordmark of; its src and its two data-rv-on-* copies name the same one */
var BAR_LOGO = /\/templates\/_shared\/img\/portals\/([a-z0-9]+)(?:-light)?\.png/g;
var FOOTER_MARK = /\bdata-rv-et-footer\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
function matchesOf(re, html) {
  var out = [], m;
  re.lastIndex = 0;
  while ((m = re.exec(html))) out.push(m[1] != null ? m[1] : str(m[2]));
  return distinct(out);
}

/* -> [{ kind, portal, where }] in KINDS order, each (kind, portal, words) once */
function gather(ev, sources) {
  var found = [];
  function add(kind, portal, where) { if (etEvents.isPortal(portal)) found.push({ kind: kind, portal: portal, where: where }); }
  var own = (Array.isArray(sources) ? sources : []).map(obj).filter(function (s) { return s && isOwnEdition(s.type); });
  own.forEach(function (s) {
    var prev = obj(s.previous), award = obj(s.award);
    add('et-record', prev && prev.portal, WORDS['et-record'][s.type]);
    add('et-record', award && award.portal, WORDS['et-record'][s.type]);
    add('et-link', portalOfUrl(s.url), WORDS['et-link'][s.type]);
    add('et-link', portalOfUrl(prev && prev.url), WORDS['et-link'][s.type]);
  });
  var plan = obj(ev.designPlan) || {}, ref = obj(plan.reference), design = obj(plan.design);
  /* a competitor's page (or "none") is what the design was set against, never what the event is */
  if (ref && isOwnEdition(ref.type)) add('design-reference', portalOfUrl(ref.url), WORDS['design-reference']);
  /* often a storage.googleapis.com copy, which says nothing: portalOf answers only for an ETB2B page */
  add('logo-unit-page', portalOfUrl(design && design.logoUnitFrom), WORDS['logo-unit-page']);
  (Array.isArray(ev.generatedSections) ? ev.generatedSections : []).forEach(function (sec) {
    sec = obj(sec);
    if (!sec || typeof sec.html !== 'string') return;
    /* an older site's nav holds the event's own logo, and a site with no portal shows the ET Business Verticals
       one (an .svg): neither is a wordmark here, so neither says anything */
    if (sec.id === 'nav') matchesOf(BAR_LOGO, sec.html).forEach(function (s) { add('site-bar', s, WORDS['site-bar']); });
    if (sec.id === 'footer') matchesOf(FOOTER_MARK, sec.html).forEach(function (s) { add('site-footer', s, WORDS['site-footer']); });
  });
  var seen = Object.create(null);
  return found.filter(function (f) {
    var k = f.kind + '|' + f.portal + '|' + f.where;
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  }).map(function (f, i) { return { f: f, i: i }; })
    .sort(function (a, b) { return (KINDS.indexOf(a.f.kind) - KINDS.indexOf(b.f.kind)) || (a.i - b.i); })
    .map(function (x) { return x.f; });
}

/* ---------- the name, as evidence against a portal ----------
   The name is lower-cased and every run of other characters made one space; it then names a portal when it
   holds, as whole words, any of: the roster name ("etcio", "et brandequity"), the same without its spaces, with its
   capitals read as word breaks ("et brand equity", "ethr world") or with "et" split off or joined on ("et cio",
   "etbrandequity"), the roster name without its "ET" ("brandequity", "retail", "supply chain"), "et" + the slug with
   or without a space ("ethr", "et hr"), or the slug itself ("cio", "retail"). That is wider than any one rule, on
   purpose: matching too much only sends an event to a person, and "Retail Leadership Summit" on ETHRWorld evidence
   must not be filled in unseen. Where two portals' words overlap, the longer wins, so "ETHRWorld Southeast Asia"
   names that portal and not ETHRWorld, and "ETCIO Southeast Asia Awards" names ETCIO Southeast Asia even on
   ETCIO's evidence.
   A regional portal is also named the ways ET shortens it: any form of its parent portal followed by the region,
   as a word ("ETCIO SEA", "HR ME", "ETHRWorld the Middle East") or joined on as ET's own handles are
   ("ETHRWorldSEA", "ETCIOME", "etenergymea": lib/et-footer.js). Without these, "ETCIO SEA Conclave" with an ETCIO
   link would be filled in as ETCIO, the very mistake this check is for. */
function words(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
/* "ET BrandEquity" -> "ET Brand Equity", "ETHRWorld" -> "ETHR World", "ET EnterpriseAI" -> "ET Enterprise AI" */
function camelWords(s) { return str(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'); }
/* one way of writing a name -> the ways it is written with its "ET" joined, split off or left out */
function variantsOf(t) {
  var list = [t.join(' '), t.join('')];
  if (t[0] === 'et' && t.length > 1) list.push(t.slice(1).join(' '), t.slice(1).join(''), ['et' + t[1]].concat(t.slice(2)).join(' '));
  else if (t[0].length > 2 && t[0].slice(0, 2) === 'et') list.push(['et', t[0].slice(2)].concat(t.slice(1)).join(' '), [t[0].slice(2)].concat(t.slice(1)).join(' '));
  return list;
}
/* a regional slug's ending -> the region as ET writes it out; the first is the short code ET joins onto a handle.
   MEA (Middle East and Africa) is also said as just the Middle East. */
var REGIONS = {
  sea: ['sea', 'southeast asia', 'south east asia', 'se asia'],
  me: ['me', 'middle east', 'the middle east'],
  mea: ['mea', 'middle east', 'the middle east', 'middle east and africa', 'middle east africa']
};
/* one portal's own forms (above), without the regional ones */
function ownFormsOf(slug) {
  var name = etEvents.PORTALS[slug];
  return distinct(variantsOf(words(name).split(' ')).concat(variantsOf(words(camelWords(name)).split(' ')), [slug, 'et' + slug, 'et ' + slug]).filter(Boolean));
}
/* -> { slug, parent, region } for each regional portal: a slug that is another roster slug plus a region's ending,
   whose name is that portal's name plus more ("ETHRWorld Southeast Asia" on "ETHRWorld"), so a slug that only
   happens to end in "me" is never read as one */
function regionalOf() {
  var out = [];
  function joined(s) { return words(s).replace(/ /g, ''); }
  Object.keys(etEvents.PORTALS).forEach(function (slug) {
    Object.keys(REGIONS).forEach(function (region) {
      var parent = slug.slice(0, -region.length);
      if (slug.length <= region.length || slug.slice(-region.length) !== region || !etEvents.isPortal(parent)) return;
      if (joined(etEvents.PORTALS[slug]).indexOf(joined(etEvents.PORTALS[parent])) !== 0) return;
      out.push({ slug: slug, parent: parent, region: region });
    });
  });
  return out;
}
var FORMS = null;
function formsOf() {
  if (FORMS) return FORMS;
  var out = [];
  var byRegion = Object.create(null);
  regionalOf().forEach(function (r) { byRegion[r.slug] = r; });
  Object.keys(etEvents.PORTALS).forEach(function (slug) {
    var list = ownFormsOf(slug), r = byRegion[slug];
    if (r) {
      ownFormsOf(r.parent).forEach(function (p) {
        REGIONS[r.region].forEach(function (w) { list.push(p + ' ' + w); });
        /* the short code joined onto the parent's last word: "ethrworld" + "sea", "et cio" + "me" -> "et ciome" */
        list.push(p + REGIONS[r.region][0]);
      });
    }
    distinct(list).forEach(function (f) { out.push({ slug: slug, words: f.split(' ') }); });
  });
  FORMS = out;
  return FORMS;
}
/* -> the slugs the name names, sorted */
function mentionsIn(name) {
  var w = words(name);
  if (!w) return [];
  var toks = w.split(' '), hits = [];
  formsOf().forEach(function (f) {
    for (var i = 0; i + f.words.length <= toks.length; i++) {
      var at = true;
      for (var j = 0; j < f.words.length && at; j++) at = toks[i + j] === f.words[j];
      if (at) hits.push({ slug: f.slug, at: i, len: f.words.length });
    }
  });
  hits.sort(function (a, b) { return (b.len - a.len) || (a.at - b.at); });
  var kept = [];
  hits.forEach(function (h) {
    /* a shorter match inside a longer one is part of that name; the very same words claimed by two portals
       name both */
    var inside = kept.some(function (k) { return h.at < k.at + k.len && k.at < h.at + h.len && !(k.at === h.at && k.len === h.len); });
    if (!inside) kept.push(h);
  });
  return distinct(kept.map(function (k) { return k.slug; })).sort();
}

function evidenceOf(ev, sources) {
  ev = obj(ev) || {};
  var evidence = gather(ev, sources);
  var slugs = distinct(evidence.map(function (e) { return e.portal; })).sort();
  var strong = evidence.filter(function (e) { return STRONG.indexOf(e.kind) !== -1; });
  var stored = storedPortalOf(ev);
  var blockers = [];
  if (slugs.length === 1) {
    mentionsIn(ev.name).filter(function (s) { return s !== slugs[0]; }).forEach(function (s) { blockers.push('name-mentions:' + s); });
    if (!strong.length) blockers.push('site-only');
  }
  var strongKinds = distinct(strong.map(function (e) { return e.kind; }));
  var hints = strongKinds.length !== 1 ? [] : strongKinds[0] === 'et-link' ? ['link-only'] : strongKinds[0] === 'design-reference' ? ['design-only'] : [];
  /* an event that already has a portal is never changed from here, whatever its records say */
  var certain = !stored && slugs.length === 1 && strong.length > 0 && !blockers.length;
  return {
    portal: certain ? slugs[0] : '',
    certain: certain,
    from: certain ? evidence[0].kind : '',
    evidence: evidence,
    conflict: slugs.length > 1 ? slugs : [],
    disagrees: stored ? slugs.filter(function (s) { return s !== stored; }) : [],
    blockers: blockers,
    hints: hints
  };
}

/* ---------- the routes ---------- */

/* a route reached before lib/api.js handed its helpers over: answered as inModule() answers a missing module */
function unwired(res) {
  try {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' }));
  } catch (e) { /* the socket is already gone */ }
}

/* the events list's rule (lib/api.js handleEventsList): live, not being discarded, and named */
function isListed(state, d) {
  return state === 'live' && !d.discardingAt && typeof d.name === 'string' && d.name.trim() !== '';
}
function canFillOf(cfg, decoded) {
  var email = str(decoded && decoded.email).toLowerCase();
  return !cfg.approvers.length || cfg.approvers.indexOf(email) !== -1;
}

function liveEvents(fb) {
  var q = fb.db.collection('events');
  return q.select.apply(q, LIST_FIELDS).limit(LIST_LIMIT).get().then(function (snap) {
    return snap.docs.filter(function (d) { return isListed(H.eventStateOf(d), d.data() || {}); });
  });
}
function sourcesQuery(ref) { var q = ref.collection('sources'); return q.select.apply(q, SOURCE_FIELDS); }

function itemOf(id, ev, sources) {
  var v = evidenceOf(ev, sources), stored = storedPortalOf(ev);
  return {
    eventId: id, name: ev.name.trim(), published: ev.published === true, hasGeneratedSite: !!ev.generatedAt,
    portal: stored, portalName: nameOf(stored), portalFrom: stored && typeof ev.portalFrom === 'string' ? ev.portalFrom : '',
    certain: v.portal, certainName: nameOf(v.portal), from: v.from, evidence: v.evidence,
    conflict: v.conflict, disagrees: v.disagrees, blockers: v.blockers, hints: v.hints
  };
}
/* the review page's groups, in its order */
function groupOf(item) {
  if (item.portal) return 'withPortal';
  if (item.certain) return 'certain';
  if (item.blockers.length) return 'blocked';
  if (item.conflict.length) return 'conflict';
  return 'none';
}
var GROUP_ORDER = ['certain', 'blocked', 'conflict', 'none', 'withPortal'];

/* each event's masked fields and sources, ten events at a time */
function readItems(fb, listed) {
  var out = [], at = 0;
  function next() {
    if (at >= listed.length) return Promise.resolve(out);
    var batch = listed.slice(at, at + BATCH);
    at += BATCH;
    var refs = batch.map(function (d) { return H.eventDocRef(fb, d.id); });
    return Promise.all([
      fb.db.getAll.apply(fb.db, refs.concat([{ fieldMask: EVENT_MASK }])),
      Promise.all(refs.map(function (r) { return sourcesQuery(r).get(); }))
    ]).then(function (got) {
      batch.forEach(function (d, k) {
        var more = got[0][k] && got[0][k].exists ? (got[0][k].data() || {}) : {};
        var ev = Object.assign({}, d.data() || {}, more);
        out.push(itemOf(d.id, ev, got[1][k].docs.map(function (s) { return s.data() || {}; })));
      });
      return next();
    });
  }
  return next();
}

function reportOf(items, cfg, decoded) {
  var counts = { live: items.length, withPortal: 0, certain: 0, blocked: 0, conflict: 0, none: 0 };
  items.forEach(function (i) { counts[groupOf(i)]++; });
  items.sort(function (a, b) {
    var g = GROUP_ORDER.indexOf(groupOf(a)) - GROUP_ORDER.indexOf(groupOf(b));
    if (g) return g;
    var n = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    return n || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);
  });
  return { generatedAt: new Date().toISOString(), canFill: canFillOf(cfg, decoded), approvers: cfg.approvers.slice(), counts: counts, items: items };
}

function handleEvidence(req, res) {
  if (!H) return unwired(res);
  H.withAdmin(req, res, function (fb, decoded) {
    Promise.all([liveEvents(fb), H.approvalsConfig(fb)]).then(function (got) {
      return readItems(fb, got[0]).then(function (items) { H.sendJson(res, 200, reportOf(items, got[1], decoded)); });
    }).catch(function (err) { H.sendFailure(res, 'portal evidence', err, 'The portal report could not be made. Please try again.'); });
  });
}

/* the body's pairs, or a 400 answered here (-> null) */
function pairsOr400(res, body) {
  var items = body && body.items;
  function bad(error, code, extra) { H.sendJson(res, 400, Object.assign({ error: error, code: code }, extra || {})); return null; }
  if (!Array.isArray(items) || !items.length) return bad('Tick at least one event to fill in.', 'no-items');
  if (items.length > MAX_PAIRS) return bad('At most ' + MAX_PAIRS + ' events can be filled in at once.', 'too-many');
  var seen = Object.create(null), pairs = [];
  for (var i = 0; i < items.length; i++) {
    var it = obj(items[i]);
    if (!it || !H.isEventId(it.eventId)) return bad('Each event to fill in needs a valid eventId.', 'invalid-event-id');
    if (!etEvents.isPortal(it.portal)) return bad('Unknown portal "' + str(it.portal).slice(0, 40) + '".', 'unknown-portal', { field: 'portal', eventId: it.eventId });
    if (seen[it.eventId]) return bad('The event "' + it.eventId + '" is listed twice.', 'duplicate-event', { eventId: it.eventId });
    seen[it.eventId] = 1;
    pairs.push({ eventId: it.eventId, portal: it.portal });
  }
  return pairs;
}

/* One pair, in its own transaction: the event and its sources are read again inside it, so a portal set or a
   source added since the owner looked is seen, and the write happens only on what was read. A skip writes
   nothing. A fill-in leaves updatedAt and detailsUpdatedAt as they are: it is the platform filling in a field,
   not an edit of the event, so the dashboard's order does not move and no open console thinks it is stale. */
function fillOne(fb, decoded, pair) {
  var ref = H.eventDocRef(fb, pair.eventId);
  function skip(reason, portal) { return portal ? { status: 'skipped', reason: reason, portal: portal } : { status: 'skipped', reason: reason }; }
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var state = H.eventStateOf(snap);
      /* a shell (the AI steps' writes before the wizard creates the event) is not an event */
      if (state === 'missing' || state === 'shell') return skip('not-found');
      var ev = snap.data() || {};
      if (!isListed(state, ev)) return skip('not-live');
      /* never overwritten. A value off the roster is no portal, as everywhere else (the list shows it as none) */
      if (storedPortalOf(ev)) return skip('has-portal', ev.portal);
      return tx.get(sourcesQuery(ref)).then(function (ss) {
        var v = evidenceOf(ev, ss.docs.map(function (s) { return s.data() || {}; }));
        if (v.conflict.length) return skip('conflict');
        if (v.blockers.length) return skip('blocked');
        if (!v.certain) return skip('not-certain');
        /* the owner approved a pair, not an id: what the records say now must be what they ticked */
        if (v.portal !== pair.portal) return skip('changed-since-review');
        tx.update(ref, { portal: v.portal, portalFrom: 'backfill' });
        return { status: 'set', portal: v.portal, where: v.evidence[0].where };
      });
    });
  }).then(function (r) {
    var out = { eventId: pair.eventId, status: r.status };
    if (r.portal) out.portal = r.portal;
    if (r.reason) out.reason = r.reason;
    if (r.status !== 'set') return out;
    var name = nameOf(r.portal);
    return H.logActivity(fb, pair.eventId, decoded, 'portal-set', NO_PORTAL + ' → ' + name + ' (filled in from ' + r.where + ')',
      { area: 'event', fields: [{ field: 'portal', before: NO_PORTAL, after: name }] }).then(function () { return out; });
  });
}

function handleBackfill(req, res) {
  if (!H) return unwired(res);
  H.withAdminBody(req, res, H.BODY_LIMITS.small, function (fb, decoded, body) {
    var pairs = pairsOr400(res, body);
    if (!pairs) return;
    var results = [];
    H.approvalsConfig(fb).then(function (cfg) {
      if (!canFillOf(cfg, decoded)) {
        throw H.httpError(403, 'Only an approver (' + cfg.approvers.join(', ') + ') can fill in portals.', { code: 'not-an-approver', approvers: cfg.approvers });
      }
      /* one after another, in the order sent: each is a transaction of its own and is logged once it commits */
      return pairs.reduce(function (p, pair) {
        return p.then(function () { return fillOne(fb, decoded, pair); }).then(function (r) { results.push(r); });
      }, Promise.resolve());
    }).then(function () {
      H.sendJson(res, 200, { results: results });
    }).catch(function (err) {
      if (err && err.status && err.body) return H.sendFailure(res, 'portal backfill', err);
      /* what was set before the failure stays set and logged; the page is told how far it got */
      console.error('event-portal: the backfill stopped after ' + results.length + ' of ' + pairs.length + ' — ' + (err && err.stack || err));
      H.sendJson(res, 500, { error: 'Filling in stopped after ' + results.length + ' of ' + pairs.length + ' events. Load the report again to see where each one stands.', code: 'backfill-stopped', results: results });
    });
  });
}

module.exports = { wire, evidenceOf, nameOf, handleEvidence, handleBackfill, KINDS };
module.exports._test = { WORDS, STRONG, LIST_FIELDS, EVENT_MASK, SOURCE_FIELDS, LIST_LIMIT, BATCH, MAX_PAIRS, mentionsIn, formsOf, regionalOf, words, gather, isListed, groupOf };
