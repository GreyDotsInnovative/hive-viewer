"use client";

import ExcelJS from "exceljs";
import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { SignatureOverlay } from "../components/SignatureOverlay";
import type {
  SpreadsheetExportState,
  SpreadsheetCellExportModel,
  SpreadsheetMergeModel,
  SpreadsheetSheetExportModel,
} from "../internal/exportModels";
import type {
  DocumentSurfaceOverlayState,
  DocumentMode,
} from "../types";

interface SpreadsheetEditorProps {
  mode: DocumentMode;
  fileName: string;
  arrayBuffer?: ArrayBuffer;
  currentPage: number;
  onPageCount: (n: number) => void;
  onCurrentPageChange: (p: number) => void;
  onThumbs: (thumbs: Array<string | undefined>) => void;
  onExportStateChange?: (state: SpreadsheetExportState | null) => void;
  signatureOverlay: DocumentSurfaceOverlayState;
  locale: Record<string, string>;
}

type SheetModel = SpreadsheetSheetExportModel;

const MAX_RENDER_ROWS = 400;
const MAX_RENDER_COLS = 120;

function toColumnLabel(index: number) {
  let label = "";
  let current = index;

  while (current >= 0) {
    label = String.fromCharCode((current % 26) + 65) + label;
    current = Math.floor(current / 26) - 1;
  }

  return label;
}

function makeCellKey(row: number, col: number) {
  return `${row}:${col}`;
}

function cloneSerializable<T>(value: T): T {
  if (value == null) {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripArgbAlpha(argb?: string) {
  if (!argb) {
    return undefined;
  }

  const normalized = argb.replace("#", "").trim();
  if (normalized.length === 8) {
    return `#${normalized.slice(2)}`;
  }
  if (normalized.length === 6) {
    return `#${normalized}`;
  }
  return undefined;
}

function getExcelColor(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.argb === "string") {
    return stripArgbAlpha(value.argb);
  }

  return undefined;
}

function noteToString(note: unknown) {
  if (!note) {
    return undefined;
  }

  if (typeof note === "string") {
    return note;
  }

  if (Array.isArray(note)) {
    const parts = note
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (isRecord(entry) && typeof entry.text === "string") {
          return entry.text;
        }
        return "";
      })
      .filter(Boolean);

    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  if (isRecord(note) && Array.isArray(note.texts)) {
    return noteToString(note.texts);
  }

  return undefined;
}

function richTextToString(value: unknown) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => {
      if (isRecord(entry) && typeof entry.text === "string") {
        return entry.text;
      }
      return "";
    })
    .join("");
}

function inferValueKind(value: unknown): SpreadsheetCellExportModel["valueKind"] {
  if (value == null) {
    return "blank";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (value instanceof Date) {
    return "date";
  }
  if (isRecord(value)) {
    if (typeof value.formula === "string") {
      return "formula";
    }
    if (typeof value.hyperlink === "string") {
      return "hyperlink";
    }
    if (Array.isArray(value.richText)) {
      return "richText";
    }
    if (value.error != null) {
      return "error";
    }
  }
  return "unknown";
}

function isCellMetadataOnly(cell?: SpreadsheetCellExportModel | null) {
  if (!cell) {
    return false;
  }

  return Boolean(
    cell.note ||
      cell.numFmt ||
      cell.font ||
      cell.fill ||
      cell.alignment ||
      cell.border,
  );
}

function getCellInputValue(cell?: SpreadsheetCellExportModel | null) {
  if (!cell) {
    return "";
  }

  if (cell.formula) {
    return `=${cell.formula}`;
  }

  if (typeof cell.value === "string") {
    return cell.value;
  }

  if (typeof cell.value === "number" || typeof cell.value === "boolean") {
    return String(cell.value);
  }

  if (cell.value instanceof Date) {
    return cell.value.toISOString();
  }

  return cell.displayValue;
}

function createMergeLookup(merges: SpreadsheetMergeModel[]) {
  const starts = new Map<string, SpreadsheetMergeModel>();
  const covered = new Set<string>();

  for (const merge of merges) {
    starts.set(`${merge.startRow}:${merge.startCol}`, merge);

    for (let row = merge.startRow; row <= merge.endRow; row += 1) {
      for (let col = merge.startCol; col <= merge.endCol; col += 1) {
        if (row === merge.startRow && col === merge.startCol) {
          continue;
        }
        covered.add(`${row}:${col}`);
      }
    }
  }

  return { starts, covered };
}

function makeSheetThumbnail(sheet: SheetModel, index: number) {
  const previewRows = sheet.data.slice(0, 3);
  const previewText = previewRows
    .map((row) => row.slice(0, 3).filter(Boolean).join(" | "))
    .filter(Boolean)
    .join(" | ");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="96">
      <rect width="100%" height="100%" fill="#eff6ff" rx="12" ry="12" />
      <rect x="12" y="12" width="136" height="18" fill="#2563eb" rx="6" ry="6" />
      <text x="20" y="25" fill="#ffffff" font-size="10" font-family="Arial">${sheet.name}</text>
      <text x="20" y="50" fill="#1e3a8a" font-size="12" font-family="Arial">Sheet ${index + 1}</text>
      <text x="20" y="68" fill="#334155" font-size="9" font-family="Arial">${previewText || "Workbook preview"}</text>
    </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createEmptyGrid(rowCount: number, colCount: number) {
  return Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => ""),
  );
}

