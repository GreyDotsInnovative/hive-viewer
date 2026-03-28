# @zerohive/hive-viewer

`@zerohive/hive-viewer` is a browser-first React document viewer with signing, annotations, save, and export workflows.

It is designed for product teams that need to:

- open a document from a URL, `base64`, or `Blob`
- let users review it in-app
- place signatures and annotations on the document surface
- save or export the result
- persist the returned file and metadata in their own backend

## Install

```bash
npm install @zerohive/hive-viewer
```

Import the stylesheet once in your app:

```ts
import "@zerohive/hive-viewer/styles.css";
```

## Next.js Usage

The viewer uses browser APIs, so in Next.js it should be rendered client-side.

```tsx
"use client";

import dynamic from "next/dynamic";
import "@zerohive/hive-viewer/styles.css";

const DocumentViewer = dynamic(
  async () => (await import("@zerohive/hive-viewer")).DocumentViewer,
  { ssr: false },
);

export default function Page() {
  return (
    <DocumentViewer
      mode="view"
      fileUrl="https://example.com/contracts/master-service-agreement.pdf"
      fileName="master-service-agreement.pdf"
      fileType="pdf"
    />
  );
}
```

## What The Package Does

At a high level, the package works like this:

1. You pass a document source into `DocumentViewer`.
2. The viewer picks the right renderer for the file type.
3. Users can navigate, zoom, sign, and annotate.
4. Signature placements and annotations are tracked as structured JSON metadata.
5. When the user saves, the package returns:
   - the saved file as `base64`
   - metadata describing the saved file
   - the signature placements and annotations used in the review

That makes the package useful for both:

- final file generation
- restoring a review session later

## Supported Sources

You can load a document using one of these props:

- `fileUrl`
- `base64`
- `blob`

You should also provide:

- `fileName`
- `fileType`

## Supported File Types

Best-supported document types:

- `pdf`
- `docx`
- `md`
- `txt`
- `xlsx`
- `csv`
- `pptx`
- `png`
- `jpg`
- `jpeg`
- `gif`
- `bmp`
- `svg`

Accepted legacy formats with more limited fidelity:

- `doc`
- `rtf`
- `xls`
- `ppt`

## Viewer Modes

`DocumentViewer` supports three modes:

- `view`
  For document review and signing.
- `edit`
  For editable text and spreadsheet-style workflows where supported.
- `create`
  For building a new document session from the chosen `fileType`.

## Mode Support By Format

The package now applies mode support honestly by file type.

### Full Authoring Support

These formats support `view`, `edit`, and `create`:

- `docx`
- `doc`
- `rtf`
- `txt`
- `md`
- `xlsx`
- `xls`
- `csv`

### Review-Only Formats

These formats are currently best used for `view`, signing, annotations, save, and export:

- `pdf`
- `pptx`
- `ppt`
- `png`
- `jpg`
- `jpeg`
- `gif`
- `bmp`
- `svg`
- `xml`

If a consumer requests `edit` or `create` for a review-only format, the viewer now falls back cleanly:

- unsupported `edit` becomes `view` with a clear notice
- unsupported `create` with a source document becomes `view` with a clear notice
- unsupported `create` without a source shows a capability message instead of a broken blank editor

## Rich Text Authoring

For text-style documents (`docx`, `doc`, `rtf`, `txt`, `md`), `edit` and `create` now provide a fuller authoring surface:

- a style picker for paragraph, headings, and quote blocks
- formatting controls for bold, italic, underline, bullets, numbering, and alignment
- insert actions for links, dividers, and simple tables
- undo/redo and clear-formatting actions
- create-mode starter templates such as blank document, letter, memo, meeting notes, agreement, and proposal

This makes the package much better for lightweight in-app document drafting, review preparation, and internal document generation.

Current rich-text authoring also includes:

- image insertion and upload
- image sizing, crop presets, alignment, zoom, and focal-point editing
- table row and column controls when the cursor is inside a table
- a hideable create-mode template strip
- starter templates for blank, letter, meeting notes, agreement, and proposal

## Finalize-To-PDF Workflow

For products that only need a final signed document for viewing, sharing, or archiving, the package can finalize signed sessions to PDF.

- when `finalizeSignedDocumentsAsPdf` is enabled, signed or annotated save actions default to PDF
- `onSave` returns the finalized PDF as `base64`
- the save metadata still includes signature placements, annotations, and signature summaries

This is the recommended path when your backend stores a final artifact in object storage and returns a file URL for later viewing.

## Letterhead Support

The package supports structured finalized-PDF letterheads through `letterheadTemplate`.

You can pass it as a prop without saving it anywhere, or generate it from user/company settings in your host app.

- header logo, brand name, subtitle, badge, colors, and divider styling
- footer title, lines, alignment, and divider styling
- same-origin image URLs and SVG logos are supported best

This is separate from `headerComponent` and `footerComponent`: the React components can be used for viewer-side preview, while `letterheadTemplate` drives the finalized PDF letterhead layout.

## Host-Provided Signatures

