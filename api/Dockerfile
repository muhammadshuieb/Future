# bookworm-slim لا يحتوي أدوات بناء؛ حزم مثل bullmq/msgpackr قد تحتاج g++ وpython3 لـ node-gyp
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ iputils-ping curl default-mysql-client rclone git docker.io docker-compose \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./

RUN npm install --no-audit --no-fund

COPY . .

RUN npm run build && npm prune --omit=dev \
 && node scripts/verify-api-dist.mjs

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
