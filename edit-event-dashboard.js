/* ===========================================================================
   ET Oneworld — Revamp CMS
   Edit Event : DASHBOARD

   Split out of edit-event.html so this screen can be worked on on its own.

   It receives everything it needs through `ctx`, so nothing in here reaches
   into the host file's scope. The contract is:

     ctx.EV          the event record
     ctx.S           persisted prototype state (ctx.save() writes it)
     ctx.IC          icon path table
     ctx.svg(p,size) wrap icon paths in an <svg>
     ctx.esc(s)      HTML-escape
     ctx.comma(n)    1234 -> "1,234"
     ctx.compact(n)  387000 -> "3.87 Lacs"
     ctx.statTile(...)  ctx.panel(...)  ctx.panelFlush(...)  ctx.vhead(...)
     ctx.$(id)       getElementById
     ctx.go(route)   navigate, e.g. 'audience/reg'
     ctx.toast(msg)  transient confirmation
     ctx.render()    re-render the current view
   =========================================================================== */

window.EditEventDashboard = (function(){
  'use strict';

  /* Which four numbers earn a tile.
     Mailer / WhatsApp / SMS / dial counts deliberately live under Marketing,
     next to the controls that move them — a dashboard number you cannot act
     on from the dashboard is just decoration. */
  function tiles(ctx){
    var e = ctx.EV, IC = ctx.IC;
    var conv   = e.visitors ? (e.registrations / e.visitors * 100) : 0;
    var regPct = e.regTarget ? Math.min(100, Math.round(e.registrations / e.regTarget * 100)) : null;

    return [
      ctx.statTile(IC.users, 'Registrations', ctx.comma(e.registrations),
        regPct != null ? { dir:'up', text: regPct + '% of target' } : { dir:'up', text:'+31 today' },
        'audience/reg'),

      ctx.statTile(IC.eye, 'Unique visitors', ctx.compact(e.visitors),
        { dir:'up', text:'+12.4% this week' }, 'audience/insights'),

      ctx.statTile(IC.click, 'Visitor to registration', conv.toFixed(1) + '%',
        { dir: conv >= 8 ? 'up' : 'down', text: conv >= 8 ? 'Above benchmark' : 'Below the 8% benchmark' },
        'audience/insights'),

      e.payment.type === 'paid'
        ? ctx.statTile(IC.money, 'Revenue', ctx.compact(e.payment.amount),
            { dir:'up', text: ctx.comma(e.payment.txns) + ' transactions' }, 'audience/payments')
        : ctx.statTile(IC.ticket, 'Seats left',
            regPct != null ? ctx.comma(Math.max(0, e.regTarget - e.registrations)) : 'Unlimited',
            { dir:'flat', text:'Free event' }, 'audience/reg')
    ].join('');
  }

  /* Trapezoid funnel: each stage is clipped from its own width down to the
     next stage's width, so the taper is the real drop-off, not decoration. */
  function funnel(ctx){
    var e = ctx.EV;
    var stages = [
      { label:'Visitors',      n: e.visitors,      col:'#12A870' },
      { label:'Registrations', n: e.registrations, col:'#E89B0C' },
      { label:'Payments',      n: e.payment.type === 'paid' ? e.payment.txns : 0, col:'#7C4DBE' },
      { label:'Attendees',     n: e.attendees,     col:'#ED1C24' }
    ];
    var top = Math.max(stages[0].n, 1);

    return stages.map(function(st, i){
      var wNow  = Math.max(30, (st.n / top) * 100);
      var next  = stages[i + 1];
      var wNext = next ? Math.max(30, (next.n / top) * 100) : wNow * 0.82;
      var in1 = (100 - wNow) / 2, in2 = (100 - wNext) / 2;
      var pct = i === 0 ? '100%' : Math.round(st.n / top * 1000) / 10 + '%';
      return '<div class="fstage" style="background:' + st.col + ';clip-path:polygon(' +
          in1 + '% 0, ' + (100 - in1) + '% 0, ' + (100 - in2) + '% 100%, ' + in2 + '% 100%)">' +
          '<b>' + st.label + '</b><span>' + ctx.comma(st.n) + '</span>' +
          '<span class="pct">' + pct + '</span>' +
        '</div>';
    }).join('');
  }

  /* The four things people actually open this screen to do. */
  function quickActions(ctx){
    var IC = ctx.IC;
    return [
      ['Edit the site',     'Open the visual editor',                     IC.brush, 'design/editor'],
      ['Add a speaker',     'The line-up drives registrations',           IC.users, 'content/speakers'],
      ['Send a mailer',     'Reach your target list',                     IC.send,  'marketing/email'],
      ['See registrations', ctx.comma(ctx.EV.registrations) + ' so far',  IC.chart, 'audience/reg']
    ].map(function(q){
      return '<button class="check-row" type="button" data-goto="' + q[3] + '" ' +
          'style="border:1px solid var(--border);background:var(--surface)">' +
          '<span style="color:var(--accent);display:grid;place-items:center">' + ctx.svg(q[2], 17) + '</span>' +
          '<span class="ct">' + ctx.esc(q[0]) +
            '<span style="display:block;font-size:11.5px;font-weight:600;color:var(--text-muted)">' +
            ctx.esc(q[1]) + '</span></span>' +
          '<span style="color:var(--text-faint)">' + ctx.svg(IC.caret, 13) + '</span>' +
        '</button>';
    }).join('');
  }

  function activityFeed(ctx){
    var acts = [
      ['September 10th, 01:31 PM', 'Content',   'Speaker added',         'Abhishek Rawat'],
      ['September 9th, 03:49 PM',  'Content',   'Sponsor group created', 'Vishakha Singh'],
      ['September 9th, 03:48 PM',  'Design',    'Hero banner replaced',  'Vishakha Singh'],
      ['September 8th, 06:12 PM',  'Audience',  'Pass price updated',    'Ayush Vishwakarma'],
      ['September 8th, 11:02 AM',  'Marketing', 'Reminder scheduled',    'Ayush Vishwakarma']
    ];
    return acts.map(function(a){
      return '<div class="feed-item"><span class="feed-dot"></span><div class="feed-body">' +
          '<div class="feed-when">' + ctx.esc(a[0]) + '</div>' +
          '<div class="feed-what">' + ctx.esc(a[1]) + '<span class="sep">&rsaquo;</span>' + ctx.esc(a[2]) + '</div>' +
          '<div class="feed-who">changed by ' + ctx.esc(a[3]) + '</div>' +
        '</div></div>';
    }).join('');
  }

  var STEPS = [
    ['basics',   'Basic details filled',         'content/basics'],
    ['sections', 'Page sections chosen',         'design/sections'],
    ['speakers', 'Speakers added',               'content/speakers'],
    ['agenda',   'Agenda published',             'content/agenda'],
    ['sponsors', 'Sponsors and partners',        'content/sponsors'],
    ['form',     'Registration form configured', 'settings/form'],
    ['seo',      'SEO and social preview',       'settings/seo']
  ];

  function checklist(ctx){
    var S = ctx.S;
    if (!S.checklist){
      S.checklist = { basics:true, sections:true, speakers:true, agenda:false, sponsors:true, form:true, seo:false };
    }
    var doneN = STEPS.filter(function(x){ return S.checklist[x[0]]; }).length;
    var pct = Math.round(doneN / STEPS.length * 100);

    return {
      doneN: doneN,
      total: STEPS.length,
      html:
        '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px">' +
          '<b style="font-size:22px;font-family:var(--font-display)">' + pct + '%</b>' +
          '<span style="font-size:12.5px;color:var(--text-muted)">' + doneN + ' of ' + STEPS.length + ' steps done</span>' +
        '</div>' +
        '<div class="prog' + (pct === 100 ? ' ok' : '') + '" style="margin-bottom:13px">' +
          '<i style="width:' + pct + '%"></i></div>' +
        '<div class="check-list">' + STEPS.map(function(x){
          var done = !!S.checklist[x[0]];
          return '<button class="check-row' + (done ? ' done' : '') + '" type="button" ' +
              'data-chk="' + x[0] + '" data-to="' + x[2] + '" ' +
              'title="Click to open. Shift-click to tick off.">' +
              '<span class="cb">' + ctx.svg(ctx.IC.check, 12) + '</span>' +
              '<span class="ct">' + ctx.esc(x[1]) + '</span>' +
              '<span style="color:var(--text-faint)">' + ctx.svg(ctx.IC.caret, 13) + '</span>' +
            '</button>';
        }).join('') + '</div>'
    };
  }

  /* ---------------------------------------------------------------- view */
  function view(ctx){
    var e = ctx.EV;
    var regPct = e.regTarget ? Math.min(100, Math.round(e.registrations / e.regTarget * 100)) : null;
    var chk = checklist(ctx);

    var right = '<button class="btn btn-secondary btn-sm" type="button" id="btn-sync">' +
      ctx.svg(ctx.IC.clock, 13) + ' Sync now</button>';

    return ctx.vhead('Dashboard',
        'How this event is actually doing. Campaign and channel counts live under Marketing.', right) +

      '<div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">' + tiles(ctx) + '</div>' +

      (regPct != null
        ? '<div class="panel"><div class="panel-body">' +
            '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:7px">' +
              '<b>Registration target</b>' +
              '<span class="num">' + ctx.comma(e.registrations) + ' of ' + ctx.comma(e.regTarget) + '</span>' +
            '</div>' +
            '<div class="prog' + (regPct >= 100 ? ' ok' : '') + '"><i style="width:' + regPct + '%"></i></div>' +
          '</div></div>'
        : '') +

      '<div class="split">' +
        '<div>' +
          ctx.panel('Conversion funnel', 'Where people drop off',
            '<div class="funnel">' + funnel(ctx) + '</div>') +
          ctx.panelFlush('Recent activity', 'Latest changes to this event',
            '<div class="feed">' + activityFeed(ctx) + '</div>') +
        '</div>' +
        '<div>' +
          ctx.panel('Jump back in', '', '<div class="check-list">' + quickActions(ctx) + '</div>') +
          ctx.panel('Before you publish', chk.doneN + ' of ' + chk.total + ' done', chk.html) +
        '</div>' +
      '</div>';
  }

  /* ---------------------------------------------------------------- wire */
  function wire(ctx){
    var sync = ctx.$('btn-sync');
    if (sync) sync.onclick = function(){
      ctx.toast('Synced. Figures are current as of now.');
      ctx.render();
    };

    document.querySelectorAll('[data-chk]').forEach(function(b){
      b.addEventListener('click', function(ev){
        /* shift-click ticks the step off; a plain click goes and does it */
        if (ev.shiftKey){
          var k = b.getAttribute('data-chk');
          ctx.S.checklist[k] = !ctx.S.checklist[k];
          ctx.save();
          ctx.render();
          return;
        }
        ctx.go(b.getAttribute('data-to'));
      });
    });
  }

  return { view: view, wire: wire };
})();