function buildEditedCellModel(
  address: string,
  input: string,
  existing?: SpreadsheetCellExportModel,
): SpreadsheetCellExportModel | null {
  const base: SpreadsheetCellExportModel = existing
    ? {
        ...existing,
        value: cloneSerializable(existing.value),
        result: cloneSerializable(existing.result),
        font: existing.font ? cloneSerializable(existing.font) : undefined,
        fill: existing.fill ? cloneSerializable(existing.fill) : undefined,
        alignment: existing.alignment
          ? cloneSerializable(existing.alignment)
          : undefined,
        border: existing.border ? cloneSerializable(existing.border) : undefined,
      }
    : {
        address,
        displayValue: "",
        value: null,
        valueKind: "blank",
      };

  if (!input) {
    const cleared: SpreadsheetCellExportModel = {
      ...base,
      address,
      displayValue: "",
      value: null,
      valueKind: "blank",
      formula: undefined,
      result: undefined,
      hyperlink: existing?.hyperlink,
    };

    return isCellMetadataOnly(cleared) ? cleared : null;
  }

  if (input.startsWith("=") && input.trim().length > 1) {
    const formula = input.trim().slice(1);
    return {
      ...base,
      address,
      displayValue: input,
      value: { formula },
      valueKind: "formula",
      formula,
      result: undefined,
    };
  }

  if (/^(true|false)$/i.test(input.trim())) {
    return {
      ...base,
      address,
      displayValue: input,
      value: /^true$/i.test(input.trim()),
      valueKind: "boolean",
      formula: undefined,
      result: undefined,
    };
  }

  if (/^-?\d+(\.\d+)?$/.test(input.trim())) {
    return {
      ...base,
      address,
      displayValue: input,
      value: Number(input),
      valueKind: "number",
      formula: undefined,
      result: undefined,
    };
  }

  return {
    ...base,
    address,
    displayValue: input,
    value: input,
    valueKind: "string",
    formula: undefined,
    result: undefined,
  };
}