If your product already stores user signatures, use `onSignRequest`.

Typical flow:

1. User clicks `Sign Document`.
2. Your app opens a PIN or approval dialog.
3. Your backend verifies the PIN and returns the signature image plus signer details.
4. `onSignRequest` returns that signature object to the package.
5. The package places it on the document and includes it in save metadata.

The package supports:

- URL or base64 signature images
- optional `signedBy`
- optional `jobTitle`
- date normalization to `dd-mm-yyyy`
- per-placement signature colors: `black`, `blue`, `red`, `green`

## Basic Example

```tsx
"use client";

import { useState } from "react";
import {
  DocumentViewer,
  type AnnotationPlacement,
  type DocumentViewerSaveMeta,
  type Signature,
  type SignaturePlacement,
} from "@zerohive/hive-viewer";
import "@zerohive/hive-viewer/styles.css";

export default function ContractReview() {
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [signaturePlacements, setSignaturePlacements] = useState<
    SignaturePlacement[]
  >([]);
  const [annotations, setAnnotations] = useState<AnnotationPlacement[]>([]);

  return (
    <DocumentViewer
      mode="view"
      fileUrl="https://example.com/contracts/msa.pdf"
      fileName="msa.pdf"
      fileType="pdf"
      allowSigning
      allowAnnotations
      signatures={signatures}
      signaturePlacements={signaturePlacements}
      annotations={annotations}
      onSignRequest={async () => {
        const signature = {
          id: crypto.randomUUID(),
          signatureImageUrl: "data:image/png;base64,...",
          signedBy: "Jane Doe",
          dateSigned: new Date().toISOString(),
        };

        setSignatures((prev) => [...prev, signature]);
        return signature;
      }}
      onSignaturePlacementsChange={setSignaturePlacements}
      onAnnotationsChange={setAnnotations}
      onSave={async (editedFileAsBase64, meta) => {
        await saveToBackend(editedFileAsBase64, meta);
      }}
    />
  );
}

async function saveToBackend(
  editedFileAsBase64: string,
  meta: DocumentViewerSaveMeta,
) {
  await fetch("/api/documents/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileBase64: editedFileAsBase64,
      fileName: meta.fileName,
      fileType: meta.fileType,
      exportedAsPdf: meta.exportedAsPdf ?? false,
      signaturePlacements: meta.signaturePlacements ?? [],
      annotations: meta.annotations ?? [],
    }),
  });
}
```

## Signing And Annotation Model

The package treats placed signatures and annotations as first-class review data.

### Signatures

A `Signature` is the reusable signature asset itself:

- `id?`
- `signatureImageUrl`
- `signedBy?`
- `jobTitle?`
- `dateSigned`

Notes:

- package-managed visible dates are normalized to `dd-mm-yyyy`
- the signature asset stays reusable, while color is applied at placement level

A placed signature is represented as a `SignaturePlacement`:

- `id`
- `signatureId?`
- `signature`
- `signatureColor?`
- `surfaceKind`
- `surfaceKey`
- `page?`
- `slide?`
- `sheetName?`
- `x`
- `y`
- `width`
- `height`

### Annotations

Annotations are separate from signatures and can exist:

- on their own
- linked to a placed signature

An `AnnotationPlacement` includes:

- `id`
- `surfaceKind`
- `surfaceKey`
- `page?`
- `slide?`
- `sheetName?`
- `x`
- `y`
- `width`
- `height`
- `text`
- `linkedSignaturePlacementId?`
- `linkedSignatureId?`

All placement geometry is stored in normalized coordinates, so overlays can be restored across zoom and layout changes.

## What Gets Returned On Save

The main save contract is:

```ts
onSave?: (editedFileAsBase64: string, meta: DocumentViewerSaveMeta) => void;
```

`editedFileAsBase64`

- the saved/exported file contents
- ready to send to your backend or upload to object storage

`meta`

- `fileName`
- `fileType`
- `exportedAsPdf?`
- `signaturePlacements?`
- `annotations?`
- `signatures?`
- `signatureList?`

The important part for consumers is that the package returns both:

- the file
- the structured overlay metadata

That means the consumer can store:

- the uploaded file URL returned by their backend or bucket
- the placements and annotations JSON for reopening later

## Recommended Backend Wiring

Most products wire the package like this:

1. User reviews document in `DocumentViewer`.
2. User clicks `Save` or `Export as PDF`.
3. The package calls `onSave(base64, meta)`.
4. Your app sends that `base64` to the backend.
5. Your backend uploads the file to storage.
6. Your backend returns a stored file URL.
7. Your app saves that URL together with `signaturePlacements` and `annotations`.

### Example Payload Sent To Backend

```json
{
  "fileBase64": "<base64 returned by onSave>",
  "fileName": "contract.docx",
  "fileType": "docx",
  "exportedAsPdf": false,
  "signaturePlacements": [],
  "annotations": []
}
```

### Example Record Stored In Your Database

