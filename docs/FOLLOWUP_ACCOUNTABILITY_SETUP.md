# Follow-up accountability setup

Do not deploy the client until a database administrator reviews and applies
`docs/setup/followup-accountability.sql` to the intended environment. The setup is applied separately from client deployment. Existing migration files remain unchanged.
The server requires the existing SUPABASE_SERVICE_ROLE_KEY; never expose it in VITE variables.

Prerequisites: deployed follow_ups uses follow_up_date and follow_up_time, the existing
followup_timeline_version() returns 1, and existing company RLS authorizes task writes.
The setup deliberately aborts if those date/time columns are absent. It does not rename schema.
No additional PostgreSQL version is claimed or required by the inspected project code.

Staff select an outcome and enter a reason when editing the schedule or using Snooze.
Completion requires remarks. The server trigger rejects missing or reused action metadata,
keeps the original due timestamp, and counts only changes that move the actual due time later.
Snoozing a future task to an earlier time is a reschedule, not a postponement.
Existing tasks receive an explicitly unverified baseline; no pre-activation counts are invented.
All due timestamps represent India local time, matching the existing follow-up workflow.

Owner review shows daily completion, postponement, callback, no-answer and not-contacted
counts, plus open tasks postponed at least twice. Consecutive no-contact postponements reset
on a customer callback outcome or completion. Outcomes are staff declarations, not proof of calls.
Daily totals count actions: one task can have more than one legitimate action in a day.

Review state and immutable event rows are separate from normal follow_ups responses.
Authenticated/anonymous roles have no access to these tables. Only the server's review-authorized,
company-checked GET /api/followup-review endpoint returns review information. Owners and the
Auth-confirmed account fransonputhukkara@gmail.com have explicit review access. This does not
grant Franson the Owner role or bypass company checks. Email access alone grants no review access. The staff interface shows normal reason/outcome
fields, without owner counts or flags. This is ordinary task audit history, not device tracking.
Deleted tasks retain audit evidence; tenant retention/deletion policy requires a separate review.

The endpoint paginates private review tables, including when the server caps pages below 500.
The ordinary CRM task loader and its pagination are unchanged. Refresh review manually after
changes; no extra subscription is registered.

Local checks:
```
node --test tests/followups.test.mjs tests/followup-accountability.test.mjs tests/followup-review.test.mjs tests/followup-timeline-db.test.mjs tests/owner-crm.test.mjs tests/production-reliability.test.mjs
npm run build
```
Database checks use synthetic disposable PGlite fixtures. They are not real PostgreSQL
multi-connection concurrency tests or evidence that live schema/setup has been validated.
