// ETB2B AI, the editor's chat:
//
//   POST /api/chat-edit        custom_editor.html's "Ask AI to edit" chat panel (template mode only)
//   POST /api/chat/turn        what became of a chat answer (done, undone, failed), kept in the person's conversation
//   GET  /api/chat/history     the person's own conversation for the event
//   POST /api/chat/doc-pictures  the pictures the editor took out of an attached document, stored with the event
//                              (lib/doc-pictures.js; no model call)
//
// When a model call fails the route answers { error, code, retryable } as every AI route does (lib/api.js's header).
//
// Moved out of lib/api.js as it was (BE-017): from the line after the wire() block below to module.exports, the code
// and its comments are lib/api.js's own, in their order there, unchanged — so where a comment below says "this file",
// "above" or "below" of something that is not in this file, it means lib/api.js, where the rest of that code still is.
// lib/api.js routes the requests here (ROUTES, loaded on first use through inModule()) and hands this file, on every
// call, the helpers and settings that its own routes use too (wire(), as for lib/dash-bot.js): requiring that file from
// here would be a require cycle. Loading this file reads nothing, writes nothing and needs no environment.
const crypto = require('crypto');
/* the documents a person attaches to an ETB2B AI message: PDFs and PowerPoint decks (owner decision 14) */
const aiDocs = require('./ai-docs');
/* the pictures the editor takes out of those documents, kept with the conversation and placed by number (owner, 16 Nov
   2026: "use the images from this pdf and try to well accommodate them in this website") */
const docPictures = require('./doc-pictures');
const { getFirebase } = require('./firebase');
const { sendJson, isEventId } = require('./http');
const { logActivity } = require('./activity');
/* every text call goes through llm.js: Claude first when its key is set, Gemini as the fallback */
const llm = require('./llm');
const logoUnit = require('./logo-unit');
/* registration forms: their shape, the public definitions, the AI chat's form changes (pure) */
const formsLib = require('./forms');
const { safeFetch } = require('./safe-fetch');

/* What lib/api.js hands this file on every call (wire(); see aiChatHelpers() there): the helpers and settings
   that its own routes use too. Each is kept here under its own name, so the code below reads exactly as it did there.
   Run without them it would have no sign-in check or answer to call, so a wiring with parts missing is refused. */
var NEEDS = [
  'AI_OUTPUT_TOKENS', 'BODY_LIMITS', 'DESIGN_ENUM_FIELDS', 'DESIGN_FIELDS', 'DESIGN_NUMERIC_FIELDS',
  'ET_LOGO_COLOUR_RULE', 'NAME_RULE', 'aiUsageRecorder', 'approvalsConfig', 'chatName', 'chatRateOk', 'chatUid',
  'chatUserRef', 'eventDocRef', 'httpError', 'queryOf', 'sanitizeDesignField', 'sendAiFailure', 'sendFailure',
  'sendStepFailure', 'withAdmin', 'withAdminBody'
];
var AI_OUTPUT_TOKENS, BODY_LIMITS, DESIGN_ENUM_FIELDS, DESIGN_FIELDS, DESIGN_NUMERIC_FIELDS, ET_LOGO_COLOUR_RULE,
  NAME_RULE, aiUsageRecorder, approvalsConfig, chatName, chatRateOk, chatUid, chatUserRef, eventDocRef, httpError,
  queryOf, sanitizeDesignField, sendAiFailure, sendFailure, sendStepFailure, withAdmin, withAdminBody;
function wire(helpers) {
  var missing = NEEDS.filter(function (k) { return !helpers || helpers[k] == null; });
  if (missing.length) throw new Error('lib/api-chat.js needs ' + missing.join(', ') + ' from lib/api.js');
  ({
    AI_OUTPUT_TOKENS, BODY_LIMITS, DESIGN_ENUM_FIELDS, DESIGN_FIELDS, DESIGN_NUMERIC_FIELDS, ET_LOGO_COLOUR_RULE,
    NAME_RULE, aiUsageRecorder, approvalsConfig, chatName, chatRateOk, chatUid, chatUserRef, eventDocRef, httpError,
    queryOf, sanitizeDesignField, sendAiFailure, sendFailure, sendStepFailure, withAdmin, withAdminBody
  } = helpers);
}


/* ---------- POST /api/chat-edit — custom_editor.html's "Ask AI to edit" chat panel (template mode) ----------
   A free-text instruction, interpreted against the REAL mounted template: a partial `design` patch (the same
   canvas.design field vocabulary as /api/suggest-design, reused as-is) plus, optionally, a few grounded text
   edits ({sectionId, find, replace} — find must be a short exact substring of that section's OWN current
   text, sent as context below, so the model can't invent a replacement for text that was never there). Nothing
   is applied server-side; the browser shows the proposal and only calls canvas.design.set()/does the text
   replacement once the user confirms (see editor-template-ui.js's wireChatPanel). */
/* What the owner had selected on the page when they wrote: the section (and the element in it, if one was
   selected). Their words still win: a message that names another section or the whole site is about that. */
function chatFocusLine(payload, sections) {
  var f = payload.focus;
  if (!f || typeof f !== 'object') return '';
  var id = String(f.sectionId || '');
  var sec = sections.filter(function (s) { return s.id === id; })[0];
  if (!sec) return '';
  var name = String(f.name || sec.name || id).replace(/\s+/g, ' ').slice(0, 80);
  var el = f.element && typeof f.element === 'object' ? f.element : null;
  var kind = el ? String(el.kind || '').replace(/[^a-z0-9-]/gi, '').slice(0, 20) : '';
  var text = el ? String(el.text || '').replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  return 'WHAT THE OWNER HAS SELECTED: while writing this, the owner had the section "' + name + '" (sectionId ' + id + ') selected on the page' +
    (el ? ', and inside it ' + (kind === 'image' ? 'a picture' : 'the ' + (kind || 'element') + (text ? ' that reads "' + text + '"' : '')) : '') + '. ' +
    'Unless the message clearly names another section or the whole site, "this", "here", "it" and any change that does not say where it goes mean ' +
    (el ? 'that ' + (kind === 'image' ? 'picture' : 'element') + ' in that section' : 'that section') + ': make the change there and only there. A question about "this" is about it too.\n';
}

/* The site's forms as the editor sent them ({ id, name, purpose, fields: [label] }), cleaned: at most the 20
   an event can have, labels only. */
function chatForms(payload) {
  return (Array.isArray(payload.forms) ? payload.forms : []).filter(function (f) {
    return f && typeof f === 'object' && formsLib.FORM_ID_RE.test(String(f.id || ''));
  }).slice(0, formsLib.LIMITS.maxForms).map(function (f) {
    return {
      id: f.id, name: String(f.name || f.id).replace(/\s+/g, ' ').trim().slice(0, 80),
      purpose: formsLib.PURPOSES.indexOf(f.purpose) !== -1 ? f.purpose : 'custom',
      fields: (Array.isArray(f.fields) ? f.fields : []).map(function (l) {
        return String(l && typeof l === 'object' ? l.label || '' : l || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      }).filter(Boolean).slice(0, formsLib.LIMITS.maxFields)
    };
  });
}

/* What the AI sees of the page: pictures the editor drew of it as it looks right now (chatView), after any the
   owner attached. The owner, 28 Oct 2026: "I can't see the page as visitors do" is not an answer an AI should give. */
var CHAT_VIEW_WHAT = { page: 'the WHOLE page, top to bottom, in order', section: 'the section the owner has selected', visible: 'the part of the page the owner has in view' };
function chatViewLine(payload) {
  var n = payload.viewCount || 0;
  if (!n) return 'No screenshot of the page came with this message (the editor could not draw it in time): answer from the page\'s text and design settings below, and still do what is asked. Do not make a point of it — at most one short clause that the visual check was not possible this time; never say "I can\'t see the page".';
  return 'You can SEE the page: ' + (n === 1 ? 'the last picture with this message is a screenshot' : 'the last ' + n + ' pictures with this message are screenshots') +
    ' of the site as it looks in the editor right now — ' + (CHAT_VIEW_WHAT[payload.viewWhat] || CHAT_VIEW_WHAT.visible) + '. Look at them properly: judge the layout, spacing, alignment, colours, contrast, type, pictures and balance from what you see, and say what you see when it matters. Never say you cannot see the page. (Editor marks may show: a coloured outline around what is selected is the editor\'s, not the site\'s.)' +
    chatViewLimits(payload);
}
/* what the screenshots leave out, so the model never reports the screenshot's own limits as problems on the page */
function chatViewLimits(payload) {
  var left = Math.max(0, Math.min(999, parseInt(payload.viewLeftOut, 10) || 0));
  var undrawn = (Array.isArray(payload.viewUndrawn) ? payload.viewUndrawn : []).map(function (n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 60); }).filter(Boolean).slice(0, 12);
  var out = [];
  if (left) out.push(left + ' picture' + (left === 1 ? ' is' : 's are') + ' left out of the screenshots and shown as hatched grey boxes marked "picture" (too many to draw, or not loaded in time) — visitors see the real pictures there, and a banner or section showing such a box HAS a picture');
  if (undrawn.length) out.push('the section' + (undrawn.length === 1 ? '' : 's') + ' ' + undrawn.map(function (n) { return '"' + n + '"'; }).join(', ') + (undrawn.length === 1 ? ' is' : ' are') + ' not in the screenshots (or shown as a grey block marked "could not be drawn")');
  return out.length ? ' LIMITS OF THE SCREENSHOTS, NOT OF THE PAGE: ' + out.join('; ') + '. Never report these as problems on the page or advise about them; judge those parts from the text below.' : '';
}
/* the pictures the editor drew: JPEG or PNG data addresses, at most `room`, each under CHAT_VIEW_MAX_BYTES */
var CHAT_VIEW_MAX_BYTES = 900 * 1024;
function chatView(payload, room) {
  var out = [];
  (Array.isArray(payload.view) ? payload.view : []).forEach(function (u) {
    if (out.length >= room) return;
    var m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+\/=]+)$/.exec(String(u || ''));
    if (m && m[2].length * 0.75 <= CHAT_VIEW_MAX_BYTES) out.push({ mimeType: m[1], data: m[2] });
  });
  return out;
}

/* The conversation so far, as the model reads it: each turn's question, your full answer and what then really
   happened on the page (applied, partly, undone), oldest first — from the turns stored for this person
   (chatTurnsFor), else what the browser sent (an editor with no event). */
var CHAT_MEMORY_TURNS = 12;
function chatHistoryText(payload) {
  if (Array.isArray(payload.turns) && payload.turns.length) {
    return payload.turns.slice(-CHAT_MEMORY_TURNS).map(function (t) {
      /* A question the events side of ETB2B AI answered in this conversation (lib/dash-bot.js, brain 'dash'): said
         in one neutral line, the owner's own words and no more. Its answer is never repeated here: it can hold the
         names of other events, typed by other people, which must never reach this prompt (plan §5c). */
      if (t && t.brain === 'dash') return '[The owner asked the events side of ETB2B AI: “' + chatLine(t.question, 300) + '” — answered there; nothing on this page changed]';
      /* a turn of the post and mailer editors' ETB2B AI (lib/promo-ai.js, brain 'promo'): about a post or a mail, never this page */
      if (t && t.brain === 'promo') return '[The owner asked ETB2B AI in the post or mailer editor: “' + chatLine(t.question, 300) + '” — that was about a post or a mail; nothing on this page changed]';
      var lines = ['User: ' + String(t.question || '').slice(0, 2000), 'You: ' + String(t.answer || '').slice(0, 1500)];
      /* the documents that message brought pictures from (lib/doc-pictures.js; the pictures themselves are listed above) */
      var brought = (Array.isArray(t.docs) ? t.docs : []).filter(function (d) { return d && d.pictures > 0; }).map(function (d) {
        return '“' + chatLine(d.name, 80) + '” (' + d.pictures + (d.pictures === 1 ? ' picture' : ' pictures') + ' taken out)';
      });
      if (brought.length) lines.splice(1, 0, '[With this message the owner attached ' + brought.join(' and ') + ']');
      /* a picture the AI made (or could not make): the model remembers what and where, so "make it brighter"
         or "try another" can mean that picture */
      var picLine = t.newPicture ? chatPicture.historyLine(t.newPicture) : '';
      /* a turn of several pictures (lib/picture-job.js): a line for each; the plan offered for a yes (turn.offer) */
      if (Array.isArray(t.pictureJobs) && t.pictureJobs.length > 1) picLine = t.pictureJobs.map(chatPicture.historyLine).filter(Boolean).join('\n');
      else if (t.offer && Array.isArray(t.offer.jobs) && t.offer.jobs.length > 1) picLine = '[You offered these new pictures as one plan: ' + t.offer.jobs.map(function (j) {
        return '“' + chatPicture.cleanSectionName(j && j.sectionName) + '”' + (j && j.subject ? ' — ' + chatLine(j.subject, 120) : '');
      }).join('; ') + '. A yes from the owner makes all of them at once — never ask "which one?"]';
      if (picLine) lines.push(picLine);
      var what = chatOutcomeText(t);
      if (what) lines.push('[What happened: ' + what + ']');
      return lines.join('\n');
    }).join('\n\n');
  }
  return (payload.history || []).slice(-16).map(function (h) { return (h.role === 'user' ? 'User: ' : 'You: ') + String(h.text || '').slice(0, 1500); }).join('\n');
}
function chatOutcomeText(t) {
  var done = (t.done || []).join('; '), not = (t.notDone || []).join('; ');
  if (t.status === 'answered') return '';
  if (t.status === 'undone') return 'this change was applied and then UNDONE by the owner — the page is as it was before it' + (done ? ' (it had done: ' + done + ')' : '');
  if (t.status === 'applied') return 'applied: ' + (done || 'as described');
  if (t.status === 'partly') return 'partly applied: ' + done + (not ? '; not done: ' + not : '');
  if (t.status === 'failed') return 'nothing could be applied' + (not ? ': ' + not : '') + '; the page is unchanged';
  /* the owner pressed Stop (UX-097): before anything was applied, or part way, keeping what was done */
  if (t.status === 'stopped') return done ? 'the owner stopped it part way; done: ' + done + (not ? '; not done: ' + not : '') : 'the owner pressed Stop before it was applied; the page is unchanged';
  if (t.status === 'applying') return 'it was being applied when this conversation was left; its result is not known';
  return '';
}
/* The PDFs and PowerPoint decks attached to the message (owner decision 14): what they are for in the site editor.
   Their words go on the page through the page's own text; Content's records (speakers, agenda, partners, FAQs,
   contacts) are entered under Content, so the answer lists what the document has for them and sends the owner
   there (goTo). '' with none. */