function createCellModelFromExcelCell(
  cell: ExcelJS.Cell,
): SpreadsheetCellExportModel | null {
  const value = cell.value;
  const valueKind = inferValueKind(value);
  const note = noteToString(cell.note);
  const hasMetadata = Boolean(
    note ||
      cell.numFmt ||
      cell.font ||
      cell.fill ||
      cell.alignment ||
      cell.border,
  );

  if (value == null && !hasMetadata) {
    return null;
  }

  let formula: string | undefined;
  let result: unknown;
  let hyperlink: string | undefined;

  if (isRecord(value)) {
    if (typeof value.formula === "string") {
      formula = value.formula;
      result = value.result;
    }
    if (typeof value.hyperlink === "string") {
      hyperlink = value.hyperlink;
    }
  }

  return {
    address: cell.address,
    displayValue:
      valueKind === "richText"
        ? richTextToString(isRecord(value) ? value.richText : undefined)
        : cell.text || "",
    value: cloneSerializable(value),
    valueKind,
    formula,
    result: cloneSerializable(result),
    hyperlink,
    note,
    numFmt:
      cell.numFmt == null || cell.numFmt === ""
        ? undefined
        : String(cell.numFmt),
    font: cell.font ? cloneSerializable(cell.font) : undefined,
    fill: cell.fill ? cloneSerializable(cell.fill) : undefined,
    alignment: cell.alignment ? cloneSerializable(cell.alignment) : undefined,
    border: cell.border ? cloneSerializable(cell.border) : undefined,
  };
}

function createCellModelFromXlsxCell(
  address: string,
  cell: XLSX.CellObject,
): SpreadsheetCellExportModel | null {
  if (!cell) {
    return null;
  }

  const note = Array.isArray(cell.c)
    ? cell.c.map((comment) => comment.t || "").join("\n")
    : undefined;
  const hyperlink =
    cell.l && typeof cell.l.Target === "string" ? cell.l.Target : undefined;
  const valueKind = cell.f
    ? "formula"
    : cell.t === "n"
      ? "number"
      : cell.t === "b"
        ? "boolean"
        : cell.t === "d"
          ? "date"
          : hyperlink
            ? "hyperlink"
            : cell.t === "e"
              ? "error"
              : "string";
  const displayValue =
    typeof cell.w === "string"
      ? cell.w
      : cell.v == null
        ? ""
        : String(cell.v);

  if (!displayValue && !cell.v && !cell.f && !note && !hyperlink && !cell.z) {
    return null;
  }

  return {
    address,
    displayValue,
    value: cloneSerializable(cell.f ? { formula: cell.f, result: cell.v } : cell.v),
    valueKind,
    formula: cell.f || undefined,
    result: cell.f ? cloneSerializable(cell.v) : undefined,
    hyperlink,
    note,
    numFmt: cell.z == null || cell.z === "" ? undefined : String(cell.z),
  };
}

function getAlignmentValue(
  value: unknown,
  key: "horizontal" | "vertical" | "wrapText",
) {
  return isRecord(value) ? value[key] : undefined;
}

function getCellTextColor(cell?: SpreadsheetCellExportModel) {
  if (!cell?.font) {
    return undefined;
  }

  return getExcelColor(isRecord(cell.font) ? cell.font.color : undefined);
}

function getCellBackgroundColor(cell?: SpreadsheetCellExportModel) {
  if (!cell?.fill || !isRecord(cell.fill)) {
    return undefined;
  }

  return getExcelColor(cell.fill.fgColor) || getExcelColor(cell.fill.bgColor);
}

function getCellStyle(cell?: SpreadsheetCellExportModel): React.CSSProperties {
  const style: React.CSSProperties = {};

  const textColor = getCellTextColor(cell);
  if (textColor) {
    style.color = textColor;
  }

  const backgroundColor = getCellBackgroundColor(cell);
  if (backgroundColor) {
    style.background = backgroundColor;
  }

  if (cell?.font && isRecord(cell.font)) {
    if (typeof cell.font.name === "string") {
      style.fontFamily = cell.font.name;
    }
    if (typeof cell.font.size === "number") {
      style.fontSize = `${cell.font.size}px`;
    }
    if (cell.font.bold) {
      style.fontWeight = 700;
    }
    if (cell.font.italic) {
      style.fontStyle = "italic";
    }
    if (cell.font.underline) {
      style.textDecoration = "underline";
    }
    if (cell.font.strike) {
      style.textDecoration = style.textDecoration
        ? `${style.textDecoration} line-through`
        : "line-through";
    }
  }

  if (cell?.alignment) {
    const horizontal = getAlignmentValue(cell.alignment, "horizontal");
    const vertical = getAlignmentValue(cell.alignment, "vertical");
    const wrapText = getAlignmentValue(cell.alignment, "wrapText");

    if (typeof horizontal === "string") {
      style.textAlign =
        horizontal === "center" ? "center" : horizontal === "right" ? "right" : "left";
    }

    if (typeof vertical === "string") {
      style.verticalAlign =
        vertical === "middle" ? "middle" : vertical === "bottom" ? "bottom" : "top";
    }

    if (wrapText === true) {
      style.whiteSpace = "pre-wrap";
    }
  }

  if (cell?.hyperlink && !style.color) {
    style.color = "#1d4ed8";
    style.textDecoration = style.textDecoration
      ? `${style.textDecoration} underline`
      : "underline";
  }

  return style;
}

