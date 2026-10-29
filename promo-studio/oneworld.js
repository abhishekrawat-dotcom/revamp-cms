/* Oneworld's side of the promotional platform's mailer studio (promo-mailer-studio.html, shown inside
   Promotions → Mailers). The studio itself is the platform's own code, copied unchanged into
   promo-studio/mailer-studio.js (tools/extract-promo-studio.py); this file loads after it and supplies what the
   platform's page had around the studio, on Oneworld:

     - api(url, opts): the platform's request helper, on Oneworld's routes (/api/promo/mailer*, functions/lib/
       promo-mailer.js) and sign-in (RevampAuth.authedFetch). The studio's own requests, and its plain fetch()es
       for icons, go through it; the URLs and bodies it builds are the platform's, re-addressed here.
     - S: the open event (this page's ?event=), and its portal (from the catalog).
     - the event page's mailer half (the platform's renderEventDetail, mailers only): the event's header,
       "Recently updated", the template cards, Open studio and Download all (.zip).
     - mlExport: a picture of the mail is drawn here, in the browser (the platform renders it with Chrome on its
       server, which Oneworld's server does not have); "Save as PDF" opens the mail for the browser's own
       Print → Save as PDF.
     - the studio takes the whole window while it is open (the page asks Promotions to let its frame fill it).
     - the mailer dashboard, "Mailer performance": the platform's own (AN … paintAnalytics, copied with the
       studio), in two scopes. ?event=<id> is Promotions → Mailers: its nav reads Dashboard / Mailers, and the
       page opens on the dashboard once the event has a mailer out, as the platform's chooseProduct does.
       ?scope=all is the team's page (mailer-performance.html): every event's mailers; its nav reads
       Dashboard / Events. The numbers are lib/promo-track.js's (/api/promo/analytics, …/analytics/all).
     - one place on screen at a time (OW_VIEW): whatever was asked for last — the nav's Dashboard or Mailers, a
       mailer, the studio — wins over a load still answering for an earlier one.
     - the download, copy and Download all toasts (owTrackToast): the platform's words when the mail went out
       tracked; no promise of numbers when tracking is not set up for the event (catalog.tracking false); "not
       tracked this time" when the server handed out the plain file (X-Mailer-Tracked: no, or tracked:false).
     - the cards show this event's real mail (owner B): every TEMPLATES card and every RECENTLY UPDATED card is
       drawn from one /api/promo/mailer/previews answer (functions/lib/promo-previews.js) in a locked, scaled
       frame, mounted as it comes into view, where the platform showed one stock picture per kind of mailer. A
       mailer the event lacks data for shows its real design with only the gap filled from the example library,
       badged "Example" and never openable; a gap that is a fact (the event is over, nominations are closed)
       shows the real mail with a chip. A click opens the whole mail, full window. Award mailers on an event that
       is not an award come last, under "For award events".
     - the page grows to its content (owner B): inside Promotions this frame reports its height, and once the
       page around it answers (rvMailerTall) the page scrolls instead of a box inside it; its toasts are then
       shown by the console, since this frame's own bottom edge may be far below the window's. The team's page
       never answers, so it keeps its own scrolling frame.
     - a mail leaves only with its current banner (owner C): before a mailer is opened, moved to another layout,
       downloaded, copied or exported, the page around this frame is asked to draw the event's mail banner if it is
       out of date (promo-banner.js), and a request the server refused for a stale banner is made again, once.

   Function declarations here replace the platform's of the same name: this file is the last script. Oneworld's
   own versions: mark and crumbs (this page keeps no URL or crumb trail of its own), showPortals (the event's
   mailer page, or the event listing), showAnalytics (the platform's, with the OW_VIEW check and Try again),
   anOpen, anToggleVer (by row index), mlExport, and mailerArt and savedCardHtml (a card's live preview).
   Wrapped: openMailer, closeMailer, rankCard, mailerCards, refreshMailerCards, paintAnalytics, toast. The
   platform's code calls owTrackToast, owDashSubline, owDashPickLabel and anOpenRow through the PATCHES in
   tools/extract-promo-studio.py. */

/* ---------- the event, or the whole team ---------- */
var EVENT_ID = new URLSearchParams(location.search).get('event') || '';
/* ?scope=all, with no event, is the team's Mailer performance page: the dashboard over every event's mailers */
var OW_SCOPE = (!EVENT_ID && new URLSearchParams(location.search).get('scope') === 'all') ? 'all' : 'event';
var S = { portal: null, portalName: null, event: EVENT_ID, award: null, kind: 'events', product: 'mail', section: 'mail' };
function mark() { /* the platform keeps its own URL in step; this page's URL is the event's, and stays */ }
function crumbs() { /* Promotions and the team page have their own headings: the crumb trail has no place here */ }

/* ---------- the page around this frame (Promotions, or the team's page) ---------- */
function owFramed() { try { return window.parent !== window; } catch (e) { return false; } }
function owPost(msg) { try { if (owFramed()) window.parent.postMessage(msg, location.origin); } catch (e) { /* not framed */ } }
function owStudioOpen() { var m = $('mailer'); return !!(m && m.classList.contains('on')); }
function owTall() { return document.documentElement.classList.contains('ow-tall'); }

