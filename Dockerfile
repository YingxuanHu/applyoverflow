FROM node:24-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl dumb-init openssl procps \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS builder

COPY . .
ENV DATABASE_URL="postgresql://autoapplication:placeholder@localhost:5432/autoapplication?schema=public"
ENV BETTER_AUTH_SECRET="build-time-placeholder"
ENV BETTER_AUTH_URL="http://localhost:3000"
ENV NEXT_PUBLIC_BETTER_AUTH_URL="http://localhost:3000"
# Keep compilation inside the volume-backed release builder's memory budget.
RUN NODE_OPTIONS=--max-old-space-size=1280 npm run build -- --webpack
RUN node --import tsx scripts/build-pdf-smoke-fixtures.ts /app/pdf-smoke

# Keep TeX out of ingestion workers and build dependencies.
FROM base AS pdf-runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends texlive-xetex texlive-latex-extra texlive-fonts-recommended fonts-texgyre \
  && rm -rf /var/lib/apt/lists/*

FROM pdf-runtime AS web
ARG BUILD_SHA=unknown
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 BUILD_SHA=$BUILD_SHA
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/pdf-smoke ./pdf-smoke
COPY --chown=node:node scripts/pdf-runtime-smoke.mjs ./pdf-smoke/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]

FROM builder AS worker-files
# Dependencies already have a cached runner layer. The standalone web copy
# and compilation cache are not used by workers or staging's next start.
RUN rm -rf /app/node_modules /app/.next/standalone /app/.next/cache

FROM base AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules

# The worker process uses Playwright for conservative form automation.
RUN npx playwright install --with-deps chromium \
  && npm cache clean --force

COPY --from=worker-files /app ./

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start:web"]