var CHAT_DOCS_USE = 'In the site editor, use what the documents say where the person asks: their words for the page\'s own text (the hero\'s line, the overview, a section\'s text, a new section) through `textEdits`, `sectionEdits` or `newSections`. ' +
  'Speakers, the agenda, partners and sponsors, FAQs and contacts come from the event\'s Content and appear on the page by themselves: when the person asks to fill those from a document, list in `summary` what the document has for them (names, titles, times and dates exactly as written) and set `goTo` to that Content page. ' +
  /* owner, 16 Nov 2026: the pictures inside a PDF are the owner's own and go on the page (lib/doc-pictures.js) */
  'The pictures inside a document go on the page only as the numbered pictures the editor took out of it — listed under PICTURES TAKEN OUT OF THE DOCUMENTS, which you can see — never as a page or a slide of the document itself; a document with none listed there has no picture you can place (a line about it says why). ' +
  'When the person asks to take the site\'s look or theme from a deck, use its look: its main colour as the theme colour, a second strong one as the accent, light or dark as its slides are, its fonts for headings and body text — in `design` — and the same colours in the sections\' own rework where they set their own; say in `summary` which colours and fonts you took.';
function chatDocsLines(payload) {
  return aiDocs.docsBlock(payload.docList, payload.docMarker, CHAT_DOCS_USE);
}
/* The pictures taken out of documents (lib/doc-pictures.js) — this message's, or those kept with the conversation —
   numbered after the owner's attached pictures, with a line for an attached document none could be taken from. '' with
   neither. */
/* With no document pictures in hand, for an editor that takes them out: the conversation may hold this chat's own earlier
   answers that a PDF's pictures could not be used (owner, ET DAVOS 2027, 16 Nov 2026 — said before the editor took them
   out). Those answers are out of date: the owner is asked to attach the document again, never told it cannot be done. */
var CHAT_DOC_AGAIN = 'PICTURES IN A PDF OR DECK: the editor takes the photographs out of a PDF or PowerPoint deck attached to a message, and you can then see them and place them or re-create them. None are kept for this conversation now. If the owner asks for the pictures in a document (one attached earlier, or "the images in the pdf"), ask them in a "reply" to attach that document again to their message (the attach button by the message box), then you will place them — never say that pictures cannot be taken out of a PDF or that you cannot see them; earlier answers here that said so are out of date.';
function chatDocPictureLines(payload) {
  var block = docPictures.promptLines(payload.docPictures, { sheets: payload.docSheets || 0, seen: payload.docSeen || [], fresh: payload.docFresh === true, docs: payload.docSet || [],
    swaps: payload.docSwaps === true });
  var notes = Array.isArray(payload.docNotes) ? payload.docNotes : [];
  var again = !block && payload.canPlaceDocPictures === true && !(Array.isArray(payload.docList) && payload.docList.length) ? CHAT_DOC_AGAIN : '';
  var text = [block, again].concat(notes).filter(Boolean).join('\n');
  return text ? text + '\n' : '';
}
/* An attached document none of whose pictures could be placed, said in one line: none could be taken out this time,
   or it holds no photographs (only what ai-doc-pictures.js leaves out). raw: the message's documents as sent. */
