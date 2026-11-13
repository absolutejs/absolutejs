# AbsoluteJS production container for platforms that scale to zero
# (Cloud Run, Fly Machines, Railway, Render, Knative, ECS/Fargate, ...).
#
# Copy this file and .dockerignore into your app root, then:
#   docker build -t my-app .                   # prebuilt server (default)
#   docker build -t my-app --target binary .   # single compiled executable
#   docker run --rm -p 3000:3000 my-app
#
# The build runs inside Linux on purpose: the server bundle can carry
# platform-specific native addons, so a build made on macOS does not run here.
# Measured cold starts and the trade-offs between the two targets are in
# templates/container/README.md.

ARG BUN_VERSION=1.4.4

# ── Build: full install, `absolute prepare` writes dist/ ─────────
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
ENV NODE_ENV=production TELEMETRY_OFF=1
RUN bunx absolute prepare

# ── Production dependencies only ─────────────────────────────────
# The server bundle keeps framework runtimes (react, vue, svelte, ...)
# external, so it resolves them from node_modules at run time.
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# ── Compiled executable (optional target: --target binary) ──────
FROM build AS compile
RUN bunx absolute compile --outdir /app/compile-out --outfile /app/server

FROM oven/bun:${BUN_VERSION}-slim AS binary
WORKDIR /app
COPY --from=compile /app/server /app/server
# The binary unpacks its SSR runtime into TMPDIR on the first request that
# is not a prerendered page or an embedded asset, and keeps a record of past
# releases' client assets for open tabs. Point that record at a volume if you
# want it to survive restarts; on an ephemeral disk it starts empty each time.
ENV PORT=3000 \
	TELEMETRY_OFF=1 \
	ABSOLUTE_ASSET_ARCHIVE_DIR=/tmp/absolutejs-client-assets
USER bun
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/server"]

# ── Prebuilt server (default target) ────────────────────────────
FROM oven/bun:${BUN_VERSION}-slim AS server
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
# What `absolute start --prebuilt` sets for the server it spawns, set here so
# the container runs the bundle directly: one process, no CLI controller, and
# about 300 ms less to the first response (measured in a Linux container).
#   HOST=0.0.0.0     the default, localhost, is unreachable from outside the
#                    container.
#   ABSOLUTE_INSTANCE_MANAGED=1
#                    skip the local `absolute ps` registry in $HOME.
ENV NODE_ENV=production \
	PORT=3000 \
	HOST=0.0.0.0 \
	ABSOLUTE_BUILD_DIR=/app/dist \
	ABSOLUTE_INSTANCE_MANAGED=1 \
	TELEMETRY_OFF=1
USER bun
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["bun", "dist/server.js"]
