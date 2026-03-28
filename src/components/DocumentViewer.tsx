"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { RichTextEditor } from "../editors/RichTextEditor";
import { SpreadsheetEditor } from "../editors/SpreadsheetEditor";
import type {
  PptxExportState,
  RichTextExportState,
  SpreadsheetExportState,
} from "../internal/exportModels";
import { ImageRenderer } from "../renderers/ImageRenderer";
import { PdfRenderer } from "../renderers/PdfRenderer";
import { PptxRenderer } from "../renderers/PptxRenderer";
import type {
  AnnotationPlacement,
  AnnotationPlacementDraft,
  DocumentSurfaceOverlayState,
  DocumentMode,
  DocumentViewerProps,
  Signature,
  SignatureInkColor,
  SignaturePlacement,
  SupportedFileType,
} from "../types";
import {
  exportSignedImageFile,
  exportSignedPdfDocument,
  exportSignedRichTextFile,
  exportSignedSlidesFile,
  exportSignedSpreadsheetFile,
} from "../utils/export";
import { defaultLocale } from "../utils/locale";
import { guessFileType, resolveSource } from "../utils/fileSource";
import {
  normalizeSignature,
  normalizeSignaturePlacement,
  normalizeSignatureInkColor,
} from "../utils/signature";
import { SignaturePanel } from "./SignaturePanel";
import { ThumbnailsSidebar } from "./ThumbnailsSidebar";
import { Toolbar } from "./Toolbar";

