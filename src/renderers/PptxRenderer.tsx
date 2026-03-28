"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { SignatureOverlay } from "../components/SignatureOverlay";
import type {
  PptxExportState,
  PptxParagraphModel,
  PptxRunModel,
  PptxSlideElementModel,
  PptxSlideModel,
} from "../internal/exportModels";
import type {
  DocumentSurfaceOverlayState,
  PageLayout,
} from "../types";

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

interface PptxRendererProps {
  arrayBuffer?: ArrayBuffer;
  fileName?: string;
  locale: Record<string, string>;
  layout: PageLayout;
  currentPage: number;
  onCurrentPageChange: (p: number) => void;
  onPageCount: (n: number) => void;
  onThumbs: (thumbs: Array<string | undefined>) => void;
  onExportStateChange?: (state: PptxExportState | null) => void;
  signatureOverlay: DocumentSurfaceOverlayState;
}

const SLIDE_RENDER_BASE_WIDTH = 1280;
const SLIDE_RENDER_MAX_VIEW_WIDTH = 1080;
const SLIDE_RENDER_MIN_VIEW_WIDTH = 300;
const SLIDE_RENDER_GAP = 24;

function alignToClassName(align?: string) {
  if (align === "ctr") {
    return "align-ctr";
  }
  if (align === "r") {
    return "align-r";
  }
  return "align-l";
}

function isBrowserRenderableSlideImage(source: string) {
  return !/^data:image\/(?:emf|wmf|tiff)/i.test(source);
}

function PresentationImage(props: { src: string; alt: string }) {
  const [failed, setFailed] = useState(!isBrowserRenderableSlideImage(props.src));

  if (failed) {
    return <div className="hv-slide-image-fallback">{props.alt}</div>;
  }

  return (
    <img
      src={props.src}
      alt={props.alt}
      className="hv-slide-image"
      onError={() => setFailed(true)}
    />
  );
}

function parseColor(solidFill: Element | null): string | undefined {
  if (!solidFill) {
    return undefined;
  }

  const srgbClr = solidFill.getElementsByTagNameNS(NS_A, "srgbClr")[0];
  if (srgbClr) {
    const value = srgbClr.getAttribute("val");
    return value ? `#${value}` : undefined;
  }

  const schemeClr = solidFill.getElementsByTagNameNS(NS_A, "schemeClr")[0];
  if (schemeClr) {
    const value = schemeClr.getAttribute("val");
    const colorMap: Record<string, string> = {
      tx1: "#0f172a",
      bg1: "#ffffff",
      tx2: "#1e293b",
      accent1: "#2563eb",
      accent2: "#f97316",
      accent3: "#14b8a6",
      accent4: "#facc15",
      accent5: "#8b5cf6",
      accent6: "#22c55e",
    };
    return colorMap[value || ""] || "#0f172a";
  }

  return undefined;
}

function resolveZipPath(basePath: string, target: string) {
  const normalizedBase = basePath.split("/").filter(Boolean);
  normalizedBase.pop();

  for (const segment of target.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalizedBase.pop();
    } else {
      normalizedBase.push(segment);
    }
  }

  return normalizedBase.join("/");
}

function getMimeType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".bmp")) {
    return "image/bmp";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) {
    return "image/tiff";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".avif")) {
    return "image/avif";
  }
  if (lower.endsWith(".emf")) {
    return "image/emf";
  }
  if (lower.endsWith(".wmf")) {
    return "image/wmf";
  }
  return "application/octet-stream";
}