/* ---------- requests ---------- */
var OW_FETCH = window.fetch.bind(window);
function owBody(o) {
  if (!o || typeof o.body !== 'string' || !/^\s*\{/.test(o.body)) return o;
  try {
    var j = JSON.parse(o.body);
    delete j.portal; delete j.event; delete j.award;
    j.eventId = EVENT_ID;
    return Object.assign({}, o, { body: JSON.stringify(j) });
  } catch (e) { return o; }
}
function owUrl(u) {
  var q = (u.split('?')[1] || ''), p = new URLSearchParams(q), path = u.split('?')[0], E = encodeURIComponent(EVENT_ID);
  if (path === '/api/mailers') return '/api/promo/mailers?eventId=' + E;
  /* the dashboard's numbers: this event's, or the team's. The team's are cached 30 s on the server; Refresh and
     Try again set AN.fresh to skip that cache once */
  if (path === '/api/analytics') {
    var fresh = AN.fresh; AN.fresh = false;
    return OW_SCOPE === 'all' ? '/api/promo/analytics/all' + (fresh ? '?fresh=1' : '') : '/api/promo/analytics?eventId=' + E;
  }
  if (path === '/api/mailer/saves') return '/api/promo/mailer/saves?eventId=' + E + '&mailerId=' + encodeURIComponent(p.get('mailerId') || '');
  if (path === '/api/mailer/import') return '/api/promo/mailer/import?eventId=' + E;
  if (path === '/api/editor/assets') return '/api/promo/mailer/roster?eventId=' + E;
  if (/^\/api\/mailer\//.test(path)) return '/api/promo/' + path.slice('/api/'.length);
  if (path === '/api/icons') return '/api/promo/icons?eventId=' + E + (p.get('name') ? '&name=' + encodeURIComponent(p.get('name')) : '');
  var del = /^\/api\/icons\/([^/?#]+)$/.exec(path);
  if (del) return '/api/promo/icons?eventId=' + E + '&id=' + del[1];
  return u;
}
function api(u, o) {
  o = o || {};
  if (u === '/api/mailer/export') return owExport(JSON.parse(o.body || '{}'));
  var path = String(u).split('?')[0], url = owUrl(String(u));
  var opts = /^\/api\/promo\/mailer\/import/.test(url) ? o : owBody(o);
  function send() { return window.RevampAuth.authedFetch(url, opts); }
  var req = owSendsMail(path, o) ? owSendWithBanner(send) : send();
  if (path === '/api/mailer/doc') {
    /* the doc the studio holds now, so owUsePalette can tell when mlLoad has taken the one this answer brings */
    var before = typeof MD === 'undefined' ? null : MD.doc;
    req.then(function (r) { owLearnPalette(r, before); }, function () { /* mlLoad says it could not build the mailer */ });
  }
  return req;
}
/* the studio's plain fetch()es for icons reach the same helper */
window.fetch = function (u, o) {
  if (typeof u === 'string' && /^\/api\/(icons|mailer|mailers|editor\/assets)\b/.test(u)) return api(u, o);
  return OW_FETCH(u, o);
};

/* ---------- a mail leaves only with its current banner (owner C) ----------
   The event's mail banner (its site picture, logo unit, date and venue in one picture) is drawn in the browser by
   the page around this frame (promo-banner.js), which keeps one drawing per page. Before anything that hands out
   the mail (opening it in the studio, a download of any kind, Copy HTML, the picture and PDF export) this page asks
   for it and waits: { rvBanner:'ensure', id } out, { rvBannerReady: { id, ok, error } } back. Change layout waits
   too: the server builds the new layout afresh from the event, as it builds a mailer being opened, and refuses it
   the same way while the banner is out of date (promo-mailer.js handleRelayout); without the fresh drawing here,
   every later Change layout would be refused again. The studio's live preview never waits (it shows the site's
   picture meanwhile). Whatever the answer, the request then goes: the server decides, and answers 409 banner-stale
   when the banner is out of date (the venue changed since, say); then the banner is asked for afresh and the
   request is made once more. Opened on its own (not framed), or as the team's page (no studio there), nothing is
   asked. */
var OW_BANNER_MS = 30000;           // a send waits at most this long for the drawing
var OW_BANNER_PREVIEW_MS = 8000;    // the cards wait less: until then they show the site's picture
var OW_BANNER_FAILED = 'The mail\'s banner could not be drawn. Reload the page and try again.';
var OW_BANNER = null, OW_BANNER_N = 0, OW_BANNER_WAIT = {};
function owSendsMail(path, o) {
  if (path === '/api/mailer/doc' || path === '/api/mailer/download' || path === '/api/mailer/relayout') return true;
  if (path !== '/api/mailer/render') return false;
  try { return JSON.parse((o && o.body) || '{}').editor !== true; } catch (e) { return true; }
}
/* resolves { ok, error?, timeout? } within ms; never rejects */
function owBannerReady(opts) {
  opts = opts || {};
  if (!owFramed() || OW_SCOPE !== 'event') return Promise.resolve({ ok: true, unframed: true });
  if (opts.fresh || !OW_BANNER) {
    var id = ++OW_BANNER_N;
    OW_BANNER = new Promise(function (ok) { OW_BANNER_WAIT[id] = ok; });
    owPost({ rvBanner: 'ensure', id: id, fresh: !!opts.fresh });
  }
  var asked = OW_BANNER, ms = opts.ms || OW_BANNER_MS;
  return new Promise(function (ok) {
    var timer = setTimeout(function () { ok({ ok: false, timeout: true }); }, ms);
    asked.then(function (a) { clearTimeout(timer); ok(a); });
  });
}
function owBannerStale(r) {
  if (!r || r.status !== 409 || typeof r.clone !== 'function') return Promise.resolve(false);
  return r.clone().json().then(function (j) { return !!(j && j.code === 'banner-stale'); }, function () { return false; });
}
function owSendWithBanner(send) {
  return owBannerReady().then(send).then(function (r) {
    return owBannerStale(r).then(function (stale) {
      if (!stale) return r;
      return owBannerReady({ fresh: true }).then(send).then(function (again) {
        return owBannerStale(again).then(function (still) {
          /* after the studio's own "… failed", which its code shows as soon as it reads this answer */
          if (still) setTimeout(function () { toast(OW_BANNER_FAILED, 6000); }, 0);
          return again;
        });
      });
    });
  });
}

/* The colour fields' "Use the mailer accent" shows the palette the studio keeps (MD.pal, PATCHES P11), which the
   platform sets only when it draws the mail again after an edit: a mailer just opened would show its stand-in
   indigo until then. So the first time a mailer opens on this page, its palette is taken from the /doc answer,
   which carries it; a server that does not send it there is asked for it once with the studio's own live render
   (never refused, never tracked). */
function owLearnPalette(r, before) {
  if (!r || !r.ok || typeof r.clone !== 'function' || typeof MD === 'undefined' || MD.pal) return;
  r.clone().json().then(function (j) {
    if (!j || MD.pal) return null;
    if (j.palette) return j;              // already here: drawing the mail a second time would only cost a wait
    if (!j.doc) return null;
    return api('/api/mailer/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: j.doc, editor: true }) })
      .then(function (x) { return x.ok ? x.json() : null; });
  }).then(function (j) {
    if (!j || !j.palette || MD.pal) return;
    owUsePalette(j.palette, before, 0);
  }).then(null, function () { /* the stand-in stays until the first edit draws the mail again */ });
}
/* The palette is the studio's at once (MD.pal), so any colour field built from now on reads it. The studio's chrome
   and accent picker take it (mlApplyPalette) only once mlLoad has taken the opened doc: the /doc answer is read here
   and by mlLoad side by side, and mlLoad's own panel, drawn as it takes the doc, would paint the picker over again.
   It waits at most OW_PAL_WAIT_TRIES x OW_PAL_WAIT_MS (2 s): a doc never taken (the studio could not read the
   answer) leaves just MD.pal. A block already selected with a colour field showing (a slow render, a quick click)
   built that field with the stand-in, as fldColor reads the palette only when it builds the field, so the panel is
   drawn again the way the studio does when its speakers and sponsors arrive. mlHistPush skips a doc that has not
   changed, so undo is unaffected. A live render that brought its own palette meanwhile has the newer one: this
   one then stands aside. */
var OW_PAL_WAIT_MS = 25, OW_PAL_WAIT_TRIES = 80;
function owUsePalette(p, before, tries) {
  if (MD.pal && MD.pal !== p) return;
  MD.pal = p;
  if (!MD.doc || MD.doc === before) {
    if (tries < OW_PAL_WAIT_TRIES) setTimeout(function () { owUsePalette(p, before, tries + 1); }, OW_PAL_WAIT_MS);
    return;
  }
  mlApplyPalette(p);
  if (MD.sel && document.querySelector('#mlProps .hexf, #mlIns2 .hexf')) { mlProps(); mlInspector(); }
}

/* ---------- the event page's mailer half ---------- */
function owIsAward(m) { return /^mailer\.award/.test(m.id); }
/* An event the award mailers are for. "None of them can be made" is not enough: an award whose nominations have
   closed, whose ceremony is past and whose winners are not out cannot make any of them either, and is still an
   award. Only an event with no award record is told so by the engine in these words (awards.ts NOT_AN_AWARD); the
   catalog carries no other sign of it. */
var OW_NOT_AN_AWARD = /^an award \(this event has no award record\)/;
function owAwardEvent() {
  if (!MAILERS || !Array.isArray(MAILERS.mailers)) return false;
  var award = MAILERS.mailers.filter(owIsAward);
  if (!award.length) return false;
  if (award.some(function (m) { return m.available; })) return true;
  return !award.some(function (m) { return (m.missing || []).some(function (x) { return OW_NOT_AN_AWARD.test(String(x)); }); });
}
function owSortCatalog() {
  if (!MAILERS || !Array.isArray(MAILERS.mailers)) return;
  /* the platform's order (openEvent): an award's own mailers first; otherwise the "good timing" ones. On an event
     that is not an award, the award mailers (shown with example award facts) come last, under their own heading
     (mailerCards below) */
  var award = owAwardEvent();
  MAILERS.mailers = MAILERS.mailers.map(function (m, i) { return [m, i]; }).sort(function (a, b) {
    var aw = function (m) { return owIsAward(m) ? 0 : 1; };
    if (award) return aw(a[0]) - aw(b[0]) || a[1] - b[1];
    return (aw(b[0]) - aw(a[0])) || (b[0].suggested - a[0].suggested) || a[1] - b[1];
  }).map(function (x) { return x[0]; });
}
/* What is on screen now: each place the page moves to (the mailer page, the dashboard, the studio) takes the next
   number, and a load answers only if its number is still the latest. Without it a slow answer for a place the user
   has already left painted over where they are: the dashboard over the mailer page, or the mailer page over the
   dashboard they had clicked while the page was still loading. */
var OW_VIEW = 0;
function owRenderPage() {
  OW_VIEW++;
  setProdNav('events');
  var ev = (MAILERS && MAILERS.event) || {};
  var mailCount = ((MAILERS && MAILERS.mailers) || []).filter(function (m) { return m.available; }).length;
  var site = ev.micrositeUrl;
  $('content').innerHTML =
    '<div class="ev-head">' +
      '<div class="logo grad"' + (ev.siteAccent ? ' style="background:' + escapeHtml(ev.siteAccent) + '"' : '') + '></div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap"><h2>' + escapeHtml(ev.name || '') + '</h2>' +
          (ev.hashtag ? '<span class="hchip">' + escapeHtml(ev.hashtag) + '</span>' : '') +
          (site ? '<a class="chip" href="' + escapeHtml(site) + '" target="_blank" rel="noopener" style="text-decoration:none">Website ↗</a>' : '') + '</div>' +
        '<div class="row">' +
          '<div class="stat">' + escapeHtml(ev.dateLabel || '—') + ' <span>date</span></div>' +
          '<div class="stat">' + escapeHtml(ev.venue || '—') + ' <span>venue</span></div>' +
          '<div class="stat">' + mailCount + ' <span>mailers available</span></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="evNav" class="secnav">' +
      '<button id="nav-mail" class="on" type="button">Promotional mailers <span class="n">' + mailCount + '</span></button>' +
      '<span class="sp" id="secActions">' +
        '<button class="btn alt sm" onclick="openMailer()">Open studio</button> ' +
        /* the console's secondary button, as Open studio beside it (owner D): the platform's own .btn lost to its
           .secnav button rule there and showed as plain grey words */
        '<button class="btn alt sm" onclick="downloadAllMailers()">Download all (.zip)</button>' +
      '</span>' +
    '</div>' +
    '<div id="secMail">' +
      '<div id="evSaved">' + renderEvSaved() + '</div>' +
      '<div class="mgrid" id="mgrid">' + mailerCards() + '</div>' +
    '</div>';
  owMountPreviews();
  owReportHeight();
}
/* The landing, as the platform's chooseProduct: a deep link (?mailer=) opens the studio; otherwise an event that
   already has a mailer out opens on its dashboard (how did the last one do?), and one with none on its mailer
   page, where the work starts. The dashboard stays one click away in the nav either way. page 'mailers' (the
   nav's Mailers, asked for before the catalog ever loaded) always lands on the mailer page. The team's page
   (?scope=all) is the dashboard alone. Whatever the user clicked while this loaded wins over the landing.
   A deep link to a mailer this event cannot make (and no saved version of it) opens its whole-mail view over the
   mailer page, never another mailer in its place. */
function owBoot(page) {
  owNavLabels();
  if (OW_SCOPE === 'all') { showAnalytics(); return; }
  if (!EVENT_ID) { $('content').innerHTML = '<div class="empty"><div class="big">No event</div>Open Promotions from an event.</div>'; return; }
  /* landed: this boot has started drawing its landing (a fault while drawing is still shown below) */
  var view = ++OW_VIEW, landed = false;
  $('content').innerHTML = skEventPage();
  var q = new URLSearchParams(location.search), open = q.get('mailer');
  /* the numbers are asked for alongside the catalog, not after it; a deep link has no use for them */
  var peek = open || page === 'mailers' ? null : owPeek();
  api('/api/mailers?portal=&event=' + encodeURIComponent(EVENT_ID)).then(function (r) {
    return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.error) || ('The server answered ' + r.status)); return j; });
  }).then(function (j) {
    MAILERS = j;
    document.body.classList.toggle('ow-notrack', j.tracking === false);
    S.portal = (j.event && j.event.portal) || '';
    S.portalName = S.portal;
    owSortCatalog();
    if (view !== OW_VIEW) return;               // the user has gone elsewhere meanwhile: theirs stays on screen
    if (open && findMailer(open)) {
      landed = true; owRenderPage();
      var version = q.get('version') || null;
      if (findMailer(open).available || version) openMailer(open, version, false);
      else owLightboxWhenReady('tpl:' + open);
      return;
    }
    if (page === 'mailers') { landed = true; owRenderPage(); return; }
    return (peek || owPeek()).then(function (a) {
      if (view !== OW_VIEW) return;
      landed = true;
      if (a) AN.data = a;
      /* numbers that show a mailer out are drawn as they came: the platform's showAnalytics would ask for the
         same numbers a second time, and that answer could land after the user had moved on */
      if (a && a.totals && a.totals.sends > 0) owPaintDash(); else owRenderPage();
    });
  }).catch(function (err) {
    if (view !== OW_VIEW && !landed) return;
    $('content').innerHTML = '<div class="empty"><div class="big">Mailers could not be loaded</div>' + escapeHtml(err && err.message || 'Please try again.') +
      '<div style="margin-top:14px"><button class="btn" id="owBootAgain" type="button">Try again</button></div></div>';
    $('owBootAgain').onclick = function () { owBoot(page); };
    /* the dashboard does not need the catalog: it stays reachable from the nav */
    setProdNav('events');
    owReportHeight();
  });
}
/* The dashboard's numbers, to choose the landing: the JSON, or null when they could not be had; never a
   rejection. The landing waits for them at most OW_PEEK_MS, so slow numbers never hold up the mailer page.
   ONEWORLD PORT: the platform's chooseProduct waited with no limit; past the limit the event opens on its mailer
   page, and its dashboard is one click away in the nav. */
var OW_PEEK_MS = 5000;
function owPeek() {
  return new Promise(function (ok) {
    var timer = setTimeout(function () { ok(null); }, OW_PEEK_MS);
    function done(a) { clearTimeout(timer); ok(a || null); }
    try { api('/api/analytics').then(function (r) { return r.ok ? r.json() : null; }).then(done, function () { done(null); }); }
    catch (e) { done(null); }
  });
}

/* ---------- the cards: this event's real mail (owner B) ----------
   Each card's picture slot (.ow-prev) names what it shows: data-prev="tpl:<mailerId>" (the mailer as a fresh
   build would send it) or "save:<saveId>" with data-ver="<savedAt>" (that saved version as it is now). One
   request draws every slot on the page (≤ 40 saved versions each), after the catalog and after the banner had its
   chance (OW_BANNER_PREVIEW_MS), so a card shows the banner the mail would carry. Answers are kept per slot name
   and version for the page's life: a re-saved version asks again for that version only; the template cards stay
   the fresh build. The HTML is the server's, shown in a frame with nothing allowed (no script, no same origin),
   mounted only as it comes near the window and scaled to the card. */
var OW_PREV = {}, OW_PREV_BUSY = {}, OW_PREV_MAX_SAVES = 40;
var OW_FILLED_WORDS = { speakers: 'speakers', sponsors: 'partners', sessions: 'agenda', points: 'key points', why: 'reasons to join',
  award: 'award details', audience: 'audience', stats: 'numbers', quote: 'quote' };
/* where in the console each example's real data is added (promo-posts.js fixLink's routes) */
var OW_FIX = { speakers: ['Add speakers in Content → Speakers', 'content/speakers'], sponsors: ['Add partners in Content → Sponsors', 'content/sponsors'],
  sessions: ['Add sessions in Content → Agenda', 'content/agenda'] };
var OW_STATES = { past: 'Past event', closed: 'Nominations closed', 'no-date': 'No date yet', 'no-date-venue': 'No date or venue yet' };
function owSlot(key, ver, label, tip) {
  return '<div class="art ow-prev" data-prev="' + escapeHtml(key) + '"' + (ver ? ' data-ver="' + escapeHtml(String(ver)) + '"' : '') +
    ' data-label="' + escapeHtml(label || '') + '"' + (tip || '') + ' onclick="owPrevOpen(this)" onkeydown="owPrevKeyDown(event,this)">' +
    '<span class="sk"></span></div>';
}
/* a TEMPLATES card's picture: the platform's stock art of the kind of mailer, replaced by this event's own mail */
function mailerArt(m) {
  var outline = (m.outline || []);
  var tip = outline.length ? ' title="Sections in this mail: ' + escapeHtml(outline.join(' · ')) + '"' : '';
  return owSlot('tpl:' + m.id, '', m.label, tip);
}
/* A saved version's card: the platform's markup (its savedCardHtml), with the version's own mail as its picture */
function savedCardHtml(s) {
  var m = findMailer(s.mailerId); if (!m) return '';
  return '<div class="mcard">\n    ' + owSlot('save:' + s.saveId, s.savedAt, s.name, '') +
    '\n    <div class="grp"><span>' + escapeHtml(m.group) + '</span><span class="savedchip">' + savedWhen(s.savedAt) + '</span></div>' +
    '\n    <div class="nm">' + escapeHtml(s.name) + '</div>' +
    '\n    ' + (s.subject ? '<div class="subj"><b>Subject</b>' + escapeHtml(s.subject) + '</div>' : '') +
    '\n    <div class="cta"><button class="btn sm" style="width:100%;justify-content:center" onclick=\'openMailer(' +
      escapeHtml(JSON.stringify(s.mailerId)) + ',' + escapeHtml(JSON.stringify(s.saveId)) + ')\'>Edit →</button></div>' +
    '\n  </div>';
}
/* The platform's template cards; on an event that is not an award, the award mailers (example award facts) after
   the rest, under "For award events" (owner B, decision 3). owSortCatalog has already put them last. */
var owMailerCards = mailerCards;
mailerCards = function () {
  if (!MAILERS || !Array.isArray(MAILERS.mailers) || owAwardEvent()) return owMailerCards();
  var all = MAILERS.mailers, award = all.filter(owIsAward), rest = all.filter(function (m) { return !owIsAward(m); });
  if (!award.length) return owMailerCards();
  var html;
  try {
    MAILERS.mailers = rest; html = owMailerCards();
    MAILERS.mailers = award; html += '<div class="sec-h ow-award-h">For award events</div>' + owMailerCards();
  } finally { MAILERS.mailers = all; }
  return html;
};
/* the platform rewrites the cards after a save, a rename or a delete: their pictures follow */
var owRefreshMailerCards = refreshMailerCards;
refreshMailerCards = function () { owRefreshMailerCards(); owMountPreviews(); owReportHeight(); };

function owSlots() { return Array.prototype.slice.call(document.querySelectorAll('.ow-prev[data-prev]')); }
function owPrevId(slot) { var k = slot.getAttribute('data-prev') || '', v = slot.getAttribute('data-ver'); return v ? k + '@' + v : k; }
function owLabelOf(slot) { return slot.getAttribute('data-label') || ''; }
/* Draws every slot on the page from what is known, and asks once for what is not */
function owMountPreviews() {
  if (OW_SCOPE !== 'event') return;
  owObserversReset();
  var wantTpl = false, wantSaves = [], seen = {};
  owSlots().forEach(function (slot) {
    var id = owPrevId(slot), it = OW_PREV[id];
    if (it) { owShowSlot(slot, it); return; }
    if (OW_PREV_BUSY[id] || seen[id]) return;
    seen[id] = true;
    var key = slot.getAttribute('data-prev') || '';
    if (key.indexOf('tpl:') === 0) wantTpl = true;
    else if (key.indexOf('save:') === 0) wantSaves.push({ id: key.slice(5), ver: slot.getAttribute('data-ver') || '' });
  });
  if (wantTpl || wantSaves.length) owAskPreviews(wantTpl, wantSaves);
  owLightboxIfWanted();
}
/* One request per 40 saved versions (the server's limit), the template cards with the first. Every asked slot is
   answered, so a slot is never asked for twice: what the answer lacks is "not found", a failed request "failed"
   (with Try again). */
function owAskPreviews(templates, saves) {
  var tplKeys = templates ? ((MAILERS && MAILERS.mailers) || []).map(function (m) { return 'tpl:' + m.id; }) : [];
  var chunks = [];
  for (var i = 0; i < saves.length; i += OW_PREV_MAX_SAVES) chunks.push(saves.slice(i, i + OW_PREV_MAX_SAVES));
  if (!chunks.length) chunks.push([]);
  tplKeys.forEach(function (k) { OW_PREV_BUSY[k] = true; });
  saves.forEach(function (s) { OW_PREV_BUSY['save:' + s.id + (s.ver ? '@' + s.ver : '')] = true; });
  return owBannerReady({ ms: OW_BANNER_PREVIEW_MS }).then(function () {
    return Promise.all(chunks.map(function (part, n) {
      var asked = (n === 0 ? tplKeys : []).concat(part.map(function (s) { return 'save:' + s.id + (s.ver ? '@' + s.ver : ''); }));
      var verOf = {};
      part.forEach(function (s) { verOf['save:' + s.id] = s.ver; });
      return api('/api/mailer/previews', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templates: n === 0 && templates, saveIds: part.map(function (s) { return s.id; }) }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j || !Array.isArray(j.items)) throw new Error('previews'); return j.items; }); })
        .then(function (items) {
          items.forEach(function (it) {
            if (!it || typeof it.key !== 'string') return;
            var id = it.key.indexOf('save:') === 0 && verOf[it.key] ? it.key + '@' + verOf[it.key] : it.key;
            OW_PREV[id] = it;
          });
          asked.forEach(function (id) { if (!OW_PREV[id]) OW_PREV[id] = { key: id, error: 'not found' }; });
        }, function () {
          asked.forEach(function (id) { OW_PREV[id] = { key: id, error: 'failed', retry: true }; });
        })
        .then(function () { asked.forEach(function (id) { delete OW_PREV_BUSY[id]; }); });
    }));
  }).then(function () { owMountPreviews(); });
}
/* Whether asking again can help: a request that failed, or a mail the server could not draw (its data may have been
   put right since). A saved version the server did not find is gone: asking again finds nothing, so that card has
   no Try again. */
