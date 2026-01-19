'use client';

import JSZip from 'jszip';
import React, { useEffect, useMemo, useState } from 'react';
import type { PageLayout } from '../types';

interface Slide { index: number; text: string }

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'');
}

function extractText(xml: string) {
  return [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)]
    .map((m) => decodeXml(m[1] || ''))
    .join(' ')
    .trim();
}

/**
 * PowerPoint (.pptx) renderer for DocumentViewer.
 * Extracts and displays slide text, handles errors and loading.
 */
export function PptxRenderer(props: {
  /** PPTX file as ArrayBuffer (optional) */
  arrayBuffer?: ArrayBuffer;
  /** Page layout mode */
  layout: PageLayout;
  /** Current slide number (1-based) */
  currentPage: number;
  /** Callback when current slide changes */
  onCurrentPageChange: (p: number) => void;
  /** Callback when slide count is determined */
  onSlideCount: (n: number) => void;
  /** Callback for slide thumbnails */
  onThumbs: (thumbs: Array<string | undefined>) => void;
}) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [thumbs, setThumbs] = useState<Array<string | undefined>>([]);

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
        setError('No PPTX source provided.');
        setLoading(false);
        return;
      }
      try {
        // Load PPTX and extract slides (existing logic)
        const zip = await JSZip.loadAsync(props.arrayBuffer);
        const slidePaths = Object.keys(zip.files)
          .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
          .sort();
        const slidesOut: Slide[] = [];
        for (let i = 0; i < slidePaths.length; i++) {
          const xml = await zip.files[slidePaths[i]].async('string');
          slidesOut.push({ index: i + 1, text: extractText(xml) });
        }
        if (cancel) { return; }
        setSlides(
          slidesOut.length ? slidesOut : [{ index: 1, text: '(empty)' }],
        );
        props.onSlideCount(slidesOut.length || 1);

        // Generate all thumbnails up front (SVG placeholder for now)
        const thumbWidth = 56;
        const thumbsArr: Array<string | undefined> = [];
        for (let i = 0; i < (slidesOut.length || 1); i++) {
          thumbsArr.push(
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgThumb(i + 1))}`,
          );
        }
        setThumbs(thumbsArr);
      } catch (e) {
        setSlides([
          { index: 1, text: 'Unable to render this .pptx in-browser.' },
        ]);
        setThumbs([undefined]);
        setError(
          'Failed to load PPTX. ' + (e instanceof Error ? e.message : ''),
        );
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [props.arrayBuffer]);
  // (removed unreachable/duplicate code after useEffect)

  useEffect(() => {
    props.onThumbs(thumbs);
  }, [thumbs]);

  const pagesToShow = useMemo(() => {
    if (props.layout === 'side-by-side') {
      return [
        props.currentPage,
        Math.min(slides.length || props.currentPage + 1, props.currentPage + 1),
      ];
    }
    return [props.currentPage];
  }, [props.currentPage, props.layout, slides.length]);

  return (
    <div className="hv-doc">
      {loading && <div className="hv-loading">Loading PPTX…</div>}
      {error && <div className="hv-error">{error}</div>}
      {!loading && !error && (!slides || slides.length === 0) && (
        <div className="hv-error">No slides to display.</div>
      )}
      {!error && slides && slides.length > 0 && (
        <div
          className={
            props.layout === 'side-by-side'
              ? 'hv-pages hv-pages--two'
              : 'hv-pages'
          }
        >
          {pagesToShow.map((p) => {
            const s = slides[p - 1];
            return (
              <div
                key={p}
                className="hv-slide"
                tabIndex={0}
                onFocus={() => props.onCurrentPageChange(p)}
              >
                <div className="hv-slide-title">Slide {p}</div>
                <div className="hv-slide-text">{s?.text || ''}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function svgThumb(n: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><rect width="100%" height="100%" rx="12" fill="#111827"/><text x="50%" y="54%" font-size="18" fill="#e5e7eb" text-anchor="middle">${n}</text></svg>`;
}
