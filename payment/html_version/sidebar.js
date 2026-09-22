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

/* deep-linkable, so the rail's Setup/Report fly-out works from any page */
var activeScreen = urlParams.get("screen") || "pages"; // "details" | "pages" | "create-page"

function setScreen(screen) {
  activeScreen = screen;
  renderSidebar();
  if (typeof renderScreen === "function") renderScreen();
}

// Ensure the setScreen function is accessible globally
window.setScreen = setScreen;

function renderSidebar() {
  if (!window.RevampShell) return;
  /* the same rail as the rest of the CMS - this sub-app only adds its own
     two screens as a fly-out under Payment */
  var evParam = "?event=" + encodeURIComponent(foundEvt.id);
  var hasRouter = typeof renderScreen === "function";
  window.RevampShell.mount({
    section: "payment",
    eventId: foundEvt.id,
    base: "../../",
    topbar: "header-container",
    rail: "sidebar-container",
    sub: {
      payment: [
        { label: "Setup",  icon: '<i class="ti ti-layout-board-split"></i>',
          active: activeScreen === "pages",
          href: "index.html" + evParam,
          onClick: hasRouter ? function(){ setScreen("pages"); } : null },
        { label: "Report", icon: '<i class="ti ti-receipt"></i>',
          active: activeScreen === "details",
          href: "index.html" + evParam + "&screen=details",
          onClick: hasRouter ? function(){ setScreen("details"); } : null }
      ]
    },
    onSection: function(section){ if (section === "payment") return false; }
  });
}

// Initial render
document.addEventListener("DOMContentLoaded", renderSidebar);
