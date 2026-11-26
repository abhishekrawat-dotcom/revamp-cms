// The one way the Books editor talks to EventSphere's server (functions/lib/api-books.js). Every call goes through
// the page's sign-in helper (auth.js, window.RevampAuth.authedFetch): a fresh token on each request, one retry on an
// expired one, and the "signed out" box when the session has ended. Errors come back as ApiError carrying the
// server's own sentence, ready to show.

interface RevampAuthApi {
  authedFetch(url: string, opts?: RequestInit): Promise<Response>;
  currentUser(): { email?: string | null; displayName?: string | null; photoURL?: string | null } | null;
  whenResolved(): Promise<void>;
  mountAccountMenu(el: HTMLElement): void;
}
declare global {
  interface Window {
    RevampAuth?: RevampAuthApi;
    RevampPdf?: {
      load(): Promise<unknown>;
      open(bytes: Uint8Array, extra?: Record<string, unknown>): Promise<PdfDocument>;
    };
  }
}
export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean; transform?: number[] }> }> }>;
  destroy?(): Promise<void>;
}

export interface SignedInUser {
  email: string;
  displayName: string;
  photoURL: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;
  constructor(message: string, status: number, code: string, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const BASE = '/api/books';
let activeBookId = '';

/** The book open in the studio: AI calls name it, so its AI use is counted against it. */
export function setActiveBookId(id: string): void {
  activeBookId = id || '';
}

function auth(): RevampAuthApi {
  if (!window.RevampAuth) throw new ApiError('Sign-in is not ready. Reload the page.', 0, 'no-auth', {});
  return window.RevampAuth;
}

export function currentUser(): SignedInUser | null {
  const u = window.RevampAuth?.currentUser();
  if (!u) return null;
  return { email: u.email || '', displayName: u.displayName || '', photoURL: u.photoURL || '' };
}

export function mountAccountMenu(el: HTMLElement | null): void {
  if (el && window.RevampAuth) window.RevampAuth.mountAccountMenu(el);
}

async function readAnswer(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!resp.ok) {
    const message =
      typeof data.error === 'string' && data.error
        ? data.error
        : resp.status === 413
          ? 'That is too large to send.'
          : 'Something went wrong on the server. Please try again.';
    throw new ApiError(message, resp.status, typeof data.code === 'string' ? data.code : '', data);
  }
  return data;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (activeBookId) headers.set('X-Book-Id', activeBookId);
  try {
    return await auth().authedFetch(BASE + path, { ...init, headers });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const e = err as { status?: number; code?: string };
    if (e && e.status === 401) throw new ApiError('You have been signed out. Sign in again to keep working.', 401, 'signed-out', {});
    throw new ApiError('The server could not be reached. Check your connection and try again.', 0, 'offline', {});
  }
}

export async function apiGet<T = Record<string, unknown>>(path: string): Promise<T> {
  return (await readAnswer(await send(path, { method: 'GET' }))) as T;
}

export async function apiSend<T = Record<string, unknown>>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return (await readAnswer(await send(path, init))) as T;
}

/** A file sent as it is (not as a form): the server reads its kind from its bytes and its name from X-File-Name. */
export async function apiUpload<T = Record<string, unknown>>(path: string, file: Blob, name: string, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
    'X-File-Name': encodeURIComponent(name),
    ...(extraHeaders || {}),
  };
  return (await readAnswer(await send(path, { method: 'POST', body: file, headers }))) as T;
}

/** The words of a PDF, read in this browser with EventSphere's PDF reader (pdf-reader.js), one paragraph per block. */
export async function pdfText(file: File): Promise<string> {
  if (!window.RevampPdf) throw new ApiError('The PDF reader is not loaded. Reload the page and try again.', 0, 'no-pdf', {});
  const doc = await window.RevampPdf.open(new Uint8Array(await file.arrayBuffer()));
  const pages: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      let lastY: number | null = null;
      for (const item of content.items) {
        const y = item.transform ? item.transform[5] : null;
        // a jump down the page larger than a line starts a new paragraph
        if (lastY !== null && y !== null && Math.abs(lastY - y) > 18) text += '\n\n';
        else if (lastY !== null && y !== null && Math.abs(lastY - y) > 1) text += '\n';
        text += item.str || '';
        if (item.hasEOL) text += '\n';
        if (y !== null) lastY = y;
      }
      pages.push(text);
    }
  } finally {
    if (doc.destroy) void doc.destroy();
  }
  return pages
    .join('\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/([^\n])\n(?!\n)/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A picture made small enough for ETB2B AI to look at (the long side at most maxPx), as base64 JPEG. */
export async function imageForAi(file: File, maxPx = 1600): Promise<{ mimeType: string; base64: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new ApiError('This picture could not be read. Save it as a JPG or PNG and try again.', 0, 'bad-image', {}));
      i.src = url;
    });
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = canvas.getContext('2d');
    if (!g) throw new ApiError('This browser cannot prepare the picture.', 0, 'no-canvas', {});
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return { mimeType: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
