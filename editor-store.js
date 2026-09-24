/* Where the site editor keeps work between visits: an IndexedDB database in this browser ("revamp-editor", one
   object store, "sites"). Keys:
     site:<event id>:<template id>   the editor's page for an event (a new one from Create Event is new-<slug>):
       { eventId, templateId, savedAt, snapshot, handoff, event }   snapshot as made by canvas.snapshot()
       (editor-canvas.js); handoff = the Create Event hand-off it was filled from; event = that draft's name/slug/…
     create:logo                     the logo uploaded in Create Event step 1: { name, dataUrl, savedAt }
   Nothing leaves the browser; publishing is what puts a site anywhere else.

   RevampStore.get(key)          -> Promise<value | undefined>
   RevampStore.put(key, value)   -> Promise
   RevampStore.remove(key)       -> Promise
   Every call rejects when the browser won't give the page IndexedDB (some private modes); the editor then carries
   on and says it can't save. */
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
