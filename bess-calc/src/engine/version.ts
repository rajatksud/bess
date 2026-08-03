/**
 * Single source of truth for the calculation engine version.
 *
 * Lives in src/engine (not server/lib) because both the frontend and the server need it:
 * server/lib/version.ts additionally reads package.json via node:fs, which the browser
 * bundle cannot import. Before this module existed, src/components/ExportReportModal.tsx
 * hardcoded "2.4.0-Engineering" in a clipboard string while server/lib/version.ts
 * reported "1.0.0" for the very same engine — two different answers to the same question
 * on the same simulation.
 *
 * Bump this when a change alters calculation OUTPUT for unchanged input. Additive,
 * opt-in changes that leave existing results byte-identical do not require a bump.
 */
export const CALCULATION_ENGINE_VERSION = '1.0.0';
