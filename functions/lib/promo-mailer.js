/* Promotions → Mailers: the promotional platform's mailer studio (the owner's Social Post Generator), on
   Oneworld's events. The engine — its 18 mailers, 29 blocks, palettes, layouts, relayout, HTML import and AI
   prompts — is the platform's own code (promo-engine/src, built to ./vendor/promo-engine.js); this file is the
   platform's server routes for it (app/src/server.ts, /api/mailer*), on Oneworld's data and storage:

     GET  /api/promo/mailers?eventId=                    the catalog: mailers, block palette, saves, tones
     GET  /api/promo/mailer/saves?eventId=&mailerId=     the versions of one mailer, newest first
     GET  /api/promo/mailer/roster?eventId=              the event's speakers, partners and sessions, for the pickers
     POST /api/promo/mailer/doc        { eventId, mailerId, saveId?, fresh? }  open a version / the latest / a new one
     POST /api/promo/mailer/relayout   { eventId, doc, mailerId }              another layout, the sender's work kept
     POST /api/promo/mailer/import?eventId=   (raw .html/.eml, ≤ 2 MB)        an outside mail as a block document
     POST /api/promo/mailer/render     { eventId, doc, editor?, track?, saveId?, saveName? }   the mail's HTML (+ its palette)
     POST /api/promo/mailer/block      { eventId, type }                       a new block, seeded from the event
     POST /api/promo/mailer/save       { eventId, mailerId, doc, saveId?, name? }   Save / Save as new
     POST /api/promo/mailer/save/rename, /save/delete, /reset
     POST /api/promo/mailer/download   { eventId, doc, test?, saveId?, saveName? } -> .html  ·  { eventId, mailerIds: [one] } -> .html
                                       ·  { eventId, mailerIds? } (none, or several) -> .zip
     POST /api/promo/mailer/ai         { eventId, action: subjects|rewrite|polish|enhance, … }
     GET  /api/promo/icons?eventId=    POST /api/promo/icons?eventId=&name=  (raw)    DELETE /api/promo/icons?eventId=&id=

   THE EVENT. The engine reads an EventEntity (promo-engine/src/model/types.ts), which the platform builds from
   ET's API. Here it is built from Oneworld's own event (entityOf): the Promotions kit (lib/promo.js buildKit —
   the site's real records, its brand, its portal) plus, for an award, its nomination dates and last edition's
   jury. Nothing is invented: a list the event has no record for is empty, and the engine leaves its section out.

   VERSIONS are kept in Firestore, events/<id>/mailerSaves/<saveId>: { mailerId, name, subject, doc (JSON), savedAt,
   createdAt, by } — the platform's SaveMeta { saveId, name, savedAt, subject } on the way out.

   TRACKING (the platform's deliverable(), server.ts). Every export goes out through deliverables(): a download, a
   Copy HTML (render with track:true) and each file of a ZIP. When tracking runs for the event (lib/promo-track.js
   availableFor, and the event is live), each file gets its own send id and the open pixel, and its links go
   through the signed click redirect when the mailer's "Link tracking" is on. One send per file is then recorded
   in promoSends/<sendId> (lib/promo-track.js recordSends, which also answers the pixel, the clicks and the
   dashboards). Otherwise the file is the plain mail, never an error: tracking off here, adding it failed, or
   recording the send failed. The answer says which file went out: X-Mailer-Tracked: yes | no on a download (with
   Cache-Control: no-store), tracked: true | false from a tracked render, and tracking: true | false in the
   catalog (the studio hides "Link tracking" when it is false). Never tracked, and nothing recorded: the studio's
   preview (editor:true), the PNG/PDF export and a test download (test:true). */
'use strict';
const crypto = require('crypto');
const JSZip = require('jszip');
const engine = require('./vendor/promo-engine');
const promo = require('./promo');
const llm = require('./llm');
const { sendJson } = require('./http');
const { logActivity } = require('./activity');

var H = null;
/* lib/api.js hands over its helpers on each call, as it does for lib/promo.js */
function wire(helpers) { H = helpers; promo.wire(helpers); }

/* ---------- the event, as the engine reads it ---------- */

