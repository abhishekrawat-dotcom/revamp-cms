/* Revamp CMS — Dark Mode Toggle
   Reads / writes localStorage('revamp-theme').
   Sets data-theme="dark"|"light" on <html>.
   Call window.RevampTheme.mount(container) to inject the button programmatically,
   or add data-theme-toggle-target to any element for auto-mount. */
(function (global) {
  'use strict';

  var STORE_KEY = 'revamp-theme';

  /* ── 1. Apply persisted or system preference immediately ── */
  function getPreferred() {
    var stored = localStorage.getItem(STORE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORE_KEY, theme);
    /* Update every mounted toggle on the page */
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      var label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    });
  }

  function toggle() {
    var current = document.documentElement.getAttribute('data-theme') || getPreferred();
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  /* Apply on load (before paint to avoid flash) */
  applyTheme(getPreferred());

  /* ── 2. Inject shared CSS once ── */
  var STYLE_ID = 'revamp-theme-toggle-css';
  if (!document.getElementById(STYLE_ID)) {
    var s = document.createElement('style');
    s.id = STYLE_ID;
    /* A plain icon button (UX-012): a moon to go dark, a sun to go light. It used to be a red on/off switch,
       which next to Publish read as a setting of the event rather than of this screen. */
    s.textContent =
      '.theme-toggle-btn{' +
        'display:inline-grid;place-items:center;box-sizing:border-box;width:32px;height:32px;padding:0;margin:0;' +
        'background:transparent;border:1px solid transparent;border-radius:8px;' +
        'color:var(--text-muted,#6C6A60);cursor:pointer;flex-shrink:0;' +
        'transition:background .15s,border-color .15s,color .15s;' +
      '}' +
      '.theme-toggle-btn:hover{' +
        'background:var(--surface-2,#F3EEED);border-color:var(--border,#E0D7D5);color:var(--text,#1D1B17);' +
      '}' +
      '.theme-toggle-btn:focus-visible{' +
        'outline:2px solid var(--accent,#D3141B);outline-offset:2px;' +
      '}' +
      '.theme-toggle-btn svg{display:block;}' +
      '.theme-toggle-btn .tgl-sun{display:none;}' +
      '[data-theme="dark"] .theme-toggle-btn .tgl-sun{display:block;}' +
      '[data-theme="dark"] .theme-toggle-btn .tgl-moon{display:none;}';
    document.head.appendChild(s);
  }

  /* ── 3. Build the button element ── */
  function buildToggleBtn() {
    var theme = document.documentElement.getAttribute('data-theme') || 'light';
    var isDark = theme === 'dark';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-theme-toggle', '');
    btn.className = 'theme-toggle-btn';
    /* its name says what pressing it does; it is not a pressed / not-pressed control as well */
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
    btn.innerHTML =
      '<svg class="tgl-moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>' +
      '</svg>' +
      '<svg class="tgl-sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="4"/>' +
        '<path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>' +
      '</svg>';
    btn.addEventListener('click', toggle);
    return btn;
  }

  /* ── 4. Mount into a container element ── */
  function mountThemeToggle(container) {
    if (!container) return;
    container.appendChild(buildToggleBtn());
  }

  /* ── 5. Auto-mount into [data-theme-toggle-target] elements ── */
  function autoMount() {
    document.querySelectorAll('[data-theme-toggle-target]').forEach(function (el) {
      /* Don't double-mount */
      if (!el.querySelector('[data-theme-toggle]')) {
        mountThemeToggle(el);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  /* ── 6. Public API ── */
  global.RevampTheme = {
    toggle: toggle,
    apply: applyTheme,
    get: getPreferred,
    mount: mountThemeToggle
  };
  /* The same switch under a name of its own: on the site editor, templates/_shared/rv-theme.js takes the name
     RevampTheme for the site's colors and fonts, and the account menu's light/dark switch (auth.js,
     data-rv-account-theme) still has to find this one. current() is the theme shown now. */
  global.RevampColorMode = {
    toggle: toggle,
    apply: applyTheme,
    current: function () { return document.documentElement.getAttribute('data-theme') || getPreferred(); }
  };

})(window);
