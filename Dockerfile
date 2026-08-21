FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ARG MEDIAMTX_VERSION=1.9.3
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && MEDIAMTX_ARCH="$([ "$TARGETARCH" = "arm64" ] && echo arm64v8 || echo amd64)" \
    && curl -fL "https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}/mediamtx_v${MEDIAMTX_VERSION}_linux_${MEDIAMTX_ARCH}.tar.gz" -o /tmp/mediamtx.tar.gz \
    && tar -xzf /tmp/mediamtx.tar.gz -C /usr/local/bin mediamtx \
    && chmod +x /usr/local/bin/mediamtx \
    && rm -rf /tmp/mediamtx.tar.gz /var/lib/apt/lists/* \
    && apt-get purge -y curl \
    && apt-get autoremove -y

ENV NODE_ENV=production
ENV MEDIAMTX_PATH=/usr/local/bin/mediamtx
ENV RTMP_MEDIA_ROOT=/app/media

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/media

EXPOSE 8081 1935 8000

CMD ["node", "dist/index.js"]
