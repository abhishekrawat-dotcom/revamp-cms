/* A copy of the site editor's work kept in this browser: an IndexedDB database ("revamp-editor", one object
   store, "sites"). Keys:
     site:<event id>:<template id>   the editor's page for an event:
       { eventId, templateId, savedAt, snapshot, sourceDraftId, fillVersion }   snapshot as made by
       canvas.snapshot() (editor-canvas.js); the record written when a Create Event hand-off is first filled in
       also carries handoff and event
     the keys Create Event writes for a draft's logo and banner picture: { name, dataUrl, savedAt }

   RevampStore.get(key)          -> Promise<value | undefined>
   RevampStore.put(key, value)   -> Promise
   RevampStore.remove(key)       -> Promise
   Every call rejects when the browser won't give the page IndexedDB (some private modes, blocked site data).
   Callers must handle that rejection: the page has to work without a local copy and say so. */
(function () {
  'use strict';

  var NAME = 'revamp-editor', STORE = 'sites', VERSION = 1;
  var opening = null;

  function open() {
    if (!opening) {
      opening = new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('IndexedDB is not available')); return; }
        var req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
        req.onsuccess = function () {
          var db = req.result;
          db.onversionchange = function () { db.close(); opening = null; };    // a newer copy of the editor wants to upgrade it
          resolve(db);
        };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error('IndexedDB is blocked by another tab')); };
      });
      opening.catch(function () { opening = null; });                          // try again next time
    }
    return opening;
  }

  function run(mode, work) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req = work(tx.objectStore(STORE));
        // A write is committed at once instead of when the browser gets round to it: left to itself the commit
        // waits for the request's reply, and a page that is being closed or reloaded never receives it — the
        // write made on the way out (the last thing typed) would be dropped.
        if (mode === 'readwrite' && tx.commit) tx.commit();
        tx.oncomplete = function () { resolve(req.result); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
      });
    });
  }

  window.RevampStore = {
    get: function (key) { return run('readonly', function (s) { return s.get(key); }); },
    put: function (key, value) { return run('readwrite', function (s) { return s.put(value, key); }); },
    remove: function (key) { return run('readwrite', function (s) { return s.delete(key); }); }
  };
})();
