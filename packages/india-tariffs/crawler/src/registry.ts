import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import type { AuthoritativeSource, SourceRegistryFile } from "./types.js";

export function loadSourceRegistry(path: string): AuthoritativeSource[] {
  const raw = readFileSync(path, "utf8");
  const parsed = load(raw) as SourceRegistryFile;
  if (!parsed || !Array.isArray(parsed.sources)) {
    throw new Error(`Invalid source registry at ${path}: missing "sources" array`);
  }
  for (const source of parsed.sources) {
    validateSource(source, path);
  }
  return parsed.sources;
}

function validateSource(source: AuthoritativeSource, path: string): void {
  const required: (keyof AuthoritativeSource)[] = [
    "source_id",
    "url",
    "source_type",
    "authority_rank",
    "monitoring_status",
    "allowed_domains",
    "discovery_method",
    "adapter",
  ];
  for (const field of required) {
    if (source[field] === undefined || source[field] === null) {
      throw new Error(`Invalid source registry at ${path}: source is missing required field "${field}" (source_id=${source.source_id ?? "unknown"})`);
    }
  }
  if (!Array.isArray(source.allowed_domains) || source.allowed_domains.length === 0) {
    throw new Error(`Invalid source registry at ${path}: source "${source.source_id}" must declare at least one allowed_domains entry`);
  }
  const sourceHost = new URL(source.url).hostname;
  if (!source.allowed_domains.includes(sourceHost)) {
    throw new Error(
      `Invalid source registry at ${path}: source "${source.source_id}" url host "${sourceHost}" is not in its own allowed_domains list`,
    );
  }
}

export function selectActiveSources(sources: AuthoritativeSource[]): AuthoritativeSource[] {
  return sources.filter((s) => s.monitoring_status === "ACTIVE");
}
