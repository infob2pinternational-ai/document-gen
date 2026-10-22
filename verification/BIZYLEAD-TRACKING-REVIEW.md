# Bizylead tracking and callback gate

Base: production document-gen `7809b94954277a218b18c08c976485e5af8dd743`. This branch is for Preview review only. Production activation is blocked.

## Implemented

- No generated provider IDs. Bizylead acceptance requires a nonblank provider response ID; missing IDs, lost responses and server failures remain uncertain. HTTP/request failures do not trigger retries.
- The composer saves its request UUID, text and start time before dispatch, scoped by user/company/conversation. The existing message row ID and X-Request-ID retain that reference. This is traceability, not server-side idempotency.
- Unresolved requests survive reload, editing and explicit text discard, and prevent another send in that scope. Known rejection removes the pending reference while retaining text. Confirmed acceptance clears it without erasing a newer draft. A known provider ID is retained locally if history persistence fails.
- Supabase insert/update errors are checked. Provider acceptance is not erased by a database failure; tracking is flagged for review. No new columns or migrations are required.
- Automatic API-error fallback to manual WhatsApp is removed from the API send path. Explicit manual-link mode remains available. Official-document history is logged only following confirmed acceptance.
- Bizylead POST callbacks fail closed with 503 before body reading, logging or persistence. GET is only an informational ping. The former parser remains dormant until a reviewed, documented verifier and company/event processing are ready.

## Exact blockers

The signed-in dashboard documents text sends at POST /api/v2/whatsapp-business/messages with Bearer authentication and {to, phoneNoId, type:"text", text}. Its webhook editor exposes only Endpoint URL; its event catalogue lists messages/status without a signature/shared-secret specification. There is no established provider callback verification contract. Do not invent Meta HMAC or a custom header.

The existing configured callback points to the public website and returns 404. The website's exact-path rewrite is prepared separately, but must not be published to production (or a preview forwarding POST to the old unauthenticated production receiver) until the receiver is securely activated. No production webhook route or setting is changed by this branch.

Vercel lists production Sensitive variables BIZYLEAD_API_KEY and BIZYLEAD_PHONE_NUMBER_ID. Both values are write-only and cannot be independently compared with the dashboard through the authorized export. Do not interpret unavailable exports as missing runtime values. The dashboard confirms an active key and phone ID 992427143955673; stored runtime equality and live provider authorization remain unverified.

The current backend has no certified durable per-request idempotency or company-scoped transactional callback processing. Local pending intents do not prevent direct API, cross-device or concurrent-tab duplicates. The dormant legacy parser guesses a first company and lacks transactional deduplication/status-order protection; fail-closed gating prevents it from being used by this branch. These must be addressed against the documented event/auth contract and an isolated database before production activation.

Unresolved sends intentionally stay blocked until an operator verifies an existing provider record. No automatic reconciliation or unlock is claimed. Browser-local storage is not encrypted/cross-device, and storage failure pauses new composer dispatch. Real acceptance, delivery and authenticated inbound processing have not been tested.

## Release sequence

1. Obtain provider-owned callback authentication/signature, event-envelope, acceptance-response and retry specifications, plus approved secret configuration if required.
2. Implement and isolate-test verification, explicit company mapping, event uniqueness/transactions and monotonic status handling. Review any necessary schema changes separately; no migration is applied here.
3. Verify the receiver and website rewrite together in Preview with authenticated non-business probes. Never POST through a preview rewrite into the old production receiver.
4. Approve production release only after those gates pass. Configure no new mappings or provider keys without approval.
5. Approve one recipient and synthetic message. Submit once, retain the request/provider IDs, observe actual delivery/status and inbound processing. Preserve audit records; never retry older uncertain messages.

Original combined repairs, approved hosted package and migration files remain in their existing checkout, unchanged.
