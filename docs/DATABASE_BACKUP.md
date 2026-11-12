# Supabase database backup: setup, operation, restore

Automated, encrypted, daily backups of the production Supabase Postgres
database to Google Drive, via a GitHub Actions scheduled workflow.
**Completely separate from, and does not touch,** the existing
`documents`-only Google Drive sync in `src/services/db.ts`
(`syncBackupToGoogleDrive`) / Settings page - that stays as-is.

## What this backs up, and what it does not

**Backed up** (`pg_dump` of the live schema, run against the direct
connection, `--schema=public --schema=auth --schema=storage
--schema=b2p_migration_internal --schema=field_sales_internal`):

- Every table's schema and data in `public` - all CRM tables (leads,
  follow_ups, customers, documents, telecalling_entries, field_visits,
  financial tables, bookings, Google Sync tables, etc.) and the
  `b2p_migration_internal` / `field_sales_internal` internal schemas used
  by this repository's migration-registry pattern.
- Every function, trigger, and RLS policy on those tables (these are
  ordinary catalog objects; a schema dump always includes them).
- `auth.*` tables, **including `auth.users`** - Supabase Auth user records
  live in Postgres, in this same database, so a schema-inclusive `pg_dump`
  captures them. This captures the **rows** (email, hashed password,
  metadata, identities, MFA factor rows, etc.).
- `storage.*` tables - this is **metadata only** (bucket and object rows:
  names, sizes, paths, owner), not the uploaded file bytes themselves. See
  below.
- Cluster-level **roles** (CREATE ROLE statements, role memberships) via a
  separate `pg_dumpall --globals-only` run. Supabase sometimes restricts the
  project's own `postgres` role from reading `pg_authid`; if so, this step
  logs a warning and continues rather than failing the whole backup - the
  schema/data dump is the critical artifact.

**NOT backed up by this workflow - do not assume otherwise:**

- **Supabase Storage file bytes.** If this project starts using Storage
  buckets for uploads (a repository-wide search at the time this was
  written found no `supabase.storage` usage - see "Repository findings"
  below), those files are **not** included. `storage.objects` rows point
  at files that live in Supabase's S3-backed storage, not in Postgres.
  Backing those up would need a separate step using the Storage API to
  list and download every object; add that as its own job if/when Storage
  is actually used, rather than building it speculatively now.
- **Project-level configuration**: Auth provider settings (OAuth app
  credentials, email templates, redirect URLs), API settings (exposed
  schemas, rate limits), Edge Function code and secrets, custom domains,
  webhooks. None of this lives in the database; it lives in Supabase's own
  control plane and would need to be captured separately (e.g.
  screenshots/exports of the relevant dashboard settings pages) if you want
  it recoverable.
- **The Vercel deployment itself** (application code is already backed up
  by being in this Git repository and its history; environment variables
  are not - see `database/FIELD_SALES_DEPLOYMENT.md` and earlier security
  review notes for the existing concern about verifying those).

## Repository findings (read before changing anything here)

- **Production project**: `rqovkmjsdwzggebvwvdk` (name "generator",
  region `ap-southeast-2`, Postgres 17.6). Confirmed earlier in this
  engagement by checking the account's Supabase projects list (the only
  other project, `b2p-bulk-mail`, is `INACTIVE` and unrelated) and by
  finding this project's ref hard-coded as the only `*.supabase.co` string
  in the production Vercel deployment's built JS bundle. **Do not point any
  secret in this backup system at a different project.**
- **Existing Drive backup**: `src/services/db.ts`'s
  `syncBackupToGoogleDrive`, wired to Settings and a Saturday-evening
  reminder in `App.tsx`. It POSTs the in-browser `documents` array to a
  Google Apps Script Web App URL (stored per-company as
  `profiles.google_sheets_url`), which writes JSON files into a "B2P
  Document Backups" Drive folder. It is **client-triggered** (a button a
  human must click, or a reminder they can dismiss), **not scheduled**,
  and covers **only the `documents` table** - confirmed by opening the most
  recent full snapshot it had written and finding exactly one top-level key,
  `documents`. This system is independent of, and does not replace, that
  one.
- **No Supabase Storage usage found** in `src/` or `api/` (searched for
  `supabase.storage`, `.storage.from(`, `createSignedUrl`, `storage.upload`).
  If that changes, extend this backup (see above) rather than assuming the
  schema/data dump already covers it.
- **No existing GitHub Actions workflows** in this repository prior to this
  change (`.github/workflows/` did not exist).