function buildSheetModelFromExcelWorksheet(worksheet: ExcelJS.Worksheet): SheetModel {
  const dimensions = worksheet.dimensions;
  const rowCount = Math.max(dimensions?.bottom ?? worksheet.rowCount ?? 1, 1);
  const colCount = Math.max(dimensions?.right ?? worksheet.columnCount ?? 1, 1);
  const renderedRowCount = Math.min(rowCount, MAX_RENDER_ROWS);
  const renderedColCount = Math.min(colCount, MAX_RENDER_COLS);
  const data = createEmptyGrid(renderedRowCount, renderedColCount);
  const cells: Record<string, SpreadsheetCellExportModel> = {};

  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber > rowCount) {
      return;
    }

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > colCount) {
        return;
      }

      const model = createCellModelFromExcelCell(cell);
      if (!model) {
        return;
      }

      const rowIndex = rowNumber - 1;
      const colIndex = colNumber - 1;
      const key = makeCellKey(rowIndex, colIndex);
      cells[key] = model;

      if (rowIndex < renderedRowCount && colIndex < renderedColCount) {
        data[rowIndex][colIndex] = model.displayValue;
      }
    });
  });

  const colWidths = Array.from({ length: colCount }, (_, index) => {
    const column = worksheet.getColumn(index + 1);
    if (column.hidden) {
      return 0;
    }
    const width = Number(column.width ?? 12);
    return Math.max(64, Math.round(width * 7));
  });

  const rowHeights = Array.from({ length: rowCount }, (_, index) => {
    const row = worksheet.getRow(index + 1);
    if (row.hidden) {
      return 0;
    }
    return row.height
      ? Math.max(20, Math.round(Number(row.height) / 0.75))
      : 32;
  });

  const mergeRanges = Array.isArray(worksheet.model?.merges)
    ? worksheet.model.merges
    : [];

  return {
    name: worksheet.name,
    data,
    cells,
    rowCount,
    colCount,
    renderedRowCount,
    renderedColCount,
    merges: mergeRanges.map((range) => {
      const decoded = XLSX.utils.decode_range(range);
      return {
        startRow: decoded.s.r,
        startCol: decoded.s.c,
        endRow: decoded.e.r,
        endCol: decoded.e.c,
      };
    }),
    colWidths,
    rowHeights,
  };
}

