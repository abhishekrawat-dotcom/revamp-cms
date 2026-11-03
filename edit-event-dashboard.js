/* ===========================================================================
   Oneworld 2.0
   Edit Event : DASHBOARD

   Split out of edit-event.html so this screen can be worked on on its own.

   Every number, line and tick on it is read from the server, or the place says it is not known:
     - the figures: GET /api/event/dashboard-stats (RevampCore.fetchStats) — the same totals as Reporting and
       the events list; page views only where the live site counts them (visitsCounted)
     - Recent activity: the newest rows of the event's Activity log (RevampCore.fetchActivityLog)
     - where the site stands: RevampCore.siteState(EV, approval), the one reading the header chip and
       Settings › Visibility use too
     - Ready to publish: worked out from the event, its Content records and its forms; never ticked by hand

   It receives everything it needs through `ctx`, so nothing in here reaches
   into the host file's scope. The contract is:

     ctx.EV          the event record
     ctx.IC          icon path table
     ctx.svg(p,size) wrap icon paths in an <svg>
     ctx.esc(s)      HTML-escape
     ctx.comma(n)    1234 -> "1,234"
     ctx.fmtDate(v)  "14 Mar 2027"
     ctx.statTile(...)  ctx.panel(...)  ctx.panelFlush(...)  ctx.vhead(...)
     ctx.$(id)       getElementById
     ctx.go(route)   navigate, e.g. 'audience/reg'
     ctx.render()    re-render the current view
     ctx.toastError(errOrMsg, { what })  something did not happen; stays until dismissed
   and, from the console (each is optional: without it that part says it is not known):
     ctx.approval()        fetchApproval's answer for the event (+ rejectNote), or null while not known
     ctx.refreshState()    -> promise: the event's publishing state and approval fetched again
     ctx.contentCounts()   -> promise of { speakers, agenda, sponsors }: what the site shows of each
     ctx.isAward()         true for an award event (its speakers are its jury)
     ctx.log               { when(iso), who(by), action(a) }: the Activity log's own wording
   =========================================================================== */

