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

   Function declarations here replace the platform's of the same name: this file is the last script. */

/* ---------- the event ---------- */
var EVENT_ID = new URLSearchParams(location.search).get('event') || '';
var S = { portal: null, portalName: null, event: EVENT_ID, award: null, kind: 'events', product: 'mail', section: 'mail' };
function mark() { /* the platform keeps its own URL in step; this page's URL is the event's, and stays */ }

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
function owRenderPage() {
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
function owBoot() {
  if (!EVENT_ID) { $('content').innerHTML = '<div class="empty"><div class="big">No event</div>Open Promotions from an event.</div>'; return; }
  $('content').innerHTML = skEventPage();
  api('/api/mailers?portal=&event=' + encodeURIComponent(EVENT_ID)).then(function (r) {
    return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.error) || ('The server answered ' + r.status)); return j; });
  }).then(function (j) {
    MAILERS = j;
    S.portal = (j.event && j.event.portal) || '';
    S.portalName = S.portal;
    owSortCatalog();
    owRenderPage();
    var q = new URLSearchParams(location.search), open = q.get('mailer');
    if (open && findMailer(open)) openMailer(open, q.get('version') || null, false);
  }).catch(function (err) {
    $('content').innerHTML = '<div class="empty"><div class="big">Mailers could not be loaded</div>' + escapeHtml(err && err.message || 'Please try again.') +
      '<div style="margin-top:14px"><button class="btn" onclick="owBoot()">Try again</button></div></div>';
  });
}

/* ---------- the studio takes the whole window while it is open ---------- */
function owTellParent(state) { try { if (window.parent !== window) window.parent.postMessage({ rvMailerStudio: state }, location.origin); } catch (e) { /* not framed */ } }
var owOpenMailer = openMailer, owCloseMailer = closeMailer;
openMailer = function (preId, saveId, fresh) { owTellParent('open'); return owOpenMailer(preId, saveId, fresh); };
closeMailer = function () {
  var wasOpen = $('mailer').classList.contains('on');
  owCloseMailer();
  if (wasOpen && !$('mailer').classList.contains('on')) owTellParent('close');
};

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

window.RevampAuth.whenResolved().then(owBoot, owBoot);
