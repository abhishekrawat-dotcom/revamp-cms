import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Columns2,
  Heart,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Type,
  X,
} from 'lucide-react';
import type {
  BookProject,
  GoogleFontItem,
  TextRole,
  TypographyPreset,
  TypographySystem,
  UserFontCollection,
} from '../types/bookstudio';
import {
  auditProjectFonts,
  GOOGLE_FONTS_CATALOG,
  loadGoogleFont,
  replaceFontNonDestructively,
} from '../engines/fontEngine';
import { fetchTypographyPairings } from '../services/aiService';
import { apiGet } from '../services/api';

interface TypographyStudioModalProps {
  project: BookProject;
  fontCollection: UserFontCollection;
  onUpdateProject: (updated: BookProject) => void;
  onSaveFontCollection: (collection: UserFontCollection) => void;
  onClose: () => void;
}

const EDITORIAL_STYLES = [
  'Luxury Editorial',
  'Minimalist Architecture',
  'Museum Monograph',
  'Corporate Coffee Table Book',
  'Art & Photography',
  'Heritage & Cultural',
  'Modern Contemporary',
];

export const TypographyStudioModal: React.FC<TypographyStudioModalProps> = ({
  project,
  fontCollection,
  onUpdateProject,
  onSaveFontCollection,
  onClose,
}) => {
  const [tab, setTab] = useState<'library' | 'preview' | 'ai_pairing' | 'replace' | 'collection' | 'audit'>('library');
  const [catalog, setCatalog] = useState<GoogleFontItem[]>(GOOGLE_FONTS_CATALOG);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | GoogleFontItem['category']>('all');
  const [onlyVariable, setOnlyVariable] = useState(false);
  const [onlyItalic, setOnlyItalic] = useState(false);
  const [scriptFilter, setScriptFilter] = useState('all');
  const [customFontInput, setCustomFontInput] = useState('');
  const [customFontStatus, setCustomFontStatus] = useState<string | null>(null);

  // Live Preview & Comparison
  const [compareFontA, setCompareFontA] = useState(project.designSystem.typography.displayFont);
  const [compareFontB, setCompareFontB] = useState(project.designSystem.typography.bodyFont);
  const [previewText, setPreviewText] = useState(
    'Forms of Silence — Courtyard Stone & Light. 0123456789'
  );
  const [previewMode, setPreviewMode] = useState<'heading' | 'body' | 'quote' | 'alphabet'>('heading');
  const [previewSizePx, setPreviewSizePx] = useState(28);
  const [previewWeight, setPreviewWeight] = useState(400);
  const [previewLeading, setPreviewLeading] = useState(1.35);
  const [previewTracking, setPreviewTracking] = useState(0);
  const [previewUpper, setPreviewUpper] = useState(false);

  // AI Pairing Assistant
  const [pairingStyle, setPairingStyle] = useState(EDITORIAL_STYLES[0]);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairings, setPairings] = useState<
    Array<{
      name: string;
      rationale: string;
      displayFont: string;
      headingFont: string;
      secondaryFont: string;
      bodyFont: string;
      captionFont: string;
      quoteFont: string;
      numericalFont: string;
    }>
  >([]);

  // Non-destructive Font Replacement
  const [replaceScope, setReplaceScope] = useState<'book' | 'selected_pages'>('book');
  const [replaceRole, setReplaceRole] = useState<TextRole | 'all'>('all');
  const [replaceFromFamily, setReplaceFromFamily] = useState<string>('');
  const [replaceToFamily, setReplaceToFamily] = useState<string>(
    project.designSystem.typography.displayFont
  );
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>(
    project.pages.slice(0, 2).map((p) => p.id)
  );
  const [replaceNotice, setReplaceNotice] = useState<string | null>(null);

  // Preset Save Name
  const [presetName, setPresetName] = useState('');

  // The whole Google Fonts library from EventSphere's server (GET /api/books/fonts, read from Google and kept a day);
  // when it cannot be read, the catalog this editor carries stays, and the page says so.
  const [catalogNote, setCatalogNote] = useState('Loading the Google Fonts library…');
  const [shownCount, setShownCount] = useState(120);
  useEffect(() => {
    let active = true;
    apiGet<{ source: string; items: GoogleFontItem[] }>('/fonts')
      .then((data) => {
        if (!active) return;
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
          setCatalogNote(`The full Google Fonts list could not be loaded just now, so ${GOOGLE_FONTS_CATALOG.length} chosen fonts are shown.`);
          return;
        }
        const byName = new Map<string, GoogleFontItem>();
        for (const f of GOOGLE_FONTS_CATALOG) byName.set(f.family.toLowerCase(), f);
        const merged: GoogleFontItem[] = [...GOOGLE_FONTS_CATALOG];
        for (const item of items) {
          if (!item || !item.family || byName.has(String(item.family).toLowerCase())) continue;
          merged.push({
            family: item.family,
            category: item.category || 'sans-serif',
            weights: Array.isArray(item.weights) && item.weights.length ? item.weights : [400],
            hasItalic: !!item.hasItalic,
            isVariable: !!item.isVariable,
            scripts: Array.isArray(item.scripts) && item.scripts.length ? item.scripts : ['latin'],
            styleTag: item.styleTag || 'modern',
            license: item.license || 'Open Font License (embeddable)',
          });
        }
        setCatalog(merged);
        setCatalogNote(`Google Fonts library: ${merged.length.toLocaleString()} families.`);
      })
      .catch(() => {
        if (active) setCatalogNote(`The full Google Fonts list could not be loaded just now, so ${GOOGLE_FONTS_CATALOG.length} chosen fonts are shown.`);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => setShownCount(120), [search, category, onlyVariable, onlyItalic, scriptFilter]);

  const filteredFonts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((f) => {
      if (category !== 'all' && f.category !== category) return false;
      if (onlyVariable && !f.isVariable) return false;
      if (onlyItalic && !f.hasItalic) return false;
      if (scriptFilter !== 'all' && !f.scripts.includes(scriptFilter)) return false;
      if (!q) return true;
      return f.family.toLowerCase().includes(q) || f.styleTag.toLowerCase().includes(q);
    });
  }, [catalog, search, category, onlyVariable, onlyItalic, scriptFilter]);

  const fontAudit = useMemo(() => auditProjectFonts(project), [project]);

  const handleLoadCustomGoogleFont = async () => {
    const fam = customFontInput.trim();
    if (!fam) return;
    setCustomFontStatus(`Loading "${fam}" via Google Fonts CSS2...`);
    const res = await loadGoogleFont(fam);
    if (res === 'loaded') {
      setCustomFontStatus(`Loaded "${fam}" successfully — ready to assign or compare.`);
      if (!catalog.some((c) => c.family.toLowerCase() === fam.toLowerCase())) {
        setCatalog((prev) => [
          {
            family: fam,
            category: 'serif',
            weights: [400, 600, 700],
            hasItalic: true,
            isVariable: false,
            scripts: ['latin'],
            styleTag: 'editorial',
            license: 'Google Fonts OFL (Embeddable)',
          },
          ...prev,
        ]);
      }
      setCompareFontA(fam);
    } else {
      setCustomFontStatus(`Could not load "${fam}". Check exact Google Fonts family spelling.`);
    }
  };

  const assignFontToRole = (
    roleKey:
      | 'primaryFont'
      | 'secondaryFont'
      | 'displayFont'
      | 'headingFont'
      | 'bodyFont'
      | 'captionFont'
      | 'quoteFont'
      | 'numericalFont',
    family: string
  ) => {
    void loadGoogleFont(family);
    const roleMap: Partial<Record<typeof roleKey, TextRole>> = {
      displayFont: 'display',
      headingFont: 'heading',
      bodyFont: 'body',
      captionFont: 'caption',
      quoteFont: 'quote',
      numericalFont: 'folio',
    };
    const mappedRole = roleMap[roleKey];
    let updated: BookProject = {
      ...project,
      designSystem: {
        ...project.designSystem,
        typography: {
          ...project.designSystem.typography,
          [roleKey]: family,
        },
      },
    };
    if (mappedRole) {
      updated = replaceFontNonDestructively(updated, {
        targetRole: mappedRole,
        toFamily: family,
        scope: 'book',
      });
    }
    onUpdateProject(updated);
  };

  const toggleFavoriteFont = (family: string) => {
    const exists = fontCollection.fonts.includes(family);
    const nextFonts = exists
      ? fontCollection.fonts.filter((f) => f !== family)
      : [...fontCollection.fonts, family];
    onSaveFontCollection({
      ...fontCollection,
      fonts: nextFonts,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSaveCurrentPreset = () => {
    if (!presetName.trim()) return;
    const nextPreset: TypographyPreset = {
      id: `tpre_${Date.now()}`,
      name: presetName.trim(),
      style: project.category,
      typography: structuredClone(project.designSystem.typography),
    };
    onSaveFontCollection({
      ...fontCollection,
      presets: [nextPreset, ...fontCollection.presets],
      updatedAt: new Date().toISOString(),
    });
    setPresetName('');
  };

  const applyTypographySystem = (typo: Partial<TypographySystem>) => {
    const nextTypo: TypographySystem = {
      ...project.designSystem.typography,
      ...typo,
    };
    [
      nextTypo.displayFont,
      nextTypo.headingFont,
      nextTypo.bodyFont,
      nextTypo.captionFont,
      nextTypo.quoteFont,
      nextTypo.numericalFont,
    ].forEach((f) => void loadGoogleFont(f));

    let updated: BookProject = {
      ...project,
      designSystem: {
        ...project.designSystem,
        typography: nextTypo,
      },
    };
    updated = replaceFontNonDestructively(updated, {
      targetRole: 'display',
      toFamily: nextTypo.displayFont,
      scope: 'book',
    });
    updated = replaceFontNonDestructively(updated, {
      targetRole: 'heading',
      toFamily: nextTypo.headingFont,
      scope: 'book',
    });
    updated = replaceFontNonDestructively(updated, {
      targetRole: 'body',
      toFamily: nextTypo.bodyFont,
      scope: 'book',
    });
    updated = replaceFontNonDestructively(updated, {
      targetRole: 'caption',
      toFamily: nextTypo.captionFont,
      scope: 'book',
    });
    updated = replaceFontNonDestructively(updated, {
      targetRole: 'quote',
      toFamily: nextTypo.quoteFont,
      scope: 'book',
    });
    updated = replaceFontNonDestructively(updated, {
      targetRole: 'folio',
      toFamily: nextTypo.numericalFont,
      scope: 'book',
    });
    onUpdateProject(updated);
  };

  const runAiPairing = async () => {
    setPairingLoading(true);
    setPairingError(null);
    try {
      const result = await fetchTypographyPairings({
        style: pairingStyle,
        bookCategory: project.category,
        currentFonts: {
          display: project.designSystem.typography.displayFont,
          body: project.designSystem.typography.bodyFont,
        },
      });
      result.forEach((p) => {
        void loadGoogleFont(p.displayFont);
        void loadGoogleFont(p.headingFont);
        void loadGoogleFont(p.bodyFont);
        void loadGoogleFont(p.captionFont);
      });
      setPairings(result);
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : 'Failed to fetch typography pairings');
    } finally {
      setPairingLoading(false);
    }
  };

  const executeNonDestructiveReplacement = () => {
    const updated = replaceFontNonDestructively(project, {
      targetRole: replaceRole,
      fromFamily: replaceFromFamily || undefined,
      toFamily: replaceToFamily,
      scope: replaceScope,
      selectedPageIds,
    });
    onUpdateProject(updated);
    setReplaceNotice(
      `Applied "${replaceToFamily}" non-destructively across ${
        replaceScope === 'book' ? 'entire book' : `${selectedPageIds.length} selected page(s)`
      } while preserving all sizes, weights, colours, line heights, and frame geometry.`
    );
  };

  const sampleCopy =
    previewMode === 'alphabet'
      ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789 · — & § ©'
      : previewMode === 'quote'
        ? '“Architecture is the learned game, correct and magnificent, of forms assembled in the light.”'
        : previewMode === 'body'
          ? 'Across twelve residential courtyards, honest limestone and hand-planed teak temper harsh afternoon glare into cool, measured stillness. Proportions remain faithful to the approved editorial grid.'
          : previewText;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl h-[88vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-medium text-[#F4F1EA]">
              Google Fonts Library & Global Typography Studio
            </h2>
            <p className="text-[11px] text-[#98958D]">
              Dynamic Google Fonts CSS2 loading · Non-destructive book-wide or page-by-page replacement · Production font audit
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 py-2 border-b border-white/[0.08] bg-[#141417] flex flex-wrap gap-1">
          {(
            [
              ['library', Type, 'Google Fonts Library'],
              ['preview', Columns2, 'Live Compare & Specimen'],
              ['ai_pairing', Sparkles, 'AI Pairing Assistant'],
              ['replace', RefreshCw, 'Global & Page Replacement'],
              ['collection', Heart, `My Editorial Fonts (${fontCollection.fonts.length})`],
              ['audit', ShieldCheck, `Production Audit (${fontAudit.length})`],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-xs rounded flex items-center gap-1.5 cursor-pointer ${
                tab === id
                  ? 'bg-[#28282F] text-[#ECEAE4] font-medium'
                  : 'text-[#98958D] hover:text-[#ECEAE4]'
              }`}
            >
              <Icon className="w-3.5 h-3.5 text-[#C6A26B]" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 1. GOOGLE FONTS LIBRARY */}
          {tab === 'library' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-60">
                    <Search className="w-3.5 h-3.5 text-[#7F7C75] absolute left-2.5 top-2" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search Google Fonts..."
                      className="w-full bg-[#121214] border border-white/[0.1] rounded pl-8 pr-3 py-1.5 text-xs text-[#ECEAE4]"
                    />
                  </div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as 'all' | GoogleFontItem['category'])}
                    className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
                  >
                    <option value="all">All Categories</option>
                    <option value="serif">Serif</option>
                    <option value="sans-serif">Sans-Serif</option>
                    <option value="display">Display</option>
                    <option value="monospace">Monospace</option>
                    <option value="handwriting">Handwriting / Script</option>
                  </select>
                  <select
                    value={scriptFilter}
                    onChange={(e) => setScriptFilter(e.target.value)}
                    className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
                  >
                    <option value="all">All Scripts</option>
                    <option value="latin">Latin</option>
                    <option value="latin-ext">Latin Extended</option>
                    <option value="devanagari">Devanagari</option>
                    <option value="arabic">Arabic</option>
                    <option value="cyrillic">Cyrillic</option>
                    <option value="greek">Greek</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-[#A19E95] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyVariable}
                      onChange={(e) => setOnlyVariable(e.target.checked)}
                      className="accent-[#C6A26B]"
                    />
                    <span>Variable</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[#A19E95] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyItalic}
                      onChange={(e) => setOnlyItalic(e.target.checked)}
                      className="accent-[#C6A26B]"
                    />
                    <span>Italic</span>
                  </label>
                </div>

                {/* Live load any Google Font by exact name */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={customFontInput}
                    onChange={(e) => setCustomFontInput(e.target.value)}
                    placeholder="Load any Google Font name..."
                    className="w-48 bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
                  />
                  <button
                    onClick={handleLoadCustomGoogleFont}
                    className="px-3 py-1.5 bg-[#C6A26B] text-[#121214] text-xs font-medium rounded cursor-pointer"
                  >
                    Load CSS2
                  </button>
                </div>
              </div>

              {customFontStatus && (
                <div className="text-xs text-[#DFC08E] bg-[#24211B] border border-[#C6A26B]/30 rounded px-3 py-2">
                  {customFontStatus}
                </div>
              )}

              <div className="text-[11px] text-[#98958D]">
                {catalogNote}
                {filteredFonts.length > shownCount && ` Showing ${shownCount} of ${filteredFonts.length.toLocaleString()} — search to narrow the list.`}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredFonts.slice(0, shownCount).map((f) => {
                  const isFav = fontCollection.fonts.includes(f.family);
                  return (
                    <div
                      key={f.family}
                      onMouseEnter={() => void loadGoogleFont(f.family, f.weights)}
                      className="p-3.5 bg-[#141417] border border-white/[0.08] hover:border-[#C6A26B]/50 rounded-md flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-[#F4F1EA]">{f.family}</div>
                          <div className="text-[10px] text-[#8F8C84] mt-0.5">
                            {f.category} · {f.weights.length} weights
                            {f.isVariable ? ' · Variable' : ''}
                            {f.hasItalic ? ' · Italic' : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => toggleFavoriteFont(f.family)}
                          className="p-1 text-[#98958D] hover:text-[#C6A26B] cursor-pointer"
                        >
                          <Heart
                            className="w-3.5 h-3.5"
                            fill={isFav ? '#C6A26B' : 'none'}
                            color={isFav ? '#C6A26B' : 'currentColor'}
                          />
                        </button>
                      </div>

                      <div
                        style={{ fontFamily: `"${f.family}", serif` }}
                        className="text-xl text-[#ECEAE4] py-2 border-y border-white/[0.06] truncate"
                      >
                        Architecture & Light 1964
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          onClick={() => assignFontToRole('displayFont', f.family)}
                          className="px-2 py-1 text-[10px] bg-[#232329] hover:bg-[#31313A] text-[#ECEAE4] rounded cursor-pointer"
                        >
                          Set Display
                        </button>
                        <button
                          onClick={() => assignFontToRole('headingFont', f.family)}
                          className="px-2 py-1 text-[10px] bg-[#232329] hover:bg-[#31313A] text-[#ECEAE4] rounded cursor-pointer"
                        >
                          Set Heading
                        </button>
                        <button
                          onClick={() => assignFontToRole('bodyFont', f.family)}
                          className="px-2 py-1 text-[10px] bg-[#232329] hover:bg-[#31313A] text-[#ECEAE4] rounded cursor-pointer"
                        >
                          Set Body
                        </button>
                        <button
                          onClick={() => {
                            void loadGoogleFont(f.family, f.weights);
                            setCompareFontA(f.family);
                            setTab('preview');
                          }}
                          className="ml-auto px-2 py-1 text-[10px] text-[#C6A26B] hover:underline cursor-pointer"
                        >
                          Compare
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {filteredFonts.length > shownCount && (
                <button
                  onClick={() => setShownCount((n) => n + 120)}
                  className="px-3 py-1.5 bg-[#25252C] hover:bg-[#32323B] text-xs text-[#ECEAE4] rounded cursor-pointer"
                >
                  Show 120 more
                </button>
              )}
            </div>
          )}

          {/* 2. LIVE PREVIEW & SIDE-BY-SIDE COMPARISON */}
          {tab === 'preview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-[#141417] p-4 rounded-md border border-white/[0.08]">
                <label className="md:col-span-2 flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Custom Specimen Text</span>
                  <input
                    type="text"
                    value={previewText}
                    onChange={(e) => setPreviewText(e.target.value)}
                    className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Specimen Mode</span>
                  <select
                    value={previewMode}
                    onChange={(e) =>
                      setPreviewMode(e.target.value as 'heading' | 'body' | 'quote' | 'alphabet')
                    }
                    className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1.5 text-xs text-[#ECEAE4]"
                  >
                    <option value="heading">Heading Specimen</option>
                    <option value="body">Editorial Paragraph</option>
                    <option value="quote">Pull Quote</option>
                    <option value="alphabet">Full Alphabet & Numerals</option>
                  </select>
                </label>

                <label className="flex items-center gap-2 text-xs text-[#A19E95] pt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={previewUpper}
                    onChange={(e) => setPreviewUpper(e.target.checked)}
                    className="accent-[#C6A26B]"
                  />
                  <span>Uppercase Preview</span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Size ({previewSizePx}px)</span>
                  <input
                    type="range"
                    min={12}
                    max={64}
                    value={previewSizePx}
                    onChange={(e) => setPreviewSizePx(Number(e.target.value))}
                    className="accent-[#C6A26B]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Weight ({previewWeight})</span>
                  <input
                    type="range"
                    min={300}
                    max={800}
                    step={100}
                    value={previewWeight}
                    onChange={(e) => setPreviewWeight(Number(e.target.value))}
                    className="accent-[#C6A26B]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Leading ({previewLeading})</span>
                  <input
                    type="range"
                    min={1}
                    max={2.2}
                    step={0.05}
                    value={previewLeading}
                    onChange={(e) => setPreviewLeading(parseFloat(e.target.value))}
                    className="accent-[#C6A26B]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Tracking ({previewTracking}em)</span>
                  <input
                    type="range"
                    min={-0.05}
                    max={0.25}
                    step={0.01}
                    value={previewTracking}
                    onChange={(e) => setPreviewTracking(parseFloat(e.target.value))}
                    className="accent-[#C6A26B]"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(
                  [
                    ['Specimen A (Display / Heading)', compareFontA, setCompareFontA],
                    ['Specimen B (Body / Secondary)', compareFontB, setCompareFontB],
                  ] as const
                ).map(([label, font, setter]) => (
                  <div
                    key={label}
                    className="p-5 bg-[#FBF9F5] text-[#1C1917] rounded-md border border-white/15 space-y-4"
                  >
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-black/10">
                      <span className="text-[11px] font-medium text-[#6B665F]">{label}</span>
                      <select
                        value={font}
                        onChange={(e) => {
                          void loadGoogleFont(e.target.value);
                          setter(e.target.value);
                        }}
                        className="bg-white border border-black/15 rounded px-2 py-1 text-xs text-[#1C1917]"
                      >
                        {catalog.map((f) => (
                          <option key={f.family} value={f.family}>
                            {f.family}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div
                      style={{
                        fontFamily: `"${font}", serif`,
                        fontSize: `${previewSizePx}px`,
                        fontWeight: previewWeight,
                        lineHeight: previewLeading,
                        letterSpacing: `${previewTracking}em`,
                        textTransform: previewUpper ? 'uppercase' : 'none',
                        whiteSpace: 'pre-wrap',
                      }}
                      className="min-h-[160px]"
                    >
                      {sampleCopy}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. AI TYPOGRAPHY PAIRING ASSISTANT */}
          {tab === 'ai_pairing' && (
            <div className="space-y-5">
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {EDITORIAL_STYLES.map((st) => (
                    <button
                      key={st}
                      onClick={() => setPairingStyle(st)}
                      className={`px-3 py-1.5 text-xs rounded cursor-pointer ${
                        pairingStyle === st
                          ? 'bg-[#C6A26B] text-[#121214] font-medium'
                          : 'bg-[#222228] text-[#A19E95] hover:text-white'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
                <button
                  onClick={runAiPairing}
                  disabled={pairingLoading}
                  className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-50 text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
                >
                  {pairingLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{pairingLoading ? 'Curating Pairings...' : 'Suggest Google Font Pairings'}</span>
                </button>
              </div>

              {pairingError && <div className="text-xs text-[#E07A5F]">{pairingError}</div>}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {pairings.map((p, idx) => (
                  <div
                    key={`${p.name}_${idx}`}
                    className="p-4 bg-[#141417] border border-white/[0.08] rounded-md flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2.5">
                      <div className="text-xs font-semibold text-[#C6A26B]">{p.name}</div>
                      <div
                        style={{ fontFamily: `"${p.displayFont}", serif` }}
                        className="text-2xl text-[#F4F1EA]"
                      >
                        Forms of Light
                      </div>
                      <p
                        style={{ fontFamily: `"${p.bodyFont}", serif` }}
                        className="text-xs text-[#D7D4CC] leading-relaxed"
                      >
                        Stone, shadow, and calibrated white space elevate editorial storytelling.
                      </p>
                      <div className="text-[10px] text-[#98958D] space-y-0.5 pt-2 border-t border-white/[0.06]">
                        <div>Display: {p.displayFont}</div>
                        <div>Heading: {p.headingFont}</div>
                        <div>Body: {p.bodyFont}</div>
                        <div>Caption: {p.captionFont} · Quote: {p.quoteFont}</div>
                        <div>Numerals: {p.numericalFont}</div>
                      </div>
                      <p className="text-[11px] text-[#8F8C84]">{p.rationale}</p>
                    </div>

                    <button
                      onClick={() =>
                        applyTypographySystem({
                          primaryFont: p.headingFont,
                          secondaryFont: p.secondaryFont,
                          displayFont: p.displayFont,
                          headingFont: p.headingFont,
                          bodyFont: p.bodyFont,
                          captionFont: p.captionFont,
                          quoteFont: p.quoteFont,
                          numericalFont: p.numericalFont,
                        })
                      }
                      className="w-full py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Apply Pairing Non-Destructively</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. GLOBAL & PAGE-BY-PAGE NON-DESTRUCTIVE FONT REPLACEMENT */}
          {tab === 'replace' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Role Assignment Table */}
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                <div className="text-xs font-semibold text-[#F4F1EA]">
                  Active Book Typography Hierarchy (8 Roles)
                </div>
                {(
                  [
                    ['Primary Font', 'primaryFont'],
                    ['Secondary Font', 'secondaryFont'],
                    ['Display / Cover', 'displayFont'],
                    ['Chapter & Section Headings', 'headingFont'],
                    ['Body Copy', 'bodyFont'],
                    ['Captions & Labels', 'captionFont'],
                    ['Pull Quotes', 'quoteFont'],
                    ['Folios & Numerals', 'numericalFont'],
                  ] as const
                ).map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[#A19E95]">{label}</span>
                    <select
                      value={project.designSystem.typography[key]}
                      onChange={(e) => assignFontToRole(key, e.target.value)}
                      className="w-52 bg-[#121214] border border-white/[0.1] rounded px-2 py-1 text-xs text-[#ECEAE4]"
                    >
                      {catalog.map((f) => (
                        <option key={f.family} value={f.family}>
                          {f.family}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Targeted Non-Destructive Replacement Engine */}
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-4">
                <div>
                  <div className="text-xs font-semibold text-[#F4F1EA]">
                    Non-Destructive Font Replacement
                  </div>
                  <p className="text-[11px] text-[#98958D] mt-0.5">
                    Swaps font family only — strictly preserving existing font size, weight, colour, line height, letter spacing, paragraph spacing, and frame dimensions.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Scope</span>
                    <select
                      value={replaceScope}
                      onChange={(e) => setReplaceScope(e.target.value as 'book' | 'selected_pages')}
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1.5 text-xs text-[#ECEAE4]"
                    >
                      <option value="book">Entire Book</option>
                      <option value="selected_pages">Selected Pages Only</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Target Text Role</span>
                    <select
                      value={replaceRole}
                      onChange={(e) => setReplaceRole(e.target.value as TextRole | 'all')}
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1.5 text-xs text-[#ECEAE4]"
                    >
                      <option value="all">All Roles</option>
                      <option value="display">Display</option>
                      <option value="heading">Headings</option>
                      <option value="subheading">Subheadings</option>
                      <option value="body">Body Copy</option>
                      <option value="caption">Captions</option>
                      <option value="quote">Pull Quotes</option>
                      <option value="folio">Folios</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Replace From (Optional filter)</span>
                    <select
                      value={replaceFromFamily}
                      onChange={(e) => setReplaceFromFamily(e.target.value)}
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1.5 text-xs text-[#ECEAE4]"
                    >
                      <option value="">Any current font</option>
                      {fontAudit.map((fa) => (
                        <option key={fa.family} value={fa.family}>
                          {fa.family}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Replace With Google Font</span>
                    <select
                      value={replaceToFamily}
                      onChange={(e) => setReplaceToFamily(e.target.value)}
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1.5 text-xs text-[#ECEAE4]"
                    >
                      {catalog.map((f) => (
                        <option key={f.family} value={f.family}>
                          {f.family}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {replaceScope === 'selected_pages' && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-[#98958D]">Choose Target Pages</span>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {project.pages.map((p, idx) => {
                        const checked = selectedPageIds.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={() =>
                              setSelectedPageIds((prev) =>
                                checked ? prev.filter((i) => i !== p.id) : [...prev, p.id]
                              )
                            }
                            className={`px-2 py-1 text-[11px] rounded border cursor-pointer ${
                              checked
                                ? 'bg-[#2A2824] border-[#C6A26B] text-[#ECEAE4]'
                                : 'bg-[#121214] border-white/[0.08] text-[#8F8C84]'
                            }`}
                          >
                            P.{idx + 1} · {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {replaceNotice && (
                  <div className="p-2.5 bg-[#1D251C] border border-[#8AA678]/40 rounded text-[11px] text-[#CDE2BF]">
                    {replaceNotice}
                  </div>
                )}

                <button
                  onClick={executeNonDestructiveReplacement}
                  className="w-full py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded cursor-pointer"
                >
                  Apply Non-Destructive Font Replacement
                </button>
              </div>
            </div>
          )}

          {/* 5. MY EDITORIAL FONTS & SAVED PRESETS */}
          {tab === 'collection' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                <div className="text-xs font-semibold text-[#F4F1EA]">
                  Favourited Editorial Fonts ({fontCollection.fonts.length})
                </div>
                {fontCollection.fonts.length === 0 ? (
                  <p className="text-xs text-[#8F8C84]">
                    Click the heart icon on any Google Font in the Library to bookmark it here.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {fontCollection.fonts.map((fam) => (
                      <div
                        key={fam}
                        className="px-3 py-2 bg-[#1D1D22] rounded flex items-center justify-between"
                      >
                        <span style={{ fontFamily: `"${fam}", serif` }} className="text-sm text-[#ECEAE4]">
                          {fam}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => assignFontToRole('headingFont', fam)}
                            className="px-2 py-0.5 text-[10px] bg-[#2B2B33] text-[#D7D4CC] rounded cursor-pointer"
                          >
                            Heading
                          </button>
                          <button
                            onClick={() => assignFontToRole('bodyFont', fam)}
                            className="px-2 py-0.5 text-[10px] bg-[#2B2B33] text-[#D7D4CC] rounded cursor-pointer"
                          >
                            Body
                          </button>
                          <button
                            onClick={() => toggleFavoriteFont(fam)}
                            className="text-[10px] text-[#8F8C84] hover:text-[#E07A5F] cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                <div className="text-xs font-semibold text-[#F4F1EA]">
                  Saved Reusable Typography Presets
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="Preset name (e.g., Museum Monograph Serif)"
                    className="flex-1 bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
                  />
                  <button
                    onClick={handleSaveCurrentPreset}
                    className="px-3 py-1.5 bg-[#C6A26B] text-[#121214] text-xs font-medium rounded flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Save Current</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {fontCollection.presets.map((pre) => (
                    <div
                      key={pre.id}
                      className="p-3 bg-[#1D1D22] border border-white/[0.06] rounded flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-medium text-[#ECEAE4]">{pre.name}</div>
                        <div className="text-[10px] text-[#98958D]">
                          {pre.typography.displayFont} · {pre.typography.bodyFont} ·{' '}
                          {pre.typography.captionFont}
                        </div>
                      </div>
                      <button
                        onClick={() => applyTypographySystem(pre.typography)}
                        className="px-2.5 py-1 bg-[#2A2824] hover:bg-[#38352D] border border-[#C6A26B]/50 text-[11px] text-[#E6CFA5] rounded cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 6. FONT PRODUCTION AUDIT */}
          {tab === 'audit' && (
            <div className="space-y-3">
              <div className="text-xs text-[#98958D]">
                Live audit of every typeface currently used across pages, frames, and infographics in this book.
              </div>
              <div className="overflow-x-auto border border-white/[0.08] rounded-md">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#141417] text-[11px] text-[#98958D] border-b border-white/[0.08]">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Font Family</th>
                      <th className="px-4 py-2.5 font-medium">Weights Used</th>
                      <th className="px-4 py-2.5 font-medium">Pages</th>
                      <th className="px-4 py-2.5 font-medium">Elements</th>
                      <th className="px-4 py-2.5 font-medium">Load Status</th>
                      <th className="px-4 py-2.5 font-medium">Design System</th>
                      <th className="px-4 py-2.5 font-medium">License / Embedding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {fontAudit.map((row) => (
                      <tr key={row.family} className="bg-[#18181B]">
                        <td className="px-4 py-2.5 font-medium text-[#ECEAE4]">{row.family}</td>
                        <td className="px-4 py-2.5 font-mono-tabular text-[#A19E95]">
                          {row.weightsUsed.join(', ')}
                        </td>
                        <td className="px-4 py-2.5 font-mono-tabular text-[#A19E95]">
                          {row.pageCount}
                        </td>
                        <td className="px-4 py-2.5 font-mono-tabular text-[#A19E95]">
                          {row.elementCount}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={
                              row.status === 'loaded'
                                ? 'text-[#8AA678]'
                                : row.status === 'error'
                                  ? 'text-[#E07A5F]'
                                  : 'text-[#D4A657]'
                            }
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={row.isSystemApproved ? 'text-[#8AA678]' : 'text-[#D4A657]'}
                          >
                            {row.isSystemApproved ? 'Approved' : 'Off-System'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[#98958D]">{row.license}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
