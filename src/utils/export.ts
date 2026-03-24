"use client";

import { Document, ImageRun, Packer, PageBreak, Paragraph } from "docx";
import ExcelJS from "exceljs";
import html2canvas from "html2canvas";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import * as XLSX from "xlsx";
import type {
  PptxExportState,
  PptxParagraphModel,
  RichTextPageRenderModel,
  SpreadsheetExportState,
  SpreadsheetCellExportModel,
  SpreadsheetMergeModel,
  SpreadsheetSheetExportModel,
} from "../internal/exportModels";
import type {
  AnnotationPlacement,
  SignaturePlacement,
  SupportedFileType,
} from "../types";
import { arrayBufferToBase64 } from "./fileSource";

const EMU_PER_INCH = 914400;
const EMU_PER_PIXEL = 9525;
const SHEET_ROW_HEADER_WIDTH = 48;
const SHEET_COLUMN_HEADER_HEIGHT = 34;
const NS_PML = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_DML = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_SML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const NS_REL_OFFICE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_REL_PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_TYPE_IMAGE = `${NS_REL_OFFICE}/image`;
const REL_TYPE_DRAWING = `${NS_REL_OFFICE}/drawing`;
const REL_TYPE_SLIDE = `${NS_REL_OFFICE}/slide`;
let pdfWorkerBlobUrlPromise: Promise<string> | null = null;

type PptxSlideHandle = {
  background?: { color?: string };
  addImage: (options: Record<string, unknown>) => void;
  addText: (text: string, options: Record<string, unknown>) => void;
  addShape: (shape: string, options: Record<string, unknown>) => void;
};

type PptxGenInstance = {
  layout: string;
  author?: string;
  subject?: string;
  title?: string;
  defineLayout: (options: { name: string; width: number; height: number }) => void;
  addSlide: () => PptxSlideHandle;
  write: (options: {
    outputType: "base64";
    compression?: boolean;
  }) => Promise<string> | string;
};

type PptxGenConstructor = new () => PptxGenInstance;

declare global {
  interface Window {
    PptxGenJS?: PptxGenConstructor;
  }
}

export interface ExportedDocument {
  base64: string;
  fileName: string;
  fileType: SupportedFileType;
  mimeType: string;
  exportedAsPdf?: boolean;
}

interface ExportLocaleLabels {
  annotationTitle: string;
  linkedAnnotationTitle: string;
  linkedAnnotationBadge: string;
  annotationAltLabel: string;
  linkedAnnotationAltLabel: string;
}

const defaultExportLocaleLabels: ExportLocaleLabels = {
  annotationTitle: "Annotation",
  linkedAnnotationTitle: "Signature Note",
  linkedAnnotationBadge: "Linked",
  annotationAltLabel: "Annotation",
  linkedAnnotationAltLabel: "Signature annotation",
};

async function ensurePdfWorker() {
  if (GlobalWorkerOptions.workerSrc) {
    return GlobalWorkerOptions.workerSrc;
  }

  if (!pdfWorkerBlobUrlPromise) {
    pdfWorkerBlobUrlPromise = import("../../generated/pdfWorkerBundle")
      .then(({ pdfWorkerBundleSource }) =>
        URL.createObjectURL(
          new Blob([pdfWorkerBundleSource], { type: "text/javascript" }),
        ),
      )
      .catch((error) => {
        pdfWorkerBlobUrlPromise = null;
        throw error;
      });
  }

  GlobalWorkerOptions.workerSrc = await pdfWorkerBlobUrlPromise;
  return GlobalWorkerOptions.workerSrc;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stripHash(color?: string, fallback = "000000") {
  return (color || fallback).replace(/^#/, "");
}

function replaceExtension(fileName: string, extension: string) {
  const cleanExtension = extension.replace(/^\./, "");
  if (!fileName.includes(".")) {
    return `${fileName}.${cleanExtension}`;
  }

  return fileName.replace(/\.[^.]+$/, `.${cleanExtension}`);
}

function mimeTypeForFileType(fileType: SupportedFileType) {
  switch (fileType) {
    case "pdf":
      return "application/pdf";
    case "doc":
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt":
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    case "rtf":
      return "application/rtf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "csv":
      return "text/csv";
    case "xml":
      return "application/xml";
    default:
      return "application/octet-stream";
  }
}

function toArrayBuffer(value: ArrayBuffer | SharedArrayBuffer | Uint8Array) {
  if (value instanceof ArrayBuffer) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Uint8Array.from(value).buffer;
  }

  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) {
    return new Uint8Array(value).slice().buffer;
  }

  return new Uint8Array(value).slice().buffer;
}

