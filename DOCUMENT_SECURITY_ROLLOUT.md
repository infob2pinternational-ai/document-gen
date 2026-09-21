# Document approvals and reliable saves

This change covers CRM/document permissions, complete document saves, public document access, and visible failure messages. Vehicle booking conflicts and accounting transactions are separate work.

## Review of the latest app updates

Reviewed main through `407716f` (new locations, sub-districts, Marketing, vehicle options, form preservation, and lead ordering). These features are retained.

Confirmed bugs repaired:

- Reading a lead list could renumber established records and write the changes back in the background. Reads now leave numbers untouched. Supabase assigns numbers with a serialized per-company counter and a unique index, instead of trusting each browser's cached maximum.
- The one-time database repair changes only missing/blank numbers and extra copies of duplicate numbers. It preserves valid unique numbers, keeps the oldest duplicate's number, records old/new numbers in `lead_number_repairs`, and updates linked CRM quotation/follow-up references. Gaps are not reused.
- Missing-column retries silently dropped fields while reporting successful saves. These now show the database error so the migration can be installed without losing fields.
- Clearing a sub-district could restore the old cached value. Explicit clears now reach Supabase and remain clear after refresh. Other optional text fields can also be cleared.
- The vehicle dropdown's recognized-value list included values it did not display. Old values now remain editable as custom specifications, and changing the service clears an incompatible previous specification.
- The security integration preserves the new form-preservation behaviour: a transient permission-refresh failure warns without unmounting an already-open editor. Confirmed revoked access still blocks the app.

## Behaviour

- Supabase maintains office roles in protected `app_members` and company assignments in `app_company_members`. Browser-editable user metadata does not grant permissions.
- The migration provisions the four confirmed office accounts shown in the supplied account report: Sarath as owner, Franson as admin, and Brutf/Sivasatheesan as staff. The unconfirmed test account is not provisioned. Initial access covers the existing company profiles; the owner can access all companies. Future users need explicit database provisioning.
- Only the owner can approve/reject documents, including tax invoices, non-tax invoices, quotations, and comparison invoices/quotations. CRM quotation approvals follow the same rule.
- All document edits return the document to pending approval, including edits made by the owner. Approval is a separate action.
- A single transaction saves document metadata, line items, and comparison options. Failure rolls back the whole transaction. The browser cache updates after server confirmation.
- Direct document/item/comparison writes from authenticated browsers are disabled. Deletion uses a transaction and requires owner/admin access. Backup restoration requires the owner, restores each document through the transaction, and returns an explicit count on partial failure. Restored documents require approval again.
- Approved `/doc/<UUID>` links remain available to anyone holding the link. Pending, rejected, and deleted documents are unavailable. Editing an approved document makes its link unavailable until reapproval. Predictable `/q/<document-number>` public lookups are disabled; resend a UUID link instead.
- Public previews return the saved comparison options in the same response. They return a fixed set of display fields, not full database rows or internal permissions.
- Refresh failures show a warning; failed saves retain the editor. A configured cloud app cannot report an offline document save as successful.

## Rollout order

1. Apply the code patch on a branch based on current `main`; push and open its pull request.
2. Arrange a short pause in document/lead editing. In the **live app's Supabase SQL Editor**, run `database/migrations/20260921000003_document_security_and_leads.sql`. The earlier `20260918000000_live_crm_fields.sql` migration must already be installed. This combined migration also ensures the new `sub_district` and `lead_number` columns exist.
3. After SQL succeeds, merge the pull request and wait for Vercel to finish deploying. **Old clients cannot save documents between the SQL change and the new deployment.** Do not re-run old permissions migrations to bypass this.
4. Hard-refresh desktop browsers and update the mobile app before using it. The current role is fetched from Supabase after login and when the app regains focus.
5. Run the live checks below. No production SQL, merge, or deployment was performed while preparing this patch.

The SQL runs inside a transaction and aborts if the confirmed owner account is missing. This helps prevent installation in the wrong Supabase project. It preserves records. Re-running it does not restore removed memberships or change existing roles.

## Live checks

1. Staff creates a quotation and an invoice. Both appear for the owner under the same company; staff has no approve buttons.
2. Open each pending UUID link in an incognito window: it must be unavailable.
3. Owner approves both. Refresh incognito: saved items and amounts should appear.
4. Repeat with a comparison quotation/invoice: options and amounts should appear.
5. Staff edits an approved document: it returns to pending and its public link becomes unavailable until the owner approves again.
6. Disconnect the network while editing. Save must report failure and retain the editor. Reconnect and retry.
7. Change a lead/follow-up on one account. The owner should see it after the next refresh; the same company must be selected. Network failures should show the stale-data warning.
8. Create leads from two staff accounts, confirm distinct numbers, then refresh both accounts. Existing numbers should stay unchanged. Clear a sub-district, save, and verify the cleared field on the other account.

## Validation and limits

Automated tests execute the migration against PGlite (PostgreSQL) using column definitions and constraints from the supplied production schema report, with synthetic records. They check database permissions, transaction rollback, approval reset, public access, comparison data, and membership revocation. Client tests cover cache integrity after failure and refresh warning recovery. Desktop and mobile production builds are checked separately.

This does not prove the deployed database has no additional legacy SECURITY DEFINER functions or permissions outside the supplied schema report. It does not replace a live test with staff and owner sessions. It does not change the separate finance or booking transaction workflows.

To inspect office access in Supabase SQL Editor:

```sql
SELECT u.email, m.role, m.active, c.company_id
FROM public.app_members m
JOIN auth.users u ON u.id=m.user_id
LEFT JOIN public.app_company_members c ON c.user_id=m.user_id
ORDER BY u.email, c.company_id;
```

Company assignments produce one result per company; repeated email rows here do not mean duplicate login accounts.
