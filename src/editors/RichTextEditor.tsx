"use client";

import mammoth from "mammoth";
import React, { useEffect, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import type { DocumentMode, SupportedFileType } from "../types";
import { sanitizeHtml } from "../utils/sanitize";

interface RichTextEditorProps {
  mode: DocumentMode;
  arrayBuffer?: ArrayBuffer;
  fileName: string;
  // We need fileType to know how to parse (md vs docx)
  fileType?: SupportedFileType;
  layout: "single" | "side-by-side";
  currentPage: number;
  onPageCount: (n: number) => void;
  onCurrentPageChange: (p: number) => void;
  onThumbs: (thumbs: string[]) => void;
}

export function RichTextEditor(props: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [contentHtml, setContentHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Initialize Markdown parser once
  const mdParser = useRef(new MarkdownIt({ html: true, linkify: true }));

  useEffect(() => {
    const loadDoc = async () => {
      if (!props.arrayBuffer) return;
      setLoading(true);

      try {
        // 1. Handle DOCX
        if (props.fileName.endsWith(".docx") || props.fileType === "docx") {
          const result = await mammoth.convertToHtml({
            arrayBuffer: props.arrayBuffer,
          });
          setContentHtml(sanitizeHtml(result.value));
        }
        // 2. Handle Markdown / Text
        else {
          // Decode the buffer to string
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(props.arrayBuffer);

          if (props.fileName.endsWith(".md") || props.fileType === "md") {
            // Render Markdown to HTML
            const html = mdParser.current.render(text);
            setContentHtml(sanitizeHtml(html));
          } else {
            // Plain text: wrap in pre/p
            setContentHtml(
              `<pre style="white-space: pre-wrap; font-family: monospace;">${text}</pre>`,
            );
          }
        }

        props.onPageCount(1);
      } catch (err) {
        console.error("Doc Conversion failed", err);
        setContentHtml("<p style='color:red'>Error parsing document.</p>");
      } finally {
        setLoading(false);
      }
    };

    loadDoc();
  }, [props.arrayBuffer, props.fileName, props.fileType]);

  return (
    <div className="hv-view-single">
      <div className="hv-page-container">
        {loading ? (
          <div className="p-12 text-center text-gray-400">
            Processing text...
          </div>
        ) : (
          <div
            ref={editorRef}
            className="hv-docx-content"
            contentEditable={props.mode === "edit" || props.mode === "create"}
            dangerouslySetInnerHTML={{ __html: contentHtml }}
            suppressContentEditableWarning
          />
        )}
      </div>
    </div>
  );
}
