import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type {
  BookPage,
  BookProject,
  ContentSection,
  DesignSystem,
  ImageAsset,
  PageDimensions,
  TemplateAnalysisReport,
} from '../types/bookstudio';
import { analyzeUploadedTemplates } from '../services/aiService';
import { errorText, imageForAi } from '../services/api';
import { parseIdmlFile, uploadImageAssets, uploadManuscript } from '../services/storageService';
import { createDefaultMasterPages } from '../data/sampleProject';
import { CURATED_IMAGE_ASSETS, EDITORIAL_PHOTOS } from '../data/curatedAssets';
import { inferOrientation } from '../engines/dimensionEngine';
import { loadGoogleFont } from '../engines/fontEngine';

interface TemplateUploadModalProps {
  onClose: () => void;
  onCreateProjectFromApprovedReport: (project: BookProject) => void;
}

interface UploadedRefFile {
  name: string;
  mimeType: string;
  base64: string;
  previewUrl?: string;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export const TemplateUploadModal: React.FC<TemplateUploadModalProps> = ({
  onClose,
  onCreateProjectFromApprovedReport,
}) => {
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [projectName, setProjectName] = useState('Untitled Editorial Monograph');
  const [bookBrief, setBookBrief] = useState('');
  const [templateFiles, setTemplateFiles] = useState<UploadedRefFile[]>([]);
  const [idmlMetadata, setIdmlMetadata] = useState<Record<string, unknown> | null>(null);
  const [inddNotice, setInddNotice] = useState<string | null>(null);
  const [uploadedAssets, setUploadedAssets] = useState<ImageAsset[]>([]);
  const [parsedSections, setParsedSections] = useState<ContentSection[]>([]);
  const [pastedText, setPastedText] = useState('');

  const [analyzing, setAnalyzing] = useState(false);
  const [uploadingContent, setUploadingContent] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [report, setReport] = useState<TemplateAnalysisReport | null>(null);

  const handleTemplateFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setInddNotice(null);

    const nextRefs: UploadedRefFile[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (ext === 'indd' || ext === 'idml') {
        try {
          const data = await parseIdmlFile(file);
          if (data.isNativeIndd) {
            setInddNotice(data.guidance || 'InDesign (.indd) files cannot be read here. Export an .idml or PDF spreads from InDesign and upload those.');
          } else if (data.idml) {
            const meta = data.idml;
            setIdmlMetadata(meta as unknown as Record<string, unknown>);
            setInddNotice(
              `Read ${file.name}: ${meta.widthMm} × ${meta.heightMm} mm, ${meta.pageCount || meta.spreadCount} ${meta.pageCount ? 'pages' : 'spreads'}, ` +
                `${meta.columns} column${meta.columns === 1 ? '' : 's'}, ${meta.detectedFonts.length} font${meta.detectedFonts.length === 1 ? '' : 's'}` +
                (meta.detectedFonts.length ? ` (${meta.detectedFonts.slice(0, 4).join(', ')}${meta.detectedFonts.length > 4 ? '…' : ''})` : '') +
                `, ${meta.detectedColors.length} colour${meta.detectedColors.length === 1 ? '' : 's'}.`
            );
          }
        } catch (err) {
          setErrorMsg(errorText(err, `${file.name} could not be read.`));
        }
        continue;
      }

      try {
        if (file.type === 'application/pdf' || ext === 'pdf') {
          if (file.size > 20 * 1024 * 1024) {
            setErrorMsg(`${file.name} is larger than 20 MB. Export fewer pages, or lower-resolution spreads, and try again.`);
            continue;
          }
          nextRefs.push({ name: file.name, mimeType: 'application/pdf', base64: await readFileAsBase64(file) });
        } else if (file.type.startsWith('image/')) {
          // ETB2B AI looks at a copy at most 1600 px on its long side: enough to read the layout, a fraction of the upload
          const small = await imageForAi(file);
          nextRefs.push({ name: file.name, mimeType: small.mimeType, base64: small.base64, previewUrl: URL.createObjectURL(file) });
        } else {
          setErrorMsg(`${file.name} is not a JPG, PNG, WebP, PDF or IDML file.`);
        }
      } catch (err) {
        setErrorMsg(errorText(err, `${file.name} could not be read.`));
      }
    }

    setTemplateFiles((prev) => [...prev, ...nextRefs]);
    e.target.value = '';
  };

