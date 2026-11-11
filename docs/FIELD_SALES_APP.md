# Field Sales: the application

How the Field Sales screens work, where the code is, and how to test them.
The database side (migrations, rollback, security) is in
`database/FIELD_SALES_DEPLOYMENT.md`.

## Who sees what

Which screens appear is decided from the role returned by `current_app_role()`.
That is a display decision only: every read and write is authorised by the
database from the signed-in session.

| Role | Web app (`/billing/`) | Mobile app (B2P ONE) |
|---|---|---|
| `sales` | Salesperson screens only. No office CRM. | Salesperson screens only. |
| `owner`, `admin` | Office CRM plus **Field Visits** in the sidebar (Workspace). | Existing tabs plus a **Visits** tab. |
| `staff` | Office CRM, unchanged. No Field Visits item. | Unchanged. |

A salesperson can use either the phone's browser or the Android app; both show
the same screens from the same code.

## Salesperson screens

`src/components/fieldsales/FieldSalesApp.tsx`

- **Dashboard.** Counts for: on this phone (drafts and unsent), pending review,
  needs correction, approved, rejected, all. Tapping a count filters the list.
  "Recent activity" lists visits newest first with their status and any office
  note. A large **New visit** button.
- **New visit form.** Business name and phone (required), contact person,
  location, requirements (Website, Billing Software, CRM, Attendance Software,
  Other), other requirement, estimated budget, remarks, next follow-up date.
  **Save draft** keeps it on the phone. **Submit visit** sends it.
- **Visit detail.** Everything entered, status, office note, history. A visit
  sent back by the office has **Correct and resubmit**.

## Offline behaviour

`src/services/fieldVisitService.ts` (`FieldVisitStore`)

- A visit is written to the phone before anything is sent. Each visit has an
  id created on the phone that never changes.
- Unsent visits are sent when the app opens, when the connection returns, when
  the app comes back to the foreground, every minute, and on **Send now**.
- The server treats a repeated id as the same visit, so retries (including
  after a lost reply) never create a second record. Only one send runs at a time.
- If there is no connection or the login has expired, the visit stays
  "Waiting to send".
- If the server refuses a visit, it stays on the phone marked "Not sent" with
  the reason, and can be corrected and sent again. Nothing is deleted unless
  the salesperson deletes it.
- Unsent visits are stored per user. Signing out does not remove them, and
  another person signing in on the same phone cannot see or send them.
- Opening the app with no connection works for a salesperson who was signed in
  on that phone and verified within the last 7 days. This only opens the
  screens; nothing can be sent until they are online and signed in.
- **Sign out** always signs the phone out, even with no connection.

## Office review screen

`src/components/fieldsales/FieldVisitReview.tsx`

- List of visits with filters: status, salesperson, company, date range, and
  search by business name, contact or phone.
- Opening a visit shows details, possible duplicates and history.
- **Approve**, **Reject** (reason required), **Request correction** (note required).
- **Convert to lead** on an approved visit: choose the assignee (defaults to
  you, from `field_visit_assignees`) and an optional follow-up date. If the
  phone number already belongs to a lead, nothing is created; the matching
  leads are shown with **Link to this lead**, or **Create a new lead anyway**.
- After conversion the CRM's lead and follow-up lists are refreshed, so the
  new lead appears in Leads with its timeline.

## Database functions used

The app never writes to the field-visit tables or to `leads` for this workflow.

| Action | Function |
|---|---|
| Companies a salesperson may use | `my_field_sales_companies()` |
| Submit, edit before review, resubmit after correction | `save_field_visit(jsonb)` |
| Approve, reject, request correction | `review_field_visit(uuid, text, text)` |
| Staff who can be assigned | `field_visit_assignees(uuid)` |
| Create or link a lead, with optional follow-up | `convert_field_visit_to_lead(...)` |
| Lists and history | `SELECT` on `field_visits` and `field_visit_events` (row-level security) |

## Files

| File | Purpose |
|---|---|
| `src/services/fieldVisitService.ts` | Types, validation, error handling, Supabase calls, offline outbox |
| `src/components/fieldsales/FieldSalesApp.tsx` | Salesperson dashboard, form and detail |
| `src/components/fieldsales/FieldVisitReview.tsx` | Office review and conversion |
| `src/components/fieldsales/fieldSalesGate.ts` | Which screens to show; device sign-out |
| `src/components/fieldsales/fieldSalesText.ts`, `fieldSales.css` | Labels and styles |
| `src/App.tsx`, `src/components/Sidebar.tsx` | Web: role gate, route, menu item |
| `src/mobile/OwnerApp.tsx`, `roles.ts`, `components/BottomNav.tsx` | Mobile: role gate, Visits tab |
| `src/types.ts`, `LeadModal.tsx`, `Leads.tsx`, `Reports.tsx` | `field_visit` lead source |

## Tests

None of these connect to Supabase or any remote service.

```bash
npm test
```

```bash
npx playwright test --config playwright.field-sales.config.ts --trace off
```

```bash
tests/helpers/with-local-postgres.sh node --test tests/field-sales-db.test.mjs tests/field-sales-concurrency.test.mjs
```

- `tests/field-sales-service.test.mjs`: validation, the outbox, and the full
  workflow through the real client code against the database functions in an
  in-memory Postgres.
- `tests/field-sales-salesperson.e2e.ts` (phone-sized browser) and
  `tests/field-sales-office.e2e.ts` (desktop browser): the real screens. The
  browser's Supabase requests are answered from an in-memory Postgres with the
  live-shaped schema and both migrations applied, so the real functions and
  row-level security answer them.

## Before internal use

1. Apply the two database scripts in order (`database/FIELD_SALES_DEPLOYMENT.md`,
   parts B then A). Until then the Field Visits screen says Field Sales is not
   switched on, and no `sales` account can exist.
2. Deploy the web app.
3. Create salesperson accounts ("Adding a salesperson" in the database guide).
4. For the Android app: `npm run cap:sync`, build in Android Studio, install.

## Known limits

- The Android build has not been run or tested on a device here.
- The browser tests do not go through Supabase's own API layer or Realtime.
- The review list is not live: use **Refresh** to see new submissions.
- The web app signs out after 30 minutes without activity (existing behaviour).
  Unsent visits are kept and sent after signing in again.
- Unsent visits are stored unencrypted in the phone's app storage.
- No photo, GPS or map capture.