function owPrevCanRetry(it) { return !!(it && (it.retry || it.error === 'render failed')); }
/* "Try again" on a card whose picture could not be had: every such card is asked for again */
function owPrevRetry() {
  Object.keys(OW_PREV).forEach(function (id) { if (owPrevCanRetry(OW_PREV[id])) delete OW_PREV[id]; });
  owSlots().forEach(function (slot) {
    if (OW_PREV[owPrevId(slot)]) return;
    slot.removeAttribute('data-shown');
    slot.className = 'art ow-prev';
    slot.innerHTML = '<span class="sk"></span>';
  });
  owMountPreviews();
}
/* the words beside an example card: what is made up, and how it becomes real */
function owExampleNote(mailerId, filled) {
  if (mailerId === 'mailer.award-winners') return 'Example winners — Oneworld does not record award winners yet';
  filled = filled || [];
  var words = filled.map(function (k) { return OW_FILLED_WORDS[k] || k; }).join(' and ');
  return 'Example ' + words + (filled.indexOf('award') !== -1 ? ' — for award events' : ' — add yours to use this');
}
function owMailerIdOf(key) {
  if (key.indexOf('tpl:') === 0) return key.slice(4);
  var sid = key.slice(5), s = evSavedList().filter(function (x) { return x.saveId === sid; })[0];
  return s ? s.mailerId : '';
}
/* What a slot shows, written once per slot: the overlays (badge and note, or the chip) sit beside the frame, never
   in the mail; the frame itself is mounted as the card comes into view (owObserve) */
