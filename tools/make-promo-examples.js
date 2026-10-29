/* node tools/make-promo-examples.js [--dry-run] [--only <ids>] [--force] [--sheet <file.png>]

   Makes the example library's 24 pictures, once (Promotions previews, owner B; plan §5h, action R1):
     assets/promo-examples/people/p01.jpg … p12.jpg   640 × 640 JPEG: fictional Indian professionals, 6 women and
                                                      6 men, in ONE tone — p01 is made from a full prompt, and p02-p12
                                                      are each made with p01 as the reference picture, "same
                                                      background, light, framing, lens and colour grade; only the
                                                      person differs"
     assets/promo-examples/logos/l01.png … l12.png    transparent, trimmed: 8 wide lock-ups (~900 × 300) and 4 square
                                                      ones (~600 × 600). The image model draws only the SYMBOL, with no
                                                      letters; the fictional name is set in type here, so it can
                                                      never come out misspelt.
   and a contact sheet of all 24 for the owner's review (default ~/.revamp-cms-qa/promo-phase3/examples-sheet.png).
   Nothing is committed by this script: the lead commits the pictures after the owner has looked at the sheet.

   Who is who comes from assets/promo-examples/library.json (names, genders, companies, partners' tiers); how each
   looks is below (PEOPLE_LOOKS, LOGO_LOOKS). The pictures are made by Oneworld's own image call
   (functions/lib/gemini.js callGeminiImage), with the portrait rules' closing line (gen-design.js IMAGE_TAIL: no
   text, no logos, believable anatomy) read from that file so the two never drift apart.

     --dry-run        print the 24 prompts and where each picture goes; make no request and write nothing
     --only <ids>     make just these again, even if they are there: p03,l07 … or "people" / "logos"
                      (p01 is the others' reference: remaking it alone leaves p02-p12 in the old tone)
     --force          make all 24 again
     --sheet <file>   where the contact sheet goes
   Without --only / --force, a picture already on disk is kept, so a run that stopped half-way can be run again
   without paying twice.

   Credentials: GEMINI_API_KEY in this process's environment, loaded by whoever runs it. This script never opens a
   file for it (tools/.env.local included) and never prints it. Cost: one image call a picture, at most one retry
   when the model answers with no picture or the service fails — about 24-40 calls, a couple of dollars, once. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIB_DIR = path.join(ROOT, 'assets', 'promo-examples');
const LIB_FILE = path.join(LIB_DIR, 'library.json');
const GEN_DESIGN = path.join(ROOT, 'functions', 'lib', 'gen-design.js');
const DEFAULT_SHEET = path.join(os.homedir(), '.revamp-cms-qa', 'promo-phase3', 'examples-sheet.png');
const USAGE = 'usage: node tools/make-promo-examples.js [--dry-run] [--only p01,l03|people|logos] [--force] [--sheet <file.png>]';

/* How each person looks. Every one is Indian, an ordinary made-up professional; attire is Indian business wear
   (suits, blazers, sarees, kurtas), as the site pictures' people rules ask. Ages, hair and clothes differ so a grid
   of them reads as different people; background, light and framing never do. */
const PEOPLE_LOOKS = {
  p01: { gender: 'woman', look: 'a woman in her early forties with shoulder-length black hair, wearing a deep teal blazer over a cream silk top and small gold stud earrings' },
  p02: { gender: 'man', look: 'a man in his late thirties with short black hair and a neatly trimmed beard, wearing a navy suit and a white open-collar shirt' },
  p03: { gender: 'woman', look: 'a woman in her early thirties with long dark hair tied back, wearing a maroon silk saree with a thin gold border' },
  p04: { gender: 'man', look: 'a man in his mid-forties with greying temples and rimless glasses, wearing a charcoal blazer over a light blue shirt' },
  p05: { gender: 'woman', look: 'a woman in her late thirties with wavy dark-brown shoulder-length hair, wearing a mustard kurta under a dark tailored jacket' },
  p06: { gender: 'man', look: 'a man in his mid-fifties with salt-and-pepper hair, clean-shaven, wearing a grey bandhgala jacket' },
  p07: { gender: 'woman', look: 'a woman in her early thirties with a short layered haircut and thin-framed glasses, wearing a charcoal blazer over a white shirt' },
  p08: { gender: 'man', look: 'a man in his early thirties with short wavy hair and light stubble, wearing an olive Nehru jacket over a white kurta' },
  p09: { gender: 'woman', look: 'a woman in her mid-fifties with her hair in a low bun streaked with grey, wearing a deep green silk saree and a small bindi' },
  p10: { gender: 'man', look: 'a man in his early forties with neatly side-parted hair, wearing a navy blazer over a grey crew-neck sweater' },
  p11: { gender: 'woman', look: 'a woman in her mid-thirties with long straight black hair, wearing a soft pink kurta with a light dupatta' },
  p12: { gender: 'man', look: 'a man in his late forties with short hair and a grey-flecked trimmed beard, wearing a dark suit and a maroon tie' }
};

