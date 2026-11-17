/* ETB2B EventSphere — who may use it, as what, and where. The owner, 10 Nov 2026: "Create a access management
   section for this project where I can give access to other users", and their choices:

     WHO GETS IN   every @timesinternet.in Google account, at the default role (Editor on every portal, as before
                   this existed), and people invited with any other Google account; anyone — colleagues included —
                   can be given another role or blocked.
     ROLES         admin     everything, and managing access
                   approver  approves publishing, deletes events, takes sites offline (this replaces the approvers
                             list of config/approvals: an approver is an Approver or an Admin here)
                   editor    creates and edits events, sites and promotions, and sends them for approval
                   viewer    sees everything it may, changes nothing
     SCOPE         each person works in the ET portals chosen for them; an admin sees every portal
     SECTIONS      (the owner, 17 Nov 2026: "Add option to allocate functions of this platform like I want to share
                   below sections only with the developers") each person opens only the parts of the app chosen for
                   them — the event's own sections (Dashboard … Settings, the rail) and the main pages' functions
                   (Create Event, the speaker & sponsor library, the all-events Activity log, Settings) — all of them
                   unless an admin chooses otherwise; a "Developer" preset holds the owner's list. The server refuses
                   a request for a section someone does not have (sectionsFor), the pages hide it (auth.js).
     FIRST ADMIN   sachitanand.rai@timesinternet.in

   The list lives in ACCESS_DOC (config/access):
     { defaultRole: 'editor' | 'viewer',
       members: { '<email>': { role: admin|approver|editor|viewer|blocked, portals: ['*'] | [slug…],
                               sections: ['*'] | [section id…] (SECTIONS; missing = all), name, addedBy, addedAt,
                               updatedBy, updatedAt } },
       updatedAt, updatedBy }
   and every change in its `log` subcollection: { at, by, action, email, before, after }.
   Until the first change is saved the document does not exist, and the list is read as its starting point: the first
   admin, the approvers config/approvals named (as Approvers), every company account an Editor. Nothing is written by
   reading — not by a server starting up, not by a test harness pointed at production.

   Reading is cached for CACHE_MS (and dropped at once by a change made through this server). A read that fails keeps
   the last list that was read; with none, it falls back to the rule before this existed (company accounts as Editors
   on every portal, nobody from outside), so an outage of the database never locks the team out nor lets anyone in.

     readConfig(fb)                     -> Promise<cfg>
     accessOf(cfg, decoded)             -> { email, role, portals, sections, member } | { denied: 'blocked' | 'outside' | 'signin' }
     sectionOk(access, id)              -> boolean: may this person open section id (SECTIONS)
     sectionsFor(method, path)          -> [section id] any one of which a request needs, or null (no section)
     sectionSentence(id)                -> what a request refused for its section answers
     aiRoute(path)                      -> true for the assistant's own routes, which need section 'ai' as well
     sectionOfUrl(url), sectionOfRoute(route), sectionLabel(id) -> the section an address or a console route
                                           belongs to (null for none), and its name (auth.js has the same rules)
     can(access, need)                  -> boolean (need: viewer < editor < approver < admin)
     portalOk(access, portal)           -> boolean
     eventOk(access, eventData)         -> boolean (eventData: the event document, or null for one that does not exist)
     approverEmails(cfg)                -> [email] of Approvers and Admins
     approversWith(cfg, listed)         -> the same, from the starting point made of `listed` (config/approvals'
                                           raw `approvers`, read now) while nothing has been saved
     needFor(method, path)              -> 'viewer' | 'editor' | 'admin': what a request needs (VIEWER_WRITES below)
     everywhereOnly(path)               -> true for the reports over every portal
     refusedSentence, outsideSentence, everywhereSentence -> what a refused request answers
     publicView(cfg, access)            -> what GET /api/access answers (all of it for an admin, one's own for others)
     setMember(fb, actor, input)        -> Promise<cfg>  (input: { email, role, portals, sections, name }; sections
                                           left out keeps what the person had)
     removeMember(fb, actor, email)     -> Promise<cfg>
     setDefaultRole(fb, actor, role)    -> Promise<cfg>
     readLog(fb, n)                     -> Promise<[entry]>
     deniedSentence(why)                -> the sentence a refused account is shown */
