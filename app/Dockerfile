# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app

# Remove npm/npx entirely - the app only needs the `node` runtime to
# execute `node index.js`. This also removes npm's own internally-bundled
# `tar` package (source of CVE-2026-59873, CRITICAL) from the final
# shipped image, since we don't need npm here at all.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx


# Run as non-root (security best practice, also required by many
# Kubernetes Pod Security Standards / OPA policies). Use a numeric UID
# (not just a named user) so Kubernetes' runAsNonRoot check can verify
# this without needing to execute the image first.
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup
COPY --from=build /app /app
USER 1001

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "index.js"]