function parseXmlDocument(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function serializeXmlDocument(document: XMLDocument) {
  const xml = new XMLSerializer().serializeToString(document);
  return xml.startsWith("<?xml")
    ? xml
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`;
}

function resolveZipPath(basePath: string, target: string) {
  const normalizedBase = basePath.split("/").filter(Boolean);
  normalizedBase.pop();

  for (const segment of target.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalizedBase.pop();
    } else {
      normalizedBase.push(segment);
    }
  }

  return normalizedBase.join("/");
}

async function ensureContentTypeDefault(
  zip: JSZip,
  extension: string,
  contentType: string,
) {
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) {
    return;
  }

  const contentTypesDoc = parseXmlDocument(await contentTypesFile.async("string"));
  const root = contentTypesDoc.documentElement;
  if (!root) {
    return;
  }
  const namespace = root.namespaceURI ?? null;

  const existing = Array.from(
    root.getElementsByTagNameNS(namespace ?? "*", "Default"),
  ).some(
    (node) =>
      node.getAttribute("Extension") === extension &&
      node.getAttribute("ContentType") === contentType,
  );

  if (!existing) {
    const child = contentTypesDoc.createElementNS(namespace, "Default");
    child.setAttribute("Extension", extension);
    child.setAttribute("ContentType", contentType);
    root.appendChild(child);
    zip.file("[Content_Types].xml", serializeXmlDocument(contentTypesDoc));
  }
}

async function ensureContentTypeOverride(
  zip: JSZip,
  partName: string,
  contentType: string,
) {
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) {
    return;
  }

  const contentTypesDoc = parseXmlDocument(await contentTypesFile.async("string"));
  const root = contentTypesDoc.documentElement;
  if (!root) {
    return;
  }
  const namespace = root.namespaceURI ?? null;

  const existing = Array.from(
    root.getElementsByTagNameNS(namespace ?? "*", "Override"),
  ).some(
    (node) =>
      node.getAttribute("PartName") === partName &&
      node.getAttribute("ContentType") === contentType,
  );

  if (!existing) {
    const child = contentTypesDoc.createElementNS(namespace, "Override");
    child.setAttribute("PartName", partName);
    child.setAttribute("ContentType", contentType);
    root.appendChild(child);
    zip.file("[Content_Types].xml", serializeXmlDocument(contentTypesDoc));
  }
}

function getNextSequentialPath(
  zip: JSZip,
  directory: string,
  basename: string,
  extension: string,
) {
  let index = 1;
  let nextPath = `${directory}/${basename}${index}.${extension}`;

  while (zip.file(nextPath)) {
    index += 1;
    nextPath = `${directory}/${basename}${index}.${extension}`;
  }

  return nextPath;
}

async function getOrCreateRelationshipsDocument(zip: JSZip, relsPath: string) {
  const relsFile = zip.file(relsPath);
  if (relsFile) {
    return parseXmlDocument(await relsFile.async("string"));
  }

  return parseXmlDocument(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
  );
}

function getNextRelationshipId(document: XMLDocument) {
  const ids = Array.from(document.getElementsByTagName("Relationship"))
    .map((node) => node.getAttribute("Id") || "")
    .map((value) => Number(value.match(/(\d+)$/)?.[1] || "0"));
  const next = (ids.length > 0 ? Math.max(...ids) : 0) + 1;
  return `rId${next}`;
}

function appendRelationship(
  document: XMLDocument,
  type: string,
  target: string,
) {
  const root = document.documentElement;
  const relationship = document.createElementNS(NS_REL_PACKAGE, "Relationship");
  const nextId = getNextRelationshipId(document);
  relationship.setAttribute("Id", nextId);
  relationship.setAttribute("Type", type);
  relationship.setAttribute("Target", target);
  root.appendChild(relationship);
  return nextId;
}

function getMaxAttributeNumber(
  document: XMLDocument,
  tagName: string,
  attribute: string,
) {
  return Array.from(document.getElementsByTagName("*"))
    .filter((element) => element.localName === tagName)
    .map((element) => Number(element.getAttribute(attribute) || "0"))
    .reduce((max, value) => Math.max(max, value), 0);
}

function dataUrlToUint8Array(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

async function getOrderedPptSlidePaths(zip: JSZip) {
  const presentationXml = zip.file("ppt/presentation.xml");
  const presentationRelsXml = zip.file("ppt/_rels/presentation.xml.rels");
  if (!presentationXml || !presentationRelsXml) {
    return Object.keys(zip.files)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .sort((left, right) => {
        const leftNumber = Number(left.match(/slide(\d+)/)?.[1] || "0");
        const rightNumber = Number(right.match(/slide(\d+)/)?.[1] || "0");
        return leftNumber - rightNumber;
      });
  }

  const presentationDoc = parseXmlDocument(await presentationXml.async("string"));
  const relsDoc = parseXmlDocument(await presentationRelsXml.async("string"));
  const relMap = new Map<string, string>();
  for (const node of Array.from(relsDoc.getElementsByTagName("Relationship"))) {
    const id = node.getAttribute("Id");
    const target = node.getAttribute("Target");
    const type = node.getAttribute("Type");
    if (!id || !target || type !== REL_TYPE_SLIDE) {
      continue;
    }
    relMap.set(id, resolveZipPath("ppt/presentation.xml", target));
  }

  return Array.from(presentationDoc.getElementsByTagNameNS(NS_PML, "sldId"))
    .map((node) => node.getAttributeNS(NS_REL_OFFICE, "id") || node.getAttribute("r:id"))
    .map((id) => (id ? relMap.get(id) : undefined))
    .filter((path): path is string => Boolean(path));
}

async function getWorkbookSheetInfos(zip: JSZip) {
  const workbookXml = zip.file("xl/workbook.xml");
  const workbookRelsXml = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !workbookRelsXml) {
    return [];
  }

  const workbookDoc = parseXmlDocument(await workbookXml.async("string"));
  const relsDoc = parseXmlDocument(await workbookRelsXml.async("string"));
  const relMap = new Map<string, string>();
  for (const node of Array.from(relsDoc.getElementsByTagName("Relationship"))) {
    const id = node.getAttribute("Id");
    const target = node.getAttribute("Target");
    if (!id || !target) {
      continue;
    }
    relMap.set(id, resolveZipPath("xl/workbook.xml", target));
  }

  return Array.from(workbookDoc.getElementsByTagNameNS(NS_SML, "sheet"))
    .map((node) => ({
      name: node.getAttribute("name") || "",
      path:
        relMap.get(
          node.getAttributeNS(NS_REL_OFFICE, "id") || node.getAttribute("r:id") || "",
        ) || "",
    }))
    .filter((sheet) => sheet.name && sheet.path);
}

async function getOrCreateSheetDrawingDocument(zip: JSZip, drawingPath: string) {
  const drawingFile = zip.file(drawingPath);
  if (drawingFile) {
    return parseXmlDocument(await drawingFile.async("string"));
  }

  return parseXmlDocument(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>',
  );
}

function toRelativeZipTarget(fromPath: string, toPath: string) {
  const fromParts = fromPath.split("/").filter(Boolean);
  const toParts = toPath.split("/").filter(Boolean);
  fromParts.pop();

  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }

  return `${"../".repeat(fromParts.length)}${toParts.join("/")}`;
}

function pixelOffsetToAnchor(
  offset: number,
  sizes: number[],
) {
  let remaining = Math.max(offset, 0);
  for (let index = 0; index < sizes.length; index += 1) {
    const size = Math.max(sizes[index] || 0, 1);
    if (remaining <= size || index === sizes.length - 1) {
      return {
        index,
        offsetEmu: Math.round(Math.min(remaining, size) * EMU_PER_PIXEL),
      };
    }
    remaining -= size;
  }

  return { index: 0, offsetEmu: 0 };
}

function buildSpreadsheetAnchor(
  x: number,
  y: number,
  width: number,
  height: number,
  colWidths: number[],
  rowHeights: number[],
) {
  const fromCol = pixelOffsetToAnchor(x, colWidths);
  const fromRow = pixelOffsetToAnchor(y, rowHeights);
  const toCol = pixelOffsetToAnchor(x + width, colWidths);
  const toRow = pixelOffsetToAnchor(y + height, rowHeights);

  return {
    from: {
      col: fromCol.index,
      colOff: fromCol.offsetEmu,
      row: fromRow.index,
      rowOff: fromRow.offsetEmu,
    },
    to: {
      col: toCol.index,
      colOff: toCol.offsetEmu,
      row: toRow.index,
      rowOff: toRow.offsetEmu,
    },
  };
}

function appendTextElement(
  document: XMLDocument,
  parent: Element,
  namespace: string,
  qualifiedName: string,
  value: string | number,
) {
  const element = document.createElementNS(namespace, qualifiedName);
  element.textContent = String(value);
  parent.appendChild(element);
  return element;
}

function createPptOverlayPictureNode(args: {
  document: XMLDocument;
  relationshipId: string;
  shapeId: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description?: string;
}) {
  const picture = args.document.createElementNS(NS_PML, "p:pic");
  const nvPicPr = args.document.createElementNS(NS_PML, "p:nvPicPr");
  const cNvPr = args.document.createElementNS(NS_PML, "p:cNvPr");
  cNvPr.setAttribute("id", String(args.shapeId));
  cNvPr.setAttribute("name", args.name);
  if (args.description) {
    cNvPr.setAttribute("descr", args.description);
  }
  const cNvPicPr = args.document.createElementNS(NS_PML, "p:cNvPicPr");
  const picLocks = args.document.createElementNS(NS_DML, "a:picLocks");
  picLocks.setAttribute("noChangeAspect", "1");
  cNvPicPr.appendChild(picLocks);
  const nvPr = args.document.createElementNS(NS_PML, "p:nvPr");
  nvPicPr.append(cNvPr, cNvPicPr, nvPr);

  const blipFill = args.document.createElementNS(NS_PML, "p:blipFill");
  const blip = args.document.createElementNS(NS_DML, "a:blip");
  blip.setAttributeNS(NS_REL_OFFICE, "r:embed", args.relationshipId);
  const stretch = args.document.createElementNS(NS_DML, "a:stretch");
  stretch.appendChild(args.document.createElementNS(NS_DML, "a:fillRect"));
  blipFill.append(blip, stretch);

  const spPr = args.document.createElementNS(NS_PML, "p:spPr");
  const xfrm = args.document.createElementNS(NS_DML, "a:xfrm");
  const off = args.document.createElementNS(NS_DML, "a:off");
  off.setAttribute("x", String(Math.round(args.x)));
  off.setAttribute("y", String(Math.round(args.y)));
  const ext = args.document.createElementNS(NS_DML, "a:ext");
  ext.setAttribute("cx", String(Math.round(args.width)));
  ext.setAttribute("cy", String(Math.round(args.height)));
  xfrm.append(off, ext);
  const presetGeometry = args.document.createElementNS(NS_DML, "a:prstGeom");
  presetGeometry.setAttribute("prst", "rect");
  presetGeometry.appendChild(args.document.createElementNS(NS_DML, "a:avLst"));
  spPr.append(xfrm, presetGeometry);

  picture.append(nvPicPr, blipFill, spPr);
  return picture;
}

function createWorksheetOverlayNode(args: {
  document: XMLDocument;
  relationshipId: string;
  shapeId: number;
  name: string;
  anchor: ReturnType<typeof buildSpreadsheetAnchor>;
  description?: string;
}) {
  const anchor = args.document.createElementNS(NS_XDR, "xdr:twoCellAnchor");
  anchor.setAttribute("editAs", "oneCell");

  const from = args.document.createElementNS(NS_XDR, "xdr:from");
  appendTextElement(args.document, from, NS_XDR, "xdr:col", args.anchor.from.col);
  appendTextElement(args.document, from, NS_XDR, "xdr:colOff", args.anchor.from.colOff);
  appendTextElement(args.document, from, NS_XDR, "xdr:row", args.anchor.from.row);
  appendTextElement(args.document, from, NS_XDR, "xdr:rowOff", args.anchor.from.rowOff);

  const to = args.document.createElementNS(NS_XDR, "xdr:to");
  appendTextElement(args.document, to, NS_XDR, "xdr:col", args.anchor.to.col);
  appendTextElement(args.document, to, NS_XDR, "xdr:colOff", args.anchor.to.colOff);
  appendTextElement(args.document, to, NS_XDR, "xdr:row", args.anchor.to.row);
  appendTextElement(args.document, to, NS_XDR, "xdr:rowOff", args.anchor.to.rowOff);

  const pic = args.document.createElementNS(NS_XDR, "xdr:pic");
  const nvPicPr = args.document.createElementNS(NS_XDR, "xdr:nvPicPr");
  const cNvPr = args.document.createElementNS(NS_XDR, "xdr:cNvPr");
  cNvPr.setAttribute("id", String(args.shapeId));
  cNvPr.setAttribute("name", args.name);
  if (args.description) {
    cNvPr.setAttribute("descr", args.description);
  }
  const cNvPicPr = args.document.createElementNS(NS_XDR, "xdr:cNvPicPr");
  nvPicPr.append(cNvPr, cNvPicPr);

  const blipFill = args.document.createElementNS(NS_XDR, "xdr:blipFill");
  const blip = args.document.createElementNS(NS_DML, "a:blip");
  blip.setAttributeNS(NS_REL_OFFICE, "r:embed", args.relationshipId);
  const stretch = args.document.createElementNS(NS_DML, "a:stretch");
  stretch.appendChild(args.document.createElementNS(NS_DML, "a:fillRect"));
  blipFill.append(blip, stretch);

  const spPr = args.document.createElementNS(NS_XDR, "xdr:spPr");
  const presetGeometry = args.document.createElementNS(NS_DML, "a:prstGeom");
  presetGeometry.setAttribute("prst", "rect");
  presetGeometry.appendChild(args.document.createElementNS(NS_DML, "a:avLst"));
  spPr.appendChild(presetGeometry);

  pic.append(nvPicPr, blipFill, spPr);
  anchor.append(from, to, pic, args.document.createElementNS(NS_XDR, "xdr:clientData"));
  return anchor;
}

function getDirectChildElementsByLocalName(
  parent: ParentNode,
  localName: string,
) {
  return Array.from(parent.childNodes).filter(
    (node): node is Element =>
      node.nodeType === 1 && (node as Element).localName === localName,
  );
}

function getWorksheetChildElement(worksheet: Element, localName: string) {
  return getDirectChildElementsByLocalName(worksheet, localName)[0];
}

function removeElementChildrenByLocalName(
  parent: Element,
  localNames: string[],
) {
  for (const child of Array.from(parent.childNodes)) {
    if (
      child.nodeType === 1 &&
      localNames.includes((child as Element).localName || "")
    ) {
      parent.removeChild(child);
    }
  }
}

function getOrCreateWorksheetSheetData(
  document: XMLDocument,
  worksheet: Element,
) {
  const existing = getWorksheetChildElement(worksheet, "sheetData");
  if (existing) {
    return existing;
  }

  const sheetData = document.createElementNS(NS_SML, "sheetData");
  const insertionPointNames = new Set([
    "sheetCalcPr",
    "sheetProtection",
    "protectedRanges",
    "scenarios",
    "autoFilter",
    "sortState",
    "dataConsolidate",
    "customSheetViews",
    "mergeCells",
    "phoneticPr",
    "conditionalFormatting",
    "dataValidations",
    "hyperlinks",
    "printOptions",
    "pageMargins",
    "pageSetup",
    "headerFooter",
    "rowBreaks",
    "colBreaks",
    "customProperties",
    "cellWatches",
    "ignoredErrors",
    "smartTags",
    "drawing",
    "legacyDrawing",
    "legacyDrawingHF",
    "picture",
    "oleObjects",
    "controls",
    "webPublishItems",
    "tableParts",
    "extLst",
  ]);
  const nextSibling = Array.from(worksheet.childNodes).find(
    (node) =>
      node.nodeType === 1 &&
      insertionPointNames.has((node as Element).localName || ""),
  );

  if (nextSibling) {
    worksheet.insertBefore(sheetData, nextSibling);
  } else {
    worksheet.appendChild(sheetData);
  }

  return sheetData;
}

function getOrCreateWorksheetRow(
  document: XMLDocument,
  sheetData: Element,
  rowNumber: number,
) {
  const rows = getDirectChildElementsByLocalName(sheetData, "row");

  for (const row of rows) {
    const existingNumber = Number(row.getAttribute("r") || "0");
    if (existingNumber === rowNumber) {
      return row;
    }
    if (existingNumber > rowNumber) {
      const nextRow = document.createElementNS(NS_SML, "row");
      nextRow.setAttribute("r", String(rowNumber));
      sheetData.insertBefore(nextRow, row);
      return nextRow;
    }
  }

  const newRow = document.createElementNS(NS_SML, "row");
  newRow.setAttribute("r", String(rowNumber));
  sheetData.appendChild(newRow);
  return newRow;
}

function getOrCreateWorksheetCell(
  document: XMLDocument,
  row: Element,
  address: string,
) {
  const targetColumn = XLSX.utils.decode_cell(address).c;
  const cells = getDirectChildElementsByLocalName(row, "c");

  for (const cell of cells) {
    const reference = cell.getAttribute("r");
    if (reference === address) {
      return cell;
    }

    if (!reference) {
      continue;
    }

    const currentColumn = XLSX.utils.decode_cell(reference).c;
    if (currentColumn > targetColumn) {
      const nextCell = document.createElementNS(NS_SML, "c");
      nextCell.setAttribute("r", address);
      row.insertBefore(nextCell, cell);
      return nextCell;
    }
  }

  const newCell = document.createElementNS(NS_SML, "c");
  newCell.setAttribute("r", address);
  row.appendChild(newCell);
  return newCell;
}

function createSpreadsheetInlineStringNode(
  document: XMLDocument,
  value: string,
) {
  const inlineString = document.createElementNS(NS_SML, "is");
  const text = document.createElementNS(NS_SML, "t");
  if (/^\s|\s$|\n/.test(value)) {
    text.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve",
    );
  }
  text.textContent = value;
  inlineString.appendChild(text);
  return inlineString;
}

function setSpreadsheetCellValue(
  document: XMLDocument,
  cell: Element,
  model: SpreadsheetCellExportModel,
) {
  removeElementChildrenByLocalName(cell, ["f", "v", "is"]);

  if (model.valueKind === "blank") {
    cell.removeAttribute("t");
    return;
  }

  if (model.valueKind === "formula" && model.formula) {
    const formula = document.createElementNS(NS_SML, "f");
    formula.textContent = model.formula;
    cell.appendChild(formula);

    if (typeof model.result === "number") {
      cell.removeAttribute("t");
      appendTextElement(document, cell, NS_SML, "v", model.result);
      return;
    }

    if (typeof model.result === "boolean") {
      cell.setAttribute("t", "b");
      appendTextElement(document, cell, NS_SML, "v", model.result ? 1 : 0);
      return;
    }

    if (typeof model.result === "string") {
      cell.setAttribute("t", "str");
      appendTextElement(document, cell, NS_SML, "v", model.result);
      return;
    }

    cell.removeAttribute("t");
    return;
  }

  if (model.valueKind === "number" && typeof model.value === "number") {
    cell.removeAttribute("t");
    appendTextElement(document, cell, NS_SML, "v", model.value);
    return;
  }

  if (model.valueKind === "boolean" && typeof model.value === "boolean") {
    cell.setAttribute("t", "b");
    appendTextElement(document, cell, NS_SML, "v", model.value ? 1 : 0);
    return;
  }

  const stringValue =
    typeof model.displayValue === "string" && model.displayValue.length > 0
      ? model.displayValue
      : typeof model.value === "string"
        ? model.value
        : isRecord(model.value) && typeof model.value.text === "string"
          ? model.value.text
          : model.value == null
            ? ""
            : String(model.value);

  cell.setAttribute("t", "inlineStr");
  cell.appendChild(createSpreadsheetInlineStringNode(document, stringValue));
}

function removeWorksheetHyperlinksForAddress(
  worksheet: Element,
  address: string,
) {
  const hyperlinks = getWorksheetChildElement(worksheet, "hyperlinks");
  if (!hyperlinks) {
    return;
  }

  for (const hyperlink of getDirectChildElementsByLocalName(
    hyperlinks,
    "hyperlink",
  )) {
    if (hyperlink.getAttribute("ref") === address) {
      hyperlinks.removeChild(hyperlink);
    }
  }

  if (getDirectChildElementsByLocalName(hyperlinks, "hyperlink").length === 0) {
    worksheet.removeChild(hyperlinks);
  }
}

function applySpreadsheetWorksheetEdit(args: {
  document: XMLDocument;
  worksheet: Element;
  sheetData: Element;
  address: string;
  cellModel?: SpreadsheetCellExportModel;
}) {
  const decoded = XLSX.utils.decode_cell(args.address);
  const rowNumber = decoded.r + 1;
  const existingRow = getDirectChildElementsByLocalName(args.sheetData, "row").find(
    (candidate) => Number(candidate.getAttribute("r") || "0") === rowNumber,
  );
  const row =
    existingRow ||
    (args.cellModel
      ? getOrCreateWorksheetRow(args.document, args.sheetData, rowNumber)
      : null);
  const existingCell = row
    ? getDirectChildElementsByLocalName(row, "c").find(
        (cell) => cell.getAttribute("r") === args.address,
      )
    : undefined;

  if (!args.cellModel) {
    if (existingCell) {
      row!.removeChild(existingCell);
    }
    removeWorksheetHyperlinksForAddress(args.worksheet, args.address);
    return;
  }

  const cell =
    existingCell ||
    getOrCreateWorksheetCell(args.document, row!, args.address);
  setSpreadsheetCellValue(args.document, cell, args.cellModel);

  if (!args.cellModel.hyperlink) {
    removeWorksheetHyperlinksForAddress(args.worksheet, args.address);
  }
}

async function markWorkbookForFullCalculation(zip: JSZip) {
  const workbookFile = zip.file("xl/workbook.xml");
  if (!workbookFile) {
    return;
  }

  const workbookDoc = parseXmlDocument(await workbookFile.async("string"));
  const workbook = workbookDoc.getElementsByTagNameNS(NS_SML, "workbook")[0];
  if (!workbook) {
    return;
  }

  let calcPr = getDirectChildElementsByLocalName(workbook, "calcPr")[0];
  if (!calcPr) {
    calcPr = workbookDoc.createElementNS(NS_SML, "calcPr");
    workbook.appendChild(calcPr);
  }

  calcPr.setAttribute("calcMode", "auto");
  calcPr.setAttribute("calcId", "0");
  calcPr.setAttribute("fullCalcOnLoad", "1");
  calcPr.setAttribute("forceFullCalc", "1");

  zip.file("xl/workbook.xml", serializeXmlDocument(workbookDoc));
}

function ensureImageSource(source: string) {
  if (
    source.startsWith("data:") ||
    source.startsWith("blob:") ||
    source.startsWith("http:")
    || source.startsWith("https:")
  ) {
    return source;
  }

  return `data:image/png;base64,${source}`;
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

async function loadImage(source: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to load an image asset."));
    image.src = ensureImageSource(source);
  });

  if ("decode" in image) {
    try {
      await image.decode();
    } catch {
      // The load event already completed successfully.
    }
  }

  return image;
}

function getOpaqueImageBounds(
  image: HTMLImageElement,
  alphaThreshold = 8,
) {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return {
      sx: 0,
      sy: 0,
      sw: image.width,
      sh: image.height,
    };
  }

  ctx.drawImage(image, 0, 0, image.width, image.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const alpha = imageData[(y * canvas.width + x) * 4 + 3];
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
    return {
      sx: 0,
      sy: 0,
      sw: image.width,
      sh: image.height,
    };
  }

  const padding = Math.max(6, Math.round(Math.max(image.width, image.height) * 0.04));
  const sx = Math.max(0, minX - padding);
  const sy = Math.max(0, minY - padding);

  return {
    sx,
    sy,
    sw: Math.min(image.width - sx, maxX - minX + 1 + padding * 2),
    sh: Math.min(image.height - sy, maxY - minY + 1 + padding * 2),
  };
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to generate the export file."));
          return;
        }

        resolve(blob);
      },
      type,
      quality,
    );
  });
}

async function blobToBase64(blob: Blob) {
  return arrayBufferToBase64(await blob.arrayBuffer());
}

function formatSignedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
}

async function drawSignatureStamp(
  ctx: CanvasRenderingContext2D,
  placement: SignaturePlacement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const isSlideStamp = placement.surfaceKind === "slide";
  const radius = Math.max(8, Math.min(width, height) * 0.08);
  const padding = isSlideStamp ? Math.max(4, width * 0.03) : Math.max(8, width * 0.06);
  const footerHeight = Math.max(
    isSlideStamp ? 24 : 18,
    height * (isSlideStamp ? 0.3 : 0.22),
  );
  const signatureImage = await loadImage(placement.signature.signatureImageUrl);
  const imageBounds = getOpaqueImageBounds(signatureImage);
  const signer = placement.signature.signedBy?.trim() || "";
  const signedDate = formatSignedDate(placement.signature.dateSigned);

  if (!isSlideStamp) {
    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.18)";
    ctx.shadowBlur = Math.max(8, width * 0.08);
    ctx.shadowOffsetY = Math.max(4, height * 0.03);
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.fill();
    ctx.restore();

    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.lineWidth = Math.max(1, width * 0.01);
    ctx.strokeStyle = "rgba(30, 41, 59, 0.22)";
    ctx.stroke();
  }

  const imageAreaWidth = width - padding * 2;
  const imageAreaHeight = height - footerHeight - padding * (isSlideStamp ? 0.75 : 1.55);
  const imageScale = Math.min(
    imageAreaWidth / imageBounds.sw,
    imageAreaHeight / imageBounds.sh,
  );
  const imageWidth = imageBounds.sw * imageScale;
  const imageHeight = imageBounds.sh * imageScale;
  const imageX = x + (width - imageWidth) / 2;
  const imageBaseY = isSlideStamp ? y : y + padding;
  const imageY =
    imageBaseY +
    Math.max(imageAreaHeight - imageHeight, 0) * (isSlideStamp ? 0.82 : 0.35);

  ctx.drawImage(
    signatureImage,
    imageBounds.sx,
    imageBounds.sy,
    imageBounds.sw,
    imageBounds.sh,
    imageX,
    imageY,
    imageWidth,
    imageHeight,
  );

  const footerY = y + height - footerHeight;
  if (!isSlideStamp) {
    ctx.save();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
    ctx.lineWidth = Math.max(1, height * 0.01);
    ctx.beginPath();
    ctx.moveTo(x + padding, footerY);
    ctx.lineTo(x + width - padding, footerY);
    ctx.stroke();
    ctx.restore();
  }

  const nameFontSize = Math.max(
    isSlideStamp ? 14 : 10,
    height * (isSlideStamp ? 0.13 : 0.09),
  );
  const dateFontSize = Math.max(
    isSlideStamp ? 12 : 9,
    height * (isSlideStamp ? 0.118 : 0.076),
  );
  const footerTextY = footerY + footerHeight / 2 + (isSlideStamp ? 1 : 0);

  ctx.fillStyle = "#334155";
  ctx.font = `700 ${nameFontSize}px Arial, sans-serif`;
  ctx.textBaseline = "middle";
  if (signer) {
    ctx.fillText(signer, x + padding, footerTextY, width * 0.58);
  }

  ctx.font = `600 ${dateFontSize}px Arial, sans-serif`;
  const dateWidth = ctx.measureText(signedDate).width;
  ctx.fillText(
    signedDate,
    x + width - padding - dateWidth,
    footerTextY,
  );
}

async function drawPlacementsOnCanvas(
  ctx: CanvasRenderingContext2D,
  placements: SignaturePlacement[],
  surfaceWidth: number,
  surfaceHeight: number,
) {
  for (const placement of placements) {
    await drawSignatureStamp(
      ctx,
      placement,
      placement.x * surfaceWidth,
      placement.y * surfaceHeight,
      placement.width * surfaceWidth,
      placement.height * surfaceHeight,
    );
  }
}

function clipRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.clip();
}

function wrapTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const lines: string[] = [];
  const paragraphs = text.split(/\r?\n/);

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let currentLine = "";

    for (const word of words) {
      const nextLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(nextLine).width <= maxWidth) {
        currentLine = nextLine;
        continue;
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      if (ctx.measureText(word).width <= maxWidth) {
        currentLine = word;
        continue;
      }

      let remaining = word;
      while (remaining.length > 0) {
        let sliceLength = remaining.length;
        while (
          sliceLength > 1
          && ctx.measureText(remaining.slice(0, sliceLength)).width > maxWidth
        ) {
          sliceLength -= 1;
        }
        lines.push(remaining.slice(0, sliceLength));
        remaining = remaining.slice(sliceLength);
      }
      currentLine = "";
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

function drawEmptyAnnotationLines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(180, 83, 9, 0.32)";
  ctx.lineWidth = Math.max(1, lineHeight * 0.08);

  for (let index = 0; index < 3; index += 1) {
    const lineY = y + index * lineHeight;
    ctx.beginPath();
    ctx.moveTo(x, lineY);
    ctx.lineTo(x + width * (index === 2 ? 0.68 : 1), lineY);
    ctx.stroke();
  }

  ctx.restore();
}

async function drawAnnotationCard(
  ctx: CanvasRenderingContext2D,
  annotation: AnnotationPlacement,
  x: number,
  y: number,
  width: number,
  height: number,
  labels: ExportLocaleLabels = defaultExportLocaleLabels,
) {
  const radius = Math.max(10, Math.min(width, height) * 0.08);
  const padding = Math.max(10, width * 0.065);
  const headerHeight = Math.max(26, Math.min(height * 0.28, 42));
  const title = annotation.linkedSignaturePlacementId
    ? labels.linkedAnnotationTitle
    : labels.annotationTitle;
  const bodyText = annotation.text.trim();

  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.14)";
  ctx.shadowBlur = Math.max(8, width * 0.08);
  ctx.shadowOffsetY = Math.max(4, height * 0.03);
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = annotation.linkedSignaturePlacementId
    ? "rgba(254, 249, 195, 0.98)"
    : "rgba(255, 251, 235, 0.98)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  clipRoundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = "rgba(245, 158, 11, 0.18)";
  ctx.fillRect(x, y, width, headerHeight);
  ctx.restore();

  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.lineWidth = Math.max(1, width * 0.008);
  ctx.strokeStyle = "rgba(217, 119, 6, 0.34)";
  ctx.stroke();

  const titleFontSize = Math.max(10, height * 0.085);
  ctx.fillStyle = "#92400e";
  ctx.font = `700 ${titleFontSize}px Arial, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(title, x + padding, y + headerHeight / 2);

  if (annotation.linkedSignaturePlacementId) {
    const badge = labels.linkedAnnotationBadge;
    const badgeFontSize = Math.max(9, titleFontSize * 0.82);
    ctx.font = `700 ${badgeFontSize}px Arial, sans-serif`;
    const badgeWidth = ctx.measureText(badge).width + 16;
    const badgeHeight = Math.max(18, badgeFontSize * 1.9);
    const badgeX = x + width - padding - badgeWidth;
    const badgeY = y + (headerHeight - badgeHeight) / 2;
    roundedRectPath(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
    ctx.fillStyle = "rgba(217, 119, 6, 0.12)";
    ctx.fill();
    ctx.fillStyle = "#b45309";
    ctx.textAlign = "center";
    ctx.fillText(badge, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
    ctx.textAlign = "left";
  }

  const bodyFontSize = Math.max(11, height * 0.085);
  const lineHeight = bodyFontSize * 1.35;
  const bodyX = x + padding;
  const bodyY = y + headerHeight + padding * 0.65;
  const maxTextWidth = Math.max(width - padding * 2, 10);
  const maxLines = Math.max(
    1,
    Math.floor((height - headerHeight - padding * 1.4) / lineHeight),
  );

  if (!bodyText) {
    drawEmptyAnnotationLines(
      ctx,
      bodyX,
      bodyY + lineHeight * 0.3,
      maxTextWidth,
      lineHeight,
    );
    return;
  }

  const lines = wrapTextToWidth(ctx, bodyText, maxTextWidth).slice(0, maxLines);
  ctx.fillStyle = "#451a03";
  ctx.font = `500 ${bodyFontSize}px Arial, sans-serif`;
  ctx.textBaseline = "top";

  for (const [index, line] of lines.entries()) {
    ctx.fillText(line, bodyX, bodyY + index * lineHeight, maxTextWidth);
  }
}

async function drawAnnotationsOnCanvas(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationPlacement[],
  surfaceWidth: number,
  surfaceHeight: number,
  labels: ExportLocaleLabels = defaultExportLocaleLabels,
) {
  for (const annotation of annotations) {
    await drawAnnotationCard(
      ctx,
      annotation,
      annotation.x * surfaceWidth,
      annotation.y * surfaceHeight,
      annotation.width * surfaceWidth,
      annotation.height * surfaceHeight,
      labels,
    );
  }
}

async function createSignatureStampDataUrl(
  placement: SignaturePlacement,
  width?: number,
  height?: number,
) {
  const aspectRatio =
    placement.width > 0 && placement.height > 0
      ? placement.width / placement.height
      : 3.1;
  const targetHeight = height ?? (placement.surfaceKind === "slide" ? 320 : 260);
  const targetWidth = width ?? Math.max(480, Math.round(targetHeight * aspectRatio));
  const canvas = createCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to render the signature stamp.");
  }

  await drawSignatureStamp(ctx, placement, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/png");
}

async function createAnnotationCardDataUrl(
  annotation: AnnotationPlacement,
  width = 720,
  height = 360,
  labels: ExportLocaleLabels = defaultExportLocaleLabels,
) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to render the annotation.");
  }

  await drawAnnotationCard(ctx, annotation, 0, 0, width, height, labels);
  return canvas.toDataURL("image/png");
}

async function preserveNativePptxFile(args: {
  sourceArrayBuffer: ArrayBuffer;
  fileName: string;
  exportState: PptxExportState;
  placements: SignaturePlacement[];
  annotations: AnnotationPlacement[];
  labels: ExportLocaleLabels;
}) {
  const zip = await JSZip.loadAsync(args.sourceArrayBuffer.slice(0));
  const slidePaths = await getOrderedPptSlidePaths(zip);
  await ensureContentTypeDefault(zip, "png", "image/png");

  for (const [index, slidePath] of slidePaths.entries()) {
    const surfaceKey = `slide:${index + 1}`;
    const slidePlacements = args.placements.filter(
      (placement) => placement.surfaceKey === surfaceKey,
    );
    const slideAnnotations = args.annotations.filter(
      (annotation) => annotation.surfaceKey === surfaceKey,
    );

    if (slidePlacements.length === 0 && slideAnnotations.length === 0) {
      continue;
    }

    const slideFile = zip.file(slidePath);
    if (!slideFile) {
      continue;
    }

    const slideDoc = parseXmlDocument(await slideFile.async("string"));
    const spTree = slideDoc.getElementsByTagNameNS(NS_PML, "spTree")[0];
    if (!spTree) {
      continue;
    }

    const relsPath = slidePath.replace(
      /ppt\/slides\/(slide\d+\.xml)$/i,
      "ppt/slides/_rels/$1.rels",
    );
    const relsDoc = await getOrCreateRelationshipsDocument(zip, relsPath);
    let nextShapeId = getMaxAttributeNumber(slideDoc, "cNvPr", "id") + 1;

    for (const placement of slidePlacements) {
      const mediaPath = getNextSequentialPath(zip, "ppt/media", "hv-overlay-", "png");
      const mediaFileName = mediaPath.split("/").pop() || "hv-overlay.png";
      const imageData = await createSignatureStampDataUrl(placement);
      zip.file(mediaPath, dataUrlToUint8Array(imageData));
      const relationshipId = appendRelationship(
        relsDoc,
        REL_TYPE_IMAGE,
        `../media/${mediaFileName}`,
      );

      spTree.appendChild(
        createPptOverlayPictureNode({
          document: slideDoc,
          relationshipId,
          shapeId: nextShapeId,
          name: `HV Signature ${nextShapeId}`,
          x: placement.x * args.exportState.slideSize.width,
          y: placement.y * args.exportState.slideSize.height,
          width: placement.width * args.exportState.slideSize.width,
          height: placement.height * args.exportState.slideSize.height,
          description: placement.signature.signedBy || "Signature",
        }),
      );
      nextShapeId += 1;
    }

    for (const annotation of slideAnnotations) {
      const mediaPath = getNextSequentialPath(zip, "ppt/media", "hv-overlay-", "png");
      const mediaFileName = mediaPath.split("/").pop() || "hv-overlay.png";
      const imageData = await createAnnotationCardDataUrl(
        annotation,
        720,
        360,
        args.labels,
      );
      zip.file(mediaPath, dataUrlToUint8Array(imageData));
      const relationshipId = appendRelationship(
        relsDoc,
        REL_TYPE_IMAGE,
        `../media/${mediaFileName}`,
      );

      spTree.appendChild(
        createPptOverlayPictureNode({
          document: slideDoc,
          relationshipId,
          shapeId: nextShapeId,
          name: `HV Annotation ${nextShapeId}`,
          x: annotation.x * args.exportState.slideSize.width,
          y: annotation.y * args.exportState.slideSize.height,
          width: annotation.width * args.exportState.slideSize.width,
          height: annotation.height * args.exportState.slideSize.height,
          description: annotation.linkedSignaturePlacementId
            ? args.labels.linkedAnnotationAltLabel
            : args.labels.annotationAltLabel,
        }),
      );
      nextShapeId += 1;
    }

    zip.file(slidePath, serializeXmlDocument(slideDoc));
    zip.file(relsPath, serializeXmlDocument(relsDoc));
  }

  return {
    base64: arrayBufferToBase64(await zip.generateAsync({ type: "arraybuffer" })),
    fileName: replaceExtension(args.fileName, "pptx"),
    fileType: "pptx" as const,
    mimeType: mimeTypeForFileType("pptx"),
  };
}

async function preserveNativeSpreadsheetFile(args: {
  sourceArrayBuffer: ArrayBuffer;
  fileName: string;
  sheets: SpreadsheetSheetExportModel[];
  placements: SignaturePlacement[];
  annotations: AnnotationPlacement[];
  labels: ExportLocaleLabels;
  dirtyCellAddressesBySheet?: Record<string, string[]>;
}) {
  const zip = await JSZip.loadAsync(args.sourceArrayBuffer.slice(0));
  const workbookSheets = await getWorkbookSheetInfos(zip);
  await ensureContentTypeDefault(zip, "png", "image/png");
  let workbookNeedsRecalc = false;

  for (const sheetModel of args.sheets) {
    const sheetInfo = workbookSheets.find((sheet) => sheet.name === sheetModel.name);
    if (!sheetInfo) {
      continue;
    }

    const sheetPlacements = args.placements.filter(
      (placement) => placement.surfaceKey === `sheet:${sheetModel.name}`,
    );
    const sheetAnnotations = args.annotations.filter(
      (annotation) => annotation.surfaceKey === `sheet:${sheetModel.name}`,
    );
    const dirtyAddresses = Array.from(
      new Set(args.dirtyCellAddressesBySheet?.[sheetModel.name] ?? []),
    );

    if (
      sheetPlacements.length === 0 &&
      sheetAnnotations.length === 0 &&
      dirtyAddresses.length === 0
    ) {
      continue;
    }

    const sheetFile = zip.file(sheetInfo.path);
    if (!sheetFile) {
      continue;
    }

    const sheetDoc = parseXmlDocument(await sheetFile.async("string"));
    const worksheet = sheetDoc.getElementsByTagNameNS(NS_SML, "worksheet")[0];
    if (!worksheet) {
      continue;
    }

    let sheetChanged = false;

    if (dirtyAddresses.length > 0) {
      const sheetData = getOrCreateWorksheetSheetData(sheetDoc, worksheet);
      for (const address of dirtyAddresses) {
        const decoded = XLSX.utils.decode_cell(address);
        applySpreadsheetWorksheetEdit({
          document: sheetDoc,
          worksheet,
          sheetData,
          address,
          cellModel: sheetModel.cells[makeSheetCellKey(decoded.r, decoded.c)],
        });
      }

      workbookNeedsRecalc = true;
      sheetChanged = true;
    }

    if (sheetPlacements.length === 0 && sheetAnnotations.length === 0) {
      if (sheetChanged) {
        zip.file(sheetInfo.path, serializeXmlDocument(sheetDoc));
      }
      continue;
    }

    const sheetRelsPath = sheetInfo.path.replace(
      /xl\/worksheets\/(sheet\d+\.xml)$/i,
      "xl/worksheets/_rels/$1.rels",
    );
    const sheetRelsDoc = await getOrCreateRelationshipsDocument(zip, sheetRelsPath);
    let drawingRelationship = Array.from(
      sheetRelsDoc.getElementsByTagName("Relationship"),
    ).find((node) => node.getAttribute("Type") === REL_TYPE_DRAWING);

    let drawingPath = drawingRelationship
      ? resolveZipPath(sheetRelsPath, drawingRelationship.getAttribute("Target") || "")
      : "";

    if (!drawingPath) {
      drawingPath = getNextSequentialPath(zip, "xl/drawings", "drawing", "xml");
      const target = toRelativeZipTarget(sheetInfo.path, drawingPath);
      const relationshipId = appendRelationship(sheetRelsDoc, REL_TYPE_DRAWING, target);
      drawingRelationship = Array.from(sheetRelsDoc.getElementsByTagName("Relationship")).find(
        (node) => node.getAttribute("Id") === relationshipId,
      );
      await ensureContentTypeOverride(
        zip,
        `/${drawingPath}`,
        "application/vnd.openxmlformats-officedocument.drawing+xml",
      );

      const drawingNode = sheetDoc.createElementNS(NS_SML, "drawing");
      drawingNode.setAttributeNS(NS_REL_OFFICE, "r:id", relationshipId);
      worksheet.appendChild(drawingNode);
    }

    const drawingDoc = await getOrCreateSheetDrawingDocument(zip, drawingPath);
    const drawingRoot = drawingDoc.documentElement;
    const drawingRelsPath = drawingPath.replace(
      /xl\/drawings\/([^/]+\.xml)$/i,
      "xl/drawings/_rels/$1.rels",
    );
    const drawingRelsDoc = await getOrCreateRelationshipsDocument(zip, drawingRelsPath);
    let nextShapeId = getMaxAttributeNumber(drawingDoc, "cNvPr", "id") + 1;

    const totalWidth =
      SHEET_ROW_HEADER_WIDTH +
      sheetModel.colWidths
        .slice(0, sheetModel.renderedColCount)
        .reduce((sum, value) => sum + value, 0);
    const totalHeight =
      SHEET_COLUMN_HEADER_HEIGHT +
      sheetModel.rowHeights
        .slice(0, sheetModel.renderedRowCount)
        .reduce((sum, value) => sum + value, 0);

    const visibleColWidths = sheetModel.colWidths.slice(0, sheetModel.renderedColCount);
    const visibleRowHeights = sheetModel.rowHeights.slice(0, sheetModel.renderedRowCount);

    for (const placement of sheetPlacements) {
      const mediaPath = getNextSequentialPath(zip, "xl/media", "hv-overlay-", "png");
      const imageData = await createSignatureStampDataUrl(placement);
      zip.file(mediaPath, dataUrlToUint8Array(imageData));
      const relationshipId = appendRelationship(
        drawingRelsDoc,
        REL_TYPE_IMAGE,
        toRelativeZipTarget(drawingPath, mediaPath),
      );
      const pixelX = clamp(
        placement.x * totalWidth - SHEET_ROW_HEADER_WIDTH,
        0,
        Math.max(totalWidth - SHEET_ROW_HEADER_WIDTH, 0),
      );
      const pixelY = clamp(
        placement.y * totalHeight - SHEET_COLUMN_HEADER_HEIGHT,
        0,
        Math.max(totalHeight - SHEET_COLUMN_HEADER_HEIGHT, 0),
      );
      const anchor = buildSpreadsheetAnchor(
        pixelX,
        pixelY,
        placement.width * totalWidth,
        placement.height * totalHeight,
        visibleColWidths,
        visibleRowHeights,
      );

      drawingRoot.appendChild(
        createWorksheetOverlayNode({
          document: drawingDoc,
          relationshipId,
          shapeId: nextShapeId,
          name: `HV Signature ${nextShapeId}`,
          anchor,
          description: placement.signature.signedBy || "Signature",
        }),
      );
      nextShapeId += 1;
    }

    for (const annotation of sheetAnnotations) {
      const mediaPath = getNextSequentialPath(zip, "xl/media", "hv-overlay-", "png");
      const imageData = await createAnnotationCardDataUrl(
        annotation,
        720,
        360,
        args.labels,
      );
      zip.file(mediaPath, dataUrlToUint8Array(imageData));
      const relationshipId = appendRelationship(
        drawingRelsDoc,
        REL_TYPE_IMAGE,
        toRelativeZipTarget(drawingPath, mediaPath),
      );
      const pixelX = clamp(
        annotation.x * totalWidth - SHEET_ROW_HEADER_WIDTH,
        0,
        Math.max(totalWidth - SHEET_ROW_HEADER_WIDTH, 0),
      );
      const pixelY = clamp(
        annotation.y * totalHeight - SHEET_COLUMN_HEADER_HEIGHT,
        0,
        Math.max(totalHeight - SHEET_COLUMN_HEADER_HEIGHT, 0),
      );
      const anchor = buildSpreadsheetAnchor(
        pixelX,
        pixelY,
        annotation.width * totalWidth,
        annotation.height * totalHeight,
        visibleColWidths,
        visibleRowHeights,
      );

      drawingRoot.appendChild(
        createWorksheetOverlayNode({
          document: drawingDoc,
          relationshipId,
          shapeId: nextShapeId,
          name: `HV Annotation ${nextShapeId}`,
          anchor,
          description: annotation.linkedSignaturePlacementId
            ? args.labels.linkedAnnotationAltLabel
            : args.labels.annotationAltLabel,
        }),
      );
      nextShapeId += 1;
    }

    sheetChanged = true;
    zip.file(sheetInfo.path, serializeXmlDocument(sheetDoc));
    zip.file(sheetRelsPath, serializeXmlDocument(sheetRelsDoc));
    zip.file(drawingPath, serializeXmlDocument(drawingDoc));
    zip.file(drawingRelsPath, serializeXmlDocument(drawingRelsDoc));
  }

  if (workbookNeedsRecalc) {
    await markWorkbookForFullCalculation(zip);
  }

  return {
    base64: arrayBufferToBase64(await zip.generateAsync({ type: "arraybuffer" })),
    fileName: replaceExtension(args.fileName, "xlsx"),
    fileType: "xlsx" as const,
    mimeType: mimeTypeForFileType("xlsx"),
  };
}

async function renderCanvasesToPdf(
  canvases: HTMLCanvasElement[],
  fileName: string,
) {
  const pdf = await PDFDocument.create();

  for (const canvas of canvases) {
    const image = await pdf.embedJpg(canvas.toDataURL("image/jpeg", 0.92));
    const page = pdf.addPage([canvas.width, canvas.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
    });
  }

  return {
    base64: await pdf.saveAsBase64(),
    fileName: replaceExtension(fileName, "pdf"),
    fileType: "pdf" as const,
    mimeType: mimeTypeForFileType("pdf"),
    exportedAsPdf: true,
  };
}

function splitTallCanvas(canvas: HTMLCanvasElement) {
  const canvases: HTMLCanvasElement[] = [];
  const maxSliceHeight = Math.max(
    Math.round(canvas.width * 1.4),
    Math.round(canvas.width),
  );

  if (canvas.height <= maxSliceHeight) {
    return [canvas];
  }

  for (let offset = 0; offset < canvas.height; offset += maxSliceHeight) {
    const sliceHeight = Math.min(maxSliceHeight, canvas.height - offset);
    const sliceCanvas = createCanvas(canvas.width, sliceHeight);
    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) {
      continue;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(
      canvas,
      0,
      offset,
      canvas.width,
      sliceHeight,
      0,
      0,
      sliceCanvas.width,
      sliceCanvas.height,
    );
    canvases.push(sliceCanvas);
  }

  return canvases;
}

async function createDocxFromCanvases(
  canvases: HTMLCanvasElement[],
  fileName: string,
) {
  const children: Paragraph[] = [];

  for (const [index, canvas] of canvases.entries()) {
    const blob = await canvasToBlob(canvas, "image/png");
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const scale = Math.min(1, 560 / canvas.width);

    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: buffer,
            type: "png",
            transformation: {
              width: Math.round(canvas.width * scale),
              height: Math.round(canvas.height * scale),
            },
          }),
        ],
      }),
    );

    if (index < canvases.length - 1) {
      children.push(
        new Paragraph({
          children: [new PageBreak()],
        }),
      );
    }
  }

  const document = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return {
    base64: await Packer.toBase64String(document),
    fileName: replaceExtension(fileName, "docx"),
    fileType: "docx" as const,
    mimeType: mimeTypeForFileType("docx"),
  };
}

