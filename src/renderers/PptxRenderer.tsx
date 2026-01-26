"use client";

import React, { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import type { PageLayout } from "../types";

type Slide = {
  index: number;
  title?: string;
  body: Array<{
    text: string;
    color?: string;
    isBold?: boolean;
    isItalic?: boolean;
  }>;
  bgColor?: string;
  titleColor?: string;
};

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
  );
}

function parseColor(solidFill: Element | null): string | undefined {
  if (!solidFill) return undefined;

  const srgbClr = solidFill.getElementsByTagNameNS(NS_A, "srgbClr")[0];
  if (srgbClr) {
    const val = srgbClr.getAttribute("val");
    return val ? `#${val}` : undefined;
  }

  const schemeClr = solidFill.getElementsByTagNameNS(NS_A, "schemeClr")[0];
  if (schemeClr) {
    const val = schemeClr.getAttribute("val");
    const colorMap: Record<string, string> = {
      tx1: "#000000",
      bg1: "#FFFFFF",
      tx2: "#1F1F1F",
      accent1: "#4472C4",
      accent2: "#ED7D31",
      accent3: "#A5A5A5",
      accent4: "#FFC000",
      accent5: "#5B9BD5",
      accent6: "#70AD47",
    };
    return colorMap[val || ""] || "#000000";
  }

  return undefined;
}

function parseSlideXml(xml: string): {
  title?: string;
  titleColor?: string;
  body: Array<{
    text: string;
    color?: string;
    isBold?: boolean;
    isItalic?: boolean;
  }>;
  bgColor?: string;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  const shapes = Array.from(doc.getElementsByTagNameNS(NS_P, "sp"));
  let title: string | undefined;
  let titleColor: string | undefined;
  const body: Array<{
    text: string;
    color?: string;
    isBold?: boolean;
    isItalic?: boolean;
  }> = [];

  // Try to get background color
  let bgColor: string | undefined;
  const bgElements = doc.getElementsByTagNameNS(NS_P, "bg");
  if (bgElements.length > 0) {
    const bgPr = bgElements[0].getElementsByTagNameNS(NS_P, "bgPr")[0];
    if (bgPr) {
      const solidFill = bgPr.getElementsByTagNameNS(NS_A, "solidFill")[0];
      bgColor = parseColor(solidFill);
    }
  }

  shapes.forEach((shape) => {
    const nvSpPr = shape.getElementsByTagNameNS(NS_P, "nvSpPr")[0];
    const cNvPr = nvSpPr?.getElementsByTagNameNS(NS_P, "cNvPr")[0];
    const name = cNvPr?.getAttribute("name")?.toLowerCase() || "";

    const txBody = shape.getElementsByTagNameNS(NS_P, "txBody")[0];
    if (!txBody) return;

    const paragraphs = Array.from(txBody.getElementsByTagNameNS(NS_A, "p"));

    const isTitle =
      name.includes("title") ||
      name.includes("header") ||
      name.includes("centeredtitle");

    paragraphs.forEach((p) => {
      const runs = Array.from(p.getElementsByTagNameNS(NS_A, "r"));

      runs.forEach((run) => {
        const textEl = run.getElementsByTagNameNS(NS_A, "t")[0];
        const text = textEl?.textContent?.trim() || "";
        if (!text) return;

        const rPr = run.getElementsByTagNameNS(NS_A, "rPr")[0];
        let color: string | undefined;
        let isBold = false;
        let isItalic = false;

        if (rPr) {
          isBold = rPr.getAttribute("b") === "1";
          isItalic = rPr.getAttribute("i") === "1";

          const solidFill = rPr.getElementsByTagNameNS(NS_A, "solidFill")[0];
          color = parseColor(solidFill);
        }

        if (isTitle && !title) {
          title = text;
          titleColor = color;
        } else {
          body.push({ text, color, isBold, isItalic });
        }
      });
    });
  });

  return { title, titleColor, body, bgColor };
}

/**
 * Premium PowerPoint (.pptx) renderer with full color formatting support
 */
