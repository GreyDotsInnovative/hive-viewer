"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileDown,
  Grid2X2,
  LayoutTemplate,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine, // Changed from Download
  Save,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React from "react";

interface ToolbarProps {
  fileName?: string;
  pageCount: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  showHeaderFooterToggle: boolean;
  headerFooterVisible: boolean;
  onToggleHeaderFooter: () => void;
  layout: "single" | "side-by-side";
  onLayoutChange: (layout: "single" | "side-by-side") => void;

  // Left Sidebar (Thumbnails)
  showThumbnails: boolean;
  onToggleThumbnails: () => void;

  // Right Sidebar (Signatures)
  showSignatures: boolean;
  onToggleSignatures: () => void;
  signingEnabled: boolean;
  annotationEnabled: boolean;
  annotationMode: boolean;
  onToggleAnnotationMode: () => void;

  // Zoom
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  saveEnabled: boolean;
  isSaving: boolean;
  onSave?: () => void;
  onExportPdf?: () => void;
  locale: Record<string, string>;
}

export function Toolbar(props: ToolbarProps) {
  const {
    fileName,
    pageCount,
    currentPage,
    onPageChange,
    showHeaderFooterToggle,
    headerFooterVisible,
    onToggleHeaderFooter,
    layout,
    onLayoutChange,
    zoom,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    saveEnabled,
    isSaving,
    onSave,
    onExportPdf,
    locale,
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
          title={locale["toolbar.thumbs"]}
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

        <div className="hv-toolbar-page-group">
          <input
            type="number"
            className="hv-toolbar-page-input"
            value={currentPage}
            onChange={handleInput}
            min={1}
            max={pageCount}
          />
          <span className="hv-toolbar-page-sep">/</span>
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

      {/* Right Group: Layout, Save & Signatures */}
      <div className="hv-toolbar-group">
        <button
          className="hv-btn"
          onClick={onZoomOut}
          title={locale["toolbar.zoomOut"]}
          disabled={zoom <= 0.5}
        >
          <ZoomOut size={18} />
        </button>
        <button
          className="hv-btn"
          onClick={onZoomReset}
          title={locale["toolbar.zoomReset"]}
        >
          <span style={{ fontSize: "12px", fontWeight: 600 }}>
            {Math.round(zoom * 100)}%
          </span>
        </button>
        <button
          className="hv-btn"
          onClick={onZoomIn}
          title={locale["toolbar.zoomIn"]}
          disabled={zoom >= 2}
        >
          <ZoomIn size={18} />
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

        <button
          className={`hv-btn ${layout === "single" ? "hv-btn-active" : ""}`}
          onClick={() => onLayoutChange("single")}
          title={locale["toolbar.layout.single"]}
        >
          <LayoutTemplate size={18} />
        </button>
        <button
          className={`hv-btn ${layout === "side-by-side" ? "hv-btn-active" : ""}`}
          onClick={() => onLayoutChange("side-by-side")}
          title={locale["toolbar.layout.two"]}
        >
          <Grid2X2 size={18} />
        </button>

        {showHeaderFooterToggle && (
          <button
            className={`hv-btn ${headerFooterVisible ? "hv-btn-active" : ""}`}
            onClick={onToggleHeaderFooter}
            title={locale["toolbar.headerFooter"]}
          >
            <span style={{ fontSize: "12px", fontWeight: 700, marginRight: "8px" }}>
              HF
            </span>
            <span className="hv-btn-label">{locale["toolbar.headerFooter"]}</span>
          </button>
        )}

        <div
          className="hv-sep"
          style={{
            width: 1,
            height: 24,
            background: "var(--hv-border)",
            margin: "0 8px",
          }}
        />

        {saveEnabled && (
          <>
            <button
              className="hv-btn"
              onClick={onExportPdf}
              title={locale["toolbar.exportPdf"]}
              disabled={isSaving}
            >
              <FileDown size={18} />
            </button>
            <button
              className="hv-btn hv-btn-primary"
              onClick={onSave}
              title={locale["toolbar.save"]}
              disabled={isSaving}
            >
              <Save size={18} style={{ marginRight: "8px" }} />
              <span className="hv-btn-label">
                {isSaving ? locale.loading : locale["toolbar.save"]}
              </span>
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
          </>
        )}

        {/* Signature Toggle Button */}
        {props.annotationEnabled && (
          <button
            className={`hv-btn ${props.annotationMode ? "hv-btn-active" : ""}`}
            onClick={props.onToggleAnnotationMode}
            title={locale["toolbar.annotate"]}
          >
            <MessageSquarePlus size={18} style={{ marginRight: "8px" }} />
            <span className="hv-btn-label">{locale["toolbar.annotate"]}</span>
          </button>
        )}

        {props.signingEnabled && (
          <button
            className={`hv-btn hv-btn-primary ${props.showSignatures ? "hv-btn-active" : ""}`}
            onClick={props.onToggleSignatures}
            title={locale["toolbar.sign"]}
          >
            <PenLine size={18} style={{ marginRight: "8px" }} />
            <span className="hv-btn-label">{locale["toolbar.sign"]}</span>
          </button>
        )}
      </div>
    </div>
  );
}
