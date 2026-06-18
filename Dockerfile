# --- build stage ---
FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build && pnpm prune --prod

# --- runtime stage ---
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV VAULT_PATH=/data
ENV VAULT_SUBDIR=Restaurants
# Max request body the Node server accepts. adapter-node defaults to 512K,
# which truncates multi-photo visit/dish uploads and surfaces as a generic 400.
ENV BODY_SIZE_LIMIT=64M

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Default vault mount point — override in docker-compose
RUN mkdir -p /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "build"]