'use strict';

var ALLOWED_DOMAIN = String(process.env.ALLOWED_EMAIL_DOMAIN || 'timesinternet.in').toLowerCase();
var FIRST_ADMIN = 'sachitanand.rai@timesinternet.in';
var ROLES = ['admin', 'approver', 'editor', 'viewer'];
var RANK = { viewer: 1, editor: 2, approver: 3, admin: 4 };
var DEFAULT_ROLES = ['editor', 'viewer'];
var ALL = '*';
var CACHE_MS = 15000;
var MAX_MEMBERS = 500;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var LABELS = { admin: 'Admin', approver: 'Approver', editor: 'Editor', viewer: 'Viewer', blocked: 'No access' };
/* The parts of the app an admin can give or withhold. 'event' ones are the event rail's items (sidebar.js
   RAIL_SECTIONS, same ids); 'main' ones are the main pages' functions. */
var SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', group: 'event' },
  { id: 'content', label: 'Content', group: 'event' },
  { id: 'speakers', label: 'Speakers', group: 'event' },
  { id: 'agenda', label: 'Agenda', group: 'event' },
  { id: 'sponsors', label: 'Sponsors', group: 'event' },
  { id: 'design', label: 'Site editor', group: 'event' },
  { id: 'payment', label: 'Payment', group: 'event' },
  { id: 'marketing', label: 'Promotions', group: 'event' },
  { id: 'audience', label: 'Reporting', group: 'event' },
  { id: 'activity', label: 'Activity log', group: 'event' },
  { id: 'settings', label: 'Settings', group: 'event' },
  { id: 'create', label: 'Create Event', group: 'main' },
  { id: 'library', label: 'Speaker & sponsor library', group: 'main' },
  { id: 'all-activity', label: 'Activity log (all events)', group: 'main' },
  { id: 'app-settings', label: 'Settings (access and approvals)', group: 'main' },
  /* the assistant itself (the owner, 17 Nov 2026: "I want to show AI bot on access based"): its button and panel on
     every page, the editor's "Edit with AI" and "Redesign with AI" (AI_ROUTES) */
  { id: 'ai', label: 'ETB2B AI', group: 'ai' }
];
var SECTION_IDS = SECTIONS.map(function (x) { return x.id; });
/* ready-made choices in Settings › Access (the owner's list for the developers, 17 Nov 2026) */
var PRESETS = [
  { id: 'developer', label: 'Developer', sections: ['dashboard', 'content', 'speakers', 'agenda', 'sponsors', 'design', 'activity', 'settings'] }
];
function sectionLabel(id) { var x = SECTIONS.filter(function (s) { return s.id === id; })[0]; return x ? x.label : id; }
function cleanSections(v) {
  if (v == null) return [ALL];
  var list = Array.isArray(v) ? v : [v];
  if (list.indexOf(ALL) !== -1) return [ALL];
  var out = [];
  SECTION_IDS.forEach(function (id) { if (list.indexOf(id) !== -1) out.push(id); });
  return out.length === SECTION_IDS.length ? [ALL] : out;
}

function docPath() { return String(process.env.ACCESS_CONFIG_DOC || 'config/access'); }
function docRef(fb) { var p = docPath().split('/'); return fb.db.collection(p[0]).doc(p[1]); }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function cleanEmail(v) { var e = String(v || '').trim().toLowerCase(); return EMAIL_RE.test(e) && e.length <= 200 ? e : ''; }
function isCompany(email) { return String(email || '').slice(-(ALLOWED_DOMAIN.length + 1)) === '@' + ALLOWED_DOMAIN; }
function isPortal(slug) { try { return require('./et-events').isPortal(slug); } catch (e) { return false; } }
function cleanPortals(v) {
  var list = Array.isArray(v) ? v : [v];
  if (list.indexOf(ALL) !== -1) return [ALL];
  var out = [];
  list.forEach(function (p) { p = String(p || '').trim().toLowerCase(); if (isPortal(p) && out.indexOf(p) === -1) out.push(p); });
  return out;
}