function absolute(url, base) {
  var s = String(url || '').trim();
  if (/^https:\/\//i.test(s)) return s;
  if (/^\/[^/]/.test(s) && base) return base.replace(/\/+$/, '') + s;
  return '';
}

/* the award's facts (types.ts AwardFacts), from the event's own nomination dates and ceremony date */
function awardOf(ev, siteUrl, rec) {
  if (String(ev.category || '').toLowerCase() !== 'awards') return undefined;
  var nom = ev.nomination || {}, now = Date.now();
  var open = !nom.openTbd && nom.open ? String(nom.open) : '', close = !nom.closeTbd && nom.close ? String(nom.close) : '';
  var ceremony = String(ev.start || '');
  var t = function (v) { var d = Date.parse(String(v).replace(' ', 'T')); return isNaN(d) ? NaN : d; };
  var isOpen = (!open || t(open) <= now) && !!close && t(close) >= now;
  var phase = ceremony && t(ceremony) < now ? 'past' : isOpen ? 'live' : 'upcoming';
  return {
    awardId: 0, phase: phase, awardUrl: siteUrl, ceremonyDate: ceremony || undefined,
    ceremonyDateLabel: engine.fmtDateLabel(ceremony) || undefined,
    nominationsOpen: isOpen, nominationsOpenDate: open || undefined, nominationsCloseDate: close || undefined,
    nominationsCloseLabel: close ? engine.fmtDateLabel(close) : undefined,
    nominateUrl: siteUrl || undefined,
    categories: rec && Array.isArray(rec.categories) && rec.categories.length ? rec.categories.length : undefined
  };
}

/* Oneworld's event -> the engine's EventEntity. kit: lib/promo.js buildKit; ev: the stored event; base: the
   public address (relative pictures made absolute: a mail is read outside this app). */
function entityOf(eventId, kit, ev, base, awardRec) {
  var e = kit.event || {}, b = kit.brand || {}, c = kit.content || {};
  var weight = 0;
  var speakers = (c.speakers || []).map(function (s) {
    return { id: String(s.id), name: s.name || '', designation: s.designation || '', company: s.company || '',
      photoUrl: absolute(s.photoUrl, base) || undefined, group: s.group || undefined, weightage: ++weight };
  });
  /* an award site lists its jury from last edition's record when it has no speakers of its own */
  if (!speakers.length && awardRec && Array.isArray(awardRec.jury)) {
    awardRec.jury.forEach(function (g) {
      (g.people || []).forEach(function (p, i) {
        speakers.push({ id: 'jury-' + speakers.length, name: p.name || '', designation: p.title || '', company: p.company || '',
          photoUrl: absolute(p.photo, base) || undefined, group: g.group || 'Jury', weightage: ++weight, linkedin: p.linkedin || undefined });
      });
    });
  }
  weight = 0;
  var sponsors = (c.partners || []).map(function (p) {
    return { id: String(p.id), title: p.name || '', logoUrl: absolute(p.logoUrl, base) || undefined, tier: p.tier || 'Partners',
      url: /^https?:\/\//i.test(String(p.url || '')) ? p.url : undefined, weightage: ++weight };
  });
  var byName = {};
  speakers.forEach(function (s) { byName[s.name] = s; });
  var sessions = (c.sessions || []).map(function (s) {
    return { id: String(s.id), title: s.title || '', start: s.start || undefined, end: s.end || undefined,
      speakers: (s.speakers || []).map(function (n) { return byName[n]; }).filter(Boolean) };
  });
  var siteUrl = e.siteUrl || '';
  var edition = engine.parseEdition(e.edition || '', e.name || '', e.description || '');
  return {
    portal: (b.portal && b.portal.slug) || '',
    entityId: 0, oneworldId: eventId,
    name: e.name || eventId,
    edition: edition || undefined,
    tagline: e.tagline || undefined,
    description: e.description || undefined,
    hashtag: e.hashtag || '',
    startDate: e.start || undefined, endDate: e.end || undefined,
    dateLabel: engine.fmtDateLabel(e.start, e.end) || e.dateLabel || undefined,
    totalDays: engine.daysBetween(e.start, e.end) || undefined,
    venue: e.venue || undefined, city: e.city || undefined,
    ctaLabel: String(ev.category || '').toLowerCase() === 'awards' ? 'Nominate Now' : 'Register Now',
    ctaUrl: e.registerUrl || siteUrl || undefined,
    logoUrl: absolute(b.eventLogoUrl, base) || undefined,
    keyVisualUrl: absolute(b.heroImageUrl, base) || undefined,
    keyVisualMode: 'hero',
    micrositeUrl: siteUrl || undefined,
    siteAccent: (b.colours && b.colours.theme) || undefined,
    siteTheme: b.mode === 'dark' ? 'dark' : 'light',
    whoShouldAttend: (c.audience || []).slice(0, 20),
    keyPoints: (c.topics || []).slice(0, 20),
    whyJoin: [],
    stats: (c.stats || []).map(function (s) { return { label: s.label, value: s.value }; }),
    speakers: speakers,
    sponsorTiers: engine.groupSponsors(sponsors),
    sessions: sessions,
    award: awardOf(ev, siteUrl, awardRec)
  };
}

/* the engine's event for one Oneworld event (and the stored event, for the activity log's labels) */
function eventFor(fb, eventId, req) {
  var ref = fb.db.collection('events').doc(eventId);
  return Promise.all([
    promo.buildKit(fb, eventId, req, {}),
    ref.get(),
    ref.collection('sources').get().then(function (s) { return s.docs.map(function (d) { return d.data(); }); }, function () { return []; })
  ]).then(function (r) {
    var kit = r[0], ev = r[1].exists ? r[1].data() : {}, sources = r[2];
    /* the event's own line: the one under its site's banner (the AI design), else its listing's tagline */
    var plan = ev.designPlan && ev.designPlan.design;
    kit.event.tagline = String((plan && plan.heroTagline) || ev.tagline || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    var awardRec = sources.filter(function (d) { return d && d.type === 'previousEdition' && d.award; }).map(function (d) { return d.award; })[0] || null;
    return { ev: entityOf(eventId, kit, ev, H.publicBaseFor(req), awardRec), stored: ev };
  });
}

/* ---------- saved versions (Firestore; the platform's assets/mailers.ts on Blob) ---------- */

var MAX_DOC_CHARS = 900000;          // a Firestore document holds 1 MiB; the doc is kept as one JSON string in it
function savesOf(fb, eventId) { return fb.db.collection('events').doc(eventId).collection('mailerSaves'); }
function metaOf(d) { var v = d.data() || {}; return { saveId: d.id, name: v.name || '', savedAt: v.savedAt || 0, subject: v.subject || '', mailerId: v.mailerId || '' }; }
function newSaveId() { return 's' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex').slice(0, 4); }

function listSaves(fb, eventId, mailerId) {
  return savesOf(fb, eventId).where('mailerId', '==', mailerId).get().then(function (s) {
    return s.docs.map(metaOf).sort(function (a, b) { return b.savedAt - a.savedAt; }).map(function (m) { delete m.mailerId; return m; });
  });
}
/* every mailer's versions, in one read: { [mailerId]: SaveMeta[] } */
function listSavesForEvent(fb, eventId) {
  return savesOf(fb, eventId).get().then(function (s) {
    var out = {};
    s.docs.map(metaOf).sort(function (a, b) { return b.savedAt - a.savedAt; }).forEach(function (m) {
      var id = m.mailerId; delete m.mailerId;
      (out[id] = out[id] || []).push(m);
    });
    return out;
  });
}
function getSave(fb, eventId, mailerId, saveId) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(String(saveId || ''))) return Promise.resolve(null);
  return savesOf(fb, eventId).doc(saveId).get().then(function (d) {
    if (!d.exists || (d.data() || {}).mailerId !== mailerId) return null;
    var v = d.data(), doc = null;
    try { doc = JSON.parse(v.doc); } catch (e) { return null; }
    var meta = metaOf(d); delete meta.mailerId;
    return { doc: doc, meta: meta };
  });
}
function latestSave(fb, eventId, mailerId) {
  return listSaves(fb, eventId, mailerId).then(function (list) { return list.length ? getSave(fb, eventId, mailerId, list[0].saveId) : null; });
}
/* a name no other version of this mailer has: "Name", else "Name (2)", "Name (3)" … */
function uniqueName(name, taken) {
  var base = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled', n = 1, out = base;
  var lower = taken.map(function (t) { return t.toLowerCase(); });
  while (lower.indexOf(out.toLowerCase()) !== -1) out = base + ' (' + (++n) + ')';
  return out;
}
function putSave(fb, eventId, mailerId, o, by) {
  var json = JSON.stringify(o.doc);
  if (json.length > MAX_DOC_CHARS) return Promise.reject(httpErr(413, 'This mailer is too large to save. Remove a few sections or pictures and try again.'));
  return listSaves(fb, eventId, mailerId).then(function (list) {
    var existing = o.saveId ? list.filter(function (m) { return m.saveId === o.saveId; })[0] : null;
    var others = list.filter(function (m) { return !existing || m.saveId !== existing.saveId; }).map(function (m) { return m.name; });
    var wanted = String(o.name || '').trim() || (existing && existing.name) || String(o.doc.subject || '').trim() || 'Untitled';
    var saveId = existing ? existing.saveId : newSaveId(), now = Date.now();
    var row = { mailerId: mailerId, name: existing && !String(o.name || '').trim() ? existing.name : uniqueName(wanted, others),
      subject: String(o.doc.subject || '').slice(0, 300), doc: json, savedAt: now, updatedAt: new Date(now).toISOString(), by: by };
    if (!existing) row.createdAt = row.updatedAt;
    return savesOf(fb, eventId).doc(saveId).set(row, { merge: true }).then(function () {
      return { saveId: saveId, name: row.name, savedAt: now, subject: row.subject, created: !existing };
    });
  });
}

function httpErr(status, message) { var e = new Error(message); e.status = status; e.body = { error: message }; return e; }

/* ---------- AI: the platform's prompts, through Oneworld's AI layer ---------- */

/* the platform's JSON Schemas, in the form llm.js takes (Gemini's: OBJECT / STRING …; claude.js turns them back) */
function toLlmSchema(s) {
  if (!s || typeof s !== 'object') return s;
  var out = {};
  Object.keys(s).forEach(function (k) {
    if (k === 'additionalProperties') return;
    var v = s[k];
    if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase();
    else if (k === 'properties') { out.properties = {}; Object.keys(v).forEach(function (p) { out.properties[p] = toLlmSchema(v[p]); }); }
    else if (k === 'items') out.items = toLlmSchema(v);
    else out[k] = v;
  });
  return out;
}
/* the hook the engine's AI module calls (promo-engine/src/ai/copy.ts setAiCaller) */
function aiCallerFor(fb, eventId, user) {
  return function (call) {
    var route = call.deep ? 'promo-ai-deep' : 'promo-ai-fast';
    return llm.callJson(call.system + '\n\n' + call.user, toLlmSchema(call.schema), {
      route: route, eventId: eventId, user: user, maxOutputTokens: Math.max(4096, call.maxTokens || 4000),
      onUsage: H.aiUsageRecorder(fb, eventId, route)
    }).then(function (r) {
      if (r.error) {
        var e = new engine.AiUnavailable(r.code === 'ai-timeout' ? 'That took too long. Try again, or enhance fewer sections at once.'
          : r.code === 'ai-quota' ? 'The AI is busy right now — give it a few seconds and try again.'
          : r.code === 'ai-config' ? 'AI assistance isn\'t set up yet. Ask your admin to switch it on, then try again.'
          : 'AI assistance ran into a problem. Give it a moment and try again.');
        e.llm = r;
        throw e;
      }
      return r.parsed;
    });
  };
}

/* ---------- tracking: what an export hands out (the platform's deliverable()) ---------- */

/* lib/promo-track.js (the open pixel, signed click links and their counts) is loaded on first use, inside try —
   never at the top of this file: a fault in it must cost tracking (plain downloads, catalog.tracking false),
   never the mailer studio itself */
var trackLoadLoggedAt = 0;
/* the mailer id the engine's importHtml gives an imported mail: not a registry mailer, but a real kind of send */
var IMPORTED_MAILER_ID = 'mailer.imported';
function tracker() {
  try { return require('./promo-track'); }
  catch (err) {
    if (Date.now() - trackLoadLoggedAt > 600000) { trackLoadLoggedAt = Date.now(); console.error('promo-mailer: lib/promo-track.js could not be loaded — mailers go out untracked — ' + (err && err.stack || err)); }
    return null;
  }
}
/* tracked for this event: tracking runs here (promo-track availableFor) and the event is live. A module that
   loads but throws here costs tracking too, never the catalog or the download that asked. */
function trackingOn(t, eventId, stored) {
  if (!t || !stored || !stored.createdAt || stored.deletedAt) return false;
  try { return !!t.availableFor(eventId); } catch (err) { return false; }
}

/* the platform's deliverable() (server.ts:886-915), for one file or a zip's worth. got: eventFor()'s { ev, stored };
   items: [{ doc, mailerId, save: { saveId, name } | null }]. Resolves { html: string[], tracked: boolean } and never
   rejects for a tracking reason: when tracking is off here, or instrumenting or recording fails, every file is the
   plain render and tracked is false. Order: render, instrument, record — a failure while instrumenting then leaves
   no recorded send without its file. (The platform recorded first.) */
function deliverables(fb, decoded, got, eventId, items) {
  return Promise.resolve().then(function () {
    var ev = got.ev, stored = got.stored;
    var plain = items.map(function (it) { return engine.renderDoc(it.doc, ev); });
    var untracked = { html: plain, tracked: false };
    var t = tracker();
    if (!trackingOn(t, eventId, stored)) return untracked;
    var html, metas;
    try {
      var base = t.base(), now = Date.now();
      /* nowhere for the pixel to point: a send recorded now would be a row nothing can ever count into */
      if (!base) return untracked;
      var ids = items.map(function () { return engine.newSendId(); });
      /* "Link tracking" is the mailer's own choice and off unless turned on, as on the platform: rewriting every
         link through Oneworld's address is something a sender opts into. The open pixel goes in either way. */
      html = items.map(function (it, i) {
        return engine.injectTracking(plain[i], ids[i], base, { links: String(it.doc.trackLinks == null ? 'no' : it.doc.trackLinks) === 'yes' });
      });
      /* lib/promo-track.js recordSends checks and caps every field. The mailer id is one the engine knows, or an
         imported mail's "mailer.imported"; any other id the studio sent (it comes from the document, so it can be
         anything, "constructor" included) is recorded as '' — the dashboards look a mailer's versions up by it */
      metas = items.map(function (it, i) {
        var raw = String(it.mailerId || ''), m = engine.getMailer(raw), save = it.save || null;
        return {
          id: ids[i], eventId: eventId, eventCreatedAt: String(stored.createdAt),
          portal: String(ev.portal || ''), eventName: String(ev.name || ''),
          mailerId: m ? m.id : (raw === IMPORTED_MAILER_ID ? raw : ''), mailerLabel: m ? m.label : '', subject: String(it.doc.subject || ''),
          /* which version went out, so the dashboard can drill from a mailer into its versions */
          saveId: String((save && save.saveId) || ''), saveName: String((save && save.name) || ''),
          createdAt: now, by: (decoded && decoded.email) || ''
        };
      });
    } catch (err) {
      console.error('promo-mailer: tracking could not be added — the file went out untracked — ' + (err && err.stack || err));
      return untracked;
    }
    return Promise.resolve().then(function () { return t.recordSends(fb, metas); }).then(function () {
      return { html: html, tracked: true };
    }, function (err) {
      /* the platform's rule: a tracking failure must never break a download (store.ts) — the plain file goes out,
         flagged, and the studio says it is not tracked this time */
      console.error('promo-mailer: a send could not be recorded — the file went out untracked — ' + (err && err.stack || err));
      return untracked;
    });
  });
}

/* What POST /download hands out, exactly as the platform decides it (server.ts:918-967):
     { doc }               the document on screen (unsaved edits included)        -> { kind: 'doc' }
     { mailerIds: [id] }   that mailer, when this event can have it               -> { kind: 'one', mailer }, else 404
     { mailerIds? }        none named (every mailer but Blank) or several: a ZIP  -> { kind: 'zip', mailers }, else 404
   A ZIP stays a ZIP even when only one mailer is left in it: the studio saves it as mailers.zip. */
function pickDownload(body, ev) {
  if (body.doc) return { kind: 'doc' };
  var ids = Array.isArray(body.mailerIds) ? body.mailerIds.map(String) : [];
  if (ids.length === 1) {
    var m = engine.getMailer(ids[0]);
    return m && m.requires(ev).ok ? { kind: 'one', mailer: m } : { kind: 'none', status: 404, error: 'unknown or unavailable mailer' };
  }
  var mailers = (ids.length ? ids.map(function (id) { return engine.getMailer(id); }).filter(Boolean)
    : engine.ALL_MAILERS.filter(function (x) { return x.bulk !== false; }))
    .filter(function (x) { return x.requires(ev).ok; })
    /* ONEWORLD PORT: a mailer named twice is one file — a ZIP keeps one file per name, and a second recorded send
       would be one no file carries */
    .filter(function (x, i, all) { return all.indexOf(x) === i; });
  if (!mailers.length) return { kind: 'none', status: 404, error: 'no mailers available for this event' };
  return { kind: 'zip', mailers: mailers };
}

/* ---------- the routes ---------- */

function queryOf(req) { return new URLSearchParams(String(req.url || '').split('?')[1] || ''); }
function fail(res, what, err) {
  if (err instanceof engine.AiUnavailable) return sendJson(res, 503, { error: err.message, code: 'ai-unavailable' });
  H.sendFailure(res, 'promo mailer ' + what, err, 'Something went wrong with the mailer. Please try again.');
}
/* an admin request with a JSON body, its event checked: cb(fb, decoded, body, eventId) */
function withEvent(req, res, limit, cb) {
  H.withAdminBody(req, res, limit || H.BODY_LIMITS.ai, function (fb, decoded, body) {
    var eventId = H.eventIdOr400(res, body.eventId);
    if (eventId) cb(fb, decoded, body, eventId);
  });
}
function docOr400(res, doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.blocks)) { sendJson(res, 400, { error: 'doc required' }); return false; }
  return true;
}
function slugOf(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event'; }
function fileNameOf(m, ev) { return engine.mailerFileName ? engine.mailerFileName(m, ev) : slugOf(ev.name) + '-' + m.id + '.html'; }
/* an exported file: never cached, and it says whether it went out tracked (the studio's toast reads it) */
function sendExport(res, type, name, body, tracked) {
  res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + name + '"', 'Cache-Control': 'no-store', 'X-Mailer-Tracked': tracked ? 'yes' : 'no' });
  res.end(body);
}

