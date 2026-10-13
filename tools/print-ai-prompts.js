/* node tools/print-ai-prompts.js > docs/ai-site-prompts.md
   Writes out, from the code itself, every prompt the AI site pipeline sends — with a fixed sample event in
   place of a real one, so the wording can be read (and reviewed) without running a generation. No network,
   no Firebase, no AI call. Run it again after changing a prompt in functions/lib/api.js or gen-design.js. */
const h = require('../functions/lib/api.js')._testHooks;
const g = require('../functions/lib/gen-design.js');
const gemini = require('../functions/lib/gemini.js');

const meta = { name: 'Sample CIO Leadership Awards 2027', category: 'ip', city: 'New Delhi',
  description: 'An awards night and leadership forum recognising India\'s top CIOs and technology leaders.' };
const brief = { theme: 'Recognising enterprise technology leadership', audience: 'CIOs, CTOs and CDOs of large enterprises',
  tone: 'Prestigious, precise', tracks: ['AI at scale', 'Cyber resilience'], speakerHints: [], sponsorHints: [],
  keyMessages: ['30 award categories', 'A jury of 12 industry veterans'], inferredCategory: 'Awards' };
const refDesign = { layoutStyle: '(what step 2 read from that page)', heroStyle: '…', sectionPattern: ['Hero — …', 'Speakers — …'],
  imageryStyle: '…', typography: '…', density: 'balanced' };
const source = { type: 'previousEdition', url: 'https://example.com/previous-edition', tone: 'light', design: refDesign,
  extractedSections: [{ heading: '(the page\'s sections, summarised by step 2)', body: '…' }] };
const design = { mood: '(the mood step 3 wrote)', mode: 'light', themeColor: '#945d25', accentColor: '#1f2a37',
  backgroundColor: '#faf9f5', surfaceColor: '#ffffff', textColor: '#16181d', mutedColor: '#5b6270',
  headingFont: 'Fraunces', bodyFont: 'Inter', layout: '(the layout system step 3 wrote)', cornerRadius: '6',
  imageStyle: 'warm, low-key editorial photographs of objects and interiors', heroImage: 'a row of brass award plaques on a walnut console',
  heroImageUrl: 'https://storage.googleapis.com/…/hero-bg.png' };
const designPlan = { design: design, reference: { type: 'none', artDirection: 'cinematic' }, sections: [
  { id: 'award-categories', kind: 'custom', purpose: 'The 30 award categories, grouped.', layout: 'picture left, text right with an indexed two-column list', image: 'engraved brass and smoked-glass award plaques on a dark walnut console', imageUrl: 'https://storage.googleapis.com/…/award-categories.png' },
  { id: 'jury-framework', kind: 'custom', purpose: 'How the jury of 12 evaluates entries.', layout: 'a vertical timeline of the three evaluation phases', image: 'a boardroom table laid with assessment dossiers and fountain pens', imageUrl: 'https://storage.googleapis.com/…/jury-framework.png' },
  { id: 'keynote-stage', kind: 'speakers', purpose: 'The keynote speakers.', layout: 'a carousel of speaker cards', image: '', imageUrl: '' }
] };

const open = '\n````text\n', close = '\n````\n';
let md = '# The prompts behind an AI-designed site\n\n' +
  'Written out from the code by `node tools/print-ai-prompts.js > docs/ai-site-prompts.md`, with a sample event in place of a real one. ' +
  'The wording lives in `functions/lib/api.js` and `functions/lib/gen-design.js` — change it there and run the command again.\n\n' +
  'A site is made in five steps; a sixth prompt redesigns one section from the editor. Text goes to `' + gemini.GEMINI_TEXT_MODEL + '`, pictures to `' + gemini.GEMINI_IMAGE_MODEL + '`.\n';

md += '\n## 1. Read the brief\n\nSent with the description and, when given, the PDF.\n' + open + h.buildExtractBriefPrompt(meta) + close;
md += '\n## 2. Read each reference page\n\nOnce per link (previous edition, current edition, competitors).\n' + open +
  h.buildIngestSourcePrompt(source.url, 'previousEdition', '(the page\'s visible text, up to 50,000 characters)', '(the page\'s tags and class names, up to 14,000 characters)') + close;

const none = h.buildDesignPlanPrompt({ eventMeta: meta, brief: brief, sources: [], reference: { basis: null, others: [] },
  themeInfo: { usedFallback: { noPreviousEditionSource: true, color: true, font: true } }, artDirection: g.artDirectionFor('sample-cio-leadership-awards-2027'), themeMode: 'light' });
const withRef = h.buildDesignPlanPrompt({ eventMeta: meta, brief: brief, sources: [{ type: source.type, url: source.url, extractedSections: source.extractedSections }],
  reference: { basis: source, others: [] }, themeInfo: { themeColor: '#00827b', headingFont: 'Cormorant Infant', bodyFont: 'Inter', usedFallback: {} },
  artDirection: g.artDirectionFor('sample'), themeMode: 'auto' });
md += '\n## 3. Design the site\n\n### 3a. With no reference page (the owner chose Light)\n' + open + none + close;
md += '\n### 3b. With a previous edition (theme left to the design)\n\nOnly the opening block and COLOUR AND TYPE differ from 3a.\n' + open +
  withRef.split('Ground every section')[0] + '…(as in 3a)…\n\n' + withRef.slice(withRef.indexOf('COLOUR AND TYPE:')) + close;

md += '\n## 4. Make the pictures\n\nOne request per picture: the hero, and one for most sections the AI writes itself.\n' + open +
  g.imagePrompt(design.heroImage, design, { hero: true }) + '\n\n' +
  g.imagePrompt(designPlan.sections[0].image, design, { context: 'It illustrates the "award categories" section of the website of ' + meta.name + ': ' + designPlan.sections[0].purpose }) + close;

md += '\n## 5. Write the HTML and CSS\n\nSent twice, side by side, each asking for half of the sections.\n' + open +
  h.buildSectionCodePrompt({ eventMeta: meta, brief: brief, sources: [], designPlan: designPlan, futureEdition: false,
    logoUrl: 'https://storage.googleapis.com/…/logo.png', write: ['nav', 'hero', 'award-categories'] }) + close;

md += '\n## 6. Redesign one section (the editor\'s "Redesign with AI")\n' + open +
  h.buildRedesignPrompt({ sectionId: 'jury-framework', design: design, instruction: 'make it a horizontal three-step layout',
    above: 'award-categories ("Thirty categories")', below: 'keynote-stage ("On the keynote stage")',
    html: '(the section\'s HTML as it stands on the page)', css: '(the section\'s CSS)' }) + close;

process.stdout.write(md);