/* Each partner's symbol: what it shows and its two colours, dark or saturated enough for the white tiles mailers
   and posts put logos on. wide = symbol beside the name; square = symbol above it. */
const LOGO_LOOKS = {
  l01: { shape: 'wide', industry: 'technology', motif: 'three interlocking angular chevrons forming one forward-pointing shape', colours: 'deep indigo and bright teal' },
  l02: { shape: 'wide', industry: 'healthcare', motif: 'a soft rounded leaf-like form wrapped around a small circle', colours: 'emerald green and navy' },
  l03: { shape: 'wide', industry: 'logistics', motif: 'two overlapping arrows forming one continuous loop', colours: 'deep blue and orange' },
  l04: { shape: 'wide', industry: 'finance', motif: 'three rising rounded bars inside an open circle', colours: 'dark green and gold' },
  l05: { shape: 'square', industry: 'research', motif: 'a hexagon made of six triangles, one of them in a lighter tone', colours: 'purple and magenta' },
  l06: { shape: 'wide', industry: 'energy', motif: 'a stylised half sun of radiating wedges over a horizon line', colours: 'amber and deep red' },
  l07: { shape: 'wide', industry: 'data analytics', motif: 'a square grid of dots in which one diagonal of dots is larger', colours: 'navy and cyan' },
  l08: { shape: 'square', industry: 'mobility', motif: 'a circular track with one bold swoosh orbiting it', colours: 'crimson and charcoal' },
  l09: { shape: 'wide', industry: 'retail', motif: 'an abstract open bag made of two rounded overlapping shapes', colours: 'coral and dark plum' },
  l10: { shape: 'square', industry: 'insurance', motif: 'an abstract shield formed by two curved halves', colours: 'royal blue and sky blue' },
  l11: { shape: 'wide', industry: 'textiles', motif: 'three interlaced curved bands, like a simple weave', colours: 'saffron and indigo' },
  l12: { shape: 'square', industry: 'telecommunications', motif: 'four connected nodes arranged in a diamond with curved links', colours: 'slate blue and lime green' }
};

const STUDIO = 'Plain seamless light warm-grey studio background, soft frontal key light with gentle fill, an 85mm portrait lens look, ' +
  'square 1:1 crop showing the head and shoulders, the eyes about 40% from the top of the frame, looking at the camera with a neutral, friendly ' +
  'expression, realistic skin texture, a neutral natural colour grade.';
const MADE_UP = 'An ordinary made-up person — never a real, famous or named person, and not resembling one. Exactly one person, alone in the frame.';

/* gen-design.js IMAGE_TAIL, read from the file (it is not exported), so the portraits follow the same closing rule as
   every site picture */
function imageTail() {
  const src = fs.readFileSync(GEN_DESIGN, 'utf8');
  const m = /\nvar IMAGE_TAIL = '((?:[^'\\]|\\.)*)';/.exec(src);
  if (!m) throw new Error('IMAGE_TAIL was not found in functions/lib/gen-design.js; the portrait prompts would lose their closing rule.');
  return m[1].replace(/\\'/g, "'");
}

