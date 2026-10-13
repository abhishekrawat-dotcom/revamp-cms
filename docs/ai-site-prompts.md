# The prompts behind an AI-designed site

Generated from the code on 2026-10-13 with a real test event ("QA CIO Leadership Awards 2027"). The wording lives in `functions/lib/api.js` and `functions/lib/gen-design.js`; where a prompt contains event data, the data shown is that test event's. Edit the wording there, not here.

A site is made in five steps. Each is one request to Gemini (`gemini-3.8-flash` for text, `gemini-2.5-flash-image` for pictures).

## 1. Read the brief (`buildExtractBriefPrompt`)

Sent with the description and, when given, the PDF.

````text
You are extracting a structured brief from an event overview document, for ET Oneworld's event microsite builder.

Event basics (already known, given here only for context — do not repeat them back as extracted content):
{
  "name": "QA CIO Leadership Awards 2027",
  "category": "ip",
  "city": "New Delhi",
  "description": "An awards night and leadership forum recognising India's top CIOs and technology leaders. 30 award categories, a jury of 12 industry veterans, a keynote stage with 20 speakers, a partner showcase with 25 technology partners, and a gala dinner. Past winners testimonials. Audience: CIOs, CTOs, CDOs of large enterprises."
}

The document is attached. Read it and extract ONLY what it actually says or clearly implies. Never invent a
track, speaker, sponsor or claim that isn't in the document — an empty array/field is correct when the
document simply doesn't cover that, better than a plausible-sounding guess.

inferredCategory specifically: name the short industry/category this event genuinely reads as (e.g.
"enterprise AI leadership", "CIO technology leadership", "retail / e-commerce") — base it only on real
signal in the document (its subject matter, audience, themes), never on the event basics above, and never
invent one if the document itself gives no real signal to go on — an empty string is the correct answer then.
````

## 2. Read each reference page (`buildIngestSourcePrompt`)

Once per link (previous edition, current edition, competitors). The page text and its markup skeleton are appended where shown.

