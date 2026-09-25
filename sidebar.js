(function(global){
  'use strict';

  function renderSidebar(targetId, options){
    var root = document.getElementById(targetId);
    if (!root) return;

    var activeView = (options && options.activeView) || 'view-dashboard';

    root.innerHTML = [
      '<aside class="sidebar">',
      '  <div style="position:relative;">',
      '    <button class="workspace-btn" id="workspace-btn">',
      '      <img class="brand-logo-img-sm" src="https://oneworld.economictimes.indiatimes.com/Design/HackerRocks/images/hr_images/oneworld-logo.svg" alt="ET Oneworld">',
      '      <span class="names">',
      '        <span class="l2">ET Enterprise AI</span>',
      '      </span>',
      '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 9l4-4 4 4M8 15l4 4 4-4"/></svg>',
      '    </button>',
      '  </div>',
      '',
      '  <a href="create-event.html" class="btn btn-primary btn-block sidebar-cta" id="sidebar-create-event">',
      '    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
      '    Create Event',
      '  </a>',
      '',
      '  <nav class="nav-group">',
      '    <span class="eyebrow">Overview</span>',
      '    <a href="#" class="nav-link' + (activeView === 'view-dashboard' ? ' active' : '') + '" data-target="view-dashboard">',
      '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
      '      Dashboard',
      '    </a>',
      '  </nav>',
      '',
      '  <nav class="nav-group">',
      '    <span class="eyebrow">Content operations</span>',
      '    <a href="#" class="nav-link' + (activeView === 'view-content' ? ' active' : '') + '" data-target="view-content">',
      '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M9.5 13h5M9.5 16.5h5"/></svg>',
      '      Content',
      '      <span class="count">128</span>',
      '    </a>',
      '    <a href="#" class="nav-link' + (activeView === 'view-media' ? ' active' : '') + '" data-target="view-media">',
      '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M3 16.5l5-4.5 4 3.5 3-2.5 6 5.5"/></svg>',
      '      Media',
      '      <span class="count">1.2k</span>',
      '    </a>',
      '  </nav>',
      '',
      '  <nav class="nav-group">',
      '    <span class="eyebrow">Access</span>',
      '    <a href="#" class="nav-link' + (activeView === 'view-users' ? ' active' : '') + '" data-target="view-users">',
      '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="18" cy="9" r="2.4"/><path d="M15.5 14.2c2.6.4 4.5 2.6 4.5 5.3"/></svg>',
      '      Users',
      '      <span class="count">34</span>',
      '    </a>',
      '  </nav>',
      '',
      '  <nav class="nav-group">',
      '    <span class="eyebrow">System</span>',
      '    <a href="#" class="nav-link' + (activeView === 'view-settings' ? ' active' : '') + '" data-target="view-settings">',
      '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V19a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9c.2.7.8 1.2 1.6 1.2H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1z"/></svg>',
      '      Settings',
      '    </a>',
      '  </nav>',
      '',
      '  <div class="sidebar-foot">',
      '    <span class="eyebrow">Build queue</span>',
      '    <p>Content, Media, Users &amp; Settings ship module&#8209;by&#8209;module next.</p>',
      '  </div>',
      '</aside>'
    ].join('');
  }

  /* renderEventRail used to live here. The per-event rail is app-shell.js now
     (window.RevampShell.mount) - one rail, one routing table, so it cannot go
     out of step with the top bar or point Payment somewhere different per
     page the way the old per-page copies did. */

  global.renderSidebar = renderSidebar;
})(window);
