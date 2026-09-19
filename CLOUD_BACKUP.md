# S-Books cloud recovery

Business Profile contains Automatic cloud backups, Back up now, last verified
backup status, and Download verified backup. Restart S-Books after installing
this update. The worker starts on the first page request and checks every minute;
when enabled it attempts a backup every 15 minutes while the server is running.
Turning it off stops future automatic attempts; an in-progress upload may finish.
Manual backups remain available. Internet failures retry on the next interval.

The saved Supabase connection is used with a dedicated PRIVATE bucket named
`sbooks-private-backups`. Do not add public or general authenticated-user access
policies to this bucket. Every upload has a unique dated name. Earlier versions
are retained (no automatic pruning yet); monitor Storage usage in Supabase.
This is disaster recovery, not two-way record synchronization.

Each ZIP contains a transactionally consistent SQLite snapshot, a checksum and
row-count manifest, and the configured company logo if available. It contains
financial/customer data and must remain private. SMTP passwords, secret keys,
and tokens are removed from the snapshot and must be re-entered after recovery.
Other local files outside the database and logo are not included. Receipts already
stored in cloud storage are not copied into these snapshots.

Success is recorded only after downloading the upload, comparing its checksum,
and opening a separate restored database to check integrity and table counts.
Never assume a failed or pending backup protects the latest edits.

## Recovery without the original laptop

1. Sign in to Supabase with your independent account credentials. Open the
   project's Storage area, then `sbooks-private-backups`. Download the desired
   dated ZIP. Access to Supabase must not depend solely on the lost laptop.
2. Install S-Books and its requirements on the replacement computer.
3. Run `python restore_backup.py path/to/backup.zip C:/sbooks-recovered`.
   The destination must not already exist; live data is never overwritten.
4. In PowerShell, set `$env:CASHFLOW_DB='C:/sbooks-recovered/cashflow.db'`, then
   run `python app.py` from the S-Books project folder. Verify balances/documents.
5. Re-enter service credentials in Business Profile and re-enable cloud backups.

Backups are additive; existing hosted invoice/payment tables are untouched.
