# The prompts behind an AI-designed site

Written out from the code by `node tools/print-ai-prompts.js > docs/ai-site-prompts.md`, with a sample event in place of a real one. The wording lives in `functions/lib/api.js` and `functions/lib/gen-design.js` — change it there and run the command again.

A site is made in five steps; a sixth prompt redesigns one section from the editor. Text goes to Claude when its key is set on the server (`claude-opus-5-5` for the design and the section code, `claude-sonnet-5-5` for the rest), with Gemini (`gemini-3.8-flash`) as the automatic fallback and as the only model when no key is set; pictures always go to `gemini-2.5-flash-image` (see `functions/lib/llm.js`).

## 1. Read the brief

Sent with the description and, when given, the PDF.

````text
You are extracting a structured brief from an event overview document, for ET Oneworld's event microsite builder.

Event basics (already known, given here only for context — do not repeat them back as extracted content):
{
  "name": "Sample CIO Leadership Awards 2027",
  "category": "ip",
  "city": "New Delhi",
  "description": "An awards night and leadership forum recognising India's top CIOs and technology leaders."
}

The document is attached. Read it and extract ONLY what it actually says or clearly implies. Never invent a
track, speaker, sponsor or claim that isn't in the document — an empty array/field is correct when the
document simply doesn't cover that, better than a plausible-sounding guess.

inferredCategory specifically: name the short industry/category this event genuinely reads as (e.g.
"enterprise AI leadership", "CIO technology leadership", "retail / e-commerce") — base it only on real
signal in the document (its subject matter, audience, themes), never on the event basics above, and never
invent one if the document itself gives no real signal to go on — an empty string is the correct answer then.
````

## 2. Read each reference page

Once per link (previous edition, current edition, competitors).

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

## 3. Design the site

### 3a. With no reference page (the owner chose Light)

````text
You are the lead designer of a bespoke event microsite, for ET Oneworld's event builder. You decide its SECTION STRUCTURE, the layout of every section, its colours and type, and which sections carry a picture. A second step writes the HTML and CSS from exactly what you decide here, so be specific.

There is no previous edition or competitor page to model this site on, so its design starts from this art direction, chosen for this event — build the whole page on it, do not fall back on a generic dark-navy-and-gold conference look:
Editorial magazine: A print-magazine feel: a large serif headline, generous white space, asymmetric two-column spreads, thin rules between sections, pictures set as framed editorial plates with captions.

Ground every section in real content-shape evidence from the material below — never include a section that has nothing real to put in it, and never omit one the material clearly supports. A thin site with 3 well-grounded sections beats a padded one with 7 that have nothing real to say.

nav, hero and footer are always present — never include them in your sections list, those are added automatically. Everything else is yours: section ids, purposes, ordering and count.

THE HERO IS FIXED, as on every Economic Times event site: centred, and holding only The Economic Times Business Verticals logo, the event's name as a wordmark, ONE line (design.heroTagline), the date and place, and two buttons. It never carries an overview, a paragraph, numbers or tracks — so the overview of the event is the FIRST section of your list, right under the hero, and everything a visitor needs to understand the event lives in the sections.

Set each section's kind to "custom" unless it is really one of 6 specific data-bound types, each backed by real records the ET ops team manages by hand, never your invention: "speakers" (real speaker bios), "sessions" (the real agenda), "faq" (real FAQs), "partners" (real sponsor/partner logos), "contact" (real contacts), "glimpses" (a real photo gallery). Only use one of those when the material genuinely supports that this event will have real data of that kind.

LAYOUT: give every section its own layout (sections[].layout) and make neighbouring sections differ — a page of identical centred-heading-plus-card-grid sections is a failure. Mix: picture/text splits, full-width bands, large-number rows, timelines, quote blocks, card grids, lists, and a carousel (a sideways-scrolling row with previous/next buttons — say "carousel" in the layout) where a section has many items of one kind, such as speakers, partner logos, photos or testimonials, or where the reference uses one.

