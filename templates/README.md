# Website templates

The four real templates — `tech500`, `retail-leadership-summit`, `cx-leaders-forum` and `making-ai-work` — are
microsites of The Economic Times Business Verticals rebuilt as designs the site editor opens and edits. Each is
assembled from its sections plus a shared layer of the ETB2B platform's CSS. They keep the source page's design, not
its event: every word, figure and card is either filled from the event (Create Event, Content, Basics) or a neutral
model marked as a sample (see "Samples" below). The other names in Create Event's gallery are a name and a picture
only.

One template on its own, with no event's content: `/templates/preview.html?t=<id>` on the CMS (signed in), or locally
`node tools/serve.js`, then `http://localhost:8080/templates/preview.html?t=tech500` (sections are fetched, so not
over `file://`). Any other id says "This template could not be found."; an AI-designed site's old address
(`?t=gen-<event id>`) goes to that event's own preview, `/preview/<event id>`.

## Layout

```
templates/
  <id>/
    template.json          name, fonts, <body> id/class/CSS variables, sections (order, repeat, toggle), design
                           settings the editor acts on, content.map / content.bind (what Create Event and Basics fill)
    theme.css              the event's own CSS from the live page <head> (linked from the page, so a change reaches
                           every saved and published site at once)
    sections/<section>/    index.html · style.css · script.js (only when the section has behaviour of its own;
                           shared behaviour is named in template.json: sections[].widget)
  preview.html             ?t=<id> — one real template on its own, as the template loader assembles it
  _shared/                 one copy for every site
    et-global.css          ETB2B's microsite bundle (its global.css) — relative url()s made absolute, nothing else changed
    et-animate.css         ETB2B's scroll-animation classes (.animated … .go); the hidden start only under html.rv-anim
    et-platform.css        page-level rules the platform prints into every microsite <head>, and the keyboard focus ring
    et-runtime.js          site-side runtime: per-section init (RevampSections.register), accordions, scroll reveal,
                           carousels, section links, the ETB2B event bar, imported pages' behaviour
    widgets/<name>/        script.js — behaviour several templates share (et-banner: the banner's background video)
    template-loader.js     RevampTemplates.build(id) / load(id) → the complete HTML document
    rv-draw.js             the event's records and Basics drawn into a saved site (editor and server, one copy)
    rv-records.js          the event's records in the words a site's lists use (shared by rv-draw.js and the server)
    rv-data.js             RevampData: the event's site data as a content.map's content, and the list rules run on it
    rv-forms.js            the forms of a published or previewed site (registration, enquiries)
    rv-popups.js           a speaker's or sponsor's page, a juror's profile, a gallery's photos large
    rv-pages.js            internal pages of a multi-page site
    rv-live.css            what a published or previewed page hides before any script runs (sections with no records)
    rv-visit.js            counts one page view of a live site
    rv-blend.js            "Smooth" section edges
    rv-hero-video(-core).js the banner video an event supplies
    img/                   neutral pictures: rv-avatar.svg (a speaker without a photo), rv-image.svg (a model photo
                           tile), the ETB2B logos for dark and light grounds, portal wordmarks
    none.html              empty: the header / footer file older imported sites name
    gen-base.css, rv-theme.js, rv-theme-switcher.js, rv-type.js, rv-award-cta.js, rv-preview-edit.js
                           AI-designed sites, award sites and the preview page's tools
```

## How a site is made, saved and published

1. **Create Event** creates the event on the server, with its template, then hands what was written in the wizard
   (steps 1 and 3) to the editor: `custom_editor.html?from=create&slug=<event id>&template=<id>`. The editor fills
   the template from it once (`editor-fill.js`, `template.json → content.map`), marks the template's samples still
   on the page, and saves that as the site's first version.
2. **The site editor** (`custom_editor.html?event=<event id>`) opens the version saved on the server
   (`GET /api/event/site`): every browser and every colleague opens the same one. On opening it draws the event's
   records and Basics into the page (`_shared/rv-draw.js`). Every change is one undo step and is kept at once in
   this browser's copy (IndexedDB, `editor-store.js`, key `site:<event id>:<template id>`) — a buffer for work not
   saved yet, opened instead of the server's version only while it holds changes made on that same version (on an
   older one the person is asked). **Save** stores the page and the editor's state on the server
   (`PUT /api/event/site`): a new version of the staged copy, with a line in the history saying what changed. Two
   people saving over each other are asked which copy to keep.