/* GET /api/promo/mailers?eventId= */
function handleCatalog(req, res) {
  H.withAdmin(req, res, function (fb) {
    var eventId = H.eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    Promise.all([eventFor(fb, eventId, req), listSavesForEvent(fb, eventId)]).then(function (r) {
      var ev = r[0].ev;
      sendJson(res, 200, Object.assign({
        event: { name: ev.name, hashtag: ev.hashtag, dateLabel: ev.dateLabel, venue: ev.venue || ev.city, micrositeUrl: ev.micrositeUrl,
          siteAccent: ev.siteAccent, siteTheme: ev.siteTheme, bannerUrl: ev.keyVisualUrl || null, portal: ev.portal },
        saves: r[1], tones: engine.TONE_OPTIONS
      }, engine.buildMailerCatalog(ev), {
        /* false: this event's exports go out untracked, so the studio hides "Link tracking" (it would do nothing) */
        tracking: trackingOn(tracker(), eventId, r[0].stored)
      }));
    }).catch(function (err) { fail(res, 'catalog', err); });
  });
}

/* GET /api/promo/mailer/saves?eventId=&mailerId= */
function handleSaves(req, res) {
  H.withAdmin(req, res, function (fb) {
    var q = queryOf(req), eventId = H.eventIdOr400(res, q.get('eventId'));
    if (!eventId) return;
    var m = engine.getMailer(String(q.get('mailerId') || ''));
    if (!m) return sendJson(res, 404, { error: 'unknown mailer' });
    listSaves(fb, eventId, m.id).then(function (saves) { sendJson(res, 200, { saves: saves }); }).catch(function (err) { fail(res, 'saves', err); });
  });
}

