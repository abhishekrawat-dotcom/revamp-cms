/* The site check in the event console (edit-event.html): what is wrong with the live site — or, before it goes live,
   with the site as last saved — in the same words the approver reads on the review page (GET /api/event/site-check,
   functions/lib/api.js siteCheckOf).

   WHY (the UX sweep of 3 Nov 2026, UX-140 / UX-143 / UX-144): a template nobody had filled in, a test and a page
   with a broken picture were live, and an older site's header still showed last year's boxed logo — and nothing in
   the console said so. Publishing now refuses what blocks; this panel says it for pages that went live before.
   What a live page shows already holds no next version back (siteCheckOf's alreadyLive): it is listed as a check
   to put right, so a repair can go live while the rest is still being put right (UX-144).

   Shown above every section of the console, only when there is something to fix or to know (a block or a check).
   An item that can be put right in one click carries its button ("Update this site's header and footer",
   "Correct the picture's address", "Write it a heading of its own"): that saves the repaired site as a new version (POST /api/event/site/repair)
   and, for a live site, sends it for approval like any edit (POST /api/event/approval/request) — nothing goes live
   from here. A live site with a newer saved version (a repair waiting for approval) is checked as saved too: what that
   version already puts right says so, with no button to press again. Plain ES5; builds everything with
   createElement / textContent. */