function chatDocNotes(raw, withPictures) {
  var have = {};
  (withPictures || []).forEach(function (d) { have[d.name] = true; });
  return (Array.isArray(raw) ? raw : []).slice(0, aiDocs.CAPS.docs).map(function (d) {
    if (!d || typeof d !== 'object' || (d.kind !== 'pdf' && d.kind !== 'pptx') || !Array.isArray(d.pictures) || d.pictures.length) return '';
    var name = chatLine(String(d.name || 'the document').split(/[\\/]/).pop(), 80).replace(/[<>"`]/g, '');
    if (have[name]) return '';
    if (d.picturesFailed === true) return 'No picture could be taken out of “' + name + '” this time, so none of its pictures can be placed: say so if the owner asks for them, and that attaching it again tries once more.';
    var left = docPictures.leftOutSentence(d.leftOut, 0);
    return '“' + name + '” holds no photographs to place' + (left ? ' (' + left.replace(/\.$/, '') + ')' : '') + ': say so if the owner asks for its pictures.';
  }).filter(Boolean);
}
function buildChatPrompt(payload) {
  var sections = (payload.sections || []).filter(function (s) { return s && s.id; });
  var history = chatHistoryText(payload);
  /* Making a new picture is offered only to an editor that says it can place one (canMakePictures). An editor
     still running older code gets exactly the prompt it always had, so it is never answered with a picture
     it cannot put on the page. */
  var canPics = payload.canMakePictures === true;
  return [
    'You are ETB2B AI, a real conversation partner helping someone edit their already-built event microsite for ETB2B EventSphere. You can change ANYTHING on the page the owner asks for — wording, design, the layout or content of any section, the order of sections, hiding, removing or adding sections — through the tools below. What you return is APPLIED TO THE PAGE AT ONCE (the owner can undo it with one click, and nothing goes live until they publish), so do what is asked — no more. This is a CHAT, not a one-shot command box: read the conversation so far, understand what the latest message means in that context ("make it a bit darker" refers to whatever was just discussed), and respond naturally.',
    '',
    (history ? 'Conversation so far (oldest first):\n' + history + '\n' : ''),
    'The user\'s latest message:', '"' + String(payload.instruction || '').slice(0, 2000) + '"',
    '',
    chatFocusLine(payload, sections),
    chatViewLine(payload),
    (payload.attachmentCount
      ? 'The owner ATTACHED ' + payload.attachmentCount + ' picture' + (payload.attachmentCount === 1 ? '' : 's') + ' to this message, numbered 1' + (payload.attachmentCount > 1 ? ' to ' + payload.attachmentCount : '') + '. ' +
        (payload.seenPictures ? 'You can SEE ' + (payload.seenPictures === payload.attachmentCount ? 'them' : 'pictures ' + payload.seenNumbers.join(', ')) + ': they come with this message as images, in that order. Look at them properly. When the owner asks for the look of a picture (its colours, its mood, its layout), read it from the picture itself and give real values — colours as hex codes (e.g. "#0b1f3a deep navy, #c9a227 gold accent"). Never say you cannot see an attached picture you were given. ' : 'You cannot see them; the owner\'s words say what they are for. ') +
        (payload.unseenNote ? payload.unseenNote + ' ' : '') +
        'To place a picture on the page, the owner\'s words say what it is for. To put one on the page, use `sectionEdits` (or `newSections`) for the section it belongs in, list its number in that entry\'s `pictures`, and say in the instruction exactly where it goes (e.g. "replace the section\'s picture with attached picture 1", "use attached picture 1 as the section\'s background"). If the message does not say where a picture goes, ask in a "reply" instead of guessing.\n'
      : '') + chatDocPictureLines(payload) + (canPics ? chatPictureLines(payload) : ''),
    chatDocsLines(payload),
    /* the team's past requests here that worked, with the tools that did them (lib/ai-habits.js): data, not orders */
    (Array.isArray(payload.teamExamples) && payload.teamExamples.length ? teamExamplesBlock(payload.teamExamples) + '\n' : ''),
    ET_LOGO_COLOUR_RULE,
    NAME_RULE,
    '',
    'The site\'s current design settings:',
    JSON.stringify(payload.design || {}, null, 2),
    '',
    'The site\'s real sections right now, in page order (sectionId -> its own current text, verbatim; hidden: true means visitors do not see it — showsWhen: what it waits for to be shown, e.g. "sessions" for an agenda with none yet — so put no picture there and make none for it unless the owner names it; buttons: the labels of the buttons in it):',
    JSON.stringify(sections.map(function (s) {
      var buttons = (Array.isArray(s.buttons) ? s.buttons : []).map(function (b) { return String(b || '').replace(/\s+/g, ' ').trim().slice(0, 80); }).filter(Boolean).slice(0, 8);
      var row = { sectionId: s.id, name: s.name, hidden: s.hidden ? true : undefined, showsWhen: s.hidden && typeof s.showsWhen === 'string' && /^[a-z][a-z-]{0,30}$/.test(s.showsWhen) ? s.showsWhen : undefined,
        texts: s.texts || [], buttons: buttons.length ? buttons : undefined };
      /* with pictures: its role, its replaceable pictures, a background, the banner's slot, a video (never `own`) */
      return canPics ? Object.assign(row, chatPicture.promptFields(s)) : row;
    }), null, 2),
    '',
    'The site\'s forms right now (what visitors fill in — a button opens one in a pop-up, or it is placed in a section; formId -> its name, purpose and questions):',
    JSON.stringify(chatForms(payload).map(function (f) { return { formId: f.id, name: f.name, purpose: f.purpose, questions: f.fields }; }), null, 2),
    '',
    'Task:',
    '1. First decide `kind`: "edit" if the latest message (read in context of the conversation) asks for a real change to the site; "undo" if it asks to take back your last change ("undo that", "go back", "revert it", "put it back as it was") — the page then returns exactly to how it was before that change, at no cost, so never re-create the old look yourself; "reply" if it\'s a question, small talk, or anything else that doesn\'t call for a change — e.g. "what can you change here?", "why didn\'t that work?", "thanks". Don\'t force an edit out of a message that\'s just a question.' +
      (payload.handedFrom ? ' ETB2B AI\'s events side passed this message to you because it is about this page: answer it as an edit, an undo or a reply yourself.' : CHAT_HANDOFF_LINE),
    '2. If `kind` is "reply" or "undo": leave every change list empty and `design` empty, and put your answer in `summary` — natural and helpful (a list of sections is a full list); reference the actual sections/design above, don\'t make things up. A request that is too vague to do well, where reasonable readings would change the site in very different ways ("make it look more premium", "fix the design", "make it pop"), gets ONE short clarifying question as a "reply", offering two or three concrete options to choose from (e.g. "Darker and more spacious, a more classic serif for headings, or gold accents on a deep background?"). A clear request is simply done — don\'t ask for permission.',
    '   The banner\'s white overlay (the wash over its picture) is `design.heroVeil`, 0-100 percent of its designed strength (100 = as designed, the current value is above): "reduce the white overlay", "show the banner picture more" lower it (e.g. by 30-50); never rework the banner for that.',
    '3. If `kind` is "edit": if it asks for a visual/design change (colour, font, spacing, heading style…), return a partial `design` object — ONLY the fields the instruction actually calls for, using these field names: ' + DESIGN_FIELDS.join(', ') + '. Leave out any field it didn\'t ask to change. A colour field MUST be a hex code ("#1c1c1c") — if it names a colour in words ("orange", "navy blue"), translate it to the closest real hex value yourself; never write the colour word into a colour field, it will be rejected. If it asks to change text, return `textEdits`: an array of {sectionId, find, replace}, where `find` is copied VERBATIM (exact substring, same spelling/punctuation) from that section\'s own text shown above — never invent or paraphrase the original. Never invent facts (dates, numbers, names) that aren\'t already present. A follow-up like "make it bigger instead" that refines a design mentioned earlier in the conversation should produce a fresh, complete replacement for the fields it\'s changing, not an incremental tweak instruction.',
    'A text edit applies to EVERY place that exact `find` text appears in that section. To change a word, a year, a name or a number everywhere (e.g. "change 2026 to 2027"), give `find` as just that word or number and return one edit for each section whose texts contain it — check every section\'s texts, do not stop at the first. `find` must be copied exactly from the texts above.',
    '4. For everything those two cannot do, use the tools that follow — choose the lightest tool that does the job, and combine tools freely:',
    '   - `sectionEdits`: [{sectionId, instruction}] — one section is reworked by a designer-developer who follows your instruction exactly: change its layout, add, remove or reorder cards and blocks, rewrite or extend its content, restyle only that section (colours, sizes, spacing, alignment, backgrounds), turn a grid into a carousel or a timeline, anything. Write `instruction` as a complete, specific brief in plain words, including every fact the owner gave (names, numbers, wording) — the designer sees the section and your brief, not this conversation. One entry per section that needs it. Do NOT use it for a change `textEdits` or `design` can make.',
    '   - `sectionOps`: [{op, sectionId, beforeSectionId}] — op "hide", "show" or "remove" a whole section; op "move" puts sectionId right before beforeSectionId (an empty beforeSectionId means the end of the page). The site\'s first and last sections (navigation, hero banner, footer) stay where they are.',
    '   - `newSections`: [{afterSectionId, name, instruction}] — a NEW section is designed and written from your brief and placed after afterSectionId. `name` is its short label (e.g. "Venue & Travel"); `instruction` is the complete brief: what it is for, what it must say (only facts the owner gave or that are on the page — never invented names, numbers or dates), and how it should look.',
    '   FORMS — registration and enquiry forms ("Register now", "Express interest", "Join as partner", "VIP delegates", a speaker application…). Three tools:',
    '   - `newForms`: [{ref, template, name, title, intro, fields, submitLabel, successMessage, countsAsRegistration, needsApproval}] — a NEW form. Only when the owner asks for a form or it is plainly implied ("add a VIP delegate form", "add an Express interest button" when no such form exists). If a form with that purpose or name already exists above, use it instead and do not make another. `ref` is a short id of your own ("new-1") that ctaLinks and formEmbeds use to point at it. `template` is the closest of: register (Register now — counts as a registration), interest (Express interest — an enquiry), partner (Join as partner), vip (VIP delegates — needs approval, counts as a registration), speaker (Speaker application — needs approval), blank (anything else). `fields` are its questions in order, each {label, type, required, options, placeholder, help}; type is one of ' + formsLib.FIELD_TYPES.join(', ') + '; a select, radio or multiselect question needs its `options`. Every form starts with the seven standard questions, first and in this order, all required: Official email (email), First name (text), Last name (text), Mobile number (phone — visitors pick their country code), Company (text), Designation (text), Location (location — city, state and country); list them first, then only the questions the purpose needs (never a separate full-name, phone or city question). Every form also ends with ET\'s consent box (privacy, cookie and terms), which the platform adds by itself: never add a consent, terms or privacy question. Never invent facts (dates, prices, places, names) in the intro or the success message. countsAsRegistration: true only for forms that sign people up to attend; needsApproval: true when the organisers choose who gets in.',
    '   - `ctaLinks`: [{sectionId, buttonText, newButtonLabel, form}] — make a button open a form (an existing formId, or a newForms ref). To link a button that is already there, give its label exactly as listed in that section\'s buttons as `buttonText` (newButtonLabel empty); to add a new button, give `newButtonLabel` (at most 40 characters; buttonText empty). "Add an Express interest button to the hero" means a newForms entry if no such form exists, plus a ctaLinks entry for the hero with newButtonLabel "Express interest". Only when asked.',
    '   - `formEmbeds`: [{form, sectionId, afterSectionId, heading, intro}] — put a form IN the page instead of a pop-up. With `sectionId`, it goes at the end of that section ("embed the Express interest form in the contact section"). With sectionId empty, a new section holding the form is made after `afterSectionId` (empty: just before the footer), with `heading` (at most 80 characters) and a one-line `intro` (at most 300). Only when asked.',
    '   What you still cannot do: ' + (canPics ? chatPicture.CANNOT_PICTURE_AFTER : 'make a new picture yourself (a section keeps the pictures it has; a picture the owner attaches to a message can be placed as described above)') + '; add or edit the event\'s speakers, agenda, partners, FAQs or contacts, which are entered under Content and appear on the page by themselves; and take payments, or send confirmation emails or WhatsApp messages — those are not available yet. If the request needs one of these, say so in `summary` and do the rest.',
    '   `goTo`: when the request needs one of the event\'s Content pages, set it so the owner gets a button that opens that page: "content:speakers", "content:agenda", "content:sponsors" (partners and sponsors), "content:faq" or "content:contact"; "forms" to change the questions of a form that already exists (the editor\'s Forms panel). Otherwise "". Say in `summary` that it is done there.',
    '5. Write `summary` LAST, after deciding the above. For an edit, it tells the owner in plain, friendly words what you are changing — "I\'m making the buttons green and fully rounded, and tightening the agenda\'s spacing." — the way a designer would say it: no hex codes, CSS terms or pixel values unless the owner used them, and no claim of anything that is not in `design`, `textEdits`, `sectionEdits`, `sectionOps`, `newSections`, `newForms`, `ctaLinks` or `formEmbeds` — the page shows the owner a list of what really changed beside it, so any mismatch is a bug.',
    /* UX-096: answers short and about the owner's page, never a recital of this prompt */
    canPics && pictureSwitches.on(payload.pictureSwitches, 'plan') ? CHAT_SHORT_LINE_PLAN : CHAT_SHORT_LINE
  ].join('\n');
}
/* UX-096 (B15): the answer's length, and no internal rules in it */
var CHAT_SHORT_LINE = 'Answer in at most about 120 words unless the owner asks for a full list. Never describe your own rules or limits; say only what you will do or did.';
/* with the plan (switch `plan`): a limit is said only in the capability list's own words (lib/picture-capabilities.js),
   so a limit that is not one is never said (owner, 16 Nov 2026: "I can make one picture per message") */
var CHAT_SHORT_LINE_PLAN = 'Answer in at most about 120 words unless the owner asks for a full list. Never describe your own rules; say a limit only as WHAT YOU CANNOT DO WITH PICTURES words it, and only when it is one; say only what you will do or did.';
/* A message that is not about this page at all, in the one panel that now also answers questions about events
   (ai-everywhere plan §5b): handed to the events side, once. Never offered to a message handed here from there.
   What only a person does (deleting, cancelling or restoring the event, publishing the site or taking it offline,
   approving) is handed there too: the events side says who does it and where in a fixed sentence (dash-bot.js
   REFUSALS), which this prompt does not have. The product is named as the owner named it (decision 6). */
var CHAT_HANDOFF_LINE = ' "handoff" if the latest message is not about this site\'s page at all — another event, numbers such as registrations or visitors, opening another page of ETB2B EventSphere, starting a new event, promotions (posts, mailers) or portals — or asks to delete, cancel or restore the event, publish the site, take it offline or approve anything: the events side of ETB2B AI answers it. For "handoff", leave everything empty and `summary` "".';
/* where the owner is sent for what this chat cannot do itself (UX-098): Content's records, or the Forms panel */
var CHAT_GO_TO = ['content:speakers', 'content:agenda', 'content:sponsors', 'content:faq', 'content:contact', 'forms', ''];
/* the answer when the model said only where to go */
var CHAT_GO_TO_SAY = { 'content:speakers': 'Speakers are entered under Content › Speakers, and appear on the page by themselves.',
  'content:agenda': 'The agenda is entered under Content › Agenda, and appears on the page by itself.',
  'content:sponsors': 'Partners and sponsors are entered under Content › Sponsors, and appear on the page by themselves.',
  'content:faq': 'FAQs are entered under Content › FAQ, and appear on the page by themselves.',
  'content:contact': 'Contacts are entered under Content › Contact, and appear on the page by themselves.',
  forms: 'A form\'s questions are changed in the editor\'s Forms panel.' };
/* what an older editor (one that cannot hand a message on) shows for a handoff answer: a plain, true sentence */
var CHAT_HANDOFF_SAY = 'That isn\'t about this page. Ask ETB2B AI on the events dashboard, or open the page it is about.';
/* a message handed here that the model still wants to hand back: one hop only (plan §5b) */
var CHAT_NOT_HANDED_BACK = 'I couldn\'t tell whether that is about this page. Name the part of the page, for example “the hero”.';

var CHAT_SECTION_OPS = ['hide', 'show', 'remove', 'move'];
function chatResponseSchema(payload) {
  var sectionIds = (payload.sections || []).map(function (s) { return s.id; });
  var designProps = {};
  DESIGN_FIELDS.forEach(function (f) { designProps[f] = { type: 'STRING' }; });
  Object.keys(DESIGN_ENUM_FIELDS).forEach(function (f) { designProps[f] = { type: 'STRING', enum: DESIGN_ENUM_FIELDS[f] }; });
  Object.keys(DESIGN_NUMERIC_FIELDS).forEach(function (f) { designProps[f] = { type: 'INTEGER', minimum: DESIGN_NUMERIC_FIELDS[f][0], maximum: DESIGN_NUMERIC_FIELDS[f][1] }; });
  var schema = {
    type: 'OBJECT',
    properties: {
      /* "handoff" (plan §5b) is not offered to a message the events side handed here: never handed back */
      kind: { type: 'STRING', enum: payload.handedFrom ? ['edit', 'reply', 'undo'] : ['edit', 'reply', 'undo', 'handoff'] },
      summary: { type: 'STRING' },
      goTo: { type: 'STRING', enum: CHAT_GO_TO.slice(), description: 'the Content page or the Forms panel the owner is sent to for what this chat cannot do; "" for none' },
      /* the kind of request, for the record of what people ask (lib/ai-learn.js); required, so strict mode counts no new optional field */
      intent: { type: 'STRING', description: 'the KIND of request in 2 to 4 plain lowercase words, e.g. "shorten title", "swap banner", "add speakers section"; never a name, number or date' },
      design: { type: 'OBJECT', properties: designProps },   // no `required` — a partial patch, any subset
      textEdits: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            sectionId: { type: 'STRING' },
            find: { type: 'STRING' },
            replace: { type: 'STRING' }
          },
          required: ['sectionId', 'find', 'replace']
        }
      }
    },
    required: ['kind', 'summary', 'design', 'textEdits', 'sectionEdits', 'sectionOps', 'newSections', 'newForms', 'ctaLinks', 'formEmbeds', 'goTo', 'intent']
  };
  /* STRICT MODE. Claude's structured output refuses a schema with more than 24 optional parameters — a property its object does not list as required, counted over every object — and this one had 32,
     so every chat message was refused once and asked again in plain mode (QA, 3 Nov 2026). So every field of a
     list's entry is required, and "not said" is written as "" (a string), [] (a list) or false (a box not ticked);
     the validators already read those as not said: cleanAiFormOps / cleanAiForm (lib/forms.js) take "" as the
     template's own wording, [] as no options and false as not required; an empty beforeSectionId is the end of the
     page; an empty pictures list uses no attached picture. Only two kinds of field stay optional: the design patch's
     (any subset, as before — "" would be a value to check, and an absent field is not changed) and the two form
     switches whose absence means the template's own setting (countsAsRegistration, needsApproval), where false
     would turn a registration form into an enquiry. functions/lib/chat.test.js counts them through claude.js. */
  /* forms (lib/forms.js; the answer is checked by cleanAiFormOps) */
  schema.properties.newForms = { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    ref: { type: 'STRING' },
    template: { type: 'STRING', enum: formsLib.FORM_TEMPLATES.map(function (t) { return t.id; }) },
    name: { type: 'STRING' },
    title: { type: 'STRING', description: 'the form\'s heading; "" to use its name' },
    intro: { type: 'STRING', description: 'a line under the heading; "" for none' },
    fields: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      label: { type: 'STRING' }, type: { type: 'STRING', enum: formsLib.FIELD_TYPES },
      required: { type: 'BOOLEAN', description: 'true when it must be answered' },
      options: { type: 'ARRAY', items: { type: 'STRING' }, description: 'the choices of a select, radio or multiselect question; [] for any other' },
      placeholder: { type: 'STRING', description: 'grey example text in the box; "" for none' },
      help: { type: 'STRING', description: 'a hint under the question; "" for none' }
    }, required: ['label', 'type', 'required', 'options', 'placeholder', 'help'] } },
    submitLabel: { type: 'STRING', description: 'the button\'s words; "" for the template\'s own' },
    successMessage: { type: 'STRING', description: 'what a visitor reads after sending it; "" for the template\'s own' },
    countsAsRegistration: { type: 'BOOLEAN' }, needsApproval: { type: 'BOOLEAN' }
  }, required: ['ref', 'template', 'name', 'title', 'intro', 'fields', 'submitLabel', 'successMessage'] } };
  schema.properties.ctaLinks = { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    sectionId: { type: 'STRING' },
    buttonText: { type: 'STRING', description: 'the label of a button already in the section, as listed; "" when a new button is added' },
    newButtonLabel: { type: 'STRING', description: 'the label of a new button (at most 40 characters); "" when an existing button is linked' },
    form: { type: 'STRING', description: 'an existing formId, or the ref of one of newForms' }
  }, required: ['sectionId', 'buttonText', 'newButtonLabel', 'form'] } };
  schema.properties.formEmbeds = { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    form: { type: 'STRING', description: 'an existing formId, or the ref of one of newForms' },
    sectionId: { type: 'STRING', description: 'the section to put it in, or empty for a new section' },
    afterSectionId: { type: 'STRING', description: 'for a new section: the section it follows ("" for just before the footer; "" too when sectionId is given)' },
    heading: { type: 'STRING', description: 'for a new section: its heading; "" for the form\'s name' },
    intro: { type: 'STRING', description: 'for a new section: one line under the heading; "" for the usual line' }
  }, required: ['form', 'sectionId', 'afterSectionId', 'heading', 'intro'] } };
  schema.properties.sectionEdits = { type: 'ARRAY', items: { type: 'OBJECT', properties: { sectionId: { type: 'STRING' }, instruction: { type: 'STRING' }, pictures: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'numbers of the attached pictures this edit uses; [] for none' } }, required: ['sectionId', 'instruction', 'pictures'] } };
  schema.properties.sectionOps = { type: 'ARRAY', items: { type: 'OBJECT', properties: { op: { type: 'STRING', enum: CHAT_SECTION_OPS }, sectionId: { type: 'STRING' }, beforeSectionId: { type: 'STRING', description: 'for "move": the section it goes before ("" for the end of the page); "" for any other op' } }, required: ['op', 'sectionId', 'beforeSectionId'] } };
  schema.properties.newSections = { type: 'ARRAY', items: { type: 'OBJECT', properties: { afterSectionId: { type: 'STRING' }, name: { type: 'STRING' }, instruction: { type: 'STRING' }, pictures: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'numbers of the attached pictures this section uses; [] for none' } }, required: ['afterSectionId', 'name', 'instruction', 'pictures'] } };
  if (sectionIds.length) {
    schema.properties.textEdits.items.properties.sectionId.enum = sectionIds;
    schema.properties.sectionEdits.items.properties.sectionId.enum = sectionIds;
    schema.properties.sectionOps.items.properties.sectionId.enum = sectionIds;
    schema.properties.ctaLinks.items.properties.sectionId.enum = sectionIds;
  }
  /* a new picture the AI makes (lib/chat-picture.js; the answer is checked by chatPicture.planAsk): only for an
     editor that can place one, so an older editor's schema is unchanged */
  if (payload.canMakePictures === true) {
    /* with the plan (lib/picture-plan.js, switch `plan`): up to 4, each with the owner's quote and its names typed, and
       once per answer what the owner said about the last picture (lib/picture-ledger.js); off: as it was */
    schema.properties.newPictures = chatPicture.schemaItem(sectionIds, payload.pictureSwitches);
    schema.required.push('newPictures');
    if (pictureSwitches.on(payload.pictureSwitches, 'plan')) {
      schema.properties.lastPictureFeedback = require('./picture-job').FEEDBACK_PROP.lastPictureFeedback;
      schema.required.push('lastPictureFeedback');
    }
  }
  /* a picture taken out of a document put where a section already has one (lib/doc-pictures.js; the answer is checked
     by its cleanSwaps): only for an editor that puts them in, and only while there are such pictures */
  if (payload.docSwaps === true) {
    schema.properties.pictureSwaps = docPictures.swapSchema(sectionIds);
    schema.required.push('pictureSwaps');
    /* which of the document pictures it places show people: kept out of every section but a people section (QA, 16 Nov
       2026: a collage with people in it went into Why Join Us) */
    schema.properties.docPeople = docPictures.peopleSchema();
    schema.required.push('docPeople');
  }
  return schema;
}

