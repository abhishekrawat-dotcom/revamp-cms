/* ===========================================================================
   ET Oneworld - Revamp CMS
   Real admin authentication — Firebase Auth (compat SDK, matches this repo's
   no-build-step / plain <script> tag convention everywhere else).

   Exposes one global: window.RevampAuth
     .signInWithEmail(email, password)   -> Promise<User>
     .signInWithGoogle()                 -> Promise<User>  (popup)
     .signOutUser()                      -> Promise<void>
     .getIdToken()                       -> Promise<string>  rejects if not signed in
     .currentUser()                      -> User|null, synchronous, best-effort (see note below)
     .onAuthChange(cb)                   -> cb(User|null), called immediately with current state and
                                             again on every future sign-in/out

   This is the ONLY thing the browser ever gets a real Firebase client config for — the apiKey below is
   not a secret (Firebase Auth is designed for public client use; it identifies the PROJECT, not a
   credential), and this SDK is never used to touch Firestore/Storage directly — see lib/firebase.js's
   header comment. Every /api/* admin write/read still goes through the Node backend, which independently
   verifies the ID token this file hands it (admin.auth().verifyIdToken()) — getIdToken() is the one thing
   every other page on this site that needs to call an admin endpoint should call, then send the result as
   `Authorization: Bearer <token>`.
   =========================================================================== */
(function () {
  'use strict';

  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyC596F06JSjuD5oMtNRFNSeQnF9OV0MEY0',
    authDomain: 'revamp-cms.firebaseapp.com',
    projectId: 'revamp-cms',
    storageBucket: 'revamp-cms.firebasestorage.app',
    messagingSenderId: '298413755047',
    appId: '1:298413755047:web:8127463d80b059eb70e982'
  };

  var SDK_VERSION = '10.14.1';
  var listeners = [];
  var lastUser = null;
  var readyPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  // Lazily loads the compat SDK scripts (two small files) the first time anything here is actually
  // called — pages that never touch auth (most of the real microsite content pages) never pay for it.
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = loadScript('https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-app-compat.js')
      .then(function () { return loadScript('https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-auth-compat.js'); })
      .then(function () {
        if (!window.firebase.apps || !window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
        window.firebase.auth().onAuthStateChanged(function (user) {
          lastUser = user;
          listeners.forEach(function (cb) { try { cb(user); } catch (e) { /* a listener's own bug shouldn't break the others */ } });
        });
        return window.firebase;
      });
    return readyPromise;
  }

  function signInWithEmail(email, password) {
    return ready().then(function (firebase) {
      return firebase.auth().signInWithEmailAndPassword(email, password).then(function (cred) { return cred.user; });
    });
  }

  function signInWithGoogle() {
    return ready().then(function (firebase) {
      var provider = new firebase.auth.GoogleAuthProvider();
      return firebase.auth().signInWithPopup(provider).then(function (cred) { return cred.user; });
    });
  }

  function signOutUser() {
    return ready().then(function (firebase) { return firebase.auth().signOut(); });
  }

  function getIdToken() {
    return ready().then(function (firebase) {
      var user = firebase.auth().currentUser;
      if (!user) return Promise.reject(new Error('Not signed in.'));
      return user.getIdToken(/* forceRefresh */ false);
    });
  }

  // Synchronous best-effort read — null until the SDK has actually loaded and fired its first
  // onAuthStateChanged callback (unavoidable with Firebase Auth's own async init). A caller that needs to
  // know definitively should use onAuthChange() instead of polling this.
  function currentUserSync() { return lastUser; }

  function onAuthChange(cb) {
    listeners.push(cb);
    ready().then(function () { cb(lastUser); });
    return function unsubscribe() {
      var i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  window.RevampAuth = {
    signInWithEmail: signInWithEmail,
    signInWithGoogle: signInWithGoogle,
    signOutUser: signOutUser,
    getIdToken: getIdToken,
    currentUser: currentUserSync,
    onAuthChange: onAuthChange
  };
})();
