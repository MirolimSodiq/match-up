# syntax=docker/dockerfile:1
# Match Up API — production image. Build context: repo ildizi.
#
#   docker build -f apps/api/Dockerfile -t matchup-api .
#   docker run -e DATABASE_URL=... -e REDIS_URL=... matchup-api                   # API (port 3000)
#   docker run --rm -e DATABASE_URL=... matchup-api node dist/scripts/migrate.js   # migratsiya (bir martalik)
#
# Secret'lar image'da yo'q: env (ECS Secrets Manager) yoki fayl (*_KEY_FILE, /run/secrets/...) orqali keladi.

ARG NODE_VERSION=24.22.0
ARG ALPINE_VERSION=3.24

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# 1) Faqat @matchup/api va uning workspace bog'liqliklari; lockfile ham qisqartiriladi (Expo/RN paketlarisiz)
FROM base AS prune
ARG TURBO_VERSION=2.11.9
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @matchup/api --docker

# 2) Bog'liqliklar faqat package.json/lockfile o'zgarganda qayta o'rnatiladi; keyin build va prod deploy
FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
# turbo prune root tsconfig.base.json ni ko'chirmaydi (apps/api/tsconfig.json uni extend qiladi)
COPY tsconfig.base.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @matchup/api build \
 && pnpm --filter @matchup/api deploy --prod --legacy /out

# 3) Runtime: faqat dist + production node_modules + SQL migratsiyalar, non-root
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime
ARG RDS_CA_BUNDLE_URL=https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
ENV NODE_ENV=production \
    PORT=3000 \
    MIGRATIONS_DIR=/app/db/migrations \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem
WORKDIR /app
# RDS sertifikatlari: DATABASE_URL ...?sslmode=verify-full bilan server sertifikati tekshiriladi
ADD --chmod=644 ${RDS_CA_BUNDLE_URL} /etc/ssl/certs/rds-global-bundle.pem
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY db/migrations ./db/migrations
COPY --chmod=755 apps/api/docker-entrypoint.sh /usr/local/bin/matchup-entrypoint
# GDPR eksport fayllari (STORAGE_DIR, standart /app/storage) — yagona yoziladigan joy; volume ulansa egasi shundan olinadi
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["matchup-entrypoint"]
CMD ["node", "dist/main.js"]
