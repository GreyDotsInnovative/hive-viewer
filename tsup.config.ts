import { defineConfig } from "tsup";
import { copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      join(__dirname, "dist/styles.css")
    );
  },
  outExtension({ format }) {
    return {
      js: format === "esm" ? ".mjs" : ".js",
    };
  },
});
