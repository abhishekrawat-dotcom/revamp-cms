/* Settings › Access (settings.html): who may use ETB2B EventSphere, as what, and in which portals — the owner's
   request of 10 Nov 2026 ("an access management section … where I can give access to other users").

   Everyone with a company Google account can sign in; those not on the list are the default role (Editor, or
   Viewer) on every portal. An admin invites anyone else by their Google account's address, gives anyone a role —
   Admin, Approver, Editor, Viewer, or No access (blocked, a colleague too) — and the portals they work in, and
   sees every change, with who made it. Everybody else sees their own access and who to ask.
   The server decides all of it (functions/lib/access-control.js, api-access.js); this page only shows and asks.
   Data: GET /api/access, POST /api/access/member|remove|default (RevampCore.fetchAccess …). ES5. */
(function () {
  'use strict';
  var C = window.RevampCore;
  var body = document.getElementById('ac-body');
  if (!body || !C) return;
  var data = null, editing = null, confirming = '';

  var ROLE_TEXT = {
    admin: 'Everything, on every portal, and managing who has access.',
    approver: 'Approves publishing, deletes events and takes sites offline — and all an Editor does.',
    editor: 'Creates and edits events, sites and promotions, and sends them for approval.',
    viewer: 'Sees everything in their portals and changes nothing.',
    blocked: 'Cannot sign in at all — a company account included.'
  };
  var ORDER = ['admin', 'approver', 'editor', 'viewer', 'blocked'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(iso) { return iso ? C.fmtDate(iso, { time: true }) : ''; }
  function label(role) { var r = (data.roles || []).filter(function (x) { return x.id === role; })[0]; return r ? r.label : role; }
  function portalName(slug) { var p = (data.portals || []).filter(function (x) { return x.slug === slug; })[0]; return p ? p.name : slug; }
  function every(portals) { return !portals || portals.indexOf('*') !== -1; }
  function where(portals) { return every(portals) ? 'every portal' : portals.map(portalName).join(', '); }
  function roleWhere(x) {
    if (!x) return 'nothing';
    if (x.role === 'blocked') return 'No access';
    return label(x.role) + ' on ' + (x.role === 'admin' ? 'every portal' : where(x.portals));
  }
  function el(id) { return document.getElementById(id); }
  function busy(on) { Array.prototype.forEach.call(body.querySelectorAll('button, input, select'), function (b) { b.disabled = on; }); }

  /* one recorded change, in words */
  function logWords(h) {
    if (h.action === 'added') return 'Gave ' + h.email + ' access: ' + roleWhere(h.after);
    if (h.action === 'changed') return h.email + ': ' + roleWhere(h.before) + ' → ' + roleWhere(h.after);
    if (h.action === 'removed') return 'Took ' + h.email + ' off the list (was ' + roleWhere(h.before) + ')' + (h.after ? ' — now ' + roleWhere(h.after) + ', the company default' : ' — can no longer sign in');
    if (h.action === 'default') return 'Company accounts not on the list: ' + label(h.before && h.before.role) + ' → ' + label(h.after && h.after.role);
    return 'Changed the access list';
  }

  /* ---------- for everybody: their own access ---------- */
  function yours() {
    var you = data.you || {};
    var ask = (data.admins || []).filter(function (a) { return a !== you.email; });
    return '<div class="panel" style="margin-top:14px"><div class="panel-head"><h3>Your access</h3></div><div class="panel-body">' +
      '<p class="ac-you"><b>' + esc(roleWhere(you)) + '</b><br><span>' + esc(ROLE_TEXT[you.role] || '') + '</span></p>' +
      (data.canManage ? '' : '<p class="pa-msg">Only an admin can change who has access' + (ask.length ? ': ask ' + esc(ask.join(', ')) + '.' : '.') + '</p>') +
      '</div></div>';
  }

  /* ---------- for an admin ---------- */
  function defaultBox() {
    return '<div class="field" style="margin-top:4px"><label for="ac-default">Company accounts not on the list below</label>' +
      '<select class="inp" id="ac-default" style="max-width:340px">' +
      ['editor', 'viewer'].map(function (r) { return '<option value="' + r + '"' + (data.defaultRole === r ? ' selected' : '') + '>' + esc(label(r)) + ' on every portal</option>'; }).join('') +
      '</select><p class="hint">Everyone with an @' + esc(data.domain) + ' Google account can sign in, at this role, unless the list below says otherwise.</p></div>';
  }
  function memberRow(m) {
    var you = data.you && m.email === data.you.email;
    var meta = [m.company ? 'Company account' : 'Invited Google account'];
    if (m.addedBy) meta.push('added by ' + m.addedBy + (m.addedAt ? ', ' + when(m.addedAt) : ''));
    if (m.updatedBy && m.updatedAt && m.updatedAt !== m.addedAt) meta.push('changed by ' + m.updatedBy + ', ' + when(m.updatedAt));
    var acts = you ? '<span class="ac-tag">You</span>'
      : '<button class="btn btn-secondary btn-sm" type="button" data-edit="' + esc(m.email) + '">Change</button>' +
        '<button class="btn btn-danger btn-sm" type="button" data-remove="' + esc(m.email) + '">Remove</button>';
    var ask = confirming === m.email
      ? '<div class="pa-msg err" role="alertdialog" aria-labelledby="ac-ask-t"><p id="ac-ask-t" style="margin:0">Take ' + esc(m.email) + ' off the list? ' +
          esc(m.company ? 'They will be ' + label(data.defaultRole) + ' on every portal, like other company accounts.' : 'They will no longer be able to sign in.') + '</p>' +
          '<div class="pa-acts"><button class="btn btn-secondary" type="button" id="ac-keep">Keep</button><button class="btn btn-danger" type="button" id="ac-remove-yes">Remove</button></div></div>'
      : '';
    return '<li class="ac-row' + (m.role === 'blocked' ? ' ac-blocked' : '') + '">' +
      '<div class="ac-who"><div class="ac-name">' + esc(m.name || m.email) + '</div>' + (m.name ? '<div class="ac-mail">' + esc(m.email) + '</div>' : '') +
      '<div class="ac-role"><span class="ac-chip ac-' + esc(m.role) + '">' + esc(label(m.role)) + '</span>' + (m.role === 'admin' || m.role === 'blocked' ? '' : ' <span>' + esc(where(m.portals)) + '</span>') + '</div>' +
      '<div class="meta">' + esc(meta.join(' · ')) + '</div></div>' +
      '<div class="ac-acts">' + acts + '</div>' + ask + '</li>';
  }
  function form() {
    var m = editing || { email: '', name: '', role: 'editor', portals: ['*'] };
    var isNew = !editing;
    var roles = ORDER.map(function (r) {
      return '<label class="pa-check"><input type="radio" name="ac-role" value="' + r + '"' + (m.role === r ? ' checked' : '') + '>' +
        '<span><b>' + esc(label(r)) + '</b> — ' + esc(ROLE_TEXT[r]) + '</span></label>';
    }).join('');
    var all = every(m.portals);
    var boxes = (data.portals || []).map(function (p) {
      return '<label class="ac-portal"><input type="checkbox" name="ac-portal" value="' + esc(p.slug) + '"' + (!all && m.portals.indexOf(p.slug) !== -1 ? ' checked' : '') + '><span>' + esc(p.name) + '</span></label>';
    }).join('');
    return '<div class="panel" style="margin-top:14px" id="ac-form-panel"><div class="panel-head"><h3 id="ac-form-h" tabindex="-1">' + (isNew ? 'Give someone access' : 'Change ' + esc(m.email) + '’s access') + '</h3></div><div class="panel-body">' +
      '<div class="frow ac-frow"><div class="field"><label for="ac-email">Google account e-mail</label>' +
        '<input class="inp" id="ac-email" type="email" autocomplete="off" spellcheck="false" value="' + esc(m.email) + '"' + (isNew ? '' : ' readonly') + ' placeholder="name@timesinternet.in or name@gmail.com">' +
        '<p class="hint">They sign in with Google using exactly this address.</p></div>' +
      '<div class="field"><label for="ac-name">Name <span class="ac-opt">(optional)</span></label><input class="inp" id="ac-name" type="text" autocomplete="off" maxlength="120" value="' + esc(m.name || '') + '"></div></div>' +
      '<fieldset class="ac-set"><legend>Role</legend>' + roles + '</fieldset>' +
      '<fieldset class="ac-set" id="ac-portals"' + (m.role === 'admin' || m.role === 'blocked' ? ' hidden' : '') + '><legend>Portals they work in</legend>' +
        '<label class="pa-check"><input type="checkbox" id="ac-all"' + (all ? ' checked' : '') + '><span><b>All portals</b>, including ones added later</span></label>' +
        /* the roster (some sixty portals) only once All portals is unticked */
        '<div class="ac-grid" id="ac-grid"' + (all ? ' hidden' : '') + '>' + boxes + '</div></fieldset>' +
      '<p class="pa-msg" id="ac-portals-note"' + (m.role === 'admin' ? '' : ' hidden') + '>An admin works on every portal.</p>' +
      '<div id="ac-form-msg"></div>' +
      '<div class="pa-acts"><button class="btn btn-primary" type="button" id="ac-save">' + (isNew ? 'Give access' : 'Save changes') + '</button>' +
        (isNew ? '' : '<button class="btn btn-secondary" type="button" id="ac-cancel">Cancel</button>') + '</div>' +
      '</div></div>';
  }
  function logBox() {
    var log = data.log || [];
    return '<div class="panel" style="margin-top:14px"><div class="panel-head"><h3>Changes to access</h3></div><div class="panel-body">' +
      (log.length ? '<ul class="pa-log">' + log.map(function (h) {
        return '<li>' + esc(logWords(h)) + '<div class="meta">' + esc(h.by) + ' · ' + esc(when(h.at)) + '</div></li>';
      }).join('') + '</ul>' : '<p class="pa-msg">No change has been made yet. Until the first one, the list is the first admin and the approvers named before.</p>') +
      '</div></div>';
  }

  function render(note) {
    var html = (note ? '<p class="pa-msg" role="status" id="ac-note">' + esc(note) + '</p>' : '') + yours();
    if (data.canManage) {
      var members = data.members || [];
      html += form() +
        '<div class="panel" style="margin-top:14px"><div class="panel-head"><h3>People with access</h3><span class="sub">' + members.length + ' on the list</span></div><div class="panel-body">' +
          defaultBox() + '<div id="ac-default-msg"></div>' +
          '<ul class="ac-list">' + members.map(memberRow).join('') + '</ul></div></div>' +
        logBox();
    }
    body.innerHTML = html;
    wire();
  }

  function chosen() {
    var r = body.querySelector('input[name="ac-role"]:checked');
    var role = r ? r.value : '';
    var portals = el('ac-all') && el('ac-all').checked ? ['*'] : Array.prototype.map.call(body.querySelectorAll('input[name="ac-portal"]:checked'), function (b) { return b.value; });
    return { email: el('ac-email').value.trim().toLowerCase(), name: el('ac-name').value.trim(), role: role, portals: role === 'admin' || role === 'blocked' ? ['*'] : portals };
  }
  function formMsg(text, isErr) { el('ac-form-msg').innerHTML = text ? '<p class="pa-msg' + (isErr ? ' err' : '') + '" role="' + (isErr ? 'alert' : 'status') + '">' + esc(text) + '</p>' : ''; }

  function wire() {
    if (!data.canManage) return;
    Array.prototype.forEach.call(body.querySelectorAll('input[name="ac-role"]'), function (r) {
      r.onchange = function () {
        el('ac-portals').hidden = r.value === 'admin' || r.value === 'blocked';
        el('ac-portals-note').hidden = r.value !== 'admin';
      };
    });
    el('ac-all').onchange = function () { el('ac-grid').hidden = el('ac-all').checked; };
    el('ac-save').onclick = function () {
      var m = chosen();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) { formMsg('Type the full e-mail address of their Google account.', true); el('ac-email').focus(); return; }
      if (!m.role) { formMsg('Choose a role.', true); return; }
      if (!m.portals.length) { formMsg('Choose the portals they work in, or All portals.', true); return; }
      busy(true); formMsg('Saving…');
      C.saveAccessMember(m).then(function (d) {
        var isNew = !editing;
        editing = null;
        take(d, (isNew ? 'Gave ' + m.email + ' access: ' : m.email + ' is now ') + roleWhere(m) + '.');
      }, function (err) { busy(false); formMsg(C.errText(err), true); });
    };
    if (el('ac-cancel')) el('ac-cancel').onclick = function () { editing = null; render(); };
    el('ac-default').onchange = function () {
      var role = el('ac-default').value;
      busy(true);
      el('ac-default-msg').innerHTML = '<p class="pa-msg">Saving…</p>';
      C.saveAccessDefault(role).then(function (d) { take(d, 'Company accounts not on the list are now ' + label(role) + 's on every portal.'); },
        function (err) { busy(false); el('ac-default-msg').innerHTML = '<p class="pa-msg err" role="alert">' + esc(C.errText(err)) + '</p>'; });
    };
    Array.prototype.forEach.call(body.querySelectorAll('[data-edit]'), function (b) {
      b.onclick = function () {
        var m = (data.members || []).filter(function (x) { return x.email === b.getAttribute('data-edit'); })[0];
        if (!m) return;
        editing = { email: m.email, name: m.name, role: m.role, portals: m.portals.slice() };
        confirming = '';
        render();
        el('ac-form-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
        el('ac-form-h').focus({ preventScroll: true });
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-remove]'), function (b) {
      b.onclick = function () { confirming = b.getAttribute('data-remove'); render(); el('ac-keep').focus(); };
    });
    if (el('ac-keep')) {
      el('ac-keep').onclick = function () { var who = confirming; confirming = ''; render(); var again = body.querySelector('[data-remove="' + who + '"]'); if (again) again.focus(); };
      el('ac-remove-yes').onclick = function () {
        var who = confirming;
        busy(true);
        C.removeAccessMember(who).then(function (d) { confirming = ''; take(d, 'Took ' + who + ' off the list.'); }, function (err) {
          busy(false);
          var ask = el('ac-ask-t');
          if (ask) ask.textContent = C.errText(err);
        });
      };
    }
  }

  function take(d, note) {
    data = d;
    render(note);
    var n = el('ac-note');
    if (n) { n.setAttribute('tabindex', '-1'); n.focus(); }
  }
  function load() {
    return C.fetchAccess().then(function (d) { data = d; render(); }, function (err) { C.renderLoadError(body, err, { onRetry: function () { load(); } }); });
  }
  load();
})();
