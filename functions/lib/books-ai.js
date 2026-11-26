/* Books (BOOKSTUDIO): the editor's AI steps, through the one door to a text model (lib/llm.js: Claude first, Gemini
   as its fallback). The owner's AI Studio export called a model named gemini-4-hydrogen straight from an open
   Express server; these are the same seven steps, with the same request and answer shapes the editor reads, behind
   EventSphere's sign-in (lib/api-books.js checks the caller before any of these runs).

     run(name, body, ctx) -> Promise<{ status, json }>   name: one of NAMES; ctx: { user, bookId, onUsage }
     NAMES, ROUTE (each step's lib/llm.js PROFILES entry), _test: { PROMPTS, SCHEMAS, CLEAN }

   Every answer is checked and cleaned here before it is returned (clean.*): a model's JSON is never passed through
   as it came. A failed call answers the model layer's own { error, code, retryable } with its status. */
'use strict';

var ROUTE = {
  'analyze-template': 'books-analyze',
  'typography-pairing': 'books-typography',
  'editorial-assistant': 'books-assistant',
  'recommend-templates': 'books-recommend',
  'generate-publication-template': 'books-publication',
  'generate-infographic': 'books-infographic',
  'auto-flow-data': 'books-auto-flow'
};
var NAMES = Object.keys(ROUTE);

