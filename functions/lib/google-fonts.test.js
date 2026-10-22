// node functions/lib/google-fonts.test.js — a generated site's type comes from Google Fonts only.
const g = require('./google-fonts');
const api = require('./api')._testHooks;
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

/* the catalogue */
check('Google families found however a page names them', g.family('montserrat') === 'Montserrat' && g.family('"Open Sans"') === 'Open Sans' && g.family('Montserrat-Bold') === 'Montserrat' && g.family('PlusJakartaSans') === 'Plus Jakarta Sans');
check('Google\'s own Noto families are in (open source)', g.family('Noto Sans Devanagari') === 'Noto Sans Devanagari');
check('licensed faces are not Google families', ['Gilroy', 'Proxima Nova', 'Helvetica Neue', 'Avenir', 'Theano Didot', 'Arial', 'Futura PT'].every(function (f) { return g.family(f) === ''; }));
check('… and are set in the Google family nearest to each', g.toGoogle('Gilroy') === 'Plus Jakarta Sans' && g.toGoogle('Proxima Nova') === 'Figtree' && g.toGoogle('Helvetica Neue') === 'Inter' && g.toGoogle('theano_didotregular') === 'Playfair Display');
check('a name that is nothing: the fallback, else Inter', g.googleOnly('Foo Grotesk', 'Lexend') === 'Lexend' && g.googleOnly('', '') === 'Inter' && g.googleOnly('Foo', 'Gilroy') === 'Plus Jakarta Sans');

/* the stylesheet asks only for weights the family has: Google refuses the whole request otherwise */
check('a family with one weight is asked for it alone', g.cssUrl('Bebas Neue') === 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap', g.cssUrl('Bebas Neue'));
check('a full family: 300 to 800', g.cssUrl('Montserrat') === 'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap');
check('a family from 400: no 300 asked', g.cssUrl('Playfair Display') === 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&display=swap', g.cssUrl('Playfair Display'));
check('a family not on Google Fonts: no stylesheet', g.cssUrl('Gilroy') === '' && api.ingestSchemaFor && true);

/* CSS a model wrote */
var css = g.googleOnlyCss('@font-face{font-family:Gilroy;src:url(https://cdn.example.com/g.woff2)}' +
  '.a{font-family:"Gilroy",Arial,sans-serif;font-weight:700}.b{font:700 2rem/1.1 "Proxima Nova", sans-serif}.c{font-family:var(--heading-font-family)}' +
  '.d{font-family:"Inter", sans-serif !important}.e{--heading-font-family:"Gilroy"}.f{font-family:Helvetica, Arial}.g{font:inherit}.h{font-family:monospace}.i{--x-font-family:"Arial"}');
check('no face of its own is loaded', !/@font-face|cdn\.example/.test(css), css);
check('a licensed family becomes its Google stand-in; a system one is left out', /\.a\{font-family:"Plus Jakarta Sans", sans-serif;/.test(css), css);
check('the font shorthand too, size and line-height kept', /\.b\{font:700 2rem\/1\.1 "Figtree", sans-serif\}/.test(css), css);
check('the site\'s own variables and Google families stay as written', /\.c\{font-family:var\(--heading-font-family\)\}/.test(css) && /\.d\{font-family:"Inter", sans-serif !important\}/.test(css), css);
check('a custom property is set to the stand-in, never to itself', /\.e\{--heading-font-family:"Plus Jakarta Sans"\}/.test(css) && /\.i\{--x-font-family:sans-serif\}/.test(css), css);
check('nothing Google left: the site\'s body font', /\.f\{font-family:var\(--body-font-family\)\}/.test(css), css);
check('generic-only and keyword values are left alone', /\.g\{font:inherit\}/.test(css) && /\.h\{font-family:monospace\}/.test(css), css);

/* the section sanitisers the generation runs */
var html = api.sanitizeGeneratedSectionHtml('<link rel="stylesheet" href="https://use.typekit.net/abc.css"><style>.t{font-family:Gilroy}</style>' +
  '<h2 style="font-family:\'Gotham\', sans-serif; color:red">Hi</h2><p style=\'font-family:"Avenir"\'>x</p>');
check('a section\'s markup: no stylesheet link, its <style> and style="" fonts Google ones, the attribute still whole',
  !/typekit|<link/.test(html) && /\.t\{font-family:"Plus Jakarta Sans"\}/.test(html) && /style="font-family:'Montserrat', sans-serif; color:red"/.test(html) && /style='font-family:"Nunito Sans"'/.test(html), html);
check('a section\'s CSS', api.sanitizeGeneratedSectionCss('h1{font-family:"Canela",serif}') === 'h1{font-family:"Fraunces", serif}', api.sanitizeGeneratedSectionCss('h1{font-family:"Canela",serif}'));

/* the design's pair */
var theme = api.extractThemeFromPreviousEditionSources([{ type: 'previousEdition', fontSignals: ['Gilroy', 'Proxima Nova', 'Arial'] }]);
check('a previous edition set in licensed faces: their Google stand-ins', theme.headingFont === 'Plus Jakarta Sans' && theme.bodyFont === 'Figtree', theme);
theme = api.extractThemeFromPreviousEditionSources([{ type: 'previousEdition', look: { headingFont: 'Theano Didot', bodyFont: 'Lato' } }]);
check('… and its look\'s fonts the same way', theme.headingFont === 'Playfair Display' && theme.bodyFont === 'Lato', theme);

if (failed) { console.error('google-fonts: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('google-fonts: all ' + passed + ' checks passed');