function owShowSlot(slot, it) {
  if (slot.getAttribute('data-shown') !== '1') {
    slot.setAttribute('data-shown', '1');
    if (it.html) {
      slot.classList.add('ow-has');
      slot.setAttribute('role', 'button');
      slot.setAttribute('tabindex', '0');
      slot.setAttribute('aria-label', 'See the whole mail' + (owLabelOf(slot) ? ': ' + owLabelOf(slot) : ''));
      slot.innerHTML = it.example ? '<span class="ow-ex">Example</span><span class="ow-ex-note">' + escapeHtml(owExampleNote(owMailerIdOf(slot.getAttribute('data-prev') || ''), it.filled)) + '</span>'
        : it.state ? '<span class="ow-chip">' + escapeHtml(OW_STATES[it.state] || 'Not available yet') + '</span>' : '';
    } else if (it.error === 'too large') {
      slot.classList.add('ow-err');
      slot.innerHTML = '<span class="ow-msg">Preview too large to show — open it in the studio</span>';
    } else if (it.error) {
      slot.classList.add('ow-err');
      slot.innerHTML = owPrevCanRetry(it)
        ? '<span class="ow-msg">Preview could not be drawn — <button type="button" class="btn alt sm" onclick="event.stopPropagation();owPrevRetry()">Try again</button></span>'
        : '<span class="ow-msg">Preview could not be drawn</span>';
    } else {
      /* no picture can be drawn for it yet: the card keeps only its "needs …" line, as the platform's missing art did */
      slot.classList.add('ow-none');
      slot.innerHTML = '';
    }
  }
  if (it.html) owObserve(slot);
}
/* One IntersectionObserver mounts a slot's frame when it comes within 1200px of the window (its root is the window
   even inside this frame, so the page around it scrolling counts). 1200px, not less: a fast scroll covers more
   than a screen before a frame has drawn its mail, and the card it lands on showed half-painted; each frame is a
   locked copy of one mail already fetched, so mounting a screen's worth earlier costs little. One ResizeObserver
   keeps each frame scaled to its card. Both are started again on each draw of the cards, so they never hold cards
   that are gone. */
