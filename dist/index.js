// src/components/DocumentViewer.tsx
import { useEffect as useEffect6, useMemo as useMemo6, useRef as useRef3, useState as useState6 } from "react";

// src/editors/RichTextEditor.tsx
import html2canvas from "html2canvas";
import mammoth from "mammoth";
import MarkdownIt from "markdown-it";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef
} from "react";

// src/utils/sanitize.ts
import DOMPurify from "dompurify";
function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"]
  });
}

// src/editors/RichTextEditor.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var PAGE_H = 1122;
var RichTextEditor = forwardRef(
  (props, ref) => {
    const readOnly = props.mode === "view";
    const md = useMemo(
      () => new MarkdownIt({ html: false, linkify: true, breaks: true }),
      []
    );
    const scrollerRef = useRef(null);
    const editorRef = useRef(null);
    const captureRef = useRef(null);
    const initialized = useRef(false);
    useEffect(() => {
      if (initialized.current) return;
      (async () => {
        if (props.mode === "create") {
          editorRef.current.innerHTML = "<p><br/></p>";
          initialized.current = true;
          return;
        }
        if (!props.arrayBuffer) return;
        if (props.fileType === "docx") {
          const res = await mammoth.convertToHtml({
            arrayBuffer: props.arrayBuffer
          });
          editorRef.current.innerHTML = sanitizeHtml(
            res.value || "<p><br/></p>"
          );
        } else {
          const text = new TextDecoder().decode(props.arrayBuffer);
          editorRef.current.innerHTML = props.fileType === "md" ? sanitizeHtml(md.render(text)) : `<pre>${escapeHtml(text)}</pre>`;
        }
        initialized.current = true;
      })();
    }, [props.arrayBuffer, props.fileType, props.mode, md]);
    useEffect(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const recompute = () => props.onPageCount(Math.max(1, Math.ceil(el.scrollHeight / PAGE_H)));
      recompute();
      const ro = new ResizeObserver(recompute);
      ro.observe(el);
      return () => ro.disconnect();
    }, [props.headerFooterEnabled]);
    function exec(cmd) {
      if (readOnly) return;
      document.execCommand(cmd);
      editorRef.current?.focus();
    }
    function onClickPage(e) {
      if (!props.armedSignatureUrl) return;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const absY = scroller.scrollTop + (e.clientY - rect.top);
      const page = Math.floor(absY / PAGE_H) + 1;
      props.onPlaceSignature({
        page,
        x: (e.clientX - rect.left) / rect.width,
        y: absY % PAGE_H / PAGE_H,
        w: 0.25,
        h: 0.1
      });
    }
    async function requestThumbnail(index) {
      const scroller = scrollerRef.current;
      const capture = captureRef.current;
      if (!scroller || !capture) return;
      const old = scroller.scrollTop;
      scroller.scrollTop = index * PAGE_H;
      await new Promise((r) => requestAnimationFrame(r));
      try {
        const canvas = await html2canvas(capture, {
          scale: 0.25,
          useCORS: true
        });
        return canvas.toDataURL("image/png");
      } finally {
        scroller.scrollTop = old;
      }
    }
    async function save(exportPdf) {
      const html = editorRef.current?.innerHTML ?? "";
      const stitched = `<!doctype html><html><body>${html}</body></html>`;
      const b64 = btoa(unescape(encodeURIComponent(stitched)));
      props.onSave(b64, {
        fileName: props.fileName,
        fileType: props.fileType,
        exportedAsPdf: exportPdf,
        annotations: { signaturePlacements: props.signaturePlacements }
      });
    }
    useImperativeHandle(ref, () => ({
      save,
      requestThumbnail
    }));
    return /* @__PURE__ */ jsxs("div", { className: "hv-root", children: [
      /* @__PURE__ */ jsxs("div", { className: "hv-toolbar", children: [
        /* @__PURE__ */ jsx("button", { onClick: () => exec("bold"), disabled: readOnly, children: "B" }),
        /* @__PURE__ */ jsx("button", { onClick: () => exec("italic"), disabled: readOnly, children: "I" }),
        /* @__PURE__ */ jsx("button", { onClick: () => exec("underline"), disabled: readOnly, children: "U" }),
        props.armedSignatureUrl && /* @__PURE__ */ jsx("span", { className: "hv-hint", children: "Click page to place signature" })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "hv-scroll", ref: scrollerRef, onClick: onClickPage, children: /* @__PURE__ */ jsx("div", { className: "hv-pageStage", ref: captureRef, children: /* @__PURE__ */ jsx(
        "div",
        {
          ref: editorRef,
          className: `hv-editor ${readOnly ? "ro" : ""}`,
          contentEditable: !readOnly,
          suppressContentEditableWarning: true
        }
      ) }) })
    ] });
  }
);
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

// src/editors/SpreadsheetEditor.tsx
import { forwardRef as forwardRef2, useEffect as useEffect2, useImperativeHandle as useImperativeHandle2, useMemo as useMemo2, useState as useState2 } from "react";
import * as XLSX from "xlsx";

