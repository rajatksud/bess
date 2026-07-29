import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocumentType, FetchRecord, Manifest, SourceDocumentManifestEntry } from "./types.js";

const MANIFEST_SCHEMA_VERSION = "1.0.0";

/**
 * Content-addressable immutable archive (crawler architecture section 7.2).
 * Documents are stored by sha256 so the same binary published under multiple
 * URLs/filenames is recognized as one observation, not a new document.
 */
export class DocumentArchive {
  constructor(
    private readonly archiveDir: string,
    private readonly manifestPath: string,
  ) {}

  private loadManifest(): Manifest {
    if (!existsSync(this.manifestPath)) {
      return { schema_version: MANIFEST_SCHEMA_VERSION, generated_at: new Date().toISOString(), documents: [] };
    }
    return JSON.parse(readFileSync(this.manifestPath, "utf8")) as Manifest;
  }

  private saveManifest(manifest: Manifest): void {
    manifest.generated_at = new Date().toISOString();
    mkdirSync(dirname(this.manifestPath), { recursive: true });
    writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  }

  private storagePathFor(sha256: string): string {
    // Shard by first two hex chars to avoid huge flat directories.
    return join(this.archiveDir, sha256.slice(0, 2), sha256);
  }

  /**
   * Stores a fetched document if its hash is new, or records a new observed
   * URL against an existing document if the same content was seen before
   * (possibly under a different URL/filename). Returns the manifest entry and
   * whether this was a newly discovered binary.
   */
  put(body: Buffer, record: FetchRecord, documentType: DocumentType): { entry: SourceDocumentManifestEntry; isNewDocument: boolean } {
    const manifest = this.loadManifest();
    const existing = manifest.documents.find((d) => d.sha256 === record.sha256);

    if (existing) {
      if (!existing.observed_urls.includes(record.finalUrl)) {
        existing.observed_urls.push(record.finalUrl);
        this.saveManifest(manifest);
      }
      return { entry: existing, isNewDocument: false };
    }

    const storagePath = this.storagePathFor(record.sha256);
    mkdirSync(dirname(storagePath), { recursive: true });
    if (!existsSync(storagePath)) {
      writeFileSync(storagePath, body);
    }

    const entry: SourceDocumentManifestEntry = {
      document_id: `${record.sourceId}-${record.sha256.slice(0, 12)}`,
      source_id: record.sourceId,
      url: record.finalUrl,
      retrieved_at: record.retrievedAt,
      http_status: record.httpStatus,
      content_type: record.contentType,
      size_bytes: record.contentLength,
      sha256: record.sha256,
      storage_uri: storagePath,
      document_type: documentType,
      first_seen_at: record.retrievedAt,
      observed_urls: [record.finalUrl],
    };

    manifest.documents.push(entry);
    this.saveManifest(manifest);
    return { entry, isNewDocument: true };
  }

  /**
   * Detects the "unchanged URL, new hash" replacement case from crawler
   * architecture section 7.3, which must be treated as a high-priority event.
   */
  findReplacement(finalUrl: string, newSha256: string): SourceDocumentManifestEntry | null {
    const manifest = this.loadManifest();
    const priorAtSameUrl = manifest.documents.find(
      (d) => d.observed_urls.includes(finalUrl) && d.sha256 !== newSha256,
    );
    return priorAtSameUrl ?? null;
  }

  listDocuments(): SourceDocumentManifestEntry[] {
    return this.loadManifest().documents;
  }
}
