import { existsSync, mkdirSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CrawlerDatabase } from "./db/client.js";
import type { DocumentType, FetchRecord, SourceDocumentManifestEntry } from "./types.js";

/**
 * Content-addressable immutable archive (crawler architecture section 7.2).
 * PostgreSQL (source_documents/document_url_aliases) is the authoritative
 * manifest -- documents are stored by sha256 on disk, but "does this
 * document already exist" and "what URLs has it been observed under" are
 * always answered from the database, not a local JSON file, so this class
 * is safe to run concurrently across multiple crawler processes/containers.
 */
export class DocumentArchive {
  constructor(
    private readonly archiveDir: string,
    private readonly db: CrawlerDatabase,
  ) {}

  private storagePathFor(sha256: string): string {
    // Shard by first two hex chars to avoid huge flat directories.
    return join(this.archiveDir, sha256.slice(0, 2), sha256);
  }

  /**
   * Writes body to its content-addressed path via a temp-file-then-rename,
   * which is atomic on the same filesystem (POSIX and NTFS) -- no reader can
   * ever observe a partially-written blob. No-ops if the target already
   * exists: same sha256 means same bytes by construction, so re-writing
   * would be redundant, not incorrect, but skipping avoids unnecessary I/O
   * for the common re-crawl-unchanged-content case.
   */
  private writeBlobAtomic(sha256: string, body: Buffer): string {
    const finalPath = this.storagePathFor(sha256);
    if (existsSync(finalPath)) {
      return finalPath;
    }
    const dir = dirname(finalPath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(dir, `.tmp-${randomUUID()}`);
    writeFileSync(tmpPath, body);
    try {
      renameSync(tmpPath, finalPath);
    } catch (err) {
      // Another concurrent writer may have already renamed an identical tmp
      // file into place between our existsSync check and this rename; if the
      // final path now exists, that's success (same content, same hash), not
      // a failure -- clean up our own now-redundant tmp file and return.
      if (existsSync(finalPath)) {
        rmSync(tmpPath, { force: true });
        return finalPath;
      }
      throw err;
    }
    return finalPath;
  }

  /**
   * Stores a fetched document if its hash is new, or records a new observed
   * URL against an existing document if the same content was seen before
   * (possibly under a different URL/filename). Returns the manifest entry
   * (read back from Postgres) and whether this was a newly discovered
   * binary. Original bytes are written to disk before either database write
   * so a crash between the two never leaves a database row pointing at a
   * missing file.
   */
  async put(
    body: Buffer,
    record: FetchRecord,
    documentType: DocumentType,
  ): Promise<{ entry: SourceDocumentManifestEntry; isNewDocument: boolean }> {
    const storagePath = this.writeBlobAtomic(record.sha256, body);
    const documentId = `${record.sourceId}-${record.sha256.slice(0, 12)}`;

    return this.db.withTransaction(async (client) => {
      const { rows: existingRows } = await client.query<{ document_id: string }>(
        `SELECT document_id FROM source_documents WHERE sha256 = $1`,
        [record.sha256],
      );
      const isNewDocument = existingRows.length === 0;

      await client.query(
        `INSERT INTO source_documents (
           document_id, source_id, sha256, storage_uri, content_type, size_bytes,
           document_type, first_seen_at, last_observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT (sha256) DO UPDATE SET last_observed_at = EXCLUDED.last_observed_at`,
        [
          documentId,
          record.sourceId,
          record.sha256,
          storagePath,
          record.contentType,
          record.contentLength,
          documentType,
          record.retrievedAt,
        ],
      );

      const resolvedDocumentId = isNewDocument ? documentId : existingRows[0].document_id;

      await client.query(
        `INSERT INTO document_url_aliases (document_id, url) VALUES ($1, $2)
         ON CONFLICT (document_id, url) DO NOTHING`,
        [resolvedDocumentId, record.finalUrl],
      );

      const { rows: aliasRows } = await client.query<{ url: string }>(
        `SELECT url FROM document_url_aliases WHERE document_id = $1 ORDER BY first_observed_at`,
        [resolvedDocumentId],
      );
      const { rows: docRows } = await client.query(
        `SELECT * FROM source_documents WHERE document_id = $1`,
        [resolvedDocumentId],
      );
      const doc = docRows[0];

      const entry: SourceDocumentManifestEntry = {
        document_id: doc.document_id,
        source_id: doc.source_id,
        url: record.finalUrl,
        retrieved_at: record.retrievedAt,
        http_status: record.httpStatus,
        content_type: doc.content_type,
        size_bytes: doc.size_bytes === null ? null : Number(doc.size_bytes),
        sha256: doc.sha256,
        storage_uri: doc.storage_uri,
        document_type: doc.document_type,
        first_seen_at: doc.first_seen_at.toISOString(),
        observed_urls: aliasRows.map((r) => r.url),
      };

      return { entry, isNewDocument };
    });
  }

  /**
   * Detects the "unchanged URL, new hash" replacement case from crawler
   * architecture section 7.3, which must be treated as a high-priority
   * event. Looks up the most recently observed document previously seen at
   * this exact URL whose hash differs from the one just fetched.
   */
  async findReplacement(finalUrl: string, newSha256: string): Promise<SourceDocumentManifestEntry | null> {
    const { rows } = await this.db.withClient((client) =>
      client.query(
        `SELECT sd.* FROM source_documents sd
         JOIN document_url_aliases dua ON dua.document_id = sd.document_id
         WHERE dua.url = $1 AND sd.sha256 <> $2
         ORDER BY sd.last_observed_at DESC
         LIMIT 1`,
        [finalUrl, newSha256],
      ),
    );
    if (rows.length === 0) return null;

    const doc = rows[0];
    const { rows: aliasRows } = await this.db.withClient((client) =>
      client.query<{ url: string }>(`SELECT url FROM document_url_aliases WHERE document_id = $1 ORDER BY first_observed_at`, [
        doc.document_id,
      ]),
    );

    return {
      document_id: doc.document_id,
      source_id: doc.source_id,
      url: finalUrl,
      retrieved_at: doc.first_seen_at.toISOString(),
      http_status: 200,
      content_type: doc.content_type,
      size_bytes: doc.size_bytes === null ? null : Number(doc.size_bytes),
      sha256: doc.sha256,
      storage_uri: doc.storage_uri,
      document_type: doc.document_type,
      first_seen_at: doc.first_seen_at.toISOString(),
      observed_urls: aliasRows.map((r) => r.url),
    };
  }

  async listDocuments(): Promise<SourceDocumentManifestEntry[]> {
    const { rows: docs } = await this.db.withClient((client) => client.query(`SELECT * FROM source_documents ORDER BY first_seen_at`));
    const results: SourceDocumentManifestEntry[] = [];
    for (const doc of docs) {
      const { rows: aliasRows } = await this.db.withClient((client) =>
        client.query<{ url: string }>(`SELECT url FROM document_url_aliases WHERE document_id = $1 ORDER BY first_observed_at`, [
          doc.document_id,
        ]),
      );
      results.push({
        document_id: doc.document_id,
        source_id: doc.source_id,
        url: aliasRows[0]?.url ?? "",
        retrieved_at: doc.first_seen_at.toISOString(),
        http_status: 200,
        content_type: doc.content_type,
        size_bytes: doc.size_bytes === null ? null : Number(doc.size_bytes),
        sha256: doc.sha256,
        storage_uri: doc.storage_uri,
        document_type: doc.document_type,
        first_seen_at: doc.first_seen_at.toISOString(),
        observed_urls: aliasRows.map((r) => r.url),
      });
    }
    return results;
  }
}
