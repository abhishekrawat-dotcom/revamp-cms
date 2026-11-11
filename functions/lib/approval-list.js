/* Two small readings the publish flow needs from the server, kept apart from lib/api.js so they can be tested on
   their own (approval-list.test.js):

     listApproval(eventId, eventData) -> { id, toVersion, requestedBy, requestedAt, reviewPath } | null
       The request waiting for approval, as GET /api/events puts it on each event of the list (UX-102). The events
       dashboard reads every event already, so this is how an approver who opens it sees what is waiting, with no
       query of its own: a collection-group query on approvals by status would need a Firestore index, which a
       push to main does not create (App Hosting deploys the app only; firestore.indexes.json goes out only with
       `firebase deploy --only firestore:indexes`), and until somebody ran that the list would fail.
       events/<id>.approval is set while a request waits and removed when it is decided (handleApprovalRequest /
       handleApprovalDecide), so it is the same truth. A deleted event waits for nobody, nor does a request whose
       version is already live.

     aiUncheckedOf(snapshot) -> how many sections of a saved editor state are still marked as written by the AI and
       not checked by anybody (data-ai-generated on the section itself, the mark the site editor's "Check what the
       AI wrote" takes off as each one is ticked, and an edit takes off too). A hidden section is not counted: it
       does not go live. Stored with each save (site.aiUnchecked), so the console's Publish can send the person to
       the editor's check instead of going round it (UX-105). The snapshot is otherwise opaque to the server: only
       the opening tag of each top-level node is read. */
'use strict';

function reviewPathOf(eventId, id) {
  return '/review.html?event=' + encodeURIComponent(eventId) + '&request=' + encodeURIComponent(id);
}

function text(v) { return typeof v === 'string' ? v : ''; }

function listApproval(eventId, d) {
  d = d || {};
  if (d.deletedAt) return null;
  var a = d.approval;
  if (!a || typeof a !== 'object' || Array.isArray(a) || !text(a.id)) return null;
  /* a request whose version (or a newer one) is live already waits for nothing: approving it would be refused as
     overtaken (api.js staleRequestWhy, the same reading). The server now closes such a request when it is overtaken,
     but one left from before that, or one a failed close left behind, must not be offered as waiting (UX-108). */
  var live = d.published === true ? +d.publishedVersion || 0 : 0, v = +a.toVersion || 0;
  /* …except a request for search and sharing settings alone, which is for the live version: it waits until the site
     goes live again after it was sent */
  var seoWaits = a.seoOnly === true && live === v && !(text(d.publishedAt) > (text(a.updatedAt) || text(a.requestedAt)));
  if (live && live >= v && !seoWaits) return null;
  return {
    id: a.id,
    toVersion: +a.toVersion || 0,
    requestedBy: text(a.requestedBy),
    requestedAt: text(a.requestedAt) || null,
    reviewPath: reviewPathOf(eventId, a.id)
  };
}

/* the opening tag of a node's markup, or '' */
function openingTag(html) {
  var m = /^\s*<([a-zA-Z][^\s>\/]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(String(html || ''));
  return m ? m[2] : '';
}
function hasAttr(attrs, name) {
  return new RegExp('(^|\\s)' + name + '(?=[\\s=>/]|$)', 'i').test(attrs);
}

function aiUncheckedOf(snapshot) {
  var nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  var n = 0;
  nodes.forEach(function (html) {
    var attrs = openingTag(html);
    if (!attrs || !hasAttr(attrs, 'data-rv-section') || !hasAttr(attrs, 'data-ai-generated')) return;
    var cls = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    if (cls && /(^|\s)is-hidden-sec(\s|$)/.test(cls[2] != null ? cls[2] : cls[3])) return;
    n++;
  });
  return n;
}

module.exports = { listApproval: listApproval, aiUncheckedOf: aiUncheckedOf, reviewPathOf: reviewPathOf };
