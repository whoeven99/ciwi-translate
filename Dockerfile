# Spark-style deploy: prod deps only, build in image, fast container start (prisma generate only).
FROM node:22-slim

RUN apt-get update -y \
  && apt-get install -y openssl \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 8080

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/translation-core/package.json ./packages/translation-core/package.json
COPY patches ./patches

RUN npm ci --legacy-peer-deps && npm cache clean --force

COPY . .

RUN npm run build:docker

CMD ["npm", "run", "docker-start"]
