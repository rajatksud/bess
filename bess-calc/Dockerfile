# syntax=docker/dockerfile:1

# ---- deps: install once, reused by both the frontend and server build stages ----
FROM node:22.14.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the React frontend and the Express API ----
FROM deps AS build
WORKDIR /app
COPY . .
# Generates node_modules/.prisma/client (including the Linux query engine binary,
# since this stage runs on the linux/alpine base regardless of host platform) - the
# @prisma/client package itself is only a thin loader around this generated output,
# so `npm ci` alone (in either stage) is not sufficient; `prisma generate` must run
# explicitly, and its output must be copied into the runtime stage below.
RUN npx prisma generate
# APP_VERSION baked in from package.json at build time so the running server's
# /api/v1/version endpoint reflects the real release version even after bundling
# (see server/lib/version.ts - bundling collapses the file's relative path back to
# package.json, so the env var is the reliable source once compiled).
RUN node -e "console.log(require('./package.json').version)" > /tmp/app_version \
  && npm run build \
  && APP_VERSION=$(cat /tmp/app_version) npm run build:server

# ---- runtime: minimal image, compiled JS only, no dev dependencies, non-root user ----
FROM node:22.14.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S bess && adduser -S bess -G bess

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
# node_modules/.prisma/client (generated Linux query engine + client code) is not
# reproduced by this stage's own `npm ci --omit=dev` - `prisma` (the generator CLI)
# is a devDependency, omitted here by design. Copy the already-generated output from
# the build stage instead of running `prisma generate` again in the runtime stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

ARG GIT_COMMIT_SHA=unknown
ARG APP_VERSION=0.0.0-unknown
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV PORT=8080

USER bess
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server-dist/index.js"]
