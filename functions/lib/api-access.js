/* Settings › Access — who may use ETB2B EventSphere, as what, and in which portals (lib/access-control.js has the
   rule itself and the list's shape). lib/api.js routes these here.

     GET  /api/access/me       anyone let in -> { you: { email, role, label, portals, member }, canManage, roles,
                               portals: [{ slug, name }], domain }
     GET  /api/access          the same; for an admin also { members: [{ email, role, label, portals, name, company,
                               addedBy, addedAt, updatedBy, updatedAt }], defaultRole, log: [{ at, by, action, email,
                               before, after }] }
     POST /api/access/member   { email, role, portals, name }   add someone, or change their role or portals  (admin)
     POST /api/access/remove   { email }                        take someone off the list                     (admin)
     POST /api/access/default  { role: 'editor' | 'viewer' }    what a company account not on the list is     (admin)
   Each change answers what GET /api/access answers. A refusal is 400/403 { error, code } in words for the page:
   'not-admin', 'last-admin' (someone has to stay an admin), 'self' (an admin cannot demote or remove themselves),
   'bad-email', 'bad-role', 'no-portals', 'too-many'. lib/http.js requireAdmin has already let only an admin through
   to the three changes; access-control.js checks it again inside the change's own transaction. */
'use strict';

var AC = require('./access-control');
var etEvents = require('./et-events');
var H = require('./http');

var BODY_MAX = 16 * 1024;

function view(fb, cfg, access) {
  var out = AC.publicView(cfg, access);
  out.portals = etEvents.portalList();
  if (!out.canManage) return Promise.resolve(out);
  return AC.readLog(fb, 25).then(function (log) { out.log = log; return out; });
}
function failed(res, what, err) {
  if (err && err.status && err.status < 500) return H.sendJson(res, err.status, { error: err.message, code: err.code });
  console.error('access: ' + what + ' failed — ' + (err && err.stack || err));
  H.sendJson(res, 500, { error: 'The access list could not be ' + (what === 'read' ? 'read' : 'saved') + '. Please try again.' });
}

function handleMe(req, res) {
  H.requireAdmin(req, res, function (fb, decoded) {
    AC.readConfig(fb).then(function (cfg) {
      var out = AC.publicView(cfg, decoded.access);
      out.portals = etEvents.portalList();
      delete out.members;
      H.sendJson(res, 200, out);
    }).catch(function (err) { failed(res, 'read', err); });
  });
}
function handleGet(req, res) {
  H.requireAdmin(req, res, function (fb, decoded) {
    AC.readConfig(fb, { fresh: AC.can(decoded.access, 'admin') }).then(function (cfg) { return view(fb, cfg, decoded.access); })
      .then(function (out) { H.sendJson(res, 200, out); })
      .catch(function (err) { failed(res, 'read', err); });
  });
}
function changeRoute(run) {
  return function (req, res) {
    H.requireAdmin(req, res, function (fb, decoded) {
      H.parseJsonBody(req, res, function (body) {
        Promise.resolve().then(function () { return run(fb, decoded.access.email, body); })
          .then(function (cfg) {
            var me = AC.accessOf(cfg, decoded);
            return view(fb, cfg, me.denied ? decoded.access : me);
          })
          .then(function (out) { H.sendJson(res, 200, out); })
          .catch(function (err) { failed(res, 'save', err); });
      }, BODY_MAX);
    });
  };
}

var handleMember = changeRoute(function (fb, actor, body) {
  return AC.setMember(fb, actor, { email: body.email, role: body.role, portals: body.portals, name: body.name });
});
var handleRemove = changeRoute(function (fb, actor, body) { return AC.removeMember(fb, actor, body.email); });
var handleDefault = changeRoute(function (fb, actor, body) { return AC.setDefaultRole(fb, actor, body.role); });

module.exports = { handleMe: handleMe, handleGet: handleGet, handleMember: handleMember, handleRemove: handleRemove, handleDefault: handleDefault };
