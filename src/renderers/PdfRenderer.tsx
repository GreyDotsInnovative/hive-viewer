"use client";

import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { SignatureOverlay } from "../components/SignatureOverlay";
import type { DocumentSurfaceOverlayState, PageLayout } from "../types";

let pdfWorkerBlobUrlPromise: Promise<string> | null = null;

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function resolvePdfWorkerSrc(customWorkerSrc?: string) {
  if (customWorkerSrc) {
    return customWorkerSrc;
  }

  if (!pdfWorkerBlobUrlPromise) {
    pdfWorkerBlobUrlPromise = import("../../generated/pdfWorkerBundle")
      .then(({ pdfWorkerBundleSource }) =>
        URL.createObjectURL(
          new Blob([pdfWorkerBundleSource], { type: "text/javascript" }),
        ),
      )
      .catch((error) => {
        pdfWorkerBlobUrlPromise = null;
        throw error;
      });
  }

  return pdfWorkerBlobUrlPromise;
}

interface PdfRendererProps {
  url?: string;
  arrayBuffer?: ArrayBuffer;
  workerSrc?: string;
  locale: Record<string, string>;
  layout: PageLayout;
  currentPage: number;
  onPageCount: (n: number) => void;
  onCurrentPageChange: (p: number) => void;
  onThumbs: (thumbs: Array<string | undefined>) => void;
  signatureOverlay: DocumentSurfaceOverlayState;
}

export function PdfRenderer(props: PdfRendererProps) {
  const { url, arrayBuffer, layout, currentPage, workerSrc } = props;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thumbnailJobRef = useRef(0);

  useEffect(() => {
    let active = true;
    const thumbnailJobId = thumbnailJobRef.current + 1;
    thumbnailJobRef.current = thumbnailJobId;

    const loadPdf = async () => {
      // If no source, do nothing
      if (!url && !arrayBuffer) return;

      setError(null);

      try {
        GlobalWorkerOptions.workerSrc = await resolvePdfWorkerSrc(workerSrc);

        // FIX 2: Clone the ArrayBuffer!
        // PDF.js transfers the buffer to the worker, which "detaches" (empties) the original.
        // We pass a slice (copy) so the original data in DocumentViewer remains valid.
        const dataSource = arrayBuffer
          ? { data: arrayBuffer.slice(0) }
          : { url: url! };

        const loadingTask = getDocument(dataSource);

        const pdf = await loadingTask.promise;

        if (active) {
          setDoc(pdf);
          props.onPageCount(pdf.numPages);
          void generateThumbnails(pdf, thumbnailJobId);
        }
      } catch (err: any) {
        // Quietly handle errors (e.g. password protected files)
        console.error("PDF Load Error:", err);
        if (active) setError(err.message || "Failed to load PDF");
      }
    };

    loadPdf();
    return () => {
      active = false;
      thumbnailJobRef.current += 1;
    };
  }, [url, arrayBuffer, workerSrc]); // Re-run if file changes

  const generateThumbnails = async (
    pdf: PDFDocumentProxy,
    thumbnailJobId: number,
  ) => {
    try {
      const thumbs: Array<string | undefined> = Array.from({
        length: pdf.numPages,
      });
      props.onThumbs([...thumbs]);

      for (let i = 1; i <= pdf.numPages; i++) {
        if (thumbnailJobRef.current !== thumbnailJobId) {
          return;
        }

        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (thumbnailJobRef.current !== thumbnailJobId) {
            return;
          }
          thumbs[i - 1] = canvas.toDataURL();
        }

        if (i === 1 || i === pdf.numPages || i % 4 === 0) {
          props.onThumbs([...thumbs]);
        }

        if (i % 4 === 0) {
          await yieldToBrowser();
        }
      }

      if (thumbnailJobRef.current === thumbnailJobId) {
        props.onThumbs([...thumbs]);
      }
    } catch (e) {
      /* ignore */
    }
  };

  const pagesToRender = useMemo(() => {
    if (!doc) return [];
    const p = Math.max(1, Math.min(currentPage, doc.numPages));
    if (layout === "side-by-side" && doc.numPages > 1) {
      if (p === 1) return [1];
      const left = p % 2 === 0 ? p : p - 1;
      return left + 1 <= doc.numPages ? [left, left + 1] : [left];
    }
    return [p];
  }, [doc, currentPage, layout]);

  if (error) {
    return (
      <div className="hv-page-container" style={{ padding: "32px" }}>
        <div className="hv-error-banner">
          <strong>{props.locale["documents.pdfLoadErrorTitle"]}</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`hv-doc-scroll ${layout === "side-by-side" ? "hv-view-double" : "hv-view-single"}`}
    >
      {pagesToRender.map((page) => (
        <PdfPage
          key={page}
          doc={doc}
          pageNum={page}
          signatureOverlay={props.signatureOverlay}
        />
      ))}
    </div>
  );
}

