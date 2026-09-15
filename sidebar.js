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

  function renderEventRail(targetId, options){
    var root = document.getElementById(targetId);
    if (!root) return;

    var activeSection = (options && options.activeSection) || 'dashboard';
    var eventId = (options && options.eventId) || new URLSearchParams(location.search).get('event') || '1';
    var onSection = options && options.onSection;
    var sections = [
      { id:'dashboard', label:'Dashboard', icon:'<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15.5 3.5A9 9 0 0 1 20.5 8.5H15.5z"/>' },
      { id:'content', label:'Content', icon:'<path d="M12 2.5l9.5 5-9.5 5-9.5-5z"/><path d="M2.5 12.5l9.5 5 9.5-5"/><path d="M2.5 17l9.5 5 9.5-5"/>' },
      { id:'design', label:'Design', icon:'<path d="M12 2l7 7-9 9H3v-7z"/><path d="M15 5l4 4"/>' },
      { id:'payment', label:'Payment', icon:'<rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M2.5 10h19"/><path d="M6 15h4"/>' },
      { id:'marketing', label:'Promotions', icon:'<path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a5 5 0 0 1 0 8"/><path d="M18.5 5a9 9 0 0 1 0 14"/>' },
      { id:'audience', label:'Reporting', icon:'<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8.5a3 3 0 0 1 0 6"/><path d="M18.5 20a5.6 5.6 0 0 0-3-4.4"/>' },
      { id:'settings', label:'Settings', icon:'<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2v.18a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.93-1.15l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.5 13.6h-.18a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.57 6.67L4.5 6.6a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 1 1.87.34h.08A1.7 1.7 0 0 0 10.4 2.6v-.18a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1.02h.18a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1.02z"/>' }
    ];

    root.innerHTML = sections.map(function(section){
      return '<button class="rail-item' + (section.id === activeSection ? ' active' : '') + '" type="button" data-section="' + section.id + '" aria-current="' + (section.id === activeSection) + '">' +
        '<span class="ri"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + section.icon + '</svg></span>' +
        '<span class="rl">' + section.label + '</span>' +
      '</button>';
    }).join('');

    root.querySelectorAll('[data-section]').forEach(function(button){
      button.addEventListener('click', function(){
        var section = button.getAttribute('data-section');
        if (onSection) {
          onSection(section);
          return;
        }
        if (section === 'dashboard') { location.href = 'dashboard.html'; return; }
        if (section === 'audience') { location.href = 'audience-registrations.html?event=' + encodeURIComponent(eventId); return; }
        if (section === 'design') { location.href = 'custom_editor.html?event=' + encodeURIComponent(eventId); return; }
        if (section === 'payment') { location.href = '../html_version/index.html?event=' + encodeURIComponent(eventId); return; }
        if (section === 'marketing') { location.href = 'marketing.html?event=' + encodeURIComponent(eventId); return; }
        if (section === 'settings') { location.href = 'settings.html?event=' + encodeURIComponent(eventId); return; }
        location.href = 'edit-event.html?event=' + encodeURIComponent(eventId) + '#' + section;
      });
    });
  }

  global.renderSidebar = renderSidebar;
  global.renderEventRail = renderEventRail;
})(window);
