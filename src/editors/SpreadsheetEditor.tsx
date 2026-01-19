'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import type { DocumentMode, SupportedFileType } from '../types';
import { arrayBufferToBase64 } from '../utils/fileSource';

export interface SpreadsheetEditorHandle {
  save: (exportPdf?: boolean) => Promise<void>;
  requestThumbnails: (index: number) => Promise<void>;
}

export const SpreadsheetEditor = forwardRef<SpreadsheetEditorHandle, {
  mode: DocumentMode;
  fileName: string;
  arrayBuffer?: ArrayBuffer;
  locale: Record<string, string>;
  onSave: (base64: string, meta: { fileName: string; fileType: SupportedFileType; exportedAsPdf?: boolean }) => void;
}>(function SpreadsheetEditor(props, ref) {
  const readonly = props.mode === 'view';
  const [grid, setGrid] = useState<string[][]>(() => Array.from({ length: 30 }, () => Array.from({ length: 12 }, () => '')));

  useEffect(() => {
    if (!props.arrayBuffer) { return; }
    try {
      const wb = XLSX.read(props.arrayBuffer, { type: 'array' });
      const name = wb.SheetNames[0];
      const ws = wb.Sheets[name];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
      const rows = Math.max(30, aoa.length);
      const cols = Math.max(12, Math.max(...aoa.map((r) => (r?.length ?? 0)), 0));
      const next = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
        const v = aoa[r]?.[c];
        return v == null ? '' : String(v);
      }));
      setGrid(next);
    } catch {
      // ignore
    }
  }, [props.arrayBuffer]);

  async function save(exportPdf?: boolean) {
    const ws = XLSX.utils.aoa_to_sheet(grid);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const b64 = arrayBufferToBase64(out);
    props.onSave(b64, { fileName: ensureExt(props.fileName, 'xlsx'), fileType: 'xlsx', exportedAsPdf: !!exportPdf });
  }

  useImperativeHandle(ref, () => ({
    save,
    requestThumbnails: async () => undefined,
  }));

  const cols = useMemo(() => Array.from({ length: grid[0]?.length ?? 0 }, (_, i) => String.fromCharCode(65 + (i % 26))), [grid]);

  return (
    <div className="hv-sheet">
      <div className="hv-sheetbar">
        <div className="hv-sheetbar-title">{props.fileName}</div>
        {!readonly ? <button className="hv-btn" type="button" onClick={() => void save(false)}>{props.locale['toolbar.save'] ?? 'Save'}</button> : null}
      </div>
      <div className="hv-sheetgrid" role="table" aria-label="Spreadsheet">
        <div className="hv-sheetrow hv-sheetrow--header" role="row">
          <div className="hv-sheetcell hv-sheetcell--corner" role="columnheader" />
          {cols.map((c, i) => <div key={i} className="hv-sheetcell hv-sheetcell--header" role="columnheader">{c}</div>)}
        </div>
        {grid.map((row, r) => (
          <div key={r} className="hv-sheetrow" role="row">
            <div className="hv-sheetcell hv-sheetcell--header" role="rowheader">{r + 1}</div>
            {row.map((val, c) => (
              <div
                key={c}
                className="hv-sheetcell"
                role="cell"
                contentEditable={!readonly}
                suppressContentEditableWarning
                onInput={(e) => {
                  const text = (e.currentTarget.textContent ?? '');
                  setGrid((prev) => {
                    const next = prev.map((rr) => rr.slice());
                    next[r][c] = text;
                    return next;
                  });
                }}
              >{val}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

function ensureExt(name: string, ext: string) {
  const base = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  return `${base}.${ext}`;
}
