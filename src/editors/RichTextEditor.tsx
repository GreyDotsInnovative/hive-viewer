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
import { Bold, Italic, Underline, Info } from "lucide-react";

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

    const layout = props.layout ?? "single";

    /** ----------------------------------------
     *  Thumbnail Generation Effect
     * ---------------------------------------- */
    useEffect(() => {
      if (!props.onPageCount || !props.onThumbs) return;

      const timer = setTimeout(async () => {
        const count = Math.max(
          1,
          Math.ceil((scrollerRef.current?.scrollHeight ?? 0) / PAGE_H),
        );
        props.onPageCount(count);

        const newThumbs: (string | undefined)[] = [];
        for (let i = 0; i < count; i++) {
          const thumb = await requestThumbnail(i);
          newThumbs.push(thumb);
        }
        props.onThumbs(newThumbs);
      }, 1000); // Debounce thumbnail generation

      return () => clearTimeout(timer);
    }, [props.arrayBuffer, props.fileType, props.onThumbs, layout]);

    async function requestThumbnail(index: number) {
      const scroller = scrollerRef.current;
      const capture = captureRef.current;
      if (!scroller || !capture) return;

      const old = scroller.scrollTop;
      scroller.scrollTop = index * PAGE_H;
      await new Promise((r) => requestAnimationFrame(r));

      try {
        const canvas = await html2canvas(capture, {
          scale: 0.1, // Lower scale for thumbnails
          useCORS: true,
          logging: false,
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

    const isSideBySide = layout === "side-by-side";

    return (
      <div className="flex flex-col h-full w-full bg-[#F8F9FA] overflow-hidden">
        {/* 1. Modern Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm z-10">
          <div className="flex items-center space-x-1">
            <ToolbarButton
              onClick={() => exec("bold")}
              active={false}
              disabled={readOnly}
              icon={<Bold size={18} />}
            />
            <ToolbarButton
              onClick={() => exec("italic")}
              active={false}
              disabled={readOnly}
              icon={<Italic size={18} />}
            />
            <ToolbarButton
              onClick={() => exec("underline")}
              active={false}
              disabled={readOnly}
              icon={<Underline size={18} />}
            />
          </div>

          {props.armedSignatureUrl && (
            <div className="flex items-center text-blue-600 bg-blue-50 px-3 py-1 rounded-full text-sm font-medium animate-pulse">
              <Info size={14} className="mr-2" />
              Click page to place signature
            </div>
          )}
        </div>

        {/* 2. Document Scroller */}
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden p-8 scroll-smooth"
          ref={scrollerRef}
          onClick={onClickPage}
          style={{ backgroundColor: "#E2E8F0" }} // Slightly darker background to make "paper" pop
        >
          <div
            className={`${isSideBySide ? "max-w-[1680px]" : "max-w-[816px]"} mx-auto transition-all duration-300`}
          >
            <div
              className={`bg-white shadow-[0_0_50px_rgba(0,0,0,0.1)] min-h-[1056px] origin-top mb-10 ${isSideBySide ? "columns-2 gap-12 p-[80px_60px]" : ""}`}
              ref={captureRef}
            >
              <div
                ref={editorRef}
                className={`modern-editor ${readOnly ? "ro" : "editable"}`}
                contentEditable={!readOnly}
                suppressContentEditableWarning
                style={{
                  padding: isSideBySide ? "0" : "80px 60px", // Standard document margins moved to parent in side-by-side
                  outline: "none",
                  minHeight: "1056px",
                  fontSize: "16px",
                  lineHeight: "1.6",
                  color: "#1a1a1a",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  },
);

// Helper component for cleaner code
const ToolbarButton = ({ onClick, icon, disabled }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="p-2 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-700"
  >
    {icon}
  </button>
);

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
