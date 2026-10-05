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
    /* A single number to sort the pool by: engagement + loyalty + seniority.
       Clamping the raw total at 100 piled everyone worth calling onto the
       same value, which made the hot/warm/cold split meaningless. Normalise
       against the best score in the pool instead, so the spread is real. */
    var raw = out.map(function(p){
      return (p.opens * 4) + (p.clicks * 6) + (p.editions * 9) +
        (p.seniority === 'CXO' ? 18 : p.seniority === 'VP / Head' ? 12 : 6) +
        (p.sub === 'active' ? 14 : p.sub === 'passive' ? 6 : 0) +
        (p.registered ? 8 : 0) + (p.paid ? 10 : 0);
    });
    var top = Math.max.apply(null, raw) || 1;
    out.forEach(function(p, i){
      p.score = Math.max(1, Math.min(100, Math.round(raw[i] / top * 100)));
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
    D = { templates:[], banners:[], posts:[], batches:[], campaigns:[], crm:{}, crmAdded:[], seeded:false };
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
    crmView:'table', crmQ:'', crmStage:'all', crmOwner:'all', crmLevel:'all',
    crmQuick:'all', crmPage:1, crmSel:{}, crmSort:{ k:'score', dir:-1 },
    pipeQ:'', pipeEd:[], pipeLevel:'all', pipeSub:'all', pipePage:1, pipeSel:{},
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
    /* a batch saved from a selection is a fixed list of people, not a filter */
    if (b.ids && b.ids.length){
      return prospects(EV).filter(function(p){ return b.ids.indexOf(p.id) >= 0; });
    }
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

     Every edition this event has ever run, and the one pool of people
     behind them. The desk comes here to answer one question - who is
     worth mailing next - so the page ends in cuts that can be pushed
     straight into the CRM.
     ====================================================================== */
  /* Which editions a given person actually attended. p.editions is only a
     count, so spread it deterministically across the past editions: without
     this, picking an older edition can never widen the set, because its
     attendees are always a subset of the more recent one's. */
  var EDSET = {};
  function edSet(p, total){
    var key = p.id + ':' + total;
    if (EDSET[key]) return EDSET[key];
    var set = {};
    if (p.registered) set[0] = 1;
    var want = Math.min(p.editions, total - 1), got = 0, i;
    for (i = 1; i < total && got < want; i++){
      if (rnd(p.id * 7 + i * 13) > 0.38){ set[i] = 1; got++; }
    }
    for (i = 1; i < total && got < want; i++){ if (!set[i]){ set[i] = 1; got++; } }
    EDSET[key] = set;
    return set;
  }
  function edMatch(p, picked, total){
    if (!picked.length) return true;
    var set = edSet(p, total);
    for (var i = 0; i < picked.length; i++) if (set[picked[i]]) return true;
    return false;
  }

  function pipeFiltered(EV){
    var q = U.pipeQ.toLowerCase();
    var total = editions(EV).length;
    return prospects(EV).filter(function(p){
      if (!edMatch(p, U.pipeEd, total)) return false;
      if (U.pipeLevel !== 'all' && levelOf(p) !== U.pipeLevel) return false;
      if (U.pipeSub !== 'all' && p.sub !== U.pipeSub) return false;
      if (q && (p.name + ' ' + p.comp + ' ' + p.desig + ' ' + p.email).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function pipelineHTML(ctx){
    var EV = ctx.EV, eds = editions(EV), all = prospects(EV);
    var cur = eds[0];
    var F = pipeFiltered(EV);

    var reach = all.filter(function(p){ return p.sub !== 'unsubscribed'; }).length;

    /* The edition cards below carry the same numbers the tiles repeated,
       so the tiles were a row of chrome above the actual work. */

    /* editions double as the filter: click one to cut the pool to it */
    var edCards = '<div class="ed-grid">' + eds.map(function(e, i){
      var on = U.pipeEd.indexOf(i) >= 0;
      var conv = e.visitors ? (e.regs / e.visitors * 100) : 0;
      var inPool = all.filter(function(p){ return edSet(p, eds.length)[i]; }).length;
      return '<button class="ed-card" type="button" data-ed="' + i + '" aria-pressed="' + on + '">' +
          '<span class="yr">E' + (eds.length - i) + ' &middot; ' + e.year +
            (e.current ? ' &middot; this edition' : '') + '</span>' +
          '<b>' + esc(e.label) + '</b>' +
          '<span class="st"><span>Regs <i>' + comma(e.regs) + '</i></span>' +
          '<span>Conv <i>' + conv.toFixed(1) + '%</i></span>' +
          '<span>In pool <i>' + comma(inPool) + '</i></span></span>' +
        '</button>';
    }).join('') + '</div>' +
    (U.pipeEd.length
      ? '<div style="margin-top:11px;display:flex;align-items:center;gap:9px;flex-wrap:wrap">' +
          '<span class="hint" style="margin:0">Showing people from ' + U.pipeEd.length +
            (U.pipeEd.length === 1 ? ' edition' : ' editions') + '.</span>' +
          '<button class="btn btn-ghost btn-sm" type="button" id="pipe-edclear">Clear edition filter</button></div>'
      : '');

    /* pool to paid, as a funnel - the shape tells you where it leaks */
    var steps = [
      ['On record',   all.length,                                                    'var(--text-faint)'],
      ['Reachable',   reach,                                                          'var(--info)'],
      ['Engaged',     all.filter(function(p){ return p.sub === 'active'; }).length,   'var(--review)'],
      ['Registered',  all.filter(function(p){ return p.registered; }).length,         'var(--ok)'],
      ['Paid',        all.filter(function(p){ return p.paid; }).length,               'var(--accent)']
    ];
    var top = steps[0][1] || 1;
    var funnel = '<div class="funnel">' + steps.map(function(s, i){
      var pct = s[1] / top * 100;
      var drop = i ? (steps[i-1][1] ? Math.round(s[1] / steps[i-1][1] * 100) : 0) : 100;
      return '<div class="fstep"><span class="fl">' + esc(s[0]) + '</span>' +
        '<span class="ft"><i style="width:' + Math.max(pct, 1.5) + '%;background:' + s[2] + '"></i></span>' +
        '<span class="fn">' + comma(s[1]) + ' <em>' + drop + '%</em></span></div>';
    }).join('') + '</div>';

    var lvlCounts = { hot:0, warm:0, cold:0 };
    all.forEach(function(p){ lvlCounts[levelOf(p)]++; });

    /* the cuts worth pulling, each one a click from a batch or the CRM */
    var recipes = [
      { id:'loyal',      label:'Repeat attendees',        note:'Been to 2 or more past editions',
        n: all.filter(function(p){ return p.editions>=2 && p.sub!=='unsubscribed'; }).length },
      { id:'warmnotreg', label:'Warm but not registered', note:'Active subscribers who have not signed up yet',
        n: all.filter(function(p){ return p.sub==='active' && !p.registered; }).length },
      { id:'cxo',        label:'CXO tier',                note:'Chief-level across every industry',
        n: all.filter(function(p){ return p.seniority==='CXO' && p.sub!=='unsubscribed'; }).length },
      { id:'lapsed',     label:'Lapsed attendees',        note:'Came before, gone quiet since',
        n: all.filter(function(p){ return p.editions>=1 && p.sub==='dormant'; }).length }
    ];
    var recipeCards = '<div class="pgrid">' + recipes.map(function(r){
      return '<div class="pcard">' +
        '<div class="pcard-h"><span class="mrow-i" style="background:var(--accent)1F;color:var(--accent)">' +
          svg(I.layers,15) + '</span>' +
        '<span style="flex:1"><b style="font-size:13.5px;display:block">' + esc(r.label) + '</b>' +
        '<span style="font-size:11.5px;color:var(--text-muted)">' + esc(r.note) + '</span></span>' +
        '<span class="num" style="font-weight:800;font-size:15px">' + comma(r.n) + '</span></div>' +
        '<div class="pcard-f"><span style="flex:1"></span>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-recipe="' + r.id + '">Save as a batch</button>' +
        '<button class="btn btn-secondary btn-sm" type="button" data-tocrm="' + r.id + '">' +
          svg(I.headset,12) + ' Send to CRM</button></div></div>';
    }).join('') + '</div>';

    /* the pool itself, searchable, because sooner or later you want one person */
    var toolbar = '<div class="toolbar">' +
      '<span class="search">' + svg(I.search,15) +
        '<input id="pipe-q" placeholder="Search the pool by name, company, role or email…" value="' +
        esc(U.pipeQ) + '"></span>' +
      '<select class="inp" id="pipe-level" style="width:auto">' +
        '<option value="all"' + (U.pipeLevel==='all'?' selected':'') + '>Every level</option>' +
        LEVELS.map(function(l){
          return '<option value="'+l.id+'"'+(U.pipeLevel===l.id?' selected':'')+'>'+l.label+
            ' ('+comma(lvlCounts[l.id])+')</option>';
        }).join('') + '</select>' +
      '<select class="inp" id="pipe-sub" style="width:auto">' +
        '<option value="all"' + (U.pipeSub==='all'?' selected':'') + '>Every subscriber state</option>' +
        SUB_STATE.map(function(s){
          return '<option value="'+s.id+'"'+(U.pipeSub===s.id?' selected':'')+'>'+s.label+'</option>';
        }).join('') + '</select>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-secondary btn-sm" type="button" id="pipe-mail">' +
        svg(I.mail,13) + ' Email this view</button>' +
      '<button class="btn btn-secondary btn-sm" type="button" id="pipe-wa">' +
        svg(I.wa,13) + ' WhatsApp</button>' +
      '<button class="btn btn-secondary btn-sm" type="button" id="pipe-export">' +
        svg(I.down,13) + ' Export CSV</button>' +
    '</div>';

    var per = 25, pages = Math.max(1, Math.ceil(F.length / per));
    if (U.pipePage > pages) U.pipePage = pages;
    var slice = F.slice((U.pipePage-1)*per, U.pipePage*per);
    var allOn = slice.length > 0 && slice.every(function(p){ return U.pipeSel[p.id]; });
    var poolRows = slice.map(function(p){
      var lv = levelMeta(levelOf(p));
      var st = subState(p.sub);
      var on = !!U.pipeSel[p.id];
      return '<tr' + (on ? ' class="sel"' : '') + '>' +
        '<td class="pick"><input type="checkbox" data-ppick="'+p.id+'"'+(on?' checked':'')+'></td>' +
        '<td data-pipe="' + p.id + '" style="cursor:pointer"><span class="person">' +
          '<span class="avat" style="background:'+p.colour+'">'+esc(p.initials)+'</span>' +
          '<span class="pn"><b>'+esc(p.name)+'</b><span class="em">'+esc(p.desig)+'</span></span></span></td>' +
        '<td>'+esc(p.comp)+'</td>' +
        '<td>'+esc(p.industry)+'</td>' +
        '<td><span class="lvl lvl-'+lv.id+'">'+lv.label+'</span></td>' +
        '<td class="num">'+p.score+'</td>' +
        '<td class="num">'+p.editions+'</td>' +
        '<td><span class="badge" style="background:'+st.colour+'1F;color:'+st.colour+'">'+st.label+'</span></td>' +
      '</tr>';
    }).join('');

    var poolTable = F.length
      ? '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th class="pick"><input type="checkbox" id="pipe-all"'+(allOn?' checked':'')+'></th>' +
          '<th>Person</th><th>Company</th><th>Industry</th><th>Level</th>' +
          '<th>Score</th><th>Editions</th><th>Subscriber</th>' +
        '</tr></thead><tbody>' + poolRows + '</tbody></table></div>' + pager(U.pipePage, pages, F.length, 'pipe')
      : empty(I.search, 'Nobody matches', 'Loosen the search, the level or the edition filter.');

    var psel = Object.keys(U.pipeSel).filter(function(k){ return U.pipeSel[k]; });
    var pbulk = psel.length ? '<div class="bulkbar">' +
        '<span class="bn">' + psel.length + (psel.length === 1 ? ' person selected' : ' people selected') + '</span>' +
        '<button class="bbtn" type="button" data-pbulk="email">' + svg(I.mail,13) + ' Email</button>' +
        '<button class="bbtn" type="button" data-pbulk="whatsapp">' + svg(I.wa,13) + ' WhatsApp</button>' +
        '<button class="bbtn" type="button" data-pbulk="crm">' + svg(I.headset,13) + ' Send to CRM</button>' +
        '<button class="bbtn" type="button" data-pbulk="batch">' + svg(I.layers,13) + ' Save as batch</button>' +
        '<button class="bbtn" type="button" data-pbulk="export">' + svg(I.down,13) + ' Export</button>' +
        '<span class="sp"></span>' +
        '<button class="bclear" type="button" id="pipe-clearsel">Clear</button>' +
      '</div>' : '';

    return panel('Editions on record',
        comma(all.length) + ' people on record, ' + comma(reach) + ' reachable \u2014 click an edition to cut the pool to it',
        edCards) +
      '<div class="ins-grid" style="margin-bottom:18px">' +
        '<div class="ins-card"><h3>Pool to paid</h3>' +
          '<div class="cap">Where the base narrows, across every edition</div>' + funnel + '</div>' +
        '<div class="ins-card"><h3>Where registrations came from</h3>' +
          '<div class="cap">Acquisition source across the pool</div>' +
          bars(tally(all.filter(function(p){ return p.registered; }), 'src'), 'var(--info)') + '</div>' +
      '</div>' +
      panel('Ready-made cuts', 'Already counted - save one as a batch, or work it in the CRM', recipeCards) +
      panelFlushLocal('The pool', comma(F.length) + ' of ' + comma(all.length) + ' shown',
        toolbar + pbulk + poolTable);
  }

  /* panel() pads its body; the pool table wants to run edge to edge */
  function panelFlushLocal(title, sub, body){
    return '<div class="panel"><div class="panel-head"><h3>' + esc(title) + '</h3>' +
      '<span class="sub">' + esc(sub) + '</span></div>' + body + '</div>';
  }

  function pager(page, pages, total, kind){
    return '<div class="pgr">' +
      '<span class="sp">' + comma(total) + (total === 1 ? ' row' : ' rows') + '</span>' +
      '<button type="button" data-pg="' + kind + ':1"' + (page<=1?' disabled':'') + '>First</button>' +
      '<button type="button" data-pg="' + kind + ':' + (page-1) + '"' + (page<=1?' disabled':'') + '>Prev</button>' +
      '<span class="pnum">' + page + ' / ' + pages + '</span>' +
      '<button type="button" data-pg="' + kind + ':' + (page+1) + '"' + (page>=pages?' disabled':'') + '>Next</button>' +
      '<button type="button" data-pg="' + kind + ':' + pages + '"' + (page>=pages?' disabled':'') + '>Last</button>' +
    '</div>';
  }

  /* ======================================================================
     MODULE 5 : CRM

     A desk works a list: narrow it, select rows, act on the set. The
     quick views are the cuts a desk opens every morning; everything
     else - bulk actions, import, the drawer - hangs off a selection.
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

  /* one word for how hot a lead is, because a score out of 100 is not a word */
  var LEVELS = [
    { id:'hot',  label:'Hot',  note:'Score 70+ - call these first' },
    { id:'warm', label:'Warm', note:'Score 40-69 - worth a nudge' },
    { id:'cold', label:'Cold', note:'Under 40 - mail, do not call' }
  ];
  function levelMeta(id){
    for (var i=0;i<LEVELS.length;i++) if (LEVELS[i].id===id) return LEVELS[i];
    return LEVELS[2];
  }
  function levelOf(p){
    var saved = D && D.crm && D.crm[p.id] && D.crm[p.id].level;
    if (saved) return saved;
    return p.score >= 70 ? 'hot' : p.score >= 40 ? 'warm' : 'cold';
  }

  /* Leads are the top of the pool, plus anyone a desk has actually touched -
     pushed in from the pipeline, added by hand or imported. Without that
     second set, "Send to CRM" wrote a record nobody could see. */
  function leads(EV){
    var all = prospects(EV);
    var top = all.slice().sort(function(a,b){ return b.score - a.score; }).slice(0, 120);
    var seen = {};
    top.forEach(function(p){ seen[p.id] = 1; });
    var worked = all.filter(function(p){ return !seen[p.id] && D.crm[p.id]; });
    var extra = (D.crmAdded || []).filter(function(p){ return !seen[p.id]; });
    return top.concat(worked).concat(extra).map(function(p, i){
      var saved = D.crm[p.id];
      var s = EV.eventNo + i * 17;
      var stage = saved ? saved.stage
        : (p.manual ? 'new'
          : p.paid ? 'won' : p.registered ? 'registered'
          : rnd(s) > 0.72 ? 'interested' : rnd(s) > 0.42 ? 'contacted' : 'new');
      return {
        id: p.id, p: p,
        stage: stage,
        level: levelOf(p),
        owner: saved && saved.owner ? saved.owner : (p.manual ? OWNERS[0] : OWNERS[Math.floor(rnd(s+1) * OWNERS.length)]),
        calls: saved && saved.calls != null ? saved.calls : (p.manual ? 0 : Math.floor(rnd(s+2) * 6)),
        notes: (saved && saved.notes) || [],
        next: saved && saved.next ? saved.next : '',
        touched: saved && saved.touched ? saved.touched : 0
      };
    });
  }
  function saveLead(l){
    D.crm[l.id] = { stage:l.stage, owner:l.owner, calls:l.calls, notes:l.notes,
                    next:l.next, level:l.level, touched:Date.now() };
    save();
  }

  /* the cuts a desk opens every morning */
  function quickViews(L){
    var today = new Date(); today.setHours(23,59,59,999);
    return [
      { id:'all',    label:'All leads',      fn: function(){ return true; } },
      { id:'hot',    label:'Hot',            fn: function(l){ return l.level === 'hot' && l.stage !== 'won' && l.stage !== 'lost'; } },
      { id:'due',    label:'Follow-up due',  fn: function(l){ return l.next && new Date(l.next) <= today; } },
      { id:'untouched', label:'Never contacted', fn: function(l){ return l.stage === 'new' && !l.calls; } },
      { id:'open',   label:'Open',           fn: function(l){ return l.stage !== 'won' && l.stage !== 'lost'; } },
      { id:'won',    label:'Won',            fn: function(l){ return l.stage === 'won'; } }
    ].map(function(v){ v.n = L.filter(v.fn).length; return v; });
  }

  function crmFiltered(EV){
    var q = U.crmQ.toLowerCase();
    var L = leads(EV);
    var view = quickViews(L).filter(function(v){ return v.id === U.crmQuick; })[0];
    var out = L.filter(function(l){
      if (view && !view.fn(l)) return false;
      if (U.crmStage !== 'all' && l.stage !== U.crmStage) return false;
      if (U.crmOwner !== 'all' && l.owner !== U.crmOwner) return false;
      if (U.crmLevel !== 'all' && l.level !== U.crmLevel) return false;
      if (q && (l.p.name+' '+l.p.comp+' '+l.p.desig+' '+(l.p.email||'')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var k = U.crmSort.k, dir = U.crmSort.dir;
    return out.sort(function(a, b){
      var av, bv;
      if (k === 'name' || k === 'comp'){ av = a.p[k].toLowerCase(); bv = b.p[k].toLowerCase(); }
      else if (k === 'score'){ av = a.p.score; bv = b.p.score; }
      else if (k === 'next'){ av = a.next || '9999'; bv = b.next || '9999'; }
      else { av = a[k]; bv = b[k]; }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }

  function selectedIds(){
    return Object.keys(U.crmSel).filter(function(k){ return U.crmSel[k]; });
  }

  function crmHTML(ctx){
    var EV = ctx.EV, L = leads(EV), F = crmFiltered(EV);
    var counts = {};
    STAGES.forEach(function(s){ counts[s.id] = L.filter(function(l){ return l.stage===s.id; }).length; });
    var lvlCounts = { hot:0, warm:0, cold:0 };
    L.forEach(function(l){ lvlCounts[l.level]++; });
    /* The quick views already carry every number the tiles repeated, so
       the tiles were a row of chrome between the desk and its list. */
    var views = '<div class="qviews">' + quickViews(L).map(function(v){
      return '<button class="qview" type="button" data-qview="' + v.id + '" aria-pressed="' +
        (U.crmQuick === v.id) + '">' + esc(v.label) + '<span class="n">' + comma(v.n) + '</span></button>';
    }).join('') + '</div>';

    var toolbar = '<div class="toolbar">' +
      '<span class="search">'+svg(I.search,15)+
        '<input id="crm-q" placeholder="Search a lead, company, role or email…" value="'+esc(U.crmQ)+'"></span>' +
      '<select class="inp" id="crm-stage" style="width:auto">' +
        '<option value="all"'+(U.crmStage==='all'?' selected':'')+'>Every stage</option>' +
        STAGES.map(function(s){
          return '<option value="'+s.id+'"'+(U.crmStage===s.id?' selected':'')+'>'+s.label+' ('+counts[s.id]+')</option>';
        }).join('') + '</select>' +
      '<select class="inp" id="crm-level" style="width:auto">' +
        '<option value="all"'+(U.crmLevel==='all'?' selected':'')+'>Every level</option>' +
        LEVELS.map(function(l){
          return '<option value="'+l.id+'"'+(U.crmLevel===l.id?' selected':'')+'>'+l.label+' ('+lvlCounts[l.id]+')</option>';
        }).join('') + '</select>' +
      '<select class="inp" id="crm-owner" style="width:auto">' +
        '<option value="all"'+(U.crmOwner==='all'?' selected':'')+'>Every owner</option>' +
        OWNERS.map(function(o){
          return '<option value="'+esc(o)+'"'+(U.crmOwner===o?' selected':'')+'>'+esc(o)+'</option>';
        }).join('') + '</select>' +
      '<span style="flex:1"></span>' +
      '<span class="vswitch">' +
        '<button type="button" data-crmview="board" aria-pressed="'+(U.crmView==='board')+'">Board</button>' +
        '<button type="button" data-crmview="table" aria-pressed="'+(U.crmView==='table')+'">Table</button>' +
      '</span></div>';

    var sel = selectedIds();
    var bulk = sel.length ? '<div class="bulkbar">' +
        '<span class="bn">' + sel.length + (sel.length === 1 ? ' lead selected' : ' leads selected') + '</span>' +
        '<button class="bbtn" type="button" data-bulk="email">' + svg(I.mail,13) + ' Email</button>' +
        '<button class="bbtn" type="button" data-bulk="whatsapp">' + svg(I.wa,13) + ' WhatsApp</button>' +
        '<button class="bbtn" type="button" data-bulk="assign">' + svg(I.users,13) + ' Assign</button>' +
        '<button class="bbtn" type="button" data-bulk="stage">' + svg(I.flow,13) + ' Move stage</button>' +
        '<button class="bbtn" type="button" data-bulk="level">' + svg(I.star,13) + ' Set level</button>' +
        '<button class="bbtn" type="button" data-bulk="export">' + svg(I.down,13) + ' Export</button>' +
        '<span class="sp"></span>' +
        '<button class="bclear" type="button" id="crm-clearsel">Clear</button>' +
      '</div>' : '';

    var body = U.crmView === 'board' ? crmBoard(F) : crmTable(F);

    return panelFlushLocal('Lead pipeline', comma(F.length) + ' of ' + comma(L.length) + ' shown',
        views + toolbar + bulk + body);
  }

  function crmBoard(F){
    return '<div class="board">' + STAGES.map(function(s){
      var items = F.filter(function(l){ return l.stage===s.id; });
      return '<div class="bcol" data-stagecol="'+s.id+'">' +
        '<div class="bcol-h"><span class="bdot" style="background:'+s.colour+'"></span>' +
          '<b>'+s.label+'</b><span class="num">'+comma(items.length)+'</span></div>' +
        '<div class="bcol-b">' + (items.length ? items.slice(0, 25).map(function(l){
          var lv = levelMeta(l.level);
          return '<div class="lead" draggable="true" data-lead="'+l.id+'">' +
            '<div class="lead-t"><span class="avat" style="background:'+l.p.colour+';width:26px;height:26px;font-size:10px">'+
              esc(l.p.initials)+'</span><b>'+esc(l.p.name)+'</b></div>' +
            '<div class="lead-s">'+esc(l.p.desig)+'</div>' +
            '<div class="lead-s" style="color:var(--text-faint)">'+esc(l.p.comp)+'</div>' +
            '<div class="lead-f"><span class="lvl lvl-'+lv.id+'">'+lv.label+'</span>' +
              '<span class="num">'+esc(l.owner.split(' ')[0])+'</span></div>' +
          '</div>';
        }).join('') : '<div class="bcol-e">Nothing here</div>') + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function sortTh(k, label, cls){
    var on = U.crmSort.k === k;
    return '<th class="srt' + (on ? ' on' : '') + (cls ? ' ' + cls : '') + '" data-sort="' + k + '">' +
      esc(label) + '<span class="ar">' + (on ? (U.crmSort.dir === 1 ? '▲' : '▼') : '▲▼') + '</span></th>';
  }

  function crmTable(F){
    if (!F.length) return empty(I.search,'No leads match','Loosen the search, or pick a different view.');
    var per = 25, pages = Math.max(1, Math.ceil(F.length / per));
    if (U.crmPage > pages) U.crmPage = pages;
    var slice = F.slice((U.crmPage-1)*per, U.crmPage*per);
    var allOn = slice.length > 0 && slice.every(function(l){ return U.crmSel[l.id]; });

    var rows = slice.map(function(l){
      var s = stageById(l.stage), lv = levelMeta(l.level);
      var on = !!U.crmSel[l.id];
      var overdue = l.next && new Date(l.next) < new Date();
      return '<tr data-row="'+l.id+'"'+(on?' class="sel"':'')+'>' +
        '<td class="pick"><input type="checkbox" data-pick="'+l.id+'"'+(on?' checked':'')+'></td>' +
        '<td data-lead="'+l.id+'" style="cursor:pointer"><span class="person">' +
          '<span class="avat" style="background:'+l.p.colour+'">'+esc(l.p.initials)+'</span>' +
          '<span class="pn"><b>'+esc(l.p.name)+'</b><span class="em">'+esc(l.p.desig)+'</span></span></span></td>' +
        '<td>'+esc(l.p.comp)+'</td>' +
        '<td><span class="lvl lvl-'+lv.id+'">'+lv.label+'</span></td>' +
        '<td><span class="badge" style="background:'+s.colour+'1F;color:'+s.colour+'">'+s.label+'</span></td>' +
        '<td>'+esc(l.owner)+'</td>' +
        '<td class="num">'+l.calls+'</td>' +
        '<td class="num"><b>'+l.p.score+'</b></td>' +
        '<td class="nw">'+(l.next
          ? '<span style="color:'+(overdue?'var(--accent-strong)':'inherit')+'">'+fmtDate(l.next)+'</span>'
          : '<span style="color:var(--text-faint)">-</span>')+'</td>' +
      '</tr>';
    }).join('');

    return '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th class="pick"><input type="checkbox" id="crm-all"'+(allOn?' checked':'')+'></th>' +
      sortTh('name','Lead') + sortTh('comp','Company') + sortTh('level','Level') +
      sortTh('stage','Stage') + sortTh('owner','Owner') + sortTh('calls','Calls') +
      sortTh('score','Score') + sortTh('next','Follow-up') +
      '</tr></thead><tbody>'+rows+'</tbody></table></div>' + pager(U.crmPage, pages, F.length, 'crm');
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
  /* ======================================================================
     CRM : ADDING LEADS

     Two ways in, because a desk has two: one at a time from a phone
     call, or a thousand at once from a list somebody sent over.
     ====================================================================== */
  function nextManualId(){
    var max = 100000;
    (D.crmAdded || []).forEach(function(p){ if (p.id >= max) max = p.id + 1; });
    return max;
  }
  function makeManual(f){
    var parts = String(f.name || '').trim().split(/\s+/);
    var ini = ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length-1][0] : '')).toUpperCase();
    var id = nextManualId();
    return {
      id: id, manual: true,
      name: f.name, initials: ini,
      colour: AV[id % AV.length],
      email: f.email || '', phone: f.phone || '',
      desig: f.desig || '', seniority: f.seniority || 'Manager',
      comp: f.comp || '', city: f.city || '', industry: f.industry || INDUSTRIES[0],
      sub: 'active', opens: 0, clicks: 0, src: f.src || 'Added by hand',
      editions: 0, registered: false, paid: false,
      score: f.score != null ? f.score : 50
    };
  }

  function addLeadDialog(ctx){
    var Q = [{ name:'', desig:'', comp:'', email:'', phone:'', city:'', industry:INDUSTRIES[0],
               seniority:'Manager', owner:OWNERS[0], level:'warm', stage:'new' }];
    var qi = 0;

    function blank(){
      var prev = Q[qi] || {};
      return { name:'', desig:'', comp:prev.comp || '', email:'', phone:'', city:prev.city || '',
               industry:prev.industry || INDUSTRIES[0], seniority:'Manager',
               owner:prev.owner || OWNERS[0], level:'warm', stage:'new' };
    }

    modal('Add leads',
      '<div class="sp-wrap" style="border:1px solid var(--border);border-radius:11px;overflow:hidden">' +
        '<div class="sp-queue">' +
          '<div class="qh">Adding <span id="al-n"></span></div>' +
          '<div class="qlist" id="al-list"></div>' +
          '<div class="qfoot"><button class="btn btn-secondary btn-sm" type="button" id="al-add" ' +
            'style="width:100%">' + svg(I.plus,13) + ' Add another</button></div>' +
        '</div>' +
        '<div class="sp-form" id="al-form"></div>' +
      '</div>',
      '<span id="al-err" style="flex:1;font-size:12px;color:var(--accent-strong);align-self:center"></span>' +
      '<button class="btn btn-ghost" type="button" id="al-cancel">Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="al-save"></button>', 940);

    function readForm(){
      if (!$('al-name')) return;
      var e = Q[qi];
      ['name','desig','comp','email','phone','city'].forEach(function(k){ e[k] = $('al-'+k).value.trim(); });
      e.industry = $('al-industry').value;
      e.seniority = $('al-seniority').value;
      e.owner = $('al-owner').value;
      e.level = $('al-level').value;
      e.stage = $('al-stage').value;
    }
    function paintQueue(){
      $('al-n').textContent = Q.length + (Q.length === 1 ? ' lead' : ' leads');
      $('al-list').innerHTML = Q.map(function(e, i){
        var ini = e.name ? e.name.trim().split(/\s+/).map(function(w){ return w[0]; }).slice(0,2).join('').toUpperCase() : '';
        return '<button class="qi" type="button" data-q="'+i+'" aria-current="'+(i===qi)+'">' +
          '<span class="qph" style="background:'+AV[i % AV.length]+';color:#fff">'+esc(ini)+'</span>' +
          '<span class="qn">' + (e.name ? esc(e.name) : '<em>Lead '+(i+1)+'</em>') + '</span>' +
          (Q.length > 1 ? '<span class="qx" data-qx="'+i+'">'+svg(I.x,13)+'</span>' : '') + '</button>';
      }).join('');
      each('#al-list [data-q]', function(b){
        b.onclick = function(ev){
          if (ev.target.closest('[data-qx]')) return;
          readForm(); qi = +b.getAttribute('data-q'); paintForm(); paintQueue();
        };
      });
      each('#al-list [data-qx]', function(x){
        x.onclick = function(ev){
          ev.stopPropagation();
          readForm();
          Q.splice(+x.getAttribute('data-qx'), 1);
          if (qi >= Q.length) qi = Q.length - 1;
          paintForm(); paintQueue(); paintSave();
        };
      });
    }
    function paintSave(){
      $('al-save').textContent = Q.length === 1 ? 'Add lead' : 'Add all ' + Q.length + ' leads';
    }
    function fld(k, label, ph, req){
      var e = Q[qi];
      return '<div class="field c6"><div class="flabel-row"><label for="al-'+k+'">'+label+
        (req ? ' <span class="pill-req">Required</span>' : '') + '</label></div>' +
        '<input class="inp" id="al-'+k+'" value="'+esc(e[k]||'')+'" placeholder="'+esc(ph)+'"></div>';
    }
    function sel(k, label, opts, hint){
      var e = Q[qi];
      return '<div class="field c6"><label for="al-'+k+'">'+label+'</label>' +
        '<select class="inp" id="al-'+k+'">' + opts.map(function(o){
          var v = o.id || o, t = o.label || o;
          return '<option value="'+esc(v)+'"'+(e[k]===v?' selected':'')+'>'+esc(t)+'</option>';
        }).join('') + '</select>' + (hint ? '<p class="hint">'+hint+'</p>' : '') + '</div>';
    }
    function paintForm(){
      $('al-form').innerHTML = '<div class="frow">' +
        fld('name','Full name','e.g. Ishita Verma', true) +
        fld('comp','Company','e.g. Wipro', true) +
        fld('desig','Designation','e.g. Head - Customer Experience') +
        fld('email','Email','name@company.com') +
        fld('phone','Mobile','+91 98200 00000') +
        fld('city','City','e.g. Mumbai') +
        sel('industry','Industry', INDUSTRIES) +
        sel('seniority','Seniority', SENIORITY) +
        sel('owner','Assign to', OWNERS, 'Who works this lead.') +
        sel('level','Level', LEVELS, levelMeta(Q[qi].level).note) +
        sel('stage','Starting stage', STAGES) +
      '</div>';
      $('al-name').addEventListener('input', function(){ readForm(); paintQueue(); });
      $('al-level').onchange = function(){
        readForm();
        var h = $('al-level').parentNode.querySelector('.hint');
        if (h) h.textContent = levelMeta(this.value).note;
      };
    }

    $('al-add').onclick = function(){
      readForm(); Q.push(blank()); qi = Q.length - 1;
      paintForm(); paintQueue(); paintSave();
    };
    $('al-cancel').onclick = closeModal;
    $('al-save').onclick = function(){
      readForm();
      var bad = [];
      Q.forEach(function(e, i){ if (!e.name || !e.comp) bad.push(i + 1); });
      if (bad.length){
        $('al-err').textContent = Q.length === 1
          ? 'A name and a company are needed.'
          : (bad.length === 1 ? 'Lead ' + bad[0] + ' needs a name and a company.'
                              : 'Leads ' + bad.join(', ') + ' need a name and a company.');
        qi = bad[0] - 1; paintForm(); paintQueue();
        return;
      }
      D.crmAdded = D.crmAdded || [];
      Q.forEach(function(e){
        var p = makeManual(e);
        D.crmAdded.push(p);
        D.crm[p.id] = { stage:e.stage, owner:e.owner, calls:0, notes:[], next:'',
                        level:e.level, touched:Date.now() };
      });
      save(); closeModal(); redraw();
      ctx.toast(Q.length === 1 ? Q[0].name + ' added to the CRM' : Q.length + ' leads added to the CRM');
    };

    paintQueue(); paintForm(); paintSave();
  }

  /* ---------------------------------------------------------------- CSV import */
  function parseCSV(text){
    var rows = [], row = [], cell = '', q = false;
    text = String(text).replace(/\r\n?/g, '\n');
    for (var i = 0; i < text.length; i++){
      var c = text[i];
      if (q){
        if (c === '"'){ if (text[i+1] === '"'){ cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t'){ row.push(cell); cell = ''; }
      else if (c === '\n'){ row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell.length || row.length){ row.push(cell); rows.push(row); }
    return rows.filter(function(r){ return r.some(function(c){ return String(c).trim(); }); });
  }

  var IMP_FIELDS = [
    { id:'name',  label:'Full name',   req:true,  hints:['name','full name','lead','contact','person'] },
    { id:'comp',  label:'Company',     req:true,  hints:['company','organisation','organization','account','firm'] },
    { id:'desig', label:'Designation', req:false, hints:['designation','title','role','job'] },
    { id:'email', label:'Email',       req:false, hints:['email','e-mail','mail'] },
    { id:'phone', label:'Mobile',      req:false, hints:['phone','mobile','contact number','number'] },
    { id:'city',  label:'City',        req:false, hints:['city','location','town'] }
  ];

  function guessColumn(header, f){
    for (var i = 0; i < header.length; i++){
      var h = String(header[i]).toLowerCase().trim();
      for (var j = 0; j < f.hints.length; j++) if (h === f.hints[j]) return i;
    }
    for (var i2 = 0; i2 < header.length; i2++){
      var h2 = String(header[i2]).toLowerCase().trim();
      for (var j2 = 0; j2 < f.hints.length; j2++) if (h2.indexOf(f.hints[j2]) >= 0) return i2;
    }
    return -1;
  }

  function importDialog(ctx){
    var rows = null, header = [], map = {}, owner = OWNERS[0], level = 'warm';

    modal('Upload leads',
      '<div id="imp-step1">' +
        '<div class="imp-drop" id="imp-drop" tabindex="0" role="button">' + svg(I.layers, 26) +
          '<b>Drop a CSV here</b><span>or click to choose a file. Tab-separated works too.</span></div>' +
        '<p class="hint" style="margin:12px 0 6px">Or paste rows straight from a spreadsheet:</p>' +
        '<textarea class="inp" id="imp-paste" style="min-height:96px;font-family:var(--font-mono);font-size:12px" ' +
          'placeholder="Name,Company,Designation,Email,Mobile,City"></textarea>' +
        '<button class="btn btn-secondary btn-sm" type="button" id="imp-read" style="margin-top:10px">' +
          'Read these rows</button>' +
      '</div><div id="imp-step2" hidden></div>',
      '<span id="imp-err" style="flex:1;font-size:12px;color:var(--accent-strong);align-self:center"></span>' +
      '<button class="btn btn-ghost" type="button" id="imp-cancel">Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="imp-go" disabled>Import</button>', 860);

    function cleanRows(){
      var body = rows.slice(1);
      var out = [], seen = {}, dupes = 0, blanks = 0;
      body.forEach(function(r){
        var rec = {};
        IMP_FIELDS.forEach(function(f){
          var idx = map[f.id];
          rec[f.id] = idx >= 0 && r[idx] != null ? String(r[idx]).trim() : '';
        });
        if (!rec.name || !rec.comp){ blanks++; return; }
        var key = (rec.email || rec.name + '|' + rec.comp).toLowerCase();
        if (seen[key]){ dupes++; return; }
        seen[key] = 1;
        out.push(rec);
      });
      return { ok: out, dupes: dupes, blanks: blanks };
    }

    function paintStep2(){
      header = rows[0].map(function(h){ return String(h).trim(); });
      IMP_FIELDS.forEach(function(f){ if (map[f.id] == null) map[f.id] = guessColumn(header, f); });
      var res = cleanRows();

      $('imp-step1').hidden = true;
      $('imp-step2').hidden = false;
      $('imp-step2').innerHTML =
        '<p class="hint" style="margin:0 0 12px">Found <b>' + comma(rows.length - 1) + '</b> rows. ' +
          'Check each column landed in the right place — the first row is treated as the header.</p>' +
        '<div class="imp-map">' + IMP_FIELDS.map(function(f){
          return '<div class="field"><label for="imp-' + f.id + '">' + f.label +
            (f.req ? ' <span class="pill-req">Required</span>' : '') + '</label>' +
            '<select class="inp" id="imp-' + f.id + '">' +
              '<option value="-1"' + (map[f.id] < 0 ? ' selected' : '') + '>— not in this file —</option>' +
              header.map(function(h, i){
                return '<option value="' + i + '"' + (map[f.id] === i ? ' selected' : '') + '>' +
                  esc(h || ('Column ' + (i+1))) + '</option>';
              }).join('') + '</select></div>';
        }).join('') + '</div>' +

        '<div class="imp-stat">' +
          '<span class="readout good">' + svg(I.check,13) + '<b>' + comma(res.ok.length) + '</b> ready</span>' +
          (res.dupes ? '<span class="readout">' + svg(I.info,13) + '<b>' + comma(res.dupes) + '</b> duplicates skipped</span>' : '') +
          (res.blanks ? '<span class="readout bad">' + svg(I.info,13) + '<b>' + comma(res.blanks) + '</b> missing a name or company</span>' : '') +
        '</div>' +

        '<div class="imp-prev"><table><thead><tr>' +
          IMP_FIELDS.map(function(f){ return '<th>' + esc(f.label) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
          res.ok.slice(0, 8).map(function(r){
            return '<tr>' + IMP_FIELDS.map(function(f){
              return '<td' + (f.req && !r[f.id] ? ' class="bad"' : '') + '>' +
                esc(r[f.id] || '—') + '</td>';
            }).join('') + '</tr>';
          }).join('') +
        '</tbody></table></div>' +

        '<div class="frow" style="margin-top:14px">' +
          '<div class="field c6"><label for="imp-owner">Assign every lead to</label>' +
            '<select class="inp" id="imp-owner">' + OWNERS.map(function(o){
              return '<option' + (owner === o ? ' selected' : '') + '>' + esc(o) + '</option>';
            }).join('') + '</select></div>' +
          '<div class="field c6"><label for="imp-level">Start them at</label>' +
            '<select class="inp" id="imp-level">' + LEVELS.map(function(l){
              return '<option value="' + l.id + '"' + (level === l.id ? ' selected' : '') + '>' +
                l.label + '</option>';
            }).join('') + '</select></div>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="imp-back">Choose a different file</button>';

      IMP_FIELDS.forEach(function(f){
        $('imp-' + f.id).onchange = function(){ map[f.id] = +this.value; paintStep2(); };
      });
      $('imp-owner').onchange = function(){ owner = this.value; };
      $('imp-level').onchange = function(){ level = this.value; };
      $('imp-back').onclick = function(){
        rows = null; map = {};
        $('imp-step2').hidden = true; $('imp-step1').hidden = false;
        $('imp-go').disabled = true;
      };
      $('imp-go').disabled = res.ok.length === 0;
      $('imp-go').textContent = res.ok.length
        ? 'Import ' + comma(res.ok.length) + (res.ok.length === 1 ? ' lead' : ' leads')
        : 'Nothing to import';
    }

    function take(text){
      var parsed = parseCSV(text);
      if (parsed.length < 2){
        $('imp-err').textContent = 'That needs a header row and at least one row of data.';
        return;
      }
      $('imp-err').textContent = '';
      rows = parsed; map = {};
      paintStep2();
    }

    var drop = $('imp-drop');
    function pick(){
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.csv,.tsv,.txt,text/csv,text/plain';
      inp.onchange = function(){
        var f = inp.files && inp.files[0];
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function(){ take(fr.result); };
        fr.onerror = function(){ $('imp-err').textContent = 'That file could not be read.'; };
        fr.readAsText(f);
      };
      inp.click();
    }
    drop.onclick = pick;
    drop.onkeydown = function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); pick(); } };
    drop.addEventListener('dragover', function(e){ e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function(){ drop.classList.remove('over'); });
    drop.addEventListener('drop', function(e){
      e.preventDefault(); drop.classList.remove('over');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function(){ take(fr.result); };
      fr.readAsText(f);
    });
    $('imp-read').onclick = function(){
      var v = $('imp-paste').value.trim();
      if (!v){ $('imp-err').textContent = 'Paste some rows first.'; return; }
      take(v);
    };
    $('imp-cancel').onclick = closeModal;
    $('imp-go').onclick = function(){
      var res = cleanRows();
      if (!res.ok.length) return;
      D.crmAdded = D.crmAdded || [];
      res.ok.forEach(function(r){
        var p = makeManual({ name:r.name, comp:r.comp, desig:r.desig, email:r.email,
                             phone:r.phone, city:r.city, src:'Uploaded list', score:45 });
        D.crmAdded.push(p);
        D.crm[p.id] = { stage:'new', owner:owner, calls:0, notes:[], next:'', level:level, touched:Date.now() };
      });
      save(); closeModal(); redraw();
      ctx.toast(comma(res.ok.length) + ' leads imported and assigned to ' + owner);
    };
  }

  /* ======================================================================
     THE SEND DIALOG

     One composer for both pages, because "email these people" is the
     same job whether the list came from the CRM or the pool. Who gets
     it is the first question, so the audience is chosen first and the
     reachable count moves as you change it - nobody should press send
     and find out afterwards that half the list has no email.
     ====================================================================== */
  var CATEGORIES = [
    { id:'level',    label:'Lead level',       opts: function(){ return LEVELS.map(function(l){ return { v:l.id, t:l.label }; }); },
      test: function(p, v){ return levelOf(p) === v; } },
    { id:'seniority',label:'Seniority',        opts: function(){ return SENIORITY.map(function(s){ return { v:s, t:s }; }); },
      test: function(p, v){ return p.seniority === v; } },
    { id:'industry', label:'Industry',         opts: function(){ return INDUSTRIES.map(function(s){ return { v:s, t:s }; }); },
      test: function(p, v){ return p.industry === v; } },
    { id:'sub',      label:'Subscriber state', opts: function(){ return SUB_STATE.map(function(s){ return { v:s.id, t:s.label }; }); },
      test: function(p, v){ return p.sub === v; } },
    { id:'city',     label:'City',             opts: function(){ return CITY.map(function(s){ return { v:s, t:s }; }); },
      test: function(p, v){ return p.city === v; } },
    { id:'edition',  label:'Past edition',     opts: function(){ return [{v:'1',t:'Attended 1 or more'},{v:'2',t:'Attended 2 or more'},{v:'3',t:'Attended 3 or more'}]; },
      test: function(p, v){ return p.editions >= +v; } }
  ];
  function catById(id){
    for (var i=0;i<CATEGORIES.length;i++) if (CATEGORIES[i].id===id) return CATEGORIES[i];
    return CATEGORIES[0];
  }

  function reachable(list, channel){
    return list.filter(function(p){
      return channel === 'email' ? (p.email && p.sub !== 'unsubscribed') : !!p.phone;
    });
  }

  /* opts: { channel, selected:[people], viewList:[people], viewLabel } */
  function sendDialog(ctx, opts){
    var EV = ctx.EV;
    var channel = opts.channel;
    var isMail = channel === 'email';
    var mode = opts.selected && opts.selected.length ? 'selected' : 'view';
    var catId = 'level', catVal = LEVELS[0].id, batchId = (D.batches[0] || {}).id || '';
    var tplId = '';
    var when = 'now', at = '';

    function audience(){
      if (mode === 'selected') return opts.selected || [];
      if (mode === 'view')     return opts.viewList || [];
      if (mode === 'batch'){
        var b = D.batches.filter(function(x){ return x.id === batchId; })[0];
        return b ? batchMembers(EV, b) : [];
      }
      var c = catById(catId);
      return prospects(EV).filter(function(p){ return c.test(p, catVal); });
    }

    var tpls = D.templates.filter(function(t){ return t.channel === channel; });
    tplId = (tpls[0] || {}).id || '';

    modal((isMail ? 'Email' : 'WhatsApp') + ' a list',
      '<div id="sd-body"></div>',
      '<span id="sd-note" style="flex:1;font-size:12px;color:var(--text-muted);align-self:center"></span>' +
      '<button class="btn btn-ghost" type="button" id="sd-cancel">Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="sd-go"></button>', 720);

    function paint(){
      var list = audience();
      var ok = reachable(list, channel);
      var t = tpls.filter(function(x){ return x.id === tplId; })[0];
      var sample = ok[0] || list[0] || prospects(EV)[0];

      function card(id, title, note, n){
        return '<button class="qview" type="button" data-sdmode="' + id + '" aria-pressed="' +
          (mode === id) + '" style="padding:9px 13px;border-radius:10px;text-align:left;' +
          'display:block;white-space:normal;line-height:1.35">' +
          '<b style="display:block;font-size:12.5px">' + esc(title) + '</b>' +
          '<span style="font-size:11px;font-weight:500;opacity:.8">' + esc(note) + '</span>' +
          (n != null ? '<span class="n" style="display:block;margin-top:3px">' + comma(n) + ' people</span>' : '') +
          '</button>';
      }

      $('sd-body').innerHTML =
        '<div class="field" style="margin-bottom:14px"><label class="flabel">Who gets this</label>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">' +
            (opts.selected && opts.selected.length
              ? card('selected', 'The ones you picked', 'Ticked on the list behind this', opts.selected.length) : '') +
            card('view', 'Everything in this view', opts.viewLabel || 'Whatever the filters currently show',
                 (opts.viewList || []).length) +
            card('category', 'A category', 'Cut the whole pool one way') +
            (D.batches.length ? card('batch', 'A saved batch', 'Built in Audiences') : '') +
          '</div></div>' +

        (mode === 'category'
          ? '<div class="frow" style="margin-bottom:14px">' +
              '<div class="field c6"><label for="sd-cat">Cut by</label>' +
                '<select class="inp" id="sd-cat">' + CATEGORIES.map(function(c){
                  return '<option value="'+c.id+'"'+(catId===c.id?' selected':'')+'>'+esc(c.label)+'</option>';
                }).join('') + '</select></div>' +
              '<div class="field c6"><label for="sd-catval">Which one</label>' +
                '<select class="inp" id="sd-catval">' + catById(catId).opts().map(function(o){
                  return '<option value="'+esc(o.v)+'"'+(catVal===o.v?' selected':'')+'>'+esc(o.t)+'</option>';
                }).join('') + '</select></div>' +
            '</div>'
          : '') +

        (mode === 'batch'
          ? '<div class="field" style="margin-bottom:14px"><label for="sd-batch">Batch</label>' +
              '<select class="inp" id="sd-batch">' + D.batches.map(function(b){
                return '<option value="'+b.id+'"'+(batchId===b.id?' selected':'')+'>'+esc(b.name)+
                  ' (' + comma(batchMembers(EV, b).length) + ')</option>';
              }).join('') + '</select></div>'
          : '') +

        '<div class="imp-stat" style="margin:0 0 14px">' +
          '<span class="readout good">' + svg(I.check,13) + '<b>' + comma(ok.length) + '</b> can be reached</span>' +
          (list.length - ok.length
            ? '<span class="readout bad">' + svg(I.info,13) + '<b>' + comma(list.length - ok.length) + '</b> ' +
              (isMail ? 'have no email or have opted out' : 'have no mobile number') + '</span>'
            : '') +
        '</div>' +

        (tpls.length
          ? '<div class="field" style="margin-bottom:12px"><label for="sd-tpl">Template</label>' +
              '<select class="inp" id="sd-tpl">' + tpls.map(function(x){
                return '<option value="'+x.id+'"'+(tplId===x.id?' selected':'')+'>'+esc(x.name)+'</option>';
              }).join('') + '</select>' +
              '<p class="hint">Built in Studio. Merge tags fill per person.</p></div>' +
            (t ? (isMail && t.subject
                  ? '<div class="field" style="margin-bottom:8px"><label class="flabel">Subject</label>' +
                    '<div class="preview" style="min-height:0">' + esc(merge(t.subject, sample, EV)) + '</div></div>'
                  : '') +
                 '<div class="field" style="margin-bottom:14px"><label class="flabel">Preview &mdash; as ' +
                   esc(sample ? sample.name : 'a recipient') + '</label>' +
                   '<div class="preview">' + esc(merge(t.body, sample, EV)) + '</div></div>'
               : '')
          : '<div class="callout" style="margin-bottom:14px">' + svg(I.info,17) +
            '<span><strong>No ' + (isMail ? 'email' : 'WhatsApp') + ' template yet</strong>' +
            'Build one in Studio first — that is where the copy and the merge tags live.</span></div>') +

        '<div class="frow">' +
          '<div class="field c6"><label for="sd-when">Send</label>' +
            '<select class="inp" id="sd-when">' +
              '<option value="now"' + (when==='now'?' selected':'') + '>Right now</option>' +
              '<option value="later"' + (when==='later'?' selected':'') + '>At a time I pick</option>' +
            '</select></div>' +
          (when === 'later'
            ? '<div class="field c6"><label for="sd-at">When</label>' +
              '<input class="inp" id="sd-at" type="datetime-local" value="'+esc(at)+'"></div>'
            : '') +
        '</div>';

      each('[data-sdmode]', function(el){
        el.onclick = function(){ mode = el.getAttribute('data-sdmode'); paint(); };
      });
      if ($('sd-cat')) $('sd-cat').onchange = function(){
        catId = this.value; catVal = catById(catId).opts()[0].v; paint();
      };
      if ($('sd-catval')) $('sd-catval').onchange = function(){ catVal = this.value; paint(); };
      if ($('sd-batch')) $('sd-batch').onchange = function(){ batchId = this.value; paint(); };
      if ($('sd-tpl')) $('sd-tpl').onchange = function(){ tplId = this.value; paint(); };
      $('sd-when').onchange = function(){ when = this.value; paint(); };
      if ($('sd-at')) $('sd-at').onchange = function(){ at = this.value; };

      $('sd-go').disabled = !ok.length || !tpls.length;
      $('sd-go').textContent = ok.length
        ? (when === 'now' ? 'Send to ' + comma(ok.length) : 'Schedule for ' + comma(ok.length))
        : 'Nobody to send to';
      $('sd-note').textContent = list.length
        ? comma(list.length) + ' in this audience'
        : 'Pick an audience';
    }

    $('sd-cancel').onclick = closeModal;
    $('sd-go').onclick = function(){
      var list = audience(), ok = reachable(list, channel);
      if (!ok.length) return;
      var t = tpls.filter(function(x){ return x.id === tplId; })[0];
      if (when === 'later' && !at){ ctx.toast('Pick a time first'); return; }

      /* a send is a campaign, so it shows up on the Campaigns tab like any other */
      D.campaigns.unshift({
        id: uid('c'),
        name: (t ? t.name : 'Send') + ' — ' + (mode === 'selected' ? 'picked list'
              : mode === 'view' ? 'current view'
              : mode === 'batch' ? 'saved batch' : catById(catId).label),
        channel: channel, templateId: tplId, batchId: mode === 'batch' ? batchId : '',
        status: when === 'now' ? 'sent' : 'scheduled',
        when: when === 'now' ? Date.now() : new Date(at).getTime(),
        sent: when === 'now' ? ok.length : 0,
        delivered: when === 'now' ? Math.round(ok.length * 0.96) : 0,
        opened: 0, clicked: 0, regs: 0
      });

      /* anyone in the CRM who was mailed has been touched */
      ok.forEach(function(p){
        var c = D.crm[p.id];
        if (!c) return;
        if (c.stage === 'new') c.stage = 'contacted';
        c.notes = c.notes || [];
        c.notes.push({ when: Date.now(), text: (isMail ? 'Emailed' : 'WhatsApp sent') + ' - ' + (t ? t.name : 'bulk send') });
        c.touched = Date.now();
      });
      save(); closeModal(); redraw();
      ctx.toast(when === 'now'
        ? comma(ok.length) + (isMail ? ' emails sent' : ' messages sent')
        : comma(ok.length) + ' queued for ' + fmtDate(at));
    };

    paint();
  }

  /* ---------------------------------------------------------------- bulk actions */
  function bulkAction(kind, ctx){
    var ids = selectedIds();
    if (!ids.length) return;
    var L = leads(ctx.EV);
    var picked = L.filter(function(l){ return ids.indexOf(String(l.id)) >= 0; });

    function applyAll(fn, msg){
      picked.forEach(function(l){ fn(l); saveLead(l); });
      closeModal(); redraw(); ctx.toast(msg);
    }

    if (kind === 'export'){
      exportCSV(picked.map(function(l){
        return { Name:l.p.name, Company:l.p.comp, Designation:l.p.desig, Email:l.p.email,
                 Mobile:l.p.phone, Level:levelMeta(l.level).label, Stage:stageById(l.stage).label,
                 Owner:l.owner, Calls:l.calls, Score:l.p.score, 'Follow-up':l.next || '' };
      }), 'crm-leads');
      ctx.toast(picked.length + ' leads exported');
      return;
    }

    if (kind === 'email' || kind === 'whatsapp'){
      sendDialog(ctx, {
        channel: kind,
        selected: picked.map(function(l){ return l.p; }),
        viewList: crmFiltered(ctx.EV).map(function(l){ return l.p; }),
        viewLabel: 'Every lead the CRM filters currently show'
      });
      return;
    }

    if (kind === 'assign'){
      modal('Assign ' + picked.length + (picked.length === 1 ? ' lead' : ' leads'),
        '<div class="field"><label for="bk-owner">Owner</label>' +
          '<select class="inp" id="bk-owner">' + OWNERS.map(function(o){
            return '<option>'+esc(o)+'</option>'; }).join('') + '</select>' +
          '<p class="hint">They see these in their own view straight away.</p></div>',
        '<button class="btn btn-ghost" type="button" id="bk-cancel">Cancel</button>' +
        '<button class="btn btn-primary" type="button" id="bk-go">Assign</button>', 420);
      $('bk-cancel').onclick = closeModal;
      $('bk-go').onclick = function(){
        var o = $('bk-owner').value;
        applyAll(function(l){ l.owner = o; }, picked.length + ' leads assigned to ' + o);
      };
      return;
    }

    if (kind === 'stage' || kind === 'level'){
      var opts = kind === 'stage' ? STAGES : LEVELS;
      modal(kind === 'stage' ? 'Move ' + picked.length + ' to a stage' : 'Set the level on ' + picked.length,
        '<div class="field"><label for="bk-val">' + (kind === 'stage' ? 'Stage' : 'Level') + '</label>' +
          '<select class="inp" id="bk-val">' + opts.map(function(o){
            return '<option value="'+o.id+'">'+esc(o.label)+'</option>'; }).join('') + '</select>' +
          (kind === 'level' ? '<p class="hint">Overrides the score-based level until you change it back.</p>' : '') +
        '</div>',
        '<button class="btn btn-ghost" type="button" id="bk-cancel">Cancel</button>' +
        '<button class="btn btn-primary" type="button" id="bk-go">Apply</button>', 420);
      $('bk-cancel').onclick = closeModal;
      $('bk-go').onclick = function(){
        var v = $('bk-val').value;
        if (kind === 'stage') applyAll(function(l){ l.stage = v; }, picked.length + ' moved to ' + stageById(v).label);
        else applyAll(function(l){ l.level = v; }, picked.length + ' set to ' + levelMeta(v).label);
      };
    }
  }

  function exportCSV(records, name){
    if (!records.length) return;
    var cols = Object.keys(records[0]);
    var q = function(v){
      v = v == null ? '' : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var csv = cols.join(',') + '\n' +
      records.map(function(r){ return cols.map(function(c){ return q(r[c]); }).join(','); }).join('\n');
    try {
      var blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '-' + new Date().toISOString().slice(0,10) + '.csv';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
    } catch(e){}
  }

  /* send a ready-made cut from the pipeline straight into the CRM */
  function recipeMembers(EV, id){
    var all = prospects(EV);
    if (id === 'loyal')      return all.filter(function(p){ return p.editions>=2 && p.sub!=='unsubscribed'; });
    if (id === 'warmnotreg') return all.filter(function(p){ return p.sub==='active' && !p.registered; });
    if (id === 'cxo')        return all.filter(function(p){ return p.seniority==='CXO' && p.sub!=='unsubscribed'; });
    return all.filter(function(p){ return p.editions>=1 && p.sub==='dormant'; });
  }
  function pushToCRM(id, ctx){
    var people = recipeMembers(ctx.EV, id).slice(0, 200);
    var fresh = people.filter(function(p){ return !D.crm[p.id]; });
    modal('Send to the CRM',
      '<p class="hint" style="margin:0 0 14px"><b>' + comma(people.length) + '</b> people in this cut, ' +
        '<b>' + comma(fresh.length) + '</b> not yet worked by anyone. ' +
        'They land in the pipeline at <b>New</b> so nobody loses their place.</p>' +
      '<div class="frow">' +
        '<div class="field c6"><label for="pc-owner">Assign to</label>' +
          '<select class="inp" id="pc-owner">' + OWNERS.map(function(o){
            return '<option>'+esc(o)+'</option>'; }).join('') + '</select></div>' +
        '<div class="field c6"><label for="pc-level">Level</label>' +
          '<select class="inp" id="pc-level">' + LEVELS.map(function(l){
            return '<option value="'+l.id+'"'+(l.id==='warm'?' selected':'')+'>'+l.label+'</option>';
          }).join('') + '</select></div>' +
      '</div>',
      '<button class="btn btn-ghost" type="button" id="pc-cancel">Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="pc-go">Send ' + comma(fresh.length) + ' to the CRM</button>', 480);
    $('pc-cancel').onclick = closeModal;
    $('pc-go').onclick = function(){
      var o = $('pc-owner').value, lv = $('pc-level').value;
      fresh.forEach(function(p){
        D.crm[p.id] = { stage:'new', owner:o, calls:0, notes:[], next:'', level:lv, touched:Date.now() };
      });
      save(); closeModal(); redraw();
      ctx.toast(comma(fresh.length) + ' sent to ' + o + ' in the CRM');
    };
  }

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

          '<div class="dsec"><h4>Level</h4>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' + LEVELS.map(function(x){
              var on = l.level===x.id;
              return '<button class="lvl lvl-'+x.id+'" type="button" data-setlevel="'+x.id+'" ' +
                'style="cursor:pointer;border:1px solid '+(on?'currentColor':'transparent')+';padding:4px 11px">' +
                x.label+'</button>';
            }).join('') + '</div>' +
            '<p class="hint">'+esc(levelMeta(l.level).note)+'</p></div>' +

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
          '<button class="btn btn-secondary btn-sm" type="button" id="ld-wa">'+svg(I.wa,13)+' WhatsApp</button>' +
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
    each('[data-setlevel]', function(el){
      el.onclick = function(){
        l.level = el.getAttribute('data-setlevel');
        saveLead(l); redraw(); openLead(id, ctx);
        ctx.toast(l.p.name + ' is now ' + levelMeta(l.level).label.toLowerCase());
      };
    });
    function logTouch(what){
      if (l.stage === 'new') l.stage = 'contacted';
      l.notes.push({ when: Date.now(), text: what });
      saveLead(l); redraw(); openLead(id, ctx);
      ctx.toast(what);
    }
    $('ld-mail').onclick = function(){
      if (!l.p.email){ ctx.toast('No email on file for ' + l.p.name); return; }
      logTouch('Emailed ' + l.p.email);
    };
    $('ld-wa').onclick = function(){
      if (!l.p.phone){ ctx.toast('No mobile on file for ' + l.p.name); return; }
      logTouch('WhatsApp sent to ' + l.p.phone);
    };
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
    var acts = '';
    if (tab === 'campaigns')
      acts = '<button class="btn btn-primary btn-sm" type="button" data-newcamp="1">'+svg(I.send,13)+' New campaign</button>';
    if (tab === 'crm')
      acts = '<button class="btn btn-secondary btn-sm" type="button" id="crm-import">'+svg(I.layers,13)+' Upload leads</button>' +
             '<button class="btn btn-primary btn-sm" type="button" id="crm-new">'+svg(I.plus,13)+' Add lead</button>';
    if (tab === 'pipeline')
      acts = '<button class="btn btn-secondary btn-sm" type="button" id="pipe-exportall">'+svg(I.down,13)+' Export pool</button>';
    return ctx.vhead(h[0], h[1], acts) +
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
    each('[data-qview]', function(el){
      el.onclick = function(){ U.crmQuick = el.getAttribute('data-qview'); U.crmPage = 1; redraw(); };
    });
    var cq = $('crm-q');
    if (cq) cq.oninput = function(){
      U.crmQ = cq.value; U.crmPage = 1; redraw();
      var n = $('crm-q'); if (n){ n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    };
    var cs = $('crm-stage');
    if (cs) cs.onchange = function(){ U.crmStage = cs.value; U.crmPage = 1; redraw(); };
    var co = $('crm-owner');
    if (co) co.onchange = function(){ U.crmOwner = co.value; U.crmPage = 1; redraw(); };
    var cl = $('crm-level');
    if (cl) cl.onchange = function(){ U.crmLevel = cl.value; U.crmPage = 1; redraw(); };

    /* selection */
    each('[data-pick]', function(el){
      el.onclick = function(e){
        e.stopPropagation();
        var id = el.getAttribute('data-pick');
        if (el.checked) U.crmSel[id] = true; else delete U.crmSel[id];
        redraw();
      };
    });
    var ca = $('crm-all');
    if (ca) ca.onclick = function(){
      var on = ca.checked;
      each('[data-pick]', function(el){
        var id = el.getAttribute('data-pick');
        if (on) U.crmSel[id] = true; else delete U.crmSel[id];
      });
      redraw();
    };
    var clr = $('crm-clearsel');
    if (clr) clr.onclick = function(){ U.crmSel = {}; redraw(); };
    each('[data-bulk]', function(el){
      el.onclick = function(){ bulkAction(el.getAttribute('data-bulk'), ctx); };
    });

    /* sorting */
    each('[data-sort]', function(el){
      el.onclick = function(){
        var k = el.getAttribute('data-sort');
        if (U.crmSort.k === k) U.crmSort.dir = -U.crmSort.dir;
        else U.crmSort = { k:k, dir: (k === 'name' || k === 'comp' || k === 'owner') ? 1 : -1 };
        redraw();
      };
    });

    /* paging, shared by the crm table and the pool */
    each('[data-pg]', function(el){
      el.onclick = function(){
        var bits = el.getAttribute('data-pg').split(':');
        if (bits[0] === 'crm') U.crmPage = Math.max(1, +bits[1]);
        else U.pipePage = Math.max(1, +bits[1]);
        redraw();
      };
    });

    /* dragging a card between board columns is the fastest way to move a stage */
    (function(){
      var dragId = null;
      each('.lead[draggable]', function(card){
        card.addEventListener('dragstart', function(e){
          dragId = card.getAttribute('data-lead');
          card.classList.add('drag');
          try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch(err){}
        });
        card.addEventListener('dragend', function(){
          dragId = null;
          each('.lead', function(c){ c.classList.remove('drag'); });
          each('.bcol', function(c){ c.classList.remove('over'); });
        });
      });
      each('[data-stagecol]', function(col){
        col.addEventListener('dragover', function(e){ if (dragId){ e.preventDefault(); col.classList.add('over'); } });
        col.addEventListener('dragleave', function(){ col.classList.remove('over'); });
        col.addEventListener('drop', function(e){
          if (!dragId) return;
          e.preventDefault();
          col.classList.remove('over');
          var stage = col.getAttribute('data-stagecol');
          var l = leads(ctx.EV).filter(function(x){ return String(x.id) === String(dragId); })[0];
          if (!l || l.stage === stage) return;
          l.stage = stage;
          saveLead(l); redraw();
          ctx.toast(l.p.name + ' moved to ' + stageById(stage).label);
        });
      });
    })();

    var cn = $('crm-new');
    if (cn) cn.onclick = function(){ addLeadDialog(ctx); };
    var ci = $('crm-import');
    if (ci) ci.onclick = function(){ importDialog(ctx); };

    /* pipeline */
    each('[data-ed]', function(el){
      el.onclick = function(){
        var i = +el.getAttribute('data-ed');
        var at = U.pipeEd.indexOf(i);
        if (at >= 0) U.pipeEd.splice(at, 1); else U.pipeEd.push(i);
        U.pipePage = 1; redraw();
      };
    });
    var pec = $('pipe-edclear');
    if (pec) pec.onclick = function(){ U.pipeEd = []; U.pipePage = 1; redraw(); };
    var pq = $('pipe-q');
    if (pq) pq.oninput = function(){
      U.pipeQ = pq.value; U.pipePage = 1; redraw();
      var n = $('pipe-q'); if (n){ n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    };
    var pl = $('pipe-level');
    if (pl) pl.onchange = function(){ U.pipeLevel = pl.value; U.pipePage = 1; redraw(); };
    var ps = $('pipe-sub');
    if (ps) ps.onchange = function(){ U.pipeSub = ps.value; U.pipePage = 1; redraw(); };
    each('[data-tocrm]', function(el){
      el.onclick = function(e){ e.stopPropagation(); pushToCRM(el.getAttribute('data-tocrm'), ctx); };
    });
    each('[data-pipe]', function(el){
      el.onclick = function(){ openLead(el.getAttribute('data-pipe'), ctx); };
    });
    function poolCSV(list){
      return list.map(function(p){
        return { Name:p.name, Company:p.comp, Designation:p.desig, Email:p.email, Mobile:p.phone,
                 City:p.city, Industry:p.industry, Level:levelMeta(levelOf(p)).label, Score:p.score,
                 'Past editions':p.editions, Registered:p.registered ? 'Yes' : 'No',
                 Subscriber:subState(p.sub).label };
      });
    }

    /* the pool gets the same selection machinery as the CRM list */
    each('[data-ppick]', function(el){
      el.onclick = function(e){
        e.stopPropagation();
        var id = el.getAttribute('data-ppick');
        if (el.checked) U.pipeSel[id] = true; else delete U.pipeSel[id];
        redraw();
      };
    });
    var pa = $('pipe-all');
    if (pa) pa.onclick = function(){
      var on = pa.checked;
      each('[data-ppick]', function(el){
        var id = el.getAttribute('data-ppick');
        if (on) U.pipeSel[id] = true; else delete U.pipeSel[id];
      });
      redraw();
    };
    var pclr = $('pipe-clearsel');
    if (pclr) pclr.onclick = function(){ U.pipeSel = {}; redraw(); };

    function pickedPeople(){
      var ids = Object.keys(U.pipeSel).filter(function(k){ return U.pipeSel[k]; });
      return prospects(ctx.EV).filter(function(p){ return ids.indexOf(String(p.id)) >= 0; });
    }
    each('[data-pbulk]', function(el){
      el.onclick = function(){
        var kind = el.getAttribute('data-pbulk');
        var picked = pickedPeople();
        if (!picked.length) return;

        if (kind === 'email' || kind === 'whatsapp'){
          sendDialog(ctx, {
            channel: kind, selected: picked,
            viewList: pipeFiltered(ctx.EV),
            viewLabel: 'Everyone the pool filters currently show'
          });
          return;
        }
        if (kind === 'export'){
          exportCSV(poolCSV(picked), 'pipeline-selection');
          ctx.toast(comma(picked.length) + ' rows exported');
          return;
        }
        if (kind === 'batch'){
          modal('Save as a batch',
            '<div class="field"><label for="pb-name">Batch name</label>' +
              '<input class="inp" id="pb-name" placeholder="e.g. Mumbai CXOs, 2024 edition"></div>' +
              '<p class="hint" style="margin:10px 0 0">' + comma(picked.length) +
              ' people, frozen as they are now. Batches live on the Audiences tab.</p>',
            '<button class="btn btn-ghost" type="button" id="pb-cancel">Cancel</button>' +
            '<button class="btn btn-primary" type="button" id="pb-go">Save batch</button>', 440);
          $('pb-cancel').onclick = closeModal;
          $('pb-go').onclick = function(){
            var nm = $('pb-name').value.trim();
            if (!nm){ ctx.toast('Give the batch a name'); return; }
            var ids = picked.map(function(p){ return p.id; });
            D.batches.push({ id: uid('g'), name: nm, f: emptyFilters(), ids: ids, created: Date.now() });
            save(); closeModal(); redraw();
            ctx.toast('"' + nm + '" saved with ' + comma(ids.length) + ' people');
          };
          return;
        }
        if (kind === 'crm'){
          var fresh = picked.filter(function(p){ return !D.crm[p.id]; });
          modal('Send to the CRM',
            '<p class="hint" style="margin:0 0 14px"><b>' + comma(picked.length) + '</b> selected, ' +
              '<b>' + comma(fresh.length) + '</b> not yet worked by anyone.</p>' +
            '<div class="frow">' +
              '<div class="field c6"><label for="ps-owner">Assign to</label>' +
                '<select class="inp" id="ps-owner">' + OWNERS.map(function(o){
                  return '<option>'+esc(o)+'</option>'; }).join('') + '</select></div>' +
              '<div class="field c6"><label for="ps-level">Level</label>' +
                '<select class="inp" id="ps-level">' + LEVELS.map(function(l){
                  return '<option value="'+l.id+'"'+(l.id==='warm'?' selected':'')+'>'+l.label+'</option>';
                }).join('') + '</select></div>' +
            '</div>',
            '<button class="btn btn-ghost" type="button" id="ps-cancel">Cancel</button>' +
            '<button class="btn btn-primary" type="button" id="ps-go">Send ' + comma(fresh.length) + '</button>', 470);
          $('ps-cancel').onclick = closeModal;
          $('ps-go').onclick = function(){
            var o = $('ps-owner').value, lv = $('ps-level').value;
            fresh.forEach(function(p){
              D.crm[p.id] = { stage:'new', owner:o, calls:0, notes:[], next:'', level:lv, touched:Date.now() };
            });
            U.pipeSel = {};
            save(); closeModal(); redraw();
            ctx.toast(comma(fresh.length) + ' sent to ' + o + ' in the CRM');
          };
        }
      };
    });

    var pml = $('pipe-mail');
    if (pml) pml.onclick = function(){
      sendDialog(ctx, { channel:'email', selected: pickedPeople(),
        viewList: pipeFiltered(ctx.EV), viewLabel:'Everyone the pool filters currently show' });
    };
    var pwa = $('pipe-wa');
    if (pwa) pwa.onclick = function(){
      sendDialog(ctx, { channel:'whatsapp', selected: pickedPeople(),
        viewList: pipeFiltered(ctx.EV), viewLabel:'Everyone the pool filters currently show' });
    };

    var pex = $('pipe-export');
    if (pex) pex.onclick = function(){
      var list = pipeFiltered(ctx.EV);
      exportCSV(poolCSV(list), 'pipeline-filtered');
      ctx.toast(comma(list.length) + ' rows exported');
    };
    var pea = $('pipe-exportall');
    if (pea) pea.onclick = function(){
      var list = prospects(ctx.EV);
      exportCSV(poolCSV(list), 'pipeline-pool');
      ctx.toast(comma(list.length) + ' rows exported');
    };
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
      state: U, bodyHTML: bodyHTML, merge: merge, saveLead: saveLead, stageById: stageById,
      LEVELS: LEVELS, levelOf: levelOf, parseCSV: parseCSV, guessColumn: guessColumn,
      IMP_FIELDS: IMP_FIELDS, crmFiltered: crmFiltered, pipeFiltered: pipeFiltered,
      quickViews: quickViews, makeManual: makeManual
    }
  };
})();
