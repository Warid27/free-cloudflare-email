/**
 * Lightweight HTML sanitizer for email content.
 * Strips dangerous tags and attributes without external dependencies.
 */

const STRIP_TAGS = /<\/?(script|style|iframe|object|embed|link|base|meta|form|input|button|textarea|select)[^>]*>/gi;
const STRIP_EVENT_HANDLERS = /\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi;
const STRIP_JAVASCRIPT_URIS = /javascript\s*:/gi;
const STRIP_DATA_URIS = /data\s*:[^,]*;base64/gi;

/**
 * Sanitize HTML email content.
 * Removes script/style tags, event handlers, and javascript: URIs.
 * Returns empty string if input is null/undefined.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';

  let cleaned = html;

  // Remove dangerous tags entirely (including their content for script/style)
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Remove self-closing and void dangerous tags
  cleaned = cleaned.replace(STRIP_TAGS, '');

  // Remove on* event handlers from all tags
  cleaned = cleaned.replace(STRIP_EVENT_HANDLERS, '');

  // Remove javascript: URIs
  cleaned = cleaned.replace(STRIP_JAVASCRIPT_URIS, '');

  return cleaned;
}