function emuToInches(value: number) {
  return value / EMU_PER_INCH;
}

async function loadPptxGenJS(): Promise<PptxGenConstructor> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("PowerPoint export is only available in the browser.");
  }

  if (window.PptxGenJS) {
    return window.PptxGenJS;
  }

  const existingScript = document.querySelector<HTMLScriptElement>(
    'script[data-hv-pptxgen="true"]',
  );

  if (existingScript) {
    await new Promise<void>((resolve, reject) => {
      if (window.PptxGenJS) {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Unable to load the PowerPoint export engine.")),
        { once: true },
      );
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      void import("../../generated/pptxgenBundle")
        .then(({ pptxgenBundleSource }) => {
          const blob = new Blob([pptxgenBundleSource], {
            type: "text/javascript",
          });
          const blobUrl = URL.createObjectURL(blob);

          (window as Window & { JSZip?: typeof JSZip }).JSZip = JSZip;
          const script = document.createElement("script");
          script.src = blobUrl;
          script.async = true;
          script.dataset.hvPptxgen = "true";
          script.onload = () => {
            URL.revokeObjectURL(blobUrl);
            resolve();
          };
          script.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            reject(new Error("Unable to load the PowerPoint export engine."));
          };
          document.head.appendChild(script);
        })
        .catch(() => {
          reject(new Error("Unable to load the PowerPoint export engine."));
        });
    });
  }

  if (!window.PptxGenJS) {
    throw new Error("The PowerPoint export engine did not initialize.");
  }

  return window.PptxGenJS;
}

