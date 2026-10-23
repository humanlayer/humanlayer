# syntax=docker/dockerfile:1.20

FROM oven/bun:1.3 AS base
WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS manifests
COPY package.json bun.lock bunfig.toml ./
COPY --parents apps/*/package.json packages/*/package.json contracts/*/package.json vendor/*/package.json ./

# Stage 1: Install deps and build
# Filtered install: a full workspace install would run node-pty's gyp build
# (dep of riptide-electron), which needs Python that oven/bun doesn't ship.
FROM manifests AS builder
RUN bun install --frozen-lockfile --filter @humanlayer/riptide-electric-proxy
COPY --parents apps/riptide-electric-proxy packages contracts vendor ./
RUN cd apps/riptide-electric-proxy && bun run build

# Stage 2: Upload source maps (non-blocking, uses BuildKit secret)
ARG SENTRY_RELEASE
ARG SENTRY_ENVIRONMENT
ARG SENTRY_ORG
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN \
	if [ -f /run/secrets/SENTRY_AUTH_TOKEN ] && [ -n "${SENTRY_ORG}" ]; then \
		export SENTRY_AUTH_TOKEN=$(cat /run/secrets/SENTRY_AUTH_TOKEN) && \
		cd apps/riptide-electric-proxy && \
		bunx --package @sentry/cli sentry-cli sourcemaps inject ./dist && \
		bunx --package @sentry/cli sentry-cli sourcemaps upload ./dist \
			--release "${SENTRY_RELEASE}" \
			--org "${SENTRY_ORG}" \
			--project riptide-electric-proxy \
		|| echo "Sentry upload failed, continuing..."; \
	else \
		echo "SENTRY_AUTH_TOKEN or SENTRY_ORG not provided, skipping Sentry source map upload"; \
	fi

# Stage 3: Install production deps only
FROM manifests AS prod-deps
RUN bun install --frozen-lockfile --production --filter @humanlayer/riptide-electric-proxy

# Stage 4: Final runtime image
FROM node:24-slim AS runner
WORKDIR /usr/src/app/apps/riptide-electric-proxy
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 hono

COPY --from=prod-deps --chown=hono:nodejs /usr/src/app /usr/src/app
COPY --from=builder --chown=hono:nodejs /usr/src/app/apps/riptide-electric-proxy/dist ./dist
COPY --from=builder --chown=hono:nodejs /usr/src/app/apps/riptide-electric-proxy/dist/instrument.mjs ./instrument.mjs

USER hono
ENV NODE_ENV=production PORT=8888
EXPOSE 8888
CMD ["node", "--import", "./instrument.mjs", "./dist/index.mjs"]
