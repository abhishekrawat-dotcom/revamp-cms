/* Create Event's unfinished drafts in the person's account (UX-048), for the two pages that use them:
   create-event.html saves each draft here as it is typed and resumes one by ?draft=<id>, and the events dashboard
   (Event_Listing.html) lists them under Drafts with Resume and Discard. The server side is functions/lib/create-drafts.js.

     RevampCreateDrafts.list()                       -> Promise [{ id, rev, savedAt, updatedAt, summary }]
     RevampCreateDrafts.get(id)                      -> Promise { id, rev, savedAt, updatedAt, summary, files, state } | null (not in the account)
     RevampCreateDrafts.put(id, rev, state, opts)    -> Promise { rev, savedAt }; opts { writer, force }. A refusal is an Error with
                                                        .status and .code ('draft-conflict' carries .current: what the account holds)
     RevampCreateDrafts.remove(id)                   -> Promise; when the server cannot be reached the id is kept and removed on the
                                                        next flushRemovals(), and list() leaves it out meanwhile
     RevampCreateDrafts.flushRemovals()              -> Promise   removals that could not be made earlier, tried again
     RevampCreateDrafts.putFile(id, slot, blob, name)-> Promise   one of the draft's pictures (slot: 'logo', 'banner', 'banner-text', 'img:<n>')
     RevampCreateDrafts.getFile(id, slot)            -> Promise Blob | null
     RevampCreateDrafts.forgetLocal(storage, id)     this browser's copy of a draft, removed (the dashboard's Discard)
     RevampCreateDrafts.writerId(storage)            this browser's mark on what it saves, so a save of its own is never taken
                                                        for another computer's
     RevampCreateDrafts.describe(d, opts)            -> { name, type, portal, where, when, eventId }: the words the dashboard shows
     RevampCreateDrafts.serverSlot(slot) / localSlot(slot)   'img:3' <-> 'img-3'

   The browser's own copy of each draft is in localStorage under LOCAL_PREFIX + id, and CURRENT_KEY names the draft this
   browser worked on last (the bare create-event.html resumes it). ES5 on purpose: both pages serve it as it is. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.RevampCreateDrafts = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var LOCAL_PREFIX = 'revamp.createEvent.draft.v2.';
  var CURRENT_KEY = 'revamp.createEvent.current.v2';
  var WRITER_KEY = 'revamp.createEvent.writer.v1';
  var REMOVALS_KEY = 'revamp.createEvent.removals.v1';
  var ID_RE = /^draft-[a-z0-9]{1,16}-[a-z0-9]{1,16}$/;
  var TYPE_WORDS = { IP: 'IP event', Client: 'Client event', Awards: 'Awards' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function win() { return typeof window !== 'undefined' ? window : {}; }
  function storageOf(s) {
    if (s) return s;
    try { return win().localStorage || null; } catch (e) { return null; }
  }
  function isId(id) { return typeof id === 'string' && ID_RE.test(id); }
  function serverSlot(slot) { return String(slot == null ? '' : slot).replace(/^img:/, 'img-'); }
  function localSlot(slot) { return String(slot == null ? '' : slot).replace(/^img-/, 'img:'); }

  /* every call goes through auth.js's RevampAuth.authedFetch: the person's own session, and their own drafts */
  function send(method, url, body) {
    var auth = win().RevampAuth;
    if (!auth || typeof auth.authedFetch !== 'function') return Promise.reject(failure('This page did not load completely. Reload it and try again.', 0));
    var opts = { method: method, headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return Promise.resolve(auth.authedFetch(url, opts)).then(null, function (err) {
      throw failure(err && err.message && !/fetch/i.test(err.message) ? err.message : 'The server could not be reached. Check your connection.', 0);
    });
  }
  function failure(message, status, data) {
    var err = new Error(message);
    err.status = status;
    err.code = data && typeof data.code === 'string' ? data.code : '';
    if (data && 'current' in data) err.current = data.current;
    return err;
  }
  function readJson(res) {
    return res.json().then(null, function () { return {}; }).then(function (data) {
      if (!res.ok) throw failure((data && typeof data.error === 'string' && data.error) || 'The server had a problem (' + res.status + '). Please try again.', res.status, data);
      return data || {};
    });
  }
  function call(method, url, body) { return send(method, url, body).then(readJson); }

  function removalsOf(s) {
    s = storageOf(s);
    try { var v = JSON.parse((s && s.getItem(REMOVALS_KEY)) || '[]'); return Array.isArray(v) ? v.filter(isId) : []; } catch (e) { return []; }
  }
  function setRemovals(list, s) {
    s = storageOf(s);
    try { if (s) { if (list.length) s.setItem(REMOVALS_KEY, JSON.stringify(list.slice(-50))); else s.removeItem(REMOVALS_KEY); } } catch (e) { /* only not retried */ }
  }

  function list() {
    var gone = removalsOf();
    return call('GET', '/api/me/create-drafts').then(function (data) {
      return (Array.isArray(data.drafts) ? data.drafts : []).filter(function (d) { return d && isId(d.id) && gone.indexOf(d.id) === -1; });
    });
  }
  function get(id) {
    if (!isId(id)) return Promise.resolve(null);
    if (removalsOf().indexOf(id) !== -1) return Promise.resolve(null);
    return call('GET', '/api/me/create-draft?id=' + encodeURIComponent(id)).then(function (data) {
      return data.draft && data.draft.state ? data.draft : null;
    }, function (err) {
      if (err.status === 404) return null;
      throw err;
    });
  }
  function put(id, rev, state, opts) {
    opts = opts || {};
    return call('PUT', '/api/me/create-draft', { id: id, rev: +rev || 0, writer: opts.writer || '', force: opts.force === true, state: state });
  }
  function remove(id) {
    if (!isId(id)) return Promise.resolve();
    return call('DELETE', '/api/me/create-draft?id=' + encodeURIComponent(id)).then(function () {
      setRemovals(removalsOf().filter(function (x) { return x !== id; }));
    }, function (err) {
      /* not reached (offline, the server down): it is removed later, and listed nowhere meanwhile */
      if (!err.status || err.status >= 500) { var l = removalsOf(); if (l.indexOf(id) === -1) l.push(id); setRemovals(l); }
      throw err;
    });
  }
  function flushRemovals() {
    var l = removalsOf();
    return l.reduce(function (p, id) {
      return p.then(function () { return remove(id).then(null, function () {}); });
    }, Promise.resolve());
  }
  function blobBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new (win().FileReader)();
      reader.onload = function () { resolve(String(reader.result || '').replace(/^data:[^,]*,/, '')); };
      reader.onerror = function () { reject(reader.error || new Error('The picture could not be read.')); };
      reader.readAsDataURL(blob);
    });
  }
  function putFile(id, slot, blob, name) {
    return blobBase64(blob).then(function (b64) {
      return call('POST', '/api/me/create-draft/file', { id: id, slot: serverSlot(slot), fileName: String(name || 'picture').slice(0, 200), mimeType: blob.type || '', dataBase64: b64 });
    });
  }
  function getFile(id, slot) {
    return send('GET', '/api/me/create-draft/file?id=' + encodeURIComponent(id) + '&slot=' + encodeURIComponent(serverSlot(slot))).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw failure('The picture could not be read back (' + res.status + ').', res.status);
      return res.blob();
    });
  }
  function forgetLocal(storage, id) {
    var s = storageOf(storage);
    if (!s || !isId(id)) return;
    try {
      s.removeItem(LOCAL_PREFIX + id);
      if (s.getItem(CURRENT_KEY) === id) s.removeItem(CURRENT_KEY);
    } catch (e) { /* storage blocked: nothing kept there either */ }
  }
  function writerId(storage) {
    var s = storageOf(storage), id = '';
    try { id = (s && s.getItem(WRITER_KEY)) || ''; } catch (e) { id = ''; }
    if (/^[a-z0-9]{6,40}$/.test(id)) return id;
    id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { if (s) s.setItem(WRITER_KEY, id); } catch (e) { /* a page that cannot keep it marks this visit only */ }
    return id;
  }

  /* "5 Nov, 2:20 pm"; with the year when it is not this year's */
  function whenLabel(iso, now) {
    var t = new Date(iso);
    if (!iso || isNaN(t.getTime())) return '';
    var n = new Date(now == null ? Date.now() : now), h = t.getHours(), m = t.getMinutes();
    var clock = (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'am' : 'pm');
    return t.getDate() + ' ' + MONTHS[t.getMonth()] + (t.getFullYear() !== n.getFullYear() ? ' ' + t.getFullYear() : '') + ', ' + clock;
  }
  /* where Create Event will open it: the screen it was left on */
  function whereLabel(s) {
    if (s.phase === 'category') return 'Choosing the portal and type';
    if (s.phase === 'method') return 'Choosing how to build the site';
    if (s.method === 'brief') return 'Writing the brief';
    if (s.method === 'imported') return 'Details, on an imported design';
    return 'Details and content';
  }
  /* d: a list() row. opts.portalName(slug) gives a portal's name ('' when unknown); opts.now for the time */
  function describe(d, opts) {
    opts = opts || {};
    var s = (d && d.summary) || {};
    var portal = s.portal ? (typeof opts.portalName === 'function' ? String(opts.portalName(s.portal) || '') : '') || s.portal : '';
    return {
      name: s.name || 'Untitled event',
      type: TYPE_WORDS[s.category] || '',
      portal: portal || 'No portal yet',
      where: whereLabel(s),
      when: whenLabel(d && (d.savedAt || d.updatedAt), opts.now),
      eventId: s.eventId || ''
    };
  }

  return { LOCAL_PREFIX: LOCAL_PREFIX, CURRENT_KEY: CURRENT_KEY, isId: isId, list: list, get: get, put: put, remove: remove, flushRemovals: flushRemovals,
    putFile: putFile, getFile: getFile, forgetLocal: forgetLocal, writerId: writerId, describe: describe, whenLabel: whenLabel,
    serverSlot: serverSlot, localSlot: localSlot };
});
