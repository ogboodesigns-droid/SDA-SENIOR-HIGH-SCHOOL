FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web-admin/package.json apps/web-admin/
RUN pnpm install --frozen-lockfile --filter @sda-shs/web-admin...
COPY packages/shared packages/shared
COPY apps/web-admin apps/web-admin
RUN pnpm --filter @sda-shs/shared build && pnpm --filter @sda-shs/web-admin build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web-admin/.next/standalone ./
COPY --from=build /app/apps/web-admin/.next/static ./apps/web-admin/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web-admin/server.js"]
