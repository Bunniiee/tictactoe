FROM heroiclabs/nakama:3.25.0

COPY backend/data/modules/index.js /nakama/data/modules/index.js
COPY nakama.yml /nakama/data/nakama.yml
COPY entrypoint.sh /entrypoint.sh

EXPOSE 7350 7351

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
