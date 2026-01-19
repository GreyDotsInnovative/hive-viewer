'use client';

import React from 'react';
import type { Signature } from '../types';

export function SignaturePanel(props: {
  locale: Record<string, string>;
  signatures: Signature[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const title = props.locale['signatures.title'] ?? 'Signatures';
  return (
    <aside className={props.collapsed ? 'hv-side hv-side--collapsed' : 'hv-side'} aria-label={title}>
      <div className="hv-sidebar-header">
        <button type="button" className="hv-icon" onClick={props.onToggle} aria-label={props.locale['toolbar.signatures'] ?? 'Signatures'}>
          ✍
        </button>
        <div className="hv-sidebar-title">{title}</div>
      </div>
      <div className="hv-sidebar-body">
        {props.signatures.map((s, idx) => (
          <div key={`${s.signedBy}-${s.dateSigned}-${idx}`} className="hv-signature-card">
            <img src={s.signatureImageUrl} alt={`Signature by ${s.signedBy}`} className="hv-signature-img" />
            <div className="hv-signature-meta">
              <div className="hv-signature-name">{s.signedBy}</div>
              <div className="hv-signature-date">{new Date(s.dateSigned).toLocaleString()}</div>
              {s.comment ? <div className="hv-signature-comment">{s.comment}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
