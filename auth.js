/* ===========================================================================
   ET Oneworld - Revamp CMS
   Real admin authentication — Firebase Auth (compat SDK, matches this repo's
   no-build-step / plain <script> tag convention everywhere else).

   Exposes one global: window.RevampAuth
     .authedFetch(url, opts)             -> Promise<Response>  THE way a page calls /api/*: sends a fresh
                                             `Authorization: Bearer` token, keeps the __session cookie in
                                             step, retries once on 401 with a forced token refresh and, on a
                                             second 401, sends the user to sign-in. Same-origin URLs only.
                                             Rejects with { status: 401, code: 'revamp/signed-out' } when
                                             nobody is signed in.
     .signInWithGoogle()                 -> Promise<User>  (popup)
     .signOutUser()                      -> Promise<void>  signs out and stays on the page
     .signOutAndLeave()                  -> Promise<void>  signs out, then goes to the sign-in page
     .redirectToSignIn()                 -> void  goes to /?next=<this page>; the sign-in page returns here
     .recentlySentToSignIn()             -> boolean  true for a few seconds after redirectToSignIn() ran in
                                             this tab — the sign-in page must not forward straight back then
     .getIdToken(force)                  -> Promise<string>  waits for Firebase's real first auth-state
                                             answer, then rejects if not signed in; force = true asks
                                             Firebase for a brand-new token
     .whenResolved()                     -> Promise<void>  settles once Firebase has reported whether
                                             anyone is signed in (see authResolvedPromise below)
     .currentUser()                      -> User|null, synchronous, best-effort (see note below)
     .onAuthChange(cb)                   -> cb(User|null), called once Firebase has answered and again on
                                             every future sign-in/out; returns an unsubscribe function
     .ensureSession()                    -> Promise<void>  writes the __session cookie for the current user;
                                             call before navigating to another CMS page right after sign-in
     .mountAccountMenu(el)               -> void  renders the signed-in user's avatar and a menu with Sign
                                             out into el. Any element marked [data-rv-account] gets one
                                             automatically when the page loads.
     .isAllowedEmail(email)              -> boolean  — a @timesinternet.in address (ALLOWED_DOMAIN)

   Access: only Google accounts on ALLOWED_DOMAIN may use the CMS. The server enforces it
   (functions/lib/access.js — every CMS page and /api/* route checks the __session cookie, or the Bearer
   header, against the same rule); this file only mirrors it so a wrong account is told at once and signed
   out. The __session cookie is the user's current ID token: it is rewritten whenever a token is issued,
   expires when the token does, and the token is renewed a few minutes before that while a page is open.

   On every page except the sign-in page this file also covers the page with a "You have been signed out"
   dialog when the session ends underneath it (sign-out in another tab, a revoked account), so no page is
   left showing data to nobody or failing every call with no way back.

   This is the ONLY thing the browser ever gets a real Firebase client config for — the apiKey below is
   not a secret (Firebase Auth is designed for public client use; it identifies the PROJECT, not a
   credential), and this SDK is never used to touch Firestore/Storage directly — see lib/firebase.js's
   header comment. Every /api/* admin write/read still goes through the Node backend, which independently
   verifies the ID token this file hands it (admin.auth().verifyIdToken()).
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

  // How long to wait for Firebase's own first onAuthStateChanged before giving up and treating
  // auth as resolved anyway — bounds the worst case (a stuck or blocked persistence lookup) instead
  // of letting a caller hang forever. Counted from the moment the SDK has loaded.
  var AUTH_RESOLVE_TIMEOUT_MS = 8000;

  /* Settles once Firebase has reported the REAL signed-in state at least once — its first
     onAuthStateChanged callback, which only fires after the SDK finishes restoring any persisted
     session (an async IndexedDB lookup). ready() resolving only means the SDK script has loaded
     and initializeApp() has run; it says nothing about whether that restoration has finished, so
     firebase.auth().currentUser can still read null for a signed-in user for a brief window right
     after ready() resolves. Everything that needs a trustworthy "is anyone signed in" answer waits
     on this instead of reading currentUser synchronously.
     The promise exists from the start, so the answer is recorded even when nobody was waiting for it
     yet; it is resolved only by that first callback or by the safety timer, never earlier. */
  var authResolved = false;
  var resolveAuthResolved = null;
  var authResolvedPromise = new Promise(function (resolve) { resolveAuthResolved = resolve; });
  function markAuthResolved() {
    if (authResolved) return;
    authResolved = true;
    resolveAuthResolved();
  }
  function whenResolved() {
    return ready().then(function () { return authResolvedPromise; });
  }

  // A token is renewed this long before it expires, so the cookie the server checks never lapses while
  // a page is open; and never more often than once a minute, whatever the clocks say.
  var REFRESH_LEAD_S = 300;
  var REFRESH_MIN_WAIT_MS = 60000;
  var lastToken = null;
  var refreshTimer = null;
  var refreshing = null;

  // Set once a user has been signed in on this page: losing that user later is "signed out underneath
  // the page" (cover it), as opposed to a page that never had anyone (send it to sign-in).
  var hadUser = false;
  // A sign-out the user asked for on this page — nothing should be shown about it.
  var leaving = false;
  var redirecting = false;
  var BOUNCE_KEY = 'rv.auth.sentToSignIn';
  var BOUNCE_WINDOW_MS = 10000;

  function noop() {}

  function onSignInPage() {
    return location.pathname === '/' || location.pathname === '/index.html';
  }

  // loaded(): true when what this script defines is already there, so a retry after a half-failed load
  // does not run the first script twice
  function loadScript(src, loaded) {
    return new Promise(function (resolve, reject) {
      if (loaded()) return resolve();
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () {
        // a failed <script> element is never requested again; remove it so the next attempt really retries
        if (s.parentNode) s.parentNode.removeChild(s);
        reject(new Error('Could not load ' + src));
      };
      document.head.appendChild(s);
    });
  }

  // Loads the compat SDK scripts (two small files) once. A failed load is not remembered: the next
  // caller tries again, so sign-in recovers when the network does, without a page reload.
  function ready() {
    if (readyPromise) return readyPromise;
    var base = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
    readyPromise = loadScript(base + 'firebase-app-compat.js', function () { return !!(window.firebase && window.firebase.initializeApp); })
      .then(function () {
        return loadScript(base + 'firebase-auth-compat.js', function () { return !!(window.firebase && typeof window.firebase.auth === 'function'); });
      })
      .then(function () {
        if (!window.firebase.apps || !window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
        setTimeout(markAuthResolved, AUTH_RESOLVE_TIMEOUT_MS);
        // keeps the cookie the server checks equal to the current ID token
        window.firebase.auth().onIdTokenChanged(function (user) {
          if (!user) return forgetToken();
          user.getIdToken().then(noteToken, noop);
        });
        window.firebase.auth().onAuthStateChanged(function (user) {
          // first real callback ever (whatever it reports) means persistence restore is done
          markAuthResolved();
          // a remembered sign-in from an account that isn't allowed (e.g. a personal Gmail used before the
          // domain rule existed) is signed out; listeners then hear null, never the wrong user
          if (user && !isAllowedEmail(user.email)) { window.firebase.auth().signOut(); return; }
          lastUser = user;
          if (user) {
            hadUser = true;
            leaving = false;
            hideSignedOutOverlay();
          } else if (hadUser) {
            handleSignedOut();
          }
          listeners.slice().forEach(function (cb) { try { cb(user); } catch (e) { /* a listener's own bug shouldn't break the others */ } });
        });
        return window.firebase;
      })
      .catch(function () {
        readyPromise = null;
        var err = new Error('Could not load sign-in. Check your connection and try again.');
        err.code = 'revamp/sdk-load-failed';
        throw err;
      });
    return readyPromise;
  }

  function isAllowedEmail(email) {
    return typeof email === 'string' && email.toLowerCase().slice(-(ALLOWED_DOMAIN.length + 1)) === '@' + ALLOWED_DOMAIN;
  }

  /* ---------------------------------------------------------------- token and session cookie */

  // the token's expiry time (seconds since 1970) read from its payload, or null if it cannot be read
  function decodeExp(token) {
    try {
      var part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (part.length % 4) part += '=';
      var exp = JSON.parse(atob(part)).exp;
      return typeof exp === 'number' && isFinite(exp) ? exp : null;
    } catch (e) {
      return null;
    }
  }

  function expiresWithin(token, seconds) {
    var exp = decodeExp(token);
    return exp !== null && exp - Date.now() / 1000 < seconds;
  }

  // the cookie lives exactly as long as the token in it, so the two can never drift apart
  function setSessionCookie(token) {
    var exp = decodeExp(token);
    var maxAge = exp === null ? 3600 : Math.max(60, Math.floor(exp - Date.now() / 1000));
    document.cookie = SESSION_COOKIE + '=' + encodeURIComponent(token) + '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  }
  function clearSessionCookie() {
    document.cookie = SESSION_COOKIE + '=; Path=/; Max-Age=0; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  function hasSessionCookie() {
    return new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=[^;]+').test(document.cookie);
  }

  function activeUser() {
    return (window.firebase && typeof window.firebase.auth === 'function' && window.firebase.auth().currentUser) || null;
  }

  // every token this file obtains passes through here: cookie rewritten, next renewal scheduled
  function noteToken(token) {
    if (!activeUser()) return token;   // a token that arrives after sign-out must not bring the cookie back
    lastToken = token;
    setSessionCookie(token);
    armRefresh(token);
    return token;
  }

  function forgetToken() {
    lastToken = null;
    clearTimeout(refreshTimer);
    refreshTimer = null;
    clearSessionCookie();
  }

  // one timer at a time; a forced refresh issues a token, which comes back through noteToken() and re-arms it
  function armRefresh(token) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    var exp = decodeExp(token);
    if (exp === null) return;
    var wait = (exp - REFRESH_LEAD_S) * 1000 - Date.now();
    refreshTimer = setTimeout(refreshToken, Math.max(wait, REFRESH_MIN_WAIT_MS));
  }

  function refreshToken() {
    if (refreshing) return refreshing;
    var user = activeUser();
    if (!user) return Promise.resolve();
    refreshing = user.getIdToken(true).then(noteToken, function () {
      // offline, most likely: keep trying while someone is signed in
      clearTimeout(refreshTimer);
      refreshTimer = activeUser() ? setTimeout(refreshToken, REFRESH_MIN_WAIT_MS) : null;
    }).then(function () { refreshing = null; });
    return refreshing;
  }

  // timers are throttled or frozen in a background tab, so catch up the moment the page is looked at again
  function refreshIfDue() {
    if (lastToken && expiresWithin(lastToken, REFRESH_LEAD_S)) refreshToken();
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshIfDue(); });
  window.addEventListener('focus', refreshIfDue);

  function freshToken(user, force) {
    return user.getIdToken(!!force).then(function (token) {
      if (!force && expiresWithin(token, REFRESH_LEAD_S)) return user.getIdToken(true);
      return token;
    }).then(noteToken);
  }

  function signedOutError() {
    var err = new Error('You are signed out. Sign in again to continue.');
    err.status = 401;
    err.code = 'revamp/signed-out';
    return err;
  }

  function getIdToken(force) {
    return whenResolved().then(function () {
      // only now is currentUser trustworthy — see authResolvedPromise above. On a fresh page load (every
      // page here is a full navigation, not an SPA) reading it earlier would tell a genuinely signed-in
      // user they are signed out whenever persistence restore just hadn't finished yet.
      var user = activeUser();
      if (!user) return Promise.reject(signedOutError());
      return freshToken(user, force === true);
    });
  }

  function ensureSession() {
    return getIdToken().then(noop);
  }

  /* ---------------------------------------------------------------- the one authenticated fetch */

  function withAuth(opts, token) {
    var out = {}, k;
    for (k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) out[k] = opts[k];
    var headers = new Headers(out.headers || {});
    headers.set('Authorization', 'Bearer ' + token);
    // only a string body is assumed to be JSON; FormData and files must keep the type the browser gives them
    if (typeof out.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    out.headers = headers;
    if (!out.credentials) out.credentials = 'same-origin';
    return out;
  }

  // a token could not be obtained for a user Firebase still lists
  function tokenFailure(err) {
    if (err && err.code === 'auth/network-request-failed') {
      var offline = new Error('Could not reach the sign-in service. Check your connection and try again.');
      offline.status = 0;
      offline.code = err.code;
      return offline;
    }
    // anything else means the account's session is over (revoked, disabled, deleted)
    handleSignedOut();
    return signedOutError();
  }

  function authedFetch(url, opts) {
    var target = null;
    try { target = new URL(String(url), location.href); } catch (e) { /* not a URL at all */ }
    // the token is this site's credential: it never goes to another origin
    if (!target || target.origin !== location.origin) {
      return Promise.reject(new Error('RevampAuth.authedFetch only calls this site; refused "' + url + '".'));
    }
    return whenResolved().then(function () {
      var user = activeUser();
      if (!user) {
        handleSignedOut();
        throw signedOutError();
      }
      return freshToken(user, false).then(function (token) {
        return fetch(target.href, withAuth(opts, token));
      }, function (err) {
        throw tokenFailure(err);
      }).then(function (res) {
        if (res.status !== 401) return res;
        // the server refused a token Firebase considered good: get a brand-new one and try once more
        return freshToken(user, true).then(function (token) {
          return fetch(target.href, withAuth(opts, token));
        }, function (err) {
          throw tokenFailure(err);
        }).then(function (again) {
          if (again.status !== 401) return again;
          redirectToSignIn();
          throw signedOutError();
        });
      });
    });
  }

  /* ---------------------------------------------------------------- signing in and out */

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
    leaving = true;
    forgetToken();
    return ready().then(function (firebase) { return firebase.auth().signOut(); });
  }

  // leaves even when Firebase cannot be reached: the sign-in page signs out again on ?signout=1
  function signOutAndLeave() {
    return signOutUser().catch(noop).then(function () { location.assign('/?signout=1'); });
  }

  function signInAddress() {
    return '/?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
  }

  function redirectToSignIn() {
    if (redirecting || onSignInPage()) return;
    redirecting = true;
    try { sessionStorage.setItem(BOUNCE_KEY, String(Date.now())); } catch (e) { /* storage blocked: no loop guard, still redirect */ }
    location.assign(signInAddress());
  }

  function recentlySentToSignIn() {
    try {
      var at = Number(sessionStorage.getItem(BOUNCE_KEY));
      return at > 0 && Date.now() - at < BOUNCE_WINDOW_MS;
    } catch (e) {
      return false;
    }
  }

  // Nobody is signed in on a page that needs someone.
  function handleSignedOut() {
    if (leaving || onSignInPage()) return;
    if (hadUser) showSignedOutOverlay(); else redirectToSignIn();
  }

  // Synchronous best-effort read — null until the SDK has actually loaded and fired its first
  // onAuthStateChanged callback (unavoidable with Firebase Auth's own async init). A caller that needs to
  // know definitively should use onAuthChange() instead of polling this.
  function currentUserSync() { return lastUser; }

  // cb joins the listeners only after Firebase's first answer has been delivered to it, so it never hears
  // a "nobody" that only means "not restored yet", and never hears the first answer twice
  function onAuthChange(cb) {
    var live = true;
    whenResolved().then(function () {
      if (!live) return;
      listeners.push(cb);
      cb(lastUser);
    }, noop);
    return function unsubscribe() {
      live = false;
      var i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  /* ---------------------------------------------------------------- shared UI: styles */

  // Scoped to rv-acct- / rv-auth- classes so no page is restyled. Colours come from the page's own theme
  // variables; the fallbacks are for a page that defines none.
  function injectStyles() {
    if (document.getElementById('rv-auth-styles')) return;
    var vars = '--rv-surface:var(--surface,#FFFFFF);--rv-surface-2:var(--surface-2,#F1F0EC);--rv-bg:var(--bg,#F7F7F4);' +
      '--rv-border:var(--border,#E6E4DE);--rv-text:var(--text,#1D1B17);--rv-muted:var(--text-muted,#6C6A60);' +
      '--rv-accent:var(--accent,#FF0035);--rv-on-accent:var(--accent-contrast,#FFFFFF);--rv-crit:var(--crit,#C13333);';
    var darkVars = '--rv-surface:var(--surface,#1B1A16);--rv-surface-2:var(--surface-2,#232219);--rv-bg:var(--bg,#141310);' +
      '--rv-border:var(--border,#332F24);--rv-text:var(--text,#EFEBDF);--rv-muted:var(--text-muted,#A6A192);' +
      '--rv-accent:var(--accent,#FF4D6D);--rv-on-accent:var(--accent-contrast,#1B0508);--rv-crit:var(--crit,#E27A7A);';
    var font = 'font-family:var(--font-body,Inter,"Segoe UI",system-ui,-apple-system,sans-serif);';
    var css = [
      '.rv-acct,.rv-acct-pop,.rv-auth-overlay{' + vars + '}',
      '[data-theme="dark"] .rv-acct,[data-theme="dark"] .rv-acct-pop,[data-theme="dark"] .rv-auth-overlay{' + darkVars + '}',
      '.rv-acct{display:inline-flex;align-items:center;vertical-align:middle;}',
      '.rv-acct-btn{-webkit-appearance:none;appearance:none;box-sizing:border-box;width:34px;height:34px;min-width:34px;padding:0;margin:0;' +
        'border:1px solid var(--rv-border);border-radius:50%;background:var(--rv-surface-2);color:var(--rv-text);' + font +
        'font-size:12px;font-weight:600;line-height:1;letter-spacing:.02em;display:inline-flex;align-items:center;justify-content:center;' +
        'overflow:hidden;cursor:pointer;}',
      '.rv-acct-btn:disabled{cursor:default;color:var(--rv-muted);}',
      '.rv-acct-btn:focus-visible,.rv-acct-item:focus-visible,.rv-auth-btn:focus-visible,.rv-auth-link:focus-visible{outline:2px solid var(--rv-accent);outline-offset:2px;}',
      '.rv-acct-btn img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.rv-acct-btn svg{width:18px;height:18px;display:block;}',
      '.rv-acct-pop{position:fixed;z-index:2147483000;box-sizing:border-box;width:260px;max-width:calc(100vw - 16px);padding:6px;' +
        'background:var(--rv-surface);color:var(--rv-text);border:1px solid var(--rv-border);border-radius:12px;' +
        'box-shadow:0 14px 32px -14px rgba(0,0,0,.35);' + font + 'font-size:13px;line-height:1.4;text-align:left;}',
      '.rv-acct-who{padding:8px 10px 10px;border-bottom:1px solid var(--rv-border);margin-bottom:6px;}',
      '.rv-acct-name{font-weight:600;overflow-wrap:anywhere;}',
      '.rv-acct-email{color:var(--rv-muted);font-size:12px;overflow-wrap:anywhere;}',
      '.rv-acct-item{-webkit-appearance:none;appearance:none;box-sizing:border-box;display:block;width:100%;margin:0;padding:9px 10px;border:0;border-radius:8px;' +
        'background:transparent;color:var(--rv-text);' + font + 'font-size:13px;font-weight:500;line-height:1.3;text-align:left;cursor:pointer;}',
      '.rv-acct-item:hover:not(:disabled){background:var(--rv-surface-2);}',
      '.rv-acct-item:disabled{cursor:default;color:var(--rv-muted);}',
      '.rv-auth-overlay{position:fixed;inset:0;z-index:2147483647;box-sizing:border-box;width:100vw;height:100vh;max-width:none;max-height:none;' +
        'margin:0;padding:16px;border:0;background:var(--rv-bg);color:var(--rv-text);' + font + 'align-items:center;justify-content:center;overflow:auto;}',
      '.rv-auth-overlay[open]{display:flex;}',
      '.rv-auth-overlay::backdrop{background:var(--rv-bg);}',
      '.rv-auth-card{box-sizing:border-box;width:100%;max-width:400px;padding:28px;background:var(--rv-surface);border:1px solid var(--rv-border);' +
        'border-radius:16px;box-shadow:0 14px 32px -14px rgba(0,0,0,.25);text-align:center;}',
      '.rv-auth-title{margin:0 0 8px;font-size:19px;font-weight:650;line-height:1.3;color:var(--rv-text);}',
      '.rv-auth-text{margin:0 0 20px;font-size:14px;line-height:1.5;color:var(--rv-muted);}',
      '.rv-auth-error{margin:0 0 16px;font-size:13px;line-height:1.45;color:var(--rv-crit);}',
      '.rv-auth-error:empty{display:none;}',
      '.rv-auth-btn{-webkit-appearance:none;appearance:none;box-sizing:border-box;display:block;width:100%;margin:0;padding:11px 16px;border:0;border-radius:10px;' +
        'background:var(--rv-accent);color:var(--rv-on-accent);' + font + 'font-size:14px;font-weight:600;line-height:1.3;cursor:pointer;}',
      '.rv-auth-btn:disabled{opacity:.6;cursor:default;}',
      '.rv-auth-link{-webkit-appearance:none;appearance:none;display:inline-block;margin:14px 0 0;padding:4px 6px;border:0;background:transparent;' +
        'color:var(--rv-muted);' + font + 'font-size:13px;line-height:1.3;text-decoration:underline;cursor:pointer;}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'rv-auth-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------------- shared UI: "You have been signed out" */

  var overlay = null;

  function signInFailureText(err) {
    var code = err && err.code;
    if (code === 'revamp/domain-not-allowed' || code === 'revamp/sdk-load-failed') return err.message;
    if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.';
    if (code === 'auth/network-request-failed') return 'Could not reach Google. Check your connection and try again.';
    return 'Sign-in did not complete. Try again.';
  }

  /* A modal <dialog>: the browser itself makes everything else on the page inert and paints this above
     every other layer (the site editor's canvas and its iframes included), and the page underneath is left
     exactly as it was so signing in again loses nothing the user had typed. It is fully opaque: whoever is
     at the screen now is not known to be allowed to read what is behind it. */
  function showSignedOutOverlay() {
    if (overlay || leaving || onSignInPage()) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', showSignedOutOverlay); return; }
    injectStyles();
    overlay = document.createElement('dialog');
    overlay.className = 'rv-auth-overlay';
    overlay.setAttribute('aria-labelledby', 'rv-auth-title');
    overlay.setAttribute('aria-describedby', 'rv-auth-text');
    overlay.innerHTML =
      '<div class="rv-auth-card">' +
        '<h2 class="rv-auth-title" id="rv-auth-title">You have been signed out</h2>' +
        '<p class="rv-auth-text" id="rv-auth-text">This page is still open underneath, with anything you had typed. Sign in again to carry on.</p>' +
        '<p class="rv-auth-error" role="alert"></p>' +
        '<button type="button" class="rv-auth-btn">Sign in again</button>' +
        '<button type="button" class="rv-auth-link">Go to the sign-in page</button>' +
      '</div>';
    var btn = overlay.querySelector('.rv-auth-btn');
    var errorBox = overlay.querySelector('.rv-auth-error');
    btn.addEventListener('click', function () {
      errorBox.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      // success needs nothing here: the auth-state callback removes the dialog for any signed-in user
      signInWithGoogle().catch(function (err) {
        if (!overlay) return;
        btn.disabled = false;
        btn.textContent = 'Sign in again';
        if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
        errorBox.textContent = signInFailureText(err);
      });
    });
    overlay.querySelector('.rv-auth-link').addEventListener('click', redirectToSignIn);
    // Esc must not dismiss it
    overlay.addEventListener('cancel', function (e) { e.preventDefault(); });
    document.body.appendChild(overlay);
    if (typeof overlay.showModal === 'function') overlay.showModal(); else overlay.setAttribute('open', '');
    btn.focus();
  }

  function hideSignedOutOverlay() {
    if (!overlay) return;
    var el = overlay;
    overlay = null;
    if (typeof el.close === 'function' && el.open) el.close();
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  /* Back to a page the browser kept in memory (back/forward cache): no request is made, so the server's
     gate never sees it. Without a session cookie the page is hidden before it can paint and replaced by
     sign-in; with one, the signed-in state is checked again. */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted || onSignInPage()) return;
    // flags from before the page was frozen describe a navigation that is over
    leaving = false;
    redirecting = false;
    if (!hasSessionCookie()) {
      document.documentElement.style.visibility = 'hidden';
      location.replace(signInAddress());
      return;
    }
    whenResolved().then(function () { if (!activeUser()) handleSignedOut(); }, noop);
  });

  /* ---------------------------------------------------------------- shared UI: account menu */

  var PERSON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';

  // "Asha Rao" -> AR; no display name -> from the email's local part ("asha.rao@…" -> AR, "asha@…" -> AS)
  function initialsOf(user) {
    var name = String(user.displayName || '').trim();
    var parts = name ? name.split(/\s+/) : String(user.email || '').split('@')[0].split(/[._\-+]+/);
    parts = parts.filter(function (p) { return /[A-Za-z0-9À-￿]/.test(p); });
    if (!parts.length) return '';
    var text = parts.length > 1 ? parts[0].charAt(0) + parts[parts.length - 1].charAt(0) : parts[0].slice(0, 2);
    return text.toUpperCase();
  }

  function mountAccountMenu(el) {
    if (!el || el.getAttribute('data-rv-account-mounted') === '1') return;
    el.setAttribute('data-rv-account-mounted', '1');
    injectStyles();
    el.classList.add('rv-acct');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rv-acct-btn';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Account');
    el.textContent = '';
    el.appendChild(btn);

    var user = null;
    var pop = null;

    // nobody known (yet): a neutral figure, never somebody's identity
    function paint() {
      btn.textContent = '';
      btn.disabled = !user;
      btn.title = user ? (user.displayName || user.email || 'Account') : '';
      if (!user) { btn.innerHTML = PERSON_ICON; return; }
      var initials = initialsOf(user);
      function showInitials() {
        btn.textContent = '';
        if (initials) btn.textContent = initials; else btn.innerHTML = PERSON_ICON;
      }
      if (!user.photoURL) return showInitials();
      var img = document.createElement('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = showInitials;
      img.src = user.photoURL;
      btn.appendChild(img);
    }

    // below the avatar, right edges aligned, kept inside the window on every side
    function place() {
      var r = btn.getBoundingClientRect();
      var w = pop.offsetWidth, h = pop.offsetHeight, gap = 8;
      var left = Math.min(Math.max(r.right - w, gap), Math.max(gap, window.innerWidth - w - gap));
      var top = r.bottom + 6;
      if (top + h > window.innerHeight - gap && r.top - 6 - h >= gap) top = r.top - 6 - h;
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    }

    function onDocPointer(e) {
      if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(false);
    }
    function onDocKey(e) {
      if (e.key === 'Escape' && pop) { e.stopPropagation(); close(true); }
    }
    function onResize() { close(false); }
    function onScroll() { if (pop) place(); }

    function open() {
      if (pop || !user) return;
      pop = document.createElement('div');
      pop.className = 'rv-acct-pop';
      pop.setAttribute('role', 'menu');
      pop.setAttribute('aria-label', 'Account');
      var who = document.createElement('div');
      who.className = 'rv-acct-who';
      who.setAttribute('role', 'presentation');
      if (user.displayName) {
        var nameEl = document.createElement('div');
        nameEl.className = 'rv-acct-name';
        nameEl.textContent = user.displayName;
        who.appendChild(nameEl);
      }
      var emailEl = document.createElement('div');
      emailEl.className = user.displayName ? 'rv-acct-email' : 'rv-acct-name';
      emailEl.textContent = user.email || '';
      who.appendChild(emailEl);
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'rv-acct-item';
      item.setAttribute('role', 'menuitem');
      item.textContent = 'Sign out';
      item.addEventListener('click', function () {
        item.disabled = true;
        item.textContent = 'Signing out…';
        signOutAndLeave();
      });
      pop.appendChild(who);
      pop.appendChild(item);
      // leaving the menu with Tab closes it rather than stranding it open behind the focus
      pop.addEventListener('focusout', function (e) {
        if (pop && e.relatedTarget && !pop.contains(e.relatedTarget) && e.relatedTarget !== btn) close(false);
      });
      document.body.appendChild(pop);
      place();
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onDocPointer, true);
      document.addEventListener('keydown', onDocKey, true);
      window.addEventListener('resize', onResize);
      window.addEventListener('scroll', onScroll, true);
      item.focus();
    }

    function close(returnFocus) {
      if (!pop) return;
      var el2 = pop;
      pop = null;
      if (el2.parentNode) el2.parentNode.removeChild(el2);
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onDocKey, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      if (returnFocus) btn.focus();
    }

    btn.addEventListener('click', function () { if (pop) close(true); else open(); });
    // a page restored from the back/forward cache must not come back with the menu mid sign-out
    window.addEventListener('pageshow', function (e) { if (e.persisted) close(false); });

    paint();
    onAuthChange(function (u) {
      user = u;
      if (!u) close(false);
      paint();
    });
  }

  function mountAccountMenus() {
    var marks = document.querySelectorAll('[data-rv-account]');
    for (var i = 0; i < marks.length; i++) mountAccountMenu(marks[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAccountMenus);
  else mountAccountMenus();

  window.RevampAuth = {
    authedFetch: authedFetch,
    signInWithGoogle: signInWithGoogle,
    signOutUser: signOutUser,
    signOutAndLeave: signOutAndLeave,
    redirectToSignIn: redirectToSignIn,
    recentlySentToSignIn: recentlySentToSignIn,
    getIdToken: getIdToken,
    whenResolved: whenResolved,
    currentUser: currentUserSync,
    onAuthChange: onAuthChange,
    ensureSession: ensureSession,
    mountAccountMenu: mountAccountMenu,
    isAllowedEmail: isAllowedEmail,
    allowedDomain: ALLOWED_DOMAIN
  };

  // start at once on every page that includes this file, so the __session cookie keeps being refreshed while
  // a CMS page is open (otherwise the server would bounce the next page load to sign-in after an hour)
  ready().catch(noop);

  /* Every "back to events"/"save and exit"-style link in the app is a plain <a class="back-btn" href="…">
     — a real page navigation the browser follows immediately, with no chance for anything here to run
     first. If the __session cookie happened to be stale at that exact moment, the server's own sign-in gate
     (functions/lib/access.js) would bounce an actually-signed-in user to the login page instead of where
     they meant to go. This intercepts exactly those links — not every link on the page, only ones already
     marked with this one shared class — refreshes the cookie first, then completes the same navigation.
     The refresh gets a second and a half at most: a slow or stuck token call must never hold a navigation.
     A user who isn't really signed in still correctly lands on login either way (ensureSession() rejects,
     the navigation still happens, and the server's gate makes the real call from there). */
  var BACK_LINK_WAIT_MS = 1500;
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a.back-btn[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== '' && a.target !== '_self') return;
    e.preventDefault();
    var href = a.getAttribute('href');
    var gone = false;
    function go() {
      if (gone) return;
      gone = true;
      location.href = href;
    }
    ensureSession().then(go, go);
    setTimeout(go, BACK_LINK_WAIT_MS);
  });
})();