/* GET /api/promo/mailer/roster?eventId= — the event's whole roster for the studio's pickers (the platform's
   GET /api/editor/assets?all=1): every speaker, partner and session, with or without a picture */
function handleRoster(req, res) {
  H.withAdmin(req, res, function (fb) {
    var eventId = H.eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    eventFor(fb, eventId, req).then(function (got) {
      var ev = got.ev;
      sendJson(res, 200, {
        event: eventId, portal: ev.portal,
        speakers: ev.speakers.map(function (s) { return { id: s.id, name: s.name, designation: s.designation, company: s.company, photoUrl: s.photoUrl, group: s.group }; }),
        sponsors: [].concat.apply([], ev.sponsorTiers.map(function (t) { return t.sponsors; })).map(function (s) { return { id: s.id, title: s.title, logoUrl: s.logoUrl, tier: s.tier }; }),
        sessions: ev.sessions.map(function (x) {
          return { id: x.id, title: x.title, time: x.time || [x.start, x.end].filter(Boolean).join(' – '), day: x.day || '',
            who: (x.speakers || []).map(function (sp) { return sp.name; }).filter(Boolean).join(' • ') };
        })
      });
    }).catch(function (err) { fail(res, 'roster', err); });
  });
}

/* POST /api/promo/mailer/doc */
function handleDoc(req, res) {
  withEvent(req, res, 0, function (fb, decoded, body, eventId) {
    var m = engine.getMailer(String(body.mailerId || ''));
    if (!m) return sendJson(res, 404, { error: 'unknown mailer' });
    eventFor(fb, eventId, req).then(function (got) {
      var ev = got.ev;
      var hit = body.fresh ? Promise.resolve(null) : body.saveId ? getSave(fb, eventId, m.id, String(body.saveId)) : latestSave(fb, eventId, m.id);
      return hit.then(function (h) {
        var doc = h ? engine.migrateSponsorTiers(h.doc, ev) : engine.buildDoc(m, ev, body.params || {});
        sendJson(res, 200, { doc: doc, saved: !!h, save: h ? h.meta : null, html: engine.renderDoc(doc, ev, { editor: true }) });
      });
    }).catch(function (err) { fail(res, 'doc', err); });
  });
}

