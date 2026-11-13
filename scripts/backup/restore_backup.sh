#!/usr/bin/env bash
# Restores a backup produced by run_backup.sh into a target Postgres
# database. Decrypts, extracts, and replays the dump with psql.
#
# SAFETY: this script will overwrite whatever is in the target database.
# It is meant for an isolated test/staging project, never production. It
# does not ask "are you sure" - that confirmation belongs to whoever runs
# it, per docs/DATABASE_BACKUP.md's restore procedure.
#
# Usage:
#   BACKUP_ENCRYPTION_PASSPHRASE=... ./restore_backup.sh <path-to-encrypted-backup> <target-db-url>
#
# <target-db-url> is a full Postgres connection URI, e.g. the direct
# connection string of a throwaway/staging Supabase project. NEVER point
# this at the production SUPABASE_DB_URL.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <path-to-encrypted-backup.tar.gz.gpg> <target-db-url>" >&2
  exit 2
fi
ENCRYPTED_FILE="$1"
TARGET_DB_URL="$2"

if [[ "$TARGET_DB_URL" == *"rqovkmjsdwzggebvwvdk"* ]]; then
  echo "REFUSING: target looks like the production project (rqovkmjsdwzggebvwvdk)." >&2
  echo "Restore into an isolated test/staging project only." >&2
  exit 1
fi

: "${BACKUP_ENCRYPTION_PASSPHRASE:?Set BACKUP_ENCRYPTION_PASSPHRASE to decrypt the backup}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "== Decrypting =="
gpg --batch --yes --pinentry-mode loopback \
  --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  --output "${WORKDIR}/archive.tar.gz" \
  --decrypt "$ENCRYPTED_FILE"

echo "== Extracting =="
tar -xzf "${WORKDIR}/archive.tar.gz" -C "$WORKDIR"
DUMP_FILE="$(ls "${WORKDIR}"/*.sql | grep -v globals)"
GLOBALS_FILE="$(ls "${WORKDIR}"/*.globals.sql 2>/dev/null || true)"
MANIFEST="$(ls "${WORKDIR}"/*.manifest.json 2>/dev/null || true)"
[ -n "$MANIFEST" ] && { echo "manifest:"; cat "$MANIFEST"; }

if [ -n "$GLOBALS_FILE" ] && ! grep -q "pg_dumpall --globals-only failed" "$GLOBALS_FILE"; then
  echo "== Restoring cluster roles (pg_dumpall --globals-only output) =="
  psql "$TARGET_DB_URL" --file="$GLOBALS_FILE" || echo "WARNING: some role statements may have failed (e.g. roles that already exist on the target) - continuing." >&2
else
  echo "== No usable globals/roles dump in this backup; skipping role restore =="
fi

echo "== Restoring schema + data =="
psql "$TARGET_DB_URL" --file="$DUMP_FILE"

echo "== Restore complete. Verify the target database before using it. =="
