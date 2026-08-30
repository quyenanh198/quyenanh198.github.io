# syntax=docker/dockerfile:1

# Eleventy site + self-refreshing market reports, for macmini-hub.
#
# nginx serves the built site on :8080. cron regenerates reports/posts on the
# same cadence GitHub Actions uses, then rebuilds — no pushes to the repo, the
# generated markdown lives in the /site/reports volume (mounted by compose as
# ${DATA_ROOT}/stock-reports) so reports survive image updates. Node stays in
# the runtime image because the generator scripts need it.
FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx cron ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /site

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/reports-cron /etc/cron.d/stock-reports
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod 0644 /etc/cron.d/stock-reports && chmod +x /entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