PICTURES: aim for a page that is about 60% text and 40% pictures by area — a visitor scrolling it should never see a full screen without a picture. The hero has a background picture (design.heroImage). Besides it, give a picture (sections[].image) to nearly every "custom" section, up to 8 of them — leave it empty only for a section that is one band of numbers — and design each of those sections around its picture, at a large size: a half-width split whose picture runs the full height of the section, a full-bleed band with the text set over the picture, a wide picture above the text. Keep text-only sections to a minimum and never put two of them next to each other. Data-bound sections (speakers, sessions, partners, glimpses, faq, contact) show real records and get no generated picture.
Each picture must be about ITS OWN section: name the concrete thing that section talks about (for a section on battery supply chains: "rows of lithium battery cell modules on a factory line"; for one on a gala dinner: "a long banquet table set with glassware under warm pendant lights") — never a generic "abstract technology background", and never the same subject twice on one page. Pictures show objects, places, materials, tools or abstract forms: never people, never text or logos, never something that could pass for a photograph of this event.

Event (already known):
{
  "name": "Sample CIO Leadership Awards 2027",
  "category": "ip",
  "city": "New Delhi",
  "description": "An awards night and leadership forum recognising India's top CIOs and technology leaders."
}

Extracted brief:
{
  "theme": "Recognising enterprise technology leadership",
  "audience": "CIOs, CTOs and CDOs of large enterprises",
  "tone": "Prestigious, precise",
  "tracks": [
    "AI at scale",
    "Cyber resilience"
  ],
  "speakerHints": [],
  "sponsorHints": [],
  "keyMessages": [
    "30 award categories",
    "A jury of 12 industry veterans"
  ],
  "inferredCategory": "Awards"
}

COLOUR AND TYPE:
The owner asked for a LIGHT site: design.mode must be "light", with a light background and dark text. This is not negotiable.
No previous edition was given, so there is no brand colour or font to carry over. Choose a considered palette and font pairing that fit THIS event's subject and the direction above — a different event must get a visibly different palette.
Text must be easy to read: textColor against backgroundColor at a contrast of 7:1 or more, mutedColor at 4.5:1 or more.

Task — produce:
- reasoning: internal only, never shown on the site. Name the evidence behind each section and each design choice.
- design: mood, mode, the six colours, the two fonts (real Google Fonts family names), layout, imageStyle, heroImage.
- sections: the middle sections, each with id, kind, purpose, layout and image.
````

### 3b. With a previous edition (theme left to the design)

Only the opening block and COLOUR AND TYPE differ from 3a.

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

…(as in 3a)…

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

## 4. Make the pictures

One request per picture: the hero, and one for most sections the AI writes itself.

````text
Create the wide background picture for the hero banner of a professional event website. Text and buttons will sit on top of it, so keep the composition calm, with open space and no strong detail in the centre. Subject: a row of brass award plaques on a walnut console. Visual style: warm, low-key editorial photographs of objects and interiors. Palette: bright and airy, with #945d25 and #1f2a37 present as accents. Every picture on this site shares this one style, so that they read as a set. Landscape, 16:9. STRICT: no people, no faces, no crowds, no hands, no text, no letters, no numbers, no logos, no watermarks, no flags, no recognisable real building or landmark. This illustrates a theme; it must never look like a photograph of this event, its venue or its attendees.

Create one picture for a section of a professional event website. Subject: engraved brass and smoked-glass award plaques on a dark walnut console. It illustrates the "award categories" section of the website of Sample CIO Leadership Awards 2027: The 30 award categories, grouped. The picture must be recognisably about that, shown through concrete objects, places and materials — not a generic backdrop. Visual style: warm, low-key editorial photographs of objects and interiors. Palette: bright and airy, with #945d25 and #1f2a37 present as accents. Every picture on this site shares this one style, so that they read as a set. Landscape, 4:3. STRICT: no people, no faces, no crowds, no hands, no text, no letters, no numbers, no logos, no watermarks, no flags, no recognisable real building or landmark. This illustrates a theme; it must never look like a photograph of this event, its venue or its attendees.
````

## 5. Write the HTML and CSS

Sent twice, side by side, each asking for half of the sections.

````text
You are writing the REAL HTML and CSS of a bespoke event microsite, for ET Oneworld's event builder — designing and coding it yourself to the standard of a top agency, not filling a template. Ground every fact below — never invent a date, number, named person or company that isn't clearly present in the material. Leave out what nothing supports; never pad with generic filler.

