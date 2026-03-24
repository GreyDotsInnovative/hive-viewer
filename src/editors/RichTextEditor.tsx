"use client";

import html2canvas from "html2canvas";
import mammoth from "mammoth";
import React, { useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { SignatureOverlay } from "../components/SignatureOverlay";
import type {
  RichTextExportState,
  RichTextPageRenderModel,
} from "../internal/exportModels";
import type {
  DocumentSurfaceOverlayState,
  DocumentMode,
  SupportedFileType,
} from "../types";
import { sanitizeHtml } from "../utils/sanitize";

const DOC_PAGE_WIDTH = 816;
const DOC_PAGE_HEIGHT = 1056;
const PAGE_RENDER_SCALE = 2;
const PAGE_BREAK_MIN_FILL = 0.55;
const DOCX_PREVIEW_CLASS_NAME = "hv-docx-page";

interface RichTextEditorProps {
  mode: DocumentMode;
  arrayBuffer?: ArrayBuffer;
  fileName: string;
  fileType?: SupportedFileType;
  locale: Record<string, string>;
  layout: "single" | "side-by-side";
  currentPage: number;
  onPageCount: (n: number) => void;
  onCurrentPageChange: (p: number) => void;
  onThumbs: (thumbs: Array<string | undefined>) => void;
  onExportStateChange?: (state: RichTextExportState | null) => void;
  signatureOverlay: DocumentSurfaceOverlayState;
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function waitForContainerImages(container: HTMLElement) {
  const images = Array.from(container.querySelectorAll("img"));

  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

async function waitForRenderReady(container: HTMLElement) {
  await waitForContainerImages(container);

  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
    } catch {
      // Continue even if font loading information is unavailable.
    }
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function calculatePageBreakOffsets(container: HTMLElement, pageHeight: number) {
  const totalHeight = Math.max(container.scrollHeight, pageHeight);
  const blocks = Array.from(container.children)
    .flatMap((node) => (node instanceof HTMLElement ? [node] : []))
    .map((node) => ({
      top: node.offsetTop,
      bottom: node.offsetTop + node.offsetHeight,
    }))
    .filter((block) => block.bottom > block.top)
    .sort((left, right) => left.top - right.top);

  const offsets: number[] = [];
  let cursor = 0;

  while (cursor < totalHeight) {
    const target = cursor + pageHeight;

    if (target >= totalHeight) {
      offsets.push(totalHeight);
      break;
    }

    const candidate = blocks
      .filter(
        (block) =>
          block.bottom > cursor + pageHeight * PAGE_BREAK_MIN_FILL &&
          block.bottom <= target,
      )
      .map((block) => block.bottom)
      .pop();

    const nextOffset =
      candidate && candidate > cursor + pageHeight * 0.35 ? candidate : target;

    offsets.push(nextOffset);
    cursor = nextOffset;
  }

  return offsets.length > 0 ? offsets : [pageHeight];
}

function createThumbnailDataUrl(canvas: HTMLCanvasElement) {
  const thumbWidth = 160;
  const thumbScale = thumbWidth / canvas.width;
  const thumbCanvas = createCanvas(thumbWidth, canvas.height * thumbScale);
  const thumbCtx = thumbCanvas.getContext("2d");

  if (thumbCtx) {
    thumbCtx.fillStyle = "#ffffff";
    thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
    thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  }

  return thumbCanvas.toDataURL("image/png");
}

function buildPageModels(
  sourceCanvas: HTMLCanvasElement,
  breakOffsets: number[],
) {
  const scale = sourceCanvas.width / DOC_PAGE_WIDTH;
  const pageCanvasWidth = DOC_PAGE_WIDTH * scale;
  const pageCanvasHeight = DOC_PAGE_HEIGHT * scale;
  const pages: RichTextPageRenderModel[] = [];
  let previousOffset = 0;

  for (const [index, endOffset] of breakOffsets.entries()) {
    const sourceY = previousOffset * scale;
    const sourceHeight = Math.max((endOffset - previousOffset) * scale, 1);
    const pageCanvas = createCanvas(pageCanvasWidth, pageCanvasHeight);
    const pageCtx = pageCanvas.getContext("2d");

    if (!pageCtx) {
      previousOffset = endOffset;
      continue;
    }

    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageCtx.drawImage(
      sourceCanvas,
      0,
      sourceY,
      sourceCanvas.width,
      sourceHeight,
      0,
      0,
      pageCanvas.width,
      sourceHeight,
    );

    pages.push({
      pageNumber: index + 1,
      surfaceKey: `document-page:${index + 1}`,
      imageUrl: pageCanvas.toDataURL("image/png"),
      thumbnailUrl: createThumbnailDataUrl(pageCanvas),
      width: pageCanvas.width,
      height: pageCanvas.height,
    });
    previousOffset = endOffset;
  }

  if (pages.length === 0) {
    const blankCanvas = createCanvas(
      DOC_PAGE_WIDTH * PAGE_RENDER_SCALE,
      DOC_PAGE_HEIGHT * PAGE_RENDER_SCALE,
    );
    const blankCtx = blankCanvas.getContext("2d");
    if (blankCtx) {
      blankCtx.fillStyle = "#ffffff";
      blankCtx.fillRect(0, 0, blankCanvas.width, blankCanvas.height);
    }

    return [{
      pageNumber: 1,
      surfaceKey: "document-page:1",
      imageUrl: blankCanvas.toDataURL("image/png"),
      thumbnailUrl: blankCanvas.toDataURL("image/png"),
      width: blankCanvas.width,
      height: blankCanvas.height,
    }];
  }

  return pages;
}

async function captureDocxPageModel(
  pageElement: HTMLElement,
  pageNumber: number,
): Promise<RichTextPageRenderModel> {
  const originalBoxShadow = pageElement.style.boxShadow;
  const originalMargin = pageElement.style.margin;
  const originalTransform = pageElement.style.transform;
  const width = Math.max(
    Math.round(pageElement.scrollWidth),
    Math.round(pageElement.getBoundingClientRect().width),
    1,
  );
  const height = Math.max(
    Math.round(pageElement.scrollHeight),
    Math.round(pageElement.getBoundingClientRect().height),
    1,
  );

  pageElement.style.boxShadow = "none";
  pageElement.style.margin = "0";
  pageElement.style.transform = "none";

  try {
    const pageCanvas = await html2canvas(pageElement, {
      backgroundColor: "#ffffff",
      scale: PAGE_RENDER_SCALE,
      useCORS: true,
      logging: false,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      ignoreElements: (element) =>
        element instanceof HTMLElement &&
        element.closest(".hv-signature-overlay") !== null,
    });

    return {
      pageNumber,
      surfaceKey: `document-page:${pageNumber}`,
      imageUrl: pageCanvas.toDataURL("image/png"),
      thumbnailUrl: createThumbnailDataUrl(pageCanvas),
      width: pageCanvas.width,
      height: pageCanvas.height,
    };
  } finally {
    pageElement.style.boxShadow = originalBoxShadow;
    pageElement.style.margin = originalMargin;
    pageElement.style.transform = originalTransform;
  }
}

function getPagesToShow(
  totalPages: number,
  currentPage: number,
  layout: "single" | "side-by-side",
) {
  if (totalPages === 0) {
    return [];
  }

  const validPage = Math.max(1, Math.min(currentPage, totalPages));

  if (layout === "side-by-side" && totalPages > 1) {
    if (validPage === 1) {
      return [1];
    }

    const left = validPage % 2 === 0 ? validPage : validPage - 1;
    return [left, left + 1].filter((pageNumber) => pageNumber <= totalPages);
  }

  return [validPage];
}

export function RichTextEditor(props: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const docxPreviewRef = useRef<HTMLDivElement>(null);
  const [contentHtml, setContentHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [isPaginating, setIsPaginating] = useState(false);
  const [pages, setPages] = useState<RichTextPageRenderModel[]>([]);
  const [docxPages, setDocxPages] = useState<RichTextPageRenderModel[]>([]);
  const [isRenderingDocxPreview, setIsRenderingDocxPreview] = useState(false);
  const [docxPreviewFailed, setDocxPreviewFailed] = useState(false);

  const mdParser = useRef(new MarkdownIt({ html: true, linkify: true }));
  const isDocxFile =
    props.fileName.toLowerCase().endsWith(".docx") || props.fileType === "docx";
  const useDocxPreviewView =
    props.mode === "view" && isDocxFile && Boolean(props.arrayBuffer);

  useEffect(() => {
    const loadDoc = async () => {
      if (!props.arrayBuffer) {
        setContentHtml("");
        setPages([]);
        setDocxPages([]);
        props.onPageCount(1);
        props.onThumbs([]);
        return;
      }

      setLoading(true);

      try {
        if (isDocxFile) {
          const result = await mammoth.convertToHtml({
            arrayBuffer: props.arrayBuffer,
          });
          setContentHtml(sanitizeHtml(result.value));
        } else {
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(props.arrayBuffer);

          if (props.fileName.toLowerCase().endsWith(".md") || props.fileType === "md") {
            const html = mdParser.current.render(text);
            setContentHtml(sanitizeHtml(html));
          } else {
            setContentHtml(
              `<pre style="white-space: pre-wrap; font-family: monospace;">${escapeHtml(text)}</pre>`,
            );
          }
        }

        props.onPageCount(1);
      } catch (err) {
        console.error("Doc Conversion failed", err);
        setContentHtml(
          `<p style="color:red">${escapeHtml(props.locale["documents.richText.parseError"])}</p>`,
        );
      } finally {
        setLoading(false);
      }
    };

    void loadDoc();
  }, [isDocxFile, props.arrayBuffer, props.fileName, props.fileType, props.locale]);

  useEffect(() => {
    if (!useDocxPreviewView || !docxPreviewRef.current || !props.arrayBuffer) {
      setDocxPages([]);
      setDocxPreviewFailed(false);
      setIsRenderingDocxPreview(false);
      if (docxPreviewRef.current) {
        docxPreviewRef.current.innerHTML = "";
      }
      return;
    }

    let cancelled = false;

    const renderDocxPreview = async () => {
      const host = docxPreviewRef.current;
      const arrayBuffer = props.arrayBuffer;
      if (!host) {
        return;
      }

      setDocxPreviewFailed(false);
      setIsRenderingDocxPreview(true);
      setDocxPages([]);
      props.onThumbs([]);
      host.innerHTML = "";

      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled) {
          return;
        }

        if (!arrayBuffer) {
          return;
        }

        await renderAsync(arrayBuffer.slice(0), host, undefined, {
          className: DOCX_PREVIEW_CLASS_NAME,
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          useBase64URL: true,
        });

        await waitForRenderReady(host);

        if (cancelled) {
          return;
        }

        const pageElements = Array.from(
          host.querySelectorAll<HTMLElement>(`section.${DOCX_PREVIEW_CLASS_NAME}`),
        );

        if (pageElements.length === 0) {
          throw new Error("No DOCX pages were rendered.");
        }

        const nextPageModels: RichTextPageRenderModel[] = [];

        for (const [index, pageElement] of pageElements.entries()) {
          nextPageModels.push(
            await captureDocxPageModel(
              pageElement,
              index + 1,
            ),
          );

          if ((index + 1) % 3 === 0) {
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => resolve());
            });
          }
        }

        if (cancelled) {
          return;
        }

        setDocxPages(nextPageModels);
        props.onPageCount(nextPageModels.length);
        props.onThumbs(
          nextPageModels.map((page) => page.thumbnailUrl || page.imageUrl),
        );

        if (props.currentPage > nextPageModels.length) {
          props.onCurrentPageChange(1);
        }
      } catch (error) {
        console.error("DOCX preview rendering failed", error);
        if (!cancelled) {
          setDocxPreviewFailed(true);
          setDocxPages([]);
          props.onPageCount(1);
          props.onThumbs([]);
        }
      } finally {
        if (!cancelled) {
          setIsRenderingDocxPreview(false);
        }
      }
    };

    void renderDocxPreview();

    return () => {
      cancelled = true;
    };
  }, [
    props.arrayBuffer,
    props.onCurrentPageChange,
    props.onPageCount,
    props.onThumbs,
    useDocxPreviewView,
  ]);

  useEffect(() => {
    if (props.mode !== "view") {
      setPages([]);
      props.onPageCount(1);
      props.onThumbs([]);
      return;
    }

    if (useDocxPreviewView && !docxPreviewFailed) {
      setPages([]);
      return;
    }

    if (!contentHtml || !measureRef.current) {
      setPages([]);
      props.onPageCount(1);
      props.onThumbs([]);
      return;
    }

    let cancelled = false;

    const paginate = async () => {
      const measureElement = measureRef.current;
      if (!measureElement) {
        return;
      }

      setIsPaginating(true);
      props.onThumbs([]);

      try {
        await waitForRenderReady(measureElement);

        const totalHeight = Math.max(
          measureElement.scrollHeight,
          DOC_PAGE_HEIGHT,
        );
        const fullCanvas = await html2canvas(measureElement, {
          backgroundColor: "#ffffff",
          scale: PAGE_RENDER_SCALE,
          useCORS: true,
          logging: false,
          width: DOC_PAGE_WIDTH,
          height: totalHeight,
          windowWidth: DOC_PAGE_WIDTH,
          windowHeight: totalHeight,
        });
        const breakOffsets = calculatePageBreakOffsets(
          measureElement,
          DOC_PAGE_HEIGHT,
        );
        const nextPages = buildPageModels(fullCanvas, breakOffsets);

        if (cancelled) {
          return;
        }

        setPages(nextPages);
        props.onPageCount(nextPages.length);
        props.onThumbs(
          nextPages.map((page) => page.thumbnailUrl || page.imageUrl),
        );

        if (props.currentPage > nextPages.length) {
          props.onCurrentPageChange(1);
        }
      } catch (error) {
        console.error("Rich text pagination failed", error);
        if (!cancelled) {
          setPages([]);
          props.onPageCount(1);
          props.onThumbs([]);
        }
      } finally {
        if (!cancelled) {
          setIsPaginating(false);
        }
      }
    };

    void paginate();

    return () => {
      cancelled = true;
    };
  }, [
    contentHtml,
    docxPreviewFailed,
      props.mode,
      props.onCurrentPageChange,
      props.onPageCount,
    props.onThumbs,
    useDocxPreviewView,
  ]);

  const activeViewPages = useMemo(
    () =>
      props.mode === "view"
        ? useDocxPreviewView && !docxPreviewFailed
          ? docxPages
          : pages
        : undefined,
    [docxPages, docxPreviewFailed, pages, props.mode, useDocxPreviewView],
  );

  useEffect(() => {
    const container =
      props.mode === "view"
        ? useDocxPreviewView && !docxPreviewFailed
          ? docxPreviewRef.current
          : measureRef.current
        : editorRef.current;

    props.onExportStateChange?.({
      container,
      contentHtml,
      pages: activeViewPages,
    });
  }, [
    activeViewPages,
    contentHtml,
    docxPreviewFailed,
    props.mode,
    props.onExportStateChange,
    useDocxPreviewView,
  ]);

  useEffect(() => {
    return () => {
      props.onExportStateChange?.(null);
    };
  }, [props.onExportStateChange]);

  const pagesToShow = useMemo(
    () =>
      getPagesToShow(
        useDocxPreviewView && !docxPreviewFailed
          ? docxPages.length
          : pages.length,
        props.currentPage,
        props.layout,
      ),
    [
      docxPreviewFailed,
      docxPages.length,
      pages.length,
      props.currentPage,
      props.layout,
      useDocxPreviewView,
    ],
  );

  if (props.mode === "view" && useDocxPreviewView && !docxPreviewFailed) {
    return (
      <>
        <div className="hv-docx-preview-shell" aria-hidden="true">
          <div
            ref={docxPreviewRef}
            className="hv-docx-preview-host"
            aria-label="DOCX document pages"
          />
        </div>

        <div
          className={
            props.layout === "side-by-side" ? "hv-view-double" : "hv-view-single"
          }
        >
          {loading || isRenderingDocxPreview ? (
            <div className="hv-page-container hv-docx-page-surface">
              <div className="hv-loading-copy">
                {props.locale["documents.richText.renderingPages"]}
              </div>
            </div>
          ) : (
            pagesToShow.map((pageNumber) => {
              const page = docxPages[pageNumber - 1];
              if (!page) {
                return null;
              }

              return (
                <div
                  key={page.surfaceKey}
                  className="hv-page-container hv-docx-page-surface"
                >
                  <img
                    src={page.imageUrl}
                    alt={`Document page ${pageNumber}`}
                    className="hv-docx-page-image"
                  />
                  <SignatureOverlay
                    surfaceKey={page.surfaceKey}
                    surfaceKind="document"
                    page={pageNumber}
                    placements={props.signatureOverlay.placements}
                    annotations={props.signatureOverlay.annotations}
                    pendingSignature={props.signatureOverlay.pendingSignature}
                    pendingAnnotation={props.signatureOverlay.pendingAnnotation}
                    activePlacementId={props.signatureOverlay.activePlacementId}
                    activeAnnotationId={props.signatureOverlay.activeAnnotationId}
                    placeHint={props.signatureOverlay.placeHint}
                    annotationHint={props.signatureOverlay.annotationHint}
                    annotationPlaceholder={
                      props.signatureOverlay.annotationPlaceholder
                    }
                    signatureAltLabel={props.signatureOverlay.signatureAltLabel}
                    signatureAltByLabel={props.signatureOverlay.signatureAltByLabel}
                    signatureNoteIndicatorLabel={
                      props.signatureOverlay.signatureNoteIndicatorLabel
                    }
                    removeSignatureLabel={props.signatureOverlay.removeSignatureLabel}
                    annotationTitle={props.signatureOverlay.annotationTitle}
                    linkedAnnotationTitle={props.signatureOverlay.linkedAnnotationTitle}
                    linkedAnnotationBadge={props.signatureOverlay.linkedAnnotationBadge}
                    openAnnotationLabel={props.signatureOverlay.openAnnotationLabel}
                    removeAnnotationLabel={props.signatureOverlay.removeAnnotationLabel}
                    onPlaceSignature={props.signatureOverlay.onPlaceSignature}
                    onPlaceAnnotation={props.signatureOverlay.onPlaceAnnotation}
                    onUpdatePlacement={props.signatureOverlay.onUpdatePlacement}
                    onUpdateAnnotation={props.signatureOverlay.onUpdateAnnotation}
                    onRemovePlacement={props.signatureOverlay.onRemovePlacement}
                    onRemoveAnnotation={props.signatureOverlay.onRemoveAnnotation}
                    onSelectPlacement={props.signatureOverlay.onSelectPlacement}
                    onSelectAnnotation={props.signatureOverlay.onSelectAnnotation}
                  />
                </div>
              );
            })
          )}
        </div>
      </>
    );
  }

  if (props.mode === "view") {
    return (
      <>
        <div className="hv-docx-measure-shell" aria-hidden="true">
          <div
            ref={measureRef}
            className="hv-docx-content hv-docx-measure-content"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        </div>

        <div
          className={
            props.layout === "side-by-side" ? "hv-view-double" : "hv-view-single"
          }
        >
          {loading || isPaginating ? (
            <div className="hv-page-container hv-docx-page-surface">
              <div className="hv-loading-copy">
                {props.locale["documents.richText.renderingPages"]}
              </div>
            </div>
          ) : (
            pagesToShow.map((pageNumber) => {
              const page = pages[pageNumber - 1];
              if (!page) {
                return null;
              }

              return (
                <div
                  key={page.surfaceKey}
                  className="hv-page-container hv-docx-page-surface"
                >
                  <img
                    src={page.imageUrl}
                    alt={`Document page ${pageNumber}`}
                    className="hv-docx-page-image"
                  />
                  <SignatureOverlay
                    surfaceKey={page.surfaceKey}
                    surfaceKind="document"
                    page={pageNumber}
                    placements={props.signatureOverlay.placements}
                    annotations={props.signatureOverlay.annotations}
                    pendingSignature={props.signatureOverlay.pendingSignature}
                    pendingAnnotation={props.signatureOverlay.pendingAnnotation}
                    activePlacementId={props.signatureOverlay.activePlacementId}
                    activeAnnotationId={props.signatureOverlay.activeAnnotationId}
                    placeHint={props.signatureOverlay.placeHint}
                    annotationHint={props.signatureOverlay.annotationHint}
                    annotationPlaceholder={
                      props.signatureOverlay.annotationPlaceholder
                    }
                    signatureAltLabel={props.signatureOverlay.signatureAltLabel}
                    signatureAltByLabel={props.signatureOverlay.signatureAltByLabel}
                    signatureNoteIndicatorLabel={
                      props.signatureOverlay.signatureNoteIndicatorLabel
                    }
                    removeSignatureLabel={props.signatureOverlay.removeSignatureLabel}
                    annotationTitle={props.signatureOverlay.annotationTitle}
                    linkedAnnotationTitle={
                      props.signatureOverlay.linkedAnnotationTitle
                    }
                    linkedAnnotationBadge={props.signatureOverlay.linkedAnnotationBadge}
                    openAnnotationLabel={props.signatureOverlay.openAnnotationLabel}
                    removeAnnotationLabel={props.signatureOverlay.removeAnnotationLabel}
                    onPlaceSignature={props.signatureOverlay.onPlaceSignature}
                    onPlaceAnnotation={props.signatureOverlay.onPlaceAnnotation}
                    onUpdatePlacement={props.signatureOverlay.onUpdatePlacement}
                    onUpdateAnnotation={props.signatureOverlay.onUpdateAnnotation}
                    onRemovePlacement={props.signatureOverlay.onRemovePlacement}
                    onRemoveAnnotation={props.signatureOverlay.onRemoveAnnotation}
                    onSelectPlacement={props.signatureOverlay.onSelectPlacement}
                    onSelectAnnotation={props.signatureOverlay.onSelectAnnotation}
                  />
                </div>
              );
            })
          )}
        </div>
      </>
    );
  }

  return (
    <div className="hv-view-single">
      <div className="hv-page-container hv-docx-page-surface">
        {loading ? (
          <div className="hv-loading-copy">
            {props.locale["documents.richText.processingText"]}
          </div>
        ) : (
          <div
            ref={editorRef}
            className="hv-docx-content"
            contentEditable={props.mode === "edit" || props.mode === "create"}
            dangerouslySetInnerHTML={{ __html: contentHtml }}
            suppressContentEditableWarning
          />
        )}
        <SignatureOverlay
          surfaceKey="document:main"
          surfaceKind="document"
          placements={props.signatureOverlay.placements}
          annotations={props.signatureOverlay.annotations}
          pendingSignature={props.signatureOverlay.pendingSignature}
          pendingAnnotation={props.signatureOverlay.pendingAnnotation}
          activePlacementId={props.signatureOverlay.activePlacementId}
          activeAnnotationId={props.signatureOverlay.activeAnnotationId}
          placeHint={props.signatureOverlay.placeHint}
          annotationHint={props.signatureOverlay.annotationHint}
          annotationPlaceholder={props.signatureOverlay.annotationPlaceholder}
          signatureAltLabel={props.signatureOverlay.signatureAltLabel}
          signatureAltByLabel={props.signatureOverlay.signatureAltByLabel}
          signatureNoteIndicatorLabel={
            props.signatureOverlay.signatureNoteIndicatorLabel
          }
          removeSignatureLabel={props.signatureOverlay.removeSignatureLabel}
          annotationTitle={props.signatureOverlay.annotationTitle}
          linkedAnnotationTitle={props.signatureOverlay.linkedAnnotationTitle}
          linkedAnnotationBadge={props.signatureOverlay.linkedAnnotationBadge}
          openAnnotationLabel={props.signatureOverlay.openAnnotationLabel}
          removeAnnotationLabel={props.signatureOverlay.removeAnnotationLabel}
          onPlaceSignature={props.signatureOverlay.onPlaceSignature}
          onPlaceAnnotation={props.signatureOverlay.onPlaceAnnotation}
          onUpdatePlacement={props.signatureOverlay.onUpdatePlacement}
          onUpdateAnnotation={props.signatureOverlay.onUpdateAnnotation}
          onRemovePlacement={props.signatureOverlay.onRemovePlacement}
          onRemoveAnnotation={props.signatureOverlay.onRemoveAnnotation}
          onSelectPlacement={props.signatureOverlay.onSelectPlacement}
          onSelectAnnotation={props.signatureOverlay.onSelectAnnotation}
        />
      </div>
    </div>
  );
}
