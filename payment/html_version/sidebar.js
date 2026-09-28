/* sidebar.js — Sidebar logic simulating CMS integration */

const CMS_EVENTS = [
    { id:"1", vertical:"BrandEquity", name:'MarTech+ Summit 2026', date: "24 Sep 2026", location: 'Sahara Star, Mumbai' },
    { id:"2", vertical:"CIO", name:'ET CISO Annual Conclave 2026', date: "10 Sep 2026", location: 'Grand Hyatt, Goa' },
    { id:"3", vertical:"Auto", name:'RACEx360', date: "25 Sep 2026", location: 'Taj West End, Bengaluru' },
    { id:"4", vertical:"Legal", name:'Data Protection & Privacy Summit 2026', date: "02 Dec 2026", location: 'Mumbai' },
    { id:"5", vertical:"Health", name:'Healthcare Innovation Awards 2026', date: "22 Nov 2026", location: 'The Leela, New Delhi' },
    { id:"6", vertical:"Telecom", name:'AI-Driven SecOps', date: "TBA", location: 'Virtual' },
    { id:"7", vertical:"Manufacturing", name:'Manufacturing 4.0 Summit 2026', date: "03 Dec 2026", location: 'TBC' },
    { id:"8", vertical:"BFSI", name:'BFSI Fraud & Risk Conclave 2025', date: "18 Nov 2025", location: 'ITC Grand Central, Mumbai' }
];

const urlParams = new URLSearchParams(window.location.search);
let evtId = urlParams.get('event') || "1";
let foundEvt = CMS_EVENTS.find(e => e.id === evtId);
if (!foundEvt) foundEvt = CMS_EVENTS[0];

window.CURRENT_EVENT = foundEvt;

var activeScreen = "pages"; // "details" | "pages" | "create-page"

function setScreen(screen) {
  activeScreen = screen;
  renderSidebar();
  renderScreen();
}

// Ensure the setScreen function is accessible globally
window.setScreen = setScreen;

function renderSidebar() {
  const container = document.getElementById("sidebar-container");
  if (!container) return;

  const isDetails = activeScreen === "details";
  const isPages = activeScreen === "pages";

  container.innerHTML = `
    <a class="rail-item" href="../../dashboard.html" aria-label="Dashboard">
      <span class="ri"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15.5 3.5A9 9 0 0 1 20.5 8.5H15.5z"/></svg></span>
      <span class="rl">Dashboard</span>
    </a>
    <a class="rail-item" href="../../edit-event.html#content" aria-label="Content">
      <span class="ri"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l9.5 5-9.5 5-9.5-5z"/><path d="M2.5 12.5l9.5 5 9.5-5"/><path d="M2.5 17l9.5 5 9.5-5"/></svg></span>
      <span class="rl">Content</span>
    </a>
    <a class="rail-item" href="../../custom_editor.html" aria-label="Design">
      <span class="ri"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 7-9 9H3v-7z"/><path d="M15 5l4 4"/></svg></span>
      <span class="rl">Design</span>
    </a>
    
    <!-- Payment (hover flyout) -->
    <div class="rail-item has-sub ${activeScreen.includes('page') || activeScreen === 'details' ? 'active' : ''}" tabindex="0" role="button" aria-label="Payment">
      <span class="ri"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M2.5 10h19"/><path d="M6 15h4"/></svg></span>
      <span class="rl">Payment</span>
      <div class="rail-sub">
        <a class="rail-sub-item ${activeScreen === 'pages' ? 'active' : ''}" href="#" onclick="setScreen('pages'); return false;">
          <i class="ti ti-layout-board-split"></i> Setup
        </a>
        <a class="rail-sub-item ${activeScreen === 'details' ? 'active' : ''}" href="#" onclick="setScreen('details'); return false;">
          <i class="ti ti-receipt"></i> Report
        </a>
      </div>
    </div>

    <a class="rail-item" href="../../marketing.html" aria-label="Promotions">
      <span class="ri"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a5 5 0 0 1 0 8"/><path d="M18.5 5a9 9 0 0 1 0 14"/></svg></span>
      <span class="rl">Promotions</span>
    </a>
    <a class="rail-item" href="../../audience-registrations.html" aria-label="Reporting">
      <span class="ri"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8.5a3 3 0 0 1 0 6"/><path d="M18.5 20a5.6 5.6 0 0 0-3-4.4"/></svg></span>
      <span class="rl">Reporting</span>
    </a>
    <a class="rail-item" href="../../settings.html" aria-label="Settings">
      <span class="ri"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2v.18a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.93-1.15l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.5 13.6h-.18a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.57 6.67L4.5 6.6a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.4 2.6v-.18a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1.02h.18a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1.02z"/></svg></span>
      <span class="rl">Settings</span>
    </a>
  `;
}

// Initial render
document.addEventListener("DOMContentLoaded", renderSidebar);
