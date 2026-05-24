# Public reverse-tunnel relay for AbsoluteJS dev (webhook ingress).
# Deploy to any always-on host with a public HTTPS URL (e.g. DO App Platform).
FROM oven/bun:1

WORKDIR /app
COPY package.json ./
RUN bun install

# App Platform injects PORT; the relay reads it. ABSOLUTE_TUNNEL_TOKEN is the
# shared secret your dev machine presents. ABSOLUTE_TUNNEL_PUBLIC_URL (optional)
# is the relay's own public base URL, used when emitting absolute links.
EXPOSE 8080
CMD ["bun", "run", "start"]
