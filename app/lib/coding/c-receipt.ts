import { canonicalCProject } from './c-project';
import type { CProject } from './c-project';

/** Verify actual backend evidence against exact current source and stdin, not a rendered label. */
export async function receiptMatchesProject(project: CProject, receipt: unknown): Promise<boolean> {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return false;
  }

  const hash = (receipt as { sourceHash?: unknown }).sourceHash;

  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
    return false;
  }

  const bytes = new TextEncoder().encode(canonicalCProject(project));
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') === hash;
}
