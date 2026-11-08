/* ETB2B AI in the social post editor and the mailer editor ("Edit with AI", batch B18-ai): the server half of the
   "promo brain". The owner chose it on 2026-11-08 (owner-decisions.md #9, promo-easy-edit/DESIGN.md section 3): the
   same top-bar toggle as the site editor, "Edit with AI | Edit myself"; ETB2B AI changes the post or the mail at
   once and offers Undo (do it, then undo: no Apply step); it never sends, publishes, deletes or downloads.

     POST /api/promo/ai-edit       { eventId, editor: 'post'|'mail', message, place, state }
                                   -> { kind, intent, summary, changes, skipped, turnId, newPicture? }
     POST /api/promo/ai-edit       { eventId, step: 'picture', turnId }
                                   -> the post's new background, made from what the first step stored
     POST /api/promo/ai-edit/turn  { eventId, turnId, status, done, notDone }
                                   -> what became of a change: applied, partly, failed, undone or stopped

   WHERE IT RUNS. The editors are framed inside Promotions (marketing.html). The one assistant of that page
   (etb2b-assistant.js) has a brain for the open editor (promo-ai-client.js), which reads the post's or mail's state
   from the frame (promo-studio/oneworld-ai-mode.js), sends it here with the message, and applies what comes back
   through the editors' own change paths (the social editor's setEls, the mailer's block-change path), with Undo.

   LOCKED TO THE EVENT (owner decision 10, mandatory). The server, not only the prompt:
     - the page must be Promotions of this very event (place.page 'promotions', place.eventId === eventId) and the
       event must be one of this person's own live events (liveEventDocs, the list GET /api/events gives). If it
       cannot be confirmed, nothing is asked of the model and nothing is kept: one fixed refusal (FAIL CLOSED);
     - the model sees this event's facts only (lib/promo.js buildKit and factSheet: its speakers, partners, agenda
       and the three Basics fields), and the post's or mail's own words;
     - every change it returns is checked here against an allow-list (words of a text that is on the post or in the
       mail, people of THIS event's roster by id, a subject, a preview text, a caption, one new background, one post
       per speaker) and against this event's real data: a number that is in neither the event's details nor the
       post's own words nor the person's message is not written (the model must not invent "500+ leaders"), and words
       that name another of the person's events are not written either.
   The browser checks the frame's event against the page's again before it applies anything (promo-ai-client.js).

   THE CONVERSATION. One per person per event, the very document the site editor's and the events side's ETB2B AI
   keep (lib/api.js chatUserRef): events/<id>/aiChats/<uid>/turns/<turnId> with brain 'promo' and { editor, question,
   answer, kind, intent, status, done, notDone, place, at, updatedAt, newPicture? }. The other brains read these as
   one neutral line (lib/api.js chatHistoryText, lib/dash-bot.js memoryText). Each turn has a short `intent` (the
   model's own label of what was asked: "shorten title", "swap speaker", "post per speaker") and its outcome, in the
   same shape as the dash brain's turns, so the request record (batch AI-learn-a) can take it in one line.

   A NEW BACKGROUND is made by ETB2B AI pictures (lib/chat-picture.js: its subject check, the person's day limit, the
   picture model, the check for people, words and logos, and storage under the event): the first step stores the
   ask on the turn, the second makes it. It shows no words and no logo, so the ET logo is never redrawn; the post's
   own logo stays a layer above it, untouched.

   COST. The editors' chat shares the site editor's rate bucket (chatRateOk: 60 messages in 10 minutes per person).
   One model call per message (route 'promo-edit' in lib/llm.js), each recorded on the event (aiUsageRecorder).

   lib/api.js routes the three here and hands over its helpers on every call (wire()), as for the other Promotions
   modules. Loading this file reads nothing and writes nothing. */
'use strict';
var llm = require('./llm');
var promo = require('./promo');
var chatPicture = require('./chat-picture');

var H = null;
var NEEDS = ['withAdminBody', 'sendJson', 'sendAiFailure', 'sendFailure', 'BODY_LIMITS', 'chatRateOk', 'chatUid', 'chatName',
  'chatUserRef', 'liveEventDocs', 'logActivity', 'eventDocRef', 'aiUsageRecorder', 'isEventId', 'ET_LOGO_COLOUR_RULE'];
function wire(helpers) {
  var missing = NEEDS.filter(function (k) { return !helpers || helpers[k] == null; });
  if (missing.length) throw new Error('lib/promo-ai.js needs ' + missing.join(', ') + ' from lib/api.js');
  H = helpers;
}

/* ---------- limits ---------- */
var CAPS = {
  messageChars: 4000, memoryTurns: 10, memoryChars: 600,
  words: 60, wordChars: 300, mailChars: 1500, texts: 80, people: 12, roster: 40,
  subject: 70, preview: 110, outputTokens: 6000, timeoutMs: 60000
};
/* the three networks a caption is for, and how long each may be (the caption tab's NETWORKS) */
var NETWORKS = { linkedin: { label: 'LinkedIn', max: 3000 }, instagram: { label: 'Instagram', max: 2200 }, x: { label: 'X', max: 280 } };
var EDITORS = { post: 'social post', mail: 'mail' };
var KINDS = ['edit', 'reply', 'undo', 'handoff'];
var STATUSES = ['applied', 'partly', 'failed', 'undone', 'stopped'];
/* the post's shapes, as the picture model takes them (gemini.js IMAGE_ASPECTS) */
var ASPECTS = [['1:1', 1], ['4:5', 0.8], ['9:16', 0.5625], ['16:9', 16 / 9]];
var TURN_ID = /^[A-Za-z0-9]{10,40}$/;
var EVENT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/* Every sentence a person reads from this file. The product is ETB2B EventSphere and the assistant ETB2B AI. */
var MSG = {
  empty: 'Type what to change.',
  tooLong: 'Keep the message under 4,000 characters.',
  badEditor: 'Open a social post or a mailer in its editor first.',
  rate: 'That is a lot of messages in a short time. Please wait a few minutes and try again.',
  unconfirmed: 'I can’t confirm this event for you, so I won’t change anything here. Open it again from the events dashboard.',
  badOutput: 'ETB2B AI gave an answer it couldn’t use. Nothing was changed. Try again.',
  failed: 'ETB2B AI couldn’t answer that. Nothing was changed. Try again.',
  notYours: 'This conversation turn is not yours or no longer exists.',
  noPicture: 'There is no new background to make for this message.',
  number: 'left out: it had a number that is not in the event’s details',
  otherEvent: 'left out: it named another event, and I work on this event only here',
  unknownTarget: 'left out: it was for a part that is not on this ',
  unknownPerson: 'left out: that person is not in this event’s Content',
  tooMany: 'left out: more people than that section shows',
  notHere: 'left out: that is not part of this ',
  perSpeakerNot: 'One post per speaker is made from a speaker’s post, and needs at least 2 speakers in Content › Speakers.',
  done: 'Done.'
};

