FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @sda-shs/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @sda-shs/shared build && pnpm --filter @sda-shs/api build \
 && pnpm --filter @sda-shs/api deploy --legacy --prod /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /app/apps/api/drizzle ./drizzle
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 4000
# Apply pending migrations, then start.
CMD ["sh", "-c", "node dist/database/migrate.js && node dist/main.js"]