/* POST /api/promo/mailer/relayout */
function handleRelayout(req, res) {
  withEvent(req, res, 0, function (fb, decoded, body, eventId) {
    var m = engine.getMailer(String(body.mailerId || ''));
    if (!m) return sendJson(res, 404, { error: 'unknown mailer' });
    if (!docOr400(res, body.doc)) return;
    eventFor(fb, eventId, req).then(function (got) {
      var ev = got.ev, avail = m.requires(ev);
      if (!avail.ok) return sendJson(res, 400, { error: 'this event has no ' + avail.missing.join(', '), missing: avail.missing });
      var out = engine.relayout(body.doc, m, ev, body.params || {});
      sendJson(res, 200, { doc: out.doc, report: out.report, html: engine.renderDoc(out.doc, ev, { editor: true }) });
    }).catch(function (err) { fail(res, 'relayout', err); });
  });
}

/* POST /api/promo/mailer/import?eventId= — raw bytes of an .html / .htm / .eml file, at most 2 MB */
var IMPORT_MAX = 2 * 1024 * 1024;
function handleImport(req, res) {
  H.withAdmin(req, res, function (fb) {
    var eventId = H.eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    var chunks = [], size = 0, refused = false;
    req.on('data', function (c) {
      if (refused) return;
      size += c.length;
      if (size > IMPORT_MAX) { refused = true; sendJson(res, 413, { error: 'That file is larger than 2 MB.' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (refused) return;
      var raw = Buffer.concat(chunks);
      if (!raw.length) return sendJson(res, 400, { error: 'empty upload' });
      eventFor(fb, eventId, req).then(function (got) {
        var ev = got.ev, out = engine.importHtml(raw.toString('utf8'), ev);
        if (!out.report.ok) return sendJson(res, out.report.bytes ? 413 : 400, { error: out.report.warnings[0] || 'could not read that file', report: out.report });
        sendJson(res, 200, { doc: out.doc, report: out.report, html: engine.renderDoc(out.doc, ev, { editor: true }) });
      }).catch(function (err) { fail(res, 'import', err); });
    });
    req.on('error', function () { if (!refused) sendJson(res, 400, { error: 'The upload did not come through.' }); });
  });
}

/* POST /api/promo/mailer/render — editor:true is the studio's own preview, never tracked. track:true (and no
   editor) is "Copy HTML": an export like a download, so it goes out through deliverables() and the answer adds
   tracked: true | false. It counts as a send even if the browser then fails to copy it, as on the platform. */
function handleRender(req, res) {
  withEvent(req, res, 0, function (fb, decoded, body, eventId) {
    if (!docOr400(res, body.doc)) return;
    eventFor(fb, eventId, req).then(function (got) {
      var ev = got.ev, pal = engine.renderCtx(ev, body.doc).p;
      var palette = { accent: pal.accent, primary: pal.primary, ink: pal.ink, cardBg: pal.cardBg, pageBg: pal.pageBg, tileBg: pal.tileBg };
      if (body.track && !body.editor) {
        return deliverables(fb, decoded, got, eventId, [{ doc: body.doc, mailerId: String(body.doc.mailerId || ''), save: { saveId: body.saveId, name: body.saveName } }])
          .then(function (r) { sendJson(res, 200, { html: r.html[0], palette: palette, tracked: r.tracked }); });
      }
      sendJson(res, 200, { html: engine.renderDoc(body.doc, ev, body.editor ? { editor: true } : {}), palette: palette });
    }).catch(function (err) { fail(res, 'render', err); });
  });
}

/* POST /api/promo/mailer/block */
function handleBlock(req, res) {
  withEvent(req, res, H.BODY_LIMITS.small, function (fb, decoded, body, eventId) {
    var type = String(body.type || '');
    if (!Object.prototype.hasOwnProperty.call(engine.BLOCK_SCHEMAS, type)) return sendJson(res, 400, { error: 'unknown block type' });
    eventFor(fb, eventId, req).then(function (got) { sendJson(res, 200, { block: engine.makeBlock(type, got.ev) }); })
      .catch(function (err) { fail(res, 'block', err); });
  });
}

/* POST /api/promo/mailer/save — saveId updates that version; without one a new version is made */
function handleSave(req, res) {
  withEvent(req, res, 0, function (fb, decoded, body, eventId) {
    var m = engine.getMailer(String(body.mailerId || ''));
    if (!m) return sendJson(res, 404, { error: 'unknown mailer' });
    if (!docOr400(res, body.doc)) return;
    var by = (decoded && decoded.email) || '';
    putSave(fb, eventId, m.id, { saveId: body.saveId ? String(body.saveId) : null, name: body.name, doc: body.doc }, by).then(function (save) {
      return listSaves(fb, eventId, m.id).then(function (saves) {
        var created = save.created; delete save.created;
        sendJson(res, 200, { ok: true, save: save, saves: saves });
        logActivity(fb, eventId, decoded, created ? 'created' : 'updated', 'Mailer “' + save.name + '” (' + m.label + ') ' + (created ? 'saved as a new version' : 'saved'), { area: 'promotions' });
      });
    }).catch(function (err) { fail(res, 'save', err); });
  });
}

/* POST /api/promo/mailer/save/rename */
function handleRename(req, res) {
  withEvent(req, res, H.BODY_LIMITS.small, function (fb, decoded, body, eventId) {
    var m = engine.getMailer(String(body.mailerId || ''));
    if (!m || !body.saveId) return sendJson(res, 400, { error: 'mailerId + saveId required' });
    var name = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (!name) return sendJson(res, 400, { error: 'A version needs a name.' });
    listSaves(fb, eventId, m.id).then(function (list) {
      var it = list.filter(function (x) { return x.saveId === String(body.saveId); })[0];
      if (!it) return sendJson(res, 404, { error: 'no such version' });
      var next = uniqueName(name, list.filter(function (x) { return x.saveId !== it.saveId; }).map(function (x) { return x.name; }));
      return savesOf(fb, eventId).doc(it.saveId).update({ name: next, updatedAt: new Date().toISOString() }).then(function () {
        return listSaves(fb, eventId, m.id).then(function (saves) {
          sendJson(res, 200, { ok: true, save: Object.assign({}, it, { name: next }), saves: saves });
          logActivity(fb, eventId, decoded, 'updated', 'Mailer “' + it.name + '” renamed to “' + next + '”', { area: 'promotions' });
        });
      });
    }).catch(function (err) { fail(res, 'rename', err); });
  });
}

/* POST /api/promo/mailer/save/delete */
function handleDelete(req, res) {
  withEvent(req, res, H.BODY_LIMITS.small, function (fb, decoded, body, eventId) {
    var m = engine.getMailer(String(body.mailerId || ''));
    if (!m || !body.saveId) return sendJson(res, 400, { error: 'mailerId + saveId required' });
    getSave(fb, eventId, m.id, String(body.saveId)).then(function (hit) {
      var gone = hit ? savesOf(fb, eventId).doc(String(body.saveId)).delete().then(function () { return true; }) : Promise.resolve(false);
      return gone.then(function (removed) {
        return listSaves(fb, eventId, m.id).then(function (saves) {
          sendJson(res, 200, { ok: true, removed: removed, saves: saves });
          if (removed) logActivity(fb, eventId, decoded, 'deleted', 'Mailer “' + hit.meta.name + '” (' + m.label + ') deleted', { area: 'promotions' });
        });
      });
    }).catch(function (err) { fail(res, 'delete', err); });
  });
}

/* POST /api/promo/mailer/reset — one version (saveId), else every version of this mailer */
function handleReset(req, res) {
  withEvent(req, res, H.BODY_LIMITS.small, function (fb, decoded, body, eventId) {
    var m = engine.getMailer(String(body.mailerId || ''));
    if (!m) return sendJson(res, 404, { error: 'unknown mailer' });
    var drop = body.saveId
      ? getSave(fb, eventId, m.id, String(body.saveId)).then(function (h) { return h ? savesOf(fb, eventId).doc(String(body.saveId)).delete().then(function () { return 1; }) : 0; })
      : savesOf(fb, eventId).where('mailerId', '==', m.id).get().then(function (s) {
        return Promise.all(s.docs.map(function (d) { return d.ref.delete(); })).then(function () { return s.size; });
      });
    drop.then(function (n) {
      sendJson(res, 200, { ok: true, removed: n });
      if (n) logActivity(fb, eventId, decoded, 'deleted', n + ' version' + (n === 1 ? '' : 's') + ' of the ' + m.label + ' mailer deleted', { area: 'promotions' });
    }).catch(function (err) { fail(res, 'reset', err); });
  });
}

/* POST /api/promo/mailer/download — what goes out is decided by pickDownload(): the document on screen as .html;
   one named mailer's latest saved version (else a fresh one) as .html; otherwise, the latest saved version (else
   a fresh one) of each mailer asked for — all of them but Blank when none is named — as a ZIP with subjects.json.
   Each file goes out through deliverables(), so every answer says whether it is tracked (X-Mailer-Tracked) —
   except test:true, the same mail with no tracking and no send recorded, for checking your own work: opening it
   would otherwise count your own views. */
function handleDownload(req, res) {
  withEvent(req, res, 0, function (fb, decoded, body, eventId) {
    eventFor(fb, eventId, req).then(function (got) {
      var ev = got.ev, pick = pickDownload(body, ev);
      if (pick.kind === 'none') return sendJson(res, pick.status, { error: pick.error });
      if (pick.kind === 'doc') {
        if (!docOr400(res, body.doc)) return;
        var mailerId = String(body.doc.mailerId || (body.mailerIds || [])[0] || '');
        var one = engine.getMailer(mailerId), fname = one ? fileNameOf(one, ev) : 'mailer.html';
        if (body.test) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + fname + '"', 'Cache-Control': 'no-store' });
          return res.end(engine.renderDoc(body.doc, ev));
        }
        return deliverables(fb, decoded, got, eventId, [{ doc: body.doc, mailerId: mailerId, save: { saveId: body.saveId, name: body.saveName } }])
          .then(function (r) { sendExport(res, 'text/html; charset=utf-8', fname, r.html[0], r.tracked); });
      }
      var mailers = pick.kind === 'one' ? [pick.mailer] : pick.mailers;
      return Promise.all(mailers.map(function (m) {
        return (body.fresh ? Promise.resolve(null) : latestSave(fb, eventId, m.id)).then(function (h) {
          return { m: m, doc: h ? engine.migrateSponsorTiers(h.doc, ev) : engine.buildDoc(m, ev, {}), save: h ? h.meta : null };
        });
      })).then(function (built) {
        /* one send per file, all recorded in one write */
        return deliverables(fb, decoded, got, eventId, built.map(function (b) { return { doc: b.doc, mailerId: b.m.id, save: b.save }; })).then(function (r) {
          if (pick.kind === 'one') return sendExport(res, 'text/html; charset=utf-8', fileNameOf(built[0].m, ev), r.html[0], r.tracked);
          var zip = new JSZip(), meta = {};
          built.forEach(function (b, i) {
            var name = fileNameOf(b.m, ev);
            zip.file(name, r.html[i]);
            meta[name] = Object.assign({ subject: b.doc.subject, preheader: b.doc.preheader }, b.save ? { version: b.save.name } : {});
          });
          zip.file('subjects.json', JSON.stringify(meta, null, 2));
          return zip.generateAsync({ type: 'nodebuffer' }).then(function (buf) {
            sendExport(res, 'application/zip', slugOf(ev.name) + '-mailers.zip', buf, r.tracked);
          });
        });
      });
    }).catch(function (err) { fail(res, 'download', err); });
  });
}

