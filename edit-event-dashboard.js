/* ===========================================================================
   Oneworld 2.0
   Edit Event : DASHBOARD

   Split out of edit-event.html so this screen can be worked on on its own.

   Every number, line and tick on it is read from the server, or the place says it is not known:
     - the figures: GET /api/event/dashboard-stats (RevampCore.fetchStats) — the same totals as Reporting and
       the events list; page views only where the live site counts them (visitsCounted)
     - Over time (REG-024): that answer's byDay, the last 90 India days, drawn 7, 30 or 90 at a time —
       registrations by day, and page views by day from the day the live sites began counting them
       (visitsSince); a day before that is "not counted", never a zero. There are no unique visitors.
     - Who registered (REG-025): the same answer's top 10 companies, designations, cities, sources and
       devices, each row a link to Reporting › Registrations filtered to it
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
     ctx.siteNotes         edit-event-site-notes.js (window.RevampSiteNotes), and ctx.siteOutline() -> what the site shows
                           of the Content tabs (GET /api/event/site-outline) or null: with both, the Speakers, Agenda and
                           Sponsors rows say what the site does with them (a section hidden until one is added, no
                           section at all, the previous edition's shown instead — UX-066, UX-067)
     ctx.log               { when(iso), who(by), action(a) }: the Activity log's own wording
   =========================================================================== */