function PdfPage({
  doc,
  pageNum,
  signatureOverlay,
}: {
  doc: PDFDocumentProxy | null;
  pageNum: number;
  signatureOverlay: PdfRendererProps["signatureOverlay"];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let active = true;

    const render = async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (!active) return;

        const scale = 1.5; // High fidelity
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        canvas.style.width = `${viewport.width / scale}px`;
        canvas.style.height = `${viewport.height / scale}px`;

        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        console.error("Page render error:", e);
      }
    };
    render();
    return () => {
      active = false;
    };
  }, [doc, pageNum]);

  return (
    <div
      className="hv-page-container"
      style={{
        minHeight: "600px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <canvas ref={canvasRef} className="hv-pdf-canvas" />
      <SignatureOverlay
        surfaceKey={`page:${pageNum}`}
        surfaceKind="page"
        page={pageNum}
        placements={signatureOverlay.placements}
        annotations={signatureOverlay.annotations}
        pendingSignature={signatureOverlay.pendingSignature}
        pendingAnnotation={signatureOverlay.pendingAnnotation}
        activePlacementId={signatureOverlay.activePlacementId}
        activeAnnotationId={signatureOverlay.activeAnnotationId}
        placeHint={signatureOverlay.placeHint}
        annotationHint={signatureOverlay.annotationHint}
        annotationPlaceholder={signatureOverlay.annotationPlaceholder}
        signatureAltLabel={signatureOverlay.signatureAltLabel}
        signatureAltByLabel={signatureOverlay.signatureAltByLabel}
        signatureNoteIndicatorLabel={signatureOverlay.signatureNoteIndicatorLabel}
        signatureColorLabel={signatureOverlay.signatureColorLabel}
        signatureColorNames={signatureOverlay.signatureColorNames}
        removeSignatureLabel={signatureOverlay.removeSignatureLabel}
        annotationTitle={signatureOverlay.annotationTitle}
        linkedAnnotationTitle={signatureOverlay.linkedAnnotationTitle}
        linkedAnnotationBadge={signatureOverlay.linkedAnnotationBadge}
        openAnnotationLabel={signatureOverlay.openAnnotationLabel}
        removeAnnotationLabel={signatureOverlay.removeAnnotationLabel}
        onPlaceSignature={signatureOverlay.onPlaceSignature}
        onPlaceAnnotation={signatureOverlay.onPlaceAnnotation}
        onUpdatePlacement={signatureOverlay.onUpdatePlacement}
        onUpdateAnnotation={signatureOverlay.onUpdateAnnotation}
        onRemovePlacement={signatureOverlay.onRemovePlacement}
        onRemoveAnnotation={signatureOverlay.onRemoveAnnotation}
        onSelectPlacement={signatureOverlay.onSelectPlacement}
        onSelectAnnotation={signatureOverlay.onSelectAnnotation}
      />
    </div>
  );
}