function str(v) { return v == null ? '' : String(v); }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function own(o, k) { return isObj(o) && Object.prototype.hasOwnProperty.call(o, k); }
/* one line, no control characters, at most max */
function line(v, max) { return str(v).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
/* words as the model may write them: no markup, no control characters; line breaks kept (a post's text may have them) */
function plain(v, max) {
  var s = str(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/<[^>]{0,200}>/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '').trim() : s;
}
/* lower-case words, accents folded, for comparing names */
function words(s) { return (str(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []); }
function normalized(s) { return ' ' + words(s).join(' ') + ' '; }
function uniq(list) { var seen = {}; return list.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }); }

/* ---------- the post or the mail, as the browser sent it ----------
   Only shapes this file knows are kept, each value cut to its size; anything else is dropped. Nothing here is
   trusted as a fact about the event: the roster and the facts are read on the server. */
var TARGET_RE = /^[A-Za-z0-9_.:#|-]{1,120}$/;
function cleanState(editor, raw) {
  raw = isObj(raw) ? raw : {};
  var out = { editor: editor, design: line(raw.design, 80), size: line(raw.size, 80), theme: raw.theme === 'light' ? 'light' : 'dark' };
  out.words = arr(raw.words).filter(function (w) { return isObj(w) && TARGET_RE.test(str(w.target)); }).slice(0, editor === 'mail' ? CAPS.texts : CAPS.words)
    .map(function (w) { return { target: str(w.target), name: line(w.name, 80) || 'Text', text: plain(w.text, editor === 'mail' ? CAPS.mailChars : CAPS.wordChars) }; });
  var seen = {};
  out.words = out.words.filter(function (w) { if (seen[w.target]) return false; seen[w.target] = true; return true; });
  if (editor === 'post') {
    /* each person on the post: its slot, whether a speaker or a partner, and who it is now (an id of the roster) */
    out.people = arr(raw.people).filter(function (p) { return isObj(p) && (p.kind === 'speaker' || p.kind === 'partner'); }).slice(0, CAPS.people)
      .map(function (p, i) { return { target: String(i), kind: p.kind, id: line(p.id, 80) }; });
    var cap = isObj(raw.caption) ? raw.caption : null;
    out.caption = cap && own(NETWORKS, cap.network) ? { network: cap.network, text: plain(cap.text, NETWORKS[cap.network].max) } : null;
    out.perSpeaker = raw.perSpeaker === true;
    var w = Math.round(+raw.width || 0), h = Math.round(+raw.height || 0);
    out.width = w > 0 && w <= 8000 ? w : 0;
    out.height = h > 0 && h <= 8000 ? h : 0;
  } else {
    out.subject = line(raw.subject, 300);
    out.preview = line(raw.preview, 400);
    /* each section that lists people: what it lists (speakers, partners, sessions, or the one speaker in focus),
       the most it shows, and who it lists now (by name: the mail keeps names, not ids) */
    out.people = arr(raw.people).filter(function (p) { return isObj(p) && TARGET_RE.test(str(p.target)) && /^(?:speakers|sponsors|sessions|focus)$/.test(str(p.kind)); })
      .slice(0, CAPS.people).map(function (p) {
        var max = Math.round(+p.max || 0);
        return { target: str(p.target), kind: p.kind, name: line(p.name, 80), max: p.kind === 'focus' ? 1 : (max > 0 && max <= 60 ? max : 0),
          now: arr(p.now).slice(0, 60).map(function (n) { return line(n, 120); }).filter(Boolean) };
      });
  }
  return out;
}

/* ---------- this event's own people, from the server's reading of it ----------
   The ids are the ones GET /api/promo/mailer/roster gives the editors (lib/promo-mailer.js entityOf: String(id)). */
function rosterOf(kit) {
  var c = (kit && kit.content) || {};
  var r = { speakers: [], sponsors: [], sessions: [], byKind: { speaker: {}, partner: {}, speakers: {}, sponsors: {}, sessions: {}, focus: {} } };
  arr(c.speakers).forEach(function (s) {
    if (!s || !line(s.name)) return;
    var p = { id: String(s.id), name: line(s.name, 120), designation: line(s.designation, 120), company: line(s.company, 120) };
    r.speakers.push(p);
    r.byKind.speaker[p.id] = r.byKind.speakers[p.id] = r.byKind.focus[p.id] = p;
  });
  arr(c.partners).forEach(function (s) {
    if (!s || !line(s.name)) return;
    var p = { id: String(s.id), name: line(s.name, 120), tier: line(s.tier, 80) };
    r.sponsors.push(p);
    r.byKind.partner[p.id] = r.byKind.sponsors[p.id] = p;
  });
  arr(c.sessions).forEach(function (s) {
    if (!s || !line(s.title)) return;
    var p = { id: String(s.id), name: line(s.title, 160), day: line(s.day, 60), start: line(s.start, 20) };
    r.sessions.push(p);
    r.byKind.sessions[p.id] = p;
  });
  return r;
}

/* ---------- grounding: numbers and other events ---------- */
/* the digit runs of a text ("12–13 March 2026" -> 12, 13, 2026; "1,500" -> 1500) */
function numbersIn(s) { return (str(s).replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+/g) || []).map(function (n) { return n.replace(/^0+(?=\d)/, ''); }); }
/* a text whose every number is in the sources (the event's details, the post's own words, the person's messages) */
function grounded(text, sources) {
  var have = {};
  numbersIn(sources).forEach(function (n) { have[n] = true; });
  return numbersIn(text).every(function (n) { return have[n] === true; });
}
/* The names of the person's OTHER live events, normalised, for catching an answer that names one. Two words and eight
   letters at least, and not inside this event's own name, as lib/dash-bot.js keeps them (so "Autotech Summit" is not
   another event inside "Autotech Summit 2026", and an ordinary word is never one). */
