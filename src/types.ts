export interface Signature {
  id?: string; // Added for unique keying
  signatureImageUrl: string; // The Base64 image of the signature
  signedBy: string; // Name of the signer (e.g., "User")
  dateSigned: string; // ISO 8601 Date
  comment?: string;
}

export type PageLayout = "single" | "side-by-side";
export type DocumentMode = "view" | "edit" | "create";

export type SupportedFileType =
  | "pdf"
  | "md"
  | "docx"
  | "doc"
  | "rtf"
  | "jpeg"
  | "gif"
  | "bmp"
  | "xlsx"
  | "pptx"
  | "txt"
  | "png"
  | "jpg"
  | "svg"
  | "ppt"
  | "csv"
  | "xls"
  | "xml";

export interface DocumentViewerSaveMeta {
  fileName: string;
  fileType: SupportedFileType;
  exportedAsPdf?: boolean;
  annotations?: unknown;
}

export interface DocumentViewerProps {
  fileUrl?: string;
  base64?: string;
  blob?: Blob;
  fileName?: string;
  fileType?: SupportedFileType;

  mode?: DocumentMode;
  allowSigning?: boolean;
  disableSigning?: boolean; // New prop
  defaultLayout?: PageLayout;
  defaultShowThumbnails?: boolean; // New prop

  headerComponent?: React.ReactNode;
  footerComponent?: React.ReactNode;
  enableHeaderFooterToggle?: boolean;

  signatures?: Signature[];

  // Callbacks
  onSave?: (editedFileAsBase64: string, meta: DocumentViewerSaveMeta) => void;
  onSignRequest?: () => Promise<Signature>;

  // NEW: The missing prop that caused the error
  onSign?: (signature: Signature) => void;

  theme?: "light" | "dark";
  locale?: Record<string, string>;
}