window.EditEventDashboard = (function(){
  'use strict';

  var C = window.RevampCore;

  /* What was last fetched for the event on screen. A view is drawn from it straight away; wire() fetches
     again when it is missing or older than STALE_MS, and draws the view once more when the answers are in. */
  var STALE_MS = 60000;
  var D = null, SEQ = 0;
  /* Over time: the days fetched (the longest choice), the choices, and the one on screen — remembered in this browser
     as a convenience only (REG-024) */
  var STATS_DAYS = 90, RANGES = [7, 30, 90], RANGE = 30, RANGE_KEY = 'revamp-dash-range', FOCUS_RANGE = 0;
  try { var keptRange = +window.localStorage.getItem(RANGE_KEY); if (RANGES.indexOf(keptRange) !== -1) RANGE = keptRange; } catch (e) { /* storage blocked: 30 days */ }

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
      settle(C.fetchStats(id, STATS_DAYS), function(s){ mine.stats = s || null; }, function(e){ mine.statsErr = errMsg(e); }),
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

    /* page views only: the visit counter sends no identifier, so there are no unique visitors to show (REG-024) */
    var views = counted
      ? ctx.statTile(IC.eye, 'Page views', comma(+s.visitors || 0),
          /* the events list's QR codes, each scan counted on its way to the page (LST-038) */
          +s.qrScans ? { dir: 'flat', text: comma(+s.qrScans) + (+s.qrScans === 1 ? ' QR code scan' : ' QR code scans') } : null, null)
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
    /* the portal as the console shows it: a stored value the server gives no name for (off ET's roster) is none */
    var gaps = C.basicsGaps({ name: e.name, start: e.start, end: e.end, venue: e.venue, city: e.city, desc: e.description, cat: e.category,
      portal: String(e.portalName || '').trim() ? e.portal : '' });
    var filled = gaps.filter(function(g){ return !g.why; }).length;
    var counts = D && D.counts, forms = D && D.forms, jury = ctx.isAward && ctx.isAward();
    var SNotes = ctx.siteNotes || null, outline = SNotes && ctx.siteOutline ? ctx.siteOutline() : null;
    function countRow(n, one, many){ return n == null ? null : (n ? comma(n) + ' ' + (n === 1 ? one : many) + ' on the site' : 'None on the site yet'); }
    /* a Content row: how many the site shows and, once what the site shows is known, what it does with them. 'na': the
       site has no section for them, so the row is not something to get ready and is left out of the count. */
    function contentRow(label, tab, n, one, many){
      if (!counts) return { label: label, ok: null, text: 'Loading…', to: 'content/' + tab };
      if (SNotes){
        var r = SNotes.readiness(tab, n, outline, { award: jury });
        return { label: label, ok: r.ok, text: r.text, to: 'content/' + tab };
      }
      return { label: label, ok: n > 0, text: countRow(n, one, many), to: 'content/' + tab };
    }
    var rows = [
      { label: 'Basics', ok: filled === gaps.length, text: filled + ' of ' + gaps.length + ' filled in', to: 'content/basics' },
      contentRow(jury ? 'Jury' : 'Speakers', 'speakers', counts && counts.speakers, jury ? 'jury member' : 'speaker', jury ? 'jury members' : 'speakers'),
      contentRow('Agenda', 'agenda', counts && counts.agenda, 'session', 'sessions'),
      contentRow('Sponsors', 'sponsors', counts && counts.sponsors, 'sponsor', 'sponsors'),
      { label: 'Site', ok: st.savedVersion > 0,
        text: st.savedVersion ? 'Saved in the site editor' : 'Not saved yet: open the site editor and save it', to: 'design/editor' },
      { label: 'Registration', ok: forms ? forms.n > 0 && forms.open : null,
        text: forms ? (forms.n ? (forms.open ? 'Open' : 'Closed') + ' · ' + comma(forms.n) + (forms.n === 1 ? ' form' : ' forms') : 'No form yet') : 'Loading…',
        to: 'settings/form' }
    ];
    var ready = rows.filter(function(r){ return r.ok === true; }).length;
    var counted = rows.filter(function(r){ return r.ok !== 'na'; }).length;
    return {
      sub: ready + ' of ' + counted + ' ready',
      html: '<div class="check-list">' + rows.map(function(r){
        var tone = r.ok === true ? 'ok' : (r.ok === false ? 'warn' : 'mute');
        return '<button class="check-row dash-ready" type="button" data-goto="' + esc(r.to) + '">' +
            '<span class="dash-dot dash-dot-' + tone + '" aria-hidden="true"></span>' +
            '<span class="ct">' + esc(r.label) +
              '<span class="dash-ready-sub">' + esc(r.text) + '</span></span>' +
            '<span class="dash-ready-state badge b-' + (tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'mute') + '">' +
              (r.ok === true ? 'Ready' : r.ok === false ? 'To do' : r.ok === 'na' ? 'No section' : '…') + '</span>' +
          '</button>';
      }).join('') + '</div>'
    };
  }

  /* ------------------------------------------------- Over time (REG-024)
     Two column charts one above the other — registrations by day, page views by day — on the same days, each on
     its own scale (two measures of different size are two charts, never one chart with two axes). One hue, thin
     columns with a rounded top, a hairline grid with three round ticks, the first, some middle and the last day
     named under them. Hover or the arrow keys show one day's figure; "Show the numbers" lists every day. */
  function dayShort(ctx, date){ return String(ctx.fmtDate(date)).replace(/ \d{4}$/, ''); }
  function dayLong(ctx, date){ return C.fmtDate(date, { day: true }); }
  function niceStep(x){
    if (!(x > 1)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  /* the days of the window chosen, oldest first: { date, v } with v null for a day nobody counted */
  function windowOf(byDay, n, key){
    return (Array.isArray(byDay) ? byDay.slice(-n) : []).map(function(d){
      var raw = d ? d[key] : null;
      return { date: d && d.date, v: raw == null ? null : (+raw || 0) };
    });
  }
  /* o: { id, title, days, sum: the line beside the title, gap: what the days not counted are labelled } */
  function columns(ctx, o){
    var esc = ctx.esc, days = o.days, n = days.length, top = 0;
    days.forEach(function(d){ if (d.v != null && d.v > top) top = d.v; });
    /* the top of the scale: the first round step at or above the busiest day (1 for a single registration, not 2) */
    var step = niceStep(top / 2), max = Math.max(step, Math.ceil(top / step) * step), ticks = [];
    for (var t = 0; t <= max; t += step) ticks.push(t);
    var first = 0;
    while (first < n && days[first].v == null) first++;
    /* the last day, then every week (every four weeks over 90 days) back from it; a name at either end is set
       against that end, so it never runs off the chart */
    var labelStep = n <= 7 ? 1 : n <= 31 ? 7 : 28, labels = [];
    for (var i = n - 1; i >= 0; i -= labelStep) labels.push(i);
    function labelAt(k){
      var mid = (k + 0.5) / n * 100;
      return k === n - 1 ? 'right:0' : mid < 7 ? 'left:0' : 'left:' + mid + '%;transform:translateX(-50%)';
    }
    return '<figure class="dc" id="' + o.id + '">' +
        '<figcaption class="dc-head"><b id="' + o.id + '-t">' + esc(o.title) + '</b><span>' + esc(o.sum) + '</span></figcaption>' +
        '<div class="dc-plot" tabindex="0" role="group" aria-labelledby="' + o.id + '-t" aria-describedby="' + o.id + '-k" ' +
          'data-chart="' + o.id + '" style="--n:' + n + ';--r:' + (n > 45 ? 2 : 4) + 'px">' +
          ticks.map(function(t){ return '<span class="dc-gl" style="bottom:' + (t / max * 100) + '%"><i>' + esc(ctx.comma(t)) + '</i></span>'; }).join('') +
          (first > 0 ? '<span class="dc-gap" style="width:' + (first / n * 100) + '%">' + (first / n >= 0.2 ? '<i>' + esc(o.gap) + '</i>' : '') + '</span>' : '') +
          '<div class="dc-cols">' + days.map(function(d, k){
            var h = d.v == null ? 0 : Math.round(d.v / max * 1000) / 10;
            return '<span class="dc-day' + (d.v == null ? ' dc-none' : '') + '" data-i="' + k + '" data-v="' + (d.v == null ? '' : d.v) + '" ' +
              'data-d="' + esc(dayLong(ctx, d.date)) + '"><i style="height:' + h + '%"></i></span>';
          }).join('') + '</div>' +
          '<span class="dc-tip" aria-hidden="true" hidden></span>' +
        '</div>' +
        '<div class="dc-x" aria-hidden="true">' + labels.map(function(k){
          return '<span style="' + labelAt(k) + '">' + esc(dayShort(ctx, days[k].date)) + '</span>';
        }).join('') + '</div>' +
        '<span class="dc-sr" id="' + o.id + '-k" aria-live="polite">Use the left and right arrow keys to read one day at a time.</span>' +
      '</figure>';
  }
  function overTime(ctx, s, live){
    var comma = ctx.comma, esc = ctx.esc;
    var right = '<div class="dc-range" role="group" aria-label="Days shown">' + RANGES.map(function(n){
      return '<button type="button" class="btn btn-sm ' + (n === RANGE ? 'btn-primary' : 'btn-secondary') + '" data-range="' + n + '" aria-pressed="' + (n === RANGE) + '">' + n + ' days</button>';
    }).join('') + '</div>';
    if (!s) return ctx.panel('Over time', '', '<p class="dash-muted">' + (D && D.statsErr ? 'Not loaded.' : 'Loading…') + '</p>', right);
    var regs = windowOf(s.byDay, RANGE, 'registrations'), views = windowOf(s.byDay, RANGE, 'views');
    if (!regs.length) return ctx.panel('Over time', '', '<p class="dash-muted">No days to show yet.</p>', right);
    var n = regs.length, regSum = 0, viewSum = 0, viewDays = 0;
    regs.forEach(function(d){ regSum += d.v || 0; });
    views.forEach(function(d){ if (d.v != null){ viewSum += d.v; viewDays++; } });
    var since = s.visitsSince ? dayShort(ctx, s.visitsSince) : '';
    var body = columns(ctx, { id: 'dc-reg', title: 'Registrations', days: regs,
      sum: regSum ? comma(regSum) + ' in the last ' + n + ' days' : 'None in the last ' + n + ' days' });
    if (s.visitsCounted !== true || !viewDays){
      body += '<div class="dc dc-off"><div class="dc-head"><b>Page views</b></div><p class="dash-muted">' +
        (s.visitsCounted !== true ? 'Visits to the site are not counted yet, so there is nothing to draw.'
          : 'Page views are counted from ' + esc(since) + '; none of these days is counted yet.') + '</p></div>';
    } else {
      var part = viewDays < n;
      body += columns(ctx, { id: 'dc-views', title: 'Page views', days: views,
        gap: 'Not counted before ' + since,
        sum: (viewSum ? comma(viewSum) : 'None') + (part ? ' since ' + since + ' (counted from then)' : ' in the last ' + n + ' days') +
          (!live && !viewSum ? ' · only the live site is counted' : '') });
    }
    var rows = regs.map(function(d, k){
      var v = views[k] ? views[k].v : null;
      return '<tr><th scope="row">' + esc(dayLong(ctx, d.date)) + '</th><td>' + comma(d.v || 0) + '</td><td>' +
        (s.visitsCounted !== true || v == null ? '<span class="dash-muted">Not counted</span>' : comma(v)) + '</td></tr>';
    }).reverse().join('');
    body += '<details class="dc-table"><summary>Show the numbers</summary><div class="dc-table-wrap"><table>' +
      '<thead><tr><th scope="col">Day (India time)</th><th scope="col">Registrations</th><th scope="col">Page views</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></details>';
    return ctx.panel('Over time', 'Per day, India time', body, right);
  }

  /* --------------------------------------------- Who registered (REG-025)
     The top 10 of each list the server keeps for the registrations (functions/lib/api-audience.js aggValues); each
     row leads to Reporting › Registrations showing those registrations. Ranked bars in one hue. */
  var WHO = [['company', 'Company', 'byCompany'], ['designation', 'Designation', 'byDesignation'], ['city', 'City', 'byCity'],
    ['source', 'Source', 'bySource'], ['device', 'Device', 'byRegistrationDevice']];
  function whoRegistered(ctx, s){
    var esc = ctx.esc, comma = ctx.comma, id = ctx.EV.id || ctx.EV.eventId;
    if (!s) return ctx.panel('Who registered', '', '<p class="dash-muted">' + (D && D.statsErr ? 'Not loaded.' : 'Loading…') + '</p>');
    if (!(+s.registrations)) return ctx.panel('Who registered', '',
      '<p class="dash-muted">No registrations yet. The companies, designations, cities, sources and devices of the people who register are listed here.</p>');
    var cards = WHO.map(function(w){
      var list = Array.isArray(s[w[2]]) ? s[w[2]].filter(function(x){ return x && x.label && +x.count > 0; }).slice(0, 10) : [];
      var top = list.length ? +list[0].count : 0;
      var inner = list.length ? '<ol class="dw-list">' + list.map(function(x){
        var href = '/audience-registrations.html?event=' + encodeURIComponent(id) + '&by=' + w[0] + '&value=' + encodeURIComponent(x.label);
        var count = +x.count;
        return '<li><a class="dw-row" href="' + esc(href) + '" aria-label="' + esc(x.label + ': ' + comma(count) + (count === 1 ? ' registration' : ' registrations') + '. Show them') + '">' +
            '<span class="dw-l">' + esc(x.label) + '</span><span class="dw-n">' + esc(comma(count)) + '</span>' +
            '<span class="dw-bar" aria-hidden="true"><i style="width:' + Math.max(2, Math.round(count / top * 100)) + '%"></i></span></a></li>';
      }).join('') + '</ol>'
        : '<p class="dash-muted">' + (w[0] === 'device' || w[0] === 'source' ? 'None recorded yet.' : 'No answers yet: the forms may not ask for it.') + '</p>';
      return '<section class="dw-card" aria-labelledby="dw-' + w[0] + '"><h4 id="dw-' + w[0] + '">' + esc(w[1]) + '</h4>' + inner + '</section>';
    }).join('');
    return ctx.panel('Who registered', 'The top 10 of each, from every registration so far. Choose one to see those registrations.',
      '<div class="dw-grid">' + cards + '</div>');
  }

  /* hover, focus and the arrow keys on the Over time charts: one day's figure at a time, the same day marked on both */
  function wireCharts(ctx){
    var root = ctx.$('dash-over');
    if (!root || !root.querySelectorAll) return;
    var plots = Array.prototype.slice.call(root.querySelectorAll('.dc-plot[data-chart]'));
    var words = { 'dc-reg': ['registration', 'registrations'], 'dc-views': ['page view', 'page views'] };
    function mark(i){
      plots.forEach(function(p){
        Array.prototype.forEach.call(p.querySelectorAll('.dc-day'), function(c){ c.classList.toggle('on', +c.getAttribute('data-i') === i); });
      });
    }
    function show(plot, i, said){
      var cols = plot.querySelectorAll('.dc-day'), n = cols.length;
      if (!n) return;
      i = Math.max(0, Math.min(n - 1, i));
      plot.setAttribute('data-at', i);
      var col = cols[i], v = col.getAttribute('data-v'), w = words[plot.getAttribute('data-chart')] || ['', ''];
      var value = v === '' ? 'Not counted' : ctx.comma(+v) + ' ' + (+v === 1 ? w[0] : w[1]);
      var tip = plot.querySelector('.dc-tip');
      if (tip){
        tip.innerHTML = '';
        var b = document.createElement('b'); b.textContent = value;
        var d = document.createElement('span'); d.textContent = col.getAttribute('data-d');
        tip.appendChild(b); tip.appendChild(d);
        var at = (i + 0.5) / n * 100;
        tip.style.left = at + '%';
        tip.style.transform = 'translateX(' + (at < 15 ? '-10%' : at > 85 ? '-90%' : '-50%') + ')';
        tip.hidden = false;
      }
      mark(i);
      if (said){ var k = root.querySelector('#' + plot.getAttribute('data-chart') + '-k'); if (k) k.textContent = col.getAttribute('data-d') + ': ' + value; }
    }
    function hide(plot){ var tip = plot.querySelector('.dc-tip'); if (tip) tip.hidden = true; mark(-1); }
    plots.forEach(function(plot){
      /* a pointer over a day, or a finger on it (a tap moves no pointer) */
      plot.onpointermove = plot.onpointerdown = function(e){ var c = e.target.closest && e.target.closest('.dc-day'); if (c) show(plot, +c.getAttribute('data-i'), false); };
      plot.onpointerleave = function(){ if (document.activeElement !== plot) hide(plot); };
      plot.onfocus = function(){ var at = plot.getAttribute('data-at'); show(plot, at == null ? plot.querySelectorAll('.dc-day').length - 1 : +at, true); };
      plot.onblur = function(){ hide(plot); };
      plot.onkeydown = function(e){
        var n = plot.querySelectorAll('.dc-day').length, at = +(plot.getAttribute('data-at') || n - 1);
        var to = e.key === 'ArrowLeft' ? at - 1 : e.key === 'ArrowRight' ? at + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
        if (to == null) return;
        e.preventDefault();
        show(plot, to, true);
      };
    });
  }

  /* ---------------------------------------------------------------- view */
  function view(ctx){
    var e = ctx.EV;
    var mine = D && D.id === e.id ? D : null;
    var s = mine ? mine.stats : null;
    var st = C.siteState(e, ctx.approval ? ctx.approval() : null);
    var ready = readiness(ctx, st);
    var busy = !mine || mine.loading;

    /* "Updated 6:01 pm": RevampCore's one way of writing a time (UX-010) */
    var stamp = mine && mine.at ? 'Updated ' + (ctx.fmtTime ? ctx.fmtTime(new Date(mine.at)) : new Date(mine.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : '';
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

      /* while the figures are read again the charts stay, dimmed, until the new ones are in */
      '<div id="dash-over" class="dash-over-wrap' + (busy && s ? ' dash-dim' : '') + '">' + overTime(ctx, s, st.live) + '</div>' +

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
      '</div>' +

      whoRegistered(ctx, s) +
      '</div>';
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
    /* 7 / 30 / 90 days: drawn again from what is already here (90 days are fetched), the focus kept on the choice */
    var over = ctx.$('dash-over');
    if (over && over.querySelectorAll) Array.prototype.forEach.call(over.querySelectorAll('[data-range]'), function(b){
      var n = +b.getAttribute('data-range');
      b.onclick = function(){
        if (n === RANGE) return;
        RANGE = n; FOCUS_RANGE = n;
        try { window.localStorage.setItem(RANGE_KEY, String(n)); } catch (e) { /* only a convenience */ }
        ctx.render();
      };
      if (FOCUS_RANGE === n){ FOCUS_RANGE = 0; b.focus(); }
    });
    wireCharts(ctx);
  }

  return { view: view, wire: wire, _test: { reset: function(){ D = null; SEQ++; }, lastDays: lastDays, niceStep: niceStep,
    range: function(n){ if (RANGES.indexOf(n) !== -1) RANGE = n; return RANGE; } } };
})();
