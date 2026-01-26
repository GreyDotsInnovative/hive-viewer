"use client";

import React from "react";
import type { Signature } from "../types";

export function SignaturePanel(props: {
  locale: Record<string, string>;
  signatures: Signature[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const title = props.locale["signatures.title"] ?? "Signatures";
  // Deduplicate signatures by signedBy, dateSigned, and image URL
  const deduped = React.useMemo(() => {
    const seen = new Set();
    return props.signatures.filter((s) => {
      const key = `${s.signedBy}|${s.dateSigned}|${s.signatureImageUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [props.signatures]);

  return (
    <aside
      className={props.collapsed ? "hv-side hv-side--collapsed" : "hv-side"}
      aria-label={title}
    >
      <div className="hv-sidebar-header">
        <button
          type="button"
          className="hv-icon"
          onClick={props.onToggle}
          aria-label={props.locale["toolbar.signatures"] ?? "Signatures"}
        >
          <span aria-hidden>✍</span>
        </button>
        <div className="hv-sidebar-title">{title}</div>
      </div>
      <div className="hv-sidebar-body">
        {deduped.length === 0 && (
          <div className="hv-signature-empty" aria-live="polite">
            {props.locale["signatures.empty"] ?? "No signatures yet."}
          </div>
        )}
        {deduped.map((s, idx) => (
          <div
            key={`${s.signedBy}-${s.dateSigned}-${s.signatureImageUrl}`}
            className="hv-signature-card"
            tabIndex={0}
            aria-label={`Signature by ${s.signedBy}`}
          >
            <img
              src={s.signatureImageUrl}
              alt={
                props.locale["signatures.imgAlt"]
                  ? props.locale["signatures.imgAlt"].replace(
                      "{name}",
                      s.signedBy,
                    )
                  : `Signature by ${s.signedBy}`
              }
              className="hv-signature-img"
            />
            <div className="hv-signature-meta">
              <div className="hv-signature-name">{s.signedBy}</div>
              <div className="hv-signature-date">
                {new Date(s.dateSigned).toLocaleString()}
              </div>
              {s.comment ? (
                <div className="hv-signature-comment">{s.comment}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
