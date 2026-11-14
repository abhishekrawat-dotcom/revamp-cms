// node functions/lib/help-guide.test.js — Getting started (help-guide.js, NU-007): the guide the dashboard's Help
// window shows and ETB2B AI answers a how-to question with. It must be TRUE to the screens: every button or menu name
// it writes in **bold** must still be written in the app's own pages and scripts, so renaming a button fails here until
// the guide says the new name. Also: its shape, its words (no internal names, never the old product's), ES5, and that
// the server offers exactly its topics. No network, no browser, no AI.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'help-guide.js'), 'utf8');
var G = require(path.join(ROOT, 'help-guide.js'));
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

/* ---- ES5, served, and the same object in a browser ---- */
check('G.1 parses', (function () { try { new vm.Script(SRC); return true; } catch (e) { return false; } })());
check('G.1 ES5: no let / const, arrows, template strings, classes', !/\blet\s/.test(SRC) && !/\bconst\s/.test(SRC) && SRC.indexOf('=>') === -1 && SRC.indexOf('`') === -1 && !/\bclass\s/.test(SRC));
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the checks above still ran */ }
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n')[0]; } })();
  check('G.1 ES5 by esbuild', es5 === true, es5);
}
check('G.1 the server sends it (a top-level .js)', require('./access').isServableFile('help-guide.js') === true);
var win = {};
vm.runInNewContext(SRC, { window: win });
check('G.1 in a browser it is window.RevampHelpGuide, the same guide', !!win.RevampHelpGuide && JSON.stringify(win.RevampHelpGuide.STEPS) === JSON.stringify(G.STEPS) && JSON.stringify(win.RevampHelpGuide.TOPICS) === JSON.stringify(G.TOPICS));

/* ---- its shape ---- */
check('G.2 Getting started has its title and line', G.TITLE === 'Getting started' && /^How an event goes from an idea to a live website/.test(G.INTRO));
check('G.2 the steps go from Create Event to live, in order', JSON.stringify(G.STEPS.map(function (s) { return s.id; })) === JSON.stringify(['create', 'build', 'design', 'content', 'preview', 'approval', 'live']));
check('G.2 every step has a title, the screen it is on and its words', G.STEPS.every(function (s) { return s.title && s.where && s.text && s.text.length < 600; }));
var ids = G.TOPICS.map(function (t) { return t.id; });
check('G.2 topic ids are unique, short and plain', ids.length === new Set(ids).size && ids.every(function (id) { return /^[a-z][a-z-]{1,20}$/.test(id); }), ids);
check('G.2 the topics cover what a newcomer asks: the whole journey, create, design, content, preview, publish, live changes, registrations, promotions, portals, finding, support',
  ['start', 'create', 'design', 'content', 'preview', 'approval', 'live-changes', 'registrations', 'promotions', 'portal', 'find', 'support'].every(function (id) { return !!G.topic(id); }));
check('G.2 every topic has a title, what it answers (for the model) and 2 to 7 steps', G.TOPICS.every(function (t) { return t.title && t.ask && Array.isArray(t.steps) && t.steps.length >= 2 && t.steps.length <= 7; }));
check('G.2 topic(): a known id, else null', G.topic('create').title === 'How to create an event' && G.topic('nope') === null && G.topic('') === null);
check('G.2 answerText(): the title in bold, then numbered steps, one a line (the chat draws a bold line and a list)',
  G.answerText('preview') === '**How to preview the site and share a preview**\n1. ' + G.topic('preview').steps[0] + '\n2. ' + G.topic('preview').steps[1] && G.answerText('nope') === '');
check('G.2 plain() takes the bold marks off', G.plain('Press **Create Event**.') === 'Press Create Event.');

/* ---- its words ---- */
var words = [G.TITLE, G.INTRO].concat(G.STEPS.map(function (s) { return s.title + ' ' + s.where + ' ' + s.text; }))
  .concat(G.TOPICS.map(function (t) { return t.title + ' ' + t.steps.join(' '); })).join('\n');
check('G.3 never the old product names, never a bare "ET"', !/Oneworld|Revamp CMS/i.test(words) && !/\bET\b/.test(words), (words.match(/\bET\b[^\n]{0,30}/g) || []).slice(0, 3));
check('G.3 no internal words (slot, staged, template id, wrapper, JSON)', !/\bslot|\bstaged\b|template id|\bwrapper\b|\bJSON\b|\bid\b/i.test(words));
check('G.3 no event, person, address or figure of anyone\'s data (the one number is the preview link\'s 7 days)', !/@|https?:|www\.|\b\d{2,}\b/.test(words) && (words.replace(/ETB2B/g, '').match(/\d+/g) || []).every(function (n) { return n === '7'; }));
check('G.3 payment, e-mail sending and WhatsApp are never promised (sending says "not available yet")', !/WhatsApp|payment/i.test(words) && /Sending from EventSphere is not available yet/.test(words));
check('G.3 approval is said as it is: EventSphere does not e-mail approvers, and nobody approves their own changes', /EventSphere does not e-mail them/.test(words) && /[Nn]obody approves their own changes/.test(words));
check('G.3 every ** opens and closes', G.STEPS.concat(G.TOPICS.map(function (t) { return { text: t.steps.join(' ') }; })).every(function (s) { return (s.text.split('**').length - 1) % 2 === 0; }));