export function PptxRenderer(props: {
  arrayBuffer?: ArrayBuffer;
  fileName?: string;
  layout: PageLayout;
  currentPage: number;
  onCurrentPageChange: (p: number) => void;
  onSlideCount: (n: number) => void;
  onThumbs: (thumbs: (string | undefined)[]) => void;
}) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [thumbs, setThumbs] = useState<(string | undefined)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    setError(null);
    setLoading(true);
    (async () => {
      setSlides([]);
      setThumbs([]);
      if (!props.arrayBuffer) {
        setError("No PowerPoint source provided.");
        setLoading(false);
        return;
      }
      try {
        const zip = await JSZip.loadAsync(props.arrayBuffer);
        const slidePaths = Object.keys(zip.files)
          .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
          .sort();
        const slidesOut: Slide[] = [];
        for (let i = 0; i < slidePaths.length; i++) {
          const xml = await zip.files[slidePaths[i]].async("string");
          const parsed = parseSlideXml(xml);
          slidesOut.push({ index: i + 1, ...parsed });
        }
        if (cancel) return;
        setSlides(
          slidesOut.length
            ? slidesOut
            : [{ index: 1, title: "Empty Slide", body: [] }],
        );
        props.onSlideCount(slidesOut.length || 1);

        const thumbsArr: (string | undefined)[] = [];
        for (let i = 0; i < (slidesOut.length || 1); i++) {
          thumbsArr.push(
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgThumb(i + 1))}`,
          );
        }
        setThumbs(thumbsArr);
      } catch (e) {
        setSlides([
          {
            index: 1,
            title: "Error Rendering Presentation",
            body: [{ text: "Unable to render this .pptx in-browser." }],
          },
        ]);
        setThumbs([undefined]);
        setError(
          "Failed to load PPTX. " + (e instanceof Error ? e.message : ""),
        );
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [props.arrayBuffer]);

  useEffect(() => {
    props.onThumbs(thumbs);
  }, [thumbs]);

  const pagesToShow = useMemo(() => {
    const total = slides.length;
    if (props.layout === "side-by-side" && total > 1) {
      const left = Math.max(1, Math.min(props.currentPage, total));
      const right = Math.max(1, Math.min(left + 1, total));
      return left === right ? [left] : [left, right];
    }
    return [Math.max(1, Math.min(props.currentPage, total))];
  }, [props.currentPage, props.layout, slides.length]);

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 overflow-hidden">
      {/* Premium Header */}
      <div className="flex items-center justify-between px-8 py-5 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5 text-white"
            >
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              <path d="M10 9H8" />
              <path d="M16 13H8" />
              <path d="M16 17H8" />
            </svg>
          </div>
          <div className="flex flex-col">
            <h2 className="text-base font-bold text-slate-800 truncate max-w-sm">
              {props.fileName || "Presentation"}
            </h2>
            <span className="text-xs text-slate-500 font-medium">
              PowerPoint • {slides.length}{" "}
              {slides.length === 1 ? "slide" : "slides"}
            </span>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 rounded-full border border-blue-100">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 text-blue-600 animate-spin"
            >
              <path d="M12 2v20M2 12h20" />
            </svg>
            <span className="text-sm font-medium text-blue-700">
              Processing...
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-8 md:p-12 scroll-smooth">
        {error && (
          <div className="max-w-md mx-auto mt-24">
            <div className="bg-white rounded-2xl shadow-xl border border-red-100 p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/20">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-8 h-8 text-white"
                >
                  <path d="M12 2v20M2 12h20" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                Unable to Load Presentation
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {!error && slides.length > 0 && (
          <div className="flex flex-col items-center gap-16 max-w-7xl mx-auto">
            {pagesToShow.map((p) => {
              const s = slides[p - 1];
              const bgColor = s?.bgColor || "#FFFFFF";

              return (
                <div
                  key={p}
                  className="w-full group"
                  onFocus={() => props.onCurrentPageChange(p)}
                  tabIndex={0}
                >
                  <div
                    className="relative bg-white shadow-2xl rounded-2xl border border-slate-200/60 overflow-hidden aspect-[16/9] flex flex-col p-12 md:p-20 transition-all duration-500 group-hover:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.2)] group-hover:scale-[1.01]"
                    style={{ backgroundColor: bgColor }}
                  >
                    {/* Slide number badge */}
                    <div className="absolute top-6 right-6">
                      <div className="px-4 py-1.5 rounded-full bg-slate-900/90 backdrop-blur-sm border border-slate-700/50 shadow-lg">
                        <span className="text-xs font-bold text-white tracking-wider">
                          {p} / {slides.length}
                        </span>
                      </div>
                    </div>

                    {/* Premium corner decoration */}
                    <div className="absolute top-0 left-0 w-32 h-32 bg-gradient-to-br from-blue-500/5 to-transparent rounded-br-full" />
                    <div className="absolute bottom-0 right-0 w-32 h-32 bg-gradient-to-tl from-indigo-500/5 to-transparent rounded-tl-full" />

                    <div className="flex-1 flex flex-col justify-center max-w-5xl mx-auto w-full relative z-10">
                      {s?.title && (
                        <h1
                          className="text-4xl md:text-6xl font-black mb-12 leading-[1.1] tracking-tight"
                          style={{ color: s.titleColor || "#0F172A" }}
                        >
                          {s.title}
                        </h1>
                      )}

                      <div className="space-y-5">
                        {s?.body.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-5 group/item"
                          >
                            <div
                              className="mt-3 w-2 h-2 rounded-full flex-shrink-0 shadow-sm"
                              style={{
                                backgroundColor: item.color || "#94A3B8",
                              }}
                            />
                            <p
                              className={`text-xl md:text-2xl leading-relaxed transition-all ${
                                item.isBold ? "font-bold" : "font-medium"
                              } ${item.isItalic ? "italic" : ""}`}
                              style={{ color: item.color || "#475569" }}
                            >
                              {item.text}
                            </p>
                          </div>
                        ))}
                      </div>

                      {!s?.title && (!s?.body || s?.body.length === 0) && (
                        <div className="flex-1 flex flex-col items-center justify-center opacity-30 py-16">
                          <div className="w-20 h-20 mb-6 rounded-2xl bg-slate-200 flex items-center justify-center">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="w-10 h-10 text-slate-400"
                            >
                              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                              <path d="M10 9H8" />
                              <path d="M16 13H8" />
                              <path d="M16 17H8" />
                            </svg>
                          </div>
                          <p className="text-slate-400 text-lg italic">
                            No content on this slide
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Footer watermark */}
                    <div className="absolute bottom-8 left-8 opacity-10">
                      <div className="text-sm font-black text-slate-900 tracking-wider">
                        {props.fileName?.split(".")[0].toUpperCase() ||
                          "PRESENTATION"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function svgThumb(n: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#4F46E5;stop-opacity:1" /><stop offset="100%" style="stop-color:#7C3AED;stop-opacity:1" /></linearGradient></defs><rect width="100%" height="100%" rx="12" fill="url(#bg)"/><text x="50%" y="58%" font-size="24" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${n}</text></svg>`;
}
