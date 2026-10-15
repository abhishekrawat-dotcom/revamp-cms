/* Run by hand, never by the server:

     node functions/lib/ops-previous-profiles.js --dry      report only — changes nothing
     node functions/lib/ops-previous-profiles.js            make the changes listed below
   options:
     --event=<id>        the event (default brand-world-summit-2026)
     --portal=<slug> --id=<n>   the previous edition on ET (default: the one its previousEdition source names;
                         for brand-world-summit-2026 that is brandequity / 3391)

   An AI-designed site's "Previous Edition Speakers" and "… Glimpses" are built by the server from the
   previous edition's records on ET (et-previous.js, prev-sections.js). Since October 2026 a speaker carries a
   profile — their text, LinkedIn, the company's logo and the sessions they spoke in — that a visitor opens
   from the card, and the glimpses row opens its photos large (templates/_shared/rv-popups.js). An event
   whose site was made before keeps the records and sections it was made with. For one event this:
     1. reads the previous edition again from ET's API, for that portal and id;
     2. stores it on the event's previousEdition source (events/<id>/sources/<doc>.previous) — the speakers
        as now read; a list ET now answers empty for (the glimpses read from the page, say) is kept as it was;
     3. builds the previous-speakers and previous-glimpses sections again and puts them in place of the old
        ones in events/<id>.generatedSections, scoped and capped exactly as generate-content does
        (lib/api.js), keeping a row still where the site had it still. No other section is touched, and a
        section the site does not have is not added.
   The page an owner has saved is not rewritten: the editor adds the profiles to the speakers' cards on that
   page itself the next time it is opened (editor-template-ui.js, refreshPreviousProfiles), card by card by
   name, and the photos open large on any page as it stands. Before writing, the old source and sections are
   saved to a file in the system's temp folder, whose name is printed. Nothing is written when ET does not
   answer, or answers with no speakers.
   ET's API from a network that inspects TLS needs that network's certificate: run it with
   NODE_EXTRA_CA_CERTS=<pem>. Needs the same credentials as the server (tools/.env.local locally). */
const fs = require('fs');
const os = require('os');
const path = require('path');

(function loadLocalEnv() {
  var file = path.join(__dirname, '..', '..', 'tools', '.env.local');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
})();

const { getFirebase } = require('./firebase');
const { safeFetch } = require('./safe-fetch');
const etPrevious = require('./et-previous');
const prevSections = require('./prev-sections');
const genDesign = require('./gen-design');
const { scopeSectionCss, sectionRootInfo } = require('./gen-markup');

function arg(name) {
  var hit = process.argv.filter(function (a) { return a.indexOf('--' + name + '=') === 0; })[0];
  return hit ? hit.slice(name.length + 3) : '';
}
var DRY = process.argv.indexOf('--dry') !== -1;
var EVENT = arg('event') || 'brand-world-summit-2026';
var KINDS = ['speakers', 'glimpses'];

/* as lib/api.js reads ET's API (readEtPrevious) */
function fetchJson(u, headers) {
  return safeFetch(u, { timeoutMs: 15000, maxBytes: 6 * 1024 * 1024, headers: Object.assign({ accept: 'application/json' }, headers || {}) })
    .then(function (r) { return r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null; });
}

