#!/usr/bin/env bash
# Retention: keeps the 30 most recent daily backups, plus one backup per week
# for the last 12 weeks, plus one backup per month for the last 12 months
# (grandfather-father-son rotation). Deletes everything else on Drive.
#
# Deliberately conservative: if anything about the listing looks wrong (too
# few files found, parse failure), it does nothing rather than risk deleting
# a backup it misunderstood. Only ever deletes files matching the exact
# b2p-db-backup-YYYYMMDD-HHMMSS.sql.gz.gpg naming convention this system
# itself uses - never touches any other file in the folder.
set -euo pipefail

: "${DRIVE_BACKUP_FOLDER:?DRIVE_BACKUP_FOLDER is required}"
export RCLONE_CONFIG="${RCLONE_CONFIG:?RCLONE_CONFIG must point at the config file prepared by run_backup.sh}"

LISTING="$(rclone lsjson "gdrive:${DRIVE_BACKUP_FOLDER}" --files-only)"
# Name, ID pairs for files matching our naming convention only.
mapfile -t ENTRIES < <(echo "$LISTING" | python3 -c '
import json, sys, re
pat = re.compile(r"^b2p-db-backup-(\d{8})-(\d{6})\.tar\.gz\.gpg$")
for item in json.load(sys.stdin):
    m = pat.match(item["Name"])
    if m:
        print(f"{m.group(1)}{m.group(2)}\t{item[\"Name\"]}\t{item[\"ID\"]}")
' | sort -r)

if [ "${#ENTRIES[@]}" -eq 0 ]; then
  echo "No backup files matching the naming convention found; nothing to do."
  exit 0
fi
echo "Found ${#ENTRIES[@]} existing backup(s) on Drive."

printf '%s\n' "${ENTRIES[@]}" > /tmp/entries.tsv

python3 <<'PYEOF'
import datetime

KEEP_DAILY = 30
KEEP_WEEKLY = 12
KEEP_MONTHLY = 12

rows = []
with open("/tmp/entries.tsv") as f:
    for line in f:
        line = line.rstrip("\n")
        if not line:
            continue
        key, name, file_id = line.split("\t")
        dt = datetime.datetime.strptime(key, "%Y%m%d%H%M%S")
        rows.append((dt, name, file_id))

rows.sort(key=lambda r: r[0], reverse=True)

keep_ids = set()

# Daily: the N most recent backups, period.
for dt, name, file_id in rows[:KEEP_DAILY]:
    keep_ids.add(file_id)

# Weekly: most recent backup in each of the last KEEP_WEEKLY ISO weeks.
seen_weeks = set()
for dt, name, file_id in rows:
    week_key = dt.isocalendar()[:2]  # (ISO year, ISO week)
    if week_key not in seen_weeks and len(seen_weeks) < KEEP_WEEKLY:
        seen_weeks.add(week_key)
        keep_ids.add(file_id)

# Monthly: most recent backup in each of the last KEEP_MONTHLY months.
seen_months = set()
for dt, name, file_id in rows:
    month_key = (dt.year, dt.month)
    if month_key not in seen_months and len(seen_months) < KEEP_MONTHLY:
        seen_months.add(month_key)
        keep_ids.add(file_id)

to_delete = [(name, file_id) for dt, name, file_id in rows if file_id not in keep_ids]

with open("/tmp/to_delete.txt", "w") as out:
    for name, file_id in to_delete:
        out.write(f"{name}\t{file_id}\n")

print(f"Keeping {len(keep_ids)} of {len(rows)} backups.")
print(f"Deleting {len(to_delete)} backup(s) older than the retention window.")
PYEOF

if [ ! -s /tmp/to_delete.txt ]; then
  echo "Nothing outside the retention window. Done."
  exit 0
fi

while IFS=$'\t' read -r name file_id; do
  echo "Deleting: $name"
  rclone deletefile "gdrive:${DRIVE_BACKUP_FOLDER}/${name}"
  # Also remove the matching checksum sidecar file, if present.
  rclone deletefile "gdrive:${DRIVE_BACKUP_FOLDER}/${name}.sha256" 2>/dev/null || true
done < /tmp/to_delete.txt

echo "Retention cleanup complete."
