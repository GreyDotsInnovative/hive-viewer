import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const generatedDir = join(__dirname, "generated");
const generatedPptxBundlePath = join(
  generatedDir,
  "pptxgenBundle.ts",
);
const generatedPdfWorkerBundlePath = join(
  generatedDir,
  "pdfWorkerBundle.ts",
);
const pptxBundleSource = readFileSync(
  join(__dirname, "node_modules", "pptxgenjs", "dist", "pptxgen.min.js"),
  "utf8",
);
const pdfWorkerBundleSource = readFileSync(
  join(__dirname, "node_modules", "pdfjs-dist", "build", "pdf.worker.mjs"),
  "utf8",
);

mkdirSync(generatedDir, { recursive: true });

writeFileSync(
  generatedPptxBundlePath,
  `export const pptxgenBundleSource = ${JSON.stringify(pptxBundleSource)};\n`,
);
writeFileSync(
  generatedPdfWorkerBundlePath,
  `export const pdfWorkerBundleSource = ${JSON.stringify(pdfWorkerBundleSource)};\n`,
);

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  async onSuccess() {
    copyFileSync(
      join(__dirname, "src/styles/hiveviewer.css"),
      join(__dirname, "dist/styles.css"),
    );
  },
  outExtension({ format }) {
    return {
      js: format === "esm" ? ".mjs" : ".cjs",
    };
  },
});
