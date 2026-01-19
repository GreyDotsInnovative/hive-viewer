"use client";

import html2canvas from "html2canvas";
import mammoth from "mammoth";
import MarkdownIt from "markdown-it";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DocumentMode, Signature, SupportedFileType } from "../types";
import { sanitizeHtml } from "../utils/sanitize";

const PAGE_H = 1122;

export interface RichTextEditorHandle {
  save: (exportPdf?: boolean) => Promise<void>;
  requestThumbnail: (index: number) => Promise<string | undefined>;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, any>(
  (props, ref) => {
    const readOnly = props.mode === "view";

    const md = useMemo(
      () => new MarkdownIt({ html: false, linkify: true, breaks: true }),
      [],
    );

    const scrollerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const captureRef = useRef<HTMLDivElement>(null);

    const initialized = useRef(false);

    /** ----------------------------------------
     *  Load document ONCE
     * ---------------------------------------- */
    useEffect(() => {
      if (initialized.current) return;

      (async () => {
        if (props.mode === "create") {
          editorRef.current!.innerHTML = "<p><br/></p>";
          initialized.current = true;
          return;
        }

        if (!props.arrayBuffer) return;

        if (props.fileType === "docx") {
          const res = await mammoth.convertToHtml({
            arrayBuffer: props.arrayBuffer,
          });
          editorRef.current!.innerHTML = sanitizeHtml(
            res.value || "<p><br/></p>",
          );
        } else {
          const text = new TextDecoder().decode(props.arrayBuffer);
          editorRef.current!.innerHTML =
            props.fileType === "md"
              ? sanitizeHtml(md.render(text))
              : `<pre>${escapeHtml(text)}</pre>`;
        }

        initialized.current = true;
      })();
    }, [props.arrayBuffer, props.fileType, props.mode, md]);

    /** ----------------------------------------
     *  Page count observer
     * ---------------------------------------- */
    useEffect(() => {
      const el = scrollerRef.current;
      if (!el) return;

      const recompute = () =>
        props.onPageCount(Math.max(1, Math.ceil(el.scrollHeight / PAGE_H)));

      recompute();
      const ro = new ResizeObserver(recompute);
      ro.observe(el);
      return () => ro.disconnect();
    }, [props.headerFooterEnabled]);

    function exec(cmd: string) {
      if (readOnly) return;
      document.execCommand(cmd);
      editorRef.current?.focus();
    }

    function onClickPage(e: React.MouseEvent) {
      if (!props.armedSignatureUrl) return;
      const scroller = scrollerRef.current;
      if (!scroller) return;

      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const absY = scroller.scrollTop + (e.clientY - rect.top);
      const page = Math.floor(absY / PAGE_H) + 1;

      props.onPlaceSignature({
        page,
        x: (e.clientX - rect.left) / rect.width,
        y: (absY % PAGE_H) / PAGE_H,
        w: 0.25,
        h: 0.1,
      });
    }

    async function requestThumbnail(index: number) {
      const scroller = scrollerRef.current;
      const capture = captureRef.current;
      if (!scroller || !capture) return;

      const old = scroller.scrollTop;
      scroller.scrollTop = index * PAGE_H;
      await new Promise((r) => requestAnimationFrame(r));

      try {
        const canvas = await html2canvas(capture, {
          scale: 0.25,
          useCORS: true,
        });
        return canvas.toDataURL("image/png");
      } finally {
        scroller.scrollTop = old;
      }
    }

    async function save(exportPdf?: boolean) {
      const html = editorRef.current?.innerHTML ?? "";
      const stitched = `<!doctype html><html><body>${html}</body></html>`;
      const b64 = btoa(unescape(encodeURIComponent(stitched)));

      props.onSave(b64, {
        fileName: props.fileName,
        fileType: props.fileType,
        exportedAsPdf: exportPdf,
        annotations: { signaturePlacements: props.signaturePlacements },
      });
    }

    useImperativeHandle(ref, () => ({
      save,
      requestThumbnail,
    }));

    return (
      <div className="hv-root">
        <div className="hv-toolbar">
          <button onClick={() => exec("bold")} disabled={readOnly}>
            B
          </button>
          <button onClick={() => exec("italic")} disabled={readOnly}>
            I
          </button>
          <button onClick={() => exec("underline")} disabled={readOnly}>
            U
          </button>

          {props.armedSignatureUrl && (
            <span className="hv-hint">Click page to place signature</span>
          )}
        </div>

        <div className="hv-scroll" ref={scrollerRef} onClick={onClickPage}>
          <div className="hv-pageStage" ref={captureRef}>
            <div
              ref={editorRef}
              className={`hv-editor ${readOnly ? "ro" : ""}`}
              contentEditable={!readOnly}
              suppressContentEditableWarning
            />
          </div>
        </div>
      </div>
    );
  },
);

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