3. **The staged copy** is what `/preview/<event id>?staged=1` shows and what goes live next. The server keeps it in
   step with the event without the editor: a change in Content (speakers, FAQs, sponsors, gallery, contacts) or in
   Basics (name, dates, place) is drawn into it at once (`functions/lib/site-records.js`, running `editor-fill.js`
   and `rv-draw.js` on `functions/lib/mini-dom.js`), as a version of its own ("Content: 1 FAQ added").
4. **Publishing** puts the staged copy live at `/e/<event id>` — directly, or through an approval request when the
   team's settings ask for approval (an approver sees what changed and approves or rejects it). The check before
   publishing holds a site back while it still shows the template's samples, placeholder words or unanswered
   notices.
5. **The publish transform** (`functions/lib/api.js publishTransform`, for `/e/<id>` at publish and `/preview/<id>`
   on request) turns the saved page into the visitor's page: it takes out what only the editor or the AI review
   uses (editing marks, outlines, notices, AI badges, comments); makes the saving host's addresses root-relative;
   writes the title, description, sharing tags, canonical link and icon; adds, exactly once, the runtime and its
   config — `#rv-site-config` (event, mode, template, content.map), `#rv-forms` (the event's forms), `editor-fill.js`
   and `rv-data.js`, `rv-pages.js` (a site with pages), `rv-popups.js`, `rv-award-cta.js` (an award site),
   `rv-forms.js`, `rv-blend.js` (smooth edges), `rv-live.css`; in a preview, the ribbon and the preview's tools; then
   WebP copies of the pictures, an accessibility pass (alt text, zoom), buttons that lead nowhere put right, and page
   links for a site with pages. Served pages (`functions/lib/delivery.js`) get the shared stylesheets written into
   the page, `et-runtime.js` deferred behind a small stand-in, and `?v=<content hash>` on every file of ours.
6. **On the live page** `rv-forms.js` opens the event's forms from its buttons (`a[data-register-cta]`,
   `a[data-rv-form]`), draws a form placed in the page, checks the answers with the server's rules and sends them to
   `POST /api/register` with where the visitor came from: the address's `utm_source` / `utm_medium` /
   `utm_campaign` (or `src`), kept for the visit from the page they landed on (sessionStorage
   `rv.utm.<event id>`), so a registration made on another page still carries them. In a preview a submit is
   checked, not stored; on a shared preview link nothing is sent. `rv-visit.js` counts the page view.

What reaches a site already saved: `theme.css` and the `_shared` files are linked from the page, so a change to them
reaches every site at once. A section's `style.css` is in the saved page (`<style data-rv-style>`, kept in the
editor's state as an empty placeholder and refilled from the file when the editor opens the site), so a CSS fix to a
section reaches a saved site the next time it is opened in the editor and saved. A section's `index.html` is saved as
edited: a change to it only shows on sites made after it (or on a section added again from the template).

## In the editor

The editor runs the page in an iframe at a real 1440px / 390px width, scaled to fit (`editor-canvas.js`);
`editor-canvas.css` is added to it only while editing (everything revealed, outlines) and never saved. Editable
elements are worked out from the markup: `<img>` → image, an inline `<svg>` that draws something (an icon) → image,
`<a>` with text → button (label + link), an element with its own text → text. Replace image (upload or URL) keeps an
icon's `<svg>` — its classes, viewBox and the section's CSS for it — and swaps only its drawing for the picture.
Override one with `data-ed="text|image|button|none"` in the section's `index.html`. Anything inside
`[data-rv-locked]` can't be selected.

Section tools work on the real page in the iframe:
- **Duplicate** gives the copy new ids and copies every CSS rule that names the old ones — from the section's own
  file, the ETB2B bundle and the event theme alike — into a `<style data-rv-copy-for="<new id>">` after it, so the copy
  looks exactly like the original. Section scripts must therefore work from their `section` argument only.
