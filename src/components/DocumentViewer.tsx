"use client";

import React, { useEffect, useState } from "react";
import { RichTextEditor } from "../editors/RichTextEditor";
import { SpreadsheetEditor } from "../editors/SpreadsheetEditor";
import { ImageRenderer } from "../renderers/ImageRenderer";
import { PdfRenderer } from "../renderers/PdfRenderer";
import { PptxRenderer } from "../renderers/PptxRenderer";
import type {
  DocumentMode,
  DocumentViewerProps,
  SupportedFileType,
  Signature, // Import Signature from here
} from "../types";
import { resolveSource } from "../utils/fileSource";

// Components
import { ThumbnailsSidebar } from "./ThumbnailsSidebar";
import { Toolbar } from "./Toolbar";
import { SignaturePanel } from "./SignaturePanel";

export function DocumentViewer(props: DocumentViewerProps) {
  // --- State & Config ---
  const mode: DocumentMode = props.mode ?? "view";
  const theme = props.theme ?? "light";

  // Layout State
  const [layout, setLayout] = useState<"single" | "side-by-side">(
    props.defaultLayout ?? "single",
  );
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [showSignatures, setShowSignatures] = useState(false); // [2] New State for Right Sidebar

  // Data Loading State
  const [resolved, setResolved] = useState<{
    fileType: SupportedFileType;
    fileName: string;
    url?: string;
    arrayBuffer?: ArrayBuffer;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Viewer Context (Page Counts, etc)
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  // --- Effects ---

  // 1. Resolve File Source
  useEffect(() => {
    let active = true;

    const loadFile = async () => {
      setLoading(true);
      setError("");
      setResolved(null);

      try {
        if (mode === "create") {
          // Handle creation mode
          setResolved({
            fileType: (props.fileType ?? "docx") as SupportedFileType,
            fileName: props.fileName ?? "Untitled",
          });
        } else {
          // Handle view/edit mode
          const res = await resolveSource({
            fileUrl: props.fileUrl,
            base64: props.base64,
            blob: props.blob,
            fileName: props.fileName,
            fileType: props.fileType,
          });
          if (active) setResolved(res);
        }
      } catch (err: any) {
        if (active) setError(err.message || "Failed to load document");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadFile();
    return () => {
      active = false;
    };
  }, [props.fileUrl, props.base64, props.blob, mode]);

  // --- Signature Handler [3] ---
  const handleSignatureSelect = (sig: Signature) => {
    // Return value to user via prop if available
    if (props.onSign) {
      props.onSign(sig);
    }

    // Logic to place signature on document would go here
    console.log("Signature selected:", sig);

    // Optional: Auto-close sidebar after selection
    // setShowSignatures(false);
  };

  // --- Render Helpers ---

  const renderContent = () => {
    if (error) {
      return (
        <div className="hv-error-banner">
          <strong>Error loading document</strong>
          <p>{error}</p>
        </div>
      );
    }

    if (loading || !resolved) {
      return (
        <div className="hv-loader">
          <div className="hv-spinner" />
          <span>Loading Document...</span>
        </div>
      );
    }

    const commonProps = {
      arrayBuffer: resolved.arrayBuffer,
      fileName: resolved.fileName,
      fileType: resolved.fileType,
      layout,
      currentPage,
      onPageCount: setPageCount,
      onCurrentPageChange: setCurrentPage,
      onThumbs: setThumbnails,
    };

    switch (resolved.fileType) {
      case "pdf":
        return <PdfRenderer url={resolved.url} {...commonProps} />;

      case "docx":
      case "doc":
      case "rtf":
      case "txt":
      case "md":
        return <RichTextEditor mode={mode} {...commonProps} />;

      case "xlsx":
      case "csv":
      case "xls":
        return <SpreadsheetEditor mode={mode} {...commonProps} />;

      case "pptx":
      case "ppt":
        return <PptxRenderer {...commonProps} />;

      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "bmp":
      case "svg":
        return <ImageRenderer {...commonProps} fileType={resolved.fileType} />;

      default:
        return (
          <div className="hv-error-banner">
            Unsupported file type: {resolved.fileType}
          </div>
        );
    }
  };

  return (
    <div className="hv-root" data-hv-theme={theme}>
      {/* 1. Toolbar */}
      <Toolbar
        fileName={resolved?.fileName}
        pageCount={pageCount}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        layout={layout}
        onLayoutChange={setLayout}
        // Left Sidebar (Thumbnails)
        showThumbnails={showThumbnails}
        onToggleThumbnails={() => setShowThumbnails(!showThumbnails)}
        // Right Sidebar (Signatures) - [4] Replaced Download with Signature Toggle
        showSignatures={showSignatures}
        onToggleSignatures={() => setShowSignatures(!showSignatures)}
      />

      <div className="hv-shell">
        {/* 2. Left Sidebar (Thumbnails) */}
        <ThumbnailsSidebar
          isOpen={showThumbnails}
          thumbnails={thumbnails}
          currentPage={currentPage}
          onSelectPage={setCurrentPage}
        />

        {/* 3. Main Stage */}
        <main className="hv-main">{renderContent()}</main>

        {/* 4. Right Sidebar (Signatures) - [5] Added Component */}
        <SignaturePanel
          isOpen={showSignatures}
          onClose={() => setShowSignatures(false)}
          onSelectSignature={handleSignatureSelect}
        />
      </div>
    </div>
  );
}
