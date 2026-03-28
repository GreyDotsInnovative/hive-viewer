"use client";

import { MessageSquare } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnnotationPlacement,
  DocumentSurfaceOverlayState,
  SignaturePlacement,
  SignatureSurfaceKind,
} from "../types";
import {
  normalizeSignatureDate,
  normalizeSignatureInkColor,
  SIGNATURE_INK_COLORS,
  SIGNATURE_INK_COLOR_VALUES,
} from "../utils/signature";

interface SignatureOverlayProps extends DocumentSurfaceOverlayState {
  surfaceKey: string;
  surfaceKind: SignatureSurfaceKind;
  page?: number;
  slide?: number;
  sheetName?: string;
}

type DragMode = "move" | "resize";
type DragTargetType = "signature" | "annotation";

interface DragState {
  id: string;
  targetType: DragTargetType;
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
  aspectRatio?: number;
  rect: DOMRect;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getDefaultPlacementSize(kind: SignatureSurfaceKind) {
  switch (kind) {
    case "sheet":
      return { width: 0.3, height: 0.16 };
    case "slide":
      return { width: 0.34, height: 0.18 };
    case "image":
      return { width: 0.36, height: 0.18 };
    default:
      return { width: 0.34, height: 0.16 };
  }
}

function getDefaultAnnotationSize(kind: SignatureSurfaceKind) {
  switch (kind) {
    case "sheet":
      return { width: 0.2, height: 0.12 };
    case "slide":
      return { width: 0.22, height: 0.12 };
    case "image":
      return { width: 0.24, height: 0.12 };
    default:
      return { width: 0.26, height: 0.12 };
  }
}

function getLinkedAnnotationIds(annotations: AnnotationPlacement[]) {
  return new Set(
    annotations
      .filter((annotation) => annotation.linkedSignaturePlacementId)
      .map((annotation) => annotation.linkedSignaturePlacementId as string),
  );
}

function buildMaskImageValue(source: string) {
  return `url("${source.replaceAll('"', '\\"')}")`;
}

export function SignatureOverlay(props: SignatureOverlayProps) {
  const {
    surfaceKey,
    surfaceKind,
    page,
    slide,
    sheetName,
    placements,
    annotations,
    pendingSignature,
    pendingAnnotation,
    activePlacementId,
    activeAnnotationId,
    placeHint,
    annotationHint,
    annotationPlaceholder,
    signatureAltLabel,
    signatureAltByLabel,
    signatureNoteIndicatorLabel,
    signatureColorLabel,
    signatureColorNames,
    removeSignatureLabel,
    annotationTitle,
    linkedAnnotationTitle,
    linkedAnnotationBadge,
    openAnnotationLabel,
    removeAnnotationLabel,
    onPlaceSignature,
    onPlaceAnnotation,
    onUpdatePlacement,
    onUpdateAnnotation,
    onRemovePlacement,
    onRemoveAnnotation,
    onSelectPlacement,
    onSelectAnnotation,
  } = props;
  const layerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const visiblePlacements = useMemo(
    () => placements.filter((placement) => placement.surfaceKey === surfaceKey),
    [placements, surfaceKey],
  );
  const visibleAnnotations = useMemo(
    () =>
      annotations.filter((annotation) => annotation.surfaceKey === surfaceKey),
    [annotations, surfaceKey],
  );
  const linkedAnnotationIds = useMemo(
    () => getLinkedAnnotationIds(visibleAnnotations),
    [visibleAnnotations],
  );
  const captureMode = pendingSignature
    ? "signature"
    : pendingAnnotation
      ? "annotation"
      : null;

  useEffect(() => {
    if (captureMode || dragState) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          ".hv-signature-stamp, .hv-annotation-card, .hv-annotation-chip, .hv-signature-overlay-capture",
        )
      ) {
        return;
      }

      onSelectPlacement(null);
      onSelectAnnotation(null);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [captureMode, dragState, onSelectAnnotation, onSelectPlacement]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = dragState.rect;
      const deltaX = (event.clientX - dragState.startClientX) / rect.width;
      const deltaY = (event.clientY - dragState.startClientY) / rect.height;

      if (dragState.mode === "move") {
        const nextX = clamp(
          dragState.originX + deltaX,
          0,
          1 - dragState.originWidth,
        );
        const nextY = clamp(
          dragState.originY + deltaY,
          0,
          1 - dragState.originHeight,
        );

        if (dragState.targetType === "signature") {
          onUpdatePlacement(dragState.id, { x: nextX, y: nextY });
          return;
        }

        onUpdateAnnotation(dragState.id, { x: nextX, y: nextY });
        return;
      }

      if (dragState.targetType === "signature") {
        const nextWidth = clamp(
          dragState.originWidth + deltaX,
          0.08,
          1 - dragState.originX,
        );
        const nextHeight = clamp(
          nextWidth / (dragState.aspectRatio || 3.1),
          0.035,
          1 - dragState.originY,
        );

        onUpdatePlacement(dragState.id, {
          width: nextWidth,
          height: nextHeight,
        });
        return;
      }

      const nextWidth = clamp(
        dragState.originWidth + deltaX,
        0.12,
        1 - dragState.originX,
      );
      const nextHeight = clamp(
        dragState.originHeight + deltaY,
        0.08,
        1 - dragState.originY,
      );

      onUpdateAnnotation(dragState.id, {
        width: nextWidth,
        height: nextHeight,
      });
    };

