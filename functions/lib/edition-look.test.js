/* node functions/lib/edition-look.test.js — exits 1 on the first failure it lists. No network, no Firebase. */
const fs = require('fs');
const path = require('path');
const el = require('./edition-look');
const gd = require('./gen-design');
const api = require('./api')._testHooks;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

/* ---- parseColour ---- */
ok(el.parseColour('#EA3F5C').hex === '#ea3f5c', 'hex6');
ok(el.parseColour('#fe0').hex === '#ffee00', 'hex3');
ok(el.parseColour('rgba(238, 235, 226, 1)').hex === '#eeebe2', 'rgba with commas');
ok(el.parseColour('rgb(238 235 226 / 30%)').a === 0.3, 'rgb space syntax with alpha');
ok(el.parseColour('234,  63,  92').hex === '#ea3f5c', 'a bare r,g,b triple (ET\'s --theme-color)');
ok(el.parseColour('var(--x)') === null && el.parseColour('rgb(300,0,0)') === null, 'not a colour');

/* ---- readLook on the real Brand World Summit South 2025 page (its own styles + banner, an excerpt) ---- */
var BWS_URL = 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025';
var bws = fs.readFileSync(path.join(__dirname, 'fixtures', 'edition-look', 'bws-south-2025.html'), 'utf8');
/* the platform's shared stylesheet speaks of ET's red and Bootstrap's blues, often: never the event's */
var platformCss = 'body{background:#ffffff;color:#333333;font-family:Roboto}' + new Array(40).join('.btn-et{color:#ed1c24;border-color:#ed1c24}.link{color:#00afdf}.ok{color:#5ab240}');
var look = el.readLook(bws, platformCss);
ok(look.brand === '#ea3f5c', 'brand: the page\'s own --theme-color-hex, not ET\'s red', look.brand);
ok(look.background === '#eeebe2', 'ground: the sand the page sets on body, not the platform\'s white', look.background);
ok(look.text === '#191b1f', 'text: the dark the page\'s own rules use', look.text);
ok(look.muted === '#5f666e', 'secondary text', look.muted);
ok(look.surface && gd.contrast(look.text, look.surface) >= 7 && look.surface !== look.background, 'surface: a readable step from the ground', look.surface);
ok(look.headingFontRaw === 'SangBleu Versailles' && look.headingFont === 'Playfair Display', 'headings: SangBleu Versailles -> its nearest Google family', look.headingFontRaw + ' / ' + look.headingFont);
ok(look.bodyFont === 'Montserrat', 'body: Montserrat', look.bodyFont);

/* ---- the lock-up's colours: magenta to orange ---- */
var lockup = '<svg><defs><linearGradient id="a"><stop offset="0" stop-color="#fd1458"/><stop offset=".5" stop-color="#fd1453"/><stop offset="1" stop-color="#fd3901"/></linearGradient>' +
  '<linearGradient id="b"><stop stop-color="#fd3600"/><stop stop-color="#fd2c00"/><stop stop-color="#8300a2"/></linearGradient></defs>' +
  '<path fill="#fd115a"/><path fill="#000"/><path fill="#ffffff"/><path style="fill:#fd3901"/></svg>';
