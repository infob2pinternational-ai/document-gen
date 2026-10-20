# One Email window, multiple accounts

## Implemented locally

Communication → Email, visible only to the verified CRM Owner. Add/edit account connections, switch inboxes, paginate, open plain-text messages, compose, and reply from the selected account. The form records IMAP and SMTP settings; there is no campaign or bulk-send workflow.

The supplied ZIP only implemented outbound SMTP. Reading mail requires IMAP, so this module uses a native CRM interface with IMAP/SMTP server code rather than importing its campaign screens or unscoped APIs.

No live mailbox has been contacted and no email has been sent during implementation. No database changes or deployments have been performed.

## Required setup before use

1. Review `docs/setup/email-workspace.sql` against the actual CRM schema, specifically `profiles(id)` and `auth.users(id)`. This SQL is a proposal, not an applied migration. It adds separate credential and send-claim tables; it does not copy the old sender's tables/data.
2. After explicit approval, apply the reviewed setup to the chosen CRM database. Existing setup errors are shown in the UI instead of empty inboxes.
3. Configure server-only environment values on the deployment platform:
   - `SUPABASE_URL` (or the existing `VITE_SUPABASE_URL`) and existing anon key for session/company validation.
   - `SUPABASE_SERVICE_ROLE_KEY` for the server-only tables.
   - `EMAIL_ENCRYPTION_KEY`: a cryptographically random 32-byte key represented by 64 hexadecimal characters. Keep a secure backup. Changing it requires re-entering saved passwords. Never expose it through a `VITE_` variable.
   - `EMAIL_ALLOWED_HOSTS`: comma-separated exact hostnames approved for IMAP/SMTP (for example, the hostnames in your provider's account settings). Wildcards, URLs and private/network-local destinations are not accepted. Only public IPv4 destinations are supported in this version.
4. After a separately approved deployment, open Email as the Owner and add the desired account settings. Use the provider's app password if required. Do not paste passwords or keys into chat.
5. Verify against a disposable mailbox first, including inbox reading and one explicitly approved test message. Then add business accounts.

## Behavior and limits

- TLS IMAP on 993. SMTP TLS on 465 or required STARTTLS on 587. Certificate verification stays enabled.
- Supported where the provider permits IMAP/SMTP with a password or app password. Google/Microsoft OAuth is not included; accounts that require OAuth cannot connect yet.
- Accounts and credentials are scoped to the selected company and access is Owner-only, following the existing server `requireOwner` / `requireCompanyAccess` checks. Shared staff access requires a separate permission decision.
- Passwords are encrypted with AES-256-GCM and bound to company/account IDs. Passwords and ciphertext never appear in account-list responses. No protocol logs are enabled.
- Inbox pages contain 25 messages. Reading uses read-only IMAP and does not mark messages read, delete, or move them. UID validity protects against opening a recycled message identifier.
- Plain-text display only, with a 2 MB source-message limit. Attachments, folders, search, OAuth, push synchronization and automatic Sent-folder copies are not included.
- SMTP acceptance is not proof of delivery. Check provider webmail for Sent-folder behavior; SMTP does not itself guarantee a Sent copy.
- Every send uses a durable claim keyed by a request UUID. A repeated claim never invokes SMTP again. Connection failures before sending are marked failed. Ambiguous transport or post-send storage failures are held as uncertain/sending, and the UI does not offer automatic resend.
- Removing an account deletes its stored connection/passwords and preserves send-claim history. It does not delete mailbox messages at the provider.
- No mailbox content is retained in the CRM database; only account configuration and send-attempt status are stored.

## Local validation

Tests stub authentication, the repository, DNS and IMAP/SMTP. No test should use real account credentials. Run `node --test tests/email-workspace.test.mjs`, then `npm run build`.

## Gmail, Zoho and cPanel presets

The account form includes Gmail, Zoho Personal, Zoho Paid Organization and cPanel/manual options. Presets populate hostnames/ports and use the full email address as the default username. Hostnames remain editable for regional Zoho accounts and hosting-specific cPanel certificates. Switching providers clears entered passwords; changing a stored server/username requires a fresh password rather than reusing a secret against another destination.

| Provider | Incoming default | Outgoing default | Account-specific requirements |
| --- | --- | --- | --- |
| Gmail | `imap.gmail.com:993` | `smtp.gmail.com:465` | This version supports app passwords only where the account permits them. Two-Step Verification is required for Google app passwords; Workspace policy or Advanced Protection may prevent their use. OAuth is not implemented. |
| Zoho Personal / eligible free account | `imap.zoho.com:993` | `smtp.zoho.com:465` | Confirm IMAP eligibility and enable IMAP. Use an app-specific password where required. |
| Zoho paid organization | `imappro.zoho.com:993` | `smtppro.zoho.com:465` | These are .com defaults, not regional detection. Copy exact hosts from the account's Server Configuration Details. |
| cPanel | Copy SSL/TLS host from Connect Devices, port 993 | Copy SSL/TLS host from Connect Devices, port 465 | Use the mailbox username/password. The hostname can be the hosting server name instead of `mail.yourdomain`. |

Approve the exact chosen hosts in `EMAIL_ALLOWED_HOSTS`; provider presets do not bypass that check. Do not assume the user's location determines the Zoho data center.

Official references checked during implementation:
- https://developers.google.com/workspace/gmail/imap/imap-smtp
- https://support.google.com/accounts/answer/185833?hl=en
- https://www.zoho.com/mail/help/imap-access.html
- https://docs.cpanel.net/cpanel/email/set-up-mail-client/