function buildSheetModelsFromXlsxWorkbook(workbook: XLSX.WorkBook): SheetModel[] {
  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const decodedRange = worksheet["!ref"]
      ? XLSX.utils.decode_range(worksheet["!ref"])
      : XLSX.utils.decode_range("A1");
    const rowCount = Math.max(decodedRange.e.r + 1, 1);
    const colCount = Math.max(decodedRange.e.c + 1, 1);
    const renderedRowCount = Math.min(rowCount, MAX_RENDER_ROWS);
    const renderedColCount = Math.min(colCount, MAX_RENDER_COLS);
    const data = createEmptyGrid(renderedRowCount, renderedColCount);
    const cells: Record<string, SpreadsheetCellExportModel> = {};

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const cell = worksheet[address];
        if (!cell) {
          continue;
        }

        const model = createCellModelFromXlsxCell(address, cell);
        if (!model) {
          continue;
        }

        const key = makeCellKey(rowIndex, colIndex);
        cells[key] = model;

        if (rowIndex < renderedRowCount && colIndex < renderedColCount) {
          data[rowIndex][colIndex] = model.displayValue;
        }
      }
    }

    const colWidths = Array.from({ length: colCount }, (_, index) => {
      const width = worksheet["!cols"]?.[index];
      if (width?.hidden) {
        return 0;
      }
      return width?.wpx ?? Math.max(64, Math.round((width?.wch ?? 12) * 8));
    });

    const rowHeights = Array.from({ length: rowCount }, (_, index) => {
      const height = worksheet["!rows"]?.[index];
      if (height?.hidden) {
        return 0;
      }
      return height?.hpx ?? 32;
    });

    return {
      name,
      data,
      cells,
      rowCount,
      colCount,
      renderedRowCount,
      renderedColCount,
      merges: (worksheet["!merges"] ?? []).map((merge) => ({
        startRow: merge.s.r,
        startCol: merge.s.c,
        endRow: merge.e.r,
        endCol: merge.e.c,
      })),
      colWidths,
      rowHeights,
    };
  });
}

async function buildSheetModels(arrayBuffer: ArrayBuffer, fileName: string) {
  const isNativeXlsx = fileName.toLowerCase().endsWith(".xlsx");

  if (isNativeXlsx) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer.slice(0));
      if (workbook.worksheets.length > 0) {
        return workbook.worksheets.map(buildSheetModelFromExcelWorksheet);
      }
    } catch (error) {
      console.warn("ExcelJS parse failed, falling back to xlsx", error);
    }
  }

  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    cellStyles: true,
    cellFormula: true,
    cellDates: true,
    sheetStubs: true,
  });

  return buildSheetModelsFromXlsxWorkbook(workbook);
}

