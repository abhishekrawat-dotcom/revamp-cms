# Website templates

Real ET event sites, rebuilt as templates the site editor opens and edits. Each one is an exact copy of the live site,
assembled from its sections plus a shared layer of ET's platform CSS.

Run over http, not `file://` (sections are fetched): `node tools/serve.js`, then
`http://localhost:8080/templates/preview.html?t=tech500`.

## Layout

```
templates/
  _shared/                 one copy for every template
    et-global.css          ET's microsite bundle (the global.css) — relative url()s made absolute, nothing else changed
    et-animate.css         ET's scroll-animation classes (.animated … .go)
    et-platform.css        page-level rules ET prints into every microsite <head>
    et-runtime.js          site-side runtime: per-section init (RevampSections.register) + scroll reveal
    template-loader.js     RevampTemplates.build(id) → the complete HTML document
    header.html            shared header  (placeholder until the design arrives)
    footer.html            shared footer  (placeholder until the design arrives)
  <id>/
    template.json          name, fonts, <body> id/class/CSS variables, section order
    theme.css              the event's own CSS from the live page <head>
    sections/<section>/    index.html · style.css · script.js (only when the section has behaviour)
  preview.html             ?t=<id> — the template on its own, exactly as the editor and export assemble it
```

## In the editor

`custom_editor.html?template=<id>` opens a template on the editor canvas (over http, like the preview). It runs in an
iframe at a real 1440px / 390px width, scaled to fit (`editor-canvas.js`); `editor-canvas.css` is added to it only
while editing (everything revealed, outlines) and never saved. Editable elements are worked out from the markup:
`<img>` → image, an inline `<svg>` that draws something (ET's icons) → image, `<a>` with text → button (label + link),
an element with its own text → text. Replace image (upload or URL) keeps an icon's `<svg>` — its classes, viewBox and
the section's CSS for it — and swaps only its drawing for the picture. Override one with
`data-ed="text|image|button|none"` in the section's `index.html`. Anything inside `[data-rv-locked]` (the shared
header/footer) can't be selected.

Section tools work on the real page in the iframe:
- **Duplicate** gives the copy new ids and copies every CSS rule that names the old ones — from the section's own
  file, ET's bundle and the event theme alike — into a `<style data-rv-copy-for="<new id>">` after it, so the copy
  looks exactly like the original. Section scripts must therefore work from their `section` argument only.
- **Add → From <template>** inserts an untouched copy of one of the template's own sections (captured when it loads).
- **Add → Predefined / AI / reference** inserts one of the editor's generic sections as `<section class="rv-generic">`,
  styled by a scoped copy of the editor's site CSS (mapped onto the template's `--theme-color`, fonts, …) that is
  added to the page once, as `<style data-rv-generic>`.
- **Layout items** (add/remove repeating cards) needs `template.json → sections[].repeat: { item, label }`.
- **Accordions** (an FAQ): the editor keeps clicks from the site's scripts, so answers would stay shut. With
  `template.json → sections[].toggle: { item, open, expanded }` (TECH500's FAQ: `.faq-item`, `active`,
  `.faq-question`) a click inside an item opens it in the editor, one at a time, so its answer can be edited. That
  open state is the editor's own (`data-rv-open`): it is never saved, undone or published.
- Hidden sections are left out of Preview (and will be out of export).

Theme controls (Design panel, global toolbar) set ET's own variables on `<body>` — `--theme-color`,
`--body-font-family`, the heading font variable, `--default-color`/`--body-color`, `--para-font-size`,
`--primary-font-size`, `--bg-spacing` — so the site follows the way it does when ET's design settings change.
What ET hard-codes (heading weight/colour/case/alignment, corner radius, dividers, section animation) goes into one
`<style data-rv-design>` with its settings in `data-rv-state`. `template.json → design` says which variable most
headings read (`headingFontVar`), which selectors are the headings / buttons / cards, and which extra theme colours
to offer. Navigation belongs to the shared header and is not styled per template.

Saving is automatic, per event (`?event=`), in this browser's IndexedDB (`editor-store.js`, key
`site:<event>:<template>`). A save is `canvas.snapshot()`: the `<html>`/`<body>` inline styles, the design rules and the
content column element by element. Hidden and scheduled sections, names, copies and their CSS are kept; selection and
in-place editing are left out. A template section's own `<style data-rv-style>` is saved as an empty placeholder and
refilled from `style.css` on load, so CSS fixes to a template reach pages saved before them. Section markup is saved as
edited, so a change to a section's `index.html` only shows on pages that haven't saved that section. Undo/redo
(Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, or the arrows on the tool row) steps through the same snapshots. `canvas.restore()`
keeps every unchanged element, so only what changed is rebuilt and has its section script run again. After a reload,
the first undo takes the page back to the template as it came.

