/* node functions/lib/portal-fields.test.js — what each ET portal's events are about (portal-fields.js), the field of
   the first hero picture ETB2B AI makes when the person said nothing about it (QA follow-up 2 F3: an ETHRWorld
   "People Meet" got robots and server racks, because its name, not its portal, steered the picture).
     F.1  one table: every portal on ET's roster (lib/et-events.js PORTALS) has its own entry, and nothing else does
     F.2  each entry is safe to draw: a scene of places and objects only (no person, no brand, no word or number to
          letter on), a short field for people to read
     F.3  the fields the owner named: ETHRWorld people and workplaces (as offices, campuses, learning spaces), ETCIO
          technology leadership, ETAuto mobility and vehicles, and so on; a neutral one for no portal
     F.4  place() and subject(), as Create Event's line and the server's record word them
     F.5  ES5, and the same object in a browser (window.RevampPortalFields) and in node
   No network. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var FILE = path.join(__dirname, '..', '..', 'portal-fields.js');
var F = require(FILE);
var etEvents = require('./et-events');
var ROSTER = Object.keys(etEvents.PORTALS);

/* ---- F.1 one table, held to ET's roster both ways ---- */
var missing = ROSTER.filter(function (slug) { return !Object.prototype.hasOwnProperty.call(F.FIELDS, slug); });
check('F.1 every portal on ET\'s roster has its own field (none falls back to the neutral one)', missing.length === 0 && ROSTER.length >= 50, missing);
check('F.1 …and each resolves to it', ROSTER.every(function (slug) { var f = F.fieldOf(slug); return f.portal === true && f.field === F.FIELDS[slug].field && f.scene === F.FIELDS[slug].scene; }),
  ROSTER.filter(function (slug) { return F.fieldOf(slug).portal !== true; }));
var extra = Object.keys(F.FIELDS).filter(function (slug) { return !etEvents.isPortal(slug); });
check('F.1 nothing on the table is off the roster (a portal ET removed is taken off here too)', extra.length === 0, extra);

