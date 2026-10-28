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

   Function declarations here replace the platform's of the same name: this file is the last script. Oneworld's
   own versions: mark and crumbs (this page keeps no URL or crumb trail of its own), showPortals (the event's
   mailer page, or the event listing), showAnalytics (the platform's, with the OW_VIEW check and Try again),
   anOpen, anToggleVer (by row index), mlExport. Wrapped: openMailer, closeMailer, rankCard. The platform's code
   calls owTrackToast, owDashSubline, owDashPickLabel and anOpenRow through the PATCHES in
   tools/extract-promo-studio.py. */

/* ---------- the event, or the whole team ---------- */
var EVENT_ID = new URLSearchParams(location.search).get('event') || '';
/* ?scope=all, with no event, is the team's Mailer performance page: the dashboard over every event's mailers */
var OW_SCOPE = (!EVENT_ID && new URLSearchParams(location.search).get('scope') === 'all') ? 'all' : 'event';
var S = { portal: null, portalName: null, event: EVENT_ID, award: null, kind: 'events', product: 'mail', section: 'mail' };
function mark() { /* the platform keeps its own URL in step; this page's URL is the event's, and stays */ }
function crumbs() { /* Promotions and the team page have their own headings: the crumb trail has no place here */ }

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
  var url = owUrl(String(u));
  var opts = /^\/api\/promo\/mailer\/import/.test(url) ? o : owBody(o);
  return window.RevampAuth.authedFetch(url, opts);
}
/* the studio's plain fetch()es for icons reach the same helper */
window.fetch = function (u, o) {
  if (typeof u === 'string' && /^\/api\/(icons|mailer|mailers|editor\/assets)\b/.test(u)) return api(u, o);
  return OW_FETCH(u, o);
};

/* ---------- the event page's mailer half ---------- */
function owSortCatalog() {
  if (!MAILERS || !Array.isArray(MAILERS.mailers)) return;
  /* the platform's order (openEvent): an award's own mailers first; otherwise the "good timing" ones */
  var award = MAILERS.mailers.some(function (m) { return /^mailer\.award/.test(m.id) && m.available; });
  MAILERS.mailers = MAILERS.mailers.map(function (m, i) { return [m, i]; }).sort(function (a, b) {
    if (award) { var aw = function (m) { return /^mailer\.award/.test(m.id) ? 0 : 1; }; return aw(a[0]) - aw(b[0]) || a[1] - b[1]; }
    return (b[0].suggested - a[0].suggested) || a[1] - b[1];
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
        '<button class="btn sm" onclick="downloadAllMailers()">Download all (.zip)</button>' +
      '</span>' +
    '</div>' +
    '<div id="secMail">' +
      '<div id="evSaved">' + renderEvSaved() + '</div>' +
      '<div class="mgrid" id="mgrid">' + mailerCards() + '</div>' +
    '</div>';
}
/* The landing, as the platform's chooseProduct: a deep link (?mailer=) opens the studio; otherwise an event that
   already has a mailer out opens on its dashboard (how did the last one do?), and one with none on its mailer
   page, where the work starts. The dashboard stays one click away in the nav either way. page 'mailers' (the
   nav's Mailers, asked for before the catalog ever loaded) always lands on the mailer page. The team's page
   (?scope=all) is the dashboard alone. Whatever the user clicked while this loaded wins over the landing. */
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
    if (open && findMailer(open)) { landed = true; owRenderPage(); openMailer(open, q.get('version') || null, false); return; }
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

/* ---------- the studio takes the whole window while it is open ---------- */
function owTellParent(state) { try { if (window.parent !== window) window.parent.postMessage({ rvMailerStudio: state }, location.origin); } catch (e) { /* not framed */ } }
var owOpenMailer = openMailer, owCloseMailer = closeMailer;
/* the studio is a place too (OW_VIEW): a dashboard still loading must not paint the page it closes onto */
openMailer = function (preId, saveId, fresh) { OW_VIEW++; owTellParent('open'); return owOpenMailer(preId, saveId, fresh); };
closeMailer = function () {
  var wasOpen = $('mailer').classList.contains('on');
  owCloseMailer();
  if (wasOpen && !$('mailer').classList.contains('on')) owTellParent('close');
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
/* The platform's anOpen reopens the exact mailer, and version, a row came from. A row of this event opens in this
   page's studio over its mailer page (closing the studio lands there); any other row (the team's page) opens that
   event's Promotions → Mailers on it. A mailer the event no longer offers is said so, never swapped for another. */
function anOpen(portal, event, mailerId, name, saveId) {
  if (OW_SCOPE === 'event' && event === EVENT_ID && MAILERS) {
    owRenderPage();
    var m = findMailer(mailerId);
    if (m && m.available) openMailer(mailerId, saveId || null);
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
function owExport(body) {
  var width = Math.min(1200, Math.max(320, Number(body.width) || 800));
  if (body.format === 'pdf') {
    return owMailHtml(body.doc).then(function (html) {
      var w = window.open('', '_blank');
      if (!w) throw new Error('The browser blocked the new window. Allow pop-ups for this site and try again.');
      w.document.open(); w.document.write(html); w.document.close();
      w.addEventListener('load', function () { setTimeout(function () { w.focus(); w.print(); }, 300); });
      return new Response(new Blob([''], { type: 'application/x-owprint' }), { status: 200 });
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

/* owBoot's argument is the landing it was asked for: none here, whatever sign-in resolves with */
window.RevampAuth.whenResolved().then(function () { owBoot(); }, function () { owBoot(); });
