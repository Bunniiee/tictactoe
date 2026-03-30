#!/bin/sh
set -e

if [ -n "$DATABASE_URL" ]; then
  DB=$(echo "$DATABASE_URL" | sed 's|^postgresql://||' | sed 's|^postgres://||')
elif [ -n "$NAKAMA_DB_ADDR" ]; then
  DB="$NAKAMA_DB_ADDR"
else
  DB="${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/${PGDATABASE}"
fi

echo "Starting Nakama, DB host: ${DB#*@}"

MAX_RETRIES=20
RETRY=0
until /nakama/nakama migrate up --database.address "$DB"; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "Migration failed after $MAX_RETRIES attempts, exiting"
    exit 1
  fi
  echo "DB not ready (attempt $RETRY/$MAX_RETRIES), retrying in 5s..."
  sleep 5
done

echo "Migration complete, starting Nakama..."
exec /nakama/nakama --config /nakama/data/nakama.yml --database.address "$DB"
