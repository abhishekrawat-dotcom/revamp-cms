// Where the Books editor keeps its work: EventSphere's server (functions/lib/api-books.js), never the browser alone
// and never a file on a server's disk. Each book is saved whole, with the revision it was based on, so a save made
// over somebody else's newer one is refused (409 'stale') instead of silently overwriting it. For each book this tab
// also keeps the last copy known to match the server (its base): when a save is refused as stale, the editor puts
// this tab's changes and the newer saved book together from that base (services/bookRules.ts mergeBooks).
import type {
  BookProject,
  BookSummary,
  ContentSection,
  CustomSavedTemplate,
  ImageAsset,
  ProjectVersion,
  UserFontCollection,
} from '../types/bookstudio';
import { apiGet, apiSend, apiUpload, pdfText } from './api';

/** the revision of each book as this tab last loaded or saved it */
const REVS = new Map<string, number>();
/** each book as the server holds it at that revision: set on load, and on each save to what was sent */
const BASES = new Map<string, BookProject>();

export function knownRevision(bookId: string): number | null {
  return REVS.has(bookId) ? (REVS.get(bookId) as number) : null;
}

/** The last copy of a book known to match the server (null when this tab has never loaded or saved it). */
export function knownBase(bookId: string): BookProject | null {
  return BASES.get(bookId) || null;
}

function remember(book: BookProject, rev: number): void {
  REVS.set(book.id, rev);
  BASES.set(book.id, structuredClone(book));
}

/** What this person may do in Books: a Designer does everything, a Content editor everything except the design. */
export interface BooksMe {
  role: 'designer' | 'content';
  email: string;
  canDesign: boolean;
}

/** GET /me. A person without Books gets ApiError code 'no-books' (its sentence is shown on the dashboard). */
export async function loadMe(): Promise<BooksMe> {
  const data = await apiGet<{ role?: string; email?: string; canDesign?: boolean }>('/me');
  const role = data.role === 'designer' ? 'designer' : 'content';
  // fails closed: only a person the server calls a Designer is offered the design
  const canDesign = typeof data.canDesign === 'boolean' ? data.canDesign && role === 'designer' : role === 'designer';
  return { role, email: String(data.email || ''), canDesign };
}

/** Every book the team has (not deleted), newest first: the dashboard's cards. */
export async function loadBookList(): Promise<BookSummary[]> {
  const data = await apiGet<{ books: BookSummary[] }>('/list');
  return Array.isArray(data.books) ? data.books : [];
}

/** One whole book, as the studio edits it. */
export async function loadBook(bookId: string): Promise<BookProject> {
  const data = await apiGet<{ book: BookProject; rev: number }>('/book?id=' + encodeURIComponent(bookId));
  remember(data.book, data.rev);
  return data.book;
}

/** The newest saved copy of a book (it becomes the base), and who saved it. */
export async function loadLatest(bookId: string): Promise<{ book: BookProject; updatedBy: string }> {
  const data = await apiGet<{ book: BookProject; rev: number; updatedBy?: string }>('/book?id=' + encodeURIComponent(bookId));
  remember(data.book, data.rev);
  return { book: data.book, updatedBy: String(data.updatedBy || '') };
}

/* One save at a time per book from this tab (an autosave and a manual save at once would otherwise race each other
   and the second would be refused as stale): a save asked for while one is running waits, and only the newest of the
   ones waiting is sent. */
const inflight = new Map<string, Promise<void>>();
const waiting = new Map<string, BookProject>();

async function putBook(project: BookProject): Promise<void> {
  const baseRev = knownRevision(project.id);
  const data = await apiSend<{ rev: number }>('PUT', '/book', { book: project, baseRev });
  remember(project, data.rev);
}

/** The save of this book still on its way, if any (it resolves or fails like the save itself). */
export function pendingSave(bookId: string): Promise<void> | null {
  return inflight.get(bookId) || null;
}

