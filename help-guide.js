/* help-guide.js — "Getting started": how an event goes from Create Event to a live site, in plain steps, with
   where each thing is (NU-007, the first-time-user QA of 14 Nov 2026: a newcomer had no guide at all, only an
   e-mail to Customer Care).

   ONE GUIDE, TWO READERS. The events dashboard (Event_Listing.html) loads this file and shows the guide in its Help
   window (window.RevampHelpGuide). The server (functions/lib/dash-bot.js) requires it, and ETB2B AI answers a how-to
   question ("how do I create an event?", "how do I add speakers?", "how do I publish?") with one topic of it, word
   for word: the model only picks the topic, it never writes the steps, so what ETB2B AI says is what the Help
   window says, and both say what the screens say.

   The button and menu names are written in **bold**, exactly as the screens write them. functions/lib/help-guide.test.js
   checks that every bold name is still written in the app's own pages and scripts, so a renamed button fails the
   tests until the guide says the new name.

   No event, person, number or address of anyone's data is in here: a how-to answer is not event data, so ETB2B AI
   may give it on any page, inside an event too (owner decision 10 is about events' data).

     RevampHelpGuide.TITLE, .INTRO
     RevampHelpGuide.STEPS          [{ id, title, where, text }]   the Getting started steps, in order
     RevampHelpGuide.TOPICS         [{ id, title, ask, steps: [text] }]   what ETB2B AI answers with
     RevampHelpGuide.topic(id)      -> a topic, or null
     RevampHelpGuide.answerText(id) -> the topic as ETB2B AI shows it ("**title**", then "1. …" lines), or ''
     RevampHelpGuide.plain(text)    -> the text without its ** marks

   ES5 on purpose (var, function): the dashboard serves it as it is, with no build step. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.RevampHelpGuide = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var TITLE = 'Getting started';
  var INTRO = 'How an event goes from an idea to a live website, and where each step is.';

  /* the whole journey, in order; "where" is the screen the step happens on */
  var STEPS = [
    { id: 'create', title: 'Create the event', where: 'Events dashboard',
      text: 'Press **Create Event** at the top right of the events dashboard. Choose the portal the event belongs to, then its microsite type.' },
    { id: 'build', title: 'Choose how to build the site', where: 'Create Event',
      text: 'Pick **Generate from brief** (ETB2B AI writes the site from your overview document and links), **Choose a previous edition**, **Import from Lovable**, or a design from the templates with **Use this template**. Fill in the event details and press **Review and create**, check the summary, then **Create event** (**Generate my site** for a brief). The event is saved and the site editor opens.' },
    { id: 'design', title: 'Design the site', where: 'Site editor',
      text: 'With **Edit myself**, click any text, picture or section on the page to change it. With **Edit with AI**, ask ETB2B AI for the change instead. Press **Save** to keep your changes: nothing goes live yet. To come back later, press the pencil (**Edit site**) on the event’s row on the dashboard.' },
    { id: 'content', title: 'Add speakers, agenda and sponsors', where: 'Event console',
      text: 'Click the event’s name on the dashboard to open its console. **Speakers**, **Agenda** and **Sponsors** are in the left rail, with **Add speakers**, **Add sessions** and **Add sponsors**. The dates, venue, gallery, FAQ and contact details are under **Content**, and the registration form under **Settings**.' },
    { id: 'preview', title: 'Check it', where: 'Console or site editor, top right',
      text: '**Preview** opens the site as it was last saved, in a new tab. The small arrow beside it has **Share preview link…**: a 7-day link for people without an ETB2B login.' },
    { id: 'approval', title: 'Send it for approval', where: 'Console or site editor, top right',
      text: 'Press **Send for approval…**. Copy the review link with **Copy link** or **Copy message** and send it to an approver yourself: EventSphere does not e-mail them.' },
    { id: 'live', title: 'Go live', where: 'Review page',
      text: 'The approver opens the link and presses **Approve and publish**, or **Reject** with a reason (nobody approves their own changes). Once it is approved the site is live and the event’s tag says **Live**. Later changes go live the same way: save them, then **Send for approval…** again.' }
  ];

  /* What ETB2B AI answers a how-to question with. "ask" is for the model only: the kind of question the topic answers.
     Each step is one line of the answer. */
  var TOPICS = [
    { id: 'start', title: 'How an event goes live',
      ask: 'how EventSphere works, what to do first, how to create and publish an event from start to finish',
      steps: [
        '**Create Event** on the events dashboard: choose the portal and the microsite type.',
        'Choose how to build the site (**Generate from brief**, a previous edition, a Lovable design or **Use this template**), fill in the details and press **Review and create**, check the summary, then **Create event**. The site editor opens.',
        'Change the page with **Edit myself** or **Edit with AI**, and press **Save**.',
        'Open the event’s console (click its name on the dashboard) to add **Speakers**, **Agenda** and **Sponsors**.',
        'Check it with **Preview**, at the top right.',
        'Press **Send for approval…** and send the review link to an approver yourself.',
        'The approver presses **Approve and publish**: the site is live.'
      ] },
    { id: 'create', title: 'How to create an event',
      ask: 'how to create, start or set up a new event or microsite',
      steps: [
        'Press **Create Event** at the top right of the events dashboard.',
        'Choose the portal the event belongs to, then its microsite type.',
        'Pick how to build it: **Generate from brief** (ETB2B AI writes it from your overview document and links), **Choose a previous edition**, **Import from Lovable**, or a template with **Use this template**.',
        'Fill in the event details and press **Review and create**, check the summary, then **Create event** (**Generate my site** for a brief). The event is saved and the site editor opens.',
        'A Create Event you leave halfway waits under **Drafts** on the dashboard, with **Resume**.'
      ] },
    { id: 'design', title: 'How to change the site’s design and words',
      ask: 'how to edit, design or change the website, its words, pictures, colours or sections',
      steps: [
        'Open the site editor: the pencil (**Edit site**) on the event’s row on the dashboard, or **Site editor** in the event’s left rail.',
        'With **Edit myself**, click any text, picture or section on the page to change it.',
        'With **Edit with AI**, ask ETB2B AI for the change instead. You can switch between the two at any time.',
        'Press **Save** to keep your changes. Nothing goes live until it is approved.'
      ] },
    { id: 'content', title: 'How to add speakers, agenda and sponsors',
      ask: 'how to add or change speakers, the agenda, sessions, sponsors, partners, the gallery, FAQ, contact details, dates or venue',
      steps: [
        'Click the event’s name on the dashboard to open its console.',
        '**Speakers**, **Agenda** and **Sponsors** are in the left rail. Press **Add speakers**, **Add sessions** or **Add sponsors**.',
        'For many speakers at once, use **Paste a list** (rows from a sheet) and **Add photos**. Inside the event you can also ask ETB2B AI to add the speakers or sponsors from a brochure.',
        'The dates, venue, gallery, FAQ and contact details are under **Content**.',
        'On a site that is already live, what you add goes live once it is approved.'
      ] },
    { id: 'preview', title: 'How to preview the site and share a preview',
      ask: 'how to preview, check or see the site before it is live, or share a preview with someone',
      steps: [
        'Press **Preview** at the top right of the event’s console or the site editor: the site opens as it was last saved, in a new tab.',
        'To show it to someone without an ETB2B login, press the small arrow beside **Preview**, then **Share preview link…**. The link works for 7 days.'
      ] },
    { id: 'approval', title: 'How to publish the site',
      ask: 'how to publish, send for approval, get approval, go live, or who approves',
      steps: [
        'Save your changes, then press **Send for approval…** at the top right of the event’s console or the site editor.',
        'Copy the review link with **Copy link** or **Copy message** and send it to an approver yourself: EventSphere does not e-mail them.',
        'The approver opens the link and presses **Approve and publish**, or **Reject** with a reason. Nobody approves their own changes.',
        'Once approved, the site is live and the event’s tag says **Live**. Who the approvers are is under your initials at the top right, **Access & settings**.'
      ] },
    { id: 'live-changes', title: 'How to change a site that is already live',
      ask: 'how to change, update or correct a site that is already live or published',
      steps: [
        'Make the change as before, in the site editor or the event’s console, and save it.',
        'The live site keeps the approved version for now: the event’s tag says **Newer changes not published**.',
        'Press **Send for approval…** again. The change goes live once an approver presses **Approve and publish**.'
      ] },
    { id: 'registrations', title: 'How registrations work',
      ask: 'how to set up the registration form, or where to see who registered',
      steps: [
        'Set up the form in the event’s console: **Settings**, then **Registration forms** (**Create custom form**, or **From template**).',
        'The people who registered are under **Reporting** in the event’s left rail.'
      ] },
    { id: 'promotions', title: 'How to make posts and mailers',
      ask: 'how to make social media posts, mailers, e-mails or promotions for an event',
      steps: [
        'Open the event, then **Promotions** in its left rail: **Social posts**, **Site-look posts** and **Mailers**, made from the event’s own details.',
        'Change one, then **Download** it (a mailer can also be copied with **Copy HTML**) and post or send it yourself. Sending from EventSphere is not available yet.'
      ] },
    { id: 'portal', title: 'How portals work',
      ask: 'how to change or switch the portal, or why an event is not in the list',
      steps: [
        'Every event belongs to one ETB2B portal, and the events dashboard shows one portal at a time.',
        'Switch it with the portal button at the top of the dashboard, beside **Help** (on a phone, under **Filters**). Choose **All portals** to see every event.',
        'Create Event starts on the portal you are working on.'
      ] },
    { id: 'find', title: 'How to find and open an event',
      ask: 'how to find, search for or open an event',
      steps: [
        'Type in **Search events…** on the dashboard, or use its tabs: **Drafts**, **Upcoming**, **Active** and **Completed**.',
        'Click an event’s name to open its console. The pencil (**Edit site**) opens its site editor, and the eye its **Preview**.',
        'Not there? It may be on another portal: choose **All portals**.'
      ] },
    { id: 'support', title: 'How to get more help',
      ask: 'how to contact support, customer care or a person',
      steps: [
        'Press **Help** at the top of the events dashboard for this guide.',
        'Still stuck? Press **Email Customer Care**, in the Help window or at the top of this panel, and send your question from your own e-mail.'
      ] }
  ];

  function topic(id) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].id === id) return TOPICS[i];
    return null;
  }
  /* the topic as ETB2B AI's bubble shows it: the chat kit draws "**…**" as bold and "1. " lines as a numbered list */
  function answerText(id) {
    var t = topic(id);
    if (!t) return '';
    var lines = ['**' + t.title + '**'];
    for (var i = 0; i < t.steps.length; i++) lines.push((i + 1) + '. ' + t.steps[i]);
    return lines.join('\n');
  }
  function plain(s) { return String(s == null ? '' : s).replace(/\*\*/g, ''); }

  return { TITLE: TITLE, INTRO: INTRO, STEPS: STEPS, TOPICS: TOPICS, topic: topic, answerText: answerText, plain: plain };
});
