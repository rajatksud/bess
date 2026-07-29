import { resolve } from "node:path";
import { DocumentArchive } from "./archive.js";
import { crawlSource } from "./crawl.js";
import { loadSourceRegistry, selectActiveSources } from "./registry.js";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..", "..");
const DEFAULT_REGISTRY_PATH = resolve(PACKAGE_ROOT, "registry", "sources.yaml");
const DEFAULT_ARCHIVE_DIR = resolve(PACKAGE_ROOT, "crawler", ".archive");
const DEFAULT_MANIFEST_PATH = resolve(PACKAGE_ROOT, "crawler", ".archive", "manifest.json");

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command === "crawl") {
    await runCrawl(args);
    return;
  }
  if (command === "verify") {
    runVerify(args);
    return;
  }

  console.error("Usage: cli.js <crawl|verify> [--registry <path>] [--source <source_id>]");
  process.exitCode = 1;
}

async function runCrawl(args: string[]): Promise<void> {
  const registryPath = flagValue(args, "--registry") ?? DEFAULT_REGISTRY_PATH;
  const onlySourceId = flagValue(args, "--source");

  const sources = loadSourceRegistry(registryPath);
  const active = selectActiveSources(sources).filter((s) => !onlySourceId || s.source_id === onlySourceId);

  if (active.length === 0) {
    console.log("No ACTIVE sources matched. Sources start as NOT_CONFIGURED until verified — see registry/sources.yaml.");
    return;
  }

  const archive = new DocumentArchive(DEFAULT_ARCHIVE_DIR, DEFAULT_MANIFEST_PATH);
  let hadErrors = false;

  for (const source of active) {
    console.log(`\n[${source.source_id}] crawling ${source.url}`);
    const result = await crawlSource(source, archive);
    console.log(
      `[${source.source_id}] links=${result.linksDiscovered} fetched=${result.documentsFetched} new=${result.newDocuments}`,
    );
    if (result.replacementsDetected.length > 0) {
      console.warn(`[${source.source_id}] REPLACEMENT DETECTED:\n  ${result.replacementsDetected.join("\n  ")}`);
    }
    if (result.errors.length > 0) {
      hadErrors = true;
      console.error(`[${source.source_id}] errors:\n  ${result.errors.join("\n  ")}`);
    }
  }

  if (hadErrors) {
    process.exitCode = 1;
  }
}

function runVerify(args: string[]): void {
  const registryPath = flagValue(args, "--registry") ?? DEFAULT_REGISTRY_PATH;
  const sources = loadSourceRegistry(registryPath);
  console.log(`Registry OK: ${sources.length} source(s) at ${registryPath}`);
  for (const s of sources) {
    console.log(`  - ${s.source_id} [${s.monitoring_status}] adapter=${s.adapter} domains=${s.allowed_domains.join(",")}`);
  }
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