/* The pictures attached to a chat message, as the model is shown them: { images: [{ mimeType, data }],
   numbers: [n] (which attachments they are), skipped: [sentence] }. Only pictures uploaded for this event to
   our own bucket (the editor's attach button puts them there) are fetched — never an address a request
   names elsewhere. A picture the model cannot take (an SVG, one too large) is left out and the model is
   told which, so it does not pretend to have seen it. */
var CHAT_PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
var CHAT_PICTURE_MAX_BYTES = 3700000;          // base64 of it stays under the 5 MB a model takes per picture
function chatPictures(eventId, urls) {
  var fb = getFirebase();
  var none = { images: [], numbers: [], skipped: [] };
  if (fb.error || !isEventId(String(eventId || '')) || !Array.isArray(urls) || !urls.length) return Promise.resolve(none);
  var own = 'https://storage.googleapis.com/' + fb.bucket.name + '/events/' + eventId + '/';
  return Promise.all(urls.slice(0, 6).map(function (url, i) {
    url = String(url || '');
    if (url.indexOf(own) !== 0 || /[?#]/.test(url.slice(own.length).replace(/\?v=\d+$/, ''))) return Promise.resolve({ n: i + 1, why: 'was not uploaded here' });
    return safeFetch(url, { timeoutMs: 8000, maxBytes: CHAT_PICTURE_MAX_BYTES }).then(function (r) {
      var info = r.status === 200 ? logoUnit.imageInfo(r.body) : null;
      if (!info || CHAT_PICTURE_TYPES.indexOf(info.mime) === -1) return { n: i + 1, why: info && info.type === 'svg' ? 'is an SVG drawing, which cannot be shown to you' : 'could not be read' };
      return { n: i + 1, image: { mimeType: info.mime, data: r.body.toString('base64') } };
    }, function (err) {
      return { n: i + 1, why: err && err.code === 'too-large' ? 'is too large to be shown to you (over 3.7 MB)' : 'could not be fetched' };
    });
  })).then(function (got) {
    var out = { images: [], numbers: [], skipped: [] };
    got.forEach(function (g) {
      if (g.image) { out.images.push(g.image); out.numbers.push(g.n); }
      else out.skipped.push('Attached picture ' + g.n + ' ' + g.why + '.');
    });
    return out;
  });
}

/* ---------- ETB2B AI, the editor's chat (POST /api/chat-edit, the history routes below) ----------
   What the AI answers is applied to the page at once and can be undone (editor-template-ui.js); there is no
   proposal to accept (the owner, 28 Oct 2026). Every exchange is kept, under the person who had it:
   events/<id>/aiChats/<uid> { uid, email, name, lastAt } and its turns/<turnId> { question, answer, kind,
   status, done, notDone, focus, pictures, at, updatedAt }. A person sees their own conversation in the editor;
   each exchange is also a line in the event's History (activity), and the event's approvers can read every
   conversation (GET /api/chat/history?all=1). The model's memory is the stored conversation, with what really
   happened after each answer (applied, partly, undone). */
var CHAT_ANSWER_CHARS = 4000;
var CHAT_MAX_PICTURES = 6;          // what one model call takes (gemini.js / claude.js MAX_IMAGES)

/* ETB2B AI may make ONE new picture when the owner asks for one, and places it at once, with Undo (the owner,
   3 Nov 2026). The rules, the checks, the wording and the making live in lib/chat-picture.js; what follows only
   wires them into this chat. It is required here, not with the modules at the top of the file, so the chat's
   code stays in one place. */
var chatPicture = require('./chat-picture');
/* the advanced picture assistant (plan of 16 Nov 2026, Step 0): the plan of the pictures a message asks for
   (lib/picture-plan.js), the switches each part runs behind (lib/picture-switches.js, config/aiPictures; all off =
   today), the person's picture ledger (lib/picture-ledger.js), and the second steps that write the briefs
   (lib/picture-brief.js) and fit a placed picture again (lib/picture-fit.js) */
var picturePlan = require('./picture-plan');
var pictureSwitches = require('./picture-switches');
var pictureLedger = require('./picture-ledger');
/* the prompt's lines about making a picture, placed right after the attachments' */
function chatPictureLines(payload) {
  var text = String(chatPicture.promptLines(payload) || '').trim();
  return text ? text + '\n' : '';
}
/* The section fields the editor sends for pictures (role, video, heroMode, pics), cleaned by
   chatPicture.cleanSectionFields: nothing is used as the browser sent it. `own` keeps only this event's own
   Storage addresses (it counts people pictures and is never shown to the model); with no event there are none. */
function chatPictureSections(fb, eventId, sections) {
  var own = eventId && fb && fb.bucket && fb.bucket.name ? 'https://storage.googleapis.com/' + fb.bucket.name + '/events/' + eventId + '/' : '';
  return (Array.isArray(sections) ? sections : []).map(function (s) { return s && typeof s === 'object' ? chatPicture.cleanSectionFields(s, own) : s; });
}
/* This event's own Storage addresses begin with this ('' for no event): pictures taken out of documents are read only
   from under it (lib/doc-pictures.js) */
function chatOwnPrefix(fb, eventId) {
  eventId = String(eventId || '');
  return isEventId(eventId) && fb && fb.bucket && fb.bucket.name ? 'https://storage.googleapis.com/' + fb.bucket.name + '/events/' + eventId + '/' : '';
}
/* what the owner had selected, for planAsk, with which of the section's pictures it is (slot, 1-based; 0 = none) */
function chatPictureFocus(focus) {
  if (!focus || typeof focus !== 'object') return null;
  var slot = parseInt(focus.slot, 10);
  return Object.assign({}, focus, { sectionId: String(focus.sectionId || '').slice(0, 120), slot: slot >= 1 && slot <= 50 ? slot : 0 });
}
/* the newest stored turn's picture: a short follow-up ("try another") may mean the same place. A question the
   events side answered in between (brain 'dash') is not a turn of this chat's, so it is passed over. */
function chatLastPicture(turns) {
  var own = (Array.isArray(turns) ? turns : []).filter(function (t) { return !(t && (t.brain === 'dash' || t.brain === 'promo')); });
  var last = own.length ? own[own.length - 1] : null;
  var np = last && last.newPicture && typeof last.newPicture === 'object' ? last.newPicture : null;
  /* the plan of several pictures kept for a yes (lib/picture-plan.js takeOffer): with its first picture's record */
  if (np && last.offer && Array.isArray(last.offer.jobs) && last.offer.jobs.length > 1) return Object.assign({}, np, { offerJobs: last.offer.jobs.slice(0, 4) });
  return np;
}
/* the newest stored turn of this chat's own (not the events side's, nor the post and mailer editors'), or null */
function chatLastOwnTurn(turns) {
  var own = (Array.isArray(turns) ? turns : []).filter(function (t) { return t && !(t.brain === 'dash' || t.brain === 'promo'); });
  return own.length ? own[own.length - 1] : null;
}
/* The answer the chat model would give to a bare yes to the pictures offered on the last turn (switch `plan`): nothing
   of its own, so the plan kept on the turn is made (picturePlan.takeOffer) — no model call is made for it */
function chatYesAnswer() {
  return { kind: 'edit', summary: '', design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [],
    goTo: '', intent: 'make offered pictures', newPictures: [], pictureSwaps: [], docPeople: [], lastPictureFeedback: '' };
}
/* What the page itself shows, from the editor's own reading of each section (sectionsContext: `shows`, the pictures it
   draws, and `logoUnit`) — deterministic, so the AI never calls a banner with its picture empty because a screenshot
   left the picture out (owner, 16 Nov 2026; baseline R1, M1, V1). -> { line, bannerPicture: true | false | null } */
function chatPageFacts(sections) {
  var out = [], bannerPicture = null;
  (Array.isArray(sections) ? sections : []).slice(0, 40).forEach(function (s) {
    if (!s || typeof s !== 'object' || s.role === 'nav' || s.role === 'footer' || s.hidden === true) return;
    var n = parseInt(s.shows, 10);
    if (!(n >= 0 && n <= 999)) return;
    var name = '“' + chatPicture.cleanSectionName(s.name || s.id) + '”';
    var unit = s.logoUnit && typeof s.logoUnit === 'object' && s.logoUnit.present === true;
    var reads = unit ? chatLine(s.logoUnit.text, 60).replace(/["“”]/g, '') : '';
    if (s.role === 'hero') bannerPicture = n > 0;
    out.push((s.role === 'hero' ? 'the banner ' + name : name) + ': ' + (n === 0 ? 'no picture' : n === 1 ? '1 picture' : n + ' pictures') +
      (unit ? ', and the logo unit' + (reads ? ' (it reads “' + reads + '”)' : '') : ''));
  });
  if (!out.length) return { line: '', bannerPicture: null };
  return { line: 'PAGE FACTS (read from the page itself, not from the screenshots — trust them over what a screenshot seems to show): ' + out.slice(0, 24).join('; ') +
    '. A banner or section listed with a picture HAS that picture; never call it empty, bare or plain. The logo unit already carries the event\'s name: a new picture never needs it.', bannerPicture: bannerPicture };
}
/* the owner's own messages in the two newest stored turns, oldest first: a scene named there ("make a picture of
   the Gateway of India") and placed in this message is still the owner's (chatPicture.planAsk ownerSubject) */
function chatEarlierAsks(turns) {
  return (Array.isArray(turns) ? turns : []).slice(-2).map(function (t) { return t && typeof t.question === 'string' ? t.question.slice(0, 2000) : ''; }).filter(Boolean);
}
/* whether an answer still changes anything on the page */
function chatAnswerChanges(answer) {
  return !!(Object.keys(answer.design || {}).length || answer.newPicture ||
    ['textEdits', 'sectionEdits', 'sectionOps', 'newSections', 'newForms', 'ctaLinks', 'formEmbeds', 'pictureSwaps'].some(function (k) { return (answer[k] || []).length; }));
}
/* stopped: the owner pressed Stop (UX-097) before the answer was applied, or between its steps */
var CHAT_STATUSES = ['answered', 'applying', 'applied', 'partly', 'failed', 'undone', 'stopped'];
/* this person's turns for the event, oldest first */
function chatTurnsFor(fb, eventId, uid, limit) {
  return chatUserRef(fb, eventId, uid).collection('turns').orderBy('at', 'desc').limit(limit || 60).get()
    .then(function (snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).reverse(); });
}
function chatLine(text, max) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max || 120); }
/* The team's past requests on this page that worked (lib/ai-habits.js examplesFor), for a prompt: [] when that
   module cannot be loaded, and never a rejection, so a prompt is never held up or failed by it. */
function teamExamples(fb, o) {
  try { return require('./ai-habits').examplesFor(fb, o).then(null, function () { return []; }); } catch (e) { return Promise.resolve([]); }
}
function teamExamplesBlock(list) {
  try { return require('./ai-habits').examplesBlock(list); } catch (e) { return ''; }
}
/* The record of what people ask ETB2B AI (lib/ai-learn.js, owner decision 11): one entry for each answer the model gave
   here, written after the answer has gone, so it never changes or holds up an answer. o: { answer, parsed, turnId,
   pictureRefused } or { code } for an answer that failed. */
function learnEdit(req, fb, decoded, payload, eventId, eventData, o) {
  try {
    var L = require('./ai-learn'), f = o.answer ? L.editFacts(o.answer, o) : { did: { kind: 'error', target: '' }, outcome: 'error', rule: o.code || 'error', fallback: 'question' };
    L.recordTurn(fb, { brain: 'edit', decoded: decoded, eventId: eventId, eventName: eventData && eventData.name, eventKind: eventData && eventData.category,
      page: 'editor', intent: o.parsed && o.parsed.intent,
      fallback: f.fallback, words: payload.instruction, did: f.did, outcome: f.outcome, rule: f.rule, turnId: o.turnId, handedFrom: payload.handedFrom,
      ua: req.headers['user-agent'], screen: payload.screen,
      /* the advanced picture assistant: whether this message corrects the change just before it (ai-learn.js
         correctionOf), the pictures it planned, and what became of them when that is known now */
      afterChange: o.afterChange === true, prevQuestion: o.prevQuestion || '', prevTurnId: o.prevTurnId || '', pictures: o.pictures || null,
      pictureOutcome: o.pictureRefused && o.pictures ? 'refused' : o.falseClaim ? 'false-claim' : '' });
  } catch (err) { console.error('chat-edit: the turn was not recorded — ' + (err && err.message)); }
}

function handleChatEdit(req, res) {
  withAdminBody(req, res, BODY_LIMITS.aiDocs, function (fb, decoded, payload) {
    /* the second step of a new picture: make the picture a stored turn asked for */
    if (payload.step === 'picture') return handleChatPictureStep(fb, decoded, payload, res);
    /* the advanced picture assistant's other second steps: the briefs of a turn's pictures, a placed picture fitted again */
    if (payload.step === 'brief' || payload.step === 'fit') return handleChatPictureJobStep(fb, decoded, payload, res);
    if (!String(payload.instruction || '').trim()) return sendJson(res, 400, { error: 'No instruction given.' });
    /* The pictures the editor took out of those documents and stored with the event (lib/doc-pictures.js): this event's
       own only, read before the documents are taken off the payload. An editor that cannot place them (older code) is
       given none — neither this message's nor those kept with the conversation. */
    var docPicsOk = payload.canPlaceDocPictures === true;
    var ownPrefix = chatOwnPrefix(fb, payload.eventId);
    var docPicsNow = docPicsOk ? docPictures.fromDocuments(payload.documents, ownPrefix) : [];
    var docNotes = docPicsOk ? chatDocNotes(payload.documents, docPicsNow) : [];
    /* PDFs and PowerPoint decks to read (owner decision 14, lib/ai-docs.js): checked before anything is spent, and
       taken off the payload so their contents are never kept with the turn */
    var docs = aiDocs.cleanDocs(payload.documents);
    delete payload.documents;
    if (docs.error) return sendJson(res, 400, { error: docs.error, code: docs.code });
    payload.docList = docs.list;
    payload.docMarker = 'DOC-' + crypto.randomBytes(6).toString('hex');
    var eventId = isEventId(String(payload.eventId || '')) ? String(payload.eventId) : '';
    /* a message the events side of ETB2B AI handed here (plan §5b): answered here, never handed back */
    payload.handedFrom = payload.handedFrom === 'dash' ? 'dash' : '';
    var uid = chatUid(decoded);
    if (!chatRateOk(uid)) return sendJson(res, 429, { error: 'That is a lot of messages in a short time. Please wait a few minutes and try again.', code: 'chat-rate', retryable: true });
    var userRef = eventId ? chatUserRef(fb, eventId, uid) : null;
    /* a new picture is offered only to an editor that can place one; the section fields it sends are cleaned */
    var canPics = payload.canMakePictures === true, eventData = null;
    payload.canMakePictures = canPics;
    if (canPics) {
      payload.eventId = eventId;
      payload.sections = chatPictureSections(fb, eventId, payload.sections);
      payload.picturesLeft = 0;
      payload.picturesPerDay = chatPicture.PER_DAY;
    }

    /* the event must exist (its usage and its conversation are kept with it), and the conversation so far is read
       (with the person's new pictures left today, when the editor can place one, and the pictures taken out of a
       document earlier in the conversation, when this message brings none) */
    var convData = null, pictureSw = pictureSwitches.OFF, ledger = [];
    var ready = !eventId ? Promise.resolve(null) : eventDocRef(fb, eventId).get().then(function (snap) {
      if (!snap.exists) throw httpError(404, 'This event does not exist.', { code: 'no-event' });
      eventData = snap.data() || {};
      return Promise.all([
        chatTurnsFor(fb, eventId, uid, CHAT_MEMORY_TURNS).catch(function (err) {
          console.error('chat-edit: the conversation of ' + eventId + ' could not be read — ' + (err && err.message));
          return [];
        }),
        canPics ? chatPicture.readLeft(fb.db, uid, Date.now()) : null,
        docPicsOk && !docPicsNow.length ? userRef.get().then(function (s) { return s.exists ? s.data() : null; }, function (err) {
          console.error('chat-edit: the pictures kept with the conversation of ' + eventId + ' could not be read — ' + (err && err.message));
          return null;
        }) : null,
        canPics ? pictureSwitches.read(fb) : null,
        canPics ? pictureLedger.read(fb, eventId, uid) : null
      ]).then(function (got) {
        if (got[3]) pictureSw = got[3];
        if (Array.isArray(got[4])) ledger = got[4];
        if (got[1]) {
          payload.pictureQuota = got[1];
          payload.picturesLeft = got[1].left;
          payload.picturesPerDay = got[1].perDay;
          var owner = eventData.designPlan && eventData.designPlan.owner;
          payload.ownerGraphics = !!(owner && owner.pictures === 'graphics');
        }
        /* the event's own place and the page's sections, for the picture lines: its place is a place, described by the
           AI itself, and every example it gives comes from this event (owner, 16 Nov 2026) */
        if (canPics) Object.assign(payload, chatPicture.promptContext(eventData, eventData.designPlan, payload.sections));
        convData = got[2];
        /* the advanced picture assistant (switch `plan`): the switches for the prompt and the schema, the sections that
           take people, what the page itself shows (page facts: the banner HAS its picture), and the pictures of this
           conversation (the ledger, with what became of the newest turn's pictures) */
        if (canPics) {
          payload.pictureSwitches = pictureSw;
          if (pictureSwitches.on(pictureSw, 'plan')) {
            lastOwnTurn = chatLastOwnTurn(got[0]);
            ledger = pictureLedger.clean(ledger.concat(pictureLedger.fromTurn(lastOwnTurn, lastOwnTurn && lastOwnTurn.id)));
            payload.peopleMap = picturePlan.peopleMap(payload.sections, { designPlan: eventData.designPlan, eventData: eventData });
            pageFacts = chatPageFacts(payload.sections);
            payload.pageFacts = pageFacts.line;
            payload.ledgerLines = pictureLedger.promptLines(ledger);
          }
        }
        return got[0];
      });
    });
    var lastOwnTurn = null, pageFacts = { line: '', bannerPicture: null };
    /* what the plan of pictures reads (lib/picture-plan.js, and chatPicture.planAsk under it): the page, the owner's
       words, the day's count, the picture (or the offer) on the last turn, the numbered pictures, the switches */
    function planCtxOf() {
      var ownAtt = Math.max(0, Math.min(6, parseInt(payload.attachmentCount, 10) || 0));
      return {
        canMakePictures: true, eventId: eventId, sections: payload.sections || [], focus: chatPictureFocus(payload.focus),
        instruction: String(payload.instruction || '').trim().slice(0, 2000), attachmentCount: ownAtt,
        picturesLeft: payload.picturesLeft, quota: payload.pictureQuota || null, designPlan: (eventData && eventData.designPlan) || null, eventData: eventData || null,
        lastTurnPicture: chatLastPicture(payload.turns), earlier: chatEarlierAsks(payload.turns),
        /* the pictures taken out of documents, numbered after the owner's: the new picture follows them, and may re-create one */
        numbered: ownAtt + (payload.docPictures || []).length, docPictures: payload.docPictures || [], docFresh: payload.docFresh === true,
        /* the advanced picture assistant: its switches, and the pictures of this conversation (lib/picture-ledger.js) */
        switches: pictureSw, ledger: ledger,
        design: payload.design, ownPrefix: ownPrefix, attachmentUrls: Array.isArray(payload.attachments) ? payload.attachments.slice(0, 6) : []
      };
    }
    /* the team's past requests here that worked (lib/ai-habits.js), as examples in the prompt; at most a short wait */
    var examples = teamExamples(fb, { brain: 'edit', page: 'editor' });
    ready.then(function (turns) {
      if (turns && turns.length) payload.turns = turns;
      /* The pictures taken out of documents: this message's (kept with the conversation for the messages after it),
         else the conversation's. They are numbered after the owner's attached pictures, so the new picture's number
         and every check of a picture number count them too (payload.numbered), and drawn on contact sheets. */
      var own = Math.max(0, Math.min(6, parseInt(payload.attachmentCount, 10) || 0));
      var docSet = eventId ? (docPicsNow.length ? docPicsNow : docPictures.recall(convData, ownPrefix)) : [];
      payload.docSet = docSet;
      payload.docFresh = docPicsNow.length > 0;
      payload.docPictures = docPictures.numbered(docSet, own);
      payload.numbered = own + payload.docPictures.length;
      payload.docNotes = docNotes;
      /* put where a section already has a picture, with no rework: the sections' picture fields are there (canPics) */
      payload.docSwaps = canPics && payload.docPictures.length > 0;
      if (docPicsNow.length && userRef) docPictures.remember(userRef, docPicsNow, new Date().toISOString());
      var sheets = !payload.docPictures.length ? Promise.resolve([]) : docPictures.sheets(payload.docPictures, { ownPrefix: ownPrefix, max: docPictures.CAPS.sheets,
        download: function (path) { return fb.bucket.file(path).download().then(function (got) { return got[0]; }); } });
      return Promise.all([chatPictures(eventId, payload.attachments), examples, sheets]);
    }).then(function (both) {
      var seen = both[0];
      payload.teamExamples = both[1];
      payload.seenPictures = seen.images.length;
      payload.seenNumbers = seen.numbers;
      payload.unseenNote = seen.skipped.length ? seen.skipped.join(' ') + ' Tell the owner so if it matters for the answer.' : '';
      /* the documents' contact sheets come right after the owner's own pictures (a model takes six pictures at most) */
      var room = CHAT_MAX_PICTURES - seen.images.length - docs.images.length;
      var sheets = (both[2] || []).slice(0, Math.max(0, room));
      payload.docSheets = sheets.length;
      payload.docSeen = sheets.reduce(function (all, s) { return all.concat(s.numbers || []); }, []);
      /* the page as it looks, after those */
      var view = chatView(payload, room - sheets.length);
      payload.viewCount = view.length;
      payload.viewWhat = CHAT_VIEW_WHAT[payload.viewWhat] ? payload.viewWhat : 'visible';
      /* a deck's slide pictures go last, as the documents' lines say (lib/ai-docs.js docsBlock) */
      var images = seen.images.concat(sheets.map(function (s) { return { mimeType: s.mimeType, data: s.data }; }), view, docs.images);
      function ask() {
        return llm.callJson(buildChatPrompt(payload), chatResponseSchema(payload), { route: 'chat-edit', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.small, images: images.length ? images : undefined,
          inlineFiles: docs.files.length ? docs.files : undefined, onUsage: aiUsageRecorder(null, eventId, 'chat-edit') });
      }
      /* A bare yes to the pictures offered on the last turn (switch `plan`): the plan kept there is made as it was, with no
         model call (owner, 16 Nov 2026: "yes" was asked again three times; it also saves about $0.045 and 15-30 s) */
      if (canPics && eventId && pictureSwitches.on(pictureSw, 'plan') && !docs.list.length && !docPicsNow.length && !(Array.isArray(payload.attachments) && payload.attachments.length) &&
        picturePlan.takeOffer(chatLastPicture(payload.turns), Object.assign({ sectionEdits: [], newSections: [] }, planCtxOf()))) {
        return { parsed: chatYesAnswer(), shortcut: true };
      }
      return ask().then(function (r) {
        /* Both models refused the request itself (owner, 10 Nov 2026: "adapt the theme for this website from this
           presentation" with a deck, answered "ETB2B AI couldn't take that request"). A picture a model cannot read
           (a page screenshot, a deck's slide picture) refuses the whole request, so it is asked once more without
           them, words only: the answer is better than none. The owner's own attached pictures go too, and the
           prompt says they could not be seen. */
        if (!r || r.code !== 'ai-rejected' || !images.length) return r;
        console.error('chat-edit: the request was refused with ' + images.length + ' picture(s); asked again without them');
        images = [];
        payload.viewCount = 0;
        payload.docSheets = 0;
        payload.docSeen = [];
        if (payload.seenPictures) { payload.unseenNote = 'The attached pictures could not be shown to you this time; say so if it matters for the answer.'; payload.seenPictures = 0; }
        payload.docList = (payload.docList || []).map(function (d) { return d.look ? Object.assign({}, d, { look: Object.assign({}, d.look, { previews: 0 }) }) : d; });
        return ask();
      });
    }).then(function (r) {
      if (r.error) { sendAiFailure(res, r); return learnEdit(req, fb, decoded, payload, eventId, eventData, { code: r.code || 'ai-unavailable' }); }
      var parsed = r.parsed;
      /* Not about this page (plan §5b): the browser sends it to the events side, whose turn is the one kept. So
         nothing is kept here and nothing goes in the History, and nothing on the page changes. A message handed
         here is never handed back: the model's handoff is then a question back to the owner. */
      if (parsed && parsed.kind === 'handoff' && !payload.handedFrom) {
        return sendJson(res, 200, { kind: 'handoff', summary: CHAT_HANDOFF_SAY, design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [],
          newForms: [], ctaLinks: [], formEmbeds: [], skipped: [], goTo: '' });
      }
      if (parsed && parsed.kind === 'handoff') parsed = Object.assign({}, parsed, { kind: 'reply', summary: String(parsed.summary || '').trim() || CHAT_NOT_HANDED_BACK });
      var goTo = parsed && CHAT_GO_TO.indexOf(parsed.goTo) !== -1 ? parsed.goTo : '';
      /* SECTIONS (the owner, 17 Nov 2026: "keep the AI also access based"): never a button to a Content page this
         person was not given (Settings › Access); the summary says so instead */
      var goToSection = { 'content:speakers': 'speakers', 'content:agenda': 'agenda', 'content:sponsors': 'sponsors', 'content:faq': 'content', 'content:contact': 'content' }[goTo];
      if (goToSection && decoded.access && !require('./access-control').sectionOk(decoded.access, goToSection)) {
        var noPart = require('./access-control').sectionLabel(goToSection) + ' is not in your access, so I can\'t take you there. Ask an admin if you need it.';
        parsed = Object.assign({}, parsed, { summary: (String(parsed.summary || '').trim() ? String(parsed.summary).trim() + ' ' : '') + noPart });
        goTo = '';
      }

      /* the prompt tells the model to only describe in `summary` what design/textEdits actually contain, but
         that's not enforceable — this tracks anything the model TRIED to set that got dropped by validation
         (e.g. a colour word instead of hex), so the client can flag the gap instead of silently under-
         delivering what the summary promised. */
      var skipped = [];
      var design = {};
      DESIGN_FIELDS.forEach(function (f) {
        var raw = parsed.design && parsed.design[f];
        var v = sanitizeDesignField(f, raw);
        if (v !== undefined) design[f] = v;
        else if (raw !== undefined && raw !== null && raw !== '') skipped.push(f + ' ("' + String(raw).slice(0, 40) + '")');
      });

      var knownSectionIds = (payload.sections || []).map(function (s) { return s.id; });
      var textEdits = (parsed.textEdits || []).map(function (t) {
        if (!t) return null;
        if (knownSectionIds.indexOf(t.sectionId) === -1) { skipped.push('a text edit for an unknown section'); return null; }
        var find = String(t.find || '').trim().slice(0, 300);
        var replace = String(t.replace || '').slice(0, 300);
        if (!find) return null;
        return { sectionId: t.sectionId, find: find, replace: replace };
      }).filter(Boolean);

      function brief(v) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 1500); }
      /* the numbered pictures: the owner's attached ones, then those taken out of documents (lib/doc-pictures.js) */
      var ownAttached = Math.max(0, Math.min(6, parseInt(payload.attachmentCount, 10) || 0));
      var attached = ownAttached + (payload.docPictures || []).length;
      /* a new picture is number attached + 1; a rework may list it only while the picture is really asked
         for (planAsk below), so it is let through here and taken out again after */
      var newN = canPics && eventId ? attached + 1 : 0;
      /* with the plan (switch `plan`), up to 4 new pictures, numbered newN, newN + 1, … in the order of newPictures */
      var planOn = canPics && pictureSwitches.on(pictureSw, 'plan');
      var topN = newN ? newN + (planOn ? require('./picture-job').MAX_JOBS - 1 : 0) : 0;
      function isNewN(n) { return !!newN && n >= newN && n <= topN; }
      function picturesOf(v, upTo) {
        var out = [], top = upTo || attached;
        (Array.isArray(v) ? v : []).forEach(function (n) { n = parseInt(n, 10); if (n >= 1 && n <= top && out.indexOf(n) === -1) out.push(n); });
        return out;
      }
      var sectionEdits = [], edited = {};
      (parsed.sectionEdits || []).forEach(function (e) {
        if (!e || knownSectionIds.indexOf(e.sectionId) === -1 || edited[e.sectionId] || !brief(e.instruction)) return;
        edited[e.sectionId] = true;
        sectionEdits.push({ sectionId: e.sectionId, instruction: brief(e.instruction), pictures: picturesOf(e.pictures, topN) });
      });

      /* A new picture (lib/chat-picture.js planAsk): only for an edit, from an editor that can place one, and
         only one. planAsk checks that the owner asked for it, where it goes, what it shows and the day's limit;
         a refusal or a question costs nothing. */
      var pictureAsk = null, pictureSay = '', pictureUnasked = false, picturePending = null, pictureTaken = false;
      /* with the plan: every picture planned (pictureAsk is the first), its stored job, and what the plan line says */
      var pictureAsks = [], pictureJobsNow = [], pictureLine = '', pictureSignals = null;
      var pictureWanted = canPics && parsed.kind !== 'reply' && parsed.kind !== 'undo' && Array.isArray(parsed.newPictures) && parsed.newPictures.length > 0;
      /* what planAsk reads: the page, the owner's words, the day's count, and the picture (or the offer) on the last turn */
      var lastPic = canPics ? chatLastPicture(payload.turns) : null;
      var planCtx = planCtxOf();
      function usePlanned(planned) {
        planned = planned || {};
        var asks = planOn && Array.isArray(planned.asks) ? planned.asks : planned.ask ? [planned.ask] : [];
        var jobs = planOn && Array.isArray(planned.jobs) ? planned.jobs : [];
        var seenN = {}, keptAsks = [], keptJobs = [];
        asks.forEach(function (a, i) {
          if (!a || typeof a !== 'object') return;
          if (!isNewN(a.n) || seenN[a.n] || knownSectionIds.indexOf(a.sectionId) === -1) {
            console.error('chat-edit: a new picture was planned as number ' + a.n + ' for "' + chatLine(a.sectionId, 60) + '" (expected ' + (planOn ? newN + ' to ' + topN : newN) + ') — not made');
            return;
          }
          seenN[a.n] = true;
          keptAsks.push(a);
          if (jobs[i]) keptJobs.push(jobs[i]);
        });
        pictureAsk = keptAsks[0] || null;
        pictureAsks = keptAsks;
        pictureJobsNow = keptJobs.length === keptAsks.length ? keptJobs : [];
        pictureLine = planned.planLine || '';
        if (planned.signals) pictureSignals = planned.signals;
        pictureSay = pictureAsk ? '' : chatLine(planned.reply, 600);
        /* "your message did not ask for one" is said only when nothing else was asked for either: beside another
           change, a picture the owner never asked for is dropped without a word */
        pictureUnasked = !pictureAsk && planned.code === 'notAsked';
        /* a question about the picture (where, which, without the name…): kept on the turn, so its answer makes it */
        picturePending = !pictureAsk && planned.pending && typeof planned.pending === 'object' ? planned.pending : null;
        if (pictureAsk && planned.note) skipped.push(chatLine(planned.note, 600));
        /* planAsk's list: the rework that places the picture added (or merged into the model's), its number nowhere else */
        if (pictureAsk && Array.isArray(planned.edits)) {
          var plannedFor = {};
          sectionEdits = planned.edits.filter(function (e) {
            if (!e || knownSectionIds.indexOf(e.sectionId) === -1 || plannedFor[e.sectionId] || !brief(e.instruction)) return false;
            plannedFor[e.sectionId] = true;
            return true;
          }).map(function (e) { return { sectionId: e.sectionId, instruction: brief(e.instruction), pictures: picturesOf(e.pictures, topN) }; });
        }
        /* a rework that places a new picture must list it, or the picture would be paid for and never shown */
        var placed = [], placedJobs = [];
        pictureAsks.forEach(function (a, i) {
          if (a.apply === 'rework' && !sectionEdits.some(function (e) { return e.sectionId === a.sectionId && e.pictures.indexOf(a.n) !== -1; })) {
            console.error('chat-edit: the rework that places a new picture in "' + chatLine(a.sectionId, 60) + '" is missing — not made');
            return;
          }
          placed.push(a);
          if (pictureJobsNow[i]) placedJobs.push(pictureJobsNow[i]);
        });
        if (placed.length < pictureAsks.length) {
          pictureAsks = placed;
          pictureJobsNow = placedJobs.length === placed.length ? placedJobs : [];
          pictureAsk = placed[0] || null;
          if (!pictureAsk) pictureSay = chatPicture.sentence('started');
          /* the plan line names what is made, so it is said again for what is left */
          if (planOn) pictureLine = picturePlan.planLineOf(placed, planCtx, pictureJobsNow);
        }
      }
      if (pictureWanted) usePlanned(picturePlan.planPictures(parsed.newPictures, Object.assign({ sectionEdits: sectionEdits }, planCtx)));
      /* A bare yes ("yes", "go ahead") to the offer on the last turn, which the model answered with another question or
         with nothing to make: the offer is made as it was kept — one yes is enough (owner, 16 Nov 2026: "yes" to three
         offers was answered "Which section would you like to start with?"). Only when the model changed nothing else.
         With the plan, a yes to several pictures offered makes them all (lib/picture-plan.js takeOffer). */
      var modelOther = Object.keys(design).length || textEdits.length || sectionEdits.some(function (e) { return !e.pictures.some(isNewN); }) ||
        ['sectionOps', 'newSections', 'newForms', 'ctaLinks', 'formEmbeds', 'pictureSwaps'].some(function (k) { return Array.isArray(parsed[k]) && parsed[k].length; });
      if (canPics && eventId && newN && !pictureAsk && parsed.kind !== 'undo' && !modelOther) {
        var taken = picturePlan.takeOffer(lastPic, Object.assign({ sectionEdits: [] }, planCtx));
        if (taken) {
          sectionEdits = [];
          usePlanned(taken);
          if (pictureAsk) { pictureWanted = true; pictureTaken = true; picturePending = null; }
        }
      }
      /* A rework the model planned around a new picture cannot be done as briefed while that picture is not being
         made — refused, never asked for, or left out of `newPictures` altogether (the model listed its number in a
         rework and asked for no picture). Sent on, the redesign would put the section's old picture, or none, where
         the brief says the new one goes, and the summary would promise a picture never made. */
      var reworkLost = [];
      var madeN = {};
      pictureAsks.forEach(function (a) { madeN[a.n] = a; });
      if (newN) {
        sectionEdits = sectionEdits.filter(function (e) {
          if (!e.pictures.some(function (n) { return isNewN(n) && !madeN[n]; })) return true;
          /* with the plan, a rework that also places a picture that is made keeps it, and only the lost number goes */
          if (planOn && e.pictures.some(function (n) { return madeN[n] && madeN[n].sectionId === e.sectionId; })) return true;
          reworkLost.push(e.sectionId);
          return false;
        });
      }
      /* a new picture's number is kept only by a rework of the section it goes in (never the banner, which is not
         reworked), and by nothing else */
      sectionEdits.forEach(function (e) {
        e.pictures = e.pictures.filter(function (n) { return n <= attached || (!!madeN[n] && madeN[n].placement !== 'hero' && e.sectionId === madeN[n].sectionId); });
      });
      var sectionOps = (parsed.sectionOps || []).map(function (o) {
        if (!o || CHAT_SECTION_OPS.indexOf(o.op) === -1 || knownSectionIds.indexOf(o.sectionId) === -1) return null;
        var before = knownSectionIds.indexOf(o.beforeSectionId) !== -1 ? o.beforeSectionId : '';
        return o.op === 'move' ? { op: 'move', sectionId: o.sectionId, beforeSectionId: before } : { op: o.op, sectionId: o.sectionId };
      }).filter(Boolean).slice(0, 12);
      var newSections = (parsed.newSections || []).map(function (n) {
        if (!n || !brief(n.instruction)) return null;
        return { afterSectionId: knownSectionIds.indexOf(n.afterSectionId) !== -1 ? n.afterSectionId : '', name: String(n.name || 'New section').trim().slice(0, 60) || 'New section', instruction: brief(n.instruction), pictures: picturesOf(n.pictures) };
      }).filter(Boolean).slice(0, 4);
      /* pictures taken out of a document, each put where a section already has one, with nothing else changed
         (lib/doc-pictures.js cleanSwaps): never in a section this answer reworks or gives the new picture */
      /* The document pictures are held to the site's picture rules here, whatever the model wrote (QA, 16 Nov 2026, ET
         DAVOS 2027): never in a section visitors do not see unless the owner's words name it (an agenda with no
         sessions), a picture of people only in a people section and in at most two, and a swap only where the
         picture's shape is close to its place's — a picture far off it is put in by a rework that gives its frame the
         picture's own shape. What is left out is said, by page. */
      /* … and a photo that shows people is never placed by itself, in any section: it is offered under the message, with
         a button that puts it in (the owner, 17 Nov 2026). The people check is the model's docPeople; when it is missing
         (never asked: an editor that cannot swap; or not in the answer), every document photo it places is offered. */
      var docDropped = [], docOffers = [], docFirst = ownAttached + 1;
      var docPeopleKnown = payload.docSwaps === true && Array.isArray(parsed.docPeople);
      var docPeople = {}, namedIds = {}, keptRe = { peopleUsed: 0 };
      if ((payload.docPictures || []).length) {
        docPeople = docPictures.peopleSet(parsed.docPeople, docFirst, attached);
        chatPicture.namedSections(String(payload.instruction || ''), payload.sections || [], '').forEach(function (id) { namedIds[id] = true; });
        var focusId = payload.focus && typeof payload.focus === 'object' ? String(payload.focus.sectionId || '') : '';
        if (focusId) namedIds[focusId] = true;
        keptRe = docPictures.cleanReworks(sectionEdits, newSections, { sections: payload.sections || [], first: docFirst, last: attached, people: docPeople, peopleKnown: docPeopleKnown,
          named: namedIds, dropped: docDropped, offers: docOffers });
        sectionEdits = keptRe.edits;
        newSections = keptRe.newSections;
      }
      var skipSwap = {};
      sectionEdits.forEach(function (e) { skipSwap[e.sectionId] = true; });
      pictureAsks.forEach(function (a) { skipSwap[a.sectionId] = true; });
      var pictureSwaps = payload.docSwaps ? docPictures.cleanSwaps(parsed.pictureSwaps, { sections: payload.sections || [], first: docFirst, last: attached, skip: skipSwap,
        pictures: payload.docPictures || [], people: docPeople, peopleKnown: docPeopleKnown, named: namedIds, peopleUsed: keptRe.peopleUsed, dropped: docDropped, offers: docOffers }) : [];
      /* a swap left out for its shape: the section is reworked with it instead, its frame in the picture's shape */
      docDropped.forEach(function (d) {
        if (d.why !== 'shape' || skipSwap[d.sectionId] || sectionEdits.length >= 10) return;
        var re = docPictures.shapeRework(d, payload.sections || []);
        if (!re) return;
        sectionEdits.push({ sectionId: re.sectionId, instruction: brief(re.instruction), pictures: re.pictures });
        skipSwap[d.sectionId] = true;
        d.reworked = true;
      });
      /* (a swap turned into a rework is a step of its own on the card: only what was left out is said) */
      docPictures.droppedLines(docDropped.filter(function (d) { return !d.reworked; }), payload.docPictures || [], payload.sections || []).forEach(function (line) { skipped.push(line); });

      /* forms: each new form checked as a form the routes would store, every link and placement checked
         against the page and the forms it names (lib/forms.js cleanAiFormOps) */
      var formOps = formsLib.cleanAiFormOps(parsed, { sections: payload.sections || [], forms: chatForms(payload) });
      skipped = skipped.concat(formOps.skipped);

      var summary = String(parsed.summary || '').trim().slice(0, CHAT_ANSWER_CHARS);
      var hasOther = Object.keys(design).length || textEdits.length || sectionEdits.length || sectionOps.length || newSections.length ||
        formOps.newForms.length || formOps.ctaLinks.length || formOps.formEmbeds.length || pictureSwaps.length;
      var hasChange = hasOther || !!pictureAsk;
      /* everything the answer would have done put document pictures where the site's rules keep them out: the answer is
         what was left out and why, not the model's summary of a change that is not made */
      var docLeftOnly = !hasChange && (docDropped.length > 0 || docOffers.length > 0) && parsed.kind !== 'reply' && parsed.kind !== 'undo';
      if (docLeftOnly) {
        summary = docPictures.droppedLines(docDropped, payload.docPictures || [], payload.sections || [])
          .concat(docPictures.offerLines(docOffers, payload.docPictures || [], payload.sections || [])).join(' ') + ' Nothing on the page changed.';
        skipped = skipped.filter(function (l) { return summary.indexOf(l) === -1; });
      }
      /* A picture that is not made (refused, unclear, or never asked for): when it was the only change, the
         answer is the server's sentence, since the model's summary promised a picture; else the sentence is
         one of the things not done, and the rest is applied. */
      var pictureReply = pictureWanted && !pictureAsk && !hasOther;
      /* the words did not clearly ask for the picture the model meant to make: ETB2B AI asks once, saying what it would
         make, and the owner's yes next makes exactly that (owner, 10 Nov 2026: "can we use the sun temple and chandaka
         jungle combo in the header?"; one yes is enough: 16 Nov 2026) */
      var pictureOffer = pictureReply && pictureUnasked ? chatPicture.offerOf(parsed.newPictures[0], payload.sections || [], planCtx) : null;
      if (pictureReply) summary = pictureOffer ? pictureOffer.sentence : pictureSay || chatPicture.sentence('notAsked');
      else if (pictureWanted && !pictureAsk && pictureSay && !pictureUnasked) skipped.push(pictureSay);
      /* the offer taken on a bare yes: the model's words were a question, so the answer says what is being made */
      if (pictureTaken && pictureAsk) {
        summary = planOn && pictureLine ? pictureLine : chatPicture.sentence('takeOffer', { name: '“' + chatLine(pictureAsk.sectionName || pictureAsk.sectionId, 60) + '”', scene: chatLine(pictureAsk.subject, 200),
          rest: (pictureAsk.restNames || []).map(function (x) { return '“' + chatLine(x, 60) + '”'; }).join(' or ') });
      } else if (planOn && pictureAsk && pictureLine) {
        /* the plan line (lib/picture-plan.js): which pictures, where, and how many are left today — said in the server's
           words; the model's summary stays only for the other changes it made */
        var picturesOnly = !Object.keys(design).length && !textEdits.length && !sectionOps.length && !newSections.length && !formOps.newForms.length &&
          !formOps.ctaLinks.length && !formOps.formEmbeds.length && !pictureSwaps.length && sectionEdits.every(function (e) { return e.pictures.some(function (n) { return !!madeN[n]; }); });
        summary = picturesOnly || !summary ? pictureLine : pictureLine + ' ' + summary;
      }
      /* A "reply" that offers a picture (the model's own `newPictures`, else its words: "I can create an image for What
         Awaits You, …"): kept on the turn, so the owner's yes makes it (owner, 16 Nov 2026). With the plan, every picture
         offered is kept, and a yes makes them all (turn.offer). */
      var offerKept = canPics && eventId && !pictureAsk && !pictureOffer && !picturePending && parsed.kind === 'reply'
        ? picturePlan.offerPlan(parsed.newPictures, summary, planCtx) : null;
      var replyOffer = offerKept ? offerKept.record : null;
      /* A limit claimed that is not one ("I can't see the pictures inside your PDF", "one picture per message", "the
         banner is empty" while it has its picture): the sentence is replaced by the true line (lib/picture-capabilities.js) */
      var falseClaim = '';
      if (planOn) {
        var claim = require('./picture-capabilities').claimCheck(summary, pictureSw, pageFacts);
        if (!claim.ok) {
          console.error('chat-edit: a false claim in the answer was put right (' + claim.codes.join(', ') + ')');
          summary = claim.summary;
          falseClaim = claim.codes.join(',');
        }
      }
      /* the model asked for no picture but briefed a rework around one: said in the server's words, as the
         answer when nothing else changes, else as a thing not done */
      var asEdit = parsed.kind !== 'reply' && parsed.kind !== 'undo';
      var lostReply = !pictureWanted && reworkLost.length > 0 && !hasOther && asEdit;
      if (lostReply) summary = chatPicture.sentence('notMade');
      else if (!pictureWanted && reworkLost.length && asEdit) {
        var lostNames = reworkLost.map(function (id) {
          var sec = (payload.sections || []).filter(function (s) { return s && s.id === id; })[0];
          return '“' + chatLine((sec && sec.name) || id, 60) + '”';
        });
        skipped.push(chatPicture.sentence('notMadePart', { name: lostNames.join(', ') }));
      }
      if (!summary && !hasChange && !goTo) {
        sendJson(res, 502, { error: 'The AI gave an answer we could not use. Try again.', code: 'ai-bad-output', retryable: true });
        return learnEdit(req, fb, decoded, payload, eventId, eventData, { code: 'ai-bad-output', parsed: parsed });
      }
      var kind = pictureTaken && pictureAsk ? 'edit' : pictureReply || lostReply ? 'reply' : parsed.kind === 'reply' ? 'reply' : parsed.kind === 'undo' ? 'undo' : hasChange ? 'edit' : 'reply';
      if (!summary && pictureAsk) summary = 'I\'m making a new picture for “' + chatLine(pictureAsk.sectionName || pictureAsk.sectionId, 60) + '”; it takes about half a minute.';
      if (!summary && goTo) summary = CHAT_GO_TO_SAY[goTo];
      var answer = { kind: kind, summary: summary || 'Done.', design: design, textEdits: textEdits,
        sectionEdits: sectionEdits, sectionOps: sectionOps, newSections: newSections,
        newForms: formOps.newForms, ctaLinks: formOps.ctaLinks, formEmbeds: formOps.formEmbeds, skipped: skipped, goTo: goTo };
      if (kind !== 'edit') ['textEdits', 'sectionEdits', 'sectionOps', 'newSections', 'newForms', 'ctaLinks', 'formEmbeds'].forEach(function (k) { answer[k] = []; });
      if (kind !== 'edit') answer.design = {};
      /* the picture is made in a second step from the stored turn, so it needs an event to keep the turn under */
      if (kind === 'edit' && pictureAsk && userRef) answer.newPicture = chatPicture.answerOf(pictureAsk);
      /* with the plan, every picture of the plan (lib/picture-job.js answerJob), each asked for by its k */
      var pictureJob = require('./picture-job');
      if (answer.newPicture && planOn && pictureJobsNow.length) answer.pictureJobs = pictureJobsNow.map(pictureJob.answerJob);
      /* which address each number taken out of a document is, so the editor puts the right picture in, and those put
         where a section already has a picture (lib/doc-pictures.js) */
      if (kind === 'edit' && (payload.docPictures || []).length) {
        answer.docPictures = docPictures.answerList(payload.docPictures);
        answer.pictureSwaps = pictureSwaps;
      }
      /* the photos offered, not placed (a photo of people, or one whose people check is missing): drawn under the
         message, each with a button that puts it in — also under a reply, when they were all the answer did */
      if (docOffers.length && (kind === 'edit' || docLeftOnly)) {
        answer.docPictures = docPictures.answerList(payload.docPictures || []);
        answer.docOffers = docOffers.map(function (o) {
          return { sectionId: o.sectionId, name: o.name || '', placement: o.placement, slot: o.slot, picture: o.picture, alt: o.alt || '', why: o.why };
        });
      }
      var prevTurn = chatLastOwnTurn(payload.turns);
      var learnt = { answer: answer, parsed: parsed, pictureRefused: pictureReply || lostReply, falseClaim: falseClaim,
        afterChange: !!prevTurn && prevTurn.kind === 'edit', prevQuestion: prevTurn ? String(prevTurn.question || '').slice(0, 300) : '', prevTurnId: prevTurn ? prevTurn.id : '',
        pictures: planOn ? { planned: pictureAsks.length, signalRegex: !!(pictureSignals && pictureSignals.regex), signalNameRun: !!(pictureSignals && pictureSignals.nameRun), shortcut: r.shortcut === true } : null };
      if (!userRef) { sendJson(res, 200, answer); return learnEdit(req, fb, decoded, payload, eventId, eventData, learnt); }
      /* kept under the person who asked: a reply is finished; a change is "applying" until the editor says how it went */
      var now = new Date().toISOString(), turnRef = userRef.collection('turns').doc();
      var focus = payload.focus && typeof payload.focus === 'object' ? chatLine(payload.focus.name, 80) : '';
      var turn = { question: String(payload.instruction).trim().slice(0, 4000), answer: answer.summary, kind: kind,
        status: kind === 'edit' ? 'applying' : 'answered', done: [], notDone: [], focus: focus,
        pictures: Math.max(0, Math.min(6, (payload.attachments || []).length || 0)), at: now, updatedAt: now };
      /* the Content page or Forms panel the answer sends the owner to, so the replay offers it again */
      if (goTo) turn.goTo = goTo;
      /* the documents this message brought pictures from (their names and how many; the pictures are kept with the
         conversation, doc-pictures.js remember) */
      if (docPicsNow.length) turn.docs = docPictures.turnDocs(docPicsNow);
      /* what the second step makes the picture from: never anything the browser sends then. With no picture made, the
         offer or the question about one, so the owner's answer to it makes it (chatPicture.pendingOf) */
      if (answer.newPicture) {
        /* with the plan: each job as lib/picture-job.js keeps it; a turn of several has pictureJobs, job 0 also as
           newPicture; a turn of one keeps only newPicture */
        if (planOn && pictureJobsNow.length > 1) { turn.pictureJobs = pictureJobsNow; turn.newPicture = pictureJobsNow[0]; }
        else turn.newPicture = planOn && pictureJobsNow.length ? pictureJobsNow[0] : chatPicture.turnRecord(pictureAsk, payload.design);
      }
      else if (pictureOffer) turn.newPicture = pictureOffer.record;
      else if (picturePending && kind !== 'undo') turn.newPicture = picturePending;
      else if (replyOffer && kind === 'reply') {
        turn.newPicture = replyOffer;
        /* the plan of several offered: a yes makes them all (lib/picture-plan.js takeOffer) */
        if (planOn && offerKept && offerKept.jobs.length > 1) turn.offer = { jobs: offerKept.jobs, at: now };
      }
      return Promise.all([
        userRef.set({ uid: uid, email: String(decoded.email || ''), name: chatName(decoded), lastAt: now }, { merge: true }),
        turnRef.set(turn)
      ]).then(function () {
        answer.turnId = turnRef.id;
        sendJson(res, 200, answer);
        learnEdit(req, fb, decoded, payload, eventId, eventData, Object.assign(learnt, { turnId: turnRef.id }));
        /* the pictures of this conversation: what became of the newest turn's, and what the owner said about the last one
           (lib/picture-ledger.js; after the answer, so it never holds it up) */
        if (planOn) pictureLedger.record(fb, eventId, uid, pictureLedger.fromTurn(lastOwnTurn, lastOwnTurn && lastOwnTurn.id), chatLine(parsed.lastPictureFeedback, 120));
        if (kind !== 'edit') logActivity(fb, eventId, decoded, 'ai-chat', 'Asked ETB2B AI: “' + chatLine(turn.question) + '”' + (kind === 'undo' ? ' — undo' : ' — answered'), { area: 'site' });
      }, function (err) {
        /* the answer is not withheld because it could not be kept: the owner is told the conversation was not saved */
        console.error('chat-edit: the turn of ' + eventId + ' was not kept — ' + (err && err.message));
        answer.notKept = true;
        /* the picture step reads the stored turn, so a picture whose turn was not kept cannot be made, nor the
           rework that would have placed it */
        if (answer.newPicture) {
          delete answer.newPicture;
          delete answer.pictureJobs;
          answer.sectionEdits = answer.sectionEdits.filter(function (e) { return !e.pictures.some(isNewN); });
          if (chatAnswerChanges(answer)) answer.skipped.push(chatPicture.sentence('started'));
          else {
            answer.kind = 'reply';
            answer.summary = chatPicture.sentence('started');
          }
        }
        sendJson(res, 200, answer);
        learnEdit(req, fb, decoded, payload, eventId, eventData, learnt);
      });
    }).catch(function (err) { sendStepFailure(res, err, err && err.status === 404 ? 404 : 500, 'The chat could not answer. Please try again.', 'chat-edit'); });
  });
}

