// Minimal HTTP service that does exactly one thing: launch headless Chrome, render a URL, and hand back
// the rendered HTML. It exists because this repo's main backend (Firebase App Hosting, see
// ../apphosting.yaml) builds its container with Google's automatic buildpacks -- there is no Dockerfile
// for that service, so there is no way to apt-get install the system libraries (libnss3 and friends)
// headless Chrome needs. This service is deployed separately, straight to Cloud Run with a real
// Dockerfile (see Dockerfile in this directory), so it CAN install whatever Chrome needs. The main
// backend (functions/lib/api.js's scrapeLovableUrl()) calls this service over plain HTTP instead of
// launching Chrome itself. See README.md in this directory for the full picture and deploy instructions.
//
// Endpoint: POST /scrape  body {url}  ->  200 {html}  |  4xx/5xx {error}
//
// Auth: every request must carry the shared secret configured on BOTH this service (env SCRAPER_SECRET)
// and the main backend (env LOVABLE_SCRAPER_SECRET) in the X-Scraper-Secret header. This is a simple
// shared secret, not GCP IAM auth -- wiring real service-to-service IAM auth from Firebase App Hosting
// would need more plumbing than this one feature justifies. It exists purely to stop this service's own
// public Cloud Run URL being abused as an open "render any URL through headless Chrome" proxy by anyone
// who finds it.
//
// SSRF guard: this service is the thing that actually fetches an attacker-reachable URL, so it
// re-implements the exact same validateImportUrl()/isPrivateOrLoopbackIp() logic functions/lib/api.js
// already applies on the main backend before a request ever reaches here (scheme allow-list + a real
// DNS-resolved rejection of loopback/private/link-local/cloud-metadata addresses -- see that file for the
// original). This matters doubly here: this container has its own 169.254.169.254 metadata endpoint that
// must stay unreachable from a URL this service is asked to render.

var http = require('http');
var dns = require('dns');
var puppeteer = require('puppeteer');

var PORT = process.env.PORT || 8080;
var SECRET = process.env.SCRAPER_SECRET || '';

// Same two timeouts and reasoning as the (now-removed) in-process version of this logic in
// functions/lib/api.js: NAV_TIMEOUT_MS is page.goto()'s own ceiling for reaching network-idle,
// TOTAL_TIMEOUT_MS is the hard ceiling on the whole render (Chrome launch included) so one slow/hung
// site can never tie up this process (and its headless Chrome) forever.
var NAV_TIMEOUT_MS = 30000;
var TOTAL_TIMEOUT_MS = 105000;   // the page is walked through before capture (carousels, accordions): see settlePage

// ---------- SSRF guard (ported from functions/lib/api.js's isPrivateOrLoopbackIp/validateImportUrl) ----------

function isPrivateOrLoopbackIp(ip) {
  if (/^127\./.test(ip)) return true;                                    // IPv4 loopback
  if (/^10\./.test(ip)) return true;                                     // RFC1918
  if (/^192\.168\./.test(ip)) return true;                               // RFC1918
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;                // RFC1918
  if (/^169\.254\./.test(ip)) return true;                               // link-local / cloud metadata
  if (ip === '0.0.0.0') return true;
  if (ip === '::1') return true;                                         // IPv6 loopback
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;                       // IPv6 unique-local (fc00::/7)
  if (/^fe80:/i.test(ip)) return true;                                   // IPv6 link-local
  return false;
}