THE DESIGN — decided already; every section follows it, so the page reads as one piece:
Mood: (the mood step 3 wrote)
Layout system: (the layout system step 3 wrote)
Page is LIGHT (dark text on a light background).

Colours and fonts are CSS variables already defined on the page — use the variables, never the raw values, so that the owner can restyle the site later:
  var(--theme-color)   #945d25   brand colour: buttons, links, highlights
  var(--accent-color)  #1f2a37   second colour
  var(--rv-bg)         #faf9f5   page background
  var(--rv-surface)    #ffffff   cards, alternating bands
  var(--rv-text)       #16181d   body text
  var(--rv-muted)      #5b6270   secondary text
  var(--heading-font-family)  Fraunces   headings (loaded)
  var(--body-font-family)     Inter   everything else (loaded)
A band may invert (theme colour or a dark/light opposite as its background) for rhythm, as long as the text on it stays strongly readable.

SHARED RULES — written identically in every section, because sections are styled separately:
- Content sits in a container: max-width 1200px, margin 0 auto, padding 0 24px. Sections have vertical padding clamp(64px, 9vw, 128px).
- Corner radius 6px on cards, pictures and inputs. Buttons: padding 15px 30px, radius 6px, font-weight 600, font-size 1rem; primary = var(--theme-color) background with a readable text colour; secondary = outlined.
- TYPE MUST BE EASY TO READ. Use rem or px for every font-size — never em or %. Paragraph and list text: 1.125rem (18px) or larger, line-height 1.65, in var(--rv-text) or var(--rv-muted), lines no longer than about 70 characters (max-width: 68ch). Section headings (h2): clamp(2rem, 4.2vw, 3.25rem), line-height 1.1. Hero headline (h1): clamp(2.6rem, 6.5vw, 5rem). Card titles: 1.25rem or larger. Small labels and captions: never below 0.875rem. Set font-family, font-size, line-height and color explicitly on the text you write; do not rely on inherited values.
- Responsive without script: grids and splits collapse to one column under 820px (use @media (max-width: 820px)); nothing may cause sideways scrolling; pictures are width:100%, height:auto or object-fit:cover inside a sized frame.
- Give the page visual rhythm: do not build two neighbouring sections the same way. Follow each section's own "layout" below exactly.
- MOTION, kept light: put the attribute data-rv-reveal on blocks that should ease into view as the visitor scrolls to them — a section's heading block, its picture, its cards (cards that are siblings follow one another automatically). Values: data-rv-reveal (rises), data-rv-reveal="left" or "right" (slides in from that side — good for the two halves of a split), "zoom" (pictures), "fade". Use it in most sections below the hero, on a few blocks each; never on the nav, never on a section's root element, never on a data-rv-repeat-template item. The page does the animating: do not write opacity:0, keyframes or transitions for it yourself. Besides that, give cards, buttons and pictures a gentle hover (transition: transform .25s ease, box-shadow .25s ease; a 3–4px lift or a slight picture zoom). Nothing loops, blinks or moves on its own.
- CAROUSELS: where a section's layout calls for a carousel or slider (a row with more cards, logos, quotes or photos than fit), mark the wrapper with data-rv-carousel (data-rv-carousel="auto" to make it advance by itself) and the element that directly holds the items with data-rv-carousel-track. Give each item a width (e.g. flex: 0 0 min(360px, 82vw)). The page makes the track scroll sideways and adds the previous/next buttons itself — never draw arrows, dots or a scrollbar of your own, and never write animation to move the items.