/* ---------- small helpers ---------- */
function str(v, max) { return String(v == null ? '' : v).slice(0, max || 2000); }
function num(v, lo, hi, dflt) { var n = Number(v); if (!isFinite(n)) return dflt; return Math.max(lo, Math.min(hi, n)); }
function arr(v, max) { return Array.isArray(v) ? v.slice(0, max || 50) : []; }
var HEX_RE = /^#[0-9a-fA-F]{6}$/;
function hex(v, dflt) { var s = String(v || '').trim(); if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map(function (c) { return c + c; }).join(''); return HEX_RE.test(s) ? s.toUpperCase() : dflt; }
function fontName(v, dflt) { var s = str(v, 60).replace(/["'<>;{}]/g, '').trim(); return s || dflt; }
function json(v, max) { var s; try { s = JSON.stringify(v == null ? null : v); } catch (e) { s = 'null'; } return s.length > max ? s.slice(0, max) + '…' : s; }

var INFOGRAPHIC_VARIANTS = ['kpi_grid', 'horizontal_bars', 'vertical_bars', 'donut_ring', 'radial_gauges', 'line_trend', 'stat_highlights',
  'survey_bars', 'horizontal_timeline', 'vertical_timeline', 'milestone_zigzag', 'roadmap_tracks', 'process_steps', 'circular_workflow',
  'linear_pipeline', 'two_col_comparison', 'swot_matrix', 'pros_cons', 'market_quadrant', 'feature_matrix', 'india_map_data',
  'world_map_data', 'regional_bars', 'org_hierarchy', 'concentric_ecosystem', 'business_canvas', 'strategy_pyramid', 'value_chain',
  'tech_stack', 'ai_workflow', 'esg_pillars', 'carbon_breakdown', 'impact_scorecard', 'fact_sheet'];
var CATEGORIES = ['Luxury & Premium Editorial', 'Architecture & Interior Design', 'Corporate & Institutional', 'Art, Culture & Heritage',
  'Reports & Research', 'Consulting & ESG'];
var NO_DATA_NOTE = 'Sample figures — replace with your own data before printing.';
/* what every step that writes copy is told: a book ETB2B prints must not carry invented facts presented as real */
var NO_INVENTED_FACTS = 'Never invent facts, statistics, names, quotes or sources and present them as real. Where the request gives no data, ' +
  'use plainly round sample numbers and say so in sourceNote ("' + NO_DATA_NOTE + '").';

/* ---------- schemas (the model layer's dialect: OBJECT / STRING / NUMBER / BOOLEAN / ARRAY) ---------- */
function O(props, required) { return { type: 'OBJECT', properties: props, required: required || Object.keys(props) }; }
var S = { type: 'STRING' }, N = { type: 'NUMBER' }, B = { type: 'BOOLEAN' };
function A(items) { return { type: 'ARRAY', items: items }; }
var ITEM = O({ label: S, value: N, secondaryValue: N, unit: S, yearOrStep: S, description: S }, ['label', 'value']);
var INFOGRAPHIC = O({ variant: S, title: S, subtitle: S, categoryLabel: S, sourceNote: S, items: A(ITEM) }, ['variant', 'title', 'subtitle', 'items']);

var SCHEMAS = {
  'analyze-template': O({
    summary: S,
    pageSize: O({ widthMm: N, heightMm: N, orientation: S, recommendedPreset: S }),
    colourPalette: O({ paper: S, surface: S, ink: S, mutedInk: S, primaryAccent: S, secondaryAccent: S, swatches: A(S) }),
    typography: O({ displayFont: S, headingFont: S, bodyFont: S, captionFont: S, quoteFont: S, numericalFont: S,
      displaySizePt: N, headingSizePt: N, bodySizePt: N, captionSizePt: N, notes: S }),
    gridSystem: O({ columns: N, columnGapMm: N, baselineMm: N, margins: O({ top: N, bottom: N, inner: N, outer: N }) }),
    pageLayoutCategories: A(S), imagePlacementPatterns: A(S), textHierarchy: A(S), decorativePatterns: A(S), chapterOpeningStyle: S,
    masterPageRecommendations: A(O({ name: S, role: S, description: S }))
  }),
  'typography-pairing': O({ pairings: A(O({ name: S, rationale: S, displayFont: S, headingFont: S, secondaryFont: S, bodyFont: S,
    captionFont: S, quoteFont: S, numericalFont: S })) }),
  'editorial-assistant': O({ summary: S, suggestions: A(O({ id: S, category: S, title: S, rationale: S, actionType: S,
    recommendedFontSizePt: N, recommendedLineHeight: N, recommendedInfographicVariant: S, rewrittenText: S },
    ['id', 'category', 'title', 'rationale', 'actionType'])) }),
  'recommend-templates': O({ bookRecommendations: A(O({ templateId: S, reason: S })), infographicRecommendations: A(O({ templateId: S, reason: S })) }),
  'generate-publication-template': O({
    title: S, subtitle: S, editionLine: S, description: S, category: S, widthMm: N, heightMm: N, columns: N, darkCover: B, paletteName: S,
    palette: O({ paper: S, surface: S, ink: S, mutedInk: S, primaryAccent: S, secondaryAccent: S, border: S }),
    fonts: O({ displayFont: S, headingFont: S, bodyFont: S, captionFont: S, quoteFont: S, numericalFont: S }),
    chapters: A(O({ heading: S, body: S, quote: S }, ['heading', 'body'])),
    infographic: INFOGRAPHIC
  }, ['title', 'subtitle', 'editionLine', 'description', 'category', 'widthMm', 'heightMm', 'columns', 'darkCover', 'palette', 'fonts', 'chapters', 'infographic']),
  'generate-infographic': O({ variant: S, title: S, subtitle: S, categoryLabel: S, sourceNote: S, items: A(ITEM) }),
  'auto-flow-data': O({
    documentTitle: S, documentSubtitle: S, summary: S,
    textUpdates: A(O({ pageId: S, elementId: S, text: S })),
    imageUpdates: A(O({ pageId: S, elementId: S, placeholderTitle: S, suggestedPhotoBrief: S })),
    infographicUpdates: A(O({ pageId: S, elementId: S, variant: S, title: S, subtitle: S, categoryLabel: S, sourceNote: S, items: A(ITEM) },
      ['pageId', 'elementId', 'variant', 'title', 'subtitle', 'items'])),
    additionalPages: A(O({ label: S, kicker: S, heading: S, body: S, quote: S, imagePlaceholderTitle: S, imagePlaceholderBrief: S,
      isInfographicPage: B, infographic: INFOGRAPHIC }, ['label', 'heading', 'body']))
  }, ['documentTitle', 'summary', 'textUpdates', 'imageUpdates', 'infographicUpdates', 'additionalPages'])
};

/* ---------- what each step is asked (request body -> { prompt, opts } or { error }) ---------- */
var REF_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
var MAX_REF_IMAGES = 6, MAX_REF_PDFS = 3, MAX_REF_BYTES = 24 * 1024 * 1024;
var MAX_FLOW_CHARS = 150000;

var PROMPTS = {
  'analyze-template': function (b) {
    var files = arr(b.files, 12), images = [], pdfs = [], bytes = 0, skipped = 0;
    files.forEach(function (f) {
      var type = str(f && f.mimeType, 80).toLowerCase(), data = typeof (f && f.base64) === 'string' ? f.base64 : '';
      if (!data) return;
      bytes += Math.floor(data.length * 3 / 4);
      if (REF_IMAGE_TYPES.indexOf(type) !== -1 && images.length < MAX_REF_IMAGES) images.push({ mimeType: type, data: data });
      else if (type === 'application/pdf' && pdfs.length < MAX_REF_PDFS) pdfs.push({ mimeType: type, data: data });
      else skipped++;
    });
    if (bytes > MAX_REF_BYTES) return { status: 413, error: 'The reference files add up to ' + (bytes / 1048576).toFixed(1) + ' MB; they can be up to 24 MB together.' };
    var idml = b.idmlMetadata && typeof b.idmlMetadata === 'object' ? b.idmlMetadata : null;
    if (!images.length && !pdfs.length && !idml) return { status: 400, error: 'Add at least one reference page (JPG, PNG, WebP or PDF) or an IDML file first.' };
    var brief = str(b.bookBrief, 4000).trim();
    return {
      prompt: 'You are an expert editorial art director and coffee table book designer.\n' +
        'Analyse the attached book design reference files' + (idml ? ' and this parsed IDML metadata: ' + json(idml, 6000) : '') +
        (brief ? ' alongside this editorial brief: ' + brief : '') + '.\n\n' +
        'Inspect and extract:\n' +
        '1. Physical page dimensions in millimetres and orientation (portrait, landscape, square).\n' +
        '2. Exact colour palette (paper background, subtle surface, primary ink, muted caption ink, primary accent, secondary accent, and 6 hex swatches), as #RRGGBB.\n' +
        '3. Typography hierarchy using real Google Fonts families that match the reference (displayFont, headingFont, bodyFont, captionFont, quoteFont, numericalFont) plus sizes in pt.\n' +
        '4. Grid system: column count, column gap in mm, baseline grid in mm, and top/bottom/inner/outer margins in mm.\n' +
        '5. Recurring page layout categories, image placement patterns, text hierarchy rules, decorative patterns, the chapter opening style, and 5 recommended master-page blueprints.\n' +
        'Describe only what the references show; where something cannot be seen, give a sensible editorial default and say so in typography.notes.',
      opts: { images: images, inlineFiles: pdfs },
      skipped: skipped
    };
  },
  'typography-pairing': function (b) {
    var style = str(b.style, 80).trim() || 'Classic editorial';
    return { prompt: 'Recommend 3 distinct, museum-grade Google Fonts typography pairings for a coffee table book in the "' + style + '" editorial style' +
      (b.bookCategory ? ' (category: ' + str(b.bookCategory, 80) + ')' : '') + '.\n' +
      'Current fonts: ' + json(b.currentFonts || {}, 1500) + '.\n' +
      'Use ONLY real, widely available Google Fonts family names (e.g., Playfair Display, Cormorant Garamond, Bodoni Moda, Fraunces, Cinzel, Libre Baskerville, Source Serif 4, Lora, Spectral, Crimson Pro, EB Garamond, Plus Jakarta Sans, DM Sans, Manrope, Syne, Outfit, Work Sans, Archivo, IBM Plex Sans, IBM Plex Mono, JetBrains Mono, Space Mono, Marcellus, Prata, Tenor Sans, Josefin Sans).\n' +
      'For each pairing, give separate fonts for Main Title (displayFont), Chapter Headings (headingFont), Section Headings (secondaryFont), Body Text (bodyFont), Captions (captionFont), Pull Quotes (quoteFont) and Page Numbers (numericalFont), plus a concise editorial rationale.' };
  },
  'editorial-assistant': function (b) {
    var request = str(b.prompt, 4000).trim();
    if (!request) return { status: 400, error: 'Type what you would like help with first.' };
    var mode = str(b.mode, 40);
    return { prompt: 'You are the Senior Editorial Design Assistant of a coffee table book studio.\nRULES:\n' +
      '- ALWAYS respect the approved Design System below. NEVER recommend redesigning the whole book or breaking the approved colour palette or font hierarchy.\n' +
      '- Give concrete, actionable suggestions; each one is applied only if the person approves it.\n' +
      '- Only rewrite copy (rewrittenText) when the mode is "copy_fit", which the person asked for explicitly; otherwise leave rewrittenText empty.\n' +
      '- ' + NO_INVENTED_FACTS + '\n\n' +
      'Approved Design System: ' + json(b.designSystem, 12000) + '\n' +
      'Book Summary: ' + json(b.bookSummary, 4000) + '\n' +
      'Current Page Context: ' + json(b.currentPage, 30000) + '\n' +
      'Selected Element: ' + json(b.selectedElement || null, 8000) + '\n' +
      'Assistant Mode: ' + mode + '\n' +
      'Request: ' + request + '\n\n' +
      'Return 3 to 4 concise, high-value editorial suggestions.' };
  },
  'recommend-templates': function (b) {
    return { prompt: 'As an editorial director, recommend the best 3 coffee table book templates and the best 4 infographic templates from the exact lists below.\n' +
      'Brief: ' + str(b.brief, 3000) + '\nBook Category: ' + str(b.bookCategory, 120) + '\nContent Word Count: ' + num(b.contentWordCount, 0, 1e7, 0) +
      '\nImage Quantity: ' + num(b.imageCount, 0, 1e5, 0) + '\nData Complexity: ' + str(b.dataComplexity, 60) + '\n\n' +
      'Available Book Templates: ' + json(b.availableBookTemplates, 40000) + '\nAvailable Infographic Templates: ' + json(b.availableInfographics, 40000) + '\n\n' +
      'Return ONLY ids that exist in those lists, each with a crisp editorial reason.' };
  },
  'generate-publication-template': function (b) {
    var topic = str(b.prompt, 4000).trim();
    if (!topic) return { status: 400, error: 'Describe the book or report you want first.' };
    var kind = b.documentKind === 'book' ? 'book' : 'report';
    var chapters = Math.round(num(b.chapterCount, 2, 6, 3));
    return { prompt: 'You are a publication art director creating a complete, print-ready ' + (kind === 'report' ? 'executive report' : 'editorial book') + ' template blueprint.\n' +
      'Topic / Brief: ' + topic + '\nDocument Kind: ' + kind + '\nTarget Trim Preset: ' + str(b.trimPreset || 'A4 Report (210 × 297 mm)', 80) +
      '\nDesired Section / Chapter Count: ' + chapters + '\nVisual Direction: ' + str(b.aesthetic || 'Editorial Minimalist', 80) + '\n\n' +
      'Design requirements:\n' +
      '- Choose Google Fonts from: "Cormorant Garamond", "Playfair Display", "Bodoni Moda", "Fraunces", "EB Garamond", "Lora", "Source Serif 4", "DM Sans", "Plus Jakarta Sans", "IBM Plex Sans", "JetBrains Mono", "Syne".\n' +
      '- Give a refined print colour palette with high legibility (paper, surface, ink, mutedInk, primaryAccent, secondaryAccent, border), each as #RRGGBB.\n' +
      '- Write chapter/section headings, editorial body copy (each body about 70–110 words) and a pull quote per section. This is template copy the team will replace: write it about the topic in general terms, and ' + NO_INVENTED_FACTS + '\n' +
      '- Include one live infographic matched to the brief, using one of these variant keys: "kpi_grid", "horizontal_bars", "vertical_bars", "donut_ring", "radial_gauges", "line_trend", "horizontal_timeline", "process_steps", "swot_matrix", "esg_pillars", "impact_scorecard", "strategy_pyramid", "value_chain", "regional_bars", "tech_stack".\n' +
      '- category must be exactly one of: ' + CATEGORIES.map(function (c) { return '"' + c + '"'; }).join(', ') + '.' };
  },
  'generate-infographic': function (b) {
    var topic = str(b.prompt, 3000).trim();
    if (!topic) return { status: 400, error: 'Describe the infographic, or paste its data, first.' };
    var raw = str(b.rawData, 20000).trim();
    return { prompt: 'You are an information designer creating a live, editable vector infographic for a printed book.\n' +
      'Topic / Request: ' + topic + '\nData / Notes: ' + (raw || 'None given.') + '\nPreferred Visual Variant: ' + str(b.preferredVariant || 'auto', 40) +
      '\nActive Publication Theme: ' + json(b.themeColors || {}, 1500) + '\n\n' +
      'Choose the variant key from this list (if the preferred variant is not "auto", use it): ' + INFOGRAPHIC_VARIANTS.map(function (v) { return '"' + v + '"'; }).join(', ') + '.\n' +
      'Give 4 to 6 data items with numeric values, units, an optional yearOrStep and short descriptions. Take every number from the data given. ' + NO_INVENTED_FACTS };
  },
  'auto-flow-data': function (b) {
    var raw = str(b.rawData, MAX_FLOW_CHARS + 1).trim();
    if (!raw) return { status: 400, error: 'Paste or upload your content first.' };
    if (raw.length > MAX_FLOW_CHARS) return { status: 413, error: 'That is more text than one Auto-Flow can place (about ' + Math.round(MAX_FLOW_CHARS / 6000) + ',000 words). Flow it in parts.' };
    var verbatim = b.preserveExactText !== false, extend = b.autoExtendPages !== false;
    return { prompt: 'You are a book layout engine that flows content into an existing template.\n' +
      'The person has given ALL of their publication content ONCE below. Flow it into the EXACT existing page frames of their template WITHOUT changing the layout geometry, fonts or visual system.\n\nRULES:\n' +
      '1. ' + (verbatim
        ? 'VERBATIM ("AS IT IS"): keep the exact wording, sentences, headings, numbers and facts as written. Do NOT summarise, omit or paraphrase. Split paragraphs cleanly across the text frames and additional pages so 100% of the content flows intact.'
        : 'LIGHT EDITORIAL FLOW: keep all facts, numbers and the voice, smoothing headings, captions and transitions to fit the frames.') + '\n' +
      '2. MAP EXISTING FRAMES FIRST: return a "textUpdates" entry for every relevant existing text elementId in "pagesSchema" (cover title, subtitle, kicker, contents, chapter headings, body columns, pull quotes, captions). Respect each frame\'s approximate capacity ("approxWords").\n' +
      '3. IMAGE FRAMES: for every existing image frame in "pagesSchema", return an "imageUpdates" entry with a short "placeholderTitle" (3–6 words) and a "suggestedPhotoBrief" for the photograph it needs. NEVER invent image URLs.\n' +
      '4. INFOGRAPHICS: for every existing infographic frame in "pagesSchema", return an "infographicUpdates" entry with its pageId and elementId, filled with numbers and labels taken from the content. Variant keys: "kpi_grid", "horizontal_bars", "vertical_bars", "donut_ring", "radial_gauges", "line_trend", "stat_highlights", "horizontal_timeline", "vertical_timeline", "process_steps", "two_col_comparison", "swot_matrix", "regional_bars", "strategy_pyramid", "value_chain", "esg_pillars", "impact_scorecard", "fact_sheet". ' + NO_INVENTED_FACTS + '\n' +
      '5. ' + (extend
        ? 'MORE PAGES WHEN NEEDED: if there is more content than fits the existing pages, put the rest into "additionalPages" (each laid out like the template\'s text pages) so nothing is lost. If the content has real figures and "pagesSchema" has no infographic frame, add one "additionalPages" entry with "isInfographicPage": true and a complete "infographic".'
        : 'FIT WITHIN EXISTING PAGES: place everything into the existing pages and return an empty "additionalPages".') + '\n' +
      '6. Use only pageId and elementId values that appear in "pagesSchema".\n\n' +
      'Document Title: ' + str(b.projectTitle || 'Untitled Publication', 200) + '\nTemplate Layout Schema:\n' + json(arr(b.pagesSchema, 400), 120000) + '\n\n' +
      'Content (flow ALL of this):\n"""\n' + raw + '\n"""' };
  }
};

/* ---------- what each answer may hold ---------- */
function cleanItems(items) {
  return arr(items, 12).map(function (it) {
    it = it || {};
    var out = { label: str(it.label, 120), value: num(it.value, -1e12, 1e12, 0) };
    if (it.secondaryValue != null && isFinite(Number(it.secondaryValue))) out.secondaryValue = num(it.secondaryValue, -1e12, 1e12, 0);
    if (it.unit) out.unit = str(it.unit, 24);
    if (it.yearOrStep) out.yearOrStep = str(it.yearOrStep, 40);
    if (it.description) out.description = str(it.description, 300);
    return out;
  }).filter(function (it) { return it.label; });
}
function cleanInfographic(g, fallbackVariant) {
  g = g || {};
  var variant = INFOGRAPHIC_VARIANTS.indexOf(g.variant) !== -1 ? g.variant : (fallbackVariant || 'kpi_grid');
  return { variant: variant, title: str(g.title, 160), subtitle: str(g.subtitle, 240), categoryLabel: str(g.categoryLabel, 80),
    sourceNote: str(g.sourceNote, 240), items: cleanItems(g.items) };
}
function strList(v, max, each) { return arr(v, max).map(function (s) { return str(s, each || 300); }).filter(Boolean); }

var CLEAN = {
  'analyze-template': function (r) {
    r = r || {}; var p = r.pageSize || {}, c = r.colourPalette || {}, t = r.typography || {}, g = r.gridSystem || {}, m = g.margins || {};
    var orient = ['portrait', 'landscape', 'square'].indexOf(p.orientation) !== -1 ? p.orientation : 'portrait';
    return { report: {
      summary: str(r.summary, 2000),
      pageSize: { widthMm: num(p.widthMm, 50, 2000, 240), heightMm: num(p.heightMm, 50, 2000, 300), orientation: orient, recommendedPreset: str(p.recommendedPreset, 80) },
      colourPalette: { paper: hex(c.paper, '#F7F4EE'), surface: hex(c.surface, '#EFEAE1'), ink: hex(c.ink, '#1C1A17'), mutedInk: hex(c.mutedInk, '#6B665E'),
        primaryAccent: hex(c.primaryAccent, '#9C7A4A'), secondaryAccent: hex(c.secondaryAccent, '#3E4A3D'),
        swatches: arr(c.swatches, 10).map(function (s) { return hex(s, ''); }).filter(Boolean) },
      typography: { displayFont: fontName(t.displayFont, 'Playfair Display'), headingFont: fontName(t.headingFont, 'Cormorant Garamond'),
        bodyFont: fontName(t.bodyFont, 'Lora'), captionFont: fontName(t.captionFont, 'DM Sans'), quoteFont: fontName(t.quoteFont, 'Cormorant Garamond'),
        numericalFont: fontName(t.numericalFont, 'DM Sans'), displaySizePt: num(t.displaySizePt, 6, 400, 48), headingSizePt: num(t.headingSizePt, 6, 200, 24),
        bodySizePt: num(t.bodySizePt, 5, 40, 10.5), captionSizePt: num(t.captionSizePt, 4, 30, 8), notes: str(t.notes, 1000) },
      gridSystem: { columns: Math.round(num(g.columns, 1, 24, 2)), columnGapMm: num(g.columnGapMm, 0, 100, 5), baselineMm: num(g.baselineMm, 1, 50, 4.5),
        margins: { top: num(m.top, 0, 200, 20), bottom: num(m.bottom, 0, 200, 24), inner: num(m.inner, 0, 200, 22), outer: num(m.outer, 0, 200, 18) } },
      pageLayoutCategories: strList(r.pageLayoutCategories, 20), imagePlacementPatterns: strList(r.imagePlacementPatterns, 20),
      textHierarchy: strList(r.textHierarchy, 20), decorativePatterns: strList(r.decorativePatterns, 20), chapterOpeningStyle: str(r.chapterOpeningStyle, 400),
      masterPageRecommendations: arr(r.masterPageRecommendations, 10).map(function (x) { x = x || {}; return { name: str(x.name, 80), role: str(x.role, 60), description: str(x.description, 400) }; })
    } };
  },
  'typography-pairing': function (r) {
    return { pairings: arr(r && r.pairings, 3).map(function (p) {
      p = p || {};
      return { name: str(p.name, 80), rationale: str(p.rationale, 600), displayFont: fontName(p.displayFont, 'Playfair Display'), headingFont: fontName(p.headingFont, 'Cormorant Garamond'),
        secondaryFont: fontName(p.secondaryFont, 'DM Sans'), bodyFont: fontName(p.bodyFont, 'Lora'), captionFont: fontName(p.captionFont, 'DM Sans'),
        quoteFont: fontName(p.quoteFont, 'Cormorant Garamond'), numericalFont: fontName(p.numericalFont, 'DM Sans') };
    }) };
  },
  'editorial-assistant': function (r, b) {
    var copyFit = b && b.mode === 'copy_fit';
    return { summary: str(r && r.summary, 1200), suggestions: arr(r && r.suggestions, 6).map(function (s, i) {
      s = s || {};
      var out = { id: str(s.id, 40) || ('s' + (i + 1)), category: str(s.category, 40), title: str(s.title, 160), rationale: str(s.rationale, 800), actionType: str(s.actionType, 40) };
      if (s.recommendedFontSizePt != null && isFinite(Number(s.recommendedFontSizePt))) out.recommendedFontSizePt = num(s.recommendedFontSizePt, 4, 200, 10);
      if (s.recommendedLineHeight != null && isFinite(Number(s.recommendedLineHeight))) out.recommendedLineHeight = num(s.recommendedLineHeight, 0.8, 3, 1.4);
      if (INFOGRAPHIC_VARIANTS.indexOf(s.recommendedInfographicVariant) !== -1) out.recommendedInfographicVariant = s.recommendedInfographicVariant;
      if (copyFit && s.rewrittenText) out.rewrittenText = str(s.rewrittenText, 8000);
      return out;
    }) };
  },
  'recommend-templates': function (r, b) {
    var bookIds = arr(b && b.availableBookTemplates, 500).map(function (t) { return t && t.id; });
    var infoIds = arr(b && b.availableInfographics, 500).map(function (t) { return t && t.id; });
    function pick(list, ids, max) {
      return arr(list, max * 2).map(function (x) { x = x || {}; return { templateId: str(x.templateId, 120), reason: str(x.reason, 400) }; })
        .filter(function (x) { return ids.indexOf(x.templateId) !== -1; }).slice(0, max);
    }
    return { bookRecommendations: pick(r && r.bookRecommendations, bookIds, 3), infographicRecommendations: pick(r && r.infographicRecommendations, infoIds, 4) };
  },
  'generate-publication-template': function (r) {
    r = r || {}; var p = r.palette || {}, f = r.fonts || {};
    return {
      title: str(r.title, 160), subtitle: str(r.subtitle, 240), editionLine: str(r.editionLine, 160), description: str(r.description, 800),
      category: CATEGORIES.indexOf(r.category) !== -1 ? r.category : 'Reports & Research',
      widthMm: num(r.widthMm, 90, 600, 210), heightMm: num(r.heightMm, 90, 600, 297), columns: Math.round(num(r.columns, 1, 4, 2)), darkCover: !!r.darkCover,
      paletteName: str(r.paletteName, 80),
      palette: { paper: hex(p.paper, '#F7F4EE'), surface: hex(p.surface, '#EFEAE1'), ink: hex(p.ink, '#1C1A17'), mutedInk: hex(p.mutedInk, '#6B665E'),
        primaryAccent: hex(p.primaryAccent, '#9C7A4A'), secondaryAccent: hex(p.secondaryAccent, '#3E4A3D'), border: hex(p.border, '#D9D2C5') },
      fonts: { displayFont: fontName(f.displayFont, 'Playfair Display'), headingFont: fontName(f.headingFont, 'Cormorant Garamond'), bodyFont: fontName(f.bodyFont, 'Lora'),
        captionFont: fontName(f.captionFont, 'DM Sans'), quoteFont: fontName(f.quoteFont, 'Cormorant Garamond'), numericalFont: fontName(f.numericalFont, 'DM Sans') },
      chapters: arr(r.chapters, 8).map(function (c) { c = c || {}; return { heading: str(c.heading, 200), body: str(c.body, 4000), quote: str(c.quote, 400) }; })
        .filter(function (c) { return c.heading || c.body; }),
      infographic: cleanInfographic(r.infographic)
    };
  },
  'generate-infographic': function (r, b) {
    var preferred = b && INFOGRAPHIC_VARIANTS.indexOf(b.preferredVariant) !== -1 ? b.preferredVariant : '';
    var g = cleanInfographic(r, preferred || 'kpi_grid');
    if (preferred) g.variant = preferred;
    return g;
  },
  'auto-flow-data': function (r, b) {
    r = r || {};
    /* only the frames the request named: a model's made-up id must not reach the book */
    var known = {};
    arr(b && b.pagesSchema, 400).forEach(function (pg) {
      pg = pg || {}; var pid = String(pg.pageId || '');
      [].concat(arr(pg.textFrames, 400), arr(pg.imageFrames, 400), arr(pg.infographicFrames, 400))
        .forEach(function (f) { f = f || {}; known[pid + '|' + String(f.elementId || '')] = true; });
    });
    var anyKnown = Object.keys(known).length > 0;
    function ok(x) { return !anyKnown || known[String(x.pageId) + '|' + String(x.elementId)]; }
    return {
      documentTitle: str(r.documentTitle, 200), documentSubtitle: str(r.documentSubtitle, 300), summary: str(r.summary, 1200),
      textUpdates: arr(r.textUpdates, 2000).map(function (u) { u = u || {}; return { pageId: str(u.pageId, 120), elementId: str(u.elementId, 120), text: str(u.text, 60000) }; }).filter(ok),
      imageUpdates: arr(r.imageUpdates, 1000).map(function (u) { u = u || {}; return { pageId: str(u.pageId, 120), elementId: str(u.elementId, 120),
        placeholderTitle: str(u.placeholderTitle, 120), suggestedPhotoBrief: str(u.suggestedPhotoBrief, 600) }; }).filter(ok),
      infographicUpdates: arr(r.infographicUpdates, 200).map(function (u) { u = u || {}; return Object.assign({ pageId: str(u.pageId, 120), elementId: str(u.elementId, 120) }, cleanInfographic(u)); }).filter(ok),
      additionalPages: arr(r.additionalPages, 300).map(function (p) {
        p = p || {};
        var out = { label: str(p.label, 120), kicker: str(p.kicker, 160), heading: str(p.heading, 300), body: str(p.body, 60000), quote: str(p.quote, 600),
          imagePlaceholderTitle: str(p.imagePlaceholderTitle, 120), imagePlaceholderBrief: str(p.imagePlaceholderBrief, 600), isInfographicPage: !!p.isInfographicPage };
        if (p.infographic) out.infographic = cleanInfographic(p.infographic);
        return out;
      })
    };
  }
};

/* name, body, ctx { user, bookId, onUsage } -> Promise<{ status, json }> (never rejects) */
function run(name, body, ctx) {
  if (!Object.prototype.hasOwnProperty.call(PROMPTS, name)) return Promise.resolve({ status: 404, json: { error: 'No such AI step.' } });
  var asked;
  try { asked = PROMPTS[name](body || {}); } catch (err) {
    console.error('books-ai: ' + name + ' could not build its request — ' + (err && err.stack || err));
    return Promise.resolve({ status: 400, json: { error: 'That request could not be read.' } });
  }
  if (asked.error) return Promise.resolve({ status: asked.status || 400, json: { error: asked.error } });
  var llm = require('./llm');
  var opts = Object.assign({ route: ROUTE[name], user: ctx && ctx.user, eventId: '' }, asked.opts || {});
  if (ctx && typeof ctx.onUsage === 'function') opts.onUsage = ctx.onUsage;
  return llm.callJson(asked.prompt, SCHEMAS[name], opts).then(function (r) {
    if (!r || r.code) {
      var f = r || { error: 'ETB2B AI could not answer just now. Please try again.', code: 'ai-unavailable', status: 502, retryable: true };
      var out = { error: f.error, code: f.code, retryable: !!f.retryable };
      if (f.timeoutMs) out.timeoutMs = f.timeoutMs;
      return { status: f.status || 502, json: out };
    }
    var cleaned = CLEAN[name](r.parsed, body || {});
    if (asked.skipped) cleaned.skippedFiles = asked.skipped;
    return { status: 200, json: cleaned };
  }).catch(function (err) {
    console.error('books-ai: ' + name + ' failed — ' + (err && err.stack || err));
    return { status: 502, json: { error: 'ETB2B AI could not answer just now. Please try again.', code: 'ai-unavailable', retryable: true } };
  });
}

module.exports = { run: run, NAMES: NAMES, ROUTE: ROUTE, NO_DATA_NOTE: NO_DATA_NOTE,
  _test: { PROMPTS: PROMPTS, SCHEMAS: SCHEMAS, CLEAN: CLEAN, INFOGRAPHIC_VARIANTS: INFOGRAPHIC_VARIANTS } };
