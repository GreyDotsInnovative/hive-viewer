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
      <div className="hv-toolbar__left gap-2">
        <button
          type="button"
          className="hv-btn"
          onClick={props.onToggleThumbnails}
          aria-pressed={props.showThumbnails}
        >
          {t("toolbar.thumbs", "Thumbnails")}
        </button>
        {props.mode !== "create" && (
          <button
            type="button"
            className="hv-btn"
            onClick={props.onToggleSignatures}
            aria-pressed={props.showSignatures}
          >
            {t("toolbar.signatures", "Signatures")}
          </button>
        )}
        <span className="hv-sep" />
        <button
          type="button"
          className={
            props.layout === "single" ? "hv-btn hv-btn--active" : "hv-btn"
          }
          onClick={() => props.onChangeLayout("single")}
        >
          {t("toolbar.layout.single", "Single")}
        </button>
        <button
          type="button"
          className={
            props.layout === "side-by-side" ? "hv-btn hv-btn--active" : "hv-btn"
          }
          onClick={() => props.onChangeLayout("side-by-side")}
        >
          {t("toolbar.layout.two", "Two")}
        </button>
      </div>

      <div className="hv-toolbar__right">
        {props.showHeaderFooterToggle && (
          <label className="hv-toggle">
            <input
              type="checkbox"
              checked={props.headerFooterEnabled}
              onChange={props.onToggleHeaderFooter}
            />
            <span>{t("toolbar.letterhead", "Letterhead")}</span>
          </label>
        )}

        {props.allowSigning && (
          <button
            type="button"
            className="hv-btn hv-btn--primary"
            onClick={props.onSign}
            disabled={props.signingDisabled}
          >
            {t("toolbar.sign", "Sign Document")}
          </button>
        )}

        {props.canExportPdf && (
          <button type="button" className="hv-btn" onClick={props.onExportPdf}>
            {t("toolbar.exportPdf", "Export as PDF")}
          </button>
        )}
        {props.canSave && (
          <button
            type="button"
            className="hv-btn hv-btn--primary"
            onClick={props.onSave}
          >
            {t("toolbar.save", "Save")}
          </button>
        )}
      </div>
    </div>
  );
}
