#!/usr/bin/env bash
# Runs the test suite against a throwaway local PostgreSQL 16 cluster.
# Uses an existing server instead if PGHOST/PGPORT are already set.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${PGPORT:-}" ]]; then
  BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
  DIR=$(mktemp -d)
  chown postgres "$DIR" 2>/dev/null || true
  RUN=""; [[ $(id -u) == 0 ]] && RUN="runuser -u postgres --"
  $RUN "$BIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
  $RUN "$BIN/pg_ctl" -D "$DIR/data" -o "-p 54329 -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
  trap '$RUN "$BIN/pg_ctl" -D "$DIR/data" -m fast stop >/dev/null; rm -rf "$DIR"' EXIT
  export PGHOST=$DIR PGPORT=54329 PGUSER=postgres
fi
npx tsx --test test/*.test.ts
