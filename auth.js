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
     .ensureSession()                    -> Promise<void>  writes the __session cookie for the current user;
                                             call before navigating to another CMS page right after sign-in
     .isAllowedEmail(email)              -> boolean  — a @timesinternet.in address (ALLOWED_DOMAIN)

   Access: only Google accounts on ALLOWED_DOMAIN may use the CMS. The server enforces it
   (functions/lib/access.js — every CMS page and /api/* route checks the __session cookie, or the Bearer
   header, against the same rule); this file only mirrors it so a wrong account is told at once and signed
   out. The __session cookie is the user's current ID token, rewritten whenever Firebase refreshes it.

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
  var ALLOWED_DOMAIN = 'timesinternet.in';   // keep in step with functions/lib/access.js
  var SESSION_COOKIE = '__session';
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
        // keeps the cookie the server checks equal to the current ID token (Firebase refreshes it hourly)
        window.firebase.auth().onIdTokenChanged(function (user) {
          if (!user) return clearSessionCookie();
          user.getIdToken().then(setSessionCookie, function () {});
        });
        window.firebase.auth().onAuthStateChanged(function (user) {
          // a remembered sign-in from an account that isn't allowed (e.g. a personal Gmail used before the
          // domain rule existed) is signed out; listeners then hear null, never the wrong user
          if (user && !isAllowedEmail(user.email)) { window.firebase.auth().signOut(); return; }
          lastUser = user;
          listeners.forEach(function (cb) { try { cb(user); } catch (e) { /* a listener's own bug shouldn't break the others */ } });
        });
        return window.firebase;
      });
    return readyPromise;
  }

  function isAllowedEmail(email) {
    return typeof email === 'string' && email.toLowerCase().slice(-(ALLOWED_DOMAIN.length + 1)) === '@' + ALLOWED_DOMAIN;
  }

  function setSessionCookie(token) {
    document.cookie = SESSION_COOKIE + '=' + encodeURIComponent(token) + '; Path=/; Max-Age=3600; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  }
  function clearSessionCookie() {
    document.cookie = SESSION_COOKIE + '=; Path=/; Max-Age=0; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }

  function ensureSession() {
    return getIdToken().then(setSessionCookie);
  }

  function signInWithEmail(email, password) {
    return ready().then(function (firebase) {
      return firebase.auth().signInWithEmailAndPassword(email, password).then(function (cred) { return cred.user; });
    });
  }

  function signInWithGoogle() {
    return ready().then(function (firebase) {
      var provider = new firebase.auth.GoogleAuthProvider();
      // hd: Google's picker offers company accounts first; it's only a hint, so the check below (and the
      // server's) is what actually decides
      provider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: 'select_account' });
      return firebase.auth().signInWithPopup(provider).then(function (cred) {
        if (isAllowedEmail(cred.user.email)) return cred.user;
        return firebase.auth().signOut().then(function () {
          var err = new Error('Use your @' + ALLOWED_DOMAIN + ' Google account — ' + cred.user.email + ' can’t sign in to Revamp.');
          err.code = 'revamp/domain-not-allowed';
          throw err;
        });
      });
    });
  }

  function signOutUser() {
    clearSessionCookie();
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
    onAuthChange: onAuthChange,
    ensureSession: ensureSession,
    isAllowedEmail: isAllowedEmail,
    allowedDomain: ALLOWED_DOMAIN
  };

  // start at once on every page that includes this file, so the __session cookie keeps being refreshed while
  // a CMS page is open (otherwise the server would bounce the next page load to sign-in after an hour)
  ready().catch(function () {});
})();
