# ADR-005: Why Idempotency Is Enforced at the Business-Document Layer

**Status:** Accepted (see `CASH_MANAGEMENT_FINAL_BLUEPRINT.md` §1, §4, §8; Implementation Roadmap Phase 4)

## Context

Neither the pre-existing system nor the first-draft architecture spec addressed duplicate submissions at all. A peer review of the spec raised it as the single largest gap: a double-clicked "Confirm handover" button, a network timeout that causes a frontend retry, or a driver's offline mobile app resyncing after connectivity returns could each produce two ledger entries for one real-world cash event, with nothing anywhere to notice or prevent it.

The natural question is *where* the deduplication check should live: inside the ledger-writing primitive itself, or one layer up, at whichever business operation (a Payment, a Warehouse Sale, a Cash Handover, a Cash Transfer) actually triggers it.

## Decision

Idempotency is enforced at the **business-document layer**, not inside `LedgerWriteService`. Every write-inducing operation (`Payment`, `StockExit`/`WarehouseSale`, `CashHandover`, `CashTransfer`, `CashAdvance`) carries a client-generated idempotency key, stored under a unique database constraint on that document. A retried request with the same key returns the original result instead of creating a second document.

Because the `LedgerEntry` is always written inside the same transaction as its business document, deduplicating the document automatically deduplicates its ledger effect — for free, with no separate idempotency logic needed inside `LedgerWriteService` at all.

## Consequences

**Positive:**
- `LedgerWriteService` stays simple: it can assume it is only ever invoked once per real event, because deduplication already happened one layer up. This matters more, not less, as more collection *sources* are added over time (payment gateways, bank integrations) — each new source only has to implement one dedup check (on its own document), not learn or reimplement the ledger's internal idempotency contract.
- The key is generated once per user action on the client, before any network round-trip — so it survives exactly the failure modes that matter (timeout-then-retry, double-click, offline-then-sync), rather than being regenerated on each retry attempt (which would defeat the purpose).
- This is the same mechanism, unmodified, that will make offline mobile collection safe later: an event gets its key and its true occurrence time the moment it happens, online or not, and syncs whenever connectivity returns.

**Negative:**
- Every new business-document type that can trigger a ledger write must remember to add its own idempotency key column and uniqueness check — this is a small, repeated cost per new document type, not a one-time cost paid once in the ledger.

## Alternatives Considered

- **Idempotency inside `LedgerWriteService` itself** (e.g., a key on `LedgerEntry`): rejected — a single real-world event can legitimately produce more than one ledger entry (a transfer produces two; a handover with a shortage produces two), so "one key, one entry" doesn't map cleanly onto the ledger's own writes. The business document, by contrast, always has exactly one instance per real event, making it the natural place to ask "have I already handled this."
- **Rely on the frontend alone to disable the submit button:** rejected as insufficient on its own — this helps against double-clicks but does nothing for a network-level retry the frontend itself doesn't initiate (e.g., a proxy or an offline-sync queue resending a request it never got a response for). Server-side enforcement via a unique constraint is the actual guarantee; the disabled button is a UX nicety layered on top of it.

## Why This Matters Later

If someone asks "why does every new payment/sale/transfer type need its own idempotency key instead of the ledger just handling it once" — the answer is: because one real event doesn't always correspond to one ledger row (transfers and corrected handovers are exactly two), so the ledger can't be the layer that knows "have I seen this before." The business document always can.