/* POST /api/promo/mailer/ai — action: subjects | rewrite | polish | enhance (the platform's four) */
function handleAi(req, res) {
  withEvent(req, res, 0, function (fb, decoded, body, eventId) {
    eventFor(fb, eventId, req).then(function (got) {
      var ev = got.ev, doc = body.doc;
      var mailer = engine.getMailer(String((doc && doc.mailerId) || ''));
      var kind = (mailer && mailer.label) || 'promotional';
      engine.setAiCaller(aiCallerFor(fb, eventId, decoded && decoded.email));
      var copyOf = function (b) { return engine.COPY_FIELDS[b.type] || []; };
      var job;
      if (body.action === 'subjects') {
        var text = ((doc && doc.blocks) || []).reduce(function (all, b) {
          return all.concat(copyOf(b).map(function (f) { return b.props && b.props[f]; }));
        }, []).filter(Boolean).join('\n').slice(0, 1500);
        job = engine.suggestSubjects(ev, { tone: body.tone, kind: kind, current: doc && doc.subject, body: text }).then(function (options) { return { options: options }; });
      } else if (body.action === 'rewrite') {
        if (!String(body.text || '').trim()) return sendJson(res, 400, { error: 'nothing to rewrite' });
        job = engine.rewriteField(ev, { text: String(body.text), tone: body.tone, what: String(body.what || 'email copy'), instruction: body.instruction });
      } else if (body.action === 'polish') {
        if (!docOr400(res, doc)) return;
        var items = [];
        doc.blocks.forEach(function (b) {
          copyOf(b).forEach(function (f) {
            var v = String((b.props && b.props[f]) == null ? '' : b.props[f]).trim();
            if (v) items.push({ ref: b.id + '.' + f, what: b.type + ' ' + f, text: v });
          });
        });
        if (!items.length) return sendJson(res, 400, { error: 'no copy fields to polish' });
        job = engine.polishCopy(ev, { items: items, tone: body.tone, kind: kind }).then(function (out) { return { items: out.items || [], summary: out.summary || '' }; });
      } else if (body.action === 'enhance') {
        if (!docOr400(res, doc)) return;
        var blocks = doc.blocks.map(function (b) {
          var fields = {};
          copyOf(b).forEach(function (f) { var v = String((b.props && b.props[f]) == null ? '' : b.props[f]).trim(); if (v) fields[f] = v; });
          return { id: b.id, type: b.type, fields: fields, empty: engine.blockIsEmpty(b, ev, doc) };
        });
        job = engine.enhanceMailer(ev, { kind: kind, tone: body.tone, blocks: blocks, theme: doc.theme, background: doc.background, accent: doc.accent });
      } else return sendJson(res, 400, { error: 'unknown action' });
      return job.then(function (out) { sendJson(res, 200, out); });
    }).catch(function (err) { fail(res, 'ai', err); });
  });
}