/* the list as stored, made safe to read: unknown roles dropped, portals checked, addresses lower case */
function normalise(raw) {
  raw = isObj(raw) ? raw : {};
  var members = {};
  Object.keys(isObj(raw.members) ? raw.members : {}).slice(0, MAX_MEMBERS).forEach(function (k) {
    var e = cleanEmail(k), m = raw.members[k];
    if (!e || !isObj(m)) return;
    var role = ROLES.indexOf(m.role) !== -1 || m.role === 'blocked' ? m.role : '';
    if (!role) return;
    var portals = role === 'admin' || role === 'blocked' ? [ALL] : cleanPortals(m.portals);
    var sections = role === 'admin' || role === 'blocked' ? [ALL] : cleanSections(m.sections);
    members[e] = { role: role, portals: portals.length ? portals : [ALL], sections: sections.length ? sections : [ALL], name: String(m.name || '').slice(0, 120),
      addedBy: String(m.addedBy || ''), addedAt: m.addedAt || null, updatedBy: String(m.updatedBy || ''), updatedAt: m.updatedAt || null };
  });
  return { defaultRole: DEFAULT_ROLES.indexOf(raw.defaultRole) !== -1 ? raw.defaultRole : 'editor', members: members,
    updatedAt: raw.updatedAt || null, updatedBy: String(raw.updatedBy || ''), stored: raw.stored === true };
}
/* the starting point while nothing has been saved: the first admin, the approvers config/approvals named */
function startingPoint(approvers) {
  var members = {};
  (Array.isArray(approvers) ? approvers : []).forEach(function (a) {
    var e = cleanEmail(a);
    if (e && e !== FIRST_ADMIN) members[e] = { role: 'approver', portals: [ALL], name: '', addedBy: 'config/approvals', addedAt: null };
  });
  members[FIRST_ADMIN] = { role: 'admin', portals: [ALL], name: '', addedBy: 'the owner\'s choice', addedAt: null };
  return normalise({ defaultRole: 'editor', members: members });
}

/* kept per database handle (fb.db): a test's fake database never sees another's list */
var cache = { db: null, cfg: null, at: 0, good: null };
function forget() { cache.cfg = null; cache.at = 0; }
function readConfig(fb, opts) {
  var now = Date.now();
  if (cache.db !== fb.db) cache = { db: fb.db, cfg: null, at: 0, good: null };
  if (!(opts && opts.fresh) && cache.cfg && now - cache.at < CACHE_MS) return Promise.resolve(cache.cfg);
  return docRef(fb).get().then(function (snap) {
    if (snap.exists) return Object.assign(normalise(snap.data()), { stored: true });
    return fb.db.collection('config').doc('approvals').get().then(function (a) {
      return startingPoint(a.exists ? (a.data() || {}).approvers : []);
    }, function () { return startingPoint([]); });
  }).then(function (cfg) {
    if (cache.db === fb.db) { cache.cfg = cfg; cache.at = Date.now(); cache.good = cfg; }
    return cfg;
  }, function (err) {
    console.error('access: the access list could not be read — ' + (err && err.message) + (cache.good ? '; the last one read is used' : '; company accounts are Editors meanwhile'));
    return cache.good || Object.assign(startingPoint([]), { fallback: true });
  });
}

