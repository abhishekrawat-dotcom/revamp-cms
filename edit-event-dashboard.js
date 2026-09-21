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
     ctx.rnd(seed)   deterministic pseudo-random, 0..1
     ctx.statTile(...)  ctx.panel(...)  ctx.panelFlush(...)  ctx.vhead(...)
     ctx.$(id)       getElementById
     ctx.go(route)   navigate, e.g. 'audience/reg'
     ctx.toast(msg)  transient confirmation
     ctx.render()    re-render the current view

   The numbers here are meant to agree with the registrations report
   (audience-registrations.html), not repeat generic traffic stats next to
   it. Email quality and per-person status live in that report's own
   localStorage store, keyed by event — this file reads the same store
   read-only, so a decision made there is reflected here without owning it.
   =========================================================================== */

window.EditEventDashboard = (function(){
  'use strict';

  /* ---------------------------------------------------------------- shared story data
     Mirrors the exact seed formula audience-registrations.html uses to
     classify addresses, so the two screens never disagree about the same
     person. Only the bucket counts are needed here, not the fake emails. */
  function classifyPeople(ctx){
    var EV = ctx.EV, q = { official: 0, personal: 0, junk: 0 };
    ctx.PEOPLE.forEach(function(p, i){
      var s = EV.eventNo + i * 7;
      var roll = ctx.rnd(s + 21);
      var k = roll > 0.955 ? 'junk' : (roll > 0.775 ? 'personal' : 'official');
      p.__quality = k;
      q[k]++;
    });
    q.total = ctx.PEOPLE.length;
    return q;
  }

  /* The registrations report keeps per-person decisions (and its activity
     log) in its own store. Read-only here — this screen never writes it. */
  function readReportStore(EV){
    var out = { status: {}, activity: [] };
    try {
      var raw = localStorage.getItem('revamp-reg-report-' + EV.id);
      if (raw){
        var p = JSON.parse(raw);
        if (p && p.status) out.status = p.status;
        if (p && p.activity) out.activity = p.activity;
      }
    } catch(e){}
    return out;
  }

  var STATUS_META = {
    pending:   { label: 'Pending',    colour: 'var(--text-faint)' },
    confirmed: { label: 'Confirmed',  colour: 'var(--ok)' },
    waitlist:  { label: 'Waitlisted', colour: 'var(--warn)' },
    regretted: { label: 'Regretted',  colour: 'var(--accent)' }
  };
  var STATUS_ORDER = ['pending', 'confirmed', 'waitlist', 'regretted'];

  function decisionCounts(ctx, store){
    var counts = { pending: 0, confirmed: 0, waitlist: 0, regretted: 0 };
    ctx.PEOPLE.forEach(function(p){
      var k = store.status[p.id] || 'pending';
      if (!counts.hasOwnProperty(k)) k = 'pending';
      counts[k]++;
    });
    return counts;
  }

  function topCompanies(ctx, limit){
    var map = {};
    ctx.PEOPLE.forEach(function(p){
      if (!map[p.comp]) map[p.comp] = { n: 0, official: 0, paid: 0 };
      map[p.comp].n++;
      if (p.__quality === 'official') map[p.comp].official++;
      if (p.paid) map[p.comp].paid++;
    });
    return Object.keys(map).map(function(k){
      return { name: k, n: map[k].n, official: map[k].official, paid: map[k].paid };
    }).sort(function(a, b){ return b.n - a.n; }).slice(0, limit || 5);
  }

  /* Small inline trend line — deterministic, seeded off the event, so a
     tile shows the same shape on every reload without a real time series. */
  function sparkline(ctx, seed, colour){
    var w = 60, h = 22, n = 7, vals = [];
    for (var i = 0; i < n; i++) vals.push(0.2 + ctx.rnd(seed + i * 4) * 0.75);
    var stepX = w / (n - 1);
    var line = vals.map(function(v, i){ return (i * stepX).toFixed(1) + ',' + (h - v * h).toFixed(1); }).join(' ');
    var area = '0,' + h + ' ' + line + ' ' + w + ',' + h;
    return '<svg class="dp-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<polyline points="' + area + '" fill="' + colour + '" opacity="0.14" stroke="none"/>' +
        '<polyline points="' + line + '" fill="none" stroke="' + colour + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  function pill(tone, text){
    return '<span class="dp-pill dp-pill-' + tone + '">' + text + '</span>';
  }

  /* ---------------------------------------------------------------- hero tiles */
  function heroTiles(ctx, q, counts){
    var e = ctx.EV, IC = ctx.IC;
    var regPct = e.regTarget ? Math.min(100, Math.round(e.registrations / e.regTarget * 100)) : null;
    var reach = q.total - q.junk;
    var reachPct = q.total ? Math.round(reach / q.total * 100) : 100;
    var pendingN = counts.pending;

    function tile(goto_, colour, ico, label, value, spark, pillHtml){
      return '<button class="dp-tile" type="button" data-goto="' + goto_ + '">' +
          '<span class="dp-tile-top">' +
            '<span class="dp-tile-ico" style="background:' + colour + '1A;color:' + colour + '">' + ctx.svg(ico, 16) + '</span>' +
            spark +
          '</span>' +
          '<span class="dp-tile-lb">' + ctx.esc(label) + '</span>' +
          '<span class="dp-tile-v">' + ctx.esc(value) + '</span>' +
          pillHtml +
        '</button>';
    }

    var t1 = tile('audience/reg', 'var(--accent)', IC.users, 'Registrations', ctx.comma(e.registrations),
      sparkline(ctx, e.eventNo + 1, 'var(--accent)'),
      regPct != null ? pill('up', ctx.svg(IC.up, 11) + regPct + '% of target') : pill('up', ctx.svg(IC.up, 11) + '+31 today'));

    var t2 = tile('audience/insights', 'var(--info)', IC.shield, 'Reachable audience', ctx.comma(reach),
      sparkline(ctx, e.eventNo + 2, 'var(--info)'),
      q.junk > 0 ? pill('warn', reachPct + '% of list · ' + ctx.comma(q.junk) + ' would bounce') : pill('up', 'All addresses reachable'));

    var t3 = e.payment.type === 'paid'
      ? tile('audience/payments', 'var(--ok)', IC.money, 'Revenue', ctx.compact(e.payment.amount),
          sparkline(ctx, e.eventNo + 3, 'var(--ok)'),
          pill('up', ctx.comma(e.payment.txns) + ' transactions'))
      : tile('audience/reg', 'var(--ok)', IC.ticket, 'Seats left',
          regPct != null ? ctx.comma(Math.max(0, e.regTarget - e.registrations)) : 'Unlimited',
          sparkline(ctx, e.eventNo + 3, 'var(--ok)'),
          pill('flat', 'Free event'));

    var t4 = tile('audience/reg', 'var(--review)', IC.badge2, 'Decisions pending', ctx.comma(pendingN),
      sparkline(ctx, e.eventNo + 4, 'var(--review)'),
      pendingN > 0 ? pill('warn', 'Needs review') : pill('up', 'All triaged'));

    return t1 + t2 + t3 + t4;
  }

  /* ---------------------------------------------------------------- decisions panel */
  function decisionsBars(ctx, counts){
    var total = ctx.PEOPLE.length || 1;
    return STATUS_ORDER.map(function(k){
      var n = counts[k], pct = Math.round(n / total * 100), m = STATUS_META[k];
      return '<div class="dp-bar-row">' +
          '<div class="dp-bar-lb"><b>' + m.label + '</b><span>' + ctx.comma(n) + ' &middot; ' + pct + '%</span></div>' +
          '<div class="dp-bar-track"><i style="width:' + pct + '%;background:' + m.colour + '"></i></div>' +
        '</div>';
    }).join('');
  }

  /* ---------------------------------------------------------------- registration quality */
  function qualityPanel(ctx, q){
    var total = q.total || 1;
    var segs = [
      { k: 'official', label: 'Official', colour: 'var(--ok)', n: q.official },
      { k: 'personal', label: 'Personal', colour: 'var(--warn)', n: q.personal },
      { k: 'junk',     label: 'Junk / risky', colour: 'var(--accent)', n: q.junk }
    ];
    var stack = segs.map(function(s){
      var pct = Math.round(s.n / total * 100);
      return pct > 0 ? '<i style="width:' + pct + '%;background:' + s.colour + '" title="' + s.label + ' ' + pct + '%"></i>' : '';
    }).join('');
    var legend = segs.map(function(s){
      var pct = Math.round(s.n / total * 100);
      return '<span class="dp-legend-item"><span class="dp-dot" style="background:' + s.colour + '"></span>' +
        s.label + '<b>' + pct + '%</b></span>';
    }).join('');
    return '<div class="dp-stack">' + stack + '</div><div class="dp-legend">' + legend + '</div>';
  }

  /* ---------------------------------------------------------------- top companies */
  function companiesPanel(ctx, rows){
    if (!rows.length) return ctx.emptyState(ctx.IC.bldg, 'No registrations yet', 'Companies show up here once people start registering.');
    var max = rows[0].n || 1;
    return rows.map(function(r){
      var officialPct = r.n ? Math.round(r.official / r.n * 100) : 0;
      return '<div class="dp-comp-row">' +
          '<span class="dp-comp-ico">' + ctx.svg(ctx.IC.bldg, 15) + '</span>' +
          '<span class="dp-comp-name"><b>' + ctx.esc(r.name) + '</b>' +
            '<span>' + officialPct + '% official email &middot; ' + ctx.comma(r.paid) + ' paid</span></span>' +
          '<span class="dp-comp-bar"><i style="width:' + Math.round(r.n / max * 100) + '%"></i></span>' +
          '<span class="dp-comp-n">' + ctx.comma(r.n) + '</span>' +
        '</div>';
    }).join('');
  }

  /* ---------------------------------------------------------------- quick actions */
  function quickActions(ctx){
    var IC = ctx.IC;
    return [
      ['Edit the site',     'Open the visual editor',                    IC.brush, 'design/editor'],
      ['Add a speaker',     'The line-up drives registrations',          IC.users, 'content/speakers'],
      ['Send a mailer',     'Reach your target list',                    IC.send,  'marketing/email'],
      ['See registrations', ctx.comma(ctx.EV.registrations) + ' so far', IC.chart, 'audience/reg']
    ].map(function(q){
      return '<button class="dp-action" type="button" data-goto="' + q[3] + '">' +
          '<span class="dp-action-ico">' + ctx.svg(q[2], 17) + '</span>' +
          '<span class="dp-action-ct"><b>' + ctx.esc(q[0]) + '</b><span>' + ctx.esc(q[1]) + '</span></span>' +
          '<span class="dp-action-go">' + ctx.svg(IC.caret, 13) + '</span>' +
        '</button>';
    }).join('');
  }

  /* ---------------------------------------------------------------- activity feed
     Prefers the registrations report's real activity log (same event, read
     read-only from its localStorage store); falls back to a short sample
     so a brand-new event doesn't render an empty panel. */
  var ACT_ICON = {
    send: ['send', 'var(--accent)'], shortlist: ['star', 'var(--review)'],
    list: ['badge2', 'var(--info)'], status: ['badge2', 'var(--ok)'],
    junk: ['ban', 'var(--warn)'], export: ['down', 'var(--text-muted)'],
    view: ['eye', 'var(--review)']
  };

  function timeAgo(iso){
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    var sec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (sec < 60) return 'just now';
    var min = Math.round(sec / 60);
    if (min < 60) return min + (min === 1 ? ' minute ago' : ' minutes ago');
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
    var day = Math.round(hr / 24);
    return day + (day === 1 ? ' day ago' : ' days ago');
  }

  function activityFeed(ctx, store){
    var live = store.activity || [];
    if (live.length){
      return live.slice(0, 6).map(function(a){
        var m = ACT_ICON[a.kind] || ACT_ICON.view;
        return '<div class="dp-feed-item">' +
            '<span class="dp-feed-ico" style="background:' + m[1] + '1A;color:' + m[1] + '">' + ctx.svg(ctx.IC[m[0]] || ctx.IC.check, 13) + '</span>' +
            '<div class="dp-feed-body"><div class="dp-feed-text">' + ctx.esc(a.text) + '</div>' +
              '<div class="dp-feed-when">' + timeAgo(a.when) + '</div></div>' +
          '</div>';
      }).join('');
    }
    var acts = [
      ['September 10th, 01:31 PM', 'Content',   'Speaker added',         'Abhishek Rawat'],
      ['September 9th, 03:49 PM',  'Content',   'Sponsor group created', 'Vishakha Singh'],
      ['September 9th, 03:48 PM',  'Design',    'Hero banner replaced',  'Vishakha Singh'],
      ['September 8th, 06:12 PM',  'Audience',  'Pass price updated',    'Ayush Vishwakarma'],
      ['September 8th, 11:02 AM',  'Marketing', 'Reminder scheduled',    'Ayush Vishwakarma']
    ];
    return acts.map(function(a){
      return '<div class="dp-feed-item">' +
          '<span class="dp-feed-ico" style="background:var(--surface-3);color:var(--text-muted)">' + ctx.svg(ctx.IC.clock, 13) + '</span>' +
          '<div class="dp-feed-body"><div class="dp-feed-text">' + ctx.esc(a[1]) + ' <span class="dp-feed-sep">&rsaquo;</span> ' + ctx.esc(a[2]) + '</div>' +
            '<div class="dp-feed-when">' + ctx.esc(a[0]) + ' &middot; ' + ctx.esc(a[3]) + '</div></div>' +
        '</div>';
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
        '<div class="dp-chk-head">' +
          '<b class="dp-chk-pct">' + pct + '%</b>' +
          '<span>' + doneN + ' of ' + STEPS.length + ' steps done</span>' +
        '</div>' +
        '<div class="dp-track" style="margin-bottom:13px"><i style="width:' + pct + '%;background:' + (pct === 100 ? 'var(--ok)' : 'var(--accent)') + '"></i></div>' +
        '<div class="dp-check-list">' + STEPS.map(function(x){
          var done = !!S.checklist[x[0]];
          return '<button class="dp-action dp-chk-row' + (done ? ' done' : '') + '" type="button" ' +
              'data-chk="' + x[0] + '" data-to="' + x[2] + '" ' +
              'title="Click to open. Shift-click to tick off.">' +
              '<span class="dp-chk-cb">' + ctx.svg(ctx.IC.check, 12) + '</span>' +
              '<span class="dp-action-ct"><b>' + ctx.esc(x[1]) + '</b></span>' +
              '<span class="dp-action-go">' + ctx.svg(ctx.IC.caret, 13) + '</span>' +
            '</button>';
        }).join('') + '</div>'
    };
  }

  var STATUS_TAG = {
    draft:     { tone: 'b-warn', label: 'Draft' },
    upcoming:  { tone: 'b-info', label: 'Upcoming' },
    active:    { tone: 'b-ok',   label: 'Registrations open' },
    completed: { tone: 'b-mute', label: 'Completed' }
  };

  /* ---------------------------------------------------------------- view */
  function view(ctx){
    var e = ctx.EV;
    var regPct = e.regTarget ? Math.min(100, Math.round(e.registrations / e.regTarget * 100)) : null;
    var conv = e.visitors ? (e.registrations / e.visitors * 100) : 0;
    var q = classifyPeople(ctx);
    var store = readReportStore(e);
    var counts = decisionCounts(ctx, store);
    var chk = checklist(ctx);
    var tag = STATUS_TAG[e.status] || STATUS_TAG.upcoming;

    var right = '<span class="badge ' + tag.tone + '">' + ctx.esc(tag.label) + '</span>' +
      '<button class="btn btn-secondary btn-sm" type="button" id="btn-sync">' +
      ctx.svg(ctx.IC.clock, 13) + ' Sync now</button>';

    return ctx.vhead('Dashboard',
        'How this event is actually doing. Campaign and channel counts live under Marketing.', right) +

      '<div class="dp-hero">' + heroTiles(ctx, q, counts) + '</div>' +

      (regPct != null
        ? '<div class="dp-card dp-target">' +
            '<div class="dp-target-top">' +
              '<b>Registration target</b>' +
              '<span class="dp-mono">' + ctx.comma(e.registrations) + ' of ' + ctx.comma(e.regTarget) + '</span>' +
            '</div>' +
            '<div class="dp-track dp-track-lg"><i style="width:' + regPct + '%;background:' + (regPct >= 100 ? 'var(--ok)' : 'var(--accent)') + '"></i></div>' +
          '</div>'
        : '') +

      '<div class="dp-split">' +
        '<div class="dp-col">' +
          '<div class="dp-card">' +
            '<div class="dp-card-head"><h3>Decisions</h3>' +
              '<span class="dp-sub">' + ctx.comma(e.visitors) + ' visitors &middot; ' + conv.toFixed(1) + '% converted to a registration</span>' +
            '</div>' +
            decisionsBars(ctx, counts) +
            (counts.pending > 0
              ? '<button class="btn btn-secondary btn-sm" type="button" data-goto="audience/reg" style="margin-top:12px">Review the ' + ctx.comma(counts.pending) + ' pending</button>'
              : '') +
          '</div>' +
          '<div class="dp-card">' +
            '<div class="dp-card-head"><h3>Registration quality</h3>' +
              '<span class="dp-sub">Official addresses are the only ones a mailer should be built around</span>' +
            '</div>' +
            qualityPanel(ctx, q) +
          '</div>' +
          '<div class="dp-card dp-card-flush">' +
            '<div class="dp-card-head"><h3>Recent activity</h3><span class="dp-sub">Latest changes to this event</span></div>' +
            '<div class="dp-feed">' + activityFeed(ctx, store) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="dp-col">' +
          '<div class="dp-card">' +
            '<div class="dp-card-head"><h3>Top companies</h3><span class="dp-sub">By registration count</span></div>' +
            companiesPanel(ctx, topCompanies(ctx, 5)) +
          '</div>' +
          '<div class="dp-card">' +
            '<div class="dp-card-head"><h3>Jump back in</h3></div>' +
            '<div class="dp-action-list">' + quickActions(ctx) + '</div>' +
          '</div>' +
          '<div class="dp-card">' +
            '<div class="dp-card-head"><h3>Before you publish</h3><span class="dp-sub">' + chk.doneN + ' of ' + chk.total + ' done</span></div>' +
            chk.html +
          '</div>' +
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
