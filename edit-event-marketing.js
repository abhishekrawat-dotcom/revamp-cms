/* ===========================================================================
   ET Oneworld - Revamp CMS
   PROMOTIONS  (the module the Marketing / Promotions rail item opens)

   Five modules, in the order a promotions desk actually works:

     Studio     build the assets  - mailers, banners, social posts
     Audiences  build the list    - batches cut from the prospect pool
     Campaigns  send it           - bulk email and WhatsApp against a batch
     Pipeline   where data comes from - this edition, past editions, visitors
     CRM        work the leads    - stages, owners, calls, follow-ups

   Hosted by edit-event.html and by marketing.html. Neither host owns the
   state: this file persists its own per-event store, and redraws itself
   through #mkt-root, so both hosts behave identically.
   =========================================================================== */

window.EditEventMarketing = (function(){
  'use strict';

  var C = window.RevampCore;
  var esc, svg, comma, compact, money, fmtDate, rnd;

  function bindCore(){
    if (esc) return;
    esc = C.esc; svg = C.svg; comma = C.comma; compact = C.compact;
    money = C.money; fmtDate = C.fmtDate; rnd = C.rnd;
  }

  function $(id){ return document.getElementById(id); }
  function each(sel, fn){ document.querySelectorAll(sel).forEach(fn); }

  /* ======================================================================
     ICONS
     ====================================================================== */
  var I = {
    mail:'<rect x="2.5" y="4.5" width="19" height="15" rx="2.2"/><path d="M3 7l9 6 9-6"/>',
    wa:'<path d="M20.5 11.6a8.4 8.4 0 0 1-12.2 7.5L3.5 20.5l1.5-4.6a8.4 8.4 0 1 1 15.5-4.3z"/>',
    image:'<rect x="3" y="4.5" width="18" height="15" rx="2.3"/><circle cx="8.7" cy="10" r="1.8"/><path d="M3 16.5l5-4.3 3.8 3.3 2.9-2.4L21 18"/>',
    li:'<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M7 10v7M7 7.2v.01M11.5 17v-4a2.5 2.5 0 0 1 5 0v4"/>',
    users:'<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8.5a3 3 0 0 1 0 6"/><path d="M18.5 20a5.6 5.6 0 0 0-3-4.4"/>',
    flow:'<rect x="3" y="3" width="7" height="6" rx="1.6"/><rect x="14" y="3" width="7" height="6" rx="1.6"/><rect x="8.5" y="15" width="7" height="6" rx="1.6"/><path d="M6.5 9v3.5h11V9M12 12.5V15"/>',
    headset:'<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="13" width="4.5" height="6" rx="1.7"/><rect x="17" y="13" width="4.5" height="6" rx="1.7"/><path d="M20 19v.7a2.6 2.6 0 0 1-2.6 2.6H13"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    trash:'<path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M19 6l-1 14.2a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 20.2L5 6"/>',
    send:'<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.8 18-3.7-8.5L2 9.1z"/>',
    eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/>',
    click:'<path d="M9 4.5v6M4.5 9h6"/><path d="M12.5 12.5L21 21"/><path d="M11 11l3 10 2.2-4.8L21 14z"/>',
    money:'<circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M14.8 9.3A2.7 2.7 0 0 0 12 8c-1.6 0-2.6.8-2.6 2s1 1.9 2.6 2 2.6.8 2.6 2-1 2-2.6 2a2.7 2.7 0 0 1-2.8-1.3"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.2 2"/>',
    check:'<path d="M20 6L9 17l-5-5"/>',
    x:'<path d="M18 6L6 18M6 6l12 12"/>',
    phone:'<path d="M6.5 3h3l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2 4.5 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z"/>',
    note:'<path d="M4 4.5h16v10l-5 5H4z"/><path d="M20 14.5h-5v5"/>',
    filter:'<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>',
    star:'<path d="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6-4.4-4.3 6.1-.9z"/>',
    up:'<path d="M12 19V6M6 11l6-6 6 6"/>',
    down:'<path d="M12 5v13M6 13l6 6 6-6"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    layers:'<path d="M12 2.5l9.5 5-9.5 5-9.5-5z"/><path d="M2.5 12.5l9.5 5 9.5-5"/><path d="M2.5 17l9.5 5 9.5-5"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2.2"/><path d="M3 10h18M8 3v4M16 3v4"/>'
  };

  /* ======================================================================
     REFERENCE DATA
     ====================================================================== */
  var INDUSTRIES = ['BFSI','IT Services','Manufacturing','Healthcare','Retail',
                    'Telecom','Automotive','Energy','Media','Logistics'];
  var SENIORITY  = ['CXO','VP / Head','Director','Senior Manager','Manager'];
  var SUB_STATE  = [
    { id:'active',       label:'Active',       note:'Opened in the last 30 days', colour:'#12A870' },
    { id:'passive',      label:'Passive',      note:'Opened in the last 90 days', colour:'#E89B0C' },
    { id:'dormant',      label:'Dormant',      note:'Nothing for 90 days+',       colour:'#857F6A' },
    { id:'unsubscribed', label:'Unsubscribed', note:'Opted out - never mailed',   colour:'#ED1C24' }
  ];
  function subState(id){
    for (var i=0;i<SUB_STATE.length;i++) if (SUB_STATE[i].id===id) return SUB_STATE[i];
    return SUB_STATE[0];
  }

  var FIRST = ['Irin','Nishant','Varun','Tanuj','Saakshi','Gunjan','Rhea','Amit','Priya','Karan',
               'Meera','Rohit','Ananya','Vikram','Sneha','Arjun','Divya','Kabir','Neha','Siddharth',
               'Tara','Manish','Ishita','Rahul','Pooja','Aditya','Kavya','Nikhil','Riya','Sameer'];
  var LAST  = ['Patel','Neeraj','Narula','Pant','Jain','Makhijani','Kapoor','Sharma','Verma','Singh',
               'Iyer','Nair','Bose','Chopra','Reddy','Gupta','Menon','Rao','Desai','Bhatt',
               'Sethi','Malhotra','Joshi','Kulkarni','Shah','Agarwal','Pillai','Banerjee','Mehta','Khanna'];
  var DESIG = ['Chief Information Officer','Chief Technology Officer','Head of Marketing','VP Engineering',
               'Director - Digital','Senior Manager - IT','Head - Security','GM Operations',
               'Product Lead','AVP - Digital','Chief Data Officer','Head - Customer Experience'];
  var COMP  = ['Tata Capital','HDFC Bank','Infosys','Wipro','Reliance Jio','Mahindra Group','Godrej',
               'ICICI Lombard','Zomato','Swiggy','Paytm','Flipkart','Adani Ports','L&T Infotech',
               'Asian Paints','Marico','Dabur','Bajaj Finserv','Axis Bank','Titan'];
  var CITY  = ['New Delhi','Noida','Mumbai','Gurgaon','Pune','Chennai','Bengaluru','Hyderabad',
               'Ahmedabad','Kolkata','Jaipur'];
  var SRC   = ['Past attendee','Website signup','Partner list','LinkedIn','Webinar','Referral','Purchased list'];
  var OWNERS = ['Priya Sharma','Karan Mehta','Ananya Rao','Rohit Nair'];
  var AV = ['#ED1C24','#2F6FB0','#2F8F5B','#8A5A9E','#9C6B14','#B3151B','#3E7C7C','#A2457A'];

  /* ======================================================================
     PROSPECT POOL
     Wider than this event's registrations - the whole addressable base the
     promotions desk works from, which is the point of the module.
     ====================================================================== */
  var POOL = {};
  function prospects(EV){
    if (POOL[EV.id]) return applyStore(EV, POOL[EV.id]);
    var out = [], n = 900;
    for (var i = 0; i < n; i++){
      var s = EV.eventNo + i * 11;
      var f = FIRST[Math.floor(rnd(s) * FIRST.length)];
      var l = LAST[Math.floor(rnd(s+1) * LAST.length)];
      var comp = COMP[Math.floor(rnd(s+2) * COMP.length)];
      var roll = rnd(s+9);
      var st = roll > 0.93 ? 'unsubscribed' : roll > 0.74 ? 'dormant' : roll > 0.42 ? 'passive' : 'active';
      var opens = st === 'active' ? 6 + Math.floor(rnd(s+10)*9)
                : st === 'passive' ? 2 + Math.floor(rnd(s+10)*5)
                : Math.floor(rnd(s+10)*2);
      out.push({
        id: i + 1,
        name: f + ' ' + l,
        initials: f[0] + l[0],
        colour: AV[Math.floor(rnd(s+3) * AV.length)],
        email: (f + '.' + l).toLowerCase() + '@' + comp.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,14) + '.com',
        phone: '+91 9' + String(Math.floor(rnd(s+4) * 900000000 + 100000000)).slice(0,9),
        desig: DESIG[Math.floor(rnd(s+5) * DESIG.length)],
        seniority: SENIORITY[Math.floor(rnd(s+6) * SENIORITY.length)],
        comp: comp,
        city: CITY[Math.floor(rnd(s+7) * CITY.length)],
        industry: INDUSTRIES[Math.floor(rnd(s+8) * INDUSTRIES.length)],
        sub: st,
        opens: opens,
        clicks: Math.floor(opens * (0.2 + rnd(s+11) * 0.4)),
        src: SRC[Math.floor(rnd(s+12) * SRC.length)],
        editions: Math.floor(rnd(s+13) * 4),           /* past editions attended */
        registered: rnd(s+14) > 0.62,                   /* already on this event */
        paid: rnd(s+15) > 0.86
      });
    }
    out.forEach(function(p){
      /* a single number to sort the pool by: engagement + loyalty + seniority */
      p.score = Math.min(100, Math.round(
        (p.opens * 4) + (p.clicks * 6) + (p.editions * 9) +
        (p.seniority === 'CXO' ? 18 : p.seniority === 'VP / Head' ? 12 : 6) +
        (p.sub === 'active' ? 14 : p.sub === 'passive' ? 6 : 0)
      ));
    });
    POOL[EV.id] = out;
    return applyStore(EV, out);
  }

  /* ======================================================================
     PAST EDITIONS
     ====================================================================== */
  function editions(EV){
    var yr = EV.start ? Number(EV.start.slice(0,4)) : 2026;
    var out = [{
      year: yr, label: EV.name, current: true,
      regs: EV.registrations, visitors: EV.visitors,
      paid: EV.payment.type === 'paid' ? EV.payment.txns : 0,
      revenue: EV.payment.type === 'paid' ? EV.payment.amount : 0,
      attended: EV.attendees || 0,
      channel: 'Email'
    }];
    var chans = ['Email','WhatsApp','LinkedIn','Email'];
    for (var k = 1; k <= 3; k++){
      var s = EV.eventNo + k * 97;
      var regs = Math.round(EV.registrations * (0.55 + rnd(s) * 0.5));
      out.push({
        year: yr - k,
        label: EV.name.replace(/\d{4}/, String(yr - k)),
        current: false,
        regs: regs,
        visitors: Math.round(regs * (7 + rnd(s+1) * 6)),
        paid: Math.round(regs * (0.12 + rnd(s+2) * 0.2)),
        revenue: Math.round(regs * (0.12 + rnd(s+2) * 0.2) * 26000),
        attended: Math.round(regs * (0.55 + rnd(s+3) * 0.2)),
        channel: chans[k]
      });
    }
    return out;
  }

  /* ======================================================================
     STORE  (per event, owned by this module)
     ====================================================================== */
  var D = null, KEY = '';
  function loadStore(EV){
    KEY = 'revamp-promo-' + EV.id;
    D = { templates:[], banners:[], posts:[], batches:[], campaigns:[], crm:{}, seeded:false };
    try {
      var raw = localStorage.getItem(KEY);
      if (raw){ var p = JSON.parse(raw); for (var k in p) if (p.hasOwnProperty(k)) D[k] = p[k]; }
    } catch(e){}
    if (!D.seeded) seed(EV);
    return D;
  }
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(D)); } catch(e){} }
  function uid(pre){ return pre + Date.now().toString(36) + Math.floor(Math.random()*900+100).toString(36); }

  function seed(EV){
    D.templates = [
      { id:'t1', name:'Save the date', channel:'email', subject:'Save the date - {{event}}',
        body:'Hi {{first}},\n\n{{event}} returns on {{date}} at {{venue}}.\n\nWe are opening a limited set of seats to our community first. Register before they go.\n\nThe {{event}} team', updated:Date.now()-86400000*12 },
      { id:'t2', name:'Speaker announcement', channel:'email', subject:'The {{event}} line-up is live',
        body:'Hi {{first}},\n\nThe speaker line-up for {{event}} is now live - CIOs and heads of technology from across {{industry}}.\n\nSee who is speaking and reserve your seat.\n\nThe {{event}} team', updated:Date.now()-86400000*6 },
      { id:'t3', name:'Last seats', channel:'whatsapp', subject:'',
        body:'Hi {{first}}, the last few seats for {{event}} on {{date}} are open. Shall I hold one for you?', updated:Date.now()-86400000*2 },
      { id:'t4', name:'Agenda drop', channel:'email', subject:'{{event}} - the full agenda',
        body:'Hi {{first}},\n\nThe full agenda for {{event}} is published: keynotes, panels and the closed-door roundtables.\n\nPlan your day.\n\nThe {{event}} team', updated:Date.now()-86400000*20 }
    ];
    D.banners = [
      { id:'b1', name:'Homepage takeover', size:'1440 x 400', placement:'ETBrandEquity homepage', status:'live', impressions:42800, clicks:940 },
      { id:'b2', name:'Sidebar rectangle', size:'300 x 250', placement:'Run of network', status:'live', impressions:128400, clicks:2310 },
      { id:'b3', name:'Newsletter strip', size:'600 x 120', placement:'Daily newsletter', status:'scheduled', impressions:0, clicks:0 },
      { id:'b4', name:'Article inline', size:'728 x 90', placement:'Category pages', status:'paused', impressions:18200, clicks:410 }
    ];
    D.posts = [
      { id:'p1', channel:'linkedin', title:'Speaker reveal', status:'published',
        body:'The line-up for {{event}} is here. Three days of the conversations that actually move the needle.\n\n#MarTech #Leadership', when:Date.now()-86400000*14, impressions:4820, engagements:186 },
      { id:'p2', channel:'linkedin', title:'Agenda is live', status:'published',
        body:'Keynotes, panels and closed-door roundtables. The full {{event}} agenda is live.\n\nLink in comments.', when:Date.now()-86400000*5, impressions:3110, engagements:94 },
      { id:'p3', channel:'linkedin', title:'Last 50 seats', status:'draft',
        body:'Fifty seats left for {{event}}. If you have been meaning to register, now is the moment.', when:0, impressions:0, engagements:0 }
    ];
    D.batches = [
      { id:'g1', name:'CXOs in BFSI', f:{ seniority:['CXO'], industry:['BFSI'], sub:['active','passive'], city:[], comp:[], minScore:0, unregisteredOnly:false }, created:Date.now()-86400000*9 },
      { id:'g2', name:'Active Mumbai list', f:{ seniority:[], industry:[], sub:['active'], city:['Mumbai'], comp:[], minScore:0, unregisteredOnly:false }, created:Date.now()-86400000*4 }
    ];
    D.campaigns = [
      { id:'c1', name:'Save the date blast', channel:'email', templateId:'t1', batchId:'g1',
        status:'sent', when:Date.now()-86400000*10, sent:412, delivered:398, opened:143, clicked:38, regs:24 },
      { id:'c2', name:'Speaker reveal push', channel:'email', templateId:'t2', batchId:'g2',
        status:'sent', when:Date.now()-86400000*4, sent:266, delivered:259, opened:112, clicked:41, regs:31 },
      { id:'c3', name:'Last seats WhatsApp', channel:'whatsapp', templateId:'t3', batchId:'g1',
        status:'scheduled', when:Date.now()+86400000*2, sent:0, delivered:0, opened:0, clicked:0, regs:0 }
    ];
    D.seeded = true;
    save();
  }

  function applyStore(EV, list){
    list.forEach(function(p){
      var c = D && D.crm ? D.crm[p.id] : null;
      p.crm = c || null;
    });
    return list;
  }

  /* ======================================================================
     MODULE STATE
     ====================================================================== */
  var CUR = { tab:'studio', ctx:null, EV:null };
  var U = {
    studio:'mailers',
    audQ:'', audPage:1,
    crmView:'board', crmQ:'', crmStage:'all', crmOwner:'all', crmPage:1,
    builder:null
  };

  var TABS = [
    { id:'studio',    label:'Studio' },
    { id:'audiences', label:'Audiences' },
    { id:'campaigns', label:'Campaigns' },
    { id:'pipeline',  label:'Data pipeline' },
    { id:'crm',       label:'CRM' }
  ];

  /* ======================================================================
     SHARED UI BITS
     ====================================================================== */
  function kpi(ico, tone, label, value, sub){
    return '<div class="kpi"><div class="kl">' +
      '<span class="ki" style="background:'+tone+'1F;color:'+tone+'">'+svg(ico,13)+'</span>'+esc(label)+'</div>' +
      '<div class="kv">'+value+'</div><div class="ks">'+esc(sub)+'</div></div>';
  }
  function panel(title, sub, body, right){
    return '<section class="panel" style="margin-bottom:18px">' +
      '<div class="panel-head"><h3>'+esc(title)+'</h3>' +
      (sub ? '<span class="sub">'+esc(sub)+'</span>' : '') + (right||'') + '</div>' + body + '</section>';
  }
  function empty(ico, title, msg, cta){
    return '<div class="empty"><span class="ico">'+svg(ico,24)+'</span><h4>'+esc(title)+'</h4>' +
      '<p>'+esc(msg)+'</p>'+(cta||'')+'</div>';
  }
  function bars(rows, colour, max){
    var top = rows.length ? Math.max(rows[0].n, 1) : 1;
    return rows.slice(0, max || 8).map(function(r){
      return '<div class="bar-item"><div class="bl"><b>'+esc(r.k)+'</b><span>'+comma(r.n)+'</span></div>' +
        '<div class="bar-track"><i style="width:'+Math.round(r.n/top*100)+'%;background:'+(r.c||colour)+'"></i></div></div>';
    }).join('');
  }
  function tally(list, key){
    var m = {};
    list.forEach(function(p){ m[p[key]] = (m[p[key]] || 0) + 1; });
    return Object.keys(m).map(function(k){ return { k:k, n:m[k] }; })
      .sort(function(a,b){ return b.n - a.n; });
  }
  function ago(ms){
    if (!ms) return '-';
    var d = Math.round((Date.now() - ms) / 86400000);
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d > 0) return d + ' days ago';
    return 'in ' + Math.abs(d) + ' days';
  }
  function merge(text, p, EV){
    var m = {
      '{{first}}': p ? p.name.split(' ')[0] : 'there',
      '{{name}}': p ? p.name : 'there',
      '{{company}}': p ? p.comp : 'your company',
      '{{industry}}': p ? p.industry : 'your sector',
      '{{event}}': EV.name,
      '{{date}}': fmtDate(EV.start),
      '{{venue}}': EV.venue
    };
    var out = text;
    Object.keys(m).forEach(function(k){ out = out.split(k).join(m[k]); });
    return out;
  }

  /* ======================================================================
     MODULE 1 : STUDIO
     ====================================================================== */
  function studioHTML(ctx){
    var EV = ctx.EV;
    var subs = [['mailers','Mailer templates',D.templates.length],
                ['banners','Banners',D.banners.length],
                ['posts','Social posts',D.posts.length]];
    var nav = '<div class="subtabs" style="margin-bottom:18px">' + subs.map(function(x){
      return '<button type="button" data-studio="'+x[0]+'" aria-pressed="'+(U.studio===x[0])+'">' +
        esc(x[1]) + '<span class="cnt">'+x[2]+'</span></button>';
    }).join('') + '</div>';

    if (U.studio === 'mailers')  return nav + studioMailers(EV);
    if (U.studio === 'banners')  return nav + studioBanners(EV);
    return nav + studioPosts(EV);
  }

  function studioMailers(EV){
    if (!D.templates.length){
      return panel('Mailer templates','', empty(I.mail,'No templates yet',
        'Templates are the reusable message bodies campaigns are built from.',
        '<button class="btn btn-primary btn-sm" type="button" data-newtpl="1" style="margin-top:6px">Create the first template</button>'));
    }
    var rows = D.templates.map(function(t){
      return '<div class="mrow" data-opentpl="'+t.id+'">' +
        '<span class="mrow-i" style="background:'+(t.channel==='email'?'var(--info)':'var(--ok)')+'1F;color:'+
          (t.channel==='email'?'var(--info)':'var(--ok)')+'">'+svg(t.channel==='email'?I.mail:I.wa,15)+'</span>' +
        '<span class="mrow-t"><b>'+esc(t.name)+'</b>' +
          '<span>'+(t.channel==='email' ? esc(t.subject||'No subject') : 'WhatsApp')+' &middot; edited '+ago(t.updated)+'</span></span>' +
        '<span class="mrow-a">' +
          '<button class="rowbtn" type="button" data-duptpl="'+t.id+'" title="Duplicate">'+svg(I.copy,14)+'</button>' +
          '<button class="rowbtn" type="button" data-deltpl="'+t.id+'" title="Delete">'+svg(I.trash,14)+'</button>' +
        '</span></div>';
    }).join('');

    return panel('Mailer templates', D.templates.length + ' saved', '<div>' + rows + '</div>',
      '<button class="btn btn-primary btn-sm" type="button" data-newtpl="1">'+svg(I.plus,13)+' New template</button>');
  }

  function studioBanners(EV){
    var live = D.banners.filter(function(b){ return b.status==='live'; });
    var imp = D.banners.reduce(function(n,b){ return n + b.impressions; }, 0);
    var clk = D.banners.reduce(function(n,b){ return n + b.clicks; }, 0);

    var tiles = '<div class="kpi-row" style="margin-bottom:16px">' +
      kpi(I.eye,'var(--info)','Impressions', compact(imp), comma(live.length)+' placements live') +
      kpi(I.click,'var(--accent)','Clicks', compact(clk), (imp ? (clk/imp*100).toFixed(2) : '0')+'% CTR') +
      kpi(I.users,'var(--ok)','Registrations from banners', comma(Math.round(clk*0.04)), 'attributed last-click') +
    '</div>';

    var rows = D.banners.map(function(b){
      var tone = b.status==='live' ? 'b-ok' : b.status==='paused' ? 'b-mute' : 'b-warn';
      return '<tr data-openban="'+b.id+'">' +
        '<td><b>'+esc(b.name)+'</b></td>' +
        '<td class="num">'+esc(b.size)+'</td>' +
        '<td><span class="badge '+tone+'">'+esc(b.status)+'</span></td>' +
        '<td style="color:var(--text-muted)">'+esc(b.placement)+'</td>' +
        '<td class="num">'+comma(b.impressions)+'</td>' +
        '<td class="num">'+comma(b.clicks)+'</td>' +
        '<td style="text-align:right;white-space:nowrap">' +
          '<button class="rowbtn" type="button" data-toggleban="'+b.id+'" title="Pause or resume">'+
            svg(b.status==='live'?I.x:I.check,14)+'</button>' +
          '<button class="rowbtn" type="button" data-delban="'+b.id+'" title="Delete">'+svg(I.trash,14)+'</button>' +
        '</td></tr>';
    }).join('');

    return tiles + panel('Placements', D.banners.length + ' total',
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>Placement</th><th>Size</th><th>Status</th><th>Runs on</th><th>Impressions</th><th>Clicks</th><th></th>' +
      '</tr></thead><tbody>'+rows+'</tbody></table></div>',
      '<button class="btn btn-primary btn-sm" type="button" data-newban="1">'+svg(I.plus,13)+' New banner</button>');
  }

  function studioPosts(EV){
    var cards = D.posts.map(function(p){
      var tone = p.status==='published' ? 'b-ok' : p.status==='draft' ? 'b-mute' : 'b-warn';
      return '<div class="pcard">' +
        '<div class="pcard-h">' +
          '<span class="mrow-i" style="background:#0A66C21F;color:#0A66C2">'+svg(I.li,15)+'</span>' +
          '<span style="flex:1;min-width:0"><b style="font-size:13.5px;display:block">'+esc(p.title)+'</b>' +
          '<span style="font-size:11.5px;color:var(--text-muted)">LinkedIn &middot; '+
          (p.when ? ago(p.when) : 'not scheduled')+'</span></span>' +
          '<span class="badge '+tone+'">'+esc(p.status)+'</span>' +
        '</div>' +
        '<div class="pcard-b">'+esc(merge(p.body, null, EV))+'</div>' +
        '<div class="pcard-f">' +
          (p.status==='published'
            ? '<span>'+comma(p.impressions)+' impressions &middot; '+comma(p.engagements)+' engagements</span>'
            : '<span style="color:var(--text-faint)">Not published yet</span>') +
          '<span style="flex:1"></span>' +
          '<button class="rowbtn" type="button" data-openpost="'+p.id+'" title="Edit">'+svg(I.edit,14)+'</button>' +
          (p.status!=='published' ? '<button class="btn btn-secondary btn-sm" type="button" data-pubpost="'+p.id+'">Publish</button>' : '') +
        '</div></div>';
    }).join('');

    return panel('Social posts', D.posts.length + ' created',
      '<div class="pgrid">' + (cards || empty(I.li,'No posts yet','Write a LinkedIn post to promote this event.')) + '</div>',
      '<button class="btn btn-primary btn-sm" type="button" data-newpost="1">'+svg(I.plus,13)+' New post</button>');
  }

  /* ======================================================================
     MODULE 2 : AUDIENCES  (prospect pool + saved batches)
     ====================================================================== */
  function matchBatch(p, f){
    if (f.seniority.length && f.seniority.indexOf(p.seniority) < 0) return false;
    if (f.industry.length  && f.industry.indexOf(p.industry) < 0) return false;
    if (f.city.length      && f.city.indexOf(p.city) < 0) return false;
    if (f.comp.length      && f.comp.indexOf(p.comp) < 0) return false;
    if (f.sub.length       && f.sub.indexOf(p.sub) < 0) return false;
    if (f.minScore && p.score < f.minScore) return false;
    if (f.unregisteredOnly && p.registered) return false;
    /* an unsubscribed contact is never mailable, whatever the filter says */
    if (p.sub === 'unsubscribed') return false;
    return true;
  }
  function batchMembers(EV, b){
    return prospects(EV).filter(function(p){ return matchBatch(p, b.f); });
  }
  function emptyFilters(){
    return { seniority:[], industry:[], city:[], comp:[], sub:[], minScore:0, unregisteredOnly:false };
  }

  function audiencesHTML(ctx){
    var EV = ctx.EV, all = prospects(EV);
    var mailable = all.filter(function(p){ return p.sub !== 'unsubscribed'; });
    var active = all.filter(function(p){ return p.sub === 'active'; });

    var tiles = '<div class="kpi-row" style="margin-bottom:16px">' +
      kpi(I.users,'var(--info)','Prospect pool', comma(all.length), comma(mailable.length)+' mailable') +
      kpi(I.star,'var(--ok)','Active subscribers', comma(active.length),
          Math.round(active.length/Math.max(all.length,1)*100)+'% of the pool') +
      kpi(I.layers,'var(--review)','Saved batches', comma(D.batches.length), 'reusable audience cuts') +
      kpi(I.check,'var(--warn)','Already registered', comma(all.filter(function(p){ return p.registered; }).length),
          'exclude them when prospecting') +
    '</div>';

    var batchRows = D.batches.length ? D.batches.map(function(b){
      var n = batchMembers(EV, b).length;
      return '<div class="mrow">' +
        '<span class="mrow-i" style="background:var(--review)1F;color:var(--review)">'+svg(I.layers,15)+'</span>' +
        '<span class="mrow-t"><b>'+esc(b.name)+'</b><span>'+describeBatch(b)+' &middot; built '+ago(b.created)+'</span></span>' +
        '<span class="num" style="font-weight:700;margin-right:8px">'+comma(n)+'</span>' +
        '<span class="mrow-a">' +
          '<button class="btn btn-secondary btn-sm" type="button" data-usebatch="'+b.id+'">Send to this</button>' +
          '<button class="rowbtn" type="button" data-editbatch="'+b.id+'" title="Edit">'+svg(I.edit,14)+'</button>' +
          '<button class="rowbtn" type="button" data-delbatch="'+b.id+'" title="Delete">'+svg(I.trash,14)+'</button>' +
        '</span></div>';
    }).join('') : empty(I.layers,'No batches yet',
      'A batch is a saved cut of the prospect pool - by seniority, industry, city or how engaged they are.',
      '<button class="btn btn-primary btn-sm" type="button" data-newbatch="1" style="margin-top:6px">Build the first batch</button>');

    /* pool preview */
    var q = U.audQ.toLowerCase();
    var rows = all.filter(function(p){
      return !q || (p.name+' '+p.comp+' '+p.desig+' '+p.city+' '+p.industry).toLowerCase().indexOf(q) >= 0;
    });
    var per = 12, pages = Math.max(1, Math.ceil(rows.length / per));
    if (U.audPage > pages) U.audPage = pages;
    var from = (U.audPage - 1) * per;
    var body = rows.slice(from, from + per).map(function(p){
      var st = subState(p.sub);
      return '<tr>' +
        '<td><span class="person"><span class="avat" style="background:'+p.colour+'">'+esc(p.initials)+'</span>' +
          '<span class="pn"><b>'+esc(p.name)+'</b><span class="em">'+esc(p.desig)+'</span></span></span></td>' +
        '<td>'+esc(p.comp)+'</td>' +
        '<td>'+esc(p.industry)+'</td>' +
        '<td class="nw">'+esc(p.city)+'</td>' +
        '<td><span class="badge" style="background:'+st.colour+'1F;color:'+st.colour+'">'+st.label+'</span></td>' +
        '<td class="num"><b>'+p.score+'</b></td>' +
        '<td class="nw">'+(p.registered?'<span class="badge b-ok">Registered</span>':'<span class="badge b-mute">Prospect</span>')+'</td>' +
      '</tr>';
    }).join('');

    return tiles +
      panel('Saved batches', D.batches.length + ' reusable', '<div>'+batchRows+'</div>',
        '<button class="btn btn-primary btn-sm" type="button" data-newbatch="1">'+svg(I.plus,13)+' Build a batch</button>') +
      panel('Prospect pool', comma(rows.length) + ' of ' + comma(all.length) + ' shown',
        '<div class="toolbar"><span class="search">'+svg(I.search,15)+
          '<input id="aud-q" placeholder="Search name, company, industry, city…" value="'+esc(U.audQ)+'"></span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>Person</th><th>Company</th><th>Industry</th><th>City</th><th>Subscriber</th><th>Score</th><th>Status</th>' +
        '</tr></thead><tbody>'+(body || '<tr><td colspan="7">'+empty(I.search,'Nothing matches','Try a different search.')+'</td></tr>')+'</tbody></table></div>' +
        '<div class="pager"><span class="cnt">Showing '+(rows.length?from+1:0)+' to '+Math.min(from+per,rows.length)+' of '+comma(rows.length)+'</span>' +
        '<button class="pg-btn" data-audpage="'+(U.audPage-1)+'"'+(U.audPage<=1?' disabled':'')+'>&lsaquo;</button>' +
        '<span style="padding:0 8px">'+U.audPage+' / '+pages+'</span>' +
        '<button class="pg-btn" data-audpage="'+(U.audPage+1)+'"'+(U.audPage>=pages?' disabled':'')+'>&rsaquo;</button></div>');
  }

  function describeBatch(b){
    var f = b.f, bits = [];
    if (f.seniority.length) bits.push(f.seniority.join(', '));
    if (f.industry.length)  bits.push(f.industry.join(', '));
    if (f.city.length)      bits.push(f.city.join(', '));
    if (f.comp.length)      bits.push(f.comp.length + ' companies');
    if (f.sub.length)       bits.push(f.sub.map(function(s){ return subState(s).label; }).join('/'));
    if (f.minScore)         bits.push('score ' + f.minScore + '+');
    if (f.unregisteredOnly) bits.push('not yet registered');
    return bits.length ? esc(bits.join(' · ')) : 'Everyone mailable';
  }

  /* ======================================================================
     MODULE 3 : CAMPAIGNS
     ====================================================================== */
  function campaignsHTML(ctx){
    var EV = ctx.EV;
    var sent = D.campaigns.filter(function(c){ return c.status==='sent'; });
    var tot = sent.reduce(function(a,c){
      a.sent += c.sent; a.opened += c.opened; a.clicked += c.clicked; a.regs += c.regs; return a;
    }, { sent:0, opened:0, clicked:0, regs:0 });

    var tiles = '<div class="kpi-row" style="margin-bottom:16px">' +
      kpi(I.send,'var(--accent)','Messages sent', compact(tot.sent), comma(sent.length)+' campaigns out') +
      kpi(I.eye,'var(--info)','Open rate', (tot.sent ? Math.round(tot.opened/tot.sent*100) : 0)+'%', comma(tot.opened)+' opens') +
      kpi(I.click,'var(--ok)','Click rate', (tot.opened ? Math.round(tot.clicked/tot.opened*100) : 0)+'%', comma(tot.clicked)+' clicks') +
      kpi(I.users,'var(--review)','Registrations driven', comma(tot.regs),
          (tot.sent ? (tot.regs/tot.sent*100).toFixed(1) : '0')+'% of everyone mailed') +
    '</div>';

    if (!D.campaigns.length){
      return tiles + panel('Campaigns','', empty(I.send,'No campaigns yet',
        'A campaign is a template sent to a batch. Build a batch first, then send to it.',
        '<button class="btn btn-primary btn-sm" type="button" data-newcamp="1" style="margin-top:6px">New campaign</button>'));
    }

    var rows = D.campaigns.slice().sort(function(a,b){ return b.when - a.when; }).map(function(c){
      var b = D.batches.filter(function(x){ return x.id===c.batchId; })[0];
      var t = D.templates.filter(function(x){ return x.id===c.templateId; })[0];
      var tone = c.status==='sent' ? 'b-ok' : c.status==='scheduled' ? 'b-warn' : 'b-mute';
      function bar(label, n, base, colour){
        var pct = base ? Math.round(n/base*100) : 0;
        return '<div class="cb"><div class="cbl"><b>'+label+'</b><span>'+comma(n)+' &middot; '+pct+'%</span></div>' +
          '<div class="cbt"><i style="width:'+pct+'%;background:'+colour+'"></i></div></div>';
      }
      return '<div class="camp">' +
        '<div class="camp-top">' +
          '<span class="camp-ico" style="background:'+(c.channel==='email'?'var(--info)':'var(--ok)')+'1F;color:'+
            (c.channel==='email'?'var(--info)':'var(--ok)')+'">'+svg(c.channel==='email'?I.mail:I.wa,15)+'</span>' +
          '<span class="camp-t"><b>'+esc(c.name)+'</b><span>' +
            (t ? esc(t.name) : 'template removed') + ' &rarr; ' + (b ? esc(b.name) : 'batch removed') +
            ' &middot; ' + (c.status==='scheduled' ? 'goes out '+ago(c.when) : ago(c.when)) + '</span></span>' +
          '<span class="badge '+tone+'">'+esc(c.status)+'</span>' +
          '<span class="camp-n">'+comma(c.sent)+'</span>' +
          (c.status==='scheduled'
            ? '<button class="btn btn-primary btn-sm" type="button" data-sendnow="'+c.id+'">Send now</button>'
            : '') +
          '<button class="rowbtn" type="button" data-delcamp="'+c.id+'" title="Delete">'+svg(I.trash,14)+'</button>' +
        '</div>' +
        (c.status==='sent'
          ? '<div class="camp-bars">' +
              bar('Delivered', c.delivered, c.sent, 'var(--ok)') +
              bar(c.channel==='email'?'Opened':'Read', c.opened, c.delivered, 'var(--info)') +
              bar('Clicked', c.clicked, c.delivered, 'var(--accent)') +
              bar('Registered', c.regs, c.clicked, 'var(--review)') +
            '</div>'
          : '<p class="hint" style="margin:0">Scheduled. Nothing has gone out yet.</p>') +
      '</div>';
    }).join('');

    var best = sent.slice().sort(function(a,b){
      return (b.regs/Math.max(b.sent,1)) - (a.regs/Math.max(a.sent,1));
    })[0];

    return tiles +
      (best ? '<div class="callout info" style="margin-bottom:16px">'+svg(I.info,17)+
        '<span><strong>&ldquo;'+esc(best.name)+'&rdquo; is your best converter</strong>' +
        comma(best.regs)+' registrations from '+comma(best.sent)+' sent ('+
        (best.regs/best.sent*100).toFixed(1)+'%). Worth repeating the angle on a fresh batch.</span></div>' : '') +
      panel('Campaigns', D.campaigns.length + ' total', '<div>'+rows+'</div>',
        '<button class="btn btn-primary btn-sm" type="button" data-newcamp="1">'+svg(I.plus,13)+' New campaign</button>');
  }

  /* ======================================================================
     MODULE 4 : DATA PIPELINE
     ====================================================================== */
  function pipelineHTML(ctx){
    var EV = ctx.EV, eds = editions(EV), all = prospects(EV);
    var cur = eds[0], past = eds.slice(1);

    var totRegs = eds.reduce(function(n,e){ return n + e.regs; }, 0);
    var totVis  = eds.reduce(function(n,e){ return n + e.visitors; }, 0);
    var totRev  = eds.reduce(function(n,e){ return n + e.revenue; }, 0);
    var loyal   = all.filter(function(p){ return p.editions >= 2; }).length;

    var tiles = '<div class="kpi-row" style="margin-bottom:16px">' +
      kpi(I.users,'var(--info)','Registrations, all editions', comma(totRegs),
          comma(cur.regs)+' this edition') +
      kpi(I.eye,'var(--ok)','Site visitors, all editions', compact(totVis),
          compact(cur.visitors)+' this edition') +
      kpi(I.money,'var(--review)','Revenue, all editions', compact(totRev),
          comma(eds.reduce(function(n,e){ return n + e.paid; },0))+' paid delegates') +
      kpi(I.star,'var(--accent)','Repeat attendees', comma(loyal),
          'been to 2+ editions - your warmest list') +
    '</div>';

    var edRows = eds.map(function(e){
      var conv = e.visitors ? (e.regs/e.visitors*100) : 0;
      return '<tr>' +
        '<td><b>'+esc(String(e.year))+'</b>'+(e.current?' <span class="badge b-accent">This edition</span>':'')+'</td>' +
        '<td style="color:var(--text-muted)">'+esc(e.label)+'</td>' +
        '<td class="num">'+comma(e.regs)+'</td>' +
        '<td class="num">'+compact(e.visitors)+'</td>' +
        '<td class="num">'+conv.toFixed(1)+'%</td>' +
        '<td class="num">'+comma(e.paid)+'</td>' +
        '<td class="num">'+(e.revenue?compact(e.revenue):'-')+'</td>' +
        '<td class="num">'+comma(e.attended)+'</td>' +
        '<td>'+esc(e.channel)+'</td>' +
      '</tr>';
    }).join('');

    /* which channel earned registrations, across editions */
    var chanRows = tally(all.filter(function(p){ return p.registered; }), 'src');
    var indRows  = tally(all, 'industry');
    var subRows  = SUB_STATE.map(function(s){
      return { k:s.label, n: all.filter(function(p){ return p.sub===s.id; }).length, c:s.colour };
    });

    /* the prospect cuts worth pulling into a batch */
    var recipes = [
      { id:'loyal',    label:'Repeat attendees',  note:'Been to 2 or more past editions',
        n: all.filter(function(p){ return p.editions>=2 && p.sub!=='unsubscribed'; }).length },
      { id:'warmnotreg',label:'Warm but not registered', note:'Active subscribers who have not signed up yet',
        n: all.filter(function(p){ return p.sub==='active' && !p.registered; }).length },
      { id:'cxo',      label:'CXO tier',          note:'Chief-level across every industry',
        n: all.filter(function(p){ return p.seniority==='CXO' && p.sub!=='unsubscribed'; }).length },
      { id:'lapsed',   label:'Lapsed attendees',  note:'Came before, gone quiet since',
        n: all.filter(function(p){ return p.editions>=1 && p.sub==='dormant'; }).length }
    ];
    var recipeCards = '<div class="pgrid">' + recipes.map(function(r){
      return '<div class="pcard" style="cursor:pointer" data-recipe="'+r.id+'">' +
        '<div class="pcard-h"><span class="mrow-i" style="background:var(--accent)1F;color:var(--accent)">'+svg(I.layers,15)+'</span>' +
        '<span style="flex:1"><b style="font-size:13.5px;display:block">'+esc(r.label)+'</b>' +
        '<span style="font-size:11.5px;color:var(--text-muted)">'+esc(r.note)+'</span></span>' +
        '<span class="num" style="font-weight:800;font-size:15px">'+comma(r.n)+'</span></div>' +
        '<div class="pcard-f"><span style="flex:1"></span>' +
        '<span class="btn btn-secondary btn-sm">Save as a batch</span></div></div>';
    }).join('') + '</div>';

    return tiles +
      panel('Edition by edition', eds.length + ' editions on record',
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>Year</th><th>Edition</th><th>Registrations</th><th>Visitors</th><th>Visitor&rarr;reg</th>' +
        '<th>Paid</th><th>Revenue</th><th>Attended</th><th>Best channel</th>' +
        '</tr></thead><tbody>'+edRows+'</tbody></table></div>') +
      panel('Ready-made cuts', 'The four slices worth mailing, already counted', recipeCards) +
      '<div class="ins-grid">' +
        '<div class="ins-card"><h3>Where registrations came from</h3>' +
          '<div class="cap">Acquisition source across the pool</div>'+bars(chanRows,'var(--info)')+'</div>' +
        '<div class="ins-card"><h3>Industry mix</h3>' +
          '<div class="cap">What the addressable base looks like</div>'+bars(indRows,'var(--review)')+'</div>' +
        '<div class="ins-card"><h3>Subscriber health</h3>' +
          '<div class="cap">How much of the pool is still reachable</div>'+bars(subRows,'var(--ok)',4)+'</div>' +
      '</div>';
  }

  /* ======================================================================
     MODULE 5 : CRM
     ====================================================================== */
  var STAGES = [
    { id:'new',        label:'New',        colour:'#857F6A' },
    { id:'contacted',  label:'Contacted',  colour:'#2F6FB0' },
    { id:'interested', label:'Interested', colour:'#E89B0C' },
    { id:'registered', label:'Registered', colour:'#7C4DBE' },
    { id:'won',        label:'Won',        colour:'#12A870' },
    { id:'lost',       label:'Lost',       colour:'#ED1C24' }
  ];
  function stageById(id){
    for (var i=0;i<STAGES.length;i++) if (STAGES[i].id===id) return STAGES[i];
    return STAGES[0];
  }

  /* leads are the top of the prospect pool, given a stage and an owner */
  function leads(EV){
    var all = prospects(EV);
    var top = all.slice().sort(function(a,b){ return b.score - a.score; }).slice(0, 120);
    return top.map(function(p, i){
      var saved = D.crm[p.id];
      var s = EV.eventNo + i * 17;
      var stage = saved ? saved.stage
        : (p.paid ? 'won' : p.registered ? 'registered'
          : rnd(s) > 0.72 ? 'interested' : rnd(s) > 0.42 ? 'contacted' : 'new');
      return {
        id: p.id, p: p,
        stage: stage,
        owner: saved && saved.owner ? saved.owner : OWNERS[Math.floor(rnd(s+1) * OWNERS.length)],
        calls: saved && saved.calls != null ? saved.calls : Math.floor(rnd(s+2) * 6),
        notes: (saved && saved.notes) || [],
        next: saved && saved.next ? saved.next : '',
        touched: saved && saved.touched ? saved.touched : 0
      };
    });
  }
  function saveLead(l){
    D.crm[l.id] = { stage:l.stage, owner:l.owner, calls:l.calls, notes:l.notes, next:l.next, touched:Date.now() };
    save();
  }

  function crmFiltered(EV){
    var q = U.crmQ.toLowerCase();
    return leads(EV).filter(function(l){
      if (U.crmStage !== 'all' && l.stage !== U.crmStage) return false;
      if (U.crmOwner !== 'all' && l.owner !== U.crmOwner) return false;
      if (q && (l.p.name+' '+l.p.comp+' '+l.p.desig).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function crmHTML(ctx){
    var EV = ctx.EV, L = leads(EV), F = crmFiltered(EV);
    var counts = {};
    STAGES.forEach(function(s){ counts[s.id] = L.filter(function(l){ return l.stage===s.id; }).length; });
    var won = counts.won, open = L.length - counts.won - counts.lost;

    var tiles = '<div class="kpi-row" style="margin-bottom:16px">' +
      kpi(I.headset,'var(--info)','Leads in play', comma(open), comma(L.length)+' in the pipeline') +
      kpi(I.check,'var(--ok)','Won', comma(won),
          (L.length ? Math.round(won/L.length*100) : 0)+'% conversion') +
      kpi(I.phone,'var(--review)','Calls logged', comma(L.reduce(function(n,l){ return n+l.calls; },0)), 'across all owners') +
      kpi(I.clock,'var(--warn)','Follow-ups due', comma(L.filter(function(l){ return l.next; }).length), 'have a date set') +
    '</div>';

    var toolbar = '<div class="toolbar">' +
      '<span class="search">'+svg(I.search,15)+
        '<input id="crm-q" placeholder="Search a lead, company or role…" value="'+esc(U.crmQ)+'"></span>' +
      '<select class="inp" id="crm-stage" style="width:auto">' +
        '<option value="all"'+(U.crmStage==='all'?' selected':'')+'>Every stage</option>' +
        STAGES.map(function(s){
          return '<option value="'+s.id+'"'+(U.crmStage===s.id?' selected':'')+'>'+s.label+' ('+counts[s.id]+')</option>';
        }).join('') + '</select>' +
      '<select class="inp" id="crm-owner" style="width:auto">' +
        '<option value="all"'+(U.crmOwner==='all'?' selected':'')+'>Every owner</option>' +
        OWNERS.map(function(o){
          return '<option value="'+esc(o)+'"'+(U.crmOwner===o?' selected':'')+'>'+esc(o)+'</option>';
        }).join('') + '</select>' +
      '<span class="vswitch">' +
        '<button type="button" data-crmview="board" aria-pressed="'+(U.crmView==='board')+'">Board</button>' +
        '<button type="button" data-crmview="table" aria-pressed="'+(U.crmView==='table')+'">Table</button>' +
      '</span></div>';

    var body = U.crmView === 'board' ? crmBoard(F) : crmTable(F);

    return tiles + panel('Lead pipeline', comma(F.length) + ' of ' + comma(L.length) + ' shown', toolbar + body);
  }

  function crmBoard(F){
    return '<div class="board">' + STAGES.map(function(s){
      var items = F.filter(function(l){ return l.stage===s.id; });
      return '<div class="bcol">' +
        '<div class="bcol-h"><span class="bdot" style="background:'+s.colour+'"></span>' +
          '<b>'+s.label+'</b><span class="num">'+comma(items.length)+'</span></div>' +
        '<div class="bcol-b">' + (items.length ? items.slice(0, 20).map(function(l){
          return '<div class="lead" data-lead="'+l.id+'">' +
            '<div class="lead-t"><span class="avat" style="background:'+l.p.colour+';width:26px;height:26px;font-size:10px">'+
              esc(l.p.initials)+'</span><b>'+esc(l.p.name)+'</b></div>' +
            '<div class="lead-s">'+esc(l.p.desig)+'</div>' +
            '<div class="lead-s" style="color:var(--text-faint)">'+esc(l.p.comp)+'</div>' +
            '<div class="lead-f"><span>'+esc(l.owner.split(' ')[0])+'</span>' +
              '<span class="num">'+l.calls+' calls</span></div>' +
          '</div>';
        }).join('') : '<div class="bcol-e">Nothing here</div>') + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function crmTable(F){
    if (!F.length) return empty(I.search,'No leads match','Loosen the search, stage or owner filter.');
    var rows = F.slice(0, 60).map(function(l){
      var s = stageById(l.stage);
      return '<tr data-lead="'+l.id+'">' +
        '<td><span class="person"><span class="avat" style="background:'+l.p.colour+'">'+esc(l.p.initials)+'</span>' +
          '<span class="pn"><b>'+esc(l.p.name)+'</b><span class="em">'+esc(l.p.desig)+'</span></span></span></td>' +
        '<td>'+esc(l.p.comp)+'</td>' +
        '<td><span class="badge" style="background:'+s.colour+'1F;color:'+s.colour+'">'+s.label+'</span></td>' +
        '<td>'+esc(l.owner)+'</td>' +
        '<td class="num">'+l.calls+'</td>' +
        '<td class="num"><b>'+l.p.score+'</b></td>' +
        '<td class="nw">'+(l.next ? fmtDate(l.next) : '<span style="color:var(--text-faint)">-</span>')+'</td>' +
      '</tr>';
    }).join('');
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>Lead</th><th>Company</th><th>Stage</th><th>Owner</th><th>Calls</th><th>Score</th><th>Follow-up</th>' +
      '</tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  /* ======================================================================
     MODALS  (own layer, so both hosts behave the same)
     ====================================================================== */
  function layer(){
    var el = $('mkt-layer');
    if (!el){
      el = document.createElement('div');
      el.id = 'mkt-layer';
      document.body.appendChild(el);
    }
    return el;
  }
  function closeModal(){ layer().innerHTML = ''; }
  function modal(title, body, foot, width){
    layer().innerHTML =
      '<div class="modal-bg" id="mkt-bg"><div class="modal" style="width:min('+(width||620)+'px,100%)">' +
        '<div class="modal-head"><h3>'+esc(title)+'</h3>' +
          '<button class="btn btn-ghost btn-icon" type="button" id="mkt-x">'+svg(I.x,17)+'</button></div>' +
        '<div class="modal-body">'+body+'</div>' +
        (foot ? '<div class="modal-foot">'+foot+'</div>' : '') +
      '</div></div>';
    $('mkt-x').onclick = closeModal;
    $('mkt-bg').addEventListener('click', function(e){ if (e.target.id === 'mkt-bg') closeModal(); });
  }

  /* ---------------------------------------------------------------- template editor */
  function editTemplate(id, ctx){
    var EV = ctx.EV;
    var t = id ? D.templates.filter(function(x){ return x.id===id; })[0] : null;
    var isNew = !t;
    if (isNew) t = { id:uid('t'), name:'', channel:'email', subject:'', body:'', updated:Date.now() };
    var sample = prospects(EV)[0];

    modal(isNew ? 'New mailer template' : 'Edit template',
      '<div class="frow">' +
        '<div class="field c8"><label for="tp-name">Template name</label>' +
          '<input class="inp" id="tp-name" value="'+esc(t.name)+'" placeholder="e.g. Final call"></div>' +
        '<div class="field c4"><label for="tp-chan">Channel</label>' +
          '<select class="inp" id="tp-chan">' +
            '<option value="email"'+(t.channel==='email'?' selected':'')+'>Email</option>' +
            '<option value="whatsapp"'+(t.channel==='whatsapp'?' selected':'')+'>WhatsApp</option>' +
          '</select></div>' +
        '<div class="field c12" id="tp-sub-wrap"'+(t.channel==='email'?'':' hidden')+'>' +
          '<label for="tp-sub">Subject</label>' +
          '<input class="inp" id="tp-sub" value="'+esc(t.subject)+'"></div>' +
        '<div class="field c12"><label for="tp-body">Message</label>' +
          '<textarea class="inp" id="tp-body" style="min-height:170px">'+esc(t.body)+'</textarea>' +
          '<div class="mergebar">' +
            ['{{first}}','{{name}}','{{company}}','{{industry}}','{{event}}','{{date}}','{{venue}}'].map(function(m){
              return '<button type="button" data-tmerge="'+m+'">'+m+'</button>';
            }).join('') + '</div></div>' +
        '<div class="field c12"><label>Preview &mdash; as '+esc(sample.name)+'</label>' +
          '<div class="preview" id="tp-prev">'+esc(merge(t.body, sample, EV))+'</div></div>' +
      '</div>',
      '<button class="btn btn-ghost" type="button" id="tp-cancel">Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="tp-save">'+(isNew?'Create template':'Save changes')+'</button>', 640);

    var nameEl = $('tp-name'), chanEl = $('tp-chan'), subEl = $('tp-sub'), bodyEl = $('tp-body');
    function refresh(){ $('tp-prev').textContent = merge(bodyEl.value, sample, EV); }
    bodyEl.oninput = refresh;
    chanEl.onchange = function(){ $('tp-sub-wrap').hidden = chanEl.value !== 'email'; };
    each('[data-tmerge]', function(el){
      el.onclick = function(){
        var tag = el.getAttribute('data-tmerge');
        var pos = bodyEl.selectionStart || bodyEl.value.length;
        bodyEl.value = bodyEl.value.slice(0,pos) + tag + bodyEl.value.slice(pos);
        bodyEl.focus(); bodyEl.setSelectionRange(pos+tag.length, pos+tag.length);
        refresh();
      };
    });
    $('tp-cancel').onclick = closeModal;
    $('tp-save').onclick = function(){
      if (!nameEl.value.trim()){ ctx.toast('Give the template a name'); nameEl.focus(); return; }
      t.name = nameEl.value.trim(); t.channel = chanEl.value;
      t.subject = subEl ? subEl.value : ''; t.body = bodyEl.value; t.updated = Date.now();
      if (isNew) D.templates.unshift(t);
      save(); closeModal(); redraw();
      ctx.toast(isNew ? 'Template created' : 'Template saved');
    };
  }

  /* ---------------------------------------------------------------- banner editor */
  function editBanner(id, ctx){
    var b = id ? D.banners.filter(function(x){ return x.id===id; })[0] : null;
    var isNew = !b;
    if (isNew) b = { id:uid('b'), name:'', size:'300 x 250', placement:'', status:'scheduled', impressions:0, clicks:0 };

    modal(isNew ? 'New banner placement' : 'Edit placement',
      '<div class="frow">' +
        '<div class="field c8"><label for="bn-name">Placement name</label>' +
          '<input class="inp" id="bn-name" value="'+esc(b.name)+'" placeholder="e.g. Homepage takeover"></div>' +
        '<div class="field c4"><label for="bn-size">Creative size</label>' +
          '<select class="inp" id="bn-size">' +
            ['1440 x 400','970 x 250','728 x 90','300 x 250','600 x 120'].map(function(s){
              return '<option'+(b.size===s?' selected':'')+'>'+s+'</option>';
            }).join('') + '</select></div>' +
        '<div class="field c8"><label for="bn-place">Runs on</label>' +
          '<input class="inp" id="bn-place" value="'+esc(b.placement)+'" placeholder="e.g. ETBrandEquity homepage"></div>' +
        '<div class="field c4"><label for="bn-status">Status</label>' +
          '<select class="inp" id="bn-status">' +
            ['live','scheduled','paused'].map(function(s){
              return '<option'+(b.status===s?' selected':'')+'>'+s+'</option>';
            }).join('') + '</select></div>' +
        '<div class="field c12"><label>Creative</label>' +
          '<div style="border:1.5px dashed var(--border);border-radius:11px;padding:22px;text-align:center;color:var(--text-muted)">' +
          svg(I.image,22)+'<div style="font-size:12.5px;font-weight:700;margin-top:5px">Upload the creative</div>' +
          '<div style="font-size:11px;color:var(--text-faint)">JPG, PNG or HTML5 &middot; under 150 KB</div></div></div>' +
      '</div>',
      '<button class="btn btn-ghost" type="button" id="bn-cancel">Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="bn-save">'+(isNew?'Create placement':'Save changes')+'</button>', 600);

    $('bn-cancel').onclick = closeModal;
    $('bn-save').onclick = function(){
      if (!$('bn-name').value.trim()){ ctx.toast('Give the placement a name'); return; }
      b.name = $('bn-name').value.trim(); b.size = $('bn-size').value;
      b.placement = $('bn-place').value.trim() || 'Run of network'; b.status = $('bn-status').value;
      if (isNew) D.banners.unshift(b);
      save(); closeModal(); redraw();
      ctx.toast(isNew ? 'Placement created' : 'Placement saved');
    };
  }

  /* ---------------------------------------------------------------- post editor */
  function editPost(id, ctx){
    var EV = ctx.EV;
    var p = id ? D.posts.filter(function(x){ return x.id===id; })[0] : null;
    var isNew = !p;
    if (isNew) p = { id:uid('p'), channel:'linkedin', title:'', status:'draft', body:'', when:0, impressions:0, engagements:0 };

    modal(isNew ? 'New social post' : 'Edit post',
      '<div class="frow">' +
        '<div class="field c12"><label for="ps-title">Post name</label>' +
          '<input class="inp" id="ps-title" value="'+esc(p.title)+'" placeholder="e.g. Speaker reveal"></div>' +
        '<div class="field c12"><label for="ps-body">Copy</label>' +
          '<textarea class="inp" id="ps-body" style="min-height:150px">'+esc(p.body)+'</textarea></div>' +
        '<div class="field c12"><label>How it will look</label>' +
          '<div style="border:1px solid var(--border);border-radius:11px;overflow:hidden;max-width:440px">' +
            '<div style="padding:12px 13px;display:flex;gap:9px;align-items:center;border-bottom:1px solid var(--border)">' +
              '<span style="width:34px;height:34px;border-radius:50%;background:#0A66C2;color:#fff;display:grid;place-items:center;font-weight:800;font-size:12px">ET</span>' +
              '<span><b style="font-size:12.5px;display:block">ET Oneworld</b>' +
              '<span style="font-size:11px;color:var(--text-muted)">Promoted &middot; now</span></span></div>' +
            '<div style="padding:13px;font-size:13px;line-height:1.6;white-space:pre-wrap" id="ps-prev">'+
              esc(merge(p.body, null, EV))+'</div>' +
            '<div style="height:120px;background:var(--accent);display:grid;place-items:center;color:#fff;font-family:var(--font-display);font-size:16px;font-weight:700;text-align:center;padding:14px">'+
              esc(EV.name)+'</div>' +
          '</div></div>' +
      '</div>',
      '<button class="btn btn-ghost" type="button" id="ps-cancel">Cancel</button>' +
      '<button class="btn btn-secondary" type="button" id="ps-draft">Save as draft</button>' +
      '<button class="btn btn-primary" type="button" id="ps-pub">Publish now</button>', 620);

    var bodyEl = $('ps-body');
    bodyEl.oninput = function(){ $('ps-prev').textContent = merge(bodyEl.value, null, EV); };
    function commit(status){
      if (!$('ps-title').value.trim()){ ctx.toast('Give the post a name'); return; }
      p.title = $('ps-title').value.trim(); p.body = bodyEl.value; p.status = status;
      if (status === 'published'){
        p.when = Date.now();
        p.impressions = 1200 + Math.floor(Math.random()*3600);
        p.engagements = Math.floor(p.impressions * (0.02 + Math.random()*0.04));
      }
      if (isNew) D.posts.unshift(p);
      save(); closeModal(); redraw();
      ctx.toast(status === 'published' ? 'Post published' : 'Draft saved');
    }
    $('ps-cancel').onclick = closeModal;
    $('ps-draft').onclick = function(){ commit('draft'); };
    $('ps-pub').onclick   = function(){ commit('published'); };
  }

  /* ---------------------------------------------------------------- batch builder */
  function editBatch(id, ctx){
    var EV = ctx.EV;
    var b = id ? D.batches.filter(function(x){ return x.id===id; })[0] : null;
    var isNew = !b;
    if (isNew) b = { id:uid('g'), name:'', f:emptyFilters(), created:Date.now() };
    U.builder = { id:b.id, name:b.name, f:JSON.parse(JSON.stringify(b.f)), isNew:isNew, ref:b };
    drawBatch(ctx);
  }

  function drawBatch(ctx){
    var EV = ctx.EV, B = U.builder, all = prospects(EV);
    var n = all.filter(function(p){ return matchBatch(p, B.f); }).length;
    var unsub = all.filter(function(p){ return p.sub==='unsubscribed'; }).length;

    function facet(key, title, values){
      var counts = {};
      all.forEach(function(p){ counts[p[key]] = (counts[p[key]]||0) + 1; });
      var list = values || Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; });
      return '<div class="facet"><h4>'+esc(title)+'</h4><div class="facet-list">' +
        list.map(function(v){
          var on = B.f[key].indexOf(v) >= 0;
          return '<label class="fopt"><input type="checkbox" data-bf="'+key+'" value="'+esc(v)+'"'+(on?' checked':'')+'>' +
            '<span class="fl">'+esc(v)+'</span><span class="fc">'+comma(counts[v]||0)+'</span></label>';
        }).join('') + '</div></div>';
    }
    var subFacet = '<div class="facet"><h4>Subscriber state</h4><div class="facet-list">' +
      SUB_STATE.filter(function(s){ return s.id!=='unsubscribed'; }).map(function(s){
        var on = B.f.sub.indexOf(s.id) >= 0;
        var cnt = all.filter(function(p){ return p.sub===s.id; }).length;
        return '<label class="fopt"><input type="checkbox" data-bf="sub" value="'+s.id+'"'+(on?' checked':'')+'>' +
          '<span class="fl"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+
          s.colour+';margin-right:6px"></span>'+s.label+' <span style="color:var(--text-faint)">&middot; '+esc(s.note)+'</span></span>' +
          '<span class="fc">'+comma(cnt)+'</span></label>';
      }).join('') + '</div></div>';

    modal(B.isNew ? 'Build an audience batch' : 'Edit batch',
      '<div class="field" style="margin-bottom:16px"><label for="bt-name">Batch name</label>' +
        '<input class="inp" id="bt-name" value="'+esc(B.name)+'" placeholder="e.g. CXOs in BFSI, Mumbai"></div>' +
      '<div class="facets">' +
        facet('seniority','Seniority', SENIORITY) +
        facet('industry','Industry', INDUSTRIES) +
        facet('city','City') +
        subFacet +
      '</div>' +
      '<div class="frow" style="margin-top:16px">' +
        '<div class="field c6"><label for="bt-score">Minimum engagement score</label>' +
          '<input class="inp" id="bt-score" type="number" min="0" max="100" value="'+(B.f.minScore||0)+'">' +
          '<p class="hint">Opens, clicks, past editions and seniority, rolled into one number out of 100.</p></div>' +
        '<div class="field c6"><label>&nbsp;</label>' +
          '<label class="skipline"><input type="checkbox" id="bt-unreg"'+(B.f.unregisteredOnly?' checked':'')+'>' +
          'Only people not yet registered</label></div>' +
      '</div>' +
      '<div class="willdo" style="margin-top:8px">'+svg(I.users,17)+
        '<span><b>'+comma(n)+' people in this batch</b>' +
        'Out of '+comma(all.length)+' in the pool. '+comma(unsub)+' unsubscribed contacts are excluded automatically and can never be added back.</span></div>',
      '<button class="btn btn-ghost" type="button" id="bt-cancel">Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="bt-save"'+(n?'':' disabled')+'>' +
        (B.isNew ? 'Save batch of '+comma(n) : 'Save changes') + '</button>', 720);

    $('bt-name').oninput = function(){ B.name = this.value; };
    each('[data-bf]', function(el){
      el.onchange = function(){
        var k = el.getAttribute('data-bf'), v = el.value;
        if (el.checked){ if (B.f[k].indexOf(v) < 0) B.f[k].push(v); }
        else B.f[k] = B.f[k].filter(function(x){ return x !== v; });
        B.name = $('bt-name').value;
        B.f.minScore = Number($('bt-score').value) || 0;
        B.f.unregisteredOnly = $('bt-unreg').checked;
        drawBatch(ctx);
      };
    });
    $('bt-score').onchange = function(){ B.f.minScore = Number(this.value)||0; B.name = $('bt-name').value; drawBatch(ctx); };
    $('bt-unreg').onchange = function(){ B.f.unregisteredOnly = this.checked; B.name = $('bt-name').value; drawBatch(ctx); };
    $('bt-cancel').onclick = closeModal;
    $('bt-save').onclick = function(){
      var name = $('bt-name').value.trim();
      if (!name){ ctx.toast('Give the batch a name'); $('bt-name').focus(); return; }
      B.ref.name = name; B.ref.f = B.f; B.ref.created = Date.now();
      if (B.isNew) D.batches.unshift(B.ref);
      save(); closeModal(); U.builder = null; redraw();
      ctx.toast('Batch saved with ' + comma(n) + ' people');
    };
  }

  /* ---------------------------------------------------------------- campaign builder */
  function newCampaign(batchId, ctx){
    var EV = ctx.EV;
    if (!D.batches.length){
      ctx.toast('Build an audience batch first');
      CUR.tab = 'audiences';
      return;
    }
    var st = { name:'', batchId: batchId || D.batches[0].id, templateId: D.templates[0] && D.templates[0].id, when:'now' };

    function draw(){
      var b = D.batches.filter(function(x){ return x.id===st.batchId; })[0];
      var t = D.templates.filter(function(x){ return x.id===st.templateId; })[0];
      var n = b ? batchMembers(EV, b).length : 0;
      var sample = b ? batchMembers(EV, b)[0] : null;

      modal('New campaign',
        '<div class="frow">' +
          '<div class="field c12"><label for="cp-name">Campaign name</label>' +
            '<input class="inp" id="cp-name" value="'+esc(st.name)+'" placeholder="e.g. Final call to CXOs"></div>' +
          '<div class="field c6"><label for="cp-batch">Send to</label>' +
            '<select class="inp" id="cp-batch">' + D.batches.map(function(x){
              return '<option value="'+x.id+'"'+(st.batchId===x.id?' selected':'')+'>'+esc(x.name)+
                ' ('+comma(batchMembers(EV,x).length)+')</option>';
            }).join('') + '</select></div>' +
          '<div class="field c6"><label for="cp-tpl">Template</label>' +
            '<select class="inp" id="cp-tpl">' + D.templates.map(function(x){
              return '<option value="'+x.id+'"'+(st.templateId===x.id?' selected':'')+'>'+esc(x.name)+
                ' ('+(x.channel==='email'?'Email':'WhatsApp')+')</option>';
            }).join('') + '</select></div>' +
          '<div class="field c12"><label for="cp-when">When</label>' +
            '<select class="inp" id="cp-when">' +
              '<option value="now"'+(st.when==='now'?' selected':'')+'>Send immediately</option>' +
              '<option value="tomorrow"'+(st.when==='tomorrow'?' selected':'')+'>Schedule for tomorrow</option>' +
              '<option value="week"'+(st.when==='week'?' selected':'')+'>Schedule in a week</option>' +
            '</select></div>' +
          (t ? '<div class="field c12"><label>Preview'+(sample?' &mdash; as '+esc(sample.name):'')+'</label>' +
            (t.channel==='email' && t.subject
              ? '<div style="font-size:12.5px;font-weight:700;margin-bottom:6px">'+esc(merge(t.subject, sample, EV))+'</div>'
              : '') +
            '<div class="preview">'+esc(merge(t.body, sample, EV))+'</div></div>' : '') +
        '</div>' +
        '<div class="willdo" style="margin-top:6px">'+svg(t && t.channel==='whatsapp'?I.wa:I.mail,17)+
          '<span><b>'+comma(n)+' recipients</b>' +
          (b ? esc(b.name)+' &middot; '+describeBatch(b) : 'no batch') +
          '. Unsubscribed contacts are already excluded.</span></div>',
        '<button class="btn btn-ghost" type="button" id="cp-cancel">Cancel</button>' +
        '<button class="btn btn-primary" type="button" id="cp-go"'+(n && t?'':' disabled')+'>' +
          svg(I.send,14)+' '+(st.when==='now' ? 'Send to '+comma(n) : 'Schedule for '+comma(n))+'</button>', 640);

      $('cp-name').oninput  = function(){ st.name = this.value; };
      $('cp-batch').onchange = function(){ st.batchId = this.value; st.name = $('cp-name').value; draw(); };
      $('cp-tpl').onchange   = function(){ st.templateId = this.value; st.name = $('cp-name').value; draw(); };
      $('cp-when').onchange  = function(){ st.when = this.value; st.name = $('cp-name').value; draw(); };
      $('cp-cancel').onclick = closeModal;
      $('cp-go').onclick = function(){
        var name = $('cp-name').value.trim() || (t ? t.name : 'Campaign');
        var immediate = st.when === 'now';
        var c = {
          id: uid('c'), name: name, channel: t.channel, templateId: t.id, batchId: b.id,
          status: immediate ? 'sent' : 'scheduled',
          when: immediate ? Date.now() : Date.now() + (st.when==='tomorrow' ? 86400000 : 604800000),
          sent:0, delivered:0, opened:0, clicked:0, regs:0
        };
        if (immediate){
          c.sent = n;
          c.delivered = Math.round(n * (0.955 + Math.random()*0.04));
          c.opened = Math.round(c.delivered * (t.channel==='email' ? 0.28+Math.random()*0.2 : 0.74+Math.random()*0.16));
          c.clicked = Math.round(c.opened * (0.16+Math.random()*0.22));
          c.regs = Math.round(c.clicked * (0.2+Math.random()*0.3));
        }
        D.campaigns.unshift(c);
        save(); closeModal(); CUR.tab = 'campaigns'; redraw();
        ctx.toast(immediate ? comma(n)+' messages queued' : 'Campaign scheduled for '+comma(n));
      };
    }
    draw();
  }

  /* ---------------------------------------------------------------- lead drawer */
  function openLead(id, ctx){
    var EV = ctx.EV;
    var l = leads(EV).filter(function(x){ return String(x.id)===String(id); })[0];
    if (!l) return;
    var s = stageById(l.stage);

    layer().innerHTML =
      '<div class="drawer-bg" id="mkt-dbg"></div>' +
      '<aside class="drawer">' +
        '<div class="drawer-head">' +
          '<span class="avat" style="background:'+l.p.colour+';width:44px;height:44px;font-size:15px">'+esc(l.p.initials)+'</span>' +
          '<span style="flex:1;min-width:0"><b style="font-size:16px;display:block">'+esc(l.p.name)+'</b>' +
          '<span style="font-size:12.5px;color:var(--text-muted)">'+esc(l.p.desig)+' &middot; '+esc(l.p.comp)+'</span></span>' +
          '<button class="btn btn-ghost btn-icon" type="button" id="mkt-dx">'+svg(I.x,17)+'</button>' +
        '</div>' +
        '<div class="drawer-body">' +
          '<div class="dsec"><h4>Stage</h4>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' + STAGES.map(function(x){
              var on = l.stage===x.id;
              return '<button class="bkt" type="button" data-setstage="'+x.id+'" style="cursor:pointer;border:1px solid '+
                (on?x.colour:'var(--border)')+';background:'+(on?x.colour+'1F':'transparent')+';color:'+
                (on?x.colour:'var(--text-muted)')+'">'+x.label+'</button>';
            }).join('') + '</div></div>' +

          '<div class="dsec"><h4>Owner</h4>' +
            '<select class="inp" id="ld-owner">' + OWNERS.map(function(o){
              return '<option'+(l.owner===o?' selected':'')+'>'+esc(o)+'</option>';
            }).join('') + '</select></div>' +

          '<div class="dsec"><h4>Contact</h4>' +
            '<div class="drow"><span class="k">Email</span><span class="v">'+esc(l.p.email)+'</span></div>' +
            '<div class="drow"><span class="k">Phone</span><span class="v">'+esc(l.p.phone)+'</span></div>' +
            '<div class="drow"><span class="k">Industry</span><span class="v">'+esc(l.p.industry)+'</span></div>' +
            '<div class="drow"><span class="k">City</span><span class="v">'+esc(l.p.city)+'</span></div>' +
            '<div class="drow"><span class="k">Score</span><span class="v">'+l.p.score+' / 100</span></div>' +
            '<div class="drow"><span class="k">Past editions</span><span class="v">'+l.p.editions+'</span></div>' +
          '</div>' +

          '<div class="dsec"><h4>Follow-up</h4>' +
            '<input class="inp" id="ld-next" type="date" value="'+esc(l.next||'')+'"></div>' +

          '<div class="dsec"><h4>Notes</h4>' +
            '<textarea class="inp" id="ld-note" placeholder="What came out of the last conversation…" style="min-height:70px"></textarea>' +
            '<button class="btn btn-secondary btn-sm" type="button" id="ld-addnote" style="margin-top:8px">Add note</button>' +
            (l.notes.length
              ? '<div class="tline" style="margin-top:14px">' + l.notes.slice().reverse().map(function(nt){
                  return '<div class="ti"><b>'+esc(nt.text)+'</b><span>'+ago(nt.when)+'</span></div>';
                }).join('') + '</div>'
              : '<p style="font-size:12.5px;color:var(--text-muted);margin:10px 0 0">No notes yet.</p>') +
          '</div>' +
        '</div>' +
        '<div class="drawer-foot">' +
          '<button class="btn btn-primary btn-sm" type="button" id="ld-call">'+svg(I.phone,13)+' Log a call ('+l.calls+')</button>' +
          '<button class="btn btn-secondary btn-sm" type="button" id="ld-mail">'+svg(I.mail,13)+' Email</button>' +
        '</div>' +
      '</aside>';

    $('mkt-dx').onclick = closeModal;
    $('mkt-dbg').onclick = closeModal;

    each('[data-setstage]', function(el){
      el.onclick = function(){
        l.stage = el.getAttribute('data-setstage');
        saveLead(l); redraw(); openLead(id, ctx);
        ctx.toast('Moved to ' + stageById(l.stage).label);
      };
    });
    $('ld-owner').onchange = function(){
      l.owner = this.value; saveLead(l); redraw(); ctx.toast('Owner changed to ' + l.owner);
    };
    $('ld-next').onchange = function(){
      l.next = this.value; saveLead(l); redraw();
      ctx.toast(l.next ? 'Follow-up set for ' + fmtDate(l.next) : 'Follow-up cleared');
    };
    $('ld-addnote').onclick = function(){
      var v = $('ld-note').value.trim();
      if (!v){ ctx.toast('Write something first'); return; }
      l.notes.push({ when: Date.now(), text: v.slice(0, 240) });
      saveLead(l); redraw(); openLead(id, ctx); ctx.toast('Note added');
    };
    $('ld-call').onclick = function(){
      l.calls++;
      if (l.stage === 'new') l.stage = 'contacted';
      saveLead(l); redraw(); openLead(id, ctx);
      ctx.toast('Call logged');
    };
    $('ld-mail').onclick = function(){ ctx.toast('Opens the composer for ' + l.p.name); };
  }

  /* ======================================================================
     RENDER + WIRE
     ====================================================================== */
  function bodyHTML(tab, ctx){
    if (tab === 'studio')    return studioHTML(ctx);
    if (tab === 'audiences') return audiencesHTML(ctx);
    if (tab === 'campaigns') return campaignsHTML(ctx);
    if (tab === 'pipeline')  return pipelineHTML(ctx);
    return crmHTML(ctx);
  }

  var HEADS = {
    studio:    ['Studio', 'Build the assets - mailer templates, banner placements and social posts.'],
    audiences: ['Audiences', 'Cut the prospect pool into named batches you can mail again and again.'],
    campaigns: ['Campaigns', 'Send a template to a batch, by email or WhatsApp, and watch what it did.'],
    pipeline:  ['Data pipeline', 'Everything this event knows - this edition, past editions and the pool behind them.'],
    crm:       ['CRM', 'Work the leads: stages, owners, calls and follow-ups.']
  };

  function view(tab, ctx){
    bindCore();
    CUR.tab = tab; CUR.ctx = ctx; CUR.EV = ctx.EV;
    loadStore(ctx.EV);
    var h = HEADS[tab] || HEADS.studio;
    return ctx.vhead(h[0], h[1],
        tab === 'campaigns' ? '<button class="btn btn-primary btn-sm" type="button" data-newcamp="1">'+svg(I.send,13)+' New campaign</button>' : '') +
      '<div id="mkt-root">' + bodyHTML(tab, ctx) + '</div>';
  }

  function redraw(){
    var root = $('mkt-root');
    if (!root || !CUR.ctx) return;
    root.innerHTML = bodyHTML(CUR.tab, CUR.ctx);
    wireBody(CUR.tab, CUR.ctx);
  }

  function wireBody(tab, ctx){
    /* studio */
    each('[data-studio]', function(el){ el.onclick = function(){ U.studio = el.getAttribute('data-studio'); redraw(); }; });
    each('[data-newtpl]', function(el){ el.onclick = function(){ editTemplate(null, ctx); }; });
    each('[data-opentpl]', function(el){ el.onclick = function(){ editTemplate(el.getAttribute('data-opentpl'), ctx); }; });
    each('[data-duptpl]', function(el){
      el.onclick = function(e){
        e.stopPropagation();
        var t = D.templates.filter(function(x){ return x.id===el.getAttribute('data-duptpl'); })[0];
        if (!t) return;
        var copy = JSON.parse(JSON.stringify(t));
        copy.id = uid('t'); copy.name = t.name + ' (copy)'; copy.updated = Date.now();
        D.templates.unshift(copy); save(); redraw(); ctx.toast('Template duplicated');
      };
    });
    each('[data-deltpl]', function(el){
      el.onclick = function(e){
        e.stopPropagation();
        var id = el.getAttribute('data-deltpl');
        D.templates = D.templates.filter(function(x){ return x.id !== id; });
        save(); redraw(); ctx.toast('Template deleted');
      };
    });

    each('[data-newban]', function(el){ el.onclick = function(){ editBanner(null, ctx); }; });
    each('[data-openban]', function(el){ el.onclick = function(){ editBanner(el.getAttribute('data-openban'), ctx); }; });
    each('[data-toggleban]', function(el){
      el.onclick = function(e){
        e.stopPropagation();
        var b = D.banners.filter(function(x){ return x.id===el.getAttribute('data-toggleban'); })[0];
        if (!b) return;
        b.status = b.status === 'live' ? 'paused' : 'live';
        save(); redraw(); ctx.toast('Placement ' + b.status);
      };
    });
    each('[data-delban]', function(el){
      el.onclick = function(e){
        e.stopPropagation();
        var id = el.getAttribute('data-delban');
        D.banners = D.banners.filter(function(x){ return x.id !== id; });
        save(); redraw(); ctx.toast('Placement deleted');
      };
    });

    each('[data-newpost]', function(el){ el.onclick = function(){ editPost(null, ctx); }; });
    each('[data-openpost]', function(el){ el.onclick = function(){ editPost(el.getAttribute('data-openpost'), ctx); }; });
    each('[data-pubpost]', function(el){
      el.onclick = function(e){
        e.stopPropagation();
        var p = D.posts.filter(function(x){ return x.id===el.getAttribute('data-pubpost'); })[0];
        if (!p) return;
        p.status = 'published'; p.when = Date.now();
        p.impressions = 1200 + Math.floor(Math.random()*3600);
        p.engagements = Math.floor(p.impressions * 0.035);
        save(); redraw(); ctx.toast('Post published');
      };
    });

    /* audiences */
    each('[data-newbatch]', function(el){ el.onclick = function(){ editBatch(null, ctx); }; });
    each('[data-editbatch]', function(el){ el.onclick = function(){ editBatch(el.getAttribute('data-editbatch'), ctx); }; });
    each('[data-delbatch]', function(el){
      el.onclick = function(){
        var id = el.getAttribute('data-delbatch');
        D.batches = D.batches.filter(function(x){ return x.id !== id; });
        save(); redraw(); ctx.toast('Batch deleted');
      };
    });
    each('[data-usebatch]', function(el){ el.onclick = function(){ newCampaign(el.getAttribute('data-usebatch'), ctx); }; });
    var aq = $('aud-q');
    if (aq) aq.oninput = function(){
      U.audQ = aq.value; U.audPage = 1; redraw();
      var n = $('aud-q'); if (n){ n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    };
    each('[data-audpage]', function(el){
      el.onclick = function(){ var n = Number(el.getAttribute('data-audpage')); if (n>0){ U.audPage = n; redraw(); } };
    });

    /* pipeline recipes -> a saved batch */
    each('[data-recipe]', function(el){
      el.onclick = function(){
        var r = el.getAttribute('data-recipe');
        var f = emptyFilters(), name = '';
        if (r === 'loyal'){ name = 'Repeat attendees'; f.minScore = 45; }
        if (r === 'warmnotreg'){ name = 'Warm but not registered'; f.sub = ['active']; f.unregisteredOnly = true; }
        if (r === 'cxo'){ name = 'CXO tier'; f.seniority = ['CXO']; }
        if (r === 'lapsed'){ name = 'Lapsed attendees'; f.sub = ['dormant']; }
        var b = { id:uid('g'), name:name, f:f, created:Date.now() };
        D.batches.unshift(b); save();
        CUR.tab = 'audiences'; redraw();
        ctx.toast('Saved "' + name + '" as a batch');
      };
    });

    /* campaigns */
    each('[data-newcamp]', function(el){ el.onclick = function(){ newCampaign(null, ctx); }; });
    each('[data-sendnow]', function(el){
      el.onclick = function(e){
        e.stopPropagation();
        var c = D.campaigns.filter(function(x){ return x.id===el.getAttribute('data-sendnow'); })[0];
        if (!c) return;
        var b = D.batches.filter(function(x){ return x.id===c.batchId; })[0];
        var n = b ? batchMembers(ctx.EV, b).length : 0;
        c.status = 'sent'; c.when = Date.now(); c.sent = n;
        c.delivered = Math.round(n * 0.97);
        c.opened = Math.round(c.delivered * (c.channel==='email' ? 0.34 : 0.8));
        c.clicked = Math.round(c.opened * 0.25);
        c.regs = Math.round(c.clicked * 0.3);
        save(); redraw(); ctx.toast(comma(n) + ' messages queued');
      };
    });
    each('[data-delcamp]', function(el){
      el.onclick = function(e){
        e.stopPropagation();
        var id = el.getAttribute('data-delcamp');
        D.campaigns = D.campaigns.filter(function(x){ return x.id !== id; });
        save(); redraw(); ctx.toast('Campaign deleted');
      };
    });

    /* crm */
    each('[data-crmview]', function(el){ el.onclick = function(){ U.crmView = el.getAttribute('data-crmview'); redraw(); }; });
    each('[data-lead]', function(el){ el.onclick = function(){ openLead(el.getAttribute('data-lead'), ctx); }; });
    var cq = $('crm-q');
    if (cq) cq.oninput = function(){
      U.crmQ = cq.value; redraw();
      var n = $('crm-q'); if (n){ n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    };
    var cs = $('crm-stage');
    if (cs) cs.onchange = function(){ U.crmStage = cs.value; redraw(); };
    var co = $('crm-owner');
    if (co) co.onchange = function(){ U.crmOwner = co.value; redraw(); };
  }

  function wire(tab, ctx){
    bindCore();
    CUR.tab = tab; CUR.ctx = ctx; CUR.EV = ctx.EV;
    loadStore(ctx.EV);
    wireBody(tab, ctx);
  }

  return {
    TABS: TABS, view: view, wire: wire,
    /* exposed for tests */
    _internals: {
      prospects: prospects, editions: editions, leads: leads, STAGES: STAGES,
      SUB_STATE: SUB_STATE, INDUSTRIES: INDUSTRIES, SENIORITY: SENIORITY,
      matchBatch: matchBatch, batchMembers: batchMembers, emptyFilters: emptyFilters,
      describeBatch: describeBatch, loadStore: loadStore, store: function(){ return D; },
      state: U, bodyHTML: bodyHTML, merge: merge, saveLead: saveLead, stageById: stageById
    }
  };
})();