var OW_IO = null, OW_RO = null;
function owObserversReset() {
  if (OW_IO) { OW_IO.disconnect(); OW_IO = null; }
  if (OW_RO) { OW_RO.disconnect(); OW_RO = null; }
}
function owSetScale(slot, w) { if (w > 0) slot.style.setProperty('--ow-s', String(Math.round(w / 800 * 10000) / 10000)); }
function owObserve(slot) {
  if (window.ResizeObserver) {
    if (!OW_RO) OW_RO = new window.ResizeObserver(function (entries) { entries.forEach(function (en) { owSetScale(en.target, en.contentRect.width); }); });
    OW_RO.observe(slot);
  } else owSetScale(slot, slot.clientWidth);
  if (slot.getAttribute('data-framed') === '1') return;
  if (!window.IntersectionObserver) { owFrameIn(slot); return; }
  if (!OW_IO) {
    OW_IO = new window.IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { if (OW_IO) OW_IO.unobserve(en.target); owFrameIn(en.target); } });
    }, { rootMargin: '1200px 0px' });
  }
  OW_IO.observe(slot);
}
function owFrameIn(slot) {
  var it = OW_PREV[owPrevId(slot)];
  if (!it || !it.html || slot.getAttribute('data-framed') === '1') return;
  slot.setAttribute('data-framed', '1');
  var f = document.createElement('iframe');
  f.setAttribute('sandbox', '');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('tabindex', '-1');
  f.setAttribute('aria-hidden', 'true');
  f.setAttribute('title', '');
  f.srcdoc = it.html;
  slot.appendChild(f);
}

/* ---------- the whole mail, full window ----------
   A click on a card's picture (or Enter on it) opens the whole mail over the page: the frame fills the window
   (owTellParent 'open'), the mail is drawn 800px wide (wide enough for its desktop layout) and scaled down on a
   narrow screen, its links do nothing. A mailer the event can make offers the card's own main action; an example
   says what it lacks and where to add it; a mailer held back by a fact shows its chip. Never a download. */
