import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = join(__dirname, "..", "dist");
const require = createRequire(import.meta.url);

const modulePath = pathToFileURL(join(distDir, "index.mjs")).href;
const esmMod = await import(modulePath);
const cjsMod = require(join(distDir, "index.cjs"));

assert.equal(typeof esmMod.DocumentViewer, "function");
assert.equal(typeof cjsMod.DocumentViewer, "function");
assert.equal(typeof esmMod.defaultLocale, "object");
assert.equal(typeof cjsMod.defaultLocale, "object");
assert.equal(esmMod.defaultLocale["toolbar.save"], "Save");
assert.equal(cjsMod.defaultLocale["toolbar.save"], "Save");
assert.equal(existsSync(join(distDir, "styles.css")), true);

process.stdout.write("Package smoke check passed.\n");
