"use client";

import { Plus, Trash2, X } from "lucide-react";
import React, { useState, useRef } from "react";
import type { Signature } from "../types";

interface SignaturePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSignature: (sig: Signature) => void;
  externalSignatures?: Signature[];
  onSignRequest?: () => Promise<Signature>;
}

export function SignaturePanel(props: SignaturePanelProps) {
  const {
    isOpen,
    onClose,
    onSelectSignature,
    externalSignatures = [],
    onSignRequest,
  } = props;
  const [localSignatures, setLocalSignatures] = useState<Signature[]>([]);
  const [showModal, setShowModal] = useState(false);

  // Combine external + local
  const signatures = [...externalSignatures, ...localSignatures];

  // Drawing state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // --- Modal Logic ---
  const handleCreateClick = async () => {
    if (onSignRequest) {
      try {
        const newSig = await onSignRequest();
        if (newSig) {
          // If the user provides a signature, we can choose to add it to local list
          // so it appears in the list here.
          // Note: If the parent manages state driven by "externalSignatures",
          // this might duplicate if we also add it locally.
          // However, typically onSignRequest implies external control.
          // Let's assume onSignRequest returns the signature and we should add it local
          // for immediate use, UNLESS the parent updates externalSignatures.
          // To be safe and simple: Add to local.
          setLocalSignatures((prev) => [...prev, newSig]);
          onSelectSignature(newSig);
        }
      } catch (err) {
        console.error("Custom sign request failed", err);
      }
    } else {
      openCreateModal();
    }
  };

  const openCreateModal = () => {
    setShowModal(true);
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }, 100);
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const newSig: Signature = {
      id: Date.now().toString(),
      signatureImageUrl: canvas.toDataURL("image/png"),
      signedBy: "Me",
      dateSigned: new Date().toISOString(),
    };

    setLocalSignatures([...localSignatures, newSig]);
    setShowModal(false);
    onSelectSignature(newSig);
  };

  // --- Drawing Logic ---
  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    draw(e);
  };
  const stopDraw = () => setIsDrawing(false);
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX =
      "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY =
      "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  return (
    <>
      {/* Right Sidebar */}
      <div
        className={`hv-sidebar hv-sidebar-right ${!isOpen ? "collapsed" : ""}`}
        style={{ width: isOpen ? "280px" : "0" }}
      >
        <div
          className="hv-sidebar-header"
          style={{ justifyContent: "space-between", padding: "12px 16px" }}
        >
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
            Signatures
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
              marginBottom: "16px",
              color: "var(--hv-primary)",
            }}
          >
            <Plus size={18} style={{ marginRight: "8px" }} />
            New Signature
          </button>

          {signatures.map((sig, idx) => {
            const isLocal = localSignatures.some((s) => s.id === sig.id);
            // If it's not local, we assume it's external, so we might want to disable delete
            // or handle it differently.
            // For now, only show delete for local items to avoid state mismatch.
            const showDelete = isLocal;

            return (
              <div
                key={sig.id || idx}
                className="hv-thumb-item"
                style={{
                  position: "relative",
                  padding: "12px",
                  background: "var(--hv-bg)",
                  borderRadius: "8px",
                  border: "1px solid var(--hv-border)",
                }}
                onClick={() => onSelectSignature(sig)}
              >
                <img
                  src={sig.signatureImageUrl}
                  alt="Signature"
                  style={{ height: "40px", objectFit: "contain" }}
                />
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--hv-muted)",
                    marginTop: "4px",
                    textAlign: "center",
                  }}
                >
                  {sig.signedBy || "User"} •{" "}
                  {new Date(sig.dateSigned).toLocaleDateString()}
                  {sig.comment && (
                    <div className="text-xs text-gray-500 mt-1 italic">
                      {sig.comment}
                    </div>
                  )}
                </div>

                {showDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocalSignatures(
                        localSignatures.filter((s) => s.id !== sig.id),
                      );
                    }}
                    className="hv-btn"
                    style={{
                      position: "absolute",
                      top: "4px",
                      right: "4px",
                      padding: "4px",
                      color: "#ef4444",
                      border: "none",
                      background: "white",
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

      {/* --- MODAL FIX: Using hv-modal classes --- */}
      {showModal && (
        <div className="hv-modal-overlay">
          <div
            className="hv-modal"
            style={{ width: "450px", maxWidth: "90vw" }}
          >
            {/* Modal Header */}
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
                Draw Signature
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="hv-btn"
                style={{ border: "none" }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body (Canvas) */}
            <div
              style={{
                padding: "24px",
                background: "#f9fafb",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  background: "white",
                  border: "1px solid #e5e7eb",
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
                Sign above using your mouse or finger
              </p>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid var(--hv-border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
              }}
            >
              <button
                onClick={() => {
                  const ctx = canvasRef.current?.getContext("2d");
                  ctx?.clearRect(0, 0, 400, 200);
                }}
                className="hv-btn"
              >
                Clear
              </button>
              <button onClick={saveSignature} className="hv-btn hv-btn-primary">
                Create & Use
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