/* POST /api/chat-edit { eventId, step: 'picture', turnId } — the second step of a new picture: makes the ONE
   picture that this person's stored turn asked for (its subject, place and kind were checked and kept by the
   first step), stores it under the event and answers { url, n, sectionId, placement, slot, apply, alt, kind },
   or { error, code, retryable } in plain words with nothing changed. Nothing but the turn's id comes from the
   browser, so a page cannot have a picture of its own made; the turn sits under the caller's own uid, so
   nobody can make another person's picture. The day's limit, a retry of a picture already made (answered
   free) and the making itself are lib/chat-picture.js make(). It is the same route as the chat, so the AI
   budget that counts the chat counts this too. */
function handleChatPictureStep(fb, decoded, payload, res) {
  var eventId = String(payload.eventId || '').trim(), turnId = String(payload.turnId || '').trim();
  if (!isEventId(eventId) || !/^[A-Za-z0-9]{10,40}$/.test(turnId)) return sendJson(res, 400, { error: 'eventId and turnId are required.', code: 'bad-request' });
  var uid = chatUid(decoded);
  if (!chatRateOk(uid)) return sendJson(res, 429, { error: 'That is a lot of messages in a short time. Please wait a few minutes and try again.', code: 'chat-rate', retryable: true });
  eventDocRef(fb, eventId).get().then(function (snap) {
    if (!snap.exists) return { status: 404, body: { error: 'This event does not exist.', code: 'no-event' } };
    /* the picture model's calls under chat-picture; the check of each picture made (a low-cost look for people, words
       and logos, lib/chat-picture.js checkPicture) under its own route */
    return pictureSwitches.read(fb).then(function (sw) {
      return chatPicture.make({ record: aiUsageRecorder(fb, eventId, 'chat-picture') || function () {}, recordCheck: aiUsageRecorder(fb, eventId, 'chat-picture-check') || function () {}, logActivity: logActivity }, {
        fb: fb, eventId: eventId, uid: uid, turnRef: chatUserRef(fb, eventId, uid).collection('turns').doc(turnId),
        eventData: snap.data() || {}, decoded: decoded, now: Date.now(),
        /* which of the turn's pictures (lib/picture-job.js; 0 when the editor names none), and the switches */
        job: chatPictureJob(payload.job), switches: sw
      });
    });
  }).then(function (out) {
    if (!out || !out.status || !out.body) throw new Error('the picture step gave no answer');
    sendJson(res, out.status, out.body);
  }).catch(function (err) {
    if (err && err.status && err.body) return sendJson(res, err.status, err.body);
    console.error('chat-edit: the new picture of ' + eventId + ' failed — ' + (err && (err.stack || err.message)));
    sendJson(res, 500, { error: 'The picture could not be made. Nothing on your site changed — ask again.', code: 'chat-picture-failed', retryable: true });
  });
}

