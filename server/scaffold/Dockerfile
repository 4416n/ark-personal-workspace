FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts
FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATA_DIR=/app/data
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
CMD ["npm", "start"]
