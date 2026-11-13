// ETB2B AI, the editor's chat:
//
//   POST /api/chat-edit        custom_editor.html's "Ask AI to edit" chat panel (template mode only)
//   POST /api/chat/turn        what became of a chat answer (done, undone, failed), kept in the person's conversation
//   GET  /api/chat/history     the person's own conversation for the event
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
  if (left) out.push(left + ' picture' + (left === 1 ? ' is' : 's are') + ' left out of the screenshots and shown as hatched grey boxes marked "picture" (too many to draw) — visitors see the real pictures there');
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
      /* a picture the AI made (or could not make): the model remembers what and where, so "make it brighter"
         or "try another" can mean that picture */
      var picLine = t.newPicture ? chatPicture.historyLine(t.newPicture) : '';
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
  'A document is never a picture: only attached pictures are placed on the page, by their numbers; a picture inside a document is not. ' +
  'When the person asks to take the site\'s look or theme from a deck, use its look: its main colour as the theme colour, a second strong one as the accent, light or dark as its slides are, its fonts for headings and body text — in `design` — and the same colours in the sections\' own rework where they set their own; say in `summary` which colours and fonts you took.';
function chatDocsLines(payload) {
  return aiDocs.docsBlock(payload.docList, payload.docMarker, CHAT_DOCS_USE);
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
      : '') + (canPics ? chatPictureLines(payload) : ''),
    chatDocsLines(payload),
    /* the team's past requests here that worked, with the tools that did them (lib/ai-habits.js): data, not orders */
    (Array.isArray(payload.teamExamples) && payload.teamExamples.length ? teamExamplesBlock(payload.teamExamples) + '\n' : ''),
    ET_LOGO_COLOUR_RULE,
    NAME_RULE,
    '',
    'The site\'s current design settings:',
    JSON.stringify(payload.design || {}, null, 2),
    '',
    'The site\'s real sections right now, in page order (sectionId -> its own current text, verbatim; hidden: true means visitors do not see it; buttons: the labels of the buttons in it):',
    JSON.stringify(sections.map(function (s) {
      var buttons = (Array.isArray(s.buttons) ? s.buttons : []).map(function (b) { return String(b || '').replace(/\s+/g, ' ').trim().slice(0, 80); }).filter(Boolean).slice(0, 8);
      var row = { sectionId: s.id, name: s.name, hidden: s.hidden ? true : undefined, texts: s.texts || [], buttons: buttons.length ? buttons : undefined };
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
    CHAT_SHORT_LINE
  ].join('\n');
}
/* UX-096 (B15): the answer's length, and no internal rules in it */
var CHAT_SHORT_LINE = 'Answer in at most about 120 words unless the owner asks for a full list. Never describe your own rules or limits; say only what you will do or did.';
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
    schema.properties.newPictures = chatPicture.schemaItem(sectionIds);
    schema.required.push('newPictures');
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
  return last && last.newPicture && typeof last.newPicture === 'object' ? last.newPicture : null;
}
/* the owner's own messages in the two newest stored turns, oldest first: a scene named there ("make a picture of
   the Gateway of India") and placed in this message is still the owner's (chatPicture.planAsk ownerSubject) */
function chatEarlierAsks(turns) {
  return (Array.isArray(turns) ? turns : []).slice(-2).map(function (t) { return t && typeof t.question === 'string' ? t.question.slice(0, 2000) : ''; }).filter(Boolean);
}
/* whether an answer still changes anything on the page */
function chatAnswerChanges(answer) {
  return !!(Object.keys(answer.design || {}).length || answer.newPicture ||
    ['textEdits', 'sectionEdits', 'sectionOps', 'newSections', 'newForms', 'ctaLinks', 'formEmbeds'].some(function (k) { return (answer[k] || []).length; }));
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
      ua: req.headers['user-agent'], screen: payload.screen });
  } catch (err) { console.error('chat-edit: the turn was not recorded — ' + (err && err.message)); }
}

