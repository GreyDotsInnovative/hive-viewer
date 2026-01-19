'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RichTextEditor, type RichTextEditorHandle } from '../editors/RichTextEditor';
import { SpreadsheetEditor, type SpreadsheetEditorHandle } from '../editors/SpreadsheetEditor';
import { ImageRenderer } from '../renderers/ImageRenderer';
import { PdfRenderer } from '../renderers/PdfRenderer';
import { PptxRenderer } from '../renderers/PptxRenderer';
import type { DocumentMode, DocumentViewerProps, PageLayout, Signature, SupportedFileType } from '../types';
import { resolveSource } from '../utils/fileSource';
import { defaultLocale } from '../utils/locale';
import { SignaturePanel } from './SignaturePanel';
import { ThumbnailsSidebar, type Thumbnail } from './ThumbnailsSidebar';
import { Toolbar } from './Toolbar';

interface SigPlacement { page: number; x: number; y: number; w: number; h: number; signatureImageUrl: string }

type EditorHandle = (RichTextEditorHandle | SpreadsheetEditorHandle) & { save: (exportPdf?: boolean) => Promise<void> };

export function DocumentViewer(props: DocumentViewerProps) {
  const mode: DocumentMode = props.mode ?? 'view';
  const theme = props.theme ?? 'light';
  const locale = useMemo(() => ({ ...defaultLocale, ...(props.locale ?? {}) }), [props.locale]);

  const [layout, setLayout] = useState<PageLayout>(props.defaultLayout ?? 'single');
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [showSignatures, setShowSignatures] = useState(true);
  const [headerFooterEnabled, setHeaderFooterEnabled] = useState(true);

  const allowSigning = props.allowSigning ?? false;
  const [signingBusy, setSigningBusy] = useState(false);

  const [resolved, setResolved] = useState<{ fileType: SupportedFileType; fileName: string; url?: string; arrayBuffer?: ArrayBuffer } | null>(null);
  const [error, setError] = useState<string>('');
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [thumbs, setThumbs] = useState<Array<string | undefined>>([]);

  const [localSignatures, setLocalSignatures] = useState<Signature[]>(props.signatures ?? []);
  useEffect(() => setLocalSignatures(props.signatures ?? []), [props.signatures]);

  const [sigPlacements, setSigPlacements] = useState<SigPlacement[]>([]);
  const [armedSignatureUrl, setArmedSignatureUrl] = useState<string | null>(null);

  const editorRef = useRef<EditorHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError('');
      setResolved(null);
      setThumbs([]);
      setPageCount(1);
      setCurrentPage(1);
      setSigPlacements([]);
      setArmedSignatureUrl(null);

      if (mode === 'create') {
        const ft = (props.fileType ?? 'docx') as SupportedFileType;
        setResolved({ fileType: ft, fileName: props.fileName ?? `Untitled.${ft}` });
        return;
      }

      try {
        const res = await resolveSource({
          fileUrl: props.fileUrl,
          base64: props.base64,
          blob: props.blob,
          fileName: props.fileName,
          fileType: props.fileType,
        });
        if (cancelled) { return; }
        setResolved({ fileType: res.fileType, fileName: res.fileName, url: res.url, arrayBuffer: res.arrayBuffer });
      } catch (e) {
        if (cancelled) { return; }
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, props.fileUrl, props.base64, props.blob, props.fileName, props.fileType]);

  const thumbnails: Thumbnail[] = useMemo(() => {
    const n = Math.max(1, pageCount);
    return Array.from({ length: n }, (_, i) => ({
      id: `p-${i + 1}`,
      label: `${locale['thumbnails.page'] ?? 'Page'} ${i + 1}`,
      dataUrl: thumbs[i],
    }));
  }, [pageCount, thumbs, locale]);

  async function handleSignRequest() {
    if (!allowSigning || signingBusy || !props.onSignRequest) { return; }
    setSigningBusy(true);
    try {
      const sig = await props.onSignRequest();
      setLocalSignatures((prev: Signature[]) => [...prev, sig]);
      setArmedSignatureUrl(sig.signatureImageUrl);
    } finally {
      setSigningBusy(false);
    }
  }

  function placeSignature(p: { page: number; x: number; y: number; w: number; h: number }) {
    if (!armedSignatureUrl) { return; }
    setSigPlacements((prev: SigPlacement[]) => [...prev, { ...p, signatureImageUrl: armedSignatureUrl }]);
    setArmedSignatureUrl(null);
  }

  async function handleSave(exportPdf?: boolean) {
    if (editorRef.current) {
      await editorRef.current.save(!!exportPdf);
      return;
    }
    if (!resolved?.arrayBuffer) { return; }
    const b64 = arrayBufferToBase64(resolved.arrayBuffer);
    props.onSave?.(b64, { fileName: resolved.fileName, fileType: resolved.fileType, annotations: { sigPlacements } });
  }

  const canSave = mode === 'edit' || mode === 'create';
  const canExportPdf = (mode === 'edit' || mode === 'create') && (resolved?.fileType === 'docx' || resolved?.fileType === 'md' || resolved?.fileType === 'txt' || resolved?.fileType === 'xlsx');

  return (
    <div className={`hv-root`} data-hv-theme={theme}>
      <Toolbar
        locale={locale}
        mode={mode}
        fileType={resolved?.fileType}
        layout={layout}
        onChangeLayout={setLayout}
        showThumbnails={showThumbnails}
        onToggleThumbnails={() => setShowThumbnails((v: boolean) => !v)}
        showSignatures={showSignatures}
        onToggleSignatures={() => setShowSignatures((v: boolean) => !v)}
        onSign={() => void handleSignRequest()}
        allowSigning={allowSigning}
        signingDisabled={signingBusy || !props.onSignRequest}
        canSave={canSave}
        onSave={() => void handleSave(false)}
        canExportPdf={canExportPdf}
        onExportPdf={() => void handleSave(true)}
        headerFooterEnabled={headerFooterEnabled}
        showHeaderFooterToggle={(props.enableHeaderFooterToggle ?? true) && mode === 'create'}
        onToggleHeaderFooter={() => setHeaderFooterEnabled((v: boolean) => !v)}
      />

      {error ? (
        <div className="hv-error" role="alert">
          <div className="hv-error-title">{locale['error.title'] ?? 'Error'}</div>
          <div className="hv-error-body">{error}</div>
        </div>
      ) : null}

      {!resolved && !error ? <div className="hv-loading" aria-busy="true">{locale.loading ?? 'Loading…'}</div> : null}

      {resolved ? (
        <div className="hv-shell">
          {mode !== 'create' ? (
            <ThumbnailsSidebar
              locale={locale}
              thumbnails={thumbnails}
              currentPage={currentPage}
              collapsed={!showThumbnails}
              onToggle={() => setShowThumbnails((v: boolean) => !v)}
              onSelectPage={setCurrentPage}
            />
          ) : null}

          <main className="hv-main">
            {resolved.fileType === 'pdf' ? (
              <PdfRenderer
                url={resolved.url}
                arrayBuffer={resolved.arrayBuffer}
                layout={layout}
                currentPage={currentPage}
                onCurrentPageChange={setCurrentPage}
                onPageCount={(n) => {
                  setPageCount(n);
                  setThumbs((prev) => (prev.length === n ? prev : Array.from({ length: n }, (_, i) => prev[i])));
                }}
                onThumbs={(t) => setThumbs(t)}
                signatureStamp={armedSignatureUrl ? { imageUrl: armedSignatureUrl, armed: true, onPlaced: placeSignature } : undefined}
              />
            ) : null}

            {resolved.fileType === 'docx' || resolved.fileType === 'md' || resolved.fileType === 'txt' ? (
              <RichTextEditor
                ref={editorRef as any}
                mode={mode}
                fileType={resolved.fileType}
                fileName={resolved.fileName}
                arrayBuffer={resolved.arrayBuffer}
                headerComponent={props.headerComponent}
                footerComponent={props.footerComponent}
                headerFooterEnabled={headerFooterEnabled}
                locale={locale}
                signatures={localSignatures}
                signaturePlacements={sigPlacements}
                onPageCount={(n) => { setPageCount(n); setThumbs((prev) => (prev.length === n ? prev : Array.from({ length: n }, (_, i) => prev[i]))); }}
                onSave={(b64, meta) => props.onSave?.(b64, meta)}
                armedSignatureUrl={armedSignatureUrl}
                onPlaceSignature={placeSignature}
              />
            ) : null}

            {resolved.fileType === 'xlsx' ? (
              <SpreadsheetEditor
                ref={editorRef as any}
                mode={mode}
                fileName={resolved.fileName}
                arrayBuffer={resolved.arrayBuffer}
                locale={locale}
                onSave={(b64, meta) => props.onSave?.(b64, meta)}
              />
            ) : null}

            {resolved.fileType === 'pptx' ? (
              <PptxRenderer
                arrayBuffer={resolved.arrayBuffer}
                layout={layout}
                currentPage={currentPage}
                onCurrentPageChange={setCurrentPage}
                onSlideCount={(n) => {
                  setPageCount(n);
                  setThumbs((prev) => (prev.length === n ? prev : Array.from({ length: n }, (_, i) => prev[i])));
                }}
                onThumbs={(t) => setThumbs(t)}
              />
            ) : null}

            {resolved.fileType === 'png' || resolved.fileType === 'jpg' || resolved.fileType === 'svg' ? (
              <ImageRenderer arrayBuffer={resolved.arrayBuffer} fileType={resolved.fileType} fileName={resolved.fileName} />
            ) : null}
          </main>

          {mode !== 'create' && localSignatures.length ? (
            <SignaturePanel
              locale={locale}
              signatures={localSignatures}
              collapsed={!showSignatures}
              onToggle={() => setShowSignatures((v: boolean) => !v)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function arrayBufferToBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