- **Add → From <template>** inserts an untouched copy of one of the template's own sections (captured when it loads).
- **Add → Predefined / AI / reference** inserts one of the editor's generic sections as `<section class="rv-generic">`,
  styled by a scoped copy of the editor's site CSS (mapped onto the template's `--theme-color`, fonts, …) that is
  added to the page once, as `<style data-rv-generic>`.
- **Layout items** (add/remove repeating cards) needs `template.json → sections[].repeat: { item, label }` — `label`
  is the element in an item that names it, `":self"` when the item names itself (a button).
- **Accordions** (an FAQ): the editor keeps clicks from the site's scripts, so answers would stay shut. With
  `template.json → sections[].toggle: { item, open, expanded }` (TECH500's FAQ: `.faq-item`, `active`,
  `.faq-question`) a click inside an item opens it in the editor, one at a time, so its answer can be edited. That
  open state is the editor's own (`data-rv-open`): it is never saved, undone or published. On the site an accordion
  is `RevampSections.accordion(section, { item, trigger, panel })` in the section's script — it does nothing while
  editing. The trigger is a real `<button aria-expanded>` (keyboard, screen readers) with the question's words in
  a `<span>` inside it: text typed straight into a button loses its spaces.
- A section hidden in the editor stays hidden on the preview and the live page.
- **Section names**: `sections[].name` is the design's own heading for a section ("What is Tech500", "About ETCIO"),
  kept as it is for the editor and the site. Where that name is the sample event's or a portal's, an optional
  `sections[].label` gives the neutral name Create Event lists it under for any event ("About the event", "About the
  portal"), so a newcomer on another portal does not take the design for another team's event.

Theme controls (Design panel, global toolbar) set the platform's own variables on `<body>` — `--theme-color`,
`--body-font-family`, the heading font variable, `--default-color`/`--body-color`, `--para-font-size`,
`--primary-font-size`, `--bg-spacing` — so the site follows the way an ETB2B microsite does when its design settings
change. A setting with nothing on the page to act on is refused with the reason. The theme colour also sets
`--accent-color` on these designs: a second brand colour a design draws (cx-leaders-forum's pink) is written as
`var(--accent-color, <its colour>)`, so it keeps its look until a theme colour is picked and follows it after. What
the platform hard-codes (heading weight/colour/case/alignment, corner radius, dividers, section animation) goes into
one `<style data-rv-design>` with its settings in `data-rv-state`. `template.json → design` says which variable most
headings read (`headingFontVar`), which selectors are the headings / buttons / cards, and which extra theme colours
to offer.

Undo/redo (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, or the arrows on the tool row) steps through the editor's snapshots
(`canvas.snapshot()`: the `<html>`/`<body>` inline styles, the design rules and the content column element by element;
hidden and scheduled sections, names, copies and their CSS are kept; selection and in-place editing are left out).
`canvas.restore()` keeps every unchanged element, so only what changed is rebuilt and has its section script run
again.

## From Create Event

A gallery template in `create-event.html` with `site:'<id>'` (TECH500 has `site:'tech500'`) is one of these designs.
`editor-fill.js` reads `template.json → content.map`, a list of `{ from, section, intro, fill }`. `from` is a Create
Event library id (`hero`, `about`, `priorities`, `stats`, `whyjoin`, `attend`, `contact`, …) or `event` (step 1:
name, date, place, logo); the `fill` rules set text, attributes, paragraphs and card lists. The rule reference is at
the top of `editor-fill.js`. Generate from a brief run again for the same event is a newer run, which the editor
opens in place of the earlier one (a browser copy holding changes of the person's own is never dropped without asking).

**One content model for every template.** Create Event doesn't know any template's design. Every section it has
(except the hero, nav/footer and one-line bands) carries the same **section text**:

- `subheading`, `heading`, `body`;
- `points[]`;
- `media { kind: image|video, url, side }`;
- `cta { label, url }`.

Every card list (discussion points, benefits, what-awaits blocks) uses the same **item**: `t` (heading), `d`
(paragraph) and `points[]`; numbers are `{ v: value, k: label }`, quotes `{ q, n, r, c }`. A template maps only what
its design has, with one `intro` entry per section listing its slots:

```json
{ "from": "about", "section": "overview",
  "intro": { "subheading": "h2 > span", "heading": { "sel": "h2", "skip": "span" }, "body": ".col-md-7 p",
             "points": ".col-md-7 > div", "media": { "sel": ".row", "wrap": "col-md-5" },
             "cta": { "label": "a.btn > span", "link": "a.btn" } } }
```

Anything a design has no slot for simply isn't shown by that template. `fill` runs before `intro`, so a template can
set a default (e.g. "About {event.name}") that the user's text replaces. A design that shows the pointers as cards of
its own gives `points` as a list instead of a selector —
`"points": { "list": ".power-chain-insight", "fill": [ { "text": ".power-chain-insight-text", "value": "{.}" } ] }` —
one card per pointer (`{.}` the pointer, `{##}` its number), none when there are none. A body selector that names
two elements (`".why-now-insight > p, .why-now-insight > blockquote"`) puts the paragraph's first line in the first
and its second line in the second.

- Card lists grow or shrink to match the data. Extra cards are copies of the template's own cards, cycling through
  them, so icons vary.
- Every list rule says `"empty": "hide"`: a list with nothing in it shows no cards, never the template's own.
  A section the draft doesn't have at all is left as the template wrote it (its samples marked).
- A section the user switched off in the wizard is hidden, not deleted.
- A Create Event section with no entry in the map is left out, and the editor says which.

**No copy of the source event without a field.** Everything a section shows is either the event's (a slot the wizard
fills, a record, Basics) or a neutral model, and nothing names the event the design was taken from. Where a design has
something no existing Create Event section covers, it gets a library section of its own (TECH500's partner pitch is
`closing`; Making AI Work's Manifesto is `manifesto`), not a static leftover. The wizard has one form per section
(UX-050), so a second kind of content inside one section rides on that section's own form (TECH500's Power Chain
insights are its pointers) or stays a marked sample the site editor changes (its three research figures).

**Samples (`data-rv-sample`).** What a template still shows until an event's own is entered — another event's
figures, cards, quotes, theme lines, and the neutral models of its paragraphs — carries `data-rv-sample` on the element
that holds it (a card, a figure with its label, a paragraph, a heading). It is known by its words: the whole element's
text (matched against an element of the same tag and first class) when it has no quote of 30 characters or more,
else by that quote; and by its photos (a picture in a `<figure>`, never an icon the cards repeat).
`functions/lib/site-checks.js` finds those still on a page and the check before publishing holds the site back
("Samples from the template are still on the page", with a link to each section); the editor outlines them on a page
that opens fresh (`markTemplateSamples`) and asks before publishing while they are there. A card the wizard or the
event's records built (`data-rv-item` with a value) is never a sample, whatever it says; one the owner changed in any
part is theirs. Never mark a record's model (speakers, FAQs, contacts, gallery), the banner or a generic label
("Contact Us", "Frequently Asked Questions").

**Sections that show the event's records.** Speakers, FAQs, sponsors, the gallery and contacts are managed in the
event console's Content tabs, and `_shared/rv-draw.js` draws them through the same `content.map` list rules (from
`speakers`, `faq`, `partners`, `glimpses`, `contact`) in data mode: the site editor when it opens a site, and the server
whenever the site is saved or something changes in Content — so the staged copy shows the change at once and it goes
live with the next publish or approval. Such a section:

- carries `data-rv-bound="<kind>"` on its root element in `index.html` (`speakers | faq | partners | glimpses |
  contact`), so the editor knows from the first moment that its cards are records, not text to type over;
- holds ONE neutral model card per list, marked `data-rv-item="<kind>"` like the cards drawn from it (so it too is
  a record's place, not text to edit, while the records are still loading) — "Speaker name", "Question" / "Answer", "Partner name", "Name" /
  name@company.com — never a real person, logo, photo, address or phone number, and no `href` on a model's links.
  A model picture is `/templates/_shared/img/rv-avatar.svg` or `rv-image.svg`, written from the site root (the
  loader turns it into a full address);
- has rules for everything a record carries: a speaker's photo (`"empty": "keep"` leaves the model's avatar) and
  `alt`; a sponsor's logo, link and name (`{ "show": …, "if" | "unless": "{logo}" }`; an attribute that depends on
  another value takes `"if"`); a photo's own link, `alt` and caption; `"empty": "remove"` on a line that may be
  missing (a speaker's "role, company", a contact's label, e-mail or phone).

