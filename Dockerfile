# syntax=docker/dockerfile:1
# The whole app is plain Node with no packages to install, so this image is just Node plus the source.
FROM node:26-alpine

ARG VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/web \
    IMMICHSET_VERSION=$VERSION

WORKDIR /app
COPY LICENSE server.mjs ./
COPY config ./config
COPY setup ./setup
COPY admin ./admin
COPY health ./health
COPY mail ./mail
COPY site ./site
COPY zip ./zip
COPY web ./web

# The app runs as the unprivileged "node" user (uid 1000) and writes only to /data and /backups.
# Named volumes inherit this ownership. A folder on your computer that you mount instead must be owned by
# uid 1000, or the container given a `user:` that owns it; the setup page says so if it cannot write.
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node

EXPOSE 3000

# /healthz answers while the app is waiting for first-time setup too, so the container counts as healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

LABEL org.opencontainers.image.source="https://github.com/NatePhotos/immichset" \
      org.opencontainers.image.description="Client photo galleries on top of Immich" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

CMD ["node", "server.mjs"]
