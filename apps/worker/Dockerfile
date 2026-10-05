# syntax=docker/dockerfile:1.7
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @atd/worker build
# Só dependências de produção do worker (inclui as de terceiros usadas pelos pacotes @atd/*)
RUN pnpm --filter @atd/worker deploy --prod --legacy /out && cp -r apps/worker/dist /out/dist

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