var lc = el.logoColours(lockup);
ok(lc.length >= 2 && el.parseColour(lc[0]) && lc.indexOf('#000000') === -1, 'lock-up colours, no black or white', lc.join(','));
var withLogo = el.withLogo(look, lc);
ok(withLogo.brand === '#ea3f5c', 'the page\'s brand stays');
ok(/^#fd3[0-9a-f]{3}$|^#fd2c00$/.test(withLogo.accent), 'the accent is the lock-up\'s orange, a hue apart from the brand', withLogo.accent);
ok(el.withLogo({}, lc).brand === lc[0], 'with no brand on the page, the lock-up gives it');

/* ---- the key visual ---- */
ok(el.keyVisualOf(bws, BWS_URL) === 'https://img.etb2bimg.com/files/data_file_17873160892968_98403.jpg', 'banner picture of the real page', el.keyVisualOf(bws, BWS_URL));
ok(el.keyVisualOf('<div class="ad-banner" style="background:url(/ad.jpg)"></div><section class="hero"><img class="logo" src="/l.png"><img src="/stage.jpg"></section>', 'https://x.in/e') === 'https://x.in/stage.jpg',
  'an ad banner is not the banner; a logo inside it is not the picture');
ok(el.keyVisualOf('<style>#top-banner{background-image:url("/kv.webp")}</style><header id="top-banner"></header>', 'https://x.in/e/') === 'https://x.in/kv.webp', 'a rule of the page\'s own for the banner');
ok(el.keyVisualOf('<section class="speakers"><img src="/a.jpg"></section>', 'https://x.in') === '', 'no banner -> nothing');

/* ---- fonts ---- */
ok(el.googleFont('theano_didotregular') === 'Playfair Display', 'Theano Didot is not on Google Fonts: the nearest Google family');
ok(el.googleFont('montserrat-bold') === 'Montserrat' && el.googleFont('Mukta Vaani') === 'Mukta Vaani', '@font-face local name of a Google family; any family in the catalogue');
ok(el.googleFont('SangBleuVersailles-Bold-WebS') === 'Playfair Display', 'a commercial family -> its substitute');
ok(el.googleFont('Gotham') === 'Montserrat' && el.googleFont('Some Custom Face') === '', 'substitutes; an unknown family is the model\'s to match');

/* ---- the place: read from the words given; no city is known to the code ---- */
var src = fs.readFileSync(path.join(__dirname, 'edition-look.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/chennai|mumbai|delhi|bengaluru|pune|gurugram|brand world|brandequity|\b20[2-3]\d\b/i.test(src), 'no city, event, portal or year in the code');
var here = el.placeOf({ venue: 'Taj Wellington Mews, Chennai', city: '' });
ok(here && here.city === 'Chennai' && here.cues === '' && here.motif === '', 'the city of a venue, its cues left to the plan model', JSON.stringify(here));
ok(el.placeOf({ location: 'JW Marriott, Sahar, Mumbai 400099' }).city === 'Mumbai' && el.placeOf({ city: 'Nagpur', venue: 'Radisson Blu' }).city === 'Nagpur', 'the city field, else the last part of the venue, pin code dropped');
ok(el.placeOf({ venue: 'Online' }) === null && el.placeOf({}) === null && el.placeOf({ venue: 'Grand Ballroom' }) === null, 'no place');
/* rule 3: this edition's venue, else the previous edition's — never a mix */
var v1 = el.venueForDesign({ venue: 'Hyatt Regency, Pune' }, null, { venue: 'ITC Grand Chola, Chennai' });
ok(v1.source === 'current' && v1.city === 'Pune' && v1.venue === 'Hyatt Regency, Pune', 'this edition\'s venue wins', JSON.stringify(v1));
var v2 = el.venueForDesign({ venue: 'TBA' }, null, { venue: 'ITC Grand Chola, Chennai' });
ok(v2.source === 'previous' && v2.city === 'Chennai', 'none named yet: the previous edition\'s', JSON.stringify(v2));
ok(el.venueForDesign({}, null, null).source === '', 'neither: no place');

/* ---- inspired by, never a copy (rule 1) ---- */
var model = { mode: 'light', themeColor: '#1f6feb', accentColor: '#22c55e', backgroundColor: '#ffffff', surfaceColor: '#f3f4f6', textColor: '#111827', mutedColor: '#4b5563', headingFont: 'Inter', bodyFont: 'Inter' };
var inspired = Object.assign({}, model, el.inspiredDesign(withLogo, model, 'auto'));
/* a shade apart is still a copy of the brand or second colour (20); grounds, cards and text: 6 */
function apart(a, b, min) { var p = el.parseColour(a).hex, q = el.parseColour(b).hex, d = 0; for (var i = 1; i < 7; i += 2) d += Math.pow(parseInt(p.substr(i, 2), 16) - parseInt(q.substr(i, 2), 16), 2); return Math.sqrt(d) >= (min || 6); }
var editionColours = [look.brand, withLogo.accent, look.background, look.surface, look.text, look.muted].concat(withLogo.logoColours || []);
['themeColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor', 'mutedColor'].forEach(function (k) {
  ok(editionColours.every(function (c) { return apart(inspired[k], c, /^(themeColor|accentColor)$/.test(k) ? 20 : 6); }), k + ' is none of the edition\'s own colours', inspired[k]);
});
ok(gd.luminance(inspired.backgroundColor) > 0.6 && inspired.mode === 'light' && inspired.backgroundColor !== '#ffffff', 'the edition\'s light, tinted tone', inspired.backgroundColor);
ok(el.fontKind(inspired.headingFont) === 'serif' && inspired.headingFont !== look.headingFont && inspired.bodyFont !== look.bodyFont, 'type of the same feel (serif headings), never the edition\'s families', inspired.headingFont + ' / ' + inspired.bodyFont);
var pal = gd.palette(inspired, 'auto');
ok(pal.backgroundColor === inspired.backgroundColor && pal.textColor === inspired.textColor && gd.contrast(pal.textColor, pal.backgroundColor) >= 7, 'the inspired palette passes the readability check unchanged', JSON.stringify(pal));
var copyAttempt = el.inspiredDesign(withLogo, { mode: 'light', themeColor: look.brand, backgroundColor: look.background, textColor: look.text, headingFont: look.headingFont, bodyFont: look.bodyFont }, 'auto');
ok(copyAttempt.themeColor && copyAttempt.themeColor !== look.brand && copyAttempt.backgroundColor && copyAttempt.backgroundColor !== look.background && copyAttempt.headingFont && copyAttempt.bodyFont, 'a model that copied the edition is moved off it', JSON.stringify(copyAttempt));
var darkAsked = el.inspiredDesign(withLogo, model, 'dark');
ok(!darkAsked.backgroundColor && !darkAsked.mode && darkAsked.themeColor, 'the owner asked for dark: hue and type only, the tone is the owner\'s', JSON.stringify(darkAsked));
ok(el.ownerSetsLook('make it dark and use navy colours') && el.ownerSetsLook('#123456 please') && !el.ownerSetsLook('energetic') && !el.ownerSetsLook(''), 'owner words about the look');

/* ---- another edition: another portal, another year, a dark page (nothing is specific to the test case) ---- */
var AUTO_URL = 'https://auto.economictimes.indiatimes.com/ev-conclave-2023';
var other = '<!doctype html><html><head><link rel="stylesheet" href="https://st.etb2bimg.com/Themes/Release/etb2b_microsite_bundle.min.css">' +
  '<style>:root{--brand-color:#14b8a6}body{background-color:#0b1220;color:#e8edf5;font-family:"Sora",sans-serif}' +
  '.sec-title h2{font-family:"Sora",sans-serif;color:#14b8a6}.card{background:#131c2e;color:#9fb0c8}.card p{color:#9fb0c8}.pill{background:#f59e0b}.pill2{border-color:#f59e0b}</style></head>' +
  '<body><div class="ad-banner" style="background:url(https://ads.example.com/a.jpg)"></div>' +
  '<div class="main-banner"><img class="evt-logo" src="/files/logo.svg"><img src="/files/stage-2023.webp" alt=""></div></body></html>';
var olook = el.withLogo(el.readLook(other, platformCss), el.logoColours('<svg><path fill="#14b8a6"/><path fill="#0ea5e9"/><path fill="#0ea5e9"/></svg>'));
ok(olook.brand === '#14b8a6' && olook.background === '#0b1220' && olook.bodyFont === 'Sora', 'another portal\'s page: its own brand, dark ground and type', JSON.stringify(olook));
ok(el.keyVisualOf(other, AUTO_URL) === 'https://auto.economictimes.indiatimes.com/files/stage-2023.webp', 'its banner picture (not the ad, not the logo)', el.keyVisualOf(other, AUTO_URL));
var omodel = { mode: 'dark', themeColor: '#ef4444', backgroundColor: '#000000', textColor: '#ffffff', headingFont: 'Playfair Display', bodyFont: 'Lora' };
var oins = Object.assign({}, omodel, el.inspiredDesign(olook, omodel, 'auto'));
ok(oins.mode === 'dark' && gd.luminance(oins.backgroundColor) < 0.2 && oins.backgroundColor !== olook.background, 'a dark edition gives a dark site of its own', JSON.stringify(oins));
ok(el.fontKind(oins.headingFont) === 'sans' && oins.headingFont !== 'Sora' && oins.themeColor !== olook.brand && Math.abs(gd.luminance(oins.themeColor) - gd.luminance(olook.brand)) < 0.3, 'sans feel, a colour of the edition\'s family that is its own', oins.headingFont + ' ' + oins.themeColor);
var ov = el.venueForDesign({ venue: '' }, null, { venue: 'Hotel Leela Ambience, Gurugram' });
ok(ov.source === 'previous' && ov.city === 'Gurugram', 'its venue when this edition names none', JSON.stringify(ov));

/* ---- image prompts carry the city as the plan wrote it ---- */
var design = { mode: 'light', themeColor: '#f42a58', place: { city: 'Pune', cues: 'Peshwa-era stone wadas and teak balconies', motif: 'a border' } };
var hero = gd.imagePrompt('a summit hall', design, { hero: true });
ok(/the event is in Pune/.test(hero) && /teak balconies/.test(hero) && /never a tourist postcard/.test(hero), 'hero prompt: the city, recognisably (its landmarks worked into the key visual)', hero);
ok(/the event is in Pune/.test(gd.imagePrompt('delegates over coffee', design, {})), 'section prompt: the city where the scene allows');
ok(!/Place:/.test(gd.imagePrompt('x', { mode: 'light' }, {})), 'no place, no place line');
ok(/as someone from Nagpur would recognise/.test(gd.imagePrompt('x', { place: { city: 'Nagpur' } }, {})), 'no cues written: the picture is asked to find them');
var inspiredHero = gd.imagePrompt('a summit hall', { inspiredBy: 'An illustrated coastline at dawn.' }, { hero: true });
ok(/banner artwork was this — An illustrated coastline/.test(inspiredHero) && /never a copy/.test(inspiredHero), 'the hero is inspired by the edition\'s banner, in words', inspiredHero);
ok(!/Inspiration/.test(gd.imagePrompt('x', { inspiredBy: 'An illustrated coastline.' }, {})), 'only the hero is told about the banner');
var long = gd.imagePrompt('x', { place: { city: 'Pune', cues: 'stone wadas.' }, inspiredBy: 'A long description. ' + new Array(200).join('word ') }, { hero: true });
ok(/wadas — stylised/.test(long) && / word\. Make a NEW/.test(long) && !/\.\./.test(long), 'model-written text ends cleanly in the prompt (no "..", no half word)', long.slice(0, 400));

/* ---- plan-structure ---- */
var srcDoc = { type: 'previousEdition', url: BWS_URL, colorSignals: ['#ed1c24', '#00afdf'], fontSignals: ['Montserrat'], look: withLogo,
  keyVisual: { url: 'https://img.example.com/kv.jpg', description: 'An illustrated coastline with temple towers and houseboats.', place: 'a coast' } };
var ti = api.extractThemeFromPreviousEditionSources([srcDoc]);
ok(ti.themeColor === '#ea3f5c' && ti.look && ti.keyVisual, 'theme from the look, not from the platform\'s colour count', JSON.stringify(ti).slice(0, 300));
var old = api.extractThemeFromPreviousEditionSources([{ type: 'previousEdition', colorSignals: ['#ed1c24'], fontSignals: ['Montserrat'] }]);
ok(old.themeColor === '#ed1c24' && !old.look, 'a source read before the look: colorSignals as before');
var lines = api.editionLookLines(ti.look, ti.keyVisual).join('\n');
ok(/INSPIRED BY/.test(lines) && /never reuse these hex values/.test(lines) && /banner artwork/i.test(lines) && /never a copy/.test(lines), 'the plan prompt: inspired by, never a copy', lines);
var placeArg = el.venueForDesign({ venue: 'Taj Wellington Mews, Chennai' }, null, null);
var base = { eventMeta: { name: 'Some Summit', venue: 'Taj Wellington Mews, Chennai' }, reference: { basis: null, others: [] }, artDirection: gd.artDirectionFor('x'), themeMode: 'auto', siteMode: 'standard' };
var prompt = api.buildDesignPlanPrompt(Object.assign({}, base, { themeInfo: ti, place: placeArg }));
ok(/THE PLACE: this edition takes place at "Taj Wellington Mews, Chennai"/.test(prompt) && /design\.placeCity/.test(prompt) && /never write them, or any instruction, on the site/.test(prompt), 'plan prompt: the place, cues for the model to write, no directions on the site');
ok(api.DESIGN_PLAN_SCHEMA.properties.design.properties.placeCues && api.DESIGN_PLAN_SCHEMA.properties.design.required.indexOf('placeMotif') !== -1, 'the plan writes the city\'s cues and motif');
/* rule 4: no previous-edition link -> exactly as before: no inspiration, no place block */
var none = api.buildDesignPlanPrompt(Object.assign({}, base, { themeInfo: api.extractThemeFromPreviousEditionSources([]) }));
ok(!/THE PLACE/.test(none) && !/INSPIRED BY/.test(none) && /No previous edition was given/.test(none), 'no previous edition: designed as before');
var code = api.buildSectionCodePrompt({ designPlan: { design: { mode: 'light', place: design.place }, sections: [] }, eventMeta: {} });
ok(/THE PLACE: this edition takes place in Pune/.test(code) && /Draw NO ornament/.test(code) && !/a border/.test(code) && /never write them/.test(code), 'section code prompt: the city by name, never a drawn ornament (ET\'s newer standard)');
ok(!/THE PLACE/.test(api.buildSectionCodePrompt({ designPlan: { design: { mode: 'light' }, sections: [] }, eventMeta: {} })), 'no place, no place block');

/* ---- ingest: the banner picture read in words with the page ---- */
ok(api.ingestSchemaFor(false).properties.keyVisual === undefined && api.ingestSchemaFor(true).required.indexOf('keyVisual') !== -1, 'the schema asks about the picture only when one is attached');
var kept = api.keptKeyVisual({ url: 'https://a/b.jpg', width: 1400, height: 804, mime: 'image/jpeg' }, { description: 'x', place: 'y' });
ok(kept.url === 'https://a/b.jpg' && kept.description === 'x' && kept.place === 'y' && api.keptKeyVisual(null, {}) === null, 'kept in words, with its address');

/* ---- review: recolour moves only colours, never words, white plates or "white-space" ---- */
var rFrom = { themeColor: '#ed1c24', backgroundColor: '#ffffff', surfaceColor: '#fff3ea', textColor: '#1a1414' };
var rTo = { themeColor: '#f42a58', backgroundColor: '#f5f3ee', surfaceColor: '#f7e9e8', textColor: '#141414' };
var rCss = '.n{white-space:nowrap;color:#ed1c24;background:rgba(237,28,36,.12)}.tile{--rv-keep:1;background:#ffffff;border:1px solid #ed1c24}.b{background:#fff3ea;color:white}';
var rc = el.recolour(rCss, rFrom, rTo, 'css');
ok(/white-space:nowrap/.test(rc) && !/#f5f3ee-space/.test(rc), 'recolour: "white-space" is not a colour', rc);
ok(/\.tile\{--rv-keep:1;background:#ffffff;border:1px solid #ed1c24\}/.test(rc), 'recolour: a --rv-keep rule (a logo\'s white plate) keeps its colours', rc);
ok(/color:#f42a58/.test(rc) && /rgba\(244,42,88,0\.12\)/.test(rc) && /background:#f7e9e8/.test(rc), 'recolour: brand, its tint and the surface move', rc);
ok(/color:white/.test(rc), 'recolour: pure white is never moved (a label on the brand colour)', rc);
var rHtml = '<div class="text-white" style="color:#ed1c24"><a href="#add">Download the white paper &#8217;s #ed1c24 note</a><svg><path fill="#ed1c24"/></svg><style>.x{color:#ed1c24}</style></div>';
var rh = el.recolour(rHtml, rFrom, rTo, 'html');
ok(/class="text-white"/.test(rh) && /white paper &#8217;s #ed1c24 note/.test(rh) && /href="#add"/.test(rh), 'recolour html: words, classes and links untouched', rh);
ok(/style="color:#f42a58"/.test(rh) && /fill="#f42a58"/.test(rh) && /\.x\{color:#f42a58\}/.test(rh), 'recolour html: style attributes, SVG fills and <style> move', rh);
ok(el.recolour(rHtml, rFrom, rTo) === rh, 'recolour: markup is read as html without a kind');

/* ---- review: no quadratic reading of odd stylesheets ---- */
var t0 = Date.now();
el.readLook('<style>' + new Array(200001).join('a') + '}</style>', new Array(200001).join('x') + '}' + new Array(20001).join('rgb('));
el.keyVisualOf(new Array(5001).join('<div class="hero banner">') + '<style>' + new Array(3001).join('.b{background:url(x.jpg)}') + '</style>', 'https://x.in/');
ok(Date.now() - t0 < 1500, 'a 200 KB run without braces, unclosed rgb( and 5000 "hero" blocks read in linear time', (Date.now() - t0) + ' ms');
ok(el.readLook(null, null) && el.keyVisualOf(null) === '' && el.recolour(null, rFrom, rTo) === '', 'nothing given, nothing thrown');
var t1 = Date.now(), unclosed = el.recolour(new Array(40001).join('<style>x') + '<p style="color:#ed1c24">', rFrom, rTo, 'html');
ok(Date.now() - t1 < 300 && /color:#f42a58/.test(unclosed), 'recolour: 40 000 unclosed <style> tags read in linear time', (Date.now() - t1) + ' ms');

/* ---- review: owner words that are not about the look ---- */
ok(!el.ownerSetsLook('The theme of this year is regional growth') && !el.ownerSetsLook('Serve light refreshments') && el.ownerSetsLook('dark mode please') && el.ownerSetsLook('use the brand font Gotham'),
  'ownerSetsLook: "theme of the summit" and "light refreshments" do not switch the edition\'s look off');

/* ---- review: a redesigned section may carry the city; an edit does only what was asked ---- */
var rd = api.buildRedesignPrompt({ mode: 'redesign', sectionId: 's', html: '<section id="s"></section>', css: '', design: { mode: 'light', place: { city: 'Chennai', motif: 'a kolam border' } } });
var ed = api.buildRedesignPrompt({ mode: 'edit', instruction: 'bigger title', sectionId: 's', html: '<section id="s"></section>', css: '', design: { mode: 'light', place: { city: 'Chennai', motif: 'a kolam border' } } });
ok(/THE PLACE: this edition takes place in Chennai/.test(rd) && !/kolam border/.test(rd) && !/THE PLACE/.test(ed), 'redesign carries the city (by name, no ornament), edit does not');

/* ---- review: a card colour never walks off into grey (the stored BWS design gave #bebdb9 on #f5f3ee) ---- */
var stored = { mode: 'light', themeColor: '#ed1c24', accentColor: '#f5a300', backgroundColor: '#ffffff', surfaceColor: '#fff3ea', textColor: '#1a1414', mutedColor: '#574e4e', headingFont: 'Montserrat', bodyFont: 'Work Sans' };
[withLogo, Object.assign({}, withLogo, { surface: '#e4e2d9' })].forEach(function (lk, i) {
  [stored, Object.assign({}, stored, { surfaceColor: lk.surface, backgroundColor: lk.background, textColor: lk.text })].forEach(function (ch, j) {
    var o = Object.assign({}, ch, el.inspiredDesign(lk, ch, 'auto'));
    var d = Math.sqrt([1, 3, 5].reduce(function (s, k) { return s + Math.pow(parseInt(o.surfaceColor.substr(k, 2), 16) - parseInt(o.backgroundColor.substr(k, 2), 16), 2); }, 0));
    ok(gd.luminance(o.surfaceColor) > 0.7 && d <= 30 && d >= 3, 'BWS ' + i + '/' + j + ': the card is a light step from the ground, never grey', o.surfaceColor + ' on ' + o.backgroundColor + ' (' + d.toFixed(1) + ')');
    ok(editionColours.every(function (c) { return apart(o.surfaceColor, c); }), 'BWS ' + i + '/' + j + ': and none of the edition\'s own colours', o.surfaceColor);
  });
});
/* a dark edition's card: a step lighter than its ground, of the same dark */
var dOut = Object.assign({}, omodel, el.inspiredDesign(olook, omodel, 'auto'));
ok(gd.luminance(dOut.surfaceColor) < 0.2 && gd.luminance(dOut.surfaceColor) > gd.luminance(dOut.backgroundColor), 'a dark site\'s card stays dark, a step above its ground', dOut.surfaceColor + ' on ' + dOut.backgroundColor);
/* a near-copy moves only a little: never compounded, at most 40% of the way */
var near = el.inspiredDesign(withLogo, Object.assign({}, model, { themeColor: '#eb405d' }), 'auto');
ok(near.themeColor && gd.luminance(near.themeColor) > 0.1 && Math.abs(gd.luminance(near.themeColor) - gd.luminance(look.brand)) < 0.15, 'a copied brand is moved a little, not off into black', near.themeColor);

/* ---- review: the old banner's city never mixes with this edition's (rule 3) ---- */
var kvChennai = { url: 'https://img.example.com/kv.jpg', description: 'An illustrated coastline with temple towers at dawn.', place: 'Chennai — the Marina and a gopuram' };
var lk2 = api.editionLookLines(withLogo, kvChennai).join('\n');
ok(!/Chennai/.test(lk2) && /not carried over/.test(lk2), 'the plan is not told the old banner\'s city; the place is THE PLACE\'s', lk2);
var heroPune = gd.imagePrompt('a summit hall', { inspiredBy: kvChennai.description, place: { city: 'Pune', cues: 'stone wadas' } }, { hero: true });
ok(/the event is in Pune/.test(heroPune) && /Take no place from it/.test(heroPune), 'hero with a place: inspired by the banner, the place is this edition\'s', heroPune);
ok(!/Take no place/.test(gd.imagePrompt('a summit hall', { inspiredBy: kvChennai.description }, { hero: true })), 'no place given: no place sentence');
ok(/Name no city/.test(api.ingestSchemaFor(true).properties.keyVisual.properties.description.description), 'the banner is described without its city');

/* ---- review: rule 4 — a reference page that is not a previous edition is followed as before ---- */
var refDesign = { layoutStyle: 'cards', sectionPattern: ['hero: split', 'speakers: grid'] };
var comp = api.buildDesignPlanPrompt(Object.assign({}, base, { themeInfo: api.extractThemeFromPreviousEditionSources([]), reference: { basis: { type: 'competitor', url: 'https://x.example/e', design: refDesign }, others: [] } }));
ok(/THE REFERENCE THIS SITE IS MODELLED ON/.test(comp) && /keep its hero construction/.test(comp) && !/INSPIRED BY/.test(comp), 'a competitor reference: the wording as before');
var prevRef = api.buildDesignPlanPrompt(Object.assign({}, base, { themeInfo: ti, reference: { basis: { type: 'previousEdition', url: BWS_URL, design: refDesign }, others: [] } }));
ok(/THE REFERENCE THIS SITE IS INSPIRED BY/.test(prevRef) && /never the same layout copied/.test(prevRef) && !/keep its hero construction/.test(prevRef), 'the previous edition: inspired by, no layout copied');

if (failures.length) {
  console.log('FAIL edition-look: ' + failures.length + ' of ' + checks + ' checks');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('ok edition-look: ' + checks + ' checks');
