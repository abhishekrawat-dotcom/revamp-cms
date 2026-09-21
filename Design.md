# Revamp CMS — Design & Technical Architecture

_As of 2026-09-21. Companion to [PRD.md](PRD.md) — that document covers product scope and goals; this one covers how the current prototype is actually built._

## Architecture Overview

Revamp CMS is a static, framework-free HTML/CSS/vanilla-JS prototype. There is no build step, no bundler, and no backend — every page is opened as a plain file/route, and all state lives in the browser via `localStorage`. Shared logic (event data, formatters, UI builders, persistence helpers) is centralized in `edit-event-core.js` as a single `window.RevampCore` module, but several major pages (the Create Event wizard, Event Listing, the payments sub-app) don't use it and instead duplicate their own styles, state, and helper functions.

## Data Model — `window.RevampCore` (`edit-event-core.js`)

- **`PORTALS`** — 11 portal slug→label pairs (e.g. `cio:'ETCIO'`, `bfsi:'ETBFSI'`, `legal:'ETLegalWorld'`).
- **`TYPES`** — 6 event-type slugs: `ip`, `client`, `editorial`, `leadgen`, `roundtable`, `awards`.
- **`EVENTS`** — hardcoded seed array of 8 events. Fields: `id, name, venue, eventNo, type, portal, status (active|upcoming|draft|completed), start, end, registrations, regTarget, visitors, visits, payment:{type, amount, txns}`. A seeded PRNG (`rnd(seed)`) then derives `mailers, opens, clicks, unsub, dials, leads, whatsapp, sms, attendees, shortlist, wishlist` per event — this is demo data, not a real API response.
- **`eventById(id)`** — linear scan with string-coerced id match.
- **`makePeople(EV)`** — deterministically generates 12–400 fake attendee records (`name, initials, colour, desig, comp, city, src, email, when, paid, attended`), seeded from `EV.eventNo`.
- **Formatters**: `comma`, `compact` (Cr/Lacs/K), `money` (₹ prefix), `fmtDate`, `fmtDT`.
- **UI builders** (return HTML strings): `statTile`, `panel`, `panelFlush`, `emptyState`, plus an icon set `IC` (~40 named SVG paths) rendered via `svg(inner, size)`.
- **`toast(msg)`** — appends to `#toast-host`, auto-dismisses after 2.6s.
- **`makeCtx(opts)`** — builds the shared context object (`{EV, S, PEOPLE, IC, AV, ..., go, render, save}`) passed into each standalone section workbench, so files like `edit-event-dashboard.js` are self-contained modules.

**Persistence** is per-page, keyed by event id — there is no single global store:

| Page / module | Storage key | Access path |
| --- | --- | --- |
| `edit-event.html` and section workbenches | `'revamp-edit-event-' + EV.id` | `RevampCore.loadState()` / `saveState()` |
| `create-event.html` | `'revamp.createEvent.draft.v1'` | direct `localStorage` calls, bypasses RevampCore |
| `edit-event-marketing.js` | `KEY` (page-local) | direct `localStorage` calls, bypasses RevampCore |
| `payment/html_version/data.js` | own key | direct `localStorage` calls, separate sub-app |

`RevampCore.loadState(key)` merges saved JSON onto a default shape: `{sections:null, nav:null, checklist:null, published:false, theme:'ET Red'}`.

## Design Tokens / Visual System

**Known issue: the palette is not centralized — three different `:root` definitions exist with drifting values.**

**`edit-event.css`** (shared by `edit-event.html`, `dashboard.html`, `edit-event-dashboard.html`, `edit-event-marketing.html`):
```
--bg:#FAF7F6  --surface:#FFFFFF  --surface-2:#F3EEED  --surface-3:#E9E2E0
--border:#E0D7D5  --text:#241B1A  --text-muted:#756865
--accent:#ED1C24  --accent-strong:#B3151B  --accent-soft:#FBDBDC
--ok:#2F8F5B  --warn:#9C6B14  --info:#2F6FB0  --review:#8A5A9E
--font-display:'Fraunces',Georgia,serif
--font-body:'Manrope','Segoe UI',sans-serif
--font-mono:'IBM Plex Mono',Consolas,monospace
--topbar-h:60px  --side-w:244px
--shadow-sm/md/lg (rgba box-shadows)
```
Has a `@media (prefers-color-scheme: dark)` override block. Border radii are hardcoded per rule rather than tokenized (9px `.btn`, 7px `.btn-sm`, 13px `.rail-item`).

**`create-event.html`** defines its own independent `:root` — near-identical core values (`--bg:#FAF7F6`, `--accent:#ED1C24`) plus two tokens not present elsewhere: `--archived:#857F6A`, `--crit:#A23B36`.

**`Event_Listing.html`** defines a third, genuinely different `:root`: `--bg:#F7F7F4  --accent:#FF0035  --accent-strong:#D6002C  --ok:#16794F  --warn:#A9700F  --crit:#C13333`, plus a tag-color set found nowhere else (`--tag-blue:#1D5FA3`, `--tag-teal:#0E7C6B`, `--tag-violet:#7A3FA0`, `--tag-cyan:#0E7490`, `--tag-amber:#9C6B0B`, `--tag-rose:#B23A6B`).

`dashboard.html` has no `:root` of its own — it links `edit-event.css` directly and layers a small `<style>` block on top using `var(--bg)` etc.

Fonts are loaded via a repeated per-page Google Fonts `<link>` (not a shared partial): Fraunces (display/headings), Manrope (body), IBM Plex Mono (event codes/meta text).

