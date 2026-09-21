# Revamp CMS — Project Memory

_Running context file. Read this first in any new session on this repo, and append to it as work progresses — don't let it go stale._

## What this project is

Revamp CMS ("Revamp", for ET Oneworld) is a self-serve microsite builder for event pages — lets a non-technical event owner go from "Create Event" to a published microsite without Ops keying an intake form or a developer hand-coding sections. Full detail: [PRD.md](PRD.md).

Current implementation is a **static HTML/CSS/vanilla-JS prototype** — no framework, no build step, no backend. State lives in browser `localStorage`. Full detail: [Design.md](Design.md), [architecture.md](architecture.md).

## Docs in this repo

| File | Covers |
| --- | --- |
| [PRD.md](PRD.md) | Product scope, goals, personas, functional requirements, risks |
| [Design.md](Design.md) | Data model (`RevampCore`), CSS design tokens, component patterns, wizard state machine, design debt |
| [architecture.md](architecture.md) | System-level module boundaries, navigation/data flow diagrams, target-vs-current architecture gap |
| `Microsite_Builder_Flow (2).docx` | Original build brief this project is based on — recommends Next.js + Tailwind (repo diverged to static HTML/JS) |

## Facts worth remembering across sessions

- **Brand/target site**: ET Oneworld — "Published. The microsite is live at etoneworld.com" (from `dashboard.html`).
- **No backend, no auth, no real persistence** — everything is `localStorage`, per-page, per-event-id. Four different access patterns exist (`RevampCore.loadState/saveState`, two page-local direct variants, payments sub-app's own).
- **Three divergent CSS `:root` palettes** (`edit-event.css`, `create-event.html`, `Event_Listing.html`) — not yet unified. Don't assume one canonical color/token source when editing styles; check which file you're in. Fonts *are* unified as of 2026-09-21 though: `--font-body`/`--font-display` are Inter in every `:root` (colors/spacing tokens still diverge).
- **CMS chrome font is Inter** (`--font-body`/`--font-display` in every page's `:root`, as of 2026-09-21) — but the **microsite preview inside `custom_editor.html`** (the `.site-section` content) intentionally uses its own separate `--site-body-font`/`--site-display-font` tokens (default Manrope/Fraunces, overridden per template — see the per-template theming entry below). Don't "fix" those to Inter; they're deliberately independent so themed content matches each real ET template's typography.
- **Event context passes via URL `?event=<id>`**, not shared state — each page independently falls back to `EVENTS[0]` if missing.
- **Create Event wizard** (`create-event.html`) is a self-contained 4-step state machine (`STEPS`, `S.step`, `goStep(n)`), independent of `RevampCore`. Step 4 hands the draft to `custom_editor.html` via `localStorage['revamp.editor.handoff.v1']` + `?from=create`; the wizard has no preview step of its own.
- **Only `custom_editor.html` declared `<meta charset="utf-8">`** — `edit-event.html` and `index.html` still don't, so their UTF-8 source (em/en dashes, `·`) renders as mojibake. `create-event.html` was fixed 2026-09-21; the other two are outstanding.
- **Stack mismatch**: the original brief recommends Next.js + Tailwind; the team built static HTML/JS instead. This has not been confirmed as intentional — flagged as an open question in both PRD.md and architecture.md.
- Active branches merge into `abhishek` (git user: abhishekrawat-dotcom); collaborators seen in commit history: ayush, vishakha, rohit.

## Open questions (need user input, not yet answered)

- Is the static HTML/JS stack the intended long-term direction, or should this move to Next.js/Tailwind per the original brief?
- Payments/marketing/registrations pages exist in the repo despite the brief scoping only the "Create Event" first-run flow — is this intentional scope expansion?
- No numeric success metrics defined for the CMS revamp (time-to-publish target, adoption %, etc.)
- No dated roadmap exists — Milestones in PRD.md is inferred from git history only.

## Work log

- **2026-09-21**: Unified the CMS chrome font on Inter. Changed `--font-body`/`--font-display` to Inter in every page's `:root` (`create-event.html`, `custom_editor.html`, `edit-event.css`, `index.html`, `Event_Listing.html`, `import-figma-design/index.html`, `payment/html_version/styles.css`), added Inter to each page's Google Fonts `<link>` (and added a `<link>` where none existed — all 8 `payment/html_version/*.html` pages). Left the microsite-preview fonts inside `custom_editor.html` (`--site-body-font`/`--site-display-font`, and each template's own display font from [Per-template design theme](Design.md#per-template-design-theme)) untouched — confirmed with the user this should be CMS-chrome-only. Also fixed `dashboard.html`'s body rule, which referenced the undefined `var(--font-sans)`, to `var(--font-body)`.
  - While testing, found and fixed a real pre-existing bug: `goStep(2)` never called `renderStep2()`, so the category-scoped template gallery only reflected whatever category was active at page load — picking Awards or Client (Custom Events) after that showed the wrong (IP) templates in step 2, or none matching `data-pick`. Now `goStep(2)` re-renders it like steps 3/4 already did. Also fixed a batch of stale "Step N of 5" eyebrow labels left over from the step-5 removal below (should all read "of 4"), including one that was already mislabeled "Step 2" instead of "Step 3" before that removal.
- **2026-09-21**: Per-template design theme for the editor hand-off. "same design should open as the selected template" — the site editor now themes itself to match the picked template's actual on-site design (colors, hero treatment, display font), not just its content. Added `TEMPLATE_THEMES`/`DEFAULT_THEME`/`currentTheme()` to `create-event.html` (one theme per template id, condensed from `template-previews/*-full.jpg`) and tokenized `custom_editor.html`'s site-content CSS to `--site-*` custom properties (`applySiteTheme()` + `SITE_THEME_VARS` writes them onto `#frame`). Added a second hero markup, `.s-hero-banner` (full-bleed, centred — how every real IP/Residential/Awards template actually opens), selected via `theme.heroStyle`; Leadgen and the no-template default keep the original two-column `.s-hero`. Verified all 8 templates end-to-end in headless Chromium (screenshotted each) plus byte-for-byte PNG parity of the untouched demo site before/after.
- **2026-09-21**: Create Event step 3 → site editor hand-off. "Assemble my site" now ends the wizard in `custom_editor.html`, opened on the picked template filled with the step-3 content, instead of the in-page mock preview. Added `editorSectionHtml()`/`buildEditorPayload()`/`openInEditor()` to `create-event.html` (maps each library shape to the editor's own `s-*` markup with `data-editable` hooks) and `applyCreateHandoff()` to `custom_editor.html` (gated on `?from=create`; without it the demo site still loads). Removed the now-superseded step 5 "First preview" (`renderStep5`, `previewSection`, `summaryRows`, `S.device`, `S.celebrated`) — the rail is 4 steps. Also: added the missing `<meta charset="utf-8">` to `create-event.html`, and the Publish modal in the editor now uses the real event name/slug. Verified end-to-end in headless Chromium (TECH500 straight-through, SURGE via the Preview modal with sections switched off, plain editor open unchanged).
  - Still open: the hero avoids the `.lead` class because `edit-event.css`'s global `.lead` rule leaks a bordered box into the editor canvas (it hits the editor's own demo hero too) — worth scoping that rule properly.
- **2026-09-21**: Wrote PRD.md, Design.md, architecture.md, memory.md based on full-repo exploration (file structure, `edit-event-core.js`, CSS tokens across pages, git log, and the `Microsite_Builder_Flow (2).docx` build brief). No code changes made this session.

<!-- Append new entries above this line as work continues: date, what changed, what was decided, what's still open. -->
