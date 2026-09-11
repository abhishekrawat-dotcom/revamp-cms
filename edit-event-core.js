/* ===========================================================================
   ET Oneworld - Revamp CMS
   Edit Event : CORE

   Shared foundation for the event console. Everything here is used by the
   shell (edit-event.html) AND by the standalone section workbenches, so a
   section file can be opened and worked on entirely on its own.

   Exposes one global: window.RevampCore

     .IC                  icon path table
     .esc .svg            escaping and icon rendering
     .comma .compact .money .fmtDate .fmtDT
     .PORTALS .TYPES .EVENTS .eventById .AV
     .makePeople(ev)      deterministic fake attendee list for an event
     .statTile .panel .panelFlush .emptyState
     .toast(msg)
     .loadState(key) .saveState(key, obj)
     .makeCtx(opts)       builds the object every section view receives
   =========================================================================== */

window.RevampCore = (function(){
  'use strict';

  function $(id){ return document.getElementById(id); }

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function svg(inner, size){
    return '<svg width="' + (size||16) + '" height="' + (size||16) + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }

  var IC = {
    grid:     '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
    sliders:  '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
    megaphone:'<path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a5 5 0 0 1 0 8"/><path d="M18.5 5a9 9 0 0 1 0 14"/>',
    brush:    '<path d="M12 2l7 7-9 9H3v-7z"/><path d="M15 5l4 4"/>',
    users:    '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8.5a3 3 0 0 1 0 6"/><path d="M18.5 20a5.6 5.6 0 0 0-3-4.4"/>',
    mail:     '<rect x="2.5" y="4.5" width="19" height="15" rx="2.2"/><path d="M3 7l9 6 9-6"/>',
    headset:  '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="13" width="4.5" height="6" rx="1.7"/><rect x="17" y="13" width="4.5" height="6" rx="1.7"/><path d="M20 19v.7a2.6 2.6 0 0 1-2.6 2.6H13"/>',
    bell:     '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.2 7.5-2.2 7.5h16.4S18 14.5 18 8.5z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
    chart:    '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15.5 3.5A9 9 0 0 1 20.5 8.5H15.5z"/>',
    card:     '<rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M2.5 10h19"/>',
    gear:     '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2v.18a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.93-1.15l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.5 13.6h-.18a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.57 6.67L4.5 6.6a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.4 2.6v-.18a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1.02h.18a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1.02z"/>',
    image:    '<rect x="3" y="4.5" width="18" height="15" rx="2.3"/><circle cx="8.7" cy="10" r="1.8"/><path d="M3 16.5l5-4.3 3.8 3.3 2.9-2.4L21 18"/>',
    search:   '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.2 2"/>',
    shield:   '<path d="M12 2.7l7.5 3v5.5c0 4.6-3.1 8.5-7.5 10.1-4.4-1.6-7.5-5.5-7.5-10.1V5.7z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    caret:    '<path d="M9 18l6-6-6-6"/>',
    check:    '<path d="M20 6L9 17l-5-5"/>',
    plus:     '<path d="M12 5v14M5 12h14"/>',
    edit:     '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash:    '<path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M19 6l-1 14.2a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 20.2L5 6"/>',
    eye:      '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/>',
    down:     '<path d="M12 5v13M6 13l6 6 6-6"/>',
    ext:      '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 13.5V19a1.6 1.6 0 0 1-1.6 1.6H5A1.6 1.6 0 0 1 3.4 19V7.6A1.6 1.6 0 0 1 5 6h5.5"/>',
    info:     '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    grip:     '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
    up:       '<path d="M12 19V6M6 11l6-6 6 6"/>',
    send:     '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.8 18-3.7-8.5L2 9.1z"/>',
    money:    '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M14.8 9.3A2.7 2.7 0 0 0 12 8c-1.6 0-2.6.8-2.6 2s1 1.9 2.6 2 2.6.8 2.6 2-1 2-2.6 2a2.7 2.7 0 0 1-2.8-1.3"/>',
    wa:       '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.2 7.5L3.5 20.5l1.5-4.6a8.4 8.4 0 1 1 15.5-4.3z"/><path d="M8.8 9.2c.3-.7.6-.7.9-.7h.7c.2 0 .5 0 .7.6l.8 2c.1.3 0 .5-.1.7l-.4.5c-.1.2-.3.4-.1.7a6 6 0 0 0 2.8 2.4c.3.2.5 0 .7-.1l.6-.7c.2-.2.4-.2.6-.1l1.9 1c.3.1.4.3.4.5a2 2 0 0 1-1.9 1.9 8 8 0 0 1-6-3.4c-1.1-1.6-1.7-3.1-1.6-4.2a2 2 0 0 1 .5-1.1z"/>',
    sms:      '<rect x="3" y="4.5" width="18" height="13" rx="2.4"/><path d="M8 21l3.5-3.5"/><path d="M7.5 9h9M7.5 13h5"/>',
    open:     '<rect x="2.5" y="4.5" width="19" height="15" rx="2.2"/><path d="M3 7l9 6 9-6"/><path d="M17 3l4 3-4 3"/>',
    click:    '<path d="M9 4.5v6M4.5 9h6"/><path d="M12.5 12.5L21 21"/><path d="M11 11l3 10 2.2-4.8L21 14z"/>',
    ban:      '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    layers:   '<path d="M12 2.5l9.5 5-9.5 5-9.5-5z"/><path d="M2.5 12.5l9.5 5 9.5-5"/><path d="M2.5 17l9.5 5 9.5-5"/>',
    link:     '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
    lock:     '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    star:     '<path d="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6-4.4-4.3 6.1-.9z"/>',
    help:     '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2A2.6 2.6 0 0 1 14.4 10c0 1.7-2.4 2.2-2.4 3.8"/><path d="M12 17.2h.01"/>',
    ticket:   '<path d="M3 8.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.3a2.2 2.2 0 0 0 0 4.4v1.3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.3a2.2 2.2 0 0 0 0-4.4z"/><path d="M14 6.5v11"/>'
  };

  var PORTALS = {
    cio:'ETCIO', bfsi:'ETBFSI', legal:'ETLegalWorld', auto:'ETAuto', telecom:'ETTelecom',
    retail:'ETRetail', health:'ETHealthWorld', hrworld:'ETHRWorld', manufacturing:'ETManufacturing',
    gov:'ETGovernment', brandequity:'ETBrandEquity'
  };
  var TYPES = {
    ip:'IP Event', client:'Client Event', editorial:'Editorial',
    leadgen:'Lead-Gen Microsite', roundtable:'Round Table', awards:'Awards'
  };

  var EVENTS = [
    { id:1,  name:'MarTech+ Summit 2026', venue:'Sahara Star, Mumbai', eventNo:4060, type:'ip', portal:'brandequity', status:'active',  start:'2026-09-24T08:00:00', end:'2026-09-24T23:59:00', registrations:912, regTarget:1200, visitors:8743, visits:6670, payment:{ type:'paid', amount:387000, txns:15 } },
    { id:2,  name:'ET CISO Annual Conclave 2026', venue:'Grand Hyatt, Goa', eventNo:4097, type:'ip', portal:'cio', status:'upcoming', start:'2026-09-10T10:00:00', end:'2026-09-11T18:00:00', registrations:2645, regTarget:2924, visitors:12923, visits:9800, payment:{ type:'paid', amount:482000, txns:212 } },
    { id:3,  name:'RACEx360', venue:'Taj West End, Bengaluru', eventNo:4652, type:'client', portal:'auto', status:'upcoming', start:'2026-09-25T09:30:00', end:null, registrations:136, regTarget:113, visitors:1130, visits:860, payment:{ type:'free' } },
    { id:4,  name:'Data Protection & Privacy Summit 2026', venue:'Mumbai', eventNo:4138, type:'ip', portal:'legal', status:'upcoming', start:'2026-12-02T09:00:00', end:null, registrations:122, regTarget:248, visitors:2480, visits:1900, payment:{ type:'paid', amount:0, txns:0 } },
    { id:5,  name:'Healthcare Innovation Awards 2026', venue:'The Leela, New Delhi', eventNo:4012, type:'awards', portal:'health', status:'active', start:'2026-11-22T18:00:00', end:null, registrations:300, regTarget:280, visitors:4000, visits:3100, payment:{ type:'paid', amount:620000, txns:150 } },
    { id:6,  name:'AI-Driven SecOps', venue:'Virtual', eventNo:3354, type:'leadgen', portal:'telecom', status:'active', start:null, end:null, registrations:88, regTarget:85, visitors:850, visits:610, payment:{ type:'paid', amount:45000, txns:19 } },
    { id:7,  name:'Manufacturing 4.0 Summit 2026', venue:'Venue to be confirmed', eventNo:4471, type:'ip', portal:'manufacturing', status:'draft', start:'2026-12-03T00:00:00', end:null, registrations:0, regTarget:null, visitors:0, visits:0, payment:{ type:'free' } },
    { id:8,  name:'BFSI Fraud & Risk Conclave 2025', venue:'ITC Grand Central, Mumbai', eventNo:3980, type:'ip', portal:'bfsi', status:'completed', start:'2025-11-18T09:00:00', end:'2025-11-19T18:00:00', registrations:850, regTarget:800, visitors:12000, visits:9400, payment:{ type:'paid', amount:950000, txns:301 } }
  ];

  /* deterministic pseudo-random so every reload shows the same numbers */
  function rnd(seed){ var x = Math.sin(seed) * 10000; return x - Math.floor(x); }

  EVENTS.forEach(function(e, i){
    var s = e.eventNo;
    e.mailers    = Math.round(e.visitors * (1.8 + rnd(s) * 1.2));
    e.opens      = Math.round(e.mailers * (0.11 + rnd(s + 1) * 0.06));
    e.clicks     = Math.round(e.opens * (0.4 + rnd(s + 2) * 0.25));
    e.unsub      = Math.round(e.mailers * (0.014 + rnd(s + 3) * 0.006));
    e.dials      = Math.round(e.registrations * (0.4 + rnd(s + 4) * 0.5));
    e.leads      = Math.round(e.registrations * (0.5 + rnd(s + 5) * 0.7));
    e.whatsapp   = Math.round(e.visitors * (0.4 + rnd(s + 6) * 0.3));
    e.sms        = Math.round(e.visitors * (0.2 + rnd(s + 7) * 0.3));
    e.attendees  = e.status === 'completed' ? Math.round(e.registrations * 0.62) : 0;
    e.shortlist  = Math.round(e.registrations * (0.12 + rnd(s + 8) * 0.1));
    e.wishlist   = Math.round(e.registrations * (0.07 + rnd(s + 9) * 0.08));
  });

  function eventById(id){
    for (var i = 0; i < EVENTS.length; i++) if (String(EVENTS[i].id) === String(id)) return EVENTS[i];
    return null;
  }

  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function compact(n){
    if (n == null) return '—';
    if (n >= 10000000) return (n / 10000000).toFixed(2).replace(/\.00$/,'') + ' Cr';
    if (n >= 100000)   return (n / 100000).toFixed(2).replace(/\.00$/,'') + ' Lacs';
    if (n >= 1000)     return (n / 1000).toFixed(2).replace(/\.00$/,'') + ' K';
    return String(n);
  }
  function comma(n){
    if (n == null) return '—';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtDT(iso){
    if (!iso) return 'Date to be announced';
    var d = new Date(iso);
    if (isNaN(d)) return 'Date to be announced';
    var hh = d.getHours(), mm = d.getMinutes();
    var ap = hh >= 12 ? 'PM' : 'AM', h12 = hh % 12 || 12;
    return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
           ' (' + (h12 < 10 ? '0' : '') + h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap + ')';
  }
  function fmtDate(iso){
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  }
  function money(n){
    if (n == null) return '—';
    return '₹ ' + comma(n);
  }

  function toast(msg){
    var host = $('toast-host');
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = svg(IC.check, 15) + '<span>' + esc(msg) + '</span>';
    host.appendChild(el);
    setTimeout(function(){
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
      setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2600);
  }

  var FIRST = ['Irin','Nishant','Varun','Tanuj','Saakshi','Gunjan','Rhea','Amit','Priya','Karan','Meera','Rohit','Ananya','Vikram','Sneha','Arjun','Divya','Kabir','Neha','Siddharth','Tara','Manish','Ishita','Rahul','Pooja','Aditya','Kavya','Nikhil','Riya','Sameer'];
  var LAST  = ['Patel','Neeraj','Narula','Pant','Jain','Makhijani','Kapoor','Sharma','Verma','Singh','Iyer','Nair','Bose','Chopra','Reddy','Gupta','Menon','Rao','Desai','Bhatt','Sethi','Malhotra','Joshi','Kulkarni','Shah','Agarwal','Pillai','Banerjee','Mehta','Khanna'];
  var DESIG = ['Head - IT','Co-Founder','Manager - Growth','Director','Manager - Corporate Communications','VP Engineering','CTO','CIO','Head of Marketing','Product Lead','AVP - Digital','Senior Manager','Chief Data Officer','Head - Security','GM Operations'];
  var COMP  = ['Ammann India','Lumetrics','DareAISearch','Holy River Hotel Pvt Ltd','Bharti Airtel','Livguard Energy','Tata Capital','HDFC Bank','Infosys','Wipro','Reliance Jio','Mahindra Group','Godrej','ICICI Lombard','Zomato','Swiggy','Paytm','Flipkart','Adani Ports','L&T Infotech'];
  var CITY  = ['New Delhi','Noida','Mumbai','Gurgaon / Gurugram','Pune','Chennai','Bangalore / Bengaluru','Hyderabad','Ahmedabad','Kolkata','Jaipur','Rishikesh'];
  var SRC   = ['PlatformListing','Others','Email Campaign','WhatsApp','Organic Search','LinkedIn','Referral'];
  var AV    = ['#ED1C24','#2F6FB0','#2F8F5B','#8A5A9E','#9C6B14','#B3151B','#3E7C7C','#A2457A'];

  function makePeople(EV){
    var out = [], n = Math.max(EV.registrations, 12);
    n = Math.min(n, 400);
    for (var i = 0; i < n; i++){
      var s = EV.eventNo + i * 13;
      var f = FIRST[Math.floor(rnd(s) * FIRST.length)];
      var l = LAST[Math.floor(rnd(s + 1) * LAST.length)];
      var day = 1 + Math.floor(rnd(s + 7) * 28);
      out.push({
        id: i + 1,
        name: f + ' ' + l,
        initials: f[0] + l[0],
        colour: AV[Math.floor(rnd(s + 2) * AV.length)],
        desig: DESIG[Math.floor(rnd(s + 3) * DESIG.length)],
        comp:  COMP[Math.floor(rnd(s + 4) * COMP.length)],
        city:  CITY[Math.floor(rnd(s + 5) * CITY.length)],
        src:   SRC[Math.floor(rnd(s + 6) * SRC.length)],
        email: (f + '.' + l).toLowerCase() + '@' + COMP[Math.floor(rnd(s + 4) * COMP.length)].split(' ')[0].toLowerCase() + '.com',
        when:  '2026-0' + (1 + Math.floor(rnd(s + 8) * 8)) + '-' + (day < 10 ? '0' : '') + day,
        paid:  rnd(s + 9) > 0.84,
        attended: rnd(s + 10) > 0.42
      });
    }
    return out;
  }

  function statTile(ico, label, value, delta, viewLink){
    var d = '';
    if (delta){
      var cls = delta.dir === 'up' ? 'up' : (delta.dir === 'down' ? 'down' : 'flat');
      var arrow = delta.dir === 'up' ? IC.up : (delta.dir === 'down' ? IC.down : '');
      d = '<span class="st-d ' + cls + '">' + (arrow ? svg(arrow, 12) : '') + esc(delta.text) + '</span>';
    }
    return '<' + (viewLink ? 'button type="button" data-goto="' + viewLink + '"' : 'div') +
        ' class="stat' + (viewLink ? ' clickable' : '') + '">' +
        '<span class="st-top"><span class="st-ico">' + svg(ico, 15) + '</span>' +
        '<span class="st-lb">' + esc(label) + '</span></span>' +
        '<span class="st-v">' + esc(value) + '</span>' + d +
      '</' + (viewLink ? 'button' : 'div') + '>';
  }

  function panel(title, sub, body, right){
    return '<div class="panel">' +
        '<div class="panel-head"><h3>' + esc(title) + '</h3>' +
          (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
          (right || '') + '</div>' +
        '<div class="panel-body">' + body + '</div>' +
      '</div>';
  }
  function panelFlush(title, sub, body, right){
    return '<div class="panel">' +
        '<div class="panel-head"><h3>' + esc(title) + '</h3>' +
          (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
          (right || '') + '</div>' + body +
      '</div>';
  }

  function emptyState(ico, title, msg, cta){
    return '<div class="empty"><span class="ico">' + svg(ico, 24) + '</span>' +
      '<h4>' + esc(title) + '</h4><p>' + esc(msg) + '</p>' + (cta || '') + '</div>';
  }

  /* ---------------------------------------------------------------- state */
  function loadState(key){
    var S = { sections:null, nav:null, checklist:null, published:false, theme:'ET Red' };
    try {
      var raw = localStorage.getItem(key);
      if (raw){ var p = JSON.parse(raw); for (var k in p) if (p.hasOwnProperty(k)) S[k] = p[k]; }
    } catch(e){}
    return S;
  }
  function saveState(key, S){
    try { localStorage.setItem(key, JSON.stringify(S)); } catch(e){}
  }

  /* ---------------------------------------------------------------- toast */
  function toast(msg){
    var host = $('toast-host');
    if (!host){
      host = document.createElement('div');
      host.className = 'toast-host'; host.id = 'toast-host';
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = svg(IC.check, 15) + '<span>' + esc(msg) + '</span>';
    host.appendChild(el);
    setTimeout(function(){
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
      setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2600);
  }

  /* ----------------------------------------------------------------
     The bundle every section view receives. A section never reaches
     outside this object, which is what lets it live in its own file.

     opts: { EV, S, PEOPLE, vhead, go, render, save }
     ---------------------------------------------------------------- */
  function makeCtx(opts){
    return {
      EV: opts.EV,
      S: opts.S,
      PEOPLE: opts.PEOPLE || [],
      IC: IC, AV: AV, PORTALS: PORTALS, TYPES: TYPES,
      $: $, esc: esc, svg: svg,
      comma: comma, compact: compact, money: money, fmtDate: fmtDate, fmtDT: fmtDT,
      statTile: statTile, panel: panel, panelFlush: panelFlush, emptyState: emptyState,
      toast: toast,
      vhead:  opts.vhead  || function(t, sub, right){
        return '<div class="vhead"><div class="vhead-row"><div class="grow">' +
          '<h2>' + esc(t) + '</h2>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') +
          '</div>' + (right ? '<div style="display:flex;gap:9px;flex-wrap:wrap">' + right + '</div>' : '') +
          '</div></div>';
      },
      go:     opts.go     || function(){},
      render: opts.render || function(){},
      save:   opts.save   || function(){}
    };
  }

  return {
    $: $, esc: esc, svg: svg, IC: IC, AV: AV,
    comma: comma, compact: compact, money: money, fmtDate: fmtDate, fmtDT: fmtDT, rnd: rnd,
    PORTALS: PORTALS, TYPES: TYPES, EVENTS: EVENTS, eventById: eventById,
    makePeople: makePeople,
    statTile: statTile, panel: panel, panelFlush: panelFlush, emptyState: emptyState,
    toast: toast, loadState: loadState, saveState: saveState, makeCtx: makeCtx
  };
})();
