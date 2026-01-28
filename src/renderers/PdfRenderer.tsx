"use client";

import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PageLayout } from "../types";

// FIX 1: Updated version to match the error message (4.10.38)
const PDF_WORKER_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

interface PdfRendererProps {
  url?: string;
  arrayBuffer?: ArrayBuffer;
  layout: PageLayout;
  currentPage: number;
  onPageCount: (n: number) => void;
  onCurrentPageChange: (p: number) => void;
  onThumbs: (thumbs: string[]) => void;
}

export function PdfRenderer(props: PdfRendererProps) {
  const { url, arrayBuffer, layout, currentPage } = props;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Ensure worker is set up
    if (!GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    }

    let active = true;

    const loadPdf = async () => {
      // If no source, do nothing
      if (!url && !arrayBuffer) return;

      setError(null);

      try {
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
          generateThumbnails(pdf);
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
    };
  }, [url, arrayBuffer]); // Re-run if file changes

  const generateThumbnails = async (pdf: PDFDocumentProxy) => {
    try {
      const thumbs: string[] = [];
      const num = Math.min(pdf.numPages, 5);
      for (let i = 1; i <= num; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise;
          thumbs.push(canvas.toDataURL());
        }
      }
      props.onThumbs(thumbs);
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
      <div
        className="hv-page-container"
        style={{ padding: "32px", textAlign: "center", color: "#dc2626" }}
      >
        <strong>Error loading PDF</strong>
        <p className="text-sm mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div
      className={`hv-doc-scroll ${layout === "side-by-side" ? "hv-view-double" : "hv-view-single"}`}
    >
      {pagesToRender.map((page) => (
        <PdfPage key={page} doc={doc} pageNum={page} />
      ))}
    </div>
  );
}

function PdfPage({
  doc,
  pageNum,
}: {
  doc: PDFDocumentProxy | null;
  pageNum: number;
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
    </div>
  );
}
