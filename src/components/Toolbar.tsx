"use client";

import React from "react";
import type { DocumentMode, PageLayout, SupportedFileType } from "../types";

export function Toolbar(props: {
  locale: Record<string, string>;
  mode: DocumentMode;
  fileType?: SupportedFileType;
  layout: PageLayout;
  onChangeLayout: (l: PageLayout) => void;
  showThumbnails: boolean;
  onToggleThumbnails: () => void;
  showSignatures: boolean;
  onToggleSignatures: () => void;
  allowSigning: boolean;
  signingDisabled: boolean;
  onSign: () => void;
  canSave: boolean;
  onSave: () => void;
  canExportPdf: boolean;
  onExportPdf: () => void;
  showHeaderFooterToggle: boolean;
  headerFooterEnabled: boolean;
  onToggleHeaderFooter: () => void;
}) {
  const t = (k: string, fallback: string) => props.locale[k] ?? fallback;

  return (
    <div
      className="hv-toolbar"
      role="toolbar"
      aria-label={t("a11y.toolbar", "Document toolbar")}
    >
      {/* LEFT */}
      <div className="hv-toolbar__group">
        <button
          className={`hv-btn ${props.showThumbnails ? "hv-btn--active" : ""}`}
          onClick={props.onToggleThumbnails}
          aria-pressed={props.showThumbnails}
        >
          Thumbnails
        </button>

        {props.mode !== "create" && (
          <button
            className={`hv-btn ${props.showSignatures ? "hv-btn--active" : ""}`}
            onClick={props.onToggleSignatures}
            aria-pressed={props.showSignatures}
          >
            Signatures
          </button>
        )}
      </div>

      {/* CENTER */}
      <div className="hv-toolbar__group hv-segment">
        <button
          className={`hv-btn ${props.layout === "single" ? "hv-btn--active" : ""}`}
          onClick={() => props.onChangeLayout("single")}
        >
          Single page
        </button>
        <button
          className={`hv-btn ${props.layout === "side-by-side" ? "hv-btn--active" : ""}`}
          onClick={() => props.onChangeLayout("side-by-side")}
        >
          Side-by-side
        </button>
      </div>

      {/* RIGHT */}
      <div className="hv-toolbar__group hv-toolbar__actions">
        {props.showHeaderFooterToggle && (
          <label className="hv-switch">
            <input
              type="checkbox"
              checked={props.headerFooterEnabled}
              onChange={props.onToggleHeaderFooter}
            />
            <span className="hv-switch__slider" />
            <span className="hv-switch__label">
              {t("toolbar.letterhead", "Letterhead")}
            </span>
          </label>
        )}

        {props.allowSigning && (
          <button
            className="hv-btn hv-btn--primary"
            onClick={props.onSign}
            disabled={props.signingDisabled}
          >
            Sign document
          </button>
        )}

        {props.canExportPdf && (
          <button className="hv-btn" onClick={props.onExportPdf}>
            Export PDF
          </button>
        )}

        {props.canSave && (
          <button className="hv-btn hv-btn--primary" onClick={props.onSave}>
            Save
          </button>
        )}
      </div>
    </div>
  );
}