function validateUrl(rawUrl) {
  var u;
  try { u = new URL(rawUrl); } catch (e) { return Promise.resolve('That doesn\'t look like a valid URL.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return Promise.resolve('Only http:// and https:// URLs are allowed.');
  var host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateOrLoopbackIp(host)) {
    return Promise.resolve('That host isn\'t allowed.');
  }
  return new Promise(function (resolve) {
    dns.lookup(host, { all: true }, function (err, addrs) {
      if (err) return resolve('Could not resolve that host.');
      var bad = (addrs || []).some(function (a) { return isPrivateOrLoopbackIp(a.address); });
      resolve(bad ? 'That host resolves to a private address and isn\'t allowed.' : null);
    });
  });
}

// ---------- the actual render ----------

// The capture keeps the page's markup and drops its scripts, so whatever a script would have done later
// for a visitor has to have happened before the capture:
//   - content revealed when it scrolls into view, and lazy pictures: the page is scrolled through once,
//     top to bottom, and put back at the top;
//   - rows that open on a click (button[aria-expanded]) whose panel only exists while open: each closed row
//     is opened once, its panel copied, and the copies put back closed (height 0) after their buttons, so
//     the imported page has every panel to open (templates/_shared/et-runtime.js does the opening).
// Bounded: at most SETTLE_MAX_ROWS rows and SETTLE_MAX_SCROLL_STEPS scroll steps.
var SETTLE_MAX_ROWS = 40;
var SETTLE_MAX_SCROLL_STEPS = 80;

async function settlePage(page) {
  await page.evaluate(async function (maxSteps) {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    var step = Math.max(300, Math.round(window.innerHeight * 0.7));
    for (var i = 0, y = 0; i < maxSteps && y < document.documentElement.scrollHeight; i++, y += step) {
      window.scrollTo(0, y);
      await wait(140);
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await wait(300);
    window.scrollTo(0, 0);
    await wait(900);
  }, SETTLE_MAX_SCROLL_STEPS);

  /* Carousels that keep only the cards on show in the page: a previous and a next button beside a region
     holding one row. Next is pressed until no new card turns up, and the row is rebuilt with every card in
     it, as a strip that scrolls sideways (data-rv-carousel / -track / -prev / -next: et-runtime.js moves it
     on the live page, and the editor shows the whole strip). */
  await page.evaluate(async function (maxPages) {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    var found = [];
    var nexts = Array.prototype.slice.call(document.querySelectorAll('button[aria-label]')).filter(function (b) {
      return /^next\b/i.test(b.getAttribute('aria-label')) && !b.closest('header, nav');
    }).slice(0, 12);
    for (var n = 0; n < nexts.length; n++) {
      var next = nexts[n], box = next.parentElement;
      var holder = box && box.querySelector('[role="region"], [aria-roledescription="carousel"]');
      if (!holder) continue;
      var row = function () { return holder.querySelector('[data-carousel-layer="current"]') || holder.querySelector('[data-carousel-layer]') || holder.firstElementChild; };
      if (!row() || !row().children.length) continue;
      var first = row().firstElementChild.getBoundingClientRect().width;
      var gap = parseFloat(getComputedStyle(row()).columnGap) || 16;
      var cards = [], seen = {}, stale = 0, onShow = row().children.length;
      for (var i = 0; i < maxPages && stale < 2; i++) {
        var fresh = 0;
        Array.prototype.forEach.call(row().children, function (card) {
          var key = (card.textContent || '').replace(/\s+/g, ' ').trim() || card.outerHTML;
          if (seen[key]) return;
          seen[key] = true; cards.push(card.outerHTML); fresh++;
        });
        stale = fresh ? 0 : stale + 1;
        next.click();
        await wait(600);
      }
      if (cards.length <= onShow || !first) continue;          // everything was in the page already
      found.push({ next: next, box: box, holder: holder, cards: cards, first: Math.round(first), gap: gap });
    }
    /* The rows are rebuilt at the very last moment, in the same step that reads the page (finishPage): the
       page's own script draws a row again whenever it likes (a timer, another click), and would put its
       few cards back over ours. */
    window.__rvCarousels = found;
    window.scrollTo(0, 0);
  }, 40);

  await page.evaluate(async function (maxRows) {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    var rows = Array.prototype.slice.call(document.querySelectorAll('button[aria-expanded]')).filter(function (b) {
      return !b.closest('header, nav') && !b.hasAttribute('aria-haspopup');
    }).slice(0, maxRows);
    if (!rows.length) return;
    var wasOpen = rows.filter(function (b) { return b.getAttribute('aria-expanded') === 'true'; });
    var copies = [];
    for (var i = 0; i < rows.length; i++) {
      var b = rows[i];
      if (b.getAttribute('aria-expanded') === 'true' || b.nextElementSibling) continue;   // its panel is in the page already
      b.click();
      await wait(650);
      var panel = b.nextElementSibling;
      if (b.getAttribute('aria-expanded') === 'true' && panel && !/^(BUTTON|A)$/.test(panel.tagName)) {
        copies.push({ row: b, html: panel.outerHTML });
      }
    }
    // back to how the page opens
    for (var j = 0; j < rows.length; j++) {
      var open = rows[j].getAttribute('aria-expanded') === 'true';
      if (open !== (wasOpen.indexOf(rows[j]) !== -1)) { rows[j].click(); await wait(650); }
    }
    copies.forEach(function (c) {
      if (c.row.nextElementSibling || c.row.getAttribute('aria-expanded') === 'true') return;
      c.row.insertAdjacentHTML('afterend', c.html);
      var p = c.row.nextElementSibling;
      p.style.height = '0px'; p.style.opacity = '0'; p.style.overflow = 'hidden';
    });
    window.scrollTo(0, 0);
    await wait(300);
  }, SETTLE_MAX_ROWS);
}

/* Runs in the page, in one go: what settlePage prepared is put into the markup and the markup is read, with
   no moment in between for the page's own script to redraw anything. */
function finishPage() {
  try {
    (window.__rvCarousels || []).forEach(function (c) {
      if (!c.holder.isConnected) return;
      var keep = c.holder.querySelector('[data-carousel-layer="current"]') || c.holder.querySelector('[data-carousel-layer]') || c.holder.firstElementChild;
      if (!keep) return;
      Array.prototype.slice.call(c.holder.children).forEach(function (n) { if (n !== keep) n.remove(); });
      keep.innerHTML = c.cards.join('');
      Array.prototype.forEach.call(keep.children, function (card) { card.style.flex = '0 0 ' + c.first + 'px'; card.style.scrollSnapAlign = 'start'; });
      keep.style.cssText = 'display:flex;gap:' + c.gap + 'px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;width:100%';
      keep.setAttribute('data-rv-carousel-track', '');
      c.box.setAttribute('data-rv-carousel', '');
      c.next.setAttribute('data-rv-carousel-next', '');
      Array.prototype.forEach.call(c.box.querySelectorAll('button[aria-label]'), function (b) {
        if (/^previous\b/i.test(b.getAttribute('aria-label'))) b.setAttribute('data-rv-carousel-prev', '');
      });
    });
  } catch (e) { /* the page is read as it stands */ }
  return document.documentElement.outerHTML;
}

// Launches headless Chrome, navigates to `url`, waits briefly for any late mount/animation, and returns
// the final rendered outerHTML. Closes the browser on every path -- success, navigation timeout, launch
// failure, or the overall TOTAL_TIMEOUT_MS firing -- so a failed/slow request never leaks a Chrome
// process. If the hard timeout fires before Chrome has even finished launching, this waits for that
// launch attempt to actually settle (success or failure) before trying to close it, so a browser that
// finishes launching just after the timeout still gets closed instead of orphaned.
async function scrapeUrl(url) {
  var browser = null;

  async function closeBrowser() {
    if (!browser) return;
    var b = browser;
    browser = null;
    try { await b.close(); } catch (e) { console.error('scrape: error closing headless Chrome: ' + e.message); }
  }

  var work = (async function () {
    browser = await puppeteer.launch({
      headless: true,
      // --disable-dev-shm-usage: Cloud Run's default /dev/shm is tiny; without this, Chrome can crash
      // outright on real pages. --no-sandbox/--disable-setuid-sandbox: Chrome's own sandbox needs kernel
      // privileges this container doesn't grant -- the standard, well-documented flags for running
      // headless Chrome inside a Docker container (see README.md).
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    var page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      // A site with e.g. continuous analytics pings may never truly go network-idle -- don't fail the
      // whole render over that; capture whatever has rendered by now instead.
      console.error('scrape: navigation to "' + url + '" did not fully settle (' + err.message + ') -- capturing whatever rendered so far.');
    }
    await new Promise(function (resolve) { setTimeout(resolve, 3500); }); // let an intro animation play out
    try { await settlePage(page); } catch (err) {
      // best effort: a page this cannot walk through is still captured as it stands
      console.error('scrape: could not settle "' + url + '" before capture (' + err.message + ').');
    }
    return page.evaluate(finishPage);
  })();

  var timer;
  var timeoutPromise = new Promise(function (_resolve, reject) {
    timer = setTimeout(function () {
      reject(Object.assign(new Error('Rendering this page took too long (over ' + Math.round(TOTAL_TIMEOUT_MS / 1000) + 's).'), { status: 504 }));
    }, TOTAL_TIMEOUT_MS);
  });

  try {
    var html = await Promise.race([work, timeoutPromise]);
    clearTimeout(timer);
    await closeBrowser();
    return html;
  } catch (err) {
    clearTimeout(timer);
    await work.catch(function () {}); // let a still-in-flight launch/goto settle so `browser` is really set
    await closeBrowser();
    throw err;
  }
}

// ---------- plain HTTP plumbing ----------

function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, cb) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () { cb(Buffer.concat(chunks).toString('utf8')); });
  req.on('error', function () { cb(''); });
}

