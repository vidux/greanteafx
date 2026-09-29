/**
 * The content type an uploaded sample is stored and served with.
 *
 * The browser-supplied type is untrusted: replaying `text/html` for a file that happens to decode
 * as audio would let one user plant a page that runs on the API's origin for anyone who opens
 * its URL. Only well-formed `audio/*` types are kept; everything else becomes an opaque download.
 */
export function audioContentType(claimed: string | null | undefined): string {
  const type = (claimed ?? '').trim().toLowerCase();
  return /^audio\/[a-z0-9][a-z0-9.+-]*$/.test(type) ? type : 'application/octet-stream';
}
