"use client";

import { Check, Plus, Trash2, X } from "lucide-react";
import React, { useMemo, useRef, useState } from "react";
import type { Signature } from "../types";

interface SignaturePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSignature: (sig: Signature) => void;
  selectedSignature?: Signature | null;
  onClearSelection: () => void;
  externalSignatures?: Signature[];
  onSignRequest?: () => Promise<Signature>;
  locale: Record<string, string>;
}

function sameSignature(left: Signature, right: Signature) {
  if (left.id && right.id) {
    return left.id === right.id;
  }

  return (
    left.signatureImageUrl === right.signatureImageUrl &&
    left.signedBy === right.signedBy &&
    left.dateSigned === right.dateSigned
  );
}

function trimSignatureCanvas(
  canvas: HTMLCanvasElement,
  padding = 16,
  alphaThreshold = 8,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas.toDataURL("image/png");
  }

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = imageData[(y * width + x) * 4 + 3];
      if (alpha <= alphaThreshold) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return canvas.toDataURL("image/png");
  }

  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padding * 2);
  const trimmedCanvas = document.createElement("canvas");
  trimmedCanvas.width = cropWidth;
  trimmedCanvas.height = cropHeight;
  const trimmedCtx = trimmedCanvas.getContext("2d");

  if (!trimmedCtx) {
    return canvas.toDataURL("image/png");
  }

  trimmedCtx.drawImage(
    canvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  return trimmedCanvas.toDataURL("image/png");
}

