import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { generateRegressionFixtures } from "./regression-fixtures.mjs";

function assertNonEmptyFile(path, info) {
  assert.ok(info.isFile(), `${path} should be a file`);
  assert.ok(info.size > 32, `${path} should not be empty`);
}

const { root, files } = await generateRegressionFixtures();

try {
  for (const [name, filePath] of Object.entries(files)) {
    const info = await stat(filePath);
    assertNonEmptyFile(filePath, info);
    assert.ok(
      filePath.endsWith(`.${name}`),
      `${filePath} should keep the expected extension`,
    );
  }

  const pdfDoc = await PDFDocument.load(await readFile(files.pdf));
  assert.equal(pdfDoc.getPageCount(), 3);

  const docxZip = await JSZip.loadAsync(await readFile(files.docx));
  const documentXml = await docxZip.file("word/document.xml")?.async("string");
  const headerXml = await docxZip.file("word/header1.xml")?.async("string");
  const footerXml = await docxZip.file("word/footer1.xml")?.async("string");
  assert.ok(documentXml, "DOCX should contain word/document.xml");
  assert.ok(headerXml, "DOCX should contain a header part");
  assert.ok(footerXml, "DOCX should contain a footer part");
  assert.match(documentXml, /Hive Viewer Regression DOCX/);
  assert.match(documentXml, /Second page review content/);
  assert.match(documentXml, /w:tbl/);
  assert.match(headerXml, /Hive Viewer Header/);
  assert.match(footerXml, /Hive Viewer Footer/);

  const xlsxBuffer = await readFile(files.xlsx);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxBuffer);
  const xlsxZip = await JSZip.loadAsync(xlsxBuffer);
  const summary = workbook.getWorksheet("Summary");
  const notes = workbook.getWorksheet("Notes");
  assert.ok(summary, "XLSX should contain Summary sheet");
  assert.ok(notes, "XLSX should contain Notes sheet");
  assert.equal(summary.getCell("A1").value, "Scope");
  assert.equal(summary.getCell("B4").value.formula, "SUM(B2:B3)");
  assert.equal(summary.getColumn(3).hidden, true);
  assert.equal(summary.getRow(6).hidden, true);
  assert.equal(summary.getCell("D3").value, true);
  assert.ok(summary.getCell("E2").value instanceof Date);
  assert.ok(xlsxZip.file("xl/comments1.xml"), "XLSX should preserve cell comments");
  assert.equal(notes.getCell("A1").value, "Signature placement should not drop workbook state.");
  assert.equal(notes.getCell("A2").value.hyperlink, "https://openai.com");
  assert.equal(notes.getCell("B2").value, false);

  const pptxZip = await JSZip.loadAsync(await readFile(files.pptx));
  const slideOneXml = await pptxZip.file("ppt/slides/slide1.xml")?.async("string");
  const slideTwoXml = await pptxZip.file("ppt/slides/slide2.xml")?.async("string");
  const slideOneRels = await pptxZip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string");
  const mediaFiles = Object.keys(pptxZip.files).filter((path) =>
    path.startsWith("ppt/media/"),
  );
  assert.ok(slideOneXml, "PPTX should contain slide1.xml");
  assert.ok(slideTwoXml, "PPTX should contain slide2.xml");
  assert.ok(slideOneRels, "PPTX should contain slide relationships");
  assert.ok(mediaFiles.length > 0, "PPTX should contain embedded media");
  assert.match(slideOneXml, /Hive Viewer Regression/);
  assert.match(slideTwoXml, /Signature placement follow-up/);
  assert.match(slideOneRels, /image/);

  const markdown = await readFile(files.md, "utf8");
  assert.match(markdown, /Signature placement/);
  const text = await readFile(files.txt, "utf8");
  assert.match(text, /<script>escaped-render-check<\/script>/);
  const csv = await readFile(files.csv, "utf8");
  assert.match(csv, /materials,18/);
  const svg = await readFile(files.svg, "utf8");
  assert.match(svg, /<svg/);

  process.stdout.write("Package regression fixtures passed.\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
