'use client';

import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PageLayout } from '../types';

/**
 * PDF document renderer for DocumentViewer.
 * Handles loading, error, and signature placement.
 */
export function PdfRenderer(props: {
  /** PDF file URL (optional) */
  url?: string;
  /** PDF file as ArrayBuffer (optional) */
  arrayBuffer?: ArrayBuffer;
  /** Page layout mode */
  layout: PageLayout;
  /** Current page number (1-based) */
  currentPage: number;
  /** Callback when current page changes */
  onCurrentPageChange: (p: number) => void;
  /** Callback when page count is determined */
  onPageCount: (n: number) => void;
  /** Callback for thumbnail images */
  onThumbs: (thumbs: Array<string | undefined>) => void;
  /** Signature stamp for placement (optional) */
  signatureStamp?: {
    imageUrl: string;
    armed: boolean;
    onPlaced: (placement: {
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
    }) => void;
  };
}) {
  const { url, arrayBuffer } = props;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [rendered, setRendered] = useState<Map<number, HTMLCanvasElement>>(
    new Map(),
  );
  const [thumbs, setThumbs] = useState<Array<string | undefined>>([]);
  const [size, setSize] = useState({ w: 840, h: 1188 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import .meta.url,
      ).toString();
    } catch {}
  }, []);

  useEffect(() => {
    let cancel = false;
    setError(null);
    setLoading(true);
    (async () => {
      setDoc(null);
      setRendered(new Map());
      setThumbs([]);
      if (!url && !arrayBuffer) {
        setError('No PDF source provided.');
        setLoading(false);
        return;
      }
      try {
        const task = getDocument(
          url ? { url, rangeChunkSize: 512 * 1024 } : { data: arrayBuffer! },
        );
        const pdf = await task.promise;
        if (cancel) { return; }
        setDoc(pdf);
        setPageCount(pdf.numPages);
        props.onPageCount(pdf.numPages);

        // Get first page to determine aspect ratio and main render size
        const p1 = await pdf.getPage(1);
        const base = p1.getViewport({ scale: 1 });
        const w = Math.min(980, Math.max(640, base.width));
        const s = w / base.width;
        const vp = p1.getViewport({ scale: s });
        setSize({ w: Math.round(vp.width), h: Math.round(vp.height) });

        // Generate all thumbnails up front
        const thumbWidth = 56; // px, matches CSS .hv-thumbimg
        const thumbsArr: Array<string | undefined> = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const pageBase = page.getViewport({ scale: 1 });
          const thumbScale = thumbWidth / pageBase.width;
          const thumbVp = page.getViewport({ scale: thumbScale });
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = Math.round(thumbVp.width);
          thumbCanvas.height = Math.round(thumbVp.height);
          const thumbCtx = thumbCanvas.getContext('2d', { alpha: false });
          if (thumbCtx) {
            await page.render({ canvasContext: thumbCtx, viewport: thumbVp })
              .promise;
            thumbsArr.push(thumbCanvas.toDataURL('image/png'));
          } else {
            thumbsArr.push(undefined);
          }
        }
        setThumbs(thumbsArr);
      } catch (e) {
        setError(
          'Failed to load PDF. ' + (e instanceof Error ? e.message : ''),
        );
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [url, arrayBuffer]);

  useEffect(() => {
    props.onThumbs(thumbs);
  }, [thumbs]);

  const pagesToShow = useMemo(() => {
    if (props.layout === 'side-by-side') {
      const left = props.currentPage;
      const right = Math.min(pageCount || left + 1, left + 1);
      return [left, right];
    }
    return [props.currentPage];
  }, [props.currentPage, props.layout, pageCount]);

  useEffect(() => {
    if (!doc) { return; }
    let cancel = false;
    (async () => {
      for (const p of pagesToShow) {
        if (rendered.has(p)) { continue; }
        try {
          const page = await doc.getPage(p);
          if (cancel) { return; }
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: size.w / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(vp.width);
          canvas.height = Math.round(vp.height);
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) { continue; }
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          if (cancel) { return; }
          setRendered((prev) => {
            const next = new Map(prev);
            next.set(p, canvas);
            return next;
          });
        } catch {}
      }
    })();
    return () => {
      cancel = true;
    };
  }, [doc, pagesToShow, size.w, rendered]);

  function onWheel(e: React.WheelEvent) {
    if (!pageCount) { return; }
    if (Math.abs(e.deltaY) < 10) { return; }
    const dir = e.deltaY > 0 ? 1 : -1;
    const step = props.layout === 'side-by-side' ? 2 : 1;
    const next = Math.max(
      1,
      Math.min(pageCount, props.currentPage + dir * step),
    );
    props.onCurrentPageChange(next);
  }

  function clickPlace(e: React.MouseEvent, page: number) {
    const stamp = props.signatureStamp;
    if (!stamp?.armed) { return; }
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    stamp.onPlaced({ page, x, y, w: 0.22, h: 0.08 });
  }

  return (
    <div className="hv-doc" ref={containerRef} onWheel={onWheel}>
      {!doc ? <div className="hv-loading">Loading PDF…</div> : null}
      {doc ? (
        <div
          className={
            props.layout === 'side-by-side'
              ? 'hv-pages hv-pages--two'
              : 'hv-pages'
          }
        >
          {pagesToShow.map((p) => {
            const c = rendered.get(p);
            return (
              <div
                key={p}
                className="hv-page"
                style={{ width: size.w, height: size.h }}
                onClick={(e) => clickPlace(e, p)}
              >
                {c ? (
                  <canvas
                    className="hv-canvas"
                    width={c.width}
                    height={c.height}
                    ref={(node) => {
                      if (!node) { return; }
                      const ctx = node.getContext('2d');
                      if (ctx) { ctx.drawImage(c, 0, 0); }
                    }}
                  />
                ) : (
                  <div className="hv-loading">Rendering…</div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