var OW_LB = null, OW_LB_WANT = null;
function owPrevOpen(slot) {
  var it = OW_PREV[owPrevId(slot)];
  if (!it || !it.html) return;
  owLightbox(slot.getAttribute('data-prev') || '', it, slot);
}
function owPrevKeyDown(e, slot) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.preventDefault) e.preventDefault();
  owPrevOpen(slot);
}
/* what the whole-mail view offers for a key: { label, group, go: [words, open] | null, note, link, chip } */
function owLbInfo(key, it) {
  var out = { label: '', group: '', go: null, note: '', link: null, chip: '' };
  if (key.indexOf('save:') === 0) {
    var sid = key.slice(5), s = evSavedList().filter(function (x) { return x.saveId === sid; })[0];
    var sm = s && findMailer(s.mailerId);
    out.label = s ? s.name : 'Saved version';
    out.group = sm ? sm.group + ' — ' + sm.label : '';
    if (s) out.go = ['Edit →', function () { openMailer(s.mailerId, s.saveId); }];
    return out;
  }
  var id = key.slice(4), m = findMailer(id);
  if (!m) return out;
  out.label = m.label; out.group = m.group;
  if (m.available) {
    var saves = mlSaves(m.id);
    out.go = saves.length ? ['Continue “' + saves[0].name + '” →', function () { openMailer(m.id, saves[0].saveId); }]
      : ['Open in studio →', function () { openMailer(m.id, null, false); }];
    return out;
  }
  var missing = (it.missing && it.missing.length ? it.missing : m.missing) || [];
  if (it.example) {
    var filled = it.filled || [];
    if (id === 'mailer.award-winners') out.note = 'Example — Oneworld does not record award winners yet, so this mailer cannot be made.';
    else if (filled.indexOf('award') !== -1) out.note = 'Example — this mailer is for award events, and this event has no award record.';
    else {
      out.note = 'Example — to use this mailer, add ' + missing.join('; ') + '.';
      /* where to add it, when the console has a place for it (key points and reasons to join come from the brief) */
      filled.forEach(function (k) { if (!out.link && OW_FIX[k]) out.link = OW_FIX[k]; });
    }
  } else if (it.state) {
    out.chip = OW_STATES[it.state] || 'Not available yet';
    out.note = missing.length ? 'This mailer needs ' + missing.join('; ') + '.' : '';
  }
  return out;
}
function owLightbox(key, it, from) {
  owLightboxClose(true);
  var info = owLbInfo(key, it);
  var box = document.createElement('div');
  box.className = 'ow-lb ow-lb-mail';            // ow-lb-mail: the mailer page's own look for it (oneworld.css)
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', (info.label || 'Mailer') + ' — the whole mail');
  var col = document.createElement('div');
  col.className = 'ow-lb-col';
  col.innerHTML =
    '<div class="ow-lb-bar">' +
      '<div class="ow-lb-t">' + escapeHtml(info.label) + (info.group ? '<small>' + escapeHtml(info.group) + '</small>' : '') + '</div>' +
      (it.example ? '<span class="ow-ex">Example</span>' : '') +
      (info.chip ? '<span class="ow-chip">' + escapeHtml(info.chip) + '</span>' : '') +
      (info.go ? '<button type="button" class="btn sm" onclick="owLbGo()">' + escapeHtml(info.go[0]) + '</button>' : '') +
      '<button type="button" class="btn ghost sm ow-lb-x" aria-label="Close" title="Close (Esc)" onclick="owLightboxClose()">✕</button>' +
    '</div>' +
    (info.note ? '<div class="ow-lb-note' + (it.example ? '' : ' ow-lb-quiet') + '">' + escapeHtml(info.note) +
      (info.link ? ' <a href="' + escapeHtml('/edit-event.html?event=' + encodeURIComponent(EVENT_ID) + '#' + info.link[1]) + '" target="_top">' + escapeHtml(info.link[0]) + '</a>' : '') +
    '</div>' : '');
  var pageEl = document.createElement('div');
  pageEl.className = 'ow-lb-page';
  var f = document.createElement('iframe');
  /* same origin so it can be measured and its links stopped; no scripts, so nothing in the mail runs */
  f.setAttribute('sandbox', 'allow-same-origin');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('title', info.label || 'Mailer');
  f.style.height = '1000px';
  pageEl.appendChild(f);
  col.appendChild(pageEl);
  box.appendChild(col);
  box.onclick = function (e) { if (e && e.target === box) owLightboxClose(); };
  OW_LB = { el: box, col: col, page: pageEl, frame: f, from: from || null, go: info.go ? info.go[1] : null };
  owTellParent('open');
  document.body.appendChild(box);
  document.addEventListener('keydown', owLbKeys, true);
  window.addEventListener('resize', owLbFit);
  f.onload = function () { owLbReady(f); };
  f.srcdoc = it.html;
  owLbFit();
  try { var x = col.querySelector && col.querySelector('.ow-lb-x'); if (x && x.focus) x.focus(); } catch (e) { /* focus is a nicety */ }
}
function owLbGo() {
  var go = OW_LB && OW_LB.go;
  if (!go) return;
  owLightboxClose(true);                        // the studio takes the window over from it (openMailer)
  go();
}
function owLbKeys(e) { if (e.key === 'Escape' && OW_LB) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); owLightboxClose(); } }
/* keepFull: the studio opens next, and keeps the window */
function owLightboxClose(keepFull) {
  if (!OW_LB) return;
  var lb = OW_LB; OW_LB = null;
  document.removeEventListener('keydown', owLbKeys, true);
  window.removeEventListener('resize', owLbFit);
  if (lb.el.parentNode) lb.el.parentNode.removeChild(lb.el);
  if (keepFull) return;
  owTellParent('close');
  owReportHeight();
  try { if (lb.from && lb.from.focus) lb.from.focus(); } catch (e) { /* the card may have gone */ }
}
/* The mail's links are stopped as the studio's canvas stops them (the platform's mlNeutraliseLinks), and the frame
   is measured as the studio measures its canvas (mlFit: the bottom of the body's children), again as pictures land.
   Escape is heard inside the mail too: once the user clicks in it, its keys go to the frame's document, not this
   page's, and the view would not close. */
function owLbReady(f) {
  var d = f.contentDocument;
  if (!d) return;
  d.addEventListener('click', function (e) { var a = e.target && e.target.closest && e.target.closest('a'); if (a) { e.preventDefault(); e.stopPropagation(); } }, true);
  d.addEventListener('keydown', owLbKeys, true);
  Array.prototype.forEach.call(d.querySelectorAll('a'), function (a) { a.style.cursor = 'default'; a.setAttribute('tabindex', '-1'); });
  Array.prototype.forEach.call(d.querySelectorAll('img'), function (img) {
    if (img.complete) return;
    img.addEventListener('load', owLbFit, { once: true });
    img.addEventListener('error', owLbFit, { once: true });
  });
  owLbFit();
  setTimeout(owLbFit, 350); setTimeout(owLbFit, 1400);
}
function owLbFit() {
  if (!OW_LB) return;
  var f = OW_LB.frame, d = null;
  try { d = f.contentDocument; } catch (e) { d = null; }
  var h = parseFloat(f.style.height) || 1000;
  if (d && d.body) {
    var bottom = 0;
    Array.prototype.forEach.call(d.body.children, function (el) { var r = el.getBoundingClientRect(); if (r.height > 0) bottom = Math.max(bottom, r.bottom); });
    if (bottom > 0) h = Math.max(160, Math.ceil(bottom) + 2);
  }
  var w = Math.min(800, OW_LB.col.clientWidth || 800), s = Math.min(1, w / 800);
  f.style.height = h + 'px';
  f.style.transform = s < 1 ? 'scale(' + s + ')' : '';
  OW_LB.page.style.height = Math.ceil(h * s) + 'px';
}
/* a deep link to a mailer this event cannot make: its whole-mail view once its picture is in, unless the user has
   gone elsewhere meanwhile */
function owLightboxWhenReady(key) { OW_LB_WANT = { key: key, view: OW_VIEW }; owLightboxIfWanted(); }
function owLightboxIfWanted() {
  var w = OW_LB_WANT;
  if (!w || !OW_PREV[w.key]) return;
  OW_LB_WANT = null;
  if (w.view !== OW_VIEW || owStudioOpen()) return;
  var it = OW_PREV[w.key];
  if (it.html) { owLightbox(w.key, it, null); return; }
  if (it.error) return;                          // its card says it could not be drawn
  var m = findMailer(w.key.slice(4));
  toast('That mailer is not available for this event yet' + (m && m.missing && m.missing.length ? ': it needs ' + m.missing.join(', ') : ''), 6000);
}

/* ---------- the studio and the whole-mail view take the whole window while open ---------- */
/* Promotions is told only of a change ('open' then 'close'): it keeps the page's scroll and the frame's place when
   the frame fills the window, and a second 'open' would take the full-window frame's height for the page's */
var OW_TOLD = 'close';
function owTellParent(state) {
  if (state === OW_TOLD) return;
  OW_TOLD = state;
  owPost({ rvMailerStudio: state });
}
var owOpenMailer = openMailer, owCloseMailer = closeMailer;
/* the studio is a place too (OW_VIEW): a dashboard still loading must not paint the page it closes onto. A studio
   that did not open (no mailer this event can make) gives the window back. */
openMailer = function (preId, saveId, fresh) {
  OW_VIEW++;
  owLightboxClose(true);
  owTellParent('open');
  var r = owOpenMailer(preId, saveId, fresh);
  if (!owStudioOpen()) { owTellParent('close'); owReportHeight(); }
  return r;
};
closeMailer = function () {
  var wasOpen = owStudioOpen();
  owCloseMailer();
  if (wasOpen && !owStudioOpen()) { owTellParent('close'); owReportHeight(); }
};

