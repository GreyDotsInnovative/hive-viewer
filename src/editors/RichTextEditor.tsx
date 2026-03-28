"use client";

import mammoth from "mammoth";
import React, { useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { SignatureOverlay } from "../components/SignatureOverlay";
import type {
  RichTextExportState,
  RichTextPageRenderModel,
} from "../internal/exportModels";
import type {
  DocumentSurfaceOverlayState,
  DocumentMode,
  SupportedFileType,
} from "../types";
import { captureElementCanvas } from "../utils/export";
import { sanitizeHtml } from "../utils/sanitize";

const DOC_PAGE_WIDTH = 816;
const DOC_PAGE_HEIGHT = 1056;
const PAGE_RENDER_SCALE = 2;
const PAGE_BREAK_MIN_FILL = 0.55;
const DOCX_PREVIEW_CLASS_NAME = "hv-docx-page";

interface RichTextEditorProps {
  mode: DocumentMode;
  arrayBuffer?: ArrayBuffer;
  fileName: string;
  fileType?: SupportedFileType;
  locale: Record<string, string>;
  layout: "single" | "side-by-side";
  currentPage: number;
  onPageCount: (n: number) => void;
  onCurrentPageChange: (p: number) => void;
  onThumbs: (thumbs: Array<string | undefined>) => void;
  onExportStateChange?: (state: RichTextExportState | null) => void;
  signatureOverlay: DocumentSurfaceOverlayState;
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPlainTextHtml(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return '<article class="hv-plain-text-doc"><p></p></article>';
  }

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const htmlBlocks = blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

    if (
      nonEmptyLines.length > 0
      && nonEmptyLines.every((line) => /^[-*•]\s+/.test(line))
    ) {
      const items = nonEmptyLines
        .map((line) => line.replace(/^[-*•]\s+/, ""))
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }

    if (
      nonEmptyLines.length > 0
      && nonEmptyLines.every((line) => /^\d+[.)]\s+/.test(line))
    ) {
      const items = nonEmptyLines
        .map((line) => line.replace(/^\d+[.)]\s+/, ""))
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("");
      return `<ol>${items}</ol>`;
    }

    return `<p>${lines.map((line) => escapeHtml(line)).join("<br />")}</p>`;
  });

  return `<article class="hv-plain-text-doc">${htmlBlocks.join("")}</article>`;
}