/* a section as generate-content stores it (lib/api.js) — its row kept still where the site had it still */
function sectionOf(kind, previous, old) {
  var id = prevSections.IDS[kind];
  var built = prevSections.build(kind, previous, {});
  if (!built) return null;
  var html = built.html;
  if (old && !/data-rv-carousel\s*=\s*["']auto["']/i.test(String(old.html || ''))) html = html.replace(/data-rv-carousel="auto"/g, 'data-rv-carousel');
  var css = genDesign.capHeadingSizes(genDesign.clampFontSizes(scopeSectionCss(built.css, id, sectionRootInfo(html))), html);
  return Object.assign({}, old || {}, { id: id, kind: 'custom', html: html, css: css });
}

function profiles(list) {
  list = list || [];
  function n(f) { return list.filter(f).length; }
  return list.length + ' speakers — ' + n(function (s) { return s.sessions && s.sessions.length; }) + ' with sessions, ' +
    n(function (s) { return s.linkedin; }) + ' with LinkedIn, ' + n(function (s) { return s.x; }) + ' with X, ' +
    n(function (s) { return s.bio; }) + ' with their own text, ' + n(function (s) { return s.logo; }) + ' with a company logo';
}

function main() {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(EVENT)) throw new Error('Not an event id: ' + EVENT);
  var fb = getFirebase();
  if (fb.error) throw new Error('Cannot start: ' + fb.error);
  var ref = fb.db.collection('events').doc(EVENT);
  return Promise.all([ref.get(), ref.collection('sources').get()]).then(function (got) {
    var snap = got[0];
    if (!snap.exists) throw new Error('No event ' + EVENT + '.');
    var data = snap.data() || {};
    var sections = Array.isArray(data.generatedSections) ? data.generatedSections : [];
    var src = got[1].docs.filter(function (d) { var v = d.data() || {}; return v.type === 'previousEdition' && v.previous; })[0];
    if (!src) throw new Error(EVENT + ' has no previousEdition source with a previous edition on it.');
    var old = src.data().previous || {};
    var portal = arg('portal') || old.portal || etPrevious.portalOf(src.data().url || '');
    var id = arg('id') || old.id;
    if (!portal || !/^\d{1,9}$/.test(String(id || ''))) throw new Error('No ET portal / id to read (pass --portal=<slug> --id=<n>).');
    console.log('Event       ' + EVENT + '  (source ' + src.id + ')');
    console.log('ET edition  ' + portal + ' / ' + id + '  ' + (old.name || ''));
    console.log('Now stored  ' + profiles(old.speakers) + '; ' + (old.glimpses || []).length + ' glimpses');

    return etPrevious.readPrevious(src.data().url || old.url || '', '', { fetchJson: fetchJson, portal: portal, id: String(id) }).then(function (fresh) {
      if (!fresh || !fresh.speakers.length) throw new Error('ET did not answer with this edition\'s speakers — nothing written. (Behind a TLS-inspecting network, set NODE_EXTRA_CA_CERTS.)');
      var next = Object.assign({}, old, fresh);
      // a list ET now has nothing for keeps what was stored (the glimpses read off the page, say)
      ['sponsors', 'agenda', 'glimpses'].forEach(function (k) { if (!(fresh[k] && fresh[k].length) && old[k] && old[k].length) next[k] = old[k]; });
      ['name', 'url', 'start', 'end', 'venue'].forEach(function (k) { if (!fresh[k] && old[k]) next[k] = old[k]; });
      console.log('From ET     ' + profiles(next.speakers) + '; ' + (next.glimpses || []).length + ' glimpses');
      var dropped = (old.speakers || []).filter(function (s) { return !next.speakers.some(function (x) { return x.name === s.name; }); }).map(function (s) { return s.name; });
      if (dropped.length) console.log('            no longer listed (ET does not show them): ' + dropped.join(', '));

      var updated = sections.slice(), changed = [];
      KINDS.forEach(function (kind) {
        var sid = prevSections.IDS[kind], at = -1;
        updated.forEach(function (s, i) { if (s && s.id === sid) at = i; });
        if (at === -1) { console.log('Section     ' + sid + ': not on this site — left out'); return; }
        var made = sectionOf(kind, next, updated[at]);
        if (!made) { console.log('Section     ' + sid + ': nothing to build — left as it is'); return; }
        console.log('Section     ' + sid + ': ' + String(updated[at].html || '').length + ' -> ' + made.html.length + ' bytes of html' +
          (kind === 'speakers' ? ', ' + (made.html.match(/<template data-rv-profile>/g) || []).length + ' cards open a profile' : '') +
          (/data-rv-carousel="auto"/.test(made.html) ? ', moving row' : ', still row'));
        updated[at] = made;
        changed.push(sid);
      });

      if (DRY) { console.log('\n--dry: nothing written.'); return; }
      var backup = path.join(os.tmpdir(), 'previous-profiles-' + EVENT + '-' + Date.now() + '.json');
      fs.writeFileSync(backup, JSON.stringify({ event: EVENT, source: src.id, previous: old, generatedSections: sections.filter(function (s) { return s && changed.indexOf(s.id) !== -1; }) }, null, 1));
      console.log('\nBackup      ' + backup);
      return src.ref.update({ previous: next }).then(function () {
        return changed.length ? ref.update({ generatedSections: updated }) : null;
      }).then(function () { console.log('Written     source ' + src.id + '.previous' + (changed.length ? ' and generatedSections: ' + changed.join(', ') : '')); });
    });
  });
}

Promise.resolve().then(main).then(function () { process.exit(0); }, function (err) { console.error(err && err.message || err); process.exit(1); });
