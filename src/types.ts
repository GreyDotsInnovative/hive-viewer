export interface Signature {
  id?: string; // Added for unique keying
  signatureImageUrl: string; // The Base64 image of the signature
  signedBy?: string; // Optional name of the signer
  dateSigned: string; // ISO 8601 Date
  comment?: string;
}

export type SignatureSurfaceKind =
  | "document"
  | "page"
  | "slide"
  | "sheet"
  | "image";

export type AnnotationSurfaceKind = SignatureSurfaceKind;

export interface SignaturePlacement {
  id: string;
  signatureId?: string;
  signature: Signature;
  surfaceKind: SignatureSurfaceKind;
  surfaceKey: string;
  page?: number;
  slide?: number;
  sheetName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationPlacement {
  id: string;
  surfaceKind: AnnotationSurfaceKind;
  surfaceKey: string;
  page?: number;
  slide?: number;
  sheetName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  linkedSignaturePlacementId?: string;
  linkedSignatureId?: string;
}

export type PlacementGeometryPatch = Partial<
  Pick<SignaturePlacement, "x" | "y" | "width" | "height">
>;

export type AnnotationPatch = Partial<
  Pick<AnnotationPlacement, "x" | "y" | "width" | "height" | "text">
>;

export interface SignaturePlacementDraft {
  signature: Signature;
  surfaceKind: SignatureSurfaceKind;
  surfaceKey: string;
  page?: number;
  slide?: number;
  sheetName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationPlacementDraft {
  surfaceKind: AnnotationSurfaceKind;
  surfaceKey: string;
  page?: number;
  slide?: number;
  sheetName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  linkedSignaturePlacementId?: string;
  linkedSignatureId?: string;
}

export interface DocumentSurfaceOverlayState {
  placements: SignaturePlacement[];
  annotations: AnnotationPlacement[];
  pendingSignature?: Signature | null;
  pendingAnnotation?: boolean;
  activePlacementId?: string | null;
  activeAnnotationId?: string | null;
  placeHint: string;
  annotationHint: string;
  annotationPlaceholder: string;
  signatureAltLabel: string;
  signatureAltByLabel: string;
  signatureNoteIndicatorLabel: string;
  removeSignatureLabel: string;
  annotationTitle: string;
  linkedAnnotationTitle: string;
  linkedAnnotationBadge: string;
  openAnnotationLabel: string;
  removeAnnotationLabel: string;
  onPlaceSignature: (placement: SignaturePlacementDraft) => void;
  onPlaceAnnotation: (annotation: AnnotationPlacementDraft) => void;
  onUpdatePlacement: (id: string, patch: PlacementGeometryPatch) => void;
  onUpdateAnnotation: (id: string, patch: AnnotationPatch) => void;
  onRemovePlacement: (id: string) => void;
  onRemoveAnnotation: (id: string) => void;
  onSelectPlacement: (id: string | null) => void;
  onSelectAnnotation: (id: string | null) => void;
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
  annotations?: AnnotationPlacement[];
  signaturePlacements?: SignaturePlacement[];
}

export interface DocumentViewerProps {
  fileUrl?: string;
  base64?: string;
  blob?: Blob;
  fileName?: string;
  fileType?: SupportedFileType;
  pdfWorkerSrc?: string;

  mode?: DocumentMode;
  allowSigning?: boolean;
  disableSigning?: boolean; // New prop
  allowAnnotations?: boolean;
  disableAnnotations?: boolean;
  defaultLayout?: PageLayout;
  defaultShowThumbnails?: boolean; // New prop

  headerComponent?: React.ReactNode;
  footerComponent?: React.ReactNode;
  enableHeaderFooterToggle?: boolean;

  signatures?: Signature[];
  signaturePlacements?: SignaturePlacement[];
  annotations?: AnnotationPlacement[];

  // Callbacks
  onSave?: (editedFileAsBase64: string, meta: DocumentViewerSaveMeta) => void;
  onSignRequest?: () => Promise<Signature>;
  onSignaturePlacementsChange?: (placements: SignaturePlacement[]) => void;
  onAnnotationsChange?: (annotations: AnnotationPlacement[]) => void;

  // NEW: The missing prop that caused the error
  onSign?: (signature: Signature) => void;

  theme?: "light" | "dark";
  locale?: Record<string, string>;
}