## From Create Event

A gallery template in `create-event.html` with `site:'<id>'` (TECH500 has `site:'tech500'`) opens this template in the
editor instead of the demo site: `custom_editor.html?from=create&slug=<slug>&template=<id>`. The page belongs to the new
event (saved as `new-<slug>`), and is filled from the wizard's content once, before the first undo step:
`editor-fill.js` reads `template.json → content.map`, a list of `{ from, section, fill }`. `from` is a Create Event
library id (`hero`, `about`, `priorities`, `stats`, `whyjoin`, `attend`, `contact`, …) or `event` (step 1: name, date,
place, logo); the `fill` rules set text, attributes, paragraphs and card lists. The rule reference is at the top of
`editor-fill.js`.

**One content model for every template.** Create Event doesn't know any template's design. Every section it has
(except the hero, nav/footer and one-line bands) carries the same **section text**:

- `subheading`, `heading`, `body`;
- `points[]`;
- `media { kind: image|video, url, side }`;
- `cta { label, url }`.

Every card list (discussion points, benefits, what-awaits blocks) uses the same **item**: `t` (heading), `d`
(paragraph) and `points[]`. A template maps only what its design has, with one `intro` entry per section listing its
slots:

```json
{ "from": "about", "section": "overview",
  "intro": { "subheading": "h2 > span", "heading": { "sel": "h2", "skip": "span" }, "body": ".col-md-7 p",
             "points": ".col-md-7 > div", "media": { "sel": ".row", "wrap": "col-md-5" },
             "cta": { "label": "a.btn > span", "link": "a.btn" } } }
```

Anything a design has no slot for simply isn't shown by that template; the demo site shows all of it. `fill` runs
before `intro`, so a template can set a default (e.g. "About {event.name}") that the user's text replaces.

- Card lists grow or shrink to match the data. Extra cards are copies of the template's own cards, cycling through
  them, so icons vary.
- Anything the draft doesn't provide keeps the template's sample content, including a list the user left empty.
- A section the user switched off in the wizard is hidden, not deleted.
- A Create Event section with no entry in the map (speakers, agenda, partners, …) is left out, and the editor says
  which.

Dates are written the way ET's sites print them: `{event.date}` gives "27th November, 2026" and `{event.date:day}`
gives "27 November, 2026", with ranges and month / quarter / to-be-announced handled.

The step-1 logo is kept in IndexedDB (`create:logo`). Large PNGs are scaled to fit 1200×720.

Reloading keeps what was saved. Running the wizard again for the same slug fills the page afresh, and Undo brings back
the page from before.

Grids that the data can resize should cope with any count without changing the default. TECH500's power chain takes
its column count from `:has()` count rules, and the 3- and 4-column card grids avoid empty columns on desktop. Check
the default pixel for pixel after such a change.

## Adding a template

1. Put each section of ET's export in `sections/<section>/` — the markup's root element keeps ET's `id`, and the CSS stays
   scoped to it (`#power-chain …`). Take markup from the **server HTML** of the live page, not a "Save page as"/export
   captured after scripts ran (e.g. the banner video is lazy: `data-src`, not `src`).
2. A section script becomes `RevampSections.register('<section>', function (section) { … })` working inside `section`
   only — never `document.querySelector` / `DOMContentLoaded` — so duplicated sections get their own behaviour.
3. `theme.css` = the event custom `<style>` in the live `<head>` + the rules ET generates from the event design settings.
   `template.json → body` = the live `<body>` id, class and inline CSS variables (check the rendered DOM too: ET's header
   script adds classes at runtime, e.g. `single-header`).
4. Compare `preview.html?t=<id>` with the live site at desktop and phone width before wiring it into the editor.
5. ET section CSS often hard-codes the event colour (`#D8151E`, `rgba(216, 21, 30, .1)`, `fill="#D8151E"` in SVG).
   Point those at the theme so the theme colour control reaches them — `var(--theme-color, #D8151E)` and
   `color-mix(in srgb, var(--theme-color, #D8151E) 10%, transparent)`; for SVG fills, a CSS rule on
   `[fill="#D8151E" i]`. With the fallback the default look is unchanged — check it pixel for pixel.
6. Write `template.json → content.map` for the sections Create Event can fill (see above): an `intro` with the slots
   each section's design has, plus `list` rules for its cards. Then give the gallery entry in `create-event.html` its
   `site` id.
