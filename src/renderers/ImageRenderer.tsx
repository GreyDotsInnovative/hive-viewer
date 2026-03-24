"use client";

import React, { useEffect, useMemo } from "react";
import { SignatureOverlay } from "../components/SignatureOverlay";
import type {
  DocumentSurfaceOverlayState,
  SupportedFileType,
} from "../types";

interface ImageRendererProps {
  arrayBuffer?: ArrayBuffer;
  fileType: SupportedFileType;
  fileName: string;
  signatureOverlay: DocumentSurfaceOverlayState;
  locale: Record<string, string>;
}

export function ImageRenderer(props: ImageRendererProps) {
  const url = useMemo(() => {
    if (!props.arrayBuffer) {
      return undefined;
    }

    const mime =
      props.fileType === "svg"
        ? "image/svg+xml"
        : props.fileType === "png"
          ? "image/png"
          : "image/jpeg";

    return URL.createObjectURL(new Blob([props.arrayBuffer], { type: mime }));
  }, [props.arrayBuffer, props.fileType]);

  useEffect(() => {
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [url]);

  if (!props.arrayBuffer || !url) {
    return (
      <div className="hv-view-single">
        <div className="hv-page-container" style={{ padding: "48px" }}>
          <p className="hv-empty-state">{props.locale["documents.imageMissing"]}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="hv-view-single">
      <div className="hv-page-container hv-image-surface">
        <img src={url} alt={props.fileName} className="hv-image-renderer" />
        <SignatureOverlay
          surfaceKey="image:main"
          surfaceKind="image"
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
