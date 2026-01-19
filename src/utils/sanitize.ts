import DOMPurify from 'dompurify';

/**
 * Sanitize HTML using DOMPurify for safe rendering.
 * @param html - The HTML string to sanitize
 * @returns Safe HTML string
 */
export function sanitizeHtml(html: string): string {
  // DOMPurify is safe to call in the browser. For SSR, callers should only run after mount.
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
}