export function saveProject(project: BookProject): Promise<void> {
  const id = project.id;
  waiting.set(id, project);
  const running = inflight.get(id);
  if (running) return running;
  const run = (async () => {
    try {
      while (waiting.has(id)) {
        const next = waiting.get(id) as BookProject;
        waiting.delete(id);
        await putBook(next);
      }
    } catch (err) {
      waiting.delete(id);
      throw err;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, run);
  return run;
}

/** A new book: saved with no revision, so the server creates it (and refuses an id that is taken). */
export async function createBook(project: BookProject): Promise<void> {
  REVS.delete(project.id);
  BASES.delete(project.id);
  await saveProject(project);
}

export async function setBookStatus(bookId: string, status: BookProject['status']): Promise<void> {
  const data = await apiSend<{ rev: number }>('POST', '/status', { id: bookId, status });
  if (REVS.has(bookId)) REVS.set(bookId, data.rev);
  const base = BASES.get(bookId);
  if (base) BASES.set(bookId, { ...base, status });
}

export async function deleteProjectById(projectId: string): Promise<void> {
  await apiSend('DELETE', '/book?id=' + encodeURIComponent(projectId));
  REVS.delete(projectId);
  BASES.delete(projectId);
}

/** Who else has this book open (seen in the last 70 seconds), and on which page; sent every 30 s and on page change. */
export interface PresenceEntry {
  email: string;
  pageId: string;
  at: string;
}

export async function sendPresence(bookId: string, pageId: string): Promise<PresenceEntry[]> {
  const data = await apiSend<{ here?: PresenceEntry[] }>('POST', '/presence', { bookId, pageId });
  return Array.isArray(data.here) ? data.here.filter((h) => h && typeof h.email === 'string') : [];
}

/** A page someone deleted from the book, kept so it can be put back. */
export interface DeletedPage {
  pageId: string;
  label: string;
  position: number;
  deletedAt: string;
  deletedBy: string;
}

export async function loadDeletedPages(bookId: string): Promise<DeletedPage[]> {
  const data = await apiGet<{ pages?: DeletedPage[] }>('/trash?id=' + encodeURIComponent(bookId));
  return Array.isArray(data.pages) ? data.pages : [];
}

/** Puts a deleted page back, on the revision this tab knows; the answer is the whole book, which becomes the base. */
export async function restoreDeletedPage(bookId: string, pageId: string): Promise<BookProject> {
  const data = await apiSend<{ rev: number; book: BookProject }>('POST', '/restore-page', {
    bookId,
    pageId,
    baseRev: knownRevision(bookId),
  });
  remember(data.book, data.rev);
  return data.book;
}

/** What has happened to the book, newest first: who, when, and a sentence. */
export interface BookLogEntry {
  at: string;
  by: string;
  action: string;
  detail?: unknown;
  /** a run of saves by one person is one entry: when it began */
  firstAt?: string;
}

export async function loadBookLog(bookId: string): Promise<BookLogEntry[]> {
  const data = await apiGet<{ entries?: BookLogEntry[] }>('/log?id=' + encodeURIComponent(bookId));
  return Array.isArray(data.entries) ? data.entries : [];
}

/** The book's kept versions (without their contents: loadProjectVersion reads one). */
export async function loadProjectVersions(projectId: string): Promise<ProjectVersion[]> {
  const data = await apiGet<{ versions: ProjectVersion[] }>('/versions?id=' + encodeURIComponent(projectId));
  return Array.isArray(data.versions) ? data.versions : [];
}

export async function loadProjectVersion(projectId: string, versionId: string): Promise<ProjectVersion> {
  const data = await apiGet<{ version: ProjectVersion }>(
    '/version?id=' + encodeURIComponent(projectId) + '&versionId=' + encodeURIComponent(versionId)
  );
  return data.version;
}

export async function saveProjectVersion(version: ProjectVersion): Promise<ProjectVersion> {
  const data = await apiSend<{ version: ProjectVersion }>('POST', '/versions', { bookId: version.projectId, version });
  return data.version;
}

export async function loadCustomTemplates(): Promise<CustomSavedTemplate[]> {
  const data = await apiGet<{ templates: CustomSavedTemplate[] }>('/templates');
  return Array.isArray(data.templates) ? data.templates : [];
}

export async function saveCustomTemplate(template: CustomSavedTemplate): Promise<void> {
  await apiSend('PUT', '/template', { template });
}

export async function loadFontCollections(): Promise<UserFontCollection[]> {
  const data = await apiGet<{ collections: UserFontCollection[] }>('/font-collections');
  return Array.isArray(data.collections) ? data.collections : [];
}

export async function saveFontCollection(col: UserFontCollection): Promise<void> {
  await apiSend('PUT', '/font-collection', { collection: col });
}

/** One photo, kept on the server; the asset it answers points at the server's copies (display, print, thumbnail). */
export async function uploadImageAsset(file: File): Promise<ImageAsset> {
  const data = await apiUpload<{ asset: ImageAsset }>('/asset', file, file.name);
  return data.asset;
}

/** Several photos, one after another; a photo that fails is reported by name and the rest still go. */
export async function uploadImageAssets(
  files: FileList | File[],
  onProgress?: (done: number, total: number) => void
): Promise<{ assets: ImageAsset[]; failed: Array<{ name: string; error: string }> }> {
  const list = Array.from(files);
  const assets: ImageAsset[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (let i = 0; i < list.length; i++) {
    try {
      assets.push(await uploadImageAsset(list[i]));
    } catch (err) {
      failed.push({ name: list[i].name, error: err instanceof Error ? err.message : 'Upload failed.' });
    }
    if (onProgress) onProgress(i + 1, list.length);
  }
  return { assets, failed };
}

export interface ManuscriptResult {
  filename: string;
  rawText: string;
  sections: ContentSection[];
  wordCount: number;
}

/** A manuscript: Word, RTF, CSV and text files are read on the server; a PDF is read in this browser first. */
export async function uploadManuscript(file: File): Promise<ManuscriptResult> {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (isPdf) {
    const text = await pdfText(file);
    if (!text.trim()) throw new Error('No text was found in this PDF. If it is scanned pages, it has no text to read.');
    return apiUpload<ManuscriptResult>('/manuscript', new Blob([text], { type: 'text/plain' }), file.name, { 'X-Source-Format': 'pdf-text' });
  }
  return apiUpload<ManuscriptResult>('/manuscript', file, file.name);
}

export interface IdmlResult {
  isNativeIndd: boolean;
  filename?: string;
  guidance?: string;
  idml?: {
    filename: string;
    widthMm: number;
    heightMm: number;
    facingPages: boolean;
    columns: number;
    columnGapMm: number | null;
    margins: { top: number; bottom: number; inner: number; outer: number } | null;
    spreadCount: number;
    pageCount: number;
    detectedFonts: string[];
    detectedColors: string[];
    archiveEntries: number;
  };
}

export async function parseIdmlFile(file: File): Promise<IdmlResult> {
  return apiUpload<IdmlResult>('/idml', file, file.name);
}
