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
      var isDark = theme === 'dark';
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      var indicator = btn.querySelector('.tgl-indicator');
      if (indicator) indicator.setAttribute('data-mode', theme);
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
    s.textContent =
      '.theme-toggle-btn{' +
        'display:inline-flex;align-items:center;justify-content:center;' +
        'background:var(--surface-2,#F3EEED);' +
        'border:1px solid var(--border,#E0D7D5);' +
        'border-radius:999px;padding:2px;cursor:pointer;' +
        'transition:background .2s,border-color .2s,box-shadow .2s;' +
        'outline:none;flex-shrink:0;' +
      '}' +
      '.theme-toggle-btn:hover{' +
        'background:var(--surface-3,#E9E2E0);' +
        'border-color:var(--accent,#ED1C24);' +
        'box-shadow:0 0 0 3px var(--accent-soft,#FBDBDC);' +
      '}' +
      '.theme-toggle-btn:focus-visible{' +
        'outline:2px solid var(--accent,#ED1C24);outline-offset:2px;' +
      '}' +
      '.tgl-track{' +
        'width:46px;height:26px;border-radius:999px;' +
        'background:var(--surface-3,#E9E2E0);' +
        'position:relative;display:block;' +
        'transition:background .22s;' +
      '}' +
      '[data-theme="dark"] .tgl-track{background:var(--accent,#FF6B70);}' +
      '.tgl-indicator{' +
        'position:absolute;top:3px;left:3px;' +
        'width:20px;height:20px;border-radius:50%;' +
        'background:#fff;' +
        'box-shadow:0 1px 4px rgba(0,0,0,.2);' +
        'display:flex;align-items:center;justify-content:center;' +
        'transition:transform .22s cubic-bezier(.34,1.56,.64,1),background .2s,color .2s;' +
        'color:#9C6B14;' +
      '}' +
      '.tgl-indicator[data-mode="dark"]{' +
        'transform:translateX(20px);' +
        'background:#201C1B;color:#FF6B70;' +
      '}' +
      '.tgl-sun{display:block;}' +
      '.tgl-moon{display:none;}' +
      '.tgl-indicator[data-mode="dark"] .tgl-sun{display:none;}' +
      '.tgl-indicator[data-mode="dark"] .tgl-moon{display:block;}';
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
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    btn.title = 'Toggle dark / light mode';
    btn.innerHTML =
      '<span class="tgl-track" aria-hidden="true">' +
        '<span class="tgl-indicator" data-mode="' + theme + '">' +
          '<svg class="tgl-sun" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
            '<circle cx="12" cy="12" r="4"/>' +
            '<path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>' +
          '</svg>' +
          '<svg class="tgl-moon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
            '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>' +
          '</svg>' +
        '</span>' +
      '</span>';
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

})(window);