function createPlacementId() {
  return `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAnnotationId() {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface FileModeCapabilities {
  canEdit: boolean;
  canCreate: boolean;
}

function getFileModeCapabilities(fileType: SupportedFileType): FileModeCapabilities {
  switch (fileType) {
    case "docx":
    case "doc":
    case "rtf":
    case "txt":
    case "md":
    case "xlsx":
    case "xls":
    case "csv":
      return { canEdit: true, canCreate: true };
    default:
      return { canEdit: false, canCreate: false };
  }
}

function getReadableFileTypeLabel(fileType: SupportedFileType) {
  switch (fileType) {
    case "pdf":
      return "PDF";
    case "docx":
      return "DOCX";
    case "doc":
      return "DOC";
    case "rtf":
      return "RTF";
    case "txt":
      return "TXT";
    case "md":
      return "Markdown";
    case "xlsx":
      return "XLSX";
    case "xls":
      return "XLS";
    case "csv":
      return "CSV";
    case "pptx":
      return "PPTX";
    case "ppt":
      return "PPT";
    case "jpg":
    case "jpeg":
      return "JPEG";
    case "png":
      return "PNG";
    case "gif":
      return "GIF";
    case "bmp":
      return "BMP";
    case "svg":
      return "SVG";
    case "xml":
      return "XML";
    default:
      return String(fileType).toUpperCase();
  }
}

function getReadableModeLabel(mode: Extract<DocumentMode, "edit" | "create">) {
  return mode === "edit" ? "Edit" : "Create";
}

function getFileNameHint(fileUrl?: string, fileName?: string) {
  if (fileName) {
    return fileName;
  }

  if (!fileUrl) {
    return undefined;
  }

  try {
    const url = new URL(fileUrl);
    const hintedName = decodeURIComponent(url.pathname.split("/").pop() || "");
    return hintedName || undefined;
  } catch {
    return undefined;
  }
}

export function DocumentViewer(props: DocumentViewerProps) {
  const mode: DocumentMode = props.mode ?? "view";
  const theme = props.theme ?? "light";
  const locale = useMemo(
    () => ({ ...defaultLocale, ...props.locale }),
    [props.locale],
  );

  const [layout, setLayout] = useState<"single" | "side-by-side">(
    props.defaultLayout ?? "single",
  );
  const [showThumbnails, setShowThumbnails] = useState(
    props.defaultShowThumbnails ?? true,
  );
  const [showHeaderFooterSlots, setShowHeaderFooterSlots] = useState(true);
  const [showSignatures, setShowSignatures] = useState(false);
  const [zoom, setZoom] = useState(1);
  const mainRef = useRef<HTMLElement>(null);
  const zoomStageRef = useRef<HTMLDivElement>(null);
  const exportHeaderRef = useRef<HTMLDivElement>(null);
  const exportFooterRef = useRef<HTMLDivElement>(null);
  const [selectedSignature, setSelectedSignature] = useState<Signature | null>(
    null,
  );
  const [selectedSignatureColor, setSelectedSignatureColor] =
    useState<SignatureInkColor>("black");
  const [isPlacingAnnotation, setIsPlacingAnnotation] = useState(false);
  const [activePlacementId, setActivePlacementId] = useState<string | null>(
    null,
  );
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(
    null,
  );

  const [resolved, setResolved] = useState<{
    fileType: SupportedFileType;
    fileName: string;
    url?: string;
    arrayBuffer?: ArrayBuffer;
    cleanup?: () => void;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [thumbnails, setThumbnails] = useState<Array<string | undefined>>([]);
  const [richTextExportState, setRichTextExportState] =
    useState<RichTextExportState | null>(null);
  const [spreadsheetExportState, setSpreadsheetExportState] = useState<
    SpreadsheetExportState | null
  >(null);
  const [pptxExportState, setPptxExportState] =
    useState<PptxExportState | null>(null);
  const [internalPlacements, setInternalPlacements] = useState<
    SignaturePlacement[]
  >(props.signaturePlacements ?? []);
  const [internalAnnotations, setInternalAnnotations] = useState<
    AnnotationPlacement[]
  >(props.annotations ?? []);
  const [zoomStageSize, setZoomStageSize] = useState({ width: 0, height: 0 });
  const [mainContentWidth, setMainContentWidth] = useState(0);

  const placements = useMemo(
    () =>
      (props.signaturePlacements ?? internalPlacements).map((placement) =>
        normalizeSignaturePlacement(placement),
      ),
    [internalPlacements, props.signaturePlacements],
  );
  const annotations = props.annotations ?? internalAnnotations;
  const availableSignatures = useMemo(
    () => (props.signatures ?? []).map((signature) => normalizeSignature(signature)),
    [props.signatures],
  );
  const sourceNameHint = getFileNameHint(props.fileUrl, props.fileName);
  const requestedFileType = guessFileType(
    sourceNameHint,
    props.fileType,
    props.blob?.type,
  );
  const fileModeCapabilities = getFileModeCapabilities(requestedFileType);
  const isRequestedEditUnsupported =
    mode === "edit" && !fileModeCapabilities.canEdit;
  const isRequestedCreateUnsupported =
    mode === "create" && !fileModeCapabilities.canCreate;
  const effectiveMode: DocumentMode =
    isRequestedEditUnsupported || isRequestedCreateUnsupported ? "view" : mode;
  const hasRenderableSource = Boolean(resolved?.arrayBuffer || resolved?.url);
  const showCreateUnsupportedNotice =
    mode === "create" && isRequestedCreateUnsupported;
  const showModeFallbackNotice =
    mode === "edit" && isRequestedEditUnsupported;
  const hasIncomingSource = Boolean(props.fileUrl || props.base64 || props.blob);
  const createSupportedFormats =
    "DOCX, DOC, RTF, TXT, Markdown, XLSX, XLS, and CSV";

  const signingEnabled =
    !props.disableSigning &&
    (props.allowSigning ??
      Boolean(props.onSignRequest || (props.signatures?.length ?? 0) > 0));
  const annotationEnabled =
    !props.disableAnnotations && (props.allowAnnotations ?? true);
  const hasLetterheadTemplate = Boolean(
    props.letterheadTemplate?.header || props.letterheadTemplate?.footer,
  );
  const hasHeaderFooterSlots = Boolean(
    props.headerComponent || props.footerComponent || hasLetterheadTemplate,
  );
  const headerFooterToggleEnabled = Boolean(
    props.enableHeaderFooterToggle && hasHeaderFooterSlots,
  );
  const hasReviewMarks = placements.length > 0 || annotations.length > 0;
  const saveAsPdfByDefault =
    (resolved?.fileType === "pdf") ||
    ((props.finalizeSignedDocumentsAsPdf ?? true) && hasReviewMarks);
  const isRichTextAuthoringMode = Boolean(
    resolved &&
      ["docx", "doc", "rtf", "txt", "md"].includes(resolved.fileType) &&
      effectiveMode !== "view",
  );
  const finalizedSignatures = useMemo(() => {
    const seen = new Set<string>();
    return placements.flatMap((placement) => {
      const signature = placement.signature;
      const dedupeKey =
        placement.signatureId ||
        `${signature.signatureImageUrl}:${signature.signedBy || ""}:${signature.jobTitle || ""}:${signature.dateSigned}`;

      if (seen.has(dedupeKey)) {
        return [];
      }

      seen.add(dedupeKey);
      return [signature];
    });
  }, [placements]);
  const signatureList = useMemo(
    () =>
      placements.map((placement) => ({
        placementId: placement.id,
        signatureId: placement.signatureId,
        signedBy: placement.signature.signedBy,
        jobTitle: placement.signature.jobTitle,
        dateSigned: placement.signature.dateSigned,
        signatureColor: placement.signatureColor,
        surfaceKind: placement.surfaceKind,
        page: placement.page,
        slide: placement.slide,
        sheetName: placement.sheetName,
      })),
    [placements],
  );

  useEffect(() => {
    if (props.signaturePlacements) {
      setInternalPlacements(props.signaturePlacements);
    }
  }, [props.signaturePlacements]);

  useEffect(() => {
    if (props.annotations) {
      setInternalAnnotations(props.annotations);
    }
  }, [props.annotations]);

  useEffect(() => {
    setShowThumbnails(props.defaultShowThumbnails ?? true);
  }, [props.defaultShowThumbnails]);

  useEffect(() => {
    setLayout(props.defaultLayout ?? "single");
  }, [props.defaultLayout]);

  useEffect(() => {
    if (!signingEnabled) {
      setShowSignatures(false);
      setSelectedSignature(null);
      setActivePlacementId(null);
    }
  }, [signingEnabled]);

  useEffect(() => {
    if (!annotationEnabled) {
      setIsPlacingAnnotation(false);
      setActiveAnnotationId(null);
    }
  }, [annotationEnabled]);

  useEffect(() => {
    if (!headerFooterToggleEnabled) {
      setShowHeaderFooterSlots(true);
    }
  }, [headerFooterToggleEnabled]);

  useEffect(() => {
    let active = true;
    let cleanupSource: (() => void) | undefined;

    const loadFile = async () => {
      setLoading(true);
      setError("");
      setResolved(null);

      try {
        if (mode === "create" && !isRequestedCreateUnsupported) {
          setResolved({
            fileType: requestedFileType,
            fileName: props.fileName ?? `Untitled.${requestedFileType}`,
          });
        } else if (mode === "create" && isRequestedCreateUnsupported && !hasIncomingSource) {
          setResolved({
            fileType: requestedFileType,
            fileName: props.fileName ?? `Untitled.${requestedFileType}`,
          });
        } else {
          const res = await resolveSource({
            fileUrl: props.fileUrl,
            base64: props.base64,
            blob: props.blob,
            fileName: props.fileName,
            fileType: props.fileType,
          });
          if (active) {
            cleanupSource = res.cleanup;
            setResolved(res);
          } else {
            res.cleanup?.();
          }
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || "Failed to load document");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadFile();
    return () => {
      active = false;
      cleanupSource?.();
    };
  }, [
    hasIncomingSource,
    isRequestedCreateUnsupported,
    mode,
    props.base64,
    props.blob,
    props.fileName,
    props.fileType,
    props.fileUrl,
    requestedFileType,
  ]);

  useEffect(() => {
    setZoom(1);
    setCurrentPage(1);
    setSelectedSignature(null);
    setSelectedSignatureColor("black");
    setIsPlacingAnnotation(false);
    setActivePlacementId(null);
    setActiveAnnotationId(null);
    setRichTextExportState(null);
    setSpreadsheetExportState(null);
    setPptxExportState(null);
    if (!props.signaturePlacements) {
      setInternalPlacements([]);
    }
    if (!props.annotations) {
      setInternalAnnotations([]);
    }
  }, [mode, props.fileUrl, props.fileName, props.fileType, props.blob, props.base64]);

  useEffect(() => {
    const element = zoomStageRef.current;
    if (!element) {
      return;
    }

    let frameId = 0;

    const measure = () => {
      frameId = 0;
      const nextWidth = Math.max(
        element.scrollWidth,
        element.offsetWidth,
        element.clientWidth,
        1,
      );
      const nextHeight = Math.max(
        element.scrollHeight,
        element.offsetHeight,
        element.clientHeight,
        1,
      );

      setZoomStageSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight },
      );
    };

    const scheduleMeasure = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(measure);
    };

    scheduleMeasure();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
      });
      resizeObserver.observe(element);
    }

    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [
    currentPage,
    error,
    isRichTextAuthoringMode,
    layout,
    loading,
    pageCount,
    resolved?.fileName,
    resolved?.fileType,
    showSignatures,
    showThumbnails,
  ]);

  useEffect(() => {
    const element = mainRef.current;
    if (!element) {
      return;
    }

    let frameId = 0;

    const measure = () => {
      frameId = 0;
      const nextWidth = Math.max(element.clientWidth, element.offsetWidth, 1);
      setMainContentWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };

    const scheduleMeasure = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(measure);
    };

    scheduleMeasure();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
      });
      resizeObserver.observe(element);
    }

    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, []);

  const zoomShellStyle = useMemo<React.CSSProperties>(
    () => {
      const baseWidth =
        isRichTextAuthoringMode && mainContentWidth > 0
          ? mainContentWidth
          : zoomStageSize.width;

      return {
        minWidth: "100%",
        width: baseWidth > 0 ? `${Math.round(baseWidth * zoom)}px` : "100%",
        minHeight:
          zoomStageSize.height > 0
            ? `${Math.round(zoomStageSize.height * zoom)}px`
            : undefined,
      };
    },
    [isRichTextAuthoringMode, mainContentWidth, zoom, zoomStageSize.height, zoomStageSize.width],
  );

  const zoomStageStyle = useMemo<React.CSSProperties>(
    () => {
      const baseWidth =
        isRichTextAuthoringMode && mainContentWidth > 0
          ? mainContentWidth
          : zoomStageSize.width;

      return {
        transform: `scale(${zoom})`,
        width: baseWidth > 0 ? `${baseWidth}px` : undefined,
        transformOrigin: isRichTextAuthoringMode ? "top left" : "top center",
      };
    },
    [isRichTextAuthoringMode, mainContentWidth, zoom, zoomStageSize.width],
  );

  const updatePlacements = (updater: SignaturePlacement[] | ((prev: SignaturePlacement[]) => SignaturePlacement[])) => {
    const next =
      typeof updater === "function" ? updater(placements) : updater;
    const normalizedNext = next.map((placement) =>
      normalizeSignaturePlacement(placement),
    );

    if (!props.signaturePlacements) {
      setInternalPlacements(normalizedNext);
    }

    props.onSignaturePlacementsChange?.(normalizedNext);
  };

  const updateAnnotations = (
    updater:
      | AnnotationPlacement[]
      | ((prev: AnnotationPlacement[]) => AnnotationPlacement[]),
  ) => {
    const next =
      typeof updater === "function" ? updater(annotations) : updater;

    if (!props.annotations) {
      setInternalAnnotations(next);
    }

    props.onAnnotationsChange?.(next);
  };

  const handleSignatureSelect = (signature: Signature) => {
    setSelectedSignature(normalizeSignature(signature));
    setSelectedSignatureColor("black");
    setIsPlacingAnnotation(false);
    setActivePlacementId(null);
    setActiveAnnotationId(null);
    props.onSign?.(normalizeSignature(signature));
  };

  const handlePlaceSignature = (placement: {
    signature: Signature;
    signatureColor?: SignatureInkColor;
    surfaceKey: string;
    surfaceKind: SignaturePlacement["surfaceKind"];
    page?: number;
    slide?: number;
    sheetName?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const nextPlacement: SignaturePlacement = normalizeSignaturePlacement({
      id: createPlacementId(),
      signatureId: placement.signature.id,
      signature: placement.signature,
      signatureColor: placement.signatureColor ?? selectedSignatureColor,
      surfaceKey: placement.surfaceKey,
      surfaceKind: placement.surfaceKind,
      page: placement.page,
      slide: placement.slide,
      sheetName: placement.sheetName,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    });

    updatePlacements((prev) => [...prev, nextPlacement]);
    setSelectedSignature(null);
    setSelectedSignatureColor("black");
    setActivePlacementId(null);
    setActiveAnnotationId(null);
  };

  const handlePlaceAnnotation = (annotation: AnnotationPlacementDraft) => {
    const nextAnnotation: AnnotationPlacement = {
      id: createAnnotationId(),
      ...annotation,
    };

    updateAnnotations((prev) => [...prev, nextAnnotation]);
    setIsPlacingAnnotation(false);
    setSelectedSignature(null);
    setActivePlacementId(null);
    setActiveAnnotationId(nextAnnotation.id);
  };

  const handleUpdatePlacement = (
    id: string,
    patch: Partial<
      Pick<SignaturePlacement, "x" | "y" | "width" | "height" | "signatureColor">
    >,
  ) => {
    updatePlacements((prev) =>
      prev.map((placement) =>
        placement.id === id
          ? normalizeSignaturePlacement({
              ...placement,
              ...patch,
              signatureColor: patch.signatureColor
                ? normalizeSignatureInkColor(patch.signatureColor)
                : placement.signatureColor,
            })
          : placement,
      ),
    );
  };

  const handleRemovePlacement = (id: string) => {
    updatePlacements((prev) => prev.filter((placement) => placement.id !== id));
    if (activePlacementId === id) {
      setActivePlacementId(null);
    }
  };

  const handleUpdateAnnotation = (
    id: string,
    patch: Partial<
      Pick<AnnotationPlacement, "x" | "y" | "width" | "height" | "text">
    >,
  ) => {
    updateAnnotations((prev) =>
      prev.map((annotation) =>
        annotation.id === id ? { ...annotation, ...patch } : annotation,
      ),
    );
  };

  const handleRemoveAnnotation = (id: string) => {
    updateAnnotations((prev) =>
      prev.filter((annotation) => annotation.id !== id),
    );
    if (activeAnnotationId === id) {
      setActiveAnnotationId(null);
    }
  };

  const signatureOverlayProps: DocumentSurfaceOverlayState = {
    placements,
    annotations,
    pendingSignature: selectedSignature,
    pendingAnnotation: isPlacingAnnotation,
    activePlacementId,
    activeAnnotationId,
    placeHint: locale["signatures.placeHint"],
    annotationHint: locale["annotations.placeHint"],
    annotationPlaceholder: locale["annotations.placeholder"],
    signatureAltLabel: locale["signatures.alt"],
    signatureAltByLabel: locale["signatures.altBy"],
    signatureNoteIndicatorLabel: locale["signatures.noteIndicator"],
    signatureColorLabel: locale["signatures.color"],
    signatureColorNames: {
      black: locale["signatures.color.black"],
      blue: locale["signatures.color.blue"],
      red: locale["signatures.color.red"],
      green: locale["signatures.color.green"],
    },
    removeSignatureLabel: locale["signatures.remove"],
    annotationTitle: locale["annotations.title"],
    linkedAnnotationTitle: locale["annotations.linkedTitle"],
    linkedAnnotationBadge: locale["annotations.linkedBadge"],
    openAnnotationLabel: locale["annotations.open"],
    removeAnnotationLabel: locale["annotations.remove"],
    onPlaceSignature: handlePlaceSignature,
    onPlaceAnnotation: handlePlaceAnnotation,
    onUpdatePlacement: handleUpdatePlacement,
    onUpdateAnnotation: handleUpdateAnnotation,
    onRemovePlacement: handleRemovePlacement,
    onRemoveAnnotation: handleRemoveAnnotation,
    onSelectPlacement: (id) => {
      setActivePlacementId(id);
      if (id) {
        setActiveAnnotationId(null);
      }
    },
    onSelectAnnotation: (id) => {
      setActiveAnnotationId(id);
      if (id) {
        setActivePlacementId(null);
      }
    },
  };

  const saveReady = useMemo(() => {
    if (!resolved) {
      return false;
    }

    if (showCreateUnsupportedNotice) {
      return false;
    }

    switch (resolved.fileType) {
      case "docx":
      case "doc":
      case "rtf":
      case "txt":
      case "md":
        return effectiveMode === "view"
          ? Boolean(
              (richTextExportState?.pages?.length ?? 0) > 0 ||
                richTextExportState?.container,
            )
          : Boolean(richTextExportState?.container);
      case "xlsx":
      case "xls":
      case "csv":
        return Boolean(spreadsheetExportState);
      case "pptx":
      case "ppt":
        return Boolean(pptxExportState);
      default:
        return true;
    }
  }, [
    effectiveMode,
    pptxExportState,
    resolved,
    richTextExportState,
    showCreateUnsupportedNotice,
    spreadsheetExportState,
  ]);

  const saveEnabled =
    Boolean(props.onSave) && Boolean(resolved) && !loading && saveReady;
  const exportLabels = useMemo(
    () => ({
      annotationTitle: locale["annotations.title"],
      linkedAnnotationTitle: locale["annotations.linkedTitle"],
      linkedAnnotationBadge: locale["annotations.linkedBadge"],
      annotationAltLabel: locale["annotations.title"],
      linkedAnnotationAltLabel: locale["annotations.linkedTitle"],
    }),
    [locale],
  );

  const emitSave = (
    base64: string,
    meta: {
      fileName: string;
      fileType: SupportedFileType;
      exportedAsPdf?: boolean;
    },
  ) => {
    props.onSave?.(base64, {
      fileName: meta.fileName,
      fileType: meta.fileType,
      exportedAsPdf: meta.exportedAsPdf ?? meta.fileType === "pdf",
      annotations,
      signaturePlacements: placements,
      signatures: finalizedSignatures,
      signatureList,
    });
  };

  const handleSaveAction = async (exportAsPdf: boolean) => {
    if (!resolved || !props.onSave || isSaving) {
      return;
    }

    setError("");
    setActivePlacementId(null);
    setActiveAnnotationId(null);
    setIsSaving(true);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    try {
      const saveAsPdf = exportAsPdf || saveAsPdfByDefault;
      const pageDecorations =
        showHeaderFooterSlots && hasHeaderFooterSlots
          ? {
              headerElement: exportHeaderRef.current,
              footerElement: exportFooterRef.current,
              letterheadTemplate: props.letterheadTemplate,
            }
          : undefined;

      switch (resolved.fileType) {
        case "pdf": {
          const exported = await exportSignedPdfDocument({
            arrayBuffer: resolved.arrayBuffer,
            url: resolved.url,
            fileName: resolved.fileName,
            placements,
            annotations,
            labels: exportLabels,
            pageDecorations,
          });
          emitSave(exported.base64, {
            fileName: exported.fileName,
            fileType: exported.fileType,
            exportedAsPdf: true,
          });
          break;
        }
        case "docx":
        case "doc":
        case "rtf":
        case "txt":
        case "md": {
          const exported = await exportSignedRichTextFile({
            container: richTextExportState?.container ?? null,
            pages: richTextExportState?.pages,
            fileName: resolved.fileName,
            placements,
            annotations,
            asPdf: saveAsPdf,
            labels: exportLabels,
            pageDecorations,
          });
          emitSave(exported.base64, {
            fileName: exported.fileName,
            fileType: exported.fileType,
            exportedAsPdf: saveAsPdf,
          });
          break;
        }
        case "xlsx":
        case "xls":
        case "csv": {
          const exported = await exportSignedSpreadsheetFile({
            exportState: spreadsheetExportState,
            fileName: resolved.fileName,
            placements,
            annotations,
            asPdf: saveAsPdf,
            labels: exportLabels,
            pageDecorations,
          });
          emitSave(exported.base64, {
            fileName: exported.fileName,
            fileType: exported.fileType,
            exportedAsPdf: saveAsPdf,
          });
          break;
        }
        case "pptx":
        case "ppt": {
          const exported = await exportSignedSlidesFile({
            exportState: pptxExportState,
            fileName: resolved.fileName,
            placements,
            annotations,
            asPdf: saveAsPdf,
            labels: exportLabels,
            pageDecorations,
          });
          emitSave(exported.base64, {
            fileName: exported.fileName,
            fileType: exported.fileType,
            exportedAsPdf: saveAsPdf,
          });
          break;
        }
        case "jpg":
        case "jpeg":
        case "png":
        case "gif":
        case "bmp":
        case "svg": {
          if (!resolved.arrayBuffer) {
            throw new Error("The image source is not ready for export.");
          }

          const exported = await exportSignedImageFile({
            arrayBuffer: resolved.arrayBuffer,
            fileType: resolved.fileType,
            fileName: resolved.fileName,
            placements,
            annotations,
            asPdf: saveAsPdf,
            labels: exportLabels,
            pageDecorations,
          });
          emitSave(exported.base64, {
            fileName: exported.fileName,
            fileType: exported.fileType,
            exportedAsPdf: saveAsPdf,
          });
          break;
        }
        default:
          throw new Error(`Saving is not available for ${resolved.fileType}.`);
      }
    } catch (err: any) {
      console.error("Save/export failed", err);
      setError(err?.message || "Failed to save the document");
    } finally {
      setIsSaving(false);
    }
  };

  const renderContent = () => {
    if (error) {
      return (
        <div className="hv-error-banner">
          <strong>{locale["error.title"]}</strong>
          <p>{error}</p>
        </div>
      );
    }

    if (loading || !resolved) {
      return (
        <div className="hv-loader">
          <div className="hv-spinner" />
          <span>{locale.loading}</span>
        </div>
      );
    }

    const renderCapabilityNotice = (
      title: string,
      description: string,
      variant: "info" | "warning" = "info",
    ) => (
      <div className={`hv-info-banner${variant === "warning" ? " warning" : ""}`}>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    );

    const shouldShowModeAdjustedNotice =
      showModeFallbackNotice || (showCreateUnsupportedNotice && hasRenderableSource);
    const modeAdjustedNotice = shouldShowModeAdjustedNotice
      ? renderCapabilityNotice(
          locale["documents.modeFallbackTitle"],
          locale["documents.modeFallbackDescription"]
            .replace(
              "{mode}",
              getReadableModeLabel(showModeFallbackNotice ? "edit" : "create"),
            )
            .replace("{fileType}", getReadableFileTypeLabel(resolved.fileType)),
        )
      : null;

    if (showCreateUnsupportedNotice && !hasRenderableSource) {
      return (
        <div className="hv-page-container" style={{ padding: "32px" }}>
          {renderCapabilityNotice(
            locale["documents.createUnsupportedTitle"],
            locale["documents.createUnsupportedDescription"].replace(
              "{formats}",
              createSupportedFormats,
            ),
            "warning",
          )}
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
      signatureOverlay: signatureOverlayProps,
      locale,
    };

    switch (resolved.fileType) {
      case "pdf":
        return (
          <>
            {modeAdjustedNotice}
            <PdfRenderer
              url={resolved.url}
              workerSrc={props.pdfWorkerSrc}
              {...commonProps}
            />
          </>
        );
      case "docx":
      case "doc":
      case "rtf":
      case "txt":
      case "md":
        return (
          <>
            {modeAdjustedNotice}
            <RichTextEditor
              mode={effectiveMode}
              onExportStateChange={setRichTextExportState}
              {...commonProps}
            />
          </>
        );
      case "xlsx":
      case "csv":
      case "xls":
        return (
          <>
            {modeAdjustedNotice}
            <SpreadsheetEditor
              mode={effectiveMode}
              onExportStateChange={setSpreadsheetExportState}
              {...commonProps}
            />
          </>
        );
      case "pptx":
      case "ppt":
        return (
          <>
            {modeAdjustedNotice}
            <PptxRenderer
              onExportStateChange={setPptxExportState}
              {...commonProps}
            />
          </>
        );
      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "bmp":
      case "svg":
        return (
          <>
            {modeAdjustedNotice}
            <ImageRenderer {...commonProps} fileType={resolved.fileType} />
          </>
        );
      default:
        return (
          <div className="hv-error-banner">
            {locale["documents.unsupportedFileType"]}: {resolved.fileType}
          </div>
        );
    }
  };

  return (
    <div className="hv-root" data-hv-theme={theme}>
      <Toolbar
        fileName={resolved?.fileName}
        pageCount={pageCount}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        showHeaderFooterToggle={headerFooterToggleEnabled}
        headerFooterVisible={showHeaderFooterSlots}
        onToggleHeaderFooter={() => setShowHeaderFooterSlots((prev) => !prev)}
        layout={layout}
        onLayoutChange={setLayout}
        showThumbnails={showThumbnails}
        onToggleThumbnails={() => setShowThumbnails((prev) => !prev)}
        showSignatures={showSignatures}
        onToggleSignatures={() => setShowSignatures((prev) => !prev)}
        signingEnabled={signingEnabled}
        annotationEnabled={annotationEnabled}
        annotationMode={isPlacingAnnotation}
        onToggleAnnotationMode={() => {
          if (!annotationEnabled) {
            return;
          }

          setIsPlacingAnnotation((prev) => {
            const next = !prev;
            if (next) {
              setSelectedSignature(null);
              setShowSignatures(false);
              setActivePlacementId(null);
              setActiveAnnotationId(null);
            }
            return next;
          });
        }}
        zoom={zoom}
        onZoomIn={() =>
          setZoom((prev) => Math.min(2, Number((prev + 0.1).toFixed(2))))
        }
        onZoomOut={() =>
          setZoom((prev) => Math.max(0.5, Number((prev - 0.1).toFixed(2))))
        }
        onZoomReset={() => setZoom(1)}
        saveEnabled={saveEnabled}
        isSaving={isSaving}
        onSave={() => void handleSaveAction(false)}
        onExportPdf={() => void handleSaveAction(true)}
        showExportPdfAction={!saveAsPdfByDefault}
        saveLabel={saveAsPdfByDefault ? locale["toolbar.finalizePdf"] : locale["toolbar.save"]}
        locale={locale}
      />

      {(props.headerComponent || props.footerComponent) && (
        <div className="hv-export-slot-host" aria-hidden="true">
          {props.headerComponent && (
            <div
              ref={exportHeaderRef}
              className="hv-export-slot hv-export-slot-header"
            >
              {props.headerComponent}
            </div>
          )}
          {props.footerComponent && (
            <div
              ref={exportFooterRef}
              className="hv-export-slot hv-export-slot-footer"
            >
              {props.footerComponent}
            </div>
          )}
        </div>
      )}

      <div className="hv-shell">
        <ThumbnailsSidebar
          isOpen={showThumbnails}
          thumbnails={thumbnails}
          currentPage={currentPage}
          onSelectPage={setCurrentPage}
          locale={locale}
        />

        <main
          ref={mainRef}
          className={`hv-main${isRichTextAuthoringMode ? " hv-main-richtext-authoring" : ""}`}
        >
          <div className="hv-zoom-shell" style={zoomShellStyle}>
            <div ref={zoomStageRef} className="hv-zoom-stage" style={zoomStageStyle}>
              {renderContent()}
            </div>
          </div>
        </main>

        {signingEnabled && (
          <SignaturePanel
            isOpen={showSignatures}
            onClose={() => setShowSignatures(false)}
            onSelectSignature={handleSignatureSelect}
            selectedSignature={selectedSignature}
            selectedColor={selectedSignatureColor}
            onSelectedColorChange={setSelectedSignatureColor}
            onClearSelection={() => {
              setSelectedSignature(null);
              setSelectedSignatureColor("black");
            }}
            externalSignatures={availableSignatures}
            onSignRequest={props.onSignRequest}
            locale={locale}
          />
        )}
      </div>

    </div>
  );
}