```json
{
  "documentId": "doc_123",
  "fileUrl": "https://bucket.example.com/contracts/doc_123.docx",
  "fileName": "contract.docx",
  "fileType": "docx",
  "exportedAsPdf": false,
  "signaturePlacements": [],
  "annotations": []
}
```

## Reopening A Saved Document

When you want to show the document again in your app, pass the saved file plus the saved overlay metadata back into the viewer:

```tsx
<DocumentViewer
  mode="view"
  fileUrl={record.fileUrl}
  fileName={record.fileName}
  fileType={record.fileType}
  signaturePlacements={record.signaturePlacements}
  annotations={record.annotations}
/>
```

This is the key integration idea:

- the file gives the viewer the document source
- `signaturePlacements` and `annotations` restore the review layer

## Live Review State Callbacks

If you want autosave before the user clicks Save, you can listen to:

- `onSignaturePlacementsChange`
- `onAnnotationsChange`

These callbacks are useful for draft persistence, collaborative review state, or saving progress during long sessions.

## Save Behavior By Format

The package can return different output formats depending on the source file type and the user action.

### Save

- `pdf` saves as `pdf`
- `pptx` and `ppt` save as native `pptx`
- `xlsx`, `xls`, and `csv` save as native `xlsx`
- `docx`, `doc`, `rtf`, `txt`, and `md` save as a visual `docx`
- JPEG sources save as `jpg`
- other image sources save as `png`

### Export as PDF

- returns a PDF output
- `meta.exportedAsPdf` is `true`
- `meta.fileType` will be `pdf`

Consumers should rely on the returned `meta.fileType`, not the original input file type.

## Important Persistence Note

There are two different ways consumers may reopen a document:

### 1. Reopen for continued review

Use:

- the saved source document URL or `base64`
- `signaturePlacements`
- `annotations`

This is the normal review-session restore pattern.

### 2. Reopen the final baked file

Use:

- the final file returned by `onSave`

If your saved file already visually includes signatures and annotations, and you also pass the same `signaturePlacements` and `annotations` back into the viewer, the user may see them twice.

For that reason, many apps keep:

- a source/review version
- a final exported artifact

## Core Props

Commonly used props:

- `mode`
- `fileUrl`
- `base64`
- `blob`
- `fileName`
- `fileType`
- `allowSigning`
- `disableSigning`
- `allowAnnotations`
- `disableAnnotations`
- `defaultLayout`
- `defaultShowThumbnails`
- `signatures`
- `signaturePlacements`
- `annotations`
- `onSignRequest`
- `onSignaturePlacementsChange`
- `onAnnotationsChange`
- `onSave`
- `finalizeSignedDocumentsAsPdf`
- `letterheadTemplate`
- `theme`
- `locale`

The full exported types are available from the package:

```ts
import type {
  AnnotationPlacement,
  DocumentViewerProps,
  DocumentViewerSaveMeta,
  Signature,
  SignatureInkColor,
  SignaturePlacement,
} from "@zerohive/hive-viewer";
```

## Locale

You can override UI text through the `locale` prop.

Example:

```tsx
<DocumentViewer
  locale={{
    "toolbar.sign": "Sign Document",
    "toolbar.annotate": "Add Note",
    "toolbar.save": "Save",
    "toolbar.exportPdf": "Export as PDF",
  }}
/>
```

## Theme

The built-in theme prop supports:

- `light`
- `dark`

```tsx
<DocumentViewer theme="dark" />
```

## Browser And Hosting Notes

- `fileUrl` sources must be reachable by the browser.
- If the source is stored in a bucket, CORS must allow your frontend to fetch it.
- For private documents, many apps use signed URLs from their backend.

## Current Rendering Notes

- PDF uses a page-based renderer.
- DOCX uses a browser-side page renderer in view mode and is best-effort, not a full Microsoft Word engine.
- Slides and spreadsheets are rendered with package-managed viewers and export pipelines.
- Rich-text save/export is visual rather than semantic word-processing output.
- Legacy office formats such as `doc`, `xls`, and `ppt` are accepted, but `docx`, `xlsx`, and `pptx` are recommended for better fidelity.

## Exports

The package exports:

```ts
import { DocumentViewer } from "@zerohive/hive-viewer";
```

And these core types:

```ts
import type {
  AnnotationPlacement,
  AnnotationPlacementDraft,
  AnnotationPatch,
  DocumentMode,
  DocumentViewerProps,
  DocumentViewerSaveMeta,
  PageLayout,
  PlacementGeometryPatch,
  Signature,
  SignaturePlacement,
  SignaturePlacementDraft,
  SignatureSurfaceKind,
  SupportedFileType,
} from "@zerohive/hive-viewer";
```

## Summary

The package gives consumers everything they need to wire document review into their own backend:

- document rendering
- signature placement
- annotations
- save/export as `base64`
- structured placement metadata for persistence

The usual storage model is:

- upload returned `base64`
- store the resulting file URL
- store `signaturePlacements`
- store `annotations`

Then pass that data back into `DocumentViewer` whenever the document needs to be opened again.