````text
Below are two views of a real event microsite (this same event's previous edition), https://example.com/previous-edition: first its visible text with the markup stripped, then its markup skeleton (tags and class names, the text cut to a few words).

From the SKELETON, fill in "design": how the page is laid out and styled, section by section, so that a designer who never saw the page could rebuild its structure and visual character. If the skeleton is empty or shows almost nothing (a page drawn by script), say so in layoutStyle and leave sectionPattern empty rather than inventing a layout.

From the TEXT, fill in "sections" as follows.
Extract its main CONTENT sections, in the order they appear on the page (e.g. hero/intro, about, agenda highlights, speaker/why-attend, stats, sponsors, FAQ — whatever this page actually has). Skip navigation links, footer boilerplate, cookie/legal notices, and ad/widget text.

For each section, summarize its own text in your own words (1-3 sentences) — never quote or closely paraphrase its sentences, this is for structural inspiration only, not content to reuse.

Page text:
(the page's visible text, up to 50,000 characters)

Markup skeleton:
(the page's tags and class names, up to 14,000 characters)
````

## 3. Design the site (`buildDesignPlanPrompt`)

### 3a. When there is no reference page (this test event; the owner chose Dark)

````text
You are the lead designer of a bespoke event microsite, for ET Oneworld's event builder. You decide its SECTION STRUCTURE, the layout of every section, its colours and type, and which sections carry a picture. A second step writes the HTML and CSS from exactly what you decide here, so be specific.

There is no previous edition or competitor page to model this site on, so its design starts from this art direction, chosen for this event — build the whole page on it, do not fall back on a generic dark-navy-and-gold conference look:
Editorial magazine: A print-magazine feel: a large serif headline, generous white space, asymmetric two-column spreads, thin rules between sections, pictures set as framed editorial plates with captions.

Ground every section in real content-shape evidence from the material below — never include a section that has nothing real to put in it, and never omit one the material clearly supports. A thin site with 3 well-grounded sections beats a padded one with 7 that have nothing real to say.

nav, hero and footer are always present — never include them in your sections list, those are added automatically. Everything else is yours: section ids, purposes, ordering and count.

Set each section's kind to "custom" unless it is really one of 5 specific data-bound types, each backed by real records the ET ops team manages by hand, never your invention: "speakers" (real speaker bios), "faq" (real FAQs), "partners" (real sponsor/partner logos), "contact" (real contacts), "glimpses" (a real photo gallery). Only use one of those 5 when the material genuinely supports that this event will have real data of that kind.

LAYOUT: give every section its own layout (sections[].layout) and make neighbouring sections differ — a page of identical centred-heading-plus-card-grid sections is a failure. Mix: picture/text splits, full-width bands, large-number rows, timelines, quote blocks, card grids, lists, and a carousel (a sideways-scrolling row with previous/next buttons — say "carousel" in the layout) where a section has many items of one kind, such as speakers, partner logos, photos or testimonials, or where the reference uses one.

PICTURES: the site must not be text only. The hero has a background picture (design.heroImage). Besides it, give up to 4 "custom" sections a picture (sections[].image) — the ones where a picture carries meaning, spread down the page — and design those sections around their picture (a split, a framed plate, a full-bleed band). Data-bound sections (speakers, partners, glimpses, faq, contact) show real records and get no generated picture. Pictures show objects, spaces or abstract forms that evoke the subject: never people, never text or logos, never something that could pass for a photograph of this event.

Event (already known):
{
  "name": "QA CIO Leadership Awards 2027",
  "category": "ip",
  "city": "New Delhi",
  "description": "An awards night and leadership forum recognising India's top CIOs and technology leaders. 30 award categories, a jury of 12 industry veterans, a keynote stage with 20 speakers, a partner showcase with 25 technology partners, and a gala dinner. Past winners testimonials. Audience: CIOs, CTOs, CDOs of large enterprises."
}

Extracted brief:
{
  "theme": "An awards night and leadership forum recognising India's top CIOs and technology leaders.",
  "audience": "CIOs, CTOs, CDOs of large enterprises",
  "tone": "formal leadership awards and executive recognition",
  "tracks": [],
  "speakerHints": [],
  "sponsorHints": [],
  "keyMessages": [
    "Recognising India's top CIOs and technology leaders across 30 award categories",
    "Evaluation by a jury of 12 industry veterans",
    "Keynote stage featuring 20 speakers",
    "Partner showcase featuring 25 technology partners",
    "Celebratory gala dinner and past winner testimonials"
  ],
  "inferredCategory": "CIO technology leadership"
}

COLOUR AND TYPE:
The owner asked for a DARK site: design.mode must be "dark", with a dark background and light text. This is not negotiable.
No previous edition was given, so there is no brand colour or font to carry over. Choose a considered palette and font pairing that fit THIS event's subject and the direction above — a different event must get a visibly different palette.
Text must be easy to read: textColor against backgroundColor at a contrast of 7:1 or more, mutedColor at 4.5:1 or more.

Task — produce:
- reasoning: internal only, never shown on the site. Name the evidence behind each section and each design choice.
- design: mood, mode, the six colours, the two fonts (real Google Fonts family names), layout, imageStyle, heroImage.
- sections: the middle sections, each with id, kind, purpose, layout and image.
````

### 3b. When a previous edition was given (theme left to the design) — only the parts that differ are the opening block and COLOUR AND TYPE

````text
You are the lead designer of a bespoke event microsite, for ET Oneworld's event builder. You decide its SECTION STRUCTURE, the layout of every section, its colours and type, and which sections carry a picture. A second step writes the HTML and CSS from exactly what you decide here, so be specific.

THE REFERENCE THIS SITE IS MODELLED ON — this same event's previous edition (https://example.com/previous-edition). This is the core requirement: the new site must be recognisably built on this reference's structure and visual language, then improved — not an unrelated design.
{
  "layoutStyle": "(what step 2 read from that page)",
  "heroStyle": "…",
  "sectionPattern": [
    "Hero — …",
    "Speakers — …"
  ],
  "imageryStyle": "…",
  "typography": "…",
  "density": "balanced"
}
Its page background is light.

Follow it like this: keep its section order and the kind of layout each of its sections uses wherever this event has real content for that section (your sections[].layout should echo its sectionPattern entry); keep its hero construction; keep its typographic character and its density; keep its use of imagery. Then improve on it: fix what is weak, drop what this event has no content for, and add what the material below supports.

…(the rest is as in 3a)…

COLOUR AND TYPE:
The owner left light or dark to you: the reference page is light, so stay light unless that plainly does not suit this event.
Found on this event's own previous edition — this is the event's existing brand, so carry it over unless it is plainly unusable (and say why in reasoning):
brand colour: #00827b
heading font: Cormorant Infant
body font: Inter
Text must be easy to read: textColor against backgroundColor at a contrast of 7:1 or more, mutedColor at 4.5:1 or more.

Task — produce:
- reasoning: internal only, never shown on the site. Name the evidence behind each section and each design choice, and say what you kept from the reference and what you changed.
- design: mood, mode, the six colours, the two fonts (real Google Fonts family names), layout, imageStyle, heroImage.
- sections: the middle sections, each with id, kind, purpose, layout and image.
````

## 4. Make the pictures (`genDesign.imagePrompt`)

One request per picture: the hero and up to four sections.

````text
Create the wide background picture for the hero banner of a professional event website. Text and buttons will sit on top of it, so keep the composition calm, with open space and no strong detail in the centre. Subject: A monolithic brushed bronze and black basalt geometric sculpture standing in a cavernous gallery space under dramatic theatrical downlighting.. Visual style: Architectural chiaroscuro still lifes featuring heavy bronze, monolithic stone, and optical glass illuminated by razor-sharp directional gallery lighting.. Palette: dark and moody, with #cca462 and #b4bcc8 present as accents. Every picture on this site shares this one style, so that they read as a set. Landscape, 16:9. STRICT: no people, no faces, no crowds, no hands, no text, no letters, no numbers, no logos, no watermarks, no flags, no recognisable real building or landmark. This illustrates a theme; it must never look like a photograph of this event, its venue or its attendees.

Create one picture for a section of a professional event website. Subject: A sculptural composition of dark fluted stone columns intersecting with polished metallic geometric planes under soft golden accent light.. Visual style: Architectural chiaroscuro still lifes featuring heavy bronze, monolithic stone, and optical glass illuminated by razor-sharp directional gallery lighting.. Palette: dark and moody, with #cca462 and #b4bcc8 present as accents. Every picture on this site shares this one style, so that they read as a set. Landscape, 4:3. STRICT: no people, no faces, no crowds, no hands, no text, no letters, no numbers, no logos, no watermarks, no flags, no recognisable real building or landmark. This illustrates a theme; it must never look like a photograph of this event, its venue or its attendees.
````

## 5. Write the HTML and CSS (`buildSectionCodePrompt`)

Sent twice, side by side, each asking for half of the sections.

````text
You are writing the REAL HTML and CSS of a bespoke event microsite, for ET Oneworld's event builder — designing and coding it yourself to the standard of a top agency, not filling a template. Ground every fact below — never invent a date, number, named person or company that isn't clearly present in the material. Leave out what nothing supports; never pad with generic filler.

THE DESIGN — decided already; every section follows it, so the page reads as one piece:
Mood: A prestigious high-society print gazette brought into the digital realm. Expansive typographic drama anchored by an imposing editorial serif, austere charcoal tones, warm champagne hairline accents, and strictly framed editorial plates that treat enterprise leadership as an enduring discipline.
Layout system: Structured around asymmetric editorial spreads, precise hairline dividers, and high-contrast typographic scales. Sections alternate between wide multi-column print indices, framed plate-and-essay compositions, and full-width stat strips, leading into structured data presentations.
Page is DARK (light text on a dark background).

Colours and fonts are CSS variables already defined on the page — use the variables, never the raw values, so that the owner can restyle the site later:
  var(--theme-color)   #cca462   brand colour: buttons, links, highlights
  var(--accent-color)  #b4bcc8   second colour
  var(--rv-bg)         #0f1012   page background
  var(--rv-surface)    #181a1e   cards, alternating bands
  var(--rv-text)       #f3f4f6   body text
  var(--rv-muted)      #9ca3af   secondary text
  var(--heading-font-family)  Newsreader   headings (loaded)
  var(--body-font-family)     Plus Jakarta Sans   everything else (loaded)
A band may invert (theme colour or a dark/light opposite as its background) for rhythm, as long as the text on it stays strongly readable.

SHARED RULES — written identically in every section, because sections are styled separately:
- Content sits in a container: max-width 1200px, margin 0 auto, padding 0 24px. Sections have vertical padding clamp(64px, 9vw, 128px).
- Corner radius 0px on cards, pictures and inputs. Buttons: padding 15px 30px, radius 0px, font-weight 600, font-size 1rem; primary = var(--theme-color) background with a readable text colour; secondary = outlined.
- TYPE MUST BE EASY TO READ. Use rem or px for every font-size — never em or %. Paragraph and list text: 1.125rem (18px) or larger, line-height 1.65, in var(--rv-text) or var(--rv-muted), lines no longer than about 70 characters (max-width: 68ch). Section headings (h2): clamp(2rem, 4.2vw, 3.25rem), line-height 1.1. Hero headline (h1): clamp(2.6rem, 6.5vw, 5rem). Card titles: 1.25rem or larger. Small labels and captions: never below 0.875rem. Set font-family, font-size, line-height and color explicitly on the text you write; do not rely on inherited values.
- Responsive without script: grids and splits collapse to one column under 820px (use @media (max-width: 820px)); nothing may cause sideways scrolling; pictures are width:100%, height:auto or object-fit:cover inside a sized frame.
- Give the page visual rhythm: do not build two neighbouring sections the same way. Follow each section's own "layout" below exactly.
- CAROUSELS: where a section's layout calls for a carousel or slider (a row with more cards, logos, quotes or photos than fit), mark the wrapper with data-rv-carousel (data-rv-carousel="auto" to make it advance by itself) and the element that directly holds the items with data-rv-carousel-track. Give each item a width (e.g. flex: 0 0 min(360px, 82vw)). The page makes the track scroll sideways and adds the previous/next buttons itself — never draw arrows, dots or a scrollbar of your own, and never write animation to move the items.

PICTURES — the site must not be text only:
- Hero background picture, already made: https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/qa-gen-c/generated/hero-bg.png?v=20261013063228 — use it as the hero's background (background-image, cover, centred) under a gradient veil strong enough that the headline is easy to read.
- Section "curators-note" has a picture, already made: https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/qa-gen-c/generated/20261013063228-curators-note.png (it shows: A sculptural composition of dark fluted stone columns intersecting with polished metallic geometric planes under soft golden accent light.). Use it with <img src="…" alt="…" loading="lazy"> and give it real presence — at least 320px tall on desktop, object-fit: cover — placed as that section's layout says.
- Section "jury-framework" has a picture, already made: https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/qa-gen-c/generated/20261013063228-jury-framework.png (it shows: Macro architectural view of precision brass measurement scales and polished black marble blocks resting on a dark velvet surface.). Use it with <img src="…" alt="…" loading="lazy"> and give it real presence — at least 320px tall on desktop, object-fit: cover — placed as that section's layout says.
- Section "gala-evening" has a picture, already made: https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/qa-gen-c/generated/20261013063228-gala-evening.png (it shows: Low-key interior view of an elegant formal banquet setting featuring amber tea lights, crystal glassware, and dark structured table linens.). Use it with <img src="…" alt="…" loading="lazy"> and give it real presence — at least 320px tall on desktop, object-fit: cover — placed as that section's layout says.
- Use ONLY the picture addresses given above; never link to any other image address and never invent one. Elsewhere, add visual interest with CSS: inline SVG icons you draw yourself (simple line icons, stroke="currentColor"), large numerals, coloured shapes, rules and gradients.

THE EVENT'S LOGO: https://storage.googleapis.com/…/logo.png — it MUST appear in the nav, as <img data-rv-logo src="https://storage.googleapis.com/…/logo.png" alt="QA CIO Leadership Awards 2027"> linked to "#hero", 44–56px tall (height set in CSS, width auto), in place of the event name as text. The page is dark and the logo was most likely drawn for a light background: set it on a white chip (background #fff, padding 6px 12px, radius 0px). Show it again in the footer, smaller.

Event (already known):
{
  "name": "QA CIO Leadership Awards 2027",
  "category": "ip",
  "city": "New Delhi",
  "description": "An awards night and leadership forum recognising India's top CIOs and technology leaders. 30 award categories, a jury of 12 industry veterans, a keynote stage with 20 speakers, a partner showcase with 25 technology partners, and a gala dinner. Past winners testimonials. Audience: CIOs, CTOs, CDOs of large enterprises."
}

Extracted brief:
{
  "theme": "An awards night and leadership forum recognising India's top CIOs and technology leaders.",
  "audience": "CIOs, CTOs, CDOs of large enterprises",
  "tone": "formal leadership awards and executive recognition",
  "tracks": [],
  "speakerHints": [],
  "sponsorHints": [],
  "keyMessages": [
    "Recognising India's top CIOs and technology leaders across 30 award categories",
    "Evaluation by a jury of 12 industry veterans",
    "Keynote stage featuring 20 speakers",
    "Partner showcase featuring 25 technology partners",
    "Celebratory gala dinner and past winner testimonials"
  ],
  "inferredCategory": "CIO technology leadership"
}

THE WHOLE PAGE, in order (the nav links to these by href="#<id>"; every section's root element carries id="<id>"):
[
  {
    "id": "nav",
    "kind": "nav",
    "purpose": "Top bar of the site: the event's logo (or its name when there is no logo) and links to the sections below. Always present.",
    "layout": "One slim bar; logo left, links right; the links wrap onto a second line or scroll sideways on a phone (there is no script to open a menu)."
  },
  {
    "id": "hero",
    "kind": "hero",
    "purpose": "Hero banner: a strong, specific headline, a line under it, date and place when known, one or two buttons. Always present, right after nav.",
    "layout": "As the design's layout says for the hero."
  },
  {
    "id": "curators-note",
    "kind": "custom",
    "purpose": "Introduces the strategic rationale and editorial manifesto of the 2027 edition honoring India's top enterprise technology leaders.",
    "layout": "Asymmetric two-column editorial spread with an introductory essay on the left and a framed photographic plate with an italic caption on the right."
  },
  {
    "id": "scale-and-stature",
    "kind": "custom",
    "purpose": "Synthesizes the key metrics of the gathering including the 30 categories, 12 jury members, 20 speakers, and 25 partner organizations.",
    "layout": "One dark full-width band divided by thin hairline rules into four large-number editorial metric columns with concise labels."
  },
  {
    "id": "award-categories",
    "kind": "custom",
    "purpose": "Presents the 30 discrete award categories structured across enterprise modernization, digital resilience, and leadership excellence.",
    "layout": "Three-column editorial catalog with index numbering, serif category titles, and fine dashed horizontal rules between entries."
  },
  {
    "id": "jury-framework",
    "kind": "custom",
    "purpose": "Details the independent evaluation rigor and governance maintained by the 12 industry veteran jurors.",
    "layout": "Framed picture plate on the left with a four-stage assessment methodology list and vetting criteria on the right."
  },
  {
    "id": "keynote-speakers",
    "kind": "speakers",
    "purpose": "Spotlights the roster of 20 industry leaders delivering keynote addresses and participating in leadership panels.",
    "layout": "A horizontal carousel with previous and next navigation controls displaying editorial speaker portraits and executive titles."
  },
  {
    "id": "technology-partners",
    "kind": "partners",
    "purpose": "Showcases the 25 enterprise technology partners supporting the summit showcase and executive ecosystem.",
    "layout": "Multi-row disciplined monochrome partner logo grid enclosed in subtle border frames."
  },
  {
    "id": "past-laureates",
    "kind": "custom",
    "purpose": "Shares reflections and impact statements from previous CIO Leadership Award winners.",
    "layout": "A wide pull-quote carousel featuring oversized serif quotation marks, testimonial copy, and recipient enterprise affiliations."
  },
  {
    "id": "gala-evening",
    "kind": "custom",
    "purpose": "Outlines the running order of the celebratory awards ceremony and private gala dinner in New Delhi.",
    "layout": "Two-column split with an evening chronological running order on the left and a framed atmospheric plate on the right."
  },
  {
    "id": "footer",
    "kind": "footer",
    "purpose": "Closing footer for this event site. Always present, last.",
    "layout": "A calm closing band: event name or logo, a short line, the section links again."
  }
]

In THIS answer write ONLY these sections, in this order — the others are being written at the same moment from this same brief, to the same rules: ["nav","hero","curators-note","scale-and-stature","award-categories"]

Make each section substantial: use the material fully — real headings, real explanatory text, real lists — and build it out with the care of a finished site. A heading with one line under it is not a section.

For each section with kind "custom" (including nav/hero/footer): write real, grounded text directly into the html — there is no separate content-fill step, content and markup are generated together.

For a section with one of the 5 data-bound kinds (speakers/faq/partners/contact/glimpses): design the section's own visual container and any intro/heading copy with real text, but the REPEATING list items are real records a human CMS editor manages elsewhere — never yours to invent. Write exactly ONE well-designed example item, marked with the attribute data-rv-repeat-template="<kind>" on its root element, with clearly-labeled placeholder values (e.g. "Speaker Name", "Role, Company") — that is the ONLY item you write; a client-side mechanism clones or replaces it once real records exist, or leaves this one placeholder item visible as-is when none do. Its container must lay the clones out well however many there are (a responsive grid: repeat(auto-fill, minmax(…, 1fr))). Inside that one template element, put these EXACT, case-sensitive data-rv-field attributes on the right descendant elements, by kind — never invent other field names:
  speakers: data-rv-field="n" (name, text), "r" (role/title, text), "c" (company, text), "photo" (headshot — on an <img>, or on a div meant to show a background-image photo)
  faq: data-rv-field="t" (question, text), "d" (answer, text)
  partners: data-rv-field="name" (text), "url" (the href target if the item is/contains a link — put this on the <a>), "logo" (on an <img>)
  contact: data-rv-field="label" (e.g. department/role, text), "name" (text), "email" (text), "phone" (text)
  glimpses: data-rv-field="imageUrl" (on an <img>), "caption" (text)
In such a template item an <img> has no src attribute at all (its picture comes from the record).
Placeholder values must be unmistakably placeholders — "Contact name", "name@example.com", "+00 00000 00000", "Question goes here" — never a plausible-looking name, e-mail address, phone number or web domain. Anywhere on the site: never write an e-mail address, phone number, web address, street address, price, deadline or statistic that is not in the material above. Do not invent a domain name for the event.
Example snippet (speakers): <div class="speaker-card" data-rv-repeat-template="speakers"><img data-rv-field="photo" alt=""><h4 data-rv-field="n">Speaker Name</h4><p data-rv-field="r">Role</p><p data-rv-field="c">Company</p></div>

HTML rules, every section: ONE root element carrying id="<section id>", no <html>/<body>/<head> wrapper, no <script> tags, no inline event handler attributes, no javascript: URIs, no <iframe>/<object>/<embed>.
CSS rules, every section: write plain class selectors for the classes you used in that section's html, including one for the root element itself (its background, padding and layout belong on the root's own class). Prefix every class with the section id so that names never collide between sections. Do NOT write [data-rv-section] in any selector and do not style html, body or :root — the server confines every rule to its section, and the root element is the positioning context for anything absolutely positioned inside it. No @import, no url(javascript:...), no CSS behaviors.

positioningNotes: internal only, never shown on the site. Name the ONE specific thing you adapted FROM a competitor (or state "no competitor material was given" if none was provided) and the ONE specific thing you deliberately did NOT just carry over from this event's own previous edition. Be concrete (name the competitor/section), not generic.
````