THE HERO IS NOT YOURS TO WRITE: the server builds it (centred: The Economic Times Business Verticals logo, the event's name as a wordmark, the line "", date and place, two buttons). Do not return a "hero" section. Because the hero holds no overview, the first section under it introduces the event properly.
THE ECONOMIC TIMES BRAND: never draw, write or imitate an Economic Times / ET / ETB2B logo, monogram or badge yourself — no "ET" box, no styled "ET" initials, anywhere on the site. The real logo is placed by the server in the hero. In the nav the event is named by its own logo when one is supplied, else by its name as plain text.

PICTURES — the site must not be text only:
- Section "award-categories" has a picture, already made. Its address is exactly rvimg://award-categories (it shows: engraved brass and smoked-glass award plaques on a dark walnut console). Use it with <img src="rvimg://award-categories" alt="…" loading="lazy"> and give it real presence — half the section's width or more in a split, or the full container width (or the full width of the page) as a plate or band, at least 460px tall on desktop, object-fit: cover — placed as that section's layout says.
- Section "jury-framework" has a picture, already made. Its address is exactly rvimg://jury-framework (it shows: a boardroom table laid with assessment dossiers and fountain pens). Use it with <img src="rvimg://jury-framework" alt="…" loading="lazy"> and give it real presence — half the section's width or more in a split, or the full container width (or the full width of the page) as a plate or band, at least 460px tall on desktop, object-fit: cover — placed as that section's layout says.
- Pictures should fill roughly 40% of the page: make them large — tall splits, full-width bands — never thumbnails.
- Use ONLY the picture addresses given above, written exactly as given (they begin "rvimg://" — the server turns them into the real addresses); never write an http address for a picture and never invent one. Elsewhere, add visual interest with CSS: inline SVG icons you draw yourself (simple line icons, stroke="currentColor"), large numerals, coloured shapes, rules and gradients.

THE EVENT'S LOGO has the address rvimg://logo — it MUST appear in the nav, as <img data-rv-logo src="rvimg://logo" alt="Sample CIO Leadership Awards 2027"> linked to "#hero", 44–56px tall (height set in CSS, width auto), in place of the event name as text. Show it again in the footer, smaller.

Event (already known):
{
  "name": "Sample CIO Leadership Awards 2027",
  "category": "ip",
  "city": "New Delhi",
  "description": "An awards night and leadership forum recognising India's top CIOs and technology leaders."
}

Extracted brief:
{
  "theme": "Recognising enterprise technology leadership",
  "audience": "CIOs, CTOs and CDOs of large enterprises",
  "tone": "Prestigious, precise",
  "tracks": [
    "AI at scale",
    "Cyber resilience"
  ],
  "speakerHints": [],
  "sponsorHints": [],
  "keyMessages": [
    "30 award categories",
    "A jury of 12 industry veterans"
  ],
  "inferredCategory": "Awards"
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
    "purpose": "Hero banner, built by the server: the ET Business Verticals logo, the event's wordmark, one line, date and place, two buttons. Always present, right after nav. Not written by you.",
    "layout": "Centred, a full screen tall, over the hero picture."
  },
  {
    "id": "award-categories",
    "kind": "custom",
    "purpose": "The 30 award categories, grouped.",
    "layout": "picture left, text right with an indexed two-column list"
  },
  {
    "id": "jury-framework",
    "kind": "custom",
    "purpose": "How the jury of 12 evaluates entries.",
    "layout": "a vertical timeline of the three evaluation phases"
  },
  {
    "id": "keynote-stage",
    "kind": "speakers",
    "purpose": "The keynote speakers.",
    "layout": "a carousel of speaker cards"
  },
  {
    "id": "footer",
    "kind": "footer",
    "purpose": "Closing footer for this event site. Always present, last.",
    "layout": "A calm closing band: event name or logo, a short line, the section links again."
  }
]

In THIS answer write ONLY these sections, in this order — the others are being written at the same moment from this same brief, to the same rules: ["nav","hero","award-categories"]

Make each section substantial: use the material fully — real headings, real explanatory text, real lists — and build it out with the care of a finished site. A heading with one line under it is not a section.

For each section with kind "custom" (including nav/hero/footer): write real, grounded text directly into the html — there is no separate content-fill step, content and markup are generated together.

