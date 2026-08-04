import { isPdfMagicBytes } from "../fetcher.js";

/**
 * Re-exports fetcher.ts's isPdfMagicBytes for the extraction pipeline's own
 * pre-flight check. A document already validated at fetch time (Phase 2's
 * fetcher hardening) should never fail this, but the extraction pipeline
 * may run against documents archived before that hardening existed, or be
 * invoked directly against an arbitrary storage_uri -- this is defense in
 * depth, not redundant.
 */
export { isPdfMagicBytes };
