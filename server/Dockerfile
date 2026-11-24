FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3080
ENV DATA_DIR=/data

EXPOSE 3080

CMD ["node", "src/index.js"]
