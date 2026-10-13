# India tariff crawler production image.
# Build context must be packages/india-tariffs/ (this directory), so the
# image can include both the crawler and the committed registry/ data that
# ships with each release:
#   docker build -t india-tariffs-crawler:<git-sha> -f Dockerfile .
#
# Tag with the exact deployed commit SHA (see
# docs/operations/TARIFF_CRAWLER_DEPLOYMENT_PRJXN2.md).

FROM node:24-alpine AS build
WORKDIR /app
COPY crawler/package.json crawler/package-lock.json ./
RUN npm ci
COPY crawler/tsconfig.json ./
COPY crawler/src ./src
COPY crawler/tests ./tests
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Non-root execution.
RUN addgroup -S crawler && adduser -S crawler -G crawler

COPY crawler/package.json crawler/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Committed, human-reviewed registry data ships with the image so a deployed
# SHA has a stable, reproducible registry snapshot. Runtime registry-load
# still goes through the same idempotent upsert path as local development
# (src/db/registryLoader.ts) -- this does not bypass review, it only pins
# which registry version travels with which image tag.
COPY registry ./registry
COPY schemas ./schemas

# Persistent state: document archive and manifest. Mounted as a volume in
# deployment so it survives container restarts/recreation (see
# docs/operations/TARIFF_CRAWLER_DEPLOYMENT_PRJXN2.md). Owned by the
# non-root crawler user.
RUN mkdir -p /app/data/.archive && chown -R crawler:crawler /app/data /app/registry /app/schemas
VOLUME ["/app/data"]
ENV CRAWLER_ARCHIVE_DIR=/app/data/.archive
ENV CRAWLER_PACKAGE_ROOT=/app

USER crawler

# Health check: verifies the process can load its own registry files and
# exit cleanly, without contacting the database or any external network --
# suitable for container-level liveness, not a full readiness probe.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node dist/src/cli.js verify || exit 1

ENTRYPOINT ["node", "dist/src/cli.js"]
CMD ["--help"]