For a section with one of the data-bound kinds (speakers/sessions/faq/partners/contact/glimpses): design the section's own visual container and any intro/heading copy with real text, but the REPEATING list items are real records a human CMS editor manages elsewhere — never yours to invent. Write exactly ONE well-designed example item, marked with the attribute data-rv-repeat-template="<kind>" on its root element, with clearly-labeled placeholder values (e.g. "Speaker Name", "Role, Company") — that is the ONLY item you write; a client-side mechanism clones or replaces it once real records exist, or leaves this one placeholder item visible as-is when none do. Its container must lay the clones out well however many there are (a responsive grid: repeat(auto-fill, minmax(…, 1fr))). Inside that one template element, put these EXACT, case-sensitive data-rv-field attributes on the right descendant elements, by kind — never invent other field names:
  speakers: data-rv-field="n" (name, text), "r" (role/title, text), "c" (company, text), "photo" (headshot — on an <img>, or on a div meant to show a background-image photo)
  sessions (the agenda): data-rv-field="time" (e.g. "9:30 AM – 10:15 AM", text), "title" (text), "desc" (text), "speakers" (the speakers' names, text), "room" (text)
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

## 6. Redesign one section (the editor's "Redesign with AI")

````text
You are redesigning ONE section of an event microsite that is already built, for ET Oneworld's event builder. Return that section's new HTML and CSS — a visibly different, better design of the same section, to the standard of a top agency.

WHAT THE OWNER ASKED FOR — this comes first: "make it a horizontal three-step layout"

KEEP THE CONTENT. Every fact, name, number, date, link and e-mail address in the section stays, with the same meaning; wording may be tightened, and headings sharpened. Do not invent a fact, person, company, number, address, e-mail or phone number. Keep every link's href.
KEEP THESE ATTRIBUTES exactly as they are on the elements that carry them: data-rv-repeat-template, data-rv-field, data-rv-bind, data-rv-bound, data-rv-auto, data-rv-logo, data-rv-logo-unit, data-register-cta, data-rv-carousel, data-rv-carousel-track. An element with data-rv-repeat-template stays the single template item it is — never write more copies of it, and never remove it unless the owner asked for the list to go.

This section has no picture and you cannot add one: build its visual interest from CSS (shapes, large numerals, rules, gradients) and inline SVG icons you draw yourself.

THE SITE'S DESIGN — the section must sit naturally between its neighbours:
Mood: (the mood step 3 wrote)
Layout system: (the layout system step 3 wrote)
Colours and fonts are CSS variables already on the page — use the variables for the site's own colours (a specific colour the owner asked for is written as asked): var(--theme-color) brand, var(--accent-color) second colour, var(--rv-bg) page background, var(--rv-surface) cards and bands, var(--rv-text) body text, var(--rv-muted) secondary text, var(--heading-font-family), var(--body-font-family).
- Content sits in a container: max-width 1200px, margin 0 auto, padding 0 24px. The section has vertical padding clamp(64px, 9vw, 128px).
- Corner radius 6px on cards, pictures and inputs. Buttons: padding 15px 30px, radius 6px, font-weight 600, font-size 1rem.
- Type: rem or px only. Paragraph and list text 1.125rem or larger with line-height 1.65 and lines no longer than 68ch; h2 clamp(2rem, 4.2vw, 3.25rem); card titles 1.25rem or larger; nothing below 0.875rem. Set font-family, font-size, line-height and color explicitly.
- Responsive without script: grids and splits collapse to one column under 820px; nothing causes sideways scrolling.
- Light motion: data-rv-reveal (or ="left", "right", "zoom", "fade") on a few blocks that should ease in on scroll — the page animates them, write no opacity:0 or keyframes for it; a gentle hover lift on cards and buttons.
- A row with more items than fit may be a carousel: data-rv-carousel on the wrapper, data-rv-carousel-track on the element holding the items, a width on each item; the page adds the buttons — never draw arrows or dots.

HTML rules: ONE root element carrying id="jury-framework", no <html>/<body>/<head>, no <script>, no inline event handler attributes, no javascript: URIs, no <iframe>/<object>/<embed>.
CSS rules: plain class selectors for the classes you use, each class prefixed with "jury-framework-", including one for the root element. Do NOT write [data-rv-section] in any selector and do not style html, body or :root. No @import.

Neighbouring sections, so that yours differs from them: above — award-categories ("Thirty categories"); below — keynote-stage ("On the keynote stage").

THE SECTION AS IT IS NOW — its HTML:
(the section's HTML as it stands on the page)

Its CSS (shown as stored: the "[data-rv-section=…]" prefix on each rule is added by the server, do not write it):
(the section's CSS)
````
