/* activity-words.js — how both activity logs say what happened (UX-015).

   The all-events Activity log (activity-log.html, from the dashboard) and an event's own Activity log (the
   console, edit-event.html #activity) read the same entries (lib/activity.js writes them) and now say them in the
   same words, from this one file:

     RevampActivityWords.AREAS                  [[id, label]] in the order both filters list them
     RevampActivityWords.areaLabel(id)          'Content'
     RevampActivityWords.actionLabel(action, area, detail)
                                                'Event created', 'Site saved', 'Mailer saved', 'Social post layout
                                                reset' (an action the table does not know is turned into words,
                                                never shown as its code)
     RevampActivityWords.isPlatform(by)         true for the platform's own changes
     RevampActivityWords.personName(by)         'Sachitanand Rai' for sachitanand.rai@timesinternet.in, 'Platform
                                                (automated)' for the platform; the address itself goes on hover
     RevampActivityWords.fieldLabel(key)        'Template' for templateId, 'Logo' for logoUrl, 'Start' for start
     RevampActivityWords.sectionLabel(id)       'FAQs' for faqs, 'Speakers' for speakers
     RevampActivityWords.detailText(entry)      the entry's detail, with its field keys said as labels

   The logs used to show the action's code under each sentence ("content-added", "site-saved"), whole e-mail
   addresses that wrapped mid-word, and field keys ("templateId", "logoUrl"). The codes are still in each log's CSV.

   ES5 on purpose (var, function, no arrows): the pages serve it as it is, with no build step; node's tests require
   it (functions/lib/events-dashboard-b11.test.js, the UX-015 checks). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.RevampActivityWords = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* the order both logs' Area filters list them in */
  var AREAS = [['site', 'Site'], ['content', 'Content'], ['forms', 'Forms'], ['design', 'Design'], ['publishing', 'Publishing'],
    ['registrations', 'Registrations'], ['promotions', 'Promotions'], ['settings', 'Settings'], ['event', 'Event']];

  /* what each recorded action was, in words (the console's table, which the all-events log now shares). 'updated'
     is a Basics edit: the event's name, dates, venue, template, logo… */
  var ACTIONS = {
    'created': 'Event created', 'updated': 'Basic details changed', 'status-changed': 'Status changed', 'settings-changed': 'Settings changed',
    'site-saved': 'Site saved', 'approval-requested': 'Sent for approval', 'approved': 'Approved', 'rejected': 'Rejected',
    'published': 'Published (live)', 'unpublished': 'Taken offline', 'deleted': 'Event deleted', 'restored': 'Event restored',
    'cloned': 'Event copied', 'content-seeded': 'Content filled in', 'content-added': 'Content added', 'content-changed': 'Content changed',
    'content-removed': 'Content removed', 'registration-updated': 'Registration changed', 'registration-deleted': 'Registration deleted',
    'registration-approved': 'Registration approved', 'registration-declined': 'Registration declined',
    'leads-imported': 'Leads imported', 'leads-updated': 'Leads changed', 'leads-deleted': 'Leads deleted',
    'form-created': 'Form created', 'form-updated': 'Form edited', 'form-deleted': 'Form deleted', 'form-default': 'Default form changed',
    'forms-reordered': 'Forms reordered', 'theme-changed': 'Look changed', 'logo-changed': 'Logo changed',
    'banner-video-changed': 'Banner video changed', 'file-uploaded': 'File uploaded', 'brief-updated': 'Brief updated',
    'source-added': 'Source added', 'site-designed': 'Site designed by AI', 'site-generated': 'Site written by AI',
    'repaired': 'Platform repair', 'ai-chat': 'ETB2B AI', 'portal-set': 'Portal set',
    'preview-link-shared': 'Preview link shared', 'preview-link-stopped': 'Preview link stopped'
  };
  /* Promotions records with the general verbs (created / updated / deleted, area 'promotions'), which are not an
     event being created or deleted, and two parts of it share them: its mailers (lib/promo-mailer.js) and its social
     posts (lib/promo-social.js). Only the entry's detail tells them apart: a mailer's names the mailer ("Mailer “A”
     (Invite) saved", "2 versions of the Invite mailer deleted"), and a social post's begins "Post art", "Post
     picture" or "Post layout". Calling every one a mailer read "Mailer deleted — Post layout reset: Square · 1:1"
     when no mailer was touched. */
  var MAILER_ACTIONS = { 'created': 'Mailer saved', 'updated': 'Mailer changed', 'deleted': 'Mailer deleted' };
  /* a social post's part (the detail's first words), then its verb: art and pictures are uploaded ('updated') or
     removed ('deleted', also when a new PSD clears them); a layout is saved or reset to the platform's */
  var POST_ACTIONS = {
    'Post art': { 'updated': 'Social post art added', 'deleted': 'Social post art removed' },
    'Post picture': { 'updated': 'Social post picture added', 'deleted': 'Social post picture removed' },
    'Post layout': { 'updated': 'Social post layout saved', 'deleted': 'Social post layout reset' },
    /* "Use for all posts" (UX-129): the background every social post of the event starts on */
    'Post background': { 'updated': 'Social post background set' }
  };
  var POST_OTHER = { 'created': 'Social post saved', 'updated': 'Social post changed', 'deleted': 'Social post removed' };
  /* a Promotions entry whose detail names neither (none is written today): said as Promotions', not as a mailer's */
  var PROMOTIONS_OTHER = { 'created': 'Saved in Promotions', 'updated': 'Changed in Promotions', 'deleted': 'Removed from Promotions' };
  /* and the AI's description of the event, written with the site's design (area 'event') */
  var EVENT_AREA_ACTIONS = { 'updated': 'Description written' };

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function words(s) {
    s = String(s == null ? '' : s).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function areaLabel(id) {
    for (var i = 0; i < AREAS.length; i++) if (AREAS[i][0] === id) return AREAS[i][1];
    return 'Event';
  }

  /* a Promotions entry's words, from its verb and its detail (see MAILER_ACTIONS above); '' when the verb is not one
     of the three, which the general table then says */
  function promotionsLabel(a, detail) {
    var d = String(detail == null ? '' : detail).trim();
    if (/^Post /.test(d)) {
      for (var part in POST_ACTIONS) {
        if (own(POST_ACTIONS, part) && d.indexOf(part) === 0 && own(POST_ACTIONS[part], a)) return POST_ACTIONS[part][a];
      }
      return own(POST_OTHER, a) ? POST_OTHER[a] : '';
    }
    /* a picture uploaded into a mail (lib/promo-mailer.js handlePicture) is not yet a change to any saved mailer */
    if (/^Mailer picture\b/.test(d) && a === 'updated') return 'Mailer picture added';
    if (/\bmailer\b/i.test(d)) return own(MAILER_ACTIONS, a) ? MAILER_ACTIONS[a] : '';
    return own(PROMOTIONS_OTHER, a) ? PROMOTIONS_OTHER[a] : '';
  }

  /* detail: the entry's own detail, which Promotions' words need (above); every other area is said from its action */
  function actionLabel(action, area, detail) {
    var a = String(action == null ? '' : action);
    if (area === 'promotions') { var p = promotionsLabel(a, detail); if (p) return p; }
    if (area === 'event' && own(EVENT_AREA_ACTIONS, a)) return EVENT_AREA_ACTIONS[a];
    if (own(ACTIONS, a)) return ACTIONS[a];
    return words(a) || 'Change';
  }

  function isPlatform(by) { return !by || by === 'platform' || by === 'system'; }

  /* A person as the logs name them: their name, read from their company address ("sachitanand.rai@…" ->
     "Sachitanand Rai"), since the log keeps only the address. Anything that is not an address is shown as it is. */
  function personName(by) {
    if (isPlatform(by)) return 'Platform (automated)';
    var b = String(by).trim(), at = b.indexOf('@');
    if (at <= 0) return b;
    var parts = b.slice(0, at).split(/[._+-]+/).filter(function (p) { return /[a-z]/i.test(p); });
    if (!parts.length) return b;
    return parts.map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); }).join(' ');
  }

  /* The fields the server records by their keys (PUT /api/event, the Content records, the settings), in words.
     A key not listed is turned into words ("registrationLimit" -> "Registration limit"), dropping a trailing
     "url" or "id" ("photoUrl" -> "Photo"), so no key is ever shown as code. */
  var FIELDS = {
    name: 'Name', start: 'Start', end: 'End', venue: 'Venue', city: 'City', category: 'Category', client: 'Client',
    description: 'Description', templateId: 'Template', logoUrl: 'Logo', slug: 'Address', portal: 'Portal',
    dateLabel: 'Date', dateMode: 'Date type', bannerUrl: 'Banner', heroVideo: 'Banner video', themeId: 'Look',
    imageUrl: 'Picture', photoUrl: 'Photo', linkedin: 'LinkedIn', linkedinUrl: 'LinkedIn', designation: 'Designation',
    company: 'Company', bio: 'Bio', title: 'Title', question: 'Question', answer: 'Answer', caption: 'Caption',
    email: 'Email', phone: 'Phone', label: 'Label', website: 'Website', tier: 'Tier', weight: 'Order',
    seoTitle: 'SEO title', seoDescription: 'SEO description', ogImage: 'Share picture', eventNo: 'Event number',
    status: 'Status', theme: 'Look', 'section edges': 'Section edges'
  };
  function fieldLabel(key) {
    var k = String(key == null ? '' : key).trim();
    if (!k) return '';
    if (own(FIELDS, k)) return FIELDS[k];
    var spaced = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    var bits = spaced.split(' ');
    if (bits.length > 1 && (bits[bits.length - 1] === 'url' || bits[bits.length - 1] === 'id')) bits.pop();
    spaced = bits.join(' ').replace(/\bseo\b/g, 'SEO').replace(/\bai\b/g, 'AI').replace(/\bcta\b/g, 'button');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  /* a site section's id, as a save may record it when the section has no name of its own */
  var SECTIONS = {
    hero: 'Hero', about: 'About', overview: 'Overview', speakers: 'Speakers', agenda: 'Agenda', partners: 'Partners',
    sponsors: 'Sponsors', faqs: 'FAQs', faq: 'FAQs', gallery: 'Gallery', contact: 'Contact', contacts: 'Contacts',
    stats: 'Stats', testimonials: 'Testimonials', venue: 'Venue', register: 'Register', registration: 'Registration',
    footer: 'Footer', header: 'Header', nav: 'Menu', jury: 'Jury', categories: 'Categories', winners: 'Winners',
    'award-category': 'Award categories', glimpses: 'Glimpses', video: 'Video', cta: 'Call to action', page: 'Page'
  };
  function sectionLabel(id) {
    var k = String(id == null ? '' : id).trim();
    if (!k) return '';
    if (own(SECTIONS, k.toLowerCase())) return SECTIONS[k.toLowerCase()];
    return words(k.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
  }

  /* An entry's detail as the logs show it. A Basics or settings edit names the fields it changed by their keys
     ("name, templateId"), and a Content change ends with them ("speaker “Asha” — name, photoUrl"): those are said
     as labels. Every other detail is already a sentence and is shown as written. */
  function detailText(entry) {
    var e = entry || {}, d = String(e.detail == null ? '' : e.detail);
    var keys = (Array.isArray(e.fields) ? e.fields : []).map(function (f) { return f && String(f.field || ''); }).filter(Boolean);
    if (!keys.length) return d;
    var listed = keys.join(', ');
    if ((e.action === 'updated' || e.action === 'settings-changed') && d === listed) return keys.map(fieldLabel).join(', ');
    var cut = d.lastIndexOf(' — ');
    if (e.action === 'content-changed' && cut !== -1 && d.slice(cut + 3) === listed) return d.slice(0, cut + 3) + keys.map(fieldLabel).join(', ');
    return d;
  }

  return {
    AREAS: AREAS, ACTIONS: ACTIONS, areaLabel: areaLabel, actionLabel: actionLabel, isPlatform: isPlatform,
    personName: personName, fieldLabel: fieldLabel, sectionLabel: sectionLabel, detailText: detailText
  };
});
