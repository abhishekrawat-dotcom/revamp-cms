// node functions/lib/event-description.test.js — the event's description is never the owner's raw brief: the
// brief step no longer stores it, plan-structure writes a real one only where allowed, the repair tool picks
// the right events. No network, no Firebase, no model.
const fs = require('fs');
const path = require('path');
const ed = require('./event-description');

var passed = 0, failed = 0;
function ok(cond, name, detail) { if (cond) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

/* the brief exactly as the owner pasted it for ETCIO Annual Conclave 2027 */
var BRIEF = [
  'Tagline / theme: Lead the shift: from resilience to reinvention',
  'Why attend (what sets it apart): CIO LEADERSHIP CURTAIN RAISER, CIO BOARDROOM BATTLES, WALK THE TALK, INNOVATION HUB, ETCIO STUDIOS',
  'Audience: Chief Digital & AI Officer, Chief Digital Transformation Officer, Chief Digital Officer, Chief Technology Officer, Chief Innovation Officer, Chief Information Officer',
  'Industry: Aviation, BFSI & Fintech, Manufacturing, Energy, Healthcare & Pharma, FMCG, PSUs, Retail & Ecommerce, Digital Native, Logistics & Supply Chain',
  'Level (pan-India / global / regional): Global',
  'Main action (register / request an invite / apply / nominate / become a sponsor): Registration 1000 & become a sponsor 500',
  'Expected scale (delegates, speakers, partners): Delegates & partners',
  'Look and tone (photos or graphics; boardroom / energetic / editorial): All'
].join('\n');
var GOOD = 'The ETCIO Annual Conclave brings India\'s senior technology leaders together to move from resilience to reinvention, through boardroom debate and showcases.';
/* what the rule used to ask for (two or three sentences): longer than Basics will save */
var LONG = 'The ETCIO Annual Conclave brings together India\'s and the world\'s senior technology leaders to move beyond resilience towards reinvention. Over four days of candid boardroom debate, peer conversation and hands-on showcases, CIOs, CTOs and chief digital and AI officers share how they lead transformation across industries.';
var HAND = 'Our flagship gathering of CIOs in Goa, written by the events team.';

/* ---- the brief step: the event's facts are stored, never the description ---- */
var facts = ed.storedFacts({ name: 'ETCIO Annual Conclave 2027', venue: 'Goa', start: '2027-05-21T10:00', description: BRIEF });
ok(!('description' in facts) && facts.name === 'ETCIO Annual Conclave 2027' && facts.venue === 'Goa', 'storedFacts keeps the facts and drops the description');
ok(ed.storedFacts(null) && !Object.keys(ed.storedFacts(null)).length, 'storedFacts of nothing is an empty object');
/* BE-022: only the five facts a brief may set — never the event's portal, its publishing, its deletion or its design */
var hostile = ed.storedFacts({ name: 'X', city: 'Pune', deletedAt: '2026-11-13', published: true, portal: 'etcio', createdBy: 'a@b.c', designPlan: {}, settings: {}, counters: {}, __proto__: { x: 1 } });
ok(JSON.stringify(Object.keys(hostile).sort()) === JSON.stringify(['city', 'name']), 'storedFacts keeps name/start/end/venue/city only', Object.keys(hostile).join(','));
ok(JSON.stringify(ed.BRIEF_FACT_FIELDS) === JSON.stringify(['name', 'start', 'end', 'venue', 'city']), 'the brief facts are named in one place');
/* lib/api.js and the route modules moved out of it as they were (BE-017): the AI site generation, the editor's chat, the Lovable import */
var api = ['api.js', 'api-generate.js', 'api-chat.js', 'api-import.js'].map(function (f) { return fs.readFileSync(path.join(__dirname, f), 'utf8'); }).join('\n');
ok(/var facts = briefFacts\(eventMeta\);/.test(api) && /return watch\.update\(Object\.assign\(\{\}, facts\.value, \{ updatedAt: now(?:, updatedBy: actorOf\(req\.user\))? \}\)\);/.test(api), 'extract-brief writes the checked facts with update(), not eventMeta itself');
ok(/function briefFacts\(eventMeta\) \{\n  var picked = eventDescription\.storedFacts\(eventMeta\)/.test(api) && /EVENT_FIELD_CHECKS\[f\]\(v\)/.test(api), 'briefFacts checks each fact by EVENT_FIELD_CHECKS');
ok(!/watch\.merge\(Object\.assign\(\{\}, eventMeta,/.test(api) && !/storedFacts\(eventMeta\), \{ updatedAt/.test(api), 'no route merges the raw eventMeta (with its description) into the event');

/* ---- which stored descriptions the AI may write ---- */
ok(ed.isRawBrief(BRIEF), 'the pasted brief is the raw brief');
ok(!ed.isRawBrief(HAND) && !ed.isRawBrief('') && !ed.isRawBrief(null), 'a hand-written or empty description is not');
ok(ed.replaceable('', BRIEF) && ed.replaceable(undefined, BRIEF), 'an empty description may be written');
ok(ed.replaceable(BRIEF, BRIEF) && ed.replaceable(BRIEF, ''), 'the raw brief may be replaced, with or without the brief text to compare');
ok(ed.replaceable('A closed-door summit for 300 leaders.', ' A closed-door summit\nfor 300 leaders. '), 'a prose brief stored word for word may be replaced');
ok(!ed.replaceable(HAND, BRIEF), 'a description the owner wrote by hand is never replaced');

/* ---- the model's answer, tidied ---- */
ok(ed.clean(GOOD) === GOOD, 'a good description is kept as it is');
ok(ed.clean('  "' + GOOD + '"\n') === GOOD, 'quotes round it and stray space are taken off');
ok(ed.clean(BRIEF) === '', 'an answer that is the brief again is refused');
ok(ed.clean('Why attend:\n- Curtain raiser\n- Boardroom battles\n- Innovation hub and studios for leaders') === '', 'a list or headings are refused');
ok(ed.clean('- one\n- two three four five six seven eight nine ten eleven twelve') === '', 'a bullet list is refused');
ok(ed.clean('Too short.') === '' && ed.clean('') === '' && ed.clean(null) === '', 'too short or nothing is refused');
var long = ed.clean(new Array(40).join(GOOD + ' '));
ok(long.length <= ed.MAX_LENGTH && /\.$/.test(long), 'a long answer is cut at a full stop', long.length + ' ' + long.slice(-20));

/* ---- it always fits Basics (UX-064): the console saves at most 220 characters, and a longer one there could not be edited ---- */
ok(ed.IDEAL_LENGTH === 160 && ed.MAX_LENGTH === 220, 'the lengths are 160 (ideal) and 220 (most)', ed.IDEAL_LENGTH + ' / ' + ed.MAX_LENGTH);
var core = fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event-core.js'), 'utf8');
var desc = /var DESC = \{ min: (\d+), ideal: (\d+), max: (\d+) \};/.exec(core);
ok(desc && +desc[2] === ed.IDEAL_LENGTH && +desc[3] === ed.MAX_LENGTH, 'the console\'s Basics and the writer agree on the lengths', desc && desc[0]);
ok(GOOD.length <= ed.IDEAL_LENGTH && ed.clean(GOOD) === GOOD, 'a description of the asked-for length is kept whole', GOOD.length);
var cutLong = ed.clean(LONG);
ok(cutLong === LONG.slice(0, LONG.indexOf('. ') + 1) && cutLong.length <= ed.MAX_LENGTH, 'the older, longer kind is cut to its first sentence', cutLong.length + ' ' + cutLong);
var oneSentence = 'An evening for India\'s retail leaders ' + new Array(30).join('with candid conversations and showcases ') + 'and more';
var cutWord = ed.clean(oneSentence);
ok(cutWord.length <= ed.MAX_LENGTH && /…$/.test(cutWord) && !/\s…$/.test(cutWord) && oneSentence.indexOf(cutWord.slice(0, -1)) === 0 && /\S$/.test(cutWord.slice(0, -1)),
  'one sentence too long is cut at a whole word, with an ellipsis, and still fits', cutWord.length + ' ' + cutWord.slice(-30));
ok([LONG, oneSentence, new Array(60).join('Word ')].every(function (t) { return ed.clean(t).length <= ed.MAX_LENGTH; }), 'nothing the writer stores is longer than Basics takes');
ok(/at most 160 characters/.test(ed.RULE) && !/60 words/.test(ed.RULE), 'the model is asked for at most 160 characters', ed.RULE.slice(0, 80));

/* ---- plan-structure: what it writes ---- */
ok(JSON.stringify(ed.patch(GOOD, { description: BRIEF }, BRIEF)) === JSON.stringify({ description: GOOD }), 'over the raw brief: written');
ok(JSON.stringify(ed.patch(GOOD, {}, BRIEF)) === JSON.stringify({ description: GOOD }), 'over no description: written');
ok(ed.patch(GOOD, { description: HAND }, BRIEF) === null, 'over a hand-written one: nothing');
ok(ed.patch('', { description: BRIEF }, BRIEF) === null && ed.patch(undefined, {}, '') === null, 'no usable answer: nothing');
ok(ed.patch(BRIEF, { description: '' }, BRIEF) === null, 'an answer that is the brief: nothing');
ok(ed.patch(GOOD, { description: GOOD }, BRIEF) === null, 'the same text again: nothing');
var genApi = require('./api.js');
var schema = genApi.DESIGN_PLAN_SCHEMA || (genApi._testHooks || {}).DESIGN_PLAN_SCHEMA;
ok(schema && schema.properties.eventDescription && schema.properties.eventDescription.description === ed.RULE && schema.required.indexOf('eventDescription') !== -1, 'the plan is asked for eventDescription, by the shared rule');
var build = genApi.buildDesignPlanPrompt || (genApi._testHooks || {}).buildDesignPlanPrompt;
if (build) ok(/- eventDescription: /.test(build({ eventMeta: { name: 'X' }, reference: { basis: null, others: [] }, artDirection: { id: 'a' } })), 'the plan prompt names the task');
ok(/eventDescription\.patch\(r\.parsed && r\.parsed\.eventDescription, stored, \(payload\.eventMeta \|\| \{\}\)\.description\)/.test(api), 'plan-structure writes through patch(), against the stored description and the brief it was sent');
ok(/logActivity\(fb, eventId, req\.user, 'updated', eventDescription\.activityDetail\(!!prevSource\), \{ area: 'event'/.test(api), 'plan-structure logs the description it wrote');
ok(ed.activityDetail(false) === 'Description written by AI from the brief' && ed.activityDetail(true) === 'Description written by AI from the brief and the previous edition',
  'NU-025 the log names the previous edition only when one was read');
ok(/described: described \? \{ description: described\.description, from: String\(stored\.description \|\| ''\), previous: !!prevSource \}/.test(api) &&
  /eventDescription\.activityDetail\(!!\(described && described\.previous\)\)/.test(api), 'NU-025 … also when the description goes on the event with the site');
ok(/'AI wrote the site’s ' \+ sections\.length \+ ' sections' \+ \(hadSite \? ' again, in place of the last ones' : ''\)/.test(api) &&
  /hadSite = !!\(cur\.generatedSite \|\| cur\.generatedAt/.test(api), 'NU-025 "again" only when the event had a site written before');
ok(/never invent numbers, dates, speakers or sponsors/i.test(ed.RULE) && /no headings, no bullet lists/i.test(ed.RULE), 'the rule forbids invented facts and lists');

/* ---- the repair prompt ---- */
var owner = require('./owner-brief').normalise(require('./owner-brief').fromText(BRIEF));
var prompt = ed.buildPrompt({
  event: { name: 'ETCIO Annual Conclave 2027', start: '2027-05-21T10:00', end: '2027-05-24T18:46', venue: 'Goa' },
  brief: { theme: 'Lead the shift', keyMessages: ['Global-level event for CIO and digital leaders'], owner: owner },
  previous: { name: 'ETCIO Annual Conclave 2026', venue: 'Grand Hyatt, Goa' },
  previousSummary: [{ heading: 'Welcome to the Most Powerful Room in Indian Tech', body: 'A four-day residential gathering.' }]
});
ok(/name: ETCIO Annual Conclave 2027/.test(prompt) && /dates: 21–24 May 2027/.test(prompt) && /venue: Goa/.test(prompt), 'the prompt has the event\'s facts', prompt.slice(0, 300));
ok(/what sets it apart: CIO LEADERSHIP CURTAIN RAISER/.test(prompt) && /level: Global/.test(prompt), 'the prompt has the owner\'s points');
ok(/name: ETCIO Annual Conclave 2026/.test(prompt) && /Most Powerful Room/.test(prompt), 'the prompt has the previous edition');
ok(prompt.indexOf(ed.RULE) !== -1, 'the prompt carries the same rule');
ok(!/Main action \(register/.test(prompt), 'the brief\'s headings are not handed over as they were typed');
ok(ed.dateText('2027-05-21', '') === '21 May 2027' && ed.dateText('2026-12-30', '2027-01-02') === '30 December 2026 – 2 January 2027' && ed.dateText('', '') === '', 'dates read');

/* ---- the repair tool: which events ---- */
var tool = require('../../tools/repair-description.js');
var docs = [
  { id: 'etcio-annual-conclave-2027', data: { name: 'ETCIO', description: BRIEF } },
  { id: 'hand-written', data: { description: HAND } },
  { id: 'empty', data: {} },
  { id: 'gone', data: { description: BRIEF, deletedAt: '2026-10-01' } },
  { id: 'qa-copy', data: { description: BRIEF } }
];
ok(tool.pick(docs).map(function (d) { return d.id; }).join() === 'etcio-annual-conclave-2027', '--all picks only live, non-qa events whose description is the raw brief', tool.pick(docs).map(function (d) { return d.id; }).join());
ok(tool.pick(docs, { includeQa: true }).map(function (d) { return d.id; }).join() === 'etcio-annual-conclave-2027,qa-copy', '--event takes a qa- copy too');
var inp = tool.promptInputs({ name: 'N', venue: 'Goa' }, { extracted: { theme: 'T' } }, [{ type: 'competitor', previous: { name: 'no' } },
  { type: 'previousEdition', previous: { name: 'N 2026', venue: 'V', start: '2026-05-01' }, extractedSections: [{ heading: 'h', body: 'b' }] }]);
ok(inp.previous.name === 'N 2026' && inp.previousSummary.length === 1 && inp.brief.theme === 'T' && inp.event.venue === 'Goa', 'the prompt is built from the previous-edition source and the latest brief');
ok(tool.promptInputs({}, null, []).previous === null, 'no previous edition, no brief: still a prompt');

console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
