# Changelog

## 2.0.0 - 2026-03-28

Published to npm as `@zerohive/hive-viewer@2.0.0`.

### Highlights

- Added finalized PDF workflows for signed and annotated documents, including returned save metadata for placements, annotations, signatures, and signature summaries.
- Added structured letterhead support for finalized PDFs through `letterheadTemplate`, including logo, branding, subtitle, badge, and footer content.
- Expanded signing with placement-level ink colors (`black`, `blue`, `red`, `green`), `dd-mm-yyyy` signature dates, optional `jobTitle`, and better host-provided signature flows through `onSignRequest`.
- Improved live and exported signature presentation with larger default placement, stacked signer metadata, and cleaner final-PDF rendering.
- Upgraded annotations to work independently of signatures while keeping shared overlay behavior across supported document surfaces.
- Improved rich-text authoring with a Word-style ribbon layout, template strip, image insertion and editing, stronger templates, and better table controls.
- Improved spreadsheet and slide rendering/export behavior and strengthened package save/export handling across supported file types.
- Refreshed package documentation to explain sources, modes, save behavior, backend wiring, final-PDF workflows, host-provided signatures, and letterhead usage.

### Notes

- This release was published from the current working tree. Create the Git commit for these package changes before applying a `v2.0.0` Git tag so the tag matches what shipped to npm.