With no records to show (none, or only Invited or Tentative speakers and sponsors) the section has no cards — the model
is kept aside in `<template data-rv-pristine>` — and is marked `data-rv-empty="<kind>"`: it is not on the published or
previewed page (`rv-live.css`), nor is the menu's link to it; in the editor it says where to add them.

**The banner.** All four banners are built the same way:

- the event's name as `<h1 class="banner-title" data-rv-bind="event.name">`, straight after `<img class="logo"
  data-rv-bind="event.logo">` (no `src` in the section file), then `<p class="banner-tagline">`. An event with a logo
  shows the logo and keeps the title for search engines and screen readers; without one the title is what visitors
  read (`et-platform.css` does this from whether the logo is showing — nothing to keep in step). The hero rule
  `{ "text": ".banner-title", "value": "{hero.title|event.name}", "bind": "event.name" }` leaves the title following
  Basics unless the owner wrote a headline of their own;
- date and venue are `data-rv-bind="event.date"` / `"event.venue"` (also listed in `content.bind`, for pages saved
  before the attributes existed), so they follow Basics: the editor and the server write Basics into them
  (`_shared/rv-draw.js`) whenever the site is opened or saved and whenever Basics change, and the change goes live with
  the next publish or approval. A date in another style says so (`data-rv-bind-style="day"`: "27 November, 2026"). A
  line with no value is not shown on the site; a line the owner rewrote by hand in the editor keeps their words
  (`data-rv-unbound`);
- ONE picture, `<img class="banner-bg-image" data-rv-media="bg-image">`, which the event's own banner replaces, and
  an empty `<div class="bnr-bg-video" data-rv-media="bg-video">` that gets a video only when the event supplies a
  video file (`{ "bgvideo": … }`); `widgets/et-banner/script.js` loads it — never on a phone — and takes the
  source event's own footage out of pages saved before this;
- `<div class="overlay-lyr">` between the media and the text, in the colour the section's CSS gives
  `--rv-banner-scrim`: banner text must stay readable over any picture an owner uploads.

No real template has an agenda section of its own: sessions (kind `sessions`, `"from": "agenda"` in a map) need a
section shared by all sites, which RevampData reports as `unplaced` until a site has one.

Registration buttons are `<a href="#register" data-register-cta>` (the live site opens the registration form for
them); a "become a partner" button links to the contact section, `href="#contact-us"`. No `<a>` without an `href`:
it cannot be reached from the keyboard.

Dates are written the way ETB2B's sites print them: `{event.date}` gives "27th November, 2026" and `{event.date:day}`
gives "27 November, 2026", with ranges and month / quarter / to-be-announced handled.

Grids that the data can resize should cope with any count without changing the default. TECH500's power chain takes
its column count from `:has()` count rules (and on a tablet or phone wraps its roles three, then two, to a row), and the
3- and 4-column card grids avoid empty columns on desktop. Check the default pixel for pixel after such a change.

## What each template fills

`from` is the Create Event section (library id) or `event` (step 1); "Section text" lists the slots the design has;
"Cards" the list a section's cards are drawn from and the item fields they show. Lists marked *(records)* come from
Content, not from the wizard. Every selector these maps, `content.bind`, `sections[].repeat` / `toggle` name is
checked against the section files by `functions/lib/template-selectors.test.js`: one that matches nothing fails it.
Every template's `banner` takes `hero`: the picture (`hero.bannerUrl`), a video (`hero.video.url`), the logo, the
title (`hero.title`, else the event's name), the tagline, the date and place (`event.dateLabel|event.date`,
`event.location`) and the two buttons (`hero.cta1`, `hero.cta2`); `content.bind` keeps its logo, date and venue
following Basics.

### tech500

| Section (id) | from | Section text | Cards: list → fields |
|---|---|---|---|
| Beyond sponsorship (`strategic-influence`) | `closing` | subheading, heading, body, cta | — |
| Beyond sponsorship (`strategic-influence`) | `event` | — | date and place line (also in `content.bind`) |
| What is … (`overview`) | `about` | subheading, heading, body, points, media | heading defaults to "What is {event.name}" |
| Why now (`why-now`) | `priorities` | subheading, heading, body (second line: the quote) | `priorities.items` → t, d |
| Summit spotlight (`summit-spotlight`) | `stats` | subheading, heading | `stats.items` → v, k |
| Be in the room (`why-attend`) | `whyjoin` | subheading, heading, body, points (the line beside the button), cta | `whyjoin.items` → t, d |
| The Power Chain (`power-chain`) | `attend` | subheading, heading, body, points (the numbered insights) | `attend.items` → t, d (roles) |
| Industries in the room (`industries`) | `industries` | subheading, heading | `industries.items` → t |
| Frequently asked questions (`faq`) | `faq` | heading | `faq.items` → t, d *(records)* |
| Contact us (`contact-us`) | `contact` | heading | `contact.blocks` → t; `people` → n, e, p *(records)* |

### retail-leadership-summit

| Section (id) | from | Section text | Cards: list → fields |
|---|---|---|---|
| What awaits you (`awaits`) | `awaits` | heading | `awaits.items` → t, d |
| Key numbers (`stats`) | `stats` | — | `stats.items` → v, k |
| Overview (`overview`) | `about` | subheading, heading, body | heading defaults to the event's name |
| Key Discussion Points (`priorities`) | `priorities` | heading | `priorities.items` → t, d (d is the tag) |
| Brands At The Summit (`partners`) | `partners` | heading | `partners.tiers` → t; its `logos` → logo, url, n *(records)* |
| Five Powerful Conventions (`tracks`) | `tracks` | heading | `tracks.items` → t, d |
| Why Join Us (`whyjoin`) | `whyjoin` | heading, body | `whyjoin.items` → t, d |
| Retail Factoids (`factoids`) | `factoids` | heading | `factoids.items` → t, d |
| Who Should Exhibit (`exhibitors`) | `exhibitors` | heading, body | `exhibitors.items` → t, d (one model category) |
| Who Should Attend (`attend`) | `attend` | heading | `attend.items` → t |
| Gallery (`glimpses`) | `glimpses` | heading | `glimpses.items` → url, caption *(records)* |
| Frequently Asked Questions (`faq`) | `faq` | heading | `faq.items` → t, d *(records)* |
| Contact Us (`contact-us`) | `contact` | heading | `contact.blocks` → t; `people` → n, e, p *(records)* |

### cx-leaders-forum

| Section (id) | from | Section text | Cards: list → fields |
|---|---|---|---|
| Key numbers (`stats-3`) | `stats` | — | `stats.items` → v, k |
| Overview (`overview-`) | `about` | heading, body | heading defaults to the event's name |
| The Editorial Agenda (`conventions-box`) | `awaits` | heading | `awaits.items` → t |
| The CX Investment Stack (`pillars`) | `priorities` | heading | `priorities.items` → t, points |
| Who Should Attend (`who-should-attend`) | `attend` | heading | `attend.items` → t |
| Speakers (`speakers`) | `speakers` | heading | `speakers.items` → photo, n, r, c *(records)* |
| Quotes From CX Leaders (`leaders`) | `insights` | heading | `insights.items` → q, n, r, c |
| Gallery (`glimpses_event`) | `glimpses` | heading | `glimpses.items` → url, caption *(records)* |
| Frequently Asked Questions (`faqs`) | `faq` | heading | `faq.items` → t, d *(records)* |
| Contact us (`contact-us`) | `contact` | heading | `contact.blocks` → t; `people` → n, e, p *(records)* |

### making-ai-work

| Section (id) | from | Section text | Cards: list → fields |
|---|---|---|---|
| Overview (`overview`) | `about` | heading, body (second line: the larger line), media | — |
| Key numbers (`overview-stats`) | `stats` | — | `stats.items` → v, k |
| Questions this raises (`who-enter`) | `keyquestions` | subheading, heading, body | `keyquestions.items` → t, d |
| Key Discussion Points (`key-topic`) | `priorities` | heading | `priorities.items` → t, d |
| Our Speakers (`our-speakers`) | `speakers` | heading | `speakers.items` → photo, n, r, c *(records)* |
| Reasons not to miss (`fact-marquee`) | `whyjoin` | heading | `whyjoin.items` → t, d |
| Who should attend (`conventions-box`) | `attend` | subheading, heading, body | `attend.items` → t, d |
| Gallery (`glimpses_event`) | `glimpses` | heading | `glimpses.items` → url, caption *(records)* |
| Manifesto (`about-wrapper`) | `manifesto` | heading, body | — |
| Contact us (`contact-us`) | `contact` | heading | `contact.blocks` → t; `people` → n, e, p *(records)* |

The one section of each design with no entry keeps its own content on purpose: the portal's organiser block ("About
ETCIO", "About ETRetail", "About ETBrandEquity.com": `about-us`, cx-leaders-forum's `about_us_event`) is the same on
every microsite of that portal. Making AI Work has none.

## Motion, keyboard and colour

- ETB2B's scroll reveal (`.animated` in an `.animatedParent`, `et-animate.css`) holds a block hidden until it is
  scrolled to only under `<html class="rv-anim">`, which `et-runtime.js` sets (the served page's stand-in sets it in
  `<head>` already and takes it off if the runtime never arrives): a page whose script did not run shows everything.
  Visitors who asked for no motion get every block at once, and a marquee that stands still and scrolls by hand.
- `et-platform.css` draws a keyboard focus ring (`:focus-visible`, 2px in the element's text colour) on links,
  buttons, `<summary>` and focusable elements; a section's or a runtime's own focus style wins over it.
- A design's brand colour is `var(--theme-color, <its colour>)` (a translucent one
  `color-mix(in srgb, var(--theme-color, <its colour>) 38%, transparent)`), a second brand colour
  `var(--accent-color, <its colour>)`; an SVG's own `fill` / `stroke` gets a CSS rule on `[fill="<colour>" i]`. With the
  fallback the default look is unchanged. The ETB2B logo is never recoloured: only the black lettering of a logo may
  change colour, the red ET square never.

## Adding a template

1. Put each section of the platform's export in `sections/<section>/` — the markup's root element keeps its `id`,
   and the CSS stays scoped to it (`#power-chain …`). Take markup from the **server HTML** of the live page, not a
   "Save page as"/export captured after scripts ran. The source event's own logo, banner video, dates and venue do
   not come along: see "The banner" above; its words, figures and cards become slots or marked samples.
2. A section script becomes `RevampSections.register('<section>', function (section) { … })` working inside `section`
   only — never `document.querySelector` / `DOMContentLoaded` — so duplicated sections get their own behaviour.
   Behaviour another template already has is not copied: the section names it (`"widget": "et-banner"`) and the
   shared script registers itself with `RevampSections.widget('<name>', function (section) { … })`.
3. `theme.css` = the event custom `<style>` in the live `<head>` + the rules the platform generates from the event
   design settings. `template.json → body` = the live `<body>` id, class and inline CSS variables (check the rendered
   DOM too: the platform's header script adds classes at runtime, e.g. `single-header`).
4. Compare `preview.html?t=<id>` with the live site at desktop and phone width, then add the id to the list of real
   templates in `preview.html`.
5. Point the event colour at the theme (see "Motion, keyboard and colour") and check the default pixel for pixel.
6. Write `template.json → content.map` for the sections Create Event can fill (see above): an `intro` with the slots
   each section's design has, plus `list` rules for its cards; add the template to "What each template fills" and to
   `functions/lib/template-selectors.test.js`. Then give the gallery entry in `create-event.html` its `site` id.