function otherNamesOf(docs, eventId) {
  var here = arr(docs).filter(function (d) { return d && d.id === eventId; })[0];
  var ownName = normalized(here && here.data && here.data.name);
  var out = [];
  arr(docs).forEach(function (d) {
    if (!d || d.id === eventId || !isObj(d.data)) return;
    var n = normalized(d.data.name);
    if (words(d.data.name).length >= 2 && n.trim().length >= 8 && ownName.indexOf(n) === -1 && out.indexOf(n) === -1) out.push(n);
  });
  return out;
}
function namesOther(text, otherNames) { var w = normalized(text); return arr(otherNames).some(function (n) { return w.indexOf(n) !== -1; }); }

/* the picture model's shape nearest to the post's */
function aspectOf(w, h) {
  if (!(w > 0 && h > 0)) return '1:1';
  var r = w / h, best = ASPECTS[0];
  ASPECTS.forEach(function (a) { if (Math.abs(Math.log(r / a[1])) < Math.abs(Math.log(r / best[1]))) best = a; });
  return best[0];
}

/* ---------- the conversation the model remembers ---------- */
var OUTCOMES = { answered: '', applying: 'its result is not known', applied: 'applied', partly: 'partly applied', failed: 'nothing could be applied',
  undone: 'applied, then UNDONE by the person: the ' + 'post or mail is as it was before it', stopped: 'the person pressed Stop' };
/* this brain's own turns in full; the other brains' (the site editor's, the events side's) in one neutral line with
   the person's own words only, so another page's answer never reaches this prompt */
function memoryText(turns) {
  return arr(turns).slice(-CAPS.memoryTurns).map(function (t) {
    if (!isObj(t)) return '';
    if (t.brain !== 'promo') return '[Elsewhere in this event they asked ETB2B AI: “' + line(t.question, 300) + '”]';
    var lines = ['User: ' + line(t.question, CAPS.memoryChars), 'You: ' + line(t.answer, CAPS.memoryChars)];
    var what = OUTCOMES[t.status] || '';
    var done = arr(t.done).map(function (d) { return line(d, 120); }).filter(Boolean).join('; ');
    if (what) lines.push('[What happened: ' + what + (done && t.status !== 'undone' ? ' — ' + done : '') + ']');
    return lines.join('\n');
  }).filter(Boolean).join('\n\n');
}

