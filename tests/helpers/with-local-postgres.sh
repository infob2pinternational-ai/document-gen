#!/usr/bin/env bash
# Run a command against a throwaway LOCAL PostgreSQL server.
#
#   tests/helpers/with-local-postgres.sh node --test tests/field-sales-db.test.mjs tests/field-sales-concurrency.test.mjs
#
# Creates a brand-new cluster in a temporary directory, listening only on a
# Unix socket inside that directory (no TCP port is opened), runs the command
# with FIELD_SALES_TEST_PG=1 and PGHOST/PGPORT/PGUSER pointing at it, then
# stops the server and deletes the directory. It never uses, reads or needs
# any Supabase or production connection details.
set -euo pipefail

if [ "$#" -eq 0 ]; then echo "usage: $0 <command> [args...]" >&2; exit 2; fi

BIN="${PG_BIN:-}"
if [ -z "$BIN" ]; then
  if command -v initdb >/dev/null 2>&1; then BIN="$(dirname "$(command -v initdb)")"
  else BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"; fi
fi
if [ -z "$BIN" ] || [ ! -x "$BIN/initdb" ]; then
  echo "PostgreSQL server binaries (initdb, pg_ctl) not found. Install PostgreSQL or set PG_BIN." >&2; exit 1
fi

DIR="$(mktemp -d /tmp/field-sales-pg.XXXXXX)"
PORT="${FIELD_SALES_TEST_PG_PORT:-54329}"
# PostgreSQL refuses to run as root; use the postgres system user in that case.
if [ "$(id -u)" -eq 0 ]; then chown postgres "$DIR"; AS=(runuser -u postgres --); else AS=(); fi

cleanup() {
  "${AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

"${AS[@]}" "$BIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -l "$DIR/server.log" -w \
  -o "-c listen_addresses='' -c unix_socket_directories=$DIR -p $PORT -c fsync=off -c max_connections=60" start >/dev/null

echo "Local PostgreSQL $("$BIN/postgres" --version | awk '{print $3}') on socket $DIR (port $PORT)" >&2
FIELD_SALES_TEST_PG=1 PGHOST="$DIR" PGPORT="$PORT" PGUSER=postgres "$@"
