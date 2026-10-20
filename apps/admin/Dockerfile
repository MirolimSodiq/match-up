# syntax=docker/dockerfile:1
# Match Up admin panel — Next.js standalone image. Build context: repo ildizi.
#
#   docker build -f apps/admin/Dockerfile -t matchup-admin .
#   docker run -e API_URL=http://api:3000 -p 3100:3100 matchup-admin
#
# Runtime env: API_URL (BFF -> API), SENTRY_DSN, SENTRY_ENVIRONMENT.
# Brauzer Sentry DSN build vaqtida inline qilinadi: --build-arg NEXT_PUBLIC_SENTRY_DSN=...

ARG NODE_VERSION=24.22.0
ARG ALPINE_VERSION=3.24

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS prune
ARG TURBO_VERSION=2.11.9
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @matchup/admin --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
# turbo prune root tsconfig.base.json ni ko'chirmaydi (packages/contracts uni extend qiladi)
COPY tsconfig.base.json ./
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=""
RUN pnpm --filter @matchup/admin build

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# standalone: apps/admin/server.js + trace qilingan node_modules; static fayllar alohida ko'chiriladi
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
# Next runtime keshi uchun yagona yoziladigan joy (qolgan fayllar root'niki, faqat o'qiladi)
RUN mkdir -p apps/admin/.next/cache && chown node:node apps/admin/.next/cache
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/admin/server.js"]