/* ---------- the prompt ---------- */
function rosterLines(r) {
  var out = [];
  if (r.speakers.length) out.push('THIS EVENT\'S SPEAKERS (id -> name, title): ' + r.speakers.slice(0, CAPS.roster).map(function (s) {
    return s.id + ' -> ' + s.name + [s.designation, s.company].filter(Boolean).map(function (x) { return ', ' + x; }).join('');
  }).join('; '));
  else out.push('THIS EVENT HAS NO SPEAKERS in Content › Speakers yet.');
  if (r.sponsors.length) out.push('THIS EVENT\'S PARTNERS (id -> name, tier): ' + r.sponsors.slice(0, CAPS.roster).map(function (s) { return s.id + ' -> ' + s.name + (s.tier ? ' (' + s.tier + ')' : ''); }).join('; '));
  else out.push('THIS EVENT HAS NO PARTNERS in Content › Sponsors yet.');
  if (r.sessions.length) out.push('THIS EVENT\'S SESSIONS (id -> title): ' + r.sessions.slice(0, CAPS.roster).map(function (s) { return s.id + ' -> ' + s.name + (s.day ? ' [' + s.day + ']' : ''); }).join('; '));
  return out.join('\n');
}
function stateLines(st, r) {
  var out = [];
  var noun = EDITORS[st.editor];
  if (st.editor === 'post') {
    out.push('THE POST NOW: design "' + (st.design || 'a social post') + '"' + (st.size ? ', size ' + st.size : '') + ', ' + st.theme + ' theme.');
    out.push('Its words (target -> name: what it says now):');
    st.words.forEach(function (w) { out.push('  [' + w.target + '] ' + w.name + ': "' + w.text.replace(/\n/g, ' / ') + '"'); });
    if (!st.words.length) out.push('  (none)');
    if (st.people.length) {
      out.push('The people on it (target -> who is in that place now):');
      st.people.forEach(function (p) {
        var who = r.byKind[p.kind][p.id];
        out.push('  [' + p.target + '] ' + (p.kind === 'speaker' ? 'Speaker' : 'Partner') + ': ' + (who ? who.name + ' (id ' + who.id + ')' : 'not one of this event\'s ' + (p.kind === 'speaker' ? 'speakers' : 'partners')));
      });
    } else out.push('No speaker or partner of this event is on this post.');
    out.push(st.caption ? 'Its caption, for ' + NETWORKS[st.caption.network].label + ' (at most ' + NETWORKS[st.caption.network].max + ' characters): "' + st.caption.text.replace(/\n/g, ' / ') + '"' : 'Its caption is not ready yet: leave `caption` "".');
    out.push(st.perSpeaker ? 'One post per speaker: AVAILABLE for this design (' + r.speakers.length + ' speakers).' : 'One post per speaker: NOT available here (' + MSG.perSpeakerNot + ')');
  } else {
    out.push('THE MAIL NOW: mailer "' + (st.design || 'a mail') + '".');
    out.push('Subject: "' + st.subject + '"');
    out.push('Preview text (the line inboxes show after the subject): "' + st.preview + '"');
    out.push('Its words (target -> section · field: what it says now; **bold** and ==highlight== are formatting marks you may keep):');
    st.words.forEach(function (w) { out.push('  [' + w.target + '] ' + w.name + ': "' + w.text.replace(/\n/g, ' / ') + '"'); });
    if (!st.words.length) out.push('  (none)');
    if (st.people.length) {
      out.push('Its sections that list people (target -> what it lists: who now):');
      st.people.forEach(function (p) {
        var what = p.kind === 'focus' ? 'one speaker, large' : p.kind === 'sponsors' ? 'partners' : p.kind;
        out.push('  [' + p.target + '] ' + (p.name || what) + ' (' + what + (p.max ? ', at most ' + p.max : '') + '): ' + (p.now.length ? p.now.join('; ') : 'nobody yet'));
      });
    }
  }
  return out.join('\n').replace(/the post or mail/g, 'the ' + noun);
}
function buildPrompt(ctx) {
  var st = ctx.state, post = st.editor === 'post', noun = EDITORS[st.editor], ev = (ctx.kit && ctx.kit.event) || {};
  var history = memoryText(ctx.turns);
  return [
    'You are ETB2B AI inside ETB2B EventSphere\'s ' + (post ? 'social post editor' : 'mailer editor') + ', helping an event manager change ONE ' + noun + ' of the event "' + line(ev.name, 200) + '". What you return is APPLIED TO THE ' + noun.toUpperCase() + ' AT ONCE (the person can undo it with one click), so do what is asked — no more. This is a chat: read the conversation, understand what the latest message means in it, and answer naturally.',
    'You work on this event only. You never see, name or change another event, its people or its posts.',
    history ? 'Conversation so far (oldest first):\n' + history : '',
    'The person\'s latest message:\n"' + line(ctx.message, CAPS.messageChars) + '"',
    'FACT SHEET (this event\'s real details — the only facts you may use):\n' + ctx.facts,
    rosterLines(ctx.roster),
    stateLines(st, ctx.roster),
    'YOUR ANSWER (every field is required; use "" or [] or false for "no change"):',
    '- kind: "edit" when the message asks for a change to this ' + noun + '; "undo" when it asks to take back your last change ("undo that", "put it back") — it is put back exactly as it was, at no cost, so never re-create the old words yourself; "reply" for a question, thanks, or a request too vague to do well (then ask ONE short question offering two or three concrete choices); "handoff" when the message is not about this ' + noun + ' at all — another page, registrations or other numbers, other events, a new event, portals, the website itself — and then leave everything else empty.',
    '- intent: two to five plain words naming what was asked, for the team\'s list of common requests: e.g. "shorten title", "rewrite words", "swap speaker", ' + (post ? '"write caption", "new background", "post per speaker"' : '"write subject", "write preview text", "choose speakers"') + ', "question". Never a name or a number.',
    '- words: [{target, text}] — new words for a text listed above, by its target, the whole new text of it. Keep each about as long as it is now unless asked otherwise' + (post ? ' (the post\'s boxes are small: a title of more than a few words will not fit)' : '') + '. Only targets listed above.',
    post
      ? '- people: [{target, ids}] — put another of this event\'s speakers or partners in a place on the post: target is the place (e.g. "0"), ids is ONE id from this event\'s list of the same kind (a speaker for a speaker\'s place). Their name, title and picture change in place.'
      : '- people: [{target, ids}] — who a people section lists: target is the section, ids the ids of this event\'s people of that kind in the order to show them, at most its limit; for "one speaker, large", ONE speaker id.',
    post ? '- subject, preview: always "" (a post has none).' : '- subject: a new subject line (at most ' + CAPS.subject + ' characters, specific to this event, no ALL CAPS, no emojis) or "". preview: a new preview text (at most ' + CAPS.preview + ' characters, adding what the subject does not say) or "".',
    post ? '- caption: the WHOLE new caption for the network above (keep the event\'s hashtag ' + (line(ev.hashtag, 60) || '(none)') + ' and any link exactly as written), or "".' : '- caption: always "" (a mail has none).',
    post ? '- background: {make, scene, style} — make true only when the person asks for a new background picture for this post: scene says in plain words what it shows (a place, a subject or a mood — never a person\'s name, words or a logo), style "photo" or "graphic". Otherwise {make: false, scene: "", style: "photo"}.' : '- background: always {make: false, scene: "", style: "photo"} (a new picture for a mail is not made here: the person clicks a picture in the mail to swap it).',
    post ? '- perSpeaker: true only when the person asks for one post per speaker and it is AVAILABLE above; it draws one post for each speaker, laid out as this one, ready for the person to download.' : '- perSpeaker: always false.',
    '- summary: LAST, in plain friendly words, what you changed ("I shortened the title and put Asha Rao in the speaker\'s place.") or your answer — at most about 80 words, no hex codes or technical terms, and no claim of anything that is not in your fields.',
    'RULES. Use ONLY the facts in the fact sheet, the lists above and the ' + noun + '\'s own words. Invent nothing: no names, numbers, dates, prices, quotes, awards, rankings or claims that are not written there (no "500+ leaders" unless that exact number is given). Write in British English. ' +
      'You never send, schedule, publish, delete or download anything, and never say you did: say that the person does that from the editor\'s Download (sending mail or posting is not part of ETB2B EventSphere yet). ' +
      'To add or change the event\'s speakers, partners, agenda or Basics (who should attend, key topics, headline numbers), the person goes to Content in the event\'s console: say so, and change nothing for it here.',
    ctx.logoRule
  ].filter(Boolean).join('\n\n');
}

