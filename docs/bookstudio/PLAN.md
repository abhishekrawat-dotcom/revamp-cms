# BOOKSTUDIO in EventSphere: agreed plan (26 Nov 2026)

**Source:** the owner's Google AI Studio export, `Downloads/remix-bookstudio.zip`.
- The owner's two briefs are in its `public/assets/aistudio/Paste_*` files.
- `PRD.md` is AI Studio's own handover note.

**What it becomes:** an independent product inside EventSphere at `/books`, an InDesign-style editor for coffee table books and reports.
- It uses EventSphere's sign-in, access settings, database, file storage and AI.
- **It is never linked to events.**

## Roles

Roles are fixed per person and set in Settings › Access.

| Books role | May do |
|---|---|
| **Designer** | everything |
| **Content editor** | everything except the design |
| none | Books is hidden, and the server refuses `/api/books/*` |

Rules that apply to every role:
- Admins act as Designers.
- Everyone with a Books role sees every book; books are not assigned to people.
- There is no sign-off or approval step. Both roles can export.

**Design (Designer only):**
- page setup: size, orientation, margins, gutter, bleed, safe area, binding, spine, print settings;
- master pages and page layouts;
- the design system: colours, fonts, text styles, type scale;
- templates: apply, save and edit;
- frames: create, delete, position, size, style, layers, lock and hide;
- photo effects (filters, rounded corners);
- infographic colours and fonts.

