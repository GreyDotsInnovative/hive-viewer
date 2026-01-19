export interface Signature {
  signatureImageUrl: string;
  signedBy: string;
  dateSigned: string; // ISO 8601
  comment?: string;
}

export type PageLayout = 'single' | 'side-by-side';
export type DocumentMode = 'view' | 'edit' | 'create';

export type SupportedFileType = 'pdf' | 'md' | 'docx' | 'xlsx' | 'pptx' | 'txt' | 'png' | 'jpg' | 'svg';

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
  defaultLayout?: PageLayout;

  headerComponent?: React.ReactNode;
  footerComponent?: React.ReactNode;
  enableHeaderFooterToggle?: boolean;

  signatures?: Signature[];
  onSave?: (editedFileAsBase64: string, meta: DocumentViewerSaveMeta) => void;
  onSignRequest?: () => Promise<Signature>;

  theme?: 'light' | 'dark';
  locale?: Record<string, string>;
}