/* the answer's shape. Claude's strict mode: every field required (none optional), "" / [] / false for none */
function schemaFor(ctx) {
  var st = ctx.state, targets = st.words.map(function (w) { return w.target; }), places = st.people.map(function (p) { return p.target; });
  var wordItem = { type: 'OBJECT', properties: { target: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['target', 'text'] };
  var peopleItem = { type: 'OBJECT', properties: { target: { type: 'STRING' }, ids: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['target', 'ids'] };
  if (targets.length) wordItem.properties.target.enum = targets;
  if (places.length) peopleItem.properties.target.enum = places;
  return {
    type: 'OBJECT',
    properties: {
      kind: { type: 'STRING', enum: KINDS.slice() },
      intent: { type: 'STRING' },
      words: { type: 'ARRAY', items: wordItem },
      people: { type: 'ARRAY', items: peopleItem },
      subject: { type: 'STRING' }, preview: { type: 'STRING' }, caption: { type: 'STRING' },
      background: { type: 'OBJECT', properties: { make: { type: 'BOOLEAN' }, scene: { type: 'STRING' }, style: { type: 'STRING', enum: ['photo', 'graphic'] } }, required: ['make', 'scene', 'style'] },
      perSpeaker: { type: 'BOOLEAN' },
      summary: { type: 'STRING' }
    },
    required: ['kind', 'intent', 'words', 'people', 'subject', 'preview', 'caption', 'background', 'perSpeaker', 'summary']
  };
}

/* ---------- what the model returned, checked ---------- */
/* intent: a short plain label, never a name or a number (the record groups requests by it) */
function cleanIntent(v) {
  var s = line(v, 60).toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  var w = s.split(' ').filter(Boolean).slice(0, 5);
  return w.join(' ') || 'other';
}
/* -> { kind, intent, summary, changes: { words, people, subject, preview, caption, background, perSpeaker }, skipped }
   ctx: { state, roster, sources, otherNames, kit } */
function cleanAnswer(parsed, ctx) {
  parsed = isObj(parsed) ? parsed : {};
  var st = ctx.state, post = st.editor === 'post', noun = EDITORS[st.editor];
  var kind = KINDS.indexOf(parsed.kind) !== -1 ? parsed.kind : 'reply';
  var skipped = [];
  var changes = { words: [], people: [], subject: '', preview: '', caption: '', background: null, perSpeaker: false };
  var summary = line(parsed.summary, 1200);
  var intent = cleanIntent(parsed.intent);
  if (kind === 'handoff') return { kind: 'handoff', intent: intent, summary: '', changes: changes, skipped: [] };
  /* a check every new text passes: its numbers are the event's or the post's own, and it names no other event */
  function ok(text, what) {
    if (!grounded(text, ctx.sources)) { skipped.push(what + ' — ' + MSG.number); return false; }
    if (namesOther(text, ctx.otherNames)) { skipped.push(what + ' — ' + MSG.otherEvent); return false; }
    return true;
  }
  if (kind === 'edit') {
    var byTarget = {};
    st.words.forEach(function (w) { byTarget[w.target] = w; });
    var used = {};
    arr(parsed.words).forEach(function (w) {
      if (!isObj(w)) return;
      var t = str(w.target), have = byTarget[t];
      if (!have) { skipped.push('A text change ' + MSG.unknownTarget + noun); return; }
      if (used[t]) return;
      var text = plain(w.text, post ? CAPS.wordChars : CAPS.mailChars);
      if (!text || text === have.text) return;
      if (!ok(text, '“' + have.name + '”')) return;
      used[t] = true;
      changes.words.push({ target: t, text: text });
    });
    var places = {};
    st.people.forEach(function (p) { places[p.target] = p; });
    var placed = {};
    arr(parsed.people).forEach(function (p) {
      if (!isObj(p)) return;
      var at = places[str(p.target)];
      if (!at || placed[at.target]) { if (!at) skipped.push('A change of people ' + MSG.unknownTarget + noun); return; }
      var kindKey = at.kind, list = ctx.roster.byKind[kindKey] || {};
      var ids = uniq(arr(p.ids).map(function (x) { return line(x, 80); }).filter(Boolean));
      var known = ids.filter(function (id) { return own(list, id); });
      if (known.length < ids.length) skipped.push('Someone ' + MSG.unknownPerson);
      if (!known.length) return;
      if (post || kindKey === 'focus') known = known.slice(0, 1);
      else if (at.max && known.length > at.max) { skipped.push('“' + (at.name || at.kind) + '” — ' + MSG.tooMany); known = known.slice(0, at.max); }
      if (post && known[0] === at.id) return;
      placed[at.target] = true;
      changes.people.push({ target: at.target, ids: known });
    });
    if (post) {
      if (line(parsed.subject) || line(parsed.preview)) skipped.push('A subject or preview text — ' + MSG.notHere + noun);
      var cap = plain(parsed.caption, st.caption ? NETWORKS[st.caption.network].max : 0);
      if (cap && st.caption && cap !== st.caption.text && ok(cap, 'The caption')) changes.caption = cap;
      var bg = isObj(parsed.background) ? parsed.background : {};
      if (bg.make === true) {
        var cleaned = chatPicture.cleanSubject(bg.scene, { sections: [], event: ctx.eventData || {}, designPlan: (ctx.eventData && ctx.eventData.designPlan) || null });
        if (cleaned.ok) changes.background = { scene: cleaned.subject, style: bg.style === 'graphic' ? 'graphic' : 'photo' };
        else skipped.push(postWords(cleaned.reply));
      }
      if (parsed.perSpeaker === true) {
        if (st.perSpeaker && ctx.roster.speakers.length > 1) changes.perSpeaker = true;
        else skipped.push(MSG.perSpeakerNot);
      }
    } else {
      if (line(parsed.caption)) skipped.push('A caption — ' + MSG.notHere + noun);
      var subject = line(parsed.subject, 300);
      if (subject.length > CAPS.subject) subject = subject.slice(0, CAPS.subject + 1).replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '');
      if (subject && subject !== st.subject && ok(subject, 'The subject line')) changes.subject = subject;
      var preview = line(parsed.preview, 400);
      if (preview.length > CAPS.preview) preview = preview.slice(0, CAPS.preview + 1).replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '');
      if (preview && preview !== st.preview && ok(preview, 'The preview text')) changes.preview = preview;
      var bgm = isObj(parsed.background) ? parsed.background : {};
      if (bgm.make === true) skipped.push('A new picture is not made for a mail here: click a picture in the mail (in Edit myself) to swap it.');
    }
  }
  var changed = hasChanges(changes);
  if (kind === 'edit' && !changed) kind = 'reply';
  if (kind !== 'edit') changes = { words: [], people: [], subject: '', preview: '', caption: '', background: null, perSpeaker: false };
  /* the summary never claims a change that was taken out: with nothing left to do, the skipped reasons are the answer */
  if (!summary) summary = kind === 'edit' ? MSG.done : skipped.length ? 'Nothing was changed: ' + skipped.join('; ') + '.' : '';
  else if (parsed.kind === 'edit' && kind === 'reply' && skipped.length) summary = 'Nothing was changed: ' + skipped.join('; ') + '.';
  return { kind: kind, intent: intent, summary: summary, changes: changes, skipped: kind === 'edit' ? skipped : [] };
}
function hasChanges(c) { return !!(c.words.length || c.people.length || c.subject || c.preview || c.caption || c.background || c.perSpeaker); }
/* a sentence of the picture side said for a post: its "site" is this post's, and the product has its own name */
function postWords(s) {
  return str(s).replace(/on your site/g, 'on your post').replace(/the site sets every word itself/g, 'the post sets its words itself')
    .replace(/Tell the Revamp team\./g, 'Tell the ETB2B EventSphere support team.');
}
/* what the turn says was asked for, in plain words (the History and the memory) */
function doneList(c, st) {
  var out = [];
  var names = {};
  st.words.forEach(function (w) { names[w.target] = w.name; });
  c.words.forEach(function (w) { out.push('changed “' + (names[w.target] || 'a text') + '”'); });
  if (c.people.length) out.push('changed who is on the ' + EDITORS[st.editor]);
  if (c.subject) out.push('wrote the subject line');
  if (c.preview) out.push('wrote the preview text');
  if (c.caption) out.push('wrote the caption');
  if (c.background) out.push('a new background');
  if (c.perSpeaker) out.push('one post per speaker');
  return out;
}