function handleChatEdit(req, res) {
  withAdminBody(req, res, BODY_LIMITS.aiDocs, function (fb, decoded, payload) {
    /* the second step of a new picture: make the picture a stored turn asked for */
    if (payload.step === 'picture') return handleChatPictureStep(fb, decoded, payload, res);
    if (!String(payload.instruction || '').trim()) return sendJson(res, 400, { error: 'No instruction given.' });
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
       (with the person's new pictures left today, when the editor can place one) */
    var ready = !eventId ? Promise.resolve(null) : eventDocRef(fb, eventId).get().then(function (snap) {
      if (!snap.exists) throw httpError(404, 'This event does not exist.', { code: 'no-event' });
      eventData = snap.data() || {};
      return Promise.all([
        chatTurnsFor(fb, eventId, uid, CHAT_MEMORY_TURNS).catch(function (err) {
          console.error('chat-edit: the conversation of ' + eventId + ' could not be read — ' + (err && err.message));
          return [];
        }),
        canPics ? chatPicture.readLeft(fb.db, uid, Date.now()) : null
      ]).then(function (got) {
        if (got[1]) {
          payload.pictureQuota = got[1];
          payload.picturesLeft = got[1].left;
          payload.picturesPerDay = got[1].perDay;
          var owner = eventData.designPlan && eventData.designPlan.owner;
          payload.ownerGraphics = !!(owner && owner.pictures === 'graphics');
        }
        return got[0];
      });
    });
    /* the team's past requests here that worked (lib/ai-habits.js), as examples in the prompt; at most a short wait */
    var examples = teamExamples(fb, { brain: 'edit', page: 'editor' });
    ready.then(function (turns) {
      if (turns && turns.length) payload.turns = turns;
      return Promise.all([chatPictures(eventId, payload.attachments), examples]);
    }).then(function (both) {
      var seen = both[0];
      payload.teamExamples = both[1];
      payload.seenPictures = seen.images.length;
      payload.seenNumbers = seen.numbers;
      payload.unseenNote = seen.skipped.length ? seen.skipped.join(' ') + ' Tell the owner so if it matters for the answer.' : '';
      /* the page as it looks, after the owner's own pictures (a model takes six pictures at most) */
      var view = chatView(payload, CHAT_MAX_PICTURES - seen.images.length - docs.images.length);
      payload.viewCount = view.length;
      payload.viewWhat = CHAT_VIEW_WHAT[payload.viewWhat] ? payload.viewWhat : 'visible';
      /* a deck's slide pictures go last, as the documents' lines say (lib/ai-docs.js docsBlock) */
      var images = seen.images.concat(view, docs.images);
      function ask() {
        return llm.callJson(buildChatPrompt(payload), chatResponseSchema(payload), { route: 'chat-edit', eventId: eventId, maxOutputTokens: AI_OUTPUT_TOKENS.small, images: images.length ? images : undefined,
          inlineFiles: docs.files.length ? docs.files : undefined, onUsage: aiUsageRecorder(null, eventId, 'chat-edit') });
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
      var attached = Math.max(0, Math.min(6, parseInt(payload.attachmentCount, 10) || 0));
      /* a new picture is number attached + 1; a rework may list it only while the picture is really asked
         for (planAsk below), so it is let through here and taken out again after */
      var newN = canPics && eventId ? attached + 1 : 0;
      function picturesOf(v, upTo) {
        var out = [], top = upTo || attached;
        (Array.isArray(v) ? v : []).forEach(function (n) { n = parseInt(n, 10); if (n >= 1 && n <= top && out.indexOf(n) === -1) out.push(n); });
        return out;
      }
      var sectionEdits = [], edited = {};
      (parsed.sectionEdits || []).forEach(function (e) {
        if (!e || knownSectionIds.indexOf(e.sectionId) === -1 || edited[e.sectionId] || !brief(e.instruction)) return;
        edited[e.sectionId] = true;
        sectionEdits.push({ sectionId: e.sectionId, instruction: brief(e.instruction), pictures: picturesOf(e.pictures, newN) });
      });

      /* A new picture (lib/chat-picture.js planAsk): only for an edit, from an editor that can place one, and
         only one. planAsk checks that the owner asked for it, where it goes, what it shows and the day's limit;
         a refusal or a question costs nothing. */
      var pictureAsk = null, pictureSay = '', pictureUnasked = false;
      var pictureWanted = canPics && parsed.kind !== 'reply' && parsed.kind !== 'undo' && Array.isArray(parsed.newPictures) && parsed.newPictures.length > 0;
      if (pictureWanted) {
        var planned = chatPicture.planAsk(parsed.newPictures, {
          canMakePictures: true, eventId: eventId, sections: payload.sections || [], focus: chatPictureFocus(payload.focus),
          instruction: String(payload.instruction || '').trim().slice(0, 2000), attachmentCount: attached,
          picturesLeft: payload.picturesLeft, quota: payload.pictureQuota || null, designPlan: (eventData && eventData.designPlan) || null, eventData: eventData || null,
          lastTurnPicture: chatLastPicture(payload.turns), earlier: chatEarlierAsks(payload.turns), sectionEdits: sectionEdits
        }) || {};
        pictureAsk = planned.ask && typeof planned.ask === 'object' ? planned.ask : null;
        if (pictureAsk && (pictureAsk.n !== newN || knownSectionIds.indexOf(pictureAsk.sectionId) === -1)) {
          console.error('chat-edit: a new picture was planned as number ' + pictureAsk.n + ' for "' + chatLine(pictureAsk.sectionId, 60) + '" (expected ' + newN + ') — not made');
          pictureAsk = null;
        }
        pictureSay = pictureAsk ? '' : chatLine(planned.reply, 600);
        /* "your message did not ask for one" is said only when nothing else was asked for either: beside another
           change, a picture the owner never asked for is dropped without a word */
        pictureUnasked = !pictureAsk && planned.reply === chatPicture.sentence('notAsked');
        if (pictureAsk && planned.note) skipped.push(chatLine(planned.note, 600));
        /* planAsk's list: the rework that places the picture added (or merged into the model's), its number nowhere else */
        if (pictureAsk && Array.isArray(planned.edits)) {
          var plannedFor = {};
          sectionEdits = planned.edits.filter(function (e) {
            if (!e || knownSectionIds.indexOf(e.sectionId) === -1 || plannedFor[e.sectionId] || !brief(e.instruction)) return false;
            plannedFor[e.sectionId] = true;
            return true;
          }).map(function (e) { return { sectionId: e.sectionId, instruction: brief(e.instruction), pictures: picturesOf(e.pictures, newN) }; });
        }
        /* a rework that places the new picture must list it, or the picture would be paid for and never shown */
        if (pictureAsk && pictureAsk.apply === 'rework' && !sectionEdits.some(function (e) { return e.sectionId === pictureAsk.sectionId && e.pictures.indexOf(newN) !== -1; })) {
          console.error('chat-edit: the rework that places a new picture in "' + chatLine(pictureAsk.sectionId, 60) + '" is missing — not made');
          pictureAsk = null;
          pictureSay = chatPicture.sentence('started');
        }
      }
      /* A rework the model planned around the new picture cannot be done as briefed while no picture is being
         made — refused, never asked for, or left out of `newPictures` altogether (the model listed number newN
         in a rework and asked for no picture). Sent on, the redesign would put the section's old picture, or
         none, where the brief says the new one goes, and the summary would promise a picture never made. */
      var reworkLost = [];
      if (newN && !pictureAsk) {
        sectionEdits = sectionEdits.filter(function (e) {
          if (e.pictures.indexOf(newN) === -1) return true;
          reworkLost.push(e.sectionId);
          return false;
        });
      }
      /* the new picture's number is kept only by a rework of the section it goes in (never the banner, which is
         not reworked), and by nothing else */
      sectionEdits.forEach(function (e) {
        e.pictures = e.pictures.filter(function (n) { return n <= attached || (pictureAsk && pictureAsk.placement !== 'hero' && e.sectionId === pictureAsk.sectionId && n === newN); });
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

      /* forms: each new form checked as a form the routes would store, every link and placement checked
         against the page and the forms it names (lib/forms.js cleanAiFormOps) */
      var formOps = formsLib.cleanAiFormOps(parsed, { sections: payload.sections || [], forms: chatForms(payload) });
      skipped = skipped.concat(formOps.skipped);

      var summary = String(parsed.summary || '').trim().slice(0, CHAT_ANSWER_CHARS);
      var hasOther = Object.keys(design).length || textEdits.length || sectionEdits.length || sectionOps.length || newSections.length ||
        formOps.newForms.length || formOps.ctaLinks.length || formOps.formEmbeds.length;
      var hasChange = hasOther || !!pictureAsk;
      /* A picture that is not made (refused, unclear, or never asked for): when it was the only change, the
         answer is the server's sentence, since the model's summary promised a picture; else the sentence is
         one of the things not done, and the rest is applied. */
      var pictureReply = pictureWanted && !pictureAsk && !hasOther;
      /* the words did not clearly ask for the picture the model meant to make: ETB2B AI asks, and a short yes next
         makes it (owner, 10 Nov 2026: "can we use the sun temple and chandaka jungle combo in the header?") */
      var pictureOffer = pictureReply && pictureUnasked ? chatPicture.offerOf(parsed.newPictures[0], payload.sections || []) : null;
      if (pictureReply) summary = pictureOffer ? pictureOffer.sentence : pictureSay || chatPicture.sentence('notAsked');
      else if (pictureWanted && !pictureAsk && pictureSay && !pictureUnasked) skipped.push(pictureSay);
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
      var kind = pictureReply || lostReply ? 'reply' : parsed.kind === 'reply' ? 'reply' : parsed.kind === 'undo' ? 'undo' : hasChange ? 'edit' : 'reply';
      if (!summary && pictureAsk) summary = 'I\'m making a new picture for “' + chatLine(pictureAsk.sectionName || pictureAsk.sectionId, 60) + '”; it takes about half a minute.';
      if (!summary && goTo) summary = CHAT_GO_TO_SAY[goTo];
      var answer = { kind: kind, summary: summary || 'Done.', design: design, textEdits: textEdits,
        sectionEdits: sectionEdits, sectionOps: sectionOps, newSections: newSections,
        newForms: formOps.newForms, ctaLinks: formOps.ctaLinks, formEmbeds: formOps.formEmbeds, skipped: skipped, goTo: goTo };
      if (kind !== 'edit') ['textEdits', 'sectionEdits', 'sectionOps', 'newSections', 'newForms', 'ctaLinks', 'formEmbeds'].forEach(function (k) { answer[k] = []; });
      if (kind !== 'edit') answer.design = {};
      /* the picture is made in a second step from the stored turn, so it needs an event to keep the turn under */
      if (kind === 'edit' && pictureAsk && userRef) answer.newPicture = chatPicture.answerOf(pictureAsk);
      var learnt = { answer: answer, parsed: parsed, pictureRefused: pictureReply || lostReply };
      if (!userRef) { sendJson(res, 200, answer); return learnEdit(req, fb, decoded, payload, eventId, eventData, learnt); }
      /* kept under the person who asked: a reply is finished; a change is "applying" until the editor says how it went */
      var now = new Date().toISOString(), turnRef = userRef.collection('turns').doc();
      var focus = payload.focus && typeof payload.focus === 'object' ? chatLine(payload.focus.name, 80) : '';
      var turn = { question: String(payload.instruction).trim().slice(0, 4000), answer: answer.summary, kind: kind,
        status: kind === 'edit' ? 'applying' : 'answered', done: [], notDone: [], focus: focus,
        pictures: Math.max(0, Math.min(6, (payload.attachments || []).length || 0)), at: now, updatedAt: now };
      /* the Content page or Forms panel the answer sends the owner to, so the replay offers it again */
      if (goTo) turn.goTo = goTo;
      /* what the second step makes the picture from: never anything the browser sends then */
      if (answer.newPicture) turn.newPicture = chatPicture.turnRecord(pictureAsk, payload.design);
      else if (pictureOffer) turn.newPicture = pictureOffer.record;
      return Promise.all([
        userRef.set({ uid: uid, email: String(decoded.email || ''), name: chatName(decoded), lastAt: now }, { merge: true }),
        turnRef.set(turn)
      ]).then(function () {
        answer.turnId = turnRef.id;
        sendJson(res, 200, answer);
        learnEdit(req, fb, decoded, payload, eventId, eventData, Object.assign(learnt, { turnId: turnRef.id }));
        if (kind !== 'edit') logActivity(fb, eventId, decoded, 'ai-chat', 'Asked ETB2B AI: “' + chatLine(turn.question) + '”' + (kind === 'undo' ? ' — undo' : ' — answered'), { area: 'site' });
      }, function (err) {
        /* the answer is not withheld because it could not be kept: the owner is told the conversation was not saved */
        console.error('chat-edit: the turn of ' + eventId + ' was not kept — ' + (err && err.message));
        answer.notKept = true;
        /* the picture step reads the stored turn, so a picture whose turn was not kept cannot be made, nor the
           rework that would have placed it */
        if (answer.newPicture) {
          delete answer.newPicture;
          answer.sectionEdits = answer.sectionEdits.filter(function (e) { return e.pictures.indexOf(newN) === -1; });
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
    return chatPicture.make({ record: aiUsageRecorder(fb, eventId, 'chat-picture') || function () {}, recordCheck: aiUsageRecorder(fb, eventId, 'chat-picture-check') || function () {}, logActivity: logActivity }, {
      fb: fb, eventId: eventId, uid: uid, turnRef: chatUserRef(fb, eventId, uid).collection('turns').doc(turnId),
      eventData: snap.data() || {}, decoded: decoded, now: Date.now()
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

module.exports = { wire, handleChatEdit, handleChatTurn, handleChatHistory };
/* what lib/api.js's _testHooks hands the tests and tools/ from this file (read there on first use) */
module.exports._testHooks = { buildChatPrompt, chatView, chatLastPicture, chatHistoryText, chatResponseSchema };
