"use client";

import React, { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import type { PageLayout } from "../types";

// --- XML Parsing Helpers (Preserved from your original code) ---
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

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

function parseSlideXml(xml: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  let title: string | undefined;
  let titleColor: string | undefined;
  let bgColor: string | undefined;

  const body: Array<{
    text: string;
    color?: string;
    isBold?: boolean;
    isItalic?: boolean;
  }> = [];

  // Background
  const bgElements = doc.getElementsByTagNameNS(NS_P, "bg");
  if (bgElements.length > 0) {
    const bgPr = bgElements[0].getElementsByTagNameNS(NS_P, "bgPr")[0];
    if (bgPr) {
      const solidFill = bgPr.getElementsByTagNameNS(NS_A, "solidFill")[0];
      bgColor = parseColor(solidFill);
    }
  }

  // Shapes & Text
  const shapes = Array.from(doc.getElementsByTagNameNS(NS_P, "sp"));
  shapes.forEach((shape) => {
    const nvSpPr = shape.getElementsByTagNameNS(NS_P, "nvSpPr")[0];
    const cNvPr = nvSpPr?.getElementsByTagNameNS(NS_P, "cNvPr")[0];
    const name = cNvPr?.getAttribute("name")?.toLowerCase() || "";

    const isTitle = name.includes("title") || name.includes("header");

    const txBody = shape.getElementsByTagNameNS(NS_P, "txBody")[0];
    if (!txBody) return;

    const paragraphs = Array.from(txBody.getElementsByTagNameNS(NS_A, "p"));
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
          color = parseColor(rPr.getElementsByTagNameNS(NS_A, "solidFill")[0]);
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

// --- Main Component ---
interface PptxRendererProps {
  arrayBuffer?: ArrayBuffer;
  fileName?: string;
  layout: PageLayout;
  currentPage: number;
  onCurrentPageChange: (p: number) => void;
  onPageCount: (n: number) => void;
  onThumbs: (thumbs: string[]) => void;
}

export function PptxRenderer(props: PptxRendererProps) {
  const [slides, setSlides] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.arrayBuffer) return;

    const loadPptx = async () => {
      try {
        const zip = await JSZip.loadAsync(props.arrayBuffer!);
        const slidePaths = Object.keys(zip.files)
          .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
          .sort((a, b) => {
            // Natural sort (slide1, slide2, slide10)
            const numA = parseInt(a.match(/\d+/)![0]);
            const numB = parseInt(b.match(/\d+/)![0]);
            return numA - numB;
          });

        const parsedSlides = [];
        for (const path of slidePaths) {
          const xml = await zip.files[path].async("string");
          parsedSlides.push(parseSlideXml(xml));
        }

        setSlides(parsedSlides);
        props.onPageCount(parsedSlides.length);

        // Generate SVG Thumbs
        const thumbs = parsedSlides.map(
          (_, i) =>
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
              `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="56"><rect width="100%" height="100%" fill="#4f46e5"/><text x="50%" y="50%" fill="white" font-size="20" text-anchor="middle" dy=".3em">${i + 1}</text></svg>`,
            )}`,
        );
        props.onThumbs(thumbs);
      } catch (err: any) {
        setError(err.message || "Failed to parse PPTX");
      }
    };

    loadPptx();
  }, [props.arrayBuffer]);

  const pagesToShow = useMemo(() => {
    if (slides.length === 0) return [];
    const validPage = Math.max(1, Math.min(props.currentPage, slides.length));

    if (props.layout === "side-by-side" && slides.length > 1) {
      if (validPage === 1) return [1];
      const left = validPage % 2 === 0 ? validPage : validPage - 1;
      return [left, left + 1].filter((p) => p <= slides.length);
    }
    return [validPage];
  }, [slides.length, props.currentPage, props.layout]);

  if (error) return <div className="text-red-500 p-8 text-center">{error}</div>;

  return (
    <div
      className={
        props.layout === "side-by-side" ? "hv-view-double" : "hv-view-single"
      }
    >
      {pagesToShow.map((p) => {
        const slide = slides[p - 1];
        if (!slide) return null;

        return (
          <div
            key={p}
            className="hv-page-container"
            style={{
              width: "960px", // Standard HD slide width
              aspectRatio: "16/9",
              padding: "48px",
              backgroundColor: slide.bgColor || "#ffffff",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              position: "relative", // For absolute positioning if we added it later
            }}
          >
            {/* Slide Title */}
            {slide.title && (
              <h1
                style={{
                  fontSize: "42px",
                  marginBottom: "32px",
                  fontWeight: "bold",
                  color: slide.titleColor || "#1a202c",
                  lineHeight: 1.2,
                }}
              >
                {slide.title}
              </h1>
            )}

            {/* Slide Body */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              {slide.body.map((item: any, i: number) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      background: item.color || "#cbd5e1",
                      borderRadius: "50%",
                      marginTop: "12px",
                      flexShrink: 0,
                    }}
                  />
                  <p
                    style={{
                      fontSize: "24px",
                      color: item.color || "#4a5568",
                      fontWeight: item.isBold ? "bold" : "normal",
                      fontStyle: item.isItalic ? "italic" : "normal",
                      margin: 0,
                    }}
                  >
                    {item.text}
                  </p>
                </div>
              ))}
            </div>

            {/* Slide Footer Number */}
            <div
              style={{
                position: "absolute",
                bottom: "20px",
                right: "30px",
                color: "#cbd5e1",
                fontWeight: "bold",
              }}
            >
              {p}
            </div>
          </div>
        );
      })}
    </div>
  );
}