/* ---------- where the person is: Promotions of this event, one of their own live events ---------- */
function placeOk(place, eventId) {
  return isObj(place) && place.page === 'promotions' && str(place.eventId) === eventId;
}

/* ---------- POST /api/promo/ai-edit ---------- */
function turnsOf(ref) {
  return ref.collection('turns').orderBy('at', 'desc').limit(CAPS.memoryTurns + 2).get()
    .then(function (snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).reverse(); })
    .catch(function (err) { console.error('promo-ai: the conversation could not be read — ' + (err && err.message)); return []; });
}
function handleEdit(req, res) {
  if (!H) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'This part of the service is not available right now.', code: 'module-unavailable' })); return; }
  H.withAdminBody(req, res, H.BODY_LIMITS.ai || H.BODY_LIMITS.small, function (fb, decoded, body) {
    body = isObj(body) ? body : {};
    var eventId = str(body.eventId).trim();
    if (!EVENT_ID.test(eventId) || !H.isEventId(eventId)) return H.sendJson(res, 400, { error: 'eventId is required.', code: 'bad-request' });
    if (body.step === 'picture') return pictureStep(fb, decoded, body, eventId, res);
    var message = str(body.message).trim();
    if (!message) return H.sendJson(res, 400, { error: MSG.empty });
    if (message.length > CAPS.messageChars) return H.sendJson(res, 400, { error: MSG.tooLong, code: 'too-long' });
    var editor = own(EDITORS, body.editor) ? body.editor : '';
    if (!editor) return H.sendJson(res, 400, { error: MSG.badEditor, code: 'bad-request' });
    var uid = H.chatUid(decoded);
    if (!H.chatRateOk(uid)) return H.sendJson(res, 429, { error: MSG.rate, code: 'chat-rate', retryable: true });
    var state = cleanState(editor, body.state);
    var userRef = H.chatUserRef(fb, eventId, uid);

    H.liveEventDocs(fb, decoded, 'live').then(function (docs) {
      var mine = arr(docs).filter(function (d) { return d && d.id === eventId; })[0];
      /* FAIL CLOSED (owner decision 10): not Promotions of this event, or not one of this person's live events */
      if (!placeOk(body.place, eventId) || !mine) {
        return H.sendJson(res, 200, { kind: 'refuse', intent: '', summary: MSG.unconfirmed, changes: null, skipped: [], scope: 'none' });
      }
      return Promise.all([
        promo.buildKit(fb, eventId, req, { brand: false }),
        turnsOf(userRef),
        state.editor === 'post' ? chatPicture.readLeft(fb.db, uid, Date.now()) : Promise.resolve(null)
      ]).then(function (got) {
        var kit = got[0], turns = got[1];
        var roster = rosterOf(kit);
        var facts = promo.factSheet(kit);
        var spoken = turns.filter(function (t) { return t && t.brain === 'promo'; }).slice(-2).map(function (t) { return str(t.question); }).concat([message]).join('\n');
        var ctx = {
          state: state, kit: kit, roster: roster, facts: facts, turns: turns, message: message, logoRule: H.ET_LOGO_COLOUR_RULE,
          otherNames: otherNamesOf(docs, eventId), eventData: mine.data || {},
          /* what a number may come from: the event's details, its people, the post's own words, the person's words */
          sources: [facts, rosterLines(roster), state.words.map(function (w) { return w.text; }).join('\n'), state.caption ? state.caption.text : '',
            state.subject || '', state.preview || '', spoken].join('\n')
        };
        return llm.callJson(buildPrompt(ctx), schemaFor(ctx), {
          route: 'promo-edit', eventId: eventId, maxOutputTokens: CAPS.outputTokens, timeoutMs: CAPS.timeoutMs,
          onUsage: H.aiUsageRecorder(fb, eventId, 'promo-edit')
        }).then(function (r) {
          if (!r || r.error) return H.sendAiFailure(res, Object.assign({ error: MSG.failed, code: 'ai-unavailable', retryable: true, status: 502 }, r || {}));
          if (!isObj(r.parsed) || (KINDS.indexOf(r.parsed.kind) === -1 && !line(r.parsed.summary))) return H.sendJson(res, 502, { error: MSG.badOutput, code: 'ai-bad-output', retryable: true });
          var answer = cleanAnswer(r.parsed, ctx);
          /* not about this post or mail: the browser hands it to the events side, whose turn is the one kept */
          if (answer.kind === 'handoff') return H.sendJson(res, 200, { kind: 'handoff', intent: answer.intent, summary: '', changes: null, skipped: [] });
          var picLeft = got[2];
          if (answer.changes.background && picLeft && picLeft.left <= 0) {
            answer.changes.background = null;
            answer.skipped.push(postWords(chatPicture.sentence(picLeft.failedOut ? 'failLimit' : 'limit', { perDay: picLeft.perDay })));
            if (!hasChanges(answer.changes)) { answer.kind = 'reply'; answer.summary = answer.skipped.join(' '); answer.skipped = []; }
          }
          return keep(fb, decoded, userRef, eventId, body.place, state, message, answer, res);
        });
      });
    }).catch(function (err) {
      H.sendFailure(res, 'promo ai-edit', err, MSG.failed);
    });
  });
}
/* the turn, kept under the person who asked; a change is "applying" until the browser says how it went */
function keep(fb, decoded, userRef, eventId, place, state, message, answer, res) {
  var now = new Date().toISOString(), turnRef = userRef.collection('turns').doc();
  var turn = {
    brain: 'promo', editor: state.editor, question: message.slice(0, 4000), answer: answer.summary, kind: answer.kind, intent: answer.intent,
    status: answer.kind === 'edit' ? 'applying' : 'answered', done: [], notDone: [],
    place: { page: 'promotions', eventId: eventId, tab: line(isObj(place) ? place.tab : '', 40) }, at: now, updatedAt: now
  };
  var out = { kind: answer.kind, intent: answer.intent, summary: answer.summary, changes: answer.kind === 'edit' ? answer.changes : null, skipped: answer.skipped };
  if (answer.kind === 'edit') turn.asked = doneList(answer.changes, state);
  var bg = answer.kind === 'edit' ? answer.changes.background : null;
  if (bg) {
    /* what the second step makes the picture from: nothing the browser sends then */
    var msg = normalized(message);
    turn.newPicture = {
      n: 1, sectionId: 'post-background', sectionName: 'Social post background', contextName: 'this', placement: 'background', slot: 0, apply: 'background',
      kind: bg.style === 'graphic' ? 'graphic' : 'subject', alt: 'Background of the post', subject: bg.scene,
      /* the person named the scene ("a calm hall at dusk"): it leads the picture; a bare "new background" is decoration */
      ownerSubject: words(bg.scene).some(function (w) { return w.length > 3 && msg.indexOf(' ' + w + ' ') !== -1; }),
      wide: aspectOf(state.width, state.height) === '16:9', aspect: aspectOf(state.width, state.height), area: 'promotions',
      heroMode: '', design: { themeColor: '', mode: state.theme }, state: 'asked'
    };
  }
  return Promise.all([
    userRef.set({ uid: H.chatUid(decoded), email: str(decoded && decoded.email), name: H.chatName(decoded), lastAt: now }, { merge: true }),
    turnRef.set(turn)
  ]).then(function () {
    out.turnId = turnRef.id;
    if (bg) out.newPicture = { pending: true, aspect: turn.newPicture.aspect };
    H.sendJson(res, 200, out);
    if (answer.kind !== 'edit') H.logActivity(fb, eventId, decoded, 'ai-chat', 'Asked ETB2B AI in the ' + (state.editor === 'post' ? 'social post' : 'mailer') + ' editor: “' + line(message, 120) + '”' + (answer.kind === 'undo' ? ' — undo' : ' — answered'), { area: 'promotions' });
  }, function (err) {
    /* the answer is not withheld because it could not be kept; a new background needs its turn, so it is not offered */
    console.error('promo-ai: the turn of ' + eventId + ' was not kept — ' + (err && err.message));
    out.notKept = true;
    if (bg) {
      out.changes.background = null;
      if (!hasChanges(out.changes)) { out.kind = 'reply'; out.summary = postWords(chatPicture.sentence('started')); out.changes = null; }
      else out.skipped.push(postWords(chatPicture.sentence('started')));
    }
    H.sendJson(res, 200, out);
  });
}