window.EditEventDashboard = (function(){
  'use strict';

  var C = window.RevampCore;

  /* What was last fetched for the event on screen. A view is drawn from it straight away; wire() fetches
     again when it is missing or older than STALE_MS, and draws the view once more when the answers are in. */
  var STALE_MS = 60000;
  var D = null, SEQ = 0;

  function errMsg(err){ return (err && err.message) || 'It could not be loaded.'; }

  function load(ctx){
    var id = ctx.EV.id, prev = D && D.id === id ? D : {};
    var seq = ++SEQ;
    D = { id: id, loading: true, at: prev.at || 0,
      stats: prev.stats || null, statsErr: null, log: prev.log || null, logErr: null,
      counts: prev.counts || null, forms: prev.forms || null };
    var mine = D, queued = false;
    /* each part is drawn as soon as it has arrived, so one slow answer does not hold back the rest */
    function redraw(){
      if (queued) return;
      queued = true;
      setTimeout(function(){ queued = false; if (seq === SEQ && ctx.$('dash-root')) ctx.render(); }, 0);
    }
    function settle(p, ok, bad){
      return Promise.resolve(p).then(ok, bad || function(){}).then(redraw);
    }
    var jobs = [
      settle(C.fetchStats(id, 30), function(s){ mine.stats = s || null; }, function(e){ mine.statsErr = errMsg(e); }),
      settle(C.fetchActivityLog(id, { limit: 5 }), function(r){ mine.log = (r && r.items || []).slice(0, 5); },
        function(e){ mine.logErr = errMsg(e); }),
      settle(ctx.contentCounts ? ctx.contentCounts() : null, function(c){ mine.counts = c || null; }),
      settle(C.fetchForms(id), function(r){
        r = r || {};
        mine.forms = { n: (r.forms || []).length, open: !(r.registration && r.registration.open === false) };
      }),
      settle(ctx.refreshState ? ctx.refreshState() : null, null)
    ];
    return Promise.all(jobs).then(function(){
      if (seq !== SEQ) return;
      mine.loading = false;
      mine.at = Date.now();
      if (ctx.$('dash-root')) ctx.render();
    });
  }

  /* the sum of one series over the last n days of byDay (oldest first, today last) */
  function lastDays(byDay, n, key){
    var list = Array.isArray(byDay) ? byDay.slice(-n) : [];
    return list.reduce(function(sum, d){ return sum + (+(d && d[key]) || 0); }, 0);
  }

  /* Four tiles, every one from the stats answer. Page views are shown as numbers only where the live site
     counts its visits (visitsCounted); otherwise that tile says so, and the registrations waiting for the
     organiser's approval (a form that needs approval) take the conversion tile's place. Mailer / WhatsApp / SMS counts live under
     Promotions, next to the controls that move them. */
  function tiles(ctx, s){
    var IC = ctx.IC, comma = ctx.comma;
    if (!s){
      var wait = D && D.statsErr ? 'Not loaded' : 'Loading…';
      return [
        ctx.statTile(IC.users, 'Registrations', '—', { dir: 'flat', text: wait }, null),
        ctx.statTile(IC.eye, 'Page views', '—', { dir: 'flat', text: wait }, null),
        ctx.statTile(IC.check, 'Responses to approve', '—', { dir: 'flat', text: wait }, null),
        ctx.statTile(IC.ticket, 'Seats left', '—', { dir: 'flat', text: wait }, null)
      ].join('');
    }
    var reg = +s.registrations || 0, confirmed = +s.confirmed || 0;
    var target = +s.target || 0, cap = +s.capacity || 0, counted = s.visitsCounted === true;
    var week = lastDays(s.byDay, 7, 'registrations');
    var regNote = target
      ? { dir: reg >= target ? 'up' : 'flat', text: Math.min(100, Math.round(reg / target * 100)) + '% of the target of ' + comma(target) }
      : { dir: week ? 'up' : 'flat', text: comma(week) + ' in the last 7 days' };

    var views = counted
      ? ctx.statTile(IC.eye, 'Page views', comma(+s.visitors || 0),
          s.uniques ? { dir: 'flat', text: comma(+s.uniques) + ' unique visitors' } : null, null)
      : ctx.statTile(IC.eye, 'Page views', 'Not counted', { dir: 'flat', text: 'Visits to the site are not counted yet' }, null);

    var third = counted
      ? ctx.statTile(IC.click, 'Visitor to registration', s.visitors ? (+s.conversion || 0).toFixed(1) + '%' : '—',
          s.visitors ? { dir: 'flat', text: 'Registrations per 100 page views' } : { dir: 'flat', text: 'No page views yet' }, null)
      : ctx.statTile(IC.check, 'Responses to approve', comma(+s.awaitingApproval || 0),
          { dir: 'flat', text: s.awaitingApproval ? 'Approve or decline them in Reporting' : 'None waiting' }, 'audience/reg');

    var seats = cap
      ? ctx.statTile(IC.ticket, 'Seats left', comma(Math.max(0, cap - confirmed)),
          { dir: 'flat', text: comma(confirmed) + ' of ' + comma(cap) + ' confirmed' }, 'audience/reg')
      : ctx.statTile(IC.ticket, 'Seats left', 'No limit', { dir: 'flat', text: 'No capacity set' }, 'settings/form');

    return ctx.statTile(IC.users, 'Registrations', comma(reg), regNote, 'audience/reg') + views + third + seats;
  }

  /* Where people stand. With page views counted it is the funnel (page views, registrations, and check-ins
     once there are any); without them, registrations by status — never a stage made up of zeros. */
  function bars(ctx, rows, top){
    return '<div class="bar-list">' + rows.map(function(r){
      var w = top ? Math.round(r[1] / top * 100) : 0;
      return '<div class="bar-item"><div class="bl"><b>' + ctx.esc(r[0]) + '</b><span>' + ctx.esc(ctx.comma(r[1])) + '</span></div>' +
        '<div class="bar-track"><i style="width:' + w + '%;background:var(--accent)"></i></div></div>';
    }).join('') + '</div>';
  }
  function people(ctx, s){
    if (!s) return ctx.panel('Registrations', '', '<p class="dash-muted">' + (D && D.statsErr ? 'Not loaded.' : 'Loading…') + '</p>');
    if (s.visitsCounted === true){
      var stages = [['Page views', +s.visitors || 0], ['Registrations', +s.registrations || 0]];
      if (+s.checkedIn) stages.push(['Checked in', +s.checkedIn]);
      var top = stages[0][1];
      var sub = top ? stages.slice(1).map(function(x){ return x[0] + ' ' + (Math.round(x[1] / top * 1000) / 10) + '% of page views'; }).join(' · ') : 'No page views yet';
      return ctx.panel('From visit to registration', sub, bars(ctx, stages, Math.max(top, stages[1][1])));
    }
    var reg = +s.registrations || 0;
    var rows = [['Confirmed', +s.confirmed || 0], ['On the waitlist', +s.waitlist || 0], ['To approve', +s.pending || 0],
      ['Cancelled', +s.cancelled || 0]];
    if (+s.checkedIn) rows.push(['Checked in', +s.checkedIn]);
    if (!reg && !rows.some(function(r){ return r[1]; })){
      return ctx.panel('Registrations', '', '<p class="dash-muted">No registrations yet. They are counted here as soon as someone registers on the site.</p>');
    }
    return ctx.panel('Registrations', ctx.comma(reg) + ' in all', bars(ctx, rows, reg));
  }

  /* The things people actually open this screen to do. */
  function quickActions(ctx, s){
    var IC = ctx.IC;
    return [
      ['Edit the site',     'Open the site editor',                                 IC.brush, 'design/editor'],
      [ctx.isAward && ctx.isAward() ? 'Add a jury member' : 'Add a speaker', 'The line-up drives registrations', IC.users, 'content/speakers'],
      ['See registrations', s ? ctx.comma(+s.registrations || 0) + ' so far' : 'In Reporting', IC.chart, 'audience/reg']
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

  /* The newest rows of the Activity log, in its own words. */
  function activityFeed(ctx){
    if (!D || (!D.log && !D.logErr)) return '<p class="dash-muted dash-pad">Loading…</p>';
    if (!D.log) return '<p class="dash-muted dash-pad" role="alert">The recent changes could not be loaded: ' + ctx.esc(D.logErr) + '</p>';
    if (!D.log.length) return '<p class="dash-muted dash-pad">No changes yet. Every edit to this event is listed here as it is made.</p>';
    var L = ctx.log || {};
    function when(iso){ return L.when ? L.when(iso) : ctx.fmtDate(iso); }
    function who(by){ return L.who ? L.who(by) : String(by || ''); }
    function what(a){ return L.action ? L.action(a) : String(a || ''); }
    return D.log.map(function(h){
      return '<div class="feed-item"><span class="feed-dot"></span><div class="feed-body">' +
          '<div class="feed-when">' + ctx.esc(when(h.at)) + '</div>' +
          '<div class="feed-what">' + ctx.esc(what(h.action)) + (h.detail ? '<span class="sep">&rsaquo;</span>' + ctx.esc(String(h.detail).slice(0, 160)) : '') + '</div>' +
          '<div class="feed-who">by ' + ctx.esc(who(h.by)) + '</div>' +
        '</div></div>';
    }).join('');
  }

  /* Where the site stands, in one line, from siteState(). */
  function siteStatus(ctx, st){
    var e = ctx.EV, esc = ctx.esc, bits = [];
    var saved = st.savedVersion
      ? 'Last saved' + (e.site && e.site.updatedAt ? ' ' + ctx.fmtDate(e.site.updatedAt) : '') + ' (version ' + st.savedVersion + ')'
      : 'The site has not been saved yet';
    bits.push(esc(saved));
    if (st.live) bits.push(esc((st.publishedAt ? 'Live since ' + ctx.fmtDate(st.publishedAt) : 'Live') + (st.liveVersion ? ' (version ' + st.liveVersion + ')' : '')));
    else bits.push(esc(st.offline ? 'Taken offline' + (e.unpublishedAt ? ' on ' + ctx.fmtDate(e.unpublishedAt) : '') : 'Not published yet'));
    if (st.pending) bits.push('Waiting for approval · <a href="' + esc(st.pending.reviewPath) + '" target="_blank" rel="noopener">Review</a>');
    else if (st.rejected) bits.push('Rejected' + (st.rejected.decidedBy ? ' by ' + esc(st.rejected.decidedBy) : '') +
      (st.rejected.note ? ': “' + esc(st.rejected.note) + '”' : '') + ' · <a href="' + esc(st.rejected.reviewPath) + '" target="_blank" rel="noopener">Review</a>');
    else if (st.newer) bits.push('Newer changes are saved but not live');
    var url = st.live && C.publicUrl ? C.publicUrl(e) : '';
    var chips = st.chips.map(function(c){
      return '<span class="ev-chip ev-chip-' + esc(c.tone) + '" title="' + esc(c.title || '') + '">' + esc(c.text.replace(/ · Review$/, '')) + '</span>';
    }).join('');
    return '<div class="panel"><div class="panel-body dash-site">' +
        '<div class="dash-site-chips">' + chips + '</div>' +
        '<div class="dash-site-line">' + bits.join('<span class="sep" aria-hidden="true"> · </span>') + '</div>' +
        (url ? '<a class="btn btn-secondary btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener">' + ctx.svg(ctx.IC.ext, 13) + ' View live site</a>' : '') +
      '</div></div>';
  }

  /* Ready to publish: read-only rows worked out from what is stored; each one leads to where it is done. */
  function readiness(ctx, st){
    var e = ctx.EV, esc = ctx.esc, comma = ctx.comma;
    var gaps = C.basicsGaps({ name: e.name, start: e.start, end: e.end, venue: e.venue, city: e.city, desc: e.description, cat: e.category });
    var filled = gaps.filter(function(g){ return !g.why; }).length;
    var counts = D && D.counts, forms = D && D.forms, jury = ctx.isAward && ctx.isAward();
    function countRow(n, one, many){ return n == null ? null : (n ? comma(n) + ' ' + (n === 1 ? one : many) + ' on the site' : 'None on the site yet'); }
    var rows = [
      { label: 'Basics', ok: filled === gaps.length, text: filled + ' of ' + gaps.length + ' filled in', to: 'content/basics' },
      { label: jury ? 'Jury' : 'Speakers', ok: counts ? counts.speakers > 0 : null,
        text: counts ? countRow(counts.speakers, jury ? 'jury member' : 'speaker', jury ? 'jury members' : 'speakers') : 'Loading…', to: 'content/speakers' },
      { label: 'Agenda', ok: counts ? counts.agenda > 0 : null, text: counts ? countRow(counts.agenda, 'session', 'sessions') : 'Loading…', to: 'content/agenda' },
      { label: 'Sponsors', ok: counts ? counts.sponsors > 0 : null, text: counts ? countRow(counts.sponsors, 'sponsor', 'sponsors') : 'Loading…', to: 'content/sponsors' },
      { label: 'Site', ok: st.savedVersion > 0,
        text: st.savedVersion ? 'Saved in the site editor' : 'Not saved yet: open the site editor and save it', to: 'design/editor' },
      { label: 'Registration', ok: forms ? forms.n > 0 && forms.open : null,
        text: forms ? (forms.n ? (forms.open ? 'Open' : 'Closed') + ' · ' + comma(forms.n) + (forms.n === 1 ? ' form' : ' forms') : 'No form yet') : 'Loading…',
        to: 'settings/form' }
    ];
    var ready = rows.filter(function(r){ return r.ok === true; }).length;
    return {
      sub: ready + ' of ' + rows.length + ' ready',
      html: '<div class="check-list">' + rows.map(function(r){
        var tone = r.ok === true ? 'ok' : (r.ok === false ? 'warn' : 'mute');
        return '<button class="check-row dash-ready" type="button" data-goto="' + esc(r.to) + '">' +
            '<span class="dash-dot dash-dot-' + tone + '" aria-hidden="true"></span>' +
            '<span class="ct">' + esc(r.label) +
              '<span class="dash-ready-sub">' + esc(r.text) + '</span></span>' +
            '<span class="dash-ready-state badge b-' + (tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'mute') + '">' +
              (r.ok === true ? 'Ready' : r.ok === false ? 'To do' : '…') + '</span>' +
          '</button>';
      }).join('') + '</div>'
    };
  }

  /* ---------------------------------------------------------------- view */
  function view(ctx){
    var e = ctx.EV;
    var mine = D && D.id === e.id ? D : null;
    var s = mine ? mine.stats : null;
    var st = C.siteState(e, ctx.approval ? ctx.approval() : null);
    var ready = readiness(ctx, st);
    var busy = !mine || mine.loading;

    var stamp = mine && mine.at ? 'Updated ' + new Date(mine.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    var right = '<span class="dash-stamp" aria-live="polite">' + ctx.esc(busy && mine && mine.at ? 'Refreshing…' : stamp) + '</span>' +
      '<button class="btn btn-secondary btn-sm" type="button" id="dash-refresh"' + (busy ? ' disabled' : '') + '>' +
      ctx.svg(ctx.IC.clock, 13) + ' Refresh</button>';

    var target = s && +s.target ? +s.target : 0;
    var regPct = target ? Math.min(100, Math.round((+s.registrations || 0) / target * 100)) : null;

    return '<div id="dash-root">' + ctx.vhead('Dashboard',
        'Registrations so far, the latest changes and where the site stands. Campaign and channel counts live under Promotions.', right) +

      siteStatus(ctx, st) +

      (mine && mine.statsErr && !s
        ? '<div class="callout" role="alert">' + ctx.svg(ctx.IC.info, 15) + '<span>The figures could not be loaded: ' + ctx.esc(mine.statsErr) +
          ' Use Refresh to try again.</span></div>'
        : '') +

      '<div class="stat-grid dash-tiles">' + tiles(ctx, s) + '</div>' +

      (regPct != null
        ? '<div class="panel"><div class="panel-body">' +
            '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:7px">' +
              '<b>Registration target</b>' +
              '<span class="num">' + ctx.comma(+s.registrations || 0) + ' of ' + ctx.comma(target) + '</span>' +
            '</div>' +
            '<div class="prog' + (regPct >= 100 ? ' ok' : '') + '"><i style="width:' + regPct + '%"></i></div>' +
          '</div></div>'
        : '') +

      '<div class="split">' +
        '<div>' +
          people(ctx, s) +
          ctx.panelFlush('Recent activity', 'The latest changes to this event',
            '<div class="feed">' + activityFeed(ctx) + '</div>' +
            '<div class="dash-more"><button class="btn btn-ghost btn-sm" type="button" data-goto="activity">See the full activity log</button></div>') +
        '</div>' +
        '<div>' +
          ctx.panel('Jump back in', '', '<div class="check-list">' + quickActions(ctx, s) + '</div>') +
          ctx.panel('Ready to publish', ready.sub, ready.html) +
        '</div>' +
      '</div></div>';
  }

  /* ---------------------------------------------------------------- wire */
  function wire(ctx){
    if (!D || D.id !== ctx.EV.id || (!D.loading && Date.now() - D.at > STALE_MS)) load(ctx);
    var again = ctx.$('dash-refresh');
    if (again) again.onclick = function(){
      if (D && D.loading) return;
      load(ctx);
      ctx.render();
    };
  }

  return { view: view, wire: wire, _test: { reset: function(){ D = null; SEQ++; }, lastDays: lastDays } };
})();
