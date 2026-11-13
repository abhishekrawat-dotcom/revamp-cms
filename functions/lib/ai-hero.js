/* ETB2B AI's first hero picture for an event started from the events dashboard (the owner, 3 Nov 2026: "when you
   create an event from the dashboard bot, it could also make a first hero picture for it").

     POST /api/event/ai-hero   { eventId, subject?, turnId? }
       200 { url, subject, made: true }    the picture was made now
       200 { url, subject, made: false }   this event already has the one ETB2B AI made: nothing is made again
       400 bad-event | bad-subject | too-long
       404 no-event                         not an event that is live (never made, deleted, being discarded)
       409 hero-busy                        a picture for this event is being made right now
       409 hero-generated                   a site generated from a brief, which made its own pictures
       409 hero-no-design                   not on a gallery design: a brief whose site is not generated yet, or an
                                            imported design, which keeps its own pictures
       422 hero-held { error, found }       a picture was made but did not pass its check (found: what it had of
                                            'people', 'text', 'logos'), so no hero picture was made; error says so
                                            plainly, and Create Event and the editor show it. The event stands.
       429 ai-hero-daily                    the person's AI pictures for today are used up
       the AI's own failures in gemini.js's shape ({ error, code, retryable }), and 502 hero-not-stored

   WHEN. Only once the event exists: the dashboard's ETB2B AI puts the request in Create Event's prefill
   (lib/dash-bot.js cleanCreate, prefill.hero), Create Event shows it with Change and Remove, and its hand-off
   calls this right after "Creating your event". An abandoned draft never gets here and costs nothing. A
   failure here never stops the event: Create Event goes on to the editor and says the picture could not be made.

   WHAT. One picture, made with the site pipeline's own backend and rules: gen-design.js imagePrompt as the hero's
   key visual (no people, no faces, no readable text, no logos or brand names, in one tone of the event's own
   colours), gemini.js callGeminiImage asked for a wide 16:9 picture as the editor's banner pictures are, and
   stored as generated site pictures are (events/<id>/generated/, public, cached a year, WebP copies by
   pictures.js). The subject is the person's own words for it, else the event's FIELD, which its portal sets
   (portal-fields.js: an ETHRWorld event gets workplaces, an ETAuto one vehicles and roads, and never a screen,
   a chart, a sign or a panel, which a model letters), and its PLACE. The event's name is never in the prompt,
   not even inside the person's own words (ownScene takes it out): an image model letters a name onto the
   picture, and a name steers what is drawn ("QA Dashbot CIO Expo" drew robots, QA 3 Nov 2026). Only an event on
   a gallery design (the template path) gets one. The event records it (events/<id>.aiHero) and its History says
   ETB2B AI made it; the editor then puts it into the hero as one change that Undo takes back
   (editor-template-ui.js applyAiHero), in the browser that created the event or, before a site is saved, in any
   other (aiHeroFromEvent).

   CHECKED. The picture model does not always do as it is told (QA follow-up 3: made-up lettering, "DU HGR", on a
   floating dashboard panel). So the picture goes through the editor's own picture check (lib/chat-picture.js
   checkPicture, refusedFor and againLine; there is no second check here): one look by a low-cost model at
   whether it has people, words or letters (real or made-up), or a logo. The banner shows no people at all
   (chat-picture.js peopleRule for the hero: 'none') and no picture carries words or logos. A picture found with
   any of those is made ONCE more with the check's stronger line, as one more of the person's pictures for the
   day; if that one is found wanting too (or there is no time or picture left for it, or it cannot be made), it
   is not stored and not set as the hero: the event records why (aiHero.status 'held'), its History says so,
   and the answer (422 hero-held) says in plain words that no hero picture was made and why. The event itself is
   untouched, and Create Event goes on to the editor, which says it too. A check that cannot be made (both
   providers down) does not hold a picture back: it is used, and the record says it was not checked
   (checks: [null]).

   LIMITS. One picture per event (a second request answers the first picture; one held after two tries is
   answered again, without a call, until the person asks for something else). One of the person's daily AI
   pictures (dashChats/<uidKey>/days/<India day>.pictures, CAPS.dayPictures a day: main had no per-person
   picture allowance, so this small cap is it), claimed in the same transaction that marks the event as having
   its picture made, before the model is asked. What the model used goes into the event's aiUsage.

   lib/api.js routes the request here and hands over its helpers on every call (wire()), as it does for the
   other route modules: requiring that file from here would be a require cycle. Loading this file reads nothing,
   writes nothing and needs no environment. */