/* ---- TRUE TO THE SCREENS: every bold name is written in the app itself ---- */
var APP_FILES = ['Event_Listing.html', 'create-event.html', 'custom_editor.html', 'edit-event.html', 'edit-event-core.js', 'publish-flow.js', 'review.html',
  'sidebar.js', 'forms-builder.js', 'marketing.html', 'promo-mailer-studio.html', 'promo-posts.js', 'auth.js', 'dash-bot-client.js', 'etb2b-assistant.js', 'share-preview.js'];
var APP = APP_FILES.map(function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }).join('\n')
  .replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/\\u2026/g, '…').replace(/\\u2019/g, '’');
var names = [];
(words.match(/\*\*([^*]+)\*\*/g) || []).forEach(function (m) { var n = m.slice(2, -2); if (names.indexOf(n) === -1) names.push(n); });
check('G.4 the guide names the screens\' buttons in bold (at least 30 of them)', names.length >= 30, names.length);
var missing = names.filter(function (n) { return APP.indexOf(n) === -1; });
check('G.4 every bold name is written in the app\'s own pages and scripts (a renamed button fails here)', missing.length === 0, missing);
/* the ones a newcomer cannot do without, pinned to the screen they are on */
function onPage(file, text) { return fs.readFileSync(path.join(ROOT, file), 'utf8').indexOf(text) !== -1; }
check('G.4 Create Event is the dashboard\'s button', onPage('Event_Listing.html', 'Create Event\n        </a>') || onPage('Event_Listing.html', '>Create Event</a>'));
check('G.4 Create Event\'s four ways in are its buttons', ['>Generate from brief<', '>Choose a previous edition<', '>Import from Lovable<', '>Use this template<'].every(function (t) { return onPage('create-event.html', t); }));
check('G.4 the site editor\'s two modes and Save', ['>Edit with AI<', '>Edit myself<', '>Save</button>'].every(function (t) { return onPage('custom_editor.html', t); }));
check('G.4 Send for approval… is the editor\'s and the console\'s red button (publish-flow.js words it)', onPage('custom_editor.html', '>Send for approval…</button>') && onPage('publish-flow.js', "'Send for approval…'"));
check('G.4 the review page approves with Approve and publish, or Reject', onPage('review.html', '>Approve and publish</button>') && onPage('review.html', '>Reject</button>'));
check('G.4 the rail has Speakers, Agenda, Sponsors, Content, Settings, Design, Promotions and Reporting', ['Speakers', 'Agenda', 'Sponsors', 'Content', 'Settings', 'Design', 'Promotions', 'Reporting'].every(function (l) { return onPage('sidebar.js', "label:'" + l + "'"); }));

/* ---- the server answers with exactly these topics ---- */
var T = require('./dash-bot')._test;
check('G.5 the server\'s topics are the guide\'s', JSON.stringify(T.HELP_IDS) === JSON.stringify(ids));
check('G.5 the answer schema offers them (and "" for none) as `help`', JSON.stringify(T.SCHEMA.properties.help.enum) === JSON.stringify(ids.concat([''])) && T.SCHEMA.required.indexOf('help') === -1);
var ha = T.helpAnswer('registrations', ['x']);
check('G.5 helpAnswer(): the topic\'s text, action help with its id and title, no event, a short memory line', ha.kind === 'reply' && ha.parts.length === 1 && ha.parts[0].v === G.answerText('registrations') &&
  ha.action.type === 'help' && ha.action.what === 'registrations' && ha.action.label === 'How registrations work' && ha.events.length === 0 && ha.notes.indexOf('help') !== -1 && ha.notes.indexOf('x') !== -1 &&
  ha.answerRaw.length < 120 && ha.answerRaw.indexOf('**') === -1, ha);
check('G.5 helpOf(): only a known topic, trimmed', T.helpOf({ help: ' start ' }) === 'start' && T.helpOf({ help: 'nope' }) === '' && T.helpOf({}) === '' && T.helpOf(null) === '');
check('G.5 the stored action keeps the topic (actionForStore)', JSON.stringify(T.actionForStore(ha.action, ha.memo)) === JSON.stringify({ type: 'help', label: 'How registrations work', memo: ha.memo, what: 'registrations' }));

if (failed) { console.error('help-guide: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('help-guide: all ' + passed + ' checks passed');