/* which of a turn's pictures a second step is for: 0 to 3 (lib/picture-job.js MAX_JOBS), 0 when none is named; -1 for
   anything else, which make() answers as no such picture */
function chatPictureJob(v) {
  if (v == null || v === '') return 0;
  var k = typeof v === 'number' ? v : /^\d$/.test(String(v)) ? parseInt(v, 10) : -1;
  return k >= 0 && k < require('./picture-job').MAX_JOBS && Math.floor(k) === k ? k : -1;
}

/* POST /api/chat-edit { eventId, step: 'brief', turnId } — the briefs of every new picture a turn plans, in one call
   (lib/picture-brief.js briefStep, W2); { eventId, step: 'fit', turnId, job, frame: 'w:h' } — a placed picture cut again
   from its kept original to a new frame, with no AI (lib/picture-fit.js fitStep, W4). As with the picture step, only
   the turn's id (and which picture) comes from the browser, and the turn is the caller's own. */
function handleChatPictureJobStep(fb, decoded, payload, res) {
  var eventId = String(payload.eventId || '').trim(), turnId = String(payload.turnId || '').trim();
  if (!isEventId(eventId) || !/^[A-Za-z0-9]{10,40}$/.test(turnId)) return sendJson(res, 400, { error: 'eventId and turnId are required.', code: 'bad-request' });
  var uid = chatUid(decoded);
  if (!chatRateOk(uid)) return sendJson(res, 429, { error: 'That is a lot of messages in a short time. Please wait a few minutes and try again.', code: 'chat-rate', retryable: true });
  var step = payload.step;
  eventDocRef(fb, eventId).get().then(function (snap) {
    if (!snap.exists) return { status: 404, body: { error: 'This event does not exist.', code: 'no-event' } };
    return pictureSwitches.read(fb).then(function (sw) {
      var o = { fb: fb, eventId: eventId, uid: uid, turnRef: chatUserRef(fb, eventId, uid).collection('turns').doc(turnId),
        eventData: snap.data() || {}, decoded: decoded, now: Date.now(), switches: sw };
      if (step === 'brief') return require('./picture-brief').briefStep({ record: aiUsageRecorder(fb, eventId, 'picture-brief') || function () {}, logActivity: logActivity }, o);
      return require('./picture-fit').fitStep({ logActivity: logActivity }, Object.assign(o, { job: chatPictureJob(payload.job), frame: String(payload.frame || '').slice(0, 20) }));
    });
  }).then(function (out) {
    if (!out || !out.status || !out.body) throw new Error('the ' + step + ' step gave no answer');
    sendJson(res, out.status, out.body);
  }).catch(function (err) {
    if (err && err.status && err.body) return sendJson(res, err.status, err.body);
    console.error('chat-edit: the ' + step + ' step of ' + eventId + ' failed — ' + (err && (err.stack || err.message)));
    sendJson(res, 500, { error: 'That could not be done. Nothing on your site changed — try again.', code: 'chat-step-failed', retryable: true });
  });
}

