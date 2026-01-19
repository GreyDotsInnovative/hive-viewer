"use client";

import React from "react";

export interface Thumbnail {
  id: string;
  label: string;
  dataUrl?: string;
}

export function ThumbnailsSidebar(props: {
  locale: Record<string, string>;
  thumbnails: Thumbnail[];
  currentPage: number;
  collapsed: boolean;
  onToggle: () => void;
  onSelectPage: (p: number) => void;
}) {
  const t = props.locale["thumbnails.title"] ?? "Thumbnails";
  return (
    <aside
      className={
        props.collapsed ? "hv-thumbs hv-thumbs--collapsed" : "hv-thumbs"
      }
      aria-label={t}
    >
      <div className="hv-thumbs-header">
        <button
          type="button"
          className="hv-thumbs-toggle"
          onClick={props.onToggle}
          aria-label={
            props.collapsed
              ? (props.locale["thumbnails.open"] ?? "Open thumbnails")
              : (props.locale["thumbnails.close"] ?? "Close thumbnails")
          }
        >
          <span className="hv-thumbs-toggle-icon">
            {props.collapsed ? "▸" : "▾"}
          </span>
        </button>
        {!props.collapsed && <div className="hv-thumbs-title">{t}</div>}
      </div>
      {!props.collapsed && (
        <div className="hv-thumbs-list" role="list">
          {props.thumbnails.map((th, idx) => {
            const p = idx + 1;
            const active = p === props.currentPage;
            return (
              <button
                key={th.id}
                type="button"
                role="listitem"
                className={active ? "hv-thumb hv-thumb--active" : "hv-thumb"}
                onClick={() => props.onSelectPage(p)}
                aria-current={active ? "page" : undefined}
                tabIndex={0}
              >
                <div className="hv-thumb-img" aria-hidden>
                  {th.dataUrl ? (
                    <img src={th.dataUrl} alt="" />
                  ) : (
                    <div className="hv-thumb-placeholder" />
                  )}
                </div>
                <div className="hv-thumb-label">{th.label}</div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