/* a Google sign-in with a verified address */
function signedIn(decoded) {
  return !!decoded && typeof decoded.email === 'string' && decoded.email_verified === true &&
    !!decoded.firebase && decoded.firebase.sign_in_provider === 'google.com';
}
function accessOf(cfg, decoded) {
  if (!signedIn(decoded)) return { denied: 'signin' };
  var email = decoded.email.toLowerCase(), m = cfg && cfg.members ? cfg.members[email] : null;
  if (m) {
    if (m.role === 'blocked') return { denied: 'blocked' };
    return { email: email, role: m.role, portals: m.role === 'admin' ? [ALL] : m.portals,
      sections: m.role === 'admin' ? [ALL] : (m.sections || [ALL]), member: true };
  }
  if (isCompany(email)) return { email: email, role: (cfg && cfg.defaultRole) || 'editor', portals: [ALL], sections: [ALL], member: false };
  return { denied: 'outside' };
}
function can(access, need) { return !!access && !access.denied && (RANK[access.role] || 0) >= (RANK[need] || 99); }
function everywhere(access) { return !!access && (access.role === 'admin' || (access.portals || []).indexOf(ALL) !== -1); }
function portalOk(access, portal) { return everywhere(access) || (!!portal && (access.portals || []).indexOf(portal) !== -1); }
/* An event this person may open: any, for someone on every portal; else one in their portals — or one still being
   made (no createdAt yet, or no event at all: Create Event's steps write before the event exists), or one without a
   portal that they made themselves. */
function eventOk(access, ev) {
  if (everywhere(access)) return true;
  if (!ev || !ev.createdAt) return true;
  if (ev.portal) return portalOk(access, ev.portal);
  return String(ev.createdBy || '').toLowerCase() === String(access.email || '');
}
function sectionOk(access, id) {
  if (!access || access.denied) return false;
  if (access.role === 'admin') return true;
  var list = access.sections || [ALL];
  return list.indexOf(ALL) !== -1 || list.indexOf(id) !== -1;
}
/* ---------- which section a request belongs to ----------
   A request that changes something belongs to the section whose screen makes it; a few reads carry what only that
   section shows (registrants, promotion audiences, the event's history, the all-events log). Routes several
   sections use (the event's own record, uploads, share links, the site's records, previews) belong to none, so
   every section that needs them keeps working. A list means any one of them will do. */
var WRITE_SECTIONS = {
  '/api/event/speakers': ['speakers'], '/api/event/speaker-groups': ['speakers'], '/api/event/speaker-photos/find': ['speakers'],
  '/api/event/sessions': ['agenda'], '/api/event/agenda-groups': ['agenda'],
  '/api/event/partners': ['sponsors'], '/api/event/partner-tiers': ['sponsors'],
  '/api/event/gallery': ['content'], '/api/event/faqs': ['content'], '/api/event/contacts': ['content'],
  '/api/event/site': ['design'], '/api/event/theme': ['design'], '/api/event/section-edges': ['design'],
  '/api/event/phone-banner': ['design'], '/api/event/live-view': ['design'], '/api/chat-edit': ['design'],
  '/api/chat/turn': ['design'], '/api/chat/doc-pictures': ['design'], '/api/redesign-section': ['design'],
  '/api/suggest-design': ['design'],
  '/api/event/logo-unit': ['design', 'content'], '/api/event/logo-unit-dark': ['design', 'content'],
  '/api/event/hero-video': ['design', 'content'], '/api/event/hero-video/upload': ['design', 'content'],
  '/api/event/hero-video/check': ['design', 'content'],
  '/api/event/site/repair': ['design', 'dashboard'],
  '/api/event/forms': ['settings', 'design'], '/api/event/forms/default': ['settings', 'design'], '/api/event/forms/order': ['settings', 'design'],
  '/api/event/seo': ['settings'], '/api/event/seo/write': ['settings'], '/api/event/unpublish': ['settings'],
  '/api/event/promo-templates': ['marketing'], '/api/event/promo-audiences': ['marketing'], '/api/event/leads/bulk': ['marketing'],
  '/api/event/registrations': ['audience'], '/api/event/registrations/status': ['audience'], '/api/event/registrations/export': ['audience'],
  '/api/extract-brief': ['create'], '/api/ingest-source': ['create'], '/api/plan-structure': ['create'],
  '/api/generate-content': ['create'], '/api/generate/cancel': ['create'], '/api/brief-photos': ['create'],
  '/api/me/create-draft': ['create'], '/api/me/create-draft/file': ['create'], '/api/import-lovable': ['create'],
  '/api/event/clone': ['create'], '/api/event/ai-hero': ['create'],
  '/api/library/build': ['library'],
  '/api/settings/approvals': ['app-settings']
};
var READ_SECTIONS = {
  '/api/event/registrations': ['audience'], '/api/event/registrations/export': ['audience'],
  '/api/insights': ['audience', 'dashboard'], '/api/event/dashboard-stats': ['dashboard'],
  '/api/event/promo-templates': ['marketing'], '/api/event/promo-audiences': ['marketing'],
  '/api/event/history': ['activity'], '/api/event/seo': ['settings'], '/api/event/seo/previous': ['settings'],
  '/api/activity/all': ['all-activity']
};
function sectionsFor(method, path) {
  method = String(method || 'GET').toUpperCase(); path = String(path || '').split('?')[0];
  var read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  /* two promotion routes other sections read: the editor's picture copies (promo/image) and Content › Basics'
     details for posts and mailers (promo/details) */
  if (read && path === '/api/promo/image') return ['marketing', 'design'];
  if (read && path === '/api/promo/details') return ['marketing', 'content'];
  if (path.indexOf('/api/promo/') === 0) return ['marketing'];
  if (read) return READ_SECTIONS[path] || null;
  /* POST /api/event makes a new event (Create Event); PATCH and DELETE on it are shared */
  if (path === '/api/event') return method === 'POST' ? ['create'] : null;
  if (path.indexOf('/api/people/') === 0) return ['library'];
  return WRITE_SECTIONS[path] || null;
}
/* the section an address belongs to, as the pages see it (auth.js sectionOfUrl, the same rules): a page that is one
   section, or a view of the event console by its route; null for one that is no section's (the console's own
   address, a preview, a live site, the events list) */
