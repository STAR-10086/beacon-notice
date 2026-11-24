# Stage 1: Build Vite + React admin SPA
FROM node:20-alpine AS web-builder
WORKDIR /web

COPY web/package*.json ./
RUN npm install

COPY web/ ./
RUN npm run build

# Stage 2: Production Node.js server + static SPA
FROM node:20-alpine
WORKDIR /app

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/src ./src
COPY --from=web-builder /web/dist ./public

ENV NODE_ENV=production \
    PORT=3080 \
    ADMIN_PORT=3081 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public

VOLUME ["/data"]
EXPOSE 3080 3081

CMD ["node", "src/index.js"]