'use strict';
const fs = require('fs');
const path = require('path');
const gemini = require('./gemini');
const genDesign = require('./gen-design');
const pictures = require('./pictures');
const activity = require('./activity');
const etEvents = require('./et-events');
/* the editor's picture check, and its rules for who may be in a banner (one check for every picture ETB2B AI makes) */
const chatPicture = require('./chat-picture');
/* what each portal's events are about (the picture's field when the person gave no words of their own): one table
   that Create Event's line reads too, so what the person is told and what is made agree */
const fields = require('../../portal-fields.js');

var H = null;
var NEEDS = ['withAdminBody', 'sendJson', 'sendFailure', 'sendAiFailure', 'BODY_LIMITS', 'chatUid', 'isEventId', 'aiUsageRecorder'];
/* run without its sign-in check it would make pictures for anyone, so a wiring with parts missing is refused */
function wire(helpers) {
  var missing = NEEDS.filter(function (k) { return !helpers || helpers[k] == null; });
  if (missing.length) throw new Error('lib/ai-hero.js needs ' + missing.join(', ') + ' from lib/api.js');
  H = helpers;
}
function wired(res) {
  if (H) return true;
  res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' }));
  return false;
}

/* every clock reading goes through here, so a test can stop time */
var clock = { now: function () { return Date.now(); } };

var CAPS = {
  dayPictures: 5,             // AI hero pictures per person per India day (a second try is one more)
  subjectChars: 200,
  /* a claim older than this is a request that died: another may try. Longer than a request can live (its deadline,
     then storing the picture and its copies), so a slow second try is never taken for a dead one. */
  makingMs: 5 * 60 * 1000,
  timeoutMs: 60000,           // one call to the image model, as the site pipeline gives it
  /* from the moment the request arrived: the editor's own (chat-picture.js DEADLINE_MS), room for two pictures and
     their checks inside the platform's request limit (lib/http.js PLATFORM_REQUEST_LIMIT_MS, 300 s) */
  deadlineMs: chatPicture.DEADLINE_MS,
  variantsBudgetMs: 15000     // WebP copies: past this the answer goes without waiting for them
};
/* who may be in the banner's picture: nobody (the editor's rule for its banner), for the prompt and the check alike */
var PEOPLE_RULE = chatPicture.peopleRule({ placement: 'hero' });

var MSG = {
  badEvent: 'eventId is required.',
  badSubject: 'Say in words what the picture should show.',
  tooLong: 'Keep what the picture should show under 200 characters.',
  noEvent: 'This event was not found. It may have been removed.',
  busy: 'ETB2B AI is already making this event’s hero picture. Try again in a few minutes.',
  generated: 'This site was generated from a brief, which made its own pictures, so ETB2B AI does not make a separate hero picture.',
  noDesign: 'ETB2B AI makes a hero picture only for an event on a design from the gallery. This event has none, so nothing was made.',
  daily: 'You have used today’s ETB2B AI pictures. They reset at midnight (India time).',
  notStored: 'The hero picture was made but could not be stored. Try again in a few minutes.',
  failed: 'The hero picture could not be made just now. Please try again.'
};

/* Why no hero picture was made, in plain words, for Create Event's hand-off and the editor. flags: what the picture
   last looked at had that a banner may not ('people', 'text', 'logos'); why: 'twice' (a second picture was made and
   had it too), 'limit' (a second would have gone past the person's pictures for today), 'time' (no time was left
   for one) or 'failed' (the second could not be made). */
