import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import {
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const require = createRequire(import.meta.url);
const PptxGenJS = require("../node_modules/pptxgenjs/dist/pptxgen.cjs.js");
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZJfQAAAAASUVORK5CYII=";

async function createPdfFixture(outputPath) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const pageOne = pdf.addPage([612, 792]);
  pageOne.drawText("Hive Viewer Regression PDF", {
    x: 72,
    y: 700,
    size: 24,
    font,
    color: rgb(0.11, 0.22, 0.53),
  });
  pageOne.drawText("Page 1: baseline contract review content.", {
    x: 72,
    y: 660,
    size: 14,
    font,
  });

  const pageTwo = pdf.addPage([612, 792]);
  pageTwo.drawText("Page 2: signature and annotation follow-up.", {
    x: 72,
    y: 700,
    size: 18,
    font,
  });

  const pageThree = pdf.addPage([792, 612]);
  pageThree.drawText("Page 3: landscape appendix for mixed-layout testing.", {
    x: 72,
    y: 520,
    size: 18,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  await writeFile(outputPath, await pdf.save());
}

async function createDocxFixture(outputPath) {
  const document = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph("Hive Viewer Header")],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph("Hive Viewer Footer")],
          }),
        },
        children: [
          new Paragraph({
            text: "Hive Viewer Regression DOCX",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [
              new TextRun("This fixture covers "),
              new TextRun({ text: "multi-page", bold: true }),
              new TextRun(" rich text viewing and save behavior."),
            ],
          }),
          new Paragraph({
            text: "Review notes should remain stable across reopen flows.",
            bullet: { level: 0 },
          }),
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph("Item")],
                  }),
                  new TableCell({
                    children: [new Paragraph("State")],
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph("Signature")],
                  }),
                  new TableCell({
                    children: [new Paragraph("Pending")],
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({
            children: [new PageBreak()],
          }),
          new Paragraph({
            text: "Second page review content for pagination checks.",
          }),
        ],
      },
    ],
  });

  await writeFile(outputPath, await Packer.toBuffer(document));
}

async function createXlsxFixture(outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hive Viewer";
  const summary = workbook.addWorksheet("Summary");
  summary.getCell("A1").value = "Scope";
  summary.getCell("B1").value = "Amount";
  summary.getCell("A2").value = "Labour";
  summary.getCell("B2").value = 24;
  summary.getCell("A3").value = "Materials";
  summary.getCell("B3").value = 18;
  summary.getCell("A4").value = "Total";
  summary.getCell("B4").value = { formula: "SUM(B2:B3)", result: 42 };
  summary.getCell("A1").font = { bold: true, color: { argb: "FF1E3A8A" } };
  summary.getCell("B1").font = { bold: true };
  summary.getCell("A1:B1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0ECFF" },
  };
  summary.mergeCells("D2:E2");
  summary.getCell("D2").value = "Merged note";
  summary.columns = [
    { width: 18 },
    { width: 12 },
    { width: 4 },
    { width: 20 },
    { width: 20 },
  ];
  summary.getColumn(3).hidden = true;
  summary.getRow(6).hidden = true;
  summary.getCell("D3").value = true;
  summary.getCell("E2").value = new Date("2026-03-24T00:00:00.000Z");
  summary.getCell("E3").note = "Procurement note";
  summary.getCell("A6").value = "Hidden row payload";

  const notes = workbook.addWorksheet("Notes");
  notes.getCell("A1").value = "Signature placement should not drop workbook state.";
  notes.getCell("A2").value = {
    text: "OpenAI",
    hyperlink: "https://openai.com",
  };
  notes.getCell("B2").value = false;
  notes.getCell("A3").value = "Review owner";
  notes.getCell("B3").value = "Legal";

  await workbook.xlsx.writeFile(outputPath);
}

async function createPptxFixture(outputPath) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Hive Viewer";
  pptx.subject = "Regression fixtures";
  pptx.title = "Hive Viewer Regression PPTX";

  const slideOne = pptx.addSlide();
  slideOne.background = { color: "F8FAFC" };
  slideOne.addText("Hive Viewer Regression", {
    x: 0.6,
    y: 0.7,
    w: 8.2,
    h: 0.6,
    fontSize: 24,
    bold: true,
    color: "1E3A8A",
  });
  slideOne.addText("Slide 1 verifies standard text rendering.", {
    x: 0.6,
    y: 1.6,
    w: 8.2,
    h: 0.5,
    fontSize: 16,
    color: "0F172A",
  });
  slideOne.addImage({
    data: TINY_PNG_DATA_URL,
    x: 8.6,
    y: 0.7,
    w: 0.7,
    h: 0.7,
  });

  const slideTwo = pptx.addSlide();
  slideTwo.background = { color: "FFFFFF" };
  slideTwo.addText("Signature placement follow-up", {
    x: 0.8,
    y: 0.9,
    w: 7.5,
    h: 0.6,
    fontSize: 22,
    bold: true,
    color: "0F172A",
  });
  slideTwo.addText("Annotations should remain anchored on reopen.", {
    x: 0.8,
    y: 1.8,
    w: 7.8,
    h: 0.5,
    fontSize: 16,
    color: "334155",
  });
  slideTwo.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 2.7,
    w: 3.2,
    h: 1.0,
    fill: { color: "DBEAFE" },
    line: { color: "93C5FD" },
  });
  slideTwo.addText("Linked notes should survive reopen and export.", {
    x: 0.8,
    y: 4.0,
    w: 6.8,
    h: 0.5,
    fontSize: 14,
    color: "475569",
  });

  await pptx.writeFile({ fileName: outputPath });
}

export async function generateRegressionFixtures() {
  const root = await mkdtemp(join(tmpdir(), "hive-viewer-regression-"));
  await mkdir(root, { recursive: true });

  const files = {
    pdf: join(root, "regression-sample.pdf"),
    docx: join(root, "regression-sample.docx"),
    xlsx: join(root, "regression-sample.xlsx"),
    pptx: join(root, "regression-sample.pptx"),
    md: join(root, "regression-sample.md"),
    txt: join(root, "regression-sample.txt"),
    csv: join(root, "regression-sample.csv"),
    svg: join(root, "regression-sample.svg"),
  };

  await createPdfFixture(files.pdf);
  await createDocxFixture(files.docx);
  await createXlsxFixture(files.xlsx);
  await createPptxFixture(files.pptx);
  await writeFile(
    files.md,
    "# Hive Viewer Regression\n\n- Signature placement\n- Annotation overlays\n",
    "utf8",
  );
  await writeFile(
    files.txt,
    "Plain text regression sample.\n<script>escaped-render-check</script>\n",
    "utf8",
  );
  await writeFile(
    files.csv,
    "item,amount\nlabour,24\nmaterials,18\n",
    "utf8",
  );
  await writeFile(
    files.svg,
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120">',
      '<rect width="240" height="120" fill="#eef2ff" />',
      '<text x="20" y="64" font-size="24" fill="#1e3a8a">Hive Viewer</text>',
      "</svg>",
    ].join(""),
    "utf8",
  );

  return { root, files };
}
