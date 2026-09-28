# Revamp CMS — Product Requirements Document

_As of 2026-09-21_

## Overview

Revamp CMS (branded "Revamp", for ET Oneworld) is a self-serve microsite builder for event pages. It lets a non-technical event owner go from "Create Event" to a live, published event microsite — basic details, template/design selection, page content, speakers, agenda, sponsors, audience registration, marketing, and payments — without filing a request with Ops or waiting on a developer.

Today the repo is a static HTML/CSS/vanilla-JS prototype: no framework, no build step, no backend. Shared state is read and written through a `RevampCore` object (`edit-event-core.js`) into browser `localStorage`.

## Background

The build brief (`Microsite_Builder_Flow (2).docx`) describes the process this replaces: an Ops team member keys event details from a Google-Sheet "IRF" intake form, and a developer hand-codes any custom page sections. That hand-off is slow and keeps non-technical staff from launching or editing an event microsite themselves.

Revamp CMS is the self-serve, AI-assisted replacement: a user either clones one of the existing event templates (annual-education-summit, making-ai-work, nbfc-leaders-retreat, surge, tech500, workplace-2035) or brings their own design (Figma, Lovable, PSD, or a URL), and the tool assembles a first preview automatically.

## Goals & Success Metrics

- Let a non-technical event owner take an event from "Create Event" to a published microsite preview with no developer or Ops hand-coding involved.
- Cut the time from event brief to first live preview from the current manual IRF-and-developer cycle down to a single guided session.
- Cover the full event lifecycle in one console: creation, template/design, content sections, speakers/agenda/sponsors, registrations, marketing, payments.

The build brief does not define numeric success metrics (target time-to-publish, adoption %, tickets deflected from Ops, etc.) — these are open and should be set with the user (see **Risks & Open Questions**).

## Target Users & Personas

- **Event owner / marketer (primary)** — non-technical staff member who creates and configures an event microsite end-to-end via the Create Event wizard and the event console (`edit-event.html`).
- **Ops team** — today keys IRF form data manually; Revamp CMS is meant to remove them from the critical path for standard events.
- **Developer** — today hand-codes custom sections; still needed for the "bring your own design" path (Figma/Lovable/PSD import) but should no longer be required for template-based events.
- **Registrant / attendee** — indirect user, interacts with the published microsite and registration/composer emails, not with the CMS itself.

Role-based access isn't implemented yet — `index.html` mentions "Roles, access, and identity" and "Governance" as CMS concepts, but there's no auth logic behind them.

## Scope

**In scope (built or in progress):**

- Event creation wizard — Basic details → Design/template selection → Build Content (per-section fill/keep/edit) → Schedule/Agenda, with autosave drafts (`create-event.html`)
- Event console — Basic details, Speakers, Agenda, Sponsors, Audience/Payments tabs (`edit-event.html`)
- Site/design editor for page sections (`custom_editor.html`)
- Event dashboard — per-event stats, Preview/Publish (`dashboard.html`)
- Event listing — filters, QR codes, activity stats (`Event_Listing.html`)
- Audience registrations — list + email/message composer with scheduled sends (`audience-registrations.html`)
- Marketing/promotions (`marketing.html`)
- Microsite settings — canonical URL, form fields, confirmation emails, footer icons (`settings.html`)
- Payments sub-app — plans, transactions, invoices, credit notes (`payment/html_version/`)
- Figma-to-HTML import tool (`import-figma-design/`)

**Out of scope per the build brief:** publishing infrastructure, payments, CRM, and email delivery were explicitly called out as out of scope for the "Create Event" first-run flow the docx spec covers. Note the repo has since grown payment and marketing/audience pages beyond that original scope — worth reconciling with the actual current intent.

## Functional Requirements

