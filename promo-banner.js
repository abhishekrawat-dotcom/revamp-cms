/* Promotions → Mailers: the mail's top banner, drawn in this browser (there is no Chrome on the server).

   window.RevampPromoBanner = {
     ensure(eventId, opts?) -> Promise<{ ok: true, none: true }      the site has no hero picture: no banner
                                      | { ok: true, url }            the event's current banner is stored
                                      | { ok: false, error }>        it could not be made (never rejects)
   }

   ET's mailers open with one picture holding the event's art, its logo unit, and its date and venue with
   calendar and pin icons (owner decision C). The server (lib/promo-banner.js) knows what that picture must show
   and whether the one it has is still the event's: GET /api/promo/mailer/banner answers { needed, fresh,
   fingerprint, url, inputs }. When it is needed and not fresh, it is drawn here with the posts' own "Save the
   date" drawing (RevampPromoPosts.banner, promo-posts.js) at 750 px, made a JPEG at 2× (RevampPromo.toPng,
   promo-kit.js) — once more at a lower quality when it is over 2 MB — and uploaded with the fingerprint it was
   drawn from. When the event changed meanwhile the server answers 409 'banner-moved' and the round is made
   once more from the new inputs.

   marketing.html starts ensure() the first time the Mailers tab is shown, and answers the mailer studio's
   { rvBanner: 'ensure' } with its result: the studio waits for it before it opens, downloads, exports or copies
   a mail, and asks again with { fresh: true } when the server says the banner is stale. One run per page: a
   second ensure() gets the first one's promise, unless it asks for a fresh one. A run that fails resolves
   { ok: false, error } — the studio then lets the server decide, which refuses to send a stale banner — and the
   cause is kept in the console. */
(function () {
  'use strict';

  var WIDTH = 750;                         // the mail's width; drawn at pixelRatio 2, so 1500 px
  var MAX_BYTES = 2 * 1024 * 1024;         // the server's limit (lib/promo-banner.js)
  var QUALITY = 0.86, SMALLER = 0.78;
  /* A run that has not finished by then answers { ok: false }: the studio stops waiting and lets the server
     decide, and a later call is not kept waiting on a run that hangs (a picture that never loads). */
  var RUN_LIMIT_MS = 60000;

  var kept = {};

  function failure(r) {
    var err = new Error((r.data && r.data.error) || ('The server answered ' + r.status + '.'));
    err.status = r.status; err.code = r.data && r.data.code;
    return err;
  }
  /* -> { status, ok, data } with the JSON answer (or {}) */
  function call(method, url, body, type) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) { opts.body = body; opts.headers['Content-Type'] = type; }
    return window.RevampAuth.authedFetch(url, opts).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        return { status: r.status, ok: r.ok, data: data && typeof data === 'object' ? data : {} };
      });
    });
  }

  /* the inputs drawn and made a JPEG of at most 2 MB; the drawing's off-screen node is always removed */
  function draw(inputs) {
    var posts = window.RevampPromoPosts, promo = window.RevampPromo;
    if (!posts || typeof posts.banner !== 'function' || !promo || typeof promo.toPng !== 'function') {
      return Promise.reject(new Error('The banner drawing did not load. Reload the page.'));
    }
    return Promise.resolve(posts.banner(inputs)).then(function (d) {
      function finish() { try { if (d && typeof d.done === 'function') d.done(); } catch (e) { /* already gone */ } }
      var height = Math.round(+(d && d.height) || 0);
      if (!d || !d.node || !(height > 0)) { finish(); throw new Error('The banner could not be drawn.'); }
      function shot(quality) { return promo.toPng(d.node, WIDTH, height, { pixelRatio: 2, type: 'image/jpeg', quality: quality }); }
      return shot(QUALITY).then(function (blob) {
        return blob && blob.size > MAX_BYTES ? shot(SMALLER) : blob;
      }).then(function (blob) {
        finish();
        if (!blob || !blob.size) throw new Error('The banner picture could not be made.');
        if (blob.size > MAX_BYTES) throw new Error('The banner picture came out larger than 2 MB.');
        return blob;
      }, function (err) {
        finish();
        throw err;
      });
    });
  }

  /* one round: ask, draw when needed, upload; `again` is true for the round after a 'banner-moved' */
  function run(eventId, again) {
    var q = 'eventId=' + encodeURIComponent(eventId);
    return call('GET', '/api/promo/mailer/banner?' + q).then(function (r) {
      if (!r.ok) throw failure(r);
      var st = r.data;
      if (!st.needed) return { ok: true, none: true };
      if (st.fresh && st.url) return { ok: true, url: st.url };
      if (!/^[0-9a-f]{32}$/.test(String(st.fingerprint || '')) || !st.inputs) throw new Error('The server did not say what the banner must show.');
      /* the drawing's pictures come through /api/promo/image for this event (promo-kit.js image()) */
      if (window.RevampPromo && typeof window.RevampPromo.use === 'function') window.RevampPromo.use(eventId);
      return draw(st.inputs).then(function (blob) {
        return call('POST', '/api/promo/mailer/banner?' + q + '&fingerprint=' + st.fingerprint, blob, 'image/jpeg');
      }).then(function (u) {
        if (u.status === 409 && u.data.code === 'banner-moved' && !again) return run(eventId, true);
        if (!u.ok || !u.data.url) throw failure(u);
        return { ok: true, url: u.data.url };
      });
    });
  }

  /* the run's answer, never a rejection, and never later than RUN_LIMIT_MS */
  function settle(job) {
    return new Promise(function (resolve) {
      var over = false;
      var timer = setTimeout(function () { end(null, new Error('Drawing the mail banner took too long.')); }, RUN_LIMIT_MS);
      function end(value, err) {
        if (over) return;
        over = true;
        clearTimeout(timer);
        if (!err) return resolve(value);
        console.error('promo-banner: the mail banner was not made —', err);
        resolve({ ok: false, error: String((err && err.message) || err || 'The mail banner could not be made.') });
      }
      job.then(function (value) { end(value, null); }, function (err) { end(null, err || new Error('The mail banner could not be made.')); });
    });
  }

  function ensure(eventId, opts) {
    var id = String(eventId == null ? '' : eventId).trim(), key = 'e:' + id;
    var fresh = !!(opts && opts.fresh);
    if (!fresh && Object.prototype.hasOwnProperty.call(kept, key)) return kept[key];
    kept[key] = settle(Promise.resolve().then(function () {
      if (!id) throw new Error('No event to draw a mail banner for.');
      return run(id, false);
    }));
    return kept[key];
  }

  window.RevampPromoBanner = { ensure: ensure };
})();