var PAGE_SECTION = {
  'custom_editor.html': 'design', 'marketing.html': 'marketing', 'promo-mailer-studio.html': 'marketing',
  'promo-social-studio.html': 'marketing', 'mailer-performance.html': 'marketing',
  'audience-registrations.html': 'audience', 'create-event.html': 'create', 'people.html': 'library',
  'activity-log.html': 'all-activity', 'settings.html': 'app-settings'
};
function sectionOfRoute(route) {
  var parts = String(route || '').replace(/^#/, '').split('/'), sec = parts[0], tab = parts[1] || '';
  if (sec === 'content') return { speakers: 'speakers', agenda: 'agenda', sponsors: 'sponsors' }[tab] || 'content';
  if (sec === 'audience') return tab === 'insights' ? 'dashboard' : (tab === 'payments' ? 'payment' : 'audience');
  if (sec === 'settings') return tab === 'history' ? 'activity' : 'settings';
  return { dashboard: 1, design: 1, marketing: 1, activity: 1, payment: 1 }[sec] ? sec : null;
}
function sectionOfUrl(url) {
  var m = /^(?:[a-z]+:\/\/[^\/]+)?\/?([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/i.exec(String(url || ''));
  if (!m) return null;
  var page = m[1].replace(/^.*\//, '');
  if (page === 'edit-event.html') return m[2] ? sectionOfRoute(m[2]) : null;
  return PAGE_SECTION[page] || null;
}
/* the assistant's own routes: they need ETB2B AI as well as whatever section they belong to (the editor's chat and
   its reworks also need the Site editor) */
var AI_ROUTES = {
  '/api/dash-bot': 1, '/api/dash-bot/turn': 1, '/api/dash-bot/history': 1, '/api/chat-edit': 1, '/api/chat/turn': 1,
  '/api/chat/history': 1, '/api/chat/doc-pictures': 1, '/api/ai-habits': 1, '/api/ai-habits/shortcuts': 1,
  '/api/event/live-view': 1, '/api/redesign-section': 1
};
function aiRoute(path) { return !!AI_ROUTES[String(path || '').split('?')[0]]; }
function sectionSentence(ids) {
  ids = Array.isArray(ids) ? ids : [ids];
  return 'Your access does not include ' + ids.map(sectionLabel).join(' or ') + '. Ask an admin if you need it.';
}
function approverEmails(cfg) {
  var m = (cfg && cfg.members) || {};
  return Object.keys(m).filter(function (e) { return m[e].role === 'approver' || m[e].role === 'admin'; }).sort();
}
/* The approvers now: the stored list's Approvers and Admins — or, while nothing has been saved, the starting point
   made from config/approvals' `approvers` as they are now (`listed`, that document's raw value). */
function approversWith(cfg, listed) {
  return approverEmails(cfg && cfg.stored ? cfg : startingPoint(listed));
}
function deniedSentence(why) {
  if (why === 'blocked') return 'This account no longer has access to ETB2B EventSphere. Ask an admin if you need it back.';
  if (why === 'outside') return 'This Google account has not been given access to ETB2B EventSphere. Ask an admin to invite you, or sign in with your @' + ALLOWED_DOMAIN + ' account.';
  return 'Sign in with a Google account to use ETB2B EventSphere.';
}

/* ---------- what a request needs ----------
   A request that reads (GET, HEAD) needs Viewer; one that changes something needs Editor — except these, which
   store nothing anyone else sees (ETB2B AI on the dashboard keeps the person's own chat, and their own shortcuts;
   the working portal is the person's own; the mailer and post renders only draw what is saved) — and the access
   list's own changes
   need Admin. Who approves, deletes and takes sites offline is checked where that happens (the approvers are
   the Approvers and Admins here, lib/api.js approvalsConfig). */
var VIEWER_WRITES = {
  'POST /api/dash-bot': 1, 'POST /api/dash-bot/turn': 1, 'POST /api/ai-habits/shortcuts': 1, 'PUT /api/me/working-portal': 1,
  'POST /api/promo/mailer/doc': 1, 'POST /api/promo/mailer/render': 1, 'POST /api/promo/mailer/download': 1,
  'POST /api/promo/mailer/previews': 1, 'POST /api/promo/social/html': 1
};
/* reports over every event and portal: for people who work on every portal */
var EVERYWHERE_ONLY = {
  '/api/events/portal-evidence': 1, '/api/events/portal-backfill': 1, '/api/ai-report': 1, '/api/ai-report/resolve': 1
};
function needFor(method, path) {
  method = String(method || 'GET').toUpperCase(); path = String(path || '').split('?')[0];
  if (path.indexOf('/api/access') === 0) return method === 'GET' || method === 'HEAD' ? 'viewer' : 'admin';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'viewer';
  return VIEWER_WRITES[method + ' ' + path] ? 'viewer' : 'editor';
}
function everywhereOnly(path) { return !!EVERYWHERE_ONLY[String(path || '').split('?')[0]]; }
function portalNames(access) {
  var names = require('./et-events').PORTALS || {};
  return (access.portals || []).map(function (p) { return names[p] || p; }).join(', ');
}
/* the sentence a refused request answers with */
function refusedSentence(access, need) {
  if (need === 'admin') return 'Only an admin can change who has access. Ask an admin.';
  if (access && access.role === 'viewer') return 'You have view-only access (Viewer), so this can\'t be changed from your account. Ask an admin if you need Editor access.';
  return 'Your access (' + (LABELS[access && access.role] || 'none') + ') does not include this. Ask an admin.';
}
function outsideSentence(access, portal) {
  var names = require('./et-events').PORTALS || {};
  return 'This event is in ' + (names[portal] || 'a portal') + ', which is not one of your portals (' + portalNames(access) + '). Ask an admin if you need it.';
}
function everywhereSentence() { return 'This covers every portal, so it is for people who work on all portals. Ask an admin if you need it.'; }

function publicView(cfg, access) {
  var you = access && !access.denied ? { email: access.email, role: access.role, label: LABELS[access.role], portals: access.portals,
    sections: access.role === 'admin' ? [ALL] : (access.sections || [ALL]), member: !!access.member } : null;
  var out = { you: you, roles: ROLES.concat('blocked').map(function (r) { return { id: r, label: LABELS[r] }; }), canManage: can(access, 'admin'), defaultRole: cfg.defaultRole,
    sections: SECTIONS, presets: PRESETS,
    domain: ALLOWED_DOMAIN, stored: !!cfg.stored,
    /* who to ask */
    admins: Object.keys(cfg.members).filter(function (e) { return cfg.members[e].role === 'admin'; }).sort() };
  if (out.canManage) {
    out.members = Object.keys(cfg.members).sort(function (a, b) {
      var ra = RANK[cfg.members[a].role] || 0, rb = RANK[cfg.members[b].role] || 0;
      return ra === rb ? (a < b ? -1 : 1) : rb - ra;
    }).map(function (e) { return Object.assign({ email: e, label: LABELS[cfg.members[e].role], company: isCompany(e) }, cfg.members[e]); });
  }
  return out;
}

/* ---------- changes, by an admin ---------- */
function httpErr(status, message, code) { var e = new Error(message); e.status = status; e.code = code; return e; }
function admins(members) { return Object.keys(members).filter(function (e) { return members[e].role === 'admin'; }); }
/* one change, in a transaction: the list as it stands (or its starting point), the change, the checks, the log */
function change(fb, actor, describe) {
  actor = cleanEmail(actor);
  var ref = docRef(fb), now = new Date().toISOString(), entry = null;
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var startP = snap.exists ? Promise.resolve(normalise(snap.data())) : readConfig(fb, { fresh: true });
      return startP.then(function (cfg) {
        /* never a change on top of the stand-in used while the list cannot be read */
        if (cfg.fallback) throw httpErr(503, 'The access list could not be read just now, so nothing was changed. Please try again.', 'unavailable');
        var who = accessOf(cfg, { email: actor, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
        if (!can(who, 'admin')) throw httpErr(403, 'Only an admin can change who has access.', 'not-admin');
        var next = JSON.parse(JSON.stringify({ defaultRole: cfg.defaultRole, members: cfg.members }));
        entry = describe(next, cfg, now, actor);
        if (!entry) return null;
        if (!admins(next.members).length) throw httpErr(400, 'Someone has to stay an admin: make another person an admin first.', 'last-admin');
        if (Object.keys(next.members).length > MAX_MEMBERS) throw httpErr(400, 'The access list is full (' + MAX_MEMBERS + ' people).', 'too-many');
        tx.set(ref, { defaultRole: next.defaultRole, members: next.members, updatedAt: now, updatedBy: actor, stored: true });
        tx.set(ref.collection('log').doc(), Object.assign({ at: now, by: actor }, entry));
        return null;
      });
    });
  }).then(function () {
    forget();
    if (entry) console.log('access: ' + actor + ' — ' + entry.action + ' ' + (entry.email || '') + ' ' + JSON.stringify(entry.before) + ' -> ' + JSON.stringify(entry.after));
    return readConfig(fb, { fresh: true });
  });
}
function setMember(fb, actor, input) {
  input = isObj(input) ? input : {};
  var email = cleanEmail(input.email);
  if (!email) return Promise.reject(httpErr(400, 'Give a full e-mail address, like name@company.com.', 'bad-email'));
  var role = ROLES.indexOf(input.role) !== -1 || input.role === 'blocked' ? input.role : '';
  if (!role) return Promise.reject(httpErr(400, 'Choose a role: Admin, Approver, Editor, Viewer or No access.', 'bad-role'));
  var portals = role === 'admin' || role === 'blocked' ? [ALL] : cleanPortals(input.portals);
  if (!portals.length) return Promise.reject(httpErr(400, 'Choose the portals this person works in, or All portals.', 'no-portals'));
  var given = input.sections === undefined ? null : (role === 'admin' || role === 'blocked' ? [ALL] : cleanSections(input.sections));
  if (given && !given.length) return Promise.reject(httpErr(400, 'Choose the sections this person can open, or All sections.', 'no-sections'));
  return change(fb, actor, function (next, cfg, now, by) {
    var before = next.members[email] || null;
    if (email === by && role !== 'admin') throw httpErr(400, 'You can\'t take away your own admin access. Ask another admin.', 'self');
    var sections = role === 'admin' || role === 'blocked' ? [ALL] : (given || (before && before.sections) || [ALL]);
    var m = { role: role, portals: portals, sections: sections, name: String(input.name != null ? input.name : (before && before.name) || '').trim().slice(0, 120),
      addedBy: before ? before.addedBy : by, addedAt: before ? before.addedAt : now, updatedBy: by, updatedAt: now };
    if (before && before.role === m.role && JSON.stringify(before.portals) === JSON.stringify(m.portals) &&
      JSON.stringify(before.sections || [ALL]) === JSON.stringify(m.sections) && before.name === m.name) return null;
    next.members[email] = m;
    return { action: before ? 'changed' : 'added', email: email,
      before: before ? { role: before.role, portals: before.portals, sections: before.sections || [ALL] } : null,
      after: { role: m.role, portals: m.portals, sections: m.sections } };
  });
}
function removeMember(fb, actor, email) {
  email = cleanEmail(email);
  if (!email) return Promise.reject(httpErr(400, 'Give a full e-mail address.', 'bad-email'));
  return change(fb, actor, function (next, cfg, now, by) {
    var before = next.members[email];
    if (!before) return null;
    if (email === by) throw httpErr(400, 'You can\'t remove yourself. Ask another admin.', 'self');
    delete next.members[email];
    return { action: 'removed', email: email, before: { role: before.role, portals: before.portals },
      after: isCompany(email) ? { role: next.defaultRole, portals: [ALL], note: 'company default' } : null };
  });
}
function setDefaultRole(fb, actor, role) {
  if (DEFAULT_ROLES.indexOf(role) === -1) return Promise.reject(httpErr(400, 'Company accounts can be Editors or Viewers by default.', 'bad-role'));
  return change(fb, actor, function (next) {
    if (next.defaultRole === role) return null;
    var before = next.defaultRole;
    next.defaultRole = role;
    return { action: 'default', email: '', before: { role: before }, after: { role: role } };
  });
}
function readLog(fb, n) {
  return docRef(fb).collection('log').orderBy('at', 'desc').limit(n || 20).get().then(function (snap) {
    return snap.docs.map(function (d) { var v = d.data() || {}; return { at: v.at || null, by: v.by || '', action: v.action || '', email: v.email || '', before: v.before || null, after: v.after || null }; });
  }, function () { return []; });
}

module.exports = {
  ALLOWED_DOMAIN: ALLOWED_DOMAIN, FIRST_ADMIN: FIRST_ADMIN, ROLES: ROLES, RANK: RANK, LABELS: LABELS, ALL: ALL, CACHE_MS: CACHE_MS,
  readConfig: readConfig, forget: forget, accessOf: accessOf, can: can, portalOk: portalOk, eventOk: eventOk, everywhere: everywhere,
  approverEmails: approverEmails, approversWith: approversWith, publicView: publicView, deniedSentence: deniedSentence, isCompany: isCompany,
  needFor: needFor, everywhereOnly: everywhereOnly, refusedSentence: refusedSentence, outsideSentence: outsideSentence,
  everywhereSentence: everywhereSentence, portalNames: portalNames,
  SECTIONS: SECTIONS, SECTION_IDS: SECTION_IDS, PRESETS: PRESETS, sectionOk: sectionOk, sectionsFor: sectionsFor, sectionSentence: sectionSentence,
  sectionLabel: sectionLabel, sectionOfUrl: sectionOfUrl, sectionOfRoute: sectionOfRoute, aiRoute: aiRoute,
  setMember: setMember, removeMember: removeMember, setDefaultRole: setDefaultRole, readLog: readLog,
  _test: { normalise: normalise, startingPoint: startingPoint, cleanPortals: cleanPortals, cleanSections: cleanSections, docPath: docPath }
};
