# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app

# Run as non-root (security best practice, also required by many
# Kubernetes Pod Security Standards / OPA policies)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=build /app /app
USER appuser

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "index.js"]