/* the second step: the ONE background this person's stored turn asked for (chatPicture.make: the day's limit, the
   picture model, its check, storage under the event). Nothing but the turn's id comes from the browser. */
function pictureStep(fb, decoded, body, eventId, res) {
  var turnId = str(body.turnId).trim();
  if (!TURN_ID.test(turnId)) return H.sendJson(res, 400, { error: 'eventId and turnId are required.', code: 'bad-request' });
  var uid = H.chatUid(decoded);
  if (!H.chatRateOk(uid)) return H.sendJson(res, 429, { error: MSG.rate, code: 'chat-rate', retryable: true });
  var turnRef = H.chatUserRef(fb, eventId, uid).collection('turns').doc(turnId);
  Promise.all([H.liveEventDocs(fb, decoded, 'live'), turnRef.get()]).then(function (got) {
    var mine = arr(got[0]).filter(function (d) { return d && d.id === eventId; })[0];
    var t = got[1] && got[1].exists ? got[1].data() || {} : null;
    if (!mine) return { status: 200, body: { error: MSG.unconfirmed, code: 'scope-unconfirmed', retryable: false } };
    if (!t || t.brain !== 'promo' || !isObj(t.newPicture)) return { status: 404, body: { error: MSG.noPicture, code: 'chat-picture-none' } };
    return chatPicture.make({
      record: H.aiUsageRecorder(fb, eventId, 'chat-picture') || function () {},
      recordCheck: H.aiUsageRecorder(fb, eventId, 'chat-picture-check') || function () {},
      logActivity: H.logActivity
    }, { fb: fb, eventId: eventId, uid: uid, turnRef: turnRef, eventData: mine.data || {}, decoded: decoded, now: Date.now() });
  }).then(function (out) {
    if (!out || !out.status || !out.body) throw new Error('the picture step gave no answer');
    var b = Object.assign({}, out.body);
    if (b.error) b.error = postWords(b.error);
    if (b.heldWhy) b.heldWhy = postWords(b.heldWhy);
    H.sendJson(res, out.status, b);
  }).catch(function (err) {
    console.error('promo-ai: the background of ' + eventId + ' failed — ' + (err && (err.stack || err.message)));
    H.sendJson(res, 500, { error: 'The background could not be made. Nothing on your post changed — ask again.', code: 'chat-picture-failed', retryable: true });
  });
}

