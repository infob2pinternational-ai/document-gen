# Admin operational access

Admin has Owner-level operational UI/API access, including detailed staff reports,
email workspace, follow-up review, backup restore, and mobile pending-document viewing.
Document and quotation approval/rejection remain Owner-only. Admin must not be
promoted to Owner or be allowed to change their own app_members role.
Existing company filtering and personal mailbox ownership rules still apply.

## Database step outstanding

The live Supabase connection rejected even read-only schema inspection during this
change. No production SQL was executed. Review `docs/setup/admin-operational-access.sql`
against the live schema before applying it to project `veyqcjlagjprjgfrgoqk`.
It extends the existing company-membership helper to active Admin users and permits
notification-device configuration. It does not alter approval functions or triggers.
Until applied, Admin still requires existing company membership and device settings
may remain Owner-only. Application deployment alone does not complete database parity.

Tests exercise the proposal against the repository's production-schema fixture,
including denial of Admin document/quotation approval and self-promotion. This is
not verification of the live database. After applying, verify both company profiles,
report/email/review screens, and approval denial using an Admin session.
