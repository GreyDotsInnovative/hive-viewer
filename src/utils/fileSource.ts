import type { SupportedFileType } from "../types";

const extensionFileTypes: Record<string, SupportedFileType> = {
  pdf: "pdf",
  md: "md",
  docx: "docx",
  doc: "doc",
  rtf: "rtf",
  txt: "txt",
  jpeg: "jpeg",
  jpg: "jpg",
  png: "png",
  gif: "gif",
  bmp: "bmp",
  svg: "svg",
  xlsx: "xlsx",
  xls: "xls",
  csv: "csv",
  pptx: "pptx",
  ppt: "ppt",
  xml: "xml",
};

const mimeFileTypes: Record<string, SupportedFileType> = {
  "application/pdf": "pdf",
  "text/markdown": "md",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/xml": "xml",
  "application/xml": "xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "doc",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "image/jpeg": "jpeg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

function normalizeMimeType(mimeType?: string) {
  return mimeType?.split(";")[0]?.trim().toLowerCase();
}

function getFileNameFromUrl(fileUrl?: string) {
  if (!fileUrl) {
    return undefined;
  }

  try {
    const url = new URL(fileUrl);
    const name = decodeURIComponent(url.pathname.split("/").pop() || "");
    return name || undefined;
  } catch {
    return undefined;
  }
}

function getFileNameFromBlob(blob?: Blob) {
  if (!blob || typeof File === "undefined" || !(blob instanceof File)) {
    return undefined;
  }

  return blob.name || undefined;
}

/**
 * Guess the file type from a file name or explicit type.
 * @param name - The file name (optional)
 * @param explicit - Explicit file type (optional)
 * @returns SupportedFileType
 */
export function guessFileType(
  name?: string,
  explicit?: SupportedFileType,
  mimeType?: string,
): SupportedFileType {
  if (explicit) {
    return explicit;
  }

  const ext = (name?.split(".").pop() || "").toLowerCase();
  if (ext && extensionFileTypes[ext]) {
    return extensionFileTypes[ext];
  }

  const normalizedMimeType = normalizeMimeType(mimeType);
  if (normalizedMimeType && mimeFileTypes[normalizedMimeType]) {
    return mimeFileTypes[normalizedMimeType];
  }

  return "txt";
}

/**
 * Convert an ArrayBuffer to a base64 string.
 * @param buf - The ArrayBuffer to convert
 * @returns base64-encoded string
 */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
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
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
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
  cleanup?: () => void;
}> {
  const inputFileName =
    args.fileName ?? getFileNameFromBlob(args.blob) ?? getFileNameFromUrl(args.fileUrl);
  const fileType = guessFileType(inputFileName, args.fileType, args.blob?.type);
  const fileName = inputFileName ?? `document.${fileType}`;

  if (args.blob) {
    const ab = await args.blob.arrayBuffer();
    const url = URL.createObjectURL(args.blob);
    return {
      fileType,
      fileName,
      arrayBuffer: ab,
      url,
      cleanup: () => URL.revokeObjectURL(url),
    };
  }

  if (args.base64) {
    const ab = await base64ToArrayBuffer(args.base64);
    return { fileType, fileName, arrayBuffer: ab };
  }

  if (!args.fileUrl) {
    throw new Error("No file source provided. Use fileUrl, blob, or base64.");
  }

  const res = await fetch(args.fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch file (${res.status})`);
  }

  const resolvedFileType = guessFileType(
    inputFileName,
    args.fileType,
    res.headers.get("content-type") || undefined,
  );
  const resolvedFileName = inputFileName ?? `document.${resolvedFileType}`;

  const total = Number(res.headers.get("content-length") || "") || undefined;
  if (!res.body) {
    const ab = await res.arrayBuffer();
    args.onProgress?.(ab.byteLength, total);
    return {
      fileType: resolvedFileType,
      fileName: resolvedFileName,
      arrayBuffer: ab,
      url: args.fileUrl,
    };
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
  return {
    fileType: resolvedFileType,
    fileName: resolvedFileName,
    arrayBuffer: out.buffer,
    url: args.fileUrl,
  };
}