function heldSentence(flags, why) {
  var found = chatPicture.foundText(flags);
  var people = flags.indexOf('people') !== -1, marks = flags.length > (people ? 1 : 0);
  var rule = people && marks ? 'A hero picture shows no people and carries no words or logos.'
    : people ? 'A hero picture shows no people.' : 'A hero picture carries no words or logos.';
  var lead = why === 'twice' ? 'ETB2B AI made it twice, and the second picture still had ' + found + ' in it'
    : 'the picture ETB2B AI made had ' + found + ' in it, and ' + (why === 'limit' ? 'a second try would have gone past your ETB2B AI pictures for today'
      : why === 'time' ? 'there was no time left for a second try' : 'a second try could not be made');
  return 'No hero picture was made: ' + lead + '. ' + rule;
}

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
/* one line of plain text: control characters and line breaks become spaces */
function line(v, max) {
  return (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* An India day as YYYY-MM-DD: the same day key lib/dash-bot.js counts the person's messages under, so the
   bot's daily allowance and its pictures live on one document per person and day. */
var IST_MS = 330 * 60000;
function pad(n) { return (n < 10 ? '0' : '') + n; }
function dayKey(ms) { var d = new Date(ms + IST_MS); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
/* the person's own document id under dashChats: lib/dash-bot.js uidKeyOf's rule (ai-hero.test.js holds the two
   together) */
function uidKeyOf(decoded) {
  var key = String(H.chatUid(decoded)).replace(/[^A-Za-z0-9_@.-]/g, '_').slice(0, 120);
  if (/^\.+$/.test(key) || /^__.*__$/.test(key)) key = 'u' + key;
  return key || 'anon';
}

/* ---------- what the picture is of ---------- */

var CATEGORY_WORDS = { ip: 'an industry conference', awards: 'an awards night', client: 'a business event' };
/* the event's city: its own, else the last part of "Venue & city" (Create Event has one box for both) */
function cityOf(ev) {
  var city = line(ev.city, 60);
  if (city) return city;
  var parts = line(ev.venue, 200).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1].slice(0, 60) : '';
}
/* the event's portal, when it is on ET's roster ('' otherwise: the field is then the neutral one) */
function portalOf(ev) { return etEvents.isPortal(ev.portal) ? ev.portal : ''; }
/* A place as it goes into the picture's prompt: typed by a person, so it carries no quote marks, brackets or braces
   of its own and cannot read as a part of the prompt. */
function plainPlace(v, max) {
  return line(v, max).replace(/["'`‘’‚‛“”„‟«»<>{}\[\]]+/g, ' ').replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
}
/* "the event's place": its venue, then its city unless the venue names it (portal-fields.js place) */
function placeOf(ev) { return fields.place(ev.venue, cityOf(ev)); }
/* What the picture is of when the person gave no words of their own: the event's FIELD (from its portal,
   portal-fields.js) and its PLACE, never its name. What the event records, the History line, Create Event's line
   and the editor's toast all say it ("technology leadership, Jio World Centre, Mumbai"). */
function subjectOf(ev) { return fields.subject(portalOf(ev), ev.venue, cityOf(ev)); }
/* The scene the model is asked for then: the field's own places and objects (never a person: the hero's rules
   allow none), at the event's place. The key visual's own lines (gen-design.js) add the host city's landmarks. */
function sceneOf(ev) {
  var place = plainPlace(placeOf(ev), 120);
  /* and, in so many words, none of the things a model letters (portal-fields.js KEEP_OUT): the scene names none,
     and the key visual's "symbols of the field" must not bring a chart or a dashboard in either */
  return fields.fieldOf(portalOf(ev)).scene + (place ? ', at ' + place : '') + ' — ' + fields.KEEP_OUT;
}
/* What kind of event it is, for the prompt's "The event:" line: the kind alone. Neither its name nor its portal's
   name (a brand) is ever in the prompt: an image model letters what it is told is a title onto the picture, and a
   name steers what is drawn ("QA Dashbot CIO Expo" drew robots, QA 3 Nov 2026). The field is the scene's. */
function aboutOf(ev) {
  return CATEGORY_WORDS[String(ev.category || '').toLowerCase()] || 'a business event';
}
/* The person's own words for the picture, with the event's name taken out ("a picture of the Dashbot Summit
   stage" -> "a picture of the event stage"), so not even their words put the name into the prompt. A name of
   fewer than four characters ("AI") is a word, not a title, and stays. '' when nothing of their own is left
   (they only named the event): the field and place are used then. */
var NAME_ONLY = /\b(?:the|a|an|of|for|at|in|on|and|with|its|this|event|picture|pictures|photo|image|hero|banner|showing|show|shows)\b/gi;
function ownScene(words, ev) {
  var name = line(ev.name, 120), out = line(words, CAPS.subjectChars);
  if (name.length >= 4) {
    var pattern = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    out = out.replace(new RegExp('(^|[^\\p{L}\\p{N}])(?:the\\s+)?' + pattern + '(?=$|[^\\p{L}\\p{N}])', 'giu'), '$1the event').replace(/\s+/g, ' ').trim();
  }
  return out.replace(NAME_ONLY, '').replace(/[^\p{L}\p{N}]+/gu, '') ? out : '';
}
/* An event the gallery's design is under (templates/<id>/template.json): the template path, where the hero's
   picture slot is the design's {hero.bannerUrl}. A brief whose site is not generated yet has no design, and an
   imported design (imported-<id>) keeps its own pictures: neither gets one, as Create Event's line says. */
function galleryDesign(templateId) {
  var id = String(templateId || '');
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(id) || /^(?:gen|imported)-/.test(id)) return false;
  try { return fs.statSync(path.join(ROOT, 'templates', id, 'template.json')).isFile(); } catch (e) { return false; }
}
/* The colour the site is set in, so the picture is in its tone: the event's own theme colour when it has one,
   else its gallery design's (templates/<id>/template.json, --theme-color). */
var ROOT = path.join(__dirname, '..', '..');
var designColours = {};
function templateColour(templateId) {
  var id = String(templateId || '');
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(id)) return '';
  if (Object.prototype.hasOwnProperty.call(designColours, id)) return designColours[id];
  var colour = '';
  try {
    var t = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', id, 'template.json'), 'utf8'));
    colour = genDesign.colourOf(t && t.body && t.body.style && t.body.style['--theme-color']) || '';
  } catch (e) { colour = ''; }
  designColours[id] = colour;
  return colour;
}
function designOf(ev) {
  var theme = isObj(ev.theme) ? ev.theme : {};
  var colour = genDesign.colourOf(theme.themeColor || theme.color || '') || templateColour(ev.templateId);
  return { mode: theme.mode === 'dark' ? 'dark' : 'light', themeColor: colour || '', accentColor: genDesign.colourOf(theme.accentColor || '') || '' };
}
/* The site pipeline's hero rules (gen-design.js): a key visual, never a photograph of an event that has not
   happened; no people and no faces, no readable text, no logos, no brand names, no flags; the host city's
   character worked in when one is known; the event's own colours. own: the subject is the person's own words for
   the picture, which are the scene with the event's name taken out (ownScene); otherwise, or when nothing of
   theirs is left, the scene is the event's field at its place (sceneOf). Neither the event's name nor its portal's
   name is ever in the prompt. */
function promptFor(ev, subject, own, design) {
  var city = plainPlace(cityOf(ev), 60), words = own ? ownScene(subject, ev) : '';
  /* design: the tone and colours to make it in, when the caller knows them better than the event's theme does
     (share-still.js: the live site's own colours, light or dark as its logo unit stands) */
  var prompt = genDesign.imagePrompt(words || sceneOf(ev), design || designOf(ev), { hero: true, about: aboutOf(ev), place: city ? { city: city } : null });
  /* nobody in any form, said as the editor says it for its banner, after the STRICT rules: the check refuses the
     same (a silhouette, a human icon, a figure however small) */
  return PEOPLE_RULE === 'none' ? prompt + ' ' + chatPicture.NO_FIGURES : prompt;
}

/* ---------- the route ---------- */

function live(ev) { return !!ev && !!ev.createdAt && !ev.deletedAt && !ev.discardingAt; }

function handleHero(req, res) {
  if (!wired(res)) return;
  H.withAdminBody(req, res, H.BODY_LIMITS.tiny || 16 * 1024, function (fb, decoded, body) {
    var started = clock.now();
    var eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
    if (!H.isEventId(eventId)) return H.sendJson(res, 400, { error: MSG.badEvent, code: 'bad-event' });
    if (body.subject != null && typeof body.subject !== 'string') return H.sendJson(res, 400, { error: MSG.badSubject, code: 'bad-subject' });
    var subject = line(body.subject, 1000);
    if (subject.length > CAPS.subjectChars) return H.sendJson(res, 400, { error: MSG.tooLong, code: 'too-long' });
    var turnId = typeof body.turnId === 'string' && /^[A-Za-z0-9]{10,40}$/.test(body.turnId) ? body.turnId : '';
    var at = new Date(started).toISOString(), by = String(decoded.email || decoded.uid || '');
    var eventRef = fb.db.collection('events').doc(eventId);
    var dayRef = fb.db.collection('dashChats').doc(uidKeyOf(decoded)).collection('days').doc(dayKey(started));

    /* one transaction: the event is marked as having its picture made, and one of today's pictures is taken, so
       two requests at once can neither make two pictures nor both take the last one */
    fb.db.runTransaction(function (tx) {
      return Promise.all([tx.get(eventRef), tx.get(dayRef)]).then(function (got) {
        var ev = got[0].exists ? (got[0].data() || {}) : null;
        if (!live(ev)) return { stop: 'no-event' };
        var h = isObj(ev.aiHero) ? ev.aiHero : null;
        if (h && h.status === 'made' && typeof h.url === 'string' && h.url) return { made: h };
        if (h && h.status === 'making' && started - Date.parse(h.at) < CAPS.makingMs) return { stop: 'hero-busy' };
        if (/^gen-/.test(String(ev.templateId || ''))) return { stop: 'hero-generated' };
        /* the template path only, as Create Event asks: checked here too, so no request can make a picture for a
           brief (before its site is generated) or for an imported design */
        if (!galleryDesign(ev.templateId)) return { stop: 'hero-no-design' };
        var said = subject || subjectOf(ev);
        /* two pictures for this were made and refused: the same ask is answered the same way, with no third call;
           what the person changed since (Change on Create Event) is asked afresh */
        if (h && h.status === 'held' && h.heldFor === 'twice' && h.subject === said && typeof h.why === 'string' && h.why) return { held: h };
        var d = got[1].exists ? (got[1].data() || {}) : {};
        var used = Math.max(0, Math.floor(Number(d.pictures) || 0));
        if (used >= CAPS.dayPictures) return { stop: 'ai-hero-daily' };
        tx.update(eventRef, { aiHero: { status: 'making', at: at, by: by, subject: said } });
        tx.set(dayRef, { pictures: used + 1, updatedAt: at }, { merge: true });
        return { ev: ev, subject: said };
      });
    }).then(function (c) {
      if (c.stop === 'no-event') return H.sendJson(res, 404, { error: MSG.noEvent, code: 'no-event' });
      if (c.stop === 'hero-busy') return H.sendJson(res, 409, { error: MSG.busy, code: 'hero-busy', retryable: true });
      if (c.stop === 'hero-generated') return H.sendJson(res, 409, { error: MSG.generated, code: 'hero-generated' });
      if (c.stop === 'hero-no-design') return H.sendJson(res, 409, { error: MSG.noDesign, code: 'hero-no-design' });
      if (c.stop === 'ai-hero-daily') return H.sendJson(res, 429, { error: MSG.daily, code: 'ai-hero-daily' });
      if (c.made) return H.sendJson(res, 200, { url: c.made.url, subject: String(c.made.subject || ''), made: false });
      if (c.held) return H.sendJson(res, 422, heldBody(c.held.why, c.held.found, c.held.subject));
      return make(fb, decoded, eventId, eventRef, dayRef, c.ev, c.subject, !!subject, started, by, turnId).then(function (out) {
        if (out.ai) return H.sendAiFailure(res, out.ai);
        H.sendJson(res, out.status, out.body);
      });
    }).catch(function (err) { H.sendFailure(res, 'ai-hero', err, MSG.failed); });
  });
}

/* the claim given up, with why: a later request may try again (it takes another of the day's pictures) */
function giveUp(eventRef, ev, by, subject, why) {
  return eventRef.update({ aiHero: { status: 'failed', at: new Date(clock.now()).toISOString(), by: by, subject: subject, error: String(why || '').slice(0, 60) } })
    .catch(function (err) { console.error('ai-hero: the failed claim could not be recorded — ' + (err && err.message)); });
}

/* the answer when no hero picture was made because the picture did not pass its check */
function heldBody(why, found, subject) {
  return { error: String(why || ''), code: 'hero-held', found: Array.isArray(found) ? found.slice(0, 3) : [], subject: String(subject || '') };
}
/* a usage recorder that can never be why a picture fails */
function safe(record) {
  return function (usage) {
    if (!record || !usage) return;
    try { record(usage); } catch (e) { console.error('ai-hero: usage not recorded — ' + (e && e.message)); }
  };
}

/* own: the subject is the person's own words (promptFor). -> Promise<{ status, body } | { ai: failure }>
   The picture, its check (lib/chat-picture.js, the editor's own), once more with the check's stronger line when it
   was found wanting, and then either stored as the hero picture or held back with why (see CHECKED above). */
function make(fb, decoded, eventId, eventRef, dayRef, ev, subject, own, started, by, turnId) {
  var record = safe(H.aiUsageRecorder(fb, eventId, 'ai-hero'));
  var recordCheck = safe(H.aiUsageRecorder(fb, eventId, 'ai-hero-check'));
  var deadlineAt = started + CAPS.deadlineMs, prompt = promptFor(ev, subject, own);
  var looks = [];   // what each look found ({ people, text, logos }, or null when it could not look)

  /* one call to the picture model, wide as the editor's banner pictures are -> Promise<{ bytes, type } | { ai }> */
  function picture(text, until) {
    var call;
    try {
      call = Promise.resolve(gemini.callGeminiImage(text, {
        route: 'ai-hero', eventId: eventId, user: by, timeoutMs: CAPS.timeoutMs, deadlineAt: until, aspectRatio: chatPicture.WIDE_ASPECT
      }));
    } catch (err) { call = Promise.reject(err); }
    return call.then(function (r) {
      if (r) record(r.usage);
      if (!r || r.error || !r.base64) return { ai: r && r.error ? r : Object.assign(gemini.failure('ai-bad-output'), { provider: 'gemini' }) };
      var bytes = Buffer.from(String(r.base64), 'base64');
      /* the picture's real type, from its bytes (the model's word for it is not trusted), as the editor reads it */
      var type = chatPicture.sniff(bytes);
      if (!type) {
        console.error('ai-hero: the picture model answered ' + bytes.length + ' bytes that are not a PNG, JPEG or WebP');
        return { ai: Object.assign(gemini.failure('ai-bad-output'), { provider: 'gemini' }) };
      }
      return { bytes: bytes, type: type };
    }, function (err) {
      console.error('ai-hero: the picture call for ' + eventId + ' failed — ' + (err && err.message));
      return { ai: Object.assign(gemini.failure('ai-unavailable'), { provider: 'gemini' }) };
    });
  }
  /* the editor's check -> what of it a banner may not have ([] when nothing, or when it could not look) */
  function look(pic) {
    return chatPicture.checkPicture(pic.bytes, pic.type, PEOPLE_RULE, { eventId: eventId, deadlineAt: deadlineAt, record: recordCheck }).then(function (found) {
      looks.push(found);
      return chatPicture.refusedFor(found, PEOPLE_RULE);
    });
  }
  /* a second picture is one more of the person's pictures today; false when they have none left */
  function reserveAgain() {
    return fb.db.runTransaction(function (tx) {
      return tx.get(dayRef).then(function (snap) {
        var d = snap.exists ? (snap.data() || {}) : {};
        var used = Math.max(0, Math.floor(Number(d.pictures) || 0));
        if (used >= CAPS.dayPictures) return false;
        tx.set(dayRef, { pictures: used + 1, updatedAt: new Date(clock.now()).toISOString() }, { merge: true });
        return true;
      });
    }).catch(function (err) {
      console.error('ai-hero: a second picture for ' + eventId + ' could not be counted — ' + (err && err.message));
      return false;
    });
  }
  function checksOf() { return looks.map(function (f) { return f ? { people: f.people, text: f.text, logos: f.logos } : null; }); }

  return picture(prompt, deadlineAt).then(function (first) {
    if (first.ai) return giveUp(eventRef, ev, by, subject, first.ai.code).then(function () { return { ai: first.ai }; });
    return look(first).then(function (flags) {
      if (!flags.length) return store(first, 1);
      if (deadlineAt - clock.now() < chatPicture.RETRY_NEEDS_MS) return hold(flags, 'time', 1);
      return reserveAgain().then(function (reserved) {
        if (!reserved) return hold(flags, 'limit', 1);
        return picture(prompt + ' ' + chatPicture.againLine(flags), deadlineAt - chatPicture.CHECK_RESERVE_MS).then(function (second) {
          if (second.ai) return hold(flags, 'failed', 2);
          return look(second).then(function (again) { return again.length ? hold(again, 'twice', 2) : store(second, 2); });
        });
      });
    });
  });

  /* No hero picture: what was made is not stored, the event records why (so the same ask is not made a third time,
     and the editor in another browser can say so), and its History says ETB2B AI made none. */
  function hold(flags, why, tries) {
    var said = heldSentence(flags, why);
    var rec = { status: 'held', at: new Date(clock.now()).toISOString(), by: by, subject: subject, found: flags, heldFor: why, why: said,
      tries: tries, checks: checksOf(), from: 'dashboard' };
    if (turnId) rec.turnId = turnId;
    return eventRef.get().then(function (snap) {
      if (!snap.exists || !live(snap.data())) return { status: 404, body: { error: MSG.noEvent, code: 'no-event' } };
      return eventRef.update({ aiHero: rec }).then(function () {
        activity.logActivity(fb, eventId, decoded, 'ai-chat', 'ETB2B AI made no hero picture for the site (“' + subject.slice(0, 120) + '”): the picture had ' +
          chatPicture.foundText(flags) + ' in it' + (why === 'twice' ? ', on a second try too' : ''), { area: 'design' });
        return { status: 422, body: heldBody(said, flags, subject) };
      });
    });
  }

  /* The picture that passed (or could not be looked at) is stored and set as the hero's. */
  function store(pic, tries) {
    var bytes = pic.bytes;
    var ext = pic.type === 'image/jpeg' ? 'jpg' : pic.type === 'image/webp' ? 'webp' : 'png';
    /* named after the request's moment, like every other generated picture: what one name holds never changes,
       so it is cached for a year */
    var storagePath = 'events/' + eventId + '/generated/' + started.toString(36) + '-ai-hero.' + ext;
    var file = fb.bucket.file(storagePath);
    return file.save(bytes, { metadata: { contentType: pic.type, cacheControl: pictures.CACHE } })
      .then(function () { return file.makePublic(); })
      .then(function () { return pictures.storeVariants(fb, storagePath, bytes, { budgetMs: CAPS.variantsBudgetMs }); })
      .then(function () {
        var url = 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath;
        var rec = { status: 'made', url: url, storagePath: storagePath, subject: subject, at: new Date(clock.now()).toISOString(), by: by, from: 'dashboard',
          tries: tries, checks: checksOf() };
        if (turnId) rec.turnId = turnId;
        /* an event removed while the picture was being made is not written back (update() creates nothing),
           and gets no History line */
        return eventRef.get().then(function (snap) {
          if (!snap.exists || !live(snap.data())) return { status: 404, body: { error: MSG.noEvent, code: 'no-event' } };
          return eventRef.update({ aiHero: rec }).then(function () {
            activity.logActivity(fb, eventId, decoded, 'ai-chat', 'ETB2B AI made a hero picture for the site: “' + subject.slice(0, 160) + '”', { area: 'design' });
            return { status: 200, body: { url: url, subject: subject, made: true } };
          });
        });
      }, function (err) {
        console.error('ai-hero: the picture for ' + eventId + ' was made but not stored — ' + (err && err.message));
        return giveUp(eventRef, ev, by, subject, 'not-stored').then(function () { return { status: 502, body: { error: MSG.notStored, code: 'hero-not-stored', retryable: true } }; });
      });
  }
}

module.exports = { wire: wire, handleHero: handleHero,
  /* the same picture rules for the share card's banner picture of a site whose banner is a video (share-still.js) */
  picturePrompt: promptFor, subjectOf: subjectOf, designOf: designOf, PEOPLE_RULE: PEOPLE_RULE };
module.exports._test = { CAPS: CAPS, MSG: MSG, clock: clock, dayKey: dayKey, subjectOf: subjectOf, aboutOf: aboutOf, cityOf: cityOf, designOf: designOf,
  promptFor: promptFor, templateColour: templateColour, uidKeyOf: uidKeyOf, sceneOf: sceneOf, plainPlace: plainPlace, ownScene: ownScene, portalOf: portalOf,
  placeOf: placeOf, galleryDesign: galleryDesign, heldSentence: heldSentence, PEOPLE_RULE: PEOPLE_RULE };