function personPrompt(look, withReference, tail) {
  if (!withReference) {
    return 'A head-and-shoulders studio portrait of ONE fictional Indian (South Asian) professional: ' + look + '. ' + STUDIO + ' ' + MADE_UP + tail;
  }
  return 'Make a new head-and-shoulders studio portrait that matches the reference picture exactly in background, lighting, framing, ' +
    'lens, crop, eye height, distance from the camera and colour grade; only the person is different: ONE fictional Indian (South Asian) ' +
    'professional, ' + look + '. ' + MADE_UP + ' Not the person in the reference.' + tail;
}
function logoPrompt(l) {
  return 'A simple, flat, abstract logo symbol for a fictional ' + l.industry + ' company: ' + l.motif + '. Flat vector style, two solid colours (' +
    l.colours + '), crisp clean edges, no gradients, no shadows, no 3D, no frame or box around it. The symbol alone, centred on a pure white ' +
    'background with wide empty margins on every side. STRICT: no letters, no words, no initials, no numbers and no text of any kind; it must ' +
    'not resemble any existing company\'s or brand\'s logo; no watermark.';
}

/* the 24 jobs, in the order they are made (p01 first: the others need it) */
function jobs(lib, tail) {
  tail = tail == null ? imageTail() : tail;
  const out = [];
  lib.people.forEach(function (p) {
    const id = p.id.replace(/^ex-/, ''), look = PEOPLE_LOOKS[id];
    if (!look) throw new Error('No look written for ' + p.id + ' (' + p.name + ').');
    if (look.gender !== p.gender) throw new Error(p.id + ' is a ' + p.gender + ' in library.json but a ' + look.gender + ' here.');
    const rel = p.photo.replace(/^\//, '');
    out.push({ id: id, kind: 'person', name: p.name, gender: p.gender, rel: rel, target: path.join(ROOT, rel),
      reference: id === 'p01' ? null : 'p01', prompt: personPrompt(look.look, id !== 'p01', tail) });
  });
  lib.partners.forEach(function (p) {
    const id = p.id.replace(/^ex-/, ''), look = LOGO_LOOKS[id];
    if (!look) throw new Error('No symbol written for ' + p.id + ' (' + p.name + ').');
    const rel = p.logo.replace(/^\//, '');
    out.push({ id: id, kind: 'logo', name: p.name, tier: p.tier, shape: look.shape, rel: rel, target: path.join(ROOT, rel), prompt: logoPrompt(look) });
  });
  return out;
}

/* '' when a run may call the image model, else what to tell the person */
function keyProblem(env) {
  if (env && typeof env.GEMINI_API_KEY === 'string' && env.GEMINI_API_KEY.trim()) return '';
  return 'GEMINI_API_KEY is not set in this shell, so no picture can be made. Load it into the environment of this one command and run ' +
    'it again (this script never reads a key from a file), or add --dry-run to see the prompts without making anything.';
}

function parseArgs(argv) {
  const a = { dryRun: false, force: false, only: null, sheet: DEFAULT_SHEET };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--force') a.force = true;
    else if (v === '--only' && argv[i + 1]) a.only = String(argv[++i]).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    else if (v === '--sheet' && argv[i + 1]) a.sheet = path.resolve(argv[++i]);
    else return { error: 'Unknown or incomplete option "' + v + '".' };
  }
  return a;
}
function select(all, only) {
  if (!only) return all;
  const ids = {};
  only.forEach(function (o) {
    if (o === 'people') all.filter(function (j) { return j.kind === 'person'; }).forEach(function (j) { ids[j.id] = 1; });
    else if (o === 'logos') all.filter(function (j) { return j.kind === 'logo'; }).forEach(function (j) { ids[j.id] = 1; });
    else ids[o] = 1;
  });
  const unknown = Object.keys(ids).filter(function (id) { return !all.some(function (j) { return j.id === id; }); });
  if (unknown.length) throw new Error('Unknown picture id: ' + unknown.join(', ') + ' (p01-p12, l01-l12, people, logos).');
  return all.filter(function (j) { return ids[j.id]; });
}

function printDry(list, args) {
  list.forEach(function (j) {
    console.log(j.id + '  ' + j.name + (j.kind === 'person' ? ' (' + j.gender + ')' : ' (' + j.tier + ', ' + j.shape + ')'));
    console.log('  target: ' + j.rel + (j.kind === 'person' ? '  (640 × 640 JPEG)' : '  (transparent PNG, trimmed, name set in type)'));
    if (j.kind === 'person') console.log('  reference: ' + (j.reference ? j.reference + '.jpg (one tone)' : 'none: this portrait sets the tone for p02-p12'));
    console.log('  prompt: ' + j.prompt);
    console.log('');
  });
  console.log('contact sheet: ' + args.sheet);
  console.log(list.length + ' pictures. Dry run: no request was made and nothing was written.');
}

/* ---------- the pictures' finishing, after the image model (sharp is handed in; no request is made here) ---------- */

function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';

function tools(sharp) {
  /* a text line set in type, trimmed to its ink */
  function textLine(text, size, weight, colour, spacing) {
    const w = Math.ceil(text.length * size * 0.8) + 40, h = Math.ceil(size * 1.6);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><text x="10" y="' + Math.round(size * 1.15) +
      '" font-family="' + FONT + '" font-size="' + size + '" font-weight="' + weight + '" letter-spacing="' + (spacing || 0) + '" fill="' + colour + '">' +
      escXml(text) + '</text></svg>';
    return sharp(Buffer.from(svg)).png().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  }

  /* near-white becomes transparent (soft at the edge, with the white taken back out of the colour), then trimmed */
  function cutOut(buf) {
    return sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(function (o) {
      const d = o.data;
      for (let i = 0; i < d.length; i += 4) {
        const dist = 255 - Math.min(d[i], d[i + 1], d[i + 2]);
        const a = dist <= 10 ? 0 : dist >= 50 ? 1 : (dist - 10) / 40;
        if (a > 0 && a < 1) for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] - 255 * (1 - a)) / a)));
        d[i + 3] = Math.round(a * 255);
      }
      return sharp(d, { raw: { width: o.info.width, height: o.info.height, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer();
    });
  }

  function lockup(job, mark) {
    const words = job.name.split(' '), first = words[0], rest = words.slice(1).join(' ').toUpperCase();
    const ink = '#1d2433', soft = '#4a5468';
    const wide = job.shape === 'wide';
    return Promise.all([
      sharp(mark).resize(wide ? { height: 260, width: 360, fit: 'inside' } : { height: 300, width: 380, fit: 'inside' }).png().toBuffer({ resolveWithObject: true }),
      textLine(first, wide ? 112 : 92, 700, ink, 0),
      rest ? textLine(rest, wide ? 50 : 42, 600, soft, wide ? 8 : 6) : Promise.resolve(null)
    ]).then(function (r) {
      const m = r[0], t1 = r[1], t2 = r[2], gap = wide ? 44 : 30, lineGap = wide ? 22 : 18;
      const textW = Math.max(t1.info.width, t2 ? t2.info.width : 0), textH = t1.info.height + (t2 ? lineGap + t2.info.height : 0);
      let W, H, parts;
      if (wide) {
        W = m.info.width + gap + textW; H = Math.max(m.info.height, textH);
        const tx = m.info.width + gap, ty = Math.round((H - textH) / 2);
        parts = [{ input: m.data, left: 0, top: Math.round((H - m.info.height) / 2) }, { input: t1.data, left: tx, top: ty }];
        if (t2) parts.push({ input: t2.data, left: tx, top: ty + t1.info.height + lineGap });
      } else {
        W = Math.max(m.info.width, textW); H = m.info.height + gap + textH;
        parts = [{ input: m.data, left: Math.round((W - m.info.width) / 2), top: 0 },
          { input: t1.data, left: Math.round((W - t1.info.width) / 2), top: m.info.height + gap }];
        if (t2) parts.push({ input: t2.data, left: Math.round((W - t2.info.width) / 2), top: m.info.height + gap + t1.info.height + lineGap });
      }
      return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(parts).png().toBuffer()
        .then(function (b) {
          return sharp(b).resize(wide ? { width: 900, height: 300, fit: 'inside', withoutEnlargement: true } : { width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
            .png({ palette: true, quality: 92, effort: 8, compressionLevel: 9 }).toBuffer();
        });
    });
  }

  /* the model's portrait, as the library keeps it: square 640, JPEG q80 (a mail cannot crop, so it must be 1:1) */
  function portrait(buf) {
    return sharp(buf).rotate().resize(640, 640, { fit: 'cover', position: 'centre' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  }

  return { textLine: textLine, cutOut: cutOut, lockup: lockup, portrait: portrait };
}

/* ---------- the real run (only with a key; sharp and the image call are loaded only here) ---------- */

function run(list, args, all) {
  const sharp = require('sharp');
  const gemini = require(path.join(ROOT, 'functions', 'lib', 'gemini.js'));
  const T = tools(sharp);
  const made = [], kept = [], failed = [];
  let stop = '';

  function attempt(prompt, opts, tries) {
    return gemini.callGeminiImage(prompt, Object.assign({ timeoutMs: 120000, route: 'make-promo-examples' }, opts)).then(function (r) {
      if (r && r.base64) return Buffer.from(r.base64, 'base64');
      const code = (r && r.code) || 'ai-bad-output';
      /* a refusal, a quota or a key problem would only fail again (and cost again): give up on the rest */
      if (code === 'ai-quota' || code === 'ai-config') stop = (r && r.error) || code;
      if (tries > 1 && (code === 'ai-bad-output' || code === 'ai-unavailable' || code === 'ai-timeout')) return attempt(prompt, opts, tries - 1);
      throw new Error((r && r.error) || code);
    });
  }

  function write(job, buf) {
    fs.mkdirSync(path.dirname(job.target), { recursive: true });
    fs.writeFileSync(job.target, buf);
    return sharp(buf).metadata().then(function (m) {
      console.log(job.id + '  ' + job.name + ': written ' + job.rel + ' (' + m.width + ' × ' + m.height + ', ' + Math.round(buf.length / 1024) + ' KB)');
      made.push(job.id);
    });
  }

  let reference = null;   // p01 as the others' reference, base64 JPEG
  function referenceFor() {
    if (reference) return reference;
    const p01 = all.filter(function (j) { return j.id === 'p01'; })[0];
    if (!fs.existsSync(p01.target)) {
      const err = new Error('p01.jpg is the reference for p02-p12 and is not there yet: make it first (--only p01).');
      err.noReference = true;
      throw err;
    }
    reference = fs.readFileSync(p01.target).toString('base64');
    return reference;
  }

  function one(job) {
    if (stop) { failed.push(job.id + ' (not tried: ' + stop + ')'); return Promise.resolve(); }
    if (!args.force && !args.only && fs.existsSync(job.target)) { kept.push(job.id); return Promise.resolve(); }
    console.log(job.id + '  ' + job.name + ': asking the image model…');
    let p;
    if (job.kind === 'person') {
      /* the reference is read inside the chain: when p01 could not be made, each later portrait fails on its own
         ("no reference") instead of ending the run, so the logos and the contact sheet are still made */
      p = Promise.resolve().then(function () {
        return attempt(job.prompt, job.reference ? { image: { mimeType: 'image/jpeg', data: referenceFor() } } : {}, 2);
      }).then(T.portrait).then(function (jpg) {
        if (job.id === 'p01') reference = jpg.toString('base64');
        return write(job, jpg);
      });
    } else {
      p = attempt(job.prompt, {}, 2).then(T.cutOut).then(function (mark) { return T.lockup(job, mark); }).then(function (png) { return write(job, png); });
    }
    return p.catch(function (err) {
      console.error(job.id + '  ' + job.name + ': FAILED — ' + (err && err.message || err));
      failed.push(job.id + (err && err.noReference ? ' (no reference)' : ''));
    });
  }

  function sheet() {
    const faces = all.filter(function (j) { return j.kind === 'person'; }), logos = all.filter(function (j) { return j.kind === 'logo'; });
    const W = 1440, pad = 40, face = 200, faceGap = 24, tileW = 320, tileH = 160, tileGap = 24, label = 46;
    const facesTop = 110, logosTop = facesTop + 2 * (face + label + faceGap) + 60;
    const H = logosTop + 3 * (tileH + label + tileGap) + pad;
    const parts = [];
    function labelSvg(text, w, size, colour) {
      return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + label + '"><text x="' + (w / 2) + '" y="' + (size + 8) +
        '" text-anchor="middle" font-family="' + FONT + '" font-size="' + size + '" fill="' + colour + '">' + escXml(text) + '</text></svg>');
    }
    parts.push({ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="90"><text x="' + pad + '" y="56" font-family="' + FONT +
      '" font-size="30" font-weight="700" fill="#1d2433">Oneworld 2.0 — example library for review (' + escXml(new Date().toISOString().slice(0, 10)) +
      ')</text></svg>'), left: 0, top: 10 });
    const jobsDone = faces.map(function (j, i) {
      const left = pad + (i % 6) * (face + faceGap + 14), top = facesTop + Math.floor(i / 6) * (face + label + faceGap);
      parts.push({ input: labelSvg(j.id + ' ' + j.name, face + 14, 15, '#1d2433'), left: left - 7, top: top + face + 4 });
      if (!fs.existsSync(j.target)) return Promise.resolve();
      return sharp(j.target).resize(face, face).toBuffer().then(function (b) { parts.push({ input: b, left: left, top: top }); });
    }).concat(logos.map(function (j, i) {
      const left = pad + (i % 4) * (tileW + tileGap), top = logosTop + Math.floor(i / 4) * (tileH + label + tileGap);
      parts.push({ input: { create: { width: tileW, height: tileH, channels: 4, background: '#ffffff' } }, left: left, top: top });
      parts.push({ input: labelSvg(j.id + ' ' + j.name + ' · ' + j.tier, tileW, 14, '#1d2433'), left: left, top: top + tileH + 4 });
      if (!fs.existsSync(j.target)) return Promise.resolve();
      return sharp(j.target).resize(tileW - 40, tileH - 40, { fit: 'inside' }).toBuffer({ resolveWithObject: true }).then(function (o) {
        parts.push({ input: o.data, left: left + Math.round((tileW - o.info.width) / 2), top: top + Math.round((tileH - o.info.height) / 2) });
      });
    }));
    return Promise.all(jobsDone).then(function () {
      fs.mkdirSync(path.dirname(args.sheet), { recursive: true });
      return sharp({ create: { width: W, height: H, channels: 4, background: '#f3efe8' } }).composite(parts).png().toFile(args.sheet);
    }).then(function () { console.log('Contact sheet: ' + args.sheet); });
  }

  return list.reduce(function (p, job) { return p.then(function () { return one(job); }); }, Promise.resolve())
    .then(sheet)
    .then(function () {
      console.log('Made ' + made.length + ', kept ' + kept.length + ' already there, failed ' + failed.length + (failed.length ? ': ' + failed.join(', ') : '') + '.');
      if (list.some(function (j) { return j.id === 'p01'; }) && list.filter(function (j) { return j.kind === 'person'; }).length < 12 && made.indexOf('p01') !== -1) {
        console.log('Note: p01 was made again on its own; p02-p12 keep the old tone until they are made again too (--only people).');
      }
      return failed.length ? 1 : 0;
    });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(args.error + '\n' + USAGE); return 2; }
  let list, all;
  try {
    const lib = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8'));
    all = jobs(lib);
    list = select(all, args.only);
  } catch (err) { console.error(err.message); return 2; }
  if (args.dryRun) { printDry(list, args); return 0; }
  const problem = keyProblem(process.env);
  if (problem) { console.error(problem); return 2; }
  return run(list, args, all);
}

if (require.main === module) {
  Promise.resolve(main()).then(function (code) { process.exitCode = code; }, function (err) {
    console.error('make-promo-examples: ' + (err && err.stack || err));
    process.exitCode = 1;
  });
}

module.exports = { jobs: jobs, keyProblem: keyProblem, parseArgs: parseArgs, select: select, imageTail: imageTail, tools: tools, PEOPLE_LOOKS: PEOPLE_LOOKS, LOGO_LOOKS: LOGO_LOOKS };
/* for the test only: it drives run() with a stand-in image call and pictures in a temporary folder */
module.exports._test = { run: run };