export function SignaturePanel(props: SignaturePanelProps) {
  const {
    isOpen,
    onClose,
    onSelectSignature,
    selectedSignature,
    onClearSelection,
    externalSignatures = [],
    onSignRequest,
    locale,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [localSignatures, setLocalSignatures] = useState<Signature[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  const signatures = useMemo(() => {
    const merged: Signature[] = [];

    for (const signature of [...externalSignatures, ...localSignatures]) {
      if (!merged.some((item) => sameSignature(item, signature))) {
        merged.push(signature);
      }
    }

    return merged;
  }, [externalSignatures, localSignatures]);

  const handleCreateClick = async () => {
    if (onSignRequest) {
      try {
        const newSignature = await onSignRequest();
        if (!newSignature) {
          return;
        }

        setLocalSignatures((prev) =>
          prev.some((signature) => sameSignature(signature, newSignature))
            ? prev
            : [...prev, newSignature],
        );
        onSelectSignature(newSignature);
      } catch (error) {
        console.error("Custom sign request failed", error);
      }
      return;
    }

    setShowModal(true);
    setHasInk(false);
    requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#111827";
      }
    });
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasInk(false);
    }
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) {
      return;
    }

    const newSignature: Signature = {
      id: Date.now().toString(),
      signatureImageUrl: trimSignatureCanvas(canvas),
      dateSigned: new Date().toISOString(),
    };

    setLocalSignatures((prev) => [...prev, newSignature]);
    setShowModal(false);
    onSelectSignature(newSignature);
  };

  const startDraw = (
    event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const clientX =
      "touches" in event ? event.touches[0].clientX : event.clientX;
    const clientY =
      "touches" in event ? event.touches[0].clientY : event.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasInk(true);
  };

  const stopDraw = () => {
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.beginPath();
    setIsDrawing(false);
  };

  const draw = (
    event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    if (!isDrawing) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const clientX =
      "touches" in event ? event.touches[0].clientX : event.clientX;
    const clientY =
      "touches" in event ? event.touches[0].clientY : event.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  return (
    <>
      <div
        className={`hv-sidebar hv-sidebar-right ${!isOpen ? "collapsed" : ""}`}
        style={{ width: isOpen ? "300px" : "0" }}
      >
        <div
          className="hv-sidebar-header"
          style={{ justifyContent: "space-between", padding: "12px 16px" }}
        >
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
            {locale["signatures.title"]}
          </h3>
          <button
            onClick={onClose}
            className="hv-btn"
            style={{ padding: "4px", border: "none" }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="hv-thumb-list">
          <button
            onClick={handleCreateClick}
            className="hv-btn"
            style={{
              width: "100%",
              justifyContent: "center",
              border: "2px dashed var(--hv-border)",
              marginBottom: "8px",
              color: "var(--hv-primary)",
            }}
          >
            <Plus size={18} style={{ marginRight: "8px" }} />
            {locale["signatures.new"]}
          </button>

          {selectedSignature && (
            <div className="hv-signature-selection-card">
              <div className="hv-signature-selection-title">
                {locale["signatures.ready"]}
              </div>
              <img
                src={selectedSignature.signatureImageUrl}
                alt={
                  selectedSignature.signedBy
                    ? `Selected signature by ${selectedSignature.signedBy}`
                    : "Selected signature"
                }
                className="hv-signature-selection-image"
              />
              <div className="hv-signature-selection-copy">
                {locale["signatures.placeHint"]}
              </div>
              <button
                type="button"
                className="hv-btn"
                style={{ width: "100%" }}
                onClick={onClearSelection}
              >
                {locale["signatures.cancelPlacement"]}
              </button>
            </div>
          )}

          {signatures.length === 0 && (
            <div className="hv-signature-empty">
              {locale["signatures.empty"]}
            </div>
          )}

          {signatures.map((signature, index) => {
            const isLocal = localSignatures.some((item) =>
              sameSignature(item, signature),
            );
            const isSelected = selectedSignature
              ? sameSignature(selectedSignature, signature)
              : false;

            return (
              <div
                key={signature.id || `${signature.dateSigned}-${index}`}
                className={`hv-thumb-item hv-signature-item ${isSelected ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="hv-signature-item-main"
                  onClick={() => onSelectSignature(signature)}
                >
                  <img
                    src={signature.signatureImageUrl}
                    alt={signature.signedBy ? `Signature by ${signature.signedBy}` : "Signature"}
                    style={{ height: "42px", objectFit: "contain" }}
                  />
                  <div className="hv-signature-item-copy">
                    {signature.signedBy && <strong>{signature.signedBy}</strong>}
                    <span>
                      {new Date(signature.dateSigned).toLocaleDateString()}
                    </span>
                    {signature.comment && <em>{signature.comment}</em>}
                  </div>
                  {isSelected && (
                    <span className="hv-signature-item-check">
                      <Check size={14} />
                    </span>
                  )}
                </button>

                {isLocal && (
                  <button
                    type="button"
                    className="hv-btn"
                    style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    padding: "4px",
                    color: "#ef4444",
                    border: "none",
                    background: "var(--hv-paper-bg)",
                  }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setLocalSignatures((prev) =>
                        prev.filter((item) => !sameSignature(item, signature)),
                      );
                      if (selectedSignature && sameSignature(selectedSignature, signature)) {
                        onClearSelection();
                      }
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showModal && (
        <div className="hv-modal-overlay">
          <div className="hv-modal" style={{ width: "450px", maxWidth: "90vw" }}>
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid var(--hv-border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
                {locale["signatures.drawTitle"]}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="hv-btn"
                style={{ border: "none" }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                padding: "24px",
                background: "var(--hv-modal-subtle-bg)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  background: "var(--hv-page-bg)",
                  border: "1px solid var(--hv-border)",
                  borderRadius: "8px",
                  overflow: "hidden",
                  boxShadow: "inset 0 2px 4px 0 rgba(0,0,0,0.05)",
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={200}
                  style={{
                    display: "block",
                    cursor: "crosshair",
                    touchAction: "none",
                  }}
                  onMouseDown={startDraw}
                  onMouseUp={stopDraw}
                  onMouseLeave={stopDraw}
                  onMouseMove={draw}
                  onTouchStart={startDraw}
                  onTouchEnd={stopDraw}
                  onTouchMove={draw}
                />
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--hv-muted)",
                  marginTop: "8px",
                }}
              >
                {locale["signatures.drawHelp"]}
              </p>
            </div>

            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid var(--hv-border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
              }}
            >
              <button onClick={clearCanvas} className="hv-btn">
                {locale["signatures.clear"]}
              </button>
              <button
                onClick={saveSignature}
                className="hv-btn hv-btn-primary"
                disabled={!hasInk}
              >
                {locale["signatures.createAndUse"]}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
