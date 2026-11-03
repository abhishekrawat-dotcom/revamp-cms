/* ETB2B AI's first hero picture for an event started from the events dashboard (the owner, 3 Nov 2026: "when you
   create an event from the dashboard bot, it could also make a first hero picture for it").

     POST /api/event/ai-hero   { eventId, subject?, turnId? }
       200 { url, subject, made: true }    the picture was made now
       200 { url, subject, made: false }   this event already has the one ETB2B AI made: nothing is made again
       400 bad-event | bad-subject | too-long
       404 no-event                         not an event that is live (never made, deleted, being discarded)
       409 hero-busy                        a picture for this event is being made right now
       409 hero-generated                   a site generated from a brief, which made its own pictures
       429 ai-hero-daily                    the person's AI pictures for today are used up
       the AI's own failures in gemini.js's shape ({ error, code, retryable }), and 502 hero-not-stored

   WHEN. Only once the event exists: the dashboard's ETB2B AI puts the request in Create Event's prefill
   (lib/dash-bot.js cleanCreate, prefill.hero), Create Event shows it with Change and Remove, and its hand-off
   calls this right after "Creating your event". An abandoned draft never gets here and costs nothing. A
   failure here never stops the event: Create Event goes on to the editor and says the picture could not be made.

   WHAT. One picture, made with the site pipeline's own backend and rules: gen-design.js imagePrompt as the hero's
   key visual (no people, no faces, no readable text, no logos or brand names, in one tone of the event's own
   colours), gemini.js callGeminiImage, and stored as generated site pictures are (events/<id>/generated/,
   public, cached a year, WebP copies by pictures.js). The subject is the person's own words for it, else the
   event's name and place. The event records it (events/<id>.aiHero) and its History says ETB2B AI made it; the
   editor then puts it into the hero as one change that Undo takes back (editor-template-ui.js applyAiHero).

   LIMITS. One picture per event (a second request answers the first picture). One of the person's daily AI
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
  dayPictures: 5,             // AI hero pictures per person per India day
  subjectChars: 200,
  makingMs: 3 * 60 * 1000,    // a claim older than this is a request that died: another may try
  timeoutMs: 60000,           // the image model, as the site pipeline gives it
  deadlineMs: 80000,          // from the moment the request arrived
  variantsBudgetMs: 15000     // WebP copies: past this the answer goes without waiting for them
};

var MSG = {
  badEvent: 'eventId is required.',
  badSubject: 'Say in words what the picture should show.',
  tooLong: 'Keep what the picture should show under 200 characters.',
  noEvent: 'This event was not found. It may have been removed.',
  busy: 'ETB2B AI is already making this event’s hero picture. Try again in a few minutes.',
  generated: 'This site was generated from a brief, which made its own pictures, so ETB2B AI does not make a separate hero picture.',
  daily: 'You have used today’s ETB2B AI pictures. They reset at midnight (India time).',
  notStored: 'The hero picture was made but could not be stored. Try again in a few minutes.',
  failed: 'The hero picture could not be made just now. Please try again.'
};

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
/* "the event's name and place", when the person did not say what the picture should show */
function subjectOf(ev) {
  var name = line(ev.name, 120), venue = line(ev.venue, 120), city = cityOf(ev);
  var place = venue && city && venue.toLowerCase().indexOf(city.toLowerCase()) === -1 ? venue + ', ' + city : (venue || city);
  return [name, place].filter(Boolean).join(', ').slice(0, CAPS.subjectChars);
}
function aboutOf(ev) {
  var portal = etEvents.isPortal(ev.portal) ? etEvents.PORTALS[ev.portal] : '';
  var kind = CATEGORY_WORDS[String(ev.category || '').toLowerCase()] || 'a business event';
  return line(ev.name, 120) + ', ' + kind + (portal ? ' of ' + portal + ', the Economic Times B2B portal for its field' : ' of the Economic Times');
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
   character worked in when one is known; the event's own colours. */
function promptFor(ev, subject) {
  var city = cityOf(ev);
  return genDesign.imagePrompt(subject, designOf(ev), { hero: true, about: aboutOf(ev), place: city ? { city: city } : null });
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
        var d = got[1].exists ? (got[1].data() || {}) : {};
        var used = Math.max(0, Math.floor(Number(d.pictures) || 0));
        if (used >= CAPS.dayPictures) return { stop: 'ai-hero-daily' };
        var said = subject || subjectOf(ev);
        tx.update(eventRef, { aiHero: { status: 'making', at: at, by: by, subject: said } });
        tx.set(dayRef, { pictures: used + 1, updatedAt: at }, { merge: true });
        return { ev: ev, subject: said };
      });
    }).then(function (c) {
      if (c.stop === 'no-event') return H.sendJson(res, 404, { error: MSG.noEvent, code: 'no-event' });
      if (c.stop === 'hero-busy') return H.sendJson(res, 409, { error: MSG.busy, code: 'hero-busy', retryable: true });
      if (c.stop === 'hero-generated') return H.sendJson(res, 409, { error: MSG.generated, code: 'hero-generated' });
      if (c.stop === 'ai-hero-daily') return H.sendJson(res, 429, { error: MSG.daily, code: 'ai-hero-daily' });
      if (c.made) return H.sendJson(res, 200, { url: c.made.url, subject: String(c.made.subject || ''), made: false });
      return make(fb, decoded, eventId, eventRef, c.ev, c.subject, started, by, turnId).then(function (out) {
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

/* -> Promise<{ status, body } | { ai: failure }> */
function make(fb, decoded, eventId, eventRef, ev, subject, started, by, turnId) {
  var record = H.aiUsageRecorder(fb, eventId, 'ai-hero');
  return gemini.callGeminiImage(promptFor(ev, subject), {
    route: 'ai-hero', eventId: eventId, user: by, timeoutMs: CAPS.timeoutMs, deadlineAt: started + CAPS.deadlineMs
  }).then(function (r) {
    if (record && r) { try { record(r.usage); } catch (e) { /* the usage line is never why a picture fails */ } }
    if (!r || r.error || !r.base64) {
      var failure = r && r.error ? r : Object.assign(gemini.failure('ai-bad-output'), { provider: 'gemini' });
      return giveUp(eventRef, ev, by, subject, failure.code).then(function () { return { ai: failure }; });
    }
    var bytes = Buffer.from(r.base64, 'base64');
    var ext = /jpe?g/i.test(r.mimeType) ? 'jpg' : /webp/i.test(r.mimeType) ? 'webp' : 'png';
    /* named after the request's moment, like every other generated picture: what one name holds never changes,
       so it is cached for a year */
    var storagePath = 'events/' + eventId + '/generated/' + started.toString(36) + '-ai-hero.' + ext;
    var file = fb.bucket.file(storagePath);
    return file.save(bytes, { metadata: { contentType: r.mimeType || 'image/png', cacheControl: pictures.CACHE } })
      .then(function () { return file.makePublic(); })
      .then(function () { return pictures.storeVariants(fb, storagePath, bytes, { budgetMs: CAPS.variantsBudgetMs }); })
      .then(function () {
        var url = 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath;
        var rec = { status: 'made', url: url, storagePath: storagePath, subject: subject, at: new Date(clock.now()).toISOString(), by: by, from: 'dashboard' };
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
  });
}

module.exports = { wire: wire, handleHero: handleHero };
module.exports._test = { CAPS: CAPS, MSG: MSG, clock: clock, dayKey: dayKey, subjectOf: subjectOf, aboutOf: aboutOf, cityOf: cityOf, designOf: designOf,
  promptFor: promptFor, templateColour: templateColour, uidKeyOf: uidKeyOf };