function paragraphToText(paragraph: PptxParagraphModel) {
  const text = paragraph.runs.map((run) => run.text).join("");
  const indentation = "  ".repeat(paragraph.level);
  const prefix = paragraph.bullet ? `${indentation}* ` : indentation;
  return `${prefix}${text}`;
}

async function renderSlidesToCanvases(
  exportState: PptxExportState,
  placements: SignaturePlacement[],
  annotations: AnnotationPlacement[],
  labels: ExportLocaleLabels = defaultExportLocaleLabels,
) {
  const slideWidth = exportState.slideSize.width || 9144000;
  const slideHeight = exportState.slideSize.height || 5143500;
  const targetWidth = 1280;
  const scale = targetWidth / slideWidth;
  const canvases: HTMLCanvasElement[] = [];

  for (const [index, slide] of exportState.slides.entries()) {
    const canvas = createCanvas(slideWidth * scale, slideHeight * scale);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      continue;
    }

    ctx.fillStyle = slide.background || "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const element of slide.elements) {
      if (element.width <= 0 || element.height <= 0) {
        continue;
      }

      const x = element.x * scale;
      const y = element.y * scale;
      const width = element.width * scale;
      const height = element.height * scale;

      ctx.save();
      if (element.rotation) {
        ctx.translate(x + width / 2, y + height / 2);
        ctx.rotate((element.rotation * Math.PI) / 180);
        ctx.translate(-(x + width / 2), -(y + height / 2));
      }

      if (element.kind === "image" && element.imageSrc) {
        const image = await loadImage(element.imageSrc);
        ctx.drawImage(image, x, y, width, height);
        ctx.restore();
        continue;
      }

      if (element.fill) {
        ctx.fillStyle = element.fill;
        ctx.fillRect(x, y, width, height);
      }

      if (element.stroke) {
        ctx.strokeStyle = element.stroke;
        ctx.lineWidth = Math.max(1, width * 0.005);
        ctx.strokeRect(x, y, width, height);
      }

      if (element.paragraphs?.length) {
        let cursorY = y + Math.max(12, height * 0.08);

        for (const paragraph of element.paragraphs) {
          const primaryRun = paragraph.runs[0];
          const fontSize = Math.max(
            12,
            (primaryRun?.fontSize || 18) * scale,
          );
          const lineHeight = fontSize * 1.3;
          const lines = paragraphToText(paragraph).split("\n");

          for (const line of lines) {
            const weight = primaryRun?.bold ? "700" : "400";
            ctx.font = `${weight} ${fontSize}px Arial, sans-serif`;
            ctx.fillStyle = primaryRun?.color || "#0f172a";
            ctx.textBaseline = "top";

            let textX = x + 14 * scale;
            const textWidth = ctx.measureText(line).width;

            if (paragraph.align === "ctr") {
              textX = x + Math.max((width - textWidth) / 2, 0);
            } else if (paragraph.align === "r") {
              textX = x + Math.max(width - textWidth - 14 * scale, 0);
            } else {
              textX += paragraph.level * 16 * scale;
            }

            ctx.fillText(line, textX, cursorY, width - 28 * scale);

            if (primaryRun?.underline) {
              ctx.strokeStyle = primaryRun.color || "#0f172a";
              ctx.lineWidth = Math.max(1, fontSize * 0.08);
              ctx.beginPath();
              ctx.moveTo(textX, cursorY + fontSize + 2);
              ctx.lineTo(textX + textWidth, cursorY + fontSize + 2);
              ctx.stroke();
            }

            cursorY += lineHeight;
          }
        }
      }

      ctx.restore();
    }

    await drawPlacementsOnCanvas(
      ctx,
      placements.filter((placement) => placement.surfaceKey === `slide:${index + 1}`),
      canvas.width,
      canvas.height,
    );
    await drawAnnotationsOnCanvas(
      ctx,
      annotations.filter(
        (annotation) => annotation.surfaceKey === `slide:${index + 1}`,
      ),
      canvas.width,
      canvas.height,
      labels,
    );

    canvases.push(canvas);
  }

  return canvases.length > 0 ? canvases : [createCanvas(1280, 720)];
}

