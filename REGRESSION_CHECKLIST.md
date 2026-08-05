# Regression Checklist — B2P Document Portal

Run through this checklist before every release. Each item maps to a specific
architectural weakness that was found and fixed during the July–August 2026
refactoring work. Skipping an item risks reintroducing the exact class of bug
it was designed to catch.

---

## 1. Duplicate Data Loading

- [ ] `App.tsx` has exactly **one** function (`refreshCompanyData`) that fetches
      documents, customers, and services. No other function in the file does
      `getDocuments`, `getCustomers`, or `getServices` independently.
- [ ] `Customers.tsx` has **no** `useState` for a customer list and **no**
      `useEffect` that calls `dbService`. It renders from `preloadedCustomers`
      only.
- [ ] `Services.tsx` has **no** `useState` for a service list and **no**
      `useEffect` that calls `dbService`. It renders from `preloadedServices`
      only.
- [ ] Grep check: `grep -rn "dbService.getDocuments\|dbService.getCustomers\|dbService.getServices" src/components/` returns **zero** results
      (only `src/services/db.ts` and `src/App.tsx` should contain these).

## 2. Duplicate Business Logic

- [ ] Document number generation exists in **one** place only. Neither
      `DocumentEditor.tsx` nor `ComparisonEditor.tsx` computes sequence numbers
      independently — both call the same shared function.
- [ ] Tax/total calculation exists in **one** file (`src/utils/calculations.ts`).
      No component has inline tax math.

## 3. Multiple Sources of Truth

- [ ] `documents`, `customers`, and `services` state variables exist only in
      `App.tsx`. No child component has `useState<Customer[]>` or
      `useState<Service[]>` or `useState<Document[]>`.
- [ ] After saving a customer/service, the child component calls
      `onRefreshCustomers()`/`onRefreshServices()` — never its own fetch.
- [ ] After saving a document, the editor calls `onRefreshDocs()` — never its
      own `getDocuments()`.

## 4. Race Conditions

- [ ] There is **no** `useEffect` that fires on `[activeProfile]` and fetches
      documents/customers/services. (This was the duplicate-fetch race removed
      in Phase 2.)
- [ ] `loadData()` calls `refreshCompanyData()` directly — it does not set
      `activeProfile` and then rely on a separate effect to do the fetch.
- [ ] The Realtime handler merges the event payload locally (`setDocuments(prev => ...)`).
      It does **not** call `getDocuments()`.
- [ ] The `UNIQUE (company_id, document_number)` constraint exists on the live
      database. Verify: run `SELECT conname FROM pg_constraint WHERE conrelid = 'documents'::regclass AND conname = 'documents_company_number_unique';` — must return one row.

## 5. State Synchronization

- [ ] Saving a document on Device A appears on Device B within seconds
      (Realtime subscription, local merge).
- [ ] Approving/rejecting a document on one device updates the other device's
      document list and shows the toast notification.
- [ ] Switching companies in the sidebar immediately loads the correct
      documents, customers, and services — no stale data from the previous
      company visible.

## 6. Database Integrity

- [ ] No duplicate document numbers exist. Run:
      `SELECT company_id, document_number, COUNT(*) FROM documents GROUP BY 1,2 HAVING COUNT(*) > 1;` — must return zero rows.
- [ ] No orphaned document items exist. Run:
      `SELECT COUNT(*) FROM document_items di WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = di.document_id);` — must return 0.
- [ ] No null company references. Run:
      `SELECT COUNT(*) FROM documents WHERE company_id IS NULL;` — must return 0.

## 7. Realtime Synchronization

- [ ] The Realtime subscription in `App.tsx` subscribes to the `documents`
      table filtered by `company_id`.
- [ ] On `INSERT`/`UPDATE` events, the handler merges `payload.new` into
      `documents` state via a functional `setDocuments(prev => ...)` update —
      never a full refetch.
- [ ] On `DELETE` events, the handler removes the deleted row from state.
- [ ] The merge re-sorts by `date` desc, then `created_at` desc — matching
      `getDocuments()`'s sort order.

## 8. Document Numbering

- [ ] Creating a new invoice, quotation, work order, non-tax invoice, and
      comparison quotation each produce the correct prefix and the next
      sequential number.
- [ ] Editing an existing document does **not** change its `document_number`.
- [ ] Two browser tabs creating a document for the same company at the same
      time produce **two different, consecutive** numbers — never a duplicate or
      a database error visible to the user.

## 9. Company / Profile Switching

- [ ] Switching from Company A to Company B shows only Company B's documents,
      customers, and services.
- [ ] Creating a document after switching shows Company B's prefix, not
      Company A's.
- [ ] The sidebar highlights the correct active company.
- [ ] `localStorage` key `docgen_active_profile_id` updates on every switch.

## 10. Offline Mode

- [ ] With no Supabase environment variables configured, the app starts in
      local-storage mode without errors.
- [ ] Creating, editing, and deleting documents/customers/services all persist
      to `localStorage`.
- [ ] The Realtime subscription does not attempt to connect (no console errors).
- [ ] Backup export and restore work entirely from `localStorage`.

## 11. Mobile Behavior

- [ ] The sidebar opens and closes correctly on narrow viewports.
- [ ] Document preview renders and prints correctly on mobile.
- [ ] The line-item modal is scrollable on small screens.
- [ ] Touch interactions (swipe to close sidebar, tap to select) work without
      requiring double-tap.

## 12. Security (RLS / Public Share Links)

- [ ] Shared links (`/doc/:id`, `/view/:id`, `?view=`, `/q/:number`,
      `/#doc=:id`) all render the correct document for anonymous visitors.
- [ ] Anonymous visitors see only the whitelisted fields — no `user_id`,
      `customer_email`, `approved_by_email`, `google_sheets_url`, or
      numbering configuration visible in the network response.
- [ ] An anonymous REST API call to `documents`, `document_items`, `profiles`,
      or `comparison_document_data` returns **zero rows**. Verify:
      `SET ROLE anon; SELECT COUNT(*) FROM documents; RESET ROLE;` — must
      return 0.
- [ ] The `get_public_document()` RPC returns data for a valid ID and `NULL`
      for an invalid one — never an error, never more than one document.
- [ ] All four `*_select_authenticated` RLS policies exist and the old
      `*_select_public` policies do not. Verify:
      `SELECT policyname FROM pg_policies WHERE schemaname='public' AND cmd='SELECT' ORDER BY 1;`

---

## How to Use This Checklist

1. Before merging any PR that touches `App.tsx`, `db.ts`, `DocumentEditor.tsx`,
   `ComparisonEditor.tsx`, `Customers.tsx`, `Services.tsx`, or
   `DocumentPreview.tsx` — run the relevant sections.
2. Before every production deployment — run all sections.
3. If a new component is added that consumes documents, customers, or services,
   add it to the Section 1 grep check and verify it does not have its own fetch.
4. If a new document type is added, add it to Section 8 and verify numbering.
5. If a new RLS policy is added, add it to Section 12 and verify anonymous
   access remains blocked on all tables.
