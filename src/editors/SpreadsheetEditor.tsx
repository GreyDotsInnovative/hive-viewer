"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import * as XLSX from "xlsx";
import type { DocumentMode, SupportedFileType } from "../types";

export interface SpreadsheetEditorHandle {
  save: (exportPdf?: boolean) => Promise<void>;
}

interface SpreadsheetEditorProps {
  mode: DocumentMode;
  fileName: string;
  arrayBuffer?: ArrayBuffer;
  layout?: "single" | "side-by-side";
  onSave?: (base64: string, meta: any) => void;
}

export const SpreadsheetEditor = forwardRef<
  SpreadsheetEditorHandle,
  SpreadsheetEditorProps
>(function SpreadsheetEditor(props, ref) {
  const readonly = props.mode === "view";
  const [data, setData] = useState<string[][]>([]);
  const [cols, setCols] = useState<string[]>([]);

  useEffect(() => {
    if (!props.arrayBuffer) return;

    try {
      const wb = XLSX.read(props.arrayBuffer, { type: "array" });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];

      const jsonData = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: "",
      }) as string[][];

      const minRows = 40;
      const minCols = 15;

      const rows = Math.max(minRows, jsonData.length);
      const colCount = Math.max(minCols, jsonData[0]?.length || 0);

      const normalized = Array.from({ length: rows }, (_, r) => {
        const row = jsonData[r] || [];
        return Array.from({ length: colCount }, (_, c) =>
          row[c] !== undefined && row[c] !== null ? String(row[c]) : "",
        );
      });

      setData(normalized);

      const headers = Array.from({ length: colCount }, (_, i) => {
        let letter = "";
        let temp = i;
        while (temp >= 0) {
          letter = String.fromCharCode((temp % 26) + 65) + letter;
          temp = Math.floor(temp / 26) - 1;
        }
        return letter;
      });
      setCols(headers);
    } catch (e) {
      console.error("Spreadsheet load error:", e);
    }
  }, [props.arrayBuffer]);

  async function save(exportPdf?: boolean) {
    if (!props.onSave) return;
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    const bytes = new Uint8Array(out);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    props.onSave(btoa(binary), {
      fileName: props.fileName,
      fileType: "xlsx",
      exportedAsPdf: !!exportPdf,
    });
  }

  useImperativeHandle(ref, () => ({ save }));

  return (
    <div className="hv-view-single">
      <div
        className="hv-page-container"
        style={{
          width: "auto",
          maxWidth: "95vw",
          minWidth: "800px",
          padding: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Toolbar / Formula Bar */}
        <div
          style={{
            background: "#f8f9fa",
            borderBottom: "1px solid #e2e8f0",
            padding: "8px 16px",
            fontSize: "12px",
            color: "#64748b",
            display: "flex",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          <span>fx</span>
          <div
            style={{
              background: "white",
              border: "1px solid #cbd5e1",
              flex: 1,
              height: "18px",
              borderRadius: "2px",
            }}
          />
        </div>

        {/* Main Grid Container */}
        <div
          style={{
            overflow: "auto",
            // FIX: Dynamic height ensures bottom isn't cut off on small screens
            maxHeight: "calc(100vh - 140px)",
            minHeight: "400px",
            position: "relative",
            // FIX: Padding prevents border clipping (first row/col edges)
            padding: "1px",
          }}
        >
          <table
            style={{
              borderCollapse: "collapse",
              minWidth: "100%",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr>
                {/* Corner Cell */}
                <th
                  style={{
                    width: "40px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    position: "sticky",
                    top: 0,
                    left: 0,
                    zIndex: 30, // Increased zIndex
                  }}
                />

                {/* Column Headers */}
                {cols.map((col, i) => (
                  <th
                    key={i}
                    style={{
                      minWidth: "100px",
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      color: "#475569",
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "4px",
                      position: "sticky",
                      top: 0,
                      zIndex: 20, // Increased zIndex
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, r) => (
                <tr key={r}>
                  {/* Row Header (1, 2, 3...) */}
                  <td
                    style={{
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      textAlign: "center",
                      fontSize: "11px",
                      color: "#64748b",
                      position: "sticky",
                      left: 0,
                      zIndex: 20, // Increased zIndex to stay above cells
                    }}
                  >
                    {r + 1}
                  </td>

                  {/* Cells */}
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      contentEditable={!readonly}
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const val = e.currentTarget.innerText;
                        setData((prev) => {
                          const next = [...prev];
                          next[r] = [...next[r]];
                          next[r][c] = val;
                          return next;
                        });
                      }}
                      style={{
                        border: "1px solid #e2e8f0",
                        padding: "4px 8px",
                        fontSize: "13px",
                        color: "#1e293b",
                        minWidth: "100px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        outline: "none",
                        zIndex: 1,
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
