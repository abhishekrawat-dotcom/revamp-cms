/* Settings › Publishing approvals (settings.html): the approval rule every event shares (config/approvals) — who
   approves, whether a person may approve their own changes, and whether changes need approval at all — and every
   change made to it, with who made it.

   It used to be a box on each event's review page, next to Approve: any member could switch approval off for every
   event from there, unasked and unrecorded (UX-108). Now it lives here once. The review page shows it read-only with
   a link here. Only an approver can change it (anyone, while nobody is named); the server checks the same and
   refuses approval being switched off, or self-approval, until somebody is named
   (functions/lib/api.js handleApprovalSettingsPut). Switching approval off asks first.
   Data: GET / PUT /api/settings/approvals (RevampCore.fetchApprovalSettings / saveApprovalSettings). ES5. */
(function () {
  'use strict';
  var C = window.RevampCore;
  var body = document.getElementById('pa-body');
  var qs = new URLSearchParams(location.search);
  var eventId = String(qs.get('event') || '').trim();
  var data = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(iso) { return C.fmtDate(iso, { time: true }); }
  function list(a) { return (a && a.length) ? a.join(', ') : 'anyone on the team'; }

  /* came from an event (its review page or its console): the way back is to it */
  if (eventId) {
    var back = document.getElementById('pa-back');
    back.href = '/edit-event.html?event=' + encodeURIComponent(eventId) + '#settings/visibility';
    back.lastChild.textContent = 'Back to the event';
  }

  /* the rule in one sentence each, as the review page and the publish window say it */
  function ruleLines(d) {
    return [
      d.approvers.length ? 'Approvers: ' + d.approvers.join(', ') + '.' : 'Anyone on the team can approve.',
      d.allowSelf ? 'A person may approve their own changes.' : 'Nobody approves their own changes.',
      d.required ? 'Changes go live once an approver approves them.' : 'Approval is switched off: Publish puts a saved site live at once.'
    ];
  }

  /* one recorded change, in words: what it was before and what it became */
  function changeWords(b, a) {
    b = b || {}; a = a || {};
    var out = [];
    if (JSON.stringify(b.approvers || []) !== JSON.stringify(a.approvers || [])) out.push('approvers ' + list(b.approvers) + ' → ' + list(a.approvers));
    if (!!b.required !== !!a.required) out.push(a.required ? 'approval switched on' : 'approval switched off');
    if (!!b.allowSelf !== !!a.allowSelf) out.push(a.allowSelf ? 'people may approve their own changes' : 'nobody approves their own changes');
    return out.length ? out.join('; ') : 'saved with no change';
  }

  function render(note) {
    var d = data;
    var rule = '<ul class="na-list">' + ruleLines(d).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
    var form = d.canEdit
      ? '<div class="field" style="margin-top:16px"><label for="pa-approvers">Approvers</label>' +
          '<input class="inp" id="pa-approvers" type="text" autocomplete="off" value="' + esc(d.approvers.join(', ')) + '" placeholder="name@timesinternet.in, name2@timesinternet.in">' +
          '<p class="hint">E-mail addresses, separated by commas. Leave it empty and anyone on the team can approve, but then approval cannot be switched off.</p></div>' +
        '<label class="pa-check"><input type="checkbox" id="pa-self"' + (d.allowSelf ? ' checked' : '') + '><span>A person may approve their own changes</span></label>' +
        '<label class="pa-check"><input type="checkbox" id="pa-required"' + (d.required ? ' checked' : '') + '><span>Changes need approval before they go live</span></label>' +
        '<div id="pa-ask"></div>' +
        '<div class="pa-acts" id="pa-acts"><button class="btn btn-primary" type="button" id="pa-save">Save</button></div>'
      : '<p class="pa-msg">' + esc(d.whyNot || 'Only an approver can change this.') + '</p>';
    var log = (d.history || []).length
      ? '<ul class="pa-log">' + d.history.map(function (h) {
          return '<li>' + esc(changeWords(h.before, h.after)) + '<div class="meta">' + esc(h.by) + ' · ' + esc(when(h.at)) + '</div></li>';
        }).join('') + '</ul>'
      : '<p class="pa-msg">No change to this rule has been recorded yet.</p>';
    body.innerHTML =
      (note ? '<p class="pa-msg" role="status">' + esc(note) + '</p>' : '') +
      '<div class="panel" style="margin-top:14px"><div class="panel-head"><h3>Who approves</h3></div><div class="panel-body">' + rule + form + '<div id="pa-msg"></div></div></div>' +
      '<div class="panel" style="margin-top:14px"><div class="panel-head"><h3>Changes to this rule</h3></div><div class="panel-body">' + log + '</div></div>';
    wire();
  }

  function wire() {
    var save = document.getElementById('pa-save');
    if (!save) return;
    save.onclick = function () {
      var next = {
        approvers: document.getElementById('pa-approvers').value,
        allowSelf: document.getElementById('pa-self').checked,
        required: document.getElementById('pa-required').checked
      };
      /* switching approval off changes what Publish does on every event: asked first, the safe answer focused */
      if (data.required && !next.required) return ask(next);
      send(next);
    };
  }

  function ask(next) {
    var host = document.getElementById('pa-ask'), acts = document.getElementById('pa-acts');
    acts.hidden = true;
    host.innerHTML = '<div class="pa-msg err" role="alertdialog" aria-labelledby="pa-ask-t"><p id="pa-ask-t" style="margin:0">Turn off approval for every event? Publish will then go live immediately, with nobody checking the changes first.</p>' +
      '<div class="pa-acts"><button class="btn btn-secondary" type="button" id="pa-keep">Keep approval on</button>' +
      '<button class="btn btn-danger" type="button" id="pa-off">Turn approval off</button></div></div>';
    document.getElementById('pa-keep').focus();
    document.getElementById('pa-keep').onclick = function () { host.innerHTML = ''; acts.hidden = false; document.getElementById('pa-save').focus(); };
    document.getElementById('pa-off').onclick = function () { send(next); };
  }

  function send(next) {
    var msg = document.getElementById('pa-msg');
    Array.prototype.forEach.call(body.querySelectorAll('button'), function (b) { b.disabled = true; });
    msg.innerHTML = '<p class="pa-msg">Saving…</p>';
    C.saveApprovalSettings(next).then(function () {
      return load('Saved. The rule now applies to every event.');
    }, function (err) {
      Array.prototype.forEach.call(body.querySelectorAll('button'), function (b) { b.disabled = false; });
      document.getElementById('pa-ask').innerHTML = ''; document.getElementById('pa-acts').hidden = false;
      msg.innerHTML = '<p class="pa-msg err" role="alert">' + esc(C.errText(err)) + '</p>';
    });
  }

  function load(note) {
    return C.fetchApprovalSettings().then(function (d) {
      data = {
        approvers: Array.isArray(d && d.approvers) ? d.approvers : [], allowSelf: !!(d && d.allowSelf), required: !(d && d.required === false),
        canEdit: !!(d && d.canEdit), whyNot: (d && d.whyNot) || '', history: (d && d.history) || []
      };
      render(note);
    }, function (err) { C.renderLoadError(body, err, { onRetry: function () { load(); } }); });
  }
  load();
})();