  const handleContentFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingContent(true);
    setErrorMsg(null);
    try {
      const data = await uploadManuscript(file);
      const incoming: ContentSection[] = (data.sections || []).map(
        (s: ContentSection, i: number) => ({
          id: `sec_up_${Date.now()}_${i}`,
          title: s.title || `Section ${i + 1}`,
          kind: s.kind || 'body',
          body: s.body,
          orderIndex: parsedSections.length + i,
        })
      );
      setParsedSections((prev) => [...prev, ...incoming]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Content upload failed');
    } finally {
      setUploadingContent(false);
      e.target.value = '';
    }
  };

  const handleBulkImagesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingImages(true);
    setErrorMsg(null);
    try {
      const { assets, failed } = await uploadImageAssets(files, (done, total) =>
        setUploadProgress(done < total ? `Uploading photo ${done + 1} of ${total}…` : '')
      );
      setUploadedAssets((prev) => [...prev, ...assets]);
      if (failed.length) {
        setErrorMsg(
          failed.length === 1
            ? `${failed[0].name} was not added: ${failed[0].error}`
            : `${failed.length} photos were not added: ` + failed.map((f) => `${f.name} (${f.error})`).join('; ')
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Bulk image upload failed');
    } finally {
      setUploadingImages(false);
      setUploadProgress('');
      e.target.value = '';
    }
  };

  const handleRunAnalysis = async () => {
    if (templateFiles.length === 0 && !idmlMetadata) {
      setErrorMsg('Upload at least one reference template spread (JPG, PNG, PDF, or IDML) first.');
      return;
    }
    setAnalyzing(true);
    setErrorMsg(null);
    try {
      const result = await analyzeUploadedTemplates({
        files: templateFiles.map(({ name, mimeType, base64 }) => ({ name, mimeType, base64 })),
        idmlMetadata,
        bookBrief,
      });
      setReport(result);
      void loadGoogleFont(result.typography.displayFont);
      void loadGoogleFont(result.typography.headingFont);
      void loadGoogleFont(result.typography.bodyFont);
      void loadGoogleFont(result.typography.captionFont);
      setStep('review');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Template analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApproveAndCreateBook = () => {
    if (!report) return;

    const approvedReport: TemplateAnalysisReport = { ...report, approved: true };
    const W = Math.max(100, Number(approvedReport.pageSize.widthMm) || 240);
    const H = Math.max(100, Number(approvedReport.pageSize.heightMm) || 300);
    const m = approvedReport.gridSystem.margins || { top: 20, bottom: 22, inner: 24, outer: 18 };
    const contentW = Math.max(40, W - m.inner - m.outer);

    const dimensions: PageDimensions = {
      widthMm: W,
      heightMm: H,
      orientation: inferOrientation(W, H),
      rotation: 0,
      margins: m,
      gutterMm: 12,
      bleedMm: 3,
      safeAreaMm: 6,
      columns: approvedReport.gridSystem.columns || 2,
      columnGapMm: approvedReport.gridSystem.columnGapMm || 6,
      baselineGridMm: approvedReport.gridSystem.baselineMm || 4,
      spreadMode: 'facing',
      presetName: approvedReport.pageSize.recommendedPreset || 'Extracted Template Format',
    };

    const designSystem: DesignSystem = {
      name: `${projectName} Master System`,
      approved: true,
      sourceTemplateName: approvedReport.sourceFiles.join(', ') || 'Uploaded Design Template',
      colors: {
        paper: approvedReport.colourPalette.paper || '#FBF9F5',
        surface: approvedReport.colourPalette.surface || '#EFECE4',
        ink: approvedReport.colourPalette.ink || '#1C1917',
        mutedInk: approvedReport.colourPalette.mutedInk || '#6B665F',
        primaryAccent: approvedReport.colourPalette.primaryAccent || '#A67C46',
        secondaryAccent: approvedReport.colourPalette.secondaryAccent || '#3D4C52',
        palette:
          approvedReport.colourPalette.swatches?.length > 0
            ? approvedReport.colourPalette.swatches
            : [
                approvedReport.colourPalette.paper,
                approvedReport.colourPalette.surface,
                approvedReport.colourPalette.ink,
                approvedReport.colourPalette.primaryAccent,
                approvedReport.colourPalette.secondaryAccent,
              ],
      },
      typography: {
        primaryFont: approvedReport.typography.headingFont || 'Playfair Display',
        secondaryFont: approvedReport.typography.bodyFont || 'Lora',
        displayFont: approvedReport.typography.displayFont || 'Playfair Display',
        headingFont: approvedReport.typography.headingFont || 'Playfair Display',
        bodyFont: approvedReport.typography.bodyFont || 'Lora',
        captionFont: approvedReport.typography.captionFont || 'Plus Jakarta Sans',
        quoteFont: approvedReport.typography.quoteFont || 'Cormorant Garamond',
        numericalFont: approvedReport.typography.numericalFont || 'JetBrains Mono',
        scale: {
          displayPt: approvedReport.typography.displaySizePt || 38,
          headingPt: approvedReport.typography.headingSizePt || 22,
          subheadingPt: Math.max(12, Math.round((approvedReport.typography.headingSizePt || 22) * 0.65)),
          bodyPt: approvedReport.typography.bodySizePt || 10.5,
          captionPt: approvedReport.typography.captionSizePt || 8.5,
          quotePt: 17,
          folioPt: 8.5,
        },
        minApprovedBodyPt: 8.5,
      },
      spacing: {
        baselineMm: dimensions.baselineGridMm,
        paragraphGapMm: 4,
        sectionGapMm: 10,
        imageCaptionGapMm: 3,
      },
      grid: {
        columns: dimensions.columns,
        gutterMm: dimensions.columnGapMm,
        margins: dimensions.margins,
      },
    };

    const masters = createDefaultMasterPages({
      paper: designSystem.colors.paper,
      surface: designSystem.colors.surface,
      ink: designSystem.colors.ink,
      mutedInk: designSystem.colors.mutedInk,
      accent: designSystem.colors.primaryAccent,
      headingFont: designSystem.typography.headingFont,
      bodyFont: designSystem.typography.bodyFont,
      captionFont: designSystem.typography.captionFont,
      numericalFont: designSystem.typography.numericalFont,
      widthMm: W,
      heightMm: H,
    });

    // Combine uploaded assets + curated editorial assets
    const allAssets = [...uploadedAssets, ...structuredClone(CURATED_IMAGE_ASSETS)];
    // each photo placed with its own pixel size, so the print check's resolution warning is true
    const photoAt = (i: number, fallbackId: string): ImageAsset =>
      uploadedAssets[i] || (CURATED_IMAGE_ASSETS.find((a) => a.id === fallbackId) as ImageAsset);
    const lead = photoAt(0, 'asset_courtyard');
    const second = photoAt(1, 'asset_interior');
    const third = photoAt(2, 'asset_panorama');
    const leadPhoto = lead?.url || EDITORIAL_PHOTOS.courtyard;
    const secondPhoto = second?.url || EDITORIAL_PHOTOS.interior;

    // Combine parsed + pasted manuscript sections
    const extraPasted: ContentSection[] = pastedText
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((para, idx) => ({
        id: `sec_paste_${Date.now()}_${idx}`,
        title: `Pasted Section ${idx + 1}`,
        kind: 'body',
        body: para,
        orderIndex: parsedSections.length + idx,
      }));
    const allSections = [...parsedSections, ...extraPasted];

    const firstCopy =
      allSections[0]?.body ||
      'This editable coffee table book preserves the approved design system extracted from your uploaded reference template. Double-click any text frame to edit copy, or drag photographs directly into fixed frames without disturbing layout proportions.';
    const secondCopy =
      allSections[1]?.body ||
      'Additional manuscript sections uploaded during setup remain queued in the Content Manager so you can place them intentionally across spreads without overflowing or breaking approved typography.';

    const pages: BookPage[] = [
      {
        id: `pg_cover_${Date.now()}`,
        orderIndex: 0,
        label: 'Front Cover',
        role: 'front_cover',
        backgroundColor: designSystem.colors.ink,
        elements: [
          {
            id: 'el_cov_img',
            name: 'Cover Hero Photograph',
            type: 'image',
            xMm: 0,
            yMm: 0,
            widthMm: W,
            heightMm: Math.round(H * 0.62),
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 1,
            image: {
              src: leadPhoto,
              alt: projectName,
              fit: 'cover',
              zoom: 1,
              focalX: 50,
              focalY: 50,
              naturalWidth: lead?.widthPx || 1200,
              naturalHeight: lead?.heightPx || 896,
            },
          },
          {
            id: 'el_cov_title',
            name: 'Cover Title',
            type: 'text',
            xMm: m.outer,
            yMm: Math.round(H * 0.67),
            widthMm: contentW,
            heightMm: 36,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 2,
            textRole: 'display',
            text: projectName,
            textStyle: {
              fontFamily: designSystem.typography.displayFont,
              fontSizePt: designSystem.typography.scale.displayPt,
              fontWeight: 500,
              color: designSystem.colors.paper,
              lineHeight: 1.08,
              letterSpacingEm: -0.01,
              textAlign: 'left',
              verticalAlign: 'top',
              paragraphSpacingMm: 4,
              columns: 1,
              columnGapMm: 5,
              insetMm: 0,
            },
          },
          {
            id: 'el_cov_sub',
            name: 'Cover Subtitle',
            type: 'text',
            xMm: m.outer,
            yMm: Math.round(H * 0.84),
            widthMm: contentW,
            heightMm: 18,
            rotation: 0,
            opacity: 0.8,
            locked: false,
            hidden: false,
            zIndex: 3,
            textRole: 'caption',
            text: approvedReport.summary.slice(0, 120),
            textStyle: {
              fontFamily: designSystem.typography.captionFont,
              fontSizePt: 9.5,
              fontWeight: 400,
              color: designSystem.colors.paper,
              lineHeight: 1.45,
              letterSpacingEm: 0.04,
              textAlign: 'left',
              verticalAlign: 'top',
              paragraphSpacingMm: 2,
              columns: 1,
              columnGapMm: 5,
              insetMm: 0,
            },
          },
        ],
      },
      {
        id: `pg_ch1_${Date.now()}`,
        orderIndex: 1,
        label: 'Chapter Opener',
        role: 'chapter_opener',
        masterPageId: masters[1]?.id,
        backgroundColor: designSystem.colors.surface,
        elements: [
          {
            id: 'el_ch1_num',
            name: 'Chapter Eyebrow',
            type: 'text',
            xMm: m.outer,
            yMm: m.top + 8,
            widthMm: contentW,
            heightMm: 10,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 2,
            textRole: 'caption',
            text: 'CHAPTER ONE · APPROVED TEMPLATE SYSTEM',
            textStyle: {
              fontFamily: designSystem.typography.captionFont,
              fontSizePt: 8.5,
              fontWeight: 600,
              color: designSystem.colors.primaryAccent,
              lineHeight: 1.2,
              letterSpacingEm: 0.16,
              textAlign: 'left',
              verticalAlign: 'top',
              paragraphSpacingMm: 0,
              columns: 1,
              columnGapMm: 5,
              insetMm: 0,
              textTransform: 'uppercase',
            },
          },
          {
            id: 'el_ch1_title',
            name: 'Chapter Title',
            type: 'text',
            xMm: m.outer,
            yMm: m.top + 22,
            widthMm: contentW,
            heightMm: 34,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 2,
            textRole: 'heading',
            text: allSections[0]?.title || 'Design Heritage & Editorial Narrative',
            textStyle: {
              fontFamily: designSystem.typography.headingFont,
              fontSizePt: Math.max(24, designSystem.typography.scale.headingPt + 4),
              fontWeight: 500,
              color: designSystem.colors.ink,
              lineHeight: 1.12,
              letterSpacingEm: -0.01,
              textAlign: 'left',
              verticalAlign: 'top',
              paragraphSpacingMm: 4,
              columns: 1,
              columnGapMm: 5,
              insetMm: 0,
            },
          },
          {
            id: 'el_ch1_img',
            name: 'Chapter Plate',
            type: 'image',
            xMm: m.outer,
            yMm: m.top + 68,
            widthMm: contentW,
            heightMm: Math.max(60, H - m.top - m.bottom - 76),
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 1,
            image: {
              src: secondPhoto,
              alt: 'Chapter Plate',
              fit: 'cover',
              zoom: 1,
              focalX: 50,
              focalY: 50,
              naturalWidth: second?.widthPx || 896,
              naturalHeight: second?.heightPx || 1200,
            },
          },
        ],
      },
      {
        id: `pg_ed1_${Date.now()}`,
        orderIndex: 2,
        label: 'Editorial Spread',
        role: 'editorial_text',
        masterPageId: masters[0]?.id,
        backgroundColor: designSystem.colors.paper,
        elements: [
          {
            id: 'el_ed_hd',
            name: 'Essay Heading',
            type: 'text',
            xMm: m.inner,
            yMm: m.top + 6,
            widthMm: contentW,
            heightMm: 22,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 2,
            textRole: 'heading',
            text: allSections[0]?.title || 'Opening Curatorial Essay',
            textStyle: {
              fontFamily: designSystem.typography.headingFont,
              fontSizePt: designSystem.typography.scale.headingPt,
              fontWeight: 500,
              color: designSystem.colors.ink,
              lineHeight: 1.2,
              letterSpacingEm: 0,
              textAlign: 'left',
              verticalAlign: 'top',
              paragraphSpacingMm: 3,
              columns: 1,
              columnGapMm: 5,
              insetMm: 0,
            },
          },
          {
            id: 'el_ed_body',
            name: 'Primary Essay Body',
            type: 'text',
            xMm: m.inner,
            yMm: m.top + 34,
            widthMm: contentW,
            heightMm: Math.max(80, H - m.top - m.bottom - 48),
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 2,
            textRole: 'body',
            text: `${firstCopy}\n\n${secondCopy}`,
            textStyle: {
              fontFamily: designSystem.typography.bodyFont,
              fontSizePt: designSystem.typography.scale.bodyPt,
              fontWeight: 400,
              color: designSystem.colors.ink,
              lineHeight: 1.55,
              letterSpacingEm: 0,
              textAlign: 'left',
              verticalAlign: 'top',
              paragraphSpacingMm: 4,
              columns: Math.min(2, dimensions.columns),
              columnGapMm: dimensions.columnGapMm,
              insetMm: 0,
            },
          },
        ],
      },
      {
        id: `pg_plate_${Date.now()}`,
        orderIndex: 3,
        label: 'Full-Bleed Plate',
        role: 'full_bleed_image',
        masterPageId: masters[2]?.id,
        backgroundColor: designSystem.colors.paper,
        elements: [
          {
            id: 'el_pl_img',
            name: 'Full-Bleed Archival Plate',
            type: 'image',
            xMm: -3,
            yMm: -3,
            widthMm: W + 6,
            heightMm: H + 6,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 1,
            image: {
              src: third?.url || EDITORIAL_PHOTOS.panorama,
              alt: 'Full-bleed plate',
              fit: 'cover',
              zoom: 1,
              focalX: 50,
              focalY: 50,
              naturalWidth: third?.widthPx || 1376,
              naturalHeight: third?.heightPx || 768,
            },
          },
        ],
      },
    ];

    const now = new Date().toISOString();
    const newProject: BookProject = {
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: projectName.trim() || 'Untitled Monograph',
      subtitle: approvedReport.summary,
      category: 'Uploaded Template Edition',
      status: 'draft',
      unit: 'mm',
      coverThumbnail: leadPhoto,
      dimensions,
      designSystem,
      masterPages: masters,
      chapters: [
        {
          id: 'ch_1',
          number: 1,
          title: 'Chapter I — Primary Folio',
          masterPageId: masters[0].id,
          orderIndex: 0,
        },
      ],
      contentSections: allSections,
      imageAssets: allAssets,
      pages,
      templateReport: approvedReport,
      printSettings: {
        bindingType: 'smyth_hardcover',
        paperStockName: '170 gsm Matte Museum Art Paper',
        paperCaliperMm: 0.145,
        coverBoardCaliperMm: 2.5,
        printerToleranceMm: 1.5,
        includeBleed: true,
        includeCropMarks: true,
        includeRegistrationMarks: true,
        colorSpace: 'CMYK_SIMULATED',
        targetDpi: 300,
        exportSpreads: false,
      },
      customDimensionPresets: [],
      createdAt: now,
      updatedAt: now,
    };

    onCreateProjectFromApprovedReport(newProject);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-medium text-[#F4F1EA]">
              {step === 'upload'
                ? 'Upload Design Template, Manuscript & Photographs'
                : 'Template Analysis Report — Review & Approve Master Design System'}
            </h2>
            <p className="text-xs text-[#98958D] mt-0.5">
              {step === 'upload'
                ? 'Your uploaded template serves as the master design authority. Nothing is recreated until you review and approve the extracted design system.'
                : 'Inspect and fine-tune every extracted colour, font, margin, and grid value before generating your editable book.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="p-3 bg-[#2B1B19] border border-[#D94F3D]/50 rounded text-xs text-[#F5CFC7] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#E07A5F]" />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 'upload' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column: Template Reference Upload */}
              <div className="space-y-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[#D7D4CC]">Publication Title</span>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="bg-[#121214] border border-white/[0.1] rounded px-3 py-2 text-xs text-[#ECEAE4] focus:outline-none focus:border-[#C6A26B]"
                  />
                </label>

                <div className="p-4 bg-[#141417] border border-dashed border-[#C6A26B]/50 rounded-md space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#ECEAE4]">
                    <Layers className="w-4 h-4 text-[#C6A26B]" />
                    <span>1. Upload Existing Design Template (Required)</span>
                  </div>
                  <p className="text-[11px] text-[#98958D] leading-relaxed">
                    Accepts JPG, JPEG, PNG, PDF spreads, or Adobe InDesign <span className="text-[#ECEAE4]">.IDML</span> packages (with guidance for .INDD export).
                  </p>
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Choose Template Spreads / IDML</span>
                    <input
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.pdf,.idml,.indd"
                      onChange={handleTemplateFilesSelect}
                      className="hidden"
                    />
                  </label>

                  {inddNotice && (
                    <div className="p-2.5 bg-[#23211C] border border-[#C6A26B]/35 rounded text-[11px] text-[#E6CFA5]">
                      {inddNotice}
                    </div>
                  )}

                  {templateFiles.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {templateFiles.map((tf, idx) => (
                        <div
                          key={`${tf.name}_${idx}`}
                          className="bg-[#1E1E22] border border-white/[0.08] rounded p-1.5 space-y-1 relative"
                        >
                          {tf.previewUrl ? (
                            <img
                              src={tf.previewUrl}
                              alt={tf.name}
                              className="w-full h-16 object-cover rounded-sm"
                            />
                          ) : (
                            <div className="w-full h-16 bg-[#121214] rounded-sm flex items-center justify-center text-[10px] text-[#98958D]">
                              PDF
                            </div>
                          )}
                          <div className="text-[10px] text-[#D7D4CC] truncate">{tf.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[#D7D4CC]">
                    Editorial Brief / Notes (Optional)
                  </span>
                  <textarea
                    rows={3}
                    value={bookBrief}
                    onChange={(e) => setBookBrief(e.target.value)}
                    placeholder="e.g., 160-page museum architectural monograph, preserve warm limestone paper stock and serif headings..."
                    className="bg-[#121214] border border-white/[0.1] rounded p-2.5 text-xs text-[#ECEAE4] placeholder-[#73706A] focus:outline-none focus:border-[#C6A26B]"
                  />
                </label>
              </div>

              {/* Right Column: Content & Bulk Photographs */}
              <div className="space-y-4">
                <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#ECEAE4]">
                      <FileText className="w-4 h-4 text-[#C6A26B]" />
                      <span>2. Upload Manuscript Content (Optional)</span>
                    </div>
                    <span className="font-mono-tabular text-[11px] text-[#98958D]">
                      {parsedSections.length} sections
                    </span>
                  </div>
                  <p className="text-[11px] text-[#98958D]">
                    DOCX, PDF, TXT, RTF, CSV, or direct text paste below.
                  </p>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#26262C] hover:bg-[#313139] text-xs text-[#ECEAE4] rounded cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingContent ? 'Extracting Manuscript...' : 'Upload Manuscript File'}</span>
                    <input
                      type="file"
                      accept=".docx,.pdf,.txt,.rtf,.csv"
                      onChange={handleContentFileUpload}
                      className="hidden"
                    />
                  </label>
                  <textarea
                    rows={3}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Or paste chapters, essays, or captions directly here..."
                    className="w-full bg-[#121214] border border-white/[0.08] rounded p-2 text-xs text-[#ECEAE4] placeholder-[#73706A]"
                  />
                </div>

                <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#ECEAE4]">
                      <ImageIcon className="w-4 h-4 text-[#C6A26B]" />
                      <span>3. Bulk Upload Photographs (Optional)</span>
                    </div>
                    <span className="font-mono-tabular text-[11px] text-[#98958D]">
                      {uploadedAssets.length} uploaded
                    </span>
                  </div>
                  <p className="text-[11px] text-[#98958D]">
                    JPG, PNG, TIFF or WebP, up to 30 MB each, kept in this book's photo library.
                  </p>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#26262C] hover:bg-[#313139] text-xs text-[#ECEAE4] rounded cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingImages ? uploadProgress || 'Uploading…' : 'Select Bulk Photographs'}</span>
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,image/tiff,.tif,.tiff"
                      onChange={handleBulkImagesUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          ) : (
            report && (
              <div className="space-y-5">
                <div className="p-4 bg-[#141417] border border-[#C6A26B]/35 rounded-md space-y-1">
                  <div className="text-xs font-medium text-[#C6A26B]">
                    Extracted Master Design Summary
                  </div>
                  <p className="text-xs text-[#D7D4CC] leading-relaxed">{report.summary}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Dimensions & Grid */}
                  <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                    <div className="text-xs font-semibold text-[#ECEAE4]">
                      Trim Dimensions & Grid
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-[#98958D] flex flex-col gap-1">
                        <span>Width (mm)</span>
                        <input
                          type="number"
                          value={report.pageSize.widthMm}
                          onChange={(e) =>
                            setReport({
                              ...report,
                              pageSize: { ...report.pageSize, widthMm: Number(e.target.value) || 240 },
                            })
                          }
                          className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1 font-mono-tabular text-xs text-[#ECEAE4]"
                        />
                      </label>
                      <label className="text-[11px] text-[#98958D] flex flex-col gap-1">
                        <span>Height (mm)</span>
                        <input
                          type="number"
                          value={report.pageSize.heightMm}
                          onChange={(e) =>
                            setReport({
                              ...report,
                              pageSize: { ...report.pageSize, heightMm: Number(e.target.value) || 300 },
                            })
                          }
                          className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1 font-mono-tabular text-xs text-[#ECEAE4]"
                        />
                      </label>
                      <label className="text-[11px] text-[#98958D] flex flex-col gap-1">
                        <span>Columns</span>
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={report.gridSystem.columns}
                          onChange={(e) =>
                            setReport({
                              ...report,
                              gridSystem: { ...report.gridSystem, columns: Number(e.target.value) || 2 },
                            })
                          }
                          className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1 font-mono-tabular text-xs text-[#ECEAE4]"
                        />
                      </label>
                      <label className="text-[11px] text-[#98958D] flex flex-col gap-1">
                        <span>Baseline (mm)</span>
                        <input
                          type="number"
                          value={report.gridSystem.baselineMm}
                          onChange={(e) =>
                            setReport({
                              ...report,
                              gridSystem: { ...report.gridSystem, baselineMm: Number(e.target.value) || 4 },
                            })
                          }
                          className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1 font-mono-tabular text-xs text-[#ECEAE4]"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Extracted Colour System */}
                  <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                    <div className="text-xs font-semibold text-[#ECEAE4]">
                      Extracted Colour System
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ['Paper', 'paper'],
                          ['Surface', 'surface'],
                          ['Primary Ink', 'ink'],
                          ['Accent', 'primaryAccent'],
                        ] as const
                      ).map(([label, key]) => (
                        <label key={key} className="flex items-center gap-2 text-[11px] text-[#A19E95]">
                          <input
                            type="color"
                            value={report.colourPalette[key]}
                            onChange={(e) =>
                              setReport({
                                ...report,
                                colourPalette: { ...report.colourPalette, [key]: e.target.value },
                              })
                            }
                            className="w-6 h-6 rounded border border-white/15 bg-transparent cursor-pointer"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Extracted Typography */}
                  <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-2.5">
                    <div className="text-xs font-semibold text-[#ECEAE4]">
                      Extracted Typography
                    </div>
                    {(
                      [
                        ['Display', 'displayFont'],
                        ['Heading', 'headingFont'],
                        ['Body', 'bodyFont'],
                        ['Caption', 'captionFont'],
                      ] as const
                    ).map(([label, key]) => (
                      <label key={key} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-[#98958D]">{label}</span>
                        <input
                          type="text"
                          value={report.typography[key]}
                          onChange={(e) =>
                            setReport({
                              ...report,
                              typography: { ...report.typography, [key]: e.target.value },
                            })
                          }
                          className="w-40 bg-[#121214] border border-white/[0.1] rounded px-2 py-0.5 text-xs text-[#ECEAE4]"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* Layout Patterns & Master Recommendations */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-2">
                    <div className="text-xs font-semibold text-[#ECEAE4]">
                      Detected Layout & Image Placement Patterns
                    </div>
                    <ul className="space-y-1 text-xs text-[#A19E95] list-disc pl-4">
                      {report.pageLayoutCategories.map((c, i) => (
                        <li key={`cat_${i}`}>{c}</li>
                      ))}
                      {report.imagePlacementPatterns.map((p, i) => (
                        <li key={`img_${i}`}>{p}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-2">
                    <div className="text-xs font-semibold text-[#ECEAE4]">
                      Recommended Master Pages
                    </div>
                    <div className="space-y-2">
                      {report.masterPageRecommendations.map((m, i) => (
                        <div key={`mr_${i}`} className="text-xs">
                          <div className="text-[#ECEAE4] font-medium">{m.name}</div>
                          <div className="text-[11px] text-[#98958D]">{m.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-[#141417] flex items-center justify-between">
          {step === 'upload' ? (
            <>
              <span className="text-xs text-[#8F8C84]">
                Step 1 of 2 · Analysis runs server-side before creating any pages
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs text-[#A19E95] hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRunAnalysis}
                  disabled={analyzing}
                  className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-50 text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
                >
                  {analyzing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{analyzing ? 'Analyzing Template System...' : 'Analyze Design Template'}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep('upload')}
                className="px-3 py-2 text-xs text-[#A19E95] hover:text-white cursor-pointer"
              >
                ← Back to Upload
              </button>
              <button
                onClick={handleApproveAndCreateBook}
                className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Approve Design System & Create Editable Book</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