/* POST /api/chat/doc-pictures { eventId, doc, key, part, parts, total, pictures: [{ page, full, thumb }] } — the
   pictures the site editor took out of a document attached to ETB2B AI (ai-doc-pictures.js), stored with the event a
   few at a time, before the message that names them is sent (lib/doc-pictures.js storeBatch: each a JPEG by its own
   bytes, sized, measured, under events/<id>/chat-docs/<key>/). -> { key, pictures: [{ url, thumb, w, h, page }] }.
   Nothing here calls a model. */
var DOC_PICTURES_BODY = 8 * 1024 * 1024;    // four pictures of at most 2 MB, with their small copies, base64-encoded
function handleDocPictures(req, res) {
  withAdminBody(req, res, BODY_LIMITS.docPictures || DOC_PICTURES_BODY, function (fb, decoded, body) {
    var eventId = String(body.eventId || '').trim();
    if (!isEventId(eventId)) return sendJson(res, 400, { error: 'eventId is required.', code: 'bad-request' });
    docPictures.storeBatch(fb, eventId, body, decoded, { logActivity: logActivity }).then(function (out) {
      sendJson(res, out.status, out.body);
    }).catch(function (err) { sendFailure(res, 'doc pictures', err, 'The pictures from the document could not be kept. Attach it again.'); });
  });
}

