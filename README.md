# ModalViewer Usage Example

You can use the ModalViewer component to display any content (such as DocumentViewer) in a modal dialog. Here is a simple example:

```tsx
import React, { useState } from 'react';
import { ModalViewer } from './src/components/ModalViewer';
import { DocumentViewer } from './src/components/DocumentViewer';
import './src/components/ModalViewer.css';

export default function App() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open Document Modal</button>
      <ModalViewer open={open} onClose={() => setOpen(false)}>
        <DocumentViewer url="/path/to/document.pdf" />
      </ModalViewer>
    </>
  );
}
```

**Props:**

- `open` (boolean): Whether the modal is visible.
- `onClose` (function): Called when the modal requests to close (overlay click, ESC, close button).
- `children` (ReactNode): Content to display inside the modal.
- `ariaLabel` (optional string): Accessibility label for the modal dialog.

**Styling:**

Import `ModalViewer.css` for default modal styles, or customize as needed.
# @zerohive/hive-viewer

A self-hostable, browser-first document viewer/editor for React and Next.js.

## Install

```bash
npm i @zerohive/hive-viewer
```

Import styles once in your app:

```ts
import "@zerohive/hive-viewer/styles.css";
```

## Usage

### Basic Usage

```tsx
import { DocumentViewer } from "@zerohive/hive-viewer";

export default function Page() {
  return (
    <DocumentViewer
      mode="edit"
      fileUrl="https://example.com/my.pdf"
      fileName="my.pdf"
      fileType="pdf"
      allowSigning
      onSignRequest={async () => ({
        signatureImageUrl: "https://.../sig.png",
        signedBy: "Jane Doe",
        dateSigned: new Date().toISOString(),
        comment: "Approved",
      })}
      onSave={(b64, meta) => {
        /* persist */
      }}
    />
  );
}
```

### Using in a Modal (Recommended)

Most consumers use the viewer in a modal dialog. Here is a recommended pattern:

```tsx
import React, { useState } from "react";
import { DocumentViewer } from "@zerohive/hive-viewer";

function ModalDocViewer({ open, onClose, fileUrl, fileName, fileType }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          maxWidth: "90vw",
          maxHeight: "90vh",
          overflow: "auto",
          position: "relative",
          padding: 0,
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 12,
            right: 16,
            background: "none",
            border: "none",
            fontSize: "2rem",
            color: "#888",
            cursor: "pointer",
            zIndex: 1,
          }}
        >
          ×
        </button>
        <DocumentViewer
          mode="view"
          fileUrl={fileUrl}
          fileName={fileName}
          fileType={fileType}
        />
      </div>
    </div>
  );
}

// Usage example:
export default function Example() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open Document</button>
      <ModalDocViewer
        open={open}
        onClose={() => setOpen(false)}
        fileUrl="https://example.com/my.pdf"
        fileName="my.pdf"
        fileType="pdf"
      />
    </>
  );
}
```

## Signing Workflow (decoupled)

- If `allowSigning={true}`, the toolbar shows **Sign Document**.
- Clicking it calls `onSignRequest()` (parent handles biometric/e-signature/KYC/etc.).
- The returned `Signature` is immediately displayed:
  - `view/edit`: signatures appear in the right signature panel and can be **placed** onto the page by clicking **Place signature**.
  - `create`: signatures are appended to the end of the document (no right panel).

## Progressive loading and caching

- `fileUrl` loading uses streaming where available (`fetch` + `ReadableStream`).
- For PDFs, `pdfjs` is configured with `rangeChunkSize` so rendering can start before the full file downloads.
- In `fileUrl` mode, the package caches the ArrayBuffer in-memory during the session to avoid re-fetching when switching layouts/modes.

## Security

- Markdown/HTML content is sanitized via DOMPurify before rendering.

## Props

See `src/types.ts` for full types.