/* ---------- the frame grows to its content (owner B) ----------
   Inside Promotions this page reports how tall its content is ({ rvMailerHeight }), at most once a frame, when it
   changed by more than a pixel, and never while the studio or the whole-mail view has the window (the frame is
   then the window's size, not the page's). The first report is answered with { rvMailerTall }: from then on the
   page has no scroll of its own (html.ow-tall, oneworld.css) and the page around it scrolls. The height is where
   the content ends, not the document's scrollHeight, which never shrinks back (the platform's mlFit says why). */
var OW_HEIGHT = 0, OW_HEIGHT_PENDING = false;
function owReportHeight() {
  if (OW_HEIGHT_PENDING || !owFramed()) return;
  OW_HEIGHT_PENDING = true;
  var later = window.requestAnimationFrame ? function (f) { window.requestAnimationFrame(f); } : function (f) { setTimeout(f, 16); };
  later(function () {
    OW_HEIGHT_PENDING = false;
    if (owStudioOpen() || OW_LB) return;
    var c = $('content');
    if (!c) return;
    var h = Math.ceil(c.getBoundingClientRect().bottom + (window.scrollY || 0));
    if (h <= 50 || Math.abs(h - OW_HEIGHT) <= 1) return;
    OW_HEIGHT = h;
    owPost({ rvMailerHeight: h });
  });
}
function owWatchHeight() {
  var c = $('content');
  if (!c || !owFramed() || !window.ResizeObserver) return;
  var ro = new window.ResizeObserver(function () { owReportHeight(); });
  ro.observe(c);
  var bar = document.querySelector('.ow-bar');
  if (bar) ro.observe(bar);
}
/* the page around this frame: only our own parent, on our own origin */
function owOnMessage(e) {
  if (!e || !e.data || e.origin !== location.origin || e.source !== window.parent) return;
  var d = e.data;
  if (d.rvMailerTall === true) { document.documentElement.classList.add('ow-tall'); owReportHeight(); }
  var b = d.rvBannerReady;
  if (b && OW_BANNER_WAIT[b.id]) {
    var done = OW_BANNER_WAIT[b.id];
    delete OW_BANNER_WAIT[b.id];
    done({ ok: !!b.ok, error: b.error ? String(b.error) : '' });
  }
}
/* A toast is fixed to this frame's bottom edge, which in a tall frame may be far below the window: while the page
   scrolls (and neither the studio nor the whole-mail view has the window) the console shows it instead */
var owToast = toast;
toast = function (m, ms) {
  if (owFramed() && owTall() && !owStudioOpen() && !OW_LB) { owPost({ rvToast: { m: String(m), ms: ms } }); return; }
  return owToast.apply(this, arguments);
};

/* ---------- the mailer dashboard (the platform's AN … paintAnalytics, in promo-studio/mailer-studio.js) ---------- */
function owDashSubline() {
  return OW_SCOPE === 'all' ? 'Opens and clicks for every mailer downloaded or copied from this platform.'
    : 'Opens and clicks for every mailer of this event downloaded or copied from Oneworld.';
}
function owDashPickLabel() { return OW_SCOPE === 'all' ? 'Pick an event →' : 'Make a mailer →'; }
/* the nav's second place is this event's mailers, or (for the team) the event listing */
function owNavLabels() {
  var b = document.querySelector('#prodNav [data-v="events"]');
  if (!b) return;
  b.textContent = OW_SCOPE === 'all' ? 'Events' : 'Mailers';
  b.title = OW_SCOPE === 'all' ? 'Pick an event' : 'This event\'s mailers';
}
/* The platform's portal picker, reached from the nav, "New mailer →" and the empty dashboard's button: here it
   is this event's mailer page, or the event listing for the team (the whole window: this page is framed) */
function showPortals() {
  if (OW_SCOPE === 'all') { window.top.location.href = '/Event_Listing.html'; return; }
  if (MAILERS) owRenderPage(); else owBoot('mailers');
}
/* A Recent mailers row and a template's versions go by row index (PATCHES P6 and P7): nothing anyone typed is
   written into an inline handler, where an escaped quote is decoded again before the script runs */
function anOpenRow(i) { var x = AN.data && AN.data.sends && AN.data.sends[i]; if (x) anOpen(x.portal, x.event, x.mailerId, x.eventName, x.saveId); }
function anToggleVer(i) {
  var a = AN.data; if (!a) return;
  var rows = AN.tmplMetric === 'opens' ? a.topOpenedTemplates : a.topClickedTemplates;
  var r = rows && rows[i]; if (!r) return;
  AN.openVer = AN.openVer === r.key ? null : r.key; paintAnalytics();
}
/* The platform's rankCard looks a template's versions up by its mailer id in a plain object, where a name every
   object has ("constructor") is always found, and is no list. It is handed a copy with no prototype that holds
   only the server's lists, so only a mailer id the server listed has versions. */
var owRankCard = rankCard;
rankCard = function (title, id, rows, metric, versions) {
  var own = null;
  if (versions) {
    own = Object.create(null);
    Object.keys(versions).forEach(function (k) { if (Array.isArray(versions[k])) own[k] = versions[k]; });
  }
  return owRankCard(title, id, rows, metric, own);
};
/* the dashboard is part of the page whose height Promotions follows */
var owPaintAnalytics = paintAnalytics;
paintAnalytics = function () { var r = owPaintAnalytics.apply(this, arguments); owReportHeight(); return r; };
/* The platform's anOpen reopens the exact mailer, and version, a row came from. A row of this event opens in this
   page's studio over its mailer page (closing the studio lands there); any other row (the team's page) opens that
   event's Promotions → Mailers on it. A mailer the event no longer offers is said so, never swapped for another;
   a saved version of it still opens (PATCHES P12). */
function anOpen(portal, event, mailerId, name, saveId) {
  if (OW_SCOPE === 'event' && event === EVENT_ID && MAILERS) {
    owRenderPage();
    var m = findMailer(mailerId);
    if (m && (m.available || saveId)) openMailer(mailerId, saveId || null);
    else toast('That mailer is not available for this event any more');
    return;
  }
  window.top.location.href = '/marketing.html?event=' + encodeURIComponent(event) + '&tab=mailers&mailer=' + encodeURIComponent(mailerId) +
    (saveId ? '&version=' + encodeURIComponent(saveId) : '');
}
/* The platform's showAnalytics, as Oneworld's: its skeleton, its one request and its words, plus
     - OW_VIEW: an answer that arrives after the user has moved on (the nav's Mailers, a mailer, the studio, a newer
       load) is dropped, never painted over where they are;
     - a request that fails outright (no network) ends on "Could not load analytics." too, where the platform left
       its skeleton up for good;
     - that error has a Try again, which also skips the team's server-side cache.
   Resolves when done; never rejects. */