/* POST /api/chat/turn { eventId, turnId, status, done: [..], notDone: [..] } — what really happened to a change
   the AI answered with: applied, partly, failed, or undone later. Only the person whose turn it is reports it. */
function handleChatTurn(req, res) {
  withAdminBody(req, res, BODY_LIMITS.small, function (fb, decoded, body) {
    var eventId = String(body.eventId || '').trim(), turnId = String(body.turnId || '').trim();
    if (!isEventId(eventId) || !/^[A-Za-z0-9]{10,40}$/.test(turnId)) return sendJson(res, 400, { error: 'eventId and turnId are required.' });
    var status = CHAT_STATUSES.indexOf(body.status) !== -1 && body.status !== 'answered' && body.status !== 'applying' ? body.status : '';
    if (!status) return sendJson(res, 400, { error: 'status must be applied, partly, failed, undone or stopped.' });
    function lines(v) { return (Array.isArray(v) ? v : []).map(function (x) { return chatLine(x, 300); }).filter(Boolean).slice(0, 30); }
    var ref = chatUserRef(fb, eventId, chatUid(decoded)).collection('turns').doc(turnId);
    ref.get().then(function (snap) {
      /* a turn the events side answered in this conversation is reported through /api/dash-bot/turn, never as a change */
      /* a turn of the post and mailer editors is reported through /api/promo/ai-edit/turn (lib/promo-ai.js) */
      if (!snap.exists || (snap.data() || {}).brain === 'dash' || (snap.data() || {}).brain === 'promo') return sendJson(res, 404, { error: 'This conversation turn is not yours or no longer exists.' });
      var was = snap.data(), patch = { status: status, updatedAt: new Date().toISOString() };
      if (status !== 'undone') { patch.done = lines(body.done); patch.notDone = lines(body.notDone); }
      /* A change where nothing took effect is not "applied" or "partly", whatever an editor (an older one, cached in
         a browser) says: it is kept, and written in the History, as not applied (QA, UX-091). */
      if ((status === 'applied' || status === 'partly') && !patch.done.length) status = patch.status = 'failed';
      return ref.update(patch).then(function () {
        sendJson(res, 200, { turnId: turnId, status: status });
        /* what became of the change, in the record (lib/ai-learn.js): an undo is also a QA note */
        try { require('./ai-learn').recordOutcome(fb, { brain: 'edit', turnId: turnId, status: status, decoded: decoded, notDone: patch.notDone, ua: req.headers['user-agent'], screen: body.screen }); } catch (e) { console.error('chat turn: the outcome was not recorded — ' + (e && e.message)); }
        if (was.status === status) return;
        var q = '“' + chatLine(was.question) + '”';
        /* Stop on a question or an "undo that" (kind reply or undo): nothing on the page changed, and its "Asked
           ETB2B AI … — answered" line is already in the History (handleChatEdit), so the History says only that the
           person stopped waiting, never that a change was stopped */
        if (status === 'stopped' && was.kind !== 'edit') {
          logActivity(fb, eventId, decoded, 'ai-chat', 'Stopped waiting for ETB2B AI\'s answer: ' + q, { area: 'site' });
          return;
        }
        /* Stop is the owner's own choice, never "could not apply" (plan §14.16) */
        var detail = status === 'undone' ? 'Undid an ETB2B AI change: ' + q
          : status === 'failed' ? 'ETB2B AI could not apply: ' + q
          : status === 'stopped' ? (patch.done.length ? 'Stopped an ETB2B AI change part way: ' + q + ' — ' + chatLine(patch.done.join('; '), 140) : 'Stopped an ETB2B AI change before it was applied: ' + q)
          : 'ETB2B AI changed the site: ' + q + (patch.done.length ? ' — ' + chatLine(patch.done.join('; '), 140) : '');
        logActivity(fb, eventId, decoded, 'ai-chat', detail, { area: 'site' });
      });
    }).catch(function (err) { sendFailure(res, 'chat turn', err, 'That could not be recorded. Please try again.'); });
  });
}

/* GET /api/chat/history?eventId=…  -> { turns: [..] } this person's conversation, oldest first.
   &all=1 -> { people: [{ uid, email, name, turns }] } every conversation of the event, for its approvers
   (config/approvals; with none named, nobody reads other people's conversations here — the History has a line
   for each exchange). */
function handleChatHistory(req, res) {
  withAdmin(req, res, function (fb, decoded) {
    var q = queryOf(req), eventId = String(q.get('eventId') || '').trim();
    if (!isEventId(eventId)) return sendJson(res, 400, { error: 'eventId is required.' });
    /* One conversation per person per event, both brains (ai-everywhere plan §4d): brain 'edit' (the editor's own
       turns, and every turn from before) or 'dash' (a question the events side answered here, lib/dash-bot.js),
       which the panel replays with its own parts, list and action. */
    function shape(t) {
      var out = { id: t.id, question: t.question, answer: t.answer, kind: t.kind, status: t.status, done: t.done || [], notDone: t.notDone || [], focus: t.focus || '', pictures: t.pictures || 0, at: t.at,
        brain: t.brain === 'dash' ? 'dash' : t.brain === 'promo' ? 'promo' : 'edit' };
      /* the post and mailer editors' ETB2B AI (lib/promo-ai.js): which editor, and the short label of what was asked */
      if (out.brain === 'promo') { out.editor = t.editor === 'mail' ? 'mail' : 'post'; out.intent = String(t.intent || ''); }
      if (out.brain === 'dash') {
        var a = t.action && typeof t.action === 'object' ? t.action : null;
        out.parts = Array.isArray(t.parts) ? t.parts : [];
        out.list = t.list || null;
        out.asOf = t.asOf || '';
        out.dashKind = t.dashKind || 'reply';
        out.action = a ? Object.assign({ type: String(a.type || ''), label: String(a.label || '') }, a.url ? { url: String(a.url) } : {}, a.what ? { what: String(a.what) } : {}) : null;
        /* what the page said became of it ("added 10 speakers"), for the replay */
        if (t.note) out.note = String(t.note).slice(0, 300);
        out.attachments = (Array.isArray(t.attachments) ? t.attachments : []).map(function (x) { return { name: String((x && x.name) || ''), kind: String((x && x.kind) || ''), role: String((x && x.role) || 'none') }; });
      }
      if (t.goTo) out.goTo = t.goTo;
      /* a new picture the AI was asked for: the editor draws a made one again, and offers one that was made
         but never placed (the tab was closed) to be put in the tray */
      var np = chatPicture.historyFields(t.newPicture);
      if (np) out.newPicture = np;
      return out;
    }
    /* the event's name for the panel's scope line ("This event: …"): one read, the name only */
    function eventOf() {
      return eventDocRef(fb, eventId).get().then(function (snap) {
        var d = snap.exists ? (snap.data() || {}) : {};
        return { id: eventId, name: String(d.name || '').replace(/\s+/g, ' ').trim().slice(0, 200) };
      }, function () { return { id: eventId, name: '' }; });
    }
    if (q.get('all') !== '1') {
      return Promise.all([chatTurnsFor(fb, eventId, chatUid(decoded), 60), eventOf()]).then(function (got) { sendJson(res, 200, { event: got[1], turns: got[0].map(shape) }); })
        .catch(function (err) { sendFailure(res, 'chat history', err, 'The conversation could not be loaded.'); });
    }
    approvalsConfig(fb).then(function (cfg) {
      var me = String(decoded.email || '').toLowerCase();
      if (!cfg.approvers.length || cfg.approvers.indexOf(me) === -1) return sendJson(res, 403, { error: 'Only the event approvers can read everyone\'s conversations.', code: 'not-approver' });
      return eventDocRef(fb, eventId).collection('aiChats').get().then(function (snap) {
        return Promise.all(snap.docs.map(function (d) {
          var who = d.data() || {};
          return d.ref.collection('turns').orderBy('at', 'desc').limit(200).get().then(function (ts) {
            return { uid: who.uid || d.id, email: who.email || '', name: who.name || who.email || d.id, lastAt: who.lastAt || '',
              turns: ts.docs.map(function (x) { return shape(Object.assign({ id: x.id }, x.data())); }).reverse() };
          });
        }));
      }).then(function (people) {
        people.sort(function (a, b) { return String(b.lastAt).localeCompare(String(a.lastAt)); });
        sendJson(res, 200, { people: people });
      });
    }).catch(function (err) { sendFailure(res, 'chat history', err, 'The conversations could not be loaded.'); });
  });
}

module.exports = { wire, handleChatEdit, handleChatTurn, handleChatHistory, handleDocPictures };
/* what lib/api.js's _testHooks hands the tests and tools/ from this file (read there on first use) */
module.exports._testHooks = { buildChatPrompt, chatView, chatLastPicture, chatHistoryText, chatResponseSchema, chatPageFacts, chatYesAnswer };