| Module | File(s) | Key capabilities |
| --- | --- | --- |
| Create Event wizard | `create-event.html` | Basic details entry, template or own-design selection, per-section content build (fill/keep/edit), agenda/schedule, autosave draft |
| Event console | `edit-event.html` | Basic details, Speakers, Agenda, Sponsors, Audience/Payments tabs, rebuilt on a shared pattern across sections |
| Site editor | `custom_editor.html`, `sidebar.js` | Section-level design editing tied to the selected template |
| Dashboard | `dashboard.html`, `edit-event-dashboard.html/js` | Per-event stats, Preview and Publish actions |
| Event listing | `Event_Listing.html` | Filter by type/date/audience, per-event QR code, activity stats, Create Event entry point |
| Registrations | `audience-registrations.html` | Registrant list, email/message composer, scheduled sends |
| Marketing | `marketing.html`, `edit-event-marketing.html/js` | Promotions section |
| Settings | `settings.html` | Canonical URL, form fields, duplicate-email handling, confirmation email behavior, footer icons |
| Payments | `payment/html_version/*.html` | Plans, transactions, invoice listing, tax invoice, credit note |
| Design import | `import-figma-design/index.html` | Pulls a Figma frame via URL + personal access token, generates absolutely-positioned HTML, node tree, live preview, download |

## Technical Requirements & Architecture

- Stack today: static HTML + CSS + vanilla JavaScript, no framework, no build tool, no `package.json`. Shared state lives in `window.RevampCore` (`edit-event-core.js`) and is persisted to browser `localStorage` — there is no backend or real API yet.
- The original build brief recommends Next.js + Tailwind for the prototype; the team has instead built directly in static HTML/JS. This divergence should be a deliberate decision, not an oversight — worth confirming (see **Risks & Open Questions**).
- Shared UI: `sidebar.html`/`sidebar.js` nav rail (Dashboard, Content, Design, Payment, Promotions, Reporting, Settings), `edit-event.css` shared styling, Google Fonts (Fraunces, Manrope, IBM Plex Mono; Playfair/Lora/Poppins/Noticia in the editor).
- External dependency: `payment/html_version/` pulls `@tabler/icons-webfont` from jsdelivr.
- No authentication, authorization, or backend persistence exists yet — `index.html`'s "Sign in to Revamp" screen and mentions of roles/governance are UI-only at this stage.

## Non-Functional Requirements

Not yet defined in the codebase or the build brief. Recommended baseline, pending confirmation:

- **Performance:** first preview should render quickly enough to demo live in a single session (the brief's stated goal is a "clickable prototype").
- **Browser support:** modern evergreen browsers (no polyfills or legacy support currently present).
- **Accessibility:** no ARIA/accessibility patterns observed in the current markup — should be defined before this ships beyond prototype stage.
- **Security:** no auth/session handling exists yet; anything beyond a prototype needs real authentication before it can hold real event or payment data client-side.

## Milestones & Timeline

Inferred from recent commit history (no dated roadmap exists in the repo):

- **Done / in progress:** Create Event wizard and its "Build Content" step; event console rebuild (Basic details, Speakers, Agenda, Sponsors on a shared pattern); custom/site editor flow; registrations composer with scheduled sends; payments sub-app; Figma import tool.
- **Not yet started or unclear:** real backend/API (state is currently `localStorage` only), authentication, publishing pipeline, defined success metrics.

No committed dates or phase gates exist yet — this section needs the actual roadmap to be more than a snapshot of recent activity.

## Risks & Open Questions

- **Scope drift from the original brief:** the build brief scopes only the "Create Event" first-run flow and explicitly excludes publishing, payments, CRM, and email — the repo already includes payment and marketing/registration pages. Confirm whether scope has intentionally expanded.
- **Stack choice:** the brief recommends Next.js + Tailwind; the repo is static HTML/vanilla JS. Confirm whether this is the intended long-term stack or a throwaway prototype layer.
- **No backend:** all state is in `localStorage`, so nothing persists across devices/users and there's no real multi-user or publish pipeline yet.
- **No auth:** the sign-in screen is UI only; roles/governance are described in copy but not implemented.
- **No defined success metrics** for the CMS revamp — see **Goals & Success Metrics**.
- **No dated roadmap** — Milestones above is a summary of git history, not a plan.