- **Supabase CLI is not available** in the environment this backup system
  was developed in, and is not required to run it - the GitHub Actions job
  installs `postgresql-client-17` (matching the production server's major
  version) directly from the PGDG apt repository, plus `rclone` for the
  Drive upload.

## How it works

1. `scripts/backup/run_backup.sh` (run by `.github/workflows/supabase-backup.yml`):
   - `pg_dump` the schemas listed above, plus `pg_dumpall --globals-only`
     for roles, into a `.tar.gz`.
   - Encrypts it with GPG (AES-256, symmetric, passphrase-based - no key
     files to manage or lose).
   - Uploads the encrypted file (and a `.sha256` sidecar) to Google Drive
     via `rclone`.
   - **Verifies** the upload by re-downloading the file from Drive and
     comparing its SHA-256 to the one computed before upload - not trusting
     Drive's own reported hash alone. The workflow does not report success,
     and does not run retention cleanup, unless this comparison passes.
   - Only then runs `scripts/backup/apply_retention.sh`.
2. `scripts/backup/apply_retention.sh`: lists files on Drive matching this
   system's own naming convention only
   (`b2p-db-backup-YYYYMMDD-HHMMSS.tar.gz.gpg`), keeps the 30 most recent
   (daily), plus the most recent backup in each of the last 12 ISO weeks
   (weekly), plus the most recent in each of the last 12 months (monthly),
   and deletes the rest. It never touches a file that doesn't match that
   exact naming pattern, and it only runs after a verified upload - a
   failed backup run never deletes a previous valid one.
3. On any failure (dump, encryption, upload, or verification), the workflow
   sends a failure email via Gmail SMTP and exits non-zero. GitHub also
   surfaces failed scheduled-workflow runs in the repository's Actions tab
   and, depending on notification settings, to watchers' own email/GitHub
   notifications.

## Required GitHub Secrets

Set these in **Settings -> Secrets and variables -> Actions -> Secrets**
on the repository (`infob2pinternational-ai/document-gen`):

| Secret | What it is | Where to get it |
|---|---|---|
| `SUPABASE_DB_URL` | Direct (not pooler) Postgres connection URI for `rqovkmjsdwzggebvwvdk`, e.g. `postgresql://postgres:<password>@db.rqovkmjsdwzggebvwvdk.supabase.co:5432/postgres?sslmode=require` | Supabase Dashboard -> Project -> Connect -> "Direct connection" (not "Transaction pooler" / "Session pooler") |
| `BACKUP_ENCRYPTION_PASSPHRASE` | A long random passphrase used to encrypt every backup | Generate once, e.g. `openssl rand -base64 48`. **Store it somewhere durable outside GitHub too** (e.g. a password manager) - if it's lost, existing backups become permanently undecryptable. |
| `RCLONE_CONFIG_B64` | Base64 of an `rclone.conf` containing one remote named `gdrive`, authorized against your Google Drive account | See "Google Drive authentication setup" below |
| `BACKUP_ALERT_SMTP_USERNAME` | A Gmail address to send failure alerts from | Can be the same `info.b2pinternational@gmail.com` account |
| `BACKUP_ALERT_SMTP_PASSWORD` | A **Gmail App Password** for that account (not the normal login password) | Google Account -> Security -> 2-Step Verification -> App passwords |
| `BACKUP_ALERT_EMAIL_TO` | Where failure alerts should be sent | Your choice |

Optional **repository variable** (Settings -> ... -> Variables, not
Secrets, since it's not sensitive): `DRIVE_BACKUP_FOLDER` - the Drive
folder name backups are written into. Defaults to `B2P Database Backups`
if not set.

**Never** put any of the above into a workflow file, a script, or a commit.
The workflow reads them only from `secrets.*` / `vars.*`.

## Google Drive authentication setup (manual - you need to do this)

A GitHub Actions runner has no browser and no way to complete an OAuth
consent screen, so the Drive credential has to be generated once, by you,
on your own machine, and then provided to the workflow as a secret.

1. Install `rclone` on your own computer: https://rclone.org/downloads/
2. Run `rclone config` and follow the prompts:
   - `n` for a new remote.
   - Name it exactly `gdrive` (the scripts assume this name).
   - Storage type: `drive` (Google Drive).
   - Leave `client_id` / `client_secret` blank to use rclone's own (fine for
     personal use; for heavier use you can create your own OAuth client in
     Google Cloud Console instead, same `drive` backend).
   - Scope: `drive` (full access) or `drive.file` (access only to files
     rclone creates - more restrictive, recommended if you want to limit
     blast radius; either works with this system since it only ever reads/
     writes its own backup folder).
   - "Edit advanced config": no.
   - "Use auto config": yes if you're running this on a machine with a
     browser (it will open one for you to sign in and approve access); if
     not, follow rclone's prompts for the remote-auth flow.
   - Root folder / team drive: leave blank unless your Drive setup needs it.
