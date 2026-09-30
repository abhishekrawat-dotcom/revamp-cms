# Revamp CMS

> A self-serve microsite builder for ET Events — from **Create Event** to a live, published event microsite without filing a ticket with Ops or waiting on a developer.

---

## Table of Contents

- [Overview](#overview)
- [Team & Branches](#team--branches)
- [Project Structure](#project-structure)
- [Modules](#modules)
  - [Auth Shell](#1-auth-shell)
  - [Event Listing](#2-event-listing)Team & Branches

  - [Create Event Wizard](#3-create-event-wizard)
  - [Event Console](#4-event-console)
  - [Site / Design Editor](#5-site--design-editor)
  - [Audience & Registrations](#6-audience--registrations)
  - [Marketing & Promotions](#7-marketing--promotions)
  - [Settings](#8-settings)
  - [Payments Sub-App](#9-payments-sub-app)
  - [Figma Import Tool](#10-figma-import-tool)
- [Architecture](#architecture)
- [Design System](#design-system)
- [State & Persistence](#state--persistence)
- [External Dependencies](#external-dependencies)
- [Git Workflow](#git-workflow)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)

---

## Overview

**Revamp CMS** (branded "Revamp", for ET Oneworld) replaces a manual Ops + developer hand-coding pipeline with a fully guided, self-serve experience. An event owner can:

1. Create an event (name, dates, venue, template/design)
2. Build and customise page content section by section
3. Manage speakers, agenda, sponsors, and audience registrations
4. Handle payments, invoices, and credit notes
5. Run marketing campaigns and promotions
6. Preview and publish the microsite — all without touching a line of code

**Stack:** Static HTML + CSS + Vanilla JavaScript. No framework, no build step, no `package.json`. Shared state lives in `window.RevampCore` (`edit-event-core.js`) and is persisted in browser `localStorage`.

---

## Team & Branches

| Branch | Purpose |
|--------|---------|
| `main` | Stable, reviewed code — what everyone sees by default |
| `abhishek` | Integration branch — feature branches merge here before going to `main` |
| `shruti` | Feature work |
| `rohit` | Payment module & feature work |

---

## Project Structure

```
revamp-cms/
│
├── index.html                    # Auth shell / sign-in screen
├── dashboard.html                # Per-event stats & publish actions
├── Event_Listing.html            # Event catalogue with filters & QR codes
├── create-event.html             # 5-step Create Event wizard
├── edit-event.html               # Event console (Basics, Speakers, Agenda, Sponsors)
├── edit-event-core.js            # Shared RevampCore module (data, formatters, UI)
├── edit-event.css                # Shared stylesheet for event console pages
├── edit-event-dashboard.html/js  # Dashboard section workbench
├── edit-event-marketing.html/js  # Marketing section workbench
├── custom_editor.html            # Site / design editor (section-level editing)
├── editor-canvas.js/css          # Editor canvas rendering
├── editor-fill.js                # Editor fill/content logic
├── editor-store.js               # Editor state store
├── audience-registrations.html   # Registrant list + email composer
├── marketing.html                # Promotions & marketing overview
├── settings.html                 # Microsite settings (URL, forms, emails, footer)
├── sidebar.html / sidebar.js     # Shared nav rail renderer
├── theme-toggle.js               # Dark/light mode toggle
├── motion.css                    # Shared animations
├── banner.html                   # Banner module
├── ag-psd.bundle.js              # PSD import bundle
│
├── payment/
│   └── html_version/             # Payments sub-app (self-contained)
│       ├── index.html            # Payments landing / overview
│       ├── index.js              # All payments logic
│       ├── data.js               # Payments seed data & state
│       ├── sidebar.js            # Payments-specific nav
│       ├── styles.css            # Payments stylesheet
│       ├── pages.html            # Payments page shell
│       ├── plans.html            # Subscription / ticketing plans
│       ├── transactions.html     # Transaction history
│       ├── invoicelisting.html   # Invoice list
│       ├── taxinvoice.html       # Tax invoice view
│       ├── creditnote.html       # Credit note view
│       ├── download.html         # Download invoices/receipts
│       └── offline.html          # Offline fallback
│
├── import-figma-design/
│   └── index.html                # Figma → HTML import tool
│
├── templates/                    # Built-in event microsite templates
├── template-previews/            # Preview thumbnails for templates
├── assets/                       # Shared static assets
├── tools/                        # Utility scripts
│
├── PRD.md                        # Product Requirements Document
├── architecture.md               # System architecture deep-dive
├── Design.md                     # Design tokens, component details, data model
└── memory.md                     # Running dev notes & decisions log
```

---

## Modules

### 1. Auth Shell

**File:** `index.html`

The sign-in / landing screen for Revamp CMS. Includes UI for sign-in, role mentions (Event Owner, Ops, Developer), and governance concepts.

> ⚠️ Auth is **UI-only** — there is no real authentication or session logic behind this screen yet.

---

### 2. Event Listing

**File:** `Event_Listing.html`

The main catalogue view showing all events across ET portals.

**Features:**
- Filter by event type, date range, portal, and audience
- Per-event QR code generation
- Activity stats per event (registrations, visits, mailers)
- **Create Event** entry point

---

### 3. Create Event Wizard

**File:** `create-event.html`

A 5-step guided wizard for creating a new event microsite from scratch.

**Steps:**
1. **Basic Details** — event name, dates, venue, portal, type
2. **Template / Design Selection** — choose from 6 built-in templates or bring your own (Figma, PSD, Lovable, URL)
3. **Build Content** — per-section fill / keep / edit with AI-assisted first draft
4. **Speakers & Agenda**
5. **Review & Finish** — serialises draft → hands off to `custom_editor.html`

**Autosave:** drafts saved to `localStorage['revamp.createEvent.draft.v1']` on a ~520ms debounce.

**Available templates:** `annual-education-summit`, `making-ai-work`, `nbfc-leaders-retreat`, `surge`, `tech500`, `workplace-2035`

---

### 4. Event Console

**File:** `edit-event.html`

The main per-event editing console, reached after event creation. Organised into tabbed sections:

| Tab | Content |
|-----|---------|
| **Basic Details** | Event name, dates, venue, portal, status |
| **Speakers** | Speaker profiles, bios, headshots |
| **Agenda** | Session schedule, time slots, session types |
| **Sponsors** | Sponsor tiers, logos, URLs |
| **Audience / Payments** | Links to registrations and payment sub-app |

Shared runtime: `edit-event-core.js` (`window.RevampCore`). State persisted to `localStorage['revamp-edit-event-' + eventId]`.

---

### 5. Site / Design Editor

**File:** `custom_editor.html`

A section-level visual editor for the event microsite, built on top of the selected template.

**Features:**
- Section-by-section content editing (hero, about, speakers, agenda, sponsors, footer)
- Live preview panel
- Per-template design theme (fonts, colours, layout)
- Receives hand-off payload from the Create Event wizard via `localStorage['revamp.editor.handoff.v1']`
- PSD import support via `ag-psd.bundle.js`

---

### 6. Audience & Registrations

**File:** `audience-registrations.html`

Manage event registrants and send communications.

**Features:**
- Registrant list with attendee details (name, company, city, source, payment status)
- Email / message composer
- Scheduled send support

---

### 7. Marketing & Promotions

**Files:** `marketing.html`, `edit-event-marketing.html`, `edit-event-marketing.js`

Campaign and promotion management for an event.

**Features:**
- Promotion creation and tracking
- Marketing stats overview

---

### 8. Settings

**File:** `settings.html`

Microsite-level configuration.

**Features:**
- Canonical URL management
- Custom registration form fields
- Duplicate-email handling rules
- Confirmation email behaviour
- Footer icon configuration

---

### 9. Payments Sub-App

**Directory:** `payment/html_version/`

A self-contained payments module, independently styled and state-managed. Linked from the event console's Audience/Payments tab.

| Page | Description |
|------|-------------|
| `index.html` | Payments overview & summary |
| `plans.html` | Ticketing / subscription plans |
| `transactions.html` | Transaction history & status |
| `invoicelisting.html` | Invoice list |
| `taxinvoice.html` | Detailed tax invoice view |
| `creditnote.html` | Credit note view |
| `download.html` | Download invoices and receipts |
| `offline.html` | Offline / error fallback |

**Key files:**
- `data.js` — seed data, event/plan/transaction state, localStorage persistence
- `index.js` — all rendering and interaction logic (~75KB)
- `sidebar.js` — payments-specific nav rail
- `styles.css` — payments design system (independent of `edit-event.css`)

> 💡 **Dev note:** All payment changes live in `payment/html_version/` within this repo.

---

### 10. Figma Import Tool

**File:** `import-figma-design/index.html`

Import a Figma frame and convert it to absolute-positioned HTML.

**Features:**
- Input: Figma file URL + personal access token
- Output: generated HTML, node tree view, live preview, one-click download
- Calls the Figma REST API directly from the browser (no backend/proxy)

---

## Architecture

Revamp CMS is a **client-only static prototype** — no server, no build step, no API.

```
Browser
  └── Static HTML files (~20 pages)
        ├── edit-event-core.js  (RevampCore — shared runtime for event console family)
        ├── edit-event.css      (shared styles)
        └── localStorage        (all persistence)

External:
  ├── Google Fonts CDN
  ├── Tabler Icons CDN (jsdelivr) — payments only
  └── Figma REST API — import tool only
```

### Navigation

Pages communicate via:
1. **Full page navigation** — `<a href>` / `location.href` driven by `sidebar.js`
2. **URL query string** — `?event=<id>` carries the current event across page loads

Each page re-derives its own event object independently. There is no shared session or client-side router.

### Page Flow

```
Event_Listing.html
  ├── → create-event.html (5-step wizard)
  │       └── → custom_editor.html (handoff via localStorage)
  └── → dashboard.html (?event=id)
          ├── → edit-event.html        (Basics / Speakers / Agenda / Sponsors)
          ├── → custom_editor.html     (Site Editor)
          ├── → marketing.html
          ├── → audience-registrations.html
          ├── → settings.html
          └── → payment/html_version/  (Payments sub-app)
```

---

## Design System

### Colour Palette (Event Console — `edit-event.css`)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#FAF7F6` | Page background |
| `--surface` | `#FFFFFF` | Cards, panels |
| `--accent` | `#ED1C24` | ET Red — primary actions |
| `--accent-strong` | `#B3151B` | Hover / pressed state |
| `--ok` | `#2F8F5B` | Success / active |
| `--warn` | `#9C6B14` | Warning |
| `--review` | `#8A5A9E` | Review / pending |
| `--text` | `#241B1A` | Primary text |
| `--text-muted` | `#756865` | Secondary text |

Dark mode is supported via `[data-theme="dark"]` (toggled by `theme-toggle.js`, persisted to `localStorage['revamp-theme']`).

### Typography

| Role | Font |
|------|------|
| Display & Body | Inter |
| Monospace | IBM Plex Mono |
| Microsite preview | Per-template (Fraunces, Manrope, Poppins, Playfair Display, etc.) |

### Layout

- **Topbar height:** `60px` (`--topbar-h`)
- **Sidebar width:** `244px` (`--side-w`)

---

## State & Persistence

All state is stored in `localStorage`. There is no backend or cross-device sync.

| Module | localStorage Key | Access |
|--------|-----------------|--------|
| Event console | `revamp-edit-event-<eventId>` | `RevampCore.loadState()` / `saveState()` |
| Create Event draft | `revamp.createEvent.draft.v1` | Direct `localStorage` calls |
| Editor hand-off | `revamp.editor.handoff.v1` | Written by wizard, read by editor |
| Marketing | page-local key | Direct `localStorage` calls |
| Payments | own key | Direct `localStorage` calls |
| Theme preference | `revamp-theme` | `theme-toggle.js` |

---

## External Dependencies

| Dependency | Used by | How |
|-----------|---------|-----|
| Google Fonts (Inter, IBM Plex Mono, Fraunces, Manrope) | All pages | `<link>` per page |
| Tabler Icons (`@tabler/icons-webfont@3.19.0`) | `payment/html_version/` | jsdelivr CDN |
| Figma REST API | `import-figma-design/index.html` | Browser-side fetch with user PAT |
| ag-psd (PSD parser) | `custom_editor.html` | `ag-psd.bundle.js` (bundled locally) |

No `npm install` required — all external resources are loaded from CDN or bundled.

---

## Git Workflow

```bash
git pull origin main          # pull latest
git checkout -b feature/name  # create a branch
git add .
git commit -m "feat: description"
git push origin <your-branch> # push and open a PR
```

---

## Known Limitations

| Area | Current State |
|------|--------------|
| **Authentication** | Sign-in is UI-only — no real auth or session |
| **Backend** | None — all state is `localStorage` only (no cross-device, no real publish) |
| **Persistence** | Fragmented across 4 different localStorage access patterns |
| **Design tokens** | 3 divergent `:root` definitions across the codebase |
| **Accessibility** | No ARIA patterns implemented yet |
| **Analytics** | No tracking or error monitoring |
| **CI/CD** | No automated deployment pipeline |

---

## Roadmap

Inferred from current state — no formal dated plan exists yet.

- [x] Create Event wizard (5-step flow)
- [x] Event console (Basics, Speakers, Agenda, Sponsors)
- [x] Site / design editor with template support
- [x] Audience registrations + email composer
- [x] Payment sub-app (plans, transactions, invoices, credit notes)
- [x] Figma → HTML import tool
- [x] Dark mode support
- [ ] Real backend / API (replace `localStorage`)
- [ ] Authentication & role-based access
- [ ] Publishing pipeline (Publish = real deploy, not a toast)
- [ ] Unified design token system across all modules
- [ ] Accessibility (ARIA, keyboard navigation)
- [ ] CI/CD and deployment config

---

## Related Docs

| Document | Description |
|----------|-------------|
| [`PRD.md`](PRD.md) | Product requirements, goals, scope, risks |
| [`architecture.md`](architecture.md) | System architecture, data flow, module boundaries |
| [`Design.md`](Design.md) | Design tokens, component details, data model |
| [`memory.md`](memory.md) | Running dev decisions & notes log |
