/* ===========================================================================
   ET Oneworld - Revamp CMS
   Edit Event : MARKETING

   Banners, Email, WhatsApp & SMS, Social sharing, CRM & Leads.

   Split out of edit-event.html so this section can be worked on on its own.
   Everything it needs arrives through `ctx` (see edit-event-core.js ->
   makeCtx) - it never reaches into the shell's scope.

   Open edit-event-marketing.html to work on this section in isolation.
   =========================================================================== */

window.EditEventMarketing = (function(){
  'use strict';

  function viewBanners(ctx){
    var banners = [
      ['Homepage takeover','1440 × 400','Live','ETBrandEquity homepage', 42800],
      ['Sidebar rectangle','300 × 250','Live','Run of network', 128400],
      ['Newsletter strip','600 × 120','Scheduled','Daily newsletter', 0],
      ['Article inline','728 × 90','Paused','Category pages', 18200]
    ];
    var rows = banners.map(function(b){
      var cls = b[2] === 'Live' ? 'b-ok' : b[2] === 'Paused' ? 'b-mute' : 'b-warn';
      return '<tr><td class="td-strong">' + ctx.esc(b[0]) + '</td>' +
        '<td class="num">' + ctx.esc(b[1]) + '</td>' +
        '<td><span class="badge ' + cls + '">' + ctx.esc(b[2]) + '</span></td>' +
        '<td style="color:var(--text-muted)">' + ctx.esc(b[3]) + '</td>' +
        '<td class="num">' + (b[4] ? ctx.comma(b[4]) : '—') + '</td>' +
        '<td style="text-align:right"><button class="btn btn-ghost btn-icon" type="button" data-save="Banner opened">' + ctx.svg(ctx.IC.edit, 14) + '</button></td></tr>';
    }).join('');

    return ctx.vhead('Promotion banners', 'Paid and house placements driving traffic to this microsite.',
        '<button class="btn btn-primary btn-sm" type="button" data-save="Banner builder opened">' + ctx.svg(ctx.IC.plus, 13) + ' New banner</button>') +
      '<div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">' +
        ctx.statTile(ctx.IC.eye,   'Impressions', ctx.compact(189400), { dir:'up', text:'+9.2% this week' }, null) +
        ctx.statTile(ctx.IC.click, 'Clicks', ctx.compact(4120), { dir:'up', text:'2.2% CTR' }, null) +
        ctx.statTile(ctx.IC.users, 'Registrations from banners', ctx.comma(Math.round(ctx.EV.registrations * 0.18)), null, null) +
      '</div>' +
      ctx.panelFlush('Placements', banners.length + ' total',
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>Placement</th><th>Size</th><th>Status</th><th>Runs on</th><th>Impressions</th><th></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }

  function viewEmail(ctx){
    var camps = [
      ['Save the date','Sent','2026-07-14', ctx.EV.mailers, Math.round(ctx.EV.opens * 0.4), Math.round(ctx.EV.clicks * 0.35)],
      ['Speaker announcement','Sent','2026-08-02', Math.round(ctx.EV.mailers * 0.7), Math.round(ctx.EV.opens * 0.35), Math.round(ctx.EV.clicks * 0.4)],
      ['Agenda live','Sent','2026-08-21', Math.round(ctx.EV.mailers * 0.5), Math.round(ctx.EV.opens * 0.25), Math.round(ctx.EV.clicks * 0.25)],
      ['Final reminder','Scheduled','2026-09-22', 0, 0, 0]
    ];
    var rows = camps.map(function(c){
      var open = c[3] ? Math.round(c[4] / c[3] * 100) : 0;
      return '<tr><td class="td-strong">' + ctx.esc(c[0]) + '</td>' +
        '<td>' + (c[1] === 'Sent' ? '<span class="badge b-ok">Sent</span>' : '<span class="badge b-warn">Scheduled</span>') + '</td>' +
        '<td class="num">' + ctx.fmtDate(c[2]) + '</td>' +
        '<td class="num">' + ctx.comma(c[3]) + '</td>' +
        '<td class="num">' + ctx.comma(c[4]) + (c[3] ? ' <span style="color:var(--text-faint)">(' + open + '%)</span>' : '') + '</td>' +
        '<td class="num">' + ctx.comma(c[5]) + '</td>' +
        '<td style="text-align:right"><button class="btn btn-ghost btn-icon" type="button" data-save="Campaign opened">' + ctx.svg(ctx.IC.edit, 14) + '</button></td></tr>';
    }).join('');

    return ctx.vhead('Email Marketing', 'Campaigns sent to the target list for this event.',
        '<button class="btn btn-primary btn-sm" type="button" data-save="Campaign builder opened">' + ctx.svg(ctx.IC.plus, 13) + ' New campaign</button>') +
      '<div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">' +
        ctx.statTile(ctx.IC.send, 'Mailers sent', ctx.compact(ctx.EV.mailers), null, null) +
        ctx.statTile(ctx.IC.open, 'Opens', ctx.compact(ctx.EV.opens), { dir:'up', text: Math.round(ctx.EV.opens / Math.max(ctx.EV.mailers, 1) * 100) + '% open rate' }, null) +
        ctx.statTile(ctx.IC.click,'Clicks', ctx.compact(ctx.EV.clicks), { dir:'up', text: Math.round(ctx.EV.clicks / Math.max(ctx.EV.opens,1) * 100) + '% CTR' }, null) +
        ctx.statTile(ctx.IC.ban,  'Unsubscribes', ctx.comma(ctx.EV.unsub), { dir:'down', text:'0.4% of sends' }, null) +
      '</div>' +
      ctx.panelFlush('Campaigns', camps.length + ' total',
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>Campaign</th><th>Status</th><th>Date</th><th>Sent</th><th>Opens</th><th>Clicks</th><th></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }

  function viewMessaging(ctx){
    var rules = [
      ['7 days before','WhatsApp','All registrations', true],
      ['1 day before','WhatsApp + SMS','All registrations', true],
      ['2 hours before','SMS','Confirmed attendees', true],
      ['Post-event thank you','WhatsApp','Attendees', false],
      ['Feedback survey','WhatsApp','Attendees', false]
    ];
    var rows = rules.map(function(r, i){
      return '<div class="sec-row' + (r[3] ? '' : ' off') + '">' +
        '<span class="nav-ico" style="color:var(--accent);display:grid;place-items:center">' + ctx.svg(ctx.IC.wa, 16) + '</span>' +
        '<span class="sn"><b>' + ctx.esc(r[0]) + '</b><span>' + ctx.esc(r[1]) + ' · ' + ctx.esc(r[2]) + '</span></span>' +
        '<button class="tgl" type="button" data-rem="m' + i + '" aria-pressed="' + r[3] + '">' +
          '<span class="track"><i></i></span>' + (r[3] ? 'On' : 'Off') + '</button>' +
      '</div>';
    }).join('');

    return ctx.vhead('WhatsApp & SMS', 'Reminders and broadcasts on the channels people actually open.',
        '<button class="btn btn-primary btn-sm" type="button" data-save="Broadcast composer opened">' + ctx.svg(ctx.IC.send, 13) + ' Send broadcast</button>') +
      '<div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">' +
        ctx.statTile(ctx.IC.wa,   'WhatsApp sent', ctx.compact(ctx.EV.whatsapp), { dir:'up', text:'94% delivered' }, null) +
        ctx.statTile(ctx.IC.sms,  'SMS sent', ctx.compact(ctx.EV.sms), null, null) +
        ctx.statTile(ctx.IC.click,'Link clicks', ctx.compact(Math.round(ctx.EV.whatsapp * 0.14)), { dir:'up', text:'14% CTR' }, null) +
        ctx.statTile(ctx.IC.bell, 'Active rules', '3 of 5', null, null) +
      '</div>' +
      ctx.panelFlush('Automated reminders', 'Timed against the event start', '<div>' + rows + '</div>');
  }

  function viewSocialShare(ctx){
    var posts = [
      ['Speaker reveal','LinkedIn','Published','2026-08-02', 4820, 186],
      ['Agenda is live','LinkedIn + X','Published','2026-08-21', 3110, 94],
      ['Why you should attend','LinkedIn','Draft','', 0, 0],
      ['Last 50 seats','X','Scheduled','2026-09-18', 0, 0]
    ];
    var rows = posts.map(function(x){
      var cls = x[2] === 'Published' ? 'b-ok' : x[2] === 'Draft' ? 'b-mute' : 'b-warn';
      return '<tr><td class="td-strong">' + ctx.esc(x[0]) + '</td>' +
        '<td>' + ctx.esc(x[1]) + '</td>' +
        '<td><span class="badge ' + cls + '">' + ctx.esc(x[2]) + '</span></td>' +
        '<td class="num">' + (x[3] ? ctx.fmtDate(x[3]) : '—') + '</td>' +
        '<td class="num">' + (x[4] ? ctx.comma(x[4]) : '—') + '</td>' +
        '<td class="num">' + (x[5] ? ctx.comma(x[5]) : '—') + '</td>' +
        '<td style="text-align:right"><button class="btn btn-ghost btn-icon" type="button" data-save="Post opened">' + ctx.svg(ctx.IC.edit, 14) + '</button></td></tr>';
    }).join('');

    return ctx.vhead('Social sharing', 'Posts promoting this event, and what the share card looks like when someone posts the link.',
        '<button class="btn btn-primary btn-sm" type="button" data-save="Post composer opened">' + ctx.svg(ctx.IC.plus, 13) + ' New post</button>') +
      ctx.panelFlush('Posts', posts.length + ' total',
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>Post</th><th>Channel</th><th>Status</th><th>Date</th><th>Impressions</th><th>Engagements</th><th></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>') +
      ctx.panel('Share card preview', 'How the link unfurls on LinkedIn, X and WhatsApp',
        '<div style="max-width:460px;border:1px solid var(--border);border-radius:11px;overflow:hidden">' +
          '<div style="height:120px;background:var(--accent);display:grid;place-items:center;color:#fff;font-family:var(--font-display);font-size:17px;font-weight:700;text-align:center;padding:14px">' +
            ctx.esc(ctx.EV.name) + '</div>' +
          '<div style="padding:11px 13px;background:var(--surface-2)">' +
            '<div style="font-size:10.5px;color:var(--text-faint);font-family:var(--font-mono);text-transform:uppercase">etoneworld.com</div>' +
            '<div style="font-size:13.5px;font-weight:700;margin-top:2px">' + ctx.esc(ctx.EV.name) + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + ctx.esc(ctx.fmtDate(ctx.EV.start)) + ' · ' + ctx.esc(ctx.EV.venue) + '</div>' +
          '</div>' +
        '</div>');
  }

  function viewCRM(ctx){
    var leads = ctx.PEOPLE.slice(0, 18);
    var stages = ['New','Contacted','Interested','Registered','Not reachable'];
    var rows = leads.map(function(p, i){
      var st = stages[i % stages.length];
      var cls = st === 'Registered' ? 'b-ok' : st === 'Interested' ? 'b-info' : st === 'Not reachable' ? 'b-mute' : 'b-warn';
      return '<tr><td><span class="person"><span class="avat" style="background:' + p.colour + '">' + ctx.esc(p.initials) + '</span>' +
        '<span class="pn"><b>' + ctx.esc(p.name) + '</b><span>' + ctx.esc(p.desig) + '</span></span></span></td>' +
        '<td>' + ctx.esc(p.comp) + '</td>' +
        '<td><span class="badge ' + cls + '">' + ctx.esc(st) + '</span></td>' +
        '<td class="num">' + (1 + (i % 5)) + ' calls</td>' +
        '<td class="num">' + ctx.fmtDate(p.when) + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' +
          '<button class="btn btn-ghost btn-icon" type="button" data-save="Dialler opened">' + ctx.svg(ctx.IC.headset, 14) + '</button>' +
          '<button class="btn btn-ghost btn-icon" type="button" data-save="Note added">' + ctx.svg(ctx.IC.edit, 14) + '</button>' +
        '</td></tr>';
    }).join('');

    return ctx.vhead('CRM', 'Call pipeline for this event. ' + ctx.comma(ctx.EV.leads) + ' leads, ' + ctx.comma(ctx.EV.dials) + ' dials logged.',
        '<button class="btn btn-primary btn-sm" type="button" data-save="Leads imported">' + ctx.svg(ctx.IC.plus, 13) + ' Import leads</button>') +
      '<div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">' +
        ctx.statTile(ctx.IC.users,   'Total leads', ctx.comma(ctx.EV.leads), null, null) +
        ctx.statTile(ctx.IC.headset, 'Dials logged', ctx.comma(ctx.EV.dials), null, null) +
        ctx.statTile(ctx.IC.check,   'Converted', ctx.comma(Math.round(ctx.EV.leads * 0.31)), { dir:'up', text:'31% conversion' }, null) +
        ctx.statTile(ctx.IC.clock,   'Pending follow-up', ctx.comma(Math.round(ctx.EV.leads * 0.22)), null, null) +
      '</div>' +
      ctx.panelFlush('Lead pipeline', 'Most recent first',
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>Lead</th><th>Company</th><th>Stage</th><th>Activity</th><th>Added</th><th></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }

  function wireReminders(){
    document.querySelectorAll('[data-rem]').forEach(function(b){
      b.addEventListener('click', function(){
        var on = b.getAttribute('aria-pressed') === 'true';
        b.setAttribute('aria-pressed', String(!on));
        b.lastChild.textContent = !on ? 'On' : 'Off';
        b.closest('.sec-row').classList.toggle('off', on);
        ctx.toast('Reminder rule ' + (!on ? 'enabled' : 'paused'));
      });
    });
  }

  /* tab id -> view. The shell and the standalone workbench both read this. */
  var VIEWS = {
    banners:   viewBanners,
    email:     viewEmail,
    messaging: viewMessaging,
    social:    viewSocialShare,
    leads:     viewCRM
  };

  var TABS = [
    { id:'banners',   label:'Banners' },
    { id:'email',     label:'Email' },
    { id:'messaging', label:'WhatsApp & SMS' },
    { id:'social',    label:'Social' },
    { id:'leads',     label:'CRM & Leads' }
  ];

  function view(tab, ctx){
    var fn = VIEWS[tab] || VIEWS.banners;
    return fn(ctx);
  }

  /* the on/off pills used by the reminder rules */
  function wire(tab, ctx){
    if (tab !== 'messaging') return;
    document.querySelectorAll('[data-rem]').forEach(function(b){
      b.addEventListener('click', function(){
        var on = b.getAttribute('aria-pressed') === 'true';
        b.setAttribute('aria-pressed', String(!on));
        b.lastChild.textContent = !on ? 'On' : 'Off';
        var row = b.closest('.sec-row');
        if (row) row.classList.toggle('off', on);
        ctx.toast('Reminder rule ' + (!on ? 'enabled' : 'paused'));
      });
    });
  }

  return { TABS: TABS, view: view, wire: wire };
})();
