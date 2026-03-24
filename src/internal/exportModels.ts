export interface RichTextPageRenderModel {
  pageNumber: number;
  surfaceKey: string;
  imageUrl: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
}

export interface RichTextExportState {
  container: HTMLDivElement | null;
  contentHtml: string;
  pages?: RichTextPageRenderModel[];
}

export interface PptxRunModel {
  text: string;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface PptxParagraphModel {
  runs: PptxRunModel[];
  align?: string;
  level: number;
  bullet: boolean;
}

export interface PptxSlideElementModel {
  id: string;
  kind: "shape" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill?: string;
  stroke?: string;
  paragraphs?: PptxParagraphModel[];
  imageSrc?: string;
  alt?: string;
}

export interface PptxSlideModel {
  background?: string;
  elements: PptxSlideElementModel[];
  title?: string;
  summary?: string;
}

export interface PptxExportState {
  slideSize: {
    width: number;
    height: number;
  };
  slides: PptxSlideModel[];
  sourceArrayBuffer?: ArrayBuffer;
  sourceFileType?: "pptx" | "ppt";
}

export interface SpreadsheetMergeModel {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface SpreadsheetCellExportModel {
  address: string;
  displayValue: string;
  value: unknown;
  valueKind:
    | "blank"
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "formula"
    | "hyperlink"
    | "richText"
    | "error"
    | "unknown";
  formula?: string;
  result?: unknown;
  hyperlink?: string;
  note?: string;
  numFmt?: string;
  font?: unknown;
  fill?: unknown;
  alignment?: unknown;
  border?: unknown;
}

export interface SpreadsheetSheetExportModel {
  name: string;
  data: string[][];
  cells: Record<string, SpreadsheetCellExportModel>;
  merges: SpreadsheetMergeModel[];
  colWidths: number[];
  rowHeights: number[];
  rowCount: number;
  colCount: number;
  renderedRowCount: number;
  renderedColCount: number;
}

export interface SpreadsheetExportState {
  sheets: SpreadsheetSheetExportModel[];
  sourceArrayBuffer?: ArrayBuffer;
  sourceFileType?: "xlsx" | "xls" | "csv";
  hasEdits: boolean;
  dirtyCellAddressesBySheet?: Record<string, string[]>;
}