3. Confirm it works: `rclone lsd gdrive:` should list your Drive's folders
   without error.
4. Produce the secret value: `base64 -w0 ~/.config/rclone/rclone.conf`
   (macOS: `base64 -i ~/.config/rclone/rclone.conf`). Copy the output.
5. In GitHub: **Settings -> Secrets and variables -> Actions -> New
   repository secret**, name `RCLONE_CONFIG_B64`, paste the base64 output.
6. **This file contains a live OAuth refresh token for your Google
   account**, equivalent to a password for Drive access. Treat it exactly
   like the other secrets: never commit it, never paste it anywhere but the
   GitHub Secrets form, and revoke it (Google Account -> Security ->
   Third-party access) if you ever suspect it leaked.

## Retention policy

- **30 daily**: the 30 most recent backups, always.
- **12 weekly**: the most recent backup from each of the last 12 ISO weeks.
- **12 monthly**: the most recent backup from each of the last 12 months.

A backup can count toward more than one bucket (e.g. this week's daily
backup is also this week's weekly one) - the script keeps the *union*, so
the true upper bound on stored backups is 30 + 12 + 12 = 54, in practice
fewer once overlaps are accounted for.

## Restore procedure

**Read this before you need it, not during an incident.**

1. Download the encrypted backup file from the `B2P Database Backups`
   Drive folder (or wherever `DRIVE_BACKUP_FOLDER` points).
2. **Create or use an isolated test/staging Supabase project** - never
   restore into production directly, even to "just check" something. If you
   need to recover production data, restore into a staging project first,
   verify it, then decide the exact, minimal change to apply to production
   (e.g. via a reviewed migration), rather than overwriting production
   wholesale.
3. Get that staging project's **direct** connection URI.
4. Run:
   ```bash
   BACKUP_ENCRYPTION_PASSPHRASE='<the passphrase>' \
     scripts/backup/restore_backup.sh /path/to/b2p-db-backup-*.tar.gz.gpg \
     'postgresql://postgres:<password>@db.<staging-ref>.supabase.co:5432/postgres?sslmode=require'
   ```
   The script refuses to run if the target URL contains
   `rqovkmjsdwzggebvwvdk` (production's ref), as a safety check - it is not
   a substitute for using a real staging project.
5. It decrypts, extracts, restores roles (if present in that backup) via
   `psql`, then restores schema + data via `psql`.
6. **Verify** the staging project afterward: row counts on key tables,
   spot-check a few known records, confirm RLS policies exist
   (`select * from pg_policies where schemaname='public'`), confirm the
   application can sign in and load data against it if you point a local
   dev build at it.

### Restore test - do this once, after setting everything up

Before trusting this system, prove it end-to-end:

1. Let (or trigger) one real backup run, and confirm it reports success
   (see "Test report" below for what that looked like when this was built).
2. Create a throwaway Supabase project (any region/plan) purely for this
   test. Do not reuse `rqovkmjsdwzggebvwvdk` or any project with real data.
3. Run `restore_backup.sh` against it, pointed at the backup from step 1.
4. Run the queries in step 6 above against the restored project.
5. Delete the throwaway project when done.

This exact test was **not** run as part of building this system (no
credentials for `SUPABASE_DB_URL`, Drive, or a throwaway project were
available in the environment this was developed in - see "Test report").
It is the first thing to do once the secrets above are configured.

## Monitoring

- Failed runs: email via `BACKUP_ALERT_EMAIL_TO`, plus visible in the
  repository's **Actions** tab (a red ✕ on "Supabase database backup").
- Successful runs: visible in the **Actions** tab (green ✓). This workflow
  does not currently send a "success" notification by design (daily emails
  for routine success tend to get ignored or filtered); add one if you'd
  prefer positive confirmation each day.
- **Check the Actions tab / your Drive folder periodically anyway** -
  silent failures of the notification path itself (e.g. the Gmail App
  Password expiring) are exactly the kind of thing a monitoring system
  can't always catch about itself.
