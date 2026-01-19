'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { SupportedFileType } from '../types';

/**
 * Image renderer for DocumentViewer.
 * Supports PNG, JPG, SVG, etc. with zoom controls.
 */
export function ImageRenderer({
  arrayBuffer,
  fileType,
  fileName,
}: {
  /** Image file as ArrayBuffer (optional) */
  arrayBuffer?: ArrayBuffer;
  /** File type (e.g. 'png', 'jpg', 'svg') */
  fileType: SupportedFileType;
  /** File name for display */
  fileName: string;
}) {
  const [zoom, setZoom] = useState(1);
  const url = useMemo(() => {
    if (!arrayBuffer) { return undefined; }
    const mime =
      fileType === 'svg'
        ? 'image/svg+xml'
        : fileType === 'png'
          ? 'image/png'
          : 'image/jpeg';
    return URL.createObjectURL(new Blob([arrayBuffer], { type: mime }));
  }, [arrayBuffer, fileType]);

  useEffect(() => {
    return () => {
      if (url) { URL.revokeObjectURL(url); }
    };
  }, [url]);

  return (
    <div className="hv-doc">
      <div className="hv-mini-toolbar">
        <div className="hv-title">{fileName}</div>
        <div className="hv-spacer" />
        <button
          type="button"
          className="hv-btn"
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
        >
          -
        </button>
        <div className="hv-zoom">{Math.round(zoom * 100)}%</div>
        <button
          type="button"
          className="hv-btn"
          onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
        >
          +
        </button>
      </div>
      <div className="hv-center">
        {!arrayBuffer && (
          <div className="hv-error">No image data provided.</div>
        )}
        {arrayBuffer && !url && (
          <div className="hv-error">Failed to load image.</div>
        )}
        {url && (
          <img
            src={url}
            alt={fileName}
            style={{ transform: `scale(${zoom})` }}
            className="hv-image"
          />
        )}
      </div>
    </div>
  );
}
