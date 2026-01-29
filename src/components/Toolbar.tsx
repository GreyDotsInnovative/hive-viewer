"use client";

import {
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine, // Changed from Download
  PanelRightClose,
  PanelRightOpen,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React from "react";

interface ToolbarProps {
  fileName?: string;
  pageCount: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  layout: "single" | "side-by-side";
  onLayoutChange: (layout: "single" | "side-by-side") => void;

  // Left Sidebar (Thumbnails)
  showThumbnails: boolean;
  onToggleThumbnails: () => void;

  // Right Sidebar (Signatures)
  showSignatures: boolean;
  onToggleSignatures: () => void;
  disableSigning?: boolean;
}

export function Toolbar(props: ToolbarProps) {
  const {
    fileName,
    pageCount,
    currentPage,
    onPageChange,
    layout,
    onLayoutChange,
  } = props;

  const handlePrev = () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < pageCount) onPageChange(currentPage + 1);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val) && val >= 1 && val <= pageCount) {
      onPageChange(val);
    }
  };

  return (
    <div className="hv-toolbar">
      {/* Left Group: Thumbnails & Title */}
      <div className="hv-toolbar-group">
        <button
          className={`hv-btn ${props.showThumbnails ? "hv-btn-active" : ""}`}
          onClick={props.onToggleThumbnails}
          title="Toggle Thumbnails"
        >
          {props.showThumbnails ? (
            <PanelLeftClose size={20} />
          ) : (
            <PanelLeftOpen size={20} />
          )}
        </button>
        <div
          className="hv-sep"
          style={{
            width: 1,
            height: 24,
            background: "var(--hv-border)",
            margin: "0 8px",
          }}
        />
        <span
          style={{
            fontWeight: 600,
            fontSize: "14px",
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {fileName || "Document"}
        </span>
      </div>

      {/* Center Group: Pagination */}
      <div className="hv-toolbar-group">
        <button
          className="hv-btn"
          disabled={currentPage <= 1}
          onClick={handlePrev}
        >
          <ChevronLeft size={20} />
        </button>

        <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
          <input
            type="number"
            className="w-12 text-center border rounded py-1 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            value={currentPage}
            onChange={handleInput}
            min={1}
            max={pageCount}
          />
          <span className="text-gray-400">/</span>
          <span>{pageCount}</span>
        </div>

        <button
          className="hv-btn"
          disabled={currentPage >= pageCount}
          onClick={handleNext}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Right Group: Layout & Signatures */}
      <div className="hv-toolbar-group">
        <button
          className={`hv-btn ${layout === "single" ? "hv-btn-active text-indigo-600 bg-indigo-50" : ""}`}
          onClick={() => onLayoutChange("single")}
          title="Single Page View"
        >
          <LayoutTemplate size={18} />
        </button>
        <button
          className={`hv-btn ${layout === "side-by-side" ? "hv-btn-active text-indigo-600 bg-indigo-50" : ""}`}
          onClick={() => onLayoutChange("side-by-side")}
          title="Two Page View"
        >
          <Grid2X2 size={18} />
        </button>

        <div
          className="hv-sep"
          style={{
            width: 1,
            height: 24,
            background: "var(--hv-border)",
            margin: "0 8px",
          }}
        />

        {/* Signature Toggle Button */}
        {!props.disableSigning && (
          <button
            className={`hv-btn hv-btn-primary ${props.showSignatures ? "ring-2 ring-indigo-300" : ""}`}
            onClick={props.onToggleSignatures}
            title="Sign Document"
          >
            <PenLine size={18} className="mr-2" />
            <span className="hidden sm:inline">Sign</span>
          </button>
        )}
      </div>
    </div>
  );
}