// src/utils/fileSource.ts
function guessFileType(name, explicit) {
  if (explicit) {
    return explicit;
  }
  const ext = (name?.split(".").pop() || "").toLowerCase();
  const allowed = [
    "pdf",
    "md",
    "docx",
    "xlsx",
    "pptx",
    "txt",
    "png",
    "jpg",
    "svg"
  ];
  return allowed.includes(ext) ? ext : "txt";
}
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
async function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}
async function resolveSource(args) {
  const fileType = guessFileType(args.fileName, args.fileType);
  const fileName = args.fileName ?? `document.${fileType}`;
  if (args.blob) {
    const ab = await args.blob.arrayBuffer();
    const url = URL.createObjectURL(args.blob);
    return { fileType, fileName, arrayBuffer: ab, url };
  }
  if (args.base64) {
    const ab = await base64ToArrayBuffer(args.base64);
    return { fileType, fileName, arrayBuffer: ab };
  }
  if (!args.fileUrl) {
    throw new Error("No file source provided. Use fileUrl, blob, or base64.");
  }
  const res = await fetch(args.fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch file (${res.status})`);
  }
  const total = Number(res.headers.get("content-length") || "") || void 0;
  if (!res.body) {
    const ab = await res.arrayBuffer();
    args.onProgress?.(ab.byteLength, total);
    return { fileType, fileName, arrayBuffer: ab, url: args.fileUrl };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      loaded += value.length;
      args.onProgress?.(loaded, total);
    }
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return { fileType, fileName, arrayBuffer: out.buffer, url: args.fileUrl };
}

// src/editors/SpreadsheetEditor.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var SpreadsheetEditor = forwardRef2(function SpreadsheetEditor2(props, ref) {
  const readonly = props.mode === "view";
  const [grid, setGrid] = useState2(() => Array.from({ length: 30 }, () => Array.from({ length: 12 }, () => "")));
  useEffect2(() => {
    if (!props.arrayBuffer) {
      return;
    }
    try {
      const wb = XLSX.read(props.arrayBuffer, { type: "array" });
      const name = wb.SheetNames[0];
      const ws = wb.Sheets[name];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      const rows = Math.max(30, aoa.length);
      const cols2 = Math.max(12, Math.max(...aoa.map((r) => r?.length ?? 0), 0));
      const next = Array.from({ length: rows }, (_, r) => Array.from({ length: cols2 }, (_2, c) => {
        const v = aoa[r]?.[c];
        return v == null ? "" : String(v);
      }));
      setGrid(next);
    } catch {
    }
  }, [props.arrayBuffer]);
  async function save(exportPdf) {
    const ws = XLSX.utils.aoa_to_sheet(grid);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const b64 = arrayBufferToBase64(out);
    props.onSave(b64, { fileName: ensureExt(props.fileName, "xlsx"), fileType: "xlsx", exportedAsPdf: !!exportPdf });
  }
  useImperativeHandle2(ref, () => ({
    save,
    requestThumbnails: async () => void 0
  }));
  const cols = useMemo2(() => Array.from({ length: grid[0]?.length ?? 0 }, (_, i) => String.fromCharCode(65 + i % 26)), [grid]);
  return /* @__PURE__ */ jsxs2("div", { className: "hv-sheet", children: [
    /* @__PURE__ */ jsxs2("div", { className: "hv-sheetbar", children: [
      /* @__PURE__ */ jsx2("div", { className: "hv-sheetbar-title", children: props.fileName }),
      !readonly ? /* @__PURE__ */ jsx2("button", { className: "hv-btn", type: "button", onClick: () => void save(false), children: props.locale["toolbar.save"] ?? "Save" }) : null
    ] }),
    /* @__PURE__ */ jsxs2("div", { className: "hv-sheetgrid", role: "table", "aria-label": "Spreadsheet", children: [
      /* @__PURE__ */ jsxs2("div", { className: "hv-sheetrow hv-sheetrow--header", role: "row", children: [
        /* @__PURE__ */ jsx2("div", { className: "hv-sheetcell hv-sheetcell--corner", role: "columnheader" }),
        cols.map((c, i) => /* @__PURE__ */ jsx2("div", { className: "hv-sheetcell hv-sheetcell--header", role: "columnheader", children: c }, i))
      ] }),
      grid.map((row, r) => /* @__PURE__ */ jsxs2("div", { className: "hv-sheetrow", role: "row", children: [
        /* @__PURE__ */ jsx2("div", { className: "hv-sheetcell hv-sheetcell--header", role: "rowheader", children: r + 1 }),
        row.map((val, c) => /* @__PURE__ */ jsx2(
          "div",
          {
            className: "hv-sheetcell",
            role: "cell",
            contentEditable: !readonly,
            suppressContentEditableWarning: true,
            onInput: (e) => {
              const text = e.currentTarget.textContent ?? "";
              setGrid((prev) => {
                const next = prev.map((rr) => rr.slice());
                next[r][c] = text;
                return next;
              });
            },
            children: val
          },
          c
        ))
      ] }, r))
    ] })
  ] });
});
function ensureExt(name, ext) {
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${base}.${ext}`;
}

// src/renderers/ImageRenderer.tsx
import { useEffect as useEffect3, useMemo as useMemo3, useState as useState3 } from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function ImageRenderer({
  arrayBuffer,
  fileType,
  fileName
}) {
  const [zoom, setZoom] = useState3(1);
  const url = useMemo3(() => {
    if (!arrayBuffer) {
      return void 0;
    }
    const mime = fileType === "svg" ? "image/svg+xml" : fileType === "png" ? "image/png" : "image/jpeg";
    return URL.createObjectURL(new Blob([arrayBuffer], { type: mime }));
  }, [arrayBuffer, fileType]);
  useEffect3(() => {
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [url]);
  return /* @__PURE__ */ jsxs3("div", { className: "hv-doc", children: [
    /* @__PURE__ */ jsxs3("div", { className: "hv-mini-toolbar", children: [
      /* @__PURE__ */ jsx3("div", { className: "hv-title", children: fileName }),
      /* @__PURE__ */ jsx3("div", { className: "hv-spacer" }),
      /* @__PURE__ */ jsx3(
        "button",
        {
          type: "button",
          className: "hv-btn",
          onClick: () => setZoom((z) => Math.max(0.25, z - 0.25)),
          children: "-"
        }
      ),
      /* @__PURE__ */ jsxs3("div", { className: "hv-zoom", children: [
        Math.round(zoom * 100),
        "%"
      ] }),
      /* @__PURE__ */ jsx3(
        "button",
        {
          type: "button",
          className: "hv-btn",
          onClick: () => setZoom((z) => Math.min(4, z + 0.25)),
          children: "+"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs3("div", { className: "hv-center", children: [
      !arrayBuffer && /* @__PURE__ */ jsx3("div", { className: "hv-error", children: "No image data provided." }),
      arrayBuffer && !url && /* @__PURE__ */ jsx3("div", { className: "hv-error", children: "Failed to load image." }),
      url && /* @__PURE__ */ jsx3(
        "img",
        {
          src: url,
          alt: fileName,
          style: { transform: `scale(${zoom})` },
          className: "hv-image"
        }
      )
    ] })
  ] });
}

// src/renderers/PdfRenderer.tsx
import {
  getDocument,
  GlobalWorkerOptions
} from "pdfjs-dist";
import { useEffect as useEffect4, useMemo as useMemo4, useRef as useRef2, useState as useState4 } from "react";
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function PdfRenderer(props) {
  const { url, arrayBuffer } = props;
  const [doc, setDoc] = useState4(null);
  const [pageCount, setPageCount] = useState4(0);
  const [rendered, setRendered] = useState4(
    /* @__PURE__ */ new Map()
  );
  const [thumbs, setThumbs] = useState4([]);
  const [size, setSize] = useState4({ w: 840, h: 1188 });
  const [error, setError] = useState4(null);
  const [loading, setLoading] = useState4(false);
  const containerRef = useRef2(null);
  useEffect4(() => {
    try {
      GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
    } catch {
    }
  }, []);
  useEffect4(() => {
    let cancel = false;
    setError(null);
    setLoading(true);
    (async () => {
      setDoc(null);
      setRendered(/* @__PURE__ */ new Map());
      setThumbs([]);
      if (!url && !arrayBuffer) {
        setError("No PDF source provided.");
        setLoading(false);
        return;
      }
      try {
        const task = getDocument(
          url ? { url, rangeChunkSize: 512 * 1024 } : { data: arrayBuffer }
        );
        const pdf = await task.promise;
        if (cancel) {
          return;
        }
        setDoc(pdf);
        setPageCount(pdf.numPages);
        props.onPageCount(pdf.numPages);
        const p1 = await pdf.getPage(1);
        const base = p1.getViewport({ scale: 1 });
        const w = Math.min(980, Math.max(640, base.width));
        const s = w / base.width;
        const vp = p1.getViewport({ scale: s });
        setSize({ w: Math.round(vp.width), h: Math.round(vp.height) });
        const thumbWidth = 56;
        const thumbsArr = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const pageBase = page.getViewport({ scale: 1 });
          const thumbScale = thumbWidth / pageBase.width;
          const thumbVp = page.getViewport({ scale: thumbScale });
          const thumbCanvas = document.createElement("canvas");
          thumbCanvas.width = Math.round(thumbVp.width);
          thumbCanvas.height = Math.round(thumbVp.height);
          const thumbCtx = thumbCanvas.getContext("2d", { alpha: false });
          if (thumbCtx) {
            await page.render({ canvasContext: thumbCtx, viewport: thumbVp }).promise;
            thumbsArr.push(thumbCanvas.toDataURL("image/png"));
          } else {
            thumbsArr.push(void 0);
          }
        }
        setThumbs(thumbsArr);
      } catch (e) {
        setError(
          "Failed to load PDF. " + (e instanceof Error ? e.message : "")
        );
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [url, arrayBuffer]);
  useEffect4(() => {
    props.onThumbs(thumbs);
  }, [thumbs]);
  const pagesToShow = useMemo4(() => {
    if (props.layout === "side-by-side" && pageCount > 1) {
      const left = Math.max(1, Math.min(props.currentPage, pageCount));
      const right = Math.max(1, Math.min(left + 1, pageCount));
      return left === right ? [left] : [left, right];
    }
    return [Math.max(1, Math.min(props.currentPage, pageCount))];
  }, [props.currentPage, props.layout, pageCount]);
  useEffect4(() => {
    if (!doc) {
      return;
    }
    let cancel = false;
    (async () => {
      for (const p of pagesToShow) {
        if (rendered.has(p)) {
          continue;
        }
        try {
          const page = await doc.getPage(p);
          if (cancel) {
            return;
          }
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: size.w / base.width });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(vp.width);
          canvas.height = Math.round(vp.height);
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) {
            continue;
          }
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          if (cancel) {
            return;
          }
          setRendered((prev) => {
            const next = new Map(prev);
            next.set(p, canvas);
            return next;
          });
        } catch {
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [doc, pagesToShow, size.w, rendered]);
  function onWheel(e) {
    if (!pageCount) {
      return;
    }
    if (Math.abs(e.deltaY) < 10) {
      return;
    }
    const dir = e.deltaY > 0 ? 1 : -1;
    const step = props.layout === "side-by-side" ? 2 : 1;
    const next = Math.max(
      1,
      Math.min(pageCount, props.currentPage + dir * step)
    );
    props.onCurrentPageChange(next);
  }
  function clickPlace(e, page) {
    const stamp = props.signatureStamp;
    if (!stamp?.armed) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    stamp.onPlaced({ page, x, y, w: 0.22, h: 0.08 });
  }
  return /* @__PURE__ */ jsxs4("div", { className: "hv-doc", ref: containerRef, onWheel, children: [
    !doc ? /* @__PURE__ */ jsx4("div", { className: "hv-loading", children: "Loading PDF\u2026" }) : null,
    doc ? /* @__PURE__ */ jsx4(
      "div",
      {
        className: props.layout === "side-by-side" ? "hv-pages hv-pages--two" : "hv-pages",
        children: pagesToShow.map((p) => {
          const c = rendered.get(p);
          return /* @__PURE__ */ jsx4(
            "div",
            {
              className: "hv-page",
              style: { width: size.w, height: size.h },
              onClick: (e) => clickPlace(e, p),
              children: c ? /* @__PURE__ */ jsx4(
                "canvas",
                {
                  className: "hv-canvas",
                  width: c.width,
                  height: c.height,
                  ref: (node) => {
                    if (!node) {
                      return;
                    }
                    const ctx = node.getContext("2d");
                    if (ctx) {
                      ctx.drawImage(c, 0, 0);
                    }
                  }
                }
              ) : /* @__PURE__ */ jsx4("div", { className: "hv-loading", children: "Rendering\u2026" })
            },
            p
          );
        })
      }
    ) : null
  ] });
}

// src/renderers/PptxRenderer.tsx
import { useEffect as useEffect5, useMemo as useMemo5, useState as useState5 } from "react";
import JSZip from "jszip";
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function decodeXml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function extractText(xml) {
  return [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((m) => decodeXml(m[1] || "")).join(" ").trim();
}
function PptxRenderer(props) {
  const [slides, setSlides] = useState5([]);
  const [thumbs, setThumbs] = useState5([]);
  const [error, setError] = useState5(null);
  const [loading, setLoading] = useState5(false);
  useEffect5(() => {
    let cancel = false;
    setError(null);
    setLoading(true);
    (async () => {
      setSlides([]);
      setThumbs([]);
      if (!props.arrayBuffer) {
        setError("No PPTX source provided.");
        setLoading(false);
        return;
      }
      try {
        const zip = await JSZip.loadAsync(props.arrayBuffer);
        const slidePaths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort();
        const slidesOut = [];
        for (let i = 0; i < slidePaths.length; i++) {
          const xml = await zip.files[slidePaths[i]].async("string");
          slidesOut.push({ index: i + 1, text: extractText(xml) });
        }
        if (cancel) return;
        setSlides(
          slidesOut.length ? slidesOut : [{ index: 1, text: "(empty)" }]
        );
        props.onSlideCount(slidesOut.length || 1);
        const thumbWidth = 56;
        const thumbsArr = [];
        for (let i = 0; i < (slidesOut.length || 1); i++) {
          thumbsArr.push(
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgThumb(i + 1))}`
          );
        }
        setThumbs(thumbsArr);
      } catch (e) {
        setSlides([
          { index: 1, text: "Unable to render this .pptx in-browser." }
        ]);
        setThumbs([void 0]);
        setError(
          "Failed to load PPTX. " + (e instanceof Error ? e.message : "")
        );
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [props.arrayBuffer]);
  useEffect5(() => {
    props.onThumbs(thumbs);
  }, [thumbs]);
  const pagesToShow = useMemo5(() => {
    const total = slides.length;
    if (props.layout === "side-by-side" && total > 1) {
      const left = Math.max(1, Math.min(props.currentPage, total));
      const right = Math.max(1, Math.min(left + 1, total));
      return left === right ? [left] : [left, right];
    }
    return [Math.max(1, Math.min(props.currentPage, total))];
  }, [props.currentPage, props.layout, slides.length]);
  return /* @__PURE__ */ jsxs5("div", { className: "hv-doc", children: [
    loading && /* @__PURE__ */ jsx5("div", { className: "hv-loading", children: "Loading PPTX\u2026" }),
    error && /* @__PURE__ */ jsx5("div", { className: "hv-error", children: error }),
    !loading && !error && (!slides || slides.length === 0) && /* @__PURE__ */ jsx5("div", { className: "hv-error", children: "No slides to display." }),
    !error && slides && slides.length > 0 && /* @__PURE__ */ jsx5(
      "div",
      {
        className: props.layout === "side-by-side" ? "hv-pages hv-pages--two" : "hv-pages",
        children: pagesToShow.map((p) => {
          const s = slides[p - 1];
          return /* @__PURE__ */ jsxs5(
            "div",
            {
              className: "hv-slide",
              tabIndex: 0,
              onFocus: () => props.onCurrentPageChange(p),
              children: [
                /* @__PURE__ */ jsxs5("div", { className: "hv-slide-title", children: [
                  "Slide ",
                  p
                ] }),
                /* @__PURE__ */ jsx5("div", { className: "hv-slide-text", children: s?.text || "" })
              ]
            },
            p
          );
        })
      }
    )
  ] });
}
function svgThumb(n) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><rect width="100%" height="100%" rx="12" fill="#111827"/><text x="50%" y="54%" font-size="18" fill="#e5e7eb" text-anchor="middle">${n}</text></svg>`;
}

// src/utils/locale.ts
var defaultLocale = {
  "loading": "Loading\u2026",
  "error.title": "Error",
  "toolbar.layout.single": "Single page",
  "toolbar.layout.two": "Side-by-side",
  "toolbar.thumbs": "Thumbnails",
  "toolbar.signatures": "Signatures",
  "toolbar.sign": "Sign Document",
  "toolbar.save": "Save",
  "toolbar.exportPdf": "Export as PDF",
  "thumbnails.title": "Thumbnails",
  "thumbnails.page": "Page",
  "signatures.title": "Signatures",
  "signatures.empty": "No signatures",
  "signatures.placeHint": "Click on the document to place the signature.",
  "a11y.viewer": "Document viewer",
  "a11y.ribbon": "Ribbon",
  "a11y.editor": "Document editor"
};

// src/components/SignaturePanel.tsx
import React6 from "react";
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
function SignaturePanel(props) {
  const title = props.locale["signatures.title"] ?? "Signatures";
  const deduped = React6.useMemo(() => {
    const seen = /* @__PURE__ */ new Set();
    return props.signatures.filter((s) => {
      const key = `${s.signedBy}|${s.dateSigned}|${s.signatureImageUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [props.signatures]);
  return /* @__PURE__ */ jsxs6(
    "aside",
    {
      className: props.collapsed ? "hv-side hv-side--collapsed" : "hv-side",
      "aria-label": title,
      children: [
        /* @__PURE__ */ jsxs6("div", { className: "hv-sidebar-header", children: [
          /* @__PURE__ */ jsx6(
            "button",
            {
              type: "button",
              className: "hv-icon",
              onClick: props.onToggle,
              "aria-label": props.locale["toolbar.signatures"] ?? "Signatures",
              children: /* @__PURE__ */ jsx6("span", { "aria-hidden": true, children: "\u270D" })
            }
          ),
          /* @__PURE__ */ jsx6("div", { className: "hv-sidebar-title", children: title })
        ] }),
        /* @__PURE__ */ jsxs6("div", { className: "hv-sidebar-body", children: [
          deduped.length === 0 && /* @__PURE__ */ jsx6("div", { className: "hv-signature-empty", "aria-live": "polite", children: props.locale["signatures.empty"] ?? "No signatures yet." }),
          deduped.map((s, idx) => /* @__PURE__ */ jsxs6(
            "div",
            {
              className: "hv-signature-card",
              tabIndex: 0,
              "aria-label": `Signature by ${s.signedBy}`,
              children: [
                /* @__PURE__ */ jsx6(
                  "img",
                  {
                    src: s.signatureImageUrl,
                    alt: props.locale["signatures.imgAlt"] ? props.locale["signatures.imgAlt"].replace(
                      "{name}",
                      s.signedBy
                    ) : `Signature by ${s.signedBy}`,
                    className: "hv-signature-img"
                  }
                ),
                /* @__PURE__ */ jsxs6("div", { className: "hv-signature-meta", children: [
                  /* @__PURE__ */ jsx6("div", { className: "hv-signature-name", children: s.signedBy }),
                  /* @__PURE__ */ jsx6("div", { className: "hv-signature-date", children: new Date(s.dateSigned).toLocaleString() }),
                  s.comment ? /* @__PURE__ */ jsx6("div", { className: "hv-signature-comment", children: s.comment }) : null
                ] })
              ]
            },
            `${s.signedBy}-${s.dateSigned}-${s.signatureImageUrl}`
          ))
        ] })
      ]
    }
  );
}

// src/components/ThumbnailsSidebar.tsx
import { jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
function ThumbnailsSidebar(props) {
  const t = props.locale["thumbnails.title"] ?? "Thumbnails";
  return /* @__PURE__ */ jsxs7(
    "aside",
    {
      className: props.collapsed ? "hv-thumbs hv-thumbs--collapsed" : "hv-thumbs",
      "aria-label": t,
      children: [
        /* @__PURE__ */ jsxs7("div", { className: "hv-thumbs-header", children: [
          /* @__PURE__ */ jsx7(
            "button",
            {
              type: "button",
              className: "hv-thumbs-toggle",
              onClick: props.onToggle,
              "aria-label": props.collapsed ? props.locale["thumbnails.open"] ?? "Open thumbnails" : props.locale["thumbnails.close"] ?? "Close thumbnails",
              children: /* @__PURE__ */ jsx7("span", { className: "hv-thumbs-toggle-icon", children: props.collapsed ? "\u25B8" : "\u25BE" })
            }
          ),
          !props.collapsed && /* @__PURE__ */ jsx7("div", { className: "hv-thumbs-title", children: t })
        ] }),
        !props.collapsed && /* @__PURE__ */ jsx7("div", { className: "hv-thumbs-list", role: "list", children: props.thumbnails.map((th, idx) => {
          const p = idx + 1;
          const active = p === props.currentPage;
          return /* @__PURE__ */ jsxs7(
            "button",
            {
              type: "button",
              role: "listitem",
              className: active ? "hv-thumb hv-thumb--active" : "hv-thumb",
              onClick: () => props.onSelectPage(p),
              "aria-current": active ? "page" : void 0,
              tabIndex: 0,
              children: [
                /* @__PURE__ */ jsx7("div", { className: "hv-thumb-img", "aria-hidden": true, children: th.dataUrl ? /* @__PURE__ */ jsx7("img", { src: th.dataUrl, alt: "" }) : /* @__PURE__ */ jsx7("div", { className: "hv-thumb-placeholder" }) }),
                /* @__PURE__ */ jsx7("div", { className: "hv-thumb-label", children: th.label })
              ]
            },
            th.id
          );
        }) })
      ]
    }
  );
}

// src/components/Toolbar.tsx
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
function Toolbar(props) {
  const t = (k, fallback) => props.locale[k] ?? fallback;
  return /* @__PURE__ */ jsxs8(
    "div",
    {
      className: "hv-toolbar",
      role: "toolbar",
      "aria-label": t("a11y.toolbar", "Document toolbar"),
      children: [
        /* @__PURE__ */ jsxs8("div", { className: "hv-toolbar__left space-x-1", children: [
          /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              className: "hv-btn text-sm",
              onClick: props.onToggleThumbnails,
              "aria-pressed": props.showThumbnails,
              children: t("toolbar.thumbs", "Thumbnails")
            }
          ),
          props.mode !== "create" && /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              className: "hv-btn text-sm",
              onClick: props.onToggleSignatures,
              "aria-pressed": props.showSignatures,
              children: t("toolbar.signatures", "Signatures")
            }
          ),
          /* @__PURE__ */ jsx8("span", { className: "hv-sep" }),
          /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              className: props.layout === "single" ? "hv-btn hv-btn--active text-sm" : "hv-btn text-sm",
              onClick: () => props.onChangeLayout("single"),
              children: t("toolbar.layout.single", "Single")
            }
          ),
          /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              className: props.layout === "side-by-side" ? "hv-btn hv-btn--active text-sm" : "hv-btn text-sm",
              onClick: () => props.onChangeLayout("side-by-side"),
              children: t("toolbar.layout.two", "Two")
            }
          )
        ] }),
        /* @__PURE__ */ jsxs8("div", { className: "hv-toolbar__right", children: [
          props.showHeaderFooterToggle && /* @__PURE__ */ jsxs8("label", { className: "hv-toggle", children: [
            /* @__PURE__ */ jsx8(
              "input",
              {
                type: "checkbox",
                checked: props.headerFooterEnabled,
                onChange: props.onToggleHeaderFooter
              }
            ),
            /* @__PURE__ */ jsx8("span", { children: t("toolbar.letterhead", "Letterhead") })
          ] }),
          props.allowSigning && /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              className: "hv-btn hv-btn--primary text-sm",
              onClick: props.onSign,
              disabled: props.signingDisabled,
              children: t("toolbar.sign", "Sign Document")
            }
          ),
          props.canExportPdf && /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              className: "hv-btn text-sm",
              onClick: props.onExportPdf,
              children: t("toolbar.exportPdf", "Export as PDF")
            }
          ),
          props.canSave && /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              className: "hv-btn hv-btn--primary text-sm",
              onClick: props.onSave,
              children: t("toolbar.save", "Save")
            }
          )
        ] })
      ]
    }
  );
}

// src/components/DocumentViewer.tsx
import { jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
function DocumentViewer(props) {
  const mode = props.mode ?? "view";
  const theme = props.theme ?? "light";
  const locale = useMemo6(
    () => ({ ...defaultLocale, ...props.locale ?? {} }),
    [props.locale]
  );
  const [layout, setLayout] = useState6(
    props.defaultLayout ?? "single"
  );
  const [showThumbnails, setShowThumbnails] = useState6(true);
  const [showSignatures, setShowSignatures] = useState6(true);
  const [headerFooterEnabled, setHeaderFooterEnabled] = useState6(true);
  const allowSigning = props.allowSigning ?? false;
  const [signingBusy, setSigningBusy] = useState6(false);
  const [resolved, setResolved] = useState6(null);
  const [error, setError] = useState6("");
  const [pageCount, setPageCount] = useState6(1);
  const [currentPage, setCurrentPage] = useState6(1);
  const [thumbs, setThumbs] = useState6([]);
  const [localSignatures, setLocalSignatures] = useState6(
    props.signatures ?? []
  );
  useEffect6(
    () => setLocalSignatures(props.signatures ?? []),
    [props.signatures]
  );
  const [sigPlacements, setSigPlacements] = useState6([]);
  const [armedSignatureUrl, setArmedSignatureUrl] = useState6(
    null
  );
  const editorRef = useRef3(null);
  useEffect6(() => {
    let cancelled = false;
    (async () => {
      setError("");
      setResolved(null);
      setThumbs([]);
      setPageCount(1);
      setCurrentPage(1);
      setSigPlacements([]);
      setArmedSignatureUrl(null);
      if (mode === "create") {
        const ft = props.fileType ?? "docx";
        setResolved({
          fileType: ft,
          fileName: props.fileName ?? `Untitled.${ft}`
        });
        return;
      }
      try {
        const res = await resolveSource({
          fileUrl: props.fileUrl,
          base64: props.base64,
          blob: props.blob,
          fileName: props.fileName,
          fileType: props.fileType
        });
        if (cancelled) {
          return;
        }
        setResolved({
          fileType: res.fileType,
          fileName: res.fileName,
          url: res.url,
          arrayBuffer: res.arrayBuffer
        });
      } catch (e) {
        if (cancelled) {
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    mode,
    props.fileUrl,
    props.base64,
    props.blob,
    props.fileName,
    props.fileType
  ]);
  const thumbnails = useMemo6(() => {
    const n = Math.max(1, pageCount);
    return Array.from({ length: n }, (_, i) => ({
      id: `p-${i + 1}`,
      label: `${locale["thumbnails.page"] ?? "Page"} ${i + 1}`,
      dataUrl: thumbs[i]
    }));
  }, [pageCount, thumbs, locale]);
  async function handleSignRequest() {
    if (!allowSigning || signingBusy || !props.onSignRequest) {
      return;
    }
    setSigningBusy(true);
    try {
      const sig = await props.onSignRequest();
      setLocalSignatures((prev) => [...prev, sig]);
      setArmedSignatureUrl(sig.signatureImageUrl);
    } finally {
      setSigningBusy(false);
    }
  }
  function placeSignature(p) {
    if (!armedSignatureUrl) {
      return;
    }
    setSigPlacements((prev) => [
      ...prev,
      { ...p, signatureImageUrl: armedSignatureUrl }
    ]);
    setArmedSignatureUrl(null);
  }
  async function handleSave(exportPdf) {
    if (editorRef.current) {
      await editorRef.current.save(!!exportPdf);
      return;
    }
    if (!resolved?.arrayBuffer) {
      return;
    }
    const b64 = arrayBufferToBase642(resolved.arrayBuffer);
    props.onSave?.(b64, {
      fileName: resolved.fileName,
      fileType: resolved.fileType,
      annotations: { sigPlacements }
    });
  }
  const canSave = mode === "edit" || mode === "create";
  const canExportPdf = (mode === "edit" || mode === "create") && (resolved?.fileType === "docx" || resolved?.fileType === "md" || resolved?.fileType === "txt" || resolved?.fileType === "xlsx");
  return /* @__PURE__ */ jsxs9("div", { className: `hv-root`, "data-hv-theme": theme, children: [
    /* @__PURE__ */ jsx9(
      Toolbar,
      {
        locale,
        mode,
        fileType: resolved?.fileType,
        layout,
        onChangeLayout: setLayout,
        showThumbnails,
        onToggleThumbnails: () => setShowThumbnails((v) => !v),
        showSignatures,
        onToggleSignatures: () => setShowSignatures((v) => !v),
        onSign: () => void handleSignRequest(),
        allowSigning,
        signingDisabled: signingBusy || !props.onSignRequest,
        canSave,
        onSave: () => void handleSave(false),
        canExportPdf,
        onExportPdf: () => void handleSave(true),
        headerFooterEnabled,
        showHeaderFooterToggle: (props.enableHeaderFooterToggle ?? true) && mode === "create",
        onToggleHeaderFooter: () => setHeaderFooterEnabled((v) => !v)
      }
    ),
    error ? /* @__PURE__ */ jsxs9("div", { className: "hv-error", role: "alert", children: [
      /* @__PURE__ */ jsx9("div", { className: "hv-error-title", children: locale["error.title"] ?? "Error" }),
      /* @__PURE__ */ jsx9("div", { className: "hv-error-body", children: error })
    ] }) : null,
    !resolved && !error ? /* @__PURE__ */ jsx9("div", { className: "hv-loading", "aria-busy": "true", children: locale.loading ?? "Loading\u2026" }) : null,
    resolved ? /* @__PURE__ */ jsxs9("div", { className: "hv-shell", children: [
      mode !== "create" ? /* @__PURE__ */ jsx9(
        ThumbnailsSidebar,
        {
          locale,
          thumbnails,
          currentPage,
          collapsed: !showThumbnails,
          onToggle: () => setShowThumbnails((v) => !v),
          onSelectPage: setCurrentPage
        }
      ) : null,
      /* @__PURE__ */ jsxs9("main", { className: "hv-main", children: [
        resolved.fileType === "pdf" ? /* @__PURE__ */ jsx9(
          PdfRenderer,
          {
            url: resolved.url,
            arrayBuffer: resolved.arrayBuffer,
            layout,
            currentPage,
            onCurrentPageChange: setCurrentPage,
            onPageCount: (n) => {
              setPageCount(n);
              setThumbs(
                (prev) => prev.length === n ? prev : Array.from({ length: n }, (_, i) => prev[i])
              );
            },
            onThumbs: (t) => setThumbs(t),
            signatureStamp: armedSignatureUrl ? {
              imageUrl: armedSignatureUrl,
              armed: true,
              onPlaced: placeSignature
            } : void 0
          }
        ) : null,
        resolved.fileType === "docx" || resolved.fileType === "md" || resolved.fileType === "txt" ? /* @__PURE__ */ jsx9(
          RichTextEditor,
          {
            ref: editorRef,
            mode,
            fileType: resolved.fileType,
            fileName: resolved.fileName,
            arrayBuffer: resolved.arrayBuffer,
            headerComponent: props.headerComponent,
            footerComponent: props.footerComponent,
            headerFooterEnabled,
            locale,
            signatures: localSignatures,
            signaturePlacements: sigPlacements,
            onPageCount: (n) => {
              setPageCount(n);
              setThumbs(
                (prev) => prev.length === n ? prev : Array.from({ length: n }, (_, i) => prev[i])
              );
            },
            onSave: (b64, meta) => props.onSave?.(b64, meta),
            armedSignatureUrl,
            onPlaceSignature: placeSignature
          }
        ) : null,
        resolved.fileType === "xlsx" ? /* @__PURE__ */ jsx9(
          SpreadsheetEditor,
          {
            ref: editorRef,
            mode,
            fileName: resolved.fileName,
            arrayBuffer: resolved.arrayBuffer,
            locale,
            onSave: (b64, meta) => props.onSave?.(b64, meta)
          }
        ) : null,
        resolved.fileType === "pptx" ? /* @__PURE__ */ jsx9(
          PptxRenderer,
          {
            arrayBuffer: resolved.arrayBuffer,
            layout,
            currentPage,
            onCurrentPageChange: setCurrentPage,
            onSlideCount: (n) => {
              setPageCount(n);
              setThumbs(
                (prev) => prev.length === n ? prev : Array.from({ length: n }, (_, i) => prev[i])
              );
            },
            onThumbs: (t) => setThumbs(t)
          }
        ) : null,
        resolved.fileType === "png" || resolved.fileType === "jpg" || resolved.fileType === "svg" ? /* @__PURE__ */ jsx9(
          ImageRenderer,
          {
            arrayBuffer: resolved.arrayBuffer,
            fileType: resolved.fileType,
            fileName: resolved.fileName
          }
        ) : null
      ] }),
      mode !== "create" && localSignatures.length ? /* @__PURE__ */ jsx9(
        SignaturePanel,
        {
          locale,
          signatures: localSignatures,
          collapsed: !showSignatures,
          onToggle: () => setShowSignatures((v) => !v)
        }
      ) : null
    ] }) : null
  ] });
}
function arrayBufferToBase642(ab) {
  const bytes = new Uint8Array(ab);
  let binary = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
export {
  DocumentViewer
};
//# sourceMappingURL=index.js.map