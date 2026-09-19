# S-Books Online: read-only milestone

SQLite remains the working database. The private `/books` view in hosted-payments
reads a separate Supabase mirror. It does not write bookkeeping records, send
emails, create recurring transactions, or change existing hosted payment tables.
Backups and online sync have independent on/off controls.

## Connect production

1. Apply `supabase/online-books.sql` in the sbooks-prod SQL Editor. The SQL adds
   books_workspaces, books_members, books_records, three restricted RPCs, and RLS.
2. Deploy the updated hosted-payments app using its existing deployment process.
   Supply NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
   The `/books` client uses the public key plus the signed-in user's session,
   never a secret/service key. Keep email confirmation enabled in Supabase Auth.
3. At `/books`, the owner creates an account as `steve@cncpowder.com`, confirms
   the email, then signs in. Account creation alone grants no books access.
4. Restart local S-Books. In Business Profile > S-Books Online, enter the owner's
   confirmed email and choose Connect workspace. Workspace ownership is resolved
   to that confirmed Supabase user by a service-only RPC. Existing owners cannot
   be reassigned through this operation.
5. Choose Sync now. The local process uploads and reads back every mirrored record
   before recording success. Then enable automatic sync (checks every minute while
   the server runs). Refresh `/books` to see the confirmed copy.

## Deploy to Render

The online app is a Next.js web service. Supabase remains the database and
authentication provider; Render only serves the web app.

1. In Render, select **New +** then **Blueprint** and connect this GitHub repo.
   Render reads `render.yaml` from the repository root and creates
   `sbooks-online` with `hosted-payments` as its root directory.
2. When Render requests them, supply the project URL and publishable key from
   Supabase for `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. After the first deployment, add the Render URL (for example,
   `https://sbooks-online.onrender.com`) to Supabase Auth's allowed redirect
   URLs, then redeploy once.

The app intentionally needs no Supabase service-role key. The browser uses the
publishable key and the database's row-level security policies limit every
signed-in user to their workspace.

No cloud data is uploaded automatically until a workspace is connected and sync
is enabled (or Sync now is chosen). Turning sync off preserves local operation,
pending changes, and the last online copy. An in-flight request may complete.

## Data and permissions

The owner can read all mirrored entities. Business members can read customers,
products, documents, line items, and the allowlisted company profile only.
All cashflow entities, including business accounts and archives, are owner-only
for this initial milestone. Membership changes are not exposed in the UI yet.
Unauthenticated users cannot read any books tables. Signed-in clients cannot
write any books tables or call the upload/verification/setup RPCs.

Mirrored documents retain cloud_public_id/payment_url to identify existing hosted
invoices; the sync never republishes or duplicates them. Service credentials,
machine-local settings/paths, and acceptance tokens are excluded. Receipt files
and other attachments are not mirrored by this milestone. Monetary values keep
the current SQLite representation; no new financial calculations run on upload.

## Sync guarantees and current limits

SQLite triggers queue changes in the original write transaction, including deletes.
Initial sync captures existing records. A persistent UUID mapping preserves local
IDs and supplies sync IDs. A captured complete snapshot is retained until cloud
acknowledgement AND payload verification, so interrupted requests retry the same
revision and do not lose edits made during upload.

The cloud applies one snapshot atomically and marks missing records as deleted.
Only its paired SQLite source can advance a workspace. Older revisions are refused
and require review; do not force-reset a restored laptop's revision to overwrite
a newer cloud copy. Current transport uploads a whole small dataset per changed
revision; incremental batches are deferred until the two-way stage. Event history
and deletion records are retained without automatic pruning in this milestone.

The online viewer paginates all records and checks the revision before and after
loading so a mid-load upload cannot silently mix snapshots. Sync errors remain
visible locally; the online page shows the last successful cloud timestamp.

Two-way editing, user-driven conflict resolution, attachment sync, and automatic
receipt integration are later milestones. The online app now mirrors the local
Business Books pages and Cashflow Planner paycheck timeline, including daily
balances, exact-payday credit-card snapshots, month navigation, and light/dark
themes. Editing/sending/import actions remain disabled. Document selection,
customer/product inspection, invoice report filtering and CSV export work online.
Planner anchor/horizon/paycheck-account settings are included only in owner-scoped
account records. The browser projection is parity-tested against Flask, including
archived-period balance carryover and missing-card snapshots.

## Verification

Run `python -m unittest discover -s tests` and `npm run build` in hosted-payments.
Before production sign-off, apply the SQL, verify anonymous/nonmember/business-
member/owner RLS separately, perform first sync, compare documents and balances,
and confirm a local edit and deletion appear only after successful upload.
Local tests/mocked browser checks do not establish production RLS correctness.
