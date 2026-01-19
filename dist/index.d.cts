import * as react_jsx_runtime from 'react/jsx-runtime';

interface Signature {
    signatureImageUrl: string;
    signedBy: string;
    dateSigned: string;
    comment?: string;
}
type PageLayout = 'single' | 'side-by-side';
type DocumentMode = 'view' | 'edit' | 'create';
type SupportedFileType = 'pdf' | 'md' | 'docx' | 'xlsx' | 'pptx' | 'txt' | 'png' | 'jpg' | 'svg';
interface DocumentViewerSaveMeta {
    fileName: string;
    fileType: SupportedFileType;
    exportedAsPdf?: boolean;
    annotations?: unknown;
}
interface DocumentViewerProps {
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

declare function DocumentViewer(props: DocumentViewerProps): react_jsx_runtime.JSX.Element;

export { type DocumentMode, DocumentViewer, type DocumentViewerProps, type DocumentViewerSaveMeta, type PageLayout, type Signature, type SupportedFileType };