(function () {
  'use strict';

  /* The live site's check, with what its newer saved version already puts right (saved: that version's check, or
     null when there is none). An item of the live site that offers a one-click repair (et-chrome, pictures) and is
     no longer in the saved version's check is put right there: it loses its button and says where it stands.
     -> { of, items, blocks, nextVersion } — blocks: what would hold the next version back (the saved one's, when
     there is one: that is the next version). Pure; edit-event-site-check.test.js runs it in node. */
  function settle(live, saved) {
    var next = saved && saved.found ? saved : null;
    var stillThere = {};
    if (next) (next.items || []).forEach(function (x) { if (x.action && x.action.kind) stillThere[x.code] = true; });
    var waiting = next && live.approvalVersion && live.approvalVersion >= next.savedVersion;
    var items = (live.items || []).map(function (x) {
      if (!next || !x.action || !x.action.kind || stillThere[x.code]) return x;
      var copy = {};
      for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) copy[k] = x[k];
      copy.action = null;
      copy.hint = '';                       // how to put it right: done already
      copy.settled = 'Put right in version ' + next.savedVersion + (waiting ? ', which is waiting for approval.' : ', which is saved and not live yet: send it for approval.');
      return copy;
    });
    var blocks = (next || live).items ? (next || live).items.filter(function (x) { return x.level === 'block'; }).length : 0;
    return { of: live.of, items: items, blocks: blocks, nextVersion: next ? next.savedVersion : 0 };
  }
  if (typeof module === 'object' && module && module.exports) module.exports = { settle: settle };
  if (typeof window === 'undefined') return;

  var C = window.RevampCore;
  if (!C || typeof C.authedFetch !== 'function' || !document.querySelector) return;
  var eventId = String(new URLSearchParams(location.search).get('event') || '').trim();
  if (!eventId) return;

  var LEVEL = { block: 'Holds it back', warn: 'Check', info: 'Good to know' };
  var box = null, busy = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function call(method, url, body) {
    var opts = { method: method };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return C.authedFetch(url, opts).then(function (res) {
      return res.json().then(function (j) { return { ok: res.ok, status: res.status, body: j || {} }; }, function () { return { ok: res.ok, status: res.status, body: {} }; });
    }).then(function (r) {
      if (!r.ok) { var e = new Error(r.body.error || 'The server could not do this. Please try again.'); e.status = r.status; e.body = r.body; throw e; }
      return r.body;
    });
  }

  function styles() {
    if (document.getElementById('site-check-css')) return;
    var st = el('style');
    st.id = 'site-check-css';
    st.textContent =
      '.site-check{margin:0 0 18px;border:1px solid var(--border);border-radius:12px;background:var(--surface);box-shadow:var(--shadow-sm);font-family:var(--font-body);color:var(--text)}' +
      '.site-check>summary{list-style:none;cursor:pointer;display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:12px 16px;font-weight:700;font-size:14px}' +
      '.site-check>summary::-webkit-details-marker{display:none}' +
      '.site-check>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:12px}' +
      '.site-check .sc-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--warn)}' +
      '.site-check.has-block .sc-dot{background:var(--accent)}' +
      '.site-check .sc-sub{font-weight:500;color:var(--text-muted);font-size:13px;flex:1 1 220px}' +
      '.site-check .sc-body{padding:0 16px 14px}' +
      '.site-check .sc-item{border:1px solid var(--border);border-left-width:4px;border-radius:10px;padding:10px 12px;margin-top:8px;font-size:13px}' +
      '.site-check .sc-item.block{border-left-color:var(--accent);background:var(--accent-soft)}' +
      '.site-check .sc-item.warn{border-left-color:var(--warn)}' +
      '.site-check .sc-item.info{border-left-color:var(--border)}' +
      '.site-check .sc-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;font-weight:700}' +
      '.site-check .sc-lvl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:5px;background:var(--surface-2);color:var(--text-muted);white-space:nowrap}' +
      '.site-check .block .sc-lvl{background:var(--accent);color:var(--accent-contrast)}' +
      '.site-check .warn .sc-lvl{background:var(--warn-soft);color:var(--warn)}' +
      '.site-check ul{margin:6px 0 0;padding-left:18px}.site-check li{margin:2px 0;overflow-wrap:anywhere}' +
      '.site-check .sc-hint{color:var(--text-muted);font-size:12px;margin-top:6px}' +
      '.site-check .sc-act{margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
      '.site-check .sc-msg{font-size:12.5px;color:var(--text-muted)}.site-check .sc-msg.err{color:var(--accent-strong)}.site-check .sc-msg a{color:inherit}';
    document.head.appendChild(st);
  }

  function render(r) {
    var main = document.querySelector('main.main'), view = document.getElementById('view');
    if (!main || !view) return;
    var shown = (r.items || []).filter(function (x) { return x.level === 'block' || x.level === 'warn'; });
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
    if (!shown.length) return;
    styles();
    var blocks = r.blocks != null ? r.blocks : shown.filter(function (x) { return x.level === 'block'; }).length;
    box = el('details', 'site-check' + (blocks ? ' has-block' : ''));
    /* open when something holds the next version back, or a one-click repair is waiting to be pressed */
    box.open = blocks > 0 || shown.some(function (x) { return !!(x.action && x.action.kind); });
    var sum = el('summary');
    sum.appendChild(el('span', 'sc-dot'));
    sum.appendChild(el('span', null, r.of === 'live' ? 'Your live site: ' + shown.length + (shown.length === 1 ? ' thing to look at' : ' things to look at')
      : 'Before this site goes live: ' + shown.length + (shown.length === 1 ? ' thing to look at' : ' things to look at')));
    sum.appendChild(el('span', 'sc-sub', blocks ? '— ' + blocks + ' would hold ' + (r.nextVersion ? 'version ' + r.nextVersion : 'the next version') + ' back'
      : '— nothing holds ' + (r.nextVersion ? 'version ' + r.nextVersion : 'it') + ' back'));
    box.appendChild(sum);
    var body = el('div', 'sc-body');
    (r.items || []).forEach(function (item) { body.appendChild(itemEl(item, r)); });
    box.appendChild(body);
    main.insertBefore(box, view);
  }

  function itemEl(item, r) {
    var n = el('div', 'sc-item ' + item.level);
    var top = el('div', 'sc-top');
    top.appendChild(el('span', 'sc-lvl', LEVEL[item.level] || item.level));
    top.appendChild(el('span', null, item.title));
    n.appendChild(top);
    if (item.lines && item.lines.length) {
      var ul = el('ul');
      item.lines.forEach(function (l) { ul.appendChild(el('li', null, l)); });
      n.appendChild(ul);
    }
    if (item.hint) n.appendChild(el('div', 'sc-hint', item.hint));
    if (item.settled) {
      var done = el('div', 'sc-act');
      done.appendChild(el('span', 'sc-msg', item.settled));
      n.appendChild(done);
    }
    if (item.action && item.action.kind) {
      var act = el('div', 'sc-act');
      var b = el('button', 'btn btn-secondary', item.action.label);
      b.type = 'button';
      var msg = el('span', 'sc-msg');
      msg.setAttribute('role', 'status');
      b.addEventListener('click', function () { repair(item.action.kind, b, msg, r); });
      act.appendChild(b);
      act.appendChild(msg);
      n.appendChild(act);
    }
    return n;
  }

  /* The repair as a new saved version; a live site's goes for approval like any edit. The site editor keeps its
     own copy of the site in each browser: one saved before this version asks before saving over it (its
     "Save over version N?"), so the owner is told. */
  var EDITOR_NOTE = ' A copy of the site open in the site editor from before still has the old version: it asks before saving over this one.';
  function repair(kind, button, msg, r) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    msg.className = 'sc-msg';
    /* a heading is written by ETB2B AI first, which takes a few seconds more */
    msg.textContent = kind === 'headings' ? 'ETB2B AI is writing the heading, then the site is saved with it…' : 'Saving the site with this put right…';
    call('POST', '/api/event/site/repair', { eventId: eventId, repairs: [kind] }).then(function (saved) {
      if (!saved.published) {
        msg.textContent = 'Saved as version ' + saved.version + '. It goes live when the site is published.' + EDITOR_NOTE;
        return;
      }
      msg.textContent = 'Saved as version ' + saved.version + '. Sending it for approval…';
      var note = 'Put right from the site check: ' + (saved.repaired || []).join(', ') + '.';
      return call('POST', '/api/event/approval/request', { eventId: eventId, note: note }).then(function (req) {
        msg.textContent = 'Saved as version ' + saved.version + ' and sent for approval. ';
        if (req.reviewPath) {
          var a = el('a', null, 'Open the review');
          a.href = req.reviewPath;
          msg.appendChild(a);
          msg.appendChild(document.createTextNode('.'));
        }
        msg.appendChild(document.createTextNode(EDITOR_NOTE));
      }, function (err) {
        /* saved, but not sent: what holds it back is the server's own words (the site check's other items) */
        msg.className = 'sc-msg err';
        msg.textContent = 'Saved as version ' + saved.version + ', but not sent for approval: ' + err.message;
      });
    }).then(function () { busy = false; }, function (err) {
      busy = false;
      button.disabled = false;
      msg.className = 'sc-msg err';
      msg.textContent = err.message;
    });
  }

  function load() {
    var saved = function () { return call('GET', '/api/event/site-check?eventId=' + encodeURIComponent(eventId) + '&of=saved'); };
    call('GET', '/api/event/site-check?eventId=' + encodeURIComponent(eventId) + '&of=live').then(function (r) {
      if (!r.published) return saved();
      /* a newer version saved since (a repair from here, waiting for approval): what it puts right is said so */
      if (r.savedVersion > r.publishedVersion) return saved().then(function (s) { return settle(r, s); }, function () { return r; });
      return r;
    }).then(render, function () { /* the console works without it; a failure here is not the owner's to read */ });
  }

  /* after the console has drawn its first view (it waits for its session and the event) */
  function start() {
    var tries = 0;
    (function wait() {
      if (document.querySelector('main.main') && document.getElementById('view') && document.getElementById('rail') && !document.getElementById('rail').hidden) return load();
      if (++tries < 60) setTimeout(wait, 500);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
