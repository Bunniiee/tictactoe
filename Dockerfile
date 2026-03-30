FROM ghcr.io/heroiclabs/nakama:3.25.0

COPY backend/data/modules/index.js /nakama/data/modules/index.js
COPY nakama.yml /nakama/data/nakama.yml

EXPOSE 7350 7351

ENTRYPOINT ["/bin/sh", "-ec", \
  "DB=${NAKAMA_DB_ADDR:-${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/${PGDATABASE}} && \
   /nakama/nakama migrate up --database.address $DB && \
   exec /nakama/nakama --config /nakama/data/nakama.yml --database.address $DB"]
