# ADR-003: Why Balances Are Computed, Not Stored

**Status:** Accepted (see `CASH_MANAGEMENT_FINAL_BLUEPRINT.md` §1, §5, §7)

## Context

The pre-existing system stored a running balance directly on `UserAccount.balance`, incremented and decremented in place by two helper functions. On paper this is a reasonable denormalization for fast reads. In practice, the audit found the invariant "this column always equals the sum of the ledger" was violated the moment any code path touched a related figure *without* going through those two helpers — specifically, editing `StockExit.amount` after creation. The stored balance and the true ledger history could silently diverge, with no mechanism to detect or repair it.

There was also no currency dimension on the stored balance at all — USD and LBP amounts were added into the same numeric column as if they were the same unit.

## Decision

A holder's balance is **never** an independently-stored, independently-writable value. It is always the output of a query — `SUM(LedgerEntry.amount) WHERE holderId = ? AND currency = ? AND category = ?` — computed by `BalanceQueryService`, the only code allowed to answer that question.

At the business's current scale (a handful of holders, low hundreds of entries per month), a live query is fast enough that no caching is needed at all. If a performance need is ever demonstrated, the answer is a `LedgerCheckpoint` — an immutable, periodically-generated snapshot ("balance as of end-of-month X was $Y") that lets `BalanceQueryService` sum only the entries *after* the most recent checkpoint. A checkpoint is still just an optimization of the same computation, written only by that one service's own reconciliation job — never an independently-writable fact.

## Consequences

**Positive:**
- The entire class of bug the audit found — a stored balance silently drifting from the ledger — becomes structurally impossible, because there is no second copy of the number to drift.
- Adding a currency (or a category, per ADR on advances) dimension is just an additional `GROUP BY` term, not a schema migration of a cached column that was never designed to be split.
- A reconciliation job, if one is ever needed, is validating a checkpoint against its own source of truth — it can never "disagree" with itself in a way that requires deciding which value is correct.

**Negative:**
- A live `SUM` query has to be indexed properly (`holderId, currency, category, occurredAt`) and, at very large scale (millions of rows over years), needs the checkpoint optimization to stay fast — this is planned for (Phase 7 of the Implementation Roadmap) but not built until real growth demonstrates the need.

## Alternatives Considered

- **Keep the cached column, add a nightly reconciliation job to detect drift:** rejected — this treats the symptom (detecting drift after the fact) rather than the cause (a second, independently-writable copy of the truth existing at all). It also does nothing to prevent drift between reconciliation runs.
- **Cache balances in a separate table updated in the same transaction as every ledger write:** this is effectively what a `LedgerCheckpoint` becomes *if* performance ever requires it — the difference is that a checkpoint is periodic and clearly labeled as a derived optimization, not a real-time value every caller might assume is authoritative.

## Why This Matters Later

If someone asks "why don't we just put the balance on the user/holder table for fast reads, like we used to" — the answer is: we tried exactly that, and it's the reason a stock exit's amount could be edited without anyone's balance changing to match. A number that's computed can't drift from the thing it's computed from.
