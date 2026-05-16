# bookworm-slim لا يحتوي أدوات بناء؛ حزم مثل bullmq/msgpackr قد تحتاج g++ وpython3 لـ node-gyp
FROM node:22-bookworm-slim

WORKDIR /app

ARG COMPOSE_VERSION=2.32.4
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ iputils-ping curl default-mysql-client rclone git docker.io freeradius-utils \
  && update-ca-certificates \
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in amd64) COMPOSE_ARCH=x86_64 ;; arm64) COMPOSE_ARCH=aarch64 ;; *) COMPOSE_ARCH="$ARCH" ;; esac \
  && curl -fsSL "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-${COMPOSE_ARCH}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose \
  && docker compose version \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./

RUN npm install --no-audit --no-fund

COPY . .

RUN rm -rf dist \
 && npm run build && npm prune --omit=dev \
 && node scripts/verify-api-dist.mjs

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
