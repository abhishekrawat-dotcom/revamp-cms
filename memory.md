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
- **Three divergent CSS `:root` palettes** (`edit-event.css`, `create-event.html`, `Event_Listing.html`) — not yet unified. Don't assume one canonical color/token source when editing styles; check which file you're in.
- **Event context passes via URL `?event=<id>`**, not shared state — each page independently falls back to `EVENTS[0]` if missing.
- **Create Event wizard** (`create-event.html`) is a self-contained 5-step state machine (`STEPS`, `S.step`, `goStep(n)`), independent of `RevampCore`.
- **Stack mismatch**: the original brief recommends Next.js + Tailwind; the team built static HTML/JS instead. This has not been confirmed as intentional — flagged as an open question in both PRD.md and architecture.md.
- Active branches merge into `abhishek` (git user: abhishekrawat-dotcom); collaborators seen in commit history: ayush, vishakha, rohit.

## Open questions (need user input, not yet answered)

- Is the static HTML/JS stack the intended long-term direction, or should this move to Next.js/Tailwind per the original brief?
- Payments/marketing/registrations pages exist in the repo despite the brief scoping only the "Create Event" first-run flow — is this intentional scope expansion?
- No numeric success metrics defined for the CMS revamp (time-to-publish target, adoption %, etc.)
- No dated roadmap exists — Milestones in PRD.md is inferred from git history only.

## Work log

- **2026-09-21**: Wrote PRD.md, Design.md, architecture.md, memory.md based on full-repo exploration (file structure, `edit-event-core.js`, CSS tokens across pages, git log, and the `Microsite_Builder_Flow (2).docx` build brief). No code changes made this session.

<!-- Append new entries above this line as work continues: date, what changed, what was decided, what's still open. -->
