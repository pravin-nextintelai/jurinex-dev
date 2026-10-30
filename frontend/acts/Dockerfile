# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time values. BARE_ACTS_API_URL / BARE_ACTS_API_KEY are optional here:
# without them generateStaticParams returns [] and pages are built on first visit.
ARG SITE_URL=https://jurinex.ai
ENV SITE_URL=$SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- run ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# output: "standalone" emits a minimal server with only the needed node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Runtime env (set on the container): BARE_ACTS_API_URL, BARE_ACTS_API_KEY, REVALIDATE_SECRET, SITE_URL
CMD ["node", "server.js"]