var OW_DASH_FAILED = '<div class="ml-err">Could not load analytics.</div>';
function owDashSkeleton() {
  return '<div class="page-h"><div><h2>Mailer performance</h2>\n      <p>' + owDashSubline() + '</p></div></div>\n    <div class="kpis">' +
    new Array(5).join('<div class="card kpi"><div class="sk" style="height:74px"></div></div>') + '</div>\n' +
    '    <div class="card an-card"><div class="sk" style="height:210px"></div></div>';
}
function showAnalytics() {
  var view = ++OW_VIEW;
  mark('dashboard');
  crumbs([{ t: 'Dashboard' }]); setProdNav('dash');
  if (!AN.data) $('content').innerHTML = owDashSkeleton();
  function failed() {
    if (view !== OW_VIEW) return;
    $('content').innerHTML = OW_DASH_FAILED;
    owDashRetry();
  }
  var req;
  try { req = api('/api/analytics'); } catch (e) { req = Promise.reject(e); }
  return req.then(function (r) {
    if (view !== OW_VIEW) return;
    if (!r.ok) return failed();
    return r.json().then(function (j) {
      if (view !== OW_VIEW) return;
      AN.data = j;
      paintAnalytics();
    });
  }).then(null, failed);
}
/* the dashboard drawn from numbers already in hand (the landing's); a fault while drawing ends as a failed load does */
function owPaintDash() {
  setProdNav('dash');
  try { paintAnalytics(); }
  catch (e) { $('content').innerHTML = OW_DASH_FAILED; owDashRetry(); }
}
function owDashRetry() {
  var err = document.querySelector('#content .ml-err');
  if (!err || $('owDashAgain')) return;
  err.insertAdjacentHTML('afterend', '<button class="btn alt sm" id="owDashAgain" type="button">Try again</button>');
  $('owDashAgain').onclick = function () { AN.data = null; AN.fresh = true; showAnalytics(); };
}

/* ---------- the export toasts (PATCHES P3, P9, P10) ---------- */
/* The platform's words when the mail went out tracked. With tracking not set up for this event there are no numbers
   to promise; when the server handed out the plain file because the send could not be recorded
   (X-Mailer-Tracked: no, tracked:false), the sender is told, so they can export it again. */
function owTrackToast(kind, tracked, fname) {
  var off = !!(MAILERS && MAILERS.tracking === false), f = String(fname || '');
  if (kind === 'download') {
    if (off) return toast('Downloaded ' + f, 5000);
    if (tracked) return toast('Downloaded ' + f + ' — opens and clicks will show on your dashboard once it\'s sent.', 5000);
    return toast('Downloaded ' + f + ' — not tracked this time, so its opens and clicks won\'t show on your dashboard. Download it again to track it.', 5000);
  }
  if (kind === 'copy') {
    if (off || tracked) return toast('HTML copied — paste into your ESP');
    return toast('HTML copied — not tracked this time, so its opens and clicks won\'t show on your dashboard. Copy it again to track it.', 5000);
  }
  if (off || tracked) return toast('Downloaded — saved edits included');
  return toast('Downloaded — saved edits included. Not tracked this time: download again to see their opens and clicks on your dashboard.', 5000);
}

/* ---------- export: a picture of the mail, drawn here; a PDF through the browser's own print ---------- */
/* the plain render: it leaves the studio, so it waits for a current banner (api) */
function owMailHtml(doc) {
  return api('/api/mailer/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: doc }) })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'render failed'); return j.html; }); });
}
/* a picture from another host would taint the canvas: each is fetched through Oneworld's own picture route */
function owInlinePictures(d) {
  var imgs = Array.prototype.slice.call(d.images || []);
  return Promise.all(imgs.map(function (img) {
    var src = img.getAttribute('src') || '';
    if (!/^https?:\/\//i.test(src)) return null;
    /* the app's own mastheads and icons are written with its public address (they must reach an inbox); here,
       whatever host that is, they are this page's own files */
    var own = /^https?:\/\/[^/]+(\/(templates|assets)\/[^?#]*)/.exec(src);
    var same = src.indexOf(location.origin + '/') === 0 || !!own;
    var url = own ? location.origin + own[1] : same ? src : '/api/promo/image?eventId=' + encodeURIComponent(EVENT_ID) + '&url=' + encodeURIComponent(src);
    var get = same ? OW_FETCH(url) : window.RevampAuth.authedFetch(url);
    return get.then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
      if (!b) { img.style.visibility = 'hidden'; return; }
      return new Promise(function (ok) { img.onload = img.onerror = function () { ok(); }; img.src = URL.createObjectURL(b); });
    }, function () { img.style.visibility = 'hidden'; });
  }));
}
/* The print window is opened at once, within the click: the browser lets a page open a window only for a few
   seconds after a click, and the render may first wait for the banner to be drawn (up to OW_BANNER_MS) and be made
   twice. It says it is preparing until the mail is written into it, and is closed again if the mail cannot be had. */
var OW_PRINT_WAIT = '<!doctype html><meta charset="utf-8"><title>Preparing the mail…</title>' +
  '<p style="font:15px/1.5 system-ui,sans-serif;color:#555;margin:40px;text-align:center">Preparing the mail for printing…</p>';
function owExport(body) {
  var width = Math.min(1200, Math.max(320, Number(body.width) || 800));
  if (body.format === 'pdf') {
    var w = window.open('', '_blank');
    if (!w) return Promise.reject(new Error('The browser blocked the new window. Allow pop-ups for this site and try again.'));
    try { w.document.open(); w.document.write(OW_PRINT_WAIT); w.document.close(); } catch (e) { /* the mail replaces it either way */ }
    return owMailHtml(body.doc).then(function (html) {
      if (w.closed) throw new Error('The print window was closed before the mail was ready.');
      w.document.open(); w.document.write(html); w.document.close();
      w.addEventListener('load', function () { setTimeout(function () { w.focus(); w.print(); }, 300); });
      return new Response(new Blob([''], { type: 'application/x-owprint' }), { status: 200 });
    }).then(null, function (err) {
      try { if (!w.closed) w.close(); } catch (e) { /* already gone */ }
      throw err;
    });
  }
  return owMailHtml(body.doc).then(function (html) {
    var f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + width + 'px;height:800px;border:0;visibility:hidden';
    document.body.appendChild(f);
    var d = f.contentDocument;
    d.open(); d.write(html); d.close();
    return owInlinePictures(d).then(function () {
      var h = Math.max(d.documentElement.scrollHeight, d.body.scrollHeight);
      f.style.height = h + 'px';
      return htmlToImage.toBlob(d.documentElement, { width: width, height: h, pixelRatio: 2, backgroundColor: '#ffffff' });
    }).then(function (blob) {
      f.remove();
      return new Response(blob, { status: 200, headers: { 'content-type': 'image/png' } });
    }, function (err) { f.remove(); throw err; });
  }).catch(function (err) {
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500 });
  });
}
/* the platform's mlExport, with "Save as PDF" told apart: the print dialog is the PDF */
async function mlExport(format, width) {
  closeMenus();
  if (!MD.doc) return;
  if (format === 'pdf') {
    try { await owExport({ doc: MD.doc, format: 'pdf', width: width }); toast('In the print window, choose “Save as PDF”', 4000); }
    catch (e) { toast(String(e && e.message || 'Could not open the PDF'), 4000); }
    return;
  }
  mlBusy(true, 'Rendering the image…');
  var r = await api('/api/mailer/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: MD.doc, format: format, width: width }) });
  mlBusyDone();
  if (!r.ok) { toast('Could not render the ' + format.toUpperCase()); return; }
  var blob = await r.blob();
  var stem = (MD.doc.subject || 'mailer').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'mailer';
  var a = document.createElement('a');
  var suffix = width <= 480 ? '-mobile' : '-desktop';
  a.href = URL.createObjectURL(blob); a.download = stem + suffix + '.' + format;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  toast(format.toUpperCase() + ' downloaded (' + Math.round(blob.size / 1024) + 'kb)');
}

window.addEventListener('message', owOnMessage);
owWatchHeight();
/* owBoot's argument is the landing it was asked for: none here, whatever sign-in resolves with */
window.RevampAuth.whenResolved().then(function () { owBoot(); }, function () { owBoot(); });
