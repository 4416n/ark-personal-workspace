FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY shared ./shared
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production PORT=5173 ARK_HOST=0.0.0.0 ARK_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
    && mkdir /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY src/domain.ts ./src/domain.ts
USER node
VOLUME ["/data"]
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5173/api/health',{headers:{host:new URL(process.env.ARK_PUBLIC_ORIGIN).host},signal:AbortSignal.timeout(4000)}).then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs", "--production"]
