# Section component library

Generic, reusable, theme-able section components for the generative site-building feature — new foundational
infrastructure, distinct from a "ported template" (`templates/<id>/`, one specific real ET page's exact markup).
A component here is a building block any generated event site can use, not one event's own page.

Each type lives at `templates/_library/sections/<type>/`:

```
templates/_library/sections/<type>/
  index.html      the section's markup — root element keeps a stable id="<type>", CSS scoped to it (#<type> …)
  style.css       scoped CSS, theme-variable driven, with its own @media breakpoints
  script.js       only where the section has behaviour (faq-accordion); RevampSections.register('<type>', …)
  map.json        this section's own content.map entry — the fill/intro (and list, where it repeats) rules a
                  template.json → content.map would use to fill it from Create Event's wizard content
```

These follow the same file/markup/CSS-scoping conventions as a ported template's own `sections/<id>/`
(see `templates/README.md`) so the existing editor (`custom_editor.html`, `editor-canvas.js`) can duplicate,
style and save them the same way: `data-rv-section="<id>"` is added automatically from the root element's own
`id` by whatever assembles the page (`templates/_shared/template-loader.js`'s `tagSection`), the same way it is
for every ported template section — nothing in these files sets it themselves.

## The 10 section types

| Type | Purpose |
|---|---|
| `nav` | Top navigation bar — logo slot + placeholder nav links. Shape `auto`: nothing but the logo is wizard-fillable. |
| `hero` | Banner/hero — logo, title, tagline, date, location, two CTAs, full-bleed background image. |
| `overview` | Generic rich-text block — subheading, heading, body paragraph(s), one optional image beside the text (left or right). |
| `stats-strip` | A row of 3–5 numeric callouts, each a `{value, label}` pair (e.g. "500+ Attendees"). |
| `cards-grid-icon` | 3-column grid of icon + title + 1–2 lines of body (e.g. "Key Discussion Points", "Why Join Us"). |
| `cards-grid-chips` | Denser, icon-free chip wrap — title + one line (e.g. "Who Should Attend", "Industries in the Room"); deliberately flatter/tighter than `cards-grid-icon` so the two don't read as the same grid repeated. |
| `speaker-grid` | Grid of speaker cards — photo, name, role, company. |
| `faq-accordion` | Expand/collapse question + answer list, one item open at a time. |
| `cta-band` | Full-width closing band — heading, short body, one button. |
| `footer` | Standard footer — logo, placeholder link columns, copyright line. Shape `auto`. |

## content.map conventions

Each `map.json` is one `content.map` entry (`{ "from", "section", "intro"?, "fill"? }`) for the template section
of the same name, written against the **exact** rule syntax `editor-fill.js`'s header comment (top ~60 lines)
defines — that file is the source of truth for the rule grammar (`text`/`attr`/`list`/`bullets`/`paragraphs`/
`replace`/`video`/`drop`, the `{…}` value syntax, `empty`/`skip`/`require`) and is not duplicated here. In short:

- Every generic section (`overview`, `cta-band`) uses the universal **section text** slots any Create Event
  library item carries — `subheading`/`heading`/`body`/`media`/`cta` — via an `intro` block, matching only the
  slots that section's own design actually has.
- Every card-list section (`stats-strip`, `cards-grid-icon`, `cards-grid-chips`, `speaker-grid`, `faq-accordion`)
  uses a `list` rule with an `items` path, filling each repeated card from `{t}`/`{d}` (or the shape's own field
  names — `stats` is `{k, v}`, `speakers` is `{n, r, c}`) the same way every ported template's card lists do.
  Grids that can carry any item count (`stats-strip`'s auto-fit columns, `speaker-grid`'s auto-fit columns,
  `cards-grid-chips`'s flex-wrap) need no column-count update as items are added or removed.
- `hero`/`nav`/`footer` carry their own special, non-generic fields (`hero.title`/`hero.tagline`/`hero.cta1`/
  `hero.cta2`, `event.date`/`event.location`/`event.logo`), matching every ported template's own banner/footer
  convention 1:1.
- Each `map.json`'s `"from"` is the Create Event library id that is the clearest fit for that section's shape
  (e.g. `awaits` for `cards-grid-icon`'s icon+title+line shape, `attend` for `cards-grid-chips`'s chips shape) —
  noted in each file's own `"_comment"`, along with which other library ids share the same item shape and would
  work identically. `cta-band` has no dedicated library id in Create Event at all (there is no "closing band"
  entry), so it maps from whichever single-text library the generated page is using as its closing pitch.
- None of these `map.json` files are wired into any real `template.json` yet — this library isn't consumed by
  the ported-template pipeline today. They exist so whoever wires a generated page's `template.json →
  content.map` together doesn't have to reverse-engineer each section's markup to find out what's fillable.

## Theming

Every themeable value (colour, font, size) reads one of the exact CSS custom properties the Design panel already
controls — `--theme-color`, `--heading-font-family`, `--body-font-family`, `--default-color`, `--body-color`,
`--para-font-size`, `--primary-font-size`, `--bg-spacing` — each with a sane fallback (`var(--x, fallback)`), so
an existing design-panel change reaches a generated page with zero new code. Heading weight/case/align/radius,
dividers and section animation are handled the same way ET's own templates handle them: by `template.json →
design` naming this section's heading/button/card selectors (see `templates/README.md`'s Theme controls section
and `editor-canvas.js`'s `makeDesign`) — not by anything in these files. A reasonable `design` block for a
template assembled from this library:

```json
{
  "headingFontVar": "--heading-font-family",
  "headings": "h1, h2, h3",
  "buttons": ".btn-primary, .btn-secondary, .hero-cta-primary, .hero-cta-secondary, .cta-band-btn",
  "cards": ".stat-item, .cards-icon-card, .chip-card, .speaker-card, .faq-item"
}
```

Content sections (`hero`, `overview`, `stats-strip`, `cards-grid-icon`, `cards-grid-chips`, `speaker-grid`,
`faq-accordion`, `cta-band`) carry ET's own `mb-medium` class on their root, so `--bg-spacing` (section spacing)
applies the same way it does on every ported template. `nav` and `footer` are page chrome, not content sections,
so they don't — their own padding is fixed in their `style.css`.

## Icons

One consistent approach across all 10 types: **Bootstrap Icons** (`<i class="bi bi-…" aria-hidden="true">`), the
same icon set ET's own ported sections already use for inline icons (e.g. `tech500`'s banner date/location
glyphs) and already loaded globally by `templates/_shared/et-global.css`'s bundle — no new dependency. Used for:
`hero`'s date/calendar and location/pin icons, `stats-strip`'s per-stat icon, `cards-grid-icon`'s per-card icon,
and `faq-accordion`'s chevron (rotates on open via CSS, no separate open/closed icon swap). Every icon is purely
decorative (`aria-hidden="true"`, `content.map` never touches one) and, being an `<i>` rather than an `<img>` or
a hand-drawn inline `<svg>`, is never picked up by the editor's default image-detection — so none of them need a
`data-ed="none"` override to stay non-editable. `cards-grid-chips` deliberately has **no** icon at all, by design
(see the type table above) — that's part of what keeps it visually distinct from `cards-grid-icon`.

## Placeholder imagery

Every image slot (`hero`'s background and logo, `overview`'s media, `speaker-grid`'s photos, `footer`'s logo) is
a real `<img>` — so the editor's default image-swap applies — pointed at a tiny inline `data:image/svg+xml,…`
flat rectangle (neutral grey, no text, no real photo URL) rather than any ET or stock imagery, per the "no
ET-specific branding or imagery" requirement. All text content is neutral placeholder copy for the same reason.

## Judgment calls

- **No Bootstrap grid classes.** Ported templates' markup leans on ET's bundled Bootstrap grid (`container`/
  `row`/`col-md-*`, from `et-global.css`). These components intentionally don't use it: a generic, reusable
  component should not depend on a specific bundle happening to be loaded in a specific way by whatever
  assembles a generated page, and the task explicitly calls for real `@media`-driven responsiveness rather than
  "hoping flexbox/grid auto-wraps acceptably" — so every section's layout and breakpoints are fully self-
  contained in its own `style.css`.
- **Grids that resize without a fixed column count.** `stats-strip` and `speaker-grid` use
  `repeat(auto-fit, minmax(…))`; `cards-grid-chips` uses `flex-wrap`. All three cope with any item count the
  editor's Layout items tool produces without anyone needing to update a hardcoded column count (the same
  concern `templates/README.md` raises about TECH500's power-chain column count).
- **`cta-band`'s mapping is the weakest of the 10** — see content.map conventions above. It's documented as
  illustrative rather than pinned to one library id, which is honest about there being no dedicated Create
  Event library entry for a closing CTA band, but means whoever wires this in will need to pick a `"from"` that
  fits their specific generated page.
- **Speaker photos never fill from the wizard**, matching every ported template's own speaker section: Create
  Event's speaker tool collects name/role/company text but never a photo, so filling a real, named individual's
  photo under an unrelated user's typed-in name would be wrong. The placeholder photo stays.

## Responsive reasoning (not visually tested — no browser available here)

Every section was checked by hand against three widths: ~390px (a narrow phone), ~768px (a small tablet /
large-phone landscape — the usual Bootstrap `md` seam, kept as a second checkpoint even without using Bootstrap),
and ~1440px (desktop, where the default, unmedia-queried CSS applies). The reasoning for each is in-line as a CSS
comment directly above the breakpoint it explains, rather than restated here — e.g. why `cards-grid-icon` drops
to 2 columns at 860px instead of waiting for 768px (a card with an icon, heading and two lines of body gets
cramped a step earlier than a plainer card would), why `cards-grid-chips`' mobile rule forces 2 chips per row
instead of letting `flex-wrap` alone decide (one 220px-minimum chip would nearly fill a 390px phone's content
width on its own, which reads as a mistake rather than a deliberate single-column layout), and why
`speaker-grid`'s mobile rule pins 2 columns explicitly rather than trusting `auto-fit` (which would drop to a
single, oversized column before 480px). The one thing this reasoning can't cover: actual font-metric reflow
(e.g. whether a long typed-in speaker name or FAQ question wraps exactly where expected) and real touch-target
behaviour, both of which need an actual render to confirm — `node tools/serve.js` plus a real or device-emulated
browser, the same way `templates/README.md` asks any ported template to be checked at desktop and phone width.