/* ---- F.2 safe to draw ---- */
var PEOPLE = /\b(people|person|persons|man|men|woman|women|crowds?|audiences?|speakers?|faces?|staff|employees?|workers?|teams?|students?|doctors?|nurses?|leaders?|executives?|delegates?|guests?|shoppers?|customers?|attendees?|presenters?|hands?)\b/i;
var BRANDS = ROSTER.map(function (slug) { return etEvents.PORTALS[slug]; });
function brandIn(s) {
  if (/\bET\b|Economic Times|ETB2B|Oneworld/i.test(s)) return 'ET';
  return BRANDS.filter(function (b) { return s.toLowerCase().indexOf(b.toLowerCase()) !== -1; })[0] || '';
}
var all = Object.keys(F.FIELDS).map(function (slug) { return [slug, F.FIELDS[slug]]; }).concat([['(none)', F.DEFAULT]]);
var bad = all.filter(function (e) {
  var f = e[1];
  return typeof f.field !== 'string' || typeof f.scene !== 'string' || !f.field || !f.scene || f.field.length > 40 || f.scene.length > 160 ||
    /\d|["'`‘’“”{}\[\]<>]/.test(f.field + f.scene) || f.scene !== f.scene.trim() || /\.$/.test(f.scene);
});
check('F.2 every field and scene is a short line of plain words: no digits to letter on, no quote marks or brackets, no full stop', bad.length === 0, bad);
var peopled = all.filter(function (e) { return PEOPLE.test(e[1].scene); }).map(function (e) { return e[0] + ': ' + e[1].scene; });
check('F.2 no scene draws a person (the hero\'s rules allow none): people-heavy fields are drawn as their places', peopled.length === 0, peopled);
var branded = all.filter(function (e) { return brandIn(e[1].scene) || brandIn(e[1].field); }).map(function (e) { return e[0]; });
check('F.2 no field or scene names a brand (a portal\'s name, ET): an image model letters a brand onto the picture', branded.length === 0, branded);
check('F.2 the table cannot be changed by a caller (one object for the page and every request)', Object.isFrozen(F.FIELDS) && Object.isFrozen(F.FIELDS.hr) && Object.isFrozen(F.DEFAULT));

/* ---- F.3 the fields named ---- */
var HR = 'bright modern offices, open workspaces, campuses and learning spaces, with no one in them';
check('F.3 ETHRWorld (and its Southeast Asia and Middle East editions): people and workplaces, as offices, campuses and learning spaces',
  ['hr', 'hrsea', 'hrme'].every(function (s) { return F.FIELDS[s].field === 'people and workplaces' && F.FIELDS[s].scene === HR; }));
check('F.3 ETCIO (all three): technology leadership', ['cio', 'ciosea', 'ciome'].every(function (s) { return F.FIELDS[s].field === 'technology leadership'; }));
var NAMED = { auto: 'mobility and vehicles', retail: 'retail', bfsi: 'banking and finance', health: 'healthcare', energy: 'energy', energymea: 'energy',
  telecom: 'telecommunications', pharma: 'pharmaceuticals', education: 'education', realty: 'real estate', manufacturing: 'manufacturing' };
var wrong = Object.keys(NAMED).filter(function (s) { return F.FIELDS[s].field !== NAMED[s]; });
check('F.3 ETAuto mobility and vehicles, ETRetail retail, ETBFSI banking and finance, ETHealthworld healthcare, ETEnergyworld energy, …', wrong.length === 0, wrong);
check('F.3 ETAuto draws vehicles and roads, ETHealthworld hospitals', /vehicles/.test(F.FIELDS.auto.scene) && /roads/.test(F.FIELDS.auto.scene) && /hospitals/.test(F.FIELDS.health.scene));
check('F.3 no portal, or one off the roster, or an odd value: the neutral field', ['', 'nope', '__proto__', 'toString', 'constructor', null, undefined, 7, {}].every(function (v) {
  var f = F.fieldOf(v); return f.portal === false && f.field === 'business and industry' && f.scene === F.DEFAULT.scene;
}));
check('F.3 fieldOf gives a copy: changing it changes nothing', (function () { var f = F.fieldOf('hr'); f.field = 'x'; return F.fieldOf('hr').field === 'people and workplaces'; })());

/* ---- F.4 place and subject ---- */
check('F.4 place(): the venue, then the city unless the venue names it', F.place('Jio World Centre', 'Mumbai') === 'Jio World Centre, Mumbai' &&
  F.place('Jio World Centre, Mumbai', 'mumbai') === 'Jio World Centre, Mumbai' && F.place('', 'Pune') === 'Pune' && F.place('Taj', '') === 'Taj' && F.place('', '') === '' &&
  F.place('  Jio\nWorld  Centre ', ' Mumbai ') === 'Jio World Centre, Mumbai' && F.place(5, null) === '');
check('F.4 subject(): the field and the place, never a name', F.subject('cio', 'Jio World Centre', 'Mumbai') === 'technology leadership, Jio World Centre, Mumbai' &&
  F.subject('hr', '', 'Bengaluru') === 'people and workplaces, Bengaluru' && F.subject('', '', '') === 'business and industry' && F.subject('auto', 'x'.repeat(300), '').length <= 200);

/* ---- F.5 the file ---- */
var SRC = fs.readFileSync(FILE, 'utf8');
var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
check('F.5 ES5: no let, const, arrows, classes or template strings (the page serves it as it is)', !/\b(let|const|class)\s|=>|`/.test(code));
check('F.5 no raw line or paragraph separator in the file (they end a line in older engines)', !/[\u2028\u2029]/.test(SRC));
var win = { };
vm.runInNewContext(SRC, { window: win }, { filename: 'portal-fields.js' });
check('F.5 in a browser: window.RevampPortalFields, the same table', !!win.RevampPortalFields && JSON.stringify(win.RevampPortalFields.FIELDS) === JSON.stringify(F.FIELDS) &&
  win.RevampPortalFields.subject('cio', 'Jio World Centre', 'Mumbai') === 'technology leadership, Jio World Centre, Mumbai');
check('F.5 served to the pages (a top-level script the server sends)', require('./access').isServableFile('portal-fields.js'));

console.log('portal-fields: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
