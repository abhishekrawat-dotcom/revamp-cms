/* A generated site keeps one background family top to bottom — no chessboard of light and dark sections — and its
   buttons say it short (owner, 10 Nov 2026: "All microsites are being designed on chess pattern, light and dark
   section simultaniously. for a smooth website single/similar background of sections are recomonded"; "avoid using
   this much long CTA text"). Plain node. */
'use strict';
var fs = require('fs'), path = require('path');
var API = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
var OB = require('./owner-brief');
var passed = 0, failed = 0;
function check(name, ok, info) { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (info !== undefined ? ' — ' + JSON.stringify(info).slice(0, 300) : '')); } }
var tone = API.slice(API.indexOf('function toneRule(design) {'), API.indexOf('\n}\n', API.indexOf('function toneRule(design) {')));
check('the sections\' rule is one tone, always (no dark-band branch left)', /ONE TONE FOR THE WHOLE PAGE/.test(tone) && !/NEW_ET_STANDARD/.test(tone) && !/DEEP, DARK/.test(tone), tone.slice(0, 300));
check('the plan asks for one background, never alternating dark bands', /ONE BACKGROUND: every section sits on the page\\'s own background or its soft surface tint — no deep or dark bands between light sections, no chessboard/.test(API) &&
  !/BANDS: the page alternates light sections with a few deep, dark bands/.test(API) && !/BANDS, AS ON ET\\'S NEWER SITES/.test(API));
check('the plan\'s layout field never asks for light / dark flips', /how sections vary \(in layout, never by flipping between light and dark\)/.test(API));
check('buttons say it short, in every section the AI writes', /BUTTONS SAY IT SHORT: one to three words, at most 24 characters/.test(API));
check('the owner\'s own main action becomes short button words', OB.buttonWords("Let's Discuss (partner and engagement)") === "Let's Discuss" && OB.buttonWords('Request a private briefing with our partnerships and events team today') === 'Request a private briefing');
console.log('site-tone: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
