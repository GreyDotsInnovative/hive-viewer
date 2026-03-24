"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

const THUMB_ITEM_HEIGHT = 184;
const THUMB_OVERSCAN = 4;

interface ThumbnailsSidebarProps {
  isOpen: boolean;
  thumbnails: Array<string | undefined>; // Base64 strings
  currentPage: number;
  onSelectPage: (page: number) => void;
  locale: Record<string, string>;
}

export function ThumbnailsSidebar(props: ThumbnailsSidebarProps) {
  const { isOpen, thumbnails, currentPage, onSelectPage, locale } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = listRef.current;
    if (!element || !isOpen) {
      return;
    }

    const nextTop = Math.max((currentPage - 1) * THUMB_ITEM_HEIGHT, 0);
    const nextBottom = nextTop + THUMB_ITEM_HEIGHT;
    const visibleTop = element.scrollTop;
    const visibleBottom = visibleTop + element.clientHeight;

    if (nextTop >= visibleTop && nextBottom <= visibleBottom) {
      return;
    }

    const targetTop = Math.max(
      nextTop - Math.max((element.clientHeight - THUMB_ITEM_HEIGHT) / 2, 0),
      0,
    );
    element.scrollTo({
      top: targetTop,
      behavior: "smooth",
    });
  }, [currentPage, isOpen]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) {
      return;
    }

    const updateViewport = () => {
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
    };

    updateViewport();

    const handleScroll = () => {
      setScrollTop(element.scrollTop);
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateViewport();
      });
      resizeObserver.observe(element);
    } else {
      window.addEventListener("resize", updateViewport);
    }

    return () => {
      element.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  const virtualWindow = useMemo(() => {
    if (thumbnails.length === 0) {
      return {
        startIndex: 0,
        endIndex: -1,
        totalHeight: 0,
      };
    }

    const visibleCount = Math.max(
      Math.ceil((viewportHeight || THUMB_ITEM_HEIGHT) / THUMB_ITEM_HEIGHT),
      1,
    );
    const startIndex = Math.max(
      Math.floor(scrollTop / THUMB_ITEM_HEIGHT) - THUMB_OVERSCAN,
      0,
    );
    const endIndex = Math.min(
      startIndex + visibleCount + THUMB_OVERSCAN * 2 - 1,
      thumbnails.length - 1,
    );

    return {
      startIndex,
      endIndex,
      totalHeight: thumbnails.length * THUMB_ITEM_HEIGHT,
    };
  }, [scrollTop, thumbnails.length, viewportHeight]);

  const visibleItems = useMemo(
    () =>
      thumbnails.slice(
        virtualWindow.startIndex,
        virtualWindow.endIndex >= virtualWindow.startIndex
          ? virtualWindow.endIndex + 1
          : virtualWindow.startIndex,
      ),
    [thumbnails, virtualWindow.endIndex, virtualWindow.startIndex],
  );

  return (
    <div className={`hv-sidebar ${!isOpen ? "collapsed" : ""}`}>
      <div ref={listRef} className="hv-thumb-list">
        {thumbnails.length > 0 && (
          <div
            className="hv-thumb-viewport"
            style={{ height: `${virtualWindow.totalHeight}px` }}
          >
            {visibleItems.map((src, index) => {
              const absoluteIndex = virtualWindow.startIndex + index;
              const pageNum = absoluteIndex + 1;
              const isActive = pageNum === currentPage;

              return (
                <div
                  key={pageNum}
                  className={`hv-thumb-item ${isActive ? "active" : ""}`}
                  style={{ top: `${absoluteIndex * THUMB_ITEM_HEIGHT}px` }}
                  onClick={() => onSelectPage(pageNum)}
                >
                  <div className="hv-thumb-preview">
                    {src ? (
                      <img
                        src={src}
                        alt={`Page ${pageNum}`}
                        className="hv-thumb-img"
                      />
                    ) : (
                      <div className="hv-thumb-skeleton">
                        <span>...</span>
                      </div>
                    )}
                  </div>
                  <span className="hv-thumb-label">
                    {locale["thumbnails.page"]} {pageNum}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {thumbnails.length === 0 && (
          <div className="hv-thumb-empty">{locale["thumbnails.empty"]}</div>
        )}
      </div>
    </div>
  );
}
