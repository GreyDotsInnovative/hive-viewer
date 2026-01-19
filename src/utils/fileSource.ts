import type { SupportedFileType } from '../types';

/**
 * Guess the file type from a file name or explicit type.
 * @param name - The file name (optional)
 * @param explicit - Explicit file type (optional)
 * @returns SupportedFileType
 */
export function guessFileType(
  name?: string,
  explicit?: SupportedFileType,
): SupportedFileType {
  if (explicit) { return explicit; }
  const ext = (name?.split('.').pop() || '').toLowerCase();
  const allowed: SupportedFileType[] = [
    'pdf',
    'md',
    'docx',
    'xlsx',
    'pptx',
    'txt',
    'png',
    'jpg',
    'svg',
  ];
  return (allowed as string[]).includes(ext)
    ? (ext as SupportedFileType)
    : 'txt';
}

/**
 * Convert an ArrayBuffer to a base64 string.
 * @param buf - The ArrayBuffer to convert
 * @returns base64-encoded string
 */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Convert a base64 string to an ArrayBuffer.
 * @param b64 - The base64 string
 * @returns Promise<ArrayBuffer>
 */
export async function base64ToArrayBuffer(b64: string): Promise<ArrayBuffer> {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) { bytes[i] = bin.charCodeAt(i); }
  return bytes.buffer;
}

/**
 * Resolve a file source from a URL, base64, or Blob, with progress callback.
 * @param args - fileUrl, base64, or Blob, plus optional fileName, fileType, and onProgress
 * @returns Promise<{ fileType, fileName, arrayBuffer, url? }>
 */
export async function resolveSource(args: {
  fileUrl?: string;
  base64?: string;
  blob?: Blob;
  fileName?: string;
  fileType?: SupportedFileType;
  onProgress?: (loaded: number, total?: number) => void;
}): Promise<{
  fileType: SupportedFileType;
  fileName: string;
  arrayBuffer: ArrayBuffer;
  url?: string;
}> {
  const fileType = guessFileType(args.fileName, args.fileType);
  const fileName = args.fileName ?? `document.${fileType}`;

  if (args.blob) {
    const ab = await args.blob.arrayBuffer();
    const url = URL.createObjectURL(args.blob);
    return { fileType, fileName, arrayBuffer: ab, url };
  }

  if (args.base64) {
    const ab = await base64ToArrayBuffer(args.base64);
    return { fileType, fileName, arrayBuffer: ab };
  }

  if (!args.fileUrl) {
    throw new Error('No file source provided. Use fileUrl, blob, or base64.');
  }

  const res = await fetch(args.fileUrl);
  if (!res.ok) { throw new Error(`Failed to fetch file (${res.status})`); }

  const total = Number(res.headers.get('content-length') || '') || undefined;
  if (!res.body) {
    const ab = await res.arrayBuffer();
    args.onProgress?.(ab.byteLength, total);
    return { fileType, fileName, arrayBuffer: ab, url: args.fileUrl };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) { break; }
    if (value) {
      chunks.push(value);
      loaded += value.length;
      args.onProgress?.(loaded, total);
    }
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return { fileType, fileName, arrayBuffer: out.buffer, url: args.fileUrl };
}