    const handlePointerUp = () => {
      setDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, onUpdateAnnotation, onUpdatePlacement]);

  const handlePlace = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!layerRef.current || !captureMode) {
      return;
    }

    const rect = layerRef.current.getBoundingClientRect();
    const clickX = (event.clientX - rect.left) / rect.width;
    const clickY = (event.clientY - rect.top) / rect.height;

    if (captureMode === "signature" && pendingSignature) {
      const { width, height } = getDefaultPlacementSize(surfaceKind);

      onPlaceSignature({
        signature: pendingSignature,
        surfaceKey,
        surfaceKind,
        page,
        slide,
        sheetName,
        x: clamp(clickX - width / 2, 0, 1 - width),
        y: clamp(clickY - height / 2, 0, 1 - height),
        width,
        height,
      });
      return;
    }

    if (captureMode === "annotation") {
      const { width, height } = getDefaultAnnotationSize(surfaceKind);

      onPlaceAnnotation({
        surfaceKey,
        surfaceKind,
        page,
        slide,
        sheetName,
        x: clamp(clickX - width / 2, 0, 1 - width),
        y: clamp(clickY - height / 2, 0, 1 - height),
        width,
        height,
        text: "",
      });
    }
  };

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    target:
      | { kind: "signature"; item: SignaturePlacement }
      | { kind: "annotation"; item: AnnotationPlacement },
    mode: DragMode,
  ) => {
    if (!layerRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (target.kind === "signature") {
      onSelectPlacement(target.item.id);
      onSelectAnnotation(null);
      setDragState({
        id: target.item.id,
        targetType: "signature",
        mode,
        startClientX: event.clientX,
        startClientY: event.clientY,
        originX: target.item.x,
        originY: target.item.y,
        originWidth: target.item.width,
        originHeight: target.item.height,
        aspectRatio:
          target.item.width > 0 && target.item.height > 0
            ? target.item.width / target.item.height
            : 3.1,
        rect: layerRef.current.getBoundingClientRect(),
      });
      return;
    }

    onSelectAnnotation(target.item.id);
    onSelectPlacement(null);
    setDragState({
      id: target.item.id,
      targetType: "annotation",
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: target.item.x,
      originY: target.item.y,
      originWidth: target.item.width,
      originHeight: target.item.height,
      rect: layerRef.current.getBoundingClientRect(),
    });
  };

  return (
    <div ref={layerRef} className="hv-signature-overlay">
      {captureMode && (
        <div className="hv-signature-overlay-capture" onClick={handlePlace}>
          <div className="hv-signature-overlay-hint">
            {captureMode === "annotation" ? annotationHint : placeHint}
          </div>
        </div>
      )}

      {visiblePlacements.map((placement) => {
        const isActive = placement.id === activePlacementId;
        const hasLinkedAnnotation = linkedAnnotationIds.has(placement.id);
        const signer = placement.signature.signedBy?.trim();
        const jobTitle = placement.signature.jobTitle?.trim();
        const signedDate = normalizeSignatureDate(placement.signature.dateSigned);
        const signatureColor = normalizeSignatureInkColor(placement.signatureColor);
        const maskImage = buildMaskImageValue(placement.signature.signatureImageUrl);

        return (
          <div
            key={placement.id}
            className={`hv-signature-stamp ${isActive ? "active" : ""}`}
            style={{
              left: `${placement.x * 100}%`,
              top: `${placement.y * 100}%`,
              width: `${placement.width * 100}%`,
              height: `${placement.height * 100}%`,
            }}
            onPointerDown={(event) => {
              if (!isActive) {
                event.stopPropagation();
                onSelectPlacement(placement.id);
                onSelectAnnotation(null);
                return;
              }

              beginDrag(event, { kind: "signature", item: placement }, "move");
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelectPlacement(placement.id);
              onSelectAnnotation(null);
            }}
          >
            {isActive && (
              <button
                type="button"
                className="hv-signature-remove"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemovePlacement(placement.id);
                }}
                aria-label={removeSignatureLabel}
              >
                x
              </button>
            )}

            <div className="hv-signature-image-wrap">
              <div
                role="img"
                aria-label={signer ? `${signatureAltByLabel} ${signer}` : signatureAltLabel}
                className="hv-signature-image hv-signature-ink"
                style={{
                  backgroundColor: SIGNATURE_INK_COLOR_VALUES[signatureColor],
                  maskImage,
                  WebkitMaskImage: maskImage,
                }}
              />
            </div>

            <div className="hv-signature-meta">
              {signer && <span className="hv-signature-meta-name">{signer}</span>}
              {jobTitle && (
                <span className="hv-signature-meta-jobtitle">{jobTitle}</span>
              )}
              <span className="hv-signature-meta-date">{signedDate}</span>
            </div>

            {hasLinkedAnnotation && (
              <div className="hv-signature-note-indicator">
                {signatureNoteIndicatorLabel}
              </div>
            )}

            {isActive && (
              <div
                className="hv-signature-color-toolbar"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <span className="hv-signature-color-toolbar-label">
                  {signatureColorLabel}
                </span>
                <div className="hv-signature-color-swatch-row">
                  {SIGNATURE_INK_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`hv-signature-color-swatch ${signatureColor === color ? "active" : ""}`}
                      style={{ background: SIGNATURE_INK_COLOR_VALUES[color] }}
                      aria-label={`${signatureColorLabel}: ${signatureColorNames[color]}`}
                      title={signatureColorNames[color]}
                      onClick={() =>
                        onUpdatePlacement(placement.id, { signatureColor: color })
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {isActive && (
              <div
                className="hv-signature-resize"
                onPointerDown={(event) =>
                  beginDrag(
                    event,
                    { kind: "signature", item: placement },
                    "resize",
                  )
                }
              />
            )}
          </div>
        );
      })}

      {visibleAnnotations.map((annotation) => {
        const isActive = annotation.id === activeAnnotationId;
        const isLinked = Boolean(annotation.linkedSignaturePlacementId);
        const hasText = annotation.text.trim().length > 0;

        if (!isActive) {
          return (
            <button
              key={annotation.id}
              type="button"
              className={`hv-annotation-chip ${isLinked ? "linked" : ""} ${hasText ? "" : "empty"}`}
              style={{
                left: `${annotation.x * 100}%`,
                top: `${annotation.y * 100}%`,
              }}
              aria-label={hasText ? annotation.text : openAnnotationLabel}
              title={hasText ? annotation.text : openAnnotationLabel}
              onClick={(event) => {
                event.stopPropagation();
                onSelectAnnotation(annotation.id);
                onSelectPlacement(null);
              }}
            >
              <MessageSquare size={14} />
            </button>
          );
        }

        return (
          <div
            key={annotation.id}
            className={`hv-annotation-card ${isActive ? "active" : ""} ${isLinked ? "linked" : ""}`}
            style={{
              left: `${annotation.x * 100}%`,
              top: `${annotation.y * 100}%`,
              width: `${annotation.width * 100}%`,
              height: `${annotation.height * 100}%`,
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelectAnnotation(annotation.id);
              onSelectPlacement(null);
            }}
          >
            <div
              className="hv-annotation-header"
              onPointerDown={(event) => {
                if (!isActive) {
                  event.stopPropagation();
                  onSelectAnnotation(annotation.id);
                  onSelectPlacement(null);
                  return;
                }

                beginDrag(
                  event,
                  { kind: "annotation", item: annotation },
                  "move",
                );
              }}
            >
              <div className="hv-annotation-header-copy">
                <span className="hv-annotation-title">
                  {isLinked ? linkedAnnotationTitle : annotationTitle}
                </span>
                {isLinked && (
                  <span className="hv-annotation-badge">{linkedAnnotationBadge}</span>
                )}
              </div>

              {isActive && (
                <button
                  type="button"
                  className="hv-annotation-remove"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveAnnotation(annotation.id);
                  }}
                  aria-label={removeAnnotationLabel}
                >
                  x
                </button>
              )}
            </div>

            <div className="hv-annotation-body">
              {isActive ? (
                <textarea
                  value={annotation.text}
                  placeholder={annotationPlaceholder}
                  className="hv-annotation-input"
                  autoFocus
                  onChange={(event) =>
                    onUpdateAnnotation(annotation.id, {
                      text: event.target.value,
                    })
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                />
              ) : (
                <div
                  className={`hv-annotation-preview ${hasText ? "" : "empty"}`}
                >
                  {hasText ? annotation.text : annotationPlaceholder}
                </div>
              )}
            </div>

            {isActive && (
              <div
                className="hv-annotation-resize"
                onPointerDown={(event) =>
                  beginDrag(
                    event,
                    { kind: "annotation", item: annotation },
                    "resize",
                  )
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