var server = http.createServer(function (req, res) {
  if (req.method === 'GET' && req.url === '/healthz') return sendJson(res, 200, { ok: true });

  if (req.method !== 'POST' || req.url !== '/scrape') {
    return sendJson(res, 404, { error: 'Not found. POST /scrape with {url}.' });
  }

  if (!SECRET) {
    console.error('scrape: SCRAPER_SECRET is not set on this service -- refusing all requests until it is.');
    return sendJson(res, 500, { error: 'This service has no SCRAPER_SECRET configured yet.' });
  }
  var provided = req.headers['x-scraper-secret'];
  if (!provided || provided !== SECRET) {
    return sendJson(res, 401, { error: 'Missing or incorrect X-Scraper-Secret header.' });
  }

  readBody(req, function (raw) {
    var body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
    var url = body && body.url ? String(body.url).trim() : '';
    if (!url) return sendJson(res, 400, { error: 'url is required.' });

    validateUrl(url).then(function (badReason) {
      if (badReason) return sendJson(res, 400, { error: badReason });
      return scrapeUrl(url).then(function (html) {
        sendJson(res, 200, { html: html });
      }).catch(function (err) {
        console.error('scrape: failed to render "' + url + '": ' + err.message);
        sendJson(res, err.status || 500, { error: err.message || 'Failed to render that URL.' });
      });
    });
  });
});

server.listen(PORT, function () { console.log('lovable-scraper-service listening on :' + PORT); });