function parsePresentationSize(xml: string | undefined) {
  if (!xml) {
    return { width: 9144000, height: 5143500 };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const size = doc.getElementsByTagNameNS(NS_P, "sldSz")[0];

  return {
    width: Number(size?.getAttribute("cx") || "9144000"),
    height: Number(size?.getAttribute("cy") || "5143500"),
  };
}

function parseRelationships(xml: string | undefined, slidePath: string) {
  if (!xml) {
    return new Map<string, string>();
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const relationshipNodes = Array.from(doc.getElementsByTagName("Relationship"));
  const map = new Map<string, string>();

  for (const node of relationshipNodes) {
    const target = node.getAttribute("Target");
    const id = node.getAttribute("Id");
    const targetMode = node.getAttribute("TargetMode");

    if (!target || !id || targetMode === "External") {
      continue;
    }

    map.set(id, resolveZipPath(slidePath, target));
  }

  return map;
}

function parseTransform(element: Element | null) {
  const xfrm = element?.getElementsByTagNameNS(NS_A, "xfrm")[0];
  const off = xfrm?.getElementsByTagNameNS(NS_A, "off")[0];
  const ext = xfrm?.getElementsByTagNameNS(NS_A, "ext")[0];

  return {
    x: Number(off?.getAttribute("x") || "0"),
    y: Number(off?.getAttribute("y") || "0"),
    width: Number(ext?.getAttribute("cx") || "0"),
    height: Number(ext?.getAttribute("cy") || "0"),
    rotation: Number(xfrm?.getAttribute("rot") || "0") / 60000,
  };
}

function parseParagraphs(txBody: Element | null) {
  if (!txBody) {
    return [];
  }

  const paragraphs = Array.from(txBody.getElementsByTagNameNS(NS_A, "p"));

  return paragraphs
    .map((paragraph, paragraphIndex) => {
      const paragraphProps = paragraph.getElementsByTagNameNS(NS_A, "pPr")[0];
      const bulletChar =
        paragraphProps?.getElementsByTagNameNS(NS_A, "buChar")[0]?.getAttribute("char")
        || undefined;
      const autoNumbered = Boolean(
        paragraphProps?.getElementsByTagNameNS(NS_A, "buAutoNum")[0],
      );
      const runs = Array.from(paragraph.childNodes)
        .flatMap((node) => {
          if (!(node instanceof Element)) {
            return [];
          }

          const tagName = node.localName;
          if (tagName === "r") {
            const textNode = node.getElementsByTagNameNS(NS_A, "t")[0];
            const text = textNode?.textContent || "";
            if (!text) {
              return [];
            }

            const runProps = node.getElementsByTagNameNS(NS_A, "rPr")[0];
            const size = Number(runProps?.getAttribute("sz") || "1800");

            return [{
              text,
              color:
                parseColor(runProps?.getElementsByTagNameNS(NS_A, "solidFill")[0] || null) ||
                "#0f172a",
              fontSize: Math.max(12, (size / 100) * 1.333),
              bold: runProps?.getAttribute("b") === "1",
              italic: runProps?.getAttribute("i") === "1",
              underline: runProps?.getAttribute("u") === "sng",
            } satisfies PptxRunModel];
          }

          if (tagName === "br") {
            return [{ text: "\n" }];
          }

          if (tagName === "fld") {
            const textNode = node.getElementsByTagNameNS(NS_A, "t")[0];
            return textNode?.textContent ? [{ text: textNode.textContent }] : [];
          }

          return [];
        })
        .filter((run) => run.text.length > 0);

      return {
        runs,
        align: paragraphProps?.getAttribute("algn") || "l",
        level: Number(paragraphProps?.getAttribute("lvl") || "0"),
        bullet: Boolean(bulletChar) || autoNumbered,
        bulletText: bulletChar || (autoNumbered ? `${paragraphIndex + 1}.` : undefined),
      } satisfies PptxParagraphModel;
    })
    .filter((paragraph) => paragraph.runs.length > 0);
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  slideXml: string,
  relationships: Map<string, string>,
) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(slideXml, "application/xml");
  const elements: PptxSlideElementModel[] = [];
  const shapeNodes = Array.from(doc.getElementsByTagNameNS(NS_P, "sp"));
  const pictureNodes = Array.from(doc.getElementsByTagNameNS(NS_P, "pic"));
  const bgNode = doc.getElementsByTagNameNS(NS_P, "bg")[0];
  const bgFill = bgNode
    ?.getElementsByTagNameNS(NS_P, "bgPr")[0]
    ?.getElementsByTagNameNS(NS_A, "solidFill")[0];
  const background = parseColor(bgFill || null) || "#ffffff";

  for (const shape of shapeNodes) {
    const shapeProps = shape.getElementsByTagNameNS(NS_P, "spPr")[0];
    const txBody = shape.getElementsByTagNameNS(NS_P, "txBody")[0];
    const paragraphs = parseParagraphs(txBody);
    const fill = parseColor(shapeProps?.getElementsByTagNameNS(NS_A, "solidFill")[0] || null);
    const line = parseColor(
      shapeProps
        ?.getElementsByTagNameNS(NS_A, "ln")[0]
        ?.getElementsByTagNameNS(NS_A, "solidFill")[0] || null,
    );
    const transform = parseTransform(shapeProps);

    if (paragraphs.length === 0 && !fill && !line) {
      continue;
    }

    elements.push({
      id: `shape-${elements.length + 1}`,
      kind: "shape",
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      rotation: transform.rotation,
      fill,
      stroke: line,
      paragraphs,
      alt:
        shape
          .getElementsByTagNameNS(NS_P, "cNvPr")[0]
          ?.getAttribute("name") || undefined,
    });
  }

  for (const picture of pictureNodes) {
    const blip = picture.getElementsByTagNameNS(NS_A, "blip")[0];
    const embedId = blip?.getAttributeNS(NS_R, "embed");
    const targetPath = embedId ? relationships.get(embedId) : undefined;
    if (!targetPath) {
      continue;
    }

    const imageFile = zip.file(targetPath);
    if (!imageFile) {
      continue;
    }

    const transform = parseTransform(
      picture.getElementsByTagNameNS(NS_P, "spPr")[0],
    );
    const base64 = await imageFile.async("base64");

    elements.push({
      id: `image-${elements.length + 1}`,
      kind: "image",
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      rotation: transform.rotation,
      imageSrc: `data:${getMimeType(targetPath)};base64,${base64}`,
      alt:
        picture
          .getElementsByTagNameNS(NS_P, "cNvPr")[0]
          ?.getAttribute("name") || undefined,
    });
  }

  const allText = elements
    .flatMap((element) => element.paragraphs || [])
    .flatMap((paragraph) => paragraph.runs)
    .map((run) => run.text.replace(/\n/g, " ").trim())
    .filter(Boolean);

  return {
    background,
    elements,
    title: allText[0],
    summary: allText.slice(1, 4).join(" "),
  } satisfies PptxSlideModel;
}

function makeSlideThumbnail(slide: PptxSlideModel, index: number) {
  const title = slide.title || `Slide ${index + 1}`;
  const summary = slide.summary || "Presentation preview";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">
      <rect width="100%" height="100%" fill="${slide.background || "#ffffff"}" rx="10" ry="10" />
      <rect x="10" y="10" width="140" height="18" fill="rgba(15,23,42,0.12)" rx="6" ry="6" />
      <text x="16" y="24" fill="#0f172a" font-size="10" font-family="Arial">${title}</text>
      <text x="16" y="48" fill="#334155" font-size="9" font-family="Arial">${summary}</text>
    </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function PptxRenderer(props: PptxRendererProps) {
  const [slides, setSlides] = useState<PptxSlideModel[]>([]);
  const [slideSize, setSlideSize] = useState({ width: 9144000, height: 5143500 });
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(SLIDE_RENDER_MAX_VIEW_WIDTH);

  useEffect(() => {
    if (!props.arrayBuffer) {
      setSlides([]);
      props.onPageCount(1);
      props.onThumbs([]);
      props.onExportStateChange?.(null);
      return;
    }

    const loadPptx = async () => {
      try {
        const arrayBuffer = props.arrayBuffer;
        if (!arrayBuffer) {
          return;
        }

        const zip = await JSZip.loadAsync(arrayBuffer);
        const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
        const nextSize = parsePresentationSize(presentationXml);
        setSlideSize(nextSize);

        const slidePaths = Object.keys(zip.files)
          .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
          .sort((left, right) => {
            const leftNumber = Number(left.match(/slide(\d+)/)?.[1] || "0");
            const rightNumber = Number(right.match(/slide(\d+)/)?.[1] || "0");
            return leftNumber - rightNumber;
          });

        const parsedSlides: PptxSlideModel[] = [];
        for (const slidePath of slidePaths) {
          const slideXml = await zip.file(slidePath)?.async("string");
          if (!slideXml) {
            continue;
          }

          const relsPath = slidePath.replace(
            /ppt\/slides\/(slide\d+\.xml)$/,
            "ppt/slides/_rels/$1.rels",
          );
          const relationshipsXml = await zip.file(relsPath)?.async("string");
          const relationships = parseRelationships(relationshipsXml, slidePath);
          parsedSlides.push(await parseSlide(zip, slidePath, slideXml, relationships));
        }

        setSlides(parsedSlides);
        props.onPageCount(Math.max(parsedSlides.length, 1));
        props.onThumbs(parsedSlides.map(makeSlideThumbnail));
        props.onExportStateChange?.({
          slideSize: nextSize,
          slides: parsedSlides,
          sourceArrayBuffer: arrayBuffer.slice(0),
          sourceFileType: props.fileName?.toLowerCase().endsWith(".ppt")
            ? "ppt"
            : "pptx",
        });
      } catch (err: any) {
        setError(err.message || "Failed to parse PPTX");
      }
    };

    loadPptx();
  }, [props.arrayBuffer, props.onExportStateChange]);

  useEffect(() => {
    const host = viewRef.current;
    if (!host || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth) {
        setViewWidth(nextWidth);
      }
    });

    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const pagesToShow = useMemo(() => {
    if (slides.length === 0) {
      return [];
    }

    const validPage = Math.max(1, Math.min(props.currentPage, slides.length));

    if (props.layout === "side-by-side" && slides.length > 1) {
      if (validPage === 1) {
        return [1];
      }

      const left = validPage % 2 === 0 ? validPage : validPage - 1;
      return [left, left + 1].filter((page) => page <= slides.length);
    }

    return [validPage];
  }, [slides.length, props.currentPage, props.layout]);

  const slideViewportWidth = useMemo(() => {
    const boundedWidth = Math.max(
      SLIDE_RENDER_MIN_VIEW_WIDTH,
      Math.min(viewWidth, SLIDE_RENDER_MAX_VIEW_WIDTH * 2 + SLIDE_RENDER_GAP),
    );

    if (props.layout === "side-by-side" && pagesToShow.length > 1) {
      return Math.max(
        (boundedWidth - SLIDE_RENDER_GAP) / 2,
        SLIDE_RENDER_MIN_VIEW_WIDTH,
      );
    }

    return Math.max(
      Math.min(boundedWidth, SLIDE_RENDER_MAX_VIEW_WIDTH),
      SLIDE_RENDER_MIN_VIEW_WIDTH,
    );
  }, [pagesToShow.length, props.layout, viewWidth]);

  const sceneCoordScale = SLIDE_RENDER_BASE_WIDTH / slideSize.width;
  const sceneHeight = Math.max(1, Math.round(slideSize.height * sceneCoordScale));
  const sceneScale = slideViewportWidth / SLIDE_RENDER_BASE_WIDTH;

  if (error) {
    return <div className="hv-error-banner">{error}</div>;
  }

  return (
    <div
      ref={viewRef}
      className={props.layout === "side-by-side" ? "hv-view-double" : "hv-view-single"}
    >
      {pagesToShow.map((pageNumber) => {
        const slide = slides[pageNumber - 1];
        if (!slide) {
          return null;
        }

        return (
          <div
            key={pageNumber}
            className="hv-page-container hv-slide-surface"
            style={{
              aspectRatio: `${slideSize.width}/${slideSize.height}`,
              width:
                props.layout === "side-by-side" && pagesToShow.length > 1
                  ? `${slideViewportWidth}px`
                  : undefined,
            }}
          >
            <div
              className="hv-slide-stage"
              style={{ background: slide.background || "#ffffff" }}
            >
              <div
                className="hv-slide-scene"
                style={{
                  width: `${SLIDE_RENDER_BASE_WIDTH}px`,
                  height: `${sceneHeight}px`,
                  transform: `scale(${sceneScale})`,
                }}
              >
              {slide.elements.map((element) => (
                <div
                  key={element.id}
                  className={`hv-slide-element ${element.kind}`}
                  style={{
                    left: `${element.x * sceneCoordScale}px`,
                    top: `${element.y * sceneCoordScale}px`,
                    width: `${element.width * sceneCoordScale}px`,
                    height: `${element.height * sceneCoordScale}px`,
                    transform: element.rotation
                      ? `rotate(${element.rotation}deg)`
                      : undefined,
                    background: element.kind === "shape" ? element.fill || "transparent" : undefined,
                    borderColor: element.stroke,
                  }}
                >
                  {element.kind === "image" && element.imageSrc ? (
                    <PresentationImage
                      src={element.imageSrc}
                      alt={element.alt || "Slide image"}
                    />
                  ) : (
                    <div className="hv-slide-textbox">
                      {element.paragraphs?.map((paragraph, paragraphIndex) => (
                        <p
                          key={`${element.id}-${paragraphIndex}`}
                          className={`hv-slide-paragraph ${alignToClassName(paragraph.align)}`}
                          style={{ paddingInlineStart: `${paragraph.level * 18}px` }}
                        >
                          {paragraph.bullet && <span className="hv-slide-bullet">•</span>}
                          <span className="hv-slide-paragraph-copy">
                            {paragraph.runs.map((run, runIndex) => (
                              <span
                                key={`${element.id}-${paragraphIndex}-${runIndex}`}
                                style={{
                                  color: run.color,
                                  fontSize: Math.max(
                                    12,
                                    (run.fontSize || 18) * sceneCoordScale,
                                  ),
                                  fontWeight: run.bold ? 700 : 400,
                                  fontStyle: run.italic ? "italic" : "normal",
                                  textDecoration: run.underline ? "underline" : "none",
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {run.text}
                              </span>
                            ))}
                          </span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <SignatureOverlay
                surfaceKey={`slide:${pageNumber}`}
                surfaceKind="slide"
                slide={pageNumber}
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
                signatureColorLabel={props.signatureOverlay.signatureColorLabel}
                signatureColorNames={props.signatureOverlay.signatureColorNames}
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
          </div>
        );
      })}
    </div>
  );
}