**Content (both roles):**
- add, delete or reorder pages (a new page is made from one of the book's layouts);
- text in frames;
- photos in frames: choose, replace, move and zoom inside the frame;
- infographic data, labels, titles and chart type;
- manuscript, captions, quotes and word counts;
- AI help with content.

**Text that doesn't fit:**
- For both roles, the frame gets a red outline and a "+N words don't fit" label.
- Fit is measured with the real loaded font, not an average letter width.
- The outline and label never appear in exports.
- The pre-export check lists every frame that still overflows.

## Enforcement (server side, fails closed)

- The browser never writes to the database directly; everything goes through `/api/books/*`. The server checks sign-in, the person's Books role and the request's design and content parts.
- A Content editor's request that contains any design change is refused whole, with a sentence saying why. Tests must prove this for every design field.
- **Two people editing the same frame:** each frame's content carries a revision number. A save based on an older revision is refused with the newer text, and the screen asks whether to keep yours or theirs. Nothing is lost silently.
- Each page shows who else currently has it open.
- Deleted pages can be restored from version history.

**Proposed data layout** (to be confirmed in Phase 1):
- `books/{bookId}` holds the name, status (active or archived), `createdBy`, the design part (dimensions, print settings, design system, masters and layouts) and a revision number.
- `books/{bookId}/pages/{pageId}` holds the order, the layout it was made from, the design part (frames: geometry and style) and the content part (one entry per frame, each with its own revision).
- `books/{bookId}/versions/{versionId}` holds snapshots.
- `books/{bookId}/log/{entryId}` records who changed what.
- Storage keeps uploads at `books/{bookId}/assets/…` and exports at `books/{bookId}/exports/…`. The bucket needs CORS so the browser can draw photos onto a canvas for exports.
- Each document stays under 1 MB, so large lists live in their own documents.

## What we keep and what we replace

**Keep:** the React editor and its engines (dimension, font, master page, text, infographic, preflight, auto-flow).

**Replace:**

| Part | Replaced by |
|---|---|
| `server.ts` | `functions/lib/api-books.js`, using `access-control.js` |
| `storageService.ts` and `firebase.ts` | an EventSphere API client that sends the sign-in token |
| `aiService.ts` and `gemini-4-hydrogen` | `functions/lib/claude.js` (`gemini.js` only if pictures are ever needed) |
| `exportEngine.ts` | a vector PDF: pdf-lib with fontkit, embedded fonts, TrimBox and BleedBox |
| `bookTemplates.ts` | distinct layouts (today it's one 7-page layout in 32 skins) |

**Remove:**
- `TopToolbar.tsx`;
- the shared `.bookstudio-data` file and `uploads/` folder on the server disk;
- every endpoint that is open without sign-in.

**Build:** the React bundle is built at release into `/books`. Check that App Hosting's build runs this step.

## Bugs found in the import (fix in Phase 1)

1. **Photo upload is broken.** The app sends the field `images` and reads `data.assets`; the server takes `files` and answers `files`.
2. **IDML import is broken.** The client reads `status` and `metadata`; the server answers `isNativeIndd` and `idml`.
3. **A second save of a custom template or font collection is refused.** Every save sends a new `createdAt` (`storageService.ts:399`, `:464`), and the rules require it to stay the same.
4. **Deleting a project leaves its `versions` behind.** The batch write also isn't split into chunks below 500.
5. **Every save also goes to one shared server file that anyone can read or delete.** A signed-in user with no cloud projects yet is shown that whole shared list.
6. **Overflow is estimated**, from 0.52 × the font size per letter.
7. **The PDF is JPEG pictures of the pages.** Its text isn't sharp and its fonts aren't embedded.

## Phases

Each phase is released and tested on its own.

1. **Bring in safely**
   - `/books` in the main menu, with EventSphere sign-in.
   - Books and photos stored in our database and file store.
   - AI moved to `claude.js`.
   - Bugs 1–5 fixed and the open endpoints removed.
   - *Test:* create a book from a template, design it, save it, reopen it, upload photos.
2. **Roles**
   - A Books role in Settings › Access.
   - The design and content parts split and enforced on the server.
   - Content editor view, conflict handling, who-is-here, page restore and the activity log.
3. **Content tools**
   - Manuscript import (Word, PDF, text), poured into existing frames without moving anything.
   - Word counts per page and chapter.
   - Overflow highlight measured with the real font.
   - Photo library with low-resolution warnings.
   - AI to shorten, fit and auto-flow, behind "Edit with AI | Edit myself".
4. **Print-ready PDF**
   - Vector text, embedded fonts, bleed, trim and crop marks, and spreads.
   - The pre-export check becomes a gate.
   - CMYK is marked as not supported, because a browser can't produce it.
5. **Real templates**
   - Distinct layouts with the brief's full page set (title, copyright, foreword, gallery, interview, quote, timeline, closing…), growing to 20.
   - Designers can save pages and spreads as templates.
6. **AI design help**
   - Upload a reference book (PDF, pictures or IDML); the design system it extracts goes to the Designer for approval.
   - Layout suggestions only ever apply with the Designer's yes.

## Standing rules that apply

- **QA writes to the production database and file store.** Use only qa- ids and qa collections (a books collection prefix, like `PEOPLE_COL_PREFIX`), and clean up afterwards.
- **AI is an option beside manual editing**, never a replacement ("Edit with AI | Edit myself").
- **The AI is locked to the book it's opened in.**
- **Every visible control works**, or is clearly marked as not available.
- **Wording:** never a bare "ET"; say "ETB2B".

## Phase 1: what was built (26 Nov 2026, branch books-phase1)

- **Address and sign-in**
  - `/books.html` opens the editor, signed in by `auth.js` like every page.
  - Admins see a **Books** link in the dashboard's main menu.
  - The server lets admins only into Books (`api-books.js` `booksRole`). Phase 2 replaces that with the Books role.
- **Server** (`functions/lib/api-books.js`, routed from `api.js`)
  - Every route checks the caller.
  - Books are stored as content-addressed parts, and a save is refused (409 'stale') when it is based on an old revision.
  - Photos are kept privately, with a display copy (2400 px), a print copy and a thumbnail, served from our own address.
  - Manuscripts can be Word (each paragraph a section, headings from Word's styles), RTF, CSV, text, or a PDF read in the browser by `pdf-reader.js`.
  - IDML gives the page size, columns, margins, fonts and colours (CMYK included).
  - Fonts: the whole Google Fonts list from fonts.google.com's own list, kept a day.
  - Versions are kept gzipped in the bucket; saved templates belong to the team, font collections to each person.
- **AI** (`functions/lib/books-ai.js`)
  - The export's seven steps run through `llm.js`: Claude, with Gemini as the fallback.
  - Each step has its own model profile and a per-person rate limit.
  - Every answer is cleaned before it is used: Auto-Flow keeps only frames the book has, and template picks come only from the lists sent.
  - Copy-writing steps are told never to invent facts or figures.
  - AI use is counted against the open book.
- **Editor** (`books-app/` → `books/`)
  - No Firebase client.
  - Every call goes through `services/api.ts`.
  - The dashboard reads book summaries; a book is loaded whole when opened.
  - One save at a time per book.
  - A refused save shows "Reload the latest" and "Keep mine as a copy".
  - Undo and redo are autosaved.
  - Leaving with unsaved changes asks first.
  - Exports draw each photo's print copy.
  - The sample photos give their true sizes, and the infographics no longer write a made-up source line.
- **Bugs from the export, fixed**
  1. Photo upload.
  2. IDML import, which also missed fonts and CMYK colours.
  3. Saving a template or font collection again.
  4. Deleted books' versions: books are now kept and marked deleted.
  5. The open shared file.
  6. Not fixed: overflow is still estimated. It moves to Phase 3.

  Also fixed:
  - RTF came back empty;
  - Word paragraphs were run together;
  - the full Google Fonts list was never actually loaded;
  - the sample photos were served from a path the build never made;
  - undo and redo were not saved.
- **Tests**
  - `functions/lib/api-books.test.js` (99 checks).
  - `functions/lib/books-build.test.js` (17 checks), which also fails when `books/` was not rebuilt after a source change. To rebuild, run `cd books-app && npm install && npm run build`.

## Phase 2: what was built (27 Nov 2026, branch books-phase2)

- **Roles**
  - Settings › Access gives each person a Books role: Designer, Content editor, or none (the default). Admins are always Designers.
  - The role is the member field `books` (`access-control.js`), passed through by `api-access.js`.
  - Every `/api/books/` route needs only "viewer" from EventSphere's own roles; the Books role decides.
  - The Books menu link shows to anyone with a Books role.
- **The rule** (`functions/lib/book-rules.js`, one copy for the server and the editor)
  - `designChanges(before, after)` lists every design change in plain words; anything not named as content is design.
  - A new page must share a layout's settings (a page's, or a master's) and copy the book's own frames.
  - `mergeBooks` and `resolveConflicts` do a three-way merge: an edit is never dropped silently, and the save time never asks.
- **Server**
  - Content editors use only an allow-list of routes; anything else is 403 `designer-only`.
  - A Content editor's save that changes the design is 403 `design-only` with the reasons, and nothing is written. So is a new book, or a status change.
  - New routes: `presence` (others in the book within 70 s), `trash` and `restore-page` (deleted pages kept, restored at their position), `log` (activity; a person's saves within 10 minutes fold into one line).
- **Editor**
  - Content editors get a "Content editor" tag and lose the design controls (frame tools, Elements and Masters tabs, geometry, styles, swatches, align, page setup, design system, typography, templates, IDML, Restore version).
  - A guard refuses any design change before it is applied.
  - A stale save is merged with the newest copy. With no conflicts it is saved with "Merged with …"; with conflicts a dialog asks mine or theirs for each item.
  - "Also here" chips, and initials on page thumbnails.
  - Deleted pages and Activity tabs in Version history.
  - Overflowing text gets a red dashed outline with "+N words don't fit", never in exports.
  - All text is at least 11 px.
- **Known limits**
  - Nothing yet clears old deleted pages or presence records.
  - A Content editor's merge fails when they added a page while a Designer changed that layout: the dialog offers only "Open the newest saved copy".
  - New pages are checked frame by frame: a Content editor may combine the book's own frames on a new page.

## Phase 3 and premium templates: what was built (27 Nov 2026, branch books-phase3)

- **Text measured with the real font** (`engines/textMeasure.ts`, `textEngine.ts`)
  - A hidden canvas measures with the loaded Google font. The layout matches the canvas: columns, insets, leading, paragraph gaps, letter spacing, capitals, and breaks after hyphens and dashes.
  - It is re-measured when fonts load (`useFontsVersion`).
  - Checked against Chrome on 1,200 random frames: whether text fits matched on all of them.
  - `fitTextToFrame` and `frameCapacityWords` are shared with the pour.
- **Overflow box**
  - Designers: Shrink to fit (never below the approved minimum), Tighten spacing, Make the frame taller.
  - Both roles: Continue on the next page, Shorten with ETB2B AI, Edit myself.
- **"Edit with AI | Edit myself"** on text frames
  - Shorten to fit, grammar, clearer, or a free request, from the new AI step `edit-text` (both roles).
  - Answers are suggestions: Apply is undoable, Discard drops them.
- **Word Counts panel:** pages, spreads and chapters; text that doesn't fit, empty frames, template sample words, unplaced manuscript. It never appears in exports.
- **Pour manuscript into frames** (`engines/pourEngine.ts`, no AI)
  - Fills frames in reading order, matching kinds, only up to what fits.
  - Never moves frames, and never overwrites real words unless asked.
  - Can add pages from a layout.
  - Shows a preview, then applies as one undoable step.
- **New page layout picker:** master pages and "A copy of page N" for both roles; an empty page for Designers only.
- **Photo resolution badges:** Too low under 150 ppi, Low 150–249, Fair 250–299, Good 300+. Zoom is counted, and the pre-export check agrees.
- **Charts** now fill their frame on the canvas (they showed oversized before).
- **Five Premium Editorial templates** (`data/premiumTemplates.ts`), first in the template library:
  - Awards Annual
  - Leadership Conversations
  - Legacy Monograph
  - Architecture & Place
  - Impact Report

  Each has 16–18 pages, 4–5 own master pages, its own size, type and palette. Portrait and drawing frames are placeholders. Sample figures are marked. Five more sample photos are in `books/samples/`.
- **Tests:**
  - `books-text` (68)
  - `books-pour` (49)
  - `books-templates` (224)
  - `api-books` (250)
  - `books-build` (39)
- **Later:**
  - `exportEngine.ts` still draws text its own way (no letter spacing, breaks only at spaces). Phase 4's vector PDF should draw from `textEngine`'s layout.
  - Small portrait placeholders cut their label short.
