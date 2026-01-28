"use client";

import React, { useEffect, useRef } from "react";

interface ThumbnailsSidebarProps {
  isOpen: boolean;
  thumbnails: Array<string | undefined>; // Base64 strings
  currentPage: number;
  onSelectPage: (page: number) => void;
}

export function ThumbnailsSidebar(props: ThumbnailsSidebarProps) {
  const { isOpen, thumbnails, currentPage, onSelectPage } = props;
  const activeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the sidebar to keep the current page thumbnail in view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentPage, isOpen]);

  return (
    <div className={`hv-sidebar ${!isOpen ? "collapsed" : ""}`}>
      <div className="hv-thumb-list">
        {thumbnails.map((src, index) => {
          const pageNum = index + 1;
          const isActive = pageNum === currentPage;

          return (
            <div
              key={pageNum}
              ref={isActive ? activeRef : null}
              className={`hv-thumb-item ${isActive ? "active" : ""}`}
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
                  // Skeleton loader state for thumbnail
                  <div className="w-full h-full bg-gray-100 animate-pulse flex items-center justify-center">
                    <span className="text-xs text-gray-300">...</span>
                  </div>
                )}
              </div>
              <span className="hv-thumb-label">Page {pageNum}</span>
            </div>
          );
        })}

        {thumbnails.length === 0 && (
          <div className="text-center p-4 text-xs text-gray-400">
            No previews available
          </div>
        )}
      </div>
    </div>
  );
}
