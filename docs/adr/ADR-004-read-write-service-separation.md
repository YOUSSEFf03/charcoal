# ADR-004: Why Read and Write Services Are Separated

**Status:** Accepted (see `CASH_MANAGEMENT_FINAL_BLUEPRINT.md` §1, §3, §7)

## Context

The first-draft architecture spec proposed a single `LedgerService` exposing both write operations (`recordCollection`, `recordHandover`, `recordTransfer`, `recordCorrection`) and read operations (`getBalance`, `getAllBalances`, `getExpectedCash`). At the time this seemed like a reasonable single home for "everything ledger-related."

A peer review of that spec flagged it as the seed of a future god-service: at the business's stated growth target (dozens of branches, hundreds of users, thousands of transactions/day), a single class accreting both every new write operation *and* every new report/query would become the one file every feature change has to touch, in two directions at once.

Separately, the audit found that Dashboard and Reports already independently computed overlapping "total collected" figures with different (and inconsistent) currency handling — a symptom of *read* logic not having one clear, shared home in the first place.

## Decision

Two services, not one:
- **`LedgerWriteService`** — the only code path permitted to insert a `LedgerEntry` row. Validates the holder, stamps the exchange-rate reference, enforces the reference constraints. Never computes or returns a balance.
- **`BalanceQueryService`** (plus `CashReportingService` above it, for business-wide aggregates) — the only code path permitted to answer "how much does X hold." Pure reads. Never writes anything.

`CashReportingService` depends on `BalanceQueryService`; the dependency never runs in the other direction. No service in the money-flow graph calls back into a service that (transitively) calls it — the dependency graph is a strict DAG.

## Consequences

**Positive:**
- Each service has exactly one reason to change: a new *kind* of cash movement touches `LedgerWriteService`; a new *report or dashboard figure* touches `BalanceQueryService`/`CashReportingService`. Neither growth direction bloats the other file.
- This is the seam a CQRS-style read model needs. The read side can become a materialized view, a scheduled projection, or a separate read-replica-backed service later without `LedgerWriteService` (or any of its callers) ever needing to change.
- It directly enforces the fix for the Dashboard/Reports inconsistency: there is now exactly one shared place that computes "total collected," and every page is required to call it rather than write its own aggregation.

**Negative:**
- Slightly more ceremony for a trivial read (two services to know about instead of one) — considered an acceptable, minor cost against the alternative of an unbounded shared class.

## Alternatives Considered

- **One `LedgerService` with both responsibilities** (the original proposal): rejected on review — it doesn't violate anything on day one, but has no natural boundary to stop it from becoming the single most-touched file in the backend as both read and write features accumulate.
- **Full CQRS with separate physical data stores from day one:** rejected as premature — the read side can start as a live query against the same database; the *service* boundary is what matters architecturally, not the storage technology behind it on day one.

## Why This Matters Later

If someone asks "why do we have two services instead of one `LedgerService`, isn't that more files for the same thing" — the answer is: they were one service in an earlier draft, and a peer review caught that it would become the file every future feature — write or read — has to edit, in two unrelated directions. Splitting them now, while the surface area is small, means neither side ever needs to be untangled from the other later.
