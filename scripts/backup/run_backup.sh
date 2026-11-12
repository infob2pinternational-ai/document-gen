#!/usr/bin/env bash
# Takes a full logical backup of the production Supabase Postgres database
# (schema, data, functions, triggers, RLS policies via pg_dump; cluster
# roles via pg_dumpall --globals-only), encrypts it, uploads it to Google
# Drive via rclone, verifies the upload by re-downloading and comparing a
# SHA-256 checksum, and only then applies retention (deleting old backups).
#
# Run by .github/workflows/supabase-backup.yml. Can also be run locally by
# anyone with the same environment variables set, for testing.
#
# Required environment variables (all provided as GitHub Secrets in CI):
#   SUPABASE_DB_URL              Direct (non-pooler) Postgres connection URI.
#                                 Settings -> Database -> Connection string -> URI
#                                 ("Direct connection", not "Transaction pooler").
#   BACKUP_ENCRYPTION_PASSPHRASE Passphrase for GPG symmetric encryption (AES-256).
#   RCLONE_CONFIG_B64            Base64 of an rclone.conf with a configured
#                                 Google Drive remote named "gdrive" (see
#                                 docs/DATABASE_BACKUP.md for how to create it).
#   DRIVE_BACKUP_FOLDER          Drive path under the "gdrive" remote to upload
#                                 into, e.g. "B2P Database Backups". Created if absent.
#
# Exits non-zero on ANY failure - including a failed verification - and never
# runs retention cleanup unless the new backup was uploaded and verified.
set -euo pipefail

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"
: "${RCLONE_CONFIG_B64:?RCLONE_CONFIG_B64 is required}"
: "${DRIVE_BACKUP_FOLDER:?DRIVE_BACKUP_FOLDER is required}"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BASENAME="b2p-db-backup-${TIMESTAMP}"
DUMP_FILE="${BASENAME}.sql"
GLOBALS_FILE="${BASENAME}.globals.sql"
ARCHIVE="${BASENAME}.tar.gz"
ENCRYPTED="${ARCHIVE}.gpg"
CHECKSUM_FILE="${ENCRYPTED}.sha256"

echo "== Preparing rclone config (never printed, never logged) =="
export RCLONE_CONFIG="${WORKDIR}/rclone.conf"
echo "$RCLONE_CONFIG_B64" | base64 -d > "$RCLONE_CONFIG"
chmod 600 "$RCLONE_CONFIG"

echo "== Dumping database schema + data + functions + triggers + RLS policies =="
# public, auth (Supabase Auth users - see docs/DATABASE_BACKUP.md for the
# caveats on what this does and does not capture) and storage (object
# METADATA only, never file bytes - see the same doc) schemas.
# --no-owner / --no-privileges: this dump is meant to be restorable into a
# fresh project whose roles may not exactly match production's; role
# membership is backed up separately below via pg_dumpall --globals-only.
pg_dump "$SUPABASE_DB_URL" \
  --format=plain \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=auth \
  --schema=storage \
  --schema=b2p_migration_internal \
  --schema=field_sales_internal \
  --file="$DUMP_FILE" \
  2> >(grep -v "password" >&2)
echo "   dump: $(wc -l < "$DUMP_FILE") lines, $(du -h "$DUMP_FILE" | cut -f1)"

echo "== Dumping cluster-level roles (pg_dumpall --globals-only) =="
# May fail if the connecting role lacks privilege to read pg_authid; that is
# logged as a warning, not a fatal error, since Supabase sometimes restricts
# this even for the project's own "postgres" role. The main data dump above
# is the critical artifact and must not be blocked by this.
if pg_dumpall --globals-only --dbname="$SUPABASE_DB_URL" --file="$GLOBALS_FILE" 2> >(grep -v "password" >&2); then
  echo "   globals: $(wc -l < "$GLOBALS_FILE") lines"
else
  echo "   WARNING: pg_dumpall --globals-only failed (likely insufficient privilege on this managed project)." >&2
  echo "   Continuing: the schema/data dump above is unaffected." >&2
  echo "-- pg_dumpall --globals-only failed during backup; see workflow log" > "$GLOBALS_FILE"
fi

cat > "${BASENAME}.manifest.json" <<EOF
{
  "backup_version": "1.0",
  "system": "B2P CRM Supabase database backup (schema, data, functions, triggers, RLS policies, roles)",
  "generated_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "dump_file": "${DUMP_FILE}",
  "globals_file": "${GLOBALS_FILE}",
  "note": "Does NOT include Supabase Storage file bytes or project-level configuration (Auth providers, API settings, Edge Function code/secrets). See docs/DATABASE_BACKUP.md."
}
EOF

echo "== Archiving and compressing =="
tar -czf "$ARCHIVE" "$DUMP_FILE" "$GLOBALS_FILE" "${BASENAME}.manifest.json"
rm -f "$DUMP_FILE" "$GLOBALS_FILE"

echo "== Encrypting (GPG, AES-256 symmetric) =="
gpg --batch --yes --pinentry-mode loopback \
  --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  --symmetric --cipher-algo AES256 \
  --output "$ENCRYPTED" "$ARCHIVE"
rm -f "$ARCHIVE"

sha256sum "$ENCRYPTED" | awk '{print $1}' > "$CHECKSUM_FILE"
LOCAL_SHA="$(cat "$CHECKSUM_FILE")"
echo "   encrypted: $(du -h "$ENCRYPTED" | cut -f1), sha256=${LOCAL_SHA}"

echo "== Ensuring the Drive destination folder exists =="
rclone mkdir "gdrive:${DRIVE_BACKUP_FOLDER}"

echo "== Uploading =="
rclone copyto "$ENCRYPTED" "gdrive:${DRIVE_BACKUP_FOLDER}/${ENCRYPTED}" --checksum
rclone copyto "$CHECKSUM_FILE" "gdrive:${DRIVE_BACKUP_FOLDER}/${CHECKSUM_FILE}"

echo "== Verifying upload by re-downloading and re-hashing (not trusting the provider's own hash alone) =="
rclone copyto "gdrive:${DRIVE_BACKUP_FOLDER}/${ENCRYPTED}" "verify-${ENCRYPTED}"
REMOTE_SHA="$(sha256sum "verify-${ENCRYPTED}" | awk '{print $1}')"
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "VERIFICATION FAILED: local sha256 ($LOCAL_SHA) != re-downloaded remote sha256 ($REMOTE_SHA)" >&2
  echo "The previous backup on Drive has NOT been touched. Nothing to retire." >&2
  exit 1
fi
echo "   verified: re-downloaded file matches (sha256=${REMOTE_SHA})"

echo "BACKUP_VERIFIED=true" >> "${GITHUB_OUTPUT:-/dev/null}" 2>/dev/null || true
echo "BACKUP_FILENAME=${ENCRYPTED}" >> "${GITHUB_OUTPUT:-/dev/null}" 2>/dev/null || true

echo "== Applying retention (30 daily / 12 weekly / 12 monthly) - only reached after verified upload =="
"$(dirname "${BASH_SOURCE[0]}")/apply_retention.sh"

echo "== Done =="