export function SpreadsheetEditor(props: SpreadsheetEditorProps) {
  const readonly = props.mode === "view";
  const [sheets, setSheets] = useState<SheetModel[]>([]);
  const [activeCell, setActiveCell] = useState({ row: 0, col: 0 });
  const [hasEdits, setHasEdits] = useState(false);
  const [dirtyCellAddressesBySheet, setDirtyCellAddressesBySheet] = useState<
    Record<string, string[]>
  >({});

  useEffect(() => {
    if (!props.arrayBuffer) {
      setSheets([]);
      setHasEdits(false);
      setDirtyCellAddressesBySheet({});
      props.onPageCount(1);
      props.onThumbs([]);
      return;
    }

    let cancelled = false;

    const loadSheets = async () => {
      try {
        const nextSheets = await buildSheetModels(props.arrayBuffer!, props.fileName);
        if (cancelled) {
          return;
        }

        setSheets(nextSheets);
        setHasEdits(false);
        setDirtyCellAddressesBySheet({});
        props.onPageCount(Math.max(nextSheets.length, 1));
        props.onThumbs(nextSheets.map(makeSheetThumbnail));
        if (props.currentPage > nextSheets.length) {
          props.onCurrentPageChange(1);
        }
        setActiveCell({ row: 0, col: 0 });
      } catch (error) {
        console.error("Spreadsheet load error:", error);
        if (cancelled) {
          return;
        }
        setSheets([]);
        setHasEdits(false);
        setDirtyCellAddressesBySheet({});
        props.onPageCount(1);
        props.onThumbs([]);
      }
    };

    void loadSheets();

    return () => {
      cancelled = true;
    };
  }, [
    props.arrayBuffer,
    props.fileName,
    props.onCurrentPageChange,
    props.onPageCount,
    props.onThumbs,
  ]);

  useEffect(() => {
    props.onExportStateChange?.(
      sheets.length > 0
        ? {
            sheets,
            sourceArrayBuffer: props.arrayBuffer,
            sourceFileType: props.fileName.toLowerCase().endsWith(".xlsx")
              ? "xlsx"
              : props.fileName.toLowerCase().endsWith(".xls")
                ? "xls"
                : props.fileName.toLowerCase().endsWith(".csv")
                  ? "csv"
                  : undefined,
            hasEdits,
            dirtyCellAddressesBySheet,
          }
        : null,
    );

    return () => {
      props.onExportStateChange?.(null);
    };
  }, [
    dirtyCellAddressesBySheet,
    hasEdits,
    props.arrayBuffer,
    props.fileName,
    props.onExportStateChange,
    sheets,
  ]);

  const activeSheetIndex = Math.max(
    0,
    Math.min(props.currentPage - 1, Math.max(sheets.length - 1, 0)),
  );
  const activeSheet = sheets[activeSheetIndex];

  const mergeLookup = useMemo(
    () => createMergeLookup(activeSheet?.merges ?? []),
    [activeSheet],
  );

  const activeCellModel = activeSheet?.cells[makeCellKey(activeCell.row, activeCell.col)];
  const activeCellValue = getCellInputValue(activeCellModel);

  const updateCell = (row: number, col: number, value: string) => {
    setHasEdits(true);
    const address = XLSX.utils.encode_cell({ r: row, c: col });
    const activeSheetName = sheets[activeSheetIndex]?.name;
    if (activeSheetName) {
      setDirtyCellAddressesBySheet((prev) => {
        const next = new Set(prev[activeSheetName] ?? []);
        next.add(address);
        return {
          ...prev,
          [activeSheetName]: Array.from(next),
        };
      });
    }
    setSheets((prev) =>
      prev.map((sheet, index) => {
        if (index !== activeSheetIndex) {
          return sheet;
        }

        const nextData = sheet.data.map((sheetRow) => [...sheetRow]);
        const nextCells = { ...sheet.cells };
        const cellKey = makeCellKey(row, col);
        const nextCell = buildEditedCellModel(address, value, nextCells[cellKey]);

        if (nextCell) {
          nextCells[cellKey] = nextCell;
        } else {
          delete nextCells[cellKey];
        }

        if (row < sheet.renderedRowCount && col < sheet.renderedColCount) {
          nextData[row][col] = nextCell?.displayValue ?? "";
        }

        return {
          ...sheet,
          data: nextData,
          cells: nextCells,
        };
      }),
    );
  };

  if (!activeSheet) {
    return (
      <div className="hv-view-single">
        <div className="hv-page-container" style={{ padding: "48px" }}>
          <p className="hv-empty-state">{props.locale["documents.sheetMissing"]}</p>
        </div>
      </div>
    );
  }

  const isTruncated =
    activeSheet.rowCount > activeSheet.renderedRowCount ||
    activeSheet.colCount > activeSheet.renderedColCount;

  return (
    <div className="hv-view-single">
      <div className="hv-page-container hv-sheet-container">
        <div className="hv-sheet-tabs">
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              type="button"
              className={`hv-sheet-tab ${index === activeSheetIndex ? "active" : ""}`}
              onClick={() => {
                props.onCurrentPageChange(index + 1);
                setActiveCell({ row: 0, col: 0 });
              }}
            >
              {sheet.name}
            </button>
          ))}
        </div>

        <div className="hv-sheet-formula-bar">
          <div className="hv-sheet-formula-cell">
            {toColumnLabel(activeCell.col)}
            {activeCell.row + 1}
          </div>
          <input
            value={activeCellValue}
            readOnly={readonly}
            onChange={(event) =>
              updateCell(activeCell.row, activeCell.col, event.target.value)
            }
            className="hv-sheet-formula-input"
          />
        </div>

        {isTruncated && (
          <div className="hv-sheet-viewport-note">
            {props.locale["documents.sheetTruncated"]
              .replace("{rows}", String(activeSheet.renderedRowCount))
              .replace("{cols}", String(activeSheet.renderedColCount))}
          </div>
        )}

        <div className="hv-sheet-scroll">
          <div className="hv-sheet-surface">
            <table className="hv-sheet-table">
              <thead>
                <tr>
                  <th className="hv-sheet-corner" />
                  {Array.from(
                    { length: activeSheet.renderedColCount },
                    (_, colIndex) => (
                      <th
                        key={toColumnLabel(colIndex)}
                        className="hv-sheet-column-header"
                        style={{
                          minWidth: activeSheet.colWidths[colIndex] ?? 96,
                          width: activeSheet.colWidths[colIndex] ?? 96,
                        }}
                      >
                        {toColumnLabel(colIndex)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {activeSheet.data.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    style={{ height: activeSheet.rowHeights[rowIndex] ?? 32 }}
                  >
                    <td className="hv-sheet-row-header">{rowIndex + 1}</td>
                    {row.map((cellValue, colIndex) => {
                      const cellKey = makeCellKey(rowIndex, colIndex);
                      if (mergeLookup.covered.has(cellKey)) {
                        return null;
                      }

                      const merge = mergeLookup.starts.get(cellKey);
                      const cellModel = activeSheet.cells[cellKey];
                      const width = activeSheet.colWidths[colIndex] ?? 96;

                      return (
                        <td
                          key={cellKey}
                          rowSpan={merge ? merge.endRow - merge.startRow + 1 : 1}
                          colSpan={merge ? merge.endCol - merge.startCol + 1 : 1}
                          className={`hv-sheet-cell ${activeCell.row === rowIndex && activeCell.col === colIndex ? "active" : ""}`}
                          contentEditable={!readonly}
                          suppressContentEditableWarning
                          onFocus={() => setActiveCell({ row: rowIndex, col: colIndex })}
                          onClick={() => setActiveCell({ row: rowIndex, col: colIndex })}
                          onBlur={(event) =>
                            updateCell(rowIndex, colIndex, event.currentTarget.innerText)
                          }
                          title={cellModel?.note || cellModel?.hyperlink || cellModel?.formula}
                          style={{
                            minWidth: width,
                            width,
                            ...getCellStyle(cellModel),
                          }}
                        >
                          {cellValue}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <SignatureOverlay
              surfaceKey={`sheet:${activeSheet.name}`}
              surfaceKind="sheet"
              sheetName={activeSheet.name}
              placements={props.signatureOverlay.placements}
              annotations={props.signatureOverlay.annotations}
              pendingSignature={props.signatureOverlay.pendingSignature}
              pendingAnnotation={props.signatureOverlay.pendingAnnotation}
              activePlacementId={props.signatureOverlay.activePlacementId}
              activeAnnotationId={props.signatureOverlay.activeAnnotationId}
              placeHint={props.signatureOverlay.placeHint}
              annotationHint={props.signatureOverlay.annotationHint}
              annotationPlaceholder={props.signatureOverlay.annotationPlaceholder}
              signatureAltLabel={props.signatureOverlay.signatureAltLabel}
              signatureAltByLabel={props.signatureOverlay.signatureAltByLabel}
              signatureNoteIndicatorLabel={
                props.signatureOverlay.signatureNoteIndicatorLabel
              }
              removeSignatureLabel={props.signatureOverlay.removeSignatureLabel}
              annotationTitle={props.signatureOverlay.annotationTitle}
              linkedAnnotationTitle={props.signatureOverlay.linkedAnnotationTitle}
              linkedAnnotationBadge={props.signatureOverlay.linkedAnnotationBadge}
              openAnnotationLabel={props.signatureOverlay.openAnnotationLabel}
              removeAnnotationLabel={props.signatureOverlay.removeAnnotationLabel}
              onPlaceSignature={props.signatureOverlay.onPlaceSignature}
              onPlaceAnnotation={props.signatureOverlay.onPlaceAnnotation}
              onUpdatePlacement={props.signatureOverlay.onUpdatePlacement}
              onUpdateAnnotation={props.signatureOverlay.onUpdateAnnotation}
              onRemovePlacement={props.signatureOverlay.onRemovePlacement}
              onRemoveAnnotation={props.signatureOverlay.onRemoveAnnotation}
              onSelectPlacement={props.signatureOverlay.onSelectPlacement}
              onSelectAnnotation={props.signatureOverlay.onSelectAnnotation}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