async function waitForContainerImages(container: HTMLElement) {
  const images = Array.from(container.querySelectorAll("img"));

  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

async function waitForRenderReady(container: HTMLElement) {
  await waitForContainerImages(container);

  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
    } catch {
      // Continue even if font loading information is unavailable.
    }
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function calculatePageBreakOffsets(container: HTMLElement, pageHeight: number) {
  const totalHeight = Math.max(container.scrollHeight, pageHeight);
  const blocks = Array.from(container.children)
    .flatMap((node) => (node instanceof HTMLElement ? [node] : []))
    .map((node) => ({
      top: node.offsetTop,
      bottom: node.offsetTop + node.offsetHeight,
    }))
    .filter((block) => block.bottom > block.top)
    .sort((left, right) => left.top - right.top);

  const offsets: number[] = [];
  let cursor = 0;

  while (cursor < totalHeight) {
    const target = cursor + pageHeight;

    if (target >= totalHeight) {
      offsets.push(totalHeight);
      break;
    }

    const candidate = blocks
      .filter(
        (block) =>
          block.bottom > cursor + pageHeight * PAGE_BREAK_MIN_FILL &&
          block.bottom <= target,
      )
      .map((block) => block.bottom)
      .pop();

    const nextOffset =
      candidate && candidate > cursor + pageHeight * 0.35 ? candidate : target;

    offsets.push(nextOffset);
    cursor = nextOffset;
  }

  return offsets.length > 0 ? offsets : [pageHeight];
}

function createThumbnailDataUrl(canvas: HTMLCanvasElement) {
  const thumbWidth = 160;
  const thumbScale = thumbWidth / canvas.width;
  const thumbCanvas = createCanvas(thumbWidth, canvas.height * thumbScale);
  const thumbCtx = thumbCanvas.getContext("2d");

  if (thumbCtx) {
    thumbCtx.fillStyle = "#ffffff";
    thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
    thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  }

  return thumbCanvas.toDataURL("image/png");
}

function buildPageModels(
  sourceCanvas: HTMLCanvasElement,
  breakOffsets: number[],
) {
  const scale = sourceCanvas.width / DOC_PAGE_WIDTH;
  const pageCanvasWidth = DOC_PAGE_WIDTH * scale;
  const pageCanvasHeight = DOC_PAGE_HEIGHT * scale;
  const pages: RichTextPageRenderModel[] = [];
  let previousOffset = 0;

  for (const [index, endOffset] of breakOffsets.entries()) {
    const sourceY = previousOffset * scale;
    const sourceHeight = Math.max((endOffset - previousOffset) * scale, 1);
    const pageCanvas = createCanvas(pageCanvasWidth, pageCanvasHeight);
    const pageCtx = pageCanvas.getContext("2d");

    if (!pageCtx) {
      previousOffset = endOffset;
      continue;
    }

    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageCtx.drawImage(
      sourceCanvas,
      0,
      sourceY,
      sourceCanvas.width,
      sourceHeight,
      0,
      0,
      pageCanvas.width,
      sourceHeight,
    );

    pages.push({
      pageNumber: index + 1,
      surfaceKey: `document-page:${index + 1}`,
      imageUrl: pageCanvas.toDataURL("image/png"),
      thumbnailUrl: createThumbnailDataUrl(pageCanvas),
      width: pageCanvas.width,
      height: pageCanvas.height,
    });
    previousOffset = endOffset;
  }

  if (pages.length === 0) {
    const blankCanvas = createCanvas(
      DOC_PAGE_WIDTH * PAGE_RENDER_SCALE,
      DOC_PAGE_HEIGHT * PAGE_RENDER_SCALE,
    );
    const blankCtx = blankCanvas.getContext("2d");
    if (blankCtx) {
      blankCtx.fillStyle = "#ffffff";
      blankCtx.fillRect(0, 0, blankCanvas.width, blankCanvas.height);
    }

    return [{
      pageNumber: 1,
      surfaceKey: "document-page:1",
      imageUrl: blankCanvas.toDataURL("image/png"),
      thumbnailUrl: blankCanvas.toDataURL("image/png"),
      width: blankCanvas.width,
      height: blankCanvas.height,
    }];
  }

  return pages;
}

async function captureDocxPageModel(
  pageElement: HTMLElement,
  pageNumber: number,
): Promise<RichTextPageRenderModel> {
  const originalBoxShadow = pageElement.style.boxShadow;
  const originalMargin = pageElement.style.margin;
  const originalTransform = pageElement.style.transform;
  const width = Math.max(
    Math.round(pageElement.scrollWidth),
    Math.round(pageElement.getBoundingClientRect().width),
    1,
  );
  const height = Math.max(
    Math.round(pageElement.scrollHeight),
    Math.round(pageElement.getBoundingClientRect().height),
    1,
  );

  pageElement.style.boxShadow = "none";
  pageElement.style.margin = "0";
  pageElement.style.transform = "none";

  try {
    const pageCanvas = await captureElementCanvas(pageElement, {
      backgroundColor: "#ffffff",
      scale: PAGE_RENDER_SCALE,
      sanitizeStyles: false,
      ignoreElements: (element) =>
        element instanceof HTMLElement &&
        (
          element.closest(".hv-signature-overlay") !== null
          || element.closest('[data-hv-source-class~="hv-signature-overlay"]') !== null
        ),
    });

    if (!pageCanvas) {
      throw new Error("Unable to capture the DOCX page surface.");
    }

    return {
      pageNumber,
      surfaceKey: `document-page:${pageNumber}`,
      imageUrl: pageCanvas.toDataURL("image/png"),
      thumbnailUrl: createThumbnailDataUrl(pageCanvas),
      width: pageCanvas.width,
      height: pageCanvas.height,
    };
  } finally {
    pageElement.style.boxShadow = originalBoxShadow;
    pageElement.style.margin = originalMargin;
    pageElement.style.transform = originalTransform;
  }
}

function getPagesToShow(
  totalPages: number,
  currentPage: number,
  layout: "single" | "side-by-side",
) {
  if (totalPages === 0) {
    return [];
  }

  const validPage = Math.max(1, Math.min(currentPage, totalPages));

  if (layout === "side-by-side" && totalPages > 1) {
    if (validPage === 1) {
      return [1];
    }

    const left = validPage % 2 === 0 ? validPage : validPage - 1;
    return [left, left + 1].filter((pageNumber) => pageNumber <= totalPages);
  }

  return [validPage];
}

interface AuthoringTemplate {
  id: string;
  labelKey: string;
  descriptionKey: string;
  html: string;
}

interface RichTextToolbarState {
  blockTag: "p" | "h1" | "h2" | "h3" | "blockquote";
  bold: boolean;
  italic: boolean;
  underline: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  align: "left" | "center" | "right";
  insideTable: boolean;
  hasSelectedImage: boolean;
  imageSrc: string;
  imageAlt: string;
  imageSize: "sm" | "md" | "lg" | "full";
  imageCrop: "original" | "wide" | "square" | "portrait";
  imageAlign: "left" | "center" | "right";
  imageScale: number;
  imageFocusX: number;
  imageFocusY: number;
}

function createDefaultToolbarState(): RichTextToolbarState {
  return {
    blockTag: "p",
    bold: false,
    italic: false,
    underline: false,
    unorderedList: false,
    orderedList: false,
    align: "left",
    insideTable: false,
    hasSelectedImage: false,
    imageSrc: "",
    imageAlt: "",
    imageSize: "md",
    imageCrop: "original",
    imageAlign: "center",
    imageScale: 1,
    imageFocusX: 50,
    imageFocusY: 50,
  };
}

function getClosestEditorElement(node: Node | null, editor: HTMLElement) {
  let current =
    node instanceof HTMLElement
      ? node
      : node instanceof Text
        ? node.parentElement
        : null;

  while (current && current !== editor) {
    if (/^(P|H1|H2|H3|BLOCKQUOTE)$/i.test(current.tagName)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function getSelectionHostElement(
  editor: HTMLElement,
  fallbackRange?: Range | null,
) {
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  const selectionNode = selection?.anchorNode ?? fallbackRange?.startContainer ?? null;
  const hostElement =
    selectionNode instanceof HTMLElement
      ? selectionNode
      : selectionNode instanceof Text
        ? selectionNode.parentElement
        : null;

  return hostElement && editor.contains(hostElement) ? hostElement : null;
}

function getSelectedTableCell(editor: HTMLElement, fallbackRange?: Range | null) {
  const hostElement = getSelectionHostElement(editor, fallbackRange);
  return hostElement?.closest("td, th") as HTMLTableCellElement | null;
}

function getSelectedImageFigure(editor: HTMLElement, fallbackRange?: Range | null) {
  const hostElement = getSelectionHostElement(editor, fallbackRange);
  return hostElement?.closest("figure.hv-inline-image") as HTMLElement | null;
}

function getImageSizePreset(figure?: Element | null) {
  if (!figure) {
    return "md" as const;
  }

  if (figure.classList.contains("size-sm")) {
    return "sm" as const;
  }
  if (figure.classList.contains("size-lg")) {
    return "lg" as const;
  }
  if (figure.classList.contains("size-full")) {
    return "full" as const;
  }
  return "md" as const;
}

function getImageCropPreset(figure?: Element | null) {
  if (!figure) {
    return "original" as const;
  }

  if (figure.classList.contains("crop-wide")) {
    return "wide" as const;
  }
  if (figure.classList.contains("crop-square")) {
    return "square" as const;
  }
  if (figure.classList.contains("crop-portrait")) {
    return "portrait" as const;
  }
  return "original" as const;
}

function getImageAlignPreset(figure?: Element | null) {
  if (!figure) {
    return "center" as const;
  }

  if (figure.classList.contains("align-left")) {
    return "left" as const;
  }
  if (figure.classList.contains("align-right")) {
    return "right" as const;
  }
  return "center" as const;
}

function getImageNumericStyle(figure: HTMLElement | null | undefined, key: string, fallback: number) {
  if (!figure) {
    return fallback;
  }

  const raw = figure.style.getPropertyValue(key).trim().replace("%", "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readToolbarState(
  editor: HTMLElement,
  fallbackRange?: Range | null,
): RichTextToolbarState {
  if (typeof document === "undefined") {
    return createDefaultToolbarState();
  }

  const hostElement = getSelectionHostElement(editor, fallbackRange);
  const blockElement = hostElement
    ? getClosestEditorElement(hostElement, editor)
    : null;
  const selectedImageFigure = getSelectedImageFigure(editor, fallbackRange);
  const selectedImage = selectedImageFigure?.querySelector("img");

  const blockTag = (blockElement?.tagName.toLowerCase() ??
    "p") as RichTextToolbarState["blockTag"];

  const isCommandActive = (command: string) => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };

  return {
    blockTag,
    bold: isCommandActive("bold"),
    italic: isCommandActive("italic"),
    underline: isCommandActive("underline"),
    unorderedList: isCommandActive("insertUnorderedList"),
    orderedList: isCommandActive("insertOrderedList"),
    align: isCommandActive("justifyCenter")
      ? "center"
      : isCommandActive("justifyRight")
        ? "right"
        : "left",
    insideTable: Boolean(getSelectedTableCell(editor, fallbackRange)),
    hasSelectedImage: Boolean(selectedImageFigure),
    imageSrc: selectedImage instanceof HTMLImageElement ? selectedImage.src : "",
    imageAlt: selectedImage instanceof HTMLImageElement ? selectedImage.alt : "",
    imageSize: getImageSizePreset(selectedImageFigure),
    imageCrop: getImageCropPreset(selectedImageFigure),
    imageAlign: getImageAlignPreset(selectedImageFigure),
    imageScale: getImageNumericStyle(selectedImageFigure, "--hv-image-scale", 1),
    imageFocusX: getImageNumericStyle(selectedImageFigure, "--hv-image-focus-x", 50),
    imageFocusY: getImageNumericStyle(selectedImageFigure, "--hv-image-focus-y", 50),
  };
}

function normalizeLinkTarget(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function createDefaultTableHtml(rows = 3, cols = 3) {
  const headerCells = Array.from({ length: cols }, (_, index) => {
    return `<th>Heading ${index + 1}</th>`;
  }).join("");
  const bodyRows = Array.from({ length: rows }, () => {
    const cells = Array.from({ length: cols }, () => "<td>Value</td>").join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  return [
    "<table>",
    `<thead><tr>${headerCells}</tr></thead>`,
    `<tbody>${bodyRows}</tbody>`,
    "</table>",
  ].join("");
}

function createDefaultImageFigureHtml(imageUrl: string, altText: string) {
  return [
    '<figure class="hv-inline-image size-md crop-original align-center">',
    '<div class="hv-inline-image-frame">',
    `<img src="${imageUrl}" alt="${altText}" />`,
    "</div>",
    `<figcaption>${altText}</figcaption>`,
    "</figure>",
    "<p></p>",
  ].join("");
}

function clampImageControl(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createAuthoringTemplates(): AuthoringTemplate[] {
  return [
    {
      id: "blank",
      labelKey: "documents.richText.template.blank",
      descriptionKey: "documents.richText.templateDesc.blank",
      html: [
        "<h1>Document Title</h1>",
        "<p><strong>Summary:</strong> Add a short statement that explains the purpose of this document.</p>",
        "<hr />",
        "<h2>Overview</h2>",
        "<p>Start with the context, the goal, and the key outcome you want the reader to take away.</p>",
        "<h2>Details</h2>",
        "<p>Use this section for the main body of the document.</p>",
      ].join(""),
    },
    {
      id: "letter",
      labelKey: "documents.richText.template.letter",
      descriptionKey: "documents.richText.templateDesc.letter",
      html: [
        "<h1>Business Letter</h1>",
        "<p><strong>Your Company</strong><br />Street Address<br />City, State ZIP<br /><a href=\"mailto:team@example.com\">team@example.com</a></p>",
        "<p><strong>Date:</strong> March 24, 2026</p>",
        "<p><strong>Subject:</strong> Project update and next steps</p>",
        "<p>Dear Recipient Name,</p>",
        "<p>Thank you for the opportunity to support your team. This letter summarizes the current status, the key decisions that need attention, and the recommended next steps.</p>",
        "<blockquote>Use this area for a short executive summary, a request for approval, or a single critical instruction.</blockquote>",
        "<h2>Key Points</h2>",
        "<ul><li>Highlight the main update.</li><li>Clarify what changed since the last version.</li><li>Call out the action needed from the recipient.</li></ul>",
        "<p>Please let us know if you would like us to proceed with the recommended plan or if you would prefer an adjusted scope.</p>",
        "<p>Sincerely,</p>",
        "<p><strong>Your Name</strong><br />Title</p>",
      ].join(""),
    },
    {
      id: "notes",
      labelKey: "documents.richText.template.notes",
      descriptionKey: "documents.richText.templateDesc.notes",
      html: [
        "<h1>Meeting Notes</h1>",
        "<table><tbody><tr><th>Date</th><td>March 24, 2026</td></tr><tr><th>Time</th><td>10:00 AM</td></tr><tr><th>Facilitator</th><td>Your Name</td></tr><tr><th>Attendees</th><td>List attendees here</td></tr></tbody></table>",
        "<h2>Agenda</h2>",
        "<ol><li>Opening updates</li><li>Review current blockers</li><li>Confirm next milestones</li></ol>",
        "<h2>Discussion Highlights</h2>",
        "<ul><li>Summarize the most important discussion points.</li></ul>",
        "<h2>Decisions</h2>",
        "<ul><li>Capture the decisions made in the meeting.</li></ul>",
        "<h2>Action Items</h2>",
        "<table><thead><tr><th>Owner</th><th>Action</th><th>Due</th></tr></thead><tbody><tr><td>Name</td><td>Follow-up task</td><td>Date</td></tr></tbody></table>",
      ].join(""),
    },
    {
      id: "agreement",
      labelKey: "documents.richText.template.agreement",
      descriptionKey: "documents.richText.templateDesc.agreement",
      html: [
        "<h1>Agreement Summary</h1>",
        "<table><tbody><tr><th>Parties</th><td>Company A and Company B</td></tr><tr><th>Effective Date</th><td>March 24, 2026</td></tr><tr><th>Term</th><td>12 months</td></tr><tr><th>Owner</th><td>Department or team</td></tr></tbody></table>",
        "<blockquote>Use this document to describe the commercial understanding in plain language before the final contract is prepared or approved.</blockquote>",
        "<h2>Scope</h2>",
        "<p>Describe what is included, what the expected deliverables are, and what success should look like.</p>",
        "<h2>Commercial Terms</h2>",
        "<table><thead><tr><th>Item</th><th>Details</th></tr></thead><tbody><tr><td>Pricing</td><td>Describe the fee structure</td></tr><tr><td>Billing</td><td>Describe invoice terms</td></tr><tr><td>Service Levels</td><td>Describe response or delivery commitments</td></tr></tbody></table>",
        "<h2>Responsibilities</h2>",
        "<ul><li>List each party's major obligations.</li></ul>",
        "<h2>Approvals</h2>",
        "<p>Record the names, titles, and approval dates for each stakeholder.</p>",
      ].join(""),
    },
    {
      id: "proposal",
      labelKey: "documents.richText.template.proposal",
      descriptionKey: "documents.richText.templateDesc.proposal",
      html: [
        "<h1>Project Proposal</h1>",
        "<p><strong>Prepared for:</strong> Client Name</p>",
        "<p><strong>Prepared by:</strong> Your Company</p>",
        "<h2>Executive Summary</h2>",
        "<p>Describe the business problem, the recommended solution, and the outcome this engagement is designed to deliver.</p>",
        "<blockquote>Keep this section concise and value-focused. Make it easy for an executive reader to understand the proposal in under a minute.</blockquote>",
        "<h2>Objectives</h2>",
        "<ul><li>State the primary business objective.</li><li>State the operational or user goal.</li><li>State the measurable outcome.</li></ul>",
        "<h2>Scope of Work</h2>",
        "<ol><li>Discovery and planning</li><li>Implementation and review</li><li>Launch and handoff</li></ol>",
        "<h2>Deliverables</h2>",
        "<ul><li>List the final outputs the client will receive.</li></ul>",
        "<h2>Delivery Plan</h2>",
        "<table><thead><tr><th>Phase</th><th>Deliverable</th><th>Timing</th></tr></thead><tbody><tr><td>Phase 1</td><td>Discovery report</td><td>Week 1</td></tr><tr><td>Phase 2</td><td>Implementation</td><td>Weeks 2-4</td></tr><tr><td>Phase 3</td><td>Final handoff</td><td>Week 5</td></tr></tbody></table>",
        "<h2>Investment</h2>",
        "<table><thead><tr><th>Line Item</th><th>Amount</th></tr></thead><tbody><tr><td>Professional services</td><td>$0.00</td></tr><tr><td>Optional add-on</td><td>$0.00</td></tr></tbody></table>",
        "<h2>Assumptions</h2>",
        "<ul><li>Document any scope boundaries, client dependencies, or exclusions.</li></ul>",
      ].join(""),
    },
  ];
}

export function RichTextEditor(props: RichTextEditorProps) {
  const createCompactToolbarState = () => ({
    style: true,
    format: true,
    insert: false,
    media: false,
    history: false,
  });

  const editorRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const docxPreviewRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imagePreviewRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const imageDragPointerIdRef = useRef<number | null>(null);
  const [contentHtml, setContentHtml] = useState<string>("");
  const [editableContentHtml, setEditableContentHtml] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("blank");
  const [areTemplatesVisible, setAreTemplatesVisible] = useState(true);
  const [isCompactToolbar, setIsCompactToolbar] = useState(false);
  const [expandedToolbarSections, setExpandedToolbarSections] = useState(
    createCompactToolbarState,
  );
  const [imageEditorState, setImageEditorState] = useState<{
    src: string;
    alt: string;
    scale: number;
    focusX: number;
    focusY: number;
    crop: "original" | "wide" | "square" | "portrait";
  } | null>(null);
  const [toolbarState, setToolbarState] = useState<RichTextToolbarState>(
    createDefaultToolbarState(),
  );
  const [loading, setLoading] = useState(false);
  const [isPaginating, setIsPaginating] = useState(false);
  const [pages, setPages] = useState<RichTextPageRenderModel[]>([]);
  const [docxPages, setDocxPages] = useState<RichTextPageRenderModel[]>([]);
  const [isRenderingDocxPreview, setIsRenderingDocxPreview] = useState(false);
  const [docxPreviewFailed, setDocxPreviewFailed] = useState(false);

  const mdParser = useRef(new MarkdownIt({ html: true, linkify: true }));
  const authoringTemplates = useMemo(() => createAuthoringTemplates(), []);
  const isAuthoringMode = props.mode === "edit" || props.mode === "create";
  const isDocxFile =
    props.fileName.toLowerCase().endsWith(".docx") || props.fileType === "docx";
  const useDocxPreviewView =
    props.mode === "view" && isDocxFile && Boolean(props.arrayBuffer);

  const syncTemplateSelection = (nextHtml: string) => {
    const matchedTemplate = authoringTemplates.find(
      (template) => template.html === nextHtml,
    );
    setSelectedTemplateId(matchedTemplate?.id ?? "");
  };

  const captureSelectionRange = () => {
    if (!editorRef.current || typeof window === "undefined") {
      return;
    }

    const selection = window.getSelection();
    if (
      selection &&
      selection.rangeCount > 0 &&
      editorRef.current.contains(selection.anchorNode)
    ) {
      savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelectionRange = () => {
    if (!editorRef.current || typeof window === "undefined") {
      return false;
    }

    const selection = window.getSelection();
    if (!selection) {
      return false;
    }

    editorRef.current.focus();
    selection.removeAllRanges();

    if (
      savedSelectionRef.current &&
      editorRef.current.contains(savedSelectionRef.current.startContainer)
    ) {
      selection.addRange(savedSelectionRef.current);
      return true;
    }

    const fallbackRange = document.createRange();
    fallbackRange.selectNodeContents(editorRef.current);
    fallbackRange.collapse(false);
    selection.addRange(fallbackRange);
    savedSelectionRef.current = fallbackRange.cloneRange();
    return true;
  };

  const refreshToolbarState = () => {
    if (!editorRef.current || !isAuthoringMode) {
      setToolbarState(createDefaultToolbarState());
      return;
    }

    setToolbarState(readToolbarState(editorRef.current, savedSelectionRef.current));
  };

  useEffect(() => {
    const loadDoc = async () => {
      if (!props.arrayBuffer) {
        const templateHtml =
          props.mode === "create" ? authoringTemplates[0]?.html ?? "" : "";
        setContentHtml(templateHtml);
        setEditableContentHtml(templateHtml);
        setSelectedTemplateId(props.mode === "create" ? authoringTemplates[0]?.id ?? "" : "");
        setToolbarState(createDefaultToolbarState());
        setPages([]);
        setDocxPages([]);
        props.onPageCount(1);
        props.onThumbs([]);
        return;
      }

      setLoading(true);

      try {
        if (isDocxFile) {
          const result = await mammoth.convertToHtml({
            arrayBuffer: props.arrayBuffer,
          });
          const nextHtml = sanitizeHtml(result.value);
          setContentHtml(nextHtml);
          setEditableContentHtml(nextHtml);
          setSelectedTemplateId("");
        } else {
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(props.arrayBuffer);

          if (props.fileName.toLowerCase().endsWith(".md") || props.fileType === "md") {
            const html = mdParser.current.render(text);
            const nextHtml = sanitizeHtml(html);
            setContentHtml(nextHtml);
            setEditableContentHtml(nextHtml);
            setSelectedTemplateId("");
          } else {
            const nextHtml = buildPlainTextHtml(text);
            setContentHtml(nextHtml);
            setEditableContentHtml(nextHtml);
            setSelectedTemplateId("");
          }
        }

        props.onPageCount(1);
      } catch (err) {
        console.error("Doc Conversion failed", err);
        const errorHtml = `<p style="color:red">${escapeHtml(props.locale["documents.richText.parseError"])}</p>`;
        setContentHtml(errorHtml);
        setEditableContentHtml(errorHtml);
        setSelectedTemplateId("");
      } finally {
        setLoading(false);
      }
    };

    void loadDoc();
  }, [
    authoringTemplates,
    isDocxFile,
    props.arrayBuffer,
    props.fileName,
    props.fileType,
    props.locale,
    props.mode,
  ]);

  useEffect(() => {
    if (!isAuthoringMode || !editorRef.current) {
      return;
    }

    if (editorRef.current.innerHTML !== editableContentHtml) {
      editorRef.current.innerHTML = editableContentHtml;
    }

    refreshToolbarState();
  }, [editableContentHtml, isAuthoringMode]);

  useEffect(() => {
    if (!isAuthoringMode || typeof document === "undefined") {
      return;
    }

    const handleSelectionChange = () => {
      if (!editorRef.current) {
        return;
      }

      const selection = window.getSelection();
      const selectionNode = selection?.anchorNode ?? null;

      if (!selectionNode || editorRef.current.contains(selectionNode)) {
        captureSelectionRange();
        refreshToolbarState();
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [isAuthoringMode]);

  useEffect(() => {
    if (props.mode === "create") {
      setAreTemplatesVisible(true);
    }
  }, [props.mode, props.fileName]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const syncCompactState = () => {
      setIsCompactToolbar(mediaQuery.matches);
      if (!mediaQuery.matches) {
        setExpandedToolbarSections(createCompactToolbarState());
      }
    };

    syncCompactState();
    mediaQuery.addEventListener("change", syncCompactState);
    return () => {
      mediaQuery.removeEventListener("change", syncCompactState);
    };
  }, []);

  useEffect(() => {
    if (toolbarState.hasSelectedImage && toolbarState.imageSrc) {
      setImageEditorState({
        src: toolbarState.imageSrc,
        alt: toolbarState.imageAlt,
        scale: toolbarState.imageScale,
        focusX: toolbarState.imageFocusX,
        focusY: toolbarState.imageFocusY,
        crop: toolbarState.imageCrop,
      });
      return;
    }

    setImageEditorState(null);
  }, [
    toolbarState.hasSelectedImage,
    toolbarState.imageAlt,
    toolbarState.imageCrop,
    toolbarState.imageFocusX,
    toolbarState.imageFocusY,
    toolbarState.imageScale,
    toolbarState.imageSrc,
  ]);

  useEffect(() => {
    if (!useDocxPreviewView || !docxPreviewRef.current || !props.arrayBuffer) {
      setDocxPages([]);
      setDocxPreviewFailed(false);
      setIsRenderingDocxPreview(false);
      if (docxPreviewRef.current) {
        docxPreviewRef.current.innerHTML = "";
      }
      return;
    }

    let cancelled = false;

    const renderDocxPreview = async () => {
      const host = docxPreviewRef.current;
      const arrayBuffer = props.arrayBuffer;
      if (!host) {
        return;
      }

      setDocxPreviewFailed(false);
      setIsRenderingDocxPreview(true);
      setDocxPages([]);
      props.onThumbs([]);
      host.innerHTML = "";

      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled) {
          return;
        }

        if (!arrayBuffer) {
          return;
        }

        await renderAsync(arrayBuffer.slice(0), host, undefined, {
          className: DOCX_PREVIEW_CLASS_NAME,
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          useBase64URL: true,
        });

        await waitForRenderReady(host);

        if (cancelled) {
          return;
        }

        const pageElements = Array.from(
          host.querySelectorAll<HTMLElement>(`section.${DOCX_PREVIEW_CLASS_NAME}`),
        );

        if (pageElements.length === 0) {
          throw new Error("No DOCX pages were rendered.");
        }

        const nextPageModels: RichTextPageRenderModel[] = [];

        for (const [index, pageElement] of pageElements.entries()) {
          nextPageModels.push(
            await captureDocxPageModel(
              pageElement,
              index + 1,
            ),
          );

          if ((index + 1) % 3 === 0) {
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => resolve());
            });
          }
        }

        if (cancelled) {
          return;
        }

        setDocxPages(nextPageModels);
        props.onPageCount(nextPageModels.length);
        props.onThumbs(
          nextPageModels.map((page) => page.thumbnailUrl || page.imageUrl),
        );

        if (props.currentPage > nextPageModels.length) {
          props.onCurrentPageChange(1);
        }
      } catch (error) {
        console.error("DOCX preview rendering failed", error);
        if (!cancelled) {
          setDocxPreviewFailed(true);
          setDocxPages([]);
          props.onPageCount(1);
          props.onThumbs([]);
        }
      } finally {
        if (!cancelled) {
          setIsRenderingDocxPreview(false);
        }
      }
    };

    void renderDocxPreview();

    return () => {
      cancelled = true;
    };
  }, [
    props.arrayBuffer,
    props.onCurrentPageChange,
    props.onPageCount,
    props.onThumbs,
    useDocxPreviewView,
  ]);

  useEffect(() => {
    if (props.mode !== "view") {
      setPages([]);
      props.onPageCount(1);
      props.onThumbs([]);
      return;
    }

    if (useDocxPreviewView && !docxPreviewFailed) {
      setPages([]);
      return;
    }

    if (!contentHtml || !measureRef.current) {
      setPages([]);
      props.onPageCount(1);
      props.onThumbs([]);
      return;
    }

    let cancelled = false;

    const paginate = async () => {
      const measureElement = measureRef.current;
      if (!measureElement) {
        return;
      }

      setIsPaginating(true);
      props.onThumbs([]);

      try {
        await waitForRenderReady(measureElement);

        const totalHeight = Math.max(
          measureElement.scrollHeight,
          DOC_PAGE_HEIGHT,
        );
        const fullCanvas = await captureElementCanvas(measureElement, {
          backgroundColor: "#ffffff",
          scale: PAGE_RENDER_SCALE,
          sanitizeStyles: false,
        });
        if (!fullCanvas) {
          throw new Error("Unable to capture the rich text document surface.");
        }
        const breakOffsets = calculatePageBreakOffsets(
          measureElement,
          DOC_PAGE_HEIGHT,
        );
        const nextPages = buildPageModels(fullCanvas, breakOffsets);

        if (cancelled) {
          return;
        }

        setPages(nextPages);
        props.onPageCount(nextPages.length);
        props.onThumbs(
          nextPages.map((page) => page.thumbnailUrl || page.imageUrl),
        );

        if (props.currentPage > nextPages.length) {
          props.onCurrentPageChange(1);
        }
      } catch (error) {
        console.error("Rich text pagination failed", error);
        if (!cancelled) {
          setPages([]);
          props.onPageCount(1);
          props.onThumbs([]);
        }
      } finally {
        if (!cancelled) {
          setIsPaginating(false);
        }
      }
    };

    void paginate();

    return () => {
      cancelled = true;
    };
  }, [
    contentHtml,
    docxPreviewFailed,
    props.mode,
    props.onCurrentPageChange,
    props.onPageCount,
    props.onThumbs,
    useDocxPreviewView,
  ]);

  const activeViewPages = useMemo(
    () =>
      props.mode === "view"
        ? useDocxPreviewView && !docxPreviewFailed
          ? docxPages
          : pages
        : undefined,
    [docxPages, docxPreviewFailed, pages, props.mode, useDocxPreviewView],
  );

  useEffect(() => {
    const container =
      props.mode === "view"
        ? useDocxPreviewView && !docxPreviewFailed
          ? docxPreviewRef.current
          : measureRef.current
        : editorRef.current;

    props.onExportStateChange?.({
      container,
      contentHtml: props.mode === "view" ? contentHtml : editableContentHtml,
      pages: activeViewPages,
    });
  }, [
    activeViewPages,
    contentHtml,
    docxPreviewFailed,
    editableContentHtml,
    props.mode,
    props.onExportStateChange,
    useDocxPreviewView,
  ]);

  useEffect(() => {
    return () => {
      props.onExportStateChange?.(null);
    };
  }, [props.onExportStateChange]);

  const pagesToShow = useMemo(
    () =>
      getPagesToShow(
        useDocxPreviewView && !docxPreviewFailed
          ? docxPages.length
          : pages.length,
        props.currentPage,
        props.layout,
      ),
    [
      docxPreviewFailed,
      docxPages.length,
      pages.length,
      props.currentPage,
      props.layout,
      useDocxPreviewView,
    ],
  );

  const syncEditableSurface = () => {
    const nextHtml = editorRef.current?.innerHTML || "";
    setEditableContentHtml(nextHtml);
    setContentHtml(nextHtml);
    syncTemplateSelection(nextHtml);
    captureSelectionRange();
    refreshToolbarState();
  };

  const applyAuthoringCommand = (command: string, value?: string) => {
    if (
      !editorRef.current ||
      typeof document === "undefined" ||
      typeof document.execCommand !== "function"
    ) {
      return;
    }

    restoreSelectionRange();
    document.execCommand(command, false, value);
    syncEditableSurface();
  };

  const insertAuthoringHtml = (html: string) => {
    if (
      !editorRef.current ||
      typeof document === "undefined" ||
      typeof document.execCommand !== "function"
    ) {
      return;
    }

    restoreSelectionRange();
    document.execCommand("insertHTML", false, html);
    syncEditableSurface();
  };

  const insertLink = () => {
    if (
      !editorRef.current ||
      typeof document === "undefined" ||
      typeof window === "undefined"
    ) {
      return;
    }

    const candidateUrl = window.prompt(
      props.locale["documents.richText.toolbar.link"],
      "https://",
    );

    if (!candidateUrl) {
      return;
    }

    const normalizedUrl = normalizeLinkTarget(candidateUrl);
    if (!normalizedUrl) {
      return;
    }

    restoreSelectionRange();
    const selectionText = window.getSelection()?.toString().trim() ?? "";

    if (selectionText) {
      document.execCommand("createLink", false, normalizedUrl);
    } else {
      insertAuthoringHtml(
        `<a href="${escapeHtml(normalizedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(normalizedUrl)}</a>`,
      );
      return;
    }

    syncEditableSurface();
  };

  const handleImagePickerOpen = () => {
    captureSelectionRange();
    imageInputRef.current?.click();
  };

  const handleInsertImage = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const imageUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const baseName = file.name.replace(/\.[^.]+$/, "") || "Image";
      const safeName = escapeHtml(baseName);

      insertAuthoringHtml(createDefaultImageFigureHtml(imageUrl, safeName));
    } catch (error) {
      console.error("Image insertion failed", error);
    }
  };

  const reselectImageFigure = (figure: HTMLElement) => {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(figure);
      selection.removeAllRanges();
      selection.addRange(range);
      savedSelectionRef.current = range.cloneRange();
    }
  };

  const applyImageFigureState = (
    figure: HTMLElement,
    patch: Partial<{
      size: "sm" | "md" | "lg" | "full";
      crop: "original" | "wide" | "square" | "portrait";
      align: "left" | "center" | "right";
      scale: number;
      focusX: number;
      focusY: number;
    }>,
  ) => {
    if (patch.size) {
      figure.classList.remove("size-sm", "size-md", "size-lg", "size-full");
      figure.classList.add(`size-${patch.size}`);
    }

    if (patch.crop) {
      figure.classList.remove(
        "crop-original",
        "crop-wide",
        "crop-square",
        "crop-portrait",
      );
      figure.classList.add(`crop-${patch.crop}`);
    }

    if (patch.align) {
      figure.classList.remove("align-left", "align-center", "align-right");
      figure.classList.add(`align-${patch.align}`);
    }

    if (typeof patch.scale === "number") {
      figure.style.setProperty("--hv-image-scale", patch.scale.toFixed(2));
    }

    if (typeof patch.focusX === "number") {
      figure.style.setProperty("--hv-image-focus-x", `${patch.focusX.toFixed(2)}%`);
    }

    if (typeof patch.focusY === "number") {
      figure.style.setProperty("--hv-image-focus-y", `${patch.focusY.toFixed(2)}%`);
    }
  };

  const updateSelectedImage = (
    patch: Partial<{
      size: "sm" | "md" | "lg" | "full";
      crop: "original" | "wide" | "square" | "portrait";
      align: "left" | "center" | "right";
      scale: number;
      focusX: number;
      focusY: number;
    }>,
    options?: {
      sync?: boolean;
    },
  ) => {
    if (!editorRef.current) {
      return;
    }

    restoreSelectionRange();
    const figure = getSelectedImageFigure(editorRef.current, savedSelectionRef.current);
    const image = figure?.querySelector("img");

    if (!figure || !(image instanceof HTMLImageElement)) {
      return;
    }

    applyImageFigureState(figure, patch);
    reselectImageFigure(figure);

    if (options?.sync === false) {
      refreshToolbarState();
      return;
    }

    syncEditableSurface();
  };

  const handleSetImageSize = (size: "sm" | "md" | "lg" | "full") => {
    updateSelectedImage({ size });
  };

  const handleSetImageCrop = (
    crop: "original" | "wide" | "square" | "portrait",
  ) => {
    setImageEditorState((prev) =>
      prev
        ? {
            ...prev,
            crop,
          }
        : prev,
    );
    updateSelectedImage({ crop });
  };

  const handleSetImageAlign = (align: "left" | "center" | "right") => {
    updateSelectedImage({ align });
  };

  const setImageEditorDraft = (patch: Partial<NonNullable<typeof imageEditorState>>) => {
    setImageEditorState((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleImageScaleInput = (nextScale: number, sync: boolean) => {
    const scale = clampImageControl(nextScale, 1, 2.5);
    setImageEditorDraft({ scale });
    updateSelectedImage({ scale }, { sync });
  };

  const updateImageFocusFromPointer = (
    event: React.PointerEvent<HTMLDivElement>,
    sync: boolean,
  ) => {
    const preview = imagePreviewRef.current;
    if (!preview) {
      return;
    }

    const rect = preview.getBoundingClientRect();
    const focusX = clampImageControl(
      ((event.clientX - rect.left) / rect.width) * 100,
      0,
      100,
    );
    const focusY = clampImageControl(
      ((event.clientY - rect.top) / rect.height) * 100,
      0,
      100,
    );

    setImageEditorDraft({ focusX, focusY });
    updateSelectedImage({ focusX, focusY }, { sync });
  };

  const handleImagePreviewPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!toolbarState.hasSelectedImage) {
      return;
    }

    imageDragPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateImageFocusFromPointer(event, false);
  };

  const handleImagePreviewPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (imageDragPointerIdRef.current !== event.pointerId) {
      return;
    }

    updateImageFocusFromPointer(event, false);
  };

  const handleImagePreviewPointerUp = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (imageDragPointerIdRef.current !== event.pointerId) {
      return;
    }

    imageDragPointerIdRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    updateImageFocusFromPointer(event, true);
  };

  const mutateSelectedTable = (
    mutation: (
      table: HTMLTableElement,
      row: HTMLTableRowElement,
      cell: HTMLTableCellElement,
      cellIndex: number,
    ) => void,
  ) => {
    if (!editorRef.current) {
      return;
    }

    restoreSelectionRange();
    const cell = getSelectedTableCell(editorRef.current, savedSelectionRef.current);
    const row = cell?.parentElement;
    const table = cell?.closest("table");

    if (
      !cell ||
      !(row instanceof HTMLTableRowElement) ||
      !(table instanceof HTMLTableElement)
    ) {
      return;
    }

    const cellIndex = Array.from(row.cells).indexOf(cell);
    if (cellIndex < 0) {
      return;
    }

    mutation(table, row, cell, cellIndex);
    syncEditableSurface();
  };

  const handleAddTableRow = () => {
    mutateSelectedTable((table, row) => {
      const targetSection =
        row.parentElement?.tagName === "THEAD"
          ? table.tBodies[0] ?? table.appendChild(document.createElement("tbody"))
          : row.parentElement;

      if (!(targetSection instanceof HTMLElement)) {
        return;
      }

      const sourceCells =
        Array.from(row.cells).length > 0
          ? Array.from(row.cells)
          : Array.from(table.rows[0]?.cells ?? []);
      const nextRow = document.createElement("tr");

      const newCells =
        sourceCells.length > 0
          ? sourceCells
          : Array.from({ length: 3 }, () => document.createElement("td"));

      newCells.forEach((sourceCell, index) => {
        const nextCell = document.createElement(
          targetSection.tagName === "THEAD" || sourceCell.tagName === "TH"
            ? "th"
            : "td",
        );
        nextCell.textContent = targetSection.tagName === "THEAD"
          ? `Heading ${index + 1}`
          : "Value";
        nextRow.appendChild(nextCell);
      });

      if (row.parentElement === targetSection && row.nextSibling) {
        targetSection.insertBefore(nextRow, row.nextSibling);
      } else {
        targetSection.appendChild(nextRow);
      }
    });
  };

  const handleAddTableColumn = () => {
    mutateSelectedTable((table, _row, _cell, cellIndex) => {
      Array.from(table.rows).forEach((tableRow) => {
        const insertionCell = tableRow.cells[cellIndex];
        const nextCell = document.createElement(
          tableRow.parentElement?.tagName === "THEAD" ||
            insertionCell?.tagName === "TH"
            ? "th"
            : "td",
        );

        nextCell.textContent =
          nextCell.tagName === "TH"
            ? `Heading ${cellIndex + 2}`
            : "Value";

        if (insertionCell?.nextSibling) {
          tableRow.insertBefore(nextCell, insertionCell.nextSibling);
        } else {
          tableRow.appendChild(nextCell);
        }
      });
    });
  };

  const handleDeleteTableRow = () => {
    mutateSelectedTable((table, row) => {
      row.remove();
      if (table.rows.length === 0) {
        table.remove();
      }
    });
  };

  const handleDeleteTableColumn = () => {
    mutateSelectedTable((table, _row, _cell, cellIndex) => {
      Array.from(table.rows).forEach((tableRow) => {
        if (tableRow.cells[cellIndex]) {
          tableRow.deleteCell(cellIndex);
        }
      });

      const hasCellsRemaining = Array.from(table.rows).some(
        (tableRow) => tableRow.cells.length > 0,
      );

      if (!hasCellsRemaining) {
        table.remove();
      }
    });
  };

  const isToolbarSectionOpen = (
    section: keyof ReturnType<typeof createCompactToolbarState>,
  ) => {
    return !isCompactToolbar || expandedToolbarSections[section];
  };

  const toggleToolbarSection = (
    section: keyof ReturnType<typeof createCompactToolbarState>,
  ) => {
    setExpandedToolbarSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const renderToolbarSectionHeader = (
    section: keyof ReturnType<typeof createCompactToolbarState>,
    label: string,
  ) => {
    if (!isCompactToolbar) {
      return <span className="hv-richtext-toolbar-label">{label}</span>;
    }

    const isOpen = isToolbarSectionOpen(section);

    return (
      <button
        type="button"
        className={`hv-richtext-toolbar-section-toggle ${isOpen ? "open" : ""}`}
        aria-expanded={isOpen}
        onClick={() => toggleToolbarSection(section)}
      >
        <span className="hv-richtext-toolbar-label">{label}</span>
        <span className="hv-richtext-toolbar-toggle-copy">
          {isOpen
            ? props.locale["documents.richText.toolbar.collapseSection"]
            : props.locale["documents.richText.toolbar.expandSection"]}
        </span>
      </button>
    );
  };

  const applyTemplate = (templateId: string) => {
    const template = authoringTemplates.find((candidate) => candidate.id === templateId);
    if (!template) {
      return;
    }

    setEditableContentHtml(template.html);
    setContentHtml(template.html);
    setSelectedTemplateId(template.id);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      captureSelectionRange();
      refreshToolbarState();
    });
  };

  if (props.mode === "view" && useDocxPreviewView && !docxPreviewFailed) {
    return (
      <>
        <div className="hv-docx-preview-shell" aria-hidden="true">
          <div
            ref={docxPreviewRef}
            className="hv-docx-preview-host"
            aria-label="DOCX document pages"
          />
        </div>

        <div
          className={
            props.layout === "side-by-side" ? "hv-view-double" : "hv-view-single"
          }
        >
          {loading || isRenderingDocxPreview ? (
            <div className="hv-page-container hv-docx-page-surface">
              <div className="hv-loading-copy">
                {props.locale["documents.richText.renderingPages"]}
              </div>
            </div>
          ) : (
            pagesToShow.map((pageNumber) => {
              const page = docxPages[pageNumber - 1];
              if (!page) {
                return null;
              }

              return (
                <div
                  key={page.surfaceKey}
                  className="hv-page-container hv-docx-page-surface"
                >
                  <img
                    src={page.imageUrl}
                    alt={`Document page ${pageNumber}`}
                    className="hv-docx-page-image"
                  />
                  <SignatureOverlay
                    surfaceKey={page.surfaceKey}
                    surfaceKind="document"
                    page={pageNumber}
                    placements={props.signatureOverlay.placements}
                    annotations={props.signatureOverlay.annotations}
                    pendingSignature={props.signatureOverlay.pendingSignature}
                    pendingAnnotation={props.signatureOverlay.pendingAnnotation}
                    activePlacementId={props.signatureOverlay.activePlacementId}
                    activeAnnotationId={props.signatureOverlay.activeAnnotationId}
                    placeHint={props.signatureOverlay.placeHint}
                    annotationHint={props.signatureOverlay.annotationHint}
                    annotationPlaceholder={
                      props.signatureOverlay.annotationPlaceholder
                    }
                    signatureAltLabel={props.signatureOverlay.signatureAltLabel}
                    signatureAltByLabel={props.signatureOverlay.signatureAltByLabel}
                    signatureNoteIndicatorLabel={
                      props.signatureOverlay.signatureNoteIndicatorLabel
                    }
                    signatureColorLabel={props.signatureOverlay.signatureColorLabel}
                    signatureColorNames={props.signatureOverlay.signatureColorNames}
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
              );
            })
          )}
        </div>
      </>
    );
  }

  if (props.mode === "view") {
    return (
      <>
        <div className="hv-docx-measure-shell" aria-hidden="true">
          <div
            ref={measureRef}
            className="hv-docx-content hv-docx-measure-content"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        </div>

        <div
          className={
            props.layout === "side-by-side" ? "hv-view-double" : "hv-view-single"
          }
        >
          {loading || isPaginating ? (
            <div className="hv-page-container hv-docx-page-surface">
              <div className="hv-loading-copy">
                {props.locale["documents.richText.renderingPages"]}
              </div>
            </div>
          ) : (
            pagesToShow.map((pageNumber) => {
              const page = pages[pageNumber - 1];
              if (!page) {
                return null;
              }

              return (
                <div
                  key={page.surfaceKey}
                  className="hv-page-container hv-docx-page-surface"
                >
                  <img
                    src={page.imageUrl}
                    alt={`Document page ${pageNumber}`}
                    className="hv-docx-page-image"
                  />
                  <SignatureOverlay
                    surfaceKey={page.surfaceKey}
                    surfaceKind="document"
                    page={pageNumber}
                    placements={props.signatureOverlay.placements}
                    annotations={props.signatureOverlay.annotations}
                    pendingSignature={props.signatureOverlay.pendingSignature}
                    pendingAnnotation={props.signatureOverlay.pendingAnnotation}
                    activePlacementId={props.signatureOverlay.activePlacementId}
                    activeAnnotationId={props.signatureOverlay.activeAnnotationId}
                    placeHint={props.signatureOverlay.placeHint}
                    annotationHint={props.signatureOverlay.annotationHint}
                    annotationPlaceholder={
                      props.signatureOverlay.annotationPlaceholder
                    }
                    signatureAltLabel={props.signatureOverlay.signatureAltLabel}
                    signatureAltByLabel={props.signatureOverlay.signatureAltByLabel}
                    signatureNoteIndicatorLabel={
                      props.signatureOverlay.signatureNoteIndicatorLabel
                    }
                    signatureColorLabel={props.signatureOverlay.signatureColorLabel}
                    signatureColorNames={props.signatureOverlay.signatureColorNames}
                    removeSignatureLabel={props.signatureOverlay.removeSignatureLabel}
                    annotationTitle={props.signatureOverlay.annotationTitle}
                    linkedAnnotationTitle={
                      props.signatureOverlay.linkedAnnotationTitle
                    }
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
              );
            })
          )}
        </div>
      </>
    );
  }

  return (
    <div className="hv-view-single hv-richtext-authoring-shell">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hv-richtext-file-input"
        onChange={handleInsertImage}
      />
      {isAuthoringMode && (
        <div className="hv-richtext-authoring-top">
        <div
          className="hv-richtext-toolbar"
          role="toolbar"
          aria-label={props.locale["a11y.ribbon"]}
        >
          <div className="hv-richtext-toolbar-row">
            <div className="hv-richtext-toolbar-section">
              {renderToolbarSectionHeader(
                "style",
                props.locale["documents.richText.toolbar.styleLabel"],
              )}
              {isToolbarSectionOpen("style") && (
                <select
                  className="hv-richtext-select"
                  value={toolbarState.blockTag}
                  onChange={(event) =>
                    applyAuthoringCommand(
                      "formatBlock",
                      event.target.value === "blockquote"
                        ? "BLOCKQUOTE"
                        : event.target.value.toUpperCase(),
                    )
                  }
                >
                  <option value="p">
                    {props.locale["documents.richText.toolbar.paragraph"]}
                  </option>
                  <option value="h1">
                    {props.locale["documents.richText.toolbar.heading1"]}
                  </option>
                  <option value="h2">
                    {props.locale["documents.richText.toolbar.heading2"]}
                  </option>
                  <option value="h3">
                    {props.locale["documents.richText.toolbar.heading3"]}
                  </option>
                  <option value="blockquote">
                    {props.locale["documents.richText.toolbar.quote"]}
                  </option>
                </select>
              )}
            </div>

            <div className="hv-richtext-toolbar-section">
              {renderToolbarSectionHeader(
                "format",
                props.locale["documents.richText.toolbar.formatLabel"],
              )}
              {isToolbarSectionOpen("format") && (
                <div className="hv-richtext-button-group">
                  <button
                    type="button"
                    className={`hv-btn ${toolbarState.bold ? "hv-btn-active" : ""}`}
                    onClick={() => applyAuthoringCommand("bold")}
                    title={props.locale["documents.richText.toolbar.bold"]}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    className={`hv-btn ${toolbarState.italic ? "hv-btn-active" : ""}`}
                    onClick={() => applyAuthoringCommand("italic")}
                    title={props.locale["documents.richText.toolbar.italic"]}
                  >
                    I
                  </button>
                  <button
                    type="button"
                    className={`hv-btn ${toolbarState.underline ? "hv-btn-active" : ""}`}
                    onClick={() => applyAuthoringCommand("underline")}
                    title={props.locale["documents.richText.toolbar.underline"]}
                  >
                    U
                  </button>
                  <button
                    type="button"
                    className={`hv-btn ${toolbarState.unorderedList ? "hv-btn-active" : ""}`}
                    onClick={() => applyAuthoringCommand("insertUnorderedList")}
                    title={props.locale["documents.richText.toolbar.bullets"]}
                  >
                    UL
                  </button>
                  <button
                    type="button"
                    className={`hv-btn ${toolbarState.orderedList ? "hv-btn-active" : ""}`}
                    onClick={() => applyAuthoringCommand("insertOrderedList")}
                    title={props.locale["documents.richText.toolbar.numbered"]}
                  >
                    1.
                  </button>
                  <button
                    type="button"
                    className={`hv-btn ${toolbarState.align === "left" ? "hv-btn-active" : ""}`}
                    onClick={() => applyAuthoringCommand("justifyLeft")}
                    title={props.locale["documents.richText.toolbar.alignLeft"]}
                  >
                    L
                  </button>
                  <button
                    type="button"
                    className={`hv-btn ${toolbarState.align === "center" ? "hv-btn-active" : ""}`}
                    onClick={() => applyAuthoringCommand("justifyCenter")}
                    title={props.locale["documents.richText.toolbar.alignCenter"]}
                  >
                    C
                  </button>
                  <button
                    type="button"
                    className={`hv-btn ${toolbarState.align === "right" ? "hv-btn-active" : ""}`}
                    onClick={() => applyAuthoringCommand("justifyRight")}
                    title={props.locale["documents.richText.toolbar.alignRight"]}
                  >
                    R
                  </button>
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={() => applyAuthoringCommand("removeFormat")}
                    title={props.locale["documents.richText.toolbar.clearFormatting"]}
                  >
                    Tx
                  </button>
                </div>
              )}
            </div>

            <div className="hv-richtext-toolbar-section">
              {renderToolbarSectionHeader(
                "insert",
                props.locale["documents.richText.toolbar.insertLabel"],
              )}
              {isToolbarSectionOpen("insert") && (
                <div className="hv-richtext-button-group">
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={insertLink}
                    title={props.locale["documents.richText.toolbar.link"]}
                  >
                    Link
                  </button>
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={() => insertAuthoringHtml("<hr />")}
                    title={props.locale["documents.richText.toolbar.divider"]}
                  >
                    Rule
                  </button>
                </div>
              )}
            </div>

            <div className="hv-richtext-toolbar-section">
              {renderToolbarSectionHeader(
                "media",
                props.locale["documents.richText.toolbar.mediaLabel"],
              )}
              {isToolbarSectionOpen("media") && (
                <div className="hv-richtext-button-group">
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={handleImagePickerOpen}
                    title={props.locale["documents.richText.toolbar.image"]}
                  >
                    Image
                  </button>
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={() => insertAuthoringHtml(createDefaultTableHtml())}
                    title={props.locale["documents.richText.toolbar.table"]}
                  >
                    Table
                  </button>
                </div>
              )}
            </div>

            <div className="hv-richtext-toolbar-section">
              {renderToolbarSectionHeader(
                "history",
                props.locale["documents.richText.toolbar.historyLabel"],
              )}
              {isToolbarSectionOpen("history") && (
                <div className="hv-richtext-button-group">
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={() => applyAuthoringCommand("undo")}
                    title={props.locale["documents.richText.toolbar.undo"]}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={() => applyAuthoringCommand("redo")}
                    title={props.locale["documents.richText.toolbar.redo"]}
                  >
                    Redo
                  </button>
                </div>
              )}
            </div>
          </div>

          {toolbarState.hasSelectedImage && imageEditorState && (
            <div className="hv-richtext-context-panel">
              <div className="hv-richtext-context-header">
                <div>
                  <strong>{props.locale["documents.richText.imageEditorTitle"]}</strong>
                  <p>{props.locale["documents.richText.imageEditorHelp"]}</p>
                </div>
              </div>

              <div className="hv-richtext-image-editor">
                <div className="hv-richtext-image-preview-card">
                  <div
                    ref={imagePreviewRef}
                    className={`hv-richtext-image-preview crop-${imageEditorState.crop}`}
                    onPointerDown={handleImagePreviewPointerDown}
                    onPointerMove={handleImagePreviewPointerMove}
                    onPointerUp={handleImagePreviewPointerUp}
                    onPointerCancel={handleImagePreviewPointerUp}
                  >
                    <img
                      src={imageEditorState.src}
                      alt={imageEditorState.alt}
                      style={{
                        transform: `scale(${imageEditorState.scale})`,
                        objectPosition: `${imageEditorState.focusX}% ${imageEditorState.focusY}%`,
                      }}
                    />
                    <div
                      className="hv-richtext-image-focus-point"
                      style={{
                        left: `${imageEditorState.focusX}%`,
                        top: `${imageEditorState.focusY}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="hv-richtext-image-controls">
                  <div className="hv-richtext-toolbar-subgroup">
                    <span className="hv-richtext-toolbar-sublabel">
                      {props.locale["documents.richText.toolbar.imageSizeLabel"]}
                    </span>
                    <div className="hv-richtext-button-group">
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageSize === "sm" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageSize("sm")}
                      >
                        S
                      </button>
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageSize === "md" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageSize("md")}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageSize === "lg" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageSize("lg")}
                      >
                        L
                      </button>
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageSize === "full" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageSize("full")}
                      >
                        Full
                      </button>
                    </div>
                  </div>

                  <div className="hv-richtext-toolbar-subgroup">
                    <span className="hv-richtext-toolbar-sublabel">
                      {props.locale["documents.richText.toolbar.imageCropLabel"]}
                    </span>
                    <div className="hv-richtext-button-group">
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageCrop === "original" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageCrop("original")}
                      >
                        Orig
                      </button>
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageCrop === "wide" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageCrop("wide")}
                      >
                        Wide
                      </button>
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageCrop === "square" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageCrop("square")}
                      >
                        1:1
                      </button>
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageCrop === "portrait" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageCrop("portrait")}
                      >
                        Tall
                      </button>
                    </div>
                  </div>

                  <div className="hv-richtext-toolbar-subgroup">
                    <span className="hv-richtext-toolbar-sublabel">
                      {props.locale["documents.richText.toolbar.imageAlignLabel"]}
                    </span>
                    <div className="hv-richtext-button-group">
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageAlign === "left" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageAlign("left")}
                      >
                        Left
                      </button>
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageAlign === "center" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageAlign("center")}
                      >
                        Center
                      </button>
                      <button
                        type="button"
                        className={`hv-btn ${toolbarState.imageAlign === "right" ? "hv-btn-active" : ""}`}
                        onClick={() => handleSetImageAlign("right")}
                      >
                        Right
                      </button>
                    </div>
                  </div>

                  <label className="hv-richtext-range-group">
                    <span>{props.locale["documents.richText.imageZoom"]}</span>
                    <input
                      type="range"
                      min="1"
                      max="2.5"
                      step="0.05"
                      value={imageEditorState.scale}
                      onChange={(event) =>
                        handleImageScaleInput(Number(event.target.value), false)
                      }
                      onMouseUp={(event) =>
                        handleImageScaleInput(
                          Number((event.target as HTMLInputElement).value),
                          true,
                        )
                      }
                      onTouchEnd={(event) =>
                        handleImageScaleInput(
                          Number((event.target as HTMLInputElement).value),
                          true,
                        )
                      }
                      onKeyUp={(event) =>
                        handleImageScaleInput(
                          Number((event.target as HTMLInputElement).value),
                          true,
                        )
                      }
                    />
                    <strong>{imageEditorState.scale.toFixed(2)}x</strong>
                  </label>

                  <div className="hv-richtext-focus-readout">
                    <span>X {Math.round(imageEditorState.focusX)}%</span>
                    <span>Y {Math.round(imageEditorState.focusY)}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!toolbarState.hasSelectedImage && toolbarState.insideTable && (
            <div className="hv-richtext-context-panel hv-richtext-context-panel-compact">
              <div className="hv-richtext-toolbar-subgroup">
                <span className="hv-richtext-toolbar-sublabel">
                  {props.locale["documents.richText.toolbar.tableLabel"]}
                </span>
                <div className="hv-richtext-button-group">
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={handleAddTableRow}
                    title={props.locale["documents.richText.toolbar.tableAddRow"]}
                  >
                    +Row
                  </button>
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={handleAddTableColumn}
                    title={props.locale["documents.richText.toolbar.tableAddColumn"]}
                  >
                    +Col
                  </button>
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={handleDeleteTableRow}
                    title={props.locale["documents.richText.toolbar.tableDeleteRow"]}
                  >
                    -Row
                  </button>
                  <button
                    type="button"
                    className="hv-btn"
                    onClick={handleDeleteTableColumn}
                    title={props.locale["documents.richText.toolbar.tableDeleteColumn"]}
                  >
                    -Col
                  </button>
                </div>
              </div>
            </div>
          )}

          {props.mode === "create" && (
            <div className="hv-richtext-template-panel">
              <div className="hv-richtext-template-strip">
                <span className="hv-richtext-template-label">
                  {props.locale["documents.richText.templates"]}
                </span>
                <button
                  type="button"
                  className="hv-btn hv-richtext-template-toggle"
                  onClick={() => setAreTemplatesVisible((prev) => !prev)}
                >
                  {areTemplatesVisible
                    ? props.locale["documents.richText.templatesHide"]
                    : props.locale["documents.richText.templatesShow"]}
                </button>
              </div>
              {areTemplatesVisible && (
                <div className="hv-richtext-template-grid">
                  {authoringTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={`hv-richtext-template-card ${selectedTemplateId === template.id ? "active" : ""}`}
                      onClick={() => applyTemplate(template.id)}
                    >
                      <span className="hv-richtext-template-title">
                        {props.locale[template.labelKey]}
                      </span>
                      <span className="hv-richtext-template-description">
                        {props.locale[template.descriptionKey]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      <div className="hv-page-container hv-docx-page-surface">
        {loading ? (
          <div className="hv-loading-copy">
            {props.locale["documents.richText.processingText"]}
          </div>
        ) : (
          <div className="hv-docx-editor-stage">
            <div
              ref={editorRef}
              className="hv-docx-content"
              contentEditable={isAuthoringMode}
              onInput={syncEditableSurface}
              onBlur={syncEditableSurface}
              onKeyUp={() => {
                captureSelectionRange();
                refreshToolbarState();
              }}
              onMouseUp={() => {
                captureSelectionRange();
                refreshToolbarState();
              }}
              onFocus={() => {
                captureSelectionRange();
                refreshToolbarState();
              }}
              suppressContentEditableWarning
              aria-label={props.locale["a11y.editor"]}
            />
            <SignatureOverlay
              surfaceKey="document:main"
              surfaceKind="document"
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
              signatureColorLabel={props.signatureOverlay.signatureColorLabel}
              signatureColorNames={props.signatureOverlay.signatureColorNames}
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
        )}
      </div>
    </div>
  );
}