/* ---------- icons: the house set (assets/icons) and an event's portal's own uploads ---------- */

var ICON_MAX = 2 * 1024 * 1024, ICON_PX = 144;
var fs = require('fs'), path = require('path');
var ICON_DIR = path.join(__dirname, '..', '..', 'assets', 'icons');
function houseIcons() {
  var names = {};
  try { fs.readdirSync(ICON_DIR).forEach(function (f) { var m = /^([a-z0-9-]+)-(dark|light)\.png$/.exec(f); if (m) names[m[1]] = 1; }); } catch (e) { /* none */ }
  return Object.keys(names).sort().map(function (n) { return { id: n, name: n, house: true, url: engine.ASSET_BASE + '/assets/icons/' + n + '-dark.png', urlLight: engine.ASSET_BASE + '/assets/icons/' + n + '-light.png' }; });
}
function iconKeyFor(fb, eventId, req) {
  return promo.buildKit(fb, eventId, req, {}).then(function (kit) { return (kit.brand && kit.brand.portal && kit.brand.portal.slug) || ('event-' + eventId); });
}
function iconsOf(fb, key) { return fb.db.collection('promoIcons').doc(key).collection('icons'); }

/* GET /api/promo/icons?eventId= */
function handleIcons(req, res) {
  H.withAdmin(req, res, function (fb) {
    var eventId = H.eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    iconKeyFor(fb, eventId, req).then(function (key) {
      return iconsOf(fb, key).orderBy('at', 'desc').limit(200).get().then(function (s) {
        sendJson(res, 200, { house: houseIcons(), uploaded: s.docs.map(function (d) { var v = d.data(); return { id: d.id, name: v.name, url: v.url, at: v.at, width: v.width, height: v.height }; }) });
      });
    }).catch(function (err) { fail(res, 'icons', err); });
  });
}
/* POST /api/promo/icons?eventId=&name= — raw image bytes; normalised to a PNG of at most 144 px */
function handleIconUpload(req, res) {
  H.withAdmin(req, res, function (fb, decoded) {
    var q = queryOf(req), eventId = H.eventIdOr400(res, q.get('eventId'));
    if (!eventId) return;
    var chunks = [], size = 0, refused = false;
    req.on('data', function (c) {
      if (refused) return;
      size += c.length;
      if (size > ICON_MAX) { refused = true; sendJson(res, 413, { error: 'That file is too large. An icon renders at 26–72px — keep it under 2MB.' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (refused) return;
      var raw = Buffer.concat(chunks);
      if (!raw.length) return sendJson(res, 400, { error: 'empty upload' });
      var sharp;
      try { sharp = require('sharp'); } catch (e) { return sendJson(res, 503, { error: 'Icons cannot be uploaded right now.' }); }
      sharp(raw, { limitInputPixels: 40e6 }).rotate().resize(ICON_PX, ICON_PX, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
        .then(function (out) {
          return iconKeyFor(fb, eventId, req).then(function (key) {
            var id = 'i' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
            var file = fb.bucket.file('promo-icons/' + key + '/' + id + '.png');
            return file.save(out.data, { resumable: false, metadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' } })
              .then(function () { return file.makePublic(); })
              .then(function () {
                var url = 'https://storage.googleapis.com/' + fb.bucket.name + '/promo-icons/' + key + '/' + id + '.png';
                var name = String(q.get('name') || 'icon').replace(/[^\w .-]+/g, '').slice(0, 60) || 'icon';
                var row = { name: name, url: url, at: Date.now(), width: out.info.width, height: out.info.height, bytes: out.data.length, by: (decoded && decoded.email) || '' };
                return iconsOf(fb, key).doc(id).set(row).then(function () { sendJson(res, 200, Object.assign({ id: id }, row)); });
              });
          });
        }, function () { sendJson(res, 400, { error: 'That file is not a picture we can read. Upload a PNG, JPG, GIF or WebP.' }); })
        .catch(function (err) { fail(res, 'icon upload', err); });
    });
  });
}
/* DELETE /api/promo/icons?eventId=&id= — idempotent */
function handleIconDelete(req, res) {
  H.withAdmin(req, res, function (fb) {
    var q = queryOf(req), eventId = H.eventIdOr400(res, q.get('eventId')), id = String(q.get('id') || '');
    if (!eventId) return;
    if (!/^i[a-z0-9]{6,30}$/.test(id)) return sendJson(res, 400, { error: 'unknown icon' });
    iconKeyFor(fb, eventId, req).then(function (key) {
      return iconsOf(fb, key).doc(id).get().then(function (d) {
        if (!d.exists) return sendJson(res, 200, { ok: true, removed: false });
        return d.ref.delete().then(function () {
          return fb.bucket.file('promo-icons/' + key + '/' + id + '.png').delete().catch(function () {});
        }).then(function () { sendJson(res, 200, { ok: true, removed: true }); });
      });
    }).catch(function (err) { fail(res, 'icon delete', err); });
  });
}

module.exports = {
  wire, handleCatalog, handleSaves, handleRoster, handleDoc, handleRelayout, handleImport, handleRender, handleBlock,
  handleSave, handleRename, handleDelete, handleReset, handleDownload, handleAi, handleIcons, handleIconUpload, handleIconDelete
};
module.exports._test = { entityOf, awardOf, toLlmSchema, uniqueName, absolute, deliverables, pickDownload, tracker, trackingOn };
