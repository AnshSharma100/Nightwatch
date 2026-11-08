# syntax=docker/dockerfile:1
FROM node:24.13.1-bookworm-slim@sha256:a81a03dd965b4052269a57fac857004022b522a4bf06e7a739e25e18bce45af2 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS web-build
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28.0-alpine@sha256:c97ff0bf7cbae369953c6da1232ec14ad9f971d66360c5698db0856a4cd657a0 AS frontend
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080

FROM dependencies AS practice-data
ARG EOG_REFERENCE=135ba4c8348357457420a1111df80ec1906bcbdb
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
COPY scripts/prepare-data.mjs scripts/prepare-data.mjs
RUN git init /reference && git -C /reference fetch --depth=1 https://github.com/nihaal419/HackUTD-ZeroDay "$EOG_REFERENCE" \
    && git -C /reference checkout --detach FETCH_HEAD && node scripts/prepare-data.mjs /reference

FROM dependencies AS api-dependencies
RUN npm prune --omit=dev

FROM node:24.13.1-bookworm-slim@sha256:a81a03dd965b4052269a57fac857004022b522a4bf06e7a739e25e18bce45af2 AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=api-dependencies /app/node_modules node_modules
COPY package.json ./
COPY server server
COPY packages packages
COPY src/agent src/agent
COPY --from=practice-data /app/public/practice public/practice
RUN mkdir -p /app/data/recordings && chown -R node:node /app/data
USER node
EXPOSE 4100
CMD ["node", "server/main.ts"]