/* ---------- POST /api/promo/ai-edit/turn ---------- */
function handleTurn(req, res) {
  if (!H) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'This part of the service is not available right now.', code: 'module-unavailable' })); return; }
  H.withAdminBody(req, res, H.BODY_LIMITS.small, function (fb, decoded, body) {
    body = isObj(body) ? body : {};
    var eventId = str(body.eventId).trim(), turnId = str(body.turnId).trim();
    if (!EVENT_ID.test(eventId) || !TURN_ID.test(turnId)) return H.sendJson(res, 400, { error: 'eventId and turnId are required.' });
    var status = STATUSES.indexOf(body.status) !== -1 ? body.status : '';
    if (!status) return H.sendJson(res, 400, { error: 'status must be applied, partly, failed, undone or stopped.' });
    function lines(v) { return arr(v).map(function (x) { return line(x, 300); }).filter(Boolean).slice(0, 30); }
    var ref = H.chatUserRef(fb, eventId, H.chatUid(decoded)).collection('turns').doc(turnId);
    ref.get().then(function (snap) {
      var was = snap.exists ? snap.data() || {} : null;
      if (!was || was.brain !== 'promo') return H.sendJson(res, 404, { error: MSG.notYours });
      var patch = { status: status, done: lines(body.done), notDone: lines(body.notDone), updatedAt: new Date().toISOString() };
      if (status === 'undone') { patch.done = arr(was.done); patch.undoneAt = patch.updatedAt; }
      return ref.update(patch).then(function () {
        H.sendJson(res, 200, { ok: true, status: status });
        var what = was.editor === 'mail' ? 'a mail' : 'a social post', q = '“' + line(was.question, 120) + '”';
        var detail = status === 'undone' ? 'Undid an ETB2B AI change to ' + what + ': ' + q
          : status === 'failed' ? 'ETB2B AI could not change ' + what + ': ' + q
          : status === 'stopped' ? 'Stopped an ETB2B AI change to ' + what + ': ' + q
          : 'ETB2B AI changed ' + what + ': ' + q + (patch.done.length ? ' — ' + line(patch.done.join('; '), 140) : '');
        H.logActivity(fb, eventId, decoded, 'ai-chat', detail, { area: 'promotions' });
      });
    }).catch(function (err) { H.sendFailure(res, 'promo ai-edit turn', err, 'That could not be recorded. Please try again.'); });
  });
}

module.exports = { wire: wire, handleEdit: handleEdit, handleTurn: handleTurn, MSG: MSG, CAPS: CAPS };
/* the pure parts, for functions/lib/promo-ai.test.js */
module.exports._test = { cleanState: cleanState, rosterOf: rosterOf, numbersIn: numbersIn, grounded: grounded, otherNamesOf: otherNamesOf,
  namesOther: namesOther, aspectOf: aspectOf, memoryText: memoryText, buildPrompt: buildPrompt, schemaFor: schemaFor, cleanAnswer: cleanAnswer,
  cleanIntent: cleanIntent, postWords: postWords, doneList: doneList, placeOk: placeOk, hasChanges: hasChanges, NETWORKS: NETWORKS };
