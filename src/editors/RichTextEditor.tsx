'use client';

import html2canvas from 'html2canvas';
import mammoth from 'mammoth';
// Do not statically import html-to-docx; use dynamic import for browser compatibility
import MarkdownIt from 'markdown-it';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DocumentMode, Signature, SupportedFileType } from '../types';
import { arrayBufferToBase64 } from '../utils/fileSource';
import { sanitizeHtml } from '../utils/sanitize';

const PAGE_H = 1122; // virtual A4

export interface RichTextEditorHandle {
  save: (exportPdf?: boolean) => Promise<void>;
  requestThumbnail: (index: number) => Promise<string | undefined>;
}

export const RichTextEditor = forwardRef<
  RichTextEditorHandle,
  {
    mode: DocumentMode;
    fileType: 'docx' | 'md' | 'txt';
    fileName: string;
    arrayBuffer?: ArrayBuffer;
    locale: Record<string, string>;
    headerComponent?: React.ReactNode;
    footerComponent?: React.ReactNode;
    headerFooterEnabled: boolean;
    signatures: Signature[];
    signaturePlacements: Array<{
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      signatureImageUrl: string;
    }>;
    armedSignatureUrl: string | null;
    onPlaceSignature: (p: {
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
    }) => void;
    onSave: (
      b64: string,
      meta: {
        fileName: string;
        fileType: SupportedFileType;
        exportedAsPdf?: boolean;
        annotations?: unknown;
      },
    ) => void;
    onPageCount: (n: number) => void;
  }
>((props, ref) => {
  const readOnly = props.mode === 'view';
  const md = useMemo(
    () => new MarkdownIt({ html: false, linkify: true, breaks: true }),
    [],
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);

  const [html, setHtml] = useState('<p><br/></p>');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (props.mode === 'create') {
        setHtml('<p><br/></p>');
        return;
      }
      if (!props.arrayBuffer) { return; }
      if (props.fileType === 'docx') {
        const res = await mammoth.convertToHtml({
          arrayBuffer: props.arrayBuffer,
        });
        if (!cancelled) { setHtml(sanitizeHtml(res.value || '<p><br/></p>')); }
      } else {
        const text = new TextDecoder().decode(props.arrayBuffer);
        if (props.fileType === 'md') { setHtml(sanitizeHtml(md.render(text))); }
        else { setHtml(`<pre>${escapeHtml(text)}</pre>`); }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.arrayBuffer, props.fileType, props.mode, md]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) { return; }
    const recompute = () =>
      props.onPageCount(Math.max(1, Math.ceil(el.scrollHeight / PAGE_H)));
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html, props.headerFooterEnabled]);

  function exec(cmd: string) {
    if (readOnly) { return; }
    document.execCommand(cmd);
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!props.armedSignatureUrl) { return; }
    const scroller = scrollerRef.current;
    if (!scroller) { return; }
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const absY = scroller.scrollTop + (e.clientY - rect.top);
    const page = Math.max(1, Math.floor(absY / PAGE_H) + 1);
    const pageTop = (page - 1) * PAGE_H;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (absY - pageTop) / PAGE_H;
    props.onPlaceSignature({ page, x, y, w: 0.25, h: 0.1 });
  }

  async function requestThumbnail(index: number): Promise<string | undefined> {
    const scroller = scrollerRef.current;
    const capture = captureRef.current;
    if (!scroller || !capture) { return undefined; }
    const old = scroller.scrollTop;
    scroller.scrollTop = index * PAGE_H;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      const canvas = await html2canvas(capture, {
        backgroundColor: null,
        scale: 0.25,
        useCORS: true,
      });
      return canvas.toDataURL('image/png');
    } catch {
      return undefined;
    } finally {
      scroller.scrollTop = old;
    }
  }

  async function save(exportPdf?: boolean) {
    const inner = editorRef.current?.innerHTML ?? html;
    const stitched = `<!doctype html><html><head><meta charset="utf-8" /></head><body>${inner}</body></html>`;

    if (exportPdf) {
      // client-side: return print-ready HTML as base64
      const b64 = btoa(unescape(encodeURIComponent(stitched)));
      props.onSave(b64, {
        fileName: replaceExt(props.fileName, 'html'),
        fileType: 'txt',
        exportedAsPdf: true,
        annotations: { signaturePlacements: props.signaturePlacements },
      });
      return;
    }

    if (props.fileType === 'docx') {
      // Use API route for DOCX export (browser-safe)
      try {
        const response = await fetch('/api/export-docx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            html: stitched,
            fileName: replaceExt(props.fileName, 'docx'),
          }),
        });
        if (!response.ok) { throw new Error('Failed to generate DOCX'); }
        const blob = await response.blob();
        // Download the file directly
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = replaceExt(props.fileName, 'docx');
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
          a.remove();
        }, 100);
      } catch (err) {
        alert(
          'DOCX export failed: ' +
            (err instanceof Error ? err.message : String(err)),
        );
      }
      return;
    }

    const text = editorRef.current?.innerText ?? '';
    const b64 = btoa(unescape(encodeURIComponent(text)));
    props.onSave(b64, {
      fileName: replaceExt(props.fileName, props.fileType),
      fileType: props.fileType,
      annotations: { signaturePlacements: props.signaturePlacements },
    });
  }

  useImperativeHandle(ref, () => ({ save, requestThumbnail }));

  return (
    <div className="hv-doc">
      <div className="hv-ribbon" role="toolbar">
        <button
          className="hv-btn"
          onClick={() => exec('bold')}
          disabled={readOnly}
        >
          B
        </button>
        <button
          className="hv-btn"
          onClick={() => exec('italic')}
          disabled={readOnly}
        >
          I
        </button>
        <button
          className="hv-btn"
          onClick={() => exec('underline')}
          disabled={readOnly}
        >
          U
        </button>
        {props.armedSignatureUrl ? (
          <div className="hv-hint">Click to place signature</div>
        ) : null}
      </div>

      <div className="hv-scroll" ref={scrollerRef} onClick={onClick}>
        <div className="hv-pageStage" ref={captureRef}>
          {props.headerFooterEnabled && props.headerComponent ? (
            <div className="hv-letterhead">{props.headerComponent}</div>
          ) : null}

          <div
            ref={editorRef}
            className={readOnly ? 'hv-editor hv-editor--ro' : 'hv-editor'}
            contentEditable={!readOnly}
            suppressContentEditableWarning
            onInput={() => setHtml(editorRef.current?.innerHTML ?? '')}
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {props.headerFooterEnabled && props.footerComponent ? (
            <div className="hv-letterhead hv-letterhead--footer">
              {props.footerComponent}
            </div>
          ) : null}

          {props.mode === 'create' && props.signatures.length ? (
            <div className="hv-signatures-inline">
              {props.signatures.map((s, i) => (
                <div key={i} className="hv-sign-inline">
                  <img
                    src={s.signatureImageUrl}
                    alt=""
                    className="hv-sign-img"
                  />
                  <div>
                    <div className="hv-sign-name">{s.signedBy}</div>
                    <div className="hv-sign-date">
                      {new Date(s.dateSigned).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

function replaceExt(name: string, ext: string) {
  const base = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  return `${base}.${ext}`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
