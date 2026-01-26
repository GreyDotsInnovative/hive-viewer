"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { SupportedFileType } from "../types";

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
    if (!arrayBuffer) {
      return undefined;
    }
    const mime =
      fileType === "svg"
        ? "image/svg+xml"
        : fileType === "png"
          ? "image/png"
          : "image/jpeg";
    return URL.createObjectURL(new Blob([arrayBuffer], { type: mime }));
  }, [arrayBuffer, fileType]);

  useEffect(() => {
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [url]);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
        <h2 className="text-sm font-medium text-gray-700 truncate max-w-md">
          {fileName}
        </h2>

        {/* Zoom Controls */}
        <div className="flex items-center gap-3 bg-gray-100 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
            className="w-9 h-9 flex items-center justify-center rounded-md bg-white hover:bg-gray-50 text-gray-700 transition-all shadow-sm hover:shadow"
            aria-label="Zoom out"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 12H4"
              />
            </svg>
          </button>

          <span className="text-sm font-semibold text-gray-700 min-w-[3.5rem] text-center px-2">
            {Math.round(zoom * 100)}%
          </span>

          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            className="w-9 h-9 flex items-center justify-center rounded-md bg-white hover:bg-gray-50 text-gray-700 transition-all shadow-sm hover:shadow"
            aria-label="Zoom in"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Image Container */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-8">
        {!arrayBuffer && (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gray-200 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-500">No image data provided</p>
          </div>
        )}

        {arrayBuffer && !url && (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-600">Failed to load image</p>
          </div>
        )}

        {url && (
          <div
            style={{ transform: `scale(${zoom})` }}
            className="transition-transform duration-200 origin-center"
          >
            <img
              src={url}
              alt={fileName}
              style={{ transform: `scale(${zoom})` }}
              className="max-w-full h-auto rounded-lg shadow-lg transition-transform duration-200"
            />
          </div>
        )}
      </div>
    </div>
  );
}