function createSheetMergeLookup(merges: SpreadsheetMergeModel[]) {
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

function toColumnLabel(index: number) {
  let label = "";
  let current = index;

  while (current >= 0) {
    label = String.fromCharCode((current % 26) + 65) + label;
    current = Math.floor(current / 26) - 1;
  }

  return label;
}

function offsetToGridPosition(offset: number, sizes: number[]) {
  let remaining = offset;

  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index];
    if (remaining <= size) {
      return index + clamp(remaining / size, 0, 0.9999);
    }
    remaining -= size;
  }

  return sizes.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneSpreadsheetSerializable<T>(value: T): T {
  if (value == null) {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value) as T;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function makeSheetCellKey(row: number, col: number) {
  return `${row}:${col}`;
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

function getSpreadsheetColor(color: unknown) {
  if (!isRecord(color)) {
    return undefined;
  }

  if (typeof color.argb === "string") {
    return stripArgbAlpha(color.argb);
  }

  return undefined;
}

function getSpreadsheetTextColor(cell?: SpreadsheetCellExportModel) {
  if (!cell?.font || !isRecord(cell.font)) {
    return undefined;
  }

  return getSpreadsheetColor(cell.font.color);
}

function getSpreadsheetFillColor(cell?: SpreadsheetCellExportModel) {
  if (!cell?.fill || !isRecord(cell.fill)) {
    return undefined;
  }

  return (
    getSpreadsheetColor(cell.fill.fgColor) ||
    getSpreadsheetColor(cell.fill.bgColor)
  );
}

function getSpreadsheetAlignment(cell?: SpreadsheetCellExportModel) {
  if (!cell?.alignment || !isRecord(cell.alignment)) {
    return {};
  }

  return {
    horizontal:
      typeof cell.alignment.horizontal === "string"
        ? cell.alignment.horizontal
        : undefined,
    vertical:
      typeof cell.alignment.vertical === "string"
        ? cell.alignment.vertical
        : undefined,
    wrapText: cell.alignment.wrapText === true,
  };
}

function getSpreadsheetCellValueForExport(cell: SpreadsheetCellExportModel) {
  if (cell.valueKind === "blank") {
    return null;
  }

  if (cell.valueKind === "formula" && cell.formula) {
    const baseValue = isRecord(cell.value)
      ? cloneSpreadsheetSerializable(cell.value)
      : {};

    return {
      ...(isRecord(baseValue) ? baseValue : {}),
      formula: cell.formula,
      result: cloneSpreadsheetSerializable(cell.result),
    };
  }

  if (cell.valueKind === "hyperlink" && cell.hyperlink) {
    if (isRecord(cell.value) && typeof cell.value.hyperlink === "string") {
      return cloneSpreadsheetSerializable(cell.value);
    }

    return {
      text: cell.displayValue || String(cell.value ?? ""),
      hyperlink: cell.hyperlink,
    };
  }

  return cloneSpreadsheetSerializable(cell.value);
}

function applySpreadsheetCellFormatting(
  targetCell: ExcelJS.Cell,
  model: SpreadsheetCellExportModel,
) {
  if (model.numFmt) {
    targetCell.numFmt = model.numFmt;
  }
  if (model.font) {
    targetCell.font = cloneSpreadsheetSerializable(model.font) as unknown as ExcelJS.Font;
  }
  if (model.fill) {
    targetCell.fill = cloneSpreadsheetSerializable(model.fill) as unknown as ExcelJS.Fill;
  }
  if (model.alignment) {
    targetCell.alignment = cloneSpreadsheetSerializable(
      model.alignment,
    ) as unknown as Partial<ExcelJS.Alignment>;
  }
  if (model.border) {
    targetCell.border = cloneSpreadsheetSerializable(
      model.border,
    ) as unknown as Partial<ExcelJS.Borders>;
  }
  if (model.note) {
    targetCell.note = model.note;
  }
}

async function renderSheetsToCanvases(
  sheets: SpreadsheetSheetExportModel[],
  placements: SignaturePlacement[],
  annotations: AnnotationPlacement[],
  labels: ExportLocaleLabels = defaultExportLocaleLabels,
) {
  const canvases: HTMLCanvasElement[] = [];
  const safeSheets =
    sheets.length > 0
      ? sheets
      : [{
          name: "Sheet1",
          data: [[""]],
          cells: {},
          merges: [],
          colWidths: [120],
          rowHeights: [32],
          rowCount: 1,
          colCount: 1,
          renderedRowCount: 1,
          renderedColCount: 1,
        }];

  for (const sheet of safeSheets) {
    const visibleColWidths = sheet.colWidths.slice(0, sheet.renderedColCount);
    const visibleRowHeights = sheet.rowHeights.slice(0, sheet.renderedRowCount);
    const totalWidth =
      SHEET_ROW_HEADER_WIDTH +
      visibleColWidths.reduce((sum, value) => sum + value, 0);
    const totalHeight =
      SHEET_COLUMN_HEADER_HEIGHT +
      visibleRowHeights.reduce((sum, value) => sum + value, 0);
    const canvas = createCanvas(totalWidth, totalHeight);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      continue;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, canvas.width, SHEET_COLUMN_HEADER_HEIGHT);
    ctx.fillRect(0, 0, SHEET_ROW_HEADER_WIDTH, canvas.height);

    const mergeLookup = createSheetMergeLookup(sheet.merges);
    let cursorX = SHEET_ROW_HEADER_WIDTH;

    for (let colIndex = 0; colIndex < visibleColWidths.length; colIndex += 1) {
      const width = visibleColWidths[colIndex];
      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(cursorX, 0, width, SHEET_COLUMN_HEADER_HEIGHT);
      ctx.fillStyle = "#475569";
      ctx.font = "700 11px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        toColumnLabel(colIndex),
        cursorX + width / 2,
        SHEET_COLUMN_HEADER_HEIGHT / 2,
      );
      cursorX += width;
    }

    let cursorY = SHEET_COLUMN_HEADER_HEIGHT;
    for (let rowIndex = 0; rowIndex < visibleRowHeights.length; rowIndex += 1) {
      const height = visibleRowHeights[rowIndex];
      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(0, cursorY, SHEET_ROW_HEADER_WIDTH, height);
      ctx.fillStyle = "#475569";
      ctx.font = "700 11px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(rowIndex + 1), SHEET_ROW_HEADER_WIDTH / 2, cursorY + height / 2);
      cursorY += height;
    }

    cursorY = SHEET_COLUMN_HEADER_HEIGHT;
    for (let rowIndex = 0; rowIndex < sheet.data.length; rowIndex += 1) {
      const row = sheet.data[rowIndex] ?? [];
      const rowHeight = visibleRowHeights[rowIndex] ?? 32;
      cursorX = SHEET_ROW_HEADER_WIDTH;

      for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
        const colWidth = visibleColWidths[colIndex] ?? 96;
        const cellKey = makeSheetCellKey(rowIndex, colIndex);
        const cellModel = sheet.cells[cellKey];

        if (mergeLookup.covered.has(cellKey)) {
          cursorX += colWidth;
          continue;
        }

        const merge = mergeLookup.starts.get(cellKey);
        const width = merge
          ? visibleColWidths
              .slice(colIndex, colIndex + (merge.endCol - merge.startCol + 1))
              .reduce((sum, value) => sum + value, 0)
          : colWidth;
        const height = merge
          ? visibleRowHeights
              .slice(rowIndex, rowIndex + (merge.endRow - merge.startRow + 1))
              .reduce((sum, value) => sum + value, 0)
          : rowHeight;

        ctx.fillStyle = getSpreadsheetFillColor(cellModel) || "#ffffff";
        ctx.fillRect(cursorX, cursorY, width, height);
        ctx.strokeStyle = "#e2e8f0";
        ctx.strokeRect(cursorX, cursorY, width, height);

        const text = cellModel?.displayValue || row[colIndex] || "";
        if (text) {
          const alignment = getSpreadsheetAlignment(cellModel);
          const fontSize =
            cellModel?.font && isRecord(cellModel.font) && typeof cellModel.font.size === "number"
              ? cellModel.font.size
              : 13;
          const fontWeight =
            cellModel?.font && isRecord(cellModel.font) && cellModel.font.bold
              ? "700"
              : "400";
          const fontStyle =
            cellModel?.font && isRecord(cellModel.font) && cellModel.font.italic
              ? "italic"
              : "normal";
          const fontFamily =
            cellModel?.font && isRecord(cellModel.font) && typeof cellModel.font.name === "string"
              ? cellModel.font.name
              : "Arial";
          const textColor =
            getSpreadsheetTextColor(cellModel) ||
            (cellModel?.hyperlink ? "#1d4ed8" : "#0f172a");
          const textPaddingX = 10;
          const textPaddingY = 8;

          ctx.fillStyle = textColor;
          ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}, sans-serif`;
          ctx.textBaseline = "top";
          ctx.textAlign =
            alignment.horizontal === "center"
              ? "center"
              : alignment.horizontal === "right"
                ? "right"
                : "left";

          const lines = wrapTextToWidth(
            ctx,
            text,
            Math.max(width - textPaddingX * 2, 12),
          );
          const lineHeight = Math.max(fontSize * 1.25, 16);
          const textBlockHeight = lines.length * lineHeight;
          const textX =
            ctx.textAlign === "center"
              ? cursorX + width / 2
              : ctx.textAlign === "right"
                ? cursorX + width - textPaddingX
                : cursorX + textPaddingX;
          const textY =
            alignment.vertical === "middle"
              ? cursorY + Math.max((height - textBlockHeight) / 2, textPaddingY)
              : alignment.vertical === "bottom"
                ? cursorY + Math.max(height - textBlockHeight - textPaddingY, textPaddingY)
                : cursorY + textPaddingY;

          lines.forEach((line: string, index: number) => {
            ctx.fillText(line, textX, textY + index * lineHeight);
          });
        }

        cursorX += colWidth;
      }

      cursorY += rowHeight;
    }

    await drawPlacementsOnCanvas(
      ctx,
      placements.filter((placement) => placement.surfaceKey === `sheet:${sheet.name}`),
      canvas.width,
      canvas.height,
    );
    await drawAnnotationsOnCanvas(
      ctx,
      annotations.filter(
        (annotation) => annotation.surfaceKey === `sheet:${sheet.name}`,
      ),
      canvas.width,
      canvas.height,
      labels,
    );

    canvases.push(canvas);
  }

  return canvases;
}

export async function exportSignedPdfDocument(args: {
  arrayBuffer?: ArrayBuffer;
  url?: string;
  fileName: string;
  placements: SignaturePlacement[];
  annotations: AnnotationPlacement[];
  labels?: Partial<ExportLocaleLabels>;
}) {
  if (!args.arrayBuffer && !args.url) {
    throw new Error("No PDF source is available for export.");
  }

  const labels = { ...defaultExportLocaleLabels, ...args.labels };
  await ensurePdfWorker();
  const loadingTask = getDocument(
    args.arrayBuffer ? { data: args.arrayBuffer.slice(0) } : { url: args.url! },
  );
  const pdf = await loadingTask.promise;
  const exportPdf = await PDFDocument.create();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      continue;
    }

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    await drawPlacementsOnCanvas(
      ctx,
      args.placements.filter(
        (placement) => placement.surfaceKey === `page:${pageNumber}`,
      ),
      canvas.width,
      canvas.height,
    );
    await drawAnnotationsOnCanvas(
      ctx,
      args.annotations.filter(
        (annotation) => annotation.surfaceKey === `page:${pageNumber}`,
      ),
      canvas.width,
      canvas.height,
      labels,
    );

    const image = await exportPdf.embedJpg(canvas.toDataURL("image/jpeg", 0.92));
    const exportPage = exportPdf.addPage([canvas.width, canvas.height]);
    exportPage.drawImage(image, {
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
    });
  }

  return {
    base64: await exportPdf.saveAsBase64(),
    fileName: replaceExtension(args.fileName, "pdf"),
    fileType: "pdf" as const,
    mimeType: mimeTypeForFileType("pdf"),
  };
}

export async function exportSignedImageFile(args: {
  arrayBuffer: ArrayBuffer;
  fileType: SupportedFileType;
  fileName: string;
  placements: SignaturePlacement[];
  annotations: AnnotationPlacement[];
  asPdf?: boolean;
  labels?: Partial<ExportLocaleLabels>;
}) {
  const labels = { ...defaultExportLocaleLabels, ...args.labels };
  const imageBlob = new Blob([args.arrayBuffer], {
    type: mimeTypeForFileType(args.fileType),
  });
  const objectUrl = URL.createObjectURL(imageBlob);

  try {
    const image = await loadImage(objectUrl);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Unable to render the image document.");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    await drawPlacementsOnCanvas(
      ctx,
      args.placements.filter((placement) => placement.surfaceKey === "image:main"),
      canvas.width,
      canvas.height,
    );
    await drawAnnotationsOnCanvas(
      ctx,
      args.annotations.filter((annotation) => annotation.surfaceKey === "image:main"),
      canvas.width,
      canvas.height,
      labels,
    );

    if (args.asPdf) {
      return renderCanvasesToPdf([canvas], args.fileName);
    }

    const shouldUseJpeg = args.fileType === "jpg" || args.fileType === "jpeg";
    const outputType = shouldUseJpeg ? "image/jpeg" : "image/png";
    const blob = await canvasToBlob(canvas, outputType, shouldUseJpeg ? 0.95 : undefined);

    return {
      base64: await blobToBase64(blob),
      fileName: replaceExtension(args.fileName, shouldUseJpeg ? "jpg" : "png"),
      fileType: shouldUseJpeg ? "jpg" as const : "png" as const,
      mimeType: outputType,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function exportSignedRichTextFile(args: {
  container: HTMLElement | null;
  pages?: RichTextPageRenderModel[];
  fileName: string;
  placements: SignaturePlacement[];
  annotations: AnnotationPlacement[];
  asPdf?: boolean;
  labels?: Partial<ExportLocaleLabels>;
}) {
  const labels = { ...defaultExportLocaleLabels, ...args.labels };
  if (args.pages && args.pages.length > 0) {
    const canvases: HTMLCanvasElement[] = [];

    for (const page of args.pages) {
      const image = await loadImage(page.imageUrl);
      const canvas = createCanvas(page.width, page.height);
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        continue;
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      await drawPlacementsOnCanvas(
        ctx,
        args.placements.filter(
          (placement) => placement.surfaceKey === page.surfaceKey,
        ),
        canvas.width,
        canvas.height,
      );
      await drawAnnotationsOnCanvas(
        ctx,
        args.annotations.filter(
          (annotation) => annotation.surfaceKey === page.surfaceKey,
        ),
        canvas.width,
        canvas.height,
        labels,
      );

      canvases.push(canvas);
    }

    if (canvases.length === 0) {
      throw new Error("The document pages are not ready to export.");
    }

    if (args.asPdf) {
      return renderCanvasesToPdf(canvases, args.fileName);
    }

    return createDocxFromCanvases(canvases, args.fileName);
  }

  if (!args.container) {
    throw new Error("The document surface is not ready to export.");
  }

  const canvas = await html2canvas(args.container, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: args.container.scrollWidth,
    windowHeight: args.container.scrollHeight,
  });
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Unable to render the document surface.");
  }

  await drawPlacementsOnCanvas(
    ctx,
    args.placements.filter((placement) => placement.surfaceKey === "document:main"),
    canvas.width,
    canvas.height,
  );
  await drawAnnotationsOnCanvas(
    ctx,
    args.annotations.filter((annotation) => annotation.surfaceKey === "document:main"),
    canvas.width,
    canvas.height,
    labels,
  );

  const pages = splitTallCanvas(canvas);
  if (args.asPdf) {
    return renderCanvasesToPdf(pages, args.fileName);
  }

  return createDocxFromCanvases(pages, args.fileName);
}

export async function exportSignedSlidesFile(args: {
  exportState: PptxExportState | null;
  fileName: string;
  placements: SignaturePlacement[];
  annotations: AnnotationPlacement[];
  asPdf?: boolean;
  labels?: Partial<ExportLocaleLabels>;
}) {
  const labels = { ...defaultExportLocaleLabels, ...args.labels };
  const exportState =
    args.exportState && args.exportState.slides.length > 0
      ? args.exportState
      : {
          slideSize: { width: 9144000, height: 5143500 },
          slides: [{
            background: "#ffffff",
            elements: [],
            title: "Slide 1",
          }],
        };

  if (args.asPdf) {
    return renderCanvasesToPdf(
      await renderSlidesToCanvases(exportState, args.placements, args.annotations, labels),
      args.fileName,
    );
  }

  if (
    exportState.sourceArrayBuffer &&
    exportState.sourceFileType === "pptx"
  ) {
    return preserveNativePptxFile({
      sourceArrayBuffer: exportState.sourceArrayBuffer,
      fileName: args.fileName,
      exportState,
      placements: args.placements,
      annotations: args.annotations,
      labels,
    });
  }

  const PptxGenJS = await loadPptxGenJS();
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: "HV_CUSTOM",
    width: emuToInches(exportState.slideSize.width),
    height: emuToInches(exportState.slideSize.height),
  });
  pptx.layout = "HV_CUSTOM";
  pptx.author = "Hive Viewer";
  pptx.subject = "Signed presentation export";
  pptx.title = args.fileName;

  for (const [index, slideModel] of exportState.slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: stripHash(slideModel.background, "FFFFFF") };

    for (const element of slideModel.elements) {
      if (element.width <= 0 || element.height <= 0) {
        continue;
      }

      const x = emuToInches(element.x);
      const y = emuToInches(element.y);
      const w = emuToInches(element.width);
      const h = emuToInches(element.height);

      if (element.kind === "image" && element.imageSrc) {
        slide.addImage({
          data: element.imageSrc,
          x,
          y,
          w,
          h,
          rotate: element.rotation || 0,
          altText: element.alt,
        });
        continue;
      }

      if (element.paragraphs?.length) {
        const text = element.paragraphs.map(paragraphToText).join("\n");
        const firstRun = element.paragraphs.flatMap((paragraph) => paragraph.runs)[0];

        slide.addText(text, {
          x,
          y,
          w,
          h,
          rotate: element.rotation || 0,
          shape: "rect",
          margin: 4,
          fit: "shrink",
          valign: "top",
          align:
            element.paragraphs[0]?.align === "ctr"
              ? "center"
              : element.paragraphs[0]?.align === "r"
                ? "right"
                : "left",
          color: stripHash(firstRun?.color, "0F172A"),
          fontSize: firstRun?.fontSize,
          bold: firstRun?.bold,
          italic: firstRun?.italic,
          underline: firstRun?.underline
            ? {
                style: "sng",
                color: stripHash(firstRun?.color, "0F172A"),
              }
            : undefined,
          fill: element.fill
            ? { color: stripHash(element.fill) }
            : undefined,
          line: element.stroke
            ? { color: stripHash(element.stroke), pt: 1 }
            : { color: "FFFFFF", transparency: 100 },
        });
        continue;
      }

      slide.addShape("rect", {
        x,
        y,
        w,
        h,
        rotate: element.rotation || 0,
        fill: element.fill
          ? { color: stripHash(element.fill) }
          : { color: "FFFFFF", transparency: 100 },
        line: element.stroke
          ? { color: stripHash(element.stroke), pt: 1 }
          : { color: "FFFFFF", transparency: 100 },
      });
    }

    for (const placement of args.placements.filter(
      (candidate) => candidate.surfaceKey === `slide:${index + 1}`,
    )) {
      slide.addImage({
        data: await createSignatureStampDataUrl(placement),
        x: placement.x * emuToInches(exportState.slideSize.width),
        y: placement.y * emuToInches(exportState.slideSize.height),
        w: placement.width * emuToInches(exportState.slideSize.width),
        h: placement.height * emuToInches(exportState.slideSize.height),
        altText: placement.signature.signedBy
          ? `Signature by ${placement.signature.signedBy}`
          : "Signature",
      });
    }

    for (const annotation of args.annotations.filter(
      (candidate) => candidate.surfaceKey === `slide:${index + 1}`,
    )) {
      slide.addImage({
        data: await createAnnotationCardDataUrl(annotation, 720, 360, labels),
        x: annotation.x * emuToInches(exportState.slideSize.width),
        y: annotation.y * emuToInches(exportState.slideSize.height),
        w: annotation.width * emuToInches(exportState.slideSize.width),
        h: annotation.height * emuToInches(exportState.slideSize.height),
        altText: annotation.linkedSignaturePlacementId
          ? labels.linkedAnnotationAltLabel
          : labels.annotationAltLabel,
      });
    }
  }

  return {
    base64: await pptx.write({ outputType: "base64", compression: true }) as string,
    fileName: replaceExtension(args.fileName, "pptx"),
    fileType: "pptx" as const,
    mimeType: mimeTypeForFileType("pptx"),
  };
}

export async function exportSignedSpreadsheetFile(args: {
  exportState: SpreadsheetExportState | null;
  fileName: string;
  placements: SignaturePlacement[];
  annotations: AnnotationPlacement[];
  asPdf?: boolean;
  labels?: Partial<ExportLocaleLabels>;
}) {
  const labels = { ...defaultExportLocaleLabels, ...args.labels };
  const sheets =
    args.exportState?.sheets && args.exportState.sheets.length > 0
      ? args.exportState.sheets
      : [{
          name: "Sheet1",
          data: [[""]],
          cells: {},
          merges: [],
          colWidths: [120],
          rowHeights: [32],
          rowCount: 1,
          colCount: 1,
          renderedRowCount: 1,
          renderedColCount: 1,
        }];

  if (args.asPdf) {
    return renderCanvasesToPdf(
      await renderSheetsToCanvases(sheets, args.placements, args.annotations, labels),
      args.fileName,
    );
  }

  if (
    args.exportState?.sourceArrayBuffer &&
    args.exportState.sourceFileType === "xlsx"
  ) {
    return preserveNativeSpreadsheetFile({
      sourceArrayBuffer: args.exportState.sourceArrayBuffer,
      fileName: args.fileName,
      sheets,
      placements: args.placements,
      annotations: args.annotations,
      labels,
      dirtyCellAddressesBySheet: args.exportState.dirtyCellAddressesBySheet,
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hive Viewer";
  workbook.created = new Date();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    for (let colIndex = 0; colIndex < sheet.colCount; colIndex += 1) {
      const column = worksheet.getColumn(colIndex + 1);
      const width = sheet.colWidths[colIndex] ?? 96;
      column.hidden = width === 0;
      if (!column.hidden) {
        column.width = Math.max(8, Number((width / 7).toFixed(2)));
      }
    }

    for (let rowIndex = 0; rowIndex < sheet.rowCount; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex + 1);
      const height = sheet.rowHeights[rowIndex] ?? 32;
      row.hidden = height === 0;
      if (!row.hidden) {
        row.height = Number((height * 0.75).toFixed(2));
      }
    }

    for (const cellModel of Object.values(sheet.cells)) {
      const decoded = XLSX.utils.decode_cell(cellModel.address);
      const cell = worksheet.getCell(decoded.r + 1, decoded.c + 1);
      cell.value = getSpreadsheetCellValueForExport(cellModel) as ExcelJS.CellValue;
      applySpreadsheetCellFormatting(cell, cellModel);
    }

    for (const merge of sheet.merges) {
      worksheet.mergeCells(
        merge.startRow + 1,
        merge.startCol + 1,
        merge.endRow + 1,
        merge.endCol + 1,
      );
    }

    const totalWidth =
      SHEET_ROW_HEADER_WIDTH +
      sheet.colWidths
        .slice(0, sheet.renderedColCount)
        .reduce((sum, value) => sum + value, 0);
    const totalHeight =
      SHEET_COLUMN_HEADER_HEIGHT +
      sheet.rowHeights
        .slice(0, sheet.renderedRowCount)
        .reduce((sum, value) => sum + value, 0);

    for (const placement of args.placements.filter(
      (candidate) => candidate.surfaceKey === `sheet:${sheet.name}`,
    )) {
      const imageId = workbook.addImage({
        base64: await createSignatureStampDataUrl(placement),
        extension: "png",
      });
      const pixelX = clamp(
        placement.x * totalWidth - SHEET_ROW_HEADER_WIDTH,
        0,
        Math.max(totalWidth - SHEET_ROW_HEADER_WIDTH, 0),
      );
      const pixelY = clamp(
        placement.y * totalHeight - SHEET_COLUMN_HEADER_HEIGHT,
        0,
        Math.max(totalHeight - SHEET_COLUMN_HEADER_HEIGHT, 0),
      );

      worksheet.addImage(imageId, {
        tl: {
          col: offsetToGridPosition(pixelX, sheet.colWidths),
          row: offsetToGridPosition(pixelY, sheet.rowHeights),
        },
        ext: {
          width: placement.width * totalWidth,
          height: placement.height * totalHeight,
        },
      });
    }

    for (const annotation of args.annotations.filter(
      (candidate) => candidate.surfaceKey === `sheet:${sheet.name}`,
    )) {
      const imageId = workbook.addImage({
        base64: await createAnnotationCardDataUrl(annotation, 720, 360, labels),
        extension: "png",
      });
      const pixelX = clamp(
        annotation.x * totalWidth - SHEET_ROW_HEADER_WIDTH,
        0,
        Math.max(totalWidth - SHEET_ROW_HEADER_WIDTH, 0),
      );
      const pixelY = clamp(
        annotation.y * totalHeight - SHEET_COLUMN_HEADER_HEIGHT,
        0,
        Math.max(totalHeight - SHEET_COLUMN_HEADER_HEIGHT, 0),
      );

      worksheet.addImage(imageId, {
        tl: {
          col: offsetToGridPosition(pixelX, sheet.colWidths),
          row: offsetToGridPosition(pixelY, sheet.rowHeights),
        },
        ext: {
          width: annotation.width * totalWidth,
          height: annotation.height * totalHeight,
        },
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return {
    base64: arrayBufferToBase64(toArrayBuffer(buffer)),
    fileName: replaceExtension(args.fileName, "xlsx"),
    fileType: "xlsx" as const,
    mimeType: mimeTypeForFileType("xlsx"),
  };
}
