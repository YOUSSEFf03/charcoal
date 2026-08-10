# ADR-002: Why the Ledger Is Append-Only

**Status:** Accepted (see `CASH_MANAGEMENT_FINAL_BLUEPRINT.md` §5, §10 invariants 2, 6, 10)

## Context

The pre-existing system's `AccountEntry` table was, in practice, already treated as append-only — nothing ever called `.update()` or `.delete()` on it. But nothing *enforced* that. Separately, `StockExit.amount` (a field that indirectly represented collected cash) **was** editable via `PATCH /stock-exits/:id`, and that edit never touched the ledger at all — meaning the one place in the system that *did* allow a retroactive change to a cash-related figure did so completely outside the ledger's awareness, silently diverging displayed amounts from ledger history.

The audit that started this work found this directly: a stock exit's amount could be entered, edited, or corrected after the fact with zero effect on the collector's ledger balance.

## Decision

A `LedgerEntry`, once created, is never updated and never deleted — by any code path, at any privilege level, including `owner`. This is enforced at the application/service layer (`LedgerWriteService` exposes no update or delete method) and is recommended to be reinforced later with database-level insert-only permissions on the table as the system matures.

Every correction to history is a **new entry**, referencing what it corrects, with a mandatory reason. Nothing is ever fixed by editing what already happened — only by recording what happened *next* (a correction) alongside it.

## Consequences

**Positive:**
- Every fact about cash custody is permanently reconstructable from the table alone. A backup of `LedgerEntry` plus its referenced source documents is sufficient to rebuild every balance in history exactly.
- No code path — present or future — can silently desynchronize a displayed amount from the ledger, because there is no "edit" operation to desynchronize through in the first place.
- Disaster recovery and audit are the same operation: replay the table.

**Negative:**
- Fixing a genuine data-entry mistake always produces *two* rows (the original and its correction) rather than one corrected row — this is intentional, but means the "current" state of an event is only visible by reading both, not by reading a single authoritative row.
- Requires discipline for legitimate manual database interventions (see ADR-005's sibling concern in the Security Model, §9 of the blueprint): a raw SQL fix to the ledger must still be paired with a compensating, clearly-tagged `manual_intervention` entry rather than a silent row edit — the architecture cannot fully prevent this at the database layer alone without production hardening beyond this project's current scope.

## Alternatives Considered

- **Mutable rows with an audit-log side table** (a common pattern for "editable but tracked" data): rejected — this still permits the current balance to be wrong at any given moment if the audit log and the row are ever out of sync, and it was exactly the shape of the `StockExit.amount` defect this decision closes.
- **Soft-delete / versioned rows** (mark old versions inactive, insert a new "current" version): rejected as unnecessary complexity — a plain append-only table with correction entries achieves the same auditability without needing a "which version is current" query anywhere.

## Why This Matters Later

If someone asks "why can't I just fix this ledger row directly, it would be one line of SQL" — the answer is: because the previous system already had exactly that shortcut available (editing `StockExit.amount`), and it was the mechanism by which balances silently drifted from reality. The one-line fix is always "insert a correction entry," never "change the row."