## Page / Navigation Architecture

- **`sidebar.html`** — static nav partial (rail-only) with hardcoded links to `dashboard.html`, `edit-event.html#content`, `custom_editor.html`, `edit-event.html#audience/payments`, `marketing.html`, `audience-registrations.html`, `settings.html`.
- **`sidebar.js`** — defines `renderSidebar(targetId, options)` (full workspace sidebar with nav groups) and `renderEventRail(targetId, options)` (7-icon per-event rail: dashboard/content/design/payment/marketing/audience/settings). Both inject via `.innerHTML` and wire click handlers that set `location.href`.
- **Selected-event context travels via the URL**, not shared storage: `?event=<id>`, read with `new URLSearchParams(location.search).get('event')` on `edit-event.html`, `audience-registrations.html`, `marketing.html`, `settings.html`, `custom_editor.html`, `edit-event-marketing.html`. There is no global "current event" key — each page independently falls back to `'1'` or `EVENTS[0].id` when the param is missing.
- `payment/html_version/` is a fully separate sub-app with its own `sidebar.js` and `data.js`.

## Component Patterns — currently duplicated, not shared

No templating/includes exist, so several UI primitives are reimplemented per page rather than shared:

- **Toast**: `RevampCore.toast()` targets `#toast-host`; `Event_Listing.html` independently defines its own `toast(msg)` targeting a *different* DOM id (`#toast-region`) with its own CSS.
- **Modals**: `Event_Listing.html` defines its own `.modal-scrim` / `.modal-card` classes, not reused from `edit-event.css`.
- **Sidebar/rail**: implemented three different ways — the static `sidebar.html` partial, `sidebar.js`'s string-builder functions, and inline hardcoded `<nav class="rail">` markup duplicated directly inside `edit-event.html`, `create-event.html`, and `custom_editor.html`.
- **Buttons/panels/stat tiles**: shared only among pages that pull in `edit-event-core.js` + `edit-event.css`. Pages outside that family (`Event_Listing.html`, `create-event.html`) rewrite `.btn` and panel-equivalent classes from scratch.

## File / Folder Structure

```
./
  Event_Listing.html            (2228 lines — own <style>, own palette)
  audience-registrations.html   (2764 lines)
  create-event.html             (3996 lines — Create Event wizard)
  custom_editor.html            (3454 lines — site/design editor)
  dashboard.html                (194 lines — links edit-event.css)
  edit-event.html                (3926 lines — event console shell)
  edit-event.css                (shared token/style sheet)
  edit-event-core.js            (shared RevampCore module)
  edit-event-dashboard.html / .js
  edit-event-marketing.html / .js
  marketing.html                 (59 lines — thin wrapper)
  settings.html                  (39 lines — thin wrapper)
  sidebar.html / sidebar.js
  index.html                     (875 lines — sign-in/landing)
  import-figma-design/index.html
  payment/html_version/
    index.html, plans.html, transactions.html, invoicelisting.html,
    taxinvoice.html, creditnote.html, download.html, offline.html,
    data.js, index.js, sidebar.js, styles.css
  template-previews/             (10 .jpg thumbnails, full + mini per template)
```

## Create Event Wizard — State Machine (`create-event.html`)

Five top-level steps, defined as `STEPS = ['Select Event Type', 'Choose Template', 'Build content', 'AI assemble', 'First preview']`, each rendered as `<section class="step-wrap" id="step-N" hidden>` and toggled by `goStep(n)`.

State object `S` holds:
- `step` (1–5, current position)
- `basics` — name, dateMode, venue, payment, slug, etc. (step 1)
- `catPicked` — bool, step-1 sub-phase (category picker vs. form)
- `path` — `'A'` (use a template) or `'B'` (bring own design)
- `template`, `templatePick` — step-2 selection
- `sourceKind` / `sourceValue` — design source for path B
- `detectPhase` — `'input' | 'processing' | 'review'`, step-3 sub-state machine for path B (URL/design detection)
- `sections[]` — each `{id, libId, name, shape, include, data, done, source, customBrief, layout}`
- `active`, `device`, `assembled`, `celebrated`

`goStep(n)` sets `S.step`, toggles the five `hidden` sections, lazily triggers `renderStep3()/renderStep4()/renderStep5()` on entry, re-renders the rail and footer, scrolls to top, then autosaves.

`renderFoot()` gates the Next button per step (e.g. step 1 requires `!basicsIssue(S.basics)`; step 2 requires `S.path==='B' || S.templatePick`; step 3 path B requires `detectPhase==='review'`). Step 3 has its own router dispatching to either the template-section workspace (`renderBuildWorkspace`) or the URL-detection flow, depending on `S.path`.

State autosaves to `localStorage['revamp.createEvent.draft.v1']` via a debounced (~520ms) `save()`/`restore()` pair, independent of `RevampCore`'s state helpers.

## Open Design Debt

- **Palette drift**: three divergent `:root` token sets (`edit-event.css`, `create-event.html`, `Event_Listing.html`) should converge on one shared source of truth before this goes past prototype.
- **Duplicated components**: toast, modal, and sidebar/rail each have 2–3 independent implementations with different DOM ids/classes — a real risk for visual and behavioral inconsistency as pages evolve separately.
- **Fragmented persistence**: four different localStorage access patterns (`RevampCore.loadState/saveState`, two page-local direct-access variants, and the payments sub-app's own) with no single state layer — will need consolidation if/when a real backend replaces `localStorage`.
- **No shared page shell/templating**: fonts, sidebar markup, and base styles are copy-pasted per page rather than included from one place.
