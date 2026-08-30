#!/bin/sh
set -e

# /site/reports is the compose volume (${DATA_ROOT}/stock-reports). First run
# seeds it with the reports committed in the repo, then src/reports becomes a
# symlink into the volume so the generators and Eleventy read/write there.
mkdir -p /site/reports
if [ ! -L /site/src/reports ]; then
    if [ -d /site/src/reports ] && [ -z "$(ls -A /site/reports)" ]; then
        cp -R /site/src/reports/. /site/reports/
    fi
    rm -rf /site/src/reports
    ln -s /site/reports /site/src/reports
fi

npx @11ty/eleventy

cron
exec nginx -g 'daemon off;'
